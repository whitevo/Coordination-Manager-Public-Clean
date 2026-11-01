import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedRequest } from '../../middleware/auth.js'
import { releaseChatQuota, reserveChatQuota } from '../ai-chat-quota.js'

const mocks = vi.hoisted(() => ({
  from: vi.fn(), select: vi.fn(), eq: vi.fn(), gte: vi.fn(),
  insert: vi.fn(), single: vi.fn(), delete: vi.fn(),
}))

vi.mock('../../supabaseClient.js', () => ({
  supabaseAdmin: { from: (...args: unknown[]) => {
    mocks.from(...args)
    return {
      select: mocks.select, eq: mocks.eq, gte: mocks.gte,
      insert: mocks.insert, single: mocks.single, delete: mocks.delete,
    }
  } },
}))
vi.mock('../ai-usage.js', () => ({ getDailyUsageLimit: () => 10 }))

const req = { userId: 'user-1' } as AuthenticatedRequest

describe('AI chat quota reservations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.select.mockReturnThis()
    mocks.eq.mockReturnThis()
    mocks.insert.mockReturnThis()
    mocks.delete.mockReturnThis()
    mocks.gte.mockResolvedValue({ count: 0, error: null })
    mocks.single.mockResolvedValue({ data: { id: 'usage-1' }, error: null })
  })

  it('reserves one usage row and releases only that request on failure', async () => {
    const quota = await reserveChatQuota(req)
    expect(quota).toEqual({ limit: 10, remaining: 9, reservationId: 'usage-1' })
    await releaseChatQuota('user-1', quota)
    expect(mocks.delete).toHaveBeenCalledOnce()
    expect(mocks.eq).toHaveBeenCalledWith('id', 'usage-1')
    expect(mocks.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(mocks.eq).toHaveBeenCalledWith('category', 'chat')
    expect(quota.remaining).toBe(10)
    await releaseChatQuota('user-1', quota)
    expect(mocks.delete).toHaveBeenCalledOnce()
  })

  it('serializes concurrent checks for the last remaining prompt', async () => {
    let count = 9
    mocks.gte.mockImplementation(async () => ({ count, error: null }))
    mocks.single.mockImplementation(async () => {
      count++
      return { data: { id: 'last-usage' }, error: null }
    })
    const results = await Promise.all([reserveChatQuota(req), reserveChatQuota(req)])
    expect(results.filter(result => result.reservationId)).toHaveLength(1)
    expect(mocks.insert).toHaveBeenCalledOnce()
  })

  it('does not insert a usage row when the daily quota is exhausted', async () => {
    mocks.gte.mockResolvedValue({ count: 10, error: null })
    expect(await reserveChatQuota(req)).toEqual({ limit: 10, remaining: 0 })
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('fails explicitly when the quota cannot be checked or reserved', async () => {
    mocks.gte.mockResolvedValueOnce({ count: null, error: { message: 'Database unavailable' } })
    await expect(reserveChatQuota(req)).rejects.toMatchObject({ code: 'AI_QUOTA_UNAVAILABLE' })
    expect(mocks.insert).not.toHaveBeenCalled()
    mocks.single.mockResolvedValueOnce({ data: null, error: { message: 'Insert failed' } })
    await expect(reserveChatQuota(req)).rejects.toMatchObject({ code: 'AI_QUOTA_UNAVAILABLE' })
  })

  it('surfaces a failed restoration rather than claiming the prompt was refunded', async () => {
    const quota = await reserveChatQuota(req)
    mocks.eq.mockImplementationOnce(() => { throw new Error('Connection lost') })
    await expect(releaseChatQuota('user-1', quota)).rejects.toThrow('Connection lost')
    expect(quota.reservationId).toBe('usage-1')
  })

  it('reports a database rejection while restoring an allowance', async () => {
    const quota = await reserveChatQuota(req)
    mocks.eq.mockImplementation(function (this: object, column: string) {
      return column === 'category' ? Promise.resolve({ error: { message: 'Delete rejected' } }) : this
    })
    await expect(releaseChatQuota('user-1', quota)).rejects.toMatchObject({ code: 'AI_QUOTA_RESTORE_FAILED' })
    expect(quota.reservationId).toBe('usage-1')
  })
})
