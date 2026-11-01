import { DiscordAPIError, PermissionFlagsBits, type Client, type Guild } from 'discord.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { BanRegistryTransientError, isRetryableBanError } from './ban-registry.js'

interface BanPreview {
  id: string
  discord_ids: string[]
  guild_ids: string[]
  cursor: number
  member_counts: Record<string, number>
  actor_discord_id: string
  processing_token: string
  confirmation_requested: boolean
  created_by: string
}

function isPreview(value: unknown): value is BanPreview {
  if (typeof value !== 'object' || value === null) return false
  if (!('id' in value) || typeof value.id !== 'string' ||
    !('processing_token' in value) || typeof value.processing_token !== 'string' ||
    !('actor_discord_id' in value) || typeof value.actor_discord_id !== 'string' ||
    !('created_by' in value) || typeof value.created_by !== 'string' ||
    !('confirmation_requested' in value) || typeof value.confirmation_requested !== 'boolean' ||
    !('discord_ids' in value) || !Array.isArray(value.discord_ids) || !value.discord_ids.every(id => typeof id === 'string') ||
    !('guild_ids' in value) || !Array.isArray(value.guild_ids) || !value.guild_ids.every(id => typeof id === 'string') ||
    !('cursor' in value) || typeof value.cursor !== 'number' ||
    !('member_counts' in value) || typeof value.member_counts !== 'object' || value.member_counts === null) return false
  return Object.values(value.member_counts).every(count => typeof count === 'number' && Number.isInteger(count) && count >= 0)
}

export async function fetchMemberOrAbsent(client: Client, guildId: string, userId: string) {
  const guild = await client.guilds.fetch(guildId)
  try {
    return await guild.members.fetch({ user: userId, force: true })
  } catch (error) {
    if (error instanceof DiscordAPIError && error.code === 10007) return null
    throw error
  }
}

export class BanPreviewWorker {
  private busy = false

  constructor(private readonly options: {
    database: SupabaseClient
    client: Client
    isLeader: () => boolean
    instanceId: string
  }) {}

  async tick(): Promise<void> {
    if (this.busy || !this.options.isLeader()) return
    this.busy = true
    try {
      const { database, client } = this.options
      const { data, error } = await database.rpc('claim_guardian_ban_preview', { p_instance_id: this.options.instanceId })
      if (error) throw new Error(`Failed to claim ban preview: ${error.message}`)
      if (!Array.isArray(data)) throw new Error('Invalid ban preview claim response')
      if (!data.length) return
      const preview: unknown = data[0]
      if (!isPreview(preview)) throw new Error('Invalid ban preview job')
      let cursor = preview.cursor
      const counts = { ...preview.member_counts }
      let status: 'pending' | 'confirming' | 'ready' | 'failed' = preview.confirmation_requested ? 'confirming' : 'pending'
      let detail: string | null = null
      const total = preview.confirmation_requested ? preview.guild_ids.length : preview.discord_ids.length * preview.guild_ids.length
      try {
        if (preview.confirmation_requested) {
          if (JSON.stringify([...client.guilds.cache.keys()].sort()) !== JSON.stringify(preview.guild_ids)) {
            throw new Error('Connected servers changed; submit the IDs again')
          }
          const { data: actor, error: actorError } = await database.from('users')
            .select('roles').eq('id', preview.created_by).maybeSingle()
          if (actorError) throw new BanRegistryTransientError('Failed to verify ban preview issuer')
          if (!Array.isArray(actor?.roles) || !actor.roles.includes('moderator')) throw new Error('Website moderator role revoked')
          const { data: link, error: linkError } = await database.from('discord_integrations')
            .select('id').eq('user_id', preview.created_by).eq('discord_user_id', preview.actor_discord_id)
            .eq('is_active', true).eq('bot_verified', true).maybeSingle()
          if (linkError) throw new BanRegistryTransientError('Failed to verify ban preview Discord link')
          if (!link) throw new Error('Verified Discord link revoked')
        }
        // Bounded chunks survive restarts without holding an API request open.
        const end = Math.min(cursor + 10, total)
        const verifiedGuilds = new Map<string, Guild>()
        while (cursor < end && this.options.isLeader()) {
          const guildId = preview.guild_ids[preview.confirmation_requested ? cursor : Math.floor(cursor / preview.discord_ids.length)]
          const discordId = preview.discord_ids[cursor % preview.discord_ids.length]
          let guild = verifiedGuilds.get(guildId)
          if (!guild) {
            guild = await client.guilds.fetch({ guild: guildId, force: true })
            await guild.roles.fetch()
            const bot = await guild.members.fetchMe({ force: true })
            if (!bot.permissions.has(PermissionFlagsBits.BanMembers)) {
              throw new Error(`Demon X needs Ban Members permission in server ${guildId}`)
            }
            verifiedGuilds.set(guildId, guild)
          }
          const checkedIds = preview.confirmation_requested ? preview.discord_ids : [discordId]
          const ownerId = guild.ownerId
          if (checkedIds.some(id => [ownerId, client.user?.id, preview.actor_discord_id].includes(id))) {
            throw new Error(`Protected account ${discordId} cannot be globally banned`)
          }
          if (!preview.confirmation_requested) {
            const member = await fetchMemberOrAbsent(client, guildId, discordId)
            counts[discordId] = (counts[discordId] || 0) + (member ? 1 : 0)
          }
          cursor++
        }
        if (preview.confirmation_requested && cursor === total && this.options.isLeader()) {
          const { error: confirmError } = await database.rpc('confirm_guardian_global_bans', {
            p_preview: preview.id, p_actor: preview.created_by, p_token: preview.processing_token,
          })
          if (confirmError) throw new BanRegistryTransientError(`Failed to save global registry: ${confirmError.message}`)
          return
        }
        status = preview.confirmation_requested ? 'confirming' : cursor === total ? 'ready' : 'pending'
      } catch (failure) {
        status = isRetryableBanError(failure) ? preview.confirmation_requested ? 'confirming' : 'pending' : 'failed'
        detail = failure instanceof Error ? failure.message.replace(/[\r\n]/g, ' ').slice(0, 500) : 'Unknown preview lookup failure'
        console.error('[ban-preview] Membership check failed:', { previewId: preview.id, detail })
      }
      const { error: writeError } = await database.from('guardian_ban_previews').update({
        cursor, member_counts: counts, status, last_error: detail,
        processing_token: null, processing_started_at: null,
        ...(status === 'ready' ? { expires_at: new Date(Date.now() + 30 * 60_000).toISOString() } : {}),
      }).eq('id', preview.id).eq('processing_token', preview.processing_token)
      if (writeError) throw new Error(`Failed to persist ban preview: ${writeError.message}`)
    } finally { this.busy = false }
  }
}
