import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import GuardianPage from '../GuardianPage'

const mockGet = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api-client', () => ({ apiClient: { get: mockGet } }))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false }),
}))
vi.mock('../../contexts/LearnerModeContext', () => ({
  useLearnerMode: () => ({ learnerMode: false }),
}))
vi.mock('../../components/GuardianTimeSeries', async () => {
  const { forwardRef } = await import('react')
  return { default: forwardRef(() => null) }
})
vi.mock('../../components/GuardianActionTimeSeries', async () => {
  const { forwardRef } = await import('react')
  return { default: forwardRef(() => null) }
})
vi.mock('../../components/GuardianSystemLog', async () => {
  const { forwardRef } = await import('react')
  return { default: forwardRef(() => null) }
})

const baseRow = {
  guild_id: 'guild-1',
  guild_name: 'Example server',
  channel_id: 'channel-1',
  channel_name: 'general',
  author_id: 'user-1',
  author_username: 'Example member',
  was_flagged: false,
  scanned_at: '2026-10-04T19:00:00Z',
}
const scannedRow = { ...baseRow, id: 'scanned', message_id: '1', content_preview: 'Actually scanned', skip_reason: null }
const skippedRows = [
  { ...baseRow, id: 'role', message_id: '2', content_preview: 'Role-excluded content', skip_reason: 'ignored_role' },
  { ...baseRow, id: 'channel', message_id: '3', content_preview: 'Channel-excluded content', skip_reason: 'channel_disabled' },
  { ...baseRow, id: 'parent', message_id: '4', content_preview: 'Parent-excluded content', skip_reason: 'parent_channel_disabled' },
]

function respond(url: string) {
  const parsed = new URL(url, 'http://localhost')
  if (parsed.pathname === '/api/guardian/access') return { data: { isModerator: true } }
  if (parsed.pathname === '/api/guardian/rule-groups') return { data: { groups: [] } }
  if (parsed.pathname === '/api/guardian/users') return { data: { users: [] } }
  if (parsed.pathname === '/api/guardian/stats') return { data: null }
  if (parsed.pathname === '/api/guardian/flagged') return { data: { flagged: [], total: 0 } }
  if (parsed.pathname === '/api/guardian/recent') {
    const rows = parsed.searchParams.get('include_skipped') === '1'
      ? [scannedRow, ...skippedRows]
      : [scannedRow]
    return { data: parsed.searchParams.get('count_only') === '1' ? { total: rows.length } : { messages: rows } }
  }
  throw new Error(`Unexpected request: ${url}`)
}

function recentRequests() {
  return mockGet.mock.calls
    .map(([url]) => new URL(String(url), 'http://localhost'))
    .filter(url => url.pathname === '/api/guardian/recent')
}

async function renderDashboard() {
  render(
    <MemoryRouter>
      <GuardianPage />
    </MemoryRouter>,
  )
  await screen.findByRole('switch', { name: /Show settings-skipped messages/ })
  fireEvent.click(screen.getByRole('button', { name: /Recent Scanned Messages/ }))
  await screen.findByText('Actually scanned')
}

describe('Guardian settings-skipped message filter', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockGet.mockImplementation(async (url: string) => respond(url))
  })
  afterEach(cleanup)

  it('defaults to hiding skips in both data and count requests', async () => {
    await renderDashboard()
    expect(screen.getByRole('switch', { name: /Show settings-skipped messages/ })).not.toBeChecked()
    expect(screen.getByText('Scanned')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Status' })).toHaveClass('w-[100px]')
    expect(screen.queryByText('Role-excluded content')).not.toBeInTheDocument()
    const requests = recentRequests()
    expect(requests).toHaveLength(2)
    expect(requests.every(url => url.searchParams.get('include_skipped') === '0')).toBe(true)
    expect(requests.some(url => url.searchParams.get('count_only') === '1')).toBe(true)
  })

  it('includes skipped rows with explicit reasons and restores the default when cleared', async () => {
    await renderDashboard()
    fireEvent.click(screen.getByRole('switch', { name: /Show settings-skipped messages/ }))
    await screen.findByTitle('Skipped: Ignored role')
    expect(screen.getByTitle('Skipped: Channel not monitored')).toBeInTheDocument()
    expect(screen.getByTitle('Skipped: Parent channel not monitored')).toBeInTheDocument()
    expect(screen.getAllByText('Skipped')).toHaveLength(3)
    expect(screen.getByText('Parent channel not monitored')).toHaveClass('truncate')
    fireEvent.click(screen.getByText('Parent-excluded content'))
    expect(screen.getByText('Skipped: Parent channel not monitored')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Recent Scanned Messages/ })).toHaveTextContent('(4)')
    const includedRequests = recentRequests().filter(url => url.searchParams.get('include_skipped') === '1')
    expect(includedRequests.some(url => url.searchParams.get('count_only') === '1')).toBe(true)
    expect(includedRequests.some(url => url.searchParams.get('skip_count') === '1')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await waitFor(() => expect(screen.queryByTitle('Skipped: Ignored role')).not.toBeInTheDocument())
    expect(screen.getByRole('switch', { name: /Show settings-skipped messages/ })).not.toBeChecked()
    expect(screen.getByText('Actually scanned')).toBeInTheDocument()
  })

  it('resets recent-message pagination when changing the skip filter', async () => {
    mockGet.mockImplementation(async (url: string) => {
      const result = respond(url)
      const parsed = new URL(url, 'http://localhost')
      if (parsed.pathname === '/api/guardian/recent' && parsed.searchParams.get('count_only') === '1') {
        return { data: { total: 50 } }
      }
      return result
    })
    await renderDashboard()
    fireEvent.click(screen.getAllByRole('button', { name: 'Next page' })[0])
    await waitFor(() => expect(recentRequests().some(url => url.searchParams.get('offset') === '20')).toBe(true))
    mockGet.mockClear()
    fireEvent.click(screen.getByRole('switch', { name: /Show settings-skipped messages/ }))
    await screen.findByTitle('Skipped: Ignored role')
    expect(recentRequests().every(url => url.searchParams.get('offset') === '0')).toBe(true)
  })

  it('does not let an older in-flight response override the new filter', async () => {
    await renderDashboard()
    const pending: Array<() => void> = []
    mockGet.mockImplementation((url: string) => {
      const parsed = new URL(url, 'http://localhost')
      if (parsed.pathname === '/api/guardian/recent' && parsed.searchParams.get('include_skipped') === '1') {
        return new Promise(resolve => { pending.push(() => resolve(respond(url))) })
      }
      return Promise.resolve(respond(url))
    })
    fireEvent.click(screen.getByRole('switch', { name: /Show settings-skipped messages/ }))
    await waitFor(() => expect(pending).toHaveLength(2))
    fireEvent.click(screen.getByRole('switch', { name: /Show settings-skipped messages/ }))
    await waitFor(() => expect(recentRequests().filter(url => url.searchParams.get('include_skipped') === '0')).toHaveLength(4))
    await act(async () => { pending.forEach(resolve => resolve()) })
    expect(screen.queryByTitle('Skipped: Ignored role')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Recent Scanned Messages/ })).toHaveTextContent('(1)')
  })
})

describe('Guardian dashboard date filters', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    mockGet.mockReset()
    mockGet.mockImplementation(async (url: string) => respond(url))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it.each([1, 23])('includes new scans at %s:13 local time', async hour => {
    const now = new Date(2026, 9, 25, hour, 13)
    vi.setSystemTime(now)
    mockGet.mockImplementation(async (url: string) => {
      const parsed = new URL(url, 'http://localhost')
      if (parsed.pathname !== '/api/guardian/recent') return respond(url)
      const since = parsed.searchParams.get('since')
      const until = parsed.searchParams.get('until')
      const included = (!since || new Date(since) <= now) && (!until || new Date(until) >= now)
      return {
        data: parsed.searchParams.get('count_only') === '1'
          ? { total: included ? 1 : 0 }
          : { messages: included ? [{ ...scannedRow, scanned_at: now.toISOString() }] : [] },
      }
    })

    await renderDashboard()
    expect(recentRequests()).toHaveLength(2)
    for (const request of recentRequests()) {
      expect(request.searchParams.get('since')).toBe(new Date(2026, 9, 11).toISOString())
      expect(request.searchParams.get('until')).toBe(now.toISOString())
    }
  })

  it('uses the same inclusive local-day boundaries for tables and stats', async () => {
    vi.setSystemTime(new Date(2026, 9, 25, 12))
    await renderDashboard()
    fireEvent.click(screen.getByRole('switch', { name: 'Use NOW as To date' }))
    fireEvent.change(screen.getByLabelText('From:'), { target: { value: '2026-10-25' } })
    fireEvent.change(screen.getByLabelText('To:'), { target: { value: '2026-10-25' } })

    await waitFor(() => {
      for (const endpoint of ['recent', 'flagged', 'stats']) {
        const requests = mockGet.mock.calls
          .map(([url]) => new URL(String(url), 'http://localhost'))
          .filter(url => url.pathname === `/api/guardian/${endpoint}`)
        const latest = requests.at(-1)
        expect(latest?.searchParams.get('since')).toBe(new Date(2026, 9, 25).toISOString())
        expect(latest?.searchParams.get('until')).toBe(new Date(2026, 9, 25, 23, 59, 59, 999).toISOString())
      }
    })
  })

  it('defaults To to NOW and rolls the selected period forward on refresh', async () => {
    vi.setSystemTime(new Date(2026, 9, 25, 23, 58))
    await renderDashboard()
    expect(screen.getByLabelText('To:')).toHaveValue('NOW')
    expect(screen.getByLabelText('To:')).toHaveAttribute('readonly')
    expect(screen.getByRole('switch', { name: 'Use NOW as To date' })).toBeChecked()
    expect(screen.getByLabelText('From:')).toHaveValue('2026-10-11')

    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 26, 0, 2))
    mockGet.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Now' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })

    expect(screen.getByLabelText('From:')).toHaveValue('2026-10-12')
    expect(screen.getByLabelText('To:')).toHaveValue('NOW')
    for (const request of recentRequests()) {
      expect(request.searchParams.get('since')).toBe(new Date(2026, 9, 12).toISOString())
      const until = new Date(request.searchParams.get('until') || '')
      expect(until >= new Date(2026, 9, 26, 0, 2)).toBe(true)
      expect(until < new Date(2026, 9, 26, 0, 3)).toBe(true)
    }
    expect(recentRequests()).toHaveLength(2)
  })

  it('keeps fixed dates on refresh and can return to a rolling NOW period', async () => {
    vi.setSystemTime(new Date(2026, 9, 25, 23, 58))
    await renderDashboard()
    fireEvent.click(screen.getByRole('switch', { name: 'Use NOW as To date' }))
    expect(screen.getByLabelText('To:')).toHaveAttribute('type', 'date')
    expect(screen.getByLabelText('To:')).toHaveValue('2026-10-25')
    await waitFor(() => expect(recentRequests().at(-1)?.searchParams.get('until'))
      .toBe(new Date(2026, 9, 25, 23, 59, 59, 999).toISOString()))

    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 26, 0, 2))
    mockGet.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Now' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(screen.getByLabelText('From:')).toHaveValue('2026-10-11')
    expect(screen.getByLabelText('To:')).toHaveValue('2026-10-25')
    expect(recentRequests()).toHaveLength(2)
    expect(recentRequests().every(request => request.searchParams.get('until') ===
      new Date(2026, 9, 25, 23, 59, 59, 999).toISOString())).toBe(true)

    fireEvent.click(screen.getByRole('switch', { name: 'Use NOW as To date' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByLabelText('To:')).toHaveValue('NOW')
    expect(screen.getByLabelText('From:')).toHaveValue('2026-10-12')
  })

  it('keeps a manually chosen From date while NOW advances', async () => {
    vi.setSystemTime(new Date(2026, 9, 25, 23, 58))
    await renderDashboard()
    fireEvent.change(screen.getByLabelText('From:'), { target: { value: '2026-10-01' } })
    await waitFor(() => expect(recentRequests().at(-1)?.searchParams.get('since'))
      .toBe(new Date(2026, 9, 1).toISOString()))

    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 26, 0, 2))
    mockGet.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Now' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(screen.getByLabelText('From:')).toHaveValue('2026-10-01')
    expect(recentRequests()).toHaveLength(2)
    expect(recentRequests().every(request => request.searchParams.get('since') ===
      new Date(2026, 9, 1).toISOString())).toBe(true)
  })

  it('clears NOW and its bounds when all filters are cleared', async () => {
    vi.setSystemTime(new Date(2026, 9, 25, 12))
    await renderDashboard()
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await waitFor(() => {
      expect(recentRequests().at(-1)?.searchParams.has('since')).toBe(false)
      expect(recentRequests().at(-1)?.searchParams.has('until')).toBe(false)
    })
    expect(screen.getByRole('switch', { name: 'Use NOW as To date' })).not.toBeChecked()
    expect(screen.getByLabelText('To:')).toHaveValue('')
    expect(screen.getByLabelText('From:')).toHaveValue('')
  })

  it.each([
    { period: '1 Day', since: '2026-10-25' },
    { period: '1 Week', since: '2026-10-19' },
    { period: '1 Month', since: '2026-09-26' },
    { period: 'All', since: '' },
  ])('rolls the $period preset on refresh', async ({ period, since }) => {
    vi.setSystemTime(new Date(2026, 9, 25, 23, 58))
    await renderDashboard()
    fireEvent.click(screen.getByRole('radio', { name: period }))
    await act(async () => {})
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 26, 0, 2))
    mockGet.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Now' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(screen.getByLabelText('From:')).toHaveValue(since)
    expect(recentRequests()).toHaveLength(2)
    const expectedSince = since ? new Date(`${since}T00:00:00`).toISOString() : null
    expect(recentRequests().every(request => request.searchParams.get('since') === expectedSince)).toBe(true)
  })

  it('uses fresh NOW bounds when the page is reopened', async () => {
    vi.setSystemTime(new Date(2026, 9, 25, 23, 58))
    await renderDashboard()
    cleanup()
    mockGet.mockClear()
    const nextDay = new Date(2026, 9, 26, 0, 2)
    vi.setSystemTime(nextDay)
    await renderDashboard()
    expect(screen.getByLabelText('From:')).toHaveValue('2026-10-12')
    expect(screen.getByLabelText('To:')).toHaveValue('NOW')
    expect(recentRequests().every(request => request.searchParams.get('until') === nextDay.toISOString())).toBe(true)
  })
})
