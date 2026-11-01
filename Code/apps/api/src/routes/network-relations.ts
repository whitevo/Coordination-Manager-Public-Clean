import { Router, Response, NextFunction } from 'express'
import { supabaseAdmin } from '../supabaseClient.js'
import { authMiddleware, AuthenticatedRequest, hasRole } from '../middleware/auth.js'
import { sanitizeString, sanitizeUUID, safeErrorMessage } from '../middleware/validation.js'
import { ApplicationError, ValidationError } from '../middleware/error-handler.js'
import { redosReason } from '../services/safe-regex.js'
import {
  NETWORK_FIELDS, NETWORK_MANAGEMENT_FIELDS, getNetworkSourceOwner, loadPublicNetworkInventory,
  type NetworkRecord,
} from '../services/network-relations.js'

const router: ReturnType<typeof Router> = Router()

// ─── GET /api/network-relations/networks (public) ────────────────────
// Returns all networks with their colors (for calendar coloring).

router.get('/networks', async (_req, res: Response, next: NextFunction) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('networks')
      .select(NETWORK_FIELDS)
      .order('name', { ascending: true })

    if (error) throw error
    res.json({ networks: (data || []).map(publicNetwork) })
  } catch (error) {
    next(networkReadError(error))
  }
})

// ─── GET /api/network-relations/mappings (public) ────────────────────
// Returns all mappings so the client can resolve calendar_title -> network.

router.get('/mappings', async (_req, res: Response, next: NextFunction) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('network_mappings')
      .select('id, network_id, source_string, source_type')
      .order('source_string', { ascending: true })

    if (error) throw error
    res.json({ mappings: data || [] })
  } catch (error) {
    next(networkReadError(error))
  }
})

// ─── GET /api/network-relations/rules (public) ───────────────────────
// Returns all active rules so the client can auto-classify events.

router.get('/rules', async (_req, res: Response, next: NextFunction) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('network_rules')
      .select('id, network_id, pattern, match_type, match_field, priority, is_active')
      .eq('is_active', true)
      .order('priority', { ascending: false })

    if (error) throw error
    res.json({ rules: data || [] })
  } catch (error) {
    next(networkReadError(error))
  }
})

router.get('/assignments', async (_req, res: Response, next: NextFunction) => {
  try {
    const [inventory, result] = await Promise.all([
      loadPublicNetworkInventory(),
      supabaseAdmin.from('network_event_assignments').select('id, network_id, target_type, target_id').order('created_at'),
    ])
    if (result.error) throw result.error
    const publicTargets = new Set(inventory.targets.map(target => `${target.target_type}:${target.target_id}`))
    res.json({
      assignments: (result.data || []).filter(row => publicTargets.has(`${row.target_type}:${row.target_id}`)),
      sources: inventory.sources.map(source => ({ key: source.key, name: source.name })),
    })
  } catch (error) {
    next(networkReadError(error))
  }
})

// Management requires a verified session; source owners and network creators
// can rename, while mappings/rules/deletion remain admin-only.
router.use(authMiddleware)

function ownsIdentity(req: AuthenticatedRequest, identity: string | null): boolean {
  return Boolean(identity && [req.userId, req.userEmail, req.rawAuthUserId].includes(identity))
}

function publicNetwork(network: NetworkRecord) {
  return {
    id: network.id, name: network.name, color: network.color, description: network.description,
    original_name: network.original_name, source_key: network.source_key, member_keys: network.member_keys,
    merged_into: network.merged_into || null,
  }
}

function networkReadError(error: unknown): unknown {
  if (error && typeof error === 'object' && 'code' in error
    && ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(String(error.code))) {
    const failure = new ApplicationError(
      'Network filters require the network feature schema and migration 038. Ask an administrator to apply them and reload the API schema.',
      503, 'NETWORK_SCHEMA_REQUIRED',
    )
    failure.cause = error
    return failure
  }
  return error
}

async function getNetwork(id: unknown): Promise<NetworkRecord> {
  const validId = sanitizeUUID(id)
  if (!validId) throw new ValidationError('Invalid network id')
  const { data, error } = await supabaseAdmin.from('networks').select(NETWORK_MANAGEMENT_FIELDS).eq('id', validId).maybeSingle()
  if (error) throw error
  if (!data) throw new ApplicationError('Network not found', 404, 'NOT_FOUND')
  return data
}

async function parseMemberKeys(value: unknown, existingKeys: string[] = []): Promise<string[]> {
  const isNetworkKey = (key: unknown): key is string =>
    typeof key === 'string' && (Boolean(sanitizeUUID(key)) || /^source_[0-9a-f]{64}$/.test(key))
  if (!Array.isArray(value) || value.length > 100 || !value.every(isNetworkKey)) {
    throw new ValidationError('Members must be up to 100 valid network keys')
  }
  const memberKeys = [...new Set(value)]
  if (!memberKeys.length) return memberKeys
  const [inventory, result] = await Promise.all([
    loadPublicNetworkInventory(), supabaseAdmin.from('networks').select('id, source_key').order('name'),
  ])
  if (result.error) throw result.error
  const known = new Set([
    ...existingKeys,
    ...inventory.sources.map(source => source.key),
    ...(result.data || []).flatMap(network => [network.id, ...(network.source_key ? [network.source_key] : [])]),
  ])
  if (memberKeys.some(key => !known.has(key))) throw new ValidationError('A selected network no longer exists')
  // Normalize aliases so a source-backed network always uses its durable source key.
  const aliases = new Map((result.data || []).map(network => [network.id, network.source_key || network.id]))
  return [...new Set(memberKeys.map(key => aliases.get(key) || key))]
}

function throwNetworkWriteError(error: { code?: string; message?: string }): never {
  if (error.code === '23505') throw new ApplicationError('A network with this name or source already exists', 409, 'CONFLICT')
  if (error.code === '23514') throw new ValidationError(error.message || 'Invalid network relationships')
  if (error.code === '23503') throw new ApplicationError('A referenced network no longer exists. Refresh the network list and try again.', 409, 'CONFLICT')
  if (error.code === 'P0002') throw new ApplicationError(error.message || 'Network no longer exists', 409, 'CONFLICT')
  if (error.code === 'PGRST202') throw new ApplicationError('Network joins require database migration 039. Ask an administrator to apply it.', 503, 'NETWORK_SCHEMA_REQUIRED')
  throw error
}

function parseNetworkDescription(value: unknown): string | null {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return null
  const description = sanitizeString(value, 1000)
  if (!description) throw new ValidationError('Description must be text of at most 1000 characters')
  return description
}

router.get('/manage', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const [inventory, networksResult, mappingsResult, rulesResult, assignmentsResult] = await Promise.all([
      loadPublicNetworkInventory(),
      supabaseAdmin.from('networks').select(NETWORK_MANAGEMENT_FIELDS).order('name'),
      supabaseAdmin.from('network_mappings').select('id, network_id, source_string, source_type').order('source_string'),
      supabaseAdmin.from('network_rules').select('id, network_id, pattern, match_type, match_field, priority, is_active').order('priority', { ascending: false }),
      supabaseAdmin.from('network_event_assignments').select('id, network_id, target_type, target_id').order('created_at'),
    ])
    for (const result of [networksResult, mappingsResult, rulesResult, assignmentsResult]) {
      if (result.error) throw result.error
    }
    const admin = hasRole(req, 'admin')
    const networks = await Promise.all((networksResult.data || []).map(async (network: NetworkRecord) => {
      const canEdit = admin || ownsIdentity(req, network.created_by)
      const canRename = canEdit || ownsIdentity(req, await getNetworkSourceOwner(network))
      return { ...publicNetwork(network), can_edit: canEdit, can_rename: canRename }
    }))
    const targets = inventory.targets.filter(target => admin || ownsIdentity(req, target.owner))
    const publicTargets = new Set(inventory.targets.map(target => `${target.target_type}:${target.target_id}`))
    res.json({
      networks, mappings: mappingsResult.data || [], rules: rulesResult.data || [],
      sources: inventory.sources.map(source => ({ key: source.key, name: source.name, can_rename: admin || ownsIdentity(req, source.owner) })),
      targets: targets.map(({ owner: _owner, ...target }) => target),
      assignments: (assignmentsResult.data || []).filter(row => publicTargets.has(`${row.target_type}:${row.target_id}`)),
    })
  } catch (error) {
    next(networkReadError(error))
  }
})

/** Guard: reject non-admin users */
function requireAdmin(req: AuthenticatedRequest, res: Response): boolean {
  if (!hasRole(req, 'admin')) {
    res.status(403).json({ error: 'Admin role required' })
    return false
  }
  return true
}

// ─── POST /api/network-relations/networks ────────────────────────────

router.post('/networks', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const name = sanitizeString(req.body.name, 200)
    const color = sanitizeString(req.body.color, 7)
    const description = parseNetworkDescription(req.body.description)

    if (!name) return res.status(400).json({ error: 'Name is required' })
    if (req.body.color !== undefined && (!color || !/^#[0-9a-fA-F]{6}$/.test(color))) {
      return res.status(400).json({ error: 'Color must be a valid hex color (e.g. #3B82F6)' })
    }
    const sourceKey = req.body.source_key
    let source: Awaited<ReturnType<typeof loadPublicNetworkInventory>>['sources'][number] | undefined
    if (sourceKey !== undefined) {
      if (typeof sourceKey !== 'string' || !/^source_[0-9a-f]{64}$/.test(sourceKey)) throw new ValidationError('Invalid source key')
      source = (await loadPublicNetworkInventory()).sources.find(candidate => candidate.key === sourceKey)
      if (!source) throw new ApplicationError('Source not found', 404, 'NOT_FOUND')
      if (!hasRole(req, 'admin') && !ownsIdentity(req, source.owner)) {
        throw new ApplicationError('Only the source owner or an admin can rename this source', 403, 'FORBIDDEN')
      }
    }
    const memberKeys = req.body.member_keys === undefined ? [] : await parseMemberKeys(req.body.member_keys)

    const { data, error } = await supabaseAdmin
      .from('networks')
      .insert({
        name,
        color: color || '#3B82F6',
        description: description || null,
        created_by: req.userEmail || req.userId,
        original_name: source?.name || name,
        source_key: source?.key || null,
        source_type: source?.source_type || null,
        source_id: source?.source_id || null,
        member_keys: memberKeys,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505' && source) {
        const result = await supabaseAdmin.rpc('join_event_network', {
          p_network_id: null, p_destination_name: name,
          p_source: { key: source.key, name: source.name, source_type: source.source_type, source_id: source.source_id, created_by: req.userEmail || req.userId },
        })
        if (result.error) throwNetworkWriteError(result.error)
        return res.status(201).json({ network: publicNetwork(result.data), joined: true })
      }
      if (error.code === '23505') {
        return res.status(409).json({ error: 'A network with this name already exists' })
      }
      throwNetworkWriteError(error)
    }

    res.status(201).json({ network: publicNetwork(data) })
  } catch (err) {
    next(err)
  }
})

// ─── PUT /api/network-relations/networks/:id ─────────────────────────

router.put('/networks/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const existing = await getNetwork(id)
    const canEdit = hasRole(req, 'admin') || ownsIdentity(req, existing.created_by)
    if (!canEdit && !ownsIdentity(req, await getNetworkSourceOwner(existing))) {
      throw new ApplicationError('Only the source owner, network creator or an admin can rename this network', 403, 'FORBIDDEN')
    }
    if (existing.merged_into) throw new ApplicationError('This network already joined another network. Edit the destination network instead.', 409, 'CONFLICT')
    if (!canEdit && (req.body.color !== undefined || req.body.description !== undefined || req.body.member_keys !== undefined)) {
      throw new ApplicationError('Source owners can change the display name only', 403, 'FORBIDDEN')
    }
    const name = sanitizeString(req.body.name, 200)
    const color = sanitizeString(req.body.color, 7)
    const description = parseNetworkDescription(req.body.description)

    if (!name) return res.status(400).json({ error: 'Name is required' })
    if (req.body.color !== undefined && (!color || !/^#[0-9a-fA-F]{6}$/.test(color))) {
      return res.status(400).json({ error: 'Color must be a valid hex color' })
    }

    const updates: Record<string, unknown> = { name, updated_at: new Date().toISOString() }
    if (req.body.color !== undefined) updates.color = color || '#3B82F6'
    if (req.body.description !== undefined) updates.description = description || null
    if (req.body.member_keys !== undefined) updates.member_keys = await parseMemberKeys(req.body.member_keys, existing.member_keys)
    const { data, error } = await supabaseAdmin
      .from('networks')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error?.code === '23505') {
      const result = await supabaseAdmin.rpc('join_event_network', { p_network_id: existing.id, p_destination_name: name })
      if (result.error) throwNetworkWriteError(result.error)
      return res.json({ network: publicNetwork(result.data), joined: true })
    }
    if (error) throwNetworkWriteError(error)
    if (!data) return res.status(404).json({ error: 'Network not found' })

    res.json({ network: publicNetwork(data) })
  } catch (err) {
    next(err)
  }
})

router.post('/assignments', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const network = await getNetwork(req.body.network_id)
    const targetId = sanitizeUUID(req.body.target_id)
    const targetType = req.body.target_type
    if (!targetId || (targetType !== 'user_event' && targetType !== 'meeting')) throw new ValidationError('Invalid event target')
    const target = (await loadPublicNetworkInventory()).targets.find(candidate =>
      candidate.target_type === targetType && candidate.target_id === targetId)
    if (!target) throw new ApplicationError('Public event not found', 404, 'NOT_FOUND')
    if (!hasRole(req, 'admin') && !ownsIdentity(req, target.owner)) {
      throw new ApplicationError('Only the event owner or an admin can assign networks', 403, 'FORBIDDEN')
    }
    const { data, error } = await supabaseAdmin.from('network_event_assignments')
      .upsert({ network_id: network.id, target_type: targetType, target_id: targetId, created_by: req.userEmail || req.userId },
        { onConflict: 'network_id,target_type,target_id', ignoreDuplicates: true })
      .select('id, network_id, target_type, target_id')
    if (error) throw error
    res.status(201).json({ assignments: data || [] })
  } catch (error) {
    next(error)
  }
})

router.delete('/assignments/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const id = sanitizeUUID(req.params.id)
    if (!id) throw new ValidationError('Invalid assignment id')
    const { data, error } = await supabaseAdmin.from('network_event_assignments')
      .select('id, target_type, target_id').eq('id', id).maybeSingle()
    if (error) throw error
    if (!data) throw new ApplicationError('Assignment not found', 404, 'NOT_FOUND')
    if (!hasRole(req, 'admin')) {
      const target = (await loadPublicNetworkInventory()).targets.find(candidate =>
        candidate.target_type === data.target_type && candidate.target_id === data.target_id)
      if (!target || !ownsIdentity(req, target.owner)) throw new ApplicationError('Only the event owner or an admin can remove this assignment', 403, 'FORBIDDEN')
    }
    const result = await supabaseAdmin.from('network_event_assignments').delete().eq('id', id)
    if (result.error) throw result.error
    res.json({ success: true })
  } catch (error) {
    next(error)
  }
})

// ─── DELETE /api/network-relations/networks/:id ──────────────────────

router.delete('/networks/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireAdmin(req, res)) return

  try {
    const id = sanitizeUUID(req.params.id)
    if (!id) throw new ValidationError('Invalid network id')
    const { error } = await supabaseAdmin
      .from('networks')
      .delete()
      .eq('id', id)

    if (error?.code === '23503') {
      throw new ApplicationError(
        'Automatic network deletion requires migration 040. Ask an administrator to apply it, then retry.',
        503, 'NETWORK_SCHEMA_REQUIRED',
      )
    }
    if (error) throwNetworkWriteError(error)
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

// ─── POST /api/network-relations/mappings ────────────────────────────

router.post('/mappings', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireAdmin(req, res)) return

  try {
    const network_id = sanitizeString(req.body.network_id, 36)
    const source_string = sanitizeString(req.body.source_string, 500)
    const source_type = sanitizeString(req.body.source_type, 50)

    if (!network_id || !source_string || !source_type) {
      return res.status(400).json({ error: 'network_id, source_string, and source_type are required' })
    }
    if (!['calendar_title', 'meeting_title', 'description'].includes(source_type)) {
      return res.status(400).json({ error: 'source_type must be calendar_title, meeting_title, or description' })
    }

    const { data, error } = await supabaseAdmin
      .from('network_mappings')
      .insert({
        network_id,
        source_string,
        source_type,
        created_by: req.userEmail || req.userId,
      })
      .select()
      .single()

    if (error) return res.status(500).json({ error: safeErrorMessage(error) })
    res.status(201).json({ mapping: data })
  } catch (err) {
    next(err)
  }
})

// PUT changes only the exact text and field, not network ownership.
router.put('/mappings/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireAdmin(req, res)) return
  try {
    const id = sanitizeUUID(req.params.id)
    const sourceString = sanitizeString(req.body.source_string, 500)
    const sourceType = req.body.source_type
    if (!id || !sourceString || !['calendar_title', 'meeting_title', 'description'].includes(sourceType)) {
      throw new ValidationError('A valid mapping id, exact source string and field are required')
    }
    const { data, error } = await supabaseAdmin.from('network_mappings')
      .update({ source_string: sourceString, source_type: sourceType }).eq('id', id).select().maybeSingle()
    if (error) throw error
    if (!data) throw new ApplicationError('Mapping not found', 404, 'NOT_FOUND')
    res.json({ mapping: data })
  } catch (error) {
    next(error)
  }
})

router.delete('/mappings/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireAdmin(req, res)) return

  try {
    const { id } = req.params
    const { error } = await supabaseAdmin
      .from('network_mappings')
      .delete()
      .eq('id', id)

    if (error) return res.status(500).json({ error: safeErrorMessage(error) })
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

// ─── POST /api/network-relations/rules ───────────────────────────────

router.post('/rules', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireAdmin(req, res)) return

  try {
    const network_id = sanitizeString(req.body.network_id, 36)
    const pattern = sanitizeString(req.body.pattern, 500)
    const match_type = sanitizeString(req.body.match_type, 20)
    const match_field = sanitizeString(req.body.match_field, 20)
    const priority = typeof req.body.priority === 'number' ? req.body.priority : 0

    if (!network_id || !pattern || !match_type || !match_field) {
      return res.status(400).json({ error: 'network_id, pattern, match_type, and match_field are required' })
    }
    if (!['contains', 'starts_with', 'exact', 'regex'].includes(match_type)) {
      return res.status(400).json({ error: 'match_type must be contains, starts_with, exact, or regex' })
    }
    if (!['calendar_title', 'meeting_title', 'description'].includes(match_field)) {
      return res.status(400).json({ error: 'match_field must be calendar_title, meeting_title, or description' })
    }

    // Validate regex patterns server-side to prevent ReDoS
    if (match_type === 'regex') {
      const redos = redosReason(pattern)
      if (redos) {
        return res.status(400).json({ error: redos })
      }
      try {
        new RegExp(pattern)
      } catch {
        return res.status(400).json({ error: 'Invalid regex pattern' })
      }
    }

    const { data, error } = await supabaseAdmin
      .from('network_rules')
      .insert({
        network_id,
        pattern,
        match_type,
        match_field,
        priority,
        created_by: req.userEmail || req.userId,
      })
      .select()
      .single()

    if (error) return res.status(500).json({ error: safeErrorMessage(error) })
    res.status(201).json({ rule: data })
  } catch (err) {
    next(err)
  }
})

// ─── PUT /api/network-relations/rules/:id ────────────────────────────

router.put('/rules/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireAdmin(req, res)) return

  try {
    const { id } = req.params
    const pattern = sanitizeString(req.body.pattern, 500)
    const match_type = sanitizeString(req.body.match_type, 20)
    const match_field = sanitizeString(req.body.match_field, 20)
    const priority = typeof req.body.priority === 'number' ? req.body.priority : undefined
    const is_active = typeof req.body.is_active === 'boolean' ? req.body.is_active : undefined

    const updates: Record<string, unknown> = {}
    if (pattern) updates.pattern = pattern
    if (match_type) {
      if (!['contains', 'starts_with', 'exact', 'regex'].includes(match_type)) {
        return res.status(400).json({ error: 'Invalid match_type' })
      }
      updates.match_type = match_type
    }
    if (match_field) {
      if (!['calendar_title', 'meeting_title', 'description'].includes(match_field)) {
        return res.status(400).json({ error: 'Invalid match_field' })
      }
      updates.match_field = match_field
    }
    if (priority !== undefined) updates.priority = priority
    if (is_active !== undefined) updates.is_active = is_active

    if (match_type === 'regex' && pattern) {
      const redos = redosReason(pattern)
      if (redos) {
        return res.status(400).json({ error: redos })
      }
      try {
        new RegExp(pattern)
      } catch {
        return res.status(400).json({ error: 'Invalid regex pattern' })
      }
    }

    const { data, error } = await supabaseAdmin
      .from('network_rules')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) return res.status(500).json({ error: safeErrorMessage(error) })
    if (!data) return res.status(404).json({ error: 'Rule not found' })

    res.json({ rule: data })
  } catch (err) {
    next(err)
  }
})

// ─── DELETE /api/network-relations/rules/:id ─────────────────────────

router.delete('/rules/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireAdmin(req, res)) return

  try {
    const { id } = req.params
    const { error } = await supabaseAdmin
      .from('network_rules')
      .delete()
      .eq('id', id)

    if (error) return res.status(500).json({ error: safeErrorMessage(error) })
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

export default router
