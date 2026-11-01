import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { mockTheme } = vi.hoisted(() => ({
  mockTheme: {
    mode: 'dark' as 'light' | 'dark',
    isDark: true,
    activeThemeId: 'preset-forest' as string | null,
    activeColorTheme: null,
    customThemes: [],
    setMode: vi.fn(),
    toggleDark: vi.fn(),
    applyTheme: vi.fn(),
    saveCustomTheme: vi.fn(),
    deleteCustomTheme: vi.fn(),
    reloadThemeFromBackend: vi.fn(),
    showNavThemeToggle: true,
    setShowNavThemeToggle: vi.fn(),
  },
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', roles: [], displayName: 'Robin', email: 'robin@example.test' },
    session: null,
    logout: vi.fn(),
    isTraveler: false,
    isCardano: false,
    isAuthenticated: true,
    isLoading: false,
    refreshProfile: vi.fn(),
  }),
}))

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => mockTheme,
}))

vi.mock('../../contexts/LearnerModeContext', () => ({
  useLearnerMode: () => ({ learnerMode: false, setLearnerMode: vi.fn() }),
}))

vi.mock('../../lib/api-client', () => ({
  RATE_LIMIT_WARN_EVENT: 'rate-limit-warn',
  apiClient: {
    get: vi.fn(async () => ({ data: {} })),
    put: vi.fn(async () => ({ data: {} })),
    post: vi.fn(async () => ({ data: {} })),
    delete: vi.fn(async () => ({ data: {} })),
  },
  dedupedGet: vi.fn(async () => ({ data: {} })),
}))

import SettingsPage from '../SettingsPage'

beforeEach(() => {
  vi.clearAllMocks()
  mockTheme.showNavThemeToggle = true
  Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() })
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const renderAt = (url: string) => render(
  <MemoryRouter initialEntries={[url]}>
    <SettingsPage />
  </MemoryRouter>
)

describe('SettingsPage Appearance theme mode', { timeout: 15000 }, () => {
  it('offers only Light and Dark theme modes', () => {
    renderAt('/settings?tab=profile')
    const section = document.getElementById('settings-theme-mode')
    expect(section).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: 'System' })).toBeNull()
  })

  it('scrolls to and focuses the Theme mode section from the nav deep link', () => {
    vi.useFakeTimers()
    renderAt('/settings?tab=profile&section=theme-mode')
    act(() => { vi.advanceTimersByTime(250) })
    const section = document.getElementById('settings-theme-mode')
    expect(section).toHaveFocus()
    expect(window.scrollTo).toHaveBeenCalled()
  })

  it('switches theme mode from the Light toggle', () => {
    renderAt('/settings?tab=profile')
    fireEvent.click(screen.getByRole('button', { name: 'Light' }))
    expect(mockTheme.setMode).toHaveBeenCalledWith('light')
  })

  it('pins and unpins the nav Theme icon', () => {
    renderAt('/settings?tab=profile')
    fireEvent.click(screen.getByRole('button', { name: 'Remove theme icon quick button' }))
    expect(mockTheme.setShowNavThemeToggle).toHaveBeenCalledWith(false)
  })

  it('offers to pin the Theme icon again when it is hidden', () => {
    mockTheme.showNavThemeToggle = false
    renderAt('/settings?tab=profile')
    fireEvent.click(screen.getByRole('button', { name: 'Add theme icon quick button' }))
    expect(mockTheme.setShowNavThemeToggle).toHaveBeenCalledWith(true)
  })
})
