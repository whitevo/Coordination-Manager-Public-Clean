import { describe, expect, it } from 'vitest'
import { buildEmailRecipientRows, buildReminderPlans, uniquePollOptions } from '../announcement-send-plan'

describe('announcement send planning', () => {
  it('shares recipient eligibility while preserving hidden email display', () => {
    const rows = buildEmailRecipientRows({
      contacts: [{ id: 'disabled', email: 'disabled@example.com', display_name: null, opted_out: false, notification_disabled: true }],
      friends: [{ user_id: 'friend', email: null, display_name: 'Friend' }],
      participants: [
        { username: 'Hidden', email: 'hidden@example.com', email_status: 'hidden', calendar_ids: ['cal'] },
        { username: 'Outside', email: 'outside@example.com', email_status: 'visible', calendar_ids: ['other'] },
      ],
      calendarIds: ['cal'],
      calendars: [{ id: 'cal', title: 'Team' }],
    })
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({
      key: 'calendar:Hidden', email: null, deliveryEmail: 'hidden@example.com',
      email_display: 'Email Exists', source_detail: 'Team', selectable: true,
    })
    expect(rows.filter(row => row.selectable)).toHaveLength(1)
  })
  it('keeps the first non-empty option per emoji', () => {
    expect(uniquePollOptions([{ emoji: '1', text: '' }, { emoji: '1', text: 'First' }, { emoji: '1', text: 'Second' }]))
      .toEqual([{ emoji: '1', text: 'First' }])
  })
  it('preserves meeting-major reminder order and the minimum lead time', () => {
    const result = buildReminderPlans({
      meetings: [120_000, 240_000], offsets: [0, 120_000],
      startTime: value => value, offsetTime: value => value, now: 0,
    })
    expect(result.plans.map(plan => [plan.meeting, plan.offset])).toEqual([[120_000, 0], [240_000, 0], [240_000, 120_000]])
    expect(result.skipped).toEqual([{ meeting: 120_000, offset: 120_000 }])
  })
})
