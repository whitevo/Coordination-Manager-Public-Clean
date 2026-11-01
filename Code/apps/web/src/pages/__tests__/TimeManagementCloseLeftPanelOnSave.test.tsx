import '@testing-library/jest-dom/vitest'
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

// The grid keys days by UTC date of the local week labels; just after local midnight on a
// Monday, "now" can still be the previous UTC week. Noon UTC on today's local date is always visible.
const VISIBLE_WEEK_ITEM_START = (() => {
  const now = new Date()
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0))
})()

const TITLE_PLACEHOLDER = 'Type Title for Time Item'

function renderPage() {
  return render(
    <MemoryRouter>
      <TimeManagementPage />
    </MemoryRouter>
  )
}

/** Clicks the first weekday column to create a minimal (one-slot) selection. */
async function selectTimeOnGrid() {
  const column = await screen.findByTestId('calendar-day-column-0')
  vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({
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
  fireEvent.mouseDown(column, { button: 0, clientX: 20, clientY: 140 })
}

function isLeftPanelOpen(): boolean {
  return screen.getByTestId('time-management-left-panel').getAttribute('data-open') === 'true'
}

/** Expands Calendar Modes > Settings so the close-on-save toggles are visible. */
async function openModeSettings() {
  fireEvent.click(screen.getByRole('button', { name: 'Calendar Modes' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
  await screen.findByTestId('close-left-panel-on-save-settings')
}

const AUTOSAVE_QUICK_TEMPLATE = {
  id: 'tpl-autosave-standup',
  quickName: 'Standup',
  title: 'Daily standup',
  notes: '',
  categoryIds: [],
  autoSaveEnabled: true,
  sourceItemId: 'seed-item',
  createdAt: new Date().toISOString(),
}

const MANUAL_EVENT = {
  id: 'evt-manual-existing',
  title: 'Existing item',
  description: '',
  meeting_link: null,
  location: null,
  start_time: VISIBLE_WEEK_ITEM_START.toISOString(),
  end_time: new Date(VISIBLE_WEEK_ITEM_START.getTime() + 30 * 60 * 1000).toISOString(),
  source_type: 'manual',
  source_id: 'mode-main',
  category_ids: [],
  recurrence_rule: { type: 'none' },
}

describe('Time Management - Close Left Panel on Save', () => {
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

  it('defaults: master toggle active, only Calendar Grid closes the panel on save', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Time Management' })
    await selectTimeOnGrid()
    await openModeSettings()

    expect(screen.getByTestId('close-left-panel-on-save-toggle')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('close-left-panel-on-save-surface-calendarGrid')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('close-left-panel-on-save-surface-leftSidebar')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('close-left-panel-on-save-surface-fullView')).toHaveAttribute('aria-pressed', 'false')
  })

  it('saving a new item from the Calendar Grid closes the left panel by default', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      data: {
        event: {
          id: 'evt-grid-save',
          title: 'Grid save item',
          description: '',
          meeting_link: null,
          location: null,
          start_time: VISIBLE_WEEK_ITEM_START.toISOString(),
          end_time: new Date(VISIBLE_WEEK_ITEM_START.getTime() + 30 * 60 * 1000).toISOString(),
          source_type: 'manual',
          source_id: 'mode-main',
          category_ids: [],
        },
      },
    })

    renderPage()
    await screen.findByRole('heading', { name: 'Time Management' })
    await selectTimeOnGrid()
    expect(isLeftPanelOpen()).toBe(true)

    fireEvent.change(await screen.findByPlaceholderText(TITLE_PLACEHOLDER), { target: { value: 'Grid save item' } })
    fireEvent.click(screen.getAllByTestId('calendar-grid-save-button')[0])

    await waitFor(() => expect(apiClient.post).toHaveBeenCalled())
    await waitFor(() => expect(isLeftPanelOpen()).toBe(false))
  })

  it('saving a new item from the Left Sidebar does not close the panel by default, but does once enabled', async () => {
    vi.mocked(apiClient.post)
      .mockResolvedValueOnce({
        data: {
          event: {
            id: 'evt-sidebar-save-1',
            title: 'Sidebar save item 1',
            description: '',
            meeting_link: null,
            location: null,
            start_time: VISIBLE_WEEK_ITEM_START.toISOString(),
            end_time: new Date(VISIBLE_WEEK_ITEM_START.getTime() + 30 * 60 * 1000).toISOString(),
            source_type: 'manual',
            source_id: 'mode-main',
            category_ids: [],
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          event: {
            id: 'evt-sidebar-save-2',
            title: 'Sidebar save item 2',
            description: '',
            meeting_link: null,
            location: null,
            start_time: VISIBLE_WEEK_ITEM_START.toISOString(),
            end_time: new Date(VISIBLE_WEEK_ITEM_START.getTime() + 30 * 60 * 1000).toISOString(),
            source_type: 'manual',
            source_id: 'mode-main',
            category_ids: [],
          },
        },
      })

    renderPage()
    await screen.findByRole('heading', { name: 'Time Management' })

    await selectTimeOnGrid()
    fireEvent.change(await screen.findByPlaceholderText(TITLE_PLACEHOLDER), { target: { value: 'Sidebar save item 1' } })
    fireEvent.click(screen.getByTestId('left-sidebar-save-button'))
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1))
    expect(isLeftPanelOpen()).toBe(true)

    await openModeSettings()
    fireEvent.click(screen.getByTestId('close-left-panel-on-save-surface-leftSidebar'))
    expect(screen.getByTestId('close-left-panel-on-save-surface-leftSidebar')).toHaveAttribute('aria-pressed', 'true')

    await selectTimeOnGrid()
    fireEvent.change(await screen.findByPlaceholderText(TITLE_PLACEHOLDER), { target: { value: 'Sidebar save item 2' } })
    fireEvent.click(screen.getByTestId('left-sidebar-save-button'))

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(isLeftPanelOpen()).toBe(false))
  })

  it('saving from Full View does not close the panel by default, but does once enabled', async () => {
    vi.mocked(apiClient.post)
      .mockResolvedValueOnce({
        data: {
          event: {
            id: 'evt-full-view-1',
            title: 'Full view item 1',
            description: '',
            meeting_link: null,
            location: null,
            start_time: VISIBLE_WEEK_ITEM_START.toISOString(),
            end_time: new Date(VISIBLE_WEEK_ITEM_START.getTime() + 30 * 60 * 1000).toISOString(),
            source_type: 'manual',
            source_id: 'mode-main',
            category_ids: [],
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          event: {
            id: 'evt-full-view-2',
            title: 'Full view item 2',
            description: '',
            meeting_link: null,
            location: null,
            start_time: VISIBLE_WEEK_ITEM_START.toISOString(),
            end_time: new Date(VISIBLE_WEEK_ITEM_START.getTime() + 30 * 60 * 1000).toISOString(),
            source_type: 'manual',
            source_id: 'mode-main',
            category_ids: [],
          },
        },
      })

    renderPage()
    await screen.findByRole('heading', { name: 'Time Management' })

    await selectTimeOnGrid()
    fireEvent.change(await screen.findByPlaceholderText(TITLE_PLACEHOLDER), { target: { value: 'Full view item 1' } })
    fireEvent.click(screen.getAllByTestId('calendar-grid-open-full-view')[0])
    fireEvent.click(await screen.findByTestId('full-editor-save-button'))
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1))
    expect(isLeftPanelOpen()).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await openModeSettings()
    fireEvent.click(screen.getByTestId('close-left-panel-on-save-surface-fullView'))
    expect(screen.getByTestId('close-left-panel-on-save-surface-fullView')).toHaveAttribute('aria-pressed', 'true')

    await selectTimeOnGrid()
    fireEvent.change(await screen.findByPlaceholderText(TITLE_PLACEHOLDER), { target: { value: 'Full view item 2' } })
    fireEvent.click(screen.getAllByTestId('calendar-grid-open-full-view')[0])
    fireEvent.click(await screen.findByTestId('full-editor-save-button'))

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(isLeftPanelOpen()).toBe(false))
  })

  it('disabling the master toggle prevents every surface from closing the panel', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      data: {
        event: {
          id: 'evt-master-off',
          title: 'No close item',
          description: '',
          meeting_link: null,
          location: null,
          start_time: VISIBLE_WEEK_ITEM_START.toISOString(),
          end_time: new Date(VISIBLE_WEEK_ITEM_START.getTime() + 30 * 60 * 1000).toISOString(),
          source_type: 'manual',
          source_id: 'mode-main',
          category_ids: [],
        },
      },
    })

    renderPage()
    await screen.findByRole('heading', { name: 'Time Management' })

    await selectTimeOnGrid()
    await openModeSettings()
    fireEvent.click(screen.getByTestId('close-left-panel-on-save-toggle'))
    expect(screen.getByTestId('close-left-panel-on-save-toggle')).toHaveAttribute('aria-checked', 'false')

    expect(screen.getByTestId('close-left-panel-on-save-surface-calendarGrid')).toBeDisabled()
    expect(screen.getByTestId('close-left-panel-on-save-surface-leftSidebar')).toBeDisabled()
    expect(screen.getByTestId('close-left-panel-on-save-surface-fullView')).toBeDisabled()

    fireEvent.change(await screen.findByPlaceholderText(TITLE_PLACEHOLDER), { target: { value: 'No close item' } })
    fireEvent.click(screen.getAllByTestId('calendar-grid-save-button')[0])

    await waitFor(() => expect(apiClient.post).toHaveBeenCalled())
    expect(isLeftPanelOpen()).toBe(true)
  })

  it('updating an existing item from the Left Sidebar does not close the panel by default, but does once enabled', async () => {
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
      if (url === '/api/user-events') return { data: { events: [MANUAL_EVENT] } }
      return { data: {} }
    })
    vi.mocked(apiClient.put).mockResolvedValue({ data: { event: { ...MANUAL_EVENT, title: 'Existing item updated' } } })

    renderPage()
    await screen.findByRole('heading', { name: 'Time Management' })

    fireEvent.click((await screen.findAllByText('Existing item'))[0])
    const titleInput = await screen.findByDisplayValue('Existing item')
    fireEvent.change(titleInput, { target: { value: 'Existing item updated' } })
    fireEvent.click(screen.getByTestId('left-sidebar-update-button'))

    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith(
        `/api/user-events/${MANUAL_EVENT.id}`,
        expect.objectContaining({ title: 'Existing item updated' })
      )
    )
    expect(isLeftPanelOpen()).toBe(true)

    await openModeSettings()
    fireEvent.click(screen.getByTestId('close-left-panel-on-save-surface-leftSidebar'))
    expect(screen.getByTestId('close-left-panel-on-save-surface-leftSidebar')).toHaveAttribute('aria-pressed', 'true')

    fireEvent.change(screen.getByDisplayValue('Existing item updated'), { target: { value: 'Existing item updated again' } })
    fireEvent.click(screen.getByTestId('left-sidebar-update-button'))

    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith(
        `/api/user-events/${MANUAL_EVENT.id}`,
        expect.objectContaining({ title: 'Existing item updated again' })
      )
    )
    await waitFor(() => expect(isLeftPanelOpen()).toBe(false))
  })

  it('applying an autosave Quick Object against an existing selection closes the left panel', async () => {
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
                quick_templates: [AUTOSAVE_QUICK_TEMPLATE],
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
    localStorage.setItem(
      'time-management-v1',
      JSON.stringify({ showQuickTemplatesInMain: true, quickTemplatesMainExpanded: true })
    )
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      data: {
        event: {
          id: 'evt-from-autosave-template',
          title: 'Daily standup',
          description: '',
          meeting_link: null,
          location: null,
          start_time: VISIBLE_WEEK_ITEM_START.toISOString(),
          end_time: new Date(VISIBLE_WEEK_ITEM_START.getTime() + 30 * 60 * 1000).toISOString(),
          source_type: 'manual',
          source_id: 'mode-main',
          category_ids: [],
        },
      },
    })

    renderPage()
    await screen.findByRole('heading', { name: 'Time Management' })

    await selectTimeOnGrid()
    expect(isLeftPanelOpen()).toBe(true)

    fireEvent.click(await screen.findByRole('button', { name: 'Apply Template' }))

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/user-events', expect.anything()))
    await waitFor(() => expect(isLeftPanelOpen()).toBe(false))
  })
})
