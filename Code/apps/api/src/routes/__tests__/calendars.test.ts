import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { errorHandler } from '../../middleware/error-handler.js'

// ─── Mock Supabase ──────────────────────────────────────────

const mockFrom = vi.fn()
const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockEq = vi.fn()
const mockSingle = vi.fn()
const mockMaybeSingle = vi.fn()
const mockOrder = vi.fn()
const mockIn = vi.fn()
const mockOr = vi.fn()
const mockUpsert = vi.fn()

function createChain(): Record<string, any> {
  const chain: Record<string, any> = {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    eq: mockEq,
    in: mockIn,
    single: mockSingle,
    maybeSingle: mockMaybeSingle,
    order: mockOrder,
    or: mockOr,
    upsert: mockUpsert,
    then: (resolve: (v: any) => void) => resolve({ data: [], error: null }),
  }
  return chain
}

vi.mock('../../supabaseClient.js', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => {
      mockFrom(...args)
      return createChain()
    },
  },
}))

// ─── Mock auth middleware with optional auth ─────────────────

const _mockUserId = '550e8400-e29b-41d4-a716-446655440000'
const mockEmail = 'test@example.com'
const authState = vi.hoisted(() => ({ authenticated: true }))

vi.mock('../../middleware/auth.js', () => {
  const mockHasCalPerm = vi.fn().mockReturnValue({ isCreator: true, canEdit: true })
  const mockHasCalPermAsync = vi.fn().mockResolvedValue({ isCreator: true, canEdit: true })
  return {
    optionalAuthMiddleware: (req: any, _res: any, next: any) => {
      if (!authState.authenticated) return next()
      req.userId = '550e8400-e29b-41d4-a716-446655440000'
      req.userEmail = 'test@example.com'
      req.userRole = 'user'
      req.userRoles = ['user']
      next()
    },
    hasCalendarEditPermission: mockHasCalPerm,
    hasCalendarEditPermissionAsync: mockHasCalPermAsync,
    AuthenticatedRequest: {},
  }
})

// ─── Test setup ─────────────────────────────────────────────

let app: express.Express

async function createApp() {
  const { default: calendarsRouter } = await import('../calendars.js')
  app = express()
  app.use(express.json())
  app.use('/api/calendars', calendarsRouter)
  app.use(errorHandler)
  return app
}

// ═══════════════════════════════════════════════════════════════

describe('Calendar Routes', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    authState.authenticated = true
    mockSelect.mockReturnThis()
    mockEq.mockReturnThis()
    mockInsert.mockReturnThis()
    mockUpdate.mockReturnThis()
    mockIn.mockReturnThis()
    mockOrder.mockReturnThis()
    mockOr.mockReturnThis()
    mockUpsert.mockReturnThis()
    // Re-set hasCalendarEditPermission after clearAllMocks
    const { hasCalendarEditPermission, hasCalendarEditPermissionAsync } = await import('../../middleware/auth.js') as any
    hasCalendarEditPermission.mockReturnValue({ isCreator: true, canEdit: true })
    hasCalendarEditPermissionAsync.mockResolvedValue({ isCreator: true, canEdit: true })
    await createApp()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ─── POST /api/calendars ──────────────────────────────────

  describe('POST /', () => {
    it('creates a calendar and returns 201', async () => {
      const mockCalendar = {
        id: 'cal-id-1',
        hash: 'abc1234567',
        title: 'Team Sync',
        created_by: mockEmail,
        config: { eventName: 'Team Sync' },
        visibility: 'unlisted',
      }

      mockSingle.mockResolvedValue({ data: mockCalendar, error: null })

      const res = await request(app)
        .post('/api/calendars')
        .send({ title: 'Team Sync', config: {}, permissions: { canEdit: [] } })

      expect(res.status).toBe(201)
      expect(res.body.title).toBe('Team Sync')
      expect(res.body.hash).toBeDefined()
    })

    it('returns the original calendar when creation is retried with the same id', async () => {
      const id = '20000000-0000-4000-8000-000000000001'
      const existing = {
        id,
        hash: 'stablehash1',
        title: 'Retry-safe calendar',
        created_by: mockEmail,
        config: { eventName: 'Retry-safe calendar' },
        permissions: { canEdit: [] },
        visibility: 'unlisted',
        creator_account_type: 'google',
      }
      mockSingle.mockResolvedValueOnce({
        data: null,
        error: { code: '23505', message: 'duplicate key value' },
      })
      mockMaybeSingle.mockResolvedValueOnce({ data: existing, error: null })

      const res = await request(app)
        .post('/api/calendars')
        .send({
          id,
          title: 'Retry-safe calendar',
          config: {},
          permissions: { canEdit: [] },
          visibility: 'unlisted',
          creator_account_type: 'google',
        })

      expect(res.status).toBe(200)
      expect(res.body.id).toBe(id)
      expect(mockInsert.mock.calls[0][0][0].id).toBe(id)
    })

    it('syncs config.eventName to title', async () => {
      mockSingle.mockResolvedValue({ data: { title: 'My Cal', config: { eventName: 'My Cal' } }, error: null })

      await request(app)
        .post('/api/calendars')
        .send({ title: 'My Cal', config: { eventName: 'Old Name' } })

      // Verify insert was called -- the config should have eventName matching title
      expect(mockInsert).toHaveBeenCalled()
    })

    it('uses server-verified identity for created_by', async () => {
      mockSingle.mockResolvedValue({
        data: { created_by: mockEmail },
        error: null,
      })

      await request(app)
        .post('/api/calendars')
        .send({ title: 'Test', created_by: 'attacker@evil.com' })

      // Verify the insert used the server-verified email, not client-supplied
      expect(mockFrom).toHaveBeenCalledWith('calendars')
      expect(mockInsert.mock.calls[0][0][0].created_by).toBe(mockEmail)
    })

    it('rejects unauthenticated creation with 401', async () => {
      authState.authenticated = false

      const res = await request(app)
        .post('/api/calendars')
        .send({ title: 'Spoofed', created_by: 'victim@example.com' })

      expect(res.status).toBe(401)
      expect(res.body.error).toBe('UNAUTHORIZED')
      expect(mockInsert).not.toHaveBeenCalled()
    })

    it('returns 400 on database error', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { message: 'duplicate key value' },
      })

      const res = await request(app)
        .post('/api/calendars')
        .send({ title: 'Dup Cal' })

      expect(res.status).toBe(400)
    })
  })

  // ─── GET /api/calendars/:hash ─────────────────────────────

  describe('GET /:hash', () => {
    it('returns a calendar by hash with ownership flags', async () => {
      const mockCal = {
        id: 'cal-1',
        hash: 'abc1234567',
        title: 'Team Sync',
        created_by: mockEmail,
        permissions: {},
        visibility: 'unlisted',
      }

      mockSingle.mockResolvedValue({ data: mockCal, error: null })

      const res = await request(app).get('/api/calendars/abc1234567')

      expect(res.status).toBe(200)
      expect(res.body.hash).toBe('abc1234567')
      expect(res.body.title).toBe('Team Sync')
      expect(res.body.has_edit_permission).toBe(true)

      const { hasCalendarEditPermissionAsync } = await import('../../middleware/auth.js') as any
      expect(hasCalendarEditPermissionAsync).toHaveBeenCalledWith(mockCal, expect.objectContaining({ userId: _mockUserId, userEmail: mockEmail }))
    })

    it('returns 404 for unknown hash', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { message: 'not found' },
      })

      const res = await request(app).get('/api/calendars/nonexistent')

      expect(res.status).toBe(404)
      expect(res.body.error).toBe('Calendar not found')
    })
  })

  // --- Input validation (POST) ---------------------------------

  describe('POST / input validation', () => {
    const post = (body: Record<string, unknown>) => request(app).post('/api/calendars').send(body)

    it('rejects a missing title with 400 VALIDATION_ERROR', async () => {
      const res = await post({ config: {} })
      expect(res.status).toBe(400)
      expect(res.body.error).toBe('VALIDATION_ERROR')
      expect(mockInsert).not.toHaveBeenCalled()
    })

    it('rejects a blank or oversized title', async () => {
      expect((await post({ title: '   ' })).status).toBe(400)
      expect((await post({ title: 'x'.repeat(201) })).status).toBe(400)
      expect((await post({ title: 12345 })).status).toBe(400)
      expect(mockInsert).not.toHaveBeenCalled()
    })

    it('rejects an invalid visibility', async () => {
      const res = await post({ title: 'Cal', visibility: 'secret' })
      expect(res.status).toBe(400)
      expect(res.body.error).toBe('VALIDATION_ERROR')
    })

    it('rejects non-object config and oversized config', async () => {
      expect((await post({ title: 'Cal', config: 'nope' })).status).toBe(400)
      expect((await post({ title: 'Cal', config: [1, 2] })).status).toBe(400)
      const big = await post({ title: 'Cal', config: { blob: 'x'.repeat(21 * 1024) } })
      expect(big.status).toBe(400)
      expect(mockInsert).not.toHaveBeenCalled()
    })

    it('rejects malformed permissions', async () => {
      expect((await post({ title: 'Cal', permissions: 'all' })).status).toBe(400)
      expect((await post({ title: 'Cal', permissions: { canEdit: 'a@b.com' } })).status).toBe(400)
      expect((await post({ title: 'Cal', permissions: { canEdit: [42] } })).status).toBe(400)
      expect((await post({ title: 'Cal', permissions: { canEdit: ['a'.repeat(321)] } })).status).toBe(400)
      const tooMany = Array.from({ length: 101 }, (_, i) => `u${i}@example.com`)
      expect((await post({ title: 'Cal', permissions: { canEdit: tooMany } })).status).toBe(400)
      expect(mockInsert).not.toHaveBeenCalled()
    })

    it('defaults unknown creator_account_type to google and keeps valid values', async () => {
      mockSingle.mockResolvedValue({ data: { id: '1' }, error: null })

      await post({ title: 'Cal', creator_account_type: 'admin' })
      expect(mockInsert.mock.calls[0][0][0].creator_account_type).toBe('google')

      await post({ title: 'Cal', creator_account_type: 'managed_cardano' })
      expect(mockInsert.mock.calls[1][0][0].creator_account_type).toBe('managed_cardano')
    })

    it('stores validated, trimmed values', async () => {
      mockSingle.mockResolvedValue({ data: { id: '1' }, error: null })

      const res = await post({
        title: '  Team Sync  ',
        config: { eventName: 'ignored' },
        visibility: 'public',
        permissions: { canEdit: ['a@example.com'] },
      })

      expect(res.status).toBe(201)
      const inserted = mockInsert.mock.calls[0][0][0]
      expect(inserted.title).toBe('Team Sync')
      expect(inserted.config.eventName).toBe('Team Sync')
      expect(inserted.visibility).toBe('public')
      expect(inserted.permissions).toEqual({ canEdit: ['a@example.com'] })
    })
  })

  // --- Input validation (PATCH) --------------------------------

  describe('PATCH /:hash input validation', () => {
    const patch = (body: Record<string, unknown>) => request(app).patch('/api/calendars/abc1234567').send(body)

    it('rejects blank or oversized title when provided', async () => {
      expect((await patch({ title: '' })).status).toBe(400)
      const res = await patch({ title: 'x'.repeat(201) })
      expect(res.status).toBe(400)
      expect(res.body.error).toBe('VALIDATION_ERROR')
      expect(mockUpdate).not.toHaveBeenCalled()

      mockSingle.mockResolvedValueOnce({
        data: { id: 'cal-1', hash: 'abc1234567', config: { hideDateNumbers: true } },
        error: null,
      })
      const oversizedRange = await request(app)
        .patch('/api/calendars/abc1234567')
        .send({
          config: {
            hideDateNumbers: false,
            customStartDate: '2026-01-01',
            customEndDate: '2028-01-01',
          },
        })

      expect(oversizedRange.status).toBe(400)
      expect(oversizedRange.body.error).toBe('VALIDATION_ERROR')
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('rejects invalid visibility and invalid config', async () => {
      expect((await patch({ visibility: 'private' })).status).toBe(400)
      expect((await patch({ config: 'x' })).status).toBe(400)
      expect((await patch({ config: { blob: 'x'.repeat(21 * 1024) } })).status).toBe(400)
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('accepts a valid update and syncs eventName to title', async () => {
      mockSingle
        .mockResolvedValueOnce({ data: { id: 'cal-1', hash: 'abc1234567', config: { a: 1 } }, error: null })
        .mockResolvedValueOnce({ data: { id: 'cal-1', title: 'New' }, error: null })

      const res = await patch({ title: ' New ', visibility: 'public' })

      expect(res.status).toBe(200)
      const payload = mockUpdate.mock.calls[0][0]
      expect(payload.title).toBe('New')
      expect(payload.visibility).toBe('public')
      expect(payload.config).toEqual({ a: 1, eventName: 'New' })
    })

    it('expands every participant weekly slot across the selected date range when disabling Any Week', async () => {
      const participants = [
        {
          id: 'availability-1',
          username: 'Alex',
          time_slots: ['2026-06-03_09:00', '2026-06-04_10:30', '2026-06-03_09:00'],
        },
        {
          id: 'availability-2',
          username: 'Sam',
          time_slots: ['2026-06-01_12:00'],
        },
      ]
      mockSingle
        .mockResolvedValueOnce({
          data: { id: 'cal-1', hash: 'abc1234567', config: { hideDateNumbers: true } },
          error: null,
        })
        .mockResolvedValueOnce({ data: { id: 'cal-1', config: { hideDateNumbers: false } }, error: null })
      mockOrder.mockResolvedValueOnce({ data: participants, error: null })

      const res = await request(app)
        .patch('/api/calendars/abc1234567')
        .send({
          config: {
            hideDateNumbers: false,
            customStartDate: '2026-06-10',
            customEndDate: '2026-06-24',
          },
        })

      expect(res.status).toBe(200)
      expect(mockFrom).toHaveBeenCalledWith('availability')
      expect(mockUpdate).toHaveBeenNthCalledWith(1, expect.objectContaining({
        time_slots: [
          '2026-06-10_09:00',
          '2026-06-17_09:00',
          '2026-06-24_09:00',
          '2026-06-11_10:30',
          '2026-06-18_10:30',
        ],
      }))
      expect(mockUpdate).toHaveBeenNthCalledWith(2, expect.objectContaining({
        time_slots: ['2026-06-15_12:00', '2026-06-22_12:00'],
      }))
      expect(res.body.convertedAvailability).toEqual([
        { username: 'Alex', time_slots: ['2026-06-10_09:00', '2026-06-17_09:00', '2026-06-24_09:00', '2026-06-11_10:30', '2026-06-18_10:30'] },
        { username: 'Sam', time_slots: ['2026-06-15_12:00', '2026-06-22_12:00'] },
      ])
    })

    it('does not update calendar settings when the conversion range is invalid', async () => {
      mockSingle.mockResolvedValueOnce({
        data: { id: 'cal-1', hash: 'abc1234567', config: { hideDateNumbers: true } },
        error: null,
      })

      const res = await request(app)
        .patch('/api/calendars/abc1234567')
        .send({
          config: {
            hideDateNumbers: false,
            customStartDate: '2026-02-30',
            customEndDate: '2026-03-01',
          },
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('VALIDATION_ERROR')
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('does not convert participant availability when the editor lacks permission', async () => {
      const { hasCalendarEditPermissionAsync } = await import('../../middleware/auth.js')
      vi.mocked(hasCalendarEditPermissionAsync).mockResolvedValue({ isCreator: false, canEdit: false })
      mockSingle.mockResolvedValueOnce({
        data: { id: 'cal-1', hash: 'abc1234567', config: { hideDateNumbers: true } },
        error: null,
      })

      const res = await request(app)
        .patch('/api/calendars/abc1234567')
        .send({
          config: {
            hideDateNumbers: false,
            customStartDate: '2026-06-10',
            customEndDate: '2026-06-24',
          },
        })

      expect(res.status).toBe(403)
      expect(mockFrom).toHaveBeenCalledTimes(1)
      expect(mockFrom).toHaveBeenCalledWith('calendars')
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('manually archives an Any Week calendar without converting participation', async () => {
      mockSingle
        .mockResolvedValueOnce({
          data: { id: 'cal-1', hash: 'abc1234567', config: { hideDateNumbers: true }, archived_at: null },
          error: null,
        })
        .mockResolvedValueOnce({ data: { id: 'cal-1' }, error: null })

      const res = await patch({ config: { hideDateNumbers: true, archived: true } })

      expect(res.status).toBe(200)
      expect(mockFrom).not.toHaveBeenCalledWith('availability')
      expect(mockUpdate).toHaveBeenCalledTimes(1)
      const payload = mockUpdate.mock.calls[0][0]
      expect(payload.config).toEqual({ hideDateNumbers: true, archived: true })
      expect(payload.archived_at).toEqual(expect.any(String))
    })

    it('keeps the original archived_at when re-saving an already archived calendar', async () => {
      mockSingle
        .mockResolvedValueOnce({
          data: {
            id: 'cal-1',
            hash: 'abc1234567',
            config: { hideDateNumbers: true, archived: true },
            archived_at: '2026-01-01T00:00:00.000Z',
          },
          error: null,
        })
        .mockResolvedValueOnce({ data: { id: 'cal-1' }, error: null })

      const res = await patch({ config: { hideDateNumbers: true, archived: true } })

      expect(res.status).toBe(200)
      expect(mockUpdate.mock.calls[0][0]).not.toHaveProperty('archived_at')
    })

    it('un-archives when switching back to Any Week and ignores archived for Date calendars', async () => {
      mockSingle
        .mockResolvedValueOnce({
          data: {
            id: 'cal-1',
            hash: 'abc1234567',
            config: { hideDateNumbers: true, archived: true },
            archived_at: '2026-01-01T00:00:00.000Z',
          },
          error: null,
        })
        .mockResolvedValueOnce({ data: { id: 'cal-1' }, error: null })
        .mockResolvedValueOnce({
          data: { id: 'cal-2', hash: 'abc1234567', config: { hideDateNumbers: false }, archived_at: null },
          error: null,
        })
        .mockResolvedValueOnce({ data: { id: 'cal-2' }, error: null })

      const unarchive = await patch({ config: { hideDateNumbers: true } })
      expect(unarchive.status).toBe(200)
      expect(mockUpdate.mock.calls[0][0]).toEqual(expect.objectContaining({
        config: { hideDateNumbers: true },
        archived_at: null,
        listing_expires_at: null,
      }))

      const dated = await patch({ config: { hideDateNumbers: false, archived: true } })
      expect(dated.status).toBe(200)
      const datedPayload = mockUpdate.mock.calls[1][0]
      expect(datedPayload.config).toEqual({ hideDateNumbers: false })
      expect(datedPayload).not.toHaveProperty('archived_at')
    })
  })

  // ─── Notification settings ────────────────────────────────

  describe('notification settings', () => {
    const ORGANISER_ID = '550e8400-e29b-41d4-a716-446655440000'
    const calendarRow = { id: 'cal-1', created_by: ORGANISER_ID, permissions: null }

    it('returns defaults with the organiser account email', async () => {
      mockMaybeSingle
        .mockResolvedValueOnce({ data: calendarRow, error: null })
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({ data: { id: ORGANISER_ID, email: 'organiser@example.com' }, error: null })

      const res = await request(app).get('/api/calendars/abc123/notification-settings')

      expect(res.status).toBe(200)
      expect(res.body).toEqual({
        enabled: true,
        email: null,
        notifyFrom: null,
        defaultEmail: 'organiser@example.com',
        effectiveEmail: 'organiser@example.com',
      })
    })

    it('saves a custom email, toggle and notify-from time', async () => {
      mockMaybeSingle
        .mockResolvedValueOnce({ data: calendarRow, error: null })
        .mockResolvedValueOnce({ data: { enabled: true, email: 'notify-inbox@example.com', notify_from: '2026-11-05T09:00:00.000Z' }, error: null })
        .mockResolvedValueOnce({ data: { id: ORGANISER_ID, email: 'organiser@example.com' }, error: null })

      const res = await request(app)
        .put('/api/calendars/abc123/notification-settings')
        .send({ enabled: true, email: 'Notify-Inbox@example.com', notifyFrom: '2026-11-05T09:00:00.000Z' })

      expect(res.status).toBe(200)
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ calendar_id: 'cal-1', enabled: true, email: 'notify-inbox@example.com', notify_from: '2026-11-05T09:00:00.000Z' }),
        { onConflict: 'calendar_id' },
      )
      expect(res.body.effectiveEmail).toBe('notify-inbox@example.com')
    })

    it('rejects invalid input before touching the database', async () => {
      const badEmail = await request(app).put('/api/calendars/abc123/notification-settings').send({ enabled: true, email: 'nope' })
      const badDate = await request(app).put('/api/calendars/abc123/notification-settings').send({ enabled: true, notifyFrom: 'tomorrow-ish' })
      const badToggle = await request(app).put('/api/calendars/abc123/notification-settings').send({ enabled: 'yes' })

      expect(badEmail.status).toBe(400)
      expect(badDate.status).toBe(400)
      expect(badToggle.status).toBe(400)
      expect(mockUpsert).not.toHaveBeenCalled()
    })

    it('allows only the organiser, not editors', async () => {
      const { hasCalendarEditPermissionAsync } = await import('../../middleware/auth.js') as any
      hasCalendarEditPermissionAsync.mockResolvedValueOnce({ isCreator: false, canEdit: true })
      mockMaybeSingle.mockResolvedValueOnce({ data: calendarRow, error: null })

      const res = await request(app).get('/api/calendars/abc123/notification-settings')

      expect(res.status).toBe(403)
    })

    it('requires authentication', async () => {
      authState.authenticated = false
      const res = await request(app).get('/api/calendars/abc123/notification-settings')
      expect(res.status).toBe(401)
    })
  })
})
