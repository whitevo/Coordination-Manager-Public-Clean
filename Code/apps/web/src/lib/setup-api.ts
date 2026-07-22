/**
 * Setup Wizard API client + status hook.
 *
 * Uses plain fetch (NOT apiClient) so we avoid the apiClient/supabase
 * interceptor chain -- the wizard must work even when supabase is not
 * configured.
 */
import { useEffect, useState, useCallback } from 'react'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

export type DeploymentMode = 'unconfigured' | 'explore' | 'selfhost' | 'cloud'

export type FeatureFlag = 'admin' | 'jwt' | 'google' | 'discord' | 'smtp' | 'captcha' | 'ai'

/** Features the operator can disable from the Setup page. */
export type DisableableFeature = 'discord-coord' | 'discord-guardian' | 'ai' | 'captcha'

export interface SetupStatus {
  mode: DeploymentMode
  setupCompleted: boolean
  isApiConfigured: boolean
  isSupabaseConfigured: boolean
  missing: { api: string[]; web: string[] }
  required: { api: string[]; web: string[] }
  probes?: {
    database?: {
      ok: boolean
      detail: string
    }
    discordCoordBot?: {
      ok: boolean
      detail: string
    }
    discordGuardianBot?: {
      ok: boolean
      detail: string
    }
    docs?: {
      ok: boolean
      detail: string
    }
  }
  /** Per-feature configured flags. False means the matching env keys are missing. */
  features?: Partial<Record<FeatureFlag, boolean>>
  /** Per-feature "disabled on this machine" flags. */
  disabled?: Partial<Record<DisableableFeature, boolean>>
  cloudApiUrl: string | null
  lastConfiguredAt: string | null
  environment: string
  isLocalhostRequest: boolean
  canConfigure: boolean
}

export interface ConfigurePayload {
  mode: 'explore' | 'selfhost' | 'cloud'
  apiEnv?: Record<string, string>
  webEnv?: Record<string, string>
  botEnv?: Record<string, string>
  guardianEnv?: Record<string, string>
  cloudApiUrl?: string
}

/** Local override for the setup token, captured from the API console banner. */
const SETUP_TOKEN_STORAGE_KEY = 'cm_setup_token'

export function getStoredSetupToken(): string {
  try {
    return localStorage.getItem(SETUP_TOKEN_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

export function storeSetupToken(token: string): void {
  try {
    if (token) localStorage.setItem(SETUP_TOKEN_STORAGE_KEY, token)
    else localStorage.removeItem(SETUP_TOKEN_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export async function fetchSetupStatus(): Promise<SetupStatus | null> {
  try {
    const res = await fetch(`${API_BASE}/api/setup/status`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    return (await res.json()) as SetupStatus
  } catch {
    // API may be down entirely -- treat as unknown/unconfigured
    return null
  }
}

export async function postConfigure(
  payload: ConfigurePayload,
  token: string
): Promise<{ ok: true; data: unknown } | { ok: false; error: string; statusCode: number }> {
  try {
    const res = await fetch(`${API_BASE}/api/setup/configure`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-setup-token': token,
      },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return {
        ok: false,
        error: data?.message || `HTTP ${res.status}`,
        statusCode: res.status,
      }
    }
    return { ok: true, data }
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'Network error', statusCode: 0 }
  }
}

/**
 * Toggle a feature's "disabled on this machine" flag. Same auth model as
 * postConfigure: requires the setup token, localhost-only on the API side.
 */
export async function postDisableFeature(
  feature: DisableableFeature,
  disabled: boolean,
  token: string,
): Promise<{ ok: true; data: { disabled: Record<DisableableFeature, boolean> } } | { ok: false; error: string; statusCode: number }> {
  try {
    const res = await fetch(`${API_BASE}/api/setup/disable`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-setup-token': token,
      },
      body: JSON.stringify({ feature, disabled }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: data?.message || `HTTP ${res.status}`, statusCode: res.status }
    }
    return { ok: true, data }
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'Network error', statusCode: 0 }
  }
}

/**
 * React hook: polls /api/setup/status once on mount and exposes the result.
 * Components can call `refresh()` after configure to re-fetch.
 */
export function useSetupStatus(): {
  status: SetupStatus | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
} {
  const setupAccessible = isSetupAccessible()
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [loading, setLoading] = useState(setupAccessible)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!isSetupAccessible()) {
      setStatus(null)
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const s = await fetchSetupStatus()
    if (!s) {
      setError('API unreachable')
      setStatus(null)
    } else {
      setStatus(s)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!setupAccessible) return
    refresh()
  }, [refresh, setupAccessible])

  return { status, loading, error, refresh }
}

/**
 * Convenience: true if the app should currently show the wizard takeover.
 * Rules:
 *  - Always show takeover when localhost AND (no status / api unconfigured)
 *  - Never show takeover in production
 */
/**
 * True only when the Setup page should be reachable in the running app.
 *
 * The Setup wizard is a local-development / self-hosting tool. It must NEVER
 * be exposed on the public production deployment (coordinationmanager.com),
 * because:
 *   - It advertises the existence of /api/setup/* endpoints
 *   - It leaks deployment topology (missing env keys, mode)
 *   - It tempts confused public users into a page that cannot do anything
 *     for them (configure is localhost+non-prod only on the API anyway)
 *
 * Allowed when:
 *   - Vite dev build (`import.meta.env.DEV`), regardless of host, OR
 *   - The browser is talking to a localhost / 127.0.0.1 frontend
 *     (covers self-hosted production builds running on a developer's machine)
 */
export function isSetupAccessible(): boolean {
  if (import.meta.env.DEV) return true
  if (typeof window === 'undefined') return false
  const h = window.location.hostname
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]'
}

export function shouldTakeOverHome(status: SetupStatus | null, statusError: string | null): boolean {
  // We only take over on localhost. In a hosted deployment, missing env is
  // a deployment problem, not a wizard prompt.
  const onLocalhost =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  if (!onLocalhost) return false
  // API down -> show takeover so user can see they need to set things up
  if (statusError) return true
  if (!status) return false
  if (status.environment === 'production') return false
  if (!status.isApiConfigured) return true
  if (status.missing.web.length > 0) return true
  return false
}
