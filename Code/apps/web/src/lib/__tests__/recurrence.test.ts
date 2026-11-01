import { describe, it, expect } from 'vitest'
import { ensureUTC, expandRecurringPublicEvents, getRecurringCellIdsInWeek, getRecurringEventStartsInRange, getUtcWeekRange, splitRecurringEventRule, type PublicEvent } from '../recurrence'

describe('recurrence lib', () => {
  it('normalizes conditional schedules without virtually expanding uncreated occurrences', () => {
    const event = {
      id: 'conditional', title: 'Conditional', start_time: '2026-10-05T09:00:00Z',
      end_time: '2026-10-05T10:00:00Z',
      recurrence_rule: { type: 'custom', unit: 'day', interval: 1, endType: 'whenCompleted' },
    }
    const start = new Date('2026-10-05T00:00:00Z')
    const end = new Date('2026-10-12T00:00:00Z')
    expect(getRecurringEventStartsInRange(event, start, end)).toEqual([event.start_time])
    expect(expandRecurringPublicEvents([event], start, end)).toEqual([event])
    expect(expandRecurringPublicEvents([event], end, new Date('2026-10-19T00:00:00Z'))).toEqual([])
  })
  it('expands an old unlimited series directly into the requested week', () => {
    const event = {
      id: 'old', title: 'Old series', start_time: '2021-01-04T09:00:00Z', end_time: '2021-01-04T10:00:00Z',
      recurrence_rule: { type: 'weekly', endType: 'never' },
    }
    expect(getRecurringEventStartsInRange(event, new Date('2026-10-05'), new Date('2026-10-12'), { calendarDayCadence: true }))
      .toEqual(['2026-10-05T09:00:00.000Z'])
  })
  it('still counts historical excluded occurrences toward a count limit', () => {
    const event = {
      id: 'limited', title: 'Limited series', start_time: '2026-09-07T09:00:00Z', end_time: '2026-09-07T10:00:00Z',
      recurrence_rule: { type: 'weekly', endType: 'after', endCount: 3, exceptions: ['2026-09-14'] },
    }
    expect(getRecurringEventStartsInRange(event, new Date('2026-09-21'), new Date('2026-09-28'), { calendarDayCadence: true }))
      .toEqual(['2026-09-21T09:00:00.000Z'])
    expect(getRecurringEventStartsInRange(event, new Date('2026-09-28'), new Date('2026-10-05'), { calendarDayCadence: true }))
      .toEqual([])
  })
  const series: PublicEvent = {
    id: 'series', title: 'Original',
    start_time: '2026-09-07T10:00:00.000Z', end_time: '2026-09-07T11:00:00.000Z',
    recurrence_rule: { type: 'weekly', endType: 'after', endCount: 5, exceptions: ['2026-09-14', '2026-09-28'] },
  }

  it('excludes only the edited occurrence for a single-item change', () => {
    const { previousRule, nextRule } = splitRecurringEventRule(series, '2026-09-21T10:00:00.000Z', 'this')
    expect(previousRule.exceptions).toEqual(['2026-09-14', '2026-09-28', '2026-09-21'])
    expect(previousRule.endCount).toBe(5)
    expect(nextRule).toEqual({ type: 'none' })
  })

  it('keeps earlier occurrences unchanged and preserves remaining count and future exceptions', () => {
    const { previousRule, nextRule } = splitRecurringEventRule(series, '2026-09-21T10:00:00.000Z', 'future')
    expect(previousRule.endDate).toBe('2026-09-20')
    expect(nextRule.endCount).toBe(3)
    expect(nextRule.exceptions).toEqual(['2026-09-28'])
    const expanded = expandRecurringPublicEvents([
      { ...series, recurrence_rule: previousRule },
      { ...series, id: 'future', title: 'Changed', start_time: '2026-09-21T10:00:00.000Z', end_time: '2026-09-21T11:00:00.000Z', recurrence_rule: nextRule },
    ], new Date('2026-09-01'), new Date('2026-11-01'))
    expect(expanded.map((event) => [event.title, event.start_time.slice(0, 10)])).toEqual([
      ['Original', '2026-09-07'], ['Changed', '2026-09-21'], ['Changed', '2026-10-05'],
    ])
  })

  it('preserves multi-week weekday cadence when splitting on the second weekday', () => {
    const custom = { ...series, recurrence_rule: { type: 'custom', unit: 'week', interval: 2, weekDays: [0, 3], endType: 'after', endCount: 6 } }
    const occurrence = '2026-09-10T10:00:00.000Z'
    const { previousRule, nextRule } = splitRecurringEventRule(custom, occurrence, 'future')
    expect(nextRule.weekOffsetDays).toBe(3)
    const original = expandRecurringPublicEvents([custom], new Date('2026-09-01'), new Date('2026-11-01'))
    const split = expandRecurringPublicEvents([
      { ...custom, recurrence_rule: previousRule },
      { ...custom, id: 'next', start_time: occurrence, end_time: '2026-09-10T11:00:00.000Z', recurrence_rule: nextRule },
    ], new Date('2026-09-01'), new Date('2026-11-01'))
    expect(split.map((event) => event.start_time)).toEqual(original.map((event) => event.start_time))
  })

  it('ensures ISO timestamp strings have a UTC Z suffix', () => {
    expect(ensureUTC('2026-09-14 17:00:00')).toBe('2026-09-14 17:00:00Z')
    expect(ensureUTC('2026-09-14T17:00:00Z')).toBe('2026-09-14T17:00:00Z')
    expect(ensureUTC('2026-09-14T17:00:00+00:00')).toBe('2026-09-14T17:00:00+00:00')
  })

  it('expands past base recurring events into future occurrences', () => {
    const pastBaseEvent: PublicEvent = {
      id: 'event-odin-1',
      title: 'ODIN',
      start_time: '2026-08-03T17:00:00.000Z',
      end_time: '2026-08-03T18:00:00.000Z',
      is_public: true,
      recurrence_rule: {
        type: 'weekly',
        unit: 'week',
        endType: 'never',
        interval: 1,
      },
    }

    const windowStart = new Date('2026-09-13T00:00:00.000Z')
    const windowEnd = new Date('2026-09-20T00:00:00.000Z')

    const expanded = expandRecurringPublicEvents([pastBaseEvent], windowStart, windowEnd)
    expect(expanded).toHaveLength(1)
    expect(expanded[0].start_time).toBe('2026-09-14T17:00:00.000Z')
    expect(expanded[0].id).toContain('event-odin-1__occ__')
  })

  describe('getRecurringCellIdsInWeek (CalendarPage grid)', () => {
    // 2026-10-05 is a Monday; weekStart is the local Monday the grid shows.
    const weekStart = new Date(2026, 9, 12)

    it('honors a single selected weekday that differs from the start date', () => {
      expect(getRecurringCellIdsInWeek('2026-10-05_09:00', { type: 'custom', unit: 'week', interval: 1, weekDays: [2] }, weekStart))
        .toEqual(['2026-10-14_09:00'])
    })

    it('keeps weekly meetings on the cell weekday even for late UTC times', () => {
      expect(getRecurringCellIdsInWeek('2026-10-05_23:30', { type: 'weekly' }, weekStart)).toEqual(['2026-10-12_23:30'])
    })

    it('expands several weekdays and skips exceptions', () => {
      expect(getRecurringCellIdsInWeek('2026-10-05_09:00', {
        type: 'custom', unit: 'week', interval: 1, weekDays: [0, 2, 4], exceptions: ['2026-10-14'],
      }, weekStart)).toEqual(['2026-10-12_09:00', '2026-10-16_09:00'])
    })

    it('excludes the base cell and respects count limits', () => {
      const rule = { type: 'weekly', endType: 'after', endCount: 2 }
      expect(getRecurringCellIdsInWeek('2026-10-12_09:00', rule, weekStart)).toEqual([])
      expect(getRecurringCellIdsInWeek('2026-10-05_09:00', rule, weekStart)).toEqual(['2026-10-12_09:00'])
      expect(getRecurringCellIdsInWeek('2026-10-05_09:00', rule, new Date(2026, 9, 19))).toEqual([])
    })
  })

  describe('custom weekly cycles use Monday-start weeks', () => {
    const rule = { type: 'custom', unit: 'week', interval: 3, weekDays: [1, 3] }
    const starts = (start: string) => getRecurringEventStartsInRange(
      { id: 'c', title: 'c', start_time: start, end_time: start, recurrence_rule: rule },
      new Date('2026-10-01T00:00:00Z'), new Date('2026-12-01T00:00:00Z'), { calendarDayCadence: true },
    ).map((iso) => iso.slice(0, 10))

    it('does not show next Tuesday for a Thursday start', () => {
      expect(starts('2026-10-08T09:00:00Z')).toEqual(['2026-10-08', '2026-10-27', '2026-10-29', '2026-11-17', '2026-11-19'])
    })

    it('gives a Tuesday start the same cycle', () => {
      expect(starts('2026-10-06T09:00:00Z')).toEqual(['2026-10-06', '2026-10-08', '2026-10-27', '2026-10-29', '2026-11-17', '2026-11-19'])
    })
  })

  it('getUtcWeekRange covers the grid week labels in UTC', () => {
    const { start, end } = getUtcWeekRange(new Date(2026, 9, 12))
    expect(start.toISOString()).toBe('2026-10-12T00:00:00.000Z')
    expect(end.toISOString()).toBe('2026-10-19T00:00:00.000Z')
  })
})
