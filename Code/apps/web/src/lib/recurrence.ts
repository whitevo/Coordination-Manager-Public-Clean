import { addDays, format } from 'date-fns'

export type RecurrenceType = 'none' | 'weekly' | 'biweekly' | 'monthly' | 'monthlyWeek' | 'custom'
export type RecurrenceUnit = 'day' | 'week' | 'month'
export type RecurrenceEndType = 'never' | 'on' | 'after' | 'whenCompleted'

export interface RecurrenceRule {
  type: RecurrenceType
  interval?: number
  unit?: RecurrenceUnit
  weekDays?: number[]
  weekOffsetDays?: number
  // 'monthlyWeek': which Monday-start week(s) of the month (1-4) to repeat on
  monthWeeks?: number[]
  endType?: RecurrenceEndType
  endDate?: string
  endCount?: number
  exceptions?: string[]
}

export type PublicEvent = {
  id: string
  title: string
  description?: string | null
  meeting_link?: string | null
  location?: string | null
  start_time: string
  end_time: string
  is_public?: boolean
  source_type?: string
  recurrence_rule?: unknown
  created_at?: string
  updated_at?: string
  calendar_title?: string
  calendar_hash?: string
  network_source_key?: string
  moderation_targets?: Array<{ type: 'user_event' | 'meeting'; id: string }>
}

export function ensureUTC(ts: string): string {
  return ts && !ts.endsWith('Z') && !ts.includes('+') ? ts + 'Z' : ts
}

export function getWeekdayIndexFromIsoDate(isoDate: string): number {
  const d = new Date(`${isoDate}T00:00:00Z`)
  const jsDay = d.getUTCDay() // 0=Sun..6=Sat
  return jsDay === 0 ? 6 : jsDay - 1 // 0=Mon..6=Sun
}

const DAY_MS = 24 * 60 * 60 * 1000
const RECURRENCE_MAX_LOOKAHEAD_DAYS = 365 * 20

const isRecurrenceType = (value: unknown): value is RecurrenceRule['type'] =>
  value === 'none' || value === 'weekly' || value === 'biweekly' || value === 'monthly' || value === 'monthlyWeek' || value === 'custom'

const isRecurrenceUnit = (value: unknown): value is NonNullable<RecurrenceRule['unit']> =>
  value === 'day' || value === 'week' || value === 'month'

const isRecurrenceEndType = (value: unknown): value is NonNullable<RecurrenceRule['endType']> =>
  value === 'never' || value === 'on' || value === 'after' || value === 'whenCompleted'

export function normalizeRecurrenceRule(value: unknown): RecurrenceRule {
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

/** Which occurrence (1st, 2nd, 3rd, 4th...) of its own weekday a date is within its month. */
export function getWeekOfMonth(date: Date): number {
  return Math.floor((date.getUTCDate() - 1) / 7) + 1
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

const isRecurringOccurrenceDate = (candidate: Date, baseStart: Date, rule: RecurrenceRule, calendarDayCadence: boolean): boolean => {
  const distance = calendarDayCadence
    ? Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth(), candidate.getUTCDate())
      - Date.UTC(baseStart.getUTCFullYear(), baseStart.getUTCMonth(), baseStart.getUTCDate())
    : candidate.getTime() - baseStart.getTime()
  const dayDiff = Math.floor(distance / DAY_MS)
  if (dayDiff < 0) return false

  if (rule.type === 'weekly' || rule.type === 'biweekly') {
    const interval = rule.type === 'biweekly' ? 14 : 7
    return dayDiff % interval === 0 && getRecurrenceWeekdayIndex(candidate) === getRecurrenceWeekdayIndex(baseStart)
  }

  if (rule.type === 'monthly') {
    const monthDiff = (candidate.getUTCFullYear() - baseStart.getUTCFullYear()) * 12 + (candidate.getUTCMonth() - baseStart.getUTCMonth())
    return candidate.getUTCDate() === baseStart.getUTCDate() && monthDiff % 1 === 0
  }

  if (rule.type === 'monthlyWeek') {
    if (getRecurrenceWeekdayIndex(candidate) !== getRecurrenceWeekdayIndex(baseStart)) return false
    const allowedWeeks = rule.monthWeeks && rule.monthWeeks.length > 0 ? rule.monthWeeks : [getWeekOfMonth(baseStart)]
    return allowedWeeks.includes(getWeekOfMonth(candidate))
  }

  if (rule.type !== 'custom') return false

  const interval = rule.interval || 1
  const unit = rule.unit || 'week'
  if (unit === 'day') return dayDiff % interval === 0

  if (unit === 'week') {
    const allowedWeekDays = rule.weekDays && rule.weekDays.length > 0 ? rule.weekDays : [getRecurrenceWeekdayIndex(baseStart)]
    // Cycles run in Monday-start weeks: weekOffsetDays is how many days the base date sits
    // after its cycle's Monday (defaults to the base weekday, i.e. the base week's Monday).
    const weekDiff = Math.floor((dayDiff + (rule.weekOffsetDays ?? getRecurrenceWeekdayIndex(baseStart))) / 7)
    return weekDiff % interval === 0 && allowedWeekDays.includes(getRecurrenceWeekdayIndex(candidate))
  }

  const monthDiff = (candidate.getUTCFullYear() - baseStart.getUTCFullYear()) * 12 + (candidate.getUTCMonth() - baseStart.getUTCMonth())
  return candidate.getUTCDate() === baseStart.getUTCDate() && monthDiff % interval === 0
}

export function getRecurringEventStartsInRange(
  event: PublicEvent, rangeStart: Date, rangeEnd: Date, options: { calendarDayCadence?: boolean } = {},
): string[] {
  const recurrenceRule = normalizeRecurrenceRule(event.recurrence_rule)
  if (recurrenceRule.type === 'none') return []

  const baseStart = new Date(event.start_time)
  if (Number.isNaN(baseStart.getTime())) return []
  if (recurrenceRule.endType === 'whenCompleted') {
    return baseStart < rangeEnd && new Date(event.end_time) > rangeStart ? [event.start_time] : []
  }

  const endDate = recurrenceRule.endType === 'on' && recurrenceRule.endDate ? new Date(`${recurrenceRule.endDate}T00:00:00Z`) : null
  const exceptionDates = recurrenceRule.exceptions && recurrenceRule.exceptions.length > 0 ? new Set(recurrenceRule.exceptions) : null
  const matchedStarts: string[] = []
  let matchedCount = 0

  const baseDay = new Date(Date.UTC(baseStart.getUTCFullYear(), baseStart.getUTCMonth(), baseStart.getUTCDate()))
  if (rangeEnd.getTime() <= baseDay.getTime()) return []

  const daysUntilRangeEnd = Math.max(0, Math.floor((rangeEnd.getTime() - baseDay.getTime()) / DAY_MS))
  const maxOffset = Math.min(RECURRENCE_MAX_LOOKAHEAD_DAYS, daysUntilRangeEnd + 7)
  const hasCountLimit = recurrenceRule.endType === 'after' && Boolean(recurrenceRule.endCount)
  // Count limits include excluded occurrences, so they still require historical
  // accounting. Unlimited/date-ended rules can jump directly to the window.
  const firstOffset = hasCountLimit ? 0 : Math.max(0, Math.floor((rangeStart.getTime() - baseDay.getTime()) / DAY_MS) - 1)

  for (let offset = firstOffset; offset <= maxOffset; offset++) {
    const candidate = addDays(baseStart, offset)
    const candidateDay = new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth(), candidate.getUTCDate()))
    if (candidateDay.getTime() < baseDay.getTime()) continue
    if (endDate && candidateDay.getTime() > Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate())) break
    if (!isRecurringOccurrenceDate(candidate, baseStart, recurrenceRule, options.calendarDayCadence === true)) continue

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

/**
 * UTC range covering the seven date labels of a grid week. Calendar grids key cells by
 * UTC date and time, so recurrence windows must use these bounds, not local midnight.
 */
export function getUtcWeekRange(weekStart: Date): { start: Date; end: Date } {
  const start = new Date(`${format(weekStart, 'yyyy-MM-dd')}T00:00:00Z`)
  return { start, end: new Date(start.getTime() + 7 * DAY_MS) }
}

const recurringCellIdCache = new Map<string, string[]>()
const RECURRING_CELL_ID_CACHE_LIMIT = 500

/**
 * Occurrence cellIds ("yyyy-MM-dd_HH:mm") of a recurring CalendarPage meeting inside the
 * visible week, excluding the base cell. Cell dates and times are UTC (meetings are saved
 * with start_time = `${date}T${time}:00Z`), so this delegates to the shared expander
 * instead of re-implementing recurrence against local dates.
 */
export function getRecurringCellIdsInWeek(baseCellId: string, rule: unknown, weekStart: Date): string[] {
  const [baseDate, baseTime] = baseCellId.split('_')
  if (!baseDate || !baseTime) return []
  const weekKey = format(weekStart, 'yyyy-MM-dd')
  const cacheKey = `${baseCellId}|${weekKey}|${JSON.stringify(rule)}`
  const cached = recurringCellIdCache.get(cacheKey)
  if (cached) return cached

  const { start: rangeStart, end: rangeEnd } = getUtcWeekRange(weekStart)
  const starts = getRecurringEventStartsInRange(
    { id: baseCellId, title: '', start_time: `${baseDate}T${baseTime}:00Z`, end_time: `${baseDate}T${baseTime}:00Z`, recurrence_rule: rule },
    rangeStart,
    rangeEnd,
    { calendarDayCadence: true },
  )
  const cellIds = starts
    .map((iso) => `${iso.slice(0, 10)}_${iso.slice(11, 16)}`)
    .filter((cellId) => cellId !== baseCellId)

  if (recurringCellIdCache.size >= RECURRING_CELL_ID_CACHE_LIMIT) recurringCellIdCache.clear()
  recurringCellIdCache.set(cacheKey, cellIds)
  return cellIds
}

export function expandRecurringPublicEvents(events: PublicEvent[], windowStart: Date, windowEnd: Date): PublicEvent[] {
  const expanded: PublicEvent[] = []

  for (const ev of events) {
    const rule = normalizeRecurrenceRule(ev.recurrence_rule)
    const evStart = new Date(ev.start_time)
    const evEnd = new Date(ev.end_time)

    if (rule.type === 'none' || rule.endType === 'whenCompleted') {
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

export type RecurringEditScope = 'this' | 'future'

export function splitRecurringEventRule(event: PublicEvent, occurrenceStart: string, scope: RecurringEditScope): {
  previousRule: RecurrenceRule
  nextRule: RecurrenceRule
} {
  const rule = normalizeRecurrenceRule(event.recurrence_rule)
  const occurrence = new Date(occurrenceStart)
  const occurrenceKey = getUtcDateKey(occurrence)
  if (scope === 'this') {
    return {
      previousRule: { ...rule, exceptions: Array.from(new Set([...(rule.exceptions || []), occurrenceKey])) },
      nextRule: { type: 'none' },
    }
  }

  const previousDay = new Date(occurrence)
  previousDay.setUTCDate(previousDay.getUTCDate() - 1)
  const previousRule: RecurrenceRule = { ...rule, endType: 'on', endDate: getUtcDateKey(previousDay), endCount: undefined }
  const nextRule: RecurrenceRule = { ...rule, exceptions: rule.exceptions?.filter((date) => date >= occurrenceKey) }
  if (rule.type === 'custom' && rule.unit === 'week') {
    const elapsedDays = Math.round((new Date(`${occurrenceKey}T00:00:00Z`).getTime()
      - new Date(`${getUtcDateKey(new Date(event.start_time))}T00:00:00Z`).getTime()) / DAY_MS)
    const baseAnchor = rule.weekOffsetDays ?? getRecurrenceWeekdayIndex(new Date(event.start_time))
    nextRule.weekOffsetDays = (baseAnchor + elapsedDays) % ((rule.interval || 1) * 7)
    nextRule.weekDays = rule.weekDays || [getRecurrenceWeekdayIndex(new Date(event.start_time))]
  }
  if (rule.endType === 'after' && rule.endCount) {
    const precedingStarts = getRecurringEventStartsInRange(
      { ...event, recurrence_rule: { ...rule, exceptions: undefined } },
      new Date(`${getUtcDateKey(new Date(event.start_time))}T00:00:00Z`),
      new Date(`${occurrenceKey}T00:00:00Z`),
    )
    nextRule.endCount = Math.max(1, rule.endCount - precedingStarts.length)
  }
  return { previousRule, nextRule }
}