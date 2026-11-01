import { randomUUID } from 'crypto'
import { NextFunction, Response, Router } from 'express'
import { authMiddleware, AuthenticatedRequest, optionalAuthMiddleware } from '../middleware/auth.js'
import { ValidationError } from '../middleware/error-handler.js'
import { sanitizeString, sanitizeUUID } from '../middleware/validation.js'
import { supabaseAdmin } from '../supabaseClient.js'
import {
  expireOverdueEventFlags,
  refreshEventTargetSuspensions,
  setEventTargetsSuspended,
  type EventModerationTargetType,
} from '../services/event-moderation.js'

const router: ReturnType<typeof Router> = Router()
const ANONYMOUS_REPORTER_COOKIE = 'cm_event_reporter'
const CONFIRMATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

type ResponseAction = 'confirmed' | 'removal_accepted' | 'updated'

interface FlagTargetInput {
  type: EventModerationTargetType
  id: string
}

interface ResolvedFlagTarget extends FlagTargetInput {
  ownerIdentity: string
  title: string
  eventKey: string
}

function buildLogicalEventKey(event: {
  title: string
  meeting_link?: string | null
  location?: string | null
  start_time: string
}): string {
  return [
    event.title.trim().toLowerCase(),
    (event.meeting_link || '').trim().toLowerCase(),
    (event.location || '').trim().toLowerCase(),
    new Date(event.start_time).toISOString().slice(0, 10),
  ].join('|')
}

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=')
    if (separator < 0) continue
    if (pair.slice(0, separator).trim() !== name) continue
    const value = pair.slice(separator + 1).trim()
    return /^[0-9a-f-]{36}$/i.test(value) ? value : null
  }
  return null
}

function getReporter(req: AuthenticatedRequest, res: Response): {
  reporter_user_id: string | null
  reporter_anonymous_id: string | null
  actor_type: 'authenticated' | 'anonymous'
} {
  if (req.userId) {
    return {
      reporter_user_id: req.userId,
      reporter_anonymous_id: null,
      actor_type: 'authenticated',
    }
  }

  const existingId = parseCookie(req.headers.cookie, ANONYMOUS_REPORTER_COOKIE)
  const anonymousId = existingId || randomUUID()
  if (!existingId) {
    res.cookie(ANONYMOUS_REPORTER_COOKIE, anonymousId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 365 * 24 * 60 * 60 * 1000,
      path: '/',
    })
  }

  return {
    reporter_user_id: null,
    reporter_anonymous_id: anonymousId,
    actor_type: 'anonymous',
  }
}

function parseTargets(value: unknown): FlagTargetInput[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    throw new ValidationError('Between 1 and 20 event targets are required')
  }

  const uniqueTargets = new Map<string, FlagTargetInput>()
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      throw new ValidationError('Each event target must be an object')
    }
    const candidate = entry as Record<string, unknown>
    if (candidate.type !== 'user_event' && candidate.type !== 'meeting') {
      throw new ValidationError('Invalid event target type')
    }
    const rawId = typeof candidate.id === 'string' ? candidate.id.replace(/__occ__.*$/, '').replace(/^coord_/, '') : candidate.id
    const id = sanitizeUUID(rawId)
    if (!id) throw new ValidationError('Invalid event target id')
    uniqueTargets.set(`${candidate.type}:${id}`, { type: candidate.type, id })
  }
  return [...uniqueTargets.values()]
}

async function resolvePublicTargets(targets: FlagTargetInput[]): Promise<ResolvedFlagTarget[]> {
  const userEventIds = targets.filter(target => target.type === 'user_event').map(target => target.id)
  const meetingIds = targets.filter(target => target.type === 'meeting').map(target => target.id)
  const resolved: ResolvedFlagTarget[] = []

  if (userEventIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('user_events')
      .select('id, user_id, title, meeting_link, location, start_time, is_public')
      .in('id', userEventIds)
    if (error) throw error
    for (const event of data || []) {
      resolved.push({
        type: 'user_event',
        id: event.id,
        ownerIdentity: event.user_id,
        title: event.title,
        eventKey: buildLogicalEventKey(event),
      })
    }
  }

  if (meetingIds.length > 0) {
    const { data: meetings, error: meetingsError } = await supabaseAdmin
      .from('meetings')
      .select('id, calendar_id, title, meeting_link, start_time')
      .in('id', meetingIds)
    if (meetingsError) throw meetingsError

    const calendarIds = [...new Set((meetings || []).map(meeting => meeting.calendar_id))]
    const { data: calendars, error: calendarsError } = calendarIds.length > 0
      ? await supabaseAdmin.from('calendars').select('id, created_by, visibility').in('id', calendarIds)
      : { data: [], error: null }
    if (calendarsError) throw calendarsError

    const publicCalendars = new Map(
      (calendars || [])
        .map(calendar => [calendar.id, calendar.created_by]),
    )
    for (const meeting of meetings || []) {
      const ownerIdentity = publicCalendars.get(meeting.calendar_id)
      if (ownerIdentity) {
        const normalizedMeeting = { ...meeting, title: meeting.title || 'Meeting', location: null }
        resolved.push({
          type: 'meeting',
          id: meeting.id,
          ownerIdentity,
          title: normalizedMeeting.title,
          eventKey: buildLogicalEventKey(normalizedMeeting),
        })
      }
    }
  }

  const resolvedKey = (t: { type: string; id: string }) => `${t.type}:${t.id}`
  const resolvedSet = new Set(resolved.map(resolvedKey))
  const missingTargets = targets.filter(t => !resolvedSet.has(resolvedKey(t)))

  if (missingTargets.length > 0) {
    const missingUserEvents = missingTargets.filter(t => t.type === 'meeting').map(t => t.id)
    if (missingUserEvents.length > 0) {
      const { data: altEvents } = await supabaseAdmin
        .from('user_events')
        .select('id, user_id, title, meeting_link, location, start_time, is_public')
        .in('id', missingUserEvents)
      for (const event of altEvents || []) {
        resolved.push({
          type: 'user_event',
          id: event.id,
          ownerIdentity: event.user_id,
          title: event.title,
          eventKey: buildLogicalEventKey(event),
        })
      }
    }

    const missingMeetings = missingTargets.filter(t => t.type === 'user_event').map(t => t.id)
    if (missingMeetings.length > 0) {
      const { data: altMeetings } = await supabaseAdmin
        .from('meetings')
        .select('id, calendar_id, title, meeting_link, start_time')
        .in('id', missingMeetings)
      if (altMeetings && altMeetings.length > 0) {
        const calendarIds = [...new Set(altMeetings.map(m => m.calendar_id))]
        const { data: calendars } = await supabaseAdmin.from('calendars').select('id, created_by').in('id', calendarIds)
        const calMap = new Map((calendars || []).map(c => [c.id, c.created_by]))
        for (const m of altMeetings) {
          const ownerIdentity = calMap.get(m.calendar_id)
          if (ownerIdentity) {
            resolved.push({
              type: 'meeting',
              id: m.id,
              ownerIdentity,
              title: m.title || 'Meeting',
              eventKey: buildLogicalEventKey({ ...m, location: null }),
            })
          }
        }
      }
    }
  }

  if (resolved.length < targets.length) {
    throw new ValidationError('One or more event targets could not be resolved or do not exist')
  }
  return resolved
}

async function checkRecentConfirmation(targets: FlagTargetInput[]): Promise<{ canRequestConfirmation: boolean; lastConfirmedAt: string | null }> {
  if (targets.length === 0) return { canRequestConfirmation: true, lastConfirmedAt: null }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const userEventIds = targets.filter(t => t.type === 'user_event').map(t => t.id)
  const meetingIds = targets.filter(t => t.type === 'meeting').map(t => t.id)

  const targetOrFilters: string[] = []
  if (userEventIds.length > 0) {
    targetOrFilters.push(`and(target_type.eq.user_event,target_id.in.(${userEventIds.join(',')}))`)
  }
  if (meetingIds.length > 0) {
    targetOrFilters.push(`and(target_type.eq.meeting,target_id.in.(${meetingIds.join(',')}))`)
  }

  if (targetOrFilters.length === 0) return { canRequestConfirmation: true, lastConfirmedAt: null }

  const { data: recentConfirmedTargets } = await supabaseAdmin
    .from('event_flag_targets')
    .select('responded_at, status')
    .or(targetOrFilters.join(','))
    .in('status', ['confirmed', 'updated'])
    .gte('responded_at', sevenDaysAgo)
    .order('responded_at', { ascending: false })

  if (recentConfirmedTargets && recentConfirmedTargets.length > 0) {
    const lastConfirmed = recentConfirmedTargets[0].responded_at
    return {
      canRequestConfirmation: false,
      lastConfirmedAt: lastConfirmed || sevenDaysAgo,
    }
  }

  return { canRequestConfirmation: true, lastConfirmedAt: null }
}

router.post('/check-status', optionalAuthMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const targets = parseTargets(req.body.targets)
    const status = await checkRecentConfirmation(targets)
    res.json(status)
  } catch (error) {
    next(error)
  }
})

router.post('/', optionalAuthMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const flagType = req.body.flagType as unknown
    if (flagType !== 'removal' && flagType !== 'confirmation') {
      throw new ValidationError('flagType must be removal or confirmation')
    }
    const rationale = sanitizeString(req.body.rationale, 1000)
    if (flagType === 'removal' && (!rationale || rationale.length < 2)) {
      throw new ValidationError('Removal rationale must be at least 2 characters')
    }

    const targets = await resolvePublicTargets(parseTargets(req.body.targets))

    if (flagType === 'confirmation') {
      const confStatus = await checkRecentConfirmation(targets)
      if (!confStatus.canRequestConfirmation) {
        const formattedDate = confStatus.lastConfirmedAt
          ? new Date(confStatus.lastConfirmedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
          : 'a recent date'
        throw new ValidationError(`This event was confirmed on ${formattedDate} and cannot be requested for confirmation again within 7 days.`)
      }
    }
    const reporter = getReporter(req, res)
    const respondBy = flagType === 'confirmation'
      ? new Date(Date.now() + CONFIRMATION_WINDOW_MS).toISOString()
      : null

    const { data: flag, error: flagError } = await supabaseAdmin
      .from('event_flags')
      .insert({
        flag_type: flagType,
        rationale: rationale || null,
        reporter_user_id: reporter.reporter_user_id,
        reporter_anonymous_id: reporter.reporter_anonymous_id,
        respond_by: respondBy,
      })
      .select('id, flag_type, status, respond_by, created_at')
      .single()
    if (flagError || !flag) throw flagError || new Error('Failed to create event flag')

    const targetRows = targets.map(target => ({
      flag_id: flag.id,
      target_type: target.type,
      target_id: target.id,
      owner_identity: target.ownerIdentity,
    }))
    const { error: targetsError } = await supabaseAdmin.from('event_flag_targets').insert(targetRows)
    if (targetsError) throw targetsError

    const actions = [{
      flag_id: flag.id,
      action: 'submitted',
      actor_type: reporter.actor_type,
      actor_user_id: reporter.reporter_user_id,
      actor_anonymous_id: reporter.reporter_anonymous_id,
      details: { target_count: targets.length },
    }]

    if (flagType === 'removal') {
      await setEventTargetsSuspended(targetRows, flag.id, true)
      actions.push({
        flag_id: flag.id,
        action: 'suspended',
        actor_type: reporter.actor_type,
        actor_user_id: reporter.reporter_user_id,
        actor_anonymous_id: reporter.reporter_anonymous_id,
        details: { target_count: targets.length },
      })
    }

    const { error: actionsError } = await supabaseAdmin.from('event_flag_actions').insert(actions)
    if (actionsError) throw actionsError
    res.status(201).json({ flag })
  } catch (error) {
    next(error)
  }
})

router.use(authMiddleware)

async function getUserIdentities(req: AuthenticatedRequest): Promise<Set<string>> {
  const identities = new Set<string>()
  if (req.userId) identities.add(req.userId)
  if (req.userEmail) identities.add(req.userEmail)

  const checkIds = Array.from(identities)
  if (checkIds.length > 0) {
    const { data: byId } = await supabaseAdmin
      .from('users')
      .select('id, email, wallet_address, traveler_name')
      .in('id', checkIds)

    for (const u of byId || []) {
      if (u.id) identities.add(u.id)
      if (u.email) identities.add(u.email)
      if (u.wallet_address) identities.add(u.wallet_address)
      if (u.traveler_name) identities.add(u.traveler_name)
    }

    if (req.userEmail) {
      const { data: byEmail } = await supabaseAdmin
        .from('users')
        .select('id, email, wallet_address, traveler_name')
        .in('email', [req.userEmail])

      for (const u of byEmail || []) {
        if (u.id) identities.add(u.id)
        if (u.email) identities.add(u.email)
        if (u.wallet_address) identities.add(u.wallet_address)
        if (u.traveler_name) identities.add(u.traveler_name)
      }
    }
  }
  return identities
}

interface FlagTargetRow {
  flag_id: string
  target_type: string
  target_id: string
  owner_identity: string
  status: string
  responded_at?: string | null
}

async function getOwnedTargets(req: AuthenticatedRequest, onlyActionable: boolean) {
  const isAdmin = req.userRoles?.includes('admin')

  if (isAdmin) {
    let query = supabaseAdmin
      .from('event_flag_targets')
      .select('flag_id, target_type, target_id, owner_identity, status, responded_at')
    if (onlyActionable) query = query.in('status', ['pending', 'expired'])
    const { data, error } = await query
    if (error) throw error
    return data || []
  }

  const identities = await getUserIdentities(req)
  const identityArray = Array.from(identities)
  if (identityArray.length === 0) return []

  // 1. Direct match on owner_identity
  let directQuery = supabaseAdmin
    .from('event_flag_targets')
    .select('flag_id, target_type, target_id, owner_identity, status, responded_at')
    .in('owner_identity', identityArray)
  if (onlyActionable) directQuery = directQuery.in('status', ['pending', 'expired'])
  const { data: directTargets, error: directError } = await directQuery
  if (directError) throw directError

  // 2. Target match by user_events or meetings owned by these identities
  const { data: userEvents } = await supabaseAdmin
    .from('user_events')
    .select('id')
    .in('user_id', identityArray)
  const userEventIds = (userEvents || []).map(e => e.id)

  const { data: calendars } = await supabaseAdmin
    .from('calendars')
    .select('id')
    .in('created_by', identityArray)
  const calendarIds = (calendars || []).map(c => c.id)

  let meetingIds: string[] = []
  if (calendarIds.length > 0) {
    const { data: meetings } = await supabaseAdmin
      .from('meetings')
      .select('id')
      .in('calendar_id', calendarIds)
    meetingIds = (meetings || []).map(m => m.id)
  }

  const targetFilters: string[] = []
  if (userEventIds.length > 0) {
    targetFilters.push(`and(target_type.eq.user_event,target_id.in.(${userEventIds.join(',')}))`)
  }
  if (meetingIds.length > 0) {
    targetFilters.push(`and(target_type.eq.meeting,target_id.in.(${meetingIds.join(',')}))`)
  }

  let extraTargets: FlagTargetRow[] = []
  if (targetFilters.length > 0) {
    let extraQuery = supabaseAdmin
      .from('event_flag_targets')
      .select('flag_id, target_type, target_id, owner_identity, status, responded_at')
      .or(targetFilters.join(','))
    if (onlyActionable) extraQuery = extraQuery.in('status', ['pending', 'expired'])
    const { data: extraData } = await extraQuery
    extraTargets = (extraData || []) as FlagTargetRow[]
  }

  const map = new Map<string, FlagTargetRow>()
  for (const t of [...((directTargets || []) as FlagTargetRow[]), ...extraTargets]) {
    map.set(`${t.flag_id}:${t.target_type}:${t.target_id}`, t)
  }
  return Array.from(map.values())
}

router.get('/active-count', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    await expireOverdueEventFlags()
    const targets = await getOwnedTargets(req, true)
    res.json({ count: new Set(targets.map(target => target.flag_id)).size })
  } catch (error) {
    next(error)
  }
})

router.get('/mine', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    await expireOverdueEventFlags()
    const targets = await getOwnedTargets(req, false)
    const flagIds = [...new Set(targets.map(target => target.flag_id))]
    if (flagIds.length === 0) return res.json({ flags: [] })

    const { data: flags, error } = await supabaseAdmin
      .from('event_flags')
      .select('id, flag_type, status, rationale, reporter_user_id, reporter_anonymous_id, respond_by, resolved_at, created_at, updated_at')
      .in('id', flagIds)
      .order('created_at', { ascending: false })
    if (error) throw error

    const userEventIds = targets.filter(target => target.target_type === 'user_event').map(target => target.target_id)
    const meetingIds = targets.filter(target => target.target_type === 'meeting').map(target => target.target_id)
    const titleMap = new Map<string, string>()
    if (userEventIds.length > 0) {
      const { data } = await supabaseAdmin.from('user_events').select('id, title').in('id', userEventIds)
      for (const event of data || []) titleMap.set(`user_event:${event.id}`, event.title)
    }
    if (meetingIds.length > 0) {
      const { data } = await supabaseAdmin.from('meetings').select('id, title').in('id', meetingIds)
      for (const meeting of data || []) titleMap.set(`meeting:${meeting.id}`, meeting.title || 'Meeting')
    }

    const response = (flags || []).map(flag => ({
      ...flag,
      reporter_user_id: undefined,
      reporter_anonymous_id: undefined,
      reporter_type: flag.reporter_user_id ? 'authenticated' : 'anonymous',
      targets: targets
        .filter(target => target.flag_id === flag.id)
        .map(target => ({
          type: target.target_type,
          id: target.target_id,
          title: titleMap.get(`${target.target_type}:${target.target_id}`) || 'Event',
          status: target.status,
          responded_at: target.responded_at,
        })),
    }))
    res.json({ flags: response })
  } catch (error) {
    next(error)
  }
})

router.post('/:id/respond', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const flagId = sanitizeUUID(req.params.id)
    if (!flagId) throw new ValidationError('Invalid flag id')
    const action = req.body.action as unknown
    if (action !== 'confirmed' && action !== 'removal_accepted' && action !== 'updated') {
      throw new ValidationError('Invalid response action')
    }

    const allOwnedTargets = await getOwnedTargets(req, false)
    const ownedTargets = allOwnedTargets.filter(target => target.flag_id === flagId)
    if (ownedTargets.length === 0) {
      return res.status(404).json({ error: 'No active flag targets found for this account' })
    }

    const now = new Date().toISOString()

    const { data: flagTargets, error: fetchTargetsError } = await supabaseAdmin
      .from('event_flag_targets')
      .select('target_type, target_id')
      .eq('flag_id', flagId)
    if (fetchTargetsError) throw fetchTargetsError

    const targetsToProcess = (flagTargets && flagTargets.length > 0) ? flagTargets : ownedTargets

    const userEventIds = new Set<string>()
    const meetingIds = new Set<string>()

    for (const t of targetsToProcess) {
      if (t.target_type === 'user_event') userEventIds.add(t.target_id)
      else if (t.target_type === 'meeting') meetingIds.add(t.target_id)
    }

    const isPublicNewState = action === 'confirmed' || action === 'updated'

    if (userEventIds.size > 0) {
      await supabaseAdmin
        .from('user_events')
        .update({ is_public: isPublicNewState, updated_at: now })
        .in('id', Array.from(userEventIds))
    }

    if (meetingIds.size > 0) {
      await supabaseAdmin
        .from('user_events')
        .update({ is_public: isPublicNewState, updated_at: now })
        .in('external_event_id', Array.from(meetingIds))
    }

    const { error: targetUpdateError } = await supabaseAdmin
      .from('event_flag_targets')
      .update({ status: action as ResponseAction, responded_at: now })
      .eq('flag_id', flagId)
    if (targetUpdateError) throw targetUpdateError

    await refreshEventTargetSuspensions(targetsToProcess, flagId)

    const { error: actionError } = await supabaseAdmin.from('event_flag_actions').insert({
      flag_id: flagId,
      action,
      actor_type: 'authenticated',
      actor_user_id: req.userId,
      details: { target_count: targetsToProcess.length },
    })
    if (actionError) throw actionError

    const { error: flagUpdateError } = await supabaseAdmin
      .from('event_flags')
      .update({ status: action, resolved_at: now })
      .eq('id', flagId)
    if (flagUpdateError) throw flagUpdateError

    res.json({ success: true })
  } catch (error) {
    next(error)
  }
})

export default router