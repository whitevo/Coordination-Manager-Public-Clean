import { describe, expect, it } from 'vitest'
import { adjustTimeRangeEdge, getTimeRangeDaySegments, normaliseTimeRangeToWeek } from '../time-management-time-adjustment'

describe('adjustTimeRangeEdge', () => {
  it.each([
    { edge: 'end', delta: -60, start: 600, end: 630, expected: [540, 570] },
    { edge: 'start', delta: 60, start: 600, end: 630, expected: [660, 690] },
    { edge: 'end', delta: -30, start: 600, end: 630, expected: [570, 600] },
    { edge: 'start', delta: 30, start: 600, end: 630, expected: [630, 660] },
    { edge: 'end', delta: -120, start: 600, end: 690, expected: [480, 570] },
    { edge: 'start', delta: 120, start: 600, end: 690, expected: [720, 810] },
    { edge: 'end', delta: -60, start: 0, end: 30, expected: [-60, -30] },
    { edge: 'start', delta: 60, start: 1410, end: 1440, expected: [1470, 1500] },
    { edge: 'end', delta: -120, start: 1410, end: 1470, expected: [1290, 1350] },
  ] as const)('relocates $start-$end with $edge $delta, including equality and midnight', ({ edge, delta, start, end, expected }) => {
    const result = adjustTimeRangeEdge({
      startMinute: start, endMinute: end, edge, deltaMinutes: delta, minimumDuration: 30,
    })
    expect(result).toEqual({ startMinute: expected[0], endMinute: expected[1] })
    expect(result.endMinute - result.startMinute).toBe(end - start)
  })

  it.each([
    { edge: 'start', delta: -30, expected: [570, 690] },
    { edge: 'start', delta: 30, expected: [630, 690] },
    { edge: 'end', delta: -30, expected: [600, 660] },
    { edge: 'end', delta: 30, expected: [600, 720] },
    { edge: 'start', delta: 75, expected: [660, 690] },
    { edge: 'end', delta: -75, expected: [600, 630] },
  ] as const)('preserves normal resizing and minimum duration for $edge $delta', ({ edge, delta, expected }) => {
    expect(adjustTimeRangeEdge({
      startMinute: 600, endMinute: 690, edge, deltaMinutes: delta, minimumDuration: 30,
    })).toEqual({ startMinute: expected[0], endMinute: expected[1] })
  })

  it('keeps relocating a minimum-duration interval on repeated clicks', () => {
    let range = { startMinute: 600, endMinute: 630 }
    for (let index = 0; index < 25; index += 1) {
      range = adjustTimeRangeEdge({ ...range, edge: 'end', deltaMinutes: -30, minimumDuration: 30 })
    }
    expect(range).toEqual({ startMinute: -150, endMinute: -120 })
  })

  it('rejects invalid intervals explicitly', () => {
    expect(() => adjustTimeRangeEdge({
      startMinute: 600, endMinute: 600, edge: 'end', deltaMinutes: -30, minimumDuration: 30,
    })).toThrow(RangeError)
  })
})

describe('date and grid normalization', () => {
  it.each([
    { day: 2, start: -60, end: -30, expected: { dayIndex: 1, startMinute: 1380, endMinute: 1410, weekOffset: 0 } },
    { day: 0, start: -60, end: -30, expected: { dayIndex: 6, startMinute: 1380, endMinute: 1410, weekOffset: -1 } },
    { day: 6, start: 1470, end: 1500, expected: { dayIndex: 0, startMinute: 30, endMinute: 60, weekOffset: 1 } },
    { day: 3, start: 1410, end: 1470, expected: { dayIndex: 3, startMinute: 1410, endMinute: 1470, weekOffset: 0 } },
  ])('normalizes day $day range $start-$end without losing duration', ({ day, start, end, expected }) => {
    expect(normaliseTimeRangeToWeek({ dayIndex: day, startMinute: start, endMinute: end })).toEqual(expected)
  })

  it('splits a cross-midnight draft into bounded day highlights', () => {
    expect(getTimeRangeDaySegments({ dayIndex: 2, startMinute: 1410, endMinute: 1470 })).toEqual([
      { dayIndex: 2, startMinute: 1410, endMinute: 1440 },
      { dayIndex: 3, startMinute: 0, endMinute: 30 },
    ])
  })

  it('clips long selections to the visible week', () => {
    expect(getTimeRangeDaySegments({ dayIndex: 6, startMinute: 1410, endMinute: 1470 })).toEqual([
      { dayIndex: 6, startMinute: 1410, endMinute: 1440 },
    ])
  })
})

describe('multi-week day ranges', () => {
  it('keeps a range that stays inside a 14 day grid on its own day', () => {
    expect(normaliseTimeRangeToWeek({ dayIndex: 6, startMinute: 1440, endMinute: 1500 }, 14))
      .toEqual({ dayIndex: 7, startMinute: 0, endMinute: 60, weekOffset: 0 })
  })

  it('wraps a range that leaves a 14 day grid into the next weeks', () => {
    expect(normaliseTimeRangeToWeek({ dayIndex: 13, startMinute: 1440, endMinute: 1500 }, 14))
      .toEqual({ dayIndex: 0, startMinute: 0, endMinute: 60, weekOffset: 2 })
  })

  it('returns selection segments on days after the first week', () => {
    expect(getTimeRangeDaySegments({ dayIndex: 9, startMinute: 1380, endMinute: 1500 }, 14)).toEqual([
      { dayIndex: 9, startMinute: 1380, endMinute: 1440 },
      { dayIndex: 10, startMinute: 0, endMinute: 60 },
    ])
  })
})
