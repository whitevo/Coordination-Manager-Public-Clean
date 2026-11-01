import { describe, it, expect } from 'vitest'
import { computeDayLayout } from '../calendarOverlapLayout'
import type { LayoutEvent } from '../calendarOverlapLayout'

// Helper: create event times relative to a base day
const DAY_START = new Date('2026-03-15T00:00:00Z').getTime()
const DAY_END = DAY_START + 24 * 60 * 60 * 1000
const SLOT_HEIGHT = 48 // pixels per slot
const SLOT_DURATION = 60 * 60 * 1000 // 1 hour in ms

function makeEvent(id: string, startHour: number, endHour: number): LayoutEvent {
  const start = new Date(DAY_START + startHour * 60 * 60 * 1000).toISOString()
  const end = new Date(DAY_START + endHour * 60 * 60 * 1000).toISOString()
  return { id, start_time: start, end_time: end }
}

// ---------------------------------------------------------------------------
// Empty input
// ---------------------------------------------------------------------------

describe('computeDayLayout - empty', () => {
  it('keeps existing priority when events end and start at the same boundary', () => {
    const result = computeDayLayout([
      makeEvent('continuing', 9, 12), makeEvent('ending', 9, 10), makeEvent('starting', 10, 11),
    ], DAY_START, DAY_END, SLOT_HEIGHT, SLOT_DURATION)
    expect(result.eventSegments.map(segment => [segment.eventId, segment.leftPercent, segment.widthPercent])).toEqual([
      ['continuing', 0, 50], ['ending', 50, 50],
      ['continuing', 0, 50], ['starting', 50, 50],
      ['continuing', 0, 100],
    ])
  })
  it('returns empty layout for no events', () => {
    const result = computeDayLayout([], DAY_START, DAY_END, SLOT_HEIGHT, SLOT_DURATION)
    expect(result.eventSegments).toEqual([])
    expect(result.overflowSegments).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Single event
// ---------------------------------------------------------------------------

describe('computeDayLayout - single event', () => {
  it('renders one event at full width', () => {
    const events = [makeEvent('a', 9, 10)]
    const result = computeDayLayout(events, DAY_START, DAY_END, SLOT_HEIGHT, SLOT_DURATION)

    expect(result.eventSegments).toHaveLength(1)
    expect(result.overflowSegments).toHaveLength(0)

    const seg = result.eventSegments[0]
    expect(seg.eventId).toBe('a')
    expect(seg.leftPercent).toBe(0)
    expect(seg.widthPercent).toBe(100)
    expect(seg.isFirstSegment).toBe(true)
  })

  it('computes correct top/height for a 1-hour event', () => {
    const events = [makeEvent('a', 9, 10)]
    const result = computeDayLayout(events, DAY_START, DAY_END, SLOT_HEIGHT, SLOT_DURATION)

    const totalHeight = 24 * SLOT_HEIGHT // 24 slots of 48px each
    const seg = result.eventSegments[0]
    // 9 hours into 24-hour day = 9/24 * totalHeight
    expect(seg.top).toBeCloseTo((9 / 24) * totalHeight, 1)
    // 1 hour out of 24 = 1/24 * totalHeight
    expect(seg.height).toBeCloseTo((1 / 24) * totalHeight, 1)
  })
})

// ---------------------------------------------------------------------------
// Two overlapping events
// ---------------------------------------------------------------------------

describe('computeDayLayout - two overlapping events', () => {
  it('splits two overlapping events 50/50', () => {
    const events = [
      makeEvent('a', 9, 11),
      makeEvent('b', 10, 12),
    ]
    const result = computeDayLayout(events, DAY_START, DAY_END, SLOT_HEIGHT, SLOT_DURATION)

    // During 10-11 overlap, both should be 50% width
    const overlapSegments = result.eventSegments.filter(
      s => s.top >= (10 / 24) * 24 * SLOT_HEIGHT - 1 && s.top <= (10 / 24) * 24 * SLOT_HEIGHT + 1
    )
    expect(overlapSegments).toHaveLength(2)
    for (const seg of overlapSegments) {
      expect(seg.widthPercent).toBe(50)
    }
  })

  it('gives full width to non-overlapping portions', () => {
    const events = [
      makeEvent('a', 9, 11),
      makeEvent('b', 10, 12),
    ]
    const result = computeDayLayout(events, DAY_START, DAY_END, SLOT_HEIGHT, SLOT_DURATION)

    // Event 'a' has a segment from 9-10 where it's alone (100% width)
    const aloneSeg = result.eventSegments.find(
      s => s.eventId === 'a' && s.widthPercent === 100
    )
    expect(aloneSeg).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Three overlapping events
// ---------------------------------------------------------------------------

describe('computeDayLayout - three overlapping events', () => {
  it('splits three overlapping events into 33% columns', () => {
    const events = [
      makeEvent('a', 9, 12),
      makeEvent('b', 9, 12),
      makeEvent('c', 9, 12),
    ]
    const result = computeDayLayout(events, DAY_START, DAY_END, SLOT_HEIGHT, SLOT_DURATION)

    // All should get ~33.33% width
    for (const seg of result.eventSegments) {
      expect(seg.widthPercent).toBeCloseTo(100 / 3, 1)
    }
    expect(result.overflowSegments).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Four+ overlapping events -- overflow
// ---------------------------------------------------------------------------

describe('computeDayLayout - overflow (4+ events)', () => {
  it('shows first 2 events + overflow for 4 overlapping events', () => {
    const events = [
      makeEvent('a', 9, 11),
      makeEvent('b', 9, 11),
      makeEvent('c', 9, 11),
      makeEvent('d', 9, 11),
    ]
    const result = computeDayLayout(events, DAY_START, DAY_END, SLOT_HEIGHT, SLOT_DURATION)

    // Should have 2 visible event segments + overflow
    const visibleIds = new Set(result.eventSegments.map(s => s.eventId))
    expect(visibleIds.size).toBe(2)

    expect(result.overflowSegments.length).toBeGreaterThan(0)
    expect(result.overflowSegments[0].count).toBe(2) // 4 - 2 = 2 overflow
  })

  it('overflow column is 1/3 width', () => {
    const events = [
      makeEvent('a', 9, 11),
      makeEvent('b', 9, 11),
      makeEvent('c', 9, 11),
      makeEvent('d', 9, 11),
    ]
    const result = computeDayLayout(events, DAY_START, DAY_END, SLOT_HEIGHT, SLOT_DURATION)

    for (const seg of result.overflowSegments) {
      expect(seg.widthPercent).toBeCloseTo(100 / 3, 1)
    }
  })
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('computeDayLayout - edge cases', () => {
  it('filters events outside the day range', () => {
    const events = [
      makeEvent('outside', 25, 26), // starts after day end
    ]
    const result = computeDayLayout(events, DAY_START, DAY_END, SLOT_HEIGHT, SLOT_DURATION)
    expect(result.eventSegments).toHaveLength(0)
  })

  it('clamps events that span across day boundaries', () => {
    // Event starts before day and ends mid-day
    const beforeDay = new Date(DAY_START - 2 * 60 * 60 * 1000).toISOString()
    const midDay = new Date(DAY_START + 6 * 60 * 60 * 1000).toISOString()
    const events: LayoutEvent[] = [
      { id: 'span', start_time: beforeDay, end_time: midDay },
    ]
    const result = computeDayLayout(events, DAY_START, DAY_END, SLOT_HEIGHT, SLOT_DURATION)

    expect(result.eventSegments.length).toBeGreaterThan(0)
    // First segment should start at top = 0 (clamped to day start)
    expect(result.eventSegments[0].top).toBe(0)
  })

  it('handles zero-duration events gracefully', () => {
    const events = [makeEvent('zero', 10, 10)]
    const result = computeDayLayout(events, DAY_START, DAY_END, SLOT_HEIGHT, SLOT_DURATION)
    // Zero-duration event should be filtered out
    expect(result.eventSegments).toHaveLength(0)
  })

  it('marks only the first segment of a multi-segment event as isFirstSegment', () => {
    // Two events overlap partially, creating multiple segments for event 'a'
    const events = [
      makeEvent('a', 9, 12),
      makeEvent('b', 10, 11),
    ]
    const result = computeDayLayout(events, DAY_START, DAY_END, SLOT_HEIGHT, SLOT_DURATION)

    const aSegments = result.eventSegments.filter(s => s.eventId === 'a')
    const firstSegments = aSegments.filter(s => s.isFirstSegment)
    expect(firstSegments).toHaveLength(1)
  })
})
