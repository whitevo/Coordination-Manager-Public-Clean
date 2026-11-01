/**
 * Guardian moderator undo actions.
 *
 *   POST /api/guardian/flagged/:id/unban      -- lift the Discord ban for the flagged message author
 *   POST /api/guardian/flagged/:id/untimeout  -- remove the Discord timeout for the flagged message author
 *
 * Mounted from routes/guardian.ts (after authMiddleware). Moderator role
 * required. The API calls Discord REST with GUARDIAN_BOT_TOKEN; the token is
 * never returned or logged. Every attempted Discord write records one
 * guardian_action_log row (action 'unban' | 'unmute', actor_kind 'moderator').
 *
 * Ban registry interplay: an author with an active global Ban list entry
 * (guardian_ban_accounts.is_active) is re-banned by the registry when they
 * rejoin, so a per-server unban here would silently fight the registry. Those
 * requests get 409 GUARDIAN_BAN_REGISTRY_ACTIVE and the moderator is pointed
 * to the Ban list, whose removal flow queues a global unban.
 */
import { Router, type Response, type NextFunction } from 'express'
import { hasRole, type AuthenticatedRequest } from '../middleware/auth.js'
import { supabaseAdmin } from '../supabaseClient.js'
import { ApplicationError, ValidationError } from '../middleware/error-handler.js'
import { sanitizeUUID } from '../middleware/validation.js'
import { isDiscordId } from '../services/guardian-ban-authority.js'

const router: ReturnType<typeof Router> = Router()

const DISCORD_API = 'https://discord.com/api/v10'
const DISCORD_TIMEOUT_MS = 10_000
const DISCORD_UNKNOWN_GUILD = 10004
const DISCORD_UNKNOWN_MEMBER = 10007
const DISCORD_UNKNOWN_BAN = 10026
const DISCORD_MISSING_PERMISSIONS = 50013

type UndoKind = 'unban' | 'untimeout'
type LogAction = 'unban' | 'unmute'
export type UndoStatus = 'unbanned' | 'already_unbanned' | 'timeout_removed' | 'not_timed_out'

interface FlaggedRow {
  id: string
  guild_id: string
  guild_name: string | null
  channel_id: string | null
  channel_name: string | null
  message_id: string | null
  author_id: string
  author_username: string | null
  action_taken: string | null
  matched_rule_id: string | null
  matched_rule_group_id: string | null
  matched_rule_group_name: string | null
}

interface DiscordResult {
  status: number
  code: number | null
  body: unknown
}

function actionTokens(actionTaken: string | null): string[] {
  return (actionTaken || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
}

export function wasBanned(actionTaken: string | null): boolean {
  const tokens = actionTokens(actionTaken)
  return tokens.includes('banned') || tokens.includes('ban')
}

export function wasTimedOut(actionTaken: string | null): boolean {
  const tokens = actionTokens(actionTaken)
  return tokens.includes('timeout') || tokens.includes('mute') || tokens.includes('muted')
}

const oneLine = (value: string, max = 500): string => value.replace(/[\r\n]+/g, ' ').slice(0, max)

async function discordRequest(options: {
  method: 'GET' | 'DELETE' | 'PATCH'
  path: string
  token: string
  reason?: string
  body?: Record<string, unknown>
}): Promise<DiscordResult> {
  const headers: Record<string, string> = { Authorization: `Bot ${options.token}` }
  // Discord requires the audit log reason to be URL-encoded.
  if (options.reason) headers['X-Audit-Log-Reason'] = encodeURIComponent(oneLine(options.reason, 400))
  if (options.body) headers['Content-Type'] = 'application/json'
  let response: globalThis.Response
  try {
    response = await fetch(`${DISCORD_API}${options.path}`, {
      method: options.method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS),
    })
  } catch {
    return { status: 0, code: null, body: null }
  }
  let body: unknown = null
  if (response.status !== 204) {
    try { body = await response.json() } catch { body = null }
  }
  const code = typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'number'
    ? body.code : null
  return { status: response.status, code, body }
}

function discordFailureReason(result: DiscordResult): string {
  if (result.status === 0) return 'Discord request failed (network or timeout)'
  return `Discord error ${result.code ?? 'unknown'} (HTTP ${result.status})`
}

function discordFailureError(result: DiscordResult, kind: UndoKind): ApplicationError {
  if (result.status === 429) {
    return new ApplicationError('Discord is rate limiting requests; try again shortly', 503, 'DISCORD_RATE_LIMITED')
  }
  if (result.status === 403 || result.code === DISCORD_MISSING_PERMISSIONS) {
    const permission = kind === 'unban' ? 'Ban Members' : 'Moderate Members'
    return new ApplicationError(
      `Demon X lacks the ${permission} permission or role position for this server`,
      502,
      'DISCORD_PERMISSION_DENIED',
    )
  }
  if (result.code === DISCORD_UNKNOWN_GUILD) {
    return new ApplicationError('Demon X is no longer in this server', 409, 'GUARDIAN_GUILD_UNAVAILABLE')
  }
  if (result.status === 0) {
    return new ApplicationError('Discord could not be reached; try again', 502, 'DISCORD_UNREACHABLE')
  }
  return new ApplicationError('Discord rejected the request', 502, 'DISCORD_ACTION_FAILED')
}

async function loadFlagged(id: string): Promise<FlaggedRow> {
  const { data, error } = await supabaseAdmin
    .from('guardian_flagged_messages')
    .select('id, guild_id, guild_name, channel_id, channel_name, message_id, author_id, author_username, action_taken, matched_rule_id, matched_rule_group_id, matched_rule_group_name')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new ApplicationError('Failed to load flagged message', 503, 'GUARDIAN_FLAGGED_READ_FAILED')
  if (!data) throw new ApplicationError('Flagged message not found', 404, 'GUARDIAN_FLAGGED_NOT_FOUND')
  const row = data as FlaggedRow
  if (!isDiscordId(row.guild_id) || !isDiscordId(row.author_id)) {
    throw new ApplicationError('Flagged message has no valid Discord server or author', 422, 'GUARDIAN_FLAGGED_INVALID')
  }
  return row
}

/** Best-effort audit row; the Discord write already happened, so a log failure never fails the request. */
async function recordUndo(options: {
  row: FlaggedRow
  action: LogAction
  actorUserId: string
  success: boolean
  note: string | null
}): Promise<boolean> {
  const { row } = options
  const { error } = await supabaseAdmin.from('guardian_action_log').insert({
    action: options.action,
    guild_id: row.guild_id,
    guild_name: row.guild_name,
    channel_id: row.channel_id,
    channel_name: row.channel_name,
    message_id: row.message_id,
    author_id: row.author_id,
    author_username: row.author_username,
    matched_rule_id: row.matched_rule_id,
    matched_rule_group_id: row.matched_rule_group_id,
    matched_rule_group_name: row.matched_rule_group_name,
    actor_kind: 'moderator',
    actor_user_id: options.actorUserId,
    success: options.success,
    failure_reason: options.note ? oneLine(options.note, 200) : null,
    flagged_message_id: row.id,
  })
  if (error) {
    console.error('[guardian-undo] Failed to record action log row:', { action: options.action, flaggedId: row.id })
    return false
  }
  return true
}

// No platform identifiers: server admins can read the Discord audit log.
// The acting moderator is recorded in guardian_action_log.actor_user_id.
function auditReason(kind: UndoKind, row: FlaggedRow): string {
  const verb = kind === 'unban' ? 'unban' : 'remove timeout'
  return `Guardian dashboard: ${verb} by a Coordination Manager moderator (flagged message ${row.message_id ?? row.id})`
}

function requireUndoContext(req: AuthenticatedRequest): { id: string; token: string; actor: string } {
  if (!hasRole(req, 'moderator') || !req.userId) {
    throw new ApplicationError('Moderator role required', 403, 'GUARDIAN_MODERATOR_REQUIRED')
  }
  const id = sanitizeUUID(req.params.id)
  if (!id) throw new ValidationError('Invalid flagged message ID')
  const token = process.env.GUARDIAN_BOT_TOKEN
  if (!token) throw new ApplicationError('Guardian bot is not configured', 503, 'GUARDIAN_NOT_CONFIGURED')
  return { id, token, actor: req.userId }
}

router.post('/flagged/:id/unban', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { id, token, actor } = requireUndoContext(req)
    const row = await loadFlagged(id)
    if (!wasBanned(row.action_taken)) {
      throw new ApplicationError('This flagged message did not lead to a ban', 409, 'GUARDIAN_UNDO_NOT_APPLICABLE')
    }

    const { data: registry, error: registryError } = await supabaseAdmin
      .from('guardian_ban_accounts')
      .select('discord_user_id')
      .eq('discord_user_id', row.author_id)
      .eq('is_active', true)
      .maybeSingle()
    if (registryError) throw new ApplicationError('Failed to check the global ban list', 503, 'BAN_REGISTRY_READ_FAILED')
    if (registry) {
      throw new ApplicationError(
        'This user is on the global Ban list, which re-bans them on every server. Remove them from the Ban list tab to unban them everywhere.',
        409,
        'GUARDIAN_BAN_REGISTRY_ACTIVE',
      )
    }

    const result = await discordRequest({
      method: 'DELETE',
      path: `/guilds/${row.guild_id}/bans/${row.author_id}`,
      token,
      reason: auditReason('unban', row),
    })

    let status: UndoStatus
    let note: string | null = null
    if (result.status === 204 || result.status === 200) {
      status = 'unbanned'
    } else if (result.status === 404 && result.code === DISCORD_UNKNOWN_BAN) {
      status = 'already_unbanned'
      note = 'Already unbanned (Discord Unknown Ban)'
    } else {
      await recordUndo({ row, action: 'unban', actorUserId: actor, success: false, note: discordFailureReason(result) })
      throw discordFailureError(result, 'unban')
    }

    const logged = await recordUndo({ row, action: 'unban', actorUserId: actor, success: true, note })
    res.json({
      action: 'unban',
      status,
      flagged_message_id: row.id,
      undone_at: new Date().toISOString(),
      logged,
      message: status === 'unbanned' ? 'User unbanned' : 'User was not banned on this server',
    })
  } catch (err) {
    next(err)
  }
})

router.post('/flagged/:id/untimeout', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { id, token, actor } = requireUndoContext(req)
    const row = await loadFlagged(id)
    if (!wasTimedOut(row.action_taken)) {
      throw new ApplicationError('This flagged message did not lead to a timeout', 409, 'GUARDIAN_UNDO_NOT_APPLICABLE')
    }

    const memberPath = `/guilds/${row.guild_id}/members/${row.author_id}`
    const memberNotFound = async (): Promise<never> => {
      await recordUndo({ row, action: 'unmute', actorUserId: actor, success: false, note: 'Member not in server (Discord Unknown Member)' })
      throw new ApplicationError(
        'This user is not in the server, so the timeout cannot be removed now. Try again after they rejoin.',
        409,
        'GUARDIAN_MEMBER_NOT_FOUND',
      )
    }

    const current = await discordRequest({ method: 'GET', path: memberPath, token })
    if (current.status === 404 && current.code === DISCORD_UNKNOWN_MEMBER) await memberNotFound()
    if (current.status !== 200) {
      await recordUndo({ row, action: 'unmute', actorUserId: actor, success: false, note: discordFailureReason(current) })
      throw discordFailureError(current, 'untimeout')
    }

    const until = typeof current.body === 'object' && current.body !== null && 'communication_disabled_until' in current.body
      ? current.body.communication_disabled_until : null
    const activeUntil = typeof until === 'string' ? Date.parse(until) : NaN
    let status: UndoStatus
    let note: string | null = null
    if (!Number.isFinite(activeUntil) || activeUntil <= Date.now()) {
      status = 'not_timed_out'
      note = 'No active timeout'
    } else {
      const result = await discordRequest({
        method: 'PATCH',
        path: memberPath,
        token,
        reason: auditReason('untimeout', row),
        body: { communication_disabled_until: null },
      })
      if (result.status === 404 && result.code === DISCORD_UNKNOWN_MEMBER) await memberNotFound()
      if (result.status !== 200 && result.status !== 204) {
        await recordUndo({ row, action: 'unmute', actorUserId: actor, success: false, note: discordFailureReason(result) })
        throw discordFailureError(result, 'untimeout')
      }
      status = 'timeout_removed'
    }

    const logged = await recordUndo({ row, action: 'unmute', actorUserId: actor, success: true, note })
    res.json({
      action: 'unmute',
      status,
      flagged_message_id: row.id,
      undone_at: new Date().toISOString(),
      logged,
      message: status === 'timeout_removed' ? 'Timeout removed' : 'User has no active timeout',
    })
  } catch (err) {
    next(err)
  }
})

export default router
