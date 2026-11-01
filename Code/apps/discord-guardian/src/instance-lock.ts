import { randomUUID } from 'crypto'
import { hostname as osHostname } from 'os'
import { supabase } from './supabase.js'
import { RetryBackoff } from './retry-backoff.js'

// ─── Config ───────────────────────────────────────────────────────────

/** How often this instance refreshes its lease (ms). */
const HEARTBEAT_INTERVAL_MS = 10_000

/**
 * How long a lease may go without a heartbeat before another instance is
 * allowed to steal it. Must be >> HEARTBEAT_INTERVAL_MS to tolerate brief
 * network or DB hiccups.
 */
const STALE_AFTER_MS = 30_000

/** Unique identifier for THIS process. Regenerated on every restart. */
export const INSTANCE_ID = randomUUID()

/**
 * Human-readable label for ops visibility. Falls back to host name so
 * production logs are still identifiable when the env var is unset.
 */
export const INSTANCE_LABEL =
  process.env.GUARDIAN_INSTANCE_LABEL?.trim() || safeHostname()

/**
 * When true, this instance forcibly takes the lease at startup even if a
 * fresh one is held by another process. Intended for local development
 * ("I want my local code to handle events while production stays idle").
 */
const FORCE_TAKEOVER =
  (process.env.GUARDIAN_FORCE_TAKEOVER || '').toLowerCase() === 'true'

// ─── State ────────────────────────────────────────────────────────────

let leaderState = false
let lastTransitionLog: 'leader' | 'follower' | null = null
let heartbeatTimer: NodeJS.Timeout | null = null
let tickInProgress = false
const retryBackoff = new RetryBackoff({ baseDelayMs: 5_000, maxDelayMs: 60_000 })

/** Returns true if this process currently holds the lease. */
export function isLeader(): boolean {
  return leaderState
}

// ─── Helpers ──────────────────────────────────────────────────────────

function safeHostname(): string {
  try {
    return osHostname() || 'unknown-host'
  } catch {
    return 'unknown-host'
  }
}

function logTransition(state: 'leader' | 'follower', detail: string): void {
  if (lastTransitionLog === state) return
  lastTransitionLog = state
  const tag = state === 'leader' ? '[lock] ACQUIRED' : '[lock] released'
  console.log(`${tag} instance=${INSTANCE_LABEL} (${INSTANCE_ID}) -- ${detail}`)
}

// ─── Acquire / Renew ──────────────────────────────────────────────────

/**
 * Attempt to acquire or renew the singleton lease.
 * Returns true if this process owns the lease after the call.
 */
async function acquireOrRenew(): Promise<boolean> {
  const nowIso = new Date().toISOString()
  const staleThresholdIso = new Date(Date.now() - STALE_AFTER_MS).toISOString()

  // Fast path: we already hold the lease -- just bump heartbeat_at.
  if (leaderState) {
    const { data, error } = await supabase
      .from('guardian_instance_lock')
      .update({ heartbeat_at: nowIso })
      .eq('id', 'singleton')
      .eq('instance_id', INSTANCE_ID)
      .select('instance_id')

    if (error) {
      console.error('[lock] heartbeat failed:', error.message)
      retryBackoff.recordFailure()
      // Don't drop leadership on a transient DB error; retry next tick.
      return true
    }
    retryBackoff.recordSuccess()
    if (!data || data.length === 0) {
      // Someone else has taken over (force takeover from another instance).
      return false
    }
    return true
  }

  // Slow path: we are a follower. Try to take the lease if missing, stale,
  // or if FORCE_TAKEOVER is set.
  const { data: existing, error: readError } = await supabase
    .from('guardian_instance_lock')
    .select('instance_id, instance_label, heartbeat_at')
    .eq('id', 'singleton')
    .maybeSingle()

  if (readError) {
    console.error('[lock] read failed:', readError.message)
    retryBackoff.recordFailure()
    return false
  }
  retryBackoff.recordSuccess()

  // No row yet -- try to insert one for ourselves.
  if (!existing) {
    const { error: insertError } = await supabase
      .from('guardian_instance_lock')
      .insert({
        id: 'singleton',
        instance_id: INSTANCE_ID,
        instance_label: INSTANCE_LABEL,
        acquired_at: nowIso,
        heartbeat_at: nowIso,
      })
    if (insertError) {
      // Likely a race with another instance inserting first; fall through
      // to the update-takeover path on the next tick.
      retryBackoff.recordFailure()
      return false
    }
    retryBackoff.recordSuccess()
    return true
  }

  // Decide whether we're allowed to steal the lease.
  const heartbeatAgeMs = Date.now() - new Date(existing.heartbeat_at).getTime()
  const isStale = heartbeatAgeMs >= STALE_AFTER_MS
  const canTakeover = FORCE_TAKEOVER || isStale

  if (!canTakeover) {
    return false
  }

  // Conditional UPDATE: only succeed if the row still looks the way we read
  // it (same instance_id). This prevents two followers stealing at once.
  const { data: updated, error: updateError } = await supabase
    .from('guardian_instance_lock')
    .update({
      instance_id: INSTANCE_ID,
      instance_label: INSTANCE_LABEL,
      acquired_at: nowIso,
      heartbeat_at: nowIso,
    })
    .eq('id', 'singleton')
    .eq('instance_id', existing.instance_id)
    .select('instance_id')

  if (updateError) {
    console.error('[lock] takeover failed:', updateError.message)
    retryBackoff.recordFailure()
    return false
  }
  retryBackoff.recordSuccess()

  if (!updated || updated.length === 0) {
    // Lost the race to another follower; will retry next tick.
    return false
  }

  const reason = FORCE_TAKEOVER ? 'GUARDIAN_FORCE_TAKEOVER=true' : `previous lease stale (${Math.round(heartbeatAgeMs / 1000)}s)`
  console.log(
    `[lock] took over from instance=${existing.instance_label || 'unknown'} (${existing.instance_id}) -- ${reason}`,
  )
  return true
}

// ─── Lifecycle ────────────────────────────────────────────────────────

/**
 * Start the heartbeat loop. Call once at boot, after Supabase is ready.
 * Resolves once the initial acquire attempt completes (so callers can log
 * the starting role) but the loop continues in the background.
 */
export async function startInstanceLock(): Promise<void> {
  console.log(
    `[lock] starting instance=${INSTANCE_LABEL} (${INSTANCE_ID})` +
      (FORCE_TAKEOVER ? ' [FORCE_TAKEOVER]' : ''),
  )

  await tick()

  if (heartbeatTimer) clearInterval(heartbeatTimer)
  heartbeatTimer = setInterval(tick, HEARTBEAT_INTERVAL_MS)
  // Don't keep the event loop alive solely for the heartbeat.
  if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref()
}

async function tick(): Promise<void> {
  if (tickInProgress || !retryBackoff.canAttempt()) return
  tickInProgress = true
  try {
    const nowLeader = await acquireOrRenew()
    const wasLeader = leaderState
    leaderState = nowLeader

    if (nowLeader) {
      logTransition(
        'leader',
        wasLeader ? 'lease renewed' : 'lease acquired -- processing events',
      )
    } else if (wasLeader) {
      logTransition('follower', 'lease lost -- ignoring events until reacquired')
    } else {
      // Still a follower; log once on first tick so operators can see it.
      logTransition('follower', 'standing by -- another instance holds the lease')
    }
  } catch (err) {
    console.error('[lock] tick failed:', err)
    retryBackoff.recordFailure()
  } finally {
    tickInProgress = false
  }
}

/**
 * Best-effort release on graceful shutdown so a sibling instance can take
 * over immediately instead of waiting for the stale window.
 */
export async function releaseInstanceLock(): Promise<void> {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  if (!leaderState) return
  try {
    // Backdate heartbeat so any follower sees it as stale immediately.
    await supabase
      .from('guardian_instance_lock')
      .update({ heartbeat_at: new Date(0).toISOString() })
      .eq('id', 'singleton')
      .eq('instance_id', INSTANCE_ID)
  } catch (err) {
    console.error('[lock] release failed:', err)
  }
  leaderState = false
}
