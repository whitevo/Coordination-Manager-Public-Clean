import '@testing-library/jest-dom/vitest'
import { startOfWeek } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import {
  installDefaultApiMocks,
  installEditorDomPolyfills,
  mockDedupedGet,
  mockUseAuth,
} from './time-management-test-harness'
import { apiClient } from '../../lib/api-client'
import TimeManagementPage from '../TimeManagementPage'

const TITLE_PLACEHOLDER = 'Type Title for Time Item'

describe('TimeManagement time adjustment', () => {
  const originalWidth = window.innerWidth
  let week: Date
  let persistedEvents: Record<string, unknown>[]

  function timestamp(day: number, minute: number): string {
    return new Date(Date.UTC(week.getFullYear(), week.getMonth(), week.getDate() + day) + minute * 60000).toISOString()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, isTraveler: false })
    installDefaultApiMocks()
    installEditorDomPolyfills()
    week = startOfWeek(new Date(), { weekStartsOn: 1 })
    persistedEvents = []
    localStorage.setItem('time-management-v1', JSON.stringify({ openLeftPanelOnSelectionMode: 'never' }))
    const defaultGet = mockDedupedGet.getMockImplementation()
    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/user-events') return { data: { events: persistedEvents } }
      return defaultGet?.(url)
    })
    vi.mocked(apiClient.put).mockImplementation(async (url, payload) => {
      if (url === '/api/user-events/adjust-item') {
        persistedEvents = persistedEvents.map((event) => ({ ...event, ...(payload as Record<string, unknown>) }))
      }
      return { data: {} }
    })
    vi.mocked(apiClient.post).mockImplementation(async (_url, payload) => {
      const event = { ...(payload as Record<string, unknown>), id: 'created-item', source_type: 'manual' }
      persistedEvents.push(event)
      return { data: { event } }
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
  })

  function renderPage(width = 1400) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    return render(<MemoryRouter><TimeManagementPage /></MemoryRouter>)
  }

  function seedItem(day: number, start: number, duration: number, recurring = false) {
    persistedEvents = [{
      id: 'adjust-item', title: 'Adjustable item', description: 'Original notes',
      meeting_link: null, location: null, source_type: 'manual', source_id: 'mode-main',
      category_ids: [], start_time: timestamp(day, start), end_time: timestamp(day, start + duration),
      recurrence_rule: recurring ? { type: 'weekly' } : { type: 'none' },
    }]
  }

  async function openItemAdjuster(width: number, fullView: boolean) {
    renderPage(width)
    fireEvent.click((await screen.findAllByText('Adjustable item'))[0])
    await screen.findByPlaceholderText(TITLE_PLACEHOLDER)
    if (fullView) fireEvent.click(screen.getByTitle('Open full view editor'))
    const surface = fullView ? screen.getByTestId('full-editor-overlay') : screen.getByTestId('time-management-left-panel')
    if (fullView && width < 768) {
      fireEvent.click(await within(surface).findByRole('button', { name: 'Reveal more tools' }))
    }
    fireEvent.click(await within(surface).findByRole('button', { name: 'Adjust Time' }))
    return within(surface)
  }

  it.each([320, 390])('reveals mobile full-view tools once per opening and retains notes at width %i', async (width) => {
    seedItem(0, 600, 30)
    renderPage(width)
    fireEvent.click((await screen.findAllByText('Adjustable item'))[0])
    await screen.findByPlaceholderText(TITLE_PLACEHOLDER)
    fireEvent.click(screen.getByTitle('Open full view editor'))
    const overlay = screen.getByTestId('full-editor-overlay')
    const surface = within(overlay)
    const reveal = await surface.findByRole('button', { name: 'Reveal more tools' })
    expect(reveal.previousElementSibling).toHaveTextContent('Guiding')
    expect(reveal).not.toHaveClass('min-h-11')
    expect(reveal).toHaveClass('h-8', 'px-2.5')
    expect(reveal.previousElementSibling).toHaveClass('h-8', 'px-2.5')
    expect(surface.queryByRole('button', { name: 'B' })).not.toBeInTheDocument()
    expect(surface.queryByRole('button', { name: 'Adjust Time' })).not.toBeInTheDocument()
    expect(surface.queryByRole('button', { name: 'Add Location' })).not.toBeInTheDocument()
    expect(surface.getByTestId('full-editor-body')).toHaveClass('overflow-y-auto', 'overscroll-contain', 'min-h-0')
    expect(overlay.querySelector('.markdown-editor')).not.toHaveClass('h-full')
    expect(surface.getByRole('button', { name: 'Close' })).toHaveClass('order-2')
    expect(surface.getByRole('heading', { name: 'Adjustable item' }).parentElement?.parentElement?.parentElement)
      .toHaveClass('grid', 'grid-cols-[minmax(0,1fr)_auto]', 'shrink-0')

    fireEvent.click(reveal)
    expect(surface.queryByRole('button', { name: 'Reveal more tools' })).not.toBeInTheDocument()
    const bold = surface.getByRole('button', { name: 'B' })
    expect(bold.parentElement?.parentElement).toHaveClass('animate-in', 'slide-in-from-top-3', 'zoom-in-95', 'duration-500', 'motion-reduce:animate-none')
    expect(bold.parentElement?.parentElement).toHaveClass('tools-reveal-highlight')
    expect(surface.getByRole('button', { name: 'Guiding' })).not.toHaveClass('tools-reveal-highlight')
    expect(surface.getByRole('button', { name: 'Add Location' }).parentElement).toBe(bold.parentElement?.parentElement)
    expect(surface.getByRole('button', { name: 'Adjust Time' })).toBeInTheDocument()
    fireEvent.click(surface.getByRole('button', { name: 'Close' }))
    expect(screen.queryByTestId('full-editor-overlay')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Open full view editor'))
    const reopened = within(screen.getByTestId('full-editor-overlay'))
    expect(reopened.getByRole('button', { name: 'Reveal more tools' })).toBeInTheDocument()
    expect(reopened.queryByRole('button', { name: 'B' })).not.toBeInTheDocument()
    expect(reopened.queryByRole('button', { name: 'Adjust Time' })).not.toBeInTheDocument()
    expect(reopened.queryByRole('button', { name: 'Add Location' })).not.toBeInTheDocument()
    expect(reopened.getByText('Original notes')).toBeInTheDocument()
    expect(vi.mocked(apiClient.put).mock.calls.filter(([url]) => url.startsWith('/api/user-events'))).toHaveLength(0)
  })

  it('removes the reveal highlight after two seconds without hiding tools or replaying expansion', async () => {
    seedItem(0, 600, 30)
    renderPage(390)
    fireEvent.click((await screen.findAllByText('Adjustable item'))[0])
    await screen.findByPlaceholderText(TITLE_PLACEHOLDER)
    fireEvent.click(screen.getByTitle('Open full view editor'))
    const surface = within(screen.getByTestId('full-editor-overlay'))
    await surface.findByRole('button', { name: 'Reveal more tools' })
    vi.useFakeTimers()
    try {
      fireEvent.click(surface.getByRole('button', { name: 'Reveal more tools' }))
      const tools = surface.getByRole('button', { name: 'Add Location' }).parentElement
      const adjuster = surface.getByRole('button', { name: 'Adjust Time' }).parentElement?.parentElement
      expect(tools).toHaveClass('tools-reveal-highlight')
      expect(adjuster).toHaveClass('tools-reveal-highlight')
      act(() => { vi.advanceTimersByTime(1999) })
      expect(tools).toHaveClass('tools-reveal-highlight')
      act(() => { vi.advanceTimersByTime(1) })
      expect(tools).not.toHaveClass('tools-reveal-highlight')
      expect(adjuster).not.toHaveClass('tools-reveal-highlight')
      expect(tools).toHaveClass('animate-in', 'duration-500')
      expect(surface.getByRole('button', { name: 'Add Location' })).toBeInTheDocument()
      expect(surface.getByRole('button', { name: 'Adjust Time' })).toBeInTheDocument()
      expect(surface.queryByRole('button', { name: 'Reveal more tools' })).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([768, 1400])('keeps full-view tools immediately available above phone width %i', async (width) => {
    seedItem(0, 600, 30)
    renderPage(width)
    fireEvent.click((await screen.findAllByText('Adjustable item'))[0])
    await screen.findByPlaceholderText(TITLE_PLACEHOLDER)
    fireEvent.click(screen.getByTitle('Open full view editor'))
    const overlay = screen.getByTestId('full-editor-overlay')
    const surface = within(overlay)
    expect(surface.queryByRole('button', { name: 'Reveal more tools' })).not.toBeInTheDocument()
    expect(await surface.findByRole('button', { name: 'B' })).toBeInTheDocument()
    expect(surface.getByRole('button', { name: 'Adjust Time' })).toBeInTheDocument()
    expect(surface.getByRole('button', { name: 'Add Location' })).toBeInTheDocument()
    expect(surface.getByTestId('full-editor-body')).not.toHaveClass('overflow-y-auto')
    expect(overlay.querySelector('.markdown-editor')).toHaveClass('h-full', 'overflow-y-auto')
  })

  it.each([
    { edge: 'end', step: 60, start: 600, expectedStart: 540, expectedEnd: 570, width: 1400, fullView: false },
    { edge: 'start', step: 60, start: 600, expectedStart: 660, expectedEnd: 690, width: 1400, fullView: false },
    { edge: 'end', step: 30, start: 600, expectedStart: 570, expectedEnd: 600, width: 390, fullView: true },
    { edge: 'start', step: 30, start: 600, expectedStart: 630, expectedEnd: 660, width: 390, fullView: true },
    { edge: 'end', step: 60, start: 0, expectedStart: -60, expectedEnd: -30, width: 1400, fullView: false },
    { edge: 'start', step: 60, start: 1410, expectedStart: 1470, expectedEnd: 1500, width: 390, fullView: true },
  ])('relocates saved items using $edge $step at width $width, start $start', async ({ edge, step, start, expectedStart, expectedEnd, width, fullView }) => {
    const day = start === 1410 ? 6 : 0
    seedItem(day, start, 30)
    const surface = await openItemAdjuster(width, fullView)
    if (step !== 30) fireEvent.click(surface.getByRole('button', { name: `${step}m` }))
    const button = surface.getByTitle(`Move ${edge} ${step} minutes ${edge === 'end' ? 'earlier' : 'later'}`)
    fireEvent.click(button)
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/api/user-events/adjust-item', {
      start_time: timestamp(day, expectedStart), end_time: timestamp(day, expectedEnd),
    }))
    await waitFor(() => expect(button).not.toBeDisabled())
    expect(surface.getByPlaceholderText(TITLE_PLACEHOLDER)).toHaveValue('Adjustable item')
    expect(surface.getByRole('button', { name: 'Adjust Time' })).toBeInTheDocument()
    if (fullView) expect(screen.getByTestId('full-editor-overlay')).toBeInTheDocument()
    if (start === 0) expect(surface.getByText('23:00', { exact: false })).toBeInTheDocument()
  })

  it('adjusts the actual occurrence when only a continuation segment is visible', async () => {
    seedItem(-1, 1410, 60)
    const surface = await openItemAdjuster(1400, false)
    fireEvent.click(surface.getByRole('button', { name: '120m' }))
    fireEvent.click(surface.getByTitle('Move start 120 minutes later'))
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/api/user-events/adjust-item', {
      start_time: timestamp(0, 90), end_time: timestamp(0, 150),
    }))
  })

  it('preserves the actual duration of an item shorter than one grid slot when relocating', async () => {
    seedItem(0, 600, 15)
    const surface = await openItemAdjuster(1400, false)
    fireEvent.click(surface.getByRole('button', { name: '60m' }))
    fireEvent.click(surface.getByTitle('Move end 60 minutes earlier'))
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/api/user-events/adjust-item', {
      start_time: timestamp(0, 540), end_time: timestamp(0, 555),
    }))
  })

  it('keeps repeated relocation available after each write and prevents overlapping writes', async () => {
    seedItem(0, 600, 30)
    let resolveWrite: (() => void) | undefined
    vi.mocked(apiClient.put).mockImplementation(async (url) => {
      if (url === '/api/user-events/adjust-item') {
        await new Promise<void>((resolve) => { resolveWrite = resolve })
      }
      return { data: {} }
    })
    const surface = await openItemAdjuster(1400, false)
    const button = surface.getByTitle('Move end 30 minutes earlier')
    fireEvent.click(button)
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(vi.mocked(apiClient.put).mock.calls.filter(([url]) => url === '/api/user-events/adjust-item')).toHaveLength(1)
    resolveWrite?.()
    await waitFor(() => expect(button).not.toBeDisabled())
    vi.mocked(apiClient.put).mockResolvedValue({ data: {} })
    fireEvent.click(button)
    await waitFor(() => expect(apiClient.put).toHaveBeenLastCalledWith('/api/user-events/adjust-item', {
      start_time: timestamp(0, 540), end_time: timestamp(0, 570),
    }))
  })

  it('restores the original week and interval when a crossing save fails', async () => {
    seedItem(0, 0, 30)
    vi.mocked(apiClient.put).mockRejectedValue(new Error('Simulated adjustment failure'))
    const surface = await openItemAdjuster(1400, false)
    fireEvent.click(surface.getByRole('button', { name: '60m' }))
    fireEvent.click(surface.getByTitle('Move end 60 minutes earlier'))
    await screen.findByText('Could not adjust start/end time. Try again.')
    expect(surface.getByText('00:00', { exact: false })).toBeInTheDocument()
    expect(surface.getByText('00:30', { exact: false })).toBeInTheDocument()
    expect(surface.getByPlaceholderText(TITLE_PLACEHOLDER)).toHaveValue('Adjustable item')
    expect(surface.getByTitle('Move end 60 minutes earlier')).not.toBeDisabled()
  })

  it.each(['cancel', 'this', 'future'])('keeps recurrence scope confirmation for a crossing adjustment: %s', async (scope) => {
    seedItem(0, 0, 30, true)
    const surface = await openItemAdjuster(1400, false)
    fireEvent.click(surface.getByRole('button', { name: '60m' }))
    fireEvent.click(surface.getByTitle('Move end 60 minutes earlier'))
    const dialog = await screen.findByRole('dialog', { name: 'Edit recurring item' })
    expect(vi.mocked(apiClient.put).mock.calls.filter(([url]) => url === '/api/user-events/adjust-item')).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole('button', {
      name: scope === 'cancel' ? 'Cancel' : scope === 'this' ? 'This item only' : 'This and future occurrences',
    }))
    if (scope === 'cancel') {
      await waitFor(() => expect(surface.getByTitle('Move end 60 minutes earlier')).not.toBeDisabled())
      expect(apiClient.post).not.toHaveBeenCalled()
      expect(vi.mocked(apiClient.put).mock.calls.filter(([url]) => url === '/api/user-events/adjust-item')).toHaveLength(0)
    } else {
      await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/user-events', expect.objectContaining({
        start_time: timestamp(0, -60), end_time: timestamp(0, -30),
      })))
    }
  })

  async function openSelectionAdjuster({ width, day, start }: { width: number; day: number; start: number }) {
    renderPage(width)
    const column = await screen.findByTestId(`calendar-day-column-${day}`)
    vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 1440, width: 100, height: 1440, toJSON: () => ({}),
    })
    fireEvent.mouseDown(column, { button: 0, clientX: 20, clientY: start })
    fireEvent.pointerUp(window)
    if (width < 768) {
      fireEvent.click(screen.getByRole('button', { name: 'Full view' }))
    } else {
      fireEvent.click(screen.getByTitle('Show left panel'))
      const expand = screen.queryByRole('button', { name: /^(Create|Edit) Time Item$/, expanded: false })
      if (expand) fireEvent.click(expand)
    }
    const surface = width < 768 ? screen.getByTestId('full-editor-overlay') : screen.getByTestId('time-management-left-panel')
    if (width < 768) {
      fireEvent.click(await within(surface).findByRole('button', { name: 'Reveal more tools' }))
    }
    fireEvent.change(within(surface).getByPlaceholderText(TITLE_PLACEHOLDER), { target: { value: 'Moved selection' } })
    fireEvent.click(within(surface).getByRole('button', { name: 'Adjust selection time' }))
    return within(surface)
  }

  it.each([
    { width: 1400, day: 0, start: 600, edge: 'end', expectedDay: 0, expectedStart: 540, expectedEnd: 570 },
    { width: 390, day: 0, start: 600, edge: 'start', expectedDay: 0, expectedStart: 660, expectedEnd: 690 },
    { width: 1400, day: 0, start: 0, edge: 'end', expectedDay: 6, expectedStart: -60, expectedEnd: -30 },
    { width: 390, day: 6, start: 1410, edge: 'start', expectedDay: 0, expectedStart: 1470, expectedEnd: 1500 },
  ])('moves and saves an unsaved selection: $edge at $day:$start, viewport $width', async ({ width, day, start, edge, expectedDay, expectedStart, expectedEnd }) => {
    const surface = await openSelectionAdjuster({ width, day, start })
    fireEvent.click(surface.getByRole('button', { name: '60m' }))
    fireEvent.click(surface.getByTitle(`Move ${edge} 60 minutes ${edge === 'end' ? 'earlier' : 'later'}`))
    expect(screen.getByTestId(`selection-day-segment-${expectedDay}`)).toBeInTheDocument()
    expect(surface.getByPlaceholderText(TITLE_PLACEHOLDER)).toHaveValue('Moved selection')
    fireEvent.click(screen.getByTestId(width < 768 ? 'full-editor-save-button' : 'left-sidebar-save-button'))
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/user-events', expect.objectContaining({
      title: 'Moved selection', start_time: timestamp(day, expectedStart), end_time: timestamp(day, expectedEnd),
    })))
  })

  it('splits a selection highlight at midnight and saves its full duration', async () => {
    const surface = await openSelectionAdjuster({ width: 1400, day: 2, start: 1410 })
    fireEvent.click(surface.getByTitle('Move end 30 minutes later'))
    expect(screen.getByTestId('selection-day-segment-2')).toHaveStyle({ height: '26px' })
    expect(screen.getByTestId('selection-day-segment-3')).toHaveStyle({ top: '0px', height: '26px' })
    expect(surface.getByText('00:30', { exact: false })).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('left-sidebar-save-button'))
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/user-events', expect.objectContaining({
      start_time: timestamp(2, 1410), end_time: timestamp(3, 30),
    })))
  })
})
