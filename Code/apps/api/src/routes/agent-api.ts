import { Router, Request, Response, NextFunction } from 'express'
import { supabaseAdmin } from '../supabaseClient.js'
import { sanitizeString, safeErrorMessage } from '../middleware/validation.js'
import { notifyParticipationChange } from '../services/calendar-notifications.js'

const router: ReturnType<typeof Router> = Router()

// ─── Agent API Key Authentication ──────────────────────────────────────────────
// Agents authenticate via a Bearer token in the Authorization header.
// The token is looked up in the `agent_api_keys` table (created by migration).
// Each key is scoped to a specific user_id (the coordination account owner).

interface AgentRequest extends Request {
  agentUserId?: string
  agentKeyId?: string
  agentName?: string
  agentScopes?: string[]
}

async function agentAuthMiddleware(
  req: AgentRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const authHeader = req.headers.authorization
    const apiKey = authHeader?.replace('Bearer ', '')

    if (!apiKey) {
      return res.status(401).json({ error: 'Missing API key. Use Authorization: Bearer <key>' })
    }

    // Look up the API key
    const { data: keyRecord, error } = await supabaseAdmin
      .from('agent_api_keys')
      .select('id, user_id, name, scopes, is_active, expires_at, ack_writes_at')
      .eq('api_key', apiKey)
      .eq('is_active', true)
      .maybeSingle()

    if (error || !keyRecord) {
      return res.status(401).json({ error: 'Invalid or inactive API key' })
    }

    // Check expiration
    if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
      return res.status(401).json({ error: 'API key has expired' })
    }

    // Ethics gate: write scopes are only honoured if the owner has acknowledged
    // write access for this key. If a key still has write:* scopes stored but no
    // ack timestamp (e.g. acknowledgement was revoked), downgrade to read-only
    // for this request rather than rejecting outright.
    const storedScopes: string[] = keyRecord.scopes || ['read']
    const effectiveScopes = keyRecord.ack_writes_at
      ? storedScopes
      : storedScopes.filter((s) => s === 'read')
    const safeScopes = effectiveScopes.length > 0 ? effectiveScopes : ['read']

    // Atomic per-key rate limiting (Postgres-backed). Replaces the prior
    // last_used_at update -- the RPC also bumps last_used_at internally.
    const { data: usage, error: usageErr } = await supabaseAdmin.rpc(
      'increment_agent_key_usage',
      { p_key_id: keyRecord.id },
    )

    if (usageErr) {
      // 'no_data_found' from the RPC means the key was deleted or deactivated
      // between the SELECT above and this call (TOCTOU). Treat as auth failure.
      if ((usageErr as { code?: string }).code === 'P0002' || /no_data_found|not found/i.test(usageErr.message || '')) {
        return res.status(401).json({ error: 'API key is no longer valid' })
      }
      console.error('Rate limit RPC failed:', usageErr)
      return res.status(500).json({ error: 'Rate limit check failed' })
    }

    const usageRow = Array.isArray(usage) ? usage[0] : usage
    // Defence in depth: the RPC raises if no row was updated, but if a future
    // change ever lets an empty result through, refuse rather than assume
    // unlimited quota.
    if (!usageRow || typeof usageRow.window_limit !== 'number' || typeof usageRow.new_count !== 'number') {
      return res.status(401).json({ error: 'API key is no longer valid' })
    }
    const newCount: number = usageRow.new_count
    const windowLimit: number = usageRow.window_limit
    const windowStart: string | undefined = usageRow.window_start

    res.setHeader('X-RateLimit-Limit', String(windowLimit))
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, windowLimit - newCount)))

    if (windowLimit > 0 && newCount > windowLimit) {
      // Compute retry-after in seconds until the current 24h window closes.
      let retryAfter = 60
      if (windowStart) {
        const windowEnd = new Date(windowStart).getTime() + 24 * 60 * 60 * 1000
        retryAfter = Math.max(1, Math.ceil((windowEnd - Date.now()) / 1000))
      }
      res.setHeader('Retry-After', String(retryAfter))
      return res.status(429).json({
        error: 'Daily request quota exceeded for this API key',
        limit: windowLimit,
        retryAfterSeconds: retryAfter,
      })
    }

    req.agentUserId = keyRecord.user_id
    req.agentKeyId = keyRecord.id
    req.agentName = keyRecord.name
    req.agentScopes = safeScopes

    next()
  } catch (err) {
    console.error('Agent auth error:', err)
    return res.status(500).json({ error: 'Authentication failed' })
  }
}

/**
 * Scope guard: checks that the agent's API key has the required scope.
 * Scopes: 'read', 'write:calendars', 'write:meetings', 'write:announcements', 'write:feedback'
 */
function requireScope(scope: string) {
  return (req: AgentRequest, res: Response, next: NextFunction) => {
    if (!req.agentScopes?.includes(scope) && !req.agentScopes?.includes('*')) {
      return res.status(403).json({
        error: `Insufficient scope. Required: '${scope}'. Your key has: [${req.agentScopes?.join(', ')}]`,
      })
    }
    next()
  }
}

// All routes require agent authentication
router.use(agentAuthMiddleware)

// ─── GET /api/agent/me — Agent key info ────────────────────────────────────────
router.get('/me', (req: AgentRequest, res: Response) => {
  return res.json({
    agentKeyId: req.agentKeyId,
    agentName: req.agentName,
    userId: req.agentUserId,
    scopes: req.agentScopes,
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// READ ENDPOINTS (scope: 'read')
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/agent/calendars — List user's calendars ──────────────────────────
router.get('/calendars', requireScope('read'), async (req: AgentRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('calendars')
      .select('id, hash, title, visibility, config, created_at, updated_at')
      .eq('created_by', req.agentUserId!)
      .order('created_at', { ascending: false })

    if (error) return res.status(400).json({ error: safeErrorMessage(error) })

    // Flatten config JSONB into top-level fields for agent convenience
    const calendars = (data || []).map((cal: Record<string, unknown>) => {
      const config = (cal.config || {}) as Record<string, unknown>
      return {
        id: cal.id,
        hash: cal.hash,
        title: cal.title,
        visibility: cal.visibility,
        start_date: config.customStartDate || null,
        end_date: config.customEndDate || null,
        start_hour: config.startHour ?? 8,
        end_hour: config.endHour ?? 18,
        time_interval: config.timeInterval ?? 30,
        timezone: config.timezone || 'UTC',
        created_at: cal.created_at,
        updated_at: cal.updated_at,
      }
    })

    return res.json({ calendars })
  } catch {
    return res.status(500).json({ error: 'Failed to fetch calendars' })
  }
})

// ─── GET /api/agent/calendars/:hash — Get calendar details ─────────────────────
router.get('/calendars/:hash', requireScope('read'), async (req: AgentRequest, res: Response) => {
  try {
    const { data: calendar, error } = await supabaseAdmin
      .from('calendars')
      .select('*')
      .eq('hash', req.params.hash)
      .single()

    if (error || !calendar) {
      return res.status(404).json({ error: 'Calendar not found' })
    }

    // Only allow reading own calendars or public ones
    if (calendar.created_by !== req.agentUserId && calendar.visibility !== 'public') {
      return res.status(403).json({ error: 'Access denied to this calendar' })
    }

    // Flatten config JSONB into top-level fields for agent convenience
    const config = (calendar.config || {}) as Record<string, unknown>
    return res.json({
      calendar: {
        id: calendar.id,
        hash: calendar.hash,
        title: calendar.title,
        visibility: calendar.visibility,
        start_date: config.customStartDate || null,
        end_date: config.customEndDate || null,
        start_hour: config.startHour ?? 8,
        end_hour: config.endHour ?? 18,
        time_interval: config.timeInterval ?? 30,
        timezone: config.timezone || 'UTC',
        created_at: calendar.created_at,
        updated_at: calendar.updated_at,
      },
    })
  } catch {
    return res.status(500).json({ error: 'Failed to fetch calendar' })
  }
})

// ─── GET /api/agent/calendars/:hash/availability — Get availability submissions ─
router.get('/calendars/:hash/availability', requireScope('read'), async (req: AgentRequest, res: Response) => {
  try {
    const { data: calendar } = await supabaseAdmin
      .from('calendars')
      .select('id, created_by, visibility')
      .eq('hash', req.params.hash)
      .single()

    if (!calendar) return res.status(404).json({ error: 'Calendar not found' })
    if (calendar.created_by !== req.agentUserId && calendar.visibility !== 'public') {
      return res.status(403).json({ error: 'Access denied' })
    }

    const { data, error } = await supabaseAdmin
      .from('availability')
      .select('id, username, time_slots, created_at, updated_at')
      .eq('calendar_id', calendar.id)
      .order('created_at', { ascending: false })

    if (error) return res.status(400).json({ error: safeErrorMessage(error) })
    return res.json({ availability: data || [] })
  } catch {
    return res.status(500).json({ error: 'Failed to fetch availability' })
  }
})

// ─── POST /api/agent/calendars/:hash/availability — Submit availability ────────
// Allows agents to submit time availability on behalf of a user.
// time_slots is an array of strings in "YYYY-MM-DD_HH:MM" format.
router.post('/calendars/:hash/availability', requireScope('write:calendars'), async (req: AgentRequest, res: Response) => {
  try {
    const { data: calendar } = await supabaseAdmin
      .from('calendars')
      .select('id, created_by, visibility, config')
      .eq('hash', req.params.hash)
      .single()

    if (!calendar) return res.status(404).json({ error: 'Calendar not found' })

    // Allow submitting to own calendars or public ones
    if (calendar.created_by !== req.agentUserId && calendar.visibility !== 'public') {
      return res.status(403).json({ error: 'Access denied to this calendar' })
    }

    const { username, time_slots } = req.body

    const cleanUsername = sanitizeString(username, 100)
    if (!cleanUsername) {
      return res.status(400).json({ error: 'username is required (string, max 100 chars)' })
    }
    if (!time_slots || !Array.isArray(time_slots) || time_slots.length === 0) {
      return res.status(400).json({
        error: 'time_slots is required (array of strings in "YYYY-MM-DD_HH:MM" format, e.g. ["2026-03-10_13:00", "2026-03-10_13:30"])',
      })
    }

    // Hard cap on number of slots per submission. A year of 15-minute slots
    // 24/7 is ~35k -- 5000 covers any realistic working-hours calendar and
    // prevents a single quota-counted request from inflating storage.
    if (time_slots.length > 5000) {
      return res.status(400).json({
        error: 'time_slots exceeds maximum of 5000 entries per submission',
      })
    }

    // Validate time_slots format
    const slotPattern = /^\d{4}-\d{2}-\d{2}_\d{2}:\d{2}$/
    const invalidSlots = time_slots.filter((s: string) => !slotPattern.test(s))
    if (invalidSlots.length > 0) {
      return res.status(400).json({
        error: `Invalid time_slots format. Expected "YYYY-MM-DD_HH:MM". Invalid entries: ${invalidSlots.slice(0, 3).join(', ')}`,
      })
    }

    // Upsert availability (insert or update if username already exists for this calendar)
    const { data: previous } = await supabaseAdmin
      .from('availability')
      .select('time_slots')
      .eq('calendar_id', calendar.id)
      .eq('username', cleanUsername)
      .maybeSingle()

    const { data, error } = await supabaseAdmin
      .from('availability')
      .upsert(
        {
          calendar_id: calendar.id,
          username: cleanUsername,
          time_slots,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'calendar_id,username' },
      )
      .select()
      .single()

    if (error) return res.status(400).json({ error: safeErrorMessage(error) })

    notifyParticipationChange({
      calendar,
      participantName: cleanUsername,
      before: previous?.time_slots,
      after: time_slots,
      actor: { userId: req.agentUserId },
    })

    return res.status(201).json({
      availability: data,
      note: `Availability for "${cleanUsername}" saved with ${time_slots.length} time slot(s).`,
    })
  } catch {
    return res.status(500).json({ error: 'Failed to submit availability' })
  }
})

// ─── GET /api/agent/calendars/:hash/meetings — Get meetings ───────────────────
router.get('/calendars/:hash/meetings', requireScope('read'), async (req: AgentRequest, res: Response) => {
  try {
    const { data: calendar } = await supabaseAdmin
      .from('calendars')
      .select('id, created_by, visibility')
      .eq('hash', req.params.hash)
      .single()

    if (!calendar) return res.status(404).json({ error: 'Calendar not found' })
    if (calendar.created_by !== req.agentUserId && calendar.visibility !== 'public') {
      return res.status(403).json({ error: 'Access denied' })
    }

    const { data, error } = await supabaseAdmin
      .from('meetings')
      .select('*')
      .eq('calendar_id', calendar.id)
      .order('start_time', { ascending: true })

    if (error) return res.status(400).json({ error: safeErrorMessage(error) })
    return res.json({ meetings: data || [] })
  } catch {
    return res.status(500).json({ error: 'Failed to fetch meetings' })
  }
})

// ─── GET /api/agent/calendar-sources — List integrated calendar sources ───────
// Returns the user's connected Google Calendar sources (OAuth and public URL).
// Agents can use source IDs to query events from those calendars.
router.get('/calendar-sources', requireScope('read'), async (req: AgentRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('calendar_sources')
      .select('id, source_type, google_email, public_url, display_name, color, is_active, last_synced, sync_error, created_at')
      .eq('user_id', req.agentUserId!)
      .order('created_at', { ascending: true })

    if (error) return res.status(400).json({ error: safeErrorMessage(error) })
    return res.json({ sources: data || [] })
  } catch {
    return res.status(500).json({ error: 'Failed to fetch calendar sources' })
  }
})

// ─── GET /api/agent/calendar-sources/events — Read events from integrated calendars
// Fetches actual calendar events (with titles, times, etc.) from the user's
// connected Google Calendar sources within a given date range.
// This is read-only — agents cannot create events on Google Calendar.
router.get('/calendar-sources/events', requireScope('read'), async (req: AgentRequest, res: Response) => {
  try {
    const timeMin = req.query.timeMin as string
    const timeMax = req.query.timeMax as string
    const sourceId = req.query.sourceId as string | undefined

    if (!timeMin || !timeMax) {
      return res.status(400).json({
        error: 'timeMin and timeMax query parameters are required (ISO 8601 format, e.g. 2026-03-09T00:00:00Z)',
      })
    }

    // Fetch user's calendar sources
    let sourceQuery = supabaseAdmin
      .from('calendar_sources')
      .select('id, source_type, google_email, public_url, display_name, color, google_access_token, google_refresh_token, token_expires_at')
      .eq('user_id', req.agentUserId!)
      .eq('is_active', true)

    if (sourceId) {
      sourceQuery = sourceQuery.eq('id', sourceId)
    }

    const { data: sources, error: srcError } = await sourceQuery
    if (srcError) return res.status(400).json({ error: safeErrorMessage(srcError) })

    if (!sources || sources.length === 0) {
      return res.json({
        events: [],
        note: sourceId
          ? 'Calendar source not found or inactive.'
          : 'No active calendar sources. The user must connect a Google Calendar via Settings first.',
      })
    }

    const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
    const allEvents: Array<{
      source_id: string
      source_name: string
      google_email?: string
      summary: string
      description?: string
      start: string
      end: string
      location?: string
      html_link?: string
      status?: string
    }> = []

    const sourceErrors: Array<{ source_id: string; display_name: string; error: string }> = []

    // Process OAuth sources — use Google Calendar Events List API
    const oauthSources = sources.filter(s => s.source_type === 'google_oauth' && (s.google_access_token || s.google_refresh_token))
    for (const source of oauthSources) {
      try {
        // Refresh token if needed
        let accessToken = source.google_access_token
        if (!accessToken || (source.token_expires_at && Date.now() >= new Date(source.token_expires_at).getTime() - 5 * 60 * 1000)) {
          if (!source.google_refresh_token) {
            sourceErrors.push({ source_id: source.id, display_name: source.display_name, error: 'No refresh token — user must re-authorize' })
            continue
          }
          const clientId = process.env.GOOGLE_CLIENT_ID
          const clientSecret = process.env.GOOGLE_CLIENT_SECRET
          if (!clientId || !clientSecret) {
            sourceErrors.push({ source_id: source.id, display_name: source.display_name, error: 'Google OAuth not configured on server' })
            continue
          }
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
          const tokenData = await tokenRes.json() as { access_token?: string; expires_in?: number; error?: string; error_description?: string }
          if (!tokenRes.ok || tokenData.error) {
            sourceErrors.push({ source_id: source.id, display_name: source.display_name, error: tokenData.error_description || 'Token refresh failed — user must re-authorize' })
            continue
          }
          accessToken = tokenData.access_token!
          // Persist refreshed token
          await supabaseAdmin
            .from('calendar_sources')
            .update({
              google_access_token: accessToken,
              token_expires_at: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString(),
            })
            .eq('id', source.id)
        }

        // Fetch events from primary calendar
        const params = new URLSearchParams({
          timeMin,
          timeMax,
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '100',
        })
        const eventsRes = await fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events?${params}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        const eventsData = await eventsRes.json() as {
          items?: Array<{
            summary?: string
            description?: string
            start?: { dateTime?: string; date?: string }
            end?: { dateTime?: string; date?: string }
            location?: string
            htmlLink?: string
            status?: string
          }>
          error?: { message: string }
        }

        if (!eventsRes.ok || eventsData.error) {
          sourceErrors.push({ source_id: source.id, display_name: source.display_name, error: eventsData.error?.message || 'Failed to fetch events' })
          continue
        }

        for (const ev of eventsData.items || []) {
          if (ev.status === 'cancelled') continue
          allEvents.push({
            source_id: source.id,
            source_name: source.display_name,
            google_email: source.google_email,
            summary: ev.summary || '(No title)',
            description: ev.description || undefined,
            start: ev.start?.dateTime || ev.start?.date || '',
            end: ev.end?.dateTime || ev.end?.date || '',
            location: ev.location || undefined,
            html_link: ev.htmlLink || undefined,
            status: ev.status || undefined,
          })
        }
      } catch (err) {
        sourceErrors.push({ source_id: source.id, display_name: source.display_name, error: safeErrorMessage(err) })
      }
    }

    // Process public URL (ICS) sources — parse ICS feed
    const publicSources = sources.filter(s => s.source_type === 'google_public_url' && s.public_url)
    for (const source of publicSources) {
      try {
        const icsRes = await fetch(source.public_url)
        if (!icsRes.ok) {
          sourceErrors.push({ source_id: source.id, display_name: source.display_name, error: `HTTP ${icsRes.status}` })
          continue
        }
        const icsText = await icsRes.text()
        // Simple ICS parsing for VEVENT blocks within the time range
        const rangeMin = new Date(timeMin).getTime()
        const rangeMax = new Date(timeMax).getTime()
        // Use a regex-based lightweight parser for ICS events
        const eventBlocks = icsText.split('BEGIN:VEVENT').slice(1)
        for (const block of eventBlocks) {
          const getProp = (name: string): string | undefined => {
            const match = block.match(new RegExp(`${name}[^:]*:(.+)`, 'i'))
            return match ? match[1].trim() : undefined
          }
          const dtStart = getProp('DTSTART')
          const dtEnd = getProp('DTEND')
          const summary = getProp('SUMMARY')
          if (!dtStart) continue

          // Parse date (handles both YYYYMMDDTHHMMSSZ and YYYY-MM-DD formats)
          const parseIcsDt = (dt: string): Date | null => {
            try {
              const clean = dt.replace(/[^\dTZ]/g, '')
              if (clean.length >= 15) {
                return new Date(`${clean.slice(0,4)}-${clean.slice(4,6)}-${clean.slice(6,8)}T${clean.slice(9,11)}:${clean.slice(11,13)}:${clean.slice(13,15)}Z`)
              } else if (clean.length >= 8) {
                return new Date(`${clean.slice(0,4)}-${clean.slice(4,6)}-${clean.slice(6,8)}`)
              }
              return null
            } catch { return null }
          }

          const startDate = parseIcsDt(dtStart)
          const endDate = dtEnd ? parseIcsDt(dtEnd) : null
          if (!startDate || startDate.getTime() > rangeMax || (endDate && endDate.getTime() < rangeMin)) continue

          allEvents.push({
            source_id: source.id,
            source_name: source.display_name,
            summary: summary || '(No title)',
            description: getProp('DESCRIPTION') || undefined,
            start: startDate.toISOString(),
            end: endDate ? endDate.toISOString() : startDate.toISOString(),
            location: getProp('LOCATION') || undefined,
          })
        }
      } catch (err) {
        sourceErrors.push({ source_id: source.id, display_name: source.display_name, error: safeErrorMessage(err) })
      }
    }

    // Sort all events by start time
    allEvents.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())

    return res.json({
      events: allEvents,
      total: allEvents.length,
      timeMin,
      timeMax,
      ...(sourceErrors.length > 0 ? { sourceErrors } : {}),
    })
  } catch {
    return res.status(500).json({ error: 'Failed to fetch calendar source events' })
  }
})

// ─── GET /api/agent/announcements/templates — List templates ───────────────────
router.get('/announcements/templates', requireScope('read'), async (req: AgentRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('announcement_templates')
      .select('id, title, body, is_poll, poll_options, created_at, updated_at')
      .eq('user_id', req.agentUserId!)
      .order('updated_at', { ascending: false })

    if (error) return res.status(400).json({ error: safeErrorMessage(error) })
    return res.json({ templates: data || [] })
  } catch {
    return res.status(500).json({ error: 'Failed to fetch templates' })
  }
})

// ─── GET /api/agent/discord/servers — List Discord servers and channels ────────
// Returns the servers (guilds) the user has connected, with their channels
// that are available for announcement distribution.
router.get('/discord/servers', requireScope('read'), async (req: AgentRequest, res: Response) => {
  try {
    // Find the user's active Discord integration
    const { data: integration } = await supabaseAdmin
      .from('discord_integrations')
      .select('id, discord_user_id, discord_username')
      .eq('user_id', req.agentUserId!)
      .eq('is_active', true)
      .eq('bot_verified', true)
      .maybeSingle()

    if (!integration?.discord_user_id) {
      return res.json({
        servers: [],
        note: 'No active Discord integration. The user must link Discord via the web UI first.',
      })
    }

    // Get all channels the bot can see for this user
    const { data: channels, error } = await supabaseAdmin
      .from('discord_guild_channels')
      .select('guild_id, guild_name, guild_icon, channel_id, channel_name, is_active, bot_can_send')
      .eq('user_id', req.agentUserId!)
      .eq('integration_id', integration.id)
      .order('guild_name')
      .order('channel_name')

    if (error) return res.status(400).json({ error: safeErrorMessage(error) })

    // Group channels by guild
    const guildsMap = new Map<string, {
      guild_id: string
      guild_name: string
      channels: Array<{
        channel_id: string
        channel_name: string
        is_active: boolean
        bot_can_send: boolean
      }>
    }>()

    for (const ch of channels || []) {
      if (!guildsMap.has(ch.guild_id)) {
        guildsMap.set(ch.guild_id, {
          guild_id: ch.guild_id,
          guild_name: ch.guild_name,
          channels: [],
        })
      }
      guildsMap.get(ch.guild_id)!.channels.push({
        channel_id: ch.channel_id,
        channel_name: ch.channel_name,
        is_active: ch.is_active,
        bot_can_send: ch.bot_can_send ?? true,
      })
    }

    return res.json({ servers: Array.from(guildsMap.values()) })
  } catch {
    return res.status(500).json({ error: 'Failed to fetch Discord servers' })
  }
})

// ─── GET /api/agent/discord/members — List DM-eligible members ────────────────
// Returns members from shared guilds who can receive DM announcements.
// Members who have opted out of DMs are flagged accordingly.
router.get('/discord/members', requireScope('read'), async (req: AgentRequest, res: Response) => {
  try {
    // Find the user's active Discord integration
    const { data: integration } = await supabaseAdmin
      .from('discord_integrations')
      .select('id, discord_user_id')
      .eq('user_id', req.agentUserId!)
      .eq('is_active', true)
      .eq('bot_verified', true)
      .maybeSingle()

    if (!integration?.discord_user_id) {
      return res.json({
        members: [],
        note: 'No active Discord integration. The user must link Discord via the web UI first.',
      })
    }

    // Call the bot's internal API to get DM-eligible members
    const botApiUrl = process.env.BOT_API_URL || 'http://localhost:3002'
    const botSecret = process.env.BOT_API_SECRET

    if (!botSecret) {
      return res.json({
        members: [],
        note: 'Bot API not configured on this server. DM member listing is unavailable.',
      })
    }

    const botResponse = await fetch(`${botApiUrl}/list-dm-members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bot-secret': botSecret,
      },
      body: JSON.stringify({ discordUserId: integration.discord_user_id }),
    })

    if (!botResponse.ok || !botResponse.body) {
      return res.json({
        members: [],
        note: 'Could not reach bot service to list members.',
      })
    }

    // Parse the SSE stream from the bot to collect all members
    const text = await botResponse.text()
    const lines = text.split('\n')
    let members: Array<{
      user_id: string
      username: string
      display_name: string
      guild_names?: string[]
    }> = []

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      try {
        const event = JSON.parse(line.slice(6))
        if (event.type === 'done' && event.members) {
          members = event.members
        }
      } catch { /* skip malformed SSE lines */ }
    }

    // Enrich with opt-out status
    const { data: optOuts } = await supabaseAdmin
      .from('dm_opt_outs')
      .select('recipient_discord_id')
      .or(`sender_user_id.eq.${req.agentUserId},sender_user_id.is.null`)

    const optedOutIds = new Set((optOuts || []).map((o: { recipient_discord_id: string }) => o.recipient_discord_id))

    const enrichedMembers = members.map(m => ({
      user_id: m.user_id,
      username: m.username,
      display_name: m.display_name,
      guild_names: m.guild_names || [],
      opted_out: optedOutIds.has(m.user_id),
    }))

    return res.json({ members: enrichedMembers })
  } catch {
    return res.status(500).json({ error: 'Failed to fetch Discord members' })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// WRITE ENDPOINTS — Create draft resources (human approves/distributes)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── POST /api/agent/calendars — Create a coordination calendar ────────────────
router.post('/calendars', requireScope('write:calendars'), async (req: AgentRequest, res: Response) => {
  try {
    const {
      title, start_date, end_date,
      start_hour = 8, end_hour = 18, time_interval = 30,
      timezone = 'UTC', visibility = 'unlisted',
    } = req.body

    if (!title) return res.status(400).json({ error: 'title is required' })

    // Generate a unique hash
    const hash = Math.random().toString(36).substring(2, 10) + Date.now().toString(36)

    // Pack calendar settings into the config JSONB (consistent with web UI)
    const config: Record<string, unknown> = {
      startHour: start_hour,
      endHour: end_hour,
      timeInterval: time_interval,
      timezone,
      eventName: title,
    }
    if (start_date) config.customStartDate = start_date
    if (end_date) config.customEndDate = end_date

    const { data, error } = await supabaseAdmin
      .from('calendars')
      .insert([{
        hash,
        title,
        config,
        created_by: req.agentUserId,
        visibility,
      }])
      .select()
      .single()

    if (error) return res.status(400).json({ error: safeErrorMessage(error) })

    // Return a flattened view for the agent
    return res.status(201).json({
      calendar: {
        id: data.id,
        hash: data.hash,
        title: data.title,
        visibility: data.visibility,
        start_date: config.customStartDate || null,
        end_date: config.customEndDate || null,
        start_hour: config.startHour,
        end_hour: config.endHour,
        time_interval: config.timeInterval,
        timezone: config.timezone,
        created_at: data.created_at,
        updated_at: data.updated_at,
      },
      shareUrl: `/calendar/${data.hash}`,
    })
  } catch {
    return res.status(500).json({ error: 'Failed to create calendar' })
  }
})

// ─── POST /api/agent/calendars/:hash/meetings — Create a meeting (draft) ──────
// NOTE: The meeting is created but importing/exporting and distribution
// requires human intervention via the web UI. The agent can prepare the data.
router.post('/calendars/:hash/meetings', requireScope('write:meetings'), async (req: AgentRequest, res: Response) => {
  try {
    const { data: calendar } = await supabaseAdmin
      .from('calendars')
      .select('id, created_by')
      .eq('hash', req.params.hash)
      .single()

    if (!calendar) return res.status(404).json({ error: 'Calendar not found' })
    if (calendar.created_by !== req.agentUserId) {
      return res.status(403).json({ error: 'Only the calendar owner can create meetings' })
    }

    const { title, description, start_time, end_time, duration_minutes, meeting_link, time_slots } = req.body

    if (!title || !start_time || !end_time || !duration_minutes) {
      return res.status(400).json({ error: 'Missing required fields: title, start_time, end_time, duration_minutes' })
    }

    // Auto-generate time_slots from start_time if not provided
    // The web UI stores time_slots as ["YYYY-MM-DDTHH:MM"]
    let resolvedTimeSlots = time_slots
    if (!resolvedTimeSlots || !Array.isArray(resolvedTimeSlots) || resolvedTimeSlots.length === 0) {
      const startDt = new Date(start_time)
      const dateStr = startDt.toISOString().slice(0, 10)
      const timeStr = startDt.toISOString().slice(11, 16)
      resolvedTimeSlots = [`${dateStr}T${timeStr}`]
    }

    const { data, error } = await supabaseAdmin
      .from('meetings')
      .insert([{
        calendar_id: calendar.id,
        title,
        description: description || '',
        start_time,
        end_time,
        duration_minutes,
        meeting_link: meeting_link || '',
        created_by: req.agentUserId,
        time_slots: resolvedTimeSlots,
      }])
      .select()
      .single()

    if (error) return res.status(400).json({ error: safeErrorMessage(error) })
    return res.status(201).json({
      meeting: data,
      note: 'Meeting created as draft. Importing/exporting and distribution require human action via the web UI.',
    })
  } catch {
    return res.status(500).json({ error: 'Failed to create meeting' })
  }
})

// ─── POST /api/agent/announcements/templates — Create announcement template ───
// NOTE: Agents can prepare announcement templates but CANNOT send them.
// The human must review and click "Send" in the web UI.
router.post('/announcements/templates', requireScope('write:announcements'), async (req: AgentRequest, res: Response) => {
  try {
    const { title, body, is_poll = false, poll_options = [] } = req.body

    if (!body) return res.status(400).json({ error: 'body is required' })

    // Sanitize inputs to prevent injection and oversized payloads
    const safeTitle = typeof title === 'string' ? title.trim().slice(0, 200) : ''
    const safeBody = typeof body === 'string' ? body.trim().slice(0, 1800) : ''
    if (!safeBody) return res.status(400).json({ error: 'body must be a non-empty string' })
    if (typeof is_poll !== 'boolean') return res.status(400).json({ error: 'is_poll must be a boolean' })
    if (!Array.isArray(poll_options) || poll_options.length > 25) {
      return res.status(400).json({ error: 'poll_options must be an array with at most 25 items' })
    }
    const safePollOptions = poll_options
      .filter((opt: unknown) => typeof opt === 'string')
      .map((opt: string) => opt.trim().slice(0, 200))

    const { data, error } = await supabaseAdmin
      .from('announcement_templates')
      .insert([{
        user_id: req.agentUserId,
        title: safeTitle,
        body: safeBody,
        is_poll,
        poll_options: safePollOptions,
      }])
      .select()
      .single()

    if (error) return res.status(400).json({ error: safeErrorMessage(error) })
    return res.status(201).json({
      template: data,
      note: 'Template created. Distribution (channel/DM targeting and sending) is handled by the human in the web UI.',
    })
  } catch {
    return res.status(500).json({ error: 'Failed to create template' })
  }
})

// ─── PUT /api/agent/announcements/templates/:id — Update an existing template ──
// Agents can update templates they own (title, body, poll settings).
// Distribution settings (channels, DMs) are NOT part of the template —
// they are chosen by the human when sending via the web UI.
router.put('/announcements/templates/:id', requireScope('write:announcements'), async (req: AgentRequest, res: Response) => {
  try {
    const { id } = req.params

    // Verify the template belongs to this user
    const { data: existing } = await supabaseAdmin
      .from('announcement_templates')
      .select('id, user_id')
      .eq('id', id)
      .eq('user_id', req.agentUserId!)
      .maybeSingle()

    if (!existing) {
      return res.status(404).json({ error: 'Template not found or not owned by this API key holder' })
    }

    const updates: Record<string, unknown> = {}
    if (req.body.title !== undefined) {
      if (typeof req.body.title !== 'string') return res.status(400).json({ error: 'title must be a string' })
      updates.title = req.body.title.trim().slice(0, 200)
    }
    if (req.body.body !== undefined) {
      if (typeof req.body.body !== 'string') return res.status(400).json({ error: 'body must be a string' })
      updates.body = req.body.body.trim().slice(0, 1800)
    }
    if (req.body.is_poll !== undefined) {
      if (typeof req.body.is_poll !== 'boolean') return res.status(400).json({ error: 'is_poll must be a boolean' })
      updates.is_poll = req.body.is_poll
    }
    if (req.body.poll_options !== undefined) {
      if (!Array.isArray(req.body.poll_options) || req.body.poll_options.length > 25) {
        return res.status(400).json({ error: 'poll_options must be an array with at most 25 items' })
      }
      updates.poll_options = req.body.poll_options
        .filter((opt: unknown) => typeof opt === 'string')
        .map((opt: string) => opt.trim().slice(0, 200))
    }
    updates.updated_at = new Date().toISOString()

    if (Object.keys(updates).length <= 1) {
      return res.status(400).json({ error: 'No fields to update. Provide at least one of: title, body, is_poll, poll_options' })
    }

    const { data, error } = await supabaseAdmin
      .from('announcement_templates')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) return res.status(400).json({ error: safeErrorMessage(error) })
    return res.json({
      template: data,
      note: 'Template updated. Distribution (channel/DM targeting and sending) is handled by the human in the web UI.',
    })
  } catch {
    return res.status(500).json({ error: 'Failed to update template' })
  }
})

// ─── DELETE /api/agent/announcements/templates/:id — Delete a template ─────────
router.delete('/announcements/templates/:id', requireScope('write:announcements'), async (req: AgentRequest, res: Response) => {
  try {
    const { id } = req.params

    const { data, error } = await supabaseAdmin
      .from('announcement_templates')
      .delete()
      .eq('id', id)
      .eq('user_id', req.agentUserId!)
      .select()
      .single()

    if (error || !data) {
      return res.status(404).json({ error: 'Template not found or not owned by this API key holder' })
    }

    return res.json({ message: 'Template deleted', template: data })
  } catch {
    return res.status(500).json({ error: 'Failed to delete template' })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// FEEDBACK ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

const FEEDBACK_MAX_LENGTH = 2000

// ─── GET /api/agent/feedback — List feedback submitted by this agent ──────────
router.get('/feedback', requireScope('read'), async (req: AgentRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20))
    const offset = (page - 1) * limit
    const statusFilter = req.query.status as string | undefined

    let query = supabaseAdmin
      .from('feedback')
      .select('id, message, category, source, status, created_at, updated_at', { count: 'exact' })
      .eq('user_id', req.agentUserId!)
      .eq('source', 'agent')
      .order('created_at', { ascending: false })

    if (statusFilter) {
      query = query.eq('status', statusFilter)
    }

    const { data, error, count } = await query.range(offset, offset + limit - 1)

    if (error) return res.status(400).json({ error: safeErrorMessage(error) })
    return res.json({ feedback: data || [], total: count || 0, page, limit })
  } catch {
    return res.status(500).json({ error: 'Failed to fetch feedback' })
  }
})

// ─── POST /api/agent/feedback — Submit feedback on behalf of the user ─────────
router.post('/feedback', requireScope('write:feedback'), async (req: AgentRequest, res: Response) => {
  try {
    const rawMessage = req.body.message
    if (!rawMessage || typeof rawMessage !== 'string') {
      return res.status(400).json({ error: 'message is required (string, max 2000 chars)' })
    }

    const message = rawMessage.trim().slice(0, FEEDBACK_MAX_LENGTH)
    if (!message) {
      return res.status(400).json({ error: 'message must not be empty' })
    }

    const category = req.body.category || 'general'

    const { data, error } = await supabaseAdmin
      .from('feedback')
      .insert({
        user_id: req.agentUserId!,
        message,
        category,
        source: 'agent',
      })
      .select()
      .single()

    if (error) {
      console.error('Agent feedback INSERT failed:', { code: error.code, message: error.message, agentName: req.agentName })
      return res.status(400).json({ error: safeErrorMessage(error) })
    }

    return res.status(201).json({
      feedback: data,
      note: 'Feedback submitted. An admin will review it.',
    })
  } catch {
    return res.status(500).json({ error: 'Failed to submit feedback' })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// CLOUD SETUP DISCOVERY (scope: 'read')
// ═══════════════════════════════════════════════════════════════════════════════
//
// GET /api/agent/setup/:componentId
//
// Returns sanitized cloud-side configuration values for the requesting
// browser's Setup page. The goal is *visual confirmation* that the cloud
// instance is alive and what URLs it advertises -- never to exfiltrate the
// secret values themselves.
//
// Rules:
//   * Public/URL-shaped values (NODE_ENV, FRONTEND_URL, SUPABASE_URL, ...)
//     are returned literally so the browser can ping them.
//   * Secret-bearing values (anon key, service role key, JWT secret, ...)
//     are NEVER returned. If the cloud has them set, the value is replaced
//     with the literal string `(keys secured)`. If unset, the field is
//     omitted entirely.
//   * Only `deployment` and `database` are currently exposed. Other
//     component IDs return 404 so the browser shows "cloud does not expose
//     this component" -- which is the correct, secure default.
//
// This endpoint requires the `read` scope. It does not consult per-user
// state; it reports the cloud instance's own environment configuration.

/**
 * Resolve the public API URL this cloud instance advertises.
 *
 * Order of preference:
 *   1. PUBLIC_API_URL env var (operator-set, authoritative)
 *   2. The request's own origin (X-Forwarded-Proto + Host, since the API
 *      typically sits behind a reverse proxy in production). This is a
 *      sensible fallback so the Setup page never shows "VITE_API_URL: (not
 *      set)" when the operator simply forgot to configure PUBLIC_API_URL.
 */
function resolveCloudApiUrl(req: AgentRequest): string | undefined {
  if (process.env.PUBLIC_API_URL) return process.env.PUBLIC_API_URL
  const host = req.get('host')
  if (!host) return undefined
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim()
  return `${proto}://${host}`
}

const CLOUD_SETUP_COMPONENTS: Record<string, (req: AgentRequest) => Record<string, string>> = {
  deployment: (req) => {
    const out: Record<string, string> = {}
    if (process.env.NODE_ENV) out.NODE_ENV = process.env.NODE_ENV
    if (process.env.PORT) out.PORT = process.env.PORT
    if (process.env.FRONTEND_URL) out.FRONTEND_URL = process.env.FRONTEND_URL
    // VITE_API_URL lives in the web app, not the API process; advertise the
    // cloud's public origin (falling back to the current request origin)
    // so the browser still gets a useful value.
    const apiUrl = resolveCloudApiUrl(req)
    if (apiUrl) out.VITE_API_URL = apiUrl
    return out
  },
  database: () => {
    const out: Record<string, string> = {}
    if (process.env.SUPABASE_URL) out.SUPABASE_URL = process.env.SUPABASE_URL
    if (process.env.SUPABASE_KEY) out.SUPABASE_KEY = '(keys secured)'
    if (process.env.SUPABASE_SECRET_KEY_LOCALHOST) out.SUPABASE_SECRET_KEY_LOCALHOST = '(keys secured)'
    if (process.env.SUPABASE_SECRET_KEY_PRODUCTION) out.SUPABASE_SECRET_KEY_PRODUCTION = '(keys secured)'
    return out
  },
}

// GET /api/agent/setup/summary
//
// One-shot read used by the Setup page's "Production is served by the
// Swarm API" panel. Returns:
//   - agentName / scopes      (identity confirmation)
//   - frontendUrl / apiUrl    (public addresses, for the address tiles)
//   - databaseUrl             (public SUPABASE_URL; secret keys never leak)
//   - components[]            (every component the cloud exposes, with
//                              its sanitized values inlined so the
//                              browser can render a coverage checklist
//                              without a follow-up round-trip per card)
//
// MUST be declared before the '/setup/:componentId' route below, otherwise
// the parameterised route would match 'summary' as the componentId and
// always 404.
router.get('/setup/summary', requireScope('read'), (req: AgentRequest, res: Response) => {
  const components = Object.entries(CLOUD_SETUP_COMPONENTS).map(([id, builder]) => {
    const values = builder(req)
    return { id, covered: Object.keys(values).length > 0, values }
  })
  return res.json({
    agentName: req.agentName,
    scopes: req.agentScopes || [],
    frontendUrl: process.env.FRONTEND_URL || undefined,
    apiUrl: resolveCloudApiUrl(req),
    databaseUrl: process.env.SUPABASE_URL || undefined,
    components,
  })
})

router.get('/setup/:componentId', requireScope('read'), (req: AgentRequest, res: Response) => {
  const componentId = sanitizeString(req.params.componentId, 64)
  if (!componentId) {
    return res.status(400).json({ error: 'componentId is required' })
  }
  const builder = CLOUD_SETUP_COMPONENTS[componentId]
  if (!builder) {
    return res.status(404).json({
      message: `The cloud does not currently expose "${componentId}" via the agent API.`,
    })
  }
  return res.json({
    componentId,
    agentName: req.agentName,
    values: builder(req),
  })
})

// ─── GET /api/agent/openapi.json — OpenAPI spec for agent discovery ────────────
router.get('/openapi.json', (_req: Request, res: Response) => {
  return res.json({
    openapi: '3.0.3',
    info: {
      title: 'Coordination Manager Agent API',
      version: '1.0.0',
      description: 'API for AI agents and uAgents to interact with the Coordination Manager. Agents can read calendars, availability, meetings, announcement templates, and feedback. Write operations create draft resources that require human approval for distribution.',
    },
    servers: [
      { url: '/api/agent', description: 'Agent API base' },
    ],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Agent API key from the Coordination Manager settings',
        },
      },
    },
    paths: {
      '/me': {
        get: { summary: 'Get agent key info', tags: ['Auth'] },
      },
      '/calendars': {
        get: { summary: 'List calendars owned by the API key holder', tags: ['Calendars'] },
        post: { summary: 'Create a coordination calendar', tags: ['Calendars'] },
      },
      '/calendars/{hash}': {
        get: { summary: 'Get calendar details by hash', tags: ['Calendars'] },
      },
      '/calendars/{hash}/availability': {
        get: { summary: 'Get availability submissions for a calendar', tags: ['Availability'] },
        post: { summary: 'Submit time availability for a user on a calendar (time_slots: ["YYYY-MM-DD_HH:MM", ...])', tags: ['Availability'] },
      },
      '/calendars/{hash}/meetings': {
        get: { summary: 'List meetings for a calendar', tags: ['Meetings'] },
        post: { summary: 'Create a meeting draft (time_slots auto-generated from start_time if omitted)', tags: ['Meetings'] },
      },
      '/calendar-sources': {
        get: { summary: 'List integrated calendar sources (Google Calendar connections)', tags: ['Calendar Sources'] },
      },
      '/calendar-sources/events': {
        get: { summary: 'Read events from integrated Google Calendars (read-only). Params: timeMin, timeMax (ISO 8601), optional sourceId', tags: ['Calendar Sources'] },
      },
      '/announcements/templates': {
        get: { summary: 'List announcement templates', tags: ['Announcements'] },
        post: { summary: 'Create an announcement template draft (fields: title, body, is_poll, poll_options). Distribution to Discord channels/DMs is done by the human in the web UI.', tags: ['Announcements'] },
      },
      '/announcements/templates/{id}': {
        put: { summary: 'Update an existing announcement template (title, body, is_poll, poll_options). Channel/DM targeting is NOT part of the template — it is chosen when sending via the web UI.', tags: ['Announcements'] },
        delete: { summary: 'Delete an announcement template by ID', tags: ['Announcements'] },
      },
      '/discord/servers': {
        get: { summary: 'List Discord servers and channels available for distribution', tags: ['Discord'] },
      },
      '/discord/members': {
        get: { summary: 'List DM-eligible members from shared Discord servers', tags: ['Discord'] },
      },
      '/feedback': {
        get: { summary: 'List feedback submitted by this agent', tags: ['Feedback'] },
        post: { summary: 'Submit feedback on behalf of the API key holder', tags: ['Feedback'] },
      },
      '/setup/{componentId}': {
        get: { summary: 'Read sanitized cloud setup values for a Setup-page component (deployment, database). Secret values are returned as the literal string "(keys secured)" -- never the real key.', tags: ['Setup'] },
      },
      '/setup/summary': {
        get: { summary: 'One-shot read of every cloud-covered Setup component, plus advertised frontend and API URLs. Used by the Setup page "Production is served by the Swarm API" panel.', tags: ['Setup'] },
      },
    },
  })
})

export default router
