import { afterEach, expect, it, vi } from 'vitest'

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it.each([
  ['development', true, 'sb_secret_offline-local'],
  ['production', true, 'sb_secret_offline-production'],
] as const)('selects Guardian key in %s with new setting present=%s', async (mode, present, key) => {
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
  const { supabase } = await import('../supabase.js')
  expect((await supabase.from('users').select('id')).error).toBeNull()
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const headers = new Headers(fetchMock.mock.calls[0][1]?.headers)
  expect(headers.get('apikey')).toBe(key)
  expect(headers.get('authorization')).toBe(`Bearer ${key}`)
  expect((await supabase.auth.getSession()).data.session).toBeNull()
})

it.each(['development', 'production'])('exits without the selected Guardian key in %s', async mode => {
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
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('Guardian configuration exit')
  })
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    await expect(import('../supabase.js')).rejects.toThrow('Guardian configuration exit')
    expect(exit).toHaveBeenCalledWith(1)
    expect(log).toHaveBeenCalledWith(`Missing SUPABASE_URL or ${selected}`)
    expect(fetchMock).not.toHaveBeenCalled()
  } finally {
    exit.mockRestore()
    log.mockRestore()
  }
})

it('refuses an empty selected Guardian key instead of falling back', async () => {
  vi.resetModules()
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('SUPABASE_SECRET_KEY_PRODUCTION', '')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'offline-legacy')
  await expect(import('../supabase.js')).rejects.toThrow('is empty')
})

it('does not retry a rejected Guardian key with legacy credentials', async () => {
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
  expect((await supabase.from('users').select('id')).status).toBe(401)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('apikey')).toBe('sb_secret_offline-rejected')
})
