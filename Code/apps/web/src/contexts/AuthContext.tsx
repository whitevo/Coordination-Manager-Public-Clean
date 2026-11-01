import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { isAuthPersistenceRemembered, setAuthPersistence, supabase } from '../lib/supabase'
import {
  signInWithGoogle,
  signInAsTraveler,
  registerWithManagedWallet,
  signOut,
  fetchUserProfile,
  updateUserProfile,
  mapSupabaseUser,
  type AuthUser,
} from '../lib/auth-service'
import { signInWithCardanoWallet } from '../lib/cardano-wallet'
import { STORAGE_KEY as TZ_STORAGE_KEY } from '../lib/use-timezones'
import { recordActivity, hasExceededInactivityLimit, clearActivity } from '../lib/session-activity'
import type { CardanoWalletId } from '../lib/cardano-types'
import type { Session } from '@supabase/supabase-js'

interface AuthContextType {
  user: AuthUser | null
  session: Session | null
  isLoading: boolean
  isAuthenticated: boolean
  isTraveler: boolean
  isCardano: boolean
  login: (rememberMe?: boolean) => Promise<void>
  loginAsTraveler: (captchaToken?: string, rememberMe?: boolean) => Promise<void>
  loginWithCardano: (walletId: CardanoWalletId, captchaToken?: string, rememberMe?: boolean) => Promise<void>
  registerWithManagedWallet: (wallet: { address: string; encryptedBlob: string; publicKeyHex: string }) => Promise<void>
  logout: () => Promise<void>
  updateProfile: (updates: { displayName?: string; timezone?: string; defaultReminderMinutes?: number }) => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

async function getInitialSessionWithTimeout(): Promise<Session | null> {
  const result = await Promise.race([
    supabase.auth.getSession(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
  ])

  if (!result) {
    return null
  }

  if (result.error) {
    throw result.error
  }

  return result.data.session
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Guard against concurrent profile loads from getSession + onAuthStateChange
  const initializedRef = useRef(false)
  // Suppress onAuthStateChange user-clearing during wallet login flow
  const walletLoginInProgressRef = useRef(false)
  const lastProfileFallbackWarnAtRef = useRef(0)

  /**
   * Load user profile from our backend using the Supabase access token
   */
  const loadUserProfile = useCallback(async (currentSession: Session) => {
    try {
      const profile = await fetchUserProfile(currentSession.access_token)
      setUser(profile)
      // Sync account timezone from DB into localStorage so useTimezones() picks it up
      if (profile.timezone) {
        try {
          const raw = localStorage.getItem(TZ_STORAGE_KEY)
          const current = raw ? JSON.parse(raw) as { primary?: string; additional?: string[] } : null
          const additional = current?.additional ?? []
          localStorage.setItem(TZ_STORAGE_KEY, JSON.stringify({ primary: profile.timezone, additional }))
        } catch {
          // ignore localStorage errors
        }
      }
    } catch (error) {
      const now = Date.now()
      const WARN_COOLDOWN_MS = 60_000
      if (now - lastProfileFallbackWarnAtRef.current >= WARN_COOLDOWN_MS) {
        console.warn('Backend profile fetch failed, using Supabase user data:', error)
        lastProfileFallbackWarnAtRef.current = now
      }
      // Fall back to Supabase user metadata
      setUser(mapSupabaseUser(currentSession.user))
    }
  }, [])

  /**
   * Initialize: check for existing session and listen for auth changes
   */
  useEffect(() => {
    // Safety timeout: never let isLoading stay true for more than 5 seconds
    const safetyTimer = setTimeout(() => {
      setIsLoading(false)
    }, 5000)

    // Get initial session
    getInitialSessionWithTimeout()
      .then(async (currentSession) => {
        // A persistent (localStorage) login is bounded by an inactivity window
        // rather than staying valid indefinitely -- force a fresh login instead
        // of silently restoring a long-dormant session.
        if (currentSession && isAuthPersistenceRemembered() && hasExceededInactivityLimit()) {
          clearActivity()
          await supabase.auth.signOut({ scope: 'local' })
          currentSession = null
        }

        setSession(currentSession)
        if (currentSession) {
          initializedRef.current = true
          if (isAuthPersistenceRemembered()) recordActivity()
          loadUserProfile(currentSession).finally(() => {
            clearTimeout(safetyTimer)
            setIsLoading(false)
          })
        } else {
          initializedRef.current = true
          clearTimeout(safetyTimer)
          setIsLoading(false)
        }
      })
      .catch((error) => {
        console.warn('Supabase session initialization failed:', error)
        initializedRef.current = true
        setSession(null)
        setUser(null)
        clearTimeout(safetyTimer)
        setIsLoading(false)
      })

    // Listen for auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, currentSession) => {
        // During a wallet login flow, signOut({scope:'local'}) fires SIGNED_OUT
        // followed immediately by setSession() firing SIGNED_IN. Skip these
        // intermediate events — handleLoginWithCardano will set state directly.
        if (walletLoginInProgressRef.current) return

        setSession(currentSession)

        // Skip if this is the initial session event — already handled above
        if (!initializedRef.current) return

        // On INITIAL_SESSION events fired after getSession already ran, skip
        if (event === 'INITIAL_SESSION') return

        if (currentSession) {
          if (isAuthPersistenceRemembered()) recordActivity()
          await loadUserProfile(currentSession)
        } else {
          setUser(null)
        }

        setIsLoading(false)
      }
    )

    return () => {
      clearTimeout(safetyTimer)
      subscription.unsubscribe()
    }
  }, [loadUserProfile])

  const handleLogin = useCallback(async (rememberMe?: boolean) => {
    try {
      if (typeof rememberMe === 'boolean') setAuthPersistence(rememberMe)
      await signInWithGoogle()
    } catch (err) {
      // AbortError is expected: signInWithOAuth redirects the page, which
      // aborts any in-flight fetch/promise. Ignore it silently.
      if (err instanceof Error && err.name === 'AbortError') return
      throw err
    }
  }, [])

  const handleLoginAsTraveler = useCallback(async (captchaToken?: string, rememberMe?: boolean) => {
    if (typeof rememberMe === 'boolean') setAuthPersistence(rememberMe)
    const { session: travelerSession, user: travelerUser } = await signInAsTraveler(captchaToken)
    setSession(travelerSession)
    setUser(travelerUser)
  }, [])

  const handleRegisterWithManagedWallet = useCallback(async (
    wallet: { address: string; encryptedBlob: string; publicKeyHex: string }
  ) => {
    const { session: newSession, user: newUser } = await registerWithManagedWallet(wallet)
    setSession(newSession)
    setUser(newUser)
  }, [])

  const handleLoginWithCardano = useCallback(async (walletId: CardanoWalletId, captchaToken?: string, rememberMe?: boolean) => {
    // Suppress onAuthStateChange events during the login flow to prevent
    // the intermediate signOut({scope:'local'}) from clearing user/session
    // state and causing a flash of unauthenticated UI or a crash.
    walletLoginInProgressRef.current = true
    try {
      if (typeof rememberMe === 'boolean') setAuthPersistence(rememberMe)
      const { session: cardanoSession, user: cardanoUser } = await signInWithCardanoWallet(walletId, captchaToken)
      setSession(cardanoSession)
      setUser(cardanoUser)
    } finally {
      walletLoginInProgressRef.current = false
    }
  }, [])

  const handleLogout = useCallback(async () => {
    try {
      await signOut()
    } catch (err) {
      console.error('Logout failed, forcing local cleanup:', err)
    }
    clearActivity()
    // Always clear local state, even if the server-side signOut failed
    setUser(null)
    setSession(null)
  }, [])

  const handleUpdateProfile = useCallback(async (
    updates: { displayName?: string; timezone?: string; defaultReminderMinutes?: number }
  ) => {
    if (!session?.access_token) {
      throw new Error('Not authenticated')
    }
    const updatedUser = await updateUserProfile(session.access_token, updates)
    setUser(updatedUser)
  }, [session])

  const handleRefreshProfile = useCallback(async () => {
    if (session) {
      await loadUserProfile(session)
    }
  }, [session, loadUserProfile])

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        isLoading,
        isAuthenticated: !!user && !!session,
        isTraveler: user?.accountType === 'traveler',
        isCardano: user?.accountType === 'cardano' || user?.accountType === 'managed_cardano',
        login: handleLogin,
        loginAsTraveler: handleLoginAsTraveler,
        loginWithCardano: handleLoginWithCardano,
        registerWithManagedWallet: handleRegisterWithManagedWallet,
        logout: handleLogout,
        updateProfile: handleUpdateProfile,
        refreshProfile: handleRefreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- hook intentionally co-located with its provider
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
