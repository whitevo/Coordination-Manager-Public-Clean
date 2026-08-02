import '@testing-library/jest-dom'
import type { ReactNode } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CoordinateEventsPage from '../CoordinateEventsPage'
import { apiClient } from '../../lib/api-client'

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
    showToast: vi.fn(),
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

describe('CoordinateEventsPage network filters', () => {
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

  it('defaults Secret Swarm to hidden while preserving labels and allowing user override', async () => {
    await act(async () => {
      render(
        <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
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
        <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
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
        <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
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

})
