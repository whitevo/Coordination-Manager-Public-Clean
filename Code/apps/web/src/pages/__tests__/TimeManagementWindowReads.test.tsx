import '@testing-library/jest-dom/vitest'
import { startOfWeek } from 'date-fns'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { getWeekEventWindow, type UserEventWindow } from '../../lib/user-event-window'
import type { UserEventRecord } from '../time-management-event-reconciliation'
import { installDefaultApiMocks, installEditorDomPolyfills, mockDedupedGet, mockUseAuth } from './time-management-test-harness'
import { apiClient } from '../../lib/api-client'
import TimeManagementPage from '../TimeManagementPage'

interface Read {
  window: UserEventWindow
  resolve: (events: UserEventRecord[]) => void
  reject: (error: Error) => void
}
let reads: Read[]
const week = startOfWeek(new Date(), { weekStartsOn: 1 })
const visibleWindow = getWeekEventWindow(week)
const master: UserEventRecord = {
  id: 'series', title: 'Weekly master', description: null, meeting_link: null, location: null,
  start_time: `${visibleWindow.windowStart.slice(0, 10)}T09:00:00Z`,
  end_time: `${visibleWindow.windowStart.slice(0, 10)}T10:00:00Z`,
  recurrence_rule: { type: 'weekly' }, source_type: 'manual', source_id: 'mode-main',
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  reads = []
  mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, isTraveler: false, user: { id: crypto.randomUUID() } })
  installDefaultApiMocks()
  installEditorDomPolyfills()
  const defaultGet = mockDedupedGet.getMockImplementation()
  mockDedupedGet.mockImplementation(async (url: string, config?: { params?: UserEventWindow }) => {
    if (url !== '/api/user-events') return defaultGet?.(url)
    if (!config?.params) throw new Error('Expected scoped event parameters')
    const params = config.params
    const events = await new Promise<UserEventRecord[]>((resolve, reject) => {
      reads.push({ window: params, resolve, reject })
    })
    return { data: { events } }
  })
  vi.mocked(apiClient.get).mockImplementation(async (url, config) => mockDedupedGet(url, config))
})

async function mount() {
  const view = render(<MemoryRouter><TimeManagementPage /></MemoryRouter>)
  await waitFor(() => expect(reads).toHaveLength(1))
  return view
}
async function complete(index: number, events: UserEventRecord[]) {
  await act(async () => { reads[index].resolve(events) })
}
async function refresh() {
  const previous = reads.length
  fireEvent(window, new StorageEvent('storage', {
    key: 'coord-time-management-sync-ping', newValue: JSON.stringify({ tabId: 'other-tab', reason: 'event-deleted' }),
  }))
  await waitFor(() => expect(reads.length).toBe(previous + 1))
}

describe('scoped event read ordering', () => {
  it('isolates both existing rows and late reads when switching accounts', async () => {
    const view = await mount()
    await complete(0, [master])
    await screen.findAllByText(master.title)
    await refresh()
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, isTraveler: false, user: { id: 'next-account' } })
    view.rerender(<MemoryRouter><TimeManagementPage /></MemoryRouter>)
    expect(screen.queryByText(master.title)).not.toBeInTheDocument()
    await waitFor(() => expect(reads).toHaveLength(3))
    await complete(2, [])
    await complete(1, [master])
    expect(screen.queryByText(master.title)).not.toBeInTheDocument()
  })
  it('ignores a reversed response for the same window', async () => {
    await mount()
    await complete(0, [master])
    await screen.findAllByText(master.title)
    await refresh()
    await refresh()
    await complete(2, [])
    await complete(1, [master])
    expect(screen.queryByText(master.title)).not.toBeInTheDocument()
  })
  it('does not resurrect a recurrence master after a newer overlapping observation deletes it', async () => {
    await mount()
    await complete(0, [master])
    await screen.findAllByText(master.title)
    await refresh()
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    await waitFor(() => expect(reads).toHaveLength(3))
    expect(reads[2].window.windowStart).toBe(visibleWindow.windowEnd)
    await complete(2, [])
    await complete(1, [master])
    expect(screen.queryByText(master.title)).not.toBeInTheDocument()
  })
  it('does not resurrect a previously unseen master missing from a newer complete window', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    await waitFor(() => expect(reads).toHaveLength(2))
    await complete(1, [])
    await complete(0, [master])
    expect(screen.queryByText(master.title)).not.toBeInTheDocument()
  })
  it('does not show an old week failure over the current week', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    await waitFor(() => expect(reads).toHaveLength(2))
    await complete(1, [])
    await act(async () => { reads[0].reject(new Error('Old window failed')) })
    expect(screen.queryByText('Old window failed')).not.toBeInTheDocument()
  })
})
