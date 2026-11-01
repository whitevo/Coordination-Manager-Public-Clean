// Google Calendar API helpers shared by calendar export and outbound event sync.
// Tokens come from calendar_sources rows (google_oauth); refreshed tokens are persisted.

import { supabaseAdmin } from '../supabaseClient.js'

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

interface GoogleTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type: string
  scope: string
  error?: string
  error_description?: string
}

export class GoogleCalendarApiError extends Error {
  readonly statusCode: number
  readonly retryable: boolean

  constructor(message: string, statusCode: number) {
    super(message)
    this.name = 'GoogleCalendarApiError'
    this.statusCode = statusCode
    this.retryable = statusCode === 408 || statusCode === 429 || statusCode >= 500
  }
}

function getGoogleClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET environment variables')
  }
  return { clientId, clientSecret }
}

// ─── Token refresh helper ───────────────────────────────────

/**
 * Refresh a Google OAuth access token using the stored refresh_token.
 * Updates the DB row with the new access_token and expiry.
 * Returns the new (or current) access_token.
 */
export async function ensureFreshAccessToken(source: {
  id: string
  google_access_token: string | null
  google_refresh_token: string | null
  token_expires_at: string | null
}): Promise<string> {
  // If the token is still valid (with 5-minute buffer), return it as-is
  if (source.google_access_token && source.token_expires_at) {
    const expiresAt = new Date(source.token_expires_at).getTime()
    if (Date.now() < expiresAt - 5 * 60 * 1000) {
      return source.google_access_token
    }
  }

  if (!source.google_refresh_token) {
    throw new Error('No refresh token available — user must re-authorize')
  }

  const { clientId, clientSecret } = getGoogleClientCredentials()

  const tokenRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: source.google_refresh_token,
      grant_type: 'refresh_token',
    }),
  })

  const tokenData = (await tokenRes.json()) as GoogleTokenResponse

  if (!tokenRes.ok || tokenData.error) {
    throw new GoogleCalendarApiError(
      tokenData.error_description || tokenData.error || 'Token refresh failed',
      tokenRes.status,
    )
  }

  const newExpiry = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString()

  // Persist new token in DB
  await supabaseAdmin
    .from('calendar_sources')
    .update({
      google_access_token: tokenData.access_token,
      token_expires_at: newExpiry,
    })
    .eq('id', source.id)

  return tokenData.access_token
}

// ─── Google Calendar API helper ─────────────────────────────

export const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

export interface GoogleCalendarEventBody {
  id?: string
  summary: string
  description?: string
  location?: string
  start: { dateTime: string; timeZone?: string }
  end: { dateTime: string; timeZone?: string }
  recurrence?: string[]
  source?: { title: string; url: string }
  reminders?: { useDefault: boolean; overrides?: Array<{ method: string; minutes: number }> }
  status?: 'confirmed' | 'cancelled'
}

interface GoogleCalendarEventResponse {
  id: string
  htmlLink: string
  status: string
  summary?: string
  description?: string
  location?: string
  start?: { dateTime?: string }
  end?: { dateTime?: string }
  error?: { code: number; message: string }
}

/**
 * Create an event on the user's primary Google Calendar.
 * Returns the event id and link.
 */
export async function createGoogleCalendarEvent(
  accessToken: string,
  event: GoogleCalendarEventBody,
): Promise<{ eventId: string; htmlLink: string }> {
  const res = await fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(event),
  })

  const data = (await res.json()) as GoogleCalendarEventResponse

  if (res.status === 409 && event.id) {
    const existingRes = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/primary/events/${encodeURIComponent(event.id)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    const existingData = (await existingRes.json()) as GoogleCalendarEventResponse
    const sameEvent =
      existingData.summary === event.summary &&
      (existingData.description || undefined) === event.description &&
      (existingData.location || undefined) === event.location &&
      new Date(existingData.start?.dateTime || '').getTime() ===
        new Date(event.start.dateTime).getTime() &&
      new Date(existingData.end?.dateTime || '').getTime() ===
        new Date(event.end.dateTime).getTime()
    if (existingRes.ok && !existingData.error && existingData.id === event.id && sameEvent) {
      return { eventId: existingData.id, htmlLink: existingData.htmlLink }
    }

    throw new GoogleCalendarApiError(
      existingData.error?.message ||
        (existingRes.ok
          ? 'Google Calendar event idempotency key conflicts with a different event.'
          : `Google Calendar API error (${existingRes.status})`),
      existingRes.ok ? 409 : existingRes.status,
    )
  }

  if (!res.ok || data.error) {
    throw new GoogleCalendarApiError(
      data.error?.message || `Google Calendar API error (${res.status})`,
      res.status,
    )
  }

  return { eventId: data.id, htmlLink: data.htmlLink }
}

// ─── Recurrence RRULE builder ───────────────────────────────

export interface RecurrenceRule {
  type: 'none' | 'weekly' | 'biweekly' | 'monthly' | 'monthlyWeek' | 'custom'
  interval?: number
  unit?: 'day' | 'week' | 'month'
  weekDays?: number[]
  monthWeeks?: number[]
  endType?: 'never' | 'on' | 'after' | 'whenCompleted'
  endDate?: string
  endCount?: number
  exceptions?: string[]
}

/**
 * Build an RFC 5545 RRULE string from a recurrence rule object.
 * Returns null if the type is 'none' or invalid.
 */
export function buildRRuleFromRecurrence(rule: RecurrenceRule, dtStartISO: string): string | null {
  if (!rule || rule.type === 'none') return null
  const parts: string[] = []
  const dayNames = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

  // Get the weekday index (0=Mon..6=Sun) from the start date
  function getDayIndex(): number {
    const d = new Date(dtStartISO)
    const jsDay = d.getUTCDay() // 0=Sun..6=Sat
    return jsDay === 0 ? 6 : jsDay - 1
  }

  if (rule.type === 'weekly') {
    parts.push('FREQ=WEEKLY', 'INTERVAL=1')
  } else if (rule.type === 'biweekly') {
    parts.push('FREQ=WEEKLY', 'INTERVAL=2')
  } else if (rule.type === 'monthly') {
    parts.push('FREQ=MONTHLY', 'INTERVAL=1')
  } else if (rule.type === 'monthlyWeek') {
    // Nth weekday of the month (weeks 1-4), e.g. BYDAY=2TU,4TU
    const start = new Date(dtStartISO)
    const weeks = rule.monthWeeks && rule.monthWeeks.length > 0
      ? rule.monthWeeks
      : [Math.floor((start.getUTCDate() - 1) / 7) + 1]
    parts.push('FREQ=MONTHLY', 'INTERVAL=1', `BYDAY=${weeks.map(w => `${w}${dayNames[getDayIndex()]}`).join(',')}`)
  } else if (rule.type === 'custom') {
    const unit = rule.unit || 'week'
    const interval = rule.interval || 1
    if (unit === 'day') {
      parts.push('FREQ=DAILY', `INTERVAL=${interval}`)
    } else if (unit === 'week') {
      const days = (rule.weekDays || [getDayIndex()]).map(d => dayNames[d]).join(',')
      parts.push('FREQ=WEEKLY', `INTERVAL=${interval}`, `BYDAY=${days}`)
    } else {
      parts.push('FREQ=MONTHLY', `INTERVAL=${interval}`)
    }
  }

  if (rule.endType === 'on' && rule.endDate) {
    parts.push(`UNTIL=${rule.endDate.replace(/-/g, '')}T235959Z`)
  } else if (rule.endType === 'after' && rule.endCount) {
    parts.push(`COUNT=${rule.endCount}`)
  }

  if (!parts.some(part => part.startsWith('FREQ='))) return null
  return parts.join(';')
}

// ─── Event-level calls for outbound sync ────────────────────

export interface GoogleCalendarEvent {
  id: string
  status?: string
  htmlLink?: string
  summary?: string
  description?: string
  location?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  recurrence?: string[]
  recurringEventId?: string
  originalStartTime?: { dateTime?: string; date?: string }
}

function eventUrl(calendarId: string, eventId?: string, suffix = ''): string {
  const base = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`
  return eventId ? `${base}/${encodeURIComponent(eventId)}${suffix}` : base
}

async function googleRequest<T>(accessToken: string, url: string, init: RequestInit = {}): Promise<{ status: number; data: T | null }> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  })
  if (res.status === 204) return { status: res.status, data: null }
  const data = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(data?.error?.message || `Google Calendar API error (${res.status})`)
  }
  return { status: res.status, data: res.ok ? data : null }
}

/** Fetch an event; null when it no longer exists (404/410). */
export async function getGoogleCalendarEvent(accessToken: string, calendarId: string, eventId: string): Promise<GoogleCalendarEvent | null> {
  const { data } = await googleRequest<GoogleCalendarEvent>(accessToken, eventUrl(calendarId, eventId))
  return data
}

/** Patch an event; returns null when the event no longer exists. */
export async function patchGoogleCalendarEvent(
  accessToken: string, calendarId: string, eventId: string, body: Partial<GoogleCalendarEventBody>,
): Promise<GoogleCalendarEvent | null> {
  const { data } = await googleRequest<GoogleCalendarEvent>(accessToken, eventUrl(calendarId, eventId), {
    method: 'PATCH', body: JSON.stringify(body),
  })
  return data
}

/** Delete (cancel) an event or a single instance. Missing events are treated as done. */
export async function deleteGoogleCalendarEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
  await googleRequest<null>(accessToken, eventUrl(calendarId, eventId), { method: 'DELETE' })
}

/** Find one instance of a recurring event by its original start, including cancelled ones. */
export async function findGoogleEventInstance(
  accessToken: string, calendarId: string, recurringEventId: string, originalStartISO: string,
): Promise<GoogleCalendarEvent | null> {
  const originalStart = new Date(originalStartISO).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const params = new URLSearchParams({ originalStart, showDeleted: 'true' })
  const { data } = await googleRequest<{ items?: GoogleCalendarEvent[] }>(
    accessToken, `${eventUrl(calendarId, recurringEventId, '/instances')}?${params.toString()}`,
  )
  return data?.items?.[0] ?? null
}

function toGoogleUtcStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/** RRULE plus an EXDATE line for occurrences removed from the series (UTC starts). */
export function buildRecurrenceLines(rule: RecurrenceRule, dtStartISO: string, excludedStartISOs: string[] = []): string[] | undefined {
  if (rule.endType === 'whenCompleted') return undefined
  const rrule = buildRRuleFromRecurrence(rule, dtStartISO)
  if (!rrule) return undefined
  const lines = [`RRULE:${rrule}`]
  if (excludedStartISOs.length > 0) {
    lines.push(`EXDATE:${[...excludedStartISOs].sort().map(toGoogleUtcStamp).join(',')}`)
  }
  return lines
}
