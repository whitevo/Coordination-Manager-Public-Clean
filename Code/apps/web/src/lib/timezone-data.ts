// Comprehensive timezone data for search and display
// Uses IANA timezone identifiers matched with countries, cities, and abbreviations

export interface TimezoneEntry {
  /** IANA timezone identifier, e.g. "America/New_York" */
  iana: string
  /** Display city name */
  city: string
  /** Country name */
  country: string
  /** Common abbreviation(s), e.g. "EST/EDT" */
  abbr: string
  /** UTC offset string, e.g. "UTC-05:00" */
  utcOffset: string
  /** Numeric offset in minutes for sorting */
  offsetMinutes: number
}

/** Get the current UTC offset in minutes for an IANA timezone */
function getOffsetMinutes(iana: string): number {
  try {
    const now = new Date()
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: iana,
      timeZoneName: 'shortOffset',
    })
    const parts = formatter.formatToParts(now)
    const tzPart = parts.find((p) => p.type === 'timeZoneName')
    if (!tzPart) return 0
    const match = tzPart.value.match(/GMT([+-]?)(\d{1,2})(?::(\d{2}))?/)
    if (!match) return 0
    const sign = match[1] === '-' ? -1 : 1
    const hours = parseInt(match[2], 10)
    const minutes = parseInt(match[3] || '0', 10)
    return sign * (hours * 60 + minutes)
  } catch {
    return 0
  }
}

/** Format offset minutes as "UTC+HH:MM" */
function formatOffset(minutes: number): string {
  if (minutes === 0) return 'UTC+00:00'
  const sign = minutes >= 0 ? '+' : '-'
  const abs = Math.abs(minutes)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return `UTC${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Get short abbreviation from Intl */
function getAbbreviation(iana: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: iana,
      timeZoneName: 'short',
    })
    const parts = formatter.formatToParts(new Date())
    const tzPart = parts.find((p) => p.type === 'timeZoneName')
    return tzPart?.value || ''
  } catch {
    return ''
  }
}

// Raw timezone definitions: [iana, city, country]
const TIMEZONE_RAW: [string, string, string][] = [
  // UTC
  ['UTC', 'UTC', 'Coordinated Universal Time'],
  // North America
  ['America/New_York', 'New York', 'United States'],
  ['America/Chicago', 'Chicago', 'United States'],
  ['America/Denver', 'Denver', 'United States'],
  ['America/Los_Angeles', 'Los Angeles', 'United States'],
  ['America/Phoenix', 'Phoenix', 'United States'],
  ['America/Anchorage', 'Anchorage', 'United States'],
  ['Pacific/Honolulu', 'Honolulu', 'United States'],
  ['America/Toronto', 'Toronto', 'Canada'],
  ['America/Vancouver', 'Vancouver', 'Canada'],
  ['America/Edmonton', 'Edmonton', 'Canada'],
  ['America/Winnipeg', 'Winnipeg', 'Canada'],
  ['America/Halifax', 'Halifax', 'Canada'],
  ['America/St_Johns', "St. John's", 'Canada'],
  ['America/Mexico_City', 'Mexico City', 'Mexico'],
  ['America/Tijuana', 'Tijuana', 'Mexico'],
  ['America/Cancun', 'Cancun', 'Mexico'],
  // Central America & Caribbean
  ['America/Guatemala', 'Guatemala City', 'Guatemala'],
  ['America/Costa_Rica', 'San Jose', 'Costa Rica'],
  ['America/Panama', 'Panama City', 'Panama'],
  ['America/Jamaica', 'Kingston', 'Jamaica'],
  ['America/Puerto_Rico', 'San Juan', 'Puerto Rico'],
  ['America/Havana', 'Havana', 'Cuba'],
  // South America
  ['America/Sao_Paulo', 'Sao Paulo', 'Brazil'],
  ['America/Argentina/Buenos_Aires', 'Buenos Aires', 'Argentina'],
  ['America/Santiago', 'Santiago', 'Chile'],
  ['America/Bogota', 'Bogota', 'Colombia'],
  ['America/Lima', 'Lima', 'Peru'],
  ['America/Caracas', 'Caracas', 'Venezuela'],
  ['America/Montevideo', 'Montevideo', 'Uruguay'],
  ['America/La_Paz', 'La Paz', 'Bolivia'],
  ['America/Guayaquil', 'Quito', 'Ecuador'],
  ['America/Asuncion', 'Asuncion', 'Paraguay'],
  // Europe
  ['Europe/London', 'London', 'United Kingdom'],
  ['Europe/Dublin', 'Dublin', 'Ireland'],
  ['Europe/Paris', 'Paris', 'France'],
  ['Europe/Berlin', 'Berlin', 'Germany'],
  ['Europe/Madrid', 'Madrid', 'Spain'],
  ['Europe/Rome', 'Rome', 'Italy'],
  ['Europe/Amsterdam', 'Amsterdam', 'Netherlands'],
  ['Europe/Brussels', 'Brussels', 'Belgium'],
  ['Europe/Zurich', 'Zurich', 'Switzerland'],
  ['Europe/Vienna', 'Vienna', 'Austria'],
  ['Europe/Stockholm', 'Stockholm', 'Sweden'],
  ['Europe/Oslo', 'Oslo', 'Norway'],
  ['Europe/Copenhagen', 'Copenhagen', 'Denmark'],
  ['Europe/Helsinki', 'Helsinki', 'Finland'],
  ['Europe/Warsaw', 'Warsaw', 'Poland'],
  ['Europe/Prague', 'Prague', 'Czech Republic'],
  ['Europe/Budapest', 'Budapest', 'Hungary'],
  ['Europe/Bucharest', 'Bucharest', 'Romania'],
  ['Europe/Sofia', 'Sofia', 'Bulgaria'],
  ['Europe/Athens', 'Athens', 'Greece'],
  ['Europe/Istanbul', 'Istanbul', 'Turkey'],
  ['Europe/Moscow', 'Moscow', 'Russia'],
  ['Europe/Lisbon', 'Lisbon', 'Portugal'],
  ['Europe/Kiev', 'Kyiv', 'Ukraine'],
  ['Europe/Belgrade', 'Belgrade', 'Serbia'],
  ['Europe/Zagreb', 'Zagreb', 'Croatia'],
  ['Europe/Bratislava', 'Bratislava', 'Slovakia'],
  ['Europe/Ljubljana', 'Ljubljana', 'Slovenia'],
  ['Europe/Tallinn', 'Tallinn', 'Estonia'],
  ['Europe/Riga', 'Riga', 'Latvia'],
  ['Europe/Vilnius', 'Vilnius', 'Lithuania'],
  // Middle East
  ['Asia/Dubai', 'Dubai', 'United Arab Emirates'],
  ['Asia/Riyadh', 'Riyadh', 'Saudi Arabia'],
  ['Asia/Tehran', 'Tehran', 'Iran'],
  ['Asia/Jerusalem', 'Jerusalem', 'Israel'],
  ['Asia/Beirut', 'Beirut', 'Lebanon'],
  ['Asia/Baghdad', 'Baghdad', 'Iraq'],
  ['Asia/Kuwait', 'Kuwait City', 'Kuwait'],
  ['Asia/Qatar', 'Doha', 'Qatar'],
  ['Asia/Bahrain', 'Manama', 'Bahrain'],
  ['Asia/Muscat', 'Muscat', 'Oman'],
  // Central & South Asia
  ['Asia/Kolkata', 'Mumbai', 'India'],
  ['Asia/Colombo', 'Colombo', 'Sri Lanka'],
  ['Asia/Kathmandu', 'Kathmandu', 'Nepal'],
  ['Asia/Dhaka', 'Dhaka', 'Bangladesh'],
  ['Asia/Karachi', 'Karachi', 'Pakistan'],
  ['Asia/Tashkent', 'Tashkent', 'Uzbekistan'],
  ['Asia/Almaty', 'Almaty', 'Kazakhstan'],
  ['Asia/Kabul', 'Kabul', 'Afghanistan'],
  // East & Southeast Asia
  ['Asia/Shanghai', 'Shanghai', 'China'],
  ['Asia/Hong_Kong', 'Hong Kong', 'Hong Kong'],
  ['Asia/Tokyo', 'Tokyo', 'Japan'],
  ['Asia/Seoul', 'Seoul', 'South Korea'],
  ['Asia/Taipei', 'Taipei', 'Taiwan'],
  ['Asia/Singapore', 'Singapore', 'Singapore'],
  ['Asia/Bangkok', 'Bangkok', 'Thailand'],
  ['Asia/Ho_Chi_Minh', 'Ho Chi Minh City', 'Vietnam'],
  ['Asia/Jakarta', 'Jakarta', 'Indonesia'],
  ['Asia/Manila', 'Manila', 'Philippines'],
  ['Asia/Kuala_Lumpur', 'Kuala Lumpur', 'Malaysia'],
  ['Asia/Yangon', 'Yangon', 'Myanmar'],
  ['Asia/Phnom_Penh', 'Phnom Penh', 'Cambodia'],
  // Africa
  ['Africa/Cairo', 'Cairo', 'Egypt'],
  ['Africa/Lagos', 'Lagos', 'Nigeria'],
  ['Africa/Johannesburg', 'Johannesburg', 'South Africa'],
  ['Africa/Nairobi', 'Nairobi', 'Kenya'],
  ['Africa/Casablanca', 'Casablanca', 'Morocco'],
  ['Africa/Accra', 'Accra', 'Ghana'],
  ['Africa/Addis_Ababa', 'Addis Ababa', 'Ethiopia'],
  ['Africa/Dar_es_Salaam', 'Dar es Salaam', 'Tanzania'],
  ['Africa/Kampala', 'Kampala', 'Uganda'],
  ['Africa/Algiers', 'Algiers', 'Algeria'],
  ['Africa/Tunis', 'Tunis', 'Tunisia'],
  ['Africa/Khartoum', 'Khartoum', 'Sudan'],
  // Oceania
  ['Australia/Sydney', 'Sydney', 'Australia'],
  ['Australia/Melbourne', 'Melbourne', 'Australia'],
  ['Australia/Brisbane', 'Brisbane', 'Australia'],
  ['Australia/Perth', 'Perth', 'Australia'],
  ['Australia/Adelaide', 'Adelaide', 'Australia'],
  ['Australia/Darwin', 'Darwin', 'Australia'],
  ['Pacific/Auckland', 'Auckland', 'New Zealand'],
  ['Pacific/Fiji', 'Suva', 'Fiji'],
  ['Pacific/Guam', 'Hagatna', 'Guam'],
  ['Pacific/Port_Moresby', 'Port Moresby', 'Papua New Guinea'],
]

/** Build the full timezone entries list with computed offsets and abbreviations */
function buildTimezoneEntries(): TimezoneEntry[] {
  return TIMEZONE_RAW.map(([iana, city, country]) => {
    const offsetMinutes = getOffsetMinutes(iana)
    return {
      iana,
      city,
      country,
      abbr: getAbbreviation(iana),
      utcOffset: formatOffset(offsetMinutes),
      offsetMinutes,
    }
  }).sort((a, b) => a.offsetMinutes - b.offsetMinutes)
}

// Cache the entries (computed once on first import)
let _cachedEntries: TimezoneEntry[] | null = null

/** Get all timezone entries, sorted by UTC offset */
export function getAllTimezones(): TimezoneEntry[] {
  if (!_cachedEntries) {
    _cachedEntries = buildTimezoneEntries()
  }
  return _cachedEntries
}

/** Find a timezone entry by IANA identifier */
export function findTimezone(iana: string): TimezoneEntry | undefined {
  return getAllTimezones().find((tz) => tz.iana === iana)
}

/** Get display label for a timezone, e.g. "UTC+05:30 - Mumbai (IST)" */
export function formatTimezoneLabel(entry: TimezoneEntry): string {
  if (entry.iana === 'UTC') return 'UTC+00:00 - UTC'
  return `${entry.utcOffset} - ${entry.city} (${entry.abbr})`
}

/** Get short display label, e.g. "Mumbai (IST)" */
export function formatTimezoneShort(entry: TimezoneEntry): string {
  if (entry.iana === 'UTC') return 'UTC'
  return `${entry.city} (${entry.abbr})`
}

/** Filter timezone entries by a search query (matches city, country, abbr, offset) */
export function searchTimezones(query: string): TimezoneEntry[] {
  if (!query.trim()) return getAllTimezones()
  const lower = query.toLowerCase().trim()
  return getAllTimezones().filter(
    (tz) =>
      tz.city.toLowerCase().includes(lower) ||
      tz.country.toLowerCase().includes(lower) ||
      tz.abbr.toLowerCase().includes(lower) ||
      tz.utcOffset.toLowerCase().includes(lower) ||
      tz.iana.toLowerCase().includes(lower)
  )
}

/** Group timezone entries by region (first part of IANA identifier) */
export function groupByRegion(entries: TimezoneEntry[]): Record<string, TimezoneEntry[]> {
  const groups: Record<string, TimezoneEntry[]> = {}
  for (const entry of entries) {
    let region: string
    if (entry.iana === 'UTC') {
      region = 'UTC'
    } else {
      region = entry.iana.split('/')[0]
    }
    if (!groups[region]) groups[region] = []
    groups[region].push(entry)
  }
  return groups
}

/** Group timezone entries by country */
export function groupByCountry(entries: TimezoneEntry[]): Record<string, TimezoneEntry[]> {
  const groups: Record<string, TimezoneEntry[]> = {}
  for (const entry of entries) {
    if (!groups[entry.country]) groups[entry.country] = []
    groups[entry.country].push(entry)
  }
  return groups
}

/** Detect user's local IANA timezone */
export function detectLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'UTC'
  }
}

/** Maximum number of simultaneous timezones a user can display */
export const MAX_TIMEZONES = 5

/**
 * Convert a UTC time string (e.g. "09:00") to the equivalent time
 * in the given IANA timezone. Returns "HH:MM" in local tz.
 *
 * Uses a reference date (today) to get the correct DST offset.
 */
export function convertUtcTimeToTimezone(utcTime: string, iana: string): string {
  if (iana === 'UTC') return utcTime
  const [hStr, mStr] = utcTime.split(':')
  const h = parseInt(hStr, 10)
  const m = parseInt(mStr, 10)
  // Build a UTC Date for today at the given HH:MM
  const now = new Date()
  const utcDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m, 0))
  // Format in the target timezone
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: iana,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return formatter.format(utcDate)
}

/**
 * Get current time display in a timezone (HH:MM).
 */
export function getCurrentTimeInTimezone(iana: string): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: iana,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return formatter.format(new Date())
}

// ─── Timezone-Aware Date/Time Formatting Helpers ───────────────────────────
// All functions below accept an IANA timezone string (e.g. "America/New_York")
// and format the given date/time accordingly instead of using UTC or browser locale.

/**
 * Get the short timezone abbreviation for display, e.g. "EST", "CET", "UTC".
 */
export function getTimezoneAbbr(iana: string): string {
  if (iana === 'UTC') return 'UTC'
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: iana,
      timeZoneName: 'short',
    })
    const parts = formatter.formatToParts(new Date())
    const tzPart = parts.find((p) => p.type === 'timeZoneName')
    return tzPart?.value || iana
  } catch {
    return iana
  }
}

/**
 * Format a Date/ISO string as "HH:MM AM/PM TZ" in the given timezone.
 * Input is a full Date or ISO string (not a bare "HH:MM" -- use convertUtcTimeToTimezone for that).
 */
export function formatTimeInTimezone(date: Date | string, iana: string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return '--'
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: iana,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  return formatter.format(d)
}

/**
 * Format a Date/ISO string as "MMM d, yyyy" in the given timezone.
 */
export function formatDateInTimezone(date: Date | string, iana: string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return '--'
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: iana,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  return formatter.format(d)
}

/**
 * Format a Date/ISO string as "MMM d, yyyy h:mm AM/PM TZ" in the given timezone.
 */
export function formatDateTimeInTimezone(date: Date | string, iana: string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return '--'
  const abbr = getTimezoneAbbr(iana)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: iana,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  return `${formatter.format(d)} ${abbr}`
}

/**
 * Format a Date/ISO string as "dd.mm.yyyy" in the given timezone.
 */
export function formatDateDDMMYYYYInTimezone(date: Date | string, iana: string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return '--'
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: iana,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
  // en-GB gives "dd/mm/yyyy" -- replace slashes with dots
  return formatter.format(d).replace(/\//g, '.')
}

/**
 * Format a Date/ISO string as "dd.mm.yyyy HH:MM TZ" in the given timezone.
 */
export function formatDateTimeDDMMYYYYInTimezone(date: Date | string, iana: string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return '--'
  const abbr = getTimezoneAbbr(iana)
  const datePart = formatDateDDMMYYYYInTimezone(d, iana)
  const timeFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: iana,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return `${datePart} ${timeFmt.format(d)} ${abbr}`
}

/**
 * Format a UTC time string (e.g. "09:00") as "h:mm AM/PM TZ" in the given timezone.
 * Used in meeting cards and side panels to display meeting times.
 */
export function formatUtcTimeWithPeriodInTimezone(utcTime: string, iana: string): string {
  const [hStr, mStr] = utcTime.split(':')
  const h = parseInt(hStr, 10)
  const m = parseInt(mStr, 10)
  const now = new Date()
  const utcDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m, 0))
  const abbr = getTimezoneAbbr(iana)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: iana,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  return `${formatter.format(utcDate)} ${abbr}`
}

/** Same as formatUtcTimeWithPeriodInTimezone but uses 24-hour clock ("HH:MM TZ"). */
export function formatUtcTime24InTimezone(utcTime: string, iana: string): string {
  const [hStr, mStr] = utcTime.split(':')
  const h = parseInt(hStr, 10)
  const m = parseInt(mStr, 10)
  const now = new Date()
  const utcDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m, 0))
  const abbr = getTimezoneAbbr(iana)
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: iana,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return `${formatter.format(utcDate)} ${abbr}`
}

/**
 * Format a Date/ISO string for short display: "Mon, Jan 1" in the given timezone.
 */
export function formatShortDateInTimezone(date: Date | string, iana: string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: iana,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  return formatter.format(d)
}

/**
 * Format a Date/ISO string for display with time: "h:mm AM/PM" only, no TZ suffix.
 */
export function formatTimeOnlyInTimezone(date: Date | string, iana: string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: iana,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  return formatter.format(d)
}

/**
 * Get the primary timezone from localStorage (for use outside React components).
 * Returns 'UTC' if no timezone is set.
 */
export function getPrimaryTimezone(): string {
  try {
    const raw = localStorage.getItem('coordination-timezones')
    if (raw) {
      const parsed = JSON.parse(raw) as { primary?: string }
      if (parsed.primary) return parsed.primary
    }
  } catch {
    // ignore
  }
  return 'UTC'
}

/**
 * Get the browser's local IANA timezone, or null when unavailable.
 */
export function getBrowserTimezone(): string | null {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone
    return resolved || null
  } catch {
    return null
  }
}

/**
 * Get the timezone used for editing wall-clock date/time values (e.g. the
 * mailbox invitation picker). Prefers the configured primary timezone, but
 * falls back to the browser's local timezone instead of UTC, so prefilled
 * wall-clock times match the user's local expectation. An explicit 'UTC'
 * primary choice is still respected.
 */
export function getEditingTimezone(): string {
  try {
    const raw = localStorage.getItem('coordination-timezones')
    if (raw) {
      const parsed = JSON.parse(raw) as { primary?: string }
      if (parsed.primary) return parsed.primary
    }
  } catch {
    // ignore
  }
  return getBrowserTimezone() || 'UTC'
}

// ─── DST Transition Detection ──────────────────────────────────────────────

/**
 * Convert a UTC time string (e.g. "09:00") to the equivalent time
 * in the given IANA timezone on a specific date. Returns "HH:MM" in local tz.
 */
export function convertUtcTimeToTimezoneOnDate(utcTime: string, iana: string, refDate: Date): string {
  if (iana === 'UTC') return utcTime
  const [hStr, mStr] = utcTime.split(':')
  const h = parseInt(hStr, 10)
  const m = parseInt(mStr, 10)
  // Use local date components -- visibleDays from date-fns are local-time dates
  const utcDate = new Date(Date.UTC(refDate.getFullYear(), refDate.getMonth(), refDate.getDate(), h, m, 0))
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: iana,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return formatter.format(utcDate)
}

/**
 * Get the UTC offset in minutes for a timezone on a specific date.
 */
export function getOffsetOnDate(iana: string, date: Date): number {
  if (iana === 'UTC') return 0
  try {
    // Use noon to avoid edge-case issues around midnight
    // Use local date components -- visibleDays from date-fns are local-time dates
    const ref = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0))
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: iana,
      timeZoneName: 'shortOffset',
    })
    const parts = formatter.formatToParts(ref)
    const tzPart = parts.find((p) => p.type === 'timeZoneName')
    if (!tzPart) return 0
    const match = tzPart.value.match(/GMT([+-]?)(\d{1,2})(?::(\d{2}))?/)
    if (!match) return 0
    const sign = match[1] === '-' ? -1 : 1
    const hours = parseInt(match[2], 10)
    const minutes = parseInt(match[3] || '0', 10)
    return sign * (hours * 60 + minutes)
  } catch {
    return 0
  }
}

export interface DstTransition {
  /** IANA timezone that has a DST change */
  iana: string
  /** Index of the first day (in the visible days array) that uses the NEW offset */
  transitionDayIndex: number
  /** Offset in minutes BEFORE the transition */
  offsetBefore: number
  /** Offset in minutes AFTER the transition */
  offsetAfter: number
  /** Abbreviation before transition (e.g. "EET") */
  abbrBefore: string
  /** Abbreviation after transition (e.g. "EEST") */
  abbrAfter: string
}

/**
 * Get the short timezone abbreviation on a specific date.
 */
export function getTimezoneAbbrOnDate(iana: string, date: Date): string {
  if (iana === 'UTC') return 'UTC'
  try {
    // Use local date components -- visibleDays from date-fns are local-time dates
    const ref = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0))
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: iana,
      timeZoneName: 'short',
    })
    const parts = formatter.formatToParts(ref)
    const tzPart = parts.find((p) => p.type === 'timeZoneName')
    return tzPart?.value || iana
  } catch {
    return iana
  }
}

/**
 * Detect DST transitions within a range of visible days for a set of timezones.
 * Returns an array of transitions found (one per timezone that changes).
 */
export function detectDstTransitions(ianas: string[], visibleDays: Date[]): DstTransition[] {
  if (visibleDays.length < 2) return []
  const transitions: DstTransition[] = []

  for (const iana of ianas) {
    if (iana === 'UTC') continue
    const firstOffset = getOffsetOnDate(iana, visibleDays[0])
    for (let i = 1; i < visibleDays.length; i++) {
      const offset = getOffsetOnDate(iana, visibleDays[i])
      if (offset !== firstOffset) {
        transitions.push({
          iana,
          transitionDayIndex: i,
          offsetBefore: firstOffset,
          offsetAfter: offset,
          abbrBefore: getTimezoneAbbrOnDate(iana, visibleDays[0]),
          abbrAfter: getTimezoneAbbrOnDate(iana, visibleDays[i]),
        })
        break // Only one transition per timezone in a week view
      }
    }
  }
  return transitions
}
