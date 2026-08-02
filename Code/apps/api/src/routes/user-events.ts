import { Router, Request, Response } from 'express'
import { createHash } from 'crypto'
import { supabaseAdmin } from '../supabaseClient.js'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js'
import IcalExpander from 'ical-expander'
import { sanitizeUUID } from '../middleware/validation.js'

const router: ReturnType<typeof Router> = Router()

const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

type SyncSourceType = 'google_oauth' | 'google_public_url' | 'coordination_calendar'

type RecurrenceType = 'none' | 'weekly' | 'biweekly' | 'monthly' | 'custom'
type RecurrenceUnit = 'day' | 'week' | 'month'
type RecurrenceEndType = 'never' | 'on' | 'after'

interface RecurrenceRule {
  type: RecurrenceType
  interval?: number
  unit?: RecurrenceUnit
  weekDays?: number[]
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
  if (type !== 'weekly' && type !== 'biweekly' && type !== 'monthly' && type !== 'custom' && type !== 'none') {
    return null
  }
  if (type === 'none') return null

  const intervalValue = typeof candidate.interval === 'number' ? candidate.interval : Number(candidate.interval)
  const interval = Number.isFinite(intervalValue) && intervalValue > 0 ? Math.min(99, Math.floor(intervalValue)) : 1
  const unit = candidate.unit === 'day' || candidate.unit === 'week' || candidate.unit === 'month' ? candidate.unit : 'week'
  const weekDays = Array.isArray(candidate.weekDays)
    ? Array.from(new Set(candidate.weekDays.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6)))
    : undefined
  const endType = candidate.endType === 'never' || candidate.endType === 'on' || candidate.endType === 'after' ? candidate.endType : 'never'
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
    endType,
    endDate,
    endCount,
    exceptions: exceptions && exceptions.length > 0 ? exceptions : undefined,
  }
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
    // 1. User-published events from user_events table
    const { data: userEvents, error: ueError } = await supabaseAdmin
      .from('user_events')
      .select('id, title, description, meeting_link, location, start_time, end_time, is_public, source_type, source_id, recurrence_rule, created_at, updated_at')
      .eq('is_public', true)
      .order('start_time', { ascending: true })

    if (ueError) return res.status(400).json({ error: ueError.message })

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
    }

    // Enrich user events with calendar_title from their source
    const enrichedUserEvents = (userEvents || []).map(ev => ({
      ...ev,
      calendar_title: ev.source_id ? sourceDisplayNames.get(ev.source_id) || undefined : undefined,
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
            location: null,
            start_time: ensureUTC(m.start_time),
            end_time: ensureUTC(m.end_time),
            is_public: true,
            source_type: 'coordination_calendar',
            created_at: m.created_at,
            updated_at: m.updated_at,
            calendar_title: cal?.title,
            calendar_hash: cal?.hash,
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
      const { data: importedEvents } = await supabaseAdmin
        .from('user_events')
        .select('external_event_id')
        .eq('is_public', true)
        .eq('source_type', 'coordination_calendar')
        .not('external_event_id', 'is', null)

      if (importedEvents) {
        for (const ie of importedEvents) {
          if (ie.external_event_id) seenCoordMeetingIds.add(ie.external_event_id)
        }
      }
    }

    // Filter out coordination meetings that were already imported & published
    const uniqueCoordMeetings = coordMeetings.filter(m => {
      const originalId = m.id.replace(/^coord_/, '')
      return !seenCoordMeetingIds.has(originalId)
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
    event.start,
    event.end,
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
    const icsRes = await fetch(source.public_url)
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
  let incomingEvents: ImportedExternalEvent[] = []

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

  const normalizedIncoming = incomingEvents.map(ev => ({
    ...ev,
    external_event_id: ev.uid || buildFallbackExternalEventId(sourceType, sourceId, ev),
  }))

  const incomingByExternalId = new Map<string, typeof normalizedIncoming[number]>()
  for (const ev of normalizedIncoming) {
    if (!incomingByExternalId.has(ev.external_event_id)) {
      incomingByExternalId.set(ev.external_event_id, ev)
    }
  }

  const { data: existingRows, error: existingErr } = await supabaseAdmin
    .from('user_events')
    .select('id, external_event_id, title, description, meeting_link, location, start_time, end_time, is_public')
    .eq('user_id', userId)
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)

  if (existingErr) {
    throw new Error(existingErr.message)
  }

  const existingByExternalId = new Map<string, NonNullable<typeof existingRows>[number]>()
  const existingNoExternalByFingerprint = new Map<string, Array<NonNullable<typeof existingRows>[number]>>()
  for (const row of existingRows || []) {
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
      existing.start_time !== incoming.start ||
      existing.end_time !== incoming.end
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
    const { data: insertedRows, error: insertErr } = await supabaseAdmin
      .from('user_events')
      .insert(rowsToInsert)
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
    throw new Error(prefErr.message)
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
        const errorMsg = err instanceof Error ? err.message : 'Sync failed'
        await supabaseAdmin
          .from('user_event_sync_prefs')
          .update({
            last_sync_error: errorMsg,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId)
          .eq('source_type', pref.source_type)
          .eq('source_id', pref.source_id)
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

router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_events')
      .select('*')
      .eq('user_id', req.userId)
      .order('start_time', { ascending: true })

    if (error) return res.status(400).json({ error: error.message })

    const events = data || []

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

    res.json({ events: visibleEvents })
  } catch {
    res.status(500).json({ error: 'Failed to fetch events' })
  }
})

// ─── POST /api/user-events ─────────────────────────────────
// Create a manual event

router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' })
    const { title, description, meeting_link, location, start_time, end_time, is_public, category_ids, source_id } = req.body

    if (!title || !start_time || !end_time) {
      return res.status(400).json({ error: 'title, start_time, and end_time are required' })
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

    const { data, error } = await supabaseAdmin
      .from('user_events')
      .insert({
        user_id: req.userId,
        source_type: 'manual',
        title,
        description: description || null,
        meeting_link: meeting_link || null,
        location: location || null,
        start_time,
        end_time,
        is_public: is_public || false,
        category_ids: sanitizedCategoryIds,
        source_id: manualSourceId,
        recurrence_rule: sanitizeRecurrenceRule(req.body?.recurrence_rule),
      })
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.status(201).json({ event: data })
  } catch {
    res.status(500).json({ error: 'Failed to create event' })
  }
})

// ─── PUT /api/user-events/bulk-public ───────────────────────
// Set is_public for multiple events at once.
// Body: { event_ids?: string[], source_id?: string, is_public: boolean }
// If source_id is provided, all events from that source are updated.
// NOTE: Must be registered BEFORE /:id to avoid route collision.

router.put('/bulk-public', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { event_ids, source_id, source_type, is_public } = req.body

    if (typeof is_public !== 'boolean') {
      return res.status(400).json({ error: 'is_public (boolean) is required' })
    }

    let query = supabaseAdmin
      .from('user_events')
      .update({ is_public, updated_at: new Date().toISOString() })
      .eq('user_id', req.userId)

    if (event_ids && Array.isArray(event_ids) && event_ids.length > 0) {
      query = query.in('id', event_ids)
    } else if (source_id) {
      query = query.eq('source_id', source_id)
      if (source_type) query = query.eq('source_type', source_type)
    } else {
      // Update ALL user events
    }

    const { data, error } = await query.select()
    if (error) return res.status(400).json({ error: error.message })
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

    if (error) return res.status(400).json({ error: error.message })
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

    if (existingErr) return res.status(400).json({ error: existingErr.message })

    const toDelete = (existingRows || []).filter(row => !activeKeys.has(`${row.source_type}:${row.source_id}`))
    for (const row of toDelete) {
      const { error: deleteErr } = await supabaseAdmin
        .from('user_event_sync_prefs')
        .delete()
        .eq('user_id', req.userId)
        .eq('source_type', row.source_type)
        .eq('source_id', row.source_id)

      if (deleteErr) return res.status(400).json({ error: deleteErr.message })
    }

    if (activeRows.length > 0) {
      const { error: upsertErr } = await supabaseAdmin
        .from('user_event_sync_prefs')
        .upsert(activeRows, { onConflict: 'user_id,source_type,source_id' })

      if (upsertErr) return res.status(400).json({ error: upsertErr.message })
    }

    const { data, error } = await supabaseAdmin
      .from('user_event_sync_prefs')
      .select('source_type, source_id, auto_sync, auto_publish_new, range_months, last_synced_at, last_sync_error, updated_at')
      .eq('user_id', req.userId)

    if (error) return res.status(400).json({ error: error.message })
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
      updates.recurrence_rule = sanitizeRecurrenceRule(recurrence_rule)
    }

    const { data, error } = await supabaseAdmin
      .from('user_events')
      .update(updates)
      .eq('id', id)
      .eq('user_id', req.userId)
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    if (!data) return res.status(404).json({ error: 'Event not found' })
    res.json({ event: data })
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
    if (error) return res.status(400).json({ error: error.message })
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

    const { data, error } = await supabaseAdmin
      .from('user_events')
      .delete()
      .eq('id', id)
      .eq('user_id', req.userId)
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    if (!data) return res.status(404).json({ error: 'Event not found' })
    res.json({ message: 'Event deleted' })
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
      const icsRes = await fetch(source.public_url)
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
    const rows = importedEvents.map(ev => ({
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
      return res.status(400).json({ error: insertError.message })
    }

    res.json({ imported: insertedEvents?.length || 0, total_found: importedEvents.length, events: insertedEvents || [] })
  } catch (err) {
    console.error('Event import error:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to import events' })
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

    if (meetErr) return res.status(400).json({ error: meetErr.message })

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
      location: null,
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
      return res.status(400).json({ error: insertError.message })
    }

    res.json({ imported: insertedEvents?.length || 0, total_found: meetings.length, events: insertedEvents || [] })
  } catch (err) {
    console.error('Coordination calendar import error:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to import from coordination calendar' })
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
      return res.status(400).json({ error: importedErr.message })
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
