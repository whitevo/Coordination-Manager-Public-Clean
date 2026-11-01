export interface RetryBackoffOptions {
  baseDelayMs: number
  maxDelayMs: number
  random?: () => number
}

/**
 * Gates retry attempts after transient failures while allowing immediate
 * recovery after the next successful operation.
 */
export class RetryBackoff {
  private failureCount = 0
  private nextAttemptAt = 0
  private inFlight: Promise<boolean> | null = null
  private readonly random: () => number

  constructor(private readonly options: RetryBackoffOptions) {
    this.random = options.random ?? Math.random
  }

  canAttempt(now = Date.now()): boolean {
    return now >= this.nextAttemptAt
  }

  recordSuccess(): void {
    this.failureCount = 0
    this.nextAttemptAt = 0
  }

  recordFailure(now = Date.now()): number {
    const exponentialDelay = Math.min(
      this.options.baseDelayMs * 2 ** this.failureCount,
      this.options.maxDelayMs,
    )
    const delayMs = Math.round(exponentialDelay * (0.5 + this.random() * 0.5))

    this.failureCount += 1
    this.nextAttemptAt = now + delayMs
    return delayMs
  }

  async run(operation: () => Promise<boolean>): Promise<boolean> {
    if (this.inFlight) return this.inFlight
    if (!this.canAttempt()) return false

    this.inFlight = operation()
      .then((succeeded) => {
        if (succeeded) {
          this.recordSuccess()
        } else {
          this.recordFailure()
        }
        return succeeded
      })
      .catch(() => {
        this.recordFailure()
        return false
      })
      .finally(() => {
        this.inFlight = null
      })

    return this.inFlight
  }
}