import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import express, { type NextFunction, type Response as ExpressResponse } from 'express'
import request from 'supertest'
import type { AuthenticatedRequest } from '../../middleware/auth.js'
import type { ChatQuota } from '../../services/ai-chat-quota.js'
import { errorHandler } from '../../middleware/error-handler.js'
import { issueAiRetryToken } from '../../services/ai-evaluation.js'

const mocks = vi.hoisted(() => ({
  reserve: vi.fn(), release: vi.fn(), count: vi.fn(), fetch: vi.fn(), single: vi.fn(),
}))
vi.mock('../../services/ai-chat-quota.js', () => ({
  reserveChatQuota: mocks.reserve,
  releaseChatQuota: mocks.release,
  getChatUsageCount: mocks.count,
}))
vi.mock('../../supabaseClient.js', () => ({
  supabaseAdmin: { from: () => ({
    select() { return this },
    eq() { return this },
    single: mocks.single,
  }) },
}))
vi.mock('../../middleware/auth.js', () => ({
  authMiddleware: (req: AuthenticatedRequest, _res: ExpressResponse, next: NextFunction) => {
    req.userId = 'user-1'
    req.userEmail = 'test@example.com'
    next()
  },
  hasRole: () => false,
  hasCalendarEditPermission: () => ({ canEdit: false }),
}))
vi.mock('../../services/local-config.js', () => ({ getDisabledFeatures: () => ({ ai: false }) }))

let app: express.Express
const endpoints = ['', '/calendar', '/calendar/availability', '/time-management', '/mailbox-automation', '/announcement']

describe('AI chat errors and allowance', () => {
  beforeAll(async () => {
    vi.stubEnv('AI_API_KEY', 'test-key-not-a-secret')
    vi.stubGlobal('fetch', mocks.fetch)
    const { default: router } = await import('../ai-chat.js')
    app = express()
    app.use(express.json())
    app.use('/api/ai-chat', router)
    app.use(errorHandler)
  })
  afterAll(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.reserve.mockImplementation(async () => ({ limit: 10, remaining: 9, reservationId: 'usage-1' }))
    mocks.release.mockImplementation(async (_userId: string, quota: ChatQuota) => {
      if (quota.reservationId) {
        quota.reservationId = undefined
        quota.remaining = 10
      }
    })
    mocks.count.mockResolvedValue(1)
    mocks.single.mockResolvedValue({ data: null, error: null })
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'A helpful reply.' } }],
    }), { status: 200 }))
  })

  it.each(endpoints)('identifies provider throttling and restores the allowance for %s', async endpoint => {
    mocks.fetch.mockResolvedValue(new Response('Rate limit reached for tokens per minute (TPM).', { status: 429 }))
    const res = await request(app).post(`/api/ai-chat${endpoint}`).send({ message: 'First request' })
    expect(res.status).toBe(429)
    expect(res.body).toMatchObject({
      errorType: 'provider_rate_limit', remaining: 10, limit: 10, quotaConsumed: false,
    })
    expect(res.body.message).toContain('provider')
    expect(mocks.release).toHaveBeenCalledOnce()
  })

  it.each(endpoints)('rejects oversized input before reserving any allowance for %s', async endpoint => {
    const res = await request(app).post(`/api/ai-chat${endpoint}`).send({ message: 'x'.repeat(4001) })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('maximum is 4000 characters')
    expect(mocks.reserve).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it.each([null, '', '   ', 42])('rejects invalid input %s without spending a prompt', async message => {
    const res = await request(app).post('/api/ai-chat').send({ message })
    expect(res.status).toBe(400)
    expect(mocks.reserve).not.toHaveBeenCalled()
  })

  it('distinguishes the daily allowance from the model provider limit', async () => {
    mocks.reserve.mockResolvedValue({ limit: 10, remaining: 0 })
    const res = await request(app).post('/api/ai-chat').send({ message: 'Hello' })
    expect(res.status).toBe(429)
    expect(res.body).toMatchObject({ errorType: 'daily_limit', remaining: 0 })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it.each([400, 413, 429])('identifies context-size errors returned as %s by a provider', async status => {
    mocks.fetch.mockResolvedValue(new Response('{"error":{"code":"context_length_exceeded"}}', { status }))
    const res = await request(app).post('/api/ai-chat').send({ message: 'Hello' })
    expect(res.status).toBe(413)
    expect(res.body).toMatchObject({ errorType: 'token_limit', remaining: 10, quotaConsumed: false })
  })

  it.each([401, 403, 500, 503])('reports provider unavailability and refunds provider status %s', async status => {
    mocks.fetch.mockResolvedValue(new Response('Provider unavailable', { status }))
    const res = await request(app).post('/api/ai-chat').send({ message: 'Hello' })
    expect(res.status).toBe(503)
    expect(res.body).toMatchObject({ errorType: 'provider_unavailable', remaining: 10 })
  })

  it('restores the allowance when the provider connection fails', async () => {
    mocks.fetch.mockRejectedValue(new Error('Connection failed'))
    const res = await request(app).post('/api/ai-chat').send({ message: 'Hello' })
    expect(res.status).toBe(500)
    expect(res.body).toMatchObject({ remaining: 10, quotaConsumed: false })
  })

  it('does not count an empty provider reply as success', async () => {
    mocks.fetch.mockResolvedValue(new Response('{"choices":[]}', { status: 200 }))
    const res = await request(app).post('/api/ai-chat').send({ message: 'Hello' })
    expect(res.status).toBe(503)
    expect(res.body.remaining).toBe(10)
  })

  it('reports provider credit exhaustion as model unavailability, not a user daily limit', async () => {
    mocks.fetch.mockResolvedValue(new Response('{"error":{"code":"insufficient_quota"}}', { status: 429 }))
    const res = await request(app).post('/api/ai-chat').send({ message: 'Hello' })
    expect(res.status).toBe(503)
    expect(res.body).toMatchObject({ errorType: 'provider_unavailable', remaining: 10 })
  })

  it('forwards a status quota lookup failure to the error handler', async () => {
    mocks.count.mockRejectedValueOnce(new Error('Database unavailable'))
    const res = await request(app).get('/api/ai-chat/status')
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('INTERNAL_SERVER_ERROR')
  })

  it('accepts exactly 4000 characters and retains one usage on success', async () => {
    const res = await request(app).post('/api/ai-chat').send({ message: 'x'.repeat(4000) })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ message: 'A helpful reply.', remaining: 9, limit: 10 })
    expect(mocks.reserve).toHaveBeenCalledOnce()
    expect(mocks.release).not.toHaveBeenCalled()
  })

  it.each(endpoints)('retains exactly one usage for a successful response from %s', async endpoint => {
    mocks.fetch.mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        changes: {}, actions: [], rule: null, action: 'none', explanation: 'No change needed.',
      }) } }],
    }), { status: 200 }))
    const res = await request(app).post(`/api/ai-chat${endpoint}`).send({ message: 'Hello' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ remaining: 9, limit: 10 })
    expect(mocks.reserve).toHaveBeenCalledOnce()
    expect(mocks.release).not.toHaveBeenCalled()
  })

  it('does not claim the allowance was restored if restoration fails', async () => {
    mocks.fetch.mockResolvedValue(new Response('Provider unavailable', { status: 503 }))
    mocks.release.mockRejectedValue(new Error('Connection lost'))
    const res = await request(app).post('/api/ai-chat').send({ message: 'Hello' })
    expect(res.status).toBe(503)
    expect(res.body.error).toBe('AI_QUOTA_RESTORE_FAILED')
    expect(res.body.message).toContain('contact support')
    expect(res.body.quotaConsumed).toBeUndefined()
    expect(res.body.remaining).toBeUndefined()
    expect(mocks.release).toHaveBeenCalledOnce()
  })

  it('keeps an evaluated retry free and prevents replaying its token', async () => {
    mocks.fetch.mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"changes":{},"explanation":"Retried."}' } }],
    }), { status: 200 }))
    const retryToken = issueAiRetryToken('user-1')
    const payload = { message: 'Hello', evaluationFeedback: 'The action did not apply.', retryToken }
    const res = await request(app).post('/api/ai-chat/calendar').send(payload)
    expect(res.status).toBe(200)
    expect(res.body.remaining).toBe(9)
    expect(mocks.reserve).not.toHaveBeenCalled()
    const replay = await request(app).post('/api/ai-chat/calendar').send(payload)
    expect(replay.status).toBe(400)
    expect(replay.body.error).toBe('INVALID_RETRY_TOKEN')
  })
})
