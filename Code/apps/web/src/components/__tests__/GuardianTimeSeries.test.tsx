import { act, cleanup, render } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GuardianTimeSeries from '../GuardianTimeSeries'
import GuardianActionTimeSeries from '../GuardianActionTimeSeries'

const mockGet = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api-client', () => ({ apiClient: { get: mockGet } }))

describe('Guardian chart date filters', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockGet.mockReset()
    mockGet.mockResolvedValue({
      data: { mode: 'daily', buckets: [], totals: { delete: 0, mute: 0, ban: 0, failed: 0 } },
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it.each([
    { Component: GuardianTimeSeries, endpoint: '/api/guardian/timeseries' },
    { Component: GuardianActionTimeSeries, endpoint: '/api/guardian/actions-timeseries' },
  ])('uses inclusive local-day boundaries for $endpoint', async ({ Component, endpoint }) => {
    render(<Component dateRange="custom" filterSince="2026-10-25" filterUntil="2026-10-25" />)
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })

    expect(mockGet).toHaveBeenCalledTimes(1)
    const request = new URL(String(mockGet.mock.calls[0][0]), 'http://localhost')
    expect(request.pathname).toBe(endpoint)
    expect(request.searchParams.get('since')).toBe(new Date(2026, 9, 25).toISOString())
    expect(request.searchParams.get('until')).toBe(new Date(2026, 9, 25, 23, 59, 59, 999).toISOString())
    expect(request.searchParams.has('range')).toBe(false)
  })

  it.each([
    { Component: GuardianTimeSeries, endpoint: '/api/guardian/timeseries' },
    { Component: GuardianActionTimeSeries, endpoint: '/api/guardian/actions-timeseries' },
  ])('resolves live bounds again on refresh for $endpoint', async ({ Component, endpoint }) => {
    vi.setSystemTime(new Date(2026, 9, 25, 23, 58))
    const resolveDateBounds = () => ({
      since: new Date(2026, 9, new Date().getDate() - 14).toISOString(),
      until: new Date().toISOString(),
    })
    const ref = createRef<{ refresh: () => Promise<void> }>()
    render(<Component ref={ref} dateRange="custom" resolveDateBounds={resolveDateBounds} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })

    vi.setSystemTime(new Date(2026, 9, 26, 0, 2))
    await act(async () => {
      const refresh = ref.current?.refresh()
      await vi.advanceTimersByTimeAsync(1500)
      await refresh
    })
    expect(mockGet).toHaveBeenCalledTimes(2)
    const request = new URL(String(mockGet.mock.calls[1][0]), 'http://localhost')
    expect(request.pathname).toBe(endpoint)
    expect(request.searchParams.get('since')).toBe(new Date(2026, 9, 12).toISOString())
    expect(request.searchParams.get('until')).toBe(new Date(2026, 9, 26, 0, 2).toISOString())
  })
})
