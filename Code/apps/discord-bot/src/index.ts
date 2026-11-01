import dotenv from 'dotenv'
dotenv.config({ quiet: true })

import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Message,
  ChannelType,
  PermissionFlagsBits,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ComponentType,
  MessageFlags,
} from 'discord.js'
import express from 'express'
import { timingSafeEqual } from 'crypto'
import {
  supabase as maybeSupabase,
  isSupabaseConfigured,
  missingSupabaseEnvVars,
} from './supabase.js'
import { sendDM, handleSubscribe, handleUnsubscribe, handleOptOut, wrapUrlsForEmbed } from './dm-flow.js'
import type { DmDeps, DmSendResult } from './dm-flow.js'
import { linkDiscordAccount } from './link-flow.js'
import type { LinkDeps } from './link-flow.js'
import { describeOptOutStatus, undoOptOuts } from './optout-flow.js'
import { createDiscordDeleteDeps, deleteMessages, parseDeleteRequest } from './delete-flow.js'

// ─── Config ───────────────────────────────────────────────────────────

const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID
const API_URL = process.env.API_URL || 'http://localhost:3001'
const API_BOT_SECRET = process.env.BOT_API_SECRET
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'
const SOURCE_ENV = process.env.NODE_ENV || 'development'

// Graceful opt-out: the bot is an optional add-on. If the user has not
// configured Discord credentials yet (or explicitly disabled the bot via the
// setup wizard), exit cleanly so `pnpm dev` does not leave a crashed child
// window behind. The web app surfaces a "Discord features disabled" banner so
// users know to configure it from the Setup page when ready.
if (process.env.DISABLE_BOT === 'true') {
  console.log('[bot] DISABLE_BOT=true -- skipping Discord login.')
  process.exit(0)
}
if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
  console.warn(
    '[bot] DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID not set -- Discord integration is disabled.\n' +
    '      Configure these in the Setup wizard (http://localhost:5173/setup) when ready, then restart.'
  )
  process.exit(0)
}
if (!isSupabaseConfigured || !maybeSupabase) {
  console.warn(
    '[bot] Setup mode enabled -- missing Supabase config: ' + missingSupabaseEnvVars.join(', ') + '\n' +
    '      Discord bot database features are disabled until setup is complete.\n' +
    '      Add SUPABASE_URL and SUPABASE_SECRET_KEY_LOCALHOST (NODE_ENV=production: SUPABASE_SECRET_KEY_PRODUCTION), then restart.'
  )
  process.exit(0)
}
if (!API_BOT_SECRET) {
  // BOT_API_SECRET is required for the bot's internal HTTP listener to
  // authenticate platform-API callbacks. Without it we would expose an
  // unauthenticated endpoint, so we refuse to start even when the Discord
  // token is present -- but exit 0 so it shows as "disabled, fix config"
  // rather than a crashed service.
  console.error(
    '[bot] BOT_API_SECRET not set -- refusing to start (would expose an unauthenticated internal API).\n' +
    '      Set BOT_API_SECRET in apps/api/.env (the platform API needs the same value).'
  )
  process.exit(0)
}

const API_BOT_SECRET_BUF = Buffer.from(API_BOT_SECRET, 'utf8')
const supabase = maybeSupabase

// ─── Discord Client ───────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
})

// ─── Slash Commands ───────────────────────────────────────────────────

const commands = [
  new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your Discord account to the Coordination Manager platform')
    .addStringOption(opt =>
      opt.setName('key')
        .setDescription('Your personal link key from the platform')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check your Coordination Manager link status'),
  new SlashCommandBuilder()
    .setName('channels')
    .setDescription('List channels the bot can post to in this server'),
  new SlashCommandBuilder()
    .setName('feedback')
    .setDescription('Submit feedback about the Coordination Manager platform')
    .addStringOption(opt =>
      opt.setName('message')
        .setDescription('Your feedback message')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('optout')
    .setDescription('Manage DMs from Swarm Coordinator')
    .addSubcommand(sub =>
      sub.setName('status').setDescription('Show whether you have opted out of bot DMs')
    )
    .addSubcommand(sub =>
      sub.setName('undo').setDescription('Remove your DM opt-outs and receive DMs again')
    ),
]

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN!)
  try {
    console.log('Registering slash commands...')
    await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID!), {
      body: commands.map(c => c.toJSON()),
    })
    console.log('Slash commands registered.')
  } catch (err) {
    console.error('Failed to register commands:', err)
  }
}

// ─── Command Handlers ─────────────────────────────────────────────────

function linkDeps(): LinkDeps {
  return { supabase, syncGuildsForUser, frontendUrl: FRONTEND_URL }
}

async function handleLink(interaction: ChatInputCommandInteraction) {
  // Defer immediately — sync can take a while
  await interaction.deferReply({ flags: 64 }) // 64 = ephemeral

  const key = interaction.options.getString('key', true).trim()
  const result = await linkDiscordAccount(linkDeps(), key, interaction.user)
  await interaction.editReply({ content: result.message, flags: MessageFlags.SuppressEmbeds })
}

async function handleStatus(interaction: ChatInputCommandInteraction) {
  const discordUserId = interaction.user.id

  const { data: integration } = await supabase
    .from('discord_integrations')
    .select('*, discord_guild_channels(*)')
    .eq('discord_user_id', discordUserId)
    .eq('is_active', true)
    .single()

  if (!integration) {
    await interaction.reply({
      content: 'Your Discord account is not linked to the Coordination Manager platform. Use `/link <key>` to connect.',
      flags: 64,
    })
    return
  }

  const channelCount = integration.discord_guild_channels?.length || 0

  await interaction.reply({
    content: [
      `**Swarm Coordinator — Link Status**`,
      `Connected: Yes`,
      `Linked since: ${new Date(integration.bot_verified_at || integration.created_at).toLocaleDateString()}`,
      `Active channels: ${channelCount}`,
      ``,
      `Manage your announcement channels from the platform.`,
    ].join('\n'),
    flags: 64,
  })
}

async function handleChannels(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      flags: 64,
    })
    return
  }

  const guild = interaction.guild
  const botMember = guild.members.cache.get(client.user!.id)

  if (!botMember) {
    await interaction.reply({
      content: 'Unable to determine bot permissions.',
      flags: 64,
    })
    return
  }

  // Get text channels the bot can send messages to
  const sendableChannels = guild.channels.cache
    .filter(ch =>
      ch.type === ChannelType.GuildText &&
      ch.permissionsFor(botMember)?.has(PermissionFlagsBits.SendMessages)
    )

  if (sendableChannels.size === 0) {
    await interaction.reply({
      content: 'The bot doesn\'t have permission to send messages in any channel on this server.',
      flags: 64,
    })
    return
  }

  const channelList = sendableChannels.map(ch => `• #${ch.name} (ID: \`${ch.id}\`)`)

  await interaction.reply({
    content: [
      `**Available Channels in ${guild.name}**`,
      `The bot can post to ${sendableChannels.size} channel(s):`,
      '',
      ...channelList.values(),
      '',
      `Use the platform to select which channels to use for announcements.`,
    ].join('\n'),
    flags: 64,
  })
}

// ─── /optout ──────────────────────────────────────────────────────────

async function handleOptOutCommand(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand()
  const content = sub === 'undo'
    ? await undoOptOuts({ supabase }, interaction.user.id)
    : await describeOptOutStatus({ supabase }, interaction.user.id)
  await interaction.reply({ content, flags: 64 })
}

// ─── /feedback ────────────────────────────────────────────────────────

async function handleFeedback(interaction: ChatInputCommandInteraction) {
  const message = interaction.options.getString('message', true)
  const category = 'general'
  const discordUserId = interaction.user.id
  const discordUsername = interaction.user.username

  if (message.length > 2000) {
    await interaction.reply({
      content: 'Feedback message is too long (max 2000 characters). Please shorten it and try again.',
      flags: 64,
    })
    return
  }

  try {
    // Check if this Discord user is linked to a platform account
    const { data: integration } = await supabase
      .from('discord_integrations')
      .select('user_id')
      .eq('discord_user_id', discordUserId)
      .maybeSingle()

    const { data: saved, error } = await supabase
      .from('feedback')
      .insert({
        user_id: integration?.user_id || null,
        discord_user_id: discordUserId,
        discord_username: discordUsername,
        message,
        category,
        source: 'bot',
      })
      .select()
      .single()

    if (error || !saved) {
      console.error('Failed to save feedback:', error || 'No data returned')
      await interaction.reply({
        content: 'Something went wrong saving your feedback. Please try again later.',
        flags: 64,
      })
      return
    }

    console.log(`Feedback saved: id=${saved.id} discord_user=${discordUsername} user_id=${saved.user_id || 'none'}`)

    await interaction.reply({
      content: [
        '✅ **Feedback submitted!** Thank you for helping improve Coordination Manager.',
        '',
        `**Message:** ${message.length > 100 ? message.slice(0, 100) + '...' : message}`,
        '',
        'An admin will review your feedback. You can also submit feedback on the web platform.',
      ].join('\n'),
      flags: 64,
    })
  } catch (err) {
    console.error('Feedback command error:', err)
    await interaction.reply({
      content: 'An error occurred. Please try again later.',
      flags: 64,
    })
  }
}

// ─── DM Key Linking (fallback for non-slash-command users) ────────────

async function handleDM(message: Message) {
  if (message.author.bot) return

  const content = message.content.trim()

  // Handle "stop" / "opt out" keywords — global opt-out from all bot DMs
  if (/^(stop|opt\s*out|unsubscribe)$/i.test(content)) {
    try {
      await supabase
        .from('dm_opt_outs')
        .insert({
          recipient_discord_id: message.author.id,
          sender_user_id: null,
          reason: 'dm_keyword',
        })
        // Duplicate insert is fine — means already opted out
      await message.reply('✅ You\'ve been opted out of all DMs from Swarm Coordinator. You can undo this with `/optout undo` (here or in any server with this bot).')
    } catch {
      await message.reply('Something went wrong. Please try again.')
    }
    return
  }

  // Check if it looks like a link key (UUID-like or starts with 'sc-')
  if (content.startsWith('sc-') || /^[a-f0-9-]{20,}$/i.test(content)) {
    const result = await linkDiscordAccount(linkDeps(), content, message.author)
    await message.reply(result.message)
    return
  }

  // General help
  await message.reply(
    [
      '**Swarm Coordinator Bot**',
      '',
      'To link your Discord account, use one of:',
      '• `/link <key>` in any server with this bot',
      '• Send your link key directly in this DM',
      '',
      'Get your link key from the Coordination Manager platform → Distribute Announcements → Discord Integration.',
    ].join('\n')
  )
}

// ─── Guild/Channel Sync ───────────────────────────────────────────────

async function syncGuildsForUser(integrationId: string, userId: string, discordUserId: string) {
  try {
    // For guilds where the user might not be cached, fetch member
    for (const [, guild] of client.guilds.cache) {
      try {
        await guild.members.fetch(discordUserId)
      } catch { /* user not in this guild */ }
    }

    // Find guilds where both bot and user are present
    const userGuilds = client.guilds.cache.filter(guild =>
      guild.members.cache.has(discordUserId)
    )

    for (const [, guild] of userGuilds) {
      const botMember = guild.members.cache.get(client.user!.id)
      const userMember = guild.members.cache.get(discordUserId)
      if (!botMember) continue

      // Get ALL visible text channels (not just ones bot can send to)
      const textChannels = guild.channels.cache.filter(ch =>
        ch.type === ChannelType.GuildText &&
        ch.permissionsFor(botMember)?.has(PermissionFlagsBits.ViewChannel)
      )

      for (const [, channel] of textChannels) {
        const botCanSend = !!channel.permissionsFor(botMember)?.has(PermissionFlagsBits.SendMessages)
        // Check if the linked user also has SendMessages permission in this channel
        const userCanSend = userMember
          ? !!channel.permissionsFor(userMember)?.has(PermissionFlagsBits.SendMessages)
          : false
        
        // Upsert: update guild/channel names and permissions, but preserve is_active
        const { data: existing } = await supabase
          .from('discord_guild_channels')
          .select('is_active')
          .eq('user_id', userId)
          .eq('guild_id', guild.id)
          .eq('channel_id', channel.id)
          .maybeSingle()

        await supabase
          .from('discord_guild_channels')
          .upsert({
            user_id: userId,
            integration_id: integrationId,
            guild_id: guild.id,
            guild_name: guild.name,
            guild_icon: guild.iconURL(),
            channel_id: channel.id,
            channel_name: channel.name,
            bot_can_send: botCanSend,
            user_can_send: userCanSend,
            is_active: existing?.is_active ?? false,
          }, {
            onConflict: 'user_id,guild_id,channel_id',
            ignoreDuplicates: false,
          })
      }

      // Remove channels that no longer exist in Discord
      const validChannelIds = Array.from(textChannels.keys())
      const { data: dbChannels } = await supabase
        .from('discord_guild_channels')
        .select('channel_id')
        .eq('user_id', userId)
        .eq('guild_id', guild.id)

      for (const dbCh of dbChannels || []) {
        if (!validChannelIds.includes(dbCh.channel_id)) {
          await supabase
            .from('discord_guild_channels')
            .delete()
            .eq('user_id', userId)
            .eq('guild_id', guild.id)
            .eq('channel_id', dbCh.channel_id)
        }
      }
    }

    console.log(`Synced ${userGuilds.size} guild(s) for user ${discordUserId}`)
  } catch (err) {
    console.error('Failed to sync guilds:', err)
  }
}

// ─── Internal HTTP API (for main API server to call) ──────────────────

const app = express()
app.use(express.json())
// Express 5 leaves req.body undefined when no parser matched; keep the Express 4 `{}` default.
app.use((req, _res, next) => {
  if (req.body === undefined) req.body = {}
  next()
})

const BOT_API_PORT = parseInt(process.env.BOT_API_PORT || '3002', 10)

// Simple auth middleware for internal calls (timing-safe comparison)
app.use((req, res, next) => {
  const raw = req.headers['x-bot-secret']
  const token = typeof raw === 'string' ? raw : ''
  const tokenBuf = Buffer.from(token, 'utf8')
  if (
    tokenBuf.length !== API_BOT_SECRET_BUF.length ||
    !timingSafeEqual(tokenBuf, API_BOT_SECRET_BUF)
  ) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
})

// Sync channels for a user on demand
app.post('/sync-channels', async (req, res) => {
  const { integrationId, userId, discordUserId } = req.body
  if (!integrationId || !userId || !discordUserId) {
    return res.status(400).json({ error: 'integrationId, userId, discordUserId required' })
  }
  await syncGuildsForUser(integrationId, userId, discordUserId)
  res.json({ success: true })
})

// List guild members the user shares a server with (for DMs) — SSE streaming
app.post('/list-dm-members', async (req, res) => {
  const { discordUserId } = req.body as { discordUserId: string }
  if (!discordUserId) {
    return res.status(400).json({ error: 'discordUserId required' })
  }

  // Set up SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  const sendEvent = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  try {
    // Phase 1: Discover shared guilds and total member count
    const sharedGuilds: Array<{ guild: typeof client.guilds.cache extends Map<string, infer V> ? V : never; memberCount: number }> = []
    for (const [, guild] of client.guilds.cache) {
      try {
        await guild.members.fetch(discordUserId) // targeted — only checks this user
      } catch { continue } // User not in this guild
      if (!guild.members.cache.has(discordUserId)) continue
      sharedGuilds.push({ guild, memberCount: guild.memberCount })
    }

    const totalMembers = sharedGuilds.reduce((sum, g) => sum + g.memberCount, 0)
    sendEvent({ type: 'init', totalMembers, guildCount: sharedGuilds.length, guildNames: sharedGuilds.map(g => g.guild.name) })

    // Phase 2: Paginate through all members of shared guilds
    const membersMap = new Map<string, {
      user_id: string; username: string; display_name: string
      avatar: string | null; guild_ids: string[]; guild_names: string[]
      roles: Array<{ id: string; name: string; color: number; guild_id?: string; guild_name?: string }>
    }>()
    let checked = 0

    for (const { guild } of sharedGuilds) {
      const userMember = guild.members.cache.get(discordUserId)

      // Add the requesting user themselves (merge across guilds)
      if (userMember) {
        const existing = membersMap.get(discordUserId)
        const guildRoles = userMember.roles.cache
          .filter(r => r.id !== guild.id)
          .sort((a, b) => b.position - a.position)
          .map(r => ({ id: r.id, name: r.name, color: r.color, guild_id: guild.id, guild_name: guild.name }))
        if (existing) {
          if (!existing.guild_ids.includes(guild.id)) {
            existing.guild_ids.push(guild.id)
            existing.guild_names.push(guild.name)
          }
          // Merge roles (deduplicate by id+guild_id to keep per-guild attribution)
          const existingRoleKeys = new Set(existing.roles.map(r => `${r.id}:${r.guild_id || ''}`))
          for (const role of guildRoles) {
            if (!existingRoleKeys.has(`${role.id}:${role.guild_id || ''}`)) {
              existing.roles.push(role)
            }
          }
        } else {
          membersMap.set(discordUserId, {
            user_id: discordUserId,
            username: userMember.user.tag,
            display_name: `${userMember.displayName} (You)`,
            avatar: userMember.user.displayAvatarURL({ size: 64 }),
            guild_ids: [guild.id],
            guild_names: [guild.name],
            roles: guildRoles,
          })
        }
      }

      // Paginate through ALL members using `after` cursor
      let lastId: string | undefined
      while (true) {
        let batch
        try {
          batch = await guild.members.list({ limit: 1000, ...(lastId ? { after: lastId } : {}) })
        } catch { break }
        if (batch.size === 0) break

        for (const [, member] of batch) {
          checked++
          if (member.user.bot) continue
          if (member.user.id === discordUserId) continue

          const guildRoles = member.roles.cache
            .filter(r => r.id !== guild.id)
            .sort((a, b) => b.position - a.position)
            .map(r => ({ id: r.id, name: r.name, color: r.color, guild_id: guild.id, guild_name: guild.name }))

          const existing = membersMap.get(member.user.id)
          if (existing) {
            // Merge guild info and roles from additional guild
            if (!existing.guild_ids.includes(guild.id)) {
              existing.guild_ids.push(guild.id)
              existing.guild_names.push(guild.name)
            }
            const existingRoleKeys = new Set(existing.roles.map(r => `${r.id}:${r.guild_id || ''}`))
            for (const role of guildRoles) {
              if (!existingRoleKeys.has(`${role.id}:${role.guild_id || ''}`)) {
                existing.roles.push(role)
              }
            }
          } else {
            membersMap.set(member.user.id, {
              user_id: member.user.id,
              username: member.user.tag,
              display_name: member.displayName,
              avatar: member.user.displayAvatarURL({ size: 64 }),
              guild_ids: [guild.id],
              guild_names: [guild.name],
              roles: guildRoles,
            })
          }
        }

        // Send progress every batch
        sendEvent({ type: 'progress', checked, totalMembers, found: membersMap.size })

        lastId = batch.lastKey()
        if (batch.size < 1000) break // Last page
      }
    }

    const members = Array.from(membersMap.values())
    sendEvent({ type: 'done', members, checked, totalMembers, found: members.length })
    res.end()
  } catch (err: any) {
    console.error('Failed to list DM members:', err)
    sendEvent({ type: 'error', error: err.message })
    res.end()
  }
})

// Check permissions for specific channels on demand
app.post('/check-permissions', async (req, res) => {
  const { channelIds } = req.body as { channelIds: string[] }
  if (!channelIds?.length) {
    return res.status(400).json({ error: 'channelIds required' })
  }

  const results: Record<string, { canSend: boolean; guildName?: string; channelName?: string }> = {}

  for (const channelId of channelIds) {
    try {
      const channel = await client.channels.fetch(channelId)
      if (!channel || channel.isDMBased() || !('guild' in channel)) {
        results[channelId] = { canSend: false }
        continue
      }
      const guild = (channel as any).guild
      const botMember = guild?.members?.cache?.get(client.user!.id)
      const canSend = botMember && 'permissionsFor' in channel
        ? !!(channel as any).permissionsFor(botMember)?.has(PermissionFlagsBits.SendMessages)
        : false
      results[channelId] = {
        canSend,
        guildName: guild?.name,
        channelName: (channel as any).name,
      }
    } catch {
      results[channelId] = { canSend: false }
    }
  }

  res.json({ permissions: results })
})

// Fetch custom emojis from all guilds the user shares with the bot
app.post('/guild-emojis', async (req, res) => {
  const { discordUserId } = req.body as { discordUserId: string }
  if (!discordUserId) {
    return res.status(400).json({ error: 'discordUserId required' })
  }

  try {
    const emojis: Array<{
      id: string
      name: string
      animated: boolean
      guild_id: string
      guild_name: string
      url: string
    }> = []

    for (const [, guild] of client.guilds.cache) {
      // Check if the user is in this guild
      try {
        await guild.members.fetch(discordUserId)
      } catch {
        continue // User not in this guild
      }

      if (!guild.members.cache.has(discordUserId)) continue

      // Fetch emojis for this guild
      const guildEmojis = guild.emojis.cache
      for (const [, emoji] of guildEmojis) {
        if (!emoji.name || !emoji.id) continue
        const ext = emoji.animated ? 'gif' : 'png'
        emojis.push({
          id: emoji.id,
          name: emoji.name,
          animated: !!emoji.animated,
          guild_id: guild.id,
          guild_name: guild.name,
          url: `https://cdn.discordapp.com/emojis/${emoji.id}.${ext}?size=48`,
        })
      }
    }

    res.json({ emojis })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: msg })
  }
})

// Delete announcement messages the bot already posted (channel posts and DMs).
// The API verifies the sender owns the schedule before calling this.
app.post('/delete-messages', async (req, res) => {
  const parsed = parseDeleteRequest(req.body)
  if (!parsed.ok) {
    return res.status(400).json({ error: parsed.error })
  }
  try {
    const results = await deleteMessages(createDiscordDeleteDeps(client), parsed.items)
    const failed = results.filter(r => !r.ok).length
    console.log(`delete-messages: ${results.length - failed} deleted, ${failed} failed`)
    res.json({ results })
  } catch (err: unknown) {
    console.error('delete-messages failed:', err instanceof Error ? err.message : 'Unknown error')
    res.status(500).json({ error: 'Failed to delete messages' })
  }
})

app.listen(BOT_API_PORT, () => {
  console.log(`Bot internal API listening on port ${BOT_API_PORT}`)
})

// ─── Helpers ────────────────────────────────────────────────────────────

// wrapUrlsForEmbed imported from dm-flow.ts

// ─── Send Announcement (called by API via Supabase function or direct) ──

export async function sendToDiscordChannel(
  channelId: string,
  content: string,
  senderUsername?: string,
  title?: string,
  pollOptions?: Array<{ emoji: string; text: string }>,
  isImmediate?: boolean,
  suppressEmbeds?: boolean,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const channel = await client.channels.fetch(channelId)
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      return { success: false, error: 'Channel not found or not a text channel' }
    }

    if (!('send' in channel)) {
      return { success: false, error: 'Cannot send messages to this channel type' }
    }

    // Build message: body + poll options (if any) + attribution
    let fullContent = content

    if (suppressEmbeds) {
      fullContent = wrapUrlsForEmbed(fullContent)
    }

    // Append poll option legend so users know what each reaction means
    if (pollOptions?.length) {
      const optionLines = pollOptions.map(o => `${o.emoji} ${o.text}`).join('\n')
      fullContent += `\n\n${optionLines}`
    }

    if (senderUsername) {
      const verb = isImmediate ? 'Posted' : 'Scheduled'
      const hasExistingLink = fullContent.includes('coordinationmanager.com')
      const viaText = (hasExistingLink || suppressEmbeds) ? 'coordinationmanager.com' : '[coordinationmanager.com](https://coordinationmanager.com)'
      fullContent += `\n\n-# — ${verb} via ${viaText} by @${senderUsername}`
    }

    // Truncate if over Discord's 2000-char limit
    if (fullContent.length > 2000) {
      fullContent = fullContent.slice(0, 1997) + '...'
    }

    const msg = await channel.send({
      content: fullContent,
      allowedMentions: { parse: [] }, // Suppress ALL mention parsing (@everyone, @here, @role)
      ...(suppressEmbeds ? { flags: MessageFlags.SuppressEmbeds } : {}),
    })

    // Force-suppress embeds via edit -- Discord doesn't always honour the flag on creation
    if (suppressEmbeds) {
      try { await msg.suppressEmbeds(true) } catch { /* missing Manage Messages in this channel */ }
    }

    // Add poll reactions if poll options are present
    if (pollOptions?.length) {
      const reactedEmojis = new Set<string>()
      for (const option of pollOptions) {
        if (reactedEmojis.has(option.emoji)) continue // Skip duplicate emojis
        reactedEmojis.add(option.emoji)
        try {
          await msg.react(option.emoji)
        } catch (reactErr: any) {
          console.warn(`Failed to add poll reaction ${option.emoji}:`, reactErr.message)
        }
      }
    }

    return { success: true, messageId: msg.id }
  } catch (err: any) {
    return { success: false, error: err.message || 'Unknown error' }
  }
}

/** DM deps bound to the live Discord client and Supabase instance. */
const dmDeps: DmDeps = { client, supabase }

export async function sendDiscordDM(
  userId: string,
  content: string,
  senderUsername?: string,
  title?: string,
  senderUserId?: string,
  pollOptions?: Array<{ emoji: string; text: string }>,
  isImmediate?: boolean,
  suppressEmbeds?: boolean,
  calendarId?: string,
  calendarName?: string,
): Promise<DmSendResult> {
  return sendDM(dmDeps, {
    userId, content, senderUsername, title, senderUserId,
    pollOptions, isImmediate, suppressEmbeds, calendarId, calendarName,
  })
}

// ─── Send Announcement Email (delegates to API) ──────────────────────

/** Strip Discord markdown formatting for plain-text email. */
function stripDiscordMarkdown(text: string): string {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')   // ***bold italic***
    .replace(/\*\*(.+?)\*\*/g, '$1')        // **bold**
    .replace(/\*(.+?)\*/g, '$1')            // *italic*
    .replace(/__(.+?)__/g, '$1')            // __underline__
    .replace(/~~(.+?)~~/g, '$1')            // ~~strikethrough~~
    .replace(/`{3}[\s\S]*?`{3}/g, (m) => m.replace(/`{3}\w*\n?/g, ''))  // ```code blocks```
    .replace(/`(.+?)`/g, '$1')              // `inline code`
    .replace(/^> /gm, '')                   // > blockquotes
    .replace(/^#{1,3}\s+/gm, '')            // ### headings
    .replace(/<a?:(\w+):\d+>/g, ':$1:')     // <:emoji:id> and <a:emoji:id> -> :emoji:
}

async function sendAnnouncementEmail(
  to: string,
  content: string,
  senderUsername?: string,
  title?: string,
  isImmediate?: boolean,
  senderUserId?: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const verb = isImmediate ? 'Posted' : 'Scheduled'
    const plainContent = stripDiscordMarkdown(content)
    const textBody = senderUsername
      ? `${plainContent}\n\n-- ${verb} via Coordination Manager by ${senderUsername}`
      : plainContent

    const resp = await fetch(`${API_URL}/api/internal/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bot-secret': API_BOT_SECRET as string,
      },
      body: JSON.stringify({
        to,
        subject: stripDiscordMarkdown(title || 'Announcement from Coordination Manager'),
        textBody,
        senderUserId,
      }),
    })

    if (!resp.ok) {
      return { success: false, error: `API returned ${resp.status}` }
    }
    const data = await resp.json() as { success: boolean; messageId?: string; error?: string }
    return data
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to call email API' }
  }
}

// ─── Announcement Processor (polls pending schedules) ─────────────────

let processingAnnouncements = false

async function processAnnouncements() {
  // Prevent overlapping calls from setInterval
  if (processingAnnouncements) return
  processingAnnouncements = true
  try {
    await processAnnouncementsInner()
  } finally {
    processingAnnouncements = false
  }
}

async function processAnnouncementsInner() {
  const now = new Date()
  const nowIso = now.toISOString()

  // Staleness window: announcements more than 15 minutes past scheduled_at are auto-cancelled
  const STALENESS_WINDOW_MS = 15 * 60 * 1000

  // Fetch pending announcements that are due
  const { data: schedules, error } = await supabase
    .from('announcement_schedules')
    .select('*')
    .eq('status', 'pending')
    .eq('source_env', SOURCE_ENV)
    .lte('scheduled_at', nowIso)
    .limit(10)

  if (error || !schedules?.length) return

  for (const schedule of schedules) {
    const scheduledTime = new Date(schedule.scheduled_at).getTime()
    const ageMs = now.getTime() - scheduledTime

    // If the announcement is stale (>15 min overdue), cancel it instead of sending
    if (ageMs > STALENESS_WINDOW_MS) {
      console.log(`⏰ Cancelling stale announcement ${schedule.id} (${Math.round(ageMs / 60000)} min overdue)`)
      await supabase
        .from('announcement_schedules')
        .update({
          status: 'cancelled',
          error_message: `Auto-cancelled: ${Math.round(ageMs / 60000)} minutes past scheduled time (max ${STALENESS_WINDOW_MS / 60000} min window)`,
        })
        .eq('id', schedule.id)

      // Log the cancellation for each target
      const targets = (schedule.targets || []) as Array<{ type: string; target_id: string; label?: string }>
      for (const target of targets) {
        await supabase.from('announcement_delivery_log').insert({
          schedule_id: schedule.id,
          channel_type: target.type,
          target_id: target.target_id,
          target_label: target.label || null,
          status: 'failed',
          error_message: 'Auto-cancelled due to staleness',
          delivered_at: null,
        })
      }
      continue
    }

    // Atomically claim this schedule — only proceed if status is still 'pending'
    const { data: claimed, error: claimError } = await supabase
      .from('announcement_schedules')
      .update({ status: 'sending' })
      .eq('id', schedule.id)
      .eq('status', 'pending')
      .select('id')

    if (claimError || !claimed?.length) {
      // Another process already claimed this schedule — skip it
      continue
    }

    const rawTargets = (schedule.targets || []) as Array<{
      type: string
      target_id: string
      label?: string
      body_override?: string  // When set, overrides schedule.body for this specific target
    }>

    // Deduplicate targets by type+target_id (defense-in-depth against duplicate DB entries)
    const seenKeys = new Set<string>()
    const targets = rawTargets.filter(t => {
      const key = `${t.type}:${t.target_id}`
      if (seenKeys.has(key)) return false
      seenKeys.add(key)
      return true
    })

    // Look up the sender's Discord username for attribution
    let senderUsername: string | undefined
    let senderVerifiedEmail: string | undefined
    try {
      const { data: senderIntegration } = await supabase
        .from('discord_integrations')
        .select('discord_username')
        .eq('user_id', schedule.user_id)
        .eq('is_active', true)
        .single()
      senderUsername = senderIntegration?.discord_username || undefined
    } catch { /* no attribution if lookup fails */ }

    // Look up verified email for email sender attribution
    try {
      const { data: verifiedEmail } = await supabase
        .from('verified_emails')
        .select('email')
        .eq('user_id', schedule.user_id)
        .eq('is_primary', true)
        .single()
      senderVerifiedEmail = verifiedEmail?.email || undefined
    } catch { /* fall back to Discord username */ }

    // Look up calendar info for subscription buttons
    // calendar_id can be on the schedule directly, or derived from the template
    let calendarId: string | undefined = schedule.calendar_id || undefined
    console.log(`📋 Schedule ${schedule.id}: calendar_id=${schedule.calendar_id || 'null'}, template_id=${schedule.template_id || 'null'}`)
    let calendarName: string | undefined
    if (!calendarId && schedule.template_id) {
      try {
        const { data: tmpl } = await supabase
          .from('announcement_templates')
          .select('calendar_id')
          .eq('id', schedule.template_id)
          .maybeSingle()
        calendarId = tmpl?.calendar_id || undefined
      } catch { /* no calendar context */ }
    }
    // Fallback: extract calendarId from meeting URL in body (coordinationmanager.com/meeting/{id})
    if (!calendarId && schedule.body) {
      const meetingUrlMatch = schedule.body.match(/coordinationmanager\.com\/meeting\/([a-f0-9-]+)/i)
      if (meetingUrlMatch) {
        try {
          const { data: meeting } = await supabase
            .from('meetings')
            .select('calendar_id')
            .eq('id', meetingUrlMatch[1])
            .maybeSingle()
          if (meeting?.calendar_id) {
            calendarId = meeting.calendar_id
            console.log(`📅 Resolved calendarId from meeting URL in body: ${calendarId}`)
          }
        } catch { /* fallback failed */ }
      }
    }
    if (calendarId) {
      try {
        const { data: cal } = await supabase
          .from('calendars')
          .select('title')
          .eq('id', calendarId)
          .maybeSingle()
        calendarName = cal?.title || undefined
      } catch { /* no name available */ }
    }

    let allSuccess = true
    const failedTargets: Array<{ label: string; error: string }> = []
    let sentCount = 0

    // ── Adaptive DM rate-limiting configuration ──
    // Discord's anti-spam system can mute bots sending too many unique DMs.
    // Strategy: graduated delays + periodic cool-down pauses + backoff on errors.
    const dmTargetCount = targets.filter(t => t.type === 'discord_dm').length
    const getDmDelayMs = (count: number) => {
      if (count > 500) return 600
      if (count > 200) return 400
      if (count > 50)  return 250
      return 150
    }
    const getCooldownConfig = (count: number): { every: number; pauseMs: number } | null => {
      if (count > 500) return { every: 30, pauseMs: 10_000 }
      if (count > 200) return { every: 40, pauseMs: 5_000 }
      if (count > 50)  return { every: 50, pauseMs: 3_000 }
      return null
    }
    let baseDmDelay = getDmDelayMs(dmTargetCount)
    const cooldownCfg = getCooldownConfig(dmTargetCount)
    let dmsSentSinceLastCooldown = 0
    let consecutiveRateLimits = 0

    if (dmTargetCount > 0) {
      console.log(`📤 Sending ${dmTargetCount} DMs for schedule ${schedule.id} (delay: ${baseDmDelay}ms${cooldownCfg ? `, cooldown: ${cooldownCfg.pauseMs / 1000}s every ${cooldownCfg.every}` : ''}, calendarId: ${calendarId || 'none'})`)
    }

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i]
      let result: DmSendResult

      const isImmediate = !!schedule.is_immediate
      const suppressEmbeds = !!schedule.suppress_embeds
      if (target.type === 'discord_channel') {
        result = await sendToDiscordChannel(target.target_id, target.body_override || schedule.body, senderUsername, schedule.title, schedule.poll_options || undefined, isImmediate, suppressEmbeds)
      } else if (target.type === 'discord_dm') {
        result = await sendDiscordDM(target.target_id, target.body_override || schedule.body, senderUsername, schedule.title, schedule.user_id, schedule.poll_options || undefined, isImmediate, suppressEmbeds, calendarId, calendarName)

        // On rate-limit or transient failure: back off and retry once
        if (!result.success && result.error && /rate.?limit|429|too many|too fast/i.test(result.error)) {
          consecutiveRateLimits++
          const backoffMs = Math.min(30_000, 1000 * Math.pow(2, consecutiveRateLimits))
          console.warn(`⚠️ Rate-limited on DM ${sentCount + 1}/${dmTargetCount} (consecutive: ${consecutiveRateLimits}). Backing off ${backoffMs / 1000}s...`)
          await new Promise(resolve => setTimeout(resolve, backoffMs))

          // If 3+ consecutive rate limits, increase base delay by 50% permanently for this batch
          if (consecutiveRateLimits >= 3) {
            baseDmDelay = Math.round(baseDmDelay * 1.5)
            console.warn(`🐌 Increased base DM delay to ${baseDmDelay}ms after ${consecutiveRateLimits} consecutive rate limits`)
            consecutiveRateLimits = 0 // Reset counter after adjustment
          }

          // Retry the send once
          result = await sendDiscordDM(target.target_id, target.body_override || schedule.body, senderUsername, schedule.title, schedule.user_id, schedule.poll_options || undefined, isImmediate, suppressEmbeds, calendarId, calendarName)
        } else if (result.success) {
          consecutiveRateLimits = 0 // Reset on success
        }
      } else if (target.type === 'email') {
        // Use verified email for sender attribution in emails; fall back to Discord username
        const emailSenderName = senderVerifiedEmail || senderUsername
        result = await sendAnnouncementEmail(target.target_id, target.body_override || schedule.body, emailSenderName, schedule.email_subject || schedule.title, isImmediate, schedule.user_id)
      } else {
        result = { success: false, error: `Unknown target type: ${target.type}` }
      }

      // Determine recipient_response snapshot for DM targets
      let recipientResponse: string | null = null
      if (target.type === 'discord_dm') {
        if (result.blockedByStatus) {
          recipientResponse = result.blockedByStatus
        } else if (!result.success && result.error && /cannot send messages|50007/i.test(result.error)) {
          recipientResponse = 'muted_bot'
        } else if (result.success) {
          recipientResponse = result.subscriptionStatus || 'invited'
        }
      }

      // Log delivery
      await supabase.from('announcement_delivery_log').insert({
        schedule_id: schedule.id,
        channel_type: target.type,
        target_id: target.target_id,
        target_label: target.label || null,
        status: result.success ? 'sent' : 'failed',
        discord_message_id: result.messageId || null,
        error_message: result.error || null,
        delivered_at: result.success ? new Date().toISOString() : null,
        recipient_response: recipientResponse,
      })

      if (!result.success) {
        allSuccess = false
        failedTargets.push({ label: target.label || target.target_id, error: result.error || 'Unknown error' })
      } else {
        sentCount++
      }

      // Adaptive delay between DM sends to avoid Discord anti-spam.
      // Graduated delays + periodic cool-down pauses for large batches.
      if (target.type === 'discord_dm' && i < targets.length - 1) {
        dmsSentSinceLastCooldown++

        // Periodic cool-down pause: lets Discord's sliding rate-limit window reset
        if (cooldownCfg && dmsSentSinceLastCooldown >= cooldownCfg.every) {
          dmsSentSinceLastCooldown = 0
          console.log(`⏸️  Cool-down pause (${cooldownCfg.pauseMs / 1000}s) after ${sentCount}/${dmTargetCount} DMs sent`)
          await new Promise(resolve => setTimeout(resolve, cooldownCfg.pauseMs))
        } else {
          await new Promise(resolve => setTimeout(resolve, baseDmDelay))
        }
      }

      // Progress logging for large batches
      if (target.type === 'discord_dm' && dmTargetCount > 50 && sentCount > 0 && sentCount % 50 === 0) {
        console.log(`📊 DM progress: ${sentCount}/${dmTargetCount} sent (${failedTargets.length} failed)`)
      }
    }

    // ── Auto-mark users with closed DMs as "private" in dm_opt_outs ──
    const privateDmErrors = /cannot send messages to this user|50007/i
    for (const ft of failedTargets) {
      const target = targets.find(t => (t.label || t.target_id) === ft.label)
      if (target?.type === 'discord_dm' && privateDmErrors.test(ft.error)) {
        // Insert a global opt-out with reason='private' (upsert to avoid duplicates)
        await supabase
          .from('dm_opt_outs')
          .upsert({
            recipient_discord_id: target.target_id,
            sender_user_id: null,
            reason: 'private',
          }, { onConflict: 'recipient_discord_id,COALESCE(sender_user_id,\'00000000-0000-0000-0000-000000000000\')' })
          .then(() => console.log(`🔒 Marked ${ft.label} as private (DMs closed)`))
      }
    }

    // Count ALL failed delivery log entries for this schedule (includes pre-resolved ones from the API)
    let totalFailedCount = failedTargets.length
    try {
      const { data: allFailedRows } = await supabase
        .from('announcement_delivery_log')
        .select('id')
        .eq('schedule_id', schedule.id)
        .eq('status', 'failed')
        .limit(5000)
      totalFailedCount = allFailedRows?.length || failedTargets.length
    } catch (err) {
      console.error('Failed to count delivery log failures:', err)
    }
    const preResolvedCount = totalFailedCount - failedTargets.length

    // Build a descriptive error summary
    const errorSummary = totalFailedCount > 0
      ? `${totalFailedCount} of ${targets.length + preResolvedCount} failed: ${failedTargets.map(f => f.label).join(', ')}${preResolvedCount > 0 ? ` (+${preResolvedCount} pre-resolved)` : ''}`
      : null

    // Determine final status: partially_sent when some succeeded but some failed (including pre-resolved)
    const finalStatus = totalFailedCount === 0 ? 'sent' : sentCount > 0 ? 'partially_sent' : 'failed'

    // Update schedule status
    await supabase
      .from('announcement_schedules')
      .update({
        status: finalStatus,
        sent_at: new Date().toISOString(),
        error_message: errorSummary,
      })
      .eq('id', schedule.id)
  }
}

// ─── Bot Events ───────────────────────────────────────────────────────

client.once(Events.ClientReady, async (c) => {
  console.log(`🤖 Swarm Coordinator bot logged in as ${c.user.tag}`)
  console.log(`📡 In ${c.guilds.cache.size} server(s) | source_env=${SOURCE_ENV}`)

  await registerCommands()

  // Poll for pending announcements every 30 seconds
  setInterval(processAnnouncements, 30_000)
  // Run once on startup
  processAnnouncements()
})

client.on(Events.InteractionCreate, async (interaction) => {
  // ── Handle button interactions (subscribe / unsubscribe / opt-out) ──
  if (interaction.isButton()) {
    const customId = interaction.customId

    // ── Subscribe button (per-calendar) ──
    if (customId.startsWith('dm_subscribe:')) {
      const parts = customId.split(':')
      const senderUserId = parts[1]
      const calendarId = parts[2]

      try {
        await handleSubscribe(supabase, interaction.user.id, senderUserId, calendarId)

        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '🔔 You\'re now subscribed! You\'ll receive follow-up updates about this initiative.\n\nYou can unsubscribe at any time using the button on future messages.',
            flags: MessageFlags.Ephemeral | MessageFlags.SuppressEmbeds,
          })
        }
      } catch (err) {
        console.error('Subscribe button error:', err)
        try {
          if (interaction.deferred) {
            await interaction.editReply({ content: 'Something went wrong processing your subscription. Please try again.' })
          } else if (!interaction.replied) {
            await interaction.reply({ content: 'Something went wrong processing your subscription. Please try again.', flags: 64 })
          }
        } catch { /* interaction expired or already handled */ }
      }
      return
    }

    // ── Unsubscribe button (per-calendar) ──
    if (customId.startsWith('dm_unsubscribe:')) {
      const parts = customId.split(':')
      const senderUserId = parts[1]
      const calendarId = parts[2]

      try {
        await handleUnsubscribe(supabase, interaction.user.id, senderUserId, calendarId)

        // Build a link to the Coordination Calendar so the user can re-subscribe manually
        let calendarLink = ''
        if (calendarId) {
          try {
            const { data: cal } = await supabase
              .from('calendars')
              .select('hash')
              .eq('id', calendarId)
              .maybeSingle()
            if (cal?.hash) {
              calendarLink = `\n\nTo re-subscribe, visit the Coordination Calendar directly: <https://coordinationmanager.com/calendar/${cal.hash}>`
            }
          } catch { /* calendar link not available */ }
        }

        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: `🔕 You've unsubscribed from this initiative. You won't receive further updates about it.${calendarLink || '\n\nTo re-subscribe, visit the Coordination Calendar page directly.'}`,
            flags: MessageFlags.Ephemeral | MessageFlags.SuppressEmbeds,
          })
        }
      } catch (err) {
        console.error('Unsubscribe button error:', err)
        try {
          if (interaction.deferred) {
            await interaction.editReply({ content: 'Something went wrong processing your unsubscription. Please try again.' })
          } else if (!interaction.replied) {
            await interaction.reply({ content: 'Something went wrong processing your unsubscription. Please try again.', flags: 64 })
          }
        } catch { /* interaction expired or already handled */ }
      }
      return
    }

    // ── Opt Out button (block all DMs from this sender) ──
    if (customId.startsWith('dm_optout:')) {
      const senderUserId = customId.split(':')[1]

      try {
        await handleOptOut(supabase, interaction.user.id, senderUserId)

        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '✅ You\'ve been opted out. You won\'t receive further DMs from this sender through Swarm Coordinator.\n\nTo undo, use `/optout undo` (here or in any server with this bot; it removes all your DM opt-outs).',
            flags: 64,
          })
        }
      } catch (err) {
        console.error('Opt-out button error:', err)
        try {
          if (interaction.deferred) {
            await interaction.editReply({ content: 'Something went wrong processing your opt-out. Please try again.' })
          } else if (!interaction.replied) {
            await interaction.reply({ content: 'Something went wrong processing your opt-out. Please try again.', flags: 64 })
          }
        } catch { /* interaction expired or already handled */ }
      }
      return
    }
  }

  if (!interaction.isChatInputCommand()) return

  try {
    switch (interaction.commandName) {
      case 'link':
        await handleLink(interaction)
        break
      case 'status':
        await handleStatus(interaction)
        break
      case 'channels':
        await handleChannels(interaction)
        break
      case 'feedback':
        await handleFeedback(interaction)
        break
      case 'optout':
        await handleOptOutCommand(interaction)
        break
      default:
        await interaction.reply({ content: 'Unknown command.', ephemeral: true })
    }
  } catch (err) {
    console.error(`Error handling /${interaction.commandName}:`, err)
    try {
      const msg = { content: 'An error occurred. Please try again.' }
      if (interaction.deferred) {
        await interaction.editReply(msg)
      } else if (!interaction.replied) {
        await interaction.reply({ ...msg, flags: 64 })
      }
    } catch { /* interaction already expired, nothing we can do */ }
  }
})

client.on(Events.MessageCreate, async (message) => {
  if (message.channel.type === ChannelType.DM) {
    await handleDM(message)
  }
})

// ─── Start ────────────────────────────────────────────────────────────

// ─── Prevent unhandled rejections from crashing the process ──────────

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err)
})

client.login(DISCORD_TOKEN)
