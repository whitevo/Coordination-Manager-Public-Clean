import { Router, type Response, type NextFunction } from 'express'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import { hasRole } from '../middleware/auth.js'
import { supabaseAdmin } from '../supabaseClient.js'
import { ApplicationError, ValidationError } from '../middleware/error-handler.js'
import { sanitizeUUID } from '../middleware/validation.js'
import {
  BanPermissionError, guardianBotId, guardianGuilds,
  linkedDiscordUser, parseBanIds,
} from '../services/guardian-ban-authority.js'

const router: ReturnType<typeof Router> = Router()

router.use((req: AuthenticatedRequest, _res, next) => {
  if (!hasRole(req, 'moderator') || !req.userId) return next(new BanPermissionError('Guardian moderator role required'))
  next()
})

async function readEntries(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const offset = (req.method === 'POST' ? req.body.offset : req.query.offset) ?? '0'
    if (typeof offset !== 'string' || !/^\d+$/.test(offset) || Number(offset) > 1_000_000) {
      throw new ValidationError('Invalid entry offset')
    }
    const ids = req.method === 'POST' ? parseBanIds(req.body.discord_ids) : null
    let query = supabaseAdmin.from('guardian_ban_accounts')
      .select('discord_user_id, created_at, boot_count, last_booted_at', { count: 'exact' }).eq('is_active', true)
    if (ids) query = query.in('discord_user_id', ids)
    const { data, error, count } = await query
      .order('created_at', { ascending: false }).order('discord_user_id')
      .range(Number(offset), Number(offset) + 99)
    if (error) throw new ApplicationError('Failed to read global ban registry', 503, 'BAN_REGISTRY_READ_FAILED')
    const { data: failures, error: failureError } = await supabaseAdmin.from('guardian_ban_entries')
      .select('guild_id, discord_user_id, last_error, action').eq('status', 'failed').eq('is_enabled', true).limit(20)
    if (failureError) throw new ApplicationError('Failed to read ban enforcement errors', 503, 'BAN_REGISTRY_READ_FAILED')
    res.json({ entries: data || [], total: count || 0, failures: failures || [] })
  } catch (error) { next(error) }
}
router.get('/entries', readEntries)
router.post('/search', readEntries)

router.post('/matching-ids', async (req: AuthenticatedRequest, res, next) => {
  try {
    const ids = parseBanIds(req.body.discord_ids)
    const { data, error } = await supabaseAdmin.from('guardian_ban_accounts')
      .select('discord_user_id').eq('is_active', true).in('discord_user_id', ids)
    if (error) throw new ApplicationError('Failed to select matching IDs', 503, 'BAN_REGISTRY_READ_FAILED')
    res.json({ ids: (data || []).map(row => row.discord_user_id) })
  } catch (error) { next(error) }
})

router.post('/remove', async (req: AuthenticatedRequest, res, next) => {
  try {
    if (req.body.confirmed !== true) throw new ValidationError('Explicit removal and global unban confirmation is required')
    const ids = parseBanIds(req.body.discord_ids)
    const discordUserId = await linkedDiscordUser(req.userId!)
    const guilds = await guardianGuilds()
    const { data, error } = await supabaseAdmin.rpc('remove_guardian_global_bans', {
      p_discord_ids: ids, p_guild_ids: guilds.map(guild => guild.id),
      p_actor: req.userId!, p_actor_discord: discordUserId,
    })
    if (error) throw new ApplicationError('Failed to remove registry IDs', 503, 'BAN_REGISTRY_WRITE_FAILED')
    res.json({ removed: data, unbans_queued: true })
  } catch (error) { next(error) }
})

router.post('/preview', async (req: AuthenticatedRequest, res, next) => {
  try {
    const ids = parseBanIds(req.body.discord_ids)
    const discordUserId = await linkedDiscordUser(req.userId!)
    const botId = await guardianBotId()
    if (ids.includes(discordUserId) || ids.includes(botId)) {
      throw new ValidationError('Demon X and your own account cannot be imported')
    }
    const guilds = await guardianGuilds()
    if (guilds.length === 0) throw new ValidationError('Demon X is not connected to any servers')
    const { data, error } = await supabaseAdmin.from('guardian_ban_previews')
      .insert({
        created_by: req.userId!, actor_discord_id: discordUserId,
        discord_ids: ids, guild_ids: guilds.map(guild => guild.id).sort(),
      }).select('id').single()
    if (error || !data) throw new ApplicationError('Failed to start ban preview', 503, 'BAN_PREVIEW_WRITE_FAILED')
    res.status(202).json({ preview_id: data.id })
  } catch (error) { next(error) }
})

router.get('/preview/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const id = sanitizeUUID(req.params.id)
    if (!id) throw new ValidationError('Invalid preview ID')
    const { data, error } = await supabaseAdmin.from('guardian_ban_previews')
      .select('*').eq('id', id).eq('created_by', req.userId!).maybeSingle()
    if (error) throw new ApplicationError('Failed to read ban preview', 503, 'BAN_PREVIEW_READ_FAILED')
    if (!data) throw new ApplicationError('Ban preview not found', 404, 'BAN_PREVIEW_NOT_FOUND')
    const { data: registered, error: registeredError } = await supabaseAdmin.from('guardian_ban_accounts')
      .select('discord_user_id').eq('is_active', true).in('discord_user_id', data.discord_ids)
    if (registeredError) throw new ApplicationError('Failed to check global registry', 503, 'BAN_REGISTRY_READ_FAILED')
    const registeredIds = new Set<string>((registered || []).map(row => row.discord_user_id))
    const expired = new Date(data.expires_at).getTime() <= Date.now()
    res.json({
      id: data.id, status: data.status, expired, error: data.last_error,
      confirmation_requested: data.confirmation_requested,
      checked: data.cursor, checks_total: data.confirmation_requested ? data.guild_ids.length : data.discord_ids.length * data.guild_ids.length,
      servers: data.guild_ids.length,
      rows: data.discord_ids.map((discordId: string) => ({
        discord_user_id: discordId,
        member_servers: data.status === 'ready' || data.confirmation_requested ? data.member_counts[discordId] ?? 0 : null,
        already_registered: registeredIds.has(discordId),
      })),
    })
  } catch (error) { next(error) }
})

router.post('/confirm', async (req: AuthenticatedRequest, res, next) => {
  try {
    if (req.body.confirmed !== true) throw new ValidationError('Explicit confirmation is required')
    const id = sanitizeUUID(req.body.preview_id)
    if (!id) throw new ValidationError('Invalid preview ID')
    const { data: preview, error: readError } = await supabaseAdmin.from('guardian_ban_previews')
      .select('*').eq('id', id).eq('created_by', req.userId!).maybeSingle()
    if (readError) throw new ApplicationError('Failed to read ban preview', 503, 'BAN_PREVIEW_READ_FAILED')
    if (!preview) throw new ApplicationError('Ban preview not found', 404, 'BAN_PREVIEW_NOT_FOUND')
    if (preview.status === 'confirmed') { res.json({ added: 0, already_confirmed: true }); return }
    if (preview.confirmation_requested && ['confirming', 'processing'].includes(preview.status)) {
      res.status(202).json({ queued: true }); return
    }
    if (preview.status !== 'ready' || new Date(preview.expires_at).getTime() <= Date.now()) {
      throw new ValidationError('Preview is incomplete or expired; submit the IDs again')
    }
    const discordUserId = await linkedDiscordUser(req.userId!)
    if (discordUserId !== preview.actor_discord_id) throw new BanPermissionError('Discord link changed; create a new preview')
    const guilds = await guardianGuilds()
    if (JSON.stringify(guilds.map(guild => guild.id).sort()) !== JSON.stringify(preview.guild_ids)) {
      throw new ValidationError('Connected servers changed; submit the IDs again')
    }
    const { data: queued, error } = await supabaseAdmin.from('guardian_ban_previews').update({
      status: 'confirming', confirmation_requested: true, cursor: 0, last_error: null,
    }).eq('id', id).eq('created_by', req.userId!).eq('status', 'ready').eq('confirmation_requested', false)
      .select('id').maybeSingle()
    if (error) throw new ApplicationError('Failed to confirm registry; refresh the preview before retrying', 503, 'BAN_REGISTRY_WRITE_FAILED')
    if (!queued) throw new ApplicationError('Preview changed; refresh it before confirming', 409, 'BAN_PREVIEW_CHANGED')
    res.status(202).json({ queued: true })
  } catch (error) { next(error) }
})

export default router
