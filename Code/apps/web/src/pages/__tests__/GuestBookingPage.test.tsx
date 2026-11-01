import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GuestBookingPage from '../GuestBookingPage'
import { apiClient } from '../../lib/api-client'
import { contrastRatio } from '../../lib/contrast'
import { hslToHex, PRESET_THEMES } from '../../lib/theme-types'
import { findTimezone, formatTimezoneShort } from '../../lib/timezone-data'

vi.mock('../../lib/api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    isAuthenticated: false,
    isLoading: false,
  }),
}))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-05T09:00:00Z'))
  localStorage.clear()
  vi.mocked(apiClient.get).mockImplementation(async (url) => ({
    data: url.startsWith('/api/calendars/')
      ? {
          title: 'Test coordination',
          config: {
            customStartDate: '2026-10-05',
            customEndDate: '2026-10-11',
            startHour: 9,
            endHour: 11,
            timeInterval: 60,
          },
        }
      : [],
  }))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  document.documentElement.classList.remove('dark')
})

describe.each([
  { mobile: false, dark: false },
  { mobile: false, dark: true },
  { mobile: true, dark: false },
  { mobile: true, dark: true },
])('onboarding guidance (mobile=$mobile, dark=$dark)', ({ mobile, dark }) => {
  it('uses theme-aware colors and preserves the instruction and selection flow', async () => {
    document.documentElement.classList.toggle('dark', dark)
    vi.spyOn(window.screen, 'width', 'get').mockReturnValue(mobile ? 390 : 1920)
    vi.spyOn(window.screen, 'height', 'get').mockReturnValue(mobile ? 844 : 1080)
    vi.stubGlobal('ontouchstart', null)
    vi.stubGlobal('innerWidth', mobile ? 390 : 1920)
    vi.stubGlobal('innerHeight', mobile ? 844 : 1080)

    const { container } = render(
      <MemoryRouter initialEntries={['/join/ogN_sUntUb']}>
        <Routes>
          <Route path="/join/:hash" element={<GuestBookingPage />} />
        </Routes>
      </MemoryRouter>
    )

    fireEvent.change(await screen.findByPlaceholderText('Enter your name...'), {
      target: { value: 'Test participant' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pick your times' }))

    const hint = await screen.findByText(
      mobile
        ? 'Tap a time slot, or press and hold then drag to select a range'
        : "Drag or tap to select when you're available, then confirm below"
    )
    expect(hint).toHaveClass('text-foreground')
    expect(hint).not.toHaveClass('text-purple-700', 'dark:text-purple-300')
    expect(hint.parentElement).toHaveClass('bg-muted')
    expect(hint.parentElement).not.toHaveClass('bg-accent')

    changeTimezone('UTC', 'New York')
    expect(
      screen.getByRole('button', { name: `Timezone: ${timezoneLabel('America/New_York')}` })
    ).toBeInTheDocument()

    const confirm = screen.getByRole('button', { name: 'Confirm Availability' })
    expect(confirm).toBeDisabled()
    const cell = container.querySelector('[data-selectable="true"]')
    expect(cell).not.toBeNull()
    if (!cell) throw new Error('Expected a selectable availability cell')
    fireEvent.pointerDown(cell, { pointerType: 'mouse' })
    fireEvent.pointerUp(cell)
    expect(confirm).toBeEnabled()
    expect(screen.getByText('1 slot selected')).toBeInTheDocument()
    expect(apiClient.post).not.toHaveBeenCalled()
    expect(cell).toBeEmptyDOMElement()
  })
})

describe('built-in onboarding guidance contrast', () => {
  it.each(PRESET_THEMES)('meets WCAG AA in $name', ({ colors }) => {
    expect(
      contrastRatio(hslToHex(colors.foreground), hslToHex(colors.muted))
    ).toBeGreaterThanOrEqual(4.5)
  })
})

function renderInvite() {
  return render(
    <MemoryRouter initialEntries={['/join/ogN_sUntUb']}>
      <Routes>
        <Route path="/join/:hash" element={<GuestBookingPage />} />
      </Routes>
    </MemoryRouter>
  )
}

async function enterCalendar() {
  fireEvent.change(await screen.findByPlaceholderText('Enter your name...'), {
    target: { value: 'Test participant' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Pick your times' }))
  await screen.findByRole('button', { name: 'Timezone: UTC' })
}

function timezoneLabel(iana: string) {
  const entry = findTimezone(iana)
  return entry ? formatTimezoneShort(entry) : iana
}

function openPrimaryTimezoneSearch(iana: string) {
  const label = timezoneLabel(iana)
  const toggle = screen.getByRole('button', { name: `Timezone: ${label}` })
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle)
  fireEvent.click(screen.getByRole('button', { name: label }))
}

function changeTimezone(current: string, city: string) {
  openPrimaryTimezoneSearch(current)
  fireEvent.change(screen.getByPlaceholderText('Search city, country, or timezone...'), {
    target: { value: city },
  })
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${city}`) }))
}

// JSDOM 27+ serializes fractional px with limited precision, so compare numerically.
function expectTopCloseTo(element: HTMLElement | null, expectedTop: string) {
  expect(element).not.toBeNull()
  expect(parseFloat(element?.style.top ?? '')).toBeCloseTo(parseFloat(expectedTop), 3)
}

describe('invite timezone', () => {
  it('starts every visit in UTC without changing the full calendar preference', async () => {
    const preference = JSON.stringify({ primary: 'Asia/Tokyo', additional: [] })
    localStorage.setItem('coordination-timezones', preference)
    const firstVisit = renderInvite()
    await enterCalendar()
    expect(screen.getByLabelText('Time column: UTC')).toHaveTextContent('UTC')
    expect(screen.queryByText(/All dates and times are shown/)).not.toBeInTheDocument()
    changeTimezone('UTC', 'New York')
    expect(
      screen.getByRole('button', { name: `Timezone: ${timezoneLabel('America/New_York')}` })
    ).toBeInTheDocument()
    expect(localStorage.getItem('coordination-timezones')).toBe(preference)
    firstVisit.unmount()

    renderInvite()
    await enterCalendar()
    expect(screen.getByRole('button', { name: 'Timezone: UTC' })).toBeInTheDocument()
  })

  it('updates local labels while preserving selected and submitted UTC slots', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: {} })
    const { container } = renderInvite()
    await enterCalendar()
    const cell = container.querySelector('[data-cell-id="2026-10-05_09:00"]')
    if (!cell) throw new Error('Expected the Monday UTC availability cell')
    fireEvent.pointerDown(cell, { pointerType: 'mouse' })
    fireEvent.pointerUp(cell)

    changeTimezone('UTC', 'New York')
    expect(cell).toHaveAttribute('aria-label', expect.stringMatching(/Mon.*5 Oct.*05:00 GMT-4/))
    expect(cell).toBeEmptyDOMElement()
    expect(screen.getByLabelText('Time column: EDT')).toHaveTextContent('EDT')
    expect(cell.parentElement?.firstElementChild).toHaveTextContent('05:00')
    expect(screen.getByText('1 slot selected')).toBeInTheDocument()
    expect(screen.queryByText(/Day headers use UTC dates/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Availability' }))
    expect(apiClient.post).toHaveBeenCalledWith('/api/availability', {
      calendar_hash: 'ogN_sUntUb',
      username: 'Test participant',
      time_slots: ['2026-10-05_09:00'],
    })
    expect(await screen.findByText("You're in!")).toBeInTheDocument()
  })

  it('shows next-day local dates and fractional offsets', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url) => ({
      data: url.startsWith('/api/calendars/')
        ? {
            title: 'Rollover coordination',
            config: {
              customStartDate: '2026-10-05',
              customEndDate: '2026-10-11',
              startHour: 11,
              endHour: 12,
              timeInterval: 60,
            },
          }
        : [],
    }))
    const { container } = renderInvite()
    await enterCalendar()
    changeTimezone('UTC', 'Auckland')
    const cell = container.querySelector('[data-cell-id="2026-10-05_11:00"]')
    expect(cell).toHaveAttribute('aria-label', expect.stringMatching(/Tue.*6 Oct.*00:00 GMT\+13/))
    expect(cell).toBeEmptyDOMElement()
    expect(cell?.parentElement?.firstElementChild).toHaveTextContent('00:00')
    changeTimezone('Pacific/Auckland', 'Mumbai')
    expect(cell).toHaveAttribute('aria-label', expect.stringMatching(/Mon.*5 Oct.*16:30 GMT\+5:30/))
    expect(cell?.parentElement?.firstElementChild).toHaveTextContent('16:30')
  })

  it.each([
    { mobile: false, dark: false },
    { mobile: false, dark: true },
    { mobile: true, dark: false },
    { mobile: true, dark: true },
  ])('uses DST columns with empty cells (mobile=$mobile, dark=$dark)', async ({ mobile, dark }) => {
    document.documentElement.classList.toggle('dark', dark)
    vi.spyOn(window.screen, 'width', 'get').mockReturnValue(mobile ? 844 : 1920)
    vi.spyOn(window.screen, 'height', 'get').mockReturnValue(mobile ? 390 : 1080)
    vi.stubGlobal('ontouchstart', null)
    vi.stubGlobal('innerWidth', mobile ? 844 : 1920)
    vi.stubGlobal('innerHeight', mobile ? 390 : 1080)
    vi.mocked(apiClient.get).mockImplementation(async (url) => ({
      data: url.startsWith('/api/calendars/')
        ? {
            title: 'DST coordination',
            config: {
              customStartDate: '2026-10-26',
              customEndDate: '2026-11-01',
              startHour: 0,
              endHour: 8,
              timeInterval: 60,
            },
          }
        : [],
    }))
    const { container } = renderInvite()
    await enterCalendar()
    changeTimezone('UTC', 'New York')
    const dstHeader = screen.getByLabelText('Daylight-saving change: EDT to EST')
    expect(dstHeader).toHaveTextContent('New YorkGMT-4 to -5')
    expect(dstHeader).toHaveClass('bg-warning-subtle')
    expect(dstHeader.nextElementSibling).toHaveTextContent('Sun1')
    expect(screen.getByLabelText('Time column: EDT')).toHaveTextContent('EDT')
    expect(container.querySelector('[data-cell-id="2026-10-26_00:00"]')).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/Sun.*25 Oct.*20:00 GMT-4/)
    )
    expect(container.querySelector('[data-cell-id="2026-11-01_05:00"]')).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/Sun.*1 Nov.*01:00 GMT-4/)
    )
    expect(container.querySelector('[data-cell-id="2026-11-01_06:00"]')).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/Sun.*1 Nov.*01:00 GMT-5/)
    )
    const sundayCell = container.querySelector('[data-cell-id="2026-11-01_06:00"]')
    expect(sundayCell).toBeEmptyDOMElement()
    expect(sundayCell?.previousElementSibling).toHaveTextContent('01:00')
    expect(sundayCell?.previousElementSibling).toHaveClass('bg-warning-subtle')
    expect(sundayCell?.previousElementSibling).not.toHaveAttribute('data-selectable')
    expect(container.querySelectorAll('[data-cell-id]')).toHaveLength(56)
    const headerGrid = dstHeader.parentElement
    expect(headerGrid?.style.gridTemplateColumns).toBe(
      `${mobile ? '50px' : '60px'} ${Array.from({ length: 6 }, () => 'minmax(80px, 1fr)').join(' ')} ${mobile ? '48px' : '62px'} minmax(80px, 1fr)`
    )
    expect(sundayCell?.parentElement?.getAttribute('style')).toBe(headerGrid?.getAttribute('style'))
    changeTimezone('America/New_York', 'UTC')
    expect(screen.queryByLabelText(/Daylight-saving change/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Time column: UTC')).toBeInTheDocument()
  })

  it('can apply the browser timezone and dismiss the picker without changing timezone', async () => {
    renderInvite()
    await enterCalendar()
    openPrimaryTimezoneSearch('UTC')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('button', { name: 'Timezone: UTC' })).toBeInTheDocument()
    openPrimaryTimezoneSearch('UTC')
    const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    fireEvent.click(screen.getByText('Apply browser timezone'))
    expect(
      screen.getByRole('button', { name: `Timezone: ${timezoneLabel(browserTimezone)}` })
    ).toBeInTheDocument()
    expect(
      screen.queryByPlaceholderText('Search city, country, or timezone...')
    ).not.toBeInTheDocument()
  })

  it('uses the full calendar selector for additional display columns', async () => {
    const { container } = renderInvite()
    await enterCalendar()
    const toggle = screen.getByRole('button', { name: 'Timezone: UTC' })
    expect(toggle).toHaveAttribute('title', 'Timezone: UTC')
    fireEvent.click(toggle)
    expect(screen.getByText('Primary')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add Timezone (1/5)' }))
    fireEvent.change(screen.getByPlaceholderText('Search city, country, or timezone...'), {
      target: { value: 'New York' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^New York/ }))
    expect(screen.getByText('Display 2')).toBeInTheDocument()
    expect(screen.getByLabelText('Time column: EDT')).toHaveTextContent('New York')
    const cell = container.querySelector('[data-cell-id="2026-10-05_09:00"]')
    expect(cell).toBeEmptyDOMElement()
    expect(cell?.parentElement?.children[0]).toHaveTextContent('05:00')
    expect(cell?.parentElement?.children[1]).toHaveTextContent('09:00')
    expect(screen.getByLabelText('Current time in America/New_York')).toHaveTextContent('05:00')
    fireEvent.click(screen.getByRole('button', { name: 'Remove timezone' }))
    expect(screen.queryByLabelText('Time column: EDT')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Time column: UTC')).toBeInTheDocument()
    expect(localStorage.getItem('coordination-timezones')).toBeNull()
  })

  it.each([
    { time: '2026-10-05T08:59:00Z', top: null },
    { time: '2026-10-05T09:00:00Z', top: '0px' },
    { time: '2026-10-05T09:30:00Z', top: '16px' },
    { time: '2026-10-05T10:59:00Z', top: `${(119 / 60) * 32}px` },
    { time: '2026-10-05T11:00:00Z', top: null },
    { time: '2026-10-12T09:30:00Z', top: null },
  ])(
    'shows the red current-time line only inside the visible timeframe ($time)',
    async ({ time, top }) => {
      vi.setSystemTime(new Date(time))
      renderInvite()
      await enterCalendar()
      const line = screen.queryByLabelText('Current time indicator')
      if (top === null) {
        expect(line).not.toBeInTheDocument()
      } else {
        expectTopCloseTo(line, top)
        expect(line).toHaveClass('bg-danger', 'pointer-events-none')
        expect(screen.getByLabelText('Current time in UTC')).toHaveTextContent(time.slice(11, 16))
        changeTimezone('UTC', 'New York')
        expectTopCloseTo(screen.getByLabelText('Current time indicator'), top)
      }
    }
  )

  it('updates the live clock and line, then removes the line when the hour range ends', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-10-05T10:58:00Z'))
    const { unmount } = renderInvite()
    await enterCalendar()
    expect(screen.getByLabelText('Current time in UTC')).toHaveTextContent('10:58')
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByLabelText('Current time in UTC')).toHaveTextContent('10:59')
    expectTopCloseTo(screen.getByLabelText('Current time indicator'), `${(119 / 60) * 32}px`)
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByLabelText('Current time in UTC')).toHaveTextContent('11:00')
    expect(screen.queryByLabelText('Current time indicator')).not.toBeInTheDocument()
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    { time: '2026-10-05T09:30:00Z', skippedDays: ['2026-10-05'], timeInterval: 60 },
    { time: '2026-10-05T10:45:00Z', skippedDays: [], timeInterval: 30 },
  ])(
    'hides the line on skipped days and outside rendered partial hours ($time)',
    async ({ time, skippedDays, timeInterval }) => {
      vi.setSystemTime(new Date(time))
      vi.mocked(apiClient.get).mockImplementation(async (url) => ({
        data: url.startsWith('/api/calendars/')
          ? {
              title: 'Limited hours',
              config: {
                customStartDate: '2026-10-05',
                customEndDate: '2026-10-11',
                startHour: 9,
                endHour: 11,
                timeInterval,
                skippedDays,
              },
            }
          : [],
      }))
      renderInvite()
      await enterCalendar()
      expect(screen.queryByLabelText('Current time indicator')).not.toBeInTheDocument()
    }
  )

  it('shows the current-time line only when today is visible in the mobile day pager', async () => {
    vi.setSystemTime(new Date('2026-10-08T09:30:00Z'))
    vi.spyOn(window.screen, 'width', 'get').mockReturnValue(390)
    vi.spyOn(window.screen, 'height', 'get').mockReturnValue(844)
    vi.stubGlobal('ontouchstart', null)
    vi.stubGlobal('innerWidth', 390)
    vi.stubGlobal('innerHeight', 844)
    renderInvite()
    await enterCalendar()
    expect(screen.queryByLabelText('Current time indicator')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next days' }))
    expect(screen.getByLabelText('Current time indicator')).toHaveStyle({ top: '16px' })
  })
})
