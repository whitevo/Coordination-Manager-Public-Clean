export interface UserEventWindow {
  windowStart: string
  windowEnd: string
}

interface WindowEvent {
  start_time: string
  end_time: string
  recurrence_rule?: { type: string } | null
}

export function getWeekEventWindow(weekStart: Date): UserEventWindow {
  const start = Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate())
  return {
    windowStart: new Date(start).toISOString(),
    windowEnd: new Date(start + 7 * 24 * 60 * 60 * 1000).toISOString(),
  }
}

export function isEventInWindow(event: WindowEvent, window: UserEventWindow): boolean {
  const start = Date.parse(event.start_time)
  return start < Date.parse(window.windowEnd)
    && (Date.parse(event.end_time) > Date.parse(window.windowStart)
      || Boolean(event.recurrence_rule && event.recurrence_rule.type !== 'none'))
}
