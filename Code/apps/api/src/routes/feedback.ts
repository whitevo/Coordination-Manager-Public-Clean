import { Router, Response } from 'express'
import { supabaseAdmin } from '../supabaseClient.js'
import { authMiddleware, AuthenticatedRequest, hasRole } from '../middleware/auth.js'
import { sanitizeString, sanitizeUUID, safeErrorMessage } from '../middleware/validation.js'

const router: ReturnType<typeof Router> = Router()

// All routes require authentication
router.use(authMiddleware)

const FEEDBACK_MAX_LENGTH = 2000
const VALID_CATEGORIES = ['general', 'bug', 'feature', 'support', 'other'] as const

// Attachment validation constants
const MAX_ATTACHMENTS = 3
// 1.5 MB as a base64 string is roughly 2MB of base64 characters (each 3 bytes -> 4 chars)
const MAX_ATTACHMENT_B64_LENGTH = 2_097_152 // ~1.5 MB base64
const ALLOWED_IMAGE_PREFIXES = ['data:image/jpeg;base64,', 'data:image/png;base64,', 'data:image/gif;base64,', 'data:image/webp;base64,']

/** Validate an array of base64 image data URLs. Returns an error string or null. */
function validateAttachments(attachments: unknown): string | null {
  if (!Array.isArray(attachments)) return 'attachments must be an array'
  if (attachments.length > MAX_ATTACHMENTS) return `Maximum ${MAX_ATTACHMENTS} attachments allowed`
  for (const item of attachments) {
    if (typeof item !== 'string') return 'Each attachment must be a base64 data URL string'
    if (!ALLOWED_IMAGE_PREFIXES.some(p => item.startsWith(p))) {
      return 'Attachments must be JPEG, PNG, GIF, or WebP images'
    }
    if (item.length > MAX_ATTACHMENT_B64_LENGTH) return 'Each attachment must be under 1.5 MB'
  }
  return null
}
const VALID_STATUSES = ['open', 'reviewed', 'resolved', 'dismissed', 'affirmed'] as const
const DEFAULT_STATUS_ORDER = ['open', 'reviewed', 'affirmed', 'resolved', 'dismissed'] as const

interface FeedbackRow {
  status: string
  created_at: string
  users?: { display_name?: string | null; email?: string | null; avatar_url?: string | null } | null
  feedback_responses?: Array<{
    id: string
    admin_id: string
    message: string
    created_at: string
    users?: { display_name?: string | null; avatar_url?: string | null } | null
  }>
  [key: string]: unknown
}

// ─── GET /api/feedback — List feedback ────────────────────────────────────────
// Admins see all feedback; regular users see only their own.

/** Build a feedback query with the given select fields and apply user/status filters. */
function buildFeedbackQuery(
  selectFields: string,
  isAdmin: boolean,
  userId: string,
  discordUserId: string | null,
  statusFilter: string | undefined,
  categoryFilter: string | undefined,
) {
  let query = supabaseAdmin
    .from('feedback')
    .select(selectFields, { count: 'exact' })

  if (!isAdmin) {
    if (discordUserId) {
      query = query.or(`user_id.eq.${userId},discord_user_id.eq.${discordUserId}`)
    } else {
      query = query.eq('user_id', userId)
    }
  }

  if (statusFilter && (VALID_STATUSES as readonly string[]).includes(statusFilter)) {
    query = query.eq('status', statusFilter)
  }

  if (categoryFilter && (VALID_CATEGORIES as readonly string[]).includes(categoryFilter)) {
    query = query.eq('category', categoryFilter)
  } else if (categoryFilter === '!support') {
    // Exclude support category (used by general feedback tab)
    query = query.neq('category', 'support')
  }

  return query
}

router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const isAdmin = hasRole(req, 'admin')
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20))
    const offset = (page - 1) * limit
    const statusFilter = req.query.status as string | undefined
    const categoryFilter = req.query.category as string | undefined

    // Parse custom status order from query param (JSON array) or fall back to default
    let statusOrder: string[] = [...DEFAULT_STATUS_ORDER]
    if (req.query.statusOrder) {
      try {
        const parsed = JSON.parse(req.query.statusOrder as string)
        if (Array.isArray(parsed) && parsed.every((s: unknown) => typeof s === 'string' && (VALID_STATUSES as readonly string[]).includes(s as string))) {
          statusOrder = parsed
        }
      } catch { /* use default */ }
    }

    // Look up Discord link once (used for non-admin filter)
    let discordUserId: string | null = null
    if (!isAdmin) {
      const { data: integration } = await supabaseAdmin
        .from('discord_integrations')
        .select('discord_user_id')
        .eq('user_id', req.userId!)
        .eq('is_active', true)
        .maybeSingle()
      discordUserId = integration?.discord_user_id || null
    }

    const orderedStatuses = statusFilter && (VALID_STATUSES as readonly string[]).includes(statusFilter)
      ? [statusFilter]
      : statusOrder

    const countByStatus: Record<string, number> = {}
    for (const status of orderedStatuses) {
      const countQuery = buildFeedbackQuery('id', isAdmin, req.userId!, discordUserId, status, categoryFilter)
      const { count: statusCount } = await countQuery
      countByStatus[status] = statusCount || 0
    }

    const total = orderedStatuses.reduce((sum, status) => sum + (countByStatus[status] || 0), 0)

    // ── Try the full query with user profiles + threaded responses ──
    const fullSelect = '*, users!user_id(display_name, email, avatar_url), feedback_responses(id, admin_id, message, created_at, users!admin_id(display_name, avatar_url))'
    const simpleSelect = '*, users!user_id(display_name, email, avatar_url)'
    const pageStart = offset
    let remainingSkip = pageStart
    let remainingTake = limit
    const paginatedData: FeedbackRow[] = []
    let usedFallbackSelect = false

    for (const status of orderedStatuses) {
      const statusCount = countByStatus[status] || 0
      if (remainingSkip >= statusCount) {
        remainingSkip -= statusCount
        continue
      }

      const statusOffset = remainingSkip
      const statusTake = Math.min(remainingTake, statusCount - statusOffset)
      if (statusTake <= 0) {
        remainingSkip = 0
        continue
      }

      let query = buildFeedbackQuery(fullSelect, isAdmin, req.userId!, discordUserId, status, categoryFilter)
      query = query.order('created_at', { ascending: false })
      let result = await query.range(statusOffset, statusOffset + statusTake - 1)

      if (result.error) {
        if (!usedFallbackSelect) {
          console.error('Feedback query with embeds failed, retrying without feedback_responses:', result.error.message)
          usedFallbackSelect = true
        }
        let fallbackQuery = buildFeedbackQuery(simpleSelect, isAdmin, req.userId!, discordUserId, status, categoryFilter)
        fallbackQuery = fallbackQuery.order('created_at', { ascending: false })
        result = await fallbackQuery.range(statusOffset, statusOffset + statusTake - 1)
      }

      if (result.error) throw result.error

      const statusRows = (result.data as unknown as FeedbackRow[] | null) || []
      paginatedData.push(...statusRows)
      remainingTake -= statusRows.length
      remainingSkip = 0

      if (remainingTake <= 0) break
    }

    // Warn if the query returned 0 rows — may indicate RLS / service-role-key issue
    if (paginatedData.length === 0 && isAdmin) {
      console.warn('Feedback GET returned 0 rows for admin - if feedback exists in the DB, check the environment-selected SUPABASE_SECRET_KEY_LOCALHOST / SUPABASE_SECRET_KEY_PRODUCTION.')
    }

    // Flatten user join into top-level fields
    const feedback = paginatedData.map((item) => ({
      ...item,
      user_display_name: item.users?.display_name || null,
      user_email: item.users?.email || null,
      user_avatar_url: item.users?.avatar_url || null,
      users: undefined,
      feedback_responses: (item.feedback_responses || [])
        .map((r) => ({
          id: r.id,
          admin_id: r.admin_id,
          message: r.message,
          created_at: r.created_at,
          admin_display_name: r.users?.display_name || null,
          admin_avatar_url: r.users?.avatar_url || null,
        }))
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    }))

    // Fetch the user's saved status order so the UI can initialise
    let savedStatusOrder: string[] | null = null
    try {
      const { data: userRow } = await supabaseAdmin
        .from('users')
        .select('feedback_status_order')
        .eq('id', req.userId!)
        .single()
      savedStatusOrder = userRow?.feedback_status_order || null
    } catch { /* non-critical */ }

    // Fetch per-status counts (unfiltered by status, but respecting user/category scope)
    const statusCounts: Record<string, number> = { open: 0, reviewed: 0 }
    try {
      for (const st of ['open', 'reviewed'] as const) {
        const countQuery = buildFeedbackQuery('id', isAdmin, req.userId!, discordUserId, st, categoryFilter)
        const { count: stCount } = await countQuery
        statusCounts[st] = stCount || 0
      }
    } catch { /* non-critical -- counts default to 0 */ }

    res.json({
      feedback,
      total,
      page,
      limit,
      isAdmin,
      statusOrder,
      savedStatusOrder,
      statusCounts: {
        open: countByStatus.open || 0,
        reviewed: countByStatus.reviewed || 0,
      },
    })
  } catch (err) {
    console.error('Feedback GET error:', err instanceof Error ? err.message : err)
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── POST /api/feedback — Submit feedback from web ────────────────────────────

router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const message = sanitizeString(req.body.message, FEEDBACK_MAX_LENGTH)
    const category = req.body.category || 'general'
    const attachments: string[] = Array.isArray(req.body.attachments) ? req.body.attachments : []

    if (!message) {
      return res.status(400).json({ error: 'message is required (max 2000 chars)' })
    }

    if (!(VALID_CATEGORIES as readonly string[]).includes(category)) {
      return res.status(400).json({ error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` })
    }

    if (attachments.length > 0) {
      const attachErr = validateAttachments(attachments)
      if (attachErr) return res.status(400).json({ error: attachErr })
    }

    const { data, error } = await supabaseAdmin
      .from('feedback')
      .insert({
        user_id: req.userId!,
        message,
        category,
        source: 'web',
        attachments: attachments.length > 0 ? attachments : [],
      })
      .select()
      .single()

    if (error) {
      console.error('Feedback INSERT failed:', { code: error.code, message: error.message, details: error.details, hint: error.hint, userId: req.userId })
      throw error
    }

    res.status(201).json({ feedback: data })
  } catch (err) {
    console.error('Feedback POST error:', err instanceof Error ? err.message : err)
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── PATCH /api/feedback/:id — Admin update (status, response) ────────────────

router.patch('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!hasRole(req, 'admin')) {
      return res.status(403).json({ error: 'Admin access required' })
    }

    const { id } = req.params
    const updates: Record<string, unknown> = {}

    if (req.body.status) {
      if (!(VALID_STATUSES as readonly string[]).includes(req.body.status)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` })
      }
      updates.status = req.body.status
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' })
    }

    const { data, error } = await supabaseAdmin
      .from('feedback')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    res.json({ feedback: data })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── POST /api/feedback/:id/responses — Admin reply to feedback ───────────────

router.post('/:id/responses', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!hasRole(req, 'admin')) {
      return res.status(403).json({ error: 'Admin access required' })
    }

    const { id } = req.params
    const message = sanitizeString(req.body.message, FEEDBACK_MAX_LENGTH)

    if (!message) {
      return res.status(400).json({ error: 'message is required (max 2000 chars)' })
    }

    // Verify feedback exists
    const { data: feedback, error: feedbackError } = await supabaseAdmin
      .from('feedback')
      .select('id')
      .eq('id', id)
      .single()

    if (feedbackError || !feedback) {
      return res.status(404).json({ error: 'Feedback not found' })
    }

    const { data, error } = await supabaseAdmin
      .from('feedback_responses')
      .insert({
        feedback_id: id,
        admin_id: req.userId!,
        message,
      })
      .select()
      .single()

    if (error) throw error

    // Fetch admin profile for the response
    const { data: adminProfile } = await supabaseAdmin
      .from('users')
      .select('display_name, avatar_url')
      .eq('id', req.userId!)
      .single()

    res.status(201).json({
      response: {
        ...data,
        admin_display_name: adminProfile?.display_name || null,
        admin_avatar_url: adminProfile?.avatar_url || null,
      },
    })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── DELETE /api/feedback/:id — Admin delete a feedback entry ────────────────

router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!hasRole(req, 'admin')) {
      return res.status(403).json({ error: 'Admin access required' })
    }

    const id = sanitizeUUID(req.params.id)
    if (!id) {
      return res.status(400).json({ error: 'Invalid feedback ID' })
    }

    // Verify the record exists before deleting (avoids silent no-op)
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('feedback')
      .select('id')
      .eq('id', id)
      .maybeSingle()

    if (fetchError) throw fetchError
    if (!existing) {
      return res.status(404).json({ error: 'Feedback not found' })
    }

    const { error } = await supabaseAdmin
      .from('feedback')
      .delete()
      .eq('id', id)

    if (error) throw error

    console.log(`[ADMIN DELETE] feedback id=${id} deleted by admin userId=${req.userId}`)

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── DELETE /api/feedback/:id/responses/:responseId — Admin delete own reply ──

router.delete('/:id/responses/:responseId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!hasRole(req, 'admin')) {
      return res.status(403).json({ error: 'Admin access required' })
    }

    const { responseId } = req.params

    const { error } = await supabaseAdmin
      .from('feedback_responses')
      .delete()
      .eq('id', responseId)
      .eq('admin_id', req.userId!)

    if (error) throw error

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

export default router
