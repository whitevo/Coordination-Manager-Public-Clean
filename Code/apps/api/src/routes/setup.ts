/**
 * Setup Wizard API routes
 *
 * GET  /api/setup/status        Public.  Returns current config state, mode,
 *                               and which env keys are missing. Never returns
 *                               actual secret values.
 *
 * GET  /api/setup/feature-keys  Public.  Returns the static list of optional
 *                               feature toggles and their required env keys.
 *                               Lets the wizard render feature cards.
 *
 * POST /api/setup/configure     Localhost + dev only. Requires setup token
 *                               (x-setup-token header). Body:
 *                                 {
 *                                   mode: 'selfhost'|'cloud'|'explore',
 *                                   apiEnv?: { [k]: string },
 *                                   webEnv?: { [k]: string },
 *                                   cloudApiUrl?: string,
 *                                 }
 *                               Writes whitelisted keys to .env files and
 *                               updates config.local.json. Returns the new
 *                               status block.
 *
 * SECURITY notes
 *  - configure refuses when NODE_ENV === 'production'
 *  - configure refuses when the request is not from localhost (uses
 *    req.socket.remoteAddress -- NOT req.ip -- so X-Forwarded-For cannot spoof)
 *  - configure refuses without a valid setup token (constant-time compare)
 *  - All env writes go through a whitelist; unknown keys are rejected
 *  - Setup token is regenerated on every server restart
 */

import { Router, Request, Response, NextFunction } from 'express'
import { promises as fs } from 'fs'
import path from 'path'
import net from 'net'
import { ValidationError, UnauthorizedError, ApplicationError } from '../middleware/error-handler.js'
import { sanitizeString } from '../middleware/validation.js'
import { isSupabaseConfigured } from '../supabaseClient.js'
import {
  readLocalConfig,
  writeLocalConfig,
  getRequiredEnvStatus,
  getOptionalFeatureStatus,
  getDisabledFeatures,
  setFeatureDisabled,
  DISABLEABLE_FEATURES,
  getMaskedEnvSnapshot,
  OPTIONAL_FEATURE_KEYS,
  REQUIRED_API_KEYS,
  REQUIRED_WEB_KEYS,
  WRITABLE_API_ENV_KEYS,
  WRITABLE_WEB_ENV_KEYS,
  WRITABLE_BOT_ENV_KEYS,
  WRITABLE_GUARDIAN_ENV_KEYS,
  writeApiEnv,
  writeWebEnv,
  writeBotEnv,
  writeGuardianEnv,
  verifySetupToken,
  isLocalhostRequest,
  DeploymentMode,
  isMeaningfulEnvValue,
  type DisableableFeature,
} from '../services/local-config.js'

const router: Router = Router()

function repoRootFromApiCwd(): string {
  // Expected cwd in dev is Code/apps/api. Move up to repository root.
  return path.resolve(process.cwd(), '..', '..', '..')
}

function stateFilePath(): string {
  return path.join(repoRootFromApiCwd(), '.cm-dev-state.json')
}

async function getServiceState(name: string): Promise<{ declared: boolean; launcherPid: number | null }> {
  try {
    const raw = await fs.readFile(stateFilePath(), 'utf8')
    const parsed = JSON.parse(raw) as {
      services?: Array<{ name?: string; launcherPid?: number }>
    }
    const svc = parsed.services?.find(s => s?.name === name)
    if (!svc) return { declared: false, launcherPid: null }
    const pid = typeof svc.launcherPid === 'number' ? svc.launcherPid : null
    return { declared: true, launcherPid: pid }
  } catch {
    return { declared: false, launcherPid: null }
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function isTcpPortListening(port: number, timeoutMs = 700): Promise<boolean> {
  return await new Promise(resolve => {
    const socket = new net.Socket()
    let done = false

    const finish = (ok: boolean) => {
      if (done) return
      done = true
      socket.destroy()
      resolve(ok)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, '127.0.0.1')
  })
}

async function probeCoordinationBot(): Promise<{ ok: boolean; detail: string }> {
  const port = Number(process.env.BOT_API_PORT || '3002')
  const service = await getServiceState('bot')
  const portListening = await isTcpPortListening(port)

  if (service.declared && service.launcherPid && isProcessAlive(service.launcherPid) && portListening) {
    return { ok: true, detail: `running (port ${port})` }
  }
  if (portListening) {
    return { ok: true, detail: `running on port ${port}` }
  }
  if (service.declared) {
    return { ok: false, detail: `not running (expected on port ${port})` }
  }
  return { ok: false, detail: 'not launched in current local stack' }
}

async function probeGuardianBot(): Promise<{ ok: boolean; detail: string }> {
  const service = await getServiceState('guardian')
  if (!service.declared) {
    return { ok: false, detail: 'not launched in current local stack' }
  }
  if (!service.launcherPid) {
    return { ok: false, detail: 'launched but no process id recorded' }
  }
  if (isProcessAlive(service.launcherPid)) {
    return { ok: true, detail: `running (PID ${service.launcherPid})` }
  }
  return { ok: false, detail: 'not running (launcher exited)' }
}

async function probeDocsSite(): Promise<{ ok: boolean; detail: string }> {
  const service = await getServiceState('docs')
  const docsCandidates = ['http://localhost:5174', 'http://127.0.0.1:5174']

  let docsReachable = false
  let reachableUrl = ''
  for (const docsUrl of docsCandidates) {
    try {
      const res = await fetch(docsUrl, { method: 'GET' })
      if (res.ok) {
        docsReachable = true
        reachableUrl = docsUrl
        break
      }
    } catch {
      // Try next candidate.
    }
  }

  if (service.declared && service.launcherPid && isProcessAlive(service.launcherPid) && docsReachable) {
    return { ok: true, detail: `running (${reachableUrl || 'http://localhost:5174'})` }
  }
  if (docsReachable) {
    return { ok: true, detail: `running (${reachableUrl || 'http://localhost:5174'})` }
  }
  if (service.declared) {
    return { ok: false, detail: 'not running (expected at http://localhost:5174)' }
  }
  return { ok: false, detail: 'not launched in current local stack' }
}

async function probeSupabaseConnection(): Promise<{ ok: boolean; detail: string }> {
  const url = process.env.SUPABASE_URL?.trim() || ''
  const anonKey = process.env.SUPABASE_KEY?.trim() || ''
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || ''
  const key = isMeaningfulEnvValue('SUPABASE_SERVICE_ROLE_KEY', serviceRoleKey)
    ? serviceRoleKey
    : anonKey

  if (!isMeaningfulEnvValue('SUPABASE_URL', url)) {
    return { ok: false, detail: 'missing or placeholder SUPABASE_URL' }
  }
  if (!isMeaningfulEnvValue('SUPABASE_KEY', key)) {
    return { ok: false, detail: 'missing or placeholder Supabase key' }
  }

  // auth/v1/settings is a lightweight endpoint that validates host + API key
  // without depending on a specific table or RLS policy.
  const endpoint = `${url.replace(/\/$/, '')}/auth/v1/settings`
  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        apikey: key,
      },
    })
    if (res.ok) return { ok: true, detail: `HTTP ${res.status}` }
    return { ok: false, detail: `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, detail: (err as Error).message }
  }
}

/**
 * Block all /api/setup/* endpoints in production. The setup wizard is a
 * localhost / self-hosting tool and must never expose deployment topology
 * (missing env keys, mode, feature flags) on the public production API.
 * Returning 404 (not 401/403) avoids advertising that the endpoints exist.
 */
router.use((_req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Not found', statusCode: 404 })
  }
  next()
})

// ---------------------------------------------------------------------------
// GET /api/setup/status
// ---------------------------------------------------------------------------
router.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const localConfig = await readLocalConfig()
    const env = getRequiredEnvStatus()
    const [databaseProbe, coordBotProbe, guardianBotProbe, docsProbe] = await Promise.all([
      probeSupabaseConnection(),
      probeCoordinationBot(),
      probeGuardianBot(),
      probeDocsSite(),
    ])

    // Derive the effective mode. The wizard may have written one; otherwise
    // we infer from env presence.
    let effectiveMode: DeploymentMode = localConfig.mode
    if (effectiveMode === 'unconfigured' && env.isApiConfigured) {
      effectiveMode = 'selfhost'
    }

    res.json({
      mode: effectiveMode,
      setupCompleted: Boolean(localConfig.setupCompleted),
      isApiConfigured: env.isApiConfigured,
      isSupabaseConfigured: isSupabaseConfigured(),
      missing: {
        api: env.apiMissing,
        web: env.webMissing,
      },
      required: {
        api: [...REQUIRED_API_KEYS],
        web: [...REQUIRED_WEB_KEYS],
      },
      probes: {
        database: databaseProbe,
        discordCoordBot: coordBotProbe,
        discordGuardianBot: guardianBotProbe,
        docs: docsProbe,
      },
      // Per-feature configured flags. Frontend uses these to render
      // "feature disabled, configure in Setup" banners instead of letting
      // calls fail with confusing network errors.
      features: getOptionalFeatureStatus(),
      // Per-feature "disabled on this machine" flags written by the Setup
      // page. Disabled features stay configured but inert -- used to avoid
      // local/prod conflicts (e.g. two Discord bot instances).
      disabled: getDisabledFeatures(),
      cloudApiUrl: localConfig.cloudApiUrl ?? null,
      lastConfiguredAt: localConfig.lastConfiguredAt ?? null,
      environment: process.env.NODE_ENV ?? 'development',
      // Helpful hints for the wizard UI
      isLocalhostRequest: isLocalhostRequest(_req),
      canConfigure: process.env.NODE_ENV !== 'production' && isLocalhostRequest(_req),
    })
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// GET /api/setup/feature-keys
// ---------------------------------------------------------------------------
router.get('/feature-keys', (_req: Request, res: Response) => {
  res.json({
    requiredApi: [...REQUIRED_API_KEYS],
    requiredWeb: [...REQUIRED_WEB_KEYS],
    features: OPTIONAL_FEATURE_KEYS,
    writable: {
      api: Array.from(WRITABLE_API_ENV_KEYS),
      web: Array.from(WRITABLE_WEB_ENV_KEYS),
    },
  })
})

// ---------------------------------------------------------------------------
// GET /api/setup/values
// Returns the current env values with secret keys masked. Read access is
// gated to localhost + non-production. Reads do NOT require the setup token
// because being on localhost already means you can read the .env files; the
// token only protects writes against drive-by browser tab requests.
// ---------------------------------------------------------------------------
router.get('/values', (req: Request, res: Response, next: NextFunction) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      throw new UnauthorizedError('Setup values endpoint is disabled in production')
    }
    if (!isLocalhostRequest(req)) {
      throw new UnauthorizedError('Setup values endpoint is localhost-only')
    }
    res.json(getMaskedEnvSnapshot())
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// POST /api/setup/production-summary
// Localhost-only helper used by the Setup production tab. It proxies a
// request to a public Coordination Manager deployment using a cm_agent_* key,
// so the browser never needs direct cross-origin access.
// ---------------------------------------------------------------------------
router.post('/production-summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      throw new UnauthorizedError('Setup production-summary endpoint is disabled in production')
    }
    if (!isLocalhostRequest(req)) {
      throw new UnauthorizedError('Setup production-summary endpoint is localhost-only')
    }

    const apiBaseRaw = sanitizeString(req.body?.apiBaseUrl, 300)
    const apiKey = sanitizeString(req.body?.apiKey, 300)
    if (!apiBaseRaw) throw new ValidationError('apiBaseUrl is required')
    if (!apiKey) throw new ValidationError('apiKey is required')
    if (!apiKey.startsWith('cm_agent_')) {
      throw new ValidationError('apiKey must start with cm_agent_')
    }

    let parsed: URL
    try {
      parsed = new URL(apiBaseRaw)
    } catch {
      throw new ValidationError('apiBaseUrl must be a valid URL')
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new ValidationError('apiBaseUrl must start with http:// or https://')
    }

    const base = `${parsed.origin}${parsed.pathname}`.replace(/\/$/, '')
    const upstream = await fetch(`${base}/api/agent/setup/summary`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    })

    const payloadText = await upstream.text()
    const contentType = upstream.headers.get('content-type') || ''
    let payload: unknown = null
    try {
      payload = payloadText ? JSON.parse(payloadText) : null
    } catch {
      payload = null
    }

    if (!upstream.ok) {
      const message =
        typeof payload === 'object' && payload && 'message' in payload && typeof (payload as { message?: unknown }).message === 'string'
          ? (payload as { message: string }).message
          : `Upstream returned HTTP ${upstream.status}`
      return res.status(upstream.status).json({
        error: 'UPSTREAM_ERROR',
        message,
        statusCode: upstream.status,
      })
    }

    if (!payload || typeof payload !== 'object') {
      const snippet = payloadText
        ? payloadText.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 140)
        : ''
      const htmlHint = contentType.includes('text/html') || /^<!doctype html>/i.test(payloadText.trim())
      const hint = htmlHint
        ? 'The base URL is serving frontend HTML for /api/*, not the API backend. Use the public API host directly (or configure reverse proxy for /api to backend).'
        : 'Ensure the target deployment exposes /api/agent/setup/summary and returns JSON.'
      return res.status(502).json({
        error: 'UPSTREAM_INVALID_RESPONSE',
        message: `Upstream returned non-JSON setup summary (content-type: ${contentType || 'unknown'}). ${hint}`,
        snippet: snippet || undefined,
        statusCode: 502,
      })
    }

    return res.json(payload)
  } catch (err) {
    if (err instanceof ApplicationError) return next(err)
    return next(new ApplicationError((err as Error).message || 'Failed to fetch production summary', 502, 'PRODUCTION_SUMMARY_FAILED'))
  }
})

// ---------------------------------------------------------------------------
// POST /api/setup/configure
// ---------------------------------------------------------------------------
router.post('/configure', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // GATE 1: never allow in production
    if (process.env.NODE_ENV === 'production') {
      throw new UnauthorizedError('Setup wizard is disabled in production')
    }
    // GATE 2: localhost-only (socket address, not req.ip)
    if (!isLocalhostRequest(req)) {
      throw new UnauthorizedError('Setup wizard can only be configured from localhost')
    }
    // GATE 3: setup token
    const token = req.header('x-setup-token')
    if (!verifySetupToken(token)) {
      throw new UnauthorizedError('Invalid or missing x-setup-token header')
    }

    const body = req.body ?? {}
    const mode = body.mode as DeploymentMode
    if (!mode || !['explore', 'selfhost', 'cloud'].includes(mode)) {
      throw new ValidationError('mode must be one of: explore, selfhost, cloud')
    }

    // Validate optional env payloads
    const apiEnv: Record<string, string> = body.apiEnv && typeof body.apiEnv === 'object' ? body.apiEnv : {}
    const webEnv: Record<string, string> = body.webEnv && typeof body.webEnv === 'object' ? body.webEnv : {}
    const botEnv: Record<string, string> = body.botEnv && typeof body.botEnv === 'object' ? body.botEnv : {}
    const guardianEnv: Record<string, string> = body.guardianEnv && typeof body.guardianEnv === 'object' ? body.guardianEnv : {}

    for (const k of Object.keys(apiEnv)) {
      if (!WRITABLE_API_ENV_KEYS.has(k)) {
        throw new ValidationError(`API env key not allowed: ${k}`)
      }
    }
    for (const k of Object.keys(webEnv)) {
      if (!WRITABLE_WEB_ENV_KEYS.has(k)) {
        throw new ValidationError(`Web env key not allowed: ${k}`)
      }
    }
    for (const k of Object.keys(botEnv)) {
      if (!WRITABLE_BOT_ENV_KEYS.has(k)) {
        throw new ValidationError(`Bot env key not allowed: ${k}`)
      }
    }
    for (const k of Object.keys(guardianEnv)) {
      if (!WRITABLE_GUARDIAN_ENV_KEYS.has(k)) {
        throw new ValidationError(`Guardian env key not allowed: ${k}`)
      }
    }

    // Mode-specific minimum requirements
    if (mode === 'selfhost') {
      // Must end up with all REQUIRED_API_KEYS present (either already in env or in payload)
      const missingAfter = REQUIRED_API_KEYS.filter(k => !process.env[k] && !apiEnv[k])
      if (missingAfter.length) {
        throw new ValidationError(`selfhost mode requires: ${missingAfter.join(', ')}`)
      }
    }
    if (mode === 'cloud') {
      const cloudApiUrl = typeof body.cloudApiUrl === 'string' ? body.cloudApiUrl.trim() : ''
      if (!/^https?:\/\/[^\s]+$/.test(cloudApiUrl)) {
        throw new ValidationError('cloud mode requires a valid cloudApiUrl (http(s)://...)')
      }
      // Mirror into web env so the browser knows where to call
      webEnv['VITE_API_URL'] = cloudApiUrl
    }

    // Apply env writes (atomic per file)
    if (Object.keys(apiEnv).length) await writeApiEnv(apiEnv)
    if (Object.keys(webEnv).length) await writeWebEnv(webEnv)
    if (Object.keys(botEnv).length) await writeBotEnv(botEnv)
    if (Object.keys(guardianEnv).length) await writeGuardianEnv(guardianEnv)

    // Update local config
    const next = await writeLocalConfig({
      mode,
      setupCompleted: true,
      cloudApiUrl: mode === 'cloud' ? body.cloudApiUrl : undefined,
      lastConfiguredAt: new Date().toISOString(),
    })

    const envStatus = getRequiredEnvStatus()
    res.json({
      success: true,
      mode: next.mode,
      setupCompleted: next.setupCompleted,
      cloudApiUrl: next.cloudApiUrl ?? null,
      isApiConfigured: envStatus.isApiConfigured,
      restartRequired: true,
      message:
        'Configuration saved. A server + Vite dev-server restart is recommended so all modules pick up the new env values.',
    })
  } catch (err) {
    if (err instanceof ApplicationError) return next(err)
    next(new ApplicationError((err as Error).message || 'Setup failed', 500, 'SETUP_FAILED'))
  }
})

// ---------------------------------------------------------------------------
// POST /api/setup/disable
// Toggle a feature's "disabled on this machine" flag. Same security gates as
// /configure: production-blocked, localhost-only, requires setup token.
// ---------------------------------------------------------------------------
router.post('/disable', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      throw new UnauthorizedError('Setup wizard is disabled in production')
    }
    if (!isLocalhostRequest(req)) {
      throw new UnauthorizedError('Setup wizard can only be configured from localhost')
    }
    const token = req.header('x-setup-token')
    if (!verifySetupToken(token)) {
      throw new UnauthorizedError('Invalid or missing x-setup-token header')
    }

    const body = req.body ?? {}
    const feature = body.feature as DisableableFeature
    if (!feature || !DISABLEABLE_FEATURES.includes(feature)) {
      throw new ValidationError(
        `feature must be one of: ${DISABLEABLE_FEATURES.join(', ')}`,
      )
    }
    if (typeof body.disabled !== 'boolean') {
      throw new ValidationError('disabled must be a boolean')
    }

    const disabledMap = await setFeatureDisabled(feature, body.disabled)
    res.json({ success: true, disabled: disabledMap })
  } catch (err) {
    if (err instanceof ApplicationError) return next(err)
    next(new ApplicationError((err as Error).message || 'Disable toggle failed', 500, 'SETUP_DISABLE_FAILED'))
  }
})

export default router
