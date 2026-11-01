import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import {
  installDefaultApiMocks,
  installEditorDomPolyfills,
  mockDedupedGet,
  mockUseAuth,
  mockUseTimezones,
} from './time-management-test-harness'
import { apiClient } from '../../lib/api-client'
import TimeManagementPage from '../TimeManagementPage'

describe('Time Management timezone transitions', () => {
  const originalWidth = window.innerWidth

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    installDefaultApiMocks()
    installEditorDomPolyfills()
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, isTraveler: false })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1400 })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 21, 12))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
  })

  function setTimezones(primary: string, additional: string[] = []) {
    mockUseTimezones.mockReturnValue({
      ...mockUseTimezones(),
      primary,
      additional,
      all: [primary, ...additional],
    })
  }

  async function openPage() {
    render(<MemoryRouter><TimeManagementPage /></MemoryRouter>)
    await screen.findByText('No meetings found on the selected calendars.')
  }

  function transitionRow(iana: string, minute: number) {
    const row = screen.getByTestId(`calendar-dst-column-${iana}`).querySelector(`[data-utc-minute="${minute}"]`)
    expect(row).not.toBeNull()
    return row!
  }

  it.each([
    { date: new Date(2026, 2, 25, 12), offset: '+2 to +3', minute: 60, label: '04:00' },
    { date: new Date(2026, 9, 21, 12), offset: '+3 to +2', minute: 60, label: '03:00' },
  ])('shows date-aware changed and unchanged rows for GMT $offset', async ({ date, offset, minute, label }) => {
    vi.setSystemTime(date)
    setTimezones('Europe/Tallinn')
    await openPage()
    const header = screen.getByTestId('calendar-dst-header-top-Europe/Tallinn')
    expect(header).toHaveClass('bg-warning-subtle', 'text-warning')
    expect(header).toHaveTextContent(offset)
    expect(header).toHaveAccessibleName(/clock change on Sun/)
    expect(transitionRow('Europe/Tallinn', minute)).toHaveTextContent(label)
    expect(transitionRow('Europe/Tallinn', minute)).toHaveAttribute('data-dst-changed', 'true')
    expect(transitionRow('Europe/Tallinn', minute)).toHaveClass('bg-warning-subtle')
    expect(transitionRow('Europe/Tallinn', 0)).toHaveAttribute('data-dst-changed', 'false')
    const column = screen.getByTestId('calendar-dst-column-Europe/Tallinn')
    expect(column).not.toHaveAttribute('data-time-management-drop-zone')
    expect(column.nextElementSibling).toHaveAttribute('data-testid', 'calendar-day-column-6')
    fireEvent.mouseDown(column, { button: 0, clientY: 200 })
    expect(screen.queryByTestId('selection-day-segment-6')).not.toBeInTheDocument()
    expect(apiClient.post).not.toHaveBeenCalled()
    expect(apiClient.put).not.toHaveBeenCalled()
  })

  it('handles negative offsets and US transitions on a different week from Europe', async () => {
    vi.setSystemTime(new Date(2026, 9, 28, 12))
    setTimezones('America/New_York', ['Europe/Tallinn'])
    await openPage()
    expect(screen.getByTestId('calendar-dst-header-top-America/New_York')).toHaveTextContent('-4 to -5')
    expect(screen.queryByTestId('calendar-dst-header-top-Europe/Tallinn')).not.toBeInTheDocument()
    expect(transitionRow('America/New_York', 360)).toHaveTextContent('01:00')
    expect(transitionRow('America/New_York', 360)).toHaveAttribute('data-dst-changed', 'true')
  })

  it('aligns multiple transition columns with both headers and every repeated grid', async () => {
    setTimezones('UTC', ['Europe/Tallinn', 'Europe/London'])
    await openPage()
    const grid = screen.getByTestId('calendar-week-grid')
    const top = screen.getByTestId('calendar-header-top')
    const bottom = screen.getByTestId('calendar-header-bottom')
    expect(grid.style.gridTemplateColumns).toBe(top.style.gridTemplateColumns)
    expect(bottom.style.gridTemplateColumns).toBe(top.style.gridTemplateColumns)
    expect(grid.children).toHaveLength(13)
    expect(top.children).toHaveLength(12)
    expect(bottom.children).toHaveLength(12)
    expect(document.querySelectorAll('[aria-label^="Europe/Tallinn clock change"]')).toHaveLength(5)
    expect(document.querySelectorAll('[aria-label^="Europe/London clock change"]')).toHaveLength(5)
    const tallinn = screen.getByTestId('calendar-dst-column-Europe/Tallinn')
    const london = screen.getByTestId('calendar-dst-column-Europe/London')
    expect(tallinn.nextElementSibling).toBe(london)
    expect(london.nextElementSibling).toBe(screen.getByTestId('calendar-day-column-6'))
    expect(screen.getAllByTestId('current-time-indicator')[0]).toHaveStyle({ left: '162px' })
    expect(tallinn).toHaveStyle({ height: '1248px' })
  })

  it.each([
    { date: new Date(2026, 0, 21, 12), expectedTime: '12:00', abbreviation: 'GMT+2' },
    { date: new Date(2026, 6, 22, 12), expectedTime: '13:00', abbreviation: 'GMT+3' },
  ])('uses the viewed season for the ordinary time axis: $expectedTime', async ({ date, expectedTime, abbreviation }) => {
    vi.setSystemTime(date)
    setTimezones('Europe/Tallinn')
    await openPage()
    expect(screen.queryByTestId('calendar-dst-column-Europe/Tallinn')).not.toBeInTheDocument()
    const labels = within(screen.getByTestId('calendar-timezone-column-Europe/Tallinn')).getAllByText(expectedTime)
    expect(labels).toHaveLength(1)
    expect(labels[0].parentElement).toHaveStyle({ top: '520px' })
    expect(screen.getByTestId('calendar-header-top')).toHaveTextContent(abbreviation)
  })

  it('adds and removes transition columns when navigating weeks', async () => {
    vi.setSystemTime(new Date(2026, 9, 14, 12))
    setTimezones('UTC', ['Europe/Tallinn'])
    await openPage()
    expect(screen.queryByTestId('calendar-dst-column-Europe/Tallinn')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(screen.getByTestId('calendar-dst-column-Europe/Tallinn')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(screen.queryByTestId('calendar-dst-column-Europe/Tallinn')).not.toBeInTheDocument()
    const label = within(screen.getByTestId('calendar-timezone-column-Europe/Tallinn')).getByText('12:00')
    expect(label.parentElement).toHaveStyle({ top: '520px' })
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    expect(screen.getByTestId('calendar-dst-column-Europe/Tallinn')).toBeInTheDocument()
  })

  it('does not add transition columns for UTC-only weeks', async () => {
    await openPage()
    expect(screen.queryAllByTestId(/^calendar-dst-column-/)).toHaveLength(0)
    expect(screen.getByTestId('calendar-header-top').children).toHaveLength(8)
    expect(screen.getByTestId('calendar-horizontal-scroll').firstElementChild).not.toHaveAttribute('style')
  })

  it.each([360, 390, 430, 740, 900])('keeps transition grids wide enough for horizontal scrolling at width %s', async (width) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    setTimezones('UTC', ['Europe/Tallinn', 'Europe/London'])
    await openPage()
    const horizontal = screen.getByTestId('calendar-horizontal-scroll')
    expect(horizontal).toHaveClass('overflow-x-auto')
    expect(horizontal.firstElementChild).toHaveStyle({ minWidth: '550px' })
    expect(screen.getByTestId('calendar-header-top').parentElement).toBe(horizontal.firstElementChild)
    expect(screen.getByTestId('calendar-scroll-container').parentElement).toBe(horizontal.firstElementChild)
  })

  it('keeps selection and saves on the correct day after the inserted transition columns', async () => {
    setTimezones('Europe/Tallinn')
    await openPage()
    const column = screen.getByTestId('calendar-day-column-6')
    vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({
      x: 600, y: 0, top: 0, left: 600, right: 700, bottom: 1440, width: 100, height: 1440, toJSON: () => ({}),
    })
    fireEvent.mouseDown(column, { button: 0, clientX: 650, clientY: 600 })
    fireEvent.pointerUp(window)
    expect(screen.getByPlaceholderText('Type Title for Time Item')).toHaveValue('')
    fireEvent.change(screen.getByPlaceholderText('Type Title for Time Item'), { target: { value: 'After clock change' } })
    vi.mocked(apiClient.post).mockImplementation(async (_url, payload: unknown) => {
      if (!payload || typeof payload !== 'object') throw new Error('Expected an event payload')
      return { data: { event: { ...payload, id: 'dst-created', source_type: 'manual', source_id: 'mode-main' } } }
    })
    await act(async () => { fireEvent.click(screen.getByTestId('left-sidebar-save-button')) })
    expect(apiClient.post).toHaveBeenCalledWith('/api/user-events', expect.objectContaining({
      title: 'After clock change', start_time: '2026-10-25T10:00:00.000Z', end_time: '2026-10-25T10:30:00.000Z',
    }))
    expect(screen.getAllByText('After clock change').length).toBeGreaterThan(0)
  })

  it('formats saved item and editor labels using the occurrence date rather than the current offset', async () => {
    setTimezones('Europe/Tallinn')
    const defaultGet = mockDedupedGet.getMockImplementation()
    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/user-events') return { data: { events: [{
        id: 'dst-item', title: 'Sunday event', description: '', location: null, meeting_link: null,
        start_time: '2026-10-25T10:00:00.000Z', end_time: '2026-10-25T11:30:00.000Z',
        source_type: 'manual', source_id: 'mode-main', category_ids: [], recurrence_rule: { type: 'none' },
      }] } }
      return defaultGet?.(url)
    })
    render(<MemoryRouter><TimeManagementPage /></MemoryRouter>)
    const title = (await screen.findAllByText('Sunday event'))[0]
    await act(async () => { fireEvent.click(title) })
    expect(screen.getAllByTestId('time-item-selection-duration')[0]).toHaveTextContent('12:00-13:30')
    fireEvent.click(screen.getByTitle('Open full view editor'))
    expect(within(screen.getByTestId('full-editor-overlay')).getByText(/12:00/)).toBeInTheDocument()
  })
})
