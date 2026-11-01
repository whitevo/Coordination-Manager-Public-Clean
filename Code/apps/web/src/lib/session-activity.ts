// Tracks last-activity time in localStorage (shared across tabs) so a
// persistent login can still be force-expired after a period of disuse,
// instead of staying valid indefinitely until explicit logout.

const ACTIVITY_KEY = 'cm-last-activity-at'
const INACTIVITY_LIMIT_MS = 14 * 24 * 60 * 60 * 1000 // 14 days
const RECORD_THROTTLE_MS = 60_000

let lastRecordedAt = 0

/** Record that the session is actively being used right now. Throttled to avoid excessive storage writes. */
export function recordActivity(): void {
  const now = Date.now()
  if (now - lastRecordedAt < RECORD_THROTTLE_MS) return
  lastRecordedAt = now
  try {
    localStorage.setItem(ACTIVITY_KEY, String(now))
  } catch {
    // ignore storage errors
  }
}

/** True once more than INACTIVITY_LIMIT_MS has passed since the last recorded activity. */
export function hasExceededInactivityLimit(): boolean {
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY)
    if (!raw) return false
    const lastActivityAt = Number(raw)
    if (!Number.isFinite(lastActivityAt)) return false
    return Date.now() - lastActivityAt > INACTIVITY_LIMIT_MS
  } catch {
    return false
  }
}

export function clearActivity(): void {
  lastRecordedAt = 0
  try {
    localStorage.removeItem(ACTIVITY_KEY)
  } catch {
    // ignore storage errors
  }
}
