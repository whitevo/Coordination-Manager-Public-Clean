import { Router, Response, NextFunction } from 'express'
import { supabaseAdmin } from '../supabaseClient.js'
import { authMiddleware, AuthenticatedRequest, hasMfaAssurance, hasRole } from '../middleware/auth.js'
import { sanitizeUUID, safeErrorMessage } from '../middleware/validation.js'
import { getCaptchaStatus, setCaptchaOverride, getSignupTimestamps } from '../services/signup-rate-tracker.js'

const router: ReturnType<typeof Router> = Router()

// All admin routes require authentication
router.use(authMiddleware)

/** Guard: reject non-admin users */
function requireAdmin(req: AuthenticatedRequest, res: Response): boolean {
  if (!hasRole(req, 'admin')) {
    res.status(403).json({ error: 'Admin role required' })
    return false
  }
  if (!hasMfaAssurance(req)) {
    res.status(403).json({
      error: 'ADMIN_MFA_REQUIRED',
      message: 'Admin actions require a current multi-factor authenticated session.',
      statusCode: 403,
    })
    return false
  }
  return true
}

// ─── GET /api/admin/users — List all users ───────────────────────────

router.get('/users', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireAdmin(req, res)) return

  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 100))
    const from = (page - 1) * limit
    const to = from + limit - 1

    const { data: users, error, count } = await supabaseAdmin
      .from('users')
      .select('id, email, display_name, avatar_url, roles, account_type, wallet_address, stake_address, traveler_name, theme_preferences, is_silenced, silenced_at, silenced_by, created_at, last_login_at, signup_source', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to)

    if (error) {
      return res.status(500).json({ error: safeErrorMessage(error) })
    }

    res.json({ users: users || [], total: count ?? 0, page, limit })
  } catch (err) {
    next(err)
  }
})

// ─── POST /api/admin/users/silence — Silence users ──────────────────

router.post('/users/silence', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireAdmin(req, res)) return

  try {
    const { userIds } = req.body
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'userIds array is required' })
    }

    // Validate every ID is a proper UUID
    const validatedIds = userIds.map((id: unknown) => sanitizeUUID(id))
    if (validatedIds.some((id: string | null) => id === null)) {
      return res.status(400).json({ error: 'One or more userIds are not valid UUIDs' })
    }

    // Prevent admin from silencing themselves
    if (validatedIds.includes(req.userId ?? null)) {
      return res.status(400).json({ error: 'Cannot silence your own account' })
    }

    // Prevent silencing other admins
    const { data: targetUsers } = await supabaseAdmin
      .from('users')
      .select('id, roles')
      .in('id', userIds)

    const adminTargets = (targetUsers || []).filter(u => {
      const roles = Array.isArray(u.roles) ? u.roles : []
      return roles.includes('admin')
    })

    if (adminTargets.length > 0) {
      return res.status(400).json({ error: 'Cannot silence admin accounts' })
    }

    const now = new Date().toISOString()

    // Silence the users
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({
        is_silenced: true,
        silenced_at: now,
        silenced_by: req.userId,
      })
      .in('id', validatedIds)

    if (updateError) {
      return res.status(500).json({ error: safeErrorMessage(updateError) })
    }

    // Make all their public calendars unlisted
    const { error: calError } = await supabaseAdmin
      .from('calendars')
      .update({ visibility: 'unlisted' })
      .in('created_by', validatedIds)
      .eq('visibility', 'public')

    if (calError) {
      console.error('Failed to unlist silenced user calendars:', calError)
    }

    res.json({ success: true, silencedCount: validatedIds.length })
  } catch (err) {
    next(err)
  }
})

// ─── POST /api/admin/users/unsilence — Unsilence users ──────────────

router.post('/users/unsilence', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireAdmin(req, res)) return

  try {
    const { userIds } = req.body
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'userIds array is required' })
    }

    // Validate every ID is a proper UUID
    const validatedIds = userIds.map((id: unknown) => sanitizeUUID(id))
    if (validatedIds.some((id: string | null) => id === null)) {
      return res.status(400).json({ error: 'One or more userIds are not valid UUIDs' })
    }

    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({
        is_silenced: false,
        silenced_at: null,
        silenced_by: null,
      })
      .in('id', validatedIds)

    if (updateError) {
      return res.status(500).json({ error: safeErrorMessage(updateError) })
    }

    res.json({ success: true, unsilencedCount: validatedIds.length })
  } catch (err) {
    next(err)
  }
})

// ─── POST /api/admin/users/moderator — Toggle moderator role for a user ─

router.post('/users/moderator', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireAdmin(req, res)) return

  try {
    const { userId, enabled } = req.body
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'userId (string) is required' })
    }
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled (boolean) is required' })
    }

    // Fetch current roles
    const { data: userData, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('roles')
      .eq('id', userId)
      .single()

    if (fetchError || !userData) {
      return res.status(404).json({ error: 'User not found' })
    }

    const currentRoles: string[] = Array.isArray(userData.roles) ? userData.roles : ['user']

    let newRoles: string[]
    if (enabled) {
      newRoles = currentRoles.includes('moderator') ? currentRoles : [...currentRoles, 'moderator']
    } else {
      newRoles = currentRoles.filter(r => r !== 'moderator')
    }

    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ roles: newRoles })
      .eq('id', userId)

    if (updateError) {
      return res.status(500).json({ error: safeErrorMessage(updateError) })
    }

    res.json({ success: true, userId, roles: newRoles })
  } catch (err) {
    next(err)
  }
})

// ─── DELETE /api/admin/calendars/:hash — Admin force-delete a calendar ─

// ─── POST /api/admin/moderator-overlay — Toggle moderator role for admin ─

router.post('/moderator-overlay', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireAdmin(req, res)) return

  try {
    const { enabled } = req.body
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled (boolean) is required' })
    }

    // Fetch current roles
    const { data: userData, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('roles')
      .eq('id', req.userId)
      .single()

    if (fetchError || !userData) {
      return res.status(500).json({ error: 'Failed to fetch user roles' })
    }

    const currentRoles: string[] = Array.isArray(userData.roles) ? userData.roles : ['user']

    let newRoles: string[]
    if (enabled) {
      // Add moderator if not present
      newRoles = currentRoles.includes('moderator') ? currentRoles : [...currentRoles, 'moderator']
    } else {
      // Remove moderator
      newRoles = currentRoles.filter(r => r !== 'moderator')
    }

    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ roles: newRoles })
      .eq('id', req.userId)

    if (updateError) {
      return res.status(500).json({ error: safeErrorMessage(updateError) })
    }

    res.json({ success: true, roles: newRoles })
  } catch (err) {
    next(err)
  }
})

// ─── DELETE /api/admin/calendars/:hash — Admin force-delete a calendar ─

router.delete('/calendars/:hash', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireAdmin(req, res)) return

  try {
    const { hash } = req.params

    const { data: calendar, error: fetchError } = await supabaseAdmin
      .from('calendars')
      .select('id, hash, title')
      .eq('hash', hash)
      .single()

    if (fetchError || !calendar) {
      return res.status(404).json({ error: 'Calendar not found' })
    }

    const { error: deleteError } = await supabaseAdmin
      .from('calendars')
      .delete()
      .eq('hash', hash)

    if (deleteError) {
      return res.status(500).json({ error: safeErrorMessage(deleteError) })
    }

    res.json({ success: true, message: `Calendar "${calendar.title}" deleted` })
  } catch (err) {
    next(err)
  }
})

// ═══════════════════════════════════════════════════════════════════════
// Platform Oversight endpoints
// ═══════════════════════════════════════════════════════════════════════

// ─── GET /api/admin/oversight/account-log — Account creation timeline ─

router.get('/oversight/account-log', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireAdmin(req, res)) return

  try {
    const excludeLocalhost = String(req.query.excludeLocalhost || '').toLowerCase() === 'true'

    let accountQuery = supabaseAdmin
      .from('users')
      .select('id, email, display_name, account_type, roles, traveler_name, wallet_address, signup_source, created_at')
      .order('created_at', { ascending: false })
      .limit(500)

    if (excludeLocalhost) {
      accountQuery = accountQuery.neq('signup_source', 'localhost')
    }

    const { data: accounts, error } = await accountQuery

    if (error) return res.status(500).json({ error: safeErrorMessage(error) })

    // Build daily histogram for the last 30 days
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const dailyCounts: Record<string, number> = {}
    for (let d = new Date(thirtyDaysAgo); d <= now; d.setDate(d.getDate() + 1)) {
      dailyCounts[d.toISOString().slice(0, 10)] = 0
    }
    for (const u of accounts || []) {
      const day = (u.created_at || '').slice(0, 10)
      if (day in dailyCounts) dailyCounts[day]++
    }

    // In-memory signup timestamps from rate tracker
    const recentTimestamps = getSignupTimestamps()

    res.json({
      accounts: accounts || [],
      dailyCounts,
      recentSignupTimestamps: recentTimestamps,
    })
  } catch (err) {
    next(err)
  }
})

// ─── GET /api/admin/oversight/captcha — Captcha status + override info ─

router.get('/oversight/captcha', async (req: AuthenticatedRequest, res: Response) => {
  if (!requireAdmin(req, res)) return
  res.json(getCaptchaStatus())
})

// ─── POST /api/admin/oversight/captcha — Set captcha override ─────────

router.post('/oversight/captcha', async (req: AuthenticatedRequest, res: Response) => {
  if (!requireAdmin(req, res)) return

  const { mode } = req.body
  if (!['on', 'off', 'auto'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be "on", "off", or "auto"' })
  }

  // Reject force-on / auto when captcha is unavailable (keys missing or
  // explicitly disabled in Setup). "off" is always allowed.
  if (mode !== 'off') {
    const status = getCaptchaStatus()
    if (!status.available) {
      return res.status(409).json({
        error: 'CAPTCHA_UNAVAILABLE',
        message: status.unavailableReason === 'disabled'
          ? 'Captcha is disabled in Setup on this machine.'
          : 'Captcha keys are not configured. Set TURNSTILE_SECRET_KEY in Setup.',
        unavailableReason: status.unavailableReason,
      })
    }
  }

  setCaptchaOverride(mode)
  res.json({ success: true, ...getCaptchaStatus() })
})

// ─── GET /api/admin/oversight/health-signals — Platform activity stats ─

router.get('/oversight/health-signals', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireAdmin(req, res)) return

  try {
    const excludeLocalhost = String(req.query.excludeLocalhost || '').toLowerCase() === 'true'
    const now = new Date()
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    const usersTotalQuery = supabaseAdmin.from('users').select('id', { count: 'exact', head: true })
    const users24hQuery = supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).gte('created_at', oneDayAgo.toISOString())
    const users7dQuery = supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo.toISOString())
    const users30dQuery = supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).gte('created_at', thirtyDaysAgo.toISOString())

    const deletionsTotalQuery = supabaseAdmin.from('account_deletion_events').select('id', { count: 'exact', head: true })
    const deletions24hQuery = supabaseAdmin.from('account_deletion_events').select('id', { count: 'exact', head: true }).gte('deleted_at', oneDayAgo.toISOString())
    const deletions7dQuery = supabaseAdmin.from('account_deletion_events').select('id', { count: 'exact', head: true }).gte('deleted_at', sevenDaysAgo.toISOString())
    const deletions30dQuery = supabaseAdmin.from('account_deletion_events').select('id', { count: 'exact', head: true }).gte('deleted_at', thirtyDaysAgo.toISOString())

    if (excludeLocalhost) {
      usersTotalQuery.neq('signup_source', 'localhost')
      users24hQuery.neq('signup_source', 'localhost')
      users7dQuery.neq('signup_source', 'localhost')
      users30dQuery.neq('signup_source', 'localhost')

      deletionsTotalQuery.neq('signup_source', 'localhost')
      deletions24hQuery.neq('signup_source', 'localhost')
      deletions7dQuery.neq('signup_source', 'localhost')
      deletions30dQuery.neq('signup_source', 'localhost')
    }

    // Run all queries in parallel for speed
    const [
      calendarsTotal,
      calendars24h,
      calendars7d,
      calendars30d,
      meetingsTotal,
      meetings24h,
      meetings7d,
      meetings30d,
      availTotal,
      avail24h,
      avail7d,
      avail30d,
      usersTotal,
      users24h,
      users7d,
      users30d,
      deletionsTotal,
      deletions24h,
      deletions7d,
      deletions30d,
      announcementsTotal,
      announcements24h,
      announcements7d,
      announcements30d,
      feedbackTotal,
      feedback24h,
      feedback7d,
      feedback30d,
    ] = await Promise.all([
      // Calendars
      supabaseAdmin.from('calendars').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('calendars').select('id', { count: 'exact', head: true }).gte('created_at', oneDayAgo.toISOString()),
      supabaseAdmin.from('calendars').select('id', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo.toISOString()),
      supabaseAdmin.from('calendars').select('id', { count: 'exact', head: true }).gte('created_at', thirtyDaysAgo.toISOString()),
      // Meetings (participations)
      supabaseAdmin.from('meetings').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('meetings').select('id', { count: 'exact', head: true }).gte('created_at', oneDayAgo.toISOString()),
      supabaseAdmin.from('meetings').select('id', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo.toISOString()),
      supabaseAdmin.from('meetings').select('id', { count: 'exact', head: true }).gte('created_at', thirtyDaysAgo.toISOString()),
      // Availability responses
      supabaseAdmin.from('availability').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('availability').select('id', { count: 'exact', head: true }).gte('created_at', oneDayAgo.toISOString()),
      supabaseAdmin.from('availability').select('id', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo.toISOString()),
      supabaseAdmin.from('availability').select('id', { count: 'exact', head: true }).gte('created_at', thirtyDaysAgo.toISOString()),
      // Users
      usersTotalQuery,
      users24hQuery,
      users7dQuery,
      users30dQuery,
      // Account deletions
      deletionsTotalQuery,
      deletions24hQuery,
      deletions7dQuery,
      deletions30dQuery,
      // Announcements
      supabaseAdmin.from('announcements').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('announcements').select('id', { count: 'exact', head: true }).gte('created_at', oneDayAgo.toISOString()),
      supabaseAdmin.from('announcements').select('id', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo.toISOString()),
      supabaseAdmin.from('announcements').select('id', { count: 'exact', head: true }).gte('created_at', thirtyDaysAgo.toISOString()),
      // Feedback
      supabaseAdmin.from('feedback').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('feedback').select('id', { count: 'exact', head: true }).gte('created_at', oneDayAgo.toISOString()),
      supabaseAdmin.from('feedback').select('id', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo.toISOString()),
      supabaseAdmin.from('feedback').select('id', { count: 'exact', head: true }).gte('created_at', thirtyDaysAgo.toISOString()),
    ])

    res.json({
      calendars: {
        total: calendarsTotal.count ?? 0,
        last24h: calendars24h.count ?? 0,
        last7d: calendars7d.count ?? 0,
        last30d: calendars30d.count ?? 0,
      },
      meetings: {
        total: meetingsTotal.count ?? 0,
        last24h: meetings24h.count ?? 0,
        last7d: meetings7d.count ?? 0,
        last30d: meetings30d.count ?? 0,
      },
      availability: {
        total: availTotal.count ?? 0,
        last24h: avail24h.count ?? 0,
        last7d: avail7d.count ?? 0,
        last30d: avail30d.count ?? 0,
      },
      users: {
        total: usersTotal.count ?? 0,
        last24h: users24h.count ?? 0,
        last7d: users7d.count ?? 0,
        last30d: users30d.count ?? 0,
      },
      accountDeletions: {
        total: deletionsTotal.count ?? 0,
        last24h: deletions24h.count ?? 0,
        last7d: deletions7d.count ?? 0,
        last30d: deletions30d.count ?? 0,
      },
      announcements: {
        total: announcementsTotal.count ?? 0,
        last24h: announcements24h.count ?? 0,
        last7d: announcements7d.count ?? 0,
        last30d: announcements30d.count ?? 0,
      },
      feedback: {
        total: feedbackTotal.count ?? 0,
        last24h: feedback24h.count ?? 0,
        last7d: feedback7d.count ?? 0,
        last30d: feedback30d.count ?? 0,
      },
    })
  } catch (err) {
    next(err)
  }
})

// ─── GET /api/admin/oversight/interaction-timeseries — Daily interaction counts ─

router.get('/oversight/interaction-timeseries', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireAdmin(req, res)) return

  try {
    const days = Math.min(90, Math.max(7, parseInt(req.query.days as string) || 30))
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    const excludeLocalhost = String(req.query.excludeLocalhost || '').toLowerCase() === 'true'

    const usersQuery = supabaseAdmin.from('users').select('created_at').gte('created_at', since)
    const deletionsQuery = supabaseAdmin.from('account_deletion_events').select('deleted_at').gte('deleted_at', since)

    if (excludeLocalhost) {
      usersQuery.neq('signup_source', 'localhost')
      deletionsQuery.neq('signup_source', 'localhost')
    }

    // Fetch raw created_at timestamps for each entity type in parallel
    const [calendarsRes, meetingsRes, availRes, usersRes, announcementsRes, feedbackRes, deletionsRes] = await Promise.all([
      supabaseAdmin.from('calendars').select('created_at').gte('created_at', since),
      supabaseAdmin.from('meetings').select('created_at').gte('created_at', since),
      supabaseAdmin.from('availability').select('created_at').gte('created_at', since),
      usersQuery,
      supabaseAdmin.from('announcements').select('created_at').gte('created_at', since),
      supabaseAdmin.from('feedback').select('created_at').gte('created_at', since),
      deletionsQuery,
    ])

    // Build date -> count maps for each category
    const buildDailyCounts = (rows: { created_at: string }[] | null): Record<string, number> => {
      const counts: Record<string, number> = {}
      for (const row of rows || []) {
        const day = (row.created_at || '').slice(0, 10)
        if (day) counts[day] = (counts[day] || 0) + 1
      }
      return counts
    }

    const calCounts = buildDailyCounts(calendarsRes.data)
    const meetCounts = buildDailyCounts(meetingsRes.data)
    const availCounts = buildDailyCounts(availRes.data)
    const userCounts = buildDailyCounts(usersRes.data)
    const annCounts = buildDailyCounts(announcementsRes.data)
    const fbCounts = buildDailyCounts(feedbackRes.data)
    const deletionCounts = buildDailyCounts(
      (deletionsRes.data || []).map((row: { deleted_at: string }) => ({ created_at: row.deleted_at }))
    )

    // Build ordered array of daily data points
    const today = new Date()
    const series: {
      date: string
      calendars: number
      meetings: number
      availability: number
      users: number
      announcements: number
      feedback: number
      account_deletions: number
    }[] = []

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000)
      const key = d.toISOString().slice(0, 10)
      series.push({
        date: key,
        calendars: calCounts[key] || 0,
        meetings: meetCounts[key] || 0,
        availability: availCounts[key] || 0,
        users: userCounts[key] || 0,
        announcements: annCounts[key] || 0,
        feedback: fbCounts[key] || 0,
        account_deletions: deletionCounts[key] || 0,
      })
    }

    res.json({ series, days })
  } catch (err) {
    next(err)
  }
})

export default router
