export const TIME_ZOOM_LEVELS = [15, 30, 60] as const
export type TimeZoomLevel = typeof TIME_ZOOM_LEVELS[number]

export const DAY_ZOOM_LEVELS = [1, 2, 3, 5, 7, 14, 28] as const
export type DayZoomLevel = typeof DAY_ZOOM_LEVELS[number]
export const DEFAULT_DAY_ZOOM_LEVEL: DayZoomLevel = 7

const DAYS_IN_WEEK = 7

/** -1 zooms in (finer slots / fewer days), +1 zooms out (coarser slots / more days). */
export type ZoomDirection = -1 | 1

export function isDayZoomLevel(value: unknown): value is DayZoomLevel {
  return typeof value === 'number' && (DAY_ZOOM_LEVELS as readonly number[]).includes(value)
}

function stepLevel<T extends number>(levels: readonly T[], current: T, direction: ZoomDirection): T {
  const index = levels.indexOf(current)
  if (index < 0) return current
  const nextIndex = Math.min(levels.length - 1, Math.max(0, index + direction))
  return levels[nextIndex]
}

export function stepTimeZoomLevel(current: TimeZoomLevel, direction: ZoomDirection): TimeZoomLevel {
  return stepLevel(TIME_ZOOM_LEVELS, current, direction)
}

export function stepDayZoomLevel(current: DayZoomLevel, direction: ZoomDirection): DayZoomLevel {
  return stepLevel(DAY_ZOOM_LEVELS, current, direction)
}

/** Zooming out from a sub-week view returns straight to the single week before widening further. */
export function zoomOutDayLevel(current: DayZoomLevel): DayZoomLevel {
  return current < DAYS_IN_WEEK ? DEFAULT_DAY_ZOOM_LEVEL : stepDayZoomLevel(current, 1)
}

export function canStepZoomLevel<T extends number>(levels: readonly T[], current: T, direction: ZoomDirection): boolean {
  const index = levels.indexOf(current)
  return index >= 0 && index + direction >= 0 && index + direction < levels.length
}

/** Number of consecutive days (from the anchor Monday) the grid works with. */
export function getDayRangeLength(level: DayZoomLevel): number {
  return Math.max(DAYS_IN_WEEK, level)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function centeredWindow(size: number, anchorWeekday: number): number[] {
  const start = clamp(anchorWeekday - Math.floor(size / 2), 0, DAYS_IN_WEEK - size)
  return Array.from({ length: size }, (_, offset) => start + offset)
}

/**
 * Day indexes (0 = Monday of the anchor week) visible at a zoom level.
 *
 * 5 and 3 days keep a window centred on the anchor weekday, clamped inside the week.
 * Below 3 days, days before the anchor are dropped first, then the right-most day,
 * so the 1-day view is always the anchor day.
 */
export function getVisibleDayIndexes(level: DayZoomLevel, anchorWeekday: number): number[] {
  if (level >= DAYS_IN_WEEK) {
    return Array.from({ length: level }, (_, index) => index)
  }
  const anchor = clamp(Math.trunc(anchorWeekday), 0, DAYS_IN_WEEK - 1)
  if (level === 5 || level === 3) {
    return centeredWindow(level, anchor)
  }
  const days = centeredWindow(3, anchor)
  while (days.length > level) {
    if (days[0] < anchor) days.shift()
    else days.pop()
  }
  return days
}

/** Consecutive day indexes for a sub-week window that starts at `start` (may run into the next week). */
export function getDayWindowIndexes(level: DayZoomLevel, start: number): number[] {
  return Array.from({ length: level }, (_, offset) => start + offset)
}

/**
 * Moves a sub-week window by `direction` days. The start stays within 0..6 of its week;
 * `weekOffset` says how many weeks the anchor Monday has to move.
 */
export function shiftDayWindow(start: number, direction: number): { start: number; weekOffset: number } {
  const next = start + direction
  const weekOffset = Math.floor(next / DAYS_IN_WEEK)
  return { start: next - weekOffset * DAYS_IN_WEEK, weekOffset }
}

/** Whole weeks the grid has to load so every visible day index has a column. */
export function getDayRangeLengthForIndexes(level: DayZoomLevel, visibleIndexes: readonly number[]): number {
  const lastIndex = visibleIndexes.length > 0 ? Math.max(...visibleIndexes) : 0
  return Math.max(getDayRangeLength(level), Math.ceil((lastIndex + 1) / DAYS_IN_WEEK) * DAYS_IN_WEEK)
}

/** Monday-based weekday index (0 = Monday ... 6 = Sunday). */
export function getMondayBasedWeekday(date: Date): number {
  return (date.getDay() + 6) % DAYS_IN_WEEK
}

/** How many weeks the Previous/Next buttons move at a zoom level. */
export function getNavigationWeekStep(level: DayZoomLevel): number {
  return Math.max(1, Math.round(getDayRangeLength(level) / DAYS_IN_WEEK))
}

export function formatDayZoomLabel(level: DayZoomLevel): string {
  if (level === 7) return '1 week'
  if (level === 14) return '2 weeks'
  if (level === 28) return '4 weeks'
  return level === 1 ? '1 day' : `${level} days`
}

export function formatTimeZoomLabel(level: TimeZoomLevel): string {
  return level === 60 ? '1h' : `${level}m`
}
