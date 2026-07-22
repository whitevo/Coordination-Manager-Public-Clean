import '@testing-library/jest-dom'
import { startOfWeek } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import {
  installEditorDomPolyfills,
  mockDedupedGet,
  mockUseAuth,
} from './time-management-test-harness'
import TimeManagementPage from '../TimeManagementPage'

// Round-trip guarantee: whatever markdown sits in the database must be
// rendered as rich content (bold, links, lists, details blocks), not shown
// as raw markdown source text.

const STORED_MARKDOWN =
  '**Bold heading**\n\n' +
  '- [x] checked task\n' +
  '- bullet item\n\n' +
  '[link label](https://example.com)\n\n' +
  ':::details\n\n' +
  ':::detailsSummary\nCollapsed title\n\n' +
  ':::\n\n' +
  ':::detailsContent\ninside details\n\n' +
  ':::\n\n' +
  ':::'

describe('MarkdownComposer loads stored markdown as rendered nodes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    mockUseAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      isTraveler: false,
    })

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
                id: 'evt-markdown',
                title: 'Stored markdown event',
                description: STORED_MARKDOWN,
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

    installEditorDomPolyfills()
  })

  it('renders stored markdown as rich nodes (not raw source)', async () => {
    render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    const itemLabels = await screen.findAllByText('Stored markdown event')
    const itemLabel = itemLabels[0]
    if (!itemLabel) throw new Error('expected at least one stored markdown event label')
    fireEvent.doubleClick(itemLabel)

    await screen.findByRole('button', { name: 'Collapse' })

    const editor = document.querySelector('div.fixed.inset-0 .markdown-editor') as HTMLElement | null
    expect(editor).toBeTruthy()
    if (!editor) throw new Error('expected modal editor')

    // Bold rendered as <strong>, not literal "**"
    await waitFor(() => {
      const strongs = editor.querySelectorAll('strong')
      expect(strongs.length).toBeGreaterThanOrEqual(1)
    })
    expect(editor.textContent ?? '').not.toContain('**Bold heading**')
    expect(editor.textContent ?? '').toContain('Bold heading')

    // Task list rendered as <ul data-type="taskList"> with a checked item
    expect(editor.querySelector("ul[data-type='taskList']")).toBeTruthy()
    expect(editor.querySelector("[data-checked='true']")).toBeTruthy()

    // Link rendered as <a href=...>, not literal "[label](url)"
    const anchor = editor.querySelector('a[href="https://example.com"]')
    expect(anchor).toBeTruthy()
    expect(editor.textContent ?? '').not.toContain('[link label](https://example.com)')

    // Details block rendered with summary and content nodes
    expect(editor.querySelector("[data-type='details'], details")).toBeTruthy()
    expect(editor.textContent ?? '').toContain('Collapsed title')
    expect(editor.textContent ?? '').not.toContain(':::details')
    expect(editor.textContent ?? '').not.toContain(':::detailsSummary')
  })

  it('does not merge item location into editor notes on open', async () => {
    const locationUrl = 'https://example.com/location-link'
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
                id: 'evt-location-link',
                title: 'Stored location link event',
                description: 'Meeting body only',
                meeting_link: null,
                location: locationUrl,
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
    const itemLabels = await screen.findAllByText('Stored location link event')
    const itemLabel = itemLabels[0]
    if (!itemLabel) throw new Error('expected at least one stored location link event label')
    fireEvent.doubleClick(itemLabel)

    await screen.findByRole('button', { name: 'Collapse' })

    const editor = document.querySelector('div.fixed.inset-0 .markdown-editor') as HTMLElement | null
    expect(editor).toBeTruthy()
    if (!editor) throw new Error('expected modal editor')

    expect(editor.textContent ?? '').toContain('Meeting body only')
    expect(editor.textContent ?? '').not.toContain(locationUrl)
  })

  it('preserves single-line breaks as hard breaks after reload', async () => {
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
                id: 'evt-single-break',
                title: 'Stored single-break event',
                description: 'Line one\nLine two',
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
    const itemLabels = await screen.findAllByText('Stored single-break event')
    const itemLabel = itemLabels[0]
    if (!itemLabel) throw new Error('expected at least one stored single-break event label')
    fireEvent.doubleClick(itemLabel)

    await screen.findByRole('button', { name: 'Collapse' })

    const editor = document.querySelector('div.fixed.inset-0 .markdown-editor') as HTMLElement | null
    expect(editor).toBeTruthy()
    if (!editor) throw new Error('expected modal editor')

    await waitFor(() => {
      expect(editor.querySelector('br')).toBeTruthy()
    })
  })
})
