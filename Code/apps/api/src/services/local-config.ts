/**
 * Local configuration service for the Setup Wizard.
 *
 * Responsibilities:
 * 1. Read/write a runtime config file at `Code/apps/api/config.local.json`.
 *    This holds the deployment mode and wizard state (NOT secrets).
 * 2. Read/write `.env` files for `apps/api` and `apps/web` from the wizard
 *    (whitelisted keys only, atomic writes, preserves existing comments).
 * 3. Generate / verify a one-time setup token that gates the configure
 *    endpoint -- printed to the server console when the API boots in an
 *    unconfigured state, similar to Jupyter notebook's security model.
 *
 * SECURITY:
 *  - Configure endpoint MUST refuse if NODE_ENV === 'production'.
 *  - Configure endpoint MUST refuse if the connection is not from localhost.
 *  - Only whitelisted env keys can be written.
 *  - The setup token is regenerated on every API restart and is required
 *    on every configure call.
 */

import { promises as fs } from 'fs'
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { randomBytes } from 'crypto'
import { getSupabaseSecretKeyName, getSupabaseServerKey, SUPABASE_SERVER_KEY_NAMES } from './supabase-key.js'

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

// __dirname is `Code/apps/api/dist/services` after build or `Code/apps/api/src/services` in dev (tsx).
// We resolve relative to the api package root.
function apiRoot(): string {
  // Walk up until we find a package.json with name "@coordination-manager/api"
  // Cheap heuristic: process.cwd() when running via pnpm is `Code/apps/api`.
  return process.cwd()
}

function repoCodeRoot(): string {
  // From Code/apps/api → Code
  return path.resolve(apiRoot(), '..', '..')
}

const CONFIG_FILE = () => path.join(apiRoot(), 'config.local.json')
const API_ENV_FILE = () => path.join(apiRoot(), '.env')
const WEB_ENV_FILE = () => path.join(repoCodeRoot(), 'apps', 'web', '.env')
const BOT_ENV_FILE = () => path.join(repoCodeRoot(), 'apps', 'discord-bot', '.env')
const GUARDIAN_ENV_FILE = () => path.join(repoCodeRoot(), 'apps', 'discord-guardian', '.env')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DeploymentMode = 'unconfigured' | 'explore' | 'selfhost' | 'cloud'

/**
 * Features that the operator can explicitly disable from the Setup page.
 * Disabling is local-only (stored in config.local.json) and is meant for
 * the dev-machine "avoid conflicts with prod" scenario -- e.g. when the
 * production Discord bot is online and you do not want a second instance
 * logging in from your laptop. It also lets you keep optional features
 * configured (keys present) but inert.
 */
export type DisableableFeature = 'discord-coord' | 'discord-guardian' | 'ai' | 'captcha'

export const DISABLEABLE_FEATURES: DisableableFeature[] = [
  'discord-coord',
  'discord-guardian',
  'ai',
  'captcha',
]

export interface LocalConfig {
  setupCompleted: boolean
  mode: DeploymentMode
  /** When mode = 'cloud', the remote API base URL the web app talks to. */
  cloudApiUrl?: string
  /** ISO timestamp of last wizard completion. */
  lastConfiguredAt?: string
  /** Free-form runtime flags the wizard may toggle later. */
  flags?: Record<string, boolean | string | number>
  /** Per-feature "disabled on this machine" flags. */
  disabledFeatures?: Partial<Record<DisableableFeature, boolean>>
}

const DEFAULT_CONFIG: LocalConfig = {
  setupCompleted: false,
  mode: 'unconfigured',
}

// ---------------------------------------------------------------------------
// config.local.json read / write
// ---------------------------------------------------------------------------

let _cached: LocalConfig | null = null

export async function readLocalConfig(): Promise<LocalConfig> {
  if (_cached) return _cached
  try {
    const raw = await fs.readFile(CONFIG_FILE(), 'utf8')
    const parsed = JSON.parse(raw)
    _cached = { ...DEFAULT_CONFIG, ...parsed }
    return _cached!
  } catch {
    _cached = { ...DEFAULT_CONFIG }
    return _cached
  }
}

export async function writeLocalConfig(patch: Partial<LocalConfig>): Promise<LocalConfig> {
  const current = await readLocalConfig()
  const next: LocalConfig = { ...current, ...patch }
  const tmp = CONFIG_FILE() + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8')
  await fs.rename(tmp, CONFIG_FILE())
  _cached = next
  return next
}

// ---------------------------------------------------------------------------
// Required env detection
// ---------------------------------------------------------------------------

/**
 * Keys the API needs to be functional at all (DB connectivity).
 * If any of these are missing, the app is "unconfigured".
 */
export const REQUIRED_API_KEYS = ['SUPABASE_URL', 'SUPABASE_KEY'] as const

/**
 * Keys the web app needs at build/serve time.
 */
export const REQUIRED_WEB_KEYS = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const

/**
 * Optional keys grouped by feature -- presented in the wizard as feature toggles.
 */
export const OPTIONAL_FEATURE_KEYS = {
  get admin() { return [getSupabaseSecretKeyName()] },
  jwt: ['JWT_SECRET'],
  google: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  discord: ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID'],
  smtp: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_ENCRYPTION_KEY'],
  captcha: ['TURNSTILE_SECRET_KEY'],
  ai: ['AI_API_KEY'],
} as const

/**
 * Full whitelist of env keys the wizard is allowed to write.
 * Anything not in this list is rejected -- this prevents the wizard from
 * being used to inject arbitrary env vars (e.g. PATH, LD_PRELOAD).
 */
export const WRITABLE_API_ENV_KEYS = new Set<string>([
  ...REQUIRED_API_KEYS,
  ...Object.values(OPTIONAL_FEATURE_KEYS).flat(),
  ...SUPABASE_SERVER_KEY_NAMES,
  'PORT',
  'FRONTEND_URL',
  'NODE_ENV',
  'BOT_API_SECRET',
])

export const WRITABLE_WEB_ENV_KEYS = new Set<string>([
  ...REQUIRED_WEB_KEYS,
  'VITE_API_URL',
  'VITE_TURNSTILE_SITE_KEY',
  'VITE_DISCORD_CLIENT_ID',
])

/**
 * Keys the Setup wizard is allowed to write into the Coordination bot's
 * own .env (apps/discord-bot/.env). Each Discord bot is a separate Node
 * process that loads its own .env via dotenv.config() from its package cwd,
 * so the wizard must edit those files directly -- writing to apps/api/.env
 * would have no effect on the running bot.
 */
export const WRITABLE_BOT_ENV_KEYS = new Set<string>([
  'DISCORD_BOT_TOKEN',
  'DISCORD_CLIENT_ID',
  'BOT_API_SECRET',
  'BOT_API_PORT',
  'API_URL',
  'FRONTEND_URL',
  'SUPABASE_URL',
  ...SUPABASE_SERVER_KEY_NAMES,
])

/**
 * Keys the Setup wizard is allowed to write into the Guardian bot's
 * own .env (apps/discord-guardian/.env). Guardian only needs the Discord
 * bot token and a shared Supabase connection.
 */
export const WRITABLE_GUARDIAN_ENV_KEYS = new Set<string>([
  'DISCORD_BOT_TOKEN',
  'DISCORD_CLIENT_ID',
  'SUPABASE_URL',
  ...SUPABASE_SERVER_KEY_NAMES,
  'GUARDIAN_FORCE_TAKEOVER',
  'GUARDIAN_INSTANCE_LABEL',
  'DISABLE_BOT',
])

const PLACEHOLDER_EXACT_VALUES = new Set<string>([
  'placeholder',
  'placeholders',
  'changeme',
  'change-me',
  'change_me',
  'replace-me',
  'replace_me',
  'replace-this',
  'replace_this',
  'replace',
  'todo',
  'tbd',
  'example',
  'sample',
  'dummy',
  'test',
  'null',
  'undefined',
  'none',
  'n/a',
  'na',
  'xxx',
  '***',
])

function looksLikePlaceholder(raw: string): boolean {
  const value = raw.trim()
  if (!value) return true
  const normalized = value.toLowerCase()
  if (PLACEHOLDER_EXACT_VALUES.has(normalized)) return true
  if (/\bplaceholder\b/i.test(value)) return true
  if (/\b(change|replace)\s?(me|this)\b/i.test(value)) return true
  if (/^<(your|project|insert|add|value|secret|token|key|id|url)[^>]*>$/i.test(value)) return true
  if (/^\{\{[^}]+\}\}$/.test(value)) return true
  if (/^(your|my)[_-]?(key|token|secret|id|url|client|password)/i.test(normalized)) return true
  if (/^(sk-|pk-)?x{6,}$/i.test(value)) return true
  return false
}

export function isMeaningfulEnvValue(key: string, value: string | undefined | null): boolean {
  if (!value) return false
  const trimmed = value.trim()
  if (!trimmed) return false
  if (looksLikePlaceholder(trimmed)) return false

  if (key === 'SUPABASE_URL') {
    if (!/^https:\/\//i.test(trimmed)) return false
    if (/project-ref|your-project|example/i.test(trimmed)) return false
  }

  return true
}

export function getRequiredEnvStatus(): {
  apiMissing: string[]
  webMissing: string[]
  isApiConfigured: boolean
} {
  // For the API, check process.env (already loaded by dotenv in supabaseClient.ts).
  const apiMissing = REQUIRED_API_KEYS.filter(k => !isMeaningfulEnvValue(k, process.env[k])).slice()
  // For the web, parse its .env file directly -- we can't read import.meta.env here.
  const webEnv = parseDotenvSync(WEB_ENV_FILE())
  const webMissing = REQUIRED_WEB_KEYS.filter(k => {
    return !isMeaningfulEnvValue(k, webEnv[k]) && !isMeaningfulEnvValue(k, process.env[k])
  }).slice()
  return {
    apiMissing,
    webMissing,
    isApiConfigured: apiMissing.length === 0,
  }
}

/**
 * For each optional feature group in OPTIONAL_FEATURE_KEYS, return whether ALL
 * of its required keys are present somewhere they will actually be loaded by
 * the process that needs them.
 *
 * Special case: "discord" runs as a separate Node process (apps/discord-bot)
 * with its own .env file. Checking only the API's process.env would always
 * report it as missing even when the bot is fully configured, so we also
 * parse apps/discord-bot/.env. This is what the operator sees as "connected"
 * in the Setup wizard and removes the spurious "Discord disabled" banner.
 *
 * Used by GET /api/setup/status so the frontend can show a "feature disabled"
 * banner pointing users at the Setup page instead of producing a hard error.
 */
export function getOptionalFeatureStatus(): Record<keyof typeof OPTIONAL_FEATURE_KEYS, boolean> {
  const out = {} as Record<keyof typeof OPTIONAL_FEATURE_KEYS, boolean>
  const botEnv = parseDotenvSync(BOT_ENV_FILE())
  for (const [feature, keys] of Object.entries(OPTIONAL_FEATURE_KEYS) as Array<
    [keyof typeof OPTIONAL_FEATURE_KEYS, readonly string[]]
  >) {
    if (feature === 'admin') {
      const { name, value } = getSupabaseServerKey()
      out[feature] = isMeaningfulEnvValue(name, value)
    } else if (feature === 'discord') {
      // Bot process loads its own .env; consider Discord configured if either
      // the API env (mirrored) OR the bot's own .env has the required keys.
      out[feature] = keys.every(k => isMeaningfulEnvValue(k, process.env[k]) || isMeaningfulEnvValue(k, botEnv[k]))
    } else {
      out[feature] = keys.every(k => isMeaningfulEnvValue(k, process.env[k]))
    }
  }
  return out
}

/**
 * Return the per-feature disabled map from config.local.json. Defaults to
 * all false. Uses a synchronous cached read to keep callers (including
 * isCaptchaRequired) simple.
 */
export function getDisabledFeatures(): Record<DisableableFeature, boolean> {
  const out: Record<DisableableFeature, boolean> = {
    'discord-coord': false,
    'discord-guardian': false,
    ai: false,
    captcha: false,
  }
  try {
    const raw = readFileSync(CONFIG_FILE(), 'utf8')
    const parsed = JSON.parse(raw) as LocalConfig
    const flags = parsed.disabledFeatures ?? {}
    for (const f of DISABLEABLE_FEATURES) {
      if (flags[f] === true) out[f] = true
    }
  } catch {
    /* config file not yet present -- everything enabled by default */
  }
  return out
}

/**
 * Persist a single feature's disabled flag and mirror it to the relevant
 * .env file so the dependent process can self-skip on startup.
 *
 * Discord coord / guardian: writes `DISABLE_BOT=true|false` to the bot's
 * own .env (both bot processes already short-circuit on DISABLE_BOT=true).
 */
export async function setFeatureDisabled(
  feature: DisableableFeature,
  disabled: boolean,
): Promise<Record<DisableableFeature, boolean>> {
  const current = await readLocalConfig()
  const nextFlags: Partial<Record<DisableableFeature, boolean>> = {
    ...(current.disabledFeatures ?? {}),
    [feature]: disabled,
  }
  await writeLocalConfig({ disabledFeatures: nextFlags })

  if (feature === 'discord-coord') {
    await updateEnvFile(BOT_ENV_FILE(), { DISABLE_BOT: disabled ? 'true' : 'false' })
  } else if (feature === 'discord-guardian') {
    await updateEnvFile(GUARDIAN_ENV_FILE(), { DISABLE_BOT: disabled ? 'true' : 'false' })
  }

  return getDisabledFeatures()
}

// ---------------------------------------------------------------------------
// .env file read / write (whitelisted, comment-preserving, atomic)
// ---------------------------------------------------------------------------

function parseDotenvSync(file: string): Record<string, string> {
  if (!existsSync(file)) return {}
  try {
    const text = readFileSync(file, 'utf8')
    return parseDotenv(text)
  } catch {
    return {}
  }
}

function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    // Strip surrounding quotes (single or double)
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key) out[key] = value
  }
  return out
}

/**
 * Update specific keys in a .env file, preserving comments and existing key
 * order. New keys are appended at the end. Writes atomically via .tmp+rename.
 *
 * `whitelist` MUST be enforced by the caller -- this function trusts its input.
 */
async function updateEnvFile(file: string, updates: Record<string, string>): Promise<void> {
  let existing: string
  try {
    existing = await fs.readFile(file, 'utf8')
  } catch {
    existing = ''
  }

  const lines = existing.length ? existing.split(/\r?\n/) : []
  const seen = new Set<string>()
  const out: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      out.push(line)
      continue
    }
    const eq = trimmed.indexOf('=')
    if (eq === -1) {
      out.push(line)
      continue
    }
    const key = trimmed.slice(0, eq).trim()
    if (key in updates) {
      out.push(`${key}=${quoteIfNeeded(updates[key])}`)
      seen.add(key)
    } else {
      out.push(line)
    }
  }

  // Append any new keys not present in the original file
  const newKeys = Object.keys(updates).filter(k => !seen.has(k))
  if (newKeys.length) {
    if (out.length && out[out.length - 1].trim() !== '') out.push('')
    out.push('# --- added by Setup Wizard ---')
    for (const k of newKeys) {
      out.push(`${k}=${quoteIfNeeded(updates[k])}`)
    }
  }

  const tmp = file + '.tmp'
  await fs.writeFile(tmp, out.join('\n').replace(/\n+$/, '') + '\n', 'utf8')
  await fs.rename(tmp, file)
}

function quoteIfNeeded(value: string): string {
  // Quote if value contains whitespace, '#', or quotes
  if (/[\s#"']/.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`
  }
  return value
}

export async function writeApiEnv(updates: Record<string, string>): Promise<void> {
  const filtered: Record<string, string> = {}
  for (const [k, v] of Object.entries(updates)) {
    if (!WRITABLE_API_ENV_KEYS.has(k)) {
      throw new Error(`API env key not allowed: ${k}`)
    }
    if (typeof v !== 'string') {
      throw new Error(`API env value for ${k} must be a string`)
    }
    if (v.includes('\n') || v.includes('\r')) {
      throw new Error(`API env value for ${k} must not contain newlines`)
    }
    filtered[k] = v
  }
  await updateEnvFile(API_ENV_FILE(), filtered)
  // Also reflect into process.env so the running process picks it up where possible
  // (note: many modules cache their config at import time; a restart is still needed
  // for full effect, but at least new requests see the values).
  for (const [k, v] of Object.entries(filtered)) {
    process.env[k] = v
  }
}

export async function writeWebEnv(updates: Record<string, string>): Promise<void> {
  const filtered: Record<string, string> = {}
  for (const [k, v] of Object.entries(updates)) {
    if (!WRITABLE_WEB_ENV_KEYS.has(k)) {
      throw new Error(`Web env key not allowed: ${k}`)
    }
    if (typeof v !== 'string') {
      throw new Error(`Web env value for ${k} must be a string`)
    }
    if (v.includes('\n') || v.includes('\r')) {
      throw new Error(`Web env value for ${k} must not contain newlines`)
    }
    filtered[k] = v
  }
  await updateEnvFile(WEB_ENV_FILE(), filtered)
}

/**
 * Generic per-app .env writer with whitelist enforcement and newline
 * rejection. Shared between writeBotEnv and writeGuardianEnv.
 */
async function writeWhitelistedEnvFile(
  file: string,
  whitelist: Set<string>,
  label: string,
  updates: Record<string, string>,
): Promise<void> {
  const filtered: Record<string, string> = {}
  for (const [k, v] of Object.entries(updates)) {
    if (!whitelist.has(k)) {
      throw new Error(`${label} env key not allowed: ${k}`)
    }
    if (typeof v !== 'string') {
      throw new Error(`${label} env value for ${k} must be a string`)
    }
    if (v.includes('\n') || v.includes('\r')) {
      throw new Error(`${label} env value for ${k} must not contain newlines`)
    }
    filtered[k] = v
  }
  await updateEnvFile(file, filtered)
}

export async function writeBotEnv(updates: Record<string, string>): Promise<void> {
  await writeWhitelistedEnvFile(BOT_ENV_FILE(), WRITABLE_BOT_ENV_KEYS, 'Bot', updates)
}

export async function writeGuardianEnv(updates: Record<string, string>): Promise<void> {
  await writeWhitelistedEnvFile(GUARDIAN_ENV_FILE(), WRITABLE_GUARDIAN_ENV_KEYS, 'Guardian', updates)
}

// ---------------------------------------------------------------------------
// Masked snapshot for the Setup UI
// ---------------------------------------------------------------------------

// Keys whose values are NOT considered secret -- shown in full.
const NON_SECRET_KEYS = new Set<string>([
  'SUPABASE_URL', 'VITE_SUPABASE_URL', 'GOOGLE_CLIENT_ID', 'VITE_GOOGLE_CLIENT_ID',
  'GOOGLE_REDIRECT_URI', 'GOOGLE_CALENDAR_REDIRECT_URI',
  'DISCORD_CLIENT_ID', 'VITE_DISCORD_CLIENT_ID', 'GUARDIAN_CLIENT_ID',
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER',
  'PORT', 'NODE_ENV', 'FRONTEND_URL',
  'VITE_API_URL', 'VITE_TURNSTILE_SITE_KEY',
  'BOT_API_URL', 'AI_PROVIDER', 'AI_MODEL', 'AI_BASE_URL',
  'ASI_BASE_URL', 'ASI_MODEL',
  'ZOOM_CLIENT_ID', 'ZOOM_REDIRECT_URI',
])

function maskValue(key: string, value: string): string {
  if (!value) return ''
  if (NON_SECRET_KEYS.has(key)) return value
  if (value.length <= 12) return '***'
  return `${value.slice(0, 4)}\u2026${value.slice(-4)}`
}

export interface MaskedEnvEntry {
  set: boolean
  masked: string
  isSecret: boolean
  /** True when the value exists but appears to be placeholder/template text. */
  isPlaceholder?: boolean
  /**
   * Effective runtime value the app is actually using when this env var is
   * unset. Only populated for non-secret deployment defaults so the Setup
   * wizard can show the real running URL/port on a fresh clone instead of
   * just "(not set)". Never populated for secrets.
   */
  runtime?: string
}

/**
 * Code-level defaults that the API / web fall back to when the matching env
 * var is not set. Must mirror the hardcoded fallbacks in:
 *  - apps/api/src/index.ts        (PORT, FRONTEND_URL)
 *  - apps/web/src/pages/SetupPage (VITE_API_URL)
 * Used by getMaskedEnvSnapshot to populate `runtime` so the Setup wizard
 * can display the actual running values on a fresh clone.
 */
const API_RUNTIME_DEFAULTS: Record<string, string> = {
  NODE_ENV: 'development',
  PORT: '3001',
  FRONTEND_URL: 'http://localhost:5173',
}
const WEB_RUNTIME_DEFAULTS: Record<string, string> = {
  VITE_API_URL: 'http://localhost:3001',
}

/**
 * Snapshot of all whitelisted env keys with masked values. Safe to send to
 * the Setup UI when the caller has presented a valid setup token over
 * localhost in a non-production environment.
 */
export function getMaskedEnvSnapshot(): {
  api: Record<string, MaskedEnvEntry>
  web: Record<string, MaskedEnvEntry>
  bot: Record<string, MaskedEnvEntry>
  guardian: Record<string, MaskedEnvEntry>
} {
  const api: Record<string, MaskedEnvEntry> = {}
  for (const key of WRITABLE_API_ENV_KEYS) {
    const raw = process.env[key] ?? ''
    const isPlaceholder = Boolean(raw) && !isMeaningfulEnvValue(key, raw)
    const entry: MaskedEnvEntry = {
      set: Boolean(raw),
      masked: raw ? maskValue(key, raw) : '',
      isSecret: !NON_SECRET_KEYS.has(key),
      isPlaceholder,
    }
    if (!raw && API_RUNTIME_DEFAULTS[key]) entry.runtime = API_RUNTIME_DEFAULTS[key]
    api[key] = entry
  }
  const web: Record<string, MaskedEnvEntry> = {}
  const webEnv = parseDotenvSync(WEB_ENV_FILE())
  for (const key of WRITABLE_WEB_ENV_KEYS) {
    const raw = webEnv[key] ?? process.env[key] ?? ''
    const isPlaceholder = Boolean(raw) && !isMeaningfulEnvValue(key, raw)
    const entry: MaskedEnvEntry = {
      set: Boolean(raw),
      masked: raw ? maskValue(key, raw) : '',
      isSecret: !NON_SECRET_KEYS.has(key),
      isPlaceholder,
    }
    if (!raw && WEB_RUNTIME_DEFAULTS[key]) entry.runtime = WEB_RUNTIME_DEFAULTS[key]
    web[key] = entry
  }
  // Bot / Guardian envs live in their own files and are not loaded into the
  // API process, so we parse the files directly. This is read-only and
  // already gated to localhost + non-production by the caller.
  const bot: Record<string, MaskedEnvEntry> = {}
  const botEnv = parseDotenvSync(BOT_ENV_FILE())
  for (const key of WRITABLE_BOT_ENV_KEYS) {
    const raw = botEnv[key] ?? ''
    bot[key] = {
      set: Boolean(raw),
      masked: raw ? maskValue(key, raw) : '',
      isSecret: !NON_SECRET_KEYS.has(key),
      isPlaceholder: Boolean(raw) && !isMeaningfulEnvValue(key, raw),
    }
  }
  const guardian: Record<string, MaskedEnvEntry> = {}
  const guardianEnv = parseDotenvSync(GUARDIAN_ENV_FILE())
  for (const key of WRITABLE_GUARDIAN_ENV_KEYS) {
    const raw = guardianEnv[key] ?? ''
    guardian[key] = {
      set: Boolean(raw),
      masked: raw ? maskValue(key, raw) : '',
      isSecret: !NON_SECRET_KEYS.has(key),
      isPlaceholder: Boolean(raw) && !isMeaningfulEnvValue(key, raw),
    }
  }
  return { api, web, bot, guardian }
}

// ---------------------------------------------------------------------------
// Setup token (Jupyter-style one-time security)
// ---------------------------------------------------------------------------

let _setupToken: string | null = null

/**
 * Get the current setup token, generating one if needed. The token is held
 * in memory only -- it changes on every server restart.
 */
export function getSetupToken(): string {
  if (!_setupToken) {
    _setupToken = randomBytes(24).toString('hex')
  }
  return _setupToken
}

/**
 * Print the setup token to the console. Called once at server startup when
 * the app is detected as unconfigured.
 */
export function printSetupBanner(): void {
  const token = getSetupToken()
  const status = getRequiredEnvStatus()
  console.log('')
  console.log('============================================================')
  console.log(' Coordination Manager -- SETUP REQUIRED')
  console.log('============================================================')
  if (status.apiMissing.length) {
    console.log(` Missing API env vars: ${status.apiMissing.join(', ')}`)
  }
  if (status.webMissing.length) {
    console.log(` Missing Web env vars: ${status.webMissing.join(', ')}`)
  }
  console.log('')
  console.log(' Open http://localhost:5173/setup in your browser.')
  console.log(' When prompted for a setup token, paste:')
  console.log('')
  console.log(`   ${token}`)
  console.log('')
  console.log(' (Token is shown once per server start. Keep it private.)')
  console.log('============================================================')
  console.log('')
}

/**
 * Constant-time token compare.
 */
export function verifySetupToken(provided: unknown): boolean {
  if (typeof provided !== 'string') return false
  const expected = getSetupToken()
  if (provided.length !== expected.length) return false
  let mismatch = 0
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ provided.charCodeAt(i)
  }
  return mismatch === 0
}

// ---------------------------------------------------------------------------
// Localhost gate (defence-in-depth for the configure endpoint)
// ---------------------------------------------------------------------------

export function isLocalhostRequest(req: { socket?: { remoteAddress?: string | null } }): boolean {
  const addr = req.socket?.remoteAddress ?? ''
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}
