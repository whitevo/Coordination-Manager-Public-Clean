import { Router, Response } from 'express'
import { supabaseAdmin } from '../supabaseClient.js'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js'
import { safeErrorMessage } from '../middleware/validation.js'

const router: ReturnType<typeof Router> = Router()

// All routes require auth
router.use(authMiddleware)

// ─── GET /api/calendar-subscriptions ────────────────────────
// List all calendars the user is subscribed to (with calendar details)

router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('calendar_subscriptions')
      .select('id, calendar_id, created_at, calendars:calendar_id(id, hash, title, visibility)')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })

    if (error) return res.status(400).json({ error: safeErrorMessage(error) })
    res.json({ subscriptions: data || [] })
  } catch {
    res.status(500).json({ error: 'Failed to fetch subscriptions' })
  }
})

// ─── GET /api/calendar-subscriptions/check/:calendarHash ────
// Check if the current user is subscribed to a specific calendar

router.get('/check/:calendarHash', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { calendarHash } = req.params

    const { data: calendar } = await supabaseAdmin
      .from('calendars')
      .select('id')
      .eq('hash', calendarHash)
      .single()

    if (!calendar) return res.json({ subscribed: false })

    const { data } = await supabaseAdmin
      .from('calendar_subscriptions')
      .select('id')
      .eq('user_id', req.userId)
      .eq('calendar_id', calendar.id)
      .maybeSingle()

    res.json({ subscribed: !!data })
  } catch {
    res.status(500).json({ error: 'Failed to check subscription' })
  }
})

// ─── POST /api/calendar-subscriptions ───────────────────────
// Subscribe (follow) a Coordination Calendar
// Body: { calendar_hash: string }

router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { calendar_hash } = req.body
    if (!calendar_hash) return res.status(400).json({ error: 'calendar_hash is required' })

    // Find the calendar
    const { data: calendar, error: calErr } = await supabaseAdmin
      .from('calendars')
      .select('id, hash, title')
      .eq('hash', calendar_hash)
      .single()

    if (calErr || !calendar) return res.status(404).json({ error: 'Calendar not found' })

    // Upsert subscription (ignore if already exists)
    const { data, error } = await supabaseAdmin
      .from('calendar_subscriptions')
      .upsert(
        { user_id: req.userId, calendar_id: calendar.id },
        { onConflict: 'user_id,calendar_id', ignoreDuplicates: true }
      )
      .select('id, calendar_id, created_at')
      .single()

    if (error) return res.status(400).json({ error: safeErrorMessage(error) })

    // Sync Discord DM subscription status so the bot knows this user subscribed.
    // Two-pass update: first match by cm_user_id (populated when Discord was already linked),
    // then match by recipient_discord_id for rows where cm_user_id was null at invite time.
    try {
      const now = new Date().toISOString()

      // Pass 1: rows where cm_user_id is already linked
      await supabaseAdmin
        .from('dm_calendar_invites')
        .update({ status: 'subscribed', cm_user_id: req.userId, updated_at: now })
        .eq('calendar_id', calendar.id)
        .eq('cm_user_id', req.userId)
        .in('status', ['invited', 'unsubscribed'])

      // Pass 2: rows where cm_user_id is null but recipient_discord_id matches an active integration
      const { data: integrations } = await supabaseAdmin
        .from('discord_integrations')
        .select('discord_user_id')
        .eq('user_id', req.userId)
        .eq('is_active', true)

      const discordIds = (integrations || []).map((i: { discord_user_id: string }) => i.discord_user_id)
      if (discordIds.length > 0) {
        await supabaseAdmin
          .from('dm_calendar_invites')
          .update({ status: 'subscribed', cm_user_id: req.userId, updated_at: now })
          .eq('calendar_id', calendar.id)
          .in('recipient_discord_id', discordIds)
          .in('status', ['invited', 'unsubscribed'])
      }
    } catch {
      // Non-critical -- don't fail the web subscription
    }

    res.status(201).json({ subscription: data, calendar })
  } catch {
    res.status(500).json({ error: 'Failed to subscribe' })
  }
})

// ─── DELETE /api/calendar-subscriptions/:calendarHash ───────
// Unsubscribe (unfollow) a Coordination Calendar

router.delete('/:calendarHash', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { calendarHash } = req.params

    // Find the calendar
    const { data: calendar } = await supabaseAdmin
      .from('calendars')
      .select('id')
      .eq('hash', calendarHash)
      .single()

    if (!calendar) return res.status(404).json({ error: 'Calendar not found' })

    const { error } = await supabaseAdmin
      .from('calendar_subscriptions')
      .delete()
      .eq('user_id', req.userId)
      .eq('calendar_id', calendar.id)

    if (error) return res.status(400).json({ error: safeErrorMessage(error) })

    // Sync Discord DM subscription status so the bot knows this user unsubscribed.
    // Two-pass update: match by cm_user_id first, then by recipient_discord_id for
    // rows where cm_user_id was null at invite time.
    try {
      const now = new Date().toISOString()

      await supabaseAdmin
        .from('dm_calendar_invites')
        .update({ status: 'unsubscribed', cm_user_id: req.userId, updated_at: now })
        .eq('calendar_id', calendar.id)
        .eq('cm_user_id', req.userId)

      const { data: integrations } = await supabaseAdmin
        .from('discord_integrations')
        .select('discord_user_id')
        .eq('user_id', req.userId)
        .eq('is_active', true)

      const discordIds = (integrations || []).map((i: { discord_user_id: string }) => i.discord_user_id)
      if (discordIds.length > 0) {
        await supabaseAdmin
          .from('dm_calendar_invites')
          .update({ status: 'unsubscribed', cm_user_id: req.userId, updated_at: now })
          .eq('calendar_id', calendar.id)
          .in('recipient_discord_id', discordIds)
      }
    } catch {
      // Non-critical -- don't fail the web unsubscription
    }

    res.json({ message: 'Unsubscribed successfully' })
  } catch {
    res.status(500).json({ error: 'Failed to unsubscribe' })
  }
})

// ─── GET /api/calendar-subscriptions/meetings ───────────────
// Fetch all meetings from calendars the user is subscribed to
// (for displaying in Your Event Calendar)

router.get('/meetings', async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Get all calendar IDs the user is subscribed to
    const { data: subs, error: subErr } = await supabaseAdmin
      .from('calendar_subscriptions')
      .select('calendar_id')
      .eq('user_id', req.userId)

    if (subErr) return res.status(400).json({ error: safeErrorMessage(subErr) })
    if (!subs || subs.length === 0) return res.json({ meetings: [] })

    const calendarIds = subs.map(s => s.calendar_id)

    // Fetch calendar details
    const { data: calendars } = await supabaseAdmin
      .from('calendars')
      .select('id, hash, title')
      .in('id', calendarIds)

    const calMap = new Map((calendars || []).map(c => [c.id, c]))

    // Fetch meetings from all subscribed calendars
    const { data: meetings, error: meetErr } = await supabaseAdmin
      .from('meetings')
      .select('id, calendar_id, title, description, start_time, end_time, duration_minutes, meeting_link, created_at')
      .in('calendar_id', calendarIds)
      .order('start_time', { ascending: true })

    if (meetErr) return res.status(400).json({ error: safeErrorMessage(meetErr) })

    // meetings table uses plain TIMESTAMP (no tz); ensure UTC suffix
    const ensureUTC = (ts: string) =>
      ts && !ts.endsWith('Z') && !ts.includes('+') ? ts + 'Z' : ts

    const result = (meetings || []).map(m => {
      const cal = calMap.get(m.calendar_id)
      return {
        id: `sub_${m.id}`,
        calendar_id: m.calendar_id,
        calendar_hash: cal?.hash,
        calendar_title: cal?.title,
        title: m.title,
        description: m.description,
        start_time: ensureUTC(m.start_time),
        end_time: ensureUTC(m.end_time),
        duration_minutes: m.duration_minutes,
        meeting_link: m.meeting_link,
        created_at: m.created_at,
        source_type: 'subscription',
      }
    })

    res.json({ meetings: result })
  } catch {
    res.status(500).json({ error: 'Failed to fetch subscribed meetings' })
  }
})

export default router
