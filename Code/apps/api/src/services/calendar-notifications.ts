/**
 * Coordination Calendar participation change notifications.
 *
 * When someone other than the organiser adds, changes, or removes their
 * participation, the change is classified by urgency and queued in
 * `calendar_change_events`. A background dispatcher flushes the queue and
 * sends one aggregated email per recipient covering every calendar with
 * pending changes.
 *
 * Tiers (based on the earliest affected slot that is not in the past):
 *   - ignore: every affected slot is older than now - 1 hour
 *   - urgent: earliest slot is within now - 1 hour .. now + 1 hour -> sent after 2 minutes
 *   - normal: anything later -> sent after 15 minutes
 * The first pending event for a recipient sets the deadline; later events join
 * the same email. An urgent event pulls pending normal events along with it.
 */
import { supabaseAdmin } from '../supabaseClient.js'
import { sendEmail, type EmailSendResult } from './email.js'

export type NotificationTier = 'ignore' | 'urgent' | 'normal'
export type ChangeType = 'added' | 'changed' | 'removed'

export const URGENT_WINDOW_MS = 60 * 60 * 1000
export const URGENT_DELAY_MS = 2 * 60 * 1000
export const NORMAL_DELAY_MS = 15 * 60 * 1000
export const MAX_SEND_ATTEMPTS = 5
const RETRY_BACKOFF_MS = 5 * 60 * 1000
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const PENDING_BATCH_LIMIT = 2000
const EMAIL_MAX_LENGTH = 320
const NAME_MAX_LENGTH = 200

const SLOT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})_([01]\d|2[0-3]):([0-5]\d)$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── Pure helpers ────────────────────────────────────────────────────────────

/** Parse a `YYYY-MM-DD_HH:MM` cell id (UTC) into epoch ms. */
export function parseSlotMs(slot: string): number | null {
  const match = SLOT_PATTERN.exec(slot)
  if (!match) return null
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]))
  return Number.isNaN(ms) ? null : ms
}

/**
 * Time of the slot that matters for urgency. Any Week calendars store
 * participation on one canonical week, so the slot is projected onto its next
 * weekly occurrence at or after now - 1 hour.
 */
export function resolveSlotOccurrenceMs(slot: string, nowMs: number, anyWeek: boolean): number | null {
  const ms = parseSlotMs(slot)
  if (ms === null || !anyWeek) return ms
  const floor = nowMs - URGENT_WINDOW_MS
  if (ms >= floor) return ms
  const weeksBehind = Math.ceil((floor - ms) / WEEK_MS)
  return ms + weeksBehind * WEEK_MS
}

export function classifyChange(
  changedSlots: string[],
  nowMs: number,
  anyWeek = false,
): { tier: NotificationTier; earliestSlotMs: number | null } {
  const floor = nowMs - URGENT_WINDOW_MS
  let earliest: number | null = null
  for (const slot of changedSlots) {
    const ms = resolveSlotOccurrenceMs(slot, nowMs, anyWeek)
    if (ms === null || ms < floor) continue
    if (earliest === null || ms < earliest) earliest = ms
  }
  if (earliest === null) return { tier: 'ignore', earliestSlotMs: null }
  if (earliest <= nowMs + URGENT_WINDOW_MS) return { tier: 'urgent', earliestSlotMs: earliest }
  return { tier: 'normal', earliestSlotMs: earliest }
}

export interface ParticipationDiff {
  changeType: ChangeType
  existedBefore: boolean
  existsAfter: boolean
  changedSlots: string[]
}

/** Compare a participant's slots before and after a write. Null = no change. */
export function diffParticipation(before: readonly string[] | null | undefined, after: readonly string[] | null | undefined): ParticipationDiff | null {
  const beforeSet = new Set(before ?? [])
  const afterSet = new Set(after ?? [])
  const existedBefore = beforeSet.size > 0
  const existsAfter = afterSet.size > 0
  const changedSlots: string[] = []
  for (const slot of beforeSet) if (!afterSet.has(slot)) changedSlots.push(slot)
  for (const slot of afterSet) if (!beforeSet.has(slot)) changedSlots.push(slot)
  if (changedSlots.length === 0) return null
  const changeType: ChangeType = !existedBefore ? 'added' : existsAfter ? 'changed' : 'removed'
  return { changeType, existedBefore, existsAfter, changedSlots }
}

/** Net change for a participant across several queued events (ordered oldest first). */
export function netChangeType(events: ReadonlyArray<{ existed_before: boolean; exists_after: boolean }>): ChangeType | null {
  if (events.length === 0) return null
  const existed = events[0].existed_before
  const exists = events[events.length - 1].exists_after
  if (!existed && exists) return 'added'
  if (existed && exists) return 'changed'
  if (existed && !exists) return 'removed'
  return null
}

export function normalizeNotificationEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  if (!trimmed || trimmed.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(trimmed)) return null
  // Traveler accounts get a placeholder address that can never receive mail.
  if (trimmed.endsWith('.local')) return null
  return trimmed
}

function cleanText(value: string, max: number): string {
  let out = ''
  for (const ch of value) {
    const code = ch.charCodeAt(0)
    out += code < 0x20 || code === 0x7f ? ' ' : ch
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, max)
}

// ── Organiser and settings resolution ───────────────────────────────────────

export interface CalendarRef {
  id: string
  created_by: string | null
  config?: Record<string, unknown> | null
}

export interface Actor {
  userId?: string | null
  email?: string | null
}

interface Organiser {
  userId: string | null
  email: string | null
}

export async function resolveOrganiser(createdBy: string | null | undefined): Promise<Organiser> {
  const value = (createdBy || '').trim()
  if (!value) return { userId: null, email: null }
  if (UUID_PATTERN.test(value)) {
    const { data } = await supabaseAdmin.from('users').select('id, email').eq('id', value).maybeSingle()
    return { userId: value, email: normalizeNotificationEmail(data?.email) }
  }
  if (value.includes('@')) {
    const { data } = await supabaseAdmin.from('users').select('id, email').eq('email', value).maybeSingle()
    return { userId: data?.id ?? null, email: normalizeNotificationEmail(value) }
  }
  return { userId: null, email: null }
}

export function isOrganiserActor(createdBy: string | null | undefined, organiser: Organiser, actor: Actor): boolean {
  const actorId = actor.userId || null
  const actorEmail = actor.email ? actor.email.toLowerCase() : null
  const created = (createdBy || '').toLowerCase()
  if (!actorId && !actorEmail) return false
  if (actorId && (actorId.toLowerCase() === created || actorId === organiser.userId)) return true
  if (actorEmail && (actorEmail === created || actorEmail === organiser.email)) return true
  return false
}

export interface NotificationSettings {
  enabled: boolean
  email: string | null
  notify_from: string | null
}

export async function getNotificationSettings(calendarId: string): Promise<NotificationSettings> {
  const { data } = await supabaseAdmin
    .from('calendar_notification_settings')
    .select('enabled, email, notify_from')
    .eq('calendar_id', calendarId)
    .maybeSingle()
  return {
    enabled: data?.enabled !== false,
    email: data?.email ?? null,
    notify_from: data?.notify_from ?? null,
  }
}

// ── Enqueue ─────────────────────────────────────────────────────────────────

export type EnqueueResult =
  | { queued: true; tier: 'urgent' | 'normal'; recipient: string; dueAt: string }
  | { queued: false; reason: 'no_change' | 'disabled' | 'before_notify_from' | 'ignored_past' | 'own_edit' | 'no_recipient' | 'error' }

export interface ParticipationChangeInput {
  calendar: CalendarRef
  participantName: string
  before: readonly string[] | null | undefined
  after: readonly string[] | null | undefined
  actor: Actor
  now?: Date
}

export async function enqueueParticipationChange(input: ParticipationChangeInput): Promise<EnqueueResult> {
  const now = input.now ?? new Date()
  const nowMs = now.getTime()
  const diff = diffParticipation(input.before, input.after)
  if (!diff) return { queued: false, reason: 'no_change' }

  const settings = await getNotificationSettings(input.calendar.id)
  if (!settings.enabled) return { queued: false, reason: 'disabled' }
  if (settings.notify_from) {
    const fromMs = new Date(settings.notify_from).getTime()
    if (Number.isFinite(fromMs) && nowMs < fromMs) return { queued: false, reason: 'before_notify_from' }
  }

  const anyWeek = input.calendar.config?.hideDateNumbers === true
  const { tier, earliestSlotMs } = classifyChange(diff.changedSlots, nowMs, anyWeek)
  if (tier === 'ignore') return { queued: false, reason: 'ignored_past' }

  const organiser = await resolveOrganiser(input.calendar.created_by)
  if (isOrganiserActor(input.calendar.created_by, organiser, input.actor)) {
    return { queued: false, reason: 'own_edit' }
  }

  const recipient = normalizeNotificationEmail(settings.email) ?? organiser.email
  if (!recipient) return { queued: false, reason: 'no_recipient' }

  const dueAt = new Date(nowMs + (tier === 'urgent' ? URGENT_DELAY_MS : NORMAL_DELAY_MS)).toISOString()
  const { error } = await supabaseAdmin.from('calendar_change_events').insert({
    calendar_id: input.calendar.id,
    recipient_email: recipient,
    participant_name: cleanText(input.participantName, NAME_MAX_LENGTH) || 'Unnamed participant',
    change_type: diff.changeType,
    existed_before: diff.existedBefore,
    exists_after: diff.existsAfter,
    tier,
    earliest_slot_at: earliestSlotMs === null ? null : new Date(earliestSlotMs).toISOString(),
    due_at: dueAt,
    created_at: now.toISOString(),
  })
  if (error) return { queued: false, reason: 'error' }
  return { queued: true, tier, recipient, dueAt }
}

/** Fire-and-forget wrapper for route handlers: never throws, never blocks the response. */
export function notifyParticipationChange(input: ParticipationChangeInput): void {
  void enqueueParticipationChange(input).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error(`[calendar-notifications] enqueue failed: ${message.replace(/[\r\n]+/g, ' ')}`)
  })
}

// ── Email composition ───────────────────────────────────────────────────────

export interface CalendarDigest {
  calendarId: string
  title: string
  link: string
  participantCount: number
  added: string[]
  changed: string[]
  removed: string[]
}

function formatNames(names: string[]): string {
  return names.length ? names.join(', ') : '-'
}

export function buildDigestEmail(digests: CalendarDigest[]): { subject: string; text: string } {
  const subject = digests.length === 1
    ? `Participation update: ${digests[0].title}`
    : `Participation updates in ${digests.length} Coordination Calendars`

  const lines: string[] = [
    'Hi,',
    '',
    digests.length === 1
      ? 'Participation changed in one of your Coordination Calendars.'
      : `Participation changed in ${digests.length} of your Coordination Calendars.`,
  ]
  for (const digest of digests) {
    lines.push(
      '',
      `== ${digest.title} ==`,
      `Link: ${digest.link}`,
      `Total participants: ${digest.participantCount}`,
    )
    if (digest.added.length) lines.push(`Added (${digest.added.length}): ${formatNames(digest.added)}`)
    if (digest.changed.length) lines.push(`Changed (${digest.changed.length}): ${formatNames(digest.changed)}`)
    if (digest.removed.length) lines.push(`Removed (${digest.removed.length}): ${formatNames(digest.removed)}`)
  }
  lines.push(
    '',
    'You get this email because change notifications are on for these calendars.',
    'To change the notification email or turn it off, open the calendar, choose Edit,',
    'and open "Community Links and Resources".',
    '',
    '-- Coordination Manager',
  )
  return { subject, text: lines.join('\n') }
}

// ── Flush ───────────────────────────────────────────────────────────────────

interface QueuedEvent {
  id: string
  calendar_id: string
  recipient_email: string
  participant_name: string
  existed_before: boolean
  exists_after: boolean
  due_at: string
  attempts: number
  created_at: string
}

export interface FlushSummary {
  recipients: number
  emailsSent: number
  emailsFailed: number
  eventsProcessed: number
}

type EmailSender = (to: string, subject: string, text: string) => Promise<EmailSendResult>

function frontendBase(): string {
  return (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim().replace(/\/+$/, '')
}

async function buildDigests(events: QueuedEvent[]): Promise<CalendarDigest[]> {
  const calendarIds = [...new Set(events.map(e => e.calendar_id))]
  const [{ data: calendars }, { data: participants }] = await Promise.all([
    supabaseAdmin.from('calendars').select('id, hash, title').in('id', calendarIds),
    supabaseAdmin.from('availability').select('calendar_id').in('calendar_id', calendarIds),
  ])

  const counts = new Map<string, number>()
  for (const row of (participants ?? []) as Array<{ calendar_id: string }>) {
    counts.set(row.calendar_id, (counts.get(row.calendar_id) ?? 0) + 1)
  }

  const base = frontendBase()
  const digests: CalendarDigest[] = []
  for (const calendar of (calendars ?? []) as Array<{ id: string; hash: string; title: string | null }>) {
    const byParticipant = new Map<string, QueuedEvent[]>()
    for (const event of events) {
      if (event.calendar_id !== calendar.id) continue
      const list = byParticipant.get(event.participant_name) ?? []
      list.push(event)
      byParticipant.set(event.participant_name, list)
    }
    const digest: CalendarDigest = {
      calendarId: calendar.id,
      title: cleanText(calendar.title || 'Untitled calendar', 200),
      link: `${base}/calendar/${encodeURIComponent(calendar.hash)}`,
      participantCount: counts.get(calendar.id) ?? 0,
      added: [],
      changed: [],
      removed: [],
    }
    for (const [name, list] of byParticipant) {
      list.sort((a, b) => a.created_at.localeCompare(b.created_at))
      const type = netChangeType(list)
      if (type) digest[type].push(name)
    }
    for (const key of ['added', 'changed', 'removed'] as const) digest[key].sort((a, b) => a.localeCompare(b))
    if (digest.added.length || digest.changed.length || digest.removed.length) digests.push(digest)
  }
  digests.sort((a, b) => a.title.localeCompare(b.title))
  return digests
}

/**
 * Send one aggregated email to every recipient whose earliest pending
 * deadline has passed. Safe to run from several API instances: events are
 * claimed by setting sent_at before sending and released on failure.
 */
export async function flushDueNotifications(
  now: Date = new Date(),
  sender: EmailSender = (to, subject, text) => sendEmail(to, subject, text),
): Promise<FlushSummary> {
  const summary: FlushSummary = { recipients: 0, emailsSent: 0, emailsFailed: 0, eventsProcessed: 0 }
  const nowIso = now.toISOString()

  const { data: pending, error } = await supabaseAdmin
    .from('calendar_change_events')
    .select('id, calendar_id, recipient_email, participant_name, existed_before, exists_after, due_at, attempts, created_at')
    .is('sent_at', null)
    .lt('attempts', MAX_SEND_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(PENDING_BATCH_LIMIT)
  if (error) throw new Error(error.message)

  const byRecipient = new Map<string, QueuedEvent[]>()
  for (const event of (pending ?? []) as QueuedEvent[]) {
    const list = byRecipient.get(event.recipient_email) ?? []
    list.push(event)
    byRecipient.set(event.recipient_email, list)
  }

  for (const [recipient, events] of byRecipient) {
    const earliestDue = events.reduce((min, e) => (e.due_at < min ? e.due_at : min), events[0].due_at)
    if (new Date(earliestDue).getTime() > now.getTime()) continue

    const { data: claimedRows, error: claimError } = await supabaseAdmin
      .from('calendar_change_events')
      .update({ sent_at: nowIso })
      .in('id', events.map(e => e.id))
      .is('sent_at', null)
      .select('id')
    if (claimError) continue
    const claimedIds = new Set(((claimedRows ?? []) as Array<{ id: string }>).map(r => r.id))
    const claimed = events.filter(e => claimedIds.has(e.id))
    if (claimed.length === 0) continue

    summary.recipients += 1
    summary.eventsProcessed += claimed.length

    let result: EmailSendResult
    try {
      const digests = await buildDigests(claimed)
      // Every change cancelled itself out (for example added then removed).
      if (digests.length === 0) continue
      const { subject, text } = buildDigestEmail(digests)
      result = await sender(recipient, subject, text)
    } catch (err: unknown) {
      result = { success: false, error: err instanceof Error ? err.message : 'digest failed' }
    }

    if (result.success) {
      summary.emailsSent += 1
      continue
    }

    summary.emailsFailed += 1
    const lastError = cleanText(result.error || 'send failed', 500)
    for (const event of claimed) {
      const attempts = event.attempts + 1
      await supabaseAdmin
        .from('calendar_change_events')
        .update({
          sent_at: null,
          attempts,
          last_error: lastError,
          due_at: new Date(now.getTime() + attempts * RETRY_BACKOFF_MS).toISOString(),
        })
        .eq('id', event.id)
    }
  }

  return summary
}
