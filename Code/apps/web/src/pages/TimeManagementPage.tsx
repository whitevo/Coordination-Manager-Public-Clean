import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { EditorContent, Extension, InputRule, useEditor, wrappingInputRule } from '@tiptap/react'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extension-placeholder'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import {
  addDays,
  addMonths,
  addYears,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  format,
  isSameDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from 'date-fns'
import {
  AlertTriangle,
  BookOpen,
  Calendar,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock3,
  Copy,
  GripVertical,
  Lock,
  Loader2,
  Maximize2,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RefreshCw,
  Repeat2,
  Save,
  Send,
  Tag,
  Trash2,
  Unplug,
  X,
} from 'lucide-react'
import { apiClient, dedupedGet } from '../lib/api-client'
import { useAuth } from '../contexts/AuthContext'
import { useAiAssistant } from '../contexts/AiAssistantContext'
import { LeftPanelPortal } from '../contexts/LayoutContext'
import TimezoneSelector from '../components/TimezoneSelector'
import ColorGridPicker from '../components/ColorGridPicker'
import ConfirmDialog from '../components/ConfirmDialog'
import {
  buildDiffuseTimeBackgroundFill,
  inferRequestedTimezoneForAiResponse,
  isExplicitPrimaryTimezoneChangeRequest,
} from './time-management-page-helpers'
import { useTimezones } from '../lib/use-timezones'
import { isSafeUrl } from '../lib/calendar-utils'
import { convertUtcTimeToTimezone, getCurrentTimeInTimezone, findTimezone } from '../lib/timezone-data'
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
  totalDurationMinutes?: number
  categoryIds: string[]
  sourceId: string
  sourceType: UserEventRecord['source_type']
  recurrenceRule?: RecurrenceRule | null
  isRecurringOccurrence: boolean
  isStartSegment: boolean
  isEndSegment: boolean
}

interface UserEventRecord {
  id: string
  title: string
  description: string | null
  meeting_link: string | null
  location: string | null
  start_time: string
  end_time: string
  is_public?: boolean
  source_type: 'manual' | 'google_oauth' | 'google_public_url' | 'coordination_calendar'
  source_id: string | null
  category_ids?: string[]
  recurrence_rule?: RecurrenceRule | null
}

interface SelectionDraft {
  dayIndex: number
  startMinute: number
  endMinute: number
}

type PendingUnsavedAction =
  | { type: 'switch-item'; itemId: string }
  | { type: 'new-selection'; dayIndex: number; minute: number }

interface PendingUnsavedAnchor {
  x: number
  y: number
}

interface ResizeState {
  itemId: string
  dayIndex: number
  edge: 'start' | 'end'
  dayColumnElement: HTMLDivElement
  originalEvent: UserEventRecord
  originalStartMinute: number
  originalEndMinute: number
}

interface DragDropPreviewState {
  dayIndex: number
  startMinute: number
  durationMinutes: number
  itemId: string
}

interface ItemDraft {
  title: string
  notes: string
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

interface StoredPreferences {
  syncCalendars: SyncCalendar[]
  slotMinutes: TimeWidth
  timeBackgrounds: TimeBackgroundPeriod[]
  collapsedBackgroundIds: string[]
  quickTemplates: QuickTemplate[]
  showQuickTemplatesInMain: boolean
  quickTemplatesMainExpanded: boolean
  isLeftPanelOpen: boolean
  leftPanelWidthPx: number
  expandedSections: LeftPanelSectionId[]
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
}

interface ApiErrorShape {
  response?: {
    data?: {
      error?: string
      message?: string
    }
  }
  message?: string
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
const DAY_MS = 24 * 60 * 60 * 1000
const MAIN_SOURCE_ID = 'coord-main'
const AUTO_SAVE_DELAY_MS = 15000
const SAVE_SUCCESS_HOLD_MS = 2500
const RECURRENCE_MAX_LOOKAHEAD_DAYS = 365 * 20
const WEEK_WINDOW_CACHE_RADIUS = 1
const WEEK_WINDOW_CACHE_TTL_MS = 60 * 1000

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
  return value === 'none' || value === 'weekly' || value === 'biweekly' || value === 'monthly' || value === 'custom'
}

function isRecurrenceUnit(value: unknown): value is RecurrenceUnit {
  return value === 'day' || value === 'week' || value === 'month'
}

function isRecurrenceEndType(value: unknown): value is RecurrenceEndType {
  return value === 'never' || value === 'on' || value === 'after'
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
    endType,
    endDate,
    endCount,
    exceptions: exceptions && exceptions.length > 0 ? exceptions : undefined,
  }
}

function formatRecurrenceSummary(rule: RecurrenceRule | null | undefined): string {
  if (!rule || rule.type === 'none') return 'Does not repeat'
  if (rule.type === 'weekly') return 'Weekly'
  if (rule.type === 'biweekly') return 'Bi-weekly'
  if (rule.type === 'monthly') return 'Monthly'
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

function buildRecurrenceOccurrenceStart(baseStart: Date, day: Date): string {
  return new Date(Date.UTC(
    day.getUTCFullYear(),
    day.getUTCMonth(),
    day.getUTCDate(),
    baseStart.getUTCHours(),
    baseStart.getUTCMinutes(),
    0,
    0,
  )).toISOString()
}

function isRecurringOccurrenceDate(candidate: Date, baseStart: Date, rule: RecurrenceRule): boolean {
  const dayDiff = Math.floor((toUtcDateParts(candidate) - toUtcDateParts(baseStart)) / DAY_MS)
  if (dayDiff < 0) return false

  if (rule.type === 'weekly' || rule.type === 'biweekly') {
    const interval = rule.type === 'biweekly' ? 14 : 7
    return dayDiff % interval === 0 && getRecurrenceWeekdayIndex(candidate) === getRecurrenceWeekdayIndex(baseStart)
  }

  if (rule.type === 'monthly') {
    const baseMonthDiff = (candidate.getUTCFullYear() - baseStart.getUTCFullYear()) * 12 + (candidate.getUTCMonth() - baseStart.getUTCMonth())
    return candidate.getUTCDate() === baseStart.getUTCDate() && baseMonthDiff % 1 === 0
  }

  if (rule.type !== 'custom') return false

  const interval = rule.interval || 1
  const unit = rule.unit || 'week'
  if (unit === 'day') {
    return dayDiff % interval === 0
  }
  if (unit === 'week') {
    const allowedWeekDays = rule.weekDays && rule.weekDays.length > 0 ? rule.weekDays : [getRecurrenceWeekdayIndex(baseStart)]
    const weekDiff = Math.floor(dayDiff / 7)
    return weekDiff % interval === 0 && allowedWeekDays.includes(getRecurrenceWeekdayIndex(candidate))
  }
  const monthDiff = (candidate.getUTCFullYear() - baseStart.getUTCFullYear()) * 12 + (candidate.getUTCMonth() - baseStart.getUTCMonth())
  return candidate.getUTCDate() === baseStart.getUTCDate() && monthDiff % interval === 0
}

function getRecurringOccurrenceStartsInWeek(event: UserEventRecord, currentWeekStart: Date): string[] {
  const recurrenceRule = event.recurrence_rule
  if (!recurrenceRule || recurrenceRule.type === 'none') return []

  const baseStart = new Date(event.start_time)
  if (Number.isNaN(baseStart.getTime())) return []

  const weekStart = toUtcDateParts(currentWeekStart)
  const weekEnd = toUtcDateParts(addDays(currentWeekStart, 7))
  const endDate = recurrenceRule.endType === 'on' && recurrenceRule.endDate ? new Date(`${recurrenceRule.endDate}T00:00:00Z`) : null
  const exceptionDates = recurrenceRule.exceptions && recurrenceRule.exceptions.length > 0 ? new Set(recurrenceRule.exceptions) : null
  const matchedStarts: string[] = []
  let matchedCount = 0

  const baseDay = toUtcDateParts(baseStart)
  if (weekEnd <= baseDay) {
    return []
  }

  const daysUntilWeekEnd = Math.max(0, Math.floor((weekEnd - baseDay) / DAY_MS))
  const maxOffset = Math.min(RECURRENCE_MAX_LOOKAHEAD_DAYS, daysUntilWeekEnd + 7)

  for (let offset = 0; offset <= maxOffset; offset++) {
    const candidate = addDays(baseStart, offset)
    const candidateDay = toUtcDateParts(candidate)
    if (candidateDay < toUtcDateParts(baseStart)) continue
    if (endDate && candidateDay > toUtcDateParts(endDate)) break
    if (!isRecurringOccurrenceDate(candidate, baseStart, recurrenceRule)) continue

    matchedCount += 1
    if (recurrenceRule.endType === 'after' && recurrenceRule.endCount && matchedCount > recurrenceRule.endCount) {
      break
    }

    if (exceptionDates && exceptionDates.has(getUtcDateKey(candidate))) {
      if (candidateDay >= weekEnd) break
      continue
    }

    if (candidateDay >= weekStart && candidateDay < weekEnd) {
      matchedStarts.push(buildRecurrenceOccurrenceStart(baseStart, candidate))
    }

    if (candidateDay >= weekEnd) {
      break
    }
  }

  return matchedStarts
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

function formatMinuteLabel(minute: number, iana: string, slotMinutes: number): string {
  const safeMinute = Math.min(minute, MINUTES_IN_DAY - slotMinutes)
  const hours = Math.floor(safeMinute / 60)
  const mins = safeMinute % 60
  const utc = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`
  return convertUtcTimeToTimezone(utc, iana)
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

    return {
      syncCalendars: Array.from(syncCalendarMap.values()),
      slotMinutes: isTimeWidth(parsed.slotMinutes) ? parsed.slotMinutes : DEFAULT_SLOT_MINUTES,
      timeBackgrounds,
      collapsedBackgroundIds,
      quickTemplates,
      showQuickTemplatesInMain: resolveShowQuickTemplatesInMain(parsed.showQuickTemplatesInMain),
      quickTemplatesMainExpanded: parsed.quickTemplatesMainExpanded !== false,
      isLeftPanelOpen: parsed.isLeftPanelOpen !== false,
      leftPanelWidthPx,
      expandedSections,
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
  activeModeId: string | null
): TimeItem[] {
  const start = new Date(event.start_time)
  const end = new Date(event.end_time)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return []
  }

  const durationMinutes = Math.max(slotMinutes, Math.round((end.getTime() - start.getTime()) / 60_000))
  const recurrenceRule = normaliseRecurrenceRule(event.recurrence_rule)

  const isActiveManualModeEvent =
    event.source_type === 'manual' &&
    typeof event.source_id === 'string' &&
    Boolean(activeModeId) &&
    (event.source_id === activeModeId || event.source_id === MAIN_SOURCE_ID)

  const baseItemTemplate: Omit<TimeItem, 'id' | 'interactionId' | 'occurrenceStartTime' | 'dayIndex' | 'startMinute' | 'durationMinutes' | 'totalDurationMinutes' | 'isRecurringOccurrence' | 'isStartSegment' | 'isEndSegment'> = {
    sourceEventId: event.id,
    title: event.title || 'Untitled meeting',
    notes: buildEventDraftNotes(event),
    categoryIds: Array.isArray(event.category_ids) ? event.category_ids : [],
    sourceId: isActiveManualModeEvent ? MAIN_SOURCE_ID : (event.source_id || MAIN_SOURCE_ID),
    sourceType: event.source_type,
    recurrenceRule,
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

      if (segmentDayIndex >= 0 && segmentDayIndex <= 6) {
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

  if (recurrenceRule.type === 'none') {
    return buildOccurrenceSegments(event.start_time, event.id, false)
  }

  const occurrenceStarts = getRecurringOccurrenceStartsInWeek(event, currentWeekStart)
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
          <a key={`${index}-${token}`} href={url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline decoration-blue-300 underline-offset-2 hover:decoration-blue-500">
            {label}
          </a>
        )
      } else {
        nodes.push(token)
      }
    } else if (isSafeNoteUrl(token)) {
      nodes.push(
        <a key={`${index}-${token}`} href={token} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline decoration-blue-300 underline-offset-2 hover:decoration-blue-500 break-all">
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

    if (trimmed.startsWith('<details') || trimmed.startsWith(':::details')) {
      const innerLines: string[] = []
      const innerIndices: number[] = []
      let summary = 'Details'
      let mode: 'summary' | 'content' | 'body' = 'body'
      let depth = 1
      let cursor = index + 1

      while (cursor < lines.length) {
        const cursorLine = lines[cursor]
        const cursorTrimmed = cursorLine.trim()

        if (cursorTrimmed.startsWith('<details') || cursorTrimmed.startsWith(':::details')) {
          depth += 1
          innerLines.push(cursorLine)
          innerIndices.push(lineIndices[cursor])
          cursor += 1
          continue
        }

        if (cursorTrimmed === '</details>' || cursorTrimmed === ':::') {
          depth -= 1
          if (depth === 0) {
            break
          }
          innerLines.push(cursorLine)
          innerIndices.push(lineIndices[cursor])
          cursor += 1
          continue
        }

        if (depth === 1 && (cursorTrimmed.startsWith('<summary>') || cursorTrimmed.startsWith(':::detailsSummary'))) {
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
          cursor += 1
          continue
        }

        if (depth === 1 && cursorTrimmed === ':::detailsContent') {
          mode = 'content'
          cursor += 1
          continue
        }

        if (depth === 1 && mode === 'summary') {
          summary = [summary, cursorLine].join('\n').trim() || summary
          cursor += 1
          continue
        }

        innerLines.push(cursorLine)
        innerIndices.push(lineIndices[cursor])
        cursor += 1
      }

      const hasVisibleBody = innerLines.some((line) => line.trim().length > 0)
      nodes.push(
        <details key={`details-${lineIndex}`} className="rounded-lg border border-border bg-muted/20 px-3 py-2">
          <summary className="cursor-pointer list-none font-semibold text-foreground marker:hidden">
            {renderInlineMarkdown(summary)}
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
            className="mt-0.5 h-4 w-4 rounded border-border text-blue-600 focus:ring-blue-500 disabled:cursor-default"
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
      <p key={`paragraph-${lineIndex}`} className="text-sm leading-6 text-foreground whitespace-pre-wrap break-words">
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

interface MarkdownComposerProps {
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
  placeholder: string
  className?: string
  showToolbar?: boolean
  compact?: boolean
}

function MarkdownComposer({
  value,
  onChange,
  readOnly = false,
  placeholder,
  className = '',
  showToolbar = true,
  compact = false,
}: MarkdownComposerProps) {
  const valueRef = useRef<string>('')
  const isApplyingExternalValueRef = useRef(false)
  const [isGuideOpen, setIsGuideOpen] = useState(false)
  const editorSizeClasses = compact
    ? 'min-h-[10rem]'
    : 'h-full min-h-[10rem] sm:min-h-[13rem] overflow-y-auto'

  const handleToolbarMouseDownCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (!target.closest('button')) return

    // Keep the editor selection intact so toolbar actions apply at the active cursor.
    event.preventDefault()
  }, [])

  const collapseAllDetails = useCallback((root: ParentNode) => {
    const detailsNodes = root.querySelectorAll<HTMLElement>("[data-type='details']")
    detailsNodes.forEach((detailsNode) => {
      detailsNode.classList.remove('is-open')
      const detailsContent = detailsNode.querySelector<HTMLElement>("[data-type='detailsContent']")
      if (detailsContent) {
        detailsContent.setAttribute('hidden', 'hidden')
      }
    })
  }, [])

  const countTrailingEmptyParagraphs = useCallback((targetEditor: NonNullable<ReturnType<typeof useEditor>>): number => {
    let trailingEmptyParagraphs = 0
    const { doc } = targetEditor.state

    for (let index = doc.childCount - 1; index >= 0; index -= 1) {
      const node = doc.child(index)
      if (node.type.name !== 'paragraph' || node.content.size > 0) {
        break
      }
      trailingEmptyParagraphs += 1
    }

    return trailingEmptyParagraphs
  }, [])

  const withTrailingParagraphSeparators = useCallback((markdown: string, trailingEmptyParagraphs: number): string => {
    if (trailingEmptyParagraphs <= 0) return markdown
    const withoutTrailingNewlines = markdown.replace(/\n+$/g, '')
    return `${withoutTrailingNewlines}${'\n\n'.repeat(trailingEmptyParagraphs)}`
  }, [])

  const syncMarkdownFromEditor = useCallback((targetEditor: NonNullable<ReturnType<typeof useEditor>>) => {
    if (isApplyingExternalValueRef.current) return

    const markdown = withTrailingParagraphSeparators(
      targetEditor.getMarkdown(),
      countTrailingEmptyParagraphs(targetEditor)
    )

    if (markdown !== valueRef.current) {
      valueRef.current = markdown
      onChange(markdown)
    }
  }, [countTrailingEmptyParagraphs, onChange, withTrailingParagraphSeparators])

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      (() => {
        const markdownExtension = Markdown as typeof Markdown & {
          configure?: (options: { markedOptions?: { breaks?: boolean } }) => typeof Markdown
        }

        if (typeof markdownExtension.configure === 'function') {
          return markdownExtension.configure({
            markedOptions: {
              breaks: true,
            },
          })
        }

        return Markdown
      })(),
      StarterKit.configure({
        codeBlock: {
          HTMLAttributes: {
            class: 'rounded-lg border border-border bg-muted/40 p-3 text-xs text-foreground',
          },
        },
      }),
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === 'detailsSummary') return 'Spoiler title'
          if (node.type.name === 'detailsContent') return 'Hidden content'
          return placeholder
        },
        includeChildren: true,
        showOnlyCurrent: false,
      }),
      Details.configure({
        persist: false,
        renderToggleButton: ({ element, isOpen }) => {
          element.dataset.detailsToggle = 'true'
          element.setAttribute(
            'aria-label',
            isOpen ? 'Collapse details content' : 'Expand details content',
          )
          element.style.position = 'absolute'
          element.style.inset = '0 auto auto 0'
          element.style.width = '100%'
          element.style.height = '2.45rem'
          element.style.opacity = '0'
          element.style.display = 'block'
          element.style.zIndex = '2'
          element.style.cursor = 'pointer'
          element.style.background = 'transparent'
          element.style.border = '0'
          element.style.padding = '0'

          element.onmousedown = (event) => {
            event.preventDefault()
          }

          element.onclick = () => {
            window.requestAnimationFrame(() => {
              const currentEditor = editor
              if (!currentEditor) return

              const detailsNode = element.closest<HTMLElement>("[data-type='details']")
              const summaryElement = detailsNode?.querySelector<HTMLElement>('summary')
              if (!summaryElement) return

              const summaryPos = currentEditor.view.posAtDOM(summaryElement, 0) + 1
              currentEditor.chain().focus().setTextSelection(summaryPos).run()
            })
          }
        },
      }),
      DetailsSummary,
      DetailsContent,
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Extension.create({
        name: 'markdownTypingShortcuts',
        addInputRules() {
          const editor = this.editor
          const orderedListType = editor.schema.nodes.orderedList

          const rules: InputRule[] = []

          if (orderedListType) {
            rules.push(
              wrappingInputRule({
                find: /^1\.$/,
                type: orderedListType,
              })
            )
          }

          rules.push(
            new InputRule({
              find: /^<$/,
              handler: ({ state, range }) => {
                const detailsType = editor.schema.nodes.details
                const summaryType = editor.schema.nodes.detailsSummary
                const contentType = editor.schema.nodes.detailsContent
                const paragraphType = editor.schema.nodes.paragraph
                if (!detailsType || !summaryType || !contentType || !paragraphType) return
                const $from = state.tr.doc.resolve(range.from)
                const parentDepth = $from.depth
                if (parentDepth < 1) return

                const detailsNode = detailsType.create({ open: true }, [
                  summaryType.create(),
                  contentType.create(null, paragraphType.create()),
                ])

                const before = $from.before(parentDepth)
                const after = $from.after(parentDepth)
                state.tr.replaceRangeWith(before, after, detailsNode)

                window.requestAnimationFrame(() => {
                  let summaryCaretPos: number | null = null
                  editor.state.doc.descendants((node, pos) => {
                    if (node.type.name !== 'detailsSummary') return
                    summaryCaretPos = pos + 1
                  })
                  if (summaryCaretPos !== null) {
                    editor.chain().focus().setTextSelection(summaryCaretPos).run()
                  }

                  const detailsNodes = editor.view.dom.querySelectorAll<HTMLElement>("[data-type='details']")
                  const currentDetails = detailsNodes.item(detailsNodes.length - 1)
                  if (!currentDetails) return
                  const content = currentDetails.querySelector<HTMLElement>("[data-type='detailsContent']")
                  if (!content || !content.hasAttribute('hidden')) return
                  const toggleButton = currentDetails.querySelector<HTMLButtonElement>('button')
                  toggleButton?.click()
                })
              },
            })
          )

          return rules
        },
        addKeyboardShortcuts() {
          return {
            '-': () => {
              const { state } = this.editor
              const { empty, $from } = state.selection
              if (!empty || !$from.parent.isTextblock) return false

              const textBefore = $from.parent.textBetween(0, $from.parentOffset, '', '')
              const textAfter = $from.parent.textBetween($from.parentOffset, $from.parent.content.size, '', '')
              const linePrefix = textBefore.split('\n').pop() ?? textBefore
              const lineSuffix = textAfter.split('\n')[0] ?? textAfter

              if (linePrefix.trim().length > 0) return false
              if (lineSuffix.trim().length > 0) return false

              return this.editor.chain().focus().toggleBulletList().run()
            },
            Enter: () => {
              const { state } = this.editor
              const { empty, $from } = state.selection
              if (!empty || !$from.parent.isTextblock) return false

              if (this.editor.isActive('detailsContent')) {
                if ($from.parent.content.size !== 0) return false
                let detailsContentDepth = -1
                for (let depth = $from.depth; depth > 0; depth -= 1) {
                  if ($from.node(depth).type.name === 'detailsContent') {
                    detailsContentDepth = depth
                    break
                  }
                }
                if (detailsContentDepth < 1) return false
                const detailsContentNode = $from.node(detailsContentDepth)
                const indexInContent = $from.index(detailsContentDepth)
                // Only exit when all trailing siblings are also empty (so we don't lose user content).
                for (let i = indexInContent + 1; i < detailsContentNode.childCount; i += 1) {
                  if (detailsContentNode.child(i).content.size > 0) return false
                }
                const detailsDepth = detailsContentDepth - 1
                const paragraphType = state.schema.nodes.paragraph
                if (!paragraphType) return false

                const cursorParaStart = $from.before()
                const detailsContentEnd = $from.end(detailsContentDepth)
                const afterDetailsBefore = $from.after(detailsDepth)
                const isOnlyChild = detailsContentNode.childCount === 1

                let caretPos = 0
                const ok = this.editor.commands.command(({ tr, dispatch }) => {
                  if (!isOnlyChild) {
                    tr.delete(cursorParaStart, detailsContentEnd)
                  }
                  const afterDetails = tr.mapping.map(afterDetailsBefore)
                  tr.insert(afterDetails, paragraphType.create())
                  caretPos = afterDetails + 1
                  if (dispatch) dispatch(tr)
                  return true
                })
                if (!ok) return false
                this.editor.chain().setTextSelection(caretPos).focus().scrollIntoView().run()
                return true
              }

              // Handle bulletList exit on empty list item
              if (this.editor.isActive('bulletList')) {
                const textBefore = $from.parent.textBetween(0, $from.parentOffset, '', '')
                const textAfter = $from.parent.textBetween($from.parentOffset, $from.parent.content.size, '', '')
                const currentLineText = `${textBefore}${textAfter}`.trim()
                if (currentLineText.length > 0) return false

                let listItemDepth = -1
                for (let depth = $from.depth; depth > 0; depth -= 1) {
                  if ($from.node(depth).type.name === 'listItem') {
                    listItemDepth = depth
                    break
                  }
                }

                if (listItemDepth > 0) {
                  const bulletListDepth = listItemDepth - 1
                  const bulletListNode = $from.node(bulletListDepth)
                  const listItemIndex = $from.index(bulletListDepth)
                  const isLastListItem = listItemIndex === bulletListNode.childCount - 1

                  if (isLastListItem) {
                    const listItemStart = $from.before(listItemDepth)
                    const listItemEnd = $from.after(listItemDepth)
                    const afterBulletListBefore = $from.after(bulletListDepth)
                    const paragraphType = state.schema.nodes.paragraph

                    let caretPos = 0
                    const exited = this.editor.commands.command(({ tr, dispatch }) => {
                      tr.delete(listItemStart, listItemEnd)
                      const afterBulletList = tr.mapping.map(afterBulletListBefore)
                      tr.insert(afterBulletList, paragraphType.create())
                      caretPos = afterBulletList + 1
                      if (dispatch) dispatch(tr)
                      return true
                    })

                    if (exited) {
                      this.editor.chain().focus().setTextSelection(caretPos).scrollIntoView().run()
                      return true
                    }
                  }
                }

                const lifted = this.editor.chain().focus().liftListItem('listItem').run()
                if (lifted) return true
                return this.editor.chain().focus().splitListItem('listItem').run()
              }

              // Handle orderedList exit on empty list item
              if (this.editor.isActive('orderedList')) {
                const textBefore = $from.parent.textBetween(0, $from.parentOffset, '', '')
                const textAfter = $from.parent.textBetween($from.parentOffset, $from.parent.content.size, '', '')
                const currentLineText = `${textBefore}${textAfter}`.trim()
                if (currentLineText.length > 0) return false

                let listItemDepth = -1
                for (let depth = $from.depth; depth > 0; depth -= 1) {
                  if ($from.node(depth).type.name === 'listItem') {
                    listItemDepth = depth
                    break
                  }
                }

                if (listItemDepth > 0) {
                  const orderedListDepth = listItemDepth - 1
                  const orderedListNode = $from.node(orderedListDepth)
                  const listItemIndex = $from.index(orderedListDepth)
                  const isLastListItem = listItemIndex === orderedListNode.childCount - 1

                  if (isLastListItem) {
                    const listItemStart = $from.before(listItemDepth)
                    const listItemEnd = $from.after(listItemDepth)
                    const afterOrderedListBefore = $from.after(orderedListDepth)
                    const paragraphType = state.schema.nodes.paragraph

                    let caretPos = 0
                    const exited = this.editor.commands.command(({ tr, dispatch }) => {
                      tr.delete(listItemStart, listItemEnd)
                      const afterOrderedList = tr.mapping.map(afterOrderedListBefore)
                      tr.insert(afterOrderedList, paragraphType.create())
                      caretPos = afterOrderedList + 1
                      if (dispatch) dispatch(tr)
                      return true
                    })

                    if (exited) {
                      this.editor.chain().focus().setTextSelection(caretPos).scrollIntoView().run()
                      return true
                    }
                  }
                }

                const lifted = this.editor.chain().focus().liftListItem('listItem').run()
                if (lifted) return true
                return this.editor.chain().focus().splitListItem('listItem').run()
              }

              if (!this.editor.isActive('taskList')) return false

              const textBefore = $from.parent.textBetween(0, $from.parentOffset, '', '')
              const textAfter = $from.parent.textBetween($from.parentOffset, $from.parent.content.size, '', '')
              const currentLineText = `${textBefore}${textAfter}`.trim()
              if (currentLineText.length > 0) return false

              let taskItemDepth = -1
              for (let depth = $from.depth; depth > 0; depth -= 1) {
                if ($from.node(depth).type.name === 'taskItem') {
                  taskItemDepth = depth
                  break
                }
              }

              if (taskItemDepth > 0) {
                const taskListDepth = taskItemDepth - 1
                const taskListNode = $from.node(taskListDepth)
                const taskItemIndex = $from.index(taskListDepth)
                const isLastTaskItem = taskItemIndex === taskListNode.childCount - 1
                const paragraphType = state.schema.nodes.paragraph

                if (isLastTaskItem && paragraphType) {
                  const taskItemStart = $from.before(taskItemDepth)
                  const taskItemEnd = $from.after(taskItemDepth)
                  const afterTaskListBefore = $from.after(taskListDepth)

                  let caretPos = 0
                  const exited = this.editor.commands.command(({ tr, dispatch }) => {
                    tr.delete(taskItemStart, taskItemEnd)
                    const afterTaskList = tr.mapping.map(afterTaskListBefore)
                    tr.insert(afterTaskList, paragraphType.create())
                    caretPos = afterTaskList + 1
                    if (dispatch) dispatch(tr)
                    return true
                  })

                  if (exited) {
                    this.editor.chain().focus().setTextSelection(caretPos).scrollIntoView().run()
                    return true
                  }
                }
              }

              const lifted = this.editor.chain().focus().liftListItem('taskItem').run()
              if (lifted) return true

              return this.editor.chain().focus().splitListItem('taskItem').run()
            },
            ']': () => {
              const { state } = this.editor
              const { from, empty, $from } = state.selection
              if (!empty || !$from.parent.isTextblock) return false

              const textBefore = $from.parent.textBetween(0, $from.parentOffset, '', '')

              if (textBefore === '[' && from >= 1) {
                return this.editor.chain().focus().deleteRange({ from: from - 1, to: from }).toggleTaskList().run()
              }

              if (/^\[[xX]$/.test(textBefore) && from >= 2) {
                return this.editor
                  .chain()
                  .focus()
                  .deleteRange({ from: from - 2, to: from })
                  .toggleTaskList()
                  .updateAttributes('taskItem', { checked: true })
                  .run()
              }

              return false
            },
            Space: () => {
              const { state } = this.editor
              const { from, empty, $from } = state.selection
              if (!empty || !$from.parent.isTextblock) return false

              const textBefore = $from.parent.textBetween(0, $from.parentOffset, '', '')
              const textAfter = $from.parent.textBetween($from.parentOffset, $from.parent.content.size, '', '')
              const linePrefix = textBefore.split('\n').pop() ?? textBefore
              const lineSuffix = textAfter.split('\n')[0] ?? textAfter
              const isAtStartToken = lineSuffix.trim().length === 0
              if (!isAtStartToken) return false

              if ((linePrefix === '-' || linePrefix === '- ') && from >= linePrefix.length) {
                return this.editor
                  .chain()
                  .focus()
                  .deleteRange({ from: from - linePrefix.length, to: from })
                  .toggleBulletList()
                  .run()
              }

              if ((linePrefix === '1.' || linePrefix === '1. ') && from >= linePrefix.length) {
                return this.editor
                  .chain()
                  .focus()
                  .deleteRange({ from: from - linePrefix.length, to: from })
                  .toggleOrderedList()
                  .run()
              }

              if ((linePrefix === '[]' || linePrefix === '[] ') && from >= linePrefix.length) {
                return this.editor
                  .chain()
                  .focus()
                  .deleteRange({ from: from - linePrefix.length, to: from })
                  .toggleTaskList()
                  .run()
              }

              if ((/^\[[xX]\]$/.test(linePrefix) || /^\[[xX]\]\s$/.test(linePrefix)) && from >= linePrefix.length) {
                return this.editor
                  .chain()
                  .focus()
                  .deleteRange({ from: from - linePrefix.length, to: from })
                  .toggleTaskList()
                  .updateAttributes('taskItem', { checked: true })
                  .run()
              }

              return false
            },
          }
        },
      }),
    ],
    // Start empty; the effect below loads the value as MARKDOWN via setContent.
    // Passing `content: value` directly here would parse it as HTML and show
    // the markdown source as literal text.
    content: '',
    editable: !readOnly,
    onUpdate: ({ editor: nextEditor }) => {
      // TipTap may normalize markdown when content is loaded from storage.
      // Ignore those unfocused updates so reloads do not rewrite notes.
      if (!nextEditor.isFocused) return

      syncMarkdownFromEditor(nextEditor)
    },
    onTransaction: ({ editor: nextEditor, transaction }) => {
      if (!transaction.docChanged) return

      // Checkbox toggles and similar click-driven changes can update the
      // document while focus is transient. Treat these as user edits so dirty
      // state and auto-save start immediately.
      const hasUiEvent = Boolean(transaction.getMeta('uiEvent'))
      if (!nextEditor.isFocused && !hasUiEvent) return

      syncMarkdownFromEditor(nextEditor)
    },
    editorProps: {
      attributes: {
        class:
          `tiptap markdown-editor w-full rounded-md border border-border bg-background px-2.5 py-2 text-xs leading-5 text-foreground outline-none focus:ring-0 ${editorSizeClasses}`,
      },
    },
  })

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!readOnly)
  }, [editor, readOnly])

  useEffect(() => {
    if (!editor) return

    const frame = window.requestAnimationFrame(() => {
      collapseAllDetails(editor.view.dom)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [editor, collapseAllDetails])

  useEffect(() => {
    if (!editor) return
    if (value === valueRef.current) return

    const nextMarkdown = withTrailingParagraphSeparators(
      editor.getMarkdown(),
      countTrailingEmptyParagraphs(editor)
    )
    if (nextMarkdown === value) {
      valueRef.current = value
      return
    }

    isApplyingExternalValueRef.current = true
    try {
      editor.commands.setContent(value, { contentType: 'markdown' })
    } finally {
      isApplyingExternalValueRef.current = false
    }
    valueRef.current = value
  }, [countTrailingEmptyParagraphs, editor, value, withTrailingParagraphSeparators])

  const focusDetailsSummaryAtOrAfter = useCallback((targetPos: number) => {
    if (!editor) return

    let summaryCaretPos: number | null = null
    editor.state.doc.descendants((node, pos) => {
      if (summaryCaretPos !== null) return false
      if (node.type.name !== 'detailsSummary' || pos < targetPos) return true
      summaryCaretPos = pos + 1
      return false
    })

    if (summaryCaretPos !== null) {
      editor.chain().focus().setTextSelection(summaryCaretPos).run()
    }
  }, [editor])

  const focusTaskItemAtOrAfter = useCallback((targetPos: number) => {
    if (!editor) return

    let taskItemCaretPos: number | null = null
    editor.state.doc.descendants((node, pos) => {
      if (taskItemCaretPos !== null) return false
      if (node.type.name !== 'taskItem' || pos < targetPos) return true

      const paragraph = node.firstChild
      if (!paragraph) return false

      taskItemCaretPos = pos + 2 + paragraph.content.size
      return false
    })

    if (taskItemCaretPos !== null) {
      editor.chain().focus().setTextSelection(taskItemCaretPos).run()
    }
  }, [editor])

  const setHeading = useCallback((level: 1 | 2 | 3) => {
    editor?.chain().focus().toggleHeading({ level }).run()
  }, [editor])

  const wrapWithDetails = useCallback(() => {
    if (!editor) return
    const insertPos = editor.state.selection.from

    editor
      .chain()
      .focus()
      .insertContent({
        type: 'details',
        attrs: {
          open: true,
        },
        content: [
          {
            type: 'detailsSummary',
          },
          {
            type: 'detailsContent',
            content: [{ type: 'paragraph' }],
          },
        ],
      })
      .run()

    focusDetailsSummaryAtOrAfter(insertPos)

    // New collapse blocks should open immediately in the active editor so users can type hidden content.
    window.requestAnimationFrame(() => {
      const detailsNodes = editor.view.dom.querySelectorAll<HTMLElement>("[data-type='details']")
      const currentDetails = detailsNodes.item(detailsNodes.length - 1)
      if (!currentDetails) return

      const content = currentDetails.querySelector<HTMLElement>("[data-type='detailsContent']")
      if (!content || !content.hasAttribute('hidden')) return

      const toggleButton = currentDetails.querySelector<HTMLButtonElement>('button')
      toggleButton?.click()
    })
  }, [editor, focusDetailsSummaryAtOrAfter])

  const toggleTaskList = useCallback(() => {
    if (!editor) return

    if (editor.isActive('taskList')) {
      editor.chain().focus().splitListItem('taskItem').run()
      return
    }

    const insertPos = editor.state.selection.from

    editor.chain().focus().toggleTaskList().run()

    focusTaskItemAtOrAfter(insertPos)
  }, [editor, focusTaskItemAtOrAfter])

  const toggleBulletList = useCallback(() => {
    editor?.chain().focus().toggleBulletList().run()
  }, [editor])

  const toggleOrderedList = useCallback(() => {
    editor?.chain().focus().toggleOrderedList().run()
  }, [editor])

  const toggleBold = useCallback(() => {
    editor?.chain().focus().toggleBold().run()
  }, [editor])

  const toggleItalic = useCallback(() => {
    editor?.chain().focus().toggleItalic().run()
  }, [editor])

  const toggleCode = useCallback(() => {
    editor?.chain().focus().toggleCode().run()
  }, [editor])

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      {showToolbar && !readOnly && (
        <div className="mb-2 space-y-2 text-[11px]" onMouseDownCapture={handleToolbarMouseDownCapture}>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIsGuideOpen((prev) => !prev)}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 font-semibold transition-colors ${
                isGuideOpen
                  ? 'border-blue-400/70 bg-blue-600 text-white hover:bg-blue-500'
                  : 'border-blue-400/70 bg-background text-blue-700 hover:bg-blue-50 dark:text-blue-200 dark:hover:bg-blue-950/40'
              }`}
              title={isGuideOpen ? 'Hide formatting guide' : 'Show formatting guide'}
            >
              <BookOpen className="h-3.5 w-3.5" />
              Guiding
            </button>

            <div className="inline-flex flex-wrap items-center gap-1 rounded-md border border-border bg-muted/40 p-1">
              <button type="button" onClick={toggleBold} className="rounded-md border border-border bg-background px-2 py-1 font-semibold text-foreground hover:bg-muted">B</button>
              <button type="button" onClick={toggleItalic} className="rounded-md border border-border bg-background px-2 py-1 italic text-foreground hover:bg-muted">I</button>
              <button type="button" onClick={() => setHeading(1)} className="rounded-md border border-border bg-background px-2 py-1 font-semibold text-foreground hover:bg-muted">H1</button>
              <button type="button" onClick={() => setHeading(2)} className="rounded-md border border-border bg-background px-2 py-1 font-semibold text-foreground hover:bg-muted">H2</button>
              <button type="button" onClick={() => setHeading(3)} className="rounded-md border border-border bg-background px-2 py-1 font-semibold text-foreground hover:bg-muted">H3</button>
            </div>

            <div className="inline-flex flex-wrap items-center gap-1 rounded-md border border-border bg-muted/40 p-1">
              <button type="button" onClick={toggleBulletList} className="rounded-md border border-border bg-background px-2 py-1 text-foreground hover:bg-muted">List</button>
              <button type="button" onClick={toggleOrderedList} className="rounded-md border border-border bg-background px-2 py-1 text-foreground hover:bg-muted">1.</button>
              <button type="button" onClick={toggleTaskList} className="rounded-md border border-border bg-background px-2 py-1 text-foreground hover:bg-muted">Checkbox</button>
            </div>

            <div className="inline-flex flex-wrap items-center gap-1 rounded-md border border-border bg-muted/40 p-1">
              <button type="button" onClick={wrapWithDetails} className="rounded-md border border-border bg-background px-2 py-1 text-foreground hover:bg-muted">Collapse</button>
              <button type="button" onClick={toggleCode} className="rounded-md border border-border bg-background px-2 py-1 font-mono text-foreground hover:bg-muted">Code</button>
            </div>
          </div>

          {isGuideOpen && (
            <div className="rounded-md border border-blue-200/70 bg-blue-50/80 p-2 text-xs text-blue-900 dark:border-blue-900/70 dark:bg-blue-950/30 dark:text-blue-100">
              <div className="grid gap-2 md:grid-cols-3">
                <div className="rounded-md border border-blue-200/70 bg-background/70 p-2 dark:border-blue-900/70">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Text styles</p>
                  <p className="text-[11px] leading-5 text-foreground">Highlight words and add heading levels.</p>
                  <pre className="mt-1 overflow-x-auto rounded border border-border bg-muted/40 p-1.5 text-[11px] leading-4 text-foreground"><code>{`# Weekly priorities\n## Meetings\n### Follow ups\n**Owner:** Alex\n*Optional note*`}</code></pre>
                </div>

                <div className="rounded-md border border-blue-200/70 bg-background/70 p-2 dark:border-blue-900/70">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Lists and checkboxes</p>
                  <p className="text-[11px] leading-5 text-foreground">Create bullets, ordered steps, and quick task markers.</p>
                  <pre className="mt-1 overflow-x-auto rounded border border-border bg-muted/40 p-1.5 text-[11px] leading-4 text-foreground"><code>{`- Draft agenda\n- Share pre-read\n1. Confirm attendees\n2. Book room\n[] Send reminder\n[x] Attach notes`}</code></pre>
                </div>

                <div className="rounded-md border border-blue-200/70 bg-background/70 p-2 dark:border-blue-900/70">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Collapse and code</p>
                  <p className="text-[11px] leading-5 text-foreground">Press <code className="rounded bg-muted/60 px-1">&lt;</code> on an empty line to start a collapse block, then type the summary. Wrap commands in backticks.</p>
                  <pre className="mt-1 overflow-x-auto rounded border border-border bg-muted/40 p-1.5 text-[11px] leading-4 text-foreground"><code>{`<details>\n<summary>Release notes</summary>\nHotfix window: 18:00\n</details>\n\n\`pnpm test:web\``}</code></pre>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className={compact ? '' : 'min-h-0 flex-1'}>
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}

interface NoteEditorModalProps {
  open: boolean
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
  children?: ReactNode
  autoFocusTitle?: boolean
  onAutoFocusComplete?: () => void
}

function NoteEditorModal({
  open,
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
  children,
  autoFocusTitle = false,
  onAutoFocusComplete,
}: NoteEditorModalProps) {
  const modalShellRef = useRef<HTMLDivElement | null>(null)
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const isBackdropPressActiveRef = useRef(false)

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }

    // Capture-phase listener ensures Esc closes the modal even if another
    // global listener prevents default during bubble phase.
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose, open])

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

  if (!open) return null

  const modalContent = (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/55 p-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-[calc(env(safe-area-inset-bottom)+0.5rem)] backdrop-blur-sm sm:items-center sm:p-3"
      onMouseDown={handleBackdropMouseDown}
      onMouseUp={handleBackdropMouseUp}
    >
      <div
        ref={modalShellRef}
        tabIndex={-1}
        className="flex h-auto max-h-full w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <Maximize2 className="h-4 w-4 text-blue-600" />
              <h2 className="text-base font-semibold text-foreground">{title}</h2>
            </div>
            {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <div
              className={`w-[10.75rem] shrink-0 overflow-hidden transition-[opacity,transform] [transition-duration:900ms] ease-out sm:w-[15.75rem] ${
                shouldRenderSaveButton ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-6 opacity-0'
              }`}
            >
              <button
                type="button"
                onClick={() => { void handleSaveClick() }}
                disabled={saveDisabled || !onSave || isSavedState}
                className={`flex h-9 w-full items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-white transition-colors sm:h-10 sm:gap-2 sm:px-3 sm:text-sm disabled:cursor-not-allowed disabled:opacity-90 ${
                  saveState === 'autosaving'
                    ? 'bg-blue-600 hover:bg-blue-700'
                    : isSavedState
                      ? 'bg-emerald-600 hover:bg-emerald-600'
                      : saveState === 'error'
                        ? 'bg-red-600 hover:bg-red-700'
                        : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {saveState === 'autosaving' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isSavedState ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : saveState === 'error' ? (
                  <AlertTriangle className="h-4 w-4 animate-pulse" />
                ) : saveState === 'dirty' ? (
                  <Clock3 className="h-4 w-4 animate-pulse" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                <span className="min-w-0 flex-1 overflow-hidden text-left leading-tight">
                  <span className="block truncate">{saveState === 'autosaving' ? 'Saving...' : isSavedState ? 'Saved' : saveState === 'error' ? 'Retry save' : saveLabel}</span>
                  {saveMetaLabel && <span className="block truncate text-[10px] text-blue-100/90">{saveMetaLabel}</span>}
                </span>
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="h-9 min-w-[4.75rem] rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground sm:h-10 sm:min-w-[5.25rem]"
            >
              {closeLabel}
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-4 py-4">
          {beforeTitleContent}

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
          {children}
          <MarkdownComposer
            value={value}
            onChange={onChange}
            readOnly={readOnly}
            placeholder="Write notes, paste documents, and organize them with markdown."
            className="min-h-0 flex-1"
            showToolbar={!readOnly}
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
}

function RecurrenceEndOptions({ rule, updateRule, readOnly = false }: RecurrenceEndOptionsProps) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Ends</label>
      <div className="grid grid-cols-3 gap-1.5">
        {(['never', 'on', 'after'] as RecurrenceEndType[]).map((endType) => (
          <button
            key={endType}
            type="button"
            disabled={readOnly}
            onClick={() => updateRule({ endType })}
            className={`rounded-md border px-1.5 py-1 text-[11px] transition-colors ${
              (rule.endType || 'never') === endType
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-foreground hover:bg-muted'
            } ${readOnly ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            {endType === 'never' ? 'Never' : endType === 'on' ? 'On date' : 'After #'}
          </button>
        ))}
      </div>

      {(rule.endType || 'never') === 'on' && (
        <div className="mt-2">
          <input
            type="date"
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
}

function RecurrenceEditor({ value, onChange, expanded, onExpandedChange, dateSeed, readOnly = false, compact = false }: RecurrenceEditorProps) {
  const updateRule = (patch: Partial<RecurrenceRule>) => onChange({ ...value, ...patch })
  const seedDate = new Date(dateSeed)

  return (
    <div className={`overflow-hidden rounded-lg border border-border ${compact ? 'bg-background' : 'bg-card'}`}>
      <button
        type="button"
        onClick={() => onExpandedChange(!expanded)}
        className="flex w-full items-center justify-between gap-2 bg-muted/50 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
      >
        <span className="flex items-center gap-1.5">
          <Repeat2 className="h-3.5 w-3.5 text-muted-foreground" />
          Recurrence
          {value.type !== 'none' && (
            <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900 dark:text-blue-300">
              {formatRecurrenceSummary(value)}
            </span>
          )}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="space-y-3 p-3">
          <div className="grid grid-cols-3 gap-1">
            {(['none', 'weekly', 'biweekly', 'monthly', 'custom'] as RecurrenceType[]).map((type) => (
              <button
                key={type}
                type="button"
                disabled={readOnly}
                onClick={() => {
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
                  }
                  onChange(nextRule)
                }}
                className={`rounded-md border px-1.5 py-1 text-[11px] transition-colors ${
                  value.type === type
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-foreground hover:bg-muted'
                } ${readOnly ? 'cursor-not-allowed opacity-60' : ''}`}
              >
                {type === 'none' ? 'None' : type === 'weekly' ? 'Weekly' : type === 'biweekly' ? 'Bi-wkly' : type === 'monthly' ? 'Monthly' : 'Custom'}
              </button>
            ))}
          </div>

          {value.type === 'custom' && (
            <div className="space-y-2 border-t border-border pt-2">
              <div className="flex items-center gap-1.5">
                <span className="whitespace-nowrap text-[11px] text-muted-foreground">Every</span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={value.interval || 1}
                  disabled={readOnly}
                  onChange={(event) => updateRule({ interval: Math.max(1, Number.parseInt(event.target.value, 10) || 1) })}
                  className="w-12 rounded-md border border-border bg-background px-1 py-0.5 text-center text-[11px] text-foreground"
                />
                <select
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
                        <button
                          key={`${label}-${index}`}
                          type="button"
                          disabled={readOnly}
                          title={['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][index]}
                          onClick={() => {
                            const current = value.weekDays || []
                            const next = selected ? current.filter((entry) => entry !== index) : [...current, index].sort((a, b) => a - b)
                            updateRule({ weekDays: next.length > 0 ? next : [index] })
                          }}
                          className={`h-7 w-7 rounded-full border text-[10px] font-medium transition-colors ${
                            selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground hover:bg-muted'
                          } ${readOnly ? 'cursor-not-allowed opacity-60' : ''}`}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          <RecurrenceEndOptions rule={value} updateRule={updateRule} readOnly={readOnly} />
        </div>
      )}
    </div>
  )
}

export default function TimeManagementPage() {
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
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(() => persistedPreferences?.isLeftPanelOpen ?? true)
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
  const [selectionDraft, setSelectionDraft] = useState<SelectionDraft | null>(null)
  const [isSelectionAdjusterExpanded, setIsSelectionAdjusterExpanded] = useState(false)
  const [selectionAdjustStepSlots, setSelectionAdjustStepSlots] = useState(1)
  const [isItemAdjusterExpanded, setIsItemAdjusterExpanded] = useState(false)
  const [itemAdjustStepSlots, setItemAdjustStepSlots] = useState(1)
  const [selectionLastChangedEdge, setSelectionLastChangedEdge] = useState<'start' | 'end' | null>(null)
  const [itemLastChangedEdge, setItemLastChangedEdge] = useState<'start' | 'end' | null>(null)
  const [isHiddenModeEnabled, setIsHiddenModeEnabled] = useState(false)
  const [isSelecting, setIsSelecting] = useState(false)
  const [isDraggingItem, setIsDraggingItem] = useState(false)
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null)
  const [dragDropPreview, setDragDropPreview] = useState<DragDropPreviewState | null>(null)
  const [resizeState, setResizeState] = useState<ResizeState | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [showItemRecurrencePanel, setShowItemRecurrencePanel] = useState(false)
  const [movingItemId, setMovingItemId] = useState<string | null>(null)
  // Snapshot of the item captured when a move (cut) starts. The week-scoped
  // `items` array only contains items for the visible week, so after the user
  // navigates to another week the moving item disappears from `items`. Keeping
  // a snapshot lets the move complete (and remove the original) across weeks.
  const [movingItemSnapshot, setMovingItemSnapshot] = useState<TimeItem | null>(null)
  const [isMoveScopeOpen, setIsMoveScopeOpen] = useState(false)
  const [events, setEvents] = useState<UserEventRecord[]>([])
  const [isSourcesLoading, setIsSourcesLoading] = useState(false)
  const [isEventsLoading, setIsEventsLoading] = useState(false)
  const [isExternalSyncing, setIsExternalSyncing] = useState(false)
  const [eventsError, setEventsError] = useState<string | null>(null)
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
    setCurrentWeekStart(() => startOfWeek(today, { weekStartsOn: 1 }))
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
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [pendingUnsavedAction, setPendingUnsavedAction] = useState<PendingUnsavedAction | null>(null)
  const [pendingUnsavedAnchor, setPendingUnsavedAnchor] = useState<PendingUnsavedAnchor | null>(null)
  const [isPendingUnsavedActionSaving, setIsPendingUnsavedActionSaving] = useState(false)
  const [calendarItemContextMenu, setCalendarItemContextMenu] = useState<{
    itemId: string
    x: number
    y: number
    isReadOnly: boolean
  } | null>(null)
  const [contextMenuDeleteConfirmOpen, setContextMenuDeleteConfirmOpen] = useState(false)
  const [contextMenuCategorySubmenuOpen, setContextMenuCategorySubmenuOpen] = useState(false)
  const calendarItemContextMenuRef = useRef<HTMLDivElement | null>(null)
  const modeJsonCopyFeedbackTimerRef = useRef<number | null>(null)
  const modeNameSaveFeedbackTimerRef = useRef<number | null>(null)
  const modeNameNoChangePulseTimerRef = useRef<number | null>(null)
  const highlightedModeTimerRef = useRef<number | null>(null)
  const modeNameInputHighlightTimerRef = useRef<number | null>(null)
  const modeNameInputRef = useRef<HTMLInputElement | null>(null)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ left: number; top: number } | null>(null)
  const [selectionPasteContextMenu, setSelectionPasteContextMenu] = useState<{ x: number; y: number } | null>(null)
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
  const isDesktopLayout = layoutMode === 'desktop'
  const showDesktopLeftPanel = !isPhoneLayout && isLeftPanelOpen
  const showMobileToolsOverlay = isPhoneLayout && mobileSurface === 'tools'
  const showMobileQuickObjectsOverlay = isPhoneLayout && mobileSurface === 'quickObjects'
  const isToolsSurfaceVisible = showDesktopLeftPanel || showMobileToolsOverlay || showMobileQuickObjectsOverlay
  const showMainQuickTemplates = showQuickTemplatesInMain && !showMobileQuickObjectsOverlay

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
  const collapseLeftPanelSections = useCallback(() => {
    setExpandedSections(new Set())
  }, [])
  const reopenLeftPanelCollapsed = useCallback(() => {
    setIsLeftPanelOpen(true)
    setExpandedSections(new Set())
    if (isPhoneLayout) {
      setMobileSurface('tools')
    }
  }, [isPhoneLayout])
  const titleTypingHintTimeoutRef = useRef<number | null>(null)
  const descriptionHintTimeoutRef = useRef<number | null>(null)
  const selectionChangePulseTimeoutRef = useRef<number | null>(null)
  const itemChangePulseTimeoutRef = useRef<number | null>(null)
  const selectionTitleInputRef = useRef<HTMLInputElement | null>(null)
  const isCreatingItemRef = useRef(false)
  const eventsRef = useRef<UserEventRecord[]>([])
  const dragClientYRef = useRef<number | null>(null)
  const dragPreviewRef = useRef<HTMLDivElement | null>(null)
  const currentWeekStartRef = useRef(currentWeekStart)
  const weekWindowCacheRef = useRef(new Map<string, WeekWindowCacheEntry>())
  const weekWindowRequestsRef = useRef(new Map<string, Promise<UserEventRecord[]>>())
  const crossTabRefreshTimerRef = useRef<number | null>(null)
  // Unique per-tab id so this tab can ignore the sync pings it broadcasts itself.
  // Without this, the tab's own state-change broadcast would trigger a silent
  // refetch that overwrites optimistic/in-progress edits, causing a visible
  // backtrack render (the item briefly reverts to server state, then updates).
  const syncTabIdRef = useRef<string>(`tab-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`)

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

    const timeoutId = window.setTimeout(() => {
      notifyTimeManagementDataChanged('state-changed')
    }, 180)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [categories, events, isAuthenticated, modes, notifyTimeManagementDataChanged])

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

      if (isFullEditorOpen) {
        event.preventDefault()
        setIsFullEditorOpen(false)
        return
      }

      if (isEditableTarget(event.target)) return

      if (selectedItemId || selectionDraft || movingItemId) {
        event.preventDefault()
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
          // Discard the draft Title and tag selections only when they still
          // match a quick-template (untouched quick-button values). Anything the
          // user typed or modified by hand is preserved so custom content is
          // never lost on Esc.
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
    closeLeftPanel,
    collapseLeftPanelSections,
    expandedSections,
    isLeftPanelOpen,
    isFullEditorOpen,
    movingItemId,
    quickTemplates,
    reopenLeftPanelCollapsed,
    selectedItemId,
    selectionDraft,
  ])
  const dragTopOffsetMinutesRef = useRef(0)
  const selectionAnchorDayColumnRef = useRef<HTMLDivElement | null>(null)
  const editorSectionRef = useRef<HTMLElement | null>(null)
  const calendarScrollContainerRef = useRef<HTMLDivElement>(null)
  const hasAutoScrolledToWeekItemRef = useRef(false)
  const hasCenteredCalendarScrollRef = useRef(false)
  const isRepositioningCalendarScrollRef = useRef(false)
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

  const clearDragPreview = useCallback(() => {
    const preview = dragPreviewRef.current
    if (!preview) return
    if (preview.parentElement) {
      preview.parentElement.removeChild(preview)
    }
    dragPreviewRef.current = null
  }, [])

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
    categoryIds: [],
    sourceId: syncCalendars.find((source) => source.enabled)?.id || syncCalendars[0]?.id || MAIN_SOURCE_ID,
    recurrenceRule: { type: 'none' },
  })

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    const state: StoredPreferences = {
      syncCalendars,
      slotMinutes,
      timeBackgrounds,
      collapsedBackgroundIds: Array.from(collapsedBackgroundIds),
      quickTemplates,
      showQuickTemplatesInMain,
      quickTemplatesMainExpanded,
      isLeftPanelOpen,
      leftPanelWidthPx: leftPanelPreferredWidthPxRef.current,
      expandedSections: Array.from(expandedSections),
    }
    persistStoredPreferences(state)
  }, [
    collapsedBackgroundIds,
    expandedSections,
    isLeftPanelOpen,
    leftPanelWidthPx,
    quickTemplates,
    quickTemplatesMainExpanded,
    showQuickTemplatesInMain,
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

  const fetchEvents = useCallback(async (options?: { silent?: boolean; weekStart?: Date }) => {
    if (!isAuthenticated) {
      setEvents([])
      setEventsError(null)
      setIsEventsLoading(false)
      return [] as UserEventRecord[]
    }

    if (!options?.silent) {
      setIsEventsLoading(true)
    }
    setEventsError(null)

    try {
      const res = await dedupedGet<{ events: UserEventRecord[] }>('/api/user-events')
      const fetchedEvents = Array.isArray(res.data?.events) ? res.data.events : []
      setEvents(fetchedEvents)
      const cacheWeekStart = options?.weekStart ?? currentWeekStartRef.current
      const cacheKey = getWeekWindowKey(cacheWeekStart, enabledExternalSourceIdsRef.current)
      weekWindowCacheRef.current.set(cacheKey, {
        events: fetchedEvents,
        updatedAt: Date.now(),
      })
      return fetchedEvents
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load meetings.'
      setEventsError(message)
      setEvents([])
      return [] as UserEventRecord[]
    } finally {
      if (!options?.silent) {
        setIsEventsLoading(false)
      }
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated) {
      return
    }

    let cancelled = false

    void fetchEvents().catch(() => {
      if (cancelled) return
    })

    return () => {
      cancelled = true
    }
  }, [fetchEvents, isAuthenticated])

  useEffect(() => {
    if (weekWindowCacheRef.current.size === 0) {
      return
    }

    const updatedAt = Date.now()
    for (const [cacheKey, cacheEntry] of weekWindowCacheRef.current.entries()) {
      weekWindowCacheRef.current.set(cacheKey, {
        ...cacheEntry,
        events,
        updatedAt,
      })
    }
  }, [events])

  useEffect(() => {
    if (!isAuthenticated || typeof window === 'undefined') {
      return
    }

    const scheduleRefresh = () => {
      if (crossTabRefreshTimerRef.current !== null) {
        window.clearTimeout(crossTabRefreshTimerRef.current)
      }

      crossTabRefreshTimerRef.current = window.setTimeout(() => {
        crossTabRefreshTimerRef.current = null
        void fetchEvents({ silent: true })
      }, 180)
    }

    const isSelfOriginated = (raw: unknown): boolean => {
      if (!raw || typeof raw !== 'object') return false
      const tabId = (raw as { tabId?: unknown }).tabId
      return typeof tabId === 'string' && tabId === syncTabIdRef.current
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key !== TIME_MANAGEMENT_SYNC_STORAGE_KEY || !event.newValue) return
      try {
        if (isSelfOriginated(JSON.parse(event.newValue))) return
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
        scheduleRefresh()
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
    const onPointerUp = () => {
      setIsSelecting(false)
      selectionAnchorDayColumnRef.current = null
      if (selectionDraft && isPhoneLayout && !movingItemId && !isFullEditorOpen) {
        openEditorSurface({ autoFocusTitle: true })
        return
      }

      if (selectionDraft && !isPhoneLayout) {
        openLeftPanelSection('editor')
      }
    }

    const onPointerCancel = () => {
      setIsSelecting(false)
      selectionAnchorDayColumnRef.current = null
    }

    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    return () => {
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [isFullEditorOpen, isPhoneLayout, movingItemId, openEditorSurface, openLeftPanelSection, selectionDraft])

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, idx) => addDays(currentWeekStart, idx)),
    [currentWeekStart]
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

    const weekKey = getWeekWindowKey(weekStart, enabledExternalSources.map((source) => source.id))
    const cachedEntry = weekWindowCacheRef.current.get(weekKey)
    if (cachedEntry && !options?.forceRefresh) {
      if (weekStart.getTime() === currentWeekStartRef.current.getTime() && !options?.background) {
        setEvents(cachedEntry.events)
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

        const fetchedEvents = await fetchEvents({ silent: !shouldShowLoading, weekStart })

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
  }, [enabledExternalSources, fetchEvents, isAuthLoading, isAuthenticated, isTraveler])

  useEffect(() => {
    if (enabledExternalSources.length === 0) {
      setExternalSyncStatus(null)
      return
    }

    const weekStarts = getNeighborWeekStarts(currentWeekStart)
    const [previousWeekStart, visibleWeekStart, nextWeekStart] = weekStarts

    void hydrateWeekWindow(visibleWeekStart, { background: false })

    const warmNeighbors = window.setTimeout(() => {
      if (previousWeekStart) {
        void hydrateWeekWindow(previousWeekStart, { background: true })
      }
      if (nextWeekStart) {
        void hydrateWeekWindow(nextWeekStart, { background: true })
      }
    }, 0)

    return () => {
      window.clearTimeout(warmNeighbors)
    }
  }, [currentWeekStart, enabledExternalSources.length, hydrateWeekWindow])

  const items = useMemo(() => {
    const hasEnabledSources = activeSourceIds.size > 0
    return events
      .flatMap((event) => mapEventToTimeItems(event, currentWeekStart, slotMinutes, activeModeId))
      .filter((item) => !hasEnabledSources || activeSourceIds.has(item.sourceId))
  }, [activeModeId, activeSourceIds, currentWeekStart, events, slotMinutes])

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

    const weights = weekDays.map((day, dayIndex) => {
      const isPastDay = startOfDay(day).getTime() < todayStart.getTime()
      const isUnusedDay = !usedDayIndexes.has(dayIndex)

      if (isUnusedDay) return 0.5
      if (isPastDay) return 0.7
      return 1
    })

    const totalBaseline = 7
    let remainingSavedWidth = Math.max(
      0,
      totalBaseline - weights.reduce((sum, weight) => sum + weight, 0)
    )

    const activeDayIndex = weekDays.findIndex((day) => isSameDay(day, nowTick))
    if (activeDayIndex >= 0 && remainingSavedWidth > 0) {
      const activeDayBoost = Math.min(0.5, remainingSavedWidth)
      weights[activeDayIndex] += activeDayBoost
      remainingSavedWidth -= activeDayBoost
    }

    const redistributionIndexes =
      activeDayIndex >= 0
        ? weights.map((_, index) => index).filter((index) => index !== activeDayIndex)
        : weights.map((_, index) => index)

    if (remainingSavedWidth > 0 && redistributionIndexes.length > 0) {
      const perDayExtra = remainingSavedWidth / redistributionIndexes.length
      redistributionIndexes.forEach((index) => {
        weights[index] += perDayExtra
      })
    }

    return weights
  }, [nowTick, visibleItems, weekDays])

  const weekGridTemplateColumns = useMemo(() => {
    const dayTracks = dayColumnWeights
      .map((weight) => `minmax(0, ${weight.toFixed(4)}fr)`)
      .join(' ')
    return `repeat(${tzState.all.length}, 54px) ${dayTracks}`
  }, [dayColumnWeights, tzState.all.length])

  const slotsPerDay = MINUTES_IN_DAY / slotMinutes
  const dayHeight = slotsPerDay * SLOT_HEIGHT
  const isQuarterHourGrid = slotMinutes === 15
  const hourBlockHeight = SLOT_HEIGHT * 4
  const currentMinuteUtc = nowTick.getUTCHours() * 60 + nowTick.getUTCMinutes()
  const currentTimeIndicatorTop = (currentMinuteUtc / slotMinutes) * SLOT_HEIGHT
  const timezoneColumnsWidth = tzState.all.length * 54
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
    const weekEnd = addDays(currentWeekStart, 6)
    const sameMonth = format(currentWeekStart, 'MMM') === format(weekEnd, 'MMM')
    if (sameMonth) {
      return `${format(currentWeekStart, 'MMM d')} - ${format(weekEnd, 'd, yyyy')}`
    }
    return `${format(currentWeekStart, 'MMM d')} - ${format(weekEnd, 'MMM d, yyyy')}`
  }, [currentWeekStart])

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

  const movingItemIsRecurring = useMemo(() => {
    if (!movingItemId) return false
    const moving = interactionItemMap.get(movingItemId)
      || items.find((item) => item.id === movingItemId)
      || (movingItemSnapshot?.id === movingItemId ? movingItemSnapshot : null)
    if (!moving) return false
    const source = events.find((event) => event.id === moving.sourceEventId)
    return Boolean(source?.recurrence_rule && source.recurrence_rule.type !== 'none')
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
      return layout.eventSegments
        .map((segment) => {
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
            canResizeStart: item.isStartSegment,
            canResizeEnd: item.isEndSegment,
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

  const handleActivateMode = useCallback(async (nextModeId: string) => {
    if (!nextModeId || nextModeId === activeModeId) return

    try {
      await apiClient.post(`/api/time-management/modes/${nextModeId}/activate`)
      const nextMode = modes.find((mode) => mode.id === nextModeId)
      if (!nextMode) {
        setActiveModeId(nextModeId)
        return
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
    } catch (err) {
      console.error('Failed to activate mode:', err)
      setClipboardStatus('Could not switch mode. Try again.')
    }
  }, [activeModeId, modes])

  const handleCreateMode = useCallback(async () => {
    if (isCreatingMode) return
    if (modes.length >= MAX_MODE_COUNT) {
      setClipboardStatus(`You can create up to ${MAX_MODE_COUNT} modes.`)
      return
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
    } catch (err) {
      console.error('Failed to create mode:', err)
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Could not create mode.'
      setClipboardStatus(msg)
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
  const selectedReadOnlyDisplayNotes = useMemo(() => {
    if (!selectedEvent || !isSelectedReadOnly) return draft.notes
    if (selectedEvent.source_type === 'manual') {
      return buildEventDraftNotes(selectedEvent)
    }

    return buildCopiedDescriptionWithLocation(selectedEvent.description, selectedEvent.location) || ''
  }, [draft.notes, isSelectedReadOnly, selectedEvent])
  const selectionStartLabel = selectionDraft ? formatMinuteLabel(selectionDraft.startMinute, tzState.primary, slotMinutes) : ''
  const selectionEndLabel = selectionDraft ? formatMinuteLabel(selectionDraft.endMinute, tzState.primary, slotMinutes) : ''
  const selectedItemStartLabel = selectedItem ? formatMinuteLabel(selectedItem.startMinute, tzState.primary, slotMinutes) : ''
  const selectedItemEndLabel = selectedItem
    ? formatMinuteLabel(
      selectedItem.startMinute + getTimeItemTotalDurationMinutes(selectedItem, slotMinutes),
      tzState.primary,
      slotMinutes
    )
    : ''
  const selectedItemDateLabel = selectedItem ? format(weekDays[selectedItem.dayIndex], 'EEE d MMM') : ''
  const isSelectionAdjusterOpen = isSelectionAdjusterExpanded
  const isItemAdjusterOpen = isItemAdjusterExpanded
  const isTimeAdjusterExpanded = selectionDraft && !selectedItem
    ? isSelectionAdjusterExpanded
    : isItemAdjusterExpanded
  const noteEditorTitle = selectedItem
    ? draft.title.trim() || selectedItem.title || 'Untitled item'
    : draft.title.trim() || 'New time item'
  const noteEditorSubtitle = selectedItem
    ? (
      <span className="text-orange-600 dark:text-orange-300">
        {selectedItemDateLabel} {' '}
        <span className={itemLastChangedEdge === 'start' ? 'animate-[selection-time-pulse_0.75s_ease-out]' : ''}>{selectedItemStartLabel}</span>
        {' - '}
        <span className={itemLastChangedEdge === 'end' ? 'animate-[selection-time-pulse_0.75s_ease-out]' : ''}>{selectedItemEndLabel}</span>
      </span>
    )
    : selectionDraft
      ? (
        <span className="text-orange-600 dark:text-orange-300">
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
      normaliseCategoryIds(value.categoryIds),
      value.sourceId,
      JSON.stringify(normaliseRecurrenceRule(value.recurrenceRule)),
    ].join('::')
  }, [])

  const isSelectedItemDirty = useMemo(() => {
    if (!selectedEvent || isSelectedReadOnly) return false
    if (draft.title !== selectedEvent.title) return true
    if (draft.notes !== buildEventDraftNotes(selectedEvent)) return true
    if (normaliseCategoryIds(draft.categoryIds) !== normaliseCategoryIds(selectedEvent.category_ids || [])) return true
    return JSON.stringify(normaliseRecurrenceRule(draft.recurrenceRule)) !== JSON.stringify(normaliseRecurrenceRule(selectedEvent.recurrence_rule))
  }, [draft.categoryIds, draft.notes, draft.recurrenceRule, draft.title, isSelectedReadOnly, selectedEvent])

  const isTitleDirty = Boolean(selectedEvent && !isSelectedReadOnly && draft.title !== selectedEvent.title)
  const isNotesDirty = Boolean(selectedEvent && !isSelectedReadOnly && draft.notes !== buildEventDraftNotes(selectedEvent))
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

  useEffect(() => {
    // Re-center only when the visible week/time scale changes.
    hasCenteredCalendarScrollRef.current = false
  }, [currentWeekStart, slotMinutes])

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
    if (isDraggingItem) return

    const scrollContainer = calendarScrollContainerRef.current
    const repeatHeight = getCalendarRepeatHeight()
    if (!scrollContainer || repeatHeight <= 0) return

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
    (dayIndex: number, startMinute: number) => {
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

      scrollContainer.scrollTo({ top: targetTop, behavior: 'auto' })
      return true
    },
    [slotMinutes]
  )

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

    const handleMouseMove = (event: globalThis.MouseEvent) => {
      const dayColumn = resizeState.dayColumnElement
      if (!dayColumn) return

      const rect = dayColumn.getBoundingClientRect()
      const pointerMinuteRaw = (event.clientY - rect.top) / rect.height * MINUTES_IN_DAY
      const pointerMinute = snapMinuteUnbounded(pointerMinuteRaw, slotMinutes)

      const day = weekDays[resizeState.dayIndex]
      const baseDayStartMs = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0)
      const pointerTimeMs = baseDayStartMs + pointerMinute * 60_000

      const originalStartMs = new Date(resizeState.originalEvent.start_time).getTime()
      const originalEndMs = new Date(resizeState.originalEvent.end_time).getTime()
      const minDurationMs = slotMinutes * 60_000

      const nextStartMs = resizeState.edge === 'start'
        ? Math.min(pointerTimeMs, originalEndMs - minDurationMs)
        : originalStartMs
      const nextEndMs = resizeState.edge === 'end'
        ? Math.max(pointerTimeMs, originalStartMs + minDurationMs)
        : originalEndMs

      const startTime = new Date(nextStartMs).toISOString()
      const endTime = new Date(nextEndMs).toISOString()

      setEvents((prev) =>
        prev.map((candidate) =>
          candidate.id === (items.find((entry) => entry.id === resizeState.itemId)?.sourceEventId || resizeState.itemId)
            ? { ...candidate, start_time: startTime, end_time: endTime }
            : candidate
        )
      )
    }

    const handleMouseUp = () => {
      const itemId = resizeState.itemId
      const resizeItem = items.find((entry) => entry.id === itemId)
      const sourceEventId = resizeItem?.sourceEventId || itemId
      const finalEvent = eventsRef.current.find((event) => event.id === sourceEventId)
      const previousEvent = resizeState.originalEvent
      setResizeState(null)

      if (!finalEvent) return
      if (finalEvent.start_time === previousEvent.start_time && finalEvent.end_time === previousEvent.end_time) {
        return
      }

      apiClient
        .put(`/api/user-events/${sourceEventId}`, {
          start_time: finalEvent.start_time,
          end_time: finalEvent.end_time,
        })
        .catch((err) => {
          console.error('Failed to resize item:', err)
          setEvents((prev) => prev.map((candidate) => (candidate.id === sourceEventId ? previousEvent : candidate)))
        })
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('pointerup', handleMouseUp)
    window.addEventListener('blur', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('pointerup', handleMouseUp)
      window.removeEventListener('blur', handleMouseUp)
    }
  }, [items, resizeState, slotMinutes, weekDays])

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
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable handler; wrapping in useCallback would cascade through co-located helpers in this large view
  const startSelection = (dayIndex: number, minute: number) => {
    if (isResizing) return
    const snapped = snapMinute(minute, slotMinutes)
    const hasInProgressNewItem =
      !selectedItemId &&
      Boolean(draft.title.trim() || draft.notes.trim() || draft.categoryIds.length)

    setSelectionDraft({ dayIndex, startMinute: snapped, endMinute: snapped + slotMinutes })
    setIsSelecting(true)
    setIsSelectionAdjusterExpanded(false)
    setIsItemAdjusterExpanded(false)
    setSelectedItemId(null)
    setShowItemRecurrencePanel(false)
    setDraft((prev) => {
      if (hasInProgressNewItem) {
        return prev
      }

      return {
        title: '',
        notes: '',
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

  const autoScrollCalendarWhileDragging = useCallback((clientY: number) => {
    const container = calendarScrollContainerRef.current
    if (!container) return

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

    if (delta === 0) return

    // During drag we do NOT wrap; the three repeat copies give plenty of
    // headroom and wrapping mid-drag breaks the native HTML5 drag image on
    // some browsers (the dragged item visually freezes against an edge).
    const maxTop = Math.max(0, container.scrollHeight - container.clientHeight)
    container.scrollTop = Math.max(0, Math.min(maxTop, container.scrollTop + delta))
  }, [])

  useEffect(() => {
    if (!isDraggingItem) return

    const handleWindowDragOver = (event: globalThis.DragEvent) => {
      event.preventDefault()
      dragClientYRef.current = event.clientY
      autoScrollCalendarWhileDragging(event.clientY)
    }

    const handleWindowDrag = (event: globalThis.DragEvent) => {
      if (event.clientY > 0) {
        dragClientYRef.current = event.clientY
      }
    }

    const handleWindowDragEnd = () => {
      setIsDraggingItem(false)
      setDraggingItemId(null)
      setDragDropPreview(null)
      dragClientYRef.current = null
      clearDragPreview()

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

    let frameId = 0
    const tick = () => {
      const clientY = dragClientYRef.current
      if (typeof clientY === 'number') {
        autoScrollCalendarWhileDragging(clientY)
      }
      frameId = window.requestAnimationFrame(tick)
    }
    frameId = window.requestAnimationFrame(tick)

    window.addEventListener('dragover', handleWindowDragOver)
    window.addEventListener('drag', handleWindowDrag)
    window.addEventListener('dragend', handleWindowDragEnd)
    window.addEventListener('drop', handleWindowDragEnd)
    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('dragover', handleWindowDragOver)
      window.removeEventListener('drag', handleWindowDrag)
      window.removeEventListener('dragend', handleWindowDragEnd)
      window.removeEventListener('drop', handleWindowDragEnd)
    }
  }, [autoScrollCalendarWhileDragging, clearDragPreview, getCalendarRepeatHeight, isDraggingItem, normalizeCalendarLoopScrollTop])

  const handleDrop = (event: DragEvent<HTMLDivElement>, dayIndex: number) => {
    event.preventDefault()
    setIsDraggingItem(false)
    setDraggingItemId(null)
    setDragDropPreview(null)
    clearDragPreview()
    const itemId = event.dataTransfer.getData('text/time-item')
    const item = interactionItemMap.get(itemId) || items.find((candidate) => candidate.id === itemId)
    if (!item) return
    const itemTotalDurationMinutes = getTimeItemTotalDurationMinutes(item, slotMinutes)
    const sourceEventId = item.sourceEventId

    // External (read-only) items cannot be moved.
    const source = sourceMap.get(item.sourceId)
    if (isReadOnlySource(source)) return

    const rect = event.currentTarget.getBoundingClientRect()
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top))
    const pointerMinute = (y / rect.height) * MINUTES_IN_DAY
    const minute = resolveDropStartMinute(
      pointerMinute,
      dragTopOffsetMinutesRef.current,
      slotMinutes,
      itemTotalDurationMinutes
    )
    const dropTarget = normaliseDroppedMinuteToWeekDay(dayIndex, minute)
    if (!dropTarget) return
    const day = weekDays[dropTarget.dayIndex]
    const startTime = buildEventTimestamp(day, dropTarget.startMinute)
    const endTime = new Date(new Date(startTime).getTime() + itemTotalDurationMinutes * 60_000).toISOString()

    const previous = events
    setEvents((prev) =>
      prev.map((candidate) =>
        candidate.id === sourceEventId
          ? { ...candidate, start_time: startTime, end_time: endTime }
          : candidate
      )
    )

    apiClient
      .put(`/api/user-events/${sourceEventId}`, { start_time: startTime, end_time: endTime })
      .catch((err) => {
        console.error('Failed to reschedule item:', err)
        setEvents(previous)
      })
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable handler; wrapping in useCallback would cascade through co-located helpers in this large view
  const handleSaveSelection = async (moveScopeArg?: 'this' | 'series'): Promise<boolean> => {
    if (!selectionDraft || !draft.title.trim()) return false
    if (isCreatingItemRef.current) return false

    const moveScope = moveScopeArg === 'series' || moveScopeArg === 'this' ? moveScopeArg : undefined

    const duration = Math.max(slotMinutes, selectionDraft.endMinute - selectionDraft.startMinute)
    const day = weekDays[selectionDraft.dayIndex]
    const start_time = buildEventTimestamp(day, selectionDraft.startMinute)
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
      const selectionDuration = Math.max(slotMinutes, selectionDraft.endMinute - selectionDraft.startMinute)
      const moveDuration = Math.max(originalDuration, selectionDuration)
      const moveStartMinute = selectionDraft.startMinute
      const moveStartTime = buildEventTimestamp(day, moveStartMinute)
      const moveEndTime = new Date(new Date(moveStartTime).getTime() + moveDuration * 60_000).toISOString()

      const existingRule = normaliseRecurrenceRule(sourceEvent.recurrence_rule)
      const isRecurringMove = existingRule.type !== 'none'
      const effectiveScope: 'this' | 'series' = isRecurringMove ? (moveScope ?? 'this') : 'series'
      const previous = events

      // Move the whole recurring series: shift the base anchor and all date-based rule fields.
      if (isRecurringMove && effectiveScope === 'series') {
        const occurrenceStartMs = new Date(movingItem.occurrenceStartTime).getTime()
        const deltaMs = new Date(moveStartTime).getTime() - occurrenceStartMs
        const dayShift = Math.round(
          (toUtcDateParts(new Date(moveStartTime)) - toUtcDateParts(new Date(movingItem.occurrenceStartTime))) / DAY_MS
        )
        const newBaseStart = new Date(sourceStart + deltaMs).toISOString()
        const newBaseEnd = new Date(sourceEnd + deltaMs).toISOString()
        const shiftedRule = shiftRecurrenceRuleByDays(existingRule, dayShift)
        const updatedFields = {
          title: draft.title,
          description: notesToEventDescription(draft.notes),
          start_time: newBaseStart,
          end_time: newBaseEnd,
          category_ids: draft.categoryIds,
          recurrence_rule: shiftedRule,
        }
        setEvents((prev) => prev.map((entry) => (entry.id === sourceEvent.id ? { ...entry, ...updatedFields } : entry)))
        try {
          await apiClient.put(`/api/user-events/${sourceEvent.id}`, updatedFields)
          setSelectedItemId(sourceEvent.id)
          setSelectionDraft(null)
          setMovingItemId(null)
          setMovingItemSnapshot(null)
          setIsMoveScopeOpen(false)
          setLastSavedAt(Date.now())
          setAutoSaveError(null)
          showClipboardStatus('Recurring series moved. Future items recalculated.')
          return true
        } catch (err) {
          console.error('Failed to move series:', err)
          setEvents(previous)
          showClipboardStatus('Could not move series. Try again.')
          return false
        }
      }

      // Move only this occurrence: exclude it from the series and create a standalone item.
      if (isRecurringMove) {
        const occurrenceKey = getUtcDateKey(new Date(movingItem.occurrenceStartTime))
        const nextExceptions = Array.from(new Set([...(existingRule.exceptions || []), occurrenceKey]))
        const updatedRule: RecurrenceRule = { ...existingRule, exceptions: nextExceptions }
        const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const pendingEvent: UserEventRecord = {
          id: pendingId,
          title: draft.title,
          description: notesToEventDescription(draft.notes),
          meeting_link: null,
          location: null,
          start_time: moveStartTime,
          end_time: moveEndTime,
          source_type: 'manual',
          source_id: activeModeId || MAIN_SOURCE_ID,
          category_ids: draft.categoryIds,
          recurrence_rule: { type: 'none' },
        }
        setEvents((prev) => prev.map((entry) => (entry.id === sourceEvent.id ? { ...entry, recurrence_rule: updatedRule } : entry)))
        setEvents((prev) => [...prev, pendingEvent])
        setSelectedItemId(pendingId)
        setSelectionDraft(null)
        setMovingItemId(null)
        setMovingItemSnapshot(null)
        setIsMoveScopeOpen(false)
        try {
          await apiClient.put(`/api/user-events/${sourceEvent.id}`, { recurrence_rule: updatedRule })
          const { data } = await apiClient.post<{ event: UserEventRecord }>('/api/user-events', {
            title: draft.title,
            description: notesToEventDescription(draft.notes),
            start_time: moveStartTime,
            end_time: moveEndTime,
            category_ids: draft.categoryIds,
            source_id: activeModeId || undefined,
            recurrence_rule: { type: 'none' },
          })
          const created = data?.event
          if (created) {
            const normalised = normaliseCreatedManualEvent(created, {
              fallbackSourceId: activeModeId || MAIN_SOURCE_ID,
              fallbackCategoryIds: draft.categoryIds,
              fallbackRecurrenceRule: { type: 'none' },
            })
            setEvents((prev) => prev.map((entry) => (entry.id === pendingId ? normalised : entry)))
            setSelectedItemId(normalised.id)
          } else {
            setSelectedItemId(null)
          }
          setLastSavedAt(Date.now())
          setAutoSaveError(null)
          showClipboardStatus('This occurrence moved.')
          return true
        } catch (err) {
          console.error('Failed to move occurrence:', err)
          setEvents(previous)
          showClipboardStatus('Could not move occurrence. Try again.')
          return false
        }
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
        setEvents(previous)
        showClipboardStatus('Could not move item. Try again.')
        return false
      }
    }

    isCreatingItemRef.current = true
    setIsCreatingItem(true)

    const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const pendingRecurrence = normaliseRecurrenceRule(draft.recurrenceRule)
    const pendingSelection = { ...selectionDraft }
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
      location: null,
      start_time,
      end_time,
      source_type: 'manual',
      source_id: activeModeId || MAIN_SOURCE_ID,
      category_ids: [...draft.categoryIds],
      recurrence_rule: pendingRecurrence,
    }

    setEvents((prev) => [...prev, pendingEvent])
    setSelectedItemId(pendingId)
    setSelectionDraft(null)
    setDraft((prev) => ({ ...prev, title: '', notes: '', categoryIds: [], recurrenceRule: { type: 'none' } }))
    setExpandedSections((prev) => {
      const next = new Set(prev)
      next.add('editor')
      return next
    })

    try {
      const { data } = await apiClient.post<{ event: UserEventRecord }>('/api/user-events', {
        title: draft.title,
        description: notesToEventDescription(draft.notes),
        start_time,
        end_time,
        category_ids: draft.categoryIds,
        source_id: activeModeId || undefined,
        recurrence_rule: normaliseRecurrenceRule(draft.recurrenceRule),
      })
      const created = data?.event
      if (!created) return false
      const pendingCategoryIds = (() => {
        const pendingMatch = eventsRef.current.find((entry) => entry.id === pendingId)
        return Array.isArray(pendingMatch?.category_ids)
          ? pendingMatch.category_ids
          : draft.categoryIds
      })()
      const normalised = normaliseCreatedManualEvent(created, {
        fallbackSourceId: activeModeId || MAIN_SOURCE_ID,
        fallbackCategoryIds: pendingCategoryIds,
        fallbackRecurrenceRule: draft.recurrenceRule,
      })
      const resolvedEvent = areStringArraysEqual(normalised.category_ids || [], pendingCategoryIds)
        ? normalised
        : { ...normalised, category_ids: [...pendingCategoryIds] }

      setEvents((prev) => prev.map((entry) => (entry.id === pendingId ? resolvedEvent : entry)))
      setSelectedItemId(resolvedEvent.id)
      setCalendarItemContextMenu((prev) => {
        if (!prev || prev.itemId !== pendingId) return prev
        return { ...prev, itemId: resolvedEvent.id }
      })

      if (!areStringArraysEqual(Array.isArray(created.category_ids) ? created.category_ids : [], pendingCategoryIds)) {
        void apiClient.put(`/api/user-events/${resolvedEvent.id}`, { category_ids: pendingCategoryIds }).catch((error) => {
          console.error('Failed to persist pending category update:', error)
        })
      }
      return true
    } catch (err) {
      console.error('Failed to save item:', err)
      setEvents((prev) => prev.filter((entry) => entry.id !== pendingId))
      setSelectedItemId(null)
      setSelectionDraft(pendingSelection)
      setDraft(pendingDraft)
      showClipboardStatus('Could not save item. Try again.')
      return false
    } finally {
      isCreatingItemRef.current = false
      setIsCreatingItem(false)
    }
  }

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
      categoryIds: [],
      sourceId: MAIN_SOURCE_ID,
      recurrenceRule: { type: 'none' },
    }))
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
    window.setTimeout(() => setClipboardStatus((prev) => (prev === message ? null : prev)), 2200)
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
      categoryIds: template.categoryIds,
      sourceId: MAIN_SOURCE_ID,
      recurrenceRule: { type: 'none' },
    }

    setSelectedItemId(null)
    setDraft((prev) => ({ ...prev, ...nextDraft }))
    if (isPhoneLayout) {
      openEditorSurface({ autoFocusTitle: !nextDraft.title.trim() })
    } else {
      setShowItemRecurrencePanel(false)
      openLeftPanelSection('editor')
    }

    // Keep keyboard flow in the title field after template apply.
    window.requestAnimationFrame(() => {
      selectionTitleInputRef.current?.focus()
    })

    if (!selectionDraft) {
      showClipboardStatus(`Template "${template.quickName}" loaded. Select Time on the calendar.`)
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
        showClipboardStatus('Could not apply template. Try again.')
        return
      }

      const normalised: UserEventRecord = {
        ...created,
        source_id: created.source_id || MAIN_SOURCE_ID,
        category_ids: Array.isArray(created.category_ids) ? created.category_ids : nextDraft.categoryIds,
      }

      setEvents((prev) => [...prev, normalised])
      setSelectedItemId(normalised.id)
      setSelectionDraft(null)
      setMovingItemId(null)
      setMovingItemSnapshot(null)
      setExpandedSections((prev) => {
        const next = new Set(prev)
        next.add('editor')
        return next
      })
      showDescriptionHint()
      showClipboardStatus(`Template "${template.quickName}" applied. Edit it here or open Full View.`)
    } catch (err) {
      console.error('Failed to apply template:', err)
      showClipboardStatus('Could not apply template. Try again.')
    } finally {
      isCreatingItemRef.current = false
      setIsCreatingItem(false)
    }
  }, [activeModeId, isPhoneLayout, openEditorSurface, openLeftPanelSection, selectionDraft, showClipboardStatus, showDescriptionHint, slotMinutes, weekDays])

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
    setIsLeftPanelOpen(true)
    setExpandedSections((prev) => {
      const next = new Set(prev)
      next.add('editor')
      return next
    })

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
      const pendingCategoryIds = (() => {
        const pendingMatch = eventsRef.current.find((entry) => entry.id === pendingId)
        return Array.isArray(pendingMatch?.category_ids)
          ? pendingMatch.category_ids
          : copiedItem.categoryIds
      })()
      const normalised = normaliseCreatedManualEvent(created, {
        fallbackSourceId: activeModeId || MAIN_SOURCE_ID,
        fallbackCategoryIds: pendingCategoryIds,
        fallbackRecurrenceRule: copiedItem.recurrenceRule,
      })
      const resolvedEvent = areStringArraysEqual(normalised.category_ids || [], pendingCategoryIds)
        ? normalised
        : { ...normalised, category_ids: [...pendingCategoryIds] }

      setEvents((prev) => prev.map((entry) => (entry.id === pendingId ? resolvedEvent : entry)))
      setSelectedItemId(resolvedEvent.id)
      showClipboardStatus('Pasted item with original metadata and duration.')

      if (!areStringArraysEqual(Array.isArray(created.category_ids) ? created.category_ids : [], pendingCategoryIds)) {
        void apiClient.put(`/api/user-events/${resolvedEvent.id}`, { category_ids: pendingCategoryIds }).catch((error) => {
          console.error('Failed to persist pending category update:', error)
        })
      }

      return true
    } catch (err) {
      console.error('Failed to paste item:', err)
      setEvents((prev) => prev.filter((entry) => entry.id !== pendingId))
      setSelectedItemId(null)
      setSelectionDraft(pendingSelection)
      showClipboardStatus('Could not paste item. Try again.')
      return false
    }
  }, [activeModeId, copiedItem, selectionDraft, showClipboardStatus, weekDays])

  const persistSelectedItem = useCallback(async (
    nextDraft: ItemDraft,
    options?: { showErrorToast?: boolean }
  ): Promise<boolean> => {
    if (!selectedEvent || !nextDraft.title.trim()) return false
    if (isSelectedReadOnly) return false

    const showErrorToast = options?.showErrorToast ?? true
    const previous = events
    const updatedFields = {
      title: nextDraft.title,
      description: notesToEventDescription(nextDraft.notes),
      category_ids: nextDraft.categoryIds,
      recurrence_rule: normaliseRecurrenceRule(nextDraft.recurrenceRule),
    }

    setEvents((prev) => {
      let hasChanges = false
      const next = prev.map((item) => {
        if (item.id !== selectedEvent.id) return item

        const itemCategoryIds = Array.isArray(item.category_ids) ? item.category_ids : []
        const hasCategoryChanges = !areStringArraysEqual(itemCategoryIds, updatedFields.category_ids)
        const hasTitleChanges = item.title !== updatedFields.title
        const hasDescriptionChanges = item.description !== updatedFields.description
        const hasRecurrenceChanges = JSON.stringify(normaliseRecurrenceRule(item.recurrence_rule)) !== JSON.stringify(updatedFields.recurrence_rule)

        if (!hasCategoryChanges && !hasTitleChanges && !hasDescriptionChanges && !hasRecurrenceChanges) {
          return item
        }

        hasChanges = true
        return { ...item, ...updatedFields }
      })

      return hasChanges ? next : prev
    })

    try {
      await apiClient.put(`/api/user-events/${selectedEvent.id}`, updatedFields)
      setLastSavedAt(Date.now())
      setAutoSaveError(null)
      return true
    } catch (err) {
      console.error('Failed to update item:', err)
      setEvents(previous)
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
    }
  }, [events, isSelectedReadOnly, selectedEvent, showClipboardStatus])

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
    setPendingUnsavedAction(null)
    setPendingUnsavedAnchor(null)
    setIsPendingUnsavedActionSaving(false)
  }, [hasPendingUnsavedChanges])

  const applySelectedItem = useCallback((itemId: string): boolean => {
    setSelectedItemId(itemId)
    setMovingItemId(null)
    setMovingItemSnapshot(null)
    setSelectionDraft(null)
    if (isPhoneLayout) {
      openEditorSurface()
      return true
    }

    openLeftPanelSection('editor')
    return true
  }, [isPhoneLayout, openEditorSurface, openLeftPanelSection])

  const requestPendingUnsavedAction = useCallback((action: PendingUnsavedAction, anchor?: PendingUnsavedAnchor) => {
    setPendingUnsavedAction(action)
    if (anchor) {
      const popupWidth = 320
      const popupHeight = 170
      setPendingUnsavedAnchor({
        x: Math.max(12, Math.min(window.innerWidth - popupWidth - 12, anchor.x + 12)),
        y: Math.max(12, Math.min(window.innerHeight - popupHeight - 12, anchor.y + 12)),
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

  const handlePendingUnsavedActionConfirm = useCallback(async () => {
    if (isPendingUnsavedActionSaving) return
    if (!pendingUnsavedAction) return
    if (!draft.title.trim()) {
      showClipboardStatus('Title is required before saving.')
      return
    }

    setIsPendingUnsavedActionSaving(true)
    setIsAutoSaving(true)
    const saved = await persistSelectedItem(draft)
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

    startSelection(actionToApply.dayIndex, actionToApply.minute)
  }, [applySelectedItem, draft, isPendingUnsavedActionSaving, pendingUnsavedAction, persistSelectedItem, showClipboardStatus, startSelection])

  const selectItemForEditing = useCallback(async (itemId: string, anchor?: PendingUnsavedAnchor): Promise<boolean> => {
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

    if (itemId === selectedItemId) return true

    if (isAutoSaving) {
      showClipboardStatus('Saving changes...')
      return false
    }

    if (hasPendingUnsavedChanges) {
      if (!draft.title.trim()) {
        showClipboardStatus('Title is required before switching items.')
        return false
      }

      requestPendingUnsavedAction({ type: 'switch-item', itemId }, anchor)
      return false
    }

    return applySelectedItem(itemId)
  }, [applySelectedItem, draft, hasPendingUnsavedChanges, interactionItemMap, isAutoSaving, isTemplateSelectionMode, items, openQuickObjectsSurface, requestPendingUnsavedAction, selectedItemId, showClipboardStatus])

  const startSelectionWithUnsavedGuard = useCallback(async (dayIndex: number, minute: number, anchor?: PendingUnsavedAnchor) => {
    if (isAutoSaving) {
      showClipboardStatus('Saving changes...')
      return
    }

    if (hasPendingUnsavedChanges) {
      if (!draft.title.trim()) {
        showClipboardStatus('Title is required before creating a new selection.')
        return
      }

      requestPendingUnsavedAction({ type: 'new-selection', dayIndex, minute }, anchor)
      return
    }

    startSelection(dayIndex, minute)
  }, [draft, hasPendingUnsavedChanges, isAutoSaving, requestPendingUnsavedAction, showClipboardStatus, startSelection])

  const handleDeleteSelected = async () => {
    if (!selectedEvent) return
    if (isSelectedReadOnly) return

    setIsDeleteConfirmOpen(false)
    const previous = events
    setEvents((prev) => prev.filter((item) => item.id !== selectedEvent.id))
    setSelectedItemId(null)
    setDraft((prev) => ({ ...prev, title: '', notes: '', categoryIds: [], recurrenceRule: { type: 'none' } }))
    setExpandedSections((prev) => {
      const next = new Set(prev)
      next.delete('editor')
      return next
    })
    try {
      await apiClient.delete(`/api/user-events/${selectedEvent.id}`)
    } catch (err) {
      console.error('Failed to delete item:', err)
      setEvents(previous)
      showClipboardStatus('Could not delete item. Try again.')
    }
  }

  const handleDeleteThisOccurrence = async () => {
    if (!selectedEvent || !selectedItem) return
    if (isSelectedReadOnly) return

    setIsDeleteConfirmOpen(false)
    const rule = normaliseRecurrenceRule(selectedEvent.recurrence_rule)
    if (rule.type === 'none') {
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
    if (rule.type === 'none') {
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
    setSelectionDraft((prev) => {
      if (!prev) return prev

      const stepSlots = Math.max(1, selectionAdjustStepSlots)
      const stepMinutes = slotMinutes * stepSlots
      const minDuration = slotMinutes
      const delta = direction * stepMinutes

      const nextStart = edge === 'start'
        ? Math.max(0, Math.min(prev.startMinute + delta, prev.endMinute - minDuration))
        : prev.startMinute
      const nextEnd = edge === 'end'
        ? Math.min(MINUTES_IN_DAY, Math.max(prev.endMinute + delta, prev.startMinute + minDuration))
        : prev.endMinute

      if (nextStart === prev.startMinute && nextEnd === prev.endMinute) {
        return prev
      }

      return {
        ...prev,
        startMinute: nextStart,
        endMinute: nextEnd,
      }
    })

    setSelectionLastChangedEdge(edge)
    if (selectionChangePulseTimeoutRef.current) {
      window.clearTimeout(selectionChangePulseTimeoutRef.current)
    }
    selectionChangePulseTimeoutRef.current = window.setTimeout(() => {
      setSelectionLastChangedEdge(null)
      selectionChangePulseTimeoutRef.current = null
    }, 800)
  }, [selectionAdjustStepSlots, slotMinutes])

  const nudgeSelectedItemEdge = useCallback(async (edge: 'start' | 'end', direction: -1 | 1): Promise<void> => {
    if (!selectedItem || isSelectedReadOnly) return

    const sourceEventId = selectedItem.sourceEventId || selectedItem.id
    const currentEvent = events.find((entry) => entry.id === sourceEventId)
    if (!currentEvent) return

    const stepSlots = Math.max(1, itemAdjustStepSlots)
    const stepMinutes = slotMinutes * stepSlots
    const minDuration = slotMinutes
    const delta = direction * stepMinutes

    const currentStart = selectedItem.startMinute
    const currentEnd = selectedItem.startMinute + getTimeItemTotalDurationMinutes(selectedItem, slotMinutes)

    const nextStart = edge === 'start'
      ? Math.max(0, Math.min(currentStart + delta, currentEnd - minDuration))
      : currentStart
    const nextEnd = edge === 'end'
      ? Math.min(MINUTES_IN_DAY, Math.max(currentEnd + delta, currentStart + minDuration))
      : currentEnd

    if (nextStart === currentStart && nextEnd === currentEnd) return

    const day = weekDays[selectedItem.dayIndex]
    const startTime = buildEventTimestamp(day, nextStart)
    const endTime = buildEventTimestamp(day, nextEnd)
    const previousEvent = currentEvent

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
      setEvents((prev) => prev.map((entry) => (entry.id === sourceEventId ? previousEvent : entry)))
      showClipboardStatus('Could not adjust start/end time. Try again.')
    }
  }, [events, isSelectedReadOnly, itemAdjustStepSlots, selectedItem, showClipboardStatus, slotMinutes, weekDays])

  const closeCalendarItemContextMenu = useCallback(() => {
    setCalendarItemContextMenu(null)
    setContextMenuDeleteConfirmOpen(false)
    setContextMenuCategorySubmenuOpen(false)
  }, [])

  const closeSelectionPasteContextMenu = useCallback(() => {
    setSelectionPasteContextMenu(null)
  }, [])

  useEffect(() => {
    if (!calendarItemContextMenu) return
    const handlePointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target as Node | null
      const menuEl = document.getElementById('calendar-item-context-menu')
      if (menuEl && target && menuEl.contains(target)) return
      closeCalendarItemContextMenu()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') closeCalendarItemContextMenu()
      if (event.key === 'Enter' && selectedItemId === calendarItemContextMenu.itemId && canSaveSelectedItem) {
        event.preventDefault()
        closeCalendarItemContextMenu()
        void handleUpdateItem()
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
  }, [calendarItemContextMenu, canSaveSelectedItem, closeCalendarItemContextMenu, handleUpdateItem, selectedItemId])

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
    top = Math.max(margin, top)
    setContextMenuPosition((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }))
  }, [calendarItemContextMenu, contextMenuDeleteConfirmOpen, contextMenuCategorySubmenuOpen])

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
        void handleSaveSelection()
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
  }, [canSaveNewSelectionItem, closeSelectionPasteContextMenu, handleSaveSelection, selectionPasteContextMenu])

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
    void handleUpdateItem()
  }, [closeCalendarItemContextMenu, handleUpdateItem])

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
    setDraft({
      title: target.title,
      notes: target.notes,
      categoryIds: target.categoryIds,
      sourceId: target.sourceId,
      recurrenceRule: target.recurrenceRule || { type: 'none' },
    })
    setIsLeftPanelOpen(true)
    setExpandedSections((prev) => {
      const next = new Set(prev)
      next.add('editor')
      return next
    })
    showClipboardStatus('Move mode active. Select a new date and time, then click Save Item.')
    return true
  }, [interactionItemMap, items, showClipboardStatus, slotMinutes, sourceMap])

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
    const target = targetItem ? events.find((entry) => entry.id === targetItem.sourceEventId) : null
    if (!target) {
      closeCalendarItemContextMenu()
      return
    }
    const source = sourceMap.get(target.source_id || activeMainSourceId)
    if (isReadOnlySource(source)) {
      showClipboardStatus('Read-only item cannot be deleted here.')
      closeCalendarItemContextMenu()
      return
    }
    const previous = events
    setEvents((prev) => prev.filter((entry) => entry.id !== target.id))
    if (selectedItemId === itemId) {
      setSelectedItemId(null)
      setDraft((prev) => ({ ...prev, title: '', notes: '', categoryIds: [], recurrenceRule: { type: 'none' } }))
    }
    if (movingItemId === itemId) {
      setMovingItemId(null)
      setMovingItemSnapshot(null)
      setSelectionDraft(null)
    }
    closeCalendarItemContextMenu()
    try {
      await apiClient.delete(`/api/user-events/${target.id}`)
    } catch (err) {
      console.error('Failed to delete item:', err)
      setEvents(previous)
      showClipboardStatus('Could not delete item. Try again.')
    }
  }, [activeMainSourceId, closeCalendarItemContextMenu, events, interactionItemMap, items, movingItemId, selectedItemId, showClipboardStatus, sourceMap])

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
    if (rule.type === 'none') {
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
    if (rule.type === 'none') {
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
    const target = events.find((entry) => entry.id === sourceEventId)
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
    const previous = events
    setEvents((prev) => prev.map((entry) => (entry.id === target.id ? { ...entry, category_ids: nextIds } : entry)))
    if (selectedItemId === itemId) {
      setDraft((prev) => ({ ...prev, categoryIds: nextIds }))
    }

    if (target.id.startsWith('pending-')) {
      return
    }

    try {
      await apiClient.put(`/api/user-events/${target.id}`, { category_ids: nextIds })
    } catch (err) {
      console.error('Failed to update categories:', err)
      setEvents(previous)
      showClipboardStatus('Could not update categories. Try again.')
    }
  }, [activeMainSourceId, events, interactionItemMap, items, selectedItemId, showClipboardStatus, sourceMap])

  const getContextMenuTargetCategoryIds = useCallback((): string[] => {
    if (!calendarItemContextMenu) return []
    const targetItem = interactionItemMap.get(calendarItemContextMenu.itemId)
      || items.find((entry) => entry.id === calendarItemContextMenu.itemId)
    const sourceEventId = targetItem?.sourceEventId || calendarItemContextMenu.itemId
    const targetEvent = events.find((entry) => entry.id === sourceEventId)
    return Array.isArray(targetEvent?.category_ids) ? targetEvent.category_ids : []
  }, [calendarItemContextMenu, events, interactionItemMap, items])

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
      const isSameSelection = selectedDraftHydratedItemIdRef.current === selectedItem.id
      if (isSameSelection && isSelectedItemDirty) {
        return
      }

      setDraft((prev) => {
        const hasTitleChanges = prev.title !== selectedItem.title
        const hasNotesChanges = prev.notes !== selectedItem.notes
        const hasSourceChanges = prev.sourceId !== selectedItem.sourceId
        const hasCategoryChanges = !areStringArraysEqual(prev.categoryIds, selectedItem.categoryIds)
        const selectedEventRecurrence = normaliseRecurrenceRule(selectedEvent?.recurrence_rule)
        const hasRecurrenceChanges = JSON.stringify(normaliseRecurrenceRule(prev.recurrenceRule)) !== JSON.stringify(selectedEventRecurrence)

        if (!hasTitleChanges && !hasNotesChanges && !hasSourceChanges && !hasCategoryChanges && !hasRecurrenceChanges) {
          return prev
        }

        return {
          title: selectedItem.title,
          notes: selectedItem.notes,
          categoryIds: selectedItem.categoryIds,
          sourceId: selectedItem.sourceId,
          recurrenceRule: selectedEventRecurrence,
        }
      })
      selectedDraftHydratedItemIdRef.current = selectedItem.id
      if (!isSameSelection) {
        setShowItemRecurrencePanel(Boolean(selectedEvent?.recurrence_rule && selectedEvent.recurrence_rule.type !== 'none'))
      }
      return
    }

    selectedDraftHydratedItemIdRef.current = null

    if (selectionDraft) {
      setDraft((prev) => ({
        ...prev,
        sourceId: MAIN_SOURCE_ID,
        recurrenceRule: { type: 'none' },
      }))
    }
  }, [isSelectedItemDirty, selectedEvent?.recurrence_rule, selectedItem, selectionDraft])

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
        void handleSaveSelection()
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
        if (selectedItem && copySelectedItem()) {
          event.preventDefault()
        }
      }

      if (key === 'x') {
        if (!selectedItem) {
          return
        }

        if (startMoveItem(selectedItem.id)) {
          event.preventDefault()
        }
      }

      if (key === 'v') {
        if (selectionDraft && copiedItem) {
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
        void handleSaveSelection()
        return
      }

      if (event.key === 'Backspace') {
        event.preventDefault()
        setDraft((prev) => ({ ...prev, title: prev.title.slice(0, -1) }))
        setIsLeftPanelOpen(true)
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
        setIsLeftPanelOpen(true)
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
        setIsLeftPanelOpen(true)
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
    handleSaveSelection,
    handleDiscardSelectionDraft,
    isFullEditorOpen,
    isSelectionTitleTypingMode,
    movingItemId,
    pasteCopiedItemToSelection,
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
  const handleMainColorChange = async (nextColor: string) => {
    const previous = prefs
    setPrefs((prev) => ({ ...prev, main_color: nextColor }))
    try {
      if (activeModeId) {
        await apiClient.put(`/api/time-management/modes/${activeModeId}`, { main_color: nextColor })
      } else {
        await apiClient.put('/api/time-management/prefs', { main_color: nextColor })
      }
    } catch (err) {
      console.error('Failed to update Main calendar color:', err)
      setPrefs(previous)
      showClipboardStatus('Could not save Main calendar color.')
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable handler; wrapping in useCallback would cascade through co-located helpers in this large view
  const handleMainLabelCommit = async (nextLabel: string) => {
    const trimmed = nextLabel.trim() || 'Coordination Manager Main'
    if (trimmed === prefs.main_label && nextLabel === prefs.main_label) return
    const previous = prefs
    setPrefs((prev) => ({ ...prev, main_label: trimmed }))
    try {
      if (activeModeId) {
        await apiClient.put(`/api/time-management/modes/${activeModeId}`, { name: trimmed })
      } else {
        await apiClient.put('/api/time-management/prefs', { main_label: trimmed })
      }
    } catch (err) {
      console.error('Failed to update Main calendar label:', err)
      setPrefs(previous)
      showClipboardStatus('Could not save Main calendar label.')
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable handler; wrapping in useCallback would cascade through co-located helpers in this large view
  const handleCategoryColorDisplayStyleChange = async (nextStyle: CategoryColorDisplayStyle) => {
    if (nextStyle === prefs.category_color_display_style) return

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
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable handler; wrapping in useCallback would cascade through co-located helpers in this large view
  const openExportDialog = () => {
    if (!selectedEvent) return
    setExportTargetIds(new Set())
    setExportStatus(null)
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

  const runTimeManagementAiAction = useCallback(async (action: TimeManagementAiAction, applied: string[]) => {
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
      if (!target) return
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
      if (!target) return
      handleDeleteTimeBackground(target.id)
      setIsLeftPanelOpen(true)
      setSectionExpanded('timeWidth', true)
      scrollSectionToMiddle('timeWidth')
      applied.push(`Deleted background period "${target.label || 'period'}"`)
      return
    }
    if (action.type === 'create_mode') {
      await handleCreateMode()
      setIsLeftPanelOpen(true)
      setSectionExpanded('modes', true)
      scrollSectionToMiddle('modes')
      applied.push('Created a new mode')
      return
    }
    if (action.type === 'activate_mode' && action.modeName) {
      const needle = action.modeName.toLowerCase().trim()
      const matchedMode = modes.find((mode) => mode.name.toLowerCase().includes(needle))
      if (matchedMode) {
        await handleActivateMode(matchedMode.id)
        setIsLeftPanelOpen(true)
        setSectionExpanded('modes', true)
        scrollSectionToMiddle('modes')
        applied.push(`Activated mode "${matchedMode.name}"`)
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
        }
      } catch {
        // no-op: explanation from AI response is still shown
      }
      return
    }
    if (action.type === 'set_category_display_style' && action.style) {
      await handleCategoryColorDisplayStyleChange(action.style)
      setIsLeftPanelOpen(true)
      setSectionExpanded('categories', true)
      scrollSectionToMiddle('categories')
      applied.push(`Set category display style to ${action.style}`)
      return
    }
    if (action.type === 'set_main_label' && action.label) {
      const nextLabel = action.label
      setPrefs((prev) => ({ ...prev, main_label: nextLabel }))
      await handleMainLabelCommit(nextLabel)
      setIsLeftPanelOpen(true)
      setSectionExpanded('sources', true)
      scrollSectionToMiddle('sources')
      applied.push(`Updated Main label to "${nextLabel}"`)
      return
    }
    if (action.type === 'set_main_color' && action.color && isHexColor(action.color)) {
      await handleMainColorChange(action.color)
      setIsLeftPanelOpen(true)
      setSectionExpanded('sources', true)
      scrollSectionToMiddle('sources')
      applied.push('Updated Main calendar color')
      return
    }
    if (action.type === 'open_export_dialog') {
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
  ) => {
    const preferredModel = user?.themePreferences?.aiSettings?.preferredModel || 'openai'

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
    }

    const { data } = await apiClient.post<TimeManagementAiResponse>('/api/ai-chat/time-management', {
      message,
      history,
      currentState,
      preferredModel,
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
    for (const action of finalActions) {
      await runTimeManagementAiAction(action, applied)
    }

    if (convertedPrimaryTimezoneActions > 0) {
      applied.push('Preserved your primary timezone and added the requested timezone instead')
    }

    const summary = typeof data?.summary === 'string' && data.summary.trim().length > 0
      ? data.summary.trim()
      : 'Time Management updates completed.'
    const details = typeof data?.explanation === 'string' ? data.explanation.trim() : ''
    const actionLog = applied.length > 0
      ? `\n\nApplied actions:\n- ${applied.join('\n- ')}`
      : ''
    const whereToFind = '\n\nWhere to find results: Left side panel -> Time Management Tools.'

    return {
      message: `${summary}${details ? `\n\n${details}` : ''}${actionLog}${whereToFind}`,
      action: 'configure_time_management',
    }
  }, [
    activeModeId,
    canCreateMoreModes,
    categories,
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
    (message: string, history?: Array<{ role: 'user' | 'assistant'; content: string }>) =>
      handleTimeManagementAiSubmitRef.current(message, history),
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
    })
    return () => setPageContext(null)
  }, [setPageContext, stableTimeManagementAiSubmit])

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
      return 'border-blue-400/60 bg-blue-500/12 hover:bg-blue-500/16 dark:bg-blue-950/35 dark:hover:bg-blue-900/40'
    }
    if (status === 'error') {
      return 'border-red-400/60 bg-red-500/10 hover:bg-red-500/14 dark:bg-red-950/30 dark:hover:bg-red-900/35'
    }
    if (status === 'disabled') {
      return 'border-border bg-muted/35 hover:bg-muted/55'
    }
    return 'border-emerald-400/60 bg-emerald-500/10 hover:bg-emerald-500/14 dark:bg-emerald-950/30 dark:hover:bg-emerald-900/35'
  }, [getSourceStatus])

  const renderSourceStatusBadge = useCallback((source: SyncCalendar) => {
    const status = getSourceStatus(source)
    if (status === 'loading') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-blue-400/50 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-300">
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
          Loading
        </span>
      )
    }
    if (status === 'error') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-red-400/60 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-300">
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
        className="inline-flex items-center gap-1 rounded-full border border-emerald-400/60 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300"
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
      className={`grid bg-card/95 backdrop-blur-sm ${position === 'top' ? 'border-b border-border' : 'sticky bottom-0 z-20 border-t border-border shadow-[0_-1px_0_hsl(var(--border))]'}`}
      style={{ gridTemplateColumns: weekGridTemplateColumns }}
    >
      {tzState.all.map((tz, tzIdx) => {
        const isPrimary = tzIdx === 0
        const isUtc = tz === 'UTC'
        const entry = isUtc ? null : findTimezone(tz)
        const city = isUtc ? 'UTC' : (entry?.city ?? tz.split('/').pop()?.replace(/_/g, ' ') ?? tz)
        const abbr = isUtc ? '' : (entry?.abbr ?? '')
        const ct = isUtc
          ? `${nowTick.getUTCHours().toString().padStart(2, '0')}:${nowTick.getUTCMinutes().toString().padStart(2, '0')}`
          : getCurrentTimeInTimezone(tz)
        return (
          <div
            key={`${position}-${tz}`}
            className={`flex flex-col items-center justify-between border-r border-border px-0.5 py-1.5 ${
              isPrimary ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'
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
      {weekDays.map((day) => {
        const isHighlightedDay = highlightedDay ? isSameDay(day, highlightedDay) : false
        return (
          <div
            key={`${position}-${day.toISOString()}`}
            className={`border-r border-border px-2 py-2 text-center text-xs font-semibold text-foreground last:border-r-0 transition-shadow ${
              isHighlightedDay ? 'animate-pulse bg-blue-50/80 ring-2 ring-inset ring-blue-500/70 dark:bg-blue-950/30' : ''
            }`}
          >
            <div>{format(day, 'EEE')}</div>
            <div className="text-[11px] text-muted-foreground">{format(day, 'd MMM')}</div>
          </div>
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
            className="fixed inset-0 z-[94] bg-black/55"
            onClick={closeLeftPanel}
          />
        )}
        <aside
          ref={leftPanelAsideRef}
          className={`${isPhoneLayout ? 'fixed inset-0 z-[95] h-screen w-screen border-0 shadow-2xl' : 'sticky top-0 h-screen shrink-0 border-r border-border'} overflow-hidden bg-card transition-[width,transform,opacity] duration-300 ease-out ${
            isLeftPanelResizing ? 'duration-75' : ''
          }`}
          style={{ width: isPhoneLayout ? (isToolsSurfaceVisible ? '100vw' : 0) : (isLeftPanelOpen ? `${leftPanelWidthPx}px` : 0) }}
        >
          <div
            className={`flex h-full min-w-0 flex-col transition-all duration-300 ease-out ${
              isToolsSurfaceVisible ? 'translate-x-0 opacity-100' : (isPhoneLayout ? 'translate-x-full opacity-0' : '-translate-x-3 opacity-0')
            }`}
            style={{ width: isPhoneLayout ? '100vw' : `${leftPanelWidthPx}px` }}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">{showMobileQuickObjectsOverlay ? 'Quick Objects' : 'Time Management Tools'}</h2>
              <button
                onClick={closeLeftPanel}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Close side panel"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>

            <div ref={leftPanelScrollRef} className="flex-1 overflow-y-auto px-3 py-3 after:block after:h-[33vh] after:content-['']">
              <div className="space-y-4">
                <section ref={sectionModesRef} className="rounded-lg border border-border bg-background/50 p-3">
                  <button
                    type="button"
                    onClick={() => toggleSection('modes')}
                    className="flex w-full items-center gap-2 text-left text-sm font-semibold text-foreground"
                    title={expandedSections.has('modes') ? 'Collapse calendar modes' : 'Expand calendar modes'}
                  >
                    <Calendar className="h-4 w-4 text-indigo-600" />
                    <span>Calendar Modes</span>
                    <span className="ml-auto text-muted-foreground">
                      {expandedSections.has('modes') ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </span>
                  </button>

                  {expandedSections.has('modes') && (
                    <>
                      <p className="mb-2 mt-2 text-xs text-muted-foreground">
                        Select a mode, then use Add or Import to create another. Main is the default active mode.
                      </p>

                      <div className="mb-2 rounded-md border border-border bg-background/70 p-2">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold text-foreground">Hidden mode</p>
                            <p className="text-[11px] text-muted-foreground">Hide calendar item names and blur editor text.</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setIsHiddenModeEnabled((prev) => !prev)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              isHiddenModeEnabled ? 'bg-amber-600' : 'bg-muted'
                            }`}
                            aria-label="Toggle hidden mode"
                            aria-pressed={isHiddenModeEnabled}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                isHiddenModeEnabled ? 'translate-x-6' : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {(modes.length > 0 ? modes : [{ id: MAIN_SOURCE_ID, name: 'Main' } as Pick<TimeManagementMode, 'id' | 'name'>]).map((mode) => {
                          const isActive = mode.id === activeModeId || (!activeModeId && mode.id === MAIN_SOURCE_ID)
                          return (
                            <button
                              key={mode.id}
                              type="button"
                              onClick={() => {
                                if (modes.length > 0) {
                                  void handleActivateMode(mode.id)
                                }
                              }}
                              disabled={isModesLoading}
                              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                                isActive
                                  ? `border-indigo-500 bg-indigo-600 text-white shadow-sm ${
                                      highlightedModeId === mode.id
                                        ? 'animate-[pulse_0.9s_ease-in-out_2] ring-2 ring-indigo-300/70'
                                        : ''
                                    }`
                                  : 'border-border bg-background text-foreground hover:bg-muted'
                              }`}
                              aria-pressed={isActive}
                            >
                              {mode.name}
                            </button>
                          )
                        })}
                      </div>

                      {canCreateMoreModes && (
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => { void handleCreateMode() }}
                            disabled={isCreatingMode}
                            className="flex-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isCreatingMode ? 'Creating...' : 'Add Mode'}
                          </button>
                          <button
                            type="button"
                            onClick={() => { void handleImportMode() }}
                            disabled={isCreatingMode || isImportingModeJson}
                            className="flex-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isImportingModeJson ? 'Importing...' : 'Import JSON'}
                          </button>
                        </div>
                      )}

                      <div className="mt-3 rounded-md border border-border bg-background/70 p-2.5">
                        <button
                          type="button"
                          onClick={() => {
                            setIsModeSettingsOpen((prev) => !prev)
                            const currentMode = modes.find((mode) => mode.id === activeModeId)
                            setModeNameDraft(currentMode?.name || 'Main')
                            setModeDeleteState({ open: false, action: null, transferToModeId: null })
                          }}
                          className="flex w-full items-center gap-2 text-left text-xs font-semibold text-foreground"
                          title={isModeSettingsOpen ? 'Collapse settings' : 'Expand settings'}
                        >
                          <span>Settings</span>
                          <span className="ml-auto text-muted-foreground">
                            {isModeSettingsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </span>
                        </button>

                        {isModeSettingsOpen && (
                          <div className="mt-3 space-y-3">
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
                                    ? 'animate-[pulse_0.9s_ease-in-out_2] border-indigo-500 shadow-[0_0_0_3px_rgba(99,102,241,0.25)]'
                                    : 'border-border'
                                }`}
                              />
                              <div className="mt-2 grid grid-cols-3 gap-2">
                                <button
                                  type="button"
                                  onClick={handleSaveModeNameClick}
                                  disabled={isRenamingMode || !hasModeNameValue}
                                  aria-disabled={!canSaveModeName}
                                  className={`w-full rounded-md px-2.5 py-1.5 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                                    canSaveModeName
                                      ? 'bg-indigo-600 text-white hover:bg-indigo-500'
                                      : `border border-border text-foreground hover:bg-muted ${
                                          isModeNameSaveNoChangePulse
                                            ? 'animate-[pulse_0.35s_ease-in-out_1]'
                                            : ''
                                        }`
                                  }`}
                                >
                                  {isRenamingMode ? 'Saving...' : 'Save Name'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { void handleExportCurrentModeJson() }}
                                  className="w-full rounded-md border border-border px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
                                >
                                  Show JSON
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { void handleDuplicateMode() }}
                                  disabled={isDuplicatingMode || isCreatingMode || !canCreateMoreModes || !activeModeId}
                                  className="w-full rounded-md border border-border px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                                  title={canCreateMoreModes ? 'Duplicate current mode' : `Maximum ${MAX_MODE_COUNT} modes reached`}
                                >
                                  {isDuplicatingMode ? 'Duplicating...' : 'Duplicate'}
                                </button>
                              </div>
                              {modeNameSaveFeedback && (
                                <p className="mt-2 text-[11px] text-muted-foreground">
                                  {modeNameSaveFeedback}
                                </p>
                              )}
                            </div>

                            {modes.length > 1 && (
                              <div className="rounded-md border border-red-200 bg-red-50/60 p-2.5 dark:border-red-900 dark:bg-red-950/20">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setModeDeleteState((prev) => {
                                      if (prev.open) {
                                        return { open: false, action: null, transferToModeId: null }
                                      }
                                      return { open: true, action: null, transferToModeId: null }
                                    })
                                  }}
                                  className="flex w-full items-center gap-2 text-left"
                                  title={modeDeleteState.open ? 'Collapse delete mode' : 'Expand delete mode'}
                                >
                                  <span className="text-[11px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">
                                    Delete mode
                                  </span>
                                  <span className="ml-auto text-red-700/80 dark:text-red-300/80">
                                    {modeDeleteState.open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                  </span>
                                </button>

                                {modeDeleteState.open && (
                                  <div className="mt-2 space-y-2">
                                    <p className="text-xs text-muted-foreground">
                                      Move the calendar data to another mode or delete it completely.
                                    </p>

                                    {modeDeleteState.action !== 'move' ? (
                                      <div className="flex flex-wrap gap-2 pt-1">
                                        <button
                                          type="button"
                                          onClick={() => setModeDeleteState((prev) => ({ ...prev, action: 'move', transferToModeId: null }))}
                                          className="rounded-md bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-red-500"
                                        >
                                          Delete + Move
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => { void handleDeleteCurrentMode(null) }}
                                          className="rounded-md border border-red-300 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
                                        >
                                          Delete All
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setModeDeleteState({ open: false, action: null, transferToModeId: null })}
                                          className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                                        >
                                          Cancel
                                        </button>
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
                                                <button
                                                  key={mode.id}
                                                  type="button"
                                                  onClick={() => setModeDeleteState((prev) => ({ ...prev, transferToModeId: mode.id }))}
                                                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                                                    isSelected
                                                      ? 'border-indigo-500 bg-indigo-600 text-white'
                                                      : 'border-border bg-background text-foreground hover:bg-muted'
                                                  }`}
                                                >
                                                  {mode.name}
                                                </button>
                                              )
                                            })}
                                        </div>
                                        <div className="flex flex-wrap gap-2 pt-1">
                                          <button
                                            type="button"
                                            onClick={() => { void handleDeleteCurrentMode(modeDeleteState.transferToModeId) }}
                                            disabled={!modeDeleteState.transferToModeId}
                                            className="rounded-md bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                                          >
                                            Confirm
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setModeDeleteState((prev) => ({ ...prev, action: null, transferToModeId: null }))}
                                            className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                                          >
                                            Back
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setModeDeleteState({ open: false, action: null, transferToModeId: null })}
                                            className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                                          >
                                            Cancel
                                          </button>
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
                    </>
                  )}
                </section>

                <section ref={sectionMonthRef} className="rounded-lg border border-border bg-background/50 p-3">
                  <button
                    type="button"
                    onClick={() => toggleSection('month')}
                    className="flex w-full items-center gap-2 text-left text-sm font-semibold text-foreground"
                    title={expandedSections.has('month') ? 'Collapse month overview' : 'Expand month overview'}
                  >
                    <CalendarDays className="h-4 w-4 text-blue-600" />
                    <span>Month Overview</span>
                    <span className="ml-auto text-muted-foreground">
                      {expandedSections.has('month') ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </span>
                  </button>

                  {expandedSections.has('month') && (
                    <>
                      <div className="mb-2 mt-2 flex items-center justify-end gap-0.5">
                        <button
                          onClick={() => setMiniCalMonth((prev) => subMonths(prev, 1))}
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          title="Previous month"
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setMiniCalMonth(startOfMonth(new Date()))}
                          className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
                          title="Jump to today"
                        >
                          Today
                        </button>
                        <button
                          onClick={() => setMiniCalMonth((prev) => addMonths(prev, 1))}
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          title="Next month"
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <div className="rounded-md border border-border/80 bg-card p-2">
                        <div className="mb-1.5 flex items-center justify-between gap-1.5 text-xs font-semibold text-muted-foreground">
                          <span>{format(miniCalMonth, 'MMMM yyyy')}</span>
                          <button
                            type="button"
                            onClick={() => setMiniCalMonth((prev) => addYears(prev, 1))}
                            className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-foreground hover:bg-muted"
                            title="Next year"
                          >
                            +1Y
                          </button>
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
                                    ? 'bg-blue-600 text-white'
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
                    </>
                  )}
                </section>

                <section ref={sectionSourcesRef} className="rounded-lg border border-border bg-background/50 p-3">
                  <button
                    type="button"
                    onClick={() => toggleSection('sources')}
                    className="flex w-full items-center gap-2 text-left text-sm font-semibold text-foreground"
                    title={expandedSections.has('sources') ? 'Collapse calendar sources' : 'Expand calendar sources'}
                  >
                    <Unplug className="h-4 w-4 text-emerald-600" />
                    <span>Calendar Sources</span>
                    <span className="ml-auto text-muted-foreground">
                      {expandedSections.has('sources') ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </span>
                  </button>

                  {expandedSections.has('sources') && (
                    <>
                      <p className="mb-3 mt-2 text-xs text-muted-foreground">
                        App and connected calendars from Settings are listed here. Toggle each to show or hide.
                      </p>

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
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.preventDefault()
                                        event.stopPropagation()
                                        setIsMainColorOpen((prev) => !prev)
                                      }}
                                      className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                                      title="Edit Main calendar color and label"
                                      aria-label="Edit Main calendar color and label"
                                    >
                                      <Palette className="h-3.5 w-3.5" />
                                    </button>
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
                          <button
                            type="button"
                            onClick={handleRefreshCurrentWeek}
                            disabled={isExternalSyncing || enabledExternalSources.length === 0}
                            className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                            title={enabledExternalSources.length === 0 ? 'Enable at least one connected calendar to sync the current week.' : 'Sync the selected connected calendars for the current week'}
                          >
                            {isExternalSyncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                            Sync
                          </button>
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
                    </>
                  )}
                </section>

                <section ref={sectionCategoriesRef} className="rounded-lg border border-border bg-background/50 p-3">
                  <button
                    type="button"
                    onClick={() => toggleSection('categories')}
                    className="flex w-full items-center gap-2 text-left text-sm font-semibold text-foreground"
                    title={expandedSections.has('categories') ? 'Collapse categories' : 'Expand categories'}
                  >
                    <Palette className="h-4 w-4 text-purple-600" />
                    <span>Categories</span>
                    <span className="ml-auto text-muted-foreground">
                      {expandedSections.has('categories') ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </span>
                  </button>

                  {expandedSections.has('categories') && (
                    <>
                      <p className="mb-2 mt-2 text-xs text-muted-foreground">
                        Custom category tags for your time items. Use each tag color for the card background or the card font.
                      </p>

                      <div className="mb-3">
                        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Color Display Style
                        </label>
                        <div className="inline-flex flex-wrap rounded-md border border-border bg-muted/30 p-0.5">
                          <button
                            type="button"
                            onClick={() => { void handleCategoryColorDisplayStyleChange('horizontal') }}
                            className={`rounded px-2 py-1 text-[11px] font-semibold transition-colors ${
                              prefs.category_color_display_style === 'horizontal'
                                ? 'bg-background text-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            Horizontal
                          </button>
                          <button
                            type="button"
                            onClick={() => { void handleCategoryColorDisplayStyleChange('vertical_left') }}
                            className={`rounded px-2 py-1 text-[11px] font-semibold transition-colors ${
                              prefs.category_color_display_style === 'vertical_left'
                                ? 'bg-background text-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            Vertical Left
                          </button>
                          <button
                            type="button"
                            onClick={() => { void handleCategoryColorDisplayStyleChange('vertical_right') }}
                            className={`rounded px-2 py-1 text-[11px] font-semibold transition-colors ${
                              prefs.category_color_display_style === 'vertical_right'
                                ? 'bg-background text-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            Vertical Right
                          </button>
                        </div>
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
                                <div className="mb-2 inline-flex rounded-md border border-border bg-muted/30 p-0.5">
                                  <button
                                    type="button"
                                    onClick={() => setCategoryColorTarget('background')}
                                    className={`rounded px-2 py-1 text-[11px] font-semibold transition-colors ${
                                      categoryColorTarget === 'background'
                                        ? 'bg-background text-foreground shadow-sm'
                                        : 'text-muted-foreground hover:text-foreground'
                                    }`}
                                  >
                                    Background Color
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setCategoryColorTarget('font')}
                                    className={`rounded px-2 py-1 text-[11px] font-semibold transition-colors ${
                                      categoryColorTarget === 'font'
                                        ? 'bg-background text-foreground shadow-sm'
                                        : 'text-muted-foreground hover:text-foreground'
                                    }`}
                                  >
                                    Font Color
                                  </button>
                                </div>
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
                                  <button
                                    type="button"
                                    onClick={() => { void handleSaveCategory() }}
                                    disabled={!categoryDraft.label.trim()}
                                    className="flex-1 rounded-md bg-blue-600 px-2 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={cancelCategoryEdit}
                                    className="rounded-md border border-border px-2 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                                  >
                                    Cancel
                                  </button>
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
                              <button
                                type="button"
                                onClick={() => startEditCategory(cat)}
                                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                                aria-label={`Edit ${cat.label}`}
                                title="Edit category"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setCategoryDeleteTarget(cat)}
                                className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                                aria-label={`Delete ${cat.label}`}
                                title="Delete category"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
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
                            <div className="mb-2 inline-flex rounded-md border border-border bg-muted/30 p-0.5">
                              <button
                                type="button"
                                onClick={() => setCategoryColorTarget('background')}
                                className={`rounded px-2 py-1 text-[11px] font-semibold transition-colors ${
                                  categoryColorTarget === 'background'
                                    ? 'bg-background text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                                }`}
                              >
                                Background Color
                              </button>
                              <button
                                type="button"
                                onClick={() => setCategoryColorTarget('font')}
                                className={`rounded px-2 py-1 text-[11px] font-semibold transition-colors ${
                                  categoryColorTarget === 'font'
                                    ? 'bg-background text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                                }`}
                              >
                                Font Color
                              </button>
                            </div>
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
                              <button
                                type="button"
                                onClick={() => { void handleSaveCategory() }}
                                disabled={!categoryDraft.label.trim()}
                                className="flex-1 rounded-md bg-blue-600 px-2 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Create
                              </button>
                              <button
                                type="button"
                                onClick={cancelCategoryEdit}
                                className="rounded-md border border-border px-2 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}

                        {!categoryDraft && (
                          <button
                            type="button"
                            onClick={startCreateCategory}
                            className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-border px-2.5 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Add Category
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </section>

                <section ref={sectionTimeWidthRef} className="rounded-lg border border-border bg-background/50 p-3">
                  <button
                    type="button"
                    onClick={() => toggleSection('timeWidth')}
                    className="flex w-full items-center gap-2 text-left text-sm font-semibold text-foreground"
                    title={expandedSections.has('timeWidth') ? 'Collapse time width and background' : 'Expand time width and background'}
                  >
                    <Calendar className="h-4 w-4 text-cyan-600" />
                    <span>Time Width and background</span>
                    <span className="ml-auto text-muted-foreground">
                      {expandedSections.has('timeWidth') ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </span>
                  </button>
                  {expandedSections.has('timeWidth') && (
                    <>
                      <p className="mb-2 mt-2 text-xs text-muted-foreground">
                        Set the slot width for this grid and add recurring background periods to visually mark parts of each day.
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        {[15, 30, 60].map((minutes) => {
                          const isActive = slotMinutes === minutes
                          const label = minutes === 60 ? '1h' : `${minutes}m`
                          return (
                            <button
                              key={minutes}
                              type="button"
                              onClick={() => setSlotMinutes(minutes as TimeWidth)}
                              className={`rounded-md border px-2 py-1.5 text-xs font-semibold transition-colors ${
                                isActive
                                  ? 'border-cyan-400 bg-cyan-100 text-cyan-800 dark:border-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300'
                                  : 'border-border text-foreground hover:bg-muted'
                              }`}
                              aria-pressed={isActive}
                            >
                              {label}
                            </button>
                          )
                        })}
                      </div>

                      <div className="mt-3 rounded-md border border-border/80 bg-muted/30 p-2.5">
                        <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                          <Palette className="h-3.5 w-3.5 text-cyan-600" />
                          <span>Recurring background periods</span>
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Use color bands for patterns like typical meeting hours, focus blocks, or sleep windows. End times earlier than start times wrap overnight.
                        </p>

                        <button
                          type="button"
                          onClick={handleAddTimeBackground}
                          className="mt-3 flex w-full items-center justify-center gap-1 rounded-md bg-blue-600 px-2.5 py-2 text-xs font-semibold text-white"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Create new Background period
                        </button>

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
                                    <button
                                      type="button"
                                      onClick={() => toggleTimeBackgroundCard(period.id)}
                                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                                      aria-label={isCollapsed ? `Expand background period ${index + 1}` : `Collapse background period ${index + 1}`}
                                      title={isCollapsed ? 'Expand background period' : 'Collapse background period'}
                                    >
                                      {isCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
                                    </button>
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
                                      <button
                                        type="button"
                                        onClick={() => setDeletingBackgroundId((current) => (current === period.id ? null : period.id))}
                                        className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                                        aria-label={`Delete background period ${index + 1}`}
                                        title="Delete background period"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                      {deletingBackgroundId === period.id && (
                                        <div className="absolute right-0 top-full z-[140] mt-2 w-52 max-w-[calc(100vw-1rem)] rounded-md border border-red-200 bg-background p-2 shadow-lg dark:border-red-900">
                                          <p className="mb-2 text-xs text-foreground">Delete this item?</p>
                                          <div className="flex items-center justify-end gap-2">
                                            <button
                                              type="button"
                                              onClick={() => setDeletingBackgroundId(null)}
                                              className="rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                                            >
                                              Cancel
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleDeleteTimeBackground(period.id)}
                                              className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                                            >
                                              Confirm
                                            </button>
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
                                    <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                      Start
                                      <input
                                        type="time"
                                        step={900}
                                        value={formatTimeInput(period.startMinute)}
                                        onChange={(event) => updateTimeBackground(period.id, { startMinute: parseTimeInput(event.target.value) })}
                                        className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                                      />
                                    </label>
                                    <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                      End
                                      <input
                                        type="time"
                                        step={900}
                                        value={formatTimeInput(period.endMinute)}
                                        onChange={(event) => updateTimeBackground(period.id, { endMinute: parseTimeInput(event.target.value) })}
                                        className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                                      />
                                    </label>
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
                    </>
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
                    <button
                      type="button"
                      onClick={() => toggleSection('editor')}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-semibold text-foreground"
                      title={expandedSections.has('editor') ? 'Collapse editor' : 'Expand editor'}
                    >
                      <Plus className="h-4 w-4 text-orange-600" />
                      <span>{selectedItem ? 'Edit Time Item' : 'Create Time Item'}</span>
                      <span className="ml-auto text-muted-foreground">
                        {expandedSections.has('editor') ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={openFullEditor}
                      className="inline-flex items-center gap-1 rounded-md border border-blue-400/70 bg-blue-600 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-blue-500"
                      title="Open full view editor"
                    >
                      <Maximize2 className="h-4 w-4" />
                      Full view
                    </button>
                  </div>

                  {expandedSections.has('editor') && (
                    <>
                      {selectionDraft && !selectedItem && (
                        <div className="mb-2 mt-2 rounded-md border border-orange-200 bg-orange-50/70 p-2 text-xs text-orange-700 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-300">
                          {movingItemId ? 'Move selection:' : 'Selection:'} {format(weekDays[selectionDraft.dayIndex], 'EEE d MMM')} {formatMinuteLabel(selectionDraft.startMinute, tzState.primary, slotMinutes)}-
                          {formatMinuteLabel(selectionDraft.endMinute, tzState.primary, slotMinutes)}

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
                                  <div className="rounded-md border border-orange-300/70 bg-white/90 px-2 py-1 dark:border-orange-700/70 dark:bg-orange-950/30">
                                    <span className="mb-1 block font-medium">Step interval</span>
                                    <div className="grid grid-cols-3 gap-1">
                                      {[1, 2, 4].map((stepMultiplier) => {
                                        const isActive = selectionAdjustStepSlots === stepMultiplier
                                        return (
                                          <button
                                            key={stepMultiplier}
                                            type="button"
                                            onClick={() => setSelectionAdjustStepSlots(stepMultiplier)}
                                            className={`rounded-md border px-1.5 py-1 text-[11px] font-semibold transition-colors ${
                                              isActive
                                                ? 'border-orange-600 bg-orange-600 text-white'
                                                : 'border-orange-300 bg-background text-orange-700 hover:bg-orange-100 dark:border-orange-700 dark:text-orange-200 dark:hover:bg-orange-900/40'
                                            }`}
                                          >
                                            {slotMinutes * stepMultiplier}m
                                          </button>
                                        )
                                      })}
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-2 gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => nudgeSelectionDraftEdge('start', -1)}
                                      className="rounded-md border border-orange-300 bg-white/90 px-2 py-1.5 text-orange-700 hover:bg-orange-100 dark:border-orange-700 dark:bg-orange-900/40 dark:text-orange-100"
                                      title={`Move start ${slotMinutes * Math.max(1, selectionAdjustStepSlots)} minutes earlier`}
                                    >
                                      Start -{slotMinutes * Math.max(1, selectionAdjustStepSlots)}m
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => nudgeSelectionDraftEdge('start', 1)}
                                      className="rounded-md border border-orange-300 bg-white/90 px-2 py-1.5 text-orange-700 hover:bg-orange-100 dark:border-orange-700 dark:bg-orange-900/40 dark:text-orange-100"
                                      title={`Move start ${slotMinutes * Math.max(1, selectionAdjustStepSlots)} minutes later`}
                                    >
                                      Start +{slotMinutes * Math.max(1, selectionAdjustStepSlots)}m
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => nudgeSelectionDraftEdge('end', -1)}
                                      className="rounded-md border border-orange-300 bg-white/90 px-2 py-1.5 text-orange-700 hover:bg-orange-100 dark:border-orange-700 dark:bg-orange-900/40 dark:text-orange-100"
                                      title={`Move end ${slotMinutes * Math.max(1, selectionAdjustStepSlots)} minutes earlier`}
                                    >
                                      End -{slotMinutes * Math.max(1, selectionAdjustStepSlots)}m
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => nudgeSelectionDraftEdge('end', 1)}
                                      className="rounded-md border border-orange-300 bg-white/90 px-2 py-1.5 text-orange-700 hover:bg-orange-100 dark:border-orange-700 dark:bg-orange-900/40 dark:text-orange-100"
                                      title={`Move end ${slotMinutes * Math.max(1, selectionAdjustStepSlots)} minutes later`}
                                    >
                                      End +{slotMinutes * Math.max(1, selectionAdjustStepSlots)}m
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                        </div>
                      )}

                      {selectedItem && (
                        <div className="mb-2 mt-2 rounded-md border border-orange-200 bg-orange-50/70 p-2 text-xs text-orange-700 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-300">
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
                                  <div className="rounded-md border border-orange-300/70 bg-white/90 px-2 py-1 dark:border-orange-700/70 dark:bg-orange-950/30">
                                    <span className="mb-1 block font-medium">Step interval</span>
                                    <div className="grid grid-cols-3 gap-1">
                                      {[1, 2, 4].map((stepMultiplier) => {
                                        const isActive = itemAdjustStepSlots === stepMultiplier
                                        return (
                                          <button
                                            key={stepMultiplier}
                                            type="button"
                                            onClick={() => setItemAdjustStepSlots(stepMultiplier)}
                                            className={`rounded-md border px-1.5 py-1 text-[11px] font-semibold transition-colors ${
                                              isActive
                                                ? 'border-orange-600 bg-orange-600 text-white'
                                                : 'border-orange-300 bg-background text-orange-700 hover:bg-orange-100 dark:border-orange-700 dark:text-orange-200 dark:hover:bg-orange-900/40'
                                            }`}
                                          >
                                            {slotMinutes * stepMultiplier}m
                                          </button>
                                        )
                                      })}
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-2 gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => { void nudgeSelectedItemEdge('start', -1) }}
                                      className="rounded-md border border-orange-300 bg-white/90 px-2 py-1.5 text-orange-700 hover:bg-orange-100 dark:border-orange-700 dark:bg-orange-900/40 dark:text-orange-100"
                                      title={`Move start ${slotMinutes * Math.max(1, itemAdjustStepSlots)} minutes earlier`}
                                    >
                                      Start -{slotMinutes * Math.max(1, itemAdjustStepSlots)}m
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => { void nudgeSelectedItemEdge('start', 1) }}
                                      className="rounded-md border border-orange-300 bg-white/90 px-2 py-1.5 text-orange-700 hover:bg-orange-100 dark:border-orange-700 dark:bg-orange-900/40 dark:text-orange-100"
                                      title={`Move start ${slotMinutes * Math.max(1, itemAdjustStepSlots)} minutes later`}
                                    >
                                      Start +{slotMinutes * Math.max(1, itemAdjustStepSlots)}m
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => { void nudgeSelectedItemEdge('end', -1) }}
                                      className="rounded-md border border-orange-300 bg-white/90 px-2 py-1.5 text-orange-700 hover:bg-orange-100 dark:border-orange-700 dark:bg-orange-900/40 dark:text-orange-100"
                                      title={`Move end ${slotMinutes * Math.max(1, itemAdjustStepSlots)} minutes earlier`}
                                    >
                                      End -{slotMinutes * Math.max(1, itemAdjustStepSlots)}m
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => { void nudgeSelectedItemEdge('end', 1) }}
                                      className="rounded-md border border-orange-300 bg-white/90 px-2 py-1.5 text-orange-700 hover:bg-orange-100 dark:border-orange-700 dark:bg-orange-900/40 dark:text-orange-100"
                                      title={`Move end ${slotMinutes * Math.max(1, itemAdjustStepSlots)} minutes later`}
                                    >
                                      End +{slotMinutes * Math.max(1, itemAdjustStepSlots)}m
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {!selectionDraft && !selectedItem && (
                        <div className="mb-2 mt-2 rounded-md border border-sky-300 bg-sky-50/70 px-2 py-1.5 text-xs font-semibold text-sky-700 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-300">
                          Select Time
                        </div>
                      )}

                      <div className={`space-y-2 ${isRecurrenceDirty ? 'rounded-md border border-amber-400/70 bg-amber-50/40 p-1.5 animate-[field-dirty-pulse_1.25s_ease-in-out_infinite] dark:border-amber-700/70 dark:bg-amber-950/25' : ''}`}>
                        <RecurrenceEditor
                          value={draft.recurrenceRule}
                          onChange={(nextRule) => setDraft((prev) => ({ ...prev, recurrenceRule: nextRule }))}
                          expanded={showItemRecurrencePanel}
                          onExpandedChange={setShowItemRecurrencePanel}
                          dateSeed={recurrenceEditorDateSeed}
                          readOnly={isSelectedReadOnly}
                          compact
                        />
                      </div>

                      <div className="space-y-2">
                        {clipboardStatus && (
                          <div className="rounded-md border border-emerald-300 bg-emerald-50/80 px-2.5 py-1.5 text-xs text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                            {clipboardStatus}
                          </div>
                        )}

                        {isSelectedReadOnly && (
                          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50/70 px-2.5 py-1.5 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                            <Lock className="mt-0.5 h-3.5 w-3.5 flex-none" />
                            <span>
                              Read-only mirror of {selectedSource?.name || 'calendar source'}. Switch mode to edit directly, or copy this item into your active mode.
                            </span>
                          </div>
                        )}

                        {isSelectedReadOnly ? (
                          <>
                            <div className={`rounded-md border border-border bg-muted/40 px-2.5 py-2 text-sm font-semibold text-foreground ${
                              isHiddenModeEnabled ? 'blur-sm' : ''
                            }`}>
                              {selectedItem?.title || 'Untitled'}
                            </div>
                            {selectedReadOnlyDisplayNotes && (
                              <div className={`rounded-md border border-border bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground ${
                                isHiddenModeEnabled ? 'blur-sm' : ''
                              }`}>
                                <NotePreview text={selectedReadOnlyDisplayNotes} />
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            <div className={`relative ${isTitleDirty ? 'rounded-md animate-[field-dirty-pulse_1.25s_ease-in-out_infinite]' : ''}`}>
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
                                  void handleSaveSelection()
                                }}
                                placeholder="Type Title for Time Item"
                                className={`w-full rounded-md border bg-background px-2.5 py-2 pr-5 text-sm transition-colors ${
                                  isSelectionTitleTypingMode || isTitleTypingHintActive
                                    ? 'border-blue-500 ring-4 ring-blue-400/30 dark:border-blue-500 dark:ring-blue-500/25'
                                    : isTitleDirty
                                      ? 'border-amber-500 ring-2 ring-amber-400/40 dark:border-amber-600 dark:ring-amber-600/35'
                                    : isSelectionTitleRequired
                                      ? 'border-orange-500 bg-orange-50/70 text-orange-950 placeholder:text-orange-500 dark:border-orange-700 dark:bg-orange-950/30 dark:text-orange-100 dark:placeholder:text-orange-300'
                                      : 'border-border'
                                } ${isHiddenModeEnabled ? 'blur-sm' : ''}`}
                              />
                              {(isSelectionTitleTypingMode || isTitleTypingHintActive) && (
                                <div className="pointer-events-none absolute inset-y-0 left-0 flex max-w-[calc(100%-1.25rem)] items-center overflow-hidden px-2.5 text-sm" aria-hidden="true">
                                  <span className="whitespace-pre text-transparent">{draft.title || ' '}</span>
                                  <span
                                    className="h-4 w-0.5 rounded-full bg-blue-500 dark:bg-blue-400"
                                    style={{ animation: 'selection-caret 0.9s step-start infinite' }}
                                  />
                                </div>
                              )}
                            </div>
                            <div className={`${isHiddenModeEnabled ? 'blur-sm' : ''} ${isDescriptionHintActive ? 'rounded-md border border-emerald-400/70 bg-emerald-50/60 p-1.5 dark:border-emerald-700 dark:bg-emerald-950/30' : ''} ${isNotesDirty ? 'rounded-md border border-amber-400/70 bg-amber-50/40 p-1.5 animate-[field-dirty-pulse_1.25s_ease-in-out_infinite] dark:border-amber-700/70 dark:bg-amber-950/25' : ''}`}>
                              {isDescriptionHintActive && (
                                <p className="mb-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">Description -- edit here if needed</p>
                              )}
                              <MarkdownComposer
                                value={draft.notes}
                                onChange={(nextNotes) => setDraft((prev) => ({ ...prev, notes: nextNotes }))}
                                placeholder="Notes or context"
                                className="min-h-[12rem]"
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

                        <div className={isCategoryDirty ? 'rounded-md border border-amber-400/70 bg-amber-50/40 p-1.5 animate-[field-dirty-pulse_1.25s_ease-in-out_infinite] dark:border-amber-700/70 dark:bg-amber-950/25' : ''}>
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
                                  ? 'border-red-300 bg-red-50/80 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300'
                                  : isAutoSaving
                                  ? 'border-blue-300 bg-blue-50/80 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300'
                                  : isSelectedItemDirty
                                  ? 'border-amber-300 bg-amber-50/80 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
                                  : 'border-emerald-300 bg-emerald-50/80 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'
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
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (movingItemId && movingItemIsRecurring) {
                                      if (!selectionDraft || !draft.title.trim() || isCreatingItem) return
                                      setIsMoveScopeOpen((prev) => !prev)
                                      return
                                    }
                                    void handleSaveSelection()
                                  }}
                                  disabled={!selectionDraft || !draft.title.trim() || isCreatingItem}
                                  className="flex h-10 w-full items-center justify-center gap-1 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                                  aria-expanded={movingItemId && movingItemIsRecurring ? isMoveScopeOpen : undefined}
                                >
                                  <Save className="h-4 w-4" />
                                  {selectionDraft ? 'Save Item' : 'Select Time'}
                                </button>
                                {movingItemId && movingItemIsRecurring && isMoveScopeOpen && (
                                  <div className="absolute left-1/2 top-full z-50 mt-2 w-60 max-w-[calc(100vw-1rem)] -translate-x-1/2 rounded-md border border-blue-200 bg-background p-2 shadow-lg dark:border-blue-900">
                                    <p className="mb-2 text-xs font-medium text-foreground">
                                      This is a recurring item. What would you like to move?
                                    </p>
                                    <div className="flex flex-col gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => { void handleSaveSelection('this') }}
                                        className="rounded-md border border-blue-300 px-2 py-1.5 text-left text-xs font-medium text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/40"
                                      >
                                        This item only
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => { void handleSaveSelection('series') }}
                                        className="rounded-md bg-blue-600 px-2 py-1.5 text-left text-xs font-medium text-white hover:bg-blue-700"
                                      >
                                        All items (recalculate future)
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setIsMoveScopeOpen(false)}
                                        className="mt-0.5 rounded-md border border-border px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => handleDiscardSelectionDraft()}
                                disabled={isCreatingItem}
                                className="flex h-10 w-full items-center justify-center gap-1 rounded-md border border-red-300 bg-background px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40"
                              >
                                <X className="h-4 w-4" />
                                Discard
                              </button>
                            </div>
                          )}

                          {selectedItem && !isSelectedReadOnly && (
                            <div className="grid grid-cols-3 gap-2">
                              <button
                                type="button"
                                onClick={handleUpdateItem}
                                disabled={!canSaveSelectedItem}
                                className="flex h-10 w-full items-center justify-center gap-1 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <Save className="h-4 w-4" />
                                Save
                              </button>
                              <div className="relative w-full" data-delete-popover-root="true">
                                <button
                                  type="button"
                                  onClick={() => setIsDeleteConfirmOpen((prev) => !prev)}
                                  className="h-10 w-full rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                                  aria-expanded={isDeleteConfirmOpen}
                                  aria-label="Delete item"
                                >
                                  Delete
                                </button>
                                {isDeleteConfirmOpen && (
                                  <div className="absolute left-1/2 top-full z-50 mt-2 w-60 max-w-[calc(100vw-1rem)] -translate-x-1/2 rounded-md border border-red-200 bg-background p-2 shadow-lg dark:border-red-900">
                                    {selectedEvent?.recurrence_rule && selectedEvent.recurrence_rule.type !== 'none' ? (
                                      <>
                                        <p className="mb-2 text-xs font-medium text-foreground">
                                          This is a recurring item. What would you like to delete?
                                        </p>
                                        <div className="flex flex-col gap-1.5">
                                          <button
                                            type="button"
                                            onClick={() => { void handleDeleteThisOccurrence() }}
                                            className="rounded-md border border-red-300 px-2 py-1.5 text-left text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
                                          >
                                            This item only
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => { void handleDeleteThisAndFollowing() }}
                                            className="rounded-md border border-red-300 px-2 py-1.5 text-left text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
                                          >
                                            This and all following items
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => { void handleDeleteSelected() }}
                                            className="rounded-md bg-red-600 px-2 py-1.5 text-left text-xs font-medium text-white hover:bg-red-700"
                                          >
                                            All items in the series
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setIsDeleteConfirmOpen(false)}
                                            className="mt-0.5 rounded-md border border-border px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                      </>
                                    ) : (
                                      <>
                                        <p className="mb-2 text-xs text-foreground">Delete this item?</p>
                                        <div className="flex items-center justify-end gap-2">
                                          <button
                                            type="button"
                                            onClick={() => setIsDeleteConfirmOpen(false)}
                                            className="rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                                          >
                                            Cancel
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => { void handleDeleteSelected() }}
                                            className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                                          >
                                            Confirm
                                          </button>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={openExportDialog}
                                disabled={oauthCalendars.length === 0}
                                className="h-10 w-full rounded-md border border-indigo-300 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                                title={oauthCalendars.length === 0 ? 'Connect a Google Calendar in Settings to export.' : 'Export this item to a connected calendar'}
                              >
                                <span className="inline-flex items-center gap-1">
                                  <Send className="h-4 w-4" />
                                  Export
                                </span>
                              </button>
                            </div>
                          )}

                          {selectedItem && isSelectedReadOnly && (
                            <div className="grid grid-cols-1 gap-2">
                              <button
                                type="button"
                                onClick={openExportDialog}
                                disabled={oauthCalendars.length === 0}
                                className="h-10 w-full rounded-md border border-indigo-300 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                                title={oauthCalendars.length === 0 ? 'Connect a Google Calendar in Settings to export.' : 'Export this item to a connected calendar'}
                              >
                                <span className="inline-flex items-center gap-1">
                                  <Send className="h-4 w-4" />
                                  Export
                                </span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </section>

                <section ref={sectionQuickObjectsRef} className="rounded-lg border border-border bg-background/50 p-3">
                  <button
                    type="button"
                    onClick={() => toggleSection('quickObjects')}
                    className="flex w-full items-center gap-2 text-left text-sm font-semibold text-foreground"
                    title={expandedSections.has('quickObjects') ? 'Collapse quick objects' : 'Expand quick objects'}
                  >
                    <Tag className="h-4 w-4 text-violet-600" />
                    <span>Quick Objects</span>
                    <span className="ml-auto text-muted-foreground">
                      {expandedSections.has('quickObjects') ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </span>
                  </button>

                  {expandedSections.has('quickObjects') && (
                    <>
                      <p className="mb-2 mt-2 text-xs text-muted-foreground">
                        Build reusable template cards from existing calendar items, then apply them into Create Time Item.
                      </p>

                      <div className="mb-2 rounded-md border border-sky-300 bg-sky-50/70 px-2.5 py-1.5 text-xs font-semibold text-sky-700 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-300">
                        {selectionDraft ? 'Apply Template' : 'Select Time'}
                      </div>

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
                        <button
                          type="button"
                          onClick={() => {
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
                          className={`w-full rounded-md border px-2.5 py-2 text-xs font-semibold transition-colors ${
                            isTemplateSelectionMode
                              ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
                              : 'border-border text-foreground hover:bg-muted'
                          }`}
                        >
                          {isTemplateSelectionMode ? 'Cancel item selection mode' : 'Select calendar item to copy'}
                        </button>

                        {isTemplateSelectionMode && (
                          <div className="rounded-md border border-amber-300 bg-amber-50/70 px-2.5 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                            Selection mode is active. Click an item in the calendar to capture it as a template.
                          </div>
                        )}

                        {pendingTemplateSourceItem && (
                          <div className="rounded-md border border-violet-300 bg-violet-50/70 p-2.5 dark:border-violet-800 dark:bg-violet-950/30">
                            <p className="text-[11px] font-semibold text-violet-700 dark:text-violet-300">Selected item</p>
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
                            <button
                              type="button"
                              onClick={saveSelectedItemAsTemplate}
                              className="mt-2 w-full rounded-md bg-violet-600 px-2.5 py-2 text-xs font-semibold text-white hover:bg-violet-500"
                            >
                              Save selected item as template
                            </button>
                          </div>
                        )}
                      </div>

                    </>
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
          ? () => handleUpdateItem()
          : selectionDraft
            ? () => handleSaveSelection()
            : undefined}
        saveState={fullEditorSaveState}
        saveMetaLabel={fullEditorSaveMetaLabel}
        saveLabel={selectedItem ? 'Save now' : 'Save item'}
        closeLabel={isPhoneLayout && selectionDraft && !selectedItem ? 'Cancel' : 'Close'}
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
                  <div className="rounded-md border border-orange-300/70 bg-white/90 px-2 py-1 dark:border-orange-700/70 dark:bg-orange-950/30">
                    <span className="mb-1 block font-medium">Step interval</span>
                    <div className="grid grid-cols-3 gap-1">
                      {[1, 2, 4].map((stepMultiplier) => {
                        const isSelectionMode = Boolean(selectionDraft && !selectedItem)
                        const isActive = isSelectionMode
                          ? selectionAdjustStepSlots === stepMultiplier
                          : itemAdjustStepSlots === stepMultiplier
                        return (
                          <button
                            key={stepMultiplier}
                            type="button"
                            onClick={() => {
                              if (isSelectionMode) {
                                setSelectionAdjustStepSlots(stepMultiplier)
                                return
                              }
                              setItemAdjustStepSlots(stepMultiplier)
                            }}
                            className={`rounded-md border px-1.5 py-1 text-[11px] font-semibold transition-colors ${isActive
                              ? 'border-orange-600 bg-orange-600 text-white'
                              : 'border-orange-300 bg-background text-orange-700 hover:bg-orange-100 dark:border-orange-700 dark:text-orange-200 dark:hover:bg-orange-900/40'}`}
                          >
                            {slotMinutes * stepMultiplier}m
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        if (selectionDraft && !selectedItem) {
                          nudgeSelectionDraftEdge('start', -1)
                          return
                        }
                        void nudgeSelectedItemEdge('start', -1)
                      }}
                      className="rounded-md border border-orange-300 bg-white/90 px-2 py-1.5 text-orange-700 hover:bg-orange-100 dark:border-orange-700 dark:bg-orange-900/40 dark:text-orange-100"
                      title={`Move start ${slotMinutes * Math.max(1, selectionDraft && !selectedItem ? selectionAdjustStepSlots : itemAdjustStepSlots)} minutes earlier`}
                    >
                      Start -{slotMinutes * Math.max(1, selectionDraft && !selectedItem ? selectionAdjustStepSlots : itemAdjustStepSlots)}m
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (selectionDraft && !selectedItem) {
                          nudgeSelectionDraftEdge('start', 1)
                          return
                        }
                        void nudgeSelectedItemEdge('start', 1)
                      }}
                      className="rounded-md border border-orange-300 bg-white/90 px-2 py-1.5 text-orange-700 hover:bg-orange-100 dark:border-orange-700 dark:bg-orange-900/40 dark:text-orange-100"
                      title={`Move start ${slotMinutes * Math.max(1, selectionDraft && !selectedItem ? selectionAdjustStepSlots : itemAdjustStepSlots)} minutes later`}
                    >
                      Start +{slotMinutes * Math.max(1, selectionDraft && !selectedItem ? selectionAdjustStepSlots : itemAdjustStepSlots)}m
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (selectionDraft && !selectedItem) {
                          nudgeSelectionDraftEdge('end', -1)
                          return
                        }
                        void nudgeSelectedItemEdge('end', -1)
                      }}
                      className="rounded-md border border-orange-300 bg-white/90 px-2 py-1.5 text-orange-700 hover:bg-orange-100 dark:border-orange-700 dark:bg-orange-900/40 dark:text-orange-100"
                      title={`Move end ${slotMinutes * Math.max(1, selectionDraft && !selectedItem ? selectionAdjustStepSlots : itemAdjustStepSlots)} minutes earlier`}
                    >
                      End -{slotMinutes * Math.max(1, selectionDraft && !selectedItem ? selectionAdjustStepSlots : itemAdjustStepSlots)}m
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (selectionDraft && !selectedItem) {
                          nudgeSelectionDraftEdge('end', 1)
                          return
                        }
                        void nudgeSelectedItemEdge('end', 1)
                      }}
                      className="rounded-md border border-orange-300 bg-white/90 px-2 py-1.5 text-orange-700 hover:bg-orange-100 dark:border-orange-700 dark:bg-orange-900/40 dark:text-orange-100"
                      title={`Move end ${slotMinutes * Math.max(1, selectionDraft && !selectedItem ? selectionAdjustStepSlots : itemAdjustStepSlots)} minutes later`}
                    >
                      End +{slotMinutes * Math.max(1, selectionDraft && !selectedItem ? selectionAdjustStepSlots : itemAdjustStepSlots)}m
                    </button>
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
            readOnly={isSelectedReadOnly}
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
                    <span className="block max-w-[5.5rem] truncate">{buildQuickTemplateShortcutLabel(template.quickName)}</span>
                  </button>
                ))}
                {quickTemplates.length > 2 && (
                  <button
                    type="button"
                    onClick={openQuickObjectsSurface}
                    className="shrink-0 rounded-md border border-border px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="Open Quick Objects tools"
                  >
                    +{quickTemplates.length - 2}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={openQuickObjectsSurface}
                className="shrink-0 rounded-md border border-border px-2 py-1 text-[10px] font-semibold text-foreground hover:bg-muted"
                title="Open Quick Objects tools"
              >
                Tools
              </button>
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
              <button
                type="button"
                onClick={() => setQuickTemplatesMainExpanded((prev) => !prev)}
                className={`rounded-md border text-xs font-semibold transition-all ${isQuickTemplatesToggleHovering ? 'border-blue-500 bg-blue-100 text-blue-900 shadow-sm dark:border-blue-400 dark:bg-blue-950/50 dark:text-blue-200' : 'border-border text-foreground hover:bg-muted'} ${quickTemplatesMainExpanded ? 'px-2.5 py-1.5' : 'px-2 py-1'}`}
              >
                {quickTemplatesMainExpanded ? 'Collapse' : 'Expand'}
              </button>
              <button
                type="button"
                onClick={() => {
                  openQuickObjectsSurface()
                }}
                className={`rounded-md border border-border text-xs font-semibold text-foreground hover:bg-muted ${quickTemplatesMainExpanded ? 'px-2.5 py-1.5' : 'px-2 py-1'}`}
              >
                Manage
              </button>
            </div>
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
                        className="h-3.5 w-3.5 accent-blue-600"
                      />
                      Autosave this template
                    </label>
                    <div className="mt-2 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => { void applyQuickTemplate(template) }}
                        className="w-28 rounded-md bg-blue-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
                      >
                        {selectionDraft ? 'Apply Template' : 'Select Time'}
                      </button>
                      <div className="relative" data-delete-popover-root="true">
                        <button
                          type="button"
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
                              const top = Math.max(
                                margin,
                                Math.min(rect.bottom + margin, window.innerHeight - popoverApproxHeight - margin)
                              )
                              setDeletingTemplatePopoverPosition({ left, top })
                              return template.id
                            })
                          }}
                          className="rounded-md border border-red-300 px-2 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                          aria-label="Delete template"
                          title="Delete template"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                        {deletingTemplateId === template.id && (
                          <div
                            className="fixed z-[220] w-52 max-w-[calc(100vw-1rem)] rounded-md border border-red-200 bg-background p-2 shadow-lg dark:border-red-900"
                            style={{
                              left: deletingTemplatePopoverPosition?.left ?? 8,
                              top: deletingTemplatePopoverPosition?.top ?? 8,
                            }}
                          >
                            <p className="mb-2 text-xs text-foreground">Delete this template?</p>
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setDeletingTemplateId(null)
                                  setDeletingTemplatePopoverPosition(null)
                                }}
                                className="rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteQuickTemplate(template.id)}
                                className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                              >
                                Confirm
                              </button>
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
        className={`${isPhoneLayout ? 'mb-2 flex flex-nowrap items-center gap-1.5 rounded-lg px-2 py-2' : 'mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2.5'} border ${
          isHiddenModeEnabled
            ? 'border-amber-300 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/20'
            : 'border-border bg-card'
        }`}
      >
        <div className={`flex items-center ${isPhoneLayout ? 'gap-1.5 shrink-0' : 'gap-2'}`}>
          <button
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
            className={`rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground ${isPhoneLayout ? 'p-1.5' : 'p-2'}`}
            title={isPhoneLayout
              ? (isToolsSurfaceVisible ? 'Close Time Management Tools' : 'Open Time Management Tools')
              : (isLeftPanelOpen ? 'Hide left panel' : 'Show left panel')}
          >
            {(isPhoneLayout ? isToolsSurfaceVisible : isLeftPanelOpen)
              ? <PanelLeftClose className="h-4 w-4" />
              : <PanelLeftOpen className="h-4 w-4" />}
          </button>
          {!isPhoneLayout && (
            <div>
              <h1 className={`flex items-center gap-2 text-base font-semibold md:text-lg ${isHiddenModeEnabled ? 'text-amber-800 dark:text-amber-200' : 'text-foreground'}`}>
                <Calendar className={`h-5 w-5 ${isHiddenModeEnabled ? 'text-amber-600 dark:text-amber-300' : 'text-blue-600'}`} />
                {isHiddenModeEnabled ? 'Content hidden Time Management mode' : 'Time Management'}
                {selectedSourceCount > 0 && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-opacity duration-700 ${
                      isAggregateSourceStatusVisible ? 'opacity-100' : 'opacity-0'
                    } ${
                      isAllSelectedSourcesSynced
                        ? 'border-emerald-400/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'border-blue-400/50 bg-blue-500/10 text-blue-700 dark:text-blue-300'
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
                <button
                  type="button"
                  onClick={() => setIsHiddenModeEnabled(false)}
                  className="mt-0.5 text-[11px] font-medium text-amber-700 underline decoration-amber-500 underline-offset-2 hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200"
                >
                  (disable hidden mode)
                </button>
              )}
            </div>
          )}
        </div>

        <div className={`flex items-center ${isPhoneLayout ? 'gap-1 shrink-0' : 'flex-wrap gap-1.5'}`}>
          <button
            onClick={() => setCurrentWeekStart((prev) => subWeeks(prev, 1))}
            className={`rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground ${isPhoneLayout ? 'px-1.5 py-1 text-xs' : 'px-2 py-1.5 text-sm'}`}
            title="Previous week"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={handleToday}
            className={`rounded-md border border-border font-semibold text-foreground hover:bg-muted ${isPhoneLayout ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs'}`}
          >
            Today
          </button>
          <button
            onClick={() => setCurrentWeekStart((prev) => addWeeks(prev, 1))}
            className={`rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground ${isPhoneLayout ? 'px-1.5 py-1 text-xs' : 'px-2 py-1.5 text-sm'}`}
            title="Next week"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className={`flex items-center ${isPhoneLayout ? 'ml-auto gap-1 shrink-0' : 'flex-wrap gap-2'}`}>
          {!isPhoneLayout && (
          <span className="rounded-md border border-border bg-background px-2 py-1 text-xs font-semibold text-foreground md:text-sm">
            {weekRangeLabel}
          </span>
          )}
          <TimezoneSelector timezones={tzState} compact={isPhoneLayout} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-card">
        {(isLoading || eventsError || !hasVisibleItems) && (
          <div className="border-b border-border px-3 py-2 text-sm">
            {isLoading ? (
              <span className="text-muted-foreground">Loading meetings from selected calendars...</span>
            ) : eventsError ? (
              <span className="text-red-600 dark:text-red-400">{eventsError}</span>
            ) : (
              <span className="text-muted-foreground">No meetings found on the selected calendars.</span>
            )}
          </div>
        )}
        <style>{`@keyframes blink-colon { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } } @keyframes selection-glow { 0%, 100% { box-shadow: 0 0 0 2px rgba(59,130,246,0.12), 0 0 8px rgba(59,130,246,0.08); } 50% { box-shadow: 0 0 0 4px rgba(59,130,246,0.35), 0 0 18px rgba(59,130,246,0.22); } } @keyframes selection-flow { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } } @keyframes selection-caret { 0%, 45% { opacity: 1; } 55%, 100% { opacity: 0; } } @keyframes selection-time-pulse { 0% { color: inherit; text-shadow: none; } 35% { color: #f97316; text-shadow: 0 0 10px rgba(249,115,22,0.45); } 100% { color: inherit; text-shadow: none; } } @keyframes move-source-ghost { 0%, 100% { opacity: 0.92; transform: scale(1); } 50% { opacity: 0.38; transform: scale(0.985); } } @keyframes drop-target-pulse { 0%, 100% { opacity: 0.96; transform: scale(1); } 50% { opacity: 0.6; transform: scale(0.996); } } @keyframes drop-target-line { 0%, 100% { opacity: 1; } 50% { opacity: 0.62; } } @keyframes source-sync-complete { 0% { transform: scale(0.96); opacity: 0.62; } 45% { transform: scale(1.06); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }`}</style>
        {renderCalendarHeaderRow('top')}
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
            className="relative grid"
            style={{ gridTemplateColumns: weekGridTemplateColumns }}
          >
            {tzState.all.map((tz, _tzIdx) => (
              <div key={tz} className="relative border-r border-border bg-muted/30" style={{ height: `${dayHeight}px` }}>
                {selectionDraft && selectionDraft.endMinute > selectionDraft.startMinute && (
                  <div
                    className="pointer-events-none absolute left-0 right-0 z-[1]"
                    style={{
                      top: `${(selectionDraft.startMinute / slotMinutes) * SLOT_HEIGHT}px`,
                      height: `${((selectionDraft.endMinute - selectionDraft.startMinute) / slotMinutes) * SLOT_HEIGHT}px`,
                      backgroundColor: hexToRgba(selectionAccentColor, 0.08),
                      borderTop: `2px solid ${hexToRgba(selectionAccentColor, 0.55)}`,
                      borderBottom: `2px solid ${hexToRgba(selectionAccentColor, 0.55)}`,
                    }}
                  />
                )}
                {Array.from({ length: slotsPerDay }, (_, idx) => idx * slotMinutes).map((minute) => (
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
                      {formatMinuteLabel(minute, tz, slotMinutes)}
                    </span>
                  </div>
                ))}
                <div className="absolute bottom-0 left-0 right-0 border-t border-border/70" />
              </div>
            ))}

            {weekDays.map((day, dayIndex) => {
              const layout = dayLayouts[dayIndex]
              const hasSelection =
                selectionDraft?.dayIndex === dayIndex && selectionDraft.endMinute > selectionDraft.startMinute
              const isHighlightedDay = highlightedDay ? isSameDay(day, highlightedDay) : false
              const isDropPreviewVisible =
                isDraggingItem &&
                dragDropPreview?.dayIndex === dayIndex &&
                dragDropPreview?.itemId === draggingItem?.id
              const dropPreviewTop = isDropPreviewVisible
                ? (dragDropPreview.startMinute / slotMinutes) * SLOT_HEIGHT
                : 0
              const dropPreviewHeight = isDropPreviewVisible
                ? Math.max((dragDropPreview.durationMinutes / slotMinutes) * SLOT_HEIGHT, 10)
                : 0
              const dropPreviewColor = draggingItem ? (sourceMap.get(draggingItem.sourceId)?.color || '#2563eb') : '#2563eb'

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
                <div
                  key={day.toISOString()}
                  className={`relative border-r border-border last:border-r-0 transition-shadow ${
                    isHighlightedDay ? 'animate-pulse bg-blue-50/70 ring-2 ring-inset ring-blue-500/70 dark:bg-blue-950/25' : ''
                  }`}
                  ref={(element) => {
                    if (repeatIndex === CALENDAR_REPEAT_MIDDLE_INDEX) {
                      dayColumnRefs.current[dayIndex] = element
                    }
                  }}
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
                  onMouseDownCapture={(event) => {
                    if (event.button !== 0 || isSelecting || isResizing) return

                    const rect = event.currentTarget.getBoundingClientRect()
                    const pointerX = event.clientX - rect.left
                    const pointerY = Math.max(0, Math.min(rect.height, event.clientY - rect.top))
                    const edgeTarget = findEdgeResizeTarget(dayIndex, pointerX, pointerY, rect.width)
                    if (!edgeTarget) return

                    const targetItem = items.find((candidate) => candidate.id === edgeTarget.itemId)
                    const eventRecord = targetItem ? events.find((candidate) => candidate.id === targetItem.sourceEventId) : null
                    if (!eventRecord) return
                    const source = sourceMap.get(eventRecord.source_id || MAIN_SOURCE_ID)
                    if (isReadOnlySource(source)) return

                    const start = new Date(eventRecord.start_time)
                    const end = new Date(eventRecord.end_time)
                    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return

                    event.preventDefault()
                    event.stopPropagation()
                    setSelectionDraft(null)
                    setSelectedItemId(edgeTarget.itemId)
                    setResizeState({
                      itemId: edgeTarget.itemId,
                      dayIndex,
                      edge: edgeTarget.edge,
                      dayColumnElement: event.currentTarget,
                      originalEvent: eventRecord,
                      originalStartMinute: start.getUTCHours() * 60 + start.getUTCMinutes(),
                      originalEndMinute: end.getUTCHours() * 60 + end.getUTCMinutes(),
                    })
                  }}
                  onMouseDown={(event) => {
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
                    event.preventDefault()
                    event.stopPropagation()
                    event.currentTarget.setPointerCapture(event.pointerId)
                    selectionAnchorDayColumnRef.current = event.currentTarget
                    const minute = minuteFromPointer(event as unknown as MouseEvent<HTMLDivElement>)
                    void startSelectionWithUnsavedGuard(dayIndex, minute, { x: event.clientX, y: event.clientY })
                  }}
                  onPointerMove={(event) => {
                    if (event.pointerType === 'mouse') return
                    if (!isSelecting || !selectionDraft || selectionDraft.dayIndex !== dayIndex) return
                    event.preventDefault()
                    const minute = minuteFromPointer(event as unknown as MouseEvent<HTMLDivElement>)
                    updateSelection(dayIndex, minute)
                  }}
                  onPointerUp={(event) => {
                    if (event.pointerType === 'mouse') return
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                      event.currentTarget.releasePointerCapture(event.pointerId)
                    }
                  }}
                  onPointerCancel={(event) => {
                    if (event.pointerType === 'mouse') return
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
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
                      setDragDropPreview((previous) => {
                        if (
                          previous &&
                          previous.dayIndex === dayIndex &&
                          previous.startMinute === previewStartMinute &&
                          previous.durationMinutes === draggingItem.durationMinutes &&
                          previous.itemId === draggingItem.id
                        ) {
                          return previous
                        }

                        return {
                          dayIndex,
                          startMinute: previewStartMinute,
                          durationMinutes: draggingItem.durationMinutes,
                          itemId: draggingItem.id,
                        }
                      })
                    }
                    autoScrollCalendarWhileDragging(event.clientY)
                  }}
                  onDragLeave={(event) => {
                    const next = event.relatedTarget
                    if (next instanceof Node && event.currentTarget.contains(next)) {
                      return
                    }
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

                  {hasSelection && selectionDraft && (
                    <div
                      className="absolute left-[2.5%] right-[2.5%] z-[22] rounded-md border-2"
                      style={{
                        top: `${(selectionDraft.startMinute / slotMinutes) * SLOT_HEIGHT}px`,
                        height: `${((selectionDraft.endMinute - selectionDraft.startMinute) / slotMinutes) * SLOT_HEIGHT}px`,
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
                        setSelectionPasteContextMenu({ x: event.clientX, y: event.clientY })
                      }}
                    >
                      <div className="pointer-events-none absolute inset-[3px] rounded border border-dashed" style={{ borderColor: hexToRgba(selectionAccentColor, 0.6) }} />
                      <div className="pointer-events-none absolute left-2 right-2 top-2">
                        <div
                          className="pointer-events-none inline-flex max-w-full select-none items-center gap-1 rounded-md border bg-white/95 px-2 py-1 text-[11px] font-bold shadow-md dark:bg-blue-950/90"
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
                        <button
                          type="button"
                          onClick={openFullEditor}
                          className="inline-flex h-5 items-center gap-0.5 rounded border border-blue-400/80 bg-blue-600 px-1.5 text-[10px] font-semibold text-white shadow-sm hover:bg-blue-500"
                          aria-label="Open full view for selection"
                          title="Open full view for selection"
                        >
                          <Maximize2 className="h-2.5 w-2.5" />
                          Full View
                        </button>
                        {draft.title.trim() && (
                          <button
                            type="button"
                            onClick={() => { void handleSaveSelection() }}
                            disabled={!canSaveNewSelectionItem}
                            className="inline-flex h-5 items-center gap-0.5 rounded bg-blue-600 px-1.5 text-[10px] font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                            aria-label="Save selected time item"
                            title="Save (Enter)"
                          >
                            <Save className="h-2.5 w-2.5" />
                            Save
                          </button>
                        )}
                      </div>
                      )}
                    </div>
                  )}

                  {isDropPreviewVisible && dragDropPreview && (
                    <div
                      className="pointer-events-none absolute left-[4%] right-[4%] z-[13] rounded-md border-2 border-dashed"
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

                  {layout.eventSegments.map((segment, segmentIndex) => {
                    const item = itemMap.get(segment.eventId)
                    if (!item) return null

                    const source = sourceMap.get(item.sourceId)
                    const interactionId = getTimeItemInteractionId(item)
                    const isExternal = isReadOnlySource(source)
                    const isSelected = selectedItemId === interactionId
                    const isBeingResized = resizeState?.itemId === interactionId
                    const isBeingDragged = draggingItemId === interactionId
                    const isMoveSource = movingItemId === interactionId
                    const itemHeight = Math.max(segment.height, 18)
                    const primaryStartLabel = formatMinuteLabel(item.startMinute, tzState.primary, slotMinutes)
                    const primaryEndLabel = formatMinuteLabel(item.startMinute + item.durationMinutes, tzState.primary, slotMinutes)
                    const startsInLabel = formatTimeUntilStartLabel(item.occurrenceStartTime)
                    const categoryCardStyle = buildCategoryCardStyle(
                      item.categoryIds,
                      categoryMap,
                      prefs.category_color_display_style,
                      'time-item'
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
                    const shouldRenderRecurrenceIcon = effectiveRecurrenceRule?.type !== 'none'
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
                        className={`group absolute rounded-md border-2 px-1 pb-1 pt-0.5 shadow-sm transition-all duration-200 hover:shadow-md ${
                          isSelected ? 'ring-2 ring-blue-400' : ''
                        }`}
                        draggable={!isExternal && !isResizing}
                        onMouseDown={(event) => event.stopPropagation()}
                        onContextMenu={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          setCalendarItemContextMenu({
                            itemId: interactionId,
                            x: event.clientX,
                            y: event.clientY,
                            isReadOnly: isExternal,
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
                          event.dataTransfer.setDragImage(preview, offsetX, offsetY)

                          event.dataTransfer.setData('text/time-item', interactionId)
                          event.dataTransfer.effectAllowed = 'move'
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
                          setDragDropPreview(null)
                          dragClientYRef.current = null
                          clearDragPreview()
                        }}
                        onClick={(event) => {
                          event.stopPropagation()
                          void selectItemForEditing(interactionId, { x: event.clientX, y: event.clientY })
                        }}
                        onDoubleClick={(event) => {
                          event.stopPropagation()
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
                          borderColor: isBeingDragged ? '#f8fafc' : (source?.color || '#334155'),
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
                        <div className="pointer-events-none absolute -top-1 left-0 z-30 -translate-y-full opacity-0 transition-opacity duration-100 group-hover:opacity-100">
                          <div className="rounded border border-amber-300 bg-amber-200/95 px-1.5 py-1 text-[10px] font-semibold leading-tight text-amber-950 shadow-sm dark:border-amber-700 dark:bg-amber-900/95 dark:text-amber-100">
                            <div>{primaryStartLabel}-{primaryEndLabel}</div>
                            {startsInLabel && <div>{startsInLabel}</div>}
                          </div>
                        </div>

                        {shouldRenderRecurrenceIcon && (
                          <div className="pointer-events-none absolute right-1 top-1 rounded-full bg-background/90 p-0.5 text-blue-600 shadow-sm">
                            <Repeat2 className="h-3 w-3" />
                          </div>
                        )}
                        {shouldRenderTitle && (
                          <>
                            <div className={`line-clamp-2 overflow-hidden ${titleSizeClass} font-semibold leading-tight`}>{item.title}</div>
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
                      className="absolute rounded-md border border-dashed border-blue-300 bg-blue-50/90 px-1 text-[10px] font-semibold text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300"
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
              )
            })}

            <div
              data-testid="current-time-indicator"
              className="pointer-events-none absolute right-0 z-[15]"
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

      {isModeJsonImportOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => { if (!isImportingModeJson) setIsModeJsonImportOpen(false) }}
        >
          <div
            className="w-full max-w-2xl rounded-lg border border-border bg-card p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-foreground">Import Mode JSON</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Paste a mode settings JSON payload to create a new Calendar Mode.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { if (!isImportingModeJson) setIsModeJsonImportOpen(false) }}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Close mode JSON import dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <textarea
              value={modeJsonImportDraft}
              onChange={(event) => setModeJsonImportDraft(event.target.value)}
              placeholder="Paste mode JSON here"
              className="h-64 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground"
            />

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => { void handleSubmitModeJsonImport() }}
                disabled={isImportingModeJson || !modeJsonImportDraft.trim()}
                className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isImportingModeJson ? 'Importing...' : 'Import JSON'}
              </button>
              <button
                type="button"
                onClick={() => setModeJsonImportDraft('')}
                disabled={isImportingModeJson}
                className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setIsModeJsonImportOpen(false)}
                disabled={isImportingModeJson}
                className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {isModeJsonExportOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setIsModeJsonExportOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-lg border border-border bg-card p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-foreground">Mode JSON</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Copy this JSON to share or import this mode elsewhere.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsModeJsonExportOpen(false)}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Close mode JSON export dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <textarea
              readOnly
              value={modeJsonExportText}
              className="h-64 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground"
            />

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
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
                className={`rounded-md border-2 px-3 py-2 text-sm font-semibold text-white transition-[border-color,box-shadow,background-color] duration-300 disabled:cursor-not-allowed disabled:opacity-50 ${
                  modeJsonCopyFeedback === 'Copied to clipboard.'
                    ? 'animate-[pulse_0.9s_ease-in-out_2] border-emerald-500 bg-emerald-600 shadow-[0_0_0_3px_rgba(16,185,129,0.25)]'
                    : 'border-indigo-700 bg-indigo-600'
                }`}
              >
                Copy JSON
              </button>
              {modeJsonCopyFeedback && (
                <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  {modeJsonCopyFeedback}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {exportDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => { if (!isExporting) setExportDialogOpen(false) }}
        >
          <div
            className="w-full max-w-md rounded-lg border border-border bg-card p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-foreground">Export to Calendar</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Push a copy of "{selectedItem?.title || 'this item'}" to your connected calendars.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { if (!isExporting) setExportDialogOpen(false) }}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Close export dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

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
                          ? 'border-indigo-300 bg-indigo-50/60 dark:bg-indigo-950/30'
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

            {exportStatus && (
              <div className="mt-3 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-foreground">
                {exportStatus}
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => { void handleExportToCalendars() }}
                disabled={isExporting || exportTargetIds.size === 0 || oauthCalendars.length === 0}
                className="flex flex-1 items-center justify-center gap-1 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                {isExporting ? 'Exporting…' : 'Export'}
              </button>
              <button
                type="button"
                onClick={() => setExportDialogOpen(false)}
                disabled={isExporting}
                className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingUnsavedAction && !isPhoneLayout && (
        <div
          className="fixed z-[145] w-80 max-w-[calc(100vw-1rem)] rounded-lg border border-amber-300 bg-amber-50/95 p-3 text-xs text-amber-900 shadow-xl backdrop-blur-sm animate-[unsaved-pop-in_180ms_ease-out] dark:border-amber-800 dark:bg-amber-950/90 dark:text-amber-100"
          style={{
            left: pendingUnsavedAnchor?.x ?? 24,
            top: pendingUnsavedAnchor?.y ?? 92,
          }}
          role="dialog"
          aria-live="polite"
          aria-label="Unsaved changes"
        >
          <p className="font-semibold">Unsaved changes detected</p>
          <p className="mt-1 text-[11px]">
            {pendingUnsavedAction.type === 'switch-item'
              ? 'Save this item before switching to another one?'
              : 'Save this item before creating a new selection?'}
          </p>
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setPendingUnsavedAction(null)
                setPendingUnsavedAnchor(null)
                setIsPendingUnsavedActionSaving(false)
              }}
              className="rounded-md border border-amber-400/80 bg-white/90 px-2 py-1 text-xs font-medium text-amber-900 hover:bg-white dark:border-amber-700/80 dark:bg-amber-950 dark:text-amber-100"
            >
              Keep editing
            </button>
            <button
              type="button"
              onClick={() => { void handlePendingUnsavedActionConfirm() }}
              disabled={isPendingUnsavedActionSaving}
              className="rounded-md bg-amber-600 px-2 py-1 text-xs font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPendingUnsavedActionSaving ? 'Saving...' : 'Save and continue'}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingUnsavedAction && isPhoneLayout)}
        title="Unsaved changes"
        message={pendingUnsavedAction
          ? pendingUnsavedAction.type === 'switch-item'
            ? 'Save this item before switching to another one?'
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

      {calendarItemContextMenu && (
        <div
          id="calendar-item-context-menu"
          ref={calendarItemContextMenuRef}
          className="fixed z-[100] min-w-[12rem] max-w-[calc(100vw-1rem)] rounded-md border border-border bg-popover py-1 text-sm text-popover-foreground shadow-lg"
          style={{
            left: contextMenuPosition?.left ?? Math.min(calendarItemContextMenu.x, window.innerWidth - 240),
            top: contextMenuPosition?.top ?? Math.min(calendarItemContextMenu.y, window.innerHeight - 330),
          }}
          onContextMenu={(event) => event.preventDefault()}
          role="menu"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => handleContextSaveAsTemplate(calendarItemContextMenu.itemId)}
            onMouseEnter={() => setContextMenuCategorySubmenuOpen(false)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
          >
            <Save className="h-3.5 w-3.5 text-violet-600" />
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
              <Save className="h-3.5 w-3.5 text-blue-600" />
              Save Item
            </span>
            <span className="text-[11px] text-muted-foreground">Enter</span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => handleContextCopyItem(calendarItemContextMenu.itemId)}
            onMouseEnter={() => setContextMenuCategorySubmenuOpen(false)}
            className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-muted"
          >
            <span className="flex items-center gap-2">
              <Copy className="h-3.5 w-3.5 text-sky-600" />
              Copy Item
            </span>
            <span className="text-[11px] text-muted-foreground">Ctrl+C</span>
          </button>

          {(movingItemId || selectionDraft) && (
            <button
              type="button"
              role="menuitem"
              onClick={handleContextCancelSelection}
              onMouseEnter={() => setContextMenuCategorySubmenuOpen(false)}
              className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-muted"
            >
              <span className="flex items-center gap-2">
                <X className="h-3.5 w-3.5 text-amber-600" />
                Cancel Selection
              </span>
              <span className="text-[11px] text-muted-foreground">Esc</span>
            </button>
          )}

          {!calendarItemContextMenu.isReadOnly && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => handleContextMoveItem(calendarItemContextMenu.itemId)}
                onMouseEnter={() => setContextMenuCategorySubmenuOpen(false)}
                className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-muted"
              >
                <span className="flex items-center gap-2">
                  <Pencil className="h-3.5 w-3.5 text-emerald-600" />
                  Move Item
                </span>
                <span className="text-[11px] text-muted-foreground">Ctrl+X</span>
              </button>

              <div
                className="relative"
                onMouseEnter={() => setContextMenuCategorySubmenuOpen(true)}
              >
                <button
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={contextMenuCategorySubmenuOpen}
                  onClick={() => setContextMenuCategorySubmenuOpen((prev) => !prev)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
                >
                  <Tag className="h-3.5 w-3.5 text-blue-600" />
                  <span>Assign Category</span>
                  <ChevronRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
                </button>
                {contextMenuCategorySubmenuOpen && (() => {
                  const cmLeft = Math.min(calendarItemContextMenu.x, window.innerWidth - 240)
                  const cmTop = Math.min(calendarItemContextMenu.y, window.innerHeight - 220)
                  const openToLeft = cmLeft + 192 + 224 > window.innerWidth
                  const pinToBottom = cmTop + 165 + 288 > window.innerHeight
                  return (
                  <div
                    className="absolute max-h-[18rem] w-56 overflow-y-auto rounded-md border border-border bg-popover py-1 text-sm shadow-lg"
                    style={{
                      ...(openToLeft ? { right: '100%' } : { left: '100%' }),
                      ...(pinToBottom ? { bottom: 0 } : { top: 0 }),
                    }}
                    role="menu"
                  >
                    {categories.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground">
                        No categories yet. Create one in the Categories section.
                      </div>
                    ) : (
                      (() => {
                        const currentIds = getContextMenuTargetCategoryIds()
                        return categories.map((cat) => {
                          const selected = currentIds.includes(cat.id)
                          return (
                            <button
                              key={cat.id}
                              type="button"
                              role="menuitemcheckbox"
                              aria-checked={selected}
                              onClick={() => {
                                void handleContextToggleCategory(calendarItemContextMenu.itemId, cat.id)
                              }}
                              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
                            >
                              <span
                                className="inline-block h-3 w-3 rounded-sm border border-border"
                                style={{ backgroundColor: cat.color }}
                              />
                              <span className="flex-1 truncate">{cat.label}</span>
                              {selected && <span className="text-xs text-muted-foreground">checked</span>}
                            </button>
                          )
                        })
                      })()
                    )}
                  </div>
                  )
                })()}
              </div>

              <div className="my-1 h-px bg-border" />

              <div className="relative" onMouseEnter={() => setContextMenuCategorySubmenuOpen(false)}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => setContextMenuDeleteConfirmOpen((prev) => !prev)}
                  aria-expanded={contextMenuDeleteConfirmOpen}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete Item
                </button>
                {contextMenuDeleteConfirmOpen && (() => {
                  const ctxItem = items.find((entry) => entry.id === calendarItemContextMenu.itemId)
                  const ctxEvent = ctxItem ? events.find((entry) => entry.id === ctxItem.sourceEventId) : null
                  const ctxIsRecurring = Boolean(ctxEvent?.recurrence_rule && ctxEvent.recurrence_rule.type !== 'none')
                  return (
                    <div className="mx-1 mt-1 rounded-md border border-border bg-popover px-3 py-2 shadow-inner">
                      {ctxIsRecurring ? (
                        <>
                          <p className="mb-2 text-xs font-medium text-foreground">
                            This is a recurring item. What would you like to delete?
                          </p>
                          <div className="flex flex-col gap-1.5">
                            <button
                              type="button"
                              onClick={() => { void handleContextDeleteThisOccurrence(calendarItemContextMenu.itemId) }}
                              className="rounded-md border border-red-300 px-2 py-1.5 text-left text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
                            >
                              This item only
                            </button>
                            <button
                              type="button"
                              onClick={() => { void handleContextDeleteThisAndFollowing(calendarItemContextMenu.itemId) }}
                              className="rounded-md border border-red-300 px-2 py-1.5 text-left text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
                            >
                              This and all following items
                            </button>
                            <button
                              type="button"
                              onClick={() => { void handleContextDeleteItem(calendarItemContextMenu.itemId) }}
                              className="rounded-md bg-red-600 px-2 py-1.5 text-left text-xs font-medium text-white hover:bg-red-700"
                            >
                              All items in the series
                            </button>
                            <button
                              type="button"
                              onClick={() => setContextMenuDeleteConfirmOpen(false)}
                              className="mt-0.5 rounded-md border border-border px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                              Cancel
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="mb-2 text-xs text-foreground">Delete this item?</p>
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setContextMenuDeleteConfirmOpen(false)}
                              className="rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => { void handleContextDeleteItem(calendarItemContextMenu.itemId) }}
                              className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                            >
                              Confirm
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )
                })()}
              </div>
            </>
          )}
        </div>
      )}

      {selectionPasteContextMenu && selectionDraft && (
        <div
          id="selection-paste-context-menu"
          className="fixed z-[100] min-w-[12rem] rounded-md border border-border bg-popover py-1 text-sm text-popover-foreground shadow-lg"
          style={{
            left: Math.min(selectionPasteContextMenu.x, window.innerWidth - 240),
            top: Math.min(selectionPasteContextMenu.y, window.innerHeight - 80),
          }}
          onContextMenu={(event) => event.preventDefault()}
          role="menu"
        >
          {(() => {
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
                    void handleSaveSelection()
                  }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">
                    <Save className="h-3.5 w-3.5 text-blue-600" />
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
                      void handleSaveSelection()
                    } else if (copiedItem) {
                      void pasteCopiedItemToSelection()
                    }
                  }}
                  title={canPaste ? 'Paste item into this selection' : 'Cut (Ctrl+X) or Copy (Ctrl+C) an item first'}
                  className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">
                    <Save className="h-3.5 w-3.5 text-blue-600" />
                    Paste Item
                  </span>
                  <span className="text-[11px] text-muted-foreground">Ctrl+V</span>
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
                    <X className="h-3.5 w-3.5 text-amber-600" />
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
