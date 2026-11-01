import { afterEach, expect, it, vi } from 'vitest'

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it.each([
  ['development', true, 'sb_secret_offline-local'],
  ['production', true, 'sb_secret_offline-production'],
] as const)('selects coordinator key in %s with new setting present=%s', async (mode, present, key) => {
  vi.resetModules()
  vi.stubEnv('NODE_ENV', mode)
  vi.stubEnv('SUPABASE_URL', 'https://offline-project.supabase.co')
  vi.stubEnv('SUPABASE_SECRET_KEY_LOCALHOST', mode !== 'production' && !present ? undefined : 'sb_secret_offline-local')
  vi.stubEnv('SUPABASE_SECRET_KEY_PRODUCTION', mode === 'production' && !present ? undefined : 'sb_secret_offline-production')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'offline-legacy')
  const fetchMock = vi.fn<typeof fetch>(async () => new Response('[]', {
    headers: { 'Content-Type': 'application/json' },
  }))
  vi.stubGlobal('fetch', fetchMock)
  const { supabase, isSupabaseConfigured } = await import('../supabase.js')
  expect(isSupabaseConfigured).toBe(true)
  if (!supabase) throw new Error('Expected configured coordinator client')
  expect((await supabase.from('users').select('id')).error).toBeNull()
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const headers = new Headers(fetchMock.mock.calls[0][1]?.headers)
  expect(headers.get('apikey')).toBe(key)
  expect(headers.get('authorization')).toBe(`Bearer ${key}`)
  expect((await supabase.auth.getSession()).data.session).toBeNull()
})

it.each(['development', 'production'])('stays unconfigured without the selected coordinator key in %s', async mode => {
  vi.resetModules()
  vi.stubEnv('NODE_ENV', mode)
  vi.stubEnv('SUPABASE_URL', 'https://offline-project.supabase.co')
  const selected = mode === 'production' ? 'SUPABASE_SECRET_KEY_PRODUCTION' : 'SUPABASE_SECRET_KEY_LOCALHOST'
  const opposite = mode === 'production' ? 'SUPABASE_SECRET_KEY_LOCALHOST' : 'SUPABASE_SECRET_KEY_PRODUCTION'
  vi.stubEnv(selected, undefined)
  vi.stubEnv(opposite, 'sb_secret_offline-wrong-environment')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'offline-legacy')
  const fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
  const { supabase, isSupabaseConfigured, missingSupabaseEnvVars } = await import('../supabase.js')
  expect(supabase).toBeNull()
  expect(isSupabaseConfigured).toBe(false)
  expect(missingSupabaseEnvVars).toEqual([selected])
  expect(fetchMock).not.toHaveBeenCalled()
})

it('refuses an empty selected coordinator key instead of falling back', async () => {
  vi.resetModules()
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('SUPABASE_SECRET_KEY_PRODUCTION', '')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'offline-legacy')
  await expect(import('../supabase.js')).rejects.toThrow('is empty')
})

it('does not retry a rejected coordinator key with legacy credentials', async () => {
  vi.resetModules()
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubEnv('SUPABASE_URL', 'https://offline-project.supabase.co')
  vi.stubEnv('SUPABASE_SECRET_KEY_LOCALHOST', 'sb_secret_offline-rejected')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'offline-legacy')
  const fetchMock = vi.fn<typeof fetch>(async () => new Response('{"message":"Invalid API key"}', {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  }))
  vi.stubGlobal('fetch', fetchMock)
  const { supabase } = await import('../supabase.js')
  if (!supabase) throw new Error('Expected configured coordinator client')
  expect((await supabase.from('users').select('id')).status).toBe(401)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('apikey')).toBe('sb_secret_offline-rejected')
})
