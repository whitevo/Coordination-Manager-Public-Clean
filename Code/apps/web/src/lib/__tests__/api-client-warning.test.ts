import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InternalAxiosRequestConfig } from 'axios'
import {
  apiClient,
  dedupedGet,
  getPersistedRateLimitWarn,
  RATE_LIMIT_WARN_EVENT,
  RATE_LIMIT_WARN_TTL_MS,
} from '../api-client'

vi.mock('../supabase', () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: null } })) } },
}))
vi.mock('../session-activity', () => ({ recordActivity: vi.fn() }))

const originalAdapter = apiClient.defaults.adapter

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
})

afterEach(() => {
  apiClient.defaults.adapter = originalAdapter
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('request-limit warning freshness', () => {
  it.each(['2026-10-15T04:19:00.000Z', 'invalid'])('does not restore stale or invalid incident %s', (timestamp) => {
    vi.setSystemTime(new Date('2026-10-17T12:00:00Z'))
    localStorage.setItem('rateLimitWarnAt', timestamp)
    expect(getPersistedRateLimitWarn()).toEqual({ active: false, since: null })
    expect(localStorage.getItem('rateLimitWarnAt')).toBeNull()
  })

  it('records the latest signal and expires two minutes after it, including for admins', async () => {
    const listener = vi.fn()
    window.addEventListener(RATE_LIMIT_WARN_EVENT, listener)
    apiClient.defaults.adapter = async (config) => ({
      config, data: {}, status: 200, statusText: 'OK', headers: { 'x-ratelimit-warn': 'true' },
    })
    try {
      await apiClient.get('/warning-test')
      const first = getPersistedRateLimitWarn().since
      await vi.advanceTimersByTimeAsync(60_000)
      await apiClient.get('/warning-test')
      expect(getPersistedRateLimitWarn().since).not.toBe(first)
      await vi.advanceTimersByTimeAsync(RATE_LIMIT_WARN_TTL_MS - 1)
      expect(getPersistedRateLimitWarn().active).toBe(true)
      await vi.advanceTimersByTimeAsync(1)
      expect(getPersistedRateLimitWarn()).toEqual({ active: false, since: null })
      expect(listener.mock.calls[listener.mock.calls.length - 1]?.[0].detail.warn).toBe(false)
    } finally {
      window.removeEventListener(RATE_LIMIT_WARN_EVENT, listener)
    }
  })

  it('coalesces identical concurrent mailbox reads without retaining a stale response', async () => {
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => ({
      config, data: {}, status: 200, statusText: 'OK', headers: {},
    }))
    apiClient.defaults.adapter = adapter
    await Promise.all([
      dedupedGet('/api/mailbox/messages', { params: { limit: 30 } }),
      dedupedGet('/api/mailbox/messages', { params: { limit: 30 } }),
    ])
    expect(adapter).toHaveBeenCalledTimes(1)
    await dedupedGet('/api/mailbox/messages', { params: { limit: 30 } })
    expect(adapter).toHaveBeenCalledTimes(2)
  })
})
