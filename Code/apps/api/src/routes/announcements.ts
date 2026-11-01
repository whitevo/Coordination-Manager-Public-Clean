import { Router, Response } from 'express'
import type { Router as RouterType } from 'express'
import { supabaseAdmin } from '../supabaseClient.js'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js'
import { sanitizeString, sanitizeUUID, safeErrorMessage, ANNOUNCEMENT_BODY_MAX_LENGTH } from '../middleware/validation.js'

const router: RouterType = Router()
const SOURCE_ENV = process.env.NODE_ENV || 'development'

// Supabase PostgREST caps responses at max-rows (default 1000).
// This helper paginates with .range() to fetch all matching rows.
const SUPABASE_PAGE_SIZE = 1000
async function fetchAllRows<T = Record<string, unknown>>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const all: T[] = []
  let offset = 0
  for (;;) {
    const { data, error } = await buildQuery(offset, offset + SUPABASE_PAGE_SIZE - 1)
    if (error) throw error
    const rows = data || []
    all.push(...rows)
    if (rows.length < SUPABASE_PAGE_SIZE) break
    offset += SUPABASE_PAGE_SIZE
  }
  return all
}

// All routes require authentication
router.use(authMiddleware)

// ─── GET /api/announcements/templates — List user's templates ─────────────────

router.get('/templates', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('announcement_templates')
      .select('*')
      .eq('user_id', req.userId!)
      .eq('is_archived', false)
      .order('updated_at', { ascending: false })

    if (error) throw error

    res.json({ templates: data || [] })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── POST /api/announcements/templates — Create a template ────────────────

router.post('/templates', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const title = sanitizeString(req.body.title, 200)
    const body = sanitizeString(req.body.body, ANNOUNCEMENT_BODY_MAX_LENGTH)
    const { calendarId, tags, meetingIds, distributionChannelIds, dmRecipientIds } = req.body

    if (!title || !body) {
      return res.status(400).json({ error: 'title and body are required (max 200 / 1800 chars)' })
    }

    const { data, error } = await supabaseAdmin
      .from('announcement_templates')
      .insert({
        user_id: req.userId,
        title,
        body,
        calendar_id: calendarId || null,
        tags: tags || [],
        meeting_ids: Array.isArray(meetingIds) ? meetingIds : [],
        distribution_channel_ids: Array.isArray(distributionChannelIds) ? distributionChannelIds : [],
        dm_recipient_ids: Array.isArray(dmRecipientIds) ? dmRecipientIds : [],
      })
      .select()
      .single()

    if (error) throw error

    res.status(201).json({ template: data })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── PUT /api/announcements/templates/:id — Update a template ─────────────────

router.put('/templates/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const templateId = sanitizeUUID(req.params.id)
    if (!templateId) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Template not found', statusCode: 404 })
    }
    const { title, body, calendarId, tags, meetingIds, distributionChannelIds, dmRecipientIds } = req.body
    const updates: Record<string, unknown> = {}

    if (title !== undefined) updates.title = title
    if (body !== undefined) updates.body = body
    if (calendarId !== undefined) updates.calendar_id = calendarId
    if (tags !== undefined) updates.tags = tags
    if (meetingIds !== undefined) updates.meeting_ids = Array.isArray(meetingIds) ? meetingIds : []
    if (distributionChannelIds !== undefined) updates.distribution_channel_ids = Array.isArray(distributionChannelIds) ? distributionChannelIds : []
    if (dmRecipientIds !== undefined) updates.dm_recipient_ids = Array.isArray(dmRecipientIds) ? dmRecipientIds : []

    const { data, error } = await supabaseAdmin
      .from('announcement_templates')
      .update(updates)
      .eq('id', templateId)
      .eq('user_id', req.userId!)
      .select()
      .maybeSingle()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'NOT_FOUND', message: 'Template not found', statusCode: 404 })

    res.json({ template: data })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── DELETE /api/announcements/templates/:id — Archive a template ─────────────

router.delete('/templates/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const templateId = sanitizeUUID(req.params.id)
    if (!templateId) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Template not found', statusCode: 404 })
    }

    const { data, error } = await supabaseAdmin
      .from('announcement_templates')
      .update({ is_archived: true })
      .eq('id', templateId)
      .eq('user_id', req.userId!)
      .select('id')

    if (error) throw error
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Template not found', statusCode: 404 })
    }

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── GET /api/announcements/schedules — List user's schedules ─────────────────

router.get('/schedules', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const status = req.query.status as string | undefined
    let query = supabaseAdmin
      .from('announcement_schedules')
      .select('*')
      .eq('user_id', req.userId!)
      .order('updated_at', { ascending: false })
      .limit(50)

    if (status) {
      query = query.eq('status', status)
    }

    const { data, error } = await query

    if (error) throw error

    res.json({ schedules: data || [] })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── POST /api/announcements/schedules — Schedule an announcement ─────────────

router.post('/schedules', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { title, body, scheduledAt, timezone, targets, templateId, pollOptions, emailSubject, suppressEmbeds, calendarId } = req.body

    if (!body || !scheduledAt || !targets?.length) {
      return res.status(400).json({ error: 'body, scheduledAt, and targets are required' })
    }

    // Validate body length (Discord limit is 2000, leave room for attribution)
    if (body.length > ANNOUNCEMENT_BODY_MAX_LENGTH) {
      return res.status(400).json({ error: `body exceeds maximum length of ${ANNOUNCEMENT_BODY_MAX_LENGTH} characters` })
    }

    // Validate poll options if provided
    if (pollOptions) {
      if (!Array.isArray(pollOptions) || pollOptions.length > 10) {
        return res.status(400).json({ error: 'pollOptions must be an array of up to 10 items' })
      }
      for (const opt of pollOptions) {
        if (!opt.emoji || !opt.text || typeof opt.emoji !== 'string' || typeof opt.text !== 'string') {
          return res.status(400).json({ error: 'Each poll option must have emoji and text strings' })
        }
        if (opt.emoji.length > 20 || opt.text.length > 200) {
          return res.status(400).json({ error: 'Poll option emoji max 20 chars, text max 200 chars' })
        }
      }
    }

    // Validate targets
    for (const target of targets) {
      if (!target.type || !target.target_id) {
        return res.status(400).json({ error: 'Each target must have type and target_id' })
      }
      if (!['discord_channel', 'discord_dm', 'email'].includes(target.type)) {
        return res.status(400).json({ error: `Invalid target type: ${target.type}` })
      }
      if (typeof target.target_id !== 'string' || target.target_id.length > 200) {
        return res.status(400).json({ error: 'target_id must be a string (max 200 chars)' })
      }
    }

    // Deduplicate targets by type+target_id (prevent the same channel/DM from appearing twice)
    const seenTargetKeys = new Set<string>()
    const dedupedTargets = targets.filter((t: { type: string; target_id: string }) => {
      const key = `${t.type}:${t.target_id}`
      if (seenTargetKeys.has(key)) return false
      seenTargetKeys.add(key)
      return true
    })

    // Dedup: reject if the same user submitted a schedule with the same body AND same scheduled_at
    // in the last 60s. Status is intentionally NOT filtered so that an already-sent immediate (or
    // fast-firing scheduled) entry still blocks an accidental re-click. Including scheduled_at allows
    // per-meeting reminder fan-out (same body, different offsets) to succeed.
    const recentCutoff = new Date(Date.now() - 60_000).toISOString()
    const { data: recentDup } = await supabaseAdmin
      .from('announcement_schedules')
      .select('id')
      .eq('user_id', req.userId!)
      .eq('body', body)
      .eq('scheduled_at', scheduledAt)
      .gte('created_at', recentCutoff)
      .limit(1)
    if (recentDup && recentDup.length > 0) {
      return res.status(409).json({ error: 'Duplicate schedule detected. A matching announcement was already submitted in the last minute.' })
    }

    const { data, error } = await supabaseAdmin
      .from('announcement_schedules')
      .insert({
        user_id: req.userId,
        template_id: templateId || null,
        title: title || '',
        body,
        scheduled_at: scheduledAt,
        timezone: timezone || 'UTC',
        targets: dedupedTargets,
        poll_options: pollOptions || null,
        status: 'pending',
        email_subject: emailSubject || null,
        suppress_embeds: !!suppressEmbeds,
        calendar_id: calendarId || null,
        source_env: SOURCE_ENV,
      })
      .select()
      .single()

    if (error) throw error

    res.status(201).json({ schedule: data })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── POST /api/announcements/send-now — Send immediately ──────────────────────

router.post('/send-now', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { title, body, targets, pollOptions, emailSubject, suppressEmbeds, calendarId } = req.body

    if (!body || !targets?.length) {
      return res.status(400).json({ error: 'body and targets are required' })
    }

    // Validate email subject length
    if (emailSubject && (typeof emailSubject !== 'string' || emailSubject.length > 500)) {
      return res.status(400).json({ error: 'emailSubject too long (max 500 chars)' })
    }

    // Validate body length (Discord limit is 2000, leave room for attribution)
    if (body.length > ANNOUNCEMENT_BODY_MAX_LENGTH) {
      return res.status(400).json({ error: `body exceeds maximum length of ${ANNOUNCEMENT_BODY_MAX_LENGTH} characters` })
    }

    // Deduplicate poll emojis — keep first occurrence of each emoji
    let cleanPollOptions = pollOptions || null
    if (Array.isArray(pollOptions) && pollOptions.length > 0) {
      if (pollOptions.length > 10) {
        return res.status(400).json({ error: 'pollOptions must be an array of up to 10 items' })
      }
      for (const opt of pollOptions) {
        if (!opt.emoji || !opt.text || typeof opt.emoji !== 'string' || typeof opt.text !== 'string') {
          return res.status(400).json({ error: 'Each poll option must have emoji and text strings' })
        }
        if (opt.emoji.length > 20 || opt.text.length > 200) {
          return res.status(400).json({ error: 'Poll option emoji max 20 chars, text max 200 chars' })
        }
      }
      const seen = new Set<string>()
      cleanPollOptions = pollOptions.filter((o: { emoji: string; text: string }) => {
        if (seen.has(o.emoji)) return false
        seen.add(o.emoji)
        return true
      })
    }

    // Validate targets
    for (const target of targets) {
      if (!target.type || !target.target_id) {
        return res.status(400).json({ error: 'Each target must have type and target_id' })
      }
      if (!['discord_channel', 'discord_dm', 'email'].includes(target.type)) {
        return res.status(400).json({ error: `Invalid target type: ${target.type}` })
      }
      if (typeof target.target_id !== 'string' || target.target_id.length > 200) {
        return res.status(400).json({ error: 'target_id must be a string (max 200 chars)' })
      }
    }

    // Deduplicate targets by type+target_id (prevent the same channel/DM from appearing twice)
    const seenTargetKeys = new Set<string>()
    const dedupedTargets = targets.filter((t: { type: string; target_id: string }) => {
      const key = `${t.type}:${t.target_id}`
      if (seenTargetKeys.has(key)) return false
      seenTargetKeys.add(key)
      return true
    })

    // Dedup: reject if the same user submitted a send-now request with the same body in the last 60s.
    // Status is intentionally NOT filtered: an immediate send often completes in seconds (status flips
    // to 'sent'/'partially_sent'/'failed'), and we still want to block accidental re-clicks during the
    // 60s window after the first send finished.
    const recentCutoff = new Date(Date.now() - 60_000).toISOString()
    const { data: recentDup } = await supabaseAdmin
      .from('announcement_schedules')
      .select('id')
      .eq('user_id', req.userId!)
      .eq('body', body)
      .eq('is_immediate', true)
      .gte('created_at', recentCutoff)
      .limit(1)
    if (recentDup && recentDup.length > 0) {
      return res.status(409).json({ error: 'Duplicate send detected. This announcement was already submitted in the last minute.' })
    }

    // ── Pre-check DM subscription statuses to skip the bot for already-blocked recipients ──
    const dmTargets = dedupedTargets.filter((t: { type: string }) => t.type === 'discord_dm')
    const nonDmTargets = dedupedTargets.filter((t: { type: string }) => t.type !== 'discord_dm')
    const preResolvedDms: Array<{ target: { type: string; target_id: string; label?: string }; error: string; status: string }> = []
    let liveTargets = dedupedTargets

    // Fallback: resolve calendarId from meeting URL in body if not explicitly provided
    let resolvedCalendarId = calendarId
    if (!resolvedCalendarId && body && dmTargets.length > 0) {
      const meetingUrlMatch = body.match(/coordinationmanager\.com\/meeting\/([a-f0-9-]+)/i)
      if (meetingUrlMatch) {
        const { data: meeting } = await supabaseAdmin
          .from('meetings')
          .select('calendar_id')
          .eq('id', meetingUrlMatch[1])
          .maybeSingle()
        if (meeting?.calendar_id) resolvedCalendarId = meeting.calendar_id
      }
    }

    if (dmTargets.length > 0 && resolvedCalendarId) {
      const dmDiscordIds = dmTargets.map((t: { target_id: string }) => t.target_id)

      // Batch-check global opt-outs and calendar subscriptions in parallel
      const [optOutResult, inviteResult] = await Promise.all([
        supabaseAdmin
          .from('dm_opt_outs')
          .select('recipient_discord_id')
          .in('recipient_discord_id', dmDiscordIds)
          .or(`sender_user_id.eq.${req.userId!},sender_user_id.is.null`),
        supabaseAdmin
          .from('dm_calendar_invites')
          .select('recipient_discord_id, status')
          .eq('calendar_id', resolvedCalendarId)
          .in('recipient_discord_id', dmDiscordIds),
      ])

      const optedOutIds = new Set(
        (optOutResult.data || []).map((r: { recipient_discord_id: string }) => r.recipient_discord_id)
      )
      const inviteStatusMap = new Map(
        (inviteResult.data || []).map((r: { recipient_discord_id: string; status: string }) => [r.recipient_discord_id, r.status])
      )

      const blockedDmIds = new Set<string>()
      for (const dm of dmTargets as Array<{ type: string; target_id: string; label?: string }>) {
        if (optedOutIds.has(dm.target_id)) {
          blockedDmIds.add(dm.target_id)
          preResolvedDms.push({ target: dm, error: 'Recipient has opted out', status: 'opted_out' })
        } else {
          const inviteStatus = inviteStatusMap.get(dm.target_id)
          if (inviteStatus === 'invited') {
            blockedDmIds.add(dm.target_id)
            preResolvedDms.push({ target: dm, error: 'Recipient did not respond to previous invite', status: 'invited' })
          } else if (inviteStatus === 'unsubscribed') {
            blockedDmIds.add(dm.target_id)
            preResolvedDms.push({ target: dm, error: 'Recipient unsubscribed', status: 'unsubscribed' })
          } else if (inviteStatus === 'opted_out') {
            blockedDmIds.add(dm.target_id)
            preResolvedDms.push({ target: dm, error: 'Recipient opted out', status: 'opted_out' })
          }
          // 'subscribed' or no record (first contact) → pass through to bot
        }
      }

      if (blockedDmIds.size > 0) {
        console.log(`[send-now] Pre-resolved ${blockedDmIds.size} DMs as blocked:`, preResolvedDms.map(d => `${d.target.target_id} (${d.status})`).join(', '))
        const liveDms = dmTargets.filter((t: { target_id: string }) => !blockedDmIds.has(t.target_id))
        liveTargets = [...nonDmTargets, ...liveDms]
      }
    }

    // If ALL targets were pre-resolved as blocked, complete the schedule immediately without the bot
    if (liveTargets.length === 0 && preResolvedDms.length > 0) {
      const failedCount = preResolvedDms.length

      const { data, error } = await supabaseAdmin
        .from('announcement_schedules')
        .insert({
          user_id: req.userId,
          title: title || '',
          body,
          scheduled_at: new Date().toISOString(),
          targets: dedupedTargets,
          poll_options: cleanPollOptions,
          is_immediate: true,
          status: 'failed',
          sent_at: new Date().toISOString(),
          email_subject: emailSubject || null,
          suppress_embeds: !!suppressEmbeds,
          calendar_id: resolvedCalendarId || null,
          error_message: `All ${failedCount} DM recipient(s) blocked: ${preResolvedDms.map(d => d.status).join(', ')}`,
          source_env: SOURCE_ENV,
        })
        .select()
        .single()

      if (error) throw error

      // Create delivery log entries for all pre-resolved DMs
      const logEntries = preResolvedDms.map(d => ({
        schedule_id: data.id,
        channel_type: 'discord_dm',
        target_id: d.target.target_id,
        target_label: d.target.label || null,
        status: 'failed',
        discord_message_id: null,
        error_message: d.error,
        delivered_at: null,
        recipient_response: d.status,
      }))
      await supabaseAdmin.from('announcement_delivery_log').insert(logEntries)

      return res.status(201).json({
        schedule: data,
        message: `All ${failedCount} DM recipient(s) already blocked -- no messages sent`,
        preResolved: true,
      })
    }

    // Create a schedule set to now (the bot will pick it up within 30s)
    const { data, error } = await supabaseAdmin
      .from('announcement_schedules')
      .insert({
        user_id: req.userId,
        title: title || '',
        body,
        scheduled_at: new Date().toISOString(),
        targets: liveTargets,
        poll_options: cleanPollOptions,
        is_immediate: true,
        status: 'pending',
        email_subject: emailSubject || null,
        suppress_embeds: !!suppressEmbeds,
        calendar_id: resolvedCalendarId || null,
        source_env: SOURCE_ENV,
      })
      .select()
      .single()

    if (error) throw error

    // If some DMs were pre-resolved, log them immediately so polling shows results right away
    if (preResolvedDms.length > 0) {
      const logEntries = preResolvedDms.map(d => ({
        schedule_id: data.id,
        channel_type: 'discord_dm',
        target_id: d.target.target_id,
        target_label: d.target.label || null,
        status: 'failed',
        discord_message_id: null,
        error_message: d.error,
        delivered_at: null,
        recipient_response: d.status,
      }))
      await supabaseAdmin.from('announcement_delivery_log').insert(logEntries)
    }

    res.status(201).json({ schedule: data, message: 'Announcement queued for immediate delivery' })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── PUT /api/announcements/schedules/:id/cancel — Cancel a pending schedule ──

router.put('/schedules/:id/cancel', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('announcement_schedules')
      .update({ status: 'cancelled' })
      .eq('id', req.params.id)
      .eq('user_id', req.userId!)
      .eq('status', 'pending')
      .select()
      .single()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Schedule not found or not cancellable' })

    res.json({ schedule: data })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// --- POST /api/announcements/schedules/:id/delete-messages -------------------
// Delete the Discord channel posts and DMs this schedule already delivered.
// Ownership is enforced server-side (404 for other users' schedules). Email
// deliveries cannot be recalled and are only counted as skippedEmail.

const DELETE_BOT_BATCH_SIZE = 500 // matches the bot's per-request cap
const DELETE_BOT_TIMEOUT_MS = 120_000
const DELETE_UPDATE_CHUNK = 100
const DELETE_ERROR_MAX_LENGTH = 300
const DELETE_LOG_IDS_MAX = 5000

interface DeliveryLogDeleteRow {
  id: string
  channel_type: string
  target_id: string
  status: string | null
  discord_message_id: string | null
  deleted_at: string | null
}

interface MessageDeleteResult {
  id: string
  ok: boolean
  error?: string
}

function isDiscordChannelType(value: string): value is 'discord_channel' | 'discord_dm' {
  return value === 'discord_channel' || value === 'discord_dm'
}

function parseBotDeleteResults(body: unknown, pendingIds: Set<string>): MessageDeleteResult[] {
  if (typeof body !== 'object' || body === null || !('results' in body)) return []
  const raw = (body as { results: unknown }).results
  if (!Array.isArray(raw)) return []
  const results: MessageDeleteResult[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const { id, ok, error } = entry as { id?: unknown; ok?: unknown; error?: unknown }
    if (typeof id !== 'string' || !pendingIds.has(id) || typeof ok !== 'boolean') continue
    pendingIds.delete(id)
    const message = typeof error === 'string' && error
      ? error.replace(/[\r\n]+/g, ' ').slice(0, DELETE_ERROR_MAX_LENGTH)
      : 'Delete failed'
    results.push(ok ? { id, ok: true } : { id, ok: false, error: message })
  }
  return results
}

async function callBotDeleteMessages(rows: DeliveryLogDeleteRow[]): Promise<MessageDeleteResult[]> {
  const botApiUrl = process.env.BOT_API_URL || 'http://localhost:3002'
  const botSecret = process.env.BOT_API_SECRET
  if (!botSecret) throw new Error('BOT_API_SECRET is not configured')

  const response = await fetch(`${botApiUrl}/delete-messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bot-secret': botSecret },
    body: JSON.stringify({
      items: rows.map(row => ({
        id: row.id,
        channelType: row.channel_type,
        targetId: row.target_id,
        messageId: row.discord_message_id,
      })),
    }),
    signal: AbortSignal.timeout(DELETE_BOT_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Bot responded with HTTP ${response.status}`)

  const pendingIds = new Set(rows.map(row => row.id))
  const results = parseBotDeleteResults(await response.json(), pendingIds)
  // Any row the bot did not report on counts as a failure
  for (const id of pendingIds) results.push({ id, ok: false, error: 'No result from Discord bot' })
  return results
}

async function persistDeleteResults(scheduleId: string, results: MessageDeleteResult[]): Promise<void> {
  const deletedAt = new Date().toISOString()
  const okIds = results.filter(r => r.ok).map(r => r.id)
  for (let i = 0; i < okIds.length; i += DELETE_UPDATE_CHUNK) {
    const { error } = await supabaseAdmin
      .from('announcement_delivery_log')
      .update({ deleted_at: deletedAt, delete_error: null })
      .eq('schedule_id', scheduleId)
      .in('id', okIds.slice(i, i + DELETE_UPDATE_CHUNK))
    if (error) throw error
  }

  // Group failures by message so one update covers many rows
  const byError = new Map<string, string[]>()
  for (const result of results) {
    if (result.ok) continue
    const message = result.error || 'Delete failed'
    const ids = byError.get(message) || []
    ids.push(result.id)
    byError.set(message, ids)
  }
  for (const [message, ids] of byError) {
    for (let i = 0; i < ids.length; i += DELETE_UPDATE_CHUNK) {
      const { error } = await supabaseAdmin
        .from('announcement_delivery_log')
        .update({ delete_error: message })
        .eq('schedule_id', scheduleId)
        .in('id', ids.slice(i, i + DELETE_UPDATE_CHUNK))
      if (error) throw error
    }
  }
}

router.post('/schedules/:id/delete-messages', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scheduleId = sanitizeUUID(req.params.id)
    if (!scheduleId) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Schedule not found', statusCode: 404 })
    }

    const rawLogIds: unknown = (req.body as { logIds?: unknown } | undefined)?.logIds
    let logIdFilter: Set<string> | null = null
    if (rawLogIds !== undefined) {
      if (!Array.isArray(rawLogIds) || rawLogIds.length === 0 || rawLogIds.length > DELETE_LOG_IDS_MAX) {
        return res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: `logIds must be a non-empty array of up to ${DELETE_LOG_IDS_MAX} ids`,
          statusCode: 400,
        })
      }
      const ids: string[] = []
      for (const raw of rawLogIds) {
        const id = sanitizeUUID(raw)
        if (!id) {
          return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'logIds must contain valid ids', statusCode: 400 })
        }
        ids.push(id)
      }
      logIdFilter = new Set(ids)
    }

    const { data: schedule, error: scheduleError } = await supabaseAdmin
      .from('announcement_schedules')
      .select('id, status')
      .eq('id', scheduleId)
      .eq('user_id', req.userId!)
      .maybeSingle()
    if (scheduleError) throw scheduleError
    if (!schedule) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Schedule not found', statusCode: 404 })
    }
    // Deleting mid-send would leave messages posted after this call untouched
    if (schedule.status === 'sending') {
      return res.status(409).json({
        error: 'SCHEDULE_SENDING',
        message: 'This announcement is still being sent. Try again when sending has finished.',
        statusCode: 409,
      })
    }

    const rows = await fetchAllRows<DeliveryLogDeleteRow>((from, to) =>
      supabaseAdmin
        .from('announcement_delivery_log')
        .select('id, channel_type, target_id, status, discord_message_id, deleted_at')
        .eq('schedule_id', scheduleId)
        .order('created_at', { ascending: true })
        .range(from, to)
    )
    const scoped = logIdFilter ? rows.filter(row => logIdFilter.has(row.id)) : rows
    const sent = scoped.filter(row => row.status === 'sent')
    const skippedEmail = sent.filter(row => row.channel_type === 'email').length
    const eligible = sent.filter(row =>
      isDiscordChannelType(row.channel_type) && !!row.discord_message_id && !row.deleted_at
    )

    if (eligible.length === 0) {
      return res.json({ deleted: 0, failed: 0, skippedEmail, results: [] })
    }

    const results: MessageDeleteResult[] = []
    let botFailed = false
    for (let i = 0; i < eligible.length; i += DELETE_BOT_BATCH_SIZE) {
      try {
        results.push(...await callBotDeleteMessages(eligible.slice(i, i + DELETE_BOT_BATCH_SIZE)))
      } catch (err: unknown) {
        botFailed = true
        const reason = err instanceof Error ? err.message : 'Unknown error'
        console.warn(`[announcements] delete-messages bot call failed: ${reason.replace(/[\r\n]+/g, ' ')}`)
        break
      }
    }

    if (botFailed && results.length === 0) {
      return res.status(502).json({
        error: 'BOT_UNAVAILABLE',
        message: 'The Discord bot is unreachable, so no messages were deleted. Please try again later.',
        statusCode: 502,
      })
    }

    // Persist what the bot processed; rows from an unreached batch stay untouched
    await persistDeleteResults(scheduleId, results)
    const processed = new Set(results.map(r => r.id))
    for (const row of eligible) {
      if (!processed.has(row.id)) {
        results.push({ id: row.id, ok: false, error: 'Discord bot became unreachable before this message was processed' })
      }
    }

    const deleted = results.filter(r => r.ok).length
    res.json({ deleted, failed: results.length - deleted, skippedEmail, results })
  } catch (err: unknown) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── GET /api/announcements/schedules/:id/log — Delivery log for a schedule ───

router.get('/schedules/:id/log', async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Verify ownership and get calendar_id for subscription status lookup
    const { data: schedule } = await supabaseAdmin
      .from('announcement_schedules')
      .select('id, calendar_id')
      .eq('id', req.params.id)
      .eq('user_id', req.userId!)
      .single()

    if (!schedule) return res.status(404).json({ error: 'Schedule not found' })

    const entries = await fetchAllRows((from, to) =>
      supabaseAdmin
        .from('announcement_delivery_log')
        .select('*')
        .eq('schedule_id', req.params.id)
        .order('created_at', { ascending: true })
        .range(from, to)
    )

    // Enrich DM entries with subscription status.
    // Post-migration entries have recipient_response stored historically.
    // Pre-migration entries (recipient_response IS NULL) fall back to live lookup.
    const dmEntries = entries.filter((e: { channel_type: string }) => e.channel_type === 'discord_dm')
    const needsLiveLookup = dmEntries.filter((e: Record<string, unknown>) => e.recipient_response == null)

    if (needsLiveLookup.length > 0 && schedule.calendar_id) {
      const dmTargetIds = needsLiveLookup.map((e: { target_id: string }) => e.target_id)

      const { data: subs } = await supabaseAdmin
        .from('dm_calendar_invites')
        .select('recipient_discord_id, status')
        .eq('calendar_id', schedule.calendar_id)
        .in('recipient_discord_id', dmTargetIds)

      const subMap = new Map<string, string>()
      for (const s of (subs || []) as Array<{ recipient_discord_id: string; status: string }>) {
        subMap.set(s.recipient_discord_id, s.status)
      }

      // Also check dm_opt_outs for global opt-outs
      const { data: optOuts } = await supabaseAdmin
        .from('dm_opt_outs')
        .select('recipient_discord_id, reason')
        .in('recipient_discord_id', dmTargetIds)

      const optOutMap = new Map<string, string | null>()
      for (const o of (optOuts || []) as Array<{ recipient_discord_id: string; reason: string | null }>) {
        optOutMap.set(o.recipient_discord_id, o.reason)
      }

      for (const entry of needsLiveLookup as Array<Record<string, unknown>>) {
        const targetId = entry.target_id as string
        const subStatus = subMap.get(targetId) || null
        entry.subscription_status = subStatus
        // Detect muted bot: failed delivery with "Cannot send messages" or "private" opt-out
        if (optOutMap.get(targetId) === 'private') {
          entry.recipient_response = 'muted_bot'
          entry.subscription_status = 'muted_bot'
        } else if (entry.status === 'failed' && typeof entry.error_message === 'string' && /cannot send messages|50007/i.test(entry.error_message)) {
          entry.recipient_response = 'muted_bot'
          entry.subscription_status = 'muted_bot'
        } else if (subStatus) {
          entry.recipient_response = subStatus
        } else if (optOutMap.has(targetId)) {
          entry.recipient_response = 'opted_out'
        } else {
          entry.recipient_response = null
        }
      }
    }

    // Correct historical entries where recipient_response was incorrectly stored as 'subscribed'
    // (pre-fix bug: all successful DMs were stored as 'subscribed' regardless of actual status)
    const needsSubscribedValidation = dmEntries.filter(
      (e: Record<string, unknown>) => e.recipient_response === 'subscribed' && e.status === 'sent'
    )
    if (needsSubscribedValidation.length > 0 && schedule.calendar_id) {
      const validateIds = [...new Set(needsSubscribedValidation.map((e: Record<string, unknown>) => e.target_id as string))]
      const { data: liveSubs } = await supabaseAdmin
        .from('dm_calendar_invites')
        .select('recipient_discord_id, status')
        .eq('calendar_id', schedule.calendar_id)
        .in('recipient_discord_id', validateIds)

      const liveSubMap = new Map<string, string>()
      for (const s of (liveSubs || []) as Array<{ recipient_discord_id: string; status: string }>) {
        liveSubMap.set(s.recipient_discord_id, s.status)
      }

      for (const entry of needsSubscribedValidation as Array<Record<string, unknown>>) {
        const liveStatus = liveSubMap.get(entry.target_id as string)
        if (liveStatus && liveStatus !== 'subscribed') {
          entry.recipient_response = liveStatus
          entry.subscription_status = liveStatus
        }
      }
    }

    // For entries that already have stored recipient_response, use it as-is
    for (const entry of dmEntries as Array<Record<string, unknown>>) {
      if (entry.recipient_response != null) {
        // subscription_status mirrors recipient_response for frontend badge display
        if (!entry.subscription_status) {
          entry.subscription_status = entry.recipient_response
        }
      }
    }

    res.json({ log: entries })
  } catch (err: unknown) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── GET /api/announcements/meetings — User's meetings for announcement context ─

router.get('/meetings', async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Get calendars where user is the creator
    const { data: ownedCalendars, error: calError } = await supabaseAdmin
      .from('calendars')
      .select('id, title, hash, config')
      .or(`created_by.eq.${req.userEmail},created_by.eq.${req.userId}`)

    if (calError) throw calError

    // Also get calendars the user is subscribed to
    const { data: subscriptions } = await supabaseAdmin
      .from('calendar_subscriptions')
      .select('calendar_id, calendars:calendar_id(id, title, hash, config)')
      .eq('user_id', req.userId)

    type CalendarRow = { id: string; title: string; hash: string; config: { onboardingUrl?: string } | null }
    const subscribedCalendars = (subscriptions || [])
      .map(s => s.calendars as unknown as CalendarRow)
      .filter(Boolean)

    // Merge owned + subscribed, deduplicate by id. Strip config down to onboardingUrl only.
    const calendarMap = new Map<string, { id: string; title: string; hash: string; onboardingUrl: string | null }>()
    const toOption = (c: CalendarRow) => ({
      id: c.id,
      title: c.title,
      hash: c.hash,
      onboardingUrl: (c.config && typeof c.config.onboardingUrl === 'string' && c.config.onboardingUrl.trim()) ? c.config.onboardingUrl : null,
    })
    for (const c of (ownedCalendars || [])) calendarMap.set(c.id, toOption(c as CalendarRow))
    for (const c of subscribedCalendars) if (!calendarMap.has(c.id)) calendarMap.set(c.id, toOption(c))

    const allCalendars = Array.from(calendarMap.values())

    if (calendarMap.size === 0) return res.json({ meetings: [], calendarParticipants: {}, calendars: [] })

    const calendarIds = Array.from(calendarMap.keys())

    // Get all meetings from those calendars, ordered by next upcoming first
    const { data: meetings, error: meetError } = await supabaseAdmin
      .from('meetings')
      .select('id, calendar_id, title, description, start_time, end_time, duration_minutes, meeting_link, time_slots')
      .in('calendar_id', calendarIds)
      .order('start_time', { ascending: true })
      .limit(50)

    if (meetError) throw meetError

    // Fetch participant names (availability usernames) for all calendars
    const { data: availability } = await supabaseAdmin
      .from('availability')
      .select('calendar_id, username, user_id')
      .in('calendar_id', calendarIds)

    // Build a map: calendarId → sorted unique participant names
    const calendarParticipants: Record<string, string[]> = {}
    for (const entry of (availability || [])) {
      if (!calendarParticipants[entry.calendar_id]) {
        calendarParticipants[entry.calendar_id] = []
      }
      if (!calendarParticipants[entry.calendar_id].includes(entry.username)) {
        calendarParticipants[entry.calendar_id].push(entry.username)
      }
    }
    // Sort each list alphabetically
    for (const calId of Object.keys(calendarParticipants)) {
      calendarParticipants[calId].sort((a, b) => a.localeCompare(b))
    }

    // ── Enriched participant details for email recipients ──
    // Collect unique user_ids from availability entries
    const participantUserIds = [...new Set(
      (availability || []).map(a => a.user_id).filter(Boolean) as string[]
    )]

    // For entries with no user_id, try to resolve by matching username to display_name
    const unmatchedUsernames = [...new Set(
      (availability || []).filter(a => !a.user_id).map(a => a.username)
    )]

    // Batch-lookup users by display_name for unmatched availability entries
    const usernameToUserId = new Map<string, string>()
    if (unmatchedUsernames.length > 0) {
      const { data: matchedUsers } = await supabaseAdmin
        .from('users')
        .select('id, display_name')
        .in('display_name', unmatchedUsernames)
      for (const u of (matchedUsers || [])) {
        if (u.display_name && !usernameToUserId.has(u.display_name)) {
          usernameToUserId.set(u.display_name, u.id)
          if (!participantUserIds.includes(u.id)) participantUserIds.push(u.id)
        }
      }
    }

    // Batch-fetch user emails, privacy settings, notification preferences
    const [usersRes, privacyRes, notifRes] = await Promise.all([
      participantUserIds.length > 0
        ? supabaseAdmin.from('users').select('id, email').in('id', participantUserIds)
        : Promise.resolve({ data: [] as { id: string; email: string | null }[] }),
      participantUserIds.length > 0
        ? supabaseAdmin.from('privacy_settings').select('user_id, followers_show_email, contacts_show_email').in('user_id', participantUserIds)
        : Promise.resolve({ data: [] as { user_id: string; followers_show_email: boolean; contacts_show_email: boolean }[] }),
      participantUserIds.length > 0
        ? supabaseAdmin.from('notification_preferences').select('user_id, preferred_channels').in('user_id', participantUserIds)
        : Promise.resolve({ data: [] as { user_id: string; preferred_channels: string[] }[] }),
    ])

    const userEmailMap = new Map(((usersRes.data || []) as { id: string; email: string | null }[]).map((u) => [u.id, u.email]))
    const privacyMap = new Map(((privacyRes.data || []) as { user_id: string; followers_show_email: boolean; contacts_show_email: boolean }[]).map((p) => [p.user_id, p]))
    const notifMap = new Map(((notifRes.data || []) as { user_id: string; preferred_channels: string[] }[]).map((n) => [n.user_id, n]))

    // Build enriched participant details grouped by username
    const detailsMap = new Map<string, {
      username: string
      user_id: string | null
      email: string | null
      email_status: 'visible' | 'hidden' | 'disabled' | 'no_account'
      calendar_ids: string[]
    }>()

    for (const entry of (availability || [])) {
      const existing = detailsMap.get(entry.username)
      if (existing) {
        if (!existing.calendar_ids.includes(entry.calendar_id)) {
          existing.calendar_ids.push(entry.calendar_id)
        }
        continue
      }

      // Resolve user_id: use availability's user_id, or fall back to display_name match
      const resolvedUserId = entry.user_id || usernameToUserId.get(entry.username) || null

      let email_status: 'visible' | 'hidden' | 'disabled' | 'no_account' = 'no_account'
      let email: string | null = null

      if (resolvedUserId) {
        const userEmail = userEmailMap.get(resolvedUserId)
        if (!userEmail) {
          email_status = 'no_account'
        } else {
          const notifPref = notifMap.get(resolvedUserId)
          const emailChannelEnabled = notifPref
            ? (notifPref.preferred_channels || []).includes('Email')
            : false

          if (!emailChannelEnabled) {
            email_status = 'disabled'
          } else {
            const privacy = privacyMap.get(resolvedUserId)
            const showEmail = privacy
              ? (privacy.followers_show_email || privacy.contacts_show_email)
              : false

            if (showEmail) {
              email_status = 'visible'
              email = userEmail
            } else {
              email_status = 'hidden'
            }
          }
        }
      }

      detailsMap.set(entry.username, {
        username: entry.username,
        user_id: resolvedUserId,
        email,
        email_status,
        calendar_ids: [entry.calendar_id],
      })
    }

    const calendarParticipantEmails = Array.from(detailsMap.values())

    const enriched = (meetings || []).map(m => ({
      ...m,
      calendar_title: calendarMap.get(m.calendar_id)?.title || '',
      calendar_hash: calendarMap.get(m.calendar_id)?.hash || '',
    }))

    res.json({ meetings: enriched, calendarParticipants, calendarParticipantEmails, calendars: allCalendars })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── GET /api/announcements/schedules/:id/status — Schedule + delivery status ─

router.get('/schedules/:id/status', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data: schedule, error } = await supabaseAdmin
      .from('announcement_schedules')
      .select('id, title, body, scheduled_at, timezone, status, targets, sent_at, error_message, created_at')
      .eq('id', req.params.id)
      .eq('user_id', req.userId!)
      .single()

    if (error || !schedule) {
      return res.status(404).json({ error: 'Schedule not found' })
    }

    const deliveryLog = await fetchAllRows((from, to) =>
      supabaseAdmin
        .from('announcement_delivery_log')
        .select('id, channel_type, target_id, target_label, status, discord_message_id, error_message, delivered_at, created_at')
        .eq('schedule_id', req.params.id)
        .order('created_at', { ascending: true })
        .range(from, to)
    )

    res.json({
      schedule,
      deliveryLog,
    })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── GET /api/announcements/email-status — Check email service configuration ──

router.get('/email-status', async (req: AuthenticatedRequest, res: Response) => {
  const platformConfigured = !!(process.env.SMTP_USER && process.env.SMTP_PASS)
  const platformFrom = platformConfigured ? (process.env.SMTP_USER || '') : null

  // Check if this user has their own SMTP config
  let userConfig: { email: string; verified: boolean } | null = null
  try {
    const { data } = await supabaseAdmin
      .from('user_smtp_configs')
      .select('email_address, is_verified')
      .eq('user_id', req.userId!)
      .maybeSingle()
    if (data) {
      userConfig = { email: data.email_address, verified: data.is_verified }
    }
  } catch { /* ignore */ }

  const configured = platformConfigured || (userConfig?.verified ?? false)

  // Check verified email for sender attribution
  let verifiedSenderEmail: string | null = null
  try {
    const { data } = await supabaseAdmin
      .from('verified_emails')
      .select('email')
      .eq('user_id', req.userId!)
      .eq('is_primary', true)
      .maybeSingle()
    verifiedSenderEmail = data?.email || null
  } catch { /* ignore */ }

  res.json({
    configured,
    platformConfigured,
    platformFrom,
    userConfig,
    encryptionAvailable: !!(process.env.SMTP_ENCRYPTION_KEY && process.env.SMTP_ENCRYPTION_KEY.length >= 64),
    verifiedSenderEmail,
  })
})

// ─── GET /api/announcements/responses — Aggregated response tracking ───────────
// Returns two datasets:
// 1. recipients: Per-person subscription events across all announcements
// 2. calendarGroups: Delivery records grouped by calendar/initiative
// Supports: ?scope=recent|month|year&after=ISO&before=ISO for tiered loading

router.get('/responses', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = (req.query.scope as string) || 'recent'
    if (!['recent', 'month', 'year'].includes(scope)) {
      return res.status(400).json({ error: 'INVALID_SCOPE', message: 'Use: recent, month, year' })
    }
    const afterDate = req.query.after ? sanitizeString(req.query.after as string, 30) : null
    const beforeDate = req.query.before ? sanitizeString(req.query.before as string, 30) : null

    // Determine date bounds based on scope (when no custom date filter)
    let scopeAfter = afterDate
    const scopeBefore = beforeDate
    if (!afterDate && !beforeDate) {
      if (scope === 'month') {
        const monthAgo = new Date()
        monthAgo.setDate(monthAgo.getDate() - 30)
        scopeAfter = monthAgo.toISOString()
      } else if (scope === 'year') {
        const yearAgo = new Date()
        yearAgo.setFullYear(yearAgo.getFullYear() - 1)
        scopeAfter = yearAgo.toISOString()
      }
    }

    // Build schedule query (sorted most recent first)
    let schedQuery = supabaseAdmin
      .from('announcement_schedules')
      .select('id, title, body, calendar_id, status, scheduled_at, sent_at, created_at, targets')
      .eq('user_id', req.userId!)
      .in('status', ['sent', 'partially_sent', 'failed', 'sending'])
      .order('scheduled_at', { ascending: false })

    if (scopeAfter) schedQuery = schedQuery.gte('scheduled_at', scopeAfter)
    if (scopeBefore) schedQuery = schedQuery.lte('scheduled_at', scopeBefore)

    // For 'recent' scope without custom date filters, limit to 40 schedules
    if (scope === 'recent' && !afterDate && !beforeDate) {
      schedQuery = schedQuery.limit(40)
    }

    const { data: schedules, error: schErr } = await schedQuery

    if (schErr) throw schErr

    // Check for older records to determine scale-up button visibility
    let hasOlderThanMonth = false
    let hasOlderThanYear = false

    const monthAgo = new Date()
    monthAgo.setDate(monthAgo.getDate() - 30)
    const yearAgo = new Date()
    yearAgo.setFullYear(yearAgo.getFullYear() - 1)

    if (scope === 'recent' || scope === 'month') {
      const { count: olderMonth } = await supabaseAdmin
        .from('announcement_schedules')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', req.userId!)
        .in('status', ['sent', 'partially_sent', 'failed', 'sending'])
        .lt('scheduled_at', monthAgo.toISOString())
      hasOlderThanMonth = (olderMonth ?? 0) > 0
    }

    if (scope === 'month') {
      const { count: olderYear } = await supabaseAdmin
        .from('announcement_schedules')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', req.userId!)
        .in('status', ['sent', 'partially_sent', 'failed', 'sending'])
        .lt('scheduled_at', yearAgo.toISOString())
      hasOlderThanYear = (olderYear ?? 0) > 0
    }

    const scheduleIds = (schedules || []).map((s: { id: string }) => s.id)
    if (scheduleIds.length === 0) {
      return res.json({
        recipients: [],
        calendarGroups: [],
        meta: { scope, hasOlderThanMonth, hasOlderThanYear, loadedSchedules: 0 },
      })
    }

    // 3. Get all delivery log entries for DM targets in these schedules (paginated to avoid PostgREST max-rows cap)
    const entries = await fetchAllRows((from, to) =>
      supabaseAdmin
        .from('announcement_delivery_log')
        .select('id, schedule_id, channel_type, target_id, target_label, status, recipient_response, delivered_at, created_at, error_message')
        .in('schedule_id', scheduleIds)
        .eq('channel_type', 'discord_dm')
        .order('created_at', { ascending: false })
        .range(from, to)
    )

    // Calendar IDs from schedules (used for both null enrichment and subscribed validation)
    const calendarMap = new Map<string, string | null>()
    for (const s of (schedules || []) as Array<{ id: string; calendar_id: string | null }>) {
      calendarMap.set(s.id, s.calendar_id)
    }

    // 3. Enrich entries missing recipient_response via live lookup
    const needsLookup = entries.filter((e: Record<string, unknown>) => e.recipient_response == null)
    if (needsLookup.length > 0) {
      const targetIds = [...new Set(needsLookup.map((e: { target_id: string }) => e.target_id))]

      const calendarIds = [...new Set(
        (schedules || [])
          .map((s: { calendar_id: string | null }) => s.calendar_id)
          .filter(Boolean)
      )] as string[]

      // Get subscription statuses
      const subMap = new Map<string, Map<string, string>>()
      if (calendarIds.length > 0) {
        const { data: subs } = await supabaseAdmin
          .from('dm_calendar_invites')
          .select('recipient_discord_id, calendar_id, status')
          .in('calendar_id', calendarIds)
          .in('recipient_discord_id', targetIds)

        for (const s of (subs || []) as Array<{ recipient_discord_id: string; calendar_id: string; status: string }>) {
          if (!subMap.has(s.recipient_discord_id)) subMap.set(s.recipient_discord_id, new Map())
          subMap.get(s.recipient_discord_id)!.set(s.calendar_id, s.status)
        }
      }

      // Get opt-outs
      const { data: optOuts } = await supabaseAdmin
        .from('dm_opt_outs')
        .select('recipient_discord_id, reason')
        .in('recipient_discord_id', targetIds)

      const optOutMap = new Map<string, string | null>()
      for (const o of (optOuts || []) as Array<{ recipient_discord_id: string; reason: string | null }>) {
        optOutMap.set(o.recipient_discord_id, o.reason)
      }

      for (const entry of needsLookup as Array<Record<string, unknown>>) {
        const targetId = entry.target_id as string
        const schedCalId = calendarMap.get(entry.schedule_id as string) || null
        const subStatus = schedCalId ? subMap.get(targetId)?.get(schedCalId) || null : null

        if (optOutMap.get(targetId) === 'private') {
          entry.recipient_response = 'muted_bot'
          entry.subscription_status = 'muted_bot'
        } else if (entry.status === 'failed' && typeof entry.error_message === 'string' && /cannot send messages|50007/i.test(entry.error_message)) {
          entry.recipient_response = 'muted_bot'
          entry.subscription_status = 'muted_bot'
        } else if (subStatus) {
          entry.recipient_response = subStatus
        } else if (optOutMap.has(targetId)) {
          entry.recipient_response = 'opted_out'
        } else {
          entry.recipient_response = null
        }
      }
    }

    // Correct historical entries where recipient_response was incorrectly stored as 'subscribed'
    // (pre-fix bug: all successful DMs were stored as 'subscribed' regardless of actual status)
    const needsSubscribedValidation = entries.filter(
      (e: Record<string, unknown>) => e.recipient_response === 'subscribed' && e.status === 'sent'
    )
    if (needsSubscribedValidation.length > 0) {
      const validateIds = [...new Set(needsSubscribedValidation.map((e: Record<string, unknown>) => e.target_id as string))]
      const validateCalIds = [...new Set(
        needsSubscribedValidation
          .map((e: Record<string, unknown>) => calendarMap.get(e.schedule_id as string))
          .filter(Boolean)
      )] as string[]

      if (validateCalIds.length > 0) {
        const { data: liveSubs } = await supabaseAdmin
          .from('dm_calendar_invites')
          .select('recipient_discord_id, calendar_id, status')
          .in('calendar_id', validateCalIds)
          .in('recipient_discord_id', validateIds)

        const liveSubMap = new Map<string, Map<string, string>>()
        for (const s of (liveSubs || []) as Array<{ recipient_discord_id: string; calendar_id: string; status: string }>) {
          if (!liveSubMap.has(s.recipient_discord_id)) liveSubMap.set(s.recipient_discord_id, new Map())
          liveSubMap.get(s.recipient_discord_id)!.set(s.calendar_id, s.status)
        }

        for (const entry of needsSubscribedValidation as Array<Record<string, unknown>>) {
          const targetId = entry.target_id as string
          const schedCalId = calendarMap.get(entry.schedule_id as string) || null
          const liveStatus = schedCalId ? liveSubMap.get(targetId)?.get(schedCalId) || null : null
          if (liveStatus && liveStatus !== 'subscribed') {
            entry.recipient_response = liveStatus
          }
        }
      }
    }

    // 4. Build per-recipient aggregation
    const recipientMap = new Map<string, {
      discord_id: string
      label: string
      events: Array<{
        type: string
        schedule_id: string
        schedule_title: string
        date: string
        delivery_status: string
        recipient_response: string | null
      }>
      latest_response: string | null
    }>()

    for (const entry of entries as Array<Record<string, unknown>>) {
      const targetId = entry.target_id as string
      const label = (entry.target_label as string) || targetId
      const scheduleId = entry.schedule_id as string
      const schedule = (schedules || []).find((s: { id: string }) => s.id === scheduleId) as Record<string, unknown> | undefined

      if (!recipientMap.has(targetId)) {
        recipientMap.set(targetId, {
          discord_id: targetId,
          label,
          events: [],
          latest_response: null,
        })
      }

      const recipient = recipientMap.get(targetId)!
      // Use the most specific label available
      if (label !== targetId && recipient.label === targetId) {
        recipient.label = label
      }

      let eventType = (entry.recipient_response as string) || ((entry.status as string) === 'sent' ? 'received' : 'failed')
      // When recipient didn't respond to a previous invite and delivery was blocked
      if (eventType === 'invited' && (entry.status as string) === 'failed') {
        eventType = 'skipped_no_response'
      }
      recipient.events.push({
        type: eventType,
        schedule_id: scheduleId,
        schedule_title: (schedule?.title as string) || 'Untitled',
        date: (entry.delivered_at as string) || (entry.created_at as string),
        delivery_status: entry.status as string,
        recipient_response: entry.recipient_response as string | null,
      })
    }

    // Set latest_response from the most recent event (historical snapshot)
    for (const r of recipientMap.values()) {
      if (r.events.length > 0) {
        r.latest_response = r.events[0].recipient_response
      }
    }

    // Override latest_response with LIVE subscription status from dm_calendar_invites.
    // The delivery log stores a point-in-time snapshot (e.g. 'invited'), but if the user
    // later clicked Subscribe/Unsubscribe in Discord, the live status takes precedence.
    const allRecipientIds = [...recipientMap.keys()]
    const allCalendarIds = [...new Set(
      (schedules || [])
        .map((s: { calendar_id: string | null }) => s.calendar_id)
        .filter(Boolean)
    )] as string[]

    if (allRecipientIds.length > 0 && allCalendarIds.length > 0) {
      const { data: liveSubs } = await supabaseAdmin
        .from('dm_calendar_invites')
        .select('recipient_discord_id, status, updated_at')
        .in('calendar_id', allCalendarIds)
        .in('recipient_discord_id', allRecipientIds)
        .order('updated_at', { ascending: false })

      // Pick the most recently updated status per recipient
      const liveStatusMap = new Map<string, string>()
      for (const s of (liveSubs || []) as Array<{ recipient_discord_id: string; status: string }>) {
        if (!liveStatusMap.has(s.recipient_discord_id)) {
          liveStatusMap.set(s.recipient_discord_id, s.status)
        }
      }

      // Also check opt-outs for muted_bot override
      const { data: liveOptOuts } = await supabaseAdmin
        .from('dm_opt_outs')
        .select('recipient_discord_id, reason')
        .in('recipient_discord_id', allRecipientIds)

      const liveOptOutMap = new Map<string, string | null>()
      for (const o of (liveOptOuts || []) as Array<{ recipient_discord_id: string; reason: string | null }>) {
        liveOptOutMap.set(o.recipient_discord_id, o.reason)
      }

      for (const [discordId, recipient] of recipientMap) {
        if (liveOptOutMap.get(discordId) === 'private') {
          recipient.latest_response = 'muted_bot'
        } else if (liveStatusMap.has(discordId)) {
          recipient.latest_response = liveStatusMap.get(discordId)!
        } else if (liveOptOutMap.has(discordId)) {
          recipient.latest_response = 'opted_out'
        }
        // else: keep the delivery-log-derived latest_response
      }
    }

    const recipients = [...recipientMap.values()]
      .sort((a, b) => {
        // Sort by most recent event date, latest first
        const aDate = a.events[0]?.date || ''
        const bDate = b.events[0]?.date || ''
        return bDate.localeCompare(aDate)
      })

    // 5. Build per-calendar grouping
    const calGroupMap = new Map<string, {
      calendar_id: string | null
      calendar_title: string
      schedules: Array<{
        id: string
        title: string
        sent_at: string | null
        scheduled_at: string
        deliveries: Array<{
          target_id: string
          target_label: string | null
          delivery_status: string
          recipient_response: string | null
          delivered_at: string | null
        }>
      }>
    }>()

    for (const schedule of (schedules || []) as Array<Record<string, unknown>>) {
      const calId = (schedule.calendar_id as string) || '__none__'
      if (!calGroupMap.has(calId)) {
        calGroupMap.set(calId, {
          calendar_id: (schedule.calendar_id as string) || null,
          calendar_title: calId === '__none__' ? 'No Calendar' : '',
          schedules: [],
        })
      }

      const scheduleEntries = entries.filter(
        (e: { schedule_id: string }) => e.schedule_id === (schedule.id as string)
      ) as Array<Record<string, unknown>>

      calGroupMap.get(calId)!.schedules.push({
        id: schedule.id as string,
        title: (schedule.title as string) || 'Untitled',
        sent_at: schedule.sent_at as string | null,
        scheduled_at: schedule.scheduled_at as string,
        deliveries: scheduleEntries.map(e => ({
          target_id: e.target_id as string,
          target_label: e.target_label as string | null,
          delivery_status: e.status as string,
          recipient_response: e.recipient_response as string | null,
          delivered_at: e.delivered_at as string | null,
        })),
      })
    }

    // Enrich calendar titles
    const calendarIds = [...calGroupMap.keys()].filter(k => k !== '__none__')
    if (calendarIds.length > 0) {
      const { data: calendars } = await supabaseAdmin
        .from('calendars')
        .select('id, title')
        .in('id', calendarIds)

      for (const cal of (calendars || []) as Array<{ id: string; title: string }>) {
        const group = calGroupMap.get(cal.id)
        if (group) group.calendar_title = cal.title
      }
    }

    const calendarGroups = [...calGroupMap.values()]
      .sort((a, b) => {
        if (a.calendar_id === null) return 1
        if (b.calendar_id === null) return -1
        return a.calendar_title.localeCompare(b.calendar_title)
      })

    // For 'recent' scope, cap recipients at 20
    const cappedRecipients = scope === 'recent' ? recipients.slice(0, 20) : recipients

    res.json({
      recipients: cappedRecipients,
      calendarGroups,
      meta: { scope, hasOlderThanMonth, hasOlderThanYear, loadedSchedules: (schedules || []).length },
    })
  } catch (err: unknown) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

export default router
