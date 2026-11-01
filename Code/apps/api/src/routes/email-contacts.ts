import { Router, Response } from 'express'
import type { Router as RouterType } from 'express'
import { supabaseAdmin } from '../supabaseClient.js'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js'
import { sanitizeString, sanitizeUUID, safeErrorMessage } from '../middleware/validation.js'

const router: RouterType = Router()

// All routes require authentication
router.use(authMiddleware)

// Simple email format check (not exhaustive, just a sanity guard)
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/

// Sanitize a tags array: lowercase, trim, dedupe, limit length
const sanitizeTags = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const t of raw) {
    if (typeof t !== 'string') continue
    const tag = t.trim().toLowerCase().slice(0, 50)
    if (tag && !seen.has(tag)) {
      seen.add(tag)
      result.push(tag)
    }
  }
  return result.slice(0, 20) // max 20 tags
}

// ─── GET /api/email-contacts — List the current user's email contacts ─────────

router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('email_contacts')
      .select('*')
      .eq('owner_user_id', req.userId!)
      .order('created_at', { ascending: false })

    if (error) throw error

    res.json({ contacts: data || [] })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── POST /api/email-contacts — Add a new email contact ──────────────────────

router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const email = sanitizeString(req.body.email, 320)
    const displayName = sanitizeString(req.body.display_name, 200)
    const source = req.body.source === 'platform_verified' ? 'platform_verified' : 'manual'
    const tags = sanitizeTags(req.body.tags)

    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'A valid email address is required' })
    }

    // Upsert: if the same owner+email already exists, update it
    const { data, error } = await supabaseAdmin
      .from('email_contacts')
      .upsert(
        {
          owner_user_id: req.userId,
          email,
          display_name: displayName || null,
          source,
          tags,
        },
        { onConflict: 'owner_user_id,email' }
      )
      .select()
      .single()

    if (error) throw error

    res.status(201).json({ contact: data })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── POST /api/email-contacts/bulk — Mass-import with optional names & tags ───

router.post('/bulk', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const raw = sanitizeString(req.body.emails, 50_000)
    if (!raw) {
      return res.status(400).json({ error: 'No emails provided' })
    }

    // Optional names list (matched by position)
    const rawNames = sanitizeString(req.body.names, 50_000)
    const namesList = rawNames
      ? rawNames.split(/[,;\n]+/).map(n => n.trim())
      : []

    // Optional tags applied to all imported contacts
    const tags = sanitizeTags(req.body.tags)

    // Split on comma, semicolon, or newline and deduplicate
    const seen = new Set<string>()
    const parsed: { email: string; name: string | null }[] = []
    const chunks = raw.split(/[,;\n]+/)
    for (let i = 0; i < chunks.length; i++) {
      const email = chunks[i].trim().toLowerCase()
      if (email && EMAIL_RE.test(email) && !seen.has(email)) {
        seen.add(email)
        const name = namesList[i]?.trim() || null
        parsed.push({ email, name })
      }
    }

    if (parsed.length === 0) {
      return res.status(400).json({ error: 'No valid email addresses found' })
    }

    // Cap at 200 per request to prevent abuse
    const batch = parsed.slice(0, 200)
    const rows = batch.map(({ email, name }) => ({
      owner_user_id: req.userId,
      email,
      display_name: name,
      source: 'manual' as const,
      tags,
    }))

    const { data, error } = await supabaseAdmin
      .from('email_contacts')
      .upsert(rows, { onConflict: 'owner_user_id,email' })
      .select()

    if (error) throw error

    res.status(201).json({
      imported: data?.length ?? 0,
      skipped: parsed.length - batch.length,
      contacts: data || [],
    })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── PATCH /api/email-contacts/:id — Update name, email, or tags ──────────────

router.patch('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const contactId = sanitizeUUID(req.params.id)
    if (!contactId) {
      return res.status(400).json({ error: 'Invalid contact ID' })
    }

    const updates: Record<string, unknown> = {}

    if (req.body.display_name !== undefined) {
      updates.display_name = sanitizeString(req.body.display_name, 200) || null
    }
    if (req.body.email !== undefined) {
      const email = sanitizeString(req.body.email, 320)
      if (!email || !EMAIL_RE.test(email)) {
        return res.status(400).json({ error: 'A valid email address is required' })
      }
      updates.email = email
    }
    if (req.body.tags !== undefined) {
      updates.tags = sanitizeTags(req.body.tags)
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' })
    }

    updates.updated_at = new Date().toISOString()

    const { data, error } = await supabaseAdmin
      .from('email_contacts')
      .update(updates)
      .eq('id', contactId)
      .eq('owner_user_id', req.userId!)
      .select()
      .single()

    if (error) throw error

    res.json({ contact: data })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── DELETE /api/email-contacts/:id — Remove a manually-added contact ─────────

router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const contactId = sanitizeUUID(req.params.id)
    if (!contactId) {
      return res.status(400).json({ error: 'Invalid contact ID' })
    }

    // Only allow deleting contacts the user owns and that are manual
    const { error } = await supabaseAdmin
      .from('email_contacts')
      .delete()
      .eq('id', contactId)
      .eq('owner_user_id', req.userId!)
      .eq('source', 'manual')

    if (error) throw error

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

export default router
