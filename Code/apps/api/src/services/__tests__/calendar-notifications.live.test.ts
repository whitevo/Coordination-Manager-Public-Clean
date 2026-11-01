/**
 * Live email scenario for Coordination Calendar change notifications.
 *
 * Skipped by default. Sends real aggregated emails through the platform SMTP
 * account (SMTP_USER / SMTP_PASS in apps/api/.env) to the test inbox.
 *
 * Run:
 *   $env:CALENDAR_NOTIFICATIONS_LIVE_EMAIL = '1'
 *   pnpm --dir ./Code/apps/api exec vitest run src/services/__tests__/calendar-notifications.live.test.ts
 *
 * Expected inbox result (EMAIL_TEST_RECIPIENT / CALENDAR_NOTIFICATIONS_TEST_EMAIL inbox): two emails.
 *   1. "Participation update: Live Urgent Standup" -- urgent tier only
 *   2. "Participation updates in 3 Coordination Calendars" -- normal tier,
 *      with added / changed / removed names in every calendar
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import dotenv from 'dotenv'
import { db, resetDb } from './helpers/in-memory-supabase.js'
import { getTestEmailRecipient } from './helpers/test-email.js'

dotenv.config({ quiet: true })

vi.mock('../../supabaseClient.js', async () => {
  const fake = await import('./helpers/in-memory-supabase.js')
  return { supabaseAdmin: fake.fakeSupabaseAdmin }
})

const LIVE = process.env.CALENDAR_NOTIFICATIONS_LIVE_EMAIL === '1'
const TEST_EMAIL = getTestEmailRecipient('CALENDAR_NOTIFICATIONS_TEST_EMAIL')
const ORGANISER_ID = '33333333-3333-4333-8333-333333333333'
const PARTICIPANT = { userId: '44444444-4444-4444-8444-444444444444' }
const MIN = 60 * 1000

function slotAt(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}_${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

describe.skipIf(!LIVE)('calendar change notifications (live email)', () => {
  let service: typeof import('../calendar-notifications.js')
  const now = new Date()
  const at = (offset: number) => new Date(now.getTime() + offset)
  const urgent = slotAt(now.getTime() + 30 * MIN)
  const normalA = slotAt(now.getTime() + 2 * 24 * 60 * MIN)
  const normalB = slotAt(now.getTime() + 3 * 24 * 60 * MIN)
  const past = slotAt(now.getTime() - 5 * 60 * MIN)

  const calendars = [
    { id: 'live-urgent', hash: 'liveurgent', title: 'Live Urgent Standup' },
    { id: 'live-alpha', hash: 'livealpha1', title: 'Live Alpha Planning' },
    { id: 'live-beta', hash: 'livebeta12', title: 'Live Beta Retro' },
    { id: 'live-gamma', hash: 'livegamma1', title: 'Live Gamma Workshop' },
  ]
  const ref = (id: string) => ({ id, created_by: ORGANISER_ID, config: {} })

  beforeAll(async () => {
    service = await import('../calendar-notifications.js')
  })

  beforeEach(() => {
    resetDb()
    db.users = [{ id: ORGANISER_ID, email: 'organiser-without-inbox@example.com' }]
    db.calendars = calendars.map(c => ({ ...c }))
    db.availability = []
    db.calendar_notification_settings = calendars.map(c => ({ calendar_id: c.id, enabled: true, email: TEST_EMAIL, notify_from: null }))
    db.calendar_change_events = []
    for (const [id, count] of [['live-urgent', 3], ['live-alpha', 5], ['live-beta', 4], ['live-gamma', 2]] as const) {
      for (let i = 0; i < count; i += 1) db.availability.push({ calendar_id: id, username: `p${i}` })
    }
  })

  async function change(calendarId: string, name: string, before: string[] | null, after: string[] | null, offset = 0) {
    return service.enqueueParticipationChange({
      calendar: ref(calendarId), participantName: name, before, after, actor: PARTICIPANT, now: at(offset),
    })
  }

  it('sends the urgent-tier email after 2 minutes', async () => {
    expect(await change('live-urgent', 'Ignored Historic', null, [past])).toMatchObject({ queued: false, reason: 'ignored_past' })
    expect(await change('live-urgent', 'Urgent Uma', null, [urgent])).toMatchObject({ queued: true, tier: 'urgent' })
    const ownEdit = await service.enqueueParticipationChange({
      calendar: ref('live-urgent'), participantName: 'Organiser Self', before: null, after: [urgent], actor: { userId: ORGANISER_ID }, now,
    })
    expect(ownEdit).toMatchObject({ queued: false, reason: 'own_edit' })

    const early = await service.flushDueNotifications(at(service.URGENT_DELAY_MS - 1000))
    expect(early.emailsSent).toBe(0)
    const summary = await service.flushDueNotifications(at(service.URGENT_DELAY_MS))
    expect(summary).toMatchObject({ emailsSent: 1, emailsFailed: 0 })
  }, 30_000)

  it('sends one normal-tier email aggregating added/changed/removed across 3 calendars', async () => {
    let offset = 0
    for (const id of ['live-alpha', 'live-beta', 'live-gamma']) {
      const tag = id.replace('live-', '')
      await change(id, `Added ${tag}`, null, [normalA], offset += MIN)
      await change(id, `Changed ${tag}`, [normalA], [normalA, normalB], offset += MIN)
      await change(id, `Removed ${tag}`, [normalB], [], offset += MIN)
    }

    const early = await service.flushDueNotifications(at(service.NORMAL_DELAY_MS - MIN))
    expect(early.emailsSent).toBe(0)
    const summary = await service.flushDueNotifications(at(service.NORMAL_DELAY_MS + MIN))
    expect(summary).toMatchObject({ recipients: 1, emailsSent: 1, emailsFailed: 0, eventsProcessed: 9 })
  }, 30_000)
})
