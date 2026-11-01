import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { errorHandler } from '../../middleware/error-handler.js'

// ─── Mock Supabase ──────────────────────────────────────────

const mockFrom = vi.fn()
const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockDelete = vi.fn()
const mockEq = vi.fn()
const mockNot = vi.fn()
const mockSingle = vi.fn()
const mockMaybeSingle = vi.fn()
const mockOrder = vi.fn()

function createChain() {
  return {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
    eq: mockEq,
    not: mockNot,
    single: mockSingle,
    maybeSingle: mockMaybeSingle,
    order: mockOrder,
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
const MOCK_EMAIL = 'test@example.com'

const mockHasCalendarEditPermission = vi.fn()
const mockHasCalendarEditPermissionAsync = vi.fn()

vi.mock('../../middleware/auth.js', () => ({
  optionalAuthMiddleware: (req: any, _res: any, next: any) => {
    req.userId = MOCK_USER_ID
    req.userEmail = MOCK_EMAIL
    req.userRole = 'user'
    req.userRoles = ['user']
    next()
  },
  hasCalendarEditPermission: (...args: unknown[]) => mockHasCalendarEditPermission(...args),
  hasCalendarEditPermissionAsync: (...args: unknown[]) => mockHasCalendarEditPermissionAsync(...args),
  AuthenticatedRequest: {},
}))

// ─── Test setup ─────────────────────────────────────────────

let app: express.Express

async function createApp() {
  const { default: meetingsRouter } = await import('../meetings.js')
  app = express()
  app.use(express.json())
  app.use('/api/meetings', meetingsRouter)
  app.use(errorHandler)
  return app
}

// ═══════════════════════════════════════════════════════════════

describe('Meetings Routes', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockSelect.mockReturnThis()
    mockEq.mockReturnThis()
    mockNot.mockReturnThis()
    mockInsert.mockReturnThis()
    mockUpdate.mockReturnThis()
    mockDelete.mockReturnThis()
    mockOrder.mockReturnThis()
    mockSingle.mockResolvedValue({ data: null, error: null })
    mockMaybeSingle.mockResolvedValue({ data: null, error: null })
    mockHasCalendarEditPermission.mockReturnValue({ isCreator: true, canEdit: true })
    mockHasCalendarEditPermissionAsync.mockResolvedValue({ isCreator: true, canEdit: true })
    await createApp()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ─── POST /api/meetings ───────────────────────────────────

  describe('POST /', () => {
    it('creates a meeting when user is calendar creator', async () => {
      // Calendar lookup
      mockSingle.mockResolvedValueOnce({
        data: { id: 'cal-1', created_by: MOCK_EMAIL, permissions: {} },
        error: null,
      })
      // Meeting insert
      mockSingle.mockResolvedValueOnce({
        data: {
          id: 'meeting-1',
          title: 'Standup',
          start_time: '2026-04-20T09:00:00Z',
          end_time: '2026-04-20T09:30:00Z',
        },
        error: null,
      })

      const res = await request(app)
        .post('/api/meetings')
        .send({
          calendar_hash: 'abc123',
          title: 'Standup',
          start_time: '2026-04-20T09:00:00Z',
          end_time: '2026-04-20T09:30:00Z',
          duration_minutes: 30,
          time_slots: ['2026-04-20T09:00'],
        })

      expect(res.status).toBe(201)
      expect(res.body.title).toBe('Standup')
    })

    it('returns an existing meeting on an idempotent retry', async () => {
      const id = '20000000-0000-4000-8000-000000000001'
      const meeting = {
        id,
        calendar_id: 'cal-1',
        created_by: MOCK_EMAIL,
        title: 'Retry-safe meeting',
        description: null,
        start_time: '2026-04-20T09:00:00.000Z',
        end_time: '2026-04-20T09:30:00.000Z',
        duration_minutes: 30,
        meeting_link: null,
        time_slots: ['2026-04-20T09:00:00.000Z'],
        recurrence_rule: null,
      }
      mockSingle.mockResolvedValueOnce({
        data: { id: 'cal-1', created_by: MOCK_EMAIL, permissions: {} },
        error: null,
      })
      mockMaybeSingle.mockResolvedValueOnce({ data: meeting, error: null })

      const res = await request(app)
        .post('/api/meetings')
        .send({
          id,
          calendar_hash: 'abc123',
          title: 'Retry-safe meeting',
          start_time: meeting.start_time,
          end_time: meeting.end_time,
          duration_minutes: 30,
          time_slots: meeting.time_slots,
        })

      expect(res.status).toBe(200)
      expect(res.body.id).toBe(id)
      expect(mockInsert).not.toHaveBeenCalled()
    })

    it('clears a manual archive when a new meeting is planned', async () => {
      mockSingle.mockResolvedValueOnce({
        data: {
          id: 'cal-1',
          created_by: MOCK_EMAIL,
          permissions: {},
          config: { hideDateNumbers: true, archived: true, eventName: 'Weekly' },
        },
        error: null,
      })
      mockSingle.mockResolvedValueOnce({ data: { id: 'meeting-1', title: 'Standup' }, error: null })

      const res = await request(app)
        .post('/api/meetings')
        .send({
          calendar_hash: 'abc123',
          title: 'Standup',
          start_time: '2026-04-20T09:00:00Z',
          end_time: '2026-04-20T09:30:00Z',
          duration_minutes: 30,
          time_slots: ['2026-04-20T09:00'],
        })

      expect(res.status).toBe(201)
      expect(mockUpdate).toHaveBeenCalledWith({
        config: { hideDateNumbers: true, eventName: 'Weekly' },
        archived_at: null,
        listing_expires_at: null,
      })
      expect(mockNot).not.toHaveBeenCalled()
    })

    it('returns 400 when required fields are missing', async () => {
      const res = await request(app)
        .post('/api/meetings')
        .send({ calendar_hash: 'abc123', title: 'Test' })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Missing required fields')
    })

    it('returns 404 when calendar not found', async () => {
      mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'not found' } })

      const res = await request(app)
        .post('/api/meetings')
        .send({
          calendar_hash: 'bad',
          title: 'Test',
          start_time: '2026-04-20T09:00:00Z',
          end_time: '2026-04-20T09:30:00Z',
          duration_minutes: 30,
          time_slots: ['slot'],
        })

      expect(res.status).toBe(404)
    })

    it('returns 403 when user is not calendar creator', async () => {
      mockSingle.mockResolvedValueOnce({
        data: { id: 'cal-1', created_by: 'other@user.com', permissions: {}, visibility: 'unlisted' },
        error: null,
      })
      mockHasCalendarEditPermission.mockReturnValue({ isCreator: false, canEdit: false })
      mockHasCalendarEditPermissionAsync.mockResolvedValue({ isCreator: false, canEdit: false })

      const res = await request(app)
        .post('/api/meetings')
        .send({
          calendar_hash: 'abc123',
          title: 'Test',
          start_time: '2026-04-20T09:00:00Z',
          end_time: '2026-04-20T09:30:00Z',
          duration_minutes: 30,
          time_slots: ['slot'],
        })

      expect(res.status).toBe(403)
      expect(res.body.error).toContain('permission')
    })
  })

  // ─── GET /api/meetings/single/:meetingId ──────────────────

  describe('GET /single/:meetingId', () => {
    it('returns a meeting with calendar info', async () => {
      mockSingle.mockResolvedValue({
        data: {
          id: '11111111-1111-4111-8111-111111111111',
          title: 'Standup',
          start_time: '2026-04-20T09:00:00',
          end_time: '2026-04-20T09:30:00',
          duration_minutes: 30,
          meeting_link: null,
          calendars: { hash: 'abc123', title: 'Team', visibility: 'unlisted' },
        },
        error: null,
      })

      const res = await request(app).get('/api/meetings/single/11111111-1111-4111-8111-111111111111')

      expect(res.status).toBe(200)
      expect(res.body.meeting.title).toBe('Standup')
      expect(res.body.meeting.calendar_hash).toBe('abc123')
      // Should append Z to timestamps without timezone suffix
      expect(res.body.meeting.start_time).toBe('2026-04-20T09:00:00Z')
    })

    it('returns 404 when meeting not found', async () => {
      mockSingle.mockResolvedValue({ data: null, error: { message: 'not found' } })

      const res = await request(app).get('/api/meetings/single/nonexistent')

      expect(res.status).toBe(404)
    })

    it('resolves a recurring meeting to the next upcoming occurrence, not the original stored date', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-09-13T12:00:00Z'))

      mockSingle.mockResolvedValue({
        data: {
          id: '11111111-1111-4111-8111-111111111111',
          title: 'Odin Weekly',
          // Series originally started Aug 3 -- long since past
          start_time: '2026-08-03T17:00:00Z',
          end_time: '2026-08-03T18:30:00Z',
          duration_minutes: 90,
          meeting_link: null,
          recurrence_rule: { type: 'weekly', endType: 'never' },
          calendars: { hash: 'abc123', title: 'Team', visibility: 'unlisted' },
        },
        error: null,
      })

      const res = await request(app).get('/api/meetings/single/11111111-1111-4111-8111-111111111111')

      expect(res.status).toBe(200)
      // Next Monday occurrence on/after "now" (Sep 7 has passed, next is Sep 14)
      expect(res.body.meeting.start_time).toBe('2026-09-14T17:00:00.000Z')
      expect(res.body.meeting.end_time).toBe('2026-09-14T18:30:00.000Z')

      vi.useRealTimers()
    })

    it('resolves a recurring standalone public event (no parent calendar) to the next occurrence, honoring exceptions', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-09-13T12:00:00Z'))

      // First .single() call is the `meetings` lookup (miss), second is `user_events` (hit)
      mockSingle
        .mockResolvedValueOnce({ data: null, error: { message: 'not found' } })
        .mockResolvedValueOnce({
          data: {
            id: '7a711d84-b261-434f-9997-260279b04c6e',
            title: 'ODIN',
            description: null,
            meeting_link: null,
            location: null,
            source_type: 'manual',
            source_id: null,
            is_public: true,
            // Base occurrence (Aug 3) and the next two weeks are all cancelled
            start_time: '2026-08-03T17:00:00+00:00',
            end_time: '2026-08-03T18:30:00+00:00',
            recurrence_rule: {
              type: 'weekly',
              endType: 'never',
              exceptions: ['2026-08-03', '2026-08-10', '2026-08-24', '2026-08-31'],
            },
          },
          error: null,
        })

      const res = await request(app).get('/api/meetings/single/7a711d84-b261-434f-9997-260279b04c6e')

      expect(res.status).toBe(200)
      expect(res.body.meeting.kind).toBe('event')
      // Sep 7 already passed relative to "now"; Sep 14 is the next valid (non-excluded) occurrence
      expect(res.body.meeting.start_time).toBe('2026-09-14T17:00:00.000Z')
      expect(res.body.meeting.end_time).toBe('2026-09-14T18:30:00.000Z')

      vi.useRealTimers()
    })

    it('resolves a monthlyWeek recurring public event to its upcoming week occurrence', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-09-13T12:00:00Z'))

      mockSingle
        .mockResolvedValueOnce({ data: null, error: { message: 'not found' } })
        .mockResolvedValueOnce({
          data: {
            id: '7a711d84-b261-434f-9997-260279b04c6e',
            title: 'ODIN',
            description: null,
            meeting_link: null,
            location: null,
            source_type: 'manual',
            source_id: null,
            is_public: true,
            // Base occurrence (Aug 3, 2026 - 1st Monday)
            start_time: '2026-08-03T17:00:00+00:00',
            end_time: '2026-08-03T18:30:00+00:00',
            recurrence_rule: {
              type: 'monthlyWeek',
              monthWeeks: [1, 2, 3],
              endType: 'never',
            },
          },
          error: null,
        })

      const res = await request(app).get('/api/meetings/single/7a711d84-b261-434f-9997-260279b04c6e')

      expect(res.status).toBe(200)
      expect(res.body.meeting.kind).toBe('event')
      // Sep 7 (week 1) already passed relative to "now"; Sep 14 (week 2) is the next valid occurrence
      expect(res.body.meeting.start_time).toBe('2026-09-14T17:00:00.000Z')
      expect(res.body.meeting.end_time).toBe('2026-09-14T18:30:00.000Z')

      vi.useRealTimers()
    })
  })

  // ─── GET /api/meetings/:hash ──────────────────────────────

  describe('GET /:hash', () => {
    it('returns all meetings for a calendar with UTC timestamps', async () => {
      mockSingle.mockResolvedValueOnce({ data: { id: 'cal-1' }, error: null })
      mockOrder.mockResolvedValueOnce({
        data: [
          { id: 'm1', start_time: '2026-04-20T09:00:00', end_time: '2026-04-20T09:30:00' },
          { id: 'm2', start_time: '2026-04-21T09:00:00Z', end_time: '2026-04-21T09:30:00Z' },
        ],
        error: null,
      })

      const res = await request(app).get('/api/meetings/abc123')

      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(2)
      // First meeting should have Z appended
      expect(res.body[0].start_time).toBe('2026-04-20T09:00:00Z')
      // Second already had Z, should stay unchanged
      expect(res.body[1].start_time).toBe('2026-04-21T09:00:00Z')
    })

    it('returns 404 when calendar not found', async () => {
      mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'not found' } })

      const res = await request(app).get('/api/meetings/bad')

      expect(res.status).toBe(404)
    })
  })

  // ─── PUT /api/meetings/:id ────────────────────────────────

  describe('PUT /:id', () => {
    it('updates a meeting when user has permission', async () => {
      // Meeting lookup
      mockSingle.mockResolvedValueOnce({
        data: { id: 'meeting-1', calendar_id: 'cal-1' },
        error: null,
      })
      // Calendar lookup
      mockSingle.mockResolvedValueOnce({
        data: { created_by: MOCK_EMAIL, permissions: {} },
        error: null,
      })
      // Update result
      mockSingle.mockResolvedValueOnce({
        data: { id: 'meeting-1', title: 'Updated' },
        error: null,
      })

      const res = await request(app)
        .put('/api/meetings/meeting-1')
        .send({ title: 'Updated' })

      expect(res.status).toBe(200)
    })

    it('returns 403 when user lacks permission', async () => {
      mockSingle.mockResolvedValueOnce({
        data: { id: 'meeting-1', calendar_id: 'cal-1' },
        error: null,
      })
      mockSingle.mockResolvedValueOnce({
        data: { created_by: 'other@user.com', permissions: {} },
        error: null,
      })
      mockHasCalendarEditPermission.mockReturnValue({ isCreator: false, canEdit: false })

      const res = await request(app)
        .put('/api/meetings/meeting-1')
        .send({ title: 'Hacked' })

      expect(res.status).toBe(403)
    })
  })

  // ─── DELETE /api/meetings/:id ─────────────────────────────

  describe('DELETE /:id', () => {
    it('deletes a meeting when user is creator', async () => {
      mockSingle.mockResolvedValueOnce({
        data: { id: 'meeting-1', calendar_id: 'cal-1' },
        error: null,
      })
      mockSingle.mockResolvedValueOnce({
        data: { created_by: MOCK_EMAIL, permissions: {} },
        error: null,
      })
      // Delete chain: .delete().eq() - terminal eq returns chain, error undefined = success

      const res = await request(app).delete('/api/meetings/meeting-1')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('returns 403 when user is not creator', async () => {
      mockSingle.mockResolvedValueOnce({
        data: { id: 'meeting-1', calendar_id: 'cal-1' },
        error: null,
      })
      mockSingle.mockResolvedValueOnce({
        data: { created_by: 'other@user.com', permissions: {} },
        error: null,
      })
      mockHasCalendarEditPermission.mockReturnValue({ isCreator: false, canEdit: false })

      const res = await request(app).delete('/api/meetings/meeting-1')

      expect(res.status).toBe(403)
    })

    it('returns 404 when meeting not found', async () => {
      mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'not found' } })

      const res = await request(app).delete('/api/meetings/nonexistent')

      expect(res.status).toBe(404)
    })
  })
})
