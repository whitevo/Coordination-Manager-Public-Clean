import { Router, Response } from 'express'
import { createHash, createHmac, randomBytes } from 'crypto'
import { supabaseAdmin } from '../supabaseClient.js'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js'
import { safeErrorMessage, sanitizeUUID } from '../middleware/validation.js'
import {
  GOOGLE_CALENDAR_API,
  buildRecurrenceLines,
  createGoogleCalendarEvent,
  ensureFreshAccessToken,
  GoogleCalendarApiError,
  type GoogleCalendarEventBody,
} from '../services/google-calendar-api.js'
import { fetchPublicCalendarUrl, resolveSafePublicCalendarUrl } from '../services/public-calendar-fetch.js'
import IcalExpander from 'ical-expander'

const router: ReturnType<typeof Router> = Router()

// ─── Google OAuth helpers ───────────────────────────────────

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo'
// Scopes needed for both busy-time reads and event export.
// calendar.events is sufficient for creating events, but busy sync also calls
// CalendarList and FreeBusy endpoints, which require a read-capable scope.
// Keep this list in sync with the OAuth consent screen configured in Google
// Cloud Console.
const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')
const devOnlyCalendarStateKey = randomBytes(32).toString('hex')

function getGoogleOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI || 'http://localhost:3001/api/calendar-sources/google/callback'

  if (!clientId || !clientSecret) {
    throw new Error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET environment variables')
  }

  return { clientId, clientSecret, redirectUri }
}

function getRuntimeCalendarRedirectUri(req: { protocol: string; get(name: string): string | undefined }): string {
  if (process.env.GOOGLE_CALENDAR_REDIRECT_URI) {
    return process.env.GOOGLE_CALENDAR_REDIRECT_URI
  }

  const host = req.get('host')
  if (host) {
    return `${req.protocol}://${host}/api/calendar-sources/google/callback`
  }

  return 'http://localhost:3001/api/calendar-sources/google/callback'
}

// ─── State parameter signing ────────────────────────────────
// HMAC-sign the OAuth state to prevent forgery / account takeover

function getStateSigningKey(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET

  const allowInsecureDevSigning =
    process.env.NODE_ENV === 'test' ||
    (process.env.NODE_ENV !== 'production' && process.env.ALLOW_INSECURE_DEV_SIGNING === 'true')

  if (!allowInsecureDevSigning) {
    throw new Error('JWT_SECRET is required for OAuth state signing')
  }

  return devOnlyCalendarStateKey
}

function signState(payload: object): string {
  const json = JSON.stringify(payload)
  const data = Buffer.from(json).toString('base64url')
  const sig = createHmac('sha256', getStateSigningKey()).update(data).digest('base64url')
  return `${data}.${sig}`
}

function verifyState(state: string): object | null {
  const parts = state.split('.')
  if (parts.length !== 2) return null
  const [data, sig] = parts
  const expectedSig = createHmac('sha256', getStateSigningKey()).update(data).digest('base64url')
  if (sig !== expectedSig) return null
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf-8'))
  } catch {
    return null
  }
}

// ─── Types ──────────────────────────────────────────────────

interface GoogleTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type: string
  scope: string
  error?: string
  error_description?: string
}

interface GoogleUserInfo {
  email: string
  name?: string
  picture?: string
}

interface PublicCalendarValidationResult {
  normalizedUrl: string
  eventCount: number
}

// ─── ICS feed parser (ical-expander) ────────────────────────

/**
 * Parse an ICS (iCalendar) feed and extract VEVENT busy blocks
 * within the given time range. Uses ical-expander to properly
 * handle RRULE recurring events, RECURRENCE-ID overrides,
 * EXDATE exclusions, and timezones.
 */
function parseIcsEvents(
  icsText: string,
  rangeMinMs: number,
  rangeMaxMs: number,
): Array<{ start: string; end: string; summary?: string }> {
  const after = new Date(rangeMinMs)
  const before = new Date(rangeMaxMs)

  const icalExpander = new IcalExpander({ ics: icsText, maxIterations: 500 })
  const { events, occurrences } = icalExpander.between(after, before)

  const results: Array<{ start: string; end: string; summary?: string }> = []

  // Non-recurring events (or single instances)
  for (const event of events) {
    const startDate = event.startDate?.toJSDate()
    const endDate = event.endDate?.toJSDate()
    if (!startDate) continue
    results.push({
      start: startDate.toISOString(),
      end: (endDate || new Date(startDate.getTime() + 3600000)).toISOString(),
      summary: event.summary || undefined,
    })
  }

  // Expanded recurring occurrences
  for (const occ of occurrences) {
    const startDate = occ.startDate?.toJSDate()
    const endDate = occ.endDate?.toJSDate()
    if (!startDate) continue
    results.push({
      start: startDate.toISOString(),
      end: (endDate || new Date(startDate.getTime() + 3600000)).toISOString(),
      summary: occ.item?.summary || undefined,
    })
  }

  return results
}

async function validatePublicCalendarFeed(publicUrl: string): Promise<PublicCalendarValidationResult> {
  const normalizedUrl = await resolveSafePublicCalendarUrl(publicUrl)
  const response = await fetchPublicCalendarUrl(normalizedUrl, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.8',
    },
  })

  if (!response.ok) {
    throw new Error(`Calendar URL is not accessible (HTTP ${response.status})`)
  }

  const icsText = await response.text()
  if (!/BEGIN:VCALENDAR/i.test(icsText)) {
    throw new Error('URL must point to a public iCalendar (.ics) feed, not a regular web page')
  }

  try {
    const now = Date.now()
    const eventCount = parseIcsEvents(icsText, now - 24 * 60 * 60 * 1000, now + 365 * 24 * 60 * 60 * 1000).length
    return { normalizedUrl, eventCount }
  } catch {
    throw new Error('Calendar feed could not be parsed. Please use a valid public .ics URL')
  }
}

// ─── Routes requiring auth ──────────────────────────────────

// Apply auth middleware to all routes EXCEPT the OAuth callback
// (callback comes from Google redirect, not from our authenticated frontend)
router.use((req, res, next) => {
  // Skip auth for the Google OAuth callback
  console.log(`[calendar-sources] ${req.method} ${req.path} (originalUrl: ${req.originalUrl})`)
  if (req.path === '/google/callback' && req.method === 'GET') {
    console.log('[calendar-sources] Skipping auth for Google OAuth callback')
    return next()
  }
  return authMiddleware(req as AuthenticatedRequest, res, next)
})

// ─── GET /api/calendar-sources ──────────────────────────────
// List all calendar sources for the authenticated user

router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('calendar_sources')
      .select('id, user_id, source_type, google_email, public_url, display_name, color, is_active, last_synced, sync_error, created_at, updated_at')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Error fetching calendar sources:', error)
      return res.status(400).json({ error: safeErrorMessage(error) })
    }

    res.json({ sources: data || [] })
  } catch {
    res.status(500).json({ error: 'Failed to list calendar sources' })
  }
})

// ─── GET /api/calendar-sources/google/auth-url ──────────────
// Generate a Google OAuth consent URL for connecting a calendar.
// The frontend redirects the user to this URL.
// We encode user context (userId, display_name, color) in the state param
// so the callback can create the calendar_source row.

router.get('/google/auth-url', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { clientId } = getGoogleOAuthConfig()
    const redirectUri = getRuntimeCalendarRedirectUri(req)

    const display_name = (req.query.display_name as string) || 'Google Calendar'
    const color = (req.query.color as string) || '#3B82F6'

    // Sign the state with HMAC to prevent forgery
    const state = signState({
      userId: req.userId,
      display_name,
      color,
    })

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GOOGLE_CALENDAR_SCOPES,
      access_type: 'offline',   // Request a refresh token
      prompt: 'consent',        // Always show consent to get refresh_token
      state,
    })

    const authUrl = `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`

    res.json({ authUrl })
  } catch (err) {
    console.error('Error generating Google auth URL:', err)
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── GET /api/calendar-sources/google/callback ──────────────
// Google redirects here after the user grants permission.
// Exchange authorization code for tokens, fetch user email,
// create the calendar_source DB row, then redirect to the frontend.

router.get('/google/callback', async (req, res: Response) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
  const errorRedirect = (msg: string) =>
    res.redirect(`${frontendUrl}/settings?tab=calendar&section=connections&oauth_error=${encodeURIComponent(msg)}`)

  try {
    const { code, state, error: oauthError } = req.query

    // Google may return an error (e.g. user denied consent)
    if (oauthError) {
      return errorRedirect(oauthError as string)
    }

    if (!code || !state) {
      return errorRedirect('Missing authorization code or state')
    }

    // Verify HMAC-signed state to recover userId, display_name, color
    const verified = verifyState(state as string)
    if (!verified || !(verified as { userId?: string }).userId) {
      return errorRedirect('Invalid or tampered state parameter')
    }
    const statePayload = verified as { userId: string; display_name: string; color: string }

    const { clientId, clientSecret } = getGoogleOAuthConfig()
    const redirectUri = getRuntimeCalendarRedirectUri(req)

    // ── Exchange authorization code for tokens ───────────────
    const tokenRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code as string,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })

    const tokenData = await tokenRes.json() as GoogleTokenResponse

    if (!tokenRes.ok || tokenData.error) {
      console.error(
        'Google token exchange failed:',
        String(tokenData.error ?? '').replace(/[\r\n]/g, ' '),
        String(tokenData.error_description ?? '').replace(/[\r\n]/g, ' '),
      )
      return errorRedirect(tokenData.error_description || tokenData.error || 'Token exchange failed')
    }

    const {
      access_token,
      refresh_token,
      expires_in,
    } = tokenData

    // ── Fetch the user's Google email ────────────────────────
    const userInfoRes = await fetch(GOOGLE_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${access_token}` },
    })

    const userInfo = await userInfoRes.json() as GoogleUserInfo
    const googleEmail = userInfo.email || 'unknown'

    // ── Calculate token expiry ───────────────────────────────
    const tokenExpiresAt = new Date(Date.now() + (expires_in || 3600) * 1000).toISOString()

    // ── Upsert the calendar source ───────────────────────────
    // If the user already has a source for this Google email, update the tokens.
    // Otherwise insert a new row.
    const { data: existing } = await supabaseAdmin
      .from('calendar_sources')
      .select('id')
      .eq('user_id', statePayload.userId)
      .eq('source_type', 'google_oauth')
      .eq('google_email', googleEmail)
      .maybeSingle()

    if (existing) {
      // Update existing source with fresh tokens
      await supabaseAdmin
        .from('calendar_sources')
        .update({
          google_access_token: access_token,
          google_refresh_token: refresh_token || undefined,
          token_expires_at: tokenExpiresAt,
          display_name: statePayload.display_name,
          color: statePayload.color,
          sync_error: null,
          is_active: true,
        })
        .eq('id', existing.id)
    } else {
      // Insert new source
      const { error: insertErr } = await supabaseAdmin
        .from('calendar_sources')
        .insert({
          user_id: statePayload.userId,
          source_type: 'google_oauth',
          google_email: googleEmail,
          google_access_token: access_token,
          google_refresh_token: refresh_token || null,
          token_expires_at: tokenExpiresAt,
          display_name: statePayload.display_name,
          color: statePayload.color,
          is_active: true,
        })

      if (insertErr) {
        console.error('Error inserting calendar source:', insertErr)
        return errorRedirect('Failed to save calendar connection')
      }
    }

    // ── Redirect back to the frontend Settings page ──────────
    res.redirect(`${frontendUrl}/settings?tab=calendar&section=connections&oauth_success=true`)
  } catch (err) {
    console.error('Google OAuth callback error:', err)
    errorRedirect('An unexpected error occurred during Google sign-in')
  }
})

// ─── POST /api/calendar-sources/public-url ──────────────────
// Add a public Google Calendar URL source

router.post('/public-url', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { public_url, display_name, color } = req.body

    if (!public_url) {
      return res.status(400).json({ error: 'public_url is required' })
    }
    if (!display_name) {
      return res.status(400).json({ error: 'display_name is required' })
    }

    let validatedFeed: PublicCalendarValidationResult
    try {
      validatedFeed = await validatePublicCalendarFeed(public_url)
    } catch (err) {
      return res.status(400).json({ error: safeErrorMessage(err) })
    }

    const { data, error } = await supabaseAdmin
      .from('calendar_sources')
      .insert({
        user_id: req.userId,
        source_type: 'google_public_url',
        public_url: validatedFeed.normalizedUrl,
        display_name,
        color: color || '#10B981',
        is_active: true,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'This calendar URL is already added' })
      }
      console.error('Error adding public URL source:', error)
      return res.status(400).json({ error: safeErrorMessage(error) })
    }

    res.status(201).json({ source: data, validation: { eventCount: validatedFeed.eventCount } })
  } catch {
    res.status(500).json({ error: 'Failed to add public calendar URL' })
  }
})

// ─── PUT /api/calendar-sources/:id ──────────────────────────
// Update a calendar source (display_name, color, is_active)

router.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params
    const { display_name, color, is_active } = req.body

    const updates: Record<string, unknown> = {}
    if (display_name !== undefined) updates.display_name = display_name
    if (color !== undefined) updates.color = color
    if (is_active !== undefined) updates.is_active = is_active

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' })
    }

    const { data, error } = await supabaseAdmin
      .from('calendar_sources')
      .update(updates)
      .eq('id', id)
      .eq('user_id', req.userId)
      .select()
      .single()

    if (error) {
      console.error('Error updating calendar source:', error)
      return res.status(400).json({ error: safeErrorMessage(error) })
    }

    if (!data) {
      return res.status(404).json({ error: 'Calendar source not found' })
    }

    res.json({ source: data })
  } catch {
    res.status(500).json({ error: 'Failed to update calendar source' })
  }
})

// ─── DELETE /api/calendar-sources/:id ───────────────────────
// Remove a calendar source

router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params

    const { data, error } = await supabaseAdmin
      .from('calendar_sources')
      .delete()
      .eq('id', id)
      .eq('user_id', req.userId)
      .select()
      .single()

    if (error) {
      console.error('Error deleting calendar source:', error)
      return res.status(400).json({ error: safeErrorMessage(error) })
    }

    if (!data) {
      return res.status(404).json({ error: 'Calendar source not found' })
    }

    // Remove any meetings that were imported from this source so they do not
    // linger as orphaned (source-less) events after the source is disconnected.
    const { error: cleanupError } = await supabaseAdmin
      .from('user_events')
      .delete()
      .eq('user_id', req.userId)
      .eq('source_id', id)
      .in('source_type', ['google_oauth', 'google_public_url'])

    if (cleanupError) {
      console.error('Error cleaning up events for deleted calendar source:', cleanupError)
    }

    res.json({ message: 'Calendar source removed', source: data })
  } catch {
    res.status(500).json({ error: 'Failed to delete calendar source' })
  }
})

// ─── POST /api/calendar-sources/export ──────────────────────
// Export confirmed meetings to connected Google Calendar accounts.
// For each meeting, creates an event on each selected Google Calendar source.

router.post('/export', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { meetings, targetSourceIds, calendarHash: _calendarHash } = req.body

    if (!meetings || !Array.isArray(meetings) || meetings.length === 0) {
      return res.status(400).json({ error: 'No meetings provided for export' })
    }
    if (!targetSourceIds || !Array.isArray(targetSourceIds) || targetSourceIds.length === 0) {
      return res.status(400).json({ error: 'No target calendar sources selected' })
    }

    // Verify the target sources belong to the user and are google_oauth type
    const { data: sources, error: srcError } = await supabaseAdmin
      .from('calendar_sources')
      .select('id, source_type, google_email, google_access_token, google_refresh_token, token_expires_at')
      .eq('user_id', req.userId)
      .in('id', targetSourceIds)

    if (srcError) {
      return res.status(400).json({ error: safeErrorMessage(srcError) })
    }

    const oauthSources = (sources || []).filter(s => s.source_type === 'google_oauth')
    if (oauthSources.length === 0) {
      return res.status(400).json({ error: 'No writable Google Calendar sources found among selected targets' })
    }

    // Check if any source has OAuth tokens configured
    const sourcesWithTokens = oauthSources.filter(s => s.google_access_token || s.google_refresh_token)
    if (sourcesWithTokens.length === 0) {
      return res.status(400).json({
        error: 'Google Calendar tokens are missing. Please reconnect your Google account in Settings.',
      })
    }

    // ── Create events on Google Calendar ─────────────────────
    const results: Array<{
      sourceId: string
      googleEmail: string
      created: number
      failed: number
      errors: string[]
      eventLinks: string[]
    }> = []

    for (const source of sourcesWithTokens) {
      const sourceResult = {
        sourceId: source.id,
        googleEmail: source.google_email || 'unknown',
        created: 0,
        failed: 0,
        errors: [] as string[],
        eventLinks: [] as string[],
      }

      let accessToken: string
      try {
        accessToken = await ensureFreshAccessToken(source)
      } catch (err) {
        sourceResult.errors.push(`Token refresh failed: ${safeErrorMessage(err)}`)
        sourceResult.failed = meetings.length
        results.push(sourceResult)
        continue
      }

      for (const meeting of meetings) {
        try {
          // Build start/end from cellId or from start_time/end_time fields
          let startISO: string
          let endISO: string

          if (meeting.start_time && meeting.end_time) {
            startISO = meeting.start_time
            endISO = meeting.end_time
          } else if (meeting.cellId) {
            const [dateStr, timeStr] = meeting.cellId.split('_')
            // cellId times are UTC — append Z to parse as UTC, not local time
            const start = new Date(`${dateStr}T${timeStr}:00Z`)
            const durationMs = (meeting.duration || 60) * 60 * 1000
            const end = new Date(start.getTime() + durationMs)
            startISO = start.toISOString()
            endISO = end.toISOString()
          } else {
            sourceResult.errors.push(`Meeting "${meeting.title || 'untitled'}" has no time data`)
            sourceResult.failed++
            continue
          }

          const eventBody: GoogleCalendarEventBody = {
            summary: meeting.title || meeting.description || 'Meeting',
            description: meeting.description || undefined,
            start: { dateTime: startISO, timeZone: 'UTC' },
            end: { dateTime: endISO, timeZone: 'UTC' },
            // Suppress default 30-min notification — no reminders by default
            reminders: { useDefault: false },
          }

          // ── Recurrence RRULE ───────────────────────────────
          if (meeting.recurrenceRule && meeting.recurrenceRule.type && meeting.recurrenceRule.type !== 'none') {
            const excludedStarts = (Array.isArray(meeting.recurrenceRule.exceptions) ? meeting.recurrenceRule.exceptions : [])
              .filter((date: unknown): date is string => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))
              .map((date: string) => `${date}${startISO.slice(10)}`)
            const recurrence = buildRecurrenceLines(meeting.recurrenceRule, startISO, excludedStarts)
            if (recurrence) {
              eventBody.recurrence = recurrence
            }
          }

          // Add meeting link to location field and description
          if (meeting.meetingLink) {
            eventBody.location = meeting.meetingLink
            eventBody.description = [
              eventBody.description,
              `Meeting link: ${meeting.meetingLink}`,
            ].filter(Boolean).join('\n\n')
          }

          const { htmlLink } = await createGoogleCalendarEvent(accessToken, eventBody)
          sourceResult.created++
          sourceResult.eventLinks.push(htmlLink)
        } catch (err) {
          console.error(`Failed to create event for meeting "${meeting.title}":`, err)
          sourceResult.errors.push(`"${meeting.title || 'untitled'}": ${safeErrorMessage(err)}`)
          sourceResult.failed++
        }
      }

      results.push(sourceResult)
    }

    const totalCreated = results.reduce((sum, r) => sum + r.created, 0)
    const totalFailed = results.reduce((sum, r) => sum + r.failed, 0)

    res.json({
      message: `Exported ${totalCreated} event(s) to ${results.length} calendar(s)${totalFailed > 0 ? ` (${totalFailed} failed)` : ''}.`,
      exported: true,
      totalCreated,
      totalFailed,
      meetingCount: meetings.length,
      targetCount: results.length,
      results,
    })
  } catch (err) {
    console.error('Export error:', err)
    res.status(500).json({ error: 'Failed to export meetings' })
  }
})

// ─── POST /api/calendar-sources/add-event ───────────────────
// Add a single event to one or more connected Google Calendar accounts.
// Used for one-click "Add to Calendar" from Events/Your Calendar pages.

router.post('/add-event', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { event, targetSourceIds } = req.body
    const idempotencyKey =
      req.body?.idempotencyKey === undefined ? null : sanitizeUUID(req.body.idempotencyKey)

    if (req.body?.idempotencyKey !== undefined && !idempotencyKey) {
      return res.status(400).json({ error: 'Invalid idempotency key' })
    }

    if (!event || !event.title || !event.start_time || !event.end_time) {
      return res.status(400).json({ error: 'Event must include title, start_time, and end_time' })
    }
    if (!targetSourceIds || !Array.isArray(targetSourceIds) || targetSourceIds.length === 0) {
      return res.status(400).json({ error: 'No target calendar sources selected' })
    }

    // Verify the target sources belong to the user and are google_oauth type
    const { data: sources, error: srcError } = await supabaseAdmin
      .from('calendar_sources')
      .select('id, source_type, google_email, google_access_token, google_refresh_token, token_expires_at')
      .eq('user_id', req.userId)
      .in('id', targetSourceIds)

    if (srcError) {
      return res.status(400).json({ error: safeErrorMessage(srcError) })
    }

    const oauthSources = (sources || []).filter(s => s.source_type === 'google_oauth')
    if (oauthSources.length === 0) {
      return res.status(400).json({ error: 'No writable Google Calendar sources found' })
    }

    const sourcesWithTokens = oauthSources.filter(s => s.google_access_token || s.google_refresh_token)
    if (sourcesWithTokens.length === 0) {
      return res.status(400).json({
        error: 'Google Calendar tokens are missing. Please reconnect your Google account in Settings.',
      })
    }

    const results: Array<{
      sourceId: string
      googleEmail: string
      success: boolean
      htmlLink?: string
      error?: string
      retryable?: boolean
    }> = []

    for (const source of sourcesWithTokens) {
      try {
        const accessToken = await ensureFreshAccessToken(source)

        const eventBody: GoogleCalendarEventBody = {
          summary: event.title,
          description: event.description || undefined,
          start: { dateTime: event.start_time, timeZone: 'UTC' },
          end: { dateTime: event.end_time, timeZone: 'UTC' },
          reminders: { useDefault: false },
        }
        if (idempotencyKey) {
          eventBody.id = createHash('sha256')
            .update(`${idempotencyKey}:${source.id}`)
            .digest('hex')
        }

        if (event.location) {
          eventBody.location = event.location
        } else if (event.meeting_link) {
          eventBody.location = event.meeting_link
        }

        if (event.meeting_link && !eventBody.description) {
          eventBody.description = `Meeting link: ${event.meeting_link}`
        }

        const { htmlLink } = await createGoogleCalendarEvent(accessToken, eventBody)
        results.push({ sourceId: source.id, googleEmail: source.google_email || 'unknown', success: true, htmlLink })
      } catch (err) {
        results.push({
          sourceId: source.id,
          googleEmail: source.google_email || 'unknown',
          success: false,
          error: safeErrorMessage(err),
          retryable:
            err instanceof GoogleCalendarApiError
              ? err.retryable
              : err instanceof TypeError,
        })
      }
    }

    const succeeded = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length

    res.json({
      message: `Added to ${succeeded} calendar(s)${failed > 0 ? ` (${failed} failed)` : ''}.`,
      succeeded,
      failed,
      results,
    })
  } catch (err) {
    console.error('Add event error:', err)
    res.status(500).json({ error: 'Failed to add event to calendar' })
  }
})

// ─── POST /api/calendar-sources/busy ────────────────────────
// Fetch busy times from connected Google Calendars for a given date range.
// Returns an array of busy blocks (start/end) for each checked source.

router.post('/busy', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sourceIds, timeMin, timeMax, includeSummaries } = req.body

    const fetchEventBusyBlocks = async (
      accessToken: string,
      calendarItems: Array<{ id: string }>
    ): Promise<Array<{ start: string; end: string; summary?: string }>> => {
      const eventBlocks: Array<{ start: string; end: string; summary?: string }> = []
      const dedupKeys = new Set<string>()

      for (const calendarItem of calendarItems) {
        const params = new URLSearchParams({
          timeMin,
          timeMax,
          singleEvents: 'true',
          orderBy: 'startTime',
          showDeleted: 'false',
          maxResults: '2500',
        })

        const eventsRes = await fetch(
          `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarItem.id)}/events?${params.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        )

        const eventsData = await eventsRes.json() as {
          items?: Array<{
            id?: string
            status?: string
            transparency?: string
            summary?: string
            start?: { dateTime?: string; date?: string }
            end?: { dateTime?: string; date?: string }
          }>
          error?: { message?: string }
        }

        if (!eventsRes.ok) {
          throw new Error(eventsData?.error?.message || `Google Calendar API error (${eventsRes.status})`)
        }

        for (const item of eventsData.items || []) {
          if (item.status === 'cancelled') continue
          if (item.transparency === 'transparent') continue

          const startRaw = item.start?.dateTime || item.start?.date
          const endRaw = item.end?.dateTime || item.end?.date
          if (!startRaw || !endRaw) continue

          const startMs = new Date(startRaw).getTime()
          const endMs = new Date(endRaw).getTime()
          if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue

          const startIso = new Date(startMs).toISOString()
          const endIso = new Date(endMs).toISOString()
          const dedupKey = `${item.id || ''}::${startIso}::${endIso}`
          if (dedupKeys.has(dedupKey)) continue
          dedupKeys.add(dedupKey)

          eventBlocks.push({
            start: startIso,
            end: endIso,
            summary: item.summary || 'Busy',
          })
        }
      }

      return eventBlocks
    }

    if (!sourceIds || !Array.isArray(sourceIds) || sourceIds.length === 0) {
      return res.status(400).json({ error: 'No source IDs provided' })
    }
    if (!timeMin || !timeMax) {
      return res.status(400).json({ error: 'timeMin and timeMax are required' })
    }

    // Fetch the requested sources (include public_url for ICS feeds)
    const { data: sources, error: srcError } = await supabaseAdmin
      .from('calendar_sources')
      .select('id, source_type, public_url, google_email, google_access_token, google_refresh_token, token_expires_at, color, display_name')
      .eq('user_id', req.userId)
      .in('id', sourceIds)

    if (srcError) {
      return res.status(400).json({ error: safeErrorMessage(srcError) })
    }

    const oauthSources = (sources || []).filter(
      s => s.source_type === 'google_oauth' && (s.google_access_token || s.google_refresh_token)
    )
    const publicUrlSources = (sources || []).filter(
      s => s.source_type === 'google_public_url' && s.public_url
    )

    if (oauthSources.length === 0 && publicUrlSources.length === 0) {
      return res.json({ busyBlocks: [] })
    }

    const rangeMin = new Date(timeMin).getTime()
    const rangeMax = new Date(timeMax).getTime()
    const allBusyBlocks: Array<{ start: string; end: string; sourceId: string; color: string; summary?: string }> = []

    const sourceErrors: Array<{ sourceId: string; displayName: string; error: string }> = []

    // ── OAuth sources: primary FreeBusy path, optional Events summary path ──
    for (const source of oauthSources) {
      try {
        const accessToken = await ensureFreshAccessToken(source)

        // Fetch only calendars the user OWNS (primary + other owned calendars).
        // Exclude subscribed/shared calendars (reader, freeBusyReader) to avoid
        // showing other people's events as the user's busy times.
        let calendarItems: Array<{ id: string }> = [{ id: 'primary' }]
        try {
          const calListRes = await fetch(
            `${GOOGLE_CALENDAR_API}/users/me/calendarList?fields=items(id,accessRole)`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          )
          if (calListRes.ok) {
            const calListData = await calListRes.json() as { items?: Array<{ id: string; accessRole?: string }> }
            if (calListData.items && calListData.items.length > 0) {
              calendarItems = calListData.items
                .filter(c => c.accessRole === 'owner' || c.accessRole === 'writer')
                .map(c => ({ id: c.id }))
              // Ensure at least primary is included
              if (calendarItems.length === 0) {
                calendarItems = [{ id: 'primary' }]
              }
            }
          }
        } catch (listErr) {
          console.error(`Failed to list calendars for source ${source.id}, falling back to primary:`, safeErrorMessage(listErr))
        }

        // Path 1: FreeBusy for reliable busy intervals.
        const sourceBusyBlocks: Array<{ start: string; end: string; summary?: string }> = []
        const freeBusyRes = await fetch(`${GOOGLE_CALENDAR_API}/freeBusy`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            timeMin,
            timeMax,
            timeZone: 'UTC',
            items: calendarItems,
          }),
        })

        const freeBusyData = await freeBusyRes.json() as {
          calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>
          error?: { message?: string }
        }

        if (!freeBusyRes.ok) {
          const freeBusyError = freeBusyData?.error?.message || `Google Calendar API error (${freeBusyRes.status})`
          const isScopeError = /insufficient authentication scopes|insufficient permissions/i.test(freeBusyError)

          if (isScopeError) {
            // Backward compatibility: older OAuth grants may only have calendar.events.
            const eventBlocks = await fetchEventBusyBlocks(accessToken, calendarItems)
            sourceBusyBlocks.push(...eventBlocks)
          } else {
            throw new Error(freeBusyError)
          }
        }

        if (sourceBusyBlocks.length === 0) {
          const rawBlocks: Array<{ start: number; end: number }> = []
          if (freeBusyData.calendars) {
            for (const [_calId, calData] of Object.entries(freeBusyData.calendars)) {
              if (calData?.busy) {
                for (const block of calData.busy) {
                  rawBlocks.push({
                    start: new Date(block.start).getTime(),
                    end: new Date(block.end).getTime(),
                  })
                }
              }
            }
          }

          if (rawBlocks.length > 0) {
            rawBlocks.sort((a, b) => a.start - b.start)
            const merged: Array<{ start: number; end: number }> = [rawBlocks[0]]
            for (let i = 1; i < rawBlocks.length; i++) {
              const last = merged[merged.length - 1]
              if (rawBlocks[i].start <= last.end) {
                last.end = Math.max(last.end, rawBlocks[i].end)
              } else {
                merged.push(rawBlocks[i])
              }
            }
            for (const block of merged) {
              sourceBusyBlocks.push({
                start: new Date(block.start).toISOString(),
                end: new Date(block.end).toISOString(),
              })
            }
          }
        }

        // Path 2 (optional): Events API for meeting titles.
        // If this path returns events, prefer these blocks so UI can show titles.
        if (includeSummaries === true) {
          try {
            const eventBlocks = await fetchEventBusyBlocks(accessToken, calendarItems)

            if (eventBlocks.length > 0) {
              sourceBusyBlocks.length = 0
              sourceBusyBlocks.push(...eventBlocks)
            }
          } catch (summaryErr) {
            console.error(`Failed to enrich busy summaries for source ${source.id}:`, safeErrorMessage(summaryErr))
          }
        }

        for (const block of sourceBusyBlocks) {
          allBusyBlocks.push({
            start: block.start,
            end: block.end,
            sourceId: source.id,
            color: source.color || '#6B7280',
            summary: block.summary,
          })
        }

        // Clear any previous sync error on success
        await supabaseAdmin
          .from('calendar_sources')
          .update({ sync_error: null, last_synced: new Date().toISOString() })
          .eq('id', source.id)
      } catch (err) {
        const errorMsg = (err instanceof Error && err.message) || 'Failed to fetch busy times'
        const needsReconnect = /re-authorize|refresh token|token.*fail|invalid_grant|insufficient authentication scopes|insufficient permissions?|permission denied/i.test(errorMsg)
        const userErrorMsg = needsReconnect
          ? 'Calendar authorization is missing required access -- reconnect this calendar in Settings.'
          : `Sync error: ${errorMsg}`
        console.error(`Failed to fetch busy times for source ${source.id}:`, errorMsg)

        // Persist sync error so it's visible in Settings and Calendar page
        await supabaseAdmin
          .from('calendar_sources')
          .update({ sync_error: userErrorMsg })
          .eq('id', source.id)

        sourceErrors.push({
          sourceId: source.id,
          displayName: source.display_name || source.google_email || source.id,
          error: userErrorMsg,
        })
        // Continue with other sources
      }
    }

    // ── Public URL sources: fetch & parse ICS feeds ──
    for (const source of publicUrlSources) {
      try {
        const icsRes = await fetchPublicCalendarUrl(source.public_url, {
          signal: AbortSignal.timeout(15_000), // 15s timeout to prevent slow-loris DoS
        })
        if (!icsRes.ok) {
          console.error(`Failed to fetch ICS for source ${source.id}: HTTP ${icsRes.status}`)
          continue
        }
        const icsText = await icsRes.text()
        const events = parseIcsEvents(icsText, rangeMin, rangeMax)
        for (const ev of events) {
          allBusyBlocks.push({
            start: ev.start,
            end: ev.end,
            sourceId: source.id,
            color: source.color || '#6B7280',
            summary: ev.summary,
          })
        }
      } catch (err) {
        console.error(`Failed to parse ICS for source ${source.id}:`, safeErrorMessage(err))
        // Continue with other sources
      }
    }

    res.json({ busyBlocks: allBusyBlocks, sourceErrors })
  } catch (err) {
    console.error('FreeBusy error:', err)
    res.status(500).json({ error: 'Failed to fetch busy times' })
  }
})

// ─── POST /api/calendar-sources/generate-meet-link ──────────
// Creates a real Google Meet conference link via the Google Calendar API.
// We create a temporary event with conferenceData, extract the Meet link,
// then immediately delete the temporary event.

router.post('/generate-meet-link', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sourceId } = req.body

    if (!sourceId || typeof sourceId !== 'string') {
      return res.status(400).json({ error: 'sourceId is required' })
    }

    // Verify the source belongs to the user and is google_oauth type
    const { data: source, error: srcError } = await supabaseAdmin
      .from('calendar_sources')
      .select('id, source_type, google_email, google_access_token, google_refresh_token, token_expires_at')
      .eq('id', sourceId)
      .eq('user_id', req.userId)
      .single()

    if (srcError || !source) {
      return res.status(404).json({ error: 'Calendar source not found' })
    }

    if (source.source_type !== 'google_oauth') {
      return res.status(400).json({ error: 'Only Google OAuth sources can generate Meet links' })
    }

    if (!source.google_access_token && !source.google_refresh_token) {
      return res.status(400).json({ error: 'Google tokens missing. Please reconnect your Google account.' })
    }

    let accessToken: string
    try {
      accessToken = await ensureFreshAccessToken(source)
    } catch (err) {
      return res.status(401).json({ error: `Token refresh failed: ${safeErrorMessage(err)}` })
    }

    // Create a temporary event with conference data to provision a Meet link
    const now = new Date()
    const tempEvent = {
      summary: 'Temporary — Meet Link Generation',
      start: { dateTime: now.toISOString(), timeZone: 'UTC' },
      end: { dateTime: new Date(now.getTime() + 15 * 60 * 1000).toISOString(), timeZone: 'UTC' },
      conferenceData: {
        createRequest: {
          requestId: `meet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    }

    const createRes = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/primary/events?conferenceDataVersion=1`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(tempEvent),
      },
    )

    const eventData = await createRes.json() as {
      id?: string
      error?: { message?: string }
      conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> }
    }

    if (!createRes.ok || eventData.error) {
      return res.status(502).json({
        error: eventData.error?.message || `Google Calendar API error (${createRes.status})`,
      })
    }

    // Extract the Meet link
    const videoEntry = eventData.conferenceData?.entryPoints?.find(
      (ep) => ep.entryPointType === 'video',
    )
    const meetLink = videoEntry?.uri

    if (!meetLink) {
      // Clean up the event even if Meet link wasn't generated
      if (eventData.id) {
        await fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events/${eventData.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        }).catch(() => {})
      }
      return res.status(502).json({ error: 'Google did not provision a Meet link. Please try again.' })
    }

    // Delete the temporary event — the Meet space persists independently
    if (eventData.id) {
      await fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events/${eventData.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => {})
    }

    res.json({ meetLink, googleEmail: source.google_email })
  } catch (err) {
    console.error('Generate Meet link error:', err)
    res.status(500).json({ error: 'Failed to generate Meet link' })
  }
})

export default router
