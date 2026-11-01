import {
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  MessageFlags,
} from 'discord.js'

import type { Client, DMChannel } from 'discord.js'
import type { SupabaseClient } from '@supabase/supabase-js'

// ─── Types ────────────────────────────────────────────────────────────

export type SubscriptionStatus = 'invited' | 'subscribed' | 'unsubscribed' | 'opted_out'

export interface DmSendResult {
  success: boolean
  messageId?: string
  error?: string
  /** When a message is blocked, the subscription status that caused it. */
  blockedByStatus?: SubscriptionStatus
  /** The recipient's calendar subscription status after sending (invited or subscribed). */
  subscriptionStatus?: SubscriptionStatus
  /** True only when this is the very first DM for this calendar+recipient (row was inserted). */
  isFirstCalendarMessage?: boolean
}

export interface DmDeps {
  client: Client
  supabase: SupabaseClient
}

export interface DmOptions {
  userId: string
  content: string
  senderUsername?: string
  title?: string
  senderUserId?: string
  pollOptions?: Array<{ emoji: string; text: string }>
  isImmediate?: boolean
  suppressEmbeds?: boolean
  calendarId?: string
  calendarName?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────

/** Wrap URLs in <angle brackets> so Discord does not generate link-preview embeds.
 *  Pass 1: Wrap URLs inside markdown links [text](url) -> [text](<url>)
 *  Pass 2: Wrap bare URLs not already in <> or inside markdown () */
export function wrapUrlsForEmbed(text: string): string {
  // Skip markdown links [text](url) — they don't generate embeds in Discord,
  // and wrapping to [text](<url>) causes the > to leak as visible text in DMs.
  // Only wrap bare URLs (not inside markdown links or already wrapped in <>).
  // Bracket/paren exclusions keep scanning linear (no catastrophic backtracking).
  const markdownLinkRe = /\[([^\][]*)\]\((https?:\/\/[^()]+)\)/g
  const placeholders: string[] = []
  let placeholdered = text.replace(markdownLinkRe, (match) => {
    placeholders.push(match)
    return `\x00ML${placeholders.length - 1}\x00`
  })
  // Wrap remaining bare URLs (not preceded by < or inside markdown)
  placeholdered = placeholdered.replace(/(?<![<(])(https?:\/\/[^\s>)]+)/g, '<$1>')
  // Restore markdown links untouched
  placeholdered = placeholdered.replace(/\x00ML(\d+)\x00/g, (_, idx) => placeholders[Number(idx)])
  return placeholdered
}

// ─── Core DM sending logic (dependency-injected for testability) ──────

export async function sendDM(
  deps: DmDeps,
  opts: DmOptions,
): Promise<DmSendResult> {
  const {
    userId, content, senderUsername, title, senderUserId,
    pollOptions, isImmediate, suppressEmbeds, calendarId, calendarName,
  } = opts
  const { client, supabase } = deps

  try {
    // ── Check opt-outs before sending ──
    if (senderUserId) {
      const { data: optOut } = await supabase
        .from('dm_opt_outs')
        .select('id')
        .eq('recipient_discord_id', userId)
        .or(`sender_user_id.eq.${senderUserId},sender_user_id.is.null`)
        .limit(1)
        .maybeSingle()

      if (optOut) {
        return { success: false, error: 'Recipient has opted out of DMs from this sender' }
      }
    }

    // ── Calendar-level subscription check (status-based) ──
    let isCalendarInvite = false
    let isSubscribed = false
    let isFirstCalendarMessage = false
    if (calendarId && senderUserId) {
      const { data: invite } = await supabase
        .from('dm_calendar_invites')
        .select('id, status')
        .eq('recipient_discord_id', userId)
        .eq('calendar_id', calendarId)
        .maybeSingle()

      if (!invite) {
        // First message ever for this calendar -- send it, mark as 'invited'
        isCalendarInvite = true
        isFirstCalendarMessage = true
        // Look up CM user for account linking
        const { data: linked } = await supabase
          .from('discord_integrations')
          .select('user_id')
          .eq('discord_user_id', userId)
          .eq('is_active', true)
          .maybeSingle()

        await supabase.from('dm_calendar_invites').insert({
          recipient_discord_id: userId,
          calendar_id: calendarId,
          sender_user_id: senderUserId,
          status: 'invited',
          cm_user_id: linked?.user_id ?? null,
        })
      } else if (invite.status === 'subscribed') {
        isSubscribed = true
      } else if (invite.status === 'invited') {
        // Previously invited but hasn't responded -- block until they subscribe
        return {
          success: false,
          error: calendarName
            ? `Recipient did not respond to the previous invite for: ${calendarName}`
            : 'Recipient did not respond to the previous invite',
          blockedByStatus: 'invited',
        }
      } else if (invite.status === 'opted_out') {
        return {
          success: false,
          error: 'Recipient opted out of this calendar',
          blockedByStatus: 'opted_out',
        }
      } else if (invite.status === 'unsubscribed') {
        return {
          success: false,
          error: calendarName
            ? `Recipient unsubscribed from your Coordination Calendar: ${calendarName}`
            : 'Recipient unsubscribed from this calendar',
          blockedByStatus: 'unsubscribed',
        }
      }
    }

    const user = await client.users.fetch(userId)
    const dm = await user.createDM()

    // ── Check if this is a first-contact message (sender-level) ──
    let isFirstContact = false
    if (senderUserId) {
      const { data: existing } = await supabase
        .from('dm_first_contacts')
        .select('id')
        .eq('sender_user_id', senderUserId)
        .eq('recipient_discord_id', userId)
        .maybeSingle()

      if (!existing) {
        isFirstContact = true
        await supabase.from('dm_first_contacts').insert({
          sender_user_id: senderUserId,
          recipient_discord_id: userId,
        })
      }
    }

    // ── Build message ──
    let fullContent = content

    if (suppressEmbeds) {
      fullContent = wrapUrlsForEmbed(fullContent)
    }

    if (pollOptions?.length) {
      const optionLines = pollOptions.map(o => `${o.emoji} ${o.text}`).join('\n')
      fullContent += `\n\n${optionLines}`
    }

    if (senderUsername) {
      const verb = isImmediate ? 'Posted' : 'Scheduled'
      // When suppressing embeds, use zero-width space in domain to prevent Discord auto-linking
      // (SuppressEmbeds flag doesn't work in DMs — bot lacks MANAGE_MESSAGES)
      const hasExistingLink = fullContent.includes('coordinationmanager.com')
      const viaText = suppressEmbeds
        ? 'coordinationmanager\u200B.com'
        : hasExistingLink
          ? 'coordinationmanager.com'
          : '[coordinationmanager.com](https://coordinationmanager.com)'
      fullContent += `\n\n-# — ${verb} via ${viaText} by @${senderUsername}`
    }

    if (fullContent.length > 2000) {
      fullContent = fullContent.slice(0, 1997) + '...'
    }

    // ── First-contact intro (sender-level) ──
    if (isFirstContact) {
      const introContent = [
        "👋 Hi! I'm the Swarm Coordinator Bot.",
        '',
        `**@${senderUsername || 'A user'}** from the Coordination Manager is reaching out to you`,
        "I'm forwarding their message because you both share the same Discord server.",
        '',
        "I'm just a bot; you can block me at any time or Use /feedback to send direct message to maintainers",
        '',
        '─────────────────',
      ].join('\n')

      if (introContent.length <= 2000) {
        await dm.send({
          content: introContent,
          allowedMentions: { parse: [] },
        })
      }
    }

    // ── Build action buttons ──
    const buttons: ButtonBuilder[] = []
    const displayName = calendarName || title || 'this initiative'

    if (!calendarId && senderUserId) {
      console.warn(`⚠️ No calendarId for DM to ${userId} — Subscribe/Unsubscribe button will not appear`)
    }

    if (calendarId && senderUserId) {
      if (isCalendarInvite || !isSubscribed) {
        buttons.push(
          new ButtonBuilder()
            .setCustomId(`dm_subscribe:${senderUserId}:${calendarId}`)
            .setLabel(`Subscribe to ${displayName}`.slice(0, 80))
            .setStyle(ButtonStyle.Success)
            .setEmoji('🔔')
        )
      } else {
        buttons.push(
          new ButtonBuilder()
            .setCustomId(`dm_unsubscribe:${senderUserId}:${calendarId}`)
            .setLabel(`Unsubscribe from ${displayName}`.slice(0, 80))
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🔕')
        )
      }
    }

    // Show Opt Out only when the recipient is not subscribed to this calendar
    // (subscribed users already have the Unsubscribe button for granular control)
    if (!isSubscribed) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`dm_optout:${senderUserId || 'unknown'}`)
          .setLabel(`Opt Out from ${senderUsername || 'this sender'}`.slice(0, 80))
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🚫')
      )
    }

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)

    // ── Calendar invite disclaimer ──
    if (isCalendarInvite && calendarId) {
      fullContent += '\n\n-# Click **Subscribe** to receive future updates. Without subscribing, this will be the last message you receive from this initiative.'
      if (fullContent.length > 2000) {
        fullContent = fullContent.slice(0, 1997) + '...'
      }
    }

    const msg = await dm.send({
      content: fullContent,
      components: [row],
      allowedMentions: { parse: [] },
      ...(suppressEmbeds ? { flags: MessageFlags.SuppressEmbeds } : {}),
    })

    // Force-suppress embeds via edit -- Discord doesn't always honour the flag on creation
    if (suppressEmbeds) {
      try { await msg.suppressEmbeds(true) } catch { /* DM edge case */ }
    }

    // Add poll reactions
    if (pollOptions?.length) {
      const reactedEmojis = new Set<string>()
      for (const option of pollOptions) {
        if (reactedEmojis.has(option.emoji)) continue
        reactedEmojis.add(option.emoji)
        try {
          await msg.react(option.emoji)
        } catch (reactErr: unknown) {
          const errMsg = reactErr instanceof Error ? reactErr.message : 'Unknown error'
          console.warn(`Failed to add poll reaction ${option.emoji} in DM:`, errMsg)
        }
      }
    }

    return {
      success: true,
      messageId: msg.id,
      subscriptionStatus: isSubscribed ? 'subscribed' : isCalendarInvite ? 'invited' : undefined,
      isFirstCalendarMessage,
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: errMsg }
  }
}

// ─── Button interaction handlers ──────────────────────────────────────

export interface ButtonResult {
  success: boolean
  action: 'subscribed' | 'unsubscribed' | 'opted_out'
  error?: string
}

export async function handleSubscribe(
  supabase: SupabaseClient,
  recipientDiscordId: string,
  senderUserId: string,
  calendarId: string,
): Promise<ButtonResult> {
  // Look up CM user for account linking
  const { data: linked } = await supabase
    .from('discord_integrations')
    .select('user_id')
    .eq('discord_user_id', recipientDiscordId)
    .eq('is_active', true)
    .maybeSingle()

  // Upsert the calendar invite row with 'subscribed' status
  await supabase
    .from('dm_calendar_invites')
    .upsert({
      recipient_discord_id: recipientDiscordId,
      calendar_id: calendarId,
      sender_user_id: senderUserId !== 'unknown' ? senderUserId : null,
      status: 'subscribed',
      cm_user_id: linked?.user_id ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'recipient_discord_id,calendar_id' })

  // Also write to dm_opt_ins for backward compatibility
  await supabase
    .from('dm_opt_ins')
    .upsert({
      recipient_discord_id: recipientDiscordId,
      sender_user_id: senderUserId !== 'unknown' ? senderUserId : null,
      calendar_id: calendarId || null,
    }, { onConflict: 'recipient_discord_id,COALESCE(sender_user_id,\'00000000-0000-0000-0000-000000000000\'),COALESCE(calendar_id,\'00000000-0000-0000-0000-000000000000\')' })

  // Remove any opt-out for this sender (so DMs can flow)
  if (senderUserId !== 'unknown') {
    await supabase
      .from('dm_opt_outs')
      .delete()
      .eq('recipient_discord_id', recipientDiscordId)
      .eq('sender_user_id', senderUserId)
  }

  // Update the most recent delivery log entry so the responses tab reflects the change
  if (calendarId) {
    const { data: recentSchedules } = await supabase
      .from('announcement_schedules')
      .select('id')
      .eq('calendar_id', calendarId)
      .in('status', ['sent', 'partially_sent'])
      .order('scheduled_at', { ascending: false })
      .limit(5)

    if (recentSchedules && recentSchedules.length > 0) {
      const scheduleIds = recentSchedules.map((s: { id: string }) => s.id)
      // Update matching delivery log entries for this recipient
      await supabase
        .from('announcement_delivery_log')
        .update({ recipient_response: 'subscribed' })
        .eq('target_id', recipientDiscordId)
        .eq('channel_type', 'discord_dm')
        .in('schedule_id', scheduleIds)
    }
  }

  return { success: true, action: 'subscribed' }
}

export async function handleUnsubscribe(
  supabase: SupabaseClient,
  recipientDiscordId: string,
  senderUserId: string,
  calendarId: string,
): Promise<ButtonResult> {
  // Update calendar invite status to 'unsubscribed'
  if (calendarId) {
    const { data: invite } = await supabase
      .from('dm_calendar_invites')
      .update({ status: 'unsubscribed', updated_at: new Date().toISOString() })
      .eq('recipient_discord_id', recipientDiscordId)
      .eq('calendar_id', calendarId)
      .select('cm_user_id')
      .maybeSingle()

    // Resolve the CM user ID from the invite or from discord_integrations
    let cmUserId = invite?.cm_user_id
    if (!cmUserId) {
      const { data: linked } = await supabase
        .from('discord_integrations')
        .select('user_id')
        .eq('discord_user_id', recipientDiscordId)
        .eq('is_active', true)
        .maybeSingle()
      cmUserId = linked?.user_id ?? null
    }

    // Also remove from web calendar_subscriptions so the frontend stays in sync
    if (cmUserId) {
      await supabase
        .from('calendar_subscriptions')
        .delete()
        .eq('user_id', cmUserId)
        .eq('calendar_id', calendarId)
    }
  }

  // Also remove from dm_opt_ins for backward compatibility
  let deleteQuery = supabase
    .from('dm_opt_ins')
    .delete()
    .eq('recipient_discord_id', recipientDiscordId)

  if (calendarId) {
    deleteQuery = deleteQuery.eq('calendar_id', calendarId)
  }
  if (senderUserId && senderUserId !== 'unknown') {
    deleteQuery = deleteQuery.eq('sender_user_id', senderUserId)
  }
  await deleteQuery

  // Update recent delivery log entries so the responses tab reflects the change
  if (calendarId) {
    const { data: recentSchedules } = await supabase
      .from('announcement_schedules')
      .select('id')
      .eq('calendar_id', calendarId)
      .in('status', ['sent', 'partially_sent'])
      .order('scheduled_at', { ascending: false })
      .limit(5)

    if (recentSchedules && recentSchedules.length > 0) {
      const scheduleIds = recentSchedules.map((s: { id: string }) => s.id)
      await supabase
        .from('announcement_delivery_log')
        .update({ recipient_response: 'unsubscribed' })
        .eq('target_id', recipientDiscordId)
        .eq('channel_type', 'discord_dm')
        .in('schedule_id', scheduleIds)
    }
  }

  return { success: true, action: 'unsubscribed' }
}

export async function handleOptOut(
  supabase: SupabaseClient,
  recipientDiscordId: string,
  senderUserId: string,
): Promise<ButtonResult> {
  // Update ALL calendar invite statuses from this sender to 'opted_out'
  if (senderUserId && senderUserId !== 'unknown') {
    await supabase
      .from('dm_calendar_invites')
      .update({ status: 'opted_out', updated_at: new Date().toISOString() })
      .eq('recipient_discord_id', recipientDiscordId)
      .eq('sender_user_id', senderUserId)

    await supabase
      .from('dm_opt_outs')
      .insert({
        recipient_discord_id: recipientDiscordId,
        sender_user_id: senderUserId,
        reason: 'button_opt_out',
      })

    await supabase
      .from('dm_opt_ins')
      .delete()
      .eq('recipient_discord_id', recipientDiscordId)
      .eq('sender_user_id', senderUserId)
  } else {
    // No sender known -- opt out globally
    await supabase
      .from('dm_calendar_invites')
      .update({ status: 'opted_out', updated_at: new Date().toISOString() })
      .eq('recipient_discord_id', recipientDiscordId)

    await supabase
      .from('dm_opt_outs')
      .insert({
        recipient_discord_id: recipientDiscordId,
        sender_user_id: null,
        reason: 'button_opt_out',
      })

    await supabase
      .from('dm_opt_ins')
      .delete()
      .eq('recipient_discord_id', recipientDiscordId)
  }

  return { success: true, action: 'opted_out' }
}
