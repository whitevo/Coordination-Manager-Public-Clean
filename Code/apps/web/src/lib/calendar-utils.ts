/**
 * Utility functions for calendar operations:
 * - .ics file generation and download
 * - Google Calendar add-event helpers
 * - Outlook Calendar deeplink helpers
 * - Safe URL validation for user-provided links
 */

/** Returns true if the URL uses a safe scheme (http or https). Rejects javascript:, data:, etc. */
export function isSafeUrl(url: string | null | undefined): boolean {
  if (!url) return false
  return /^https?:\/\//i.test(url.trim())
}

interface CalendarEvent {
  title: string
  description?: string | null
  start_time: string  // ISO 8601
  end_time: string    // ISO 8601
  meeting_link?: string | null
  location?: string | null
}

interface MeetingTitleOptions {
  title?: string | null
  calendarTitle?: string | null
  fallbackTitle?: string
}

export function resolveMeetingTitle({
  title,
  calendarTitle,
  fallbackTitle = 'Meeting',
}: MeetingTitleOptions): string {
  const trimmedTitle = title?.trim()
  if (trimmedTitle) return trimmedTitle

  const trimmedCalendarTitle = calendarTitle?.trim()
  if (trimmedCalendarTitle) return trimmedCalendarTitle

  return fallbackTitle
}

/** Convert ISO date string to iCal DTSTART/DTEND format (UTC) */
function toICalDate(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

/** Generate a simple UID for the VEVENT */
function generateUID(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  let uid = ''
  for (let i = 0; i < 24; i++) {
    uid += chars[bytes[i] % chars.length]
  }
  return `${uid}@coordination-manager`
}

/** Fold long lines per RFC 5545 (max 75 octets per line) */
function foldLine(line: string): string {
  const maxLen = 75
  if (line.length <= maxLen) return line
  const parts: string[] = []
  parts.push(line.slice(0, maxLen))
  let pos = maxLen
  while (pos < line.length) {
    parts.push(' ' + line.slice(pos, pos + maxLen - 1))
    pos += maxLen - 1
  }
  return parts.join('\r\n')
}

/** Escape text for iCal property values */
function escapeICalText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '')
}

/**
 * Generate .ics file content for a single event.
 */
export function generateICSContent(event: CalendarEvent): string {
  const now = toICalDate(new Date().toISOString())
  const uid = generateUID()

  const descParts: string[] = []
  if (event.description) descParts.push(event.description)
  if (event.meeting_link) descParts.push(`Meeting link: ${event.meeting_link}`)
  const fullDesc = descParts.join('\n\n')

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Coordination Manager//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    foldLine(`UID:${uid}`),
    foldLine(`DTSTAMP:${now}`),
    foldLine(`DTSTART:${toICalDate(event.start_time)}`),
    foldLine(`DTEND:${toICalDate(event.end_time)}`),
    foldLine(`SUMMARY:${escapeICalText(event.title)}`),
  ]

  if (fullDesc) {
    lines.push(foldLine(`DESCRIPTION:${escapeICalText(fullDesc)}`))
  }
  if (event.location) {
    lines.push(foldLine(`LOCATION:${escapeICalText(event.location)}`))
  } else if (event.meeting_link) {
    lines.push(foldLine(`LOCATION:${escapeICalText(event.meeting_link)}`))
  }
  if (event.meeting_link) {
    lines.push(foldLine(`URL:${event.meeting_link}`))
  }

  // Outlook-compatible properties
  lines.push('TRANSP:OPAQUE')
  lines.push('STATUS:CONFIRMED')
  lines.push('X-MICROSOFT-CDO-BUSYSTATUS:BUSY')
  lines.push('X-MICROSOFT-CDO-INSTTYPE:0')

  lines.push('END:VEVENT', 'END:VCALENDAR')

  return lines.join('\r\n')
}

/**
 * Download a .ics file for a calendar event.
 * Works for all users (no auth required).
 */
export function downloadICSFile(event: CalendarEvent): void {
  const content = generateICSContent(event)
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const sanitizedTitle = event.title
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 50)

  const link = document.createElement('a')
  link.href = url
  link.download = `${sanitizedTitle || 'event'}.ics`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Build Outlook Web Calendar deeplink URL.
 * Opens outlook.live.com compose dialog -- no file download needed.
 */
export function buildOutlookCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    rru: 'addevent',
    subject: event.title,
    startdt: new Date(event.start_time).toISOString(),
    enddt: new Date(event.end_time).toISOString(),
    allday: 'false',
    path: '/calendar/action/compose',
  })

  const descParts: string[] = []
  if (event.description) descParts.push(event.description)
  if (event.meeting_link) descParts.push(`Meeting link: ${event.meeting_link}`)
  if (descParts.length > 0) {
    params.set('body', descParts.join('\n\n'))
  }
  if (event.location) {
    params.set('location', event.location)
  } else if (event.meeting_link) {
    params.set('location', event.meeting_link)
  }

  return `https://outlook.live.com/calendar/0/action/compose?${params.toString()}`
}
