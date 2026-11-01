import '@testing-library/jest-dom/vitest'
import { startOfWeek } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { capturedEditors, editorMountTiming } = vi.hoisted(() => ({
  capturedEditors: [] as unknown[],
  editorMountTiming: { delayMs: 0 },
}))

vi.mock('@tiptap/react', async () => {
  const actual = await vi.importActual<typeof import('@tiptap/react')>('@tiptap/react')
  const { useEffect, useState } = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useEditor: (...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args)
      const [isReady, setIsReady] = useState(editorMountTiming.delayMs === 0)
      useEffect(() => {
        if (isReady) return
        const timer = setTimeout(() => setIsReady(true), editorMountTiming.delayMs)
        return () => clearTimeout(timer)
      }, [isReady])
      if (editor && !capturedEditors.includes(editor)) {
        capturedEditors.push(editor)
      }
      return isReady ? editor : null
    },
  }
})

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

async function findModalEditor(): Promise<HTMLElement> {
  return waitFor(() => {
    const editor = document.querySelector<HTMLElement>('div.fixed.inset-0 .markdown-editor')
    if (!editor) throw new Error('expected modal editor to be mounted')
    return editor
  })
}

describe('MarkdownComposer loads stored markdown as rendered nodes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    editorMountTiming.delayMs = 0
    capturedEditors.length = 0
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
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    const itemLabels = await screen.findAllByText('Stored markdown event')
    const itemLabel = itemLabels[0]
    if (!itemLabel) throw new Error('expected at least one stored markdown event label')
    fireEvent.doubleClick(itemLabel)

    await screen.findByRole('button', { name: 'Collapse' }, { timeout: 5000 })

    const editor = await findModalEditor()

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

  it.each([0, 50])('does not merge item location into editor notes on open (editor mount delay: %i ms)', async (delayMs) => {
    editorMountTiming.delayMs = delayMs
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
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    const itemLabels = await screen.findAllByText('Stored location link event')
    const itemLabel = itemLabels[0]
    if (!itemLabel) throw new Error('expected at least one stored location link event label')
    fireEvent.doubleClick(itemLabel)

    await screen.findByRole('button', { name: 'Collapse' }, { timeout: 5000 })

    const editor = await findModalEditor()

    await waitFor(() => {
      expect(editor.textContent ?? '').toContain('Meeting body only')
    })
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
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    const itemLabels = await screen.findAllByText('Stored single-break event')
    const itemLabel = itemLabels[0]
    if (!itemLabel) throw new Error('expected at least one stored single-break event label')
    fireEvent.doubleClick(itemLabel)

    await screen.findByRole('button', { name: 'Collapse' }, { timeout: 5000 })

    const editor = await findModalEditor()

    await waitFor(() => {
      expect(editor.querySelector('br')).toBeTruthy()
    })
  })

  it('keeps single-line collapse title and link together without newlines when serialized and loaded', async () => {
    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })
    fireEvent.click(screen.getByTitle('Open full view editor'))

    const editorDom = await findModalEditor()

    interface TiptapEditorLike {
      commands: { setContent: (content: string, options?: { contentType?: string }) => void }
      getMarkdown: () => string
    }
    const lastEditor = capturedEditors[capturedEditors.length - 1] as TiptapEditorLike
    const STORED_MARKDOWN_WITH_LINK_SUMMARY =
      ':::details\n\n' +
      ':::detailsSummary\n\n' +
      'WMT Price Chart:\n\n' +
      '[https://coinmarketcap.com/currencies/world-mobile-token/](https://coinmarketcap.com/currencies/world-mobile-token/)\n\n' +
      ':::\n\n' +
      ':::detailsContent\n\n' +
      'Staking is yielding ~220 WMT\n\n' +
      ':::\n\n' +
      ':::\n'

    lastEditor.commands.setContent(STORED_MARKDOWN_WITH_LINK_SUMMARY, { contentType: 'markdown' })
    const summary = editorDom.querySelector('summary')
    expect(summary).toBeTruthy()
    expect(summary?.innerHTML).not.toContain('<br>')
    expect(summary?.textContent).toBe('WMT Price Chart: https://coinmarketcap.com/currencies/world-mobile-token/')

    // Ensure serializing back to markdown keeps it as a single line
    const serializedMd = lastEditor.getMarkdown()
    expect(serializedMd).toContain(':::detailsSummary\nWMT Price Chart: [https://coinmarketcap.com/currencies/world-mobile-token/](https://coinmarketcap.com/currencies/world-mobile-token/)\n:::')
  })

  it('keeps single-line collapse title intact on preview without splitting', async () => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    const start = new Date(Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate(), 12, 0, 0))
    const end = new Date(start.getTime() + 90 * 60 * 1000)

    const MARKDOWN_WITH_CUSTOM_TITLE =
      ':::details\n\n' +
      ':::detailsSummary\n' +
      'WMT Price Chart:\n\n' +
      ':::\n\n' +
      ':::detailsContent\n' +
      'https://www.tradingview.com/chart/?symbol=BINANCE%3AWMTUSDT\n\n' +
      ':::\n\n' +
      ':::'

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
                id: 'evt-custom-title',
                title: 'Custom title collapse event',
                description: MARKDOWN_WITH_CUSTOM_TITLE,
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
    const itemLabels = await screen.findAllByText('Custom title collapse event')
    const itemLabel = itemLabels[0]
    if (!itemLabel) throw new Error('expected item label')
    fireEvent.click(itemLabel)

    // Check NotePreview in the left panel / side view
    await waitFor(() => {
      const summaryEl = document.querySelector('summary')
      expect(summaryEl).toBeTruthy()
      expect(summaryEl?.textContent?.trim()).toBe('WMT Price Chart:')
    })
  })
})
