import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSession = vi.fn()
const onAuthStateChange = vi.fn()
const clearStaleAuthState = vi.fn()

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSession(...args),
      onAuthStateChange: (...args: unknown[]) => onAuthStateChange(...args),
    },
  },
}))

vi.mock('../../../lib/auth-service', () => ({
  clearStaleAuthState: () => clearStaleAuthState(),
}))

import AuthCallbackPage from '../AuthCallbackPage'

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}</div>
}

function renderCallback(search: string) {
  window.history.replaceState({}, '', `/auth/callback${search}`)
  return render(
    <MemoryRouter initialEntries={[`/auth/callback${search}`]}>
      <Routes>
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('AuthCallbackPage (PKCE)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    clearStaleAuthState.mockResolvedValue(undefined)
    onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
  })

  it('redirects to the stored return path once the ?code= exchange yields a session', async () => {
    sessionStorage.setItem('authReturnTo', '/calendars')
    getSession.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null })

    renderCallback('?code=abc123')

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/calendars'), { timeout: 3000 })
    expect(clearStaleAuthState).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('authReturnTo')).toBeNull()
  })

  it('shows the provider error and clears stale auth state when an error param is present', async () => {
    renderCallback('?error=access_denied&error_description=User+cancelled')

    expect(await screen.findByText('User cancelled')).toBeTruthy()
    expect(screen.getByText('Authentication Failed')).toBeTruthy()
    expect(clearStaleAuthState).toHaveBeenCalled()
    expect(getSession).not.toHaveBeenCalled()
  })
})
