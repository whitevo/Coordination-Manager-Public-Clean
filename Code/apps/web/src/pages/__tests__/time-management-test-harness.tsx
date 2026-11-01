import type { ReactNode } from 'react'
import { vi } from 'vitest'
import { apiClient } from '../../lib/api-client'
import { clearSessionCacheValue } from '../../lib/session-data-cache'
import type { UseTimezonesReturn } from '../../lib/use-timezones'

export const mockDedupedGet = vi.fn()
export const mockUseAuth = vi.fn()
export const mockUseTimezones = vi.fn(createDefaultTimezoneState)

vi.mock('../../lib/api-client', () => ({
  apiClient: {
    get: vi.fn(async () => ({ data: {} })),
    post: vi.fn(async () => ({ data: {} })),
    put: vi.fn(async () => ({ data: {} })),
    patch: vi.fn(async () => ({ data: {} })),
    delete: vi.fn(async () => ({ data: {} })),
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
  useTimezones: () => mockUseTimezones(),
}))

vi.mock('../../lib/timezone-data', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/timezone-data')>(),
  convertUtcTimeToTimezone: (value: string) => value,
  getCurrentTimeInTimezone: () => '00:00',
  findTimezone: () => undefined,
}))

function createDefaultTimezoneState(): UseTimezonesReturn {
  return {
    primary: 'UTC',
    additional: [],
    all: ['UTC'],
    setPrimary: vi.fn(),
    addTimezone: vi.fn(),
    removeTimezone: vi.fn(),
    replaceTimezone: vi.fn(),
    canAddMore: true,
    getEntry: vi.fn(),
  }
}

vi.mock('../../lib/calendarOverlapLayout', () => ({
  computeDayLayout: (events: Array<{ id: string }>) => ({
    eventSegments: events.map((event, index) => ({
      eventId: event.id,
      eventIndex: index,
      top: 104,
      height: 78,
      leftPercent: 0,
      widthPercent: 100,
      isFirstSegment: true,
    })),
    overflowSegments: [],
  }),
}))

export function installDefaultApiMocks(): void {
  mockUseTimezones.mockReturnValue(createDefaultTimezoneState())
  clearSessionCacheValue('time-management:events:anon')
  vi.mocked(apiClient.get).mockImplementation(async (url) => mockDedupedGet(url))
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
              sync_calendars: [{ id: 'coord-main', enabled: true }],
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
}

export function installEditorDomPolyfills(): void {
  const emptyRect = () => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
  })

  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    value: vi.fn(),
    configurable: true,
  })

  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    value: vi.fn(),
    configurable: true,
  })

  if (!HTMLElement.prototype.getClientRects) {
    Object.defineProperty(HTMLElement.prototype, 'getClientRects', {
      value: () => [],
      configurable: true,
    })
  }

  if (!HTMLElement.prototype.getBoundingClientRect) {
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      value: emptyRect,
      configurable: true,
    })
  }

  if (!Range.prototype.getClientRects) {
    Object.defineProperty(Range.prototype, 'getClientRects', {
      value: () => [],
      configurable: true,
    })
  }

  if (!Range.prototype.getBoundingClientRect) {
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      value: emptyRect,
      configurable: true,
    })
  }

  const textProto = typeof Text !== 'undefined'
    ? (Text.prototype as unknown as {
        getClientRects?: () => DOMRect[]
        getBoundingClientRect?: () => DOMRect
      })
    : undefined

  if (textProto && !textProto.getClientRects) {
    Object.defineProperty(textProto, 'getClientRects', {
      value: () => [],
      configurable: true,
    })
  }

  if (textProto && !textProto.getBoundingClientRect) {
    Object.defineProperty(textProto, 'getBoundingClientRect', {
      value: emptyRect,
      configurable: true,
    })
  }

  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    callback(0)
    return 0
  })

  const pointTarget = () => document.body
  const pointsTarget = () => [document.body]

  ;(document as Document & { elementFromPoint?: (x: number, y: number) => Element | null }).elementFromPoint = pointTarget
  ;(Document.prototype as Document & { elementFromPoint?: (x: number, y: number) => Element | null }).elementFromPoint = pointTarget

  ;(document as Document & { elementsFromPoint?: (x: number, y: number) => Element[] }).elementsFromPoint = pointsTarget
  ;(Document.prototype as Document & { elementsFromPoint?: (x: number, y: number) => Element[] }).elementsFromPoint = pointsTarget

  if (typeof ShadowRoot !== 'undefined') {
    ;(
      ShadowRoot.prototype as ShadowRoot & {
        elementFromPoint?: (x: number, y: number) => Element | null
      }
    ).elementFromPoint = pointTarget
  }
}
