import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import EventsCalendarPage from '../EventsCalendarPage'
import { apiClient } from '../../lib/api-client'

vi.mock('../../lib/api-client', () => {
  const client = {
    get: vi.fn(),
    post: vi.fn(),
  }
  return { apiClient: client, dedupedGet: client.get }
})

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

function LocationProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  return <><output data-testid="location">{location.search}</output><button onClick={() => navigate(-1)}>Browser back</button></>
}

async function renderPage(search = '') {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[`/events-calendar${search}`]}>
        <EventsCalendarPage />
        <LocationProbe />
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

      if (url === '/api/network-relations/assignments') {
        return { data: { assignments: [], sources: [] } }
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

      if (url === '/api/network-relations/assignments') {
        return { data: { assignments: [], sources: [] } }
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
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Open Gov WG/ }))
    })
    expect(screen.getByText('Thu, Jun 11, 2026 · 14:00 – 15:00')).toBeInTheDocument()
    expect(screen.queryByText('13:00 – 14:00')).not.toBeInTheDocument()
    expect(screen.getByText(/Merged from 2 sources\./)).toBeInTheDocument()
  })
})

describe('EventsCalendarPage shareable overlapping networks', () => {
      const sourceA = `source_${'a'.repeat(64)}`
      const sourceB = `source_${'b'.repeat(64)}`
      const networks = [
        { id: 'a', name: 'Renamed A', original_name: 'Original A', source_key: sourceA, color: '#3B82F6', description: null },
        { id: 'b', name: 'Network B', original_name: 'Original B', source_key: sourceB, color: '#10B981', description: null },
        { id: 'combined', name: 'Combined', member_keys: [sourceA, sourceB], color: '#8B5CF6', description: null },
      ]
      beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-06-12T12:00:00Z'))
        window.HTMLElement.prototype.scrollIntoView = vi.fn()
        vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
          if (url === '/api/user-events/public') {
            const shared = makeEvent({ title: 'Shared meeting', start_time: '2026-06-11T14:00:00Z', end_time: '2026-06-11T15:00:00Z' })
            return { data: { events: [
              { ...shared, id: 'source-a-event', network_source_key: sourceA, calendar_title: 'Original A' },
              { ...shared, id: 'source-b-event', network_source_key: sourceB, calendar_title: 'Original B' },
              { ...shared, id: 'a-only', title: 'Only A meeting', network_source_key: sourceA, start_time: '2026-06-11T16:00:00Z', end_time: '2026-06-11T17:00:00Z' },
            ] } }
          }
          if (url === '/api/network-relations/networks') return { data: { networks } }
          if (url === '/api/network-relations/assignments') return { data: { assignments: [], sources: [
            { key: sourceA, name: 'Original A' }, { key: sourceB, name: 'Original B' },
          ] } }
          if (url === '/api/network-relations/mappings') return { data: { mappings: [] } }
          if (url === '/api/network-relations/rules') return { data: { rules: [] } }
          throw new Error(`Unexpected GET ${url}`)
        })
      })
      afterEach(() => {
        vi.useRealTimers()
        vi.clearAllMocks()
      })

      it('restores a shared filter and replaces it with one network field when another is clicked', async () => {
        localStorage.setItem('coordinateEventsNetworkFilterModes', JSON.stringify({ 'Network B': 'hidden' }))
        try {
          await renderPage(`?network=${sourceB}&keep=value`)
          expect(screen.getByRole('button', { name: 'Network B' })).toHaveAttribute('aria-pressed', 'true')
          expect(screen.getAllByRole('button', { name: /Shared meeting/ })).toHaveLength(1)
          expect(screen.queryByRole('button', { name: /Only A meeting/ })).not.toBeInTheDocument()
          await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Renamed A' })) })
          const params = new URLSearchParams(screen.getByTestId('location').textContent || '')
          expect(params.getAll('network')).toEqual([sourceA])
          expect(params.get('keep')).toBe('value')
          expect(screen.getByRole('button', { name: /Only A meeting/ })).toBeInTheDocument()
          await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Browser back' })) })
          expect(screen.getByRole('button', { name: 'Network B' })).toHaveAttribute('aria-pressed', 'true')
        } finally {
          localStorage.removeItem('coordinateEventsNetworkFilterModes')
        }
      })

      it('shows a live combined network without duplicate meetings or original renamed filter labels', async () => {
        await renderPage('?network=combined')
        expect(screen.getAllByRole('button', { name: /Shared meeting/ })).toHaveLength(1)
        expect(screen.getByRole('button', { name: /Only A meeting/ })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Original A' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Original B' })).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Renamed A' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Network B' })).toBeInTheDocument()
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Shared meeting/ })) })
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Show sources/ })) })
        expect(screen.getAllByText('Original A').length).toBeGreaterThan(0)
        expect(screen.getAllByText('Original B').length).toBeGreaterThan(0)
      })

      it('clears only the network parameter and copies a shareable filter link', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined)
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
        await renderPage(`?network=${sourceA}&keep=value`)
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy filter link' })) })
        const copied = new URL(writeText.mock.calls[0][0])
        expect(copied.searchParams.getAll('network')).toEqual([sourceA])
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear network filter' })) })
        expect(screen.getByTestId('location').textContent).toBe('?keep=value')
      })

      it('does not silently show all meetings for an unavailable shared network', async () => {
        await renderPage('?network=deleted-network')
        expect(screen.getByText(/Filtering: Unavailable network/)).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /Shared meeting/ })).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Clear network filter' })).toBeInTheDocument()
      })

      it('refreshes renamed networks without losing the active filter or usable content on a later error', async () => {
        await renderPage(`?network=${sourceB}`)
        const originalGet = vi.mocked(apiClient.get).getMockImplementation()
        if (!originalGet) throw new Error('Missing API fixture')
        vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
          if (url === '/api/network-relations/networks') {
            return { data: { networks: networks.map(network =>
              network.id === 'b' ? { ...network, name: 'Renamed B' } : network) } }
          }
          return originalGet(url)
        })
        await act(async () => { window.dispatchEvent(new Event('focus')) })
        expect(screen.getByRole('button', { name: 'Renamed B' })).toHaveAttribute('aria-pressed', 'true')
        expect(new URLSearchParams(screen.getByTestId('location').textContent || '').get('network')).toBe(sourceB)
        vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
          if (url.startsWith('/api/network-relations/')) throw new Error('Network data unavailable')
          return originalGet(url)
        })
        await act(async () => { window.dispatchEvent(new Event('focus')) })
        expect(screen.getByRole('alert')).toHaveTextContent('Network filters could not be loaded')
        expect(screen.getByRole('button', { name: 'Renamed B' })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByRole('button', { name: /Shared meeting/ })).toBeInTheDocument()
        vi.mocked(apiClient.get).mockImplementation(originalGet)
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry network filters' })) })
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Network B' })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByRole('button', { name: /Shared meeting/ })).toBeInTheDocument()
      })

      it.each(['a', sourceA])('resolves old joined-network URL %s to a single destination and hides the old filter', async key => {
        const originalGet = vi.mocked(apiClient.get).getMockImplementation()
        if (!originalGet) throw new Error('Missing API fixture')
        vi.mocked(apiClient.get).mockImplementation(async url => {
          if (url === '/api/network-relations/networks') return {
            data: { networks: networks.map(network => network.id === 'a' ? { ...network, merged_into: 'b' } : network) },
          }
          return originalGet(url)
        })
        await renderPage(`?network=${key}&keep=value`)
        expect(screen.getByRole('button', { name: 'Network B' })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.queryByRole('button', { name: 'Renamed A' })).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Only A meeting/ })).toBeInTheDocument()
        expect(screen.getAllByRole('button', { name: /Shared meeting/ })).toHaveLength(1)
        expect(screen.getByRole('button', { name: 'Network B' })).not.toHaveTextContent('Original A')
        expect(screen.getByRole('button', { name: 'Network B' })).not.toHaveTextContent('Original B')
        const params = new URLSearchParams(screen.getByTestId('location').textContent || '')
        expect(params.getAll('network')).toEqual([sourceB])
        expect(params.get('keep')).toBe('value')
      })

      it('identifies a failed mapping endpoint and HTTP status while preserving the active filter', async () => {
        await renderPage(`?network=${sourceB}`)
        const originalGet = vi.mocked(apiClient.get).getMockImplementation()
        if (!originalGet) throw new Error('Missing API fixture')
        vi.mocked(apiClient.get).mockImplementation(async url => {
          if (url === '/api/network-relations/mappings') throw Object.assign(new Error('Unavailable'), {
            isAxiosError: true, response: { status: 503, data: { message: 'Database update required' } },
          })
          return originalGet(url)
        })
        await act(async () => { window.dispatchEvent(new Event('focus')) })
        expect(screen.getByRole('alert')).toHaveTextContent('direct mappings, HTTP 503')
        expect(screen.getByRole('alert')).toHaveTextContent('Database update required')
        expect(screen.getByRole('button', { name: 'Network B' })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByRole('button', { name: 'Retry network filters' })).toBeEnabled()
      })

      it.each(['invalid catalog', 'redirect cycle'])('does not replace usable filters with %s during refresh', async failure => {
        await renderPage(`?network=${sourceB}`)
        const originalGet = vi.mocked(apiClient.get).getMockImplementation()
        if (!originalGet) throw new Error('Missing API fixture')
        vi.mocked(apiClient.get).mockImplementation(async url => {
          if (failure === 'invalid catalog' && url === '/api/network-relations/mappings') return { data: {} }
          if (failure === 'redirect cycle' && url === '/api/network-relations/networks') return {
            data: { networks: networks.map(network => network.id === 'a'
              ? { ...network, merged_into: 'b' } : network.id === 'b' ? { ...network, merged_into: 'a' } : network) },
          }
          return originalGet(url)
        })
        await act(async () => { window.dispatchEvent(new Event('focus')) })
        expect(screen.getByRole('alert')).toHaveTextContent(failure === 'invalid catalog' ? 'Invalid network catalog response' : 'Network redirects contain a cycle')
        expect(screen.getByRole('button', { name: 'Network B' })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByRole('button', { name: /Shared meeting/ })).toBeInTheDocument()
      })

      it('unifies same-name sources, joined sources and mappings with deduplicated counts and no old filter labels', async () => {
        const sourceOther = `source_${'c'.repeat(64)}`
        let tagName = 'SingularityNET'
        const shared = makeEvent({ title: 'MeTTa Coders', calendar_title: 'SingularityNET', start_time: '2026-06-11T14:00:00Z', end_time: '2026-06-11T15:00:00Z' })
        vi.mocked(apiClient.get).mockImplementation(async url => {
          if (url === '/api/user-events/public') return { data: { events: [
            { ...shared, id: 'metta-source', network_source_key: sourceA },
            { ...shared, id: 'metta-duplicate', network_source_key: sourceB, calendar_title: 'OpenCog Hyperon' },
            { ...shared, id: 'source-only', title: 'Source-only meeting', network_source_key: sourceA, start_time: '2026-06-11T16:00:00Z', end_time: '2026-06-11T17:00:00Z' },
            { ...shared, id: 'joined-only', title: 'Joined-source meeting', network_source_key: sourceB, calendar_title: 'OpenCog Hyperon', start_time: '2026-06-11T17:00:00Z', end_time: '2026-06-11T18:00:00Z' },
            { ...shared, id: 'unrelated', title: 'Other meeting', network_source_key: sourceOther, calendar_title: 'Untouched source', start_time: '2026-06-11T18:00:00Z', end_time: '2026-06-11T19:00:00Z' },
          ] } }
          if (url === '/api/network-relations/networks') return { data: { networks: [
            { id: 'tag', name: tagName, original_name: 'SingularityNET', color: '#3B82F6', description: null },
            { id: 'joined', name: 'OpenCog Hyperon', original_name: 'OpenCog Hyperon', source_key: sourceB, merged_into: 'tag', color: '#3B82F6', description: null },
            { id: 'second-tag', name: 'Second tag', color: '#3B82F6', description: null },
          ] } }
          if (url === '/api/network-relations/mappings') return { data: { mappings: [
            { id: 'mapping', network_id: 'tag', source_type: 'meeting_title', source_string: 'MeTTa Coders' },
          ] } }
          if (url === '/api/network-relations/assignments') return { data: { assignments: [
            { id: 'assignment', network_id: 'second-tag', target_type: 'user_event', target_id: 'source-only' },
          ], sources: [{ key: sourceA, name: 'SingularityNET' }, { key: sourceB, name: 'OpenCog Hyperon' }, { key: sourceOther, name: 'Untouched source' }] } }
          if (url === '/api/network-relations/rules') return { data: { rules: [] } }
          throw new Error(`Unexpected GET ${url}`)
        })
        await renderPage(`?network=${sourceA}&keep=value`)
        const filter = screen.getByRole('button', { name: 'SingularityNET' })
        expect(filter).toHaveAttribute('aria-pressed', 'true')
        expect(filter).toHaveTextContent('SingularityNET3')
        expect(filter).not.toHaveTextContent('OpenCog')
        expect(screen.queryByText('Member calendars')).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Untouched source' })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'OpenCog Hyperon' })).not.toBeInTheDocument()
        expect(screen.getAllByRole('button', { name: /MeTTa Coders/ })).toHaveLength(1)
        expect(screen.getByRole('button', { name: /Source-only meeting/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Joined-source meeting/ })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /Other meeting/ })).not.toBeInTheDocument()
        expect(screen.getByTestId('location')).toHaveTextContent('?keep=value&network=tag')
        tagName = 'Renamed tag'
        await act(async () => { window.dispatchEvent(new Event('focus')) })
        expect(screen.getByRole('button', { name: 'Renamed tag' })).toHaveTextContent('Renamed tag3')
        expect(screen.queryByRole('button', { name: 'SingularityNET' })).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Source-only meeting/ })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Second tag' })).not.toBeInTheDocument()
      })
})