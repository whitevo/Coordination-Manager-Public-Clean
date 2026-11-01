import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Layout from '../Layout'
import { dedupedGet, getPersistedRateLimitWarn } from '../../lib/api-client'

const { mockAccount } = vi.hoisted(() => ({
  mockAccount: { user: null as { id: string; roles: string[] } | null, isAuthenticated: false },
}))

// Mock dependencies required by Layout
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mockAccount.user,
    isAuthenticated: mockAccount.isAuthenticated,
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
  useTheme: () => ({
    isDark: false,
    toggleDark: vi.fn(),
  }),
}))

vi.mock('../../contexts/SetupContext', () => ({
  useSetup: () => ({
    status: null,
    shouldTakeOver: false,
  }),
}))

vi.mock('../../contexts/LearnerModeContext', () => ({
  useLearnerMode: () => ({
    learnerMode: false,
    setLearnerMode: vi.fn(),
  }),
}))

vi.mock('../../lib/use-captcha-mode', () => ({
  useCaptchaMode: () => ({ captchaMode: 'off' }),
}))

vi.mock('../../lib/api-client', () => ({
  RATE_LIMIT_WARN_EVENT: 'rate-limit-warn',
  RATE_LIMIT_WARN_TTL_MS: 120_000,
  getPersistedRateLimitWarn: vi.fn(() => ({ active: false, since: null })),
  apiClient: {
    get: vi.fn(async () => ({ data: {} })),
    put: vi.fn(async () => ({ data: {} })),
    post: vi.fn(async () => ({ data: {} })),
    delete: vi.fn(async () => ({ data: {} })),
  },
  dedupedGet: vi.fn(async () => ({ data: {} })),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockAccount.user = null
  mockAccount.isAuthenticated = false
  vi.useRealTimers()
  localStorage.clear()
  sessionStorage.clear()
  Object.defineProperty(window, 'scrollTo', {
    configurable: true,
    value: vi.fn(),
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Documentation navigation in Assistance ribbon and QuickMenu', { timeout: 15000 }, () => {
  it('does not restart the full warning lifetime when an admin refreshes the page', () => {
    vi.useFakeTimers()
    mockAccount.user = { id: 'admin', roles: ['admin'] }
    vi.mocked(getPersistedRateLimitWarn).mockReturnValueOnce({
      active: true, since: new Date(Date.now() - 30_000).toISOString(),
    })
    render(<MemoryRouter><Layout /></MemoryRouter>)
    expect(screen.getByTestId('request-limit-warning')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(89_999))
    expect(screen.getByTestId('request-limit-warning')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.queryByTestId('request-limit-warning')).toBeNull()
  })

  it('leaves provider checks to the open Mailbox instead of starting a second sync from navigation', async () => {
    mockAccount.isAuthenticated = true
    mockAccount.user = { id: 'mailbox-user', roles: [] }
    render(<MemoryRouter initialEntries={['/mailbox']}><Layout /></MemoryRouter>)
    await waitFor(() => expect(dedupedGet).toHaveBeenCalledWith('/api/mailbox/notifications/check'))
    expect(dedupedGet).not.toHaveBeenCalledWith('/api/mailbox/accounts')
  })

  it('uses the warning foreground on its icon and clears live warnings for admins too', () => {
    mockAccount.user = { id: 'admin', roles: ['admin'] }
    const { container } = render(<MemoryRouter><Layout /></MemoryRouter>)
    act(() => window.dispatchEvent(new CustomEvent('rate-limit-warn', { detail: { warn: true } })))
    expect(screen.getByTestId('request-limit-warning')).toHaveTextContent('approaching an API request limit')
    expect(container.querySelector('[data-testid="request-limit-warning"] svg')).toHaveClass('text-warning-foreground')
    act(() => window.dispatchEvent(new CustomEvent('rate-limit-warn', { detail: { warn: false } })))
    expect(screen.queryByTestId('request-limit-warning')).toBeNull()
  })

  it('uses a subdued active state for Tools options while keeping the pinned tool highlight strongest', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/time-management']}>
        <Layout />
      </MemoryRouter>
    )

    const toolsButton = screen.getByRole('button', { name: 'Tools' })
    fireEvent.mouseEnter(toolsButton)

    const toolsMenu = toolsButton.parentElement
    const activeToolsOption = toolsMenu?.querySelector('a[href="/time-management"]')
    expect(toolsButton).toHaveClass('bg-accent/30', 'text-foreground')
    expect(activeToolsOption).toHaveClass('bg-accent/30', 'text-foreground')

    const activePinnedTool = container.querySelector('a[aria-label="Time Management"]')
    expect(activePinnedTool).toHaveClass('bg-accent', 'text-accent-foreground')
  })

  it('uses a subdued active state for the Assistance trigger and open panel option', () => {
    sessionStorage.setItem('cm-active-right-panel', 'ai')
    render(<MemoryRouter><Layout /></MemoryRouter>)

    const assistanceButton = screen.getByRole('button', { name: 'Assistance' })
    fireEvent.mouseEnter(assistanceButton)

    expect(assistanceButton).toHaveClass('bg-accent/30', 'text-foreground')
    expect(screen.getByRole('menuitem', { name: /AI Assistant/i })).toHaveClass('bg-accent/30', 'text-foreground')
  })

  it('uses subdued active states for Tools and Assistance options in the mobile menu', () => {
    sessionStorage.setItem('cm-active-right-panel', 'ai')
    const { container } = render(
      <MemoryRouter initialEntries={['/time-management']}>
        <Layout />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))
    const mobileMenu = screen.getByTestId('mobile-navigation-scroll')
    const activeToolsOption = mobileMenu.querySelector('a[href="/time-management"]')
    const activeAssistanceOption = Array.from(mobileMenu.querySelectorAll('[role="button"]'))
      .find((option) => option.textContent?.trim() === 'AI Assistant')

    expect(activeToolsOption).toHaveClass('bg-accent/30', 'text-foreground')
    expect(activeAssistanceOption).toHaveClass('bg-accent/30', 'text-foreground')

    const activePinnedTool = container.querySelector('a[aria-label="Time Management"]')
    expect(activePinnedTool).toHaveClass('bg-accent', 'text-accent-foreground')
  })

  it('pins Guardian on desktop, persists it, and exposes its pin on mobile', async () => {
    const { unmount } = render(<MemoryRouter><Layout /></MemoryRouter>)
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Tools' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add Discord Guardian quick button' }))
    expect(JSON.parse(localStorage.getItem('cm-nav-quick-tools')!)).toContain('guardian')
    unmount()
    const { container } = render(<MemoryRouter><Layout /></MemoryRouter>)
    expect(container.querySelectorAll('a[title="Discord Guardian"][href="/guardian"]').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Discord Guardian quick button' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('cm-nav-quick-tools')!)).not.toContain('guardian'))
  })

  it.each(['Platform Oversight', 'User List'])('pins %s only while admin block power is enabled', async (label) => {
    mockAccount.user = { id: 'admin-test', roles: ['admin'] }
    localStorage.setItem('adminPowers', JSON.stringify({ blockPower: true }))
    const key = label === 'User List' ? 'admin-users' : 'admin-oversight'
    const href = label === 'User List' ? '/admin/users' : '/admin/oversight'
    const { container } = render(<MemoryRouter><Layout /></MemoryRouter>)
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Tools' }))
    fireEvent.click(screen.getByRole('button', { name: `Add ${label} quick button` }))
    expect(container.querySelectorAll(`a[title="${label}"][href="${href}"]`).length).toBeGreaterThan(0)
    act(() => window.dispatchEvent(new CustomEvent('adminPowersChanged', { detail: { blockPower: false } })))
    expect(container.querySelectorAll(`a[title="${label}"][href="${href}"]`)).toHaveLength(0)
    expect(JSON.parse(localStorage.getItem('cm-nav-quick-tools')!)).toContain(key)
    act(() => window.dispatchEvent(new CustomEvent('adminPowersChanged', { detail: { blockPower: true } })))
    expect(container.querySelectorAll(`a[title="${label}"][href="${href}"]`).length).toBeGreaterThan(0)
  })

  it('does not display stored admin pins or pin controls to a non-admin', () => {
    localStorage.setItem('cm-nav-quick-tools', JSON.stringify(['admin-users', 'admin-oversight', 'guardian']))
    localStorage.setItem('adminPowers', JSON.stringify({ blockPower: true }))
    const { container } = render(<MemoryRouter><Layout /></MemoryRouter>)
    expect(container.querySelectorAll('a[title="User List"], a[title="Platform Oversight"]')).toHaveLength(0)
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Tools' }))
    expect(screen.queryByRole('button', { name: 'Remove User List quick button' })).not.toBeInTheDocument()
    expect(container.querySelectorAll('a[title="Discord Guardian"]').length).toBeGreaterThan(0)
  })

  it('renders Documentation option in Assistance dropdown pointing to local docs in dev', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Layout />
      </MemoryRouter>
    )

    // Open Assistance menu
    const assistanceBtn = screen.getByRole('button', { name: 'Assistance' })
    fireEvent.mouseEnter(assistanceBtn)

    const docLink = screen.getByRole('menuitem', { name: /Documentation/i })
    expect(docLink).toBeInTheDocument()
    expect(docLink).toHaveAttribute('href', 'http://localhost:5174/docs/overview')
    expect(docLink).toHaveAttribute('target', '_blank')
  })

  it('allows pinning Documentation to quickmenu', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <Layout />
      </MemoryRouter>
    )

    // Open Assistance menu
    const assistanceBtn = screen.getByRole('button', { name: 'Assistance' })
    fireEvent.mouseEnter(assistanceBtn)

    // Pin Documentation
    const pinBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Add Documentation quick button"]')
    expect(pinBtn).toBeInTheDocument()
    fireEvent.click(pinBtn as HTMLButtonElement)

    // Verify it is now pinned in quick menu bar
    const pinnedQuickLink = container.querySelector<HTMLAnchorElement>(
      'nav a[aria-label="Documentation"][href="http://localhost:5174/docs/overview"]:not([role])'
    )
    expect(pinnedQuickLink).toBeInTheDocument()
  })
})
