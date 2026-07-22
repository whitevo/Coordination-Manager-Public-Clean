/**
 * Live health probes for Setup page components.
 *
 * Browser-side liveness checks are limited by CORS. We do what we can:
 *   - API: HEAD/GET /health (always reachable from browser)
 *   - Database, JWT, Google, Discord, SMTP, AI, Captcha:
 *       derived from `status.features` (env-present) since true backend
 *       liveness checks would need new dedicated endpoints.
 *
 * The shape is intentionally extensible -- as we add backend probe endpoints
 * (e.g. /api/setup/probe/discord) we can return 'live' with latency.
 */
import { useEffect, useState, useCallback } from 'react'
import type { SetupStatus, FeatureFlag } from './setup-api'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

export type HealthState = 'unknown' | 'live' | 'configured' | 'off' | 'down'

export interface ComponentHealth {
  state: HealthState
  /** Optional human note: latency, error code, etc. */
  detail?: string
  /** Epoch ms of last successful check. */
  checkedAt?: number
}

export type HealthMap = Partial<Record<string, ComponentHealth>>

/** Map of component id -> health. Keys mirror COMPONENTS[].id in SetupPage. */
const FEATURE_BY_ID: Partial<Record<string, FeatureFlag>> = {
  jwt: 'jwt',
  google: 'google',
  smtp: 'smtp',
  captcha: 'captcha',
  ai: 'ai',
}

async function probeApi(): Promise<ComponentHealth> {
  const t0 = Date.now()
  try {
    const res = await fetch(`${API_BASE}/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    const dt = Date.now() - t0
    if (!res.ok) return { state: 'down', detail: `HTTP ${res.status}` }
    return { state: 'live', detail: `${dt} ms`, checkedAt: Date.now() }
  } catch (err) {
    return { state: 'down', detail: (err as Error).message }
  }
}

export function useComponentHealth(status: SetupStatus | null): {
  health: HealthMap
  loading: boolean
  refresh: () => Promise<void>
} {
  const [health, setHealth] = useState<HealthMap>({})
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    const next: HealthMap = {}
    next.api = await probeApi()

    const dbProbe = status?.probes?.database
    if (!status?.isApiConfigured) {
      next.database = { state: 'off' }
    } else if (dbProbe?.ok) {
      next.database = {
        state: 'live',
        detail: dbProbe.detail || 'probe ok',
        checkedAt: Date.now(),
      }
    } else if (dbProbe && !dbProbe.ok) {
      next.database = {
        state: 'down',
        detail: dbProbe.detail || 'probe failed',
        checkedAt: Date.now(),
      }
    } else {
      next.database = { state: 'configured', detail: 'env present', checkedAt: Date.now() }
    }

    next.deployment = { state: 'configured', detail: 'inferred from running app' }

    for (const [id, flag] of Object.entries(FEATURE_BY_ID)) {
      if (!flag) continue
      const on = Boolean(status?.features?.[flag])
      next[id] = on
        ? { state: 'configured', detail: 'env present', checkedAt: Date.now() }
        : { state: 'off' }
    }

    const coordDisabled = Boolean(status?.disabled?.['discord-coord'])
    const guardianDisabled = Boolean(status?.disabled?.['discord-guardian'])
    const coordProbe = status?.probes?.discordCoordBot
    const guardianProbe = status?.probes?.discordGuardianBot
    const docsProbe = status?.probes?.docs

    if (coordDisabled) {
      next['discord-coord'] = { state: 'off', detail: 'disabled on this machine', checkedAt: Date.now() }
    } else if (coordProbe?.ok) {
      next['discord-coord'] = { state: 'live', detail: coordProbe.detail, checkedAt: Date.now() }
    } else if (coordProbe && !coordProbe.ok) {
      next['discord-coord'] = { state: 'off', detail: coordProbe.detail, checkedAt: Date.now() }
    } else {
      next['discord-coord'] = status?.features?.discord
        ? { state: 'configured', detail: 'env present', checkedAt: Date.now() }
        : { state: 'off' }
    }

    if (guardianDisabled) {
      next['discord-guardian'] = { state: 'off', detail: 'disabled on this machine', checkedAt: Date.now() }
    } else if (guardianProbe?.ok) {
      next['discord-guardian'] = { state: 'live', detail: guardianProbe.detail, checkedAt: Date.now() }
    } else if (guardianProbe && !guardianProbe.ok) {
      next['discord-guardian'] = { state: 'off', detail: guardianProbe.detail, checkedAt: Date.now() }
    } else {
      next['discord-guardian'] = { state: 'configured', detail: 'set in guardian .env', checkedAt: Date.now() }
    }

    if (docsProbe?.ok) {
      next.docs = { state: 'live', detail: docsProbe.detail, checkedAt: Date.now() }
    } else if (docsProbe && !docsProbe.ok) {
      next.docs = { state: 'off', detail: docsProbe.detail, checkedAt: Date.now() }
    } else {
      next.docs = { state: 'off', detail: 'no docs probe data', checkedAt: Date.now() }
    }

    setHealth(next)
    setLoading(false)
  }, [status])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { health, loading, refresh }
}
