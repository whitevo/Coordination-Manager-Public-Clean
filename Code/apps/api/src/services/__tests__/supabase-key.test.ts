import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSupabaseSecretKeyName, getSupabaseServerKey } from '../supabase-key.js'

vi.mock('fs', () => ({ existsSync: () => false, readFileSync: vi.fn(), promises: {} }))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('environment-specific Supabase credential selection', () => {
  it.each(['development', 'test', undefined])('uses only localhost in %s mode', mode => {
    const env = {
      NODE_ENV: mode,
      SUPABASE_SECRET_KEY_LOCALHOST: 'local',
      SUPABASE_SECRET_KEY_PRODUCTION: 'production',
      SUPABASE_SERVICE_ROLE_KEY: 'legacy',
    }
    expect(getSupabaseServerKey(env)).toEqual({ name: 'SUPABASE_SECRET_KEY_LOCALHOST', value: 'local' })
  })

  it('uses only production in production mode', () => {
    expect(getSupabaseServerKey({
      NODE_ENV: 'production',
      SUPABASE_SECRET_KEY_LOCALHOST: 'local',
      SUPABASE_SECRET_KEY_PRODUCTION: 'production',
      SUPABASE_SERVICE_ROLE_KEY: 'legacy',
    })).toEqual({ name: 'SUPABASE_SECRET_KEY_PRODUCTION', value: 'production' })
  })

  it.each(['development', 'production'])('ignores legacy when selected key is absent in %s', mode => {
    const env = { NODE_ENV: mode, SUPABASE_SERVICE_ROLE_KEY: 'legacy' }
    expect(getSupabaseServerKey(env)).toEqual({ name: getSupabaseSecretKeyName(env), value: undefined })
  })

  it.each(['', ' ', 'invalid-new-key'])('preserves a configured invalid key (%s), never falls back', value => {
    expect(getSupabaseServerKey({
      SUPABASE_SECRET_KEY_LOCALHOST: value,
      SUPABASE_SERVICE_ROLE_KEY: 'legacy',
    })).toEqual({ name: 'SUPABASE_SECRET_KEY_LOCALHOST', value })
  })

  it.each(['development', 'production'])('never borrows the other environment key in %s', mode => {
    const opposite = mode === 'production' ? 'SUPABASE_SECRET_KEY_LOCALHOST' : 'SUPABASE_SECRET_KEY_PRODUCTION'
    expect(getSupabaseServerKey({ NODE_ENV: mode, [opposite]: 'wrong-environment' }).value).toBeUndefined()
  })

  it.each(['development', 'production'])('keeps setup status and masking consistent in %s', async mode => {
    vi.stubEnv('NODE_ENV', mode)
    vi.stubEnv('SUPABASE_SECRET_KEY_LOCALHOST', 'sb_secret_offline-local-credential')
    vi.stubEnv('SUPABASE_SECRET_KEY_PRODUCTION', 'sb_secret_offline-production-credential')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', undefined)
    const config = await import('../local-config.js')
    expect(config.OPTIONAL_FEATURE_KEYS.admin).toEqual([getSupabaseSecretKeyName()])
    expect(config.getOptionalFeatureStatus().admin).toBe(true)
    for (const key of ['SUPABASE_SECRET_KEY_LOCALHOST', 'SUPABASE_SECRET_KEY_PRODUCTION']) {
      expect(config.WRITABLE_API_ENV_KEYS.has(key)).toBe(true)
      expect(config.WRITABLE_BOT_ENV_KEYS.has(key)).toBe(true)
      expect(config.WRITABLE_GUARDIAN_ENV_KEYS.has(key)).toBe(true)
      const entry = config.getMaskedEnvSnapshot().api[key]
      expect(entry.isSecret).toBe(true)
      expect(entry.masked).not.toContain('offline')
      expect(entry.runtime).toBeUndefined()
    }
    vi.stubEnv(getSupabaseSecretKeyName(), undefined)
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'offline-legacy-key')
    expect(config.getOptionalFeatureStatus().admin).toBe(false)
    expect(config.WRITABLE_API_ENV_KEYS.has('SUPABASE_SERVICE_ROLE_KEY')).toBe(false)
    expect(config.WRITABLE_BOT_ENV_KEYS.has('SUPABASE_SERVICE_ROLE_KEY')).toBe(false)
    expect(config.WRITABLE_GUARDIAN_ENV_KEYS.has('SUPABASE_SERVICE_ROLE_KEY')).toBe(false)
    expect(config.getMaskedEnvSnapshot().api).not.toHaveProperty('SUPABASE_SERVICE_ROLE_KEY')
    vi.stubEnv(getSupabaseSecretKeyName(), '')
    expect(config.getOptionalFeatureStatus().admin).toBe(false)
  })
})
