/**
 * Deterministic date + time detection for plain-text messages.
 *
 * A candidate is only produced when BOTH a valid calendar date and a clock time
 * are found close together in the text. Dates alone or times alone never match.
 */

export interface DetectedDateTime {
  /** Local wall-clock start, formatted as YYYY-MM-DDTHH:mm (no timezone applied). */
  startLocal: string
  /** Local wall-clock end, formatted as YYYY-MM-DDTHH:mm (no timezone applied). */
  endLocal: string
  year: number
  month: number
  day: number
  hour: number
  minute: number
  durationMinutes: number
  endSource: 'explicit' | 'duration' | 'default'
  dateText: string
  timeText: string
  index: number
  dayFirstAssumed: boolean
  yearAssumed: boolean
}

interface Span {
  start: number
  end: number
}

interface DateHit extends Span {
  year: number
  month: number
  day: number
  text: string
  dayFirstAssumed: boolean
  yearAssumed: boolean
}

interface TimeHit extends Span {
  hour: number
  minute: number
  endHour: number | null
  endMinute: number | null
  hasSeconds: boolean
  text: string
}

export interface DetectDateTimeOptions {
  /** Interpretation of ambiguous numeric dates such as 05/08/2026. Defaults to day-first. */
  dayFirst?: boolean
  /** Year used when a written date omits it. Defaults to the current year. */
  referenceYear?: number
  /** Duration applied when neither an end time nor a duration is present. */
  defaultDurationMinutes?: number
  /** Keep document/invoice/log style timestamps that are normally discarded. Defaults to false. */
  allowNoiseContext?: boolean
  /** ISO instants (such as the message send time) that must not be treated as appointments. */
  excludeInstants?: Array<string | null | undefined>
  /** Tolerance in minutes when matching against excludeInstants. Defaults to 5. */
  excludeToleranceMinutes?: number
}

const MAX_GAP_CHARS = 32
const MAX_GAP_NEWLINES = 1
const CONTEXT_BEFORE_CHARS = 120
const CONTEXT_AFTER_CHARS = 60
const DEFAULT_DURATION_MINUTES = 60
const MIN_YEAR = 1970
const MAX_YEAR = 2100

// English and Estonian month names (Estonian uses \u00e4 for a-umlaut).
const MONTH_NAME_GROUPS: string[][] = [
  ['january', 'jan', 'jaanuar', 'jaan'],
  ['february', 'feb', 'veebruar', 'veebr'],
  ['march', 'mar', 'm\u00e4rts', 'marts'],
  ['april', 'apr', 'aprill'],
  ['may', 'mai'],
  ['june', 'jun', 'juuni'],
  ['july', 'jul', 'juuli'],
  ['august', 'aug'],
  ['september', 'sept', 'sep'],
  ['october', 'oct', 'oktoober', 'okt'],
  ['november', 'nov'],
  ['december', 'dec', 'detsember', 'dets'],
]

const MONTH_LOOKUP = new Map<string, number>()
for (let index = 0; index < MONTH_NAME_GROUPS.length; index += 1) {
  for (const name of MONTH_NAME_GROUPS[index]) {
    MONTH_LOOKUP.set(name, index + 1)
  }
}

const MONTH_PATTERN = Array.from(MONTH_LOOKUP.keys())
  .sort((a, b) => b.length - a.length)
  .join('|')

const ISO_DATE_PATTERN = /(?<![\d])(\d{4})([./-])(\d{1,2})\2(\d{1,2})(?![\d])/g
const NUMERIC_DATE_PATTERN = /(?<![\d])(\d{1,2})([./-])(\d{1,2})\2(\d{2,4})(?![\d])/g
const DAY_MONTH_YEAR_PATTERN = new RegExp(
  `(?<![\\d])(\\d{1,2})(?:st|nd|rd|th)?\\.?\\s*(?:of\\s+)?(${MONTH_PATTERN})\\b\\.?(?:\\s*,?\\s*(?:of\\s+)?(\\d{4})(?![\\d]))?`,
  'gi',
)
const MONTH_DAY_YEAR_PATTERN = new RegExp(
  `\\b(${MONTH_PATTERN})\\b\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?![\\d])(?:\\s*,?\\s*(\\d{4})(?![\\d]))?`,
  'gi',
)

const TIME_PATTERN =
  /(?<![\d.:/-])(\d{1,2})\s*[:.]\s*(\d{2})(\s*[:.]\s*\d{2})?\s*(a\.?m\.?|p\.?m\.?)?(?:\s*(?:-|to|until|kuni)\s*(\d{1,2})\s*[:.]\s*(\d{2})\s*(a\.?m\.?|p\.?m\.?)?)?(?!\d|[.:/-]\d)/gi
const MERIDIEM_ONLY_TIME_PATTERN = /(?<![\d.:/-])(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)(?!\d|[.:/-]\d)/gi

const DURATION_MINUTES_PATTERN = /(?<![\d])(\d{1,3})\s*(?:minutes?|minuti?t?|mins?\.?|min\.?)\b/i
const DURATION_HOURS_PATTERN = /(?<![\d])(\d{1,2})(?:[.,](\d{1,2}))?\s*(?:hours?|hrs?\.?|h\b|tundi|tund)/i

/**
 * Contexts where a date and time describe a document, invoice, or log entry rather
 * than an appointment. Matched against the line holding the date.
 */
const NOISE_LINE_PATTERNS: RegExp[] = [
  /\b(?:invoice|receipt|order\s*(?:no|nr|#)|purchase|payment|billing|statement|refund|transaction)\b/i,
  /\b(?:arve|makse|maksmine|tellimus|t\u00e4htaeg|makset\u00e4htaeg|kviitung)\b/i,
  /\b(?:due|issued|paid|expired?|expires|expiry|valid\s+(?:until|from|till))\b/i,
  /\b(?:copyright|all\s+rights\s+reserved|version|build|revision|changelog|release\s+notes)\b/i,
  /\u00a9/,
  /\b(?:created|updated|modified|generated|published|printed|exported|logged|downloaded|uploaded|delivered|signed|submitted)\s*(?:on|at|:)/i,
  /\b(?:last\s+(?:login|updated|modified|seen)|timestamp|log\s*entry|audit\s*log)\b/i,
  /^\s*(?:date|sent|received|from|to|cc|bcc|reply-to|subject|kuup\u00e4ev|saadetud|saatja)\s*:/i,
  /\bwrote:/i,
  /\b(?:unsubscribe|view\s+in\s+browser|privacy\s+policy|terms\s+of\s+service)\b/i,
]

/** Replaces lookalike unicode characters with ASCII equivalents. Length preserving. */
function normalizeForScan(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  if (year < MIN_YEAR || year > MAX_YEAR) return false
  if (month < 1 || month > 12) return false
  return day >= 1 && day <= daysInMonth(year, month)
}

function normalizeYear(raw: string): number | null {
  if (raw.length === 4) return Number(raw)
  if (raw.length === 2) return 2000 + Number(raw)
  return null
}

function monthFromName(raw: string): number | null {
  const normalized = raw.trim().toLowerCase().replace(/\.$/, '')
  return MONTH_LOOKUP.get(normalized) ?? null
}

function overlaps(span: Span, others: Span[]): boolean {
  return others.some((other) => span.start < other.end && other.start < span.end)
}

function collectDates(text: string, dayFirst: boolean, referenceYear: number): DateHit[] {
  const hits: DateHit[] = []

  const push = (hit: DateHit) => {
    if (overlaps(hit, hits)) return
    hits.push(hit)
  }

  ISO_DATE_PATTERN.lastIndex = 0
  for (let match = ISO_DATE_PATTERN.exec(text); match; match = ISO_DATE_PATTERN.exec(text)) {
    const year = Number(match[1])
    const month = Number(match[3])
    const day = Number(match[4])
    if (!isValidDate(year, month, day)) continue
    push({
      start: match.index,
      end: match.index + match[0].length,
      year,
      month,
      day,
      text: match[0],
      dayFirstAssumed: false,
      yearAssumed: false,
    })
  }

  NUMERIC_DATE_PATTERN.lastIndex = 0
  for (let match = NUMERIC_DATE_PATTERN.exec(text); match; match = NUMERIC_DATE_PATTERN.exec(text)) {
    const first = Number(match[1])
    const second = Number(match[3])
    const year = normalizeYear(match[4])
    if (year === null) continue

    let day: number
    let month: number
    let assumed = false
    if (first > 12 && second <= 12) {
      day = first
      month = second
    } else if (second > 12 && first <= 12) {
      day = second
      month = first
    } else {
      assumed = true
      day = dayFirst ? first : second
      month = dayFirst ? second : first
    }

    if (!isValidDate(year, month, day)) continue
    push({
      start: match.index,
      end: match.index + match[0].length,
      year,
      month,
      day,
      text: match[0],
      dayFirstAssumed: assumed,
      yearAssumed: false,
    })
  }

  DAY_MONTH_YEAR_PATTERN.lastIndex = 0
  for (let match = DAY_MONTH_YEAR_PATTERN.exec(text); match; match = DAY_MONTH_YEAR_PATTERN.exec(text)) {
    const month = monthFromName(match[2])
    if (month === null) continue
    const day = Number(match[1])
    const yearAssumed = !match[3]
    const year = match[3] ? Number(match[3]) : referenceYear
    if (!isValidDate(year, month, day)) continue
    push({
      start: match.index,
      end: match.index + match[0].length,
      year,
      month,
      day,
      text: match[0],
      dayFirstAssumed: false,
      yearAssumed,
    })
  }

  MONTH_DAY_YEAR_PATTERN.lastIndex = 0
  for (let match = MONTH_DAY_YEAR_PATTERN.exec(text); match; match = MONTH_DAY_YEAR_PATTERN.exec(text)) {
    const month = monthFromName(match[1])
    if (month === null) continue
    const day = Number(match[2])
    const yearAssumed = !match[3]
    const year = match[3] ? Number(match[3]) : referenceYear
    if (!isValidDate(year, month, day)) continue
    push({
      start: match.index,
      end: match.index + match[0].length,
      year,
      month,
      day,
      text: match[0],
      dayFirstAssumed: false,
      yearAssumed,
    })
  }

  return hits.sort((a, b) => a.start - b.start)
}

function applyMeridiem(hour: number, meridiem: string | undefined): number | null {
  if (!meridiem) return hour <= 23 ? hour : null
  const normalized = meridiem.replace(/\./g, '').toLowerCase()
  if (hour < 1 || hour > 12) return null
  if (normalized === 'pm') return hour === 12 ? 12 : hour + 12
  return hour === 12 ? 0 : hour
}

function collectTimes(text: string, dateSpans: Span[]): TimeHit[] {
  const hits: TimeHit[] = []

  const push = (hit: TimeHit) => {
    if (overlaps(hit, dateSpans) || overlaps(hit, hits)) return
    hits.push(hit)
  }

  TIME_PATTERN.lastIndex = 0
  for (let match = TIME_PATTERN.exec(text); match; match = TIME_PATTERN.exec(text)) {
    const minute = Number(match[2])
    if (minute > 59) continue
    const hour = applyMeridiem(Number(match[1]), match[4])
    if (hour === null) continue

    let endHour: number | null = null
    let endMinute: number | null = null
    if (match[5] && match[6]) {
      const rawEndMinute = Number(match[6])
      const resolvedEndHour = applyMeridiem(Number(match[5]), match[7] || match[4])
      if (resolvedEndHour !== null && rawEndMinute <= 59) {
        endHour = resolvedEndHour
        endMinute = rawEndMinute
      }
    }

    push({
      start: match.index,
      end: match.index + match[0].length,
      hour,
      minute,
      endHour,
      endMinute,
      hasSeconds: Boolean(match[3]),
      text: match[0],
    })
  }

  MERIDIEM_ONLY_TIME_PATTERN.lastIndex = 0
  for (let match = MERIDIEM_ONLY_TIME_PATTERN.exec(text); match; match = MERIDIEM_ONLY_TIME_PATTERN.exec(text)) {
    const hour = applyMeridiem(Number(match[1]), match[2])
    if (hour === null) continue
    push({
      start: match.index,
      end: match.index + match[0].length,
      hour,
      minute: 0,
      endHour: null,
      endMinute: null,
      hasSeconds: false,
      text: match[0],
    })
  }

  return hits.sort((a, b) => a.start - b.start)
}

function gapText(text: string, a: Span, b: Span): string | null {
  if (a.end <= b.start) return text.slice(a.end, b.start)
  if (b.end <= a.start) return text.slice(b.end, a.start)
  return null
}

function isBindableGap(gap: string): boolean {
  if (gap.length > MAX_GAP_CHARS) return false
  if (/\d/.test(gap)) return false
  return (gap.match(/\n/g) || []).length <= MAX_GAP_NEWLINES
}

/**
 * Text around the date, clipped to the enclosing line and to a fixed window so a
 * single-line body (common for HTML derived text) is not judged as a whole.
 */
function contextAround(text: string, index: number): string {
  const lineStart = text.lastIndexOf('\n', index) + 1
  const lineEndIndex = text.indexOf('\n', index)
  const lineEnd = lineEndIndex < 0 ? text.length : lineEndIndex
  return text.slice(
    Math.max(lineStart, index - CONTEXT_BEFORE_CHARS),
    Math.min(lineEnd, index + CONTEXT_AFTER_CHARS),
  )
}

function isNoiseContext(line: string): boolean {
  return NOISE_LINE_PATTERNS.some((pattern) => pattern.test(line))
}

function extractDurationMinutes(line: string): number | null {
  const hoursMatch = line.match(DURATION_HOURS_PATTERN)
  if (hoursMatch) {
    const whole = Number(hoursMatch[1])
    const fraction = hoursMatch[2] ? Number(`0.${hoursMatch[2]}`) : 0
    const minutes = Math.round((whole + fraction) * 60)
    if (minutes > 0 && minutes <= 24 * 60) return minutes
  }

  const minutesMatch = line.match(DURATION_MINUTES_PATTERN)
  if (minutesMatch) {
    const minutes = Number(minutesMatch[1])
    if (minutes > 0 && minutes <= 24 * 60) return minutes
  }

  return null
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function formatLocal(year: number, month: number, day: number, hour: number, minute: number): string {
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`
}

function addMinutes(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  minutesToAdd: number,
): string {
  const base = new Date(Date.UTC(year, month - 1, day, hour, minute, 0))
  const shifted = new Date(base.getTime() + minutesToAdd * 60_000)
  return formatLocal(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    shifted.getUTCHours(),
    shifted.getUTCMinutes(),
  )
}

/**
 * Returns every distinct date-with-time found in the text, ordered by position.
 * Duplicates that resolve to the same start and end are collapsed into one entry.
 * Document, invoice, and log style timestamps are discarded.
 */
export function detectDateTimeCandidates(rawText: string, options: DetectDateTimeOptions = {}): DetectedDateTime[] {
  if (!rawText || !rawText.trim()) return []

  const dayFirst = options.dayFirst !== false
  const referenceYear = options.referenceYear ?? new Date().getUTCFullYear()
  const defaultDuration = options.defaultDurationMinutes ?? DEFAULT_DURATION_MINUTES
  const allowNoiseContext = options.allowNoiseContext === true
  const toleranceMs = (options.excludeToleranceMinutes ?? 5) * 60_000
  const excludedMs = (options.excludeInstants || [])
    .map((value) => (value ? new Date(value).getTime() : Number.NaN))
    .filter((value) => Number.isFinite(value))

  const text = normalizeForScan(rawText)
  const dates = collectDates(text, dayFirst, referenceYear)
  if (dates.length === 0) return []

  const times = collectTimes(text, dates)
  if (times.length === 0) return []

  const seen = new Set<string>()
  const candidates: DetectedDateTime[] = []

  for (const date of dates) {
    const line = contextAround(text, date.start)
    if (!allowNoiseContext && isNoiseContext(line)) continue

    let bestTime: TimeHit | null = null
    let bestDistance = Number.POSITIVE_INFINITY

    for (const time of times) {
      const gap = gapText(text, date, time)
      if (gap === null || !isBindableGap(gap)) continue
      const distance = gap.length + (time.start < date.start ? 1 : 0)
      if (distance < bestDistance) {
        bestDistance = distance
        bestTime = time
      }
    }

    if (!bestTime) continue
    // A seconds component marks a machine-generated timestamp, not a booking.
    if (!allowNoiseContext && bestTime.hasSeconds) continue

    const startLocal = formatLocal(date.year, date.month, date.day, bestTime.hour, bestTime.minute)

    let endLocal: string
    let endSource: DetectedDateTime['endSource']
    let durationMinutes: number

    if (bestTime.endHour !== null && bestTime.endMinute !== null) {
      const startMinutes = bestTime.hour * 60 + bestTime.minute
      const endMinutes = bestTime.endHour * 60 + bestTime.endMinute
      durationMinutes = endMinutes > startMinutes ? endMinutes - startMinutes : endMinutes + 24 * 60 - startMinutes
      endLocal = addMinutes(date.year, date.month, date.day, bestTime.hour, bestTime.minute, durationMinutes)
      endSource = 'explicit'
    } else {
      const lineDuration = extractDurationMinutes(line)
      durationMinutes = lineDuration ?? defaultDuration
      endLocal = addMinutes(date.year, date.month, date.day, bestTime.hour, bestTime.minute, durationMinutes)
      endSource = lineDuration ? 'duration' : 'default'
    }

    if (excludedMs.length > 0) {
      const startMs = Date.UTC(date.year, date.month - 1, date.day, bestTime.hour, bestTime.minute, 0)
      if (excludedMs.some((instant) => Math.abs(instant - startMs) <= toleranceMs)) continue
    }

    const key = `${startLocal}|${endLocal}`
    if (seen.has(key)) continue
    seen.add(key)

    candidates.push({
      startLocal,
      endLocal,
      year: date.year,
      month: date.month,
      day: date.day,
      hour: bestTime.hour,
      minute: bestTime.minute,
      durationMinutes,
      endSource,
      dateText: date.text.trim(),
      timeText: bestTime.text.trim(),
      index: Math.min(date.start, bestTime.start),
      dayFirstAssumed: date.dayFirstAssumed,
      yearAssumed: date.yearAssumed,
    })
  }

  return candidates.sort((a, b) => a.index - b.index)
}

/** True only when the text contains at least one date paired with a clock time. */
export function hasDateWithTime(rawText: string, options: DetectDateTimeOptions = {}): boolean {
  return detectDateTimeCandidates(rawText, options).length > 0
}

/** Converts a detected local wall-clock string into a UTC ISO string using a fixed offset. */
export function detectedLocalToIso(local: string, offsetHours: number): string | null {
  const match = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
  if (!match) return null
  const utcMs = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    0,
  )
  return new Date(utcMs - offsetHours * 3_600_000).toISOString()
}
