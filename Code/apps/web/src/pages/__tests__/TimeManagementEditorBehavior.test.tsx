import '@testing-library/jest-dom/vitest'
import { startOfWeek } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import {
  installDefaultApiMocks,
  installEditorDomPolyfills,
  mockDedupedGet,
  mockUseAuth,
} from './time-management-test-harness'
import { apiClient } from '../../lib/api-client'
import { clearSessionCacheValue } from '../../lib/session-data-cache'
import type { RecurrenceRule } from '../../lib/recurrence'
import TimeManagementPage from '../TimeManagementPage'

const TITLE_PLACEHOLDER = 'Type Title for Time Item'
const RECURRENCE_CREATION_CASES: Array<{ label: string; rule: RecurrenceRule }> = [
  { label: 'None', rule: { type: 'none' } },
  { label: 'Weekly', rule: { type: 'weekly' } },
  { label: 'Bi-wkly', rule: { type: 'biweekly' } },
  { label: 'Monthly', rule: { type: 'monthly' } },
  { label: 'Month wk', rule: { type: 'monthlyWeek', monthWeeks: [2] } },
  ...(['day', 'week', 'month'] as const).flatMap((unit) =>
    (['never', 'on', 'after', 'whenCompleted'] as const).map((endType) => ({
      label: 'Custom',
      rule: {
        type: 'custom' as const,
        interval: 2,
        unit,
        endType,
        ...(endType === 'on' ? { endDate: '2099-12-31' } : {}),
        ...(endType === 'after' ? { endCount: 3 } : {}),
      },
    }))
  ),
]

// Give the item a real box around the press point; with a zero-size rect every press lands on a resize edge.
function mockItemRectAroundPointer(element: HTMLElement, clientY: number) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: clientY - 30, top: clientY - 30, left: 0, right: 100, bottom: clientY + 30, width: 100, height: 60, toJSON: () => ({}),
  })
}

describe('TimeManagement editor regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    clearSessionCacheValue('time-management:events:anon')
    mockUseAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      isTraveler: false,
    })
    installDefaultApiMocks()
    installEditorDomPolyfills()
  })

  it('keeps usable events visible when a background refresh fails', async () => {
    const week = startOfWeek(new Date(), { weekStartsOn: 1 })
    const start = new Date(Date.UTC(week.getFullYear(), week.getMonth(), week.getDate(), 12))
    const event = {
      id: 'refresh-retained', title: 'Refresh retained item', description: null,
      meeting_link: null, location: null, start_time: start.toISOString(),
      end_time: new Date(start.getTime() + 3600000).toISOString(),
      source_type: 'manual', source_id: 'mode-main', category_ids: [],
    }
    let failRefresh = false
    const defaultGet = mockDedupedGet.getMockImplementation()
    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/user-events') {
        if (failRefresh) throw new Error('Refresh temporarily unavailable.')
        return { data: { events: [event] } }
      }
      return defaultGet?.(url)
    })
    render(<MemoryRouter><TimeManagementPage /></MemoryRouter>)
    expect((await screen.findAllByText(event.title)).length).toBeGreaterThan(0)
    failRefresh = true
    fireEvent.focus(window)
    await screen.findByText('Refresh temporarily unavailable.')
    expect(screen.getAllByText(event.title).length).toBeGreaterThan(0)
  })

  it.each([
    { mode: 'always', description: null, duration: 30, opens: true },
    { mode: 'never', description: 'Copied notes', duration: 60, opens: false },
    { mode: 'description', description: 'Copied notes', duration: 30, opens: true },
    { mode: 'description', description: null, duration: 30, opens: false },
    { mode: 'description', description: '  \n  ', duration: 30, opens: false },
    { mode: 'minDuration', description: null, duration: 15, opens: false },
    { mode: 'minDuration', description: null, duration: 30, opens: false },
    { mode: 'minDuration', description: null, duration: 45, opens: true },
    { mode: 'minDuration', description: null, duration: 60, opens: true, crossMidnight: true },
    { mode: 'never', description: null, duration: 30, opens: true, alreadyOpen: true },
    { mode: 'always', description: null, duration: 30, opens: false, phone: true, editorOpens: true },
    { mode: 'never', description: 'Copied notes', duration: 60, opens: false, phone: true, editorOpens: false },
  ].flatMap((testCase) => ['keyboard', 'context-menu'].map((method) => ({ ...testCase, method }))))(
    'Time Item paste panel opening: $method, $mode, description=$description, duration=$duration, crossMidnight=$crossMidnight, alreadyOpen=$alreadyOpen, phone=$phone',
    async ({ mode, description, duration, opens, crossMidnight, alreadyOpen, phone, editorOpens, method }) => {
      const originalWidth = window.innerWidth
      try {
        localStorage.setItem('time-management-v1', JSON.stringify({
          openLeftPanelOnItemSelectionMode: mode,
          openLeftPanelMinItemSelectionMinutes: 30,
          openLeftPanelOnSelectionMode: 'never',
        }))
        const week = startOfWeek(new Date(), { weekStartsOn: 1 })
        const start = new Date(Date.UTC(week.getFullYear(), week.getMonth(), week.getDate() + 1, crossMidnight ? 23 : 12, crossMidnight ? 30 : 0))
        const event = {
          id: 'paste-source', title: 'Paste panel target', description,
          meeting_link: null, location: null,
          start_time: start.toISOString(), end_time: new Date(start.getTime() + duration * 60000).toISOString(),
          source_type: 'manual', source_id: 'mode-main', category_ids: [],
          recurrence_rule: { type: 'none' },
        }
        const defaultGet = mockDedupedGet.getMockImplementation()
        mockDedupedGet.mockImplementation(async (url: string) => {
          if (url === '/api/user-events') return { data: { events: [event] } }
          if (url === '/api/time-management/modes') return { data: {
            activeModeId: 'mode-main',
            modes: [{ id: 'mode-main', name: 'Main', main_color: '#2563eb', slot_minutes: 15,
              sync_calendars: [], time_backgrounds: [], collapsed_background_ids: [], quick_templates: [],
              show_quick_templates_in_main: false }],
          } }
          return defaultGet?.(url)
        })
        let resolveCreate!: (result: { data: { event: typeof event } }) => void
        vi.mocked(apiClient.post).mockReturnValueOnce(new Promise((resolve) => { resolveCreate = resolve }))
        const { container } = render(<MemoryRouter><TimeManagementPage /></MemoryRouter>)
        fireEvent.click((await screen.findAllByText(event.title))[0])
        fireEvent.keyDown(window, { key: 'c', ctrlKey: true })
        if (screen.queryByTitle('Hide left panel')) fireEvent.click(screen.getByTitle('Hide left panel'))
        if (alreadyOpen) fireEvent.click(screen.getByTitle('Show left panel'))
        if (phone) {
          Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
          fireEvent(window, new Event('resize'))
        }

        const dayColumn = screen.getByTestId('calendar-day-column-0')
        vi.spyOn(dayColumn, 'getBoundingClientRect').mockReturnValue({
          x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 600, width: 100, height: 600,
          toJSON: () => ({}),
        })
        fireEvent.mouseDown(dayColumn, { button: 0, clientX: 20, clientY: 320 })
        fireEvent.mouseUp(window)
        if (method === 'context-menu') {
          fireEvent.contextMenu(dayColumn, { clientX: 20, clientY: 320 })
          fireEvent.click(screen.getByRole('menuitem', { name: /^Paste Item/ }))
        } else {
          fireEvent.keyDown(window, { key: 'v', ctrlKey: true })
        }

        await waitFor(() => {
          expect(apiClient.post).toHaveBeenCalledWith('/api/user-events', expect.objectContaining({
            title: event.title, description: description?.trim() || null,
          }))
          expect(container.querySelector('[data-time-management-item="true"][data-selected="true"]')).toBeInTheDocument()
          expect(screen.getByTestId('time-management-left-panel')).toHaveAttribute('data-open', String(opens))
          expect(Boolean(screen.queryByTestId('full-editor-overlay'))).toBe(Boolean(editorOpens))
        })
        const payload = vi.mocked(apiClient.post).mock.calls.find(([url]) => url === '/api/user-events')?.[1] as { start_time: string; end_time: string }
        expect((new Date(payload.end_time).getTime() - new Date(payload.start_time).getTime()) / 60000).toBe(duration)
        await act(async () => {
          resolveCreate({ data: { event: {
            ...event, id: 'paste-result', title: 'Saved paste panel target',
            start_time: payload.start_time, end_time: payload.end_time,
          } } })
        })
        await waitFor(() => {
          expect(container.querySelector('[data-time-management-item="true"][data-selected="true"]')).toHaveTextContent('Saved paste panel target')
          expect(screen.getByTestId('time-management-left-panel')).toHaveAttribute('data-open', String(opens))
          expect(Boolean(screen.queryByTestId('full-editor-overlay'))).toBe(Boolean(editorOpens))
        })
      } finally {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
        fireEvent(window, new Event('resize'))
      }
    }
  )

  it.each([
    { mode: undefined, description: null, duration: 30, opens: true },
    { mode: 'invalid', description: null, duration: 30, opens: true },
    { mode: 'always', description: null, duration: 30, opens: true },
    { mode: 'description', description: 'Meeting notes', duration: 30, opens: true },
    { mode: 'description', description: null, duration: 30, opens: false },
    { mode: 'description', description: '  \n  ', duration: 30, opens: false },
    { mode: 'never', description: 'Meeting notes', duration: 60, opens: false },
    { mode: 'minDuration', description: null, duration: 15, opens: false },
    { mode: 'minDuration', description: null, duration: 30, opens: false },
    { mode: 'minDuration', description: null, duration: 45, opens: true },
    { mode: 'minDuration', description: null, duration: 60, opens: true, crossMidnight: true },
    { mode: 'never', description: null, duration: 30, opens: true, alreadyOpen: true },
  ])('Time Item panel opening: $mode, description=$description, duration=$duration, crossMidnight=$crossMidnight, alreadyOpen=$alreadyOpen', async ({ mode, description, duration, opens, crossMidnight, alreadyOpen }) => {
    localStorage.setItem('time-management-v1', JSON.stringify({
      openLeftPanelOnItemSelectionMode: mode,
      openLeftPanelMinItemSelectionMinutes: 30,
      openLeftPanelOnSelectionMode: 'minDuration',
      openLeftPanelMinSelectionMinutes: 120,
    }))
    const week = startOfWeek(new Date(), { weekStartsOn: 1 })
    const start = new Date(Date.UTC(week.getFullYear(), week.getMonth(), week.getDate() + 1, crossMidnight ? 23 : 12, crossMidnight ? 30 : 0))
    const event = {
      id: 'panel-selection-item', title: 'Panel selection target', description,
      meeting_link: null, location: null,
      start_time: start.toISOString(), end_time: new Date(start.getTime() + duration * 60000).toISOString(),
      source_type: 'manual', source_id: 'mode-main', category_ids: [],
      recurrence_rule: { type: 'none' },
    }
    const defaultGet = mockDedupedGet.getMockImplementation()
    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/user-events') return { data: { events: [event] } }
      return defaultGet?.(url)
    })
    const { container } = render(<MemoryRouter><TimeManagementPage /></MemoryRouter>)
    const itemLabel = (await screen.findAllByText(event.title))[0]
    if (alreadyOpen) fireEvent.click(screen.getByTitle('Show left panel'))
    fireEvent.click(itemLabel)

    await waitFor(() => {
      expect(container.querySelector('[data-time-management-item="true"][data-selected="true"]')).toBeInTheDocument()
      expect(screen.getByTestId('time-management-left-panel')).toHaveAttribute('data-open', String(opens))
    })
    if (!opens) {
      fireEvent.click(screen.getByTitle('Show left panel'))
    }
    const editorToggle = screen.queryByRole('button', { name: /^(Create|Edit) Time Item$/, expanded: false })
    if (editorToggle) fireEvent.click(editorToggle)
    expect(await screen.findByPlaceholderText(TITLE_PLACEHOLDER)).toHaveValue(event.title)
  })

  it.each([
    { duration: 15, crossMidnight: false, width: 1400 },
    { duration: 60, crossMidnight: true, width: 1400 },
    { duration: 30, crossMidnight: false, width: 390 },
  ])('Time Item selection feedback shows $duration minutes, replays, and preserves double-click Full View at $width', async ({ duration, crossMidnight, width }) => {
    const originalWidth = window.innerWidth
    try {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
      localStorage.setItem('time-management-v1', JSON.stringify({ openLeftPanelOnItemSelectionMode: 'never' }))
      const week = startOfWeek(new Date(), { weekStartsOn: 1 })
      const start = new Date(Date.UTC(week.getFullYear(), week.getMonth(), week.getDate() + 1, crossMidnight ? 23 : 12, crossMidnight ? 30 : 0))
      const event = {
        id: 'selection-feedback-item', title: 'Selection feedback target', description: null,
        meeting_link: null, location: null,
        start_time: start.toISOString(), end_time: new Date(start.getTime() + duration * 60000).toISOString(),
        source_type: 'manual', source_id: 'mode-main', category_ids: [], recurrence_rule: { type: 'none' },
      }
      const defaultGet = mockDedupedGet.getMockImplementation()
      mockDedupedGet.mockImplementation(async (url: string) => {
        if (url === '/api/user-events') return { data: { events: [event] } }
        return defaultGet?.(url)
      })
      const { container } = render(<MemoryRouter><TimeManagementPage /></MemoryRouter>)
      const label = (await screen.findAllByText(event.title))[0]
      fireEvent.click(label)
      expect(screen.getByTestId('time-management-left-panel')).toHaveAttribute('data-open', 'false')
      const firstFeedback = screen.getAllByTestId('time-item-selection-feedback')[0]
      expect(firstFeedback).toHaveAttribute('data-feedback-sequence', '1')
      expect(firstFeedback).toHaveClass('pointer-events-none', 'motion-safe:animate-[time-item-selection-pulse_650ms_ease-out]')
      expect(screen.getAllByTestId('time-item-selection-duration').every((badge) => badge.textContent?.includes(`${duration} min total`))).toBe(true)

      vi.useFakeTimers()
      fireEvent.click(label)
      expect(screen.getAllByTestId('time-item-selection-feedback')[0]).toHaveAttribute('data-feedback-sequence', '2')
      await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
      expect(screen.queryByTestId('time-item-selection-feedback')).not.toBeInTheDocument()
      expect(screen.queryByTestId('time-item-selection-duration')).not.toBeInTheDocument()
      expect(container.querySelector('[data-time-management-item="true"][data-selected="true"]')).toBeInTheDocument()
      expect(vi.mocked(apiClient.put).mock.calls.filter(([url]) => String(url).startsWith('/api/user-events/'))).toHaveLength(0)
      vi.useRealTimers()

      fireEvent.dblClick(label)
      await waitFor(() => expect(document.querySelector('div.fixed.inset-0 input[placeholder="Type Title for Time Item"]')).toHaveValue(event.title))
      expect(screen.queryByTestId('time-item-selection-feedback')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
      fireEvent(window, new Event('resize'))
    }
  })

  it('Time Item panel never setting does not prevent time range selection from opening the panel', async () => {
    localStorage.setItem('time-management-v1', JSON.stringify({
      openLeftPanelOnItemSelectionMode: 'never',
      openLeftPanelOnSelectionMode: 'always',
    }))
    render(<MemoryRouter><TimeManagementPage /></MemoryRouter>)
    const column = await screen.findByTestId('calendar-day-column-0')
    vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 600, width: 100, height: 600, toJSON: () => ({}),
    })
    fireEvent.mouseDown(column, { button: 0, clientX: 20, clientY: 320 })
    fireEvent.pointerUp(window)
    await waitFor(() => expect(screen.getByTestId('time-management-left-panel')).toHaveAttribute('data-open', 'true'))
    expect(await screen.findByPlaceholderText(TITLE_PLACEHOLDER)).toHaveValue('')
  })

  it('Time Item panel settings persist independently of time selection and expose the toggle', async () => {
    const page = <MemoryRouter><TimeManagementPage /></MemoryRouter>
    const { unmount } = render(page)
    await screen.findByRole('heading', { name: 'Time Management' })
    fireEvent.click(screen.getByTitle('Show left panel'))
    fireEvent.click(screen.getByRole('button', { name: 'Calendar Modes' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))

    expect(screen.getByText('Open Left Panel on Time Selection')).toBeInTheDocument()
    const itemMode = screen.getByTestId('open-left-panel-on-item-selection-mode')
    expect(itemMode).toHaveValue('always')
    expect(within(itemMode).getAllByRole('option')).toHaveLength(4)
    fireEvent.click(screen.getByTestId('open-left-panel-on-item-selection-toggle'))
    expect(screen.queryByTestId('open-left-panel-on-item-selection-mode')).not.toBeInTheDocument()
    expect(screen.queryByTestId('open-left-panel-min-item-selection-minutes')).not.toBeInTheDocument()
    expect(screen.getByTestId('open-left-panel-on-item-selection-toggle')).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(screen.getByTestId('open-left-panel-on-item-selection-toggle'))
    expect(screen.getByTestId('open-left-panel-on-item-selection-mode')).toHaveValue('always')

    fireEvent.change(screen.getByTestId('open-left-panel-on-item-selection-mode'), { target: { value: 'minDuration' } })
    const itemMinutes = screen.getByTestId('open-left-panel-min-item-selection-minutes')
    expect(itemMinutes).toBeEnabled()
    expect(within(itemMinutes).getAllByRole('option').map((option) => option.getAttribute('value'))).toEqual(['15', '30', '45', '60', '90', '120'])
    fireEvent.change(itemMinutes, { target: { value: '45' } })
    fireEvent.change(screen.getByTestId('open-left-panel-on-selection-mode'), { target: { value: 'minDuration' } })
    fireEvent.change(screen.getByTestId('open-left-panel-min-selection-minutes'), { target: { value: '90' } })
    await waitFor(() => expect(JSON.parse(localStorage.getItem('time-management-v1') || '{}')).toMatchObject({
      openLeftPanelOnItemSelectionMode: 'minDuration',
      openLeftPanelMinItemSelectionMinutes: 45,
      openLeftPanelOnSelectionMode: 'minDuration',
      openLeftPanelMinSelectionMinutes: 90,
    }))

    unmount()
    render(page)
    await screen.findByRole('heading', { name: 'Time Management' })
    fireEvent.click(screen.getByTitle('Show left panel'))
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    expect(screen.getByTestId('open-left-panel-on-item-selection-mode')).toHaveValue('minDuration')
    expect(screen.getByTestId('open-left-panel-min-item-selection-minutes')).toHaveValue('45')
    expect(screen.getByTestId('open-left-panel-min-selection-minutes')).toHaveValue('90')
    fireEvent.change(screen.getByTestId('open-left-panel-on-item-selection-mode'), { target: { value: 'description' } })
    expect(screen.queryByTestId('open-left-panel-min-item-selection-minutes')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('open-left-panel-on-selection-toggle'))
    const timeSettings = screen.getByTestId('open-left-panel-on-selection-settings')
    expect(within(timeSettings).queryByText('Only when longer than')).not.toBeInTheDocument()
    expect(screen.queryByTestId('open-left-panel-on-selection-mode')).not.toBeInTheDocument()
    expect(screen.queryByTestId('open-left-panel-min-selection-minutes')).not.toBeInTheDocument()
    await waitFor(() => expect(JSON.parse(localStorage.getItem('time-management-v1') || '{}')).toMatchObject({ openLeftPanelOnSelectionMode: 'never' }))
    fireEvent.click(screen.getByTestId('open-left-panel-on-selection-toggle'))
    expect(screen.getByTestId('open-left-panel-on-selection-mode')).toHaveValue('always')
  })

  it('Time Item panel choices switch between one-row buttons and dropdowns as available width changes', async () => {
    const originalWidth = window.innerWidth
    const setWidth = (width: number) => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
      fireEvent(window, new Event('resize'))
    }
    try {
      setWidth(1600)
      localStorage.setItem('time-management-v1', JSON.stringify({ leftPanelWidthPx: 700 }))
      render(<MemoryRouter><TimeManagementPage /></MemoryRouter>)
      await screen.findByRole('heading', { name: 'Time Management' })
      fireEvent.click(screen.getByTitle('Show left panel'))
      fireEvent.click(screen.getByRole('button', { name: 'Calendar Modes' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
      const itemSettings = screen.getByTestId('open-left-panel-on-item-selection-settings')
      expect(within(itemSettings).getByRole('group')).toHaveClass('flex')
      expect(screen.queryByTestId('open-left-panel-on-item-selection-mode')).not.toBeInTheDocument()
      fireEvent.click(screen.getByTestId('open-left-panel-on-item-selection-mode-minDuration'))
      fireEvent.change(screen.getByTestId('open-left-panel-min-item-selection-minutes'), { target: { value: '60' } })
      fireEvent.click(screen.getByTestId('open-left-panel-on-selection-mode-minDuration'))
      fireEvent.change(screen.getByTestId('open-left-panel-min-selection-minutes'), { target: { value: '45' } })

      setWidth(900)
      await waitFor(() => expect(screen.getByTestId('open-left-panel-on-item-selection-mode')).toHaveValue('minDuration'))
      expect(screen.getByTestId('open-left-panel-min-item-selection-minutes')).toHaveValue('60')
      expect(screen.getByTestId('open-left-panel-on-selection-mode-minDuration')).toHaveAttribute('aria-pressed', 'true')

      setWidth(700)
      await waitFor(() => expect(screen.getByTestId('open-left-panel-on-selection-mode')).toHaveValue('minDuration'))
      expect(screen.getByTestId('open-left-panel-min-selection-minutes')).toHaveValue('45')
      expect(screen.queryByTestId('open-left-panel-on-selection-mode-minDuration')).not.toBeInTheDocument()

      setWidth(390)
      await waitFor(() => {
        expect(screen.getByTestId('open-left-panel-on-selection-mode')).toHaveValue('minDuration')
        expect(screen.getByTestId('open-left-panel-on-item-selection-mode')).toHaveValue('minDuration')
      })
      setWidth(1600)
      await waitFor(() => expect(screen.getByTestId('open-left-panel-on-item-selection-mode-minDuration')).toHaveAttribute('aria-pressed', 'true'))
      fireEvent.click(screen.getByTestId('open-left-panel-on-item-selection-mode-never'))
      expect(within(itemSettings).queryByRole('group')).not.toBeInTheDocument()
      expect(within(itemSettings).queryByText('Only when longer than')).not.toBeInTheDocument()
    } finally {
      setWidth(originalWidth)
    }
  })

  it.each([1400, 390])('Time Item panel time-selection toggle prevents automatic editor opening at viewport %i', async (width) => {
    const originalWidth = window.innerWidth
    try {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
      localStorage.setItem('time-management-v1', JSON.stringify({ openLeftPanelOnSelectionMode: 'never' }))
      const { container } = render(<MemoryRouter><TimeManagementPage /></MemoryRouter>)
      const column = await screen.findByTestId('calendar-day-column-0')
      vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({
        x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 600, width: 100, height: 600, toJSON: () => ({}),
      })
      fireEvent.mouseDown(column, { button: 0, clientX: 20, clientY: 320 })
      fireEvent.pointerUp(window)
      await waitFor(() => expect(container.innerHTML).toContain('selection-flow'))
      expect(screen.getByTestId('time-management-left-panel')).toHaveAttribute('data-open', 'false')
      expect(screen.queryByTestId('full-editor-overlay')).not.toBeInTheDocument()
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
      fireEvent(window, new Event('resize'))
    }
  })

  it.each([
    { mode: 'never', width: 1400, manuallyClosed: false, opens: false },
    { mode: 'never', width: 390, manuallyClosed: false, opens: false },
    { mode: 'minDuration', width: 1400, manuallyClosed: false, opens: false },
    { mode: 'always', width: 1400, manuallyClosed: true, opens: false },
    { mode: 'always', width: 1400, manuallyClosed: false, opens: true },
  ])('direct title typing preserves panel visibility: $mode at $width, manuallyClosed=$manuallyClosed', async ({ mode, width, manuallyClosed, opens }) => {
    const originalWidth = window.innerWidth
    try {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
      localStorage.setItem('time-management-v1', JSON.stringify({
        openLeftPanelOnSelectionMode: mode,
        openLeftPanelMinSelectionMinutes: 120,
      }))
      const { container } = render(<MemoryRouter><TimeManagementPage /></MemoryRouter>)
      const column = await screen.findByTestId('calendar-day-column-0')
      vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({
        x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 600, width: 100, height: 600, toJSON: () => ({}),
      })
      fireEvent.mouseDown(column, { button: 0, clientX: 20, clientY: 320 })
      fireEvent.pointerUp(window)
      await waitFor(() => expect(container.innerHTML).toContain('selection-flow'))
      if (manuallyClosed) fireEvent.click(screen.getByTitle('Hide left panel'))
      const panel = screen.getByTestId('time-management-left-panel')
      expect(panel).toHaveAttribute('data-open', String(opens))

      for (const key of ['A', ' ', 'B', 'Backspace', 'Delete', ...'Saved title']) {
        fireEvent.keyDown(window, { key })
        expect(panel).toHaveAttribute('data-open', String(opens))
      }
      fireEvent.keyDown(window, { key: 'Enter' })
      await waitFor(() => {
        expect(apiClient.post).toHaveBeenCalledWith('/api/user-events', expect.objectContaining({ title: 'Saved title' }))
      })
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
      fireEvent(window, new Event('resize'))
    }
  })

  it.each([
    ...['left panel', 'full view', 'right click', 'right click tag', 'drag', 'nudge', 'autosave'].flatMap((surface) =>
      ['this', 'future', 'cancel'].map((scope) => ({ surface, scope }))
    ),
    { surface: 'left panel', scope: 'failed create' },
  ])('asks for recurrence scope from $surface and applies $scope without changing earlier items', async ({ surface, scope }) => {
    const week = startOfWeek(new Date(), { weekStartsOn: 1 })
    const occurrence = new Date(Date.UTC(week.getFullYear(), week.getMonth(), week.getDate(), 12))
    const base = new Date(occurrence.getTime() - 14 * 24 * 60 * 60 * 1000)
    const event = {
      id: 'recurring-scope', title: 'Recurring scope target', description: null,
      meeting_link: null, location: null,
      start_time: base.toISOString(), end_time: new Date(base.getTime() + 3600000).toISOString(),
      source_type: 'manual', source_id: 'mode-main', category_ids: [],
      recurrence_rule: { type: 'weekly', endType: 'after', endCount: 6 },
    }
    let persistedEvents: Record<string, unknown>[] = [event]
    const defaultGet = mockDedupedGet.getMockImplementation()
    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/user-events') return { data: { events: persistedEvents } }
      if (url === '/api/time-management/categories') return { data: { categories: [{ id: 'focus', label: 'Focus', color: '#16a34a', font_color: '#ffffff', sort_order: 0 }] } }
      return defaultGet?.(url)
    })
    vi.mocked(apiClient.put).mockImplementation(async (url, payload) => {
      if (url === '/api/user-events/recurring-scope') {
        persistedEvents = persistedEvents.map((entry) => entry.id === event.id ? { ...entry, ...(payload as Record<string, unknown>) } : entry)
      }
      return { data: {} }
    })
    vi.mocked(apiClient.post).mockImplementation(async (_url, payload) => {
      if (scope === 'failed create') throw new Error('Simulated create failure')
      const created = { ...(payload as Record<string, unknown>), id: 'edited-occurrence', source_type: 'manual' }
      persistedEvents.push(created)
      return { data: { event: created } }
    })

    const { container, unmount } = render(<MemoryRouter><TimeManagementPage /></MemoryRouter>)
    const itemLabel = (await screen.findAllByText(event.title))[0]
    fireEvent.click(itemLabel)
    let titleInput = await screen.findByPlaceholderText(TITLE_PLACEHOLDER)
    if (surface === 'full view') {
      fireEvent.click(screen.getByTitle('Open full view editor'))
      const titleInputs = screen.getAllByPlaceholderText(TITLE_PLACEHOLDER)
      titleInput = titleInputs[titleInputs.length - 1]
    }
    const editsTitle = ['left panel', 'full view', 'right click', 'autosave'].includes(surface)
    if (surface === 'autosave') vi.useFakeTimers()
    if (editsTitle) fireEvent.change(titleInput, { target: { value: 'Changed occurrence' } })
    if (surface === 'full view') {
      fireEvent.click(screen.getByTestId('full-editor-save-button'))
    } else if (surface === 'right click') {
      fireEvent.contextMenu(itemLabel, { clientX: 20, clientY: 140 })
      fireEvent.click(screen.getByRole('menuitem', { name: /Save Item/ }))
    } else if (surface === 'right click tag') {
      fireEvent.contextMenu(itemLabel, { clientX: 20, clientY: 140 })
      fireEvent.click(screen.getByRole('menuitem', { name: 'Assign Category' }))
      fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Focus' }))
    } else if (surface === 'nudge') {
      fireEvent.click(screen.getByRole('button', { name: 'Adjust Time' }))
      fireEvent.click(screen.getByTitle('Move end 30 minutes later'))
    } else if (surface === 'drag') {
      const dayColumn = screen.getByTestId('calendar-day-column-1')
      const item = container.querySelector<HTMLDivElement>('[data-time-management-item="true"][data-selected="true"]')!
      vi.spyOn(dayColumn, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 600, width: 100, height: 600, toJSON: () => ({}) })
      vi.spyOn(item, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 300, top: 300, left: 0, right: 100, bottom: 340, width: 100, height: 40, toJSON: () => ({}) })
      Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: vi.fn(() => [dayColumn]) })
      fireEvent.pointerDown(item, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 50, clientY: 320 })
      fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 20, clientY: 450 })
      fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: 20, clientY: 450 })
    } else if (surface === 'autosave') {
      try {
        await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
      } finally {
        vi.useRealTimers()
      }
    } else {
      fireEvent.click(screen.getByTestId('left-sidebar-update-button'))
    }

    const dialog = await screen.findByRole('dialog', { name: 'Edit recurring item' })
    if (surface === 'full view') {
      const fullEditor = screen.getByTestId('full-editor-overlay')
      expect(Number(dialog.parentElement?.style.zIndex)).toBeGreaterThan(Number(fullEditor.style.zIndex))
      if (scope === 'cancel') {
        fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Cancel' }), { key: 'Escape' })
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit recurring item' })).not.toBeInTheDocument())
        expect(screen.getByTestId('full-editor-overlay')).toBeInTheDocument()
        expect(apiClient.post).not.toHaveBeenCalled()
        expect(vi.mocked(apiClient.put).mock.calls.filter(([url]) => url === '/api/user-events/recurring-scope')).toHaveLength(0)
        return
      }
    }
    expect(vi.mocked(apiClient.put).mock.calls.filter(([url]) => url === '/api/user-events/recurring-scope')).toHaveLength(0)
    expect(apiClient.post).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', {
      name: scope === 'this' ? 'This item only' : scope === 'cancel' ? 'Cancel' : 'This and future occurrences',
    }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit recurring item' })).not.toBeInTheDocument())
    if (scope === 'cancel') {
      expect(apiClient.post).not.toHaveBeenCalled()
      expect(vi.mocked(apiClient.put).mock.calls.filter(([url]) => url === '/api/user-events/recurring-scope')).toHaveLength(0)
      return
    }
    if (scope === 'failed create') {
      await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/api/user-events/recurring-scope', { recurrence_rule: event.recurrence_rule }))
      expect(persistedEvents).toEqual([event])
      return
    }
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/user-events', expect.objectContaining({
      title: editsTitle ? 'Changed occurrence' : event.title,
      ...(surface !== 'drag' ? { start_time: occurrence.toISOString() } : {}),
      ...(surface === 'right click tag' ? { category_ids: ['focus'] } : {}),
      ...(surface === 'nudge' ? { end_time: new Date(occurrence.getTime() + 90 * 60000).toISOString() } : {}),
      recurrence_rule: scope === 'this' ? { type: 'none' } : expect.objectContaining({ type: 'weekly', endCount: 4 }),
    })))
    expect(apiClient.put).toHaveBeenCalledWith('/api/user-events/recurring-scope', {
      recurrence_rule: expect.objectContaining(scope === 'this'
        ? { exceptions: [occurrence.toISOString().slice(0, 10)], endCount: 6 }
        : { endType: 'on', endDate: new Date(occurrence.getTime() - 86400000).toISOString().slice(0, 10) }),
    })
    expect(vi.mocked(apiClient.put).mock.calls.filter(([url]) => url === '/api/user-events/recurring-scope')
      .every(([, payload]) => Object.keys(payload as object).every((key) => key === 'recurrence_rule'))).toBe(true)
    expect(persistedEvents[0]).toMatchObject({ title: event.title, start_time: event.start_time, end_time: event.end_time, category_ids: [] })
    if (['left panel', 'full view', 'right click'].includes(surface)) {
      unmount()
      render(<MemoryRouter><TimeManagementPage /></MemoryRouter>)
      expect((await screen.findAllByText('Changed occurrence')).length).toBeGreaterThan(0)
    }
  })

  it.each(RECURRENCE_CREATION_CASES)('creates a time item with $label ($rule.unit / $rule.endType) recurrence selected before choosing time', async ({ label, rule }) => {
    vi.mocked(apiClient.post).mockImplementation(async (_url, payload) => ({
      data: { event: { ...(payload as Record<string, unknown>), id: 'recurrence-created', source_type: 'manual' } },
    }))

    const { container } = render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    fireEvent.click(screen.getByRole('button', { name: 'Create Time Item' }))
    await screen.findByPlaceholderText(TITLE_PLACEHOLDER)
    fireEvent.click(screen.getByRole('button', { name: 'Recurrence' }))
    for (const option of ['None', 'Weekly', 'Bi-wkly', 'Monthly', 'Month wk', 'Custom']) {
      expect(screen.getByRole('button', { name: option })).toBeEnabled()
    }
    fireEvent.click(screen.getByRole('button', { name: label }))
    if (rule.type === 'monthlyWeek') {
      for (const weekLabel of ['2nd', '1st', '3rd', '4th']) {
        const weekButton = screen.getByRole('button', { name: weekLabel })
        const isPressed = weekButton.getAttribute('aria-pressed') === 'true'
        if (weekLabel === '2nd' ? !isPressed : isPressed) {
          fireEvent.click(weekButton)
        }
      }
    }
    if (rule.type === 'custom') {
      fireEvent.change(screen.getByRole('spinbutton', { name: 'Recurrence interval' }), { target: { value: rule.interval } })
      fireEvent.change(screen.getByRole('combobox', { name: 'Recurrence unit' }), { target: { value: rule.unit } })
      fireEvent.click(screen.getByRole('button', { name: rule.endType === 'on' ? 'On date' : rule.endType === 'after' ? 'After #' : rule.endType === 'whenCompleted' ? 'When marked as completed' : 'Never' }))
      if (rule.endType === 'on') {
        fireEvent.change(screen.getByLabelText('Recurrence end date'), { target: { value: rule.endDate } })
      }
      if (rule.endType === 'after') {
        fireEvent.change(screen.getByRole('spinbutton', { name: 'Recurrence occurrence count' }), { target: { value: rule.endCount } })
      }
    }

    const dayColumn = container.querySelector("div[style*='repeating-linear-gradient']") as HTMLDivElement
    expect(dayColumn).toBeTruthy()
    vi.spyOn(dayColumn, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 600, width: 100, height: 600, toJSON: () => ({}),
    })
    fireEvent.mouseDown(dayColumn, { button: 0, clientX: 20, clientY: 140 })
    fireEvent.mouseUp(window)

    expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.change(screen.getByPlaceholderText(TITLE_PLACEHOLDER), { target: { value: `Recurrence ${rule.type}` } })
    fireEvent.click(screen.getByTestId('left-sidebar-save-button'))
    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/api/user-events', expect.objectContaining({
        title: `Recurrence ${rule.type}`,
        recurrence_rule: expect.objectContaining(rule),
      }))
    })
  })

  it('keeps draft title when creating a new time selection', async () => {
    const { container } = render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    fireEvent.click(screen.getByRole('button', { name: 'Create Time Item' }))

    const titleInput = await screen.findByPlaceholderText(TITLE_PLACEHOLDER)
    fireEvent.change(titleInput, { target: { value: 'Keep my draft title' } })

    const firstDayColumn = container.querySelector("div[style*='repeating-linear-gradient']") as HTMLDivElement | null
    expect(firstDayColumn).toBeTruthy()

    if (!firstDayColumn) return

    vi.spyOn(firstDayColumn, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 600,
      width: 100,
      height: 600,
      toJSON: () => ({}),
    })

    fireEvent.mouseDown(firstDayColumn, { button: 0, clientX: 20, clientY: 140 })

    expect(screen.getByPlaceholderText(TITLE_PLACEHOLDER)).toHaveValue('Keep my draft title')
  })

  it('scopes ctrl+a to the selection title field', async () => {
    const { container } = render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    fireEvent.click(screen.getByRole('button', { name: 'Create Time Item' }))

    const firstDayColumn = container.querySelector("div[style*='repeating-linear-gradient']") as HTMLDivElement | null
    expect(firstDayColumn).toBeTruthy()
    if (!firstDayColumn) return

    vi.spyOn(firstDayColumn, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 600,
      width: 100,
      height: 600,
      toJSON: () => ({}),
    })

    fireEvent.mouseDown(firstDayColumn, { button: 0, clientX: 20, clientY: 140 })

    for (const key of 'Scope me') {
      fireEvent.keyDown(window, { key })
    }

    const titleInput = await screen.findByPlaceholderText(TITLE_PLACEHOLDER) as HTMLInputElement
    expect(titleInput).toHaveValue('Scope me')
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true })

    expect(document.activeElement).toBe(titleInput)
    expect(titleInput.selectionStart).toBe(0)
    expect(titleInput.selectionEnd).toBe(titleInput.value.length)
  })

  it('renders a pasted time item immediately even if the create response omits manual source metadata', async () => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    const sourceStart = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 12, 0, 0)).toISOString()
    const sourceEnd = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 13, 0, 0)).toISOString()
    const pastedStart = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 15, 0, 0)).toISOString()
    const pastedEnd = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 16, 0, 0)).toISOString()

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') return { data: { sources: [] } }
      if (url === '/api/time-management/modes') {
        return {
          data: {
            activeModeId: 'mode-main',
            modes: [
              {
                id: 'mode-main',
                name: 'Main',
                main_color: '#2563eb',
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
      if (url === '/api/time-management/categories') return { data: { categories: [] } }
      if (url === '/api/user-events') {
        return {
          data: {
            events: [
              {
                id: 'event-1',
                title: 'Copied item title',
                description: 'Copied notes',
                meeting_link: null,
                location: null,
                start_time: sourceStart,
                end_time: sourceEnd,
                source_type: 'manual',
                source_id: 'mode-main',
                category_ids: [],
                recurrence_rule: { type: 'none' },
              },
            ],
          },
        }
      }
      return { data: {} }
    })

    vi.mocked(apiClient.post).mockResolvedValueOnce({
      data: {
        event: {
          id: 'event-2',
          title: 'Copied item title',
          description: 'Copied notes',
          meeting_link: null,
          location: null,
          start_time: pastedStart,
          end_time: pastedEnd,
          source_id: 'mode-main',
          category_ids: [],
        },
      },
    })

    const { container } = render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    await waitFor(() => {
      expect(screen.getAllByText('Copied item title').length).toBeGreaterThan(0)
    })
    const initialTitleCount = screen.getAllByText('Copied item title').length

    const firstDayColumn = container.querySelector("div[style*='repeating-linear-gradient']") as HTMLDivElement | null
    expect(firstDayColumn).toBeTruthy()
    if (!firstDayColumn) return

    vi.spyOn(firstDayColumn, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 600,
      width: 100,
      height: 600,
      toJSON: () => ({}),
    })

    fireEvent.click(screen.getAllByText('Copied item title')[0])
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true })
    fireEvent.mouseDown(firstDayColumn, { button: 0, clientX: 20, clientY: 320 })
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true })

    await waitFor(() => {
      expect(screen.getAllByText('Copied item title').length).toBeGreaterThan(initialTitleCount)
    })
  })

  it.each([
    { bulkKey: 'c', bulkStatus: 'Copied', copyMethod: 'keyboard' },
    { bulkKey: 'c', bulkStatus: 'Copied', copyMethod: 'context menu' },
    { bulkKey: 'x', bulkStatus: 'Cut', copyMethod: 'keyboard' },
    { bulkKey: 'x', bulkStatus: 'Cut', copyMethod: 'context menu' },
  ])('replaces $bulkStatus multiselection with a single-item copy via $copyMethod', async ({ bulkKey, copyMethod }) => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    const sourceEvents = ['First bulk item', 'Second bulk item', 'Latest single item'].map((title, index) => ({
      id: `clipboard-source-${index}`,
      title,
      description: `Notes for ${title}`,
      meeting_link: null,
      location: null,
      start_time: new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 9 + index, 0, 0)).toISOString(),
      end_time: new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 10 + index, 0, 0)).toISOString(),
      source_type: 'manual',
      source_id: 'mode-main',
      category_ids: [],
      recurrence_rule: { type: 'none' },
    }))
    const defaultGet = mockDedupedGet.getMockImplementation()
    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/user-events') return { data: { events: sourceEvents } }
      return defaultGet?.(url)
    })
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { event: { ...sourceEvents[2], id: 'latest-single-paste' } },
    })

    const { container } = render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findAllByText('Latest single item')
    fireEvent.click(screen.getAllByText('First bulk item')[0], { ctrlKey: true })
    fireEvent.click(screen.getAllByText('Second bulk item')[0], { ctrlKey: true })
    expect(container.querySelectorAll('[data-multi-selected="true"]').length).toBeGreaterThanOrEqual(2)
    fireEvent.contextMenu(screen.getAllByText('First bulk item')[0], { clientX: 20, clientY: 140 })
    expect(screen.getByText('Multi-select (2 items)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: bulkKey === 'c' ? 'Copy Selected' : 'Cut Selected' }))

    if (copyMethod === 'keyboard') {
      fireEvent.click(screen.getAllByText('Latest single item')[0])
      fireEvent.keyDown(window, { key: 'c', ctrlKey: true })
    } else {
      fireEvent.contextMenu(screen.getAllByText('Latest single item')[0], { clientX: 20, clientY: 140 })
      fireEvent.click(screen.getByRole('menuitem', { name: /Copy Item/ }))
    }
    const firstDayColumn = container.querySelector("div[style*='repeating-linear-gradient']") as HTMLDivElement
    expect(firstDayColumn).toBeTruthy()
    vi.spyOn(firstDayColumn, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 600,
      width: 100,
      height: 600,
      toJSON: () => ({}),
    })
    vi.mocked(apiClient.post).mockClear()
    fireEvent.mouseDown(firstDayColumn, { button: 0, clientX: 20, clientY: 320 })
    expect(screen.queryByText(/Paste Multi-select/)).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true })

    await waitFor(() => {
      const pasteCalls = vi.mocked(apiClient.post).mock.calls.filter(([url]) => url === '/api/user-events')
      expect(pasteCalls).toHaveLength(1)
      expect(pasteCalls[0][1]).toEqual(expect.objectContaining({
        title: 'Latest single item',
        description: 'Notes for Latest single item',
      }))
    })
    expect(apiClient.delete).not.toHaveBeenCalled()
  })

  it('keeps pasted category edits made before save response resolves', async () => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    const sourceStart = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 12, 0, 0)).toISOString()
    const sourceEnd = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 13, 0, 0)).toISOString()
    const pastedStart = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 15, 0, 0)).toISOString()
    const pastedEnd = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 16, 0, 0)).toISOString()

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') return { data: { sources: [] } }
      if (url === '/api/time-management/modes') {
        return {
          data: {
            activeModeId: 'mode-main',
            modes: [
              {
                id: 'mode-main',
                name: 'Main',
                main_color: '#2563eb',
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
        return {
          data: {
            categories: [
              {
                id: 'cat-focus',
                label: 'Focus',
                color: '#16a34a',
                font_color: '#ffffff',
                background_opacity: 1,
                item_opacity: 1,
                source_id: 'mode-main',
              },
            ],
          },
        }
      }
      if (url === '/api/user-events') {
        return {
          data: {
            events: [
              {
                id: 'event-source',
                title: 'Copied item title',
                description: 'Copied notes',
                meeting_link: null,
                location: null,
                start_time: sourceStart,
                end_time: sourceEnd,
                source_type: 'manual',
                source_id: 'mode-main',
                category_ids: [],
                recurrence_rule: { type: 'none' },
              },
            ],
          },
        }
      }
      return { data: {} }
    })

    const createResolver: { current: ((value: unknown) => void) | null } = { current: null }
    vi.mocked(apiClient.post).mockReturnValueOnce(new Promise((resolve) => {
      createResolver.current = resolve
    }) as unknown as ReturnType<typeof apiClient.post>)

    const { container } = render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    const firstDayColumn = container.querySelector("div[style*='repeating-linear-gradient']") as HTMLDivElement | null
    expect(firstDayColumn).toBeTruthy()
    if (!firstDayColumn) return

    vi.spyOn(firstDayColumn, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 600,
      width: 100,
      height: 600,
      toJSON: () => ({}),
    })

    fireEvent.click(screen.getAllByText('Copied item title')[0])
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true })
    fireEvent.mouseDown(firstDayColumn, { button: 0, clientX: 20, clientY: 320 })
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true })

    const categoryButton = await screen.findByRole('button', { name: 'Focus' })
    fireEvent.click(categoryButton)

    await waitFor(() => {
      expect(categoryButton).toHaveStyle({ backgroundColor: '#16a34a' })
    })

    expect(createResolver.current).not.toBeNull()
    if (!createResolver.current) {
      throw new Error('Expected create resolver to be assigned.')
    }

    createResolver.current({
      data: {
        event: {
          id: 'event-pasted',
          title: 'Copied item title',
          description: 'Copied notes',
          meeting_link: null,
          location: null,
          start_time: pastedStart,
          end_time: pastedEnd,
          source_id: 'mode-main',
          category_ids: [],
        },
      },
    })

    await waitFor(() => {
      expect(categoryButton).toHaveStyle({ backgroundColor: '#16a34a' })
    })
  })

  it('keeps a pasted item move made before the create response resolves', async () => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    const sourceStart = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 12, 0, 0)).toISOString()
    const sourceEnd = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 13, 0, 0)).toISOString()
    const pastedStart = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 15, 0, 0)).toISOString()
    const pastedEnd = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 16, 0, 0)).toISOString()

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') return { data: { sources: [] } }
      if (url === '/api/time-management/modes') {
        return {
          data: {
            activeModeId: 'mode-main',
            modes: [
              {
                id: 'mode-main',
                name: 'Main',
                main_color: '#2563eb',
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
      if (url === '/api/time-management/categories') return { data: { categories: [] } }
      if (url === '/api/user-events') {
        return {
          data: {
            events: [
              {
                id: 'event-source',
                title: 'Copy then move me',
                description: 'Copied notes',
                meeting_link: null,
                location: null,
                start_time: sourceStart,
                end_time: sourceEnd,
                source_type: 'manual',
                source_id: 'mode-main',
                category_ids: [],
                recurrence_rule: { type: 'none' },
              },
            ],
          },
        }
      }
      return { data: {} }
    })

    const createResolver: { current: ((value: unknown) => void) | null } = { current: null }
    vi.mocked(apiClient.post).mockReturnValueOnce(new Promise((resolve) => {
      createResolver.current = resolve
    }) as unknown as ReturnType<typeof apiClient.post>)
    vi.mocked(apiClient.put).mockResolvedValue({ data: {} })

    const { container } = render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    const targetColumn = container.querySelector("div[style*='repeating-linear-gradient']") as HTMLDivElement | null
    expect(targetColumn).toBeTruthy()
    if (!targetColumn) return

    vi.spyOn(targetColumn, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 600,
      width: 100,
      height: 600,
      toJSON: () => ({}),
    })

    fireEvent.click(screen.getAllByText('Copy then move me')[0])
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true })
    fireEvent.mouseDown(targetColumn, { button: 0, clientX: 20, clientY: 320 })
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true })

    const pendingItem = await waitFor(() => {
      const selected = container.querySelector<HTMLDivElement>(
        '[data-time-management-item="true"][data-selected="true"]'
      )
      expect(selected).toBeTruthy()
      return selected as HTMLDivElement
    })

    vi.spyOn(pendingItem, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 300,
      left: 0,
      top: 300,
      right: 100,
      bottom: 340,
      width: 100,
      height: 40,
      toJSON: () => ({}),
    })
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [targetColumn]),
    })

    fireEvent.pointerDown(pendingItem, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 50, clientY: 320 })
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 20, clientY: 450 })
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: 20, clientY: 450 })

    expect(apiClient.put).not.toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/user-events\/pending-/),
      expect.anything()
    )

    expect(createResolver.current).not.toBeNull()
    if (!createResolver.current) throw new Error('Expected create resolver to be assigned.')
    createResolver.current({
      data: {
        event: {
          id: 'event-pasted',
          title: 'Copy then move me',
          description: 'Copied notes',
          meeting_link: null,
          location: null,
          start_time: pastedStart,
          end_time: pastedEnd,
          source_id: 'mode-main',
          category_ids: [],
        },
      },
    })

    await waitFor(() => {
      expect(apiClient.put).toHaveBeenCalledWith(
        '/api/user-events/event-pasted',
        expect.objectContaining({
          start_time: expect.not.stringMatching(pastedStart),
          end_time: expect.not.stringMatching(pastedEnd),
        })
      )
    })
  })

  it('keeps a newly created item move made before the create response resolves', async () => {
    const createResolver: { current: ((value: unknown) => void) | null } = { current: null }
    vi.mocked(apiClient.post).mockReturnValueOnce(new Promise((resolve) => {
      createResolver.current = resolve
    }) as unknown as ReturnType<typeof apiClient.post>)
    vi.mocked(apiClient.put).mockResolvedValue({ data: {} })

    const { container } = render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    fireEvent.click(screen.getByRole('button', { name: 'Create Time Item' }))

    const titleInput = await screen.findByPlaceholderText(TITLE_PLACEHOLDER)
    fireEvent.change(titleInput, { target: { value: 'Drag me before create resolves' } })

    const firstDayColumn = container.querySelector("div[style*='repeating-linear-gradient']") as HTMLDivElement | null
    expect(firstDayColumn).toBeTruthy()
    if (!firstDayColumn) return

    vi.spyOn(firstDayColumn, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 600,
      width: 100,
      height: 600,
      toJSON: () => ({}),
    })

    fireEvent.mouseDown(firstDayColumn, { button: 0, clientX: 20, clientY: 140 })
    fireEvent.click(await screen.findByRole('button', { name: 'Save Item' }))

    expect(apiClient.post).toHaveBeenCalled()

    const pendingItem = await waitFor(() => {
      const created = container.querySelector<HTMLDivElement>(
        '[data-time-management-item="true"][data-testid^="pending-"]'
      ) || container.querySelector<HTMLDivElement>(
        '[data-time-management-item="true"][data-selected="true"]'
      )
      expect(created).toBeTruthy()
      return created as HTMLDivElement
    })

    vi.spyOn(pendingItem, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 140,
      left: 0,
      top: 140,
      right: 100,
      bottom: 180,
      width: 100,
      height: 40,
      toJSON: () => ({}),
    })
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [firstDayColumn]),
    })

    fireEvent.pointerDown(pendingItem, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 50, clientY: 150 })
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 20, clientY: 460 })
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: 20, clientY: 460 })

    expect(apiClient.put).not.toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/user-events\/pending-/),
      expect.anything()
    )

    const originalCreatedStart = new Date().toISOString()
    const originalCreatedEnd = new Date(Date.now() + 30 * 60_000).toISOString()

    expect(createResolver.current).not.toBeNull()
    if (!createResolver.current) throw new Error('Expected create resolver to be assigned.')
    createResolver.current({
      data: {
        event: {
          id: 'event-created',
          title: 'Drag me before create resolves',
          description: '',
          meeting_link: null,
          location: null,
          start_time: originalCreatedStart,
          end_time: originalCreatedEnd,
          source_id: 'mode-main',
          category_ids: [],
        },
      },
    })

    await waitFor(() => {
      expect(apiClient.put).toHaveBeenCalledWith(
        '/api/user-events/event-created',
        expect.objectContaining({
          start_time: expect.not.stringMatching(originalCreatedStart),
          end_time: expect.not.stringMatching(originalCreatedEnd),
        })
      )
    })
  })

  it('keeps a pasted item visible after a stale refresh resolves', async () => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    const sourceStart = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 12, 0, 0)).toISOString()
    const sourceEnd = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 13, 0, 0)).toISOString()
    const pastedStart = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 15, 0, 0)).toISOString()
    const pastedEnd = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 16, 0, 0)).toISOString()

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') return { data: { sources: [] } }
      if (url === '/api/time-management/modes') {
        return {
          data: {
            activeModeId: 'mode-main',
            modes: [
              {
                id: 'mode-main',
                name: 'Main',
                main_color: '#2563eb',
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
      if (url === '/api/time-management/categories') return { data: { categories: [] } }
      if (url === '/api/user-events') {
        return {
          data: {
            events: [
              {
                id: 'event-1',
                title: 'Copied item title',
                description: 'Copied notes',
                meeting_link: null,
                location: null,
                start_time: sourceStart,
                end_time: sourceEnd,
                source_type: 'manual',
                source_id: 'mode-main',
                category_ids: [],
                recurrence_rule: { type: 'none' },
              },
            ],
          },
        }
      }
      return { data: {} }
    })

    vi.mocked(apiClient.post).mockResolvedValueOnce({
      data: {
        event: {
          id: 'event-2',
          title: 'Copied item title',
          description: 'Copied notes',
          meeting_link: null,
          location: null,
          start_time: pastedStart,
          end_time: pastedEnd,
          source_id: 'mode-main',
          category_ids: [],
        },
      },
    })

    const { container } = render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    await waitFor(() => {
      expect(screen.getAllByText('Copied item title').length).toBeGreaterThan(0)
    })
    const initialTitleCount = screen.getAllByText('Copied item title').length

    const firstDayColumn = container.querySelector("div[style*='repeating-linear-gradient']") as HTMLDivElement | null
    expect(firstDayColumn).toBeTruthy()
    if (!firstDayColumn) return

    vi.spyOn(firstDayColumn, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 600,
      width: 100,
      height: 600,
      toJSON: () => ({}),
    })

    fireEvent.click(screen.getAllByText('Copied item title')[0])
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true })
    fireEvent.mouseDown(firstDayColumn, { button: 0, clientX: 20, clientY: 320 })
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true })

    await waitFor(() => {
      expect(screen.getAllByText('Copied item title').length).toBeGreaterThan(initialTitleCount)
    })

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await new Promise((resolve) => window.setTimeout(resolve, 260))
    })

    await waitFor(() => {
      expect(screen.getAllByText('Copied item title').length).toBeGreaterThan(initialTitleCount)
    })
  })

  it('appends location to original description when copying from source item', async () => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    const sourceStart = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 12, 0, 0)).toISOString()
    const sourceEnd = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 13, 0, 0)).toISOString()
    const pastedStart = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 15, 0, 0)).toISOString()
    const pastedEnd = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 16, 0, 0)).toISOString()

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') return { data: { sources: [] } }
      if (url === '/api/time-management/modes') {
        return {
          data: {
            activeModeId: 'mode-main',
            modes: [
              {
                id: 'mode-main',
                name: 'Main',
                main_color: '#2563eb',
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
      if (url === '/api/time-management/categories') return { data: { categories: [] } }
      if (url === '/api/user-events') {
        return {
          data: {
            events: [
              {
                id: 'event-source-location',
                title: 'Copied item title',
                description: 'Copied notes',
                meeting_link: null,
                location: 'Room Atlas',
                start_time: sourceStart,
                end_time: sourceEnd,
                source_type: 'google_oauth',
                source_id: 'coord-main',
                category_ids: [],
                recurrence_rule: { type: 'none' },
              },
            ],
          },
        }
      }
      return { data: {} }
    })

    vi.mocked(apiClient.post).mockResolvedValueOnce({
      data: {
        event: {
          id: 'event-pasted-location',
          title: 'Copied item title',
          description: 'Copied notes\n\nLocation: Room Atlas',
          meeting_link: null,
          location: 'Room Atlas',
          start_time: pastedStart,
          end_time: pastedEnd,
          source_id: 'mode-main',
          category_ids: [],
        },
      },
    })

    const { container } = render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    const firstDayColumn = container.querySelector("div[style*='repeating-linear-gradient']") as HTMLDivElement | null
    expect(firstDayColumn).toBeTruthy()
    if (!firstDayColumn) return

    vi.spyOn(firstDayColumn, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 600,
      width: 100,
      height: 600,
      toJSON: () => ({}),
    })

    fireEvent.click(screen.getAllByText('Copied item title')[0])
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true })
    fireEvent.mouseDown(firstDayColumn, { button: 0, clientX: 20, clientY: 320 })
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true })

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/user-events',
        expect.objectContaining({
          description: 'Copied notes\n\nLocation: Room Atlas',
          location: 'Room Atlas',
        })
      )
    })
  })

  it('copies a manual time item description exactly as saved', async () => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    const sourceStart = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 12, 0, 0)).toISOString()
    const sourceEnd = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 13, 0, 0)).toISOString()
    const pastedStart = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 15, 0, 0)).toISOString()
    const pastedEnd = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 16, 0, 0)).toISOString()

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') return { data: { sources: [] } }
      if (url === '/api/time-management/modes') {
        return {
          data: {
            activeModeId: 'mode-main',
            modes: [
              {
                id: 'mode-main',
                name: 'Main',
                main_color: '#2563eb',
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
      if (url === '/api/time-management/categories') return { data: { categories: [] } }
      if (url === '/api/user-events') {
        return {
          data: {
            events: [
              {
                id: 'event-manual-copy',
                title: 'Copied item title',
                description: 'Copied notes\n\nLocation: Room Atlas',
                meeting_link: null,
                location: 'Room Atlas',
                start_time: sourceStart,
                end_time: sourceEnd,
                source_type: 'manual',
                source_id: 'mode-main',
                category_ids: [],
                recurrence_rule: { type: 'none' },
              },
            ],
          },
        }
      }
      return { data: {} }
    })

    vi.mocked(apiClient.post).mockResolvedValueOnce({
      data: {
        event: {
          id: 'event-recopy-location',
          title: 'Copied item title',
          description: 'Copied notes',
          meeting_link: null,
          location: 'Room Atlas',
          start_time: pastedStart,
          end_time: pastedEnd,
          source_id: 'mode-main',
          category_ids: [],
        },
      },
    })

    const { container } = render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    const firstDayColumn = container.querySelector("div[style*='repeating-linear-gradient']") as HTMLDivElement | null
    expect(firstDayColumn).toBeTruthy()
    if (!firstDayColumn) return

    vi.spyOn(firstDayColumn, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 600,
      width: 100,
      height: 600,
      toJSON: () => ({}),
    })

    fireEvent.click(screen.getAllByText('Copied item title')[0])
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true })
    fireEvent.mouseDown(firstDayColumn, { button: 0, clientX: 20, clientY: 320 })
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true })

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/user-events',
        expect.objectContaining({
          description: 'Copied notes\n\nLocation: Room Atlas',
          location: 'Room Atlas',
        })
      )
    })
  })

  it.each(['google_oauth', 'manual'])('preserves hybrid address details and uses the online location for %s items', async (sourceType) => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    const sourceStart = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 12, 0, 0)).toISOString()
    const sourceEnd = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 13, 0, 0)).toISOString()
    const sourceEvent = {
      id: 'event-source-readonly',
      title: 'Source event with location',
      description: 'Prep checklist\n\nLocation: Room Atlas',
      meeting_link: 'https://meet.example.com/room-atlas',
      location: 'https://meet.example.com/room-atlas',
      start_time: sourceStart,
      end_time: sourceEnd,
      source_type: sourceType,
      source_id: sourceType === 'manual' ? 'mode-main' : 'google-src-1',
      category_ids: [],
      recurrence_rule: { type: 'none' },
    }

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') {
        return {
          data: {
            sources: [
              {
                id: 'google-src-1',
                display_name: 'Team Google Calendar',
                color: '#34d399',
                is_active: true,
                source_type: 'google_oauth',
                google_email: 'team@example.com',
                public_url: null,
              },
            ],
          },
        }
      }
      if (url === '/api/time-management/modes') {
        return {
          data: {
            activeModeId: 'mode-main',
            modes: [
              {
                id: 'mode-main',
                name: 'Main',
                main_color: '#2563eb',
                slot_minutes: 30,
                sync_calendars: [
                  {
                    id: 'google-src-1',
                    name: 'Team Google Calendar',
                    color: '#34d399',
                    enabled: true,
                    sourceType: 'external',
                    externalKind: 'google_oauth',
                    secondaryLabel: 'team@example.com',
                  },
                ],
                time_backgrounds: [],
                collapsed_background_ids: [],
                quick_templates: [],
                show_quick_templates_in_main: false,
              },
            ],
          },
        }
      }
      if (url === '/api/time-management/categories') return { data: { categories: [] } }
      if (url === '/api/user-events') {
        return {
          data: {
            events: [sourceEvent],
          },
        }
      }
      return { data: {} }
    })

    vi.mocked(apiClient.get).mockResolvedValue({ data: { events: [sourceEvent] } })
    vi.mocked(apiClient.put).mockResolvedValue({ data: {} })

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    fireEvent.click((await screen.findAllByText('Source event with location'))[0])

    await screen.findByText(/Location: Room Atlas/i)
    if (sourceType === 'google_oauth') {
      await screen.findByRole('link', { name: 'https://meet.example.com/room-atlas' })
      return
    }

    const locationInput = await screen.findByPlaceholderText('Add a location or meeting link')
    expect(locationInput).toHaveValue('https://meet.example.com/room-atlas')
    fireEvent.change(locationInput, { target: { value: 'https://meet.example.com/new-room' } })
    fireEvent.click(screen.getByTestId('left-sidebar-update-button'))
    await waitFor(() => {
      expect(apiClient.put).toHaveBeenCalledWith('/api/user-events/event-source-readonly', expect.objectContaining({
        location: 'https://meet.example.com/new-room',
        meeting_link: 'https://meet.example.com/new-room',
        description: expect.stringContaining('Location: Room Atlas'),
      }))
    })

    fireEvent.change(locationInput, { target: { value: '' } })
  fireEvent.click(screen.getByTestId('left-sidebar-update-button'))
    await waitFor(() => {
      expect(apiClient.put).toHaveBeenCalledWith('/api/user-events/event-source-readonly', expect.objectContaining({
        location: null,
        meeting_link: null,
        description: expect.stringContaining('Location: Room Atlas'),
      }))
    })
  })

  it('allows traveler accounts to save time items without login redirect', async () => {
    mockUseAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      isTraveler: true,
    })
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      data: {
        event: {
          id: 'evt-traveler',
          title: 'Traveler save item',
          description: '',
          meeting_link: null,
          location: null,
          start_time: new Date().toISOString(),
          end_time: new Date().toISOString(),
          source_id: 'mode-main',
          category_ids: [],
        },
      },
    })

    const { container } = render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    fireEvent.click(screen.getByRole('button', { name: 'Create Time Item' }))

    const titleInput = await screen.findByPlaceholderText(TITLE_PLACEHOLDER)
    fireEvent.change(titleInput, { target: { value: 'Traveler save item' } })

    const firstDayColumn = container.querySelector("div[style*='repeating-linear-gradient']") as HTMLDivElement | null
    expect(firstDayColumn).toBeTruthy()
    if (!firstDayColumn) return

    vi.spyOn(firstDayColumn, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 600,
      width: 100,
      height: 600,
      toJSON: () => ({}),
    })

    fireEvent.mouseDown(firstDayColumn, { button: 0, clientX: 20, clientY: 140 })
    fireEvent.click(await screen.findByRole('button', { name: 'Save Item' }))

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalled()
    })
    // Pending-save/login-redirect was removed; travelers save directly with no return path stored.
    expect(sessionStorage.getItem('authReturnTo')).toBeNull()
  })

  it('applies a quick object without auto-opening full view and still allows opening it manually', async () => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    const createdStart = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 7, 0, 0)).toISOString()
    const createdEnd = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 7, 30, 0)).toISOString()

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') return { data: { sources: [] } }
      if (url === '/api/time-management/modes') {
        return {
          data: {
            activeModeId: 'mode-main',
            modes: [
              {
                id: 'mode-main',
                name: 'Main',
                main_color: '#2563eb',
                slot_minutes: 30,
                sync_calendars: [],
                time_backgrounds: [],
                collapsed_background_ids: [],
                quick_templates: [
                  {
                    id: 'tpl-quick-1',
                    quickName: 'Standup',
                    title: 'Daily standup',
                    notes: 'Team sync',
                    categoryIds: [],
                    sourceItemId: 'seed-item',
                    createdAt: new Date().toISOString(),
                  },
                ],
                show_quick_templates_in_main: true,
              },
            ],
          },
        }
      }
      if (url === '/api/time-management/categories') return { data: { categories: [] } }
      if (url === '/api/user-events') return { data: { events: [] } }
      return { data: {} }
    })

    vi.mocked(apiClient.post).mockResolvedValueOnce({
      data: {
        event: {
          id: 'evt-from-template',
          title: 'Daily standup',
          description: 'Team sync',
          meeting_link: null,
          location: null,
          start_time: createdStart,
          end_time: createdEnd,
          source_type: 'manual',
          source_id: 'mode-main',
          category_ids: [],
        },
      },
    })
    vi.mocked(apiClient.put).mockResolvedValue({
      data: {
        mode: {
          id: 'mode-main',
          name: 'Main',
          main_color: '#2563eb',
          slot_minutes: 30,
          sync_calendars: [],
          time_backgrounds: [],
          collapsed_background_ids: [],
          quick_templates: [
            {
              id: 'tpl-quick-1',
              quickName: 'Standup',
              title: 'Daily standup',
              notes: 'Team sync',
              categoryIds: [],
              sourceItemId: 'seed-item',
              createdAt: new Date().toISOString(),
            },
          ],
          show_quick_templates_in_main: true,
        },
      },
    })

    const { container } = render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })

    const firstDayColumn = container.querySelector("div[style*='repeating-linear-gradient']") as HTMLDivElement | null
    expect(firstDayColumn).toBeTruthy()
    if (!firstDayColumn) return

    vi.spyOn(firstDayColumn, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 600,
      width: 100,
      height: 600,
      toJSON: () => ({}),
    })

    fireEvent.mouseDown(firstDayColumn, { button: 0, clientX: 20, clientY: 140 })
    fireEvent.click(await screen.findByRole('button', { name: 'Apply Template' }))

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/api/user-events', expect.anything())
    })

    await screen.findByDisplayValue('Daily standup')

    expect(screen.queryByText('Use the full view to draft long notes, templates, and checklists.')).not.toBeInTheDocument()

    const selectedFullViewButton = await screen.findByTitle('Open full view editor')
    expect(selectedFullViewButton).toBeInTheDocument()

    fireEvent.click(selectedFullViewButton)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Daily standup')).toHaveLength(2)
    })
  })

  it('does not flicker away a quick object created while an unrelated cross-tab delete triggers an authoritative refetch', async () => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    const createdStart = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 7, 0, 0)).toISOString()
    const createdEnd = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 7, 30, 0)).toISOString()

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') return { data: { sources: [] } }
      if (url === '/api/time-management/modes') {
        return {
          data: {
            activeModeId: 'mode-main',
            modes: [
              {
                id: 'mode-main',
                name: 'Main',
                main_color: '#2563eb',
                slot_minutes: 30,
                sync_calendars: [],
                time_backgrounds: [],
                collapsed_background_ids: [],
                quick_templates: [
                  {
                    id: 'tpl-quick-1',
                    quickName: 'Standup',
                    title: 'Daily standup',
                    notes: 'Team sync',
                    categoryIds: [],
                    sourceItemId: 'seed-item',
                    createdAt: new Date().toISOString(),
                  },
                ],
                show_quick_templates_in_main: true,
              },
            ],
          },
        }
      }
      if (url === '/api/time-management/categories') return { data: { categories: [] } }
      // Reflects the server state during the in-flight create -- another tab's
      // deletion has already been reconciled here, but this row has not landed yet.
      if (url === '/api/user-events') return { data: { events: [] } }
      return { data: {} }
    })

    const createResolver: { current: ((value: unknown) => void) | null } = { current: null }
    vi.mocked(apiClient.post).mockReturnValueOnce(new Promise((resolve) => {
      createResolver.current = resolve
    }) as unknown as ReturnType<typeof apiClient.post>)

    const { container } = render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })

    const firstDayColumn = container.querySelector("div[style*='repeating-linear-gradient']") as HTMLDivElement | null
    expect(firstDayColumn).toBeTruthy()
    if (!firstDayColumn) return

    vi.spyOn(firstDayColumn, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 600,
      width: 100,
      height: 600,
      toJSON: () => ({}),
    })

    fireEvent.mouseDown(firstDayColumn, { button: 0, clientX: 20, clientY: 140 })
    fireEvent.click(await screen.findByRole('button', { name: 'Apply Template' }))

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/api/user-events', expect.anything())
    })
    const getTitleInputValue = () =>
      (container.querySelector('input[placeholder="Type Title for Time Item"]') as HTMLInputElement | null)?.value
    // The optimistic pending item is titled from the template's quick name,
    // not `template.title` -- the server-echoed title only replaces it once
    // the create POST resolves below.
    expect(getTitleInputValue()).toBe('Standup')

    // Simulate a delete committed in another tab -- this forces the cross-tab
    // listener's refetch to be authoritative (may reconcile removals) even
    // though it has nothing to do with the item currently being created here.
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'coord-time-management-sync-ping',
        newValue: JSON.stringify({
          type: 'time-management-updated',
          reason: 'event-deleted',
          tabId: 'another-tab',
          updatedAt: Date.now(),
        }),
      }))
      await new Promise((resolve) => window.setTimeout(resolve, 260))
    })

    // The pending quick-object item must survive the authoritative refetch --
    // it should never flicker away while its own create request is in flight.
    expect(getTitleInputValue()).toBe('Standup')

    expect(createResolver.current).not.toBeNull()
    if (!createResolver.current) throw new Error('Expected create resolver to be assigned.')
    await act(async () => {
      createResolver.current?.({
        data: {
          event: {
            id: 'evt-from-template',
            title: 'Daily standup',
            description: 'Team sync',
            meeting_link: null,
            location: null,
            start_time: createdStart,
            end_time: createdEnd,
            source_type: 'manual',
            source_id: 'mode-main',
            category_ids: [],
          },
        },
      })
    })

    expect(screen.getByDisplayValue('Daily standup')).toBeInTheDocument()
  })

  it('keeps quick objects collapsed while typing after applying a non-autosave template', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      data: {
        event: {
          id: 'evt-enter-save',
          title: 'Kickoff planning more',
          description: 'Initial brief',
          meeting_link: null,
          location: null,
          start_time: new Date().toISOString(),
          end_time: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          source_type: 'manual',
          source_id: 'mode-main',
          category_ids: [],
        },
      },
    })

    localStorage.setItem(
      'time-management-v1',
      JSON.stringify({
        showQuickTemplatesInMain: true,
        quickTemplatesMainExpanded: false,
      })
    )

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') return { data: { sources: [] } }
      if (url === '/api/time-management/modes') {
        return {
          data: {
            activeModeId: 'mode-main',
            modes: [
              {
                id: 'mode-main',
                name: 'Main',
                main_color: '#2563eb',
                slot_minutes: 30,
                sync_calendars: [],
                time_backgrounds: [],
                collapsed_background_ids: [],
                quick_templates: [
                  {
                    id: 'tpl-non-auto',
                    quickName: 'Kickoff',
                    title: 'Kickoff planning',
                    notes: 'Initial brief',
                    categoryIds: [],
                    autoSaveEnabled: false,
                    sourceItemId: 'seed-item',
                    createdAt: new Date().toISOString(),
                  },
                ],
                show_quick_templates_in_main: true,
              },
            ],
          },
        }
      }
      if (url === '/api/time-management/categories') return { data: { categories: [] } }
      if (url === '/api/user-events') return { data: { events: [] } }
      return { data: {} }
    })

    const { container } = render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })

    const firstDayColumn = container.querySelector("div[style*='repeating-linear-gradient']") as HTMLDivElement | null
    expect(firstDayColumn).toBeTruthy()
    if (!firstDayColumn) return

    vi.spyOn(firstDayColumn, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 600,
      width: 100,
      height: 600,
      toJSON: () => ({}),
    })

    fireEvent.mouseDown(firstDayColumn, { button: 0, clientX: 20, clientY: 140 })

    fireEvent.click(await screen.findByRole('button', { name: 'Kickoff' }))

    const titleInput = await screen.findByPlaceholderText(TITLE_PLACEHOLDER)
    await waitFor(() => {
      expect(titleInput).toHaveValue('Kickoff')
      expect(document.activeElement).toBe(titleInput)
    })

    expect(screen.queryByText('Template cards for quickly filling Purpose, Notes, and Category Tags.')).not.toBeInTheDocument()

    fireEvent.keyDown(titleInput, { key: ' ', code: 'Space' })

    expect(screen.queryByText('Template cards for quickly filling Purpose, Notes, and Category Tags.')).not.toBeInTheDocument()

    fireEvent.change(titleInput, { target: { value: 'Kickoff planning more' } })
    fireEvent.keyDown(titleInput, { key: 'Enter', code: 'Enter', charCode: 13 })

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/api/user-events', expect.anything())
    })

    expect(screen.queryByText('Template cards for quickly filling Purpose, Notes, and Category Tags.')).not.toBeInTheDocument()
  })

  it('renders the sidepanel editor in compact auto-height mode', async () => {
    const { container } = render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    fireEvent.click(screen.getByRole('button', { name: 'Create Time Item' }))

    const sideEditor = await waitFor(() => container.querySelector('aside .markdown-editor'))
    expect(sideEditor).toBeInTheDocument()
    expect(sideEditor?.className).toContain('min-h-40')
    expect(sideEditor?.className).not.toContain('h-full')
  })

  it('lets users edit item title from full view', async () => {
    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    fireEvent.click(screen.getByRole('button', { name: 'Create Time Item' }))

    const sideTitleInput = await screen.findByPlaceholderText(TITLE_PLACEHOLDER)
    fireEvent.change(sideTitleInput, { target: { value: 'Original title' } })

    fireEvent.click(screen.getByTitle('Open full view editor'))

    const modalTitleInput = await waitFor(() =>
      document.querySelector('div.fixed.inset-0 input[placeholder="Type Title for Time Item"]') as HTMLInputElement | null
    )
    expect(modalTitleInput).toBeTruthy()
    if (!modalTitleInput) return
    fireEvent.change(modalTitleInput, { target: { value: 'Updated in full view' } })

    expect(screen.getAllByDisplayValue('Updated in full view')).toHaveLength(2)
  })

  it('moves focus to description when Enter is pressed in full-view title', async () => {
    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    fireEvent.click(screen.getByTitle('Open full view editor'))

    const modalTitleInput = await waitFor(() =>
      document.querySelector('div.fixed.inset-0 input[placeholder="Type Title for Time Item"]') as HTMLInputElement | null
    )
    expect(modalTitleInput).toBeTruthy()
    if (!modalTitleInput) return

    const modalDescriptionEditor = await waitFor(() =>
      document.querySelector("div.fixed.inset-0 .tiptap[contenteditable='true']") as HTMLDivElement | null
    )
    expect(modalDescriptionEditor).toBeTruthy()
    if (!modalDescriptionEditor) return

    fireEvent.keyDown(modalTitleInput, { key: 'Enter', code: 'Enter', charCode: 13 })

    await waitFor(() => {
      expect(document.activeElement).toBe(modalDescriptionEditor)
    })
  })

  it('closes full view when Escape is pressed', async () => {
    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    fireEvent.click(screen.getByTitle('Open full view editor'))

    await waitFor(() => {
      expect(document.querySelector('div.fixed.inset-0 .markdown-editor')).toBeTruthy()
    })

    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => {
      expect(document.querySelector('div.fixed.inset-0 .markdown-editor')).toBeNull()
    })
  })

  it('only closes full view when backdrop press starts outside the modal shell', async () => {
    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    fireEvent.click(screen.getByTitle('Open full view editor'))

    const modalRoot = await waitFor(() => document.querySelector('div.fixed.inset-0') as HTMLDivElement | null)
    expect(modalRoot).toBeTruthy()
    if (!modalRoot) return

    const modalTitleInput = await waitFor(() =>
      document.querySelector('div.fixed.inset-0 input[placeholder="Type Title for Time Item"]') as HTMLInputElement | null
    )
    expect(modalTitleInput).toBeTruthy()
    if (!modalTitleInput) return

    fireEvent.mouseDown(modalTitleInput, { button: 0 })
    fireEvent.mouseUp(modalRoot, { button: 0 })

    expect(document.querySelector('div.fixed.inset-0 .markdown-editor')).toBeTruthy()

    fireEvent.mouseDown(modalRoot, { button: 0 })
    fireEvent.mouseUp(modalRoot, { button: 0 })

    await waitFor(() => {
      expect(document.querySelector('div.fixed.inset-0 .markdown-editor')).toBeNull()
    })
  })

  it('creates collapse sections expanded by default in full view', async () => {
    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    fireEvent.click(screen.getByTitle('Open full view editor'))

    const collapseButton = await screen.findByRole('button', { name: 'Collapse' })
    fireEvent.click(collapseButton)

    await waitFor(() => {
      const detailsContent = document.querySelector(
        "div.fixed.inset-0 .markdown-editor [data-type='detailsContent']"
      ) as HTMLElement | null
      expect(detailsContent).toBeTruthy()
      expect(detailsContent?.getAttribute('hidden')).toBeNull()
    })
  })

  it('splits highlighted text into summary and content when Collapse button is clicked', async () => {
    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    fireEvent.click(screen.getByTitle('Open full view editor'))

    const editorDom = await waitFor(() => {
      const el = document.querySelector('div.fixed.inset-0 .markdown-editor') as HTMLElement | null
      if (!el) throw new Error('modal editor DOM not mounted')
      return el
    })

    // Paste multi-line text into TipTap
    fireEvent.paste(editorDom, {
      clipboardData: {
        getData: (type: string) =>
          type === 'text/plain'
            ? 'WMT Price Chart:\nhttps://example.com/wmt-chart\nSecond detail line'
            : '',
      },
    })

    await waitFor(() => {
      expect(editorDom.textContent).toContain('WMT Price Chart:')
    })

    // Highlight / select all pasted content in editor DOM
    const range = document.createRange()
    range.selectNodeContents(editorDom)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    fireEvent(document, new Event('selectionchange'))

    const collapseButton = await screen.findByRole('button', { name: 'Collapse' })
    fireEvent.click(collapseButton)

    await waitFor(() => {
      const summary = document.querySelector(
        "div.fixed.inset-0 .markdown-editor summary, div.fixed.inset-0 .markdown-editor [data-type='detailsSummary']"
      )
      expect(summary).toBeTruthy()
      expect(summary?.textContent).toContain('WMT Price Chart:')
      const content = document.querySelector(
        "div.fixed.inset-0 .markdown-editor [data-type='detailsContent']"
      )
      expect(content).toBeTruthy()
      expect(content?.textContent).toContain('https://example.com/wmt-chart')
      expect(content?.textContent).toContain('Second detail line')
    })
  })

  it('keeps single-line text and link together in summary when text with link is collapsed', async () => {
    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    fireEvent.click(screen.getByTitle('Open full view editor'))

    const editorDom = await waitFor(() => {
      const el = document.querySelector('div.fixed.inset-0 .markdown-editor') as HTMLElement | null
      if (!el) throw new Error('modal editor DOM not mounted')
      return el
    })

    // Paste 1-line text with link + 2 detail lines
    fireEvent.paste(editorDom, {
      clipboardData: {
        getData: (type: string) =>
          type === 'text/plain'
            ? 'WMT Price Chart: https://coinmarketcap.com/currencies/world-mobile-token/\n- Staking is yielding ~220 WMT\n- Staking Dashboard: worldmobiletoken.com'
            : '',
      },
    })

    await waitFor(() => {
      expect(editorDom.textContent).toContain('WMT Price Chart:')
    })

    // Select all and collapse
    const range = document.createRange()
    range.selectNodeContents(editorDom)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    fireEvent(document, new Event('selectionchange'))

    const collapseButton = await screen.findByRole('button', { name: 'Collapse' })
    fireEvent.click(collapseButton)

    await waitFor(() => {
      const summary = document.querySelector(
        "div.fixed.inset-0 .markdown-editor summary, div.fixed.inset-0 .markdown-editor [data-type='detailsSummary']"
      )
      expect(summary).toBeTruthy()
      expect(summary?.textContent).toContain('WMT Price Chart: https://coinmarketcap.com/currencies/world-mobile-token/')
      // Ensure the link is also within the summary
      const link = summary?.querySelector('a')
      expect(link).toBeTruthy()
    })
  })

  it('allows clicking links on the first line (title) of a collapse block', async () => {
    const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    fireEvent.click(screen.getByTitle('Open full view editor'))

    const collapseButton = await screen.findByRole('button', { name: 'Collapse' })
    fireEvent.click(collapseButton)

    await waitFor(() => {
      expect(document.querySelector("div.fixed.inset-0 .markdown-editor [data-type='details']")).toBeTruthy()
    })

    const toggleButton = document.querySelector(
      "div.fixed.inset-0 .markdown-editor [data-details-toggle='true']"
    ) as HTMLButtonElement | null
    expect(toggleButton).toBeTruthy()
    if (!toggleButton) return

    const anchor = document.createElement('a')
    anchor.href = 'https://example.com/title-link'
    anchor.textContent = 'https://example.com/title-link'

    const elementsFromPointSpy = vi.spyOn(document, 'elementsFromPoint').mockReturnValue([toggleButton, anchor])

    fireEvent.click(toggleButton, { clientX: 100, clientY: 100 })

    expect(windowOpenSpy).toHaveBeenCalledWith(
      'https://example.com/title-link',
      '_blank',
      'noopener,noreferrer'
    )

    elementsFromPointSpy.mockRestore()
    windowOpenSpy.mockRestore()
  })

  it('opens full view when a time item is double-clicked', async () => {
    localStorage.setItem(
      'time-management-v1',
      JSON.stringify({
        syncCalendars: [
          {
            id: 'coord-main',
            name: 'Coordination Manager Main',
            color: '#2563eb',
            enabled: true,
            sourceType: 'app',
          },
        ],
        slotMinutes: 30,
        timeBackgrounds: [],
        collapsedBackgroundIds: [],
        quickTemplates: [],
        showQuickTemplatesInMain: false,
      })
    )

    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    const start = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 12, 0, 0))
    const end = new Date(start.getTime() + 90 * 60 * 1000)

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') return { data: { sources: [] } }
      if (url === '/api/time-management/modes') {
        return {
          data: {
            activeModeId: 'mode-main',
            modes: [
              {
                id: 'mode-main',
                name: 'Main',
                main_color: '#2563eb',
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
      if (url === '/api/time-management/categories') return { data: { categories: [] } }
      if (url === '/api/user-events') {
        return {
          data: {
            events: [
              {
                id: 'evt-double-click',
                title: 'Double click item',
                description: 'test note',
                meeting_link: null,
                location: null,
                start_time: start.toISOString(),
                end_time: end.toISOString(),
                source_type: 'manual',
                source_id: 'coord-main',
                category_ids: [],
              },
            ],
          },
        }
      }
      return { data: {} }
    })

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    const [itemLabel] = await screen.findAllByText('Double click item')
    fireEvent.doubleClick(itemLabel)

    expect(await screen.findByRole('button', { name: 'Collapse' })).toBeInTheDocument()
  })

  it('closes full view with Escape after opening from item double-click', async () => {
    localStorage.setItem(
      'time-management-v1',
      JSON.stringify({
        syncCalendars: [
          {
            id: 'coord-main',
            name: 'Coordination Manager Main',
            color: '#2563eb',
            enabled: true,
            sourceType: 'app',
          },
        ],
        slotMinutes: 30,
        timeBackgrounds: [],
        collapsedBackgroundIds: [],
        quickTemplates: [],
        showQuickTemplatesInMain: false,
      })
    )

    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    const start = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 12, 0, 0))
    const end = new Date(start.getTime() + 90 * 60 * 1000)

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') return { data: { sources: [] } }
      if (url === '/api/time-management/modes') {
        return {
          data: {
            activeModeId: 'mode-main',
            modes: [
              {
                id: 'mode-main',
                name: 'Main',
                main_color: '#2563eb',
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
      if (url === '/api/time-management/categories') return { data: { categories: [] } }
      if (url === '/api/user-events') {
        return {
          data: {
            events: [
              {
                id: 'evt-double-click-esc',
                title: 'Double click then Esc',
                description: 'test note',
                meeting_link: null,
                location: null,
                start_time: start.toISOString(),
                end_time: end.toISOString(),
                source_type: 'manual',
                source_id: 'coord-main',
                category_ids: [],
              },
            ],
          },
        }
      }
      return { data: {} }
    })

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    const itemLabels = await screen.findAllByText('Double click then Esc')
    fireEvent.doubleClick(itemLabels[0])

    await screen.findByRole('button', { name: 'Collapse' })

    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Collapse' })).not.toBeInTheDocument()
    })
  })

  it('cuts and pastes an item to move it with keyboard shortcuts', async () => {
    localStorage.setItem(
      'time-management-v1',
      JSON.stringify({
        syncCalendars: [
          {
            id: 'coord-main',
            name: 'Coordination Manager Main',
            color: '#2563eb',
            enabled: true,
            sourceType: 'app',
          },
        ],
        slotMinutes: 30,
        timeBackgrounds: [],
        collapsedBackgroundIds: [],
        quickTemplates: [],
        showQuickTemplatesInMain: false,
      })
    )

    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    const start = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 12, 0, 0))
    const end = new Date(start.getTime() + 90 * 60 * 1000)

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') return { data: { sources: [] } }
      if (url === '/api/time-management/modes') {
        return {
          data: {
            activeModeId: 'mode-main',
            modes: [
              {
                id: 'mode-main',
                name: 'Main',
                main_color: '#2563eb',
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
      if (url === '/api/time-management/categories') return { data: { categories: [] } }
      if (url === '/api/user-events') {
        return {
          data: {
            events: [
              {
                id: 'evt-cut-paste',
                title: 'Cut me',
                description: 'Move me with keyboard',
                meeting_link: null,
                location: null,
                start_time: start.toISOString(),
                end_time: end.toISOString(),
                source_type: 'manual',
                source_id: 'coord-main',
                category_ids: [],
              },
            ],
          },
        }
      }
      return { data: {} }
    })

    vi.mocked(apiClient.put).mockResolvedValue({ data: {} })

    const { container } = render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    const matchingItems = await screen.findAllByText('Cut me')
    fireEvent.click(matchingItems[0])

    fireEvent.keyDown(window, { key: 'x', ctrlKey: true })
    await screen.findByText('Move mode active. Select a new date and time, then click Save Item.')

    const firstDayColumn = container.querySelector("div[style*='repeating-linear-gradient']") as HTMLDivElement | null
    expect(firstDayColumn).toBeTruthy()
    if (!firstDayColumn) return

    vi.spyOn(firstDayColumn, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 600,
      width: 100,
      height: 600,
      toJSON: () => ({}),
    })

    fireEvent.mouseDown(firstDayColumn, { button: 0, clientX: 20, clientY: 320 })
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true })

    await waitFor(() => {
      expect(apiClient.put).toHaveBeenCalledWith(
        '/api/user-events/evt-cut-paste',
        expect.objectContaining({
          title: 'Cut me',
          description: 'Move me with keyboard',
          category_ids: [],
        })
      )
    })
  })

  it('moves a cut item to a different week without leaving the original behind', async () => {
    localStorage.setItem(
      'time-management-v1',
      JSON.stringify({
        syncCalendars: [
          {
            id: 'coord-main',
            name: 'Coordination Manager Main',
            color: '#2563eb',
            enabled: true,
            sourceType: 'app',
          },
        ],
        slotMinutes: 30,
        timeBackgrounds: [],
        collapsedBackgroundIds: [],
        quickTemplates: [],
        showQuickTemplatesInMain: false,
      })
    )

    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    const start = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 12, 0, 0))
    const end = new Date(start.getTime() + 90 * 60 * 1000)

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') return { data: { sources: [] } }
      if (url === '/api/time-management/modes') {
        return {
          data: {
            activeModeId: 'mode-main',
            modes: [
              {
                id: 'mode-main',
                name: 'Main',
                main_color: '#2563eb',
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
      if (url === '/api/time-management/categories') return { data: { categories: [] } }
      if (url === '/api/user-events') {
        return {
          data: {
            events: [
              {
                id: 'evt-cut-paste',
                title: 'Cut me',
                description: 'Move me across weeks',
                meeting_link: null,
                location: null,
                start_time: start.toISOString(),
                end_time: end.toISOString(),
                source_type: 'manual',
                source_id: 'coord-main',
                category_ids: [],
              },
            ],
          },
        }
      }
      return { data: {} }
    })

    vi.mocked(apiClient.put).mockResolvedValue({ data: {} })

    const { container } = render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    const matchingItems = await screen.findAllByText('Cut me')
    fireEvent.click(matchingItems[0])

    fireEvent.keyDown(window, { key: 'x', ctrlKey: true })
    await screen.findByText('Move mode active. Select a new date and time, then click Save Item.')

    // Navigate to next week before pasting -- the original item is no longer in
    // the visible week, which previously broke the move and left a duplicate.
    fireEvent.click(screen.getByTitle('Next week'))

    const nextWeekColumn = container.querySelector("div[style*='repeating-linear-gradient']") as HTMLDivElement | null
    expect(nextWeekColumn).toBeTruthy()
    if (!nextWeekColumn) return

    vi.spyOn(nextWeekColumn, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 600,
      width: 100,
      height: 600,
      toJSON: () => ({}),
    })

    fireEvent.mouseDown(nextWeekColumn, { button: 0, clientX: 20, clientY: 320 })
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true })

    // The item must be MOVED (PUT on the existing event), not COPIED (POST a new
    // event), so the original location is cleared.
    await waitFor(() => {
      expect(apiClient.put).toHaveBeenCalledWith(
        '/api/user-events/evt-cut-paste',
        expect.objectContaining({
          title: 'Cut me',
          description: 'Move me across weeks',
          category_ids: [],
        })
      )
    })
    expect(apiClient.post).not.toHaveBeenCalledWith('/api/user-events', expect.anything())
  })

  it('closes the left editor section after deleting the selected item', async () => {
    localStorage.setItem(
      'time-management-v1',
      JSON.stringify({
        syncCalendars: [
          {
            id: 'coord-main',
            name: 'Coordination Manager Main',
            color: '#2563eb',
            enabled: true,
            sourceType: 'app',
          },
        ],
        slotMinutes: 30,
        timeBackgrounds: [],
        collapsedBackgroundIds: [],
        quickTemplates: [],
        showQuickTemplatesInMain: false,
      })
    )

    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    const start = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 12, 0, 0))
    const end = new Date(start.getTime() + 90 * 60 * 1000)

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') return { data: { sources: [] } }
      if (url === '/api/time-management/modes') {
        return {
          data: {
            activeModeId: 'mode-main',
            modes: [
              {
                id: 'mode-main',
                name: 'Main',
                main_color: '#2563eb',
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
      if (url === '/api/time-management/categories') return { data: { categories: [] } }
      if (url === '/api/user-events') {
        return {
          data: {
            events: [
              {
                id: 'evt-delete-selected',
                title: 'Delete selected item',
                description: 'test note',
                meeting_link: null,
                location: null,
                start_time: start.toISOString(),
                end_time: end.toISOString(),
                source_type: 'manual',
                source_id: 'coord-main',
                category_ids: [],
              },
            ],
          },
        }
      }
      return { data: {} }
    })

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    const [deleteTarget] = await screen.findAllByText('Delete selected item')
    fireEvent.click(deleteTarget)

    await screen.findByRole('button', { name: /delete item/i })
    fireEvent.click(screen.getByRole('button', { name: /delete item/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      expect(screen.queryByPlaceholderText(TITLE_PLACEHOLDER)).not.toBeInTheDocument()
    })
  })

  it('does not restore a deleted item from a stale cross-session refresh', async () => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    const start = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 12, 0, 0))
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    const staleEvent = {
      id: 'evt-delete-cross-session',
      title: 'Delete cross-session item',
      description: 'Created in another session',
      meeting_link: null,
      location: null,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      source_type: 'manual',
      source_id: 'coord-main',
      category_ids: [],
    }

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') return { data: { sources: [] } }
      if (url === '/api/time-management/modes') {
        return {
          data: {
            activeModeId: 'mode-main',
            modes: [{
              id: 'mode-main',
              name: 'Main',
              main_color: '#2563eb',
              slot_minutes: 30,
              sync_calendars: [],
              time_backgrounds: [],
              collapsed_background_ids: [],
              quick_templates: [],
              show_quick_templates_in_main: false,
            }],
          },
        }
      }
      if (url === '/api/time-management/categories') return { data: { categories: [] } }
      if (url === '/api/user-events') return { data: { events: [staleEvent] } }
      return { data: {} }
    })

    const deleteResolver: { current: ((value: unknown) => void) | null } = { current: null }
    vi.mocked(apiClient.delete).mockReturnValueOnce(new Promise((resolve) => {
      deleteResolver.current = resolve
    }) as unknown as ReturnType<typeof apiClient.delete>)

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    fireEvent.click((await screen.findAllByText('Delete cross-session item'))[0])
    fireEvent.click(await screen.findByRole('button', { name: /delete item/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      expect(screen.queryByText('Delete cross-session item')).not.toBeInTheDocument()
    })

    window.dispatchEvent(new Event('focus'))
    await new Promise((resolve) => window.setTimeout(resolve, 260))

    expect(screen.queryByText('Delete cross-session item')).not.toBeInTheDocument()

    expect(deleteResolver.current).not.toBeNull()
    await act(async () => {
      deleteResolver.current?.({ data: {} })
    })
  })

  it('reconciles deletions made in a separate browser session when the server revision changes', async () => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    const start = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 12, 0, 0))
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    const event = {
      id: 'evt-server-revision',
      title: 'Removed in another browser',
      description: null,
      meeting_link: null,
      location: null,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      source_type: 'manual' as const,
      source_id: 'coord-main',
      category_ids: [],
      updated_at: '2026-09-23T20:00:00.000Z',
    }
    let serverRevision = '1:2026-09-23T20:00:00.000Z'

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') return { data: { sources: [] } }
      if (url === '/api/time-management/modes') {
        return {
          data: {
            activeModeId: 'mode-main',
            modes: [{
              id: 'mode-main',
              name: 'Main',
              main_color: '#2563eb',
              slot_minutes: 30,
              sync_calendars: [],
              time_backgrounds: [],
              collapsed_background_ids: [],
              quick_templates: [],
              show_quick_templates_in_main: false,
            }],
          },
        }
      }
      if (url === '/api/time-management/categories') return { data: { categories: [] } }
      if (url === '/api/user-events') return { data: { events: [event], revision: serverRevision } }
      return { data: {} }
    })
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/api/user-events/revision') return { data: { revision: serverRevision } }
      if (url === '/api/user-events') return { data: { events: serverRevision === '0:' ? [] : [event], revision: serverRevision } }
      return { data: {} }
    })

    const intervalSpy = vi.spyOn(window, 'setInterval')
    try {
      render(
        <MemoryRouter>
          <TimeManagementPage />
        </MemoryRouter>
      )

      expect((await screen.findAllByText('Removed in another browser')).length).toBeGreaterThan(0)
      await waitFor(() => {
        expect(apiClient.get).toHaveBeenCalledWith('/api/user-events/revision')
      })

      const revisionInterval = intervalSpy.mock.calls.find((call) => call[1] === 5000)?.[0]
      expect(typeof revisionInterval).toBe('function')
      serverRevision = '0:'
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'hidden',
      })

      await act(async () => {
        if (typeof revisionInterval === 'function') revisionInterval()
      })

      await waitFor(() => {
        expect(screen.queryAllByText('Removed in another browser')).toHaveLength(0)
      })
      expect(apiClient.get).toHaveBeenCalledWith('/api/user-events', {
        params: { windowStart: expect.any(String), windowEnd: expect.any(String) },
      })
    } finally {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'visible',
      })
      intervalSpy.mockRestore()
    }
  })

  it('removes an item when another tab broadcasts a committed deletion', async () => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    const start = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 12, 0, 0))
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    let deletionCommitted = false

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') return { data: { sources: [] } }
      if (url === '/api/time-management/modes') {
        return {
          data: {
            activeModeId: 'mode-main',
            modes: [{
              id: 'mode-main',
              name: 'Main',
              main_color: '#2563eb',
              slot_minutes: 30,
              sync_calendars: [],
              time_backgrounds: [],
              collapsed_background_ids: [],
              quick_templates: [],
              show_quick_templates_in_main: false,
            }],
          },
        }
      }
      if (url === '/api/time-management/categories') return { data: { categories: [] } }
      if (url === '/api/user-events') {
        return {
          data: {
            events: deletionCommitted ? [] : [{
              id: 'evt-other-tab-delete',
              title: 'Deleted from another tab',
              description: null,
              meeting_link: null,
              location: null,
              start_time: start.toISOString(),
              end_time: end.toISOString(),
              source_type: 'manual',
              source_id: 'coord-main',
              category_ids: [],
            }],
          },
        }
      }
      return { data: {} }
    })

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    const [receivingItem] = await screen.findAllByText('Deleted from another tab')
    fireEvent.click(receivingItem)
    deletionCommitted = true

    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'coord-time-management-sync-ping',
        newValue: JSON.stringify({
          type: 'time-management-updated',
          reason: 'event-deleted',
          tabId: 'another-tab',
          updatedAt: Date.now(),
        }),
      }))
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'coord-time-management-sync-ping',
        newValue: JSON.stringify({
          type: 'time-management-updated',
          reason: 'state-changed',
          tabId: 'another-tab',
          updatedAt: Date.now() + 1,
        }),
      }))
      await new Promise((resolve) => window.setTimeout(resolve, 260))
    })

    expect(screen.queryAllByText('Deleted from another tab')).toHaveLength(0)
  })

  it('cleans up drag state and animation when drag is cancelled with Escape', async () => {
    localStorage.setItem(
      'time-management-v1',
      JSON.stringify({
        syncCalendars: [
          {
            id: 'coord-main',
            name: 'Coordination Manager Main',
            color: '#2563eb',
            enabled: true,
            sourceType: 'app',
          },
        ],
        slotMinutes: 30,
        timeBackgrounds: [],
        collapsedBackgroundIds: [],
        quickTemplates: [],
        showQuickTemplatesInMain: false,
      })
    )

    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    const start = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 12, 0, 0))
    const end = new Date(start.getTime() + 90 * 60 * 1000)

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') return { data: { sources: [] } }
      if (url === '/api/time-management/modes') {
        return {
          data: {
            activeModeId: 'mode-main',
            modes: [
              {
                id: 'mode-main',
                name: 'Main',
                main_color: '#2563eb',
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
      if (url === '/api/time-management/categories') return { data: { categories: [] } }
      if (url === '/api/user-events') {
        return {
          data: {
            events: [
              {
                id: 'evt-drag-cancel',
                title: 'Drag me and cancel',
                description: 'test drag note',
                meeting_link: null,
                location: null,
                start_time: start.toISOString(),
                end_time: end.toISOString(),
                source_type: 'manual',
                source_id: 'coord-main',
                category_ids: [],
              },
            ],
          },
        }
      }
      return { data: {} }
    })

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    const [dragTarget] = await screen.findAllByText('Drag me and cancel')
    const itemContainer = dragTarget.closest('[data-time-management-item="true"]') as HTMLDivElement | null
    expect(itemContainer).toBeTruthy()
    if (!itemContainer) return

    mockItemRectAroundPointer(itemContainer, 200)
    fireEvent.pointerDown(itemContainer, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 50, clientY: 200 })
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 50, clientY: 212 })

    // When dragging starts, it gets the ghost/cut visual animation
    await waitFor(() => {
      expect(itemContainer.style.animation).toContain('move-source-ghost')
    })

    // Press Escape to cancel the drag
    fireEvent.keyDown(window, { key: 'Escape' })

    // Animation should be cleared immediately
    await waitFor(() => {
      expect(itemContainer.style.animation).toBe('')
    })
  })

  it('cleans up drag state and allows creating selections after an aborted drag gesture', async () => {
    localStorage.setItem(
      'time-management-v1',
      JSON.stringify({
        syncCalendars: [
          {
            id: 'coord-main',
            name: 'Coordination Manager Main',
            color: '#2563eb',
            enabled: true,
            sourceType: 'app',
          },
        ],
        slotMinutes: 30,
        timeBackgrounds: [],
        collapsedBackgroundIds: [],
        quickTemplates: [],
        showQuickTemplatesInMain: false,
      })
    )

    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    const start = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 12, 0, 0))
    const end = new Date(start.getTime() + 90 * 60 * 1000)

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') return { data: { sources: [] } }
      if (url === '/api/time-management/modes') {
        return {
          data: {
            activeModeId: 'mode-main',
            modes: [
              {
                id: 'mode-main',
                name: 'Main',
                main_color: '#2563eb',
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
      if (url === '/api/time-management/categories') return { data: { categories: [] } }
      if (url === '/api/user-events') {
        return {
          data: {
            events: [
              {
                id: 'evt-drag-abort',
                title: 'Drag me and abort',
                description: 'test drag abort',
                meeting_link: null,
                location: null,
                start_time: start.toISOString(),
                end_time: end.toISOString(),
                source_type: 'manual',
                source_id: 'coord-main',
                category_ids: [],
              },
            ],
          },
        }
      }
      return { data: {} }
    })

    const { container } = render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    const [dragTarget] = await screen.findAllByText('Drag me and abort')
    const itemContainer = dragTarget.closest('[data-time-management-item="true"]') as HTMLDivElement | null
    expect(itemContainer).toBeTruthy()
    if (!itemContainer) return

    // Start drag
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => []),
    })
    mockItemRectAroundPointer(itemContainer, 200)
    fireEvent.pointerDown(itemContainer, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 50, clientY: 200 })
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 50, clientY: 212 })
    await waitFor(() => {
      expect(itemContainer.style.animation).toContain('move-source-ghost')
    })

    // Pointer releases outside a drop zone
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: 50, clientY: 212 })

    // Ghost animation must be cleared
    await waitFor(() => {
      expect(itemContainer.style.animation).toBe('')
    })

    // Now clicking on the calendar day column must work cleanly and start a selection
    const firstDayColumn = container.querySelector("div[style*='repeating-linear-gradient']") as HTMLDivElement | null
    expect(firstDayColumn).toBeTruthy()
    if (!firstDayColumn) return

    vi.spyOn(firstDayColumn, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 600,
      width: 100,
      height: 600,
      toJSON: () => ({}),
    })

    fireEvent.mouseDown(firstDayColumn, { button: 0, clientX: 20, clientY: 320 })
    expect(await screen.findByPlaceholderText(TITLE_PLACEHOLDER)).toBeInTheDocument()
  })

  it('reschedules an item via drag-and-drop and cleanly completes the drag cycle', async () => {
    localStorage.setItem(
      'time-management-v1',
      JSON.stringify({
        syncCalendars: [
          {
            id: 'coord-main',
            name: 'Coordination Manager Main',
            color: '#2563eb',
            enabled: true,
            sourceType: 'app',
          },
        ],
        slotMinutes: 30,
        timeBackgrounds: [],
        collapsedBackgroundIds: [],
        quickTemplates: [],
        showQuickTemplatesInMain: false,
      })
    )

    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    const start = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 10, 0, 0))
    const end = new Date(start.getTime() + 60 * 60 * 1000)

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') return { data: { sources: [] } }
      if (url === '/api/time-management/modes') {
        return {
          data: {
            activeModeId: 'mode-main',
            modes: [
              {
                id: 'mode-main',
                name: 'Main',
                main_color: '#2563eb',
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
      if (url === '/api/time-management/categories') return { data: { categories: [] } }
      if (url === '/api/user-events') {
        return {
          data: {
            events: [
              {
                id: 'evt-drag-reschedule',
                title: 'Drag me to drop',
                description: 'drag drop test',
                meeting_link: null,
                location: null,
                start_time: start.toISOString(),
                end_time: end.toISOString(),
                source_type: 'manual',
                source_id: 'coord-main',
                category_ids: [],
              },
            ],
          },
        }
      }
      return { data: {} }
    })

    vi.mocked(apiClient.put).mockResolvedValue({ data: {} })

    const { container } = render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    const [dragTarget] = await screen.findAllByText('Drag me to drop')
    const itemContainer = dragTarget.closest('[data-time-management-item="true"]') as HTMLDivElement | null
    expect(itemContainer).toBeTruthy()
    if (!itemContainer) return

    const dayColumns = container.querySelectorAll("div[style*='repeating-linear-gradient']")
    const targetColumn = dayColumns[0] as HTMLDivElement | null
    expect(targetColumn).toBeTruthy()
    if (!targetColumn) return

    vi.spyOn(targetColumn, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 600,
      width: 100,
      height: 600,
      toJSON: () => ({}),
    })

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [targetColumn]),
    })

    // Pointer-drag onto day column
    mockItemRectAroundPointer(itemContainer, 100)
    fireEvent.pointerDown(itemContainer, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 50, clientY: 100 })
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 20, clientY: 300 })
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: 20, clientY: 300 })

    await waitFor(() => {
      expect(apiClient.put).toHaveBeenCalledWith(
        '/api/user-events/evt-drag-reschedule',
        expect.objectContaining({
          start_time: expect.any(String),
          end_time: expect.any(String),
        })
      )
    })

    // Drag ghost animation should be completely cleared
    await waitFor(() => {
      expect(itemContainer.style.animation).toBe('')
    })
  })

  it('folds the currently active single selection into the multi-select set on Ctrl+click', async () => {
    localStorage.setItem(
      'time-management-v1',
      JSON.stringify({
        syncCalendars: [
          {
            id: 'coord-main',
            name: 'Coordination Manager Main',
            color: '#2563eb',
            enabled: true,
            sourceType: 'app',
          },
        ],
        slotMinutes: 30,
        timeBackgrounds: [],
        collapsedBackgroundIds: [],
        quickTemplates: [],
        showQuickTemplatesInMain: false,
      })
    )

    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    const itemAStart = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 7, 0, 0))
    const itemAEnd = new Date(itemAStart.getTime() + 30 * 60 * 1000)
    const itemBStart = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 12, 0, 0))
    const itemBEnd = new Date(itemBStart.getTime() + 30 * 60 * 1000)

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') return { data: { sources: [] } }
      if (url === '/api/time-management/modes') {
        return {
          data: {
            activeModeId: 'mode-main',
            modes: [
              {
                id: 'mode-main',
                name: 'Main',
                main_color: '#2563eb',
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
      if (url === '/api/time-management/categories') return { data: { categories: [] } }
      if (url === '/api/user-events') {
        return {
          data: {
            events: [
              {
                id: 'evt-multi-a',
                title: 'Multi item A',
                description: null,
                meeting_link: null,
                location: null,
                start_time: itemAStart.toISOString(),
                end_time: itemAEnd.toISOString(),
                source_type: 'manual',
                source_id: 'coord-main',
                category_ids: [],
              },
              {
                id: 'evt-multi-b',
                title: 'Multi item B',
                description: null,
                meeting_link: null,
                location: null,
                start_time: itemBStart.toISOString(),
                end_time: itemBEnd.toISOString(),
                source_type: 'manual',
                source_id: 'coord-main',
                category_ids: [],
              },
            ],
          },
        }
      }
      return { data: {} }
    })

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    const [itemAText] = await screen.findAllByText('Multi item A')
    const [itemBText] = await screen.findAllByText('Multi item B')
    const itemAContainer = itemAText.closest('[data-time-management-item="true"]') as HTMLDivElement | null
    const itemBContainer = itemBText.closest('[data-time-management-item="true"]') as HTMLDivElement | null
    expect(itemAContainer).toBeTruthy()
    expect(itemBContainer).toBeTruthy()
    if (!itemAContainer || !itemBContainer) return

    // Plain click activates a single selection (not multi-select).
    fireEvent.click(itemAContainer)
    expect(itemAContainer.dataset.multiSelected).toBeUndefined()

    // Ctrl+click a different item folds the previously active item in too.
    fireEvent.click(itemBContainer, { ctrlKey: true })

    expect(itemAContainer.dataset.multiSelected).toBe('true')
    expect(itemBContainer.dataset.multiSelected).toBe('true')
  })

  it('replaces "Select Overlapping Items" with "Add to Multi-select" once a multi-selection is active, merging instead of replacing', async () => {
    localStorage.setItem(
      'time-management-v1',
      JSON.stringify({
        syncCalendars: [
          {
            id: 'coord-main',
            name: 'Coordination Manager Main',
            color: '#2563eb',
            enabled: true,
            sourceType: 'app',
          },
        ],
        slotMinutes: 30,
        timeBackgrounds: [],
        collapsedBackgroundIds: [],
        quickTemplates: [],
        showQuickTemplatesInMain: false,
      })
    )

    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    const itemAStart = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 12, 30, 0))
    const itemAEnd = new Date(itemAStart.getTime() + 30 * 60 * 1000)
    const itemBStart = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 20, 0, 0))
    const itemBEnd = new Date(itemBStart.getTime() + 30 * 60 * 1000)

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') return { data: { sources: [] } }
      if (url === '/api/time-management/modes') {
        return {
          data: {
            activeModeId: 'mode-main',
            modes: [
              {
                id: 'mode-main',
                name: 'Main',
                main_color: '#2563eb',
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
      if (url === '/api/time-management/categories') return { data: { categories: [] } }
      if (url === '/api/user-events') {
        return {
          data: {
            events: [
              {
                id: 'evt-overlap-a',
                title: 'Overlap item A',
                description: null,
                meeting_link: null,
                location: null,
                start_time: itemAStart.toISOString(),
                end_time: itemAEnd.toISOString(),
                source_type: 'manual',
                source_id: 'coord-main',
                category_ids: [],
              },
              {
                id: 'evt-overlap-b',
                title: 'Overlap item B',
                description: null,
                meeting_link: null,
                location: null,
                start_time: itemBStart.toISOString(),
                end_time: itemBEnd.toISOString(),
                source_type: 'manual',
                source_id: 'coord-main',
                category_ids: [],
              },
            ],
          },
        }
      }
      return { data: {} }
    })

    const { container } = render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    const [itemAText] = await screen.findAllByText('Overlap item A')
    const [itemBText] = await screen.findAllByText('Overlap item B')
    const itemAContainer = itemAText.closest('[data-time-management-item="true"]') as HTMLDivElement | null
    const itemBContainer = itemBText.closest('[data-time-management-item="true"]') as HTMLDivElement | null
    expect(itemAContainer).toBeTruthy()
    expect(itemBContainer).toBeTruthy()
    if (!itemAContainer || !itemBContainer) return

    const dayColumn = container.querySelector("div[style*='repeating-linear-gradient']") as HTMLDivElement | null
    expect(dayColumn).toBeTruthy()
    if (!dayColumn) return

    vi.spyOn(dayColumn, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 600,
      width: 100,
      height: 600,
      toJSON: () => ({}),
    })

    const findSelectionOverlay = () =>
      Array.from(container.querySelectorAll('div')).find((element) => element.className.includes('z-22')) as HTMLDivElement | undefined

    // clientY 320 -> minute 768, snaps down to 750 (12:30), overlapping Overlap item A.
    fireEvent.mouseDown(dayColumn, { button: 0, clientX: 20, clientY: 320 })
    const firstOverlay = findSelectionOverlay()
    expect(firstOverlay).toBeTruthy()
    if (!firstOverlay) return
    fireEvent.contextMenu(firstOverlay, { clientX: 20, clientY: 320 })

    expect(await screen.findByRole('menuitem', { name: /Select Overlapping Items/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Add to Multi-select/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: /Select Overlapping Items/ }))

    await waitFor(() => {
      expect(itemAContainer.dataset.multiSelected).toBe('true')
    })
    expect(itemBContainer.dataset.multiSelected).toBeUndefined()

    // clientY 505 -> minute 1212, snaps down to 1200 (20:00), overlapping Overlap item B.
    fireEvent.mouseDown(dayColumn, { button: 0, clientX: 20, clientY: 505 })
    const secondOverlay = findSelectionOverlay()
    expect(secondOverlay).toBeTruthy()
    if (!secondOverlay) return
    fireEvent.contextMenu(secondOverlay, { clientX: 20, clientY: 505 })

    expect(await screen.findByRole('menuitem', { name: /Add to Multi-select/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Select Overlapping Items/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: /Add to Multi-select/ }))

    // Both items remain selected -- the second action merged rather than replaced.
    await waitFor(() => {
      expect(itemBContainer.dataset.multiSelected).toBe('true')
    })
    expect(itemAContainer.dataset.multiSelected).toBe('true')
  })

  it('keeps a just-applied category tag when a racing authoritative connected-calendar sync returns stale data', async () => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    const eventStart = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 12, 0, 0)).toISOString()
    const eventEnd = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 13, 0, 0)).toISOString()

    // Server never echoes the category back -- simulates a GET that raced
    // ahead of (or read a stale replica for) the just-committed category PUT.
    const staleEvent = {
      id: 'evt-tag-race',
      title: 'Tag race item',
      description: null,
      meeting_link: null,
      location: null,
      start_time: eventStart,
      end_time: eventEnd,
      source_type: 'manual' as const,
      source_id: 'coord-main',
      category_ids: [] as string[],
    }

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') {
        return {
          data: {
            sources: [
              {
                id: 'google-1',
                source_type: 'google_oauth',
                google_email: 'user@example.com',
                public_url: null,
                display_name: 'Google Personal',
                color: '#34d399',
                is_active: true,
              },
            ],
          },
        }
      }
      if (url === '/api/time-management/modes') {
        return {
          data: {
            activeModeId: 'mode-main',
            modes: [
              {
                id: 'mode-main',
                name: 'Main',
                main_color: '#2563eb',
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
        return {
          data: {
            categories: [
              {
                id: 'cat-focus',
                label: 'Focus',
                color: '#16a34a',
                font_color: '#ffffff',
                background_opacity: 1,
                item_opacity: 1,
                source_id: 'mode-main',
              },
            ],
          },
        }
      }
      if (url === '/api/user-events') return { data: { events: [staleEvent] } }
      return { data: {} }
    })

    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/api/user-events') return { data: { events: [staleEvent] } }
      return { data: {} }
    })
    vi.mocked(apiClient.post).mockResolvedValue({ data: { inserted: 0, updated: 0, deleted: 0 } })
    vi.mocked(apiClient.put).mockResolvedValue({ data: {} })

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    const [itemText] = await screen.findAllByText('Tag race item')

    // Wait for the initial foreground connected-calendar sync to settle.
    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/api/user-events/sync-imports', expect.anything())
    })
    await waitFor(() => {
      expect(screen.queryByText('Syncing')).not.toBeInTheDocument()
    })

    fireEvent.click(itemText)
    const categoryButton = await screen.findByRole('button', { name: 'Focus' })
    fireEvent.click(categoryButton)
    fireEvent.click(screen.getByTestId('left-sidebar-update-button'))

    await waitFor(() => {
      expect(apiClient.put).toHaveBeenCalledWith('/api/user-events/evt-tag-race', expect.objectContaining({
        category_ids: ['cat-focus'],
      }))
    })
    await waitFor(() => {
      expect(categoryButton).toHaveStyle({ backgroundColor: '#16a34a' })
    })

    // Manually trigger another foreground (authoritative) sync while the
    // server still has not echoed the category back -- the tag must survive.
    const priorSyncCalls = vi.mocked(apiClient.post).mock.calls.filter(
      (call) => call[0] === '/api/user-events/sync-imports'
    ).length
    fireEvent.click(screen.getByRole('button', { name: 'Calendar Sources', expanded: false }))
    fireEvent.click(await screen.findByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      const syncCalls = vi.mocked(apiClient.post).mock.calls.filter(
        (call) => call[0] === '/api/user-events/sync-imports'
      ).length
      expect(syncCalls).toBeGreaterThan(priorSyncCalls)
    })
    await waitFor(() => {
      expect(screen.queryByText('Syncing')).not.toBeInTheDocument()
    })

    expect(categoryButton).toHaveStyle({ backgroundColor: '#16a34a' })
  })
})
