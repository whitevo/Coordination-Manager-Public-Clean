import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CoordinateEventsPage from '../CoordinateEventsPage'
import { apiClient } from '../../lib/api-client'
import { MOBILE_NAVIGATION_PANEL_DISMISS_EVENT } from '../../hooks/use-mobile-navigation-panel-dismiss'
import { OVERLAY_BASE_Z, OVERLAY_SCRIM } from '../../lib/overlay-layers'

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }))

vi.mock('../../lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'user@example.com' },
    isAuthenticated: true,
    isLoading: false,
  }),
}))

vi.mock('../../components/Toast', () => ({
  useToast: () => ({
    showToast,
  }),
}))

vi.mock('../../components/TimezoneSelector', () => ({
  default: () => <div data-testid="timezone-selector" />,
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
    canAddMore: false,
    getEntry: vi.fn(),
  }),
}))

vi.mock('../../contexts/LayoutContext', () => ({
  LeftPanelPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

type UserEventRecord = {
  id: string
  user_id: string
  source_type: 'manual' | 'google_oauth'
  source_id: string | null
  external_event_id: string | null
  title: string
  description: string | null
  meeting_link: string | null
  location: string | null
  start_time: string
  end_time: string
  is_public: boolean
  recurrence_rule?: unknown
  created_at: string
  updated_at: string
}

function makeEvent(overrides: Partial<UserEventRecord>): UserEventRecord {
  return {
    id: 'event-default',
    user_id: 'user-1',
    source_type: 'manual',
    source_id: null,
    external_event_id: null,
    title: 'Secret Swarm event title',
    description: null,
    meeting_link: null,
    location: null,
    start_time: '2026-06-10T10:00:00Z',
    end_time: '2026-06-10T11:00:00Z',
    is_public: false,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  }
}

async function flushPage() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(600)
  })
}

describe('CoordinateEventsPage network filters', { timeout: 20000 }, () => {
  const mainEventTitle = 'Secret Swarm planning session'
  const teamEventTitle = 'Team sync event'

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-10T12:00:00Z'))
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
    window.localStorage.clear()

    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/api/user-events') {
        return {
          data: {
            events: [
              makeEvent({
                id: 'main-event',
                title: 'Secret Swarm planning session',
              }),
              makeEvent({
                id: 'team-event',
                source_type: 'google_oauth',
                source_id: 'calendar-1',
                title: 'Team sync event',
                start_time: '2026-06-10T13:00:00Z',
                end_time: '2026-06-10T14:00:00Z',
              }),
            ],
          },
        }
      }

      if (url === '/api/calendar-sources') {
        return {
          data: {
            sources: [
              {
                id: 'calendar-1',
                source_type: 'google_oauth',
                google_email: 'team@example.com',
                public_url: null,
                display_name: 'Team Calendar',
                color: '#3B82F6',
                is_active: true,
              },
            ],
          },
        }
      }

      if (url === '/api/calendar-subscriptions') {
        return { data: { subscriptions: [] } }
      }

      if (url === '/api/calendar-subscriptions/meetings') {
        return { data: { meetings: [] } }
      }

      if (url === '/api/user-events/sync-prefs') {
        return { data: { prefs: [] } }
      }

      throw new Error(`Unexpected GET ${url}`)
    })

    vi.mocked(apiClient.post).mockResolvedValue({ data: {} })
    vi.mocked(apiClient.put).mockResolvedValue({ data: {} })
    vi.mocked(apiClient.delete).mockResolvedValue({ data: {} })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('styles Commons as an ordinary tool and still opens its panel', async () => {
    const openCommons = vi.fn()
    window.addEventListener('openCommonsPanel', openCommons)
    try {
      render(<MemoryRouter><CoordinateEventsPage /></MemoryRouter>)
      await flushPage()
      const commons = screen.getByRole('button', { name: 'Commons' })
      expect(commons).toHaveClass('border-border', 'text-foreground')
      expect(commons.className).not.toMatch(/danger|rose/)
      fireEvent.click(commons)
      expect(openCommons).toHaveBeenCalledOnce()
    } finally {
      window.removeEventListener('openCommonsPanel', openCommons)
    }
  })

  it('hides mobile calendar tools on header navigation and retains its filter settings', async () => {
    const originalWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })))
    try {
      render(<MemoryRouter><CoordinateEventsPage /></MemoryRouter>)
      await flushPage()
      act(() => window.dispatchEvent(new Event('openCommonsPanel')))
      const panel = screen.getByTestId('coordinate-events-tools-panel')
      expect(panel).toHaveAttribute('data-open', 'true')
      expect(panel).toHaveClass('visible')
      act(() => window.dispatchEvent(new Event(MOBILE_NAVIGATION_PANEL_DISMISS_EVENT)))
      expect(panel).toHaveAttribute('data-open', 'false')
      expect(panel).toHaveClass('invisible')
      act(() => window.dispatchEvent(new Event('openCommonsPanel')))
      expect(panel).toHaveAttribute('data-open', 'true')
      expect(panel).toHaveClass('visible')
    } finally {
      vi.unstubAllGlobals()
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
    }
  })

  it('opens the phone tools drawer on the drawer tier below the nav, with Escape and focus return', async () => {
    const originalWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })))
    const nav = document.createElement('nav')
    nav.setAttribute('data-app-nav', '')
    nav.getBoundingClientRect = () => ({ bottom: 56 } as DOMRect)
    document.body.appendChild(nav)
    try {
      render(<MemoryRouter><CoordinateEventsPage /></MemoryRouter>)
      await flushPage()
      const panel = screen.getByTestId('coordinate-events-tools-panel')
      expect(panel).toHaveAttribute('data-open', 'false')
      expect(screen.queryByTestId('coordinate-events-tools-scrim')).not.toBeInTheDocument()

      const trigger = screen.getByRole('button', { name: /^Tools/ })
      trigger.focus()
      fireEvent.click(trigger)
      expect(panel).toHaveAttribute('data-open', 'true')
      const scrim = screen.getByTestId('coordinate-events-tools-scrim')
      expect(scrim).toHaveClass(OVERLAY_SCRIM.drawer)
      expect(Number(scrim.style.zIndex)).toBeGreaterThanOrEqual(OVERLAY_BASE_Z.drawer)
      expect(panel.style.zIndex).toBe(scrim.style.zIndex)
      expect(panel.className).not.toMatch(/\bz-\d+/)
      expect(panel).toHaveClass('fixed', 'left-0', 'bottom-0')
      expect(panel.style.top).toBe('56px')
      expect(screen.getByRole('button', { name: 'Hide side panel' })).toHaveFocus()

      fireEvent.keyDown(window, { key: 'Escape' })
      expect(panel).toHaveAttribute('data-open', 'false')
      expect(screen.queryByTestId('coordinate-events-tools-scrim')).not.toBeInTheDocument()
      expect(trigger).toHaveFocus()

      fireEvent.click(trigger)
      fireEvent.click(screen.getByTestId('coordinate-events-tools-scrim'))
      expect(panel).toHaveAttribute('data-open', 'false')
    } finally {
      nav.remove()
      vi.unstubAllGlobals()
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
    }
  })

  it('keeps the desktop tools panel in flow without a drawer scrim', async () => {
    render(<MemoryRouter><CoordinateEventsPage /></MemoryRouter>)
    await flushPage()
    const panel = screen.getByTestId('coordinate-events-tools-panel')
    expect(panel).toHaveClass('sticky', 'w-0')
    act(() => window.dispatchEvent(new Event('openCommonsPanel')))
    expect(panel).toHaveClass('sticky', 'w-96')
    expect(panel).not.toHaveClass('fixed')
    expect(panel.style.zIndex).toBe('')
    expect(screen.queryByTestId('coordinate-events-tools-scrim')).not.toBeInTheDocument()
  })

  it('defaults Secret Swarm to hidden while preserving labels and allowing user override', async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <CoordinateEventsPage />
        </MemoryRouter>
      )
    })

    await flushPage()

    expect(screen.queryByTitle(mainEventTitle)).not.toBeInTheDocument()
    expect(screen.getByTitle(teamEventTitle)).toBeInTheDocument()
    expect(screen.getByTitle('Volatire Swarm as data controller')).toHaveTextContent('Secret Swarm')

    expect(screen.getByText('Calendar mode')).toBeInTheDocument()
    expect(screen.getAllByText('Secret Swarm').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Main').length).toBeGreaterThan(0)
    expect(screen.queryByText('Manual')).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Secret Swarm filter Hide' }))
    })
    expect(screen.getByTitle(mainEventTitle)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Secret Swarm filter All' })).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Team Calendar filter All' }))
    })
    expect(screen.getByTitle(mainEventTitle)).toBeInTheDocument()
    expect(screen.getByTitle('Team sync event')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Team Calendar filter Pin' })).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Team Calendar filter Pin' }))
    })
    expect(screen.queryByTitle(mainEventTitle)).not.toBeInTheDocument()
    expect(screen.getByTitle('Team sync event')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Team Calendar filter Only' })).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Team Calendar filter Only' }))
    })
    expect(screen.getByTitle(mainEventTitle)).toBeInTheDocument()
    expect(screen.queryByTitle(teamEventTitle)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Team Calendar filter Hide' })).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Team Calendar filter Hide' }))
    })
    expect(screen.getByTitle(mainEventTitle)).toBeInTheDocument()
    expect(screen.getByTitle(teamEventTitle)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Team Calendar filter All' })).toBeInTheDocument()
  })

  it('does not save sync preferences before server hydration completes', async () => {
    let resolveSyncPrefs: ((value: { data: { prefs: Array<Record<string, unknown>> } }) => void) | null = null

    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/api/user-events') {
        return { data: { events: [] } }
      }

      if (url === '/api/calendar-sources') {
        return { data: { sources: [] } }
      }

      if (url === '/api/calendar-subscriptions') {
        return { data: { subscriptions: [] } }
      }

      if (url === '/api/calendar-subscriptions/meetings') {
        return { data: { meetings: [] } }
      }

      if (url === '/api/user-events/sync-prefs') {
        return new Promise(resolve => {
          resolveSyncPrefs = resolve
        })
      }

      throw new Error(`Unexpected GET ${url}`)
    })

    await act(async () => {
      render(
        <MemoryRouter>
          <CoordinateEventsPage />
        </MemoryRouter>
      )
      await Promise.resolve()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(600)
    })

    expect(vi.mocked(apiClient.put)).not.toHaveBeenCalledWith('/api/user-events/sync-prefs', expect.anything())

    await act(async () => {
      resolveSyncPrefs?.({
        data: {
          prefs: [
            {
              source_type: 'google_oauth',
              source_id: 'calendar-1',
              range_months: 24,
              auto_publish_new: true,
            },
          ],
        },
      })
      await Promise.resolve()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(600)
    })
  })

  it('keeps View and Select separate and disallows row selection for hidden networks', async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <CoordinateEventsPage />
        </MemoryRouter>
      )
    })

    await flushPage()

    expect(screen.getByText('View')).toBeInTheDocument()
    expect(screen.getByText('Select')).toBeInTheDocument()
    expect(screen.queryByText('The functions below are activated for selected networks.')).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'Team Calendar selected' }))
    })
    expect(screen.getByText('The functions below are activated for selected networks.')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByTitle('Cycle Team Calendar filter'))
      fireEvent.click(screen.getByTitle('Cycle Team Calendar filter'))
      fireEvent.click(screen.getByTitle('Cycle Team Calendar filter'))
    })

    expect(screen.getByRole('checkbox', { name: 'Team Calendar selection unavailable while hidden' })).toBeDisabled()
    expect(screen.queryByText('The functions below are activated for selected networks.')).not.toBeInTheDocument()
  })

  async function renderSubscriptions() {
    const baseGet = vi.mocked(apiClient.get).getMockImplementation()
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/api/calendar-subscriptions') {
        return { data: { subscriptions: [{
          id: 'sub-1', calendar_id: 'cal-1', created_at: '2026-06-01T00:00:00Z',
          calendars: { id: 'cal-1', hash: 'publicHash', title: 'Subscribed planning', visibility: 'public' },
        }] } }
      }
      if (url === '/api/calendar-subscriptions/meetings') {
        return { data: { meetings: [{
          id: 'sub-meeting', calendar_id: 'cal-1', calendar_hash: 'publicHash',
          calendar_title: 'Subscribed planning', title: 'Subscribed meeting',
          description: null, start_time: '2026-06-10T10:00:00',
          end_time: '2026-06-10T11:00:00', duration_minutes: 60,
          meeting_link: null, created_at: '2026-06-01T00:00:00Z', source_type: 'subscription',
        }] } }
      }
      if (!baseGet) throw new Error('Missing base API mock')
      return baseGet(url)
    })
    await act(async () => {
      render(
        <MemoryRouter>
          <CoordinateEventsPage />
        </MemoryRouter>,
      )
    })
    await flushPage()
    fireEvent.click(screen.getByTitle('Show subscribed'))
  }

  it('shows subscription timing and removes the subscription and its grid meetings only after success', async () => {
    await renderSubscriptions()
    expect(screen.getByText('10 Jun 2026')).toBeVisible()
    expect(screen.getByLabelText('0 upcoming meetings')).toBeVisible()
    expect(screen.getByText('Subscribed meeting')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open calendar Subscribed planning' }))
      .toHaveAttribute('href', '/calendar/publicHash')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe from Subscribed planning' }))
    })
    expect(apiClient.delete).toHaveBeenCalledWith('/api/calendar-subscriptions/publicHash')
    expect(screen.queryByRole('link', { name: 'Open calendar Subscribed planning' })).not.toBeInTheDocument()
    expect(screen.queryByText('Subscribed meeting')).not.toBeInTheDocument()
    expect(screen.getByText('You are not subscribed to any coordination calendars yet.')).toBeVisible()
  })

  it('prevents duplicate unsubscribe requests while preserving the row until completion', async () => {
    let complete: (() => void) | undefined
    vi.mocked(apiClient.delete).mockImplementation(() => new Promise(resolve => {
      complete = () => resolve({ data: {} })
    }))
    await renderSubscriptions()
    const button = screen.getByRole('button', { name: 'Unsubscribe from Subscribed planning' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(button).toBeDisabled()
    expect(apiClient.delete).toHaveBeenCalledOnce()
    expect(screen.getByText('Subscribed meeting')).toBeInTheDocument()
    await act(async () => { complete?.() })
    expect(screen.queryByRole('link', { name: 'Open calendar Subscribed planning' })).not.toBeInTheDocument()
  })

  it('keeps the subscription and its meetings on unsubscribe failure and displays a notification', async () => {
    vi.mocked(apiClient.delete).mockRejectedValue(new Error('Request failed'))
    await renderSubscriptions()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe from Subscribed planning' }))
    })
    expect(showToast).toHaveBeenCalledWith('Failed to unsubscribe. Please try again.', 'error')
    expect(screen.getByRole('button', { name: 'Unsubscribe from Subscribed planning' })).toBeEnabled()
    expect(screen.getByRole('link', { name: 'Open calendar Subscribed planning' })).toBeVisible()
    expect(screen.getByText('Subscribed meeting')).toBeInTheDocument()
  })
})

describe('CoordinateEventsPage public status removal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-10T12:00:00Z'))
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('removes public status from a persisted conditional occurrence without splitting its recurrence', async () => {
    const defaultGet = vi.mocked(apiClient.get).getMockImplementation()
    vi.mocked(apiClient.get).mockImplementation(async (url: string, config) => {
      if (url === '/api/user-events') return { data: { events: [makeEvent({
        id: 'conditional-public', title: 'Conditional public item', is_public: true,
        recurrence_rule: { type: 'custom', unit: 'day', interval: 1, endType: 'whenCompleted' },
      })] } }
      return defaultGet?.(url, config)
    })
    render(<MemoryRouter><CoordinateEventsPage /></MemoryRouter>)
    await flushPage()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Secret Swarm filter Hide' })) })
    await act(async () => { fireEvent.click(screen.getByText('Conditional public item')) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove Public' })) })
    expect(apiClient.put).toHaveBeenCalledWith('/api/user-events/bulk-public', {
      event_ids: ['conditional-public'], is_public: false,
    })
    expect(apiClient.post).not.toHaveBeenCalled()
    expect(screen.queryByText('This and future sessions')).not.toBeInTheDocument()
  })

  it('displays "Remove Public" button and prompts for series removal options on recurring events', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/api/user-events') {
        return {
          data: {
            events: [
              makeEvent({
                id: 'treasury-op-1',
                title: 'Treasury Operations - Info Only',
                is_public: true,
                start_time: '2026-06-10T11:00:00Z',
                end_time: '2026-06-10T13:00:00Z',
                recurrence_rule: { type: 'weekly' },
              }),
            ],
          },
        }
      }
      if (url === '/api/calendar-sources') return { data: { sources: [] } }
      if (url === '/api/calendar-subscriptions') return { data: { subscriptions: [] } }
      if (url === '/api/calendar-subscriptions/meetings') return { data: { meetings: [] } }
      if (url === '/api/user-events/sync-prefs') return { data: { prefs: [] } }
      throw new Error(`Unexpected GET ${url}`)
    })

    await act(async () => {
      render(
        <MemoryRouter>
          <CoordinateEventsPage />
        </MemoryRouter>
      )
    })
    await flushPage()

    // Reveal Secret Swarm network if hidden
    const unhideBtn = screen.getByRole('button', { name: 'Secret Swarm filter Hide' })
    await act(async () => {
      fireEvent.click(unhideBtn)
    })

    // Click on the Treasury Operations event
    const eventBtn = screen.getByText(/Treasury Operations/)
    await act(async () => {
      fireEvent.click(eventBtn)
    })

    // Verify button says "Remove Public" instead of "Public"
    const removePublicBtn = screen.getByRole('button', { name: 'Remove Public' })
    expect(removePublicBtn).toBeInTheDocument()

    // Click "Remove Public"
    await act(async () => {
      fireEvent.click(removePublicBtn)
    })

    // Modal pops up asking about recurring meeting series removal
    expect(screen.getAllByText('Remove Public Status').length).toBeGreaterThan(0)
    expect(screen.getByText('Only this session')).toBeInTheDocument()
    expect(screen.getByText('This and future sessions')).toBeInTheDocument()
    expect(screen.getByText('All sessions in the series (including history)')).toBeInTheDocument()

    // Confirm removal for "All sessions in the series"
    fireEvent.click(screen.getByLabelText(/All sessions in the series/i))
    const confirmBtn = screen.getByRole('button', { name: 'Remove Public Status' })
    await act(async () => {
      fireEvent.click(confirmBtn)
    })

    expect(apiClient.put).toHaveBeenCalledWith('/api/user-events/bulk-public', {
      event_ids: ['treasury-op-1'],
      is_public: false,
    })
  })

  it('splits a public weekly series at the clicked occurrence for "this and future"', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/api/user-events') {
        return {
          data: {
            events: [
              makeEvent({
                id: 'weekly-1',
                title: 'Weekly Community Call',
                is_public: true,
                start_time: '2026-01-07T11:00:00Z',
                end_time: '2026-01-07T12:00:00Z',
                recurrence_rule: { type: 'weekly' },
              }),
            ],
          },
        }
      }
      if (url === '/api/calendar-sources') return { data: { sources: [] } }
      if (url === '/api/calendar-subscriptions') return { data: { subscriptions: [] } }
      if (url === '/api/calendar-subscriptions/meetings') return { data: { meetings: [] } }
      if (url === '/api/user-events/sync-prefs') return { data: { prefs: [] } }
      throw new Error(`Unexpected GET ${url}`)
    })
    vi.mocked(apiClient.put).mockResolvedValue({ data: {} })
    vi.mocked(apiClient.post).mockResolvedValue({ data: { event: makeEvent({ id: 'weekly-2', title: 'Weekly Community Call', is_public: false }) } })

    await act(async () => {
      render(
        <MemoryRouter>
          <CoordinateEventsPage />
        </MemoryRouter>
      )
    })
    await flushPage()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Secret Swarm filter Hide' }))
    })
    await act(async () => {
      fireEvent.click(screen.getAllByText(/Weekly Community Call/)[0])
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove Public' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove Public Status' }))
    })

    const putCall = vi.mocked(apiClient.put).mock.calls.find(([url]) => url === '/api/user-events/weekly-1')
    expect(putCall?.[1]).toMatchObject({ recurrence_rule: { type: 'weekly', endType: 'on' } })
    const postCall = vi.mocked(apiClient.post).mock.calls.find(([url]) => url === '/api/user-events')
    const body = postCall?.[1] as { start_time: string; is_public: boolean; recurrence_rule: { type: string } }
    expect(body.is_public).toBe(false)
    expect(body.recurrence_rule.type).toBe('weekly')
    expect(body.start_time.slice(11, 16)).toBe('11:00')
    expect(new Date(body.start_time).getTime()).toBeGreaterThan(new Date('2026-01-07T11:00:00Z').getTime())
    // The public series ends the day before the split occurrence.
    const endDate = (putCall?.[1] as { recurrence_rule: { endDate: string } }).recurrence_rule.endDate
    expect(new Date(`${endDate}T00:00:00Z`).getTime()).toBe(new Date(`${body.start_time.slice(0, 10)}T00:00:00Z`).getTime() - 86_400_000)
    expect(vi.mocked(apiClient.put)).not.toHaveBeenCalledWith('/api/user-events/bulk-public', expect.anything())
  })
})
