// Outbound Google Calendar sync for Time Management items (user_events).
//
// A recurring series is exported once as a Google recurring event. Afterwards:
// - occurrences deleted with "this item only" become EXDATE entries on the series
//   (and any earlier Google override of that instance is cancelled);
// - "this item only" edits (rows with series_id + original_start_time) become Google
//   instance overrides with the replacement's title, description, location and time.
// google_event_links remembers the Google event per item and what was last pushed, so
// status checks can tell "out of date here" from "changed directly in Google".

import { supabaseAdmin } from '../supabaseClient.js'
import {
  buildRecurrenceLines,
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  ensureFreshAccessToken,
  findGoogleEventInstance,
  getGoogleCalendarEvent,
  patchGoogleCalendarEvent,
  type GoogleCalendarEvent,
  type GoogleCalendarEventBody,
  type RecurrenceRule,
} from './google-calendar-api.js'

export interface SyncUserEvent {
  id: string
  user_id: string
  title: string
  description: string | null
  location: string | null
  meeting_link: string | null
  start_time: string
  end_time: string
  recurrence_rule: unknown
  series_id?: string | null
  original_start_time?: string | null
}

interface GoogleEventLink {
  id: string
  user_id: string
  user_event_id: string
  calendar_source_id: string
  google_calendar_id: string
  google_event_id: string
  html_link: string | null
  keep_in_sync: boolean
  last_pushed_at: string | null
  last_pushed_payload: PushedPayload | null
  last_push_error: string | null
}

interface PushedPayload {
  master: GoogleCalendarEventBody
  instances: Record<string, GoogleCalendarEventBody>
}

export type GoogleSyncState = 'in_sync' | 'outdated' | 'changed_on_google' | 'deleted_on_google' | 'error'

export interface GoogleLinkStatus {
  sourceId: string
  googleEmail: string | null
  htmlLink: string | null
  keepInSync: boolean
  state: GoogleSyncState
  changedFields: string[]
  lastPushedAt: string | null
  lastPushError: string | null
}

export class GoogleSyncError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message)
  }
}

const EVENT_COLUMNS = 'id, user_id, title, description, location, meeting_link, start_time, end_time, recurrence_rule, series_id, original_start_time'
const SOURCE_COLUMNS = 'id, user_id, source_type, google_email, google_access_token, google_refresh_token, token_expires_at'

const toUtcIso = (value: string): string => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`).toISOString()

/** JSON with sorted keys, so JSONB round-trips (which reorder keys) compare equal. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function asRule(value: unknown): RecurrenceRule | null {
  if (!value || typeof value !== 'object') return null
  const rule = value as RecurrenceRule
  return rule.type && rule.type !== 'none' ? rule : null
}

function baseBody(item: SyncUserEvent): GoogleCalendarEventBody {
  const body: GoogleCalendarEventBody = {
    summary: item.title,
    description: item.description || undefined,
    start: { dateTime: toUtcIso(item.start_time), timeZone: 'UTC' },
    end: { dateTime: toUtcIso(item.end_time), timeZone: 'UTC' },
  }
  if (item.location) body.location = item.location
  else if (item.meeting_link) body.location = item.meeting_link
  if (item.meeting_link && !body.description) body.description = `Meeting link: ${item.meeting_link}`
  return body
}

/**
 * What Google should hold for a series and its single-occurrence replacements.
 * Exception dates that have a replacement are overridden, not excluded.
 */
export function buildGooglePayload(series: SyncUserEvent, replacements: SyncUserEvent[]): PushedPayload {
  const master: GoogleCalendarEventBody = { ...baseBody(series), reminders: { useDefault: false } }
  const instances: Record<string, GoogleCalendarEventBody> = {}
  const rule = asRule(series.recurrence_rule)
  if (!rule) return { master, instances }

  const seriesStart = toUtcIso(series.start_time)
  const replacedDates = new Set<string>()
  for (const replacement of replacements) {
    if (!replacement.original_start_time) continue
    const originalStart = toUtcIso(replacement.original_start_time)
    replacedDates.add(originalStart.slice(0, 10))
    instances[originalStart] = { ...baseBody(replacement), status: 'confirmed' }
  }
  const excluded = (Array.isArray(rule.exceptions) ? rule.exceptions : [])
    .filter((date): date is string => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && !replacedDates.has(date))
    .map(date => `${date}${seriesStart.slice(10)}`)
  master.recurrence = buildRecurrenceLines(rule, seriesStart, excluded)
  return { master, instances }
}

async function loadSeriesBundle(userId: string, eventId: string): Promise<{ series: SyncUserEvent; replacements: SyncUserEvent[] }> {
  const { data: event } = await supabaseAdmin.from('user_events').select(EVENT_COLUMNS).eq('id', eventId).eq('user_id', userId).maybeSingle()
  if (!event) throw new GoogleSyncError('Event not found', 404)
  const series = event as SyncUserEvent
  if (!asRule(series.recurrence_rule)) return { series, replacements: [] }
  const { data: replacements } = await supabaseAdmin.from('user_events').select(EVENT_COLUMNS).eq('series_id', series.id).eq('user_id', userId)
  return { series, replacements: (replacements || []) as SyncUserEvent[] }
}

async function loadLinks(userId: string, eventId: string): Promise<GoogleEventLink[]> {
  const { data } = await supabaseAdmin.from('google_event_links').select('*').eq('user_id', userId).eq('user_event_id', eventId)
  return (data || []) as GoogleEventLink[]
}

async function loadWritableSource(userId: string, sourceId: string) {
  const { data: source } = await supabaseAdmin.from('calendar_sources').select(SOURCE_COLUMNS).eq('id', sourceId).eq('user_id', userId).maybeSingle()
  if (!source || source.source_type !== 'google_oauth') throw new GoogleSyncError('Google Calendar source not found')
  if (!source.google_access_token && !source.google_refresh_token) {
    throw new GoogleSyncError('Google Calendar tokens are missing. Please reconnect your Google account in Settings.')
  }
  return source as { id: string; google_email: string | null; google_access_token: string | null; google_refresh_token: string | null; token_expires_at: string | null }
}

/** The series a change belongs to (a replacement row points at its series). */
async function resolveSeriesId(userId: string, eventId: string): Promise<string> {
  const { data } = await supabaseAdmin.from('user_events').select('id, series_id').eq('id', eventId).eq('user_id', userId).maybeSingle()
  return (data?.series_id as string | null) || eventId
}

async function applyInstances(accessToken: string, link: GoogleEventLink, payload: PushedPayload, series: SyncUserEvent): Promise<void> {
  for (const [originalStart, body] of Object.entries(payload.instances)) {
    const instance = await findGoogleEventInstance(accessToken, link.google_calendar_id, link.google_event_id, originalStart)
    if (instance) await patchGoogleCalendarEvent(accessToken, link.google_calendar_id, instance.id, body)
  }
  // An instance overridden earlier and later deleted here: EXDATE hides the recurring
  // slot, but Google keeps the override as its own exception event, so cancel it.
  const previouslyOverridden = Object.keys(link.last_pushed_payload?.instances || {})
  const rule = asRule(series.recurrence_rule)
  const exceptions = new Set(Array.isArray(rule?.exceptions) ? rule.exceptions : [])
  for (const originalStart of previouslyOverridden) {
    if (payload.instances[originalStart] || !exceptions.has(originalStart.slice(0, 10))) continue
    const instance = await findGoogleEventInstance(accessToken, link.google_calendar_id, link.google_event_id, originalStart)
    if (instance && instance.status !== 'cancelled') await deleteGoogleCalendarEvent(accessToken, link.google_calendar_id, instance.id)
  }
}

async function recordPush(link: GoogleEventLink, payload: PushedPayload | null, error: string | null): Promise<void> {
  const now = new Date().toISOString()
  await supabaseAdmin.from('google_event_links').update(
    payload ? { last_pushed_payload: payload, last_pushed_at: now, last_push_error: null, updated_at: now } : { last_push_error: error, updated_at: now },
  ).eq('id', link.id)
}

export async function exportUserEventToGoogle(params: { userId: string; eventId: string; sourceId: string; keepInSync: boolean }) {
  const { userId, eventId, sourceId, keepInSync } = params
  const existing = (await loadLinks(userId, eventId)).find(link => link.calendar_source_id === sourceId)
  if (existing) {
    if (existing.keep_in_sync !== keepInSync) await setGoogleKeepInSync(userId, eventId, keepInSync)
    await pushUserEventToGoogle(userId, eventId)
    return { htmlLink: existing.html_link, alreadyLinked: true }
  }

  const source = await loadWritableSource(userId, sourceId)
  const { series, replacements } = await loadSeriesBundle(userId, eventId)
  const payload = buildGooglePayload(series, replacements)
  const accessToken = await ensureFreshAccessToken(source)
  const { eventId: googleEventId, htmlLink } = await createGoogleCalendarEvent(accessToken, payload.master)

  const { data: link, error } = await supabaseAdmin.from('google_event_links').insert({
    user_id: userId,
    user_event_id: series.id,
    calendar_source_id: source.id,
    google_event_id: googleEventId,
    html_link: htmlLink,
    keep_in_sync: keepInSync,
    last_pushed_payload: payload,
    last_pushed_at: new Date().toISOString(),
  }).select('*').single()
  if (error || !link) throw new GoogleSyncError('Exported to Google, but the link could not be saved', 500)

  await applyInstances(accessToken, link as GoogleEventLink, payload, series)
  return { htmlLink, alreadyLinked: false }
}

// One push at a time per series: each push re-reads the DB when it starts, so a later
// save (e.g. the replacement row after the series exception) always lands last.
const pushQueues = new Map<string, Promise<unknown>>()

/** Push the current state of a series (and its replacements) to every linked Google copy. */
export async function pushUserEventToGoogle(userId: string, eventId: string, options: { onlyKeepInSync?: boolean } = {}): Promise<number> {
  const seriesId = await resolveSeriesId(userId, eventId)
  const previous = pushQueues.get(seriesId) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(() => pushSeries(userId, seriesId, options))
  pushQueues.set(seriesId, run)
  try {
    return await run
  } finally {
    if (pushQueues.get(seriesId) === run) pushQueues.delete(seriesId)
  }
}

async function pushSeries(userId: string, seriesId: string, options: { onlyKeepInSync?: boolean }): Promise<number> {
  const links = (await loadLinks(userId, seriesId)).filter(link => !options.onlyKeepInSync || link.keep_in_sync)
  if (links.length === 0) return 0
  const { series, replacements } = await loadSeriesBundle(userId, seriesId)
  const payload = buildGooglePayload(series, replacements)
  let pushed = 0
  for (const link of links) {
    try {
      const source = await loadWritableSource(userId, link.calendar_source_id)
      const accessToken = await ensureFreshAccessToken(source)
      const updated = await patchGoogleCalendarEvent(accessToken, link.google_calendar_id, link.google_event_id, payload.master)
      if (!updated) {
        await recordPush(link, null, 'deleted_on_google')
        continue
      }
      await applyInstances(accessToken, link, payload, series)
      await recordPush(link, payload, null)
      pushed++
    } catch (err) {
      await recordPush(link, null, err instanceof Error ? err.message.slice(0, 500) : 'Push failed')
    }
  }
  return pushed
}

/** Auto-push after a local change; never throws (errors are stored on the link). */
export async function syncUserEventAfterChange(userId: string, eventId: string): Promise<void> {
  try {
    await pushUserEventToGoogle(userId, eventId, { onlyKeepInSync: true })
  } catch (err) {
    console.warn('[google-sync] auto-push failed:', err instanceof Error ? err.message : err)
  }
}

/** Links to remove on Google when a series is deleted here (read before the row is gone). */
export async function getKeepInSyncLinks(userId: string, eventId: string): Promise<GoogleEventLink[]> {
  return (await loadLinks(userId, eventId)).filter(link => link.keep_in_sync)
}

export async function deleteGoogleCopies(userId: string, links: GoogleEventLink[]): Promise<void> {
  for (const link of links) {
    try {
      const source = await loadWritableSource(userId, link.calendar_source_id)
      await deleteGoogleCalendarEvent(await ensureFreshAccessToken(source), link.google_calendar_id, link.google_event_id)
    } catch (err) {
      console.warn('[google-sync] delete failed:', err instanceof Error ? err.message : err)
    }
  }
}

export async function setGoogleKeepInSync(userId: string, eventId: string, keepInSync: boolean): Promise<number> {
  const { data } = await supabaseAdmin.from('google_event_links')
    .update({ keep_in_sync: keepInSync, updated_at: new Date().toISOString() })
    .eq('user_id', userId).eq('user_event_id', eventId).select('id')
  return data?.length || 0
}

function sameTime(a?: { dateTime?: string }, b?: { dateTime?: string }): boolean {
  if (!a?.dateTime || !b?.dateTime) return a?.dateTime === b?.dateTime
  return new Date(a.dateTime).getTime() === new Date(b.dateTime).getTime()
}

/** Fields that differ between what Google holds and what we last pushed. */
export function diffGoogleEvent(google: GoogleCalendarEvent, pushed: GoogleCalendarEventBody): string[] {
  const changed: string[] = []
  if ((google.summary || '') !== (pushed.summary || '')) changed.push('title')
  if ((google.description || '') !== (pushed.description || '')) changed.push('description')
  if ((google.location || '') !== (pushed.location || '')) changed.push('location')
  if (!sameTime(google.start, pushed.start) || !sameTime(google.end, pushed.end)) changed.push('time')
  const norm = (lines?: string[]) => [...(lines || [])].sort().join('\n')
  if (norm(google.recurrence) !== norm(pushed.recurrence)) changed.push('recurrence')
  return changed
}

/** Compare our state, what we last pushed, and what Google holds now. */
export async function getUserEventGoogleStatus(userId: string, eventId: string): Promise<{ seriesId: string; links: GoogleLinkStatus[] }> {
  const seriesId = await resolveSeriesId(userId, eventId)
  const links = await loadLinks(userId, seriesId)
  if (links.length === 0) return { seriesId, links: [] }
  const { series, replacements } = await loadSeriesBundle(userId, seriesId)
  const current = buildGooglePayload(series, replacements)

  const statuses: GoogleLinkStatus[] = []
  for (const link of links) {
    const status: GoogleLinkStatus = {
      sourceId: link.calendar_source_id,
      googleEmail: null,
      htmlLink: link.html_link,
      keepInSync: link.keep_in_sync,
      state: 'in_sync',
      changedFields: [],
      lastPushedAt: link.last_pushed_at,
      lastPushError: link.last_push_error,
    }
    try {
      const source = await loadWritableSource(userId, link.calendar_source_id)
      status.googleEmail = source.google_email
      const google = await getGoogleCalendarEvent(await ensureFreshAccessToken(source), link.google_calendar_id, link.google_event_id)
      if (!google || google.status === 'cancelled') {
        status.state = 'deleted_on_google'
      } else if (link.last_pushed_payload && (status.changedFields = diffGoogleEvent(google, link.last_pushed_payload.master)).length > 0) {
        status.state = 'changed_on_google'
      } else if (stableStringify(current) !== stableStringify(link.last_pushed_payload)) {
        status.state = 'outdated'
      }
    } catch (err) {
      status.state = 'error'
      status.lastPushError = err instanceof Error ? err.message.slice(0, 500) : 'Status check failed'
    }
    statuses.push(status)
  }
  return { seriesId, links: statuses }
}
