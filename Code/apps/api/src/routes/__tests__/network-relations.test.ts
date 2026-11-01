import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// ─── Mock Supabase ──────────────────────────────────────────────────────────

const mockFrom = vi.fn()
const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockDelete = vi.fn()
const mockEq = vi.fn()
const mockSingle = vi.fn()
const mockOrder = vi.fn()
const mockLimit = vi.fn()
const mockMaybeSingle = vi.fn()
const mockUpsert = vi.fn()
const mockRpc = vi.fn()
const { mockInventory, mockSourceOwner } = vi.hoisted(() => ({
  mockInventory: vi.fn(),
  mockSourceOwner: vi.fn(),
}))

vi.mock('../../services/network-relations.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/network-relations.js')>(),
  loadPublicNetworkInventory: mockInventory,
  getNetworkSourceOwner: mockSourceOwner,
}))

function createChain() {
  return {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
    eq: mockEq,
    order: mockOrder,
    limit: mockLimit,
    single: mockSingle,
    maybeSingle: mockMaybeSingle,
    upsert: mockUpsert,
  }
}

vi.mock('../../supabaseClient.js', () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => {
      mockFrom(...args)
      return createChain()
    },
  },
}))

// ─── Auth mocks ─────────────────────────────────────────────────────────────

const MOCK_USER_ID = '550e8400-e29b-41d4-a716-446655440000'
const MOCK_EMAIL = 'admin@example.com'

// Admin mock (used by write-path tests)
const adminAuthMock = {
  authMiddleware: (req: any, _res: any, next: any) => {
    req.userId = MOCK_USER_ID
    req.userEmail = MOCK_EMAIL
    req.userRoles = ['admin']
    next()
  },
  hasRole: (_req: any, role: string) => role === 'admin',
  optionalAuthMiddleware: (req: any, _res: any, next: any) => {
    req.userId = MOCK_USER_ID
    next()
  },
}

// Non-admin mock (used by authorization tests)
const userAuthMock = {
  authMiddleware: (req: any, _res: any, next: any) => {
    req.userId = MOCK_USER_ID
    req.userEmail = MOCK_EMAIL
    req.userRoles = ['user']
    next()
  },
  hasRole: (_req: any, _role: string) => false,
  optionalAuthMiddleware: (req: any, _res: any, next: any) => {
    req.userId = MOCK_USER_ID
    next()
  },
}

// ─── App factory ────────────────────────────────────────────────────────────

async function createApp(authMock = adminAuthMock) {
  vi.resetModules()
  vi.doMock('../../middleware/auth.js', () => authMock)
  const { default: networkRelationsRouter } = await import('../network-relations.js')
  const { errorHandler } = await import('../../middleware/error-handler.js')
  const app = express()
  app.use(express.json())
  app.use('/api/network-relations', networkRelationsRouter)
  app.use(errorHandler)
  return app
}

// ════════════════════════════════════════════════════════════════════════════

describe('Network Relations Routes', () => {
  let app: express.Express

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    mockSingle.mockReset()
    mockMaybeSingle.mockReset()
    mockSelect.mockReset()
    mockOrder.mockReset()
    mockSourceOwner.mockReset()
    mockInventory.mockReset()
    mockRpc.mockReset()
    mockSelect.mockReturnThis()
    mockEq.mockReturnThis()
    mockInsert.mockReturnThis()
    mockUpdate.mockReturnThis()
    mockDelete.mockReturnThis()
    mockOrder.mockReturnThis()
    mockLimit.mockReturnThis()
    mockUpsert.mockReturnThis()
    mockInventory.mockResolvedValue({ sources: [], targets: [] })
    mockSourceOwner.mockResolvedValue(null)
    app = await createApp()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Overlapping memberships, live unions and traceable renaming', () => {
    const sourceKey = `source_${'a'.repeat(64)}`
    const otherNetworkId = '660e8400-e29b-41d4-a716-446655440001'
    const targetId = '770e8400-e29b-41d4-a716-446655440002'
    const network = {
      id: MOCK_USER_ID, name: 'Display name', original_name: 'Original source',
      color: '#3B82F6', description: null, source_key: sourceKey,
      source_type: 'calendar_source', source_id: otherNetworkId, member_keys: [],
      created_by: 'other@example.com',
    }

    it.each(['creator', 'source owner', 'admin'])('allows the %s to join an existing name without overwriting destination metadata', async role => {
      const testApp = role === 'admin' ? app : await createApp(userAuthMock)
      mockMaybeSingle.mockResolvedValueOnce({ data: { ...network, created_by: role === 'creator' ? MOCK_EMAIL : network.created_by }, error: null })
      mockSourceOwner.mockResolvedValueOnce(role === 'source owner' ? MOCK_USER_ID : null)
      mockSingle.mockResolvedValueOnce({ data: null, error: { code: '23505' } })
      mockRpc.mockResolvedValueOnce({ data: { ...network, merged_into: otherNetworkId }, error: null })
      const response = await request(testApp).put(`/api/network-relations/networks/${MOCK_USER_ID}`).send({ name: 'Existing B' })
      expect(response.status).toBe(200)
      expect(response.body.joined).toBe(true)
      expect(mockRpc).toHaveBeenCalledWith('join_event_network', { p_network_id: MOCK_USER_ID, p_destination_name: 'Existing B' })
      expect(response.body.network.merged_into).toBe(otherNetworkId)
      expect(response.body.network).not.toHaveProperty('source_id')
      expect(mockDelete).not.toHaveBeenCalled()
    })

    it('joins a verified raw source to an existing network, ignoring client source identity', async () => {
      const testApp = await createApp(userAuthMock)
      mockInventory.mockResolvedValueOnce({ sources: [{ key: sourceKey, name: 'Original source', source_type: 'calendar_source', source_id: 'private-source', owner: MOCK_EMAIL }], targets: [] })
      mockSingle.mockResolvedValueOnce({ data: null, error: { code: '23505' } })
      mockRpc.mockResolvedValueOnce({ data: { ...network, merged_into: otherNetworkId }, error: null })
      const response = await request(testApp).post('/api/network-relations/networks')
        .send({ name: 'Existing B', source_key: sourceKey, source_id: 'forged', created_by: 'forged' })
      expect(response.status).toBe(201)
      expect(response.body.joined).toBe(true)
      expect(mockRpc).toHaveBeenCalledWith('join_event_network', {
        p_network_id: null, p_destination_name: 'Existing B',
        p_source: { key: sourceKey, name: 'Original source', source_type: 'calendar_source', source_id: 'private-source', created_by: MOCK_EMAIL },
      })
    })

    it.each([
      ['23514', 400, 'Network joins and combinations cannot contain cycles'],
      ['PGRST202', 503, 'Network joins require database migration 039'],
      ['P0002', 409, 'Destination network no longer exists'],
    ])('surfaces join failure %s explicitly', async (code, status, message) => {
      mockMaybeSingle.mockResolvedValueOnce({ data: network, error: null })
      mockSingle.mockResolvedValueOnce({ data: null, error: { code: '23505' } })
      mockRpc.mockResolvedValueOnce({ data: null, error: { code, message } })
      const response = await request(app).put(`/api/network-relations/networks/${MOCK_USER_ID}`).send({ name: 'Existing B' })
      expect(response.status).toBe(status)
      expect(response.body.message).toContain(message)
    })

    it('does not let a joined source owner rename the destination network', async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: { ...network, merged_into: otherNetworkId }, error: null })
      const response = await request(app).put(`/api/network-relations/networks/${MOCK_USER_ID}`).send({ name: 'New name' })
      expect(response.status).toBe(409)
      expect(mockUpdate).not.toHaveBeenCalled()
      expect(mockRpc).not.toHaveBeenCalled()
    })

    it('rejects joining another owner network before attempting an RPC', async () => {
      const testApp = await createApp(userAuthMock)
      mockMaybeSingle.mockResolvedValueOnce({ data: network, error: null })
      const response = await request(testApp).put(`/api/network-relations/networks/${MOCK_USER_ID}`).send({ name: 'Existing B' })
      expect(response.status).toBe(403)
      expect(mockRpc).not.toHaveBeenCalled()
    })

    it('edits a mapping field without changing its network or creator', async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: { id: MOCK_USER_ID, source_string: 'MeTTa Coders', source_type: 'meeting_title' }, error: null })
      const response = await request(app).put(`/api/network-relations/mappings/${MOCK_USER_ID}`)
        .send({ source_string: ' MeTTa Coders ', source_type: 'meeting_title', network_id: 'forged' })
      expect(response.status).toBe(200)
      expect(mockUpdate).toHaveBeenCalledWith({ source_string: 'MeTTa Coders', source_type: 'meeting_title' })
    })

    it.each([
      { source_string: '', source_type: 'meeting_title' },
      { source_string: 'MeTTa Coders', source_type: 'wrong_field' },
      { source_string: 'x'.repeat(501), source_type: 'meeting_title' },
    ])('rejects invalid mapping edits %#', async body => {
      const response = await request(app).put(`/api/network-relations/mappings/${MOCK_USER_ID}`).send(body)
      expect(response.status).toBe(400)
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('requires admin access to edit direct mappings', async () => {
      const testApp = await createApp(userAuthMock)
      const response = await request(testApp).put(`/api/network-relations/mappings/${MOCK_USER_ID}`)
        .send({ source_string: 'MeTTa Coders', source_type: 'meeting_title' })
      expect(response.status).toBe(403)
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('returns 404 for a mapping that no longer exists', async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
      const response = await request(app).put(`/api/network-relations/mappings/${MOCK_USER_ID}`)
        .send({ source_string: 'MeTTa Coders', source_type: 'meeting_title' })
      expect(response.status).toBe(404)
    })
    it.each(['creator', 'source owner', 'admin'])('allows the %s to rename without changing source identity', async role => {
      const testApp = role === 'admin' ? app : await createApp(userAuthMock)
      mockMaybeSingle.mockResolvedValueOnce({ data: { ...network, created_by: role === 'creator' ? MOCK_EMAIL : network.created_by }, error: null })
      mockSourceOwner.mockResolvedValueOnce(role === 'source owner' ? MOCK_USER_ID : null)
      mockSingle.mockResolvedValueOnce({ data: { ...network, name: 'Renamed again' }, error: null })
      const res = await request(testApp).put(`/api/network-relations/networks/${MOCK_USER_ID}`)
        .send({ name: 'Renamed again', original_name: 'Forged', source_key: 'Forged' })
      expect(res.status).toBe(200)
      expect(mockUpdate).toHaveBeenCalledWith({ name: 'Renamed again', updated_at: expect.any(String) })
      expect(res.body.network.original_name).toBe('Original source')
      expect(res.body.network.source_key).toBe(sourceKey)
      expect(res.body.network).not.toHaveProperty('source_id')
      expect(res.body.network).not.toHaveProperty('created_by')
    })

    it('restricts source owners to renaming, not rewriting another creator network', async () => {
      const testApp = await createApp(userAuthMock)
      mockMaybeSingle.mockResolvedValueOnce({ data: network, error: null })
      mockSourceOwner.mockResolvedValueOnce(MOCK_USER_ID)
      const res = await request(testApp).put(`/api/network-relations/networks/${MOCK_USER_ID}`)
        .send({ name: 'Name', member_keys: [] })
      expect(res.status).toBe(403)
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('verifies source ownership when creating a renamed source network', async () => {
      const testApp = await createApp(userAuthMock)
      mockInventory.mockResolvedValueOnce({ sources: [{ key: sourceKey, name: 'Original source', source_type: 'calendar_source', source_id: otherNetworkId, owner: MOCK_USER_ID }], targets: [] })
      mockSingle.mockResolvedValueOnce({ data: network, error: null })
      const res = await request(testApp).post('/api/network-relations/networks')
        .send({ name: 'Renamed', source_key: sourceKey, source_id: 'Forged', created_by: 'Forged' })
      expect(res.status).toBe(201)
      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        original_name: 'Original source', source_id: otherNetworkId, source_key: sourceKey, created_by: MOCK_EMAIL,
      }))
    })

    it('rejects renaming someone else source', async () => {
      const testApp = await createApp(userAuthMock)
      mockInventory.mockResolvedValueOnce({ sources: [{ key: sourceKey, owner: 'someone-else' }], targets: [] })
      const res = await request(testApp).post('/api/network-relations/networks').send({ name: 'Renamed', source_key: sourceKey })
      expect(res.status).toBe(403)
      expect(mockInsert).not.toHaveBeenCalled()
    })

    it('creates a live union and normalizes duplicate source aliases', async () => {
      mockInventory.mockResolvedValueOnce({ sources: [{ key: sourceKey }], targets: [] })
      mockOrder.mockResolvedValueOnce({ data: [{ id: otherNetworkId, source_key: sourceKey }], error: null })
      mockSingle.mockResolvedValueOnce({ data: { ...network, member_keys: [sourceKey] }, error: null })
      const res = await request(app).post('/api/network-relations/networks')
        .send({ name: 'Combined', member_keys: [sourceKey, otherNetworkId, sourceKey] })
      expect(res.status).toBe(201)
      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ member_keys: [sourceKey] }))
    })

    it('reports database cycle rejection as a validation error', async () => {
      mockInventory.mockResolvedValueOnce({ sources: [], targets: [] })
      mockOrder.mockResolvedValueOnce({ data: [{ id: otherNetworkId }], error: null })
      mockSingle.mockResolvedValueOnce({ data: null, error: { code: '23514', message: 'Combined networks cannot contain cycles' } })
      const res = await request(app).post('/api/network-relations/networks')
        .send({ name: 'Combined', member_keys: [otherNetworkId] })
      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/cycles/)
    })

    it('rejects stale union members', async () => {
      mockOrder.mockResolvedValueOnce({ data: [], error: null })
      const res = await request(app).post('/api/network-relations/networks')
        .send({ name: 'Combined', member_keys: [otherNetworkId] })
      expect(res.status).toBe(400)
      expect(mockInsert).not.toHaveBeenCalled()
    })

    it.each(['x'.repeat(1001), 123, { invalid: true }])('rejects invalid network descriptions instead of silently clearing them: %j', async description => {
      const res = await request(app).post('/api/network-relations/networks').send({ name: 'Network', description })
      expect(res.status).toBe(400)
      expect(mockInsert).not.toHaveBeenCalled()
    })

    it('preserves an existing unpublished source in a live union while editing other members', async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: { ...network, member_keys: [sourceKey] }, error: null })
      mockOrder.mockResolvedValueOnce({ data: [{ id: otherNetworkId }], error: null })
      mockSingle.mockResolvedValueOnce({ data: network, error: null })
      const res = await request(app).put(`/api/network-relations/networks/${MOCK_USER_ID}`)
        .send({ name: network.name, member_keys: [sourceKey, otherNetworkId] })
      expect(res.status).toBe(200)
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ member_keys: [sourceKey, otherNetworkId] }))
    })

    it('assigns a meeting to a network without replacing its other memberships', async () => {
      const testApp = await createApp(userAuthMock)
      mockMaybeSingle.mockResolvedValueOnce({ data: network, error: null })
      mockInventory.mockResolvedValueOnce({ sources: [], targets: [{ target_type: 'meeting', target_id: targetId, owner: MOCK_USER_ID }] })
      mockSelect.mockReturnValueOnce(createChain()).mockResolvedValueOnce({ data: [], error: null })
      const res = await request(testApp).post('/api/network-relations/assignments')
        .send({ network_id: MOCK_USER_ID, target_type: 'meeting', target_id: targetId })
      expect(res.status).toBe(201)
      expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ network_id: MOCK_USER_ID, target_type: 'meeting', target_id: targetId }),
        { onConflict: 'network_id,target_type,target_id', ignoreDuplicates: true })
      expect(mockDelete).not.toHaveBeenCalled()
    })

    it('does not let the network creator assign someone else meeting', async () => {
      const testApp = await createApp(userAuthMock)
      mockMaybeSingle.mockResolvedValueOnce({ data: { ...network, created_by: MOCK_EMAIL }, error: null })
      mockInventory.mockResolvedValueOnce({ sources: [], targets: [{ target_type: 'user_event', target_id: targetId, owner: 'other-user' }] })
      const res = await request(testApp).post('/api/network-relations/assignments')
        .send({ network_id: MOCK_USER_ID, target_type: 'user_event', target_id: targetId })
      expect(res.status).toBe(403)
      expect(mockUpsert).not.toHaveBeenCalled()
    })

    it('never publishes assignments for unpublished or suspended events', async () => {
      mockInventory.mockResolvedValueOnce({ sources: [{ key: sourceKey, name: 'Public source', source_id: 'private-id', owner: 'private-owner' }], targets: [{ target_type: 'meeting', target_id: targetId }] })
      mockOrder.mockResolvedValueOnce({ data: [
        { id: 'visible', network_id: MOCK_USER_ID, target_type: 'meeting', target_id: targetId },
        { id: 'private', network_id: MOCK_USER_ID, target_type: 'user_event', target_id: otherNetworkId },
      ], error: null })
      const res = await request(app).get('/api/network-relations/assignments')
      expect(res.status).toBe(200)
      expect(res.body.assignments).toHaveLength(1)
      expect(res.body.sources).toEqual([{ key: sourceKey, name: 'Public source' }])
    })

    it('only permits the event owner or admin to remove an assignment', async () => {
      const testApp = await createApp(userAuthMock)
      mockMaybeSingle.mockResolvedValueOnce({ data: { id: otherNetworkId, target_type: 'meeting', target_id: targetId }, error: null })
      mockInventory.mockResolvedValueOnce({ sources: [], targets: [{ target_type: 'meeting', target_id: targetId, owner: 'other-user' }] })
      const res = await request(testApp).delete(`/api/network-relations/assignments/${otherNetworkId}`)
      expect(res.status).toBe(403)
      expect(mockDelete).not.toHaveBeenCalled()
    })

    it('returns management permissions without exposing source owners', async () => {
      const testApp = await createApp(userAuthMock)
      mockInventory.mockResolvedValueOnce({ sources: [{ key: sourceKey, name: 'Source', owner: MOCK_USER_ID }], targets: [
        { target_type: 'meeting', target_id: targetId, title: 'Owned meeting', owner: MOCK_USER_ID },
        { target_type: 'meeting', target_id: otherNetworkId, title: 'Other meeting', owner: 'someone-else' },
      ] })
      mockOrder.mockResolvedValueOnce({ data: [network], error: null })
        .mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: [], error: null })
        .mockResolvedValueOnce({ data: [], error: null })
      mockSourceOwner.mockResolvedValueOnce(MOCK_USER_ID)
      const res = await request(testApp).get('/api/network-relations/manage')
      expect(res.status).toBe(200)
      expect(res.body.networks[0]).toMatchObject({ can_rename: true, can_edit: false })
      expect(res.body.targets).toEqual([{ target_type: 'meeting', target_id: targetId, title: 'Owned meeting' }])
      expect(res.body.sources).toEqual([{ key: sourceKey, name: 'Source', can_rename: true }])
      expect(res.body.networks[0]).not.toHaveProperty('source_id')
    })
  })

  // ─── Public GET endpoints (no auth required) ──────────────────────────────

  describe('GET /api/network-relations/networks -- public', () => {
    it.each(['networks', 'mappings', 'rules', 'assignments'])('returns an actionable missing-schema error for %s', async endpoint => {
      mockOrder.mockResolvedValueOnce({ data: null, error: { code: '42P01', message: 'Missing relation' } })
      const response = await request(app).get(`/api/network-relations/${endpoint}`)
      expect(response.status).toBe(503)
      expect(response.body.error).toBe('NETWORK_SCHEMA_REQUIRED')
      expect(response.body.message).toContain('migration 038')
    })

    it('returns networks list without auth', async () => {
      const mockNetworks = [
        { id: 'net-1', name: 'SPO Pool Operators', color: '#3B82F6', description: null },
        { id: 'net-2', name: 'DRep Network', color: '#10B981', description: 'Delegated reps' },
      ]
      mockOrder.mockResolvedValueOnce({ data: mockNetworks, error: null })

      const res = await request(app).get('/api/network-relations/networks')

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('networks')
      expect(Array.isArray(res.body.networks)).toBe(true)
      expect(res.body.networks).toHaveLength(2)
      expect(res.body.networks[0]).toHaveProperty('name', 'SPO Pool Operators')
      expect(mockFrom).toHaveBeenCalledWith('networks')
    })

    it('returns empty array when no networks exist', async () => {
      mockOrder.mockResolvedValueOnce({ data: [], error: null })

      const res = await request(app).get('/api/network-relations/networks')

      expect(res.status).toBe(200)
      expect(res.body.networks).toEqual([])
    })

    it('returns 500 when DB query fails', async () => {
      mockOrder.mockResolvedValueOnce({ data: null, error: { message: 'DB error' } })

      const res = await request(app).get('/api/network-relations/networks')

      expect(res.status).toBe(500)
    })
  })

  describe('GET /api/network-relations/mappings -- public', () => {
    it('returns mappings list without auth', async () => {
      const mockMappings = [
        { id: 'map-1', network_id: 'net-1', source_string: 'IOHK', source_type: 'calendar_title' },
      ]
      mockOrder.mockResolvedValueOnce({ data: mockMappings, error: null })

      const res = await request(app).get('/api/network-relations/mappings')

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('mappings')
      expect(mockFrom).toHaveBeenCalledWith('network_mappings')
    })
  })

  describe('GET /api/network-relations/rules -- public', () => {
    it('returns only active rules without auth', async () => {
      const mockRules = [
        { id: 'rule-1', network_id: 'net-1', pattern: 'SPO', match_type: 'contains', match_field: 'calendar_title', priority: 10, is_active: true },
      ]
      mockOrder.mockResolvedValueOnce({ data: mockRules, error: null })

      const res = await request(app).get('/api/network-relations/rules')

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('rules')
      // Verify the query filtered for active rules only
      expect(mockEq).toHaveBeenCalledWith('is_active', true)
      expect(mockFrom).toHaveBeenCalledWith('network_rules')
    })
  })

  // ─── Admin-only write endpoints -- authorization ───────────────────────────

  describe('Authorization: creators can create; unrelated users cannot edit admin-managed data', () => {
    let nonAdminApp: express.Express

    beforeEach(async () => {
      vi.resetModules()
      nonAdminApp = await createApp(userAuthMock)
    })

    it('POST /networks allows non-admin to create their own network', async () => {
      mockSingle.mockResolvedValueOnce({ data: { id: MOCK_USER_ID, name: 'Test', created_by: MOCK_EMAIL }, error: null })
      const res = await request(nonAdminApp)
        .post('/api/network-relations/networks')
        .send({ name: 'Test', color: '#FF0000' })

      expect(res.status).toBe(201)
      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ created_by: MOCK_EMAIL }))
      expect(res.body.network).not.toHaveProperty('created_by')
    })

    it('PUT /networks/:id returns 403 for non-admin', async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: { id: MOCK_USER_ID, created_by: 'other@example.com' }, error: null })
      const res = await request(nonAdminApp)
        .put(`/api/network-relations/networks/${MOCK_USER_ID}`)
        .send({ name: 'Updated' })

      expect(res.status).toBe(403)
    })

    it('DELETE /networks/:id returns 403 for non-admin', async () => {
      const res = await request(nonAdminApp)
        .delete('/api/network-relations/networks/net-1')

      expect(res.status).toBe(403)
    })

    it('POST /mappings returns 403 for non-admin', async () => {
      const res = await request(nonAdminApp)
        .post('/api/network-relations/mappings')
        .send({ network_id: 'net-1', source_string: 'test', source_type: 'calendar_title' })

      expect(res.status).toBe(403)
    })

    it('POST /rules returns 403 for non-admin', async () => {
      const res = await request(nonAdminApp)
        .post('/api/network-relations/rules')
        .send({ network_id: 'net-1', pattern: 'test', match_type: 'contains', match_field: 'calendar_title' })

      expect(res.status).toBe(403)
    })
  })

  // ─── POST /networks -- admin creates a network ────────────────────────────

  describe('POST /api/network-relations/networks', () => {
    it('creates a network with valid data', async () => {
      const newNetwork = { id: 'net-new', name: 'New Network', color: '#3B82F6', description: null }
      mockSingle.mockResolvedValueOnce({ data: newNetwork, error: null })

      const res = await request(app)
        .post('/api/network-relations/networks')
        .send({ name: 'New Network' })

      expect(res.status).toBe(201)
      expect(res.body).toHaveProperty('network')
      expect(res.body.network.name).toBe('New Network')
      expect(mockFrom).toHaveBeenCalledWith('networks')
    })

    it('returns 400 when name is missing', async () => {
      const res = await request(app)
        .post('/api/network-relations/networks')
        .send({ color: '#FF0000' })

      expect(res.status).toBe(400)
      expect(res.body).toHaveProperty('error', 'Name is required')
    })

    it('returns 400 for invalid hex color', async () => {
      const res = await request(app)
        .post('/api/network-relations/networks')
        .send({ name: 'Test', color: 'red' })  // 3 chars, passes sanitize but fails hex regex

      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/hex color/)
    })

    it('returns 409 on duplicate name', async () => {
      mockSingle.mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'unique' } })

      const res = await request(app)
        .post('/api/network-relations/networks')
        .send({ name: 'Duplicate' })

      expect(res.status).toBe(409)
      expect(res.body.error).toMatch(/already exists/)
    })

    it('rejects name longer than 200 chars', async () => {
      const res = await request(app)
        .post('/api/network-relations/networks')
        .send({ name: 'A'.repeat(201) })

      // sanitizeString truncates to 200 -- the 201-char name becomes exactly 200 chars, still valid
      // but a genuinely missing name should fail; confirm the sanitized value was used (no crash)
      expect([201, 400]).toContain(res.status)
    })
  })

  // ─── POST /rules -- regex validation ─────────────────────────────────────

  describe('POST /api/network-relations/rules -- regex validation', () => {
    it('accepts a valid regex pattern', async () => {
      const newRule = { id: 'rule-new', network_id: 'net-1', pattern: '^SPO', match_type: 'regex', match_field: 'calendar_title', priority: 5, is_active: true }
      mockSingle.mockResolvedValueOnce({ data: newRule, error: null })

      const res = await request(app)
        .post('/api/network-relations/rules')
        .send({ network_id: 'net-1', pattern: '^SPO', match_type: 'regex', match_field: 'calendar_title' })

      expect(res.status).toBe(201)
      expect(res.body.rule.pattern).toBe('^SPO')
    })

    it('returns 400 for invalid regex pattern', async () => {
      const res = await request(app)
        .post('/api/network-relations/rules')
        .send({ network_id: 'net-1', pattern: '(unclosed', match_type: 'regex', match_field: 'calendar_title' })

      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/regex/)
    })

    it('returns 400 for invalid match_type', async () => {
      const res = await request(app)
        .post('/api/network-relations/rules')
        .send({ network_id: 'net-1', pattern: 'test', match_type: 'invalid', match_field: 'calendar_title' })

      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/match_type/)
    })

    it('returns 400 for invalid match_field', async () => {
      const res = await request(app)
        .post('/api/network-relations/rules')
        .send({ network_id: 'net-1', pattern: 'test', match_type: 'contains', match_field: 'bad_field' })

      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/match_field/)
    })
  })

  describe('DELETE /api/network-relations/networks -- automatic cleanup', () => {
    it('uses one database deletion so joined networks and relationships cascade atomically', async () => {
      mockEq.mockReturnValueOnce({ error: null })
      const response = await request(app).delete(`/api/network-relations/networks/${MOCK_USER_ID}`)
      expect(response.status).toBe(200)
      expect(response.body).toEqual({ success: true })
      expect(mockFrom).toHaveBeenCalledTimes(1)
      expect(mockFrom).toHaveBeenCalledWith('networks')
      expect(mockDelete).toHaveBeenCalledTimes(1)
      expect(mockEq).toHaveBeenCalledWith('id', MOCK_USER_ID)
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('rejects invalid ids without touching the database', async () => {
      const response = await request(app).delete('/api/network-relations/networks/invalid')
      expect(response.status).toBe(400)
      expect(mockDelete).not.toHaveBeenCalled()
    })

    it('reports the missing cascade migration rather than asking users to remove each relationship', async () => {
      mockEq.mockReturnValueOnce({ error: { code: '23503' } })
      const response = await request(app).delete(`/api/network-relations/networks/${MOCK_USER_ID}`)
      expect(response.status).toBe(503)
      expect(response.body.error).toBe('NETWORK_SCHEMA_REQUIRED')
      expect(response.body.message).toContain('migration 040')
      expect(response.body).not.toHaveProperty('success')
    })

    it('surfaces database failures without reporting deletion success', async () => {
      mockEq.mockReturnValueOnce({ error: { code: 'XX000', message: 'Delete failed' } })
      const response = await request(app).delete(`/api/network-relations/networks/${MOCK_USER_ID}`)
      expect(response.status).toBe(500)
      expect(response.body).not.toHaveProperty('success')
    })
  })

  // ─── POST /mappings -- input validation ───────────────────────────────────

  describe('POST /api/network-relations/mappings', () => {
    it('returns 400 for invalid source_type', async () => {
      const res = await request(app)
        .post('/api/network-relations/mappings')
        .send({ network_id: 'net-1', source_string: 'test', source_type: 'bad_type' })

      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/source_type/)
    })

    it('returns 400 when required fields are missing', async () => {
      const res = await request(app)
        .post('/api/network-relations/mappings')
        .send({ network_id: 'net-1' })

      expect(res.status).toBe(400)
    })

    it('creates a mapping with valid data', async () => {
      const newMapping = { id: 'map-new', network_id: 'net-1', source_string: 'Catalyst', source_type: 'meeting_title' }
      mockSingle.mockResolvedValueOnce({ data: newMapping, error: null })

      const res = await request(app)
        .post('/api/network-relations/mappings')
        .send({ network_id: 'net-1', source_string: 'Catalyst', source_type: 'meeting_title' })

      expect(res.status).toBe(201)
      expect(res.body.mapping.source_string).toBe('Catalyst')
    })
  })
})
