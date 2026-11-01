/**
 * Calendar Overlap Layout Algorithm
 *
 * Computes how overlapping events should be split into visual columns
 * within a single day column of a weekly calendar grid.
 *
 * Rules:
 * - 1 event: full width
 * - 2 events overlapping: 50/50 side-by-side
 * - 3 events overlapping: 33/33/33 side-by-side
 * - 4+ events overlapping: first 2 shown + "+N Meetings" overflow indicator
 *
 * Events are split into visual segments at each time boundary where
 * the overlap configuration changes. An event that is alone takes
 * full width, then narrows when another event overlaps, then expands
 * again when the overlap ends.
 */

// ─── Types ──────────────────────────────────────────────────

export type LayoutEvent = {
  id: string
  start_time: string
  end_time: string
}

/** A visual segment of an event within a day column */
export type EventSegment = {
  eventId: string
  /** Index into the original events array passed to computeDayLayout */
  eventIndex: number
  /** Top offset in px from the day column top */
  top: number
  /** Height in px */
  height: number
  /** Left position as percentage (0–100) */
  leftPercent: number
  /** Width as percentage (0–100) */
  widthPercent: number
  /** True for the topmost segment of this event (show title here) */
  isFirstSegment: boolean
}

/** A visual segment representing overflow ("+N Meetings") */
export type OverflowSegment = {
  /** Indices into the original events array for the overflow events */
  eventIndices: number[]
  top: number
  height: number
  leftPercent: number
  widthPercent: number
  /** Number of overflow events in this segment */
  count: number
}

export type DayLayout = {
  eventSegments: EventSegment[]
  overflowSegments: OverflowSegment[]
}

// ─── Algorithm ──────────────────────────────────────────────

/**
 * Compute the overlap layout for events on a single day.
 *
 * @param events       The events to lay out (must have id, start_time, end_time)
 * @param dayStartMs   Day start timestamp in ms (UTC midnight)
 * @param dayEndMs     Day end timestamp in ms (usually dayStartMs + 24h)
 * @param slotHeightPx Height of one time slot in pixels (e.g. 48)
 * @param slotDurationMs Duration of one time slot in ms (e.g. 3600000 for 1h)
 */
export function computeDayLayout(
  events: LayoutEvent[],
  dayStartMs: number,
  dayEndMs: number,
  slotHeightPx: number,
  slotDurationMs: number
): DayLayout {
  if (events.length === 0) {
    return { eventSegments: [], overflowSegments: [] }
  }

  const totalDayMs = dayEndMs - dayStartMs
  const totalHeightPx = (totalDayMs / slotDurationMs) * slotHeightPx

  // Clamp event times to day boundaries, preserve original index
  const clampedEvents = events
    .map((ev, idx) => ({
      idx,
      id: ev.id,
      start: Math.max(new Date(ev.start_time).getTime(), dayStartMs),
      end: Math.min(new Date(ev.end_time).getTime(), dayEndMs),
      originalStart: new Date(ev.start_time).getTime(),
    }))
    .filter(e => e.end > e.start) // skip zero/negative duration
    // Sort by start time, then longer events first (for stable column assignment)
    .sort((a, b) => a.originalStart - b.originalStart || (b.end - b.start) - (a.end - a.start))

  if (clampedEvents.length === 0) {
    return { eventSegments: [], overflowSegments: [] }
  }

  // Collect all time boundaries where overlap configuration changes
  const changePointsSet = new Set<number>()
  for (const ev of clampedEvents) {
    changePointsSet.add(ev.start)
    changePointsSet.add(ev.end)
  }
  const changePoints = Array.from(changePointsSet).sort((a, b) => a - b)

  const eventSegments: EventSegment[] = []
  const overflowSegments: OverflowSegment[] = []
  const seenEventIds = new Set<string>()
  const starts = new Map<number, number[]>()
  const ends = new Map<number, number[]>()
  for (let index = 0; index < clampedEvents.length; index++) {
    const event = clampedEvents[index]
    const starting = starts.get(event.start) ?? []
    starting.push(index)
    starts.set(event.start, starting)
    const ending = ends.get(event.end) ?? []
    ending.push(index)
    ends.set(event.end, ending)
  }
  // Indices retain the existing start/duration priority for visual columns.
  const activeIndices: number[] = []

  for (let i = 0; i < changePoints.length - 1; i++) {
    const intervalStart = changePoints[i]
    const intervalEnd = changePoints[i + 1]
    for (const index of ends.get(intervalStart) ?? []) {
      const position = activeIndices.indexOf(index)
      if (position !== -1) activeIndices.splice(position, 1)
    }
    for (const index of starts.get(intervalStart) ?? []) {
      let low = 0
      let high = activeIndices.length
      while (low < high) {
        const middle = (low + high) >>> 1
        if (activeIndices[middle] < index) low = middle + 1
        else high = middle
      }
      activeIndices.splice(low, 0, index)
    }
    if (intervalStart >= intervalEnd) continue

    const active = activeIndices.map(index => clampedEvents[index])
    if (active.length === 0) continue

    const top = ((intervalStart - dayStartMs) / totalDayMs) * totalHeightPx
    const height = ((intervalEnd - intervalStart) / totalDayMs) * totalHeightPx
    if (height < 0.5) continue // skip sub-pixel segments

    if (active.length <= 3) {
      // All events visible side-by-side
      const colWidth = 100 / active.length
      for (let j = 0; j < active.length; j++) {
        const isFirst = !seenEventIds.has(active[j].id)
        if (isFirst) seenEventIds.add(active[j].id)

        eventSegments.push({
          eventId: active[j].id,
          eventIndex: active[j].idx,
          top,
          height,
          leftPercent: j * colWidth,
          widthPercent: colWidth,
          isFirstSegment: isFirst,
        })
      }
    } else {
      // First 2 events + overflow indicator (3 columns)
      const colWidth = 100 / 3
      for (let j = 0; j < 2; j++) {
        const isFirst = !seenEventIds.has(active[j].id)
        if (isFirst) seenEventIds.add(active[j].id)

        eventSegments.push({
          eventId: active[j].id,
          eventIndex: active[j].idx,
          top,
          height,
          leftPercent: j * colWidth,
          widthPercent: colWidth,
          isFirstSegment: isFirst,
        })
      }

      // Mark overflow events as seen
      for (let j = 2; j < active.length; j++) {
        if (!seenEventIds.has(active[j].id)) seenEventIds.add(active[j].id)
      }

      overflowSegments.push({
        eventIndices: active.slice(2).map(e => e.idx),
        top,
        height,
        leftPercent: 2 * colWidth,
        widthPercent: colWidth,
        count: active.length - 2,
      })
    }
  }

  return { eventSegments, overflowSegments }
}
