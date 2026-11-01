import type { User } from 'discord.js'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface LinkDeps {
  supabase: SupabaseClient
  syncGuildsForUser: (integrationId: string, userId: string, discordUserId: string) => Promise<void>
  frontendUrl: string
}

export interface LinkResult {
  ok: boolean
  message: string
}

// Shared by /link and the DM fallback so both paths apply the same checks,
// expire the key on first use, and start the guild sync.
export async function linkDiscordAccount(deps: LinkDeps, key: string, user: User): Promise<LinkResult> {
  const { supabase, syncGuildsForUser, frontendUrl } = deps
  const discordUserId = user.id

  const { data: integration, error } = await supabase
    .from('discord_integrations')
    .select('*')
    .eq('link_key', key)
    .eq('is_active', true)
    .maybeSingle()

  if (error || !integration) {
    return { ok: false, message: 'Invalid or expired link key. Please generate a new one from the platform.' }
  }

  if (integration.bot_verified) {
    if (integration.discord_user_id === discordUserId) {
      return { ok: false, message: 'Your Discord account is already linked with this key. Use `/status` to check it.' }
    }
    return { ok: false, message: 'This link key was already used. Please generate a new one from the platform.' }
  }

  if (new Date(integration.link_key_expires_at) < new Date()) {
    return { ok: false, message: 'This link key has expired. Please generate a new one from the platform.' }
  }

  if (integration.discord_user_id && integration.discord_user_id !== discordUserId) {
    return { ok: false, message: 'This link key is already used by another Discord account.' }
  }

  // Deactivate any other active integrations already linked to this Discord user
  // (prevents unique constraint violation on discord_user_id)
  await supabase
    .from('discord_integrations')
    .update({ is_active: false })
    .eq('discord_user_id', discordUserId)
    .eq('is_active', true)
    .neq('id', integration.id)

  const nowIso = new Date().toISOString()
  const { error: updateError } = await supabase
    .from('discord_integrations')
    .update({
      discord_user_id: discordUserId,
      discord_username: user.tag,
      discord_avatar: user.displayAvatarURL(),
      bot_verified: true,
      bot_verified_at: nowIso,
      // Single use: expire the key so a leaked copy cannot be replayed
      link_key_expires_at: nowIso,
    })
    .eq('id', integration.id)

  if (updateError) {
    console.error('Failed to update integration:', updateError)
    return { ok: false, message: 'Something went wrong linking your account. Please try again.' }
  }

  // Auto-sync available channels for this user (runs in background after reply)
  syncGuildsForUser(integration.id, integration.user_id, discordUserId).catch(err =>
    console.error('Background sync failed:', err)
  )

  // Retroactive: backfill cm_user_id on all existing dm_calendar_invites for this Discord user
  supabase
    .from('dm_calendar_invites')
    .update({ cm_user_id: integration.user_id, updated_at: nowIso })
    .eq('recipient_discord_id', discordUserId)
    .is('cm_user_id', null)
    .then(({ error: backfillErr }) => {
      if (backfillErr) console.error('Failed to backfill cm_user_id on dm_calendar_invites:', backfillErr)
    })

  return {
    ok: true,
    message: `Successfully linked! Your Discord account is now connected to the Coordination Manager platform. Channels are being synced -- go to the Announcements page to select where to post: <${frontendUrl}/announcements?tab=discord>`,
  }
}
