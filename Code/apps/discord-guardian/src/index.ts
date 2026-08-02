import {
  Client,
  Events,
  GatewayIntentBits,
  Message,
  PartialMessage,
  MessageReaction,
  PartialMessageReaction,
  User,
  PartialUser,
  ChannelType,
  Partials,
  EmbedBuilder,
  TextChannel,
  NewsChannel,
  ThreadChannel,
} from 'discord.js'
import { supabase } from './supabase.js'
import {
  isLeader,
  startInstanceLock,
  releaseInstanceLock,
  INSTANCE_LABEL,
  INSTANCE_ID,
} from './instance-lock.js'
import {
  REACTION_EMOJIS,
  REACTION_LABELS,
  EMOJI_TO_KIND,
  compilePattern,
  scanText,
  type CompiledRule,
  type MatchResult,
  type ReactionKind,
  type ActionKind,
} from './rule-engine.js'

// ─── Types ────────────────────────────────────────────────────────────

interface RuleGroup {
  id: string
  name: string
  is_enabled: boolean
  action_delete_message: boolean
  action_timeout_member: boolean
  action_timeout_duration: number
  action_ban_member: boolean
}

// Set of ignored role IDs (guild_id:role_id) — loaded from DB
let ignoredRoleKeys: Set<string> = new Set()
let lastIgnoredRolesRefresh = 0
const IGNORED_ROLES_REFRESH_INTERVAL = 60_000 // 60 seconds

// Set of disabled channel keys (guild_id:channel_id) — loaded from DB
let disabledChannelKeys: Set<string> = new Set()
let lastDisabledChannelsRefresh = 0
const DISABLED_CHANNELS_REFRESH_INTERVAL = 60_000 // 60 seconds

// Per-guild notification config (actions log + user feedback channel) — loaded from DB
interface GuildNotificationConfig {
  actionsLogChannelId: string | null
  userFeedbackChannelId: string | null
}
let guildNotificationConfig: Map<string, GuildNotificationConfig> = new Map()
let lastNotificationConfigRefresh = 0
const NOTIFICATION_CONFIG_REFRESH_INTERVAL = 60_000 // 60 seconds

// Best-effort in-memory dedupe for rapid duplicate gateway events.
const FEEDBACK_DEDUPE_WINDOW_MS = 30_000
const recentFeedbackNotificationKeys: Map<string, number> = new Map()

// ─── Rule Engine ──────────────────────────────────────────────────────

let compiledRules: CompiledRule[] = []
let lastRulesRefresh = 0
const RULES_REFRESH_INTERVAL = 30_000 // Refresh rules from DB every 30 seconds

// Delay between the user DM (with reactions) and the actual ban call.
// Discord can silently strip reactions on a DM if the bot loses its only
// mutual guild with the user while reactions are still settling. 2.5s is
// well within Discord's reaction-rate budget and gives the gateway enough
// time to flush before the ban takes effect.
const BAN_DELAY_AFTER_DM_MS = 2500

/**
 * Load rules from the database and compile them into RegExp objects.
 */
async function refreshRules(): Promise<void> {
  try {
    const { data: groups, error: groupsError } = await supabase
      .from('guardian_rule_groups')
      .select('id, name, is_enabled, action_delete_message, action_timeout_member, action_timeout_duration, action_ban_member')
      .eq('is_enabled', true)

    if (groupsError) {
      console.error('Failed to load rule groups:', groupsError.message)
      return
    }

    if (!groups || groups.length === 0) {
      compiledRules = []
      return
    }

    const groupMap = new Map<string, RuleGroup>()
    for (const g of groups) {
      groupMap.set(g.id, g)
    }

    const { data: rules, error: rulesError } = await supabase
      .from('guardian_rules')
      .select('id, group_id, pattern, pattern_type, is_enabled')
      .eq('is_enabled', true)
      .in('group_id', groups.map(g => g.id))

    if (rulesError) {
      console.error('Failed to load rules:', rulesError.message)
      return
    }

    const newCompiled: CompiledRule[] = []
    for (const rule of rules || []) {
      const group = groupMap.get(rule.group_id)
      if (!group) continue

      const regex = compilePattern(rule.pattern, rule.pattern_type)
      if (!regex) continue

      newCompiled.push({
        id: rule.id,
        groupId: rule.group_id,
        groupName: group.name,
        regex,
        originalPattern: rule.pattern,
        actionDeleteMessage: !!group.action_delete_message,
        actionTimeoutMember: !!group.action_timeout_member,
        actionTimeoutDuration: group.action_timeout_duration || 60,
        actionBanMember: !!group.action_ban_member,
      })
    }

    const prevCount = compiledRules.length
    compiledRules = newCompiled
    lastRulesRefresh = Date.now()
    // Only log when rule count changes or on first load
    if (newCompiled.length !== prevCount || prevCount === 0) {
      console.log(`Loaded ${compiledRules.length} rules from ${groups.length} groups`)
    }
  } catch (err) {
    console.error('Error refreshing rules:', err)
  }
}

/**
 * Ensure rules are fresh (reload if stale).
 */
async function ensureRules(): Promise<CompiledRule[]> {
  if (Date.now() - lastRulesRefresh > RULES_REFRESH_INTERVAL) {
    await refreshRules()
  }
  return compiledRules
}

/**
 * Load ignored roles from DB.
 */
async function refreshIgnoredRoles(): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('guardian_server_roles')
      .select('guild_id, role_id')
      .eq('is_ignored', true)

    if (error) {
      console.error('Failed to load ignored roles:', error.message)
      return
    }

    ignoredRoleKeys = new Set(
      (data || []).map(r => `${r.guild_id}:${r.role_id}`)
    )
    lastIgnoredRolesRefresh = Date.now()
  } catch (err) {
    console.error('Error refreshing ignored roles:', err)
  }
}

async function ensureIgnoredRoles(): Promise<Set<string>> {
  if (Date.now() - lastIgnoredRolesRefresh > IGNORED_ROLES_REFRESH_INTERVAL) {
    await refreshIgnoredRoles()
  }
  return ignoredRoleKeys
}

/**
 * Load disabled channels from DB.
 */
async function refreshDisabledChannels(): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('guardian_server_channels')
      .select('guild_id, channel_id')
      .eq('is_monitored', false)

    if (error) {
      console.error('Failed to load disabled channels:', error.message)
      return
    }

    disabledChannelKeys = new Set(
      (data || []).map(c => `${c.guild_id}:${c.channel_id}`)
    )
    lastDisabledChannelsRefresh = Date.now()
  } catch (err) {
    console.error('Error refreshing disabled channels:', err)
  }
}

async function ensureDisabledChannels(): Promise<Set<string>> {
  if (Date.now() - lastDisabledChannelsRefresh > DISABLED_CHANNELS_REFRESH_INTERVAL) {
    await refreshDisabledChannels()
  }
  return disabledChannelKeys
}

/**
 * Load per-guild notification channel config (actions log + user feedback).
 */
async function refreshNotificationConfig(): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('guardian_bot_config')
      .select('guild_id, actions_log_channel_id, user_feedback_channel_id')

    if (error) {
      console.error('Failed to load notification config:', error.message)
      return
    }

    const next = new Map<string, GuildNotificationConfig>()
    for (const row of data || []) {
      next.set(row.guild_id, {
        actionsLogChannelId: row.actions_log_channel_id || null,
        userFeedbackChannelId: row.user_feedback_channel_id || null,
      })
    }
    guildNotificationConfig = next
    lastNotificationConfigRefresh = Date.now()
  } catch (err) {
    console.error('Error refreshing notification config:', err)
  }
}

async function ensureNotificationConfig(): Promise<void> {
  if (Date.now() - lastNotificationConfigRefresh > NOTIFICATION_CONFIG_REFRESH_INTERVAL) {
    await refreshNotificationConfig()
  }
}

function getNotificationConfig(guildId: string): GuildNotificationConfig {
  return guildNotificationConfig.get(guildId) || { actionsLogChannelId: null, userFeedbackChannelId: null }
}

/**
 * Check if a channel is disabled for monitoring.
 */
function isChannelDisabled(guildId: string, channelId: string): boolean {
  return disabledChannelKeys.has(`${guildId}:${channelId}`)
}

function getMonitoringChannelId(message: Message): string {
  if (message.channel.isThread() && message.channel.parentId) {
    // Thread messages (including forum posts) inherit monitoring setting
    // from their parent channel to avoid per-thread configuration drift.
    return message.channel.parentId
  }
  return message.channelId
}

/**
 * Check if a member has any ignored role in their guild.
 */
function hasIgnoredRole(message: Message): boolean {
  if (!message.member || !message.guildId) return false
  for (const [roleId] of message.member.roles.cache) {
    if (ignoredRoleKeys.has(`${message.guildId}:${roleId}`)) return true
  }
  return false
}

/**
 * Sync all guild channels to the database for the Channel Settings UI.
 */
async function syncGuildChannels(client: Client): Promise<void> {
  try {
    for (const [, guild] of client.guilds.cache) {
      const channels = await guild.channels.fetch()
      const activeThreads = await guild.channels.fetchActiveThreads()

      const supportedBaseTypes = new Set<number>([
        ChannelType.GuildText,
        ChannelType.GuildAnnouncement,
        ChannelType.GuildForum,
        ChannelType.GuildVoice,
        ChannelType.GuildStageVoice,
      ])

      const supportedThreadTypes = new Set<number>([
        ChannelType.PublicThread,
        ChannelType.PrivateThread,
        ChannelType.AnnouncementThread,
      ])

      const channelRows = channels
        .filter(c => c !== null && supportedBaseTypes.has(c.type))
        .map(c => ({
          guild_id: guild.id,
          guild_name: guild.name,
          channel_id: c!.id,
          channel_name: c!.name,
          channel_type: c!.type,
          synced_at: new Date().toISOString(),
        }))

      const threadRows = activeThreads.threads
        .filter(t => supportedThreadTypes.has(t.type))
        .map(t => ({
          guild_id: guild.id,
          guild_name: guild.name,
          channel_id: t.id,
          channel_name: t.name,
          channel_type: t.type,
          synced_at: new Date().toISOString(),
        }))

      const mergedById = new Map<
        string,
        (typeof channelRows)[number] | (typeof threadRows)[number]
      >()
      for (const row of [...channelRows, ...threadRows]) {
        mergedById.set(row.channel_id, row)
      }

      const allChannelRows = Array.from(mergedById.values())

      if (allChannelRows.length === 0) continue

      const { error } = await supabase
        .from('guardian_server_channels')
        .upsert(allChannelRows, { onConflict: 'guild_id,channel_id' })

      if (error) {
        console.error(`Failed to sync channels for guild ${guild.name}:`, error.message)
      } else {
        console.log(`Synced ${allChannelRows.length} channels for guild "${guild.name}"`)
      }
    }
  } catch (err) {
    console.error('Error syncing guild channels:', err)
  }
}

/**
 * Sync all guild roles to the database for the Server Settings UI.
 */
async function syncGuildRoles(client: Client): Promise<void> {
  try {
    for (const [, guild] of client.guilds.cache) {
      // Fetch full role list from Discord
      const roles = await guild.roles.fetch()
      const roleRows = roles
        .filter(r => !r.managed && r.id !== guild.id) // skip @everyone and bot-managed
        .map(r => ({
          guild_id: guild.id,
          guild_name: guild.name,
          role_id: r.id,
          role_name: r.name,
          role_color: r.color,
          role_position: r.position,
          synced_at: new Date().toISOString(),
        }))

      if (roleRows.length === 0) continue

      const { error } = await supabase
        .from('guardian_server_roles')
        .upsert(roleRows, { onConflict: 'guild_id,role_id' })

      if (error) {
        console.error(`Failed to sync roles for guild ${guild.name}:`, error.message)
      } else {
        console.log(`Synced ${roleRows.length} roles for guild "${guild.name}"`)
      }
    }
  } catch (err) {
    console.error('Error syncing guild roles:', err)
  }
}

/**
 * Classify a message for the dashboard: what kind of content it has.
 */
function classifyMessage(message: Message): {
  messageType: string
  hasAttachments: boolean
  hasEmbeds: boolean
  attachmentTypes: string | null
  contentPreview: string
} {
  const hasAttachments = message.attachments.size > 0
  const hasEmbeds = message.embeds.length > 0
  const hasContent = !!message.content && message.content.trim().length > 0
  const hasStickers = message.stickers?.size > 0
  const isSystem = message.system

  // Build attachment types string
  const attachmentTypes = hasAttachments
    ? [...message.attachments.values()].map(a => {
        if (a.contentType?.startsWith('image/')) return 'image'
        if (a.contentType?.startsWith('video/')) return 'video'
        if (a.contentType?.startsWith('audio/')) return 'audio'
        return 'file'
      }).join(', ')
    : null

  // Determine message type
  let messageType = 'text'
  if (isSystem) {
    messageType = 'system'
  } else if (hasStickers) {
    messageType = 'sticker'
  } else if (hasContent && (hasAttachments || hasEmbeds)) {
    messageType = 'mixed'
  } else if (!hasContent && hasAttachments) {
    messageType = 'attachment'
  } else if (!hasContent && hasEmbeds) {
    messageType = 'embed'
  }

  // Store full message content (Discord max 4000 chars w/ nitro boost).
  // Column is TEXT so length is not a concern; the dashboard collapses long
  // rows visually and expands on click.
  let contentPreview = message.content?.slice(0, 4000) || ''
  if (!contentPreview && isSystem) {
    const systemLabel: Record<number, string> = {
      7: 'Member joined',
      8: 'Server boost',
      9: 'Server boost (Tier 1)',
      10: 'Server boost (Tier 2)',
      11: 'Server boost (Tier 3)',
      12: 'Channel follow added',
      18: 'Thread created',
      19: 'Reply',
      20: 'Slash command',
      21: 'Thread starter',
      23: 'Context menu command',
      24: 'Auto Moderation action',
      25: 'Role subscription purchased',
      27: 'Stage started',
      28: 'Stage ended',
      29: 'Stage speaker',
    }
    contentPreview = `[System: ${systemLabel[message.type] ?? `type ${message.type}`}]`
  } else if (!contentPreview && hasAttachments) {
    const names = [...message.attachments.values()].map(a => a.name).join(', ')
    contentPreview = `[Attachment: ${attachmentTypes} - ${names}]`
  } else if (!contentPreview && hasEmbeds) {
    const embedInfo = message.embeds.map(e => e.title || e.url || e.description?.slice(0, 50) || 'embed').join(', ')
    contentPreview = `[Embed: ${embedInfo}]`
  } else if (!contentPreview && hasStickers) {
    const stickerNames = [...(message.stickers?.values() || [])].map(s => s.name).join(', ')
    contentPreview = `[Sticker: ${stickerNames}]`
  }

  return { messageType, hasAttachments, hasEmbeds, attachmentTypes, contentPreview }
}

// ─── Message Scanning ─────────────────────────────────────────────────
// Pure scanning helpers (wildcardToRegex, deobfuscate, scanText, etc.)
// live in rule-engine.ts so they can be unit-tested. This file only owns
// the I/O wrappers that need Discord types.

/**
 * Extract all scannable text from a message (including referenced/forwarded/embed content).
 * Scans each source independently and returns the first match.
 */
async function scanMessage(message: Message, rules: CompiledRule[]): Promise<MatchResult | null> {
  const guildId = message.guildId || undefined

  // Forum post titles live on the thread name, not the message body.
  // Only scan the title on the starter message to avoid penalising replies.
  const isForumStarter =
    message.channel.isThread() &&
    message.channel.parent?.type === ChannelType.GuildForum &&
    message.id === message.channel.id

  if (isForumStarter) {
    const forumTitle = message.channel.name?.trim() || ''
    if (forumTitle) {
      const titleMatch = scanText(forumTitle, rules, 'direct', guildId)
      if (titleMatch) return titleMatch

      // Also scan title + body together in case obfuscation is split.
      const combined = `${forumTitle}\n${message.content || ''}`.trim()
      if (combined && combined !== forumTitle) {
        const combinedMatch = scanText(combined, rules, 'direct', guildId)
        if (combinedMatch) return combinedMatch
      }
    }
  }

  // 1. Scan direct message content
  const directMatch = scanText(message.content, rules, 'direct', guildId)
  if (directMatch) return directMatch

  // 2. Reply/referenced message content is intentionally NOT scanned.
  //    A user replying to a message containing a forbidden link should not
  //    inherit the violation from the parent message they are quoting.

  // 3. Scan forwarded message snapshots
  if (message.messageSnapshots && message.messageSnapshots.size > 0) {
    for (const [, snapshot] of message.messageSnapshots) {
      // MessageSnapshot has a partial message structure
      const snapshotMsg = snapshot as unknown as { content?: string; embeds?: Array<{ title?: string; description?: string; url?: string }> }
      if (snapshotMsg.content) {
        const forwardMatch = scanText(snapshotMsg.content, rules, 'forward', guildId)
        if (forwardMatch) return forwardMatch
      }
      if (snapshotMsg.embeds) {
        for (const embed of snapshotMsg.embeds) {
          const embedText = [embed.title, embed.description, embed.url].filter(Boolean).join(' ')
          const forwardEmbedMatch = scanText(embedText, rules, 'forward', guildId)
          if (forwardEmbedMatch) return forwardEmbedMatch
        }
      }
    }
  }

  // 4. Scan embeds on the message itself (including link embeds from Discord URLs)
  for (const embed of message.embeds) {
    const embedText = [
      embed.title,
      embed.description,
      embed.url,
      embed.author?.name,
      embed.author?.url,
      embed.footer?.text,
      embed.provider?.name,
      embed.provider?.url,
      embed.image?.url,
      embed.thumbnail?.url,
      embed.video?.url,
      ...(embed.fields?.map(f => `${f.name} ${f.value}`) || []),
    ].filter(Boolean).join(' ')

    const embedMatch = scanText(embedText, rules, 'embed', guildId)
    if (embedMatch) return embedMatch
  }

  // 5. Scan attachment URLs (some links appear only as attachments)
  for (const [, attachment] of message.attachments) {
    const attachMatch = scanText(attachment.url, rules, 'embed', guildId)
    if (attachMatch) return attachMatch
    if (attachment.name) {
      const nameMatch = scanText(attachment.name, rules, 'embed', guildId)
      if (nameMatch) return nameMatch
    }
  }

  return null
}

// ─── Database Logging ─────────────────────────────────────────────────

async function logMessage(message: Message, wasFlagged: boolean): Promise<void> {
  try {
    const { messageType, hasAttachments, hasEmbeds, attachmentTypes, contentPreview } = classifyMessage(message)
    const channel = message.channel
    const channelName = channel.type !== ChannelType.DM && 'name' in channel ? (channel as { name: string }).name : null

    // If a row already exists for this message_id (e.g. duplicate MessageCreate
    // delivery after a gateway resume), bump the version instead of writing
    // another v1 so the dashboard shows them as related versions.
    const { data: existing } = await supabase
      .from('guardian_message_log')
      .select('edit_version')
      .eq('message_id', message.id)
      .order('edit_version', { ascending: false })
      .limit(1)
    const priorVersion = existing?.[0]?.edit_version || 0
    const nextVersion = priorVersion + 1
    const isEdit = priorVersion > 0

    const { error } = await supabase.from('guardian_message_log').insert({
      guild_id: message.guildId || '',
      guild_name: message.guild?.name || null,
      channel_id: message.channelId,
      channel_name: channelName,
      message_id: message.id,
      author_id: message.author.id,
      author_username: message.author.username,
      content_preview: contentPreview,
      was_flagged: wasFlagged,
      scanned_at: new Date().toISOString(),
      message_type: messageType,
      has_attachments: hasAttachments,
      has_embeds: hasEmbeds,
      attachment_types: attachmentTypes,
      edit_version: nextVersion,
      is_edit: isEdit,
    })
    if (error) {
      console.error(
        'Failed to log message to DB:',
        error.message,
        error.details,
        {
          messageId: message.id,
          guildId: message.guildId,
          channelId: message.channelId,
          channelType: message.channel.type,
          isThread: message.channel.isThread(),
          parentId: message.channel.isThread() ? message.channel.parentId : null,
        }
      )
    }
  } catch (err) {
    console.error('Failed to log message:', err)
  }
}

async function logMessageEdit(message: Message, wasFlagged: boolean): Promise<void> {
  try {
    const { messageType, hasAttachments, hasEmbeds, attachmentTypes, contentPreview } = classifyMessage(message)
    const channel = message.channel
    const channelName = channel.type !== ChannelType.DM && 'name' in channel ? (channel as { name: string }).name : null

    // Get current max version for this message_id
    const { data: existing } = await supabase
      .from('guardian_message_log')
      .select('edit_version')
      .eq('message_id', message.id)
      .order('edit_version', { ascending: false })
      .limit(1)

    const nextVersion = (existing?.[0]?.edit_version || 0) + 1

    const { error } = await supabase.from('guardian_message_log').insert({
      guild_id: message.guildId || '',
      guild_name: message.guild?.name || null,
      channel_id: message.channelId,
      channel_name: channelName,
      message_id: message.id,
      author_id: message.author.id,
      author_username: message.author.username,
      content_preview: contentPreview,
      was_flagged: wasFlagged,
      scanned_at: new Date().toISOString(),
      message_type: messageType,
      has_attachments: hasAttachments,
      has_embeds: hasEmbeds,
      attachment_types: attachmentTypes,
      edit_version: nextVersion,
      is_edit: true,
    })
    if (error) {
      console.error(
        'Failed to log message edit to DB:',
        error.message,
        error.details,
        {
          messageId: message.id,
          guildId: message.guildId,
          channelId: message.channelId,
          channelType: message.channel.type,
          isThread: message.channel.isThread(),
          parentId: message.channel.isThread() ? message.channel.parentId : null,
        }
      )
    }
  } catch (err) {
    console.error('Failed to log message edit:', err)
  }
}

async function logFlaggedMessage(message: Message, match: MatchResult, isEdit = false, actionsTaken = 'flagged'): Promise<void> {
  try {
    // Get referenced content for storage
    let referencedContent: string | null = null
    if (match.sourceType === 'reply' && message.reference) {
      try {
        const ref = await message.fetchReference()
        referencedContent = ref?.content || null
      } catch { /* already handled */ }
    }

    const channel = message.channel
    const channelName = channel.type !== ChannelType.DM && 'name' in channel ? channel.name : 'DM'

    // Always check existing rows for this message_id and use the next version
    // number, regardless of whether Discord delivered a MessageUpdate. This
    // collapses duplicate MessageCreate deliveries (e.g. gateway resumes) into
    // a coherent version chain rather than multiple v1 rows.
    const { data: existing } = await supabase
      .from('guardian_flagged_messages')
      .select('edit_version')
      .eq('message_id', message.id)
      .order('edit_version', { ascending: false })
      .limit(1)
    const priorVersion = existing?.[0]?.edit_version || 0
    const editVersion = priorVersion + 1
    const effectiveIsEdit = isEdit || priorVersion > 0

    const { error } = await supabase.from('guardian_flagged_messages').insert({
      guild_id: message.guildId || '',
      guild_name: message.guild?.name || null,
      channel_id: message.channelId,
      channel_name: channelName,
      message_id: message.id,
      author_id: message.author.id,
      author_username: message.author.username,
      author_display_name: message.member?.displayName || message.author.displayName,
      content: message.content,
      referenced_content: referencedContent,
      matched_rule_id: match.rule.id,
      matched_rule_group_id: match.rule.groupId,
      matched_rule_group_name: match.rule.groupName,
      matched_pattern: match.rule.originalPattern,
      matched_text: match.matchedText,
      source_type: match.sourceType,
      action_taken: actionsTaken,
      flagged_at: new Date().toISOString(),
      edit_version: editVersion,
      is_edit: effectiveIsEdit,
    })
    if (error) {
      console.error(
        'Failed to log flagged message to DB:',
        error.message,
        error.details,
        {
          messageId: message.id,
          guildId: message.guildId,
          channelId: message.channelId,
          channelType: message.channel.type,
          isThread: message.channel.isThread(),
          parentId: message.channel.isThread() ? message.channel.parentId : null,
          matchedRuleGroupId: match.rule.groupId,
        }
      )
    }
  } catch (err) {
    console.error('Failed to log flagged message:', err)
  }
}

// ─── Periodic Cleanup ─────────────────────────────────────────────────

async function cleanupOldLogs(): Promise<void> {
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

  try {
    await supabase
      .from('guardian_message_log')
      .delete()
      .lt('scanned_at', sevenDaysAgo.toISOString())

    console.log('Cleaned up message logs older than 7 days')
  } catch (err) {
    console.error('Failed to cleanup old logs:', err)
  }
}

// ─── Execute Configured Actions ───────────────────────────────────────

interface ActionResult {
  actionsTaken: string
  deleted: boolean
  timedOut: boolean
  banned: boolean
}

/**
 * Insert one row per moderation action into guardian_action_log.
 * Best-effort: failures are logged but never break the moderation flow.
 */
async function recordActionLog(
  message: Message,
  match: MatchResult,
  action: ActionKind,
  extras: { durationSeconds?: number; success?: boolean; failureReason?: string } = {},
): Promise<void> {
  try {
    const channel = message.channel
    const channelName = channel.type !== ChannelType.DM && 'name' in channel
      ? (channel as { name: string }).name
      : null
    const { error } = await supabase.from('guardian_action_log').insert({
      action,
      matched_rule_id: match.rule.id,
      matched_rule_group_id: match.rule.groupId,
      matched_rule_group_name: match.rule.groupName,
      matched_pattern: match.rule.originalPattern,
      matched_text: match.matchedText,
      source_type: match.sourceType,
      guild_id: message.guildId || '',
      guild_name: message.guild?.name || null,
      channel_id: message.channelId,
      channel_name: channelName,
      message_id: message.id,
      author_id: message.author.id,
      author_username: message.author.username,
      duration_seconds: extras.durationSeconds ?? null,
      actor_kind: 'bot',
      success: extras.success ?? true,
      failure_reason: extras.failureReason ?? null,
    })
    if (error) console.error('Failed to write action log:', error.message)
  } catch (err) {
    console.error('Failed to write action log:', err)
  }
}

/**
 * Execute delete + timeout actions. Ban is deliberately split out into
 * `executeBan` so the user DM can be sent BEFORE the ban -- once a user is
 * banned, Discord may refuse subsequent DMs (the bot no longer shares a
 * mutual guild with them in some cases, and the user cannot reply back via
 * reactions in DM either way if they cannot see the bot). Sending the DM
 * first guarantees the user receives the explanation and the reaction prompt
 * to dispute the action.
 */
async function executeActions(message: Message, match: MatchResult): Promise<ActionResult> {
  const { rule } = match
  const actions: string[] = ['flagged']
  let deleted = false
  let timedOut = false

  // Always record the flag itself
  await recordActionLog(message, match, 'flag')

  // Delete the flagged message
  if (rule.actionDeleteMessage) {
    try {
      await message.delete()
      actions.push('deleted')
      deleted = true
      console.log(`[action] Deleted message ${message.id} by ${message.author.username}`)
      await recordActionLog(message, match, 'delete', { success: true })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.error(
        `[action] FAILED to delete message ${message.id} by ${message.author.username} ` +
        `in #${'name' in message.channel ? (message.channel as { name: string }).name : message.channelId}: ${reason}\n` +
        `       --> Demon X likely lacks the "Manage Messages" permission in this channel. ` +
        `Grant it via Server Settings -> Roles -> Demon X, or via the channel-level permission overrides.`
      )
      await recordActionLog(message, match, 'delete', { success: false, failureReason: reason.slice(0, 200) })
    }
  }

  // Timeout the member
  if (rule.actionTimeoutMember && message.member) {
    const durationSec = rule.actionTimeoutDuration || 60
    try {
      await message.member.timeout(durationSec * 1000, `Guardian auto-timeout: matched rule group "${rule.groupName}"`)
      actions.push('timeout')
      timedOut = true
      console.log(`[action] Timed out ${message.author.username} for ${durationSec}s`)
      await recordActionLog(message, match, 'mute', { durationSeconds: durationSec, success: true })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.error(`[action] Failed to timeout ${message.author.username}:`, err)
      await recordActionLog(message, match, 'mute', { durationSeconds: durationSec, success: false, failureReason: reason.slice(0, 200) })
    }
  }

  // NOTE: Ban is NOT performed here -- it runs in `executeBan` after the DM
  // has been delivered. We still mark the action as `banned` in the returned
  // actionsTaken string if the rule intends to ban, so downstream logging
  // and the DM reflect the intended outcome.
  const willBan = !!(rule.actionBanMember && message.member)
  if (willBan) actions.push('banned')

  return { actionsTaken: actions.join(','), deleted, timedOut, banned: willBan }
}

/**
 * Execute the ban AFTER the user-facing DM has been sent. Returns whether
 * the ban actually succeeded -- callers may want to amend the actions-log
 * embed colour / final summary if Discord rejects the ban.
 *
 * A short delay is applied before the ban so Discord has time to persist
 * the DM message and its reactions. Without this delay we have observed
 * Discord stripping the bot's DM reactions when the ban removes the only
 * mutual guild between the bot and the user while reactions are still
 * settling server-side.
 */
async function executeBan(message: Message, match: MatchResult): Promise<boolean> {
  if (!message.member) return false
  await new Promise((resolve) => setTimeout(resolve, BAN_DELAY_AFTER_DM_MS))
  try {
    await message.member.ban({ reason: `Guardian auto-ban: matched rule group "${match.rule.groupName}"` })
    console.log(`[action] Banned ${message.author.username} from ${message.guild?.name}`)
    await recordActionLog(message, match, 'ban', { success: true })
    return true
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error(`[action] Failed to ban ${message.author.username}:`, err)
    await recordActionLog(message, match, 'ban', { success: false, failureReason: reason.slice(0, 200) })
    return false
  }
}

// ─── Deletion / DM / Channel-Notice Helpers ───────────────────────────

async function markFlaggedDeleted(
  messageId: string,
  kind: 'bot' | 'user' | 'moderator' | 'unknown',
): Promise<void> {
  try {
    await supabase
      .from('guardian_flagged_messages')
      .update({ deleted_at: new Date().toISOString(), deleted_by_kind: kind })
      .eq('message_id', messageId)
      .is('deleted_at', null)
  } catch (err) {
    console.error('Failed to mark flagged message as deleted:', err)
  }
}

async function markMessageLogDeleted(
  messageId: string,
  kind: 'bot' | 'user' | 'moderator' | 'unknown',
): Promise<void> {
  try {
    await supabase
      .from('guardian_message_log')
      .update({ deleted_at: new Date().toISOString(), deleted_by_kind: kind })
      .eq('message_id', messageId)
      .is('deleted_at', null)
  } catch (err) {
    console.error('Failed to mark message_log as deleted:', err)
  }
}

function truncateForEmbed(text: string | null | undefined, max = 1900): string {
  if (!text) return '(no text content)'
  return text.length <= max ? text : text.slice(0, max - 3) + '...'
}

function normaliseContentForCompare(text: string | null | undefined): string {
  if (!text) return ''
  return text.replace(/\s+/g, ' ').trim()
}

function splitTextForDiscord(text: string, maxLen: number): string[] {
  if (!text) return ['']
  const chunks: string[] = []
  let remaining = text

  while (remaining.length > maxLen) {
    const boundary = remaining.lastIndexOf('\n', maxLen)
    const splitAt = boundary > Math.floor(maxLen * 0.6) ? boundary + 1 : maxLen
    chunks.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt)
  }

  if (remaining.length > 0) chunks.push(remaining)
  return chunks
}

function buildResponseFieldValue(existingValue: string | undefined, nextLabel: string): string {
  const lines = (existingValue || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  const unique = new Set(lines)
  unique.add(nextLabel)
  return Array.from(unique).join('\n')
}

function shouldSuppressFeedbackDuplicate(key: string): boolean {
  const now = Date.now()
  for (const [k, ts] of recentFeedbackNotificationKeys) {
    if (now - ts > FEEDBACK_DEDUPE_WINDOW_MS) {
      recentFeedbackNotificationKeys.delete(k)
    }
  }

  const prior = recentFeedbackNotificationKeys.get(key)
  if (prior && now - prior <= FEEDBACK_DEDUPE_WINDOW_MS) {
    return true
  }

  recentFeedbackNotificationKeys.set(key, now)
  return false
}

async function sendOriginalContentContinuation(
  channel: TextChannel | NewsChannel | ThreadChannel,
  fullText: string | null,
  opts: {
    caseId: string
    userId: string
    heading: string
    initialCharsUsed: number
  },
): Promise<void> {
  if (!fullText) return

  const remainder = fullText.length > opts.initialCharsUsed
    ? fullText.slice(opts.initialCharsUsed)
    : ''
  if (!remainder) return

  const chunks = splitTextForDiscord(remainder, 1700)
  for (let i = 0; i < chunks.length; i += 1) {
    const part = i + 1
    const total = chunks.length
    await channel.send({
      content:
        `${opts.heading} (continuation ${part}/${total})\n` +
        `Case: ${opts.caseId}\n` +
        `User: <@${opts.userId}>\n` +
        `${chunks[i]}`,
      allowedMentions: { parse: [] },
    })
  }
}

async function getFlaggedRowId(messageId: string, isEdit: boolean): Promise<string | null> {
  const { data } = await supabase
    .from('guardian_flagged_messages')
    .select('id')
    .eq('message_id', messageId)
    .eq('is_edit', isEdit)
    .order('flagged_at', { ascending: false })
    .limit(1)
  return data?.[0]?.id || null
}

async function postChannelDeletionNotice(
  message: Message,
  match: MatchResult,
  flaggedRowId: string | null,
): Promise<void> {
  try {
    const channel = message.channel
    if (channel.type === ChannelType.DM) return
    if (!('send' in channel)) return

    const sent = await (channel as TextChannel | NewsChannel | ThreadChannel).send({
      content: `\uD83D\uDEE1\uFE0F Flagged and deleted incoming message from <@${message.author.id}> (rule group: **${match.rule.groupName}**). The message was sent privately back to the user; they can react to dispute or escalate.`,
      allowedMentions: { users: [], roles: [], parse: [] },
    })

    if (flaggedRowId && sent?.id) {
      await supabase
        .from('guardian_flagged_messages')
        .update({ channel_notice_message_id: sent.id })
        .eq('id', flaggedRowId)
    }
  } catch (err) {
    console.error('Failed to post channel deletion notice:', err)
  }
}

async function sendUserDeletionDM(
  message: Message,
  match: MatchResult,
  flaggedRowId: string | null,
  actions: ActionResult,
): Promise<{ dmMessageId: string | null; failureReason: string | null }> {
  try {
    const guildName = message.guild?.name || 'the server'
    const channelName = message.channel.type !== ChannelType.DM && 'name' in message.channel
      ? `#${(message.channel as { name: string }).name}`
      : 'a channel'

    const actionLines: string[] = []
    if (actions.deleted) actionLines.push('- Your message was **deleted**.')
    if (actions.timedOut) actionLines.push('- You were **temporarily muted** (timeout).')
    if (actions.banned) actionLines.push('- You have been **permanently banned** from the server.')
    if (actionLines.length === 0) actionLines.push('- Your message was **flagged** for moderator review.')

    // Banned users: send an informational-only DM. No reactions are added
    // because the user can no longer interact with this server through the
    // bot -- there is no in-bot appeal path, and once the ban lands the
    // bot may also lose the shared-guild context needed to receive
    // reactions reliably. Any review must be initiated by a moderator
    // manually unbanning.
    if (actions.banned) {
      const embed = new EmbedBuilder()
        .setColor(0xDC2626)
        .setTitle(`You were permanently banned from ${guildName}`)
        .setDescription(
          `Your message in ${channelName} matched the rule group **${match.rule.groupName}** ` +
          `and our automated system applied an immediate, permanent ban.\n\n` +
          `${actionLines.join('\n')}\n\n` +
          `**This ban is final from your side.** There is no appeal process through this bot, ` +
          `and reactions to this message will not be monitored. Only a server moderator can ` +
          `choose to lift the ban manually.\n\n` +
          `Your original text is preserved below for your reference.`,
        )
        .addFields(
          { name: 'Your original message', value: truncateForEmbed(message.content, 1000) },
          { name: 'Matched text', value: truncateForEmbed(match.matchedText, 200), inline: true },
          { name: 'Source', value: match.sourceType, inline: true },
        )
        .setTimestamp(new Date())

      const dm = await message.author.send({ embeds: [embed] })

      if (flaggedRowId) {
        await supabase
          .from('guardian_flagged_messages')
          .update({ dm_sent_at: new Date().toISOString(), dm_message_id: dm.id })
          .eq('id', flaggedRowId)
      }

      return { dmMessageId: dm.id, failureReason: null }
    }

    const embed = new EmbedBuilder()
      .setColor(0xE5A23B)
      .setTitle(`A message you sent was flagged in ${guildName}`)
      .setDescription(
        `Your message in ${channelName} matched the rule group **${match.rule.groupName}**.\n\n` +
        `${actionLines.join('\n')}\n\n` +
        `Your original text is preserved below so nothing is lost. ` +
        `If this was a mistake, please react to this message:\n\n` +
        `${REACTION_EMOJIS.false_flag} False flag (this was a mistake)\n` +
        `${REACTION_EMOJIS.republish} Please re-publish my message\n` +
        `${REACTION_EMOJIS.unmute} Please unmute me\n` +
        `${REACTION_EMOJIS.escalate} Urgent -- escalate to a moderator now\n\n` +
        `Moderators run **periodic checks** of bot actions, so even without a reaction your case will be reviewed eventually. ` +
        `Reactions help us prioritise your request.`,
      )
      .addFields(
        { name: 'Your original message', value: truncateForEmbed(message.content, 1000) },
        { name: 'Matched text', value: truncateForEmbed(match.matchedText, 200), inline: true },
        { name: 'Source', value: match.sourceType, inline: true },
      )
      .setTimestamp(new Date())

    const dm = await message.author.send({ embeds: [embed] })

    for (const emoji of [
      REACTION_EMOJIS.false_flag,
      REACTION_EMOJIS.republish,
      REACTION_EMOJIS.unmute,
      REACTION_EMOJIS.escalate,
    ]) {
      try {
        await dm.react(emoji)
      } catch (err) {
        console.warn(`Failed to add reaction ${emoji} to DM:`, err)
      }
    }

    if (flaggedRowId) {
      await supabase
        .from('guardian_flagged_messages')
        .update({ dm_sent_at: new Date().toISOString(), dm_message_id: dm.id })
        .eq('id', flaggedRowId)
    }

    return { dmMessageId: dm.id, failureReason: null }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.warn(`DM to ${message.author.username} failed:`, reason)
    if (flaggedRowId) {
      await supabase
        .from('guardian_flagged_messages')
        .update({ dm_failure_reason: reason.slice(0, 200) })
        .eq('id', flaggedRowId)
    }
    return { dmMessageId: null, failureReason: reason }
  }
}

async function notifyFeedbackChannel(
  client: Client,
  guildId: string,
  payload: {
    flaggedMessageId: string
    discordUserId: string
    username: string
    kind: ReactionKind
    flaggedContent: string | null
    matchedRuleGroup: string | null
    sourceChannelId: string | null
  },
): Promise<void> {
  const cfg = getNotificationConfig(guildId)
  const channelId = cfg.userFeedbackChannelId || cfg.actionsLogChannelId
  if (!channelId) return

  try {
    const channel = await client.channels.fetch(channelId)
    if (!channel || !('send' in channel) || channel.type === ChannelType.DM) return

    const textChannel = channel as TextChannel | NewsChannel | ThreadChannel
    const duplicateKey = `${guildId}:${payload.flaggedMessageId}:${payload.discordUserId}:${payload.kind}`
    if (shouldSuppressFeedbackDuplicate(duplicateKey)) {
      return
    }

    const caseId = payload.flaggedMessageId
    const responseLabel = `- ${REACTION_LABELS[payload.kind]}`
    const feedbackUsesActionsChannel = channelId === cfg.actionsLogChannelId

    if (feedbackUsesActionsChannel) {
      try {
        const recent = await textChannel.messages.fetch({ limit: 30 })
        const expectedContent = normaliseContentForCompare(payload.flaggedContent)
        const target = recent.find(msg => {
          if (msg.author.id !== client.user?.id) return false
          const firstEmbed = msg.embeds[0]
          if (!firstEmbed) return false
          if ((firstEmbed.title || '').toLowerCase().indexOf('guardian: moderation action') === -1) return false

          const footerText = firstEmbed.footer?.text || ''
          if (footerText.includes(`Case ID: ${caseId}`)) return true

          // Fallback match when older messages predate footer keys.
          const description = firstEmbed.description || ''
          const mentionsUser = description.includes(`<@${payload.discordUserId}>`)
          if (!mentionsUser) return false

          const contentField = firstEmbed.fields.find(f => f.name === 'Original content')
          if (!contentField) return false
          const postedContent = normaliseContentForCompare(contentField.value)
          return postedContent.length > 0 && postedContent === expectedContent
        })

        if (target && target.embeds[0]) {
          const existing = target.embeds[0]
          const merged = EmbedBuilder.from(existing)
          const fields = [...existing.fields]
          const responseFieldIdx = fields.findIndex(field => field.name === 'User responses')
          if (responseFieldIdx >= 0) {
            const nextValue = buildResponseFieldValue(fields[responseFieldIdx].value, responseLabel)
            fields[responseFieldIdx] = { ...fields[responseFieldIdx], value: nextValue }
          } else {
            fields.push({ name: 'User responses', value: responseLabel, inline: false })
          }

          merged.setFields(fields)
          merged.setTimestamp(new Date())
          await target.edit({ embeds: [merged], allowedMentions: { parse: [] } })
          return
        }
      } catch (err) {
        console.warn('Failed to merge feedback into moderation action message:', err)
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0x3B82F6)
      .setTitle('Guardian: user response received')
      .setDescription(
        `<@${payload.discordUserId}> (\`${payload.username}\`) reacted with **${REACTION_LABELS[payload.kind]}**.`,
      )
      .addFields(
        { name: 'Rule group', value: payload.matchedRuleGroup || 'unknown', inline: true },
        { name: 'Original channel', value: payload.sourceChannelId ? `<#${payload.sourceChannelId}>` : 'unknown', inline: true },
        { name: 'Flagged content', value: truncateForEmbed(payload.flaggedContent, 1000) },
      )
      .setFooter({ text: `Case ID: ${caseId}` })
      .setTimestamp(new Date())

    await textChannel.send({
      embeds: [embed],
      allowedMentions: { parse: [] },
    })

    await sendOriginalContentContinuation(textChannel, payload.flaggedContent, {
      caseId,
      userId: payload.discordUserId,
      heading: 'Guardian: user response content continuation',
      initialCharsUsed: 1000,
    })
  } catch (err) {
    console.error('Failed to post to user-feedback channel:', err)
  }
}

async function notifyActionsLog(
  client: Client,
  message: Message,
  match: MatchResult,
  actions: ActionResult,
  flaggedMessageId: string | null,
): Promise<void> {
  const cfg = getNotificationConfig(message.guildId!)
  if (!cfg.actionsLogChannelId) return

  try {
    const channel = await client.channels.fetch(cfg.actionsLogChannelId)
    if (!channel || !('send' in channel) || channel.type === ChannelType.DM) return

    const textChannel = channel as TextChannel | NewsChannel | ThreadChannel
    const caseId = flaggedMessageId || `msg:${message.id}`
    const originalContentHead = truncateForEmbed(message.content, 1000)

    const embed = new EmbedBuilder()
      .setColor(actions.banned ? 0xDC2626 : actions.timedOut ? 0xEAB308 : 0xE5A23B)
      .setTitle('Guardian: moderation action')
      .setDescription(`<@${message.author.id}> (\`${message.author.username}\`) in <#${message.channelId}>`)
      .addFields(
        { name: 'Rule group', value: match.rule.groupName, inline: true },
        { name: 'Source', value: match.sourceType, inline: true },
        { name: 'Actions', value: actions.actionsTaken, inline: true },
        { name: 'Matched text', value: truncateForEmbed(match.matchedText, 300) },
        { name: 'Original content', value: originalContentHead },
      )
      .setFooter({ text: `Case ID: ${caseId}` })
      .setTimestamp(new Date())

    await textChannel.send({
      embeds: [embed],
      allowedMentions: { parse: [] },
    })

    await sendOriginalContentContinuation(textChannel, message.content, {
      caseId,
      userId: message.author.id,
      heading: 'Guardian: original content continuation',
      initialCharsUsed: originalContentHead.length,
    })
  } catch (err) {
    console.error('Failed to post to actions-log channel:', err)
  }
}

// ─── Bot Setup ────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
  allowedMentions: { parse: [] },
})

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Demon X online as ${readyClient.user.tag}`)
  console.log(`Watching ${readyClient.guilds.cache.size} guild(s)`)
  console.log(`Instance: ${INSTANCE_LABEL} (${INSTANCE_ID})`)

  // Start the singleton leader-lease loop. Only the leader will act on
  // Discord events; followers stay connected but idle so they can take
  // over instantly when the lease becomes available.
  await startInstanceLock()

  // Initial rules load
  await refreshRules()
  await refreshIgnoredRoles()
  await refreshDisabledChannels()
  await refreshNotificationConfig()

  // Sync guild roles & channels to DB for the Settings UI
  await syncGuildRoles(readyClient)
  await syncGuildChannels(readyClient)

  // Periodic log cleanup (every 6 hours)
  setInterval(cleanupOldLogs, 6 * 60 * 60 * 1000)

  // Periodic rules refresh (backup — rules also refresh on-demand)
  setInterval(refreshRules, RULES_REFRESH_INTERVAL)

  // Periodic ignored roles refresh
  setInterval(refreshIgnoredRoles, IGNORED_ROLES_REFRESH_INTERVAL)

  // Periodic disabled channels refresh
  setInterval(refreshDisabledChannels, DISABLED_CHANNELS_REFRESH_INTERVAL)

  // Periodic notification-config refresh
  setInterval(refreshNotificationConfig, NOTIFICATION_CONFIG_REFRESH_INTERVAL)

  // Re-sync guild roles & channels every 30 minutes
  setInterval(() => syncGuildRoles(readyClient), 30 * 60 * 1000)
  setInterval(() => syncGuildChannels(readyClient), 30 * 60 * 1000)
})

client.on(Events.MessageCreate, async (message) => {
  // Only the lease holder processes events (see instance-lock.ts).
  if (!isLeader()) return

  // Skip bot messages
  if (message.author.bot) return

  // Skip DMs -- only scan guild messages
  if (!message.guild) return

  try {
    const rules = await ensureRules()
    await ensureIgnoredRoles()
    await ensureDisabledChannels()

    // Skip scanning if the channel has monitoring disabled
    if (isChannelDisabled(message.guildId!, getMonitoringChannelId(message))) {
      return
    }

    // Skip scanning if the author has a whitelisted role
    if (hasIgnoredRole(message)) {
      await logMessage(message, false)
      return
    }

    const match = rules.length > 0
      ? await scanMessage(message, rules)
      : null

    // Log every scanned message (for dashboard stats)
    await logMessage(message, !!match)
    console.log(
      `[scan] ${message.author.username} in #${'name' in message.channel ? message.channel.name : message.channelId}: ` +
      `${message.content.slice(0, 80)}${message.content.length > 80 ? '...' : ''} ${match ? '>>> FLAGGED' : ''}`
    )

    if (match) {
      console.log(
        `FLAGGED in #${message.channel.type !== ChannelType.DM && 'name' in message.channel ? message.channel.name : 'unknown'}: ` +
        `"${match.matchedText}" by ${message.author.username} ` +
        `(rule: ${match.rule.groupName}, source: ${match.sourceType})`
      )

      await ensureNotificationConfig()
      const actions = await executeActions(message, match)
      await logFlaggedMessage(message, match, false, actions.actionsTaken)

      // Mark deletion in DB (in place, no new row)
      if (actions.deleted) {
        await markFlaggedDeleted(message.id, 'bot')
        await markMessageLogDeleted(message.id, 'bot')
      }

      const flaggedRowId = await getFlaggedRowId(message.id, false)

      // Post moderation action immediately so this always appears before any
      // user reaction event that might arrive quickly from the DM prompt.
      await notifyActionsLog(client, message, match, actions, flaggedRowId)

      // Send DM whenever any moderation action was taken (or is about to be
      // taken, in the ban case). We DM the user BEFORE the ban executes so
      // they are guaranteed to receive the explanation + reaction prompt.
      if (actions.deleted || actions.timedOut || actions.banned) {
        await sendUserDeletionDM(message, match, flaggedRowId, actions)
        if (actions.deleted) {
          await postChannelDeletionNotice(message, match, flaggedRowId)
        }
      }

      // Apply the ban only AFTER the DM has been dispatched.
      if (actions.banned) {
        await executeBan(message, match)
      }
    }
  } catch (err) {
    console.error('Error processing message:', err)
  }
})

// Re-scan edited messages — prevents bypassing scam detection via edits
client.on(Events.MessageUpdate, async (_oldMessage, newMessage) => {
  if (!isLeader()) return
  // Partials may lack content; fetch the full message
  if (newMessage.partial) {
    try {
      newMessage = await newMessage.fetch()
    } catch {
      return // message was deleted or inaccessible
    }
  }

  if (newMessage.author?.bot) return
  if (!newMessage.guild) return

  try {
    const rules = await ensureRules()
    await ensureIgnoredRoles()
    await ensureDisabledChannels()

    // Skip scanning if the channel has monitoring disabled
    if (isChannelDisabled(newMessage.guildId!, getMonitoringChannelId(newMessage as Message))) {
      return
    }

    // Skip scanning if the author has a whitelisted role
    if (hasIgnoredRole(newMessage as Message)) {
      await logMessage(newMessage as Message, false)
      return
    }

    const match = rules.length > 0
      ? await scanMessage(newMessage as Message, rules)
      : null

    // Log edit as a new version (not overwriting original)
    await logMessageEdit(newMessage as Message, !!match)
    console.log(
      `[scan:edit] ${newMessage.author!.username} in #${'name' in newMessage.channel! ? (newMessage.channel as any).name : newMessage.channelId}: ` +
      `${(newMessage.content ?? '').slice(0, 80)}${(newMessage.content ?? '').length > 80 ? '...' : ''} ${match ? '>>> FLAGGED' : ''}`
    )

    if (match) {
      console.log(
        `FLAGGED (edit) in #${newMessage.channel!.type !== ChannelType.DM && 'name' in newMessage.channel! ? (newMessage.channel as any).name : 'unknown'}: ` +
        `"${match.matchedText}" by ${newMessage.author!.username} ` +
        `(rule: ${match.rule.groupName}, source: ${match.sourceType})`
      )

      await ensureNotificationConfig()
      const actions = await executeActions(newMessage as Message, match)
      await logFlaggedMessage(newMessage as Message, match, true, actions.actionsTaken)

      if (actions.deleted) {
        await markFlaggedDeleted(newMessage.id, 'bot')
        await markMessageLogDeleted(newMessage.id, 'bot')
      }

      const flaggedRowId = await getFlaggedRowId(newMessage.id, true)

      await notifyActionsLog(client, newMessage as Message, match, actions, flaggedRowId)

      if (actions.deleted || actions.timedOut || actions.banned) {
        await sendUserDeletionDM(newMessage as Message, match, flaggedRowId, actions)
        if (actions.deleted) {
          await postChannelDeletionNotice(newMessage as Message, match, flaggedRowId)
        }
      }

      // Apply the ban only AFTER the DM has been dispatched.
      if (actions.banned) {
        await executeBan(newMessage as Message, match)
      }
    }
  } catch (err) {
    console.error('Error processing edited message:', err)
  }
})

// ─── Track External Deletions (user / moderator) ──────────────────────
client.on(Events.MessageDelete, async (deletedMessage: Message | PartialMessage) => {
  if (!isLeader()) return
  // Only handle guild messages
  if (!deletedMessage.guildId) return

  try {
    // If we already marked this row as deleted (bot did it), the IS NULL guard
    // in markFlaggedDeleted/markMessageLogDeleted prevents overwrite. So we can
    // safely call them with kind='unknown' for any external delete.
    //
    // We can't reliably distinguish user vs moderator without audit-log access
    // (and the bot may not have that permission), so we record 'unknown' here.
    await markFlaggedDeleted(deletedMessage.id, 'unknown')
    await markMessageLogDeleted(deletedMessage.id, 'unknown')
  } catch (err) {
    console.error('Error tracking external deletion:', err)
  }
})

// ─── Handle Reactions on the Bot's DMs ────────────────────────────
client.on(Events.MessageReactionAdd, async (reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) => {
  if (!isLeader()) return
  try {
    if (user.bot) return

    // Resolve partials
    if (reaction.partial) {
      try { await reaction.fetch() } catch { return }
    }
    if (reaction.message.partial) {
      try { await reaction.message.fetch() } catch { return }
    }
    if (user.partial) {
      try { await user.fetch() } catch { return }
    }

    // Only react to DMs from the bot
    const reactionMessage = reaction.message as Message | PartialMessage
    if (reactionMessage.channel.type !== ChannelType.DM) return
    if (reactionMessage.author?.id !== client.user?.id) return

    const emojiName = reaction.emoji.name
    if (!emojiName) return
    const kind = EMOJI_TO_KIND[emojiName]
    if (!kind) return

    // Look up the flagged record by the DM message id we previously stored
    const { data: flaggedRows, error: flaggedErr } = await supabase
      .from('guardian_flagged_messages')
      .select('id, guild_id, guild_name, channel_id, channel_name, content, matched_rule_group_name, author_id')
      .eq('dm_message_id', reactionMessage.id)
      .limit(1)

    if (flaggedErr) {
      console.error('Failed to look up flagged record for reaction:', flaggedErr.message)
      return
    }
    const flagged = flaggedRows?.[0]
    if (!flagged) {
      console.log(`[reaction] No flagged record for DM ${reactionMessage.id}`)
      return
    }

    // Only the original author may react meaningfully (others can be ignored)
    if (flagged.author_id !== user.id) return

    // Insert into guardian_user_responses (idempotent on UNIQUE constraint)
    const { error: insertErr } = await supabase
      .from('guardian_user_responses')
      .upsert({
        flagged_message_id: flagged.id,
        guild_id: flagged.guild_id,
        guild_name: flagged.guild_name,
        channel_id: flagged.channel_id,
        channel_name: flagged.channel_name,
        discord_user_id: user.id,
        discord_username: (user as User).username,
        response_kind: kind,
        emoji: emojiName,
      }, { onConflict: 'flagged_message_id,discord_user_id,response_kind' })

    if (insertErr) {
      console.error('Failed to insert user response:', insertErr.message)
      return
    }

    console.log(`[reaction] User ${user.id} reacted ${emojiName} (${kind}) on DM for flagged ${flagged.id}`)

    // Forward to the moderator user-feedback channel
    await ensureNotificationConfig()
    await notifyFeedbackChannel(client, flagged.guild_id, {
      flaggedMessageId: flagged.id,
      discordUserId: user.id,
      username: (user as User).username || 'unknown',
      kind,
      flaggedContent: flagged.content,
      matchedRuleGroup: flagged.matched_rule_group_name,
      sourceChannelId: flagged.channel_id,
    })
  } catch (err) {
    console.error('Error handling reaction:', err)
  }
})

// ─── Error Handling ───────────────────────────────────────────────────

client.on(Events.Error, (error) => {
  console.error('Discord client error:', error)
})

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason)
})

// Best-effort lease release on graceful shutdown so a sibling instance can
// take over immediately instead of waiting for the stale window.
async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal} -- releasing instance lock`)
  try {
    await releaseInstanceLock()
  } finally {
    process.exit(0)
  }
}
process.once('SIGINT', () => { void shutdown('SIGINT') })
process.once('SIGTERM', () => { void shutdown('SIGTERM') })

// ─── Start ────────────────────────────────────────────────────────────

const token = process.env.DISCORD_BOT_TOKEN

if (process.env.DISABLE_BOT === 'true') {
  console.log('Bot disabled via DISABLE_BOT=true -- skipping Discord login')
} else if (!token) {
  console.error('Missing DISCORD_BOT_TOKEN environment variable')
  process.exit(1)
} else {
  client.login(token)
}
