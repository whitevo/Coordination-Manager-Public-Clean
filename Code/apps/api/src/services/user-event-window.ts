import { ValidationError } from '../middleware/error-handler.js'

export interface UserEventWindow {
  windowStart: string
  windowEnd: string
}

export function parseUserEventWindow(start: unknown, end: unknown): UserEventWindow | null {
  if (start === undefined && end === undefined) return null
  const isTimestamp = (value: unknown): value is string =>
    typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z')
  if (!isTimestamp(start) || !isTimestamp(end)) {
    throw new ValidationError('windowStart and windowEnd must both be valid UTC ISO timestamps')
  }
  const duration = Date.parse(end) - Date.parse(start)
  if (duration <= 0 || duration > 35 * 24 * 60 * 60 * 1000) {
    throw new ValidationError('Event windows must be positive and no longer than 35 days')
  }
  return { windowStart: new Date(start).toISOString(), windowEnd: new Date(end).toISOString() }
}
