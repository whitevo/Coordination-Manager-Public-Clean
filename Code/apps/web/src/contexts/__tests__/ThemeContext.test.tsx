import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ThemePreferences } from '../../lib/theme-types'

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: {
    isAuthenticated: false,
    isLoading: false,
    user: null as { id: string; themePreferences?: Partial<ThemePreferences> | null } | null,
  },
}))

vi.mock('../AuthContext', () => ({
  useAuth: () => mockAuth,
}))

vi.mock('../../lib/api-client', () => ({
  apiClient: { put: vi.fn(async () => ({ data: {} })) },
  dedupedGet: vi.fn(async () => ({ data: {} })),
}))

import { ThemeProvider, useTheme } from '../ThemeContext'

const wrapper = ({ children }: { children: ReactNode }) => <ThemeProvider>{children}</ThemeProvider>
const root = document.documentElement
const storedPrefs = () => JSON.parse(localStorage.getItem('theme-preferences') ?? 'null') as ThemePreferences | null

beforeEach(() => {
  localStorage.clear()
  root.className = ''
  root.removeAttribute('style')
  mockAuth.isAuthenticated = false
  mockAuth.isLoading = false
  mockAuth.user = null
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ThemeProvider defaults', () => {
  it('gives a new visitor the Forest preset in dark mode', () => {
    const { result } = renderHook(() => useTheme(), { wrapper })
    expect(result.current.mode).toBe('dark')
    expect(result.current.isDark).toBe(true)
    expect(result.current.activeThemeId).toBe('preset-forest')
    expect(root).toHaveClass('dark')
    expect(root.style.getPropertyValue('--background')).toBe('160 40% 7%')
    expect(JSON.parse(localStorage.getItem('theme-active-colors') ?? 'null')).toMatchObject({
      id: 'preset-forest',
      vars: { '--background': '160 40% 7%' },
    })
  })

  it('keeps a saved localStorage preference while auth is still resolving', () => {
    mockAuth.isLoading = true
    localStorage.setItem('theme-preferences', JSON.stringify({
      mode: 'light', darkThemeId: null, lightThemeId: 'preset-ocean', customThemes: [],
    }))
    const { result } = renderHook(() => useTheme(), { wrapper })
    expect(result.current.mode).toBe('light')
    expect(result.current.activeThemeId).toBe('preset-ocean')
    expect(root).not.toHaveClass('dark')
    expect(storedPrefs()?.lightThemeId).toBe('preset-ocean')
  })

  it('keeps a legacy theme-mode choice without forcing the Forest overlay', () => {
    mockAuth.isLoading = true
    localStorage.setItem('theme-mode', 'dark')
    const { result } = renderHook(() => useTheme(), { wrapper })
    expect(result.current.isDark).toBe(true)
    expect(result.current.activeThemeId).toBeNull()
    expect(root.style.getPropertyValue('--background')).toBe('')
  })

  it('keeps an account preference saved on the server', () => {
    mockAuth.isAuthenticated = true
    mockAuth.user = {
      id: 'user-1',
      themePreferences: { mode: 'dark', darkThemeId: null, lightThemeId: null, customThemes: [] },
    }
    const { result } = renderHook(() => useTheme(), { wrapper })
    expect(result.current.isDark).toBe(true)
    expect(result.current.activeThemeId).toBeNull()
  })

  it('gives an account without a saved theme (other settings only) the Forest default', () => {
    mockAuth.isAuthenticated = true
    mockAuth.user = { id: 'user-2', themePreferences: { customThemes: [] } }
    const { result } = renderHook(() => useTheme(), { wrapper })
    expect(result.current.mode).toBe('dark')
    expect(result.current.activeThemeId).toBe('preset-forest')
  })

  it('resets to Dark Forest after sign-out', () => {
    mockAuth.isAuthenticated = true
    mockAuth.user = {
      id: 'user-3',
      themePreferences: { mode: 'light', darkThemeId: null, lightThemeId: 'preset-rose', customThemes: [] },
    }
    const { result, rerender } = renderHook(() => useTheme(), { wrapper })
    expect(result.current.activeThemeId).toBe('preset-rose')

    mockAuth.isAuthenticated = false
    mockAuth.user = null
    rerender()
    expect(result.current.mode).toBe('dark')
    expect(result.current.activeThemeId).toBe('preset-forest')
  })

  it('applies a picked preset and mode instantly', () => {
    const { result } = renderHook(() => useTheme(), { wrapper })
    act(() => result.current.applyTheme('preset-lavender'))
    expect(result.current.activeThemeId).toBe('preset-lavender')
    expect(root.style.getPropertyValue('--background')).toBe('265 45% 8%')

    act(() => result.current.setMode('light'))
    expect(result.current.isDark).toBe(false)
    expect(result.current.activeThemeId).toBeNull()
    expect(root).not.toHaveClass('dark')
    expect(root.style.getPropertyValue('--background')).toBe('')
    expect(localStorage.getItem('theme-active-colors')).toBeNull()
  })
})

const stubPrefersDark = (matches: boolean) => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
}

describe('ThemeProvider removed system mode', () => {
  it('migrates a saved system mode once to the OS preference and persists it', () => {
    mockAuth.isLoading = true
    stubPrefersDark(false)
    localStorage.setItem('theme-preferences', JSON.stringify({
      mode: 'system', darkThemeId: null, lightThemeId: 'preset-ocean', customThemes: [],
    }))
    const { result } = renderHook(() => useTheme(), { wrapper })
    expect(result.current.mode).toBe('light')
    expect(result.current.isDark).toBe(false)
    expect(result.current.activeThemeId).toBe('preset-ocean')
    expect(storedPrefs()?.mode).toBe('light')
    expect(localStorage.getItem('theme-mode')).toBe('light')
  })

  it('migrates a legacy theme-mode=system key to dark when the OS prefers dark', () => {
    mockAuth.isLoading = true
    stubPrefersDark(true)
    localStorage.setItem('theme-mode', 'system')
    const { result } = renderHook(() => useTheme(), { wrapper })
    expect(result.current.mode).toBe('dark')
    expect(storedPrefs()?.mode).toBe('dark')
  })

  it('migrates a system mode saved on the account and writes it back', async () => {
    vi.useFakeTimers()
    try {
      const { apiClient } = await import('../../lib/api-client')
      stubPrefersDark(true)
      mockAuth.isAuthenticated = true
      mockAuth.user = {
        id: 'user-4',
        themePreferences: { mode: 'system', darkThemeId: null, lightThemeId: null, customThemes: [] },
      }
      const { result } = renderHook(() => useTheme(), { wrapper })
      expect(result.current.mode).toBe('dark')
      expect(storedPrefs()?.mode).toBe('dark')
      act(() => { vi.advanceTimersByTime(1100) })
      expect(apiClient.put).toHaveBeenCalledWith('/api/auth/profile', {
        themePreferences: expect.objectContaining({ mode: 'dark' }),
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('ThemeProvider nav theme button pin', () => {
  it('is pinned by default for new users', () => {
    const { result } = renderHook(() => useTheme(), { wrapper })
    expect(result.current.showNavThemeToggle).toBe(true)
  })

  it('treats saved preferences without the field as pinned', () => {
    mockAuth.isLoading = true
    localStorage.setItem('theme-preferences', JSON.stringify({
      mode: 'dark', darkThemeId: null, lightThemeId: null, customThemes: [],
    }))
    const { result } = renderHook(() => useTheme(), { wrapper })
    expect(result.current.showNavThemeToggle).toBe(true)
  })

  it('unpins and pins again, persisting the choice', () => {
    mockAuth.isLoading = true
    const { result } = renderHook(() => useTheme(), { wrapper })
    act(() => result.current.setShowNavThemeToggle(false))
    expect(result.current.showNavThemeToggle).toBe(false)
    expect(storedPrefs()?.showNavThemeToggle).toBe(false)
    act(() => result.current.setShowNavThemeToggle(true))
    expect(result.current.showNavThemeToggle).toBe(true)
  })
})
