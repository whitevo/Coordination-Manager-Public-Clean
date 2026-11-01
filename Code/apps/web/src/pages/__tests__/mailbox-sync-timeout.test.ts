import { describe, expect, it } from 'vitest'
import { syncRequestTimeoutMs } from '../mailbox-page-helpers'

describe('syncRequestTimeoutMs', () => {
  it('always outlasts the API sync timeout', () => {
    expect(syncRequestTimeoutMs(31)).toBe(130_000)
  })

  it('allows longer estimates to extend beyond the minimum', () => {
    expect(syncRequestTimeoutMs(90)).toBe(210_000)
  })
})