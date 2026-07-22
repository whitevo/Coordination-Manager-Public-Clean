import '@testing-library/jest-dom'
import { startOfWeek } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import {
  installDefaultApiMocks,
  installEditorDomPolyfills,
  mockDedupedGet,
  mockUseAuth,
} from './time-management-test-harness'
import { apiClient } from '../../lib/api-client'
import TimeManagementPage from '../TimeManagementPage'

const TITLE_PLACEHOLDER = 'Type Title for Time Item'

describe('TimeManagement editor regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    mockUseAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      isTraveler: false,
    })
    installDefaultApiMocks()
    installEditorDomPolyfills()
  })

  it('keeps draft title when creating a new time selection', async () => {
    const { container } = render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
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
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
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
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
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
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
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
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
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
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
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

  it('shows location in read-only source item description preview', async () => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    const sourceStart = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 12, 0, 0)).toISOString()
    const sourceEnd = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 13, 0, 0)).toISOString()

    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/calendar-sources') {
        return {
          data: {
            sources: [
              {
                id: 'google-src-1',
                name: 'Team Google Calendar',
                color: '#34d399',
                enabled: true,
                source_type: 'google_oauth',
                google_email: 'team@example.com',
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
            events: [
              {
                id: 'event-source-readonly',
                title: 'Source event with location',
                description: 'Prep checklist',
                meeting_link: null,
                location: 'https://meet.example.com/room-atlas',
                start_time: sourceStart,
                end_time: sourceEnd,
                source_type: 'google_oauth',
                source_id: 'google-src-1',
                category_ids: [],
                recurrence_rule: { type: 'none' },
              },
            ],
          },
        }
      }
      return { data: {} }
    })

    vi.mocked(apiClient.put).mockResolvedValue({ data: {} })

    render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    fireEvent.click((await screen.findAllByText('Source event with location'))[0])

    await screen.findByText(/Location:/i)
    await screen.findByRole('link', { name: 'https://meet.example.com/room-atlas' })
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
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
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
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
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
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
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
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    fireEvent.click(screen.getByRole('button', { name: 'Create Time Item' }))

    const sideEditor = await waitFor(() => container.querySelector('aside .markdown-editor'))
    expect(sideEditor).toBeInTheDocument()
    expect(sideEditor?.className).toContain('min-h-[10rem]')
    expect(sideEditor?.className).not.toContain('h-full')
  })

  it('lets users edit item title from full view', async () => {
    render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
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
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
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
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
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
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
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
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
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
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
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
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
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
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
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
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
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
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
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
})
