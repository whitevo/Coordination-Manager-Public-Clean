import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { errorHandler } from '../../middleware/error-handler.js'

// ─── Mock Supabase ──────────────────────────────────────────

const mockFrom = vi.fn()
const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockUpsert = vi.fn()
const mockUpdate = vi.fn()
const mockDelete = vi.fn()
const mockEq = vi.fn()
const mockSingle = vi.fn()
const mockOrder = vi.fn()
const mockMaybeSingle = vi.fn()
const mockNotify = vi.fn()

vi.mock('../../services/calendar-notifications.js', () => ({
  notifyParticipationChange: (...args: unknown[]) => mockNotify(...args),
}))

function createChain() {
  return {
    select: mockSelect,
    insert: mockInsert,
    upsert: mockUpsert,
    update: mockUpdate,
    delete: mockDelete,
    eq: mockEq,
    single: mockSingle,
    order: mockOrder,
    maybeSingle: mockMaybeSingle,
  }
}

vi.mock('../../supabaseClient.js', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => {
      mockFrom(...args)
      return createChain()
    },
  },
}))

// ─── Mock auth ──────────────────────────────────────────────

const MOCK_USER_ID = '550e8400-e29b-41d4-a716-446655440000'

vi.mock('../../middleware/auth.js', () => ({
  optionalAuthMiddleware: (req: any, _res: any, next: any) => {
    req.userId = MOCK_USER_ID
    req.userEmail = 'test@example.com'
    req.userRole = 'user'
    req.userRoles = ['user']
    next()
  },
  authMiddleware: (req: any, _res: any, next: any) => {
    req.userId = MOCK_USER_ID
    req.userEmail = 'test@example.com'
    next()
  },
  AuthenticatedRequest: {},
}))

// ─── Test setup ─────────────────────────────────────────────

let app: express.Express

async function createApp() {
  const { default: availabilityRouter } = await import('../availability.js')
  app = express()
  app.use(express.json())
  app.use('/api/availability', availabilityRouter)
  app.use(errorHandler)
  return app
}

// ═══════════════════════════════════════════════════════════════

describe('Availability Routes', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockSelect.mockReturnThis()
    mockEq.mockReturnThis()
    mockInsert.mockReturnThis()
    mockUpsert.mockReturnThis()
    mockUpdate.mockReturnThis()
    mockDelete.mockReturnThis()
    mockOrder.mockReturnThis()
    await createApp()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ─── POST /api/availability (add mode) ────────────────────

  describe('POST / (add mode)', () => {
    it('merges new time slots with existing', async () => {
      // Calendar lookup
      mockSingle.mockResolvedValueOnce({ data: { id: 'cal-1' }, error: null })
      // Existing availability
      mockSingle.mockResolvedValueOnce({ data: { time_slots: ['2026-04-17T10:00'] }, error: null })
      // Upsert result
      mockSingle.mockResolvedValueOnce({
        data: { time_slots: ['2026-04-17T10:00', '2026-04-17T11:00'] },
        error: null,
      })

      const res = await request(app)
        .post('/api/availability')
        .send({
          calendar_hash: 'abc123',
          username: 'TestUser',
          time_slots: ['2026-04-17T11:00'],
        })

      expect(res.status).toBe(200)
      expect(mockFrom).toHaveBeenCalledWith('calendars')
      expect(mockFrom).toHaveBeenCalledWith('availability')
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
        participantName: 'TestUser',
        before: ['2026-04-17T10:00'],
        after: ['2026-04-17T10:00', '2026-04-17T11:00'],
        actor: { userId: MOCK_USER_ID, email: 'test@example.com' },
      }))
    })

    it('returns 400 when required fields are missing', async () => {
      const res = await request(app)
        .post('/api/availability')
        .send({ calendar_hash: 'abc123' })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Missing required fields')
    })

    it('returns 400 for invalid mode', async () => {
      const res = await request(app)
        .post('/api/availability')
        .send({
          calendar_hash: 'abc123',
          username: 'Test',
          time_slots: ['slot'],
          mode: 'invalid',
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Invalid mode')
    })

    it('returns 404 when calendar not found', async () => {
      mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'not found' } })

      const res = await request(app)
        .post('/api/availability')
        .send({
          calendar_hash: 'nonexistent',
          username: 'Test',
          time_slots: ['slot'],
        })

      expect(res.status).toBe(404)
      expect(res.body.error).toBe('Calendar not found')
    })
  })

  // ─── POST /api/availability (remove mode) ─────────────────

  describe('POST / (remove mode)', () => {
    it('removes specified slots and deletes record if empty', async () => {
      // Calendar lookup
      mockSingle.mockResolvedValueOnce({ data: { id: 'cal-1' }, error: null })
      // Existing availability (only one slot that will be removed)
      mockSingle.mockResolvedValueOnce({ data: { time_slots: ['2026-04-17T10:00'] }, error: null })

      const res = await request(app)
        .post('/api/availability')
        .send({
          calendar_hash: 'abc123',
          username: 'TestUser',
          time_slots: ['2026-04-17T10:00'],
          mode: 'remove',
        })

      expect(res.status).toBe(200)
      expect(res.body.time_slots).toEqual([])
      // Should have called delete on the availability record
      expect(mockDelete).toHaveBeenCalled()
    })
  })

  // ─── GET /api/availability/:hash ──────────────────────────

  describe('GET /:hash', () => {
    it('returns all availability for a calendar', async () => {
      // Calendar lookup
      mockSingle.mockResolvedValueOnce({ data: { id: 'cal-1' }, error: null })
      // Availability data (from order chain)
      mockOrder.mockResolvedValueOnce({
        data: [
          { id: 'a1', username: 'Alice', time_slots: ['2026-04-17T10:00'] },
          { id: 'a2', username: 'Bob', time_slots: ['2026-04-17T11:00'] },
        ],
        error: null,
      })

      const res = await request(app).get('/api/availability/abc123')

      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(2)
    })

    it('returns 404 when calendar not found', async () => {
      mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'not found' } })

      const res = await request(app).get('/api/availability/nonexistent')

      expect(res.status).toBe(404)
    })
  })

  // ─── DELETE /api/availability ──────────────────────────────

  describe('DELETE /', () => {
    it('deletes availability and returns success', async () => {
      // Calendar lookup
      mockSingle.mockResolvedValueOnce({ data: { id: 'cal-1' }, error: null })
      mockMaybeSingle.mockResolvedValueOnce({ data: { time_slots: ['2026-04-17_10:00'] }, error: null })
      // Delete chain: .delete().eq().eq() - terminal eq returns chain, error is undefined = success

      const res = await request(app)
        .delete('/api/availability')
        .send({ calendar_hash: 'abc123', username: 'TestUser' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
        participantName: 'TestUser',
        before: ['2026-04-17_10:00'],
        after: [],
      }))
    })

    it('returns 400 when required fields are missing', async () => {
      const res = await request(app)
        .delete('/api/availability')
        .send({})

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Missing required fields')
    })

    it('returns 404 when calendar not found', async () => {
      mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'not found' } })

      const res = await request(app)
        .delete('/api/availability')
        .send({ calendar_hash: 'bad', username: 'User' })

      expect(res.status).toBe(404)
    })
  })
})
