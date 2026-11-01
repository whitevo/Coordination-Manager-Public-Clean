import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { format, startOfWeek, addDays, addWeeks, subWeeks, isSameDay } from 'date-fns'
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Calendar, ExternalLink, X, Loader2, CalendarDays, Network, Download, CalendarPlus, Copy, Check, Search, LinkIcon, Flag } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { apiClient, dedupedGet } from '../lib/api-client'
import { computeDayLayout } from '../lib/calendarOverlapLayout'
import { downloadICSFile, buildOutlookCalendarUrl, isSafeUrl, resolveMeetingTitle } from '../lib/calendar-utils'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import TimezoneSelector from '../components/TimezoneSelector'
import { useTimezones } from '../lib/use-timezones'
import { findTimezone, convertUtcTimeToTimezone, convertUtcTimeToTimezoneOnDate, getCurrentTimeInTimezone, detectDstTransitions, type DstTransition } from '../lib/timezone-data'
import { subscribePublicEventsSync } from '../lib/public-events-sync'
import { expandRecurringPublicEvents, type PublicEvent } from '../lib/recurrence'
import EventFlagPanel, { type EventModerationTarget } from '../components/EventFlagPanel'
import { Dialog } from '../components/ui/Dialog'
import { IconButton } from '../components/ui/IconButton'
import { Button } from '../components/ui/Button'
import {
  networkFilterKey, resolveEventNetworkKeys, resolveNetworkFilterKey,
  type EventNetwork as NetworkDef, type EventNetworkMapping as NetworkMapping,
  type EventNetworkRule as NetworkRule, type EventNetworkAssignment,
  type EventNetworkCatalog, type EventNetworkSource,
} from '@/lib/event-network-relations'
import { isAxiosError } from 'axios'

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
            <a href={part} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{part}</a>
            <IconButton
              size="micro"
              intent={copiedUrl === part ? 'success' : 'neutral'}
              label="Copy link"
              icon={copiedUrl === part ? <Check /> : <Copy />}
              onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(part); setCopiedUrl(part); setTimeout(() => setCopiedUrl(null), 2000) }}
              className="align-middle"
            />
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}

const SLOT_HEIGHT = 48

/** Strip the "coord_" prefix and any "__occ__<timestamp>" recurrence suffix to recover the underlying meeting/event id */
function getBaseEventId(id: string): string {
  return id.replace(/__occ__.*$/, '').replace(/^coord_/, '')
}

// ─── Types ──────────────────────────────────────────────────

type TimeSession = { start_time: string; end_time: string }

type GroupedPublicEvent = PublicEvent & {
  sessions: TimeSession[]
  source_labels: string[]
  moderation_targets: EventModerationTarget[]
  network_inputs: PublicEvent[]
}

function getEventPriorityTime(ev: PublicEvent): number {
  if (ev.updated_at) {
    const updatedAt = new Date(ev.updated_at).getTime()
    if (Number.isFinite(updatedAt)) return updatedAt
  }
  if (ev.created_at) {
    const createdAt = new Date(ev.created_at).getTime()
    if (Number.isFinite(createdAt)) return createdAt
  }
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
      existing.network_inputs.push(ev)
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
      const mergedTargets = new Map(
        [...existing.moderation_targets, ...(ev.moderation_targets || [])]
          .map(target => [`${target.type}:${target.id}`, target]),
      )
      if (incomingPriority >= existingPriority) {
        Object.assign(existing, ev)
      }
      existing.moderation_targets = [...mergedTargets.values()]
    } else {
      groups.set(key, {
        ...ev,
        sessions: [{ start_time: ev.start_time, end_time: ev.end_time }],
        source_labels: [sourceLabel],
        moderation_targets: ev.moderation_targets || [],
        network_inputs: [ev],
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

const FALLBACK_COLOR_PALETTE = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#14B8A6']

/**
 * Deterministic color for an unresolved group key. Uses a stable hash of the
 * key so a network keeps the same color regardless of which week is visible
 * or the order events happen to load in.
 */
function getFallbackColorForKey(key: string): string {
  if (!key) return FALLBACK_COLOR_PALETTE[0]
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  }
  return FALLBACK_COLOR_PALETTE[hash % FALLBACK_COLOR_PALETTE.length]
}

// ─── Component ──────────────────────────────────────────────

export default function EventsCalendarPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedNetwork = searchParams.get('network')
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
  const [flagPanelEvent, setFlagPanelEvent] = useState<GroupedPublicEvent | null>(null)
  const [selectedEventSourcesExpanded, setSelectedEventSourcesExpanded] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  const [overflowPanelEvents, setOverflowPanelEvents] = useState<GroupedPublicEvent[] | null>(null)
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
  const [networkAssignments, setNetworkAssignments] = useState<EventNetworkAssignment[]>([])
  const [networkSources, setNetworkSources] = useState<EventNetworkSource[]>([])
  const [networkError, setNetworkError] = useState<string | null>(null)
  const [loadingNetworks, setLoadingNetworks] = useState(false)
  const sharedNetworkJumpRef = useRef<string | null>(null)

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

  const fetchPublicEvents = useCallback(async (opts?: { silent?: boolean }) => {
    // Ensure timestamps are treated as UTC (meetings table uses plain TIMESTAMP)
    const ensureUTC = (ts: string) =>
      ts && !ts.endsWith('Z') && !ts.includes('+') ? ts + 'Z' : ts

    if (!opts?.silent) {
      setLoading(true)
    }

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
      if (!opts?.silent) {
        setLoading(false)
      }
    }
  }, [])

  const fetchNetworkData = useCallback(async () => {
    setLoadingNetworks(true)
    const read = async <T,>(path: string, label: string) => {
      try {
        return await dedupedGet<T>(path)
      } catch (error) {
        const detail = isAxiosError<{ message?: string; error?: string }>(error)
          ? error.response?.data?.message || error.response?.data?.error || error.message
          : 'Unexpected response'
        const status = isAxiosError(error) && error.response ? `, HTTP ${error.response.status}` : ''
        throw new Error(`Network filters could not be loaded (${label}${status}): ${detail}`, { cause: error })
      }
    }
    try {
      const [nRes, mRes, rRes, aRes] = await Promise.all([
        read<Pick<EventNetworkCatalog, 'networks'>>('/api/network-relations/networks', 'networks'),
        read<Pick<EventNetworkCatalog, 'mappings'>>('/api/network-relations/mappings', 'direct mappings'),
        read<Pick<EventNetworkCatalog, 'rules'>>('/api/network-relations/rules', 'matching rules'),
        read<Pick<EventNetworkCatalog, 'assignments' | 'sources'>>('/api/network-relations/assignments', 'assignments and sources'),
      ])
      if (![nRes.data.networks, mRes.data.mappings, rRes.data.rules, aRes.data.assignments, aRes.data.sources].every(Array.isArray)) {
        throw new Error('Invalid network catalog response')
      }
      for (const rule of rRes.data.rules || []) {
        if (rule.match_type === 'regex') new RegExp(rule.pattern, 'i')
      }
      for (const network of nRes.data.networks) resolveNetworkFilterKey(network.id, nRes.data.networks)
      setNetworkDefs(nRes.data.networks)
      setNetworkMappings(mRes.data.mappings)
      setNetworkRules(rRes.data.rules)
      setNetworkAssignments(aRes.data.assignments)
      setNetworkSources(aRes.data.sources)
      setNetworkError(null)
    } catch (err) {
      console.error('Failed to fetch network relations:', err)
      const message = err instanceof Error ? err.message : 'Unexpected response'
      setNetworkError(message.startsWith('Network filters could not be loaded')
        ? message : `Network filters could not be loaded: ${message}`)
    } finally {
      setLoadingNetworks(false)
    }
  }, [])

  // Fetch public events and network relationships on initial mount.
  useEffect(() => {
    void fetchPublicEvents()
    void fetchNetworkData()
  }, [fetchPublicEvents, fetchNetworkData])

  // Refresh when other pages announce a successful sync.
  useEffect(() => {
    return subscribePublicEventsSync(() => {
      void fetchPublicEvents({ silent: true })
      void fetchNetworkData()
    })
  }, [fetchPublicEvents, fetchNetworkData])

  // Refresh on focus/visibility so stale tabs recover quickly.
  useEffect(() => {
    const onFocus = () => {
      void fetchPublicEvents({ silent: true })
      void fetchNetworkData()
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void fetchPublicEvents({ silent: true })
        void fetchNetworkData()
      }
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [fetchPublicEvents, fetchNetworkData])

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
  const networkMap = useMemo(() => new Map(networkDefs.map(n => [networkFilterKey(n), n])), [networkDefs])
  const filterSources = useMemo(() => {
    const sources = new Map(networkSources.map(source => [source.key, source]))
    for (const event of events) {
      for (const input of event.network_inputs) {
        if (input.network_source_key && input.calendar_title && !sources.has(input.network_source_key)) {
          sources.set(input.network_source_key, { key: input.network_source_key, name: input.calendar_title })
        }
      }
    }
    return [...sources.values()]
  }, [networkSources, events])
  const activeNetworkKey = selectedNetwork ? resolveNetworkFilterKey(selectedNetwork, networkDefs, filterSources) : null
  useEffect(() => {
    if (!selectedNetwork || !activeNetworkKey || selectedNetwork === activeNetworkKey) return
    const next = new URLSearchParams(searchParams)
    next.delete('network')
    next.set('network', activeNetworkKey)
    setSearchParams(next, { replace: true })
  }, [selectedNetwork, activeNetworkKey, searchParams, setSearchParams])

  /** Preserve memberships from every source represented by a merged meeting. */
  const eventNetworkMap = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const ev of events) {
      map.set(ev.id, resolveEventNetworkKeys({
        inputs: ev.network_inputs, networks: networkDefs, mappings: networkMappings,
        rules: networkRules, assignments: networkAssignments,
        sources: filterSources,
      }))
    }
    return map
  }, [events, networkDefs, networkMappings, networkRules, networkAssignments, filterSources])

  const nextWeekStartByNetwork = useMemo(() => {
    const now = Date.now()
    const map = new Map<string, Date>()

    for (const ev of events) {
      const evEndMs = new Date(ev.end_time).getTime()
      if (evEndMs < now) continue

      const evWeekStart = startOfWeek(new Date(ev.start_time), { weekStartsOn: 1 })
      for (const filterId of eventNetworkMap.get(ev.id) || []) {
        const existing = map.get(filterId)
        if (!existing || evWeekStart.getTime() < existing.getTime()) {
          map.set(filterId, evWeekStart)
        }
      }
    }

    return map
  }, [events, eventNetworkMap])

  useEffect(() => {
    if (!activeNetworkKey) {
      sharedNetworkJumpRef.current = null
      return
    }
    if (sharedNetworkJumpRef.current === activeNetworkKey) return
    const target = nextWeekStartByNetwork.get(activeNetworkKey)
    if (target) {
      sharedNetworkJumpRef.current = activeNetworkKey
      setCurrentWeekStart(target)
      setHighlightedSlotEvents(null)
    }
  }, [activeNetworkKey, nextWeekStartByNetwork])

  const setNetworkFilter = (key: string | null) => {
    const next = new URLSearchParams(searchParams)
    next.delete('network')
    if (key) next.set('network', key)
    setSearchParams(next)
  }

  const copyNetworkLink = async () => {
    try {
      const url = new URL(window.location.href)
      url.search = searchParams.toString()
      await navigator.clipboard.writeText(url.toString())
      showToast('Network filter link copied')
    } catch (error) {
      console.error('Failed to copy network filter link:', error)
      showToast('Could not copy the link. Copy it from your address bar instead.', 'error')
    }
  }

  // Events for current week, filtered by network and search
  const eventsInWeek = useMemo(() => {
    let filtered = events.filter(ev => {
      const evStart = new Date(ev.start_time)
      const evEnd = new Date(ev.end_time)
      return evStart < weekEnd && evEnd > currentWeekStart
    })

    // Network filter: if any networks are selected, only show matching events
    if (activeNetworkKey) {
      filtered = filtered.filter(ev => eventNetworkMap.get(ev.id)?.has(activeNetworkKey))
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      filtered = filtered.filter(ev => {
        const calTitle = ev.source_labels.join(' ').toLowerCase()
        const meetTitle = ev.title.toLowerCase()
        const desc = (ev.description || '').toLowerCase()
        // Also check resolved network name
        const netName = [...(eventNetworkMap.get(ev.id) || [])].map(key => networkMap.get(key)?.name || '').join(' ').toLowerCase()
        return calTitle.includes(q) || meetTitle.includes(q) || desc.includes(q) || netName.includes(q)
      })
    }

    return filtered
  }, [events, currentWeekStart, weekEnd, activeNetworkKey, searchQuery, eventNetworkMap, networkMap])

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

  // Assign colors: use network color if resolved, otherwise deterministic fallback
  const eventColors = useMemo(() => {
    const map = new Map<string, string>()

    for (const ev of events) {
      const memberships = eventNetworkMap.get(ev.id)
      const netId = activeNetworkKey && memberships?.has(activeNetworkKey) ? activeNetworkKey
        : [...(memberships || [])].find(key => networkMap.has(key))
      if (netId) {
        const net = networkMap.get(netId)
        if (net) {
          map.set(ev.id, net.color)
          continue
        }
      }
      // Fallback: same calendar_title gets same color via stable hash so it
      // never shifts when the visible week (and event window) changes.
      const groupKey = ev.calendar_title || ev.title
      map.set(ev.id, getFallbackColorForKey(groupKey))
    }
    return map
  }, [events, eventNetworkMap, networkMap, activeNetworkKey])

  const getEventColor = (ev: PublicEvent) => eventColors.get(ev.id) || '#6B7280'

  // ─── Network Cards ──────────────────────────────────────

  const networks = useMemo(() => {
    const now = Date.now()
    const stats = new Map<string, {
      id: string; name: string; color: string
      count: number; hasUpcoming: boolean; isInVisibleWeek: boolean
    }>()

    for (const ev of events) {
      const hasUpcoming = new Date(ev.end_time).getTime() >= now
      const isInVisibleWeek = new Date(ev.start_time) < weekEnd && new Date(ev.end_time) > currentWeekStart
      for (const key of eventNetworkMap.get(ev.id) || []) {
        const network = networkMap.get(key)
        const name = network?.name || filterSources.find(source => source.key === key)?.name
          || ev.network_inputs.find(input => input.network_source_key === key)?.calendar_title
          || (key.startsWith('cal_') ? key.slice(4) : null)
        if (!name) continue
        const existing = stats.get(key)
        if (existing) {
          existing.count += 1
          existing.hasUpcoming = existing.hasUpcoming || hasUpcoming
          existing.isInVisibleWeek = existing.isInVisibleWeek || isInVisibleWeek
        } else {
          stats.set(key, {
            id: key, name, color: network?.color || getFallbackColorForKey(name),
            count: 1, hasUpcoming, isInVisibleWeek,
          })
        }
      }
    }
    return [...stats.values()]
      .filter(network => network.hasUpcoming || network.isInVisibleWeek)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [events, currentWeekStart, eventNetworkMap, networkMap, filterSources, weekEnd])

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
    setNetworkFilter(activeNetworkKey === id ? null : id)
  }

  const weekHasSelectedNetwork = useCallback((weekStart: Date) => {
    if (!activeNetworkKey) return true

    const weekEnd = addDays(weekStart, 7)

    for (const ev of events) {
      const evStart = new Date(ev.start_time)
      const evEnd = new Date(ev.end_time)
      if (evStart >= weekEnd || evEnd <= weekStart) continue

      if (eventNetworkMap.get(ev.id)?.has(activeNetworkKey)) return true
    }

    return false
  }, [events, eventNetworkMap, activeNetworkKey])

  /** Networks that contain events matching the current search query */
  const searchMatchedNetworks = useMemo(() => {
    if (!searchQuery.trim()) return new Set<string>()
    const q = searchQuery.trim().toLowerCase()
    const matched = new Set<string>()
    for (const ev of events) {
      const calTitle = ev.source_labels.join(' ').toLowerCase()
      const meetTitle = ev.title.toLowerCase()
      const desc = (ev.description || '').toLowerCase()
      const memberships = eventNetworkMap.get(ev.id) || new Set<string>()
      const netName = [...memberships].map(key => networkMap.get(key)?.name || '').join(' ').toLowerCase()
      if (calTitle.includes(q) || meetTitle.includes(q) || desc.includes(q) || netName.includes(q)) {
        for (const key of memberships) matched.add(key)
      }
    }
    return matched
  }, [searchQuery, events, eventNetworkMap, networkMap])

  /** Whether we're in filtered mode (at least one network selected) */
  const isNetworkFiltered = Boolean(activeNetworkKey)

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
      setNetworkFilter(null)
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-background p-2 md:p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="mb-2 md:mb-4">
        <div className="flex flex-col gap-2">
          <div className={`flex ${isPhoneViewport ? 'flex-col items-start gap-2' : 'items-center justify-between'}`}>
            <div className="flex items-center gap-2">
              <CalendarDays className="w-5 h-5 md:w-6 md:h-6 text-info" />
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
              {isAuthenticated && (
                <Link
                  to="/admin/network-relations"
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-info-subtle text-info hover:bg-info-muted transition-colors w-full sm:w-auto"
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
                className="w-full pl-8 pr-8 py-1.5 text-sm border border-border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-ring"
              />
              {searchQuery && (
                <IconButton
                  label="Clear search"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-0.5 top-1/2 -translate-y-1/2"
                  icon={<X className="w-3 h-3" />}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Network Cards */}
      {networkError && (
        <div role="alert" className="mb-2 flex flex-wrap items-center gap-2 text-sm text-danger">
          <span>{networkError}</span>
          <Button emphasis="outline" size="compact" disabled={loadingNetworks} onClick={fetchNetworkData}>
            {loadingNetworks ? 'Retrying...' : 'Retry network filters'}
          </Button>
        </div>
      )}
      {activeNetworkKey && (
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="text-xs text-muted-foreground">
            Filtering: {networkMap.get(activeNetworkKey)?.name || networks.find(network => network.id === activeNetworkKey)?.name || 'Unavailable network'}
          </span>
          <Button emphasis="outline" size="compact" icon={<Copy />} onClick={copyNetworkLink}>Copy filter link</Button>
          <Button emphasis="ghost" size="compact" onClick={() => setNetworkFilter(null)}>Clear network filter</Button>
        </div>
      )}
      {!loading && networks.length > 0 && (
        <div ref={networksStickyRef} className="mb-2 sticky top-0 z-20 bg-background py-1 -mx-2 px-2 md:-mx-6 md:px-6 border-b border-border/50">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <Network className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs font-semibold text-muted-foreground">Networks</span>
              <span className="text-[10px] text-muted-foreground/60">({networks.length})</span>
            </div>
            {networksOverflow && (
              <Button
                emphasis="ghost"
                size="compact"
                onClick={() => setNetworksExpanded(prev => !prev)}
              >
                {networksExpanded ? 'Show less' : 'Show all'}
                {networksExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </Button>
            )}
          </div>
          <div
            ref={networksContainerRef}
            className={`flex flex-wrap gap-1.5 overflow-hidden transition-all duration-300 motion-reduce:transition-none ${networksExpanded ? '' : 'max-h-[66px]'}`}
          >
            {networks.map(net => {
              const isSelected = activeNetworkKey === net.id
              const isSearchMatch = searchMatchedNetworks.size > 0 && searchMatchedNetworks.has(net.id)
              return (
                <button
                  key={net.id}
                  onClick={() => toggleNetwork(net.id)}
                  aria-label={net.name}
                  aria-pressed={isSelected}
                  className="flex items-center gap-1.5 w-[140px] px-2 py-1.5 rounded-md text-[11px] font-medium transition-all motion-reduce:transition-none border"
                  style={{
                    backgroundColor: isSelected ? `${net.color}25` : isSearchMatch ? `${net.color}15` : 'transparent',
                    borderColor: isSelected ? net.color : isSearchMatch ? `${net.color}80` : 'hsl(var(--border))',
                    color: isSelected || isSearchMatch ? net.color : 'hsl(var(--muted-foreground))',
                    boxShadow: isSearchMatch && !isSelected ? `0 0 6px ${net.color}30` : 'none',
                  }}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: net.color, opacity: isSelected || isSearchMatch ? 1 : 0.4 }}
                  />
                  <span className="truncate flex-1 text-left" title={net.name}>{net.name}</span>
                  <span className="opacity-50 shrink-0">{net.count}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Week Navigation */}
      <div className="flex items-center mb-2 px-1">
        <style>{`@keyframes week-range-flash {
  0% { opacity: 0; transform: translateY(6px) scale(0.96); color: hsl(var(--info)); background-color: hsl(var(--info) / 0.28); box-shadow: 0 0 0 4px hsl(var(--info) / 0.18); }
  25% { opacity: 1; transform: translateY(0) scale(1.06); color: hsl(var(--info)); background-color: hsl(var(--info) / 0.28); }
  60% { transform: scale(1); color: hsl(var(--info)); background-color: hsl(var(--info) / 0.16); }
  100% { color: inherit; background-color: hsl(var(--info) / 0); box-shadow: 0 0 0 0 hsl(var(--info) / 0); transform: scale(1); }
}
@keyframes week-row-sweep {
  0% { background-color: hsl(var(--info) / 0.22); }
  40% { background-color: hsl(var(--info) / 0.14); }
  100% { background-color: transparent; }
}`}</style>
        <IconButton label="Previous week" showTitle={false} onClick={goToPrevWeek} icon={<ChevronLeft className="w-5 h-5" />} />
        <div className="flex-1 text-center">
          <span
            key={currentWeekStart.getTime()}
            className="inline-block text-sm font-semibold rounded-md px-2.5 py-1 animate-[week-range-flash_1200ms_ease-out_2]"
          >
            {format(currentWeekStart, 'MMM d')} &ndash; {format(addDays(currentWeekStart, 6), 'MMM d, yyyy')}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            emphasis="outline"
            size="compact"
            onClick={goToToday}
          >
            Today
          </Button>
          <IconButton label="Next week" showTitle={false} onClick={goToNextWeek} icon={<ChevronRight className="w-5 h-5" />} />
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
          className="mb-2 border border-info-muted rounded-lg bg-info-subtle p-3 animate-in fade-in slide-in-from-top-2 duration-200"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-info">
                Meetings at {highlightedSlotLabel}
              </span>
              <span className="text-[10px] text-info bg-info-subtle px-1.5 py-0.5 rounded-full">
                {highlightedSlotEvents.length}
              </span>
            </div>
            <IconButton
              label="Close meetings list"
              onClick={() => setHighlightedSlotEvents(null)}
              icon={<X className="w-3.5 h-3.5" />}
            />
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
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent/50 transition-all shadow-xs hover:shadow-md"
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
              key={currentWeekStart.getTime()}
              className="sticky z-10 grid bg-background border-b border-border animate-[week-row-sweep_1050ms_ease-out_2]"
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
                  <div className="p-2 text-xs text-primary font-medium border-r border-border flex flex-col items-end justify-between">
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
                    <div key={`day-dst-hdr-${t.iana}-${slotIdx}`} className="p-1 text-center border-l border-warning-muted bg-warning-subtle flex flex-col items-center justify-center">
                      <span className="text-[8px] font-semibold text-warning truncate max-w-full">{city}</span>
                      <span className="text-[9px] font-bold text-warning">GMT</span>
                      <span className="text-[9px] font-bold text-warning">{offsetBefore} to {offsetAfter}</span>
                    </div>
                  )
                }
                const day = slot.day
                const isToday = isSameDay(day, new Date())
                return (
                  <div
                    key={day.toISOString()}
                    className={`p-2 text-center text-xs font-medium border-r border-border last:border-r-0 ${
                      isToday ? 'bg-info-subtle text-info' : 'text-muted-foreground'
                    }`}
                  >
                    <div>{format(day, 'EEE')}</div>
                    <div className={`text-lg font-bold ${isToday ? 'text-primary' : 'text-foreground'}`}>
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
                  <div className="p-1 text-[10px] text-primary font-semibold font-mono tabular-nums border-r border-border flex items-start justify-end pr-2 pt-1">
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
                        <div key={`dst-${t.iana}-${time}-${slotIdx}`} className={`p-1 text-[10px] text-center border-l border-warning-muted font-mono tabular-nums flex items-start justify-center pt-1 ${
                          isChanged
                            ? 'bg-warning-subtle text-warning font-semibold'
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
                          isToday ? 'bg-info-subtle' : ''
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
                                      {formatUTC(ev.start_time, 'HH:mm')} &ndash; {formatUTC(ev.end_time, 'HH:mm')} - {getSourceCountLabel(ev)}
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
                              className="text-left px-1 rounded-sm text-[10px] leading-tight font-medium transition-colors hover:opacity-80 overflow-hidden bg-neutral-subtle text-neutral border-l-[3px] border-neutral"
                              style={{
                                position: 'absolute',
                                top: seg.top,
                                height: Math.max(seg.height, 16),
                                left: `calc(${seg.leftPercent}% + 1px)`,
                                width: `calc(${seg.widthPercent}% - 2px)`,
                                pointerEvents: 'auto',
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
                    className="absolute left-0 right-0 pointer-events-none z-15"
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
        <Dialog
          open
          onClose={() => setOverflowPanelEvents(null)}
          title="Overlapping Meetings"
          size="md"
          showCloseButton
        >
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
        </Dialog>
      )}

      {/* Event Details Modal */}
      {selectedEvent && (
        <Dialog
          open
          onClose={() => setSelectedEvent(null)}
          title={resolveMeetingTitle({ title: selectedEvent.title, calendarTitle: selectedEvent.calendar_title })}
          size="md"
          showCloseButton
          closeLabel="Close event details"
          headerActions={
            <IconButton
              label="Flag this public event"
              icon={<Flag />}
              onClick={() => setFlagPanelEvent(selectedEvent)}
            />
          }
        >

            {/* Network / Calendar source label */}
            {(() => {
              const memberships = [...(eventNetworkMap.get(selectedEvent.id) || [])]
              const labels = memberships.map(key => networkMap.get(key)?.name || networkSources.find(source => source.key === key)?.name
                || (key.startsWith('cal_') ? key.slice(4) : key))
              if (!labels.length) return null
              return (
                <div className="flex items-center gap-1.5 mb-3">
                  <Network className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground font-medium">{labels.join(', ')}</span>
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
                    className="flex items-center gap-1.5 text-primary hover:underline text-sm font-medium min-w-0 break-all"
                  >
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                    Join Meeting
                  </a>
                  <IconButton
                    label="Copy link"
                    onClick={() => { navigator.clipboard.writeText(selectedEvent.meeting_link!); setCopiedLink(true); setTimeout(() => setCopiedLink(false), 2000) }}
                    icon={copiedLink ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                  />
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
                  <Button
                    emphasis="outline"
                    size="compact"
                    onClick={() => setSelectedEventSourcesExpanded(prev => !prev)}
                  >
                    {selectedEventSourcesExpanded ? 'Hide sources' : 'Show sources'}
                    {selectedEventSourcesExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </Button>
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
                <Button
                  icon={<Download className="w-4 h-4" />}
                  onClick={() => downloadICSFile({
                    title: resolveMeetingTitle({ title: selectedEvent.title, calendarTitle: selectedEvent.calendar_title }),
                    description: selectedEvent.description,
                    start_time: selectedEvent.start_time,
                    end_time: selectedEvent.end_time,
                    meeting_link: selectedEvent.meeting_link,
                    location: selectedEvent.location,
                  })}
                  title="Download .ics file for Apple Calendar and others"
                >
                  .ics
                </Button>
                {googleOAuthSources.length === 1 ? (
                  <Button
                    intent="primary"
                    icon={<CalendarPlus className="w-4 h-4" />}
                    onClick={() => handleSyncToGoogle({
                      title: resolveMeetingTitle({ title: selectedEvent.title, calendarTitle: selectedEvent.calendar_title }), description: selectedEvent.description,
                      start_time: selectedEvent.start_time, end_time: selectedEvent.end_time,
                      meeting_link: selectedEvent.meeting_link, location: selectedEvent.location,
                    })}
                    disabled={syncingToGoogle}
                    className="flex-1"
                    title={`Add to ${googleOAuthSources[0].display_name}`}
                  >
                    {syncingToGoogle ? 'Syncing...' : 'Add to Google'}
                  </Button>
                ) : googleOAuthSources.length > 1 ? (
                  <Button
                    intent="primary"
                    icon={<CalendarPlus className="w-4 h-4" />}
                    onClick={() => setShowGoogleSyncPicker({
                      title: resolveMeetingTitle({ title: selectedEvent.title, calendarTitle: selectedEvent.calendar_title }), description: selectedEvent.description,
                      start_time: selectedEvent.start_time, end_time: selectedEvent.end_time,
                      meeting_link: selectedEvent.meeting_link, location: selectedEvent.location,
                    })}
                    className="flex-1"
                    title="Choose which Google Calendar to add to"
                  >
                    Add to Google
                  </Button>
                ) : (
                  <a
                    href={`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(resolveMeetingTitle({ title: selectedEvent.title, calendarTitle: selectedEvent.calendar_title }))}&dates=${new Date(selectedEvent.start_time).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}/${new Date(selectedEvent.end_time).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}${selectedEvent.description ? `&details=${encodeURIComponent(selectedEvent.description)}` : ''}${selectedEvent.location ? `&location=${encodeURIComponent(selectedEvent.location)}` : selectedEvent.meeting_link ? `&location=${encodeURIComponent(selectedEvent.meeting_link)}` : ''}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-colors"
                    title="Add to Google Calendar"
                  >
                    <CalendarPlus className="w-4 h-4" />
                    Google Calendar
                  </a>
                )}
              </div>

              {/* Meeting page link -- shareable landing page for this single event */}
              <div className="mt-2">
                <Link
                  to={`/meeting/${getBaseEventId(selectedEvent.id)}`}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-info bg-info-subtle hover:bg-info-muted transition-colors w-full"
                >
                  <ExternalLink className="w-4 h-4" />
                  Meeting Page
                </Link>
              </div>
            </div>
        </Dialog>
      )}

      {flagPanelEvent && (
        <EventFlagPanel
          eventTitle={resolveMeetingTitle({ title: flagPanelEvent.title, calendarTitle: flagPanelEvent.calendar_title })}
          targets={flagPanelEvent.moderation_targets}
          onClose={() => setFlagPanelEvent(null)}
          onSubmitted={() => {
            setFlagPanelEvent(null)
            void fetchPublicEvents({ silent: true })
          }}
        />
      )}

      {/* Google Calendar Sync Picker Modal */}
      {showGoogleSyncPicker && (
        <Dialog
          open
          onClose={() => { setShowGoogleSyncPicker(null); setSelectedSyncSourceIds(new Set()) }}
          title="Choose Calendar"
          description={`Select which Google Calendar(s) to add "${showGoogleSyncPicker.title}" to:`}
          showCloseButton
        >
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
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: source.color }} />
                  <span className="text-sm truncate">{source.display_name}</span>
                </label>
              ))}
            </div>
            <Button
              intent="primary"
              fullWidth
              icon={<CalendarPlus className="w-4 h-4" />}
              onClick={() => handleSyncToGoogle(showGoogleSyncPicker, Array.from(selectedSyncSourceIds))}
              disabled={selectedSyncSourceIds.size === 0 || syncingToGoogle}
            >
              {syncingToGoogle ? 'Adding...' : `Add to ${selectedSyncSourceIds.size} Calendar(s)`}
            </Button>
        </Dialog>
      )}
    </div>
  )
}
