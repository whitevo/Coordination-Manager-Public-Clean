import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { errorHandler } from '../../middleware/error-handler.js'

interface MockResult {
  data: unknown
  error: { message: string } | null
}

const nextResults: MockResult[] = []
const operations: Array<{ operation: string; value?: unknown; column?: string; arg?: unknown }> = []

function takeResult(): MockResult {
  return nextResults.shift() || { data: null, error: null }
}

function createChain() {
  const chain = {
    select: vi.fn(() => chain),
    update: vi.fn((value: unknown) => {
      operations.push({ operation: 'update', value })
      return chain
    }),
    eq: vi.fn((column: string, arg: unknown) => {
      operations.push({ operation: 'eq', column, arg })
      return chain
    }),
    in: vi.fn((column: string, arg: unknown) => {
      operations.push({ operation: 'in', column, arg })
      return chain
    }),
    order: vi.fn(() => chain),
    range: vi.fn(() => chain),
    single: vi.fn(async () => takeResult()),
    maybeSingle: vi.fn(async () => takeResult()),
    then: (resolve: (result: MockResult) => void) => resolve(takeResult()),
  }
  return chain
}

vi.mock('../../supabaseClient.js', () => ({
  supabaseAdmin: {
    from: () => createChain(),
  },
}))

const OWNER_ID = '11111111-1111-4111-8111-111111111111'
const TEMPLATE_ID = '22222222-2222-4222-8222-222222222222'

vi.mock('../../middleware/auth.js', () => ({
  authMiddleware: (req: express.Request & { userId?: string; userEmail?: string }, _res: express.Response, next: express.NextFunction) => {
    req.userId = '11111111-1111-4111-8111-111111111111'
    req.userEmail = 'owner@example.com'
    next()
  },
}))

let app: express.Express

async function createApp() {
  const { default: router } = await import('../announcements.js')
  app = express()
  app.use(express.json())
  app.use('/api/announcements', router)
  app.use(errorHandler)
}

describe('Announcement template ownership', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    nextResults.length = 0
    operations.length = 0
    await createApp()
  })

  describe('PUT /templates/:id', () => {
    it('updates an owned template', async () => {
      nextResults.push({ data: { id: TEMPLATE_ID, title: 'New' }, error: null })

      const res = await request(app).put(`/api/announcements/templates/${TEMPLATE_ID}`).send({ title: 'New' })

      expect(res.status).toBe(200)
      expect(res.body.template.title).toBe('New')
      expect(operations).toContainEqual({ operation: 'eq', column: 'user_id', arg: OWNER_ID })
    })

    it('returns 404 NOT_FOUND when no owned row matched', async () => {
      nextResults.push({ data: null, error: null })

      const res = await request(app).put(`/api/announcements/templates/${TEMPLATE_ID}`).send({ title: 'New' })

      expect(res.status).toBe(404)
      expect(res.body.error).toBe('NOT_FOUND')
      expect(res.body.statusCode).toBe(404)
    })

    it('returns 404 for a malformed id without querying', async () => {
      const res = await request(app).put('/api/announcements/templates/not-a-uuid').send({ title: 'New' })

      expect(res.status).toBe(404)
      expect(res.body.error).toBe('NOT_FOUND')
      expect(operations).toHaveLength(0)
    })
  })

  describe('DELETE /templates/:id', () => {
    it('archives an owned template', async () => {
      nextResults.push({ data: [{ id: TEMPLATE_ID }], error: null })

      const res = await request(app).delete(`/api/announcements/templates/${TEMPLATE_ID}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(operations).toContainEqual({ operation: 'update', value: { is_archived: true } })
    })

    it('returns 404 NOT_FOUND when no owned row matched', async () => {
      nextResults.push({ data: [], error: null })

      const res = await request(app).delete(`/api/announcements/templates/${TEMPLATE_ID}`)

      expect(res.status).toBe(404)
      expect(res.body.error).toBe('NOT_FOUND')
    })

    it('returns 404 for a malformed id', async () => {
      const res = await request(app).delete('/api/announcements/templates/not-a-uuid')

      expect(res.status).toBe(404)
    })
  })
})

const SCHEDULE_ID = '33333333-3333-4333-8333-333333333333'
const LOG_CHANNEL = '44444444-4444-4444-8444-444444444441'
const LOG_DM = '44444444-4444-4444-8444-444444444442'
const LOG_EMAIL = '44444444-4444-4444-8444-444444444443'
const LOG_DELETED = '44444444-4444-4444-8444-444444444444'
const LOG_FAILED_SEND = '44444444-4444-4444-8444-444444444445'

function logRows() {
  return [
    { id: LOG_CHANNEL, channel_type: 'discord_channel', target_id: '123456789012345678', status: 'sent', discord_message_id: '900000000000000001', deleted_at: null },
    { id: LOG_DM, channel_type: 'discord_dm', target_id: '223456789012345678', status: 'sent', discord_message_id: '900000000000000002', deleted_at: null },
    { id: LOG_EMAIL, channel_type: 'email', target_id: 'someone@example.com', status: 'sent', discord_message_id: null, deleted_at: null },
    { id: LOG_DELETED, channel_type: 'discord_dm', target_id: '323456789012345678', status: 'sent', discord_message_id: '900000000000000003', deleted_at: '2026-10-01T00:00:00.000Z' },
    { id: LOG_FAILED_SEND, channel_type: 'discord_dm', target_id: '423456789012345678', status: 'failed', discord_message_id: null, deleted_at: null },
  ]
}

function botResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

describe('POST /schedules/:id/delete-messages', () => {
  const mockFetch = vi.fn()
  const url = `/api/announcements/schedules/${SCHEDULE_ID}/delete-messages`

  beforeEach(async () => {
    vi.clearAllMocks()
    nextResults.length = 0
    operations.length = 0
    vi.stubGlobal('fetch', mockFetch)
    vi.stubEnv('BOT_API_SECRET', 'test-bot-secret')
    vi.stubEnv('BOT_API_URL', 'http://bot.test')
    await createApp()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('returns 404 when the schedule is not owned by the caller', async () => {
    nextResults.push({ data: null, error: null })

    const res = await request(app).post(url).send({})

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('NOT_FOUND')
    expect(operations).toContainEqual({ operation: 'eq', column: 'user_id', arg: OWNER_ID })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns 404 for a malformed schedule id without querying', async () => {
    const res = await request(app).post('/api/announcements/schedules/not-a-uuid/delete-messages').send({})

    expect(res.status).toBe(404)
    expect(operations).toHaveLength(0)
  })

  it('returns 409 while the schedule is still sending', async () => {
    nextResults.push({ data: { id: SCHEDULE_ID, status: 'sending' }, error: null })

    const res = await request(app).post(url).send({})

    expect(res.status).toBe(409)
    expect(res.body.error).toBe('SCHEDULE_SENDING')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid logIds', async () => {
    const res = await request(app).post(url).send({ logIds: ['nope'] })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('VALIDATION_ERROR')
    expect(operations).toHaveLength(0)
  })

  it('deletes eligible Discord messages and marks the rows deleted', async () => {
    nextResults.push({ data: { id: SCHEDULE_ID }, error: null })
    nextResults.push({ data: logRows(), error: null })
    mockFetch.mockResolvedValueOnce(botResponse({ results: [{ id: LOG_CHANNEL, ok: true }, { id: LOG_DM, ok: true }] }))

    const res = await request(app).post(url).send({})

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ deleted: 2, failed: 0, skippedEmail: 1 })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [calledUrl, init] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string>; body: string }]
    expect(calledUrl).toBe('http://bot.test/delete-messages')
    expect(init.headers['x-bot-secret']).toBe('test-bot-secret')
    const sentItems = JSON.parse(init.body).items as Array<{ id: string }>
    expect(sentItems.map(i => i.id)).toEqual([LOG_CHANNEL, LOG_DM])

    const deletedUpdate = operations.find(op => op.operation === 'update') as { value: Record<string, unknown> }
    expect(deletedUpdate.value.delete_error).toBeNull()
    expect(typeof deletedUpdate.value.deleted_at).toBe('string')
    expect(operations).toContainEqual({ operation: 'eq', column: 'schedule_id', arg: SCHEDULE_ID })
    expect(operations).toContainEqual({ operation: 'in', column: 'id', arg: [LOG_CHANNEL, LOG_DM] })
  })

  it('records delete_error for partial failures', async () => {
    nextResults.push({ data: { id: SCHEDULE_ID }, error: null })
    nextResults.push({ data: logRows(), error: null })
    mockFetch.mockResolvedValueOnce(botResponse({
      results: [{ id: LOG_CHANNEL, ok: true }, { id: LOG_DM, ok: false, error: 'Missing Access' }],
    }))

    const res = await request(app).post(url).send({})

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ deleted: 1, failed: 1, skippedEmail: 1 })
    expect(res.body.results).toContainEqual({ id: LOG_DM, ok: false, error: 'Missing Access' })
    expect(operations).toContainEqual({ operation: 'update', value: { delete_error: 'Missing Access' } })
    expect(operations).toContainEqual({ operation: 'in', column: 'id', arg: [LOG_DM] })
  })

  it('treats rows the bot did not report on as failures', async () => {
    nextResults.push({ data: { id: SCHEDULE_ID }, error: null })
    nextResults.push({ data: logRows(), error: null })
    mockFetch.mockResolvedValueOnce(botResponse({ results: [{ id: LOG_CHANNEL, ok: true }, { id: 'unrelated', ok: true }] }))

    const res = await request(app).post(url).send({})

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ deleted: 1, failed: 1 })
    expect(res.body.results).toContainEqual({ id: LOG_DM, ok: false, error: 'No result from Discord bot' })
  })

  it('limits the deletion to the requested logIds', async () => {
    nextResults.push({ data: { id: SCHEDULE_ID }, error: null })
    nextResults.push({ data: logRows(), error: null })
    mockFetch.mockResolvedValueOnce(botResponse({ results: [{ id: LOG_DM, ok: true }] }))

    const res = await request(app).post(url).send({ logIds: [LOG_DM] })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ deleted: 1, failed: 0, skippedEmail: 0 })
    const init = mockFetch.mock.calls[0][1] as { body: string }
    expect((JSON.parse(init.body).items as Array<{ id: string }>).map(i => i.id)).toEqual([LOG_DM])
  })

  it('returns 502 and changes no rows when the bot is unreachable', async () => {
    nextResults.push({ data: { id: SCHEDULE_ID }, error: null })
    nextResults.push({ data: logRows(), error: null })
    mockFetch.mockRejectedValueOnce(new Error('connect ECONNREFUSED'))

    const res = await request(app).post(url).send({})

    expect(res.status).toBe(502)
    expect(res.body.error).toBe('BOT_UNAVAILABLE')
    expect(res.body.message).toMatch(/no messages were deleted/)
    expect(operations.some(op => op.operation === 'update')).toBe(false)
  })

  it('returns 502 when the bot answers with an error status', async () => {
    nextResults.push({ data: { id: SCHEDULE_ID }, error: null })
    nextResults.push({ data: logRows(), error: null })
    mockFetch.mockResolvedValueOnce(botResponse({ error: 'Unauthorized' }, 401))

    const res = await request(app).post(url).send({})

    expect(res.status).toBe(502)
    expect(operations.some(op => op.operation === 'update')).toBe(false)
  })

  it('returns zero counts without calling the bot when nothing is eligible', async () => {
    nextResults.push({ data: { id: SCHEDULE_ID }, error: null })
    nextResults.push({
      data: logRows().filter(row => row.id === LOG_EMAIL || row.id === LOG_DELETED || row.id === LOG_FAILED_SEND),
      error: null,
    })

    const res = await request(app).post(url).send({})

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ deleted: 0, failed: 0, skippedEmail: 1, results: [] })
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('GET /schedules/:id/log', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    nextResults.length = 0
    operations.length = 0
    await createApp()
  })

  it('returns deleted_at and delete_error on log entries', async () => {
    nextResults.push({ data: { id: SCHEDULE_ID, calendar_id: null }, error: null })
    nextResults.push({
      data: [
        { id: LOG_CHANNEL, channel_type: 'discord_channel', status: 'sent', deleted_at: '2026-10-01T00:00:00.000Z', delete_error: null },
        { id: LOG_DM, channel_type: 'discord_dm', status: 'sent', recipient_response: 'subscribed', deleted_at: null, delete_error: 'Missing Access' },
      ],
      error: null,
    })

    const res = await request(app).get(`/api/announcements/schedules/${SCHEDULE_ID}/log`)

    expect(res.status).toBe(200)
    expect(res.body.log[0].deleted_at).toBe('2026-10-01T00:00:00.000Z')
    expect(res.body.log[1].delete_error).toBe('Missing Access')
  })
})
