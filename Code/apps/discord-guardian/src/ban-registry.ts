import { DiscordAPIError, HTTPError, PermissionFlagsBits, type Client } from 'discord.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchMemberOrAbsent } from './ban-preview.js'

interface BanEntry {
  id: string
  guild_id: string
  discord_user_id: string
  reason: string
  requested_by: string
  requested_by_discord_id: string
  attempts: number
  processing_token: string
  action: 'ban' | 'unban'
}

export const BAN_WORKER_INTERVAL_MS = 5000
const MAX_ATTEMPTS = 5
export class BanRegistryTransientError extends Error {}
class BanReceiptError extends Error {}

interface BanResult {
  status: 'banned' | 'pending' | 'failed'
  banned_at?: string
  next_attempt_at?: string
  last_error: string | null
}

export function banRetryDelay(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 15 * 60_000)
}

export function isRetryableBanError(error: unknown): boolean {
  if (error instanceof BanRegistryTransientError) return true
  if (error instanceof DiscordAPIError || error instanceof HTTPError) return error.status === 429 || error.status >= 500
  return error instanceof Error && (
    error.name === 'AbortError' || error.name === 'TimeoutError' ||
    error.message.includes('ECONNRESET') || error.message.includes('ETIMEDOUT') ||
    error.message.includes('ENOTFOUND') || error.message.includes('fetch failed')
  )
}

function isBanEntry(value: unknown): value is BanEntry {
  if (typeof value !== 'object' || value === null) return false
  return 'id' in value && typeof value.id === 'string' &&
    'guild_id' in value && typeof value.guild_id === 'string' &&
    'discord_user_id' in value && typeof value.discord_user_id === 'string' &&
    'reason' in value && typeof value.reason === 'string' &&
    'requested_by' in value && typeof value.requested_by === 'string' &&
    'requested_by_discord_id' in value && typeof value.requested_by_discord_id === 'string' &&
    'attempts' in value && typeof value.attempts === 'number' &&
    'processing_token' in value && typeof value.processing_token === 'string' &&
    'action' in value && (value.action === 'ban' || value.action === 'unban')
}

export class BanRegistryWorker {
  private busy = false
  private syncAfter = ''
  private recoveryRequested = true
  private recoveryVersion = 0
  private wasLeader = false

  requestRecovery(): void {
    this.recoveryRequested = true
    this.syncAfter = ''
    ++this.recoveryVersion
  }

  constructor(private readonly options: {
    database: SupabaseClient
    client: Client
    isLeader: () => boolean
    instanceId: string
  }) {}

  async enqueueJoin(guildId: string, discordId: string): Promise<void> {
    if (!this.options.isLeader()) return
    const { error } = await this.options.database.rpc('enqueue_guardian_join_ban', {
      p_guild_id: guildId, p_discord_id: discordId,
    })
    if (error) throw new Error(`Failed to queue Guardian join ban: ${error.message}`)
  }

  async tick(): Promise<void> {
    const leader = this.options.isLeader()
    if (!leader) { this.wasLeader = false; return }
    if (!this.wasLeader) { this.wasLeader = true; this.requestRecovery() }
    if (this.busy) return
    this.busy = true
    try {
      await this.syncServers()
      const { data, error } = await this.options.database.rpc('claim_guardian_ban', {
        p_instance_id: this.options.instanceId,
      })
      if (error) throw new Error(`Failed to claim Guardian ban: ${error.message}`)
      if (!Array.isArray(data)) throw new Error('Invalid Guardian ban claim response')
      if (data.length === 0) return
      const entry: unknown = data[0]
      if (!isBanEntry(entry)) throw new Error('Invalid Guardian ban queue entry')
      await this.process(entry)
    } finally {
      this.busy = false
    }
  }

  private async syncServers(): Promise<void> {
    if (!this.recoveryRequested) return
    const version = this.recoveryVersion
    const guildIds = [...this.options.client.guilds.cache.keys()].sort()
    if (!guildIds.length) return
    const { data, error } = await this.options.database.rpc('recover_guardian_global_bans', {
      p_guild_ids: guildIds, p_after: this.syncAfter,
    })
    if (error) throw new Error(`Failed to reconcile global bans: ${error.message}`)
    const page: unknown = Array.isArray(data) ? data[0] : null
    if (typeof page !== 'object' || page === null || !('account_count' in page) ||
      typeof page.account_count !== 'number' || !('last_id' in page) ||
      (page.last_id !== null && typeof page.last_id !== 'string')) throw new Error('Invalid global ban reconciliation response')
    if (version !== this.recoveryVersion) return
    this.syncAfter = page.account_count === 100 && typeof page.last_id === 'string' ? page.last_id : ''
    if (!this.syncAfter) this.recoveryRequested = false
  }

  private async process(entry: BanEntry): Promise<void> {
    let result: BanResult
    try {
      const { database, client } = this.options
      const { data: actor, error: actorError } = await database.from('users')
        .select('roles').eq('id', entry.requested_by).maybeSingle()
      if (actorError) throw new BanRegistryTransientError('Guardian ban issuer lookup temporarily failed')
      if (!Array.isArray(actor?.roles) || !actor.roles.includes('moderator')) {
        throw new Error('Requesting account no longer has the Guardian moderator role')
      }
      const { data: link, error: linkError } = await database.from('discord_integrations')
        .select('id').eq('user_id', entry.requested_by)
        .eq('discord_user_id', entry.requested_by_discord_id)
        .eq('is_active', true).eq('bot_verified', true).maybeSingle()
      if (linkError) throw new BanRegistryTransientError('Guardian ban link lookup temporarily failed')
      if (!link) throw new Error('Requesting account no longer has its verified Discord link')

      const guild = await client.guilds.fetch({ guild: entry.guild_id, force: true })
      await guild.roles.fetch()
      const bot = await guild.members.fetchMe({ force: true })
      if (!bot.permissions.has(PermissionFlagsBits.BanMembers)) {
        throw new Error('Demon X no longer has Ban Members permission')
      }
      if (entry.action === 'ban' && [guild.ownerId, client.user?.id, entry.requested_by_discord_id].includes(entry.discord_user_id)) {
        throw new Error('Protected account cannot be banned through the registry')
      }

      let alreadyBanned = false
      try {
        await guild.bans.fetch({ user: entry.discord_user_id, force: true, cache: false })
        alreadyBanned = true
      } catch (error) {
        if (!(error instanceof DiscordAPIError) || error.code !== 10026) throw error
      }
      const member = entry.action === 'unban' || alreadyBanned ? null : await fetchMemberOrAbsent(client, entry.guild_id, entry.discord_user_id)
      if (member && !member.bannable) throw new Error('Discord role hierarchy prevents banning this member')

      // Recheck persistent lease and enabled state immediately before the Discord write.
      const { data: lock, error: lockError } = await database.from('guardian_instance_lock')
        .select('instance_id').eq('id', 'singleton')
        .eq('instance_id', this.options.instanceId)
        .gt('heartbeat_at', new Date(Date.now() - 30_000).toISOString()).maybeSingle()
      if (lockError) throw new BanRegistryTransientError('Guardian ban lease check temporarily failed')
      if (!lock || !this.options.isLeader()) return
      const { data: enabled, error: enabledError } = await database.from('guardian_ban_entries')
        .select('id').eq('id', entry.id).eq('is_enabled', true)
        .eq('processing_token', entry.processing_token).eq('action', entry.action).maybeSingle()
      if (enabledError) throw new BanRegistryTransientError('Guardian ban state check temporarily failed')
      if (!enabled) return
      const { data: account, error: accountError } = await database.from('guardian_ban_accounts')
        .select('is_active').eq('discord_user_id', entry.discord_user_id).maybeSingle()
      if (accountError) throw new BanRegistryTransientError('Guardian registry intent check temporarily failed')
      if (!account || typeof account.is_active !== 'boolean') throw new Error('Global registry account state is missing')
      if (account.is_active !== (entry.action === 'ban')) {
        console.log('[ban-registry] Superseded operation cancelled:', { entryId: entry.id, action: entry.action })
        const { error } = await database.from('guardian_ban_entries').update({
          is_enabled: false, status: 'registered', processing_token: null, processing_started_at: null,
        }).eq('id', entry.id).eq('processing_token', entry.processing_token)
        if (error) throw new BanReceiptError(`Failed to cancel superseded registry operation: ${error.message}`)
        return
      }

      let wrote = false
      if (entry.action === 'unban' && alreadyBanned) {
        await guild.bans.remove(entry.discord_user_id, 'Removed from global Guardian ban registry')
        wrote = true
      } else if (entry.action === 'ban' && !alreadyBanned) {
        await guild.bans.create(entry.discord_user_id, {
          reason: 'Global Guardian ban registry',
          deleteMessageSeconds: 0,
        })
        wrote = true
      }
      // Receipt and counter commit together. Retry this write, never the Discord action.
      const receipt = {
        p_entry: entry.id, p_token: entry.processing_token, p_removed: member !== null,
        p_action: entry.action, p_wrote: wrote,
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        const { error } = await database.rpc('report_guardian_registry_write', receipt)
        if (!error) return
        if (attempt === 2) throw new BanReceiptError(`Failed to persist confirmed ban: ${error.message}`)
      }
      return
    } catch (error) {
      if (error instanceof BanReceiptError) throw error
      const retry = entry.attempts < MAX_ATTEMPTS && isRetryableBanError(error)
      const detail = error instanceof DiscordAPIError
        ? `Discord error ${error.code} (HTTP ${error.status})`
        : error instanceof HTTPError ? `Discord HTTP error ${error.status}`
        : error instanceof Error ? error.message : 'Unknown Guardian ban failure'
      console.error('[ban-registry] Operation failed:', { guildId: entry.guild_id, userId: entry.discord_user_id, action: entry.action, retry, detail })
      result = {
        status: retry ? 'pending' : 'failed',
        next_attempt_at: new Date(Date.now() + banRetryDelay(entry.attempts)).toISOString(),
        last_error: detail.replace(/[\r\n]/g, ' ').slice(0, 500),
      }
    }
    // A failed result write leaves the claim for idempotent recovery, not a false failed ban.
    await this.finish(entry, result)
  }

  private async finish(entry: BanEntry, updates: BanResult): Promise<void> {
    const { error } = await this.options.database.from('guardian_ban_entries')
      .update({ ...updates, processing_started_at: null, processing_token: null, updated_at: new Date().toISOString() })
      .eq('id', entry.id).eq('processing_token', entry.processing_token)
    if (error) throw new Error(`Failed to persist Guardian ban result: ${error.message}`)
  }
}
