import '@testing-library/jest-dom/vitest'
import { addWeeks, startOfWeek } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import {
  installDefaultApiMocks,
  installEditorDomPolyfills,
  mockDedupedGet,
  mockUseAuth,
} from './time-management-test-harness'
import { getWeekEventWindow } from '../../lib/user-event-window'
import TimeManagementPage from '../TimeManagementPage'
import { getMondayBasedWeekday, getVisibleDayIndexes, shiftDayWindow } from '../time-management-zoom'

const STORAGE_KEY = 'time-management-v1'

describe('TimeManagement zoom quick buttons', () => {
  const originalWidth = window.innerWidth

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, isTraveler: false })
    installDefaultApiMocks()
    installEditorDomPolyfills()
  })

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
  })

  function renderPage(preferences: Record<string, unknown> = {}) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ openLeftPanelOnSelectionMode: 'never', ...preferences }))
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1400 })
    return render(<MemoryRouter><TimeManagementPage /></MemoryRouter>)
  }

  function visibleDayIndexes(): number[] {
    const grid = screen.getByTestId('calendar-week-grid')
    const indexes = Array.from(grid.querySelectorAll<HTMLElement>('[data-time-management-day-index]'))
      .map((element) => Number(element.dataset.timeManagementDayIndex))
    return Array.from(new Set(indexes)).sort((a, b) => a - b)
  }

  function storedPreferences(): Record<string, unknown> {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, unknown>
  }

  it('steps the day axis out to 2 and 4 weeks and pages by the visible span', async () => {
    renderPage()
    await screen.findByTestId('day-zoom-quick-buttons')
    expect(visibleDayIndexes()).toEqual([0, 1, 2, 3, 4, 5, 6])

    fireEvent.click(screen.getByRole('button', { name: 'Show 2 weeks' }))
    await waitFor(() => expect(visibleDayIndexes()).toHaveLength(14))
    expect(screen.getByRole('button', { name: 'Next 2 weeks' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show 4 weeks' }))
    await waitFor(() => expect(visibleDayIndexes()).toHaveLength(28))
    expect(screen.getByRole('button', { name: 'Day axis is fully zoomed out' })).toBeDisabled()
    expect(storedPreferences().dayZoomLevel).toBe(28)

    const thisWeek = startOfWeek(new Date(), { weekStartsOn: 1 })
    const laterWindowStarts = [1, 2, 3].map((offset) => getWeekEventWindow(addWeeks(thisWeek, offset)).windowStart)
    await waitFor(() => {
      const requestedStarts = mockDedupedGet.mock.calls
        .filter(([url]) => url === '/api/user-events')
        .map(([, config]) => (config as { params?: { windowStart?: string } } | undefined)?.params?.windowStart)
      for (const windowStart of laterWindowStarts) expect(requestedStarts).toContain(windowStart)
    })
  })

  it('zooms the day axis in around today', async () => {
    renderPage()
    await screen.findByTestId('day-zoom-quick-buttons')
    const today = getMondayBasedWeekday(new Date())

    fireEvent.click(screen.getByRole('button', { name: 'Show 5 days' }))
    await waitFor(() => expect(visibleDayIndexes()).toEqual(getVisibleDayIndexes(5, today)))

    fireEvent.click(screen.getByRole('button', { name: 'Show 3 days' }))
    await waitFor(() => expect(visibleDayIndexes()).toEqual(getVisibleDayIndexes(3, today)))

    fireEvent.click(screen.getByRole('button', { name: 'Show 2 days' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 day' }))
    await waitFor(() => expect(visibleDayIndexes()).toEqual([today]))
    expect(screen.getByRole('button', { name: 'Day axis is fully zoomed in' })).toBeDisabled()
  })

  it('steps the time axis between 15m, 30m and 1h', async () => {
    renderPage()
    await screen.findByTestId('time-zoom-quick-buttons')

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in time axis to 15m slots' }))
    await waitFor(() => expect(storedPreferences().slotMinutes).toBe(15))
    expect(screen.getByRole('button', { name: 'Time axis is fully zoomed in' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Zoom out time axis to 30m slots' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out time axis to 1h slots' }))
    await waitFor(() => expect(storedPreferences().slotMinutes).toBe(60))
    expect(screen.getByRole('button', { name: 'Time axis is fully zoomed out' })).toBeDisabled()
  })

  it('hides each quick button pair when its preference is off', async () => {
    renderPage({ showTimeZoomQuickButtons: false, showDayZoomQuickButtons: false })
    await screen.findByTestId('calendar-week-grid')
    expect(screen.queryByTestId('time-zoom-quick-buttons')).not.toBeInTheDocument()
    expect(screen.queryByTestId('day-zoom-quick-buttons')).not.toBeInTheDocument()
  })

  it('scrolls a multi-week view sideways with the wheel over the day header', async () => {
    renderPage({ dayZoomLevel: 14 })
    await screen.findByTestId('calendar-week-grid')
    const scroller = screen.getByTestId('calendar-horizontal-scroll')
    Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: 2000 })
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 500 })
    scroller.scrollLeft = 300

    fireEvent.wheel(screen.getByTestId('calendar-header-top'), { deltaY: 100 })
    expect(scroller.scrollLeft).toBe(200)

    fireEvent.wheel(screen.getByTestId('calendar-header-top'), { deltaY: -250 })
    expect(scroller.scrollLeft).toBe(450)
  })

  it('places the time zoom buttons right after the sidebar toggle', async () => {
    renderPage()
    const group = await screen.findByTestId('time-zoom-quick-buttons')
    expect(group.previousElementSibling).toHaveAttribute('aria-label', expect.stringMatching(/left panel$/))
  })

  it('zooms out from a sub-week view straight back to 1 week', async () => {
    renderPage({ dayZoomLevel: 3 })
    await screen.findByTestId('day-zoom-quick-buttons')
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 week' }))
    await waitFor(() => expect(visibleDayIndexes()).toEqual([0, 1, 2, 3, 4, 5, 6]))
    expect(storedPreferences().dayZoomLevel).toBe(7)
  })

  it('moves sub-week views one day with single arrows and one week with double arrows', async () => {
    renderPage({ dayZoomLevel: 3 })
    await screen.findByTestId('calendar-week-grid')
    const initial = getVisibleDayIndexes(3, getMondayBasedWeekday(new Date()))
    expect(visibleDayIndexes()).toEqual(initial)
    expect(screen.queryByRole('button', { name: 'Previous 1 week' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next day' }))
    const { start: nextStart } = shiftDayWindow(initial[0], 1)
    await waitFor(() => expect(visibleDayIndexes()).toEqual([nextStart, nextStart + 1, nextStart + 2]))

    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }))
    await waitFor(() => expect(visibleDayIndexes()).toEqual(initial))

    const thisWeek = startOfWeek(new Date(), { weekStartsOn: 1 })
    const nextWeekWindowStart = getWeekEventWindow(addWeeks(thisWeek, 1)).windowStart
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    await waitFor(() => {
      const requestedStarts = mockDedupedGet.mock.calls
        .filter(([url]) => url === '/api/user-events')
        .map(([, config]) => (config as { params?: { windowStart?: string } } | undefined)?.params?.windowStart)
      expect(requestedStarts).toContain(nextWeekWindowStart)
    })
    expect(visibleDayIndexes()).toEqual(initial)
    expect(screen.getByRole('button', { name: 'Previous week' })).toBeInTheDocument()
  })

  it('crosses into the next week when the day window moves past Sunday', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // A Sunday: the 3-day window is Fri-Sun, so Next day shows Sat, Sun and the next Monday.
    vi.setSystemTime(new Date(2026, 2, 15, 12, 0, 0))
    try {
      renderPage({ dayZoomLevel: 3 })
      await screen.findByTestId('calendar-week-grid')
      expect(visibleDayIndexes()).toEqual([4, 5, 6])
      fireEvent.click(screen.getByRole('button', { name: 'Next day' }))
      await waitFor(() => expect(visibleDayIndexes()).toEqual([5, 6, 7]))
      fireEvent.click(screen.getByRole('button', { name: 'Next day' }))
      await waitFor(() => expect(visibleDayIndexes()).toEqual([6, 7, 8]))
      fireEvent.click(screen.getByRole('button', { name: 'Next day' }))
      await waitFor(() => expect(visibleDayIndexes()).toEqual([0, 1, 2]))
    } finally {
      vi.useRealTimers()
    }
  })

  it('animates quick buttons when their switch turns them on', async () => {
    renderPage({ showTimeZoomQuickButtons: false, isLeftPanelOpen: true, expandedSections: ['timeWidth'] })
    const toggle = await screen.findByRole('switch', { name: 'Toggle time zoom quick buttons in the calendar bar' })
    expect(screen.queryByTestId('time-zoom-quick-buttons')).not.toBeInTheDocument()
    fireEvent.click(toggle)
    expect(await screen.findByTestId('time-zoom-quick-buttons')).toHaveClass('tools-reveal-highlight')
  })

  it('shows the header scroll hint only while hovering days of an overflowing multi-week view', async () => {
    renderPage({ dayZoomLevel: 14 })
    await screen.findByTestId('calendar-week-grid')
    const scroller = screen.getByTestId('calendar-horizontal-scroll')
    const dayColumn = screen.getByTestId('calendar-day-column-3')
    const scrollArea = screen.getByTestId('calendar-day-scroll-area')

    // All 14 days fit: hovering shows no hint.
    fireEvent.mouseOver(dayColumn)
    expect(scroller).not.toHaveAttribute('data-day-scroll-hint')
    fireEvent.mouseLeave(scrollArea)

    Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: 2000 })
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 800 })
    fireEvent.scroll(scroller)
    expect(scroller).toHaveAttribute('data-can-scroll-left', 'false')
    expect(scroller).toHaveAttribute('data-can-scroll-right', 'true')
    expect(scroller.style.getPropertyValue('--tm-day-scroll-right')).toBe('1200px')

    fireEvent.mouseOver(dayColumn)
    expect(scroller).toHaveAttribute('data-day-scroll-hint', 'on')
    expect(screen.getByTestId('calendar-header-top').className).toContain('group-data-[day-scroll-hint=on]/day-scroll:from-primary-subtle')
    expect(screen.getByTestId('calendar-day-scroll-hint-left')).toBeInTheDocument()
    expect(screen.getByTestId('calendar-day-scroll-hint-right')).toBeInTheDocument()

    fireEvent.mouseLeave(scrollArea)
    expect(scroller).not.toHaveAttribute('data-day-scroll-hint')
  })
})
