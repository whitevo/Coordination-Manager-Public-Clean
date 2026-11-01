import { describe, it, expect, vi, beforeEach } from 'vitest'
import { db, resetDb } from './helpers/in-memory-supabase.js'

vi.mock('../../supabaseClient.js', async () => {
  const fake = await import('./helpers/in-memory-supabase.js')
  return { supabaseAdmin: fake.fakeSupabaseAdmin }
})

const mockSendEmail = vi.fn()
vi.mock('../email.js', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

const {
  classifyChange,
  diffParticipation,
  netChangeType,
  enqueueParticipationChange,
  flushDueNotifications,
  buildDigestEmail,
  normalizeNotificationEmail,
  URGENT_DELAY_MS,
  NORMAL_DELAY_MS,
} = await import('../calendar-notifications.js')

// ─── Fixtures ───────────────────────────────────────────────

const ORGANISER_ID = '11111111-1111-4111-8111-111111111111'
const ORGANISER_EMAIL = 'organiser@example.com'
const TEST_EMAIL = 'notify-inbox@example.com'
const PARTICIPANT = { userId: '22222222-2222-4222-8222-222222222222', email: 'guest@example.com' }

// Fixed clock: 2026-11-02 12:00 UTC
const NOW = new Date('2026-11-02T12:00:00.000Z')
const MIN = 60 * 1000

function slotAt(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}_${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
const PAST_SLOT = slotAt(NOW.getTime() - 3 * 60 * MIN)
const URGENT_SLOT = slotAt(NOW.getTime() + 30 * MIN)
const NORMAL_SLOT = slotAt(NOW.getTime() + 24 * 60 * MIN)
const NORMAL_SLOT_2 = slotAt(NOW.getTime() + 48 * 60 * MIN)

const CAL_ALPHA = { id: 'cal-alpha', created_by: ORGANISER_ID, config: {} }
const CAL_BETA = { id: 'cal-beta', created_by: ORGANISER_ID, config: {} }

function seed() {
  db.users = [{ id: ORGANISER_ID, email: ORGANISER_EMAIL }]
  db.calendars = [
    { id: CAL_ALPHA.id, hash: 'alpha12345', title: 'Alpha Planning' },
    { id: CAL_BETA.id, hash: 'beta123456', title: 'Beta Sync' },
  ]
  db.availability = []
  db.calendar_notification_settings = []
  db.calendar_change_events = []
}

function participants(calendarId: string, count: number) {
  for (let i = 0; i < count; i += 1) db.availability.push({ calendar_id: calendarId, username: `p${i}` })
}

function at(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs)
}

beforeEach(() => {
  resetDb()
  seed()
  mockSendEmail.mockReset()
  mockSendEmail.mockResolvedValue({ success: true, messageId: 'm1' })
})

// ─── Classification ─────────────────────────────────────────

describe('classifyChange - notification ranges', () => {
  const now = NOW.getTime()

  it('ignores changes where every slot is older than now - 1 hour', () => {
    expect(classifyChange([slotAt(now - 61 * MIN)], now).tier).toBe('ignore')
    expect(classifyChange([PAST_SLOT], now).tier).toBe('ignore')
  })

  it('treats slots within now - 1 hour .. now + 1 hour as urgent', () => {
    expect(classifyChange([slotAt(now - 59 * MIN)], now).tier).toBe('urgent')
    expect(classifyChange([slotAt(now)], now).tier).toBe('urgent')
    expect(classifyChange([slotAt(now + 60 * MIN)], now).tier).toBe('urgent')
  })

  it('treats slots later than now + 1 hour as normal', () => {
    expect(classifyChange([slotAt(now + 61 * MIN)], now).tier).toBe('normal')
    expect(classifyChange([NORMAL_SLOT], now).tier).toBe('normal')
  })

  it('uses the earliest non-past slot when a change spans several ranges', () => {
    const result = classifyChange([PAST_SLOT, NORMAL_SLOT, URGENT_SLOT], now)
    expect(result.tier).toBe('urgent')
    expect(result.earliestSlotMs).toBe(now + 30 * MIN)
    expect(classifyChange([PAST_SLOT, NORMAL_SLOT], now).tier).toBe('normal')
  })

  it('projects Any Week slots onto their next weekly occurrence', () => {
    // Canonical week far in the past, same weekday and time as now + 30 min.
    const canonical = slotAt(now + 30 * MIN - 52 * 7 * 24 * 60 * MIN)
    expect(classifyChange([canonical], now, false).tier).toBe('ignore')
    expect(classifyChange([canonical], now, true).tier).toBe('urgent')
    const canonicalLater = slotAt(now + 2 * 24 * 60 * MIN - 52 * 7 * 24 * 60 * MIN)
    expect(classifyChange([canonicalLater], now, true).tier).toBe('normal')
  })
})

describe('diffParticipation and netChangeType', () => {
  it('detects added, changed, removed and no-op', () => {
    expect(diffParticipation(null, [NORMAL_SLOT])?.changeType).toBe('added')
    expect(diffParticipation([NORMAL_SLOT], [NORMAL_SLOT, NORMAL_SLOT_2])?.changeType).toBe('changed')
    expect(diffParticipation([NORMAL_SLOT], [])?.changeType).toBe('removed')
    expect(diffParticipation([NORMAL_SLOT], [NORMAL_SLOT])).toBeNull()
  })

  it('collapses several queued events into one net change', () => {
    const added = { existed_before: false, exists_after: true }
    const changed = { existed_before: true, exists_after: true }
    const removed = { existed_before: true, exists_after: false }
    expect(netChangeType([added, changed])).toBe('added')
    expect(netChangeType([changed, removed])).toBe('removed')
    expect(netChangeType([removed, added])).toBe('changed')
    expect(netChangeType([added, removed])).toBeNull()
  })

  it('rejects traveler placeholder and invalid emails', () => {
    expect(normalizeNotificationEmail('traveler-x@guest.local')).toBeNull()
    expect(normalizeNotificationEmail('not-an-email')).toBeNull()
    expect(normalizeNotificationEmail(' Notify-Inbox@Example.com ')).toBe(TEST_EMAIL)
  })
})

// ─── Enqueue rules ──────────────────────────────────────────

describe('enqueueParticipationChange', () => {
  const base = { participantName: 'Alice', before: null, actor: PARTICIPANT, now: NOW }

  it('ignores participation added to historic slots', async () => {
    const result = await enqueueParticipationChange({ ...base, calendar: CAL_ALPHA, after: [PAST_SLOT] })
    expect(result).toEqual({ queued: false, reason: 'ignored_past' })
    expect(db.calendar_change_events).toHaveLength(0)
  })

  it('queues urgent changes with a 2 minute deadline', async () => {
    const result = await enqueueParticipationChange({ ...base, calendar: CAL_ALPHA, after: [URGENT_SLOT] })
    expect(result).toMatchObject({ queued: true, tier: 'urgent', recipient: ORGANISER_EMAIL })
    expect(db.calendar_change_events[0].due_at).toBe(at(URGENT_DELAY_MS).toISOString())
  })

  it('queues normal changes with a 15 minute deadline', async () => {
    const result = await enqueueParticipationChange({ ...base, calendar: CAL_ALPHA, after: [NORMAL_SLOT] })
    expect(result).toMatchObject({ queued: true, tier: 'normal' })
    expect(db.calendar_change_events[0].due_at).toBe(at(NORMAL_DELAY_MS).toISOString())
  })

  it('skips edits made by the organiser (by user id or email)', async () => {
    const byId = await enqueueParticipationChange({ ...base, calendar: CAL_ALPHA, after: [URGENT_SLOT], actor: { userId: ORGANISER_ID } })
    const byEmail = await enqueueParticipationChange({ ...base, calendar: CAL_ALPHA, after: [URGENT_SLOT], actor: { email: ORGANISER_EMAIL } })
    expect(byId).toEqual({ queued: false, reason: 'own_edit' })
    expect(byEmail).toEqual({ queued: false, reason: 'own_edit' })
  })

  it('skips calendars with notifications turned off', async () => {
    db.calendar_notification_settings.push({ calendar_id: CAL_ALPHA.id, enabled: false, email: null, notify_from: null })
    const result = await enqueueParticipationChange({ ...base, calendar: CAL_ALPHA, after: [URGENT_SLOT] })
    expect(result).toEqual({ queued: false, reason: 'disabled' })
  })

  it('drops changes made before the notify-from time and queues after it', async () => {
    db.calendar_notification_settings.push({ calendar_id: CAL_ALPHA.id, enabled: true, email: null, notify_from: at(60 * MIN).toISOString() })
    const before = await enqueueParticipationChange({ ...base, calendar: CAL_ALPHA, after: [NORMAL_SLOT] })
    const after = await enqueueParticipationChange({ ...base, calendar: CAL_ALPHA, after: [NORMAL_SLOT], now: at(61 * MIN) })
    expect(before).toEqual({ queued: false, reason: 'before_notify_from' })
    expect(after).toMatchObject({ queued: true })
    expect(db.calendar_change_events).toHaveLength(1)
  })

  it('sends to the custom notification email when one is set', async () => {
    db.calendar_notification_settings.push({ calendar_id: CAL_ALPHA.id, enabled: true, email: TEST_EMAIL, notify_from: null })
    const result = await enqueueParticipationChange({ ...base, calendar: CAL_ALPHA, after: [NORMAL_SLOT] })
    expect(result).toMatchObject({ queued: true, recipient: TEST_EMAIL })
  })

  it('skips organisers without any reachable email', async () => {
    const traveler = { id: 'cal-alpha', created_by: 'Brave Traveler', config: {} }
    const result = await enqueueParticipationChange({ ...base, calendar: traveler, after: [NORMAL_SLOT] })
    expect(result).toEqual({ queued: false, reason: 'no_recipient' })
  })

  it('ignores writes that do not change any slot', async () => {
    const result = await enqueueParticipationChange({ ...base, calendar: CAL_ALPHA, before: [NORMAL_SLOT], after: [NORMAL_SLOT] })
    expect(result).toEqual({ queued: false, reason: 'no_change' })
  })
})

// ─── Aggregation and dispatch ───────────────────────────────

describe('flushDueNotifications', () => {
  async function change(calendar: typeof CAL_ALPHA, name: string, before: string[] | null, after: string[] | null, offsetMs = 0) {
    return enqueueParticipationChange({ calendar, participantName: name, before, after, actor: PARTICIPANT, now: at(offsetMs) })
  }

  it('aggregates added/changed/removed across multiple calendars into one email', async () => {
    db.calendar_notification_settings.push(
      { calendar_id: CAL_ALPHA.id, enabled: true, email: TEST_EMAIL, notify_from: null },
      { calendar_id: CAL_BETA.id, enabled: true, email: TEST_EMAIL, notify_from: null },
    )
    participants(CAL_ALPHA.id, 4)
    participants(CAL_BETA.id, 2)

    await change(CAL_ALPHA, 'Alice', null, [NORMAL_SLOT])
    await change(CAL_ALPHA, 'Bob', [NORMAL_SLOT], [NORMAL_SLOT, NORMAL_SLOT_2], MIN)
    await change(CAL_ALPHA, 'Carol', [NORMAL_SLOT], [], 2 * MIN)
    await change(CAL_BETA, 'Dave', null, [NORMAL_SLOT], 3 * MIN)
    await change(CAL_BETA, 'Erin', [NORMAL_SLOT], [NORMAL_SLOT_2], 4 * MIN)
    await change(CAL_BETA, 'Frank', [NORMAL_SLOT_2], [], 5 * MIN)

    const summary = await flushDueNotifications(at(NORMAL_DELAY_MS), mockSendEmail)

    expect(summary).toMatchObject({ recipients: 1, emailsSent: 1, eventsProcessed: 6 })
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    const [to, subject, text] = mockSendEmail.mock.calls[0] as [string, string, string]
    expect(to).toBe(TEST_EMAIL)
    expect(subject).toBe('Participation updates in 2 Coordination Calendars')
    expect(text).toContain('== Alpha Planning ==')
    expect(text).toContain('/calendar/alpha12345')
    expect(text).toContain('Total participants: 4')
    expect(text).toContain('Added (1): Alice')
    expect(text).toContain('Changed (1): Bob')
    expect(text).toContain('Removed (1): Carol')
    expect(text).toContain('== Beta Sync ==')
    expect(text).toContain('/calendar/beta123456')
    expect(text).toContain('Total participants: 2')
    expect(text).toContain('Added (1): Dave')
    expect(text).toContain('Changed (1): Erin')
    expect(text).toContain('Removed (1): Frank')
    expect(db.calendar_change_events.every(e => e.sent_at)).toBe(true)
  })

  it('holds normal changes for 15 minutes from the first pending change', async () => {
    await change(CAL_ALPHA, 'Alice', null, [NORMAL_SLOT])
    await change(CAL_ALPHA, 'Bob', null, [NORMAL_SLOT], 10 * MIN)

    await flushDueNotifications(at(NORMAL_DELAY_MS - MIN), mockSendEmail)
    expect(mockSendEmail).not.toHaveBeenCalled()

    await flushDueNotifications(at(NORMAL_DELAY_MS), mockSendEmail)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockSendEmail.mock.calls[0][2]).toContain('Added (2): Alice, Bob')
  })

  it('sends urgent changes after 2 minutes and pulls pending normal changes along', async () => {
    await change(CAL_ALPHA, 'Alice', null, [NORMAL_SLOT])
    await change(CAL_BETA, 'Bob', null, [URGENT_SLOT], MIN)

    await flushDueNotifications(at(MIN + URGENT_DELAY_MS - 1000), mockSendEmail)
    expect(mockSendEmail).not.toHaveBeenCalled()

    await flushDueNotifications(at(MIN + URGENT_DELAY_MS), mockSendEmail)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    const text = mockSendEmail.mock.calls[0][2] as string
    expect(text).toContain('Alpha Planning')
    expect(text).toContain('Beta Sync')

    await flushDueNotifications(at(NORMAL_DELAY_MS), mockSendEmail)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
  })

  it('reports the net change when a participant edits several times in one window', async () => {
    await change(CAL_ALPHA, 'Alice', null, [NORMAL_SLOT])
    await change(CAL_ALPHA, 'Alice', [NORMAL_SLOT], [NORMAL_SLOT, NORMAL_SLOT_2], MIN)
    await change(CAL_ALPHA, 'Bob', [NORMAL_SLOT], [NORMAL_SLOT_2], MIN)
    await change(CAL_ALPHA, 'Bob', [NORMAL_SLOT_2], [], 2 * MIN)

    await flushDueNotifications(at(NORMAL_DELAY_MS), mockSendEmail)
    const text = mockSendEmail.mock.calls[0][2] as string
    expect(text).toContain('Added (1): Alice')
    expect(text).toContain('Removed (1): Bob')
    expect(text).not.toContain('Changed')
  })

  it('sends nothing when every change cancels out', async () => {
    await change(CAL_ALPHA, 'Alice', null, [NORMAL_SLOT])
    await change(CAL_ALPHA, 'Alice', [NORMAL_SLOT], [], MIN)

    const summary = await flushDueNotifications(at(NORMAL_DELAY_MS), mockSendEmail)
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(summary.emailsSent).toBe(0)
    expect(db.calendar_change_events.every(e => e.sent_at)).toBe(true)
  })

  it('sends separate emails to separate recipients', async () => {
    db.calendar_notification_settings.push({ calendar_id: CAL_BETA.id, enabled: true, email: TEST_EMAIL, notify_from: null })
    await change(CAL_ALPHA, 'Alice', null, [URGENT_SLOT])
    await change(CAL_BETA, 'Bob', null, [URGENT_SLOT])

    await flushDueNotifications(at(URGENT_DELAY_MS), mockSendEmail)
    const recipients = mockSendEmail.mock.calls.map(call => call[0]).sort()
    expect(recipients).toEqual([TEST_EMAIL, ORGANISER_EMAIL])
  })

  it('releases events for retry with backoff when sending fails', async () => {
    mockSendEmail.mockResolvedValueOnce({ success: false, error: 'SMTP down' })
    await change(CAL_ALPHA, 'Alice', null, [URGENT_SLOT])

    const summary = await flushDueNotifications(at(URGENT_DELAY_MS), mockSendEmail)
    expect(summary.emailsFailed).toBe(1)
    const event = db.calendar_change_events[0]
    expect(event.sent_at).toBeNull()
    expect(event.attempts).toBe(1)
    expect(event.last_error).toBe('SMTP down')

    await flushDueNotifications(at(URGENT_DELAY_MS + MIN), mockSendEmail)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)

    await flushDueNotifications(at(URGENT_DELAY_MS + 5 * MIN), mockSendEmail)
    expect(mockSendEmail).toHaveBeenCalledTimes(2)
    expect(db.calendar_change_events[0].sent_at).toBeTruthy()
  })
})

describe('buildDigestEmail', () => {
  it('uses the calendar name in the subject for a single calendar', () => {
    const { subject, text } = buildDigestEmail([{
      calendarId: 'c', title: 'Team Sync', link: 'http://localhost:5173/calendar/abc', participantCount: 3,
      added: ['Ann'], changed: [], removed: [],
    }])
    expect(subject).toBe('Participation update: Team Sync')
    expect(text).toContain('Total participants: 3')
    expect(text).not.toContain('Changed')
  })
})
