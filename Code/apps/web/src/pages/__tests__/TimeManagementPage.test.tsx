import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TimeManagementPage from '../TimeManagementPage'
import {
  buildDiffuseTimeBackgroundFill,
  findTimeItemDurationByTitle,
  inferRequestedTimezoneForAiResponse,
  isExplicitPrimaryTimezoneChangeRequest,
} from '../time-management-page-helpers'

const mockDedupedGet = vi.fn()
const mockUseAuth = vi.fn()
const mockApiPost = vi.fn()
const mockApiPut = vi.fn()
const mockApiPatch = vi.fn()
const mockApiDelete = vi.fn()
const mockComputeDayLayout = vi.fn()

vi.mock('../../lib/api-client', () => ({
  apiClient: {
    // Route apiClient.get through the same mock as dedupedGet since fetchEvents'
    // forced (non-deduped) refresh path calls apiClient.get directly.
    get: (...args: unknown[]) => mockDedupedGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    put: (...args: unknown[]) => mockApiPut(...args),
    patch: (...args: unknown[]) => mockApiPatch(...args),
    delete: (...args: unknown[]) => mockApiDelete(...args),
  },
  dedupedGet: (...args: unknown[]) => mockDedupedGet(...args),
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock('../../contexts/LayoutContext', () => ({
  LeftPanelPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('../../components/TimezoneSelector', () => ({
  default: () => <div data-testid="timezone-selector" />,
}))

vi.mock('../../components/ColorGridPicker', () => ({
  default: () => <div data-testid="color-grid-picker" />,
}))

vi.mock('../../lib/use-timezones', () => ({
  useTimezones: () => ({
    primary: 'UTC',
    additional: [],
    all: ['UTC'],
    setPrimary: vi.fn(),
    addTimezone: vi.fn(),
    removeTimezone: vi.fn(),
    replaceTimezone: vi.fn(),
    canAddMore: true,
    getEntry: vi.fn(),
  }),
}))

vi.mock('../../lib/timezone-data', () => ({
  convertUtcTimeToTimezone: (value: string) => value,
  convertUtcTimeToTimezoneOnDate: (value: string) => value,
  detectDstTransitions: () => [],
  getTimezoneAbbrOnDate: () => 'UTC',
  getCurrentTimeInTimezone: () => '00:00',
  findTimezone: () => undefined,
}))

vi.mock('../../lib/calendarOverlapLayout', () => ({
  computeDayLayout: (...args: unknown[]) => mockComputeDayLayout(...args),
}))

vi.mock('@tiptap/react', () => ({
  EditorContent: () => <div data-testid="editor-content" />,
  Extension: {
    create: () => ({}),
  },
  useEditor: () => ({
    setEditable: vi.fn(),
    getMarkdown: () => '',
    view: {
      dom: document.createElement('div'),
    },
    commands: {
      setContent: vi.fn(),
      insertContent: vi.fn(),
    },
  }),
}))

vi.mock('@tiptap/markdown', () => ({
  Markdown: {},
}))

vi.mock('@tiptap/starter-kit', () => ({
  default: {
    configure: () => ({}),
  },
}))

vi.mock('@tiptap/extension-placeholder', () => ({
  Placeholder: {
    configure: () => ({}),
  },
}))

vi.mock('@tiptap/extension-list', () => ({
  TaskItem: {
    configure: () => ({}),
  },
  TaskList: {},
}))

vi.mock('@tiptap/extension-details', () => ({
  Details: {
    configure: () => ({}),
  },
  DetailsContent: {},
  DetailsSummary: {
    extend: () => ({}),
  },
}))

function installDefaultApiMocks(): void {
  mockDedupedGet.mockImplementation(async (url: string) => {
    if (url === '/api/calendar-sources') {
      return { data: { sources: [] } }
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
      return { data: { categories: [] } }
    }
    if (url === '/api/user-events') {
      return { data: { events: [] } }
    }
    return { data: {} }
  })
}

function setWindowInnerWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
  })
}

describe('TimeManagementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: vi.fn(),
    })
    mockComputeDayLayout.mockReturnValue({ eventSegments: [], overflowSegments: [] })
    mockUseAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      isTraveler: false,
    })
    mockApiPost.mockResolvedValue({ data: { inserted: 0, updated: 0, deleted: 0, syncedSources: 0 } })
    mockApiPut.mockResolvedValue({ data: {} })
    installDefaultApiMocks()
  })

  it('renders the page shell and fetches initial datasets', async () => {
    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    expect(await screen.findByRole('heading', { name: 'Time Management' })).toBeInTheDocument()
    expect(await screen.findByText('Time Management Tools')).toBeInTheDocument()

    await waitFor(() => {
      expect(mockDedupedGet).toHaveBeenCalledWith('/api/calendar-sources')
      expect(mockDedupedGet).toHaveBeenCalledWith('/api/time-management/prefs')
      expect(mockDedupedGet).toHaveBeenCalledWith('/api/time-management/categories')
      expect(mockDedupedGet).toHaveBeenCalledWith('/api/user-events', {
        params: { windowStart: expect.any(String), windowEnd: expect.any(String) },
      })
    })
  })

  it('starts with the left panel closed even when cached open, then restores saved width when opened', async () => {
    setWindowInnerWidth(1400)
    localStorage.setItem(
      'time-management-v1',
      JSON.stringify({
        syncCalendars: [],
        slotMinutes: 30,
        timeBackgrounds: [],
        collapsedBackgroundIds: [],
        quickTemplates: [],
        showQuickTemplatesInMain: false,
        quickTemplatesMainExpanded: true,
        isLeftPanelOpen: true,
        leftPanelWidthPx: 500,
        expandedSections: [],
      })
    )

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    const panelHeading = await screen.findByRole('heading', { name: 'Time Management Tools' })
    const aside = panelHeading.closest('aside') as HTMLElement

    await waitFor(() => {
      expect(aside.style.width).toBe('0px')
    })

    fireEvent.click(screen.getByTitle('Show left panel'))

    await waitFor(() => {
      expect(aside.style.width).toBe('500px')
    })

    setWindowInnerWidth(900)
    fireEvent(window, new Event('resize'))

    await waitFor(() => {
      expect(aside.style.width).toBe('450px')
    })

    setWindowInnerWidth(1400)
    fireEvent(window, new Event('resize'))

    await waitFor(() => {
      expect(aside.style.width).toBe('500px')
    })
  })

  it('shows empty-state messaging when no meetings are returned', async () => {
    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    expect(await screen.findByText('No meetings found on the selected calendars.')).toBeInTheDocument()
  })

  it('uses icon-only header controls in phone layout', async () => {
    setWindowInnerWidth(500)

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    expect(await screen.findByRole('heading', { name: 'Time Management Tools' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous week' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Jump to today' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Today' })).not.toBeInTheDocument()
  })

  it('hides the header title only when measured space is scarce and restores it on resize', async () => {
    setWindowInnerWidth(1280)
    let headerWidth = 1036
    let updateHeaderLayout: (() => void) | undefined
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(private readonly callback: () => void) {}
      observe(element: Element) {
        if (element.tagName === 'HEADER') updateHeaderLayout = this.callback
      }
      disconnect = disconnect
    })
    const originalRect = Element.prototype.getBoundingClientRect
    const rectMock = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      let width: number | undefined
      if (this.tagName === 'H1') width = 240
      if (this.tagName === 'BUTTON' && this.textContent === 'Disable Hidden Mode') width = 150
      if (['Hide left panel', 'Show left panel'].includes(this.getAttribute('title') ?? '')) width = 100
      if (this.querySelector(':scope > [aria-label="Previous week"]')) width = 150
      if (this.tagName === 'SPAN' && this.classList.contains('whitespace-nowrap')) width = 140
      if (this.getAttribute('data-testid') === 'timezone-selector') width = 160
      if (this.getAttribute('data-testid') === 'time-zoom-quick-buttons') width = 60
      return width === undefined ? originalRect.call(this) : new DOMRect(0, 0, width, 32)
    })
    const widthMock = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.tagName === 'HEADER' ? headerWidth : 0
    })
    const originalStyle = window.getComputedStyle
    // Computed style declarations are read-only (JSDOM 27+), so override via a proxy.
    const styleOverrides: Record<string, string> = { columnGap: '8px', paddingLeft: '12px', paddingRight: '12px' }
    const styleMock = vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = originalStyle(element)
      return new Proxy(style, {
        get(target, prop) {
          if (typeof prop === 'string' && prop in styleOverrides) return styleOverrides[prop]
          const value: unknown = Reflect.get(target, prop, target)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    })

    const { unmount } = render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )
    try {
      const title = await screen.findByRole('heading', { name: 'Time Management' })
      expect(title).not.toHaveClass('[clip-path:inset(50%)]')
      expect(updateHeaderLayout).toBeDefined()

      headerWidth = 1021
      act(() => updateHeaderLayout?.())
      expect(title).toHaveClass('[clip-path:inset(50%)]')
      expect(screen.getByRole('button', { name: 'Previous week' }).parentElement).toHaveClass('shrink-0')
      expect(screen.getByTestId('timezone-selector').parentElement).toHaveClass('min-w-max')

      headerWidth = 1022
      act(() => updateHeaderLayout?.())
      expect(title).not.toHaveClass('[clip-path:inset(50%)]')

      headerWidth = 936
      fireEvent(window, new Event('resize'))
      expect(title).toHaveClass('[clip-path:inset(50%)]')

      headerWidth = 1336
      act(() => updateHeaderLayout?.())
      expect(title).not.toHaveClass('[clip-path:inset(50%)]')

      fireEvent.click(screen.getByRole('button', { name: 'Calendar Modes', expanded: false }))
      fireEvent.click(screen.getByRole('switch', { name: 'Toggle hidden mode' }))
      const disableHiddenMode = screen.getByRole('button', { name: 'Disable Hidden Mode' })
      expect(title).toHaveClass('[clip-path:inset(50%)]')
      expect(disableHiddenMode).not.toHaveClass('[clip-path:inset(50%)]')
      expect(disableHiddenMode.parentElement).toHaveClass('flex', 'items-center')

      headerWidth = 1337
      act(() => updateHeaderLayout?.())
      expect(title).toHaveClass('[clip-path:inset(50%)]')
      headerWidth = 1338
      act(() => updateHeaderLayout?.())
      expect(title).not.toHaveClass('[clip-path:inset(50%)]')

      headerWidth = 1036
      fireEvent.click(disableHiddenMode)
      expect(title).not.toHaveClass('[clip-path:inset(50%)]')
      expect(screen.queryByRole('button', { name: 'Disable Hidden Mode' })).not.toBeInTheDocument()
    } finally {
      unmount()
      rectMock.mockRestore()
      widthMock.mockRestore()
      styleMock.mockRestore()
      vi.unstubAllGlobals()
    }
    expect(disconnect).toHaveBeenCalled()
  })

  it('renders duplicated calendar headers on desktop and only the primary header on tablet', async () => {
    setWindowInnerWidth(1280)

    const { unmount } = render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    expect(screen.getByTestId('calendar-header-top')).toBeInTheDocument()
    expect(screen.getByTestId('calendar-header-bottom')).toBeInTheDocument()

    unmount()

    setWindowInnerWidth(900)

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    expect(screen.getByTestId('calendar-header-top')).toBeInTheDocument()
    expect(screen.queryByTestId('calendar-header-bottom')).not.toBeInTheDocument()
  })

  it('centers the current-time indicator near the middle of the calendar viewport on load', async () => {
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        const element = this as HTMLElement
        if (element.dataset?.testid === 'calendar-scroll-container') {
          return 600
        }
        return 0
      },
    })

    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        const element = this as HTMLElement
        if (element.parentElement?.dataset?.testid === 'calendar-scroll-container') {
          return 1300
        }
        return 0
      },
    })

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    const container = await screen.findByTestId('calendar-scroll-container')
    const indicators = await screen.findAllByTestId('current-time-indicator')
    const indicator = indicators[Math.floor(indicators.length / 2)]
    const indicatorTop = Number.parseFloat(indicator.style.top || '0')
    const expectedTop = 1300 + indicatorTop - 300

    await waitFor(() => {
      expect(indicatorTop).toBeGreaterThanOrEqual(0)
      expect(container.scrollTop).toBeCloseTo(expectedTop, 3)
    })

  })

  it('does not let delayed initial centering override user calendar scroll', async () => {
    let calendarClientHeight = 0
    let repeatOffsetHeight = 0

    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        const element = this as HTMLElement
        if (element.dataset?.testid === 'calendar-scroll-container') {
          return calendarClientHeight
        }
        return 0
      },
    })

    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        const element = this as HTMLElement
        if (element.parentElement?.dataset?.testid === 'calendar-scroll-container') {
          return repeatOffsetHeight
        }
        return 0
      },
    })

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    const container = await screen.findByTestId('calendar-scroll-container')

    container.scrollTop = 777
    repeatOffsetHeight = 1320
    calendarClientHeight = 620
    fireEvent.scroll(container)

    await new Promise((resolve) => window.setTimeout(resolve, 900))

    expect(container.scrollTop).toBe(777)
  })

  it('syncs enabled connected calendars for the visible week and refreshes events', async () => {
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
        return { data: { categories: [] } }
      }
      if (url === '/api/user-events') {
        return { data: { events: [] } }
      }
      return { data: {} }
    })

    mockApiPost.mockResolvedValue({
      data: { inserted: 1, updated: 0, deleted: 0, syncedSources: 1 },
    })

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        '/api/user-events/sync-imports',
        expect.objectContaining({
          time_min: expect.any(String),
          time_max: expect.any(String),
          source_configs: [
            {
              source_type: 'google_oauth',
              source_id: 'google-1',
            },
          ],
        })
      )
    })

    expect(mockDedupedGet.mock.calls.filter((call) => call[0] === '/api/user-events').length).toBeGreaterThanOrEqual(2)
  })

  it('keeps calendar scroll position stable when toggling connected OAuth/public calendars', async () => {
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        const element = this as HTMLElement
        if (element.dataset?.testid === 'calendar-scroll-container') {
          return 620
        }
        return 0
      },
    })

    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        const element = this as HTMLElement
        if (element.parentElement?.dataset?.testid === 'calendar-scroll-container') {
          return 1320
        }
        return 0
      },
    })

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') {
        return {
          data: {
            sources: [
              {
                id: 'google-oauth-1',
                source_type: 'google_oauth',
                google_email: 'oauth@example.com',
                public_url: null,
                display_name: 'Google OAuth Source',
                color: '#34d399',
                is_active: true,
              },
              {
                id: 'google-public-1',
                source_type: 'google_public_url',
                google_email: null,
                public_url: 'https://calendar.google.com/public/basic.ics',
                display_name: 'Google Public Source',
                color: '#22d3ee',
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
        return { data: { categories: [] } }
      }
      if (url === '/api/user-events') {
        return { data: { events: [] } }
      }
      return { data: {} }
    })

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    const calendarContainer = await screen.findByTestId('calendar-scroll-container')

    const sourcesToggle = screen.getByRole('button', { name: 'Calendar Sources', expanded: false })
    fireEvent.click(sourcesToggle)
    await screen.findByRole('button', { name: 'Calendar Sources', expanded: true })

    await waitFor(() => {
      expect(calendarContainer.scrollTop).toBeGreaterThan(0)
    })

    calendarContainer.scrollTop = 777
    const initialSyncCalls = mockApiPost.mock.calls.filter((call) => call[0] === '/api/user-events/sync-imports').length

    const oauthLabel = await screen.findByText('Google OAuth Source')
    const oauthCheckbox = oauthLabel.closest('label')?.querySelector<HTMLInputElement>('input[type="checkbox"]')
    if (!oauthCheckbox) {
      throw new Error('Expected OAuth source checkbox to be present')
    }

    fireEvent.click(oauthCheckbox)

    await waitFor(() => {
      const nextCalls = mockApiPost.mock.calls.filter((call) => call[0] === '/api/user-events/sync-imports').length
      expect(nextCalls).toBeGreaterThan(initialSyncCalls)
    })

    expect(calendarContainer.scrollTop).toBe(777)

    const publicLabel = await screen.findByText('Google Public Source')
    const publicCheckbox = publicLabel.closest('label')?.querySelector<HTMLInputElement>('input[type="checkbox"]')
    if (!publicCheckbox) {
      throw new Error('Expected public source checkbox to be present')
    }

    fireEvent.click(publicCheckbox)
    await waitFor(() => {
      expect(calendarContainer.scrollTop).toBe(777)
    })
  })

  it('renders cross-midnight events as segments across adjacent day columns', async () => {
    const weekStart = new Date()
    weekStart.setHours(0, 0, 0, 0)
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7))

    const start = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 1, 23, 30, 0)).toISOString()
    const end = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 2, 0, 30, 0)).toISOString()

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') {
        return { data: { sources: [] } }
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
        return { data: { categories: [] } }
      }
      if (url === '/api/user-events') {
        return {
          data: {
            events: [
              {
                id: 'night-shift-1',
                title: 'Night Shift',
                description: null,
                meeting_link: null,
                location: null,
                start_time: start,
                end_time: end,
                source_type: 'manual',
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

    mockComputeDayLayout.mockImplementation((dayEvents: Array<{ id: string }>) => ({
      eventSegments: dayEvents.map((event, eventIndex) => ({
        eventId: event.id,
        eventIndex,
        top: 80,
        height: 36,
        leftPercent: 0,
        widthPercent: 100,
        isFirstSegment: true,
      })),
      overflowSegments: [],
    }))

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })

    await waitFor(() => {
      expect(screen.getAllByText('Night Shift').length).toBeGreaterThanOrEqual(2)
    })

    expect(document.querySelectorAll('.time-item-resize-handle-top').length).toBe(3)
    expect(document.querySelectorAll('.time-item-resize-handle-bottom').length).toBe(3)

    fireEvent.click(screen.getAllByText('Night Shift')[1])

    await waitFor(() => {
      expect(document.querySelectorAll('[data-time-management-item="true"][data-selected="true"]').length).toBeGreaterThan(1)
    })
  })

  it('renders the recurrence icon only on the first segment of a split recurring item', async () => {
    const weekStart = new Date()
    weekStart.setHours(0, 0, 0, 0)
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7))

    const start = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 1, 1, 0, 0)).toISOString()
    const end = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 1, 1, 30, 0)).toISOString()

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') {
        return { data: { sources: [] } }
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
        return { data: { categories: [] } }
      }
      if (url === '/api/user-events') {
        return {
          data: {
            events: [
              {
                id: 'event-recurring-split-icon',
                title: 'Recurring split item',
                description: null,
                meeting_link: null,
                location: null,
                start_time: start,
                end_time: end,
                source_type: 'manual',
                source_id: 'coord-main',
                category_ids: [],
                recurrence_rule: { type: 'weekly' },
              },
            ],
          },
        }
      }
      return { data: {} }
    })

    mockComputeDayLayout.mockImplementation((dayEvents: Array<{ id: string }>) => ({
      eventSegments: dayEvents.flatMap((event) => [
        {
          eventId: event.id,
          eventIndex: 0,
          top: 80,
          height: 26,
          leftPercent: 0,
          widthPercent: 50,
          isFirstSegment: true,
        },
        {
          eventId: event.id,
          eventIndex: 0,
          top: 106,
          height: 26,
          leftPercent: 50,
          widthPercent: 50,
          isFirstSegment: false,
        },
      ]),
      overflowSegments: [],
    }))

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    const calendarContainer = await screen.findByTestId('calendar-scroll-container')
    const middleWeek = calendarContainer.querySelector(':scope > div[aria-hidden="false"]')

    await waitFor(() => {
      expect(middleWeek?.querySelectorAll('[data-time-management-item="true"]')).toHaveLength(2)
    })

    const itemSegments = Array.from(middleWeek?.querySelectorAll<HTMLElement>('[data-time-management-item="true"]') ?? [])
    expect(itemSegments[0]?.querySelector('div.absolute.right-1.top-1')).toBeInTheDocument()
    expect(itemSegments[1]?.querySelector('div.absolute.right-1.top-1')).not.toBeInTheDocument()
  })

  it('preserves full duration when dragging a split cross-midnight segment', async () => {
    const weekStart = new Date()
    weekStart.setHours(0, 0, 0, 0)
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7))

    const eventStart = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 1, 23, 30, 0)).toISOString()
    const eventEnd = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 2, 1, 0, 0)).toISOString()

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') {
        return { data: { sources: [] } }
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
        return { data: { categories: [] } }
      }
      if (url === '/api/user-events') {
        return {
          data: {
            events: [
              {
                id: 'event-split-drag',
                title: 'Split Drag',
                description: null,
                meeting_link: null,
                location: null,
                start_time: eventStart,
                end_time: eventEnd,
                source_type: 'manual',
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

    mockComputeDayLayout.mockImplementation((dayEvents: Array<{ id: string }>) => ({
      eventSegments: dayEvents.map((event, eventIndex) => ({
        eventId: event.id,
        eventIndex,
        top: 80,
        height: 52,
        leftPercent: 0,
        widthPercent: 100,
        isFirstSegment: true,
      })),
      overflowSegments: [],
    }))

    mockApiPut.mockResolvedValue({ data: {} })

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })

    await screen.findAllByTitle(/00:00-01:00/)
    const dayColumns = Array.from(document.querySelectorAll<HTMLDivElement>('div[style*="background-image"]'))
    const dropDayColumn = dayColumns[0]
    if (!dropDayColumn) {
      throw new Error('Expected at least one day column')
    }

    Object.defineProperty(dropDayColumn, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 100,
        bottom: 600,
        width: 100,
        height: 600,
        toJSON: () => ({}),
      }),
    })

    const dataStore = new Map<string, string>([['text/time-item', 'event-split-drag']])
    const dataTransfer = {
      setData: (type: string, value: string) => {
        dataStore.set(type, value)
      },
      getData: (type: string) => dataStore.get(type) || '',
      setDragImage: () => {},
      effectAllowed: 'move',
      dropEffect: 'move',
    }

    fireEvent.drop(dropDayColumn, { clientX: 24, clientY: 300, dataTransfer })

    await waitFor(() => {
      expect(mockApiPut).toHaveBeenCalledWith('/api/user-events/event-split-drag', expect.objectContaining({
        start_time: expect.any(String),
        end_time: expect.any(String),
      }))
    })

    const moveCall = mockApiPut.mock.calls.find((call) => call[0] === '/api/user-events/event-split-drag')
    if (!moveCall) {
      throw new Error('Expected move API call for split drag item')
    }
    const payload = moveCall[1] as { start_time: string; end_time: string }
    const movedDurationMinutes = Math.round((Date.parse(payload.end_time) - Date.parse(payload.start_time)) / 60_000)

    expect(movedDurationMinutes).toBe(90)
  })

  it('keeps neighboring week data cached when navigating back and forth', async () => {
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
        return { data: { categories: [] } }
      }
      if (url === '/api/user-events') {
        return { data: { events: [] } }
      }
      return { data: {} }
    })

    mockApiPost.mockResolvedValue({
      data: { inserted: 0, updated: 0, deleted: 0, syncedSources: 1 },
    })

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledTimes(3)
    })

    fireEvent.click(screen.getByTitle('Previous week'))

    await waitFor(() => {
      expect(mockApiPost.mock.calls.length).toBeGreaterThan(3)
    })

    fireEvent.click(screen.getByTitle('Next week'))

    mockApiPost.mockClear()

    fireEvent.click(screen.getByTitle('Previous week'))

    await waitFor(() => {
      expect(mockApiPost).not.toHaveBeenCalled()
    })
  })

  it('toggles hidden mode and updates the page title with a disable action', async () => {
    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })

    fireEvent.click(screen.getByRole('button', { name: 'Calendar Modes', expanded: false }))
    const hiddenMode = screen.getByRole('switch', { name: 'Toggle hidden mode' })
    expect(hiddenMode).not.toBeChecked()
    expect(hiddenMode).toHaveAccessibleDescription('Hide calendar item names and blur editor text.')
    fireEvent.click(screen.getByText('Hidden mode'))

    await screen.findByRole('heading', { name: 'Content hidden Time Management mode' })
    expect(hiddenMode).toBeChecked()
    expect(hiddenMode).toHaveClass('border-warning-muted', 'bg-warning-subtle')
    fireEvent.click(screen.getByText('Hide calendar item names and blur editor text.'))
    await screen.findByRole('heading', { name: 'Time Management' })
    expect(hiddenMode).not.toBeChecked()
    fireEvent.click(hiddenMode)

    await screen.findByRole('heading', { name: 'Content hidden Time Management mode' })
    const disableHiddenMode = screen.getByRole('button', { name: 'Disable Hidden Mode' })
    expect(disableHiddenMode).toHaveClass('border', 'h-8')
    expect(disableHiddenMode).not.toHaveClass('underline')
    fireEvent.click(disableHiddenMode)

    await screen.findByRole('heading', { name: 'Time Management' })
  })

  it('keeps midnight-split time backgrounds solid at clipped edges', () => {
    const topClippedFill = buildDiffuseTimeBackgroundFill('#0ea5e9', 0.18, {
      fadeStart: true,
      fadeEnd: false,
    })
    const bottomClippedFill = buildDiffuseTimeBackgroundFill('#0ea5e9', 0.18, {
      fadeStart: false,
      fadeEnd: true,
    })

    expect(topClippedFill).toContain('rgba(14, 165, 233, 0.081) 0%')
    expect(topClippedFill).toContain('rgba(14, 165, 233, 0.18) 100%')
    expect(bottomClippedFill).toContain('rgba(14, 165, 233, 0.18) 0%')
    expect(bottomClippedFill).toContain('rgba(14, 165, 233, 0.081) 100%')
  })

  it('only treats explicit primary-timezone requests as primary changes', () => {
    expect(isExplicitPrimaryTimezoneChangeRequest('Create me a time background at the range of 22:00 UTC to 6 UTC and apply estonian timezone')).toBe(false)
    expect(isExplicitPrimaryTimezoneChangeRequest('Apply Estonian timezone and keep UTC primary')).toBe(false)
    expect(isExplicitPrimaryTimezoneChangeRequest('Set Europe/Tallinn as my primary timezone')).toBe(true)
    expect(isExplicitPrimaryTimezoneChangeRequest('Switch the main timezone to Europe/Tallinn')).toBe(true)
  })

  it('infers requested non-UTC timezone from user or AI text when action payload omits timezone', () => {
    expect(
      inferRequestedTimezoneForAiResponse(
        'keep the UTC still as primary UTC',
        'Background period created from 01:00 to 09:00 in Estonian time (Europe/Tallinn).',
        'Background created'
      )
    ).toBe('Europe/Tallinn')

    expect(
      inferRequestedTimezoneForAiResponse(
        'Create a background in Europe/Tallinn',
        'Created background period.',
        'Done'
      )
    ).toBe('Europe/Tallinn')

    expect(
      inferRequestedTimezoneForAiResponse(
        'Keep UTC primary and create a UTC window',
        'Created background in UTC.',
        'Done'
      )
    ).toBeNull()
  })

  it('cancels an active time selection when Escape is pressed', async () => {
    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })

    const dayColumn = document.querySelector<HTMLDivElement>('div[style*="background-image"]')
    expect(dayColumn).toBeTruthy()

    if (!dayColumn) {
      throw new Error('Expected at least one day column')
    }

    Object.defineProperty(dayColumn, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 100,
        bottom: 600,
        width: 100,
        height: 600,
        toJSON: () => ({}),
      }),
    })

    fireEvent.mouseDown(dayColumn, { button: 0, clientX: 20, clientY: 120 })
    fireEvent.mouseUp(window)

    await screen.findByText(/Selection:/)

    fireEvent.keyDown(document.body, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByText(/Selection:/)).not.toBeInTheDocument()
      expect(screen.getByTitle('Hide left panel')).toBeInTheDocument()
    })
  })

  it('resizes a 15 minute item from the visible repeat without sticky-header drift', async () => {
    const weekStart = new Date()
    weekStart.setHours(0, 0, 0, 0)
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7))

    const eventStart = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 1, 0, 0)).toISOString()
    const eventEnd = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 1, 15, 0)).toISOString()

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') {
        return { data: { sources: [] } }
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
                slot_minutes: 15,
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
            events: [
              {
                id: 'event-1',
                title: 'Quick item',
                description: null,
                meeting_link: null,
                location: null,
                start_time: eventStart,
                end_time: eventEnd,
                source_type: 'manual',
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

    mockComputeDayLayout.mockReturnValue({
      eventSegments: [
        {
          eventId: 'event-1',
          eventIndex: 0,
          top: 104,
          height: 26,
          leftPercent: 0,
          widthPercent: 100,
          isFirstSegment: true,
        },
      ],
      overflowSegments: [],
    })

    mockApiPut.mockResolvedValue({ data: {} })

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    await screen.findAllByText('Quick item')

    const dayColumns = Array.from(document.querySelectorAll<HTMLDivElement>('div[style*="background-image"]'))
    expect(dayColumns.length).toBeGreaterThanOrEqual(14)

    const visibleRepeatColumn = dayColumns[0]
    const middleRepeatColumn = dayColumns[7]

    if (!visibleRepeatColumn || !middleRepeatColumn) {
      throw new Error('Expected visible and middle repeat day columns')
    }

    Object.defineProperty(visibleRepeatColumn, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 100,
        bottom: 2496,
        width: 100,
        height: 2496,
        toJSON: () => ({}),
      }),
    })

    Object.defineProperty(middleRepeatColumn, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 0,
        y: 2574,
        top: 2574,
        left: 0,
        right: 100,
        bottom: 5070,
        width: 100,
        height: 2496,
        toJSON: () => ({}),
      }),
    })

    fireEvent.mouseDown(visibleRepeatColumn, { button: 0, clientX: 20, clientY: 130 })
    fireEvent.mouseMove(window, { clientX: 20, clientY: 156 })

    await waitFor(() => {
      const resizedItems = screen.getAllByTitle(/01:00-01:30/)
      expect(resizedItems.length).toBeGreaterThan(0)
      expect(resizedItems[0]).toHaveClass('transition-none')
      expect(resizedItems[0]).not.toHaveClass('transition-all')
    })

    fireEvent.mouseUp(window)

    await waitFor(() => {
      expect(screen.getAllByTitle(/01:00-01:30/)[0]).toHaveClass('transition-all')
    })

    await waitFor(() => {
      expect(mockApiPut).toHaveBeenCalledWith('/api/user-events/event-1', {
        start_time: eventStart,
        end_time: new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 1, 30, 0)).toISOString(),
      })
    })
  })

  it('keeps a resized duration when a stale silent refetch resolves after the save', async () => {
    const weekStart = new Date()
    weekStart.setHours(0, 0, 0, 0)
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7))

    const eventStart = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 1, 0, 0)).toISOString()
    const eventEnd = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 1, 15, 0)).toISOString()

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') {
        return { data: { sources: [] } }
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
                slot_minutes: 15,
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
        // Always answers with the pre-resize geometry, mimicking a GET issued
        // before the resize PUT committed server-side.
        return {
          data: {
            events: [
              {
                id: 'event-stale-refetch',
                title: 'Stale refetch item',
                description: null,
                meeting_link: null,
                location: null,
                start_time: eventStart,
                end_time: eventEnd,
                source_type: 'manual',
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

    mockComputeDayLayout.mockReturnValue({
      eventSegments: [
        {
          eventId: 'event-stale-refetch',
          eventIndex: 0,
          top: 104,
          height: 26,
          leftPercent: 0,
          widthPercent: 100,
          isFirstSegment: true,
        },
      ],
      overflowSegments: [],
    })

    mockApiPut.mockResolvedValue({ data: {} })

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    await screen.findAllByText('Stale refetch item')

    const dayColumns = Array.from(document.querySelectorAll<HTMLDivElement>('div[style*="background-image"]'))
    const dayColumn = dayColumns[0]
    if (!dayColumn) {
      throw new Error('Expected at least one day column')
    }

    Object.defineProperty(dayColumn, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 100,
        bottom: 2496,
        width: 100,
        height: 2496,
        toJSON: () => ({}),
      }),
    })

    fireEvent.mouseDown(dayColumn, { button: 0, clientX: 20, clientY: 130 })
    fireEvent.mouseMove(window, { clientX: 20, clientY: 156 })
    fireEvent.mouseUp(window)

    await waitFor(() => {
      expect(mockApiPut).toHaveBeenCalledWith('/api/user-events/event-stale-refetch', {
        start_time: eventStart,
        end_time: new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 1, 30, 0)).toISOString(),
      })
    })

    fireEvent.focus(window)

    await new Promise((resolve) => setTimeout(resolve, 400))

    expect(screen.getAllByTitle(/01:00-01:30/).length).toBeGreaterThan(0)
    expect(screen.queryAllByTitle(/01:00-01:15/).length).toBe(0)
  })

  it('allows resizing a start edge beyond 00:00 UTC and saves to previous day on release', async () => {    const weekStart = new Date()
    weekStart.setHours(0, 0, 0, 0)
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7))

    const eventStart = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 0, 30, 0)).toISOString()
    const eventEnd = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 0, 45, 0)).toISOString()
    const expectedResizedStart = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() - 1, 23, 30, 0)).toISOString()

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') {
        return { data: { sources: [] } }
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
                slot_minutes: 15,
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
            events: [
              {
                id: 'event-midnight-edge',
                title: 'Edge drag item',
                description: null,
                meeting_link: null,
                location: null,
                start_time: eventStart,
                end_time: eventEnd,
                source_type: 'manual',
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

    mockComputeDayLayout.mockReturnValue({
      eventSegments: [
        {
          eventId: 'event-midnight-edge',
          eventIndex: 0,
          top: 100,
          height: 26,
          leftPercent: 0,
          widthPercent: 100,
          isFirstSegment: true,
        },
      ],
      overflowSegments: [],
    })

    mockApiPut.mockResolvedValue({ data: {} })

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    const [itemTitle] = await screen.findAllByText('Edge drag item')
    const itemContainer = itemTitle.closest<HTMLDivElement>('[data-time-management-item="true"]')
    expect(itemContainer).toBeTruthy()
    if (!itemContainer) {
      throw new Error('Expected the start-edge resize item')
    }

    const dayColumns = Array.from(document.querySelectorAll<HTMLDivElement>('div[style*="background-image"]'))
    expect(dayColumns.length).toBeGreaterThanOrEqual(7)

    const dayColumn = dayColumns[0]
    if (!dayColumn) {
      throw new Error('Expected at least one day column')
    }

    Object.defineProperty(dayColumn, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 100,
        bottom: 2496,
        width: 100,
        height: 2496,
        toJSON: () => ({}),
      }),
    })

    Object.defineProperty(itemContainer, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 0,
        y: 100,
        top: 100,
        left: 0,
        right: 100,
        bottom: 126,
        width: 100,
        height: 26,
        toJSON: () => ({}),
      }),
    })

    fireEvent.pointerDown(itemContainer, {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 20,
      clientY: 100,
    })
    fireEvent.mouseDown(dayColumn, { button: 0, clientX: 20, clientY: 100 })
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 20, clientY: -52 })
    fireEvent.mouseMove(window, { clientX: 20, clientY: -52 })

    expect(
      Array.from(document.querySelectorAll<HTMLElement>('[data-time-management-item="true"]'))
        .some((element) => element.style.animation.includes('move-source-ghost'))
    ).toBe(false)

    fireEvent.mouseUp(window, { clientX: 20, clientY: -52 })

    await waitFor(() => {
      expect(mockApiPut).toHaveBeenCalledWith('/api/user-events/event-midnight-edge', {
        start_time: expectedResizedStart,
        end_time: eventEnd,
      })
    })
  })

  it.each(['this', 'future', 'cancel'])('asks before persisting a recurring resize and applies scope %s', async (scope) => {
    const weekStart = new Date()
    weekStart.setHours(0, 0, 0, 0)
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7))

    const baseStart = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 1, 0, 0)).toISOString()
    const baseEnd = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 1, 15, 0)).toISOString()

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') {
        return { data: { sources: [] } }
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
                slot_minutes: 15,
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
            events: [
              {
                id: 'event-recurring-resize',
                title: 'Recurring resize target',
                description: null,
                meeting_link: null,
                location: null,
                start_time: baseStart,
                end_time: baseEnd,
                source_type: 'manual',
                source_id: 'coord-main',
                category_ids: [],
                recurrence_rule: { type: 'weekly' },
              },
            ],
          },
        }
      }
      return { data: {} }
    })

    mockComputeDayLayout.mockReturnValue({
      eventSegments: [
        {
          eventId: 'event-recurring-resize',
          eventIndex: 0,
          top: 104,
          height: 26,
          leftPercent: 0,
          widthPercent: 100,
          isFirstSegment: true,
        },
      ],
      overflowSegments: [],
    })

    mockApiPut.mockResolvedValue({ data: { event: { id: 'event-recurring-resize' } } })
    mockApiPost.mockImplementation(async (url: string, payload?: unknown) => {
      if (url !== '/api/user-events') {
        return { data: {} }
      }
      const posted = payload as {
        title: string
        description: string | null
        start_time: string
        end_time: string
        category_ids: string[]
        source_id: string
        recurrence_rule: { type: 'none' }
      }

      return {
        data: {
          event: {
            id: 'event-occurrence-resized',
            title: posted.title,
            description: posted.description,
            meeting_link: null,
            location: null,
            start_time: posted.start_time,
            end_time: posted.end_time,
            source_type: 'manual',
            source_id: posted.source_id,
            category_ids: posted.category_ids,
            recurrence_rule: posted.recurrence_rule,
          },
        },
      }
    })

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    await waitFor(() => {
      expect(document.querySelectorAll('.time-item-resize-handle-bottom').length).toBeGreaterThan(0)
    })

    const dayColumns = Array.from(document.querySelectorAll<HTMLDivElement>('div[style*="background-image"]'))
    expect(dayColumns.length).toBeGreaterThanOrEqual(7)

    const dayColumn = dayColumns[0]
    if (!dayColumn) {
      throw new Error('Expected at least one day column')
    }

    Object.defineProperty(dayColumn, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 100,
        bottom: 2496,
        width: 100,
        height: 2496,
        toJSON: () => ({}),
      }),
    })

    fireEvent.mouseDown(dayColumn, { button: 0, clientX: 20, clientY: 130 })
    fireEvent.mouseMove(window, { clientX: 20, clientY: 156 })
    fireEvent.mouseUp(window)

    await screen.findByRole('dialog', { name: 'Edit recurring item' })
    expect(mockApiPut.mock.calls.filter(([url]) => url === '/api/user-events/event-recurring-resize')).toHaveLength(0)
    expect(mockApiPost).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', {
      name: scope === 'this' ? 'This item only' : scope === 'future' ? 'This and future occurrences' : 'Cancel',
    }))
    if (scope === 'cancel') {
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit recurring item' })).not.toBeInTheDocument())
      expect(mockApiPut.mock.calls.filter(([url]) => url === '/api/user-events/event-recurring-resize')).toHaveLength(0)
      expect(mockApiPost).not.toHaveBeenCalled()
      expect(mockApiDelete).not.toHaveBeenCalled()
      return
    }

    await waitFor(() => {
      expect(mockApiPut).toHaveBeenCalledWith(
        '/api/user-events/event-recurring-resize',
        expect.objectContaining({
          recurrence_rule: expect.objectContaining({ type: 'weekly' }),
        })
      )
      expect(mockApiPost).toHaveBeenCalledWith(
        '/api/user-events',
        expect.objectContaining({
          recurrence_rule: scope === 'this' ? { type: 'none' } : expect.objectContaining({ type: 'weekly' }),
        })
      )
    })

    const directResizePayload = mockApiPut.mock.calls.find((call) => {
      if (call[0] !== '/api/user-events/event-recurring-resize') return false
      const payload = call[1] as Record<string, unknown>
      return Object.prototype.hasOwnProperty.call(payload, 'start_time')
        || Object.prototype.hasOwnProperty.call(payload, 'end_time')
    })
    expect(directResizePayload).toBeUndefined()

    expect(mockApiDelete).not.toHaveBeenCalled()
  })

  it('only resizes from outward borders of a split item, not internal slice boundaries', async () => {
    const weekStart = new Date()
    weekStart.setHours(0, 0, 0, 0)
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7))

    const eventStart = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 13, 30, 0)).toISOString()
    const eventEnd = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 14, 30, 0)).toISOString()
    const expectedResizedEnd = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 15, 0, 0)).toISOString()

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') {
        return { data: { sources: [] } }
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
        return { data: { categories: [] } }
      }
      if (url === '/api/user-events') {
        return {
          data: {
            events: [
              {
                id: 'event-sliced-resize',
                title: 'Sliced Item',
                description: null,
                meeting_link: null,
                location: null,
                start_time: eventStart,
                end_time: eventEnd,
                source_type: 'manual',
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

    // One item split into two touching slices (e.g. narrowed by an overlap):
    // 13:30-14:00 (first slice) and 14:00-14:30 (second slice). The boundary
    // at 14:00 is internal to the item and must not act as a resize edge.
    mockComputeDayLayout.mockReturnValue({
      eventSegments: [
        {
          eventId: 'event-sliced-resize',
          eventIndex: 0,
          top: 702,
          height: 26,
          leftPercent: 0,
          widthPercent: 100,
          isFirstSegment: true,
        },
        {
          eventId: 'event-sliced-resize',
          eventIndex: 0,
          top: 728,
          height: 26,
          leftPercent: 0,
          widthPercent: 100,
          isFirstSegment: false,
        },
      ],
      overflowSegments: [],
    })

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    await waitFor(() => {
      expect(screen.getAllByText('Sliced Item').length).toBeGreaterThan(0)
    })

    const dayColumns = Array.from(document.querySelectorAll<HTMLDivElement>('div[style*="background-image"]'))
    expect(dayColumns.length).toBeGreaterThanOrEqual(7)

    const dayColumn = dayColumns[0]
    if (!dayColumn) {
      throw new Error('Expected at least one day column')
    }

    Object.defineProperty(dayColumn, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 100,
        bottom: 1248,
        width: 100,
        height: 1248,
        toJSON: () => ({}),
      }),
    })

    // Outward edges keep the resize cursor...
    fireEvent.mouseMove(dayColumn, { clientX: 20, clientY: 702 })
    expect(dayColumn.style.cursor).toBe('ns-resize')
    fireEvent.mouseMove(dayColumn, { clientX: 20, clientY: 754 })
    expect(dayColumn.style.cursor).toBe('ns-resize')

    // ...but the internal boundary between slices of the same item does not.
    fireEvent.mouseMove(dayColumn, { clientX: 20, clientY: 728 })
    expect(dayColumn.style.cursor).toBe('default')

    // Dragging from the internal boundary must not start a resize.
    fireEvent.mouseDown(dayColumn, { button: 0, clientX: 20, clientY: 728 })
    fireEvent.mouseMove(window, { clientX: 20, clientY: 741 })
    fireEvent.mouseUp(window)
    fireEvent.pointerUp(window)

    expect(
      mockApiPut.mock.calls.filter((call) => call[0] === '/api/user-events/event-sliced-resize')
    ).toHaveLength(0)

    // The outward bottom edge still resizes the item.
    fireEvent.mouseDown(dayColumn, { button: 0, clientX: 20, clientY: 754 })
    fireEvent.mouseMove(window, { clientX: 20, clientY: 780 })
    fireEvent.mouseUp(window)

    await waitFor(() => {
      expect(mockApiPut).toHaveBeenCalledWith(
        '/api/user-events/event-sliced-resize',
        expect.objectContaining({
          start_time: eventStart,
          end_time: expectedResizedEnd,
        })
      )
    })
  })

  it('allows new selection to extend beyond 00:00 UTC and saves as a cross-day item', async () => {
    const weekStart = new Date()
    weekStart.setHours(0, 0, 0, 0)
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7))

    const expectedStart = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 23, 30, 0)).toISOString()
    const expectedEnd = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 1, 1, 0, 0)).toISOString()

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') {
        return { data: { sources: [] } }
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
        return { data: { categories: [] } }
      }
      if (url === '/api/user-events') {
        return { data: { events: [] } }
      }
      return { data: {} }
    })

    mockApiPost.mockImplementation(async (url: string, payload?: unknown) => {
      if (url === '/api/user-events') {
        const posted = payload as {
          title: string
          description?: string | null
          start_time: string
          end_time: string
          category_ids?: string[]
          source_id?: string
          recurrence_rule?: { type: string }
        }
        return {
          data: {
            event: {
              id: 'created-cross-day',
              title: posted.title,
              description: posted.description ?? null,
              meeting_link: null,
              location: null,
              start_time: posted.start_time,
              end_time: posted.end_time,
              source_type: 'manual',
              source_id: posted.source_id ?? 'coord-main',
              category_ids: posted.category_ids ?? [],
              recurrence_rule: posted.recurrence_rule ?? { type: 'none' },
            },
          },
        }
      }

      if (url === '/api/user-events/sync-imports') {
        return { data: { inserted: 0, updated: 0, deleted: 0, syncedSources: 0 } }
      }

      return { data: {} }
    })

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })

    const dayColumns = Array.from(document.querySelectorAll<HTMLDivElement>('div[style*="background-image"]'))
    expect(dayColumns.length).toBeGreaterThanOrEqual(7)

    const dayColumn = dayColumns[0]
    if (!dayColumn) {
      throw new Error('Expected at least one day column')
    }

    Object.defineProperty(dayColumn, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 100,
        bottom: 600,
        width: 100,
        height: 600,
        toJSON: () => ({}),
      }),
    })

    fireEvent.mouseDown(dayColumn, { button: 0, clientX: 20, clientY: 590 })
    fireEvent.mouseMove(dayColumn, { clientX: 20, clientY: 620 })
    fireEvent.mouseUp(window)

    fireEvent.keyDown(window, { key: 'N' })
    fireEvent.keyDown(window, { key: 'Enter' })

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/api/user-events', expect.objectContaining({
        start_time: expectedStart,
        end_time: expectedEnd,
      }))
    })
  })

  it('runs Escape side-panel actions one at a time by priority', async () => {
    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })

    fireEvent.click(screen.getByTitle('Show left panel'))
    await waitFor(() => {
      expect(screen.getByTitle('Hide left panel')).toBeInTheDocument()
    })

    const monthButton = screen.queryByRole('button', { name: 'Month Overview' })
    expect(monthButton).toBeTruthy()

    if (!monthButton) {
      throw new Error('Expected month overview toggle button to be present')
    }

    if (monthButton.getAttribute('aria-expanded') === 'false') {
      fireEvent.click(monthButton)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Month Overview', expanded: true })).toBeInTheDocument()
      })
    }

    fireEvent.keyDown(document.body, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.getByTitle('Hide left panel')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Month Overview', expanded: false })).toBeInTheDocument()
    })

    fireEvent.keyDown(document.body, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.getByTitle('Show left panel')).toBeInTheDocument()
    })

    fireEvent.keyDown(document.body, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.getByTitle('Hide left panel')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Month Overview', expanded: false })).toBeInTheDocument()
    })
  })

  it('closes the side panel when Escape is pressed with no active selection', async () => {
    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })

    fireEvent.click(screen.getByTitle('Show left panel'))
    await waitFor(() => {
      expect(screen.getByTitle('Hide left panel')).toBeInTheDocument()
    })

    expect(screen.getByTitle('Hide left panel')).toBeInTheDocument()

    fireEvent.keyDown(document.body, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.getByTitle('Show left panel')).toBeInTheDocument()
    })
  })

  it('recenters the looped calendar scroll when it approaches an edge copy', async () => {
    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })

    const scrollContainer = screen.getByTestId('calendar-scroll-container') as HTMLDivElement
    const repeatHeight = 100
    const repeatCopy = document.createElement('div')

    Object.defineProperty(repeatCopy, 'offsetHeight', {
      configurable: true,
      value: repeatHeight,
    })
    Object.defineProperty(scrollContainer, 'firstElementChild', {
      configurable: true,
      value: repeatCopy,
    })
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 0,
    })

    fireEvent.scroll(scrollContainer)

    expect(scrollContainer.scrollTop).toBe(repeatHeight)
  })

  it('reopens the side panel when Escape is pressed while the panel is already closed', async () => {
    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })

    fireEvent.click(screen.getByTitle('Show left panel'))
    await waitFor(() => {
      expect(screen.getByTitle('Hide left panel')).toBeInTheDocument()
    })

    const monthButton =
      screen.queryByRole('button', { name: 'Month Overview' })
    expect(monthButton).toBeTruthy()

    if (!monthButton) {
      throw new Error('Expected month overview toggle button to be present')
    }

    if (monthButton.getAttribute('aria-expanded') === 'false') {
      fireEvent.click(monthButton)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Month Overview', expanded: true })).toBeInTheDocument()
      })
    }

    fireEvent.click(screen.getByTitle('Hide left panel'))
    await waitFor(() => {
      expect(screen.getByTitle('Show left panel')).toBeInTheDocument()
    })

    fireEvent.keyDown(document.body, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.getByTitle('Hide left panel')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Month Overview', expanded: false })).toBeInTheDocument()
    })
  })

  it('collapses side panel sections when closed from the button', async () => {
    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })

    fireEvent.click(screen.getByTitle('Show left panel'))
    await waitFor(() => {
      expect(screen.getByTitle('Hide left panel')).toBeInTheDocument()
    })

    const monthButton =
      screen.queryByRole('button', { name: 'Month Overview' })
    expect(monthButton).toBeTruthy()

    if (!monthButton) {
      throw new Error('Expected month overview toggle button to be present')
    }

    if (monthButton.getAttribute('aria-expanded') === 'false') {
      fireEvent.click(monthButton)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Month Overview', expanded: true })).toBeInTheDocument()
      })
    }

    fireEvent.click(screen.getByTitle('Close side panel'))

    await waitFor(() => {
      expect(screen.getByTitle('Show left panel')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTitle('Show left panel'))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Month Overview', expanded: false })).toBeInTheDocument()
    })
  })

  it('closes the side panel when Escape is pressed from the full editor modal', async () => {
    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })

    fireEvent.click(screen.getByTitle('Show left panel'))
    await waitFor(() => {
      expect(screen.getByTitle('Hide left panel')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Full view'))

    await screen.findByText('Use the full view to draft long notes, templates, and checklists.')

    fireEvent.keyDown(document.body, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByText('Use the full view to draft long notes, templates, and checklists.')).not.toBeInTheDocument()
      expect(screen.getByTitle('Hide left panel')).toBeInTheDocument()
    })
  })

  it('shows the API error when meeting retrieval fails', async () => {
    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/user-events') {
        throw new Error('Failed to load meetings for test')
      }
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
      return { data: {} }
    })

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    expect(await screen.findByText('Failed to load meetings for test')).toBeInTheDocument()
  })

  it('allows traveler accounts to load personal time-management data, without sync sources', async () => {
    mockUseAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      isTraveler: true,
    })

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    expect(await screen.findByRole('heading', { name: 'Time Management' })).toBeInTheDocument()

    await waitFor(() => {
      expect(mockDedupedGet).toHaveBeenCalled()
    })

    const calledUrls = mockDedupedGet.mock.calls.map((call) => String(call[0]))
    expect(calledUrls).toContain('/api/time-management/modes')
    expect(calledUrls).toContain('/api/time-management/categories')
    expect(calledUrls).toContain('/api/time-management/prefs')
    expect(calledUrls).toContain('/api/user-events')
    expect(calledUrls).not.toContain('/api/calendar-sources')
  })

  it('keeps quick objects disabled by default for first-time anonymous visitors', async () => {
    mockUseAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: false,
      isTraveler: false,
    })

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    expect(await screen.findByRole('heading', { name: 'Time Management' })).toBeInTheDocument()

    await waitFor(() => {
      const raw = localStorage.getItem('time-management-v1')
      expect(raw).toBeTruthy()
      const parsed = JSON.parse(raw as string) as { showQuickTemplatesInMain?: boolean }
      expect(parsed.showQuickTemplatesInMain).toBe(false)
    })

    expect(screen.queryByText('No templates yet. Use Quick Objects in the left panel to create one.')).not.toBeInTheDocument()
    expect(mockDedupedGet).not.toHaveBeenCalledWith('/api/time-management/modes')
  })

  it('defaults new connected calendars to enabled when no preference exists', async () => {
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
      if (url === '/api/time-management/categories') return { data: { categories: [] } }
      if (url === '/api/user-events') return { data: { events: [] } }
      return { data: {} }
    })

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(mockDedupedGet).toHaveBeenCalledWith('/api/calendar-sources')
    })

    // The connected source is merged into syncCalendars asynchronously, so wait for
    // the persisted preferences to include it. The built-in main calendar and any
    // newly connected calendar both default to enabled when no preference exists.
    await waitFor(() => {
      const raw = localStorage.getItem('time-management-v1')
      expect(raw).toBeTruthy()
      const parsed = JSON.parse(raw as string) as { syncCalendars: Array<{ id: string; enabled: boolean }> }
      expect(parsed.syncCalendars).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'coord-main', enabled: true }),
          expect.objectContaining({ id: 'google-1', enabled: true }),
        ])
      )
    })
  })

  it('keeps persisted source selections across auth loading transition', async () => {
    localStorage.setItem(
      'time-management-v1',
      JSON.stringify({
        syncCalendars: [
          {
            id: 'coord-main',
            name: 'Coordination Manager Main',
            color: '#2563eb',
            enabled: false,
            sourceType: 'app',
          },
          {
            id: 'google-1',
            name: 'Google Personal',
            color: '#34d399',
            enabled: true,
            sourceType: 'external',
            externalKind: 'google_oauth',
            secondaryLabel: 'user@example.com',
          },
        ],
        slotMinutes: 30,
        timeBackgrounds: [],
        collapsedBackgroundIds: [],
        quickTemplates: [],
        showQuickTemplatesInMain: false,
      })
    )

    const authState = {
      isLoading: true,
      isAuthenticated: false,
      isTraveler: false,
    }
    mockUseAuth.mockImplementation(() => authState)

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
      if (url === '/api/time-management/categories') return { data: { categories: [] } }
      if (url === '/api/user-events') return { data: { events: [] } }
      return { data: {} }
    })

    const rendered = render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(mockDedupedGet).not.toHaveBeenCalledWith('/api/calendar-sources')
    })

    authState.isLoading = false
    authState.isAuthenticated = true
    rendered.rerender(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(mockDedupedGet).toHaveBeenCalledWith('/api/calendar-sources')
    })

    const raw = localStorage.getItem('time-management-v1')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw as string) as { syncCalendars: Array<{ id: string; enabled: boolean }> }

    expect(parsed.syncCalendars).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'google-1', enabled: true }),
      ])
    )
  })

  it('refreshes categories when switching modes', async () => {
    let activeModeId = 'mode-main'

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') {
        return { data: { sources: [] } }
      }
      if (url === '/api/time-management/modes') {
        return {
          data: {
            activeModeId,
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
              {
                id: 'mode-focus',
                name: 'Focus',
                main_color: '#0891b2',
                slot_minutes: 15,
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
            categories: activeModeId === 'mode-main'
              ? [{ id: 'cat-main', label: 'Main category', color: '#2563eb', font_color: '#ffffff', sort_order: 0 }]
              : [{ id: 'cat-focus', label: 'Focus category', color: '#0891b2', font_color: '#ffffff', sort_order: 0 }],
          },
        }
      }
      if (url === '/api/user-events') {
        return { data: { events: [] } }
      }
      return { data: {} }
    })

    mockApiPost.mockImplementation(async (url: string) => {
      if (url === '/api/time-management/modes/mode-focus/activate') {
        activeModeId = 'mode-focus'
        return { data: { activeModeId } }
      }
      return { data: { inserted: 0, updated: 0, deleted: 0, syncedSources: 0 } }
    })

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })

    fireEvent.click(screen.getByRole('button', { name: 'Categories', expanded: false }))
    expect(await screen.findByText('Main category')).toBeInTheDocument()

    const categoryFetchCountBeforeSwitch = mockDedupedGet.mock.calls.filter(
      (call) => call[0] === '/api/time-management/categories'
    ).length

    fireEvent.click(screen.getByRole('button', { name: 'Calendar Modes', expanded: false }))
    fireEvent.click(screen.getByRole('button', { name: 'Focus' }))

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/api/time-management/modes/mode-focus/activate')
    })

    await waitFor(() => {
      const categoryFetchCountAfterSwitch = mockDedupedGet.mock.calls.filter(
        (call) => call[0] === '/api/time-management/categories'
      ).length
      expect(categoryFetchCountAfterSwitch).toBeGreaterThan(categoryFetchCountBeforeSwitch)
    })

    expect(await screen.findByText('Focus category')).toBeInTheDocument()
    expect(screen.queryByText('Main category')).not.toBeInTheDocument()
  })

  it('uses in-app delete confirmation for category deletion', async () => {
    const browserConfirmSpy = vi.spyOn(window, 'confirm')
    mockApiDelete.mockResolvedValue({ data: { message: 'Category deleted' } })

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') {
        return { data: { sources: [] } }
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
            categories: [{ id: 'cat-work', label: 'Work', color: '#2563eb', font_color: '#ffffff', sort_order: 0 }],
          },
        }
      }
      if (url === '/api/user-events') {
        return { data: { events: [] } }
      }
      return { data: {} }
    })

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    fireEvent.click(screen.getByRole('button', { name: 'Categories', expanded: false }))
    expect(await screen.findByText('Work')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete Work' }))

    expect(await screen.findByText('Delete category?')).toBeInTheDocument()
    expect(screen.getByText('Delete category "Work"? It will be removed from any items that use it.')).toBeInTheDocument()
    expect(browserConfirmSpy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }))

    await waitFor(() => {
      expect(mockApiDelete).toHaveBeenCalledWith('/api/time-management/categories/cat-work')
    })

    browserConfirmSpy.mockRestore()
  })

  it('uses the active mode slot width when persisted local width differs', async () => {
    localStorage.setItem(
      'time-management-v1',
      JSON.stringify({
        syncCalendars: [
          {
            id: 'coord-main',
            name: 'Coordination Manager Main',
            color: '#2563eb',
            enabled: false,
            sourceType: 'app',
          },
        ],
        slotMinutes: 15,
        timeBackgrounds: [],
        collapsedBackgroundIds: [],
        quickTemplates: [],
        showQuickTemplatesInMain: true,
      })
    )

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') {
        return { data: { sources: [] } }
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
                slot_minutes: 60,
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
      if (url === '/api/user-events') return { data: { events: [] } }
      return { data: {} }
    })

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await waitFor(() => {
      const raw = localStorage.getItem('time-management-v1')
      expect(raw).toBeTruthy()
      const parsed = JSON.parse(raw as string) as { slotMinutes: number }
      expect(parsed.slotMinutes).toBe(60)
    })
  })
})

describe('findTimeItemDurationByTitle', () => {
  const items = [
    {
      id: 'coordination-manager',
      title: 'Coordination Manager',
      time: { startUtc: '2026-09-01T09:00:00.000Z', endUtc: '2026-09-01T11:00:00.000Z' },
    },
    {
      id: 'coordination-manager',
      title: 'Coordination Manager',
      time: { startUtc: '2026-09-01T09:00:00.000Z', endUtc: '2026-09-01T11:00:00.000Z' },
    },
    {
      id: 'coordination-manager',
      title: 'Coordination Manager',
      time: { startUtc: '2026-09-02T13:00:00.000Z', endUtc: '2026-09-02T14:30:00.000Z' },
    },
    {
      id: 'unrelated',
      title: 'Governance Workgroup',
      time: { startUtc: '2026-09-01T12:00:00.000Z', endUtc: '2026-09-01T15:00:00.000Z' },
    },
  ]

  it('totals matching title occurrences once and ignores unrelated items', () => {
    expect(findTimeItemDurationByTitle('How many hours did I develop Coordination Manager?', items)).toEqual({
      title: 'Coordination Manager',
      occurrenceCount: 2,
      totalMinutes: 210,
    })
  })

  it('returns null when the requested title is not present', () => {
    expect(findTimeItemDurationByTitle('How many hours did I work on Mailbox?', items)).toBeNull()
  })
})
