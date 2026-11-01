import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { errorHandler } from '../../middleware/error-handler.js'

interface MockResult {
  data: unknown
  error: { message: string } | null
}

const resultQueues = new Map<string, MockResult[]>()
const tableOperations: Array<{ table: string; operation: string; value?: unknown }> = []

function queueResult(table: string, result: MockResult) {
  const queue = resultQueues.get(table) || []
  queue.push(result)
  resultQueues.set(table, queue)
}

function takeResult(table: string): MockResult {
  return resultQueues.get(table)?.shift() || { data: null, error: null }
}

function createChain(table: string) {
  const chain = {
    select: vi.fn(() => chain),
    insert: vi.fn((value: unknown) => {
      tableOperations.push({ table, operation: 'insert', value })
      return chain
    }),
    update: vi.fn((value: unknown) => {
      tableOperations.push({ table, operation: 'update', value })
      return chain
    }),
    upsert: vi.fn((value: unknown) => {
      tableOperations.push({ table, operation: 'upsert', value })
      return chain
    }),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    lt: vi.fn(() => chain),
    order: vi.fn(() => chain),
    single: vi.fn(async () => takeResult(table)),
    then: (resolve: (result: MockResult) => void) => resolve(takeResult(table)),
  }
  return chain
}

vi.mock('../../supabaseClient.js', () => ({
  supabaseAdmin: {
    from: (table: string) => createChain(table),
  },
}))

vi.mock('../../middleware/auth.js', () => ({
  optionalAuthMiddleware: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  authMiddleware: (req: express.Request & { userId?: string; userEmail?: string }, _res: express.Response, next: express.NextFunction) => {
    req.userId = '11111111-1111-4111-8111-111111111111'
    req.userEmail = 'owner@example.com'
    next()
  },
}))

async function createApp() {
  const { default: eventFlagsRouter } = await import('../event-flags.js')
  const app = express()
  app.use(express.json())
  app.use('/api/event-flags', eventFlagsRouter)
  app.use(errorHandler)
  return app
}

describe('event flag routes', () => {
  beforeEach(() => {
    resultQueues.clear()
    tableOperations.length = 0
    vi.clearAllMocks()
  })

  it('rejects removal reports with a rationale shorter than 2 characters', async () => {
    const app = await createApp()
    const response = await request(app)
      .post('/api/event-flags')
      .send({
        flagType: 'removal',
        rationale: 'x',
        targets: [{ type: 'user_event', id: '22222222-2222-4222-8222-222222222222' }],
      })

    expect(response.status).toBe(400)
    expect(response.body.message).toContain('at least 2 characters')
    expect(tableOperations).toHaveLength(0)
  })

  it('creates an anonymous removal flag, cookie, suspension, and audit actions', async () => {
    queueResult('user_events', {
      data: [{
        id: '22222222-2222-4222-8222-222222222222',
        user_id: '11111111-1111-4111-8111-111111111111',
        title: 'Weekly Commons',
        meeting_link: null,
        location: null,
        start_time: '2026-09-15T12:00:00.000Z',
        is_public: true,
      }],
      error: null,
    })
    queueResult('event_flags', {
      data: {
        id: '33333333-3333-4333-8333-333333333333',
        flag_type: 'removal',
        status: 'pending',
        respond_by: null,
        created_at: '2026-09-13T12:00:00.000Z',
      },
      error: null,
    })
    queueResult('event_flag_targets', { data: null, error: null })
    queueResult('public_event_moderation_state', { data: null, error: null })
    queueResult('event_flag_actions', { data: null, error: null })

    const app = await createApp()
    const response = await request(app)
      .post('/api/event-flags')
      .send({
        flagType: 'removal',
        rationale: 'The meeting link no longer works.',
        targets: [{ type: 'user_event', id: '22222222-2222-4222-8222-222222222222' }],
      })

    expect(response.status).toBe(201)
    expect(response.headers['set-cookie']?.[0]).toContain('cm_event_reporter=')
    expect(tableOperations).toContainEqual(expect.objectContaining({
      table: 'public_event_moderation_state',
      operation: 'upsert',
    }))
    expect(tableOperations).toContainEqual(expect.objectContaining({
      table: 'event_flag_actions',
      operation: 'insert',
      value: expect.arrayContaining([
        expect.objectContaining({ action: 'submitted', actor_type: 'anonymous' }),
        expect.objectContaining({ action: 'suspended', actor_type: 'anonymous' }),
      ]),
    }))
  })

  it('does not let an authenticated user respond to another owner flag', async () => {
    queueResult('event_flag_targets', { data: [], error: null })
    const app = await createApp()
    const response = await request(app)
      .post('/api/event-flags/33333333-3333-4333-8333-333333333333/respond')
      .send({ action: 'confirmed' })

    expect(response.status).toBe(404)
    expect(response.body.error).toBe('No active flag targets found for this account')
    expect(tableOperations.some(operation => operation.operation === 'update')).toBe(false)
  })
})