import { describe, expect, it } from 'vitest'
import { getMailboxPullStep } from '../mailbox-pull-slider'

describe('getMailboxPullStep', () => {
  it('increases the step when the pointer is near the track edge', () => {
    expect(getMailboxPullStep(80, 10)).toBeGreaterThan(getMailboxPullStep(80, 60))
  })

  it('applies a larger step when the pointer is beyond the track end', () => {
    expect(getMailboxPullStep(80, 0)).toBeGreaterThan(getMailboxPullStep(80, 40))
  })

  it('keeps the step at zero for small pulls', () => {
    expect(getMailboxPullStep(4, 80)).toBe(0)
  })
})
