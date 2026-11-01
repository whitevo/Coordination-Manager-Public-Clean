import { supabaseAdmin } from '../supabaseClient.js'
import { detectDateTimeCandidates, detectedLocalToIso } from './date-time-detection.js'

interface InvitationCandidate {
  userId: string
  messageId: string
  subject: string | null
  bodyText: string
  fromEmail: string | null
  receivedAt?: string | null
}

interface ParsedInvitation {
  uid: string
  recurrenceId: string | null
  method: string | null
  sequence: number | null
  summary: string | null
  location: string | null
  organizer: string | null
  attendeeEmails: string | null
  startsAt: string | null
  endsAt: string | null
  rawPayload: Record<string, unknown>
}

function parseIcsDateTime(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()

  if (/^\d{8}$/.test(trimmed)) {
    const year = Number(trimmed.slice(0, 4))
    const month = Number(trimmed.slice(4, 6))
    const day = Number(trimmed.slice(6, 8))
    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0)).toISOString()
  }

  if (/^\d{8}T\d{6}Z$/.test(trimmed)) {
    const year = Number(trimmed.slice(0, 4))
    const month = Number(trimmed.slice(4, 6))
    const day = Number(trimmed.slice(6, 8))
    const hour = Number(trimmed.slice(9, 11))
    const minute = Number(trimmed.slice(11, 13))
    const second = Number(trimmed.slice(13, 15))
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second)).toISOString()
  }

  if (/^\d{8}T\d{6}$/.test(trimmed)) {
    const year = Number(trimmed.slice(0, 4))
    const month = Number(trimmed.slice(4, 6))
    const day = Number(trimmed.slice(6, 8))
    const hour = Number(trimmed.slice(9, 11))
    const minute = Number(trimmed.slice(11, 13))
    const second = Number(trimmed.slice(13, 15))
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second)).toISOString()
  }

  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

function parseIcsTzid(line: string): string | null {
  const header = line.split(':', 1)[0] || ''
  const match = header.match(/(?:^|;)TZID=([^;:]+)/i)
  if (!match?.[1]) return null
  const tzid = match[1].trim()
  return tzid || null
}

function convertLocalTimeToUtcIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): string | null {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })

    // Iterate to solve UTC instant where formatted local parts equal target parts.
    let utcMs = Date.UTC(year, month, day, hour, minute, second)
    const targetMs = Date.UTC(year, month, day, hour, minute, second)

    for (let i = 0; i < 4; i += 1) {
      const parts = formatter.formatToParts(new Date(utcMs))
      const getPart = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || '0')
      const zonedYear = getPart('year')
      const zonedMonth = getPart('month') - 1
      const zonedDay = getPart('day')
      const zonedHour = getPart('hour')
      const zonedMinute = getPart('minute')
      const zonedSecond = getPart('second')
      const zonedMs = Date.UTC(zonedYear, zonedMonth, zonedDay, zonedHour, zonedMinute, zonedSecond)
      const diffMs = zonedMs - targetMs
      if (diffMs === 0) break
      utcMs -= diffMs
    }

    return new Date(utcMs).toISOString()
  } catch {
    return null
  }
}

function parseIcsDateTimeWithTzid(value: string | null, tzid: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()

  if (tzid && /^\d{8}T\d{6}$/.test(trimmed)) {
    const year = Number(trimmed.slice(0, 4))
    const month = Number(trimmed.slice(4, 6)) - 1
    const day = Number(trimmed.slice(6, 8))
    const hour = Number(trimmed.slice(9, 11))
    const minute = Number(trimmed.slice(11, 13))
    const second = Number(trimmed.slice(13, 15))
    const converted = convertLocalTimeToUtcIso(year, month, day, hour, minute, second, tzid)
    if (converted) return converted
  }

  return parseIcsDateTime(trimmed)
}

function getPropertyValue(line: string): string {
  const colonIdx = line.indexOf(':')
  if (colonIdx < 0) return ''
  return line.slice(colonIdx + 1).trim()
}

function parseOrganizer(value: string): string | null {
  const match = value.match(/mailto:([^\s>]+)/i)
  if (match?.[1]) return match[1].trim().toLowerCase()
  const normalized = value.replace(/^MAILTO:/i, '').trim().toLowerCase()
  return normalized || null
}

function parseAttendee(line: string): string | null {
  const value = getPropertyValue(line)
  const match = value.match(/mailto:([^\s>]+)/i)
  if (match?.[1]) return match[1].trim().toLowerCase()
  const normalized = value.replace(/^MAILTO:/i, '').trim().toLowerCase()
  return normalized || null
}

function monthNameToIndex(value: string): number | null {
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  const normalized = value.trim().slice(0, 3).toLowerCase()
  const index = months.indexOf(normalized)
  return index >= 0 ? index : null
}

function parseTimezoneOffsetHours(value: string): number | null {
  const normalized = value.trim().toUpperCase()
  const explicitOffset = normalized.match(/(?:UTC|GMT)\s*([+-]\d{1,2})(?::?(\d{2}))?/)
  if (explicitOffset?.[1]) {
    const hours = Number(explicitOffset[1])
    const minutes = explicitOffset[2] ? Number(explicitOffset[2]) : 0
    if (Number.isFinite(hours) && Number.isFinite(minutes)) {
      return hours + (hours >= 0 ? minutes : -minutes) / 60
    }
  }

  const offsetTokens: Array<[string, number]> = [
    ['EASTERN EUROPEAN SUMMER TIME', 3],
    ['EASTERN EUROPEAN TIME', 2],
    ['EEST', 3],
    ['CEST', 2],
    ['WEST', 1],
    ['EET', 2],
    ['CET', 1],
    ['BST', 1],
    ['PDT', -7],
    ['MDT', -6],
    ['CDT', -5],
    ['EDT', -4],
    ['PST', -8],
    ['MST', -7],
    ['CST', -6],
    ['EST', -5],
    ['WET', 0],
    ['UTC', 0],
    ['GMT', 0],
  ]

  for (const [token, offset] of offsetTokens) {
    const tokenPattern = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'i')
    if (tokenPattern.test(normalized)) return offset
  }

  return null
}

function parseHumanReadableDateRange(bodyText: string): { startsAt: string | null; endsAt: string | null } {
  const patterns = [
    /(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\s+([a-z]{3,9})\s+(\d{1,2}),\s+(\d{4})[^\n\r]*?(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})(?:\s*\(([^)]+)\))?/i,
    /([a-z]{3,9})\s+(\d{1,2}),\s+(\d{4})[^\n\r]*?(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})(?:\s*\(([^)]+)\))?/i,
  ]

  for (const pattern of patterns) {
    const match = bodyText.match(pattern)
    if (!match) continue

    const monthIndex = monthNameToIndex(match[1])
    if (monthIndex === null) continue

    const year = Number(match[3])
    const day = Number(match[2])
    const startHour = Number(match[4])
    const startMinute = Number(match[5])
    const endHour = Number(match[6])
    const endMinute = Number(match[7])
    const timezoneText = match[8] || ''
    const offsetHours = parseTimezoneOffsetHours(timezoneText) ?? 0

    return {
      startsAt: new Date(Date.UTC(year, monthIndex, day, startHour - offsetHours, startMinute, 0)).toISOString(),
      endsAt: new Date(Date.UTC(year, monthIndex, day, endHour - offsetHours, endMinute, 0)).toISOString(),
    }
  }

  return { startsAt: null, endsAt: null }
}

function extractInvitationSummary(bodyText: string, subject: string | null): string | null {
  const cleanSubject = (subject || '').trim()
  if (cleanSubject) {
    const withoutPrefix = cleanSubject
      .replace(/^updated invitation from an unknown sender:\s*/i, '')
      .replace(/^updated invitation:\s*/i, '')
      .replace(/^invitation:\s*/i, '')
      .trim()

    const splitAtDate = withoutPrefix.split(/\s+@\s+/i)[0]?.trim()
    if (splitAtDate) return splitAtDate
  }

  const bodyTitle = bodyText.match(/(?:summary|subject|title)\s*[:-]\s*(.+)$/im)
  if (bodyTitle?.[1]) return bodyTitle[1].trim()

  return null
}

function extractInvitationLocation(bodyText: string): string | null {
  const labelMatch = bodyText.match(/(?:^|\n)\s*location\s*[:-]?\s*(.+)$/im)
  if (labelMatch?.[1]) {
    const value = labelMatch[1].trim()
    if (value) return value.split(/\s*\n/)[0].trim()
  }

  const urlMatch = bodyText.match(/https?:\/\/[^\s<>()\]]+/i)
  return urlMatch?.[0] || null
}

function parseHumanReadableInvitation(bodyText: string, subject: string | null, fromEmail: string | null): ParsedInvitation | null {
  const sourceText = [subject, bodyText]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n')
  const lowered = sourceText.toLowerCase()
  const looksLikeInvite =
    lowered.includes('when') ||
    lowered.includes('location') ||
    lowered.includes('organizer') ||
    lowered.includes('guests') ||
    lowered.includes('this event has been updated') ||
    lowered.includes('this event has been cancelled') ||
    lowered.includes('view map') ||
    lowered.includes('google calendar')

  if (!looksLikeInvite) return null

  const dateRange = parseHumanReadableDateRange(sourceText)
  if (!dateRange.startsAt || !dateRange.endsAt) return null

  const summary = extractInvitationSummary(bodyText, subject) || subject?.trim() || 'Calendar invitation'
  const location = extractInvitationLocation(sourceText)

  return {
    uid: `${fromEmail || 'mailbox'}:${subject || summary}:${dateRange.startsAt}`,
    recurrenceId: null,
    method: null,
    sequence: null,
    summary,
    location,
    organizer: fromEmail,
    attendeeEmails: null,
    startsAt: dateRange.startsAt,
    endsAt: dateRange.endsAt,
    rawPayload: {
      summary,
      location,
      organizer: fromEmail,
      starts_at: dateRange.startsAt,
      ends_at: dateRange.endsAt,
      source: 'human-readable-invite',
    },
  }
}

/**
 * Fallback for booking confirmations that are not calendar invites: only fires when
 * the text contains a date paired with a clock time.
 */
function parseDetectedAppointment(
  bodyText: string,
  subject: string | null,
  fromEmail: string | null,
  receivedAt?: string | null,
): ParsedInvitation | null {
  const sourceText = [subject, bodyText]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n')

  const candidates = detectDateTimeCandidates(sourceText, {
    excludeInstants: receivedAt ? [receivedAt] : [],
  })
  if (candidates.length === 0) return null

  const offsetHours = parseTimezoneOffsetHours(sourceText) ?? 0
  const candidate = candidates[0]
  const startsAt = detectedLocalToIso(candidate.startLocal, offsetHours)
  const endsAt = detectedLocalToIso(candidate.endLocal, offsetHours)
  if (!startsAt || !endsAt) return null

  const summary = extractInvitationSummary(bodyText, subject) || subject?.trim() || 'Detected appointment'
  const location = extractInvitationLocation(sourceText)

  return {
    uid: `${fromEmail || 'mailbox'}:${subject || summary}:${startsAt}`,
    recurrenceId: null,
    method: null,
    sequence: null,
    summary,
    location,
    organizer: fromEmail,
    attendeeEmails: null,
    startsAt,
    endsAt,
    rawPayload: {
      summary,
      location,
      organizer: fromEmail,
      starts_at: startsAt,
      ends_at: endsAt,
      detected_date_text: candidate.dateText,
      detected_time_text: candidate.timeText,
      detected_end_source: candidate.endSource,
      detected_matches: candidates.length,
      source: 'detected-date-time',
    },
  }
}

function parseSingleInvitationBlock(bodyText: string): ParsedInvitation | null {
  if (!bodyText.includes('BEGIN:VCALENDAR') || !bodyText.includes('BEGIN:VEVENT')) {
    return null
  }

  const lines = bodyText.replace(/\r\n/g, '\n').split('\n')
  const unfolded: string[] = []
  for (const line of lines) {
    if (line.startsWith(' ') || line.startsWith('\t')) {
      if (unfolded.length > 0) unfolded[unfolded.length - 1] += line.trimStart()
    } else {
      unfolded.push(line)
    }
  }

  let method: string | null = null
  let uid: string | null = null
  let recurrenceId: string | null = null
  let sequence: number | null = null
  let summary: string | null = null
  let location: string | null = null
  let organizer: string | null = null
  const attendees = new Set<string>()
  let startsAt: string | null = null
  let endsAt: string | null = null

  for (const line of unfolded) {
    if (line.startsWith('METHOD')) method = getPropertyValue(line) || null
    if (line.startsWith('UID')) uid = getPropertyValue(line) || null
    if (line.startsWith('RECURRENCE-ID')) recurrenceId = getPropertyValue(line) || null
    if (line.startsWith('SEQUENCE')) {
      const raw = Number(getPropertyValue(line))
      sequence = Number.isFinite(raw) ? raw : null
    }
    if (line.startsWith('SUMMARY')) summary = getPropertyValue(line) || null
    if (line.startsWith('LOCATION')) location = getPropertyValue(line) || null
    if (line.startsWith('ORGANIZER')) organizer = parseOrganizer(getPropertyValue(line))

    if (line.startsWith('ATTENDEE')) {
      const email = parseAttendee(line)
      if (email) attendees.add(email)
    }

    if (line.startsWith('DTSTART')) startsAt = parseIcsDateTimeWithTzid(getPropertyValue(line), parseIcsTzid(line))
    if (line.startsWith('DTEND')) endsAt = parseIcsDateTimeWithTzid(getPropertyValue(line), parseIcsTzid(line))
  }

  if (!uid) return null

  return {
    uid,
    recurrenceId,
    method,
    sequence,
    summary,
    location,
    organizer,
    attendeeEmails: attendees.size > 0 ? Array.from(attendees).join(',') : null,
    startsAt,
    endsAt,
    rawPayload: {
      uid,
      recurrence_id: recurrenceId,
      method,
      sequence,
      summary,
      location,
      organizer,
      attendee_emails: attendees.size > 0 ? Array.from(attendees) : [],
      starts_at: startsAt,
      ends_at: endsAt,
    },
  }
}

async function loadNonOrganizerSenders(userId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('mail_user_preferences')
    .select('non_organizer_senders')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) return []
  const raw = (data as { non_organizer_senders?: unknown } | null)?.non_organizer_senders
  if (!Array.isArray(raw)) return []

  return raw
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0)
}

export function isNonOrganizerSender(fromEmail: string | null, entries: string[]): boolean {
  if (!fromEmail || entries.length === 0) return false
  const normalized = fromEmail.trim().toLowerCase()
  if (!normalized) return false

  const domain = normalized.includes('@') ? normalized.slice(normalized.lastIndexOf('@') + 1) : normalized
  return entries.some((entry) => entry === normalized || entry === domain)
}

async function upsertInvitationFromCandidate(candidate: InvitationCandidate): Promise<boolean> {
  const parsed =
    parseSingleInvitationBlock(candidate.bodyText) ||
    parseHumanReadableInvitation(candidate.bodyText, candidate.subject, candidate.fromEmail) ||
    parseDetectedAppointment(candidate.bodyText, candidate.subject, candidate.fromEmail, candidate.receivedAt)
  if (!parsed) return false

  let existingQuery = supabaseAdmin
    .from('mail_invitations')
    .select('id, sequence')
    .eq('user_id', candidate.userId)
    .eq('uid', parsed.uid)

  if (parsed.recurrenceId) {
    existingQuery = existingQuery.eq('recurrence_id', parsed.recurrenceId)
  } else {
    existingQuery = existingQuery.is('recurrence_id', null)
  }

  const { data: existing, error: lookupError } = await existingQuery.maybeSingle()
  if (lookupError) throw lookupError

  const nowIso = new Date().toISOString()

  if (existing) {
    const existingSequence = typeof existing.sequence === 'number' ? existing.sequence : null
    const incomingSequence = parsed.sequence

    const shouldUpdate =
      incomingSequence === null ||
      existingSequence === null ||
      incomingSequence >= existingSequence

    if (!shouldUpdate) return false

    const { error: updateError } = await supabaseAdmin
      .from('mail_invitations')
      .update({
        message_id: candidate.messageId,
        method: parsed.method,
        sequence: parsed.sequence,
        organizer: parsed.organizer || candidate.fromEmail,
        attendee_emails: parsed.attendeeEmails,
        starts_at: parsed.startsAt,
        ends_at: parsed.endsAt,
        summary: parsed.summary,
        location: parsed.location,
        status: 'proposed',
        raw_payload: parsed.rawPayload,
        updated_at: nowIso,
      })
      .eq('id', existing.id)

    if (updateError) throw updateError
    return true
  }

  const { error: insertError } = await supabaseAdmin
    .from('mail_invitations')
    .insert({
      user_id: candidate.userId,
      message_id: candidate.messageId,
      method: parsed.method,
      uid: parsed.uid,
      sequence: parsed.sequence,
      recurrence_id: parsed.recurrenceId,
      organizer: parsed.organizer || candidate.fromEmail,
      attendee_emails: parsed.attendeeEmails,
      starts_at: parsed.startsAt,
      ends_at: parsed.endsAt,
      summary: parsed.summary,
      location: parsed.location,
      status: 'proposed',
      raw_payload: parsed.rawPayload,
      created_at: nowIso,
      updated_at: nowIso,
    })

  if (insertError) throw insertError
  return true
}

/**
 * Drops previously detected appointments whose source message no longer yields one,
 * so tightened detection rules also clean up rows created by earlier scans.
 */
async function removeStaleDetectedInvitations(userId: string, messageIds: string[]): Promise<number> {
  if (messageIds.length === 0) return 0

  let removed = 0
  const chunkSize = 100

  for (let index = 0; index < messageIds.length; index += chunkSize) {
    const chunk = messageIds.slice(index, index + chunkSize)
    const { data, error } = await supabaseAdmin
      .from('mail_invitations')
      .delete()
      .eq('user_id', userId)
      .in('message_id', chunk)
      .eq('raw_payload->>source', 'detected-date-time')
      .select('id')

    if (error) throw error
    removed += data?.length || 0
  }

  return removed
}

export async function extractInvitationsForAccount(
  accountId: string,
  userId: string,
  newProviderMessageIds?: string[],
  retrySince?: string,
): Promise<{ parsed: number; insertedOrUpdated: number; removed: number }> {
  if (newProviderMessageIds?.length === 0 && !retrySince) {
    return { parsed: 0, insertedOrUpdated: 0, removed: 0 }
  }
  const nonOrganizers = await loadNonOrganizerSenders(userId)

  const messageQuery = () => supabaseAdmin
    .from('mail_messages')
    .select('id, subject, body_text, body_html_sanitized, calendar_raw_text, from_email, received_at, mail_accounts!inner(user_id)')
    .eq('account_id', accountId)
    .eq('mail_accounts.user_id', userId)
  type InvitationMessage = {
    id: string
    subject: string | null
    body_text: string | null
    body_html_sanitized: string | null
    calendar_raw_text: string | null
    from_email: string | null
    received_at: string | null
  }
  const messages: InvitationMessage[] = []
  if (newProviderMessageIds) {
    const ids = [...new Set(newProviderMessageIds)]
    for (let offset = 0; offset < ids.length; offset += 200) {
      const { data, error } = await messageQuery()
        .in('provider_message_id', ids.slice(offset, offset + 200))
        .order('received_at', { ascending: false })
      if (error) throw error
      messages.push(...(data || []))
    }
    if (retrySince) {
      if (!Number.isFinite(Date.parse(retrySince))) {
        throw new Error('Invalid invitation retry timestamp')
      }
      let offset = 0
      while (true) {
        const { data, error } = await messageQuery()
          .gte('created_at', retrySince)
          .order('id', { ascending: true })
          .range(offset, offset + 199)
        if (error) throw error
        if (!data?.length) break
        messages.push(...data)
        offset += data.length
      }
    }
  } else {
    const { data, error } = await messageQuery()
      .order('received_at', { ascending: false })
      .limit(250)
    if (error) throw error
    messages.push(...(data || []))
  }

  let insertedOrUpdated = 0
  const staleMessageIds: string[] = []

  const uniqueMessages = [...new Map(messages.map(message => [message.id, message])).values()]
  for (const message of uniqueMessages) {
    if (isNonOrganizerSender(message.from_email, nonOrganizers)) {
      staleMessageIds.push(message.id)
      continue
    }

    const bodyText = typeof message.body_text === 'string' ? message.body_text : ''
    const bodyHtml = typeof message.body_html_sanitized === 'string' ? message.body_html_sanitized : ''
    // Scan the raw ICS text first: it is the authoritative source when a formal
    // calendar invite arrived as a MIME text/calendar part or .ics attachment
    // rather than being inlined into the visible message body.
    const calendarRawText = typeof message.calendar_raw_text === 'string' ? message.calendar_raw_text : ''
    const scanText = `${calendarRawText}\n${bodyText}\n${bodyHtml}`.trim()
    if (!scanText) {
      staleMessageIds.push(message.id)
      continue
    }

    const changed = await upsertInvitationFromCandidate({
      userId,
      messageId: message.id,
      subject: typeof message.subject === 'string' ? message.subject : null,
      bodyText: scanText,
      fromEmail: message.from_email,
      receivedAt: typeof message.received_at === 'string' ? message.received_at : null,
    })

    if (changed) insertedOrUpdated++
    else staleMessageIds.push(message.id)
  }

  const removed = await removeStaleDetectedInvitations(userId, staleMessageIds)

  return {
    parsed: uniqueMessages.length,
    insertedOrUpdated,
    removed,
  }
}

export const __testUtils = {
  parseHumanReadableInvitation,
  parseSingleInvitationBlock,
  parseDetectedAppointment,
}
