import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import {
  installDefaultApiMocks,
  installEditorDomPolyfills,
  mockDedupedGet,
  mockUseAuth,
} from './time-management-test-harness'
import { apiClient } from '../../lib/api-client'
import { clearSessionCacheValue } from '../../lib/session-data-cache'
import TimeManagementPage from '../TimeManagementPage'

const CREATED_ID = 'evt-race-created'
const ITEM_TITLE = 'Standup'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

function buildCreatedEvent() {
  const postBody = vi.mocked(apiClient.post).mock.calls.find(([url]) => url === '/api/user-events')?.[1] as
    | { start_time?: string; end_time?: string }
    | undefined
  if (!postBody?.start_time || !postBody.end_time) throw new Error('Expected the create POST to have been sent')
  return {
    id: CREATED_ID,
    title: ITEM_TITLE,
    description: 'Team sync',
    meeting_link: null,
    location: null,
    start_time: postBody.start_time,
    end_time: postBody.end_time,
    source_type: 'manual',
    source_id: 'mode-main',
    category_ids: [] as string[],
    recurrence_rule: { type: 'none' },
  }
}

interface RaceHarness {
  container: HTMLElement
  baselineCount: number
  resolveCreate: () => Promise<void>
  setRefetchResponse: (events: unknown[] | Deferred<unknown[]>) => void
  triggerCrossTabRefetch: () => Promise<void>
}

function getItemElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-time-management-item="true"]'))
    .filter((element) => element.textContent?.includes(ITEM_TITLE))
}

async function renderWithInFlightQuickCreate(): Promise<RaceHarness> {
  let refetchResponse: unknown[] | Deferred<unknown[]> = []
  let initialLoadDone = false
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
                  id: 'tpl-race',
                  quickName: ITEM_TITLE,
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
    if (url === '/api/time-management/categories') {
      return {
        data: {
          categories: [
            { id: 'cat-work', label: 'Work', color: '#16a34a', font_color: '#ffffff', sort_order: 0 },
          ],
        },
      }
    }
    if (url === '/api/user-events') {
      if (!initialLoadDone) return { data: { events: [] } }
      const response = refetchResponse
      const events = Array.isArray(response) ? response : await response.promise
      return { data: { events } }
    }
    return { data: {} }
  })

  const createDeferredResponse = createDeferred<{ data: { event: ReturnType<typeof buildCreatedEvent> } }>()
  vi.mocked(apiClient.post).mockReturnValueOnce(
    createDeferredResponse.promise as unknown as ReturnType<typeof apiClient.post>
  )

  const { container } = render(
    <MemoryRouter>
      <TimeManagementPage />
    </MemoryRouter>
  )

  await screen.findByRole('heading', { name: 'Time Management' })
  await waitFor(() => {
    expect(mockDedupedGet).toHaveBeenCalledWith('/api/user-events', {
      params: { windowStart: expect.any(String), windowEnd: expect.any(String) },
    })
  })
  initialLoadDone = true

  const firstDayColumn = container.querySelector("div[style*='repeating-linear-gradient']") as HTMLDivElement | null
  if (!firstDayColumn) throw new Error('Expected a day column')
  vi.spyOn(firstDayColumn, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 600, width: 100, height: 600, toJSON: () => ({}),
  })

  fireEvent.mouseDown(firstDayColumn, { button: 0, clientX: 20, clientY: 140 })
  fireEvent.click(await screen.findByRole('button', { name: 'Apply Template' }))

  await waitFor(() => {
    expect(apiClient.post).toHaveBeenCalledWith('/api/user-events', expect.anything())
  })
  await waitFor(() => {
    expect(getItemElements(container).length).toBeGreaterThan(0)
  })
  const baselineCount = getItemElements(container).length

  return {
    container,
    baselineCount,
    resolveCreate: async () => {
      await act(async () => {
        createDeferredResponse.resolve({ data: { event: buildCreatedEvent() } })
        await Promise.resolve()
      })
    },
    setRefetchResponse: (events) => {
      refetchResponse = events
    },
    triggerCrossTabRefetch: async () => {
      await act(async () => {
        window.dispatchEvent(new StorageEvent('storage', {
          key: 'coord-time-management-sync-ping',
          newValue: JSON.stringify({
            type: 'time-management-updated',
            reason: 'event-updated',
            tabId: 'another-tab',
            updatedAt: Date.now(),
          }),
        }))
        await new Promise((resolve) => window.setTimeout(resolve, 260))
      })
    },
  }
}

function openItemContextMenu(container: HTMLElement): void {
  const [item] = getItemElements(container)
  if (!item) throw new Error('Expected the created item to be rendered')
  fireEvent.contextMenu(item, { clientX: 200, clientY: 200 })
}

function getPutUrls(): string[] {
  return vi.mocked(apiClient.put).mock.calls.map(([url]) => String(url))
}

describe('TimeManagement pending create races', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    clearSessionCacheValue('time-management:events:anon')
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, isTraveler: false })
    installDefaultApiMocks()
    installEditorDomPolyfills()
  })

  it('persists a label assigned while the create is in flight to the created id', async () => {
    const harness = await renderWithInFlightQuickCreate()

    openItemContextMenu(harness.container)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Assign Category' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Work' }))

    // No write may target the temporary pending id.
    expect(getPutUrls().some((url) => url.includes('pending-'))).toBe(false)

    await harness.resolveCreate()

    await waitFor(() => {
      expect(apiClient.put).toHaveBeenCalledWith(
        `/api/user-events/${CREATED_ID}`,
        expect.objectContaining({ category_ids: ['cat-work'] })
      )
    })
    expect(getPutUrls().some((url) => url.includes('pending-'))).toBe(false)
    expect(getItemElements(harness.container)).toHaveLength(harness.baselineCount)
  })

  it('does not duplicate the item when a refetch echoes it before the create reply', async () => {
    const harness = await renderWithInFlightQuickCreate()

    harness.setRefetchResponse([buildCreatedEvent()])
    await harness.triggerCrossTabRefetch()
    expect(getItemElements(harness.container)).toHaveLength(harness.baselineCount)

    await harness.resolveCreate()

    await waitFor(() => {
      expect(getItemElements(harness.container)).toHaveLength(harness.baselineCount)
    })
  })

  it('does not resurrect the pending placeholder when a refetch lands after the create reply', async () => {
    const harness = await renderWithInFlightQuickCreate()

    const slowRefetch = createDeferred<unknown[]>()
    harness.setRefetchResponse(slowRefetch)
    await harness.triggerCrossTabRefetch()

    await harness.resolveCreate()
    await waitFor(() => {
      expect(getItemElements(harness.container)).toHaveLength(harness.baselineCount)
    })

    await act(async () => {
      slowRefetch.resolve([buildCreatedEvent()])
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    expect(getItemElements(harness.container)).toHaveLength(harness.baselineCount)
  })

  it('deletes the created item when it is deleted while the create is in flight', async () => {
    const harness = await renderWithInFlightQuickCreate()

    openItemContextMenu(harness.container)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Item' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(getItemElements(harness.container)).toHaveLength(0)
    expect(apiClient.delete).not.toHaveBeenCalled()

    await harness.resolveCreate()

    await waitFor(() => {
      expect(apiClient.delete).toHaveBeenCalledWith(`/api/user-events/${CREATED_ID}`)
    })
    expect(getItemElements(harness.container)).toHaveLength(0)
  })
})
