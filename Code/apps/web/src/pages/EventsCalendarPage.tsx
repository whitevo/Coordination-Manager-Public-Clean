import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { format, startOfWeek, addDays, addWeeks, subWeeks, isSameDay } from 'date-fns'
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Calendar, ExternalLink, X, Loader2, CalendarDays, Network, Download, CalendarPlus, Copy, Check, Search, LinkIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { apiClient } from '../lib/api-client'
import { computeDayLayout } from '../lib/calendarOverlapLayout'
import { downloadICSFile, buildOutlookCalendarUrl, isSafeUrl, resolveMeetingTitle } from '../lib/calendar-utils'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import TimezoneSelector from '../components/TimezoneSelector'
import { useTimezones } from '../lib/use-timezones'
import { findTimezone, convertUtcTimeToTimezone, convertUtcTimeToTimezoneOnDate, getCurrentTimeInTimezone, detectDstTransitions, type DstTransition } from '../lib/timezone-data'

/** Strip HTML tags from text and render URLs as clickable links with copy buttons */
function LinkifyText({ text }: { text: string }) {
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)
  const decodedText = text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16))
  )
  const stripped = decodedText.replace(/<[^>]*>/g, '')
  const markdownLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g
  const normalized = stripped.replace(markdownLinkRegex, (_match, label: string, url: string) => {
    const trimmedLabel = label.trim()
    const trimmedUrl = url.trim()
    // For markdown like [https://x](https://x), keep a single URL instance.
    return trimmedLabel === trimmedUrl ? trimmedUrl : `${trimmedLabel} ${trimmedUrl}`
  })
  const parts = normalized.split(/(https?:\/\/[^\s]+)/g)
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <span key={i} className="inline-flex items-center gap-1">
            <a href={part} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-all">{part}</a>
            <button
              onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(part); setCopiedUrl(part); setTimeout(() => setCopiedUrl(null), 2000) }}
              className="inline-flex p-0.5 rounded hover:bg-muted transition-colors shrink-0 align-middle"
              title="Copy link"
            >
              {copiedUrl === part ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
            </button>
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}

const SLOT_HEIGHT = 48

// ─── Types ──────────────────────────────────────────────────

type PublicEvent = {
  id: string
  title: string
  description: string | null
  meeting_link: string | null
  location: string | null
  start_time: string
  end_time: string
  is_public: boolean
  source_type: string
  recurrence_rule?: unknown
  created_at: string
  updated_at?: string
  calendar_title?: string
  calendar_hash?: string
}

type RecurrenceType = 'none' | 'weekly' | 'biweekly' | 'monthly' | 'custom'
type RecurrenceUnit = 'day' | 'week' | 'month'
type RecurrenceEndType = 'never' | 'on' | 'after'

type RecurrenceRule = {
  type: RecurrenceType
  interval?: number
  unit?: RecurrenceUnit
  weekDays?: number[]
  endType?: RecurrenceEndType
  endDate?: string
  endCount?: number
  exceptions?: string[]
}

const DAY_MS = 24 * 60 * 60 * 1000
const RECURRENCE_MAX_LOOKAHEAD_DAYS = 365 * 20

const isRecurrenceType = (value: unknown): value is RecurrenceRule['type'] =>
  value === 'none' || value === 'weekly' || value === 'biweekly' || value === 'monthly' || value === 'custom'

const isRecurrenceUnit = (value: unknown): value is NonNullable<RecurrenceRule['unit']> =>
  value === 'day' || value === 'week' || value === 'month'

const isRecurrenceEndType = (value: unknown): value is NonNullable<RecurrenceRule['endType']> =>
  value === 'never' || value === 'on' || value === 'after'

const normalizeRecurrenceRule = (value: unknown): RecurrenceRule => {
  if (!value || typeof value !== 'object') return { type: 'none' }

  const candidate = value as Record<string, unknown>
  const type = isRecurrenceType(candidate.type) ? candidate.type : 'none'
  if (type === 'none') return { type: 'none' }

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

const getUtcDateKey = (date: Date): string => date.toISOString().slice(0, 10)

const getRecurrenceWeekdayIndex = (date: Date): number => {
  const jsDay = date.getUTCDay()
  return jsDay === 0 ? 6 : jsDay - 1
}

const buildRecurrenceOccurrenceStart = (baseStart: Date, day: Date): string => {
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

const isRecurringOccurrenceDate = (candidate: Date, baseStart: Date, rule: RecurrenceRule): boolean => {
  const dayDiff = Math.floor((candidate.getTime() - baseStart.getTime()) / DAY_MS)
  if (dayDiff < 0) return false

  if (rule.type === 'weekly' || rule.type === 'biweekly') {
    const interval = rule.type === 'biweekly' ? 14 : 7
    return dayDiff % interval === 0 && getRecurrenceWeekdayIndex(candidate) === getRecurrenceWeekdayIndex(baseStart)
  }

  if (rule.type === 'monthly') {
    const monthDiff = (candidate.getUTCFullYear() - baseStart.getUTCFullYear()) * 12 + (candidate.getUTCMonth() - baseStart.getUTCMonth())
    return candidate.getUTCDate() === baseStart.getUTCDate() && monthDiff % 1 === 0
  }

  if (rule.type !== 'custom') return false

  const interval = rule.interval || 1
  const unit = rule.unit || 'week'
  if (unit === 'day') return dayDiff % interval === 0

  if (unit === 'week') {
    const allowedWeekDays = rule.weekDays && rule.weekDays.length > 0 ? rule.weekDays : [getRecurrenceWeekdayIndex(baseStart)]
    const weekDiff = Math.floor(dayDiff / 7)
    return weekDiff % interval === 0 && allowedWeekDays.includes(getRecurrenceWeekdayIndex(candidate))
  }

  const monthDiff = (candidate.getUTCFullYear() - baseStart.getUTCFullYear()) * 12 + (candidate.getUTCMonth() - baseStart.getUTCMonth())
  return candidate.getUTCDate() === baseStart.getUTCDate() && monthDiff % interval === 0
}

const getRecurringEventStartsInRange = (event: PublicEvent, rangeStart: Date, rangeEnd: Date): string[] => {
  const recurrenceRule = normalizeRecurrenceRule(event.recurrence_rule)
  if (recurrenceRule.type === 'none') return []

  const baseStart = new Date(event.start_time)
  if (Number.isNaN(baseStart.getTime())) return []

  const endDate = recurrenceRule.endType === 'on' && recurrenceRule.endDate ? new Date(`${recurrenceRule.endDate}T00:00:00Z`) : null
  const exceptionDates = recurrenceRule.exceptions && recurrenceRule.exceptions.length > 0 ? new Set(recurrenceRule.exceptions) : null
  const matchedStarts: string[] = []
  let matchedCount = 0

  const baseDay = new Date(Date.UTC(baseStart.getUTCFullYear(), baseStart.getUTCMonth(), baseStart.getUTCDate()))
  if (rangeEnd.getTime() <= baseDay.getTime()) return []

  const daysUntilRangeEnd = Math.max(0, Math.floor((rangeEnd.getTime() - baseDay.getTime()) / DAY_MS))
  const maxOffset = Math.min(RECURRENCE_MAX_LOOKAHEAD_DAYS, daysUntilRangeEnd + 7)

  for (let offset = 0; offset <= maxOffset; offset++) {
    const candidate = addDays(baseStart, offset)
    const candidateDay = new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth(), candidate.getUTCDate()))
    if (candidateDay.getTime() < baseDay.getTime()) continue
    if (endDate && candidateDay.getTime() > Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate())) break
    if (!isRecurringOccurrenceDate(candidate, baseStart, recurrenceRule)) continue

    matchedCount++
    if (recurrenceRule.endType === 'after' && recurrenceRule.endCount && matchedCount > recurrenceRule.endCount) {
      break
    }

    if (exceptionDates && exceptionDates.has(getUtcDateKey(candidate))) {
      if (candidateDay.getTime() >= rangeEnd.getTime()) break
      continue
    }

    if (candidateDay.getTime() >= rangeStart.getTime() && candidateDay.getTime() < rangeEnd.getTime()) {
      matchedStarts.push(buildRecurrenceOccurrenceStart(baseStart, candidate))
    }

    if (candidateDay.getTime() >= rangeEnd.getTime()) {
      break
    }
  }

  return matchedStarts
}

function expandRecurringPublicEvents(events: PublicEvent[], windowStart: Date, windowEnd: Date): PublicEvent[] {
  const expanded: PublicEvent[] = []

  for (const ev of events) {
    const rule = normalizeRecurrenceRule(ev.recurrence_rule)
    const evStart = new Date(ev.start_time)
    const evEnd = new Date(ev.end_time)

    if (rule.type === 'none') {
      if (evStart < windowEnd && evEnd > windowStart) {
        expanded.push(ev)
      }
      continue
    }

    const durationMs = evEnd.getTime() - evStart.getTime()
    if (!Number.isFinite(durationMs) || durationMs <= 0) continue

    const starts = getRecurringEventStartsInRange(ev, windowStart, windowEnd)
    for (const occStartIso of starts) {
      const occStart = new Date(occStartIso)
      const occEnd = new Date(occStart.getTime() + durationMs)
      expanded.push({
        ...ev,
        id: `${ev.id}__occ__${occStartIso}`,
        start_time: occStart.toISOString(),
        end_time: occEnd.toISOString(),
      })
    }
  }

  return expanded
}

type TimeSession = { start_time: string; end_time: string }

type GroupedPublicEvent = PublicEvent & {
  sessions: TimeSession[]
  source_labels: string[]
}

function getEventPriorityTime(ev: PublicEvent): number {
  const updatedAt = ev.updated_at ? new Date(ev.updated_at).getTime() : Number.NaN
  if (Number.isFinite(updatedAt)) return updatedAt
  const createdAt = new Date(ev.created_at).getTime()
  if (Number.isFinite(createdAt)) return createdAt
  const startTime = new Date(ev.start_time).getTime()
  return Number.isFinite(startTime) ? startTime : 0
}

/** Group events that share the same title, meeting link, and location on the same UTC day. */
function groupDuplicateEvents(events: PublicEvent[]): GroupedPublicEvent[] {
  const groups = new Map<string, GroupedPublicEvent>()

  for (const ev of events) {
    const day = ev.start_time.slice(0, 10) // YYYY-MM-DD
    const key = `${ev.title}|${ev.meeting_link ?? ''}|${ev.location ?? ''}|${day}`
    const sourceLabel = ev.calendar_title || (ev.source_type === 'coordination_calendar' ? 'Coordination calendar' : 'Community member')

    const existing = groups.get(key)
    if (existing) {
      const existingPriority = getEventPriorityTime(existing)
      const incomingPriority = getEventPriorityTime(ev)

      const hasSameSession = existing.sessions.some(
        s => s.start_time === ev.start_time && s.end_time === ev.end_time
      )
      if (!hasSameSession) {
        existing.sessions.push({ start_time: ev.start_time, end_time: ev.end_time })
      }
      existing.sessions.sort((a, b) => a.start_time.localeCompare(b.start_time))
      if (!existing.source_labels.includes(sourceLabel)) {
        existing.source_labels.push(sourceLabel)
      }
      if (incomingPriority >= existingPriority) {
        Object.assign(existing, ev)
      }
    } else {
      groups.set(key, {
        ...ev,
        sessions: [{ start_time: ev.start_time, end_time: ev.end_time }],
        source_labels: [sourceLabel],
      })
    }
  }

  return Array.from(groups.values())
}

type TimeInterval = 60

type CalendarSource = {
  id: string
  source_type: 'google_oauth' | 'google_public_url'
  google_email: string | null
  public_url: string | null
  display_name: string
  color: string
  is_active: boolean
}

type NetworkDef = {
  id: string
  name: string
  color: string
  description: string | null
}

type NetworkMapping = {
  id: string
  network_id: string
  source_string: string
  source_type: 'calendar_title' | 'meeting_title' | 'description'
}

type NetworkRule = {
  id: string
  network_id: string
  pattern: string
  match_type: 'contains' | 'starts_with' | 'exact' | 'regex'
  match_field: 'calendar_title' | 'meeting_title' | 'description'
  priority: number
  is_active: boolean
}

/** Resolve an event to a network using mappings first, then rules */
function resolveNetwork(
  ev: { title: string; calendar_title?: string; description?: string | null },
  mappings: NetworkMapping[],
  rules: NetworkRule[],
): string | null {
  // 1. Check direct mappings (fastest)
  for (const m of mappings) {
    if (m.source_type === 'calendar_title' && ev.calendar_title === m.source_string) return m.network_id
    if (m.source_type === 'meeting_title' && ev.title === m.source_string) return m.network_id
    if (m.source_type === 'description' && ev.description === m.source_string) return m.network_id
  }

  // 2. Check rules (sorted by priority desc from API)
  for (const r of rules) {
    const field = r.match_field === 'calendar_title' ? (ev.calendar_title || '')
      : r.match_field === 'meeting_title' ? ev.title
      : (ev.description || '')

    if (!field) continue

    let matched = false
    const lower = field.toLowerCase()
    const patLower = r.pattern.toLowerCase()

    if (r.match_type === 'exact') {
      matched = lower === patLower
    } else if (r.match_type === 'contains') {
      matched = lower.includes(patLower)
    } else if (r.match_type === 'starts_with') {
      matched = lower.startsWith(patLower)
    } else if (r.match_type === 'regex') {
      try { matched = new RegExp(r.pattern, 'i').test(field) } catch { /* invalid regex */ }
    }

    if (matched) return r.network_id
  }

  return null
}

function getEventNetworkFilterIdFromResolvedData(
  ev: { id: string; calendar_title?: string },
  eventNetworkMap: Map<string, string | null>,
  networkMap: Map<string, NetworkDef>,
): string | null {
  const netId = eventNetworkMap.get(ev.id)
  if (netId && networkMap.has(netId)) return netId
  if (ev.calendar_title) return `cal_${ev.calendar_title}`
  return null
}

// ─── Component ──────────────────────────────────────────────

export default function EventsCalendarPage() {
  const { isAuthenticated } = useAuth()
  const { showToast } = useToast()
  const [currentWeekStart, setCurrentWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  )
  const [timeInterval] = useState<TimeInterval>(60)
  const [startHour] = useState(0)
  const [endHour] = useState(24)

  const [rawEvents, setRawEvents] = useState<PublicEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedEvent, setSelectedEvent] = useState<GroupedPublicEvent | null>(null)
  const [selectedEventSourcesExpanded, setSelectedEventSourcesExpanded] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  const [overflowPanelEvents, setOverflowPanelEvents] = useState<GroupedPublicEvent[] | null>(null)
  const [selectedNetworks, setSelectedNetworks] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [hoveredEventTitle, setHoveredEventTitle] = useState<string | null>(null)
  const [networksExpanded, setNetworksExpanded] = useState(false)
  const [networksOverflow, setNetworksOverflow] = useState(false)
  const [networksStickyHeight, setNetworksStickyHeight] = useState(0)
  const networksContainerRef = useRef<HTMLDivElement>(null)
  const networksStickyRef = useRef<HTMLDivElement>(null)

  // Right-click highlight: shows meetings at a specific time slot
  const [highlightedSlotEvents, setHighlightedSlotEvents] = useState<GroupedPublicEvent[] | null>(null)
  const [highlightedSlotLabel, setHighlightedSlotLabel] = useState('')
  const highlightBarRef = useRef<HTMLDivElement>(null)

  // Expandable sidebar card states
  const [_cardNetworksOpen, _setCardNetworksOpen] = useState(true)
  const [_cardActionsOpen, _setCardActionsOpen] = useState(true)
  const [_cardPlanningsOpen, _setCardPlanningsOpen] = useState(false)

  // Network relations data from API
  const [networkDefs, setNetworkDefs] = useState<NetworkDef[]>([])
  const [networkMappings, setNetworkMappings] = useState<NetworkMapping[]>([])
  const [networkRules, setNetworkRules] = useState<NetworkRule[]>([])

  // Auth for admin check
  const authCtx = useAuth()
  const isAdmin = authCtx.user?.roles?.includes('admin')

  // Google Calendar sync state
  const [calendarSources, setCalendarSources] = useState<CalendarSource[]>([])
  const [syncingToGoogle, setSyncingToGoogle] = useState(false)
  const [showGoogleSyncPicker, setShowGoogleSyncPicker] = useState<{ title: string; description?: string | null; start_time: string; end_time: string; meeting_link?: string | null; location?: string | null } | null>(null)
  const [selectedSyncSourceIds, setSelectedSyncSourceIds] = useState<Set<string>>(new Set())

  const calendarGridRef = useRef<HTMLDivElement>(null)
  const nowLineRef = useRef<HTMLDivElement>(null)
  const [isPhoneViewport, setIsPhoneViewport] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 767px)').matches
      : false
  )

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(max-width: 767px)')
    const onChange = (event: MediaQueryListEvent) => setIsPhoneViewport(event.matches)
    setIsPhoneViewport(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

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

  const googleOAuthSources = useMemo(
    () => calendarSources.filter(s => s.source_type === 'google_oauth' && s.is_active),
    [calendarSources]
  )

  const handleSyncToGoogle = useCallback(async (event: { title: string; description?: string | null; start_time: string; end_time: string; meeting_link?: string | null; location?: string | null }, targetIds?: string[]) => {
    const ids = targetIds || (googleOAuthSources.length === 1 ? [googleOAuthSources[0].id] : [])
    if (ids.length === 0) return

    setSyncingToGoogle(true)
    try {
      const res = await apiClient.post('/api/calendar-sources/add-event', {
        event: {
          title: event.title,
          description: event.description || undefined,
          start_time: event.start_time,
          end_time: event.end_time,
          meeting_link: event.meeting_link || undefined,
          location: event.location || undefined,
        },
        targetSourceIds: ids,
      })
      const { succeeded, failed } = res.data
      if (failed > 0) {
        showToast(`Added to ${succeeded} calendar(s), ${failed} failed.`, 'error')
      } else {
        showToast(`Added to ${succeeded} Google Calendar(s)!`)
      }
      setShowGoogleSyncPicker(null)
      setSelectedSyncSourceIds(new Set())
    } catch (err) {
      showToast((err as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to add event to Google Calendar.', 'error')
    } finally {
      setSyncingToGoogle(false)
    }
  }, [googleOAuthSources, showToast])

  // Current time state for red line and UTC clock
  const [currentTime, setCurrentTime] = useState(new Date())
  const [utcNow, setUtcNow] = useState(() => new Date())
  const tzState = useTimezones()

  const getSourceCountLabel = (ev: GroupedPublicEvent): string => {
    const count = ev.source_labels.length
    return `Shared from ${count} source${count !== 1 ? 's' : ''}`
  }

  // Expand recurring events into concrete occurrences in a rolling window, then group duplicates.
  const expandedEvents = useMemo(() => {
    const windowStart = subWeeks(currentWeekStart, 8)
    const windowEnd = addWeeks(currentWeekStart, 80)
    return expandRecurringPublicEvents(rawEvents, windowStart, windowEnd)
  }, [rawEvents, currentWeekStart])

  // Group duplicate events (same title/link/location/day) into single entries.
  const events = useMemo(() => groupDuplicateEvents(expandedEvents), [expandedEvents])

  // Fetch public events
  useEffect(() => {
    // Ensure timestamps are treated as UTC (meetings table uses plain TIMESTAMP)
    const ensureUTC = (ts: string) =>
      ts && !ts.endsWith('Z') && !ts.includes('+') ? ts + 'Z' : ts

    const fetchPublicEvents = async () => {
      try {
        const res = await apiClient.get('/api/user-events/public')
        const normalized = (res.data.events || []).map((ev: PublicEvent) => ({
          ...ev,
          start_time: ensureUTC(ev.start_time),
          end_time: ensureUTC(ev.end_time),
        }))
        setRawEvents(normalized)
      } catch (err) {
        console.error('Failed to fetch public events:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchPublicEvents()
  }, [])

  // Fetch network relations (networks, mappings, rules)
  useEffect(() => {
    const fetchNetworkData = async () => {
      try {
        const [nRes, mRes, rRes] = await Promise.all([
          apiClient.get('/api/network-relations/networks'),
          apiClient.get('/api/network-relations/mappings'),
          apiClient.get('/api/network-relations/rules'),
        ])
        setNetworkDefs(nRes.data.networks || [])
        setNetworkMappings(mRes.data.mappings || [])
        setNetworkRules(rRes.data.rules || [])
      } catch (err) {
        console.error('Failed to fetch network relations:', err)
      }
    }
    fetchNetworkData()
  }, [])

  // Fetch calendar sources for Google Calendar sync (authenticated users only)
  useEffect(() => {
    if (!isAuthenticated) return
    const fetchSources = async () => {
      try {
        const res = await apiClient.get('/api/calendar-sources')
        setCalendarSources(res.data.sources || [])
      } catch (err) {
        console.error('Failed to fetch calendar sources:', err)
      }
    }
    fetchSources()
  }, [isAuthenticated])

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

  useEffect(() => {
    setSelectedEventSourcesExpanded(false)
  }, [selectedEvent?.id])

  // Get current time indicator position (in pixels from top)
  const getCurrentTimePosition = (): number | null => {
    const now = currentTime
    const currentHourUTC = now.getUTCHours()
    const currentMinuteUTC = now.getUTCMinutes()
    
    if (currentHourUTC < startHour || currentHourUTC >= endHour) {
      return null
    }
    
    const minutesFromStart = (currentHourUTC - startHour) * 60 + currentMinuteUTC
    const position = (minutesFromStart / 60) * SLOT_HEIGHT
    
    return position
  }

  // ─── Time helpers ─────────────────────────────────────────

  const generateTimeSlots = () => {
    const slots: string[] = []
    for (let hour = startHour; hour < endHour; hour++) {
      for (let minute = 0; minute < 60; minute += timeInterval) {
        slots.push(`${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`)
      }
    }
    return slots
  }

  const timeSlots = generateTimeSlots()
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i)), [currentWeekStart])
  const weekEnd = addDays(currentWeekStart, 7)

  const formatTimeLabel = (time: string) => convertUtcTimeToTimezone(time, tzState.primary)

  // Detect DST transitions within visible week for all active timezones
  const allActiveIanas = [tzState.primary, ...tzState.additional]
  const dstTransitions = detectDstTransitions(allActiveIanas, weekDays)

  // Build day slots: interleave DST indicator columns before the transition day
  type DaySlot =
    | { type: 'day'; day: Date; dayIdx: number }
    | { type: 'dst'; transition: DstTransition }
  const buildDaySlots = (): DaySlot[] => {
    const slots: DaySlot[] = []
    for (let i = 0; i < weekDays.length; i++) {
      const transitionsHere = dstTransitions.filter((t) => t.transitionDayIndex === i)
      for (const t of transitionsHere) {
        slots.push({ type: 'dst', transition: t })
      }
      slots.push({ type: 'day', day: weekDays[i], dayIdx: i })
    }
    return slots
  }
  const daySlots = buildDaySlots()

  // Resolve events to networks and assign consistent colors
  const networkMap = useMemo(() => new Map(networkDefs.map(n => [n.id, n])), [networkDefs])

  /** Map each event to its resolved network_id (or null) */
  const eventNetworkMap = useMemo(() => {
    const map = new Map<string, string | null>()
    for (const ev of events) {
      map.set(ev.id, resolveNetwork(ev, networkMappings, networkRules))
    }
    return map
  }, [events, networkMappings, networkRules])

  const nextWeekStartByNetwork = useMemo(() => {
    const now = Date.now()
    const map = new Map<string, Date>()

    for (const ev of events) {
      const filterId = getEventNetworkFilterIdFromResolvedData(ev, eventNetworkMap, networkMap)
      if (!filterId) continue

      const evEndMs = new Date(ev.end_time).getTime()
      if (evEndMs < now) continue

      const evWeekStart = startOfWeek(new Date(ev.start_time), { weekStartsOn: 1 })
      const existing = map.get(filterId)
      if (!existing || evWeekStart.getTime() < existing.getTime()) {
        map.set(filterId, evWeekStart)
      }
    }

    return map
  }, [events, eventNetworkMap, networkMap])

  // Events for current week, filtered by network and search
  const eventsInWeek = useMemo(() => {
    let filtered = events.filter(ev => {
      const evStart = new Date(ev.start_time)
      const evEnd = new Date(ev.end_time)
      return evStart < weekEnd && evEnd > currentWeekStart
    })

    // Network filter: if any networks are selected, only show matching events
    if (selectedNetworks.size > 0) {
      filtered = filtered.filter(ev => {
        const netId = eventNetworkMap.get(ev.id)
        if (netId && selectedNetworks.has(netId)) return true
        // Also match by calendar_title for unresolved ones
        const calKey = ev.calendar_title ? `cal_${ev.calendar_title}` : null
        if (calKey && selectedNetworks.has(calKey)) return true
        return false
      })
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      filtered = filtered.filter(ev => {
        const calTitle = (ev.calendar_title || '').toLowerCase()
        const meetTitle = ev.title.toLowerCase()
        const desc = (ev.description || '').toLowerCase()
        // Also check resolved network name
        const netId = eventNetworkMap.get(ev.id)
        const netName = netId ? (networkMap.get(netId)?.name || '').toLowerCase() : ''
        return calTitle.includes(q) || meetTitle.includes(q) || desc.includes(q) || netName.includes(q)
      })
    }

    return filtered
  }, [events, currentWeekStart, weekEnd, selectedNetworks, searchQuery, eventNetworkMap, networkMap])

  // ─── Overlap layout per day ──────────────────────────────

  const dayLayouts = useMemo(() => {
    const slotDurationMs = timeInterval * 60 * 1000
    return weekDays.map(day => {
      const dayStartMs = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), startHour, 0, 0, 0)
      const dayEndMs = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), endHour, 0, 0, 0)

      const dayEvents = eventsInWeek.filter(ev => {
        const evStart = new Date(ev.start_time).getTime()
        const evEnd = new Date(ev.end_time).getTime()
        return evStart < dayEndMs && evEnd > dayStartMs
      })

      const layout = computeDayLayout(
        dayEvents.map(ev => ({ id: ev.id, start_time: ev.start_time, end_time: ev.end_time })),
        dayStartMs,
        dayEndMs,
        SLOT_HEIGHT,
        slotDurationMs
      )

      return { dayEvents, layout }
    })
  }, [eventsInWeek, timeInterval, startHour, endHour, weekDays])

  // Assign colors: use network color if resolved, otherwise hash to fallback palette
  const eventColors = useMemo(() => {
    const fallbackPalette = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#14B8A6']
    const map = new Map<string, string>()
    // Track fallback index for events without a network
    const calTitleColors = new Map<string, string>()
    let fallbackIdx = 0

    for (const ev of events) {
      const netId = eventNetworkMap.get(ev.id)
      if (netId) {
        const net = networkMap.get(netId)
        if (net) {
          map.set(ev.id, net.color)
          continue
        }
      }
      // Fallback: same calendar_title gets same color, else hash by title
      const groupKey = ev.calendar_title || ev.title
      if (!calTitleColors.has(groupKey)) {
        calTitleColors.set(groupKey, fallbackPalette[fallbackIdx % fallbackPalette.length])
        fallbackIdx++
      }
      map.set(ev.id, calTitleColors.get(groupKey)!)
    }
    return map
  }, [events, eventNetworkMap, networkMap])

  const getEventColor = (ev: PublicEvent) => eventColors.get(ev.id) || '#6B7280'

  // ─── Network Cards ──────────────────────────────────────

  const networks = useMemo(() => {
    const now = Date.now()
    // Build network list: resolved networks + unresolved calendar_titles
    const netStats = new Map<string, { count: number; hasUpcoming: boolean; isInVisibleWeek: boolean }>()
    const unresolvedTitles = new Map<string, { name: string; count: number; color: string; hasUpcoming: boolean; isInVisibleWeek: boolean }>()
    const fallbackPalette = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#14B8A6']
    let fallbackIdx = 0

    for (const ev of events) {
      const hasUpcoming = new Date(ev.end_time).getTime() >= now
      const isInVisibleWeek = new Date(ev.start_time) < weekEnd && new Date(ev.end_time) > currentWeekStart
      const netId = eventNetworkMap.get(ev.id)
      if (netId && networkMap.has(netId)) {
        const existing = netStats.get(netId)
        if (existing) {
          existing.count += 1
          existing.hasUpcoming = existing.hasUpcoming || hasUpcoming
          existing.isInVisibleWeek = existing.isInVisibleWeek || isInVisibleWeek
        } else {
          netStats.set(netId, { count: 1, hasUpcoming, isInVisibleWeek })
        }
      } else {
        const name = ev.calendar_title
        if (!name) continue
        if (!unresolvedTitles.has(name)) {
          unresolvedTitles.set(name, {
            name,
            count: 0,
            color: fallbackPalette[fallbackIdx % fallbackPalette.length],
            hasUpcoming: false,
            isInVisibleWeek: false,
          })
          fallbackIdx++
        }
        const existing = unresolvedTitles.get(name)!
        existing.count += 1
        existing.hasUpcoming = existing.hasUpcoming || hasUpcoming
        existing.isInVisibleWeek = existing.isInVisibleWeek || isInVisibleWeek
      }
    }

    const resolved = Array.from(netStats.entries())
      .filter(([, stats]) => stats.hasUpcoming || stats.isInVisibleWeek)
      .map(([netId, stats]) => {
      const net = networkMap.get(netId)!
      return { id: netId, name: net.name, count: stats.count, color: net.color, isNetwork: true }
    })

    const unresolved = Array.from(unresolvedTitles.values())
      .filter((title) => title.hasUpcoming || title.isInVisibleWeek)
      .map(t => ({
        id: `cal_${t.name}`,
        name: t.name,
        count: t.count,
        color: t.color,
        isNetwork: false,
      }))

    return [...resolved.sort((a, b) => a.name.localeCompare(b.name)), ...unresolved.sort((a, b) => a.name.localeCompare(b.name))]
  }, [events, currentWeekStart, eventNetworkMap, networkMap, weekEnd])

  // Detect if network cards overflow the collapsed container
  useEffect(() => {
    const el = networksContainerRef.current
    if (!el) { setNetworksOverflow(false); return }
    setNetworksOverflow(el.scrollHeight > 66)
  }, [networks])

  useEffect(() => {
    const el = networksStickyRef.current
    if (!el) {
      setNetworksStickyHeight(0)
      return
    }

    const updateHeight = () => {
      setNetworksStickyHeight(el.getBoundingClientRect().height)
    }

    updateHeight()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateHeight)
      return () => window.removeEventListener('resize', updateHeight)
    }

    const observer = new ResizeObserver(updateHeight)
    observer.observe(el)
    window.addEventListener('resize', updateHeight)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateHeight)
    }
  }, [networks.length, networksExpanded, networksOverflow])

  const toggleNetwork = (id: string) => {
    setSelectedNetworks(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
        const targetWeekStart = nextWeekStartByNetwork.get(id)
        if (targetWeekStart) {
          setCurrentWeekStart(targetWeekStart)
          setHighlightedSlotEvents(null)
        }
      }
      return next
    })
  }

  const weekHasSelectedNetwork = useCallback((weekStart: Date) => {
    if (selectedNetworks.size === 0) return true

    const weekEnd = addDays(weekStart, 7)

    for (const ev of events) {
      const evStart = new Date(ev.start_time)
      const evEnd = new Date(ev.end_time)
      if (evStart >= weekEnd || evEnd <= weekStart) continue

      const netId = eventNetworkMap.get(ev.id)
      if (netId && selectedNetworks.has(netId)) return true

      if (ev.calendar_title) {
        const calKey = `cal_${ev.calendar_title}`
        if (selectedNetworks.has(calKey)) return true
      }
    }

    return false
  }, [events, eventNetworkMap, selectedNetworks])

  /** Networks that contain events matching the current search query */
  const searchMatchedNetworks = useMemo(() => {
    if (!searchQuery.trim()) return new Set<string>()
    const q = searchQuery.trim().toLowerCase()
    const matched = new Set<string>()
    for (const ev of events) {
      const calTitle = (ev.calendar_title || '').toLowerCase()
      const meetTitle = ev.title.toLowerCase()
      const desc = (ev.description || '').toLowerCase()
      const netId = eventNetworkMap.get(ev.id)
      const netName = netId ? (networkMap.get(netId)?.name || '').toLowerCase() : ''
      if (calTitle.includes(q) || meetTitle.includes(q) || desc.includes(q) || netName.includes(q)) {
        if (netId && networkMap.has(netId)) {
          matched.add(netId)
        } else if (ev.calendar_title) {
          matched.add(`cal_${ev.calendar_title}`)
        }
      }
    }
    return matched
  }, [searchQuery, events, eventNetworkMap, networkMap])

  /** Whether we're in filtered mode (at least one network selected) */
  const isNetworkFiltered = selectedNetworks.size > 0

  /** Get the display label for an event chip */
  const getChipLabel = (ev: GroupedPublicEvent) => {
    return resolveMeetingTitle({ title: ev.title, calendarTitle: ev.calendar_title })
  }

  /** Highlight meetings for a slot. Used by right-click and tap actions. */
  const highlightSlotMeetings = useCallback((dayIdx: number, utcHour: string) => {
    const day = weekDays[dayIdx]
    const [h, m] = utcHour.split(':').map(Number)
    const slotStartMs = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0)
    const slotEndMs = slotStartMs + timeInterval * 60 * 1000

    const matches = eventsInWeek.filter(ev => {
      const evStart = new Date(ev.start_time).getTime()
      const evEnd = new Date(ev.end_time).getTime()
      return evStart < slotEndMs && evEnd > slotStartMs
    })

    if (matches.length === 0) {
      setHighlightedSlotEvents(null)
      return
    }

    const label = `${format(day, 'EEE, MMM d')} at ${convertUtcTimeToTimezone(utcHour, tzState.primary)}`
    setHighlightedSlotLabel(label)
    setHighlightedSlotEvents(matches)

    // Scroll the highlight bar into view
    requestAnimationFrame(() => {
      highlightBarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [weekDays, eventsInWeek, timeInterval, tzState.primary])

  const handleSlotContextMenu = useCallback((e: React.MouseEvent, dayIdx: number, utcHour: string) => {
    e.preventDefault()
    highlightSlotMeetings(dayIdx, utcHour)
  }, [highlightSlotMeetings])

  const formatUTC = (iso: string, fmt: string) => {
    const d = new Date(iso)
    const utc = new Date(d.getTime() + d.getTimezoneOffset() * 60000)
    return format(utc, fmt)
  }

  // Week navigation
  const goToPrevWeek = () => { setCurrentWeekStart(prev => subWeeks(prev, 1)); setHighlightedSlotEvents(null) }
  const goToNextWeek = () => { setCurrentWeekStart(prev => addWeeks(prev, 1)); setHighlightedSlotEvents(null) }
  const goToToday = () => {
    const todayWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    setCurrentWeekStart(todayWeekStart)
    setHighlightedSlotEvents(null)

    if (!weekHasSelectedNetwork(todayWeekStart)) {
      setSelectedNetworks(new Set())
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-background p-2 md:p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="mb-2 md:mb-4">
        <div className="flex flex-col gap-2">
          <div className={`flex ${isPhoneViewport ? 'flex-col items-start gap-2' : 'items-center justify-between'}`}>
            <div className="flex items-center gap-2">
              <CalendarDays className="w-5 h-5 md:w-6 md:h-6 text-blue-600" />
              <h1 className="text-base md:text-2xl font-bold">Events Calendar</h1>
            </div>
            <div className={`flex items-center gap-2 flex-wrap ${isPhoneViewport ? 'w-full' : 'justify-end'}`}>
              <Link
                to={isAuthenticated ? '/coordinate-events' : '/auth/login'}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors w-full sm:w-auto"
              >
                <Calendar className="w-3.5 h-3.5" />
                {isAuthenticated ? 'Your Calendar' : 'Sign in to Coordinate'}
              </Link>
              {isAdmin && (
                <Link
                  to="/admin/network-relations"
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-sky-100 text-sky-700 hover:bg-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:hover:bg-sky-900/50 transition-colors w-full sm:w-auto"
                >
                  <LinkIcon className="w-3.5 h-3.5" />
                  Network Relations
                </Link>
              )}
            </div>
          </div>
          <p className={`text-muted-foreground ${isPhoneViewport ? 'text-xs' : 'text-sm'}`}>
            All public events shared by the community. {events.length} event{events.length !== 1 ? 's' : ''} published.
          </p>
          <div className={`flex gap-3 flex-wrap ${isPhoneViewport ? 'flex-col items-stretch' : 'items-center'}`}>
            <TimezoneSelector timezones={tzState} />
            {/* Search box */}
            <div className={`relative ${isPhoneViewport ? 'w-full' : 'flex-1 min-w-[200px] max-w-sm'}`}>
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search calendars, meetings, networks..."
                className="w-full pl-8 pr-8 py-1.5 text-sm border border-border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted transition-colors"
                >
                  <X className="w-3 h-3 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Network Cards */}
      {!loading && networks.length > 0 && (
        <div ref={networksStickyRef} className="mb-2 sticky top-0 z-20 bg-background py-1 -mx-2 px-2 md:-mx-6 md:px-6 border-b border-border/50">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <Network className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs font-semibold text-muted-foreground">Networks</span>
              <span className="text-[10px] text-muted-foreground/60">({networks.length})</span>
            </div>
            {networksOverflow && (
              <button
                onClick={() => setNetworksExpanded(prev => !prev)}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded transition-colors"
              >
                {networksExpanded ? 'Show less' : 'Show all'}
                {networksExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            )}
          </div>
          <div
            ref={networksContainerRef}
            className="flex flex-wrap gap-1.5 overflow-hidden transition-all duration-300"
            style={{ maxHeight: networksExpanded ? `${Math.ceil(networks.length / 6) * 34}px` : '66px' }}
          >
            {(() => {
              const properNets = networks.filter(n => n.isNetwork)
              const calNets = networks.filter(n => !n.isNetwork)
              return (
                <>
                  {properNets.map(net => {
                    const isSelected = selectedNetworks.has(net.id)
                    const isSearchMatch = searchMatchedNetworks.size > 0 && searchMatchedNetworks.has(net.id)
                    return (
                      <button
                        key={net.id}
                        onClick={() => toggleNetwork(net.id)}
                        aria-label={net.name}
                        className="flex items-center gap-1.5 w-[140px] px-2 py-1.5 rounded-md text-[11px] font-medium transition-all border"
                        style={{
                          backgroundColor: isSelected ? `${net.color}25` : isSearchMatch ? `${net.color}15` : 'transparent',
                          borderColor: isSelected ? net.color : isSearchMatch ? `${net.color}80` : 'var(--border)',
                          color: isSelected || isSearchMatch ? net.color : 'var(--muted-foreground)',
                          boxShadow: isSearchMatch && !isSelected ? `0 0 6px ${net.color}30` : 'none',
                        }}
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: net.color, opacity: isSelected || isSearchMatch ? 1 : 0.4 }}
                        />
                        <span className="truncate flex-1 text-left">{net.name}</span>
                        <span className="opacity-50 shrink-0">{net.count}</span>
                      </button>
                    )
                  })}
                  {calNets.length > 0 && (
                    <>
                      {properNets.length > 0 && (
                        <div className="w-full flex items-center gap-2 mt-0.5">
                          <div className="h-px flex-1 bg-border" />
                          <span className="text-[10px] text-muted-foreground/60 whitespace-nowrap">Member calendars</span>
                          <div className="h-px flex-1 bg-border" />
                        </div>
                      )}
                      {calNets.map(net => {
                        const isSelected = selectedNetworks.has(net.id)
                        const isSearchMatch = searchMatchedNetworks.size > 0 && searchMatchedNetworks.has(net.id)
                        return (
                          <button
                            key={net.id}
                            onClick={() => toggleNetwork(net.id)}
                            aria-label={net.name}
                            className="flex items-center gap-1.5 w-[140px] px-2 py-1.5 rounded-md text-[11px] font-medium transition-all border border-dashed"
                            style={{
                              backgroundColor: isSelected ? `${net.color}25` : isSearchMatch ? `${net.color}15` : 'transparent',
                              borderColor: isSelected ? net.color : isSearchMatch ? `${net.color}80` : 'var(--border)',
                              color: isSelected || isSearchMatch ? net.color : 'var(--muted-foreground)',
                              boxShadow: isSearchMatch && !isSelected ? `0 0 6px ${net.color}30` : 'none',
                            }}
                          >
                            <span
                              className="w-2.5 h-2.5 rounded-sm shrink-0"
                              style={{ backgroundColor: net.color, opacity: isSelected || isSearchMatch ? 1 : 0.4 }}
                            />
                            <span className="truncate flex-1 text-left">{net.name}</span>
                            <span className="opacity-50 shrink-0">{net.count}</span>
                          </button>
                        )
                      })}
                    </>
                  )}
                </>
              )
            })()}
          </div>
        </div>
      )}

      {/* Week Navigation */}
      <div className="flex items-center mb-2 px-1">
        <button aria-label="Previous week" onClick={goToPrevWeek} className="p-1.5 rounded-md hover:bg-accent/50 transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 text-center">
          <span className="text-sm font-semibold">
            {format(currentWeekStart, 'MMM d')} &ndash; {format(addDays(currentWeekStart, 6), 'MMM d, yyyy')}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={goToToday}
            className="px-3 py-1 text-xs font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 transition-colors shadow-sm"
          >
            Today
          </button>
          <button aria-label="Next week" onClick={goToNextWeek} className="p-1.5 rounded-md hover:bg-accent/50 transition-colors">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {isPhoneViewport && (
        <p className="mb-2 px-1 text-[11px] text-muted-foreground">
          Tip: tap a time slot to see meetings in that window.
        </p>
      )}

      {/* Highlighted Meetings Bar (shown after slot tap/right-click) */}
      {highlightedSlotEvents && highlightedSlotEvents.length > 0 && (
        <div
          ref={highlightBarRef}
          className="mb-2 border border-blue-300 dark:border-blue-700 rounded-lg bg-blue-50/80 dark:bg-blue-950/40 p-3 animate-in fade-in slide-in-from-top-2 duration-200"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span className="text-sm font-semibold text-blue-800 dark:text-blue-200">
                Meetings at {highlightedSlotLabel}
              </span>
              <span className="text-[10px] text-blue-600/60 dark:text-blue-400/60 bg-blue-100 dark:bg-blue-900/50 px-1.5 py-0.5 rounded-full">
                {highlightedSlotEvents.length}
              </span>
            </div>
            <button
              onClick={() => setHighlightedSlotEvents(null)}
              className="p-1 rounded hover:bg-blue-200/50 dark:hover:bg-blue-800/50 transition-colors"
            >
              <X className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {highlightedSlotEvents.map(ev => {
              const color = getEventColor(ev)
              const displayTitle = resolveMeetingTitle({ title: ev.title, calendarTitle: ev.calendar_title })
              return (
                <button
                  key={ev.id}
                  onClick={() => { setSelectedEvent(ev); setHighlightedSlotEvents(null) }}
                  onMouseEnter={() => setHoveredEventTitle(ev.title)}
                  onMouseLeave={() => setHoveredEventTitle(null)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent/50 transition-all shadow-sm hover:shadow-md"
                  style={{ borderLeft: `4px solid ${color}` }}
                >
                  <div className="text-left">
                    <div className="text-xs font-semibold truncate max-w-[200px]" style={{ color }}>{displayTitle}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {formatUTC(ev.start_time, 'HH:mm')} - {formatUTC(ev.end_time, 'HH:mm')} UTC - {getSourceCountLabel(ev)}
                    </div>
                    {ev.calendar_title && (
                      <div className="text-[9px] text-muted-foreground/70 truncate max-w-[200px]">{ev.calendar_title}</div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Calendar Grid */}
      <div className="flex flex-1 min-h-0 flex-col border border-border rounded-lg bg-card">
        {loading ? (
          <div className="flex items-center justify-center h-full min-h-[300px]">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : eventsInWeek.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center p-6">
            <CalendarDays className="w-12 h-12 text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground font-medium">No public events this week</p>
            <p className="text-xs text-muted-foreground mt-1">Use the week navigation arrows to check other weeks.</p>
          </div>
        ) : (
          <div className="min-w-[700px] flex flex-1 min-h-0 flex-col">
            {/* Day headers */}
            <div
              className="sticky z-10 grid bg-background border-b border-border"
              style={{
                top: networks.length > 0 ? `${networksStickyHeight}px` : 0,
                gridTemplateColumns: `${tzState.additional.length > 0 ? `repeat(${tzState.additional.length}, 62px) ` : ''}60px ${daySlots.map((s) => (s.type === 'dst' ? '62px' : '1fr')).join(' ')}`,
              }}
            >
              {/* Additional timezone column headers */}
              {tzState.additional.map((iana) => {
                const entry = findTimezone(iana)
                const label = entry ? entry.city : iana
                const abbr = entry ? entry.abbr : ''
                const ct = getCurrentTimeInTimezone(iana)
                return (
                  <div key={`hdr-tz-${iana}`} className="p-1 text-xs text-muted-foreground text-center border-r border-border/50 flex flex-col items-center justify-between">
                    <span className="text-[9px] font-semibold opacity-60 truncate max-w-full">{label}</span>
                    <span className="text-[9px] opacity-50">{abbr}</span>
                    <span className="font-mono tabular-nums text-[10px]">
                      {ct.split(':')[0]}<span style={{ animation: 'blink-colon 1s step-start infinite' }}>:</span>{ct.split(':')[1]}
                    </span>
                  </div>
                )
              })}
              {/* Primary timezone column header */}
              {(() => {
                const isUtc = tzState.primary === 'UTC'
                const entry = findTimezone(tzState.primary)
                const label = isUtc ? 'UTC' : (entry ? entry.city : tzState.primary)
                const abbr = isUtc ? '' : (entry ? entry.abbr : '')
                const ct = isUtc
                  ? `${utcNow.getUTCHours().toString().padStart(2, '0')}:${utcNow.getUTCMinutes().toString().padStart(2, '0')}`
                  : getCurrentTimeInTimezone(tzState.primary)
                return (
                  <div className="p-2 text-xs text-blue-600 dark:text-blue-400 font-medium border-r border-border flex flex-col items-end justify-between">
                    <span className="text-[10px] font-bold">{label}</span>
                    {abbr && <span className="text-[9px] opacity-70">{abbr}</span>}
                    <style>{`@keyframes blink-colon { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }`}</style>
                    <span className="font-mono tabular-nums font-semibold">
                      {ct.split(':')[0]}<span style={{ animation: 'blink-colon 1s step-start infinite' }}>:</span>{ct.split(':')[1]}
                    </span>
                  </div>
                )
              })()}
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
                const isToday = isSameDay(day, new Date())
                return (
                  <div
                    key={day.toISOString()}
                    className={`p-2 text-center text-xs font-medium border-r border-border last:border-r-0 ${
                      isToday ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300' : 'text-muted-foreground'
                    }`}
                  >
                    <div>{format(day, 'EEE')}</div>
                    <div className={`text-lg font-bold ${isToday ? 'text-blue-600 dark:text-blue-400' : 'text-foreground'}`}>
                      {format(day, 'd')}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Time slots + events overlay */}
            <div ref={calendarGridRef} className="flex-1 min-h-0 overflow-auto" style={{ position: 'relative' }}>
              {/* Grid background rows */}
              {timeSlots.map((time) => (
                <div
                  key={time}
                  className="grid border-b border-border last:border-b-0"
                  style={{ gridTemplateColumns: `${tzState.additional.length > 0 ? `repeat(${tzState.additional.length}, 62px) ` : ''}60px ${daySlots.map((s) => (s.type === 'dst' ? '62px' : '1fr')).join(' ')}`, height: SLOT_HEIGHT }}
                >
                  {/* Additional timezone time labels */}
                  {tzState.additional.map((iana) => (
                    <div key={`tz-${iana}-${time}`} className="p-1 text-[10px] text-muted-foreground text-center border-r border-border/50 font-mono tabular-nums flex items-start justify-center pt-1">
                      {convertUtcTimeToTimezone(time, iana)}
                    </div>
                  ))}
                  {/* Primary timezone time label */}
                  <div className="p-1 text-[10px] text-blue-600 dark:text-blue-400 font-semibold font-mono tabular-nums border-r border-border flex items-start justify-end pr-2 pt-1">
                    {formatTimeLabel(time)}
                  </div>
                  {daySlots.map((slot, slotIdx) => {
                    if (slot.type === 'dst') {
                      const t = slot.transition
                      const dstTime = convertUtcTimeToTimezoneOnDate(time, t.iana, weekDays[t.transitionDayIndex])
                      const beforeDay = t.transitionDayIndex > 0 ? weekDays[t.transitionDayIndex - 1] : weekDays[0]
                      const beforeTime = convertUtcTimeToTimezoneOnDate(time, t.iana, beforeDay)
                      const isChanged = dstTime !== beforeTime
                      return (
                        <div key={`dst-${t.iana}-${time}-${slotIdx}`} className={`p-1 text-[10px] text-center border-l border-amber-400 font-mono tabular-nums flex items-start justify-center pt-1 ${
                          isChanged
                            ? 'bg-amber-50/40 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300 font-semibold'
                            : 'text-muted-foreground/40'
                        }`}>
                          {dstTime}
                        </div>
                      )
                    }
                    const day = slot.day
                    const isToday = isSameDay(day, new Date())
                    return (
                      <div
                        key={slot.dayIdx}
                        onClick={() => highlightSlotMeetings(slot.dayIdx, time)}
                        onContextMenu={(e) => handleSlotContextMenu(e, slot.dayIdx, time)}
                        className={`border-r border-border last:border-r-0 cursor-pointer ${
                          isToday ? 'bg-blue-50/30 dark:bg-blue-950/10' : ''
                        }`}
                      />
                    )
                  })}
                </div>
              ))}

              {/* Events overlay */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 60 + (tzState.additional.length * 62),
                  right: 0,
                  height: timeSlots.length * SLOT_HEIGHT,
                  pointerEvents: 'none',
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: daySlots.map((s) => (s.type === 'dst' ? '62px' : '1fr')).join(' '), height: '100%' }}>
                  {daySlots.map((slot, slotIdx) => {
                    if (slot.type === 'dst') {
                      return <div key={`overlay-dst-${slotIdx}`} />
                    }
                    const dayIdx = slot.dayIdx
                    const { dayEvents, layout } = dayLayouts[dayIdx]
                    return (
                      <div
                        key={dayIdx}
                        style={{ position: 'relative' }}
                        className="border-r border-transparent last:border-r-0"
                      >
                        {/* Event segments */}
                        {layout.eventSegments.map((seg, i) => {
                          const ev = dayEvents[seg.eventIndex]
                          if (!ev) return null
                          const color = getEventColor(ev)
                          const chipLabel = getChipLabel(ev)
                          const isHovered = hoveredEventTitle !== null && ev.title === hoveredEventTitle
                          return (
                            <button
                              key={`${seg.eventId}-${i}`}
                              onClick={() => {
                                // Always open details on primary click so descriptions are accessible.
                                setSelectedEvent(ev)
                              }}
                              onContextMenu={(e) => {
                                const evStartHour = new Date(ev.start_time).getUTCHours()
                                const utcHour = `${evStartHour.toString().padStart(2, '0')}:00`
                                handleSlotContextMenu(e, dayIdx, utcHour)
                              }}
                              onMouseEnter={() => setHoveredEventTitle(ev.title)}
                              onMouseLeave={() => setHoveredEventTitle(null)}
                              className="flex flex-col items-start justify-start px-1 rounded-sm text-[10px] leading-tight transition-all overflow-hidden"
                              style={{
                                position: 'absolute',
                                top: seg.top,
                                height: Math.max(seg.height, 4),
                                left: `calc(${seg.leftPercent}% + 1px)`,
                                width: `calc(${seg.widthPercent}% - 2px)`,
                                pointerEvents: 'auto',
                                backgroundColor: isHovered ? `${color}40` : `${color}20`,
                                borderLeft: `3px solid ${color}`,
                                color: color,
                                zIndex: isHovered ? 10 : 5,
                                boxShadow: isHovered ? `0 0 8px ${color}40` : 'none',
                                transform: isHovered ? 'scale(1.02)' : 'scale(1)',
                              }}
                              title={`${chipLabel} -- click for details`}
                            >
                              {seg.isFirstSegment && (
                                <>
                                  <span className="block truncate font-medium pt-0.5 max-w-full">{chipLabel}</span>
                                  {isNetworkFiltered && (
                                    <div className="text-[9px] opacity-70 truncate max-w-full">
                                      {formatUTC(ev.start_time, 'HH:mm')} \u2013 {formatUTC(ev.end_time, 'HH:mm')} - {getSourceCountLabel(ev)}
                                    </div>
                                  )}
                                </>
                              )}
                            </button>
                          )
                        })}

                        {/* Overflow segments (+N Meetings) */}
                        {layout.overflowSegments.map((seg, i) => {
                          const overflowEvs = seg.eventIndices.map(idx => dayEvents[idx]).filter(Boolean)
                          return (
                            <button
                              key={`overflow-${i}`}
                              onClick={() => setOverflowPanelEvents(overflowEvs)}
                              className="text-left px-1 rounded-sm text-[10px] leading-tight font-medium transition-colors hover:opacity-80 overflow-hidden"
                              style={{
                                position: 'absolute',
                                top: seg.top,
                                height: Math.max(seg.height, 16),
                                left: `calc(${seg.leftPercent}% + 1px)`,
                                width: `calc(${seg.widthPercent}% - 2px)`,
                                pointerEvents: 'auto',
                                backgroundColor: '#6B728020',
                                borderLeft: '3px solid #6B7280',
                                color: '#6B7280',
                                zIndex: 5,
                              }}
                              title={`${seg.count} more meeting${seg.count !== 1 ? 's' : ''}`}
                            >
                              <span className="block truncate pt-0.5">+{seg.count} Meeting{seg.count !== 1 ? 's' : ''}</span>
                            </button>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </div>

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
        )}
      </div>

      {/* Overflow Panel Modal */}
      {overflowPanelEvents && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setOverflowPanelEvents(null)}>
          <div className="bg-card text-card-foreground rounded-lg p-5 max-w-md w-full mx-4 shadow-xl border border-border" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold">Overlapping Meetings</h2>
              <button onClick={() => setOverflowPanelEvents(null)} className="p-1 rounded hover:bg-muted transition-colors shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 max-h-[60vh] overflow-auto">
              {overflowPanelEvents.map(ev => {
                const color = getEventColor(ev)
                return (
                  <button
                    key={ev.id}
                    onClick={() => { setOverflowPanelEvents(null); setSelectedEvent(ev) }}
                    className="w-full text-left p-3 rounded-lg border border-border hover:bg-accent/50 transition-colors"
                    style={{ borderLeft: `4px solid ${color}` }}
                  >
                    <div className="font-medium text-sm" style={{ color }}>{getChipLabel(ev)}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatUTC(ev.start_time, 'EEE, MMM d')} ·{' '}
                      {formatUTC(ev.start_time, 'HH:mm')} – {formatUTC(ev.end_time, 'HH:mm')} - {getSourceCountLabel(ev)}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Event Details Modal */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setSelectedEvent(null)}>
          <div className="bg-card text-card-foreground rounded-lg p-5 max-w-md w-full mx-4 my-4 max-h-[90vh] overflow-y-auto shadow-xl border border-border" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-bold pr-4">{resolveMeetingTitle({ title: selectedEvent.title, calendarTitle: selectedEvent.calendar_title })}</h2>
              <button onClick={() => setSelectedEvent(null)} className="p-1 rounded hover:bg-muted transition-colors shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Network / Calendar source label */}
            {(() => {
              const netId = eventNetworkMap.get(selectedEvent.id)
              const net = netId ? networkMap.get(netId) : null
              const label = net?.name || selectedEvent.calendar_title
              if (!label) return null
              return (
                <div className="flex items-center gap-1.5 mb-3">
                  <Network className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground font-medium">{label}</span>
                </div>
              )
            })()}

            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="w-4 h-4 shrink-0" />
                <span>
                  {formatUTC(selectedEvent.start_time, 'EEE, MMM d, yyyy')} &middot;{' '}
                  {formatUTC(selectedEvent.start_time, 'HH:mm')} &ndash;{' '}
                  {formatUTC(selectedEvent.end_time, 'HH:mm')}
                </span>
              </div>

              {selectedEvent.source_labels.length > 1 && (
                <p className="text-[11px] text-muted-foreground">
                  Merged from {selectedEvent.source_labels.length} source{selectedEvent.source_labels.length !== 1 ? 's' : ''}.
                </p>
              )}

              {selectedEvent.description && (
                <p className="text-muted-foreground text-xs whitespace-pre-wrap break-all border-l-2 border-border pl-3 py-1">
                  <LinkifyText text={selectedEvent.description} />
                </p>
              )}

              {isSafeUrl(selectedEvent.meeting_link) && (
                <div className="flex items-center gap-2">
                  <a
                    href={selectedEvent.meeting_link ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-blue-600 hover:underline text-sm font-medium min-w-0 break-all"
                  >
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                    Join Meeting
                  </a>
                  <button
                    onClick={() => { navigator.clipboard.writeText(selectedEvent.meeting_link!); setCopiedLink(true); setTimeout(() => setCopiedLink(false), 2000) }}
                    className="p-1 rounded hover:bg-muted transition-colors shrink-0"
                    title="Copy link"
                  >
                    {copiedLink ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
                  </button>
                </div>
              )}

              {selectedEvent.location && (
                <div className="text-xs text-muted-foreground">
                  <span className="mr-1">📍</span>
                  <LinkifyText text={selectedEvent.location} />
                </div>
              )}

              <div className="text-xs text-muted-foreground border-t border-border pt-2 mt-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="w-3.5 h-3.5 shrink-0" />
                    {getSourceCountLabel(selectedEvent)}
                  </span>
                  <button
                    onClick={() => setSelectedEventSourcesExpanded(prev => !prev)}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border hover:bg-accent/50 transition-colors"
                  >
                    {selectedEventSourcesExpanded ? 'Hide sources' : 'Show sources'}
                    {selectedEventSourcesExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                </div>

                {selectedEventSourcesExpanded && (
                  <div className="mt-2 space-y-1">
                    {selectedEvent.source_labels.map(label => (
                      <div key={label} className="rounded px-2 py-1 bg-muted/60 text-foreground/90 text-[11px]">
                        {label}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Add to Calendar buttons */}
              <div className="flex items-center gap-2 border-t border-border pt-3 mt-3">
                <a
                  href={buildOutlookCalendarUrl({
                    title: resolveMeetingTitle({ title: selectedEvent.title, calendarTitle: selectedEvent.calendar_title }),
                    description: selectedEvent.description,
                    start_time: selectedEvent.start_time,
                    end_time: selectedEvent.end_time,
                    meeting_link: selectedEvent.meeting_link,
                    location: selectedEvent.location,
                  })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-[#0078d4] text-white hover:bg-[#106ebe] transition-colors"
                  title="Add to Outlook Calendar"
                >
                  <CalendarPlus className="w-4 h-4" />
                  Outlook
                </a>
                <button
                  onClick={() => downloadICSFile({
                    title: resolveMeetingTitle({ title: selectedEvent.title, calendarTitle: selectedEvent.calendar_title }),
                    description: selectedEvent.description,
                    start_time: selectedEvent.start_time,
                    end_time: selectedEvent.end_time,
                    meeting_link: selectedEvent.meeting_link,
                    location: selectedEvent.location,
                  })}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-muted text-foreground hover:bg-muted/80 transition-colors"
                  title="Download .ics file for Apple Calendar and others"
                >
                  <Download className="w-4 h-4" />
                  .ics
                </button>
                {googleOAuthSources.length === 1 ? (
                  <button
                    onClick={() => handleSyncToGoogle({
                      title: resolveMeetingTitle({ title: selectedEvent.title, calendarTitle: selectedEvent.calendar_title }), description: selectedEvent.description,
                      start_time: selectedEvent.start_time, end_time: selectedEvent.end_time,
                      meeting_link: selectedEvent.meeting_link, location: selectedEvent.location,
                    })}
                    disabled={syncingToGoogle}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
                    title={`Add to ${googleOAuthSources[0].display_name}`}
                  >
                    <CalendarPlus className="w-4 h-4" />
                    {syncingToGoogle ? 'Syncing...' : 'Add to Google'}
                  </button>
                ) : googleOAuthSources.length > 1 ? (
                  <button
                    onClick={() => setShowGoogleSyncPicker({
                      title: resolveMeetingTitle({ title: selectedEvent.title, calendarTitle: selectedEvent.calendar_title }), description: selectedEvent.description,
                      start_time: selectedEvent.start_time, end_time: selectedEvent.end_time,
                      meeting_link: selectedEvent.meeting_link, location: selectedEvent.location,
                    })}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                    title="Choose which Google Calendar to add to"
                  >
                    <CalendarPlus className="w-4 h-4" />
                    Add to Google
                  </button>
                ) : (
                  <a
                    href={`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(resolveMeetingTitle({ title: selectedEvent.title, calendarTitle: selectedEvent.calendar_title }))}&dates=${new Date(selectedEvent.start_time).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}/${new Date(selectedEvent.end_time).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}${selectedEvent.description ? `&details=${encodeURIComponent(selectedEvent.description)}` : ''}${selectedEvent.location ? `&location=${encodeURIComponent(selectedEvent.location)}` : selectedEvent.meeting_link ? `&location=${encodeURIComponent(selectedEvent.meeting_link)}` : ''}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                    title="Add to Google Calendar"
                  >
                    <CalendarPlus className="w-4 h-4" />
                    Google Calendar
                  </a>
                )}
              </div>

              {/* Meeting page link */}
              {selectedEvent.source_type === 'coordination_calendar' && selectedEvent.id.startsWith('coord_') && (
                <div className="mt-2">
                  <Link
                    to={`/meeting/${selectedEvent.id.replace('coord_', '')}`}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-blue-600 bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-950/50 transition-colors w-full"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Meeting Page
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Google Calendar Sync Picker Modal */}
      {showGoogleSyncPicker && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[60]" onClick={() => { setShowGoogleSyncPicker(null); setSelectedSyncSourceIds(new Set()) }}>
          <div className="bg-card text-card-foreground rounded-lg p-5 max-w-sm w-full mx-4 shadow-xl border border-border" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold">Choose Calendar</h2>
              <button onClick={() => { setShowGoogleSyncPicker(null); setSelectedSyncSourceIds(new Set()) }} className="p-1 rounded hover:bg-muted transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground mb-3">Select which Google Calendar(s) to add "{showGoogleSyncPicker.title}" to:</p>
            <div className="space-y-2 mb-4">
              {googleOAuthSources.map(source => (
                <label key={source.id} className="flex items-center gap-2 p-2 rounded-md hover:bg-muted cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={selectedSyncSourceIds.has(source.id)}
                    onChange={() => setSelectedSyncSourceIds(prev => {
                      const next = new Set(prev)
                      if (next.has(source.id)) next.delete(source.id)
                      else next.add(source.id)
                      return next
                    })}
                    className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                  />
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: source.color }} />
                  <span className="text-sm truncate">{source.display_name}</span>
                </label>
              ))}
            </div>
            <button
              onClick={() => handleSyncToGoogle(showGoogleSyncPicker, Array.from(selectedSyncSourceIds))}
              disabled={selectedSyncSourceIds.size === 0 || syncingToGoogle}
              className="w-full flex items-center justify-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              <CalendarPlus className="w-4 h-4" />
              {syncingToGoogle ? 'Adding...' : `Add to ${selectedSyncSourceIds.size} Calendar(s)`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
