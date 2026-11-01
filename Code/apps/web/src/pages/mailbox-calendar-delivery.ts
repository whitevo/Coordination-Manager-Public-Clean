export const CALENDAR_DELIVERY_RETRY_OFFSETS_MS = [
  10_000,
  30_000,
  60_000,
  120_000,
  180_000,
] as const
const CALENDAR_DELIVERY_RETRY_WINDOW_MS = 180_000

export type CalendarDeliveryStatus = 'pending' | 'sending' | 'retrying' | 'succeeded' | 'failed'

export interface CalendarDeliveryTarget {
  id: string
  label: string
  status: CalendarDeliveryStatus
  attempts: number
  error?: string
  retryAt?: number
}

export interface CalendarDeliveryNotice {
  id: string
  title: string
  invitationId: string
  invitationIdentity: string
  targets: CalendarDeliveryTarget[]
  successVisible: boolean
  successExpiresAt: number | null
  failureDismissed: boolean
  invitationStatus: 'pending' | 'saving' | 'saved' | 'failed'
  invitationStatusWarningDismissed: boolean
  invitationStatusError?: string
}

export class CalendarDeliveryError extends Error {
  readonly retryable: boolean

  constructor(message: string, retryable: boolean) {
    super(message)
    this.name = 'CalendarDeliveryError'
    this.retryable = retryable
  }
}

export function getCalendarDeliveryRetryDelay(
  startedAt: number,
  retryIndex: number,
  now: number = Date.now()
): number | null {
  const retryOffset = CALENDAR_DELIVERY_RETRY_OFFSETS_MS[retryIndex]
  if (retryOffset === undefined) return null

  const retryAt = startedAt + retryOffset
  if (now >= startedAt + CALENDAR_DELIVERY_RETRY_WINDOW_MS) return null
  return Math.max(0, retryAt - now)
}

export function isRetryableCalendarDeliveryError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const candidate = error as {
    retryable?: unknown
    response?: { status?: unknown }
    status?: unknown
    code?: unknown
    name?: unknown
  }
  if (typeof candidate.retryable === 'boolean') return candidate.retryable

  const status =
    typeof candidate.response?.status === 'number'
      ? candidate.response.status
      : typeof candidate.status === 'number'
        ? candidate.status
        : null
  if (status !== null) return status === 408 || status === 429 || status >= 500

  return (
    candidate.name === 'TypeError' ||
    candidate.code === 'ERR_NETWORK' ||
    candidate.code === 'ECONNABORTED' ||
    candidate.code === 'ETIMEDOUT' ||
    candidate.code === 'ECONNRESET'
  )
}
