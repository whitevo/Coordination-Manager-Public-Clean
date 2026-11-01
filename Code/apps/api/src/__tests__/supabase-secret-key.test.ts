import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Never load real credentials: every SDK request is intercepted below.
vi.mock('dotenv', () => ({ default: { config: vi.fn() } }))

const SECRET_KEY = 'sb_secret_offline-api-credential'
const PUBLIC_KEY = 'sb_publishable_offline-public-credential'
const USER_TOKEN = 'offline-user-access-token'
const fetchMock = vi.fn<typeof fetch>()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function lastHeaders(): Headers {
  const call = fetchMock.mock.calls.at(-1)
  if (!call) throw new Error('Expected an intercepted SDK request')
  return new Headers(call[1]?.headers)
}

beforeEach(() => {
  vi.resetModules()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => jsonResponse([]))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('SUPABASE_URL', 'https://offline-project.supabase.co')
  vi.stubEnv('SUPABASE_KEY', PUBLIC_KEY)
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubEnv('SUPABASE_SECRET_KEY_LOCALHOST', SECRET_KEY)
  vi.stubEnv('SUPABASE_SECRET_KEY_PRODUCTION', 'sb_secret_offline-production-credential')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'offline-legacy-key')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('Supabase secret API key compatibility (offline real SDK)', () => {
  it('uses the secret apikey for admin data requests with SDK-managed headers', async () => {
    const { supabaseAdmin } = await import('../supabaseClient.js')
    const { error } = await supabaseAdmin.from('users').select('id')
    expect(error).toBeNull()
    expect(lastHeaders().get('apikey')).toBe(SECRET_KEY)
    expect(lastHeaders().get('authorization')).toBe(`Bearer ${SECRET_KEY}`)
  })

  it('keeps public requests on the public key', async () => {
    const { supabase } = await import('../supabaseClient.js')
    await supabase.from('calendars').select('id')
    expect(lastHeaders().get('apikey')).toBe(PUBLIC_KEY)
    expect(lastHeaders().get('authorization')).toBe(`Bearer ${PUBLIC_KEY}`)
  })

  it('supports admin Auth operations using the secret key', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ users: [] }))
    const { supabaseAdmin } = await import('../supabaseClient.js')
    const result = await supabaseAdmin.auth.admin.listUsers()
    expect(result.error).toBeNull()
    expect(lastHeaders().get('apikey')).toBe(SECRET_KEY)
    expect(lastHeaders().get('authorization')).toBe(`Bearer ${SECRET_KEY}`)
  })

  it('isolates password sign-in sessions from admin and other request clients', async () => {
    const { supabaseAdmin } = await import('../supabaseClient.js')
    const { createIsolatedAuthClient } = await import('../middleware/auth.js')
    const first = createIsolatedAuthClient()
    const second = createIsolatedAuthClient()
    expect(first).not.toBe(second)
    fetchMock.mockResolvedValueOnce(jsonResponse({
      access_token: USER_TOKEN,
      refresh_token: 'offline-refresh-token',
      token_type: 'bearer',
      expires_in: 3600,
      user: { id: 'offline-user', aud: 'authenticated' },
    }))
    const signedIn = await first.auth.signInWithPassword({
      email: 'offline@example.com',
      password: 'offline-password',
    })
    expect(signedIn.error).toBeNull()
    expect(signedIn.data.session?.access_token).toBe(USER_TOKEN)
    expect(lastHeaders().get('apikey')).toBe(SECRET_KEY)
    expect(lastHeaders().get('authorization')).toBe(`Bearer ${SECRET_KEY}`)
    expect((await first.auth.getSession()).data.session?.access_token).toBe(USER_TOKEN)
    expect((await second.auth.getSession()).data.session).toBeNull()
    expect((await supabaseAdmin.auth.getSession()).data.session).toBeNull()
    await supabaseAdmin.from('users').select('id')
    expect(lastHeaders().get('apikey')).toBe(SECRET_KEY)
    expect(lastHeaders().get('authorization')).toBe(`Bearer ${SECRET_KEY}`)
  })

  it('sends a user access token separately from the application key', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'offline-user' }))
    const { supabase } = await import('../supabaseClient.js')
    const result = await supabase.auth.getUser(USER_TOKEN)
    expect(result.error).toBeNull()
    expect(lastHeaders().get('apikey')).toBe(PUBLIC_KEY)
    expect(lastHeaders().get('authorization')).toBe(`Bearer ${USER_TOKEN}`)
  })

  it.each([undefined, '', 'placeholder'])(
    'refuses password sign-in without meaningful server credentials (%s)',
    async key => {
      const { createIsolatedAuthClient } = await import('../middleware/auth.js')
      vi.stubEnv('SUPABASE_SECRET_KEY_LOCALHOST', key)
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'offline-legacy-key')
      expect(createIsolatedAuthClient).toThrow('Supabase server credentials are required')
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it('reports a rejected key instead of retrying with public credentials', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Invalid API key' }, 401))
    const { supabaseAdmin } = await import('../supabaseClient.js')
    const result = await supabaseAdmin.from('users').select('id')
    expect(result.status).toBe(401)
    expect(result.error?.message).toBe('Invalid API key')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(lastHeaders().get('apikey')).toBe(SECRET_KEY)
  })

  it('ignores legacy credentials when the selected key is absent', async () => {
    vi.stubEnv('SUPABASE_SECRET_KEY_LOCALHOST', undefined)
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'offline-legacy-key')
    const { supabaseAdmin } = await import('../supabaseClient.js')
    const result = await supabaseAdmin.from('users').select('id')
    expect(result.error).toBeNull()
    expect(lastHeaders().get('apikey')).toBe(PUBLIC_KEY)
    expect(lastHeaders().get('authorization')).toBe(`Bearer ${PUBLIC_KEY}`)
    const { supabase } = await import('../supabaseClient.js')
    expect(supabaseAdmin).toBe(supabase)
    const { createIsolatedAuthClient } = await import('../middleware/auth.js')
    expect(createIsolatedAuthClient).toThrow('Supabase server credentials are required')
  })

  it('selects production credentials for both admin and isolated auth clients', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { supabaseAdmin } = await import('../supabaseClient.js')
    const { createIsolatedAuthClient } = await import('../middleware/auth.js')
    await supabaseAdmin.from('users').select('id')
    expect(lastHeaders().get('apikey')).toBe('sb_secret_offline-production-credential')
    await createIsolatedAuthClient().from('users').select('id')
    expect(lastHeaders().get('apikey')).toBe('sb_secret_offline-production-credential')
  })

  it('fails for an empty selected key instead of using legacy or public credentials', async () => {
    vi.stubEnv('SUPABASE_SECRET_KEY_LOCALHOST', '')
    await expect(import('../supabaseClient.js')).rejects.toThrow('SUPABASE_SECRET_KEY_LOCALHOST is empty')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ignores legacy and localhost credentials when the production key is absent', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SUPABASE_SECRET_KEY_PRODUCTION', undefined)
    const { supabaseAdmin } = await import('../supabaseClient.js')
    await supabaseAdmin.from('users').select('id')
    expect(lastHeaders().get('apikey')).toBe(PUBLIC_KEY)
    const { createIsolatedAuthClient } = await import('../middleware/auth.js')
    expect(createIsolatedAuthClient).toThrow('Supabase server credentials are required')
  })
})
