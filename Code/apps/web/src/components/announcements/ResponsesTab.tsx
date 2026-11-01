import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Search,
  Filter,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Users,
  CalendarDays,
  X,
  ShieldAlert,
  Eye,
  EyeOff,
  Calendar,
  ChevronsUp,
} from 'lucide-react'
import { apiClient } from '../../lib/api-client'
import { Button, IconButton, SegmentedControl } from '../ui'
import { getPrimaryTimezone, formatDateDDMMYYYYInTimezone, formatDateTimeDDMMYYYYInTimezone } from '../../lib/timezone-data'

// ─── Types ─────────────────────────────────────────────────────────

interface RecipientEvent {
  type: string
  schedule_id: string
  schedule_title: string
  date: string
  delivery_status: string
  recipient_response: string | null
}

interface Recipient {
  discord_id: string
  label: string
  events: RecipientEvent[]
  latest_response: string | null
}

interface CalendarDelivery {
  target_id: string
  target_label: string | null
  delivery_status: string
  recipient_response: string | null
  delivered_at: string | null
}

interface CalendarSchedule {
  id: string
  title: string
  sent_at: string | null
  scheduled_at: string
  deliveries: CalendarDelivery[]
}

interface CalendarGroup {
  calendar_id: string | null
  calendar_title: string
  schedules: CalendarSchedule[]
}

interface ResponseMeta {
  scope: LoadScope
  hasOlderThanMonth: boolean
  hasOlderThanYear: boolean
  loadedSchedules: number
}

type LoadScope = 'recent' | 'month' | 'year'

type ResponseFilter = 'all' | 'subscribed' | 'invited' | 'unsubscribed' | 'opted_out' | 'muted_bot' | 'received' | 'failed'

// ─── Helpers ─────────────────────────────────────────────────────────

const formatDate = (date: Date | string): string => {
  const tz = getPrimaryTimezone()
  return formatDateDDMMYYYYInTimezone(date, tz)
}

const formatDateTime = (date: Date | string): string => {
  const tz = getPrimaryTimezone()
  return formatDateTimeDDMMYYYYInTimezone(date, tz)
}

/** Convert HTML date input (yyyy-mm-dd) to ISO string for API */
const inputToISO = (val: string): string | null => {
  if (!val) return null
  const d = new Date(val + 'T00:00:00')
  if (isNaN(d.getTime())) return null
  return d.toISOString()
}

/** Convert HTML date input to end-of-day ISO for "before" queries */
const inputToISOEnd = (val: string): string | null => {
  if (!val) return null
  const d = new Date(val + 'T23:59:59')
  if (isNaN(d.getTime())) return null
  return d.toISOString()
}

const RESPONSE_CONFIG: Record<string, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  subscribed: { label: 'Subscribed', cls: 'bg-success-subtle text-success', icon: CheckCircle2 },
  unsubscribed: { label: 'Unsubscribed', cls: 'bg-muted text-muted-foreground', icon: XCircle },
  opted_out: { label: 'Opted Out', cls: 'bg-danger-subtle text-danger', icon: ShieldAlert },
  invited: { label: 'No Response', cls: 'bg-warning-subtle text-warning', icon: Clock },
  skipped_no_response: { label: 'Skipped', cls: 'bg-muted text-muted-foreground', icon: XCircle },
  muted_bot: { label: 'Muted Bot', cls: 'bg-neutral-subtle text-neutral', icon: EyeOff },
  received: { label: 'Received', cls: 'bg-info-subtle text-primary', icon: Eye },
  failed: { label: 'Failed', cls: 'bg-danger-subtle text-danger', icon: XCircle },
}

function ResponseBadge({ type }: { type: string }) {
  const config = RESPONSE_CONFIG[type]
  if (!config) return null
  const Icon = config.icon
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${config.cls}`}>
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  )
}

// ─── Component ─────────────────────────────────────────────────────────

export default function ResponsesTab() {
  // Data
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [calendarGroups, setCalendarGroups] = useState<CalendarGroup[]>([])
  const [meta, setMeta] = useState<ResponseMeta | null>(null)
  const [scope, setScope] = useState<LoadScope>('recent')
  const [loading, setLoading] = useState(true)
  const [scaleUpLoading, setScaleUpLoading] = useState(false)

  // Search & filter
  const [searchQuery, setSearchQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState<ResponseFilter>('all')

  // Date range filter
  const [dateAfter, setDateAfter] = useState('')
  const [dateBefore, setDateBefore] = useState('')
  const [appliedDateAfter, setAppliedDateAfter] = useState('')
  const [appliedDateBefore, setAppliedDateBefore] = useState('')
  const [showDateFilter, setShowDateFilter] = useState(false)

  // Expansion states
  const [expandedRecipients, setExpandedRecipients] = useState<Set<string>>(new Set())
  const [expandedCalendars, setExpandedCalendars] = useState<Set<string>>(new Set())
  const [_expandedSchedules, setExpandedSchedules] = useState<Set<string>>(new Set())

  // ─── Fetch data for a given scope ─────────────────────────────

  const fetchData = useCallback(async (loadScope: LoadScope, after?: string | null, before?: string | null) => {
    const params: Record<string, string> = { scope: loadScope }
    if (after) params.after = after
    if (before) params.before = before

    const res = await apiClient.get('/api/announcements/responses', { params })
    return {
      recipients: (res.data.recipients || []) as Recipient[],
      calendarGroups: (res.data.calendarGroups || []) as CalendarGroup[],
      meta: res.data.meta as ResponseMeta,
    }
  }, [])

  // ─── Load data ────────────────────────────────────────────────

  const loadData = useCallback(async (loadScope: LoadScope, after?: string | null, before?: string | null) => {
    setLoading(true)
    setExpandedRecipients(new Set())
    setExpandedCalendars(new Set())
    setExpandedSchedules(new Set())

    try {
      const result = await fetchData(loadScope, after, before)
      setRecipients(result.recipients)
      setCalendarGroups(result.calendarGroups)
      setMeta(result.meta)
      setScope(loadScope)
    } catch {
      setRecipients([])
      setCalendarGroups([])
      setMeta(null)
    } finally {
      setLoading(false)
    }
  }, [fetchData])

  // ─── Scale up: load more data ─────────────────────────────────

  const handleScaleUp = useCallback(async (nextScope: LoadScope) => {
    setScaleUpLoading(true)
    try {
      const after = inputToISO(appliedDateAfter)
      const before = inputToISOEnd(appliedDateBefore)
      const result = await fetchData(nextScope, after, before)
      setRecipients(result.recipients)
      setCalendarGroups(result.calendarGroups)
      setMeta(result.meta)
      setScope(nextScope)
    } catch {
      // Keep existing data on failure
    } finally {
      setScaleUpLoading(false)
    }
  }, [fetchData, appliedDateAfter, appliedDateBefore])

  useEffect(() => {
    loadData('recent', null, null)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDateApply = useCallback(() => {
    const after = inputToISO(dateAfter)
    const before = inputToISOEnd(dateBefore)
    setAppliedDateAfter(dateAfter)
    setAppliedDateBefore(dateBefore)
    loadData(scope, after, before)
  }, [dateAfter, dateBefore, scope, loadData])

  const handleDateClear = useCallback(() => {
    setDateAfter('')
    setDateBefore('')
    setAppliedDateAfter('')
    setAppliedDateBefore('')
    loadData(scope, null, null)
  }, [scope, loadData])

  const handleRefresh = useCallback(() => {
    const after = inputToISO(appliedDateAfter)
    const before = inputToISOEnd(appliedDateBefore)
    loadData(scope, after, before)
  }, [appliedDateAfter, appliedDateBefore, scope, loadData])

  // ─── Filtering logic (applies to both tables) ──────────────────

  const normalizedSearch = searchQuery.toLowerCase().trim()

  const filteredRecipients = useMemo(() => {
    let result = recipients

    if (normalizedSearch) {
      result = result.filter(r =>
        r.label.toLowerCase().includes(normalizedSearch) ||
        r.discord_id.toLowerCase().includes(normalizedSearch) ||
        r.events.some(e => e.schedule_title.toLowerCase().includes(normalizedSearch))
      )
    }

    if (activeFilter !== 'all') {
      result = result.filter(r =>
        r.latest_response === activeFilter ||
        r.events.some(e => e.type === activeFilter || e.recipient_response === activeFilter)
      )
    }

    return result
  }, [recipients, normalizedSearch, activeFilter])

  const filteredCalendarGroups = useMemo(() => {
    let result = calendarGroups

    if (normalizedSearch || activeFilter !== 'all') {
      result = result.map(group => {
        const filteredSchedules = group.schedules
          .map(schedule => {
            let deliveries = schedule.deliveries

            if (normalizedSearch) {
              deliveries = deliveries.filter(d =>
                (d.target_label || d.target_id).toLowerCase().includes(normalizedSearch) ||
                schedule.title.toLowerCase().includes(normalizedSearch) ||
                group.calendar_title.toLowerCase().includes(normalizedSearch)
              )
            }

            if (activeFilter !== 'all') {
              deliveries = deliveries.filter(d =>
                d.recipient_response === activeFilter ||
                (activeFilter === 'received' && d.delivery_status === 'sent' && !d.recipient_response) ||
                (activeFilter === 'failed' && d.delivery_status === 'failed')
              )
            }

            return { ...schedule, deliveries }
          })
          .filter(schedule => schedule.deliveries.length > 0)

        return { ...group, schedules: filteredSchedules }
      }).filter(group => group.schedules.length > 0)
    }

    return result
  }, [calendarGroups, normalizedSearch, activeFilter])

  // ─── Summary counts ──────────────────────────────────────────

  const summaryCounts = useMemo(() => {
    const counts: Record<string, number> = {
      subscribed: 0,
      invited: 0,
      unsubscribed: 0,
      opted_out: 0,
      muted_bot: 0,
    }
    for (const r of recipients) {
      const status = r.latest_response
      if (status && status in counts) {
        counts[status]++
      }
    }
    return counts
  }, [recipients])

  // ─── Toggle helpers ────────────────────────────────────────────

  const toggleRecipient = (id: string) => {
    setExpandedRecipients(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleCalendar = (id: string) => {
    setExpandedCalendars(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const _toggleSchedule = (id: string) => {
    setExpandedSchedules(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ─── Filter options ────────────────────────────────────────────

  const filterOptions: Array<{ value: ResponseFilter; label: string; count?: number }> = [
    { value: 'all', label: 'All' },
    { value: 'subscribed', label: 'Subscribed', count: summaryCounts.subscribed },
    { value: 'invited', label: 'No Response', count: summaryCounts.invited },
    { value: 'unsubscribed', label: 'Unsubscribed', count: summaryCounts.unsubscribed },
    { value: 'opted_out', label: 'Opted Out', count: summaryCounts.opted_out },
    { value: 'muted_bot', label: 'Muted Bot', count: summaryCounts.muted_bot },
    { value: 'received', label: 'Received Only' },
    { value: 'failed', label: 'Failed' },
  ]

  const hasDateFilter = !!(appliedDateAfter || appliedDateBefore)

  // ─── Scale-up button logic ────────────────────────────────────

  const scaleUpLabel = useMemo(() => {
    if (hasDateFilter) return null // no scale-up when custom date filter is active
    if (scope === 'recent' && meta?.hasOlderThanMonth) return 'Load 1 month'
    if (scope === 'recent' && !meta?.hasOlderThanMonth) return null // all data fits in recent
    if (scope === 'month' && meta?.hasOlderThanYear) return 'Load a year'
    return null
  }, [scope, meta, hasDateFilter])

  const handleScaleUpClick = useCallback(() => {
    if (scope === 'recent') handleScaleUp('month')
    else if (scope === 'month') handleScaleUp('year')
  }, [scope, handleScaleUp])

  const scopeDescription = useMemo(() => {
    if (hasDateFilter) return 'custom date range'
    if (scope === 'recent') return 'recent'
    if (scope === 'month') return 'last 30 days'
    if (scope === 'year') return 'last year'
    return ''
  }, [scope, hasDateFilter])

  const ScaleUpButton = () => {
    if (!scaleUpLabel) return null
    return (
      <Button
        emphasis="outline"
        intent="primary"
        onClick={handleScaleUpClick}
        loading={scaleUpLoading}
        icon={<ChevronsUp className="w-4 h-4" />}
      >
        {scaleUpLoading ? 'Loading...' : scaleUpLabel}
      </Button>
    )
  }

  // ─── Date filter bar (shared) ──────────────────────────────────

  const DateFilterBar = () => (
    <>
      {showDateFilter && (
        <div className="flex items-end gap-3 px-3 py-3 rounded-lg border border-border bg-muted/30">
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">From</label>
            <input
              type="date"
              value={dateAfter}
              onChange={e => setDateAfter(e.target.value)}
              className="px-2 py-1.5 text-xs rounded border border-border bg-background focus:outline-hidden focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">To</label>
            <input
              type="date"
              value={dateBefore}
              onChange={e => setDateBefore(e.target.value)}
              className="px-2 py-1.5 text-xs rounded border border-border bg-background focus:outline-hidden focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <Button intent="primary" size="compact" onClick={handleDateApply}>
            Apply
          </Button>
          {hasDateFilter && (
            <Button emphasis="outline" size="compact" onClick={handleDateClear}>
              Clear
            </Button>
          )}
        </div>
      )}
    </>
  )

  // ─── Render ────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="text-center py-12">
        <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground mt-2">Loading response data...</p>
      </div>
    )
  }

  if (recipients.length === 0 && calendarGroups.length === 0) {
    return (
      <div className="space-y-3">
        {/* Date filter still available on empty state */}
        <div className="flex items-center gap-3">
          <Button
            emphasis="outline"
            intent={hasDateFilter ? 'primary' : 'neutral'}
            size="compact"
            onClick={() => setShowDateFilter(v => !v)}
            aria-expanded={showDateFilter}
            icon={<Calendar className="w-3.5 h-3.5" />}
          >
            Date Range
            {hasDateFilter && <span className="font-medium">*</span>}
          </Button>
          {hasDateFilter && (
            <button onClick={handleDateClear} className="text-xs text-muted-foreground hover:text-foreground underline">
              Clear dates
            </button>
          )}
        </div>
        <DateFilterBar />
        <div className="text-center py-12">
          <Users className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">
            {hasDateFilter
              ? 'No delivery responses found for this date range.'
              : 'No delivery responses yet. Send announcements via DM to start tracking responses.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ── Global search, date filter & filter bar ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by name, calendar, or announcement..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 text-sm rounded-lg border border-border bg-background focus:outline-hidden focus:ring-2 focus:ring-primary/30"
            />
            {searchQuery && (
              <IconButton
                size="micro"
                label="Clear search"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2"
                icon={<X />}
              />
            )}
          </div>
          <Button
            emphasis="outline"
            intent={hasDateFilter ? 'primary' : 'neutral'}
            size="compact"
            onClick={() => setShowDateFilter(v => !v)}
            aria-expanded={showDateFilter}
            className="shrink-0"
            title="Date range filter"
            icon={<Calendar className="w-3.5 h-3.5" />}
          >
            {hasDateFilter ? 'Filtered' : 'Dates'}
          </Button>
          <Button
            emphasis="outline"
            size="compact"
            onClick={handleRefresh}
            className="shrink-0"
            icon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Refresh
          </Button>
        </div>

        {/* Date range picker */}
        <DateFilterBar />

        {/* Filter pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          <SegmentedControl
            label="Filter responses"
            size="micro"
            className="flex-wrap"
            value={activeFilter}
            onChange={setActiveFilter}
            options={filterOptions.map(opt => ({
              value: opt.value,
              label: opt.count !== undefined && opt.count > 0 ? `${opt.label} ${opt.count}` : opt.label,
            }))}
          />
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>Showing {scopeDescription}</span>
          {meta && <span>({meta.loadedSchedules} announcement(s))</span>}
        </div>

        <ScaleUpButton />
      </div>

      {/* ────────────────────────────────────────────────────────────
          TABLE 1: Recipient Status Overview
          ──────────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-medium">Recipient Status Overview</h3>
          <span className="text-xs text-muted-foreground">
            {filteredRecipients.length} recipient(s)
          </span>
        </div>

        {/* Summary bar */}
        {(summaryCounts.subscribed > 0 || summaryCounts.invited > 0 || summaryCounts.unsubscribed > 0 || summaryCounts.opted_out > 0 || summaryCounts.muted_bot > 0) && (
          <div className="flex items-center gap-3 text-[11px] px-3 py-2 rounded-lg bg-muted/40 border border-border/50 mb-3 flex-wrap">
            {summaryCounts.subscribed > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-success-subtle text-success font-medium">
                <CheckCircle2 className="w-3 h-3" /> {summaryCounts.subscribed} Subscribed
              </span>
            )}
            {summaryCounts.invited > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-warning-subtle text-warning font-medium">
                <Clock className="w-3 h-3" /> {summaryCounts.invited} No Response
              </span>
            )}
            {summaryCounts.unsubscribed > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                <XCircle className="w-3 h-3" /> {summaryCounts.unsubscribed} Unsubscribed
              </span>
            )}
            {summaryCounts.opted_out > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-danger-subtle text-danger font-medium">
                <ShieldAlert className="w-3 h-3" /> {summaryCounts.opted_out} Opted Out
              </span>
            )}
            {summaryCounts.muted_bot > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-neutral-subtle text-neutral font-medium">
                <EyeOff className="w-3 h-3" /> {summaryCounts.muted_bot} Muted Bot
              </span>
            )}
          </div>
        )}

        {filteredRecipients.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No recipients match the current search or filter.
          </p>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_120px_120px_80px] gap-2 px-4 py-2 bg-muted/50 border-b border-border text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              <span>Recipient</span>
              <span>Current Status</span>
              <span>Last Activity</span>
              <span className="text-center">Events</span>
            </div>

            {/* Recipient rows */}
            {filteredRecipients.map(recipient => {
              const isExpanded = expandedRecipients.has(recipient.discord_id)
              const latestEvent = recipient.events[0]

              // Group events by date for expandable history
              const eventsByDate = new Map<string, RecipientEvent[]>()
              for (const event of recipient.events) {
                const dateKey = formatDate(event.date)
                if (!eventsByDate.has(dateKey)) eventsByDate.set(dateKey, [])
                eventsByDate.get(dateKey)!.push(event)
              }

              return (
                <div key={recipient.discord_id} className="border-b border-border last:border-b-0">
                  <div
                    className="grid grid-cols-[1fr_120px_120px_80px] gap-2 px-4 py-2.5 items-center cursor-pointer hover:bg-accent/30 transition-colors"
                    onClick={() => toggleRecipient(recipient.discord_id)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      )}
                      <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm truncate">{recipient.label}</span>
                    </div>
                    <div>
                      <ResponseBadge type={recipient.latest_response || 'received'} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {latestEvent ? formatDate(latestEvent.date) : '--'}
                    </div>
                    <div className="text-xs text-muted-foreground text-center">
                      {recipient.events.length}
                    </div>
                  </div>

                  {/* Expanded history */}
                  {isExpanded && (
                    <div className="px-4 pb-3 pt-1 bg-muted/20">
                      <div className="space-y-2 ml-6">
                        {[...eventsByDate.entries()].map(([dateKey, events]) => (
                          <div key={dateKey}>
                            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
                              {dateKey}
                            </p>
                            <div className="space-y-1">
                              {events.map((event, i) => (
                                <div
                                  key={`${event.schedule_id}-${i}`}
                                  className="flex items-center gap-2 text-xs py-1 px-2 rounded bg-background border border-border/50"
                                >
                                  <ResponseBadge type={event.type} />
                                  <span className="truncate flex-1 text-muted-foreground">{event.schedule_title}</span>
                                  <span className="text-[10px] text-muted-foreground shrink-0">
                                    {formatDateTime(event.date)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ────────────────────────────────────────────────────────────
          TABLE 2: Calendar Initiative Responses
          ──────────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <CalendarDays className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-medium">Calendar Initiative Responses</h3>
          <span className="text-xs text-muted-foreground">
            {filteredCalendarGroups.length} calendar(s)
          </span>
        </div>

        {filteredCalendarGroups.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No calendar responses match the current search or filter.
          </p>
        ) : (
          <div className="space-y-2">
            {filteredCalendarGroups.map(group => {
              const groupKey = group.calendar_id || '__none__'
              const isCalExpanded = expandedCalendars.has(groupKey)

              // Count total deliveries and response types
              const totalDeliveries = group.schedules.reduce((sum, s) => sum + s.deliveries.length, 0)
              const responseBreakdown: Record<string, number> = {}
              for (const schedule of group.schedules) {
                for (const d of schedule.deliveries) {
                  const key = d.recipient_response || (d.delivery_status === 'sent' ? 'received' : 'failed')
                  responseBreakdown[key] = (responseBreakdown[key] || 0) + 1
                }
              }

              return (
                <div key={groupKey} className="border border-border rounded-lg overflow-hidden">
                  {/* Calendar group header */}
                  <div
                    className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-accent/20 transition-colors bg-muted/30"
                    onClick={() => toggleCalendar(groupKey)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {isCalExpanded ? (
                        <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      )}
                      <CalendarDays className="w-4 h-4 text-primary shrink-0" />
                      <span className="text-sm font-medium truncate">{group.calendar_title}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                      <span>{group.schedules.length} message(s)</span>
                      <span>{totalDeliveries} recipient(s)</span>
                      {/* Mini response breakdown */}
                      <div className="flex items-center gap-1">
                        {responseBreakdown.subscribed && (
                          <span className="w-2 h-2 rounded-full bg-success" title={`${responseBreakdown.subscribed} subscribed`} />
                        )}
                        {responseBreakdown.invited && (
                          <span className="w-2 h-2 rounded-full bg-warning" title={`${responseBreakdown.invited} no response`} />
                        )}
                        {responseBreakdown.opted_out && (
                          <span className="w-2 h-2 rounded-full bg-danger" title={`${responseBreakdown.opted_out} opted out`} />
                        )}
                        {responseBreakdown.unsubscribed && (
                          <span className="w-2 h-2 rounded-full bg-neutral" title={`${responseBreakdown.unsubscribed} unsubscribed`} />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expanded: flat delivery table with message title column */}
                  {isCalExpanded && (
                    <div className="border-t border-border">
                      {/* Table header */}
                      <div className="grid grid-cols-[1fr_1fr_100px_120px] gap-2 px-4 py-2 bg-muted/50 border-b border-border text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                        <span>Message Title</span>
                        <span>Recipient</span>
                        <span>Response</span>
                        <span>Date</span>
                      </div>

                      {/* Flat rows: one per delivery, message title repeats */}
                      {/* Alternating hue bands per schedule so same-title rows are visually grouped */}
                      {group.schedules.flatMap((schedule, scheduleIdx) =>
                        schedule.deliveries.map((delivery, idx) => {
                          let responseType = delivery.recipient_response ||
                            (delivery.delivery_status === 'sent' ? 'received' : 'failed')
                          if (responseType === 'invited' && delivery.delivery_status === 'failed') {
                            responseType = 'skipped_no_response'
                          }

                          const bandClass = scheduleIdx % 2 === 0
                            ? 'bg-primary/4 dark:bg-primary/6'
                            : 'bg-secondary/35 dark:bg-secondary/18'

                          return (
                            <div
                              key={`${schedule.id}-${delivery.target_id}-${idx}`}
                              className={`grid grid-cols-[1fr_1fr_100px_120px] gap-2 px-4 py-2 items-center border-b border-border/50 last:border-b-0 hover:bg-accent/10 transition-colors ${bandClass}`}
                            >
                              <span className="text-sm truncate">{schedule.title}</span>
                              <div className="flex items-center gap-2 min-w-0">
                                <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                <span className="text-xs truncate">
                                  {delivery.target_label || delivery.target_id}
                                </span>
                              </div>
                              <ResponseBadge type={responseType} />
                              <span className="text-[10px] text-muted-foreground">
                                {delivery.delivered_at
                                  ? formatDateTime(delivery.delivered_at)
                                  : schedule.sent_at
                                    ? formatDate(schedule.sent_at)
                                    : formatDate(schedule.scheduled_at)}
                              </span>
                            </div>
                          )
                        })
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Bottom scale-up button ── */}
      {scaleUpLabel && (
        <div className="flex justify-center pt-2">
          <ScaleUpButton />
        </div>
      )}
    </div>
  )
}
