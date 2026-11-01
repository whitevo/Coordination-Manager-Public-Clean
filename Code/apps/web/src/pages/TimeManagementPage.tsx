import { mergeFetchedEventsWithLocalState, reuseUnchangedEvents, type TimeItemRecurrence, type UserEventRecord } from './time-management-event-reconciliation'
import { ConditionalRecurrenceIcon } from '@/components/conditional-recurrence-icon'
import { TimeItemRecurrenceStatus } from '@/components/time-item-recurrence-status'
import { MarkdownComposer } from '@/components/lazy-time-management-editor'
import { getWeekEventWindow, isEventInWindow, type UserEventWindow } from '@/lib/user-event-window'
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { addDays, addMonths, addYears, addWeeks, eachDayOfInterval, endOfMonth, format, isSameDay, startOfDay, startOfMonth, startOfWeek, subMonths, subWeeks } from 'date-fns'
import { AlertTriangle, Calendar, CalendarDays, CheckCircle2, CheckSquare, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronUp, Clock3, Copy, GripVertical, Info, Lock, Loader2, MapPin, Maximize2, Palette, PanelLeftClose, PanelLeftOpen, Pencil, Plus, RefreshCw, Repeat2, Save, Scissors, Send, Tag, Trash2, Unplug, X, ZoomIn, ZoomOut } from 'lucide-react'
import { apiClient, dedupedGet } from '../lib/api-client'
import { getSessionCacheValue, isSessionCacheFresh, setSessionCacheValue } from '../lib/session-data-cache'
import { useAuth } from '../contexts/AuthContext'
import { useAiAssistant } from '../contexts/AiAssistantContext'
import { buildAiEvaluation, isMutationRequest, type AiRetryRequest } from '../lib/ai-evaluation'
import { LeftPanelPortal } from '../contexts/LayoutContext'
import TimezoneSelector from '../components/TimezoneSelector'
import ColorGridPicker from '../components/ColorGridPicker'
import TimeGridPicker from '../components/time-grid-picker'
import ConfirmDialog from '../components/ConfirmDialog'
import { Button, Disclosure, IconButton, SegmentedControl, Switch, ToggleButton } from '../components/ui'
import { Dialog } from '../components/ui/Dialog'
import { OVERLAY_LAYER_CLASS, OVERLAY_SCRIM, isTopOverlay, pushOverlay } from '../lib/overlay-layers'
import { useOverlayLayer } from '../lib/use-overlay-layer'
import { clampTopBelowObstruction } from '../lib/top-obstruction'
import { getRecurringEventStartsInRange, splitRecurringEventRule, type RecurringEditScope } from '../lib/recurrence'
import GoogleSyncStatus, { type GoogleLinkStatus } from '../components/google-sync-status'
import { buildDiffuseTimeBackgroundFill, findTimeItemDurationByTitle, inferRequestedTimezoneForAiResponse, isExplicitPrimaryTimezoneChangeRequest } from './time-management-page-helpers'
import { normalizeTimeManagementAiAccess } from './time-management-ai-access'
import { adjustTimeRangeEdge, getTimeRangeDaySegments, normaliseTimeRangeToWeek } from './time-management-time-adjustment'
import {
  canStepZoomLevel,
  DAY_ZOOM_LEVELS,
  DEFAULT_DAY_ZOOM_LEVEL,
  formatDayZoomLabel,
  formatTimeZoomLabel,
  getDayRangeLengthForIndexes,
  getDayWindowIndexes,
  getMondayBasedWeekday,
  getNavigationWeekStep,
  getVisibleDayIndexes,
  isDayZoomLevel,
  shiftDayWindow,
  stepDayZoomLevel,
  stepTimeZoomLevel,
  TIME_ZOOM_LEVELS,
  zoomOutDayLevel,
  type DayZoomLevel,
} from './time-management-zoom'
import { useTimezones } from '../lib/use-timezones'
import { TIME_GRID_TOUCH_HOLD_MS, useTimeGridTouchSelection } from '../hooks/use-time-grid-touch-selection'
import { useDismissOnlyGesture } from '../hooks/use-dismiss-only-gesture'
import { useMobileNavigationPanelDismiss } from '../hooks/use-mobile-navigation-panel-dismiss'
import { createTouchSelectGate } from '../lib/touch-select-gate'
import { isSafeUrl } from '../lib/calendar-utils'
import { convertUtcTimeToTimezoneOnDate, detectDstTransitions, getTimezoneAbbrOnDate, getCurrentTimeInTimezone, findTimezone } from '../lib/timezone-data'
import { computeDayLayout, type LayoutEvent } from '../lib/calendarOverlapLayout'
import type { RecurrenceRule, RecurrenceType, RecurrenceUnit, RecurrenceEndType } from '../lib/recurrence'

interface Category {
  id: string
  label: string
  color: string
  font_color: string
  background_opacity?: number
  item_opacity?: number
  sort_order: number
}

interface CategoryDraft {
  label: string
  color: string
  fontColor: string
  backgroundOpacity: number
  itemOpacity: number
}

type CategoryColorTarget = 'background' | 'font'
type CategoryColorDisplayStyle = 'horizontal' | 'vertical_left' | 'vertical_right'

interface TimeManagementPrefs {
  main_color: string
  main_label: string
  category_color_display_style: CategoryColorDisplayStyle
}

interface TimeManagementMode {
  id: string
  name: string
  main_color: string
  slot_minutes: number
  category_color_display_style?: CategoryColorDisplayStyle
  updated_at?: string
  sync_calendars: unknown
  time_backgrounds: unknown
  collapsed_background_ids: unknown
  quick_templates: unknown
  show_quick_templates_in_main?: boolean
}

interface ModeJsonPayload {
  version: number
  exported_at: string
  mode_id: string
  name: string
  main_color: string
  slot_minutes: number
  sync_calendars: SyncCalendar[]
  public_sync_calendars: SyncCalendar[]
  categories: Category[]
  time_backgrounds: TimeBackgroundPeriod[]
  collapsed_background_ids: string[]
  quick_templates: QuickTemplate[]
  show_quick_templates_in_main: boolean
  category_color_display_style: CategoryColorDisplayStyle
}

interface SyncCalendar {
  id: string
  name: string
  color: string
  enabled: boolean
  sourceType: 'app' | 'external'
  externalKind?: 'google_oauth' | 'google_public_url'
  secondaryLabel?: string
}

interface ConnectedCalendarSource {
  id: string
  source_type: 'google_oauth' | 'google_public_url'
  google_email: string | null
  public_url: string | null
  display_name: string
  color: string
  is_active: boolean
}

interface SyncImportsResponse {
  syncedSources?: number
  inserted?: number
  updated?: number
  deleted?: number
  totalFound?: number
  results?: Array<{
    sourceType: 'google_oauth' | 'google_public_url' | 'coordination_calendar'
    sourceId: string
    inserted: number
    updated: number
    deleted: number
    totalFound: number
    error?: string
  }>
}

type SourceLoadState = 'disabled' | 'loading' | 'synced' | 'error'

interface WeekWindowCacheEntry {
  events: UserEventRecord[]
  updatedAt: number
}

interface ItemSelectionFeedback {
  itemId: string
  sequence: number
}

interface TimeItem {
  id: string
  interactionId: string
  sourceEventId: string
  occurrenceStartTime: string
  title: string
  notes: string
  dayIndex: number
  startMinute: number
  durationMinutes: number
  actualDurationMinutes: number
  totalDurationMinutes?: number
  categoryIds: string[]
  sourceId: string
  sourceType: UserEventRecord['source_type']
  recurrenceRule?: RecurrenceRule | null
  recurrenceStatus?: 'active' | 'completed'
  isRecurringOccurrence: boolean
  isStartSegment: boolean
  isEndSegment: boolean
}

interface SelectionDraft {
  dayIndex: number
  startMinute: number
  endMinute: number
}

interface GridContextTarget {
  dayIndex: number
  minute: number
}

type PendingUnsavedAction =
  | { type: 'switch-item'; itemId: string }
  | { type: 'new-selection'; dayIndex: number; minute: number }
  | { type: 'create-new-item'; dayIndex: number; minute: number }

interface PendingUnsavedAnchor {
  x: number
  y: number
}

interface ResizeState {
  itemId: string
  sourceEventId: string
  dayIndex: number
  edge: 'start' | 'end'
  dayColumnElement: HTMLDivElement
  originalEvent: UserEventRecord
  originalOccurrenceStartTime: string
  originalOccurrenceEndTime: string
  isRecurringEvent: boolean
  originalStartMinute: number
  originalEndMinute: number
}

interface RecurringResizePreviewState {
  dayIndex: number
  startMinute: number
  durationMinutes: number
}

interface DragDropPreviewState {
  dayIndex: number
  startMinute: number
  durationMinutes: number
  itemId: string
}

interface PointerDragState {
  item: TimeItem
  interactionId: string
  pointerId: number
  startClientX: number
  startClientY: number
  latestClientX: number
  latestClientY: number
  hasStarted: boolean
}

interface ItemDraft {
  title: string
  notes: string
  location?: string | null
  categoryIds: string[]
  sourceId: string
  recurrenceRule: RecurrenceRule
}

interface TimeBackgroundPeriod {
  id: string
  label: string
  startMinute: number
  endMinute: number
  color: string
  opacity: number
}

interface CopiedItemMetadata {
  title: string
  description: string | null
  meetingLink: string | null
  location: string | null
  durationMinutes: number
  isPublic: boolean
  sourceId: string
  sourceType: UserEventRecord['source_type']
  categoryIds: string[]
  recurrenceRule: RecurrenceRule
}

interface MultiClipboardItem extends CopiedItemMetadata {
  dayOffset: number
  minuteOffset: number
}

interface MultiClipboardData {
  items: MultiClipboardItem[]
  isCut: boolean
  sourceEventIds: string[]
}

// A create/update write that failed to reach the server. The full local
// snapshot is cached so the item survives a page reload and can be restored
// into view, then automatically retried until it lands.
interface UnsyncedTimeItemOp {
  eventId: string
  kind: 'create' | 'update'
  method: 'post' | 'put'
  endpoint: string
  payload: Record<string, unknown>
  snapshot: UserEventRecord
  attempts: number
  firstFailedAt: number
  lastAttemptAt: number
  lastError: string
}

interface QuickTemplate {
  id: string
  quickName: string
  title: string
  notes: string
  categoryIds: string[]
  autoSaveEnabled: boolean
  sourceItemId: string
  createdAt: string
}

interface CloseLeftPanelOnSaveSurfaces {
  calendarGrid: boolean
  leftSidebar: boolean
  fullView: boolean
}

type CloseLeftPanelOnSaveSurface = keyof CloseLeftPanelOnSaveSurfaces

const DEFAULT_CLOSE_LEFT_PANEL_ON_SAVE_SURFACES: CloseLeftPanelOnSaveSurfaces = {
  calendarGrid: true,
  leftSidebar: false,
  fullView: false,
}

type OpenLeftPanelOnSelectionMode = 'always' | 'minDuration' | 'never'
type OpenLeftPanelOnItemSelectionMode = OpenLeftPanelOnSelectionMode | 'description'

const DEFAULT_OPEN_LEFT_PANEL_ON_SELECTION_MODE: OpenLeftPanelOnSelectionMode = 'always'
const DEFAULT_OPEN_LEFT_PANEL_MIN_SELECTION_MINUTES = 15
const OPEN_LEFT_PANEL_MIN_SELECTION_MINUTE_OPTIONS = [15, 30, 45, 60, 90, 120] as const
const TIME_SELECTION_PANEL_OPTIONS = [
  { key: 'always', label: 'Always' },
  { key: 'minDuration', label: 'Longer selections only' },
  { key: 'never', label: 'Never' },
] as const
const ITEM_SELECTION_PANEL_OPTIONS = [
  { key: 'always', label: 'Always', buttonLabel: 'Always' },
  { key: 'description', label: 'Only when description exists', buttonLabel: 'Has description' },
  { key: 'never', label: 'Never', buttonLabel: 'Never' },
  { key: 'minDuration', label: 'Only when longer than X minutes', buttonLabel: 'Longer than X min' },
] as const

function isOpenLeftPanelOnSelectionMode(value: unknown): value is OpenLeftPanelOnSelectionMode {
  return value === 'always' || value === 'minDuration' || value === 'never'
}

function isOpenLeftPanelOnItemSelectionMode(value: unknown): value is OpenLeftPanelOnItemSelectionMode {
  return isOpenLeftPanelOnSelectionMode(value) || value === 'description' || value === 'never'
}

function normaliseOpenLeftPanelMinSelectionMinutes(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_OPEN_LEFT_PANEL_MIN_SELECTION_MINUTES
  return Math.min(MINUTES_IN_DAY, Math.max(0, Math.round(parsed)))
}

interface StoredPreferences {
  syncCalendars: SyncCalendar[]
  slotMinutes: TimeWidth
  dayZoomLevel: DayZoomLevel
  showTimeZoomQuickButtons: boolean
  showDayZoomQuickButtons: boolean
  timeBackgrounds: TimeBackgroundPeriod[]
  collapsedBackgroundIds: string[]
  quickTemplates: QuickTemplate[]
  showQuickTemplatesInMain: boolean
  quickTemplatesMainExpanded: boolean
  isLeftPanelOpen: boolean
  leftPanelWidthPx: number
  expandedSections: LeftPanelSectionId[]
  showActiveSourcesWhenCollapsed: boolean
  closeLeftPanelOnSaveEnabled: boolean
  closeLeftPanelOnSaveSurfaces: CloseLeftPanelOnSaveSurfaces
  openLeftPanelOnSelectionMode: OpenLeftPanelOnSelectionMode
  openLeftPanelMinSelectionMinutes: number
  openLeftPanelOnItemSelectionMode: OpenLeftPanelOnItemSelectionMode
  openLeftPanelMinItemSelectionMinutes: number
}

type LeftPanelSectionId = 'month' | 'modes' | 'sources' | 'categories' | 'editor' | 'timeWidth' | 'quickObjects'
type TimeManagementLayoutMode = 'phone' | 'tablet' | 'desktop'
type MobileSurface = 'calendar' | 'tools' | 'quickObjects'

interface TimeManagementAiAction {
  type: string
  section?: LeftPanelSectionId
  minutes?: number
  iana?: string
  mode?: 'primary' | 'add'
  label?: string
  startTime?: string
  endTime?: string
  timezone?: string
  color?: string
  opacity?: number
  matchLabel?: string
  index?: number
  modeName?: string
  style?: CategoryColorDisplayStyle
  fontColor?: string
  backgroundOpacity?: number
  itemOpacity?: number
  enabled?: boolean
  expanded?: boolean
  sourceName?: string
}

interface TimeManagementAiResponse {
  actions?: TimeManagementAiAction[]
  explanation?: string
  summary?: string
  remaining?: number
  limit?: number
  systemPrompt?: string
  retryToken?: string
}

const TIME_MANAGEMENT_AI_CONFIG_PATH = '/settings?tab=ai&section=time-management-ai-access'
const TIME_MANAGEMENT_AI_LINK_SEARCH_ACCESS = ['timeItems'] as const

function isTimeItemSearchRequest(message: string): boolean {
  const lower = message.toLowerCase()
  return /\b(find|search|look for|locate|list|show me)\b/.test(lower)
    && /\b(link|links|url|urls|miro|board|notes?|description|time items?|calendar items?)\b/.test(lower)
}

function isTimeItemDurationRequest(message: string): boolean {
  const lower = message.toLowerCase()
  return /\b(hours?|duration|time spent|how long|total time)\b/.test(lower)
    && /\b(how many|total|spent|worked|developed|time)\b/.test(lower)
}

const removeDuplicateResponseSections = (text: string) => {
  const seen = new Set<string>()
  return text
    .split(/\n{2,}/)
    .map(section => section.trim())
    .filter((section) => {
      if (!section) return false
      const key = section.toLowerCase().replace(/\s+/g, ' ')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .join('\n\n')
}

interface ApiErrorShape {
  response?: {
    status?: number
    data?: {
      error?: string
      message?: string
    }
  }
  message?: string
}

// A missing response means the request never reached the server (offline,
// DNS failure, timeout); a 5xx means the server itself failed. Both are worth
// retrying. A 4xx is a rejection of this exact payload (validation, auth,
// permissions) that a retry would not fix, so it is not queued.
function isRetryableWriteError(err: unknown): boolean {
  const shape = err as ApiErrorShape
  const status = shape?.response?.status
  if (status === undefined) return true
  return status >= 500
}


const SLOT_HEIGHT = 26
const START_HOUR = 0
const END_HOUR = 24
const MINUTES_IN_DAY = (END_HOUR - START_HOUR) * 60
type TimeWidth = 15 | 30 | 60
const DEFAULT_SLOT_MINUTES: TimeWidth = 30
const STORAGE_KEY = 'time-management-v1'
const TIME_MANAGEMENT_SYNC_CHANNEL = 'coord-time-management-sync'
const TIME_MANAGEMENT_SYNC_STORAGE_KEY = 'coord-time-management-sync-ping'
// Window in which a just-committed local write wins over a refetch response.
const MUTATION_COMPLETION_GRACE_MS = 5000
const MUTATION_COMPLETION_RETENTION_MS = 60000
const CROSS_SESSION_REVISION_POLL_INTERVAL_MS = 5000
const UNSYNCED_QUEUE_STORAGE_KEY = 'time-management-unsynced-v1'
const UNSYNCED_RETRY_INTERVAL_MS = 8000
// Only warn the user once a write has been failing for a while; avoids
// flashing the banner for a single transient network blip.
const UNSYNCED_WARNING_THRESHOLD_MS = 20000
const DAY_MS = 24 * 60 * 60 * 1000
const MAIN_SOURCE_ID = 'coord-main'
const AUTO_SAVE_DELAY_MS = 15000
const SAVE_SUCCESS_HOLD_MS = 2500
const WEEK_WINDOW_CACHE_RADIUS = 1
// Minimum day column width in the 14/28 day views; narrower columns scroll horizontally.
const MULTI_WEEK_MIN_DAY_WIDTH_PX = 72
const WEEK_WINDOW_CACHE_TTL_MS = 60 * 1000
// How long a cross-navigation events cache stays fresh enough to paint the page
// instantly (skip the loading banner) instead of showing the loading state again.
const EVENTS_SESSION_CACHE_TTL_MS = 5 * 60 * 1000

function getEventsSessionCacheKey(userId: string | null | undefined): string {
  return `time-management:events:${userId ?? 'anon'}`
}

const TAGS_LEGEND_COLOR = '#6b7280'
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/
const DEFAULT_CATEGORY_FONT_COLOR = '#ffffff'
const DEFAULT_CATEGORY_BACKGROUND_OPACITY = 1
const DEFAULT_CATEGORY_ITEM_OPACITY = 1
const DEFAULT_CATEGORY_COLOR_DISPLAY_STYLE: CategoryColorDisplayStyle = 'horizontal'
const DEFAULT_TIME_BACKGROUND_COLOR = '#0ea5e9'
const DEFAULT_TIME_BACKGROUND_OPACITY = 0.18
const DEFAULT_TIME_BACKGROUND_START_MINUTE = 12 * 60
const DEFAULT_TIME_BACKGROUND_END_MINUTE = 20 * 60
const MIN_TIME_BACKGROUND_OPACITY = 0
const MAX_TIME_BACKGROUND_OPACITY = 1
const TIME_BACKGROUND_COLOR_PALETTE = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899']
const EDGE_HIT_PX = 7
const DAY_COLUMN_ITEM_GUTTER_PERCENT = 3
const DRAG_SCROLL_EDGE_PX = 72
const DRAG_SCROLL_MAX_STEP_PX = 28
const CALENDAR_REPEAT_COUNT = 3
const CALENDAR_REPEAT_MIDDLE_INDEX = 1
const DEFAULT_LEFT_PANEL_WIDTH_PX = 320
const MIN_LEFT_PANEL_WIDTH_PX = 260
const LEFT_PANEL_MAX_VIEWPORT_RATIO = 0.5
const PHONE_BREAKPOINT_PX = 768
const TABLET_BREAKPOINT_PX = 1024
const MAX_MODE_COUNT = 3
const MODE_NAME_SUGGESTIONS = ['Planning', 'test'] as const

const formatAutoSaveCountdown = (milliseconds: number) => {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000))
  return `${seconds}s`
}

const DEFAULT_SYNC_CALENDARS: SyncCalendar[] = [
  {
    id: MAIN_SOURCE_ID,
    name: 'Coordination Manager Main',
    color: '#2563eb',
    enabled: true,
    sourceType: 'app',
  },
]

function isTimeWidth(value: unknown): value is TimeWidth {
  return value === 15 || value === 30 || value === 60
}

function getSuggestedModeName(modes: Pick<TimeManagementMode, 'name'>[]): string {
  const used = new Set(
    modes
      .map((mode) => mode.name.trim().toLowerCase())
      .filter((name) => name.length > 0)
  )

  const [primaryName, fallbackName] = MODE_NAME_SUGGESTIONS
  if (!used.has(primaryName.toLowerCase())) {
    return primaryName
  }

  return fallbackName
}

function isLeftPanelSectionId(value: unknown): value is LeftPanelSectionId {
  return value === 'month' || value === 'modes' || value === 'sources' || value === 'categories' || value === 'editor' || value === 'timeWidth' || value === 'quickObjects'
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_RE.test(value)
}

function isRecurrenceType(value: unknown): value is RecurrenceType {
  return value === 'none' || value === 'weekly' || value === 'biweekly' || value === 'monthly' || value === 'monthlyWeek' || value === 'custom'
}

function isRecurrenceUnit(value: unknown): value is RecurrenceUnit {
  return value === 'day' || value === 'week' || value === 'month'
}

function isRecurrenceEndType(value: unknown): value is RecurrenceEndType {
  return value === 'never' || value === 'on' || value === 'after' || value === 'whenCompleted'
}

function resolveShowQuickTemplatesInMain(value: unknown): boolean {
  return value === true
}

function normaliseRecurrenceRule(value: unknown): RecurrenceRule {
  if (!value || typeof value !== 'object') {
    return { type: 'none' }
  }

  const candidate = value as Record<string, unknown>
  const type = isRecurrenceType(candidate.type) ? candidate.type : 'none'
  if (type === 'none') {
    return { type: 'none' }
  }

  const intervalValue = typeof candidate.interval === 'number' ? candidate.interval : Number(candidate.interval)
  const interval = Number.isFinite(intervalValue) && intervalValue > 0 ? Math.min(99, Math.floor(intervalValue)) : 1
  const unit = isRecurrenceUnit(candidate.unit) ? candidate.unit : 'week'
  const weekDays = Array.isArray(candidate.weekDays)
    ? Array.from(new Set(candidate.weekDays.filter((entry): entry is number => Number.isInteger(entry) && entry >= 0 && entry <= 6)))
    : undefined
  const monthWeeks = Array.isArray(candidate.monthWeeks)
    ? Array.from(new Set(candidate.monthWeeks.filter((entry): entry is number => Number.isInteger(entry) && entry >= 1 && entry <= 4))).sort((a, b) => a - b)
    : undefined
  const endType = isRecurrenceEndType(candidate.endType) ? candidate.endType : 'never'
  const endDate = typeof candidate.endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(candidate.endDate) ? candidate.endDate : undefined
  const endCountValue = typeof candidate.endCount === 'number' ? candidate.endCount : Number(candidate.endCount)
  const endCount = Number.isFinite(endCountValue) && endCountValue > 0 ? Math.min(500, Math.floor(endCountValue)) : undefined
  const exceptions = Array.isArray(candidate.exceptions)
    ? Array.from(new Set(candidate.exceptions.filter((entry): entry is string => typeof entry === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry)))).slice(0, 500)
    : undefined

  return {
    type,
    interval,
    unit,
    weekDays: weekDays && weekDays.length > 0 ? weekDays : undefined,
    monthWeeks: monthWeeks && monthWeeks.length > 0 ? monthWeeks : undefined,
    endType,
    endDate,
    endCount,
    exceptions: exceptions && exceptions.length > 0 ? exceptions : undefined,
    ...(type === 'custom' && unit === 'week' && typeof candidate.weekOffsetDays === 'number'
      && Number.isInteger(candidate.weekOffsetDays) && candidate.weekOffsetDays > 0 && candidate.weekOffsetDays < interval * 7
      ? { weekOffsetDays: candidate.weekOffsetDays } : {}),
  }
}

function formatRecurrenceSummary(rule: RecurrenceRule | null | undefined): string {
  if (!rule || rule.type === 'none') return 'Does not repeat'
  if (rule.type === 'weekly') return 'Weekly'
  if (rule.type === 'biweekly') return 'Bi-weekly'
  if (rule.type === 'monthly') return 'Monthly'
  if (rule.type === 'monthlyWeek') {
    const weekLabels = ['1st', '2nd', '3rd', '4th']
    const weeks = rule.monthWeeks && rule.monthWeeks.length > 0 ? rule.monthWeeks : []
    return weeks.length > 0 ? `Monthly (${weeks.map((w) => weekLabels[w - 1] || `${w}th`).join(', ')} wk)` : 'Monthly (by week)'
  }
  const interval = rule.interval || 1
  const unit = rule.unit || 'week'
  return `Every ${interval} ${unit}${interval === 1 ? '' : 's'}`
}

function getUtcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function getLocalDateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

function getWeekWindowKey(weekStart: Date, sourceIds: string[]): string {
  return `${getLocalDateKey(weekStart)}::${[...sourceIds].sort().join('|')}`
}

function getNeighborWeekStarts(weekStart: Date): Date[] {
  return Array.from({ length: WEEK_WINDOW_CACHE_RADIUS * 2 + 1 }, (_, index) => addWeeks(weekStart, index - WEEK_WINDOW_CACHE_RADIUS))
}

function getRecurrenceWeekdayIndex(date: Date): number {
  const jsDay = date.getUTCDay()
  return jsDay === 0 ? 6 : jsDay - 1
}

/** Which occurrence (1st, 2nd, 3rd, 4th...) of its own weekday a date is within its month. */
function getWeekOfMonth(date: Date): number {
  return Math.floor((date.getUTCDate() - 1) / 7) + 1
}

function getRecurringOccurrenceStartsInWeek(event: UserEventRecord, currentWeekStart: Date, rangeDays = 7): string[] {
  return getRecurringEventStartsInRange(
    event,
    new Date(toUtcDateParts(currentWeekStart)),
    new Date(toUtcDateParts(addDays(currentWeekStart, rangeDays))),
    { calendarDayCadence: true },
  )
}

function shiftRecurrenceRuleByDays(rule: RecurrenceRule, dayShift: number): RecurrenceRule {
  if (rule.type === 'none' || dayShift === 0) return rule
  const shiftKey = (key: string): string => {
    const parsed = new Date(`${key}T00:00:00Z`)
    parsed.setUTCDate(parsed.getUTCDate() + dayShift)
    return getUtcDateKey(parsed)
  }
  const weekDays = rule.weekDays && rule.weekDays.length > 0
    ? Array.from(new Set(rule.weekDays.map((wd) => (((wd + dayShift) % 7) + 7) % 7)))
    : rule.weekDays
  const endDate = rule.endType === 'on' && rule.endDate ? shiftKey(rule.endDate) : rule.endDate
  const exceptions = rule.exceptions && rule.exceptions.length > 0 ? rule.exceptions.map(shiftKey) : rule.exceptions
  return { ...rule, weekDays, endDate, exceptions }
}

function normaliseCategoryColorDisplayStyle(value: unknown): CategoryColorDisplayStyle {
  if (value === 'vertical_left' || value === 'vertical_right') {
    return value
  }
  return DEFAULT_CATEGORY_COLOR_DISPLAY_STYLE
}

function getApiErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error && typeof error === 'object') {
    const apiError = error as ApiErrorShape
    const responseError = apiError.response?.data?.error
    if (typeof responseError === 'string' && responseError.trim().length > 0) {
      return responseError
    }
    const responseMessage = apiError.response?.data?.message
    if (typeof responseMessage === 'string' && responseMessage.trim().length > 0) {
      return responseMessage
    }
    if (typeof apiError.message === 'string' && apiError.message.trim().length > 0) {
      return apiError.message
    }
  }
  return fallbackMessage
}

function clampOpacity(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return DEFAULT_TIME_BACKGROUND_OPACITY
  }

  return Math.min(MAX_TIME_BACKGROUND_OPACITY, Math.max(MIN_TIME_BACKGROUND_OPACITY, numeric))
}

function normaliseCategoryBackgroundOpacity(value: unknown): number {
  const next = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(next)) {
    return DEFAULT_CATEGORY_BACKGROUND_OPACITY
  }
  return Math.min(1, Math.max(0, next))
}

function normaliseCategoryItemOpacity(value: unknown): number {
  const next = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(next)) {
    return DEFAULT_CATEGORY_ITEM_OPACITY
  }
  return Math.min(1, Math.max(0, next))
}

function formatTimeInput(minute: number): string {
  const safeMinute = Math.min(Math.max(Math.round(minute), 0), MINUTES_IN_DAY - 1)
  const hours = Math.floor(safeMinute / 60)
  const minutes = safeMinute % 60
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
}

function formatTimeUntilStartLabel(occurrenceStartTime: string): string | null {
  const startDate = new Date(occurrenceStartTime)
  if (Number.isNaN(startDate.getTime())) {
    return null
  }

  const diffMs = startDate.getTime() - Date.now()
  if (diffMs <= 0) {
    return null
  }

  const minutes = Math.ceil(diffMs / (1000 * 60))
  if (minutes < 60) {
    return `Starts in ${minutes} min`
  }

  const hours = Math.ceil(minutes / 60)
  if (hours < 48) {
    return `Starts in ${hours} hr${hours === 1 ? '' : 's'}`
  }

  const days = Math.ceil(hours / 24)
  return `Starts in ${days} day${days === 1 ? '' : 's'}`
}

function parseTimeInput(value: string): number {
  const [rawHours = '0', rawMinutes = '0'] = value.split(':')
  const hours = Math.min(23, Math.max(0, Number.parseInt(rawHours, 10) || 0))
  const minutes = Math.min(59, Math.max(0, Number.parseInt(rawMinutes, 10) || 0))
  return hours * 60 + minutes
}

function pickRandomBackgroundColor(existingColors: string[]): string {
  const normalized = new Set(existingColors.map((color) => color.toLowerCase()))
  const available = TIME_BACKGROUND_COLOR_PALETTE.filter((color) => !normalized.has(color.toLowerCase()))
  const pool = available.length > 0 ? available : TIME_BACKGROUND_COLOR_PALETTE
  const index = Math.floor(Math.random() * pool.length)
  return pool[index]
}

function createTimeBackgroundPeriod(existingColors: string[]): TimeBackgroundPeriod {
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `period-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  return {
    id: randomId,
    label: '',
    startMinute: DEFAULT_TIME_BACKGROUND_START_MINUTE,
    endMinute: DEFAULT_TIME_BACKGROUND_END_MINUTE,
    color: pickRandomBackgroundColor(existingColors),
    opacity: clampOpacity(DEFAULT_TIME_BACKGROUND_OPACITY),
  }
}

function createQuickTemplateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `quick-template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function buildDefaultQuickTemplateName(title: string): string {
  const trimmed = title.trim()
  if (!trimmed) return 'Quick template'
  return trimmed
}

function buildQuickTemplateShortcutLabel(quickName: string): string {
  const trimmed = quickName.trim()
  if (!trimmed) return 'Template'
  if (trimmed.length <= 10) return trimmed
  return `${trimmed.slice(0, 8)}..`
}

function notesToEventDescription(notes: string): string | null {
  return notes.trim().length > 0 ? notes : null
}

function buildCopiedDescriptionWithLocation(description: string | null, location: string | null): string | null {
  const rawDescription = typeof description === 'string' ? description : ''
  const trimmedDescription = rawDescription.trim()
  const trimmedLocation = typeof location === 'string' ? location.trim() : ''

  if (!trimmedLocation) {
    return trimmedDescription.length > 0 ? rawDescription : null
  }

  const locationLine = `Location: ${trimmedLocation}`
  const hasLocationLine = rawDescription
    .split(/\r?\n/)
    .some((line) => line.trim().toLowerCase() === locationLine.toLowerCase())

  if (hasLocationLine) {
    return trimmedDescription.length > 0 ? rawDescription : locationLine
  }

  if (trimmedDescription.length === 0) {
    return locationLine
  }

  return `${trimmedDescription}\n\n${locationLine}`
}

function buildEventDraftNotes(event: Pick<UserEventRecord, 'description'>): string {
  return event.description || ''
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

// Returns true only when the draft's title, notes, and category tags still match
// one of the saved quick templates exactly. Used to decide whether an Esc press
// may safely discard the draft (untouched quick-button values) versus preserving
// content the user wrote or modified by hand.
function draftMatchesQuickTemplate(
  draft: Pick<ItemDraft, 'title' | 'notes' | 'categoryIds'>,
  templates: QuickTemplate[]
): boolean {
  const draftTitle = draft.title.trim()
  const draftNotes = draft.notes.trim()
  const draftCategoryIds = [...draft.categoryIds].sort()
  return templates.some((template) => {
    if (template.title.trim() !== draftTitle) return false
    if (template.notes.trim() !== draftNotes) return false
    return areStringArraysEqual([...template.categoryIds].sort(), draftCategoryIds)
  })
}

function normaliseStoredQuickTemplate(source: unknown): QuickTemplate | null {
  if (!source || typeof source !== 'object') return null

  const candidate = source as Record<string, unknown>
  const id = typeof candidate.id === 'string' && candidate.id.trim().length > 0
    ? candidate.id
    : createQuickTemplateId()
  const title = typeof candidate.title === 'string' ? candidate.title : ''
  const notes = typeof candidate.notes === 'string' ? candidate.notes : ''
  const quickName = typeof candidate.quickName === 'string' && candidate.quickName.trim().length > 0
    ? candidate.quickName
    : buildDefaultQuickTemplateName(title)
  const categoryIds = Array.isArray(candidate.categoryIds)
    ? candidate.categoryIds.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : []
  const sourceItemId = typeof candidate.sourceItemId === 'string' ? candidate.sourceItemId : ''
  const createdAt = typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString()

  if (!title.trim() && !notes.trim()) {
    return null
  }

  return {
    id,
    quickName,
    title,
    notes,
    categoryIds,
    // Legacy templates persisted before this flag existed should still auto-apply.
    autoSaveEnabled: candidate.autoSaveEnabled !== false,
    sourceItemId,
    createdAt,
  }
}

function normaliseStoredTimeBackground(source: unknown): TimeBackgroundPeriod | null {
  if (!source || typeof source !== 'object') return null

  const candidate = source as Record<string, unknown>
  const id = typeof candidate.id === 'string' ? candidate.id : ''
  const startMinute = typeof candidate.startMinute === 'number' ? Math.round(candidate.startMinute) : Number.NaN
  const endMinute = typeof candidate.endMinute === 'number' ? Math.round(candidate.endMinute) : Number.NaN

  if (!id || !Number.isFinite(startMinute) || !Number.isFinite(endMinute)) {
    return null
  }

  const safeStart = Math.min(MINUTES_IN_DAY - 1, Math.max(0, startMinute))
  const safeEnd = Math.min(MINUTES_IN_DAY - 1, Math.max(0, endMinute))
  if (safeStart === safeEnd) {
    return null
  }

  return {
    id,
    label: typeof candidate.label === 'string' ? candidate.label : '',
    startMinute: safeStart,
    endMinute: safeEnd,
    color: isHexColor(candidate.color) ? candidate.color.toLowerCase() : DEFAULT_TIME_BACKGROUND_COLOR,
    opacity: clampOpacity(candidate.opacity),
  }
}

function serialiseTimeBackgroundPeriodsForCompare(value: unknown): string {
  const list = Array.isArray(value)
    ? value
        .map((entry) => normaliseStoredTimeBackground(entry))
        .filter((entry): entry is TimeBackgroundPeriod => Boolean(entry))
    : []
  return JSON.stringify(
    list.map((period) => [
      period.id,
      period.label,
      period.startMinute,
      period.endMinute,
      period.color,
      period.opacity,
    ])
  )
}

function serialiseCollapsedBackgroundIdsForCompare(value: unknown): string {
  const ids: string[] = []
  if (value instanceof Set) {
    for (const id of value) {
      if (typeof id === 'string') ids.push(id)
    }
  } else if (Array.isArray(value)) {
    for (const id of value) {
      if (typeof id === 'string') ids.push(id)
    }
  }
  ids.sort()
  return JSON.stringify(ids)
}

function serialiseQuickTemplatesForCompare(value: unknown): string {
  const list = Array.isArray(value)
    ? value
        .map((entry) => normaliseStoredQuickTemplate(entry))
        .filter((entry): entry is QuickTemplate => Boolean(entry))
    : []

  return JSON.stringify(
    list.map((template) => [
      template.id,
      template.quickName,
      template.title,
      template.notes,
      template.categoryIds,
      template.autoSaveEnabled,
      template.sourceItemId,
      template.createdAt,
    ])
  )
}

function serialiseSyncCalendarsForCompare(value: unknown): string {
  const list = Array.isArray(value)
    ? value
        .map((entry) => normaliseStoredSyncCalendar(entry))
        .filter((entry): entry is SyncCalendar => Boolean(entry))
    : []

  const normalized = list
    .map((source) => {
      if (source.sourceType === 'external') {
        return {
          id: source.id,
          enabled: source.enabled,
          sourceType: 'external' as const,
          externalKind: source.externalKind,
          displayName: source.name,
          secondaryLabel: source.secondaryLabel,
        }
      }
      return {
        id: source.id,
        enabled: source.enabled,
      }
    })
    .sort((left, right) => left.id.localeCompare(right.id))

  return JSON.stringify(normalized)
}

function getTimeBackgroundSegments(period: TimeBackgroundPeriod): Array<{ startMinute: number; endMinute: number }> {
  if (period.endMinute > period.startMinute) {
    return [{ startMinute: period.startMinute, endMinute: period.endMinute }]
  }

  return [
    { startMinute: period.startMinute, endMinute: MINUTES_IN_DAY },
    { startMinute: 0, endMinute: period.endMinute },
  ]
}

function hexToRgba(hex: string, alpha: number): string {
  if (!isHexColor(hex)) {
    return `rgba(14, 165, 233, ${clampOpacity(alpha)})`
  }

  const clean = hex.slice(1)
  const red = Number.parseInt(clean.slice(0, 2), 16)
  const green = Number.parseInt(clean.slice(2, 4), 16)
  const blue = Number.parseInt(clean.slice(4, 6), 16)

  return `rgba(${red}, ${green}, ${blue}, ${clampOpacity(alpha)})`
}

function persistStoredPreferences(state: StoredPreferences): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

function resolveModeVisualState(
  _mode: TimeManagementMode,
  serverTimeBackgrounds: TimeBackgroundPeriod[],
  serverCollapsedBackgroundIds: string[]
): { timeBackgrounds: TimeBackgroundPeriod[]; collapsedBackgroundIds: string[] } {
  return {
    timeBackgrounds: serverTimeBackgrounds,
    collapsedBackgroundIds: serverCollapsedBackgroundIds,
  }
}

function normaliseStoredSyncCalendar(source: unknown): SyncCalendar | null {
  if (!source || typeof source !== 'object') return null

  const candidate = source as Record<string, unknown>
  const id = typeof candidate.id === 'string' ? candidate.id : ''
  if (!id) return null

  const resolvedName =
    typeof candidate.name === 'string'
      ? candidate.name
      : typeof candidate.displayName === 'string'
        ? candidate.displayName
        : typeof candidate.display_name === 'string'
          ? candidate.display_name
          : id === MAIN_SOURCE_ID
            ? 'Coordination Manager Main'
            : 'Calendar'

  const resolvedSourceType =
    candidate.sourceType === 'external' || candidate.source_type === 'external'
      ? 'external'
      : 'app'

  let resolvedExternalKind: SyncCalendar['externalKind']
  if (candidate.externalKind === 'google_oauth' || candidate.externalKind === 'google_public_url') {
    resolvedExternalKind = candidate.externalKind
  } else if (candidate.external_kind === 'google_oauth' || candidate.external_kind === 'google_public_url') {
    resolvedExternalKind = candidate.external_kind
  } else {
    resolvedExternalKind = undefined
  }

  const resolvedSecondaryLabel =
    typeof candidate.secondaryLabel === 'string'
      ? candidate.secondaryLabel
      : typeof candidate.secondary_label === 'string'
        ? candidate.secondary_label
        : undefined

  return {
    id,
    name: resolvedName,
    color: typeof candidate.color === 'string' ? candidate.color : '#0f766e',
    enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : true,
    sourceType: resolvedSourceType,
    externalKind: resolvedExternalKind,
    secondaryLabel: resolvedSecondaryLabel,
  }
}

function isPlaceholderExternalSourceName(value: string): boolean {
  const trimmed = value.trim().toLowerCase()
  return trimmed.length === 0 || trimmed === 'calendar'
}

function mergeModeExternalSource(params: {
  existingSource: SyncCalendar | undefined
  modeSource: SyncCalendar
  enabledFromMode: boolean
}): SyncCalendar {
  const { existingSource, modeSource, enabledFromMode } = params
  const nextName =
    isPlaceholderExternalSourceName(modeSource.name) && existingSource?.name
      ? existingSource.name
      : modeSource.name

  return {
    ...modeSource,
    name: nextName,
    enabled: enabledFromMode,
    secondaryLabel: modeSource.secondaryLabel ?? existingSource?.secondaryLabel,
  }
}

function isReadOnlySource(source: SyncCalendar | null | undefined): boolean {
  if (!source) return false
  return source.sourceType === 'external' || (source.sourceType === 'app' && source.id !== MAIN_SOURCE_ID)
}

function buildAppSyncSourcesForMode(params: {
  allModes: TimeManagementMode[]
  activeModeId: string
  activeModeName: string
  activeModeColor: string
  modeSyncById: Map<string, SyncCalendar>
  previousSources: SyncCalendar[]
  mainEnabled: boolean
}): SyncCalendar[] {
  const {
    allModes,
    activeModeId,
    activeModeName,
    activeModeColor,
    modeSyncById,
    previousSources,
    mainEnabled,
  } = params

  const previousById = new Map(previousSources.map((source) => [source.id, source]))
  const secondarySources = allModes
    .filter((mode) => mode.id !== activeModeId)
    .map((mode) => {
      const modeSource = modeSyncById.get(mode.id)
      const previousSource = previousById.get(mode.id)
      return {
        id: mode.id,
        name: mode.name?.trim() || previousSource?.name || 'Mode',
        color: isHexColor(mode.main_color) ? mode.main_color : previousSource?.color || '#0f766e',
        enabled: modeSource ? Boolean(modeSource.enabled) : (previousSource?.enabled ?? false),
        sourceType: 'app' as const,
        secondaryLabel: 'Read-only mirror',
      }
    })

  return [
    {
      id: MAIN_SOURCE_ID,
      name: activeModeName,
      color: activeModeColor,
      enabled: mainEnabled,
      sourceType: 'app' as const,
    },
    ...secondarySources,
  ]
}

function buildModeJsonPayload(params: {
  mode: TimeManagementMode
  syncCalendars: SyncCalendar[]
  categories: Category[]
  timeBackgrounds: TimeBackgroundPeriod[]
  collapsedBackgroundIds: Set<string>
  quickTemplates: QuickTemplate[]
  showQuickTemplatesInMain: boolean
}): ModeJsonPayload {
  const {
    mode,
    syncCalendars,
    categories,
    timeBackgrounds,
    collapsedBackgroundIds,
    quickTemplates,
    showQuickTemplatesInMain,
  } = params

  const publicSyncCalendars = syncCalendars.filter(
    (source) => source.sourceType === 'external' && source.externalKind === 'google_public_url'
  )

  return {
    version: 1,
    exported_at: new Date().toISOString(),
    mode_id: mode.id,
    name: typeof mode.name === 'string' && mode.name.trim().length > 0 ? mode.name.trim() : 'Imported Mode',
    main_color: isHexColor(mode.main_color) ? mode.main_color : '#2563eb',
    slot_minutes: isTimeWidth(mode.slot_minutes) ? mode.slot_minutes : DEFAULT_SLOT_MINUTES,
    sync_calendars: syncCalendars,
    public_sync_calendars: publicSyncCalendars,
    categories,
    time_backgrounds: timeBackgrounds,
    collapsed_background_ids: Array.from(collapsedBackgroundIds),
    quick_templates: quickTemplates,
    show_quick_templates_in_main: showQuickTemplatesInMain,
    category_color_display_style: normaliseCategoryColorDisplayStyle(mode.category_color_display_style),
  }
}

function buildModePrefs(mode: Pick<TimeManagementMode, 'main_color' | 'name' | 'category_color_display_style'>): TimeManagementPrefs {
  return {
    main_color: isHexColor(mode.main_color) ? mode.main_color : '#2563eb',
    main_label:
      typeof mode.name === 'string' && mode.name.trim().length > 0
        ? mode.name.trim()
        : 'Coordination Manager Main',
    category_color_display_style: normaliseCategoryColorDisplayStyle(mode.category_color_display_style),
  }
}

function clampMinute(minute: number, slotMinutes: number): number {
  if (minute < 0) return 0
  if (minute > MINUTES_IN_DAY - slotMinutes) return MINUTES_IN_DAY - slotMinutes
  return minute
}

function snapMinute(minute: number, slotMinutes: number): number {
  return clampMinute(Math.floor(minute / slotMinutes) * slotMinutes, slotMinutes)
}

function snapMinuteUnbounded(minute: number, slotMinutes: number): number {
  return Math.round(minute / slotMinutes) * slotMinutes
}

function resolveDropStartMinute(
  pointerMinute: number,
  dragTopOffsetMinutes: number,
  slotMinutes: number,
  _durationMinutes: number
): number {
  return snapMinuteUnbounded(pointerMinute - dragTopOffsetMinutes, slotMinutes)
}

function wrapMinuteWithinDay(minute: number): number {
  return ((minute % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY
}

function normaliseDroppedMinuteToWeekDay(dayIndex: number, startMinute: number): { dayIndex: number; startMinute: number } | null {
  let nextDayIndex = dayIndex
  let nextMinute = startMinute

  while (nextMinute < 0) {
    nextDayIndex -= 1
    nextMinute += MINUTES_IN_DAY
  }

  while (nextMinute >= MINUTES_IN_DAY) {
    nextDayIndex += 1
    nextMinute -= MINUTES_IN_DAY
  }

  if (nextDayIndex < 0 || nextDayIndex > 6) {
    return null
  }

  return { dayIndex: nextDayIndex, startMinute: nextMinute }
}

function formatAdjustedTimeLabel({ day, minute, iana }: {
  day: Date
  minute: number
  iana: string
}): string {
  const minuteWithinDay = wrapMinuteWithinDay(minute)
  const utc = `${Math.floor(minuteWithinDay / 60).toString().padStart(2, '0')}:${(minuteWithinDay % 60).toString().padStart(2, '0')}`
  const dayOffset = Math.floor(minute / MINUTES_IN_DAY)
  const time = convertUtcTimeToTimezoneOnDate(utc, iana, addDays(day, dayOffset))
  return dayOffset === 0 ? time : `${time} (${format(addDays(day, dayOffset), 'EEE d MMM')})`
}

function buildCategoryStripe(
  categoryIds: string[],
  lookup: Map<string, Category>,
  angle: '90deg' | '45deg' | '135deg' = '90deg',
  withOpacity = true
): string {
  const categories = categoryIds
    .map((id) => lookup.get(id))
    .filter((v): v is Category => Boolean(v))

  const colors = categories
    .map((category) => {
      if (!withOpacity) return category.color
      return hexToRgba(category.color, normaliseCategoryBackgroundOpacity(category.background_opacity))
    })
    .filter((v): v is string => Boolean(v))

  if (colors.length === 0) return TAGS_LEGEND_COLOR
  if (colors.length === 1) return colors[0]
  const step = 100 / colors.length

  return `linear-gradient(${angle}, ${colors
    .map((color, idx) => `${color} ${Math.floor(step * idx)}% ${Math.floor(step * (idx + 1))}%`)
    .join(', ')})`
}

function buildQuickTemplateBackground(
  categoryIds: string[],
  lookup: Map<string, Category>,
  angle: '90deg' | '45deg' | '135deg' = '135deg'
): string {
  const categories = categoryIds
    .map((id) => lookup.get(id))
    .filter((v): v is Category => Boolean(v))

  const colors = categories
    .map((category) => {
      const opacity = Math.min(normaliseCategoryBackgroundOpacity(category.background_opacity) + 0.1, 0.34)
      return hexToRgba(category.color, opacity)
    })
    .filter((v): v is string => Boolean(v))

  if (colors.length === 0) return 'hsl(var(--muted) / 0.34)'
  if (colors.length === 1) return colors[0]
  const step = 100 / colors.length

  return `linear-gradient(${angle}, ${colors
    .map((color, idx) => `${color} ${Math.floor(step * idx)}% ${Math.floor(step * (idx + 1))}%`)
    .join(', ')})`
}

function resolveCategoryDisplayAngle(displayStyle: CategoryColorDisplayStyle): '90deg' | '45deg' | '135deg' {
  if (displayStyle === 'vertical_left') return '135deg'
  if (displayStyle === 'vertical_right') return '45deg'
  return '90deg'
}

function buildCategoryTextColor(categoryIds: string[], lookup: Map<string, Category>): string {
  const fontColors = categoryIds
    .map((id) => lookup.get(id)?.font_color)
    .filter((v): v is string => Boolean(v))

  if (fontColors.length === 0) return DEFAULT_CATEGORY_FONT_COLOR
  return fontColors[0]
}

function buildCategoryTextFill(
  categoryIds: string[],
  lookup: Map<string, Category>,
  angle: '90deg' | '45deg' | '135deg' = '90deg'
): CSSProperties {
  const fontColors = categoryIds
    .map((id) => lookup.get(id)?.font_color)
    .filter((v): v is string => Boolean(v))

  if (fontColors.length <= 1) {
    return { color: fontColors[0] || DEFAULT_CATEGORY_FONT_COLOR }
  }

  const step = 100 / fontColors.length
  const gradient = `linear-gradient(${angle}, ${fontColors
    .map((color, idx) => `${color} ${Math.floor(step * idx)}% ${Math.floor(step * (idx + 1))}%`)
    .join(', ')})`

  return {
    color: 'transparent',
    backgroundImage: gradient,
    backgroundClip: 'text',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  }
}

function getItemOpacityFromCategories(categoryIds: string[], lookup: Map<string, Category>): number {
  if (categoryIds.length === 0) return DEFAULT_CATEGORY_ITEM_OPACITY
  const opacities = categoryIds
    .map((id) => lookup.get(id)?.item_opacity)
    .filter((v): v is number => typeof v === 'number')
  if (opacities.length === 0) return DEFAULT_CATEGORY_ITEM_OPACITY
  return Math.min(...opacities)
}

function buildCategoryCardStyle(
  categoryIds: string[],
  lookup: Map<string, Category>,
  displayStyle: CategoryColorDisplayStyle,
  surface: 'quick-template' | 'time-item'
): CSSProperties {
  const angle = resolveCategoryDisplayAngle(displayStyle)

  if (surface === 'time-item') {
    return {
      // Calendar Time Items should not use opacity blending.
      background: buildCategoryStripe(categoryIds, lookup, angle, false),
      // Apply item-level opacity when categories are present
      ...(categoryIds.length > 0 && {
        opacity: getItemOpacityFromCategories(categoryIds, lookup),
      }),
    }
  }

  return {
    // Quick Objects keep the opacity-based blending effect.
    background: buildQuickTemplateBackground(categoryIds, lookup, angle),
  }
}

function buildTimeItemTextColor(
  categoryIds: string[],
  lookup: Map<string, Category>
): string {
  return buildCategoryTextColor(categoryIds, lookup)
}

function extendedMonthGridDays(monthDate: Date): Date[] {
  const monthStart = startOfMonth(monthDate)
  const monthEnd = endOfMonth(monthDate)
  const firstWeekStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const lastWeekEnd = addDays(startOfWeek(monthEnd, { weekStartsOn: 1 }), 6)
  return eachDayOfInterval({ start: addDays(firstWeekStart, -7), end: addDays(lastWeekEnd, 7) })
}

function loadPersistedPreferences(): StoredPreferences | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredPreferences> & {
      syncCalendars?: unknown
      slotMinutes?: unknown
      timeBackgrounds?: unknown
      collapsedBackgroundIds?: unknown
      quickTemplates?: unknown
      showQuickTemplatesInMain?: unknown
      quickTemplatesMainExpanded?: unknown
      isLeftPanelOpen?: unknown
      leftPanelWidthPx?: unknown
      expandedSections?: unknown
      closeLeftPanelOnSaveEnabled?: unknown
      closeLeftPanelOnSaveSurfaces?: unknown
      openLeftPanelOnSelectionMode?: unknown
      openLeftPanelMinSelectionMinutes?: unknown
      openLeftPanelOnItemSelectionMode?: unknown
      openLeftPanelMinItemSelectionMinutes?: unknown
    }

    const storedSyncCalendars = Array.isArray(parsed.syncCalendars)
      ? parsed.syncCalendars
          .map((source) => normaliseStoredSyncCalendar(source))
          .filter((source): source is SyncCalendar => Boolean(source))
      : []

    const syncCalendarMap = new Map<string, SyncCalendar>()
    for (const source of DEFAULT_SYNC_CALENDARS) {
      syncCalendarMap.set(source.id, source)
    }
    for (const source of storedSyncCalendars) {
      syncCalendarMap.set(source.id, source)
    }

    const timeBackgrounds = Array.isArray(parsed.timeBackgrounds)
      ? parsed.timeBackgrounds
          .map((period) => normaliseStoredTimeBackground(period))
          .filter((period): period is TimeBackgroundPeriod => Boolean(period))
      : []

    const collapsedBackgroundIds = Array.isArray(parsed.collapsedBackgroundIds)
      ? parsed.collapsedBackgroundIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : []

    const quickTemplates = Array.isArray(parsed.quickTemplates)
      ? parsed.quickTemplates
          .map((template) => normaliseStoredQuickTemplate(template))
          .filter((template): template is QuickTemplate => Boolean(template))
      : []

    const expandedSections = Array.isArray(parsed.expandedSections)
      ? Array.from(new Set(parsed.expandedSections.filter((section): section is LeftPanelSectionId => isLeftPanelSectionId(section))))
      : []

    const leftPanelWidthPx =
      typeof parsed.leftPanelWidthPx === 'number' && Number.isFinite(parsed.leftPanelWidthPx)
        ? Math.round(parsed.leftPanelWidthPx)
        : DEFAULT_LEFT_PANEL_WIDTH_PX

    const storedCloseSurfaces = parsed.closeLeftPanelOnSaveSurfaces as Partial<CloseLeftPanelOnSaveSurfaces> | undefined
    const closeLeftPanelOnSaveSurfaces: CloseLeftPanelOnSaveSurfaces = {
      calendarGrid: typeof storedCloseSurfaces?.calendarGrid === 'boolean'
        ? storedCloseSurfaces.calendarGrid
        : DEFAULT_CLOSE_LEFT_PANEL_ON_SAVE_SURFACES.calendarGrid,
      leftSidebar: typeof storedCloseSurfaces?.leftSidebar === 'boolean'
        ? storedCloseSurfaces.leftSidebar
        : DEFAULT_CLOSE_LEFT_PANEL_ON_SAVE_SURFACES.leftSidebar,
      fullView: typeof storedCloseSurfaces?.fullView === 'boolean'
        ? storedCloseSurfaces.fullView
        : DEFAULT_CLOSE_LEFT_PANEL_ON_SAVE_SURFACES.fullView,
    }

    return {
      syncCalendars: Array.from(syncCalendarMap.values()),
      slotMinutes: isTimeWidth(parsed.slotMinutes) ? parsed.slotMinutes : DEFAULT_SLOT_MINUTES,
      dayZoomLevel: isDayZoomLevel(parsed.dayZoomLevel) ? parsed.dayZoomLevel : DEFAULT_DAY_ZOOM_LEVEL,
      showTimeZoomQuickButtons: parsed.showTimeZoomQuickButtons !== false,
      showDayZoomQuickButtons: parsed.showDayZoomQuickButtons !== false,
      timeBackgrounds,
      collapsedBackgroundIds,
      quickTemplates,
      showQuickTemplatesInMain: resolveShowQuickTemplatesInMain(parsed.showQuickTemplatesInMain),
      quickTemplatesMainExpanded: parsed.quickTemplatesMainExpanded !== false,
      isLeftPanelOpen: parsed.isLeftPanelOpen !== false,
      leftPanelWidthPx,
      expandedSections,
      showActiveSourcesWhenCollapsed: (parsed as { showActiveSourcesWhenCollapsed?: unknown }).showActiveSourcesWhenCollapsed === true,
      closeLeftPanelOnSaveEnabled: parsed.closeLeftPanelOnSaveEnabled !== false,
      closeLeftPanelOnSaveSurfaces,
      openLeftPanelOnSelectionMode: isOpenLeftPanelOnSelectionMode(parsed.openLeftPanelOnSelectionMode)
        ? parsed.openLeftPanelOnSelectionMode
        : DEFAULT_OPEN_LEFT_PANEL_ON_SELECTION_MODE,
      openLeftPanelMinSelectionMinutes: normaliseOpenLeftPanelMinSelectionMinutes(parsed.openLeftPanelMinSelectionMinutes),
      openLeftPanelOnItemSelectionMode: isOpenLeftPanelOnItemSelectionMode(parsed.openLeftPanelOnItemSelectionMode)
        ? parsed.openLeftPanelOnItemSelectionMode
        : DEFAULT_OPEN_LEFT_PANEL_ON_SELECTION_MODE,
      openLeftPanelMinItemSelectionMinutes: normaliseOpenLeftPanelMinSelectionMinutes(parsed.openLeftPanelMinItemSelectionMinutes),
    }
  } catch {
    return null
  }
}

function toUtcDateParts(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function getWeekDayIndex(eventStart: Date, currentWeekStart: Date): number {
  const weekStartUtc = Date.UTC(currentWeekStart.getFullYear(), currentWeekStart.getMonth(), currentWeekStart.getDate())
  return Math.floor((toUtcDateParts(eventStart) - weekStartUtc) / DAY_MS)
}

function mapEventToTimeItems(
  event: UserEventRecord,
  currentWeekStart: Date,
  slotMinutes: number,
  activeModeId: string | null,
  rangeDays = 7
): TimeItem[] {
  const start = new Date(event.start_time)
  const end = new Date(event.end_time)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return []
  }

  const actualDurationMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000))
  const durationMinutes = Math.max(slotMinutes, actualDurationMinutes)
  const recurrenceRule = normaliseRecurrenceRule(event.recurrence_rule)

  const isActiveManualModeEvent =
    event.source_type === 'manual' &&
    typeof event.source_id === 'string' &&
    Boolean(activeModeId) &&
    (event.source_id === activeModeId || event.source_id === MAIN_SOURCE_ID)

  const baseItemTemplate: Omit<TimeItem, 'id' | 'interactionId' | 'occurrenceStartTime' | 'dayIndex' | 'startMinute' | 'durationMinutes' | 'totalDurationMinutes' | 'isRecurringOccurrence' | 'isStartSegment' | 'isEndSegment'> = {
    sourceEventId: event.id,
    actualDurationMinutes,
    title: event.title || 'Untitled meeting',
    notes: buildEventDraftNotes(event),
    categoryIds: Array.isArray(event.category_ids) ? event.category_ids : [],
    sourceId: isActiveManualModeEvent ? MAIN_SOURCE_ID : (event.source_id || MAIN_SOURCE_ID),
    sourceType: event.source_type,
    recurrenceRule,
    recurrenceStatus: event.recurrence?.status,
  }

  const buildOccurrenceSegments = (
    occurrenceStartIso: string,
    occurrenceId: string,
    isRecurringOccurrence: boolean
  ): TimeItem[] => {
    const occurrenceStart = new Date(occurrenceStartIso)
    if (Number.isNaN(occurrenceStart.getTime())) return []

    const occurrenceEndMs = occurrenceStart.getTime() + durationMinutes * 60_000
    let segmentStartMs = occurrenceStart.getTime()
    let continuationIndex = 0
    const segments: TimeItem[] = []

    while (segmentStartMs < occurrenceEndMs) {
      const segmentStartDate = new Date(segmentStartMs)
      const segmentDayStartMs = Date.UTC(
        segmentStartDate.getUTCFullYear(),
        segmentStartDate.getUTCMonth(),
        segmentStartDate.getUTCDate(),
        0,
        0,
        0
      )
      const segmentDayEndMs = segmentDayStartMs + DAY_MS
      const segmentEndMs = Math.min(segmentDayEndMs, occurrenceEndMs)
      const segmentDuration = Math.max(slotMinutes, Math.round((segmentEndMs - segmentStartMs) / 60_000))
      const segmentStartMinute = Math.max(0, Math.round((segmentStartMs - segmentDayStartMs) / 60_000))
      const segmentDayIndex = getWeekDayIndex(new Date(segmentDayStartMs), currentWeekStart)

      if (segmentDayIndex >= 0 && segmentDayIndex < rangeDays) {
        segments.push({
          ...baseItemTemplate,
          id: continuationIndex === 0 ? occurrenceId : `${occurrenceId}__seg-${continuationIndex}`,
          interactionId: occurrenceId,
          occurrenceStartTime: occurrenceStartIso,
          dayIndex: segmentDayIndex,
          startMinute: clampMinute(segmentStartMinute, slotMinutes),
          durationMinutes: segmentDuration,
          totalDurationMinutes: durationMinutes,
          isRecurringOccurrence,
          isStartSegment: continuationIndex === 0,
          isEndSegment: segmentEndMs >= occurrenceEndMs,
        })
      }

      segmentStartMs = segmentEndMs
      continuationIndex += 1
    }

    return segments
  }

  if (recurrenceRule.type === 'none' || recurrenceRule.endType === 'whenCompleted') {
    return buildOccurrenceSegments(event.start_time, event.id, false)
  }

  const occurrenceStarts = getRecurringOccurrenceStartsInWeek(event, currentWeekStart, rangeDays)
  if (occurrenceStarts.length === 0) {
    return []
  }

  return occurrenceStarts.flatMap((occurrenceStart) =>
    buildOccurrenceSegments(
      occurrenceStart,
      occurrenceStart === event.start_time ? event.id : `${event.id}_${occurrenceStart}`,
      occurrenceStart !== event.start_time
    )
  )
}

function buildEventTimestamp(day: Date, minute: number): string {
  const safeMinute = Number.isFinite(minute) ? minute : 0
  const startMs = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0) + safeMinute * 60_000
  return new Date(startMs).toISOString()
}

function getTimeItemInteractionId(item: Pick<TimeItem, 'interactionId' | 'id'>): string {
  return item.interactionId || item.id
}

function getTimeItemTotalDurationMinutes(
  item: Pick<TimeItem, 'durationMinutes'> & { totalDurationMinutes?: number },
  slotMinutes: number
): number {
  const rawDuration = Number.isFinite(item.totalDurationMinutes) ? item.totalDurationMinutes : item.durationMinutes
  const normalizedDuration = Number(rawDuration)
  if (!Number.isFinite(normalizedDuration)) return slotMinutes
  return Math.max(slotMinutes, Math.round(normalizedDuration))
}

function normaliseCreatedManualEvent(
  created: UserEventRecord,
  options: {
    fallbackSourceId: string
    fallbackCategoryIds: string[]
    fallbackRecurrenceRule?: RecurrenceRule | null
  }
): UserEventRecord {
  return {
    ...created,
    source_type: created.source_type || 'manual',
    source_id: created.source_id || options.fallbackSourceId,
    category_ids: Array.isArray(created.category_ids) ? created.category_ids : options.fallbackCategoryIds,
    recurrence_rule: normaliseRecurrenceRule(created.recurrence_rule ?? options.fallbackRecurrenceRule),
  }
}

function isPendingEventId(eventId: string): boolean {
  return eventId.startsWith('pending-')
}

function loadPersistedUnsyncedOps(): Record<string, UnsyncedTimeItemOp> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(UNSYNCED_QUEUE_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, UnsyncedTimeItemOp>) : {}
  } catch {
    return {}
  }
}

function persistUnsyncedOps(ops: Record<string, UnsyncedTimeItemOp>): void {
  if (typeof window === 'undefined') return
  try {
    if (Object.keys(ops).length === 0) {
      window.localStorage.removeItem(UNSYNCED_QUEUE_STORAGE_KEY)
    } else {
      window.localStorage.setItem(UNSYNCED_QUEUE_STORAGE_KEY, JSON.stringify(ops))
    }
  } catch {
    // Ignore storage quota and private-browsing errors.
  }
}

// Swaps an optimistic pending row for its server-created row. Any other row that
// already carries the created id (e.g. echoed by a refetch before the POST
// response arrived) is dropped so the list never holds two copies of one item.
function replacePendingEvent(
  events: UserEventRecord[],
  pendingId: string,
  resolved: UserEventRecord
): UserEventRecord[] {
  if (!events.some((event) => event.id === pendingId)) return events
  const next: UserEventRecord[] = []
  for (const event of events) {
    if (event.id === pendingId) {
      next.push(resolved)
      continue
    }
    if (event.id === resolved.id) continue
    next.push(event)
  }
  return next
}

type PendingRowTextEdits = Partial<Pick<UserEventRecord, 'title' | 'description' | 'location'>>

// Text fields the user edited on the optimistic row while its create POST was in
// flight. These must be carried over to the created row and persisted.
function collectPendingRowTextEdits(
  sent: Pick<UserEventRecord, 'title' | 'description' | 'location'>,
  pendingRow: UserEventRecord | undefined
): PendingRowTextEdits {
  if (!pendingRow) return {}
  const edits: PendingRowTextEdits = {}
  if (pendingRow.title !== sent.title) edits.title = pendingRow.title
  if ((pendingRow.description ?? null) !== (sent.description ?? null)) edits.description = pendingRow.description ?? null
  if ((pendingRow.location ?? null) !== (sent.location ?? null)) edits.location = pendingRow.location ?? null
  return edits
}

function isSafeNoteUrl(value: string): boolean {
  return isSafeUrl(value)
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const tokens = text.match(/(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|https?:\/\/\S+)/g)
  if (!tokens) return [text]

  const nodes: ReactNode[] = []
  let cursor = 0

  for (const token of tokens) {
    const index = text.indexOf(token, cursor)
    if (index > cursor) {
      nodes.push(text.slice(cursor, index))
    }

    if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code key={`${index}-${token}`} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground">
          {token.slice(1, -1)}
        </code>
      )
    } else if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(<strong key={`${index}-${token}`}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('*') && token.endsWith('*')) {
      nodes.push(<em key={`${index}-${token}`}>{token.slice(1, -1)}</em>)
    } else if (token.startsWith('[') && token.includes('](') && token.endsWith(')')) {
      const labelEnd = token.indexOf('](')
      const label = token.slice(1, labelEnd)
      const url = token.slice(labelEnd + 2, -1)
      if (isSafeNoteUrl(url)) {
        nodes.push(
          <a
            key={`${index}-${token}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-primary underline underline-offset-2 hover:opacity-80"
          >
            {label}
          </a>
        )
      } else {
        nodes.push(token)
      }
    } else if (isSafeNoteUrl(token)) {
      nodes.push(
        <a
          key={`${index}-${token}`}
          href={token}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-primary underline underline-offset-2 hover:opacity-80 break-all"
        >
          {token}
        </a>
      )
    } else {
      nodes.push(token)
    }

    cursor = index + token.length
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor))
  }

  return nodes
}

function _toggleTaskLine(text: string, lineIndex: number): string {
  const lines = text.split(/\r?\n/)
  if (lineIndex < 0 || lineIndex >= lines.length) return text

  const line = lines[lineIndex]
  const taskMatch = line.match(/^([\t ]*[-*]\s+)\[( |x|X)\](\s+.*)$/)
  if (!taskMatch) return text

  const nextState = taskMatch[2].toLowerCase() === 'x' ? ' ' : 'x'
  lines[lineIndex] = `${taskMatch[1]}[${nextState}]${taskMatch[3]}`
  return lines.join('\n')
}

function renderMarkdownRange(
  lines: string[],
  lineIndices: number[],
  onToggleTask?: (lineIndex: number) => void
): ReactNode[] {
  const nodes: ReactNode[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()
    const lineIndex = lineIndices[index]

    if (!trimmed) {
      nodes.push(<div key={`blank-${lineIndex}`} className="h-3" />)
      index += 1
      continue
    }

    const isDetailsStart = trimmed.startsWith('<details') || /^:::details(?:\s|$)/.test(trimmed)
    if (isDetailsStart) {
      const innerLines: string[] = []
      const innerIndices: number[] = []
      let summary = ''
      let mode: 'summary' | 'content' | 'body' = 'body'
      let depth = 1
      let cursor = index + 1

      while (cursor < lines.length) {
        const cursorLine = lines[cursor]
        const cursorTrimmed = cursorLine.trim()

        if (cursorTrimmed.startsWith('<details') || /^:::details(?:\s|$)/.test(cursorTrimmed)) {
          depth += 1
          innerLines.push(cursorLine)
          innerIndices.push(lineIndices[cursor])
          cursor += 1
          continue
        }

        if (cursorTrimmed === '</details>') {
          depth -= 1
          if (depth === 0) {
            break
          }
          innerLines.push(cursorLine)
          innerIndices.push(lineIndices[cursor])
          cursor += 1
          continue
        }

        if (cursorTrimmed === ':::') {
          if (depth === 1 && (mode === 'summary' || mode === 'content')) {
            mode = 'body'
            cursor += 1
            continue
          }
          depth -= 1
          if (depth === 0) {
            break
          }
          innerLines.push(cursorLine)
          innerIndices.push(lineIndices[cursor])
          cursor += 1
          continue
        }

        if (depth === 1 && (cursorTrimmed.startsWith('<summary>') || /^:::detailsSummary(?:\s|$)/.test(cursorTrimmed))) {
          mode = 'summary'
          const summaryText = cursorTrimmed
            .replace(/^<summary>/, '')
            .replace(/<\/summary>$/, '')
            .replace(/^:::detailsSummary\s*/, '')
            .replace(/\s*:::\s*$/, '')
            .trim()
          if (summaryText) {
            summary = summaryText
          }
          if (cursorTrimmed.includes('</summary>') || (cursorTrimmed.startsWith(':::detailsSummary') && cursorTrimmed.endsWith(':::') && cursorTrimmed !== ':::detailsSummary')) {
            mode = 'body'
          }
          cursor += 1
          continue
        }

        if (depth === 1 && cursorTrimmed.includes('</summary>')) {
          const beforeClose = cursorTrimmed.replace(/<\/summary>.*$/, '').trim()
          if (beforeClose) {
            summary = summary ? `${summary} ${beforeClose}` : beforeClose
          }
          mode = 'body'
          cursor += 1
          continue
        }

        if (depth === 1 && /^:::detailsContent(?:\s|$)/.test(cursorTrimmed)) {
          mode = 'content'
          cursor += 1
          continue
        }

        if (depth === 1 && mode === 'summary') {
          if (cursorTrimmed) {
            summary = summary ? `${summary} ${cursorTrimmed}` : cursorTrimmed
          }
          cursor += 1
          continue
        }

        innerLines.push(cursorLine)
        innerIndices.push(lineIndices[cursor])
        cursor += 1
      }

      const finalSummary = summary || 'Details'
      const hasVisibleBody = innerLines.some((line) => line.trim().length > 0)
      nodes.push(
        <details key={`details-${lineIndex}`} className="rounded-lg border border-border bg-muted/20 px-3 py-2">
          <summary className="cursor-pointer list-none font-semibold text-foreground marker:hidden">
            {renderInlineMarkdown(finalSummary)}
          </summary>
          <div className="mt-3 space-y-1.5 text-sm text-foreground">
            {hasVisibleBody ? (
              renderMarkdownRange(innerLines, innerIndices, onToggleTask)
            ) : (
              <div className="min-h-6 rounded-md border border-dashed border-border bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                Hidden content
              </div>
            )}
          </div>
        </details>
      )
      index = cursor + 1
      continue
    }

    const taskMatch = line.match(/^([\t ]*[-*]\s+)\[( |x|X)\](\s+.*)$/)
    if (taskMatch) {
      const checked = taskMatch[2].toLowerCase() === 'x'
      nodes.push(
        <label key={`task-${lineIndex}`} className="flex items-start gap-2 rounded-md px-2 py-1 text-sm text-foreground hover:bg-muted/40">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => onToggleTask?.(lineIndex)}
            disabled={!onToggleTask}
            className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-ring disabled:cursor-default"
          />
          <span>{renderInlineMarkdown(taskMatch[3].trim())}</span>
        </label>
      )
      index += 1
      continue
    }

    if (/^#{1,3}\s+/.test(trimmed)) {
      const level = trimmed.match(/^#{1,3}/)?.[0].length || 1
      const headingText = trimmed.replace(/^#{1,3}\s+/, '')
      const HeadingTag = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3'
      nodes.push(
        <HeadingTag
          key={`heading-${lineIndex}`}
          className={level === 1 ? 'text-2xl font-bold text-foreground' : level === 2 ? 'text-xl font-bold text-foreground' : 'text-lg font-semibold text-foreground'}
        >
          {renderInlineMarkdown(headingText)}
        </HeadingTag>
      )
      index += 1
      continue
    }

    if (/^>\s+/.test(trimmed)) {
      nodes.push(
        <blockquote key={`quote-${lineIndex}`} className="border-l-4 border-border pl-3 text-sm italic text-muted-foreground">
          {renderInlineMarkdown(trimmed.replace(/^>\s+/, ''))}
        </blockquote>
      )
      index += 1
      continue
    }

    if (/^([-*])\s+/.test(trimmed)) {
      const items: Array<{ text: string; index: number }> = []
      while (index < lines.length && /^([-*])\s+/.test(lines[index].trim())) {
        items.push({ text: lines[index].trim().replace(/^([-*])\s+/, ''), index: lineIndices[index] })
        index += 1
      }

      nodes.push(
        <ul key={`list-${lineIndex}`} className="list-disc space-y-1 pl-5 text-sm text-foreground">
          {items.map((item) => (
            <li key={`li-${item.index}`}>{renderInlineMarkdown(item.text)}</li>
          ))}
        </ul>
      )
      continue
    }

    if (/^```/.test(trimmed)) {
      const codeLines: string[] = []
      let cursor = index + 1
      while (cursor < lines.length && !/^```/.test(lines[cursor].trim())) {
        codeLines.push(lines[cursor])
        cursor += 1
      }

      nodes.push(
        <pre key={`code-${lineIndex}`} className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-xs text-foreground">
          <code>{codeLines.join('\n')}</code>
        </pre>
      )
      index = cursor + 1
      continue
    }

    nodes.push(
      <p key={`paragraph-${lineIndex}`} className="text-sm leading-6 text-foreground whitespace-pre-wrap wrap-break-word">
        {renderInlineMarkdown(line)}
      </p>
    )
    index += 1
  }

  return nodes
}

function NotePreview({ text, onToggleTask }: { text: string; onToggleTask?: (lineIndex: number) => void }) {
  const lines = text.split(/\r?\n/)
  const lineIndices = lines.map((_, lineIndex) => lineIndex)
  return <div className="space-y-2">{renderMarkdownRange(lines, lineIndices, onToggleTask)}</div>
}

const MOBILE_TOOLS_REVEAL_CLASSES = 'animate-in fade-in slide-in-from-top-3 zoom-in-95 duration-500 motion-reduce:animate-none'
// Newly enabled calendar-bar quick buttons pop in and keep the shared primary wash for 2s.
const QUICK_BUTTONS_REVEAL_CLASSES = 'animate-in fade-in zoom-in-75 duration-500 motion-reduce:animate-none tools-reveal-highlight'

interface NoteEditorModalProps {
  open: boolean
  isPhoneLayout?: boolean
  title: string
  subtitle?: ReactNode
  titleValue?: string
  onTitleChange?: (value: string) => void
  titlePlaceholder?: string
  value: string
  onChange: (value: string) => void
  onClose: () => void
  onSave?: () => boolean | Promise<boolean>
  showSaveButton?: boolean
  saveDisabled?: boolean
  saveState?: 'idle' | 'dirty' | 'autosaving' | 'saved' | 'error'
  saveMetaLabel?: string | null
  saveLabel?: string
  closeLabel?: string
  readOnly?: boolean
  beforeTitleContent?: ReactNode
  locationField?: ReactNode
  toolbarExtra?: ReactNode
  children?: ReactNode
  autoFocusTitle?: boolean
  onAutoFocusComplete?: () => void
}

function NoteEditorModal({
  open,
  isPhoneLayout = false,
  title,
  subtitle,
  titleValue,
  onTitleChange,
  titlePlaceholder = 'Type Title for Time Item',
  value,
  onChange,
  onClose,
  onSave,
  showSaveButton,
  saveDisabled = false,
  saveState = 'dirty',
  saveMetaLabel = null,
  saveLabel = 'Save notes',
  closeLabel = 'Close',
  readOnly = false,
  beforeTitleContent,
  locationField,
  toolbarExtra,
  children,
  autoFocusTitle = false,
  onAutoFocusComplete,
}: NoteEditorModalProps) {
  const modalShellRef = useRef<HTMLDivElement | null>(null)
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const isBackdropPressActiveRef = useRef(false)
  const [layer, setLayer] = useState<{ id: number; z: number } | null>(null)
  const [areMobileToolsRevealed, setAreMobileToolsRevealed] = useState(false)
  const [areMobileToolsHighlighted, setAreMobileToolsHighlighted] = useState(false)

  useEffect(() => {
    if (!open) {
      setAreMobileToolsRevealed(false)
      setAreMobileToolsHighlighted(false)
    }
  }, [open])

  useEffect(() => {
    if (!open || !areMobileToolsHighlighted) return
    const timer = window.setTimeout(() => setAreMobileToolsHighlighted(false), 2000)
    return () => window.clearTimeout(timer)
  }, [open, areMobileToolsHighlighted])

  useEffect(() => {
    if (!open) return
    const claim = pushOverlay('focusModal')
    setLayer({ id: claim.id, z: claim.z })
    return () => {
      claim.release()
      setLayer(null)
    }
  }, [open])

  useEffect(() => {
    if (!open || !layer) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isTopOverlay(layer.id)) {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }

    // Capture-phase listener ensures Esc closes the modal even if another
    // global listener prevents default during bubble phase.
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [layer, onClose, open])

  useEffect(() => {
    if (!open) return
    window.setTimeout(() => {
      const activeEditor = document.querySelector<HTMLDivElement>('.tiptap[contenteditable="true"]')
      if (activeEditor) {
        activeEditor.focus()
        return
      }
      modalShellRef.current?.focus()
    }, 0)
  }, [open])

  useEffect(() => {
    if (!open || !autoFocusTitle || !titleInputRef.current) return
    window.setTimeout(() => {
      if (titleInputRef.current) {
        titleInputRef.current.focus()
        const end = titleInputRef.current.value.length
        titleInputRef.current.setSelectionRange(end, end)
        onAutoFocusComplete?.()
      }
    }, 50)
  }, [open, autoFocusTitle, onAutoFocusComplete])

  const focusDescriptionAtEnd = useCallback(() => {
    const activeEditor = modalShellRef.current?.querySelector<HTMLDivElement>('.tiptap[contenteditable="true"]')
    if (!activeEditor) return

    activeEditor.focus()
    const selection = window.getSelection()
    if (!selection) return

    const range = document.createRange()
    range.selectNodeContents(activeEditor)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  }, [])

  const handleSaveClick = useCallback(async () => {
    if (!onSave) return
    const didSave = await onSave()
    if (didSave === false) return
    if (saveLabel === 'Save now') {
      onClose()
    }
  }, [onClose, onSave, saveLabel])

  const shouldRenderSaveButton = !readOnly && (showSaveButton ?? Boolean(onSave))
  const isSavedState = saveState === 'saved'

  const handleBackdropMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    isBackdropPressActiveRef.current = event.target === event.currentTarget
  }, [])

  const handleBackdropMouseUp = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const shouldClose = isBackdropPressActiveRef.current && event.target === event.currentTarget
    isBackdropPressActiveRef.current = false
    if (shouldClose) {
      onClose()
    }
  }, [onClose])

  if (!open || !layer) return null

  const modalContent = (
    <div
      data-testid="full-editor-overlay"
      style={{ zIndex: layer.z }}
      className="fixed inset-0 flex items-start justify-center overflow-y-auto bg-black/55 p-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-[calc(env(safe-area-inset-bottom)+0.5rem)] backdrop-blur-xs sm:items-center sm:p-3"
      onMouseDown={handleBackdropMouseDown}
      onMouseUp={handleBackdropMouseUp}
    >
      <div
        ref={modalShellRef}
        tabIndex={-1}
        className={`flex ${isPhoneLayout ? 'h-full' : 'h-auto'} max-h-full w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={`${isPhoneLayout ? 'grid grid-cols-[minmax(0,1fr)_auto]' : 'flex flex-wrap justify-between'} shrink-0 items-start gap-3 border-b border-border px-4 py-3`}>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Maximize2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <h2 className={`text-base font-semibold text-foreground ${isPhoneLayout ? 'min-w-0 break-words' : ''}`}>{title}</h2>
            </div>
            {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <div className={isPhoneLayout ? 'contents' : 'flex items-center gap-2 self-start sm:self-auto'}>
            <div
              className={`${isPhoneLayout ? `order-3 col-span-2 w-full ${shouldRenderSaveButton ? '' : 'hidden'}` : 'w-43 sm:w-63'} shrink-0 overflow-hidden transition-[opacity,transform] [transition-duration:900ms] ease-out ${
                shouldRenderSaveButton ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-6 opacity-0'
              }`}
            >
              <Button
                intent={isSavedState ? 'success' : saveState === 'error' ? 'danger' : 'primary'}
                fullWidth
                onClick={() => { void handleSaveClick() }}
                disabled={saveDisabled || !onSave || isSavedState}
                data-testid="full-editor-save-button"
                icon={saveState === 'autosaving' ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                ) : isSavedState ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                ) : saveState === 'error' ? (
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                ) : saveState === 'dirty' ? (
                  <Clock3 className="h-4 w-4 shrink-0" />
                ) : (
                  <Save className="h-4 w-4 shrink-0" />
                )}
              >
                <span className="min-w-0 flex-1 overflow-hidden text-left leading-tight">
                  <span className="block truncate">{saveState === 'autosaving' ? 'Saving...' : isSavedState ? 'Saved' : saveState === 'error' ? 'Retry save' : saveLabel}</span>
                  {saveMetaLabel && <span className="block truncate text-[10px] opacity-80">{saveMetaLabel}</span>}
                </span>
              </Button>
            </div>
            <Button
              emphasis="outline"
              onClick={onClose}
              className={`${isPhoneLayout ? 'order-2 min-h-11' : ''} min-w-19 sm:min-w-21`}
            >
              {closeLabel}
            </Button>
          </div>
        </div>

        <div
          data-testid="full-editor-body"
          className={`flex min-h-0 flex-1 flex-col px-4 py-4 ${isPhoneLayout ? 'overflow-y-auto overscroll-contain' : ''}`}
        >
          {(!isPhoneLayout || areMobileToolsRevealed) && beforeTitleContent && (
            <div className={`shrink-0 ${isPhoneLayout ? MOBILE_TOOLS_REVEAL_CLASSES : ''} ${isPhoneLayout && areMobileToolsHighlighted ? 'tools-reveal-highlight' : ''}`}>
              {beforeTitleContent}
            </div>
          )}

          {!readOnly && onTitleChange && (
            <div className="mb-3 shrink-0">
              <label className="mb-1 block text-xs font-semibold text-muted-foreground">Item title</label>
              <input
                   ref={titleInputRef}
                   type="text"
                   value={titleValue ?? ''}
                   onChange={(event) => onTitleChange?.(event.target.value)}
                   onKeyDown={(event) => {
                     if (event.key === 'Enter') {
                       event.preventDefault()
                       void (async () => {
                       if (onSave) {
                         const didSave = await onSave()
                         if (didSave === false) return
                       }
                       focusDescriptionAtEnd()
                       })()
                     } else if (event.key === 'Escape') {
                       event.preventDefault()
                       onClose()
                     }
                   }}
                   placeholder={titlePlaceholder}
                   className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-sm text-foreground"
                 />
               </div>
          )}
          {locationField}
          {isPhoneLayout ? <div className="shrink-0">{children}</div> : children}
          <MarkdownComposer
            value={value}
            onChange={onChange}
            readOnly={readOnly}
            placeholder="Write notes, paste documents, and organize them with markdown."
            className={isPhoneLayout ? 'shrink-0' : 'min-h-0 flex-1'}
            compact={isPhoneLayout}
            showToolbar={!readOnly}
            toolbarExtra={toolbarExtra}
            hideFormattingTools={isPhoneLayout && !areMobileToolsRevealed}
            onRevealTools={() => {
              setAreMobileToolsRevealed(true)
              setAreMobileToolsHighlighted(true)
            }}
            animateRevealedTools={isPhoneLayout && areMobileToolsRevealed}
            highlightRevealedTools={isPhoneLayout && areMobileToolsHighlighted}
          />
        </div>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}

interface RecurrenceEndOptionsProps {
  rule: RecurrenceRule
  updateRule: (patch: Partial<RecurrenceRule>) => void
  readOnly?: boolean
  conditionalSeries?: boolean
}

function RecurrenceEndOptions({ rule, updateRule, readOnly = false, conditionalSeries = false }: RecurrenceEndOptionsProps) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Ends</label>
      <div className="grid grid-cols-2 gap-1.5">
        {(['never', 'on', 'after', 'whenCompleted'] as RecurrenceEndType[]).map((endType) => (
          <ToggleButton
            key={endType}
            size="compact"
            disabled={readOnly || (conditionalSeries && endType !== 'whenCompleted')}
            pressed={(rule.endType || 'never') === endType}
            onPressedChange={() => updateRule({ endType })}
          >
            {endType === 'never' ? 'Never' : endType === 'on' ? 'On date' : endType === 'after' ? 'After #' : 'When marked as completed'}
          </ToggleButton>
        ))}
      </div>

      {(rule.endType || 'never') === 'on' && (
        <div className="mt-2">
          <input
            type="date"
            aria-label="Recurrence end date"
            value={rule.endDate || ''}
            disabled={readOnly}
            onChange={(event) => updateRule({ endDate: event.target.value })}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
          />
        </div>
      )}

      {(rule.endType || 'never') === 'after' && (
        <div className="mt-2 flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">After</span>
          <input
            type="number"
            aria-label="Recurrence occurrence count"
            min={1}
            max={500}
            value={rule.endCount || 1}
            disabled={readOnly}
            onChange={(event) => updateRule({ endCount: Math.max(1, Number.parseInt(event.target.value, 10) || 1) })}
            className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
          />
          <span className="text-[11px] text-muted-foreground">occurrences</span>
        </div>
      )}
    </div>
  )
}

interface RecurrenceEditorProps {
  value: RecurrenceRule
  onChange: (nextRule: RecurrenceRule) => void
  expanded: boolean
  onExpandedChange: (nextExpanded: boolean) => void
  dateSeed: string
  readOnly?: boolean
  compact?: boolean
  conditionalSeries?: boolean
  headerAction?: ReactNode
}

function RecurrenceEditor({ value, onChange, expanded, onExpandedChange, dateSeed, readOnly = false, compact = false, conditionalSeries = false, headerAction }: RecurrenceEditorProps) {
  const updateRule = (patch: Partial<RecurrenceRule>) => onChange({ ...value, ...patch })
  const seedDate = new Date(dateSeed)
  const recurrencePanelId = `${useId()}-recurrence-panel`

  return (
    <div className={`overflow-hidden rounded-lg border border-border ${compact ? 'bg-background' : 'bg-card'}`}>
      <div className="flex items-center bg-muted/50">
        {headerAction && <div className="max-w-[60%] shrink-0 py-1 pl-2">{headerAction}</div>}
        <Disclosure
          size="compact"
          className="min-w-0 flex-1"
          title="Recurrence"
          icon={headerAction ? undefined : <Repeat2 />}
          trailing={value.type !== 'none' ? (
            <span className="truncate rounded-full bg-primary-subtle px-1.5 py-0.5 text-[10px] font-semibold text-primary">
              {formatRecurrenceSummary(value)}
            </span>
          ) : undefined}
          expanded={expanded}
          onToggle={(next) => onExpandedChange(next)}
          panelId={recurrencePanelId}
        />
      </div>

      {expanded && (
        <div id={recurrencePanelId} className="space-y-3 p-3">
          <div className="grid grid-cols-3 gap-1">
            {(['none', 'weekly', 'biweekly', 'monthly', 'monthlyWeek', 'custom'] as RecurrenceType[]).map((type) => (
              <ToggleButton
                key={type}
                size="compact"
                disabled={readOnly || (conditionalSeries && type === 'none')}
                pressed={value.type === type}
                onPressedChange={() => {
                  const nextRule: RecurrenceRule = {
                    ...value,
                    type,
                    ...(type === 'custom'
                      ? {
                          interval: value.interval || 1,
                          unit: value.unit || 'week',
                          weekDays: value.weekDays || [getRecurrenceWeekdayIndex(seedDate)],
                          endType: value.endType || 'never',
                        }
                      : {}),
                    ...(type === 'monthlyWeek'
                      ? {
                          monthWeeks: value.monthWeeks && value.monthWeeks.length > 0 ? value.monthWeeks : [getWeekOfMonth(seedDate)],
                          endType: value.endType || 'never',
                        }
                      : {}),
                  }
                  onChange(nextRule)
                }}
              >
                {type === 'none' ? 'None' : type === 'weekly' ? 'Weekly' : type === 'biweekly' ? 'Bi-wkly' : type === 'monthly' ? 'Monthly' : type === 'monthlyWeek' ? 'Month wk' : 'Custom'}
              </ToggleButton>
            ))}
          </div>

          {value.type === 'monthlyWeek' && (() => {
            const weekLabels = ['1st', '2nd', '3rd', '4th']
            const selectedWeekday = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][getRecurrenceWeekdayIndex(seedDate)]
            return (
              <div className="space-y-2 border-t border-border pt-2">
                <p className="text-[11px] text-muted-foreground">
                  Repeats on the selected occurrence(s) of {selectedWeekday} in the month (e.g. "2nd" = the 2nd {selectedWeekday} of that month).
                </p>
                <div className="grid grid-cols-4 gap-1">
                  {weekLabels.map((label, index) => {
                    const weekNumber = index + 1
                    const selected = (value.monthWeeks || []).includes(weekNumber)
                    return (
                      <ToggleButton
                        key={weekNumber}
                        size="compact"
                        disabled={readOnly}
                        title={`${label} ${selectedWeekday} of the month`}
                        pressed={selected}
                        onPressedChange={() => {
                          const current = value.monthWeeks || []
                          const next = selected ? current.filter((entry) => entry !== weekNumber) : [...current, weekNumber].sort((a, b) => a - b)
                          updateRule({ monthWeeks: next.length > 0 ? next : [weekNumber] })
                        }}
                      >
                        {label}
                      </ToggleButton>
                    )
                  })}
                </div>
              </div>
            )
          })()}


          {value.type === 'custom' && (
            <div className="space-y-2 border-t border-border pt-2">
              <div className="flex items-center gap-1.5">
                <span className="whitespace-nowrap text-[11px] text-muted-foreground">Every</span>
                <input
                  type="number"
                  aria-label="Recurrence interval"
                  min={1}
                  max={99}
                  value={value.interval || 1}
                  disabled={readOnly}
                  onChange={(event) => updateRule({ interval: Math.max(1, Number.parseInt(event.target.value, 10) || 1) })}
                  className="w-12 rounded-md border border-border bg-background px-1 py-0.5 text-center text-[11px] text-foreground"
                />
                <select
                  aria-label="Recurrence unit"
                  value={value.unit || 'week'}
                  disabled={readOnly}
                  onChange={(event) => updateRule({ unit: event.target.value as RecurrenceUnit })}
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-1 py-0.5 text-[11px] text-foreground"
                >
                  <option value="day">day</option>
                  <option value="week">week</option>
                  <option value="month">month</option>
                </select>
              </div>

              {value.unit === 'week' && (
                <div>
                  <p className="mb-1 text-[11px] text-muted-foreground">On</p>
                  <div className="flex gap-0.5">
                    {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, index) => {
                      const selected = (value.weekDays || []).includes(index)
                      return (
                        <ToggleButton
                          key={`${label}-${index}`}
                          size="compact"
                          disabled={readOnly}
                          title={['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][index]}
                          pressed={selected}
                          onPressedChange={() => {
                            const current = value.weekDays || []
                            const next = selected ? current.filter((entry) => entry !== index) : [...current, index].sort((a, b) => a - b)
                            updateRule({ weekDays: next.length > 0 ? next : [index] })
                          }}
                        >
                          {label}
                        </ToggleButton>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          <RecurrenceEndOptions rule={value} updateRule={updateRule} readOnly={readOnly} conditionalSeries={conditionalSeries} />
        </div>
      )}
    </div>
  )
}

export default function TimeManagementPage() {
  const { user } = useAuth()
  return <TimeManagementWorkspace key={user?.id ?? 'anonymous'} />
}

function TimeManagementWorkspace() {
  const { user, isLoading: isAuthLoading, isAuthenticated, isTraveler } = useAuth()
  const { setPageContext } = useAiAssistant()
  const tzState = useTimezones()
  const persistedPreferences = useMemo(() => loadPersistedPreferences(), [])
  const [nowTick, setNowTick] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNowTick(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])
  const [currentWeekStart, setCurrentWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [highlightedDay, setHighlightedDay] = useState<Date | null>(null)
  const todayHighlightTimerRef = useRef<number | null>(null)
  useEffect(() => {
    return () => {
      if (todayHighlightTimerRef.current !== null) {
        window.clearTimeout(todayHighlightTimerRef.current)
      }
    }
  }, [])
  const [slotMinutes, setSlotMinutes] = useState<TimeWidth>(() => persistedPreferences?.slotMinutes ?? DEFAULT_SLOT_MINUTES)
  const [dayZoomLevel, setDayZoomLevel] = useState<DayZoomLevel>(() => persistedPreferences?.dayZoomLevel ?? DEFAULT_DAY_ZOOM_LEVEL)
  const [showTimeZoomQuickButtons, setShowTimeZoomQuickButtons] = useState(
    () => persistedPreferences?.showTimeZoomQuickButtons ?? true
  )
  const [showDayZoomQuickButtons, setShowDayZoomQuickButtons] = useState(
    () => persistedPreferences?.showDayZoomQuickButtons ?? true
  )
  const navigationWeekStep = getNavigationWeekStep(dayZoomLevel)
  const anchorWeekday = getMondayBasedWeekday(nowTick)
  const isDayNavigationView = dayZoomLevel < DEFAULT_DAY_ZOOM_LEVEL
  // Start (0 = Monday of currentWeekStart) of a sub-week window the user moved by day/week; null follows today.
  const [dayWindowStart, setDayWindowStart] = useState<number | null>(null)
  const visibleDayIndexes = useMemo(
    () => (isDayNavigationView && dayWindowStart !== null
      ? getDayWindowIndexes(dayZoomLevel, dayWindowStart)
      : getVisibleDayIndexes(dayZoomLevel, anchorWeekday)),
    [anchorWeekday, dayWindowStart, dayZoomLevel, isDayNavigationView]
  )
  const dayRangeLength = getDayRangeLengthForIndexes(dayZoomLevel, visibleDayIndexes)
  const visibleDayIndexSet = useMemo(() => new Set(visibleDayIndexes), [visibleDayIndexes])
  const changeDayZoomLevel = useCallback((level: DayZoomLevel) => {
    setDayZoomLevel(level)
    setDayWindowStart(null)
  }, [])
  const stepVisibleDayWindow = (direction: -1 | 1) => {
    const { start, weekOffset } = shiftDayWindow(visibleDayIndexes[0] ?? 0, direction)
    if (weekOffset !== 0) setCurrentWeekStart((prev) => addWeeks(prev, weekOffset))
    setDayWindowStart(start)
  }
  const stepVisibleDayWeek = (direction: -1 | 1) => {
    setDayWindowStart(visibleDayIndexes[0] ?? 0)
    setCurrentWeekStart((prev) => addWeeks(prev, direction))
  }
  const [revealedQuickButtons, setRevealedQuickButtons] = useState<{ time: boolean; day: boolean }>({ time: false, day: false })
  useEffect(() => {
    if (!revealedQuickButtons.time && !revealedQuickButtons.day) return
    const timer = window.setTimeout(() => setRevealedQuickButtons({ time: false, day: false }), 2000)
    return () => window.clearTimeout(timer)
  }, [revealedQuickButtons])
  const handleShowTimeZoomQuickButtonsChange = (checked: boolean) => {
    setShowTimeZoomQuickButtons(checked)
    setRevealedQuickButtons((prev) => ({ ...prev, time: checked }))
  }
  const handleShowDayZoomQuickButtonsChange = (checked: boolean) => {
    setShowDayZoomQuickButtons(checked)
    setRevealedQuickButtons((prev) => ({ ...prev, day: checked }))
  }
  // Weeks after the anchor week that the 14/28 day views also need loaded.
  const extraRangeWeekStartsRef = useRef<Date[]>([])
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(false)
  const leftPanelPreferredWidthPxRef = useRef(persistedPreferences?.leftPanelWidthPx ?? DEFAULT_LEFT_PANEL_WIDTH_PX)
  const [leftPanelWidthPx, setLeftPanelWidthPx] = useState(() => leftPanelPreferredWidthPxRef.current)
  const [isLeftPanelResizing, setIsLeftPanelResizing] = useState(false)
  const [viewportWidth, setViewportWidth] = useState(() => (
    typeof window === 'undefined' ? TABLET_BREAKPOINT_PX : window.innerWidth
  ))
  const [mobileSurface, setMobileSurface] = useState<MobileSurface>('calendar')
  const [expandedSections, setExpandedSections] = useState<Set<LeftPanelSectionId>>(
    () => new Set(persistedPreferences?.expandedSections ?? [])
  )
  const [showActiveSourcesWhenCollapsed, setShowActiveSourcesWhenCollapsed] = useState(
    () => persistedPreferences?.showActiveSourcesWhenCollapsed ?? false
  )
  const [closeLeftPanelOnSaveEnabled, setCloseLeftPanelOnSaveEnabled] = useState(
    () => persistedPreferences?.closeLeftPanelOnSaveEnabled ?? true
  )
  const [closeLeftPanelOnSaveSurfaces, setCloseLeftPanelOnSaveSurfaces] = useState<CloseLeftPanelOnSaveSurfaces>(
    () => persistedPreferences?.closeLeftPanelOnSaveSurfaces ?? DEFAULT_CLOSE_LEFT_PANEL_ON_SAVE_SURFACES
  )
  const [openLeftPanelOnSelectionMode, setOpenLeftPanelOnSelectionMode] = useState<OpenLeftPanelOnSelectionMode>(
    () => persistedPreferences?.openLeftPanelOnSelectionMode ?? DEFAULT_OPEN_LEFT_PANEL_ON_SELECTION_MODE
  )
  const [openLeftPanelMinSelectionMinutes, setOpenLeftPanelMinSelectionMinutes] = useState<number>(
    () => persistedPreferences?.openLeftPanelMinSelectionMinutes ?? DEFAULT_OPEN_LEFT_PANEL_MIN_SELECTION_MINUTES
  )
  const [openLeftPanelOnItemSelectionMode, setOpenLeftPanelOnItemSelectionMode] = useState<OpenLeftPanelOnItemSelectionMode>(
    () => persistedPreferences?.openLeftPanelOnItemSelectionMode ?? DEFAULT_OPEN_LEFT_PANEL_ON_SELECTION_MODE
  )
  const [openLeftPanelMinItemSelectionMinutes, setOpenLeftPanelMinItemSelectionMinutes] = useState<number>(
    () => persistedPreferences?.openLeftPanelMinItemSelectionMinutes ?? DEFAULT_OPEN_LEFT_PANEL_MIN_SELECTION_MINUTES
  )
  const [selectionDraft, setSelectionDraft] = useState<SelectionDraft | null>(null)
  const [isNewItemDraft, setIsNewItemDraft] = useState(true)
  const [isSelectionAdjusterExpanded, setIsSelectionAdjusterExpanded] = useState(false)
  const [selectionAdjustStepSlots, setSelectionAdjustStepSlots] = useState(1)
  const [isItemAdjusterExpanded, setIsItemAdjusterExpanded] = useState(false)
  const [itemAdjustStepSlots, setItemAdjustStepSlots] = useState(1)
  const isNudgingItemRef = useRef(false)
  const [isNudgingItem, setIsNudgingItem] = useState(false)
  const [selectionLastChangedEdge, setSelectionLastChangedEdge] = useState<'start' | 'end' | null>(null)
  const [itemLastChangedEdge, setItemLastChangedEdge] = useState<'start' | 'end' | null>(null)
  const [hoveredInteractionItemId, setHoveredInteractionItemId] = useState<string | null>(null)
  const [isHiddenModeEnabled, setIsHiddenModeEnabled] = useState(false)
  const [isSelecting, setIsSelecting] = useState(false)
  // Synchronous mirror of isSelecting so the window-level pointerup handler can
  // tell a real grid drag from an unrelated tap (e.g. week navigation arrows).
  const isSelectingRef = useRef(false)
  const [touchSelectionFinished, setTouchSelectionFinished] = useState(false)
  const [isDraggingItem, setIsDraggingItem] = useState(false)
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null)
  const [dragDropPreview, setDragDropPreview] = useState<DragDropPreviewState | null>(null)
  const [resizeState, setResizeState] = useState<ResizeState | null>(null)
    const [recurringEditTitle, setRecurringEditTitle] = useState<string | null>(null)
    const recurringEditResolverRef = useRef<((scope: RecurringEditScope | null) => void) | null>(null)
    // "This item only" options: keep the replacement public, and whether to update the Google copy.
    const [recurringEditIsPublic, setRecurringEditIsPublic] = useState(false)
    const [recurringEditGoogleLinked, setRecurringEditGoogleLinked] = useState(false)
    const [recurringEditOptions, setRecurringEditOptions] = useState({ keepPublic: true, updateGoogle: true })
    const recurringEditOptionsRef = useRef<{ keepPublic: boolean; updateGoogle: boolean | null }>({ keepPublic: true, updateGoogle: null })

    const resolveRecurringEditScope = useCallback((scope: RecurringEditScope | null) => {
      const resolve = recurringEditResolverRef.current
      recurringEditResolverRef.current = null
      setRecurringEditTitle(null)
      resolve?.(scope)
    }, [])

    const requestRecurringEditScope = useCallback((title: string, context?: { seriesId: string; isPublic: boolean }): Promise<RecurringEditScope | null> => {
      if (recurringEditResolverRef.current) return Promise.resolve(null)
      recurringEditOptionsRef.current = { keepPublic: true, updateGoogle: null }
      setRecurringEditOptions({ keepPublic: true, updateGoogle: true })
      setRecurringEditIsPublic(Boolean(context?.isPublic))
      setRecurringEditGoogleLinked(false)
      if (context?.seriesId && !context.seriesId.startsWith('pending-')) {
        void apiClient.get<{ links: GoogleLinkStatus[] }>(`/api/google-sync/user-events/${context.seriesId}/status`)
          .then(({ data }) => {
            const links = Array.isArray(data?.links) ? data.links : []
            if (links.length === 0) return
            const updateGoogle = links.some((link) => link.keepInSync)
            setRecurringEditGoogleLinked(true)
            setRecurringEditOptions((prev) => ({ ...prev, updateGoogle }))
            recurringEditOptionsRef.current = { ...recurringEditOptionsRef.current, updateGoogle }
          })
          .catch(() => undefined)
      }
      return new Promise((resolve) => {
        recurringEditResolverRef.current = resolve
        setRecurringEditTitle(title)
      })
    }, [])

    useEffect(() => () => {
      recurringEditResolverRef.current?.(null)
      recurringEditResolverRef.current = null
    }, [])
  const [recurringResizePreview, setRecurringResizePreview] = useState<RecurringResizePreviewState | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [itemSelectionFeedback, setItemSelectionFeedback] = useState<ItemSelectionFeedback | null>(null)
  const triggerItemSelectionFeedback = useCallback((itemId: string) => {
    setItemSelectionFeedback((previous) => ({ itemId, sequence: (previous?.sequence ?? 0) + 1 }))
  }, [])
  useEffect(() => {
    if (!itemSelectionFeedback) return
    const timeoutId = window.setTimeout(() => setItemSelectionFeedback(null), 1600)
    return () => window.clearTimeout(timeoutId)
  }, [itemSelectionFeedback])
  const [showItemRecurrencePanel, setShowItemRecurrencePanel] = useState(false)
  const [movingItemId, setMovingItemId] = useState<string | null>(null)
  const touchMoveInFlightRef = useRef(false)
  // Snapshot of the item captured when a move (cut) starts. The week-scoped
  // `items` array only contains items for the visible week, so after the user
  // navigates to another week the moving item disappears from `items`. Keeping
  // a snapshot lets the move complete (and remove the original) across weeks.
  const [movingItemSnapshot, setMovingItemSnapshot] = useState<TimeItem | null>(null)
  const [isMoveScopeOpen, setIsMoveScopeOpen] = useState(false)
  const eventsCacheKey = getEventsSessionCacheKey(user?.id)
  const [events, setEvents] = useState<UserEventRecord[]>(
    () => getSessionCacheValue<UserEventRecord[]>(eventsCacheKey) ?? []
  )
  // Only true for the very first render if a fresh cached copy exists -- lets the
  // initial mount fetch stay silent (no loading banner) while still reconciling
  // authoritatively in the background. Later refreshes are unaffected.
  const hadFreshCachedEventsAtMountRef = useRef(isSessionCacheFresh(eventsCacheKey, EVENTS_SESSION_CACHE_TTL_MS))
  const [isSourcesLoading, setIsSourcesLoading] = useState(false)
  const [isEventsLoading, setIsEventsLoading] = useState(false)
  const [isExternalSyncing, setIsExternalSyncing] = useState(false)
  const [eventsError, setEventsError] = useState<string | null>(null)
  const [isRecurrenceActionBusy, setIsRecurrenceActionBusy] = useState(false)
  const [pendingLatestOccurrenceId, setPendingLatestOccurrenceId] = useState<string | null>(null)
  const recurrenceCheckRef = useRef<Promise<void> | null>(null)
  const [unsyncedOps, setUnsyncedOps] = useState<Record<string, UnsyncedTimeItemOp>>({})
  const [isUnsyncedBannerVisible, setIsUnsyncedBannerVisible] = useState(false)
  const [externalSyncStatus, setExternalSyncStatus] = useState<string | null>(null)
  const [sourceLoadStates, setSourceLoadStates] = useState<Record<string, SourceLoadState>>({})
  const [isAggregateSourceStatusVisible, setIsAggregateSourceStatusVisible] = useState(false)
  const [activeModeId, setActiveModeId] = useState<string | null>(null)
  const [modes, setModes] = useState<TimeManagementMode[]>([])
  const [isModesLoading, setIsModesLoading] = useState(false)
  const [isModeSettingsOpen, setIsModeSettingsOpen] = useState(false)
  const [modeNameDraft, setModeNameDraft] = useState('')
  const [isCreatingMode, setIsCreatingMode] = useState(false)
  const [isDuplicatingMode, setIsDuplicatingMode] = useState(false)
  const [highlightedModeId, setHighlightedModeId] = useState<string | null>(null)
  const [isModeNameInputHighlighted, setIsModeNameInputHighlighted] = useState(false)
  const [isModeJsonImportOpen, setIsModeJsonImportOpen] = useState(false)
  const [modeJsonImportDraft, setModeJsonImportDraft] = useState('')
  const [isImportingModeJson, setIsImportingModeJson] = useState(false)

  const handleToday = () => {
    const today = new Date()
    const todayWeekStart = startOfWeek(today, { weekStartsOn: 1 })
    const todayWeekStartMs = todayWeekStart.getTime()
    const isDifferentWeek = todayWeekStartMs !== currentWeekStart.getTime()
    const todayDayIndex = (today.getDay() + 6) % 7
    const todayMinute = today.getUTCHours() * 60 + today.getUTCMinutes()

    setDayWindowStart(null)
    pendingTodayScrollRef.current = true
    pendingTodayScrollDayIndexRef.current = todayDayIndex
    pendingTodayScrollMinuteRef.current = todayMinute

    if (isDifferentWeek) {
      setCurrentWeekStart(todayWeekStart)
      hasCenteredCalendarScrollRef.current = false
    } else {
      // Avoid week reset churn when already on this week so Today can react immediately.
      if (scrollCalendarStartMinuteToScreenMiddle(todayDayIndex, todayMinute, 'smooth')) {
        pendingTodayScrollRef.current = false
        pendingTodayScrollDayIndexRef.current = null
        pendingTodayScrollMinuteRef.current = null
        hasCenteredCalendarScrollRef.current = true
      }
    }

    hasAutoScrolledToWeekItemRef.current = true
    setHighlightedDay(today)

    if (todayHighlightTimerRef.current !== null) {
      window.clearTimeout(todayHighlightTimerRef.current)
    }

    todayHighlightTimerRef.current = window.setTimeout(() => {
      setHighlightedDay(null)
      todayHighlightTimerRef.current = null
    }, 2200)
  }
  const [isModeJsonExportOpen, setIsModeJsonExportOpen] = useState(false)
  const [modeJsonCopyFeedback, setModeJsonCopyFeedback] = useState<string | null>(null)
  const [modeNameSaveFeedback, setModeNameSaveFeedback] = useState<string | null>(null)
  const [isModeNameSaveNoChangePulse, setIsModeNameSaveNoChangePulse] = useState(false)
  const [isRenamingMode, setIsRenamingMode] = useState(false)
  const [modeDeleteState, setModeDeleteState] = useState<{ open: boolean; action: 'move' | null; transferToModeId: string | null }>({
    open: false,
    action: null,
    transferToModeId: null,
  })
  const [copiedItem, setCopiedItem] = useState<CopiedItemMetadata | null>(null)
  const [clipboardStatus, setClipboardStatus] = useState<string | null>(null)
  const [multiSelectedItemIds, setMultiSelectedItemIds] = useState<Set<string>>(new Set())
  const [multiClipboard, setMultiClipboard] = useState<MultiClipboardData | null>(null)

  const [categories, setCategories] = useState<Category[]>([])
  const [categoryDeleteTarget, setCategoryDeleteTarget] = useState<Category | null>(null)
  const [prefs, setPrefs] = useState<TimeManagementPrefs>({
    main_color: '#2563eb',
    main_label: 'Coordination Manager Main',
    category_color_display_style: DEFAULT_CATEGORY_COLOR_DISPLAY_STYLE,
  })
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft | null>(null)
  const [categoryColorTarget, setCategoryColorTarget] = useState<CategoryColorTarget>('background')
  const [isMainColorOpen, setIsMainColorOpen] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exportTargetIds, setExportTargetIds] = useState<Set<string>>(new Set())
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [exportKeepInSync, setExportKeepInSync] = useState(false)
  const [googleSyncRefreshKey, setGoogleSyncRefreshKey] = useState(0)
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [pendingUnsavedAction, setPendingUnsavedAction] = useState<PendingUnsavedAction | null>(null)
  const [pendingUnsavedAnchor, setPendingUnsavedAnchor] = useState<PendingUnsavedAnchor | null>(null)
  const [isPendingUnsavedActionSaving, setIsPendingUnsavedActionSaving] = useState(false)
  const [calendarItemContextMenu, setCalendarItemContextMenu] = useState<{
    itemId: string
    x: number
    y: number
    isReadOnly: boolean
    target: GridContextTarget | null
  } | null>(null)
  const [contextMenuDeleteConfirmOpen, setContextMenuDeleteConfirmOpen] = useState(false)
  const [contextMenuCategorySubmenuOpen, setContextMenuCategorySubmenuOpen] = useState(false)
  const calendarItemContextMenuRef = useRef<HTMLDivElement | null>(null)
  const contextMenuCategoryTriggerRef = useRef<HTMLButtonElement | null>(null)
  const contextMenuCategorySubmenuRef = useRef<HTMLDivElement | null>(null)
  const [categorySubmenuPosition, setCategorySubmenuPosition] = useState({ left: 0, top: 0 })
  const modeJsonCopyFeedbackTimerRef = useRef<number | null>(null)
  const modeNameSaveFeedbackTimerRef = useRef<number | null>(null)
  const modeNameNoChangePulseTimerRef = useRef<number | null>(null)
  const highlightedModeTimerRef = useRef<number | null>(null)
  const modeNameInputHighlightTimerRef = useRef<number | null>(null)
  const modeNameInputRef = useRef<HTMLInputElement | null>(null)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ left: number; top: number } | null>(null)
  const [selectionPasteContextMenu, setSelectionPasteContextMenu] = useState<{
    x: number
    y: number
    target: GridContextTarget | null
  } | null>(null)
  const itemContextHoldGateRef = useRef(createTouchSelectGate({ holdMs: TIME_GRID_TOUCH_HOLD_MS }))
  const suppressItemHoldClickUntilRef = useRef(0)

  useEffect(() => () => itemContextHoldGateRef.current.dispose(), [])
  const activeModeIdRef = useRef<string | null>(null)
  const selectedDraftHydratedItemIdRef = useRef<string | null>(null)
  const lastSavedDraftSignatureRef = useRef<string | null>(null)
  const isPersistingSelectedItemRef = useRef(false)
  const hasHydratedModeStateRef = useRef(false)
  const allowClearTimeBackgroundsRef = useRef(false)
  const allowClearQuickTemplatesRef = useRef(false)
  const quickTemplatesTouchedRef = useRef(false)
  const showQuickTemplatesTouchedRef = useRef(false)
  const draftRef = useRef<ItemDraft | null>(null)
  const syncChannelRef = useRef<BroadcastChannel | null>(null)
  const hasBroadcastedInitialSyncRef = useRef(false)
  const suppressOptimisticEventBroadcastRef = useRef(false)
  const enabledExternalSourceIdsRef = useRef<string[]>([])
  const aggregateSourceStatusFadeTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (aggregateSourceStatusFadeTimerRef.current !== null) {
        window.clearTimeout(aggregateSourceStatusFadeTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    activeModeIdRef.current = activeModeId
  }, [activeModeId])

  useEffect(() => {
    currentWeekStartRef.current = currentWeekStart
  }, [currentWeekStart])

  useEffect(() => {
    setEditingCategoryId(null)
    setCategoryDraft(null)
    setCategoryDeleteTarget(null)
  }, [activeModeId])

  const [deletingBackgroundId, setDeletingBackgroundId] = useState<string | null>(null)
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null)
  const [deletingTemplatePopoverPosition, setDeletingTemplatePopoverPosition] = useState<{ left: number; top: number } | null>(null)
  const [pendingTemplateSourceId, setPendingTemplateSourceId] = useState<string | null>(null)
  const [pendingTemplateQuickName, setPendingTemplateQuickName] = useState('')
  const [isTemplateSelectionMode, setIsTemplateSelectionMode] = useState(false)
  const [quickTemplates, setQuickTemplates] = useState<QuickTemplate[]>(() => persistedPreferences?.quickTemplates ?? [])
  const [showQuickTemplatesInMain, setShowQuickTemplatesInMain] = useState(
    () => persistedPreferences?.showQuickTemplatesInMain ?? false
  )
  const [quickTemplatesMainExpanded, setQuickTemplatesMainExpanded] = useState(
    () => persistedPreferences?.quickTemplatesMainExpanded ?? true
  )
  const [isQuickTemplatesToggleHovering, setIsQuickTemplatesToggleHovering] = useState(false)
  const [isMobileQuickListExpanded, setIsMobileQuickListExpanded] = useState(false)
  const [quickTemplateAwaitingTime, setQuickTemplateAwaitingTime] = useState<string | null>(null)
  const [isAutoSaving, setIsAutoSaving] = useState(false)
  const [isCreatingItem, setIsCreatingItem] = useState(false)
  const [autoSaveError, setAutoSaveError] = useState<string | null>(null)
  const [autoSaveDeadlineMs, setAutoSaveDeadlineMs] = useState<number | null>(null)
  const [autoSaveTickMs, setAutoSaveTickMs] = useState(() => Date.now())
  const [saveSuccessHoldUntilMs, setSaveSuccessHoldUntilMs] = useState<number | null>(null)
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const [isTitleTypingHintActive, setIsTitleTypingHintActive] = useState(false)
  const [isDescriptionHintActive, setIsDescriptionHintActive] = useState(false)
  const [isFullEditorOpen, setIsFullEditorOpen] = useState(false)
  const [autoFocusTitleOnEditorOpen, setAutoFocusTitleOnEditorOpen] = useState(false)
  const [timeBackgrounds, setTimeBackgrounds] = useState<TimeBackgroundPeriod[]>(
    () => persistedPreferences?.timeBackgrounds ?? []
  )
  const layoutMode: TimeManagementLayoutMode = viewportWidth < PHONE_BREAKPOINT_PX
    ? 'phone'
    : viewportWidth < TABLET_BREAKPOINT_PX
      ? 'tablet'
      : 'desktop'
  const isPhoneLayout = layoutMode === 'phone'
  const headerRef = useRef<HTMLElement>(null)
  const headerLeftRef = useRef<HTMLDivElement>(null)
  const headerTitleRef = useRef<HTMLHeadingElement>(null)
  const headerDisableHiddenModeRef = useRef<HTMLButtonElement>(null)
  const headerNavigationRef = useRef<HTMLDivElement>(null)
  const headerControlsRef = useRef<HTMLDivElement>(null)
  const headerTimeZoomRef = useRef<HTMLDivElement>(null)
  const [isHeaderTitleHidden, setIsHeaderTitleHidden] = useState(false)
  const isHeaderTitleHiddenRef = useRef(isHeaderTitleHidden)
  isHeaderTitleHiddenRef.current = isHeaderTitleHidden

  useLayoutEffect(() => {
    if (isPhoneLayout) return
    const header = headerRef.current
    const left = headerLeftRef.current
    const title = headerTitleRef.current
    const navigation = headerNavigationRef.current
    const controls = headerControlsRef.current
    const disableHiddenMode = headerDisableHiddenModeRef.current
    const timeZoom = headerTimeZoomRef.current
    const panelToggle = left?.firstElementChild
    if (!header || !left || !title || !navigation || !controls || !panelToggle) return

    const updateTitleVisibility = () => {
      if (header.clientWidth <= 0) return
      const headerStyle = getComputedStyle(header)
      const availableWidth = header.clientWidth
        - parseFloat(headerStyle.paddingLeft) - parseFloat(headerStyle.paddingRight)
      const leftGap = parseFloat(getComputedStyle(left).columnGap)
      const leftWidth = panelToggle.getBoundingClientRect().width
        + leftGap + title.getBoundingClientRect().width
        + (timeZoom ? timeZoom.getBoundingClientRect().width + leftGap : 0)
        + (disableHiddenMode
          ? disableHiddenMode.getBoundingClientRect().width + leftGap
          : 0)
      const controlsWidth = Array.from(controls.children).reduce(
        (width, child) => width + child.getBoundingClientRect().width, 0
      ) + Math.max(0, controls.childElementCount - 1) * parseFloat(getComputedStyle(controls).columnGap)
      const requiredWidth = 2 * Math.max(leftWidth, controlsWidth)
        + navigation.getBoundingClientRect().width + 2 * parseFloat(headerStyle.columnGap)
      const nextHidden = availableWidth < requiredWidth
      // The observer fires after every zoom/label change; an unchanged setState right after a
      // commit still re-renders this whole page once before React bails out, so skip it.
      if (nextHidden === isHeaderTitleHiddenRef.current) return
      isHeaderTitleHiddenRef.current = nextHidden
      setIsHeaderTitleHidden(nextHidden)
    }

    updateTitleVisibility()
    window.addEventListener('resize', updateTitleVisibility)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateTitleVisibility)
    for (const element of [header, title, panelToggle, navigation, controls, ...controls.children]) {
      observer?.observe(element)
    }
    if (disableHiddenMode) observer?.observe(disableHiddenMode)
    if (timeZoom) observer?.observe(timeZoom)
    return () => {
      window.removeEventListener('resize', updateTitleVisibility)
      observer?.disconnect()
    }
  }, [isPhoneLayout, isHiddenModeEnabled, showTimeZoomQuickButtons, showDayZoomQuickButtons])

  const showTimeSelectionPanelButtons = !isPhoneLayout && leftPanelWidthPx >= 400
  const showItemSelectionPanelButtons = !isPhoneLayout && leftPanelWidthPx >= 640
  const isCompactHeaderControls = isPhoneLayout
  const isDesktopLayout = layoutMode === 'desktop'
  const showDesktopLeftPanel = !isPhoneLayout && isLeftPanelOpen
  const showMobileToolsOverlay = isPhoneLayout && mobileSurface === 'tools'
  const showMobileQuickObjectsOverlay = isPhoneLayout && mobileSurface === 'quickObjects'
  const isToolsSurfaceVisible = showDesktopLeftPanel || showMobileToolsOverlay || showMobileQuickObjectsOverlay
  const showMainQuickTemplates = showQuickTemplatesInMain && !showMobileQuickObjectsOverlay
  // Phone tools drawer: scrim and panel share one drawer claim (scrim renders first).
  const { z: phoneToolsDrawerZ } = useOverlayLayer('drawer', isPhoneLayout && isToolsSurfaceVisible)
  // Page-level fixed popovers and context menus resolve above any open blocking
  // overlay (drawer, full editor) and stay under dialogs opened from them.
  const { z: templateDeletePopoverZ } = useOverlayLayer('popover', showMainQuickTemplates && deletingTemplateId !== null)
  const { z: pendingUnsavedPopoverZ } = useOverlayLayer('popover', Boolean(pendingUnsavedAction) && !isPhoneLayout)
  const { z: calendarItemContextMenuZ } = useOverlayLayer('popover', Boolean(calendarItemContextMenu))
  const { z: selectionPasteContextMenuZ } = useOverlayLayer('popover', Boolean(selectionPasteContextMenu))

  useEffect(() => {
    if (selectionDraft || selectedItemId) setQuickTemplateAwaitingTime(null)
  }, [selectionDraft, selectedItemId])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const handleResize = () => {
      setViewportWidth(window.innerWidth)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (!isPhoneLayout) {
      setMobileSurface('calendar')
      return
    }

    if (isFullEditorOpen) {
      setMobileSurface('calendar')
      return
    }

    if (showQuickTemplatesInMain && mobileSurface === 'quickObjects') {
      return
    }

    if (!isLeftPanelOpen && mobileSurface === 'tools') {
      setMobileSurface('calendar')
    }
  }, [isFullEditorOpen, isLeftPanelOpen, isPhoneLayout, mobileSurface, showQuickTemplatesInMain])

  useEffect(() => {
    if (!isPhoneLayout && !showQuickTemplatesInMain) return
    if (isPhoneLayout && quickTemplatesMainExpanded) {
      setQuickTemplatesMainExpanded(false)
    }
  }, [isPhoneLayout, quickTemplatesMainExpanded, showQuickTemplatesInMain])

  useEffect(() => {
    if (!showMobileQuickObjectsOverlay || !isLeftPanelOpen) return

    setExpandedSections((prev) => {
      if (prev.has('quickObjects')) return prev
      const next = new Set(prev)
      next.add('quickObjects')
      return next
    })

    window.setTimeout(() => {
      sectionQuickObjectsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
  }, [isLeftPanelOpen, showMobileQuickObjectsOverlay])

  const openLeftPanelSection = useCallback((section: LeftPanelSectionId) => {
    setIsLeftPanelOpen(true)
    setExpandedSections((prev) => {
      const next = new Set(prev)
      next.add(section)
      return next
    })

    if (isPhoneLayout) {
      setMobileSurface(section === 'quickObjects' ? 'quickObjects' : 'tools')
    }
  }, [isPhoneLayout])

  const openMobileCalendarSurface = useCallback(() => {
    if (isPhoneLayout) {
      setMobileSurface('calendar')
    }
  }, [isPhoneLayout])

  const openQuickObjectsSurface = useCallback(() => {
    if (isPhoneLayout) {
      setIsLeftPanelOpen(true)
      setMobileSurface('quickObjects')
      return
    }

    openLeftPanelSection('quickObjects')
  }, [isPhoneLayout, openLeftPanelSection])

  const openEditorSurface = useCallback((options?: { autoFocusTitle?: boolean }) => {
    setShowItemRecurrencePanel(false)
    setAutoFocusTitleOnEditorOpen(Boolean(options?.autoFocusTitle))
    setIsFullEditorOpen(true)

    if (isPhoneLayout) {
      setMobileSurface('calendar')
    }
  }, [isPhoneLayout])

  const closeLeftPanel = useCallback(() => {
    setIsLeftPanelOpen(false)
    setExpandedSections(new Set())
    if (isPhoneLayout) {
      setMobileSurface('calendar')
    }
  }, [isPhoneLayout])
  useMobileNavigationPanelDismiss(() => {
    setIsLeftPanelOpen(false)
    setMobileSurface('calendar')
  })
  const collapseLeftPanelSections = useCallback(() => {
    setExpandedSections(new Set())
  }, [])
  // Closes the left side panel after a Time Item save, gated by the
  // per-surface "Close Left Panel on Save" settings (Calendar Modes > Settings).
  // Unlike the explicit X/close action, this preserves `expandedSections` so
  // reopening the panel (or an already-mounted editor section) keeps its state.
  const closeLeftPanelAfterSave = useCallback((surface: CloseLeftPanelOnSaveSurface) => {
    if (!closeLeftPanelOnSaveEnabled) return
    if (!closeLeftPanelOnSaveSurfaces[surface]) return
    setIsLeftPanelOpen(false)
    if (isPhoneLayout) {
      setMobileSurface('calendar')
    }
  }, [closeLeftPanelOnSaveEnabled, closeLeftPanelOnSaveSurfaces, isPhoneLayout])
  // Gate for the "Open Left Panel on Selection" mode. In 'always' mode any grid
  // selection reveals the editor; in 'minDuration' mode only selections longer
  // than the configured threshold do.
  const shouldOpenLeftPanelForSelection = useCallback((durationMinutes: number) => {
    if (openLeftPanelOnSelectionMode === 'never') return false
    if (openLeftPanelOnSelectionMode === 'always') return true
    return durationMinutes > openLeftPanelMinSelectionMinutes
  }, [openLeftPanelMinSelectionMinutes, openLeftPanelOnSelectionMode])
  const openEditorForItemSelection = useCallback((item: { notes?: string; durationMinutes?: number }) => {
    const shouldOpen = openLeftPanelOnItemSelectionMode === 'always'
      || (openLeftPanelOnItemSelectionMode === 'description' && Boolean(item.notes?.trim()))
      || (openLeftPanelOnItemSelectionMode === 'minDuration'
        && item.durationMinutes !== undefined && item.durationMinutes > openLeftPanelMinItemSelectionMinutes)
    if (!shouldOpen) return

    if (isPhoneLayout) {
      openEditorSurface()
      return
    }

    openLeftPanelSection('editor')
  }, [isPhoneLayout, openEditorSurface, openLeftPanelMinItemSelectionMinutes, openLeftPanelOnItemSelectionMode, openLeftPanelSection])
  const reopenLeftPanelCollapsed = useCallback(() => {
    setIsLeftPanelOpen(true)
    setExpandedSections(new Set())
    if (isPhoneLayout) {
      setMobileSurface('tools')
    }
  }, [isPhoneLayout])
  const titleTypingHintTimeoutRef = useRef<number | null>(null)
  const descriptionHintTimeoutRef = useRef<number | null>(null)
  const clipboardStatusTimeoutRef = useRef<number | null>(null)
  const selectionChangePulseTimeoutRef = useRef<number | null>(null)
  const itemChangePulseTimeoutRef = useRef<number | null>(null)
  const selectionTitleInputRef = useRef<HTMLInputElement | null>(null)
  const isCreatingItemRef = useRef(false)
  const eventsRef = useRef<UserEventRecord[]>([])
  // Holds the most recent resize geometry, updated synchronously on every
  // pointer move. The commit handler reads this instead of eventsRef so it is
  // never blocked by React's deferred state/ref flush on mouse release.
  const resizeLatestTimesRef = useRef<{ startTime: string; endTime: string } | null>(null)
  const dragClientYRef = useRef<number | null>(null)
  const dragPreviewRef = useRef<HTMLDivElement | null>(null)
  const dragTopOffsetMinutesRef = useRef(0)
  const dragDropPreviewFrameRef = useRef<number | null>(null)
  const pendingDragDropPreviewRef = useRef<DragDropPreviewState | null>(null)
  const activePointerDragRef = useRef<PointerDragState | null>(null)
  const activePointerDragCleanupRef = useRef<(() => void) | null>(null)
  const suppressNextItemClickRef = useRef(false)

  const clearDragPreview = useCallback(() => {
    const preview = dragPreviewRef.current
    if (!preview) return
    if (preview.parentElement) {
      preview.parentElement.removeChild(preview)
    }
    dragPreviewRef.current = null
  }, [])

  const cancelScheduledDragDropPreview = useCallback(() => {
    pendingDragDropPreviewRef.current = null
    if (dragDropPreviewFrameRef.current !== null) {
      window.cancelAnimationFrame(dragDropPreviewFrameRef.current)
      dragDropPreviewFrameRef.current = null
    }
  }, [])

  const clearDragDropPreviewState = useCallback(() => {
    cancelScheduledDragDropPreview()
    setDragDropPreview(null)
  }, [cancelScheduledDragDropPreview])

  const scheduleDragDropPreview = useCallback((nextPreview: DragDropPreviewState) => {
    pendingDragDropPreviewRef.current = nextPreview
    if (dragDropPreviewFrameRef.current !== null) return

    dragDropPreviewFrameRef.current = window.requestAnimationFrame(() => {
      dragDropPreviewFrameRef.current = null
      const pendingPreview = pendingDragDropPreviewRef.current
      pendingDragDropPreviewRef.current = null
      if (!pendingPreview) return

      setDragDropPreview((previous) => {
        if (
          previous &&
          previous.dayIndex === pendingPreview.dayIndex &&
          previous.startMinute === pendingPreview.startMinute &&
          previous.durationMinutes === pendingPreview.durationMinutes &&
          previous.itemId === pendingPreview.itemId
        ) {
          return previous
        }

        return pendingPreview
      })
    })
  }, [])

  const resetDragInteraction = useCallback(() => {
    dragTopOffsetMinutesRef.current = 0
    setIsDraggingItem(false)
    setDraggingItemId(null)
    clearDragDropPreviewState()
    dragClientYRef.current = null
    clearDragPreview()
  }, [clearDragDropPreviewState, clearDragPreview])
  const currentWeekStartRef = useRef(currentWeekStart)
  const eventReadSequenceRef = useRef(0)
  const eventReadVersionsRef = useRef(new Map<string, number>())
  const eventWindowReadsRef = useRef(new Map<string, number>())
  const eventWindowObservationsRef = useRef(new Map<string, { window: UserEventWindow; sequence: number; authoritative: boolean }>())
  useEffect(() => () => {
    eventWindowReadsRef.current.clear()
    eventReadVersionsRef.current.clear()
    eventWindowObservationsRef.current.clear()
  }, [user?.id])
  const selectedEventIdRef = useRef<string | null>(null)
  const isAutoSavingRef = useRef(false)
  // Event ids with an in-flight mutation (e.g. drag-drop reschedule) whose
  // optimistic state must survive silent refetches. Without this, a background
  // refresh triggered by window focus/visibility (returning from idle) or a
  // cross-tab sync ping can land before the PUT commits server-side, merge in
  // stale server data, and snap the item back to its pre-move position. This is
  // invisible on localhost because the PUT commits before any refetch runs.
  const pendingMutationEventIdsRef = useRef(new Set<string>())
  const resolvedPendingEventIdsRef = useRef(new Map<string, string>())
  const deletedEventIdsRef = useRef(new Map<string, number>())
  // Completion timestamps for recently finished mutations. A GET that was issued
  // before the mutation committed can still resolve after it, so the in-flight
  // set alone is not enough: a fetch started at T0 must not apply server rows for
  // an event whose write landed after T0.
  const recentMutationCompletionsRef = useRef(new Map<string, number>())
  const weekWindowCacheRef = useRef(new Map<string, WeekWindowCacheEntry>())
  const weekWindowRequestsRef = useRef(new Map<string, Promise<UserEventRecord[]>>())
  const crossTabRefreshTimerRef = useRef<number | null>(null)
  const crossTabRefreshAuthoritativeRef = useRef(false)
  const eventsRevisionRef = useRef<string | null>(null)
  const isRevisionPollInFlightRef = useRef(false)
  // Unique per-tab id so this tab can ignore the sync pings it broadcasts itself.
  // Without this, the tab's own state-change broadcast would trigger a silent
  // refetch that overwrites optimistic/in-progress edits, causing a visible
  // backtrack render (the item briefly reverts to server state, then updates).
  const syncTabIdRef = useRef<string>(`tab-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`)

  const beginEventMutation = useCallback((eventId: string) => {
    pendingMutationEventIdsRef.current.add(eventId)
    recentMutationCompletionsRef.current.delete(eventId)
  }, [])

  const endEventMutation = useCallback((eventId: string) => {
    pendingMutationEventIdsRef.current.delete(eventId)
    recentMutationCompletionsRef.current.set(eventId, Date.now())
  }, [])

  const beginEventDeletion = useCallback((eventId: string) => {
    deletedEventIdsRef.current.set(eventId, Number.POSITIVE_INFINITY)
  }, [])

  const endEventDeletion = useCallback((eventId: string) => {
    deletedEventIdsRef.current.set(eventId, Date.now())
  }, [])

  const cancelEventDeletion = useCallback((eventId: string) => {
    deletedEventIdsRef.current.delete(eventId)
  }, [])

  const notifyTimeManagementDataChanged = useCallback((reason: string) => {
    if (typeof window === 'undefined') return
    const payload = {
      type: 'time-management-updated',
      reason,
      tabId: syncTabIdRef.current,
      updatedAt: Date.now(),
    }
    syncChannelRef.current?.postMessage(payload)
    try {
      localStorage.setItem(TIME_MANAGEMENT_SYNC_STORAGE_KEY, JSON.stringify(payload))
    } catch {
      // Ignore storage quota and private browsing errors.
    }
  }, [])

  const unsyncedOpsRef = useRef<Record<string, UnsyncedTimeItemOp>>({})
  const hasHydratedUnsyncedOpsRef = useRef(false)

  useEffect(() => {
    unsyncedOpsRef.current = unsyncedOps
  }, [unsyncedOps])

  const queueUnsyncedOp = useCallback((op: UnsyncedTimeItemOp) => {
    setUnsyncedOps((prev) => {
      const next = { ...prev, [op.eventId]: op }
      persistUnsyncedOps(next)
      return next
    })
  }, [])

  const clearUnsyncedOp = useCallback((eventId: string) => {
    setUnsyncedOps((prev) => {
      if (!(eventId in prev)) return prev
      const next = { ...prev }
      delete next[eventId]
      persistUnsyncedOps(next)
      return next
    })
  }, [])

  // Maps a pending-* id to its server id once the create POST has returned.
  // Handlers can hold a stale pending id (closures, open menus, a ghost row), so
  // every write must go through this to target the real row.
  const resolveEventId = useCallback((eventId: string): string => (
    resolvedPendingEventIdsRef.current.get(eventId) || eventId
  ), [])

  // Pending ids the user deleted while their create POST was still in flight.
  const pendingCreateDeletionsRef = useRef(new Set<string>())

  // Removes an item whose create POST has not returned yet. The server row is
  // deleted as soon as the create resolves (see finishDeletedPendingCreate).
  const deleteAwaitingCreateEvent = useCallback((pendingId: string) => {
    // Also covers a queued offline create that is being replayed right now.
    pendingCreateDeletionsRef.current.add(pendingId)
    if (pendingId in unsyncedOpsRef.current) {
      clearUnsyncedOp(pendingId)
    }
    eventsRef.current = eventsRef.current.filter((entry) => entry.id !== pendingId)
    setEvents((prev) => prev.filter((entry) => entry.id !== pendingId))
  }, [clearUnsyncedOp])

  // Called by every create path right after its POST resolves. Returns true when
  // the user already deleted the item, in which case the new row is deleted too
  // and the caller must not re-insert it.
  const finishDeletedPendingCreate = useCallback((pendingId: string, createdId: string): boolean => {
    if (!pendingCreateDeletionsRef.current.delete(pendingId)) return false
    beginEventDeletion(createdId)
    setEvents((prev) => prev.filter((entry) => entry.id !== pendingId && entry.id !== createdId))
    void apiClient.delete(`/api/user-events/${createdId}`)
      .then(() => {
        endEventDeletion(createdId)
        notifyTimeManagementDataChanged('event-deleted')
      })
      .catch((error) => {
        console.error('Failed to delete item created while deleting:', error)
        cancelEventDeletion(createdId)
      })
    return true
  }, [beginEventDeletion, cancelEventDeletion, endEventDeletion, notifyTimeManagementDataChanged])

  // Restore any writes that failed to reach the server in a previous session
  // (e.g. tab closed/refreshed while offline) so that work is never silently lost.
  useEffect(() => {
    if (!isAuthenticated || hasHydratedUnsyncedOpsRef.current) return
    hasHydratedUnsyncedOpsRef.current = true

    const persisted = loadPersistedUnsyncedOps()
    const persistedList = Object.values(persisted)
    if (persistedList.length === 0) return

    setUnsyncedOps(persisted)
    setEvents((prev) => {
      const byId = new Map(prev.map((event) => [event.id, event]))
      for (const op of persistedList) {
        byId.set(op.eventId, op.snapshot)
      }
      return Array.from(byId.values())
    })
  }, [isAuthenticated])

  // Retries queued writes on an interval and whenever the browser regains
  // connectivity, so cached items resolve automatically without user action.
  const flushUnsyncedOps = useCallback(async () => {
    const pendingOps = Object.values(unsyncedOpsRef.current)
    for (const op of pendingOps) {
      try {
        const response = op.method === 'post'
          ? await apiClient.post<{ event?: UserEventRecord }>(op.endpoint, op.payload)
          : await apiClient.put<{ event?: UserEventRecord }>(op.endpoint, op.payload)

        if (op.kind === 'create') {
          const created = response.data?.event
          if (created) {
            const normalised = normaliseCreatedManualEvent(created, {
              fallbackSourceId: (op.payload as { source_id?: string }).source_id || activeModeId || MAIN_SOURCE_ID,
              fallbackCategoryIds: Array.isArray(op.snapshot.category_ids) ? op.snapshot.category_ids : [],
              fallbackRecurrenceRule: op.snapshot.recurrence_rule ?? { type: 'none' },
            })
            resolvedPendingEventIdsRef.current.set(op.eventId, normalised.id)
            if (!finishDeletedPendingCreate(op.eventId, normalised.id)) {
              setEvents((prev) => replacePendingEvent(prev, op.eventId, normalised))
              if (selectedEventIdRef.current === op.eventId) {
                setSelectedItemId(normalised.id)
              }
            }
          }
        } else {
          const updated = response.data?.event
          if (updated) {
            setEvents((prev) => prev.map((entry) => (entry.id === op.eventId ? updated : entry)))
          }
        }

        clearUnsyncedOp(op.eventId)
        notifyTimeManagementDataChanged('unsynced-item-recovered')
      } catch (err) {
        if (op.kind === 'create' && pendingCreateDeletionsRef.current.delete(op.eventId)) {
          // The user deleted this item while its replay was in flight.
          continue
        }
        const message = err instanceof Error ? err.message : 'Could not reach the server.'
        queueUnsyncedOp({
          ...op,
          attempts: op.attempts + 1,
          lastAttemptAt: Date.now(),
          lastError: message,
        })
      }
    }
  }, [activeModeId, clearUnsyncedOp, finishDeletedPendingCreate, notifyTimeManagementDataChanged, queueUnsyncedOp])

  useEffect(() => {
    if (!isAuthenticated || typeof window === 'undefined') return

    const intervalId = window.setInterval(() => {
      if (Object.keys(unsyncedOpsRef.current).length > 0) {
        void flushUnsyncedOps()
      }
    }, UNSYNCED_RETRY_INTERVAL_MS)

    const onOnline = () => {
      void flushUnsyncedOps()
    }
    window.addEventListener('online', onOnline)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('online', onOnline)
    }
  }, [flushUnsyncedOps, isAuthenticated])

  const oldestUnsyncedFailedAt = useMemo(() => {
    const ops = Object.values(unsyncedOps)
    if (ops.length === 0) return null
    return Math.min(...ops.map((op) => op.firstFailedAt))
  }, [unsyncedOps])

  useEffect(() => {
    if (!oldestUnsyncedFailedAt) {
      setIsUnsyncedBannerVisible(false)
      return
    }

    const elapsedMs = Date.now() - oldestUnsyncedFailedAt
    if (elapsedMs >= UNSYNCED_WARNING_THRESHOLD_MS) {
      setIsUnsyncedBannerVisible(true)
      return
    }

    const timeoutId = window.setTimeout(() => {
      setIsUnsyncedBannerVisible(true)
    }, UNSYNCED_WARNING_THRESHOLD_MS - elapsedMs)

    return () => window.clearTimeout(timeoutId)
  }, [oldestUnsyncedFailedAt])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
      return
    }

    const channel = new BroadcastChannel(TIME_MANAGEMENT_SYNC_CHANNEL)
    syncChannelRef.current = channel

    return () => {
      if (syncChannelRef.current === channel) {
        syncChannelRef.current = null
      }
      channel.close()
    }
  }, [])

  useEffect(() => {
    if (!isAuthenticated) {
      hasBroadcastedInitialSyncRef.current = false
      return
    }

    if (!hasBroadcastedInitialSyncRef.current) {
      hasBroadcastedInitialSyncRef.current = true
      return
    }

    if (suppressOptimisticEventBroadcastRef.current) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      notifyTimeManagementDataChanged('state-changed')
    }, 180)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [categories, events, isAuthenticated, modes, notifyTimeManagementDataChanged])

  const clearActiveTimeSelection = useCallback(() => {
    const hadSelectionDraft = Boolean(selectionDraft || movingItemId)
    setSelectedItemId(null)
    setSelectionDraft(null)
    setIsSelecting(false)
    setIsFullEditorOpen(false)
    setMovingItemId(null)
    setMovingItemSnapshot(null)
    if (hadSelectionDraft) {
      setIsTemplateSelectionMode(false)
      setPendingTemplateSourceId(null)
      setPendingTemplateQuickName('')
      // Only discard untouched quick-template content; preserve manual edits.
      const currentDraft = draftRef.current
      if (!selectedItemId && currentDraft && draftMatchesQuickTemplate(currentDraft, quickTemplates)) {
        setDraft((prev) => ({
          ...prev,
          title: '',
          notes: '',
          categoryIds: [],
          recurrenceRule: { type: 'none' },
        }))
      }
    }
  }, [movingItemId, quickTemplates, selectedItemId, selectionDraft])

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const node = target instanceof Node ? target : null
      const element = node instanceof HTMLElement ? node : node?.parentElement
      if (!(element instanceof HTMLElement)) return false
      const tagName = element.tagName.toLowerCase()
      if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return true
      return element.isContentEditable
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (event.defaultPrevented) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (recurringEditResolverRef.current) return

      if (isDraggingItem || draggingItemId) {
        event.preventDefault()
        activePointerDragCleanupRef.current?.()
        resetDragInteraction()
        return
      }

      if (isFullEditorOpen) {
        event.preventDefault()
        setIsFullEditorOpen(false)
        return
      }

      if (isEditableTarget(event.target)) return

      if (multiSelectedItemIds.size > 0) {
        event.preventDefault()
        setMultiSelectedItemIds(new Set())
        return
      }

      if (selectedItemId || selectionDraft || movingItemId) {
        event.preventDefault()
        clearActiveTimeSelection()
        return
      }

      if (isLeftPanelOpen && expandedSections.size > 0) {
        event.preventDefault()
        collapseLeftPanelSections()
        return
      }

      if (isLeftPanelOpen) {
        event.preventDefault()
        closeLeftPanel()
        return
      }
      event.preventDefault()
      reopenLeftPanelCollapsed()
    }
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [
    clearActiveTimeSelection,
    clearDragPreview,
    clearDragDropPreviewState,
    closeLeftPanel,
    collapseLeftPanelSections,
    draggingItemId,
    expandedSections,
    isDraggingItem,
    isLeftPanelOpen,
    isFullEditorOpen,
    movingItemId,
    multiSelectedItemIds,
    reopenLeftPanelCollapsed,
    resetDragInteraction,
    selectedItemId,
    selectionDraft,
  ])
  const selectionAnchorDayColumnRef = useRef<HTMLDivElement | null>(null)
  const editorSectionRef = useRef<HTMLElement | null>(null)
  const calendarScrollContainerRef = useRef<HTMLDivElement>(null)
  const hasAutoScrolledToWeekItemRef = useRef(false)
  const hasCenteredCalendarScrollRef = useRef(false)
  const isRepositioningCalendarScrollRef = useRef(false)
  const pendingTodayScrollRef = useRef(false)
  const pendingTodayScrollDayIndexRef = useRef<number | null>(null)
  const pendingTodayScrollMinuteRef = useRef<number | null>(null)
  const entryWeekStartMsRef = useRef(startOfWeek(new Date(), { weekStartsOn: 1 }).getTime())
  const [collapsedBackgroundIds, setCollapsedBackgroundIds] = useState<Set<string>>(() => {
    const persistedCollapsed = persistedPreferences?.collapsedBackgroundIds ?? []
    if (persistedCollapsed.length > 0) {
      return new Set(persistedCollapsed)
    }
    return new Set((persistedPreferences?.timeBackgrounds ?? []).map((period) => period.id))
  })
  const dayColumnRefs = useRef<Array<HTMLDivElement | null>>([])
  const leftPanelAsideRef = useRef<HTMLElement | null>(null)
  const leftPanelScrollRef = useRef<HTMLDivElement | null>(null)
  const sectionMonthRef = useRef<HTMLElement | null>(null)
  const sectionModesRef = useRef<HTMLElement | null>(null)
  const sectionSourcesRef = useRef<HTMLElement | null>(null)
  const sectionCategoriesRef = useRef<HTMLElement | null>(null)
  const sectionTimeWidthRef = useRef<HTMLElement | null>(null)
  const sectionEditorRef = useRef<HTMLElement | null>(null)
  const sectionQuickObjectsRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    eventsRef.current = events
  }, [events])

  const getMaxLeftPanelWidthPx = useCallback(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_LEFT_PANEL_WIDTH_PX
    }
    return Math.max(MIN_LEFT_PANEL_WIDTH_PX, Math.floor(window.innerWidth * LEFT_PANEL_MAX_VIEWPORT_RATIO))
  }, [])

  const clampLeftPanelWidth = useCallback((width: number) => {
    const maxWidth = getMaxLeftPanelWidthPx()
    return Math.min(maxWidth, Math.max(MIN_LEFT_PANEL_WIDTH_PX, Math.round(width)))
  }, [getMaxLeftPanelWidthPx])

  const handleLeftPanelResizeStart = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!isLeftPanelOpen) return
    event.preventDefault()
    setIsLeftPanelResizing(true)
  }, [isLeftPanelOpen])

  useEffect(() => {
    setLeftPanelWidthPx(clampLeftPanelWidth(leftPanelPreferredWidthPxRef.current))
  }, [clampLeftPanelWidth])

  useEffect(() => {
    const handleWindowResize = () => {
      setLeftPanelWidthPx(clampLeftPanelWidth(leftPanelPreferredWidthPxRef.current))
    }

    window.addEventListener('resize', handleWindowResize)
    return () => {
      window.removeEventListener('resize', handleWindowResize)
    }
  }, [clampLeftPanelWidth])

  useEffect(() => {
    if (!isLeftPanelResizing) return

    const handlePointerMove = (event: PointerEvent) => {
      const aside = leftPanelAsideRef.current
      if (!aside) return

      if (event.buttons === 0) {
        setIsLeftPanelResizing(false)
        return
      }

      const asideRect = aside.getBoundingClientRect()
      const nextPreferredWidth = Math.max(MIN_LEFT_PANEL_WIDTH_PX, Math.round(event.clientX - asideRect.left))
      leftPanelPreferredWidthPxRef.current = nextPreferredWidth
      const nextWidth = clampLeftPanelWidth(nextPreferredWidth)
      setLeftPanelWidthPx(nextWidth)
    }

    const stopResizing = () => {
      setIsLeftPanelResizing(false)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResizing)
    window.addEventListener('blur', stopResizing)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResizing)
      window.removeEventListener('blur', stopResizing)
    }
  }, [clampLeftPanelWidth, isLeftPanelResizing])

  useEffect(() => {
    if (!isLeftPanelResizing) return
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
    }
  }, [isLeftPanelResizing])

  const [syncCalendars, setSyncCalendars] = useState<SyncCalendar[]>(() => {
    const syncCalendarMap = new Map<string, SyncCalendar>()

    for (const source of DEFAULT_SYNC_CALENDARS) {
      syncCalendarMap.set(source.id, source)
    }

    for (const source of persistedPreferences?.syncCalendars || []) {
      syncCalendarMap.set(source.id, source)
    }

    return Array.from(syncCalendarMap.values())
  })

  const [miniCalMonth, setMiniCalMonth] = useState(() => startOfMonth(new Date()))

  const [draft, setDraft] = useState<ItemDraft>({
    title: '',
    notes: '',
    location: null,
    categoryIds: [],
    sourceId: syncCalendars.find((source) => source.enabled)?.id || syncCalendars[0]?.id || MAIN_SOURCE_ID,
    recurrenceRule: { type: 'none' },
  })
  const [isLocationFieldVisible, setIsLocationFieldVisible] = useState(false)

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    const state: StoredPreferences = {
      syncCalendars,
      slotMinutes,
      dayZoomLevel,
      showTimeZoomQuickButtons,
      showDayZoomQuickButtons,
      timeBackgrounds,
      collapsedBackgroundIds: Array.from(collapsedBackgroundIds),
      quickTemplates,
      showQuickTemplatesInMain,
      quickTemplatesMainExpanded,
      isLeftPanelOpen: false,
      leftPanelWidthPx: leftPanelPreferredWidthPxRef.current,
      expandedSections: Array.from(expandedSections),
      showActiveSourcesWhenCollapsed,
      closeLeftPanelOnSaveEnabled,
      closeLeftPanelOnSaveSurfaces,
      openLeftPanelOnSelectionMode,
      openLeftPanelMinSelectionMinutes,
      openLeftPanelOnItemSelectionMode,
      openLeftPanelMinItemSelectionMinutes,
    }
    persistStoredPreferences(state)
  }, [
    closeLeftPanelOnSaveEnabled,
    closeLeftPanelOnSaveSurfaces,
    collapsedBackgroundIds,
    dayZoomLevel,
    expandedSections,
    isLeftPanelOpen,
    leftPanelWidthPx,
    openLeftPanelMinItemSelectionMinutes,
    openLeftPanelMinSelectionMinutes,
    openLeftPanelOnItemSelectionMode,
    openLeftPanelOnSelectionMode,
    quickTemplates,
    quickTemplatesMainExpanded,
    showActiveSourcesWhenCollapsed,
    showDayZoomQuickButtons,
    showQuickTemplatesInMain,
    showTimeZoomQuickButtons,
    slotMinutes,
    syncCalendars,
    timeBackgrounds,
  ])

  useEffect(() => {
    setMiniCalMonth(startOfMonth(currentWeekStart))
  }, [currentWeekStart])

  const fetchConnectedCalendars = useCallback(async () => {
    if (isAuthLoading) {
      return
    }

    setIsSourcesLoading(true)
    if (!isAuthenticated || isTraveler) {
      setSyncCalendars((prev) => prev.filter((source) => source.sourceType === 'app'))
      setIsSourcesLoading(false)
      return
    }

    try {
      const res = await dedupedGet<{ sources: ConnectedCalendarSource[] }>('/api/calendar-sources')
      const sources = Array.isArray(res.data?.sources) ? res.data.sources : []

      setSyncCalendars((prev) => {
        const enabledById = new Map(prev.map((source) => [source.id, source.enabled]))
        const appSources = prev.filter((source) => source.sourceType === 'app')
        const externalSources: SyncCalendar[] = sources
          .filter((source) => source.is_active)
          .map((source) => ({
            id: source.id,
            name: source.display_name,
            color: source.color || '#0f766e',
            enabled: enabledById.has(source.id) ? Boolean(enabledById.get(source.id)) : true,
            sourceType: 'external',
            externalKind: source.source_type,
            secondaryLabel: source.source_type === 'google_oauth' ? source.google_email || 'Google Calendar' : 'Public URL',
          }))

        return [...appSources, ...externalSources]
      })
    } catch (err) {
      console.error('Failed to fetch calendar sources:', err)
    } finally {
      setIsSourcesLoading(false)
    }
  }, [isAuthLoading, isAuthenticated, isTraveler])

  useEffect(() => {
    fetchConnectedCalendars()
  }, [fetchConnectedCalendars])

  useEffect(() => {
    if (!isAuthenticated) {
      setActiveModeId(null)
      hasHydratedModeStateRef.current = false
      return
    }

    let cancelled = false
    hasHydratedModeStateRef.current = false

    setIsModesLoading(true)
    dedupedGet<{ activeModeId?: string; active_mode_id?: string; modes?: TimeManagementMode[] }>('/api/time-management/modes')
      .then((res) => {
        if (cancelled) return

        const modes = Array.isArray(res.data?.modes) ? res.data.modes : []
        setModes(modes)
        if (modes.length === 0) {
          setActiveModeId(null)
          return
        }

        const requestedActiveModeId =
          typeof res.data?.activeModeId === 'string'
            ? res.data.activeModeId
            : typeof res.data?.active_mode_id === 'string'
              ? res.data.active_mode_id
              : null

        const activeMode =
          (requestedActiveModeId
            ? modes.find((mode) => mode.id === requestedActiveModeId)
            : null) || modes[0]

        setActiveModeId(activeMode.id)

        setPrefs(buildModePrefs(activeMode))
        if (isTimeWidth(activeMode.slot_minutes)) {
          setSlotMinutes(activeMode.slot_minutes)
        }

        const modeTimeBackgrounds = Array.isArray(activeMode.time_backgrounds)
          ? activeMode.time_backgrounds
              .map((period) => normaliseStoredTimeBackground(period))
              .filter((period): period is TimeBackgroundPeriod => Boolean(period))
          : []

        const nextCollapsedBackgroundIds = Array.isArray(activeMode.collapsed_background_ids)
          ? activeMode.collapsed_background_ids.filter(
              (id): id is string =>
                typeof id === 'string' && modeTimeBackgrounds.some((period) => period.id === id)
            )
          : []

        const resolvedModeVisuals = resolveModeVisualState(
          activeMode,
          modeTimeBackgrounds,
          nextCollapsedBackgroundIds
        )
        setTimeBackgrounds(resolvedModeVisuals.timeBackgrounds)
        setCollapsedBackgroundIds(new Set(resolvedModeVisuals.collapsedBackgroundIds))

        const modeQuickTemplates = Array.isArray(activeMode.quick_templates)
          ? activeMode.quick_templates
              .map((template) => normaliseStoredQuickTemplate(template))
              .filter((template): template is QuickTemplate => Boolean(template))
          : []
        const nextQuickTemplates = quickTemplatesTouchedRef.current ? quickTemplates : modeQuickTemplates
        const nextShowQuickTemplatesInMain = showQuickTemplatesTouchedRef.current
          ? showQuickTemplatesInMain
          : resolveShowQuickTemplatesInMain(activeMode.show_quick_templates_in_main)
        setQuickTemplates(nextQuickTemplates)
        setShowQuickTemplatesInMain(nextShowQuickTemplatesInMain)
        allowClearTimeBackgroundsRef.current = false
        allowClearQuickTemplatesRef.current = false

        const modeSyncCalendars = Array.isArray(activeMode.sync_calendars)
          ? activeMode.sync_calendars
              .map((source) => normaliseStoredSyncCalendar(source))
              .filter((source): source is SyncCalendar => Boolean(source))
          : []

        const modeSyncById = new Map(modeSyncCalendars.map((source) => [source.id, source]))
        const modeMainSource =
          modeSyncById.get(MAIN_SOURCE_ID) ||
          modeSyncById.get(activeMode.id) ||
          modeSyncCalendars.find((source) => source.sourceType === 'app')

        setSyncCalendars((prev) => {
          const previousMainSource = prev.find((entry) => entry.id === MAIN_SOURCE_ID)
          const mergedExternalSources = new Map<string, SyncCalendar>()
          for (const source of prev.filter((entry) => entry.sourceType === 'external')) {
            mergedExternalSources.set(source.id, source)
          }
          for (const source of modeSyncCalendars.filter((entry) => entry.sourceType === 'external')) {
            mergedExternalSources.set(
              source.id,
              mergeModeExternalSource({
                existingSource: mergedExternalSources.get(source.id),
                modeSource: source,
                enabledFromMode: modeSyncById.has(source.id)
                  ? Boolean(modeSyncById.get(source.id)?.enabled)
                  : source.enabled,
              })
            )
          }

          const appSources = buildAppSyncSourcesForMode({
            allModes: modes,
            activeModeId: activeMode.id,
            activeModeName: activeMode.name?.trim() || 'Coordination Manager Main',
            activeModeColor: isHexColor(activeMode.main_color) ? activeMode.main_color : '#2563eb',
            modeSyncById,
            previousSources: prev,
            mainEnabled: modeMainSource ? Boolean(modeMainSource.enabled) : (previousMainSource?.enabled ?? true),
          })

          return [
            ...appSources,
            ...Array.from(mergedExternalSources.values()),
          ]
        })
        hasHydratedModeStateRef.current = true
      })
      .catch((err) => {
        if (cancelled) return
        console.error('Failed to fetch time-management modes:', err)
        hasHydratedModeStateRef.current = false
      })
      .finally(() => {
        if (!cancelled) setIsModesLoading(false)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: hydrate modes only on auth/persisted-prefs change; user-touched values are preserved via refs
  }, [isAuthenticated, persistedPreferences])

  // Sync Main calendar entry's display name/color with stored prefs.
  useEffect(() => {
    setSyncCalendars((prev) =>
      prev.map((source) =>
        source.id === MAIN_SOURCE_ID
          ? { ...source, color: prefs.main_color, name: prefs.main_label }
          : source
      )
    )
  }, [prefs.main_color, prefs.main_label])

  // Fetch user-defined categories for the currently active mode.
  useEffect(() => {
    if (!isAuthenticated) {
      setCategories([])
      return
    }

    let cancelled = false
    dedupedGet<{ categories: Category[] }>('/api/time-management/categories')
      .then((res) => {
        if (cancelled) return
        setCategories(
          Array.isArray(res.data?.categories)
            ? res.data.categories.map((category) => ({
                ...category,
                font_color: isHexColor(category.font_color) ? category.font_color : DEFAULT_CATEGORY_FONT_COLOR,
                background_opacity: normaliseCategoryBackgroundOpacity(category.background_opacity),
                item_opacity: normaliseCategoryItemOpacity(category.item_opacity),
              }))
            : []
        )
      })
      .catch((err) => {
        if (cancelled) return
        console.error('Failed to fetch categories:', err)
      })

    return () => {
      cancelled = true
    }
  }, [activeModeId, isAuthenticated])

  // Fetch Time-Management prefs.
  useEffect(() => {
    if (!isAuthenticated) {
      return
    }

    let cancelled = false

    dedupedGet<{ prefs: TimeManagementPrefs }>('/api/time-management/prefs')
      .then((res) => {
        if (cancelled) return
        if (res.data?.prefs) {
          setPrefs((prev) => {
            if (activeModeIdRef.current) return prev

            const hasServerStyle = res.data.prefs.category_color_display_style !== undefined

            return {
              main_color: isHexColor(res.data.prefs.main_color) ? res.data.prefs.main_color : prev.main_color,
              main_label:
                typeof res.data.prefs.main_label === 'string' && res.data.prefs.main_label.trim().length > 0
                  ? res.data.prefs.main_label.trim()
                  : prev.main_label,
              category_color_display_style: hasServerStyle
                ? normaliseCategoryColorDisplayStyle(res.data.prefs.category_color_display_style)
                : prev.category_color_display_style,
            }
          })
        }
      })
      .catch((err) => {
        if (cancelled) return
        console.error('Failed to fetch time-management prefs:', err)
      })
    return () => {
      cancelled = true
    }
  }, [isAuthenticated])

  const fetchEvents = useCallback(async (options?: { silent?: boolean; weekStart?: Date; force?: boolean; authoritative?: boolean }) => {
    if (!isAuthenticated) {
      setEvents([])
      setEventsError(null)
      setIsEventsLoading(false)
      return [] as UserEventRecord[]
    }

    const cacheWeekStart = options?.weekStart ?? currentWeekStartRef.current
    const window = getWeekEventWindow(cacheWeekStart)
    const requestKey = `${user?.id ?? 'anonymous'}:${window.windowStart}:${window.windowEnd}`
    const readSequence = ++eventReadSequenceRef.current
    eventWindowReadsRef.current.set(requestKey, readSequence)
    const isVisibleRequest = () => eventWindowReadsRef.current.get(requestKey) === readSequence
      && getWeekEventWindow(currentWeekStartRef.current).windowStart === window.windowStart
    if (!options?.silent && isVisibleRequest()) {
      setIsEventsLoading(true)
    }
    if (isVisibleRequest()) setEventsError(null)

    try {
      if (!recurrenceCheckRef.current) {
        recurrenceCheckRef.current = (async () => {
          try {
            let hasActive = eventsRef.current.some(event => event.recurrence?.status === 'active')
            if (!hasActive) {
              const { data } = await dedupedGet<{ active: boolean }>('/api/user-events/conditional-recurrences')
              hasActive = data.active === true
            }
            if (hasActive) {
              await apiClient.post('/api/user-events/conditional-recurrences/check')
            }
          } finally {
            recurrenceCheckRef.current = null
          }
        })()
      }
      await recurrenceCheckRef.current
      // A forced fetch bypasses dedupedGet: an unrelated GET to this same URL may
      // already be in-flight (e.g. a background neighbor-week refresh) and could
      // have started before a just-completed sync-imports write landed server-side.
      // Reusing that stale in-flight promise would hide newly synced meetings until
      // the next manual page refresh.
      const fetchStartedAt = Date.now()
      const config = { params: window }
      const res = options?.force
        ? await apiClient.get<{ events: UserEventRecord[]; revision?: string }>('/api/user-events', config)
        : await dedupedGet<{ events: UserEventRecord[]; revision?: string }>('/api/user-events', config)
      if (eventWindowReadsRef.current.get(requestKey) !== readSequence) return eventsRef.current
      if (typeof res.data?.revision === 'string') {
        eventsRevisionRef.current = res.data.revision
      }
      const authoritative = options?.authoritative ?? !options?.silent
      const localIds = new Set(eventsRef.current.map(event => event.id))
      const newerObservations = [...eventWindowObservationsRef.current.values()]
        .filter(observation => observation.sequence > readSequence)
      const fetchedEvents = (Array.isArray(res.data?.events) ? res.data.events : []).filter((event) => {
        if (!localIds.has(event.id) && (
          (eventReadVersionsRef.current.get(event.id) ?? 0) > readSequence
          || newerObservations.some(observation =>
            (observation.authoritative || event.source_type !== 'manual')
            && isEventInWindow(event, observation.window))
        )) return false
        const deletedAt = deletedEventIdsRef.current.get(event.id)
        if (deletedAt === undefined) return true
        if (deletedAt === Number.POSITIVE_INFINITY || deletedAt >= fetchStartedAt - MUTATION_COMPLETION_GRACE_MS) {
          return false
        }
        if (deletedAt < fetchStartedAt - MUTATION_COMPLETION_RETENTION_MS) {
          deletedEventIdsRef.current.delete(event.id)
        }
        return true
      })
      const selectedEventId = selectedEventIdRef.current
      const preserveEventIds = new Set<string>()
      if (selectedEventId) {
        const selectedEventMissingFromFetch = !fetchedEvents.some((event) => event.id === selectedEventId)
        if ((selectedEventMissingFromFetch && !authoritative) || isAutoSavingRef.current) {
          preserveEventIds.add(selectedEventId)
        }
      }
      // Preserve any event with an in-flight mutation so a silent refetch does
      // not overwrite its optimistic state with stale server data.
      for (const pendingId of pendingMutationEventIdsRef.current) {
        preserveEventIds.add(pendingId)
      }
      // Attribute values (category_ids, times, etc.) for an event whose mutation
      // committed after this request was issued always keep the local version --
      // the response predates the write and would otherwise flash back to stale
      // field values, even on an authoritative fetch (e.g. a foreground connected-
      // calendar sync racing a just-applied category tag). This never blocks a
      // fetch from reporting the id as genuinely deleted elsewhere; it only wins
      // when the id is still present in the response. The grace window also
      // covers responses shared via dedupedGet, whose real request start can be
      // earlier than fetchStartedAt.
      const attributePreserveEventIds = new Set<string>()
      for (const localEvent of eventsRef.current) {
        if ((eventReadVersionsRef.current.get(localEvent.id) ?? 0) > readSequence) {
          preserveEventIds.add(localEvent.id)
          attributePreserveEventIds.add(localEvent.id)
        } else if (isEventInWindow(localEvent, window)) {
          eventReadVersionsRef.current.set(localEvent.id, readSequence)
        }
      }
      for (const event of fetchedEvents) {
        eventReadVersionsRef.current.set(event.id, Math.max(readSequence, eventReadVersionsRef.current.get(event.id) ?? 0))
      }
      for (const [mutatedId, completedAt] of recentMutationCompletionsRef.current.entries()) {
        if (completedAt >= fetchStartedAt - MUTATION_COMPLETION_GRACE_MS) {
          attributePreserveEventIds.add(mutatedId)
        } else if (completedAt < fetchStartedAt - MUTATION_COMPLETION_RETENTION_MS) {
          recentMutationCompletionsRef.current.delete(mutatedId)
        }
      }
      // Events with a queued (still-failing) write are local-only until they
      // land server-side. No refetch may ever drop them -- there was no user
      // signal to delete this data, only a server/network hiccup.
      for (const unsyncedEventId of Object.keys(unsyncedOpsRef.current)) {
        preserveEventIds.add(unsyncedEventId)
      }

      const mergeParams = {
        window,
        fetchedEvents,
        preserveEventIds,
        attributePreserveEventIds,
        // `force` only bypasses dedupedGet's promise-sharing (see above) -- it is
        // not a signal that this fetch should be treated as a full reconciliation.
        // Background/neighbor-week hydration passes force:true on every tick, so
        // basing authoritative-ness on it would let those ticks silently delete
        // manual items the server simply hasn't echoed back yet. Only a
        // foreground (non-silent) fetch -- initial load or a user-visible sync --
        // may reconcile removals. `authoritative` can be explicitly forced true
        // (e.g. the cache-hydrated initial load, which is silent but still wants
        // a real reconciliation once its response lands).
        authoritative,
        resolvedPendingEventIds: resolvedPendingEventIdsRef.current,
      }
      const localSnapshot = eventsRef.current
      const mergedEvents = mergeFetchedEventsWithLocalState({ ...mergeParams, localEvents: localSnapshot })

      // eventsRef is synced in an effect, so it can lag behind a just-queued
      // update (e.g. a create POST swapping its pending row). Re-merge against the
      // latest state in that case instead of overwriting it with a stale snapshot,
      // which would resurrect the pending row next to the real one.
      setEvents((prev) => reuseUnchangedEvents(
        prev,
        prev === localSnapshot ? mergedEvents : mergeFetchedEventsWithLocalState({ ...mergeParams, localEvents: prev })
      ))
      eventsRef.current = mergedEvents
      eventWindowObservationsRef.current.set(requestKey, { window, sequence: readSequence, authoritative })
      const cacheKey = `${user?.id ?? 'anonymous'}:${getWeekWindowKey(cacheWeekStart, enabledExternalSourceIdsRef.current)}`
      weekWindowCacheRef.current.set(cacheKey, {
        events: mergedEvents,
        updatedAt: Date.now(),
      })
      return mergedEvents
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load meetings.'
      console.error('Failed to load event window:', message.replace(/[\r\n]/g, ' '))
      if (isVisibleRequest()) setEventsError(message)
      return eventsRef.current
    } finally {
      if (isVisibleRequest()) {
        setIsEventsLoading(false)
      }
    }
  }, [isAuthenticated, user?.id])

  useEffect(() => {
    if (!isAuthenticated) return
    const checkRecurrences = async () => {
      try {
        const { data } = await dedupedGet<{ active: boolean }>('/api/user-events/conditional-recurrences')
        if (data.active || eventsRef.current.some(event => event.recurrence?.status === 'active')) {
          await fetchEvents({ silent: true, force: true })
        }
      } catch (error) {
        console.error('Failed to check Time Item recurrences:', error)
        setEventsError(getApiErrorMessage(error, 'Could not check recurring Time Items.'))
      }
    }
    const timer = window.setInterval(() => { void checkRecurrences() }, 30_000)
    return () => window.clearInterval(timer)
  }, [fetchEvents, isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated) {
      return
    }

    let cancelled = false

    // If a fresh cached copy exists from a previous visit this session, paint it
    // instantly (no loading banner) and reconcile authoritatively in the background
    // instead of blocking on a foreground fetch.
    void fetchEvents({ silent: hadFreshCachedEventsAtMountRef.current || eventsRef.current.length > 0, weekStart: currentWeekStart, authoritative: true }).catch(() => {
      if (cancelled) return
    })

    return () => {
      cancelled = true
    }
  }, [currentWeekStart, fetchEvents, isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated || typeof window === 'undefined') return

    const pollRevision = async () => {
      if (isRevisionPollInFlightRef.current) return
      isRevisionPollInFlightRef.current = true
      try {
        const response = await apiClient.get<{ revision?: string }>('/api/user-events/revision')
        const nextRevision = response.data?.revision
        if (typeof nextRevision !== 'string') return

        const previousRevision = eventsRevisionRef.current
        eventsRevisionRef.current = nextRevision
        if (previousRevision !== null && previousRevision !== nextRevision) {
          await fetchEvents({ silent: true, force: true, authoritative: true })
          for (const weekStart of extraRangeWeekStartsRef.current) {
            await fetchEvents({ silent: true, force: true, authoritative: true, weekStart })
          }
        }
      } catch {
        // Best-effort cross-session sync; focus and local-tab notifications remain available.
      } finally {
        isRevisionPollInFlightRef.current = false
      }
    }

    void pollRevision()
    const intervalId = window.setInterval(() => {
      void pollRevision()
    }, CROSS_SESSION_REVISION_POLL_INTERVAL_MS)

    return () => window.clearInterval(intervalId)
  }, [fetchEvents, isAuthenticated])

  useEffect(() => {
    setSessionCacheValue(eventsCacheKey, events)
  }, [events, eventsCacheKey])

  useEffect(() => {
    if (!isAuthenticated || typeof window === 'undefined') {
      return
    }

    const scheduleRefresh = (authoritative = false) => {
      crossTabRefreshAuthoritativeRef.current = crossTabRefreshAuthoritativeRef.current || authoritative
      if (crossTabRefreshTimerRef.current !== null) {
        window.clearTimeout(crossTabRefreshTimerRef.current)
      }

      crossTabRefreshTimerRef.current = window.setTimeout(() => {
        crossTabRefreshTimerRef.current = null
        const shouldReconcileRemovals = crossTabRefreshAuthoritativeRef.current
        crossTabRefreshAuthoritativeRef.current = false
        void fetchEvents({ silent: true, authoritative: shouldReconcileRemovals })
        for (const weekStart of extraRangeWeekStartsRef.current) {
          void fetchEvents({ silent: true, authoritative: shouldReconcileRemovals, weekStart })
        }
      }, 180)
    }

    const isSelfOriginated = (raw: unknown): boolean => {
      if (!raw || typeof raw !== 'object') return false
      const tabId = (raw as { tabId?: unknown }).tabId
      return typeof tabId === 'string' && tabId === syncTabIdRef.current
    }

    const isCommittedDeletion = (raw: unknown): boolean => {
      if (!raw || typeof raw !== 'object') return false
      const reason = (raw as { reason?: unknown }).reason
      return reason === 'event-deleted' || reason === 'events-deleted'
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key !== TIME_MANAGEMENT_SYNC_STORAGE_KEY || !event.newValue) return
      try {
        const payload: unknown = JSON.parse(event.newValue)
        if (isSelfOriginated(payload)) return
        scheduleRefresh(isCommittedDeletion(payload))
        return
      } catch {
        // Fall through and refresh if the payload cannot be parsed.
      }
      scheduleRefresh()
    }

    const onWindowFocus = () => {
      scheduleRefresh()
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        scheduleRefresh()
      }
    }

    let channel: BroadcastChannel | null = null
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(TIME_MANAGEMENT_SYNC_CHANNEL)
      channel.onmessage = (event) => {
        if (isSelfOriginated(event.data)) return
        scheduleRefresh(isCommittedDeletion(event.data))
      }
    }

    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', onWindowFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      if (crossTabRefreshTimerRef.current !== null) {
        window.clearTimeout(crossTabRefreshTimerRef.current)
        crossTabRefreshTimerRef.current = null
      }
      crossTabRefreshAuthoritativeRef.current = false
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', onWindowFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      channel?.close()
    }
  }, [fetchEvents, isAuthenticated])

  useEffect(() => {
    if (!hasHydratedModeStateRef.current) return
    if (!activeModeId) return
    const activeMode = modes.find((mode) => mode.id === activeModeId)
    if (!activeMode) return
    if (!isTimeWidth(slotMinutes) || activeMode.slot_minutes === slotMinutes) return

    const timeoutId = window.setTimeout(() => {
      void apiClient
        .put(`/api/time-management/modes/${activeModeId}`, { slot_minutes: slotMinutes })
        .then(() => {
          setModes((prev) =>
            prev.map((mode) =>
              mode.id === activeModeId
                ? { ...mode, slot_minutes: slotMinutes }
                : mode
            )
          )
        })
        .catch((err) => {
          console.error('Failed to update mode slot width:', err)
        })
    }, 250)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [activeModeId, modes, slotMinutes])

  useEffect(() => {
    if (!hasHydratedModeStateRef.current) return
    if (!activeModeId) return
    const activeMode = modes.find((mode) => mode.id === activeModeId)
    if (!activeMode) return

    const nextBackgroundsJson = serialiseTimeBackgroundPeriodsForCompare(timeBackgrounds)
    const currentBackgroundsJson = serialiseTimeBackgroundPeriodsForCompare(activeMode.time_backgrounds)
    const nextCollapsedJson = serialiseCollapsedBackgroundIdsForCompare(collapsedBackgroundIds)
    const currentCollapsedJson = serialiseCollapsedBackgroundIdsForCompare(activeMode.collapsed_background_ids)

    if (nextBackgroundsJson === currentBackgroundsJson && nextCollapsedJson === currentCollapsedJson) {
      return
    }

    const nextCollapsedArray = Array.from(collapsedBackgroundIds)

    const timeoutId = window.setTimeout(() => {
      const shouldAllowEmptyBackgrounds = timeBackgrounds.length === 0 && allowClearTimeBackgroundsRef.current
      void apiClient
        .put(`/api/time-management/modes/${activeModeId}`, {
          time_backgrounds: timeBackgrounds,
          collapsed_background_ids: nextCollapsedArray,
          clear_time_backgrounds: shouldAllowEmptyBackgrounds,
        })
        .then((res) => {
          const updatedMode = res.data?.mode as TimeManagementMode | undefined
          if (!updatedMode) return
          setModes((prev) => prev.map((mode) => (mode.id === activeModeId ? updatedMode : mode)))
          allowClearTimeBackgroundsRef.current = false
        })
        .catch((err) => {
          console.error('Failed to update mode time backgrounds:', err)
        })
    }, 400)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [activeModeId, collapsedBackgroundIds, modes, timeBackgrounds])

  useEffect(() => {
    if (!hasHydratedModeStateRef.current) return
    if (!activeModeId) return
    const activeMode = modes.find((mode) => mode.id === activeModeId)
    if (!activeMode) return

    const nextQuickTemplatesJson = serialiseQuickTemplatesForCompare(quickTemplates)
    const currentQuickTemplatesJson = serialiseQuickTemplatesForCompare(activeMode.quick_templates)
    const nextShowQuickTemplatesInMain = resolveShowQuickTemplatesInMain(showQuickTemplatesInMain)
    const currentShowQuickTemplatesInMain = resolveShowQuickTemplatesInMain(activeMode.show_quick_templates_in_main)

    if (
      nextQuickTemplatesJson === currentQuickTemplatesJson &&
      nextShowQuickTemplatesInMain === currentShowQuickTemplatesInMain
    ) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      const shouldAllowEmptyQuickTemplates = quickTemplates.length === 0 && allowClearQuickTemplatesRef.current
      void apiClient
        .put(`/api/time-management/modes/${activeModeId}`, {
          quick_templates: quickTemplates,
          show_quick_templates_in_main: nextShowQuickTemplatesInMain,
          clear_quick_templates: shouldAllowEmptyQuickTemplates,
        })
        .then((res) => {
          const updatedMode = res.data?.mode as TimeManagementMode | undefined
          if (!updatedMode) return
          setModes((prev) => prev.map((mode) => (mode.id === activeModeId ? updatedMode : mode)))
          allowClearQuickTemplatesRef.current = false
          quickTemplatesTouchedRef.current = false
          showQuickTemplatesTouchedRef.current = false
        })
        .catch((err) => {
          console.error('Failed to update mode quick templates:', err)
        })
    }, 400)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [activeModeId, modes, quickTemplates, showQuickTemplatesInMain])

  useEffect(() => {
    if (!hasHydratedModeStateRef.current) return
    if (!activeModeId) return
    const activeMode = modes.find((mode) => mode.id === activeModeId)
    if (!activeMode) return

    const nextSyncCalendarsJson = serialiseSyncCalendarsForCompare(syncCalendars)
    const currentSyncCalendarsJson = serialiseSyncCalendarsForCompare(activeMode.sync_calendars)

    if (nextSyncCalendarsJson === currentSyncCalendarsJson) {
      return
    }

    const modeSyncCalendarsPayload = syncCalendars.map((source) => {
      if (source.sourceType === 'external') {
        return {
          id: source.id,
          enabled: source.enabled,
          sourceType: 'external' as const,
          externalKind: source.externalKind,
          displayName: source.name,
          secondaryLabel: source.secondaryLabel,
        }
      }

      return {
        id: source.id,
        enabled: source.enabled,
      }
    })

    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await apiClient.put<{ mode?: TimeManagementMode }>(`/api/time-management/modes/${activeModeId}`, {
            sync_calendars: modeSyncCalendarsPayload,
          })
          const updatedMode = res.data?.mode
          if (!updatedMode) return
          setModes((prev) => prev.map((mode) => (mode.id === activeModeId ? updatedMode : mode)))
        } catch (err) {
          console.error('Failed to update mode calendar sources:', err)
        }
      })()
    }, 400)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [activeModeId, modes, syncCalendars])

  useEffect(() => {
    isSelectingRef.current = isSelecting
  }, [isSelecting])

  useEffect(() => {
    if (!touchSelectionFinished) return
    setTouchSelectionFinished(false)
    if (!selectionDraft || movingItemId || isFullEditorOpen) return
    if (isPhoneLayout) openEditorSurface({ autoFocusTitle: true })
    else openLeftPanelSection('editor')
  }, [touchSelectionFinished, selectionDraft, movingItemId, isFullEditorOpen, isPhoneLayout, openEditorSurface, openLeftPanelSection])

  useEffect(() => {
    const onPointerUp = () => {
      const wasSelecting = isSelectingRef.current
      isSelectingRef.current = false
      setIsSelecting(false)
      selectionAnchorDayColumnRef.current = null
      // Only a pointerup that ends an active grid selection may open the editor.
      // Otherwise a leftover draft (e.g. after the grid was scrolled and the
      // gesture was cancelled) would reopen the editor on any unrelated tap.
      if (!wasSelecting) return
      if (selectionDraft && !shouldOpenLeftPanelForSelection(selectionDraft.endMinute - selectionDraft.startMinute)) return

      if (selectionDraft && isPhoneLayout && !movingItemId && !isFullEditorOpen) {
        openEditorSurface({ autoFocusTitle: true })
        return
      }

      if (selectionDraft && !isPhoneLayout) {
        if (!shouldOpenLeftPanelForSelection(selectionDraft.endMinute - selectionDraft.startMinute)) return
        openLeftPanelSection('editor')
      }
    }

    const onPointerCancel = () => {
      isSelectingRef.current = false
      setIsSelecting(false)
      selectionAnchorDayColumnRef.current = null
    }

    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    return () => {
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [isFullEditorOpen, isPhoneLayout, movingItemId, openEditorSurface, openLeftPanelSection, selectionDraft, shouldOpenLeftPanelForSelection])

  const weekDays = useMemo(
    () => Array.from({ length: dayRangeLength }, (_, idx) => addDays(currentWeekStart, idx)),
    [currentWeekStart, dayRangeLength]
  )
  const visibleDays = useMemo(
    () => visibleDayIndexes.map((dayIndex) => weekDays[dayIndex]).filter((day): day is Date => Boolean(day)),
    [visibleDayIndexes, weekDays]
  )
  const selectionDaySegments = useMemo(
    () => selectionDraft ? getTimeRangeDaySegments(selectionDraft, dayRangeLength) : [],
    [dayRangeLength, selectionDraft]
  )

  const activeSourceIds = useMemo(
    () => new Set(syncCalendars.filter((source) => source.enabled).map((source) => source.id)),
    [syncCalendars]
  )

  const enabledExternalSources = useMemo(
    () =>
      syncCalendars.filter(
        (source): source is SyncCalendar & { sourceType: 'external'; externalKind: 'google_oauth' | 'google_public_url' } =>
          source.enabled &&
          source.sourceType === 'external' &&
          (source.externalKind === 'google_oauth' || source.externalKind === 'google_public_url')
      ),
    [syncCalendars]
  )

  useEffect(() => {
    enabledExternalSourceIdsRef.current = enabledExternalSources.map((source) => source.id)
  }, [enabledExternalSources])

  useEffect(() => {
    setSourceLoadStates((prev) => {
      const next: Record<string, SourceLoadState> = {}
      for (const source of syncCalendars) {
        if (!source.enabled) {
          next[source.id] = 'disabled'
          continue
        }

        if (source.sourceType === 'app') {
          if (isEventsLoading) {
            next[source.id] = 'loading'
          } else if (eventsError) {
            next[source.id] = 'error'
          } else {
            next[source.id] = 'synced'
          }
          continue
        }

        if (isExternalSyncing) {
          next[source.id] = 'loading'
          continue
        }

        next[source.id] = prev[source.id] === 'error' ? 'error' : 'synced'
      }
      return next
    })
  }, [eventsError, isEventsLoading, isExternalSyncing, syncCalendars])

  const hydrateWeekWindow = useCallback(async (weekStart: Date, options?: { background?: boolean; forceRefresh?: boolean }) => {
    if (isAuthLoading || !isAuthenticated || isTraveler || enabledExternalSources.length === 0) {
      return [] as UserEventRecord[]
    }

    const weekKey = `${user?.id ?? 'anonymous'}:${getWeekWindowKey(weekStart, enabledExternalSources.map((source) => source.id))}`
    const cachedEntry = weekWindowCacheRef.current.get(weekKey)
    if (cachedEntry && !options?.forceRefresh) {
      if (weekStart.getTime() === currentWeekStartRef.current.getTime() && !options?.background) {
        setEventsError(null)
        setIsEventsLoading(false)
      }

      // Keep week navigation instant, but refresh stale windows in the background
      // so adds/updates/deletes appear without forcing a full page reload.
      const isStale = (Date.now() - cachedEntry.updatedAt) > WEEK_WINDOW_CACHE_TTL_MS
      if (isStale) {
        void hydrateWeekWindow(weekStart, { background: true, forceRefresh: true }).catch(() => {
          // Ignore background refresh errors; current cached data remains usable.
        })
      }

      return cachedEntry.events
    }

    const existingRequest = weekWindowRequestsRef.current.get(weekKey)
    if (existingRequest) {
      return existingRequest
    }

    const request = (async () => {
      const isVisibleWeek = weekStart.getTime() === currentWeekStartRef.current.getTime()
      const shouldShowLoading = isVisibleWeek && !options?.background
      const timeMin = weekStart.toISOString()
      const timeMax = addDays(weekStart, 7).toISOString()

      if (shouldShowLoading) {
        setIsExternalSyncing(true)
        setExternalSyncStatus(null)
        setSourceLoadStates((prev) => {
          const next = { ...prev }
          for (const source of enabledExternalSources) {
            next[source.id] = 'loading'
          }
          return next
        })
      }

      try {
        const res = await apiClient.post<SyncImportsResponse>('/api/user-events/sync-imports', {
          time_min: timeMin,
          time_max: timeMax,
          source_configs: enabledExternalSources.map((source) => ({
            source_type: source.externalKind,
            source_id: source.id,
          })),
        })

        const summary = res.data || {}
        const inserted = Number(summary.inserted || 0)
        const updated = Number(summary.updated || 0)
        const deleted = Number(summary.deleted || 0)

        if (shouldShowLoading) {
          const resultsById = new Map(
            Array.isArray(summary.results)
              ? summary.results.map((result) => [result.sourceId, result])
              : []
          )
          setSourceLoadStates((prev) => {
            const next = { ...prev }
            for (const source of enabledExternalSources) {
              const sourceSummary = resultsById.get(source.id)
              next[source.id] = sourceSummary?.error ? 'error' : 'synced'
            }
            return next
          })
        }

        const fetchedEvents = await fetchEvents({ silent: !shouldShowLoading, weekStart, force: true })

        weekWindowCacheRef.current.set(weekKey, {
          events: fetchedEvents,
          updatedAt: Date.now(),
        })

        if (shouldShowLoading) {
          setExternalSyncStatus(`Synced current week: +${inserted} / ~${updated} / -${deleted}`)
        }

        return fetchedEvents
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to sync connected calendars.'
        if (shouldShowLoading) {
          setExternalSyncStatus(message)
          setSourceLoadStates((prev) => {
            const next = { ...prev }
            for (const source of enabledExternalSources) {
              next[source.id] = 'error'
            }
            return next
          })
        }
        return [] as UserEventRecord[]
      } finally {
        if (shouldShowLoading) {
          setIsExternalSyncing(false)
        }
      }
    })()

    weekWindowRequestsRef.current.set(weekKey, request)

    try {
      return await request
    } finally {
      weekWindowRequestsRef.current.delete(weekKey)
    }
  }, [enabledExternalSources, fetchEvents, isAuthLoading, isAuthenticated, isTraveler, user?.id])

  useEffect(() => {
    if (enabledExternalSources.length === 0) {
      setExternalSyncStatus(null)
      return
    }

    const weekStarts = getNeighborWeekStarts(currentWeekStart)
    const [previousWeekStart, visibleWeekStart, nextWeekStart] = weekStarts

    let cancelled = false
    let warmNeighbors: number | undefined
    const hydrate = async () => {
      await hydrateWeekWindow(visibleWeekStart, { background: false })
      if (cancelled) return
      warmNeighbors = window.setTimeout(() => {
        if (previousWeekStart) void hydrateWeekWindow(previousWeekStart, { background: true })
        if (nextWeekStart) void hydrateWeekWindow(nextWeekStart, { background: true })
      }, 300)
    }
    void hydrate()

    return () => {
      cancelled = true
      window.clearTimeout(warmNeighbors)
    }
  }, [currentWeekStart, enabledExternalSources.length, hydrateWeekWindow])

  useEffect(() => {
    const extraWeekStarts = Array.from(
      { length: Math.max(0, Math.round(dayRangeLength / 7) - 1) },
      (_, index) => addWeeks(currentWeekStart, index + 1)
    )
    extraRangeWeekStartsRef.current = extraWeekStarts
    if (!isAuthenticated || extraWeekStarts.length === 0) return
    for (const weekStart of extraWeekStarts) {
      const cacheKey = `${user?.id ?? 'anonymous'}:${getWeekWindowKey(weekStart, enabledExternalSourceIdsRef.current)}`
      const cached = weekWindowCacheRef.current.get(cacheKey)
      // Zooming between day ranges only rearranges already-loaded weeks; revision polling keeps them fresh.
      if (cached && Date.now() - cached.updatedAt < WEEK_WINDOW_CACHE_TTL_MS) continue
      void fetchEvents({ silent: true, weekStart, authoritative: true }).catch(() => undefined)
      void hydrateWeekWindow(weekStart, { background: true }).catch(() => undefined)
    }
  }, [currentWeekStart, dayRangeLength, fetchEvents, hydrateWeekWindow, isAuthenticated, user?.id])

  const items = useMemo(() => {
    const hasEnabledSources = activeSourceIds.size > 0
    return events
      .flatMap((event) => mapEventToTimeItems(event, currentWeekStart, slotMinutes, activeModeId, dayRangeLength))
      .filter((item) => !hasEnabledSources || activeSourceIds.has(item.sourceId))
  }, [activeModeId, activeSourceIds, currentWeekStart, dayRangeLength, events, slotMinutes])

  const visibleItems = items

  const interactionItemMap = useMemo(() => {
    const map = new Map<string, TimeItem>()
    for (const item of visibleItems) {
      const interactionId = getTimeItemInteractionId(item)
      const existing = map.get(interactionId)
      if (!existing || item.isStartSegment) {
        map.set(interactionId, item)
      }
    }
    return map
  }, [visibleItems])

  const dayColumnWeights = useMemo(() => {
    const usedDayIndexes = new Set(visibleItems.map((item) => item.dayIndex))
    const todayStart = startOfDay(nowTick)

    const weights = weekDays.map((day, dayIndex): number => {
      if (!visibleDayIndexSet.has(dayIndex)) return 0
      const isPastDay = startOfDay(day).getTime() < todayStart.getTime()
      const isUnusedDay = !usedDayIndexes.has(dayIndex)

      if (isUnusedDay) return 0.5
      if (isPastDay) return 0.7
      return 1
    })

    const totalBaseline = visibleDayIndexes.length
    let remainingSavedWidth = Math.max(
      0,
      totalBaseline - weights.reduce((sum, weight) => sum + weight, 0)
    )

    const activeDayIndex = weekDays.findIndex((day, dayIndex) => visibleDayIndexSet.has(dayIndex) && isSameDay(day, nowTick))
    if (activeDayIndex >= 0 && remainingSavedWidth > 0) {
      const activeDayBoost = Math.min(0.5, remainingSavedWidth)
      weights[activeDayIndex] += activeDayBoost
      remainingSavedWidth -= activeDayBoost
    }

    const redistributionIndexes = visibleDayIndexes.filter((index) => index !== activeDayIndex)

    if (remainingSavedWidth > 0 && redistributionIndexes.length > 0) {
      const perDayExtra = remainingSavedWidth / redistributionIndexes.length
      redistributionIndexes.forEach((index) => {
        weights[index] += perDayExtra
      })
    }

    return weights
  }, [nowTick, visibleDayIndexSet, visibleDayIndexes, visibleItems, weekDays])

  const activeTimezones = useMemo(
    () => [tzState.primary, ...tzState.additional],
    [tzState.primary, tzState.additional]
  )
  const dstTransitions = useMemo(
    () => detectDstTransitions(activeTimezones, visibleDays).map((transition) => ({
      ...transition,
      transitionDayIndex: visibleDayIndexes[transition.transitionDayIndex] ?? transition.transitionDayIndex,
    })),
    [activeTimezones, visibleDayIndexes, visibleDays]
  )
  const weekGridTemplateColumns = useMemo(() => {
    const dayTracks = visibleDayIndexes
      .map((dayIndex) => {
        const weight = dayColumnWeights[dayIndex] ?? 1
        const transitionTracks = dstTransitions.filter((transition) => transition.transitionDayIndex === dayIndex)
          .map(() => '54px ').join('')
        return `${transitionTracks}minmax(0, ${weight.toFixed(4)}fr)`
      })
      .join(' ')
    return `repeat(${tzState.all.length}, 54px) ${dayTracks}`
  }, [dayColumnWeights, dstTransitions, tzState.all.length, visibleDayIndexes])

  const slotsPerDay = MINUTES_IN_DAY / slotMinutes
  const dayHeight = slotsPerDay * SLOT_HEIGHT
  const isQuarterHourGrid = slotMinutes === 15
  const hourBlockHeight = SLOT_HEIGHT * 4
  const currentMinuteUtc = nowTick.getUTCHours() * 60 + nowTick.getUTCMinutes()
  const currentTimeIndicatorTop = (currentMinuteUtc / slotMinutes) * SLOT_HEIGHT
  const timezoneColumnsWidth = tzState.all.length * 54
  const firstVisibleDay = visibleDays[0] ?? weekDays[0]
  const timezoneGridColumns = useMemo(() => activeTimezones.map((iana) => ({
    iana,
    abbreviation: getTimezoneAbbrOnDate(iana, firstVisibleDay),
    labels: Array.from({ length: slotsPerDay }, (_, index) => {
      const minute = index * slotMinutes
      return { minute, time: formatAdjustedTimeLabel({ day: firstVisibleDay, minute, iana }) }
    }),
  })), [activeTimezones, firstVisibleDay, slotMinutes, slotsPerDay])
  const dstGridColumns = useMemo(() => dstTransitions.map((transition) => {
    const day = weekDays[transition.transitionDayIndex]
    const beforeDay = weekDays[transition.transitionDayIndex - 1]
    const city = findTimezone(transition.iana)?.city ?? transition.iana
    const offsetLabel = `${transition.offsetBefore >= 0 ? '+' : ''}${transition.offsetBefore / 60} to ${transition.offsetAfter >= 0 ? '+' : ''}${transition.offsetAfter / 60}`
    return {
      ...transition,
      city,
      offsetLabel,
      description: `${city} clock change on ${format(day, 'EEE d MMM')}: GMT ${offsetLabel} (${transition.abbrBefore} to ${transition.abbrAfter})`,
      labels: Array.from({ length: slotsPerDay }, (_, index) => {
        const minute = index * slotMinutes
        const time = formatAdjustedTimeLabel({ day, minute, iana: transition.iana })
        const beforeTime = formatAdjustedTimeLabel({ day: beforeDay, minute, iana: transition.iana })
        return { minute, time, changed: time !== beforeTime }
      }),
    }
  }), [dstTransitions, slotMinutes, slotsPerDay, weekDays])
  const timeBackgroundSegments = useMemo(
    () =>
      timeBackgrounds.flatMap((period) =>
        getTimeBackgroundSegments(period).map((segment, index) => ({
          key: `${period.id}-${index}`,
          startMinute: segment.startMinute,
          endMinute: segment.endMinute,
          color: period.color,
          opacity: period.opacity,
        }))
      ),
    [timeBackgrounds]
  )

  const weekRangeLabel = useMemo(() => {
    const rangeStart = visibleDays[0] ?? currentWeekStart
    const rangeEnd = visibleDays[visibleDays.length - 1] ?? addDays(currentWeekStart, 6)
    if (isSameDay(rangeStart, rangeEnd)) {
      return format(rangeStart, 'EEE, MMM d, yyyy')
    }
    const sameMonth = format(rangeStart, 'MMM yyyy') === format(rangeEnd, 'MMM yyyy')
    if (sameMonth) {
      return `${format(rangeStart, 'MMM d')} - ${format(rangeEnd, 'd, yyyy')}`
    }
    return `${format(rangeStart, 'MMM d')} - ${format(rangeEnd, 'MMM d, yyyy')}`
  }, [currentWeekStart, visibleDays])

  const isMultiWeekView = visibleDayIndexes.length > 7
  const calendarGridMinWidth = isMultiWeekView
    ? `${(tzState.all.length + dstGridColumns.length) * 54 + visibleDayIndexes.length * MULTI_WEEK_MIN_DAY_WIDTH_PX}px`
    : dstGridColumns.length > 0
      ? `${(tzState.all.length + dstGridColumns.length) * 54 + visibleDayIndexes.length * 40}px`
      : undefined
  const [calendarHorizontalScrollElement, setCalendarHorizontalScrollElement] = useState<HTMLDivElement | null>(null)
  const calendarHorizontalScrollRef = useCallback((element: HTMLDivElement | null) => {
    setCalendarHorizontalScrollElement(element)
  }, [])

  useEffect(() => {
    const container = calendarHorizontalScrollElement
    if (!container || !isMultiWeekView) return
    const handleHeaderWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      if (!(event.target instanceof Element) || !event.target.closest('[data-testid^="calendar-header-"]')) return
      const maxScrollLeft = container.scrollWidth - container.clientWidth
      if (maxScrollLeft <= 0) return
      event.preventDefault()
      const deltaPx = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
      // Over the day header, wheel down moves toward earlier days (left) and wheel up toward later days (right).
      container.scrollLeft = Math.min(maxScrollLeft, Math.max(0, container.scrollLeft - deltaPx))
    }
    container.addEventListener('wheel', handleHeaderWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleHeaderWheel)
  }, [calendarHorizontalScrollElement, isMultiWeekView])

  const isCalendarHorizontallyScrollable = calendarGridMinWidth !== undefined
  const isDayColumnsHoveredRef = useRef(false)
  const syncDayScrollHintRef = useRef<() => void>(() => undefined)
  useEffect(() => {
    const container = calendarHorizontalScrollElement
    if (!container || !isCalendarHorizontallyScrollable) return
    // Scroll offsets, edge flags and the hover hint are written straight to the DOM (CSS variables
    // plus data attributes read by group-data variants) so scrolling and hovering never re-render
    // the calendar.
    const updateEdges = () => {
      const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth)
      const scrollLeft = Math.min(maxScrollLeft, Math.max(0, container.scrollLeft))
      container.style.setProperty('--tm-day-scroll-left', `${scrollLeft}px`)
      container.style.setProperty('--tm-day-scroll-right', `${maxScrollLeft - scrollLeft}px`)
      const canScrollLeft = scrollLeft > 1
      const canScrollRight = scrollLeft < maxScrollLeft - 1
      container.dataset.canScrollLeft = String(canScrollLeft)
      container.dataset.canScrollRight = String(canScrollRight)
      if (isMultiWeekView && isDayColumnsHoveredRef.current && (canScrollLeft || canScrollRight)) {
        container.dataset.dayScrollHint = 'on'
      } else {
        delete container.dataset.dayScrollHint
      }
    }
    syncDayScrollHintRef.current = updateEdges
    updateEdges()
    container.addEventListener('scroll', updateEdges, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateEdges)
    observer?.observe(container)
    if (container.firstElementChild) observer?.observe(container.firstElementChild)
    return () => {
      container.removeEventListener('scroll', updateEdges)
      observer?.disconnect()
      syncDayScrollHintRef.current = () => undefined
      container.style.removeProperty('--tm-day-scroll-left')
      container.style.removeProperty('--tm-day-scroll-right')
      delete container.dataset.canScrollLeft
      delete container.dataset.canScrollRight
      delete container.dataset.dayScrollHint
    }
  }, [calendarHorizontalScrollElement, isCalendarHorizontallyScrollable, isMultiWeekView])
  const handleCalendarDayHover = (event: MouseEvent<HTMLDivElement>) => {
    const isOverDay = isMultiWeekView
      && event.target instanceof Element
      && Boolean(event.target.closest('[data-time-management-day-index], [data-calendar-day-header]'))
    if (isOverDay === isDayColumnsHoveredRef.current) return
    isDayColumnsHoveredRef.current = isOverDay
    syncDayScrollHintRef.current()
  }
  const handleCalendarDayHoverEnd = () => {
    if (!isDayColumnsHoveredRef.current) return
    isDayColumnsHoveredRef.current = false
    syncDayScrollHintRef.current()
  }
  const pinnedTimezoneColumnClass = isCalendarHorizontallyScrollable
    ? 'relative z-25 translate-x-(--tm-day-scroll-left) bg-card'
    : ''
  const dayScrollHintTintClass = 'group-data-[day-scroll-hint=on]/day-scroll:bg-linear-to-b group-data-[day-scroll-hint=on]/day-scroll:from-primary-subtle group-data-[day-scroll-hint=on]/day-scroll:to-primary-subtle'

  const canZoomTimeIn = canStepZoomLevel(TIME_ZOOM_LEVELS, slotMinutes, -1)
  const canZoomTimeOut = canStepZoomLevel(TIME_ZOOM_LEVELS, slotMinutes, 1)
  const canZoomDaysIn = canStepZoomLevel(DAY_ZOOM_LEVELS, dayZoomLevel, -1)
  const canZoomDaysOut = canStepZoomLevel(DAY_ZOOM_LEVELS, dayZoomLevel, 1)
  const navigationPeriodLabel = navigationWeekStep === 1 ? 'week' : `${navigationWeekStep} weeks`

  const selectedItem = useMemo(
    () => {
      if (!selectedItemId) return null
      return interactionItemMap.get(selectedItemId)
        || items.find((item) => item.id === selectedItemId)
        || null
    },
    [interactionItemMap, items, selectedItemId]
  )

  const selectedEvent = useMemo(
    () => {
      if (!selectedItem) return null
      return events.find((event) => event.id === selectedItem.sourceEventId) || null
    },
    [events, selectedItem]
  )

  useEffect(() => {
    selectedEventIdRef.current = selectedEvent?.id ?? null
  }, [selectedEvent?.id])

  useEffect(() => {
    isAutoSavingRef.current = isAutoSaving
  }, [isAutoSaving])

  const movingItemIsRecurring = useMemo(() => {
    if (!movingItemId) return false
    const moving = interactionItemMap.get(movingItemId)
      || items.find((item) => item.id === movingItemId)
      || (movingItemSnapshot?.id === movingItemId ? movingItemSnapshot : null)
    if (!moving) return false
    const source = events.find((event) => event.id === moving.sourceEventId)
    return Boolean(source?.recurrence_rule && source.recurrence_rule.type !== 'none' && source.recurrence_rule.endType !== 'whenCompleted')
  }, [events, interactionItemMap, items, movingItemId, movingItemSnapshot])

  const draggingItem = useMemo(
    () => {
      if (!draggingItemId) return null
      return interactionItemMap.get(draggingItemId)
        || items.find((item) => item.id === draggingItemId)
        || null
    },
    [draggingItemId, interactionItemMap, items]
  )

  const canCreateMoreModes = modes.length < MAX_MODE_COUNT
  const activeMode = useMemo(
    () => modes.find((mode) => mode.id === activeModeId) || null,
    [activeModeId, modes]
  )
  const trimmedModeNameDraft = modeNameDraft.trim()
  const hasModeNameValue = trimmedModeNameDraft.length > 0
  const hasModeNameChanged = Boolean(activeMode && hasModeNameValue && activeMode.name.trim() !== trimmedModeNameDraft)
  const canSaveModeName = !isRenamingMode && hasModeNameChanged

  // Signal for the Delete Mode panel: numeric counts of data that would be lost/moved
  // for the currently active mode, so users can judge whether deleting is safe.
  const activeModeDeleteStats = useMemo(() => {
    if (!activeModeId) return null
    const itemCount = events.filter(
      (event) => event.source_type === 'manual' && event.source_id === activeModeId
    ).length
    const categoryCount = categories.length
    const quickTemplateCount = quickTemplates.length
    const timeBackgroundCount = timeBackgrounds.length
    const externalSourceCount = syncCalendars.filter((source) => source.sourceType === 'external').length
    const hasAnyData =
      itemCount > 0 || categoryCount > 0 || quickTemplateCount > 0 || timeBackgroundCount > 0 || externalSourceCount > 0

    return { itemCount, categoryCount, quickTemplateCount, timeBackgroundCount, externalSourceCount, hasAnyData }
  }, [activeModeId, categories.length, events, quickTemplates.length, syncCalendars, timeBackgrounds.length])

  const modeJsonExportText = useMemo(() => {
    if (!activeModeId) return ''
    const currentMode = modes.find((mode) => mode.id === activeModeId)
    if (!currentMode) return ''
    return JSON.stringify(
      buildModeJsonPayload({
        mode: currentMode,
        syncCalendars,
        categories,
        timeBackgrounds,
        collapsedBackgroundIds,
        quickTemplates,
        showQuickTemplatesInMain,
      }),
      null,
      2
    )
  }, [
    activeModeId,
    categories,
    collapsedBackgroundIds,
    modes,
    quickTemplates,
    showQuickTemplatesInMain,
    syncCalendars,
    timeBackgrounds,
  ])

  const promptRenameForMode = useCallback((nextModeName: string) => {
    setIsModeSettingsOpen(true)
    setModeNameDraft(nextModeName)

    setIsModeNameInputHighlighted(true)
    if (modeNameInputHighlightTimerRef.current !== null) {
      window.clearTimeout(modeNameInputHighlightTimerRef.current)
    }
    modeNameInputHighlightTimerRef.current = window.setTimeout(() => {
      setIsModeNameInputHighlighted(false)
      modeNameInputHighlightTimerRef.current = null
    }, 1800)

    window.requestAnimationFrame(() => {
      const input = modeNameInputRef.current
      if (!input) return
      input.focus()
      input.setSelectionRange(0, input.value.length)
    })
  }, [])

  useEffect(() => {
    if (!activeModeId) return

    setHighlightedModeId(activeModeId)
    if (highlightedModeTimerRef.current !== null) {
      window.clearTimeout(highlightedModeTimerRef.current)
    }

    highlightedModeTimerRef.current = window.setTimeout(() => {
      setHighlightedModeId((prev) => (prev === activeModeId ? null : prev))
      highlightedModeTimerRef.current = null
    }, 1200)
  }, [activeModeId])

  // Keep the Settings "Mode name" draft in sync with whichever mode is now active
  // (e.g. after creating/activating/switching a mode), so it never shows a stale name.
  useEffect(() => {
    if (!activeModeId) return
    const current = modes.find((mode) => mode.id === activeModeId)
    if (current) {
      setModeNameDraft(current.name)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only resync when the active mode itself changes, not on every `modes` update
  }, [activeModeId])

  const pendingTemplateSourceItem = useMemo(() => {
    if (!pendingTemplateSourceId) return null
    return interactionItemMap.get(pendingTemplateSourceId)
      || items.find((item) => item.id === pendingTemplateSourceId)
      || null
  }, [interactionItemMap, items, pendingTemplateSourceId])

  const dayLayouts = useMemo(() => {
    return weekDays.map((day, dayIndex) => {
      const dayItems = visibleItems
        .filter((item) => item.dayIndex === dayIndex)
        .sort((a, b) => a.startMinute - b.startMinute)

      if (dayItems.length === 0) {
        return { eventSegments: [], overflowSegments: [] as ReturnType<typeof computeDayLayout>['overflowSegments'] }
      }

      const dayStartMs = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), START_HOUR, 0, 0)
      const dayEndMs = dayStartMs + MINUTES_IN_DAY * 60 * 1000

      const toLayoutEvents = (sourceItems: TimeItem[]): LayoutEvent[] =>
        sourceItems.map((item) => {
          const startMs = dayStartMs + item.startMinute * 60 * 1000
          const endMs = startMs + item.durationMinutes * 60 * 1000
          return {
            id: item.id,
            start_time: new Date(startMs).toISOString(),
            end_time: new Date(Math.min(endMs, dayEndMs)).toISOString(),
          }
        })

      return computeDayLayout(toLayoutEvents(dayItems), dayStartMs, dayEndMs, SLOT_HEIGHT, slotMinutes * 60 * 1000)
    })
  }, [slotMinutes, visibleItems, weekDays])

  const itemMap = useMemo(() => {
    const map = new Map<string, TimeItem>()
    for (const item of visibleItems) {
      map.set(item.id, item)
    }
    return map
  }, [visibleItems])

  const sourceMap = useMemo(() => {
    const map = new Map<string, SyncCalendar>()
    for (const source of syncCalendars) {
      map.set(source.id, source)
    }
    return map
  }, [syncCalendars])

  const activeMainSourceId = MAIN_SOURCE_ID

  const dayResizeSegments = useMemo(() => {
    return weekDays.map((_, dayIndex) => {
      const layout = dayLayouts[dayIndex]

      // An item split into slices by overlapping events must only expose its
      // outward-facing edges as resize targets: the start edge lives on the
      // first slice's top, the end edge on the last connected slice's bottom.
      // Internal boundaries between touching slices of the same item are not
      // draggable (this mirrors where the resize handles are rendered).
      const segmentIndicesByEvent = new Map<string, number[]>()
      layout.eventSegments.forEach((segment, segmentIndex) => {
        const bucket = segmentIndicesByEvent.get(segment.eventId)
        if (bucket) {
          bucket.push(segmentIndex)
          return
        }
        segmentIndicesByEvent.set(segment.eventId, [segmentIndex])
      })

      const hasConnectedBottomByIndex = new Map<number, boolean>()
      for (const indices of segmentIndicesByEvent.values()) {
        const sorted = [...indices].sort((a, b) => layout.eventSegments[a].top - layout.eventSegments[b].top)
        for (let order = 0; order < sorted.length; order += 1) {
          const current = layout.eventSegments[sorted[order]]
          const next = order < sorted.length - 1 ? layout.eventSegments[sorted[order + 1]] : null
          const currentBottom = current.top + current.height
          hasConnectedBottomByIndex.set(
            sorted[order],
            Boolean(next) && Math.abs(currentBottom - (next?.top ?? 0)) < 0.5
          )
        }
      }

      return layout.eventSegments
        .map((segment, segmentIndex) => {
          const item = itemMap.get(segment.eventId)
          if (!item) return null
          const source = sourceMap.get(item.sourceId)
          if (isReadOnlySource(source)) return null

          return {
            itemId: getTimeItemInteractionId(item),
            top: segment.top,
            bottom: segment.top + segment.height,
            leftPercent: segment.leftPercent + DAY_COLUMN_ITEM_GUTTER_PERCENT,
            widthPercent: Math.max(segment.widthPercent - DAY_COLUMN_ITEM_GUTTER_PERCENT * 2, 8),
            canResizeStart: item.isStartSegment && segment.isFirstSegment,
            canResizeEnd: item.isEndSegment && !(hasConnectedBottomByIndex.get(segmentIndex) ?? false),
          }
        })
        .filter(
          (segment): segment is {
            itemId: string
            top: number
            bottom: number
            leftPercent: number
            widthPercent: number
            canResizeStart: boolean
            canResizeEnd: boolean
          } =>
            Boolean(segment)
        )
    })
  }, [dayLayouts, itemMap, sourceMap, weekDays])

  const handleActivateMode = useCallback(async (nextModeId: string): Promise<boolean> => {
    if (!nextModeId) return false
    if (nextModeId === activeModeId) return true

    try {
      await apiClient.post(`/api/time-management/modes/${nextModeId}/activate`)
      const nextMode = modes.find((mode) => mode.id === nextModeId)
      if (!nextMode) {
        setActiveModeId(nextModeId)
        return true
      }

      setActiveModeId(nextModeId)
      setPrefs(buildModePrefs(nextMode))

      if (isTimeWidth(nextMode.slot_minutes)) {
        setSlotMinutes(nextMode.slot_minutes)
      }

      const modeTimeBackgrounds = Array.isArray(nextMode.time_backgrounds)
        ? nextMode.time_backgrounds
            .map((period) => normaliseStoredTimeBackground(period))
            .filter((period): period is TimeBackgroundPeriod => Boolean(period))
        : []

      const nextCollapsedBackgroundIds = Array.isArray(nextMode.collapsed_background_ids)
        ? nextMode.collapsed_background_ids.filter(
            (id): id is string =>
              typeof id === 'string' && modeTimeBackgrounds.some((period) => period.id === id)
          )
        : []

      const resolvedModeVisuals = resolveModeVisualState(
        nextMode,
        modeTimeBackgrounds,
        nextCollapsedBackgroundIds
      )
      setTimeBackgrounds(resolvedModeVisuals.timeBackgrounds)
      setCollapsedBackgroundIds(new Set(resolvedModeVisuals.collapsedBackgroundIds))

      const modeQuickTemplates = Array.isArray(nextMode.quick_templates)
        ? nextMode.quick_templates
            .map((template) => normaliseStoredQuickTemplate(template))
            .filter((template): template is QuickTemplate => Boolean(template))
        : []
      setQuickTemplates(modeQuickTemplates)
      setShowQuickTemplatesInMain(resolveShowQuickTemplatesInMain(nextMode.show_quick_templates_in_main))

      const modeSyncCalendars = Array.isArray(nextMode.sync_calendars)
        ? nextMode.sync_calendars
            .map((source) => normaliseStoredSyncCalendar(source))
            .filter((source): source is SyncCalendar => Boolean(source))
        : []
      const modeSyncById = new Map(modeSyncCalendars.map((source) => [source.id, source]))
      const modeMainSource =
        modeSyncById.get(MAIN_SOURCE_ID) ||
        modeSyncById.get(nextMode.id) ||
        modeSyncCalendars.find((source) => source.sourceType === 'app')

      setSyncCalendars((prev) => {
        const previousMainSource = prev.find((entry) => entry.id === MAIN_SOURCE_ID)
        const mergedExternalSources = new Map<string, SyncCalendar>()
        for (const source of prev.filter((entry) => entry.sourceType === 'external')) {
          mergedExternalSources.set(source.id, source)
        }
        for (const source of modeSyncCalendars.filter((entry) => entry.sourceType === 'external')) {
          mergedExternalSources.set(
            source.id,
            mergeModeExternalSource({
              existingSource: mergedExternalSources.get(source.id),
              modeSource: source,
              enabledFromMode: modeSyncById.has(source.id)
                ? Boolean(modeSyncById.get(source.id)?.enabled)
                : source.enabled,
            })
          )
        }

        const appSources = buildAppSyncSourcesForMode({
          allModes: modes,
          activeModeId: nextMode.id,
          activeModeName: nextMode.name?.trim() || 'Coordination Manager Main',
          activeModeColor: isHexColor(nextMode.main_color) ? nextMode.main_color : '#2563eb',
          modeSyncById,
          previousSources: prev,
          mainEnabled: modeMainSource ? Boolean(modeMainSource.enabled) : (previousMainSource?.enabled ?? true),
        })

        return [
          ...appSources,
          ...Array.from(mergedExternalSources.values()),
        ]
      })
      return true
    } catch (err) {
      console.error('Failed to activate mode:', err)
      setClipboardStatus('Could not switch mode. Try again.')
      return false
    }
  }, [activeModeId, modes])

  const handleCreateMode = useCallback(async (): Promise<boolean> => {
    if (isCreatingMode) return false
    if (modes.length >= MAX_MODE_COUNT) {
      setClipboardStatus(`You can create up to ${MAX_MODE_COUNT} modes.`)
      return false
    }

    const suggestedName = getSuggestedModeName(modes)

    setIsCreatingMode(true)
    try {
      const { data } = await apiClient.post<{ mode?: TimeManagementMode; activeModeId?: string }>('/api/time-management/modes', {
        name: suggestedName,
      })
      const createdMode = data?.mode
      const nextActiveModeId = data?.activeModeId || createdMode?.id || null
      if (createdMode) {
        setModes((prev) => [...prev, createdMode])
      }
      if (nextActiveModeId) {
        await handleActivateMode(nextActiveModeId)
      }
      setClipboardStatus('Mode created.')
      return Boolean(createdMode)
    } catch (err) {
      console.error('Failed to create mode:', err)
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Could not create mode.'
      setClipboardStatus(msg)
      return false
    } finally {
      setIsCreatingMode(false)
    }
  }, [handleActivateMode, isCreatingMode, modes])

  const handleDuplicateMode = useCallback(async () => {
    if (!activeModeId || isDuplicatingMode || isCreatingMode) return
    if (modes.length >= MAX_MODE_COUNT) {
      setClipboardStatus(`You can create up to ${MAX_MODE_COUNT} modes.`)
      return
    }

    const currentMode = modes.find((mode) => mode.id === activeModeId)
    if (!currentMode) {
      setClipboardStatus('No active mode to duplicate.')
      return
    }

    const suggestedName = getSuggestedModeName(modes)
    const duplicatePayload = buildModeJsonPayload({
      mode: currentMode,
      syncCalendars,
      categories,
      timeBackgrounds,
      collapsedBackgroundIds,
      quickTemplates,
      showQuickTemplatesInMain,
    })

    setIsDuplicatingMode(true)
    try {
      const { data } = await apiClient.post<{ mode?: TimeManagementMode; activeModeId?: string }>('/api/time-management/modes', {
        name: suggestedName,
        importMode: {
          ...duplicatePayload,
          name: suggestedName,
        },
      })

      const createdMode = data?.mode
      const nextActiveModeId = data?.activeModeId || createdMode?.id || null
      if (createdMode) {
        setModes((prev) => [...prev, createdMode])
      }
      if (nextActiveModeId) {
        await handleActivateMode(nextActiveModeId)
      }

      promptRenameForMode(createdMode?.name || suggestedName)
      setClipboardStatus('Mode duplicated.')
    } catch (err) {
      console.error('Failed to duplicate mode:', err)
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Could not duplicate mode.'
      setClipboardStatus(msg)
    } finally {
      setIsDuplicatingMode(false)
    }
  }, [
    activeModeId,
    categories,
    collapsedBackgroundIds,
    handleActivateMode,
    isCreatingMode,
    isDuplicatingMode,
    modes,
    promptRenameForMode,
    quickTemplates,
    showQuickTemplatesInMain,
    syncCalendars,
    timeBackgrounds,
  ])

  const handleImportMode = useCallback(async () => {
    if (isCreatingMode || isImportingModeJson) return
    setModeJsonImportDraft('')
    setIsModeJsonImportOpen(true)
  }, [isCreatingMode, isImportingModeJson])

  const handleSubmitModeJsonImport = useCallback(async () => {
    if (isImportingModeJson) return
    const raw = modeJsonImportDraft.trim()
    if (!raw) {
      setClipboardStatus('Paste Mode JSON first.')
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      setClipboardStatus('Invalid JSON. Fix format and try again.')
      return
    }

    if (!parsed || typeof parsed !== 'object') {
      setClipboardStatus('Invalid Mode JSON payload.')
      return
    }

    const payload = parsed as Record<string, unknown>
    const modeName = typeof payload.name === 'string' && payload.name.trim().length > 0
      ? payload.name.trim()
      : 'Imported Mode'

    const importedSyncRaw = Array.isArray(payload.sync_calendars)
      ? (payload.sync_calendars as unknown[])
      : Array.isArray(payload.syncCalendars)
        ? (payload.syncCalendars as unknown[])
        : []

    const remappedSyncCalendars: SyncCalendar[] = []
    let matchedExternalCount = 0
    let unmatchedExternalCount = 0

    try {
      const sourcesRes = await apiClient.get<{ sources: ConnectedCalendarSource[] }>('/api/calendar-sources')
      const currentSources = Array.isArray(sourcesRes.data?.sources)
        ? sourcesRes.data.sources.filter((source) => source.is_active)
        : []

      const oauthByEmail = new Map<string, ConnectedCalendarSource>()
      const publicByName = new Map<string, ConnectedCalendarSource>()
      for (const source of currentSources) {
        if (source.source_type === 'google_oauth' && source.google_email) {
          oauthByEmail.set(source.google_email.toLowerCase(), source)
        }
        if (source.source_type === 'google_public_url' && source.display_name) {
          publicByName.set(source.display_name.toLowerCase().trim(), source)
        }
      }

      for (const entry of importedSyncRaw) {
        if (!entry || typeof entry !== 'object') continue
        const candidate = entry as Record<string, unknown>
        const id = typeof candidate.id === 'string' ? candidate.id : ''
        if (!id) continue

        if (candidate.sourceType !== 'external') {
          remappedSyncCalendars.push({
            id,
            name: typeof candidate.name === 'string' ? candidate.name : 'Coordination Manager Main',
            color: isHexColor(candidate.color) ? candidate.color : '#2563eb',
            enabled: candidate.enabled !== false,
            sourceType: 'app',
          })
          continue
        }

        const externalKind = candidate.externalKind === 'google_oauth' || candidate.externalKind === 'google_public_url'
          ? candidate.externalKind
          : undefined
        if (!externalKind) continue

        const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
        const secondary = typeof candidate.secondaryLabel === 'string' ? candidate.secondaryLabel.trim() : ''

        let matchedSource: ConnectedCalendarSource | undefined
        if (externalKind === 'google_oauth' && secondary && secondary.toLowerCase() !== 'google calendar') {
          matchedSource = oauthByEmail.get(secondary.toLowerCase())
        }
        if (!matchedSource && externalKind === 'google_public_url' && name) {
          matchedSource = publicByName.get(name.toLowerCase())
        }
        if (!matchedSource && name) {
          matchedSource = currentSources.find(
            (source) =>
              source.source_type === externalKind &&
              (source.display_name || '').toLowerCase().trim() === name.toLowerCase()
          )
        }

        if (matchedSource) {
          remappedSyncCalendars.push({
            id: matchedSource.id,
            name: matchedSource.display_name,
            color: matchedSource.color || '#0f766e',
            enabled: true,
            sourceType: 'external',
            externalKind,
            secondaryLabel: matchedSource.source_type === 'google_oauth'
              ? matchedSource.google_email || 'Google Calendar'
              : 'Public URL',
          })
          matchedExternalCount++
        } else {
          unmatchedExternalCount++
        }
      }
    } catch (err) {
      console.error('Failed to load calendar sources during import:', err)
    }

    const importedCategoriesRaw = Array.isArray(payload.categories) ? (payload.categories as unknown[]) : []
    const importedCategories = importedCategoriesRaw
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null
        const c = entry as Record<string, unknown>
        const label = typeof c.label === 'string' ? c.label : ''
        if (!label.trim()) return null
        return {
          label,
          color: isHexColor(c.color) ? c.color : '#2563eb',
          fontColor: isHexColor(c.font_color)
            ? c.font_color
            : isHexColor(c.fontColor)
              ? c.fontColor
              : DEFAULT_CATEGORY_FONT_COLOR,
          sortOrder:
            typeof c.sort_order === 'number'
              ? c.sort_order
              : typeof c.sortOrder === 'number'
                ? c.sortOrder
                : 0,
        }
      })
      .filter((entry): entry is { label: string; color: string; fontColor: string; sortOrder: number } => Boolean(entry))

    const importMode = {
      name: modeName,
      mainColor: isHexColor(payload.main_color)
        ? payload.main_color
        : isHexColor(payload.mainColor)
          ? payload.mainColor
          : '#2563eb',
      slotMinutes: isTimeWidth(payload.slot_minutes)
        ? payload.slot_minutes
        : isTimeWidth(payload.slotMinutes)
          ? payload.slotMinutes
          : DEFAULT_SLOT_MINUTES,
      syncCalendars: remappedSyncCalendars,
      timeBackgrounds: Array.isArray(payload.time_backgrounds)
        ? payload.time_backgrounds
        : Array.isArray(payload.timeBackgrounds)
          ? payload.timeBackgrounds
          : [],
      collapsedBackgroundIds: Array.isArray(payload.collapsed_background_ids)
        ? payload.collapsed_background_ids
        : Array.isArray(payload.collapsedBackgroundIds)
          ? payload.collapsedBackgroundIds
          : [],
      quickTemplates: Array.isArray(payload.quick_templates)
        ? payload.quick_templates
        : Array.isArray(payload.quickTemplates)
          ? payload.quickTemplates
          : [],
      showQuickTemplatesInMain: resolveShowQuickTemplatesInMain(
        payload.show_quick_templates_in_main ?? payload.showQuickTemplatesInMain
      ),
      categoryColorDisplayStyle: normaliseCategoryColorDisplayStyle(
        payload.category_color_display_style ?? payload.categoryColorDisplayStyle
      ),
      categories: importedCategories,
    }

    setIsImportingModeJson(true)
    try {
      const { data } = await apiClient.post<{ mode?: TimeManagementMode; activeModeId?: string }>('/api/time-management/modes', {
        name: modeName,
        importMode,
      })
      const createdMode = data?.mode
      const nextActiveModeId = data?.activeModeId || createdMode?.id || null
      if (createdMode) {
        setModes((prev) => [...prev, createdMode])
      }
      if (nextActiveModeId) {
        await handleActivateMode(nextActiveModeId)
      }
      await fetchConnectedCalendars()
      setIsModeJsonImportOpen(false)
      setModeJsonImportDraft('')

      const renamed = createdMode && createdMode.name !== modeName
      const renameInfo = renamed ? ` (saved as "${createdMode!.name}")` : ''
      const calendarInfo = matchedExternalCount > 0 || unmatchedExternalCount > 0
        ? ` Connected ${matchedExternalCount} calendar${matchedExternalCount === 1 ? '' : 's'}${
            unmatchedExternalCount > 0
              ? `; ${unmatchedExternalCount} not found in your account`
              : ''
          }.`
        : ''
      setClipboardStatus(`Mode JSON imported.${renameInfo}${calendarInfo}`)
    } catch (err) {
      console.error('Failed to import mode JSON:', err)
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Could not import mode JSON.'
      setClipboardStatus(msg)
    } finally {
      setIsImportingModeJson(false)
    }
  }, [fetchConnectedCalendars, handleActivateMode, isImportingModeJson, modeJsonImportDraft])

  const handleExportCurrentModeJson = useCallback(async () => {
    if (!activeModeId || !modeJsonExportText) {
      setClipboardStatus('No active mode to export.')
      return
    }

    setModeJsonCopyFeedback(null)
    setIsModeJsonExportOpen(true)
  }, [activeModeId, modeJsonExportText])

  const showModeJsonCopyFeedback = useCallback((message: string) => {
    setModeJsonCopyFeedback(message)

    if (modeJsonCopyFeedbackTimerRef.current !== null) {
      window.clearTimeout(modeJsonCopyFeedbackTimerRef.current)
    }

    modeJsonCopyFeedbackTimerRef.current = window.setTimeout(() => {
      setModeJsonCopyFeedback((prev) => (prev === message ? null : prev))
      modeJsonCopyFeedbackTimerRef.current = null
    }, 2200)
  }, [])

  useEffect(() => {
    return () => {
      if (modeJsonCopyFeedbackTimerRef.current !== null) {
        window.clearTimeout(modeJsonCopyFeedbackTimerRef.current)
      }
      if (modeNameSaveFeedbackTimerRef.current !== null) {
        window.clearTimeout(modeNameSaveFeedbackTimerRef.current)
      }
      if (modeNameNoChangePulseTimerRef.current !== null) {
        window.clearTimeout(modeNameNoChangePulseTimerRef.current)
      }
      if (highlightedModeTimerRef.current !== null) {
        window.clearTimeout(highlightedModeTimerRef.current)
      }
      if (modeNameInputHighlightTimerRef.current !== null) {
        window.clearTimeout(modeNameInputHighlightTimerRef.current)
      }
    }
  }, [])

  const handleRenameCurrentMode = useCallback(async () => {
    if (!activeModeId || isRenamingMode) return
    const trimmed = modeNameDraft.trim()
    if (!trimmed) {
      setClipboardStatus('Mode name is required.')
      return
    }

    const currentMode = modes.find((mode) => mode.id === activeModeId)
    if (currentMode && currentMode.name === trimmed) return

    setIsRenamingMode(true)
    try {
      const { data } = await apiClient.put<{ mode?: TimeManagementMode }>(`/api/time-management/modes/${activeModeId}`, { name: trimmed })
      const updatedMode = data?.mode
      if (updatedMode) {
        setModes((prev) => prev.map((mode) => (mode.id === updatedMode.id ? updatedMode : mode)))
      } else {
        setModes((prev) => prev.map((mode) => (mode.id === activeModeId ? { ...mode, name: trimmed } : mode)))
      }
      setPrefs((prev) => ({ ...prev, main_label: trimmed }))
      setClipboardStatus('Mode renamed.')
    } catch (err) {
      console.error('Failed to rename mode:', err)
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Could not rename mode.'
      setClipboardStatus(msg)
    } finally {
      setIsRenamingMode(false)
    }
  }, [activeModeId, isRenamingMode, modeNameDraft, modes])

  const handleSaveModeNameClick = useCallback(() => {
    if (isRenamingMode) return

    if (!hasModeNameValue) {
      setClipboardStatus('Mode name is required.')
      return
    }

    if (!hasModeNameChanged) {
      setIsModeNameSaveNoChangePulse(true)
      if (modeNameNoChangePulseTimerRef.current !== null) {
        window.clearTimeout(modeNameNoChangePulseTimerRef.current)
      }
      modeNameNoChangePulseTimerRef.current = window.setTimeout(() => {
        setIsModeNameSaveNoChangePulse(false)
        modeNameNoChangePulseTimerRef.current = null
      }, 420)

      const message = 'no changes were made to Mode Name, save skipped'
      setModeNameSaveFeedback(message)
      if (modeNameSaveFeedbackTimerRef.current !== null) {
        window.clearTimeout(modeNameSaveFeedbackTimerRef.current)
      }
      modeNameSaveFeedbackTimerRef.current = window.setTimeout(() => {
        setModeNameSaveFeedback((prev) => (prev === message ? null : prev))
        modeNameSaveFeedbackTimerRef.current = null
      }, 2600)
      return
    }

    setModeNameSaveFeedback(null)
    void handleRenameCurrentMode()
  }, [hasModeNameChanged, hasModeNameValue, handleRenameCurrentMode, isRenamingMode])

  useEffect(() => {
    if (hasModeNameChanged) {
      setModeNameSaveFeedback(null)
    }
  }, [hasModeNameChanged, modeNameDraft])

  const handleDeleteCurrentMode = useCallback(async (transferToModeId: string | null) => {
    if (!activeModeId || modes.length <= 1) return

    try {
      const payload = transferToModeId
        ? { transfer_to_mode_id: transferToModeId }
        : { delete_items: true }
      await apiClient.delete(`/api/time-management/modes/${activeModeId}`, { data: payload })
      const { data } = await dedupedGet<{ activeModeId?: string; active_mode_id?: string; modes?: TimeManagementMode[] }>('/api/time-management/modes')
      const nextModes = Array.isArray(data?.modes) ? data.modes : []
      setModes(nextModes)
      const nextActiveModeId = typeof data?.activeModeId === 'string'
        ? data.activeModeId
        : typeof data?.active_mode_id === 'string'
          ? data.active_mode_id
          : nextModes[0]?.id || null
      setActiveModeId(nextActiveModeId)

      const nextMode = nextActiveModeId
        ? nextModes.find((mode) => mode.id === nextActiveModeId) || null
        : null
      if (nextMode) {
        setPrefs(buildModePrefs(nextMode))
        if (isTimeWidth(nextMode.slot_minutes)) {
          setSlotMinutes(nextMode.slot_minutes)
        }

        const modeTimeBackgrounds = Array.isArray(nextMode.time_backgrounds)
          ? nextMode.time_backgrounds
              .map((period) => normaliseStoredTimeBackground(period))
              .filter((period): period is TimeBackgroundPeriod => Boolean(period))
          : []

        const nextCollapsedBackgroundIds = Array.isArray(nextMode.collapsed_background_ids)
          ? nextMode.collapsed_background_ids.filter(
              (id): id is string =>
                typeof id === 'string' && modeTimeBackgrounds.some((period) => period.id === id)
            )
          : []

        const resolvedModeVisuals = resolveModeVisualState(
          nextMode,
          modeTimeBackgrounds,
          nextCollapsedBackgroundIds
        )
        setTimeBackgrounds(resolvedModeVisuals.timeBackgrounds)
        setCollapsedBackgroundIds(new Set(resolvedModeVisuals.collapsedBackgroundIds))

        const modeQuickTemplates = Array.isArray(nextMode.quick_templates)
          ? nextMode.quick_templates
              .map((template) => normaliseStoredQuickTemplate(template))
              .filter((template): template is QuickTemplate => Boolean(template))
          : []
        setQuickTemplates(modeQuickTemplates)
        setShowQuickTemplatesInMain(resolveShowQuickTemplatesInMain(nextMode.show_quick_templates_in_main))

        const modeSyncCalendars = Array.isArray(nextMode.sync_calendars)
          ? nextMode.sync_calendars
              .map((source) => normaliseStoredSyncCalendar(source))
              .filter((source): source is SyncCalendar => Boolean(source))
          : []
        const modeSyncById = new Map(modeSyncCalendars.map((source) => [source.id, source]))
        const modeMainSource =
          modeSyncById.get(MAIN_SOURCE_ID) ||
          modeSyncById.get(nextMode.id) ||
          modeSyncCalendars.find((source) => source.sourceType === 'app')

        setSyncCalendars((prev) => {
          const previousMainSource = prev.find((entry) => entry.id === MAIN_SOURCE_ID)
          const mergedExternalSources = new Map<string, SyncCalendar>()
          for (const source of prev.filter((entry) => entry.sourceType === 'external')) {
            mergedExternalSources.set(source.id, source)
          }
          for (const source of modeSyncCalendars.filter((entry) => entry.sourceType === 'external')) {
            mergedExternalSources.set(
              source.id,
              mergeModeExternalSource({
                existingSource: mergedExternalSources.get(source.id),
                modeSource: source,
                enabledFromMode: modeSyncById.has(source.id)
                  ? Boolean(modeSyncById.get(source.id)?.enabled)
                  : source.enabled,
              })
            )
          }

          const appSources = buildAppSyncSourcesForMode({
            allModes: nextModes,
            activeModeId: nextMode.id,
            activeModeName: nextMode.name?.trim() || 'Coordination Manager Main',
            activeModeColor: isHexColor(nextMode.main_color) ? nextMode.main_color : '#2563eb',
            modeSyncById,
            previousSources: prev,
            mainEnabled: modeMainSource ? Boolean(modeMainSource.enabled) : (previousMainSource?.enabled ?? true),
          })

          return [
            ...appSources,
            ...Array.from(mergedExternalSources.values()),
          ]
        })
      }

      try {
        const eventsRes = await apiClient.get<{ events: UserEventRecord[] }>('/api/user-events')
        const fetchedEvents = Array.isArray(eventsRes.data?.events) ? eventsRes.data.events : []
        setEvents(fetchedEvents)
        setEventsError(null)
      } catch (eventsErr) {
        console.error('Failed to refresh events after deleting mode:', eventsErr)
      }

      setModeDeleteState({ open: false, action: null, transferToModeId: null })
      setIsModeSettingsOpen(false)
      setClipboardStatus(transferToModeId ? 'Mode deleted and calendar data moved.' : 'Mode deleted and calendar data removed.')
      await fetchConnectedCalendars()
    } catch (err) {
      console.error('Failed to delete mode:', err)
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Could not delete mode.'
      setClipboardStatus(msg)
    }
  }, [activeModeId, fetchConnectedCalendars, modes.length])

  const findEdgeResizeTarget = useCallback(
    (
      dayIndex: number,
      pointerX: number,
      pointerY: number,
      columnWidth: number
    ): { itemId: string; edge: 'start' | 'end' } | null => {
      const segments = dayResizeSegments[dayIndex] || []
      if (segments.length === 0) return null

      const candidates: Array<{
        itemId: string
        edge: 'start' | 'end'
        distance: number
        isActive: boolean
      }> = []

      for (const segment of segments) {
        const leftPx = (segment.leftPercent / 100) * columnWidth
        const widthPx = (segment.widthPercent / 100) * columnWidth
        const rightPx = leftPx + widthPx

        if (pointerX < leftPx - 4 || pointerX > rightPx + 4) {
          continue
        }

        const startDistance = Math.abs(pointerY - segment.top)
        if (segment.canResizeStart && startDistance <= EDGE_HIT_PX) {
          candidates.push({
            itemId: segment.itemId,
            edge: 'start',
            distance: startDistance,
            isActive: segment.itemId === selectedItemId,
          })
        }

        const endDistance = Math.abs(pointerY - segment.bottom)
        if (segment.canResizeEnd && endDistance <= EDGE_HIT_PX) {
          candidates.push({
            itemId: segment.itemId,
            edge: 'end',
            distance: endDistance,
            isActive: segment.itemId === selectedItemId,
          })
        }
      }

      if (candidates.length === 0) return null
      const hasActiveCandidate = candidates.some((candidate) => candidate.isActive)

      candidates.sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
        if (a.distance !== b.distance) return a.distance - b.distance
        if (!hasActiveCandidate && a.edge !== b.edge) return a.edge === 'end' ? -1 : 1
        if (a.edge !== b.edge) return a.edge === 'end' ? -1 : 1
        return 0
      })

      return { itemId: candidates[0].itemId, edge: candidates[0].edge }
    },
    [dayResizeSegments, selectedItemId]
  )

  const beginEdgeResize = useCallback((params: {
    itemId: string
    dayIndex: number
    edge: 'start' | 'end'
    dayColumnElement: HTMLDivElement
  }): boolean => {
    const { dayColumnElement, dayIndex, edge, itemId } = params
    const targetItem = items.find((candidate) => candidate.id === itemId)
    if (!targetItem) return false
    const eventRecord = targetItem ? events.find((candidate) => candidate.id === targetItem.sourceEventId) : null
    if (!eventRecord) return false

    const source = sourceMap.get(eventRecord.source_id || MAIN_SOURCE_ID)
    if (isReadOnlySource(source)) return false

    const start = new Date(eventRecord.start_time)
    const end = new Date(eventRecord.end_time)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false

    const occurrenceStartMs = new Date(targetItem.occurrenceStartTime).getTime()
    if (Number.isNaN(occurrenceStartMs)) return false
    const occurrenceDurationMinutes = getTimeItemTotalDurationMinutes(targetItem, slotMinutes)
    const occurrenceEndMs = occurrenceStartMs + occurrenceDurationMinutes * 60_000
    const recurrenceRule = normaliseRecurrenceRule(eventRecord.recurrence_rule)

    activePointerDragCleanupRef.current?.()
    suppressOptimisticEventBroadcastRef.current = true
    resizeLatestTimesRef.current = null
    // Guard the item from the moment the gesture starts: a silent refetch landing
    // mid-drag would otherwise overwrite the in-progress geometry.
    beginEventMutation(eventRecord.id)
    setSelectionDraft(null)
    setSelectedItemId(itemId)
    setResizeState({
      itemId,
      sourceEventId: eventRecord.id,
      dayIndex,
      edge,
      dayColumnElement,
      originalEvent: eventRecord,
      originalOccurrenceStartTime: new Date(occurrenceStartMs).toISOString(),
      originalOccurrenceEndTime: new Date(occurrenceEndMs).toISOString(),
      isRecurringEvent: recurrenceRule.type !== 'none' && recurrenceRule.endType !== 'whenCompleted',
      originalStartMinute: start.getUTCHours() * 60 + start.getUTCMinutes(),
      originalEndMinute: end.getUTCHours() * 60 + end.getUTCMinutes(),
    })
    return true
  }, [beginEventMutation, events, items, slotMinutes, sourceMap])

  const categoryMap = useMemo(() => {
    const map = new Map<string, Category>()
    for (const cat of categories) {
      map.set(cat.id, cat)
    }

    if (editingCategoryId && categoryDraft) {
      const existing = map.get(editingCategoryId)
      if (existing) {
        map.set(editingCategoryId, {
          ...existing,
          label: categoryDraft.label,
          color: categoryDraft.color,
          font_color: categoryDraft.fontColor,
          background_opacity: normaliseCategoryBackgroundOpacity(categoryDraft.backgroundOpacity),
          item_opacity: normaliseCategoryItemOpacity(categoryDraft.itemOpacity),
        })
      }
    }

    return map
  }, [categories, categoryDraft, editingCategoryId])

  const selectedSource = selectedEvent ? sourceMap.get(selectedEvent.source_id || MAIN_SOURCE_ID) : null
  const isSelectedReadOnly = isReadOnlySource(selectedSource)
  const isSelectedRecurrenceReadOnly = isSelectedReadOnly || Boolean(selectedEvent?.recurrence && (
    selectedEvent.recurrence.status === 'completed' || selectedEvent.recurrence.latest_event_id !== selectedEvent.id
  ))
  const selectedReadOnlyDisplayNotes = useMemo(() => {
    if (!selectedEvent || !isSelectedReadOnly) return draft.notes
    if (selectedEvent.source_type === 'manual') {
      return buildEventDraftNotes(selectedEvent)
    }

    return buildCopiedDescriptionWithLocation(selectedEvent.description, selectedEvent.location) || ''
  }, [draft.notes, isSelectedReadOnly, selectedEvent])
  const selectionStartLabel = selectionDraft ? formatAdjustedTimeLabel({
    day: weekDays[selectionDraft.dayIndex], minute: selectionDraft.startMinute, iana: tzState.primary,
  }) : ''
  const selectionEndLabel = selectionDraft ? formatAdjustedTimeLabel({
    day: weekDays[selectionDraft.dayIndex], minute: selectionDraft.endMinute, iana: tzState.primary,
  }) : ''
  const selectedOccurrenceStart = selectedItem ? new Date(selectedItem.occurrenceStartTime) : null
  const selectedOccurrenceMinute = selectedOccurrenceStart
    ? selectedOccurrenceStart.getUTCHours() * 60 + selectedOccurrenceStart.getUTCMinutes()
    : 0
  const selectedOccurrenceDay = selectedOccurrenceStart
    ? addDays(currentWeekStart, getWeekDayIndex(selectedOccurrenceStart, currentWeekStart))
    : currentWeekStart
  const selectedItemStartLabel = selectedItem ? formatAdjustedTimeLabel({
    day: selectedOccurrenceDay, minute: selectedOccurrenceMinute, iana: tzState.primary,
  }) : ''
  const selectedItemEndLabel = selectedItem
    ? formatAdjustedTimeLabel({
      day: selectedOccurrenceDay,
      minute: selectedOccurrenceMinute + selectedItem.actualDurationMinutes,
      iana: tzState.primary,
    })
    : ''
  const selectedItemDateLabel = selectedItem ? format(selectedOccurrenceDay, 'EEE d MMM') : ''
  const isSelectionAdjusterOpen = isSelectionAdjusterExpanded
  const isItemAdjusterOpen = isItemAdjusterExpanded
  const isTimeAdjusterExpanded = selectionDraft && !selectedItem
    ? isSelectionAdjusterExpanded
    : isItemAdjusterExpanded
  const noteEditorTitle = selectedItem
    ? draft.title.trim() || selectedItem.title || 'Untitled item'
    : draft.title.trim() || 'New time item'
  const hasStoredLocation = Boolean((draft.location || '').trim())
  const locationToggleLabel = isLocationFieldVisible
    ? 'Hide Location'
    : hasStoredLocation
      ? 'Show Location'
      : 'Add Location'
  const toggleLocationFieldVisible = useCallback(() => {
    setIsLocationFieldVisible((prev) => !prev)
  }, [])
  const noteEditorSubtitle = selectedItem
    ? (
      <span className="text-muted-foreground">
        {selectedItemDateLabel} {' '}
        <span className={itemLastChangedEdge === 'start' ? 'animate-[selection-time-pulse_0.75s_ease-out]' : ''}>{selectedItemStartLabel}</span>
        {' - '}
        <span className={itemLastChangedEdge === 'end' ? 'animate-[selection-time-pulse_0.75s_ease-out]' : ''}>{selectedItemEndLabel}</span>
      </span>
    )
    : selectionDraft
      ? (
        <span className="text-muted-foreground">
          {format(weekDays[selectionDraft.dayIndex], 'EEE d MMM')} {' '}
          <span className={selectionLastChangedEdge === 'start' ? 'animate-[selection-time-pulse_0.75s_ease-out]' : ''}>{selectionStartLabel}</span>
          {' - '}
          <span className={selectionLastChangedEdge === 'end' ? 'animate-[selection-time-pulse_0.75s_ease-out]' : ''}>{selectionEndLabel}</span>
        </span>
      )
      : 'Use the full view to draft long notes, templates, and checklists.'
  const recurrenceEditorDateSeed = selectedItem?.occurrenceStartTime || selectedEvent?.start_time || (selectionDraft
    ? buildEventTimestamp(weekDays[selectionDraft.dayIndex], selectionDraft.startMinute)
    : new Date().toISOString())
  const oauthCalendars = useMemo(
    () => syncCalendars.filter((s) => s.sourceType === 'external' && s.externalKind === 'google_oauth'),
    [syncCalendars]
  )

  const normaliseCategoryIds = (ids: string[]) => [...ids].sort().join('|')
  const getDraftSignature = useCallback((itemId: string | null, value: ItemDraft) => {
    return [
      itemId ?? '',
      value.title,
      value.notes,
      value.location || '',
      normaliseCategoryIds(value.categoryIds),
      value.sourceId,
      JSON.stringify(normaliseRecurrenceRule(value.recurrenceRule)),
    ].join('::')
  }, [])

  const isSelectedItemDirty = useMemo(() => {
    if (!selectedEvent || isSelectedReadOnly) return false
    if (draft.title !== selectedEvent.title) return true
    if (draft.notes !== buildEventDraftNotes(selectedEvent)) return true
    if ((draft.location || null) !== (selectedEvent.location || null)) return true
    if (normaliseCategoryIds(draft.categoryIds) !== normaliseCategoryIds(selectedEvent.category_ids || [])) return true
    return JSON.stringify(normaliseRecurrenceRule(draft.recurrenceRule)) !== JSON.stringify(normaliseRecurrenceRule(selectedEvent.recurrence_rule))
  }, [draft.categoryIds, draft.location, draft.notes, draft.recurrenceRule, draft.title, isSelectedReadOnly, selectedEvent])

  const isTitleDirty = Boolean(selectedEvent && !isSelectedReadOnly && draft.title !== selectedEvent.title)
  const isNotesDirty = Boolean(selectedEvent && !isSelectedReadOnly && draft.notes !== buildEventDraftNotes(selectedEvent))
  const isLocationDirty = Boolean(
    selectedEvent && !isSelectedReadOnly && (draft.location || null) !== (selectedEvent.location || null)
  )
  const isCategoryDirty = Boolean(
    selectedEvent
      && !isSelectedReadOnly
      && normaliseCategoryIds(draft.categoryIds) !== normaliseCategoryIds(selectedEvent.category_ids || [])
  )
  const isRecurrenceDirty = Boolean(
    selectedEvent
      && !isSelectedReadOnly
      && JSON.stringify(normaliseRecurrenceRule(draft.recurrenceRule)) !== JSON.stringify(normaliseRecurrenceRule(selectedEvent.recurrence_rule))
  )

  const hasPendingUnsavedChanges = Boolean(
    selectedEvent && !isSelectedReadOnly && (isSelectedItemDirty || isAutoSaving || autoSaveError)
  )
  const hasUnsavedNewItemDraft = Boolean(
    isNewItemDraft && !selectedItemId && (draft.title.trim() || draft.notes.trim() || draft.location?.trim()
      || draft.categoryIds.length || draft.recurrenceRule.type !== 'none')
  )
  const autoSaveCountdownMs = autoSaveDeadlineMs === null ? null : Math.max(0, autoSaveDeadlineMs - autoSaveTickMs)
  const isSaveSuccessVisible = saveSuccessHoldUntilMs !== null
  const canSaveSelectedItem = Boolean(
    selectedEvent && !isSelectedReadOnly && draft.title.trim() && !isAutoSaving && (isSelectedItemDirty || autoSaveError)
  )
  const canSaveNewSelectionItem = Boolean(selectionDraft && draft.title.trim() && !isCreatingItem)
  const shouldShowFullEditorSave = Boolean(
    (selectedEvent && !isSelectedReadOnly && (isSelectedItemDirty || isAutoSaving || Boolean(autoSaveError) || isSaveSuccessVisible)) ||
      (!selectedItem && selectionDraft)
  )
  const isFullEditorSaveDisabled = selectedEvent ? !canSaveSelectedItem : !canSaveNewSelectionItem
  const fullEditorSaveState: 'idle' | 'dirty' | 'autosaving' | 'saved' | 'error' = selectedEvent
    ? isSaveSuccessVisible
      ? 'saved'
      : autoSaveError
        ? 'error'
        : isAutoSaving
          ? 'autosaving'
          : isSelectedItemDirty
            ? 'dirty'
            : 'idle'
    : isCreatingItem
      ? 'autosaving'
      : 'dirty'
  const fullEditorSaveMetaLabel = selectedEvent && !isSelectedReadOnly
    ? isSaveSuccessVisible
      ? 'Saved successfully.'
      : autoSaveError
      ? 'Auto-save paused until you retry.'
      : isAutoSaving
        ? 'Syncing your latest edits now.'
        : isSelectedItemDirty
          ? draft.title.trim()
            ? autoSaveCountdownMs !== null
              ? `Auto-save in ${formatAutoSaveCountdown(autoSaveCountdownMs)}`
              : null
            : null
          : null
    : null
  const isSelectionTitleTypingMode = Boolean(selectionDraft && !selectedItem)
  const isSelectionTitleRequired = Boolean(selectionDraft && !selectedItem && !draft.title.trim())
  const selectionAccentColor = useMemo(() => {
    const selectedCategoryId = draft.categoryIds[0]
    if (selectedCategoryId) {
      const selectedCategory = categoryMap.get(selectedCategoryId)
      if (selectedCategory?.color) {
        return selectedCategory.color
      }
    }
    return selectedSource?.color || prefs.main_color
  }, [categoryMap, draft.categoryIds, prefs.main_color, selectedSource?.color])
  const isResizing = Boolean(resizeState)

  const getCalendarRepeatHeight = useCallback(() => {
    const scrollContainer = calendarScrollContainerRef.current
    const repeatElement = scrollContainer?.firstElementChild as HTMLElement | null
    return repeatElement?.offsetHeight ?? 0
  }, [])

  const centerCurrentTimeIndicatorInViewport = useCallback(() => {
    const scrollContainer = calendarScrollContainerRef.current
    const repeatHeight = getCalendarRepeatHeight()
    if (!scrollContainer || repeatHeight <= 0) return false

    const containerHeight = scrollContainer.clientHeight
    if (containerHeight <= 0) return false

    const indicators = scrollContainer.querySelectorAll<HTMLElement>('[data-testid="current-time-indicator"]')
    const middleIndicator = indicators.item(CALENDAR_REPEAT_MIDDLE_INDEX) || null

    const containerRect = scrollContainer.getBoundingClientRect()
    const indicatorRect = middleIndicator?.getBoundingClientRect()
    const measuredDelta = indicatorRect ? (indicatorRect.top - containerRect.top) : Number.NaN

    // Use measured geometry when available, and fall back to deterministic math in non-layout test environments.
    const targetTop = Number.isFinite(measuredDelta) && Math.abs(measuredDelta) > 1
      ? Math.max(0, scrollContainer.scrollTop + measuredDelta - containerHeight / 2)
      : Math.max(0, repeatHeight * CALENDAR_REPEAT_MIDDLE_INDEX + currentTimeIndicatorTop - containerHeight / 2)

    scrollContainer.scrollTop = targetTop
    return true
  }, [currentTimeIndicatorTop, getCalendarRepeatHeight])

  useLayoutEffect(() => {
    if (hasCenteredCalendarScrollRef.current) return

    let raf1 = 0
    let raf2 = 0
    const timers: number[] = []

    const runCenter = () => {
      if (hasCenteredCalendarScrollRef.current) return
      if (centerCurrentTimeIndicatorInViewport()) {
        hasCenteredCalendarScrollRef.current = true
      }
    }

    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        runCenter()
      })
    })

    // Some layout shifts occur just after refresh (header/status row, viewport settling).
    // Re-apply centering briefly during initial load to keep the red line in the middle.
    timers.push(window.setTimeout(runCenter, 120))
    timers.push(window.setTimeout(runCenter, 320))
    timers.push(window.setTimeout(runCenter, 800))

    return () => {
      if (raf1) window.cancelAnimationFrame(raf1)
      if (raf2) window.cancelAnimationFrame(raf2)
      timers.forEach((id) => window.clearTimeout(id))
    }
  }, [
    centerCurrentTimeIndicatorInViewport,
    currentWeekStart,
    dayHeight,
    slotMinutes,
  ])

  const normalizeCalendarLoopScrollTop = useCallback(
    (scrollTop: number, repeatHeight: number) => {
      const lowerThreshold = repeatHeight * 0.5
      const upperThreshold = repeatHeight * 1.5

      if (!Number.isFinite(scrollTop) || repeatHeight <= 0) {
        return scrollTop
      }

      let normalized = scrollTop

      // Large jumps can skip across more than one repeat; wrap back into middle band.
      while (normalized < lowerThreshold) {
        normalized += repeatHeight
      }

      while (normalized > upperThreshold) {
        normalized -= repeatHeight
      }

      return normalized
    },
    []
  )

  const handleCalendarScroll = useCallback(() => {
    if (isRepositioningCalendarScrollRef.current) return
    if (isDraggingItem || isSelectingRef.current) return

    const scrollContainer = calendarScrollContainerRef.current
    const repeatHeight = getCalendarRepeatHeight()
    if (!scrollContainer || repeatHeight <= 0) return

    hasCenteredCalendarScrollRef.current = true

    const currentTop = scrollContainer.scrollTop
    const normalizedTop = normalizeCalendarLoopScrollTop(currentTop, repeatHeight)

    if (normalizedTop !== currentTop) {
      isRepositioningCalendarScrollRef.current = true
      scrollContainer.scrollTop = normalizedTop
      window.setTimeout(() => {
        isRepositioningCalendarScrollRef.current = false
      }, 0)
    }
  }, [getCalendarRepeatHeight, isDraggingItem, normalizeCalendarLoopScrollTop])

  const findEarliestVisibleItem = useCallback((candidates: TimeItem[]) => {
    return candidates.reduce((earliest, item) => {
      if (!earliest) return item
      if (item.dayIndex < earliest.dayIndex) return item
      if (item.dayIndex > earliest.dayIndex) return earliest
      if (item.startMinute < earliest.startMinute) return item
      return earliest
    }, null as TimeItem | null)
  }, [])

  const scrollCalendarStartMinuteToScreenMiddle = useCallback(
    (dayIndex: number, startMinute: number, behavior: ScrollBehavior = 'auto') => {
      const dayColumn = dayColumnRefs.current[dayIndex]
      const scrollContainer = calendarScrollContainerRef.current
      if (!dayColumn || !scrollContainer) return false

      const targetMinute = Math.max(0, Math.min(MINUTES_IN_DAY, startMinute))
      const targetContentTop = dayColumn.offsetTop + (targetMinute / slotMinutes) * SLOT_HEIGHT
      const containerRect = scrollContainer.getBoundingClientRect()
      const screenMidY = window.innerHeight / 2
      const anchorWithinContainer = Math.max(
        0,
        Math.min(scrollContainer.clientHeight, screenMidY - containerRect.top)
      )
      const maxTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight)
      const targetTop = Math.max(0, Math.min(maxTop, targetContentTop - anchorWithinContainer))

      if (behavior === 'smooth') {
        scrollContainer.scrollTo({ top: targetTop, behavior: 'smooth' })
      } else {
        scrollContainer.scrollTop = targetTop
      }
      return true
    },
    [slotMinutes]
  )

  useLayoutEffect(() => {
    if (!pendingTodayScrollRef.current) return

    let rafId = 0
    let timeoutId = 0

    const runTodayScroll = () => {
      if (!pendingTodayScrollRef.current) return

      const todayDayIndex = pendingTodayScrollDayIndexRef.current
      const todayMinute = pendingTodayScrollMinuteRef.current
      if (todayDayIndex === null || todayMinute === null) {
        pendingTodayScrollRef.current = false
        return
      }

      if (scrollCalendarStartMinuteToScreenMiddle(todayDayIndex, todayMinute, 'smooth')) {
        pendingTodayScrollRef.current = false
        pendingTodayScrollDayIndexRef.current = null
        pendingTodayScrollMinuteRef.current = null
        hasCenteredCalendarScrollRef.current = true
      }
    }

    runTodayScroll()

    if (pendingTodayScrollRef.current) {
      rafId = window.requestAnimationFrame(() => {
        runTodayScroll()
      })
      timeoutId = window.setTimeout(() => {
        runTodayScroll()
      }, 80)
    }

    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId)
      }
      if (timeoutId) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [currentWeekStart, scrollCalendarStartMinuteToScreenMiddle, slotMinutes])

  useEffect(() => {
    if (hasAutoScrolledToWeekItemRef.current) return
    if (isSourcesLoading || isEventsLoading || eventsError) return
    if (currentWeekStart.getTime() !== entryWeekStartMsRef.current) return
    if (visibleItems.length === 0) return

    const firstVisibleItem = findEarliestVisibleItem(visibleItems)

    if (!firstVisibleItem) return

    if (scrollCalendarStartMinuteToScreenMiddle(firstVisibleItem.dayIndex, firstVisibleItem.startMinute)) {
      hasAutoScrolledToWeekItemRef.current = true
    }
  }, [
    currentWeekStart,
    eventsError,
    findEarliestVisibleItem,
    isEventsLoading,
    isSourcesLoading,
    scrollCalendarStartMinuteToScreenMiddle,
    visibleItems,
  ])

  const persistRecurringItemEdit = useCallback(async (
    sourceEvent: UserEventRecord,
    occurrenceStartTime: string,
    changes: Partial<UserEventRecord>,
    chosenScope?: RecurringEditScope,
  ): Promise<boolean> => {
    if (sourceEvent.recurrence_rule?.endType === 'whenCompleted') {
      beginEventMutation(sourceEvent.id)
      try {
        const { data } = await apiClient.put<{ event: UserEventRecord }>(`/api/user-events/${sourceEvent.id}`, changes)
        if (!data?.event) throw new Error('The recurrence edit did not return an item.')
        setEvents(previous => previous.map(event => event.id === sourceEvent.id ? data.event : (
          event.recurrence_id && event.recurrence_id === data.event.recurrence_id
            ? { ...event, recurrence: data.event.recurrence, recurrence_rule: data.event.recurrence_rule }
            : event
        )))
        notifyTimeManagementDataChanged('recurring-item-edited')
        return true
      } catch (error) {
        console.error('Failed to update conditional Time Item:', error)
        setClipboardStatus(getApiErrorMessage(error, 'Could not update this Time Item.'))
        return false
      } finally {
        endEventMutation(sourceEvent.id)
      }
    }
    const scope = chosenScope ?? await requestRecurringEditScope(sourceEvent.title, { seriesId: sourceEvent.id, isPublic: Boolean(sourceEvent.is_public) })
    if (!scope) return false
    const editOptions = chosenScope ? { keepPublic: true, updateGoogle: null } : recurringEditOptionsRef.current
    const skipGoogleSync = scope === 'this' && editOptions.updateGoogle === false
    const { previousRule, nextRule } = splitRecurringEventRule(sourceEvent, occurrenceStartTime, scope)
    const originalRule = normaliseRecurrenceRule(sourceEvent.recurrence_rule)
    const changedRule = changes.recurrence_rule ? normaliseRecurrenceRule(changes.recurrence_rule) : originalRule
    const hasRuleChange = JSON.stringify(changedRule) !== JSON.stringify(originalRule)
    const startTime = changes.start_time || occurrenceStartTime
    const durationMs = new Date(sourceEvent.end_time).getTime() - new Date(sourceEvent.start_time).getTime()
    const dayShift = Math.round((toUtcDateParts(new Date(startTime)) - toUtcDateParts(new Date(occurrenceStartTime))) / DAY_MS)
    const recurrenceRule = scope === 'this'
      ? { type: 'none' as const }
      : hasRuleChange ? changedRule : shiftRecurrenceRuleByDays(nextRule, dayShift)
    const replacement: UserEventRecord = {
      ...sourceEvent,
      ...changes,
      start_time: startTime,
      end_time: changes.end_time || new Date(new Date(startTime).getTime() + durationMs).toISOString(),
      recurrence_rule: recurrenceRule,
    }
    const payload = {
      title: replacement.title,
      description: replacement.description,
      meeting_link: replacement.meeting_link,
      location: replacement.location,
      start_time: replacement.start_time,
      end_time: replacement.end_time,
      is_public: scope === 'this' && !editOptions.keepPublic ? false : replacement.is_public,
      category_ids: replacement.category_ids || [],
      source_id: replacement.source_id || MAIN_SOURCE_ID,
      recurrence_rule: recurrenceRule,
      ...(scope === 'this' ? { series_id: sourceEvent.id, original_start_time: occurrenceStartTime } : {}),
      ...(skipGoogleSync ? { skip_google_sync: true } : {}),
    }
    let sourceWasUpdated = false
    let createdId: string | null = null
    beginEventMutation(sourceEvent.id)
    try {
      await apiClient.put(`/api/user-events/${sourceEvent.id}`, { recurrence_rule: previousRule, ...(skipGoogleSync ? { skip_google_sync: true } : {}) })
      sourceWasUpdated = true
      const { data } = await apiClient.post<{ event: UserEventRecord }>('/api/user-events', payload)
      if (!data?.event) throw new Error('The recurring edit did not return an item.')
      // Exported series without auto-sync: push only when the user asked for it.
      if (scope === 'this' && editOptions.updateGoogle === true) {
        void apiClient.post(`/api/google-sync/user-events/${sourceEvent.id}/push`).catch(() => undefined)
      }
      const created = normaliseCreatedManualEvent({ ...replacement, ...data.event }, {
        fallbackSourceId: payload.source_id,
        fallbackCategoryIds: payload.category_ids,
        fallbackRecurrenceRule: recurrenceRule,
      })
      createdId = created.id
      beginEventMutation(created.id)
      const applyEdit = (prev: UserEventRecord[]): UserEventRecord[] => [
        ...prev.map((event) => event.id === sourceEvent.id ? { ...event, recurrence_rule: previousRule } : event),
        created,
      ]
      eventsRef.current = applyEdit(eventsRef.current)
      setEvents(applyEdit)
      setSelectedItemId(created.id)
      setClipboardStatus(scope === 'this' ? 'Updated this item only.' : 'Updated this and future occurrences.')
      notifyTimeManagementDataChanged('recurring-item-edited')
      return true
    } catch (error) {
      console.error('Failed to edit recurring item:', error)
      if (sourceWasUpdated) {
        try {
          await apiClient.put(`/api/user-events/${sourceEvent.id}`, { recurrence_rule: sourceEvent.recurrence_rule })
        } catch (restoreError) {
          console.error('Failed to restore recurring item:', restoreError)
          setEvents((prev) => prev.map((event) => event.id === sourceEvent.id ? { ...event, recurrence_rule: previousRule } : event))
          setClipboardStatus('Could not complete or restore the recurring edit. Refresh before retrying.')
          return false
        }
      }
      setClipboardStatus('Could not save the recurring edit. Try again.')
      return false
    } finally {
      endEventMutation(sourceEvent.id)
      if (createdId) endEventMutation(createdId)
    }
  }, [beginEventMutation, endEventMutation, notifyTimeManagementDataChanged, requestRecurringEditScope])

  // Apply global ns-resize cursor while an edge resize is in progress.
  useEffect(() => {
    if (!isResizing) return
    const prev = document.body.style.cursor
    document.body.style.cursor = 'ns-resize'
    return () => {
      document.body.style.cursor = prev
    }
  }, [isResizing])

  useEffect(() => {
    if (!resizeState) return

    let hasCommitted = false

    const updateResizeFromClientY = (clientY: number) => {
      const dayColumn = resizeState.dayColumnElement
      if (!dayColumn) return

      const rect = dayColumn.getBoundingClientRect()
      if (!Number.isFinite(clientY) || rect.height <= 0) return

      const pointerMinuteRaw = (clientY - rect.top) / rect.height * MINUTES_IN_DAY
      const boundedPointerMinuteRaw = Math.max(-MINUTES_IN_DAY, Math.min(MINUTES_IN_DAY * 2, pointerMinuteRaw))
      const pointerMinute = snapMinuteUnbounded(boundedPointerMinuteRaw, slotMinutes)

      const day = weekDays[resizeState.dayIndex]
      if (!day || Number.isNaN(day.getTime())) return

      const baseDayStartMs = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0)
      const pointerTimeMs = baseDayStartMs + pointerMinute * 60_000
      if (!Number.isFinite(pointerTimeMs)) return

      const originalStartMs = resizeState.isRecurringEvent
        ? new Date(resizeState.originalOccurrenceStartTime).getTime()
        : new Date(resizeState.originalEvent.start_time).getTime()
      const originalEndMs = resizeState.isRecurringEvent
        ? new Date(resizeState.originalOccurrenceEndTime).getTime()
        : new Date(resizeState.originalEvent.end_time).getTime()
      const minDurationMs = slotMinutes * 60_000

      const nextStartMs = resizeState.edge === 'start'
        ? Math.min(pointerTimeMs, originalEndMs - minDurationMs)
        : originalStartMs
      const nextEndMs = resizeState.edge === 'end'
        ? Math.max(pointerTimeMs, originalStartMs + minDurationMs)
        : originalEndMs

      const startTime = new Date(nextStartMs).toISOString()
      const endTime = new Date(nextEndMs).toISOString()

      // Record the latest geometry synchronously so the commit handler always
      // has the final size, even if the last state flush has not landed yet.
      resizeLatestTimesRef.current = { startTime, endTime }

      if (resizeState.isRecurringEvent) {
        const previewStartMinuteRaw = Math.round((nextStartMs - baseDayStartMs) / 60_000)
        const normalizedPreview = normaliseDroppedMinuteToWeekDay(resizeState.dayIndex, previewStartMinuteRaw)
        const previewDurationMinutes = Math.max(slotMinutes, Math.round((nextEndMs - nextStartMs) / 60_000))

        if (normalizedPreview) {
          setRecurringResizePreview({
            dayIndex: normalizedPreview.dayIndex,
            startMinute: normalizedPreview.startMinute,
            durationMinutes: previewDurationMinutes,
          })
        } else {
          setRecurringResizePreview(null)
        }
      } else {
        setRecurringResizePreview(null)
      }

      if (!resizeState.isRecurringEvent) {
        const sourceEventId = resizeState.sourceEventId
        setEvents((prev) =>
          prev.map((candidate) =>
            candidate.id === sourceEventId
              ? { ...candidate, start_time: startTime, end_time: endTime }
              : candidate
          )
        )
      }
    }

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      updateResizeFromClientY(event.clientY)
    }

    const handleMouseMove = (event: globalThis.MouseEvent) => {
      updateResizeFromClientY(event.clientY)
    }

    const handleResizeCommit = () => {
      if (hasCommitted) return
      hasCommitted = true

      const sourceEventId = resizeState.sourceEventId
      const previousEvent = resizeState.originalEvent
      const latestTimes = resizeLatestTimesRef.current
      resizeLatestTimesRef.current = null
      setResizeState(null)
      setRecurringResizePreview(null)

      // Prefer the synchronously tracked geometry; fall back to the latest
      // event snapshot only when the pointer never moved.
      const fallbackEvent = eventsRef.current.find((event) => event.id === sourceEventId)
      const finalStartTime = latestTimes?.startTime ?? fallbackEvent?.start_time
      const finalEndTime = latestTimes?.endTime ?? fallbackEvent?.end_time

      if (!finalStartTime || !finalEndTime) {
        suppressOptimisticEventBroadcastRef.current = false
        endEventMutation(sourceEventId)
        return
      }

      const originalResizeStart = resizeState.isRecurringEvent
        ? resizeState.originalOccurrenceStartTime
        : previousEvent.start_time
      const originalResizeEnd = resizeState.isRecurringEvent
        ? resizeState.originalOccurrenceEndTime
        : previousEvent.end_time

      if (finalStartTime === originalResizeStart && finalEndTime === originalResizeEnd) {
        suppressOptimisticEventBroadcastRef.current = false
        endEventMutation(sourceEventId)
        return
      }

      if (resizeState.isRecurringEvent) {
        setEvents((prev) => prev.map((event) => event.id === sourceEventId ? previousEvent : event))
        void persistRecurringItemEdit(previousEvent, resizeState.originalOccurrenceStartTime, {
          start_time: finalStartTime,
          end_time: finalEndTime,
        }).finally(() => {
            suppressOptimisticEventBroadcastRef.current = false
            endEventMutation(sourceEventId)
        })
        return
      }

      // Ensure the committed geometry is reflected locally before the network
      // round-trip so the item never snaps back to its pre-drag size.
      setEvents((prev) =>
        prev.map((candidate) =>
          candidate.id === sourceEventId
            ? { ...candidate, start_time: finalStartTime, end_time: finalEndTime }
            : candidate
        )
      )

      void apiClient
        .put<{ event?: UserEventRecord }>(`/api/user-events/${sourceEventId}`, {
          start_time: finalStartTime,
          end_time: finalEndTime,
        })
        .then((res) => {
          const updatedEvent = res.data?.event
          if (updatedEvent) {
            setEvents((prev) => prev.map((candidate) => (candidate.id === sourceEventId ? updatedEvent : candidate)))
          }
          notifyTimeManagementDataChanged('event-resized')
        })
        .catch((err) => {
          console.error('Failed to resize item:', err)
          if (isRetryableWriteError(err)) {
            const message = err instanceof Error ? err.message : 'Could not reach the server.'
            queueUnsyncedOp({
              eventId: sourceEventId,
              kind: 'update',
              method: 'put',
              endpoint: `/api/user-events/${sourceEventId}`,
              payload: { start_time: finalStartTime, end_time: finalEndTime },
              snapshot: { ...previousEvent, start_time: finalStartTime, end_time: finalEndTime },
              attempts: 1,
              firstFailedAt: Date.now(),
              lastAttemptAt: Date.now(),
              lastError: message,
            })
            return
          }
          setEvents((prev) => prev.map((candidate) => (candidate.id === sourceEventId ? previousEvent : candidate)))
        })
        .finally(() => {
          suppressOptimisticEventBroadcastRef.current = false
          endEventMutation(sourceEventId)
        })
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handleResizeCommit)
    window.addEventListener('pointercancel', handleResizeCommit)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleResizeCommit)
    window.addEventListener('blur', handleResizeCommit)
    return () => {
      setRecurringResizePreview(null)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handleResizeCommit)
      window.removeEventListener('pointercancel', handleResizeCommit)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleResizeCommit)
      window.removeEventListener('blur', handleResizeCommit)
    }
  }, [endEventMutation, notifyTimeManagementDataChanged, persistRecurringItemEdit, queueUnsyncedOp, resizeState, slotMinutes, weekDays])

  const lastSavedLabel = useMemo(() => {
    if (!lastSavedAt) return null
    return new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }, [lastSavedAt])

  const triggerTitleTypingHint = useCallback(() => {
    setIsTitleTypingHintActive(true)
    if (titleTypingHintTimeoutRef.current) {
      window.clearTimeout(titleTypingHintTimeoutRef.current)
    }
    titleTypingHintTimeoutRef.current = window.setTimeout(() => {
      setIsTitleTypingHintActive(false)
      titleTypingHintTimeoutRef.current = null
    }, 600)
  }, [])

  useEffect(() => {
    return () => {
      activePointerDragCleanupRef.current?.()
      cancelScheduledDragDropPreview()
      if (titleTypingHintTimeoutRef.current) {
        window.clearTimeout(titleTypingHintTimeoutRef.current)
      }
      if (selectionChangePulseTimeoutRef.current) {
        window.clearTimeout(selectionChangePulseTimeoutRef.current)
      }
      if (itemChangePulseTimeoutRef.current) {
        window.clearTimeout(itemChangePulseTimeoutRef.current)
      }
    }
  }, [cancelScheduledDragDropPreview])

  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable handler; wrapping in useCallback would cascade through co-located helpers in this large view
  const startSelection = (dayIndex: number, minute: number) => {
    if (isResizing) return
    const snapped = snapMinute(minute, slotMinutes)
    const movingDuration = movingItemId
      ? (() => {
          const moving = interactionItemMap.get(movingItemId)
            || items.find((item) => item.id === movingItemId)
            || (movingItemSnapshot?.id === movingItemId ? movingItemSnapshot : null)
          return moving ? getTimeItemTotalDurationMinutes(moving, slotMinutes) : slotMinutes
        })()
      : slotMinutes

    const hasInProgressNewItem =
      isNewItemDraft && !selectedItemId && !movingItemId &&
      Boolean(quickTemplateAwaitingTime !== null || draft.title.trim() || draft.notes.trim() || draft.location?.trim() || draft.categoryIds.length || draft.recurrenceRule.type !== 'none' || showItemRecurrencePanel)

    setSelectionDraft({ dayIndex, startMinute: snapped, endMinute: snapped + movingDuration })
    isSelectingRef.current = true
    setIsSelecting(true)
    setIsSelectionAdjusterExpanded(false)
    setIsItemAdjusterExpanded(false)
    setSelectedItemId(null)
    if (!movingItemId) setIsNewItemDraft(true)
    if (!hasInProgressNewItem && !movingItemId) {
      setShowItemRecurrencePanel(false)
      setIsLocationFieldVisible(false)
      setAutoSaveError(null)
      setSaveSuccessHoldUntilMs(null)
    }
    setDraft((prev) => {
      if (hasInProgressNewItem || movingItemId) {
        return prev
      }

      return {
        title: '',
        notes: '',
        location: null,
        categoryIds: [],
        sourceId: MAIN_SOURCE_ID,
        recurrenceRule: { type: 'none' },
      }
    })
    if (isPhoneLayout) {
      setIsLeftPanelOpen(false)
      setExpandedSections(new Set())
      return
    }

    if (!shouldOpenLeftPanelForSelection(movingDuration)) return

    openLeftPanelSection('editor')
    // Auto-scroll to editor section after panel slide-in settles
    window.setTimeout(() => {
      editorSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 340)
  }

  const updateSelection = (dayIndex: number, minute: number) => {
    if (isResizing) return
    if (!isSelecting || !selectionDraft || selectionDraft.dayIndex !== dayIndex) return
    const snapped = Math.floor(minute / slotMinutes) * slotMinutes
    const minMinute = Math.min(selectionDraft.startMinute, snapped)
    const maxMinute = Math.max(selectionDraft.startMinute, snapped) + slotMinutes
    setSelectionDraft({ dayIndex, startMinute: minMinute, endMinute: maxMinute })
  }

  const minuteFromPointer = (event: MouseEvent<HTMLDivElement>): number => {
    const anchorDayColumn = selectionAnchorDayColumnRef.current
    const referenceElement = isSelecting && anchorDayColumn ? anchorDayColumn : event.currentTarget
    const rect = referenceElement.getBoundingClientRect()
    const y = event.clientY - rect.top
    return (y / rect.height) * MINUTES_IN_DAY
  }

  const autoScrollCalendarWhileDragging = useCallback((clientY: number): boolean => {
    const container = calendarScrollContainerRef.current
    if (!container) return false

    const rect = container.getBoundingClientRect()

    // Clamp pointer Y so dragging past the container's top/bottom keeps
    // auto-scroll active at full intensity instead of stalling.
    const clampedY = Math.max(rect.top, Math.min(rect.bottom, clientY))
    const distanceToTop = clampedY - rect.top
    const distanceToBottom = rect.bottom - clampedY
    let delta = 0

    if (distanceToTop < DRAG_SCROLL_EDGE_PX) {
      const intensity = (DRAG_SCROLL_EDGE_PX - distanceToTop) / DRAG_SCROLL_EDGE_PX
      delta = -Math.max(4, Math.round(intensity * DRAG_SCROLL_MAX_STEP_PX))
    } else if (distanceToBottom < DRAG_SCROLL_EDGE_PX) {
      const intensity = (DRAG_SCROLL_EDGE_PX - distanceToBottom) / DRAG_SCROLL_EDGE_PX
      delta = Math.max(4, Math.round(intensity * DRAG_SCROLL_MAX_STEP_PX))
    }

    if (delta === 0) return false

    // During drag we do NOT wrap; the three repeat copies give plenty of
    // headroom and wrapping mid-drag breaks the native HTML5 drag image on
    // some browsers (the dragged item visually freezes against an edge).
    const maxTop = Math.max(0, container.scrollHeight - container.clientHeight)
    const prevTop = container.scrollTop
    container.scrollTop = Math.max(0, Math.min(maxTop, container.scrollTop + delta))
    return container.scrollTop !== prevTop
  }, [])

  useEffect(() => {
    if (!isDraggingItem) return

    let isEnded = false
    let frameId = 0

    const scheduleEdgeScroll = () => {
      if (isEnded || frameId !== 0) return
      const clientY = dragClientYRef.current
      if (typeof clientY === 'number') {
        const didScroll = autoScrollCalendarWhileDragging(clientY)
        if (didScroll && !isEnded) {
          frameId = window.requestAnimationFrame(() => {
            frameId = 0
            scheduleEdgeScroll()
          })
        }
      }
    }

    const handleWindowDragOver = (event: globalThis.DragEvent) => {
      event.preventDefault()
      if (event.clientY > 0) {
        dragClientYRef.current = event.clientY
        scheduleEdgeScroll()
      }
    }

    const handleWindowDrag = (event: globalThis.DragEvent) => {
      if (event.clientY > 0) {
        dragClientYRef.current = event.clientY
        scheduleEdgeScroll()
      }
    }

    const handleWindowDragEnd = () => {
      if (isEnded) return
      isEnded = true
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId)
        frameId = 0
      }
      resetDragInteraction()

      // Re-center the loop after drag ends so seamless wrapping resumes.
      const container = calendarScrollContainerRef.current
      const repeatHeight = getCalendarRepeatHeight()
      if (container && repeatHeight > 0) {
        const normalizedTop = normalizeCalendarLoopScrollTop(container.scrollTop, repeatHeight)
        if (normalizedTop !== container.scrollTop) {
          isRepositioningCalendarScrollRef.current = true
          container.scrollTop = normalizedTop
          window.setTimeout(() => {
            isRepositioningCalendarScrollRef.current = false
          }, 0)
        }
      }
    }

    window.addEventListener('dragover', handleWindowDragOver)
    window.addEventListener('drag', handleWindowDrag)
    window.addEventListener('dragend', handleWindowDragEnd)
    window.addEventListener('drop', handleWindowDragEnd)
    window.addEventListener('blur', handleWindowDragEnd)

    return () => {
      isEnded = true
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId)
        frameId = 0
      }
      window.removeEventListener('dragover', handleWindowDragOver)
      window.removeEventListener('drag', handleWindowDrag)
      window.removeEventListener('dragend', handleWindowDragEnd)
      window.removeEventListener('drop', handleWindowDragEnd)
      window.removeEventListener('blur', handleWindowDragEnd)
    }
  }, [autoScrollCalendarWhileDragging, getCalendarRepeatHeight, isDraggingItem, normalizeCalendarLoopScrollTop, resetDragInteraction])

  const commitTimeItemMove = useCallback((item: TimeItem, dayIndex: number, dayColumnElement: HTMLDivElement, clientY: number) => {
    const itemTotalDurationMinutes = getTimeItemTotalDurationMinutes(item, slotMinutes)
    const sourceEventId = item.sourceEventId
    if (!sourceEventId) {
      resetDragInteraction()
      return
    }

    // External (read-only) items cannot be moved.
    const source = sourceMap.get(item.sourceId)
    if (isReadOnlySource(source)) {
      resetDragInteraction()
      return
    }

    const rect = dayColumnElement.getBoundingClientRect()
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top))
    const pointerMinute = (y / rect.height) * MINUTES_IN_DAY
    const minute = resolveDropStartMinute(
      pointerMinute,
      dragTopOffsetMinutesRef.current,
      slotMinutes,
      itemTotalDurationMinutes
    )
    const dropTarget = normaliseDroppedMinuteToWeekDay(dayIndex, minute)
    if (!dropTarget) {
      resetDragInteraction()
      return
    }
    const day = weekDays[dropTarget.dayIndex]
    const startTime = buildEventTimestamp(day, dropTarget.startMinute)
    const endTime = new Date(new Date(startTime).getTime() + itemTotalDurationMinutes * 60_000).toISOString()
    const resolvedSourceEventId = resolvedPendingEventIdsRef.current.get(sourceEventId) || sourceEventId
    const isAwaitingCreate = isPendingEventId(sourceEventId) && resolvedSourceEventId === sourceEventId

    resetDragInteraction()

    const previousCandidate = eventsRef.current.find((candidate) => candidate.id === resolvedSourceEventId)
    if (previousCandidate && normaliseRecurrenceRule(previousCandidate.recurrence_rule).type !== 'none' && !isAwaitingCreate) {
      void persistRecurringItemEdit(previousCandidate, item.occurrenceStartTime, { start_time: startTime, end_time: endTime })
      return
    }
    setEvents((prev) => {
      const next = prev.map((candidate) =>
        candidate.id === resolvedSourceEventId
          ? { ...candidate, start_time: startTime, end_time: endTime }
          : candidate
      )
      if (isAwaitingCreate) eventsRef.current = next
      return next
    })

    if (isAwaitingCreate) return

    beginEventMutation(resolvedSourceEventId)
    void apiClient
      .put(`/api/user-events/${resolvedSourceEventId}`, { start_time: startTime, end_time: endTime })
      .catch((err) => {
        console.error('Failed to reschedule item:', err)
        if (isRetryableWriteError(err)) {
          if (previousCandidate) {
            const message = err instanceof Error ? err.message : 'Could not reach the server.'
            queueUnsyncedOp({
              eventId: resolvedSourceEventId,
              kind: 'update',
              method: 'put',
              endpoint: `/api/user-events/${resolvedSourceEventId}`,
              payload: { start_time: startTime, end_time: endTime },
              snapshot: { ...previousCandidate, start_time: startTime, end_time: endTime },
              attempts: 1,
              firstFailedAt: Date.now(),
              lastAttemptAt: Date.now(),
              lastError: message,
            })
          }
          return
        }
        if (previousCandidate) {
          setEvents((prev) => prev.map((candidate) => (
            candidate.id === resolvedSourceEventId ? previousCandidate : candidate
          )))
        }
      })
      .finally(() => {
        endEventMutation(resolvedSourceEventId)
      })
  }, [beginEventMutation, endEventMutation, persistRecurringItemEdit, queueUnsyncedOp, resetDragInteraction, slotMinutes, sourceMap, weekDays])

  const handleDrop = (event: DragEvent<HTMLDivElement>, dayIndex: number) => {
    event.preventDefault()
    const rawItemId = event.dataTransfer.getData('text/time-item') || event.dataTransfer.getData('text/plain') || draggingItemId || ''
    const itemId = rawItemId.trim()
    const item = interactionItemMap.get(itemId) || items.find((candidate) => candidate.id === itemId) || draggingItem
    if (!item) {
      resetDragInteraction()
      return
    }

    commitTimeItemMove(item, dayIndex, event.currentTarget, event.clientY)
  }

  const getPointerDropTarget = useCallback((clientX: number, clientY: number): { dayIndex: number; element: HTMLDivElement } | null => {
    if (typeof document === 'undefined' || typeof document.elementsFromPoint !== 'function') return null

    const elements = document.elementsFromPoint(clientX, clientY)
    for (const element of elements) {
      if (!(element instanceof HTMLElement)) continue
      const dropZone = element.closest<HTMLElement>('[data-time-management-drop-zone="true"]')
      if (!(dropZone instanceof HTMLDivElement)) continue

      const dayIndex = Number(dropZone.dataset.timeManagementDayIndex)
      if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= weekDays.length) continue
      return { dayIndex, element: dropZone }
    }

    return null
  }, [weekDays.length])

  const beginControlledItemDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>, item: TimeItem, interactionId: string) => {
    const pointerType = event.pointerType || 'mouse'
    if (pointerType !== 'mouse') return
    const button = typeof event.button === 'number' ? event.button : 0
    if (button !== 0 || isResizing || isTemplateSelectionMode) return

    const source = sourceMap.get(item.sourceId)
    if (isReadOnlySource(source)) return

    event.stopPropagation()

    activePointerDragCleanupRef.current?.()
    const rect = event.currentTarget.getBoundingClientRect()
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top))
    const dragProgress = rect.height > 0 ? y / rect.height : 0
    const originalUserSelect = document.body.style.userSelect
    const originalCursor = document.body.style.cursor

    activePointerDragRef.current = {
      item,
      interactionId,
      pointerId: typeof event.pointerId === 'number' ? event.pointerId : 1,
      startClientX: event.clientX,
      startClientY: event.clientY,
      latestClientX: event.clientX,
      latestClientY: event.clientY,
      hasStarted: false,
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
      window.removeEventListener('blur', handlePointerCancel)
      activePointerDragRef.current = null
      activePointerDragCleanupRef.current = null
      document.body.style.userSelect = originalUserSelect
      document.body.style.cursor = originalCursor
    }

    const startDragIfNeeded = (state: PointerDragState, clientX: number, clientY: number) => {
      if (state.hasStarted) return true

      const distance = Math.hypot(clientX - state.startClientX, clientY - state.startClientY)
      if (distance < 5) return false

      state.hasStarted = true
      suppressNextItemClickRef.current = true
      dragTopOffsetMinutesRef.current = item.durationMinutes * dragProgress
      setIsDraggingItem(true)
      setDraggingItemId(interactionId)
      dragClientYRef.current = clientY
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'grabbing'
      return true
    }

    const updatePreview = (state: PointerDragState) => {
      const target = getPointerDropTarget(state.latestClientX, state.latestClientY)
      if (!target) {
        cancelScheduledDragDropPreview()
        setDragDropPreview(null)
        return
      }

      const rect = target.element.getBoundingClientRect()
      const pointerY = Math.max(0, Math.min(rect.height, state.latestClientY - rect.top))
      const pointerMinute = (pointerY / rect.height) * MINUTES_IN_DAY
      const startMinute = resolveDropStartMinute(
        pointerMinute,
        dragTopOffsetMinutesRef.current,
        slotMinutes,
        item.durationMinutes
      )

      scheduleDragDropPreview({
        dayIndex: target.dayIndex,
        startMinute: wrapMinuteWithinDay(startMinute),
        durationMinutes: item.durationMinutes,
        itemId: interactionId,
      })
    }

    function handlePointerMove(pointerEvent: globalThis.PointerEvent) {
      const state = activePointerDragRef.current
      const pointerId = typeof pointerEvent.pointerId === 'number' ? pointerEvent.pointerId : state?.pointerId
      if (!state || state.pointerId !== pointerId) return

      state.latestClientX = pointerEvent.clientX
      state.latestClientY = pointerEvent.clientY
      if (!startDragIfNeeded(state, pointerEvent.clientX, pointerEvent.clientY)) return

      pointerEvent.preventDefault()
      dragClientYRef.current = pointerEvent.clientY
      updatePreview(state)
      autoScrollCalendarWhileDragging(pointerEvent.clientY)
    }

    function handlePointerUp(pointerEvent: globalThis.PointerEvent) {
      const state = activePointerDragRef.current
      const pointerId = typeof pointerEvent.pointerId === 'number' ? pointerEvent.pointerId : state?.pointerId
      if (!state || state.pointerId !== pointerId) return


      const didDrag = state.hasStarted
      const target = didDrag ? getPointerDropTarget(state.latestClientX, state.latestClientY) : null
      cleanup()

      if (!didDrag) return
      pointerEvent.preventDefault()

      if (!target) {
        resetDragInteraction()
        return
      }

      commitTimeItemMove(state.item, target.dayIndex, target.element, state.latestClientY)
    }

    function handlePointerCancel() {
      const didDrag = Boolean(activePointerDragRef.current?.hasStarted)
      cleanup()
      if (didDrag) {
        resetDragInteraction()
      }
    }

    activePointerDragCleanupRef.current = cleanup
    window.addEventListener('pointermove', handlePointerMove, { passive: false })
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    window.addEventListener('blur', handlePointerCancel)
  }, [autoScrollCalendarWhileDragging, cancelScheduledDragDropPreview, commitTimeItemMove, getPointerDropTarget, isResizing, isTemplateSelectionMode, resetDragInteraction, scheduleDragDropPreview, slotMinutes, sourceMap])

  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable handler; wrapping in useCallback would cascade through co-located helpers in this large view
  const handleSaveSelection = async (moveScopeArg?: 'this' | 'series', targetSelection = selectionDraft): Promise<boolean> => {
    if (!targetSelection || !draft.title.trim()) return false
    if (isCreatingItemRef.current) return false

    const moveScope = moveScopeArg === 'series' || moveScopeArg === 'this' ? moveScopeArg : undefined

    const duration = Math.max(slotMinutes, targetSelection.endMinute - targetSelection.startMinute)
    const day = weekDays[targetSelection.dayIndex]
    const start_time = buildEventTimestamp(day, targetSelection.startMinute)
    const end_time = new Date(new Date(start_time).getTime() + duration * 60_000).toISOString()

    if (movingItemId) {
      const movingItem = interactionItemMap.get(movingItemId)
        || items.find((entry) => entry.id === movingItemId)
        || (movingItemSnapshot?.id === movingItemId ? movingItemSnapshot : null)
      const sourceEvent = movingItem ? events.find((entry) => entry.id === movingItem.sourceEventId) : null
      if (!movingItem || !sourceEvent) {
        setMovingItemId(null)
        setMovingItemSnapshot(null)
        setIsMoveScopeOpen(false)
        showClipboardStatus('Item not found for moving.')
        return false
      }

      const sourceStart = new Date(sourceEvent.start_time).getTime()
      const sourceEnd = new Date(sourceEvent.end_time).getTime()
      const originalDuration = Math.max(slotMinutes, Math.round((sourceEnd - sourceStart) / 60_000))
      const selectionDuration = Math.max(slotMinutes, targetSelection.endMinute - targetSelection.startMinute)
      const moveDuration = Math.max(originalDuration, selectionDuration)
      const moveStartMinute = targetSelection.startMinute
      const moveStartTime = buildEventTimestamp(day, moveStartMinute)
      const moveEndTime = new Date(new Date(moveStartTime).getTime() + moveDuration * 60_000).toISOString()

      const existingRule = normaliseRecurrenceRule(sourceEvent.recurrence_rule)
      const isRecurringMove = existingRule.type !== 'none'
      const previous = events
      if (isRecurringMove) {
        const saved = await persistRecurringItemEdit(sourceEvent, movingItem.occurrenceStartTime, {
          title: draft.title,
          description: notesToEventDescription(draft.notes),
          location: draft.location || null,
          start_time: moveStartTime,
          end_time: moveEndTime,
          category_ids: draft.categoryIds,
          recurrence_rule: draft.recurrenceRule,
        }, moveScope === 'series' ? 'future' : moveScope)
        if (saved) {
          setSelectionDraft(null)
          setMovingItemId(null)
          setMovingItemSnapshot(null)
          setIsMoveScopeOpen(false)
          setLastSavedAt(Date.now())
          setAutoSaveError(null)
        }
        return saved
      }

      const updatedFields = {
        title: draft.title,
        description: notesToEventDescription(draft.notes),
        start_time: moveStartTime,
        end_time: moveEndTime,
        category_ids: draft.categoryIds,
        recurrence_rule: normaliseRecurrenceRule(draft.recurrenceRule),
      }

      setEvents((prev) => prev.map((entry) => (entry.id === sourceEvent.id ? { ...entry, ...updatedFields } : entry)))

      if (sourceEvent.id) {
        beginEventMutation(sourceEvent.id)
      }
      try {
        await apiClient.put(`/api/user-events/${sourceEvent.id}`, updatedFields)
        setSelectedItemId(movingItemId)
        setSelectionDraft(null)
        setMovingItemId(null)
        setMovingItemSnapshot(null)
        setIsMoveScopeOpen(false)
        setLastSavedAt(Date.now())
        setAutoSaveError(null)
        showClipboardStatus('Item moved.')
        return true
      } catch (err) {
        console.error('Failed to move item:', err)
        if (isRetryableWriteError(err)) {
          const message = err instanceof Error ? err.message : 'Could not reach the server.'
          queueUnsyncedOp({
            eventId: sourceEvent.id,
            kind: 'update',
            method: 'put',
            endpoint: `/api/user-events/${sourceEvent.id}`,
            payload: updatedFields,
            snapshot: { ...sourceEvent, ...updatedFields },
            attempts: 1,
            firstFailedAt: Date.now(),
            lastAttemptAt: Date.now(),
            lastError: message,
          })
          setSelectedItemId(movingItemId)
          setSelectionDraft(null)
          setMovingItemId(null)
          setMovingItemSnapshot(null)
          setIsMoveScopeOpen(false)
          setLastSavedAt(Date.now())
          setAutoSaveError(null)
          showClipboardStatus('Item moved (saved offline).')
          return true
        }
        setEvents(previous)
        showClipboardStatus('Could not move item. Try again.')
        return false
      } finally {
        if (sourceEvent.id) {
          endEventMutation(sourceEvent.id)
        }
      }
    }

    isCreatingItemRef.current = true
    setIsCreatingItem(true)

    const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const pendingRecurrence = normaliseRecurrenceRule(draft.recurrenceRule)
    const pendingSelection = { ...targetSelection }
    const pendingDraft = {
      ...draft,
      categoryIds: [...draft.categoryIds],
      recurrenceRule: pendingRecurrence,
    }
    const pendingEvent: UserEventRecord = {
      id: pendingId,
      title: draft.title,
      description: notesToEventDescription(draft.notes),
      meeting_link: null,
      location: draft.location || null,
      start_time,
      end_time,
      source_type: 'manual',
      source_id: activeModeId || MAIN_SOURCE_ID,
      category_ids: [...draft.categoryIds],
      recurrence_rule: pendingRecurrence,
    }

    setEvents((prev) => [...prev, pendingEvent])
    setIsNewItemDraft(false)
    setSelectedItemId(pendingId)
    setSelectionDraft(null)
    setDraft((prev) => ({ ...prev, title: '', notes: '', location: null, categoryIds: [], recurrenceRule: { type: 'none' } }))
    setExpandedSections((prev) => {
      const next = new Set(prev)
      next.add('editor')
      return next
    })

    // Guard the new item so a silent refetch whose response predates this write
    // cannot drop it from local state before the row is echoed back.
    beginEventMutation(pendingId)
    let committedEventId: string | null = null
    try {
      const { data } = await apiClient.post<{ event: UserEventRecord }>('/api/user-events', {
        title: draft.title,
        description: notesToEventDescription(draft.notes),
        location: draft.location || null,
        start_time,
        end_time,
        category_ids: draft.categoryIds,
        source_id: activeModeId || undefined,
        recurrence_rule: normaliseRecurrenceRule(draft.recurrenceRule),
      })
      const created = data?.event
      if (!created) return false
      const pendingMatch = eventsRef.current.find((entry) => entry.id === pendingId)
      const pendingCategoryIds = Array.isArray(pendingMatch?.category_ids)
        ? pendingMatch.category_ids
        : draft.categoryIds
      const normalised = normaliseCreatedManualEvent(created, {
        fallbackSourceId: activeModeId || MAIN_SOURCE_ID,
        fallbackCategoryIds: pendingCategoryIds,
        fallbackRecurrenceRule: draft.recurrenceRule,
      })
      const pendingTextEdits = collectPendingRowTextEdits(pendingEvent, pendingMatch)
      // Preserve any position the user dragged the pending item to while the create POST was in flight.
      const resolvedEvent = {
        ...normalised,
        ...pendingTextEdits,
        start_time: pendingMatch?.start_time || normalised.start_time,
        end_time: pendingMatch?.end_time || normalised.end_time,
        category_ids: [...pendingCategoryIds],
      }

      committedEventId = resolvedEvent.id
      resolvedPendingEventIdsRef.current.set(pendingId, resolvedEvent.id)
      beginEventMutation(resolvedEvent.id)
      if (finishDeletedPendingCreate(pendingId, resolvedEvent.id)) return true
      setEvents((prev) => replacePendingEvent(prev, pendingId, resolvedEvent))
      setSelectedItemId((prev) => (prev === pendingId ? resolvedEvent.id : prev))
      setCalendarItemContextMenu((prev) => {
        if (!prev || prev.itemId !== pendingId) return prev
        return { ...prev, itemId: resolvedEvent.id }
      })

      const pendingUpdates: PendingRowTextEdits & { category_ids?: string[]; start_time?: string; end_time?: string } = { ...pendingTextEdits }
      if (!areStringArraysEqual(Array.isArray(created.category_ids) ? created.category_ids : [], pendingCategoryIds)) {
        pendingUpdates.category_ids = pendingCategoryIds
      }
      if (created.start_time !== resolvedEvent.start_time || created.end_time !== resolvedEvent.end_time) {
        pendingUpdates.start_time = resolvedEvent.start_time
        pendingUpdates.end_time = resolvedEvent.end_time
      }
      if (Object.keys(pendingUpdates).length > 0) {
        void apiClient.put(`/api/user-events/${resolvedEvent.id}`, pendingUpdates).catch((error) => {
          console.error('Failed to persist pending item update:', error)
        })
      }
      return true
    } catch (err) {
      console.error('Failed to save item:', err)
      if (isRetryableWriteError(err)) {
        const message = err instanceof Error ? err.message : 'Could not reach the server.'
        queueUnsyncedOp({
          eventId: pendingId,
          kind: 'create',
          method: 'post',
          endpoint: '/api/user-events',
          payload: {
            title: draft.title,
            description: notesToEventDescription(draft.notes),
            location: draft.location || null,
            start_time,
            end_time,
            category_ids: draft.categoryIds,
            source_id: activeModeId || undefined,
            recurrence_rule: normaliseRecurrenceRule(draft.recurrenceRule),
          },
          snapshot: pendingEvent,
          attempts: 1,
          firstFailedAt: Date.now(),
          lastAttemptAt: Date.now(),
          lastError: message,
        })
        showClipboardStatus('Saved on this device. Will sync once the connection is restored.')
        return true
      }
      setEvents((prev) => prev.filter((entry) => entry.id !== pendingId))
      setSelectedItemId(null)
      setIsNewItemDraft(true)
      setSelectionDraft(pendingSelection)
      setDraft(pendingDraft)
      showClipboardStatus('Could not save item. Try again.')
      return false
    } finally {
      endEventMutation(pendingId)
      if (committedEventId) {
        endEventMutation(committedEventId)
      }
      isCreatingItemRef.current = false
      setIsCreatingItem(false)
    }
  }

  // Saves the current selection/draft, then closes the left panel if the
  // originating surface's "close left panel on save" setting is active.
  const handleSaveSelectionFromSurface = useCallback(
    async (
      surface: CloseLeftPanelOnSaveSurface,
      moveOptions?: { scope?: 'this' | 'series'; selection?: SelectionDraft }
    ): Promise<boolean> => {
      const saved = await handleSaveSelection(moveOptions?.scope, moveOptions?.selection)
      if (saved) {
        closeLeftPanelAfterSave(surface)
      }
      return saved
    },
    [closeLeftPanelAfterSave, handleSaveSelection]
  )

  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable handler; wrapping in useCallback would cascade through co-located helpers in this large view
  const handleDiscardSelectionDraft = (options?: { preserveCustomContent?: boolean }) => {
    if (isCreatingItemRef.current) return
    if (selectedItem) return

    // When invoked from the Esc key we keep any Title/tags the user wrote or
    // modified by hand. Untouched quick-template values still get cleared so
    // leftover quick-button content does not linger. The Discard button passes
    // no options, so it always clears the draft.
    const shouldPreserveCustomContent = Boolean(
      options?.preserveCustomContent && !draftMatchesQuickTemplate(draft, quickTemplates)
    )

    setIsTemplateSelectionMode(false)
    setPendingTemplateSourceId(null)
    setPendingTemplateQuickName('')

    if (movingItemId) {
      setSelectedItemId(movingItemId)
      setSelectionDraft(null)
      setIsSelecting(false)
      setIsSelectionAdjusterExpanded(false)
      setIsItemAdjusterExpanded(false)
      setIsFullEditorOpen(false)
      setMovingItemId(null)
      setMovingItemSnapshot(null)
      setIsMoveScopeOpen(false)
      return
    }

    setSelectedItemId(null)
    setSelectionDraft(null)
    setIsSelecting(false)
    setIsSelectionAdjusterExpanded(false)
    setIsItemAdjusterExpanded(false)
    setIsFullEditorOpen(false)
    setShowItemRecurrencePanel(false)

    if (shouldPreserveCustomContent) {
      return
    }

    setDraft((prev) => ({
      ...prev,
      title: '',
      notes: '',
      location: null,
      categoryIds: [],
      sourceId: MAIN_SOURCE_ID,
      recurrenceRule: { type: 'none' },
    }))
    setIsLocationFieldVisible(false)
    setExpandedSections((prev) => {
      const next = new Set(prev)
      next.delete('editor')
      return next
    })
  }

  const openFullEditor = () => {
    openEditorSurface()
  }

  const showClipboardStatus = useCallback((message: string) => {
    setClipboardStatus(message)
    if (clipboardStatusTimeoutRef.current) {
      window.clearTimeout(clipboardStatusTimeoutRef.current)
    }
    clipboardStatusTimeoutRef.current = window.setTimeout(() => {
      setClipboardStatus((prev) => (prev === message ? null : prev))
      clipboardStatusTimeoutRef.current = null
    }, 2200)
  }, [])

  const showDescriptionHint = useCallback(() => {
    setIsDescriptionHintActive(true)
    if (descriptionHintTimeoutRef.current) {
      window.clearTimeout(descriptionHintTimeoutRef.current)
    }
    descriptionHintTimeoutRef.current = window.setTimeout(() => {
      setIsDescriptionHintActive(false)
      descriptionHintTimeoutRef.current = null
    }, 3000)
  }, [])

  const applyQuickTemplate = useCallback(async (template: QuickTemplate): Promise<void> => {
    const appliedTitle = template.quickName === '' ? template.title : template.quickName
    const nextDraft: ItemDraft = {
      title: appliedTitle,
      notes: template.notes,
      location: null,
      categoryIds: template.categoryIds,
      sourceId: MAIN_SOURCE_ID,
      recurrenceRule: { type: 'none' },
    }

    setSelectedItemId(null)
    setIsNewItemDraft(true)
    setDraft((prev) => ({ ...prev, ...nextDraft }))
    setIsLocationFieldVisible(false)
    if (isPhoneLayout && !selectionDraft) {
      setQuickTemplateAwaitingTime(template.quickName || template.title || 'Quick Object')
      setIsMobileQuickListExpanded(false)
      setIsFullEditorOpen(false)
      closeLeftPanel()
    } else if (isPhoneLayout) {
      setQuickTemplateAwaitingTime(null)
      openEditorSurface({ autoFocusTitle: !nextDraft.title.trim() })
    } else {
      setShowItemRecurrencePanel(false)
      openLeftPanelSection('editor')
    }

    // Keep keyboard flow in the title field after template apply.
    if (!isPhoneLayout || selectionDraft) {
      window.requestAnimationFrame(() => {
        selectionTitleInputRef.current?.focus()
      })
    }

    if (!selectionDraft) {
      showClipboardStatus(isPhoneLayout
        ? `Template "${template.quickName}" ready. Tap a start time or hold and drag on the calendar.`
        : `Template "${template.quickName}" loaded. Select Time on the calendar.`)
      return
    }

    if (!template.autoSaveEnabled) {
      showClipboardStatus(`Template "${template.quickName}" loaded. Time selected -- press Save Item to create it.`)
      return
    }

    if (isCreatingItemRef.current) return

    const duration = Math.max(slotMinutes, selectionDraft.endMinute - selectionDraft.startMinute)
    const day = weekDays[selectionDraft.dayIndex]
    const start_time = buildEventTimestamp(day, selectionDraft.startMinute)
    const end_time = new Date(new Date(start_time).getTime() + duration * 60_000).toISOString()

    isCreatingItemRef.current = true
    setIsCreatingItem(true)

    const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const pendingEvent: UserEventRecord = {
      id: pendingId,
      title: nextDraft.title,
      description: notesToEventDescription(nextDraft.notes),
      meeting_link: null,
      location: null,
      start_time,
      end_time,
      source_type: 'manual',
      source_id: activeModeId || MAIN_SOURCE_ID,
      category_ids: nextDraft.categoryIds,
      recurrence_rule: { type: 'none' },
    }

    // Add optimistically and guard the pending id so a concurrent authoritative
    // refetch (e.g. triggered by an unrelated move/delete broadcast) cannot wipe
    // this item from local state before the create POST is echoed back.
    setEvents((prev) => [...prev, pendingEvent])
    setSelectedItemId(pendingId)
    setSelectionDraft(null)
    setMovingItemId(null)
    setMovingItemSnapshot(null)
    setExpandedSections((prev) => {
      const next = new Set(prev)
      next.add('editor')
      return next
    })
    beginEventMutation(pendingId)

    try {
      const { data } = await apiClient.post<{ event: UserEventRecord }>('/api/user-events', {
        title: nextDraft.title,
        description: notesToEventDescription(nextDraft.notes),
        start_time,
        end_time,
        category_ids: nextDraft.categoryIds,
        source_id: activeModeId || undefined,
      })
      const created = data?.event
      if (!created) {
        setEvents((prev) => prev.filter((entry) => entry.id !== pendingId))
        setSelectedItemId(null)
        setIsNewItemDraft(true)
        showClipboardStatus('Could not apply template. Try again.')
        return
      }

      const pendingMatch = eventsRef.current.find((entry) => entry.id === pendingId)
      const pendingCategoryIds = Array.isArray(pendingMatch?.category_ids)
        ? pendingMatch.category_ids
        : nextDraft.categoryIds
      const pendingTextEdits = collectPendingRowTextEdits(pendingEvent, pendingMatch)
      const normalised: UserEventRecord = {
        ...created,
        ...pendingTextEdits,
        source_id: created.source_id || MAIN_SOURCE_ID,
        // Preserve any position the user dragged the pending item to while the create POST was in flight.
        start_time: pendingMatch?.start_time || created.start_time,
        end_time: pendingMatch?.end_time || created.end_time,
        category_ids: pendingCategoryIds,
      }

      resolvedPendingEventIdsRef.current.set(pendingId, normalised.id)
      beginEventMutation(normalised.id)
      if (finishDeletedPendingCreate(pendingId, normalised.id)) return
      setEvents((prev) => replacePendingEvent(prev, pendingId, normalised))
      setSelectedItemId((prev) => (prev === pendingId ? normalised.id : prev))
      showDescriptionHint()
      showClipboardStatus(`Template "${template.quickName}" applied. Edit it here or open Full View.`)
      // Autosaving a Quick Object against an existing selection behaves like a
      // Calendar Grid save -- respect that surface's close-on-save setting.
      closeLeftPanelAfterSave('calendarGrid')

      const templateUpdates: PendingRowTextEdits & { category_ids?: string[]; start_time?: string; end_time?: string } = { ...pendingTextEdits }
      if (!areStringArraysEqual(Array.isArray(created.category_ids) ? created.category_ids : [], pendingCategoryIds)) {
        templateUpdates.category_ids = pendingCategoryIds
      }
      if (created.start_time !== normalised.start_time || created.end_time !== normalised.end_time) {
        templateUpdates.start_time = normalised.start_time
        templateUpdates.end_time = normalised.end_time
      }
      if (Object.keys(templateUpdates).length > 0) {
        void apiClient.put(`/api/user-events/${normalised.id}`, templateUpdates).catch((error) => {
          console.error('Failed to persist pending template position update:', error)
        })
      }
    } catch (err) {
      console.error('Failed to apply template:', err)
      setEvents((prev) => prev.filter((entry) => entry.id !== pendingId))
      setSelectedItemId(null)
      setIsNewItemDraft(true)
      showClipboardStatus('Could not apply template. Try again.')
    } finally {
      endEventMutation(pendingId)
      const resolvedId = resolvedPendingEventIdsRef.current.get(pendingId)
      if (resolvedId) {
        endEventMutation(resolvedId)
      }
      isCreatingItemRef.current = false
      setIsCreatingItem(false)
    }
  }, [activeModeId, beginEventMutation, closeLeftPanel, closeLeftPanelAfterSave, endEventMutation, finishDeletedPendingCreate, isPhoneLayout, openEditorSurface, openLeftPanelSection, selectionDraft, showClipboardStatus, showDescriptionHint, slotMinutes, weekDays])

  const saveSelectedItemAsTemplate = useCallback(() => {
    if (!pendingTemplateSourceItem) {
      showClipboardStatus('Select a calendar item first.')
      return
    }

    const quickName = pendingTemplateQuickName === ''
      ? buildDefaultQuickTemplateName(pendingTemplateSourceItem.title)
      : pendingTemplateQuickName
    const nextTemplate: QuickTemplate = {
      id: createQuickTemplateId(),
      quickName,
      title: pendingTemplateSourceItem.title,
      notes: pendingTemplateSourceItem.notes,
      categoryIds: pendingTemplateSourceItem.categoryIds,
      autoSaveEnabled: false,
      sourceItemId: pendingTemplateSourceItem.id,
      createdAt: new Date().toISOString(),
    }

    quickTemplatesTouchedRef.current = true
    setQuickTemplates((prev) => [nextTemplate, ...prev])
    setPendingTemplateSourceId(null)
    setPendingTemplateQuickName('')
    showClipboardStatus(`Saved template "${quickName}".`)
  }, [pendingTemplateQuickName, pendingTemplateSourceItem, showClipboardStatus])

  const updateQuickTemplateName = useCallback((templateId: string, nextName: string) => {
    quickTemplatesTouchedRef.current = true
    setQuickTemplates((prev) =>
      prev.map((template) => (template.id === templateId ? { ...template, quickName: nextName } : template))
    )
  }, [])

  const updateQuickTemplateAutoSave = useCallback((templateId: string, enabled: boolean) => {
    quickTemplatesTouchedRef.current = true
    setQuickTemplates((prev) =>
      prev.map((template) => (template.id === templateId ? { ...template, autoSaveEnabled: enabled } : template))
    )
  }, [])

  const commitQuickTemplateName = useCallback((templateId: string, nextName: string) => {
    const fallbackName = 'Quick template'
    const nextStoredName = nextName === '' ? fallbackName : nextName
    quickTemplatesTouchedRef.current = true
    setQuickTemplates((prev) =>
      prev.map((template) => (template.id === templateId ? { ...template, quickName: nextStoredName } : template))
    )
  }, [])

  const deleteQuickTemplate = useCallback((templateId: string) => {
    quickTemplatesTouchedRef.current = true
    setQuickTemplates((prev) => {
      const next = prev.filter((template) => template.id !== templateId)
      if (prev.length > 0 && next.length === 0) {
        allowClearQuickTemplatesRef.current = true
      }
      return next
    })
    setDeletingTemplateId((current) => (current === templateId ? null : current))
    setDeletingTemplatePopoverPosition(null)
    showClipboardStatus('Template deleted.')
  }, [showClipboardStatus])

  const copyItemById = useCallback((itemId: string): boolean => {
    const item = interactionItemMap.get(itemId) || items.find((entry) => entry.id === itemId)
    const sourceEvent = item ? events.find((event) => event.id === item.sourceEventId) : null
    if (!sourceEvent) {
      showClipboardStatus('Unable to copy item metadata right now.')
      return false
    }

    const start = new Date(sourceEvent.start_time)
    const end = new Date(sourceEvent.end_time)
    const durationMinutes = Math.max(slotMinutes, Math.round((end.getTime() - start.getTime()) / 60_000))
    const sourceId = sourceEvent.source_id || MAIN_SOURCE_ID

    const copiedDescription = sourceEvent.source_type === 'manual'
      ? notesToEventDescription(sourceEvent.description || '')
      : buildCopiedDescriptionWithLocation(sourceEvent.description, sourceEvent.location)

    setCopiedItem({
      title: sourceEvent.title,
      description: copiedDescription,
      meetingLink: sourceEvent.meeting_link,
      location: sourceEvent.location,
      durationMinutes,
      isPublic: !!sourceEvent.is_public,
      sourceId,
      sourceType: sourceEvent.source_type,
      categoryIds: Array.isArray(sourceEvent.category_ids) ? sourceEvent.category_ids : [],
      recurrenceRule: normaliseRecurrenceRule(sourceEvent.recurrence_rule),
    })
    setMultiClipboard(null)
    showClipboardStatus('Item metadata copied. Select a new slot and paste.')
    return true
  }, [events, interactionItemMap, items, showClipboardStatus, slotMinutes])

  const copySelectedItem = useCallback((): boolean => {
    if (!selectedItem) {
      showClipboardStatus('Select an item first to copy its metadata.')
      return false
    }
    return copyItemById(selectedItem.id)
  }, [copyItemById, selectedItem, showClipboardStatus])

  const isMultiSelected = useCallback(
    (interactionId: string) => multiSelectedItemIds.has(interactionId),
    [multiSelectedItemIds]
  )

  const clearMultiSelect = useCallback(() => {
    setMultiSelectedItemIds(new Set())
  }, [])

  const toggleMultiSelectItem = useCallback((interactionId: string) => {
    setMultiSelectedItemIds((prev) => {
      const next = new Set(prev)
      const wasToggleTargetSelected = next.has(interactionId)
      // Ctrl+click while a single item is active (not yet part of the
      // multi-select set) folds that item into the multi-select too, so the
      // user never loses the item they started from.
      if (selectedItemId && selectedItemId !== interactionId && !next.has(selectedItemId)) {
        next.add(selectedItemId)
      }
      if (wasToggleTargetSelected) {
        next.delete(interactionId)
      } else {
        next.add(interactionId)
      }
      return next
    })
    setSelectedItemId(null)
  }, [selectedItemId])

  const getOverlappingInteractionIds = useCallback((dayIndex: number, startMinute: number, endMinute: number): string[] => {
    const ids: string[] = []
    for (const candidate of items) {
      if (candidate.dayIndex !== dayIndex) continue
      const candidateStart = candidate.startMinute
      const candidateEnd = candidateStart + candidate.durationMinutes
      if (candidateStart < endMinute && candidateEnd > startMinute) {
        ids.push(getTimeItemInteractionId(candidate))
      }
    }
    return ids
  }, [items])

  const handleSelectOverlappingItems = useCallback(() => {
    if (!selectionDraft) return
    const ids = [...new Set(selectionDaySegments.flatMap((segment) =>
      getOverlappingInteractionIds(segment.dayIndex, segment.startMinute, segment.endMinute)
    ))]
    if (ids.length === 0) {
      showClipboardStatus('No time items overlap this selection.')
      return
    }
    setSelectedItemId(null)
    setMultiSelectedItemIds(new Set(ids))
    setSelectionDraft(null)
    setIsSelecting(false)
    showClipboardStatus(`Selected ${ids.length} overlapping item${ids.length === 1 ? '' : 's'}. Ctrl+click an item to adjust.`)
  }, [getOverlappingInteractionIds, selectionDaySegments, selectionDraft, showClipboardStatus])

  // Same overlap lookup as handleSelectOverlappingItems, but merges into the
  // existing multi-select set instead of replacing it.
  const handleAddOverlappingItemsToMultiSelect = useCallback(() => {
    if (!selectionDraft) return
    const ids = [...new Set(selectionDaySegments.flatMap((segment) =>
      getOverlappingInteractionIds(segment.dayIndex, segment.startMinute, segment.endMinute)
    ))]
    if (ids.length === 0) {
      showClipboardStatus('No time items overlap this selection.')
      return
    }
    setSelectedItemId(null)
    setMultiSelectedItemIds((prev) => new Set([...prev, ...ids]))
    setSelectionDraft(null)
    setIsSelecting(false)
    showClipboardStatus(`Added ${ids.length} overlapping item${ids.length === 1 ? '' : 's'} to multi-select.`)
  }, [getOverlappingInteractionIds, selectionDaySegments, selectionDraft, showClipboardStatus])

  const getMultiSelectTargets = useCallback((): TimeItem[] => {
    return Array.from(multiSelectedItemIds)
      .map((id) => interactionItemMap.get(id) || items.find((entry) => entry.id === id))
      .filter((entry): entry is TimeItem => Boolean(entry))
  }, [interactionItemMap, items, multiSelectedItemIds])

  const handleBulkDeleteMultiSelected = useCallback(async () => {
    const targets = getMultiSelectTargets()
    if (targets.length === 0) return
    const hasReadOnly = targets.some((target) => isReadOnlySource(sourceMap.get(target.sourceId)))
    if (hasReadOnly) {
      showClipboardStatus('One or more selected items are read-only and cannot be deleted here.')
      return
    }
    const sourceEventIds = Array.from(new Set(targets.map((target) => target.sourceEventId)))
    const previous = events
    for (const eventId of sourceEventIds) beginEventDeletion(eventId)
    setEvents((prev) => prev.filter((entry) => !sourceEventIds.includes(entry.id)))
    if (selectedItemId && sourceEventIds.includes(selectedItemId)) {
      setSelectedItemId(null)
    }
    clearMultiSelect()
    try {
      await Promise.all(sourceEventIds.map((id) => apiClient.delete(`/api/user-events/${id}`)))
      for (const eventId of sourceEventIds) endEventDeletion(eventId)
      notifyTimeManagementDataChanged('events-deleted')
      showClipboardStatus(`Deleted ${sourceEventIds.length} item${sourceEventIds.length === 1 ? '' : 's'}.`)
    } catch (err) {
      console.error('Failed to delete selected items:', err)
      for (const eventId of sourceEventIds) cancelEventDeletion(eventId)
      setEvents(previous)
      showClipboardStatus('Could not delete selected items. Try again.')
    }
  }, [beginEventDeletion, cancelEventDeletion, clearMultiSelect, endEventDeletion, events, getMultiSelectTargets, notifyTimeManagementDataChanged, selectedItemId, showClipboardStatus, sourceMap])

  const buildMultiClipboard = useCallback((targets: TimeItem[], isCut: boolean): MultiClipboardData | null => {
    if (targets.length === 0) return null
    const anchor = targets.reduce((min, entry) => {
      if (entry.dayIndex < min.dayIndex) return entry
      if (entry.dayIndex === min.dayIndex && entry.startMinute < min.startMinute) return entry
      return min
    }, targets[0])

    const clipboardItems: MultiClipboardItem[] = []
    for (const target of targets) {
      const sourceEvent = events.find((entry) => entry.id === target.sourceEventId)
      if (!sourceEvent) continue
      const start = new Date(sourceEvent.start_time)
      const end = new Date(sourceEvent.end_time)
      const durationMinutes = Math.max(slotMinutes, Math.round((end.getTime() - start.getTime()) / 60_000))
      const sourceId = sourceEvent.source_id || MAIN_SOURCE_ID
      const copiedDescription = sourceEvent.source_type === 'manual'
        ? notesToEventDescription(sourceEvent.description || '')
        : buildCopiedDescriptionWithLocation(sourceEvent.description, sourceEvent.location)

      clipboardItems.push({
        title: sourceEvent.title,
        description: copiedDescription,
        meetingLink: sourceEvent.meeting_link,
        location: sourceEvent.location,
        durationMinutes,
        isPublic: !!sourceEvent.is_public,
        sourceId,
        sourceType: sourceEvent.source_type,
        categoryIds: Array.isArray(sourceEvent.category_ids) ? sourceEvent.category_ids : [],
        recurrenceRule: normaliseRecurrenceRule(sourceEvent.recurrence_rule),
        dayOffset: target.dayIndex - anchor.dayIndex,
        minuteOffset: target.startMinute - anchor.startMinute,
      })
    }
    if (clipboardItems.length === 0) return null
    return {
      items: clipboardItems,
      isCut,
      sourceEventIds: targets.map((target) => target.sourceEventId),
    }
  }, [events, slotMinutes])

  const handleBulkCopyMultiSelected = useCallback(() => {
    const targets = getMultiSelectTargets()
    const clipboard = buildMultiClipboard(targets, false)
    if (!clipboard) {
      showClipboardStatus('Unable to copy selected items right now.')
      return
    }
    setMultiClipboard(clipboard)
    setCopiedItem(null)
    showClipboardStatus(`Copied ${clipboard.items.length} item${clipboard.items.length === 1 ? '' : 's'}. Select a destination and paste.`)
  }, [buildMultiClipboard, getMultiSelectTargets, showClipboardStatus])

  const handleBulkCutMultiSelected = useCallback(() => {
    const targets = getMultiSelectTargets()
    const hasReadOnly = targets.some((target) => isReadOnlySource(sourceMap.get(target.sourceId)))
    if (hasReadOnly) {
      showClipboardStatus('One or more selected items are read-only and cannot be cut.')
      return
    }
    const clipboard = buildMultiClipboard(targets, true)
    if (!clipboard) {
      showClipboardStatus('Unable to cut selected items right now.')
      return
    }
    setMultiClipboard(clipboard)
    setCopiedItem(null)
    showClipboardStatus(`Cut ${clipboard.items.length} item${clipboard.items.length === 1 ? '' : 's'}. ${isPhoneLayout ? 'Tap a destination to move.' : 'Select a destination and paste.'}`)
  }, [buildMultiClipboard, getMultiSelectTargets, isPhoneLayout, showClipboardStatus, sourceMap])

  const pasteMultiClipboardToSelection = useCallback(async (targetSelection = selectionDraft): Promise<boolean> => {
    if (!targetSelection) {
      showClipboardStatus('Select a destination time slot before pasting.')
      return false
    }
    if (!multiClipboard) {
      showClipboardStatus('Copy or cut items first.')
      return false
    }

    const anchorDayIndex = targetSelection.dayIndex
    const anchorDay = weekDays[anchorDayIndex]
    const anchorStartMinute = targetSelection.startMinute
    const previous = events
    const pendingEvents: UserEventRecord[] = multiClipboard.items.map((clipboardItem, index) => {
      // Use real date arithmetic (not a clamped index into the visible week)
      // so items more than a week apart correctly land in adjacent weeks.
      const targetDay = addDays(anchorDay, clipboardItem.dayOffset)
      const maxStart = Math.max(0, MINUTES_IN_DAY - clipboardItem.durationMinutes)
      const rawMinute = anchorStartMinute + clipboardItem.minuteOffset
      const startMinute = Math.max(0, Math.min(maxStart, rawMinute))
      const startTime = buildEventTimestamp(targetDay, startMinute)
      const endTime = new Date(new Date(startTime).getTime() + clipboardItem.durationMinutes * 60_000).toISOString()
      return {
        id: `pending-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
        title: clipboardItem.title,
        description: clipboardItem.description,
        meeting_link: clipboardItem.meetingLink,
        location: clipboardItem.location,
        start_time: startTime,
        end_time: endTime,
        is_public: clipboardItem.isPublic,
        source_type: 'manual',
        source_id: activeModeId || MAIN_SOURCE_ID,
        category_ids: clipboardItem.categoryIds,
        recurrence_rule: clipboardItem.recurrenceRule,
      }
    })

    setEvents((prev) => [...prev, ...pendingEvents])
    setSelectionDraft(null)
    setMultiSelectedItemIds(new Set(pendingEvents.map((entry) => entry.id)))
    for (const pendingEvent of pendingEvents) beginEventMutation(pendingEvent.id)

    try {
      const results = await Promise.all(pendingEvents.map((pendingEvent) =>
        apiClient.post<{ event: UserEventRecord }>('/api/user-events', {
          title: pendingEvent.title,
          description: pendingEvent.description,
          meeting_link: pendingEvent.meeting_link,
          location: pendingEvent.location,
          start_time: pendingEvent.start_time,
          end_time: pendingEvent.end_time,
          is_public: pendingEvent.is_public,
          category_ids: pendingEvent.category_ids,
          source_id: activeModeId || undefined,
          recurrence_rule: pendingEvent.recurrence_rule,
        })
      ))

      const resolvedItems = pendingEvents
        .map((pendingEvent, index) => {
          const record = results[index]?.data?.event
          if (!record) return null
          const normalised = normaliseCreatedManualEvent(record, {
            fallbackSourceId: activeModeId || MAIN_SOURCE_ID,
            fallbackCategoryIds: multiClipboard.items[index].categoryIds,
            fallbackRecurrenceRule: multiClipboard.items[index].recurrenceRule,
          })
          return { pendingId: pendingEvent.id, normalised }
        })
        .filter((entry): entry is { pendingId: string; normalised: UserEventRecord } => Boolean(entry))

      setEvents((prev) => prev.map((entry) => {
        const match = resolvedItems.find((resolved) => resolved.pendingId === entry.id)
        return match ? match.normalised : entry
      }))
      for (const { normalised } of resolvedItems) beginEventMutation(normalised.id)
      setMultiSelectedItemIds(new Set(resolvedItems.map((entry) => entry.normalised.id)))
      showClipboardStatus(`Pasted ${resolvedItems.length} item${resolvedItems.length === 1 ? '' : 's'}.`)

      if (multiClipboard.isCut) {
        const cutIds = multiClipboard.sourceEventIds
        setEvents((prev) => prev.filter((entry) => !cutIds.includes(entry.id)))
        try {
          await Promise.all(cutIds.map((id) => apiClient.delete(`/api/user-events/${id}`)))
        } catch (err) {
          console.error('Failed to remove cut items after paste:', err)
          showClipboardStatus('Pasted, but could not remove the original cut items. Delete them manually.')
        }
        setMultiClipboard(null)
      }

      return true
    } catch (err) {
      console.error('Failed to paste selected items:', err)
      setEvents(previous)
      setMultiSelectedItemIds(new Set())
      showClipboardStatus('Could not paste selected items. Try again.')
      return false
    }
  }, [activeModeId, beginEventMutation, events, multiClipboard, selectionDraft, showClipboardStatus, weekDays])

  const pasteCopiedItemToSelection = useCallback(async (): Promise<boolean> => {
    if (!selectionDraft) {
      showClipboardStatus('Select a destination time slot before pasting.')
      return false
    }

    if (!copiedItem) {
      showClipboardStatus('Copy an item first.')
      return false
    }

    const targetDay = weekDays[selectionDraft.dayIndex]
    const maxStart = Math.max(0, MINUTES_IN_DAY - copiedItem.durationMinutes)
    const startMinute = Math.min(selectionDraft.startMinute, maxStart)
    const startTime = buildEventTimestamp(targetDay, startMinute)
    const endTime = new Date(new Date(startTime).getTime() + copiedItem.durationMinutes * 60_000).toISOString()
    const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const pendingSelection = { ...selectionDraft }
    const pendingEvent: UserEventRecord = {
      id: pendingId,
      title: copiedItem.title,
      description: copiedItem.description,
      meeting_link: copiedItem.meetingLink,
      location: copiedItem.location,
      start_time: startTime,
      end_time: endTime,
      is_public: copiedItem.isPublic,
      source_type: 'manual',
      source_id: activeModeId || MAIN_SOURCE_ID,
      category_ids: copiedItem.categoryIds,
      recurrence_rule: copiedItem.recurrenceRule,
    }

    setEvents((prev) => [...prev, pendingEvent])
    setSelectedItemId(pendingId)
    setSelectionDraft(null)
    openEditorForItemSelection({
      notes: copiedItem.description ?? '',
      durationMinutes: copiedItem.durationMinutes,
    })

    // Guard the pasted item so a silent refetch whose response predates this
    // write cannot drop it before the row is echoed back by the server.
    beginEventMutation(pendingId)
    let committedEventId: string | null = null
    try {
      const { data } = await apiClient.post<{ event: UserEventRecord }>('/api/user-events', {
        title: copiedItem.title,
        description: copiedItem.description,
        meeting_link: copiedItem.meetingLink,
        location: copiedItem.location,
        start_time: startTime,
        end_time: endTime,
        is_public: copiedItem.isPublic,
        category_ids: copiedItem.categoryIds,
        source_id: activeModeId || undefined,
        recurrence_rule: copiedItem.recurrenceRule,
      })
      const created = data?.event
      if (!created) return false
      const pendingMatch = eventsRef.current.find((entry) => entry.id === pendingId)
      const pendingCategoryIds = Array.isArray(pendingMatch?.category_ids)
        ? pendingMatch.category_ids
        : copiedItem.categoryIds
      const normalised = normaliseCreatedManualEvent(created, {
        fallbackSourceId: activeModeId || MAIN_SOURCE_ID,
        fallbackCategoryIds: pendingCategoryIds,
        fallbackRecurrenceRule: copiedItem.recurrenceRule,
      })
      const pendingTextEdits = collectPendingRowTextEdits(pendingEvent, pendingMatch)
      const resolvedEvent = {
        ...normalised,
        ...pendingTextEdits,
        start_time: pendingMatch?.start_time || normalised.start_time,
        end_time: pendingMatch?.end_time || normalised.end_time,
        category_ids: [...pendingCategoryIds],
      }

      committedEventId = resolvedEvent.id
      resolvedPendingEventIdsRef.current.set(pendingId, resolvedEvent.id)
      beginEventMutation(resolvedEvent.id)
      if (finishDeletedPendingCreate(pendingId, resolvedEvent.id)) return true
      setEvents((prev) => replacePendingEvent(prev, pendingId, resolvedEvent))
      setSelectedItemId((prev) => (prev === pendingId ? resolvedEvent.id : prev))
      showClipboardStatus('Pasted item with original metadata and duration.')

      const pendingUpdates: PendingRowTextEdits & { category_ids?: string[]; start_time?: string; end_time?: string } = { ...pendingTextEdits }
      if (!areStringArraysEqual(Array.isArray(created.category_ids) ? created.category_ids : [], pendingCategoryIds)) {
        pendingUpdates.category_ids = pendingCategoryIds
      }
      if (created.start_time !== resolvedEvent.start_time || created.end_time !== resolvedEvent.end_time) {
        pendingUpdates.start_time = resolvedEvent.start_time
        pendingUpdates.end_time = resolvedEvent.end_time
      }
      if (Object.keys(pendingUpdates).length > 0) {
        await apiClient.put(`/api/user-events/${resolvedEvent.id}`, pendingUpdates).catch((error) => {
          console.error('Failed to persist edits made while pasting:', error)
          if (isRetryableWriteError(error)) {
            const message = error instanceof Error ? error.message : 'Could not reach the server.'
            queueUnsyncedOp({
              eventId: resolvedEvent.id,
              kind: 'update',
              method: 'put',
              endpoint: `/api/user-events/${resolvedEvent.id}`,
              payload: pendingUpdates,
              snapshot: resolvedEvent,
              attempts: 1,
              firstFailedAt: Date.now(),
              lastAttemptAt: Date.now(),
              lastError: message,
            })
          }
        })
      }

      return true
    } catch (err) {
      console.error('Failed to paste item:', err)
      if (isRetryableWriteError(err)) {
        const message = err instanceof Error ? err.message : 'Could not reach the server.'
        queueUnsyncedOp({
          eventId: pendingId,
          kind: 'create',
          method: 'post',
          endpoint: '/api/user-events',
          payload: {
            title: copiedItem.title,
            description: copiedItem.description,
            meeting_link: copiedItem.meetingLink,
            location: copiedItem.location,
            start_time: startTime,
            end_time: endTime,
            is_public: copiedItem.isPublic,
            category_ids: copiedItem.categoryIds,
            source_id: activeModeId || undefined,
            recurrence_rule: copiedItem.recurrenceRule,
          },
          snapshot: pendingEvent,
          attempts: 1,
          firstFailedAt: Date.now(),
          lastAttemptAt: Date.now(),
          lastError: message,
        })
        showClipboardStatus('Saved on this device. Will sync once the connection is restored.')
        return true
      }
      setEvents((prev) => prev.filter((entry) => entry.id !== pendingId))
      setSelectedItemId(null)
      setSelectionDraft(pendingSelection)
      setIsNewItemDraft(true)
      showClipboardStatus('Could not paste item. Try again.')
      return false
    } finally {
      endEventMutation(pendingId)
      if (committedEventId) {
        endEventMutation(committedEventId)
      }
    }
  }, [activeModeId, beginEventMutation, copiedItem, endEventMutation, finishDeletedPendingCreate, openEditorForItemSelection, queueUnsyncedOp, selectionDraft, showClipboardStatus, weekDays])

  const persistSelectedItem = useCallback(async (
    nextDraft: ItemDraft,
    options?: { showErrorToast?: boolean }
  ): Promise<boolean> => {
    if (!selectedEvent || !nextDraft.title.trim()) return false
    if (isSelectedReadOnly) return false

    const showErrorToast = options?.showErrorToast ?? true
    const writeId = resolveEventId(selectedEvent.id)
    const isAwaitingCreate = isPendingEventId(writeId)
    const previousRow = eventsRef.current.find((item) => item.id === writeId) || selectedEvent
    const updatedFields = {
      title: nextDraft.title,
      description: notesToEventDescription(nextDraft.notes),
      location: nextDraft.location || null,
      meeting_link: selectedEvent.meeting_link ? nextDraft.location || null : null,
      category_ids: nextDraft.categoryIds,
      recurrence_rule: normaliseRecurrenceRule(nextDraft.recurrenceRule),
    }

    if (normaliseRecurrenceRule(selectedEvent.recurrence_rule).type !== 'none' && selectedItem) {
      const saved = await persistRecurringItemEdit(selectedEvent, selectedItem.occurrenceStartTime, updatedFields)
      if (saved) {
        setLastSavedAt(Date.now())
        setAutoSaveError(null)
      }
      return saved
    }

    const applyUpdatedFields = (list: UserEventRecord[]): UserEventRecord[] => {
      let hasChanges = false
      const next = list.map((item) => {
        if (item.id !== writeId) return item

        const itemCategoryIds = Array.isArray(item.category_ids) ? item.category_ids : []
        const hasCategoryChanges = !areStringArraysEqual(itemCategoryIds, updatedFields.category_ids)
        const hasTitleChanges = item.title !== updatedFields.title
        const hasDescriptionChanges = item.description !== updatedFields.description
        const hasLocationChanges = (item.location || null) !== updatedFields.location
        const hasRecurrenceChanges = JSON.stringify(normaliseRecurrenceRule(item.recurrence_rule)) !== JSON.stringify(updatedFields.recurrence_rule)

        if (!hasCategoryChanges && !hasTitleChanges && !hasDescriptionChanges && !hasLocationChanges && !hasRecurrenceChanges) {
          return item
        }

        hasChanges = true
        return { ...item, ...updatedFields }
      })

      return hasChanges ? next : list
    }

    if (isAwaitingCreate) {
      // The create POST is still in flight, so there is no server row to PUT to
      // yet. Edit the pending row; the create response carries these edits over
      // to the real row. eventsRef is updated eagerly so a response landing
      // before the next render still sees them.
      eventsRef.current = applyUpdatedFields(eventsRef.current)
      setEvents(applyUpdatedFields)
      setLastSavedAt(Date.now())
      setAutoSaveError(null)
      return true
    }

    setEvents(applyUpdatedFields)

    beginEventMutation(writeId)
    try {
      const response = await apiClient.put<{ event: UserEventRecord }>(`/api/user-events/${writeId}`, updatedFields)
      if (response.data?.event?.recurrence) {
        const saved = response.data.event
        setEvents(previous => previous.map(event => event.id === writeId
          ? { ...event, recurrence_id: saved.recurrence_id, recurrence: saved.recurrence }
          : event))
      }
      setLastSavedAt(Date.now())
      setAutoSaveError(null)
      return true
    } catch (err) {
      console.error('Failed to update item:', err)
      // Roll back only this row. Restoring a whole-list snapshot could resurrect
      // a pending row that has since been swapped for its created row.
      setEvents((prev) => prev.map((item) => (item.id === writeId ? { ...previousRow, id: writeId } : item)))
      const errorMessage = getApiErrorMessage(err, 'Auto-save failed. Click Save to retry.')
      const recurrenceColumnMissing = /recurrence_rule/i.test(errorMessage) && /column|does not exist|schema cache/i.test(errorMessage)
      setAutoSaveError(
        recurrenceColumnMissing
          ? 'Recurrence storage is missing in the database. Apply migration 000_feature-time-and-calendar.sql.'
          : errorMessage
      )
      if (showErrorToast) {
        showClipboardStatus(recurrenceColumnMissing ? 'Database needs recurrence migration before this can save.' : errorMessage)
      }
      return false
    } finally {
      endEventMutation(writeId)
    }
  }, [beginEventMutation, endEventMutation, isSelectedReadOnly, persistRecurringItemEdit, resolveEventId, selectedEvent, selectedItem, showClipboardStatus])

  const handleUpdateItem = useCallback(async (): Promise<boolean> => {
    if (!selectedEvent || !draft.title.trim()) return false
    if (isSelectedReadOnly) return false
    if (!isSelectedItemDirty && !autoSaveError) return false

    setSaveSuccessHoldUntilMs(null)

    setAutoSaveDeadlineMs(null)
    setIsAutoSaving(true)
    isPersistingSelectedItemRef.current = true
    const currentDraftSignature = getDraftSignature(selectedItem?.id ?? null, draft)
    lastSavedDraftSignatureRef.current = currentDraftSignature
    const saved = await persistSelectedItem(draft)
    isPersistingSelectedItemRef.current = false
    setIsAutoSaving(false)
    if (saved) {
      setPendingUnsavedAction(null)
      setPendingUnsavedAnchor(null)
      setIsPendingUnsavedActionSaving(false)
      setSaveSuccessHoldUntilMs(Date.now() + SAVE_SUCCESS_HOLD_MS)
    } else {
      lastSavedDraftSignatureRef.current = null
    }
    return saved
  }, [autoSaveError, draft, getDraftSignature, isSelectedItemDirty, isSelectedReadOnly, persistSelectedItem, selectedEvent, selectedItem?.id])

  // Updates the selected item, then closes the left panel if the originating
  // surface's "close left panel on save" setting is active.
  const handleUpdateItemFromSurface = useCallback(async (surface: CloseLeftPanelOnSaveSurface): Promise<boolean> => {
    const saved = await handleUpdateItem()
    if (saved) {
      closeLeftPanelAfterSave(surface)
    }
    return saved
  }, [closeLeftPanelAfterSave, handleUpdateItem])

  useEffect(() => {
    if (autoSaveDeadlineMs === null) return

    const intervalId = window.setInterval(() => {
      setAutoSaveTickMs(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [autoSaveDeadlineMs])

  useEffect(() => {
    if (saveSuccessHoldUntilMs === null) return

    const timeoutId = window.setTimeout(() => {
      setSaveSuccessHoldUntilMs(null)
    }, Math.max(0, saveSuccessHoldUntilMs - Date.now()))

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [saveSuccessHoldUntilMs])

  useEffect(() => {
    if (isPersistingSelectedItemRef.current) return

    const currentDraftSignature = getDraftSignature(selectedItem?.id ?? null, draft)

    if (!selectedEvent || isSelectedReadOnly || !isSelectedItemDirty || !draft.title.trim()) {
      setAutoSaveDeadlineMs(null)
      return
    }

    if (lastSavedDraftSignatureRef.current === currentDraftSignature) {
      setAutoSaveDeadlineMs(null)
      return
    }

    setSaveSuccessHoldUntilMs(null)
    setAutoSaveError(null)
    const scheduledAt = Date.now()
    setAutoSaveTickMs(scheduledAt)
    setAutoSaveDeadlineMs(scheduledAt + AUTO_SAVE_DELAY_MS)
    const timeoutId = window.setTimeout(() => {
      setAutoSaveDeadlineMs(null)
      setIsAutoSaving(true)
      isPersistingSelectedItemRef.current = true
      lastSavedDraftSignatureRef.current = currentDraftSignature
      void persistSelectedItem(draft, { showErrorToast: false }).then((saved) => {
        if (saved) {
          setSaveSuccessHoldUntilMs(Date.now() + SAVE_SUCCESS_HOLD_MS)
        } else {
          lastSavedDraftSignatureRef.current = null
        }
      }).finally(() => {
        isPersistingSelectedItemRef.current = false
        setIsAutoSaving(false)
      })
    }, AUTO_SAVE_DELAY_MS)

    return () => {
      window.clearTimeout(timeoutId)
      setAutoSaveDeadlineMs(null)
    }
  }, [draft, getDraftSignature, isSelectedItemDirty, isSelectedReadOnly, persistSelectedItem, selectedEvent, selectedItem?.id])

  useEffect(() => {
    if (!hasPendingUnsavedChanges) return

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [hasPendingUnsavedChanges])

  useEffect(() => {
    if (hasPendingUnsavedChanges) return
    if (pendingUnsavedAction?.type === 'create-new-item' && hasUnsavedNewItemDraft) return
    setPendingUnsavedAction(null)
    setPendingUnsavedAnchor(null)
    setIsPendingUnsavedActionSaving(false)
  }, [hasPendingUnsavedChanges, hasUnsavedNewItemDraft, pendingUnsavedAction])

  const applySelectedItem = useCallback((itemId: string): boolean => {
    setSelectedItemId(itemId)
    triggerItemSelectionFeedback(itemId)
    setMovingItemId(null)
    setMovingItemSnapshot(null)
    setSelectionDraft(null)
    const item = interactionItemMap.get(itemId) || items.find((entry) => entry.id === itemId)
    openEditorForItemSelection({
      notes: item?.notes,
      durationMinutes: item?.totalDurationMinutes ?? item?.durationMinutes,
    })
    return true
  }, [interactionItemMap, items, openEditorForItemSelection, triggerItemSelectionFeedback])

  const requestPendingUnsavedAction = useCallback((action: PendingUnsavedAction, anchor?: PendingUnsavedAnchor) => {
    setPendingUnsavedAction(action)
    if (anchor) {
      const popupWidth = 320
      const popupHeight = 170
      setPendingUnsavedAnchor({
        x: Math.max(12, Math.min(window.innerWidth - popupWidth - 12, anchor.x + 12)),
        y: clampTopBelowObstruction(Math.min(window.innerHeight - popupHeight - 12, anchor.y + 12), 12),
      })
    } else {
      setPendingUnsavedAnchor(null)
    }
    if (isPhoneLayout) {
      openEditorSurface()
      return
    }

    openLeftPanelSection('editor')
  }, [isPhoneLayout, openEditorSurface, openLeftPanelSection])

  const createNewItemAtSlot = useCallback((target: GridContextTarget) => {
    const startMinute = snapMinute(target.minute, slotMinutes)
    setSelectedItemId(null)
    setIsNewItemDraft(true)
    clearMultiSelect()
    setMovingItemId(null)
    setMovingItemSnapshot(null)
    setIsMoveScopeOpen(false)
    setQuickTemplateAwaitingTime(null)
    setSelectionDraft({ dayIndex: target.dayIndex, startMinute, endMinute: startMinute + slotMinutes })
    isSelectingRef.current = false
    setIsSelecting(false)
    setTouchSelectionFinished(false)
    setIsSelectionAdjusterExpanded(false)
    setIsItemAdjusterExpanded(false)
    setIsLocationFieldVisible(false)
    setDraft({
      title: '', notes: '', location: null, categoryIds: [],
      sourceId: MAIN_SOURCE_ID, recurrenceRule: { type: 'none' },
    })
    openEditorSurface({ autoFocusTitle: true })
  }, [clearMultiSelect, openEditorSurface, slotMinutes])

  const handlePendingUnsavedActionConfirm = useCallback(async () => {
    if (isPendingUnsavedActionSaving) return
    if (!pendingUnsavedAction) return
    if (!draft.title.trim()) {
      showClipboardStatus('Title is required before saving.')
      return
    }

    setIsPendingUnsavedActionSaving(true)
    setIsAutoSaving(true)
    const saved = pendingUnsavedAction.type === 'create-new-item' && !selectedEvent
      ? await handleSaveSelection()
      : await persistSelectedItem(draft)
    setIsAutoSaving(false)
    if (!saved) {
      setIsPendingUnsavedActionSaving(false)
      return
    }

    const actionToApply = pendingUnsavedAction
    setPendingUnsavedAction(null)
    setPendingUnsavedAnchor(null)
    setIsPendingUnsavedActionSaving(false)

    if (actionToApply.type === 'switch-item') {
      applySelectedItem(actionToApply.itemId)
      return
    }

    if (actionToApply.type === 'create-new-item') {
      createNewItemAtSlot(actionToApply)
      return
    }

    startSelection(actionToApply.dayIndex, actionToApply.minute)
  }, [applySelectedItem, createNewItemAtSlot, draft, handleSaveSelection, isPendingUnsavedActionSaving, pendingUnsavedAction, persistSelectedItem, selectedEvent, showClipboardStatus, startSelection])

  // A click that arrived while an autosave was running; applied once it finishes.
  const queuedItemSelectionRef = useRef<{ itemId: string; anchor?: PendingUnsavedAnchor } | null>(null)

  const selectItemForEditing = useCallback(async (rawItemId: string, anchor?: PendingUnsavedAnchor): Promise<boolean> => {
    // A click can land on a row whose pending id was already swapped for the
    // created id; select the real item instead of a missing one.
    const itemId = resolveEventId(rawItemId)
    if (isTemplateSelectionMode) {
      const sourceItem = interactionItemMap.get(itemId) || items.find((item) => item.id === itemId)
      if (!sourceItem) return false
      setPendingTemplateSourceId(getTimeItemInteractionId(sourceItem))
      setPendingTemplateQuickName(buildDefaultQuickTemplateName(sourceItem.title))
      setIsTemplateSelectionMode(false)
      openQuickObjectsSurface()
      showClipboardStatus('Item selected. Save it as a quick template in Quick Objects.')
      return false
    }

    if (itemId === selectedItemId) {
      queuedItemSelectionRef.current = null
      triggerItemSelectionFeedback(itemId)
      return true
    }

    if (isAutoSaving) {
      queuedItemSelectionRef.current = { itemId, anchor }
      showClipboardStatus('Saving changes... opening the item when done.')
      return false
    }
    queuedItemSelectionRef.current = null

    if (hasPendingUnsavedChanges) {
      if (!draft.title.trim()) {
        showClipboardStatus('Title is required before switching items.')
        return false
      }

      requestPendingUnsavedAction({ type: 'switch-item', itemId }, anchor)
      return false
    }

    return applySelectedItem(itemId)
  }, [applySelectedItem, draft, hasPendingUnsavedChanges, interactionItemMap, isAutoSaving, isTemplateSelectionMode, items, openQuickObjectsSurface, requestPendingUnsavedAction, resolveEventId, selectedItemId, showClipboardStatus, triggerItemSelectionFeedback])

  const goToLatestOccurrence = async () => {
    if (!selectedEvent || isRecurrenceActionBusy) return
    setIsRecurrenceActionBusy(true)
    try {
      const { data } = await apiClient.get<{ event: UserEventRecord }>(`/api/user-events/${selectedEvent.id}/latest-occurrence`)
      if (!data?.event) throw new Error('Latest occurrence was not returned.')
      const latest = data.event
      setEvents(previous => [...previous.filter(event => event.id !== latest.id), latest])
      const start = new Date(latest.start_time)
      setCurrentWeekStart(startOfWeek(new Date(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()), { weekStartsOn: 1 }))
      setPendingLatestOccurrenceId(latest.id)
    } catch (error) {
      console.error('Failed to navigate to latest occurrence:', error)
      showClipboardStatus(getApiErrorMessage(error, 'Could not load latest occurrence.'))
    } finally {
      setIsRecurrenceActionBusy(false)
    }
  }

  useEffect(() => {
    if (!pendingLatestOccurrenceId || !items.some(item => item.sourceEventId === pendingLatestOccurrenceId)) return
    setPendingLatestOccurrenceId(null)
    void selectItemForEditing(pendingLatestOccurrenceId)
  }, [items, pendingLatestOccurrenceId, selectItemForEditing])

  const completeRecurrence = async () => {
    if (!selectedEvent?.recurrence || isRecurrenceActionBusy) return
    const seriesId = selectedEvent.recurrence.id
    const completedEventId = selectedEvent.id
    const affectedIds = events.filter(event => event.recurrence_id === seriesId).map(event => event.id)
    setIsRecurrenceActionBusy(true)
    affectedIds.forEach(beginEventMutation)
    try {
      const { data } = await apiClient.post<{ recurrence: TimeItemRecurrence; event: UserEventRecord }>(`/api/user-events/${completedEventId}/complete-recurrence`)
      if (data?.recurrence?.status !== 'completed' || data.event?.id !== completedEventId || !data.event.completed_at) {
        throw new Error('Recurrence and Time Item completion were not confirmed.')
      }
      setEvents(previous => previous.map(event => event.recurrence_id === seriesId
        ? {
          ...event, recurrence: data.recurrence, recurrence_rule: data.recurrence.recurrence_rule,
          ...(event.id === completedEventId ? { completed_at: data.event.completed_at, updated_at: data.event.updated_at } : {}),
        }
        : event))
      notifyTimeManagementDataChanged('recurrence-completed')
      showClipboardStatus('Recurrence and current Time Item completed.')
    } catch (error) {
      console.error('Failed to complete recurrence:', error)
      showClipboardStatus(getApiErrorMessage(error, 'Could not complete recurrence. Refresh and try again.'))
    } finally {
      affectedIds.forEach(endEventMutation)
      setIsRecurrenceActionBusy(false)
    }
  }

  const recurrenceStatusPanel = selectedEvent?.recurrence ? (
    <TimeItemRecurrenceStatus eventId={selectedEvent.id} recurrence={selectedEvent.recurrence}
      completedAt={selectedEvent.completed_at}
      busy={isRecurrenceActionBusy || isAutoSaving || isSelectedItemDirty}
      onGoToLatest={() => { void goToLatestOccurrence() }} onComplete={() => { void completeRecurrence() }} />
  ) : null

  useEffect(() => {
    if (isAutoSaving) return
    const queued = queuedItemSelectionRef.current
    if (!queued) return
    queuedItemSelectionRef.current = null
    void selectItemForEditing(queued.itemId, queued.anchor)
  }, [isAutoSaving, selectItemForEditing])

  const startSelectionWithUnsavedGuard = useCallback((dayIndex: number, minute: number, anchor?: PendingUnsavedAnchor): boolean => {
    if (isAutoSaving) {
      showClipboardStatus('Saving changes...')
      return false
    }

    if (hasPendingUnsavedChanges) {
      if (!draft.title.trim()) {
        showClipboardStatus('Title is required before creating a new selection.')
        return false
      }

      requestPendingUnsavedAction({ type: 'new-selection', dayIndex, minute }, anchor)
      return false
    }

    startSelection(dayIndex, minute)
    return isSelectingRef.current
  }, [draft, hasPendingUnsavedChanges, isAutoSaving, requestPendingUnsavedAction, showClipboardStatus, startSelection])

  const isPhoneMovePlacement = isPhoneLayout && Boolean(movingItemId || multiClipboard?.isCut)
  const placeTouchMove = async (dayIndex: number, minute: number) => {
    if (touchMoveInFlightRef.current) return
    if (isAutoSaving) {
      showClipboardStatus('Saving changes...')
      return
    }
    const startMinute = snapMinute(minute, slotMinutes)
    const duration = movingItemSnapshot
      ? getTimeItemTotalDurationMinutes(movingItemSnapshot, slotMinutes)
      : slotMinutes
    const destination = { dayIndex, startMinute, endMinute: startMinute + duration }
    touchMoveInFlightRef.current = true
    isSelectingRef.current = false
    setIsSelecting(false)
    setTouchSelectionFinished(false)
    setSelectionDraft(destination)
    try {
      if (movingItemId) {
        await handleSaveSelectionFromSurface('calendarGrid', { selection: destination })
      } else {
        await pasteMultiClipboardToSelection(destination)
      }
    } finally {
      touchMoveInFlightRef.current = false
    }
  }

  const touchGridSelection = useTimeGridTouchSelection({
    onPlace: isPhoneMovePlacement ? (dayIndex, minute) => { void placeTouchMove(dayIndex, minute) } : undefined,
    onStart: (dayIndex, minute, point) => {
      return startSelectionWithUnsavedGuard(dayIndex, minute, { x: point.clientX, y: point.clientY })
    },
    onMove: (dayIndex, anchorMinute, minute) => {
      if (!isSelectingRef.current) return
      const anchor = snapMinute(anchorMinute, slotMinutes)
      const endpoint = Math.floor(minute / slotMinutes) * slotMinutes
      const startMinute = Math.min(anchor, endpoint)
      const endMinute = Math.max(anchor, endpoint) + slotMinutes
      setSelectionDraft((previous) => {
        if (previous?.dayIndex === dayIndex && previous.startMinute === startMinute && previous.endMinute === endMinute) return previous
        return { dayIndex, startMinute, endMinute }
      })
    },
    onFinish: () => {
      isSelectingRef.current = false
      setIsSelecting(false)
      setTouchSelectionFinished(true)
    },
    onCancel: () => {
      isSelectingRef.current = false
      setIsSelecting(false)
      setSelectionDraft(null)
    },
    autoScroll: autoScrollCalendarWhileDragging,
  })

  const handleDeleteSelected = async () => {
    if (!selectedEvent) return
    if (isSelectedReadOnly) return

    setIsDeleteConfirmOpen(false)
    const selectedEventId = selectedEvent.id
    const writeId = resolveEventId(selectedEventId)
    const deletedEvent = { ...selectedEvent, id: writeId }
    setSelectedItemId(null)
    setDraft((prev) => ({ ...prev, title: '', notes: '', location: null, categoryIds: [], recurrenceRule: { type: 'none' } }))
    setExpandedSections((prev) => {
      const next = new Set(prev)
      next.delete('editor')
      return next
    })
    if (isPendingEventId(writeId)) {
      deleteAwaitingCreateEvent(writeId)
      return
    }
    beginEventDeletion(writeId)
    setEvents((prev) => prev.filter((item) => item.id !== writeId && item.id !== selectedEventId))
    try {
      await apiClient.delete(`/api/user-events/${writeId}`)
      endEventDeletion(deletedEvent.id)
      notifyTimeManagementDataChanged('event-deleted')
    } catch (err) {
      console.error('Failed to delete item:', err)
      cancelEventDeletion(deletedEvent.id)
      setEvents((prev) => prev.some((event) => event.id === deletedEvent.id) ? prev : [...prev, deletedEvent])
      showClipboardStatus('Could not delete item. Try again.')
    }
  }

  const handleDeleteThisOccurrence = async () => {
    if (!selectedEvent || !selectedItem) return
    if (isSelectedReadOnly) return

    setIsDeleteConfirmOpen(false)
    const rule = normaliseRecurrenceRule(selectedEvent.recurrence_rule)
    if (rule.type === 'none' || rule.endType === 'whenCompleted') {
      void handleDeleteSelected()
      return
    }

    const occurrenceKey = getUtcDateKey(new Date(selectedItem.occurrenceStartTime))
    const nextExceptions = Array.from(new Set([...(rule.exceptions || []), occurrenceKey]))
    const updatedRule: RecurrenceRule = { ...rule, exceptions: nextExceptions }

    const previous = events
    setEvents((prev) => prev.map((item) => (item.id === selectedEvent.id ? { ...item, recurrence_rule: updatedRule } : item)))
    setSelectedItemId(null)
    try {
      await apiClient.put(`/api/user-events/${selectedEvent.id}`, { recurrence_rule: updatedRule })
    } catch (err) {
      console.error('Failed to delete occurrence:', err)
      setEvents(previous)
      showClipboardStatus('Could not delete occurrence. Try again.')
    }
  }

  const handleDeleteThisAndFollowing = async () => {
    if (!selectedEvent || !selectedItem) return
    if (isSelectedReadOnly) return

    setIsDeleteConfirmOpen(false)
    const rule = normaliseRecurrenceRule(selectedEvent.recurrence_rule)
    if (rule.type === 'none' || rule.endType === 'whenCompleted') {
      void handleDeleteSelected()
      return
    }

    const occurrenceStart = new Date(selectedItem.occurrenceStartTime)
    const baseStartKey = getUtcDateKey(new Date(selectedEvent.start_time))
    const occurrenceKey = getUtcDateKey(occurrenceStart)
    // Deleting from the first occurrence removes the whole series.
    if (occurrenceKey <= baseStartKey) {
      void handleDeleteSelected()
      return
    }

    const dayBefore = new Date(occurrenceStart)
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1)
    const updatedRule: RecurrenceRule = {
      ...rule,
      endType: 'on',
      endDate: getUtcDateKey(dayBefore),
      endCount: undefined,
    }

    const previous = events
    setEvents((prev) => prev.map((item) => (item.id === selectedEvent.id ? { ...item, recurrence_rule: updatedRule } : item)))
    setSelectedItemId(null)
    try {
      await apiClient.put(`/api/user-events/${selectedEvent.id}`, { recurrence_rule: updatedRule })
    } catch (err) {
      console.error('Failed to delete following occurrences:', err)
      setEvents(previous)
      showClipboardStatus('Could not delete occurrences. Try again.')
    }
  }

  const nudgeSelectionDraftEdge = useCallback((edge: 'start' | 'end', direction: -1 | 1) => {
    if (!selectionDraft) return
    const adjusted = adjustTimeRangeEdge({
      ...selectionDraft,
      edge,
      deltaMinutes: direction * slotMinutes * Math.max(1, selectionAdjustStepSlots),
      minimumDuration: slotMinutes,
    })
    const { weekOffset, ...nextSelection } = normaliseTimeRangeToWeek({ ...selectionDraft, ...adjusted }, dayRangeLength)
    setSelectionDraft(nextSelection)
    if (weekOffset !== 0) setCurrentWeekStart((prev) => addWeeks(prev, weekOffset))

    setSelectionLastChangedEdge(edge)
    if (selectionChangePulseTimeoutRef.current) {
      window.clearTimeout(selectionChangePulseTimeoutRef.current)
    }
    selectionChangePulseTimeoutRef.current = window.setTimeout(() => {
      setSelectionLastChangedEdge(null)
      selectionChangePulseTimeoutRef.current = null
    }, 800)
  }, [dayRangeLength, selectionDraft, selectionAdjustStepSlots, slotMinutes])

  const nudgeSelectedItemEdge = useCallback(async (edge: 'start' | 'end', direction: -1 | 1): Promise<void> => {
    if (!selectedItem || isSelectedReadOnly || isNudgingItemRef.current) return

    const sourceEventId = selectedItem.sourceEventId || selectedItem.id
    const currentEvent = events.find((entry) => entry.id === sourceEventId)
    if (!currentEvent) return

    const occurrenceStart = new Date(selectedItem.occurrenceStartTime)
    const currentStart = occurrenceStart.getUTCHours() * 60 + occurrenceStart.getUTCMinutes()
    const currentDuration = (Date.parse(currentEvent.end_time) - Date.parse(currentEvent.start_time)) / 60_000
    if (!Number.isFinite(currentDuration) || currentDuration <= 0) {
      showClipboardStatus('Could not adjust start/end time. The item has an invalid duration.')
      return
    }
    const currentEnd = currentStart + currentDuration
    const { startMinute: nextStart, endMinute: nextEnd } = adjustTimeRangeEdge({
      startMinute: currentStart,
      endMinute: currentEnd,
      edge,
      deltaMinutes: direction * slotMinutes * Math.max(1, itemAdjustStepSlots),
      minimumDuration: slotMinutes,
    })

    if (nextStart === currentStart && nextEnd === currentEnd) return

    const day = addDays(currentWeekStart, getWeekDayIndex(occurrenceStart, currentWeekStart))
    const startTime = buildEventTimestamp(day, nextStart)
    const endTime = buildEventTimestamp(day, nextEnd)
    const previousEvent = currentEvent
    const targetDayIndex = getWeekDayIndex(new Date(startTime), currentWeekStart)
    const targetWeek = targetDayIndex >= 0 && targetDayIndex < dayRangeLength
      ? currentWeekStart
      : addWeeks(currentWeekStart, Math.floor(targetDayIndex / 7))

    if (normaliseRecurrenceRule(currentEvent.recurrence_rule).type !== 'none') {
      isNudgingItemRef.current = true
      setIsNudgingItem(true)
      try {
        const saved = await persistRecurringItemEdit(currentEvent, selectedItem.occurrenceStartTime, { start_time: startTime, end_time: endTime })
        if (saved) setCurrentWeekStart(targetWeek)
      } finally {
        isNudgingItemRef.current = false
        setIsNudgingItem(false)
      }
      return
    }

    isNudgingItemRef.current = true
    setIsNudgingItem(true)
    beginEventMutation(sourceEventId)
    setCurrentWeekStart(targetWeek)
    setEvents((prev) =>
      prev.map((entry) =>
        entry.id === sourceEventId
          ? { ...entry, start_time: startTime, end_time: endTime }
          : entry
      )
    )

    setItemLastChangedEdge(edge)
    if (itemChangePulseTimeoutRef.current) {
      window.clearTimeout(itemChangePulseTimeoutRef.current)
    }
    itemChangePulseTimeoutRef.current = window.setTimeout(() => {
      setItemLastChangedEdge(null)
      itemChangePulseTimeoutRef.current = null
    }, 800)

    try {
      await apiClient.put(`/api/user-events/${sourceEventId}`, {
        start_time: startTime,
        end_time: endTime,
      })
    } catch (err) {
      console.error('Failed to nudge item edge:', err)
      setEvents((prev) => prev.map((entry) =>
        entry.id === sourceEventId && entry.start_time === startTime && entry.end_time === endTime
          ? { ...entry, start_time: previousEvent.start_time, end_time: previousEvent.end_time }
          : entry
      ))
      if (selectedEventIdRef.current === sourceEventId) {
        setCurrentWeekStart((prev) => prev.getTime() === targetWeek.getTime() ? currentWeekStart : prev)
      }
      showClipboardStatus('Could not adjust start/end time. Try again.')
    } finally {
      endEventMutation(sourceEventId)
      isNudgingItemRef.current = false
      setIsNudgingItem(false)
    }
  }, [beginEventMutation, currentWeekStart, dayRangeLength, endEventMutation, events, isSelectedReadOnly, itemAdjustStepSlots, persistRecurringItemEdit, selectedItem, showClipboardStatus, slotMinutes])

  const closeCalendarItemContextMenu = useCallback(() => {
    setCalendarItemContextMenu(null)
    setContextMenuDeleteConfirmOpen(false)
    setContextMenuCategorySubmenuOpen(false)
  }, [])

  const closeSelectionPasteContextMenu = useCallback(() => {
    setSelectionPasteContextMenu(null)
  }, [])

  const getGridContextTarget = (element: HTMLElement, clientY: number): GridContextTarget | null => {
    const column = element.closest<HTMLElement>('[data-time-management-day-index]')
    if (!column) return null
    const dayIndex = Number(column.dataset.timeManagementDayIndex)
    const rect = column.getBoundingClientRect()
    if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= weekDays.length || rect.height <= 0) return null
    return { dayIndex, minute: snapMinute(((clientY - rect.top) / rect.height) * MINUTES_IN_DAY, slotMinutes) }
  }

  const handleContextCreateNewItem = (target: GridContextTarget | null, anchor: PendingUnsavedAnchor) => {
    closeCalendarItemContextMenu()
    closeSelectionPasteContextMenu()
    if (!target) {
      showClipboardStatus('Could not determine the calendar time slot. Reopen the menu on the grid and try again.')
      return
    }
    if (isAutoSaving || isCreatingItem) {
      showClipboardStatus('Saving changes...')
      return
    }
    if (hasPendingUnsavedChanges || hasUnsavedNewItemDraft) {
      if (!draft.title.trim()) {
        showClipboardStatus('Title is required before creating a new item.')
        openEditorSurface({ autoFocusTitle: true })
        return
      }
      if (hasUnsavedNewItemDraft && !selectionDraft) {
        showClipboardStatus('Select a time for the current draft before creating a new item.')
        return
      }
      requestPendingUnsavedAction({ type: 'create-new-item', ...target }, anchor)
      return
    }
    createNewItemAtSlot(target)
  }

  const beginItemContextHold = (event: ReactPointerEvent<HTMLDivElement>, itemId: string, isReadOnly: boolean) => {
    if (!event.isPrimary || itemContextHoldGateRef.current.isEngaged()) return
    suppressItemHoldClickUntilRef.current = 0
    const target = getGridContextTarget(event.currentTarget, event.clientY)
    const point = {
      pointerId: event.pointerId, pointerType: event.pointerType,
      clientX: event.clientX, clientY: event.clientY,
    }
    const suppressFollowUp = () => { suppressItemHoldClickUntilRef.current = Date.now() + 800 }
    itemContextHoldGateRef.current.pressStart(point, {
      onActivate: () => {
        suppressFollowUp()
        closeSelectionPasteContextMenu()
        setCalendarItemContextMenu({ itemId, isReadOnly, x: point.clientX, y: point.clientY, target })
        setContextMenuDeleteConfirmOpen(false)
        setContextMenuCategorySubmenuOpen(false)
      },
      onTap: () => {},
      onEnd: suppressFollowUp,
      onCancel: suppressFollowUp,
    })
  }

  useDismissOnlyGesture({
    enabled: isPhoneLayout,
    dismissOutside: (target) => {
      const hasDeletePopover = isDeleteConfirmOpen || deletingBackgroundId !== null || deletingTemplateId !== null
      if (!calendarItemContextMenu && !selectionPasteContextMenu && !hasDeletePopover && !isMoveScopeOpen) return false
      const element = target instanceof Element ? target : target?.parentElement
      if (
        (calendarItemContextMenu && (
          calendarItemContextMenuRef.current?.contains(target)
          || contextMenuCategorySubmenuRef.current?.contains(target)
        ))
        || (selectionPasteContextMenu && document.getElementById('selection-paste-context-menu')?.contains(target))
        || ((hasDeletePopover || isMoveScopeOpen) && element?.closest('[data-dismiss-popup="true"]'))
      ) return false

      closeCalendarItemContextMenu()
      closeSelectionPasteContextMenu()
      setIsDeleteConfirmOpen(false)
      setDeletingBackgroundId(null)
      setDeletingTemplateId(null)
      setDeletingTemplatePopoverPosition(null)
      setIsMoveScopeOpen(false)
      return true
    },
  })

  useEffect(() => {
    if (!calendarItemContextMenu) return
    const handlePointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target as Node | null
      const menuEl = document.getElementById('calendar-item-context-menu')
      if (menuEl && target && menuEl.contains(target)) return
      if (isPhoneLayout && (itemContextHoldGateRef.current.isEngaged()
        || Date.now() < suppressItemHoldClickUntilRef.current)) return
      closeCalendarItemContextMenu()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') closeCalendarItemContextMenu()
      if (event.key === 'Enter' && selectedItemId === calendarItemContextMenu.itemId && canSaveSelectedItem) {
        event.preventDefault()
        closeCalendarItemContextMenu()
        void handleUpdateItemFromSurface('calendarGrid')
      }
    }
    const handleScroll = () => closeCalendarItemContextMenu()
    window.addEventListener('mousedown', handlePointerDown, true)
    window.addEventListener('contextmenu', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', handleScroll)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown, true)
      window.removeEventListener('contextmenu', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', handleScroll)
    }
  }, [calendarItemContextMenu, canSaveSelectedItem, closeCalendarItemContextMenu, handleUpdateItemFromSurface, isPhoneLayout, selectedItemId])

  useLayoutEffect(() => {
    if (!calendarItemContextMenu) {
      setContextMenuPosition(null)
      return
    }
    const el = calendarItemContextMenuRef.current
    if (!el) return
    const margin = 8
    const rect = el.getBoundingClientRect()
    let left = calendarItemContextMenu.x
    let top = calendarItemContextMenu.y
    if (left + rect.width > window.innerWidth - margin) {
      left = window.innerWidth - rect.width - margin
    }
    if (top + rect.height > window.innerHeight - margin) {
      top = window.innerHeight - rect.height - margin
    }
    left = Math.max(margin, left)
    top = clampTopBelowObstruction(top, margin)
    setContextMenuPosition((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }))
  }, [calendarItemContextMenu, contextMenuDeleteConfirmOpen, contextMenuCategorySubmenuOpen, categories.length, isPhoneLayout])

  useLayoutEffect(() => {
    if (!calendarItemContextMenu || !contextMenuCategorySubmenuOpen || isPhoneLayout) return
    const menu = calendarItemContextMenuRef.current
    const trigger = contextMenuCategoryTriggerRef.current
    const submenu = contextMenuCategorySubmenuRef.current
    if (!menu || !trigger || !submenu) return
    const margin = 8
    const menuRect = menu.getBoundingClientRect()
    const triggerRect = trigger.getBoundingClientRect()
    const submenuRect = submenu.getBoundingClientRect()
    const preferredLeft = menuRect.right + submenuRect.width <= window.innerWidth - margin
      ? menuRect.right
      : menuRect.left - submenuRect.width
    const left = Math.max(margin, Math.min(preferredLeft, window.innerWidth - submenuRect.width - margin))
    const top = clampTopBelowObstruction(Math.min(triggerRect.top, window.innerHeight - submenuRect.height - margin), margin)
    setCategorySubmenuPosition((prev) => prev.left === left && prev.top === top ? prev : { left, top })
  }, [calendarItemContextMenu, contextMenuCategorySubmenuOpen, contextMenuPosition, categories.length, isPhoneLayout])

  useEffect(() => {
    if (!selectionPasteContextMenu) return
    const handlePointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target as Node | null
      const menuEl = document.getElementById('selection-paste-context-menu')
      if (menuEl && target && menuEl.contains(target)) return
      closeSelectionPasteContextMenu()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') closeSelectionPasteContextMenu()
      if (event.key === 'Enter' && canSaveNewSelectionItem) {
        event.preventDefault()
        closeSelectionPasteContextMenu()
        void handleSaveSelectionFromSurface('calendarGrid')
      }
    }
    const handleScroll = () => closeSelectionPasteContextMenu()
    window.addEventListener('mousedown', handlePointerDown, true)
    window.addEventListener('contextmenu', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleScroll)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown, true)
      window.removeEventListener('contextmenu', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleScroll)
    }
  }, [canSaveNewSelectionItem, closeSelectionPasteContextMenu, handleSaveSelectionFromSurface, selectionPasteContextMenu])

  useEffect(() => {
    if (!selectionDraft) {
      setSelectionPasteContextMenu(null)
    }
  }, [selectionDraft])

  const handleContextSaveAsTemplate = useCallback((itemId: string) => {
    const item = interactionItemMap.get(itemId) || items.find((entry) => entry.id === itemId)
    const sourceEvent = item ? events.find((entry) => entry.id === item.sourceEventId) : null
    if (!sourceEvent) {
      showClipboardStatus('Item not found.')
      closeCalendarItemContextMenu()
      return
    }
    const title = (sourceEvent.title || '').trim() || 'Untitled item'
    const quickName = buildDefaultQuickTemplateName(title)
    const nextTemplate: QuickTemplate = {
      id: createQuickTemplateId(),
      quickName,
      title,
      notes: sourceEvent.description || '',
      categoryIds: Array.isArray(sourceEvent.category_ids) ? sourceEvent.category_ids : [],
      autoSaveEnabled: false,
      sourceItemId: sourceEvent.id,
      createdAt: new Date().toISOString(),
    }
    quickTemplatesTouchedRef.current = true
    setQuickTemplates((prev) => [nextTemplate, ...prev])
    setIsLeftPanelOpen(true)
    setExpandedSections((prev) => {
      const next = new Set(prev)
      next.add('quickObjects')
      return next
    })
    showClipboardStatus(`Saved template "${quickName}".`)
    closeCalendarItemContextMenu()
  }, [closeCalendarItemContextMenu, events, interactionItemMap, items, showClipboardStatus])

  const handleContextSaveItem = useCallback(() => {
    closeCalendarItemContextMenu()
    void handleUpdateItemFromSurface('calendarGrid')
  }, [closeCalendarItemContextMenu, handleUpdateItemFromSurface])

  const startMoveItem = useCallback((itemId: string): boolean => {
    const target = interactionItemMap.get(itemId) || items.find((entry) => entry.id === itemId)
    if (!target) {
      showClipboardStatus('Item not found.')
      return false
    }

    const source = sourceMap.get(target.sourceId)
    if (isReadOnlySource(source)) {
      showClipboardStatus('Read-only item cannot be moved here.')
      return false
    }

    setMovingItemId(getTimeItemInteractionId(target))
    setMovingItemSnapshot(target)
    setMultiClipboard(null)
    setSelectedItemId(null)
    setSelectionDraft({
      dayIndex: target.dayIndex,
      startMinute: target.startMinute,
      endMinute: Math.min(
        MINUTES_IN_DAY,
        target.startMinute + getTimeItemTotalDurationMinutes(target, slotMinutes)
      ),
    })
    setIsSelecting(false)
    const targetSourceEvent = events.find((entry) => entry.id === target.sourceEventId)
    setDraft({
      title: target.title,
      notes: target.notes,
      location: targetSourceEvent?.location || null,
      categoryIds: target.categoryIds,
      sourceId: target.sourceId,
      recurrenceRule: target.recurrenceRule || { type: 'none' },
    })
    setIsLocationFieldVisible(Boolean(targetSourceEvent?.location?.trim()))
    setIsLeftPanelOpen(!isPhoneLayout)
    setExpandedSections((prev) => {
      const next = new Set(prev)
      next.add('editor')
      return next
    })
    showClipboardStatus(isPhoneLayout
      ? 'Move mode active. Tap a destination to move.'
      : 'Move mode active. Select a new date and time, then click Save Item.')
    return true
  }, [events, interactionItemMap, isPhoneLayout, items, showClipboardStatus, slotMinutes, sourceMap])

  const handleContextMoveItem = useCallback((itemId: string) => {
    startMoveItem(itemId)
    closeCalendarItemContextMenu()
  }, [closeCalendarItemContextMenu, startMoveItem])

  const handleContextCopyItem = useCallback((itemId: string) => {
    copyItemById(itemId)
    closeCalendarItemContextMenu()
  }, [closeCalendarItemContextMenu, copyItemById])

  const handleContextCancelSelection = useCallback(() => {
    handleDiscardSelectionDraft()
    closeCalendarItemContextMenu()
  }, [closeCalendarItemContextMenu, handleDiscardSelectionDraft])

  const handleContextDeleteItem = useCallback(async (itemId: string) => {
    const targetItem = interactionItemMap.get(itemId) || items.find((entry) => entry.id === itemId)
    const sourceEventId = targetItem?.sourceEventId || null
    const writeId = sourceEventId ? resolveEventId(sourceEventId) : null
    const target = writeId
      ? (eventsRef.current.find((entry) => entry.id === writeId)
        || events.find((entry) => entry.id === writeId)
        || events.find((entry) => entry.id === sourceEventId))
      : null
    if (!target || !writeId || !sourceEventId) {
      closeCalendarItemContextMenu()
      return
    }
    const source = sourceMap.get(target.source_id || activeMainSourceId)
    if (isReadOnlySource(source)) {
      showClipboardStatus('Read-only item cannot be deleted here.')
      closeCalendarItemContextMenu()
      return
    }
    const isTargetSelected = selectedItemId === itemId || selectedItemId === sourceEventId || selectedItemId === writeId
    if (isTargetSelected) {
      setSelectedItemId(null)
      setDraft((prev) => ({ ...prev, title: '', notes: '', location: null, categoryIds: [], recurrenceRule: { type: 'none' } }))
    }
    if (movingItemId === itemId) {
      setMovingItemId(null)
      setMovingItemSnapshot(null)
      setSelectionDraft(null)
    }
    closeCalendarItemContextMenu()

    if (isPendingEventId(writeId)) {
      deleteAwaitingCreateEvent(writeId)
      return
    }

    const deletedRow = { ...target, id: writeId }
    beginEventDeletion(writeId)
    // Drop the real row plus any stale pending row that still points at it.
    setEvents((prev) => prev.filter((entry) => entry.id !== writeId && entry.id !== sourceEventId))
    try {
      await apiClient.delete(`/api/user-events/${writeId}`)
      endEventDeletion(writeId)
      notifyTimeManagementDataChanged('event-deleted')
    } catch (err) {
      console.error('Failed to delete item:', err)
      cancelEventDeletion(writeId)
      setEvents((prev) => prev.some((event) => event.id === writeId) ? prev : [...prev, deletedRow])
      showClipboardStatus('Could not delete item. Try again.')
    }
  }, [activeMainSourceId, beginEventDeletion, cancelEventDeletion, closeCalendarItemContextMenu, deleteAwaitingCreateEvent, endEventDeletion, events, interactionItemMap, items, movingItemId, notifyTimeManagementDataChanged, resolveEventId, selectedItemId, showClipboardStatus, sourceMap])

  const handleContextDeleteThisOccurrence = useCallback(async (itemId: string) => {
    const targetItem = interactionItemMap.get(itemId) || items.find((entry) => entry.id === itemId)
    const target = targetItem ? events.find((entry) => entry.id === targetItem.sourceEventId) : null
    if (!targetItem || !target) {
      closeCalendarItemContextMenu()
      return
    }
    const source = sourceMap.get(target.source_id || activeMainSourceId)
    if (isReadOnlySource(source)) {
      showClipboardStatus('Read-only item cannot be deleted here.')
      closeCalendarItemContextMenu()
      return
    }
    const rule = normaliseRecurrenceRule(target.recurrence_rule)
    if (rule.type === 'none' || rule.endType === 'whenCompleted') {
      void handleContextDeleteItem(itemId)
      return
    }
    const occurrenceKey = getUtcDateKey(new Date(targetItem.occurrenceStartTime))
    const nextExceptions = Array.from(new Set([...(rule.exceptions || []), occurrenceKey]))
    const updatedRule: RecurrenceRule = { ...rule, exceptions: nextExceptions }

    const previous = events
    setEvents((prev) => prev.map((entry) => (entry.id === target.id ? { ...entry, recurrence_rule: updatedRule } : entry)))
    if (selectedItemId === itemId) setSelectedItemId(null)
    closeCalendarItemContextMenu()
    try {
      await apiClient.put(`/api/user-events/${target.id}`, { recurrence_rule: updatedRule })
    } catch (err) {
      console.error('Failed to delete occurrence:', err)
      setEvents(previous)
      showClipboardStatus('Could not delete occurrence. Try again.')
    }
  }, [activeMainSourceId, closeCalendarItemContextMenu, events, handleContextDeleteItem, interactionItemMap, items, selectedItemId, showClipboardStatus, sourceMap])

  const handleContextDeleteThisAndFollowing = useCallback(async (itemId: string) => {
    const targetItem = interactionItemMap.get(itemId) || items.find((entry) => entry.id === itemId)
    const target = targetItem ? events.find((entry) => entry.id === targetItem.sourceEventId) : null
    if (!targetItem || !target) {
      closeCalendarItemContextMenu()
      return
    }
    const source = sourceMap.get(target.source_id || activeMainSourceId)
    if (isReadOnlySource(source)) {
      showClipboardStatus('Read-only item cannot be deleted here.')
      closeCalendarItemContextMenu()
      return
    }
    const rule = normaliseRecurrenceRule(target.recurrence_rule)
    if (rule.type === 'none' || rule.endType === 'whenCompleted') {
      void handleContextDeleteItem(itemId)
      return
    }
    const occurrenceStart = new Date(targetItem.occurrenceStartTime)
    const baseStartKey = getUtcDateKey(new Date(target.start_time))
    const occurrenceKey = getUtcDateKey(occurrenceStart)
    if (occurrenceKey <= baseStartKey) {
      void handleContextDeleteItem(itemId)
      return
    }
    const dayBefore = new Date(occurrenceStart)
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1)
    const updatedRule: RecurrenceRule = {
      ...rule,
      endType: 'on',
      endDate: getUtcDateKey(dayBefore),
      endCount: undefined,
    }

    const previous = events
    setEvents((prev) => prev.map((entry) => (entry.id === target.id ? { ...entry, recurrence_rule: updatedRule } : entry)))
    if (selectedItemId === itemId) setSelectedItemId(null)
    closeCalendarItemContextMenu()
    try {
      await apiClient.put(`/api/user-events/${target.id}`, { recurrence_rule: updatedRule })
    } catch (err) {
      console.error('Failed to delete following occurrences:', err)
      setEvents(previous)
      showClipboardStatus('Could not delete occurrences. Try again.')
    }
  }, [activeMainSourceId, closeCalendarItemContextMenu, events, handleContextDeleteItem, interactionItemMap, items, selectedItemId, showClipboardStatus, sourceMap])

  const handleContextToggleCategory = useCallback(async (itemId: string, categoryId: string) => {
    const targetItem = interactionItemMap.get(itemId) || items.find((entry) => entry.id === itemId)
    const sourceEventId = targetItem?.sourceEventId || itemId
    // Resolve through the pending->created map and read the freshest rows: the
    // menu or closure may still reference a pending row that was already swapped.
    const writeId = resolveEventId(sourceEventId)
    const target = eventsRef.current.find((entry) => entry.id === writeId)
      || events.find((entry) => entry.id === writeId)
      || events.find((entry) => entry.id === sourceEventId)
    if (!target) return
    const source = sourceMap.get(target.source_id || activeMainSourceId)
    if (isReadOnlySource(source)) {
      showClipboardStatus('Read-only item cannot be edited here.')
      return
    }
    const currentIds = Array.isArray(target.category_ids) ? target.category_ids : []
    const nextIds = currentIds.includes(categoryId)
      ? currentIds.filter((id) => id !== categoryId)
      : [...currentIds, categoryId]

    const recurrenceRule = normaliseRecurrenceRule(target.recurrence_rule)
    if (recurrenceRule.type !== 'none' && !isPendingEventId(writeId)) {
      setCalendarItemContextMenu(null)
      await persistRecurringItemEdit({ ...target, id: writeId }, targetItem?.occurrenceStartTime || target.start_time, { category_ids: nextIds })
      return
    }

    const applyCategoryIds = (list: UserEventRecord[]): UserEventRecord[] => (
      list.map((entry) => (entry.id === writeId ? { ...entry, category_ids: nextIds } : entry))
    )
    const isSelectedTarget = selectedItemId === itemId || selectedItemId === sourceEventId || selectedItemId === writeId
    if (isSelectedTarget) {
      setDraft((prev) => ({ ...prev, categoryIds: nextIds }))
    }

    if (isPendingEventId(writeId)) {
      // Create still in flight: tag the pending row (eagerly mirrored to the ref
      // so the create response picks it up) and let the create persist it.
      eventsRef.current = applyCategoryIds(eventsRef.current)
      setEvents(applyCategoryIds)
      return
    }

    const previousIds = currentIds
    setEvents(applyCategoryIds)

    beginEventMutation(writeId)
    try {
      await apiClient.put(`/api/user-events/${writeId}`, { category_ids: nextIds })
    } catch (err) {
      console.error('Failed to update categories:', err)
      setEvents((prev) => prev.map((entry) => (entry.id === writeId ? { ...entry, category_ids: previousIds } : entry)))
      if (isSelectedTarget) {
        setDraft((prev) => ({ ...prev, categoryIds: previousIds }))
      }
      showClipboardStatus('Could not update categories. Try again.')
    } finally {
      endEventMutation(writeId)
    }
  }, [activeMainSourceId, beginEventMutation, endEventMutation, events, interactionItemMap, items, persistRecurringItemEdit, resolveEventId, selectedItemId, showClipboardStatus, sourceMap])

  const getContextMenuTargetCategoryIds = useCallback((): string[] => {
    if (!calendarItemContextMenu) return []
    const targetItem = interactionItemMap.get(calendarItemContextMenu.itemId)
      || items.find((entry) => entry.id === calendarItemContextMenu.itemId)
    const sourceEventId = targetItem?.sourceEventId || calendarItemContextMenu.itemId
    const targetEvent = events.find((entry) => entry.id === sourceEventId)
    return Array.isArray(targetEvent?.category_ids) ? targetEvent.category_ids : []
  }, [calendarItemContextMenu, events, interactionItemMap, items])

  const getMultiSelectCategoryState = useCallback((categoryId: string): 'all' | 'some' | 'none' => {
    const targets = getMultiSelectTargets()
    if (targets.length === 0) return 'none'
    const sourceEventIds = Array.from(new Set(targets.map((target) => target.sourceEventId)))
    let haveCount = 0
    for (const id of sourceEventIds) {
      const sourceEvent = events.find((entry) => entry.id === id)
      const categoryIds = Array.isArray(sourceEvent?.category_ids) ? sourceEvent.category_ids : []
      if (categoryIds.includes(categoryId)) haveCount += 1
    }
    if (haveCount === 0) return 'none'
    if (haveCount === sourceEventIds.length) return 'all'
    return 'some'
  }, [events, getMultiSelectTargets])

  const handleBulkToggleCategoryMultiSelected = useCallback(async (categoryId: string) => {
    const targets = getMultiSelectTargets()
    if (targets.length === 0) return
    const hasReadOnly = targets.some((target) => isReadOnlySource(sourceMap.get(target.sourceId)))
    if (hasReadOnly) {
      showClipboardStatus('One or more selected items are read-only and cannot be tagged here.')
      return
    }

    const sourceEventIds = Array.from(new Set(targets.map((target) => target.sourceEventId)))
    // If every item already carries the tag, remove it from all; otherwise add it to whichever are missing it.
    const shouldRemove = getMultiSelectCategoryState(categoryId) === 'all'
    const nextIdsByEvent = new Map<string, string[]>()
    for (const id of sourceEventIds) {
      const sourceEvent = events.find((entry) => entry.id === id)
      const currentIds = Array.isArray(sourceEvent?.category_ids) ? sourceEvent.category_ids : []
      const nextIds = shouldRemove
        ? currentIds.filter((entry) => entry !== categoryId)
        : (currentIds.includes(categoryId) ? currentIds : [...currentIds, categoryId])
      nextIdsByEvent.set(id, nextIds)
    }

    const recurringTargets = targets.filter((target) => {
      const sourceEvent = events.find((event) => event.id === target.sourceEventId)
      const rule = normaliseRecurrenceRule(sourceEvent?.recurrence_rule)
      return rule.type !== 'none' && rule.endType !== 'whenCompleted'
    })
    if (recurringTargets.length > 0) {
      setCalendarItemContextMenu(null)
      const scope = await requestRecurringEditScope('Selected recurring items')
      if (!scope) return
      const processed = new Set<string>()
      for (const target of [...targets].sort((first, second) => first.occurrenceStartTime.localeCompare(second.occurrenceStartTime))) {
        const sourceEvent = eventsRef.current.find((event) => event.id === target.sourceEventId)
        if (!sourceEvent) continue
        const isRecurring = normaliseRecurrenceRule(sourceEvent.recurrence_rule).type !== 'none'
        const key = isRecurring && scope === 'this' ? `${sourceEvent.id}_${target.occurrenceStartTime}` : sourceEvent.id
        if (processed.has(key)) continue
        processed.add(key)
        const categoryIds = nextIdsByEvent.get(sourceEvent.id) || []
        if (isRecurring) {
          const saved = await persistRecurringItemEdit(sourceEvent, target.occurrenceStartTime, { category_ids: categoryIds }, scope)
          if (!saved) return
        } else {
          beginEventMutation(sourceEvent.id)
          try {
            if (!isPendingEventId(sourceEvent.id)) await apiClient.put(`/api/user-events/${sourceEvent.id}`, { category_ids: categoryIds })
            setEvents((prev) => prev.map((event) => event.id === sourceEvent.id ? { ...event, category_ids: categoryIds } : event))
          } catch (error) {
            console.error('Failed to update selected item tags:', error)
            showClipboardStatus('Could not update tags for selected items. Try again.')
            return
          } finally {
            endEventMutation(sourceEvent.id)
          }
        }
      }
      return
    }

    const previous = events
    setEvents((prev) => prev.map((entry) => (
      nextIdsByEvent.has(entry.id) ? { ...entry, category_ids: nextIdsByEvent.get(entry.id) } : entry
    )))

    const idsToPersist = sourceEventIds.filter((id) => !id.startsWith('pending-'))
    for (const id of idsToPersist) beginEventMutation(id)
    try {
      await Promise.all(idsToPersist.map((id) => apiClient.put(`/api/user-events/${id}`, { category_ids: nextIdsByEvent.get(id) })))
      showClipboardStatus(`Updated tags on ${sourceEventIds.length} item${sourceEventIds.length === 1 ? '' : 's'}.`)
    } catch (err) {
      console.error('Failed to update tags for selected items:', err)
      setEvents(previous)
      showClipboardStatus('Could not update tags for selected items. Try again.')
    } finally {
      for (const id of idsToPersist) endEventMutation(id)
    }
  }, [beginEventMutation, endEventMutation, events, getMultiSelectCategoryState, getMultiSelectTargets, persistRecurringItemEdit, requestRecurringEditScope, showClipboardStatus, sourceMap])

  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable handler; wrapping in useCallback would cascade through co-located helpers in this large view
  const updateTimeBackground = (periodId: string, updates: Partial<TimeBackgroundPeriod>) => {
    setTimeBackgrounds((prev) => prev.map((period) => (period.id === periodId ? { ...period, ...updates } : period)))
  }

  const handleAddTimeBackground = () => {
    const nextPeriod = createTimeBackgroundPeriod(timeBackgrounds.map((period) => period.color))
    setTimeBackgrounds((prev) => [...prev, nextPeriod])
    setCollapsedBackgroundIds((prev) => {
      const next = new Set(prev)
      next.delete(nextPeriod.id)
      return next
    })
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable handler; wrapping in useCallback would cascade through co-located helpers in this large view
  const handleDeleteTimeBackground = (periodId: string) => {
    setTimeBackgrounds((prev) => {
      const next = prev.filter((entry) => entry.id !== periodId)
      if (prev.length > 0 && next.length === 0) {
        allowClearTimeBackgroundsRef.current = true
      }
      return next
    })
    setDeletingBackgroundId((current) => (current === periodId ? null : current))
  }

  const toggleTimeBackgroundCard = (periodId: string) => {
    setCollapsedBackgroundIds((prev) => {
      const next = new Set(prev)
      if (next.has(periodId)) {
        next.delete(periodId)
      } else {
        next.add(periodId)
      }
      return next
    })
  }

  const toggleSection = (section: 'month' | 'modes' | 'sources' | 'categories' | 'editor' | 'timeWidth' | 'quickObjects') => {
    setExpandedSections((prev) => {
      const wasOpen = prev.has(section)
      const next = new Set(prev)
      if (wasOpen) {
        next.delete(section)
        if (section === 'timeWidth') {
          setCollapsedBackgroundIds(new Set(timeBackgrounds.map((period) => period.id)))
        }
      } else {
        next.add(section)
      }
      return next
    })
  }

  const getSectionElement = (section: LeftPanelSectionId): HTMLElement | null => {
    if (section === 'month') return sectionMonthRef.current
    if (section === 'modes') return sectionModesRef.current
    if (section === 'sources') return sectionSourcesRef.current
    if (section === 'categories') return sectionCategoriesRef.current
    if (section === 'timeWidth') return sectionTimeWidthRef.current
    if (section === 'editor') return sectionEditorRef.current
    return sectionQuickObjectsRef.current
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable handler; wrapping in useCallback would cascade through co-located helpers in this large view
  const setSectionExpanded = (section: LeftPanelSectionId, expanded: boolean) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (expanded) {
        next.add(section)
      } else {
        next.delete(section)
      }
      return next
    })
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable handler; wrapping in useCallback would cascade through co-located helpers in this large view
  const scrollSectionToMiddle = (section: LeftPanelSectionId) => {
    window.setTimeout(() => {
      const node = getSectionElement(section)
      if (!node) return
      node.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
    }, 80)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable handler; wrapping in useCallback would cascade through co-located helpers in this large view
  const resolveActionTimezone = (value: string | undefined): string => {
    if (!value || typeof value !== 'string') return 'UTC'
    const trimmed = value.trim()
    if (trimmed.toLowerCase().includes('eston')) return 'Europe/Tallinn'
    if (findTimezone(trimmed)) return trimmed
    const normalized = trimmed.toLowerCase()
    const matched = tzState.all.find((iana) => iana.toLowerCase() === normalized)
    if (matched) return matched
    const byCity = findTimezone(`Europe/${trimmed.replace(/\s+/g, '_')}`)
    if (byCity) return byCity.iana
    return 'UTC'
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable handler; wrapping in useCallback would cascade through co-located helpers in this large view
  const localTimeToUtcMinute = (timeValue: string | undefined, timezoneIana: string): number | null => {
    if (!timeValue || typeof timeValue !== 'string') return null
    const localMinute = parseTimeInput(timeValue)
    const entry = findTimezone(timezoneIana)
    const offsetMinutes = entry?.offsetMinutes ?? 0
    const utcMinute = ((localMinute - offsetMinutes) % MINUTES_IN_DAY + MINUTES_IN_DAY) % MINUTES_IN_DAY
    return utcMinute
  }

  useEffect(() => {
    if (selectedItem) {
      setIsNewItemDraft(false)
      const isSameSelection = selectedDraftHydratedItemIdRef.current === selectedItem.id
      if (isSameSelection && isSelectedItemDirty) {
        return
      }

      const selectedEventLocation = selectedEvent?.location || null

      setDraft((prev) => {
        const hasTitleChanges = prev.title !== selectedItem.title
        const hasNotesChanges = prev.notes !== selectedItem.notes
        const hasLocationChanges = (prev.location || null) !== selectedEventLocation
        const hasSourceChanges = prev.sourceId !== selectedItem.sourceId
        const hasCategoryChanges = !areStringArraysEqual(prev.categoryIds, selectedItem.categoryIds)
        const selectedEventRecurrence = normaliseRecurrenceRule(selectedEvent?.recurrence_rule)
        const hasRecurrenceChanges = JSON.stringify(normaliseRecurrenceRule(prev.recurrenceRule)) !== JSON.stringify(selectedEventRecurrence)

        if (!hasTitleChanges && !hasNotesChanges && !hasLocationChanges && !hasSourceChanges && !hasCategoryChanges && !hasRecurrenceChanges) {
          return prev
        }

        return {
          title: selectedItem.title,
          notes: selectedItem.notes,
          location: selectedEventLocation,
          categoryIds: selectedItem.categoryIds,
          sourceId: selectedItem.sourceId,
          recurrenceRule: selectedEventRecurrence,
        }
      })
      selectedDraftHydratedItemIdRef.current = selectedItem.id
      if (!isSameSelection) {
        setShowItemRecurrencePanel(Boolean(selectedEvent?.recurrence_rule && selectedEvent.recurrence_rule.type !== 'none'))
        // External items synced with a location/meeting link surface it automatically.
        setIsLocationFieldVisible(Boolean(selectedEventLocation && selectedEventLocation.trim()))
      }
      return
    }

    if (selectedDraftHydratedItemIdRef.current !== null) {
      selectedDraftHydratedItemIdRef.current = null
      setIsLocationFieldVisible(false)
    }

    if (selectionDraft) {
      setDraft((prev) => ({
        ...prev,
        sourceId: MAIN_SOURCE_ID,
      }))
    }
  }, [isSelectedItemDirty, selectedEvent?.location, selectedEvent?.recurrence_rule, selectedItem, selectionDraft])

  useEffect(() => {
    if (!selectedEvent?.id.startsWith('pending-')) return

    const pendingEventId = selectedEvent.id
    const pendingDescription = notesToEventDescription(draft.notes)
    const pendingRecurrenceRule = normaliseRecurrenceRule(draft.recurrenceRule)

    setEvents((prev) => {
      let hasChanges = false
      const next = prev.map((entry) => {
        if (entry.id !== pendingEventId) return entry

        const currentCategoryIds = Array.isArray(entry.category_ids) ? entry.category_ids : []
        const currentRecurrenceRule = normaliseRecurrenceRule(entry.recurrence_rule)
        const hasTitleChanges = entry.title !== draft.title
        const hasDescriptionChanges = entry.description !== pendingDescription
        const hasCategoryChanges = !areStringArraysEqual(currentCategoryIds, draft.categoryIds)
        const hasRecurrenceChanges = JSON.stringify(currentRecurrenceRule) !== JSON.stringify(pendingRecurrenceRule)

        if (!hasTitleChanges && !hasDescriptionChanges && !hasCategoryChanges && !hasRecurrenceChanges) {
          return entry
        }

        hasChanges = true
        return {
          ...entry,
          title: draft.title,
          description: pendingDescription,
          category_ids: [...draft.categoryIds],
          recurrence_rule: pendingRecurrenceRule,
        }
      })

      return hasChanges ? next : prev
    })
  }, [draft, selectedEvent?.id])

  useEffect(() => {
    setCollapsedBackgroundIds((prev) => {
      const existingIds = new Set(timeBackgrounds.map((period) => period.id))
      const next = new Set(Array.from(prev).filter((id) => existingIds.has(id)))
      if (next.size === prev.size && Array.from(next).every((id) => prev.has(id))) return prev
      return next
    })
  }, [timeBackgrounds])

  useEffect(() => {
    if (syncCalendars.some((source) => source.id === draft.sourceId)) return
    setDraft((prev) => ({
      ...prev,
      sourceId: MAIN_SOURCE_ID,
    }))
  }, [draft.sourceId, syncCalendars])

  useEffect(() => {
    setIsDeleteConfirmOpen(false)
  }, [selectedItemId, selectionDraft])

  useEffect(() => {
    if (!pendingTemplateSourceId) {
      setPendingTemplateQuickName('')
      return
    }

    if (pendingTemplateSourceItem) return
    setPendingTemplateSourceId(null)
    setPendingTemplateQuickName('')
  }, [pendingTemplateSourceId, pendingTemplateSourceItem])

  useEffect(() => () => {
    if (descriptionHintTimeoutRef.current) {
      window.clearTimeout(descriptionHintTimeoutRef.current)
    }
    if (clipboardStatusTimeoutRef.current) {
      window.clearTimeout(clipboardStatusTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    if (!deletingBackgroundId) return
    const exists = timeBackgrounds.some((period) => period.id === deletingBackgroundId)
    if (!exists) {
      setDeletingBackgroundId(null)
    }
  }, [deletingBackgroundId, timeBackgrounds])

  useEffect(() => {
    if (!deletingTemplateId) {
      setDeletingTemplatePopoverPosition(null)
      return
    }
    const exists = quickTemplates.some((template) => template.id === deletingTemplateId)
    if (!exists) {
      setDeletingTemplateId(null)
      setDeletingTemplatePopoverPosition(null)
    }
  }, [deletingTemplateId, quickTemplates])

  useEffect(() => {
    const handlePointerDownOutsideDeletePopovers = (event: globalThis.MouseEvent) => {
      if (!(event.target instanceof HTMLElement)) return
      const insideDeletePopoverRoot = event.target.closest('[data-delete-popover-root="true"]')
      if (!insideDeletePopoverRoot) {
        setIsDeleteConfirmOpen(false)
        setDeletingBackgroundId(null)
        setDeletingTemplateId(null)
        setDeletingTemplatePopoverPosition(null)
      }

      const insideMoveScopeRoot = event.target.closest('[data-move-scope-root="true"]')
      if (!insideMoveScopeRoot) {
        setIsMoveScopeOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDownOutsideDeletePopovers)
    return () => {
      window.removeEventListener('mousedown', handlePointerDownOutsideDeletePopovers)
    }
  }, [])

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const node = target instanceof Node ? target : null
      const element = node instanceof HTMLElement ? node : node?.parentElement
      if (!(element instanceof HTMLElement)) return false

      const tagName = element.tagName.toLowerCase()
      if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return true
      return element.isContentEditable
    }

    const hasTextSelection = () => {
      const selection = window.getSelection()
      return Boolean(selection && !selection.isCollapsed)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      if (isFullEditorOpen) return

      const key = event.key.toLowerCase()

      // Move-mode paste should win even when an input has focus,
      // because the user already chose a destination on the calendar.
      if (key === 'v' && movingItemId && selectionDraft) {
        event.preventDefault()
        void handleSaveSelectionFromSurface('calendarGrid')
        return
      }

      if (key === 'a' && isSelectionTitleTypingMode && !isEditableTarget(event.target)) {
        event.preventDefault()
        selectionTitleInputRef.current?.focus()
        selectionTitleInputRef.current?.select()
        return
      }

      if (isEditableTarget(event.target)) return
      if (hasTextSelection()) return

      if (key === 'c') {
        if (multiSelectedItemIds.size > 0) {
          event.preventDefault()
          handleBulkCopyMultiSelected()
        } else if (selectedItem && copySelectedItem()) {
          event.preventDefault()
        }
      }

      if (key === 'x') {
        if (multiSelectedItemIds.size > 0) {
          event.preventDefault()
          handleBulkCutMultiSelected()
          return
        }

        if (!selectedItem) {
          return
        }

        if (startMoveItem(selectedItem.id)) {
          event.preventDefault()
        }
      }

      if (key === 'v') {
        if (selectionDraft && multiClipboard) {
          event.preventDefault()
          void pasteMultiClipboardToSelection()
        } else if (selectionDraft && copiedItem) {
          event.preventDefault()
          void pasteCopiedItemToSelection()
        }
      }

      return
    }

    const handleDirectSelectionTyping = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (!isSelectionTitleTypingMode) return
      if (isFullEditorOpen) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (isEditableTarget(event.target)) return

      const activeElement = document.activeElement
      if (activeElement instanceof HTMLElement) {
        if (activeElement.isContentEditable) return
        if (activeElement.closest('.markdown-editor')) return
      }

      const selection = window.getSelection()
      const selectionNode = selection?.anchorNode
      if (selectionNode instanceof Node) {
        const selectionElement = selectionNode instanceof HTMLElement ? selectionNode : selectionNode.parentElement
        if (selectionElement?.closest('.markdown-editor')) return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        handleDiscardSelectionDraft({ preserveCustomContent: true })
        return
      }

      if (event.key === 'Enter') {
        if (!canSaveNewSelectionItem) return
        event.preventDefault()
        void handleSaveSelectionFromSurface('calendarGrid')
        return
      }

      if (event.key === 'Backspace') {
        event.preventDefault()
        setDraft((prev) => ({ ...prev, title: prev.title.slice(0, -1) }))
        setExpandedSections((prev) => {
          const next = new Set(prev)
          next.add('editor')
          return next
        })
        triggerTitleTypingHint()
        return
      }

      if (event.key === 'Delete') {
        event.preventDefault()
        setDraft((prev) => ({ ...prev, title: '' }))
        setExpandedSections((prev) => {
          const next = new Set(prev)
          next.add('editor')
          return next
        })
        triggerTitleTypingHint()
        return
      }

      if (event.key === ' ' || event.key.length === 1) {
        event.preventDefault()
        setDraft((prev) => ({ ...prev, title: `${prev.title}${event.key}` }))
        setExpandedSections((prev) => {
          const next = new Set(prev)
          next.add('editor')
          return next
        })
        triggerTitleTypingHint()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keydown', handleDirectSelectionTyping)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keydown', handleDirectSelectionTyping)
    }
  }, [
    canSaveNewSelectionItem,
    copySelectedItem,
    copiedItem,
    handleBulkCopyMultiSelected,
    handleBulkCutMultiSelected,
    handleSaveSelectionFromSurface,
    handleDiscardSelectionDraft,
    isFullEditorOpen,
    isSelectionTitleTypingMode,
    movingItemId,
    multiClipboard,
    multiSelectedItemIds,
    pasteCopiedItemToSelection,
    pasteMultiClipboardToSelection,
    selectedItem,
    selectionDraft,
    startMoveItem,
    triggerTitleTypingHint,
  ])

  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable handler; wrapping in useCallback would cascade through co-located helpers in this large view
  const startCreateCategory = () => {
    setEditingCategoryId(null)
    setCategoryColorTarget('background')
    setCategoryDraft({ label: '', color: '#3b82f6', fontColor: DEFAULT_CATEGORY_FONT_COLOR, backgroundOpacity: DEFAULT_CATEGORY_BACKGROUND_OPACITY, itemOpacity: DEFAULT_CATEGORY_ITEM_OPACITY })
    setExpandedSections((prev) => {
      const next = new Set(prev)
      next.add('categories')
      return next
    })
  }

  const startEditCategory = (cat: Category) => {
    setEditingCategoryId(cat.id)
    setCategoryColorTarget('background')
    setCategoryDraft({
      label: cat.label,
      color: cat.color,
      fontColor: cat.font_color || DEFAULT_CATEGORY_FONT_COLOR,
      backgroundOpacity: normaliseCategoryBackgroundOpacity(cat.background_opacity),
      itemOpacity: normaliseCategoryItemOpacity(cat.item_opacity),
    })
  }

  const cancelCategoryEdit = () => {
    setEditingCategoryId(null)
    setCategoryDraft(null)
  }

  const handleSaveCategory = async () => {
    if (!categoryDraft) return
    const label = categoryDraft.label.trim()
    if (!label) {
      showClipboardStatus('Category needs a label.')
      return
    }

    try {
      if (editingCategoryId) {
        const { data } = await apiClient.put<{ category: Category }>(
          `/api/time-management/categories/${editingCategoryId}`,
          {
            label,
            color: categoryDraft.color,
            font_color: categoryDraft.fontColor,
            background_opacity: normaliseCategoryBackgroundOpacity(categoryDraft.backgroundOpacity),
            item_opacity: normaliseCategoryItemOpacity(categoryDraft.itemOpacity),
          }
        )
        const updated = data?.category
        if (!updated) return
        setCategories((prev) => prev.map((c) => (c.id === updated.id
          ? {
              ...updated,
              font_color: isHexColor(updated.font_color) ? updated.font_color : DEFAULT_CATEGORY_FONT_COLOR,
              background_opacity: normaliseCategoryBackgroundOpacity(updated.background_opacity),
              item_opacity: normaliseCategoryItemOpacity(updated.item_opacity),
            }
          : c)))
      } else {
        const { data } = await apiClient.post<{ category: Category }>(
          '/api/time-management/categories',
          {
            label,
            color: categoryDraft.color,
            font_color: categoryDraft.fontColor,
            background_opacity: normaliseCategoryBackgroundOpacity(categoryDraft.backgroundOpacity),
            item_opacity: normaliseCategoryItemOpacity(categoryDraft.itemOpacity),
          }
        )
        const created = data?.category
        if (!created) return
        setCategories((prev) => [
          ...prev,
          {
            ...created,
            font_color: isHexColor(created.font_color) ? created.font_color : DEFAULT_CATEGORY_FONT_COLOR,
            background_opacity: normaliseCategoryBackgroundOpacity(created.background_opacity),
            item_opacity: normaliseCategoryItemOpacity(created.item_opacity),
          },
        ])
      }
      setEditingCategoryId(null)
      setCategoryDraft(null)
    } catch (err) {
      console.error('Failed to save category:', err)
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Could not save category.'
      showClipboardStatus(msg)
    }
  }

  const handleDeleteCategory = async (cat: Category) => {
    setCategoryDeleteTarget(null)
    try {
      await apiClient.delete(`/api/time-management/categories/${cat.id}`)
      setCategories((prev) => prev.filter((c) => c.id !== cat.id))
      // Strip from any local events optimistically.
      setEvents((prev) =>
        prev.map((event) =>
          Array.isArray(event.category_ids) && event.category_ids.includes(cat.id)
            ? { ...event, category_ids: event.category_ids.filter((id) => id !== cat.id) }
            : event
        )
      )
      setDraft((prev) => ({
        ...prev,
        categoryIds: prev.categoryIds.filter((id) => id !== cat.id),
      }))
    } catch (err) {
      console.error('Failed to delete category:', err)
      showClipboardStatus('Could not delete category.')
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable handler; wrapping in useCallback would cascade through co-located helpers in this large view
  const handleMainColorChange = async (nextColor: string): Promise<boolean> => {
    const previous = prefs
    setPrefs((prev) => ({ ...prev, main_color: nextColor }))
    try {
      if (activeModeId) {
        await apiClient.put(`/api/time-management/modes/${activeModeId}`, { main_color: nextColor })
      } else {
        await apiClient.put('/api/time-management/prefs', { main_color: nextColor })
      }
      return true
    } catch (err) {
      console.error('Failed to update Main calendar color:', err)
      setPrefs(previous)
      showClipboardStatus('Could not save Main calendar color.')
      return false
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable handler; wrapping in useCallback would cascade through co-located helpers in this large view
  const handleMainLabelCommit = async (nextLabel: string): Promise<boolean> => {
    const trimmed = nextLabel.trim() || 'Coordination Manager Main'
    if (trimmed === prefs.main_label && nextLabel === prefs.main_label) return true
    const previous = prefs
    setPrefs((prev) => ({ ...prev, main_label: trimmed }))
    try {
      if (activeModeId) {
        await apiClient.put(`/api/time-management/modes/${activeModeId}`, { name: trimmed })
      } else {
        await apiClient.put('/api/time-management/prefs', { main_label: trimmed })
      }
      return true
    } catch (err) {
      console.error('Failed to update Main calendar label:', err)
      setPrefs(previous)
      showClipboardStatus('Could not save Main calendar label.')
      return false
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable handler; wrapping in useCallback would cascade through co-located helpers in this large view
  const handleCategoryColorDisplayStyleChange = async (nextStyle: CategoryColorDisplayStyle): Promise<boolean> => {
    if (nextStyle === prefs.category_color_display_style) return true

    const previousPrefs = prefs
    setPrefs((prev) => ({ ...prev, category_color_display_style: nextStyle }))

    if (activeModeId) {
      setModes((prev) =>
        prev.map((mode) =>
          mode.id === activeModeId
            ? { ...mode, category_color_display_style: nextStyle }
            : mode
        )
      )
    }

    try {
      if (activeModeId) {
        await apiClient.put(`/api/time-management/modes/${activeModeId}`, {
          category_color_display_style: nextStyle,
        })
      } else {
        await apiClient.put('/api/time-management/prefs', {
          category_color_display_style: nextStyle,
        })
      }
    } catch (err) {
      console.error('Failed to update category color display style:', err)
      setPrefs(previousPrefs)
      if (activeModeId) {
        setModes((prev) =>
          prev.map((mode) =>
            mode.id === activeModeId
              ? {
                  ...mode,
                  category_color_display_style: previousPrefs.category_color_display_style,
                }
              : mode
          )
        )
      }
      showClipboardStatus('Could not save category color display style.')
      return false
    }
    return true
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable handler; wrapping in useCallback would cascade through co-located helpers in this large view
  const openExportDialog = () => {
    if (!selectedEvent) return
    setExportTargetIds(new Set())
    setExportStatus(null)
    setExportKeepInSync(false)
    setExportDialogOpen(true)
  }

  const handleExportToCalendars = async () => {
    if (!selectedEvent) return
    const targets = Array.from(exportTargetIds)
    if (targets.length === 0) {
      setExportStatus('Pick at least one calendar.')
      return
    }
    const sourceEvent = selectedEvent
    if (!sourceEvent) return

    setIsExporting(true)
    setExportStatus(null)
    // Own items export as a linked Google copy (whole series, later edits can be pushed).
    const seriesId = sourceEvent.series_id || sourceEvent.id
    if (sourceEvent.source_type === 'manual' && !seriesId.startsWith('pending-')) {
      let succeeded = 0
      for (const sourceId of targets) {
        try {
          await apiClient.post(`/api/google-sync/user-events/${seriesId}/export`, { sourceId, keepInSync: exportKeepInSync })
          succeeded++
        } catch (err) {
          console.error('Failed to export item:', err)
        }
      }
      const failed = targets.length - succeeded
      setExportStatus(`Exported to ${succeeded} calendar(s)${failed > 0 ? ` (${failed} failed)` : ''}.`)
      setGoogleSyncRefreshKey((key) => key + 1)
      setIsExporting(false)
      if (failed === 0) window.setTimeout(() => setExportDialogOpen(false), 1500)
      return
    }
    try {
      const { data } = await apiClient.post<{ succeeded: number; failed: number; message: string }>(
        '/api/calendar-sources/add-event',
        {
          event: {
            title: sourceEvent.title,
            description: sourceEvent.description,
            meeting_link: sourceEvent.meeting_link,
            location: sourceEvent.location,
            start_time: sourceEvent.start_time,
            end_time: sourceEvent.end_time,
          },
          targetSourceIds: targets,
        }
      )
      setExportStatus(data?.message || `Exported to ${data?.succeeded ?? 0} calendar(s).`)
      if ((data?.failed ?? 0) === 0) {
        window.setTimeout(() => setExportDialogOpen(false), 1500)
      }
    } catch (err) {
      console.error('Failed to export item:', err)
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Export failed.'
      setExportStatus(msg)
    } finally {
      setIsExporting(false)
    }
  }

  const runTimeManagementAiAction = useCallback(async (action: TimeManagementAiAction, applied: string[], issues: string[]) => {
    const section = action.section
    if (action.type === 'open_left_panel') {
      setIsLeftPanelOpen(true)
      applied.push('Opened the left side panel')
      return
    }
    if (action.type === 'close_left_panel') {
      setIsLeftPanelOpen(false)
      applied.push('Closed the left side panel')
      return
    }
    if (action.type === 'expand_section' && section) {
      setIsLeftPanelOpen(true)
      setSectionExpanded(section, true)
      applied.push(`Expanded ${section} section`)
      return
    }
    if (action.type === 'collapse_section' && section) {
      setSectionExpanded(section, false)
      applied.push(`Collapsed ${section} section`)
      return
    }
    if (action.type === 'scroll_section' && section) {
      setIsLeftPanelOpen(true)
      setSectionExpanded(section, true)
      scrollSectionToMiddle(section)
      applied.push(`Scrolled ${section} section into view`)
      return
    }
    if (action.type === 'set_slot_minutes' && isTimeWidth(action.minutes)) {
      setIsLeftPanelOpen(true)
      setSectionExpanded('timeWidth', true)
      setSlotMinutes(action.minutes)
      scrollSectionToMiddle('timeWidth')
      applied.push(`Set slot width to ${action.minutes} minutes`)
      return
    }
    if (action.type === 'set_hidden_mode' && typeof action.enabled === 'boolean') {
      setIsHiddenModeEnabled(action.enabled)
      setIsLeftPanelOpen(true)
      setSectionExpanded('modes', true)
      scrollSectionToMiddle('modes')
      applied.push(`${action.enabled ? 'Enabled' : 'Disabled'} Hidden mode`)
      return
    }
    if (action.type === 'set_source_enabled' && action.sourceName && typeof action.enabled === 'boolean') {
      const needle = action.sourceName.toLowerCase().trim()
      const matched = syncCalendars.find((source) => source.name.toLowerCase().includes(needle))
      if (matched) {
        setSyncCalendars((prev) =>
          prev.map((source) =>
            source.id === matched.id
              ? { ...source, enabled: action.enabled as boolean }
              : source
          )
        )
        setIsLeftPanelOpen(true)
        setSectionExpanded('sources', true)
        scrollSectionToMiddle('sources')
        applied.push(`${action.enabled ? 'Enabled' : 'Disabled'} source "${matched.name}"`)
      } else {
        issues.push(`set_source_enabled: no source matches "${action.sourceName}". Available sources: ${syncCalendars.map((source) => `"${source.name}"`).join(', ') || 'none'}.`)
      }
      return
    }
    if (action.type === 'ensure_timezone' && action.iana) {
      const iana = resolveActionTimezone(action.iana)
      if (action.mode === 'primary') {
        tzState.setPrimary(iana)
        applied.push(`Set primary timezone to ${iana}`)
      } else if (!tzState.all.includes(iana)) {
        tzState.addTimezone(iana)
        applied.push(`Added timezone ${iana}`)
      }
      return
    }
    if (action.type === 'create_background_period') {
      const timezoneIana = resolveActionTimezone(action.timezone)
      if (timezoneIana !== 'UTC' && !tzState.all.includes(timezoneIana)) {
        tzState.addTimezone(timezoneIana)
        applied.push(`Added timezone ${timezoneIana}`)
      }
      const startMinute = localTimeToUtcMinute(action.startTime, timezoneIana)
      const endMinute = localTimeToUtcMinute(action.endTime, timezoneIana)
      if ((action.startTime && startMinute === null) || (action.endTime && endMinute === null)) {
        issues.push(`create_background_period: startTime "${action.startTime ?? ''}" / endTime "${action.endTime ?? ''}" must be HH:MM (24h). No background period was created.`)
        return
      }
      const nextPeriod = createTimeBackgroundPeriod(timeBackgrounds.map((period) => period.color))
      const created: TimeBackgroundPeriod = {
        ...nextPeriod,
        label: action.label || nextPeriod.label,
        startMinute: startMinute ?? nextPeriod.startMinute,
        endMinute: endMinute ?? nextPeriod.endMinute,
        color: isHexColor(action.color) ? action.color.toLowerCase() : nextPeriod.color,
        opacity: typeof action.opacity === 'number' ? clampOpacity(action.opacity) : nextPeriod.opacity,
      }
      setTimeBackgrounds((prev) => [...prev, created])
      setCollapsedBackgroundIds((prev) => {
        const next = new Set(prev)
        next.delete(created.id)
        return next
      })
      setIsLeftPanelOpen(true)
      setSectionExpanded('timeWidth', true)
      scrollSectionToMiddle('timeWidth')
      const label = created.label.trim() || 'new period'
      applied.push(`Created background period "${label}" (${formatTimeInput(created.startMinute)}-${formatTimeInput(created.endMinute)} UTC)`)
      return
    }
    if (action.type === 'update_background_period') {
      const idx = typeof action.index === 'number' ? action.index : -1
      let target = idx >= 0 && idx < timeBackgrounds.length ? timeBackgrounds[idx] : null
      if (!target && action.matchLabel) {
        const needle = action.matchLabel.toLowerCase().trim()
        target = timeBackgrounds.find((period) => period.label.toLowerCase().includes(needle)) || null
      }
      if (!target) {
        issues.push(`update_background_period: no background period matches index ${action.index ?? 'none'} / matchLabel "${action.matchLabel ?? ''}". Existing periods: ${timeBackgrounds.map((period, i) => `${i}:"${period.label}"`).join(', ') || 'none'}.`)
        return
      }
      const timezoneIana = resolveActionTimezone(action.timezone)
      if (timezoneIana !== 'UTC' && !tzState.all.includes(timezoneIana)) {
        tzState.addTimezone(timezoneIana)
        applied.push(`Added timezone ${timezoneIana}`)
      }
      const startMinute = localTimeToUtcMinute(action.startTime, timezoneIana)
      const endMinute = localTimeToUtcMinute(action.endTime, timezoneIana)
      updateTimeBackground(target.id, {
        label: action.label ?? target.label,
        startMinute: startMinute ?? target.startMinute,
        endMinute: endMinute ?? target.endMinute,
        color: isHexColor(action.color) ? action.color.toLowerCase() : target.color,
        opacity: typeof action.opacity === 'number' ? clampOpacity(action.opacity) : target.opacity,
      })
      setIsLeftPanelOpen(true)
      setSectionExpanded('timeWidth', true)
      scrollSectionToMiddle('timeWidth')
      applied.push(`Updated background period "${action.label || target.label || 'period'}"`)
      return
    }
    if (action.type === 'delete_background_period') {
      const idx = typeof action.index === 'number' ? action.index : -1
      let target = idx >= 0 && idx < timeBackgrounds.length ? timeBackgrounds[idx] : null
      if (!target && action.matchLabel) {
        const needle = action.matchLabel.toLowerCase().trim()
        target = timeBackgrounds.find((period) => period.label.toLowerCase().includes(needle)) || null
      }
      if (!target) {
        issues.push(`delete_background_period: no background period matches index ${action.index ?? 'none'} / matchLabel "${action.matchLabel ?? ''}". Existing periods: ${timeBackgrounds.map((period, i) => `${i}:"${period.label}"`).join(', ') || 'none'}.`)
        return
      }
      handleDeleteTimeBackground(target.id)
      setIsLeftPanelOpen(true)
      setSectionExpanded('timeWidth', true)
      scrollSectionToMiddle('timeWidth')
      applied.push(`Deleted background period "${target.label || 'period'}"`)
      return
    }
    if (action.type === 'create_mode') {
      const created = await handleCreateMode()
      if (!created) {
        issues.push(modes.length >= MAX_MODE_COUNT
          ? `create_mode: the mode limit (${MAX_MODE_COUNT}) is reached, so no mode was created. The user must delete a mode first.`
          : 'create_mode: the server did not save a new mode.')
        return
      }
      setIsLeftPanelOpen(true)
      setSectionExpanded('modes', true)
      scrollSectionToMiddle('modes')
      applied.push('Created a new mode')
      return
    }
    if (action.type === 'activate_mode' && action.modeName) {
      const needle = action.modeName.toLowerCase().trim()
      const matchedMode = modes.find((mode) => mode.name.toLowerCase().includes(needle))
      if (!matchedMode) {
        issues.push(`activate_mode: no mode matches "${action.modeName}". Existing modes: ${modes.map((mode) => `"${mode.name}"`).join(', ') || 'none'}.`)
        return
      }
      if (await handleActivateMode(matchedMode.id)) {
        setIsLeftPanelOpen(true)
        setSectionExpanded('modes', true)
        scrollSectionToMiddle('modes')
        applied.push(`Activated mode "${matchedMode.name}"`)
      } else {
        issues.push(`activate_mode: the server rejected switching to "${matchedMode.name}".`)
      }
      return
    }
    if (action.type === 'open_mode_settings') {
      setIsLeftPanelOpen(true)
      setSectionExpanded('modes', true)
      setIsModeSettingsOpen(true)
      scrollSectionToMiddle('modes')
      applied.push('Opened Mode settings')
      return
    }
    if (action.type === 'open_mode_import') {
      setIsModeJsonImportOpen(true)
      applied.push('Opened Mode JSON import dialog')
      return
    }
    if (action.type === 'open_mode_export') {
      setIsModeJsonExportOpen(true)
      applied.push('Opened Mode JSON export dialog')
      return
    }
    if (action.type === 'start_create_category') {
      setIsLeftPanelOpen(true)
      setSectionExpanded('categories', true)
      startCreateCategory()
      scrollSectionToMiddle('categories')
      applied.push('Opened Create Category form')
      return
    }
    if (action.type === 'create_category' && action.label && action.label.trim()) {
      const payload = {
        label: action.label.trim(),
        color: isHexColor(action.color) ? action.color : '#3b82f6',
        font_color: isHexColor(action.fontColor) ? action.fontColor : DEFAULT_CATEGORY_FONT_COLOR,
        background_opacity:
          typeof action.backgroundOpacity === 'number'
            ? normaliseCategoryBackgroundOpacity(action.backgroundOpacity)
            : DEFAULT_CATEGORY_BACKGROUND_OPACITY,
        item_opacity:
          typeof action.itemOpacity === 'number'
            ? normaliseCategoryItemOpacity(action.itemOpacity)
            : DEFAULT_CATEGORY_ITEM_OPACITY,
      }
      try {
        const { data } = await apiClient.post<{ category: Category }>('/api/time-management/categories', payload)
        const created = data?.category
        if (created) {
          setCategories((prev) => [
            ...prev,
            {
              ...created,
              font_color: isHexColor(created.font_color) ? created.font_color : DEFAULT_CATEGORY_FONT_COLOR,
              background_opacity: normaliseCategoryBackgroundOpacity(created.background_opacity),
              item_opacity: normaliseCategoryItemOpacity(created.item_opacity),
            },
          ])
          setIsLeftPanelOpen(true)
          setSectionExpanded('categories', true)
          scrollSectionToMiddle('categories')
          applied.push(`Created category "${created.label}"`)
        } else {
          issues.push(`create_category "${payload.label}": the server response did not include the created category, so it was not saved.`)
        }
      } catch (err) {
        const serverMessage = (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data
        issues.push(`create_category "${payload.label}" was rejected by the server: ${serverMessage?.message || serverMessage?.error || 'unknown error'}.`)
      }
      return
    }
    if (action.type === 'set_category_display_style' && action.style) {
      if (!(await handleCategoryColorDisplayStyleChange(action.style))) {
        issues.push(`set_category_display_style "${action.style}" could not be saved.`)
        return
      }
      setIsLeftPanelOpen(true)
      setSectionExpanded('categories', true)
      scrollSectionToMiddle('categories')
      applied.push(`Set category display style to ${action.style}`)
      return
    }
    if (action.type === 'set_main_label' && action.label) {
      const nextLabel = action.label
      setPrefs((prev) => ({ ...prev, main_label: nextLabel }))
      if (!(await handleMainLabelCommit(nextLabel))) {
        issues.push(`set_main_label "${nextLabel}" could not be saved.`)
        return
      }
      setIsLeftPanelOpen(true)
      setSectionExpanded('sources', true)
      scrollSectionToMiddle('sources')
      applied.push(`Updated Main label to "${nextLabel}"`)
      return
    }
    if (action.type === 'set_main_color' && action.color && isHexColor(action.color)) {
      if (!(await handleMainColorChange(action.color))) {
        issues.push(`set_main_color "${action.color}" could not be saved.`)
        return
      }
      setIsLeftPanelOpen(true)
      setSectionExpanded('sources', true)
      scrollSectionToMiddle('sources')
      applied.push('Updated Main calendar color')
      return
    }
    if (action.type === 'open_export_dialog') {
      if (!selectedEvent) {
        issues.push('open_export_dialog needs a selected time item, and none is selected. Tell the user to select an item first.')
        return
      }
      openExportDialog()
      applied.push('Opened export dialog')
      return
    }
    if (action.type === 'set_show_quick_templates' && typeof action.enabled === 'boolean') {
      showQuickTemplatesTouchedRef.current = true
      setShowQuickTemplatesInMain(action.enabled)
      setIsLeftPanelOpen(true)
      setSectionExpanded('quickObjects', true)
      scrollSectionToMiddle('quickObjects')
      applied.push(`${action.enabled ? 'Enabled' : 'Disabled'} quick templates in main panel`)
      return
    }
    if (action.type === 'set_quick_templates_expanded' && typeof action.expanded === 'boolean') {
      setQuickTemplatesMainExpanded(action.expanded)
      setIsLeftPanelOpen(true)
      setSectionExpanded('quickObjects', true)
      scrollSectionToMiddle('quickObjects')
      applied.push(`${action.expanded ? 'Expanded' : 'Collapsed'} quick templates list`)
      return
    }
    issues.push(`Action "${action.type}" is not supported or has missing/invalid parameters: ${JSON.stringify(action).slice(0, 200)}. Nothing was changed for it.`)
  }, [
    handleActivateMode,
    handleCategoryColorDisplayStyleChange,
    handleCreateMode,
    handleDeleteTimeBackground,
    handleMainColorChange,
    handleMainLabelCommit,
    localTimeToUtcMinute,
    modes,
    openExportDialog,
    resolveActionTimezone,
    scrollSectionToMiddle,
    selectedEvent,
    setSectionExpanded,
    startCreateCategory,
    syncCalendars,
    timeBackgrounds,
    tzState,
    updateTimeBackground,
  ])

  const handleTimeManagementAiSubmit = useCallback(async (
    message: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
    retry?: AiRetryRequest,
  ) => {
    const preferredModel = user?.themePreferences?.aiSettings?.preferredModel || 'openai'
    const timeManagementAiAccess = normalizeTimeManagementAiAccess(user?.themePreferences?.aiSettings?.timeManagementAiAccess)

    if (isTimeItemSearchRequest(message) && !timeManagementAiAccess.timeItems) {
      const suggestedAccessLabels = ['Calendar time items']
      const configPath = `${TIME_MANAGEMENT_AI_CONFIG_PATH}&suggestAccess=${TIME_MANAGEMENT_AI_LINK_SEARCH_ACCESS.join(',')}`
      return {
        message: [
          'No changes made; Time Management AI access is off for schedule/link search.',
          '',
          `Suggested access for this request: ${suggestedAccessLabels.join(', ')}.`,
          '',
          'To let me search for Miro board links, enable that access in Settings -> AI -> Time Management AI Access.',
          '',
          'Use Go to AI config to open that section. I will save any open Time Management edit before leaving this page. Once you enable access there, I will let you know you can come back and retry.',
        ].join('\n'),
        action: 'none',
        ctas: [
          { label: 'Go to AI config', to: configPath, retryPrompt: message },
        ],
        quotaConsumed: false,
      }
    }

    const eventById = new Map(events.map((event) => [event.id, event]))
    const accessibleTimeItems = timeManagementAiAccess.timeItems
      ? visibleItems.map((item) => {
        const sourceEvent = eventById.get(item.sourceEventId)
        const occurrenceStart = new Date(item.occurrenceStartTime)
        const occurrenceEnd = new Date(occurrenceStart.getTime() + getTimeItemTotalDurationMinutes(item, slotMinutes) * 60_000)
        return {
          id: item.sourceEventId,
          title: item.title,
          description: sourceEvent?.description || null,
          dayIndex: item.dayIndex,
          date: item.occurrenceStartTime.slice(0, 10),
          time: {
            startUtc: occurrenceStart.toISOString(),
            endUtc: occurrenceEnd.toISOString(),
          },
          recurrence: formatRecurrenceSummary(sourceEvent?.recurrence_rule),
          categories: item.categoryIds,
          address: {
            meetingLink: sourceEvent?.meeting_link || null,
            location: sourceEvent?.location || null,
          },
        }
      })
      : undefined

    // Deterministic client-side link search: bypasses the LLM (which can
    // hallucinate a stale "access is off" refusal from chat history) whenever
    // we already have everything needed to answer locally.
    if (isTimeItemSearchRequest(message) && accessibleTimeItems) {
      const urlPattern = /https?:\/\/\S+/gi
      const itemsWithLinks = accessibleTimeItems
        .map((item) => {
          const links = new Set<string>()
          if (item.address.meetingLink) links.add(item.address.meetingLink)
          if (item.address.location && /^https?:\/\//i.test(item.address.location)) links.add(item.address.location)
          for (const match of item.description?.match(urlPattern) ?? []) links.add(match)
          return { item, links: Array.from(links) }
        })
        .filter(({ links }) => links.length > 0)

      if (itemsWithLinks.length === 0) {
        return {
          message: 'I searched your visible time items (titles, descriptions, and address fields) and did not find any links or Miro boards.',
          action: 'none',
          quotaConsumed: false,
        }
      }

      const lines = itemsWithLinks.map(({ item, links }) => `- ${item.title} (${item.date}): ${links.join(', ')}`)
      return {
        message: `Found links in ${itemsWithLinks.length} time item${itemsWithLinks.length === 1 ? '' : 's'}:\n\n${lines.join('\n')}`,
        action: 'none',
        quotaConsumed: false,
      }
    }

    if (isTimeItemDurationRequest(message) && accessibleTimeItems) {
      const durationResult = findTimeItemDurationByTitle(message, accessibleTimeItems)
      if (!durationResult) {
        return {
          message: 'I could not find a visible time item whose title matches that request. Try using the title exactly as it appears in Time Management.',
          action: 'none',
          quotaConsumed: false,
        }
      }

      const roundedMinutes = Math.round(durationResult.totalMinutes * 100) / 100
      const hours = Math.round((roundedMinutes / 60) * 100) / 100
      const occurrenceLabel = durationResult.occurrenceCount === 1 ? 'occurrence' : 'occurrences'
      return {
        message: `I found ${durationResult.occurrenceCount} ${occurrenceLabel} titled "${durationResult.title}" in the visible Time Management items, totaling ${hours} hours (${roundedMinutes} minutes).`,
        action: 'none',
        quotaConsumed: false,
      }
    }

    const currentState = {
      leftPanel: {
        isOpen: isLeftPanelOpen,
        expandedSections: Array.from(expandedSections),
        sections: {
          modes: ['activate mode', 'create mode', 'duplicate mode', 'open settings', 'import mode json', 'export mode json', 'rename mode', 'delete mode'],
          month: ['navigate month overview', 'jump week'],
          sources: ['toggle source visibility', 'update main label/color', 'sync connected calendars'],
          categories: ['create category', 'edit category', 'delete category', 'set category display style'],
          timeWidth: ['set slot width', 'create background period', 'update background period', 'delete background period'],
          editor: ['open editor', 'set draft fields'],
          quickObjects: ['toggle visibility', 'expand/collapse templates'],
        },
      },
      timeWidth: {
        current: slotMinutes,
        options: [15, 30, 60],
      },
      backgrounds: timeBackgrounds.map((period, index) => ({
        index,
        id: period.id,
        label: period.label,
        startUtc: formatTimeInput(period.startMinute),
        endUtc: formatTimeInput(period.endMinute),
        color: period.color,
        opacity: period.opacity,
      })),
      timezone: {
        primary: tzState.primary,
        additional: tzState.additional,
        all: tzState.all,
      },
      modes: {
        activeModeId,
        activeModeName: modes.find((mode) => mode.id === activeModeId)?.name || null,
        list: modes.map((mode) => ({ id: mode.id, name: mode.name })),
        canCreateMore: canCreateMoreModes,
      },
      sources: syncCalendars.map((source) => ({
        id: source.id,
        name: source.name,
        enabled: source.enabled,
        sourceType: source.sourceType,
        secondaryLabel: source.secondaryLabel || null,
      })),
      hiddenModeEnabled: isHiddenModeEnabled,
      categories: categories.map((cat) => ({
        id: cat.id,
        label: cat.label,
        color: cat.color,
      })),
      quickObjects: {
        showQuickTemplatesInMain,
        quickTemplatesMainExpanded,
        count: quickTemplates.length,
      },
      selectedItem: selectedItem
        ? {
            id: selectedItem.id,
            title: selectedItem.title,
            dayIndex: selectedItem.dayIndex,
          }
        : null,
      aiAccess: timeManagementAiAccess,
      accessibleTimeItems,
    }

    const { data } = await apiClient.post<TimeManagementAiResponse>('/api/ai-chat/time-management', {
      message,
      history,
      currentState,
      preferredModel,
      ...(retry ?? {}),
    })

    const actions = Array.isArray(data?.actions) ? data.actions : []
    const allowsPrimaryTimezoneChange = isExplicitPrimaryTimezoneChangeRequest(message)
    let convertedPrimaryTimezoneActions = 0
    const safeActions = actions.map((action) => {
      if (
        action.type === 'ensure_timezone' &&
        action.mode === 'primary' &&
        action.iana &&
        !allowsPrimaryTimezoneChange
      ) {
        const targetIana = resolveActionTimezone(action.iana)
        if (targetIana !== tzState.primary) {
          convertedPrimaryTimezoneActions += 1
          return { ...action, mode: 'add' as const }
        }
      }
      return action
    })

    const requestedTimezone = inferRequestedTimezoneForAiResponse(
      message,
      typeof data?.explanation === 'string' ? data.explanation : '',
      typeof data?.summary === 'string' ? data.summary : '',
    )
    const hasBackgroundMutation = safeActions.some(
      (action) => action.type === 'create_background_period' || action.type === 'update_background_period'
    )
    const hasExplicitTimezoneAction = requestedTimezone
      ? safeActions.some(
          (action) => action.type === 'ensure_timezone' && resolveActionTimezone(action.iana) === requestedTimezone
        )
      : false

    const finalActions = requestedTimezone && hasBackgroundMutation && !hasExplicitTimezoneAction
      ? [{ type: 'ensure_timezone', iana: requestedTimezone, mode: 'add' as const }, ...safeActions]
      : safeActions

    const applied: string[] = []
    const issues: string[] = []
    for (const action of finalActions) {
      await runTimeManagementAiAction(action, applied, issues)
    }
    if (finalActions.length === 0 && isMutationRequest(message)) {
      issues.push('The request asks for a change, but no actions were returned, so nothing was changed. Return the supported actions that perform it, or explain exactly why it is not possible and what the user can do instead.')
    }

    if (convertedPrimaryTimezoneActions > 0) {
      applied.push('Preserved your primary timezone and added the requested timezone instead')
    }

    const rawSummary = typeof data?.summary === 'string' && data.summary.trim().length > 0
      ? data.summary.trim()
      : 'Time Management updates completed.'
    const summary = applied.length === 0 && /updates? completed/i.test(rawSummary)
      ? 'No Time Management changes were made.'
      : rawSummary
    const details = typeof data?.explanation === 'string' ? data.explanation.trim() : ''
    const actionLog = applied.length > 0
      ? `\n\nApplied actions:\n- ${applied.join('\n- ')}`
      : ''
    const whereToFind = /where to find results:/i.test(`${summary}\n${details}`)
      ? ''
      : '\n\nWhere to find results: Left side panel -> Time Management Tools.'
    const action = applied.length > 0 ? 'configure_time_management' : 'none'

    return {
      message: removeDuplicateResponseSections(`${summary}${details ? `\n\n${details}` : ''}${actionLog}${whereToFind}`),
      action,
      remaining: data.remaining,
      limit: data.limit,
      systemPrompt: data.systemPrompt,
      evaluation: buildAiEvaluation(issues, applied),
      retryToken: data.retryToken,
    }
  }, [
    activeModeId,
    canCreateMoreModes,
    categories,
    events,
    expandedSections,
    isHiddenModeEnabled,
    isLeftPanelOpen,
    modes,
    quickTemplates.length,
    quickTemplatesMainExpanded,
    runTimeManagementAiAction,
    selectedItem,
    showQuickTemplatesInMain,
    slotMinutes,
    syncCalendars,
    timeBackgrounds,
    resolveActionTimezone,
    visibleItems,
    tzState.additional,
    tzState.all,
    tzState.primary,
    user,
  ])

  const handleTimeManagementAiSubmitRef = useRef(handleTimeManagementAiSubmit)
  useEffect(() => {
    handleTimeManagementAiSubmitRef.current = handleTimeManagementAiSubmit
  }, [handleTimeManagementAiSubmit])

  const stableTimeManagementAiSubmit = useCallback(
    (message: string, history?: Array<{ role: 'user' | 'assistant'; content: string }>, retry?: AiRetryRequest) =>
      handleTimeManagementAiSubmitRef.current(message, history, retry),
    []
  )

  const saveBeforeAiConfigNavigation = useCallback(async () => {
    if (selectedEvent && !isSelectedReadOnly && (isSelectedItemDirty || autoSaveError)) {
      return handleUpdateItem()
    }
    if (!selectedEvent && selectionDraft && draft.title.trim()) {
      return handleSaveSelection()
    }
    return true
  }, [autoSaveError, draft.title, handleSaveSelection, handleUpdateItem, isSelectedItemDirty, isSelectedReadOnly, selectedEvent, selectionDraft])

  const saveBeforeAiConfigNavigationRef = useRef(saveBeforeAiConfigNavigation)
  useEffect(() => {
    saveBeforeAiConfigNavigationRef.current = saveBeforeAiConfigNavigation
  }, [saveBeforeAiConfigNavigation])

  const stableSaveBeforeAiConfigNavigation = useCallback(
    () => saveBeforeAiConfigNavigationRef.current(),
    []
  )

  useEffect(() => {
    setPageContext({
      pageName: 'Time Management Assistant',
      suggestions: [
        'Create a background period Sleepz from 01:00 to 08:00 Estonian time and keep UTC primary',
        'Set slot width to 15 minutes and open Time Width and background',
        'Create category Deep Work with blue background',
        'Open Modes settings and export mode JSON',
      ],
      placeholder: 'e.g. "Create Sleepz background 01:00-08:00 Estonian time, keep UTC primary"',
      onSubmit: stableTimeManagementAiSubmit,
      beforeNavigate: stableSaveBeforeAiConfigNavigation,
    })
    return () => setPageContext(null)
  }, [setPageContext, stableSaveBeforeAiConfigNavigation, stableTimeManagementAiSubmit])

  const hasVisibleItems = visibleItems.length > 0
  const isLoading = isSourcesLoading || isEventsLoading
  const selectedSourceCount = useMemo(
    () => syncCalendars.filter((source) => source.enabled).length,
    [syncCalendars]
  )
  const completedSourceCount = useMemo(
    () => syncCalendars.filter((source) => source.enabled && sourceLoadStates[source.id] === 'synced').length,
    [sourceLoadStates, syncCalendars]
  )
  const loadingSourceCount = useMemo(
    () => syncCalendars.filter((source) => source.enabled && sourceLoadStates[source.id] === 'loading').length,
    [sourceLoadStates, syncCalendars]
  )
  const isAllSelectedSourcesSynced = selectedSourceCount > 0 && completedSourceCount === selectedSourceCount

  useEffect(() => {
    if (aggregateSourceStatusFadeTimerRef.current !== null) {
      window.clearTimeout(aggregateSourceStatusFadeTimerRef.current)
      aggregateSourceStatusFadeTimerRef.current = null
    }

    if (selectedSourceCount === 0) {
      setIsAggregateSourceStatusVisible(false)
      return
    }

    setIsAggregateSourceStatusVisible(true)
    if (isAllSelectedSourcesSynced) {
      aggregateSourceStatusFadeTimerRef.current = window.setTimeout(() => {
        setIsAggregateSourceStatusVisible(false)
        aggregateSourceStatusFadeTimerRef.current = null
      }, 2200)
    }
  }, [isAllSelectedSourcesSynced, selectedSourceCount])

  const getSourceStatus = useCallback((source: SyncCalendar): SourceLoadState => {
    if (!source.enabled) return 'disabled'
    return sourceLoadStates[source.id] || 'loading'
  }, [sourceLoadStates])

  const getSourceRowClassName = useCallback((source: SyncCalendar): string => {
    const status = getSourceStatus(source)
    if (status === 'loading') {
      return 'border-primary-muted bg-primary-subtle hover:bg-primary-muted'
    }
    if (status === 'error') {
      return 'border-danger-muted bg-danger-subtle hover:bg-danger-muted'
    }
    if (status === 'disabled') {
      return 'border-border bg-muted/35 hover:bg-muted/55'
    }
    return 'border-success-muted bg-success-subtle hover:bg-success-muted'
  }, [getSourceStatus])

  const renderSourceStatusBadge = useCallback((source: SyncCalendar) => {
    const status = getSourceStatus(source)
    if (status === 'loading') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-primary-muted bg-primary-subtle px-1.5 py-0.5 text-[10px] font-semibold text-primary">
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
          Loading
        </span>
      )
    }
    if (status === 'error') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-danger-muted bg-danger-subtle px-1.5 py-0.5 text-[10px] font-semibold text-danger">
          <AlertTriangle className="h-2.5 w-2.5" />
          Error
        </span>
      )
    }
    if (status === 'disabled') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/70 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
          <Clock3 className="h-2.5 w-2.5" />
          Disabled
        </span>
      )
    }
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-success-muted bg-success-subtle px-1.5 py-0.5 text-[10px] font-semibold text-success"
        style={{ animation: 'source-sync-complete 700ms ease-out 1' }}
      >
        <CheckCircle2 className="h-2.5 w-2.5" />
        Synced
      </span>
    )
  }, [getSourceStatus])

  const handleRefreshCurrentWeek = useCallback(async () => {
    const weekStart = currentWeekStartRef.current
    await hydrateWeekWindow(weekStart, { background: false, forceRefresh: true })
  }, [hydrateWeekWindow])

  const renderCalendarHeaderRow = (position: 'top' | 'bottom') => (
    <div
      data-testid={`calendar-header-${position}`}
      className={`grid bg-card/95 backdrop-blur-xs ${dayScrollHintTintClass} ${position === 'top' ? 'relative border-b border-border' : 'sticky bottom-0 z-20 border-t border-border shadow-[0_-1px_0_hsl(var(--border))]'}`}
      style={{ gridTemplateColumns: weekGridTemplateColumns }}
    >
      {position === 'top' && isMultiWeekView && (
        <>
          <div
            aria-hidden="true"
            data-testid="calendar-day-scroll-hint-left"
            className="pointer-events-none absolute inset-y-0 z-26 hidden translate-x-(--tm-day-scroll-left) group-data-[day-scroll-hint=on]/day-scroll:group-data-[can-scroll-left=true]/day-scroll:flex"
            style={{ left: `${timezoneColumnsWidth}px` }}
          >
            <span className="flex items-center border-r border-primary-muted bg-card bg-linear-to-b from-primary-subtle to-primary-subtle px-1 text-primary animate-in fade-in slide-in-from-left-2 duration-300 motion-reduce:animate-none">
              <ChevronsLeft className="h-4 w-4" />
            </span>
          </div>
          <div
            aria-hidden="true"
            data-testid="calendar-day-scroll-hint-right"
            className="pointer-events-none absolute inset-y-0 right-0 z-26 hidden -translate-x-(--tm-day-scroll-right) group-data-[day-scroll-hint=on]/day-scroll:group-data-[can-scroll-right=true]/day-scroll:flex"
          >
            <span className="flex items-center border-l border-primary-muted bg-card bg-linear-to-b from-primary-subtle to-primary-subtle px-1 text-primary animate-in fade-in slide-in-from-right-2 duration-300 motion-reduce:animate-none">
              <ChevronsRight className="h-4 w-4" />
            </span>
          </div>
        </>
      )}
      {timezoneGridColumns.map(({ iana: tz, abbreviation }, tzIdx) => {
        const isPrimary = tzIdx === 0
        const isUtc = tz === 'UTC'
        const entry = isUtc ? null : findTimezone(tz)
        const city = isUtc ? 'UTC' : (entry?.city ?? tz.split('/').pop()?.replace(/_/g, ' ') ?? tz)
        const abbr = isUtc ? '' : abbreviation
        const ct = isUtc
          ? `${nowTick.getUTCHours().toString().padStart(2, '0')}:${nowTick.getUTCMinutes().toString().padStart(2, '0')}`
          : getCurrentTimeInTimezone(tz)
        return (
          <div
            key={`${position}-${tz}`}
            className={`flex flex-col items-center justify-between border-r border-border px-0.5 py-1.5 ${pinnedTimezoneColumnClass} ${dayScrollHintTintClass} ${
              isPrimary ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            <span className="text-[9px] font-bold leading-none">{city}</span>
            {abbr && <span className="text-[9px] opacity-60 leading-none">{abbr}</span>}
            <span className="font-mono tabular-nums text-[10px] font-semibold leading-none">
              {ct.split(':')[0]}<span style={{ animation: 'blink-colon 1s step-start infinite' }}>:</span>{ct.split(':')[1]}
            </span>
          </div>
        )
      })}
      {weekDays.map((day, dayIndex) => {
        if (!visibleDayIndexSet.has(dayIndex)) return null
        const isHighlightedDay = highlightedDay ? isSameDay(day, highlightedDay) : false
        return (
          <Fragment key={`${position}-${day.toISOString()}`}>
            {dstGridColumns.filter((column) => column.transitionDayIndex === dayIndex).map((column) => (
              <div
                key={column.iana}
                data-testid={`calendar-dst-header-${position}-${column.iana}`}
                title={column.description}
                aria-label={column.description}
                className="flex min-w-0 flex-col items-center justify-center border-x border-warning-muted bg-warning-subtle px-0.5 py-1.5 text-center text-warning"
              >
                <span className="w-full truncate text-[9px] font-semibold">{column.city}</span>
                <span className="text-[9px] font-bold">GMT</span>
                <span className="text-[9px] font-bold">{column.offsetLabel}</span>
              </div>
            ))}
          <div
            data-calendar-day-header={dayIndex}
            className={`relative border-r border-border px-2 py-2 text-center text-xs font-semibold text-foreground last:border-r-0 transition-shadow ${
              isHighlightedDay ? 'bg-primary-subtle ring-2 ring-inset ring-primary' : ''
            }`}
          >
            <div>{format(day, 'EEE')}</div>
            <div className="text-[11px] text-muted-foreground">{format(day, 'd MMM')}</div>
          </div>
          </Fragment>
        )
      })}
    </div>
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-background px-2 pb-6 pt-3 md:px-4 md:pt-4">
      <LeftPanelPortal>
        {isPhoneLayout && isToolsSurfaceVisible && (
          <button
            type="button"
            aria-label="Close mobile side panel"
            className={`fixed inset-0 ${OVERLAY_SCRIM.drawer}`}
            style={{ zIndex: phoneToolsDrawerZ }}
            onClick={closeLeftPanel}
          />
        )}
        <aside
          ref={leftPanelAsideRef}
          data-testid="time-management-left-panel"
          data-open={isLeftPanelOpen}
          className={`${isPhoneLayout ? 'fixed inset-0 h-dvh w-screen border-0 shadow-2xl' : 'sticky top-0 h-screen shrink-0 border-r border-border'} overflow-hidden bg-card transition-[width,transform,opacity] duration-300 ease-out ${
            isLeftPanelResizing ? 'duration-75' : ''
          }`}
          style={{
            width: isPhoneLayout ? (isToolsSurfaceVisible ? '100vw' : 0) : (isLeftPanelOpen ? `${leftPanelWidthPx}px` : 0),
            zIndex: isPhoneLayout ? phoneToolsDrawerZ : undefined,
          }}
        >
          <div
            className={`flex h-full min-h-0 min-w-0 flex-col overflow-hidden transition-all duration-300 ease-out ${
              isToolsSurfaceVisible ? 'translate-x-0 opacity-100' : (isPhoneLayout ? 'translate-x-full opacity-0' : '-translate-x-3 opacity-0')
            }`}
            style={{ width: isPhoneLayout ? '100vw' : `${leftPanelWidthPx}px` }}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
              <h2 className="min-w-0 truncate text-sm font-semibold text-foreground">{showMobileQuickObjectsOverlay ? 'Quick Objects' : 'Time Management Tools'}</h2>
              <IconButton
                label="Close side panel"
                emphasis="outline"
                icon={<PanelLeftClose />}
                onClick={closeLeftPanel}
              />
            </div>

            <div
              ref={leftPanelScrollRef}
              data-testid="time-management-tools-scroll"
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 after:block after:h-[33vh] after:content-['']"
            >
              <div className="space-y-4">
                <section ref={sectionModesRef} className="rounded-lg border border-border bg-background/50 p-3">
                  <Disclosure
                    title="Calendar Modes"
                    icon={<Calendar />}
                    expanded={expandedSections.has('modes')}
                    onToggle={() => toggleSection('modes')}
                    panelId="time-management-section-modes"
                  />

                  {expandedSections.has('modes') && (
                    <div id="time-management-section-modes">
                      <p className="mb-2 mt-2 text-xs text-muted-foreground">
                        Select a mode, then use Add or Import to create another. Main is the default active mode.
                      </p>

                      <Switch
                        variant="card"
                        cardTone="warning"
                        checked={isHiddenModeEnabled}
                        onCheckedChange={setIsHiddenModeEnabled}
                        label="Toggle hidden mode"
                        aria-describedby="hidden-mode-description"
                        className="mb-2"
                      >
                        <span className="block text-xs font-semibold text-foreground">Hidden mode</span>
                        <span id="hidden-mode-description" className="block text-[11px] text-muted-foreground">
                          Hide calendar item names and blur editor text.
                        </span>
                      </Switch>

                      <div className="flex flex-wrap gap-2">
                        {(modes.length > 0 ? modes : [{ id: MAIN_SOURCE_ID, name: 'Main' } as Pick<TimeManagementMode, 'id' | 'name'>]).map((mode) => {
                          const isActive = mode.id === activeModeId || (!activeModeId && mode.id === MAIN_SOURCE_ID)
                          return (
                            <ToggleButton
                              key={mode.id}
                              size="compact"
                              pressed={isActive}
                              onPressedChange={() => {
                                if (modes.length > 0) {
                                  void handleActivateMode(mode.id)
                                }
                              }}
                              disabled={isModesLoading}
                              className={isActive && highlightedModeId === mode.id
                                ? 'animate-[pulse_0.9s_ease-in-out_2] ring-2 ring-ring motion-reduce:animate-none'
                                : undefined}
                            >
                              {mode.name}
                            </ToggleButton>
                          )
                        })}
                      </div>

                      {canCreateMoreModes && (
                        <div className="mt-2 flex gap-2">
                          <Button
                            emphasis="outline"
                            size="compact"
                            onClick={() => { void handleCreateMode() }}
                            disabled={isCreatingMode}
                            className="flex-1"
                          >
                            {isCreatingMode ? 'Creating...' : 'Add Mode'}
                          </Button>
                          <Button
                            emphasis="outline"
                            size="compact"
                            onClick={() => { void handleImportMode() }}
                            disabled={isCreatingMode || isImportingModeJson}
                            className="flex-1"
                          >
                            {isImportingModeJson ? 'Importing...' : 'Import JSON'}
                          </Button>
                        </div>
                      )}

                      <div className="mt-3 rounded-md border border-border bg-background/70 p-2.5">
                        <Disclosure
                          size="compact"
                          title="Settings"
                          expanded={isModeSettingsOpen}
                          onToggle={() => {
                            setIsModeSettingsOpen((prev) => !prev)
                            const currentMode = modes.find((mode) => mode.id === activeModeId)
                            setModeNameDraft(currentMode?.name || 'Main')
                            setModeDeleteState({ open: false, action: null, transferToModeId: null })
                          }}
                          panelId="time-management-mode-settings"
                        />

                        {isModeSettingsOpen && (
                          <div id="time-management-mode-settings" className="mt-3 space-y-3">
                            <div className="rounded-md border border-border bg-background/70 p-2.5" data-testid="close-left-panel-on-save-settings">
                              <div className="flex items-center justify-between gap-2">
                                <div>
                                  <p className="text-xs font-semibold text-foreground">Close Left Panel on Save</p>
                                  <p className="text-[11px] text-muted-foreground">Close the left side panel after a Time Item is saved.</p>
                                </div>
                                <Switch
                                  checked={closeLeftPanelOnSaveEnabled}
                                  onCheckedChange={setCloseLeftPanelOnSaveEnabled}
                                  label="Toggle close left panel on save"
                                  data-testid="close-left-panel-on-save-toggle"
                                />
                              </div>

                              <div className={`mt-2.5 flex flex-wrap gap-1.5 ${closeLeftPanelOnSaveEnabled ? '' : 'pointer-events-none opacity-50'}`}>
                                {([
                                  { key: 'calendarGrid', label: 'Calendar Grid' },
                                  { key: 'leftSidebar', label: 'Left Sidebar' },
                                  { key: 'fullView', label: 'Full View' },
                                ] as const).map(({ key, label }) => {
                                  const isActive = closeLeftPanelOnSaveSurfaces[key]
                                  return (
                                    <ToggleButton
                                      key={key}
                                      size="compact"
                                      disabled={!closeLeftPanelOnSaveEnabled}
                                      pressed={isActive}
                                      onPressedChange={() => {
                                        setCloseLeftPanelOnSaveSurfaces((prev) => ({ ...prev, [key]: !prev[key] }))
                                      }}
                                      data-testid={`close-left-panel-on-save-surface-${key}`}
                                    >
                                      {label}
                                    </ToggleButton>
                                  )
                                })}
                              </div>
                            </div>

                            <div className="rounded-md border border-border bg-background/70 p-2.5" data-testid="open-left-panel-on-selection-settings">
                              <div className="flex items-center justify-between gap-2">
                                <p id="open-left-panel-on-selection-label" className="min-w-0 text-xs font-semibold text-foreground">Open Left Panel on Time Selection</p>
                                <Switch
                                  checked={openLeftPanelOnSelectionMode !== 'never'}
                                  onCheckedChange={(checked) => setOpenLeftPanelOnSelectionMode(checked ? 'always' : 'never')}
                                  label="Toggle open left panel on time selection"
                                  data-testid="open-left-panel-on-selection-toggle"
                                />
                              </div>
                              {openLeftPanelOnSelectionMode !== 'never' && (
                                showTimeSelectionPanelButtons ? (
                                  <div className="mt-2.5 flex gap-1.5" role="group" aria-labelledby="open-left-panel-on-selection-label">
                                    {TIME_SELECTION_PANEL_OPTIONS.map(({ key, label }) => (
                                      <ToggleButton
                                        key={key}
                                        size="compact"
                                        pressed={openLeftPanelOnSelectionMode === key}
                                        onPressedChange={() => setOpenLeftPanelOnSelectionMode(key)}
                                        className="whitespace-nowrap"
                                        data-testid={`open-left-panel-on-selection-mode-${key}`}
                                      >
                                        {label}
                                      </ToggleButton>
                                    ))}
                                  </div>
                                ) : (
                                  <select
                                    aria-labelledby="open-left-panel-on-selection-label"
                                    value={openLeftPanelOnSelectionMode}
                                    onChange={(event) => {
                                      if (isOpenLeftPanelOnSelectionMode(event.target.value)) setOpenLeftPanelOnSelectionMode(event.target.value)
                                    }}
                                    className="mt-2.5 w-full min-w-0 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold text-foreground"
                                    data-testid="open-left-panel-on-selection-mode"
                                  >
                                    {TIME_SELECTION_PANEL_OPTIONS.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
                                  </select>
                                )
                              )}
                              {openLeftPanelOnSelectionMode === 'minDuration' && (
                              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                                <label
                                  htmlFor="open-left-panel-min-selection-minutes"
                                  className="text-[11px] font-medium text-muted-foreground"
                                >
                                  Only when longer than
                                </label>
                                <select
                                  id="open-left-panel-min-selection-minutes"
                                  value={openLeftPanelMinSelectionMinutes}
                                  onChange={(event) => {
                                    setOpenLeftPanelMinSelectionMinutes(
                                      normaliseOpenLeftPanelMinSelectionMinutes(event.target.value)
                                    )
                                  }}
                                  className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold text-foreground"
                                  data-testid="open-left-panel-min-selection-minutes"
                                >
                                  {OPEN_LEFT_PANEL_MIN_SELECTION_MINUTE_OPTIONS.map((minutes) => (
                                    <option key={minutes} value={minutes}>
                                      {minutes} min
                                    </option>
                                  ))}
                                </select>
                              </div>
                              )}
                            </div>

                            <div className="rounded-md border border-border bg-background/70 p-2.5" data-testid="open-left-panel-on-item-selection-settings">
                              <div className="flex items-center justify-between gap-2">
                                <p id="open-left-panel-on-item-selection-label" className="min-w-0 text-xs font-semibold text-foreground">
                                  Open Left Panel on Time Item Selection
                                </p>
                                <Switch
                                  checked={openLeftPanelOnItemSelectionMode !== 'never'}
                                  onCheckedChange={(checked) => setOpenLeftPanelOnItemSelectionMode(checked ? 'always' : 'never')}
                                  label="Toggle open left panel on time item selection"
                                  data-testid="open-left-panel-on-item-selection-toggle"
                                />
                              </div>
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                Also applies when pasting a copied Time Item.
                              </p>
                              {openLeftPanelOnItemSelectionMode !== 'never' && (
                                showItemSelectionPanelButtons ? (
                                  <div className="mt-2.5 flex gap-1.5" role="group" aria-labelledby="open-left-panel-on-item-selection-label">
                                    {ITEM_SELECTION_PANEL_OPTIONS.map(({ key, label, buttonLabel }) => (
                                      <ToggleButton
                                        key={key}
                                        size="compact"
                                        title={label}
                                        pressed={openLeftPanelOnItemSelectionMode === key}
                                        onPressedChange={() => setOpenLeftPanelOnItemSelectionMode(key)}
                                        className="whitespace-nowrap"
                                        data-testid={`open-left-panel-on-item-selection-mode-${key}`}
                                      >
                                        {buttonLabel}
                                      </ToggleButton>
                                    ))}
                                  </div>
                                ) : (
                              <select
                                id="open-left-panel-on-item-selection-mode"
                                aria-labelledby="open-left-panel-on-item-selection-label"
                                value={openLeftPanelOnItemSelectionMode}
                                onChange={(event) => {
                                  if (isOpenLeftPanelOnItemSelectionMode(event.target.value)) {
                                    setOpenLeftPanelOnItemSelectionMode(event.target.value)
                                  }
                                }}
                                className="mt-2.5 w-full min-w-0 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold text-foreground"
                                data-testid="open-left-panel-on-item-selection-mode"
                              >
                                {ITEM_SELECTION_PANEL_OPTIONS.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
                              </select>
                                )
                              )}
                              {openLeftPanelOnItemSelectionMode === 'minDuration' && (
                              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                                <label htmlFor="open-left-panel-min-item-selection-minutes" className="text-[11px] font-medium text-muted-foreground">
                                  Only when longer than
                                </label>
                                <select
                                  id="open-left-panel-min-item-selection-minutes"
                                  value={openLeftPanelMinItemSelectionMinutes}
                                  onChange={(event) => setOpenLeftPanelMinItemSelectionMinutes(normaliseOpenLeftPanelMinSelectionMinutes(event.target.value))}
                                  className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold text-foreground"
                                  data-testid="open-left-panel-min-item-selection-minutes"
                                >
                                  {OPEN_LEFT_PANEL_MIN_SELECTION_MINUTE_OPTIONS.map((minutes) => (
                                    <option key={minutes} value={minutes}>{minutes} min</option>
                                  ))}
                                </select>
                              </div>
                              )}
                            </div>

                            <div>
                              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Mode name
                              </label>
                              <input
                                ref={modeNameInputRef}
                                type="text"
                                value={modeNameDraft}
                                onChange={(event) => setModeNameDraft(event.target.value)}
                                className={`w-full rounded-md border bg-background px-2 py-1.5 text-xs transition-all ${
                                  isModeNameInputHighlighted
                                    ? 'animate-[pulse_0.9s_ease-in-out_2] border-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.25)]'
                                    : 'border-border'
                                }`}
                              />
                              <div className="mt-2 grid grid-cols-3 gap-2">
                                <Button
                                  emphasis={canSaveModeName ? 'solid' : 'outline'}
                                  intent={canSaveModeName ? 'primary' : 'neutral'}
                                  size="compact"
                                  fullWidth
                                  onClick={handleSaveModeNameClick}
                                  disabled={isRenamingMode || !hasModeNameValue}
                                  aria-disabled={!canSaveModeName}
                                  className={!canSaveModeName && isModeNameSaveNoChangePulse
                                    ? 'animate-[pulse_0.35s_ease-in-out_1] motion-reduce:animate-none'
                                    : undefined}
                                >
                                  {isRenamingMode ? 'Saving...' : 'Save Name'}
                                </Button>
                                <Button
                                  emphasis="outline"
                                  size="compact"
                                  fullWidth
                                  onClick={() => { void handleExportCurrentModeJson() }}
                                >
                                  Show JSON
                                </Button>
                                <Button
                                  emphasis="outline"
                                  size="compact"
                                  fullWidth
                                  onClick={() => { void handleDuplicateMode() }}
                                  disabled={isDuplicatingMode || isCreatingMode || !canCreateMoreModes || !activeModeId}
                                  title={canCreateMoreModes ? 'Duplicate current mode' : `Maximum ${MAX_MODE_COUNT} modes reached`}
                                >
                                  {isDuplicatingMode ? 'Duplicating...' : 'Duplicate'}
                                </Button>
                              </div>
                              {modeNameSaveFeedback && (
                                <p className="mt-2 text-[11px] text-muted-foreground">
                                  {modeNameSaveFeedback}
                                </p>
                              )}
                            </div>

                            {modes.length > 1 && (
                              <div className="rounded-md border border-danger-muted bg-danger-subtle p-2.5">
                                <Disclosure
                                  size="compact"
                                  title={
                                    <span className="text-[11px] font-semibold uppercase tracking-wide text-danger">
                                      Delete mode
                                    </span>
                                  }
                                  expanded={modeDeleteState.open}
                                  onToggle={() => {
                                    setModeDeleteState((prev) => {
                                      if (prev.open) {
                                        return { open: false, action: null, transferToModeId: null }
                                      }
                                      return { open: true, action: null, transferToModeId: null }
                                    })
                                  }}
                                  panelId="time-management-delete-mode"
                                />

                                {modeDeleteState.open && (
                                  <div id="time-management-delete-mode" className="mt-2 space-y-2">
                                    <p className="text-xs text-muted-foreground">
                                      Move the calendar data to another mode or delete it completely.
                                    </p>

                                    {activeModeDeleteStats && (
                                      activeModeDeleteStats.hasAnyData ? (
                                        <div className="rounded-md border border-warning-muted bg-warning-subtle px-2.5 py-2 text-[11px] text-warning">
                                          <p className="mb-1 font-semibold uppercase tracking-wide">You will lose/move</p>
                                          <ul className="space-y-0.5">
                                            {activeModeDeleteStats.itemCount > 0 && (
                                              <li>{activeModeDeleteStats.itemCount} calendar item{activeModeDeleteStats.itemCount === 1 ? '' : 's'}</li>
                                            )}
                                            {activeModeDeleteStats.categoryCount > 0 && (
                                              <li>{activeModeDeleteStats.categoryCount} tag{activeModeDeleteStats.categoryCount === 1 ? '' : 's'}</li>
                                            )}
                                            {activeModeDeleteStats.quickTemplateCount > 0 && (
                                              <li>{activeModeDeleteStats.quickTemplateCount} quick template{activeModeDeleteStats.quickTemplateCount === 1 ? '' : 's'}</li>
                                            )}
                                            {activeModeDeleteStats.timeBackgroundCount > 0 && (
                                              <li>{activeModeDeleteStats.timeBackgroundCount} time background{activeModeDeleteStats.timeBackgroundCount === 1 ? '' : 's'}</li>
                                            )}
                                            {activeModeDeleteStats.externalSourceCount > 0 && (
                                              <li>{activeModeDeleteStats.externalSourceCount} connected calendar source{activeModeDeleteStats.externalSourceCount === 1 ? '' : 's'}</li>
                                            )}
                                          </ul>
                                        </div>
                                      ) : (
                                        <p className="rounded-md border border-success-muted bg-success-subtle px-2.5 py-1.5 text-[11px] font-medium text-success">
                                          No items, tags, or settings in this mode yet -- safe to delete.
                                        </p>
                                      )
                                    )}

                                    {modeDeleteState.action !== 'move' ? (
                                      <div className="flex flex-wrap gap-2 pt-1">
                                        <Button
                                          intent="danger"
                                          size="compact"
                                          onClick={() => setModeDeleteState((prev) => ({ ...prev, action: 'move', transferToModeId: null }))}
                                        >
                                          Delete + Move
                                        </Button>
                                        <Button
                                          emphasis="outline"
                                          intent="danger"
                                          size="compact"
                                          onClick={() => { void handleDeleteCurrentMode(null) }}
                                        >
                                          Delete All
                                        </Button>
                                        <Button
                                          emphasis="outline"
                                          size="compact"
                                          onClick={() => setModeDeleteState({ open: false, action: null, transferToModeId: null })}
                                        >
                                          Cancel
                                        </Button>
                                      </div>
                                    ) : (
                                      <>
                                        <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                          To
                                        </label>
                                        <div className="flex flex-wrap gap-2">
                                          {modes
                                            .filter((mode) => mode.id !== activeModeId)
                                            .map((mode) => {
                                              const isSelected = modeDeleteState.transferToModeId === mode.id
                                              return (
                                                <ToggleButton
                                                  key={mode.id}
                                                  size="compact"
                                                  pressed={isSelected}
                                                  onPressedChange={() => setModeDeleteState((prev) => ({ ...prev, transferToModeId: mode.id }))}
                                                >
                                                  {mode.name}
                                                </ToggleButton>
                                              )
                                            })}
                                        </div>
                                        <div className="flex flex-wrap gap-2 pt-1">
                                          <Button
                                            intent="danger"
                                            size="compact"
                                            onClick={() => { void handleDeleteCurrentMode(modeDeleteState.transferToModeId) }}
                                            disabled={!modeDeleteState.transferToModeId}
                                          >
                                            Confirm
                                          </Button>
                                          <Button
                                            emphasis="outline"
                                            size="compact"
                                            onClick={() => setModeDeleteState((prev) => ({ ...prev, action: null, transferToModeId: null }))}
                                          >
                                            Back
                                          </Button>
                                          <Button
                                            emphasis="outline"
                                            size="compact"
                                            onClick={() => setModeDeleteState({ open: false, action: null, transferToModeId: null })}
                                          >
                                            Cancel
                                          </Button>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </section>

                <section ref={sectionMonthRef} className="rounded-lg border border-border bg-background/50 p-3">
                  <Disclosure
                    title="Month Overview"
                    icon={<CalendarDays />}
                    expanded={expandedSections.has('month')}
                    onToggle={() => toggleSection('month')}
                    panelId="time-management-section-month"
                  />

                  {expandedSections.has('month') && (
                    <div id="time-management-section-month">
                      <div className="mb-2 mt-2 flex items-center justify-end gap-0.5">
                        <IconButton
                          label="Previous month"
                          icon={<ChevronLeft />}
                          onClick={() => setMiniCalMonth((prev) => subMonths(prev, 1))}
                        />
                        <Button
                          emphasis="ghost"
                          size="compact"
                          onClick={() => setMiniCalMonth(startOfMonth(new Date()))}
                          title="Jump to today"
                        >
                          Today
                        </Button>
                        <IconButton
                          label="Next month"
                          icon={<ChevronRight />}
                          onClick={() => setMiniCalMonth((prev) => addMonths(prev, 1))}
                        />
                      </div>

                      <div className="rounded-md border border-border/80 bg-card p-2">
                        <div className="mb-1.5 flex items-center justify-between gap-1.5 text-xs font-semibold text-muted-foreground">
                          <span>{format(miniCalMonth, 'MMMM yyyy')}</span>
                          <Button
                            emphasis="outline"
                            size="compact"
                            onClick={() => setMiniCalMonth((prev) => addYears(prev, 1))}
                            title="Next year"
                          >
                            +1Y
                          </Button>
                        </div>
                        <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted-foreground">
                          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, idx) => (
                            <span key={idx}>{label}</span>
                          ))}
                        </div>
                        <div className="mt-1 grid grid-cols-7 gap-1 text-center text-[10px]">
                          {extendedMonthGridDays(miniCalMonth).map((day) => {
                            const isCurrentMonth = day.getMonth() === miniCalMonth.getMonth()
                            const inCurrentWeek = weekDays.some((wkDay) => isSameDay(day, wkDay))
                            return (
                              <button
                                key={day.toISOString()}
                                onClick={() => setCurrentWeekStart(startOfWeek(day, { weekStartsOn: 1 }))}
                                className={`rounded px-0.5 py-1 transition-colors ${
                                  inCurrentWeek
                                    ? 'bg-primary text-primary-foreground'
                                    : isCurrentMonth
                                    ? 'text-foreground hover:bg-muted'
                                    : 'text-muted-foreground/40 hover:bg-muted/50'
                                }`}
                              >
                                {format(day, 'd')}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </section>

                <section ref={sectionSourcesRef} className="rounded-lg border border-border bg-background/50 p-3">
                  <Disclosure
                    title="Calendar Sources"
                    icon={<Unplug />}
                    expanded={expandedSections.has('sources')}
                    onToggle={() => toggleSection('sources')}
                    panelId="time-management-section-sources"
                  />

                  {!expandedSections.has('sources') && showActiveSourcesWhenCollapsed && (
                    <div className="mt-2 space-y-1.5">
                      {syncCalendars.filter((source) => source.enabled).length === 0 ? (
                        <p className="text-[10px] text-muted-foreground">
                          No sources selected - showing meetings from every calendar. Expand to choose specific sources.
                        </p>
                      ) : (
                        syncCalendars
                          .filter((source) => source.enabled)
                          .map((source) => (
                            <label
                              key={source.id}
                              className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1 transition-colors ${getSourceRowClassName(source)}`}
                            >
                              <input
                                type="checkbox"
                                checked={source.enabled}
                                onChange={(event) => {
                                  const checked = event.target.checked
                                  setSyncCalendars((prev) =>
                                    prev.map((candidate) =>
                                      candidate.id === source.id ? { ...candidate, enabled: checked } : candidate
                                    )
                                  )
                                }}
                                className="h-3.5 w-3.5 rounded border-border"
                              />
                              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: source.color }} />
                              <span className="truncate text-xs font-medium text-foreground">{source.name}</span>
                              <span className="ml-auto">{renderSourceStatusBadge(source)}</span>
                            </label>
                          ))
                      )}
                    </div>
                  )}

                  {expandedSections.has('sources') && (
                    <div id="time-management-section-sources">
                      <p className="mb-2 mt-2 text-xs text-muted-foreground">
                        App and connected calendars from Settings are listed here. Toggle each to show or hide.
                      </p>

                      <div className="mb-3 flex items-start gap-2 rounded-md border border-info-muted bg-info-subtle px-2.5 py-2 text-[11px] text-info">
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>If no sources below are checked, meetings from every calendar are shown. Check one or more sources to limit the view to just those calendars.</span>
                      </div>

                      <div className="mb-3 flex items-center justify-between gap-2 rounded-md border border-border bg-background/70 px-2.5 py-2">
                        <div>
                          <p className="text-xs font-semibold text-foreground">Show active sources when collapsed</p>
                          <p className="text-[11px] text-muted-foreground">
                            Keep a compact list of only the checked sources visible even while this section is collapsed. Unchecking a source there hides it immediately; expand this section again to re-enable it.
                          </p>
                        </div>
                        <Switch
                          checked={showActiveSourcesWhenCollapsed}
                          onCheckedChange={setShowActiveSourcesWhenCollapsed}
                          label="Toggle showing active sources when collapsed"
                        />
                      </div>

                      <div className="space-y-2">
                        {syncCalendars
                          .filter((source) => source.sourceType === 'app')
                          .map((source) => {
                            const isMain = source.id === MAIN_SOURCE_ID
                            return (
                              <div key={source.id} className="space-y-1.5">
                                <label
                                  className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 transition-colors ${getSourceRowClassName(source)}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={source.enabled}
                                    onChange={(event) => {
                                      const checked = event.target.checked
                                      setSyncCalendars((prev) =>
                                        prev.map((candidate) =>
                                          candidate.id === source.id ? { ...candidate, enabled: checked } : candidate
                                        )
                                      )
                                    }}
                                    className="h-3.5 w-3.5 rounded border-border"
                                  />
                                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: source.color }} />
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-xs font-medium text-foreground">{source.name}</span>
                                    {!isMain && (
                                      <span className="block truncate text-[10px] text-muted-foreground">{source.secondaryLabel || 'Read-only mirror'}</span>
                                    )}
                                  </span>
                                  {renderSourceStatusBadge(source)}
                                  {isMain && (
                                    <IconButton
                                      label="Edit Main calendar color and label"
                                      icon={<Palette />}
                                      onClick={(event) => {
                                        event.preventDefault()
                                        event.stopPropagation()
                                        setIsMainColorOpen((prev) => !prev)
                                      }}
                                      className="ml-auto"
                                    />
                                  )}
                                </label>

                                {isMain && isMainColorOpen && (
                                  <div className="rounded-md border border-border bg-background p-2.5">
                                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                      Label
                                    </label>
                                    <input
                                      type="text"
                                      value={prefs.main_label}
                                      onChange={(event) => {
                                        const next = event.target.value
                                        setPrefs((prev) => ({ ...prev, main_label: next }))
                                      }}
                                      onBlur={(event) => { void handleMainLabelCommit(event.target.value) }}
                                      placeholder="Coordination Manager Main"
                                      className="mb-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                                    />
                                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                      Color
                                    </label>
                                    <ColorGridPicker
                                      value={prefs.main_color}
                                      onChange={(next) => { void handleMainColorChange(next) }}
                                    />
                                  </div>
                                )}
                              </div>
                            )
                          })}
                      </div>

                      <div className="mt-3 border-t border-border pt-3">
                        <div className="mb-1.5 flex items-center gap-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Connected Calendars
                          </p>
                          {isExternalSyncing && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Syncing
                            </span>
                          )}
                          <Button
                            emphasis="outline"
                            size="compact"
                            icon={<RefreshCw className="h-3.5 w-3.5" />}
                            loading={isExternalSyncing}
                            onClick={handleRefreshCurrentWeek}
                            disabled={enabledExternalSources.length === 0}
                            className="ml-auto"
                            title={enabledExternalSources.length === 0 ? 'Enable at least one connected calendar to sync the current week.' : 'Sync the selected connected calendars for the current week'}
                          >
                            Sync
                          </Button>
                        </div>

                        {externalSyncStatus && (
                          <p className="mb-2 text-[10px] text-muted-foreground">{externalSyncStatus}</p>
                        )}

                        {syncCalendars.some((source) => source.sourceType === 'external') ? (
                          <div className="space-y-2">
                            {syncCalendars
                              .filter((source) => source.sourceType === 'external')
                              .map((source) => (
                                <label
                                  key={source.id}
                                  className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 transition-colors ${getSourceRowClassName(source)}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={source.enabled}
                                    onChange={(event) => {
                                      const checked = event.target.checked
                                      setSyncCalendars((prev) =>
                                        prev.map((candidate) =>
                                          candidate.id === source.id ? { ...candidate, enabled: checked } : candidate
                                        )
                                      )
                                    }}
                                    className="h-3.5 w-3.5 rounded border-border"
                                  />
                                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: source.color }} />
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-xs font-medium text-foreground">{source.name}</span>
                                    {source.secondaryLabel && (
                                      <span className="block truncate text-[10px] text-muted-foreground">{source.secondaryLabel}</span>
                                    )}
                                  </span>
                                  {renderSourceStatusBadge(source)}
                                </label>
                              ))}
                          </div>
                        ) : (
                          <div className="rounded-md border border-dashed border-border px-2.5 py-2 text-xs text-muted-foreground">
                            No connected calendars yet. Connecting Google Calendar requires adding or creating a Google Account. For public calendars, any full account is sufficient (Cardano Wallet or Google Account).
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </section>

                <section ref={sectionCategoriesRef} className="rounded-lg border border-border bg-background/50 p-3">
                  <Disclosure
                    title="Categories"
                    icon={<Palette />}
                    expanded={expandedSections.has('categories')}
                    onToggle={() => toggleSection('categories')}
                    panelId="time-management-section-categories"
                  />

                  {expandedSections.has('categories') && (
                    <div id="time-management-section-categories">
                      <p className="mb-2 mt-2 text-xs text-muted-foreground">
                        Custom category tags for your time items. Use each tag color for the card background or the card font.
                      </p>

                      <div className="mb-3">
                        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Color Display Style
                        </label>
                        <SegmentedControl<CategoryColorDisplayStyle>
                          label="Color display style"
                          size="compact"
                          className="flex-wrap"
                          value={prefs.category_color_display_style}
                          onChange={(nextStyle) => { void handleCategoryColorDisplayStyleChange(nextStyle) }}
                          options={[
                            { value: 'horizontal', label: 'Horizontal' },
                            { value: 'vertical_left', label: 'Vertical Left' },
                            { value: 'vertical_right', label: 'Vertical Right' },
                          ]}
                        />
                      </div>

                      <div className="space-y-1.5">
                        {categories.length === 0 && !categoryDraft && (
                          <div className="rounded-md border border-dashed border-border px-2.5 py-2 text-xs text-muted-foreground">
                            No categories yet. Create one below.
                          </div>
                        )}

                        {categories.map((cat) => {
                          const isEditing = editingCategoryId === cat.id
                          if (isEditing && categoryDraft) {
                            return (
                              <div key={cat.id} className="rounded-md border border-border bg-background p-2.5">
                                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  Label
                                </label>
                                <input
                                  type="text"
                                  value={categoryDraft.label}
                                  onChange={(event) =>
                                    setCategoryDraft((prev) => (prev ? { ...prev, label: event.target.value } : prev))
                                  }
                                  placeholder="Category name"
                                  className="mb-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                                  autoFocus
                                />
                                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  Category color target
                                </label>
                                <SegmentedControl<CategoryColorTarget>
                                  label="Category color target"
                                  size="compact"
                                  className="mb-2"
                                  value={categoryColorTarget}
                                  onChange={setCategoryColorTarget}
                                  options={[
                                    { value: 'background', label: 'Background Color' },
                                    { value: 'font', label: 'Font Color' },
                                  ]}
                                />
                                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  {categoryColorTarget === 'background' ? 'Background Color' : 'Font Color'}
                                </label>
                                <ColorGridPicker
                                  value={categoryColorTarget === 'background' ? categoryDraft.color : categoryDraft.fontColor}
                                  onChange={(next) =>
                                    setCategoryDraft((prev) => {
                                      if (!prev) return prev
                                      return categoryColorTarget === 'background'
                                        ? { ...prev, color: next }
                                        : { ...prev, fontColor: next }
                                    })
                                  }
                                />
                                <label className="mb-1 mt-2 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  Background opacity ({Math.round(normaliseCategoryBackgroundOpacity(categoryDraft.backgroundOpacity) * 100)}%)
                                </label>
                                <input
                                  type="range"
                                  min={0}
                                  max={1}
                                  step={0.05}
                                  value={normaliseCategoryBackgroundOpacity(categoryDraft.backgroundOpacity)}
                                  onChange={(event) => {
                                    const nextOpacity = normaliseCategoryBackgroundOpacity(Number(event.target.value))
                                    setCategoryDraft((prev) => (prev ? { ...prev, backgroundOpacity: nextOpacity } : prev))
                                  }}
                                  className="w-full"
                                />
                                <label className="mb-1 mt-2 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  Item opacity ({Math.round(normaliseCategoryItemOpacity(categoryDraft.itemOpacity) * 100)}%)
                                </label>
                                <input
                                  type="range"
                                  min={0}
                                  max={1}
                                  step={0.05}
                                  value={normaliseCategoryItemOpacity(categoryDraft.itemOpacity)}
                                  onChange={(event) => {
                                    const nextOpacity = normaliseCategoryItemOpacity(Number(event.target.value))
                                    setCategoryDraft((prev) => (prev ? { ...prev, itemOpacity: nextOpacity } : prev))
                                  }}
                                  className="w-full"
                                />
                                <div className="mt-2 flex gap-2">
                                  <Button
                                    intent="primary"
                                    size="compact"
                                    onClick={() => { void handleSaveCategory() }}
                                    disabled={!categoryDraft.label.trim()}
                                    className="flex-1"
                                  >
                                    Save
                                  </Button>
                                  <Button emphasis="outline" size="compact" onClick={cancelCategoryEdit}>
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            )
                          }
                          return (
                            <div
                              key={cat.id}
                              className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5"
                            >
                              <span
                                className="h-3 w-3 flex-none rounded-full"
                                style={{ backgroundColor: hexToRgba(cat.color, normaliseCategoryBackgroundOpacity(cat.background_opacity)) }}
                              />
                              <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{cat.label}</span>
                              <IconButton
                                label={`Edit ${cat.label}`}
                                icon={<Pencil />}
                                onClick={() => startEditCategory(cat)}
                                title="Edit category"
                              />
                              <IconButton
                                label={`Delete ${cat.label}`}
                                intent="danger"
                                icon={<Trash2 />}
                                onClick={() => setCategoryDeleteTarget(cat)}
                                title="Delete category"
                              />
                            </div>
                          )
                        })}

                        {!editingCategoryId && categoryDraft && (
                          <div className="rounded-md border border-border bg-background p-2.5">
                            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Label
                            </label>
                            <input
                              type="text"
                              value={categoryDraft.label}
                              onChange={(event) =>
                                setCategoryDraft((prev) => (prev ? { ...prev, label: event.target.value } : prev))
                              }
                              placeholder="Category name"
                              className="mb-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                              autoFocus
                            />
                            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Category color target
                            </label>
                            <SegmentedControl<CategoryColorTarget>
                              label="Category color target"
                              size="compact"
                              className="mb-2"
                              value={categoryColorTarget}
                              onChange={setCategoryColorTarget}
                              options={[
                                { value: 'background', label: 'Background Color' },
                                { value: 'font', label: 'Font Color' },
                              ]}
                            />
                            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              {categoryColorTarget === 'background' ? 'Background Color' : 'Font Color'}
                            </label>
                            <ColorGridPicker
                              value={categoryColorTarget === 'background' ? categoryDraft.color : categoryDraft.fontColor}
                              onChange={(next) =>
                                setCategoryDraft((prev) => {
                                  if (!prev) return prev
                                  return categoryColorTarget === 'background'
                                    ? { ...prev, color: next }
                                    : { ...prev, fontColor: next }
                                })
                              }
                            />
                            <label className="mb-1 mt-2 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Background opacity ({Math.round(normaliseCategoryBackgroundOpacity(categoryDraft.backgroundOpacity) * 100)}%)
                            </label>
                            <input
                              type="range"
                              min={0}
                              max={1}
                              step={0.05}
                              value={normaliseCategoryBackgroundOpacity(categoryDraft.backgroundOpacity)}
                              onChange={(event) => {
                                const nextOpacity = normaliseCategoryBackgroundOpacity(Number(event.target.value))
                                setCategoryDraft((prev) => (prev ? { ...prev, backgroundOpacity: nextOpacity } : prev))
                              }}
                              className="w-full"
                            />
                            <label className="mb-1 mt-2 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Item opacity ({Math.round(normaliseCategoryItemOpacity(categoryDraft.itemOpacity) * 100)}%)
                            </label>
                            <input
                              type="range"
                              min={0}
                              max={1}
                              step={0.05}
                              value={normaliseCategoryItemOpacity(categoryDraft.itemOpacity)}
                              onChange={(event) => {
                                const nextOpacity = normaliseCategoryItemOpacity(Number(event.target.value))
                                setCategoryDraft((prev) => (prev ? { ...prev, itemOpacity: nextOpacity } : prev))
                              }}
                              className="w-full"
                            />
                            <div className="mt-2 flex gap-2">
                              <Button
                                intent="primary"
                                size="compact"
                                onClick={() => { void handleSaveCategory() }}
                                disabled={!categoryDraft.label.trim()}
                                className="flex-1"
                              >
                                Create
                              </Button>
                              <Button emphasis="outline" size="compact" onClick={cancelCategoryEdit}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        )}

                        {!categoryDraft && (
                          <Button
                            emphasis="outline"
                            size="compact"
                            fullWidth
                            icon={<Plus className="h-3.5 w-3.5" />}
                            onClick={startCreateCategory}
                            className="border-dashed"
                          >
                            Add Category
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </section>

                <section ref={sectionTimeWidthRef} className="rounded-lg border border-border bg-background/50 p-3">
                  <Disclosure
                    title="Time Width and background"
                    icon={<Calendar />}
                    expanded={expandedSections.has('timeWidth')}
                    onToggle={() => toggleSection('timeWidth')}
                    panelId="time-management-section-time-width"
                  />
                  {expandedSections.has('timeWidth') && (
                    <div id="time-management-section-time-width">
                      <p className="mb-2 mt-2 text-xs text-muted-foreground">
                        Set the slot width for this grid and add recurring background periods to visually mark parts of each day.
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        {[15, 30, 60].map((minutes) => {
                          const isActive = slotMinutes === minutes
                          const label = minutes === 60 ? '1h' : `${minutes}m`
                          return (
                            <ToggleButton
                              key={minutes}
                              size="compact"
                              pressed={isActive}
                              onPressedChange={() => setSlotMinutes(minutes as TimeWidth)}
                            >
                              {label}
                            </ToggleButton>
                          )
                        })}
                      </div>

                      <p className="mb-2 mt-3 text-xs text-muted-foreground">
                        Days shown in the grid. Fewer days keep today visible; 2 and 4 weeks scroll sideways.
                      </p>
                      <div className="grid grid-cols-4 gap-2" role="group" aria-label="Visible days">
                        {DAY_ZOOM_LEVELS.map((level) => (
                          <ToggleButton
                            key={level}
                            size="compact"
                            pressed={dayZoomLevel === level}
                            onPressedChange={() => changeDayZoomLevel(level)}
                          >
                            {formatDayZoomLabel(level)}
                          </ToggleButton>
                        ))}
                      </div>

                      <div className="mt-3 space-y-2">
                        <Switch
                          variant="card"
                          checked={showTimeZoomQuickButtons}
                          onCheckedChange={handleShowTimeZoomQuickButtonsChange}
                          label="Toggle time zoom quick buttons in the calendar bar"
                          aria-describedby="time-zoom-quick-buttons-description"
                        >
                          <span className="block text-xs font-semibold text-foreground">Time zoom quick buttons</span>
                          <span id="time-zoom-quick-buttons-description" className="block text-[11px] text-muted-foreground">
                            Show zoom in/out buttons in the calendar bar that step the time interval between 15m, 30m and 1h.
                          </span>
                        </Switch>
                        <Switch
                          variant="card"
                          checked={showDayZoomQuickButtons}
                          onCheckedChange={handleShowDayZoomQuickButtonsChange}
                          label="Toggle day zoom quick buttons in the calendar bar"
                          aria-describedby="day-zoom-quick-buttons-description"
                        >
                          <span className="block text-xs font-semibold text-foreground">Day zoom quick buttons</span>
                          <span id="day-zoom-quick-buttons-description" className="block text-[11px] text-muted-foreground">
                            Show zoom in/out buttons in the calendar bar that step between 1, 2, 3, 5 days, 1 week, 2 weeks and 4 weeks.
                          </span>
                        </Switch>
                      </div>

                      <div className="mt-3 rounded-md border border-border/80 bg-muted/30 p-2.5">
                        <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                          <Palette className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>Recurring background periods</span>
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Use color bands for patterns like typical meeting hours, focus blocks, or sleep windows. End times earlier than start times wrap overnight.
                        </p>

                        <Button
                          emphasis="outline"
                          size="compact"
                          fullWidth
                          icon={<Plus className="h-3.5 w-3.5" />}
                          onClick={handleAddTimeBackground}
                          className="mt-3"
                        >
                          Create new Background period
                        </Button>

                        <div className="mt-3 space-y-3">
                          {timeBackgrounds.length === 0 ? (
                            <div className="rounded-md border border-dashed border-border px-2.5 py-2 text-xs text-muted-foreground">
                              No background periods yet.
                            </div>
                          ) : (
                            timeBackgrounds.map((period, index) => {
                              const isCollapsed = collapsedBackgroundIds.has(period.id)
                              return (
                                <div key={period.id} className="rounded-md border border-border bg-background p-2.5">
                                  <div className="flex items-center gap-2">
                                    <IconButton
                                      label={isCollapsed ? `Expand background period ${index + 1}` : `Collapse background period ${index + 1}`}
                                      icon={isCollapsed ? <ChevronDown /> : <ChevronUp />}
                                      onClick={() => toggleTimeBackgroundCard(period.id)}
                                      title={isCollapsed ? 'Expand background period' : 'Collapse background period'}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => toggleTimeBackgroundCard(period.id)}
                                      className="min-w-0 flex-1 rounded px-1 py-0.5 text-left hover:bg-muted/60"
                                      aria-label={isCollapsed ? `Expand background period ${index + 1}` : `Collapse background period ${index + 1}`}
                                      title={isCollapsed ? 'Expand background period' : 'Collapse background period'}
                                    >
                                      <div className="truncate text-xs font-semibold text-foreground">
                                        {period.label.trim() || `Period ${index + 1}`}
                                      </div>
                                      <div className="text-[10px] text-muted-foreground">
                                        {formatTimeInput(period.startMinute)}-{formatTimeInput(period.endMinute)} UTC
                                      </div>
                                    </button>
                                    <div className="relative" data-delete-popover-root="true">
                                      <IconButton
                                        label={`Delete background period ${index + 1}`}
                                        intent="danger"
                                        icon={<Trash2 />}
                                        onClick={() => setDeletingBackgroundId((current) => (current === period.id ? null : period.id))}
                                        title="Delete background period"
                                      />
                                      {deletingBackgroundId === period.id && (
                                        <div data-dismiss-popup="true" className={`absolute right-0 top-full ${OVERLAY_LAYER_CLASS.popover} mt-2 w-52 max-w-[calc(100vw-1rem)] rounded-md border border-danger-muted bg-background p-2 shadow-lg`}>
                                          <p className="mb-2 text-xs text-foreground">Delete this item?</p>
                                          <div className="flex items-center justify-end gap-2">
                                            <Button emphasis="outline" size="compact" onClick={() => setDeletingBackgroundId(null)}>
                                              Cancel
                                            </Button>
                                            <Button intent="danger" size="compact" onClick={() => handleDeleteTimeBackground(period.id)}>
                                              Confirm
                                            </Button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  {!isCollapsed && (
                                    <>
                                  <input
                                    type="text"
                                    value={period.label}
                                    onChange={(event) => updateTimeBackground(period.id, { label: event.target.value })}
                                    placeholder={`Period ${index + 1} label`}
                                    className="mt-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                                  />

                                  <div className="mt-2 grid grid-cols-2 gap-2">
                                    <TimeGridPicker
                                      label="Start"
                                      valueMinute={period.startMinute}
                                      onChangeMinute={(minute) => updateTimeBackground(period.id, { startMinute: minute })}
                                    />
                                    <TimeGridPicker
                                      label="End"
                                      align="right"
                                      valueMinute={period.endMinute}
                                      onChangeMinute={(minute) => updateTimeBackground(period.id, { endMinute: minute })}
                                    />
                                  </div>

                                  <label className="mt-2 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Opacity
                                    <div className="mt-1 flex items-center gap-2">
                                      <input
                                        type="range"
                                        min={0}
                                        max={100}
                                        step={1}
                                        value={Math.round(period.opacity * 100)}
                                        onChange={(event) => updateTimeBackground(period.id, { opacity: clampOpacity(Number(event.target.value) / 100) })}
                                        className="flex-1"
                                      />
                                      <span className="w-11 text-right text-[11px] text-foreground">{Math.round(period.opacity * 100)}%</span>
                                    </div>
                                  </label>

                                  <div className="mt-2">
                                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Color</div>
                                    <ColorGridPicker
                                      value={period.color}
                                      onChange={(nextColor) => updateTimeBackground(period.id, { color: nextColor })}
                                    />
                                  </div>
                                    </>
                                  )}
                                </div>
                              )
                            })
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </section>

                <section
                  ref={(node) => {
                    editorSectionRef.current = node
                    sectionEditorRef.current = node
                  }}
                  className="rounded-lg border border-border bg-background p-3"
                >
                  <div className="flex items-center gap-2">
                    <Disclosure
                      className="min-w-0 flex-1"
                      title={selectedItem ? 'Edit Time Item' : 'Create Time Item'}
                      icon={<Plus />}
                      expanded={expandedSections.has('editor')}
                      onToggle={() => toggleSection('editor')}
                      panelId="time-management-section-editor"
                    />
                    <Button
                      emphasis="outline"
                      size="compact"
                      icon={<Maximize2 className="h-3.5 w-3.5" />}
                      onClick={openFullEditor}
                      title="Open full view editor"
                    >
                      Full view
                    </Button>
                  </div>

                  {expandedSections.has('editor') && (
                    <div id="time-management-section-editor">
                      {selectionDraft && !selectedItem && (
                        <div className="mb-2 mt-2 rounded-md border border-border bg-muted/40 p-2 text-xs text-foreground">
                          {movingItemId ? 'Move selection:' : 'Selection:'} {format(weekDays[selectionDraft.dayIndex], 'EEE d MMM')} {selectionStartLabel}-
                          {selectionEndLabel}

                          <div className="mt-2">
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() => {
                                  setIsSelectionAdjusterExpanded((prev) => !prev)
                                }}
                                onKeyDown={(event) => {
                                  if (event.key !== 'Enter' && event.key !== ' ') return
                                  event.preventDefault()
                                  setIsSelectionAdjusterExpanded((prev) => !prev)
                                }}
                                className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                              >
                                <span>Adjust selection time</span>
                                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isSelectionAdjusterOpen ? 'rotate-180' : ''}`} />
                              </div>

                              {isSelectionAdjusterOpen && (
                                <div className="mt-1.5 space-y-1.5 text-[11px]">
                                  <div className="rounded-md border border-border bg-background px-2 py-1">
                                    <span className="mb-1 block font-medium">Step interval</span>
                                    <div className="grid grid-cols-3 gap-1">
                                      {[1, 2, 4].map((stepMultiplier) => {
                                        const isActive = selectionAdjustStepSlots === stepMultiplier
                                        return (
                                          <ToggleButton
                                            key={stepMultiplier}
                                            size="compact"
                                            pressed={isActive}
                                            onPressedChange={() => setSelectionAdjustStepSlots(stepMultiplier)}
                                          >
                                            {slotMinutes * stepMultiplier}m
                                          </ToggleButton>
                                        )
                                      })}
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-2 gap-1.5">
                                    <Button
                                      emphasis="outline"
                                      size="compact"
                                      onClick={() => nudgeSelectionDraftEdge('start', -1)}
                                      title={`Move start ${slotMinutes * Math.max(1, selectionAdjustStepSlots)} minutes earlier`}
                                    >
                                      Start -{slotMinutes * Math.max(1, selectionAdjustStepSlots)}m
                                    </Button>
                                    <Button
                                      emphasis="outline"
                                      size="compact"
                                      onClick={() => nudgeSelectionDraftEdge('start', 1)}
                                      title={`Move start ${slotMinutes * Math.max(1, selectionAdjustStepSlots)} minutes later`}
                                    >
                                      Start +{slotMinutes * Math.max(1, selectionAdjustStepSlots)}m
                                    </Button>
                                    <Button
                                      emphasis="outline"
                                      size="compact"
                                      onClick={() => nudgeSelectionDraftEdge('end', -1)}
                                      title={`Move end ${slotMinutes * Math.max(1, selectionAdjustStepSlots)} minutes earlier`}
                                    >
                                      End -{slotMinutes * Math.max(1, selectionAdjustStepSlots)}m
                                    </Button>
                                    <Button
                                      emphasis="outline"
                                      size="compact"
                                      onClick={() => nudgeSelectionDraftEdge('end', 1)}
                                      title={`Move end ${slotMinutes * Math.max(1, selectionAdjustStepSlots)} minutes later`}
                                    >
                                      End +{slotMinutes * Math.max(1, selectionAdjustStepSlots)}m
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                        </div>
                      )}

                      {selectedItem && (
                        <div className="mb-2 mt-2 rounded-md border border-border bg-muted/40 p-2 text-xs text-foreground">
                          <span className={itemLastChangedEdge === 'start' ? 'animate-[selection-time-pulse_0.75s_ease-out]' : ''}>{selectedItemStartLabel}</span>
                          {' - '}
                          <span className={itemLastChangedEdge === 'end' ? 'animate-[selection-time-pulse_0.75s_ease-out]' : ''}>{selectedItemEndLabel}</span>
                          {' on '}
                          {selectedItemDateLabel}

                          {!isSelectedReadOnly && (
                            <div className="mt-2">
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() => {
                                  setIsItemAdjusterExpanded((prev) => !prev)
                                }}
                                onKeyDown={(event) => {
                                  if (event.key !== 'Enter' && event.key !== ' ') return
                                  event.preventDefault()
                                  setIsItemAdjusterExpanded((prev) => !prev)
                                }}
                                className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                              >
                                <span>Adjust Time</span>
                                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isItemAdjusterOpen ? 'rotate-180' : ''}`} />
                              </div>

                              {isItemAdjusterOpen && (
                                <div className="mt-1.5 space-y-1.5 text-[11px]">
                                  <div className="rounded-md border border-border bg-background px-2 py-1">
                                    <span className="mb-1 block font-medium">Step interval</span>
                                    <div className="grid grid-cols-3 gap-1">
                                      {[1, 2, 4].map((stepMultiplier) => {
                                        const isActive = itemAdjustStepSlots === stepMultiplier
                                        return (
                                          <ToggleButton
                                            key={stepMultiplier}
                                            size="compact"
                                            pressed={isActive}
                                            onPressedChange={() => setItemAdjustStepSlots(stepMultiplier)}
                                          >
                                            {slotMinutes * stepMultiplier}m
                                          </ToggleButton>
                                        )
                                      })}
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-2 gap-1.5">
                                    <Button
                                      emphasis="outline"
                                      size="compact"
                                      disabled={isNudgingItem}
                                      onClick={() => { void nudgeSelectedItemEdge('start', -1) }}
                                      title={`Move start ${slotMinutes * Math.max(1, itemAdjustStepSlots)} minutes earlier`}
                                    >
                                      Start -{slotMinutes * Math.max(1, itemAdjustStepSlots)}m
                                    </Button>
                                    <Button
                                      emphasis="outline"
                                      size="compact"
                                      disabled={isNudgingItem}
                                      onClick={() => { void nudgeSelectedItemEdge('start', 1) }}
                                      title={`Move start ${slotMinutes * Math.max(1, itemAdjustStepSlots)} minutes later`}
                                    >
                                      Start +{slotMinutes * Math.max(1, itemAdjustStepSlots)}m
                                    </Button>
                                    <Button
                                      emphasis="outline"
                                      size="compact"
                                      disabled={isNudgingItem}
                                      onClick={() => { void nudgeSelectedItemEdge('end', -1) }}
                                      title={`Move end ${slotMinutes * Math.max(1, itemAdjustStepSlots)} minutes earlier`}
                                    >
                                      End -{slotMinutes * Math.max(1, itemAdjustStepSlots)}m
                                    </Button>
                                    <Button
                                      emphasis="outline"
                                      size="compact"
                                      disabled={isNudgingItem}
                                      onClick={() => { void nudgeSelectedItemEdge('end', 1) }}
                                      title={`Move end ${slotMinutes * Math.max(1, itemAdjustStepSlots)} minutes later`}
                                    >
                                      End +{slotMinutes * Math.max(1, itemAdjustStepSlots)}m
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {!selectionDraft && !selectedItem && (
                        <div className="mb-2 mt-2 rounded-md border border-info-muted bg-info-subtle px-2 py-1.5 text-xs font-semibold text-info">
                          Select Time
                        </div>
                      )}

                      <div className={`space-y-2 ${isRecurrenceDirty ? 'rounded-md border border-warning-muted bg-warning-subtle p-1.5' : ''}`}>
                        <RecurrenceEditor
                          value={draft.recurrenceRule}
                          onChange={(nextRule) => setDraft((prev) => ({ ...prev, recurrenceRule: nextRule }))}
                          expanded={showItemRecurrencePanel}
                          onExpandedChange={setShowItemRecurrencePanel}
                          dateSeed={recurrenceEditorDateSeed}
                          readOnly={isSelectedRecurrenceReadOnly}
                          conditionalSeries={Boolean(selectedEvent?.recurrence_id)}
                          headerAction={recurrenceStatusPanel}
                          compact
                        />
                      </div>

                      <div className="space-y-2">
                        {clipboardStatus && (
                          <div className="rounded-md border border-success-muted bg-success-subtle px-2.5 py-1.5 text-xs text-success">
                            {clipboardStatus}
                          </div>
                        )}

                        {isSelectedReadOnly && (
                          <div className="flex items-start gap-2 rounded-md border border-warning-muted bg-warning-subtle px-2.5 py-1.5 text-[11px] text-warning">
                            <Lock className="mt-0.5 h-3.5 w-3.5 flex-none" />
                            <span>
                              Read-only mirror of {selectedSource?.name || 'calendar source'}. Switch mode to edit directly, or copy this item into your active mode.
                            </span>
                          </div>
                        )}

                        {isSelectedReadOnly ? (
                          <>
                            <div className={`rounded-md border border-border bg-muted/40 px-2.5 py-2 text-sm font-semibold text-foreground ${
                              isHiddenModeEnabled ? 'blur-xs' : ''
                            }`}>
                              {selectedItem?.title || 'Untitled'}
                            </div>
                            {isLocationFieldVisible && (draft.location || '').trim() && (
                              <div className={`rounded-md border border-border bg-muted/30 px-2.5 py-2 text-xs text-foreground ${
                                isHiddenModeEnabled ? 'blur-xs' : ''
                              }`}>
                                <span className="mb-1 block font-semibold text-muted-foreground">Location</span>
                                {draft.location}
                              </div>
                            )}
                            {selectedReadOnlyDisplayNotes && (
                              <div className={`rounded-md border border-border bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground ${
                                isHiddenModeEnabled ? 'blur-xs' : ''
                              }`}>
                                <NotePreview text={selectedReadOnlyDisplayNotes} />
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            <div className={`relative ${isTitleDirty ? 'rounded-md' : ''}`}>
                              <input
                                ref={selectionTitleInputRef}
                                type="text"
                                value={draft.title}
                                onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
                                onKeyDown={(event) => {
                                  if (event.key !== 'Enter') return
                                  if (!isSelectionTitleTypingMode) return
                                  if (!canSaveNewSelectionItem) return
                                  event.preventDefault()
                                  void handleSaveSelectionFromSurface('leftSidebar')
                                }}
                                placeholder="Type Title for Time Item"
                                className={`w-full rounded-md border bg-background px-2.5 py-2 pr-5 text-sm transition-colors ${
                                  isSelectionTitleTypingMode || isTitleTypingHintActive
                                    ? 'border-primary ring-4 ring-primary-muted'
                                    : isTitleDirty
                                      ? 'border-warning ring-2 ring-warning-muted'
                                    : isSelectionTitleRequired
                                      ? 'border-warning-muted bg-warning-subtle text-warning placeholder:text-warning/70'
                                      : 'border-border'
                                } ${isHiddenModeEnabled ? 'blur-xs' : ''}`}
                              />
                              {(isSelectionTitleTypingMode || isTitleTypingHintActive) && (
                                <div className="pointer-events-none absolute inset-y-0 left-0 flex max-w-[calc(100%-1.25rem)] items-center overflow-hidden px-2.5 text-sm" aria-hidden="true">
                                  <span className="whitespace-pre text-transparent">{draft.title || ' '}</span>
                                  <span
                                    className="h-4 w-0.5 rounded-full bg-primary"
                                    style={{ animation: 'selection-caret 0.9s step-start infinite' }}
                                  />
                                </div>
                              )}
                            </div>
                            {isLocationFieldVisible && (
                              <div>
                                <label className="mb-1 block text-xs font-semibold text-muted-foreground">Location</label>
                                <input
                                  type="text"
                                  value={draft.location || ''}
                                  onChange={(event) => setDraft((prev) => ({ ...prev, location: event.target.value }))}
                                  placeholder="Add a location or meeting link"
                                  className={`w-full rounded-md border border-border bg-background px-2.5 py-2 text-sm text-foreground ${isHiddenModeEnabled ? 'blur-xs' : ''}`}
                                />
                              </div>
                            )}
                            <div className={`${isHiddenModeEnabled ? 'blur-xs' : ''} ${isDescriptionHintActive ? 'rounded-md border border-success-muted bg-success-subtle p-1.5' : ''} ${isNotesDirty ? 'rounded-md border border-warning-muted bg-warning-subtle p-1.5' : ''}`}>
                              {isDescriptionHintActive && (
                                <p className="mb-1 text-[11px] font-semibold text-success">Description -- edit here if needed</p>
                              )}
                              <MarkdownComposer
                                value={draft.notes}
                                onChange={(nextNotes) => setDraft((prev) => ({ ...prev, notes: nextNotes }))}
                                placeholder="Notes or context"
                                className="min-h-48"
                                showToolbar={false}
                                compact
                              />
                            </div>
                          </>
                        )}

                        <div>
                          <label className="mb-1 block text-xs font-semibold text-muted-foreground">Calendar</label>
                          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-foreground">
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: selectedSource?.color || prefs.main_color }}
                            />
                            <span className="truncate font-medium">{selectedSource?.name || prefs.main_label}</span>
                            {selectedSource?.secondaryLabel && (
                              <span className="ml-auto truncate text-[10px] text-muted-foreground">{selectedSource.secondaryLabel}</span>
                            )}
                          </div>
                        </div>

                        <div className={isCategoryDirty ? 'rounded-md border border-warning-muted bg-warning-subtle p-1.5' : ''}>
                          <label className="mb-1 block text-xs font-semibold text-muted-foreground">Category Tags</label>
                          {categories.length === 0 ? (
                            <div className="rounded-md border border-dashed border-border px-2.5 py-2 text-[11px] text-muted-foreground">
                              No categories yet. Create one in the Categories section.
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {categories.map((cat) => {
                                const selected = draft.categoryIds.includes(cat.id)
                                const disabled = isSelectedReadOnly
                                return (
                                  <button
                                    key={cat.id}
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => {
                                      if (disabled) return
                                      setDraft((prev) => {
                                        const already = prev.categoryIds.includes(cat.id)
                                        if (already) {
                                          return { ...prev, categoryIds: prev.categoryIds.filter((id) => id !== cat.id) }
                                        }
                                        return { ...prev, categoryIds: [...prev.categoryIds, cat.id] }
                                      })
                                    }}
                                    className={`rounded-full border px-2 py-1 text-[11px] font-medium transition-colors ${
                                      selected ? 'text-white' : 'text-foreground hover:bg-muted'
                                    } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
                                    style={{
                                      backgroundColor: selected ? cat.color : undefined,
                                      borderColor: selected ? cat.color : undefined,
                                      color: selected ? cat.font_color : undefined,
                                    }}
                                  >
                                    {cat.label}
                                  </button>
                                )
                              })}
                            </div>
                          )}
                        </div>

                        <div className="space-y-2">
                          {selectedItem && !isSelectedReadOnly && (
                            <div
                              className={`rounded-md border px-2.5 py-1.5 text-xs ${
                                autoSaveError
                                  ? 'border-danger-muted bg-danger-subtle text-danger'
                                  : isAutoSaving
                                  ? 'border-primary-muted bg-primary-subtle text-primary'
                                  : isSelectedItemDirty
                                  ? 'border-warning-muted bg-warning-subtle text-warning'
                                  : 'border-success-muted bg-success-subtle text-success'
                              }`}
                            >
                              {autoSaveError ||
                                (isAutoSaving
                                  ? 'Saving changes...'
                                  : isSelectedItemDirty
                                  ? 'Unsaved changes pending...'
                                  : `All changes saved${lastSavedLabel ? ` at ${lastSavedLabel}` : ''}.`)}
                              {isSelectedItemDirty && (
                                <div className="mt-1 text-[11px] opacity-90">
                                  Changed: {[
                                    isTitleDirty ? 'Title' : null,
                                    isLocationDirty ? 'Location' : null,
                                    isNotesDirty ? 'Notes' : null,
                                    isCategoryDirty ? 'Categories' : null,
                                    isRecurrenceDirty ? 'Recurrence' : null,
                                  ].filter((value): value is string => Boolean(value)).join(', ')}
                                </div>
                              )}
                            </div>
                          )}

                          {!selectedItem && (
                            <div className="grid grid-cols-2 gap-2">
                              <div className="relative w-full" data-move-scope-root="true">
                                <Button
                                  intent="primary"
                                  fullWidth
                                  icon={<Save className="h-4 w-4" />}
                                  onClick={() => {
                                    if (movingItemId && movingItemIsRecurring) {
                                      if (!selectionDraft || !draft.title.trim() || isCreatingItem) return
                                      setIsMoveScopeOpen((prev) => !prev)
                                      return
                                    }
                                    void handleSaveSelectionFromSurface('leftSidebar')
                                  }}
                                  disabled={!selectionDraft || !draft.title.trim() || isCreatingItem}
                                  aria-expanded={movingItemId && movingItemIsRecurring ? isMoveScopeOpen : undefined}
                                  data-testid="left-sidebar-save-button"
                                >
                                  {selectionDraft ? 'Save Item' : 'Select Time'}
                                </Button>
                                {movingItemId && movingItemIsRecurring && isMoveScopeOpen && (
                                  <div data-dismiss-popup="true" className={`absolute left-1/2 top-full ${OVERLAY_LAYER_CLASS.popover} mt-2 w-60 max-w-[calc(100vw-1rem)] -translate-x-1/2 rounded-md border border-border bg-background p-2 shadow-lg`}>
                                    <p className="mb-2 text-xs font-medium text-foreground">
                                      This is a recurring item. What would you like to move?
                                    </p>
                                    <div className="flex flex-col gap-1.5">
                                      <Button
                                        emphasis="outline"
                                        size="compact"
                                        onClick={() => { void handleSaveSelectionFromSurface('leftSidebar', { scope: 'this' }) }}
                                      >
                                        This item only
                                      </Button>
                                      <Button
                                        intent="primary"
                                        size="compact"
                                        onClick={() => { void handleSaveSelectionFromSurface('leftSidebar', { scope: 'series' }) }}
                                      >
                                        This and future occurrences
                                      </Button>
                                      <Button
                                        emphasis="ghost"
                                        size="compact"
                                        onClick={() => setIsMoveScopeOpen(false)}
                                        className="mt-0.5"
                                      >
                                        Cancel
                                      </Button>
                                    </div>
                                  </div>
                                )}
                              </div>
                              <Button
                                emphasis="outline"
                                intent="danger"
                                fullWidth
                                icon={<X className="h-4 w-4" />}
                                onClick={() => handleDiscardSelectionDraft()}
                                disabled={isCreatingItem}
                              >
                                Discard
                              </Button>
                            </div>
                          )}

                          {selectedItem && !isSelectedReadOnly && (
                            <div className="grid grid-cols-3 gap-2">
                              <Button
                                intent="primary"
                                fullWidth
                                icon={<Save className="h-4 w-4" />}
                                onClick={() => { void handleUpdateItemFromSurface('leftSidebar') }}
                                disabled={!canSaveSelectedItem}
                                data-testid="left-sidebar-update-button"
                              >
                                Save
                              </Button>
                              <div className="relative w-full" data-delete-popover-root="true">
                                <Button
                                  emphasis="outline"
                                  intent="danger"
                                  fullWidth
                                  onClick={() => setIsDeleteConfirmOpen((prev) => !prev)}
                                  aria-expanded={isDeleteConfirmOpen}
                                  aria-label="Delete item"
                                >
                                  Delete
                                </Button>
                                {isDeleteConfirmOpen && (
                                  <div data-dismiss-popup="true" className={`absolute left-1/2 top-full ${OVERLAY_LAYER_CLASS.popover} mt-2 w-60 max-w-[calc(100vw-1rem)] -translate-x-1/2 rounded-md border border-danger-muted bg-background p-2 shadow-lg`}>
                                    {selectedEvent?.recurrence_rule && selectedEvent.recurrence_rule.type !== 'none' && selectedEvent.recurrence_rule.endType !== 'whenCompleted' ? (
                                      <>
                                        <p className="mb-2 text-xs font-medium text-foreground">
                                          This is a recurring item. What would you like to delete?
                                        </p>
                                        <div className="flex flex-col gap-1.5">
                                          <Button emphasis="outline" intent="danger" size="compact" onClick={() => { void handleDeleteThisOccurrence() }}>
                                            This item only
                                          </Button>
                                          <Button emphasis="outline" intent="danger" size="compact" onClick={() => { void handleDeleteThisAndFollowing() }}>
                                            This and all following items
                                          </Button>
                                          <Button intent="danger" size="compact" onClick={() => { void handleDeleteSelected() }}>
                                            All items in the series
                                          </Button>
                                          <Button emphasis="ghost" size="compact" onClick={() => setIsDeleteConfirmOpen(false)} className="mt-0.5">
                                            Cancel
                                          </Button>
                                        </div>
                                      </>
                                    ) : (
                                      <>
                                        <p className="mb-2 text-xs text-foreground">Delete this item?</p>
                                        <div className="flex items-center justify-end gap-2">
                                          <Button emphasis="outline" size="compact" onClick={() => setIsDeleteConfirmOpen(false)}>
                                            Cancel
                                          </Button>
                                          <Button intent="danger" size="compact" onClick={() => { void handleDeleteSelected() }}>
                                            Confirm
                                          </Button>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                              <Button
                                emphasis="outline"
                                fullWidth
                                icon={<Send className="h-4 w-4" />}
                                onClick={openExportDialog}
                                disabled={oauthCalendars.length === 0}
                                title={oauthCalendars.length === 0 ? 'Connect a Google Calendar in Settings to export.' : 'Export this item to a connected calendar'}
                              >
                                Export
                              </Button>
                              {selectedEvent?.source_type === 'manual' && (
                                <GoogleSyncStatus
                                  eventId={selectedEvent.series_id || selectedEvent.id}
                                  refreshKey={`${selectedEvent.updated_at || ''}:${googleSyncRefreshKey}`}
                                />
                              )}
                            </div>
                          )}

                          {selectedItem && isSelectedReadOnly && (
                            <div className="grid grid-cols-1 gap-2">
                              <Button
                                emphasis="outline"
                                fullWidth
                                icon={<Send className="h-4 w-4" />}
                                onClick={openExportDialog}
                                disabled={oauthCalendars.length === 0}
                                title={oauthCalendars.length === 0 ? 'Connect a Google Calendar in Settings to export.' : 'Export this item to a connected calendar'}
                              >
                                Export
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </section>

                <section ref={sectionQuickObjectsRef} className="rounded-lg border border-border bg-background/50 p-3">
                  <Disclosure
                    title="Quick Objects"
                    icon={<Tag />}
                    expanded={expandedSections.has('quickObjects')}
                    onToggle={() => toggleSection('quickObjects')}
                    panelId="time-management-section-quick-objects"
                  />

                  {expandedSections.has('quickObjects') && (
                    <div id="time-management-section-quick-objects">
                      <p className="mb-2 mt-2 text-xs text-muted-foreground">
                        Build reusable template cards from existing calendar items, then apply them into Create Time Item.
                      </p>

                      <div className="mb-2 rounded-md border border-info-muted bg-info-subtle px-2.5 py-1.5 text-xs font-semibold text-info">
                        {selectionDraft ? 'Apply Template' : isPhoneLayout ? 'Choose a Quick Object, then select its time on the calendar.' : 'Select Time'}
                      </div>

                      {isPhoneLayout && (
                        <div className="mb-3 flex max-h-60 flex-wrap gap-2 overflow-y-auto">
                          {quickTemplates.map((template) => (
                            <Button
                              key={template.id}
                              emphasis="outline"
                              size="compact"
                              onClick={() => { void applyQuickTemplate(template) }}
                              className="min-h-11 max-w-full"
                              title={template.quickName || template.title}
                            >
                              <span className="block min-w-0 truncate">{template.quickName || template.title || 'Quick Object'}</span>
                            </Button>
                          ))}
                        </div>
                      )}

                      <label className="mb-2 flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-2 text-xs text-foreground">
                        <input
                          type="checkbox"
                          checked={showQuickTemplatesInMain}
                          onChange={(event) => {
                            const checked = event.target.checked
                            showQuickTemplatesTouchedRef.current = true
                            setShowQuickTemplatesInMain(checked)
                            if (checked) {
                              setQuickTemplatesMainExpanded(true)
                            }
                          }}
                          className="h-3.5 w-3.5 rounded border-border"
                        />
                        <span>Show template cards above the calendar</span>
                      </label>

                      <div className="space-y-2">
                        <ToggleButton
                          size="compact"
                          intent="warning"
                          pressed={isTemplateSelectionMode}
                          onPressedChange={() => {
                            if (isTemplateSelectionMode) {
                              setIsTemplateSelectionMode(false)
                              setPendingTemplateSourceId(null)
                              setPendingTemplateQuickName('')
                              return
                            }
                            setIsTemplateSelectionMode(true)
                            setPendingTemplateSourceId(null)
                            setPendingTemplateQuickName('')
                          }}
                          className="w-full"
                        >
                          {isTemplateSelectionMode ? 'Cancel item selection mode' : 'Select calendar item to copy'}
                        </ToggleButton>

                        {isTemplateSelectionMode && (
                          <div className="rounded-md border border-warning-muted bg-warning-subtle px-2.5 py-2 text-xs text-warning">
                            Selection mode is active. Click an item in the calendar to capture it as a template.
                          </div>
                        )}

                        {pendingTemplateSourceItem && (
                          <div className="rounded-md border border-border bg-muted/40 p-2.5">
                            <p className="text-[11px] font-semibold text-foreground">Selected item</p>
                            <p className="mt-1 line-clamp-2 text-xs font-medium text-foreground">{pendingTemplateSourceItem.title || 'Untitled item'}</p>
                            <label className="mt-2 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Quick name
                              <input
                                type="text"
                                value={pendingTemplateQuickName}
                                onChange={(event) => setPendingTemplateQuickName(event.target.value)}
                                placeholder="Template card name"
                                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                              />
                            </label>
                            <Button
                              intent="primary"
                              size="compact"
                              fullWidth
                              onClick={saveSelectedItemAsTemplate}
                              className="mt-2"
                            >
                              Save selected item as template
                            </Button>
                          </div>
                        )}
                      </div>

                    </div>
                  )}
                </section>
              </div>
            </div>
          </div>
          {!isPhoneLayout && isLeftPanelOpen && (
            <button
              type="button"
              aria-label="Resize left panel"
              title="Drag to resize panel"
              onPointerDown={handleLeftPanelResizeStart}
              className="absolute inset-y-0 right-0 z-20 w-2 cursor-col-resize bg-transparent transition-colors hover:bg-border/70"
            />
          )}
        </aside>
      </LeftPanelPortal>

      <NoteEditorModal
        open={isFullEditorOpen}
        isPhoneLayout={isPhoneLayout}
        title={noteEditorTitle}
        subtitle={noteEditorSubtitle}
        titleValue={draft.title}
        onTitleChange={(nextTitle) => setDraft((prev) => ({ ...prev, title: nextTitle }))}
        titlePlaceholder="Type Title for Time Item"
        value={selectedItem && isSelectedReadOnly ? selectedReadOnlyDisplayNotes : draft.notes}
        onChange={(nextNotes) => setDraft((prev) => ({ ...prev, notes: nextNotes }))}
        onClose={() => {
          const shouldCancelMobileSelection = isPhoneLayout && Boolean(selectionDraft) && !selectedItem

          if (shouldCancelMobileSelection) {
            handleDiscardSelectionDraft()
          } else {
            setIsFullEditorOpen(false)
            setAutoFocusTitleOnEditorOpen(false)
            openMobileCalendarSurface()
          }
        }}
        autoFocusTitle={autoFocusTitleOnEditorOpen}
        onAutoFocusComplete={() => setAutoFocusTitleOnEditorOpen(false)}
        readOnly={Boolean(selectedItem && isSelectedReadOnly)}
        showSaveButton={shouldShowFullEditorSave}
        saveDisabled={isFullEditorSaveDisabled}
        onSave={selectedItem && !isSelectedReadOnly
          ? async () => {
              const saved = await handleUpdateItem()
              if (saved) closeLeftPanelAfterSave('fullView')
              return saved
            }
          : selectionDraft
            ? () => handleSaveSelectionFromSurface('fullView')
            : undefined}
        saveState={fullEditorSaveState}
        saveMetaLabel={fullEditorSaveMetaLabel}
        saveLabel={selectedItem ? 'Save now' : 'Save item'}
        closeLabel={isPhoneLayout && selectionDraft && !selectedItem ? 'Cancel' : 'Close'}
        toolbarExtra={
          !(selectedItem && isSelectedReadOnly) ? (
            <Button
              emphasis="outline"
              size="compact"
              icon={<MapPin className="h-3.5 w-3.5" />}
              onClick={toggleLocationFieldVisible}
              title={isLocationFieldVisible ? 'Hide the location field' : 'Add a location for this time item'}
            >
              {locationToggleLabel}
            </Button>
          ) : null
        }
        locationField={
          isLocationFieldVisible ? (
            <div className="mb-3 shrink-0">
              <label className="mb-1 block text-xs font-semibold text-muted-foreground">Location</label>
              {selectedItem && isSelectedReadOnly ? (
                <div className="rounded-md border border-border bg-muted/40 px-2.5 py-2 text-sm text-foreground">
                  {draft.location?.trim() || 'No location provided'}
                </div>
              ) : (
                <input
                  type="text"
                  value={draft.location || ''}
                  onChange={(event) => setDraft((prev) => ({ ...prev, location: event.target.value }))}
                  placeholder="Add a location or meeting link"
                  className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-sm text-foreground"
                />
              )}
            </div>
          ) : null
        }
        beforeTitleContent={
          (selectionDraft && !selectedItem) || (selectedItem && !isSelectedReadOnly) ? (
            <div className="mb-3 shrink-0 overflow-hidden rounded-lg border border-border bg-card text-xs">
              <div
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (selectionDraft && !selectedItem) {
                    setIsSelectionAdjusterExpanded((prev) => !prev)
                    return
                  }
                  setIsItemAdjusterExpanded((prev) => !prev)
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  if (selectionDraft && !selectedItem) {
                    setIsSelectionAdjusterExpanded((prev) => !prev)
                    return
                  }
                  setIsItemAdjusterExpanded((prev) => !prev)
                }}
                className="flex w-full cursor-pointer items-center justify-between gap-2 bg-muted/50 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 className="h-3.5 w-3.5 text-muted-foreground" />
                  {selectionDraft && !selectedItem ? 'Adjust selection time' : 'Adjust Time'}
                </span>
                <ChevronDown
                  className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isTimeAdjusterExpanded ? 'rotate-180' : ''}`}
                />
              </div>

              {isTimeAdjusterExpanded && (
                <div className="space-y-1.5 p-2.5 text-[11px]">
                  <div className="rounded-md border border-border bg-background px-2 py-1">
                    <span className="mb-1 block font-medium">Step interval</span>
                    <div className="grid grid-cols-3 gap-1">
                      {[1, 2, 4].map((stepMultiplier) => {
                        const isSelectionMode = Boolean(selectionDraft && !selectedItem)
                        const isActive = isSelectionMode
                          ? selectionAdjustStepSlots === stepMultiplier
                          : itemAdjustStepSlots === stepMultiplier
                        return (
                          <ToggleButton
                            key={stepMultiplier}
                            size="compact"
                            pressed={isActive}
                            onPressedChange={() => {
                              if (isSelectionMode) {
                                setSelectionAdjustStepSlots(stepMultiplier)
                                return
                              }
                              setItemAdjustStepSlots(stepMultiplier)
                            }}
                          >
                            {slotMinutes * stepMultiplier}m
                          </ToggleButton>
                        )
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <Button
                      emphasis="outline"
                      size="compact"
                      disabled={isNudgingItem}
                      onClick={() => {
                        if (selectionDraft && !selectedItem) {
                          nudgeSelectionDraftEdge('start', -1)
                          return
                        }
                        void nudgeSelectedItemEdge('start', -1)
                      }}
                      title={`Move start ${slotMinutes * Math.max(1, selectionDraft && !selectedItem ? selectionAdjustStepSlots : itemAdjustStepSlots)} minutes earlier`}
                    >
                      Start -{slotMinutes * Math.max(1, selectionDraft && !selectedItem ? selectionAdjustStepSlots : itemAdjustStepSlots)}m
                    </Button>
                    <Button
                      emphasis="outline"
                      size="compact"
                      disabled={isNudgingItem}
                      onClick={() => {
                        if (selectionDraft && !selectedItem) {
                          nudgeSelectionDraftEdge('start', 1)
                          return
                        }
                        void nudgeSelectedItemEdge('start', 1)
                      }}
                      title={`Move start ${slotMinutes * Math.max(1, selectionDraft && !selectedItem ? selectionAdjustStepSlots : itemAdjustStepSlots)} minutes later`}
                    >
                      Start +{slotMinutes * Math.max(1, selectionDraft && !selectedItem ? selectionAdjustStepSlots : itemAdjustStepSlots)}m
                    </Button>
                    <Button
                      emphasis="outline"
                      size="compact"
                      disabled={isNudgingItem}
                      onClick={() => {
                        if (selectionDraft && !selectedItem) {
                          nudgeSelectionDraftEdge('end', -1)
                          return
                        }
                        void nudgeSelectedItemEdge('end', -1)
                      }}
                      title={`Move end ${slotMinutes * Math.max(1, selectionDraft && !selectedItem ? selectionAdjustStepSlots : itemAdjustStepSlots)} minutes earlier`}
                    >
                      End -{slotMinutes * Math.max(1, selectionDraft && !selectedItem ? selectionAdjustStepSlots : itemAdjustStepSlots)}m
                    </Button>
                    <Button
                      emphasis="outline"
                      size="compact"
                      disabled={isNudgingItem}
                      onClick={() => {
                        if (selectionDraft && !selectedItem) {
                          nudgeSelectionDraftEdge('end', 1)
                          return
                        }
                        void nudgeSelectedItemEdge('end', 1)
                      }}
                      title={`Move end ${slotMinutes * Math.max(1, selectionDraft && !selectedItem ? selectionAdjustStepSlots : itemAdjustStepSlots)} minutes later`}
                    >
                      End +{slotMinutes * Math.max(1, selectionDraft && !selectedItem ? selectionAdjustStepSlots : itemAdjustStepSlots)}m
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : null
        }
      >
        <div className="mb-3">
          <RecurrenceEditor
            value={draft.recurrenceRule}
            onChange={(nextRule) => setDraft((prev) => ({ ...prev, recurrenceRule: nextRule }))}
            expanded={showItemRecurrencePanel}
            onExpandedChange={setShowItemRecurrencePanel}
            dateSeed={recurrenceEditorDateSeed}
            readOnly={isSelectedRecurrenceReadOnly}
            conditionalSeries={Boolean(selectedEvent?.recurrence_id)}
            headerAction={recurrenceStatusPanel}
          />
        </div>
      </NoteEditorModal>

      {showMainQuickTemplates && (
        <section
          className={`mb-2 rounded-lg border border-border bg-card px-3 ${isPhoneLayout ? 'py-2' : quickTemplatesMainExpanded ? 'py-3' : 'py-1.5'}`}
          onMouseEnter={() => setIsQuickTemplatesToggleHovering(true)}
          onMouseLeave={() => setIsQuickTemplatesToggleHovering(false)}
          onClick={(event) => {
            if (isPhoneLayout) {
              return
            }
            if (event.target === event.currentTarget) {
              setQuickTemplatesMainExpanded((prev) => !prev)
            }
          }}
        >
          {isPhoneLayout ? (
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Quick Objects
              </span>
              <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                {quickTemplates.slice(0, 2).map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => { void applyQuickTemplate(template) }}
                    title={template.quickName}
                    className="min-w-0 rounded-md border border-border px-2 py-1 text-[10px] font-semibold text-foreground hover:bg-muted"
                    style={{
                      ...buildCategoryCardStyle(
                        template.categoryIds,
                        categoryMap,
                        prefs.category_color_display_style,
                        'quick-template'
                      ),
                      color: buildCategoryTextColor(template.categoryIds, categoryMap),
                    }}
                  >
                    <span className="block max-w-22 truncate">{buildQuickTemplateShortcutLabel(template.quickName)}</span>
                  </button>
                ))}
                {quickTemplates.length > 2 && (
                  <Button
                    emphasis="outline"
                    size="compact"
                    onClick={() => setIsMobileQuickListExpanded((previous) => !previous)}
                    aria-expanded={isMobileQuickListExpanded}
                    aria-controls="mobile-quick-object-list"
                    aria-label={isMobileQuickListExpanded ? 'Collapse Quick Objects list' : 'Expand Quick Objects list'}
                    className="shrink-0"
                    title={isMobileQuickListExpanded ? 'Collapse Quick Objects list' : 'Expand Quick Objects list'}
                  >
                    {isMobileQuickListExpanded ? 'Less' : `+${quickTemplates.length - 2}`}
                  </Button>
                )}
              </div>
              <Button
                emphasis="outline"
                size="compact"
                onClick={openQuickObjectsSurface}
                className="shrink-0"
                title="Open Quick Objects tools"
              >
                Tools
              </Button>
            </div>
          ) : (
          <div className={`${quickTemplatesMainExpanded ? 'mb-2' : 'mb-0'} flex items-center justify-between gap-2`}>
            <div
              className={`flex min-w-0 flex-1 items-center rounded-md ${quickTemplatesMainExpanded ? 'gap-2 px-1 py-0.5' : 'gap-1.5 px-1 py-0.5'} cursor-pointer hover:bg-muted/40`}
              onClick={() => setQuickTemplatesMainExpanded((prev) => !prev)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setQuickTemplatesMainExpanded((prev) => !prev)
                }
              }}
              role="button"
              tabIndex={0}
              title={quickTemplatesMainExpanded ? 'Collapse quick objects' : 'Expand quick objects'}
            >
              <h2 className={`${quickTemplatesMainExpanded ? 'text-sm' : 'text-xs'} font-semibold text-foreground`}>Quick Objects</h2>
              {quickTemplatesMainExpanded && (
                <p className="truncate text-xs text-muted-foreground">
                  Template cards for quickly filling Purpose, Notes, and Category Tags.
                </p>
              )}
              {!quickTemplatesMainExpanded && quickTemplates.length > 0 && (
                <div className="min-w-0 flex-1 overflow-hidden">
                  <div className="flex items-center gap-1 overflow-hidden whitespace-nowrap">
                    {quickTemplates.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          void applyQuickTemplate(template)
                        }}
                        title={`${template.quickName}\n${template.title || 'Untitled item'}`}
                        className="inline-flex flex-none items-center rounded-md border border-border px-2 py-1 text-[10px] font-semibold transition-colors hover:border-foreground"
                        style={{
                          ...buildCategoryCardStyle(
                            template.categoryIds,
                            categoryMap,
                            prefs.category_color_display_style,
                            'quick-template'
                          ),
                          color: buildCategoryTextColor(template.categoryIds, categoryMap),
                        }}
                      >
                        {buildQuickTemplateShortcutLabel(template.quickName)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div
              className={`flex items-center ${quickTemplatesMainExpanded ? 'gap-1.5' : 'gap-1'}`}
              onClick={(event) => event.stopPropagation()}
            >
              <Button
                emphasis="outline"
                intent={isQuickTemplatesToggleHovering ? 'primary' : 'neutral'}
                size="compact"
                onClick={() => setQuickTemplatesMainExpanded((prev) => !prev)}
              >
                {quickTemplatesMainExpanded ? 'Collapse' : 'Expand'}
              </Button>
              <Button
                emphasis="outline"
                size="compact"
                onClick={() => {
                  openQuickObjectsSurface()
                }}
              >
                Manage
              </Button>
            </div>
          </div>
          )}

          {isPhoneLayout && isMobileQuickListExpanded && (
            <div
              id="mobile-quick-object-list"
              className="mt-2 flex max-h-40 flex-wrap gap-2 overflow-y-auto border-t border-border pt-2"
            >
              {quickTemplates.slice(2).map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => { void applyQuickTemplate(template) }}
                  className="min-h-11 max-w-full rounded-md border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-primary"
                  title={template.quickName || template.title}
                  style={{
                    ...buildCategoryCardStyle(template.categoryIds, categoryMap, prefs.category_color_display_style, 'quick-template'),
                    color: buildCategoryTextColor(template.categoryIds, categoryMap),
                  }}
                >
                  <span className="block truncate">{template.quickName || template.title || 'Quick Object'}</span>
                </button>
              ))}
            </div>
          )}
          {!isPhoneLayout && quickTemplatesMainExpanded && (
            quickTemplates.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-2.5 py-2 text-xs text-muted-foreground">
                No templates yet. Use Quick Objects in the left panel to create one.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {quickTemplates.map((template) => (
                  <article
                    key={template.id}
                    className="min-w-0 rounded-md border border-border p-2"
                    style={{
                      ...buildCategoryCardStyle(
                        template.categoryIds,
                        categoryMap,
                        prefs.category_color_display_style,
                        'quick-template'
                      ),
                      flex: '1 1 calc((100% - (5 * 0.5rem)) / 6)',
                      minWidth: 'calc((100% - (5 * 0.5rem)) / 6)',
                      maxWidth: 'calc((100% - (3 * 0.5rem)) / 4)',
                    }}
                  >
                    <p
                      className="line-clamp-1 text-[11px] font-semibold"
                      style={{ color: buildCategoryTextColor(template.categoryIds, categoryMap) }}
                      title={template.title || 'Untitled item'}
                    >
                      {template.title || 'Untitled item'}
                    </p>
                    {template.categoryIds.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {template.categoryIds
                          .map((categoryId) => categoryMap.get(categoryId)?.label)
                          .filter((label): label is string => Boolean(label))
                          .map((label) => (
                            <span
                              key={`${template.id}-${label}`}
                              className="rounded-full border border-black/15 bg-black/10 px-1.5 py-0.5 text-[10px] font-semibold"
                              style={{ color: buildCategoryTextColor(template.categoryIds, categoryMap) }}
                            >
                              {label}
                            </span>
                          ))}
                      </div>
                    )}
                    <input
                      type="text"
                      value={template.quickName}
                      onChange={(event) => updateQuickTemplateName(template.id, event.target.value)}
                      onBlur={(event) => commitQuickTemplateName(template.id, event.target.value)}
                      className="mt-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs font-semibold text-foreground"
                      aria-label="Template quick name"
                    />
                    <label className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={template.autoSaveEnabled}
                        onChange={(event) => updateQuickTemplateAutoSave(template.id, event.target.checked)}
                        className="h-3.5 w-3.5 accent-primary"
                        data-testid={`quick-template-autosave-${template.id}`}
                      />
                      Autosave this template
                    </label>
                    <div className="mt-2 flex items-center gap-1.5">
                      <Button
                        emphasis="outline"
                        size="compact"
                        onClick={() => { void applyQuickTemplate(template) }}
                        className="w-28"
                        data-testid={`quick-template-apply-${template.id}`}
                      >
                        {selectionDraft ? 'Apply Template' : 'Select Time'}
                      </Button>
                      <div className="relative" data-delete-popover-root="true">
                        <IconButton
                          label="Delete template"
                          emphasis="outline"
                          intent="danger"
                          icon={<Trash2 />}
                          onClick={(event) => {
                            const target = event.currentTarget
                            setDeletingTemplateId((current) => {
                              if (current === template.id) {
                                setDeletingTemplatePopoverPosition(null)
                                return null
                              }

                              const rect = target.getBoundingClientRect()
                              const popoverWidth = 208
                              const popoverApproxHeight = 120
                              const margin = 8
                              const left = Math.max(
                                margin,
                                Math.min(rect.right - popoverWidth, window.innerWidth - popoverWidth - margin)
                              )
                              const top = clampTopBelowObstruction(
                                Math.min(rect.bottom + margin, window.innerHeight - popoverApproxHeight - margin),
                                margin
                              )
                              setDeletingTemplatePopoverPosition({ left, top })
                              return template.id
                            })
                          }}
                        />
                        {deletingTemplateId === template.id && (
                          <div
                            data-dismiss-popup="true"
                            className="fixed w-52 max-w-[calc(100vw-1rem)] rounded-md border border-danger-muted bg-background p-2 shadow-lg"
                            style={{
                              zIndex: templateDeletePopoverZ,
                              left: deletingTemplatePopoverPosition?.left ?? 8,
                              top: deletingTemplatePopoverPosition?.top ?? clampTopBelowObstruction(8),
                            }}
                          >
                            <p className="mb-2 text-xs text-foreground">Delete this template?</p>
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                emphasis="outline"
                                size="compact"
                                onClick={() => {
                                  setDeletingTemplateId(null)
                                  setDeletingTemplatePopoverPosition(null)
                                }}
                              >
                                Cancel
                              </Button>
                              <Button intent="danger" size="compact" onClick={() => deleteQuickTemplate(template.id)}>
                                Confirm
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )
          )}
        </section>
      )}

      <header
        ref={headerRef}
        className={`${isPhoneLayout ? 'mb-2 flex flex-nowrap items-center gap-1.5 rounded-lg px-2 py-2' : 'mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2.5'} border ${
          isHiddenModeEnabled
            ? 'border-warning-muted bg-warning-subtle'
            : 'border-border bg-card'
        }`}
      >
        <div ref={headerLeftRef} className={`flex items-center ${isPhoneLayout ? 'gap-1.5 shrink-0' : isHeaderTitleHidden ? 'shrink-0 gap-2' : 'min-w-0 flex-1 basis-0 gap-2 overflow-hidden'}`}>
          <IconButton
            label={isPhoneLayout
              ? (isToolsSurfaceVisible ? 'Close Time Management Tools' : 'Open Time Management Tools')
              : (isLeftPanelOpen ? 'Hide left panel' : 'Show left panel')}
            emphasis="outline"
            icon={(isPhoneLayout ? isToolsSurfaceVisible : isLeftPanelOpen)
              ? <PanelLeftClose />
              : <PanelLeftOpen />}
            onClick={() => {
              if (isPhoneLayout) {
                if (isToolsSurfaceVisible) {
                  closeLeftPanel()
                } else {
                  openLeftPanelSection('modes')
                }
                return
              }

              setIsLeftPanelOpen((prev) => !prev)
            }}
          />
          {showTimeZoomQuickButtons && (
            <div
              ref={headerTimeZoomRef}
              role="group"
              aria-label="Time axis zoom"
              data-testid="time-zoom-quick-buttons"
              className={`flex shrink-0 items-center gap-0.5 rounded-lg ${revealedQuickButtons.time ? QUICK_BUTTONS_REVEAL_CLASSES : ''}`}
            >
              <IconButton
                label={canZoomTimeOut ? `Zoom out time axis to ${formatTimeZoomLabel(stepTimeZoomLevel(slotMinutes, 1))} slots` : 'Time axis is fully zoomed out'}
                emphasis="outline"
                icon={<ZoomOut />}
                disabled={!canZoomTimeOut}
                onClick={() => setSlotMinutes((prev) => stepTimeZoomLevel(prev, 1))}
              />
              {!isPhoneLayout && (
                <span className="min-w-8 text-center text-xs font-semibold tabular-nums text-muted-foreground" aria-live="polite">
                  {formatTimeZoomLabel(slotMinutes)}
                </span>
              )}
              <IconButton
                label={canZoomTimeIn ? `Zoom in time axis to ${formatTimeZoomLabel(stepTimeZoomLevel(slotMinutes, -1))} slots` : 'Time axis is fully zoomed in'}
                emphasis="outline"
                icon={<ZoomIn />}
                disabled={!canZoomTimeIn}
                onClick={() => setSlotMinutes((prev) => stepTimeZoomLevel(prev, -1))}
              />
            </div>
          )}
          {!isPhoneLayout && (
            <div className={`relative flex shrink-0 items-center ${isHeaderTitleHidden ? '' : 'gap-2'}`}>
              {/* Keep the clipped heading accessible and measurable so it can return when space opens up. */}
              <h1
                ref={headerTitleRef}
                className={`flex w-max items-center gap-2 whitespace-nowrap text-base font-semibold md:text-lg ${isHiddenModeEnabled ? 'text-warning' : 'text-foreground'} ${isHeaderTitleHidden ? 'pointer-events-none absolute h-px overflow-hidden [clip-path:inset(50%)]' : ''}`}
              >
                <Calendar className={`h-5 w-5 ${isHiddenModeEnabled ? 'text-warning' : 'text-muted-foreground'}`} />
                {isHiddenModeEnabled ? 'Content hidden Time Management mode' : 'Time Management'}
                {selectedSourceCount > 0 && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-opacity duration-700 ${
                      isAggregateSourceStatusVisible ? 'opacity-100' : 'opacity-0'
                    } ${
                      isAllSelectedSourcesSynced
                        ? 'border-success-muted bg-success-subtle text-success'
                        : 'border-primary-muted bg-primary-subtle text-primary'
                    }`}
                    aria-hidden="true"
                    title="Selected source loading progress"
                  >
                    {loadingSourceCount > 0 ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                    {completedSourceCount}/{selectedSourceCount}
                  </span>
                )}
              </h1>
              {isHiddenModeEnabled && (
                <Button
                  ref={headerDisableHiddenModeRef}
                  emphasis="outline"
                  size="compact"
                  onClick={() => setIsHiddenModeEnabled(false)}
                  className="shrink-0 whitespace-nowrap"
                >
                  Disable Hidden Mode
                </Button>
              )}
            </div>
          )}
        </div>

        <div ref={headerNavigationRef} className={`flex items-center ${isPhoneLayout ? 'gap-1 shrink-0' : 'shrink-0 gap-1.5'}`}>
          {isDayNavigationView && (
            <IconButton
              label="Previous week"
              emphasis="outline"
              icon={<ChevronsLeft />}
              onClick={() => stepVisibleDayWeek(-1)}
            />
          )}
          <IconButton
            label={isDayNavigationView ? 'Previous day' : `Previous ${navigationPeriodLabel}`}
            emphasis="outline"
            icon={<ChevronLeft />}
            onClick={() => (isDayNavigationView
              ? stepVisibleDayWindow(-1)
              : setCurrentWeekStart((prev) => subWeeks(prev, navigationWeekStep)))}
          />
          {isPhoneLayout ? (
            <IconButton
              label="Jump to today"
              emphasis="outline"
              icon={<CalendarDays />}
              onClick={handleToday}
            />
          ) : (
            <Button
              emphasis="outline"
              size="compact"
              onClick={handleToday}
              title="Jump to today"
              aria-label="Jump to today"
            >
              Today
            </Button>
          )}
          <IconButton
            label={isDayNavigationView ? 'Next day' : `Next ${navigationPeriodLabel}`}
            emphasis="outline"
            icon={<ChevronRight />}
            onClick={() => (isDayNavigationView
              ? stepVisibleDayWindow(1)
              : setCurrentWeekStart((prev) => addWeeks(prev, navigationWeekStep)))}
          />
          {isDayNavigationView && (
            <IconButton
              label="Next week"
              emphasis="outline"
              icon={<ChevronsRight />}
              onClick={() => stepVisibleDayWeek(1)}
            />
          )}
        </div>

        <div ref={headerControlsRef} className={`flex items-center ${isPhoneLayout ? 'ml-auto gap-1 shrink-0' : 'min-w-max flex-1 basis-0 justify-end gap-2'}`}>
          {showDayZoomQuickButtons && (
            <div
              role="group"
              aria-label="Day axis zoom"
              data-testid="day-zoom-quick-buttons"
              className={`flex shrink-0 items-center gap-0.5 rounded-lg ${revealedQuickButtons.day ? QUICK_BUTTONS_REVEAL_CLASSES : ''}`}
            >
              <IconButton
                label={canZoomDaysOut ? `Show ${formatDayZoomLabel(zoomOutDayLevel(dayZoomLevel))}` : 'Day axis is fully zoomed out'}
                emphasis="outline"
                icon={<ZoomOut />}
                disabled={!canZoomDaysOut}
                onClick={() => changeDayZoomLevel(zoomOutDayLevel(dayZoomLevel))}
              />
              {!isPhoneLayout && (
                <span className="min-w-12 whitespace-nowrap text-center text-xs font-semibold tabular-nums text-muted-foreground" aria-live="polite">
                  {formatDayZoomLabel(dayZoomLevel)}
                </span>
              )}
              <IconButton
                label={canZoomDaysIn ? `Show ${formatDayZoomLabel(stepDayZoomLevel(dayZoomLevel, -1))}` : 'Day axis is fully zoomed in'}
                emphasis="outline"
                icon={<ZoomIn />}
                disabled={!canZoomDaysIn}
                onClick={() => changeDayZoomLevel(stepDayZoomLevel(dayZoomLevel, -1))}
              />
            </div>
          )}
          {!isPhoneLayout && (
          <span className="shrink-0 whitespace-nowrap rounded-md border border-border bg-background px-2 py-1 text-xs font-semibold text-foreground md:text-sm">
            {weekRangeLabel}
          </span>
          )}
          <TimezoneSelector timezones={tzState} compact={isPhoneLayout} iconOnly={isCompactHeaderControls} />
        </div>
      </header>

      {isUnsyncedBannerVisible && Object.keys(unsyncedOps).length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-warning-muted bg-warning-subtle px-3 py-2 text-sm text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            {Object.keys(unsyncedOps).length === 1
              ? 'Could not save 1 time item to the server.'
              : `Could not save ${Object.keys(unsyncedOps).length} time items to the server.`}
            {' '}Your changes are kept on this device and will sync automatically once the connection is restored.
          </span>
          <Button
            emphasis="outline"
            size="compact"
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            onClick={() => void flushUnsyncedOps()}
          >
            Retry now
          </Button>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-border bg-card">
        {(isLoading || eventsError || !hasVisibleItems) && (
          <div className="border-b border-border px-3 py-2 text-sm">
            {isLoading ? (
              <span className="text-muted-foreground">Loading meetings from selected calendars...</span>
            ) : eventsError ? (
              <span className="text-danger">{eventsError}</span>
            ) : (
              <span className="text-muted-foreground">No meetings found on the selected calendars.</span>
            )}
          </div>
        )}
        <style>{`@keyframes blink-colon { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } } @keyframes selection-glow { 0%, 100% { box-shadow: 0 0 0 2px rgba(59,130,246,0.12), 0 0 8px rgba(59,130,246,0.08); } 50% { box-shadow: 0 0 0 4px rgba(59,130,246,0.35), 0 0 18px rgba(59,130,246,0.22); } } @keyframes selection-flow { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } } @keyframes selection-caret { 0%, 45% { opacity: 1; } 55%, 100% { opacity: 0; } } @keyframes selection-time-pulse { 0% { color: inherit; text-shadow: none; } 35% { color: #f97316; text-shadow: 0 0 10px rgba(249,115,22,0.45); } 100% { color: inherit; text-shadow: none; } } @keyframes move-source-ghost { 0%, 100% { opacity: 0.92; transform: scale(1); } 50% { opacity: 0.38; transform: scale(0.985); } } @keyframes drop-target-pulse { 0%, 100% { opacity: 0.96; transform: scale(1); } 50% { opacity: 0.6; transform: scale(0.996); } } @keyframes drop-target-line { 0%, 100% { opacity: 1; } 50% { opacity: 0.62; } } @keyframes source-sync-complete { 0% { transform: scale(0.96); opacity: 0.62; } 45% { transform: scale(1.06); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }`}</style>
        <div
          data-testid="calendar-day-scroll-area"
          className="relative flex min-h-0 flex-1 flex-col"
          onMouseOver={handleCalendarDayHover}
          onMouseLeave={handleCalendarDayHoverEnd}
        >
        <div
          ref={calendarHorizontalScrollRef}
          data-testid="calendar-horizontal-scroll"
          className="group/day-scroll flex min-h-0 flex-1 flex-col overflow-x-auto"
        >
        <div
          className="flex min-h-0 w-full flex-1 flex-col"
          style={{ minWidth: calendarGridMinWidth }}
        >
        {renderCalendarHeaderRow('top')}
        {isPhoneLayout && quickTemplateAwaitingTime !== null && (
          <p role="status" className="border-b border-border bg-primary-subtle px-3 py-2 text-xs text-primary">
            {quickTemplateAwaitingTime} ready -- tap a start time or hold and drag to select a range.
          </p>
        )}
        <p className="hidden border-b border-border px-3 py-1.5 text-xs text-muted-foreground any-pointer-coarse:block">
          Tap to add. Swipe to scroll. Hold for half a second, then drag to select time.
        </p>
        <div
          ref={calendarScrollContainerRef}
          data-testid="calendar-scroll-container"
          className="scrollbar-none flex-1 min-h-0 overflow-auto"
          style={{ maxHeight: '78vh' }}
          onScroll={handleCalendarScroll}
          onDragOverCapture={(event) => {
            if (!isDraggingItem) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            dragClientYRef.current = event.clientY
            autoScrollCalendarWhileDragging(event.clientY)
          }}
        >
          {Array.from({ length: CALENDAR_REPEAT_COUNT }, (_, repeatIndex) => (
            <div key={repeatIndex} aria-hidden={repeatIndex !== CALENDAR_REPEAT_MIDDLE_INDEX}>
          <div
            data-testid={repeatIndex === CALENDAR_REPEAT_MIDDLE_INDEX ? 'calendar-week-grid' : undefined}
            className="relative grid"
            style={{ gridTemplateColumns: weekGridTemplateColumns }}
          >
            {timezoneGridColumns.map(({ iana: tz, labels }) => (
              <div key={tz} data-testid={repeatIndex === CALENDAR_REPEAT_MIDDLE_INDEX ? `calendar-timezone-column-${tz}` : undefined} className={`relative border-r border-border ${isCalendarHorizontallyScrollable ? `${pinnedTimezoneColumnClass} bg-linear-to-b from-muted/30 to-muted/30` : 'bg-muted/30'}`} style={{ height: `${dayHeight}px` }}>
                {selectionDaySegments.map((segment) => (
                  <div
                    key={segment.dayIndex}
                    className="pointer-events-none absolute left-0 right-0 z-1"
                    style={{
                      top: `${(segment.startMinute / slotMinutes) * SLOT_HEIGHT}px`,
                      height: `${((segment.endMinute - segment.startMinute) / slotMinutes) * SLOT_HEIGHT}px`,
                      backgroundColor: hexToRgba(selectionAccentColor, 0.08),
                      borderTop: `2px solid ${hexToRgba(selectionAccentColor, 0.55)}`,
                      borderBottom: `2px solid ${hexToRgba(selectionAccentColor, 0.55)}`,
                    }}
                  />
                ))}
                {labels.map(({ minute, time }) => (
                  <div
                    key={minute}
                    className={`absolute left-0 right-0 flex items-center justify-center ${
                      isQuarterHourGrid && minute % 60 === 0
                        ? 'border-t-2 border-t-foreground/25 bg-muted/55'
                        : 'border-t border-border/70'
                    }`}
                    style={{
                      top: `${(minute / slotMinutes) * SLOT_HEIGHT}px`,
                      height: `${SLOT_HEIGHT}px`,
                    }}
                  >
                    <span className="block w-full text-center text-[10px] font-medium leading-none text-muted-foreground">
                      {time}
                    </span>
                  </div>
                ))}
                <div className="absolute bottom-0 left-0 right-0 border-t border-border/70" />
              </div>
            ))}

            {weekDays.map((day, dayIndex) => {
              if (!visibleDayIndexSet.has(dayIndex)) return null
              const layout = dayLayouts[dayIndex]
              const selectionSegment = selectionDaySegments.find((segment) => segment.dayIndex === dayIndex)
              const isHighlightedDay = highlightedDay ? isSameDay(day, highlightedDay) : false
              const isDropPreviewVisible =
                isDraggingItem &&
                dragDropPreview?.dayIndex === dayIndex &&
                (dragDropPreview?.itemId === draggingItem?.id || dragDropPreview?.itemId === draggingItemId)
              const dropPreviewTop = isDropPreviewVisible
                ? (dragDropPreview.startMinute / slotMinutes) * SLOT_HEIGHT
                : 0
              const dropPreviewHeight = isDropPreviewVisible
                ? Math.max((dragDropPreview.durationMinutes / slotMinutes) * SLOT_HEIGHT, 10)
                : 0
              const dropPreviewColor = draggingItem ? (sourceMap.get(draggingItem.sourceId)?.color || '#2563eb') : '#2563eb'
              const resizingPreviewItem = resizeState
                ? interactionItemMap.get(resizeState.itemId) || items.find((entry) => entry.id === resizeState.itemId)
                : null
              const isRecurringResizePreviewVisible =
                Boolean(resizeState?.isRecurringEvent)
                && Boolean(recurringResizePreview)
                && recurringResizePreview?.dayIndex === dayIndex
              const recurringResizePreviewTop = isRecurringResizePreviewVisible && recurringResizePreview
                ? (recurringResizePreview.startMinute / slotMinutes) * SLOT_HEIGHT
                : 0
              const recurringResizePreviewHeight = isRecurringResizePreviewVisible && recurringResizePreview
                ? Math.max((recurringResizePreview.durationMinutes / slotMinutes) * SLOT_HEIGHT, 10)
                : 0
              const recurringResizePreviewColor = resizingPreviewItem
                ? (sourceMap.get(resizingPreviewItem.sourceId)?.color || '#2563eb')
                : '#2563eb'

              type SegmentContinuity = { hasConnectedTop: boolean; hasConnectedBottom: boolean }
              const segmentContinuity = new Map<number, SegmentContinuity>()
              const segmentsByItem = new Map<string, Array<{ index: number; top: number; bottom: number }>>()
              const segmentOrderByIndex = new Map<number, number>()
              const firstSegmentMetaByItem = new Map<string, { height: number; hasConnectedBottom: boolean }>()

              layout.eventSegments.forEach((segment, segmentIndex) => {
                const bucket = segmentsByItem.get(segment.eventId)
                const entry = { index: segmentIndex, top: segment.top, bottom: segment.top + segment.height }
                if (bucket) {
                  bucket.push(entry)
                  return
                }
                segmentsByItem.set(segment.eventId, [entry])
              })

              for (const entries of segmentsByItem.values()) {
                entries.sort((a, b) => a.top - b.top)
                for (let segmentIndex = 0; segmentIndex < entries.length; segmentIndex++) {
                  const current = entries[segmentIndex]
                  const previous = segmentIndex > 0 ? entries[segmentIndex - 1] : null
                  const next = segmentIndex < entries.length - 1 ? entries[segmentIndex + 1] : null
                  const hasConnectedTop = !!previous && Math.abs(previous.bottom - current.top) < 0.5
                  const hasConnectedBottom = !!next && Math.abs(current.bottom - next.top) < 0.5
                  segmentContinuity.set(current.index, { hasConnectedTop, hasConnectedBottom })
                  segmentOrderByIndex.set(current.index, segmentIndex)
                  if (segmentIndex === 0) {
                    const eventId = layout.eventSegments[current.index]?.eventId
                    if (eventId) {
                      const segmentItem = itemMap.get(eventId)
                      const interactionId = segmentItem ? getTimeItemInteractionId(segmentItem) : eventId
                      firstSegmentMetaByItem.set(eventId, {
                        height: Math.max(current.bottom - current.top, 0),
                        hasConnectedBottom,
                      })
                      if (interactionId !== eventId) {
                        firstSegmentMetaByItem.set(interactionId, {
                          height: Math.max(current.bottom - current.top, 0),
                          hasConnectedBottom,
                        })
                      }
                    }
                  }
                }
              }

              return (
                <Fragment key={day.toISOString()}>
                  {dstGridColumns.filter((column) => column.transitionDayIndex === dayIndex).map((column) => (
                    <div
                      key={column.iana}
                      data-testid={repeatIndex === CALENDAR_REPEAT_MIDDLE_INDEX ? `calendar-dst-column-${column.iana}` : undefined}
                      aria-label={column.description}
                      className="relative border-x border-warning-muted bg-muted/30"
                      style={{ height: `${dayHeight}px` }}
                    >
                      {column.labels.map(({ minute, time, changed }) => (
                        <div
                          key={minute}
                          data-dst-changed={changed ? 'true' : 'false'}
                          data-utc-minute={minute}
                          className={`absolute left-0 right-0 flex items-center justify-center border-t border-warning-muted font-mono text-[10px] tabular-nums ${
                            changed ? 'bg-warning-subtle font-semibold text-warning' : 'text-muted-foreground/40'
                          }`}
                          style={{ top: `${(minute / slotMinutes) * SLOT_HEIGHT}px`, height: `${SLOT_HEIGHT}px` }}
                        >
                          {time}
                        </div>
                      ))}
                    </div>
                  ))}
                <div
                  key={day.toISOString()}
                  className={`relative border-r border-border last:border-r-0 transition-shadow ${
                    isHighlightedDay ? 'bg-primary-subtle ring-2 ring-inset ring-primary' : ''
                  }`}
                  ref={(element) => {
                    if (repeatIndex === CALENDAR_REPEAT_MIDDLE_INDEX) {
                      dayColumnRefs.current[dayIndex] = element
                    }
                  }}
                  data-testid={repeatIndex === CALENDAR_REPEAT_MIDDLE_INDEX ? `calendar-day-column-${dayIndex}` : undefined}
                  data-time-management-drop-zone="true"
                  data-time-management-day-index={dayIndex}
                  style={{
                    height: `${dayHeight}px`,
                    backgroundImage: isQuarterHourGrid
                      ? `repeating-linear-gradient(hsl(var(--border) / 0.7) 0, hsl(var(--border) / 0.7) 1px, transparent 1px, transparent ${SLOT_HEIGHT}px), linear-gradient(to bottom, transparent calc(100% - 2px), hsl(var(--foreground) / 0.16) calc(100% - 2px), hsl(var(--foreground) / 0.16) 100%)`
                      : `repeating-linear-gradient(hsl(var(--border) / 0.7) 0, hsl(var(--border) / 0.7) 1px, transparent 1px, transparent ${SLOT_HEIGHT}px)`,
                    backgroundSize: isQuarterHourGrid ? `100% ${SLOT_HEIGHT}px, 100% ${hourBlockHeight}px` : undefined,
                    backgroundPosition: isQuarterHourGrid ? '0 0, 0 0' : undefined,
                    cursor: isResizing ? 'ns-resize' : 'default',
                  }}
                  onMouseMove={(event) => {
                    if (touchGridSelection.suppressCompatibilityMouse()) return
                    if (isSelecting) {
                      const minute = minuteFromPointer(event)
                      updateSelection(dayIndex, minute)
                      return
                    }
                    if (isResizing) return
                    const rect = event.currentTarget.getBoundingClientRect()
                    const pointerX = event.clientX - rect.left
                    const pointerY = Math.max(0, Math.min(rect.height, event.clientY - rect.top))
                    const edgeTarget = findEdgeResizeTarget(dayIndex, pointerX, pointerY, rect.width)
                    event.currentTarget.style.cursor = edgeTarget ? 'ns-resize' : 'default'
                  }}
                  onMouseLeave={(event) => {
                    if (!isResizing) event.currentTarget.style.cursor = 'default'
                  }}
                  onPointerDownCapture={(event) => {
                    if (!isPhoneLayout || (!isPhoneMovePlacement && quickTemplateAwaitingTime === null) || event.pointerType !== 'touch') return
                    if (isResizing || isTemplateSelectionMode) return
                    // Placement owns the touch even over cards and resize edges; swipes still scroll.
                    event.stopPropagation()
                    touchGridSelection.onTouchPointerDown(event, dayIndex)
                  }}
                  onClickCapture={(event) => {
                    if (!isPhoneLayout) return
                    if (!(event.target instanceof Element) || !event.target.closest('[data-time-management-item="true"]')) return
                    // Selection clears the ready cue before the compatibility click arrives.
                    if (!isPhoneMovePlacement && quickTemplateAwaitingTime === null && !touchGridSelection.suppressCompatibilityMouse()
                      && !itemContextHoldGateRef.current.isEngaged() && Date.now() >= suppressItemHoldClickUntilRef.current) return
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  onContextMenuCapture={(event) => {
                    if (!isPhoneLayout) return
                    if (!isPhoneMovePlacement && quickTemplateAwaitingTime === null && !touchGridSelection.suppressCompatibilityMouse()
                      && !itemContextHoldGateRef.current.isEngaged() && Date.now() >= suppressItemHoldClickUntilRef.current) return
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    closeCalendarItemContextMenu()
                    setSelectionPasteContextMenu({
                      x: event.clientX, y: event.clientY,
                      target: getGridContextTarget(event.currentTarget, event.clientY),
                    })
                  }}
                  onMouseDownCapture={(event) => {
                    if (touchGridSelection.suppressCompatibilityMouse()) return
                    if (isPhoneLayout && (itemContextHoldGateRef.current.isEngaged()
                      || Date.now() < suppressItemHoldClickUntilRef.current)) {
                      event.preventDefault()
                      event.stopPropagation()
                      return
                    }
                    if (event.button !== 0 || isSelecting || isResizing) return

                    const rect = event.currentTarget.getBoundingClientRect()
                    const pointerX = event.clientX - rect.left
                    const pointerY = Math.max(0, Math.min(rect.height, event.clientY - rect.top))
                    const edgeTarget = findEdgeResizeTarget(dayIndex, pointerX, pointerY, rect.width)
                    if (!edgeTarget) return

                    event.preventDefault()
                    event.stopPropagation()
                    beginEdgeResize({
                      itemId: edgeTarget.itemId,
                      dayIndex,
                      edge: edgeTarget.edge,
                      dayColumnElement: event.currentTarget,
                    })
                  }}
                  onMouseDown={(event) => {
                    if (touchGridSelection.suppressCompatibilityMouse()) return
                    if (event.button !== 0) return
                    if (isResizing) return
                    if (isTemplateSelectionMode) return
                    selectionAnchorDayColumnRef.current = event.currentTarget
                    const minute = minuteFromPointer(event)
                    void startSelectionWithUnsavedGuard(dayIndex, minute, { x: event.clientX, y: event.clientY })
                  }}
                  onPointerDown={(event) => {
                    if (event.pointerType === 'mouse') return
                    if (isResizing) return
                    if (isTemplateSelectionMode) return
                    const isItemTouch = event.target instanceof Element
                      && Boolean(event.target.closest('[data-time-management-item="true"]'))
                    if (event.pointerType === 'touch' && !isItemTouch) {
                      touchGridSelection.onTouchPointerDown(event, dayIndex)
                      return
                    }

                    const rect = event.currentTarget.getBoundingClientRect()
                    const pointerX = event.clientX - rect.left
                    const pointerY = Math.max(0, Math.min(rect.height, event.clientY - rect.top))
                    const edgeTarget = findEdgeResizeTarget(dayIndex, pointerX, pointerY, rect.width)
                    if (edgeTarget) {
                      event.preventDefault()
                      event.stopPropagation()
                      beginEdgeResize({
                        itemId: edgeTarget.itemId,
                        dayIndex,
                        edge: edgeTarget.edge,
                        dayColumnElement: event.currentTarget,
                      })
                      return
                    }

                    event.preventDefault()
                    event.stopPropagation()
                    if (typeof event.currentTarget.setPointerCapture === 'function') {
                      event.currentTarget.setPointerCapture(event.pointerId)
                    }
                    selectionAnchorDayColumnRef.current = event.currentTarget
                    const minute = minuteFromPointer(event as unknown as MouseEvent<HTMLDivElement>)
                    void startSelectionWithUnsavedGuard(dayIndex, minute, { x: event.clientX, y: event.clientY })
                  }}
                  onPointerMove={(event) => {
                    if (event.pointerType === 'mouse' || event.pointerType === 'touch') return
                    if (!isSelecting || !selectionDraft || selectionDraft.dayIndex !== dayIndex) return
                    event.preventDefault()
                    const minute = minuteFromPointer(event as unknown as MouseEvent<HTMLDivElement>)
                    updateSelection(dayIndex, minute)
                  }}
                  onPointerUp={(event) => {
                    if (event.pointerType === 'mouse') return
                    if (
                      typeof event.currentTarget.hasPointerCapture === 'function'
                      && event.currentTarget.hasPointerCapture(event.pointerId)
                    ) {
                      event.currentTarget.releasePointerCapture(event.pointerId)
                    }
                  }}
                  onPointerCancel={(event) => {
                    if (event.pointerType === 'mouse') return
                    if (
                      typeof event.currentTarget.hasPointerCapture === 'function'
                      && event.currentTarget.hasPointerCapture(event.pointerId)
                    ) {
                      event.currentTarget.releasePointerCapture(event.pointerId)
                    }
                  }}
                  onDragOver={(event) => {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                    if (draggingItem) {
                      const rect = event.currentTarget.getBoundingClientRect()
                      const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top))
                      const pointerMinute = (y / rect.height) * MINUTES_IN_DAY
                      const startMinute = resolveDropStartMinute(
                        pointerMinute,
                        dragTopOffsetMinutesRef.current,
                        slotMinutes,
                        draggingItem.durationMinutes
                      )
                      const previewStartMinute = wrapMinuteWithinDay(startMinute)
                      scheduleDragDropPreview({
                        dayIndex,
                        startMinute: previewStartMinute,
                        durationMinutes: draggingItem.durationMinutes,
                        itemId: draggingItemId || draggingItem.id,
                      })
                    }
                    autoScrollCalendarWhileDragging(event.clientY)
                  }}
                  onDragLeave={(event) => {
                    const next = event.relatedTarget
                    if (next instanceof Node && event.currentTarget.contains(next)) {
                      return
                    }
                    if (!next) {
                      return
                    }
                    cancelScheduledDragDropPreview()
                    setDragDropPreview((previous) => (previous?.dayIndex === dayIndex ? null : previous))
                  }}
                  onDrop={(event) => handleDrop(event, dayIndex)}
                >
                  {timeBackgroundSegments.map((segment) => (
                    <div
                      key={segment.key}
                      className="pointer-events-none absolute inset-x-0"
                      style={{
                        top: `${(segment.startMinute / slotMinutes) * SLOT_HEIGHT}px`,
                        height: `${((segment.endMinute - segment.startMinute) / slotMinutes) * SLOT_HEIGHT}px`,
                        backgroundImage: buildDiffuseTimeBackgroundFill(segment.color, segment.opacity),
                        boxShadow: `inset 0 0 0 1px ${hexToRgba(segment.color, Math.min(segment.opacity + 0.16, MAX_TIME_BACKGROUND_OPACITY))}`,
                      }}
                    />
                  ))}

                  {selectionSegment && selectionDraft && (
                    <div
                      data-testid={repeatIndex === CALENDAR_REPEAT_MIDDLE_INDEX ? `selection-day-segment-${dayIndex}` : undefined}
                      className="@container/selection absolute left-[2.5%] right-[2.5%] z-22 rounded-md border-2"
                      style={{
                        top: `${(selectionSegment.startMinute / slotMinutes) * SLOT_HEIGHT}px`,
                        height: `${((selectionSegment.endMinute - selectionSegment.startMinute) / slotMinutes) * SLOT_HEIGHT}px`,
                        borderColor: selectionAccentColor,
                        backgroundImage: `linear-gradient(120deg, ${hexToRgba(selectionAccentColor, 0.15)}, ${hexToRgba(selectionAccentColor, 0.32)}, ${hexToRgba(selectionAccentColor, 0.15)})`,
                        backgroundSize: '220% 220%',
                        animation: 'selection-flow 2.5s ease-in-out infinite',
                        boxShadow: `0 0 0 2px ${hexToRgba(selectionAccentColor, 0.22)}`,
                      }}
                      onMouseDown={(event) => {
                        const target = event.target as HTMLElement | null
                        if (target?.closest('[data-selection-overlay-action="true"]')) {
                          event.stopPropagation()
                        }
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        closeCalendarItemContextMenu()
                        setSelectionPasteContextMenu({
                          x: event.clientX, y: event.clientY,
                          target: getGridContextTarget(event.currentTarget, event.clientY),
                        })
                      }}
                    >
                      <div className="pointer-events-none absolute inset-[3px] rounded border border-dashed" style={{ borderColor: hexToRgba(selectionAccentColor, 0.6) }} />
                      <div className="pointer-events-none absolute left-2 right-2 top-2">
                        <div
                          className="pointer-events-none inline-flex max-w-full select-none items-center gap-1 rounded-md border bg-card px-2 py-1 text-[11px] font-bold shadow-md"
                          style={{ borderColor: selectionAccentColor, color: selectionAccentColor }}
                        >
                          <span className="truncate">{isHiddenModeEnabled ? 'Hidden item' : draft.title.trim() || 'Type Title for Time Item'}</span>
                          <span
                            className="h-3.5 w-0.5 rounded-full"
                            style={{ backgroundColor: selectionAccentColor, animation: 'selection-caret 0.9s step-start infinite' }}
                          />
                        </div>
                      </div>
                      {!isPhoneLayout && (
                      <div className="absolute right-1.5 -top-3 z-20 flex items-center gap-1" data-selection-overlay-action="true">
                        <Button
                          size="micro"
                          emphasis="outline"
                          icon={<Maximize2 className="h-3 w-3" />}
                          onClick={openFullEditor}
                          className="shadow-xs"
                          aria-label="Open full view for selection"
                          title="Open full view for selection"
                          data-testid="calendar-grid-open-full-view"
                        >
                          Full View
                        </Button>
                        {!draft.title.trim() && (
                          <Button
                            size="micro"
                            emphasis="outline"
                            intent="neutral"
                            icon={<X className="h-3 w-3" aria-hidden="true" />}
                            onClick={clearActiveTimeSelection}
                            className="shrink-0 shadow-xs"
                            aria-label="Clear time selection"
                            title="Clear time selection (Esc)"
                            data-testid="calendar-grid-clear-selection"
                          >
                            <span className="hidden @[190px]/selection:inline">(ESC)</span>
                          </Button>
                        )}
                        {draft.title.trim() && (
                          <Button
                            size="micro"
                            intent="primary"
                            icon={<Save className="h-3 w-3" />}
                            onClick={() => { void handleSaveSelectionFromSurface('calendarGrid') }}
                            disabled={!canSaveNewSelectionItem}
                            className="shadow-xs"
                            aria-label="Save selected time item"
                            title="Save (Enter)"
                            data-testid="calendar-grid-save-button"
                          >
                            Save
                          </Button>
                        )}
                      </div>
                      )}
                    </div>
                  )}

                  {isDropPreviewVisible && dragDropPreview && (
                    <div
                      className="pointer-events-none absolute left-[4%] right-[4%] z-13 rounded-md border-2 border-dashed"
                      style={{
                        top: `${dropPreviewTop}px`,
                        height: `${dropPreviewHeight}px`,
                        borderColor: dropPreviewColor,
                        backgroundColor: hexToRgba(dropPreviewColor, 0.15),
                        boxShadow: `0 0 0 2px ${hexToRgba(dropPreviewColor, 0.2)}`,
                        animation: 'drop-target-pulse 0.9s ease-in-out infinite',
                      }}
                    >
                      <div
                        className="absolute left-0 right-0 top-0 h-[3px] rounded-full"
                        style={{
                          backgroundColor: dropPreviewColor,
                          boxShadow: `0 0 8px ${hexToRgba(dropPreviewColor, 0.8)}`,
                          animation: 'drop-target-line 0.9s ease-in-out infinite',
                        }}
                      />
                    </div>
                  )}

                  {isRecurringResizePreviewVisible && recurringResizePreview && (
                    <div
                      className="pointer-events-none absolute left-[4%] right-[4%] z-14 rounded-md border-2 border-dashed"
                      style={{
                        top: `${recurringResizePreviewTop}px`,
                        height: `${recurringResizePreviewHeight}px`,
                        borderColor: recurringResizePreviewColor,
                        backgroundColor: hexToRgba(recurringResizePreviewColor, 0.16),
                        boxShadow: `0 0 0 2px ${hexToRgba(recurringResizePreviewColor, 0.2)}`,
                        animation: 'drop-target-pulse 0.9s ease-in-out infinite',
                      }}
                    >
                      <div
                        className="absolute left-0 right-0 top-0 h-[3px] rounded-full"
                        style={{
                          backgroundColor: recurringResizePreviewColor,
                          boxShadow: `0 0 8px ${hexToRgba(recurringResizePreviewColor, 0.8)}`,
                          animation: 'drop-target-line 0.9s ease-in-out infinite',
                        }}
                      />
                    </div>
                  )}

                  {layout.eventSegments.map((segment, segmentIndex) => {
                    const item = itemMap.get(segment.eventId)
                    if (!item) return null

                    const source = sourceMap.get(item.sourceId)
                    const interactionId = getTimeItemInteractionId(item)
                    const isExternal = isReadOnlySource(source)
                    const isSelected = selectedItemId === interactionId
                    const isItemMultiSelected = isMultiSelected(interactionId)
                    const isBeingResized = resizeState?.itemId === interactionId
                    const isBeingDragged = draggingItemId === interactionId
                    const showItemSelectionFeedback = isSelected && itemSelectionFeedback?.itemId === interactionId
                      && !isBeingResized && !isBeingDragged && !isFullEditorOpen
                    const isMoveSource = movingItemId === interactionId
                    const isHoverLinkedItem = hoveredInteractionItemId === interactionId
                    const itemHeight = Math.max(segment.height, 18)
                    const primaryStartLabel = formatAdjustedTimeLabel({ day, minute: item.startMinute, iana: tzState.primary })
                    const primaryEndLabel = formatAdjustedTimeLabel({ day, minute: item.startMinute + item.durationMinutes, iana: tzState.primary })
                    const startsInLabel = formatTimeUntilStartLabel(item.occurrenceStartTime)
                    const categoryCardStyle = buildCategoryCardStyle(
                      item.categoryIds,
                      categoryMap,
                      prefs.category_color_display_style,
                      'time-item'
                    )
                    const categoryTextFill = buildCategoryTextFill(
                      item.categoryIds,
                      categoryMap,
                      resolveCategoryDisplayAngle(prefs.category_color_display_style)
                    )
                    const continuity = segmentContinuity.get(segmentIndex)
                    const hasConnectedTop = continuity?.hasConnectedTop ?? false
                    const hasConnectedBottom = continuity?.hasConnectedBottom ?? false
                    const segmentOrder = segmentOrderByIndex.get(segmentIndex) ?? 0
                    const firstSegmentMeta = firstSegmentMetaByItem.get(interactionId)
                    const titleLikelyTwoRows = item.title.trim().length >= 22
                    const isConnectedChainItem =
                      Boolean(firstSegmentMeta?.hasConnectedBottom)
                      || hasConnectedTop
                      || hasConnectedBottom
                    const firstSegmentIsSingleQuarterSlot =
                      (firstSegmentMeta?.height ?? itemHeight) <= SLOT_HEIGHT * 1.15
                    const shouldMoveTitleToSecondSegment =
                      isQuarterHourGrid
                      && titleLikelyTwoRows
                      && Boolean(firstSegmentMeta?.hasConnectedBottom)
                      && firstSegmentIsSingleQuarterSlot
                    const shouldRenderTitle =
                      !isHiddenModeEnabled
                      && (
                        (segment.isFirstSegment && !shouldMoveTitleToSecondSegment)
                        || (shouldMoveTitleToSecondSegment && segmentOrder === 1 && hasConnectedTop)
                      )
                    const effectiveRecurrenceRule =
                      isSelected && selectedEvent && !isSelectedReadOnly
                        ? normaliseRecurrenceRule(draft.recurrenceRule)
                        : item.recurrenceRule
                    const shouldRenderRecurrenceIcon =
                      effectiveRecurrenceRule?.type !== 'none' && segment.isFirstSegment
                    const titleSizeClass = isQuarterHourGrid
                      ? (
                        isConnectedChainItem
                          ? 'text-[12px]'
                          : titleLikelyTwoRows
                            ? (itemHeight <= SLOT_HEIGHT * 2 ? 'text-[9px]' : 'text-[10px]')
                            : 'text-[11px]'
                      )
                      : 'text-[11px]'

                    return (
                      <div
                        key={`${segment.eventId}-${segment.top}-${segment.leftPercent}`}
                        className={`group absolute rounded-md border-2 px-1 pb-1 pt-0.5 shadow-xs hover:shadow-md ${
                          isBeingResized ? 'transition-none' : 'transition-all duration-200'
                        } ${
                          isItemMultiSelected
                            ? 'ring-4 ring-info ring-offset-1 z-10'
                            : isSelected ? 'ring-2 ring-primary z-10' : ''
                        }`}
                        data-selected={isSelected ? 'true' : undefined}
                        data-multi-selected={isItemMultiSelected ? 'true' : undefined}
                        data-resize-hover-linked={isHoverLinkedItem ? 'true' : undefined}
                        data-time-management-item="true"
                        draggable={false}
                        onMouseEnter={() => {
                          setHoveredInteractionItemId(interactionId)
                        }}
                        onMouseLeave={() => {
                          setHoveredInteractionItemId((current) => (current === interactionId ? null : current))
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                        onPointerDown={(event) => {
                          if (isPhoneLayout && event.pointerType === 'touch' && !isResizing && !isTemplateSelectionMode) {
                            event.stopPropagation()
                            beginItemContextHold(event, interactionId, isExternal)
                            return
                          }
                          const rect = event.currentTarget.getBoundingClientRect()
                          const pointerY = Math.max(0, Math.min(rect.height, event.clientY - rect.top))
                          const isStartResizeEdge =
                            !isExternal
                            && item.isStartSegment
                            && segment.isFirstSegment
                            && pointerY <= EDGE_HIT_PX
                          const isEndResizeEdge =
                            !isExternal
                            && item.isEndSegment
                            && !hasConnectedBottom
                            && rect.height - pointerY <= EDGE_HIT_PX

                          if (isStartResizeEdge || isEndResizeEdge) return
                          event.stopPropagation()
                          beginControlledItemDrag(event, item, interactionId)
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          closeSelectionPasteContextMenu()
                          setCalendarItemContextMenu({
                            itemId: interactionId,
                            x: event.clientX,
                            y: event.clientY,
                            isReadOnly: isExternal,
                            target: getGridContextTarget(event.currentTarget, event.clientY),
                          })
                          setContextMenuDeleteConfirmOpen(false)
                          setContextMenuCategorySubmenuOpen(false)
                        }}
                        onDragStart={(event) => {
                          if (isTemplateSelectionMode) {
                            setIsTemplateSelectionMode(false)
                            setPendingTemplateSourceId(null)
                            setPendingTemplateQuickName('')
                          }

                          if (isExternal) {
                            event.preventDefault()
                            return
                          }

                          const rect = event.currentTarget.getBoundingClientRect()
                          const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top))
                          const dragProgress = rect.height > 0 ? y / rect.height : 0
                          dragTopOffsetMinutesRef.current = item.durationMinutes * dragProgress
                          setIsDraggingItem(true)
                          setDraggingItemId(interactionId)
                          dragClientYRef.current = event.clientY

                          clearDragPreview()
                          const preview = event.currentTarget.cloneNode(true) as HTMLDivElement
                          preview.style.position = 'fixed'
                          preview.style.top = '-10000px'
                          preview.style.left = '-10000px'
                          preview.style.margin = '0'
                          preview.style.pointerEvents = 'none'
                          preview.style.opacity = '1'
                          preview.style.transform = 'none'
                          preview.style.width = `${rect.width}px`
                          preview.style.height = `${rect.height}px`
                          preview.style.borderWidth = '3px'
                          preview.style.borderStyle = 'solid'
                          preview.style.borderColor = 'rgba(248,250,252,1)'
                          preview.style.boxShadow = '0 0 0 2px rgba(15,23,42,0.95), 0 10px 24px rgba(2,6,23,0.35)'
                          preview.style.zIndex = '2147483647'
                          document.body.appendChild(preview)
                          dragPreviewRef.current = preview

                          const offsetX = Math.max(0, Math.min(rect.width, event.clientX - rect.left))
                          const offsetY = Math.max(0, Math.min(rect.height, event.clientY - rect.top))
                          try {
                            if (typeof event.dataTransfer.setDragImage === 'function') {
                              event.dataTransfer.setDragImage(preview, offsetX, offsetY)
                            }
                            event.dataTransfer.setData('text/time-item', interactionId)
                            event.dataTransfer.setData('text/plain', interactionId)
                            event.dataTransfer.effectAllowed = 'move'
                          } catch {
                            // Ignore dataTransfer setup errors in testing or non-standard environments
                          }
                        }}
                        onDrag={(event) => {
                          if (event.clientY > 0) {
                            dragClientYRef.current = event.clientY
                          }
                          autoScrollCalendarWhileDragging(event.clientY)
                        }}
                        onDragEnd={() => {
                          dragTopOffsetMinutesRef.current = 0
                          setIsDraggingItem(false)
                          setDraggingItemId(null)
                          clearDragDropPreviewState()
                          dragClientYRef.current = null
                          clearDragPreview()
                        }}
                        onClick={(event) => {
                          event.stopPropagation()
                          if (suppressNextItemClickRef.current) {
                            suppressNextItemClickRef.current = false
                            return
                          }
                          if (event.ctrlKey || event.metaKey) {
                            toggleMultiSelectItem(interactionId)
                            return
                          }
                          if (multiSelectedItemIds.size > 0) {
                            clearMultiSelect()
                          }
                          void selectItemForEditing(interactionId, { x: event.clientX, y: event.clientY })
                        }}
                        onDoubleClick={(event) => {
                          event.stopPropagation()
                          if (event.ctrlKey || event.metaKey || multiSelectedItemIds.size > 0) return
                          void selectItemForEditing(interactionId, { x: event.clientX, y: event.clientY }).then((didSelect) => {
                            if (didSelect) {
                              openFullEditor()
                            }
                          })
                        }}
                        style={{
                          ...categoryCardStyle,
                          left: `${segment.leftPercent + DAY_COLUMN_ITEM_GUTTER_PERCENT}%`,
                          width: `${Math.max(segment.widthPercent - DAY_COLUMN_ITEM_GUTTER_PERCENT * 2, 8)}%`,
                          top: segment.top,
                          height: itemHeight,
                          borderColor: isItemMultiSelected ? 'hsl(var(--info))' : isBeingDragged ? 'hsl(var(--foreground))' : (source?.color || 'hsl(var(--border))'),
                          color: buildTimeItemTextColor(
                            item.categoryIds,
                            categoryMap
                          ),
                          overflow: 'visible',
                          opacity: (isMoveSource || isBeingDragged) ? 0.52 : categoryCardStyle.opacity,
                          animation: (isMoveSource || isBeingDragged) ? 'move-source-ghost 1.6s ease-in-out infinite' : undefined,
                          borderTopWidth: hasConnectedTop ? 0 : 2,
                          borderBottomWidth: hasConnectedBottom ? 0 : 2,
                          borderTopLeftRadius: hasConnectedTop ? 0 : 6,
                          borderTopRightRadius: hasConnectedTop ? 0 : 6,
                          borderBottomLeftRadius: hasConnectedBottom ? 0 : 6,
                          borderBottomRightRadius: hasConnectedBottom ? 0 : 6,
                          boxShadow: isBeingDragged
                            ? '0 0 0 2px rgba(248,250,252,0.92), 0 6px 16px rgba(2,6,23,0.28)'
                            : undefined,
                        }}
                        title={`${isHiddenModeEnabled ? 'Hidden item' : item.title}\n${primaryStartLabel}-${primaryEndLabel}${isExternal ? '\n(read-only mirror)' : ''}`}
                      >
                        {showItemSelectionFeedback && (
                          <span
                            key={itemSelectionFeedback.sequence}
                            aria-hidden="true"
                            data-testid="time-item-selection-feedback"
                            data-feedback-sequence={itemSelectionFeedback.sequence}
                            className="pointer-events-none absolute inset-0 rounded-[inherit] border-2 border-primary bg-primary/10 motion-safe:animate-[time-item-selection-pulse_650ms_ease-out]"
                          />
                        )}
                        <div className={`pointer-events-none absolute -top-1 left-0 z-30 -translate-y-full transition-opacity duration-100 motion-reduce:transition-none ${showItemSelectionFeedback ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                          <div className="rounded border border-border bg-popover px-1.5 py-1 text-[10px] font-semibold leading-tight text-popover-foreground shadow-xs" data-testid={showItemSelectionFeedback ? 'time-item-selection-duration' : undefined}>
                            <div>{primaryStartLabel}-{primaryEndLabel}</div>
                            <div>{item.actualDurationMinutes} min total</div>
                            {startsInLabel && <div>{startsInLabel}</div>}
                          </div>
                        </div>

                        {shouldRenderRecurrenceIcon && (
                          <div className={effectiveRecurrenceRule?.endType === 'whenCompleted'
                            ? 'absolute right-0.5 top-0.5 z-10 flex items-center justify-center rounded-full bg-background p-px leading-none shadow-xs'
                            : 'pointer-events-none absolute right-1 top-1 rounded-full bg-background/90 p-0.5 text-muted-foreground shadow-xs'}>
                            {effectiveRecurrenceRule?.endType === 'whenCompleted'
                              ? <ConditionalRecurrenceIcon completed={item.recurrenceStatus === 'completed'} />
                              : <Repeat2 className="h-3 w-3" />}
                          </div>
                        )}
                        {shouldRenderTitle && (
                          <>
                            <div
                              className={`pointer-events-none absolute inset-0 line-clamp-2 overflow-hidden px-1 pb-1 pt-0.5 ${titleSizeClass} font-semibold leading-tight`}
                              style={categoryTextFill}
                            >
                              {item.title}
                            </div>
                          </>
                        )}
                        {!hasConnectedBottom && (
                          <div className="pointer-events-none absolute bottom-0.5 right-0.5 text-[10px]">
                            {isExternal ? (
                              <Lock className="h-3 w-3 opacity-80" />
                            ) : (
                              <GripVertical className="h-3 w-3 opacity-80" />
                            )}
                          </div>
                        )}

                        {/* Resize handle -- top (start) edge */}
                        {!isExternal && item.isStartSegment && segment.isFirstSegment && (
                          <div
                            className="time-item-resize-handle time-item-resize-handle-top"
                            data-resize-active={isBeingResized && resizeState?.edge === 'start' ? 'true' : undefined}
                            style={{
                              position: 'absolute',
                              top: -5,
                              left: '8%',
                              right: '8%',
                              height: 3,
                              cursor: 'ns-resize',
                              pointerEvents: 'none',
                            }}
                          />
                        )}

                        {/* Resize handle -- bottom (end) edge */}
                        {!isExternal && item.isEndSegment && !hasConnectedBottom && (
                          <div
                            className="time-item-resize-handle time-item-resize-handle-bottom"
                            data-resize-active={isBeingResized && resizeState?.edge === 'end' ? 'true' : undefined}
                            style={{
                              position: 'absolute',
                              bottom: -5,
                              left: '8%',
                              right: '8%',
                              height: 3,
                              cursor: 'ns-resize',
                              pointerEvents: 'none',
                            }}
                          />
                        )}
                      </div>
                    )
                  })}

                  {layout.overflowSegments.map((overflow) => (
                    <button
                      key={`overflow-${overflow.top}-${overflow.leftPercent}`}
                      className="absolute rounded-md border border-dashed border-primary-muted bg-primary-subtle px-1 text-[10px] font-semibold text-primary hover:bg-primary-muted"
                      style={{
                        left: `${overflow.leftPercent + DAY_COLUMN_ITEM_GUTTER_PERCENT}%`,
                        width: `${Math.max(overflow.widthPercent - DAY_COLUMN_ITEM_GUTTER_PERCENT * 2, 8)}%`,
                        top: overflow.top,
                        height: Math.max(overflow.height, 16),
                      }}
                      onClick={(event) => {
                        event.stopPropagation()
                      }}
                    >
                      +{overflow.count} more
                    </button>
                  ))}
                </div>
                </Fragment>
              )
            })}

            <div
              data-testid="current-time-indicator"
              className="pointer-events-none absolute right-0 z-15"
              style={{
                left: `${timezoneColumnsWidth}px`,
                top: `${currentTimeIndicatorTop}px`,
              }}
            >
              <div
                style={{
                  height: '3px',
                  background:
                    'linear-gradient(to right, transparent, rgba(239, 68, 68, 0.8) 60px, rgba(239, 68, 68, 0.8), transparent)',
                  boxShadow: '0 0 6px rgba(239, 68, 68, 0.6)',
                }}
              />
              <div
                className="absolute -left-1 -top-0.5 h-2 w-2 rounded-full bg-red-600"
                style={{ boxShadow: '0 0 6px rgba(239, 68, 68, 0.8)' }}
              />
            </div>
          </div>
            </div>
          ))}
          {isDesktopLayout && renderCalendarHeaderRow('bottom')}
        </div>
        </div>
        </div>
        </div>
      </div>

      {isModeJsonImportOpen && (
        <Dialog
          open
          onClose={() => { if (!isImportingModeJson) setIsModeJsonImportOpen(false) }}
          title="Import Mode JSON"
          description="Paste a mode settings JSON payload to create a new Calendar Mode."
          kind="focusModal"
          size="2xl"
          showCloseButton
          closeLabel="Close mode JSON import dialog"
        >
            <textarea
              value={modeJsonImportDraft}
              onChange={(event) => setModeJsonImportDraft(event.target.value)}
              placeholder="Paste mode JSON here"
              className="h-64 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground"
            />

            <div className="mt-4 flex gap-2">
              <Button
                intent="primary"
                onClick={() => { void handleSubmitModeJsonImport() }}
                disabled={isImportingModeJson || !modeJsonImportDraft.trim()}
              >
                {isImportingModeJson ? 'Importing...' : 'Import JSON'}
              </Button>
              <Button
                emphasis="outline"
                onClick={() => setModeJsonImportDraft('')}
                disabled={isImportingModeJson}
              >
                Clear
              </Button>
              <Button
                emphasis="outline"
                onClick={() => setIsModeJsonImportOpen(false)}
                disabled={isImportingModeJson}
              >
                Close
              </Button>
            </div>
        </Dialog>
      )}

      {isModeJsonExportOpen && (
        <Dialog
          open
          onClose={() => setIsModeJsonExportOpen(false)}
          title="Mode JSON"
          description="Copy this JSON to share or import this mode elsewhere."
          kind="focusModal"
          size="2xl"
          showCloseButton
          closeLabel="Close mode JSON export dialog"
        >
            <textarea
              readOnly
              value={modeJsonExportText}
              className="h-64 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground"
            />

            <div className="mt-4 flex items-center gap-2">
              <Button
                emphasis="outline"
                intent={modeJsonCopyFeedback === 'Copied to clipboard.' ? 'success' : 'neutral'}
                onClick={() => {
                  if (!modeJsonExportText) return
                  void (async () => {
                    try {
                      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                        await navigator.clipboard.writeText(modeJsonExportText)
                        showModeJsonCopyFeedback('Copied to clipboard.')
                      } else {
                        showModeJsonCopyFeedback('Clipboard not available. Copy manually.')
                      }
                    } catch {
                      showModeJsonCopyFeedback('Could not copy Mode JSON.')
                    }
                  })()
                }}
                disabled={!modeJsonExportText}
              >
                Copy JSON
              </Button>
              {modeJsonCopyFeedback && (
                <p className="text-xs font-medium text-success">
                  {modeJsonCopyFeedback}
                </p>
              )}
            </div>
        </Dialog>
      )}

      {exportDialogOpen && (
        <Dialog
          open
          onClose={() => { if (!isExporting) setExportDialogOpen(false) }}
          title="Export to Calendar"
          description={`Push a copy of "${selectedItem?.title || 'this item'}" to your connected calendars.`}
          size="md"
          showCloseButton
          closeLabel="Close export dialog"
        >

            {oauthCalendars.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-2.5 py-3 text-xs text-muted-foreground">
                No writable Google Calendars connected. Connect one in Settings to export.
              </div>
            ) : (
              <div className="space-y-1.5">
                {oauthCalendars.map((cal) => {
                  const checked = exportTargetIds.has(cal.id)
                  return (
                    <label
                      key={cal.id}
                      className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 transition-colors ${
                        checked
                          ? 'border-primary-muted bg-primary-subtle'
                          : 'border-border hover:bg-muted/50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          const isChecked = event.target.checked
                          setExportTargetIds((prev) => {
                            const next = new Set(prev)
                            if (isChecked) next.add(cal.id)
                            else next.delete(cal.id)
                            return next
                          })
                        }}
                        className="h-3.5 w-3.5 rounded border-border"
                      />
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: cal.color }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-foreground">{cal.name}</span>
                        {cal.secondaryLabel && (
                          <span className="block truncate text-[10px] text-muted-foreground">{cal.secondaryLabel}</span>
                        )}
                      </span>
                    </label>
                  )
                })}
              </div>
            )}

            {selectedEvent?.source_type === 'manual' && oauthCalendars.length > 0 && (
              <label className="mt-3 flex cursor-pointer items-start gap-1.5 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={exportKeepInSync}
                  onChange={(event) => setExportKeepInSync(event.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-border"
                />
                <span>
                  Keep Google copy in sync
                  <span className="block text-[10px] text-muted-foreground">Edits, single-occurrence changes and deletions here update Google automatically.</span>
                </span>
              </label>
            )}

            {exportStatus && (
              <div className="mt-3 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-foreground">
                {exportStatus}
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <Button
                intent="primary"
                icon={<Send className="h-4 w-4" />}
                onClick={() => { void handleExportToCalendars() }}
                disabled={isExporting || exportTargetIds.size === 0 || oauthCalendars.length === 0}
                className="flex-1"
              >
                {isExporting ? 'Exporting...' : 'Export'}
              </Button>
              <Button
                emphasis="outline"
                onClick={() => setExportDialogOpen(false)}
                disabled={isExporting}
              >
                Close
              </Button>
            </div>
        </Dialog>
      )}

      {pendingUnsavedAction && !isPhoneLayout && (
        <div
          className="fixed w-80 max-w-[calc(100vw-1rem)] rounded-lg border border-warning-muted bg-warning-subtle p-3 text-xs text-warning shadow-xl backdrop-blur-xs animate-[unsaved-pop-in_180ms_ease-out]"
          style={{
            zIndex: pendingUnsavedPopoverZ,
            left: pendingUnsavedAnchor?.x ?? 24,
            top: pendingUnsavedAnchor?.y ?? clampTopBelowObstruction(92, 12),
          }}
          role="dialog"
          aria-live="polite"
          aria-label="Unsaved changes"
        >
          <p className="font-semibold">Unsaved changes detected</p>
          <p className="mt-1 text-[11px]">
            {pendingUnsavedAction.type === 'switch-item'
              ? 'Save this item before switching to another one?'
              : pendingUnsavedAction.type === 'create-new-item'
                ? 'Save this item before creating a new time item?'
                : 'Save this item before creating a new selection?'}
          </p>
          <div className="mt-2 flex items-center justify-end gap-2">
            <Button
              emphasis="outline"
              size="compact"
              onClick={() => {
                setPendingUnsavedAction(null)
                setPendingUnsavedAnchor(null)
                setIsPendingUnsavedActionSaving(false)
              }}
            >
              Keep editing
            </Button>
            <Button
              intent="primary"
              size="compact"
              onClick={() => { void handlePendingUnsavedActionConfirm() }}
              disabled={isPendingUnsavedActionSaving}
            >
              {isPendingUnsavedActionSaving ? 'Saving...' : 'Save and continue'}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingUnsavedAction && isPhoneLayout)}
        title="Unsaved changes"
        message={pendingUnsavedAction
          ? pendingUnsavedAction.type === 'switch-item'
            ? 'Save this item before switching to another one?'
            : pendingUnsavedAction.type === 'create-new-item'
              ? 'Save this item before creating a new time item?'
              : 'Save this item before creating a new selection?'
          : ''}
        confirmText={isPendingUnsavedActionSaving ? 'Saving...' : 'Save and continue'}
        cancelText="Keep editing"
        onCancel={() => {
          setPendingUnsavedAction(null)
          setPendingUnsavedAnchor(null)
          setIsPendingUnsavedActionSaving(false)
        }}
        onConfirm={() => { void handlePendingUnsavedActionConfirm() }}
      />

      <ConfirmDialog
        open={Boolean(categoryDeleteTarget)}
        title="Delete category?"
        message={categoryDeleteTarget
          ? `Delete category "${categoryDeleteTarget.label}"? It will be removed from any items that use it.`
          : ''}
        confirmText="Delete"
        cancelText="Cancel"
        onCancel={() => setCategoryDeleteTarget(null)}
        onConfirm={() => {
          if (!categoryDeleteTarget) return
          void handleDeleteCategory(categoryDeleteTarget)
        }}
      />

      <Dialog
        open={recurringEditTitle !== null}
        title="Edit recurring item"
        description={recurringEditTitle || undefined}
        onClose={() => resolveRecurringEditScope(null)}
      >
        <div className="flex flex-col gap-2">
          {(recurringEditIsPublic || recurringEditGoogleLinked) && (
            <div className="space-y-1 rounded-md border border-border bg-muted/30 px-2.5 py-2 text-xs text-foreground">
              <p className="text-muted-foreground">For "This item only":</p>
              {recurringEditIsPublic && (
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={recurringEditOptions.keepPublic}
                    onChange={(event) => {
                      const keepPublic = event.target.checked
                      setRecurringEditOptions((prev) => ({ ...prev, keepPublic }))
                      recurringEditOptionsRef.current = { ...recurringEditOptionsRef.current, keepPublic }
                    }}
                    className="h-3.5 w-3.5 rounded border-border"
                  />
                  Keep public
                </label>
              )}
              {recurringEditGoogleLinked && (
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={recurringEditOptions.updateGoogle}
                    onChange={(event) => {
                      const updateGoogle = event.target.checked
                      setRecurringEditOptions((prev) => ({ ...prev, updateGoogle }))
                      recurringEditOptionsRef.current = { ...recurringEditOptionsRef.current, updateGoogle }
                    }}
                    className="h-3.5 w-3.5 rounded border-border"
                  />
                  Update Google Calendar copy
                </label>
              )}
            </div>
          )}
          <Button emphasis="outline" icon={<Calendar className="h-4 w-4" />} onClick={() => resolveRecurringEditScope('this')}>
            This item only
          </Button>
          <Button intent="primary" icon={<Repeat2 className="h-4 w-4" />} onClick={() => resolveRecurringEditScope('future')}>
            This and future occurrences
          </Button>
          <Button emphasis="ghost" onClick={() => resolveRecurringEditScope(null)}>Cancel</Button>
        </div>
      </Dialog>

      {calendarItemContextMenu && (
        <div
          id="calendar-item-context-menu"
          ref={calendarItemContextMenuRef}
          className={`fixed min-w-48 max-w-[calc(100vw-1rem)] rounded-md border border-border bg-popover py-1 text-sm text-popover-foreground shadow-lg ${isPhoneLayout ? 'max-h-[calc(100dvh-1rem)] overflow-y-auto' : ''}`}
          style={{
            zIndex: calendarItemContextMenuZ,
            left: contextMenuPosition?.left ?? Math.min(calendarItemContextMenu.x, window.innerWidth - 240),
            top: contextMenuPosition?.top ?? clampTopBelowObstruction(Math.min(calendarItemContextMenu.y, window.innerHeight - 330)),
          }}
          onContextMenu={(event) => event.preventDefault()}
          role="menu"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => handleContextCreateNewItem(calendarItemContextMenu.target, calendarItemContextMenu)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
          >
            <Plus className="h-3.5 w-3.5 text-muted-foreground" />
            Create new time item
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => handleContextSaveAsTemplate(calendarItemContextMenu.itemId)}
            onMouseEnter={() => setContextMenuCategorySubmenuOpen(false)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
          >
            <Save className="h-3.5 w-3.5 text-muted-foreground" />
            Save as Template
          </button>

          <button
            type="button"
            role="menuitem"
            disabled={selectedItemId !== calendarItemContextMenu.itemId || !canSaveSelectedItem}
            onClick={handleContextSaveItem}
            onMouseEnter={() => setContextMenuCategorySubmenuOpen(false)}
            className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="flex items-center gap-2">
              <Save className="h-3.5 w-3.5 text-muted-foreground" />
              Save Item
            </span>
            <span className="text-[11px] text-muted-foreground">Enter</span>
          </button>

          {(() => {
            const isCohortItem = isMultiSelected(calendarItemContextMenu.itemId)
            return (
              <>
                {!isCohortItem && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handleContextCopyItem(calendarItemContextMenu.itemId)}
                    onMouseEnter={() => setContextMenuCategorySubmenuOpen(false)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-muted"
                  >
                    <span className="flex items-center gap-2">
                      <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                      Copy Item
                    </span>
                    <span className="text-[11px] text-muted-foreground">Ctrl+C</span>
                  </button>
                )}

                <div className="my-1 h-px bg-border" />

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    toggleMultiSelectItem(calendarItemContextMenu.itemId)
                    closeCalendarItemContextMenu()
                  }}
                  onMouseEnter={() => setContextMenuCategorySubmenuOpen(false)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-muted"
                >
                  <span className="flex items-center gap-2">
                    <CheckSquare className="h-3.5 w-3.5 text-info" />
                    {isCohortItem ? 'Remove from Multi-select' : 'Add to Multi-select'}
                  </span>
                  {!isCohortItem && (
                    <span className="text-[11px] text-muted-foreground">Ctrl+Click</span>
                  )}
                </button>

                {isCohortItem && (
                  <>
                    <div className="my-1 h-px bg-border" />
                    <div className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Multi-select ({multiSelectedItemIds.size} items)
                    </div>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { handleBulkCopyMultiSelected(); closeCalendarItemContextMenu() }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
                    >
                      <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                      Copy Selected
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { handleBulkCutMultiSelected(); closeCalendarItemContextMenu() }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
                    >
                      <Scissors className="h-3.5 w-3.5 text-muted-foreground" />
                      Cut Selected
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { void handleBulkDeleteMultiSelected(); closeCalendarItemContextMenu() }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-danger hover:bg-danger-subtle"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete Selected
                    </button>
                  </>
                )}
              </>
            )
          })()}

          {(movingItemId || selectionDraft) && (
            <button
              type="button"
              role="menuitem"
              onClick={handleContextCancelSelection}
              onMouseEnter={() => setContextMenuCategorySubmenuOpen(false)}
              className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-muted"
            >
              <span className="flex items-center gap-2">
                <X className="h-3.5 w-3.5 text-muted-foreground" />
                Cancel Selection
              </span>
              <span className="text-[11px] text-muted-foreground">Esc</span>
            </button>
          )}

          {!calendarItemContextMenu.isReadOnly && (
            <>
              {!isMultiSelected(calendarItemContextMenu.itemId) && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleContextMoveItem(calendarItemContextMenu.itemId)}
                  onMouseEnter={() => setContextMenuCategorySubmenuOpen(false)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-muted"
                >
                  <span className="flex items-center gap-2">
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    Move Item
                  </span>
                  <span className="text-[11px] text-muted-foreground">Ctrl+X</span>
                </button>
              )}

              <div
                className="relative"
                onMouseEnter={() => {
                  if (!isPhoneLayout) setContextMenuCategorySubmenuOpen(true)
                }}
              >
                <button
                  ref={contextMenuCategoryTriggerRef}
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={contextMenuCategorySubmenuOpen}
                  onClick={() => setContextMenuCategorySubmenuOpen((prev) => !prev)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
                >
                  <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>Assign Category</span>
                  {isPhoneLayout
                    ? <ChevronDown className={`ml-auto h-3.5 w-3.5 text-muted-foreground ${contextMenuCategorySubmenuOpen ? 'rotate-180' : ''}`} />
                    : <ChevronRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" />}
                </button>
                {contextMenuCategorySubmenuOpen && (
                  <div
                    ref={contextMenuCategorySubmenuRef}
                    className={`max-h-[min(18rem,calc(100dvh-1rem))] overflow-y-auto rounded-md border border-border bg-popover py-1 text-sm ${isPhoneLayout ? 'mx-1 shadow-inner' : 'fixed w-56 max-w-[calc(100vw-1rem)] shadow-lg'}`}
                    style={isPhoneLayout ? undefined : categorySubmenuPosition}
                    role="menu"
                    aria-label="Assign Category options"
                  >
                    {categories.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground">
                        No categories yet. Create one in the Categories section.
                      </div>
                    ) : (
                      (() => {
                        const isCohortItem = isMultiSelected(calendarItemContextMenu.itemId)
                        const currentIds = isCohortItem ? null : getContextMenuTargetCategoryIds()
                        return categories.map((cat) => {
                          const bulkState = isCohortItem ? getMultiSelectCategoryState(cat.id) : null
                          const selected = isCohortItem ? bulkState !== 'none' : Boolean(currentIds?.includes(cat.id))
                          return (
                            <button
                              key={cat.id}
                              type="button"
                              role="menuitemcheckbox"
                              aria-checked={bulkState === 'some' ? 'mixed' : selected}
                              onClick={() => {
                                if (isCohortItem) {
                                  void handleBulkToggleCategoryMultiSelected(cat.id)
                                } else {
                                  void handleContextToggleCategory(calendarItemContextMenu.itemId, cat.id)
                                }
                              }}
                              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
                            >
                              <span
                                className="inline-block h-3 w-3 rounded-sm border border-border"
                                style={{ backgroundColor: cat.color }}
                              />
                              <span className="flex-1 truncate">{cat.label}</span>
                              {' '}
                              {bulkState === 'some' && <span className="text-xs text-muted-foreground">mixed</span>}
                              {selected && bulkState !== 'some' && <span className="text-xs text-muted-foreground">checked</span>}
                            </button>
                          )
                        })
                      })()
                    )}
                  </div>
                )}
              </div>

              <div className="my-1 h-px bg-border" />

              {!isMultiSelected(calendarItemContextMenu.itemId) && (
              <div className="relative" onMouseEnter={() => setContextMenuCategorySubmenuOpen(false)}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => setContextMenuDeleteConfirmOpen((prev) => !prev)}
                  aria-expanded={contextMenuDeleteConfirmOpen}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-danger hover:bg-danger-subtle"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete Item
                </button>
                {contextMenuDeleteConfirmOpen && (() => {
                  const ctxItem = items.find((entry) => entry.id === calendarItemContextMenu.itemId)
                  const ctxEvent = ctxItem ? events.find((entry) => entry.id === ctxItem.sourceEventId) : null
                  const ctxIsRecurring = Boolean(ctxEvent?.recurrence_rule && ctxEvent.recurrence_rule.type !== 'none' && ctxEvent.recurrence_rule.endType !== 'whenCompleted')
                  return (
                    <div className="mx-1 mt-1 rounded-md border border-border bg-popover px-3 py-2 shadow-inner">
                      {ctxIsRecurring ? (
                        <>
                          <p className="mb-2 text-xs font-medium text-foreground">
                            This is a recurring item. What would you like to delete?
                          </p>
                          <div className="flex flex-col gap-1.5">
                            <Button emphasis="outline" intent="danger" size="compact" onClick={() => { void handleContextDeleteThisOccurrence(calendarItemContextMenu.itemId) }}>
                              This item only
                            </Button>
                            <Button emphasis="outline" intent="danger" size="compact" onClick={() => { void handleContextDeleteThisAndFollowing(calendarItemContextMenu.itemId) }}>
                              This and all following items
                            </Button>
                            <Button intent="danger" size="compact" onClick={() => { void handleContextDeleteItem(calendarItemContextMenu.itemId) }}>
                              All items in the series
                            </Button>
                            <Button emphasis="ghost" size="compact" onClick={() => setContextMenuDeleteConfirmOpen(false)} className="mt-0.5">
                              Cancel
                            </Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="mb-2 text-xs text-foreground">Delete this item?</p>
                          <div className="flex items-center justify-end gap-2">
                            <Button emphasis="outline" size="compact" onClick={() => setContextMenuDeleteConfirmOpen(false)}>
                              Cancel
                            </Button>
                            <Button intent="danger" size="compact" onClick={() => { void handleContextDeleteItem(calendarItemContextMenu.itemId) }}>
                              Confirm
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  )
                })()}
              </div>
              )}
            </>
          )}
        </div>
      )}

      {selectionPasteContextMenu && (
        <div
          id="selection-paste-context-menu"
          className="fixed min-w-48 max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-md border border-border bg-popover py-1 text-sm text-popover-foreground shadow-lg"
          style={{
            zIndex: selectionPasteContextMenuZ,
            left: Math.max(8, Math.min(selectionPasteContextMenu.x, window.innerWidth - 240)),
            top: clampTopBelowObstruction(Math.min(selectionPasteContextMenu.y, window.innerHeight - 240), 8),
          }}
          onContextMenu={(event) => event.preventDefault()}
          role="menu"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => handleContextCreateNewItem(selectionPasteContextMenu.target, selectionPasteContextMenu)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
          >
            <Plus className="h-3.5 w-3.5 text-muted-foreground" />
            Create new time item
          </button>
          {selectionDraft && (() => {
            const canPaste = Boolean(movingItemId || copiedItem)
            return (
              <>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!canSaveNewSelectionItem}
                  onClick={() => {
                    closeSelectionPasteContextMenu()
                    if (movingItemId && movingItemIsRecurring) {
                      setIsLeftPanelOpen(true)
                      setExpandedSections((prev) => {
                        const next = new Set(prev)
                        next.add('editor')
                        return next
                      })
                      setIsMoveScopeOpen(true)
                      return
                    }
                    void handleSaveSelectionFromSurface('calendarGrid')
                  }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">
                    <Save className="h-3.5 w-3.5 text-muted-foreground" />
                    Save Item
                  </span>
                  <span className="text-[11px] text-muted-foreground">Enter</span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  disabled={!canPaste}
                  onClick={() => {
                    closeSelectionPasteContextMenu()
                    if (movingItemId) {
                      if (movingItemIsRecurring) {
                        setIsLeftPanelOpen(true)
                        setExpandedSections((prev) => {
                          const next = new Set(prev)
                          next.add('editor')
                          return next
                        })
                        setIsMoveScopeOpen(true)
                        return
                      }
                      void handleSaveSelectionFromSurface('calendarGrid')
                    } else if (copiedItem) {
                      void pasteCopiedItemToSelection()
                    }
                  }}
                  title={canPaste ? 'Paste item into this selection' : 'Cut (Ctrl+X) or Copy (Ctrl+C) an item first'}
                  className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">
                    <Save className="h-3.5 w-3.5 text-muted-foreground" />
                    Paste Item
                  </span>
                  <span className="text-[11px] text-muted-foreground">Ctrl+V</span>
                </button>

                {multiClipboard && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closeSelectionPasteContextMenu()
                      void pasteMultiClipboardToSelection()
                    }}
                    title="Paste the copied/cut multi-select items into this selection"
                    className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-muted"
                  >
                    <span className="flex items-center gap-2">
                      <CheckSquare className="h-3.5 w-3.5 text-info" />
                      Paste Multi-select ({multiClipboard.items.length})
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeSelectionPasteContextMenu()
                    if (multiSelectedItemIds.size > 0) {
                      handleAddOverlappingItemsToMultiSelect()
                    } else {
                      handleSelectOverlappingItems()
                    }
                  }}
                  title={
                    multiSelectedItemIds.size > 0
                      ? 'Add every time item that falls (even partially) within this time window to the multi-select'
                      : 'Select every time item that falls (even partially) within this time window'
                  }
                  className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-muted"
                >
                  <span className="flex items-center gap-2">
                    <CheckSquare className="h-3.5 w-3.5 text-info" />
                    {multiSelectedItemIds.size > 0 ? 'Add to Multi-select' : 'Select Overlapping Items'}
                  </span>
                  {multiSelectedItemIds.size > 0 && (
                    <span className="text-[11px] text-muted-foreground">Ctrl+Click</span>
                  )}
                </button>

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeSelectionPasteContextMenu()
                    handleDiscardSelectionDraft()
                  }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-muted"
                >
                  <span className="flex items-center gap-2">
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                    Cancel Selection
                  </span>
                  <span className="text-[11px] text-muted-foreground">Esc</span>
                </button>
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}
