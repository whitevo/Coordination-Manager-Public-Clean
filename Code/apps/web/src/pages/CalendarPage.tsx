import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { format, startOfWeek, addDays, addWeeks, subWeeks, isWithinInterval, isSameDay, parse, isValid, getDay, differenceInDays, addMonths } from 'date-fns'
import { ChevronLeft, ChevronRight, Calendar, Link as LinkIcon, FileText, Check, User, Users, Trash2, X, AlertTriangle, Settings, ExternalLink, Smartphone, Sparkles, Loader2, ChevronDown, ChevronUp, Repeat2, Star, CalendarPlus, Plus, ShieldAlert, Lightbulb, UserPlus, CalendarClock } from 'lucide-react'
import { apiClient, dedupedGet } from '../lib/api-client'
import { useAuth } from '../contexts/AuthContext'
import DualThumbSlider from '../components/DualThumbSlider'
import LearnerHelpIcon from '../components/LearnerHelpIcon'
import { useLearnerMode } from '../contexts/LearnerModeContext'
import { useAiAssistant } from '../contexts/AiAssistantContext'
import { LeftPanelPortal, RightPanelPortal } from '../contexts/LayoutContext'
import MeetingSidePanel from '../components/MeetingSidePanel'
import { isSafeUrl, resolveMeetingTitle } from '../lib/calendar-utils'
import { useToast } from '../components/Toast'
import ImportAvailabilityModal from '../components/ImportAvailabilityModal'
import TimezoneSelector from '../components/TimezoneSelector'
import { useTimezones } from '../lib/use-timezones'
import { findTimezone, convertUtcTimeToTimezone, getCurrentTimeInTimezone, formatUtcTimeWithPeriodInTimezone, convertUtcTimeToTimezoneOnDate, detectDstTransitions } from '../lib/timezone-data'
import type { DstTransition } from '../lib/timezone-data'
import { getWeekdayIndexFromIsoDate } from '../lib/recurrence'
import type { RecurrenceRule } from '../lib/recurrence'

type ViewMode = 'visitor' | 'admin'
type TimeInterval = 15 | 30 | 60
type CalendarVisibility = 'unlisted' | 'public'

export type { RecurrenceRule, RecurrenceType, RecurrenceUnit, RecurrenceEndType } from '../lib/recurrence'

/** Build an RFC 5545 RRULE string from a RecurrenceRule */
function _buildRRule(rule: RecurrenceRule, dtStartISO: string): string | null {
  if (!rule || rule.type === 'none') return null
  const parts: string[] = []
  if (rule.type === 'weekly') {
    parts.push('FREQ=WEEKLY;INTERVAL=1')
  } else if (rule.type === 'biweekly') {
    parts.push('FREQ=WEEKLY;INTERVAL=2')
  } else if (rule.type === 'monthly') {
    parts.push('FREQ=MONTHLY;INTERVAL=1')
  } else if (rule.type === 'custom') {
    const unit = rule.unit || 'week'
    const interval = rule.interval || 1
    if (unit === 'day') parts.push(`FREQ=DAILY;INTERVAL=${interval}`)
    else if (unit === 'week') {
      const days = (rule.weekDays || [getWeekdayIndexFromIsoDate(dtStartISO)])
        .map(d => ['MO','TU','WE','TH','FR','SA','SU'][d]).join(',')
      parts.push(`FREQ=WEEKLY;INTERVAL=${interval};BYDAY=${days}`)
    } else {
      parts.push(`FREQ=MONTHLY;INTERVAL=${interval}`)
    }
  }
  if (rule.endType === 'on' && rule.endDate) {
    parts.push(`UNTIL=${rule.endDate.replace(/-/g, '')}T235959Z`)
  } else if (rule.endType === 'after' && rule.endCount) {
    parts.push(`COUNT=${rule.endCount}`)
  }
  return parts.join(';')
}

/** Generate all occurrence cellIds for a recurring meeting visible in the current week */
function getRecurringOccurrencesInWeek(
  baseCellId: string,
  duration: number,
  rule: RecurrenceRule,
  weekStart: Date,
  _timeInterval: number
): string[] {
  if (!rule || rule.type === 'none') return []
  const [baseDateStr, baseTimeStr] = baseCellId.split('_')
  if (!baseDateStr || !baseTimeStr) return []
  const baseDate = parse(baseDateStr, 'yyyy-MM-dd', new Date())
  const weekEnd = addDays(weekStart, 7)
  const occurrences: string[] = []

  // Max occurrences to generate (guard against infinite loop)
  const maxOccurrences = rule.endType === 'after' && rule.endCount ? rule.endCount : 500

  let i = 1 // skip base occurrence (already rendered)
  let count = 1
  while (count < maxOccurrences) {
    let occDate: Date
    if (rule.type === 'weekly') {
      occDate = addWeeks(baseDate, i)
    } else if (rule.type === 'biweekly') {
      occDate = addWeeks(baseDate, i * 2)
    } else if (rule.type === 'monthly') {
      occDate = addMonths(baseDate, i)
    } else if (rule.type === 'custom') {
      const unit = rule.unit || 'week'
      const interval = rule.interval || 1
      if (unit === 'day') occDate = addDays(baseDate, i * interval)
      else if (unit === 'week') occDate = addWeeks(baseDate, i * interval)
      else occDate = addMonths(baseDate, i * interval)
    } else {
      break
    }

    // Check end conditions
    if (rule.endType === 'on' && rule.endDate) {
      const endDate = parse(rule.endDate, 'yyyy-MM-dd', new Date())
      if (occDate > endDate) break
    }

    // If occurrence is in the visible week, include it
    if (occDate >= weekStart && occDate < weekEnd) {
      const occDateStr = format(occDate, 'yyyy-MM-dd')
      occurrences.push(`${occDateStr}_${baseTimeStr}`)
    }

    // Stop iterating if we've gone past the visible week
    if (occDate >= weekEnd) break

    i++
    count++
  }

  // For custom weekly with specific weekDays, handle each day separately
  if (rule.type === 'custom' && rule.unit === 'week' && rule.weekDays && rule.weekDays.length > 1) {
    const results: string[] = []
    const interval = rule.interval || 1
    // Generate week offsets that fall within range
    for (let wi = 0; wi < 200; wi++) {
      const weekBase = addWeeks(startOfWeek(baseDate, { weekStartsOn: 1 }), wi * interval)
      if (weekBase >= weekEnd) break
      for (const wd of rule.weekDays) {
        const d = addDays(weekBase, wd)
        if (d >= weekStart && d < weekEnd && !(isSameDay(d, baseDate))) {
          const ds = format(d, 'yyyy-MM-dd')
          results.push(`${ds}_${baseTimeStr}`)
        }
      }
    }
    return results
  }

  return occurrences
}

type TimeManagementMode = {
  id: string
  name: string
  main_color: string
  slot_minutes: number
}

type TimeManagementCategory = {
  id: string
  label: string
  color: string
  font_color: string
}

type BusyBlock = {
  start: string
  end: string
  sourceId: string
  color: string
  summary?: string
  categoryIds?: string[]
}

type TimeManagementEventRecord = {
  id: string
  source_type: 'manual'
  source_id: string | null
  title: string
  start_time: string
  end_time: string
  category_ids?: string[]
  recurrence_rule?: unknown
}

type MeetingFormData = {
  title: string
  meetingLink: string
  description: string
  duration: number
  recurrenceRule: RecurrenceRule
}

function createEmptyMeetingFormData(): MeetingFormData {
  return {
    title: '',
    meetingLink: '',
    description: '',
    duration: 60,
    recurrenceRule: { type: 'none' },
  }
}

function getMeetingEditorTitle(
  meeting: { title?: string; description?: string },
  calendarName: string,
): string {
  const trimmedTitle = meeting.title?.trim() || ''
  if (!trimmedTitle) return ''
  if (meeting.description?.trim() === trimmedTitle) return ''
  if (calendarName.trim() === trimmedTitle) return ''
  return trimmedTitle
}

const DAY_MS = 24 * 60 * 60 * 1000
const RECURRENCE_MAX_LOOKAHEAD_DAYS = 365 * 20
const TIME_MANAGEMENT_SYNC_CHANNEL = 'coord-time-management-sync'
const TIME_MANAGEMENT_SYNC_STORAGE_KEY = 'coord-time-management-sync-ping'

function isRecurrenceType(value: unknown): value is RecurrenceRule['type'] {
  return value === 'none' || value === 'weekly' || value === 'biweekly' || value === 'monthly' || value === 'custom'
}

function isRecurrenceUnit(value: unknown): value is NonNullable<RecurrenceRule['unit']> {
  return value === 'day' || value === 'week' || value === 'month'
}

function isRecurrenceEndType(value: unknown): value is NonNullable<RecurrenceRule['endType']> {
  return value === 'never' || value === 'on' || value === 'after'
}

function normalizeRecurrenceRule(value: unknown): RecurrenceRule {
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

function getUtcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
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
  const dayDiff = Math.floor((candidate.getTime() - baseStart.getTime()) / DAY_MS)
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

function getRecurringEventStartsInWeek(event: TimeManagementEventRecord, currentWeekStart: Date): string[] {
  const recurrenceRule = normalizeRecurrenceRule(event.recurrence_rule)
  if (recurrenceRule.type === 'none') return []

  const baseStart = new Date(event.start_time)
  if (Number.isNaN(baseStart.getTime())) return []

  const weekStart = new Date(currentWeekStart.getTime())
  const weekEnd = addDays(currentWeekStart, 7)
  const endDate = recurrenceRule.endType === 'on' && recurrenceRule.endDate ? new Date(`${recurrenceRule.endDate}T00:00:00Z`) : null
  const exceptionDates = recurrenceRule.exceptions && recurrenceRule.exceptions.length > 0 ? new Set(recurrenceRule.exceptions) : null
  const matchedStarts: string[] = []
  let matchedCount = 0

  const baseDay = new Date(Date.UTC(baseStart.getUTCFullYear(), baseStart.getUTCMonth(), baseStart.getUTCDate()))
  if (weekEnd.getTime() <= baseDay.getTime()) {
    return []
  }

  const daysUntilWeekEnd = Math.max(0, Math.floor((weekEnd.getTime() - baseDay.getTime()) / DAY_MS))
  const maxOffset = Math.min(RECURRENCE_MAX_LOOKAHEAD_DAYS, daysUntilWeekEnd + 7)

  for (let offset = 0; offset <= maxOffset; offset++) {
    const candidate = addDays(baseStart, offset)
    const candidateDay = new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth(), candidate.getUTCDate()))
    if (candidateDay.getTime() < baseDay.getTime()) continue
    if (endDate && candidateDay.getTime() > Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate())) break
    if (!isRecurringOccurrenceDate(candidate, baseStart, recurrenceRule)) continue

    matchedCount += 1
    if (recurrenceRule.endType === 'after' && recurrenceRule.endCount && matchedCount > recurrenceRule.endCount) {
      break
    }

    if (exceptionDates && exceptionDates.has(getUtcDateKey(candidate))) {
      if (candidateDay.getTime() >= weekEnd.getTime()) break
      continue
    }

    if (candidateDay.getTime() >= weekStart.getTime() && candidateDay.getTime() < weekEnd.getTime()) {
      matchedStarts.push(buildRecurrenceOccurrenceStart(baseStart, candidate))
    }

    if (candidateDay.getTime() >= weekEnd.getTime()) {
      break
    }
  }

  return matchedStarts
}

function getTimeManagementEventBusyBlocks(
  events: TimeManagementEventRecord[],
  selectedModeIds: Set<string>,
  currentWeekStart: Date,
  modeColors: Map<string, string>,
): BusyBlock[] {
  if (selectedModeIds.size === 0) return []

  const weekStart = new Date(currentWeekStart.getTime())
  const weekEnd = addDays(currentWeekStart, 7)
  const busyBlocks: BusyBlock[] = []

  for (const event of events) {
    if (!event.source_id || !selectedModeIds.has(event.source_id)) continue

    const startTime = new Date(event.start_time)
    const endTime = new Date(event.end_time)
    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime()) || endTime.getTime() <= startTime.getTime()) {
      continue
    }

    const recurrenceRule = normalizeRecurrenceRule(event.recurrence_rule)
    const occurrenceStarts = recurrenceRule.type === 'none'
      ? [startTime.toISOString()]
      : getRecurringEventStartsInWeek(event, currentWeekStart)

    for (const occurrenceStartISO of occurrenceStarts) {
      const occurrenceStart = new Date(occurrenceStartISO)
      if (Number.isNaN(occurrenceStart.getTime())) continue
      const durationMs = endTime.getTime() - startTime.getTime()
      const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs)
      if (occurrenceEnd.getTime() <= weekStart.getTime() || occurrenceStart.getTime() >= weekEnd.getTime()) continue

      busyBlocks.push({
        start: occurrenceStart.toISOString(),
        end: occurrenceEnd.toISOString(),
        sourceId: event.source_id,
        color: modeColors.get(event.source_id) || '#6B7280',
        summary: event.title || 'Busy',
        categoryIds: Array.isArray(event.category_ids)
          ? event.category_ids.filter((categoryId): categoryId is string => typeof categoryId === 'string')
          : undefined,
      })
    }
  }

  return busyBlocks
}

const MIN_DATE = new Date(2026, 0, 1) // January 1, 2026
const MAX_DATE = new Date(2027, 11, 31) // December 31, 2027

export default function CalendarPage() {
  const { hash } = useParams<{ hash?: string }>()
  const navigate = useNavigate()
  const { user, isAuthenticated, isTraveler, isCardano } = useAuth()
  const { showToast } = useToast()
  const { learnerMode } = useLearnerMode()
  const [prepareGuideCollapsed, setPrepareGuideCollapsedRaw] = useState(() => {
    try { return localStorage.getItem('prepare-learner-guide-collapsed') === 'true' } catch { return false }
  })
  const setPrepareGuideCollapsed = useCallback((v: boolean) => {
    setPrepareGuideCollapsedRaw(v)
    try { localStorage.setItem('prepare-learner-guide-collapsed', String(v)) } catch { /* ignore */ }
  }, [])
  const [calendarVisibility, setCalendarVisibility] = useState<CalendarVisibility>('unlisted')
  const [_calendarConfig, setCalendarConfig] = useState<Record<string, unknown> | null>(null)
  const [calendarTitle, setCalendarTitle] = useState<string>('')
  const [viewMode, setViewMode] = useState<ViewMode>('admin')
  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    const today = new Date()
    return startOfWeek(today, { weekStartsOn: 1 })
  })
  const [customStartDate, setCustomStartDate] = useState<string>('')
  const [customEndDate, setCustomEndDate] = useState<string>('')
  const [isStartDateLocked, setIsStartDateLocked] = useState<boolean>(false)
  const [isEndDateLocked, setIsEndDateLocked] = useState<boolean>(false)
  const tzState = useTimezones()
  const selectedTimezone = tzState.primary
  const [timeInterval, setTimeInterval] = useState<TimeInterval>(30)
  const [startHour, setStartHour] = useState<number>(0)
  const [endHour, setEndHour] = useState<number>(24)
  const [skippedDays, setSkippedDays] = useState<Set<string>>(new Set())
  const [eventName, setEventName] = useState<string>('')
  const [roomHash, setRoomHash] = useState<string>('')
  const [username, setUsername] = useState<string>('')
  
  // Calendar creator info and permissions
  const [creatorName, setCreatorName] = useState<string>('')
  const [creatorEmail, setCreatorEmail] = useState<string>('')
  const [isCreator, setIsCreator] = useState<boolean>(false)
  const [hasEditPermission, setHasEditPermission] = useState<boolean>(false)
  const [_calendarCanEdit, setCalendarCanEdit] = useState<string[]>([])
  const [calendarNotFound, setCalendarNotFound] = useState<boolean>(false)
  const [isLoadingCalendar, setIsLoadingCalendar] = useState<boolean>(!!hash)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false)
  const [isDeleting, setIsDeleting] = useState<boolean>(false)
  const [meetingDeleteIndex, setMeetingDeleteIndex] = useState<number | null>(null)
  const meetingDeleteRef = useRef<HTMLDivElement>(null)
  const calendarDeleteRef = useRef<HTMLDivElement>(null)
  const [showDistributeModal, setShowDistributeModal] = useState<boolean>(false)
  const [isCreatorFriend, setIsCreatorFriend] = useState<boolean>(false)

  // Close meeting delete popover when clicking outside
  useEffect(() => {
    if (meetingDeleteIndex === null) return
    const handleClickOutside = (e: MouseEvent) => {
      if (meetingDeleteRef.current && !meetingDeleteRef.current.contains(e.target as Node)) {
        setMeetingDeleteIndex(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [meetingDeleteIndex])

  // Close calendar delete popover when clicking outside
  useEffect(() => {
    if (!showDeleteConfirm) return
    const handleClickOutside = (e: MouseEvent) => {
      if (calendarDeleteRef.current && !calendarDeleteRef.current.contains(e.target as Node)) {
        setShowDeleteConfirm(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showDeleteConfirm])
  
  // Edit settings state
  const [isEditingSettings, setIsEditingSettings] = useState<boolean>(false)
  const [isSavingSettings, setIsSavingSettings] = useState<boolean>(false)
  const [originalSettingsBackup, setOriginalSettingsBackup] = useState<{
    eventName: string
    calendarVisibility: CalendarVisibility
    customStartDate: string
    customEndDate: string
    timeInterval: TimeInterval
    startHour: number
    endHour: number
    skippedDays: Set<string>
    hideDateNumbers: boolean
    socialLinks: { twitter: string; discord: string; youtube: string }
    onboardingUrl: string
    communityResources: Array<{ name: string; url: string }>
  } | null>(null)
  
  // Meeting decision state (set by creator) - can have multiple meetings
  const [confirmedMeetings, setConfirmedMeetings] = useState<Array<{
    id?: string // Database ID for persisted meetings
    cellId: string
    meetingLink: string
    description: string
    duration: number // in minutes
    title?: string
    timeSlots?: string[]
    recurrenceRule?: RecurrenceRule | null
  }>>([])
  const [pendingMeetingCellId, setPendingMeetingCellId] = useState<string | null>(null)
  const [editingMeetingIndex, setEditingMeetingIndex] = useState<number | null>(null)
  const [meetingFormData, setMeetingFormData] = useState<MeetingFormData>(createEmptyMeetingFormData())
  const [_showRecurrencePanel, setShowRecurrencePanel] = useState(false)
  const [showConfirmedMeetings, setShowConfirmedMeetings] = useState(true)
  // Track order in which dynamic panels were opened (latest = rightmost)
  const [panelOpenOrder, setPanelOpenOrder] = useState<string[]>([])

  // Track order of left-side panels (newest = closest to center/main content)
  const [leftPanelOrder, setLeftPanelOrder] = useState<Array<'tools' | 'meetingForm'>>(['tools'])

  // Left sidebar state: which sections are expanded (independent, not accordion)
  const [showLeftSidebar, setShowLeftSidebar] = useState(false)
  const [expandedSidebarSections, setExpandedSidebarSections] = useState<Set<'participants' | 'calendarSyncs' | 'actions'>>(new Set())

  const toggleSidebarSection = (section: 'participants' | 'calendarSyncs' | 'actions') => {
    setExpandedSidebarSections(prev => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }

  // Legacy: keep derived booleans for existing code compatibility
  const showParticipantsPanel = showLeftSidebar && expandedSidebarSections.has('participants')
  const showCalendarSyncsPanel = showLeftSidebar && expandedSidebarSections.has('calendarSyncs')
  const showActionsPanel = showLeftSidebar && expandedSidebarSections.has('actions')

  // Meeting side panel visibility
  const [showMeetingSidePanel, setShowMeetingSidePanel] = useState(false)

  const closeMobileLeftPanels = () => {
    setShowLeftSidebar(false)
    setExpandedSidebarSections(new Set())
    setShowMeetingSidePanel(false)
    setPendingMeetingCellId(null)
    setEditingMeetingIndex(null)
    setMeetingFormData(createEmptyMeetingFormData())
    setIsCreatingMeeting(false)
    setMeetingCreationSelection(new Set())
    setLeftPanelOrder(prev => prev.filter(p => p !== 'meetingForm'))
  }
  
  // Meeting creation mode state
  const [isCreatingMeeting, setIsCreatingMeeting] = useState(false)
  const [meetingCreationSelection, setMeetingCreationSelection] = useState<Set<string>>(new Set())
  const [selectedMeetingsForExport, setSelectedMeetingsForExport] = useState<Set<number>>(new Set())
  
  // Google Calendar sources state
  const [calendarSources, setCalendarSources] = useState<Array<{
    id: string
    source_type: 'google_oauth' | 'google_public_url'
    google_email: string | null
    public_url: string | null
    display_name: string
    color: string
    is_active: boolean
  }>>([])
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [checkedSourceIds, setCheckedSourceIds] = useState<Set<string>>(new Set())
  const [isExporting, setIsExporting] = useState(false)

  const [timeManagementModes, setTimeManagementModes] = useState<TimeManagementMode[]>([])
  const [timeManagementCategories, setTimeManagementCategories] = useState<TimeManagementCategory[]>([])
  const [timeManagementEvents, setTimeManagementEvents] = useState<TimeManagementEventRecord[]>([])
  const timeManagementRefreshTimerRef = useRef<number | null>(null)
  const timeManagementFetchInFlightRef = useRef<Promise<void> | null>(null)
  const timeManagementRateLimitedUntilRef = useRef(0)
  
  // Google Calendar busy times state
  const [busyBlocks, setBusyBlocks] = useState<BusyBlock[]>([])
  const [_busyLoading, setBusyLoading] = useState(false)
  const [sourceErrors, setSourceErrors] = useState<Array<{ sourceId: string; displayName: string; error: string }>>([])

  // Selection and availability state
  const [currentSelection, setCurrentSelection] = useState<Set<string>>(new Set())
  const [savedSelections, setSavedSelections] = useState<Map<string, Set<string>>>(new Map())
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState<string | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)
  const [hoveredCell, setHoveredCell] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string>('')
  
  // Suggested meetings state
  type SuggestedMeeting = {
    id: number
    cellId: string
    participants: string[]
    color: string
  }
  const [suggestedMeetings, setSuggestedMeetings] = useState<SuggestedMeeting[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  
  // Current time indicator and flash animation state
  const [currentTime, setCurrentTime] = useState(new Date())
  const [utcNow, setUtcNow] = useState(() => new Date())
  const [flashingDay, setFlashingDay] = useState<Date | null>(null)
  const [flashStartTime, setFlashStartTime] = useState<number>(0)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [animationTick, setAnimationTick] = useState<number>(0) // Used to trigger re-renders
  
  // Hide date numbers  — shows a "generic week" without specific dates
  const [hideDateNumbers, setHideDateNumbers] = useState<boolean>(false)

  // Social / community links (stored in config.socialLinks)
  const [socialLinks, setSocialLinks] = useState<{ twitter: string; discord: string; youtube: string }>({ twitter: '', discord: '', youtube: '' })

  // Onboarding URL  — shown to participants after they submit availability
  const [onboardingUrl, setOnboardingUrl] = useState<string>('')

  // Community resource links (name + URL pairs stored in config.communityResources)
  const [communityResources, setCommunityResources] = useState<Array<{ name: string; url: string }>>([])

  // Toggle for extra links section (Community Links + Next Step Link)
  const [showExtraLinks, setShowExtraLinks] = useState(false)

  // Build invite message body: greeting line plus any configured community links.
  // Used by both "Invite to Participate" and "Invite to Planning" to seed the
  // Distribution page's compose body. Calendar/meeting links are intentionally
  // omitted -- those are surfaced separately via the meeting context block.
  const buildInviteBody = (greeting: string): string => {
    const lines: string[] = [greeting]
    const links: Array<{ label: string; url: string }> = []
    if (socialLinks.twitter) links.push({ label: 'Twitter / X', url: socialLinks.twitter })
    if (socialLinks.discord) links.push({ label: 'Discord', url: socialLinks.discord })
    if (socialLinks.youtube) links.push({ label: 'YouTube', url: socialLinks.youtube })
    for (const r of communityResources) {
      if (r.name && r.url) links.push({ label: r.name, url: r.url })
    }
    if (links.length > 0) {
      lines.push('')
      lines.push('Community links and resources:')
      for (const l of links) lines.push(`- ${l.label}: ${l.url}`)
    }
    return lines.join('\n')
  }

  // Persist compose prefill so redirects/guards that drop query params
  // still land on Announcements with the intended invite draft.
  const persistAnnouncementsPrefill = (
    prefillTitle: string,
    prefillBody: string,
    opts?: { meetingIds?: string[]; calendarHash?: string; calendarOnly?: boolean }
  ): void => {
    try {
      sessionStorage.setItem('cm-ann-prefill-title', prefillTitle)
      sessionStorage.setItem('cm-ann-prefill-body', prefillBody)
      sessionStorage.setItem('cm-ann-prefill-reset', '1')
      if (opts?.meetingIds && opts.meetingIds.length > 0) {
        sessionStorage.setItem('cm-ann-prefill-meeting-ids', opts.meetingIds.join(','))
      } else {
        sessionStorage.removeItem('cm-ann-prefill-meeting-ids')
      }
      if (opts?.calendarHash) {
        sessionStorage.setItem('cm-ann-prefill-calendar-hash', opts.calendarHash)
      } else {
        sessionStorage.removeItem('cm-ann-prefill-calendar-hash')
      }
      if (opts?.calendarOnly) {
        sessionStorage.setItem('cm-ann-prefill-calendar-only', '1')
      } else {
        sessionStorage.removeItem('cm-ann-prefill-calendar-only')
      }
    } catch {
      // ignore storage failures (private mode / quota / policy)
    }
  }

  // Selected participants for orange highlighting
  const [selectedParticipants, setSelectedParticipants] = useState<Set<string>>(new Set())
  // Tooltip position for desktop hover panel
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null)
  // Right-click pin state for tooltip preview (stays open until click-away)
  const [pinnedHoverCell, setPinnedHoverCell] = useState<string | null>(null)
  const [pinnedTooltipPosition, setPinnedTooltipPosition] = useState<{ x: number; y: number } | null>(null)
  const pinnedTooltipRef = useRef<HTMLDivElement>(null)

  // AI operational assistant state
  const [aiSending, setAiSending] = useState(false)
  const [aiNotifications, setAiNotifications] = useState<{
    nameVisibility?: string
    availabilityRange?: string
    calendarParams?: string
    general?: string
  } | null>(null)
  const [_aiError, setAiError] = useState('')
  const [_aiAvailable, setAiAvailable] = useState<boolean | null>(null)
  const { setPageContext } = useAiAssistant()
  const handleAiSubmitRef = useRef<((message: string) => Promise<{ message: string; action?: string; systemPrompt?: string }>) | null>(null)

  // Unmarked weeks warning state (for multi-week availability ranges)
  const [unmarkedWeeksWarning, setUnmarkedWeeksWarning] = useState<{ direction: 'prev' | 'next' | 'both' } | null>(null)

  // Calendar subscription (follow) state
  const [isFollowing, setIsFollowing] = useState(false)
  const [followLoading, setFollowLoading] = useState(false)

  // Import availability from another calendar
  const [showImportModal, setShowImportModal] = useState(false)
  const [importPreviewSelection, setImportPreviewSelection] = useState<Set<string>>(new Set())
  const [hasPastAvailability, setHasPastAvailability] = useState(false)
  const actionControlsRowRef = useRef<HTMLDivElement | null>(null)
  const [actionRowCompactStep, setActionRowCompactStep] = useState(0)

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      const node = target instanceof Node ? target : null
      const element = node instanceof HTMLElement ? node : node?.parentElement
      if (!(element instanceof HTMLElement)) return false
      const tagName = element.tagName.toLowerCase()
      if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return true
      return element.isContentEditable
    }

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (event.defaultPrevented) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (isEditableTarget(event.target)) return

      let closedAnySidePanel = false

      const closeRightPanelEvent = new CustomEvent<{ closed?: boolean }>('closeRightSidebarPanels', {
        detail: { closed: false },
      })
      window.dispatchEvent(closeRightPanelEvent)
      if (closeRightPanelEvent.detail.closed) {
        closedAnySidePanel = true
      }

      if (showImportModal) {
        setShowImportModal(false)
        setImportPreviewSelection(new Set())
        closedAnySidePanel = true
      }

      if (showLeftSidebar || expandedSidebarSections.size > 0) {
        setShowLeftSidebar(false)
        setExpandedSidebarSections(new Set())
        closedAnySidePanel = true
      }

      if (showMeetingSidePanel || pendingMeetingCellId || editingMeetingIndex !== null || isCreatingMeeting || meetingCreationSelection.size > 0) {
        setShowMeetingSidePanel(false)
        setPendingMeetingCellId(null)
        setEditingMeetingIndex(null)
        setMeetingFormData(createEmptyMeetingFormData())
        setIsCreatingMeeting(false)
        setMeetingCreationSelection(new Set())
        setLeftPanelOrder(prev => prev.filter(p => p !== 'meetingForm'))
        closedAnySidePanel = true
      }

      event.preventDefault()
      if (closedAnySidePanel) return
      setShowConfirmedMeetings(prev => !prev)
    }

    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [
    editingMeetingIndex,
    expandedSidebarSections,
    isCreatingMeeting,
    meetingCreationSelection,
    pendingMeetingCellId,
    showImportModal,
    showLeftSidebar,
    showMeetingSidePanel,
  ])

  // Hour slider preview state (progressive stepping to avoid reflow feedback loop)
  const [previewStartHour, setPreviewStartHour] = useState<number | null>(null)
  const [previewEndHour, setPreviewEndHour] = useState<number | null>(null)
  const displayStartHour = previewStartHour ?? startHour
  const displayEndHour = previewEndHour ?? endHour

  // Progressive slider refs
  const startHourTargetRef = useRef<number | null>(null)
  const endHourTargetRef = useRef<number | null>(null)
  const isFirstStartChange = useRef(true)
  const isFirstEndChange = useRef(true)
  const startHourTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const endHourTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Mobile landscape tip state
  const [showLandscapeTip, setShowLandscapeTip] = useState(() => {
    if (typeof window === 'undefined') return false
    const dismissed = sessionStorage.getItem('landscapeTipDismissed')
    return !dismissed && window.innerWidth < 768
  })

  // Track mobile device (based on touch capability and max screen dimension)
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false
    // Check if touch device AND smaller screen (even in landscape)
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    const smallScreen = window.screen.width <= 1024 || window.screen.height <= 1024
    return hasTouch && smallScreen
  })
  useEffect(() => {
    const checkMobile = () => {
      const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
      const smallScreen = window.screen.width <= 1024 || window.screen.height <= 1024
      setIsMobile(hasTouch && smallScreen)
    }
    window.addEventListener('resize', checkMobile)
    window.addEventListener('orientationchange', checkMobile)
    return () => {
      window.removeEventListener('resize', checkMobile)
      window.removeEventListener('orientationchange', checkMobile)
    }
  }, [])

  // Handle Zoom OAuth redirect back to calendar page (from side panel flow)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('zoom_success')) {
      showToast('Zoom connected successfully!', 'success')
      params.delete('zoom_success')
      const newSearch = params.toString()
      window.history.replaceState({}, '', window.location.pathname + (newSearch ? `?${newSearch}` : ''))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Mobile: day paging (show more days in landscape)
  const [isLandscape, setIsLandscape] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth > window.innerHeight
  })
  useEffect(() => {
    const checkOrientation = () => {
      setIsLandscape(window.innerWidth > window.innerHeight)
    }
    window.addEventListener('resize', checkOrientation)
    window.addEventListener('orientationchange', checkOrientation)
    return () => {
      window.removeEventListener('resize', checkOrientation)
      window.removeEventListener('orientationchange', checkOrientation)
    }
  }, [])
  
  // Show more days in landscape mode on mobile
  const MOBILE_DAYS_COUNT = isMobile ? (isLandscape ? 7 : 3) : 7
  const [mobileDayOffset, setMobileDayOffset] = useState(0)
  // Reset offset when week changes
  useEffect(() => { setMobileDayOffset(0) }, [currentWeekStart])

  // Popup shown when user clicks a cell that is not selectable (skipped day or out of range)
  const [notSelectablePopup, setNotSelectablePopup] = useState<{
    x: number
    y: number
    message: string
    highlightDates: Set<string>
    visible: boolean
  } | null>(null)
  useEffect(() => {
    if (!notSelectablePopup) return
    const hideTimer = setTimeout(() => {
      setNotSelectablePopup(p => p ? { ...p, visible: false } : null)
    }, 2500)
    const removeTimer = setTimeout(() => setNotSelectablePopup(null), 3000)
    return () => { clearTimeout(hideTimer); clearTimeout(removeTimer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: restart timers only when popup position/message changes, not on the visible-flag toggle this effect performs
  }, [notSelectablePopup?.x, notSelectablePopup?.y, notSelectablePopup?.message])

  // Cleanup slider intervals on unmount
  useEffect(() => {
    return () => {
      if (startHourTimerRef.current) clearInterval(startHourTimerRef.current)
      if (endHourTimerRef.current) clearInterval(endHourTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!roomHash) return
    const rowElement = actionControlsRowRef.current
    if (!rowElement) return

    const getCompactStep = (rowWidth: number): number => {
      // In non-layout environments (tests), keep full labels.
      if (!Number.isFinite(rowWidth) || rowWidth <= 0) return 0
      if (rowWidth <= 780) return 6
      if (rowWidth <= 860) return 5
      if (rowWidth <= 940) return 4
      if (rowWidth <= 1020) return 3
      if (rowWidth <= 1100) return 2
      if (rowWidth <= 1180) return 1
      return 0
    }

    const updateCompactStep = () => {
      const rowWidth = rowElement.getBoundingClientRect().width
      const nextStep = getCompactStep(rowWidth)
      setActionRowCompactStep(prev => (prev === nextStep ? prev : nextStep))
    }

    updateCompactStep()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateCompactStep)
      return () => window.removeEventListener('resize', updateCompactStep)
    }

    const observer = new ResizeObserver(() => updateCompactStep())
    observer.observe(rowElement)
    return () => observer.disconnect()
  }, [roomHash, hasPastAvailability, isCreator, isCreatingMeeting, isAuthenticated, currentSelection.size])

  const createMeetingButtonText = actionRowCompactStep >= 5
    ? ''
    : actionRowCompactStep >= 4
      ? 'Meeting'
      : actionRowCompactStep >= 1
        ? 'Meeting Time'
        : 'Create Meeting Time'
  const aiAssistantButtonText = actionRowCompactStep >= 6
    ? ''
    : actionRowCompactStep >= 2
      ? 'AI'
      : 'AI Assistant'
  const importButtonText = actionRowCompactStep >= 3 ? '' : 'Import'
  const useCompactButtonPadding = actionRowCompactStep >= 3
  const toolsSidebarWidthClass = 'w-[20rem] xl:w-[22rem] 2xl:w-[24rem]'
  const toolsSidebarInnerWidthClass = `${toolsSidebarWidthClass} min-w-[20rem]`

  const handleStartHourSlider = (target: number) => {
    setPreviewStartHour(target)
    startHourTargetRef.current = target
    if (isFirstStartChange.current) {
      setStartHour(target)
      isFirstStartChange.current = false
      if (startHourTimerRef.current) clearInterval(startHourTimerRef.current)
      startHourTimerRef.current = setInterval(() => {
        const t = startHourTargetRef.current
        if (t === null) return
        setStartHour(prev => {
          if (prev === t) return prev
          return t > prev ? prev + 1 : prev - 1
        })
      }, 700)
    }
  }

  const releaseStartHourSlider = () => {
    if (startHourTimerRef.current) { clearInterval(startHourTimerRef.current); startHourTimerRef.current = null }
    if (startHourTargetRef.current !== null) setStartHour(startHourTargetRef.current)
    startHourTargetRef.current = null
    isFirstStartChange.current = true
    setPreviewStartHour(null)
  }

  const handleEndHourSlider = (target: number) => {
    setPreviewEndHour(target)
    endHourTargetRef.current = target
    if (isFirstEndChange.current) {
      setEndHour(target)
      isFirstEndChange.current = false
      if (endHourTimerRef.current) clearInterval(endHourTimerRef.current)
      endHourTimerRef.current = setInterval(() => {
        const t = endHourTargetRef.current
        if (t === null) return
        setEndHour(prev => {
          if (prev === t) return prev
          return t > prev ? prev + 1 : prev - 1
        })
      }, 200)
    }
  }

  const releaseEndHourSlider = () => {
    if (endHourTimerRef.current) { clearInterval(endHourTimerRef.current); endHourTimerRef.current = null }
    if (endHourTargetRef.current !== null) setEndHour(endHourTargetRef.current)
    endHourTargetRef.current = null
    isFirstEndChange.current = true
    setPreviewEndHour(null)
  }

  const calendarGridRef = useRef<HTMLDivElement>(null)
  const nowLineRef = useRef<HTMLDivElement>(null)

  // Allow page scrolling when the calendar grid is scrolled to its boundary
  useEffect(() => {
    const el = calendarGridRef.current
    if (!el) return

    const handleWheel = (e: WheelEvent) => {
      const tolerance = 1
      const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < tolerance
      const isAtTop = el.scrollTop < tolerance

      if ((e.deltaY > 0 && isAtBottom) || (e.deltaY < 0 && isAtTop)) {
        e.preventDefault()
        window.scrollBy(0, e.deltaY)
      }
    }

    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [])

  // Fairy dust refs for unmarked weeks warning
  const unmarkedWarningRef = useRef<HTMLDivElement>(null)
  const prevButtonRef = useRef<HTMLButtonElement>(null)
  const nextButtonRef = useRef<HTMLButtonElement>(null)

  // Fairy dust particle animation: spawns sparkles from warning ā†’ target button(s)
  useEffect(() => {
    if (!unmarkedWeeksWarning) return
    const warningEl = unmarkedWarningRef.current
    if (!warningEl) return

    const targets: HTMLElement[] = []
    if ((unmarkedWeeksWarning.direction === 'prev' || unmarkedWeeksWarning.direction === 'both') && prevButtonRef.current) {
      targets.push(prevButtonRef.current)
    }
    if ((unmarkedWeeksWarning.direction === 'next' || unmarkedWeeksWarning.direction === 'both') && nextButtonRef.current) {
      targets.push(nextButtonRef.current)
    }
    if (targets.length === 0) return

    let cancelled = false
    const particles: HTMLDivElement[] = []

    const spawnParticle = () => {
      if (cancelled) return
      const target = targets[Math.floor(Math.random() * targets.length)]
      const wRect = warningEl.getBoundingClientRect()
      const tRect = target.getBoundingClientRect()

      const startX = wRect.left + Math.random() * wRect.width
      const startY = wRect.top + wRect.height / 2
      const endX = tRect.left + tRect.width / 2
      const endY = tRect.top + tRect.height / 2

      const particle = document.createElement('div')
      const size = 3 + Math.random() * 4
      particle.style.cssText = `
        position: fixed;
        left: ${startX}px;
        top: ${startY}px;
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        pointer-events: none;
        z-index: 9999;
        background: radial-gradient(circle, rgba(251,191,36,0.9), rgba(245,158,11,0.6));
        box-shadow: 0 0 ${size + 2}px rgba(251,191,36,0.7);
        transition: none;
      `
      document.body.appendChild(particle)
      particles.push(particle)

      const duration = 1200 + Math.random() * 800
      const startTime = performance.now()
      // Random control point for a curved path
      const cpX = (startX + endX) / 2 + (Math.random() - 0.5) * 120
      const cpY = Math.min(startY, endY) - 30 - Math.random() * 60

      const animate = (now: number) => {
        if (cancelled) { particle.remove(); return }
        const t = Math.min((now - startTime) / duration, 1)
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
        // Quadratic Bezier
        const x = (1 - ease) * (1 - ease) * startX + 2 * (1 - ease) * ease * cpX + ease * ease * endX
        const y = (1 - ease) * (1 - ease) * startY + 2 * (1 - ease) * ease * cpY + ease * ease * endY
        const scale = t < 0.3 ? t / 0.3 : t > 0.7 ? (1 - t) / 0.3 : 1
        const opacity = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1
        particle.style.left = `${x}px`
        particle.style.top = `${y}px`
        particle.style.transform = `scale(${scale})`
        particle.style.opacity = `${opacity}`
        if (t < 1) {
          requestAnimationFrame(animate)
        } else {
          particle.remove()
        }
      }
      requestAnimationFrame(animate)
    }

    // Initial burst of particles (4x density)
    for (let i = 0; i < 24; i++) {
      setTimeout(() => { if (!cancelled) spawnParticle() }, i * 30)
    }
    // Continuous stream every ~150ms (4x rate)
    const interval = setInterval(() => {
      if (cancelled) return
      spawnParticle()
      // Often add extra sparkles
      if (Math.random() > 0.3) setTimeout(() => { if (!cancelled) spawnParticle() }, 40 + Math.random() * 80)
      if (Math.random() > 0.6) setTimeout(() => { if (!cancelled) spawnParticle() }, 80 + Math.random() * 100)
    }, 150)

    // Stop spawning particles after 15 seconds
    const stopTimer = setTimeout(() => {
      clearInterval(interval)
    }, 15000)

    return () => {
      cancelled = true
      clearInterval(interval)
      clearTimeout(stopTimer)
      particles.forEach(p => p.remove())
    }
  }, [unmarkedWeeksWarning])

  // ā”€ā”€ Ref for Confirmed Meetings section (fairy dust target) ā”€ā”€
  const confirmedMeetingsRef = useRef<HTMLDivElement>(null)

  // ā”€ā”€ Fairy dust: side panel opens ā†’ light blue sparkles fly from grid selection to Duration field ā”€ā”€
  useEffect(() => {
    if (!showMeetingSidePanel || !pendingMeetingCellId) return
    // Skip fairy dust when editing an existing meeting
    if (editingMeetingIndex !== null) return
    // Small delay so the panel slide-in has started
    const startDelay = setTimeout(() => {
      const durationInput = document.querySelector('[data-meeting-duration-input]') as HTMLElement | null
      if (!durationInput) return

      // Find the source cell(s) on the grid
      const sourceCell = document.querySelector(`[data-cell-id="${pendingMeetingCellId}"]`) as HTMLElement | null
      // Also gather all meeting creation selection cells for a wider spawn area
      const allSelectionCells = document.querySelectorAll('[data-cell-id]')
      const selectedCells: HTMLElement[] = []
      allSelectionCells.forEach(el => {
        if ((el as HTMLElement).classList.contains('bg-blue-400')) {
          selectedCells.push(el as HTMLElement)
        }
      })
      // Fall back to the pending cell if no blue cells found yet
      const spawnSources = selectedCells.length > 0 ? selectedCells : (sourceCell ? [sourceCell] : [])
      if (spawnSources.length === 0) return

      let cancelled = false
      const particles: HTMLDivElement[] = []

      const spawnParticle = () => {
        if (cancelled) return
        const tRect = durationInput.getBoundingClientRect()
        // Pick a random source cell to spawn from
        const src = spawnSources[Math.floor(Math.random() * spawnSources.length)]
        const sRect = src.getBoundingClientRect()
        const startX = sRect.left + Math.random() * sRect.width
        const startY = sRect.top + Math.random() * sRect.height
        const endX = tRect.left + tRect.width / 2
        const endY = tRect.top + tRect.height / 2

        const particle = document.createElement('div')
        const size = 2 + Math.random() * 3.5
        particle.style.cssText = `
          position: fixed;
          left: ${startX}px;
          top: ${startY}px;
          width: ${size}px;
          height: ${size}px;
          border-radius: 50%;
          pointer-events: none;
          z-index: 9999;
          background: radial-gradient(circle, rgba(56,189,248,0.95), rgba(14,165,233,0.7));
          box-shadow: 0 0 ${size + 3}px rgba(56,189,248,0.8), 0 0 ${size + 8}px rgba(56,189,248,0.3);
        `
        document.body.appendChild(particle)
        particles.push(particle)

        const duration = 300 + Math.random() * 250
        const startTime = performance.now()
        const cpX = (startX + endX) / 2 + (Math.random() - 0.5) * 100
        const cpY = Math.min(startY, endY) - 30 - Math.random() * 60

        const animate = (now: number) => {
          if (cancelled) { particle.remove(); return }
          const t = Math.min((now - startTime) / duration, 1)
          const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
          const x = (1 - ease) * (1 - ease) * startX + 2 * (1 - ease) * ease * cpX + ease * ease * endX
          const y = (1 - ease) * (1 - ease) * startY + 2 * (1 - ease) * ease * cpY + ease * ease * endY
          const scale = t < 0.2 ? t / 0.2 : t > 0.7 ? (1 - t) / 0.3 : 1
          const opacity = t > 0.5 ? 1 - (t - 0.5) / 0.5 : 1
          particle.style.left = `${x}px`
          particle.style.top = `${y}px`
          particle.style.transform = `scale(${scale})`
          particle.style.opacity = `${opacity}`
          if (t < 1) requestAnimationFrame(animate)
          else particle.remove()
        }
        requestAnimationFrame(animate)
      }

      // Quick burst
      for (let i = 0; i < 18; i++) {
        setTimeout(() => { if (!cancelled) spawnParticle() }, i * 12)
      }
      // Continuous fast stream
      const interval = setInterval(() => {
        if (cancelled) return
        spawnParticle()
        if (Math.random() > 0.4) setTimeout(() => { if (!cancelled) spawnParticle() }, 10 + Math.random() * 25)
      }, 50)

      // Stop after 1.5 seconds (halved from 3s)
      const stopTimer = setTimeout(() => clearInterval(interval), 1500)

      return () => {
        cancelled = true
        clearInterval(interval)
        clearTimeout(stopTimer)
        particles.forEach(p => p.remove())
      }
    }, 350) // wait for panel slide-in

    return () => clearTimeout(startDelay)
  }, [showMeetingSidePanel, pendingMeetingCellId, editingMeetingIndex])

  // ā”€ā”€ Fairy dust: after meeting confirmed ā†’ sparkles converge on card then orbit it ā”€ā”€
  const spawnConfirmDust = useCallback(() => {
    const confirmBtn = document.querySelector('[data-meeting-confirm-btn]') as HTMLElement | null
    if (!confirmBtn) return

    const btnRect = confirmBtn.getBoundingClientRect()
    const particles: HTMLDivElement[] = []
    let cancelled = false

    // Wait for React to render the new card (needs 2 frames for state + DOM)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const allCards = document.querySelectorAll('[data-meeting-card]')
      const targetCard = allCards[allCards.length - 1] as HTMLElement | null
      if (!targetCard || cancelled) return

      const cardRect = targetCard.getBoundingClientRect()
      const cardCenterX = cardRect.left + cardRect.width / 2
      const cardCenterY = cardRect.top + cardRect.height / 2

      // Perimeter point at parameter t (0-1) around the card
      const getPerimeterPoint = (t: number): [number, number] => {
        const pad = 6
        const l = cardRect.left - pad, r = cardRect.right + pad
        const tp = cardRect.top - pad, bt = cardRect.bottom + pad
        const w = r - l, h = bt - tp
        const perim = 2 * (w + h)
        const d = ((t % 1) + 1) % 1 * perim
        if (d < w) return [l + d, tp]
        if (d < w + h) return [r, tp + (d - w)]
        if (d < 2 * w + h) return [r - (d - w - h), bt]
        return [l, bt - (d - 2 * w - h)]
      }

      const spawnParticle = (perimT: number, delay: number) => {
        if (cancelled) return
        setTimeout(() => {
          if (cancelled) return
          const startX = btnRect.left + btnRect.width / 2 + (Math.random() - 0.5) * 12
          const startY = btnRect.top + btnRect.height / 2 + (Math.random() - 0.5) * 6

          const particle = document.createElement('div')
          const size = 2.5 + Math.random() * 3.5
          particle.style.cssText = `
            position: fixed;
            left: ${startX}px;
            top: ${startY}px;
            width: ${size}px;
            height: ${size}px;
            border-radius: 50%;
            pointer-events: none;
            z-index: 9999;
            background: radial-gradient(circle, rgba(56,189,248,0.95), rgba(14,165,233,0.7));
            box-shadow: 0 0 ${size + 3}px rgba(56,189,248,0.8), 0 0 ${size + 8}px rgba(56,189,248,0.3);
          `
          document.body.appendChild(particle)
          particles.push(particle)

          // Phase 1: Fly straight to card center (400ms)
          // Phase 2: Move from center to perimeter point and orbit (1200ms)
          const PHASE1 = 400
          const PHASE2 = 1200
          const totalDuration = PHASE1 + PHASE2
          const startTime = performance.now()
          const [perimX, perimY] = getPerimeterPoint(perimT)
          // Orbit: after reaching perimeter, travel ~0.3 of perimeter distance
          const orbitDistance = 0.3
          const [orbitEndX, orbitEndY] = getPerimeterPoint(perimT + orbitDistance)

          const animate = (now: number) => {
            if (cancelled) { particle.remove(); return }
            const elapsed = now - startTime
            const tTotal = Math.min(elapsed / totalDuration, 1)

            let x: number, y: number, scale: number, opacity: number

            if (elapsed < PHASE1) {
              // Phase 1: straight line from button ā†’ card center
              const t1 = elapsed / PHASE1
              const ease = t1 < 0.5 ? 2 * t1 * t1 : 1 - Math.pow(-2 * t1 + 2, 2) / 2
              x = startX + (cardCenterX - startX) * ease
              y = startY + (cardCenterY - startY) * ease
              scale = t1 < 0.2 ? t1 / 0.2 : 1
              opacity = 1
            } else {
              // Phase 2: center ā†’ perimeter point ā†’ orbit along perimeter
              const t2 = (elapsed - PHASE1) / PHASE2
              const ease2 = t2 < 0.5 ? 2 * t2 * t2 : 1 - Math.pow(-2 * t2 + 2, 2) / 2
              void ease2
              if (t2 < 0.3) {
                // Sub-phase: center ā†’ perimeter arrival
                const sub = t2 / 0.3
                x = cardCenterX + (perimX - cardCenterX) * sub
                y = cardCenterY + (perimY - cardCenterY) * sub
              } else {
                // Sub-phase: orbit along perimeter
                const orbitT = (t2 - 0.3) / 0.7
                const orbitEase = orbitT
                x = perimX + (orbitEndX - perimX) * orbitEase
                y = perimY + (orbitEndY - perimY) * orbitEase
              }
              scale = 1
              opacity = t2 > 0.6 ? 1 - (t2 - 0.6) / 0.4 : 1
            }

            particle.style.left = `${x}px`
            particle.style.top = `${y}px`
            particle.style.transform = `scale(${scale})`
            particle.style.opacity = `${opacity}`
            if (tTotal < 1) requestAnimationFrame(animate)
            else particle.remove()
          }
          requestAnimationFrame(animate)
        }, delay)
      }

      // Spawn particles in a rapid burst, each assigned an evenly-spaced perimeter slot
      const totalParticles = 32
      for (let i = 0; i < totalParticles; i++) {
        const perimT = i / totalParticles
        spawnParticle(perimT, i * 18)
      }
    }))

    // Cleanup after 4 seconds
    setTimeout(() => {
      cancelled = true
      particles.forEach(p => p.remove())
    }, 4000)
  }, [])
  
  // Animation parameters
  const FADE_IN_DURATION = 2000 // 2 seconds to fill with color
  const CELL_FADE_DELAY = 40 // milliseconds between each cell starting to fade
  const CELL_FADE_DURATION = 400 // how long each individual cell takes to fade out

  // Update current time every 30 seconds for red line indicator
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date())
    }, 30000)
    return () => clearInterval(interval)
  }, [])

  // Center the scrollable grid so the current-time line starts near the middle.
  useEffect(() => {
    const now = new Date()
    const currentHourUTC = now.getUTCHours()
    if (currentHourUTC < startHour || currentHourUTC >= endHour) {
      return
    }

    if (!calendarGridRef.current || !nowLineRef.current) {
      return
    }

    let raf1 = 0
    let raf2 = 0
    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        nowLineRef.current?.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' })
      })
    })

    return () => {
      if (raf1) window.cancelAnimationFrame(raf1)
      if (raf2) window.cancelAnimationFrame(raf2)
    }
  }, [startHour, endHour, timeInterval])

  // Update UTC clock every second for accurate display
  useEffect(() => {
    const interval = setInterval(() => {
      setUtcNow(new Date())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  // Fetch calendar config if hash is present
  useEffect(() => {
    if (hash) {
      setIsLoadingCalendar(true)
      setViewMode('visitor')
      setRoomHash(hash) // Set immediately so layout renders correctly

      // Check if the logged-in user has past availability to import
      if (isAuthenticated) {
        apiClient.get(`/api/availability/user/past?exclude_hash=${encodeURIComponent(hash)}`)
          .then(res => setHasPastAvailability((res.data.entries || []).length > 0))
          .catch(() => setHasPastAvailability(false))
      }
      setCalendarNotFound(false) // Reset not found state
      apiClient.get(`/api/calendars/${hash}`)
        .then(res => {
          setCalendarConfig(res.data.config || {})
          setCalendarTitle(res.data.title || '')
          if (res.data.visibility) setCalendarVisibility(res.data.visibility)
          
          // Set creator info  — prefer resolved display name, fall back to created_by
          const calendarCreator = res.data.created_by || ''
          setCreatorEmail(calendarCreator)
          setCreatorName(res.data.creator_display_name || calendarCreator)
          setIsCreatorFriend(res.data.is_friend_with_creator || false)
          
          // Use server-computed ownership flags (server matches against all identity formats)
          const canEditList = res.data.permissions?.canEdit || []
          setCalendarCanEdit(canEditList)
          setIsCreator(res.data.is_owner || false)
          setHasEditPermission(res.data.has_edit_permission || false)
          
          // Load calendar configuration
          if (res.data.config) {
            const config = res.data.config
            if (config.customStartDate) setCustomStartDate(config.customStartDate)
            if (config.customEndDate) setCustomEndDate(config.customEndDate)
            if (config.timeInterval) setTimeInterval(config.timeInterval)
            if (config.startHour !== undefined) setStartHour(config.startHour)
            if (config.endHour !== undefined) setEndHour(config.endHour)
            if (config.skippedDays) setSkippedDays(new Set(config.skippedDays))
            if (config.eventName) setEventName(config.eventName)
            if (config.hideDateNumbers !== undefined) setHideDateNumbers(config.hideDateNumbers)
            if (config.socialLinks) setSocialLinks({ twitter: config.socialLinks.twitter || '', discord: config.socialLinks.discord || '', youtube: config.socialLinks.youtube || '' })
            if (config.onboardingUrl) setOnboardingUrl(config.onboardingUrl)
            if (config.communityResources) setCommunityResources(config.communityResources)

            // Navigate the calendar view to the appropriate week
            if (config.hideDateNumbers) {
              // Weekly availability: always show the current week
              setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))
            } else if (config.customStartDate) {
              const startDate = parse(config.customStartDate, 'yyyy-MM-dd', new Date())
              const endDate = config.customEndDate ? parse(config.customEndDate, 'yyyy-MM-dd', new Date()) : null
              if (isValid(startDate)) {
                const thisWeek = startOfWeek(new Date(), { weekStartsOn: 1 })
                const configStartWeek = startOfWeek(startDate, { weekStartsOn: 1 })
                const configEndWeek = endDate && isValid(endDate) ? startOfWeek(endDate, { weekStartsOn: 1 }) : null
                if (thisWeek < configStartWeek) {
                  // Calendar starts in the future -- jump to its first week
                  setCurrentWeekStart(configStartWeek)
                } else if (configEndWeek && thisWeek > configEndWeek) {
                  // Calendar range is fully in the past -- land on the last week of the range
                  setCurrentWeekStart(configEndWeek)
                }
                // Otherwise keep the current week (useState default) -- meetings load will refine further
              }
            }
          }
          
          // Load availability and meetings
          loadAvailabilityFromDatabase(hash)
          loadMeetingsFromDatabase(hash)

          // Subscription check moved to its own useEffect (depends on isAuthenticated)
        })
        .catch(() => {
          setCalendarConfig(null)
          setCalendarTitle('')
          setRoomHash('') // Clear since calendar doesn't exist
          setCalendarNotFound(true) // Set not found state
        })
        .finally(() => {
          setIsLoadingCalendar(false)
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: load calendar only on hash change; auth-dependent permission refresh runs in a separate effect
  }, [hash])

  // Check subscription status once auth is ready
  useEffect(() => {
    if (hash && isAuthenticated) {
      apiClient.get(`/api/calendar-subscriptions/check/${hash}`)
        .then(r => setIsFollowing(r.data.subscribed))
        .catch(() => {})
    }
  }, [hash, isAuthenticated])

  // Handle traveler-to-Google upgrade: transfer ownership once auth state is ready
  useEffect(() => {
    if (!hash || !isAuthenticated || isTraveler) return
    // Only proceed if there's a pending transfer
    const previousCreatorBy = sessionStorage.getItem('previousCreatorBy')
    const previousTravelerId = sessionStorage.getItem('previousTravelerId')
    if (!previousCreatorBy && !previousTravelerId) return
    // Wait until the calendar data has been fetched (creatorEmail is set)
    if (!creatorEmail) return

    // Check if the calendar's created_by matches either stored value
    const transferKey = previousCreatorBy || previousTravelerId!
    if (creatorEmail === transferKey || creatorEmail === previousTravelerId) {
      sessionStorage.removeItem('previousTravelerId')
      sessionStorage.removeItem('previousCreatorBy')
      apiClient.patch(`/api/calendars/${hash}/transfer-ownership`, { previousCreatorId: transferKey })
        .then(transferRes => {
          setCreatorEmail(transferRes.data.created_by)
          setCreatorName(transferRes.data.creator_display_name || transferRes.data.created_by)
          setIsCreator(true)
          setHasEditPermission(true)
        })
        .catch(err => console.error('Failed to transfer ownership:', err))
    } else {
      // Clean up if not applicable to this calendar
      sessionStorage.removeItem('previousTravelerId')
      sessionStorage.removeItem('previousCreatorBy')
    }
  }, [hash, isAuthenticated, isTraveler, creatorEmail])

  // Re-evaluate permissions when auth state changes by re-fetching from server
  // (server compares all identity formats  — email, userId, fake email  — correctly)
  useEffect(() => {
    if (!hash || !isAuthenticated || !user) return
    // Re-fetch the calendar to get updated is_owner / has_edit_permission from server
    apiClient.get(`/api/calendars/${hash}`)
      .then(res => {
        setIsCreator(res.data.is_owner || false)
        setHasEditPermission(res.data.has_edit_permission || false)
        const canEditList = res.data.permissions?.canEdit || []
        setCalendarCanEdit(canEditList)
        // Update creator info in case ownership was transferred
        if (res.data.created_by) {
          setCreatorEmail(res.data.created_by)
          setCreatorName(res.data.creator_display_name || res.data.created_by)
        }
        setIsCreatorFriend(res.data.is_friend_with_creator || false)
      })
      .catch(() => { /* calendar may not exist yet */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: guard only checks user presence; re-run is keyed on user?.id to avoid refetching on unrelated user changes
  }, [hash, isAuthenticated, user?.id])

  // Function to load availability from database
  const loadAvailabilityFromDatabase = async (calendarHash: string) => {
    try {
      const response = await apiClient.get(`/api/availability/${calendarHash}`)
      const availabilityData = response.data
      
      // Convert database data to savedSelections format
      const newSavedSelections = new Map<string, Set<string>>()
      availabilityData.forEach((availability: { username: string; time_slots: string[] }) => {
        newSavedSelections.set(availability.username, new Set(availability.time_slots))
      })
      
      setSavedSelections(newSavedSelections)
    } catch (error) {
      console.error('Error loading availability:', error)
    }
  }

  // Function to load meetings from database
  const loadMeetingsFromDatabase = async (calendarHash: string) => {
    try {
      const response = await apiClient.get(`/api/meetings/${calendarHash}`)
      const meetingsData = response.data
      
      // Convert database data to confirmedMeetings format
      const meetings = meetingsData.map((meeting: {
        id: string
        time_slots: unknown
        meeting_link?: string
        description?: string
        duration_minutes: number
        title: string
        recurrence_rule?: RecurrenceRule | null
      }) => {
        // Convert time_slots format from "2026-01-27T10:00" to "2026-01-27_10:00"
        // Ensure time_slots is always an array (DB may store as string or other non-array)
        const rawSlots = meeting.time_slots
        const timeSlots: string[] = Array.isArray(rawSlots)
          ? rawSlots
          : typeof rawSlots === 'string' && rawSlots
            ? [rawSlots]
            : []
        const firstSlot = timeSlots[0] || ''
        // Convert ISO format to cellId format (replace T with _)
        const cellId = firstSlot.replace('T', '_')
        
        return {
          id: meeting.id,
          cellId: cellId,
          meetingLink: meeting.meeting_link || '',
          description: meeting.description || '',
          duration: meeting.duration_minutes,
          title: meeting.title,
          timeSlots: timeSlots.map((slot: string) => slot.replace('T', '_')),
          recurrenceRule: meeting.recurrence_rule || null
        }
      }).filter((meeting: { cellId: string }) => meeting.cellId) // Filter out meetings without valid cellId
      
      setConfirmedMeetings(meetings)

      // Smart initial week: if next week has meetings but current week has no future meetings, advance to next week
      const now = new Date()
      const thisWeekStart = startOfWeek(now, { weekStartsOn: 1 })
      const nextWeekStart = addWeeks(thisWeekStart, 1)
      const nextWeekEnd = addWeeks(nextWeekStart, 1)

      const hasFutureMeetingsThisWeek = meetings.some((m: { cellId: string; recurrenceRule: RecurrenceRule | null; duration: number }) => {
        const cellIds: string[] = []
        const [baseDateStr, baseTimeStr] = m.cellId.split('_')
        if (baseDateStr && baseTimeStr) {
          const baseDate = parse(baseDateStr, 'yyyy-MM-dd', new Date())
          if (isValid(baseDate) && baseDate >= thisWeekStart && baseDate < nextWeekStart) {
            cellIds.push(m.cellId)
          }
        }
        if (m.recurrenceRule && m.recurrenceRule.type !== 'none') {
          cellIds.push(...getRecurringOccurrencesInWeek(m.cellId, m.duration, m.recurrenceRule, thisWeekStart, 30))
        }
        return cellIds.some((cellId: string) => {
          const [ds, ts] = cellId.split('_')
          if (!ds || !ts) return false
          const meetingStart = parse(`${ds}T${ts}`, "yyyy-MM-dd'T'HH:mm", new Date())
          return isValid(meetingStart) && meetingStart >= now
        })
      })

      const hasMeetingsNextWeek = meetings.some((m: { cellId: string; recurrenceRule: RecurrenceRule | null; duration: number }) => {
        const [baseDateStr] = m.cellId.split('_')
        if (baseDateStr) {
          const baseDate = parse(baseDateStr, 'yyyy-MM-dd', new Date())
          if (isValid(baseDate) && baseDate >= nextWeekStart && baseDate < nextWeekEnd) return true
        }
        if (m.recurrenceRule && m.recurrenceRule.type !== 'none') {
          const occs = getRecurringOccurrencesInWeek(m.cellId, m.duration, m.recurrenceRule, nextWeekStart, 30)
          if (occs.length > 0) return true
        }
        return false
      })

      if (!hasFutureMeetingsThisWeek && hasMeetingsNextWeek) {
        setCurrentWeekStart(nextWeekStart)
      }
    } catch (error) {
      console.error('Error loading meetings:', error)
    }
  }
  
  // Function to delete calendar
  const handleDeleteCalendar = async () => {
    if (!roomHash || !hasEditPermission) return
    
    setIsDeleting(true)
    try {
      await apiClient.delete(`/api/calendars/${roomHash}`)
      
      setShowDeleteConfirm(false)
      // Navigate back to events page after deletion
      navigate('/calendars')
    } catch (error) {
      console.error('Error deleting calendar:', error)
      alert((error as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to delete calendar')
    } finally {
      setIsDeleting(false)
    }
  }
  

  
  // Force re-renders during flash animation for smooth fading
  useEffect(() => {
    if (!flashingDay) return
    
    const interval = setInterval(() => {
      // Trigger a re-render by incrementing counter
      setAnimationTick(prev => prev + 1)
    }, 30) // Update every 30ms for very smooth animation (33 fps)
    
    return () => clearInterval(interval)
  }, [flashingDay])

  // Fetch calendar sources for authenticated users
  const fetchCalendarSources = useCallback(async () => {
    if (!isAuthenticated || isTraveler) return
    setSourcesLoading(true)
    try {
      const res = await apiClient.get('/api/calendar-sources')
      const sources = res.data.sources || []
      setCalendarSources(sources)
      // Restore remembered calendar selections from localStorage
      const stored = localStorage.getItem('calendarSourceSelections')
      if (stored) {
        try {
          const rememberedIds: string[] = JSON.parse(stored)
          const activeIds = new Set(sources.filter((s: { is_active?: boolean }) => s.is_active).map((s: { id: string }) => s.id))
          // Only select sources that are both remembered AND still active/available
          setCheckedSourceIds(new Set(rememberedIds.filter(id => activeIds.has(id))))
        } catch {
          // Corrupted storage  — default to none (first-time behaviour)
          setCheckedSourceIds(new Set())
        }
      } else {
        // First time: nothing selected
        setCheckedSourceIds(new Set())
      }
    } catch (err) {
      console.error('Failed to fetch calendar sources:', err)
    } finally {
      setSourcesLoading(false)
    }
  }, [isAuthenticated, isTraveler])

  useEffect(() => {
    fetchCalendarSources()
  }, [fetchCalendarSources])

  const timeManagementModeIdsWithItems = useMemo(() => {
    const ids = new Set<string>()
    for (const event of timeManagementEvents) {
      if (event.source_type === 'manual' && event.source_id) {
        ids.add(event.source_id)
      }
    }
    return ids
  }, [timeManagementEvents])

  const secretSwarmModes = useMemo(
    () => timeManagementModes.filter(mode => timeManagementModeIdsWithItems.has(mode.id)),
    [timeManagementModes, timeManagementModeIdsWithItems]
  )

  const secretSwarmModeIds = useMemo(
    () => secretSwarmModes.map(mode => mode.id),
    [secretSwarmModes]
  )

  const activeGoogleSourceIds = useMemo(
    () => calendarSources
      .filter(s => checkedSourceIds.has(s.id) && (s.source_type === 'google_oauth' || s.source_type === 'google_public_url'))
      .map(s => s.id),
    [calendarSources, checkedSourceIds]
  )

  const activeSecretSwarmModeIds = useMemo(
    () => secretSwarmModes.filter(mode => checkedSourceIds.has(mode.id)).map(mode => mode.id),
    [checkedSourceIds, secretSwarmModes]
  )

  const modeColors = useMemo(
    () => new Map(secretSwarmModes.map(mode => [mode.id, mode.main_color] as const)),
    [secretSwarmModes]
  )

  const manualBusyBlocks = useMemo(
    () => getTimeManagementEventBusyBlocks(timeManagementEvents, new Set(activeSecretSwarmModeIds), currentWeekStart, modeColors),
    [activeSecretSwarmModeIds, currentWeekStart, modeColors, timeManagementEvents]
  )

  const combinedBusyBlocks = useMemo(
    () => [...busyBlocks, ...manualBusyBlocks],
    [busyBlocks, manualBusyBlocks]
  )

  const timeManagementCategoryLookup = useMemo(
    () => new Map(timeManagementCategories.map(category => [category.id, category] as const)),
    [timeManagementCategories]
  )

  const truncateMeetingSummary = useCallback((summary: string) => {
    if (summary.length <= 30) return summary
    return `${summary.slice(0, 28)}..`
  }, [])

  const fetchTimeManagementSources = useCallback(async () => {
    if (!isAuthenticated) {
      setTimeManagementModes([])
      setTimeManagementCategories([])
      setTimeManagementEvents([])
      return
    }

    if (timeManagementFetchInFlightRef.current) {
      return timeManagementFetchInFlightRef.current
    }

    if (Date.now() < timeManagementRateLimitedUntilRef.current) {
      return
    }

    const request = (async () => {
      const isRateLimitedError = (error: unknown): boolean => {
        if (!(error instanceof Error)) return false

        const maybeRateLimitError = error as Error & {
          isRateLimitError?: boolean
          response?: { status?: number }
        }

        if (maybeRateLimitError.isRateLimitError === true) return true
        if (maybeRateLimitError.response?.status === 429) return true
        return error.message.toLowerCase().includes('too many time-management requests')
      }

      try {
        const [modesRes, categoriesRes, eventsRes] = await Promise.all([
          dedupedGet('/api/time-management/modes'),
          dedupedGet('/api/time-management/categories'),
          dedupedGet('/api/user-events'),
        ])

        const modesPayload = modesRes.data as { modes?: unknown } | undefined
        const modes = Array.isArray(modesPayload?.modes) ? modesPayload.modes : []
        setTimeManagementModes(
          modes
            .filter((mode: { id?: unknown; name?: unknown; main_color?: unknown; slot_minutes?: unknown }) => {
              return typeof mode.id === 'string' && typeof mode.name === 'string'
            })
            .map((mode: { id: string; name: string; main_color?: string; slot_minutes?: number }) => ({
              id: mode.id,
              name: mode.name,
              main_color: typeof mode.main_color === 'string' && mode.main_color.trim().length > 0 ? mode.main_color : '#2563eb',
              slot_minutes: mode.slot_minutes === 15 || mode.slot_minutes === 30 || mode.slot_minutes === 60 ? mode.slot_minutes : 30,
            }))
        )

        const categoriesPayload = categoriesRes.data as { categories?: unknown } | undefined
        const categories = Array.isArray(categoriesPayload?.categories) ? categoriesPayload.categories : []
        setTimeManagementCategories(
          categories
            .filter((category: { id?: unknown; label?: unknown; color?: unknown; font_color?: unknown }) => {
              return (
                typeof category.id === 'string'
                && typeof category.label === 'string'
                && typeof category.color === 'string'
                && typeof category.font_color === 'string'
              )
            })
            .map((category: { id: string; label: string; color: string; font_color: string }) => ({
              id: category.id,
              label: category.label,
              color: category.color,
              font_color: category.font_color,
            }))
        )

        const eventsPayload = eventsRes.data as { events?: unknown } | undefined
        const events = Array.isArray(eventsPayload?.events) ? eventsPayload.events : []
        setTimeManagementEvents(
          events.filter((event: { source_type?: unknown; source_id?: unknown }) => {
            return event.source_type === 'manual' && typeof event.source_id === 'string'
          })
        )
      } catch (err) {
        if (isRateLimitedError(err)) {
          // Avoid immediate re-bursts from focus/visibility/storage listeners.
          timeManagementRateLimitedUntilRef.current = Date.now() + 30_000
        }

        console.error('Failed to fetch time-management sources:', err)
        setTimeManagementModes([])
        setTimeManagementCategories([])
        setTimeManagementEvents([])
      }
    })()

    timeManagementFetchInFlightRef.current = request
    await request
    timeManagementFetchInFlightRef.current = null
  }, [isAuthenticated])

  useEffect(() => {
    fetchTimeManagementSources()
  }, [fetchTimeManagementSources])

  useEffect(() => {
    if (!isAuthenticated || typeof window === 'undefined') return

    const scheduleRefresh = () => {
      if (timeManagementRefreshTimerRef.current !== null) {
        window.clearTimeout(timeManagementRefreshTimerRef.current)
      }
      timeManagementRefreshTimerRef.current = window.setTimeout(() => {
        timeManagementRefreshTimerRef.current = null
        void fetchTimeManagementSources()
      }, 180)
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key !== TIME_MANAGEMENT_SYNC_STORAGE_KEY || !event.newValue) return
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
      channel.onmessage = () => {
        scheduleRefresh()
      }
    }

    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', onWindowFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      if (timeManagementRefreshTimerRef.current !== null) {
        window.clearTimeout(timeManagementRefreshTimerRef.current)
        timeManagementRefreshTimerRef.current = null
      }
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', onWindowFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      channel?.close()
    }
  }, [fetchTimeManagementSources, isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated || typeof window === 'undefined') return

    const availableIds = new Set<string>()
    for (const source of calendarSources) {
      if (source.is_active && (source.source_type === 'google_oauth' || source.source_type === 'google_public_url')) {
        availableIds.add(source.id)
      }
    }
    for (const modeId of secretSwarmModeIds) {
      availableIds.add(modeId)
    }

    const stored = localStorage.getItem('calendarSourceSelections')
    if (stored) {
      try {
        const rememberedIds = JSON.parse(stored) as string[]
        const next = rememberedIds.filter(id => availableIds.has(id))
        setCheckedSourceIds(new Set(next))
      } catch {
        setCheckedSourceIds(new Set())
      }
      return
    }

    if (secretSwarmModeIds.length > 0) {
      const next = new Set(secretSwarmModeIds)
      setCheckedSourceIds(next)
      localStorage.setItem('calendarSourceSelections', JSON.stringify([...next]))
      return
    }

    setCheckedSourceIds(new Set())
  }, [calendarSources, isAuthenticated, secretSwarmModeIds])

  // Fetch busy times from Google Calendar for the visible week
  const fetchBusyTimes = useCallback(async (sourceIds: string[]) => {
    if (sourceIds.length === 0) {
      setBusyBlocks([])
      return
    }
    setBusyLoading(true)
    try {
      // Visible week range
      const timeMin = new Date(format(currentWeekStart, 'yyyy-MM-dd') + 'T00:00:00Z').toISOString()
      const timeMax = new Date(format(addDays(currentWeekStart, 7), 'yyyy-MM-dd') + 'T00:00:00Z').toISOString()
      const res = await apiClient.post('/api/calendar-sources/busy', {
        sourceIds,
        timeMin,
        timeMax,
        includeSummaries: true,
      })
      setBusyBlocks(res.data.busyBlocks || [])
      // Merge errors: keep errors for sources not in this request, update for those that were
      const newErrors = res.data.sourceErrors || []
      setSourceErrors(prev => {
        const keptErrors = prev.filter(e => !sourceIds.includes(e.sourceId))
        return [...keptErrors, ...newErrors]
      })
    } catch (err) {
      console.error('Failed to fetch busy times:', err)
    } finally {
      setBusyLoading(false)
    }
  }, [currentWeekStart])

  useEffect(() => {
    // Only fetch busy times when viewing an existing calendar (visitor mode),
    // not on the creation/preparation page
    if (roomHash && activeGoogleSourceIds.length > 0) {
      void fetchBusyTimes(activeGoogleSourceIds)
    } else {
      setBusyBlocks([])
      // Don't clear sourceErrors  — sync status persists regardless of selection
    }
  }, [activeGoogleSourceIds, fetchBusyTimes, roomHash])

  // Helper: check if a cell overlaps with any busy block
  const isCellBusy = useCallback((cellId: string): boolean => {
    if (combinedBusyBlocks.length === 0) return false
    const [dateStr, timeStr] = cellId.split('_')
    const cellStart = new Date(`${dateStr}T${timeStr}:00Z`).getTime()
    const cellEnd = cellStart + timeInterval * 60 * 1000
    return combinedBusyBlocks.some(block => {
      const busyStart = new Date(block.start).getTime()
      const busyEnd = new Date(block.end).getTime()
      return cellStart < busyEnd && cellEnd > busyStart
    })
  }, [combinedBusyBlocks, timeInterval])

  // Helper: get busy block summaries for a cell
  const getCellBusyEntries = useCallback((cellId: string): Array<{ summary: string; categoryIds: string[]; color: string }> => {
    if (combinedBusyBlocks.length === 0) return []
    const [dateStr, timeStr] = cellId.split('_')
    const cellStart = new Date(`${dateStr}T${timeStr}:00Z`).getTime()
    const cellEnd = cellStart + timeInterval * 60 * 1000
    const busyEntries: Array<{ summary: string; categoryIds: string[]; color: string }> = []
    for (const block of combinedBusyBlocks) {
      const busyStart = new Date(block.start).getTime()
      const busyEnd = new Date(block.end).getTime()
      if (cellStart < busyEnd && cellEnd > busyStart) {
        busyEntries.push({
          summary: block.summary || 'Busy',
          categoryIds: Array.isArray(block.categoryIds) ? block.categoryIds : [],
          color: block.color,
        })
      }
    }

    const deduped = new Map<string, { summary: string; categoryIds: string[]; color: string }>()
    for (const entry of busyEntries) {
      const categoryKey = [...entry.categoryIds].sort().join(',')
      const key = `${entry.summary}::${categoryKey}::${entry.color}`
      if (!deduped.has(key)) {
        deduped.set(key, entry)
      }
    }

    return [...deduped.values()]
  }, [combinedBusyBlocks, timeInterval])

  const activeBusyHoverCell = pinnedHoverCell || hoveredCell
  const activeBusyEntries = useMemo(
    () => activeBusyHoverCell ? getCellBusyEntries(activeBusyHoverCell) : [],
    [activeBusyHoverCell, getCellBusyEntries]
  )

  // Derived: which checked sources support export (Google OAuth only)
  const checkedExportableSources = calendarSources.filter(
    s => checkedSourceIds.has(s.id) && s.source_type === 'google_oauth'
  )
  const hasExportTargets = checkedExportableSources.length > 0

  // Check if there's pending calendar data to restore (only relevant when authenticated)
  const hasPendingRestore = !hash && isAuthenticated && !!localStorage.getItem('pendingCalendarData')

  const setRangeWithSundayDefault = useCallback((startDate: Date, endDate: Date) => {
    const normalizedStart = startDate <= endDate ? startDate : endDate
    const normalizedEnd = startDate <= endDate ? endDate : startDate
    setCustomStartDate(format(normalizedStart, 'yyyy-MM-dd'))
    setCustomEndDate(format(normalizedEnd, 'yyyy-MM-dd'))

    const sundays: string[] = []
    const cursor = new Date(normalizedStart)
    while (cursor <= normalizedEnd) {
      if (getDay(cursor) === 0) {
        sundays.push(format(cursor, 'yyyy-MM-dd'))
      }
      cursor.setDate(cursor.getDate() + 1)
    }

    if (sundays.length === 0) return
    setSkippedDays(prev => {
      const next = new Set(prev)
      sundays.forEach((date) => next.add(date))
      return next
    })
  }, [])

  // Initialize date range when switching to admin mode
  useEffect(() => {
    if (hasPendingRestore) return // Skip  — dates will be restored from pending data
    if (viewMode === 'admin' && !customStartDate && !customEndDate) {
      const today = new Date()
      today.setHours(0, 0, 0, 0) // Normalize to start of day
      const dayOfWeek = getDay(today) // 0 = Sunday, 1 = Monday, etc.
      
      let fromDate: Date
      let toDate: Date
      
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        // Weekend: show the upcoming Monday–Saturday
        const daysUntilMonday = dayOfWeek === 0 ? 1 : 2
        fromDate = addDays(today, daysUntilMonday)
        toDate = addDays(fromDate, 5) // Saturday
      } else {
        // Weekday: start from today, end on Saturday of the current week
        fromDate = today
        const monday = startOfWeek(today, { weekStartsOn: 1 })
        toDate = addDays(monday, 5) // Saturday
      }
      
      setRangeWithSundayDefault(fromDate, toDate)

      // Navigate the calendar view to the week containing the first event
      setCurrentWeekStart(startOfWeek(fromDate, { weekStartsOn: 1 }))
    }
  }, [viewMode, customStartDate, customEndDate, hasPendingRestore, setRangeWithSundayDefault])

  useEffect(() => {
    if (!hideDateNumbers) return
    setIsStartDateLocked(false)
    setIsEndDateLocked(false)
  }, [hideDateNumbers])

  // Restore pending calendar data from localStorage after login
  // Then apply user's saved calendar settings (Google accounts only) on top
  useEffect(() => {
    if (!hash && isAuthenticated) {
      const saved = localStorage.getItem('pendingCalendarData')
      if (saved) {
        try {
          const data = JSON.parse(saved)
          if (data.eventName) setEventName(data.eventName)
          if (data.customStartDate) setCustomStartDate(data.customStartDate)
          if (data.customEndDate) setCustomEndDate(data.customEndDate)
          if (data.calendarVisibility) setCalendarVisibility(data.calendarVisibility)
          if (data.timeInterval) setTimeInterval(data.timeInterval)
          if (data.startHour !== undefined) setStartHour(data.startHour)
          if (data.endHour !== undefined) setEndHour(data.endHour)
          if (data.skippedDays) setSkippedDays(new Set(data.skippedDays))
        } catch (e) {
          console.warn('Failed to restore pending calendar data:', e)
        }
        localStorage.removeItem('pendingCalendarData')
      }

      // For Google accounts, apply saved calendar settings (start/end hour, time interval)
      // These override both defaults and any pending data values
      // Falls back to Settings page defaults if user hasn't saved settings yet
      if (!isTraveler) {
        const DEFAULT_CALENDAR_SETTINGS = { startHour: 8, endHour: 18, defaultTimeInterval: 30 }
        const userSettings = localStorage.getItem('userCalendarSettings')
        let settings = DEFAULT_CALENDAR_SETTINGS
        if (userSettings) {
          try {
            settings = { ...DEFAULT_CALENDAR_SETTINGS, ...JSON.parse(userSettings) }
          } catch (e) {
            console.warn('Failed to load user calendar settings:', e)
          }
        }
        setStartHour(settings.startHour)
        setEndHour(settings.endHour)
        setTimeInterval(settings.defaultTimeInterval as 15 | 30 | 60)
      }
    }
  }, [hash, isAuthenticated, isTraveler])

  // Check AI assistant availability (once, on mount  — works for both travelers and verified)
  useEffect(() => {
    if (!isAuthenticated) {
      setAiAvailable(false)
      return
    }
    const checkAi = async () => {
      try {
        const { data } = await apiClient.get('/api/ai-chat/status')
        setAiAvailable(data.available)
      } catch {
        setAiAvailable(false)
      }
    }
    checkAi()
  }, [isAuthenticated])

  // Auto-dismiss AI notifications after 12 seconds
  useEffect(() => {
    if (!aiNotifications) return
    const hasAny = aiNotifications.nameVisibility || aiNotifications.availabilityRange || aiNotifications.calendarParams || aiNotifications.general
    if (!hasAny) return
    const timer = setTimeout(() => setAiNotifications(null), 12000)
    return () => clearTimeout(timer)
  }, [aiNotifications])

  const generateTimeSlots = useCallback(() => {
    const slots = []
    const intervalMinutes = timeInterval

    for (let hour = startHour; hour < endHour; hour++) {
      for (let minute = 0; minute < 60; minute += intervalMinutes) {
        slots.push(`${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`)
      }
    }

    return slots
  }, [timeInterval, startHour, endHour])

  // Handle AI operational assistant submission (called by global AI panel via context)
  const handleAiSubmit = useCallback(async (message: string): Promise<{ message: string; action?: string; systemPrompt?: string }> => {
    const trimmed = message.trim()
    if (!trimmed) return { message: 'Please enter a message.' }

    setAiSending(true)
    setAiError('')
    setAiNotifications(null)

    try {
      // ā”€ā”€ Existing calendar mode: AI helps manage availability ā”€ā”€
      if (roomHash) {
        // Build all valid cell IDs for this calendar
        const allCellIds: string[] = []
        const slots = generateTimeSlots()
        // Iterate over all days in the calendar range
        if (customStartDate && customEndDate) {
          const rangeStart = parse(customStartDate, 'yyyy-MM-dd', new Date())
          const rangeEnd = parse(customEndDate, 'yyyy-MM-dd', new Date())
          if (isValid(rangeStart) && isValid(rangeEnd)) {
            const totalDays = differenceInDays(rangeEnd, rangeStart) + 1
            for (let d = 0; d < totalDays; d++) {
              const day = addDays(rangeStart, d)
              const dateStr = format(day, 'yyyy-MM-dd')
              if (skippedDays.has(dateStr)) continue
              for (const time of slots) {
                allCellIds.push(`${dateStr}_${time}`)
              }
            }
          }
        }

        // Determine busy cell IDs from Google Calendar
        // Fetch busy times for the FULL calendar range (not just visible week)
        // so excludeBusy covers all weeks in multi-week calendars
        let fullRangeBusyBlocks = [...combinedBusyBlocks]
        const activeBusyIds = activeGoogleSourceIds
        if (activeBusyIds.length > 0 && customStartDate && customEndDate) {
          try {
            const fullTimeMin = new Date(customStartDate + 'T00:00:00Z').toISOString()
            const fullTimeMax = new Date(
              format(addDays(parse(customEndDate, 'yyyy-MM-dd', new Date()), 1), 'yyyy-MM-dd') + 'T00:00:00Z'
            ).toISOString()
            const busyRes = await apiClient.post('/api/calendar-sources/busy', {
              sourceIds: activeBusyIds,
              timeMin: fullTimeMin,
              timeMax: fullTimeMax,
              includeSummaries: true,
            })
            const googleBusyBlocks = busyRes.data.busyBlocks || []
            const secretSwarmBusyBlocks = getTimeManagementEventBusyBlocks(
              timeManagementEvents,
              new Set(activeSecretSwarmModeIds),
              parse(customStartDate, 'yyyy-MM-dd', new Date()),
              modeColors,
            )
            fullRangeBusyBlocks = [...googleBusyBlocks, ...secretSwarmBusyBlocks]
          } catch {
            // Fall back to currently loaded combined busy blocks (visible-week only)
            fullRangeBusyBlocks = [...combinedBusyBlocks]
          }
        }

        const busyCellIds: string[] = []
        if (fullRangeBusyBlocks.length > 0) {
          for (const cellId of allCellIds) {
            const [dateStr, timeStr] = cellId.split('_')
            const cellStart = new Date(`${dateStr}T${timeStr}:00Z`).getTime()
            const cellEnd = cellStart + timeInterval * 60 * 1000
            const isBusy = fullRangeBusyBlocks.some((block: { start: string; end: string }) => {
              const busyStart = new Date(block.start).getTime()
              const busyEnd = new Date(block.end).getTime()
              return cellStart < busyEnd && cellEnd > busyStart
            })
            if (isBusy) busyCellIds.push(cellId)
          }
        }

        // Build a Set for quick lookup
        const busyCellSet = new Set(busyCellIds)

        // Determine participant name: use username field, or fall back to authenticated user's display name
        const participantName = username.trim() || user?.displayName || user?.travelerName || ''

        const { data } = await apiClient.post('/api/ai-chat/calendar/availability', {
          message: trimmed,
          allCellIds,
          busyCellIds,
          currentSelectionIds: Array.from(currentSelection),
          participantName,
          preferredModel: user?.themePreferences?.aiSettings?.preferredModel || 'openai',
          calendarHash: roomHash,
          canEditCalendar: hasEditPermission || isCreator,
          existingMeetings: confirmedMeetings.map(m => ({
            title: resolveMeetingTitle({ title: m.title, calendarTitle: eventName || calendarTitle || 'Meeting' }),
            cellId: m.cellId,
            duration: m.duration,
          })),
          hasIntegratedCalendar: hasExportTargets,
          integratedCalendarSourceIds: checkedExportableSources.map(s => s.id),
        })

        // Apply the AI's availability action using filter-based approach
        if (data.action === 'set_availability' && data.filter) {
          const filter = data.filter as {
            base?: string
            excludeBusy?: boolean
            includeDates?: string[]
            excludeDates?: string[]
            includeTimeRange?: { start: string; end: string } | null
            excludeTimeRange?: { start: string; end: string } | null
            includeDaysOfWeek?: number[]
            excludeDaysOfWeek?: number[]
          }

          // Step 1: Start with the base set
          let resultCells: string[]
          if (filter.base === 'all') {
            resultCells = [...allCellIds]
          } else if (filter.base === 'current') {
            resultCells = Array.from(currentSelection)
          } else {
            resultCells = []
          }

          // Step 2: Apply includeDates filter (keep only cells on these dates)
          if (filter.includeDates && filter.includeDates.length > 0) {
            const includeDateSet = new Set(filter.includeDates)
            resultCells = resultCells.filter(cid => {
              const [dateStr] = cid.split('_')
              return includeDateSet.has(dateStr)
            })
          }

          // Step 3: Apply excludeDates filter
          if (filter.excludeDates && filter.excludeDates.length > 0) {
            const excludeDateSet = new Set(filter.excludeDates)
            resultCells = resultCells.filter(cid => {
              const [dateStr] = cid.split('_')
              return !excludeDateSet.has(dateStr)
            })
          }

          // Step 4: Apply includeDaysOfWeek filter
          if (filter.includeDaysOfWeek && filter.includeDaysOfWeek.length > 0) {
            const daySet = new Set(filter.includeDaysOfWeek)
            resultCells = resultCells.filter(cid => {
              const [dateStr] = cid.split('_')
              const dayOfWeek = new Date(dateStr + 'T00:00:00').getDay()
              return daySet.has(dayOfWeek)
            })
          }

          // Step 5: Apply excludeDaysOfWeek filter
          if (filter.excludeDaysOfWeek && filter.excludeDaysOfWeek.length > 0) {
            const daySet = new Set(filter.excludeDaysOfWeek)
            resultCells = resultCells.filter(cid => {
              const [dateStr] = cid.split('_')
              const dayOfWeek = new Date(dateStr + 'T00:00:00').getDay()
              return !daySet.has(dayOfWeek)
            })
          }

          // Step 6: Apply includeTimeRange filter
          if (filter.includeTimeRange) {
            const { start, end } = filter.includeTimeRange
            resultCells = resultCells.filter(cid => {
              const [, timeStr] = cid.split('_')
              return timeStr >= start && timeStr < end
            })
          }

          // Step 7: Apply excludeTimeRange filter
          if (filter.excludeTimeRange) {
            const { start, end } = filter.excludeTimeRange
            resultCells = resultCells.filter(cid => {
              const [, timeStr] = cid.split('_')
              return !(timeStr >= start && timeStr < end)
            })
          }

          // Step 8: Apply excludeBusy filter
          if (filter.excludeBusy) {
            resultCells = resultCells.filter(cid => !busyCellSet.has(cid))
          }

          // Auto-fill the username if empty
          if (!username.trim() && participantName) {
            setUsername(participantName)
          }
          setCurrentSelection(new Set(resultCells))
        } else if (data.action === 'clear_availability') {
          setCurrentSelection(new Set())
        } else if (data.action === 'create_meeting' && data.meetingCreated) {
          // AI created a meeting — add it to confirmedMeetings
          const mc = data.meetingCreated as {
            id: string
            title: string
            description: string
            cellId: string
            durationMinutes: number
            meetingLink: string
          }
          setConfirmedMeetings(prev => [...prev, {
            id: mc.id,
            cellId: mc.cellId,
            meetingLink: mc.meetingLink || '',
            description: mc.description || '',
            duration: mc.durationMinutes || 60,
            title: mc.title,
            timeSlots: [mc.cellId],
          }])
        } else if (data.action === 'export_meeting' && data.exportMeeting) {
          // AI wants to export an existing meeting to integrated calendar
          const em = data.exportMeeting as { title: string; cellId: string; duration: number }
          const meetingToExport = confirmedMeetings.find(m =>
            (m.title || m.description || '') === em.title || m.cellId === em.cellId
          )
          if (meetingToExport && checkedExportableSources.length > 0) {
            try {
              const targetSourceIds = checkedExportableSources.map(s => s.id)
              await apiClient.post('/api/calendar-sources/export', {
                calendarHash: roomHash,
                meetings: [{
                  cellId: meetingToExport.cellId,
                  meetingLink: meetingToExport.meetingLink,
                  description: meetingToExport.description,
                  duration: meetingToExport.duration,
                  title: resolveMeetingTitle({ title: meetingToExport.title, calendarTitle: eventName || calendarTitle || 'Meeting' }),
                  recurrenceRule: meetingToExport.recurrenceRule || null,
                }],
                targetSourceIds,
              })
              data.explanation = (data.explanation || '') + ' Successfully exported to Google Calendar!'
            } catch (exportErr) {
              console.error('AI export failed:', exportErr)
              data.explanation = (data.explanation || '') + ' (Export failed: ' + ((exportErr as { response?: { data?: { error?: string } } }).response?.data?.error || 'unknown error') + ')'
            }
          }
        }

        // Store the conversation for the AI panel
        const responseText = data.explanation || 'Action completed.'

        // Show AI explanation
        if (data.explanation) {
          setAiNotifications({ general: data.explanation })
        }

        return { message: responseText, action: data.action, systemPrompt: data.systemPrompt }
      }

      // ā”€ā”€ Creation mode: AI helps configure calendar parameters ā”€ā”€
      const currentConfig = {
        startDate: customStartDate,
        endDate: customEndDate,
        skipDays: Array.from(skippedDays),
        startHour,
        endHour,
        timezone: selectedTimezone,
        eventName,
        visibility: calendarVisibility,
        hideDateNumbers,
      }

      const { data } = await apiClient.post('/api/ai-chat/calendar', {
        message: trimmed,
        currentConfig,
        preferredModel: user?.themePreferences?.aiSettings?.preferredModel || 'openai',
      })

      // Apply changes returned by the AI
      const changes = data.changes || {}
      if (changes.startDate && typeof changes.startDate === 'string') setCustomStartDate(changes.startDate)
      if (changes.endDate && typeof changes.endDate === 'string') setCustomEndDate(changes.endDate)
      if (changes.startHour !== undefined && typeof changes.startHour === 'number') {
        setStartHour(Math.max(0, Math.min(23, changes.startHour)))
      }
      if (changes.endHour !== undefined && typeof changes.endHour === 'number') {
        setEndHour(Math.max(1, Math.min(24, changes.endHour)))
      }
      if (changes.timezone && typeof changes.timezone === 'string') {
        tzState.setPrimary(changes.timezone)
      }
      if (changes.eventName !== undefined && typeof changes.eventName === 'string') setEventName(changes.eventName)
      if (changes.visibility && (changes.visibility === 'public' || changes.visibility === 'unlisted')) {
        setCalendarVisibility(changes.visibility)
      }
      if (changes.hideDateNumbers !== undefined && typeof changes.hideDateNumbers === 'boolean') {
        setHideDateNumbers(changes.hideDateNumbers)
      }
      if (Array.isArray(changes.skipDays)) {
        setSkippedDays(new Set(changes.skipDays as string[]))
      }

      // Build group notifications from API response
      const groupReasons = data.groupReasons || {}
      const hasGroupReasons = Object.keys(groupReasons).length > 0
      const notifications: typeof aiNotifications = {}

      if (hasGroupReasons) {
        if (groupReasons.nameVisibility) notifications.nameVisibility = groupReasons.nameVisibility
        if (groupReasons.availabilityRange) notifications.availabilityRange = groupReasons.availabilityRange
        if (groupReasons.calendarParams) notifications.calendarParams = groupReasons.calendarParams
      } else if (data.explanation) {
        // Fallback: show explanation as a general notification
        notifications.general = data.explanation
      }

      if (Object.keys(notifications).length > 0) {
        setAiNotifications(notifications)
      }

      const responseText = data.explanation || Object.values(data.groupReasons || {}).join(' ') || 'Configuration updated.'
      return { message: responseText, action: 'configure', systemPrompt: data.systemPrompt }
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message || 'Failed to get AI response.'
      setAiError(msg)
      throw err
    } finally {
      setAiSending(false)
    }
    }, [roomHash, customStartDate, customEndDate, skippedDays, timeInterval, startHour, endHour,
      currentSelection, combinedBusyBlocks, username, user, calendarVisibility, selectedTimezone, eventName, calendarTitle, hideDateNumbers,
      hasExportTargets, checkedExportableSources, confirmedMeetings,
      generateTimeSlots, hasEditPermission, isCreator, tzState, activeGoogleSourceIds,
      activeSecretSwarmModeIds, modeColors, timeManagementEvents])

  // Keep ref to latest submit handler so the useEffect below doesn't depend on it
  handleAiSubmitRef.current = handleAiSubmit

  // Register AI page context so the global AI panel uses calendar-specific logic
  useEffect(() => {
    const isRoomMode = !!roomHash
    setPageContext({
      pageName: isRoomMode ? 'Availability Assistant' : 'Calendar Assistant',
      suggestions: isRoomMode
        ? [
            'Mark me available everywhere except where I\'m busy',
            'Only mark mornings (9 AM – 12 PM)',
            'Remove weekends from my availability',
            'Clear my availability',
          ]
        : [
            'Set hours to business hours',
            'Call it Team Standup and make it public',
            'Skip weekends next week',
            'Make it a generic week',
          ],
      placeholder: isRoomMode
        ? 'e.g. "mark me available everywhere except where I\'m busy"'
        : 'Share context  -- I\'ll help draft your Coordination Calendar',
      onSubmit: (msg: string) => handleAiSubmitRef.current!(msg),
    })
    return () => setPageContext(null)
  }, [roomHash, setPageContext])

  const timeSlots = generateTimeSlots()
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i))

  // On mobile, hide non-selectable days entirely (skipped + out-of-range) to save screen space
  const mobileEligibleDays = isMobile
    ? weekDays.filter(d => {
        const ds = format(d, 'yyyy-MM-dd')
        if (skippedDays.has(ds)) return false
        // Weekly availability mode: all days in range
        if (hideDateNumbers) return true
        if (!customStartDate || !customEndDate) return true
        const sd = parse(customStartDate, 'yyyy-MM-dd', new Date())
        const ed = parse(customEndDate, 'yyyy-MM-dd', new Date())
        if (!isValid(sd) || !isValid(ed)) return true
        return isWithinInterval(d, { start: sd, end: ed })
      })
    : weekDays
  const mobileMaxOffset = Math.max(0, mobileEligibleDays.length - MOBILE_DAYS_COUNT)
  // On mobile, show only MOBILE_DAYS_COUNT days; on desktop show all 7
  const visibleDays = isMobile
    ? mobileEligibleDays.slice(mobileDayOffset, mobileDayOffset + MOBILE_DAYS_COUNT)
    : weekDays
  // Time column width: wider on desktop, and wider in landscape mobile mode
  const timeColWidth = isMobile ? (isLandscape ? '50px' : '40px') : '60px'
  const _dayCount = isMobile ? MOBILE_DAYS_COUNT : 7
  // Timezone columns: additional timezones on the left, primary is always the main time column (closest to days)
  // Order: [additional_N ... additional_1] [primary time col] [day cols]
  const tzColWidth = isMobile ? '48px' : '62px'
  const additionalTzIanas = tzState.additional

  // Detect DST transitions within visible days for all active timezones
  const allActiveIanas = [tzState.primary, ...additionalTzIanas]
  const dstTransitions = detectDstTransitions(allActiveIanas, visibleDays)

  // Build timezone column definitions (no DST split -- DST columns go inline with days)
  const buildTzColumns = () => {
    let colDef = ''
    const colList: Array<{ iana: string; role: 'single' }> = []

    for (const iana of additionalTzIanas) {
      colDef += `${tzColWidth} `
      colList.push({ iana, role: 'single' })
    }

    colDef += `${timeColWidth} `
    colList.push({ iana: tzState.primary, role: 'single' })

    return { colDef, colList }
  }
  const { colDef: tzColsDef, colList: tzColumns } = buildTzColumns()

  // Build day slots: interleave DST indicator columns before the transition day
  type DaySlot =
    | { type: 'day'; day: Date; dayIdx: number }
    | { type: 'dst'; transition: DstTransition }
  const buildDaySlots = (): DaySlot[] => {
    const slots: DaySlot[] = []
    for (let i = 0; i < visibleDays.length; i++) {
      // Insert a DST column before the day where each transition starts
      const transitionsHere = dstTransitions.filter((t) => t.transitionDayIndex === i)
      for (const t of transitionsHere) {
        slots.push({ type: 'dst', transition: t })
      }
      slots.push({ type: 'day', day: visibleDays[i], dayIdx: i })
    }
    return slots
  }
  const daySlots = buildDaySlots()

  // Grid template: tz cols + day/DST slots (DST slots get fixed width, day slots 1fr)
  const daySlotsDef = daySlots.map((s) => (s.type === 'dst' ? tzColWidth : '1fr')).join(' ')
  const gridStyle = { gridTemplateColumns: `${tzColsDef}${daySlotsDef}` }
  
  // Check if a date is within the selected range
  const isDateInRange = (date: Date) => {
    // Weekly availability: all days are always in range
    if (hideDateNumbers) return true

    if (!customStartDate || !customEndDate) return false
    
    const startDate = parse(customStartDate, 'yyyy-MM-dd', new Date())
    const endDate = parse(customEndDate, 'yyyy-MM-dd', new Date())
    
    if (!isValid(startDate) || !isValid(endDate)) return false
    
    return isWithinInterval(date, { start: startDate, end: endDate })
  }

  const getSundaysInRange = (startDate: Date, endDate: Date): string[] => {
    if (!isValid(startDate) || !isValid(endDate) || startDate > endDate) return []
    const sundays: string[] = []
    const cursor = new Date(startDate)
    while (cursor <= endDate) {
      if (getDay(cursor) === 0) {
        sundays.push(format(cursor, 'yyyy-MM-dd'))
      }
      cursor.setDate(cursor.getDate() + 1)
    }
    return sundays
  }

  const addDefaultSundaySkips = (startDate: Date, endDate: Date) => {
    const sundays = getSundaysInRange(startDate, endDate)
    if (sundays.length === 0) return
    setSkippedDays(prev => {
      const next = new Set(prev)
      sundays.forEach((date) => next.add(date))
      return next
    })
  }

  const applyWeekShiftToRange = (direction: 'prev' | 'next'): boolean => {
    if (roomHash || hideDateNumbers || !customStartDate || !customEndDate) return false
    const startDate = parse(customStartDate, 'yyyy-MM-dd', new Date())
    const endDate = parse(customEndDate, 'yyyy-MM-dd', new Date())
    if (!isValid(startDate) || !isValid(endDate)) return false

    const shiftByWeeks = direction === 'next' ? 1 : -1

    if (!isStartDateLocked) {
      const shiftedStart = addWeeks(startDate, shiftByWeeks)
      const shiftedEnd = addWeeks(endDate, shiftByWeeks)
      if (shiftedStart < MIN_DATE || shiftedEnd > MAX_DATE) return false
      setRangeWithSundayDefault(shiftedStart, shiftedEnd)
      return true
    }

    if (!isEndDateLocked) {
      const shiftedEnd = addWeeks(endDate, shiftByWeeks)
      const adjustedEnd = shiftedEnd < startDate ? startDate : shiftedEnd
      if (adjustedEnd > MAX_DATE || adjustedEnd < MIN_DATE) return false
      setRangeWithSundayDefault(startDate, adjustedEnd)
      return true
    }

    return false
  }

  const handleDateMarkerSelect = (day: Date) => {
    if (hideDateNumbers) return
    const dayStr = format(day, 'yyyy-MM-dd')
    const dayDate = parse(dayStr, 'yyyy-MM-dd', new Date())
    if (!isValid(dayDate)) return

    if (!isStartDateLocked) {
      setCustomStartDate(dayStr)
      if (!customEndDate) {
        setCustomEndDate(dayStr)
      } else {
        const endDate = parse(customEndDate, 'yyyy-MM-dd', new Date())
        if (!isValid(endDate) || endDate < dayDate) {
          setCustomEndDate(dayStr)
        }
      }
      addDefaultSundaySkips(dayDate, dayDate)
      return
    }

    if (!isEndDateLocked) {
      if (customStartDate) {
        const startDate = parse(customStartDate, 'yyyy-MM-dd', new Date())
        const effectiveEnd = isValid(startDate) && dayDate < startDate ? startDate : dayDate
        setCustomEndDate(format(effectiveEnd, 'yyyy-MM-dd'))
        addDefaultSundaySkips(startDate, effectiveEnd)
      } else {
        setCustomEndDate(dayStr)
        addDefaultSundaySkips(dayDate, dayDate)
      }
    }
  }

  const toggleSkipDay = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd')
    setSkippedDays(prev => {
      const newSet = new Set(prev)
      if (newSet.has(dateStr)) {
        newSet.delete(dateStr)
      } else {
        newSet.add(dateStr)
      }
      return newSet
    })
  }

  const isDaySkipped = (date: Date): boolean => {
    return skippedDays.has(format(date, 'yyyy-MM-dd'))
  }

  // Find the next N selectable dates (in range, not skipped, today or later)
  const findNextAvailableDates = (count = 3): Date[] => {
    if (hideDateNumbers) return []
    if (!customStartDate || !customEndDate) return []
    const start = parse(customStartDate, 'yyyy-MM-dd', new Date())
    const end = parse(customEndDate, 'yyyy-MM-dd', new Date())
    if (!isValid(start) || !isValid(end)) return []
    const todayD = new Date()
    todayD.setHours(0, 0, 0, 0)
    const startTime = Math.max(start.getTime(), todayD.getTime())
    const cursor = new Date(startTime)
    const out: Date[] = []
    while (cursor.getTime() <= end.getTime() && out.length < count) {
      if (!isDaySkipped(cursor)) out.push(new Date(cursor))
      cursor.setDate(cursor.getDate() + 1)
    }
    return out
  }

  // Show a fading popup when user clicks a non-selectable cell (desktop only)
  const handleNonSelectableClick = (day: Date, e: React.MouseEvent) => {
    if (isMobile) return
    if (!roomHash) return
    const inRange = isDateInRange(day)
    const isSkipped = isDaySkipped(day)
    if (inRange && !isSkipped) return
    const nextDates = findNextAvailableDates(3)
    let message: string
    if (nextDates.length === 0) {
      message = isSkipped
        ? 'This day is marked unavailable, and no other dates are open for booking.'
        : 'This date is outside the booking window.'
    } else {
      const list = nextDates.map(d => format(d, 'EEE d MMM')).join(', ')
      message = isSkipped
        ? `This day is unavailable. Try: ${list}`
        : `This date is outside the booking window. Try: ${list}`
    }
    setNotSelectablePopup({
      x: e.clientX,
      y: e.clientY,
      message,
      highlightDates: new Set(nextDates.map(d => format(d, 'yyyy-MM-dd'))),
      visible: true,
    })
  }

  // Cell selection helpers
  const getCellId = (date: Date, time: string): string => {
    return `${format(date, 'yyyy-MM-dd')}_${time}`
  }

  const parseCellId = (cellId: string): { date: string; time: string } => {
    const [date, time] = cellId.split('_')
    return { date, time }
  }

  const getCellsInRectangle = (startCell: string, endCell: string): Set<string> => {
    const start = parseCellId(startCell)
    const end = parseCellId(endCell)
    
    const cells = new Set<string>()
    
    // Get all dates between start and end
    const startDate = parse(start.date, 'yyyy-MM-dd', new Date())
    const endDate = parse(end.date, 'yyyy-MM-dd', new Date())
    
    // Get all times between start and end
    const allSlots = generateTimeSlots()
    const startTimeIdx = allSlots.indexOf(start.time)
    const endTimeIdx = allSlots.indexOf(end.time)
    
    const minTimeIdx = Math.min(startTimeIdx, endTimeIdx)
    const maxTimeIdx = Math.max(startTimeIdx, endTimeIdx)
    
    // Get date range
    const dates = []
    let currentDate = startDate <= endDate ? new Date(startDate) : new Date(endDate)
    const lastDate = startDate <= endDate ? endDate : startDate
    
    while (currentDate <= lastDate) {
      dates.push(new Date(currentDate))
      currentDate = addDays(currentDate, 1)
    }
    
    // Create cells for rectangle
    dates.forEach(date => {
      for (let i = minTimeIdx; i <= maxTimeIdx; i++) {
        cells.add(getCellId(date, allSlots[i]))
      }
    })
    
    return cells
  }

  const handleCellPointerDown = (date: Date, time: string) => {
    if (!roomHash) return // Only in visitor mode
    const cellId = getCellId(date, time)
    
    // If in meeting creation mode, handle differently
    if (isCreatingMeeting) {
      setIsDragging(true)
      setDragStart(cellId)
      setMeetingCreationSelection(new Set([cellId]))
      // Update the meeting form with this cell
      setPendingMeetingCellId(cellId)
      // Set duration to one interval for a single-cell click (drag will override)
      setMeetingFormData(prev => ({ ...prev, duration: timeInterval }))
      return
    }
    
    setIsDragging(true)
    setDragStart(cellId)
    
    // Check if removing or adding
    const userHasSelection = currentSelection.has(cellId)
    setIsRemoving(userHasSelection)
    
    // Start with just this cell
    if (userHasSelection) {
      setCurrentSelection(prev => {
        const newSet = new Set(prev)
        newSet.delete(cellId)
        return newSet
      })
    } else {
      setCurrentSelection(prev => new Set(prev).add(cellId))
    }
  }

  // Get cells in a linear time sequence from start to end (supports cross-midnight for meetings)
  const getCellsInTimeSequence = (startCell: string, endCell: string): { cells: Set<string>; durationMinutes: number } => {
    const cells = new Set<string>()
    
    const [startDateStr, startTimeStr] = startCell.split('_')
    const [endDateStr, endTimeStr] = endCell.split('_')
    
    const startDate = parse(startDateStr, 'yyyy-MM-dd', new Date())
    const endDate = parse(endDateStr, 'yyyy-MM-dd', new Date())
    const [startHours, startMins] = startTimeStr.split(':').map(Number)
    const [endHours, endMins] = endTimeStr.split(':').map(Number)
    
    // Calculate total minutes from epoch for comparison
    const startTotalMinutes = startDate.getTime() / (1000 * 60) + startHours * 60 + startMins
    const endTotalMinutes = endDate.getTime() / (1000 * 60) + endHours * 60 + endMins
    
    // Determine direction (forward or backward in time)
    const isForward = endTotalMinutes >= startTotalMinutes
    const minTotal = Math.min(startTotalMinutes, endTotalMinutes)
    const maxTotal = Math.max(startTotalMinutes, endTotalMinutes)
    
    // Calculate duration
    const durationMinutes = (maxTotal - minTotal) + timeInterval
    
    // Generate cells from start to end
    let currentDate = isForward ? new Date(startDate) : new Date(endDate)
    let currentMinutes = isForward ? (startHours * 60 + startMins) : (endHours * 60 + endMins)
    let remaining = durationMinutes
    
    while (remaining > 0) {
      // Handle day overflow
      while (currentMinutes >= 24 * 60) {
        currentMinutes -= 24 * 60
        currentDate = addDays(currentDate, 1)
      }
      while (currentMinutes < 0) {
        currentMinutes += 24 * 60
        currentDate = addDays(currentDate, -1)
      }
      
      const hours = Math.floor(currentMinutes / 60)
      const mins = currentMinutes % 60
      const dateStr = format(currentDate, 'yyyy-MM-dd')
      const timeStr = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`
      cells.add(`${dateStr}_${timeStr}`)
      
      currentMinutes += timeInterval
      remaining -= timeInterval
    }
    
    return { cells, durationMinutes }
  }

  // Helper to check if a selection represents a single contiguous time range on one day
  // Returns start cellId and duration if valid, null otherwise
  const analyzeSingleDaySelection = (selection: Set<string>): { startCellId: string; durationMinutes: number } | null => {
    if (selection.size === 0) return null
    
    const cells = Array.from(selection)
    
    // Check all cells are on the same day
    const dates = new Set(cells.map(cell => cell.split('_')[0]))
    if (dates.size !== 1) return null
    
    const dateStr = Array.from(dates)[0]
    
    // Extract time parts and sort
    const times = cells.map(cell => {
      const timeStr = cell.split('_')[1]
      const [hours, mins] = timeStr.split(':').map(Number)
      return { timeStr, totalMinutes: hours * 60 + mins }
    }).sort((a, b) => a.totalMinutes - b.totalMinutes)
    
    // Check if contiguous (each slot separated by exactly timeInterval)
    for (let i = 1; i < times.length; i++) {
      if (times[i].totalMinutes - times[i - 1].totalMinutes !== timeInterval) {
        return null // Not contiguous
      }
    }
    
    // Return the start cell and total duration
    const startCellId = `${dateStr}_${times[0].timeStr}`
    const durationMinutes = times.length * timeInterval
    
    return { startCellId, durationMinutes }
  }

  const handleCellPointerEnter = (date: Date, time: string) => {
    if (!isDragging || !dragStart) return
    const cellId = getCellId(date, time)
    
    // If in meeting creation mode, use linear time sequence (supports cross-midnight)
    if (isCreatingMeeting) {
      const { cells, durationMinutes } = getCellsInTimeSequence(dragStart, cellId)
      setMeetingCreationSelection(cells)
      setMeetingFormData(prev => ({ ...prev, duration: durationMinutes }))
      return
    }
    
    // Get all cells in rectangle from dragStart to current cell
    const rectangleCells = getCellsInRectangle(dragStart, cellId)
    
    if (isRemoving) {
      // Remove all cells in rectangle
      setCurrentSelection(prev => {
        const newSet = new Set(prev)
        rectangleCells.forEach(cell => newSet.delete(cell))
        return newSet
      })
    } else {
      // Add all cells in rectangle
      setCurrentSelection(prev => {
        const newSet = new Set(prev)
        rectangleCells.forEach(cell => newSet.add(cell))
        return newSet
      })
    }
  }

  const handlePointerEnd = () => {
    // If in meeting creation mode and we have a pending cell, show the side panel
    if (isCreatingMeeting && pendingMeetingCellId && isDragging) {
      setShowMeetingSidePanel(true)
      setLeftPanelOrder(prev => prev.includes('meetingForm') ? prev : [...prev, 'meetingForm'])
    }
    setIsDragging(false)
    setDragStart(null)
  }

  const handleToggleFollow = async () => {
    if (!roomHash || followLoading) return
    setFollowLoading(true)
    try {
      if (isFollowing) {
        await apiClient.delete(`/api/calendar-subscriptions/${roomHash}`)
        setIsFollowing(false)
      } else {
        await apiClient.post('/api/calendar-subscriptions', { calendar_hash: roomHash })
        setIsFollowing(true)
      }
    } catch (err) {
      console.error('Failed to toggle follow:', err)
    } finally {
      setFollowLoading(false)
    }
  }

  const _ensureSubscribed = async () => {
    if (!roomHash || !isAuthenticated || isTraveler || isFollowing) return
    try {
      await apiClient.post('/api/calendar-subscriptions', { calendar_hash: roomHash })
      setIsFollowing(true)
    } catch {
      // Non-critical -- don't block the invite flow
    }
  }

  // Check if any weeks in the availability range have no marks from this user
  const checkForUnmarkedWeeks = (userSlots: Set<string>) => {
    if (!customStartDate || !customEndDate) {
      setUnmarkedWeeksWarning(null)
      return
    }
    const rangeStart = parse(customStartDate, 'yyyy-MM-dd', new Date())
    const rangeEnd = parse(customEndDate, 'yyyy-MM-dd', new Date())
    if (!isValid(rangeStart) || !isValid(rangeEnd)) {
      setUnmarkedWeeksWarning(null)
      return
    }
    // Only relevant for multi-week ranges
    const firstWeek = startOfWeek(rangeStart, { weekStartsOn: 1 })
    const lastWeek = startOfWeek(rangeEnd, { weekStartsOn: 1 })
    if (firstWeek.getTime() === lastWeek.getTime()) {
      setUnmarkedWeeksWarning(null)
      return
    }
    // Walk each week in the range and check if user has any slots there
    let hasEmptyBefore = false
    let hasEmptyAfter = false
    let weekCursor = firstWeek
    while (weekCursor <= lastWeek) {
      let weekHasSlot = false
      for (let d = 0; d < 7; d++) {
        const day = addDays(weekCursor, d)
        if (day < rangeStart || day > rangeEnd) continue
        const dateStr = format(day, 'yyyy-MM-dd')
        // Check if any slot in userSlots starts with this date
        for (const slot of userSlots) {
          if (slot.startsWith(dateStr + '_')) {
            weekHasSlot = true
            break
          }
        }
        if (weekHasSlot) break
      }
      if (!weekHasSlot) {
        if (weekCursor < currentWeekStart) hasEmptyBefore = true
        else if (weekCursor > currentWeekStart) hasEmptyAfter = true
      }
      weekCursor = addWeeks(weekCursor, 1)
    }
    if (hasEmptyBefore && hasEmptyAfter) setUnmarkedWeeksWarning({ direction: 'both' })
    else if (hasEmptyBefore) setUnmarkedWeeksWarning({ direction: 'prev' })
    else if (hasEmptyAfter) setUnmarkedWeeksWarning({ direction: 'next' })
    else setUnmarkedWeeksWarning(null)
  }

  // For weekly availability: convert a cellId from any week to the original
  // (customStartDate) week so stored data is always consistent
  const mapCellIdToOriginalWeek = (cellId: string): string => {
    if (!hideDateNumbers || !customStartDate) return cellId
    const [dateStr, timeStr] = cellId.split('_')
    const cellDate = parse(dateStr, 'yyyy-MM-dd', new Date())
    if (!isValid(cellDate)) return cellId
    const origStart = startOfWeek(parse(customStartDate, 'yyyy-MM-dd', new Date()), { weekStartsOn: 1 })
    const dayOfWeek = getDay(cellDate) // 0=Sun..6=Sat
    // Convert JS day (0=Sun) to Mon-based offset: Mon=0..Sun=6
    const monOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1
    const origDate = addDays(origStart, monOffset)
    return `${format(origDate, 'yyyy-MM-dd')}_${timeStr}`
  }

  // Parse HH:mm safely from a cellId time segment.
  const parseTimeParts = (timeStr: string): { hours: number; minutes: number } | null => {
    const [hours, minutes] = timeStr.split(':').map(Number)
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
    return { hours, minutes }
  }

  // If a user only has HH:00 for an hour and no finer entries for that same hour,
  // treat it as full-hour availability when viewing 30m/15m grids.
  const hasImplicitHourCoverageForDate = (
    selections: Set<string>,
    dateStr: string,
    hours: number,
    minutes: number
  ): boolean => {
    if (timeInterval >= 60 || minutes === 0) return false

    const hourPrefix = `${dateStr}_${hours.toString().padStart(2, '0')}:`
    const rootSlot = `${dateStr}_${hours.toString().padStart(2, '0')}:00`

    let hasRootSlot = false
    let hasSpecificSubHourSlot = false

    for (const savedCellId of selections) {
      if (!savedCellId.startsWith(hourPrefix)) continue
      const savedTimeStr = savedCellId.split('_')[1]
      if (!savedTimeStr) continue
      const savedParts = parseTimeParts(savedTimeStr)
      if (!savedParts) continue
      if (savedParts.minutes === 0) hasRootSlot = true
      else hasSpecificSubHourSlot = true
    }

    return hasRootSlot && !hasSpecificSubHourSlot && selections.has(rootSlot)
  }

  const hasImplicitHourCoverageForWeekday = (
    selections: Set<string>,
    dayOfWeek: number,
    hours: number,
    minutes: number
  ): boolean => {
    if (timeInterval >= 60 || minutes === 0) return false

    let hasRootSlot = false
    let hasSpecificSubHourSlot = false

    for (const savedCellId of selections) {
      const [savedDateStr, savedTimeStr] = savedCellId.split('_')
      if (!savedDateStr || !savedTimeStr) continue
      const savedDate = parse(savedDateStr, 'yyyy-MM-dd', new Date())
      if (!isValid(savedDate) || getDay(savedDate) !== dayOfWeek) continue

      const savedParts = parseTimeParts(savedTimeStr)
      if (!savedParts || savedParts.hours !== hours) continue

      if (savedParts.minutes === 0) hasRootSlot = true
      else hasSpecificSubHourSlot = true
    }

    return hasRootSlot && !hasSpecificSubHourSlot
  }

  // For weekly availability: find all saved cellIds that match a given cellId by day-of-week + time
  const findMatchingSavedSlots = (selections: Set<string>, cellId: string): string[] => {
    const [dateStr, timeStr] = cellId.split('_')
    const cellDate = parse(dateStr, 'yyyy-MM-dd', new Date())
    if (!isValid(cellDate)) return []
    const timeParts = parseTimeParts(timeStr)
    if (!timeParts) return []
    const cellDayOfWeek = getDay(cellDate)
    const matches: string[] = []
    for (const savedCellId of selections) {
      const [savedDateStr, savedTimeStr] = savedCellId.split('_')
      if (savedTimeStr !== timeStr) continue
      const savedDate = parse(savedDateStr, 'yyyy-MM-dd', new Date())
      if (isValid(savedDate) && getDay(savedDate) === cellDayOfWeek) {
        matches.push(savedCellId)
      }
    }

    // Backward compatibility: hour-only entries should match sub-slots when finer grid is active.
    if (matches.length === 0 && hasImplicitHourCoverageForWeekday(selections, cellDayOfWeek, timeParts.hours, timeParts.minutes)) {
      const hourRootTime = `${timeParts.hours.toString().padStart(2, '0')}:00`
      for (const savedCellId of selections) {
        const [savedDateStr, savedTimeStr] = savedCellId.split('_')
        if (!savedDateStr || savedTimeStr !== hourRootTime) continue
        const savedDate = parse(savedDateStr, 'yyyy-MM-dd', new Date())
        if (isValid(savedDate) && getDay(savedDate) === cellDayOfWeek) {
          matches.push(savedCellId)
        }
      }
    }

    return matches
  }

  const handleAddAvailability = async () => {
    if (!username.trim()) {
      alert('Please enter your name first')
      return
    }
    
    if (currentSelection.size === 0) {
      return
    }
    
    // For weekly mode, map current-week cellIds to the original week
    const slotsToSave = hideDateNumbers
      ? new Set(Array.from(currentSelection).map(mapCellIdToOriginalWeek))
      : currentSelection

    // Merge selected slots into existing saved selections for this user
    let mergedSlots: Set<string> = new Set()
    setSavedSelections(prev => {
      const newMap = new Map(prev)
      const existing = newMap.get(username) || new Set<string>()
      const merged = new Set(existing)
      slotsToSave.forEach(slot => merged.add(slot))
      newMap.set(username, merged)
      mergedSlots = merged
      return newMap
    })
    
    // Clear the purple selection after saving
    setCurrentSelection(new Set())
    setLoadError('')
    
    if (roomHash) {
      try {
        await apiClient.post('/api/availability', {
          calendar_hash: roomHash,
          username: username.trim(),
          time_slots: Array.from(slotsToSave),
          mode: 'add'
        })
        if (isAuthenticated && !isFollowing) {
          setIsFollowing(true)
        }
      } catch (error) {
        console.error('Error adding availability:', error)
        alert('Failed to add availability to database')
      }
    }
    
    // Check for unmarked weeks after adding
    checkForUnmarkedWeeks(mergedSlots)
  }

  const handleClearSelectedAvailability = async () => {
    if (!username.trim()) {
      alert('Please enter your name first')
      return
    }
    
    if (currentSelection.size === 0) {
      return
    }
    
    // For weekly mode, find the actual saved slots matching by day-of-week + time
    let slotsToRemove: Set<string>
    if (hideDateNumbers) {
      const existing = savedSelections.get(username.trim())
      if (!existing) {
        setCurrentSelection(new Set())
        return
      }
      const matched = new Set<string>()
      currentSelection.forEach(slot => {
        findMatchingSavedSlots(existing, slot).forEach(m => matched.add(m))
      })
      slotsToRemove = matched
    } else {
      const existing = savedSelections.get(username.trim())
      if (!existing) {
        setCurrentSelection(new Set())
        return
      }
      const matched = new Set<string>()
      currentSelection.forEach(slot => {
        if (existing.has(slot)) {
          matched.add(slot)
          return
        }

        const [dateStr, timeStr] = slot.split('_')
        if (!dateStr || !timeStr) return
        const timeParts = parseTimeParts(timeStr)
        if (!timeParts) return
        if (hasImplicitHourCoverageForDate(existing, dateStr, timeParts.hours, timeParts.minutes)) {
          matched.add(`${dateStr}_${timeParts.hours.toString().padStart(2, '0')}:00`)
        }
      })
      slotsToRemove = matched
    }

    // Remove selected slots from this user's saved selections
    let participantRemoved = false
    setSavedSelections(prev => {
      const newMap = new Map(prev)
      const existing = newMap.get(username.trim())
      if (existing) {
        const updated = new Set(existing)
        slotsToRemove.forEach(slot => updated.delete(slot))
        if (updated.size === 0) {
          newMap.delete(username.trim())
          participantRemoved = true
        } else {
          newMap.set(username.trim(), updated)
        }
      }
      return newMap
    })
    // If participant was fully removed, also remove from selectedParticipants
    if (participantRemoved) {
      setSelectedParticipants(prev => {
        const next = new Set(prev)
        next.delete(username.trim())
        return next
      })
    }
    setCurrentSelection(new Set())
    setLoadError('')
    
    if (roomHash) {
      try {
        await apiClient.post('/api/availability', {
          calendar_hash: roomHash,
          username: username.trim(),
          time_slots: Array.from(slotsToRemove),
          mode: 'remove'
        })
      } catch (error) {
        console.error('Error clearing availability:', error)
        alert('Failed to clear availability from database')
      }
    }
  }

  // Import availability from another calendar into the current purple selection
  const handleImportAvailability = (timeSlots: string[], importedUsername: string) => {
    if (!timeSlots || timeSlots.length === 0) return

    // Combine imported slots with the current purple selection
    setCurrentSelection(prev => {
      const merged = new Set(prev)
      for (const slot of timeSlots) merged.add(slot)
      return merged
    })

    // If Your Name is empty, use the username from the imported calendar
    if (!username.trim()) {
      setUsername(importedUsername)
    }

    setImportPreviewSelection(new Set())
    setLoadError('')
  }


  // Calculate how many users are available at a cell (for heatmap)
  const getCellAvailability = (cellId: string): string[] => {
    const users: string[] = []
    const [dateStr, timeStr] = cellId.split('_')
    const timeParts = parseTimeParts(timeStr || '')
    if (hideDateNumbers) {
      // Weekly availability: match by day-of-week + time, ignoring the specific date
      const cellDate = parse(dateStr, 'yyyy-MM-dd', new Date())
      const cellDayOfWeek = isValid(cellDate) ? getDay(cellDate) : -1 // 0=Sun..6=Sat
      savedSelections.forEach((selections, user) => {
        let hasMatch = false
        for (const savedCellId of selections) {
          const [savedDateStr, savedTimeStr] = savedCellId.split('_')
          if (savedTimeStr !== timeStr) continue
          const savedDate = parse(savedDateStr, 'yyyy-MM-dd', new Date())
          if (isValid(savedDate) && getDay(savedDate) === cellDayOfWeek) {
            users.push(user)
            hasMatch = true
            break // found a match for this user, no need to check more
          }
        }

        if (!hasMatch && timeParts && hasImplicitHourCoverageForWeekday(selections, cellDayOfWeek, timeParts.hours, timeParts.minutes)) {
          users.push(user)
        }
      })
    } else {
      savedSelections.forEach((selections, user) => {
        if (selections.has(cellId)) {
          users.push(user)
          return
        }

        if (timeParts && hasImplicitHourCoverageForDate(selections, dateStr, timeParts.hours, timeParts.minutes)) {
          users.push(user)
        }
      })
    }
    return users
  }

  // Get heatmap color based on user count
  const getHeatmapColor = (userCount: number): string => {
    if (userCount === 0) return ''
    if (userCount === 1) return 'bg-green-200'
    if (userCount === 2) return 'bg-green-400'
    if (userCount === 3) return 'bg-green-500'
    return 'bg-green-600' // 4+
  }

  // Get purple gradient based on saved user count beneath
  const getPurpleGradient = (userCount: number): string => {
    if (userCount === 0) return 'bg-purple-300'
    if (userCount === 1) return 'bg-purple-400'
    if (userCount === 2) return 'bg-purple-500'
    return 'bg-purple-600' // 3+
  }

  // Get orange highlight color for selected participants
  // Returns inline backgroundColor style for selected-participant cells
  const getSelectedParticipantCellStyle = (cellId: string): string | undefined => {
    if (selectedParticipants.size === 0) return undefined
    const availableUsers = getCellAvailability(cellId)
    const matchingSelected = availableUsers.filter(u => selectedParticipants.has(u))
    if (matchingSelected.length === 0) return undefined
    // Single selected participant available ā†’ light orange
    // Multiple selected participants overlap ā†’ darker orange
    if (matchingSelected.length === 1) return 'rgba(251, 146, 60, 0.55)' // orange-400
    if (matchingSelected.length === 2) return 'rgba(249, 115, 22, 0.7)'  // orange-500
    if (matchingSelected.length === 3) return 'rgba(234, 88, 12, 0.8)'   // orange-600
    return 'rgba(194, 65, 12, 0.85)' // orange-700 for 4+
  }

  // Toggle participant selection
  const toggleParticipantSelection = (participantName: string) => {
    setSelectedParticipants(prev => {
      const next = new Set(prev)
      if (next.has(participantName)) {
        next.delete(participantName)
      } else {
        next.add(participantName)
      }
      return next
    })
  }

  // Get users available in hovered cell
  const getHoveredCellUsers = (): string[] => {
    if (!hoveredCell) return []
    return getCellAvailability(hoveredCell)
  }

  // Open a meeting in the side panel editor from any UI surface (cards, tooltip, etc.)
  const openMeetingEditorByIndex = (meetingIndex: number, occurrenceCellId?: string) => {
    const meeting = confirmedMeetings[meetingIndex]
    if (!meeting) return

    if (!isCreator) {
      if (meeting.id) navigate(`/meeting/${meeting.id}`)
      return
    }

    const targetCellId = occurrenceCellId || meeting.cellId
    const [dateStr, timeStr] = targetCellId.split('_')
    if (!dateStr || !timeStr) return

    setEditingMeetingIndex(meetingIndex)
    setPendingMeetingCellId(targetCellId)
    setMeetingFormData({
      title: getMeetingEditorTitle(meeting, eventName || calendarTitle || ''),
      meetingLink: meeting.meetingLink,
      description: meeting.description,
      duration: meeting.duration,
      recurrenceRule: meeting.recurrenceRule || { type: 'none' }
    })
    setShowMeetingSidePanel(true)
    setIsCreatingMeeting(true)

    const [hours, minutes] = timeStr.split(':').map(Number)
    const startMinutes = hours * 60 + minutes
    const cellsToSelect = new Set<string>()
    for (let m = startMinutes; m < startMinutes + meeting.duration; m += timeInterval) {
      const h = Math.floor(m / 60)
      const min = m % 60
      cellsToSelect.add(`${dateStr}_${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`)
    }
    setMeetingCreationSelection(cellsToSelect)
    setLeftPanelOrder(prev => prev.includes('meetingForm') ? prev : [...prev, 'meetingForm'])
  }

  // Close pinned tooltip when user clicks outside it.
  useEffect(() => {
    if (!pinnedHoverCell) return

    const handleClickAway = (event: MouseEvent) => {
      if (pinnedTooltipRef.current && pinnedTooltipRef.current.contains(event.target as Node)) {
        return
      }
      setPinnedHoverCell(null)
      setPinnedTooltipPosition(null)
      setHoveredCell(null)
      setTooltipPosition(null)
    }

    document.addEventListener('mousedown', handleClickAway)
    return () => document.removeEventListener('mousedown', handleClickAway)
  }, [pinnedHoverCell])

  // Get total unique participants
  const getTotalParticipants = (): number => {
    return savedSelections.size
  }

  // Calculate suggested meeting times
  const calculateSuggestedMeetings = () => {
    // Build a map of cellId -> participants
    const cellParticipants = new Map<string, Set<string>>()
    
    savedSelections.forEach((cells, username) => {
      cells.forEach(cellId => {
        if (!cellParticipants.has(cellId)) {
          cellParticipants.set(cellId, new Set())
        }
        cellParticipants.get(cellId)!.add(username)
      })
    })
    
    // Find optimal meeting times that cover different groups of people
    const suggestions: SuggestedMeeting[] = []
    const coveredParticipants = new Set<string>()
    const allParticipants = Array.from(savedSelections.keys())
    const suggestedColors = [
      'rgb(59, 130, 246)', // Blue
      'rgb(16, 185, 129)', // Green  
      'rgb(245, 158, 11)', // Amber
      'rgb(239, 68, 68)', // Red
      'rgb(168, 85, 247)', // Purple
      'rgb(236, 72, 153)', // Pink
    ]
    
    let suggestionId = 1
    
    // Keep finding meetings until all participants are covered or no more valid slots
    while (coveredParticipants.size < allParticipants.length && suggestionId <= 6) {
      let bestCell: string | null = null
      let bestNewParticipants: string[] = []
      let bestScore = 0
      
      // Find the cell that covers the most new (uncovered) participants
      cellParticipants.forEach((participants, cellId) => {
        const newParticipants = Array.from(participants).filter(p => !coveredParticipants.has(p))
        
        // Score: prioritize new participants, but also consider total participants
        const score = newParticipants.length * 10 + participants.size
        
        if (newParticipants.length > 0 && score > bestScore) {
          bestScore = score
          bestCell = cellId
          bestNewParticipants = newParticipants
        }
      })
      
      if (bestCell && bestNewParticipants.length > 0) {
        const allCellParticipants = Array.from(cellParticipants.get(bestCell)!)
        suggestions.push({
          id: suggestionId,
          cellId: bestCell,
          participants: allCellParticipants,
          color: suggestedColors[(suggestionId - 1) % suggestedColors.length]
        })
        
        // Mark these participants as covered
        allCellParticipants.forEach(p => coveredParticipants.add(p))
        suggestionId++
      } else {
        break // No more valid suggestions
      }
    }
    
    setSuggestedMeetings(suggestions)
    setShowSuggestions(true)
    setPanelOpenOrder(prev => [...prev.filter(p => p !== 'suggestions'), 'suggestions'])

    // Auto-navigate to the week containing the first suggested meeting and
    // auto-select that time (mirrors clicking "Confirm This Time" on the first card).
    const firstSuggestion = suggestions[0]
    if (firstSuggestion) {
      const [dateStr, timeStr] = firstSuggestion.cellId.split('_')
      const meetingDate = parse(dateStr, 'yyyy-MM-dd', new Date())
      if (isValid(meetingDate)) {
        const targetWeekStart = startOfWeek(meetingDate, { weekStartsOn: 1 })
        setCurrentWeekStart(targetWeekStart)
      }

      // Only creators can confirm/create a meeting from a suggestion.
      if (isCreator) {
        setPendingMeetingCellId(firstSuggestion.cellId)
        setShowMeetingSidePanel(true)
        setIsCreatingMeeting(true)
        setMeetingFormData(createEmptyMeetingFormData())
        setShowRecurrencePanel(false)
        const [hours, minutes] = timeStr.split(':').map(Number)
        const startMinutes = hours * 60 + minutes
        const cellsToSelect = new Set<string>()
        for (let m = startMinutes; m < startMinutes + 60; m += timeInterval) {
          const h = Math.floor(m / 60)
          const min = m % 60
          cellsToSelect.add(`${dateStr}_${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`)
        }
        setMeetingCreationSelection(cellsToSelect)
        setLeftPanelOrder(prev => prev.includes('meetingForm') ? prev : [...prev, 'meetingForm'])
      }
    }
  }

  const clearSuggestions = () => {
    setSuggestedMeetings([])
    setShowSuggestions(false)
    setPanelOpenOrder(prev => prev.filter(p => p !== 'suggestions'))
  }

  // Get suggestion for a specific cell
  const getSuggestionForCell = (cellId: string): SuggestedMeeting | undefined => {
    return suggestedMeetings.find(s => s.cellId === cellId)
  }
  
  // Get current time indicator position (in pixels from top)
  const getCurrentTimePosition = (): number | null => {
    const now = currentTime
    const currentHourUTC = now.getUTCHours()
    const currentMinuteUTC = now.getUTCMinutes()
    
    // Check if current time is within the visible time range
    if (currentHourUTC < startHour || currentHourUTC >= endHour) {
      return null
    }
    
    // Calculate position: hours from startHour * slots per hour * 32px per slot
    const minutesFromStart = (currentHourUTC - startHour) * 60 + currentMinuteUTC
    const slotsFromStart = minutesFromStart / timeInterval
    const position = slotsFromStart * 32 // 32px is the height of each cell (h-[32px])
    
    return position
  }
  
  // Get flash animation color for a cell
  const getFlashColor = (day: Date, time: string): string | null => {
    if (!flashingDay || !isSameDay(day, flashingDay)) return null
    
    const [hours, minutes] = time.split(':').map(Number)
    const cellMinutes = hours * 60 + minutes
    const currentMinutes = currentTime.getUTCHours() * 60 + currentTime.getUTCMinutes()
    
    const elapsed = Date.now() - flashStartTime
    
    // Soft pink-red color
    const baseColor = `hsla(350, 70%, 65%,` // soft pink-red hue
    
    // Phase 1: Fade IN (0 to FADE_IN_DURATION)
    if (elapsed < FADE_IN_DURATION) {
      const fadeInProgress = elapsed / FADE_IN_DURATION
      const opacity = 0.85 * fadeInProgress
      return `${baseColor} ${opacity})`
    }
    
    // Phase 2: Fade OUT - cell by cell
    const fadeOutStartTime = elapsed - FADE_IN_DURATION
    
    // Build the sequence of cells to fade:
    // 1. From (current time - 1 slot) going DOWN to start hour
    // 2. From end hour going DOWN to current time
    
    // Calculate which slot index this cell is
    const slotDuration = timeInterval // minutes per slot
    
    // Determine cell's position in the fade sequence
    let sequenceIndex = -1
    
    // Part 1: Cells from (currentMinutes - slotDuration) down to startHour
    if (cellMinutes < currentMinutes && cellMinutes >= startHour * 60) {
      // Calculate how many slots from (currentMinutes - slotDuration) down to this cell
      const startOfSequence = currentMinutes - slotDuration
      const slotsFromTop = Math.floor((startOfSequence - cellMinutes) / slotDuration)
      sequenceIndex = slotsFromTop
    }
    // Part 2: Cells from endHour down to currentMinutes
    else if (cellMinutes >= currentMinutes && cellMinutes < endHour * 60) {
      // Calculate the offset (all cells from part 1 come first)
      const part1Slots = Math.ceil((currentMinutes - slotDuration - startHour * 60) / slotDuration)
      // Calculate how many slots from (endHour - slotDuration) down to this cell
      const startOfPart2 = (endHour * 60) - slotDuration
      const slotsFromTop = Math.floor((startOfPart2 - cellMinutes) / slotDuration)
      sequenceIndex = part1Slots + slotsFromTop + 1
    }
    
    if (sequenceIndex < 0) {
      return `${baseColor} 0.85)` // Stay solid if not in sequence
    }
    
    // Calculate when this cell should start fading
    const cellFadeStartTime = sequenceIndex * CELL_FADE_DELAY
    const timeSinceCellStarted = fadeOutStartTime - cellFadeStartTime
    
    // If we haven't reached this cell's turn yet, stay solid
    if (timeSinceCellStarted < 0) {
      return `${baseColor} 0.85)`
    }
    
    // Calculate fade progress for this individual cell
    const cellFadeProgress = Math.min(timeSinceCellStarted / CELL_FADE_DURATION, 1)
    const opacity = 0.85 * (1 - cellFadeProgress)
    
    if (opacity <= 0.01) return null
    return `${baseColor} ${opacity})`
  }

  // --- Edit Settings Handlers ---
  const handleEditSettings = () => {
    // Backup current values so we can revert on cancel
    setOriginalSettingsBackup({
      eventName,
      calendarVisibility,
      customStartDate,
      customEndDate,
      timeInterval,
      startHour,
      endHour,
      skippedDays: new Set(skippedDays),
      hideDateNumbers,
      socialLinks: { ...socialLinks },
      onboardingUrl,
      communityResources: communityResources.map(r => ({ ...r }))
    })
    setIsEditingSettings(true)
  }

  const handleCancelEditSettings = () => {
    // Revert to original values
    if (originalSettingsBackup) {
      setEventName(originalSettingsBackup.eventName)
      setCalendarVisibility(originalSettingsBackup.calendarVisibility)
      setCustomStartDate(originalSettingsBackup.customStartDate)
      setCustomEndDate(originalSettingsBackup.customEndDate)
      setTimeInterval(originalSettingsBackup.timeInterval)
      setStartHour(originalSettingsBackup.startHour)
      setEndHour(originalSettingsBackup.endHour)
      setSkippedDays(originalSettingsBackup.skippedDays)
      setHideDateNumbers(originalSettingsBackup.hideDateNumbers)
      setSocialLinks(originalSettingsBackup.socialLinks)
      setOnboardingUrl(originalSettingsBackup.onboardingUrl)
      setCommunityResources(originalSettingsBackup.communityResources)
    }
    setIsEditingSettings(false)
    setOriginalSettingsBackup(null)
  }

  const handleSaveSettings = async () => {
    if (!roomHash) return
    setIsSavingSettings(true)
    try {
      const config = {
        customStartDate,
        customEndDate,
        skippedDays: Array.from(skippedDays),
        timeInterval,
        startHour,
        endHour,
        timezone: selectedTimezone,
        eventName,
        hideDateNumbers,
        socialLinks,
        onboardingUrl,
        communityResources: communityResources.filter(r => r.name.trim() && r.url.trim())
      }
      await apiClient.patch(`/api/calendars/${roomHash}`, {
        title: eventName,
        config,
        visibility: calendarVisibility
      })
      setCalendarTitle(eventName)
      setCalendarConfig(config)
      setIsEditingSettings(false)
      setOriginalSettingsBackup(null)
    } catch (error) {
      console.error('Error saving calendar settings:', error)
      alert('Failed to save settings. Please try again.')
    } finally {
      setIsSavingSettings(false)
    }
  }

  const handleCreateCalendar = async () => {
    if (!eventName.trim()) {
      alert('Please enter a calendar name')
      return
    }

    // If not authenticated, save form data and redirect to login
    if (!isAuthenticated) {
      const pendingCalendar = {
        eventName,
        customStartDate,
        customEndDate,
        calendarVisibility,
        timeInterval,
        startHour,
        endHour,
        skippedDays: Array.from(skippedDays),
        selectedTimezone
      }
      localStorage.setItem('pendingCalendarData', JSON.stringify(pendingCalendar))
      navigate('/auth/login', { state: { from: { pathname: '/calendar' } } })
      return
    }

    // Set creator info from real auth
    if (isAuthenticated && user) {
      setCreatorName(user.displayName || user.travelerName || 'Unknown')
    } else {
      setCreatorName('')
    }
    setIsCreator(true)

    // Travelers can only create unlisted calendars
    const finalVisibility = isTraveler ? 'unlisted' : calendarVisibility

    // Prepare calendar config
    const config = {
      customStartDate,
      customEndDate,
      skippedDays: Array.from(skippedDays),
      timeInterval,
      startHour,
      endHour,
      timezone: selectedTimezone,
      eventName,
      hideDateNumbers
    }

    const calendarData = {
      title: eventName,
      config,
      visibility: finalVisibility,
      creator_account_type: isTraveler ? 'traveler' : isCardano ? 'cardano' : 'google',
      permissions: {
        canEdit: isAuthenticated && user ? [user.email || user.id] : []
      },
      created_by: isAuthenticated && user ? (user.email || user.id) : 'anonymous'
    }
    
    try {
      // Save to database
      const response = await apiClient.post('/api/calendars', calendarData)
      const createdCalendar = response.data
      
      // Navigate to the calendar page with the hash
      navigate(`/calendar/${createdCalendar.hash}`)
      
    } catch (error) {
      console.error('Error creating calendar:', error)
      alert('Failed to create calendar. Please try again.')
    }
  }

  const handlePreviousWeek = () => {
    setUnmarkedWeeksWarning(null)
    if (applyWeekShiftToRange('prev')) {
      const shiftedWeek = subWeeks(currentWeekStart, 1)
      if (isWithinInterval(shiftedWeek, { start: MIN_DATE, end: MAX_DATE })) {
        setCurrentWeekStart(shiftedWeek)
      }
      return
    }
    if (roomHash && customStartDate && customEndDate) {
      const rangeStart = parse(customStartDate, 'yyyy-MM-dd', new Date())
      const rangeEnd = parse(customEndDate, 'yyyy-MM-dd', new Date())
      const _plannableWeekStart = startOfWeek(rangeStart, { weekStartsOn: 1 })
      const plannableWeekEnd = startOfWeek(rangeEnd, { weekStartsOn: 1 })
      // If current week is after the plannable range, jump to the last plannable week
      if (currentWeekStart > plannableWeekEnd) {
        setCurrentWeekStart(plannableWeekEnd)
        return
      }
    }
    const newWeekStart = subWeeks(currentWeekStart, 1)
    if (isWithinInterval(newWeekStart, { start: MIN_DATE, end: MAX_DATE })) {
      setCurrentWeekStart(newWeekStart)
    }
  }

  const handleNextWeek = () => {
    setUnmarkedWeeksWarning(null)
    if (applyWeekShiftToRange('next')) {
      const shiftedWeek = addWeeks(currentWeekStart, 1)
      if (isWithinInterval(shiftedWeek, { start: MIN_DATE, end: MAX_DATE })) {
        setCurrentWeekStart(shiftedWeek)
      }
      return
    }
    if (roomHash && customStartDate && customEndDate) {
      const rangeStart = parse(customStartDate, 'yyyy-MM-dd', new Date())
      const plannableWeekStart = startOfWeek(rangeStart, { weekStartsOn: 1 })
      const rangeEnd = parse(customEndDate, 'yyyy-MM-dd', new Date())
      const _plannableWeekEnd = startOfWeek(rangeEnd, { weekStartsOn: 1 })
      // If current week is before the plannable range, jump to the first plannable week
      if (currentWeekStart < plannableWeekStart) {
        setCurrentWeekStart(plannableWeekStart)
        return
      }
    }
    const newWeekStart = addWeeks(currentWeekStart, 1)
    if (isWithinInterval(newWeekStart, { start: MIN_DATE, end: MAX_DATE })) {
      setCurrentWeekStart(newWeekStart)
    }
  }

  const handleToday = () => {
    const today = new Date()
    if (isWithinInterval(today, { start: MIN_DATE, end: MAX_DATE })) {
      const weekStart = startOfWeek(today, { weekStartsOn: 1 })
      setCurrentWeekStart(weekStart)
      
      // Trigger flash animation
      setFlashingDay(today)
      setFlashStartTime(Date.now())
      
      // Calculate total animation duration based on number of cells
      const totalSlots = ((endHour - startHour) * 60) / timeInterval
      const fadeOutDuration = totalSlots * CELL_FADE_DELAY + CELL_FADE_DURATION
      const totalDuration = FADE_IN_DURATION + fadeOutDuration
      
      // Clear animation when done
      setTimeout(() => {
        setFlashingDay(null)
      }, totalDuration)
    }
  }

  // Helper to format time with AM/PM in user's primary timezone
  const formatTimeWithPeriod = (timeStr: string): string => {
    return formatUtcTimeWithPeriodInTimezone(timeStr, tzState.primary)
  }

  // Helper to get meetings sorted: upcoming first (chronologically), then past (most recent first)
  const getSortedMeetings = () => {
    const now = Date.now()
    const activeWeekStartMs = startOfWeek(new Date(now), { weekStartsOn: 1 }).getTime()
    const currentWeekStartMs = currentWeekStart.getTime()
    const currentWeekEndMs = addDays(currentWeekStart, 7).getTime()
    return [...confirmedMeetings]
      .map((meeting, originalIndex) => {
        const [dateStr, timeStr] = meeting.cellId.split('_')
        const startMs = new Date(`${dateStr}T${timeStr}:00Z`).getTime()
        const endMs = startMs + (meeting.duration || 0) * 60_000
        const isPast = endMs < now
        const isUpcomingFutureWeek = !isPast && startMs >= currentWeekEndMs
        const isPastInActiveWeek = isPast
          && currentWeekStartMs === activeWeekStartMs
          && startMs >= currentWeekStartMs
          && startMs < currentWeekEndMs
        return { ...meeting, originalIndex, startMs, isPast, isPastInActiveWeek, isUpcomingFutureWeek }
      })
      .sort((a, b) => {
        if (a.isPast !== b.isPast) return a.isPast ? 1 : -1
        // Upcoming: ascending (soonest first). Past: descending (most recent first).
        return a.isPast ? b.startMs - a.startMs : a.startMs - b.startMs
      })
  }

  // Helper to get chronological meeting number for a meeting
  const getChronologicalMeetingNumber = (meetingIndex: number): number => {
    const sorted = getSortedMeetings()
    return sorted.findIndex(m => m.originalIndex === meetingIndex) + 1
  }

  // Helper to get all cells that belong to a meeting (supports cross-midnight)
  const getMeetingCells = (meeting: { cellId: string; duration: number }): Set<string> => {
    const cells = new Set<string>()
    
    // Safety check for undefined or malformed cellId
    if (!meeting.cellId || !meeting.cellId.includes('_')) {
      console.warn('Invalid cellId format:', meeting.cellId)
      return cells
    }
    
    const [startDate, startTime] = meeting.cellId.split('_')
    if (!startTime || !startTime.includes(':')) {
      console.warn('Invalid time format in cellId:', meeting.cellId)
      return cells
    }
    
    const [startHours, startMinutes] = startTime.split(':').map(Number)
    
    let currentDate = parse(startDate, 'yyyy-MM-dd', new Date())
    let currentMinutes = startHours * 60 + startMinutes
    let remainingDuration = meeting.duration
    
    while (remainingDuration > 0) {
      const hours = Math.floor(currentMinutes / 60) % 24
      const mins = currentMinutes % 60
      
      // If we've crossed midnight, move to next day
      if (currentMinutes >= 24 * 60) {
        currentDate = addDays(currentDate, 1)
        currentMinutes = currentMinutes % (24 * 60)
        continue
      }
      
      const dateStr = format(currentDate, 'yyyy-MM-dd')
      const timeStr = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`
      cells.add(`${dateStr}_${timeStr}`)
      
      currentMinutes += timeInterval
      remainingDuration -= timeInterval
    }
    
    return cells
  }

  // Project future-week meetings onto the current grid in two cases:
  // 1. "Any Week" / generic mode (hideDateNumbers=true): project by weekday so confirmed
  //    meetings from any specific week are visible on the generic display.
  // 2. Single-week specific date range: project when the current view is before the range.
  const isWeekdayCalendarMode = (() => {
    if (!roomHash) return false
    // Any-Week mode: always project future meetings by weekday
    if (hideDateNumbers) return true
    // Specific date range: project for single-week calendars
    if (!customStartDate || !customEndDate) return false
    const start = parse(customStartDate, 'yyyy-MM-dd', new Date())
    const end = parse(customEndDate, 'yyyy-MM-dd', new Date())
    if (!isValid(start) || !isValid(end)) return false
    return startOfWeek(start, { weekStartsOn: 1 }).getTime() === startOfWeek(end, { weekStartsOn: 1 }).getTime()
  })()

  // Helper to check if a cell is part of confirmed meetings (returns all matching meetings)
  // Also checks recurring occurrences for meetings with recurrenceRule
  const getConfirmedMeetingsAtCell = (cellId: string): Array<{ meetingIndex: number; chronologicalNumber: number; isFirstCell: boolean; isLastCell: boolean; position: 'first' | 'middle' | 'last' | 'single'; isRecurring?: boolean; isFutureWeekProjection?: boolean; occurrenceCellId?: string }> => {
    const meetings: Array<{ meetingIndex: number; chronologicalNumber: number; isFirstCell: boolean; isLastCell: boolean; position: 'first' | 'middle' | 'last' | 'single'; isRecurring?: boolean; isFutureWeekProjection?: boolean; occurrenceCellId?: string }> = []
    
    for (let i = 0; i < confirmedMeetings.length; i++) {
      const meeting = confirmedMeetings[i]
      const meetingCells = getMeetingCells(meeting)
      
      if (meetingCells.has(cellId)) {
        const cellsArray = Array.from(meetingCells)
        const isFirstCell = cellsArray[0] === cellId
        const isLastCell = cellsArray[cellsArray.length - 1] === cellId
        const isSingleCell = cellsArray.length === 1
        
        let position: 'first' | 'middle' | 'last' | 'single' = 'middle'
        if (isSingleCell) position = 'single'
        else if (isFirstCell) position = 'first'
        else if (isLastCell) position = 'last'
        
        meetings.push({
          meetingIndex: i,
          chronologicalNumber: getChronologicalMeetingNumber(i),
          isFirstCell,
          isLastCell,
          position,
          occurrenceCellId: meeting.cellId
        })
      }

      // Check recurring occurrences in the current visible week
      if (meeting.recurrenceRule && meeting.recurrenceRule.type !== 'none') {
        const recurringCellIds = getRecurringOccurrencesInWeek(
          meeting.cellId,
          meeting.duration,
          meeting.recurrenceRule,
          currentWeekStart,
          timeInterval
        )
        for (const recCellId of recurringCellIds) {
          // Build meeting cells for this occurrence
          const occCells = getMeetingCells({ cellId: recCellId, duration: meeting.duration })
          if (occCells.has(cellId)) {
            const occArray = Array.from(occCells)
            const isFirstCell = occArray[0] === cellId
            const isLastCell = occArray[occArray.length - 1] === cellId
            const isSingleCell = occArray.length === 1
            
            let position: 'first' | 'middle' | 'last' | 'single' = 'middle'
            if (isSingleCell) position = 'single'
            else if (isFirstCell) position = 'first'
            else if (isLastCell) position = 'last'
            
            meetings.push({
              meetingIndex: i,
              chronologicalNumber: getChronologicalMeetingNumber(i),
              isFirstCell,
              isLastCell,
              position,
              isRecurring: true,
              occurrenceCellId: recCellId
            })
          }
        }
      }

      // In weekday calendar mode, show future-week meetings projected onto this week's weekday columns.
      if (isWeekdayCalendarMode) {
        const [meetingDateStr, meetingTimeStr] = meeting.cellId.split('_')
        const meetingDate = parse(meetingDateStr, 'yyyy-MM-dd', new Date())
        const weekEndExclusive = addDays(currentWeekStart, 7)

        if (isValid(meetingDate) && meetingDate >= weekEndExclusive && meetingTimeStr) {
          const jsDay = getDay(meetingDate) // 0=Sun..6=Sat
          const monOffset = jsDay === 0 ? 6 : jsDay - 1 // Mon=0..Sun=6
          const projectedDate = addDays(currentWeekStart, monOffset)
          const projectedCellId = `${format(projectedDate, 'yyyy-MM-dd')}_${meetingTimeStr}`
          const projectedCells = getMeetingCells({ cellId: projectedCellId, duration: meeting.duration })

          if (projectedCells.has(cellId)) {
            const projectedArray = Array.from(projectedCells)
            const isFirstCell = projectedArray[0] === cellId
            const isLastCell = projectedArray[projectedArray.length - 1] === cellId
            const isSingleCell = projectedArray.length === 1

            let position: 'first' | 'middle' | 'last' | 'single' = 'middle'
            if (isSingleCell) position = 'single'
            else if (isFirstCell) position = 'first'
            else if (isLastCell) position = 'last'

            meetings.push({
              meetingIndex: i,
              chronologicalNumber: getChronologicalMeetingNumber(i),
              isFirstCell,
              isLastCell,
              position,
              isFutureWeekProjection: true,
              occurrenceCellId: meeting.cellId
            })
          }
        }
      }
    }
    
    return meetings
  }

  const handleCustomDateChange = (type: 'start' | 'end', value: string) => {
    const newDate = parse(value, 'yyyy-MM-dd', new Date())
    if (!isValid(newDate)) {
      // Allow partial/invalid input without adjustments
      if (type === 'start') setCustomStartDate(value)
      else setCustomEndDate(value)
      return
    }

    let effectiveStart: Date
    let effectiveEnd: Date

    if (type === 'start') {
      setCustomStartDate(value)
      effectiveStart = newDate

      // If new start is after end, shift end to maintain the same duration gap
      if (customStartDate && customEndDate) {
        const oldStart = parse(customStartDate, 'yyyy-MM-dd', new Date())
        const oldEnd = parse(customEndDate, 'yyyy-MM-dd', new Date())
        if (isValid(oldStart) && isValid(oldEnd) && newDate > oldEnd) {
          const duration = differenceInDays(oldEnd, oldStart)
          const shiftedEnd = addDays(newDate, Math.max(duration, 0))
          setCustomEndDate(format(shiftedEnd, 'yyyy-MM-dd'))
          effectiveEnd = shiftedEnd
        } else {
          effectiveEnd = isValid(oldEnd) ? oldEnd : newDate
        }
      } else {
        effectiveEnd = newDate
      }
    } else {
      setCustomEndDate(value)
      effectiveEnd = newDate

      // If new end is before start, shift start to maintain the same duration gap
      if (customStartDate && customEndDate) {
        const oldStart = parse(customStartDate, 'yyyy-MM-dd', new Date())
        const oldEnd = parse(customEndDate, 'yyyy-MM-dd', new Date())
        if (isValid(oldStart) && isValid(oldEnd) && newDate < oldStart) {
          const duration = differenceInDays(oldEnd, oldStart)
          const shiftedStart = addDays(newDate, -Math.max(duration, 0))
          setCustomStartDate(format(shiftedStart, 'yyyy-MM-dd'))
          effectiveStart = shiftedStart
        } else {
          effectiveStart = isValid(oldStart) ? oldStart : newDate
        }
      } else {
        effectiveStart = newDate
      }
    }

    // If the current visible week no longer overlaps the date range, navigate to the first available week
    const weekEnd = addDays(currentWeekStart, 6)
    const rangeOverlapsVisibleWeek = effectiveStart <= weekEnd && effectiveEnd >= currentWeekStart
    if (!rangeOverlapsVisibleWeek) {
      setCurrentWeekStart(startOfWeek(effectiveStart, { weekStartsOn: 1 }))
    }

    if (!roomHash) {
      addDefaultSundaySkips(effectiveStart, effectiveEnd)
    }
  }

  // Check if a week has any available days based on the availability range
  const hasAvailableDays = (weekStart: Date): boolean => {
    if (!roomHash || !customStartDate || !customEndDate) return true
    
    const rangeStart = parse(customStartDate, 'yyyy-MM-dd', new Date())
    const rangeEnd = parse(customEndDate, 'yyyy-MM-dd', new Date())
    
    // Check if any day in the week falls within the range
    for (let i = 0; i < 7; i++) {
      const day = addDays(weekStart, i)
      if (isWithinInterval(day, { start: rangeStart, end: rangeEnd })) {
        return true
      }
    }
    return false
  }

  // When we have a plannable range and we're outside it, allow navigating toward it
  const isPreviousDisabled = (() => {
    if (roomHash && customStartDate && customEndDate) {
      const rangeEnd = parse(customEndDate, 'yyyy-MM-dd', new Date())
      const plannableWeekEnd = startOfWeek(rangeEnd, { weekStartsOn: 1 })
      // If current week is past the plannable range, allow going back toward it
      if (currentWeekStart > plannableWeekEnd) return false
      return !hasAvailableDays(subWeeks(currentWeekStart, 1))
    }
    return !isWithinInterval(subWeeks(currentWeekStart, 1), { start: MIN_DATE, end: MAX_DATE })
  })()
  
  const isNextDisabled = (() => {
    if (roomHash && customStartDate && customEndDate) {
      const rangeStart = parse(customStartDate, 'yyyy-MM-dd', new Date())
      const plannableWeekStart = startOfWeek(rangeStart, { weekStartsOn: 1 })
      // If current week is before the plannable range, allow going forward toward it
      if (currentWeekStart < plannableWeekStart) return false
      return !hasAvailableDays(addWeeks(currentWeekStart, 1))
    }
    return !isWithinInterval(addWeeks(currentWeekStart, 1), { start: MIN_DATE, end: MAX_DATE })
  })()
  const today = new Date()

  // Show loading state while fetching calendar data
  if (isLoadingCalendar) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background p-6">
        <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin mb-4" />
        <p className="text-muted-foreground text-sm">Loading calendar...</p>
      </div>
    )
  }

  // Show Calendar Not Found page if hash doesn't exist
  if (calendarNotFound) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background p-6">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-950 flex items-center justify-center">
            <X className="w-8 h-8 text-red-600 dark:text-red-400" />
          </div>
          <h1 className="text-2xl font-bold mb-2">
            Calendar Not Found
          </h1>
          <p className="text-muted-foreground mb-6">
            This Coordination Calendar does not exist or you do not have permission to view it.
          </p>
          <button
            onClick={() => navigate('/calendars')}
            className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium"
          >
            Go to Coordination Calendars
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-screen p-2 md:p-6">
      {/* Left panels -- rendered via portal into Layout root flex */}
      <LeftPanelPortal>
      {isMobile && (showLeftSidebar || (showMeetingSidePanel && !!pendingMeetingCellId)) && (
        <button
          type="button"
          aria-label="Close tools panel"
          className="fixed inset-0 z-[92] bg-black/55"
          onClick={closeMobileLeftPanels}
        />
      )}

      {/* Meeting Side Panel (left, push) -- order driven by leftPanelOrder */}
      {isCreator && (
        <div style={{ order: leftPanelOrder.indexOf('meetingForm') }}>
        <MeetingSidePanel
          isOpen={showMeetingSidePanel && !!pendingMeetingCellId}
          cellId={pendingMeetingCellId}
          widthClassName={isMobile ? 'w-screen min-w-full' : (showLeftSidebar ? toolsSidebarInnerWidthClass : 'w-80 min-w-[20rem]')}
          mobileOverlay={isMobile}
          title={meetingFormData.title}
          duration={meetingFormData.duration}
          recurrenceRule={meetingFormData.recurrenceRule}
          meetingLink={meetingFormData.meetingLink}
          description={meetingFormData.description}
          timeInterval={timeInterval}
          isEditing={editingMeetingIndex !== null}
          meetingId={editingMeetingIndex !== null ? confirmedMeetings[editingMeetingIndex]?.id : null}
          isAuthenticated={isAuthenticated}
          hasGoogleOAuth={calendarSources.some(s => s.source_type === 'google_oauth' && s.is_active)}
          googleOAuthSources={calendarSources.filter(s => s.source_type === 'google_oauth' && s.is_active).map(s => ({ id: s.id, google_email: s.google_email, display_name: s.display_name }))}
          defaultGoogleSourceId={
            // Prefer the first checked Google OAuth source, then fall back to first available
            calendarSources.find(s => s.source_type === 'google_oauth' && s.is_active && checkedSourceIds.has(s.id))?.id
            || calendarSources.find(s => s.source_type === 'google_oauth' && s.is_active)?.id
          }
          calendarName={eventName || calendarTitle || ''}
          hideDateNumbers={hideDateNumbers}
          existingLinks={[...new Set(confirmedMeetings.filter((_, i) => i !== editingMeetingIndex).map(m => m.meetingLink).filter(Boolean))]}
          existingDescriptions={[...new Set(confirmedMeetings.filter((_, i) => i !== editingMeetingIndex).map(m => m.description).filter(Boolean))]}
          onCellIdChange={(newCellId) => setPendingMeetingCellId(newCellId)}
          onSave={async ({ title, duration, recurrenceRule, meetingLink, description }) => {
            const roundedDuration = Math.max(timeInterval, Math.round(duration / timeInterval) * timeInterval)
            const [dateStr, timeStr] = pendingMeetingCellId!.split('_')
            const startTime = new Date(`${dateStr}T${timeStr}:00Z`)
            const endTime = new Date(startTime.getTime() + roundedDuration * 60 * 1000)
            const timeSlots = [`${dateStr}T${timeStr}`]
            const recRule = recurrenceRule?.type !== 'none' ? recurrenceRule : null
            const resolvedTitle = title.trim() || eventName.trim() || calendarTitle.trim() || 'Meeting'

            if (editingMeetingIndex !== null) {
              const existingMeeting = confirmedMeetings[editingMeetingIndex]
              const meetingData = {
                ...existingMeeting,
                cellId: pendingMeetingCellId!,
                meetingLink,
                description,
                duration: roundedDuration,
                title: resolvedTitle,
                timeSlots: timeSlots.map(s => s.replace('T', '_')),
                recurrenceRule: recRule
              }
              if (existingMeeting?.id && roomHash) {
                try {
                  await apiClient.put(`/api/meetings/${existingMeeting.id}`, {
                    title: resolvedTitle,
                    description,
                    start_time: startTime.toISOString(),
                    end_time: endTime.toISOString(),
                    duration_minutes: roundedDuration,
                    meeting_link: meetingLink,
                    time_slots: timeSlots,
                    recurrence_rule: recRule
                  })
                } catch (error) {
                  console.error('Error updating meeting:', error)
                  alert('Failed to update meeting in database')
                  return
                }
              }
              setConfirmedMeetings(prev => {
                const updated = [...prev]
                updated[editingMeetingIndex] = meetingData
                return updated
              })
              setEditingMeetingIndex(null)
            } else {
              const meetingData = {
                title: resolvedTitle,
                cellId: pendingMeetingCellId!,
                meetingLink,
                description,
                duration: roundedDuration,
                recurrenceRule: recRule
              }
              if (roomHash) {
                try {
                  const response = await apiClient.post('/api/meetings', {
                    calendar_hash: roomHash,
                    title: resolvedTitle,
                    description,
                    start_time: startTime.toISOString(),
                    end_time: endTime.toISOString(),
                    duration_minutes: roundedDuration,
                    meeting_link: meetingLink,
                    created_by: isAuthenticated && user ? (user.email || user.id) : 'anonymous',
                    time_slots: timeSlots,
                    recurrence_rule: recRule
                  })
                  setConfirmedMeetings(prev => [...prev, {
                    ...meetingData,
                    id: response.data?.id,
                    timeSlots: timeSlots.map(s => s.replace('T', '_')),
                    recurrenceRule: recRule
                  }])
                } catch (error) {
                  console.error('Error saving meeting:', error)
                  alert('Failed to save meeting to database')
                  setConfirmedMeetings(prev => [...prev, meetingData])
                }
              } else {
                setConfirmedMeetings(prev => [...prev, meetingData])
              }
            }
            // Spawn fairy dust only for new meetings, not edits
            if (editingMeetingIndex === null) {
              spawnConfirmDust()
              // Clear the highlighted availability selection so the next meeting
              // starts from a clean slate (prevents confusion when planning
              // multiple meetings back-to-back).
              setCurrentSelection(new Set())
            }
            setShowMeetingSidePanel(false)
            setPendingMeetingCellId(null)
            setMeetingFormData(createEmptyMeetingFormData())
            setIsCreatingMeeting(false)
            setMeetingCreationSelection(new Set())
            setLeftPanelOrder(prev => prev.filter(p => p !== 'meetingForm'))
            clearSuggestions()
          }}
          onCancel={() => {
            setShowMeetingSidePanel(false)
            setPendingMeetingCellId(null)
            setEditingMeetingIndex(null)
            setMeetingFormData(createEmptyMeetingFormData())
            setIsCreatingMeeting(false)
            setMeetingCreationSelection(new Set())
            setLeftPanelOrder(prev => prev.filter(p => p !== 'meetingForm'))
            clearSuggestions()
          }}
        />
        </div>
      )}

      {/* Left Sidebar - Expandable Cards -- order driven by leftPanelOrder */}
      {roomHash && (
        <aside
          style={{ order: leftPanelOrder.indexOf('tools') }}
          className={`
            overflow-hidden transition-all duration-300 ease-in-out
            ${isMobile
              ? `fixed inset-y-0 left-0 z-[93] h-screen w-screen transform ${showLeftSidebar ? 'translate-x-0 pointer-events-auto' : '-translate-x-full pointer-events-none'}`
              : `shrink-0 sticky top-0 h-screen ${showLeftSidebar ? toolsSidebarWidthClass : 'w-0'}`
            }
          `}
        >
          <div className={`${isMobile ? 'w-screen min-w-full' : toolsSidebarInnerWidthClass} h-full flex flex-col bg-card border-r-2 border-border shadow-xl`}>
          {/* Sidebar Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
            <h3 className="text-sm font-bold text-foreground">Tools</h3>
            <button
              onClick={() => { setShowLeftSidebar(false); setExpandedSidebarSections(new Set()) }}
              className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Sidebar Body */}
          <div className="flex-1 overflow-y-auto p-3 flex flex-col justify-center">
          <div className="space-y-3">

            {/* Participants Card */}
            {savedSelections.size > 0 && (
              <div className="border border-border rounded-lg bg-card overflow-hidden">
                <button
                  onClick={() => toggleSidebarSection('participants')}
                  className={`w-full px-3 py-2.5 flex items-center justify-between transition-colors ${
                    expandedSidebarSections.has('participants')
                      ? 'bg-orange-50 dark:bg-orange-950/20'
                      : 'hover:bg-accent/30'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                    <span className="text-sm font-semibold text-foreground">
                      Participants
                    </span>
                    <span className="text-[10px] text-muted-foreground/60 bg-muted px-1.5 py-0.5 rounded-full">{getTotalParticipants()}</span>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${expandedSidebarSections.has('participants') ? 'rotate-180' : ''}`} />
                </button>
                {expandedSidebarSections.has('participants') && (
                  <div className="px-3 pb-3 pt-1 border-t border-border">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] text-muted-foreground">Click to highlight availability</p>
                      <div className="flex items-center gap-1">
                        {savedSelections.size > 1 && (
                          <button
                            onClick={() => {
                              if (selectedParticipants.size === savedSelections.size) {
                                setSelectedParticipants(new Set())
                              } else {
                                setSelectedParticipants(new Set(savedSelections.keys()))
                              }
                            }}
                            className="text-[10px] px-1.5 py-0.5 rounded text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950/30 font-medium transition-colors"
                          >
                            {selectedParticipants.size === savedSelections.size ? 'Clear' : 'Select All'}
                          </button>
                        )}
                        <LearnerHelpIcon
                          description={<><p className="font-semibold text-blue-700 dark:text-blue-300 mb-1">Participants</p><p className="mb-1.5">Everyone who has marked their availability on this calendar appears here.</p><p className="font-semibold text-blue-700 dark:text-blue-300 mb-1">How to use</p><ul className="list-disc list-inside space-y-0.5"><li><strong>Click a name</strong> to highlight that person's time slots on the grid.</li><li>Use <strong>Select All</strong> to see where everyone's availability overlaps.</li><li>Green cells mean more people are free at that time.</li></ul></>}
                          size={4}
                          usePortal
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {Array.from(savedSelections.keys()).map((participantName) => {
                        const isSelected = selectedParticipants.has(participantName)
                        const isHoveredAvailable = hoveredCell && getHoveredCellUsers().includes(participantName)
                        const isCurrentUser = participantName === username.trim()
                        return (
                          <button
                            key={participantName}
                            onClick={() => toggleParticipantSelection(participantName)}
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-orange-100 text-orange-800 border border-orange-400 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-600'
                                : isHoveredAvailable
                                ? 'bg-green-100 text-green-800 border border-green-300'
                                : isCurrentUser
                                  ? 'bg-purple-100 text-purple-800 border border-purple-300'
                                  : 'bg-muted text-muted-foreground border border-border hover:bg-muted/80'
                            }`}
                          >
                            {isSelected && <span className="mr-0.5">&#10004;</span>}
                            {participantName}
                          </button>
                        )
                      })}
                    </div>
                    <div className="mt-2 pt-2 border-t border-border" style={{ minHeight: '20px' }}>
                      {selectedParticipants.size > 0 && (
                        <div className="text-[10px] text-orange-600 dark:text-orange-400 mb-1">
                          <span className="inline-block w-2.5 h-2.5 rounded-sm mr-1" style={{ backgroundColor: 'rgba(251, 146, 60, 0.55)' }} />
                          Selected
                          <span className="inline-block w-2.5 h-2.5 rounded-sm mx-1" style={{ backgroundColor: 'rgba(234, 88, 12, 0.8)' }} />
                          Overlap
                        </div>
                      )}
                      {hoveredCell && getHoveredCellUsers().length > 0 ? (
                        <div className="text-xs text-green-700 dark:text-green-400 font-medium">
                          {getHoveredCellUsers().length}/{getTotalParticipants()} available
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">Hover calendar to see availability</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Calendar Syncs Card */}
            {isAuthenticated && (
              <div className="border border-border rounded-lg bg-card overflow-hidden">
                <button
                  onClick={() => toggleSidebarSection('calendarSyncs')}
                  className={`w-full px-3 py-2.5 flex items-center justify-between transition-colors ${
                    expandedSidebarSections.has('calendarSyncs')
                      ? 'bg-blue-50 dark:bg-blue-950/20'
                      : 'hover:bg-accent/30'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <span className="text-sm font-semibold text-foreground">Calendar Syncs</span>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${expandedSidebarSections.has('calendarSyncs') ? 'rotate-180' : ''}`} />
                </button>
                {expandedSidebarSections.has('calendarSyncs') && (
                  <div className="px-3 pb-3 pt-1 border-t border-border">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <h4 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
                          <Calendar className="w-4 h-4" />
                          Google Calendar
                        </h4>

                        {isTraveler ? (
                          <div className="space-y-2">
                            <p className="text-xs text-muted-foreground">
                              Create an account to connect Google Calendar and export events.
                            </p>
                            <button 
                              className="w-full px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                              onClick={() => {
                                if (user?.id) sessionStorage.setItem('previousTravelerId', user.id)
                                if (creatorEmail) sessionStorage.setItem('previousCreatorBy', creatorEmail)
                                sessionStorage.setItem('authReturnTo', window.location.pathname)
                                navigate('/auth/login?upgrade=true')
                              }}
                            >
                              <User className="w-4 h-4" />
                              Create Account
                            </button>
                            <p className="text-[10px] text-muted-foreground text-center">
                              Your calendars will be preserved.
                            </p>
                          </div>
                        ) : sourcesLoading ? (
                          <div className="flex items-center justify-center py-3 text-muted-foreground">
                            <div className="w-4 h-4 border-2 border-border border-t-primary rounded-full animate-spin mr-2" />
                            <span className="text-xs">Loading...</span>
                          </div>
                        ) : calendarSources.length === 0 ? (
                          <div className="space-y-2">
                            <p className="text-xs text-muted-foreground">
                              Connect a Google Calendar in Settings to import and export events.
                            </p>
                            <button 
                              className="w-full px-3 py-2 bg-card border border-border text-sm font-medium rounded-md hover:bg-muted transition-colors flex items-center justify-center gap-2"
                              onClick={() => navigate('/settings?tab=calendar&section=connections')}
                            >
                              <Settings className="w-4 h-4" />
                              Configure in Settings
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="space-y-1.5 max-h-64 overflow-y-auto">
                              {calendarSources.map(source => {
                                const isChecked = checkedSourceIds.has(source.id)
                                const isReadOnly = source.source_type === 'google_public_url'
                                const hasError = sourceErrors.some(se => se.sourceId === source.id)
                                return (
                                  <label
                                    key={source.id}
                                    className={`flex items-center gap-2 p-1.5 rounded cursor-pointer hover:bg-muted transition-colors ${
                                      isChecked ? 'bg-blue-50/50' : ''
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      name="calendarSourceSelection"
                                      checked={isChecked}
                                      onChange={(e) => {
                                        setCheckedSourceIds(prev => {
                                          const next = new Set(prev)
                                          if (e.target.checked) next.add(source.id)
                                          else next.delete(source.id)
                                          localStorage.setItem('calendarSourceSelections', JSON.stringify([...next]))
                                          return next
                                        })
                                      }}
                                      className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-primary flex-shrink-0"
                                    />
                                    <span
                                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                      style={{ backgroundColor: source.color }}
                                    />
                                    <span className="text-xs text-foreground truncate flex-1" title={source.google_email || source.public_url || source.display_name}>
                                      {source.display_name}
                                    </span>
                                    {isReadOnly ? (
                                      <span className="text-[9px] font-medium text-amber-600 bg-amber-50 border border-amber-200 px-1 py-0.5 rounded flex-shrink-0" title="Public calendar URLs can only be read -- events cannot be exported here">
                                        read only
                                      </span>
                                    ) : (hasError || !isChecked) ? (
                                      <span className="text-[9px] font-medium text-red-600 bg-red-50 border border-red-200 px-1 py-0.5 rounded flex-shrink-0" title={hasError ? (sourceErrors.find(se => se.sourceId === source.id)?.error || 'Calendar sync failed') : 'Calendar not selected -- check to sync'}>
                                        not synced
                                      </span>
                                    ) : (
                                      <span className="text-[9px] font-medium text-green-600 bg-green-50 border border-green-200 px-1 py-0.5 rounded flex-shrink-0" title="Events can be imported and exported to this calendar">
                                        sync
                                      </span>
                                    )}
                                  </label>
                                )
                              })}
                            </div>

                            {sourceErrors.some(se => checkedSourceIds.has(se.sourceId)) && (
                              <div className="p-2.5 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg">
                                <div className="flex items-start gap-1.5">
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
                                  <div className="min-w-0 w-full space-y-1">
                                    {(() => {
                                      const active = sourceErrors.filter(se => checkedSourceIds.has(se.sourceId))
                                      return (<>
                                        <p className="text-[11px] font-medium text-amber-800 dark:text-amber-200">
                                          {active.length === 1 ? '1 calendar' : `${active.length} calendars`} need attention
                                        </p>
                                        {active.map(se => (
                                          <p key={se.sourceId} className="text-[10px] text-amber-700 dark:text-amber-300 whitespace-normal break-words leading-snug" title={se.error}>
                                            {se.displayName}: {se.error}
                                          </p>
                                        ))}
                                      </>)
                                    })()}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {secretSwarmModes.length > 0 && (
                        <div className="border-t border-border pt-3 space-y-2">
                          <h4 className="text-sm font-bold text-foreground flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                            Secret Swarm
                          </h4>
                          <p className="text-xs text-muted-foreground">
                            Available modes with time items in your Time Management calendar.
                          </p>
                          <div className="space-y-1.5 max-h-64 overflow-y-auto">
                            {secretSwarmModes.map(mode => {
                              const isChecked = checkedSourceIds.has(mode.id)
                              return (
                                <label
                                  key={mode.id}
                                  className={`flex items-center gap-2 p-1.5 rounded cursor-pointer hover:bg-muted transition-colors ${
                                    isChecked ? 'bg-purple-50/50 dark:bg-purple-950/20' : ''
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    name="secretSwarmModeSelection"
                                    checked={isChecked}
                                    onChange={(e) => {
                                      setCheckedSourceIds(prev => {
                                        const next = new Set(prev)
                                        if (e.target.checked) next.add(mode.id)
                                        else next.delete(mode.id)
                                        localStorage.setItem('calendarSourceSelections', JSON.stringify([...next]))
                                        return next
                                      })
                                    }}
                                    className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-primary flex-shrink-0"
                                  />
                                  <span
                                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: mode.main_color }}
                                  />
                                  <span className="text-xs text-foreground truncate flex-1" title={mode.name}>
                                    {mode.name}
                                  </span>
                                  <span
                                    className={`text-[9px] font-medium px-1 py-0.5 rounded flex-shrink-0 ${
                                      isChecked
                                        ? 'text-green-600 bg-green-50 border border-green-200'
                                        : 'text-red-600 bg-red-50 border border-red-200'
                                    }`}
                                    title={isChecked ? 'Busy times are synced from Time Management' : 'Not selected - check to sync busy times from Time Management'}
                                  >
                                    {isChecked ? 'sync' : 'not synced'}
                                  </span>
                                </label>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      <button
                        onClick={() => navigate('/settings?tab=calendar&section=connections')}
                        className="w-full flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors"
                      >
                        <Settings className="w-3 h-3" />
                        Manage connections
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Unlock More Features Card - unauthenticated users */}
            {!isAuthenticated && getTotalParticipants() >= 2 && (
              <div className="p-4 bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950 dark:to-purple-950 border border-blue-200 dark:border-blue-800 rounded-lg">
                <h4 className="text-sm font-bold text-foreground mb-2">
                  Unlock More Features
                </h4>
                <div className="space-y-1 mb-2">
                  <div className="text-xs text-foreground"><span className="font-semibold">&#10003;</span> Google Calendar Integration</div>
                  <div className="text-xs text-foreground"><span className="font-semibold">&#10003;</span> Save Availability Patterns</div>
                  <div className="text-xs text-foreground"><span className="font-semibold">&#10003;</span> Default Timezone Settings</div>
                </div>
                <button
                  onClick={() => {
                    sessionStorage.setItem('authReturnTo', window.location.pathname)
                    navigate('/auth/login')
                  }}
                  className="w-full px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors"
                >
                  Create Free Account
                </button>
              </div>
            )}

            {/* Time Width Card */}
            {isEditingSettings && (
              <div className="border border-border rounded-lg bg-card overflow-hidden">
                <div className="px-3 py-2.5 border-b border-border bg-muted/20">
                  <div className="flex items-center gap-2">
                    <CalendarClock className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                    <span className="text-sm font-semibold text-foreground">Time Width</span>
                  </div>
                </div>
                <div className="p-3">
                  <p className="text-xs text-muted-foreground mb-2">
                    Choose how wide each calendar time slot appears.
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {[15, 30, 60].map((minutes) => {
                      const isActive = timeInterval === minutes
                      const label = minutes === 60 ? '1h' : `${minutes}m`
                      return (
                        <button
                          key={minutes}
                          onClick={() => setTimeInterval(minutes as TimeInterval)}
                          className={`px-2 py-2 rounded-md text-xs font-semibold border transition-colors ${
                            isActive
                              ? 'bg-cyan-100 text-cyan-800 border-cyan-400 dark:bg-cyan-900/40 dark:text-cyan-300 dark:border-cyan-600'
                              : 'bg-card text-foreground border-border hover:bg-muted'
                          }`}
                          aria-pressed={isActive}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Actions Card */}
            <div className="border border-border rounded-lg bg-card overflow-hidden">
              <div className="px-3 py-2.5 border-b border-border bg-muted/20">
                <div className="flex items-center gap-2">
                  <CalendarClock className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-sm font-semibold text-foreground">Actions</span>
                </div>
              </div>
              <div className="p-3 space-y-2">
                {/* Copy Invite Link */}
                {roomHash && (
                  <button
                    onClick={(e) => {
                      const joinUrl = `${window.location.origin}/join/${roomHash}`
                      navigator.clipboard.writeText(joinUrl)
                      const btn = e.currentTarget as HTMLButtonElement
                      const label = btn.querySelector('[data-label]') as HTMLSpanElement | null
                      if (label) { const orig = label.textContent; label.textContent = 'Copied!'; setTimeout(() => { label.textContent = orig }, 1500) }
                    }}
                    className="flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-sm font-medium border-2 border-blue-500 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
                  >
                    <LinkIcon className="w-4 h-4" />
                    <span data-label>Copy Invite Link</span>
                  </button>
                )}
                {/* Invite to Participate */}
                <button
                  onClick={() => {
                    if (!isAuthenticated) {
                      setShowDistributeModal(true)
                      return
                    }
                    const titleText = (eventName || calendarTitle || '').trim()
                    const greeting = titleText
                      ? `You're invited to the upcoming "${titleText}" meeting.`
                      : "You're invited to the upcoming meeting."
                    const prefillTitle = titleText
                      ? `Meeting invite: ${titleText}`
                      : 'Meeting invite'
                    const prefillBody = buildInviteBody(greeting)

                    // Pre-select meetings the user has already ticked in the Confirmed Meetings list
                    const selectedMeetingDbIds = Array.from(selectedMeetingsForExport)
                      .map(idx => confirmedMeetings[idx]?.id)
                      .filter((id): id is string => Boolean(id))

                    persistAnnouncementsPrefill(prefillTitle, prefillBody, {
                      meetingIds: selectedMeetingDbIds,
                      calendarHash: roomHash || undefined,
                      calendarOnly: false,
                    })

                    const params = new URLSearchParams({
                      tab: 'compose',
                      prefillReset: '1',
                      prefillTitle,
                      prefillBody,
                      prefillCalendarHash: roomHash || '',
                    })
                    if (selectedMeetingDbIds.length > 0) {
                      params.set('prefillMeetingIds', selectedMeetingDbIds.join(','))
                    }
                    navigate(`/announcements?${params.toString()}`)
                  }}
                  className="flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-sm"
                >
                  <UserPlus className="w-4 h-4" />
                  Invite to Participate
                </button>
                {/* Invite to Planning */}
                <button
                  onClick={() => {
                    if (!isAuthenticated) {
                      setShowDistributeModal(true)
                      return
                    }
                    const titleText = (eventName || calendarTitle || '').trim()
                    const greeting = titleText
                      ? `You're invited to help plan "${titleText}".`
                      : "You're invited to help plan this coordination calendar."
                    const prefillTitle = titleText
                      ? `Planning invite: ${titleText}`
                      : 'Planning invite'
                    const prefillBody = buildInviteBody(greeting)

                    persistAnnouncementsPrefill(prefillTitle, prefillBody, {
                      calendarHash: roomHash || undefined,
                      calendarOnly: true,
                    })

                    // Planning invite -- attach the calendar itself only, no individual meetings.
                    const params = new URLSearchParams({
                      tab: 'compose',
                      prefillReset: '1',
                      prefillTitle,
                      prefillBody,
                      prefillCalendarHash: roomHash || '',
                      prefillCalendarOnly: '1',
                    })
                    navigate(`/announcements?${params.toString()}`)
                  }}
                  className="flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 transition-colors shadow-sm"
                >
                  <FileText className="w-4 h-4" />
                  Invite to Planning
                </button>
                {/* Suggest Meeting Times */}
                {savedSelections.size >= 2 && (
                  <button
                    onClick={() => {
                      calculateSuggestedMeetings()
                    }}
                    className="flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-sm font-medium bg-amber-500 text-white hover:bg-amber-600 transition-colors shadow-sm"
                  >
                    <Lightbulb className="w-4 h-4" />
                    Suggest Meeting Times
                  </button>
                )}
                {/* Create Meeting / Select Time */}
                {isCreator && (
                  <button
                    onClick={() => {
                      if (isCreatingMeeting) {
                        // SELECT TIME: scroll to calendar grid with animation
                        calendarGridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                        // Brief pulse on the grid to draw attention
                        calendarGridRef.current?.classList.add('ring-2', 'ring-blue-400', 'ring-offset-2')
                        setTimeout(() => {
                          calendarGridRef.current?.classList.remove('ring-2', 'ring-blue-400', 'ring-offset-2')
                        }, 1500)
                      } else {
                        setIsCreatingMeeting(true)
                        // If there's an existing participation selection, convert it to meeting selection
                        if (currentSelection.size > 0) {
                          const singleDayRange = analyzeSingleDaySelection(currentSelection)
                          if (singleDayRange) {
                            setMeetingCreationSelection(new Set(currentSelection))
                            setPendingMeetingCellId(singleDayRange.startCellId)
                            setMeetingFormData(prev => ({ ...prev, duration: singleDayRange.durationMinutes }))
                            setShowMeetingSidePanel(true)
                            setLeftPanelOrder(prev => prev.includes('meetingForm') ? prev : [...prev, 'meetingForm'])
                          } else {
                            const earliestCell = Array.from(currentSelection).sort()[0]
                            setMeetingCreationSelection(new Set(currentSelection))
                            setPendingMeetingCellId(earliestCell)
                            setMeetingFormData(prev => ({ ...prev, duration: currentSelection.size * timeInterval }))
                            setShowMeetingSidePanel(true)
                            setLeftPanelOrder(prev => prev.includes('meetingForm') ? prev : [...prev, 'meetingForm'])
                          }
                        }
                        // Scroll to calendar grid so user knows where to click
                        requestAnimationFrame(() => {
                          calendarGridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                          calendarGridRef.current?.classList.add('ring-2', 'ring-blue-400', 'ring-offset-2')
                          setTimeout(() => {
                            calendarGridRef.current?.classList.remove('ring-2', 'ring-blue-400', 'ring-offset-2')
                          }, 1500)
                        })
                      }
                    }}
                    className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-sm font-medium transition-colors shadow-sm ${
                      isCreatingMeeting
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'bg-emerald-600 text-white hover:bg-emerald-700'
                    }`}
                  >
                    {isCreatingMeeting ? (
                      <>
                        <CalendarPlus className="w-4 h-4" />
                        {meetingCreationSelection.size > 0 && showMeetingSidePanel ? 'Time Selected' : 'Select Time'}
                      </>
                    ) : (
                      <>
                        <Plus className="w-4 h-4" />
                        Create Meeting
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Create Meeting Time Card - inline in sidebar */}
            {isCreator && isCreatingMeeting && (
              <div className="border border-blue-300 dark:border-blue-700 rounded-lg bg-card overflow-hidden">
                <div className="px-3 py-2.5 border-b border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
                  <div className="flex items-center gap-2">
                    <CalendarPlus className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <span className="text-sm font-semibold text-foreground">Create Meeting Time</span>
                  </div>
                </div>
                <div className="p-3">
                  <div className="p-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded mb-2">
                    <p className="text-xs text-blue-800 dark:text-blue-200 font-medium">Selection Mode Active</p>
                    <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">Click and drag on the calendar to select meeting time.</p>
                  </div>
                  {meetingCreationSelection.size > 0 && showMeetingSidePanel && (
                    <div className="p-2 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded mb-2">
                      <p className="text-xs text-green-800 dark:text-green-200 font-medium">Time Selected</p>
                      <p className="text-xs text-green-600 dark:text-green-400 mt-1">Review meeting details in the panel.</p>
                    </div>
                  )}
                  <button
                    onClick={() => {
                      setIsCreatingMeeting(false)
                      setMeetingCreationSelection(new Set())
                      setShowMeetingSidePanel(false)
                      setPendingMeetingCellId(null)
                      setLeftPanelOrder(prev => prev.filter(p => p !== 'meetingForm'))
                    }}
                    className="w-full px-3 py-2 text-sm text-muted-foreground border border-border rounded-md hover:bg-muted transition-colors"
                  >
                    Cancel Selection
                  </button>
                </div>
              </div>
            )}

          </div>
          </div>
          </div>
        </aside>
      )}
      </LeftPanelPortal>

      {/* Right panel -- Import Availability (push) */}
      <RightPanelPortal>
        <ImportAvailabilityModal
          open={showImportModal}
          onClose={() => {
            setShowImportModal(false)
            setImportPreviewSelection(new Set())
          }}
          onImport={handleImportAvailability}
          onPreview={(timeSlots) => setImportPreviewSelection(new Set(timeSlots || []))}
          currentCalendarHash={roomHash}
          currentTimeInterval={timeInterval}
          currentStartHour={startHour}
          currentEndHour={endHour}
          currentWeekStart={currentWeekStart}
          customStartDate={customStartDate}
          customEndDate={customEndDate}
        />
      </RightPanelPortal>

      {/* Mobile UX Tip Banner */}
      {showLandscapeTip && isMobile && (
        <div className="landscape-tip flex items-center gap-2 px-3 py-1.5 mb-1 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg text-[11px] text-blue-700 dark:text-blue-300">
          <Smartphone className="w-3.5 h-3.5 shrink-0" />
          <span className="flex-1">Swipe days with arrows - Rotate phone for full week view</span>
          <button
            onClick={() => {
              setShowLandscapeTip(false)
              sessionStorage.setItem('landscapeTipDismissed', '1')
            }}
            className="p-0.5 hover:bg-blue-100 dark:hover:bg-blue-900 rounded"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
      {/* Delete Confirmation Modal - removed, now inline */}

      {/* Invite  — Account Required Modal */}
      {showDistributeModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowDistributeModal(false)}>
          <div className="bg-card text-card-foreground rounded-lg p-6 max-w-md w-full mx-4 shadow-xl border border-border" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold mb-2">Account Required</h2>
            <p className="text-muted-foreground mb-6">
              Sending invitations lets you share this Coordination Calendar link to Discord channels and other destinations. This requires a verified account.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDistributeModal(false)}
                className="px-4 py-2 text-muted-foreground bg-muted rounded-md hover:bg-muted/80 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowDistributeModal(false)
                  navigate('/auth/login', { state: { from: { pathname: `/calendar/${roomHash}` } } })
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium flex items-center gap-2"
              >
                <User className="w-4 h-4" />
                Verify Account
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-2 md:mb-6">
        <div className="flex flex-col gap-2 md:gap-4">
          {/* Title Row with AI Assistant & Delete Button */}
          <div className="flex flex-col-reverse md:flex-row md:items-center md:justify-between gap-2 md:gap-3">
            <div className="flex items-center gap-2">
              <h1 className="text-base md:text-2xl font-bold shrink-0">
                {!roomHash ? 'Prepare Coordination Calendar' : 'Coordination Calendar'}
              </h1>
              {/* Subscribe / Unsubscribe button  -- only for existing calendars when logged in */}
              {roomHash && isAuthenticated && (
                <button
                  onClick={handleToggleFollow}
                  disabled={followLoading}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-all duration-300 flex items-center gap-1.5 shrink-0 ${
                    isFollowing
                      ? 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-300 dark:border-yellow-700 text-yellow-700 dark:text-yellow-300 hover:bg-red-50 hover:border-red-200 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:border-red-800 dark:hover:text-red-400'
                      : 'bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-yellow-50 hover:border-yellow-400 hover:text-yellow-700 dark:hover:bg-yellow-950/30 dark:hover:border-yellow-600 dark:hover:text-yellow-300 animate-subscribe-attention'
                  }`}
                  title={isFollowing ? 'Unsubscribe -- stop showing meetings in Your Calendar' : 'Subscribe -- show meetings in Your Calendar'}
                >
                  {followLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Star className={`w-3.5 h-3.5 ${isFollowing ? 'fill-current text-yellow-500' : ''}`} />
                  )}
                  {isFollowing ? 'Subscribed' : 'Subscribe'}
                </button>
              )}
            </div>

            {/* Edit Settings Delete/Save/Cancel - Only for users with edit permission */}
            {roomHash && hasEditPermission && isEditingSettings && (
              <div className="flex items-center gap-2">
                {(
                  <>
                    <div className="relative">
                      <button
                        onClick={() => setShowDeleteConfirm(!showDeleteConfirm)}
                        className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 font-medium flex items-center gap-2"
                        title="Delete this Coordination Calendar"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete Calendar
                      </button>
                      {showDeleteConfirm && (
                        <div
                          ref={calendarDeleteRef}
                          className="absolute left-0 top-full mt-1 w-72 bg-card text-card-foreground rounded-lg p-4 shadow-xl border border-border z-50"
                        >
                          <p className="text-sm text-muted-foreground mb-3">
                            Delete this calendar? All availability data and meetings will be permanently removed.
                          </p>
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => setShowDeleteConfirm(false)}
                              disabled={isDeleting}
                              className="px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted rounded-md hover:bg-muted/80 transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={handleDeleteCalendar}
                              disabled={isDeleting}
                              className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 rounded-md hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center gap-1"
                            >
                              {isDeleting ? (
                                <>
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  Deleting...
                                </>
                              ) : (
                                <>Delete</>
                              )}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={handleSaveSettings}
                      disabled={isSavingSettings || !eventName.trim() || !customStartDate || !customEndDate}
                      className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSavingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Save Settings
                    </button>
                    <button
                      onClick={handleCancelEditSettings}
                      disabled={isSavingSettings}
                      className="px-4 py-2 bg-muted text-muted-foreground rounded-md hover:bg-muted/80 font-medium flex items-center gap-2 disabled:opacity-50"
                    >
                      <X className="w-4 h-4" />
                      Cancel
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Learner Guide - only in prepare (creation) mode */}
          {!roomHash && learnerMode && (
            <div className="rounded-xl border border-blue-200 dark:border-blue-800/60 bg-blue-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-sm leading-relaxed">
              <button
                type="button"
                onClick={() => setPrepareGuideCollapsed(!prepareGuideCollapsed)}
                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-blue-100/50 dark:hover:bg-slate-700/50 rounded-xl transition-colors"
              >
                <span className="font-semibold text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
                  Learner Guide
                </span>
                <ChevronDown className={`h-4 w-4 text-blue-400 dark:text-blue-500 transition-transform ${prepareGuideCollapsed ? '-rotate-90' : ''}`} />
              </button>
              {!prepareGuideCollapsed && (
                <div className="px-4 pb-3">
                  <p className="font-semibold text-blue-700 dark:text-blue-300 mb-1.5">What is this page?</p>
                  <p className="mb-2">
                    This is where you set up a new coordination calendar. A coordination calendar lets you collect availability from participants and schedule events or meetings around the times that work best for everyone.
                  </p>
                  <p className="font-semibold text-blue-700 dark:text-blue-300 mb-1.5">How to create a calendar</p>
                  <ul className="list-disc list-inside space-y-1 mb-2">
                    <li>Give your calendar a descriptive <strong>Event Name</strong> so participants know what it is for.</li>
                    <li>Choose <strong>Visibility</strong> -- <strong>Unlisted</strong> (only people with the link can see it) or <strong>Public</strong> (visible to everyone on the platform).</li>
                    <li>Select a <strong>date range</strong> to define which days participants can mark their availability on.</li>
                    <li>Click <strong>Create Coordination Calendar</strong> to generate a shareable link you can send to your group.</li>
                  </ul>
                  <p>
                    Once created, share the link with participants. They can mark their available time slots, and you can then schedule meetings at the best overlapping times.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Event Name and Create Button Row */}
          <div className="flex flex-col gap-3 md:gap-4 relative">
            {/* AI Notification: Name & Visibility group */}
            {!roomHash && aiNotifications?.nameVisibility && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-purple-200 dark:border-purple-800 text-sm animate-in fade-in slide-in-from-top-1 duration-300"
                style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.08), rgba(99,102,241,0.06), rgba(59,130,246,0.04))' }}
              >
                <Sparkles className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                <span className="text-foreground flex-1">{aiNotifications.nameVisibility}</span>
                <button onClick={() => setAiNotifications(prev => prev ? { ...prev, nameVisibility: undefined } : null)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
            <div className="flex flex-col gap-3 md:gap-4 md:flex-row md:items-start">
            {/* Event Name Field - Creation mode or editing settings */}
            {(!roomHash || isEditingSettings) && (
              <div className="flex-1 max-w-lg">
                <label className="block text-sm font-medium text-foreground mb-1">
                  Event Name
                </label>
                <input
                  type="text"
                  name="eventName"
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                  placeholder="Enter event name..."
                  className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-primary"
                />
              </div>
            )}

            {/* Visibility Toggle - Creation mode or editing settings */}
            {(!roomHash || isEditingSettings) && (
              <div className="flex flex-col gap-1">
                <label className="flex items-center gap-1 text-sm font-medium">
                  Visibility
                  {!roomHash && (
                    <LearnerHelpIcon
                      description={<><p className="font-semibold text-blue-700 dark:text-blue-300 mb-1">Calendar Setup</p><p className="mb-1.5">This is where you prepare your coordination calendar. Fill in the details to get started.</p><p className="font-semibold text-blue-700 dark:text-blue-300 mb-1">Steps</p><ol className="list-decimal list-inside space-y-0.5"><li>Give your calendar a <strong>name</strong>.</li><li>Choose <strong>visibility</strong> -- Unlisted (share via link) or Public (discoverable by everyone).</li><li>Pick a <strong>date range</strong> for the planning period.</li><li>Click <strong>Create</strong> to generate a shareable link.</li></ol></>}
                      size={4}
                    />
                  )}
                </label>
                <div className="flex items-center">
                  <button
                    onClick={() => !isTraveler && isAuthenticated && setCalendarVisibility('unlisted')}
                    className={`px-3 py-2 text-sm rounded-l-md border ${
                      calendarVisibility === 'unlisted'
                        ? 'bg-foreground text-background border-foreground'
                        : 'bg-background text-muted-foreground border-border hover:bg-muted'
                    }`}
                  >
                    Unlisted
                  </button>
                  <button
                    onClick={() => !isTraveler && isAuthenticated && setCalendarVisibility('public')}
                    disabled={isTraveler || !isAuthenticated}
                    className={`px-3 py-2 text-sm rounded-r-md border ${
                      calendarVisibility === 'public'
                        ? 'bg-primary text-primary-foreground border-primary'
                        : (isTraveler || !isAuthenticated)
                          ? 'bg-muted text-muted-foreground border-border cursor-not-allowed'
                          : 'bg-background text-muted-foreground border-border hover:bg-muted'
                    } -ml-px`}
                    title={!isAuthenticated ? 'Sign in to create public calendars' : isTraveler ? 'Traveler accounts can only create unlisted calendars. Sign in to create public calendars' : ''}
                  >
                    Public
                  </button>
                </div>
              </div>
            )}
            
            {/* Event Name Display - Visitor mode (only when not editing) */}
            {roomHash && eventName && !isEditingSettings && (
              <div className="flex-1 flex flex-wrap items-center gap-2">
                <span className="text-lg font-semibold text-foreground">{eventName}</span>
                <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                  calendarVisibility === 'public'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-yellow-100 text-yellow-700'
                }`}>
                  {calendarVisibility === 'public' ? 'Public' : 'Unlisted'}
                </span>
                <span className="text-muted-foreground">|</span>
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <User className="w-3.5 h-3.5" />
                  {user?.roles?.some(r => r === 'admin' || r === 'moderator') ? (
                    <button
                      type="button"
                      onClick={() => navigate(`/admin/users?search=${encodeURIComponent(creatorName || creatorEmail)}`)}
                      className="flex items-center gap-1 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors cursor-pointer"
                      title="View in user list (admin)"
                    >
                      <ShieldAlert className="w-3.5 h-3.5" />
                      <span>Created by: <span className="underline decoration-dotted hover:decoration-solid">{creatorName || 'Anonymous'}</span></span>
                    </button>
                  ) : (
                    <span>Created by: {creatorName || 'Anonymous'}</span>
                  )}
                  {isCreator && (
                    <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 rounded">You</span>
                  )}
                  {!isCreator && isCreatorFriend && (
                    <span className="px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 rounded">Your friend</span>
                  )}
                </div>
              </div>
            )}
            
            {/* Create Button and Traveler Notice - Creation mode only */}
            {!roomHash && (
              <div className="flex flex-col gap-1">
                <label className="block text-sm font-medium text-foreground invisible">
                  &nbsp;
                </label>
                <button
                  onClick={handleCreateCalendar}
                  disabled={!eventName.trim() || !customStartDate || !customEndDate}
                  className="w-full sm:w-auto px-6 py-2.5 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  Create Coordination Calendar
                </button>
                
                {/* Traveler expiry notice */}
                {isTraveler && (
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 max-w-sm">
                    <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                    <p className="text-xs text-amber-700">
                      Traveler calendars expire after <strong>64 days</strong>. 
                      Sign in for permanent calendars.
                    </p>
                  </div>
                )}

                {/* Sign-in prompt for unauthenticated users */}
                {!isAuthenticated && (
                  <p className="text-xs text-muted-foreground">
                    You'll be asked to sign in or continue as Traveler
                  </p>
                )}
              </div>
            )}
          </div>

            {/* ─── Toggleable Extra Links (Community Links and Resources) ─── */}
            {roomHash && isEditingSettings && (
              <>
                <button
                  type="button"
                  onClick={() => setShowExtraLinks(prev => !prev)}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mt-1"
                >
                  {showExtraLinks ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  <LinkIcon className="w-3.5 h-3.5" />
                  <span>{showExtraLinks ? 'Hide' : 'Show'} Community Links and Resources</span>
                  {(socialLinks.twitter || socialLinks.discord || socialLinks.youtube || onboardingUrl || communityResources.some(r => r.name && r.url)) && !showExtraLinks && (
                    <span className="ml-1 w-2 h-2 rounded-full bg-primary" title="Links configured" />
                  )}
                </button>

                {showExtraLinks && (
                  <div className="flex flex-col gap-4 p-4 border border-border rounded-lg bg-card animate-in fade-in slide-in-from-top-1 duration-200">
                    {/* Community Links */}
                    <div className="flex flex-col gap-1">
                      <label className="flex items-center gap-1 text-sm font-medium">
                        Social Links
                        <LearnerHelpIcon
                          description={<><p className="font-semibold text-blue-700 dark:text-blue-300 mb-1">Community Links and Resources</p><p className="mb-1.5">These optional fields let you connect your calendar to your wider community presence.</p><p className="font-semibold text-blue-700 dark:text-blue-300 mb-1">Social Links</p><p className="mb-1.5">Add up to three social links (X/Twitter, Discord, YouTube) that appear as icons on the calendar page. Participants can click them to find your community channels. All three are optional -- leave any blank to hide it.</p><p className="font-semibold text-blue-700 dark:text-blue-300 mb-1">Community Resources</p><p className="mb-1.5">Add named links to resources for your community -- for example an onboarding guide, governance documents, or meeting prep materials. These appear as clickable links in the calendar footer.</p><p className="font-semibold text-blue-700 dark:text-blue-300 mb-1">Next Step Link</p><p>After a participant submits their availability, this link is shown as a suggested next action. If left empty, no next-step prompt is shown.</p></>}
                          size={4}
                        />
                      </label>
                      <p className="text-xs text-muted-foreground mb-1">
                        Add social links that will be shown to participants on the calendar page.
                      </p>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="url"
                          name="socialTwitterUrl"
                          value={socialLinks.twitter}
                          onChange={e => setSocialLinks(prev => ({ ...prev, twitter: e.target.value }))}
                          placeholder="X / Twitter URL"
                          className="px-3 py-2 border border-border rounded-md text-sm bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-primary w-full sm:w-56"
                        />
                        <input
                          type="url"
                          name="socialDiscordUrl"
                          value={socialLinks.discord}
                          onChange={e => setSocialLinks(prev => ({ ...prev, discord: e.target.value }))}
                          placeholder="Discord URL"
                          className="px-3 py-2 border border-border rounded-md text-sm bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-primary w-full sm:w-56"
                        />
                        <input
                          type="url"
                          name="socialYoutubeUrl"
                          value={socialLinks.youtube}
                          onChange={e => setSocialLinks(prev => ({ ...prev, youtube: e.target.value }))}
                          placeholder="YouTube URL"
                          className="px-3 py-2 border border-border rounded-md text-sm bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-primary w-full sm:w-56"
                        />
                      </div>
                    </div>

                    {/* Community Resources Table */}
                    <div className="flex flex-col gap-1">
                      <label className="block text-sm font-medium">Community Resources</label>
                      <p className="text-xs text-muted-foreground mb-1">
                        Add named links that appear in the calendar footer for participants.
                      </p>
                      <div className="flex flex-col gap-2">
                        {communityResources.map((resource, index) => (
                          <div key={index} className="flex items-center gap-2">
                            <input
                              type="text"
                              name={`communityResourceName-${index}`}
                              value={resource.name}
                              onChange={e => {
                                const updated = [...communityResources]
                                updated[index] = { ...updated[index], name: e.target.value }
                                setCommunityResources(updated)
                              }}
                              placeholder="Link name"
                              className="px-3 py-2 border border-border rounded-md text-sm bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-primary w-full sm:w-48"
                            />
                            <input
                              type="url"
                              name={`communityResourceUrl-${index}`}
                              value={resource.url}
                              onChange={e => {
                                const updated = [...communityResources]
                                updated[index] = { ...updated[index], url: e.target.value }
                                setCommunityResources(updated)
                              }}
                              placeholder="https://..."
                              className="px-3 py-2 border border-border rounded-md text-sm bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-primary w-full sm:flex-1"
                            />
                            <button
                              type="button"
                              onClick={() => setCommunityResources(prev => prev.filter((_, i) => i !== index))}
                              className="p-2 text-muted-foreground hover:text-destructive transition-colors"
                              title="Remove link"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => setCommunityResources(prev => [...prev, { name: '', url: '' }])}
                          className="flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors w-fit"
                        >
                          <Plus className="w-4 h-4" />
                          Add resource link
                        </button>
                      </div>
                    </div>

                    {/* Next Step Link for Participants */}
                    <div className="flex flex-col gap-1">
                      <label className="block text-sm font-medium">Next Step Link for Participants</label>
                      <p className="text-xs text-muted-foreground mb-1">
                        After someone submits their availability, they'll be shown this link as a suggested next step -- great for onboarding guides, community pages, or meeting prep resources.
                      </p>
                      <input
                        type="url"
                        name="onboardingUrl"
                        value={onboardingUrl}
                        onChange={e => setOnboardingUrl(e.target.value)}
                        placeholder="https://your-onboarding-or-resource-link.com"
                        className="px-3 py-2 border border-border rounded-md text-sm bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-primary w-full max-w-lg"
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          

          
          {/* Timezone Selector - Creation mode */}
          {!roomHash && (
            <TimezoneSelector timezones={tzState} />
          )}
          
          {/* Toolbar Buttons & Expandable Panels */}
          {roomHash && (savedSelections.size > 0 || isCreator) && (
            <div className="space-y-3">
              {/* Button Row */}
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                {/* Participants */}
                {savedSelections.size > 0 && (
                  <button
                    onClick={() => {
                      if (showLeftSidebar && expandedSidebarSections.has('participants')) {
                        setShowLeftSidebar(false)
                        setExpandedSidebarSections(new Set())
                      } else {
                        setShowLeftSidebar(true)
                        setExpandedSidebarSections(prev => new Set([...prev, 'participants']))
                        setLeftPanelOrder(prev => prev.includes('tools') ? prev : [...prev, 'tools'])
                      }
                    }}
                    className={`w-full sm:w-auto px-4 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                      showParticipantsPanel
                        ? 'bg-orange-100 text-orange-800 border border-orange-400 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-600'
                        : 'bg-card border border-border text-foreground hover:bg-muted'
                    }`}
                  >
                    <Users className="w-4 h-4" />
                    Participants ({getTotalParticipants()})
                  </button>
                )}

                {/* Calendar Syncs */}
                {isAuthenticated && (
                  <button
                    onClick={() => {
                      if (showLeftSidebar && expandedSidebarSections.has('calendarSyncs')) {
                        setShowLeftSidebar(false)
                        setExpandedSidebarSections(new Set())
                      } else {
                        setShowLeftSidebar(true)
                        setExpandedSidebarSections(prev => new Set([...prev, 'calendarSyncs']))
                        setLeftPanelOrder(prev => prev.includes('tools') ? prev : [...prev, 'tools'])
                      }
                    }}
                    className={`w-full sm:w-auto px-4 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                      showCalendarSyncsPanel
                        ? 'bg-blue-100 text-blue-800 border border-blue-400 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-600'
                        : 'bg-card border border-border text-foreground hover:bg-muted'
                    }`}
                  >
                    <Calendar className="w-4 h-4" />
                    Calendar Syncs
                  </button>
                )}

                {/* Settings */}
                {hasEditPermission && !isEditingSettings && (
                  <button
                    onClick={() => handleEditSettings()}
                    className="w-full sm:w-auto px-4 py-2 bg-card border border-border text-foreground rounded-lg hover:bg-muted text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                    Settings
                  </button>
                )}

                {/* Take Action - opens left sidebar with only Actions section expanded */}
                <button
                  onClick={() => {
                    if (showLeftSidebar && expandedSidebarSections.has('actions') && expandedSidebarSections.size === 1) {
                      setShowLeftSidebar(false)
                      setExpandedSidebarSections(new Set())
                    } else {
                      setShowLeftSidebar(true)
                      setExpandedSidebarSections(new Set(['actions']))
                      setLeftPanelOrder(prev => prev.includes('tools') ? prev : [...prev, 'tools'])
                    }
                  }}
                  className={`group relative w-full sm:w-auto px-4 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 text-white shadow-md transition-all duration-300 hover:opacity-90 ${
                    showActionsPanel ? 'ring-2 ring-purple-300 dark:ring-purple-700 scale-[1.02]' : ''
                  }`}
                  style={{
                    background: 'linear-gradient(135deg, #06B6D4, #3B82F6, #6366F1, #8B5CF6, #14B8A6)',
                    backgroundSize: '400% 400%',
                    animation: 'aiColorCycle 12s ease-in-out infinite',
                  }}
                >
                  <Sparkles className="w-4 h-4" />
                  <span>{isMobile ? 'Action' : 'Take Action'}</span>
                  <span className="text-[10px] font-normal text-purple-100/90 hidden sm:inline">invite and meetings</span>
                </button>
              </div>

              {/* Dynamic panels rendered below toolbar */}
              {panelOpenOrder.map(panelId => {
                if (panelId === 'suggestions' && showSuggestions && savedSelections.size >= 2) {
                  return (
                    <div key="suggestions" className="p-3 bg-card border border-border rounded-lg relative">
                      <LearnerHelpIcon
                        description={<><p className="font-semibold text-blue-700 dark:text-blue-300 mb-1">Optimal Meeting Times</p><p className="mb-1.5">The system analyzes all participants' availability and ranks the best time slots by maximum attendance.</p><p className="font-semibold text-blue-700 dark:text-blue-300 mb-1">How it works</p><ul className="list-disc list-inside space-y-0.5"><li>Suggestions appear once <strong>2 or more</strong> participants have responded.</li><li>Each suggestion shows how many people can attend.</li><li><strong>Click a suggestion</strong> to create a confirmed meeting at that time.</li></ul></>}
                        size={4}
                        className="absolute top-2 right-2 z-10"
                      />
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-semibold text-foreground">
                          Optimal Meeting Times
                        </h3>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-xs font-medium text-foreground">Suggested Meetings:</div>
                          <button
                            onClick={clearSuggestions}
                            className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                          >
                            Close
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-3 max-h-[300px] overflow-y-auto">
                          {suggestedMeetings.map((meeting) => {
                            const [dateStr, timeStr] = meeting.cellId.split('_')
                            const meetingDate = parse(dateStr, 'yyyy-MM-dd', new Date())
                            return (
                              <div 
                                key={meeting.id} 
                                className="text-xs p-2 bg-card border-2 rounded"
                                style={{ borderColor: meeting.color, minWidth: '180px', maxWidth: '220px' }}
                              >
                                <div className="font-semibold flex items-center gap-1">
                                  <span 
                                    className="w-3 h-3 rounded-full inline-block"
                                    style={{ backgroundColor: meeting.color }}
                                  />
                                  Meeting {meeting.id}
                                </div>
                                <div className="text-muted-foreground mt-1">
                                  {format(meetingDate, 'EEE, MMM d')} at {timeStr}
                                </div>
                                <div className="text-muted-foreground mt-1">
                                  {meeting.participants.length} participant{meeting.participants.length > 1 ? 's' : ''}:
                                </div>
                                <div className="mt-1 space-y-0.5">
                                  {meeting.participants.map(p => (
                                    <div key={p} className="text-foreground">- {p}</div>
                                  ))}
                                </div>
                                {isCreator && (
                                  <button
                                    onClick={() => {
                                      setPendingMeetingCellId(meeting.cellId)
                                      setShowMeetingSidePanel(true)
                                      setIsCreatingMeeting(true)
                                      setMeetingFormData(createEmptyMeetingFormData())
                                      setShowRecurrencePanel(false)
                                      const [dateStr, timeStr] = meeting.cellId.split('_')
                                      const [hours, minutes] = timeStr.split(':').map(Number)
                                      const startMinutes = hours * 60 + minutes
                                      const cellsToSelect = new Set<string>()
                                      for (let m = startMinutes; m < startMinutes + 60; m += timeInterval) {
                                        const h = Math.floor(m / 60)
                                        const min = m % 60
                                        cellsToSelect.add(`${dateStr}_${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`)
                                      }
                                      setMeetingCreationSelection(cellsToSelect)
                                      setLeftPanelOrder(prev => prev.includes('meetingForm') ? prev : [...prev, 'meetingForm'])
                                    }}
                                    className="mt-2 w-full px-2 py-1 bg-green-600 text-white text-xs font-medium rounded hover:bg-green-700 transition-colors flex items-center justify-center gap-1"
                                  >
                                    <Check className="w-3 h-3" />
                                    Confirm This Time
                                  </button>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  )
                }
                if (panelId === 'createMeeting') {
                  return null // Moved to left sidebar
                }
                return null
              })}


            </div>
          )}

          {/* Confirmed Meetings - Visitor mode */}
          {roomHash && confirmedMeetings.length > 0 && (
            <div ref={confirmedMeetingsRef} className="bg-card border border-amber-300 dark:border-amber-700 rounded-lg overflow-hidden">
              <button
                onClick={() => setShowConfirmedMeetings(!showConfirmedMeetings)}
                className="w-full px-3 py-2.5 flex items-center justify-between hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-colors"
              >
                <h3 className="text-sm font-bold text-amber-800 dark:text-amber-300 flex items-center gap-2">
                  <Check className="w-4 h-4" />
                  Confirmed Meetings ({confirmedMeetings.length})
                </h3>
                <div className="flex items-center gap-2">
                  {hasExportTargets && selectedMeetingsForExport.size > 0 && showConfirmedMeetings && (
                    <span className="text-[10px] text-blue-600 font-medium">{selectedMeetingsForExport.size} selected</span>
                  )}
                  {showConfirmedMeetings ? <ChevronUp className="w-4 h-4 text-amber-600" /> : <ChevronDown className="w-4 h-4 text-amber-600" />}
                </div>
              </button>
              {showConfirmedMeetings && (
                <div className="p-3 border-t border-amber-200 dark:border-amber-800">
                  <div className="flex items-center justify-end mb-3">
                {hasExportTargets && selectedMeetingsForExport.size > 0 && (
                  <button 
                    onClick={async () => {
                      setIsExporting(true)
                      try {
                        const meetingsToExport = confirmedMeetings.filter((_, i) => selectedMeetingsForExport.has(i))
                        const targetSourceIds = checkedExportableSources.map(s => s.id)
                        const response = await apiClient.post('/api/calendar-sources/export', {
                          calendarHash: roomHash,
                          meetingIndices: Array.from(selectedMeetingsForExport),
                          meetings: meetingsToExport.map(m => ({
                            cellId: m.cellId,
                            meetingLink: m.meetingLink,
                            description: m.description,
                            duration: m.duration,
                            title: resolveMeetingTitle({ title: m.title, calendarTitle: eventName || calendarTitle || 'Meeting' }),
                            recurrenceRule: m.recurrenceRule || null
                          })),
                          targetSourceIds,
                        })
                        setSelectedMeetingsForExport(new Set())
                        const { totalCreated, totalFailed, results } = response.data
                        // Collect detailed error messages from the backend
                        const allErrors: string[] = (results || []).flatMap((r: { errors?: string[] }) => r.errors || [])
                        let msg: string
                        if (totalFailed > 0 && allErrors.length > 0) {
                          msg = `Exported ${totalCreated} event(s) to Google Calendar (${totalFailed} failed).\n\nErrors:\n${allErrors.join('\n')}`
                        } else if (totalFailed > 0) {
                          msg = `Exported ${totalCreated} event(s) to Google Calendar (${totalFailed} failed).`
                        } else {
                          msg = `Successfully exported ${totalCreated} event(s) to Google Calendar!`
                        }
                        showToast(msg, totalFailed > 0 ? 'error' : 'success')
                      } catch (err) {
                        console.error('Export failed:', err)
                        showToast((err as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to export meetings to Google Calendar.', 'error')
                      } finally {
                        setIsExporting(false)
                      }
                    }}
                    disabled={isExporting}
                    className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 transition-colors flex items-center gap-1 disabled:opacity-50"
                  >
                    <ExternalLink className="w-3 h-3" />
                    {isExporting ? 'Exporting...' : `Export ${selectedMeetingsForExport.size} to Calendar`}
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-3">
                {getSortedMeetings().map((meeting, sortedIndex) => {
                  const [dateStr, timeStr] = meeting.cellId.split('_')
                  const meetingDate = parse(dateStr, 'yyyy-MM-dd', new Date())
                  const originalIndex = meeting.originalIndex
                  const isSelected = selectedMeetingsForExport.has(originalIndex)
                  const isPast = meeting.isPast
                  const isPastInActiveWeek = meeting.isPastInActiveWeek
                  const _isUpcomingFutureWeek = meeting.isUpcomingFutureWeek
                  const isEditingThis = editingMeetingIndex === originalIndex && showMeetingSidePanel
                  const trimmedCalendarName = (eventName || calendarTitle || 'Meeting').trim()
                  const trimmedMeetingTitle = meeting.title?.trim() || ''
                  const trimmedMeetingDescription = meeting.description?.trim() || ''
                  const hasCustomMeetingName =
                    trimmedMeetingTitle.length > 0
                    && trimmedMeetingTitle !== trimmedCalendarName
                    && trimmedMeetingTitle !== trimmedMeetingDescription
                  const meetingDisplayTitle = resolveMeetingTitle({
                    title: meeting.title,
                    calendarTitle: eventName || calendarTitle || 'Meeting',
                  })
                  const shouldShowDescription =
                    trimmedMeetingDescription.length > 0
                    && trimmedMeetingDescription !== meetingDisplayTitle.trim()
                  return (
                    <div 
                      key={originalIndex}
                      data-meeting-card={originalIndex}
                      onClick={() => {
                        if (isCreator) {
                          // Toggle off when clicking the already-open meeting card
                          if (isEditingThis) {
                            setShowMeetingSidePanel(false)
                            setPendingMeetingCellId(null)
                            setEditingMeetingIndex(null)
                            setMeetingFormData(createEmptyMeetingFormData())
                            setIsCreatingMeeting(false)
                            setMeetingCreationSelection(new Set())
                            setLeftPanelOrder(prev => prev.filter(p => p !== 'meetingForm'))
                            return
                          }
                          setEditingMeetingIndex(originalIndex)
                          setPendingMeetingCellId(meeting.cellId)
                          setMeetingFormData({
                            title: getMeetingEditorTitle(meeting, eventName || calendarTitle || ''),
                            meetingLink: meeting.meetingLink,
                            description: meeting.description,
                            duration: meeting.duration,
                            recurrenceRule: meeting.recurrenceRule || { type: 'none' }
                          })
                          setShowMeetingSidePanel(true)
                          setIsCreatingMeeting(true)
                          const [hours, minutes] = timeStr.split(':').map(Number)
                          const startMinutes = hours * 60 + minutes
                          const cellsToSelect = new Set<string>()
                          for (let m = startMinutes; m < startMinutes + meeting.duration; m += timeInterval) {
                            const h = Math.floor(m / 60)
                            const min = m % 60
                            cellsToSelect.add(`${dateStr}_${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`)
                          }
                          setMeetingCreationSelection(cellsToSelect)
                          setLeftPanelOrder(prev => prev.includes('meetingForm') ? prev : [...prev, 'meetingForm'])
                        } else if (meeting.id) {
                          navigate(`/meeting/${meeting.id}`)
                        }
                      }}
                      className={`p-3 border-2 rounded-lg flex-shrink-0 relative cursor-pointer transition-all duration-200 hover:shadow-lg hover:scale-[1.02] flex flex-col ${
                        isEditingThis
                          ? 'editing-meeting-card bg-blue-50 dark:bg-blue-900/25'
                          : isPast
                            ? 'bg-amber-50 border-amber-200 dark:border-amber-900/70 opacity-75 hover:opacity-100 hover:border-amber-400'
                            : isSelected
                              ? 'bg-blue-50 border-blue-500 hover:border-amber-400 dark:hover:border-amber-500'
                              : 'bg-amber-50 border-amber-300 hover:border-amber-400 dark:hover:border-amber-500'
                      }`}
                      style={{ width: '220px' }}
                    >
                      {isCreator && (
                        <div className="absolute top-2 right-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); setMeetingDeleteIndex(meetingDeleteIndex === originalIndex ? null : originalIndex) }}
                            className="p-1 text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 rounded transition-colors"
                            title="Delete meeting"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          {meetingDeleteIndex === originalIndex && (
                            <div
                              ref={meetingDeleteRef}
                              onClick={(e) => e.stopPropagation()}
                              className="absolute right-0 top-full mt-1 w-56 bg-card text-card-foreground rounded-lg p-3 shadow-xl border border-border z-50"
                            >
                              <p className="text-xs text-muted-foreground mb-2">Delete this meeting? This cannot be undone.</p>
                              <div className="flex gap-2 justify-end">
                                <button
                                  onClick={(e) => { e.stopPropagation(); setMeetingDeleteIndex(null) }}
                                  className="px-2.5 py-1 text-xs font-medium text-muted-foreground bg-muted rounded-md hover:bg-muted/80 transition-colors"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation()
                                    const meetingToDelete = confirmedMeetings[originalIndex]
                                    if (meetingToDelete?.id) {
                                      try {
                                        await apiClient.delete(`/api/meetings/${meetingToDelete.id}`)
                                      } catch (error) {
                                        console.error('Error deleting meeting:', error)
                                        alert('Failed to delete meeting from database')
                                        return
                                      }
                                    }
                                    setConfirmedMeetings(prev => prev.filter((_, i) => i !== originalIndex))
                                    setMeetingDeleteIndex(null)
                                  }}
                                  className="px-2.5 py-1 text-xs font-medium text-white bg-red-600 rounded-md hover:bg-red-700 transition-colors"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="space-y-2">
                        <div className="flex items-start gap-2">
                          {hasExportTargets && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => {
                                setSelectedMeetingsForExport(prev => {
                                  const next = new Set(prev)
                                  if (e.target.checked) {
                                    next.add(originalIndex)
                                  } else {
                                    next.delete(originalIndex)
                                  }
                                  return next
                                })
                              }}
                              className="mt-1 w-4 h-4 rounded border-border text-primary focus:ring-primary"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start gap-2 min-w-0">
                              <span className={`text-white text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                isPastInActiveWeek
                                  ? 'bg-amber-800 dark:bg-amber-700'
                                  : 'bg-amber-500'
                              }`}>
                                {sortedIndex + 1}
                              </span>
                              {!hasCustomMeetingName && (
                                <span className={`shrink-0 text-xs font-medium ${
                                  isPastInActiveWeek
                                    ? 'text-foreground/80'
                                    : 'text-foreground/70'
                                }`}>Meeting</span>
                              )}
                              <span
                                className={`min-w-0 flex-1 overflow-hidden text-sm font-extrabold leading-tight ${
                                  isEditingThis ? 'text-blue-50' : 'text-slate-900'
                                }`}
                                title={meetingDisplayTitle}
                                style={{
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  overflowWrap: 'break-word',
                                  wordBreak: 'break-word',
                                }}
                              >
                                {meetingDisplayTitle}
                              </span>
                              {isPast && (
                                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-600 dark:bg-amber-700 text-white">
                                  Past
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-amber-900 font-semibold mt-1">
                              {format(meetingDate, 'EEE, MMM d, yyyy')}
                            </div>
                            <div className="text-sm text-amber-900">
                              at {formatTimeWithPeriod(timeStr)}
                            </div>
                            <div className="text-xs text-amber-700 mt-0.5">
                              Duration: {meeting.duration} min
                            </div>
                            {meeting.recurrenceRule && meeting.recurrenceRule.type !== 'none' && (
                              <div className="flex items-center gap-1 mt-0.5">
                                <Repeat2 className="w-3 h-3 text-blue-500" />
                                <span className="text-[10px] text-blue-600 font-medium">
                                  {meeting.recurrenceRule.type === 'weekly' ? 'Weekly' :
                                   meeting.recurrenceRule.type === 'biweekly' ? 'Bi-weekly' :
                                   meeting.recurrenceRule.type === 'monthly' ? 'Monthly' :
                                   `Every ${meeting.recurrenceRule.interval || 1} ${meeting.recurrenceRule.unit || 'week'}(s)`}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                        {isSafeUrl(meeting.meetingLink) && (
                          <div className={hasExportTargets ? 'pl-6 min-w-0' : 'min-w-0'}>
                            <a 
                              href={meeting.meetingLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-xs text-blue-600 hover:text-blue-700 underline flex items-center gap-1 max-w-full"
                            >
                              <LinkIcon className="w-3 h-3 shrink-0" />
                              <span className="truncate">{meeting.meetingLink}</span>
                            </a>
                          </div>
                        )}
                        {shouldShowDescription && (
                          <div className={hasExportTargets ? 'pl-6 min-w-0' : 'min-w-0'}>
                            <div className="text-xs text-amber-700 flex items-start gap-1 min-w-0 leading-snug">
                              <FileText className="w-3 h-3 mt-0.5 shrink-0" />
                              <span
                                className="min-w-0 overflow-hidden"
                                style={{
                                  display: '-webkit-box',
                                  WebkitLineClamp: 1,
                                  WebkitBoxOrient: 'vertical',
                                  overflowWrap: 'break-word',
                                  wordBreak: 'break-word',
                                }}
                              >
                                {meeting.description}
                              </span>
                            </div>
                          </div>
                        )}
                        {meeting.id && (
                          <div className="mt-auto pt-2">
                            <Link
                              to={`/meeting/${meeting.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center justify-center gap-1 w-full px-2 py-1.5 text-[10px] font-medium text-blue-600 bg-blue-50 dark:bg-blue-950/30 rounded hover:bg-blue-100 dark:hover:bg-blue-950/50 transition-colors"
                              title="Open meeting page (middle-click for new tab)"
                            >
                              <ExternalLink className="w-3 h-3" />
                              Meeting Page
                            </Link>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
                </div>
              )}
            </div>
          )}

          {/* Username Field - Visitor mode only */}
          {roomHash && (
            <div className="flex flex-col gap-2">
              <div ref={actionControlsRowRef} className="flex flex-col md:flex-row md:flex-nowrap gap-2 md:gap-4 md:items-end">
                <div className="flex flex-col gap-1 flex-1 min-w-[12rem] max-w-[18rem] lg:max-w-[20rem]">
                  <label className="text-sm font-medium text-foreground flex items-center gap-2">
                    Your Name
                    <LearnerHelpIcon
                      description={<><p className="font-semibold text-blue-700 dark:text-blue-300 mb-1">Mark Your Availability</p><p className="mb-1.5">Let the group know when you're free by selecting time slots on the grid.</p><p className="font-semibold text-blue-700 dark:text-blue-300 mb-1">How to participate</p><ol className="list-decimal list-inside space-y-0.5"><li>Enter your <strong>name</strong> in the text field.</li><li><strong>Click and drag</strong> on the grid to select your available times.</li><li>Click <strong>Add Selected Availability</strong> to save.</li></ol><p className="mt-1.5">Others will see when you're free, and the system uses this to suggest the best meeting times.</p></>}
                      size={4}
                    />
                    {isAuthenticated && user?.displayName && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setUsername(user.displayName!)
                          setLoadError('')
                        }}
                        className="text-xs text-purple-500 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300 underline font-normal"
                      >
                        Use "{user.displayName}"
                      </button>
                    )}
                    {selectedParticipants.size > 0 && Array.from(selectedParticipants)
                      .filter(name => name !== username.trim() && !(isAuthenticated && user?.displayName && name === user.displayName))
                      .map(name => (
                        <button
                          key={name}
                          type="button"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setUsername(name)
                            setLoadError('')
                          }}
                          className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 underline font-normal"
                        >
                          Use "{name}"
                        </button>
                      ))}
                  </label>
                  <input
                    type="text"
                    name="participantName"
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value)
                      setLoadError('') // Clear error when typing
                    }}
                    placeholder="Enter your name..."
                    className="px-3 py-2 border border-border rounded-md text-sm bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-primary"
                  />
                </div>
                <div className="flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center gap-2 flex-1 min-w-0">
                  {/* Contextual guidance messages */}
                  {!username.trim() && currentSelection.size === 0 && (
                    <p className="text-sm text-muted-foreground italic">
                      Enter your name to associate with the time and date selections below.
                    </p>
                  )}
                  {username.trim() && currentSelection.size === 0 && (
                    <p className="text-sm text-muted-foreground italic">
                      Select your preferred dates and times on the calendar below.
                    </p>
                  )}
                  {/* ADD or REMOVE Selected Availability - only shown when there is a selection */}
                  {currentSelection.size > 0 && (
                    <div className="flex w-full sm:w-auto flex-wrap items-center gap-2">
                      <button
                        onClick={handleAddAvailability}
                        disabled={!username.trim()}
                        className="w-full sm:w-auto px-3 md:px-4 py-2.5 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm"
                      >
                        Add
                      </button>
                      <span className="text-sm text-muted-foreground">or</span>
                      <button
                        onClick={handleClearSelectedAvailability}
                        disabled={!username.trim()}
                        className="w-full sm:w-auto px-3 md:px-4 py-2.5 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm"
                      >
                        Remove
                      </button>
                      <span className="text-sm text-foreground font-medium">Selected Availability</span>
                    </div>
                  )}
                  {/* AI Assistant, Create Meeting Time & Import button - right aligned */}
                  {isAuthenticated && (
                    <div className="ml-auto flex items-center gap-2 shrink-0 flex-nowrap">
                      {roomHash && isCreator && currentSelection.size > 0 && !isCreatingMeeting && (
                        <button
                          onClick={() => {
                            const singleDayRange = analyzeSingleDaySelection(currentSelection)
                            if (singleDayRange) {
                              setIsCreatingMeeting(true)
                              setMeetingCreationSelection(new Set(currentSelection))
                              setPendingMeetingCellId(singleDayRange.startCellId)
                              setMeetingFormData({ ...createEmptyMeetingFormData(), duration: singleDayRange.durationMinutes })
                              setShowMeetingSidePanel(true)
                              setShowRecurrencePanel(false)
                              setLeftPanelOrder(prev => prev.includes('meetingForm') ? prev : [...prev, 'meetingForm'])
                            } else {
                              // Multi-day or non-contiguous: still convert the selection.
                              // Pick the earliest cell as the anchor.
                              const earliestCell = Array.from(currentSelection).sort()[0]
                              const inferredDuration = currentSelection.size * timeInterval
                              setIsCreatingMeeting(true)
                              setMeetingCreationSelection(new Set(currentSelection))
                              setPendingMeetingCellId(earliestCell)
                              setMeetingFormData({ ...createEmptyMeetingFormData(), duration: inferredDuration })
                              setShowMeetingSidePanel(true)
                              setShowRecurrencePanel(false)
                              setShowLeftSidebar(true)
                              setLeftPanelOrder(prev => prev.includes('meetingForm') ? prev : [...prev, 'meetingForm'])
                            }
                          }}
                          className={`flex items-center gap-2 ${useCompactButtonPadding ? 'px-2.5' : 'px-3'} py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-all shrink-0`}
                          title="Create Meeting Time"
                        >
                          <CalendarPlus className="w-4 h-4" />
                          {createMeetingButtonText && <span>{createMeetingButtonText}</span>}
                        </button>
                      )}
                      <button
                        onClick={() => window.dispatchEvent(new CustomEvent('openAiPanel'))}
                        className={`rounded-lg text-sm font-medium flex items-center gap-2 transition-all hover:opacity-90 shrink-0 ${useCompactButtonPadding ? 'px-2.5 py-2' : 'px-3 py-2'}`}
                        style={{
                          background: 'linear-gradient(135deg, #8B5CF6, #6366F1, #3B82F6, #06B6D4)',
                          backgroundSize: '400% 400%',
                          animation: 'aiColorCycle 12s ease-in-out infinite',
                          color: 'white',
                        }}
                        title="Open AI assistant"
                      >
                        {aiSending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Sparkles className="w-4 h-4" />
                        )}
                        {aiAssistantButtonText && <span>{aiAssistantButtonText}</span>}
                      </button>
                      {hasPastAvailability && (
                        <button
                          onClick={() => setShowImportModal(true)}
                          className={`bg-indigo-600 text-white rounded-md hover:bg-indigo-700 font-medium text-sm flex items-center gap-1.5 shrink-0 ${importButtonText ? (useCompactButtonPadding ? 'px-2.5 py-2' : 'px-3 md:px-4 py-2') : 'w-9 h-9 px-0 justify-center'}`}
                          title="Import"
                        >
                          <Calendar className="w-4 h-4" />
                          {importButtonText && <span>{importButtonText}</span>}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {loadError && (
                <div className="text-sm text-red-600">
                  Username <span className="font-bold">{username}</span> has no saved availability
                </div>
              )}
              {unmarkedWeeksWarning && (
                <div ref={unmarkedWarningRef} className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
                    Some weeks in your availability range have no time slots marked.
                    {unmarkedWeeksWarning.direction === 'prev' && ' Use the Previous button to navigate to them.'}
                    {unmarkedWeeksWarning.direction === 'next' && ' Use the Next button to navigate to them.'}
                    {unmarkedWeeksWarning.direction === 'both' && ' Use the Previous/Next buttons to navigate to them.'}
                  </span>
                </div>
              )}
              {!isAuthenticated && (
                <p className="text-xs text-muted-foreground">
                  This creates a temporary username. For a verified username, please log in (coming soon).
                </p>
              )}
            </div>
          )}
          
          {/* AI Notification: Availability Range & Skip Days group */}
          {!roomHash && aiNotifications?.availabilityRange && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-purple-200 dark:border-purple-800 text-sm"
              style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.08), rgba(99,102,241,0.06), rgba(59,130,246,0.04))' }}
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-500 shrink-0" />
              <span className="text-foreground flex-1">{aiNotifications.availabilityRange}</span>
              <button onClick={() => setAiNotifications(prev => prev ? { ...prev, availabilityRange: undefined } : null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Availability Range - Creation mode or editing settings */}
          {(!roomHash || isEditingSettings) && (
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-foreground">Availability Range</label>
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <label className="text-sm text-muted-foreground">From:</label>
                  <input
                    type="date"
                    name="availabilityStartDate"
                    value={customStartDate}
                    onChange={(e) => handleCustomDateChange('start', e.target.value)}
                    min={format(MIN_DATE, 'yyyy-MM-dd')}
                    max={format(MAX_DATE, 'yyyy-MM-dd')}
                    className="px-3 py-1 border border-border rounded-md text-sm bg-background text-foreground"
                  />
                  {!hideDateNumbers && (
                    <button
                      type="button"
                      onClick={() => {
                        if (isStartDateLocked) {
                          setIsStartDateLocked(false)
                          setIsEndDateLocked(false)
                        } else {
                          setIsStartDateLocked(true)
                        }
                      }}
                      className={`px-2 py-1 text-xs rounded-md border transition-colors ${
                        isStartDateLocked
                          ? 'bg-emerald-100 text-emerald-700 border-emerald-300 hover:bg-emerald-200'
                          : 'bg-card text-muted-foreground border-border hover:bg-muted'
                      }`}
                    >
                      {isStartDateLocked ? 'From Locked' : 'Lock From'}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm text-muted-foreground">To:</label>
                  <input
                    type="date"
                    name="availabilityEndDate"
                    value={customEndDate}
                    onChange={(e) => handleCustomDateChange('end', e.target.value)}
                    min={format(MIN_DATE, 'yyyy-MM-dd')}
                    max={format(MAX_DATE, 'yyyy-MM-dd')}
                    className="px-3 py-1 border border-border rounded-md text-sm bg-background text-foreground"
                  />
                  {!hideDateNumbers && (
                    <button
                      type="button"
                      disabled={!isStartDateLocked}
                      onClick={() => {
                        if (!isStartDateLocked) return
                        setIsEndDateLocked(prev => !prev)
                      }}
                      className={`px-2 py-1 text-xs rounded-md border transition-colors ${
                        !isStartDateLocked
                          ? 'bg-muted text-muted-foreground border-border cursor-not-allowed'
                          : isEndDateLocked
                            ? 'bg-emerald-100 text-emerald-700 border-emerald-300 hover:bg-emerald-200'
                            : 'bg-card text-muted-foreground border-border hover:bg-muted'
                      }`}
                    >
                      {isEndDateLocked ? 'To Locked' : 'Lock To'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Calendar Section with Frame */}
      <div className="border border-border rounded-lg p-2 md:p-4 mb-3 md:mb-6 bg-card shadow-sm">
        {/* AI Notification: Calendar Params group */}
        {!roomHash && aiNotifications?.calendarParams && (
          <div className="flex items-center gap-2 px-3 py-2 mb-2 rounded-lg border border-purple-200 dark:border-purple-800 text-sm"
            style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.08), rgba(99,102,241,0.06), rgba(59,130,246,0.04))' }}
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-500 shrink-0" />
            <span className="text-foreground flex-1">{aiNotifications.calendarParams}</span>
            <button onClick={() => setAiNotifications(prev => prev ? { ...prev, calendarParams: undefined } : null)} className="text-muted-foreground hover:text-foreground">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Navigation */}
        <div className="flex flex-row items-center justify-between gap-2 mb-2 md:mb-4">
          <div className="flex items-center gap-1 md:gap-2">
            {/* Date Display Toggle - Creation mode or editing settings, left side */}
            {(!roomHash || isEditingSettings) && (
              <div className="flex items-center">
                <button
                  onClick={() => setHideDateNumbers(false)}
                  className={`px-2 md:px-2.5 py-1.5 md:py-2 text-[10px] md:text-xs rounded-l-md border ${
                    !hideDateNumbers
                      ? 'bg-foreground text-background border-foreground'
                      : 'bg-card text-muted-foreground border-border hover:bg-muted'
                  }`}
                >
                  Dates
                </button>
                <button
                  onClick={() => setHideDateNumbers(true)}
                  className={`px-2 md:px-2.5 py-1.5 md:py-2 text-[10px] md:text-xs rounded-r-md border -ml-px ${
                    hideDateNumbers
                      ? 'bg-foreground text-background border-foreground'
                      : 'bg-card text-muted-foreground border-border hover:bg-muted'
                  }`}
                  title="Hide date numbers to represent a generic/any week"
                >
                  Any Week
                </button>
              </div>
            )}
            {!hideDateNumbers && (
              <button
                ref={prevButtonRef}
                onClick={handlePreviousWeek}
                disabled={isPreviousDisabled}
                className={`flex items-center gap-1 px-2 md:px-4 py-1.5 md:py-2 bg-card border rounded-md hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed text-xs md:text-sm ${
                  unmarkedWeeksWarning && (unmarkedWeeksWarning.direction === 'prev' || unmarkedWeeksWarning.direction === 'both')
                    ? 'border-amber-400 dark:border-amber-500 animate-unmarked-pulse'
                    : 'border-border'
                }`}
              >
                <ChevronLeft className="w-4 h-4" />
                <span className="hidden md:inline">Previous</span>
                <span className="md:hidden">Prev</span>
              </button>
            )}
          </div>
          <div className="text-center">
            {hideDateNumbers ? (
              <div className="text-[11px] md:text-sm text-muted-foreground">
                General weekly availability  — not tied to a specific week
              </div>
            ) : (
              <>
                <div className="text-[10px] md:text-xs text-muted-foreground">Week Range</div>
                <div className="text-[11px] md:text-sm font-medium text-foreground">
                  {format(currentWeekStart, 'MMM d')} – {format(addDays(currentWeekStart, 6), 'MMM d, yyyy')}
                </div>
              </>
            )}
          </div>
          <div className="flex gap-1 md:gap-2">
            {!hideDateNumbers && (
              <>
                <button
                  onClick={handleToday}
                  className="px-2 md:px-4 py-1.5 md:py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-xs md:text-sm"
                >
                  Today
                </button>
                <button
                  ref={nextButtonRef}
                  onClick={handleNextWeek}
                  disabled={isNextDisabled}
                  className={`flex items-center gap-1 px-2 md:px-4 py-1.5 md:py-2 bg-card border rounded-md hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed text-xs md:text-sm ${
                    unmarkedWeeksWarning && (unmarkedWeeksWarning.direction === 'next' || unmarkedWeeksWarning.direction === 'both')
                      ? 'border-amber-400 dark:border-amber-500 animate-unmarked-pulse'
                      : 'border-border'
                  }`}
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Time Controls - Above Calendar (Mobile Only - Creation Mode or Editing) */}
        {(!roomHash || isEditingSettings) && isMobile && (
          <div className="bg-card border border-border rounded-lg p-3 mb-2">
                <div className="flex items-center gap-2 mb-3">
                  <label className="text-xs font-medium text-foreground">Interval:</label>
                  <select
                    name="mobileTimeInterval"
                    value={timeInterval}
                    onChange={(e) => setTimeInterval(Number(e.target.value) as TimeInterval)}
                    className="px-2 py-1 border border-border rounded text-xs bg-background text-foreground"
                  >
                    <option value={60}>1 hour</option>
                    <option value={30}>30 min</option>
                    <option value={15}>15 min</option>
                  </select>
                </div>
                
                {/* Dual-Thumb Hour Slider */}
                <DualThumbSlider
                  min={0}
                  max={24}
                  startValue={displayStartHour}
                  endValue={displayEndHour}
                  onStartChange={handleStartHourSlider}
                  onEndChange={handleEndHourSlider}
                  onStartRelease={releaseStartHourSlider}
                  onEndRelease={releaseEndHourSlider}
                  orientation="horizontal"
                  startLabel={`Start: ${displayStartHour.toString().padStart(2, '0')}:00`}
                  endLabel={`End: ${displayEndHour.toString().padStart(2, '0')}:00`}
                />
          </div>
        )}

        {/* Calendar Grid with Desktop Time Sidebar */}
        <div className="flex-1 flex flex-col md:flex-row gap-2 md:gap-6 overflow-hidden" onPointerUp={handlePointerEnd} onPointerCancel={handlePointerEnd} onPointerLeave={handlePointerEnd}>
          {/* Desktop Time Controls - Vertical Sidebar */}
          {(!roomHash || isEditingSettings) && !isMobile && (
            <div className="relative" style={{ minWidth: '200px' }}>
              <div className="sticky top-4 flex flex-col gap-4 p-4 bg-card border border-border rounded-lg relative" style={{ maxHeight: 'calc(100vh - 240px)' }}>
              <LearnerHelpIcon
                description={<><p className="font-semibold text-blue-700 dark:text-blue-300 mb-1">Time Controls</p><p className="mb-1.5">Customize how the calendar grid displays time slots.</p><ul className="list-disc list-inside space-y-0.5"><li><strong>Time Interval</strong>  — set the granularity of each slot (e.g. 15 min, 30 min, 1 hour).</li><li><strong>Hour Range</strong>  — narrow the visible hours to focus on your preferred meeting window, such as business hours only.</li></ul><p className="mt-1.5">These settings apply to all participants viewing the calendar.</p></>}
                size={4}
                className="absolute top-2 right-2 z-10"
              />
              {/* Time Interval Dropdown */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Time Interval
                </label>
                <select
                  name="desktopTimeInterval"
                  value={timeInterval}
                  onChange={(e) => setTimeInterval(Number(e.target.value) as TimeInterval)}
                  className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background text-foreground"
                >
                  <option value={60}>1 Hour</option>
                  <option value={30}>30 Minutes</option>
                  <option value={15}>15 Minutes</option>
                </select>
              </div>

              {/* Dual-Thumb Hour Slider */}
              <DualThumbSlider
                min={0}
                max={24}
                startValue={displayStartHour}
                endValue={displayEndHour}
                onStartChange={handleStartHourSlider}
                onEndChange={handleEndHourSlider}
                onStartRelease={releaseStartHourSlider}
                onEndRelease={releaseEndHourSlider}
                orientation="vertical"
                startLabel={`Start: ${displayStartHour.toString().padStart(2, '0')}:00`}
                endLabel={`End: ${displayEndHour.toString().padStart(2, '0')}:00`}
              />
            </div>
            </div>
          )}
          <div className="relative flex-1 flex flex-col min-h-0 min-w-0">
            {/* Timezone Selector - above grid */}
            {roomHash && (
              <div className="mb-1">
                <TimezoneSelector timezones={tzState} compact />
              </div>
            )}
            {/* Mobile Day Pager - Only show in portrait when not all days visible */}
            {isMobile && MOBILE_DAYS_COUNT < 7 && mobileEligibleDays.length > MOBILE_DAYS_COUNT && (
              <div className="flex items-center justify-between px-2 py-1.5 bg-card border border-border rounded-lg mb-1">
                <button
                  onClick={() => setMobileDayOffset(Math.max(0, mobileDayOffset - 1))}
                  disabled={mobileDayOffset === 0}
                  className="p-1 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs font-medium text-foreground">
                  {format(visibleDays[0], 'EEE d')} – {format(visibleDays[visibleDays.length - 1], 'EEE d MMM')}
                </span>
                <button
                  onClick={() => setMobileDayOffset(Math.min(mobileMaxOffset, mobileDayOffset + 1))}
                  disabled={mobileDayOffset >= mobileMaxOffset}
                  className="p-1 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
            {/* Time Slots - Scrollable Container (includes sticky headers) */}
            <div 
              ref={calendarGridRef}
              className="relative overflow-auto flex-1 calendar-grid-scroll transition-shadow duration-300"
              style={{ 
                maxHeight: isMobile ? 'calc(100vh - 280px)' : undefined,
                minHeight: '200px'
              }}
            >
              {/* Min-width wrapper - only on desktop */}
              <div style={{ minWidth: isMobile ? undefined : '640px' }}>
          {/* Day Headers - Sticky inside scroll container */}
          <div className="sticky top-0 z-20 bg-card border-b border-border">
              {/* Skip Day Buttons - Creation Mode or Editing Settings */}
              {(!roomHash || isEditingSettings) && (
                <div className="grid border-b border-border/50" style={gridStyle}>
                  {/* Empty cells for timezone columns */}
                  {tzColumns.map((col, colIdx) => (
                    <div key={`skip-tz-${col.iana}-${colIdx}`} className={`p-1 ${colIdx === tzColumns.length - 1 ? '' : 'border-r border-border/50'}`}></div>
                  ))}
                  {daySlots.map((slot, slotIdx) => {
                    if (slot.type === 'dst') {
                      return <div key={`skip-dst-${slot.transition.iana}-${slotIdx}`} className="border-l border-amber-400/50"></div>
                    }
                    const day = slot.day
                    const isSkipped = isDaySkipped(day)
                    
                    return (
                      <div key={`skip-${day.toISOString()}`} className="border-l border-border p-1 flex justify-center">
                        <button
                          onClick={() => toggleSkipDay(day)}
                          className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                            isSkipped
                              ? 'bg-red-100 text-red-700 hover:bg-red-200'
                              : 'bg-muted text-muted-foreground hover:bg-muted/80'
                          }`}
                        >
                          {isSkipped ? 'Skipped' : 'Skip Day'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
              
              {/* Day Names and Dates */}
              <div className="grid" style={gridStyle}>
                {/* Timezone column headers */}
                {tzColumns.map((col, colIdx) => {
                  const isPrimary = col.iana === tzState.primary
                  const isUtc = col.iana === 'UTC'
                  const entry = findTimezone(col.iana)
                  const label = isUtc ? 'UTC' : (entry ? entry.city : col.iana)
                  const abbr = isUtc ? '' : (entry ? entry.abbr : '')

                  const currentTime = isUtc
                    ? `${utcNow.getUTCHours().toString().padStart(2, '0')}:${utcNow.getUTCMinutes().toString().padStart(2, '0')}`
                    : getCurrentTimeInTimezone(col.iana)

                  if (isPrimary) {
                    return (
                      <div key={`hdr-tz-primary-${colIdx}`} className="p-1 text-xs text-right pr-2 border-r border-border flex flex-col items-end justify-between text-blue-600 dark:text-blue-400">
                        <span className="text-[10px] font-bold">{label}</span>
                        {abbr && <span className="text-[9px] opacity-70">{abbr}</span>}
                        <style>{`@keyframes blink-colon { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }`}</style>
                        <span className="font-mono tabular-nums font-semibold">
                          {currentTime.split(':')[0]}
                          <span style={{ animation: 'blink-colon 1s step-start infinite' }}>:</span>
                          {currentTime.split(':')[1]}
                        </span>
                      </div>
                    )
                  }

                  // Additional timezone column header
                  return (
                    <div key={`hdr-tz-${col.iana}-${colIdx}`} className="p-1 text-xs text-muted-foreground text-center border-r border-border/50 flex flex-col items-center justify-between">
                      <span className="text-[9px] font-semibold opacity-60 truncate max-w-full">{label}</span>
                      <span className="text-[9px] opacity-50">{abbr}</span>
                      <span className="font-mono tabular-nums text-[10px]">
                        {currentTime.split(':')[0]}
                        <span style={{ animation: 'blink-colon 1s step-start infinite' }}>:</span>
                        {currentTime.split(':')[1]}
                      </span>
                    </div>
                  )
                })}
                {daySlots.map((slot, slotIdx) => {
                  if (slot.type === 'dst') {
                    const t = slot.transition
                    const entry = findTimezone(t.iana)
                    const city = entry ? entry.city : t.iana
                    const offsetBefore = t.offsetBefore >= 0 ? `+${t.offsetBefore / 60}` : `${t.offsetBefore / 60}`
                    const offsetAfter = t.offsetAfter >= 0 ? `+${t.offsetAfter / 60}` : `${t.offsetAfter / 60}`
                    return (
                      <div key={`day-dst-hdr-${t.iana}-${slotIdx}`} className="p-1 text-center border-l border-amber-400 bg-amber-50/60 dark:bg-amber-950/30 flex flex-col items-center justify-center">
                        <span className="text-[8px] font-semibold text-amber-700 dark:text-amber-300 truncate max-w-full">{city}</span>
                        <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400">GMT</span>
                        <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400">{offsetBefore} to {offsetAfter}</span>
                      </div>
                    )
                  }
                  const day = slot.day
                  const inRange = isDateInRange(day)
                  const isToday = isSameDay(day, today)
                  const isSkipped = isDaySkipped(day)
                  const dayKey = format(day, 'yyyy-MM-dd')
                  const isHighlighted = notSelectablePopup?.highlightDates.has(dayKey) ?? false
                  const isRangeStart = !hideDateNumbers && customStartDate === dayKey
                  const isRangeEnd = !hideDateNumbers && customEndDate === dayKey
                  const markerLabel = !hideDateNumbers
                    ? (!isStartDateLocked ? 'Set Start' : !isEndDateLocked ? 'Set End' : (isRangeStart ? 'Start Locked' : isRangeEnd ? 'End Locked' : 'Range Locked'))
                    : ''
                  const isMarkerDisabled = hideDateNumbers || (isStartDateLocked && isEndDateLocked)
                  
                  return (
                    <div
                      key={day.toISOString()}
                      className={`p-1 md:p-2 text-center font-semibold border-l border-border transition-shadow ${
                        isSkipped
                          ? 'bg-muted text-muted-foreground line-through'
                          : inRange
                          ? 'bg-green-50 text-green-700'
                          : isToday
                          ? 'bg-blue-50 text-blue-600'
                          : 'text-foreground'
                      } ${isHighlighted ? 'ring-2 ring-blue-500 ring-inset animate-pulse rounded-sm' : ''}`}
                    >
                      <div className="text-[10px] md:text-xs">{format(day, 'EEE')}</div>
                      {!hideDateNumbers && (
                        <>
                          <div className="text-sm md:text-lg">{format(day, 'd')}</div>
                          {(!roomHash || isEditingSettings) && (
                            <button
                              type="button"
                              onClick={() => handleDateMarkerSelect(day)}
                              disabled={isMarkerDisabled}
                              className={`mt-0.5 text-[9px] md:text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                                isMarkerDisabled
                                  ? 'bg-muted text-muted-foreground border-border cursor-not-allowed'
                                  : isRangeStart
                                    ? 'bg-emerald-100 text-emerald-700 border-emerald-300 hover:bg-emerald-200'
                                    : isRangeEnd
                                      ? 'bg-sky-100 text-sky-700 border-sky-300 hover:bg-sky-200'
                                      : 'bg-card text-muted-foreground border-border hover:bg-muted'
                              }`}
                            >
                              {markerLabel}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

              <div style={{ position: 'relative' }}>
              {timeSlots.map((time, index) => (
                <div key={time} className={`grid hover:bg-muted/30 ${index === timeSlots.length - 1 ? 'border-b-2 border-border' : ''}`} style={gridStyle}>
                {/* Timezone time labels */}
                {tzColumns.map((col, colIdx) => {
                  const isPrimary = col.iana === tzState.primary
                  const displayTime = convertUtcTimeToTimezone(time, col.iana)

                  if (isPrimary) {
                    return (
                      <div key={`tz-${col.iana}-${time}-${colIdx}`} className="p-1 text-xs text-right pr-2 border-r border-border font-mono tabular-nums font-semibold text-blue-600 dark:text-blue-400">
                        {displayTime}
                      </div>
                    )
                  }
                  return (
                    <div key={`tz-${col.iana}-${time}-${colIdx}`} className="p-1 text-[10px] text-muted-foreground text-center border-r border-border/50 font-mono tabular-nums flex items-center justify-center">
                      {displayTime}
                    </div>
                  )
                })}
                {daySlots.map((slot, slotIdx) => {
                  if (slot.type === 'dst') {
                    const t = slot.transition
                    const dstTime = convertUtcTimeToTimezoneOnDate(time, t.iana, visibleDays[t.transitionDayIndex])
                    // Compare against old-offset time to see if this UTC slot is actually affected
                    const beforeDay = t.transitionDayIndex > 0 ? visibleDays[t.transitionDayIndex - 1] : visibleDays[0]
                    const beforeTime = convertUtcTimeToTimezoneOnDate(time, t.iana, beforeDay)
                    const isChanged = dstTime !== beforeTime
                    return (
                      <div key={`dst-${t.iana}-${time}-${slotIdx}`} className={`p-1 text-[10px] text-center border-l border-amber-400 font-mono tabular-nums flex items-center justify-center ${
                        isChanged
                          ? 'bg-amber-50/40 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300 font-semibold'
                          : 'text-muted-foreground/40'
                      }`}>
                        {dstTime}
                      </div>
                    )
                  }
                  const day = slot.day
                  const inRange = isDateInRange(day)
                  const isSkipped = isDaySkipped(day)
                  const cellId = getCellId(day, time)
                  const isCurrentSelection = currentSelection.has(cellId)
                  const isImportPreviewCell = showImportModal && importPreviewSelection.has(cellId)
                  const isMeetingCreationCell = meetingCreationSelection.has(cellId)
                  const availableUsers = getCellAvailability(cellId)
                  const userCount = availableUsers.length
                  const heatmapColor = getHeatmapColor(userCount)
                  const purpleGradient = getPurpleGradient(userCount)
                  const isSelectable = roomHash && inRange && !isSkipped
                  const suggestion = showSuggestions ? getSuggestionForCell(cellId) : undefined
                  const flashColor = getFlashColor(day, time)
                  const meetingsAtCell = getConfirmedMeetingsAtCell(cellId)
                  const isConfirmed = meetingsAtCell.length > 0
                  const cellBusy = isCellBusy(cellId)
                  const selectedParticipantColor = getSelectedParticipantCellStyle(cellId)
                  
                  return (
                    <div
                      key={`${day.toISOString()}-${time}`}
                      data-cell-id={cellId}
                      className={`border-l border-b border-border h-[32px] select-none relative ${
                        isMeetingCreationCell && isCreatingMeeting
                          ? `bg-blue-400 cursor-pointer${editingMeetingIndex !== null ? ' editing-meeting-cell' : ''}`
                          : isSkipped || (!inRange && roomHash)
                          ? 'bg-gray-400/70 dark:bg-[hsla(222,47%,11%,0.7)] cursor-not-allowed'
                          : isCurrentSelection && roomHash && !isCreatingMeeting
                          ? `${purpleGradient} cursor-pointer`
                          : isImportPreviewCell && roomHash && !isCreatingMeeting
                          ? 'bg-cyan-300/70 dark:bg-cyan-600/50 cursor-pointer'
                          : selectedParticipantColor && roomHash
                          ? 'cursor-pointer'
                          : userCount > 0 && roomHash
                          ? `${heatmapColor} cursor-pointer`
                          : inRange
                          ? 'bg-green-50/30 cursor-pointer'
                          : cellBusy && !roomHash
                          ? 'bg-gray-200 dark:bg-[hsla(222,47%,11%,0.7)] cursor-default'
                          : !inRange && !roomHash
                          ? 'bg-gray-400/70 dark:bg-[hsla(222,47%,11%,0.7)] cursor-default'
                          : roomHash
                          ? 'cursor-not-allowed'
                          : ''
                      }`}
                      style={{
                        ...(suggestion ? {
                          boxShadow: `inset 0 0 0 3px ${suggestion.color}`,
                          position: 'relative'
                        } : {}),
                        ...(flashColor ? {
                          backgroundColor: flashColor
                        } : {}),
                        ...(!flashColor && selectedParticipantColor && !isCurrentSelection && !isMeetingCreationCell && !(isSkipped || (!inRange && roomHash)) ? {
                          backgroundColor: selectedParticipantColor
                        } : {})
                      }}
                      onPointerDown={() => isSelectable && handleCellPointerDown(day, time)}
                      onClick={(e) => { if (!isSelectable) handleNonSelectableClick(day, e) }}
                      onPointerEnter={(e) => {
                        if (pinnedHoverCell) return
                        if (isSelectable) {
                          handleCellPointerEnter(day, time)
                        }
                        // Set hovered cell for participant panel highlighting (works on all cells)
                        if (roomHash && (userCount > 0 || cellBusy)) {
                          setHoveredCell(cellId)
                        }
                        // Track tooltip position for desktop hover panel
                        if (roomHash && (userCount > 0 || cellBusy) && !isMobile) {
                          const rect = e.currentTarget.getBoundingClientRect()
                          setTooltipPosition({ x: rect.right + 8, y: rect.top })
                        }
                      }}
                      onPointerLeave={() => {
                        if (pinnedHoverCell) return
                        setHoveredCell(null)
                        setTooltipPosition(null)
                      }}
                      onContextMenu={(e) => {
                        if (!roomHash || isMobile) return
                        if (userCount === 0 && !isConfirmed) return
                        e.preventDefault()
                        const rect = e.currentTarget.getBoundingClientRect()
                        const nextPosition = { x: rect.right + 8, y: rect.top }
                        setHoveredCell(cellId)
                        setTooltipPosition(nextPosition)
                        setPinnedHoverCell(cellId)
                        setPinnedTooltipPosition(nextPosition)
                      }}
                    >
                      {/* Confirmed meeting indicator - amber border with selective edges for unified rectangle */}
                      {/* Recurring occurrences use blue border with dashed style */}
                      {isConfirmed && !isMeetingCreationCell && meetingsAtCell.map((m, idx) => {
                        const pos = m.position
                        const isRec = m.isRecurring
                        const meeting = confirmedMeetings[m.meetingIndex]
                        const occurrenceCellId = m.occurrenceCellId || meeting?.cellId
                        const isCurrentWeekActive = startOfWeek(new Date(), { weekStartsOn: 1 }).getTime() === currentWeekStart.getTime()
                        let isPastInActiveWeek = false
                        if (occurrenceCellId && meeting && isCurrentWeekActive && !isRec) {
                          const [occDateStr, occTimeStr] = occurrenceCellId.split('_')
                          const occStart = new Date(`${occDateStr}T${occTimeStr}:00Z`).getTime()
                          const occEnd = occStart + meeting.duration * 60_000
                          isPastInActiveWeek = Number.isFinite(occEnd) && occEnd < Date.now()
                        }
                        const borderColor = isRec
                          ? 'border-blue-400'
                          : m.isFutureWeekProjection
                          ? 'border-yellow-500 dark:border-yellow-600'
                          : isPastInActiveWeek
                          ? 'border-amber-800 dark:border-amber-700'
                          : 'border-amber-500'
                        const borderStyle = isRec ? 'border-dashed' : 'border-solid'
                        // Create unified rectangle by only showing outer borders
                        const borderClasses = `absolute inset-0 pointer-events-none ${borderColor} ${borderStyle} ${
                          pos === 'single' ? 'border-2' :
                          pos === 'first' ? 'border-l-2 border-t-2 border-r-2 border-b-0' :
                          pos === 'last' ? 'border-l-2 border-b-2 border-r-2 border-t-0' :
                          'border-l-2 border-r-2 border-t-0 border-b-0'
                        }`
                        
                        return (
                          <div key={`${m.meetingIndex}-${idx}-${isRec ? 'r' : 'p'}`} className={borderClasses}>
                            {m.isFirstCell && (
                              <div 
                                className={`absolute top-0 text-white text-[10px] font-bold px-1 leading-tight flex items-center gap-0.5 ${
                                  isRec
                                    ? 'bg-blue-400'
                                    : m.isFutureWeekProjection
                                    ? 'bg-yellow-600 dark:bg-yellow-500'
                                    : isPastInActiveWeek
                                    ? 'bg-amber-800 dark:bg-amber-700'
                                    : 'bg-amber-500'
                                }`}
                                style={{ left: idx > 0 ? `${idx * 14}px` : '0' }}
                              >
                                {isRec && <Repeat2 className="w-2.5 h-2.5" />}
                                {m.chronologicalNumber}
                              </div>
                            )}
                          </div>
                        )
                      })}
                      {/* Busy block overlay from Google Calendar */}
                      {cellBusy && !isMeetingCreationCell && (
                        <>
                          <div 
                            className="absolute inset-0 pointer-events-none dark:hidden"
                            style={{
                              background: 'repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(107, 114, 128, 0.4) 3px, rgba(107, 114, 128, 0.4) 5px)',
                            }}
                          />
                          <div 
                            className="absolute inset-0 pointer-events-none hidden dark:block"
                            style={{
                              background: 'repeating-linear-gradient(135deg, transparent, transparent 3px, hsla(222.2, 47.4%, 11.2%, 0.55) 3px, hsla(222.2, 47.4%, 11.2%, 0.55) 5px)',
                            }}
                          />
                        </>
                      )}
                      {suggestion && (
                        <div 
                          className="absolute top-0.5 left-0.5 text-[10px] font-bold leading-none px-1 rounded"
                          style={{ 
                            backgroundColor: suggestion.color,
                            color: 'white'
                          }}
                        >
                          {suggestion.id}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
            
            {/* Current Time Indicator Line */}
            {(() => {
              const position = getCurrentTimePosition()
              if (position === null) return null
              
              return (
                <div 
                  ref={nowLineRef}
                  className="absolute left-0 right-0 pointer-events-none z-[15]"
                  style={{ 
                    top: `${position}px`,
                    height: '3px',
                    background: 'linear-gradient(to right, transparent, rgba(239, 68, 68, 0.8) 60px, rgba(239, 68, 68, 0.8), transparent)',
                    boxShadow: '0 0 6px rgba(239, 68, 68, 0.6)'
                  }}
                >
                  <div 
                    className="absolute left-[60px] -top-1 w-2 h-2 bg-red-600 rounded-full"
                    style={{ boxShadow: '0 0 6px rgba(239, 68, 68, 0.8)' }}
                  />
                </div>
              )
            })()}
              </div>
              </div>
            </div>
          </div>

            {/* Busy Hover Panel - left-side overlay that keeps 25% of the right grid visible */}
            {!isMobile && roomHash && activeBusyHoverCell && activeBusyEntries.length > 0 && (() => {
              const busyAnchorY = pinnedTooltipPosition?.y ?? tooltipPosition?.y ?? null

              const hoveredCellElement = document.querySelector(`[data-cell-id="${activeBusyHoverCell}"]`) as HTMLElement | null
              const hoveredRect = hoveredCellElement?.getBoundingClientRect() ?? null
              const firstGridCellElement = document.querySelector('[data-cell-id]') as HTMLElement | null
              const firstGridCellRect = firstGridCellElement?.getBoundingClientRect() ?? null
              const gridRect = calendarGridRef.current?.getBoundingClientRect() ?? null

              const columnWidth = hoveredRect?.width ?? 220
              const panelWidth = Math.max(160, Math.min(220, Math.floor(columnWidth - 14)))
              const columnLeft = hoveredRect?.left ?? (firstGridCellRect?.left ?? 96)
              const isMondayColumn = firstGridCellRect && hoveredRect
                ? Math.abs(hoveredRect.left - firstGridCellRect.left) < 2
                : false

              // Align card so its RIGHT edge touches the hovered column LEFT edge.
              const leftOffsetPx = 18
              const preferredLeft = columnLeft - panelWidth - leftOffsetPx
              const utcSafeLeft = gridRect ? (gridRect.left - panelWidth - 10) : preferredLeft
              const mondayLeft = Math.min(preferredLeft, utcSafeLeft)
              const targetLeft = isMondayColumn ? mondayLeft : preferredLeft
              const busyPanelLeft = Math.max(8, Math.min(window.innerWidth - panelWidth - 8, targetLeft))

              const maxTop = window.innerHeight - 140
              const busyPanelTop = busyAnchorY ? Math.max(12, Math.min(maxTop, busyAnchorY)) : null

              return (
                <div
                  className="pointer-events-none fixed z-[45]"
                  style={{ left: `${busyPanelLeft}px`, top: busyPanelTop ? `${busyPanelTop}px` : '50%', transform: busyPanelTop ? 'translateY(-8%)' : 'translateY(-50%)', width: `${panelWidth}px` }}
                >
                  <div className="pointer-events-none rounded-lg border border-border bg-popover/95 backdrop-blur-sm shadow-2xl">
                    <div className="max-h-[70vh] overflow-y-auto p-2 space-y-1.5">
                      {activeBusyEntries.map((entry, index) => {
                        const matchedCategories = entry.categoryIds
                          .map(categoryId => timeManagementCategoryLookup.get(categoryId))
                          .find((category): category is TimeManagementCategory => Boolean(category))
                        const categoryPalette = entry.categoryIds
                          .map(categoryId => timeManagementCategoryLookup.get(categoryId))
                          .filter((category): category is TimeManagementCategory => Boolean(category))
                        const isTimeCalendarBusyItem = categoryPalette.length > 0

                        let backgroundStyle: string | undefined
                        if (categoryPalette.length === 1) {
                          backgroundStyle = categoryPalette[0].color
                        } else if (categoryPalette.length > 1) {
                          const stops = categoryPalette
                            .map((category, paletteIndex) => {
                              const start = Math.round((paletteIndex / categoryPalette.length) * 100)
                              const end = Math.round(((paletteIndex + 1) / categoryPalette.length) * 100)
                              return `${category.color} ${start}% ${end}%`
                            })
                            .join(', ')
                          backgroundStyle = `linear-gradient(135deg, ${stops})`
                        }

                        const entryStyle = backgroundStyle && matchedCategories
                          ? {
                              background: backgroundStyle,
                              color: matchedCategories.font_color,
                              borderColor: `${matchedCategories.font_color}33`,
                            }
                          : undefined

                        return (
                          <div
                            key={`${entry.summary}-${index}`}
                            className="rounded-md border border-border/70 bg-card/60 px-2 py-1.5 flex items-center gap-1.5"
                            style={entryStyle}
                          >
                            <div className="text-xs font-medium truncate flex-1 min-w-0">
                              {truncateMeetingSummary(entry.summary)}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {!isTimeCalendarBusyItem && (
                                <span
                                  className="inline-block h-2.5 w-2.5 rounded-full border border-black/10"
                                  style={{ backgroundColor: entry.color }}
                                />
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )
            })()}

          {/* Desktop Hover Tooltip - Fixed position panel showing who selected the hovered time slot */}
          {!isMobile && (pinnedHoverCell || hoveredCell) && (pinnedTooltipPosition || tooltipPosition) && roomHash && (() => {
            const activeCell = pinnedHoverCell || hoveredCell
            const activePosition = pinnedTooltipPosition || tooltipPosition
            if (!activeCell || !activePosition) return null

            const hoveredUsers = getCellAvailability(activeCell)
            const [dateStr, timeStr] = activeCell.split('_')
            const cellDate = parse(dateStr, 'yyyy-MM-dd', new Date())
            const formattedDate = isValid(cellDate) ? format(cellDate, 'EEE, MMM d') : dateStr
            // Get meetings at this hovered cell
            const hoveredMeetings = getConfirmedMeetingsAtCell(activeCell)
            if (hoveredUsers.length === 0 && hoveredMeetings.length === 0) return null
            // Clamp tooltip position to viewport
            const tooltipWidth = 240
            const tooltipHeight = Math.min(
              (hoveredMeetings.length > 0 ? hoveredMeetings.length * 80 + 8 : 0) + hoveredUsers.length * 24 + 60,
              400
            )
            const maxY = window.innerHeight - tooltipHeight - 10
            const clampedY = Math.min(activePosition.y, maxY)
            const maxX = window.innerWidth - tooltipWidth - 10
            const clampedX = activePosition.x > maxX ? activePosition.x - tooltipWidth - 16 : activePosition.x
            
            return (
              <div
                ref={pinnedTooltipRef}
                className={`fixed z-50 flex flex-col gap-1.5 ${pinnedHoverCell ? 'pointer-events-auto' : 'pointer-events-none'}`}
                style={{
                  left: `${clampedX}px`,
                  top: `${clampedY}px`,
                  maxWidth: `${tooltipWidth}px`,
                }}
              >
                {/* Meeting info cards (top) */}
                {hoveredMeetings.length > 0 && (
                  <div className="flex flex-col gap-1.5 max-w-[230px]">
                    {hoveredMeetings.map((m, idx) => {
                      const meeting = confirmedMeetings[m.meetingIndex]
                      if (!meeting) return null
                      const isRec = m.isRecurring
                      const occCellId = m.occurrenceCellId || meeting.cellId
                      const [mDateStr, mTimeStr] = occCellId.split('_')
                      const mDate = parse(mDateStr, 'yyyy-MM-dd', new Date())
                      const mFormattedDate = isValid(mDate) ? format(mDate, 'EEE, MMM d') : mDateStr
                      const durationH = Math.floor(meeting.duration / 60)
                      const durationM = meeting.duration % 60
                      const durationLabel = durationH > 0
                        ? (durationM > 0 ? `${durationH}h ${durationM}m` : `${durationH}h`)
                        : `${durationM}m`
                      return (
                        <div
                          key={`mtg-tip-${m.meetingIndex}-${idx}`}
                          onClick={(e) => {
                            if (!pinnedHoverCell) return
                            e.stopPropagation()
                            openMeetingEditorByIndex(m.meetingIndex, occCellId)
                            setPinnedHoverCell(null)
                            setPinnedTooltipPosition(null)
                          }}
                          className={`bg-popover border rounded-lg shadow-lg p-2.5 transition-colors ${
                            isRec ? 'border-blue-400' : 'border-amber-500'
                          } ${pinnedHoverCell ? 'cursor-pointer hover:border-primary' : ''}`}
                        >
                          <div className="flex items-center gap-1.5 mb-1">
                            {isRec && <Repeat2 className="w-3 h-3 text-blue-400 flex-shrink-0" />}
                            <span className={`text-[10px] font-bold px-1 rounded text-white ${isRec ? 'bg-blue-400' : 'bg-amber-500'}`}>
                              Meeting {m.chronologicalNumber}
                            </span>
                            {isRec && <span className="text-[9px] text-blue-500 dark:text-blue-400">(recurring)</span>}
                          </div>
                          <div className="text-[10px] text-muted-foreground flex items-center gap-1 mb-0.5">
                            <Calendar className="w-3 h-3 flex-shrink-0" />
                            {mFormattedDate} at {formatUtcTimeWithPeriodInTimezone(mTimeStr, tzState.primary)}
                          </div>
                          <div className="text-[10px] text-muted-foreground flex items-center gap-1 mb-1">
                            <span className="w-3 h-3 flex-shrink-0 flex items-center justify-center text-[9px]">&#9719;</span>
                            {durationLabel}
                          </div>
                          {meeting.meetingLink && isSafeUrl(meeting.meetingLink) && (
                            <div className="text-[10px] text-primary truncate mt-0.5 flex items-center gap-1">
                              <LinkIcon className="w-3 h-3 flex-shrink-0" />
                              <span className="truncate">{meeting.meetingLink}</span>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
                {/* Participants panel (shown second / right side) */}
                <div
                  onClick={(e) => {
                    if (!pinnedHoverCell) return
                    e.stopPropagation()
                    setShowLeftSidebar(true)
                    setExpandedSidebarSections(prev => new Set([...prev, 'participants']))
                    setLeftPanelOrder(prev => prev.includes('tools') ? prev : [...prev, 'tools'])
                    setPinnedHoverCell(null)
                    setPinnedTooltipPosition(null)
                  }}
                  className={`bg-popover border border-border rounded-lg shadow-lg p-2.5 min-w-[160px] max-w-[220px] transition-colors ${pinnedHoverCell ? 'cursor-pointer hover:border-primary' : ''}`}
                >
                  <div className="text-[10px] text-muted-foreground mb-1">
                    {formattedDate} · {timeStr}
                  </div>
                  <div className="text-xs font-semibold text-foreground mb-1.5">
                    {hoveredUsers.length}/{getTotalParticipants()} available
                  </div>
                  <div className="space-y-0.5 max-h-[120px] overflow-y-auto">
                    {hoveredUsers.map(u => (
                      <div
                        key={u}
                        className={`flex items-center gap-1.5 text-xs px-1.5 py-0.5 rounded ${
                          selectedParticipants.has(u)
                            ? 'text-orange-700 dark:text-orange-400 font-medium'
                            : u === username.trim()
                            ? 'text-purple-700 dark:text-purple-400 font-medium'
                            : 'text-foreground'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                          selectedParticipants.has(u)
                            ? 'bg-orange-500'
                            : u === username.trim()
                            ? 'bg-purple-500'
                            : 'bg-green-500'
                        }`} />
                        {u}
                      </div>
                    ))}
                  </div>
                  {hoveredUsers.length < getTotalParticipants() && (
                    <div className="text-[10px] text-muted-foreground mt-1 pt-1 border-t border-border">
                      {getTotalParticipants() - hoveredUsers.length} unavailable
                    </div>
                  )}
                </div>
              </div>
            )
          })()}

        </div>
      </div>


      {/* Footer with social links and community resources */}
      <footer className="mt-auto pt-12 pb-8 border-t border-border/40">
        {(socialLinks.twitter || socialLinks.discord || socialLinks.youtube) && (
          <div className="flex items-center justify-center gap-4 mb-4">
            {socialLinks.twitter && (
              <a href={socialLinks.twitter} target="_blank" rel="noopener noreferrer" className="group flex flex-col items-center gap-1.5 p-3 rounded-xl border border-border bg-card hover:border-primary/30 hover:shadow-sm transition-all w-24" title="X (Twitter)">
                <svg className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
                <span className="text-[10px] text-muted-foreground group-hover:text-foreground transition-colors">X</span>
              </a>
            )}
            {socialLinks.discord && (
              <a href={socialLinks.discord} target="_blank" rel="noopener noreferrer" className="group flex flex-col items-center gap-1.5 p-3 rounded-xl border border-border bg-card hover:border-primary/30 hover:shadow-sm transition-all w-24" title="Discord">
                <svg className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" /></svg>
                <span className="text-[10px] text-muted-foreground group-hover:text-foreground transition-colors">Discord</span>
              </a>
            )}
            {socialLinks.youtube && (
              <a href={socialLinks.youtube} target="_blank" rel="noopener noreferrer" className="group flex flex-col items-center gap-1.5 p-3 rounded-xl border border-border bg-card hover:border-primary/30 hover:shadow-sm transition-all w-24" title="YouTube">
                <svg className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" /></svg>
                <span className="text-[10px] text-muted-foreground group-hover:text-foreground transition-colors">YouTube</span>
              </a>
            )}
          </div>
        )}
        {communityResources.filter(r => r.name.trim() && r.url.trim()).length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mb-4">
            {communityResources.filter(r => r.name.trim() && isSafeUrl(r.url)).map((resource, index) => (
              <a
                key={index}
                href={resource.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80 hover:underline transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                {resource.name}
              </a>
            ))}
          </div>
        )}
        <div className="flex items-center justify-center text-xs text-muted-foreground/60">
          <span>Coordination Manager</span>
        </div>
        <div className="h-32 md:h-48" />
      </footer>

      {/* Fading popup shown when user clicks a non-selectable cell */}
      {notSelectablePopup && (
        <div
          className={`fixed z-[9999] pointer-events-none px-3 py-2 rounded-lg shadow-lg bg-blue-600 text-white text-xs max-w-xs transition-opacity duration-500 ${
            notSelectablePopup.visible ? 'opacity-100 animate-fade-in-up' : 'opacity-0'
          }`}
          style={{
            left: Math.min(notSelectablePopup.x + 12, window.innerWidth - 320),
            top: Math.max(8, notSelectablePopup.y - 48),
          }}
        >
          {notSelectablePopup.message}
        </div>
      )}

    </div>
  )
}
