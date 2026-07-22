/**
 * Setup page (/setup) -- unified per-component view with mode segmented control.
 *
 * Each component (Database, Auth, Discord, SMTP, ...) is shown as a card with
 * a segmented mode selector ([Off] [Self-host]). The current mode is
 * highlighted; clicking another mode reveals its edit form or, for Off, clears
 * the keys.
 *
 * Top of the page has a Local dev / Production view toggle that changes the
 * hints/placeholders for deployment-sensitive fields (FRONTEND_URL, VITE_API_URL,
 * NODE_ENV, PORT). The actual writes always go to your local .env files; copy
 * them to your host of choice on deploy.
 *
 * The setup token is NOT required to view values. It is only needed when
 * saving, and only on localhost in development. We prompt for it inline on
 * the first 401 from POST /configure and cache it in localStorage.
 */
import {
  useState, useMemo, useEffect, useCallback, useRef, type FormEvent, type ReactNode,
} from 'react'
import { useLocation } from 'react-router-dom'
import {
  Database, KeyRound, Bot, ShieldCheck, Sparkles, Server,
  AlertCircle, CheckCircle2, Circle, Edit3, X, Loader2, Eye, EyeOff, Info,
  ChevronDown, ChevronRight, Copy, Check, RefreshCw,
} from 'lucide-react'
import { useSetup } from '../contexts/SetupContext'
import {
  postConfigure,
  postDisableFeature,
  getStoredSetupToken,
  storeSetupToken,
  type ConfigurePayload,
  type DisableableFeature,
} from '../lib/setup-api'
import { useComponentHealth, type ComponentHealth } from '../lib/setup-health'
import {
  useViewOverrides,
  TEMPLATE_DEFAULTS,
  type OverridesByTarget,
} from '../lib/setup-view-overrides'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'
const SETUP_API_BASE =
  (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'))
    ? 'http://localhost:3001'
    : API_BASE

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MaskedEntry {
  set: boolean
  masked: string
  isSecret: boolean
  isPlaceholder?: boolean
  /**
   * Effective runtime value the API/web actually use when this var is
   * unset (e.g. PORT defaults to 3001 in code). Populated only for the
   * non-secret deployment defaults so the Setup wizard can show the real
   * URLs/ports a fresh clone is running on instead of just "(not set)".
   */
  runtime?: string
}
interface ValuesSnapshot {
  api: Record<string, MaskedEntry>
  web: Record<string, MaskedEntry>
  bot?: Record<string, MaskedEntry>
  guardian?: Record<string, MaskedEntry>
}

interface ProductionStatusComponent {
  id: string
  covered: boolean
  values: Record<string, string>
}

interface ProductionStatusSummary {
  agentName?: string
  scopes?: string[]
  frontendUrl?: string
  apiUrl?: string
  databaseUrl?: string
  components?: ProductionStatusComponent[]
}

type Target = 'api' | 'web' | 'bot' | 'guardian'
type ViewMode = 'local' | 'production' | 'template'
type ComponentMode = 'off' | 'selfhost'

interface FieldSpec {
  key: string
  label: string
  target: Target
  type?: 'text' | 'password' | 'url' | 'number'
  /** Per-view hints. */
  hint?: string
  hintProduction?: string
  /** Per-view default placeholder. */
  placeholder?: string
  placeholderProduction?: string
  /** When set, copy this field's new value into another key on save. */
  mirrorTo?: { key: string; target: Target }
}

interface ComponentSpec {
  id: string
  title: string
  description: string
  icon: typeof Database
  required?: boolean
  /** Available modes. Currently only 'off' and 'selfhost'. */
  modes: ComponentMode[]
  fields: FieldSpec[]
  /** Build the human-readable summary line shown when configured. */
  summary?: (values: ValuesSnapshot) => string
  /**
   * When true the card is hidden in Production view. Used for things that
   * are inherently per-machine (the two Discord bot processes), where each
   * operator runs their own Discord application or none at all -- there is
   * no shared production deployment to record values for.
   */
  localOnly?: boolean
  /**
   * When set, exposes a "Disable on this machine" toggle that flips the
   * matching server-side flag (apps/api/config.local.json -> disabledFeatures).
   * Disabled components stay configured but inert -- e.g. lets you avoid a
   * second Discord bot instance fighting the production one.
   */
  disableableAs?: DisableableFeature
}

// ---------------------------------------------------------------------------
// Component catalogue
// ---------------------------------------------------------------------------

const COMPONENTS: ComponentSpec[] = [
  {
    id: 'deployment',
    title: 'Deployment',
    description: 'Where this stack is hosted. These change between local dev and production.',
    icon: Server,
    required: true,
    modes: ['selfhost'],
    fields: [
      {
        key: 'NODE_ENV', label: 'NODE_ENV', target: 'api', type: 'text',
        hint: 'development -- enables the /setup wizard and verbose logs.',
        hintProduction: 'production -- disables /setup wizard and tightens defaults.',
        placeholder: 'development',
        placeholderProduction: 'production',
      },
      {
        key: 'PORT', label: 'API port', target: 'api', type: 'number',
        hint: 'Local dev: 3001.',
        hintProduction: 'Hosting provider usually sets this (Railway/Render). Leave blank if unsure.',
        placeholder: '3001',
        placeholderProduction: '',
      },
      {
        key: 'FRONTEND_URL', label: 'Frontend URL (CORS origin)', target: 'api', type: 'url',
        hint: 'Local dev: http://localhost:5173',
        hintProduction: 'Your deployed web URL, e.g. https://app.example.com',
        placeholder: 'http://localhost:5173',
        placeholderProduction: 'https://app.example.com',
      },
      {
        key: 'VITE_API_URL', label: 'Web -> API URL', target: 'web', type: 'url',
        hint: 'Local dev: http://localhost:3001',
        hintProduction: 'Your deployed API URL, e.g. https://api.example.com',
        placeholder: 'http://localhost:3001',
        placeholderProduction: 'https://api.example.com',
      },
    ],
    summary: v => {
      const front = v.api.FRONTEND_URL?.masked
      const api = v.web.VITE_API_URL?.masked
      if (front && api) return `Web ${front}  -->  API ${api}`
      return ''
    },
  },
  {
    id: 'database',
    title: 'Database (Supabase)',
    description: 'Where calendars, availability, and accounts are stored.',
    icon: Database,
    required: true,
    modes: ['selfhost'],
    fields: [
      {
        key: 'SUPABASE_URL', label: 'Project URL', target: 'api', type: 'url',
        hint: 'Same Supabase project in dev and prod is fine for early testing; split when you go live.',
        placeholder: 'https://<project-ref>.supabase.co',
        mirrorTo: { key: 'VITE_SUPABASE_URL', target: 'web' },
      },
      {
        key: 'SUPABASE_KEY', label: 'Anon (public) key', target: 'api', type: 'password',
        hint: 'Supabase: Settings -> API -> anon public key.',
        mirrorTo: { key: 'VITE_SUPABASE_ANON_KEY', target: 'web' },
      },
      {
        key: 'SUPABASE_SERVICE_ROLE_KEY', label: 'Service role key', target: 'api', type: 'password',
        hint: 'Required for admin endpoints. Never exposed to the browser.',
      },
    ],
    summary: v => {
      const url = v.api.SUPABASE_URL?.masked
      return url ? `Connected to ${url.replace(/^https?:\/\//, '')}` : ''
    },
  },
  {
    id: 'jwt',
    title: 'Authentication (JWT)',
    description: 'Secret used to sign session tokens.',
    icon: KeyRound,
    required: true,
    modes: ['off', 'selfhost'],
    fields: [
      {
        key: 'JWT_SECRET', label: 'JWT secret', target: 'api', type: 'password',
        hint: 'Random 64+ character string. Use a different secret in production.',
        hintProduction: 'Generate a fresh random value for production -- never reuse the dev secret.',
      },
    ],
  },
  {
    id: 'google',
    title: 'Google OAuth + Calendar',
    description: 'Sign-in with Google and read Google Calendar busy slots.',
    icon: ShieldCheck,
    modes: ['off', 'selfhost'],
    fields: [
      {
        key: 'GOOGLE_CLIENT_ID', label: 'Client ID', target: 'api', type: 'text',
        hint: 'Google Cloud Console -> Credentials -> OAuth client.',
      },
      {
        key: 'GOOGLE_CLIENT_SECRET', label: 'Client secret', target: 'api', type: 'password',
        hintProduction: 'Add your production redirect URI to the OAuth client in Google Cloud first.',
      },
    ],
    summary: v => v.api.GOOGLE_CLIENT_ID?.set ? `Client: ${v.api.GOOGLE_CLIENT_ID.masked}` : '',
  },
  {
    id: 'discord-coord',
    title: 'Coordination Discord Bot',
    description: 'Slash commands, DM scheduling flows, and platform-Discord linking. Runs as a separate process; values are written to apps/discord-bot/.env.',
    icon: Bot,
    modes: ['off', 'selfhost'],
    localOnly: true,
    disableableAs: 'discord-coord',
    fields: [
      {
        key: 'DISCORD_BOT_TOKEN', label: 'Bot token', target: 'bot', type: 'password',
        hint: 'Discord Developer Portal -> Bot -> Token. Separate Discord application from the Guardian bot.',
      },
      {
        key: 'DISCORD_CLIENT_ID', label: 'Client ID (Application ID)', target: 'bot', type: 'text',
        hint: 'Mirrored to apps/api/.env so the in-app Connect-Discord button can build the invite URL.',
        // Mirror to API so the OAuth invite URL in routes/discord.ts works.
        mirrorTo: { key: 'DISCORD_CLIENT_ID', target: 'api' },
      },
      {
        key: 'BOT_API_SECRET', label: 'Internal bot<->API shared secret', target: 'bot', type: 'password',
        hint: 'Random 32+ char string. Must be identical in apps/api/.env -- it authenticates the bot\'s outbound calls to the API.',
        // Mirror to API .env so both sides match.
        mirrorTo: { key: 'BOT_API_SECRET', target: 'api' },
      },
      {
        key: 'API_URL', label: 'API URL (bot -> API)', target: 'bot', type: 'url',
        hint: 'Local dev: http://localhost:3001',
        placeholder: 'http://localhost:3001',
      },
      {
        key: 'SUPABASE_URL', label: 'Supabase URL (shared)', target: 'bot', type: 'url',
        hint: 'Same project as the API. Bot needs its own copy in its .env -- the wizard mirrors it for you when you save.',
      },
      {
        key: 'SUPABASE_SERVICE_ROLE_KEY', label: 'Supabase service-role key (shared)', target: 'bot', type: 'password',
        hint: 'Same key as the API. Bot uses the service role to read/write coordination data.',
      },
    ],
    summary: v => v.bot?.DISCORD_BOT_TOKEN?.set ? 'Token present in apps/discord-bot/.env' : '',
  },
  {
    id: 'discord-guardian',
    title: 'Guardian Discord Bot',
    description: 'Moderation rule engine (Demon X). Runs as a separate process; values are written to apps/discord-guardian/.env.',
    icon: ShieldCheck,
    modes: ['off', 'selfhost'],
    localOnly: true,
    disableableAs: 'discord-guardian',
    fields: [
      {
        key: 'DISCORD_BOT_TOKEN', label: 'Bot token', target: 'guardian', type: 'password',
        hint: 'Separate Discord application from the Coordination bot.',
      },
      {
        key: 'DISCORD_CLIENT_ID', label: 'Client ID (Application ID)', target: 'guardian', type: 'text',
        hint: 'Optional. Only needed if you want a Guardian-specific invite URL elsewhere.',
      },
      {
        key: 'SUPABASE_URL', label: 'Supabase URL (shared)', target: 'guardian', type: 'url',
        hint: 'Same project as the API. Guardian needs its own copy in its .env.',
      },
      {
        key: 'SUPABASE_SERVICE_ROLE_KEY', label: 'Supabase service-role key (shared)', target: 'guardian', type: 'password',
        hint: 'Same key as the API.',
      },
      {
        key: 'DISABLE_BOT', label: 'Disable bot (skip Discord login)', target: 'guardian', type: 'text',
        hint: 'Set to "true" to run the process without connecting to Discord (used when the production bot is active and you do not want a local conflict).',
        placeholder: 'false',
      },
    ],
    summary: v => v.guardian?.DISCORD_BOT_TOKEN?.set ? 'Token present in apps/discord-guardian/.env' : '',
  },
  // SMTP is intentionally NOT listed here. Email delivery is configured
  // per deployment on the host (e.g. Railway env vars) and documented on
  // the distribution / deployment page, not in this in-app wizard.
  {
    id: 'captcha',
    title: 'Captcha (Cloudflare Turnstile)',
    description: 'Bot protection for guest account creation.',
    icon: ShieldCheck,
    modes: ['off', 'selfhost'],
    disableableAs: 'captcha',
    fields: [
      { key: 'TURNSTILE_SECRET_KEY', label: 'Secret key', target: 'api', type: 'password' },
      {
        key: 'VITE_TURNSTILE_SITE_KEY', label: 'Site key', target: 'web', type: 'text',
        hint: 'Public site key; shipped to the browser.',
      },
    ],
  },
  {
    id: 'ai',
    title: 'AI Assistant',
    description: 'OpenAI / compatible LLM for the AI guide panel.',
    icon: Sparkles,
    modes: ['off', 'selfhost'],
    disableableAs: 'ai',
    fields: [
      { key: 'AI_API_KEY', label: 'API key', target: 'api', type: 'password' },
    ],
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectCurrentMode(component: ComponentSpec, values: ValuesSnapshot | null): ComponentMode {
  if (!values) return 'off'
  // A field counts as "in use" when it has an explicit env value OR when the
  // API reports an effective runtime fallback for it (e.g. PORT defaulting
  // to 3001, FRONTEND_URL defaulting to http://localhost:5173). This keeps
  // the Deployment card from looking unconfigured on a fresh clone where
  // the dev server is actually running on hardcoded defaults.
  const anySet = component.fields.some(f => {
    const entry = values[f.target]?.[f.key]
    return Boolean(entry?.runtime) || Boolean(entry?.set && !entry?.isPlaceholder)
  })
  return anySet ? 'selfhost' : 'off'
}

function fieldHint(field: FieldSpec, view: ViewMode): string | undefined {
  if (view === 'production') return field.hintProduction ?? field.hint
  return field.hint
}
function fieldPlaceholder(field: FieldSpec, view: ViewMode): string | undefined {
  if (view === 'production') return field.placeholderProduction ?? field.placeholder
  return field.placeholder
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SetupPage() {
  const { status, loading, error, refresh } = useSetup()
  const { health, refresh: refreshHealth, loading: healthLoading } = useComponentHealth(status)
  const overrides = useViewOverrides()
  const location = useLocation()


  const [view, setView] = useState<ViewMode>('local')
  const [token, setToken] = useState<string>(() => getStoredSetupToken())
  const [tokenPromptFor, setTokenPromptFor] = useState<string | null>(null)
  const [values, setValues] = useState<ValuesSnapshot | null>(null)
  const [valuesError, setValuesError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; mode: ComponentMode } | null>(null)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 1800)
  }, [])
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  // Production dashboard state (public deployment status fetched via agent API key).
  const [prodApiBase, _setProdApiBase] = useState<string>(() => {
    if (typeof window === 'undefined') return 'https://api.coordinationmanager.com'
    return localStorage.getItem('prod_api_base') || 'https://api.coordinationmanager.com'
  })
  const [prodApiKeyInput, setProdApiKeyInput] = useState<string>('')
  const [prodStoredApiKey, setProdStoredApiKey] = useState<string>(() => {
    if (typeof window === 'undefined') return ''
    return localStorage.getItem('prod_api_key') || ''
  })
  const [prodRequest, setProdRequest] = useState<{ apiBaseUrl: string; apiKey: string } | null>(null)
  const [prodStatus, setProdStatus] = useState<ProductionStatusSummary | null>(null)
  const [prodStatusLoading, setProdStatusLoading] = useState(false)
  const [prodStatusError, setProdStatusError] = useState<string | null>(null)
  const [prodReloadNonce, setProdReloadNonce] = useState(0)

  useEffect(() => {
    if (view !== 'production') return
    if (!prodStoredApiKey) return
    setProdRequest({ apiBaseUrl: prodApiBase, apiKey: prodStoredApiKey })
  }, [view, prodApiBase, prodStoredApiKey])

  // Fetch public deployment status when the user requests load/reload.
  useEffect(() => {
    if (view !== 'production') return
    const apiBase = prodRequest?.apiBaseUrl.trim().replace(/\/$/, '') || ''
    const key = prodRequest?.apiKey.trim() || ''
    if (!apiBase || !key) {
      setProdStatus(null)
      setProdStatusError(null)
      return
    }
    if (!/^https?:\/\//i.test(apiBase)) {
      setProdStatus(null)
      setProdStatusError('API base URL must start with http:// or https://')
      return
    }
    if (!key.startsWith('cm_agent_')) {
      setProdStatus(null)
      setProdStatusError('API key must start with cm_agent_.')
      return
    }

    const controller = new AbortController()
    setProdStatusLoading(true)
    setProdStatusError(null)

    fetch(`${SETUP_API_BASE}/api/setup/production-summary`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        apiBaseUrl: apiBase,
        apiKey: key,
      }),
      signal: controller.signal,
    })
      .then(async res => {
        const body = await res.json().catch(() => ({})) as ({ message?: string } | ProductionStatusSummary | null)
        const message = (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string')
          ? body.message
          : null
        if (!res.ok) throw new Error(message || `HTTP ${res.status}`)
        if (!body || typeof body !== 'object') {
          throw new Error('No setup summary was returned by the deployment API')
        }
        const data = body as ProductionStatusSummary
        return data
      })
      .then(data => { setProdStatus(data); setProdStatusLoading(false) })
      .catch(e => {
        if ((e as Error).name === 'AbortError') return
        setProdStatus(null)
        setProdStatusError((e as Error).message)
        setProdStatusLoading(false)
      })

    return () => controller.abort()
  }, [prodRequest, prodReloadNonce, view])

  // When arriving via a deep link like /setup#discord, scroll to that card
  // and pulse it briefly so users can find the right section quickly.
  useEffect(() => {
    const hash = location.hash.replace(/^#/, '')
    if (!hash) return
    const el = document.getElementById(`setup-card-${hash}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightedId(hash)
    const t = setTimeout(() => setHighlightedId(null), 2500)
    return () => clearTimeout(t)
  }, [location.hash, loading])

  const canConfigure = status?.canConfigure ?? false

  const fetchValues = useCallback(async () => {
    setValuesError(null)
    try {
      const res = await fetch(`${SETUP_API_BASE}/api/setup/values`, {
        headers: { Accept: 'application/json' },
      })
      if (res.status === 401 || res.status === 403) {
        setValues(null)
        return
      }
      if (!res.ok) {
        setValuesError(`Failed to load values: HTTP ${res.status}`)
        setValues(null)
        return
      }
      setValues(await res.json())
    } catch (err) {
      setValuesError((err as Error).message)
    }
  }, [])

  useEffect(() => { fetchValues() }, [fetchValues])

  async function saveCard(
    component: ComponentSpec,
    formValues: Record<string, string>,
  ): Promise<void> {
    const apiEnv: Record<string, string> = {}
    const webEnv: Record<string, string> = {}
    const botEnv: Record<string, string> = {}
    const guardianEnv: Record<string, string> = {}
    const bucketFor = (t: Target): Record<string, string> => {
      switch (t) {
        case 'api': return apiEnv
        case 'web': return webEnv
        case 'bot': return botEnv
        case 'guardian': return guardianEnv
      }
    }
    for (const field of component.fields) {
      const v = formValues[field.key] ?? ''
      bucketFor(field.target)[field.key] = v
      if (field.mirrorTo) {
        bucketFor(field.mirrorTo.target)[field.mirrorTo.key] = v
      }
    }
    const payload: ConfigurePayload = { mode: 'selfhost' }
    if (Object.keys(apiEnv).length) payload.apiEnv = apiEnv
    if (Object.keys(webEnv).length) payload.webEnv = webEnv
    if (Object.keys(botEnv).length) payload.botEnv = botEnv
    if (Object.keys(guardianEnv).length) payload.guardianEnv = guardianEnv
    const res = await postConfigure(payload, token.trim())
    if (!res.ok) {
      if (/token/i.test(res.error)) {
        setTokenPromptFor(component.id)
        throw new Error('Write-protection token required. Paste it below and try again.')
      }
      throw new Error(res.error)
    }
    await Promise.all([refresh(), fetchValues()])
  }

  async function clearCard(component: ComponentSpec): Promise<void> {
    const cleared: Record<string, string> = {}
    for (const f of component.fields) cleared[f.key] = ''
    await saveCard(component, cleared)
  }

  /** Toggle a feature's "disabled on this machine" flag and refresh status. */
  async function toggleDisabled(feature: DisableableFeature, next: boolean, cardId: string): Promise<void> {
    const res = await postDisableFeature(feature, next, token.trim())
    if (!res.ok) {
      if (/token/i.test(res.error)) {
        setTokenPromptFor(cardId)
        throw new Error('Write-protection token required. Paste it below and try again.')
      }
      throw new Error(res.error)
    }
    await refresh()
    showToast(next ? 'Feature disabled on this machine' : 'Feature enabled on this machine')
  }

  // Production view filters: hide the Authentication (JWT) card until the
  // foundation it depends on actually exists in production. Showing JWT
  // earlier nudges users to invent a secret before the rest of the stack
  // is real, which leads to mismatched secrets later.
  const prodDeployComplete = useMemo(
    () => isComponentFilledInOverrides('deployment', overrides.production),
    [overrides.production],
  )
  const prodDbComplete = useMemo(
    () => isComponentFilledInOverrides('database', overrides.production),
    [overrides.production],
  )

  const visibleComponents = useMemo(() => {
    return COMPONENTS.filter(c => {
      // Local-only cards (Discord bots) are inherently per-machine: each
      // operator runs their own Discord application or none at all. Hide
      // them outside Local dev -- except in Template view, which is a
      // visual reference of a fresh install and should illustrate every
      // section the operator may need to configure.
      if (c.localOnly && view !== 'local' && view !== 'template') return false
      if (c.id !== 'jwt') return true
      if (view !== 'production') return true
      return prodDeployComplete && prodDbComplete
    })
  }, [view, prodDeployComplete, prodDbComplete])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Loading setup status...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">
        <header className="mb-6">
          <h1 className="text-3xl font-bold mb-1">Setup</h1>
          <p className="text-muted-foreground">
            Configure each component below. Changes are written to{' '}
            <code>Code/apps/api/.env</code> and <code>Code/apps/web/.env</code> -- copy
            those files to your host when deploying.
          </p>
        </header>

        {/* Local / Production / Template view toggle */}
        <div className="mb-6 sticky top-0 z-20 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75 border-b border-border flex items-center gap-3 flex-wrap">
          <span className="text-sm uppercase tracking-wide font-semibold text-cyan-700 dark:text-cyan-400">Environment view</span>
          <Segmented
            size="lg"
            accent="cyan"
            options={[
              { value: 'local', label: 'Local dev' },
              { value: 'production', label: 'Production' },
              { value: 'template', label: 'Template' },
            ]}
            value={view}
            onChange={v => setView(v as ViewMode)}
          />
          <span className="text-sm text-muted-foreground">
            {view === 'local'
              ? 'Live values from the API running on this machine.'
              : view === 'production'
              ? 'Monitor your public deployment by pasting its API key below.'
              : 'Clean open-source template. Secrets are intentionally blank.'}
          </span>
          {view === 'local' && (
            <button
              type="button"
              onClick={() => { void refresh(); void refreshHealth() }}
              className="ml-auto px-2 py-1 rounded-md border border-border text-xs flex items-center gap-1 hover:bg-accent/50"
              title="Re-check status"
            >
              <RefreshCw className={`h-3 w-3 ${healthLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          )}
        </div>

        {/* Production view: API key input and public status dashboard */}
        {view === 'production' ? (
          <div className="mb-8">
            <div className="mb-4 rounded-md border border-cyan-500/30 bg-cyan-500/5 p-3 text-xs text-muted-foreground">
              Production monitoring flow: deploy your app publicly first, create an Agent API key in Settings,
              then paste your key once. This setup remembers the key on this browser and auto-loads live deployment status.
              <a
                href="/settings?tab=ai&section=agent-api-keys"
                className="ml-1 underline text-primary hover:no-underline"
              >
                Open local Settings -&gt; Agent API Keys
              </a>
              <a
                href="https://coordinationmanager.com/settings?tab=ai&section=agent-api-keys"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-3 underline text-primary hover:no-underline"
              >
                Open coordinationmanager.com Settings
              </a>
            </div>

            {!prodStoredApiKey && (
              <form
                className="mb-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  const apiBase = prodApiBase.trim()
                  const apiKey = prodApiKeyInput.trim()
                  if (!apiBase || !apiKey) {
                    setProdStatus(null)
                    setProdStatusError('Provide API key (cm_agent_*).')
                    return
                  }
                  if (typeof window !== 'undefined') {
                    localStorage.setItem('prod_api_base', apiBase)
                    localStorage.setItem('prod_api_key', apiKey)
                  }
                  setProdStoredApiKey(apiKey)
                  setProdRequest({ apiBaseUrl: apiBase, apiKey })
                  setProdApiKeyInput('')
                }}
              >
                <p className="text-[11px] text-muted-foreground mb-3">
                  API base used: <code>{prodApiBase}</code>. If needed, change it by editing <code>prod_api_base</code> in localStorage.
                </p>
                <label className="block mb-2 text-sm font-medium">Paste your public deployment API key (cm_agent_*)</label>
                <input
                  type="password"
                  className="w-full max-w-md px-3 py-2 rounded-md border border-input bg-background text-sm font-mono mb-2"
                  value={prodApiKeyInput}
                  onChange={e => setProdApiKeyInput(e.target.value)}
                  placeholder="cm_agent_..."
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="submit"
                  disabled={prodStatusLoading || !prodApiKeyInput.trim()}
                  className="mt-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
                >
                  {prodStatusLoading ? (
                    <span><Loader2 className="h-3 w-3 inline mr-1 animate-spin" />Loading...</span>
                  ) : (
                    'Connect and load production status'
                  )}
                </button>
              </form>
            )}

            {prodStatusLoading && <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Checking deployment status...</div>}
            {prodStatusError && <div className="text-xs text-destructive">{prodStatusError}</div>}
            {prodStoredApiKey && !prodStatusLoading && (
              <div className="mb-3 flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setProdReloadNonce(n => n + 1)}
                  className="px-3 py-1.5 rounded-md border border-border text-xs font-medium hover:bg-accent/50"
                >
                  Reload status
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window !== 'undefined') localStorage.removeItem('prod_api_key')
                    setProdStoredApiKey('')
                    setProdRequest(null)
                    setProdStatus(null)
                    setProdStatusError(null)
                    setProdApiKeyInput('')
                  }}
                  className="px-3 py-1.5 rounded-md border border-rose-500/40 text-rose-600 dark:text-rose-400 text-xs font-medium hover:bg-rose-500/10"
                >
                  Disconnect
                </button>
              </div>
            )}
            {prodStatus && (
              <div className="mt-4 space-y-2">
                <div className="grid gap-3 md:grid-cols-3">
                  <StatusTile
                    label="Frontend (prod)"
                    value={prodStatus.frontendUrl || '(not set)'}
                    tone={prodStatus.frontendUrl ? 'good' : 'off'}
                    sub="Vercel / public frontend"
                  />
                  <StatusTile
                    label="API (prod)"
                    value={prodStatus.apiUrl || '(not set)'}
                    tone={prodStatus.apiUrl ? 'good' : 'off'}
                    sub="Railway / public API"
                  />
                  <StatusTile
                    label="Database (prod)"
                    value={prodStatus.databaseUrl || '(not set)'}
                    tone={prodStatus.databaseUrl ? 'good' : 'off'}
                    sub="Supabase"
                  />
                </div>
                <div className="text-xs text-muted-foreground mt-2">
                  <strong>Agent:</strong> {prodStatus.agentName || 'Unknown'}<br />
                  <strong>Scopes:</strong> {prodStatus.scopes?.length ? prodStatus.scopes.join(', ') : '(none)'}
                </div>
                <div className="rounded-md border border-border bg-card p-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Component coverage</p>
                  <ul className="grid gap-1.5 sm:grid-cols-2">
                    {(prodStatus.components || []).map((c) => {
                      const spec = COMPONENTS.find(x => x.id === c.id)
                      return (
                        <li key={c.id} className="flex items-center gap-2 text-xs">
                          {c.covered
                            ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                            : <AlertCircle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />}
                          <span>{spec?.title || c.id}</span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              </div>
            )}
            {!prodStoredApiKey && (
              <div className="text-xs text-muted-foreground mt-2">
                Paste your <code>cm_agent_*</code> API key from your deployment.<br />
                Then click <strong>Load production status</strong>. This view reads <code>/api/agent/setup/summary</code> and only shows public/sanitized status details.
              </div>
            )}
            <p className="text-[11px] text-muted-foreground mt-2">
              Security note: this key is never written to .env files. It is saved in localStorage by default until you click Disconnect.
            </p>
          </div>
        ) : (
          <>
            {/* Status tiles for local/template */}
            <ViewStatusTiles
              view={view}
              health={health}
              error={error}
              values={values}
              overrides={overrides.production}
            />
            {error && (
              <div className="mb-6 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
                <p className="font-medium text-destructive mb-1">API unreachable at {API_BASE}</p>
                <p className="text-muted-foreground">
                  Start the API (<code>pnpm dev:api</code> from <code>Code/</code>) and reload.
                </p>
              </div>
            )}
            {valuesError && (
              <div className="mb-6 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                {valuesError}
              </div>
            )}
            {!canConfigure && !error && view === 'local' && (
              <div className="mb-6 rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
                Server writes are disabled (not localhost, or running in production).
                Edit <code>Code/apps/api/.env</code> and <code>Code/apps/web/.env</code> directly.
              </div>
            )}
            {/* Component cards for local/template */}
            <div className="space-y-3">
              {visibleComponents.map(component => (
                <ComponentCard
                  key={component.id}
                  component={component}
                  view={view}
                  values={values}
                  overrides={overrides.production}
                  health={health[component.id]}
                  canEdit={canConfigure && view !== 'template'}
                  highlighted={highlightedId === component.id}
                  editing={editing?.id === component.id ? editing.mode : null}
                  onCopy={showToast}
                  onSelectMode={mode => {
                    if (mode === 'off') {
                      if (confirm(`Clear all values for "${component.title}"?`)) {
                        void clearCard(component).catch(e => alert(e.message))
                      }
                      return
                    }
                    setEditing({ id: component.id, mode })
                  }}
                  onCancel={() => setEditing(null)}
                  onSave={async (formValues) => {
                    await saveCard(component, formValues)
                    setEditing(null)
                  }}
                  tokenPrompt={tokenPromptFor === component.id ? (
                    <TokenPrompt
                      token={token}
                      setToken={setToken}
                      onSaved={() => {
                        storeSetupToken(token.trim())
                        setTokenPromptFor(null)
                      }}
                    />
                  ) : null}
                  isDisabledByOperator={
                    component.disableableAs
                      ? Boolean(status?.disabled?.[component.disableableAs])
                      : false
                  }
                  onToggleDisabled={
                    component.disableableAs
                      ? (next) => toggleDisabled(component.disableableAs!, next, component.id)
                          .catch(e => alert(e.message))
                      : null
                  }
                />
              ))}
            </div>
            {/* Write-protection token (collapsed) */}
            {(!status?.isApiConfigured || tokenPromptFor || token) && (
              <TokenSection token={token} setToken={setToken} />
            )}
          </>
        )}

        {/* Floating toast for copy actions */}
        {toast && (
          <div
            role="status"
            aria-live="polite"
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-md bg-foreground text-background px-4 py-2 text-xs shadow-lg animate-fade-in-out"
          >
            {toast}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component card
// ---------------------------------------------------------------------------

function ComponentCard({
  component, view, values, overrides, health, canEdit, editing,
  onSelectMode, onCancel, onSave, tokenPrompt, highlighted, onCopy,
  isDisabledByOperator, onToggleDisabled,
}: {
  component: ComponentSpec
  view: ViewMode
  values: ValuesSnapshot | null
  overrides: OverridesByTarget
  health?: ComponentHealth
  canEdit: boolean
  editing: ComponentMode | null
  onSelectMode: (mode: ComponentMode) => void
  onCancel: () => void
  onSave: (formValues: Record<string, string>) => Promise<void>
  tokenPrompt: ReactNode
  highlighted?: boolean
  onCopy: (msg: string) => void
  /** When the operator has flipped the "Disable on this machine" toggle. */
  isDisabledByOperator: boolean
  /** Toggle handler; null when the component is not disable-able. */
  onToggleDisabled: ((next: boolean) => void) | null
}) {
  const Icon = component.icon

  // Effective per-field display value for the current view.
  // - local: live API snapshot
  // - production: user-entered overrides (otherwise blank)
  // - template: built-in safe defaults (otherwise blank)
  const effective = useMemo(
    () => getEffectiveValues(component, view, values, overrides),
    [component, view, values, overrides],
  )

  const currentMode: ComponentMode = useMemo(() => {
    if (view === 'local') return detectCurrentMode(component, values)
    if (view === 'template') {
      // Template only has values for the deployment fields by design.
      return component.id === 'deployment' ? 'selfhost' : 'off'
    }
    // production: any override populated -> selfhost
    const anySet = component.fields.some(f => Boolean(overrides[f.target]?.[f.key]?.value))
    return anySet ? 'selfhost' : 'off'
  }, [component, view, values, overrides])

  // Auto-expand state.
  const userToggled = useRef(false)
  const [expanded, setExpanded] = useState<boolean>(false)
  // Switching into Template view always force-collapses every card and
  // clears the user-toggled flag, so the default "all collapsed" reference
  // state is restored each time the view is entered.
  useEffect(() => {
    if (view === 'template') {
      userToggled.current = false
      setExpanded(false)
    }
  }, [view])
  // Editing or deep-link highlight always force open.
  useEffect(() => {
    if (editing || highlighted) setExpanded(true)
  }, [editing, highlighted])

  const toggleExpanded = useCallback(() => {
    if (editing) return
    userToggled.current = true
    setExpanded(e => !e)
  }, [editing])

  const healthTone = healthToTone(health, currentMode, component.required)
  const healthLabel = healthToLabel(health, currentMode)

  const displayValues: Record<string, string> = effective

  const hasConfiguredField = useCallback((field: FieldSpec): boolean => {
    if (view === 'local') {
      const entry = values?.[field.target]?.[field.key]
      return Boolean(entry?.runtime) || Boolean(entry?.set && !entry?.isPlaceholder)
    }
    if (view === 'production') {
      return Boolean(overrides[field.target]?.[field.key]?.value)
    }
    return Boolean(displayValues[field.key])
  }, [displayValues, overrides, values, view])

  // Auto-expand decision.
  //   * Template view never auto-expands.
  //   * Otherwise expand only when the card is required AND has no value.
  const hasAnyInfo =
    currentMode !== 'off'
    || component.fields.some(f => hasConfiguredField(f))
  const shouldAutoExpand =
    view !== 'template'
    && Boolean(component.required)
    && !hasAnyInfo

  useEffect(() => {
    if (userToggled.current) return
    setExpanded(shouldAutoExpand)
  }, [shouldAutoExpand])

  // Required + empty -- elevate visually so the user spots gaps fast.
  const isFullyConfigured = component.fields.length > 0
    && component.fields.every(f => hasConfiguredField(f))
  // Required components are "missing" whenever they are not fully configured.
  const isMissingRequired =
    component.required === true
    && !isFullyConfigured
  const isDiscordRuntimeWarnLocal =
    view === 'local'
    && (component.id === 'discord-coord' || component.id === 'discord-guardian')
    && healthTone === 'warn'

  return (
    <div
      id={`setup-card-${component.id}`}
      className={`rounded-lg border bg-card overflow-hidden transition-shadow duration-500 scroll-mt-24 ${
        highlighted
          ? 'border-amber-400 ring-2 ring-amber-400/60 shadow-md shadow-amber-500/20 [animation:pulse_3s_ease-in-out_infinite]'
          : isDiscordRuntimeWarnLocal
          ? 'border-amber-500/50 bg-amber-500/10'
          : isMissingRequired
          ? 'border-rose-500/50 bg-rose-500/5'
          : isFullyConfigured
          ? 'border-emerald-500/40 bg-emerald-500/5'
          : 'border-border'
      }`}
    >
      {/* Header (always visible) -- click anywhere except a copy chip to toggle */}
      <div
        role="button"
        tabIndex={0}
        onClick={toggleExpanded}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpanded() } }}
        className="w-full text-left p-4 flex items-start gap-3 hover:bg-accent/30 transition-colors cursor-pointer select-none"
        aria-expanded={expanded}
      >
        <span className="mt-0.5 text-muted-foreground shrink-0">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
        <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${
          isMissingRequired
            ? 'text-rose-500'
            : isDiscordRuntimeWarnLocal
            ? 'text-amber-600 dark:text-amber-400'
            : isFullyConfigured
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-muted-foreground'
        }`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <h3 className="font-semibold">{component.title}</h3>
            {isMissingRequired && (
              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-600 dark:text-rose-400">
                needs setup
              </span>
            )}
            {isDisabledByOperator && (
              <span
                className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-500/15 text-slate-600 dark:text-slate-300 border border-slate-500/30"
                title="This feature is configured but explicitly disabled on this machine via Setup."
              >
                disabled here
              </span>
            )}
            {view === 'local' && (
              <span
                className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${tonePillClasses(healthTone)}`}
                title={healthLabel}
              >
                {healthLabel}
              </span>
            )}
          </div>
          {/* Description + parameter-key tags -- only when collapsed.
              When expanded, the description text is hidden because the
              parameter table below conveys the same information, and the
              key chips visually "move" into the table. */}
          {!expanded && (
            <>
              <p className="text-xs text-muted-foreground">{component.description}</p>
              <div className="mt-2 flex flex-wrap gap-1.5 animate-in fade-in duration-200">
                {component.fields.map(f => {
                  const display = displayValues[f.key] ?? ''
                  return (
                    <CopyableTag
                      key={f.key}
                      label={f.key}
                      value={display}
                      onCopy={onCopy}
                      disabled={!display}
                    />
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="px-4 pb-4 animate-in fade-in slide-in-from-top-1 duration-200">
          {/* Values table with copy buttons -- shown only when not editing */}
          {!editing && (
            <div className="pl-11 space-y-0.5">
              {component.fields.map(f => {
                const display = displayValues[f.key] ?? ''
                const hasValue = Boolean(display)
                return (
                  <div key={f.key} className="text-xs font-mono flex gap-2 items-center group">
                    <CopyableKey
                      label={f.key}
                      value={display}
                      onCopy={onCopy}
                      disabled={!hasValue}
                    />
                    <CopyableValue
                      value={display}
                      placeholder="(not set)"
                      onCopy={onCopy}
                      label={f.key}
                    />
                  </div>
                )
              })}
            </div>
          )}

          {/* Edit values action -- only visible inside expanded body, and
              only when the active view is editable. Template view is a
              read-only demonstration of the default state and exposes no
              insert/update controls so it cannot be mistaken for a working
              configuration surface. */}
          {!editing && view !== 'template' && (
            <div className="mt-3 pl-11 flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => onSelectMode('selfhost')}
                disabled={!canEdit}
                className="px-3 py-1 rounded-md border border-border text-xs font-medium hover:bg-accent/50 disabled:opacity-50"
              >
                <Edit3 className="h-3 w-3 inline mr-1" />
                Edit values
              </button>
              {onToggleDisabled && (
                <button
                  type="button"
                  onClick={() => onToggleDisabled(!isDisabledByOperator)}
                  disabled={!canEdit}
                  className={`px-3 py-1 rounded-md border text-xs font-medium disabled:opacity-50 ${
                    isDisabledByOperator
                      ? 'border-emerald-500/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10'
                      : 'border-border hover:bg-accent/50'
                  }`}
                  title={isDisabledByOperator
                    ? 'Currently disabled on this machine -- click to re-enable.'
                    : 'Disable this feature on this machine without clearing its keys (useful for avoiding conflicts with a production instance).'}
                >
                  {isDisabledByOperator ? 'Enable on this machine' : 'Disable on this machine'}
                </button>
              )}
            </div>
          )}
          {!editing && view === 'template' && (
            <div className="mt-3 pl-11 text-[10px] text-muted-foreground">
              Template is read-only -- switch to Local dev to edit values.
            </div>
          )}

          {/* When editing: mode segmented appears together with the form */}
          {editing && (
            <div className="mt-1 pl-11 flex items-center gap-3 flex-wrap">
              <Segmented
                options={component.modes.map(m => ({
                  value: m,
                  label: m === 'off' ? 'Off' : 'Self-host',
                  disabled: m !== 'off' && m !== currentMode && !canEdit,
                }))}
                value={editing}
                onChange={v => onSelectMode(v as ComponentMode)}
              />
            </div>
          )}
        </div>
      )}

      {editing === 'selfhost' && (
        <EditForm
          component={component}
          view={view}
          values={values}
          overrides={overrides}
          onCancel={onCancel}
          onSave={onSave}
          tokenPrompt={tokenPrompt}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// View-aware helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when every field of the named component has a non-empty
 * value recorded in the given production-overrides snapshot. Used to gate
 * visibility of the Authentication (JWT) card -- we only show it once the
 * foundation it depends on (Deployment + Database) has been entered.
 */
function isComponentFilledInOverrides(componentId: string, overrides: OverridesByTarget): boolean {
  const spec = COMPONENTS.find(c => c.id === componentId)
  if (!spec) return false
  return spec.fields.every(f => Boolean(overrides[f.target]?.[f.key]?.value))
}

function getEffectiveValues(
  component: ComponentSpec,
  view: ViewMode,
  values: ValuesSnapshot | null,
  overrides: OverridesByTarget,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of component.fields) {
    if (view === 'local') {
      const e = values?.[f.target]?.[f.key]
      // Show the masked value when the env var is set. Otherwise fall back
      // to the API-reported runtime default (deployment vars only) so a
      // fresh clone reflects the URLs/ports the dev server is actually
      // running on instead of an empty "(not set)" placeholder.
      out[f.key] = e?.set ? e.masked : (e?.runtime ?? '')
    } else if (view === 'production') {
      out[f.key] = overrides[f.target]?.[f.key]?.value ?? ''
    } else {
      // template
      out[f.key] = TEMPLATE_DEFAULTS[f.target]?.[f.key]?.value ?? ''
    }
  }
  return out
}

function healthToTone(
  health: ComponentHealth | undefined,
  mode: ComponentMode,
  required?: boolean,
): 'good' | 'warn' | 'off' | 'bad' {
  if (!health) return mode === 'off' ? (required ? 'warn' : 'off') : 'good'
  const detail = (health.detail || '').toLowerCase()
  if (health.state === 'off' && (detail.includes('disabled') || detail.includes('not launched') || detail.includes('not running'))) {
    return 'warn'
  }
  if (health.state === 'live') return 'good'
  if (health.state === 'configured') return 'good'
  if (health.state === 'down') return 'bad'
  if (health.state === 'off') return required ? 'warn' : 'off'
  return 'off'
}

function healthToLabel(health: ComponentHealth | undefined, mode: ComponentMode): string {
  if (!health) return mode
  if (health.state === 'live') return health.detail ? `live (${health.detail})` : 'live'
  if (health.state === 'configured') return 'configured'
  if (health.state === 'down') return health.detail ? `down: ${health.detail}` : 'down'
  if (health.state === 'off') return health.detail || 'off'
  return health.state
}

function tonePillClasses(tone: 'good' | 'warn' | 'off' | 'bad'): string {
  if (tone === 'good') return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
  if (tone === 'warn') return 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/35'
  if (tone === 'bad') return 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/35'
  return 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border border-slate-500/30'
}

// ---------------------------------------------------------------------------
// Copyable key chip with hover highlight + clipboard toast
// ---------------------------------------------------------------------------

function CopyableKey({
  label, value, onCopy, disabled,
}: {
  label: string
  value: string
  onCopy: (msg: string) => void
  disabled?: boolean
}) {
  const [justCopied, setJustCopied] = useState(false)
  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (disabled || !value) return
    try {
      await navigator.clipboard.writeText(value)
      setJustCopied(true)
      onCopy(`${label} value copied to clipboard`)
      setTimeout(() => setJustCopied(false), 1200)
    } catch {
      onCopy('Copy failed -- clipboard blocked by browser')
    }
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={
        'group/key inline-flex items-center gap-1 w-56 shrink-0 text-left truncate transition-colors ' +
        (disabled
          ? 'text-muted-foreground/50 cursor-not-allowed'
          : 'text-muted-foreground hover:text-blue-500 hover:underline cursor-pointer')
      }
      title={disabled ? `${label} (no value to copy)` : `Copy ${label} value`}
    >
      <span className="truncate">{label}</span>
      {justCopied ? (
        <Check className="h-3 w-3 text-emerald-500 shrink-0" />
      ) : (
        <Copy className="h-3 w-3 opacity-0 group-hover/key:opacity-100 transition-opacity shrink-0" />
      )}
    </button>
  )
}

/**
 * Collapsed-state chip showing the env key. Click copies the value (if any).
 * Hovering turns blue + shows copy icon, matching CopyableKey behaviour.
 * Clicks do NOT bubble up to the card-toggle handler.
 */
function CopyableTag({
  label, value, onCopy, disabled,
}: {
  label: string
  value: string
  onCopy: (msg: string) => void
  disabled?: boolean
}) {
  const [justCopied, setJustCopied] = useState(false)
  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (disabled || !value) return
    try {
      await navigator.clipboard.writeText(value)
      setJustCopied(true)
      onCopy(`${label} value copied to clipboard`)
      setTimeout(() => setJustCopied(false), 1200)
    } catch {
      onCopy('Copy failed -- clipboard blocked by browser')
    }
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={
        'group/tag text-[10px] font-mono px-1.5 py-0.5 rounded border bg-background/60 inline-flex items-center gap-1 transition-colors ' +
        (disabled
          ? 'border-border text-muted-foreground/60 cursor-not-allowed'
          : 'border-border text-muted-foreground hover:text-blue-500 hover:border-blue-400 cursor-pointer')
      }
      title={disabled ? `${label} (no value to copy)` : `Copy ${label} value`}
    >
      <span>{label}</span>
      {justCopied ? (
        <Check className="h-2.5 w-2.5 text-emerald-500" />
      ) : (
        <Copy className="h-2.5 w-2.5 opacity-0 group-hover/tag:opacity-100 transition-opacity" />
      )}
    </button>
  )
}

/**
 * Expanded-state value cell. Same hover-blue + click-to-copy behaviour as
 * CopyableKey, but for the value column.
 */
function CopyableValue({
  value, placeholder, onCopy, label,
}: {
  value: string
  placeholder: string
  onCopy: (msg: string) => void
  label: string
}) {
  const [justCopied, setJustCopied] = useState(false)
  const disabled = !value
  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (disabled) return
    try {
      await navigator.clipboard.writeText(value)
      setJustCopied(true)
      onCopy(`${label} value copied to clipboard`)
      setTimeout(() => setJustCopied(false), 1200)
    } catch {
      onCopy('Copy failed -- clipboard blocked by browser')
    }
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={
        'group/val inline-flex items-center gap-1 min-w-0 text-left transition-colors ' +
        (disabled
          ? 'text-muted-foreground/60 cursor-not-allowed'
          : 'hover:text-blue-500 hover:underline cursor-pointer')
      }
      title={disabled ? 'No value to copy' : `Copy ${label} value`}
    >
      <span className="truncate">{disabled ? placeholder : value}</span>
      {!disabled && (justCopied ? (
        <Check className="h-3 w-3 text-emerald-500 shrink-0" />
      ) : (
        <Copy className="h-3 w-3 opacity-0 group-hover/val:opacity-100 transition-opacity shrink-0" />
      ))}
    </button>
  )
}

// ---------------------------------------------------------------------------
// View status tiles -- adapt to current view
// ---------------------------------------------------------------------------

function ViewStatusTiles({
  view, health, error, values, overrides,
}: {
  view: ViewMode
  health: { [k: string]: ComponentHealth | undefined }
  error: string | null
  values: ValuesSnapshot | null
  overrides: OverridesByTarget
}) {
  const apiHealth = health.api
  if (view === 'local') {
    const apiReachable = !error && apiHealth?.state !== 'down'
    const dbHealthy = health.database?.state === 'configured' || health.database?.state === 'live'
    const docsTone = healthToTone(health.docs, 'selfhost', false)
    const docsLabel = healthToLabel(health.docs, 'selfhost')
    return (
      <div className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatusTile
          label="Frontend"
          value="http://localhost:5173"
          tone="good"
          sub="React + Vite"
        />
        <StatusTile
          label="API"
          value={error ? 'unreachable' : API_BASE}
          tone={apiReachable ? 'good' : 'bad'}
          sub="Node.js + Express"
        />
        <StatusTile
          label="Database"
          value={values?.api.SUPABASE_URL?.masked || (dbHealthy ? 'configured' : 'not configured')}
          tone={dbHealthy ? 'good' : 'warn'}
          sub="Supabase (PostgreSQL)"
        />
        <StatusTile
          label="Wiki"
          value={docsLabel}
          tone={docsTone}
          sub="Docs frontend (Vite)"
        />
      </div>
    )
  }
  if (view === 'production') {
    const frontend = overrides.api?.FRONTEND_URL?.value || '(set FRONTEND_URL)'
    const api = overrides.web?.VITE_API_URL?.value || '(set VITE_API_URL)'
    const db = overrides.api?.SUPABASE_URL?.value
    const frontendTone = overrides.api?.FRONTEND_URL ? 'good' : 'off'
    const apiTone = overrides.web?.VITE_API_URL ? 'good' : 'off'
    const dbTone = db ? 'good' : 'off'
    return (
      <div className="mb-6 grid gap-3 md:grid-cols-3">
        <StatusTile
          label="Frontend (prod)"
          value={frontend}
          tone={frontendTone}
          sub="React + Vite (Vercel)"
        />
        <StatusTile
          label="API (prod)"
          value={api}
          tone={apiTone}
          sub="Node.js + Express (Railway)"
        />
        <StatusTile
          label="Database (prod)"
          value={db || 'not recorded'}
          tone={dbTone}
          sub="Supabase (PostgreSQL)"
        />
      </div>
    )
  }
  // template -- mirror the default `pnpm dev` localhost stack so this view
  // doubles as a reference of what a fresh clone looks like before any
  // edits. Tone is `off` to signal "placeholder defaults, not your env".
  return (
    <div className="mb-6 grid gap-3 md:grid-cols-3">
      <StatusTile
        label="Frontend (template)"
        value="http://localhost:5173"
        tone="off"
        sub="React + Vite"
      />
      <StatusTile
        label="API (template)"
        value="http://localhost:3001"
        tone="off"
        sub="Node.js + Express"
      />
      <StatusTile
        label="Database (template)"
        value="Create your own Database"
        tone="off"
        sub="Supabase (PostgreSQL)"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Edit form
// ---------------------------------------------------------------------------

function EditForm({
  component, view, values, overrides, onCancel, onSave, tokenPrompt,
}: {
  component: ComponentSpec
  view: ViewMode
  values: ValuesSnapshot | null
  overrides: OverridesByTarget
  onCancel: () => void
  onSave: (formValues: Record<string, string>) => Promise<void>
  tokenPrompt: ReactNode
}) {
  const [form, setForm] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const f of component.fields) {
      if (view === 'production') {
        initial[f.key] = overrides[f.target]?.[f.key]?.value ?? ''
      } else {
        const entry = values?.[f.target]?.[f.key]
        initial[f.key] = entry?.isSecret ? '' : (entry?.masked ?? '')
      }
    }
    return initial
  })
  const [reveal, setReveal] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      await onSave(form)
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border-t border-border bg-muted/30 p-4 space-y-3">
      {component.fields.map(f => {
        const isSecret = (f.type ?? 'text') === 'password'
        const showAsType = isSecret && !reveal[f.key] ? 'password' : (f.type === 'password' ? 'text' : (f.type ?? 'text'))
        const entry = values?.[f.target]?.[f.key]
        const hint = fieldHint(f, view)
        const placeholder = fieldPlaceholder(f, view)
          ?? (entry?.set && isSecret ? `Current: ${entry.masked} (leave blank to keep)` : '')
        return (
          <Field
            key={f.key}
            label={`${f.label}`}
            sublabel={`${f.target} .env`}
            hint={hint}
          >
            <div className="flex gap-2">
              <input
                type={showAsType}
                className="flex-1 px-3 py-2 rounded-md border border-input bg-background text-sm font-mono"
                value={form[f.key]}
                onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                placeholder={placeholder}
                autoComplete="off"
                spellCheck={false}
              />
              {isSecret && (
                <button
                  type="button"
                  onClick={() => setReveal(p => ({ ...p, [f.key]: !p[f.key] }))}
                  className="px-2 rounded-md border border-border text-xs"
                  title={reveal[f.key] ? 'Hide' : 'Show'}
                >
                  {reveal[f.key] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              )}
            </div>
            {f.mirrorTo && (
              <p className="text-[10px] text-muted-foreground mt-1">
                Also written to <code>{f.mirrorTo.key}</code> ({f.mirrorTo.target})
              </p>
            )}
          </Field>
        )
      })}
      {err && <p className="text-xs text-destructive">{err}</p>}
      {tokenPrompt}
      <div className="flex gap-2 flex-wrap">
        <button
          type="submit"
          disabled={busy}
          className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 inline mr-1 animate-spin" /> : null}
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-md border border-border text-xs font-medium"
        >
          <X className="h-3 w-3 inline mr-1" />
          Cancel
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Restart the affected service after saving -- most modules only read env at startup.
      </p>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Write-protection token (collapsed)
// ---------------------------------------------------------------------------

function TokenSection({ token, setToken }: { token: string; setToken: (t: string) => void }) {
  const [open, setOpen] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  return (
    <details
      open={open}
      onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className="mt-8 rounded-lg border border-border bg-card"
    >
      <summary className="cursor-pointer select-none p-4 text-sm flex items-center gap-2">
        <Info className="h-4 w-4 text-muted-foreground" />
        Write-protection token (optional, for saving from this browser)
        {token && <span className="text-[10px] text-emerald-600 dark:text-emerald-400 ml-2">stored</span>}
      </summary>
      <div className="px-4 pb-4 space-y-2 text-xs text-muted-foreground">
        <p>
          This is a short token printed in the <strong>API server console at startup</strong>
          (e.g. <code>[setup] write-protection token: ab12...</code>). It only matters when you
          click <em>Save</em>; reading values does not need it.
        </p>
        <p>
          It is <strong>not</strong> the same as an agent API key (<code>cm_agent_*</code>).
          It exists so a random browser tab cannot rewrite your local <code>.env</code> files just
          because the API is bound to localhost.
        </p>
        <div className="flex gap-2 pt-1">
          <input
            type="password"
            className="flex-1 px-3 py-2 rounded-md border border-input bg-background text-sm font-mono"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="paste setup token..."
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => {
              storeSetupToken(token.trim())
              setSavedFlash(true)
              setTimeout(() => setSavedFlash(false), 1500)
            }}
            disabled={!token.trim()}
            className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
          >
            {savedFlash ? 'Saved' : 'Store'}
          </button>
          {token && (
            <button
              type="button"
              onClick={() => { storeSetupToken(''); setToken('') }}
              className="px-3 py-2 rounded-md border border-border text-xs"
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </details>
  )
}

function TokenPrompt({
  token, setToken, onSaved,
}: { token: string; setToken: (t: string) => void; onSaved: () => void }) {
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
      <p className="text-xs">
        <strong>Write-protection token needed.</strong> Copy it from the API server console
        (a line starting with <code>[setup] write-protection token:</code>) and paste here.
        It is not an agent API key (cm_agent_*).
      </p>
      <div className="flex gap-2">
        <input
          type="password"
          className="flex-1 px-3 py-2 rounded-md border border-input bg-background text-sm font-mono"
          value={token}
          onChange={e => setToken(e.target.value)}
          placeholder="paste setup token..."
          autoComplete="off"
        />
        <button
          type="button"
          onClick={onSaved}
          disabled={!token.trim()}
          className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
        >
          Store token
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function Segmented<T extends string>({
  options, value, onChange, size = 'sm', accent = 'default',
}: {
  options: { value: T; label: string; disabled?: boolean; title?: string }[]
  value: T
  onChange: (v: T) => void
  /** Visual size of the control. 'lg' is used for the prominent top-level View toggle. */
  size?: 'sm' | 'lg'
  /** Accent style for the active item. 'cyan' draws attention with a glowing animated ring. */
  accent?: 'default' | 'cyan'
}) {
  const isLg = size === 'lg'
  const isCyan = accent === 'cyan'
  const wrapperClass = isLg
    ? 'inline-flex rounded-lg border-2 border-cyan-500/40 dark:border-cyan-400/40 bg-muted/40 p-1 shadow-sm'
    : 'inline-flex rounded-md border border-border bg-muted/40 p-0.5'
  const btnBase = isLg
    ? 'px-4 py-2 text-sm font-semibold rounded-md transition-all duration-200 disabled:opacity-40 '
    : 'px-3 py-1 text-xs font-medium rounded transition-colors disabled:opacity-40 '
  const activeClass = isCyan
    ? 'bg-cyan-50 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300 border-2 border-cyan-500 dark:border-cyan-400 animate-cyan-trace'
    : 'bg-background shadow-sm border border-border'
  const inactiveClass = isLg
    ? 'text-muted-foreground hover:text-foreground hover:bg-background/60 border-2 border-transparent'
    : 'text-muted-foreground hover:text-foreground'
  return (
    <div className={wrapperClass}>
      {options.map(opt => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            disabled={opt.disabled}
            title={opt.title}
            onClick={() => !opt.disabled && onChange(opt.value)}
            className={btnBase + (active ? activeClass : inactiveClass)}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function StatusTile({
  label, value, tone, sub,
}: { label: string; value: string; tone: 'good' | 'warn' | 'bad' | 'off'; sub?: string }) {
  // The whole card carries the tone now (no separate status dot). This
  // keeps a single, scannable signal: green = healthy/configured,
  // amber = needs attention, rose = broken, neutral = not connected.
  const toneClass =
    tone === 'good' ? 'border-emerald-500/40 bg-emerald-500/10' :
    tone === 'warn' ? 'border-amber-500/40 bg-amber-500/10' :
    tone === 'bad'  ? 'border-rose-500/50 bg-rose-500/10' :
                       'border-border bg-card'
  const labelClass =
    tone === 'good' ? 'text-emerald-700 dark:text-emerald-400' :
    tone === 'warn' ? 'text-amber-700 dark:text-amber-400' :
    tone === 'bad'  ? 'text-rose-700 dark:text-rose-400' :
                       'text-muted-foreground'
  return (
    <div className={`rounded-lg border p-3 flex flex-col items-center text-center min-h-[6.5rem] justify-center ${toneClass}`}>
      <span className={`text-xs uppercase tracking-wide mb-1 ${labelClass}`}>{label}</span>
      <p className="text-sm font-medium break-all">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1 break-all">{sub}</p>}
    </div>
  )
}

function _StatusBadge({ tone, label }: { tone: 'good' | 'warn' | 'bad' | 'off'; label: string }) {
  const cls =
    tone === 'good' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' :
    tone === 'warn' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' :
    tone === 'bad'  ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400' :
                       'bg-muted text-muted-foreground'
  const Icon =
    tone === 'good' ? CheckCircle2 :
    tone === 'warn' ? AlertCircle :
    tone === 'bad'  ? AlertCircle :
                       Circle
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${cls}`}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  )
}

function Field({
  label, sublabel, hint, children,
}: { label: string; sublabel?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="flex items-baseline gap-2 mb-1">
        <span className="text-xs font-medium">{label}</span>
        {sublabel && <span className="text-[10px] text-muted-foreground">{sublabel}</span>}
      </span>
      {children}
      {hint && <span className="block text-[10px] text-muted-foreground mt-1">{hint}</span>}
    </label>
  )
}
