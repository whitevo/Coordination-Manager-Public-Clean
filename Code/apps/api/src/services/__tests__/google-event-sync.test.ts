import { describe, it, expect, vi } from 'vitest'

vi.mock('../../supabaseClient.js', () => ({ supabaseAdmin: { from: vi.fn() } }))

const { buildGooglePayload, diffGoogleEvent } = await import('../google-event-sync.js')
const { buildRecurrenceLines } = await import('../google-calendar-api.js')

const series = {
  id: 'series-1',
  user_id: 'user-1',
  title: 'Standup',
  description: null,
  location: null,
  meeting_link: 'https://meet.example/abc',
  start_time: '2026-10-05T09:00:00+00:00',
  end_time: '2026-10-05T09:30:00+00:00',
  recurrence_rule: { type: 'weekly', exceptions: ['2026-10-12', '2026-10-19'] },
}

describe('buildGooglePayload', () => {
  it('exports a conditional occurrence without an unlimited Google recurrence', () => {
    const payload = buildGooglePayload({
      ...series, recurrence_rule: { type: 'weekly', endType: 'whenCompleted' },
    }, [])
    expect(payload.master.recurrence).toBeUndefined()
    expect(payload.instances).toEqual({})
  })
  it('excludes deleted occurrences and overrides replaced ones', () => {
    const replacement = {
      ...series,
      id: 'replacement-1',
      title: 'Standup (moved)',
      recurrence_rule: { type: 'none' },
      start_time: '2026-10-19T11:00:00Z',
      end_time: '2026-10-19T11:30:00Z',
      series_id: 'series-1',
      original_start_time: '2026-10-19T09:00:00Z',
    }
    const payload = buildGooglePayload(series, [replacement])

    expect(payload.master.recurrence).toEqual(['RRULE:FREQ=WEEKLY;INTERVAL=1', 'EXDATE:20261012T090000Z'])
    expect(payload.master.location).toBe('https://meet.example/abc')
    expect(payload.master.description).toBe('Meeting link: https://meet.example/abc')
    expect(payload.instances['2026-10-19T09:00:00.000Z']).toMatchObject({
      summary: 'Standup (moved)',
      status: 'confirmed',
      start: { dateTime: '2026-10-19T11:00:00.000Z', timeZone: 'UTC' },
    })
  })

  it('exports a non-recurring item without recurrence or instances', () => {
    const payload = buildGooglePayload({ ...series, recurrence_rule: null }, [])
    expect(payload.master.recurrence).toBeUndefined()
    expect(payload.instances).toEqual({})
  })
})

describe('buildRecurrenceLines', () => {
  it('builds monthly-by-week rules with a frequency', () => {
    expect(buildRecurrenceLines({ type: 'monthlyWeek', monthWeeks: [2, 4] }, '2026-10-13T09:00:00Z'))
      .toEqual(['RRULE:FREQ=MONTHLY;INTERVAL=1;BYDAY=2TU,4TU'])
  })
})

describe('diffGoogleEvent', () => {
  const pushed = buildGooglePayload(series, []).master

  it('reports nothing when Google matches what was pushed (offset formats differ)', () => {
    expect(diffGoogleEvent({
      id: 'g1',
      summary: pushed.summary,
      description: pushed.description,
      location: pushed.location,
      start: { dateTime: '2026-10-05T12:00:00+03:00' },
      end: { dateTime: '2026-10-05T09:30:00Z' },
      recurrence: [...(pushed.recurrence || [])].reverse(),
    }, pushed)).toEqual([])
  })

  it('reports fields edited directly in Google', () => {
    expect(diffGoogleEvent({
      id: 'g1',
      summary: 'Renamed in Google',
      description: pushed.description,
      location: pushed.location,
      start: { dateTime: '2026-10-05T10:00:00Z' },
      end: pushed.end,
      recurrence: pushed.recurrence,
    }, pushed)).toEqual(['title', 'time'])
  })
})
