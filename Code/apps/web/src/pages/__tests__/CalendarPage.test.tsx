import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import CalendarPage from '../CalendarPage'
import { apiClient, dedupedGet } from '../../lib/api-client'
import { getCalendarBusyColors } from '../../lib/calendar-busy-overlay'
import { MOBILE_NAVIGATION_PANEL_DISMISS_EVENT } from '../../hooks/use-mobile-navigation-panel-dismiss'

const mockUseAuth = vi.fn()
const mockUseTheme = vi.fn()
const mockUseLearnerMode = vi.fn()
const mockSetPageContext = vi.fn()
const mockShowToast = vi.fn()
const mockSetPrimaryTimezone = vi.fn()
const mockAdditionalTimezones: string[] = []
let mockPrimaryTimezone = 'UTC'

vi.mock('../../lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  dedupedGet: vi.fn(),
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => mockUseTheme(),
}))

vi.mock('../../contexts/LearnerModeContext', () => ({
  useLearnerMode: () => mockUseLearnerMode(),
}))

vi.mock('../../contexts/AiAssistantContext', () => ({
  useAiAssistant: () => ({
    setPageContext: mockSetPageContext,
  }),
}))

vi.mock('../../contexts/LayoutContext', () => ({
  LeftPanelPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
  RightPanelPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('../../components/Toast', () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
}))

vi.mock('../../components/TimezoneSelector', () => ({
  default: ({ timezones }: { timezones: { setPrimary: (timezone: string) => void } }) => (
    <button type="button" onClick={() => timezones.setPrimary('America/New_York')}>
      Change primary timezone
    </button>
  ),
}))

vi.mock('../../components/DualThumbSlider', () => ({
  default: ({ onStartChange, onStartRelease }: {
    onStartChange: (value: number) => void
    onStartRelease: () => void
  }) => <div data-testid="dual-thumb-slider">
    <button onClick={() => onStartChange(10)}>Preview start hour</button>
    <button onClick={onStartRelease}>Release start hour</button>
  </div>,
}))

vi.mock('../../components/LearnerHelpIcon', () => ({
  default: () => null,
}))

vi.mock('../../components/ImportAvailabilityModal', () => ({
  default: () => null,
}))

vi.mock('../../components/MeetingSidePanel', () => ({
  default: ({ isOpen, cellId, duration, onCancel }: { isOpen: boolean; cellId: string | null; duration: number; onCancel: () => void }) => (
    <div data-testid="meeting-side-panel" data-open={String(isOpen)} data-cell-id={cellId || ''} data-duration={duration}>
      {isOpen && <button onClick={onCancel}>Cancel meeting editor</button>}
    </div>
  ),
}))

vi.mock('../../lib/use-timezones', () => ({
  useTimezones: () => ({
    primary: mockPrimaryTimezone,
    additional: mockAdditionalTimezones,
    all: [mockPrimaryTimezone, ...mockAdditionalTimezones],
    setPrimary: mockSetPrimaryTimezone,
    addTimezone: vi.fn(),
    removeTimezone: vi.fn(),
    replaceTimezone: vi.fn(),
    canAddMore: false,
    getEntry: vi.fn(),
  }),
}))

vi.mock('../../lib/timezone-data', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/timezone-data')>(),
  convertUtcTimeToTimezone: (value: string) => value,
  getCurrentTimeInTimezone: () => '12:00',
  formatUtcTimeWithPeriodInTimezone: (value: string) => value,
  formatUtcTime24InTimezone: (value: string) => value,
}))

vi.mock('../../lib/calendar-utils', () => ({
  isSafeUrl: () => true,
  resolveMeetingTitle: ({ title, calendarTitle }: { title?: string; calendarTitle?: string }) => {
    const trimmedTitle = (title || '').trim()
    if (trimmedTitle.length > 0) return trimmedTitle
    return (calendarTitle || 'Meeting').trim() || 'Meeting'
  },
}))

function mockCalendarResponse(options?: {
  timeInterval?: 15 | 30 | 60
  hideDateNumbers?: boolean
  archived?: boolean
  customStartDate?: string
  customEndDate?: string
  busyDays?: string[]
  googleSource?: boolean
  availability?: Array<{
    username: string
    time_slots: string[]
  }>
  meetings?: Array<{
    id: string
    time_slots: string[]
    meeting_link?: string
    description?: string
    duration_minutes: number
    title: string
    recurrence_rule?: { type: 'weekly'; weekDays: number[]; endType: 'never' } | null
  }>
}) {
  const availability = options?.availability ?? []
  const meetings = options?.meetings ?? []
  const handleGet = async (url: string) => {
    if (url === '/api/availability/user/past?exclude_hash=test-hash') {
      return { data: { entries: [] } }
    }

    if (url === '/api/calendars/test-hash') {
      return {
        data: {
          title: 'Team Calendar',
          visibility: 'unlisted',
          created_by: 'owner@example.com',
          creator_display_name: 'Owner',
          is_owner: true,
          has_edit_permission: true,
          permissions: { canEdit: [] },
          config: {
            eventName: 'Team Calendar',
            timeInterval: options?.timeInterval ?? 30,
            hideDateNumbers: options?.hideDateNumbers ?? false,
            ...(options?.archived ? { archived: true } : {}),
            customStartDate: options?.customStartDate ?? '2026-06-08',
            customEndDate: options?.customEndDate ?? '2026-06-14',
          },
        },
      }
    }

    if (url === '/api/calendar-subscriptions/check/test-hash') {
      return { data: { subscribed: false } }
    }

    if (url === '/api/availability/test-hash') {
      return { data: availability }
    }

    if (url === '/api/meetings/test-hash') {
      return { data: meetings }
    }

    if (url === '/api/calendar-sources') {
      return { data: { sources: options?.googleSource ? [{
        id: 'google-1',
        source_type: 'google_oauth',
        google_email: 'user@example.com',
        public_url: null,
        display_name: 'Google Work',
        color: '#0EA5E9',
        is_active: true,
      }] : [] } }
    }

    if (url === '/api/time-management/modes') {
      return {
        data: {
          activeModeId: 'mode-1',
          modes: [
            {
              id: 'mode-1',
              name: 'Focus',
              main_color: '#0EA5E9',
              slot_minutes: 30,
              sync_calendars: [],
              time_backgrounds: [],
              collapsed_background_ids: [],
              quick_templates: [],
              show_quick_templates_in_main: false,
            },
          ],
        },
      }
    }

    if (url === '/api/time-management/categories') {
      return { data: { categories: [] } }
    }

    if (url === '/api/user-events') {
      return {
        data: {
          events: (options?.busyDays ?? ['2026-06-10']).map((day, index) => (
            {
              id: `event-${index + 1}`,
              source_type: 'manual',
              source_id: 'mode-1',
              title: 'Secret Swarm planning session',
              start_time: `${day}T10:00:00Z`,
              end_time: `${day}T11:00:00Z`,
              recurrence_rule: null,
            }
          )),
        },
      }
    }

    throw new Error(`Unexpected GET ${url}`)
  }

  vi.mocked(apiClient.get).mockImplementation(handleGet)
  vi.mocked(dedupedGet).mockImplementation(handleGet as typeof dedupedGet)

  vi.mocked(apiClient.post).mockImplementation(async (url: string) => {
    if (url === '/api/calendar-sources/busy' && options?.googleSource) {
      return { data: { busyBlocks: [{
        start: '2026-06-10T10:00:00Z',
        end: '2026-06-10T11:00:00Z',
        summary: 'Google work session',
        color: '#0EA5E9',
      }], sourceErrors: [] } }
    }
    throw new Error(`Unexpected POST ${url}`)
  })
}

function renderCalendarPage(query = '') {
  return render(
    <MemoryRouter initialEntries={[`/calendar/test-hash${query}`]}>
      <Routes>
        <Route path="/calendar/:hash" element={<CalendarPage />} />
      </Routes>
    </MemoryRouter>
  )
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function openCalendarSyncsPanel(): Promise<void> {
  const buttons = screen.getAllByRole('button', { name: 'Calendar Syncs' })
  for (const button of buttons) {
    fireEvent.click(button)
    await flushMicrotasks()
    if (screen.queryByText('Google Calendar')) {
      return
    }
  }
}

describe('CalendarPage Secret Swarm syncs', () => {
  beforeEach(() => {
    const updateProfile = vi.fn().mockResolvedValue(undefined)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-10T12:00:00Z'))
    Object.defineProperty(navigator, 'maxTouchPoints', {
      configurable: true,
      value: 1,
    })
    localStorage.clear()
    mockAdditionalTimezones.length = 0
    mockPrimaryTimezone = 'UTC'
    mockUseTheme.mockReturnValue({ isDark: true, activeThemeId: null })
    mockUseAuth.mockReturnValue({
      user: { id: 'user-1', email: 'user@example.com', timezone: 'UTC' },
      isAuthenticated: true,
      isTraveler: false,
      isCardano: false,
      updateProfile,
    })
    mockUseLearnerMode.mockReturnValue({ learnerMode: false })
    mockCalendarResponse()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('shows dated current and next-week timezone changes on Any Week load, mode switch, and reload', async () => {
    vi.setSystemTime(new Date('2026-10-20T12:00:00Z'))
    mockAdditionalTimezones.push('Europe/Tallinn', 'America/New_York')
    mockCalendarResponse({
      hideDateNumbers: true,
      customStartDate: '2026-06-08',
      customEndDate: '2026-06-14',
      meetings: [{
        id: 'next-week-meeting',
        title: 'Next week meeting',
        time_slots: ['2026-10-28_11:00'],
        duration_minutes: 30,
      }],
    })

    const view = renderCalendarPage()
    await flushMicrotasks()
    await flushMicrotasks()

    const expectTransitions = () => {
      expect(screen.getByText('25 Oct 2026')).toBeInTheDocument()
      expect(screen.getByText('1 Nov 2026')).toBeInTheDocument()
      expect(screen.getByText('This week')).toBeInTheDocument()
      expect(screen.getByText('Next week')).toBeInTheDocument()
      expect(screen.getByText('+3 to +2')).toBeInTheDocument()
      expect(screen.getByText('-4 to -5')).toBeInTheDocument()
      const tallinnColumn = screen.getByText('+3 to +2').parentElement
      const newYorkColumn = screen.getByText('-4 to -5').parentElement
      expect(tallinnColumn?.nextElementSibling).toBe(newYorkColumn)
      expect(newYorkColumn?.nextElementSibling).toHaveTextContent('Sun')
      const timeRow = document.querySelector('[data-cell-id$="_12:00"]')?.parentElement
      expect(timeRow?.children[0]).toHaveTextContent('15:00')
      expect(timeRow?.children[1]).toHaveTextContent('08:00')
      expect(timeRow?.children[9]).toHaveTextContent('14:00')
      expect(timeRow?.children[10]).toHaveTextContent('07:00')
    }
    expectTransitions()

    fireEvent.click(screen.getByRole('button', { name: 'Edit Calendar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dates' }))
    await flushMicrotasks()
    fireEvent.click(screen.getByRole('button', { name: 'Any Week' }))
    await flushMicrotasks()
    expectTransitions()
    expect(apiClient.patch).not.toHaveBeenCalled()

    view.unmount()
    renderCalendarPage()
    await flushMicrotasks()
    await flushMicrotasks()
    expectTransitions()
  })

  it.each([
    { now: '2026-10-13', expected: ['25 Oct 2026'], absent: ['1 Nov 2026'], label: 'Next week' },
    { now: '2026-10-27', expected: ['1 Nov 2026'], absent: ['25 Oct 2026'], label: 'This week' },
    { now: '2026-11-03', expected: [], absent: ['25 Oct 2026', '1 Nov 2026'], label: null },
  ])('limits Any Week changes to this week and next on $now', async ({ now, expected, absent, label }) => {
    vi.setSystemTime(new Date(`${now}T12:00:00Z`))
    mockAdditionalTimezones.push('Europe/Tallinn', 'America/New_York', 'Asia/Kolkata')
    mockCalendarResponse({ hideDateNumbers: true })

    renderCalendarPage()
    await flushMicrotasks()
    await flushMicrotasks()

    for (const date of expected) expect(screen.getByText(date)).toBeInTheDocument()
    for (const date of absent) expect(screen.queryByText(date)).not.toBeInTheDocument()
    if (label) {
      expect(screen.getByText(label)).toBeInTheDocument()
    } else {
      expect(screen.queryByText('This week')).not.toBeInTheDocument()
      expect(screen.queryByText('Next week')).not.toBeInTheDocument()
    }
    expect(screen.queryByText('+5.5 to +5.5')).not.toBeInTheDocument()
  })

  it('keeps dated calendars limited to their displayed week', async () => {
    vi.setSystemTime(new Date('2026-10-20T12:00:00Z'))
    mockAdditionalTimezones.push('Europe/Tallinn', 'America/New_York')
    mockCalendarResponse({
      customStartDate: '2026-10-19',
      customEndDate: '2026-11-01',
    })

    renderCalendarPage()
    await flushMicrotasks()
    await flushMicrotasks()

    expect(screen.getByText('+3 to +2')).toBeInTheDocument()
    expect(screen.queryByText('-4 to -5')).not.toBeInTheDocument()
    expect(screen.queryByText('Next week')).not.toBeInTheDocument()
  })

  it('shows a primary timezone change without requiring comparison timezones', async () => {
    vi.setSystemTime(new Date('2026-10-20T12:00:00Z'))
    mockPrimaryTimezone = 'America/New_York'
    mockCalendarResponse({ hideDateNumbers: true })

    renderCalendarPage()
    await flushMicrotasks()
    await flushMicrotasks()

    expect(screen.getByText('1 Nov 2026')).toBeInTheDocument()
    expect(screen.getByText('-4 to -5')).toBeInTheDocument()
    const timeRow = document.querySelector('[data-cell-id$="_12:00"]')?.parentElement
    expect(timeRow?.children[0]).toHaveTextContent('08:00')
    expect(timeRow?.children[7]).toHaveTextContent('07:00')
  })

  it('places spring transitions on their own weekdays', async () => {
    vi.setSystemTime(new Date('2026-03-17T12:00:00Z'))
    mockAdditionalTimezones.push('Asia/Jerusalem', 'Europe/Tallinn')
    mockCalendarResponse({ hideDateNumbers: true })

    renderCalendarPage()
    await flushMicrotasks()
    await flushMicrotasks()

    const fridayTransition = screen.getByText('27 Mar 2026').parentElement
    const sundayTransition = screen.getByText('29 Mar 2026').parentElement
    expect(fridayTransition).toHaveTextContent('+2 to +3')
    expect(fridayTransition?.nextElementSibling).toHaveTextContent('Fri')
    expect(sundayTransition).toHaveTextContent('+2 to +3')
    expect(sundayTransition?.nextElementSibling).toHaveTextContent('Sun')
    expect(screen.getAllByText('Next week')).toHaveLength(2)
  })

  it.each([
    { timeInterval: 15, nextTime: '11:15', hideDateNumbers: false },
    { timeInterval: 30, nextTime: '11:30', hideDateNumbers: false },
    { timeInterval: 60, nextTime: '12:00', hideDateNumbers: false },
    { timeInterval: 15, nextTime: '11:15', hideDateNumbers: true },
    { timeInterval: 30, nextTime: '11:30', hideDateNumbers: true },
    { timeInterval: 60, nextTime: '12:00', hideDateNumbers: true },
  ] as const)('saves and reloads exactly one $timeInterval-minute slot (weekly=$hideDateNumbers)', async (config) => {
    mockCalendarResponse(config)
    vi.mocked(apiClient.post).mockResolvedValue({ data: { success: true } })
    const view = renderCalendarPage()
    await flushMicrotasks()
    await flushMicrotasks()

    const cellId = '2026-06-10_11:00'
    const nextCellId = `2026-06-10_${config.nextTime}`
    const cell = document.querySelector(`[data-cell-id="${cellId}"]`)
    const nextCell = document.querySelector(`[data-cell-id="${nextCellId}"]`)
    if (!cell || !nextCell) throw new Error('Expected adjacent selectable calendar slots')
    fireEvent.change(screen.getByPlaceholderText('Enter your name...'), { target: { value: 'Alex' } })
    fireEvent.pointerDown(cell, { pointerType: 'mouse', button: 0 })
    fireEvent.pointerUp(cell, { pointerType: 'mouse', button: 0 })
    expect(cell).toHaveClass('bg-purple-300')
    expect(nextCell).not.toHaveClass('bg-purple-300')
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await flushMicrotasks()
    expect(apiClient.post).toHaveBeenCalledWith('/api/availability', {
      calendar_hash: 'test-hash', username: 'Alex', time_slots: [cellId], mode: 'add',
    })
    expect(cell).toHaveClass('bg-green-200')
    expect(nextCell).not.toHaveClass('bg-green-200')

    view.unmount()
    const savedCellId = config.hideDateNumbers ? '2026-06-03_11:00' : cellId
    mockCalendarResponse({ ...config, availability: [{ username: 'Alex', time_slots: [savedCellId] }] })
    vi.mocked(apiClient.post).mockResolvedValue({ data: { success: true } })
    renderCalendarPage()
    await flushMicrotasks()
    await flushMicrotasks()
    const reloadedCell = document.querySelector(`[data-cell-id="${cellId}"]`)
    const reloadedNextCell = document.querySelector(`[data-cell-id="${nextCellId}"]`)
    expect(reloadedCell).toHaveClass('bg-green-200')
    expect(reloadedNextCell).not.toHaveClass('bg-green-200')
    if (!reloadedCell || !reloadedNextCell) throw new Error('Expected reloaded calendar slots')

    fireEvent.change(screen.getByPlaceholderText('Enter your name...'), { target: { value: 'Alex' } })
    fireEvent.pointerDown(reloadedNextCell, { pointerType: 'mouse', button: 0 })
    fireEvent.pointerUp(reloadedNextCell, { pointerType: 'mouse', button: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await flushMicrotasks()
    expect(apiClient.post).toHaveBeenLastCalledWith('/api/availability', {
      calendar_hash: 'test-hash', username: 'Alex', time_slots: [], mode: 'remove',
    })
    expect(reloadedCell).toHaveClass('bg-green-200')

    fireEvent.pointerDown(reloadedCell, { pointerType: 'mouse', button: 0 })
    fireEvent.pointerUp(reloadedCell, { pointerType: 'mouse', button: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await flushMicrotasks()
    expect(apiClient.post).toHaveBeenLastCalledWith('/api/availability', {
      calendar_hash: 'test-hash', username: 'Alex', time_slots: [savedCellId], mode: 'remove',
    })
    expect(reloadedCell).not.toHaveClass('bg-green-200')
  })

  it.each([false, true])('removes one saved half-hour without removing its saved neighbor (weekly=%s)', async (hideDateNumbers) => {
    const savedDate = hideDateNumbers ? '2026-06-03' : '2026-06-10'
    mockCalendarResponse({
      hideDateNumbers,
      availability: [{ username: 'Alex', time_slots: [`${savedDate}_11:00`, `${savedDate}_11:30`] }],
    })
    vi.mocked(apiClient.post).mockResolvedValue({ data: { success: true } })
    renderCalendarPage()
    await flushMicrotasks()
    await flushMicrotasks()
    const first = document.querySelector('[data-cell-id="2026-06-10_11:00"]')
    const second = document.querySelector('[data-cell-id="2026-06-10_11:30"]')
    if (!first || !second) throw new Error('Expected adjacent half-hour slots')
    fireEvent.change(screen.getByPlaceholderText('Enter your name...'), { target: { value: 'Alex' } })
    fireEvent.pointerDown(second, { pointerType: 'mouse', button: 0 })
    fireEvent.pointerUp(second, { pointerType: 'mouse', button: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await flushMicrotasks()
    expect(apiClient.post).toHaveBeenCalledWith('/api/availability', {
      calendar_hash: 'test-hash', username: 'Alex', time_slots: [`${savedDate}_11:30`], mode: 'remove',
    })
    expect(first).toHaveClass('bg-green-200')
    expect(second).not.toHaveClass('bg-green-200')
  })

  it.each([false, true])('saves exactly one half-hour after a quick touch tap (weekly=%s)', async (hideDateNumbers) => {
    mockCalendarResponse({ hideDateNumbers })
    vi.mocked(apiClient.post).mockResolvedValue({ data: { success: true } })
    renderCalendarPage()
    await flushMicrotasks()
    await flushMicrotasks()
    const first = document.querySelector('[data-cell-id="2026-06-10_11:00"]')
    const second = document.querySelector('[data-cell-id="2026-06-10_11:30"]')
    if (!first || !second) throw new Error('Expected adjacent half-hour slots')
    fireEvent.change(screen.getByPlaceholderText('Enter your name...'), { target: { value: 'Alex' } })
    for (const type of ['pointerdown', 'pointerup']) {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.assign(event, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 })
      fireEvent(first, event)
    }
    expect(first).toHaveClass('bg-purple-300')
    expect(second).not.toHaveClass('bg-purple-300')
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await flushMicrotasks()
    expect(apiClient.post).toHaveBeenCalledWith('/api/availability', {
      calendar_hash: 'test-hash', username: 'Alex', time_slots: ['2026-06-10_11:00'], mode: 'add',
    })
    expect(first).toHaveClass('bg-green-200')
    expect(second).not.toHaveClass('bg-green-200')
  })

  it.each([
    { timeInterval: 15, nextTime: '11:15' },
    { timeInterval: 30, nextTime: '11:30' },
    { timeInterval: 60, nextTime: '12:00' },
  ] as const)('drags across two $timeInterval-minute slots and creates a meeting of exactly two intervals', async (config) => {
    mockCalendarResponse(config)
    renderCalendarPage()
    await flushMicrotasks()
    await flushMicrotasks()
    const first = document.querySelector('[data-cell-id="2026-06-10_11:00"]')
    const second = document.querySelector(`[data-cell-id="2026-06-10_${config.nextTime}"]`)
    if (!first || !second) throw new Error('Expected adjacent calendar slots')
    fireEvent.pointerDown(first, { pointerType: 'mouse', button: 0 })
    fireEvent.pointerEnter(second, { pointerType: 'mouse' })
    fireEvent.pointerUp(second, { pointerType: 'mouse', button: 0 })
    expect(first).toHaveClass('bg-purple-300')
    expect(second).toHaveClass('bg-purple-300')
    expect(document.querySelectorAll('[data-cell-id].bg-purple-300')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Create Meeting Time' }))
    expect(screen.getByTestId('meeting-side-panel')).toHaveAttribute('data-duration', String(config.timeInterval * 2))
    expect(document.querySelectorAll('[data-meeting-selection="true"]')).toHaveLength(2)
  })

  it('shows the calendar edit entry point for users with edit permission', async () => {
    renderCalendarPage()

    await flushMicrotasks()
    await flushMicrotasks()

    fireEvent.click(screen.getByRole('button', { name: 'Edit Calendar' }))

    expect(screen.getByRole('button', { name: 'Save Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getByLabelText('Event Name')).toHaveValue('Team Calendar')
    const deleteEntry = screen.getByRole('button', { name: 'Delete Calendar' })
    expect(deleteEntry).toHaveClass('bg-danger-subtle', 'border-danger-muted')
    expect(deleteEntry).not.toHaveClass('bg-danger')
    fireEvent.click(deleteEntry)
    expect(deleteEntry).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('bg-danger')
    expect(vi.mocked(apiClient.delete)).not.toHaveBeenCalled()
  })

  it('previews weekly participation on the current week when switching to Dates, then saves that range', async () => {
    const convertedAvailability = [
      { username: 'Alex', time_slots: ['2026-06-10_11:00'] },
    ]
    mockCalendarResponse({
      hideDateNumbers: true,
      customStartDate: '2026-05-04',
      customEndDate: '2026-05-31',
      availability: [{ username: 'Alex', time_slots: ['2026-05-06_11:00'] }],
    })
    vi.mocked(apiClient.patch).mockResolvedValue({ data: { convertedAvailability } })

    renderCalendarPage()
    await flushMicrotasks()
    await flushMicrotasks()

    fireEvent.click(screen.getByRole('button', { name: 'Edit Calendar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dates' }))
    await flushMicrotasks()

    expect(document.querySelector('[data-cell-id="2026-06-10_11:00"]')).toHaveClass('bg-green-200')
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }))
    await flushMicrotasks()

    expect(apiClient.patch).toHaveBeenCalledWith('/api/calendars/test-hash', expect.objectContaining({
      config: expect.objectContaining({
        hideDateNumbers: false,
        customStartDate: '2026-06-08',
        customEndDate: '2026-06-14',
      }),
    }))
    const patchBody = vi.mocked(apiClient.patch).mock.calls[0][1] as { config: Record<string, unknown> }
    expect(patchBody.config).not.toHaveProperty('archived')
    expect(document.querySelector('[data-cell-id="2026-06-10_11:00"]')).toHaveClass('bg-green-200')
  })

  it('restores Any Week participation and range when the Dates preview is cancelled', async () => {
    mockCalendarResponse({
      hideDateNumbers: true,
      customStartDate: '2026-05-04',
      customEndDate: '2026-05-31',
      availability: [{ username: 'Alex', time_slots: ['2026-05-06_11:00'] }],
    })

    renderCalendarPage()
    await flushMicrotasks()
    await flushMicrotasks()

    fireEvent.click(screen.getByRole('button', { name: 'Edit Calendar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dates' }))
    await flushMicrotasks()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await flushMicrotasks()

    // Weekly mode matches by weekday, so the current-week Wednesday is marked again
    expect(document.querySelector('[data-cell-id="2026-06-10_11:00"]')).toHaveClass('bg-green-200')
    expect(apiClient.patch).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Edit Calendar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Any Week' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }))
    await flushMicrotasks()
    expect(apiClient.patch).toHaveBeenCalledWith('/api/calendars/test-hash', expect.objectContaining({
      config: expect.objectContaining({
        hideDateNumbers: true,
        customStartDate: '2026-05-04',
        customEndDate: '2026-05-31',
      }),
    }))
  })

  it('archives an Any Week calendar while keeping the Any Week format', async () => {
    mockCalendarResponse({
      hideDateNumbers: true,
      availability: [{ username: 'Alex', time_slots: ['2026-06-10_11:00'] }],
    })
    vi.mocked(apiClient.patch).mockResolvedValue({ data: {} })

    renderCalendarPage()
    await flushMicrotasks()
    await flushMicrotasks()

    fireEvent.click(screen.getByRole('button', { name: 'Edit Calendar' }))
    const archiveButton = screen.getByRole('button', { name: 'Archive' })
    expect(archiveButton).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(archiveButton)
    expect(archiveButton).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Any Week' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }))
    await flushMicrotasks()

    expect(apiClient.patch).toHaveBeenCalledWith('/api/calendars/test-hash', expect.objectContaining({
      config: expect.objectContaining({ hideDateNumbers: true, archived: true }),
    }))
    expect(document.querySelector('[data-cell-id="2026-06-10_11:00"]')).toHaveClass('bg-green-200')
  })

  it('loads the Archive option as selected and clears it when switching back to Any Week', async () => {
    mockCalendarResponse({ hideDateNumbers: true, archived: true })
    vi.mocked(apiClient.patch).mockResolvedValue({ data: {} })

    renderCalendarPage()
    await flushMicrotasks()
    await flushMicrotasks()

    fireEvent.click(screen.getByRole('button', { name: 'Edit Calendar' }))
    expect(screen.getByRole('button', { name: 'Archive' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Any Week' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }))
    await flushMicrotasks()

    const patchBody = vi.mocked(apiClient.patch).mock.calls[0][1] as { config: Record<string, unknown> }
    expect(patchBody.config.hideDateNumbers).toBe(true)
    expect(patchBody.config).not.toHaveProperty('archived')
  })

  it('preserves the grid viewport during and after manual hour adjustments', async () => {
    const { container } = renderCalendarPage()
    await flushMicrotasks()
    await flushMicrotasks()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Calendar' }))
    await act(async () => { vi.advanceTimersByTime(100) })

    const grid = container.querySelector('.calendar-grid-scroll')!
    let scrollTop = 123
    const setScrollTop = vi.fn((value: number) => { scrollTop = value })
    Object.defineProperty(grid, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: setScrollTop,
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Preview start hour' })[0])
    await act(async () => { vi.advanceTimersByTime(100) })
    expect(setScrollTop).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Release start hour' })[0])
    await act(async () => { vi.advanceTimersByTime(100) })
    expect(setScrollTop).not.toHaveBeenCalled()
    expect(grid.scrollTop).toBe(123)
  })

  it('syncs primary timezone changes from the calendar to the user profile', async () => {
    renderCalendarPage()

    await flushMicrotasks()
    await flushMicrotasks()

    fireEvent.click(screen.getAllByRole('button', { name: 'Change primary timezone' })[0])
    await flushMicrotasks()

    expect(mockSetPrimaryTimezone).toHaveBeenCalledWith('America/New_York')
    expect(mockUseAuth().updateProfile).toHaveBeenCalledWith({ timezone: 'America/New_York' })
  })

  it('opens a confirmed meeting in the side panel when tapped on mobile', async () => {
    mockCalendarResponse({
      meetings: [
        {
          id: 'meeting-4',
          time_slots: ['2026-06-10T10:00'],
          meeting_link: 'https://example.com/meeting-4',
          description: 'Mobile tap opens the meeting editor',
          duration_minutes: 60,
          title: 'Mobile meeting',
          recurrence_rule: null,
        },
      ],
    })

    renderCalendarPage()

    await flushMicrotasks()
    await flushMicrotasks()

    const [meetingOverlay] = screen.getAllByTestId('meeting-overlay-0-0')
    fireEvent.pointerDown(meetingOverlay)
    fireEvent.click(meetingOverlay)

    expect(screen.getByTestId('meeting-side-panel')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('meeting-side-panel')).toHaveAttribute('data-cell-id', '2026-06-10_10:00')
  })

  it('resets meeting creation after cancelling a suggestion in a dated weekday calendar', async () => {
    mockCalendarResponse({
      availability: [
        { username: 'Alex', time_slots: ['2026-06-15_10:00', '2026-06-10_11:00'] },
        { username: 'Blair', time_slots: ['2026-06-15_10:00', '2026-06-10_11:00'] },
      ],
    })

    renderCalendarPage()

    await flushMicrotasks()
    await flushMicrotasks()

    fireEvent.click(screen.getByRole('button', { name: /Tools/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Suggest Meeting Times' }))

    expect(screen.getByTestId('meeting-side-panel')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('meeting-side-panel')).toHaveAttribute('data-cell-id', '2026-06-10_11:00')

    fireEvent.click(screen.getByRole('button', { name: 'Cancel meeting editor' }))

    expect(screen.getByTestId('meeting-side-panel')).toHaveAttribute('data-open', 'false')
    expect(screen.getByRole('button', { name: 'Create Meeting' })).toBeInTheDocument()
  })

  it('does not crash when landscape tip storage is unavailable', async () => {
    const originalGetItem = Storage.prototype.getItem
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
      if (key === 'landscapeTipDismissed') {
        throw new Error('storage unavailable')
      }
      return originalGetItem.call(this, key)
    })

    try {
      renderCalendarPage()

      await flushMicrotasks()
      await flushMicrotasks()

      expect(screen.getByText('Team Calendar')).toBeInTheDocument()
    } finally {
      getItemSpy.mockRestore()
    }
  })

  it('renders the quick tool row in the configured order and persists it per device', async () => {
    renderCalendarPage()

    await flushMicrotasks()
    await flushMicrotasks()

    const quickToolButtons = screen.getAllByRole('button').filter((button) => {
      const hasToolLabel = ['Tools', 'Chat', 'Participants', 'Calendar Syncs'].some((name) => (button.textContent || '').includes(name))
      return hasToolLabel && button.getAttribute('draggable') === 'true'
    })

    expect(quickToolButtons.map((button) => (button.textContent || '').replace(/\s+/g, ' ').trim())).toEqual([
      'Tools',
      'Chat',
      'Calendar Syncs',
    ])

    const storageKey = Object.keys(sessionStorage).find((key) => key.startsWith('cm-calendar-tool-order:'))
    expect(storageKey).toBeTruthy()
    expect(sessionStorage.getItem(storageKey!)).toContain('tools')
  })

  it('does not re-add default quick tools the user removed', async () => {
    const storageKey = `cm-calendar-tool-order:${[window.screen?.width ?? 0, window.screen?.height ?? 0, navigator.userAgent].join('-')}`
    localStorage.setItem(storageKey, JSON.stringify(['tools', 'calendarSyncs']))

    try {
      renderCalendarPage()

      await flushMicrotasks()
      await flushMicrotasks()

      const quickToolLabels = screen.getAllByRole('button')
        .filter((button) => button.getAttribute('draggable') === 'true')
        .map((button) => (button.textContent || '').replace(/\s+/g, ' ').trim())
        .filter((label) => ['Tools', 'Chat', 'Calendar Syncs'].includes(label))

      expect(quickToolLabels).toEqual(['Tools', 'Calendar Syncs'])
      expect(localStorage.getItem(storageKey)).toBe(JSON.stringify(['tools', 'calendarSyncs']))
    } finally {
      localStorage.removeItem(storageKey)
      sessionStorage.removeItem(storageKey)
    }
  })

  it('requests the neutral readable acknowledgment when copying the quick-row invite link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderCalendarPage()
    await flushMicrotasks()
    await flushMicrotasks()
    fireEvent.click(screen.getAllByRole('button', { name: 'Tools' }).find(button => button.draggable)!)
    fireEvent.click(screen.getByRole('button', { name: 'Add Copy Invite Link quick button' }))
    const copy = screen.getAllByRole('button', { name: 'Copy Invite Link' }).find(button => button.draggable)!
    fireEvent.click(copy)
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/join/'))
    expect(mockShowToast).toHaveBeenCalledWith('Invite link copied.', 'success', 'neutral')
  })

  it.each([true, false])('uses neutral quick tools and an unmistakable active state (dark=%s)', async (isDark) => {
    mockUseTheme.mockReturnValue({ isDark, activeThemeId: 'preset-forest' })
    renderCalendarPage()
    await flushMicrotasks()
    await flushMicrotasks()
    const tools = screen.getAllByRole('button', { name: 'Tools' }).find(button => button.draggable)!
    const chat = screen.getAllByRole('button', { name: 'Chat' }).find(button => button.draggable)!
    expect(chat).toHaveClass('bg-primary-subtle', 'border-primary-muted')
    expect(chat.className).not.toMatch(/from-|via-|to-|sky-|cyan-|blue-/)
    fireEvent.click(tools)
    expect(tools).toHaveAttribute('aria-pressed', 'true')
    expect(tools).toHaveClass('bg-primary-muted', 'text-foreground', 'border-primary', 'ring-primary')
    expect(tools).not.toHaveClass('bg-primary')
    expect(tools.querySelector('.lucide-check')).toBeNull()
    fireEvent.click(tools)
    expect(tools).toHaveAttribute('aria-pressed', 'false')
    expect(tools).toHaveClass('bg-primary-subtle')
  })

  it('keeps the tools header separate from overflow-safe, non-shrinking cards', async () => {
    renderCalendarPage()
    await flushMicrotasks()
    await flushMicrotasks()
    await openCalendarSyncsPanel()

    const header = screen.getByRole('button', { name: 'Close sidebar' }).parentElement
    const body = header?.nextElementSibling
    expect(header).toHaveClass('shrink-0')
    expect(body).toHaveClass('min-h-0', 'overflow-y-auto', 'justify-center-safe')
    expect(body?.firstElementChild).toHaveClass('shrink-0')
    expect(body).toContainElement(screen.getByText('Google Calendar'))
  })

  it('shows Secret Swarm only when time items exist, auto-selects it, and marks the busy slot', async () => {
    renderCalendarPage()

    await flushMicrotasks()
    await flushMicrotasks()

    expect(screen.getAllByRole('button', { name: 'Calendar Syncs' }).length).toBeGreaterThan(0)
    await openCalendarSyncsPanel()
    expect(screen.getByText('Secret Swarm')).toBeInTheDocument()

    const modeCheckbox = screen.getByRole('checkbox', { name: /^Focus\b/i })
    expect(modeCheckbox).toBeChecked()

    const busyCell = document.querySelector('[data-cell-id="2026-06-10_10:00"]') as HTMLElement | null
    expect(busyCell).not.toBeNull()
    if (!busyCell) return

    expect(busyCell.querySelectorAll('[data-busy-overlay] polygon')).toHaveLength(14)

    expect(vi.mocked(apiClient.post)).not.toHaveBeenCalledWith('/api/calendar-sources/busy', expect.anything())
  })

  it.each([
    { destination: 'Secret Swarm', isDark: true },
    { destination: 'Secret Swarm', isDark: false },
    { destination: 'Google Calendar', isDark: true },
    { destination: 'Both', isDark: false },
  ])('exports checked meeting items to $destination (dark=$isDark)', async ({ destination, isDark }) => {
    const recurrenceRule = { type: 'weekly', weekDays: [2], endType: 'never' } as const
    mockUseTheme.mockReturnValue({ isDark, activeThemeId: null })
    mockCalendarResponse({
      googleSource: destination !== 'Secret Swarm',
      meetings: [{
        id: 'meeting-1', title: 'Planning', time_slots: ['2026-06-10T13:00'],
        duration_minutes: 45, meeting_link: 'https://example.com/meeting', description: 'Agenda',
        recurrence_rule: { ...recurrenceRule, weekDays: [...recurrenceRule.weekDays] },
      }, {
        id: 'meeting-2', title: 'Not selected', time_slots: ['2026-06-10T14:00'], duration_minutes: 30,
      }],
    })
    renderCalendarPage()
    await flushMicrotasks()
    await flushMicrotasks()
    await openCalendarSyncsPanel()
    if (destination === 'Google Calendar') fireEvent.click(screen.getByRole('checkbox', { name: /^Focus\b/ }))
    if (destination !== 'Secret Swarm') {
      fireEvent.click(screen.getByRole('checkbox', { name: /^Google Work/ }))
      await flushMicrotasks()
    }
    expect(screen.queryByRole('button', { name: /Import selected time from/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Import unselected time from/ })).not.toBeInTheDocument()
    if (!screen.queryByRole('checkbox', { name: 'Select Planning for calendar export' })) {
      fireEvent.click(screen.getByRole('button', { name: /Confirmed Meetings/ }))
    }
    const meetingCheckbox = screen.getByRole('checkbox', { name: 'Select Planning for calendar export' })
    fireEvent.click(meetingCheckbox)
    expect(screen.getByTestId('meeting-side-panel')).toHaveAttribute('data-open', 'false')
    fireEvent.click(screen.getByRole('switch', { name: 'Hide busy' }))
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { totalCreated: 1, totalFailed: 0, results: [] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Export 1 to Calendar' }))
    await flushMicrotasks()
    await flushMicrotasks()

    if (destination !== 'Google Calendar') {
      expect(apiClient.post).toHaveBeenCalledWith('/api/user-events', {
        id: expect.any(String),
        title: 'Planning', description: 'Agenda', meeting_link: 'https://example.com/meeting',
        start_time: '2026-06-10T13:00:00.000Z', end_time: '2026-06-10T13:45:00.000Z',
        is_public: false, source_id: 'mode-1', recurrence_rule: recurrenceRule,
      })
    } else {
      expect(apiClient.post).not.toHaveBeenCalledWith('/api/user-events', expect.anything())
    }
    if (destination !== 'Secret Swarm') {
      expect(apiClient.post).toHaveBeenCalledWith('/api/calendar-sources/export', {
        calendarHash: 'test-hash', meetingIndices: [0], targetSourceIds: ['google-1'],
        meetings: [{
          cellId: '2026-06-10_13:00', meetingLink: 'https://example.com/meeting',
          description: 'Agenda', duration: 45, title: 'Planning', recurrenceRule,
        }],
      })
    } else {
      expect(apiClient.post).not.toHaveBeenCalledWith('/api/calendar-sources/export', expect.anything())
    }
    expect(apiClient.post).not.toHaveBeenCalledWith('/api/availability', expect.anything())
    expect(meetingCheckbox).not.toBeChecked()
    expect(screen.queryByRole('button', { name: 'Export 1 to Calendar' })).not.toBeInTheDocument()
    expect(mockShowToast).toHaveBeenCalledWith(
      `Successfully exported ${destination === 'Both' ? 2 : 1} event(s) to selected calendars.`, 'success',
    )
  })

  it('only shows meeting export checkboxes while a writable destination is checked', async () => {
    mockCalendarResponse({ meetings: [{
      id: 'meeting-1', title: 'Planning', time_slots: ['2026-06-10T13:00'], duration_minutes: 30,
    }] })
    renderCalendarPage()
    await flushMicrotasks()
    await flushMicrotasks()
    await openCalendarSyncsPanel()
    if (!screen.queryByRole('checkbox', { name: 'Select Planning for calendar export' })) {
      fireEvent.click(screen.getByRole('button', { name: /Confirmed Meetings/ }))
    }
    expect(screen.getByRole('checkbox', { name: 'Select Planning for calendar export' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: /^Focus\b/ }))
    expect(screen.queryByRole('checkbox', { name: 'Select Planning for calendar export' })).not.toBeInTheDocument()
  })

  it('reports mode export failures and retains selection with the same idempotency key for retry', async () => {
    mockCalendarResponse({ meetings: [{
      id: 'meeting-1', title: 'Planning', time_slots: ['2026-06-10T13:00'], duration_minutes: 30,
    }] })
    renderCalendarPage()
    await flushMicrotasks()
    await flushMicrotasks()
    await openCalendarSyncsPanel()
    if (!screen.queryByRole('checkbox', { name: 'Select Planning for calendar export' })) {
      fireEvent.click(screen.getByRole('button', { name: /Confirmed Meetings/ }))
    }
    const meetingCheckbox = screen.getByRole('checkbox', { name: 'Select Planning for calendar export' })
    fireEvent.click(meetingCheckbox)
    vi.mocked(apiClient.post).mockRejectedValueOnce(new Error('Connection lost'))
    fireEvent.click(screen.getByRole('button', { name: 'Export 1 to Calendar' }))
    await flushMicrotasks()
    expect(mockShowToast).toHaveBeenCalledWith(
      'Exported 0 event(s). Some exports failed:\nFocus: Connection lost', 'error',
    )
    expect(meetingCheckbox).toBeChecked()
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { event: {} } })
    fireEvent.click(screen.getByRole('button', { name: 'Export 1 to Calendar' }))
    await flushMicrotasks()
    await flushMicrotasks()
    const exports = vi.mocked(apiClient.post).mock.calls.filter(([url]) => url === '/api/user-events')
    expect(exports).toHaveLength(2)
    expect(exports[1][1]).toEqual(exports[0][1])
    expect(meetingCheckbox).not.toBeChecked()
  })

  it('continues mode exports after Google failure and does not repeat acknowledged Google exports on mode retry', async () => {
    mockCalendarResponse({ googleSource: true, meetings: [{
      id: 'meeting-1', title: 'Planning', time_slots: ['2026-06-10T13:00'], duration_minutes: 30,
    }] })
    renderCalendarPage()
    await flushMicrotasks()
    await flushMicrotasks()
    await openCalendarSyncsPanel()
    fireEvent.click(screen.getByRole('checkbox', { name: /^Google Work/ }))
    await flushMicrotasks()
    if (!screen.queryByRole('checkbox', { name: 'Select Planning for calendar export' })) {
      fireEvent.click(screen.getByRole('button', { name: /Confirmed Meetings/ }))
    }
    const meetingCheckbox = screen.getByRole('checkbox', { name: 'Select Planning for calendar export' })
    fireEvent.click(meetingCheckbox)
    vi.mocked(apiClient.post)
      .mockRejectedValueOnce(new Error('Google unavailable'))
      .mockResolvedValueOnce({ data: { event: {} } })
    fireEvent.click(screen.getByRole('button', { name: 'Export 1 to Calendar' }))
    await flushMicrotasks()
    await flushMicrotasks()
    expect(apiClient.post).toHaveBeenCalledWith('/api/user-events', expect.anything())
    expect(mockShowToast).toHaveBeenCalledWith(
      'Exported 1 event(s). Some exports failed:\nGoogle Calendar: Google unavailable', 'error',
    )
    expect(meetingCheckbox).toBeChecked()

    vi.mocked(apiClient.post)
      .mockResolvedValueOnce({ data: { totalCreated: 1, totalFailed: 0, results: [] } })
      .mockRejectedValueOnce(new Error('Mode unavailable'))
    fireEvent.click(screen.getByRole('button', { name: 'Export 1 to Calendar' }))
    await flushMicrotasks()
    await flushMicrotasks()
    expect(mockShowToast).toHaveBeenCalledWith(
      'Exported 1 event(s). Some exports failed:\nFocus: Mode unavailable', 'error',
    )
    expect(meetingCheckbox).toBeChecked()

    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { event: {} } })
    fireEvent.click(screen.getByRole('button', { name: 'Export 1 to Calendar' }))
    await flushMicrotasks()
    await flushMicrotasks()
    expect(vi.mocked(apiClient.post).mock.calls.filter(([url]) => url === '/api/calendar-sources/export'))
      .toHaveLength(2)
    const modeExports = vi.mocked(apiClient.post).mock.calls.filter(([url]) => url === '/api/user-events')
    expect(modeExports).toHaveLength(3)
    expect(modeExports[2][1]).toEqual(modeExports[0][1])
    expect(meetingCheckbox).not.toBeChecked()
  })

  it.each([
    { source: 'Secret Swarm', isDark: true },
    { source: 'Secret Swarm', isDark: false },
    { source: 'Google Calendar', isDark: true },
    { source: 'Google Calendar', isDark: false },
  ])('hides and restores busy visuals without deselecting $source (dark=$isDark)', async ({ source, isDark }) => {
    const screenWidth = vi.spyOn(window.screen, 'width', 'get').mockReturnValue(1920)
    const screenHeight = vi.spyOn(window.screen, 'height', 'get').mockReturnValue(1080)
    try {
      const isGoogle = source === 'Google Calendar'
      mockUseTheme.mockReturnValue({ isDark, activeThemeId: null })
      mockCalendarResponse({
        googleSource: isGoogle,
        ...(isGoogle ? { busyDays: [] } : {}),
      })
      renderCalendarPage()
      await flushMicrotasks()
      await flushMicrotasks()

      expect(screen.queryByRole('switch', { name: 'Hide busy' })).not.toBeInTheDocument()
      await openCalendarSyncsPanel()
      const sourceCheckbox = screen.getByRole('checkbox', { name: isGoogle ? /^Google Work/ : /^Focus\b/ })
      if (isGoogle) {
        fireEvent.click(sourceCheckbox)
        await flushMicrotasks()
      }
      expect(sourceCheckbox).toBeChecked()
      const hideBusySwitch = screen.getByRole('switch', { name: 'Hide busy' })
      expect(hideBusySwitch).not.toBeChecked()
      expect(document.getElementById('calendar-sidebar-syncs-panel')?.firstElementChild?.firstElementChild).toBe(hideBusySwitch)

      const busyCell = document.querySelector('[data-cell-id="2026-06-10_10:00"]')
      if (!busyCell) throw new Error('Expected busy calendar slot')
      expect(busyCell.querySelector('[data-busy-overlay]')).toBeInTheDocument()
      fireEvent.pointerEnter(busyCell, { pointerType: 'mouse' })
      const summary = isGoogle ? 'Google work session' : 'Secret Swarm planning session'
      expect(screen.getByText(summary)).toBeInTheDocument()
      const savedSourceSelections = localStorage.getItem('calendarSourceSelections')
      const syncRequestCount = vi.mocked(apiClient.post).mock.calls.length

      fireEvent.click(hideBusySwitch)
      expect(hideBusySwitch).toBeChecked()
      expect(document.querySelector('[data-busy-overlay]')).not.toBeInTheDocument()
      expect(screen.queryByText(summary)).not.toBeInTheDocument()
      expect(sourceCheckbox).toBeChecked()
      expect(localStorage.getItem('calendarSourceSelections')).toBe(savedSourceSelections)
      expect(vi.mocked(apiClient.post).mock.calls).toHaveLength(syncRequestCount)

      fireEvent.click(hideBusySwitch)
      expect(hideBusySwitch).not.toBeChecked()
      expect(busyCell.querySelector('[data-busy-overlay]')).toBeInTheDocument()
      expect(screen.getByText(summary)).toBeInTheDocument()
    } finally {
      screenWidth.mockRestore()
      screenHeight.mockRestore()
    }
  })

  it('only offers Hide busy while expanded with a selected available sync source', async () => {
    localStorage.setItem('calendarSourceSelections', JSON.stringify(['stale-source']))
    renderCalendarPage()
    await flushMicrotasks()
    await flushMicrotasks()
    await openCalendarSyncsPanel()
    expect(screen.queryByRole('switch', { name: 'Hide busy' })).not.toBeInTheDocument()

    const modeCheckbox = screen.getByRole('checkbox', { name: /^Focus\b/ })
    fireEvent.click(modeCheckbox)
    expect(screen.getByRole('switch', { name: 'Hide busy' })).toBeInTheDocument()
    fireEvent.click(modeCheckbox)
    expect(screen.queryByRole('switch', { name: 'Hide busy' })).not.toBeInTheDocument()
    fireEvent.click(modeCheckbox)

    const disclosure = screen.getAllByRole('button', { name: 'Calendar Syncs' })
      .find(button => button.getAttribute('aria-controls') === 'calendar-sidebar-syncs-panel')
    if (!disclosure) throw new Error('Expected Calendar Syncs disclosure')
    fireEvent.click(disclosure)
    expect(screen.queryByRole('switch', { name: 'Hide busy' })).not.toBeInTheDocument()
    fireEvent.click(disclosure)
    expect(screen.getByRole('switch', { name: 'Hide busy' })).not.toBeChecked()
  })

  it.each([
    { isDark: true, activeThemeId: 'preset-forest', forestStyles: true },
    { isDark: false, activeThemeId: 'preset-forest', forestStyles: false },
    { isDark: true, activeThemeId: 'preset-ocean', forestStyles: false },
    { isDark: true, activeThemeId: null, forestStyles: false },
  ])('keeps Forest neutral slots and uses theme-matching busy blocks ($isDark, $activeThemeId)', async (theme) => {
    mockUseTheme.mockReturnValue(theme)
    mockCalendarResponse({
      availability: [{ username: 'Participant', time_slots: ['2026-06-10_11:00'] }],
    })
    renderCalendarPage()
    await flushMicrotasks()
    await flushMicrotasks()

    const emptyCell = document.querySelector('[data-cell-id="2026-06-10_09:00"]')
    const busyCell = document.querySelector('[data-cell-id="2026-06-10_10:00"]')
    const availableCell = document.querySelector('[data-cell-id="2026-06-10_11:00"]')
    expect(emptyCell).toHaveAttribute('data-selectable', 'true')
    expect(emptyCell).toHaveClass('cursor-pointer')
    expect(emptyCell?.className.includes('bg-neutral-subtle')).toBe(theme.forestStyles)
    expect(emptyCell?.className.includes('hover:bg-[color-mix')).toBe(theme.forestStyles)
    expect(emptyCell?.className.includes('bg-success-subtle')).toBe(!theme.forestStyles)
    expect(availableCell).toHaveClass('bg-green-200')
    expect(availableCell?.className).not.toContain('color-mix')

    const overlay = busyCell?.querySelector('[data-busy-overlay]')
    expect(overlay).toBeInTheDocument()
    expect(overlay?.querySelectorAll('polygon')).toHaveLength(14)
    const colors = getCalendarBusyColors(theme.isDark, theme.activeThemeId)
    overlay?.querySelectorAll('polygon').forEach((block, index) => {
      expect(block).toHaveAttribute('fill', colors[index % 2])
    })
    expect(busyCell?.querySelector('[style*="repeating-linear-gradient"]')).not.toBeInTheDocument()

    if (!emptyCell) throw new Error('Expected selectable calendar slot')
    fireEvent.pointerDown(emptyCell, { pointerType: 'mouse', button: 0 })
    fireEvent.pointerUp(emptyCell, { pointerType: 'mouse', button: 0 })
    expect(emptyCell).toHaveClass('bg-purple-300')
    expect(emptyCell.className).not.toContain('color-mix')
  })

  it('uses the same permanent 14-block overlay on every weekday, including old preview links', async () => {
    mockUseTheme.mockReturnValue({ isDark: true, activeThemeId: 'preset-forest' })
    const busyDays = Array.from({ length: 7 }, (_, index) => `2026-06-${String(index + 8).padStart(2, '0')}`)
    mockCalendarResponse({ busyDays })
    renderCalendarPage('?busy-preview=weekdays&keep=1')
    await flushMicrotasks()
    await flushMicrotasks()

    expect(screen.queryByRole('region', { name: 'Temporary busy style comparison' })).not.toBeInTheDocument()
    const colors = getCalendarBusyColors(true, 'preset-forest')
    busyDays.forEach(date => {
      const overlay = document.querySelector(`[data-cell-id="${date}_10:00"] [data-busy-overlay]`)
      expect(overlay).toBeInTheDocument()
      const blocks = overlay?.querySelectorAll('polygon')
      expect(blocks).toHaveLength(14)
      blocks?.forEach((block, blockIndex) => {
        expect(block).toHaveAttribute('fill', colors[blockIndex % 2])
        expect(block).toHaveAttribute('fill-opacity', '0.4')
      })
    })
    const emptyCell = document.querySelector('[data-cell-id="2026-06-10_09:00"]')
    if (!emptyCell) throw new Error('Expected selectable calendar slot')
    fireEvent.pointerDown(emptyCell, { pointerType: 'mouse', button: 0 })
    fireEvent.pointerUp(emptyCell, { pointerType: 'mouse', button: 0 })
    expect(emptyCell).toHaveClass('bg-purple-300')
    expect(document.querySelector('[data-busy-preview]')).not.toBeInTheDocument()
    expect(emptyCell).toHaveClass('bg-purple-300')
  })

  it('hides Secret Swarm when the user has no time items', async () => {
    const noTimeItemsGet = async (url: string) => {
      if (url === '/api/availability/user/past?exclude_hash=test-hash') {
        return { data: { entries: [] } }
      }
      if (url === '/api/calendars/test-hash') {
        return {
          data: {
            title: 'Team Calendar',
            visibility: 'unlisted',
            created_by: 'owner@example.com',
            creator_display_name: 'Owner',
            is_owner: true,
            has_edit_permission: true,
            permissions: { canEdit: [] },
            config: {
              eventName: 'Team Calendar',
              timeInterval: 30,
              hideDateNumbers: false,
              customStartDate: '2026-06-08',
              customEndDate: '2026-06-14',
            },
          },
        }
      }
      if (url === '/api/calendar-subscriptions/check/test-hash') {
        return { data: { subscribed: false } }
      }
      if (url === '/api/availability/test-hash') {
        return { data: [] }
      }
      if (url === '/api/meetings/test-hash') {
        return { data: [] }
      }
      if (url === '/api/calendar-sources') {
        return { data: { sources: [] } }
      }
      if (url === '/api/time-management/modes') {
        return {
          data: {
            activeModeId: 'mode-1',
            modes: [
              {
                id: 'mode-1',
                name: 'Focus',
                main_color: '#0EA5E9',
                slot_minutes: 30,
                sync_calendars: [],
                time_backgrounds: [],
                collapsed_background_ids: [],
                quick_templates: [],
                show_quick_templates_in_main: false,
              },
            ],
          },
        }
      }
      if (url === '/api/time-management/categories') {
        return { data: { categories: [] } }
      }
      if (url === '/api/user-events') {
        return { data: { events: [] } }
      }
      throw new Error(`Unexpected GET ${url}`)
    }

    vi.mocked(apiClient.get).mockImplementation(noTimeItemsGet)
    vi.mocked(dedupedGet).mockImplementation(noTimeItemsGet as typeof dedupedGet)

    renderCalendarPage()

    await flushMicrotasks()
    await flushMicrotasks()

    expect(screen.getAllByRole('button', { name: 'Calendar Syncs' }).length).toBeGreaterThan(0)
    await openCalendarSyncsPanel()
    expect(screen.queryByText('Secret Swarm')).not.toBeInTheDocument()
  })

  it('closes an open side panel first when Escape is pressed', async () => {
    mockCalendarResponse({
      meetings: [
        {
          id: 'meeting-1',
          time_slots: ['2026-06-10T10:00'],
          meeting_link: 'https://example.com/meeting-1',
          description: 'Escape panel precedence meeting',
          duration_minutes: 60,
          title: 'Escape precedence',
          recurrence_rule: null,
        },
      ],
    })

    renderCalendarPage()

    await flushMicrotasks()
    await flushMicrotasks()

    await openCalendarSyncsPanel()
    expect(screen.getByText('Google Calendar')).toBeInTheDocument()
    expect(screen.getByText('Escape panel precedence meeting')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    await flushMicrotasks()

    expect(screen.queryByText('Google Calendar')).not.toBeInTheDocument()
    expect(screen.getByText('Escape panel precedence meeting')).toBeInTheDocument()
  })

  it('hides mobile calendar side panels on header navigation and permits reopening', async () => {
    const originalWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    try {
      renderCalendarPage()
      await flushMicrotasks()
      await flushMicrotasks()
      const trigger = screen.getAllByRole('button', { name: 'Calendar Syncs' }).find((button) => !button.closest('aside'))
      if (!trigger) throw new Error('Expected Calendar Syncs quick tool')
      fireEvent.click(trigger)
      expect(screen.getByText('Google Calendar')).toBeInTheDocument()
      const panel = screen.getByText('Google Calendar').closest('aside')
      expect(panel).toHaveClass('translate-x-0')
      act(() => window.dispatchEvent(new Event(MOBILE_NAVIGATION_PANEL_DISMISS_EVENT)))
      expect(panel).toHaveClass('-translate-x-full', 'pointer-events-none')
      expect(screen.getByText('Google Calendar')).toBeInTheDocument()
      fireEvent.click(trigger)
      expect(panel).toHaveClass('translate-x-0')
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
    }
  })

  it('toggles Confirmed Meetings when no side panel is open and Escape is pressed', async () => {
    mockCalendarResponse({
      meetings: [
        {
          id: 'meeting-2',
          time_slots: ['2026-06-10T10:00'],
          meeting_link: 'https://example.com/meeting-2',
          description: 'Escape toggles confirmed meetings',
          duration_minutes: 60,
          title: 'Escape toggle',
          recurrence_rule: null,
        },
      ],
    })

    renderCalendarPage()

    await flushMicrotasks()
    await flushMicrotasks()

    expect(screen.getByText('Escape toggles confirmed meetings')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    await flushMicrotasks()
    expect(screen.queryByText('Escape toggles confirmed meetings')).not.toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    await flushMicrotasks()
    expect(screen.getByText('Escape toggles confirmed meetings')).toBeInTheDocument()
  })

  it('does not toggle Confirmed Meetings when Escape closes a right sidebar panel', async () => {
    mockCalendarResponse({
      meetings: [
        {
          id: 'meeting-3',
          time_slots: ['2026-06-10T10:00'],
          meeting_link: 'https://example.com/meeting-3',
          description: 'Escape keeps confirmed meetings open when right panel closes',
          duration_minutes: 60,
          title: 'Escape right panel precedence',
          recurrence_rule: null,
        },
      ],
    })

    const closeRightPanelsListener = (event: Event) => {
      const customEvent = event as CustomEvent<{ closed?: boolean }>
      if (customEvent.detail) customEvent.detail.closed = true
    }
    window.addEventListener('closeRightSidebarPanels', closeRightPanelsListener)

    renderCalendarPage()

    await flushMicrotasks()
    await flushMicrotasks()

    expect(screen.getByText('Escape keeps confirmed meetings open when right panel closes')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    await flushMicrotasks()

    expect(screen.getByText('Escape keeps confirmed meetings open when right panel closes')).toBeInTheDocument()

    window.removeEventListener('closeRightSidebarPanels', closeRightPanelsListener)
  })

  it('opens participants side panel and auto-selects participant when Use "NAME" has saved availability', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'user-1', email: 'user@example.com', displayName: 'Owner' },
      isAuthenticated: true,
      isTraveler: false,
      isCardano: false,
    })
    mockCalendarResponse({
      availability: [
        {
          username: 'Owner',
          time_slots: ['2026-06-10_10:00'],
        },
      ],
    })

    renderCalendarPage()

    await flushMicrotasks()
    await flushMicrotasks()

    expect(screen.queryByText('Click to highlight availability')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Your Name' }))

    expect(screen.getByText('Click to highlight availability')).toBeInTheDocument()
    const ownerChip = screen.getByRole('button', { name: /Owner/ })
    expect(ownerChip).toHaveAttribute('aria-pressed', 'true')
  })

  it('does not open participants side panel when Use "NAME" has no saved availability', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'user-1', email: 'user@example.com', displayName: 'Owner' },
      isAuthenticated: true,
      isTraveler: false,
      isCardano: false,
    })
    mockCalendarResponse({ availability: [] })

    renderCalendarPage()

    await flushMicrotasks()
    await flushMicrotasks()

    fireEvent.click(screen.getByRole('button', { name: 'Your Name' }))

    expect(screen.queryByText('Click to highlight availability')).not.toBeInTheDocument()
    expect(screen.queryByText('Selected')).not.toBeInTheDocument()
  })
})
