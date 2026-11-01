import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const mockFrom = vi.fn()
const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockOrder = vi.fn()
const mockRange = vi.fn()
const mockLimit = vi.fn()
const mockSingle = vi.fn()
const mockInsert = vi.fn()
const mockQueryResult = vi.fn()
const mockIn = vi.fn()
const mockNot = vi.fn()
const mockUpdate = vi.fn()
const mockMaybeSingle = vi.fn()
const mockUpsert = vi.fn()
const mockDelete = vi.fn()
const mockLt = vi.fn()
const mockOr = vi.fn()
const mockRpc = vi.fn()
let mockUserId: string | undefined = 'test-user-123'

function createChain() {
  return {
    select: mockSelect,
    eq: mockEq,
    order: mockOrder,
    range: mockRange,
    limit: mockLimit,
    single: mockSingle,
    insert: mockInsert,
    in: mockIn,
    not: mockNot,
    update: mockUpdate,
    maybeSingle: mockMaybeSingle,
    upsert: mockUpsert,
    delete: mockDelete,
    lt: mockLt,
    or: mockOr,
    then: (resolve: (result: unknown) => void) => resolve(mockQueryResult()),
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

vi.mock('../../middleware/auth.js', () => ({
  authMiddleware: (req: express.Request & { userId?: string }, _res: express.Response, next: express.NextFunction) => {
    req.userId = mockUserId
    next()
  },
  AuthenticatedRequest: {},
}))

vi.mock('../../services/event-moderation.js', () => ({
  expireOverdueEventFlags: vi.fn().mockResolvedValue(undefined),
  clearEventTargetsSuspension: vi.fn().mockResolvedValue(undefined),
}))

describe('GET /api/user-events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUserId = 'test-user-123'
    mockRpc.mockReset().mockResolvedValue({ data: 0, error: null })
    mockSelect.mockReturnThis()
    mockEq.mockReturnThis()
    mockOrder.mockReturnThis()
    mockLt.mockReturnThis()
    mockOr.mockReturnThis()
    mockInsert.mockReturnThis()
    mockIn.mockReturnThis()
    mockNot.mockReturnThis()
    mockUpdate.mockReturnThis()
    mockUpsert.mockReset().mockReturnThis()
    mockDelete.mockReset().mockReturnThis()
    mockRange.mockReset().mockResolvedValue({ data: [], error: null })
    mockQueryResult.mockReturnValue({ data: [], error: null })
  })

  async function recurrenceApp() {
    const { default: userEventsRouter } = await import('../user-events.js')
    const app = express()
    app.use(express.json())
    app.use('/api/user-events', userEventsRouter)
    return app
  }

  it('finds active series independently of the calendar window', async () => {
    mockLimit.mockResolvedValueOnce({ data: [{ id: 'outside-window' }], error: null })
    const response = await request(await recurrenceApp()).get('/api/user-events/conditional-recurrences')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ active: true })
    expect(mockEq).toHaveBeenCalledWith('user_id', 'test-user-123')
    expect(mockEq).toHaveBeenCalledWith('status', 'active')
    expect(mockLt).not.toHaveBeenCalled()
  })

  it('advances conditional recurrences with the verified identity, not a client identity', async () => {
    mockRpc.mockResolvedValue({ data: 1, error: null })
    const response = await request(await recurrenceApp()).post('/api/user-events/conditional-recurrences/check')
      .send({ userId: 'another-user', recurrence_id: 'history' })
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ created: 1 })
    expect(mockRpc).toHaveBeenCalledWith('advance_time_item_recurrences', { p_user_id: 'test-user-123' })
  })

  it('surfaces generation failures rather than reporting success', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'Database unavailable' } })
    const response = await request(await recurrenceApp()).post('/api/user-events/conditional-recurrences/check')
    expect(response.status).toBe(500)
    expect(response.body.error).toBe('RECURRENCE_CHECK_FAILED')
  })

  it('requires authentication for recurrence generation', async () => {
    mockUserId = undefined
    const response = await request(await recurrenceApp()).post('/api/user-events/conditional-recurrences/check')
    expect(response.status).toBe(401)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('rejects invalid client ids for retry-safe event creation', async () => {
    const response = await request(await recurrenceApp())
      .post('/api/user-events')
      .send({
        id: 'not-a-uuid',
        title: 'Mailbox invite',
        start_time: '2026-11-01T10:00:00.000Z',
        end_time: '2026-11-01T11:00:00.000Z',
      })

    expect(response.status).toBe(400)
    expect(response.body.error).toContain('id must be a valid UUID')
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('returns an existing owned event when an idempotent create is repeated', async () => {
    const id = '20000000-0000-4000-8000-000000000001'
    const modeId = '30000000-0000-4000-8000-000000000001'
    const existing = {
      id,
      user_id: 'test-user-123',
      source_type: 'manual',
      title: 'Mailbox invite',
      description: null,
      meeting_link: null,
      location: null,
      start_time: '2026-11-01T10:00:00.000Z',
      end_time: '2026-11-01T11:00:00.000Z',
      is_public: false,
      source_id: modeId,
      category_ids: [],
      recurrence_rule: null,
      recurrence_id: null,
    }
    mockMaybeSingle
      .mockResolvedValueOnce({ data: { id: modeId }, error: null })
      .mockResolvedValueOnce({ data: existing, error: null })

    const response = await request(await recurrenceApp())
      .post('/api/user-events')
      .send({
        id,
        title: 'Mailbox invite',
        start_time: existing.start_time,
        end_time: existing.end_time,
        source_id: modeId,
        category_ids: [],
      })

    expect(response.status).toBe(200)
    expect(response.body.event.id).toBe(id)
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('completes using the latest item id and returns its completion separately from series status', async () => {
    const id = '20000000-0000-4000-8000-000000000001'
    const recurrence = { id: 'shared', status: 'completed', recurrence_rule: { type: 'weekly', endType: 'whenCompleted' } }
    const event = { id, recurrence_id: 'shared', completed_at: '2026-10-17T13:20:00Z' }
    mockRpc.mockResolvedValue({ data: recurrence, error: null })
    mockSingle.mockResolvedValueOnce({ data: event, error: null })
    const response = await request(await recurrenceApp()).post(`/api/user-events/${id}/complete-recurrence`)
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ recurrence, event: { ...event, recurrence } })
    expect(mockRpc).toHaveBeenCalledWith('complete_time_item_recurrence', { p_user_id: 'test-user-123', p_event_id: id })
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockEq).toHaveBeenCalledWith('id', id)
    expect(mockEq).toHaveBeenCalledWith('user_id', 'test-user-123')
  })

  it('does not report success if the current Time Item completion is missing', async () => {
    mockRpc.mockResolvedValue({ data: { id: 'shared', status: 'completed' }, error: null })
    mockSingle.mockResolvedValueOnce({ data: { id: 'latest', completed_at: null }, error: null })
    const response = await request(await recurrenceApp())
      .post('/api/user-events/20000000-0000-4000-8000-000000000001/complete-recurrence')
    expect(response.status).toBe(500)
    expect(response.body.error).toBe('RECURRENCE_COMPLETION_FAILED')
  })

  it('reports a conflict when generation has made the requested item historical', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Complete recurrence on the latest occurrence' } })
    const response = await request(await recurrenceApp())
      .post('/api/user-events/20000000-0000-4000-8000-000000000001/complete-recurrence')
    expect(response.status).toBe(409)
    expect(response.body.message).toBe('Complete recurrence on the latest occurrence')
  })

  it('rejects invalid occurrence ids before database access', async () => {
    const response = await request(await recurrenceApp()).post('/api/user-events/not-a-uuid/complete-recurrence')
    expect(response.status).toBe(400)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('resolves the latest occurrence across windows under the same owner', async () => {
    const id = '20000000-0000-4000-8000-000000000001'
    const series = { id: 'shared', latest_event_id: 'latest', status: 'active', recurrence_rule: { type: 'weekly', endType: 'whenCompleted' } }
    mockMaybeSingle.mockResolvedValueOnce({ data: { recurrence_id: 'shared' }, error: null })
      .mockResolvedValueOnce({ data: { id: 'latest', recurrence_id: 'shared' }, error: null })
    mockSingle.mockResolvedValueOnce({ data: series, error: null })
    mockQueryResult.mockReturnValue({ data: [series], error: null })
    const response = await request(await recurrenceApp()).get(`/api/user-events/${id}/latest-occurrence`)
    expect(response.status).toBe(200)
    expect(response.body.event).toMatchObject({ id: 'latest', recurrence_id: 'shared', recurrence: series })
    expect(mockEq.mock.calls.filter(([key]) => key === 'user_id')).toHaveLength(4)
  })

  it('returns shared completion status and rules on historical list items', async () => {
    const series = { id: 'shared', status: 'completed', latest_event_id: 'latest', recurrence_rule: { type: 'weekly', endType: 'whenCompleted' } }
    mockRange.mockResolvedValueOnce({ data: [{ id: 'history', recurrence_id: 'shared', source_type: 'manual' }], error: null })
    mockQueryResult.mockReturnValue({ data: [series], error: null })
    const response = await request(await recurrenceApp()).get('/api/user-events')
    expect(response.status).toBe(200)
    expect(response.body.events[0]).toMatchObject({ id: 'history', recurrence_rule: series.recurrence_rule, recurrence: series })
  })

  it('returns all pages so far-future manual events are not truncated at 1000 rows', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({
      id: `event-${index + 1}`,
      source_id: 'mode-main',
      source_type: 'manual',
      start_time: `2026-01-${String((index % 28) + 1).padStart(2, '0')}T09:00:00.000Z`,
    }))
    const futureEvent = {
      id: 'event-future-1001',
      source_id: 'mode-main',
      source_type: 'manual',
      start_time: '2030-12-31T09:00:00.000Z',
    }
    mockRange
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({ data: [futureEvent], error: null })

    const { default: userEventsRouter } = await import('../user-events.js')
    const app = express()
    app.use('/api/user-events', userEventsRouter)

    const response = await request(app).get('/api/user-events')

    expect(response.status).toBe(200)
    expect(response.body.events).toHaveLength(1001)
    expect(response.body.events.at(-1)).toMatchObject(futureEvent)
    expect(mockRange).toHaveBeenNthCalledWith(1, 0, 999)
    expect(mockRange).toHaveBeenNthCalledWith(2, 1000, 1999)
  })

  it('scopes window queries by owner, overlap and recurring masters while retaining pagination', async () => {
    mockRange.mockResolvedValueOnce({
      data: [
        { id: 'old-series', start_time: '2020-01-01T09:00:00Z', recurrence_rule: { type: 'weekly' } },
        { id: 'spanning', start_time: '2026-10-04T23:00:00Z', end_time: '2026-10-05T01:00:00Z' },
      ],
      error: null,
    })
    const { default: router } = await import('../user-events.js')
    const app = express()
    app.use('/api/user-events', router)
    const response = await request(app).get('/api/user-events').query({
      windowStart: '2026-10-05T00:00:00Z', windowEnd: '2026-10-12T00:00:00Z',
    })
    expect(response.status).toBe(200)
    expect(response.body.events).toHaveLength(2)
    expect(response.body.scope).toEqual({
      kind: 'window', windowStart: '2026-10-05T00:00:00.000Z', windowEnd: '2026-10-12T00:00:00.000Z',
    })
    expect(response.body.revision).toBeUndefined()
    expect(mockEq).toHaveBeenCalledWith('user_id', 'test-user-123')
    expect(mockLt).toHaveBeenCalledWith('start_time', '2026-10-12T00:00:00.000Z')
    expect(mockOr).toHaveBeenCalledWith('end_time.gt.2026-10-05T00:00:00.000Z,and(recurrence_rule.not.is.null,recurrence_rule->>type.neq.none)')
    expect(mockOrder).toHaveBeenCalledWith('id', { ascending: true })
  })

  it.each([
    { windowStart: '2026-10-05T00:00:00Z' },
    { windowStart: 'invalid', windowEnd: '2026-10-12T00:00:00Z' },
    { windowStart: '2026-02-30T00:00:00Z', windowEnd: '2026-03-05T00:00:00Z' },
    { windowStart: '2026-10-12T00:00:00Z', windowEnd: '2026-10-05T00:00:00Z' },
    { windowStart: '2026-10-05T00:00:00Z', windowEnd: '2027-10-05T00:00:00Z' },
  ])('rejects invalid windows before accessing the database: %j', async query => {
    const { default: router } = await import('../user-events.js')
    const app = express()
    app.use('/api/user-events', router)
    const response = await request(app).get('/api/user-events').query(query)
    expect(response.status).toBe(400)
    expect(response.body.error).toBe('VALIDATION_ERROR')
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('returns a compact revision that changes when event count or latest update changes', async () => {
    mockLimit.mockResolvedValueOnce({
      data: [{ updated_at: '2026-09-23T20:00:00.000Z' }],
      count: 42,
      error: null,
    })

    const { default: userEventsRouter } = await import('../user-events.js')
    const app = express()
    app.use('/api/user-events', userEventsRouter)

    const response = await request(app).get('/api/user-events/revision')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      revision: '42:2026-09-23T20:00:00.000Z',
    })
    expect(mockSelect).toHaveBeenCalledWith('updated_at', { count: 'exact' })
    expect(mockEq).toHaveBeenCalledWith('user_id', 'test-user-123')
    expect(mockOrder).toHaveBeenCalledWith('updated_at', { ascending: false })
    expect(mockLimit).toHaveBeenCalledWith(1)
  })

  it('returns stored meeting links as locations for existing time items without a location', async () => {
    mockRange.mockResolvedValueOnce({
      data: [
        { id: 'legacy-meeting', source_type: 'manual', source_id: null, meeting_link: 'https://meet.example.com/team', location: null },
        { id: 'physical-location', source_type: 'manual', source_id: null, meeting_link: 'https://meet.example.com/team', location: 'Room B' },
        { id: 'empty-item', source_type: 'manual', source_id: null, meeting_link: null, location: null },
      ],
      error: null,
    })

    const { default: userEventsRouter } = await import('../user-events.js')
    const app = express()
    app.use('/api/user-events', userEventsRouter)

    const response = await request(app).get('/api/user-events')

    expect(response.status).toBe(200)
    expect(response.body.events.map((event: { location: string | null }) => event.location))
      .toEqual(['https://meet.example.com/team', 'https://meet.example.com/team', null])
    expect(response.body.events[1].description).toBe('Location: Room B')
  })

  it.each([
    { description: 'Agenda', location: 'Room B', expected: 'Agenda\n\nLocation: Room B' },
    { description: 'Agenda\n\nLocation: Room B', location: 'Room B', expected: 'Agenda\n\nLocation: Room B' },
    { description: 'Agenda', location: 'https://meet.example.com/team', expected: 'Agenda' },
  ])('preserves hybrid location details without duplicating description lines: $description', async ({ description, location, expected }) => {
    mockRange.mockResolvedValueOnce({
      data: [{ id: 'hybrid-item', source_type: 'google_oauth', source_id: null, description, meeting_link: 'https://meet.example.com/team', location }],
      error: null,
    })
    const { default: userEventsRouter } = await import('../user-events.js')
    const app = express()
    app.use('/api/user-events', userEventsRouter)

    const response = await request(app).get('/api/user-events')

    expect(response.status).toBe(200)
    expect(response.body.events[0]).toMatchObject({
      location: 'https://meet.example.com/team',
      description: expected,
    })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it.each([
    { location: null, expectedDescription: null },
    { location: 'Room B', expectedDescription: 'Location: Room B' },
  ])('persists the meeting link and preserves location details when creating a manual meeting: $location', async ({ location, expectedDescription }) => {
    const modeId = '11111111-1111-4111-8111-111111111111'
    const meetingLink = 'https://meet.example.com/team'
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: modeId }, error: null })
    mockSingle.mockResolvedValueOnce({
      data: { id: 'event-123', meeting_link: meetingLink, location: meetingLink },
      error: null,
    })

    const { default: userEventsRouter } = await import('../user-events.js')
    const app = express()
    app.use(express.json())
    app.use('/api/user-events', userEventsRouter)

    const response = await request(app).post('/api/user-events').send({
      title: 'Planning',
      meeting_link: meetingLink,
      location,
      source_id: modeId,
      start_time: '2026-10-02T09:00:00Z',
      end_time: '2026-10-02T10:00:00Z',
    })

    expect(response.status).toBe(201)
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      meeting_link: meetingLink,
      location: meetingLink,
      description: expectedDescription,
    }))
  })

  it.each([3, -1, 14, 1.5, '3'])('validates recurrence interval position when saving a split series: %s', async (weekOffsetDays) => {
    const eventId = '11111111-1111-4111-8111-111111111111'
    mockSingle.mockResolvedValueOnce({ data: { id: eventId }, error: null })
    const { default: userEventsRouter } = await import('../user-events.js')
    const app = express()
    app.use(express.json())
    app.use('/api/user-events', userEventsRouter)
    const response = await request(app).put(`/api/user-events/${eventId}`).send({
      recurrence_rule: { type: 'custom', unit: 'week', interval: 2, weekDays: [0, 3], weekOffsetDays },
    })
    expect(response.status).toBe(200)
    const rule = mockUpdate.mock.calls[0][0].recurrence_rule
    if (weekOffsetDays === 3) expect(rule.weekOffsetDays).toBe(3)
    else expect(rule).not.toHaveProperty('weekOffsetDays')
    expect(mockEq).toHaveBeenCalledWith('user_id', 'test-user-123')
  })

  it.each([
    { input: { location: 'Room B' }, expected: 'Room B' },
    { input: { meeting_link: 'https://meet.example.com/team' }, expected: 'https://meet.example.com/team' },
    { input: { location: null }, expected: null },
    { input: { meeting_link: null }, expected: null },
  ])('does not overwrite the other source field on a single-field edit: $input', async ({ input, expected }) => {
    const eventId = '11111111-1111-4111-8111-111111111111'
    mockSingle.mockResolvedValueOnce({ data: { id: eventId }, error: null })
    const { default: userEventsRouter } = await import('../user-events.js')
    const app = express()
    app.use(express.json())
    app.use('/api/user-events', userEventsRouter)

    const response = await request(app).put(`/api/user-events/${eventId}`).send(input)

    expect(response.status).toBe(200)
    const editedField = 'location' in input ? 'location' : 'meeting_link'
    const preservedField = editedField === 'location' ? 'meeting_link' : 'location'
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ [editedField]: expected }))
    expect(mockUpdate.mock.calls[0][0]).not.toHaveProperty(preservedField)
    expect(mockEq).toHaveBeenCalledWith('user_id', 'test-user-123')
  })

  it.each(['https://meet.example.com/planning', 'Conference Room B', null])(
    'preserves the shared meeting location when importing a calendar: %s',
    async (meetingLocation) => {
      const meeting = {
        id: 'meeting-123',
        title: 'Planning',
        meeting_link: meetingLocation,
        start_time: '2026-10-02T09:00:00',
        end_time: '2026-10-02T10:00:00',
      }
      mockSingle.mockResolvedValueOnce({
        data: { id: 'calendar-123', hash: 'calendarHash', title: 'Team' },
        error: null,
      })
      mockQueryResult
        .mockReturnValueOnce({ data: [meeting], error: null })
        .mockReturnValueOnce({ data: [], error: null })
        .mockReturnValueOnce({ data: [{ ...meeting, location: meetingLocation }], error: null })

      const { default: userEventsRouter } = await import('../user-events.js')
      const app = express()
      app.use(express.json())
      app.use('/api/user-events', userEventsRouter)

      const response = await request(app)
        .post('/api/user-events/import/coordination-calendar')
        .send({ calendar_hash: 'calendarHash' })

      expect(response.status).toBe(200)
      expect(response.body.imported).toBe(1)
      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          meeting_link: meetingLocation,
          location: meetingLocation,
          source_type: 'coordination_calendar',
          external_event_id: meeting.id,
        }),
      ])
    },
  )

  it('repairs an imported meeting with an empty location during resync', async () => {
    const meetingLocation = 'Conference Room B'
    const meeting = {
      id: 'meeting-123',
      title: 'Planning',
      description: null,
      meeting_link: meetingLocation,
      start_time: '2026-10-02T09:00:00Z',
      end_time: '2026-10-02T10:00:00Z',
    }
    const source = { source_type: 'coordination_calendar', source_id: 'calendarHash' }
    mockSingle.mockResolvedValueOnce({
      data: { id: 'calendar-123', hash: source.source_id, title: 'Team' },
      error: null,
    })
    mockQueryResult
      .mockReturnValueOnce({ data: [source], error: null })
      .mockReturnValueOnce({ data: [meeting], error: null })
      .mockReturnValueOnce({ data: [], error: null })
    mockRange
      .mockResolvedValueOnce({
        data: [{ ...meeting, id: 'event-123', external_event_id: meeting.id, location: null }],
        error: null,
      })

    const { default: userEventsRouter } = await import('../user-events.js')
    const app = express()
    app.use(express.json())
    app.use('/api/user-events', userEventsRouter)

    const response = await request(app)
      .post('/api/user-events/sync-imports')
      .send({ time_min: '2026-10-01T00:00:00Z', time_max: '2026-11-01T00:00:00Z' })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ inserted: 0, updated: 1, deleted: 0 })
    expect(response.body.results[0]).not.toHaveProperty('error')
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      meeting_link: meetingLocation,
      location: meetingLocation,
    }))
    expect(mockEq).toHaveBeenCalledWith('id', 'event-123')
  })

  describe('imported event reconciliation', () => {
    const source = { source_type: 'coordination_calendar', source_id: 'calendarHash' }
    const meeting = {
      id: 'meeting-123',
      title: 'Planning',
      description: 'Agenda',
      meeting_link: 'https://meet.example.com/planning',
      start_time: '2026-10-02T09:00:00.000Z',
      end_time: '2026-10-02T10:00:00.000Z',
    }
    const existingEvent = {
      ...meeting,
      id: 'event-123',
      external_event_id: meeting.id,
      location: meeting.meeting_link,
      start_time: '2026-10-02T09:00:00+00:00',
      end_time: '2026-10-02T10:00:00+00:00',
      is_public: true,
    }

    async function sync(sourceConfig: { source_type: string; source_id: string } = source) {
      const { default: userEventsRouter } = await import('../user-events.js')
      const app = express()
      app.use(express.json())
      app.use('/api/user-events', userEventsRouter)
      return request(app).post('/api/user-events/sync-imports').send({
        time_min: '2026-10-01T00:00:00Z',
        time_max: '2026-11-01T00:00:00Z',
        source_configs: [sourceConfig],
      })
    }

    function prepareSync(
      meetings: Array<typeof meeting>,
      pages: Array<Array<typeof existingEvent>>,
    ) {
      mockSingle.mockResolvedValueOnce({
        data: { id: 'calendar-123', hash: source.source_id, title: 'Team' },
        error: null,
      })
      mockQueryResult
        .mockReturnValueOnce({ data: [source], error: null })
        .mockReturnValueOnce({ data: meetings, error: null })
      for (const page of pages) {
        mockRange.mockResolvedValueOnce({ data: page, error: null })
      }
      mockRange.mockResolvedValueOnce({ data: [], error: null })
    }

    it('performs zero writes on repeated unchanged syncs with equivalent timestamp formats', async () => {
      for (let pass = 0; pass < 2; pass++) {
        prepareSync([meeting], [[existingEvent]])
        const response = await sync()
        expect(response.status).toBe(200)
        expect(response.body).toMatchObject({ inserted: 0, updated: 0, deleted: 0, totalFound: 1 })
        expect(response.body.results[0]).not.toHaveProperty('error')
      }
      expect(mockUpdate).not.toHaveBeenCalled()
      expect(mockUpsert).not.toHaveBeenCalled()
      expect(mockDelete).not.toHaveBeenCalled()
    })

    it.each([
      { title: 'Changed title' },
      { description: 'Changed agenda' },
      { start_time: '2026-10-02T09:15:00.000Z' },
      { end_time: '2026-10-02T10:15:00.000Z' },
      { start_time: '2026-10-02T09:00:00.000001Z' },
    ])('updates genuine provider changes without overwriting publication or recurrence: %j', async (change) => {
      prepareSync([{ ...meeting, ...change }], [[existingEvent]])
      const response = await sync()
      expect(response.body).toMatchObject({ inserted: 0, updated: 1, deleted: 0 })
      expect(mockUpdate).toHaveBeenCalledTimes(1)
      const updates = mockUpdate.mock.calls[0][0]
      expect(updates).not.toHaveProperty('is_public')
      expect(updates).not.toHaveProperty('recurrence_rule')
      expect(updates).not.toHaveProperty('category_ids')
      expect(mockDelete).not.toHaveBeenCalled()
    })

    it('loads more than 1000 existing events before deciding which events are new', async () => {
      const meetings = Array.from({ length: 1001 }, (_, index) => ({ ...meeting, id: `meeting-${index}` }))
      const events = meetings.map((entry, index) => ({
        ...existingEvent,
        id: `event-${String(index).padStart(4, '0')}`,
        external_event_id: entry.id,
      }))
      prepareSync(meetings, [events.slice(0, 1000), events.slice(1000)])
      const response = await sync()
      expect(response.body).toMatchObject({ inserted: 0, updated: 0, deleted: 0, totalFound: 1001 })
      expect(mockRange.mock.calls).toEqual([[0, 999], [1000, 1999], [1001, 2000]])
      expect(mockOrder).toHaveBeenCalledWith('id', { ascending: true })
      expect(mockEq).toHaveBeenCalledWith('user_id', 'test-user-123')
      expect(mockEq).toHaveBeenCalledWith('source_type', 'coordination_calendar')
      expect(mockEq).toHaveBeenCalledWith('source_id', 'calendarHash')
      expect(mockUpdate).not.toHaveBeenCalled()
      expect(mockUpsert).not.toHaveBeenCalled()
    })

    it('continues reading when the server returns fewer rows than the requested page size', async () => {
      const secondMeeting = { ...meeting, id: 'meeting-456' }
      const secondEvent = { ...existingEvent, id: 'event-456', external_event_id: secondMeeting.id }
      prepareSync([meeting, secondMeeting], [[existingEvent], [secondEvent]])
      const response = await sync()
      expect(response.body).toMatchObject({ inserted: 0, updated: 0, deleted: 0, totalFound: 2 })
      expect(mockRange.mock.calls).toEqual([[0, 999], [1, 1000], [2, 1001]])
      expect(mockUpsert).not.toHaveBeenCalled()
    })

    it('reports a later-page read failure without writing partially reconciled events', async () => {
      prepareSync([meeting], [[existingEvent]])
      mockRange.mockReset()
        .mockResolvedValueOnce({ data: [existingEvent], error: null })
        .mockResolvedValueOnce({ data: null, error: { message: 'Source page unavailable' } })
      const response = await sync()
      expect(response.body.results[0]).toMatchObject({ error: 'Source page unavailable' })
      expect(mockUpdate).not.toHaveBeenCalled()
      expect(mockUpsert).not.toHaveBeenCalled()
      expect(mockDelete).not.toHaveBeenCalled()
    })

    it('reports invalid provider timestamps before any event writes', async () => {
      prepareSync([{ ...meeting, start_time: 'invalid' }], [])
      const response = await sync()
      expect(response.body.results[0]).toMatchObject({
        error: 'Imported event timestamps must be valid ISO timestamps with a timezone',
      })
      expect(mockUpdate).not.toHaveBeenCalled()
      expect(mockUpsert).not.toHaveBeenCalled()
      expect(mockDelete).not.toHaveBeenCalled()
    })

    it('matches legacy events across timestamp formats instead of inserting duplicates', async () => {
      prepareSync([meeting], [[{ ...existingEvent, external_event_id: '' }]])
      const response = await sync()
      expect(response.body).toMatchObject({ inserted: 0, updated: 1, deleted: 0 })
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ external_event_id: meeting.id }))
      expect(mockUpsert).not.toHaveBeenCalled()
      expect(mockDelete).not.toHaveBeenCalled()
    })

    it('inserts a genuinely new event without changing the publication default', async () => {
      prepareSync([meeting], [])
      mockQueryResult.mockReturnValue({ data: [{ id: 'new-event' }], error: null })
      const response = await sync()
      expect(response.body).toMatchObject({ inserted: 1, updated: 0, deleted: 0 })
      expect(mockUpsert).toHaveBeenCalledWith([
        expect.objectContaining({
          external_event_id: meeting.id,
          start_time: meeting.start_time,
          end_time: meeting.end_time,
          is_public: false,
          user_id: 'test-user-123',
        }),
      ], {
        onConflict: 'user_id,source_type,source_id,external_event_id',
        ignoreDuplicates: false,
      })
      expect(mockUpdate).not.toHaveBeenCalled()
      expect(mockDelete).not.toHaveBeenCalled()
    })

    it('still deletes removed coordination events found on a later page', async () => {
      const removedEvent = { ...existingEvent, id: 'event-removed', external_event_id: 'meeting-removed' }
      prepareSync([meeting], [[existingEvent], [removedEvent]])
      mockQueryResult.mockReturnValue({ data: [{ id: removedEvent.id }], error: null })
      const response = await sync()
      expect(response.body).toMatchObject({ inserted: 0, updated: 0, deleted: 1 })
      expect(mockDelete).toHaveBeenCalledTimes(1)
      expect(mockIn).toHaveBeenCalledWith('id', ['event-removed'])
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('skips unchanged Google events and only deletes missing events inside the requested window', async () => {
      const googleSource = { source_type: 'google_oauth', source_id: 'google-source' }
      mockSingle.mockResolvedValueOnce({
        data: {
          id: googleSource.source_id,
          source_type: googleSource.source_type,
          google_access_token: 'test-access-token',
          google_refresh_token: null,
          token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          public_url: null,
        },
        error: null,
      })
      mockQueryResult
        .mockReturnValueOnce({ data: [googleSource], error: null })
        .mockReturnValue({ data: [{ id: 'missing-inside-window' }], error: null })
      mockRange
        .mockResolvedValueOnce({
          data: [
            existingEvent,
            { ...existingEvent, id: 'missing-inside-window', external_event_id: 'removed-google-event' },
          ],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [{
            ...existingEvent,
            id: 'outside-window',
            external_event_id: 'future-google-event',
            start_time: '2027-01-02T09:00:00+00:00',
            end_time: '2027-01-02T10:00:00+00:00',
          }],
          error: null,
        })
        .mockResolvedValueOnce({ data: [], error: null })
      const providerFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [{
            id: meeting.id,
            summary: meeting.title,
            description: meeting.description,
            hangoutLink: meeting.meeting_link,
            location: meeting.meeting_link,
            start: { dateTime: '2026-10-02T12:00:00+03:00' },
            end: { dateTime: '2026-10-02T13:00:00+03:00' },
          }],
        }),
      })
      vi.stubGlobal('fetch', providerFetch)
      try {
        const response = await sync(googleSource)
        expect(response.body).toMatchObject({ inserted: 0, updated: 0, deleted: 1, totalFound: 1 })
        expect(response.body.results[0]).not.toHaveProperty('error')
        expect(mockIn).toHaveBeenCalledWith('id', ['missing-inside-window'])
        expect(mockUpdate).not.toHaveBeenCalled()
        expect(mockUpsert).not.toHaveBeenCalled()
        expect(providerFetch).toHaveBeenCalledTimes(1)
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })

  it.each(['https://meet.example.com/planning', 'Conference Room B', null])(
    'exposes the shared calendar meeting location in public event reads: %s',
    async (meetingLocation) => {
      mockQueryResult
        .mockReturnValueOnce({ data: [], error: null })
        .mockReturnValueOnce({ data: [], error: null })
        .mockReturnValueOnce({
          data: [{ id: 'calendar-123', hash: 'calendarHash', title: 'Team' }],
          error: null,
        })
        .mockReturnValueOnce({
          data: [{
            id: 'meeting-123',
            calendar_id: 'calendar-123',
            title: 'Planning',
            meeting_link: meetingLocation,
            start_time: '2026-10-02T09:00:00',
            end_time: '2026-10-02T10:00:00',
          }],
          error: null,
        })
        .mockReturnValueOnce({ data: [], error: null })

      const { default: userEventsRouter } = await import('../user-events.js')
      const app = express()
      app.use('/api/user-events', userEventsRouter)

      const response = await request(app).get('/api/user-events/public')

      expect(response.status).toBe(200)
      expect(response.body.events).toEqual([
        expect.objectContaining({
          id: 'coord_meeting-123',
          network_source_key: expect.stringMatching(/^source_[0-9a-f]{64}$/),
          meeting_link: meetingLocation,
          location: meetingLocation,
        }),
      ])
    },
  )
})