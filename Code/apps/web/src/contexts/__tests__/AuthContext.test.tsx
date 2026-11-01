import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { AuthProvider, useAuth } from '../AuthContext'

const mockGetSession = vi.fn()
const mockOnAuthStateChange = vi.fn()
const mockUnsubscribe = vi.fn()

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(...args),
    },
  },
}))

vi.mock('../../lib/auth-service', () => ({
  signInWithGoogle: vi.fn(),
  signInAsTraveler: vi.fn(),
  registerWithManagedWallet: vi.fn(),
  signOut: vi.fn(),
  fetchUserProfile: vi.fn(),
  updateUserProfile: vi.fn(),
  mapSupabaseUser: vi.fn(),
}))

vi.mock('../../lib/cardano-wallet', () => ({
  signInWithCardanoWallet: vi.fn(),
}))

vi.mock('../../lib/use-timezones', () => ({
  STORAGE_KEY: 'test-timezones',
}))

function AuthProbe() {
  const { isLoading, isAuthenticated } = useAuth()

  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="authenticated">{String(isAuthenticated)}</span>
    </div>
  )
}

describe('AuthProvider', () => {
  beforeEach(() => {
    mockGetSession.mockReset()
    mockOnAuthStateChange.mockReset()
    mockUnsubscribe.mockReset()
    mockOnAuthStateChange.mockReturnValue({
      data: {
        subscription: {
          unsubscribe: mockUnsubscribe,
        },
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('clears loading state when Supabase session initialization fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockGetSession.mockRejectedValue(new Error('Supabase origin timeout'))

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false')
    })

    expect(screen.getByTestId('authenticated')).toHaveTextContent('false')
    expect(warnSpy).toHaveBeenCalledWith(
      'Supabase session initialization failed:',
      expect.any(Error),
    )
  })
})