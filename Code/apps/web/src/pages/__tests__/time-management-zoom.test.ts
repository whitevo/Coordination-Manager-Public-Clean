import { describe, expect, it } from 'vitest'
import {
  canStepZoomLevel,
  DAY_ZOOM_LEVELS,
  getDayRangeLength,
  getDayRangeLengthForIndexes,
  getDayWindowIndexes,
  getNavigationWeekStep,
  getVisibleDayIndexes,
  shiftDayWindow,
  stepDayZoomLevel,
  stepTimeZoomLevel,
  TIME_ZOOM_LEVELS,
  zoomOutDayLevel,
} from '../time-management-zoom'

const MON = 0, TUE = 1, WED = 2, THU = 3, FRI = 4, SAT = 5, SUN = 6

describe('zoomOutDayLevel', () => {
  it('returns to 1 week from any sub-week view, then widens normally', () => {
    for (const level of [1, 2, 3, 5] as const) expect(zoomOutDayLevel(level)).toBe(7)
    expect(zoomOutDayLevel(7)).toBe(14)
    expect(zoomOutDayLevel(14)).toBe(28)
    expect(zoomOutDayLevel(28)).toBe(28)
  })
})

describe('sub-week day windows', () => {
  it('shifts one day at a time and rolls into neighbouring weeks', () => {
    expect(shiftDayWindow(2, 1)).toEqual({ start: 3, weekOffset: 0 })
    expect(shiftDayWindow(6, 1)).toEqual({ start: 0, weekOffset: 1 })
    expect(shiftDayWindow(0, -1)).toEqual({ start: 6, weekOffset: -1 })
  })

  it('loads a second week when the window runs past Sunday', () => {
    expect(getDayWindowIndexes(3, 5)).toEqual([5, 6, 7])
    expect(getDayRangeLengthForIndexes(3, [5, 6, 7])).toBe(14)
    expect(getDayRangeLengthForIndexes(3, [2, 3, 4])).toBe(7)
    expect(getDayRangeLengthForIndexes(28, getDayWindowIndexes(28, 0))).toBe(28)
  })
})

describe('stepTimeZoomLevel', () => {
  it('moves one interval smaller or bigger and stops at the ends', () => {
    expect(stepTimeZoomLevel(30, -1)).toBe(15)
    expect(stepTimeZoomLevel(30, 1)).toBe(60)
    expect(stepTimeZoomLevel(15, -1)).toBe(15)
    expect(stepTimeZoomLevel(60, 1)).toBe(60)
    expect(canStepZoomLevel(TIME_ZOOM_LEVELS, 15, -1)).toBe(false)
    expect(canStepZoomLevel(TIME_ZOOM_LEVELS, 60, 1)).toBe(false)
  })
})

describe('stepDayZoomLevel', () => {
  it('walks 1, 2, 3, 5, 7, 14, 28 days', () => {
    expect(stepDayZoomLevel(7, -1)).toBe(5)
    expect(stepDayZoomLevel(5, -1)).toBe(3)
    expect(stepDayZoomLevel(3, -1)).toBe(2)
    expect(stepDayZoomLevel(2, -1)).toBe(1)
    expect(stepDayZoomLevel(1, -1)).toBe(1)
    expect(stepDayZoomLevel(7, 1)).toBe(14)
    expect(stepDayZoomLevel(14, 1)).toBe(28)
    expect(stepDayZoomLevel(28, 1)).toBe(28)
    expect(canStepZoomLevel(DAY_ZOOM_LEVELS, 28, 1)).toBe(false)
  })

  it('uses a 7, 14 or 28 day range and moves navigation by that many weeks', () => {
    expect(getDayRangeLength(3)).toBe(7)
    expect(getDayRangeLength(14)).toBe(14)
    expect(getNavigationWeekStep(1)).toBe(1)
    expect(getNavigationWeekStep(7)).toBe(1)
    expect(getNavigationWeekStep(14)).toBe(2)
    expect(getNavigationWeekStep(28)).toBe(4)
  })
})

describe('getVisibleDayIndexes', () => {
  it('shows the whole range at week and multi-week levels', () => {
    expect(getVisibleDayIndexes(7, WED)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(getVisibleDayIndexes(14, WED)).toHaveLength(14)
    expect(getVisibleDayIndexes(28, WED)).toHaveLength(28)
  })

  it.each([
    { today: MON, expected: [MON, TUE, WED, THU, FRI] },
    { today: TUE, expected: [MON, TUE, WED, THU, FRI] },
    { today: WED, expected: [MON, TUE, WED, THU, FRI] },
    { today: THU, expected: [TUE, WED, THU, FRI, SAT] },
    { today: FRI, expected: [WED, THU, FRI, SAT, SUN] },
    { today: SAT, expected: [WED, THU, FRI, SAT, SUN] },
    { today: SUN, expected: [WED, THU, FRI, SAT, SUN] },
  ])('5 days on weekday $today', ({ today, expected }) => {
    expect(getVisibleDayIndexes(5, today)).toEqual(expected)
  })

  it.each([
    { today: MON, expected: [MON, TUE, WED] },
    { today: WED, expected: [TUE, WED, THU] },
    { today: FRI, expected: [THU, FRI, SAT] },
    { today: SUN, expected: [FRI, SAT, SUN] },
  ])('3 days on weekday $today', ({ today, expected }) => {
    expect(getVisibleDayIndexes(3, today)).toEqual(expected)
  })

  it.each([
    { today: MON, two: [MON, TUE], one: [MON] },
    { today: WED, two: [WED, THU], one: [WED] },
    { today: SUN, two: [SAT, SUN], one: [SUN] },
  ])('drops earlier days first, then the right-most day (weekday $today)', ({ today, two, one }) => {
    expect(getVisibleDayIndexes(2, today)).toEqual(two)
    expect(getVisibleDayIndexes(1, today)).toEqual(one)
  })

  it('each smaller level is a subset of the previous one', () => {
    for (let today = MON; today <= SUN; today += 1) {
      const levels = [7, 5, 3, 2, 1] as const
      for (let i = 1; i < levels.length; i += 1) {
        const larger = getVisibleDayIndexes(levels[i - 1], today)
        const smaller = getVisibleDayIndexes(levels[i], today)
        expect(smaller.every((day) => larger.includes(day))).toBe(true)
        expect(smaller).toContain(today)
      }
    }
  })
})
