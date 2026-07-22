import { supabase } from './supabase'
import { apiClient, clearInflightRequests } from './api-client'
import { clearTimezoneStorage } from './use-timezones'
import type { Session, User as SupabaseUser } from '@supabase/supabase-js'
import type { ThemePreferences } from './theme-types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isTransientProfileError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false
  }

  const code = typeof error.code === 'string' ? error.code : ''
  const message = typeof error.message === 'string' ? error.message : ''
  const status = isRecord(error.response) && typeof error.response.status === 'number'
    ? error.response.status
    : null

  if (status !== null && status >= 500) {
    return true
  }

  return (
    code === 'ERR_NETWORK' ||
    code === 'ECONNABORTED' ||
    message.includes('Network Error') ||
    message.includes('ERR_HTTP2_PROTOCOL_ERROR')
  )
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function isEmbeddedAuthBrowser(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false
  }

  const isFramed = window.self !== window.top

  return isFramed
}

function clearOAuthReturnState(): void {
  try {
    sessionStorage.removeItem('authReturnTo')
  } catch {
    // ignore storage errors
  }
}

export async function clearStaleAuthState(): Promise<void> {
  clearOAuthReturnState()

  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) {
      console.error('Failed to clear stale auth state:', error)
    }
  } catch (error) {
    console.error('Failed to clear stale auth state:', error)
  }
}

export interface AuthUser {
  id: string
  email: string
  displayName?: string
  avatarUrl?: string
  timezone?: string
  defaultReminderMinutes?: number
  roles?: string[]
  accountType?: 'google' | 'traveler' | 'cardano' | 'managed_cardano'
  travelerName?: string
  expiresAt?: string
  walletAddress?: string
  encryptedWalletBlob?: string
  themePreferences?: ThemePreferences | null
}

/**
 * Initiate Google OAuth login via Supabase.
 * This redirects the user to Google's consent screen.
 * On localhost, you go through the real Google sign-in process.
 */
export async function signInWithGoogle(): Promise<void> {
  if (isEmbeddedAuthBrowser()) {
    throw new Error('Google sign-in must be completed in a standard browser window. Open Coordination Manager in Chrome, Edge, Firefox, or Safari and try again.')
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  })

  if (error) {
    console.error('Google sign-in error:', error)
    await clearStaleAuthState()
    throw error
  }
}

/**
 * Create a Traveler (guest) account — no email or password needed.
 * Returns the session so the frontend can set it.
 */
export async function signInAsTraveler(captchaToken?: string): Promise<{ session: Session; user: AuthUser }> {
  let response
  try {
    response = await apiClient.post('/api/auth/guest', { captchaToken })
  } catch (err: unknown) {
    // Surface the server error message/code when available
    const axiosErr = err as { response?: { data?: { message?: string; error?: string } } }
    const serverMsg = axiosErr.response?.data?.message
    const serverCode = axiosErr.response?.data?.error
    if (serverMsg) {
      throw new Error(serverMsg)
    }
    if (serverCode === 'CAPTCHA_ERROR') {
      throw new Error('Security check failed. Please refresh the page and try again.')
    }
    throw new Error('Failed to create traveler account. Please try again.')
  }
  const { session: sessionData, user } = response.data

  // Set the session in Supabase client so auth state updates
  const { data, error } = await supabase.auth.setSession({
    access_token: sessionData.access_token,
    refresh_token: sessionData.refresh_token,
  })

  if (error || !data.session) {
    throw new Error('Failed to establish traveler session')
  }

  return {
    session: data.session,
    user: {
      id: user.id,
      email: user.email || '',
      displayName: user.displayName,
      roles: user.roles || ['user'],
      accountType: user.accountType,
      travelerName: user.travelerName || user.displayName,
      expiresAt: user.expiresAt,
    } as AuthUser,
  }
}

/**
 * Register a brand-new account with an app-managed Cardano wallet.
 * No authentication required -- creates a managed_cardano account in one step.
 */
export async function registerWithManagedWallet(wallet: {
  address: string
  encryptedBlob: string
  publicKeyHex: string
}): Promise<{ session: Session; user: AuthUser }> {
  let response
  try {
    response = await apiClient.post('/api/auth/wallet/managed/register', {
      address: wallet.address,
      encryptedBlob: wallet.encryptedBlob,
      publicKey: wallet.publicKeyHex,
    })
  } catch (err: unknown) {
    const axiosErr = err as { response?: { data?: { message?: string; error?: string } } }
    const serverMsg = axiosErr.response?.data?.message
    if (serverMsg) throw new Error(serverMsg)
    throw new Error('Failed to create wallet account. Please try again.')
  }

  const { session: sessionData, user } = response.data

  const { data, error } = await supabase.auth.setSession({
    access_token: sessionData.access_token,
    refresh_token: sessionData.refresh_token,
  })

  if (error || !data.session) {
    throw new Error('Failed to establish wallet session')
  }

  return {
    session: data.session,
    user: {
      id: user.id,
      email: '',
      displayName: user.displayName,
      roles: user.roles || ['user'],
      accountType: user.accountType as AuthUser['accountType'],
      walletAddress: user.walletAddress,
    } as AuthUser,
  }
}

/**
 * Sign out the current user
 */
export async function signOut(): Promise<void> {
  // Try to notify backend
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) {
      await apiClient.post('/api/auth/logout', {}, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
    }
  } catch {
    // Backend logout is best-effort
  }

  // Always clear local caches, even if Supabase signOut fails — prevents
  // previous account data from leaking to the next login.
  try {
    const { error } = await supabase.auth.signOut()
    if (error) {
      console.error('Sign-out error:', error)
    }
  } finally {
    // Clear all cached session data (AI assistant messages, form drafts, etc.)
    sessionStorage.clear()

    // Clear per-account timezone preference so it does not leak to the next account
    clearTimezoneStorage()

    // Clear user-specific localStorage keys so data does not leak to the next account.
    // Theme preferences (theme-preferences, theme-mode, etc.) are intentionally preserved.
    const USER_SPECIFIC_KEYS = [
      'cm-ann-email-integration',
      'cm-collapsed-guilds',
      'cm-channels-last-synced',
      'pendingCalendarData',
      'calendarSourceSelections',
      'adminPowers',
      'lastFriendSeenAt',
      'pendingAccountLink',
      'userCalendarSettings',
      'rateLimitWarnAt',
    ]
    for (const key of USER_SPECIFIC_KEYS) {
      try { localStorage.removeItem(key) } catch { /* ignore */ }
    }

    // Flush in-flight request deduplication cache
    clearInflightRequests()
  }
}

/**
 * Get the current Supabase session
 */
export async function getSession(): Promise<Session | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

/**
 * Fetch the user profile from our API backend
 */
export async function fetchUserProfile(accessToken: string): Promise<AuthUser> {
  const MAX_ATTEMPTS = 3
  let lastError: unknown = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await apiClient.get('/api/auth/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      return response.data.user as AuthUser
    } catch (error) {
      lastError = error
      const shouldRetry = attempt < MAX_ATTEMPTS && isTransientProfileError(error)
      if (!shouldRetry) {
        throw error
      }
      await delay(attempt * 250)
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to fetch user profile.')
}

/**
 * Update user profile via API
 */
export async function updateUserProfile(
  accessToken: string,
  updates: { displayName?: string; timezone?: string; defaultReminderMinutes?: number }
): Promise<AuthUser> {
  const response = await apiClient.put('/api/auth/profile', updates, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  return response.data.user as AuthUser
}

/**
 * Map a Supabase user to our AuthUser type (fallback when backend is unavailable)
 */
export function mapSupabaseUser(user: SupabaseUser): AuthUser {
  const accountType = (user.user_metadata?.account_type as AuthUser['accountType']) || 'google'
  const isTraveler = accountType === 'traveler'
  const isCardano = accountType === 'cardano'
  return {
    id: user.id,
    email: user.email || '',
    displayName: user.user_metadata?.full_name || user.user_metadata?.name || user.user_metadata?.display_name || user.email || '',
    avatarUrl: user.user_metadata?.avatar_url || user.user_metadata?.picture || undefined,
    roles: isTraveler ? ['traveler'] : ['user'],
    accountType,
    travelerName: isTraveler ? (user.user_metadata?.display_name || undefined) : undefined,
    walletAddress: isCardano ? (user.user_metadata?.wallet_address || undefined) : undefined,
  }
}
