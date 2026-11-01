import { Router, Response, NextFunction } from 'express'
import { supabaseAdmin } from '../supabaseClient.js'
import { authMiddleware, AuthenticatedRequest, hasRole } from '../middleware/auth.js'
import { ApplicationError, ValidationError } from '../middleware/error-handler.js'
import guardianBansRouter from './guardian-bans.js'
import guardianActionsRouter from './guardian-actions.js'
import { safeErrorMessage } from '../middleware/validation.js'

const router: ReturnType<typeof Router> = Router()

// All guardian routes require authentication
router.use(authMiddleware)
router.use('/ban-list', guardianBansRouter)
// Moderator undo actions: POST /flagged/:id/unban, POST /flagged/:id/untimeout
router.use(guardianActionsRouter)

/** Guard: reject non-moderator users (admins must enable Moderator Overlay) */
function requireModerator(req: AuthenticatedRequest, res: Response): boolean {
  if (!hasRole(req, 'moderator')) {
    res.status(403).json({ error: 'Moderator role required' })
    return false
  }
  return true
}

// ─── Role Check ───────────────────────────────────────────────────────

async function countScannedMessages(since?: string): Promise<number> {
  let query = supabaseAdmin
    .from('guardian_message_log')
    .select('id', { count: 'exact', head: true })
    .is('skip_reason', null)
  if (since) query = query.gte('scanned_at', since)
  const { count, error } = await query
  if (error) throw new ApplicationError('Failed to count Guardian scans', 500, 'GUARDIAN_SCAN_COUNT_FAILED')
  return count || 0
}

router.get('/access', async (req: AuthenticatedRequest, res: Response) => {
  const isModerator = hasRole(req, 'moderator')
  res.json({ isModerator, roles: req.userRoles })
})

// ─── Moderator Accounts ─────────────────────────────────────────────

router.get('/moderators', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireModerator(req, res)) return

  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, email, display_name, account_type, traveler_name, created_at, last_login_at')
      .contains('roles', ['moderator'])
      .order('display_name', { ascending: true })

    if (error) return res.status(500).json({ error: safeErrorMessage(error) })
    res.json({ moderators: data || [] })
  } catch (err) {
    next(err)
  }
})

// ─── Rule Groups ──────────────────────────────────────────────────────

router.get('/rule-groups', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireModerator(req, res)) return

  try {
    const { data, error } = await supabaseAdmin
      .from('guardian_rule_groups')
      .select('*, guardian_rules(count)')
      .order('created_at', { ascending: false })

    if (error) return res.status(500).json({ error: safeErrorMessage(error) })
    res.json({ groups: data || [] })
  } catch (err) {
    next(err)
  }
})

router.post('/rule-groups', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireModerator(req, res)) return

  try {
    const { name, description } = req.body
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' })
    }

    const { data, error } = await supabaseAdmin
      .from('guardian_rule_groups')
      .insert({ name: name.trim(), description: description?.trim() || null, created_by: req.userId })
      .select()
      .single()

    if (error) return res.status(500).json({ error: safeErrorMessage(error) })
    res.status(201).json(data)
  } catch (err) {
    next(err)
  }
})

router.put('/rule-groups/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireModerator(req, res)) return

  try {
    const { id } = req.params
    const { name, description, is_enabled, action_delete_message, action_timeout_member, action_timeout_duration, action_ban_member } = req.body

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (name !== undefined) updates.name = name.trim()
    if (description !== undefined) updates.description = description?.trim() || null
    if (is_enabled !== undefined) updates.is_enabled = is_enabled
    if (action_delete_message !== undefined) updates.action_delete_message = !!action_delete_message
    if (action_timeout_member !== undefined) updates.action_timeout_member = !!action_timeout_member
    if (action_timeout_duration !== undefined) {
      const dur = Number(action_timeout_duration)
      if (!Number.isFinite(dur) || dur < 1 || dur > 2419200) {
        return res.status(400).json({ error: 'Timeout duration must be between 1 and 2419200 seconds (28 days)' })
      }
      updates.action_timeout_duration = dur
    }
    if (action_ban_member !== undefined) updates.action_ban_member = !!action_ban_member

    const { data, error } = await supabaseAdmin
      .from('guardian_rule_groups')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) return res.status(500).json({ error: safeErrorMessage(error) })
    res.json(data)
  } catch (err) {
    next(err)
  }
})

router.delete('/rule-groups/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireModerator(req, res)) return

  try {
    const { id } = req.params
    const { error } = await supabaseAdmin
      .from('guardian_rule_groups')
      .delete()
      .eq('id', id)

    if (error) return res.status(500).json({ error: safeErrorMessage(error) })
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

// ─── Rules ────────────────────────────────────────────────────────────

/**
 * Hard cap on stored pattern length. Regex engines are roughly linear in
 * pattern size, so even a non-pathological 5KB regex against every Discord
 * message would burn CPU. 1KB is generous for any real moderation rule.
 */
const MAX_PATTERN_LENGTH = 1024

/**
 * Cheap structural heuristic for catastrophic-backtracking patterns.
 * Not a full safe-regex checker (which would require a dependency), but
 * catches the textbook ReDoS shapes:
 *   (a+)+         nested quantifier on a group
 *   (a|a)*        alternation of overlapping branches under a quantifier
 *   (.*)*         greedy wildcard under a quantifier
 * Returns null if the pattern looks safe, or a reason string if it doesn't.
 * Moderators get an explicit error so they can rewrite the pattern.
 */
function redosReason(pattern: string): string | null {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return `Pattern too long (max ${MAX_PATTERN_LENGTH} chars)`
  }
  // Nested quantifier: ...(...[+*?]...)... followed by [+*?{]
  if (/\([^)]*[+*?][^)]*\)\s*[+*{]/.test(pattern)) {
    return 'Pattern has a nested quantifier (e.g. (a+)+) -- vulnerable to catastrophic backtracking'
  }
  // .* or .+ inside a group that is itself quantified
  if (/\([^)]*\.[+*][^)]*\)\s*[+*{]/.test(pattern)) {
    return 'Pattern has a greedy wildcard inside a quantified group -- vulnerable to catastrophic backtracking'
  }
  return null
}

router.get('/rules/:groupId', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireModerator(req, res)) return

  try {
    const { groupId } = req.params
    const { data, error } = await supabaseAdmin
      .from('guardian_rules')
      .select('*')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false })

    if (error) return res.status(500).json({ error: safeErrorMessage(error) })
    res.json({ rules: data || [] })
  } catch (err) {
    next(err)
  }
})

router.post('/rules', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireModerator(req, res)) return

  try {
    const { group_id, pattern, pattern_type, description } = req.body

    if (!group_id || !pattern || typeof pattern !== 'string' || pattern.trim().length === 0) {
      return res.status(400).json({ error: 'group_id and pattern are required' })
    }

    if (pattern_type && !['regex', 'wildcard'].includes(pattern_type)) {
      return res.status(400).json({ error: 'pattern_type must be "regex" or "wildcard"' })
    }

    const trimmedPattern = pattern.trim()

    // ReDoS guard -- applies to both regex and wildcard (wildcards compile to regex).
    const redos = redosReason(trimmedPattern)
    if (redos) {
      return res.status(400).json({ error: redos })
    }

    // Validate regex patterns
    if ((!pattern_type || pattern_type === 'regex')) {
      try {
        new RegExp(trimmedPattern)
      } catch {
        return res.status(400).json({ error: 'Invalid regex pattern' })
      }
    }

    const { data, error } = await supabaseAdmin
      .from('guardian_rules')
      .insert({
        group_id,
        pattern: trimmedPattern,
        pattern_type: pattern_type || 'regex',
        description: description?.trim() || null,
      })
      .select()
      .single()

    if (error) return res.status(500).json({ error: safeErrorMessage(error) })
    res.status(201).json(data)
  } catch (err) {
    next(err)
  }
})

router.post('/rules/bulk', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireModerator(req, res)) return

  try {
    const { group_id, patterns, pattern_type, description } = req.body

    if (!group_id) {
      return res.status(400).json({ error: 'group_id and patterns are required' })
    }

    if (pattern_type && !['regex', 'wildcard'].includes(pattern_type)) {
      return res.status(400).json({ error: 'pattern_type must be "regex" or "wildcard"' })
    }

    const type = pattern_type || 'regex'

    // Accept either an array of patterns, or a newline-separated string.
    // Splitting on "," was historically incorrect because regex metacharacters
    // (`[a,b]`, `{1,3}`) contain commas and would be truncated into broken
    // sub-patterns -- silently producing moderation rules that never match.
    let patternList: string[]
    if (Array.isArray(patterns)) {
      patternList = patterns
        .filter((p): p is string => typeof p === 'string')
        .map(p => p.trim())
        .filter(p => p.length > 0)
    } else if (typeof patterns === 'string' && patterns.trim().length > 0) {
      patternList = patterns.split(/\r?\n/).map(p => p.trim()).filter(p => p.length > 0)
    } else {
      return res.status(400).json({ error: 'group_id and patterns are required' })
    }

    if (patternList.length === 0) {
      return res.status(400).json({ error: 'No valid patterns found' })
    }

    // Cap bulk size so a single request cannot insert thousands of rules.
    if (patternList.length > 500) {
      return res.status(400).json({ error: 'Too many patterns in a single request (max 500)' })
    }

    const results: { pattern: string; success: boolean; error?: string }[] = []

    for (const pattern of patternList) {
      // ReDoS guard -- applies to both regex and wildcard.
      const redos = redosReason(pattern)
      if (redos) {
        results.push({ pattern, success: false, error: redos })
        continue
      }

      // Validate regex patterns
      if (type === 'regex') {
        try {
          new RegExp(pattern)
        } catch {
          results.push({ pattern, success: false, error: 'Invalid regex syntax' })
          continue
        }
      }

      const { error } = await supabaseAdmin
        .from('guardian_rules')
        .insert({
          group_id,
          pattern,
          pattern_type: type,
          description: description?.trim() || null,
        })

      if (error) {
        results.push({ pattern, success: false, error: error.message })
      } else {
        results.push({ pattern, success: true })
      }
    }

    const succeeded = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length

    res.status(201).json({ results, succeeded, failed, total: patternList.length })
  } catch (err) {
    next(err)
  }
})

router.put('/rules/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireModerator(req, res)) return

  try {
    const { id } = req.params
    const { pattern, pattern_type, description, is_enabled } = req.body

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (pattern !== undefined) updates.pattern = pattern.trim()
    if (pattern_type !== undefined) updates.pattern_type = pattern_type
    if (description !== undefined) updates.description = description?.trim() || null
    if (is_enabled !== undefined) updates.is_enabled = is_enabled

    // Validate regex if changing pattern
    if (updates.pattern && (updates.pattern_type === 'regex' || !updates.pattern_type)) {
      try {
        new RegExp(updates.pattern as string)
      } catch {
        return res.status(400).json({ error: 'Invalid regex pattern' })
      }
    }

    const { data, error } = await supabaseAdmin
      .from('guardian_rules')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) return res.status(500).json({ error: safeErrorMessage(error) })
    res.json(data)
  } catch (err) {
    next(err)
  }
})

router.delete('/rules/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireModerator(req, res)) return

  try {
    const { id } = req.params
    const { error } = await supabaseAdmin
      .from('guardian_rules')
      .delete()
      .eq('id', id)

    if (error) return res.status(500).json({ error: safeErrorMessage(error) })
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

// ─── Flagged Messages ─────────────────────────────────────────────────

router.get('/flagged', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireModerator(req, res)) return

  try {
    const { group_id, author_ids, filter_mode, since, until, limit = '50', offset = '0', skip_count, count_only } = req.query

    // Count-only mode: head request for total, no row data
    if (count_only === '1') {
      let countQuery = supabaseAdmin
        .from('guardian_flagged_messages')
        .select('id', { count: 'exact', head: true })

      if (group_id && typeof group_id === 'string') countQuery = countQuery.eq('matched_rule_group_id', group_id)
      if (author_ids && typeof author_ids === 'string') {
        const ids = author_ids.split(',').map(s => s.trim()).filter(Boolean)
        if (ids.length > 0) {
          countQuery = filter_mode === 'exclude' ? countQuery.not('author_id', 'in', `(${ids.join(',')})`) : countQuery.in('author_id', ids)
        }
      }
      if (since && typeof since === 'string') countQuery = countQuery.gte('flagged_at', since)
      if (until && typeof until === 'string') countQuery = countQuery.lte('flagged_at', until)

      const { count, error } = await countQuery
      if (error) return res.status(500).json({ error: safeErrorMessage(error) })
      return res.json({ total: count || 0 })
    }

    // Data query -- optionally skip the expensive count
    const selectOpts = skip_count === '1' ? {} : { count: 'exact' as const }
    let query = supabaseAdmin
      .from('guardian_flagged_messages')
      .select('*', selectOpts)
      .order('flagged_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1)

    if (group_id && typeof group_id === 'string') {
      query = query.eq('matched_rule_group_id', group_id)
    }

    // Support author_ids as comma-separated list with include/exclude mode
    if (author_ids && typeof author_ids === 'string') {
      const ids = author_ids.split(',').map(s => s.trim()).filter(Boolean)
      if (ids.length > 0) {
        if (filter_mode === 'exclude') {
          query = query.not('author_id', 'in', `(${ids.join(',')})`)
        } else {
          query = query.in('author_id', ids)
        }
      }
    }

    if (since && typeof since === 'string') {
      query = query.gte('flagged_at', since)
    }
    if (until && typeof until === 'string') {
      query = query.lte('flagged_at', until)
    }

    const { data, error, count } = await query

    if (error) return res.status(500).json({ error: safeErrorMessage(error) })

    // Attach total_versions per message_id so the UI can show the edit-history
    // badge even when other versions live on a different page.
    const rows = data || []
    const ids = Array.from(new Set(rows.map(r => r.message_id).filter(Boolean)))
    const versionCounts = new Map<string, number>()
    if (ids.length > 0) {
      const { data: vRows } = await supabaseAdmin
        .from('guardian_flagged_messages')
        .select('message_id')
        .in('message_id', ids)
      for (const r of vRows || []) {
        versionCounts.set(r.message_id, (versionCounts.get(r.message_id) || 0) + 1)
      }
    }
    // Attach successful moderator undo actions (unban / unmute) so the UI can
    // show the undone state instead of the undo button. A ban or timeout is
    // per author and server, so an undo recorded after a row was flagged covers
    // that row even when it was triggered from another row. Best effort: a
    // failed lookup leaves the rows without undo info.
    const undoByRow = new Map<string, { unban_at?: string; unmute_at?: string }>()
    const authorIds = Array.from(new Set(rows.map(r => r.author_id).filter(Boolean)))
    if (authorIds.length > 0) {
      const { data: undoRows, error: undoError } = await supabaseAdmin
        .from('guardian_action_log')
        .select('guild_id, author_id, action, created_at')
        .in('author_id', authorIds)
        .in('action', ['unban', 'unmute'])
        .eq('success', true)
      if (!undoError) {
        for (const row of rows) {
          const entry: { unban_at?: string; unmute_at?: string } = {}
          for (const u of undoRows || []) {
            if (u.author_id !== row.author_id || u.guild_id !== row.guild_id) continue
            if (new Date(u.created_at).getTime() < new Date(row.flagged_at).getTime()) continue
            const key = u.action === 'unban' ? 'unban_at' : 'unmute_at'
            const previous = entry[key]
            if (!previous || previous < u.created_at) entry[key] = u.created_at
          }
          if (entry.unban_at || entry.unmute_at) undoByRow.set(row.id, entry)
        }
      }
    }
    const enriched = rows.map(r => ({
      ...r,
      total_versions: versionCounts.get(r.message_id) || 1,
      undo: undoByRow.get(r.id) || null,
    }))

    res.json({ flagged: enriched, ...(skip_count !== '1' ? { total: count || 0 } : {}) })
  } catch (err) {
    next(err)
  }
})

router.get('/flagged/count', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireModerator(req, res)) return

  try {
    const { data, error } = await supabaseAdmin
      .from('guardian_flagged_messages')
      .select('id', { count: 'exact', head: true })

    if (error) return res.status(500).json({ error: safeErrorMessage(error) })
    res.json({ count: data })
  } catch (err) {
    next(err)
  }
})

// ─── Dashboard Stats ──────────────────────────────────────────────────

router.get('/stats', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireModerator(req, res)) return

  try {
    const { since, until, group_id, author_ids, filter_mode } = req.query

    const now = new Date()
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()

    const [messagesLast24h, messagesLast7d, messagesLast30d, messagesTotal] = await Promise.all([
      countScannedMessages(oneDayAgo),
      countScannedMessages(sevenDaysAgo),
      countScannedMessages(thirtyDaysAgo),
      countScannedMessages(),
    ])

    // Total flagged (last 24h)
    const { count: flaggedLast24h } = await supabaseAdmin
      .from('guardian_flagged_messages')
      .select('id', { count: 'exact', head: true })
      .gte('flagged_at', oneDayAgo)

    // Total flagged (last 7 days)
    const { count: flaggedLast7d } = await supabaseAdmin
      .from('guardian_flagged_messages')
      .select('id', { count: 'exact', head: true })
      .gte('flagged_at', sevenDaysAgo)

    // Total flagged (last 30 days)
    const { count: flaggedLast30d } = await supabaseAdmin
      .from('guardian_flagged_messages')
      .select('id', { count: 'exact', head: true })
      .gte('flagged_at', thirtyDaysAgo)

    // Total flagged all time
    const { count: flaggedTotal } = await supabaseAdmin
      .from('guardian_flagged_messages')
      .select('id', { count: 'exact', head: true })

    // Flagged by group (last 7 days)
    const { data: flaggedByGroup } = await supabaseAdmin
      .from('guardian_flagged_messages')
      .select('matched_rule_group_id, matched_rule_group_name')
      .gte('flagged_at', sevenDaysAgo)

    const groupCounts: Record<string, { name: string; count: number }> = {}
    for (const row of flaggedByGroup || []) {
      const key = row.matched_rule_group_id || 'unknown'
      if (!groupCounts[key]) {
        groupCounts[key] = { name: row.matched_rule_group_name || 'Unknown', count: 0 }
      }
      groupCounts[key].count++
    }

    // Unique flagged users (all time)
    const { data: uniqueUsersAllData } = await supabaseAdmin
      .from('guardian_flagged_messages')
      .select('author_id')

    const uniqueUsersTotal = new Set((uniqueUsersAllData || []).map(r => r.author_id)).size

    // Unique flagged users (last 24h)
    const { data: uniqueUsers24hData } = await supabaseAdmin
      .from('guardian_flagged_messages')
      .select('author_id')
      .gte('flagged_at', oneDayAgo)

    const uniqueUsers24h = new Set((uniqueUsers24hData || []).map(r => r.author_id)).size

    // Unique flagged users (filtered) -- respects current filter params
    let filteredUsersQuery = supabaseAdmin
      .from('guardian_flagged_messages')
      .select('author_id')

    if (since && typeof since === 'string') {
      filteredUsersQuery = filteredUsersQuery.gte('flagged_at', since)
    }
    if (until && typeof until === 'string') {
      filteredUsersQuery = filteredUsersQuery.lte('flagged_at', until)
    }
    if (group_id && typeof group_id === 'string') {
      filteredUsersQuery = filteredUsersQuery.eq('matched_rule_group_id', group_id)
    }
    if (author_ids && typeof author_ids === 'string') {
      const ids = author_ids.split(',').map(s => s.trim()).filter(Boolean)
      if (ids.length > 0) {
        if (filter_mode === 'exclude') {
          filteredUsersQuery = filteredUsersQuery.not('author_id', 'in', `(${ids.join(',')})`)
        } else {
          filteredUsersQuery = filteredUsersQuery.in('author_id', ids)
        }
      }
    }

    const { data: uniqueUsersFilteredData } = await filteredUsersQuery
    const uniqueUsersFiltered = new Set((uniqueUsersFilteredData || []).map(r => r.author_id)).size

    // Unique flagged users (last 7d / 30d) -- for dateRange selector
    const { data: uniqueUsers7dData } = await supabaseAdmin
      .from('guardian_flagged_messages')
      .select('author_id')
      .gte('flagged_at', sevenDaysAgo)
    const uniqueUsers7d = new Set((uniqueUsers7dData || []).map(r => r.author_id)).size

    const { data: uniqueUsers30dData } = await supabaseAdmin
      .from('guardian_flagged_messages')
      .select('author_id')
      .gte('flagged_at', thirtyDaysAgo)
    const uniqueUsers30d = new Set((uniqueUsers30dData || []).map(r => r.author_id)).size

    res.json({
      messagesLast24h: messagesLast24h || 0,
      messagesLast7d: messagesLast7d || 0,
      messagesLast30d: messagesLast30d || 0,
      messagesTotal: messagesTotal || 0,
      flaggedLast24h: flaggedLast24h || 0,
      flaggedLast7d: flaggedLast7d || 0,
      flaggedLast30d: flaggedLast30d || 0,
      flaggedTotal: flaggedTotal || 0,
      uniqueUsersTotal,
      uniqueUsers24h,
      uniqueUsers7d,
      uniqueUsers30d,
      uniqueUsersFiltered,
      flaggedByGroup: Object.entries(groupCounts).map(([id, data]) => ({
        groupId: id,
        groupName: data.name,
        count: data.count,
      })),
    })
  } catch (err) {
    next(err)
  }
})

// ─── Recent Messages ──────────────────────────────────────────────────

router.get('/recent', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireModerator(req, res)) return

  try {
    const { limit = '50', offset = '0', author_ids, filter_mode, group_id, search, since, until, skip_count, count_only, include_skipped } = req.query
    if (include_skipped !== undefined && include_skipped !== '0' && include_skipped !== '1') {
      throw new ValidationError('include_skipped must be 0 or 1')
    }

    // Count-only mode: head request for total, no row data
    if (count_only === '1') {
      let countQuery = supabaseAdmin
        .from('guardian_message_log')
        .select('id', { count: 'exact', head: true })

      if (include_skipped !== '1') countQuery = countQuery.is('skip_reason', null)
      if (author_ids && typeof author_ids === 'string') {
        const ids = author_ids.split(',').map(s => s.trim()).filter(Boolean)
        if (ids.length > 0) {
          countQuery = filter_mode === 'exclude' ? countQuery.not('author_id', 'in', `(${ids.join(',')})`) : countQuery.in('author_id', ids)
        }
      }
      if (group_id && typeof group_id === 'string') countQuery = countQuery.eq('was_flagged', true)
      if (search && typeof search === 'string') countQuery = countQuery.ilike('content_preview', `%${search}%`)
      if (since && typeof since === 'string') countQuery = countQuery.gte('scanned_at', since)
      if (until && typeof until === 'string') countQuery = countQuery.lte('scanned_at', until)

      const { count, error } = await countQuery
      if (error) return res.status(500).json({ error: safeErrorMessage(error) })
      return res.json({ total: count || 0 })
    }

    // Data query -- optionally skip the expensive count
    const selectOpts = skip_count === '1' ? {} : { count: 'exact' as const }
    let query = supabaseAdmin
      .from('guardian_message_log')
      .select('*', selectOpts)
      .order('scanned_at', { ascending: false })

    if (include_skipped !== '1') query = query.is('skip_reason', null)
    if (author_ids && typeof author_ids === 'string') {
      const ids = author_ids.split(',').map(s => s.trim()).filter(Boolean)
      if (ids.length > 0) {
        if (filter_mode === 'exclude') {
          query = query.not('author_id', 'in', `(${ids.join(',')})`)
        } else {
          query = query.in('author_id', ids)
        }
      }
    }

    if (group_id && typeof group_id === 'string') {
      query = query.eq('was_flagged', true)
    }

    if (search && typeof search === 'string') {
      query = query.ilike('content_preview', `%${search}%`)
    }
    if (since && typeof since === 'string') {
      query = query.gte('scanned_at', since)
    }
    if (until && typeof until === 'string') {
      query = query.lte('scanned_at', until)
    }

    query = query.range(Number(offset), Number(offset) + Number(limit) - 1)

    const { data, error, count } = await query

    if (error) return res.status(500).json({ error: safeErrorMessage(error) })

    // Attach total_versions per message_id so the UI can show the edit-history
    // badge even when other versions live on a different page.
    const rows = data || []
    const ids = Array.from(new Set(rows.map(r => r.message_id).filter(Boolean)))
    const versionCounts = new Map<string, number>()
    if (ids.length > 0) {
      const { data: vRows } = await supabaseAdmin
        .from('guardian_message_log')
        .select('message_id')
        .in('message_id', ids)
      for (const r of vRows || []) {
        versionCounts.set(r.message_id, (versionCounts.get(r.message_id) || 0) + 1)
      }
    }
    const enriched = rows.map(r => ({ ...r, total_versions: versionCounts.get(r.message_id) || 1 }))

    res.json({ messages: enriched, ...(skip_count !== '1' ? { total: count || 0 } : {}) })
  } catch (err) {
    next(err)
  }
})

// ─── Server Settings (Roles per Guild) ────────────────────────────────

router.get('/servers', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireModerator(req, res)) return

  try {
    // Pull roles AND channels in parallel so that guilds with zero custom
    // roles (e.g. fresh tester servers with only @everyone) still appear in
    // the Server Settings list. Without this union they would silently
    // disappear and moderators could not configure notification channels.
    const [rolesRes, channelsRes] = await Promise.all([
      supabaseAdmin
        .from('guardian_server_roles')
        .select('*')
        .order('guild_name', { ascending: true })
        .order('role_position', { ascending: false }),
      supabaseAdmin
        .from('guardian_server_channels')
        .select('guild_id, guild_name')
        .order('guild_name', { ascending: true }),
    ])

    if (rolesRes.error) return res.status(500).json({ error: safeErrorMessage(rolesRes.error) })
    if (channelsRes.error) return res.status(500).json({ error: safeErrorMessage(channelsRes.error) })

    // Group roles by guild
    const guilds: Record<string, { guild_id: string; guild_name: string; roles: NonNullable<typeof rolesRes.data> }> = {}
    for (const role of rolesRes.data || []) {
      if (!guilds[role.guild_id]) {
        guilds[role.guild_id] = { guild_id: role.guild_id, guild_name: role.guild_name || role.guild_id, roles: [] }
      }
      guilds[role.guild_id].roles.push(role)
    }

    // Backfill any guild that has channels synced but no roles yet
    for (const ch of channelsRes.data || []) {
      if (!guilds[ch.guild_id]) {
        guilds[ch.guild_id] = { guild_id: ch.guild_id, guild_name: ch.guild_name || ch.guild_id, roles: [] }
      }
    }

    // Stable alphabetical order by guild name
    const out = Object.values(guilds).sort((a, b) =>
      (a.guild_name || '').localeCompare(b.guild_name || '')
    )

    res.json({ servers: out })
  } catch (err) {
    next(err)
  }
})

router.put('/servers/roles/:id/ignore', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireModerator(req, res)) return

  try {
    const { id } = req.params
    const { is_ignored } = req.body

    if (typeof is_ignored !== 'boolean') {
      return res.status(400).json({ error: 'is_ignored (boolean) is required' })
    }

    const { data, error } = await supabaseAdmin
      .from('guardian_server_roles')
      .update({ is_ignored })
      .eq('id', id)
      .select()
      .single()

    if (error) return res.status(500).json({ error: safeErrorMessage(error) })
    res.json(data)
  } catch (err) {
    next(err)
  }
})

// ─── Per-Guild Notification Channels (bot config) ─────────────────────

/** Discord snowflake validation (numeric 17-20 chars) */
const DISCORD_ID_RE = /^\d{17,20}$/

router.get('/servers/:guildId/notification-channels', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireModerator(req, res)) return

  try {
    const { guildId } = req.params
    if (!DISCORD_ID_RE.test(guildId)) {
      return res.status(400).json({ error: 'Invalid guild_id' })
    }

    const { data, error } = await supabaseAdmin
      .from('guardian_bot_config')
      .select('guild_id, guild_name, actions_log_channel_id, user_feedback_channel_id')
      .eq('guild_id', guildId)
      .maybeSingle()

    if (error) return res.status(500).json({ error: safeErrorMessage(error) })

    res.json({
      guild_id: guildId,
      actions_log_channel_id: data?.actions_log_channel_id || null,
      user_feedback_channel_id: data?.user_feedback_channel_id || null,
    })
  } catch (err) {
    next(err)
  }
})

router.put('/servers/:guildId/notification-channels', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireModerator(req, res)) return

  try {
    const { guildId } = req.params
    if (!DISCORD_ID_RE.test(guildId)) {
      return res.status(400).json({ error: 'Invalid guild_id' })
    }

    const { actions_log_channel_id, user_feedback_channel_id } = req.body

    // Allow null (clear) or a valid snowflake string
    function validate(value: unknown, label: string): string | null | undefined {
      if (value === undefined) return undefined // not changing this field
      if (value === null || value === '') return null
      if (typeof value !== 'string' || !DISCORD_ID_RE.test(value)) {
        throw new Error(`${label} must be a valid Discord channel ID (17-20 digits) or null`)
      }
      return value
    }

    let actionsId: string | null | undefined
    let feedbackId: string | null | undefined
    try {
      actionsId = validate(actions_log_channel_id, 'actions_log_channel_id')
      feedbackId = validate(user_feedback_channel_id, 'user_feedback_channel_id')
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid body' })
    }

    // Optional: verify that any provided channel id actually belongs to this guild
    // by cross-referencing guardian_server_channels (already synced from Discord)
    const idsToVerify = [actionsId, feedbackId].filter((v): v is string => typeof v === 'string')
    if (idsToVerify.length > 0) {
      const { data: existing, error: verifyErr } = await supabaseAdmin
        .from('guardian_server_channels')
        .select('channel_id')
        .eq('guild_id', guildId)
        .in('channel_id', idsToVerify)

      if (verifyErr) return res.status(500).json({ error: safeErrorMessage(verifyErr) })
      const known = new Set((existing || []).map(r => r.channel_id))
      for (const id of idsToVerify) {
        if (!known.has(id)) {
          return res.status(400).json({ error: `Channel ${id} is not in this guild's synced channel list. Run "Sync Channels" first.` })
        }
      }
    }

    // Upsert -- guild_id is UNIQUE on guardian_bot_config
    const updates: Record<string, unknown> = {
      guild_id: guildId,
      updated_at: new Date().toISOString(),
    }
    if (actionsId !== undefined) updates.actions_log_channel_id = actionsId
    if (feedbackId !== undefined) updates.user_feedback_channel_id = feedbackId

    const { data, error } = await supabaseAdmin
      .from('guardian_bot_config')
      .upsert(updates, { onConflict: 'guild_id' })
      .select('guild_id, actions_log_channel_id, user_feedback_channel_id')
      .single()

    if (error) return res.status(500).json({ error: safeErrorMessage(error) })
    res.json(data)
  } catch (err) {
    next(err)
  }
})

// ─── All Known Users (for search filter) ──────────────────────────────

router.get('/users', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireModerator(req, res)) return

  try {
    // Get distinct users from flagged messages
    const { data: flaggedUsers } = await supabaseAdmin
      .from('guardian_flagged_messages')
      .select('author_id, author_username, author_display_name')

    // Get distinct users from recent messages
    const { data: recentUsers } = await supabaseAdmin
      .from('guardian_message_log')
      .select('author_id, author_username')

    // Merge into a unique map
    const userMap = new Map<string, { id: string; username: string; display_name: string | null }>()

    for (const u of flaggedUsers || []) {
      userMap.set(u.author_id, {
        id: u.author_id,
        username: u.author_username || u.author_id,
        display_name: u.author_display_name || null,
      })
    }
    for (const u of recentUsers || []) {
      if (!userMap.has(u.author_id)) {
        userMap.set(u.author_id, {
          id: u.author_id,
          username: u.author_username || u.author_id,
          display_name: null,
        })
      }
    }

    res.json({ users: Array.from(userMap.values()) })
  } catch (err) {
    next(err)
  }
})

// ─── Edit History ─────────────────────────────────────────────────────

router.get('/message-history/:messageId', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireModerator(req, res)) return

  try {
    const { messageId } = req.params

    const { data, error } = await supabaseAdmin
      .from('guardian_message_log')
      .select('*')
      .eq('message_id', messageId)
      .order('edit_version', { ascending: true })

    if (error) return res.status(500).json({ error: safeErrorMessage(error) })
    res.json({ versions: data || [] })
  } catch (err) {
    next(err)
  }
})

router.get('/flagged-history/:messageId', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireModerator(req, res)) return

  try {
    const { messageId } = req.params

    const { data, error } = await supabaseAdmin
      .from('guardian_flagged_messages')
      .select('*')
      .eq('message_id', messageId)
      .order('edit_version', { ascending: true })

    if (error) return res.status(500).json({ error: safeErrorMessage(error) })
    res.json({ versions: data || [] })
  } catch (err) {
    next(err)
  }
})

// ─── Channel Settings (per Guild) ─────────────────────────────────────

/** Extract bot application/client ID from the bot token (base64 segment before first dot) */
function getGuardianClientId(): string | null {
  const token = process.env.GUARDIAN_BOT_TOKEN
  if (!token) return null
  try {
    return Buffer.from(token.split('.')[0], 'base64').toString()
  } catch {
    return null
  }
}

/** Accepted Discord channel types for monitoring, plus categories and threads for grouping/defaults */
const MONITORED_CHANNEL_TYPES = new Set([0, 2, 4, 5, 10, 11, 12, 13, 15, 16]) // text, voice, category, announcement, threads, stage, forum, media
const THREAD_CHANNEL_TYPES = new Set([10, 11, 12])
interface DiscordChannelSummary { id: string; name: string; type: number; parent_id?: string | null }

// ─── Live State Reconciliation ────────────────────────────────────────
//
// The bot can miss MessageDelete events (downtime, cache misses, restarts).
// This endpoint takes a list of (channel_id, message_id) pairs the dashboard
// is currently displaying, asks Discord whether each one still exists, and
// updates deleted_at / state_checked_at accordingly.
//
// Eligibility rules (applied server-side so the client cannot waste tokens):
//   - Skip rows already marked deleted_at IS NOT NULL.
//   - Always check rows younger than 3 days OR rows that have never been
//     checked.
//   - Skip rows where state_checked_at >= scanned_at + 3 days. After we have
//     observed a message at >3d old, we treat further state as frozen --
//     Discord rarely deletes ancient messages and we do not want to spam the
//     API on every page change.

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000
const RECONCILE_BATCH_LIMIT = 50

interface ReconcileTarget { table: 'guardian_message_log' | 'guardian_flagged_messages'; channel_id: string; message_id: string }

router.post('/reconcile-state', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireModerator(req, res)) return

  const botToken = process.env.GUARDIAN_BOT_TOKEN
  if (!botToken) return res.status(500).json({ error: 'GUARDIAN_BOT_TOKEN not configured' })

  try {
    const body = req.body as { targets?: ReconcileTarget[] } | undefined
    const targets = Array.isArray(body?.targets) ? body!.targets!.slice(0, RECONCILE_BATCH_LIMIT) : []
    if (targets.length === 0) return res.json({ checked: 0, deleted: 0, skipped: 0 })

    // Validate input shape (defence-in-depth -- we hit Discord with these)
    const safe = targets.filter(t =>
      (t.table === 'guardian_message_log' || t.table === 'guardian_flagged_messages') &&
      typeof t.channel_id === 'string' && /^\d{5,32}$/.test(t.channel_id) &&
      typeof t.message_id === 'string' && /^\d{5,32}$/.test(t.message_id)
    )
    if (safe.length === 0) return res.json({ checked: 0, deleted: 0, skipped: 0 })

    // Fetch current rows so we can apply eligibility filtering
    const logIds = safe.filter(t => t.table === 'guardian_message_log').map(t => t.message_id)
    const flaggedIds = safe.filter(t => t.table === 'guardian_flagged_messages').map(t => t.message_id)

    type Row = { message_id: string; deleted_at: string | null; state_checked_at: string | null; scanned_at: string }
    const rowMap = new Map<string, { table: 'guardian_message_log' | 'guardian_flagged_messages'; row: Row }>()

    if (logIds.length > 0) {
      const { data } = await supabaseAdmin
        .from('guardian_message_log')
        .select('message_id, deleted_at, state_checked_at, scanned_at')
        .in('message_id', logIds)
      for (const r of data || []) rowMap.set(`log:${r.message_id}`, { table: 'guardian_message_log', row: r as Row })
    }
    if (flaggedIds.length > 0) {
      const { data } = await supabaseAdmin
        .from('guardian_flagged_messages')
        .select('message_id, deleted_at, state_checked_at, flagged_at')
        .in('message_id', flaggedIds)
      for (const r of data || []) {
        const row = r as { message_id: string; deleted_at: string | null; state_checked_at: string | null; flagged_at: string }
        rowMap.set(`flagged:${row.message_id}`, { table: 'guardian_flagged_messages', row: { message_id: row.message_id, deleted_at: row.deleted_at, state_checked_at: row.state_checked_at, scanned_at: row.flagged_at } })
      }
    }

    const now = Date.now()
    const eligible: ReconcileTarget[] = []
    let skipped = 0
    for (const t of safe) {
      const key = `${t.table === 'guardian_message_log' ? 'log' : 'flagged'}:${t.message_id}`
      const found = rowMap.get(key)
      if (!found) { skipped++; continue }
      if (found.row.deleted_at) { skipped++; continue }
      const scannedAt = new Date(found.row.scanned_at).getTime()
      const ageMs = now - scannedAt
      if (ageMs > THREE_DAYS_MS && found.row.state_checked_at) {
        const checkedAt = new Date(found.row.state_checked_at).getTime()
        if (checkedAt - scannedAt >= THREE_DAYS_MS) { skipped++; continue }
      }
      eligible.push(t)
    }

    let checked = 0
    let deletedCount = 0
    const checkedAtIso = new Date().toISOString()

    // Sequential to respect Discord rate limits; batch is capped above.
    for (const t of eligible) {
      const url = `https://discord.com/api/v10/channels/${t.channel_id}/messages/${t.message_id}`
      let resp: globalThis.Response
      try {
        resp = await fetch(url, { headers: { Authorization: `Bot ${botToken}` } })
      } catch (err) {
        console.error('Reconcile fetch failed:', err)
        continue
      }

      if (resp.status === 429) {
        // Rate limited -- stop early, retry on next page change
        break
      }
      if (resp.status === 404) {
        const { error: updErr } = await supabaseAdmin
          .from(t.table)
          .update({ deleted_at: checkedAtIso, deleted_by_kind: 'unknown', state_checked_at: checkedAtIso })
          .eq('message_id', t.message_id)
          .is('deleted_at', null)
        if (updErr) {
          console.error(`Reconcile: failed to mark ${t.message_id} deleted in ${t.table}:`, updErr.message)
        }
        deletedCount++
        checked++
        continue
      }
      if (resp.status === 403 || resp.status === 401) {
        // Bot lost access -- record check attempt but do not flip state
        const { error: updErr } = await supabaseAdmin
          .from(t.table)
          .update({ state_checked_at: checkedAtIso })
          .eq('message_id', t.message_id)
        if (updErr) console.error(`Reconcile: state_checked_at update failed for ${t.message_id}:`, updErr.message)
        checked++
        continue
      }
      if (resp.ok) {
        const { error: updErr } = await supabaseAdmin
          .from(t.table)
          .update({ state_checked_at: checkedAtIso })
          .eq('message_id', t.message_id)
        if (updErr) console.error(`Reconcile: state_checked_at update failed for ${t.message_id}:`, updErr.message)
        checked++
        continue
      }
      // Other errors (5xx) -- log and skip without recording check time
      console.error(`Reconcile got ${resp.status} for ${t.message_id}`)
    }

    res.json({ checked, deleted: deletedCount, skipped, eligible: eligible.length, total: targets.length })
  } catch (err) {
    next(err)
  }
})

router.get('/bot-invite', async (req: AuthenticatedRequest, res: Response) => {
  if (!requireModerator(req, res)) return

  const clientId = process.env.GUARDIAN_CLIENT_ID || getGuardianClientId()
  if (!clientId) {
    return res.status(500).json({ error: 'GUARDIAN_CLIENT_ID not configured' })
  }

  // Permissions: ViewChannel, SendMessages, ManageMessages, ReadMessageHistory, BanMembers, ModerateMembers (no TTS)
  const permissions = '1099511704580'
  const scopes = 'bot'
  const url = `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&permissions=${permissions}&scope=${scopes}`
  res.json({ url })
})

router.post('/servers/channels/sync', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireModerator(req, res)) return

  const botToken = process.env.GUARDIAN_BOT_TOKEN
  if (!botToken) {
    return res.status(500).json({ error: 'GUARDIAN_BOT_TOKEN not configured' })
  }

  try {
    // 1. Fetch guilds the bot is in
    const guildsRes = await fetch('https://discord.com/api/v10/users/@me/guilds', {
      headers: { Authorization: `Bot ${botToken}` },
    })
    if (!guildsRes.ok) {
      return res.status(502).json({ error: `Discord API error: ${guildsRes.status}` })
    }
    const guilds = await guildsRes.json() as Array<{ id: string; name: string }>

    // 2. Remove channels from guilds the Guardian bot is NOT in
    const guardianGuildIds = guilds.map(g => g.id)
    if (guardianGuildIds.length > 0) {
      await supabaseAdmin
        .from('guardian_server_channels')
        .delete()
        .not('guild_id', 'in', `(${guardianGuildIds.join(',')})`)
    } else {
      // Bot is in no guilds — clear all
      await supabaseAdmin.from('guardian_server_channels').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    }

    let totalSynced = 0

    // 3. Load per-guild auto-monitor defaults (fallback TRUE when unset)
    const { data: configRows } = guardianGuildIds.length > 0
      ? await supabaseAdmin
          .from('guardian_bot_config')
          .select('guild_id, default_monitor_new_channels')
          .in('guild_id', guardianGuildIds)
      : { data: [] as Array<{ guild_id: string; default_monitor_new_channels: boolean | null }> }
    const guildDefaults = new Map<string, boolean>()
    for (const row of configRows || []) {
      guildDefaults.set(row.guild_id, row.default_monitor_new_channels !== false)
    }

    // 4. For each guild, fetch channels and upsert. Categories are synced first
    //    so their is_monitored value is known and can be used as the default
    //    for newly-discovered child channels (per-channel overrides always win).
    for (const guild of guilds) {
      const chRes = await fetch(`https://discord.com/api/v10/guilds/${guild.id}/channels`, {
        headers: { Authorization: `Bot ${botToken}` },
      })
      if (!chRes.ok) {
        console.error(`Failed to fetch channels for guild ${guild.name}: ${chRes.status}`)
        continue
      }
      const channels = await chRes.json() as DiscordChannelSummary[]
      const threadsRes = await fetch(`https://discord.com/api/v10/guilds/${guild.id}/threads/active`, {
        headers: { Authorization: `Bot ${botToken}` },
      })
      const activeThreads = threadsRes.ok
        ? await threadsRes.json() as { threads?: DiscordChannelSummary[] }
        : { threads: [] }
      const channelsById = new Map<string, DiscordChannelSummary>()
      for (const channel of [...channels, ...(activeThreads.threads || [])]) {
        channelsById.set(channel.id, channel)
      }

      const guildDefault = guildDefaults.get(guild.id) ?? true

      const { data: existingRows, error: existingRowsError } = await supabaseAdmin
        .from('guardian_server_channels')
        .select('channel_id, guild_name, channel_name, channel_type, parent_id, is_monitored, default_monitor_new_threads')
        .eq('guild_id', guild.id)
      if (existingRowsError) throw existingRowsError

      const orphanThreads = (existingRows || []).filter(row => {
        if (!THREAD_CHANNEL_TYPES.has(row.channel_type)) return false
        const liveChannel = channelsById.get(row.channel_id)
        return !row.parent_id || !liveChannel?.parent_id
      })
      for (const thread of orphanThreads) {
        const threadRes = await fetch(`https://discord.com/api/v10/channels/${thread.channel_id}`, {
          headers: { Authorization: `Bot ${botToken}` },
        })
        if (!threadRes.ok) continue
        const threadChannel = await threadRes.json() as DiscordChannelSummary
        if (MONITORED_CHANNEL_TYPES.has(threadChannel.type)) {
          channelsById.set(threadChannel.id, threadChannel)
        }
      }

      const relevant = Array.from(channelsById.values()).filter(c => MONITORED_CHANNEL_TYPES.has(c.type))
      if (relevant.length === 0) continue

      const existingMonitored = new Map((existingRows || []).map(r => [r.channel_id, r.is_monitored !== false]))
      const existingParents = new Map((existingRows || []).map(r => [r.channel_id, r.parent_id || null]))
      const threadDefaults = new Map((existingRows || []).map(r => [r.channel_id, r.default_monitor_new_threads ?? null]))
      for (const channel of relevant) {
        existingParents.set(channel.id, channel.parent_id || null)
      }

      const categories = relevant.filter(c => c.type === 4)
      const nonCategories = relevant.filter(c => c.type !== 4)

      // Resolve each category's effective is_monitored (existing value if known,
      // otherwise the guild default) so children can inherit it.
      const categoryDefaults = new Map<string, boolean>()
      for (const cat of categories) {
        categoryDefaults.set(cat.id, existingMonitored.get(cat.id) ?? guildDefault)
      }

      const buildRow = (c: typeof relevant[number]) => {
        const base = {
          guild_id: guild.id,
          guild_name: guild.name,
          channel_id: c.id,
          channel_name: c.name,
          channel_type: c.type,
          parent_id: c.parent_id || null,
          synced_at: new Date().toISOString(),
        }
        if (existingMonitored.has(c.id)) return base // preserve existing is_monitored
        if (THREAD_CHANNEL_TYPES.has(c.type)) {
          const channelDefault = c.parent_id ? threadDefaults.get(c.parent_id) : undefined
          const categoryId = c.parent_id ? existingParents.get(c.parent_id) : undefined
          const categoryDefault = categoryId ? threadDefaults.get(categoryId) : undefined
          return { ...base, is_monitored: channelDefault ?? categoryDefault ?? guildDefault }
        }
        const parentDefault = c.parent_id ? categoryDefaults.get(c.parent_id) : undefined
        return { ...base, is_monitored: parentDefault ?? guildDefault }
      }

      const rows = [...categories, ...nonCategories].map(buildRow)
      const existingById = new Map((existingRows || []).map(row => [row.channel_id, row]))
      const changedRows = rows.filter(row => {
        const previous = existingById.get(row.channel_id)
        return !previous
          || previous.guild_name !== row.guild_name
          || previous.channel_name !== row.channel_name
          || previous.channel_type !== row.channel_type
          || (previous.parent_id || null) !== row.parent_id
      })
      if (changedRows.length === 0) {
        totalSynced += rows.length
        continue
      }

      const additions = changedRows.filter(row => !existingById.has(row.channel_id))
      const updates = changedRows.filter(row => existingById.has(row.channel_id))
      for (const batch of [additions, updates]) {
        if (batch.length === 0) continue
        const { error } = await supabaseAdmin
          .from('guardian_server_channels')
          .upsert(batch, {
            onConflict: 'guild_id,channel_id',
            ignoreDuplicates: batch === additions,
          })
        if (error) throw error
      }
      totalSynced += rows.length
    }

    res.json({ synced: totalSynced, guilds: guilds.length })
  } catch (err) {
    next(err)
  }
})

router.get('/servers/channels', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireModerator(req, res)) return

  try {
    const { guild_id } = req.query

    let query = supabaseAdmin
      .from('guardian_server_channels')
      .select('*')
      .order('guild_name', { ascending: true })
      .order('channel_name', { ascending: true })

    if (guild_id && typeof guild_id === 'string') {
      query = query.eq('guild_id', guild_id)
    }

    const { data, error } = await query

    if (error) return res.status(500).json({ error: safeErrorMessage(error) })

    const guildIds = Array.from(new Set((data || []).map(c => c.guild_id)))
    const { data: configRows } = guildIds.length > 0
      ? await supabaseAdmin
          .from('guardian_bot_config')
          .select('guild_id, default_monitor_new_channels')
          .in('guild_id', guildIds)
      : { data: [] as Array<{ guild_id: string; default_monitor_new_channels: boolean | null }> }
    const defaultsMap = new Map((configRows || []).map(r => [r.guild_id, r.default_monitor_new_channels !== false]))

    // Group by guild
    const guilds: Record<string, { guild_id: string; guild_name: string; default_monitor_new_channels: boolean; channels: typeof data }> = {}
    for (const ch of data || []) {
      if (!guilds[ch.guild_id]) {
        guilds[ch.guild_id] = {
          guild_id: ch.guild_id,
          guild_name: ch.guild_name || ch.guild_id,
          default_monitor_new_channels: defaultsMap.get(ch.guild_id) ?? true,
          channels: [],
        }
      }
      guilds[ch.guild_id].channels.push(ch)
    }

    res.json({ servers: Object.values(guilds) })
  } catch (err) {
    next(err)
  }
})

router.put('/servers/channels/:id/monitor', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireModerator(req, res)) return

  try {
    const { id } = req.params
    const { is_monitored } = req.body

    if (typeof is_monitored !== 'boolean') {
      return res.status(400).json({ error: 'is_monitored (boolean) is required' })
    }

    const { data, error } = await supabaseAdmin
      .from('guardian_server_channels')
      .update({ is_monitored })
      .eq('id', id)
      .select()
      .single()

    if (error) return res.status(500).json({ error: safeErrorMessage(error) })
    res.json(data)
  } catch (err) {
    next(err)
  }
})

router.put('/servers/channels/:id/thread-monitor-default', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireModerator(req, res)) return

  try {
    const { id } = req.params
    const { default_monitor_new_threads } = req.body

    if (default_monitor_new_threads !== null && typeof default_monitor_new_threads !== 'boolean') {
      return res.status(400).json({ error: 'default_monitor_new_threads (boolean or null) is required' })
    }

    const { data, error } = await supabaseAdmin
      .from('guardian_server_channels')
      .update({ default_monitor_new_threads })
      .eq('id', id)
      .select()
      .single()

    if (error) return res.status(500).json({ error: safeErrorMessage(error) })
    res.json(data)
  } catch (err) {
    next(err)
  }
})

router.post('/servers/channels/:id/clear-thread-monitor-defaults', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireModerator(req, res)) return

  try {
    const { id } = req.params
    const { data: category, error: categoryError } = await supabaseAdmin
      .from('guardian_server_channels')
      .select('channel_id, channel_type')
      .eq('id', id)
      .single()

    if (categoryError) return res.status(500).json({ error: safeErrorMessage(categoryError) })
    if (category?.channel_type !== 4) return res.status(400).json({ error: 'Thread defaults can only be cleared from a category' })

    const { error } = await supabaseAdmin
      .from('guardian_server_channels')
      .update({ default_monitor_new_threads: null })
      .eq('parent_id', category.channel_id)

    if (error) return res.status(500).json({ error: safeErrorMessage(error) })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

/**
 * PUT /api/guardian/servers/:guildId/default-monitoring
 *
 * Sets the per-guild fallback used when a brand-new channel or category is
 * discovered (via sync or the bot's live channelCreate listener) and has no
 * category default to inherit from.
 */
router.put('/servers/:guildId/default-monitoring', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireModerator(req, res)) return

  try {
    const { guildId } = req.params
    if (!/^\d{17,20}$/.test(guildId)) {
      return res.status(400).json({ error: 'Invalid guild_id' })
    }

    const { default_monitor_new_channels } = req.body
    if (typeof default_monitor_new_channels !== 'boolean') {
      return res.status(400).json({ error: 'default_monitor_new_channels (boolean) is required' })
    }

    const { data, error } = await supabaseAdmin
      .from('guardian_bot_config')
      .upsert(
        { guild_id: guildId, default_monitor_new_channels, updated_at: new Date().toISOString() },
        { onConflict: 'guild_id' }
      )
      .select('guild_id, default_monitor_new_channels')
      .single()

    if (error) return res.status(500).json({ error: safeErrorMessage(error) })
    res.json(data)
  } catch (err) {
    next(err)
  }
})


// ─── Timeseries Stats ─────────────────────────────────────────────────

/**
 * GET /api/guardian/timeseries?range=1d|7d|30d&since=ISO&until=ISO
 *
 * Returns time-bucketed counts for messages scanned, flagged, and unique users flagged.
 * - 1d  => 24 hourly buckets
 * - 7d  => ~20 buckets (~8.4h each)
 * - 30d or custom => daily buckets
 */
router.get('/timeseries', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireModerator(req, res)) return

  try {
    const { range, since, until } = req.query
    const now = new Date()
    let start: Date
    let end: Date = now
    let bucketMs: number
    let bucketCount: number
    let mode: 'hourly' | 'multi-hour' | 'daily'

    if (since && until && typeof since === 'string' && typeof until === 'string') {
      // Custom range
      start = new Date(since)
      end = new Date(until)
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ error: 'Invalid since/until dates' })
      }
      const spanMs = end.getTime() - start.getTime()
      const spanDays = spanMs / (1000 * 60 * 60 * 24)
      if (spanDays <= 1) {
        mode = 'hourly'
        bucketMs = 60 * 60 * 1000
        bucketCount = 24
      } else if (spanDays <= 7) {
        mode = 'multi-hour'
        bucketCount = 20
        bucketMs = spanMs / bucketCount
      } else {
        mode = 'daily'
        bucketMs = 24 * 60 * 60 * 1000
        bucketCount = Math.ceil(spanMs / bucketMs)
      }
    } else {
      switch (range) {
        case '1d':
          start = new Date(now.getTime() - 24 * 60 * 60 * 1000)
          mode = 'hourly'
          bucketMs = 60 * 60 * 1000
          bucketCount = 24
          break
        case '7d':
          start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
          mode = 'multi-hour'
          bucketCount = 20
          bucketMs = (7 * 24 * 60 * 60 * 1000) / bucketCount
          break
        case '30d':
          start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
          mode = 'daily'
          bucketMs = 24 * 60 * 60 * 1000
          bucketCount = 30
          break
        default:
          start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
          mode = 'multi-hour'
          bucketCount = 20
          bucketMs = (7 * 24 * 60 * 60 * 1000) / bucketCount
      }
    }

    const startISO = start.toISOString()
    const endISO = end.toISOString()

    // Fetch scanned timestamps
    const { data: scannedRows, error: scannedErr } = await supabaseAdmin
      .from('guardian_message_log')
      .select('scanned_at')
      .is('skip_reason', null)
      .gte('scanned_at', startISO)
      .lte('scanned_at', endISO)

    if (scannedErr) return res.status(500).json({ error: safeErrorMessage(scannedErr) })

    // Fetch flagged timestamps + author_id for unique users
    const { data: flaggedRows, error: flaggedErr } = await supabaseAdmin
      .from('guardian_flagged_messages')
      .select('flagged_at, author_id')
      .gte('flagged_at', startISO)
      .lte('flagged_at', endISO)

    if (flaggedErr) return res.status(500).json({ error: safeErrorMessage(flaggedErr) })

    // Build buckets
    const startTime = start.getTime()
    const buckets: Array<{
      time: string
      scanned: number
      flagged: number
      usersFlagged: number
    }> = []

    for (let i = 0; i < bucketCount; i++) {
      const bucketStart = startTime + i * bucketMs
      const bucketEnd = bucketStart + bucketMs
      const bucketDate = new Date(bucketStart)

      let label: string
      if (mode === 'hourly') {
        label = bucketDate.toISOString().slice(0, 16) // "2026-04-01T14:00"
      } else if (mode === 'daily') {
        label = bucketDate.toISOString().slice(0, 10) // "2026-04-01"
      } else {
        label = bucketDate.toISOString().slice(0, 16)
      }

      let scanned = 0
      for (const row of scannedRows || []) {
        const t = new Date(row.scanned_at).getTime()
        if (t >= bucketStart && t < bucketEnd) scanned++
      }

      let flagged = 0
      const authors = new Set<string>()
      for (const row of flaggedRows || []) {
        const t = new Date(row.flagged_at).getTime()
        if (t >= bucketStart && t < bucketEnd) {
          flagged++
          if (row.author_id) authors.add(row.author_id)
        }
      }

      buckets.push({
        time: label,
        scanned,
        flagged,
        usersFlagged: authors.size,
      })
    }

    res.json({ mode, buckets })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/guardian/actions-timeseries?range=1d|7d|30d&since=ISO&until=ISO
 *
 * Returns time-bucketed counts broken down by action type
 * (delete / mute / ban) from guardian_action_log. Used by the
 * "Activity Over Time" chart on the dashboard.
 *
 * Bucketing mirrors /timeseries: 1d -> hourly, 7d -> 20 buckets,
 * 30d / custom -> daily.
 */
router.get('/actions-timeseries', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireModerator(req, res)) return

  try {
    const { range, since, until } = req.query
    const now = new Date()
    let start: Date
    let end: Date = now
    let bucketMs: number
    let bucketCount: number
    let mode: 'hourly' | 'multi-hour' | 'daily'

    if (since && until && typeof since === 'string' && typeof until === 'string') {
      start = new Date(since)
      end = new Date(until)
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ error: 'Invalid since/until dates' })
      }
      const spanMs = end.getTime() - start.getTime()
      const spanDays = spanMs / (1000 * 60 * 60 * 24)
      if (spanDays <= 1) {
        mode = 'hourly'; bucketMs = 60 * 60 * 1000; bucketCount = 24
      } else if (spanDays <= 7) {
        mode = 'multi-hour'; bucketCount = 20; bucketMs = spanMs / bucketCount
      } else {
        mode = 'daily'; bucketMs = 24 * 60 * 60 * 1000; bucketCount = Math.ceil(spanMs / bucketMs)
      }
    } else {
      switch (range) {
        case '1d':
          start = new Date(now.getTime() - 24 * 60 * 60 * 1000)
          mode = 'hourly'; bucketMs = 60 * 60 * 1000; bucketCount = 24
          break
        case '7d':
          start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
          mode = 'multi-hour'; bucketCount = 20; bucketMs = (7 * 24 * 60 * 60 * 1000) / bucketCount
          break
        case '30d':
          start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
          mode = 'daily'; bucketMs = 24 * 60 * 60 * 1000; bucketCount = 30
          break
        default:
          start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
          mode = 'multi-hour'; bucketCount = 20; bucketMs = (7 * 24 * 60 * 60 * 1000) / bucketCount
      }
    }

    const startISO = start.toISOString()
    const endISO = end.toISOString()

    const { data: rows, error } = await supabaseAdmin
      .from('guardian_action_log')
      .select('action, created_at, success')
      .gte('created_at', startISO)
      .lte('created_at', endISO)
      .in('action', ['delete', 'mute', 'ban'])

    if (error) return res.status(500).json({ error: safeErrorMessage(error) })

    const startTime = start.getTime()
    const buckets: Array<{ time: string; delete: number; mute: number; ban: number; failed: number }> = []
    for (let i = 0; i < bucketCount; i++) {
      const bucketStart = startTime + i * bucketMs
      const bucketEnd = bucketStart + bucketMs
      const bucketDate = new Date(bucketStart)
      const label = mode === 'daily'
        ? bucketDate.toISOString().slice(0, 10)
        : bucketDate.toISOString().slice(0, 16)
      let del = 0, mute = 0, ban = 0, failed = 0
      for (const row of rows || []) {
        const t = new Date(row.created_at).getTime()
        if (t < bucketStart || t >= bucketEnd) continue
        if (!row.success) { failed++; continue }
        if (row.action === 'delete') del++
        else if (row.action === 'mute') mute++
        else if (row.action === 'ban') ban++
      }
      buckets.push({ time: label, delete: del, mute, ban, failed })
    }

    // Also return totals for the StatCards / legend summary
    const totals = { delete: 0, mute: 0, ban: 0, failed: 0 }
    for (const row of rows || []) {
      if (!row.success) { totals.failed++; continue }
      if (row.action === 'delete') totals.delete++
      else if (row.action === 'mute') totals.mute++
      else if (row.action === 'ban') totals.ban++
    }

    res.json({ mode, buckets, totals })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/guardian/system-log?limit=50
 *
 * Returns the most recent rows from guardian_action_log where the bot
 * attempted an action but it failed (success = false). Used by the
 * collapsible "System Log" panel on the dashboard so moderators can see
 * permission gaps and other intent-vs-result mismatches without having to
 * tail the guardian terminal.
 */
router.get('/system-log', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireModerator(req, res)) return

  try {
    const rawLimit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 50, 1), 200)

    const { data, error } = await supabaseAdmin
      .from('guardian_action_log')
      .select('id, created_at, action, failure_reason, author_id, author_username, guild_name, channel_name, channel_id, message_id, matched_rule_group_name')
      .eq('success', false)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) return res.status(500).json({ error: safeErrorMessage(error) })

    res.json({ entries: data || [], limit })
  } catch (err) {
    next(err)
  }
})

export default router
