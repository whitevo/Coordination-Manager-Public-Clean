/**
 * Account Merge Service
 *
 * Handles merging two user accounts into one: transfers all owned data
 * (calendars, templates, schedules, feedback, calendar sources, discord
 * integrations, email contacts, user connections, connection invites,
 * notification preferences, privacy settings, email opt-outs) from a
 * source user into a target user, copies missing
 * identity fields (wallet_address, google_id, email), optionally applies
 * the source's settings, then removes the source profile row.
 *
 * The source Supabase Auth user is kept alive so that wallet-based logins
 * still succeed. The auth middleware transparently redirects merged wallet
 * sessions to the surviving (target) user via wallet_address lookup.
 */

import crypto from 'crypto'
import { supabaseAdmin } from '../supabaseClient.js'

// ── Merge-token store (DB-backed, 10-minute TTL, single use) ──────────
//
// Tokens live in `account_merge_tokens` so they survive restarts and work
// across multiple API instances. Only a SHA-256 hash of the token is stored.

export interface MergeToken {
  sourceUserId: string
  sourceAccountType: string
  expiresAt: number
  /** True when the token existed but was past its TTL (it is consumed either way). */
  expired: boolean
}

const MERGE_TOKEN_TTL_MS = 10 * 60 * 1000 // 10 minutes

function hashMergeToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/**
 * Create a merge token for the given source user.
 * Only the token hash is persisted; the token is single-use / time-limited.
 */
export async function createMergeToken(sourceUserId: string, sourceAccountType: string): Promise<string> {
  const token = `${crypto.randomUUID()}-${crypto.randomUUID()}`
  const now = Date.now()

  const { error } = await supabaseAdmin.from('account_merge_tokens').insert({
    token_hash: hashMergeToken(token),
    source_user_id: sourceUserId,
    source_account_type: sourceAccountType,
    expires_at: new Date(now + MERGE_TOKEN_TTL_MS).toISOString(),
  })
  if (error) {
    throw new Error('Failed to create merge token')
  }

  // Best-effort cleanup of expired tokens (never blocks token creation)
  try {
    await supabaseAdmin
      .from('account_merge_tokens')
      .delete()
      .lt('expires_at', new Date(now).toISOString())
  } catch {
    // Best-effort
  }

  return token
}

/**
 * Consume a merge token (delete-and-return, so it can only be used once).
 * Returns null when the token is unknown or already used.
 */
export async function consumeMergeToken(token: string): Promise<MergeToken | null> {
  const { data, error } = await supabaseAdmin
    .from('account_merge_tokens')
    .delete()
    .eq('token_hash', hashMergeToken(token))
    .select('source_user_id, source_account_type, expires_at')
    .maybeSingle()

  if (error) {
    throw new Error('Failed to verify merge token')
  }
  if (!data) return null

  const expiresAt = new Date(data.expires_at as string).getTime()
  return {
    sourceUserId: data.source_user_id as string,
    sourceAccountType: data.source_account_type as string,
    expiresAt,
    expired: expiresAt < Date.now(),
  }
}

/**
 * Merge all data from `sourceUserId` into `targetUserId`.
 *
 * @param sourceUserId  Account that will be deleted after merge
 * @param targetUserId  Surviving account that receives all data
 * @param keepSettingsFromSource  When true, overwrite the target's
 *        settings (timezone, reminder, theme, display name, avatar)
 *        with the source's values.
 */
export async function mergeAccounts(
  sourceUserId: string,
  targetUserId: string,
  keepSettingsFromSource: boolean
): Promise<void> {
  // 1. Fetch both profiles ──────────────────────────────────────────
  const { data: sourceUser } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', sourceUserId)
    .single()

  const { data: targetUser } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', targetUserId)
    .single()

  if (!sourceUser || !targetUser) {
    throw new Error('One or both accounts not found')
  }

  // Determine the target identity for calendar ownership.
  // Prefer real email, fall back to userId.
  const targetIdentity = targetUser.email || targetUserId

  // 2. Transfer calendars ───────────────────────────────────────────
  // created_by is TEXT and may contain the user's UUID, real email,
  // or wallet-derived email (wallet-xxxx@cardano.wallet).
  // We need to check ALL possible identity formats.
  const sourceIdentities = new Set<string>([sourceUserId])

  // Real email from users table
  if (sourceUser.email && sourceUser.email !== sourceUserId) {
    sourceIdentities.add(sourceUser.email)
  }

  // Wallet-derived email (what CIP-30 Cardano auth users use in Supabase)
  // Format: wallet-{address.slice(0,20)}@cardano.wallet
  if (sourceUser.wallet_address) {
    const walletEmail = `wallet-${sourceUser.wallet_address.slice(0, 20)}@cardano.wallet`
    sourceIdentities.add(walletEmail)
  }

  // Also try the source auth user's email from Supabase Auth
  try {
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(sourceUserId)
    if (authUser?.user?.email) {
      sourceIdentities.add(authUser.user.email)
    }
  } catch {
    // Best-effort
  }

  // Transfer all calendars matching any source identity
  for (const identity of sourceIdentities) {
    // Update created_by to target identity
    await supabaseAdmin
      .from('calendars')
      .update({
        created_by: targetIdentity,
        creator_account_type: targetUser.account_type || 'google',
      })
      .eq('created_by', identity)
  }

  // Also update permissions.canEdit on all calendars now owned by target
  // to include both target identities (email + userId)
  const { data: targetCalendars } = await supabaseAdmin
    .from('calendars')
    .select('id, permissions')
    .eq('created_by', targetIdentity)

  if (targetCalendars) {
    for (const cal of targetCalendars) {
      const existingCanEdit: string[] = (cal.permissions as { canEdit?: string[] } | null)?.canEdit || []
      const newCanEdit = [...new Set([
        ...existingCanEdit,
        targetUserId,
        ...(targetUser.email ? [targetUser.email] : []),
      ])]
      // Only update if we actually added new entries
      if (newCanEdit.length > existingCanEdit.length) {
        await supabaseAdmin
          .from('calendars')
          .update({
            permissions: { ...(cal.permissions as object || {}), canEdit: newCanEdit },
          })
          .eq('id', cal.id)
      }
    }
  }

  // 3. Transfer calendar_sources (skip duplicate constraint violations)
  const { data: sourceSources } = await supabaseAdmin
    .from('calendar_sources')
    .select('id')
    .eq('user_id', sourceUserId)

  if (sourceSources && sourceSources.length > 0) {
    for (const src of sourceSources) {
      const { error } = await supabaseAdmin
        .from('calendar_sources')
        .update({ user_id: targetUserId })
        .eq('id', src.id)
      if (error) {
        // Unique-constraint conflict — delete the duplicate instead
        await supabaseAdmin.from('calendar_sources').delete().eq('id', src.id)
      }
    }
  }

  // 4. Transfer announcement_templates ──────────────────────────────
  await supabaseAdmin
    .from('announcement_templates')
    .update({ user_id: targetUserId })
    .eq('user_id', sourceUserId)

  // 5. Transfer announcement_schedules ──────────────────────────────
  await supabaseAdmin
    .from('announcement_schedules')
    .update({ user_id: targetUserId })
    .eq('user_id', sourceUserId)

  // 6. Transfer feedback ────────────────────────────────────────────
  await supabaseAdmin
    .from('feedback')
    .update({ user_id: targetUserId })
    .eq('user_id', sourceUserId)

  // 7. Transfer discord_integrations (only if target has none) ──────
  const { data: targetDiscord } = await supabaseAdmin
    .from('discord_integrations')
    .select('id')
    .eq('user_id', targetUserId)
    .eq('is_active', true)
    .maybeSingle()

  if (!targetDiscord) {
    // Also transfer guild_channels if we move the integration
    const { data: sourceDiscord } = await supabaseAdmin
      .from('discord_integrations')
      .select('id')
      .eq('user_id', sourceUserId)
      .eq('is_active', true)
      .maybeSingle()

    if (sourceDiscord) {
      await supabaseAdmin
        .from('discord_guild_channels')
        .update({ user_id: targetUserId })
        .eq('user_id', sourceUserId)

      await supabaseAdmin
        .from('discord_integrations')
        .update({ user_id: targetUserId })
        .eq('user_id', sourceUserId)
    }
  }

  // 8. Transfer email_contacts ───────────────────────────────────────
  //    Move source's contacts to target, skipping duplicates (same email
  //    already owned by target).  Also repoint linked_user_id references.
  {
    const { data: sourceContacts } = await supabaseAdmin
      .from('email_contacts')
      .select('id, email')
      .eq('owner_user_id', sourceUserId)

    if (sourceContacts && sourceContacts.length > 0) {
      for (const contact of sourceContacts) {
        const { error } = await supabaseAdmin
          .from('email_contacts')
          .update({ owner_user_id: targetUserId })
          .eq('id', contact.id)
        if (error) {
          // Unique-constraint conflict (target already has this email) — delete the duplicate
          await supabaseAdmin.from('email_contacts').delete().eq('id', contact.id)
        }
      }
    }

    // Repoint linked_user_id from source → target on any contact row
    await supabaseAdmin
      .from('email_contacts')
      .update({ linked_user_id: targetUserId })
      .eq('linked_user_id', sourceUserId)
  }

  // 9. Transfer user_connections (friend list) ─────────────────────
  //    Re-assign connections from source → target, skipping duplicates
  //    and self-connections.
  {
    const { data: srcConns } = await supabaseAdmin
      .from('user_connections')
      .select('id, user_a_id, user_b_id')
      .or(`user_a_id.eq.${sourceUserId},user_b_id.eq.${sourceUserId}`)

    if (srcConns && srcConns.length > 0) {
      for (const conn of srcConns) {
        const otherUserId = conn.user_a_id === sourceUserId ? conn.user_b_id : conn.user_a_id

        // Skip if this would create a self-connection
        if (otherUserId === targetUserId) {
          await supabaseAdmin.from('user_connections').delete().eq('id', conn.id)
          continue
        }

        // Determine the column to update
        const updateCol = conn.user_a_id === sourceUserId ? 'user_a_id' : 'user_b_id'
        const { error } = await supabaseAdmin
          .from('user_connections')
          .update({ [updateCol]: targetUserId })
          .eq('id', conn.id)

        if (error) {
          // Unique-constraint conflict — target already connected to this user
          await supabaseAdmin.from('user_connections').delete().eq('id', conn.id)
        }
      }
    }
  }

  // 10. Transfer connection_invites ─────────────────────────────────
  await supabaseAdmin
    .from('connection_invites')
    .update({ sender_user_id: targetUserId })
    .eq('sender_user_id', sourceUserId)

  await supabaseAdmin
    .from('connection_invites')
    .update({ used_by_user_id: targetUserId })
    .eq('used_by_user_id', sourceUserId)

  // 11. Transfer notification_preferences (keep target's if it exists)
  {
    const { data: targetNotifPref } = await supabaseAdmin
      .from('notification_preferences')
      .select('id')
      .eq('user_id', targetUserId)
      .maybeSingle()

    if (!targetNotifPref) {
      await supabaseAdmin
        .from('notification_preferences')
        .update({ user_id: targetUserId })
        .eq('user_id', sourceUserId)
    } else {
      await supabaseAdmin
        .from('notification_preferences')
        .delete()
        .eq('user_id', sourceUserId)
    }
  }

  // 12. Transfer privacy_settings (keep target's if it exists) ─────
  {
    const { data: targetPrivacy } = await supabaseAdmin
      .from('privacy_settings')
      .select('id')
      .eq('user_id', targetUserId)
      .maybeSingle()

    if (!targetPrivacy) {
      await supabaseAdmin
        .from('privacy_settings')
        .update({ user_id: targetUserId })
        .eq('user_id', sourceUserId)
    } else {
      await supabaseAdmin
        .from('privacy_settings')
        .delete()
        .eq('user_id', sourceUserId)
    }
  }

  // 13. Transfer email_opt_outs ─────────────────────────────────────
  await supabaseAdmin
    .from('email_opt_outs')
    .update({ sender_user_id: targetUserId })
    .eq('sender_user_id', sourceUserId)

  // 14. Build target user updates ────────────────────────────────────
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }

  // Copy google_id from source if target lacks one
  if (sourceUser.google_id && !targetUser.google_id) {
    updates.google_id = sourceUser.google_id
  }

  // Copy real email if target only has a generated wallet email
  if (
    sourceUser.email &&
    !sourceUser.email.endsWith('@cardano.wallet') &&
    targetUser.email?.endsWith('@cardano.wallet')
  ) {
    updates.email = sourceUser.email
  }

  // 15. Optionally keep source's settings (initiating account) ──────
  if (keepSettingsFromSource) {
    if (sourceUser.timezone) updates.timezone = sourceUser.timezone
    if (sourceUser.default_reminder_minutes != null) {
      updates.default_reminder_minutes = sourceUser.default_reminder_minutes
    }
    if (sourceUser.display_name) updates.display_name = sourceUser.display_name
    if (sourceUser.avatar_url) updates.avatar_url = sourceUser.avatar_url
    // feedback_status_order
    if (sourceUser.feedback_status_order) {
      updates.feedback_status_order = sourceUser.feedback_status_order
    }
  }

  // 15b. Smart-merge theme_preferences ─────────────────────────────
  //
  // Custom themes are ALWAYS combined from both accounts (deduped by ID).
  //
  // When keepSettingsFromSource = true (source account initiated the link):
  //   - mode, darkThemeId, lightThemeId, notificationSettings, calendarSettings come from source
  //   - customThemes = source themes + any target-only themes
  //
  // When keepSettingsFromSource = false (primary/target account wins):
  //   - mode, darkThemeId, lightThemeId, notificationSettings, calendarSettings stay on target
  //   - customThemes = target themes + any source-only themes (new custom themes absorbed)
  {
    const sourcePref = (sourceUser.theme_preferences || {}) as Record<string, unknown>
    const targetPref = (targetUser.theme_preferences || {}) as Record<string, unknown>
    const sourceThemes = (sourcePref.customThemes as unknown[] | undefined) || []
    const targetThemes = (targetPref.customThemes as unknown[] | undefined) || []

    if (keepSettingsFromSource) {
      // Take all settings from source but absorb unique custom themes from target
      const sourceThemeIds = new Set(sourceThemes.map((t) => (t as { id?: string }).id))
      const onlyInTarget = targetThemes.filter((t) => !sourceThemeIds.has((t as { id?: string }).id))
      updates.theme_preferences = {
        ...sourcePref,
        customThemes: [...sourceThemes, ...onlyInTarget],
      }
    } else {
      // Keep all settings from target but absorb unique custom themes from source
      const targetThemeIds = new Set(targetThemes.map((t) => (t as { id?: string }).id))
      const onlyInSource = sourceThemes.filter((t) => !targetThemeIds.has((t as { id?: string }).id))
      if (onlyInSource.length > 0) {
        updates.theme_preferences = {
          ...targetPref,
          customThemes: [...targetThemes, ...onlyInSource],
        }
      }
    }
  }

  // 16. Clear wallet_address from source FIRST to avoid unique constraint
  //     violation, then set it on the target.
  if (sourceUser.wallet_address && !targetUser.wallet_address) {
    await supabaseAdmin
      .from('users')
      .update({ wallet_address: null, stake_address: null })
      .eq('id', sourceUserId)

    updates.wallet_address = sourceUser.wallet_address
    updates.stake_address = sourceUser.stake_address || null
  }

  await supabaseAdmin
    .from('users')
    .update(updates)
    .eq('id', targetUserId)

  // 17. Delete source user profile row ──────────────────────────────
  //     The Supabase Auth entry is intentionally KEPT ALIVE so that
  //     wallet-derived password logins still succeed. The auth middleware
  //     detects that no users-table row exists for the auth user and
  //     redirects the session to the surviving account via wallet_address.
  await supabaseAdmin.from('users').delete().eq('id', sourceUserId)
}
