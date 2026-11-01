import { describe, expect, it } from 'vitest'
import {
  CALENDAR_DELIVERY_RETRY_OFFSETS_MS,
  getCalendarDeliveryRetryDelay,
  isRetryableCalendarDeliveryError,
} from '../mailbox-calendar-delivery'

describe('Mailbox calendar delivery retries', () => {
  it('uses the approved retry points within a three-minute window', () => {
    const startedAt = 1_000
    expect(CALENDAR_DELIVERY_RETRY_OFFSETS_MS).toEqual([
      10_000,
      30_000,
      60_000,
      120_000,
      180_000,
    ])
    expect(getCalendarDeliveryRetryDelay(startedAt, 0, startedAt)).toBe(10_000)
    expect(getCalendarDeliveryRetryDelay(startedAt, 1, startedAt + 10_000)).toBe(20_000)
    expect(getCalendarDeliveryRetryDelay(startedAt, 4, startedAt + 120_000)).toBe(60_000)
    expect(getCalendarDeliveryRetryDelay(startedAt, 5, startedAt + 180_000)).toBeNull()
    expect(getCalendarDeliveryRetryDelay(startedAt, 4, startedAt + 180_000)).toBeNull()
  })

  it('retries only transient provider and transport failures', () => {
    expect(isRetryableCalendarDeliveryError({ response: { status: 429 } })).toBe(true)
    expect(isRetryableCalendarDeliveryError({ response: { status: 503 } })).toBe(true)
    expect(isRetryableCalendarDeliveryError({ response: { status: 401 } })).toBe(false)
    expect(isRetryableCalendarDeliveryError({ retryable: true })).toBe(true)
    expect(isRetryableCalendarDeliveryError({ retryable: false, response: { status: 503 } })).toBe(false)
    expect(isRetryableCalendarDeliveryError({ code: 'ERR_NETWORK' })).toBe(true)
    expect(isRetryableCalendarDeliveryError(new TypeError('fetch failed'))).toBe(true)
    expect(isRetryableCalendarDeliveryError(new Error('Invalid event'))).toBe(false)
  })
})
