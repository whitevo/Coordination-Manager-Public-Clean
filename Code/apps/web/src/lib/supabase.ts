import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Tolerant Supabase client
// ---------------------------------------------------------------------------
// If env vars are missing the app should still boot so the Setup Wizard at
// /setup can render. We construct a client against a non-routable URL and
// expose `isSupabaseConfigured` so feature code can avoid making calls that
// would fail anyway.
// ---------------------------------------------------------------------------

const PLACEHOLDER_URL = 'http://localhost:0'
// JWT-shaped placeholder so the supabase-js constructor accepts it.
const PLACEHOLDER_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.placeholder-not-configured'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || PLACEHOLDER_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || PLACEHOLDER_KEY
export const AUTH_REMEMBER_ME_STORAGE_KEY = 'coord-auth-remember-me'

function isSupabaseAuthKey(key: string): boolean {
  return /^sb-.+-auth-token(?:-code-verifier)?$/.test(key)
}

function getAuthStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined
  return isAuthPersistenceRemembered() ? window.localStorage : window.sessionStorage
}

function moveAuthKeys(source: Storage, destination: Storage): void {
  for (let index = 0; index < source.length; index += 1) {
    const key = source.key(index)
    if (!key || !isSupabaseAuthKey(key)) continue
    const value = source.getItem(key)
    if (value !== null) destination.setItem(key, value)
    source.removeItem(key)
    index -= 1
  }
}

export function isAuthPersistenceRemembered(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(AUTH_REMEMBER_ME_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function setAuthPersistence(rememberMe: boolean): void {
  if (typeof window === 'undefined') return
  try {
    if (rememberMe) {
      window.localStorage.setItem(AUTH_REMEMBER_ME_STORAGE_KEY, 'true')
      moveAuthKeys(window.sessionStorage, window.localStorage)
    } else {
      window.localStorage.removeItem(AUTH_REMEMBER_ME_STORAGE_KEY)
      moveAuthKeys(window.localStorage, window.sessionStorage)
    }
  } catch {
    // Storage may be unavailable in private browsing or locked-down contexts.
  }
}

// Existing installations stored every session locally. Move those tokens to
// the safer session-only default until the user explicitly chooses Remember me.
if (typeof window !== 'undefined' && !isAuthPersistenceRemembered()) {
  try {
    moveAuthKeys(window.localStorage, window.sessionStorage)
  } catch {
    // Storage may be unavailable in private browsing or locked-down contexts.
  }
}

export const authStorage = {
  getItem(key: string): string | null {
    try {
      return getAuthStorage()?.getItem(key) ?? null
    } catch {
      return null
    }
  },
  setItem(key: string, value: string): void {
    try {
      const selectedStorage = getAuthStorage()
      if (!selectedStorage || typeof window === 'undefined') return
      selectedStorage.setItem(key, value)
      const otherStorage = selectedStorage === window.localStorage
        ? window.sessionStorage
        : window.localStorage
      otherStorage.removeItem(key)
    } catch {
      // Storage may be unavailable in private browsing or locked-down contexts.
    }
  },
  removeItem(key: string): void {
    if (typeof window === 'undefined') return
    try { window.localStorage.removeItem(key) } catch { /* ignore */ }
    try { window.sessionStorage.removeItem(key) } catch { /* ignore */ }
  },
}

export const isSupabaseConfigured: boolean = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
)

if (!isSupabaseConfigured) {
   
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set. ' +
      'The app is running in UNCONFIGURED mode -- visit /setup to configure.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: typeof window !== 'undefined'
    ? {
        storage: authStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // PKCE keeps tokens out of the URL. The code verifier is stored via
        // authStorage (keys matching *-code-verifier), which survives the
        // same-tab OAuth redirect in both sessionStorage and localStorage modes.
        flowType: 'pkce',
      }
    : {
        persistSession: false,
        autoRefreshToken: false,
      },
})
