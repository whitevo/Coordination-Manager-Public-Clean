import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'

const { mockTheme } = vi.hoisted(() => ({
  mockTheme: {
    mode: 'dark' as 'light' | 'dark',
    isDark: true,
    activeThemeId: 'preset-forest' as string | null,
    customThemes: [],
    setMode: vi.fn(),
    applyTheme: vi.fn(),
    toggleDark: vi.fn(),
    showNavThemeToggle: true,
    setShowNavThemeToggle: vi.fn(),
  },
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', roles: [], displayName: 'Robin' },
    isAuthenticated: true,
    isLoading: false,
    isTraveler: false,
    login: vi.fn(),
    loginAsTraveler: vi.fn(),
    registerWithManagedWallet: vi.fn(),
    logout: vi.fn(),
    refreshProfile: vi.fn(),
  }),
}))

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => mockTheme,
}))

vi.mock('../../contexts/SetupContext', () => ({
  useSetup: () => ({ status: null, shouldTakeOver: false }),
}))

vi.mock('../../contexts/LearnerModeContext', () => ({
  useLearnerMode: () => ({ learnerMode: false, setLearnerMode: vi.fn() }),
}))

vi.mock('../../lib/use-captcha-mode', () => ({
  useCaptchaMode: () => ({ captchaMode: 'off' }),
}))

vi.mock('../../lib/api-client', () => ({
  RATE_LIMIT_WARN_EVENT: 'rate-limit-warn',
  RATE_LIMIT_WARN_TTL_MS: 120_000,
  getPersistedRateLimitWarn: vi.fn(() => ({ active: false, since: null })),
  apiClient: {
    get: vi.fn(async (url: string) => ({ data: url === '/api/connections/new-count' ? { count: 2 } : {} })),
    put: vi.fn(async () => ({ data: {} })),
    post: vi.fn(async () => ({ data: {} })),
    delete: vi.fn(async () => ({ data: {} })),
  },
  dedupedGet: vi.fn(async () => ({ data: {} })),
}))

import Layout from '../Layout'

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() })
  mockTheme.showNavThemeToggle = true
})

afterEach(() => cleanup())

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>
}

const renderLayout = () => render(
  <MemoryRouter>
    <Layout />
    <LocationProbe />
  </MemoryRouter>
)

describe('Layout nav theme button and account menu', { timeout: 15000 }, () => {
  it('shows a pinned Palette theme button that opens the Settings Theme mode section', () => {
    renderLayout()
    expect(screen.queryByTitle(/Switch to (light|dark) mode/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Theme settings' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/settings?tab=profile&section=theme-mode')
    expect(mockTheme.toggleDark).not.toHaveBeenCalled()
  })

  it('hides the theme button when it is unpinned in Settings', () => {
    mockTheme.showNavThemeToggle = false
    renderLayout()
    expect(screen.queryByRole('button', { name: 'Theme settings' })).toBeNull()
  })

  it('opens the account menu on click without a theme picker and closes it with Escape', () => {
    renderLayout()
    const accountButton = screen.getByRole('button', { name: 'Account menu: Robin' })
    expect(accountButton).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(accountButton)
    expect(accountButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByRole('group', { name: 'Theme' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Theme' })).toBeNull()

    fireEvent.keyDown(accountButton, { key: 'Escape' })
    expect(accountButton).toHaveAttribute('aria-expanded', 'false')
    expect(accountButton).toHaveFocus()
  })

  it('pulses the new-friend pill with primary tokens and a reduced-motion fallback', async () => {
    renderLayout()
    const pill = await waitFor(() => screen.getByRole('link', { name: /New friend requests/ }))
    expect(pill).toHaveClass('animate-pulse', 'motion-reduce:animate-none', 'bg-primary-subtle', 'text-primary')
  })
})
