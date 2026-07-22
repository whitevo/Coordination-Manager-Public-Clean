import '@testing-library/jest-dom'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import EventsCalendarPage from '../EventsCalendarPage'
import { apiClient } from '../../lib/api-client'

vi.mock('../../lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    isAuthenticated: false,
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

function makeEvent(overrides: Partial<EventRecord>): EventRecord {
  return {
    id: 'event-default',
    title: 'Weekly Meeting',
    description: null,
    meeting_link: null,
    location: null,
    start_time: '2026-06-24T15:00:00Z',
    end_time: '2026-06-24T16:00:00Z',
    is_public: true,
    source_type: 'coordination_calendar',
    created_at: '2026-06-01T00:00:00Z',
    calendar_title: 'Future Calendar',
    calendar_hash: 'future-hash',
    ...overrides,
  }
}

type EventRecord = {
  id: string
  title: string
  description: string | null
  meeting_link: string | null
  location: string | null
  start_time: string
  end_time: string
  is_public: boolean
  source_type: string
  created_at: string
  updated_at?: string
  calendar_title?: string
  calendar_hash?: string
}

async function renderPage() {
  await act(async () => {
    render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <EventsCalendarPage />
      </MemoryRouter>
    )
  })
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('EventsCalendarPage network filters', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-12T12:00:00Z'))
    window.HTMLElement.prototype.scrollIntoView = vi.fn()

    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/api/user-events/public') {
        return {
          data: {
            events: [
              makeEvent({
                id: 'future-1',
                title: 'Future Network Event',
                calendar_title: 'Future Calendar',
                start_time: '2026-06-24T15:00:00Z',
                end_time: '2026-06-24T16:00:00Z',
              }),
              makeEvent({
                id: 'past-1',
                title: 'Past Network Event',
                calendar_title: 'Past Calendar',
                start_time: '2026-06-02T15:00:00Z',
                end_time: '2026-06-02T16:00:00Z',
              }),
            ],
          },
        }
      }

      if (url === '/api/network-relations/networks') {
        return {
          data: {
            networks: [
              { id: 'future-network', name: 'Future Network', color: '#3B82F6', description: null },
              { id: 'past-network', name: 'Past Network', color: '#10B981', description: null },
            ],
          },
        }
      }

      if (url === '/api/network-relations/mappings') {
        return {
          data: {
            mappings: [
              { id: 'map-1', network_id: 'future-network', source_string: 'Future Calendar', source_type: 'calendar_title' },
              { id: 'map-2', network_id: 'past-network', source_string: 'Past Calendar', source_type: 'calendar_title' },
            ],
          },
        }
      }

      if (url === '/api/network-relations/rules') {
        return { data: { rules: [] } }
      }

      throw new Error(`Unexpected GET ${url}`)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('adds network chips from the visible past week and still jumps to an upcoming selected network', async () => {
    await renderPage()

    await flushEffects()

    expect(screen.queryByText('Past Network')).not.toBeInTheDocument()
    expect(screen.getByText('Future Network')).toBeInTheDocument()
    expect(screen.getByText(/Jun 8.*Jun 14, 2026/)).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    })

    expect(screen.getByText(/Jun 1.*Jun 7, 2026/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Past Network/ }).length).toBeGreaterThan(0)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Future Network/ }))
    })

    expect(screen.getByText(/Jun 22.*Jun 28, 2026/)).toBeInTheDocument()
  })
})

describe('EventsCalendarPage duplicate event sync selection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-12T12:00:00Z'))
    window.HTMLElement.prototype.scrollIntoView = vi.fn()

    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/api/user-events/public') {
        return {
          data: {
            events: [
              makeEvent({
                id: 'open-gov-old',
                title: 'Open Gov WG',
                calendar_title: 'Future Calendar',
                meeting_link: 'https://meet.example.com/open-gov',
                location: 'Room A',
                start_time: '2026-06-11T13:00:00Z',
                end_time: '2026-06-11T14:00:00Z',
                created_at: '2026-06-10T10:00:00Z',
                updated_at: '2026-06-10T10:00:00Z',
              }),
              makeEvent({
                id: 'open-gov-new',
                title: 'Open Gov WG',
                calendar_title: 'Synced Calendar',
                meeting_link: 'https://meet.example.com/open-gov',
                location: 'Room A',
                start_time: '2026-06-11T14:00:00Z',
                end_time: '2026-06-11T15:00:00Z',
                created_at: '2026-06-10T10:00:00Z',
                updated_at: '2026-06-12T09:00:00Z',
              }),
            ],
          },
        }
      }

      if (url === '/api/network-relations/networks') {
        return { data: { networks: [] } }
      }

      if (url === '/api/network-relations/mappings') {
        return { data: { mappings: [] } }
      }

      if (url === '/api/network-relations/rules') {
        return { data: { rules: [] } }
      }

      throw new Error(`Unexpected GET ${url}`)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('shows only the latest synced time for merged duplicate events', async () => {
    await renderPage()
    await flushEffects()

    // Event chips now open details directly on first click.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Open Gov WG/ }))
    })

    expect(screen.getByText('Thu, Jun 11, 2026 · 14:00 – 15:00')).toBeInTheDocument()
    expect(screen.queryByText('13:00 – 14:00')).not.toBeInTheDocument()
    expect(screen.getByText(/Merged from 2 sources\./)).toBeInTheDocument()
  })
})