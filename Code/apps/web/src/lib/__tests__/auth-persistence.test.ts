import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: {} })),
}))

import {
  authStorage,
  isAuthPersistenceRemembered,
  setAuthPersistence,
} from '../supabase'

const AUTH_TOKEN_KEY = 'sb-project-auth-token'

describe('auth persistence storage', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    setAuthPersistence(false)
  })

  it('uses session storage by default', () => {
    authStorage.setItem(AUTH_TOKEN_KEY, 'session-token')

    expect(isAuthPersistenceRemembered()).toBe(false)
    expect(sessionStorage.getItem(AUTH_TOKEN_KEY)).toBe('session-token')
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull()
  })

  it('moves existing auth state to local storage when Remember me is enabled', () => {
    authStorage.setItem(AUTH_TOKEN_KEY, 'remembered-token')

    setAuthPersistence(true)

    expect(isAuthPersistenceRemembered()).toBe(true)
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBe('remembered-token')
    expect(sessionStorage.getItem(AUTH_TOKEN_KEY)).toBeNull()
  })

  it('moves remembered auth state back to session storage when disabled', () => {
    setAuthPersistence(true)
    authStorage.setItem(AUTH_TOKEN_KEY, 'temporary-token')

    setAuthPersistence(false)

    expect(isAuthPersistenceRemembered()).toBe(false)
    expect(sessionStorage.getItem(AUTH_TOKEN_KEY)).toBe('temporary-token')
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull()
  })
})