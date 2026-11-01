import '@testing-library/jest-dom/vitest'
import { addWeeks, startOfWeek } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { installDefaultApiMocks, installEditorDomPolyfills, mockDedupedGet, mockUseAuth } from './time-management-test-harness'
import { apiClient } from '@/lib/api-client'
import type { TimeItemRecurrence, UserEventRecord } from '../time-management-event-reconciliation'
import TimeManagementPage from '../TimeManagementPage'

const recurrence: TimeItemRecurrence = {
  id: 'conditional-series', status: 'active', latest_event_id: 'latest',
  recurrence_rule: { type: 'custom', unit: 'day', interval: 1, endType: 'whenCompleted' },
  completed_at: null, updated_at: '2026-01-01T00:00:00Z',
}

function item(id: string, weekOffset = 0, dayOffset = 0): UserEventRecord {
  const week = addWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), weekOffset)
  const start = new Date(Date.UTC(week.getFullYear(), week.getMonth(), week.getDate() + dayOffset, 9))
  return {
    id, title: `Item ${id}`, description: null, meeting_link: null, location: null,
    start_time: start.toISOString(), end_time: new Date(start.getTime() + 3600000).toISOString(),
    source_type: 'manual', source_id: 'mode-main', category_ids: [],
    recurrence_id: recurrence.id, recurrence_rule: recurrence.recurrence_rule, recurrence,
  }
}

function setup(initial: UserEventRecord[]) {
  let rows = initial
  const defaultGet = mockDedupedGet.getMockImplementation()
  mockDedupedGet.mockImplementation(async (url: string) => {
    if (url === '/api/user-events/conditional-recurrences') return { data: { active: rows.some(row => row.recurrence?.status === 'active') } }
    if (url === '/api/user-events') return { data: { events: rows } }
    if (url.endsWith('/latest-occurrence')) return { data: { event: rows.find(row => row.id === 'latest') } }
    return defaultGet?.(url)
  })
  vi.mocked(apiClient.post).mockImplementation(async (url) => {
    if (url.endsWith('/complete-recurrence')) {
      const completed = { ...recurrence, status: 'completed' as const, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      rows = rows.map(row => ({
        ...row, recurrence: completed,
        ...(row.id === 'latest' ? { completed_at: completed.completed_at } : {}),
      }))
      return { data: { recurrence: completed, event: rows.find(row => row.id === 'latest') } }
    }
    return { data: { created: 0 } }
  })
  return render(<MemoryRouter><TimeManagementPage /></MemoryRouter>)
}

describe('conditional Time Item recurrence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('time-management-v1', JSON.stringify({ openLeftPanelOnItemSelectionMode: 'always' }))
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, isTraveler: false })
    installDefaultApiMocks()
    installEditorDomPolyfills()
  })

  it('checks active series on load and renders only the persisted occurrence with an accessible icon', async () => {
    setup([item('latest')])
    await screen.findAllByText('Item latest')
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/user-events/conditional-recurrences/check'))
    const icons = screen.getAllByRole('img', { name: 'Repeats until marked as completed.' })
    expect(icons).toHaveLength(1)
    expect(icons[0].parentElement).toHaveAttribute('title', 'Repeats until marked as completed.')
  })

  it('checks active series even when its items are outside the displayed week', async () => {
    setup([item('latest', 2)])
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/user-events/conditional-recurrences/check'))
    expect(screen.queryByText('Item latest')).not.toBeInTheDocument()
  })

  it('rechecks while the page stays open', async () => {
    vi.useFakeTimers()
    try {
      await act(async () => { setup([item('latest')]) })
      const initialChecks = vi.mocked(apiClient.post).mock.calls.filter(([url]) => url.endsWith('/check')).length
      expect(initialChecks).toBeGreaterThan(0)
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
      expect(vi.mocked(apiClient.post).mock.calls.filter(([url]) => url.endsWith('/check')).length).toBeGreaterThan(initialChecks)
    } finally {
      vi.useRealTimers()
    }
  })

  it('completes the series without deleting items or rewriting its schedule', async () => {
    setup([item('historical'), item('latest', 0, 1)])
    fireEvent.click((await screen.findAllByText('Item latest'))[0])
    const complete = await screen.findByRole('button', { name: 'Complete recurrence' })
    const dropdown = screen.getByRole('button', { name: /^Recurrence Every/ })
    // The Disclosure wraps its button in a div, so the shared header row is two levels up.
    expect(dropdown.parentElement?.parentElement).toContainElement(complete)
    expect(complete.compareDocumentPosition(dropdown) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('Ends: When marked as completed')).not.toBeInTheDocument()
    expect(screen.queryByText('Stops future repeats for the whole series. This does not mark this Time Item as completed.')).not.toBeInTheDocument()
    fireEvent.click(complete)
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/user-events/latest/complete-recurrence'))
    await screen.findByText('Recurrence completed')
    expect(screen.getByText('Time Item completed')).toBeInTheDocument()
    expect(screen.getAllByText('Item historical').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Item latest').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Complete recurrence' })).not.toBeInTheDocument()
    expect(apiClient.delete).not.toHaveBeenCalled()
    expect(vi.mocked(apiClient.put).mock.calls.filter(([url]) => url.startsWith('/api/user-events/'))).toHaveLength(0)
    expect(screen.getAllByRole('img', { name: 'Recurrence completed' }).length).toBeGreaterThan(0)
    const readsBeforeRefresh = mockDedupedGet.mock.calls.filter(([url]) => url === '/api/user-events').length
    fireEvent.focus(window)
    await waitFor(() => expect(mockDedupedGet.mock.calls.filter(([url]) => url === '/api/user-events').length).toBeGreaterThan(readsBeforeRefresh))
    expect(screen.getByText('Time Item completed')).toBeInTheDocument()
    fireEvent.click(screen.getAllByText('Item historical')[0])
    expect(screen.getByText('Recurrence completed')).toBeInTheDocument()
    expect(screen.queryByText('Time Item completed')).not.toBeInTheDocument()
  })

  it('keeps previously completed historical items completed', async () => {
    setup([{ ...item('historical'), completed_at: '2026-01-01T09:00:00Z' }, item('latest', 0, 1)])
    fireEvent.click((await screen.findAllByText('Item latest'))[0])
    fireEvent.click(await screen.findByRole('button', { name: 'Complete recurrence' }))
    await screen.findByText('Time Item completed')
    fireEvent.click(screen.getAllByText('Item historical')[0])
    expect(screen.getByText('Time Item completed')).toBeInTheDocument()
  })

  it('places the completion action to the left of the dropdown in full view too', async () => {
    setup([item('latest')])
    fireEvent.click((await screen.findAllByText('Item latest'))[0])
    fireEvent.click(screen.getByTitle('Open full view editor'))
    const dialog = screen.getByTestId('full-editor-overlay')
    const complete = within(dialog).getByRole('button', { name: 'Complete recurrence' })
    const dropdown = within(dialog).getByRole('button', { name: /^Recurrence Every/ })
    // The Disclosure wraps its button in a div, so the shared header row is two levels up.
    expect(dropdown.parentElement?.parentElement).toContainElement(complete)
    expect(complete.compareDocumentPosition(dropdown) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(dialog).queryByText('Ends: When marked as completed')).not.toBeInTheDocument()
    fireEvent.click(complete)
    await within(dialog).findByText('Time Item completed')
  })

  it('routes historical recurrence actions to the latest occurrence in another week', async () => {
    setup([item('historical'), item('latest', 1)])
    fireEvent.click((await screen.findAllByText('Item historical'))[0])
    expect(screen.queryByRole('button', { name: 'Complete recurrence' })).not.toBeInTheDocument()
    const editorToggle = screen.getByRole('button', { name: /^Recurrence Every/ })
    if (editorToggle.getAttribute('aria-expanded') === 'false') fireEvent.click(editorToggle)
    expect(screen.getByRole('button', { name: 'When marked as completed' })).toBeDisabled()
    fireEvent.click(await screen.findByRole('button', { name: 'Go to latest occurrence' }))
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/user-events/historical/latest-occurrence'))
    await screen.findByRole('button', { name: 'Complete recurrence' })
    await waitFor(() => expect(screen.getByPlaceholderText('Type Title for Time Item')).toHaveValue('Item latest'))
    expect(screen.getByRole('button', { name: 'Weekly' })).toBeEnabled()
  })

  it('retains content and shows errors when recurrence checking fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    setup([item('latest')])
    await screen.findAllByText('Item latest')
    vi.mocked(apiClient.post).mockRejectedValue(new Error('Recurrence check unavailable'))
    fireEvent.focus(window)
    await screen.findByText('Recurrence check unavailable')
    expect(screen.getAllByText('Item latest').length).toBeGreaterThan(0)
    log.mockRestore()
  })
})
