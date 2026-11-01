import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useAuth } from './AuthContext'
import {
  type ColorTheme,
  type ThemeColors,
  type ThemePreferences,
  PRESET_THEMES,
  COLOR_VAR_MAP,
  ACTIVE_THEME_CACHE_KEY,
  DEFAULT_DARK_THEME_ID,
  createDefaultThemePreferences,
} from '../lib/theme-types'
import { apiClient, dedupedGet } from '../lib/api-client'

/** Appearance mode. The old 'system' mode is migrated on load (see resolveStoredMode). */
type ThemeMode = 'light' | 'dark'

interface ThemeContextType {
  /** Current theme mode: 'light' or 'dark' */
  mode: ThemeMode
  /** Whether the active appearance is dark */
  isDark: boolean
  /** Set theme mode */
  setMode: (mode: ThemeMode) => void
  /** Toggle between light and dark */
  toggleDark: () => void

  /** Whether the Theme (palette) button is pinned to the nav menu bar (default true) */
  showNavThemeToggle: boolean
  /** Pin or unpin the Theme button in the nav menu bar */
  setShowNavThemeToggle: (show: boolean) => void

  /** ID of the color-theme overlay for the *current* mode (dark or light) */
  activeThemeId: string | null
  /** The resolved active ColorTheme object, or null for default */
  activeColorTheme: ColorTheme | null
  /** User's saved custom themes */
  customThemes: ColorTheme[]

  /** Apply a color-theme overlay for the *current* mode (null = reset) */
  applyTheme: (themeId: string | null) => void
  /** Save a custom theme (add or update) */
  saveCustomTheme: (theme: ColorTheme) => void
  /** Delete a custom theme by ID */
  deleteCustomTheme: (themeId: string) => void
  /**
   * Force a re-fetch of theme preferences from the backend.
   * Call this after an account merge so the new merged settings
   * (custom themes, notification settings, etc.) are picked up.
   */
  reloadThemeFromBackend: () => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

function getSystemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return true // matchMedia unavailable: keep the dark default
  }
}

/**
 * Concrete mode for a stored value. The 'system' option was removed, so a
 * saved 'system' resolves once to the current OS preference (callers persist
 * the result so the migration does not repeat).
 */
function resolveStoredMode(mode: ThemePreferences['mode'] | null | undefined): ThemeMode {
  if (mode === 'light' || mode === 'dark') return mode
  if (mode === 'system') return getSystemPrefersDark() ? 'dark' : 'light'
  return 'dark'
}

// ─── Persistence helpers ──────────────────────────────────────────────

function loadLocal(): ThemePreferences {
  try {
    const raw = localStorage.getItem('theme-preferences')
    if (raw) {
      const parsed = JSON.parse(raw) as ThemePreferences
      // Ensure fields exist even if missing in old data
      if (parsed.darkThemeId === undefined) (parsed as { darkThemeId: string | null }).darkThemeId = null
      if (parsed.lightThemeId === undefined) (parsed as { lightThemeId: string | null }).lightThemeId = null
      if (parsed.mode !== 'light' && parsed.mode !== 'dark') {
        // One-time migration of the removed 'system' mode (or a corrupt value)
        const migrated: ThemePreferences = { ...parsed, mode: resolveStoredMode(parsed.mode) }
        saveLocal(migrated)
        return migrated
      }
      return parsed
    }
  } catch { /* ignore */ }

  // Migrate from old localStorage keys
  const oldMode = localStorage.getItem('theme-mode') as ThemePreferences['mode'] | null
  const oldEnabled = localStorage.getItem('random-color-enabled') === 'true'
  const oldThemeRaw = localStorage.getItem('active-color-theme')

  // Nothing saved at all: a new visitor gets the default "Dark Forest" theme.
  // Keep this in sync with the first-paint bootstrap script in index.html.
  if (!oldMode && !oldThemeRaw) return createDefaultThemePreferences()
  let oldThemeName: string | null = null
  if (oldThemeRaw) {
    try { oldThemeName = (JSON.parse(oldThemeRaw) as { name: string }).name } catch { /* ignore */ }
  }

  // Map old random theme name to new preset ID
  let legacyThemeId: string | null = null
  if (oldEnabled && oldThemeName) {
    const preset = PRESET_THEMES.find(p => p.name === oldThemeName)
    if (preset) legacyThemeId = preset.id
  }

  const legacyPrefs: ThemePreferences = {
    mode: resolveStoredMode(oldMode),
    darkThemeId: legacyThemeId,
    lightThemeId: null,
    customThemes: [],
  }
  if (oldMode === 'system') saveLocal(legacyPrefs)
  return legacyPrefs
}

function saveLocal(prefs: ThemePreferences) {
  localStorage.setItem('theme-preferences', JSON.stringify(prefs))
  // Also keep the legacy key; its presence marks a returning visitor (see index.html bootstrap)
  localStorage.setItem('theme-mode', prefs.mode)
}

// Debounced save to backend
let saveTimer: ReturnType<typeof setTimeout> | null = null
function saveToBackend(prefs: ThemePreferences) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      await apiClient.put('/api/auth/profile', { themePreferences: prefs })
    } catch {
      // Best-effort — if backend is down we still have localStorage
    }
  }, 1000)
}

// ─── Apply CSS variables ──────────────────────────────────────────────

function applyCssVariables(colors: ThemeColors | null) {
  const root = document.documentElement
  // Clear first so a theme that omits a key never inherits the previous theme's value
  for (const cssVar of Object.values(COLOR_VAR_MAP)) {
    root.style.removeProperty(cssVar)
  }
  if (!colors) return // fall back to the index.css defaults
  for (const [key, cssVar] of Object.entries(COLOR_VAR_MAP)) {
    const value = colors[key as keyof ThemeColors]
    if (value) root.style.setProperty(cssVar, value)
  }
}

/**
 * Remember the resolved overlay so the index.html bootstrap can paint it
 * before React mounts (no flash of the default palette on reload).
 */
function cacheActiveTheme(theme: ColorTheme | null) {
  try {
    if (!theme) {
      localStorage.removeItem(ACTIVE_THEME_CACHE_KEY)
      return
    }
    const vars: Record<string, string> = {}
    for (const [key, cssVar] of Object.entries(COLOR_VAR_MAP)) {
      const value = theme.colors[key as keyof ThemeColors]
      if (value) vars[cssVar] = value
    }
    localStorage.setItem(ACTIVE_THEME_CACHE_KEY, JSON.stringify({ id: theme.id, vars }))
  } catch {
    // Storage full or blocked: first paint falls back to the bootstrap defaults
  }
}

// ─── Provider ─────────────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading: authLoading, user } = useAuth()
  // Increment to trigger a forced reload from backend (e.g. after account merge)
  const [backendLoadKey, setBackendLoadKey] = useState(0)
  const lastLoadedKey = useRef(-1)

  // ─── State ──────────────────────────────────────────────────
  const [prefs, setPrefs] = useState<ThemePreferences>(loadLocal)

  // loadLocal and the backend loader migrate 'system', so this is already concrete
  const mode = resolveStoredMode(prefs.mode)
  const isDark = mode === 'dark'

  const activeThemeIdForMode = isDark ? prefs.darkThemeId : prefs.lightThemeId

  const allThemes = useMemo(
    () => [...PRESET_THEMES, ...prefs.customThemes],
    [prefs.customThemes]
  )

  const activeColorTheme = useMemo(
    () => allThemes.find(t => t.id === activeThemeIdForMode) || null,
    [allThemes, activeThemeIdForMode]
  )

  // ─── Persist helper (functional updater — avoids stale closures) ──
  const persistUpdate = useCallback((updater: (prev: ThemePreferences) => ThemePreferences) => {
    setPrefs(prev => {
      const next = updater(prev)
      saveLocal(next)
      if (isAuthenticated) saveToBackend(next)
      return next
    })
  }, [isAuthenticated])

  // ─── Mode ────────────────────────────────────────────────────
  const setMode = useCallback((m: ThemeMode) => {
    persistUpdate(prev => ({ ...prev, mode: m }))
  }, [persistUpdate])

  const toggleDark = useCallback(() => {
    setMode(isDark ? 'light' : 'dark')
  }, [isDark, setMode])

  const showNavThemeToggle = prefs.showNavThemeToggle ?? true
  const setShowNavThemeToggle = useCallback((show: boolean) => {
    persistUpdate(prev => ({ ...prev, showNavThemeToggle: show }))
  }, [persistUpdate])

  // Apply / remove `.dark` class on <html>
  useEffect(() => {
    const root = document.documentElement
    if (isDark) root.classList.add('dark')
    else root.classList.remove('dark')
  }, [isDark])

  // ─── Color theme (per-mode overlay) ───────────────────────────────
  const applyTheme = useCallback((themeId: string | null) => {
    persistUpdate(prev => {
      // Resolve which mode is currently active
      const currentlyDark = resolveStoredMode(prev.mode) === 'dark'
      if (currentlyDark) {
        return { ...prev, darkThemeId: themeId }
      } else {
        return { ...prev, lightThemeId: themeId }
      }
    })
  }, [persistUpdate])

  const saveCustomTheme = useCallback((theme: ColorTheme) => {
    persistUpdate(prev => {
      const existing = prev.customThemes.findIndex(t => t.id === theme.id)
      const updated = [...prev.customThemes]
      if (existing >= 0) {
        updated[existing] = theme
      } else {
        // Enforce max 3 custom themes
        if (updated.length >= 3) return prev
        updated.push(theme)
      }
      return { ...prev, customThemes: updated }
    })
  }, [persistUpdate])

  const deleteCustomTheme = useCallback((themeId: string) => {
    persistUpdate(prev => {
      const updated = prev.customThemes.filter(t => t.id !== themeId)
      return {
        ...prev,
        customThemes: updated,
        darkThemeId: prev.darkThemeId === themeId ? null : prev.darkThemeId,
        lightThemeId: prev.lightThemeId === themeId ? null : prev.lightThemeId,
      }
    })
  }, [persistUpdate])

  // Apply CSS variables whenever active theme or mode changes
  useEffect(() => {
    applyCssVariables(activeColorTheme ? activeColorTheme.colors : null)
    cacheActiveTheme(activeColorTheme)
  }, [activeColorTheme, isDark])

  // Load theme preferences from AuthContext user data (avoids duplicate /api/auth/me call)
  const _appliedUserIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!isAuthenticated || !user) return
    // On normal login, read theme prefs from the user object already fetched by AuthContext
    if (backendLoadKey === 0 && lastLoadedKey.current >= 0) return // already applied
    // For forced reloads (backendLoadKey > 0, e.g. after account merge), fetch fresh
    if (backendLoadKey > 0 && lastLoadedKey.current === backendLoadKey) return

    const applyPrefs = (backendPrefs: ThemePreferences | null | undefined) => {
      if (backendPrefs) {
        // The JSONB also stores notification/calendar/AI settings. Without a saved
        // mode the account never chose a theme, so it gets the new-user default;
        // with one, a missing overlay id means "no overlay" (their choice).
        const hasSavedTheme = Boolean(backendPrefs.mode)
        const merged: ThemePreferences = {
          ...backendPrefs,
          mode: resolveStoredMode(backendPrefs.mode),
          darkThemeId: hasSavedTheme ? backendPrefs.darkThemeId ?? null : backendPrefs.darkThemeId ?? DEFAULT_DARK_THEME_ID,
          lightThemeId: backendPrefs.lightThemeId ?? null,
          customThemes: backendPrefs.customThemes ?? [],
        }
        setPrefs(merged)
        saveLocal(merged)
        // One-time migration of the removed 'system' mode on the account too
        if (backendPrefs.mode === 'system') saveToBackend(merged)
      }
      lastLoadedKey.current = backendLoadKey
    }

    if (backendLoadKey > 0) {
      // Forced reload (e.g. after account merge) — fetch fresh from backend
      dedupedGet<{ user?: { themePreferences?: ThemePreferences | null } }>('/api/auth/me').then(res => {
        applyPrefs(res.data?.user?.themePreferences as ThemePreferences | null)
      }).catch(() => { /* best-effort */ })
    } else {
      // Normal login — reuse user data from AuthContext (no extra API call)
      applyPrefs(user.themePreferences)
    }
  }, [isAuthenticated, user, backendLoadKey])  

  // Reset to clean defaults once auth has resolved as signed out (logout, or a
  // visit without a session). Waiting for auth to resolve keeps a returning
  // user's saved theme on screen instead of flashing the defaults first.
  useEffect(() => {
    if (authLoading || isAuthenticated) return
    lastLoadedKey.current = -1
    // Clear custom themes and revert to the default "Dark Forest" theme
    const cleanDefaults = createDefaultThemePreferences()
    setPrefs(cleanDefaults)
    saveLocal(cleanDefaults)
  }, [authLoading, isAuthenticated])

  const reloadThemeFromBackend = useCallback(() => {
    setBackendLoadKey(k => k + 1)
  }, [])

  return (
    <ThemeContext.Provider
      value={{
        mode,
        isDark,
        setMode,
        toggleDark,
        showNavThemeToggle,
        setShowNavThemeToggle,
        activeThemeId: activeThemeIdForMode,
        activeColorTheme,
        customThemes: prefs.customThemes,
        applyTheme,
        saveCustomTheme,
        deleteCustomTheme,
        reloadThemeFromBackend,
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- hook intentionally co-located with its provider
export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
