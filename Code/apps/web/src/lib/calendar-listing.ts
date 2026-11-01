/**
 * Public Coordination Calendar listing rules (mirrors apps/api/src/services/calendar-archive.ts).
 *
 * Any-week calendars (general weekday availability) stay listed for
 * PUBLIC_LISTING_GRACE_DAYS after creation, then for the same period after each
 * planned meeting. The API persists the resulting archive state in archived_at.
 * Dated calendars archive once their configured end date has passed.
 * Owners can also archive an any-week calendar manually (config.archived); it
 * keeps its format and stays reachable by link, but leaves the active lists.
 */
export const PUBLIC_LISTING_GRACE_DAYS = 14

/** Below this many active calendars, archived ones fill the Home page list. */
export const HOME_ACTIVE_CALENDAR_THRESHOLD = 4

export const HOME_CALENDAR_LIMIT = 6

export interface ListingCalendarConfig {
  customEndDate?: string
  hideDateNumbers?: boolean
  archived?: boolean
  [key: string]: unknown
}

export interface ListingCalendar {
  config?: ListingCalendarConfig | Record<string, unknown> | null
  created_at?: string
  archived_at?: string | null
  has_recurring_meetings?: boolean
}

function readConfig(calendar: ListingCalendar): ListingCalendarConfig {
  return (calendar.config || {}) as ListingCalendarConfig
}

/** Any-week calendars use general weekday availability instead of fixed dates. */
export function isAnyWeekCalendar(calendar: ListingCalendar): boolean {
  return !!readConfig(calendar).hideDateNumbers || !!calendar.has_recurring_meetings
}

export function isCalendarArchived(calendar: ListingCalendar): boolean {
  if (calendar.archived_at) return true
  if (readConfig(calendar).archived === true) return true
  if (isAnyWeekCalendar(calendar)) return false
  const end = readConfig(calendar).customEndDate
  if (!end) return false
  return new Date(end + 'T23:59:59') < new Date()
}

/**
 * Home page selection: active calendars first, archived ones only used as
 * fill-in while fewer than HOME_ACTIVE_CALENDAR_THRESHOLD are active.
 */
export function selectHomePageCalendars<T extends ListingCalendar & { created_at?: string }>(
  calendars: T[],
  limit = HOME_CALENDAR_LIMIT
): T[] {
  const sorted = [...calendars].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  const active = sorted.filter(c => !isCalendarArchived(c))
  if (active.length >= HOME_ACTIVE_CALENDAR_THRESHOLD) return active.slice(0, limit)
  const archived = sorted.filter(isCalendarArchived)
  return [...active, ...archived].slice(0, limit)
}
