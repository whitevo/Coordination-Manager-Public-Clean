import { Router, Request, Response } from 'express'
import { createHash } from 'crypto'
import { supabaseAdmin } from '../supabaseClient.js'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js'
import IcalExpander from 'ical-expander'
import { collapseExternalServiceErrorMessage, sanitizeUUID, safeErrorMessage } from '../middleware/validation.js'
import { deleteGoogleCopies, getKeepInSyncLinks, syncUserEventAfterChange } from '../services/google-event-sync.js'
import { clearEventTargetsSuspension, expireOverdueEventFlags, type EventModerationTargetType } from '../services/event-moderation.js'
import { eventTimestampKey, eventTimestampsEqual } from '../services/event-sync-timestamps.js'
import { fetchPublicCalendarUrl } from '../services/public-calendar-fetch.js'
import { parseUserEventWindow } from '../services/user-event-window.js'
import { ValidationError } from '../middleware/error-handler.js'
import { withTimeItemRecurrences } from '../services/time-item-recurrence.js'
import { getNetworkSourceKey } from '../services/network-source-key.js'

const router: ReturnType<typeof Router> = Router()

const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
const USER_EVENTS_STORAGE_UNAVAILABLE = 'User event sync storage is temporarily unavailable. Please try again later.'

interface EventLocationFields {
  description?: string | null
  meeting_link?: string | null
  location?: string | null
}

function resolveEventLocation<Event extends EventLocationFields>(event: Event) {
  const meetingLink = event.meeting_link?.trim() || null
  const sourceLocation = event.location?.trim() || null
  let description = event.description || null

  if (meetingLink && sourceLocation && meetingLink !== sourceLocation) {
    const locationLine = `Location: ${sourceLocation}`
    const hasLocationLine = description?.split(/\r?\n/)
      .some(line => line.trim().toLowerCase() === locationLine.toLowerCase())
    if (!hasLocationLine) {
      description = description ? `${description}\n\n${locationLine}` : locationLine
    }
  }

  return { ...event, description, location: meetingLink || sourceLocation }
}

type SyncSourceType = 'google_oauth' | 'google_public_url' | 'coordination_calendar'

type RecurrenceType = 'none' | 'weekly' | 'biweekly' | 'monthly' | 'monthlyWeek' | 'custom'
type RecurrenceUnit = 'day' | 'week' | 'month'
type RecurrenceEndType = 'never' | 'on' | 'after' | 'whenCompleted'

interface RecurrenceRule {
  type: RecurrenceType
  interval?: number
  unit?: RecurrenceUnit
  weekDays?: number[]
  weekOffsetDays?: number
  monthWeeks?: number[]
  endType?: RecurrenceEndType
  endDate?: string
  endCount?: number
  exceptions?: string[]
}

type UserEventSyncPrefRow = {
  user_id: string
  source_type: SyncSourceType
  source_id: string
  auto_sync: boolean
  auto_publish_new: boolean
  range_months: number
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function userEventSyncErrorMessage(error: unknown, fallback = 'Sync failed'): string {
  const collapsed = collapseExternalServiceErrorMessage(error, USER_EVENTS_STORAGE_UNAVAILABLE)
  const message = collapsed || (error instanceof Error && error.message ? error.message : fallback)
  return message.replace(/[\r\n]+/g, ' ').slice(0, 500)
}

function isMissingEventModerationSchema(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; message?: unknown }
  const moderationTables = [
    'event_flags',
    'event_flag_targets',
    'event_flag_actions',
    'public_event_moderation_state',
  ]
  const message = typeof candidate.message === 'string' ? candidate.message.toLowerCase() : ''
  const namesModerationTable = moderationTables.some(table => message.includes(table))
  return namesModerationTable && (
    candidate.code === '42P01' ||
    candidate.code === 'PGRST205' ||
    message.includes('does not exist') ||
    message.includes('schema cache')
  )
}

function sanitizeCategoryIdArray(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of input) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!UUID_RE.test(trimmed) || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
    if (out.length >= 20) break
  }
  return out
}

function sanitizeRecurrenceRule(input: unknown): RecurrenceRule | null {
  if (!input || typeof input !== 'object') return null

  const candidate = input as Record<string, unknown>
  const type = candidate.type
  if (type !== 'weekly' && type !== 'biweekly' && type !== 'monthly' && type !== 'monthlyWeek' && type !== 'custom' && type !== 'none') {
    return null
  }
  if (type === 'none') return null

  const intervalValue = typeof candidate.interval === 'number' ? candidate.interval : Number(candidate.interval)
  const interval = Number.isFinite(intervalValue) && intervalValue > 0 ? Math.min(99, Math.floor(intervalValue)) : 1
  const unit = candidate.unit === 'day' || candidate.unit === 'week' || candidate.unit === 'month' ? candidate.unit : 'week'
  const weekDays = Array.isArray(candidate.weekDays)
    ? Array.from(new Set(candidate.weekDays.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6)))
    : undefined
  const monthWeeks = Array.isArray(candidate.monthWeeks)
    ? Array.from(new Set(candidate.monthWeeks.filter((week): week is number => Number.isInteger(week) && week >= 1 && week <= 4))).sort((a, b) => a - b)
    : undefined
  const endType = candidate.endType === 'never' || candidate.endType === 'on' || candidate.endType === 'after' || candidate.endType === 'whenCompleted' ? candidate.endType : 'never'
  const endDate = typeof candidate.endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(candidate.endDate) ? candidate.endDate : undefined
  const endCountValue = typeof candidate.endCount === 'number' ? candidate.endCount : Number(candidate.endCount)
  const endCount = Number.isFinite(endCountValue) && endCountValue > 0 ? Math.min(500, Math.floor(endCountValue)) : undefined
  const exceptions = Array.isArray(candidate.exceptions)
    ? Array.from(new Set(candidate.exceptions.filter((entry): entry is string => typeof entry === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry)))).slice(0, 500)
    : undefined

  return {
    type,
    interval,
    unit,
    weekDays: weekDays && weekDays.length > 0 ? weekDays : undefined,
    monthWeeks: monthWeeks && monthWeeks.length > 0 ? monthWeeks : undefined,
    endType,
    endDate,
    endCount,
    exceptions: exceptions && exceptions.length > 0 ? exceptions : undefined,
    ...(type === 'custom' && unit === 'week' && typeof candidate.weekOffsetDays === 'number'
      && Number.isInteger(candidate.weekOffsetDays) && candidate.weekOffsetDays > 0 && candidate.weekOffsetDays < interval * 7
      ? { weekOffsetDays: candidate.weekOffsetDays } : {}),
  }
}

function buildUserEventsRevision(events: Array<Record<string, unknown>>): string {
  let latestUpdatedAt = ''
  for (const event of events) {
    if (typeof event.updated_at === 'string' && event.updated_at > latestUpdatedAt) {
      latestUpdatedAt = event.updated_at
    }
  }
  return `${events.length}:${latestUpdatedAt}`
}

async function validateOwnedCategoryIds(userId: string, categoryIds: string[]): Promise<boolean> {
  if (categoryIds.length === 0) return true

  const { data, error } = await supabaseAdmin
    .from('time_management_categories')
    .select('id')
    .eq('user_id', userId)
    .in('id', categoryIds)

  if (error) throw error

  const found = new Set((data || []).map((row) => row.id))
  return categoryIds.every((id) => found.has(id))
}

async function resolveManualModeSourceId(userId: string, requestedSourceId: unknown): Promise<string | null> {
  if (typeof requestedSourceId === 'string' && requestedSourceId.trim().length > 0) {
    const modeId = sanitizeUUID(requestedSourceId)
    if (!modeId) {
      throw new Error('source_id must be a valid mode UUID')
    }

    const { data: requestedMode, error: requestedModeError } = await supabaseAdmin
      .from('time_management_modes')
      .select('id')
      .eq('id', modeId)
      .eq('user_id', userId)
      .maybeSingle()

    if (requestedModeError) {
      throw new Error(requestedModeError.message)
    }
    if (!requestedMode) {
      throw new Error('source_id does not belong to one of your modes')
    }

    return modeId
  }

  const { data: prefs, error: prefsError } = await supabaseAdmin
    .from('time_management_prefs')
    .select('active_mode_id')
    .eq('user_id', userId)
    .maybeSingle()

  if (prefsError) {
    throw new Error(prefsError.message)
  }

  const preferredModeId = sanitizeUUID(prefs?.active_mode_id)
  if (preferredModeId) {
    return preferredModeId
  }

  const { data: firstMode, error: firstModeError } = await supabaseAdmin
    .from('time_management_modes')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (firstModeError) {
    throw new Error(firstModeError.message)
  }

  return firstMode?.id || null
}

// ─── GET /api/user-events/public (no auth required) ─────────
// List ALL public events across all users AND meetings from public
// Coordination Calendars (for the Events Calendar page).

router.get('/public', async (_req: Request, res: Response) => {
  try {
    try {
      await expireOverdueEventFlags()
    } catch (error) {
      if (!isMissingEventModerationSchema(error)) throw error
    }

    const { data: suspendedRows, error: suspensionError } = await supabaseAdmin
      .from('public_event_moderation_state')
      .select('target_type, target_id')
      .eq('is_suspended', true)
    if (suspensionError && !isMissingEventModerationSchema(suspensionError)) throw suspensionError
    const suspendedTargets = new Set(
      (suspendedRows || []).map(row => `${row.target_type}:${row.target_id}`),
    )

    // 1. User-published events from user_events table
    const { data: userEvents, error: ueError } = await supabaseAdmin
      .from('user_events')
      .select('id, title, description, meeting_link, location, start_time, end_time, is_public, source_type, source_id, external_event_id, recurrence_rule, created_at, updated_at')
      .eq('is_public', true)
      .order('start_time', { ascending: true })

    if (ueError) return res.status(400).json({ error: safeErrorMessage(ueError) })

    // Look up calendar_sources display names for google_oauth events
    const sourceIds = [...new Set((userEvents || []).map(e => e.source_id).filter(Boolean))]
    const sourceDisplayNames = new Map<string, string>()

    if (sourceIds.length > 0) {
      const { data: sources } = await supabaseAdmin
        .from('calendar_sources')
        .select('id, display_name')
        .in('id', sourceIds)

      if (sources) {
        for (const s of sources) {
          sourceDisplayNames.set(s.id, s.display_name)
        }
      }

      const { data: coordCals } = await supabaseAdmin
        .from('calendars')
        .select('hash, title')
        .in('hash', sourceIds)

      if (coordCals) {
        for (const c of coordCals) {
          sourceDisplayNames.set(c.hash, c.title)
        }
      }
    }

    // Enrich user events with calendar_title from their source
    const enrichedUserEvents = (userEvents || [])
      .filter(ev => {
        if (suspendedTargets.has(`user_event:${ev.id}`)) return false
        if (ev.external_event_id && suspendedTargets.has(`meeting:${ev.external_event_id}`)) return false
        return true
      })
      .map(ev => ({
        ...resolveEventLocation(ev),
        calendar_title: ev.source_id ? sourceDisplayNames.get(ev.source_id) || undefined : undefined,
        network_source_key: getNetworkSourceKey(ev.source_type, ev.source_id),
        moderation_targets: [
          { type: 'user_event' as const, id: ev.id },
          ...(ev.source_type === 'coordination_calendar' && sanitizeUUID(ev.external_event_id)
            ? [{ type: 'meeting' as const, id: ev.external_event_id as string }]
            : []),
        ],
        source_id: undefined, // don't expose source_id to client
      }))

    // 2. Meetings from public Coordination Calendars
    //    First fetch all public calendars, then their meetings
    const { data: publicCalendars, error: calError } = await supabaseAdmin
      .from('calendars')
      .select('id, hash, title')
      .eq('visibility', 'public')

    if (calError) {
      console.error('Error fetching public calendars:', calError)
      // Continue with just user events if this fails
      return res.json({ events: enrichedUserEvents })
    }

    let coordMeetings: Array<{
      id: string; title: string; description: string | null;
      meeting_link: string | null; location: string | null;
      start_time: string; end_time: string; is_public: boolean;
      source_type: string; created_at: string;
      updated_at: string;
      calendar_title?: string; calendar_hash?: string;
    }> = []

    if (publicCalendars && publicCalendars.length > 0) {
      const calendarIds = publicCalendars.map(c => c.id)
      const calendarMap = new Map(publicCalendars.map(c => [c.id, c]))

      const { data: meetings, error: meetError } = await supabaseAdmin
        .from('meetings')
        .select('id, calendar_id, title, description, meeting_link, start_time, end_time, created_at, updated_at')
        .in('calendar_id', calendarIds)
        .order('start_time', { ascending: true })

      if (!meetError && meetings) {
        coordMeetings = meetings.map(m => {
          const cal = calendarMap.get(m.calendar_id)
          // meetings.start_time/end_time are stored as plain TIMESTAMP (no tz)
          // but are always UTC. Ensure the ISO string has a Z suffix so
          // the browser doesn't interpret them as local time.
          const ensureUTC = (ts: string) =>
            ts && !ts.endsWith('Z') && !ts.includes('+') ? ts + 'Z' : ts
          return {
            id: `coord_${m.id}`,
            title: m.title || cal?.title || 'Meeting',
            description: m.description || null,
            meeting_link: m.meeting_link || null,
            location: m.meeting_link || null,
            start_time: ensureUTC(m.start_time),
            end_time: ensureUTC(m.end_time),
            is_public: true,
            source_type: 'coordination_calendar',
            created_at: m.created_at,
            updated_at: m.updated_at,
            calendar_title: cal?.title,
            calendar_hash: cal?.hash,
            network_source_key: getNetworkSourceKey('coordination_calendar', cal?.hash),
            moderation_targets: [{ type: 'meeting' as const, id: m.id }],
          }
        })
      }
    }

    // 3. Merge and deduplicate: if a user_event was already imported from a
    //    coordination calendar meeting, prefer the user_event (it may have been
    //    edited). Build a set of known external_event_ids to skip duplicates.
    const seenCoordMeetingIds = new Set<string>()

    // Fetch external_event_ids from public user_events sourced from coordination calendars
    if (coordMeetings.length > 0) {
      const { data: importedEvents, error: importedEventsError } = await supabaseAdmin
        .from('user_events')
        .select('external_event_id')
        .eq('is_public', true)
        .eq('source_type', 'coordination_calendar')
        .not('external_event_id', 'is', null)

      if (importedEventsError) {
        throw importedEventsError
      }

      if (importedEvents) {
        for (const ie of importedEvents) {
          if (ie.external_event_id) seenCoordMeetingIds.add(ie.external_event_id)
        }
      }
    }

    // Filter out coordination meetings that were already imported & published
    const uniqueCoordMeetings = coordMeetings.filter(m => {
      const originalId = m.id.replace(/^coord_/, '')
      return !seenCoordMeetingIds.has(originalId) && !suspendedTargets.has(`meeting:${originalId}`)
    })

    // Combine, sort by start_time
    const allEvents = [...enrichedUserEvents, ...uniqueCoordMeetings]
    allEvents.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())

    res.json({ events: allEvents })
  } catch {
    res.status(500).json({ error: 'Failed to fetch public events' })
  }
})

// ─── All remaining routes require auth ──────────────────────
router.use(authMiddleware)

// ─── Helper: refresh Google access token ────────────────────

async function ensureFreshAccessToken(source: {
  id: string
  google_access_token: string | null
  google_refresh_token: string | null
  token_expires_at: string | null
}): Promise<string> {
  if (source.google_access_token && source.token_expires_at) {
    const expiresAt = new Date(source.token_expires_at).getTime()
    if (Date.now() < expiresAt - 5 * 60 * 1000) {
      return source.google_access_token
    }
  }

  if (!source.google_refresh_token) {
    throw new Error('No refresh token available — please re-authorize this calendar.')
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('Missing Google OAuth config')

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: source.google_refresh_token,
      grant_type: 'refresh_token',
    }),
  })

  const tokenData = await tokenRes.json() as { access_token?: string; expires_in?: number; error?: string }
  if (!tokenRes.ok || tokenData.error) {
    throw new Error(tokenData.error || 'Failed to refresh access token')
  }

  const newExpiry = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString()
  await supabaseAdmin
    .from('calendar_sources')
    .update({ google_access_token: tokenData.access_token, token_expires_at: newExpiry })
    .eq('id', source.id)

  return tokenData.access_token!
}

// ─── Helper: parse ICS events with full detail ──────────────

function parseIcsEventsFull(
  icsText: string,
  rangeMinMs: number,
  rangeMaxMs: number,
): Array<{ start: string; end: string; title: string; description?: string; location?: string; uid?: string }> {
  const after = new Date(rangeMinMs)
  const before = new Date(rangeMaxMs)

  const icalExpander = new IcalExpander({ ics: icsText, maxIterations: 1000 })
  const { events, occurrences } = icalExpander.between(after, before)

  const results: Array<{ start: string; end: string; title: string; description?: string; location?: string; uid?: string }> = []

  for (const event of events) {
    const startDate = event.startDate?.toJSDate()
    const endDate = event.endDate?.toJSDate()
    if (!startDate) continue
    results.push({
      start: startDate.toISOString(),
      end: (endDate || new Date(startDate.getTime() + 3600000)).toISOString(),
      title: event.summary || 'Untitled Event',
      description: event.description || undefined,
      location: event.location || undefined,
      uid: event.uid || undefined,
    })
  }

  for (const occ of occurrences) {
    const startDate = occ.startDate?.toJSDate()
    const endDate = occ.endDate?.toJSDate()
    if (!startDate) continue
    // Append start time to UID so each recurrence instance gets a unique external_event_id
    const baseUid = occ.item?.uid
    const occUid = baseUid ? `${baseUid}_${startDate.toISOString()}` : undefined
    results.push({
      start: startDate.toISOString(),
      end: (endDate || new Date(startDate.getTime() + 3600000)).toISOString(),
      title: occ.item?.summary || 'Untitled Event',
      description: occ.item?.description || undefined,
      location: occ.item?.location || undefined,
      uid: occUid,
    })
  }

  return results
}

type ImportedExternalEvent = {
  title: string
  description?: string
  meeting_link?: string
  location?: string
  start: string
  end: string
  uid?: string
}

interface ImportedEventRow {
  id: string
  external_event_id: string | null
  title: string
  description: string | null
  meeting_link: string | null
  location: string | null
  start_time: string
  end_time: string
  is_public: boolean | null
}

const IMPORTED_EVENTS_PAGE_SIZE = 1000

function buildFallbackExternalEventId(sourceType: string, sourceId: string, event: ImportedExternalEvent): string {
  const fingerprint = [
    sourceType,
    sourceId,
    event.title || '',
    event.start,
    event.end,
    event.location || '',
  ].join('|')

  return `fallback_${createHash('sha256').update(fingerprint).digest('hex').slice(0, 32)}`
}

function buildEventFingerprint(event: {
  title: string
  start: string
  end: string
  meeting_link?: string | null
  location?: string | null
}): string {
  return [
    (event.title || '').trim().toLowerCase(),
    eventTimestampKey(event.start),
    eventTimestampKey(event.end),
    (event.meeting_link || '').trim(),
    (event.location || '').trim(),
  ].join('|')
}

function eventOverlapsSyncWindow(
  row: { start_time: string; end_time: string },
  windowStartMs: number,
  windowEndMs: number,
): boolean {
  const rowStartMs = new Date(row.start_time).getTime()
  const rowEndMs = new Date(row.end_time).getTime()

  if (!Number.isFinite(rowStartMs) || !Number.isFinite(rowEndMs)) {
    return false
  }

  return rowStartMs < windowEndMs && rowEndMs > windowStartMs
}

async function fetchImportedEventsFromCalendarSource(
  source: {
    id: string
    source_type: 'google_oauth' | 'google_public_url'
    google_access_token: string | null
    google_refresh_token: string | null
    token_expires_at: string | null
    public_url: string | null
  },
  timeMin: string,
  timeMax: string,
): Promise<ImportedExternalEvent[]> {
  const importedEvents: ImportedExternalEvent[] = []

  if (source.source_type === 'google_oauth') {
    const accessToken = await ensureFreshAccessToken(source)

    let pageToken: string | undefined
    do {
      const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
      })
      if (pageToken) params.set('pageToken', pageToken)

      const eventsRes = await fetch(
        `${GOOGLE_CALENDAR_API}/calendars/primary/events?${params}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )

      if (!eventsRes.ok) {
        const errData = await eventsRes.json() as { error?: { message?: string } }
        throw new Error(errData.error?.message || `Google API error (${eventsRes.status})`)
      }

      const eventsData = await eventsRes.json() as {
        items?: Array<{
          id?: string
          summary?: string
          description?: string
          location?: string
          start?: { dateTime?: string; date?: string }
          end?: { dateTime?: string; date?: string }
          hangoutLink?: string
          conferenceData?: { entryPoints?: Array<{ entryPointType: string; uri: string }> }
        }>
        nextPageToken?: string
      }

      for (const item of eventsData.items || []) {
        const startStr = item.start?.dateTime || (item.start?.date ? `${item.start.date}T00:00:00Z` : null)
        const endStr = item.end?.dateTime || (item.end?.date ? `${item.end.date}T00:00:00Z` : null)
        if (!startStr || !endStr) continue

        let meetingLink = item.hangoutLink || undefined
        if (!meetingLink && item.conferenceData?.entryPoints) {
          const videoEntry = item.conferenceData.entryPoints.find(ep => ep.entryPointType === 'video')
          if (videoEntry) meetingLink = videoEntry.uri
        }

        importedEvents.push({
          title: item.summary || 'Untitled Event',
          description: item.description || undefined,
          meeting_link: meetingLink,
          location: item.location || undefined,
          start: startStr,
          end: endStr,
          uid: item.id || undefined,
        })
      }

      pageToken = eventsData.nextPageToken
    } while (pageToken)

    return importedEvents
  }

  if (source.source_type === 'google_public_url') {
    if (!source.public_url) return importedEvents
    const icsRes = await fetchPublicCalendarUrl(source.public_url, { signal: AbortSignal.timeout(15_000) })
    if (!icsRes.ok) {
      throw new Error(`Failed to fetch ICS feed (HTTP ${icsRes.status})`)
    }
    const icsText = await icsRes.text()
    const parsed = parseIcsEventsFull(icsText, new Date(timeMin).getTime(), new Date(timeMax).getTime())
    return parsed.map(e => ({
      title: e.title,
      description: e.description,
      location: e.location,
      start: e.start,
      end: e.end,
      uid: e.uid,
    }))
  }

  return importedEvents
}

async function fetchImportedMeetingsFromCoordinationCalendar(
  calendarHash: string,
): Promise<ImportedExternalEvent[]> {
  const { data: calendar, error: calErr } = await supabaseAdmin
    .from('calendars')
    .select('id, hash, title')
    .eq('hash', calendarHash)
    .single()

  if (calErr || !calendar) {
    throw new Error('Coordination Calendar not found')
  }

  const { data: meetings, error: meetErr } = await supabaseAdmin
    .from('meetings')
    .select('id, title, description, meeting_link, start_time, end_time')
    .eq('calendar_id', calendar.id)

  if (meetErr) {
    throw new Error(meetErr.message)
  }

  const ensureUTC = (ts: string) =>
    ts && !ts.endsWith('Z') && !ts.includes('+') ? ts + 'Z' : ts

  return (meetings || []).map(m => ({
    title: m.title || calendar.title || 'Meeting',
    description: m.description || undefined,
    meeting_link: m.meeting_link || undefined,
    location: m.meeting_link || undefined,
    start: ensureUTC(m.start_time),
    end: ensureUTC(m.end_time),
    uid: m.id,
  }))
}

async function syncImportedSource(
  userId: string,
  sourceType: SyncSourceType,
  sourceId: string,
  timeMin: string,
  timeMax: string,
  options?: { autoPublishNew?: boolean },
): Promise<{ inserted: number; updated: number; deleted: number; totalFound: number }> {
  const autoPublishNew = !!options?.autoPublishNew
  const syncWindowStartMs = new Date(timeMin).getTime()
  const syncWindowEndMs = new Date(timeMax).getTime()
  let incomingEvents: ImportedExternalEvent[]

  if (sourceType === 'coordination_calendar') {
    incomingEvents = await fetchImportedMeetingsFromCoordinationCalendar(sourceId)
  } else {
    const { data: source, error: sourceErr } = await supabaseAdmin
      .from('calendar_sources')
      .select('id, source_type, google_access_token, google_refresh_token, token_expires_at, public_url')
      .eq('id', sourceId)
      .eq('user_id', userId)
      .single()

    if (sourceErr || !source) {
      throw new Error('Calendar source not found')
    }

    if (source.source_type !== sourceType) {
      throw new Error('Source type mismatch for imported events')
    }

    incomingEvents = await fetchImportedEventsFromCalendarSource(source, timeMin, timeMax)
  }

  const normalizedIncoming = incomingEvents.map(ev => {
    eventTimestampKey(ev.start)
    eventTimestampKey(ev.end)
    const resolved = resolveEventLocation(ev)
    return {
      ...ev,
      description: resolved.description || undefined,
      location: resolved.location || undefined,
      external_event_id: ev.uid || buildFallbackExternalEventId(sourceType, sourceId, ev),
    }
  })

  const incomingByExternalId = new Map<string, typeof normalizedIncoming[number]>()
  for (const ev of normalizedIncoming) {
    if (!incomingByExternalId.has(ev.external_event_id)) {
      incomingByExternalId.set(ev.external_event_id, ev)
    }
  }

  const existingRows: ImportedEventRow[] = []
  for (let offset = 0; ; ) {
    const { data, error } = await supabaseAdmin
      .from('user_events')
      .select('id, external_event_id, title, description, meeting_link, location, start_time, end_time, is_public')
      .eq('user_id', userId)
      .eq('source_type', sourceType)
      .eq('source_id', sourceId)
      .order('id', { ascending: true })
      .range(offset, offset + IMPORTED_EVENTS_PAGE_SIZE - 1)

    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    existingRows.push(...data)
    // Advance by the actual response size even when PostgREST has a lower row cap.
    offset += data.length
  }

  const existingByExternalId = new Map<string, ImportedEventRow>()
  const existingNoExternalByFingerprint = new Map<string, ImportedEventRow[]>()
  for (const row of existingRows) {
    if (row.external_event_id) {
      existingByExternalId.set(row.external_event_id, row)
      continue
    }

    const fp = buildEventFingerprint({
      title: row.title,
      start: row.start_time,
      end: row.end_time,
      meeting_link: row.meeting_link,
      location: row.location,
    })
    const list = existingNoExternalByFingerprint.get(fp) || []
    list.push(row)
    existingNoExternalByFingerprint.set(fp, list)
  }

  let inserted = 0
  let updated = 0
  let deleted = 0
  const matchedLegacyRowIds = new Set<string>()

  const rowsToInsert: Array<{
    user_id: string
    source_type: 'google_oauth' | 'google_public_url' | 'coordination_calendar'
    source_id: string
    external_event_id: string
    title: string
    description: string | null
    meeting_link: string | null
    location: string | null
    start_time: string
    end_time: string
    is_public: boolean
  }> = []

  for (const [externalId, incoming] of incomingByExternalId.entries()) {
    const existing = existingByExternalId.get(externalId)
    if (!existing) {
      const incomingFp = buildEventFingerprint({
        title: incoming.title,
        start: incoming.start,
        end: incoming.end,
        meeting_link: incoming.meeting_link,
        location: incoming.location,
      })
      const legacyCandidates = existingNoExternalByFingerprint.get(incomingFp) || []
      const legacyMatch = legacyCandidates.find(r => !matchedLegacyRowIds.has(r.id))

      if (legacyMatch) {
        const { error: legacyUpdateErr } = await supabaseAdmin
          .from('user_events')
          .update({
            external_event_id: externalId,
            title: incoming.title,
            description: incoming.description || null,
            meeting_link: incoming.meeting_link || null,
            location: incoming.location || null,
            start_time: incoming.start,
            end_time: incoming.end,
            updated_at: new Date().toISOString(),
          })
          .eq('id', legacyMatch.id)
          .eq('user_id', userId)

        if (legacyUpdateErr) {
          throw new Error(legacyUpdateErr.message)
        }

        matchedLegacyRowIds.add(legacyMatch.id)
        updated++
        continue
      }

      rowsToInsert.push({
        user_id: userId,
        source_type: sourceType,
        source_id: sourceId,
        external_event_id: externalId,
        title: incoming.title,
        description: incoming.description || null,
        meeting_link: incoming.meeting_link || null,
        location: incoming.location || null,
        start_time: incoming.start,
        end_time: incoming.end,
        is_public: autoPublishNew,
      })
      continue
    }

    const needsUpdate = (
      existing.title !== incoming.title ||
      (existing.description || null) !== (incoming.description || null) ||
      (existing.meeting_link || null) !== (incoming.meeting_link || null) ||
      (existing.location || null) !== (incoming.location || null) ||
      !eventTimestampsEqual(existing.start_time, incoming.start) ||
      !eventTimestampsEqual(existing.end_time, incoming.end)
    )

    if (!needsUpdate) continue

    const { error: updateErr } = await supabaseAdmin
      .from('user_events')
      .update({
        title: incoming.title,
        description: incoming.description || null,
        meeting_link: incoming.meeting_link || null,
        location: incoming.location || null,
        start_time: incoming.start,
        end_time: incoming.end,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .eq('user_id', userId)

    if (updateErr) {
      throw new Error(updateErr.message)
    }
    updated++
  }

  if (rowsToInsert.length > 0) {
    // Upsert instead of plain insert: a concurrent sync pass (e.g. the
    // background auto-sync overlapping a manual "sync now") can race to
    // insert the same external_event_id, which would otherwise violate the
    // idx_user_events_external_upsert unique index and abort the whole sync.
    const { data: insertedRows, error: insertErr } = await supabaseAdmin
      .from('user_events')
      .upsert(rowsToInsert, {
        onConflict: 'user_id,source_type,source_id,external_event_id',
        ignoreDuplicates: false,
      })
      .select('id')

    if (insertErr) {
      throw new Error(insertErr.message)
    }
    inserted = insertedRows?.length || 0
  }

  const incomingIds = new Set(incomingByExternalId.keys())
  const shouldScopeDeletionToWindow =
    sourceType !== 'coordination_calendar' &&
    Number.isFinite(syncWindowStartMs) &&
    Number.isFinite(syncWindowEndMs)

  const staleRowIds = (existingRows || [])
    .filter(row => {
      if (
        shouldScopeDeletionToWindow &&
        !eventOverlapsSyncWindow(row, syncWindowStartMs, syncWindowEndMs)
      ) {
        return false
      }

      if (!row.external_event_id) {
        return !matchedLegacyRowIds.has(row.id)
      }
      return !incomingIds.has(row.external_event_id)
    })
    .map(row => row.id)

  if (staleRowIds.length > 0) {
    const { data: deletedRows, error: deleteErr } = await supabaseAdmin
      .from('user_events')
      .delete()
      .eq('user_id', userId)
      .in('id', staleRowIds)
      .select('id')

    if (deleteErr) {
      throw new Error(deleteErr.message)
    }
    deleted = deletedRows?.length || 0
  }

  return {
    inserted,
    updated,
    deleted,
    totalFound: incomingByExternalId.size,
  }
}

export async function runPersistedUserEventAutoSync(
  opts?: { maxUsers?: number }
): Promise<{ users: number; syncedSources: number; inserted: number; updated: number; deleted: number; failedSources: number }> {
  const maxUsers = Number.isFinite(Number(opts?.maxUsers)) ? Math.max(1, Math.floor(Number(opts?.maxUsers))) : 100

  const { data: prefRows, error: prefErr } = await supabaseAdmin
    .from('user_event_sync_prefs')
    .select('user_id, source_type, source_id, auto_sync, auto_publish_new, range_months')
    .eq('auto_sync', true)

  if (prefErr) {
    throw new Error(userEventSyncErrorMessage(prefErr))
  }

  const groupedByUser = new Map<string, UserEventSyncPrefRow[]>()
  for (const row of (prefRows || []) as UserEventSyncPrefRow[]) {
    if (!row.user_id || !row.source_id) continue
    const list = groupedByUser.get(row.user_id) || []
    list.push(row)
    groupedByUser.set(row.user_id, list)
  }

  const userIds = Array.from(groupedByUser.keys()).slice(0, maxUsers)
  let syncedSources = 0
  let inserted = 0
  let updated = 0
  let deleted = 0
  let failedSources = 0

  for (const userId of userIds) {
    const prefs = groupedByUser.get(userId) || []
    for (const pref of prefs) {
      const now = new Date()
      const timeMin = now.toISOString()
      const timeMaxDate = new Date(now)
      timeMaxDate.setMonth(timeMaxDate.getMonth() + Math.min(24, Math.max(1, Math.floor(pref.range_months || 12))))
      const timeMax = timeMaxDate.toISOString()

      try {
        const summary = await syncImportedSource(
          userId,
          pref.source_type,
          pref.source_id,
          timeMin,
          timeMax,
          { autoPublishNew: pref.auto_publish_new }
        )

        syncedSources++
        inserted += summary.inserted
        updated += summary.updated
        deleted += summary.deleted

        await supabaseAdmin
          .from('user_event_sync_prefs')
          .update({
            last_synced_at: new Date().toISOString(),
            last_sync_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId)
          .eq('source_type', pref.source_type)
          .eq('source_id', pref.source_id)
      } catch (err: unknown) {
        failedSources++
        const errorMsg = userEventSyncErrorMessage(err)
        const { error: updateError } = await supabaseAdmin
          .from('user_event_sync_prefs')
          .update({
            last_sync_error: errorMsg,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId)
          .eq('source_type', pref.source_type)
          .eq('source_id', pref.source_id)

        if (updateError) {
          console.warn(`[user-events:auto-sync] failed to record sync error: ${userEventSyncErrorMessage(updateError)}`)
        }
      }
    }
  }

  return {
    users: userIds.length,
    syncedSources,
    inserted,
    updated,
    deleted,
    failedSources,
  }
}

// ─── GET /api/user-events ───────────────────────────────────
// List all events for the authenticated user (their "Your Event Calendar")

router.get('/revision', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, count, error } = await supabaseAdmin
      .from('user_events')
      .select('updated_at', { count: 'exact' })
      .eq('user_id', req.userId)
      .order('updated_at', { ascending: false })
      .limit(1)

    if (error) return res.status(400).json({ error: safeErrorMessage(error) })
    const latestUpdatedAt = typeof data?.[0]?.updated_at === 'string' ? data[0].updated_at : ''
    return res.json({ revision: `${count ?? 0}:${latestUpdatedAt}` })
  } catch {
    return res.status(500).json({ error: 'Failed to fetch event revision' })
  }
})

router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const window = parseUserEventWindow(req.query.windowStart, req.query.windowEnd)
    // PostgREST caps a single request at its configured max-rows (commonly
    // 1000). Without pagination, any user with 1000+ total events would have
    // everything sorting after that cutoff -- typically their furthest-future
    // items -- silently dropped from the response despite the rows still
    // existing untouched in the database. Page through until a page comes
    // back short to guarantee every row is returned.
    const PAGE_SIZE = 1000
    const events: Array<EventLocationFields & { id: string; source_id: string | null; source_type: string; recurrence_id?: string | null; [key: string]: unknown }> = []
    for (let from = 0; ; from += PAGE_SIZE) {
      let query = supabaseAdmin
        .from('user_events')
        .select('*')
        .eq('user_id', req.userId)
      if (window) {
        // Old recurrence masters are needed even when their base occurrence is
        // outside the window. Consumers expand their rules in the visible week.
        query = query.lt('start_time', window.windowEnd).or(
          `end_time.gt.${window.windowStart},and(recurrence_rule.not.is.null,recurrence_rule->>type.neq.none)`,
        )
      }
      const { data, error } = await query
        .order('start_time', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1)

      if (error) return res.status(400).json({ error: safeErrorMessage(error) })
      const page = data || []
      events.push(...page)
      if (page.length < PAGE_SIZE) break
    }

    // Self-healing cleanup: remove imported meetings whose originating source
    // (a connected Google calendar source or a coordination calendar network)
    // no longer exists. These orphaned events would otherwise linger in the
    // user's cache as source-less ("object") entries.
    const googleSourceIds = new Set<string>()
    const coordinationHashes = new Set<string>()
    for (const event of events) {
      if (typeof event.source_id !== 'string' || event.source_id.length === 0) continue
      if (event.source_type === 'google_oauth' || event.source_type === 'google_public_url') {
        googleSourceIds.add(event.source_id)
      } else if (event.source_type === 'coordination_calendar') {
        coordinationHashes.add(event.source_id)
      }
    }

    const validGoogleSourceIds = new Set<string>()
    const validCoordinationHashes = new Set<string>()
    let googleLookupOk = true
    let coordinationLookupOk = true

    if (googleSourceIds.size > 0) {
      const { data: sourceRows, error: sourceErr } = await supabaseAdmin
        .from('calendar_sources')
        .select('id')
        .eq('user_id', req.userId)
        .in('id', Array.from(googleSourceIds))
      if (sourceErr) {
        googleLookupOk = false
      } else {
        for (const row of sourceRows || []) validGoogleSourceIds.add(row.id)
      }
    }

    if (coordinationHashes.size > 0) {
      const { data: calendarRows, error: calendarErr } = await supabaseAdmin
        .from('calendars')
        .select('hash')
        .in('hash', Array.from(coordinationHashes))
      if (calendarErr) {
        coordinationLookupOk = false
      } else {
        for (const row of calendarRows || []) validCoordinationHashes.add(row.hash)
      }
    }

    const orphanIds: string[] = []
    for (const event of events) {
      if (typeof event.source_id !== 'string' || event.source_id.length === 0) continue
      const isGoogle = event.source_type === 'google_oauth' || event.source_type === 'google_public_url'
      const isCoordination = event.source_type === 'coordination_calendar'
      if (isGoogle && googleLookupOk && !validGoogleSourceIds.has(event.source_id)) {
        orphanIds.push(event.id)
      } else if (isCoordination && coordinationLookupOk && !validCoordinationHashes.has(event.source_id)) {
        orphanIds.push(event.id)
      }
    }

    let visibleEvents = events
    if (orphanIds.length > 0) {
      const orphanIdSet = new Set(orphanIds)
      const { error: pruneErr } = await supabaseAdmin
        .from('user_events')
        .delete()
        .eq('user_id', req.userId)
        .in('id', orphanIds)
      if (pruneErr) {
        console.error('Failed to prune orphaned user events:', pruneErr)
      } else {
        visibleEvents = events.filter((event) => !orphanIdSet.has(event.id))
      }
    }

    res.json({
      events: await withTimeItemRecurrences(visibleEvents.map(resolveEventLocation), req.userId),
      ...(window
        ? { scope: { kind: 'window', ...window } }
        : { revision: buildUserEventsRevision(visibleEvents) }),
    })
  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ error: error.code, message: error.message, statusCode: error.statusCode })
    }
    console.error('Failed to fetch user events:', error)
    res.status(500).json({ error: 'Failed to fetch events' })
  }
})

router.get('/conditional-recurrences', async (req: AuthenticatedRequest, res: Response) => {
  if (!req.userId) return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Sign in to read recurrences', statusCode: 401 })
  try {
    const { data, error } = await supabaseAdmin.from('time_item_recurrences')
      .select('id').eq('user_id', req.userId).eq('status', 'active').limit(1)
    if (error) throw error
    return res.json({ active: data.length > 0 })
  } catch (error) {
    console.error('Failed to read active Time Item recurrences:', userEventSyncErrorMessage(error))
    return res.status(500).json({ error: 'RECURRENCE_READ_FAILED', message: 'Could not read active recurrences', statusCode: 500 })
  }
})

router.post('/conditional-recurrences/check', async (req: AuthenticatedRequest, res: Response) => {
  if (!req.userId) return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Sign in to check recurrences', statusCode: 401 })
  try {
    const { data, error } = await supabaseAdmin.rpc('advance_time_item_recurrences', { p_user_id: req.userId })
    if (error) throw error
    if (!Number.isInteger(data) || data < 0) throw new Error('Recurrence generation returned an invalid count')
    return res.json({ created: data })
  } catch (error) {
    console.error('Failed to advance Time Item recurrences:', userEventSyncErrorMessage(error))
    return res.status(500).json({ error: 'RECURRENCE_CHECK_FAILED', message: 'Could not check recurring Time Items. Please try again.', statusCode: 500 })
  }
})

router.get('/:id/latest-occurrence', async (req: AuthenticatedRequest, res: Response) => {
  if (!req.userId) return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Sign in to read recurrences', statusCode: 401 })
  const id = sanitizeUUID(req.params.id)
  if (!id) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid event id', statusCode: 400 })
  try {
    const { data: event, error } = await supabaseAdmin.from('user_events')
      .select('recurrence_id').eq('id', id).eq('user_id', req.userId).maybeSingle()
    if (error) throw error
    if (!event?.recurrence_id) return res.status(404).json({ error: 'NOT_FOUND', message: 'Recurrence not found', statusCode: 404 })
    const { data: series, error: seriesError } = await supabaseAdmin.from('time_item_recurrences')
      .select('latest_event_id').eq('id', event.recurrence_id).eq('user_id', req.userId).single()
    if (seriesError) throw seriesError
    const { data: latest, error: latestError } = await supabaseAdmin.from('user_events')
      .select('*').eq('id', series.latest_event_id).eq('user_id', req.userId).maybeSingle()
    if (latestError) throw latestError
    if (!latest) return res.status(404).json({ error: 'NOT_FOUND', message: 'Latest occurrence no longer exists', statusCode: 404 })
    const [resolved] = await withTimeItemRecurrences([resolveEventLocation(latest)], req.userId)
    return res.json({ event: resolved })
  } catch (error) {
    console.error('Failed to load latest Time Item occurrence:', userEventSyncErrorMessage(error))
    return res.status(500).json({ error: 'RECURRENCE_READ_FAILED', message: 'Could not load latest occurrence', statusCode: 500 })
  }
})

router.post('/:id/complete-recurrence', async (req: AuthenticatedRequest, res: Response) => {
  if (!req.userId) return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Sign in to complete a recurrence', statusCode: 401 })
  const id = sanitizeUUID(req.params.id)
  if (!id) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid event id', statusCode: 400 })
  try {
    const { data, error } = await supabaseAdmin.rpc('complete_time_item_recurrence', {
      p_user_id: req.userId, p_event_id: id,
    })
    if (error) {
      if (error.code === 'P0001') return res.status(409).json({ error: 'RECURRENCE_CONFLICT', message: error.message, statusCode: 409 })
      throw error
    }
    if (!data || data.status !== 'completed') throw new Error('Recurrence completion was not confirmed')
    const { data: event, error: eventError } = await supabaseAdmin.from('user_events')
      .select('*').eq('id', id).eq('user_id', req.userId).single()
    if (eventError) throw eventError
    if (!event?.completed_at) throw new Error('Time Item completion was not confirmed. New databases use 000_feature-time-and-calendar.sql; older databases require migrations/archive/035_time_item_completion.sql.')
    return res.json({ recurrence: data, event: { ...resolveEventLocation(event), recurrence: data } })
  } catch (error) {
    console.error('Failed to complete Time Item recurrence:', userEventSyncErrorMessage(error))
    return res.status(500).json({ error: 'RECURRENCE_COMPLETION_FAILED', message: 'Could not complete recurrence', statusCode: 500 })
  }
})

// ─── POST /api/user-events ─────────────────────────────────
// Create a manual event

router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' })
    const { title, description, meeting_link, location, start_time, end_time, is_public, category_ids, source_id } = req.body
    const requestedId = req.body?.id === undefined ? null : sanitizeUUID(req.body.id)

    if (!title || !start_time || !end_time) {
      return res.status(400).json({ error: 'title, start_time, and end_time are required' })
    }
    if (req.body?.id !== undefined && !requestedId) {
      return res.status(400).json({ error: 'id must be a valid UUID' })
    }

    // Optional "this item only" link: the series this row replaces one occurrence of.
    let seriesId: string | null = null
    let originalStartTime: string | null = null
    if (req.body?.series_id !== undefined && req.body?.series_id !== null) {
      seriesId = sanitizeUUID(req.body.series_id)
      const originalStart = new Date(typeof req.body?.original_start_time === 'string' ? req.body.original_start_time : '')
      if (!seriesId || Number.isNaN(originalStart.getTime())) {
        return res.status(400).json({ error: 'series_id requires a valid original_start_time' })
      }
      const { data: series } = await supabaseAdmin.from('user_events').select('id').eq('id', seriesId).eq('user_id', req.userId).maybeSingle()
      if (!series) return res.status(400).json({ error: 'series_id is invalid or unauthorized' })
      originalStartTime = originalStart.toISOString()
    }

    const sanitizedCategoryIds = sanitizeCategoryIdArray(category_ids)
    const categoriesOwned = await validateOwnedCategoryIds(req.userId, sanitizedCategoryIds)
    if (!categoriesOwned) {
      return res.status(400).json({ error: 'category_ids contains invalid or unauthorized ids' })
    }

    let manualSourceId: string | null = null
    try {
      manualSourceId = await resolveManualModeSourceId(req.userId, source_id)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid source_id'
      return res.status(400).json({ error: message })
    }

    const resolvedLocation = resolveEventLocation({ description, meeting_link, location })
    const recurrenceRule = sanitizeRecurrenceRule(req.body?.recurrence_rule)
    const matchesExistingEvent = (existing: Record<string, unknown> | null) =>
      Boolean(
        existing &&
        existing.user_id === req.userId &&
        existing.source_type === 'manual' &&
        existing.title === title &&
        (existing.description ?? null) === (resolvedLocation.description ?? null) &&
        (existing.meeting_link ?? null) === (meeting_link || null) &&
        (existing.location ?? null) === (resolvedLocation.location ?? null) &&
        new Date(String(existing.start_time)).getTime() === new Date(String(start_time)).getTime() &&
        new Date(String(existing.end_time)).getTime() === new Date(String(end_time)).getTime() &&
        existing.is_public === Boolean(is_public) &&
        existing.source_id === manualSourceId &&
        JSON.stringify(existing.category_ids ?? []) === JSON.stringify(sanitizedCategoryIds) &&
        JSON.stringify(existing.recurrence_rule ?? null) === JSON.stringify(recurrenceRule)
      )

    if (requestedId) {
      const { data: existing, error: existingError } = await supabaseAdmin
        .from('user_events')
        .select('*')
        .eq('id', requestedId)
        .eq('user_id', req.userId)
        .maybeSingle()
      if (existingError) throw existingError
      if (existing) {
        if (!matchesExistingEvent(existing as Record<string, unknown>)) {
          return res.status(409).json({ error: 'Event idempotency key conflicts with an existing event' })
        }
        const [created] = await withTimeItemRecurrences([existing], req.userId)
        return res.status(200).json({ event: created })
      }
    }

    const { data, error } = await supabaseAdmin
      .from('user_events')
      .insert({
        ...(requestedId ? { id: requestedId } : {}),
        user_id: req.userId,
        source_type: 'manual',
        title,
        description: resolvedLocation.description,
        meeting_link: meeting_link || null,
        location: resolvedLocation.location,
        start_time,
        end_time,
        is_public: is_public || false,
        category_ids: sanitizedCategoryIds,
        source_id: manualSourceId,
        recurrence_rule: recurrenceRule,
        series_id: seriesId,
        original_start_time: originalStartTime,
      })
      .select()
      .single()

    if (error) {
      if (requestedId && error.code === '23505') {
        const { data: existing, error: existingError } = await supabaseAdmin
          .from('user_events')
          .select('*')
          .eq('id', requestedId)
          .eq('user_id', req.userId)
          .maybeSingle()
        if (existingError) throw existingError
        if (matchesExistingEvent(existing as Record<string, unknown> | null)) {
          const [created] = await withTimeItemRecurrences([existing], req.userId)
          return res.status(200).json({ event: created })
        }
        return res.status(409).json({ error: 'Event idempotency key conflicts with an existing event' })
      }
      return res.status(400).json({ error: safeErrorMessage(error) })
    }
    const [created] = await withTimeItemRecurrences([data], req.userId)
    res.status(201).json({ event: created })
    // skip_google_sync: the user unticked "Update Google Calendar copy" for this edit.
    if (seriesId && req.body?.skip_google_sync !== true) void syncUserEventAfterChange(req.userId, seriesId)
  } catch {
    res.status(500).json({ error: 'Failed to create event' })
  }
})

// ─── PUT /api/user-events/bulk-public ───────────────────────
// Set is_public for multiple events at once.
// Body: { event_ids?: string[], source_id?: string, is_public: boolean }
// If source_id is provided, all events from that source are updated.
// NOTE: Must be registered BEFORE /:id to avoid route collision.

// Large `.in('id', [...])` filters are sent as PostgREST query-string params --
// thousands of UUIDs can exceed the URL length limit and fail with an opaque 400.
// Chunk to keep each request well within safe URL bounds.
const BULK_PUBLIC_ID_CHUNK_SIZE = 200

router.put('/bulk-public', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { event_ids, source_id, source_type, is_public } = req.body

    if (typeof is_public !== 'boolean') {
      return res.status(400).json({ error: 'is_public (boolean) is required' })
    }

    if (event_ids && Array.isArray(event_ids) && event_ids.length > 0) {
      const sanitizedIds = event_ids
        .map((id: unknown) => (typeof id === 'string' ? sanitizeUUID(id.replace(/__occ__.*$/, '').replace(/^coord_/, '')) : null))
        .filter((id): id is string => !!id)

      if (sanitizedIds.length === 0) {
        return res.status(400).json({ error: 'event_ids must contain valid event ids' })
      }

      let updated: unknown[] = []
      for (let i = 0; i < sanitizedIds.length; i += BULK_PUBLIC_ID_CHUNK_SIZE) {
        const chunk = sanitizedIds.slice(i, i + BULK_PUBLIC_ID_CHUNK_SIZE)
        const { data, error } = await supabaseAdmin
          .from('user_events')
          .update({ is_public, updated_at: new Date().toISOString() })
          .eq('user_id', req.userId)
          .in('id', chunk)
          .select()

        if (error) return res.status(400).json({ error: safeErrorMessage(error) })
        updated = updated.concat(data || [])
      }

      if (is_public && updated.length > 0) {
        const targetsToClear: Array<{ target_type: EventModerationTargetType; target_id: string }> = []
        for (const ev of updated as Array<{ id: string; external_event_id?: string | null }>) {
          targetsToClear.push({ target_type: 'user_event', target_id: ev.id })
          if (ev.external_event_id) {
            targetsToClear.push({ target_type: 'meeting', target_id: ev.external_event_id })
          }
        }
        await clearEventTargetsSuspension(targetsToClear)
      }

      return res.json({ updated: updated.length, events: updated })
    }

    let query = supabaseAdmin
      .from('user_events')
      .update({ is_public, updated_at: new Date().toISOString() })
      .eq('user_id', req.userId)

    if (source_id) {
      query = query.eq('source_id', source_id)
      if (source_type) query = query.eq('source_type', source_type)
    } else {
      // Update ALL user events
    }

    const { data, error } = await query.select()
    if (error) return res.status(400).json({ error: safeErrorMessage(error) })

    if (is_public && data && data.length > 0) {
      const targetsToClear: Array<{ target_type: EventModerationTargetType; target_id: string }> = []
      for (const ev of data as Array<{ id: string; external_event_id?: string | null }>) {
        targetsToClear.push({ target_type: 'user_event', target_id: ev.id })
        if (ev.external_event_id) {
          targetsToClear.push({ target_type: 'meeting', target_id: ev.external_event_id })
        }
      }
      await clearEventTargetsSuspension(targetsToClear)
    }

    res.json({ updated: data?.length || 0, events: data })
  } catch {
    res.status(500).json({ error: 'Failed to bulk-update events' })
  }
})

// ─── GET /api/user-events/sync-prefs ───────────────────────
// NOTE: These literal-path routes MUST be registered before the parameterized
// `/:id` routes below. Otherwise Express matches PUT /sync-prefs against
// PUT /:id (id="sync-prefs") and rejects it with "Invalid event id" (400).

router.get('/sync-prefs', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_event_sync_prefs')
      .select('source_type, source_id, auto_sync, auto_publish_new, range_months, last_synced_at, last_sync_error, updated_at')
      .eq('user_id', req.userId)
      .order('source_type', { ascending: true })

    if (error) return res.status(400).json({ error: safeErrorMessage(error) })
    res.json({ prefs: data || [] })
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to fetch sync preferences'
    res.status(500).json({ error })
  }
})

// ─── PUT /api/user-events/sync-prefs ───────────────────────

router.put('/sync-prefs', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const payload: Array<{
      source_type?: string
      source_id?: string
      auto_sync?: boolean
      auto_publish_new?: boolean
      range_months?: number
    }> = Array.isArray(req.body?.prefs) ? req.body.prefs : []

    const normalized = payload
      .map((p) => {
        const sourceType = p.source_type
        const sourceId = typeof p.source_id === 'string' ? p.source_id.trim() : ''
        if (!sourceId) return null
        if (sourceType !== 'google_oauth' && sourceType !== 'google_public_url' && sourceType !== 'coordination_calendar') {
          return null
        }

        const rangeMonthsRaw = Number(p.range_months)
        const rangeMonths = Number.isFinite(rangeMonthsRaw)
          ? Math.min(24, Math.max(1, Math.floor(rangeMonthsRaw)))
          : 12

        return {
          user_id: req.userId,
          source_type: sourceType,
          source_id: sourceId,
          auto_sync: p.auto_sync !== false,
          auto_publish_new: !!p.auto_publish_new,
          range_months: rangeMonths,
        }
      })
      .filter((row): row is UserEventSyncPrefRow => !!row)

    const activeRows = normalized.filter(row => row.auto_sync)
    const activeKeys = new Set(activeRows.map(row => `${row.source_type}:${row.source_id}`))

    const { data: existingRows, error: existingErr } = await supabaseAdmin
      .from('user_event_sync_prefs')
      .select('source_type, source_id')
      .eq('user_id', req.userId)

    if (existingErr) return res.status(400).json({ error: safeErrorMessage(existingErr) })

    const toDelete = (existingRows || []).filter(row => !activeKeys.has(`${row.source_type}:${row.source_id}`))
    for (const row of toDelete) {
      const { error: deleteErr } = await supabaseAdmin
        .from('user_event_sync_prefs')
        .delete()
        .eq('user_id', req.userId)
        .eq('source_type', row.source_type)
        .eq('source_id', row.source_id)

      if (deleteErr) return res.status(400).json({ error: safeErrorMessage(deleteErr) })
    }

    if (activeRows.length > 0) {
      const { error: upsertErr } = await supabaseAdmin
        .from('user_event_sync_prefs')
        .upsert(activeRows, { onConflict: 'user_id,source_type,source_id' })

      if (upsertErr) return res.status(400).json({ error: safeErrorMessage(upsertErr) })
    }

    const { data, error } = await supabaseAdmin
      .from('user_event_sync_prefs')
      .select('source_type, source_id, auto_sync, auto_publish_new, range_months, last_synced_at, last_sync_error, updated_at')
      .eq('user_id', req.userId)

    if (error) return res.status(400).json({ error: safeErrorMessage(error) })
    res.json({ prefs: data || [] })
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to update sync preferences'
    res.status(500).json({ error })
  }
})

// ─── PUT /api/user-events/:id ───────────────────────────────
// Update an event (title, description, public status, etc.)

router.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' })
    const id = sanitizeUUID(req.params.id)
    if (!id) return res.status(400).json({ error: 'Invalid event id' })
    const { title, description, meeting_link, location, start_time, end_time, is_public, category_ids, recurrence_rule } = req.body

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (title !== undefined) updates.title = title
    if (description !== undefined) updates.description = description
    if (meeting_link !== undefined) updates.meeting_link = meeting_link
    if (location !== undefined) updates.location = location
    if (start_time !== undefined) updates.start_time = start_time
    if (end_time !== undefined) updates.end_time = end_time
    if (is_public !== undefined) updates.is_public = is_public
    if (category_ids !== undefined) {
      const sanitizedCategoryIds = sanitizeCategoryIdArray(category_ids)
      const categoriesOwned = await validateOwnedCategoryIds(req.userId, sanitizedCategoryIds)
      if (!categoriesOwned) {
        return res.status(400).json({ error: 'category_ids contains invalid or unauthorized ids' })
      }
      updates.category_ids = sanitizedCategoryIds
    }
    if (recurrence_rule !== undefined) {
      const nextRule = sanitizeRecurrenceRule(recurrence_rule)
      updates.recurrence_rule = nextRule
      if (nextRule?.endType === 'whenCompleted') {
        const { data: existing, error: existingError } = await supabaseAdmin.from('user_events')
          .select('recurrence_id').eq('id', id).eq('user_id', req.userId).maybeSingle()
        if (existingError) throw existingError
        if (existing?.recurrence_id) {
          const { data: series, error: seriesError } = await supabaseAdmin.from('time_item_recurrences')
            .select('recurrence_rule').eq('id', existing.recurrence_id).eq('user_id', req.userId).single()
          if (seriesError) throw seriesError
          if (JSON.stringify(sanitizeRecurrenceRule(series.recurrence_rule)) === JSON.stringify(updates.recurrence_rule)) {
            delete updates.recurrence_rule
          }
        }
      }
    }

    const { data, error } = await supabaseAdmin
      .from('user_events')
      .update(updates)
      .eq('id', id)
      .eq('user_id', req.userId)
      .select()
      .single()

    if (error) return res.status(400).json({ error: safeErrorMessage(error) })
    if (!data) return res.status(404).json({ error: 'Event not found' })

    if (is_public === true) {
      const targetsToClear: Array<{ target_type: EventModerationTargetType; target_id: string }> = [
        { target_type: 'user_event', target_id: data.id },
      ]
      if (data.external_event_id) {
        targetsToClear.push({ target_type: 'meeting', target_id: data.external_event_id })
      }
      await clearEventTargetsSuspension(targetsToClear)
    }

    const [updated] = await withTimeItemRecurrences([data], req.userId)
    res.json({ event: updated })
    if (req.body?.skip_google_sync !== true) void syncUserEventAfterChange(req.userId, data.id)
  } catch {
    res.status(500).json({ error: 'Failed to update event' })
  }
})

// ─── DELETE /api/user-events/bulk ────────────────────────────
// Bulk delete events by IDs or by source
// Body: { event_ids?: string[], source_id?: string, source_type?: string }

router.delete('/bulk', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { event_ids, source_id, source_type } = req.body

    let query = supabaseAdmin
      .from('user_events')
      .delete()
      .eq('user_id', req.userId)

    if (event_ids && Array.isArray(event_ids) && event_ids.length > 0) {
      query = query.in('id', event_ids)
    } else if (source_id) {
      query = query.eq('source_id', source_id)
      if (source_type) query = query.eq('source_type', source_type)
    } else {
      return res.status(400).json({ error: 'Provide event_ids or source_id' })
    }

    const { data, error } = await query.select()
    if (error) return res.status(400).json({ error: safeErrorMessage(error) })
    res.json({ deleted: data?.length || 0 })
  } catch {
    res.status(500).json({ error: 'Failed to bulk-delete events' })
  }
})

// ─── DELETE /api/user-events/:id ────────────────────────────

router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = sanitizeUUID(req.params.id)
    if (!id) return res.status(400).json({ error: 'Invalid event id' })
    const userId = req.userId
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    // Links cascade with the row, so read the Google copies to remove first.
    const googleLinks = await getKeepInSyncLinks(userId, id)

    const { data, error } = await supabaseAdmin
      .from('user_events')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single()

    if (error) return res.status(400).json({ error: safeErrorMessage(error) })
    if (!data) return res.status(404).json({ error: 'Event not found' })
    res.json({ message: 'Event deleted' })
    if (googleLinks.length > 0) void deleteGoogleCopies(userId, googleLinks)
    if (data.series_id) void syncUserEventAfterChange(userId, data.series_id)
  } catch {
    res.status(500).json({ error: 'Failed to delete event' })
  }
})

// ─── POST /api/user-events/import/calendar-source ───────────
// Import events from a connected calendar source (Google OAuth or public URL)
// Body: { source_id: string, time_min: string, time_max: string }

router.post('/import/calendar-source', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { source_id, time_min, time_max } = req.body

    if (!source_id || !time_min || !time_max) {
      return res.status(400).json({ error: 'source_id, time_min, and time_max are required' })
    }

    // Fetch the calendar source
    const { data: source, error: srcErr } = await supabaseAdmin
      .from('calendar_sources')
      .select('*')
      .eq('id', source_id)
      .eq('user_id', req.userId)
      .single()

    if (srcErr || !source) {
      return res.status(404).json({ error: 'Calendar source not found' })
    }

    let importedEvents: Array<{
      title: string; description?: string; meeting_link?: string;
      location?: string; start: string; end: string; uid?: string
    }> = []

    if (source.source_type === 'google_oauth') {
      const accessToken = await ensureFreshAccessToken(source)

      // Fetch events from Google Calendar API (with pagination)
      let pageToken: string | undefined
      do {
        const params = new URLSearchParams({
          timeMin: time_min,
          timeMax: time_max,
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '250',
        })
        if (pageToken) params.set('pageToken', pageToken)

        const eventsRes = await fetch(
          `${GOOGLE_CALENDAR_API}/calendars/primary/events?${params}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        )

        if (!eventsRes.ok) {
          const errData = await eventsRes.json() as { error?: { message?: string } }
          throw new Error(errData.error?.message || `Google API error (${eventsRes.status})`)
        }

        const eventsData = await eventsRes.json() as {
          items?: Array<{
            id?: string; summary?: string; description?: string;
            location?: string; htmlLink?: string;
            start?: { dateTime?: string; date?: string };
            end?: { dateTime?: string; date?: string };
            hangoutLink?: string;
            conferenceData?: { entryPoints?: Array<{ entryPointType: string; uri: string }> }
          }>
          nextPageToken?: string
        }

        for (const item of eventsData.items || []) {
          const startStr = item.start?.dateTime || (item.start?.date ? `${item.start.date}T00:00:00Z` : null)
          const endStr = item.end?.dateTime || (item.end?.date ? `${item.end.date}T00:00:00Z` : null)
          if (!startStr || !endStr) continue

          // Extract meeting link
          let meetingLink = item.hangoutLink || undefined
          if (!meetingLink && item.conferenceData?.entryPoints) {
            const videoEntry = item.conferenceData.entryPoints.find(ep => ep.entryPointType === 'video')
            if (videoEntry) meetingLink = videoEntry.uri
          }

          importedEvents.push({
            title: item.summary || 'Untitled Event',
            description: item.description || undefined,
            meeting_link: meetingLink,
            location: item.location || undefined,
            start: startStr,
            end: endStr,
            uid: item.id || undefined,
          })
        }

        pageToken = eventsData.nextPageToken
      } while (pageToken)

    } else if (source.source_type === 'google_public_url') {
      // Fetch and parse ICS
      const icsRes = await fetchPublicCalendarUrl(source.public_url, { signal: AbortSignal.timeout(15_000) })
      if (!icsRes.ok) {
        return res.status(502).json({ error: `Failed to fetch ICS feed (HTTP ${icsRes.status})` })
      }
      const icsText = await icsRes.text()
      const rangeMin = new Date(time_min).getTime()
      const rangeMax = new Date(time_max).getTime()
      const parsed = parseIcsEventsFull(icsText, rangeMin, rangeMax)
      importedEvents = parsed.map(e => ({
        title: e.title,
        description: e.description,
        location: e.location,
        start: e.start,
        end: e.end,
        uid: e.uid,
      }))
    }

    if (importedEvents.length === 0) {
      return res.json({ imported: 0, events: [] })
    }

    // Build rows to insert
    const rows = importedEvents.map(resolveEventLocation).map(ev => ({
      user_id: req.userId,
      source_type: source.source_type,
      source_id: source.id,
      external_event_id: ev.uid || null,
      title: ev.title,
      description: ev.description || null,
      meeting_link: ev.meeting_link || null,
      location: ev.location || null,
      start_time: ev.start,
      end_time: ev.end,
      is_public: false,
      recurrence_rule: null,
    }))

    // Fetch existing events for this user+source to de-duplicate in code
    const { data: existingEvents } = await supabaseAdmin
      .from('user_events')
      .select('external_event_id')
      .eq('user_id', req.userId)
      .eq('source_type', source.source_type)
      .eq('source_id', source.id)

    const existingIds = new Set(
      (existingEvents || []).map(e => e.external_event_id).filter(Boolean)
    )

    // Filter out events that already exist (by external_event_id)
    const newRows = rows.filter(r => {
      if (!r.external_event_id) return true  // no UID → always insert
      return !existingIds.has(r.external_event_id)
    })

    // De-duplicate within the batch (keep first occurrence of each external_event_id)
    const seen = new Set<string>()
    const dedupedRows = newRows.filter(r => {
      if (!r.external_event_id) return true
      if (seen.has(r.external_event_id)) return false
      seen.add(r.external_event_id)
      return true
    })

    if (dedupedRows.length === 0) {
      return res.json({ imported: 0, total_found: importedEvents.length, events: [] })
    }

    // Batch insert new events (duplicates already filtered above)
    const { data: insertedEvents, error: insertError } = await supabaseAdmin
      .from('user_events')
      .insert(dedupedRows)
      .select()

    if (insertError) {
      console.error('Event import insert error:', insertError)
      return res.status(400).json({ error: safeErrorMessage(insertError) })
    }

    res.json({ imported: insertedEvents?.length || 0, total_found: importedEvents.length, events: insertedEvents || [] })
  } catch (err) {
    console.error('Event import error:', err)
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── POST /api/user-events/import/coordination-calendar ─────
// Import meetings from a public/unlisted Coordination Calendar
// Body: { calendar_hash: string }

router.post('/import/coordination-calendar', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { calendar_hash } = req.body

    if (!calendar_hash) {
      return res.status(400).json({ error: 'calendar_hash is required' })
    }

    // Fetch the calendar
    const { data: calendar, error: calErr } = await supabaseAdmin
      .from('calendars')
      .select('id, hash, title, config')
      .eq('hash', calendar_hash)
      .single()

    if (calErr || !calendar) {
      return res.status(404).json({ error: 'Coordination Calendar not found' })
    }

    // Fetch confirmed meetings from this calendar
    const { data: meetings, error: meetErr } = await supabaseAdmin
      .from('meetings')
      .select('*')
      .eq('calendar_id', calendar.id)

    if (meetErr) return res.status(400).json({ error: safeErrorMessage(meetErr) })

    if (!meetings || meetings.length === 0) {
      return res.json({ imported: 0, events: [] })
    }

    const ensureUTC = (ts: string) =>
      ts && !ts.endsWith('Z') && !ts.includes('+') ? ts + 'Z' : ts

    const rows = meetings.map(m => ({
      user_id: req.userId,
      source_type: 'coordination_calendar' as const,
      source_id: calendar.hash,
      external_event_id: m.id,
      title: m.title || calendar.title || 'Meeting',
      description: m.description || null,
      meeting_link: m.meeting_link || null,
      location: m.meeting_link || null,
      start_time: ensureUTC(m.start_time),
      end_time: ensureUTC(m.end_time),
      is_public: false,
      recurrence_rule: null,
    }))

    // Fetch existing imports for this user+source to de-duplicate in code
    const { data: existingEvents } = await supabaseAdmin
      .from('user_events')
      .select('external_event_id')
      .eq('user_id', req.userId)
      .eq('source_type', 'coordination_calendar')
      .eq('source_id', calendar.hash)

    const existingIds = new Set(
      (existingEvents || []).map(e => e.external_event_id).filter(Boolean)
    )

    const newRows = rows.filter(r => !existingIds.has(r.external_event_id))

    if (newRows.length === 0) {
      return res.json({ imported: 0, total_found: meetings.length, events: [] })
    }

    const { data: insertedEvents, error: insertError } = await supabaseAdmin
      .from('user_events')
      .insert(newRows)
      .select()

    if (insertError) {
      console.error('Coordination calendar import insert error:', insertError)
      return res.status(400).json({ error: safeErrorMessage(insertError) })
    }

    res.json({ imported: insertedEvents?.length || 0, total_found: meetings.length, events: insertedEvents || [] })
  } catch (err) {
    console.error('Coordination calendar import error:', err)
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── POST /api/user-events/sync-imports ────────────────────
// Re-sync all previously imported sources for this user.
// This performs an incremental reconciliation:
// - inserts newly discovered external events
// - updates changed external events
// - deletes events removed from the external source

router.post('/sync-imports', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    const userId = req.userId
    const requestedTimeMin = typeof req.body?.time_min === 'string' ? req.body.time_min : null
    const requestedTimeMax = typeof req.body?.time_max === 'string' ? req.body.time_max : null
    const hasExplicitRange = Boolean(requestedTimeMin && requestedTimeMax)

    if ((requestedTimeMin && !requestedTimeMax) || (!requestedTimeMin && requestedTimeMax)) {
      return res.status(400).json({ error: 'time_min and time_max must be provided together' })
    }

    let explicitTimeMin: string | null = null
    let explicitTimeMax: string | null = null
    if (hasExplicitRange) {
      const parsedMin = new Date(requestedTimeMin as string)
      const parsedMax = new Date(requestedTimeMax as string)
      if (Number.isNaN(parsedMin.getTime()) || Number.isNaN(parsedMax.getTime())) {
        return res.status(400).json({ error: 'time_min and time_max must be valid ISO timestamps' })
      }
      if (parsedMax.getTime() <= parsedMin.getTime()) {
        return res.status(400).json({ error: 'time_max must be after time_min' })
      }

      explicitTimeMin = parsedMin.toISOString()
      explicitTimeMax = parsedMax.toISOString()
    }

    const requestedRangeMonths = Number(req.body?.range_months)
    const defaultRangeMonths = Number.isFinite(requestedRangeMonths)
      ? Math.min(24, Math.max(1, Math.floor(requestedRangeMonths)))
      : 12

    const requestedSourceConfigs = Array.isArray(req.body?.source_configs)
      ? req.body.source_configs as Array<{
        source_type?: string
        source_id?: string
        range_months?: number
        auto_publish_new?: boolean
      }>
      : []

    const explicitSourceConfigs = requestedSourceConfigs
      .map(cfg => {
        const sourceType = cfg.source_type
        const sourceId = typeof cfg.source_id === 'string' ? cfg.source_id.trim() : ''
        const rawMonths = Number(cfg.range_months)
        const rangeMonths = Number.isFinite(rawMonths)
          ? Math.min(24, Math.max(1, Math.floor(rawMonths)))
          : defaultRangeMonths
        const autoPublishNew = !!cfg.auto_publish_new

        if (!sourceId) return null
        if (sourceType !== 'google_oauth' && sourceType !== 'google_public_url' && sourceType !== 'coordination_calendar') {
          return null
        }

        return { sourceType, sourceId, rangeMonths, autoPublishNew }
      })
      .filter((cfg): cfg is { sourceType: SyncSourceType; sourceId: string; rangeMonths: number; autoPublishNew: boolean } => !!cfg)

    const { data: importedRows, error: importedErr } = await supabaseAdmin
      .from('user_events')
      .select('source_type, source_id')
      .eq('user_id', req.userId)
      .in('source_type', ['google_oauth', 'google_public_url', 'coordination_calendar'])
      .not('source_id', 'is', null)

    if (importedErr) {
      return res.status(400).json({ error: safeErrorMessage(importedErr) })
    }

    const inferredSources = new Map<string, {
      sourceType: SyncSourceType
      sourceId: string
      rangeMonths: number
      autoPublishNew: boolean
    }>()

    for (const row of importedRows || []) {
      const sourceId = row.source_id || ''
      if (!sourceId) continue
      const sourceType = row.source_type
      if (sourceType !== 'google_oauth' && sourceType !== 'google_public_url' && sourceType !== 'coordination_calendar') {
        continue
      }
      const key = `${sourceType}:${sourceId}`
      if (!inferredSources.has(key)) {
        inferredSources.set(key, { sourceType, sourceId, rangeMonths: defaultRangeMonths, autoPublishNew: false })
      }
    }

    const uniqueSources = new Map<string, {
      sourceType: SyncSourceType
      sourceId: string
      rangeMonths: number
      autoPublishNew: boolean
    }>()

    if (explicitSourceConfigs.length > 0) {
      for (const cfg of explicitSourceConfigs) {
        uniqueSources.set(`${cfg.sourceType}:${cfg.sourceId}`, cfg)
      }
    } else {
      for (const [key, cfg] of inferredSources.entries()) {
        uniqueSources.set(key, cfg)
      }
    }

    if (uniqueSources.size === 0) {
      return res.json({
        syncedSources: 0,
        inserted: 0,
        updated: 0,
        deleted: 0,
        totalFound: 0,
        results: [],
      })
    }

    const results: Array<{
      sourceType: 'google_oauth' | 'google_public_url' | 'coordination_calendar'
      sourceId: string
      inserted: number
      updated: number
      deleted: number
      totalFound: number
      error?: string
    }> = []

    let inserted = 0
    let updated = 0
    let deleted = 0
    let totalFound = 0

    for (const { sourceType, sourceId, rangeMonths, autoPublishNew } of uniqueSources.values()) {
      try {
        const now = new Date()
        const timeMin = explicitTimeMin || now.toISOString()
        const timeMax = explicitTimeMax || (() => {
          const timeMaxDate = new Date(now)
          timeMaxDate.setMonth(timeMaxDate.getMonth() + rangeMonths)
          return timeMaxDate.toISOString()
        })()

        const summary = await syncImportedSource(userId, sourceType, sourceId, timeMin, timeMax, { autoPublishNew })
        inserted += summary.inserted
        updated += summary.updated
        deleted += summary.deleted
        totalFound += summary.totalFound
        results.push({
          sourceType,
          sourceId,
          ...summary,
        })
      } catch (err: unknown) {
        const error = err instanceof Error ? err.message : 'Sync failed'
        results.push({ sourceType, sourceId, inserted: 0, updated: 0, deleted: 0, totalFound: 0, error })
      }
    }

    res.json({
      syncedSources: uniqueSources.size,
      inserted,
      updated,
      deleted,
      totalFound,
      results,
      defaultRangeMonths,
    })
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to sync imported events'
    res.status(500).json({ error })
  }
})

export default router
