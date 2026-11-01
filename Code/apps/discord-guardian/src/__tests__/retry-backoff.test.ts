import { describe, expect, it, vi } from 'vitest'
import { RetryBackoff } from '../retry-backoff.js'

describe('RetryBackoff', () => {
  it('blocks retries until the first jittered delay has elapsed', () => {
    const backoff = new RetryBackoff({
      baseDelayMs: 5_000,
      maxDelayMs: 60_000,
      random: () => 0,
    })

    expect(backoff.canAttempt(1_000)).toBe(true)
    expect(backoff.recordFailure(1_000)).toBe(2_500)
    expect(backoff.canAttempt(3_499)).toBe(false)
    expect(backoff.canAttempt(3_500)).toBe(true)
  })

  it('increases delay but never exceeds the configured maximum', () => {
    const backoff = new RetryBackoff({
      baseDelayMs: 5_000,
      maxDelayMs: 60_000,
      random: () => 1,
    })

    expect(backoff.recordFailure(0)).toBe(5_000)
    expect(backoff.recordFailure(5_000)).toBe(10_000)
    expect(backoff.recordFailure(15_000)).toBe(20_000)
    expect(backoff.recordFailure(35_000)).toBe(40_000)
    expect(backoff.recordFailure(75_000)).toBe(60_000)
    expect(backoff.recordFailure(135_000)).toBe(60_000)
  })

  it('resets the delay after a successful operation', () => {
    const backoff = new RetryBackoff({
      baseDelayMs: 5_000,
      maxDelayMs: 60_000,
      random: () => 1,
    })

    backoff.recordFailure(0)
    backoff.recordFailure(5_000)
    backoff.recordSuccess()

    expect(backoff.canAttempt(10_000)).toBe(true)
    expect(backoff.recordFailure(10_000)).toBe(5_000)
  })

  it('shares a single in-flight operation across concurrent callers', async () => {
    let complete: ((succeeded: boolean) => void) | undefined
    const operation = vi.fn(() => new Promise<boolean>((resolve) => {
      complete = resolve
    }))
    const backoff = new RetryBackoff({ baseDelayMs: 5_000, maxDelayMs: 60_000 })

    const first = backoff.run(operation)
    const second = backoff.run(operation)
    complete?.(true)

    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(operation).toHaveBeenCalledTimes(1)
  })
})