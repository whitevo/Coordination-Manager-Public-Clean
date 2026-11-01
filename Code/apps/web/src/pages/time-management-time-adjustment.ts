const MINUTES_IN_DAY = 1440
const DAYS_IN_WEEK = 7

export interface TimeRange {
  startMinute: number
  endMinute: number
}

interface TimeRangeAdjustment extends TimeRange {
  edge: 'start' | 'end'
  deltaMinutes: number
  minimumDuration: number
}

export interface DayTimeRange extends TimeRange {
  dayIndex: number
}

export function adjustTimeRangeEdge({
  startMinute,
  endMinute,
  edge,
  deltaMinutes,
  minimumDuration,
}: TimeRangeAdjustment): TimeRange {
  if (![startMinute, endMinute, deltaMinutes, minimumDuration].every(Number.isFinite)
    || endMinute <= startMinute || minimumDuration <= 0) {
    throw new RangeError('Time adjustment requires a valid interval and a positive minimum duration.')
  }
  const duration = endMinute - startMinute
  if (edge === 'start') {
    const requestedStart = startMinute + deltaMinutes
    return requestedStart >= endMinute
      ? { startMinute: requestedStart, endMinute: requestedStart + duration }
      : { startMinute: Math.min(requestedStart, endMinute - minimumDuration), endMinute }
  }
  const requestedEnd = endMinute + deltaMinutes
  return requestedEnd <= startMinute
    ? { startMinute: requestedEnd - duration, endMinute: requestedEnd }
    : { startMinute, endMinute: Math.max(requestedEnd, startMinute + minimumDuration) }
}

/**
 * Moves a range that crossed midnight onto its new day. `rangeDays` is how many
 * days the grid shows from its anchor Monday (7, 14 or 28); ranges that stay inside
 * it keep their day index, others wrap into a neighbouring week via `weekOffset`.
 */
export function normaliseTimeRangeToWeek(range: DayTimeRange, rangeDays = DAYS_IN_WEEK): DayTimeRange & { weekOffset: number } {
  const absoluteStart = range.dayIndex * MINUTES_IN_DAY + range.startMinute
  const absoluteDay = Math.floor(absoluteStart / MINUTES_IN_DAY)
  const startMinute = absoluteStart - absoluteDay * MINUTES_IN_DAY
  if (absoluteDay >= 0 && absoluteDay < rangeDays) {
    return {
      dayIndex: absoluteDay,
      startMinute,
      endMinute: startMinute + range.endMinute - range.startMinute,
      weekOffset: 0,
    }
  }
  const weekOffset = Math.floor(absoluteDay / DAYS_IN_WEEK)
  return {
    dayIndex: absoluteDay - weekOffset * DAYS_IN_WEEK,
    startMinute,
    endMinute: startMinute + range.endMinute - range.startMinute,
    weekOffset,
  }
}

export function getTimeRangeDaySegments(range: DayTimeRange, rangeDays = DAYS_IN_WEEK): DayTimeRange[] {
  const absoluteStart = range.dayIndex * MINUTES_IN_DAY + range.startMinute
  const absoluteEnd = range.dayIndex * MINUTES_IN_DAY + range.endMinute
  return Array.from({ length: rangeDays }, (_, dayIndex) => {
    const dayStart = dayIndex * MINUTES_IN_DAY
    return {
      dayIndex,
      startMinute: Math.max(0, absoluteStart - dayStart),
      endMinute: Math.min(MINUTES_IN_DAY, absoluteEnd - dayStart),
    }
  }).filter((segment) => segment.endMinute > segment.startMinute)
}
