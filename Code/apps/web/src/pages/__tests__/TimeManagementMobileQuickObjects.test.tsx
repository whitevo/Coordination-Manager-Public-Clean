import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { startOfWeek } from 'date-fns'
import { installDefaultApiMocks, installEditorDomPolyfills, mockDedupedGet, mockUseAuth } from './time-management-test-harness'
import { apiClient } from '../../lib/api-client'
import TimeManagementPage from '../TimeManagementPage'
import { MOBILE_NAVIGATION_PANEL_DISMISS_EVENT } from '../../hooks/use-mobile-navigation-panel-dismiss'

const templates = ['Standup', 'Lunch', 'Focus', 'Review'].map((name, index) => ({
  id: `template-${index}`, quickName: name, title: `${name} title`, notes: `${name} notes`,
  categoryIds: [], sourceItemId: '', createdAt: new Date().toISOString(), autoSaveEnabled: index === 3,
}))

describe('Time Management mobile Quick Objects', () => {
  const originalWidth = window.innerWidth

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, isTraveler: false })
    installDefaultApiMocks()
    installEditorDomPolyfills()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    localStorage.setItem('time-management-v1', JSON.stringify({ isLeftPanelOpen: false, expandedSections: [], showQuickTemplatesInMain: true }))
    const defaultGet = mockDedupedGet.getMockImplementation()
    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/time-management/modes') return { data: {
        activeModeId: 'mode-main',
        modes: [{ id: 'mode-main', name: 'Main', main_color: '#2563eb', slot_minutes: 30,
          sync_calendars: [], time_backgrounds: [], collapsed_background_ids: [],
          quick_templates: templates, show_quick_templates_in_main: true }],
      } }
      return defaultGet?.(url)
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
  })

  async function openPage() {
    render(<MemoryRouter><TimeManagementPage /></MemoryRouter>)
    await screen.findByRole('button', { name: 'Expand Quick Objects list' })
  }

  function tapGrid() {
    const column = screen.getByTestId('calendar-day-column-0')
    vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 1248, width: 100, height: 1248, toJSON: () => ({}),
    })
    for (const type of ['pointerdown', 'pointerup']) {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.assign(event, { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 20, clientY: 260 })
      fireEvent(type === 'pointerdown' ? column : window, event)
    }
  }

  async function openOccupiedGrid() {
    const week = startOfWeek(new Date(), { weekStartsOn: 1 })
    const start = new Date(Date.UTC(week.getFullYear(), week.getMonth(), week.getDate(), 2))
    const savedItem = {
      id: 'saved-item', title: 'Saved item', source_type: 'manual', source_id: 'mode-main',
      start_time: start.toISOString(), end_time: new Date(start.getTime() + 90 * 60000).toISOString(),
      category_ids: [], recurrence_rule: { type: 'none' },
    }
    const defaultGet = mockDedupedGet.getMockImplementation()
    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/user-events') return { data: { events: [savedItem] } }
      return defaultGet?.(url)
    })
    await openPage()
    await screen.findAllByText('Saved item')
    const column = screen.getByTestId('calendar-day-column-0')
    vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 1248, width: 100, height: 1248, toJSON: () => ({}),
    })
    const item = column.querySelector<HTMLElement>('[data-time-management-item="true"]')
    if (!item) throw new Error('Expected an existing time item in the calendar')
    vi.spyOn(item, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 104, top: 104, left: 0, right: 100, bottom: 182, width: 100, height: 78, toJSON: () => ({}),
    })
    return { item, savedItem, start }
  }

  function pointer(target: HTMLElement | Window, type: string, clientY: number) {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.assign(event, { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 20, clientY })
    fireEvent(target, event)
  }

  function chooseFocus() {
    fireEvent.click(screen.getByRole('button', { name: 'Expand Quick Objects list' }))
    fireEvent.click(screen.getByRole('button', { name: 'Focus' }))
  }

  it.each([104, 130, 181])('places a quick item over an existing card at grid position %s without editing or resizing it', async (clientY) => {
    const { item } = await openOccupiedGrid()
    chooseFocus()
    pointer(item, 'pointerdown', clientY)
    expect(screen.queryByTestId('full-editor-overlay')).not.toBeInTheDocument()
    pointer(window, 'pointerup', clientY)
    fireEvent.click(item, { clientX: 20, clientY })
    const editor = screen.getByTestId('full-editor-overlay')
    expect(within(editor).getByPlaceholderText('Type Title for Time Item')).toHaveValue('Focus')
    expect(editor).toHaveTextContent('Focus notes')
    expect(screen.getByTestId('selection-day-segment-0')).toHaveStyle({
      top: `${Math.floor(clientY / 26) * 26}px`, height: '26px',
    })
    expect(item).not.toHaveAttribute('data-selected', 'true')
    expect(apiClient.put).not.toHaveBeenCalledWith('/api/user-events/saved-item', expect.anything())
    expect(apiClient.post).not.toHaveBeenCalled()
  })

  it('saves a separate overlapping quick item and leaves the existing item untouched', async () => {
    const { item, savedItem, start } = await openOccupiedGrid()
    const startTime = new Date(start.getTime() + 30 * 60000).toISOString()
    const endTime = new Date(start.getTime() + 60 * 60000).toISOString()
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { event: {
      ...savedItem, id: 'new-quick-item', title: 'Focus', description: 'Focus notes',
      start_time: startTime, end_time: endTime,
    } } })
    chooseFocus()
    pointer(item, 'pointerdown', 130)
    pointer(window, 'pointerup', 130)
    fireEvent.click(within(screen.getByTestId('full-editor-overlay')).getByRole('button', { name: 'Save item' }))
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/user-events', expect.objectContaining({
      title: 'Focus', description: 'Focus notes', start_time: startTime, end_time: endTime, category_ids: [],
    })))
    await waitFor(() => {
      const cards = screen.getByTestId('calendar-day-column-0').querySelectorAll('[data-time-management-item="true"]')
      expect(cards).toHaveLength(2)
      expect([...cards].map((card) => card.getAttribute('title'))).toEqual(expect.arrayContaining([
        expect.stringContaining('Saved item'), expect.stringContaining('Focus'),
      ]))
    })
    expect(apiClient.put).not.toHaveBeenCalledWith('/api/user-events/saved-item', expect.anything())
    expect(apiClient.delete).not.toHaveBeenCalled()
  })

  it('holds and drags a quick-item range from an occupied position without opening the existing item context menu', async () => {
    const { item } = await openOccupiedGrid()
    chooseFocus()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    pointer(item, 'pointerdown', 130)
    act(() => { vi.advanceTimersByTime(500) })
    fireEvent.contextMenu(item)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    pointer(window, 'pointermove', 208)
    pointer(window, 'pointerup', 208)
    fireEvent.click(item)
    expect(screen.getByTestId('selection-day-segment-0')).toHaveStyle({ top: '130px', height: '104px' })
    expect(within(screen.getByTestId('full-editor-overlay')).getByPlaceholderText('Type Title for Time Item')).toHaveValue('Focus')
    expect(apiClient.put).not.toHaveBeenCalledWith('/api/user-events/saved-item', expect.anything())
  })

  it('keeps an immediate swipe over an occupied position as native scrolling while a quick item awaits time', async () => {
    const { item } = await openOccupiedGrid()
    chooseFocus()
    pointer(item, 'pointerdown', 130)
    pointer(window, 'pointermove', 170)
    const touchMove = new Event('touchmove', { bubbles: true, cancelable: true })
    document.dispatchEvent(touchMove)
    expect(touchMove.defaultPrevented).toBe(false)
    pointer(window, 'pointerup', 170)
    fireEvent.click(item)
    expect(screen.queryByTestId('full-editor-overlay')).not.toBeInTheDocument()
    expect(screen.getByText('Focus ready -- tap a start time or hold and drag to select a range.')).toBeVisible()
    expect(apiClient.put).not.toHaveBeenCalledWith('/api/user-events/saved-item', expect.anything())
  })

  it('still opens an existing item normally when no quick item awaits placement', async () => {
    const { item } = await openOccupiedGrid()
    pointer(item, 'pointerdown', 130)
    pointer(window, 'pointerup', 130)
    fireEvent.click(item)
    expect(within(screen.getByTestId('full-editor-overlay')).getByPlaceholderText('Type Title for Time Item')).toHaveValue('Saved item')
  })

  it('expands and collapses remaining shortcuts inline without opening Tools', async () => {
    await openPage()
    fireEvent.click(screen.getByRole('button', { name: 'Expand Quick Objects list' }))
    expect(screen.getByRole('button', { name: 'Focus' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Review' })).toBeVisible()
    expect(screen.getByTestId('time-management-left-panel')).toHaveAttribute('data-open', 'false')
    expect(screen.getByRole('button', { name: 'Collapse Quick Objects list' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Quick Objects list' }))
    expect(screen.queryByRole('button', { name: 'Focus' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Tools' }))
    expect(screen.getByTestId('time-management-left-panel')).toHaveAttribute('data-open', 'true')
  })

  it('constrains the mobile panel to the visible viewport with an independently scrollable options area', async () => {
    await openPage()
    fireEvent.click(screen.getByRole('button', { name: 'Tools' }))
    const panel = screen.getByTestId('time-management-left-panel')
    const scrollArea = screen.getByTestId('time-management-tools-scroll')
    expect(panel).toHaveClass('h-dvh', 'overflow-hidden')
    expect(scrollArea.parentElement).toHaveClass('min-h-0', 'h-full', 'overflow-hidden')
    expect(scrollArea.previousElementSibling).toHaveClass('shrink-0')
    expect(scrollArea).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto', 'overscroll-contain')
  })

  it.each(['Focus', 'Review'])('loads %s without covering the grid, then carries its draft into the selection editor', async (name) => {
    await openPage()
    fireEvent.click(screen.getByRole('button', { name: 'Expand Quick Objects list' }))
    fireEvent.click(screen.getByRole('button', { name }))
    expect(screen.getByText(`${name} ready -- tap a start time or hold and drag to select a range.`)).toBeVisible()
    expect(screen.getByTestId('time-management-left-panel')).toHaveAttribute('data-open', 'false')
    expect(screen.queryByTestId('full-editor-overlay')).not.toBeInTheDocument()
    expect(apiClient.post).not.toHaveBeenCalled()
    tapGrid()
    const editor = screen.getByTestId('full-editor-overlay')
    expect(within(editor).getByPlaceholderText('Type Title for Time Item')).toHaveValue(name)
    expect(editor).toHaveTextContent(`${name} notes`)
    expect(screen.queryByText(`${name} ready -- tap a start time or hold and drag to select a range.`)).not.toBeInTheDocument()
  })

  it('returns from Quick Objects Tools to the calendar when an applied template needs time', async () => {
    await openPage()
    fireEvent.click(screen.getByRole('button', { name: 'Tools' }))
    const panel = screen.getByTestId('time-management-left-panel')
    fireEvent.click(within(panel).getByRole('button', { name: 'Focus' }))
    expect(panel).toHaveAttribute('data-open', 'false')
    expect(screen.queryByTestId('full-editor-overlay')).not.toBeInTheDocument()
    expect(screen.getByText('Focus ready -- tap a start time or hold and drag to select a range.')).toBeVisible()
    tapGrid()
    expect(within(screen.getByTestId('full-editor-overlay')).getByPlaceholderText('Type Title for Time Item')).toHaveValue('Focus')
  })

  it('closes mobile Tools on header navigation while preserving its template draft for reopening', async () => {
    await openPage()
    fireEvent.click(screen.getByRole('button', { name: 'Tools' }))
    const panel = screen.getByTestId('time-management-left-panel')
    expect(panel).toHaveAttribute('data-open', 'true')
    act(() => window.dispatchEvent(new Event(MOBILE_NAVIGATION_PANEL_DISMISS_EVENT)))
    expect(panel).toHaveAttribute('data-open', 'false')
    expect(screen.queryByTestId('full-editor-overlay')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Tools' }))
    expect(panel).toHaveAttribute('data-open', 'true')
    expect(within(panel).getByRole('button', { name: 'Focus' })).toBeVisible()
    expect(apiClient.post).not.toHaveBeenCalled()
  })
})
