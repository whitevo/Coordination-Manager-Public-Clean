import { describe, expect, it } from 'vitest'
import { getWeekEventWindow, isEventInWindow } from '../user-event-window'

describe('user event windows', () => {
  const window = getWeekEventWindow(new Date(2026, 9, 5))
  it('uses calendar date boundaries independently of the browser offset', () => {
    expect(window).toEqual({ windowStart: '2026-10-05T00:00:00.000Z', windowEnd: '2026-10-12T00:00:00.000Z' })
  })
  it('includes events spanning the start and excludes adjacent boundary-only events', () => {
    expect(isEventInWindow({ start_time: '2026-10-04T23:00:00Z', end_time: '2026-10-05T01:00:00Z' }, window)).toBe(true)
    expect(isEventInWindow({ start_time: '2026-10-04T23:00:00Z', end_time: window.windowStart }, window)).toBe(false)
    expect(isEventInWindow({ start_time: window.windowEnd, end_time: '2026-10-12T01:00:00Z' }, window)).toBe(false)
  })
  it('includes old recurring masters but not future masters or old non-recurring events', () => {
    const event = { start_time: '2020-01-01T09:00:00Z', end_time: '2020-01-01T10:00:00Z' }
    expect(isEventInWindow({ ...event, recurrence_rule: { type: 'weekly' } }, window)).toBe(true)
    expect(isEventInWindow({ ...event, recurrence_rule: { type: 'none' } }, window)).toBe(false)
    expect(isEventInWindow({ ...event, start_time: '2030-01-01T09:00:00Z', recurrence_rule: { type: 'weekly' } }, window)).toBe(false)
  })
})
