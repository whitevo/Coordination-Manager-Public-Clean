import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'crypto'
import express from 'express'
import request from 'supertest'
import { errorHandler } from '../../middleware/error-handler.js'

// ─── Mock Supabase ──────────────────────────────────────────

const mockFrom = vi.fn()
const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockDelete = vi.fn()
const mockEq = vi.fn()
const mockIn = vi.fn()
const mockOrder = vi.fn()
const mockSingle = vi.fn()
const mockMaybeSingle = vi.fn()

function createChain(overrides: Record<string, any> = {}) {
  const chain: any = {
    select: overrides.select ?? mockSelect.mockReturnThis(),
    insert: overrides.insert ?? mockInsert.mockReturnThis(),
    update: overrides.update ?? mockUpdate.mockReturnThis(),
    delete: overrides.delete ?? mockDelete.mockReturnThis(),
    eq: overrides.eq ?? mockEq.mockReturnThis(),
    in: overrides.in ?? mockIn.mockReturnThis(),
    order: overrides.order ?? mockOrder,
    single: overrides.single ?? mockSingle,
    maybeSingle: overrides.maybeSingle ?? mockMaybeSingle,
  }
  return chain
}

vi.mock('../../supabaseClient.js', () => ({
  supabase: {
    from: (...args: any[]) => mockFrom(...args),
    auth: { getUser: vi.fn() },
  },
  supabaseAdmin: {
    from: (...args: any[]) => mockFrom(...args),
  },
}))

// ─── Mock auth middleware ───────────────────────────────────

vi.mock('../../middleware/auth.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    // Simulate authenticated user (tests can override via headers)
    req.userId = req.headers['x-test-user-id'] || 'test-user-123'
    req.userEmail = req.headers['x-test-user-email'] || 'test@example.com'
    req.userRole = 'user'
    next()
  },
  AuthenticatedRequest: {},
}))

// ─── Mock fetch (for Google OAuth) ──────────────────────────

const mockFetch = vi.fn()
const mockLookup = vi.fn()
vi.stubGlobal('fetch', mockFetch)

vi.mock('dns/promises', () => ({
  lookup: mockLookup,
}))

// ─── Mock environment variables ─────────────────────────────

vi.stubEnv('GOOGLE_CLIENT_ID', 'test-client-id')
vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-client-secret')
vi.stubEnv('GOOGLE_CALENDAR_REDIRECT_URI', 'http://localhost:3001/api/calendar-sources/google/callback')
vi.stubEnv('FRONTEND_URL', 'http://localhost:5173')
vi.stubEnv('NODE_ENV', 'test')
vi.stubEnv('JWT_SECRET', 'test-jwt-secret')

// ─── Test app setup ─────────────────────────────────────────

let app: express.Express

async function createApp() {
  const { default: calendarSourcesRouter } = await import('../calendar-sources.js')
  app = express()
  app.use(express.json())
  app.use('/api/calendar-sources', calendarSourcesRouter)
  app.use(errorHandler)
  return app
}

// ─── Helper to set up supabase mock chain ───────────────────

function setupSupabaseMock(result: { data?: any; error?: any }) {
  const chain = createChain()

  chain.order.mockResolvedValue(result)
  chain.single.mockResolvedValue(result)
  chain.maybeSingle.mockResolvedValue(result)

  mockFrom.mockReturnValue(chain)
  mockSelect.mockReturnValue(chain)
  mockInsert.mockReturnValue(chain)
  mockUpdate.mockReturnValue(chain)
  mockDelete.mockReturnValue(chain)
  mockEq.mockReturnValue(chain)
  mockIn.mockReturnValue(chain)

  return chain
}

// ─── HMAC state signing helper (mirrors signState in source) ──

function signTestState(payload: object): string {
  const json = JSON.stringify(payload)
  const data = Buffer.from(json).toString('base64url')
  const sig = createHmac('sha256', 'test-jwt-secret').update(data).digest('base64url')
  return `${data}.${sig}`
}

// ═════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════

describe('Calendar Sources API', () => {
  const validIcsFeed = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Coordination Manager Test//EN',
    'BEGIN:VEVENT',
    'UID:test-event-1',
    'DTSTART:20260701T100000Z',
    'DTEND:20260701T110000Z',
    'SUMMARY:Test Event',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')

  beforeEach(async () => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    mockLookup.mockReset()
    mockLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }])
    await createApp()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ─── GET /api/calendar-sources ─────────────────────────────

  describe('GET / — List calendar sources', () => {
    it('should return an empty array when no sources exist', async () => {
      setupSupabaseMock({ data: [], error: null })

      const res = await request(app)
        .get('/api/calendar-sources')
        .set('Authorization', 'Bearer test-token')

      expect(res.status).toBe(200)
      expect(res.body.sources).toEqual([])
    })

    it('should return existing calendar sources', async () => {
      const sources = [
        {
          id: 'src-1',
          user_id: 'test-user-123',
          source_type: 'google_oauth',
          google_email: 'user@gmail.com',
          display_name: 'Work Calendar',
          color: '#3B82F6',
          is_active: true,
        },
        {
          id: 'src-2',
          user_id: 'test-user-123',
          source_type: 'google_public_url',
          public_url: 'https://calendar.google.com/cal/ical/test.ics',
          display_name: 'Holidays',
          color: '#10B981',
          is_active: true,
        },
      ]

      setupSupabaseMock({ data: sources, error: null })

      const res = await request(app)
        .get('/api/calendar-sources')
        .set('Authorization', 'Bearer test-token')

      expect(res.status).toBe(200)
      expect(res.body.sources).toHaveLength(2)
      expect(res.body.sources[0].display_name).toBe('Work Calendar')
    })

    it('should return 400 when supabase query fails', async () => {
      setupSupabaseMock({ data: null, error: { message: 'DB error' } })

      const res = await request(app)
        .get('/api/calendar-sources')
        .set('Authorization', 'Bearer test-token')

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('DB error')
    })
  })

  // ─── GET /api/calendar-sources/google/auth-url ─────────────

  describe('GET /google/auth-url — Generate Google OAuth URL', () => {
    it('should return a valid Google OAuth consent URL', async () => {
      const res = await request(app)
        .get('/api/calendar-sources/google/auth-url')
        .query({ display_name: 'Work Calendar', color: '#3B82F6' })
        .set('Authorization', 'Bearer test-token')

      expect(res.status).toBe(200)
      expect(res.body.authUrl).toBeDefined()

      const url = new URL(res.body.authUrl)
      expect(url.hostname).toBe('accounts.google.com')
      expect(url.searchParams.get('client_id')).toBe('test-client-id')
      expect(url.searchParams.get('redirect_uri')).toBe(
        'http://localhost:3001/api/calendar-sources/google/callback'
      )
      expect(url.searchParams.get('response_type')).toBe('code')
      expect(url.searchParams.get('access_type')).toBe('offline')
      expect(url.searchParams.get('prompt')).toBe('consent')
      expect(url.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/calendar.readonly')
      expect(url.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/calendar.events')
    })

    it('should encode user context in the state parameter', async () => {
      const res = await request(app)
        .get('/api/calendar-sources/google/auth-url')
        .query({ display_name: 'My Cal', color: '#EF4444' })
        .set('Authorization', 'Bearer test-token')

      const url = new URL(res.body.authUrl)
      const state = url.searchParams.get('state')!
      const [dataPart] = state.split('.')
      const decoded = JSON.parse(Buffer.from(dataPart, 'base64url').toString('utf-8'))

      expect(decoded.userId).toBe('test-user-123')
      expect(decoded.display_name).toBe('My Cal')
      expect(decoded.color).toBe('#EF4444')
    })

    it('should use defaults when display_name and color are not provided', async () => {
      const res = await request(app)
        .get('/api/calendar-sources/google/auth-url')
        .set('Authorization', 'Bearer test-token')

      expect(res.status).toBe(200)

      const url = new URL(res.body.authUrl)
      const state = url.searchParams.get('state')!
      const [dataPart] = state.split('.')
      const decoded = JSON.parse(Buffer.from(dataPart, 'base64url').toString('utf-8'))

      expect(decoded.display_name).toBe('Google Calendar')
      expect(decoded.color).toBe('#3B82F6')
    })
  })

  // ─── GET /api/calendar-sources/google/callback ─────────────

  describe('GET /google/callback — Google OAuth callback', () => {
    const validState = signTestState({ userId: 'test-user-123', display_name: 'Work', color: '#3B82F6' })

    it('should redirect with error when Google returns an error', async () => {
      const res = await request(app)
        .get('/api/calendar-sources/google/callback')
        .query({ error: 'access_denied', state: validState })

      expect(res.status).toBe(302)
      expect(res.headers.location).toContain('oauth_error=access_denied')
    })

    it('should redirect with error when code or state is missing', async () => {
      const res = await request(app)
        .get('/api/calendar-sources/google/callback')
        .query({ code: 'some-code' }) // missing state

      expect(res.status).toBe(302)
      expect(res.headers.location).toContain('oauth_error=')
    })

    it('should redirect with error when state is invalid JSON', async () => {
      const res = await request(app)
        .get('/api/calendar-sources/google/callback')
        .query({ code: 'some-code', state: 'not-valid-base64-json' })

      expect(res.status).toBe(302)
      expect(res.headers.location).toContain('oauth_error=')
    })

    it('should redirect with error when token exchange fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'invalid_grant', error_description: 'Code expired' }),
      })

      const res = await request(app)
        .get('/api/calendar-sources/google/callback')
        .query({ code: 'bad-code', state: validState })

      expect(res.status).toBe(302)
      expect(res.headers.location).toContain('oauth_error=Code%20expired')
    })

    it('should create a new calendar source on successful OAuth (new user)', async () => {
      // Mock token exchange
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'ya29.access-token',
          refresh_token: '1//refresh-token',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'calendar',
        }),
      })
      // Mock userinfo
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          email: 'user@gmail.com',
          name: 'Test User',
        }),
      })

      // Mock: no existing source
      const chain = setupSupabaseMock({ data: null, error: null })
      chain.maybeSingle.mockResolvedValue({ data: null, error: null })

      // Mock insert
      const insertChain = createChain()
      insertChain.single.mockResolvedValue({ data: { id: 'new-src' }, error: null })
      mockFrom.mockReturnValueOnce(chain) // for the .maybeSingle check
      mockFrom.mockReturnValueOnce(insertChain) // for the .insert

      const res = await request(app)
        .get('/api/calendar-sources/google/callback')
        .query({ code: 'valid-auth-code', state: validState })

      expect(res.status).toBe(302)
      expect(res.headers.location).toContain('oauth_success=true')
      expect(res.headers.location).toContain('tab=calendar')

      // Verify fetch was called for token exchange
      expect(mockFetch).toHaveBeenCalledTimes(2)
      const tokenCall = mockFetch.mock.calls[0]
      expect(tokenCall[0]).toBe('https://oauth2.googleapis.com/token')
    })

    it('should update existing calendar source tokens on re-auth', async () => {
      // Mock token exchange
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'ya29.new-token',
          refresh_token: '1//new-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'calendar',
        }),
      })
      // Mock userinfo
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          email: 'user@gmail.com',
        }),
      })

      // Mock: existing source found
      const lookupChain = createChain()
      lookupChain.maybeSingle.mockResolvedValue({ data: { id: 'existing-src-id' }, error: null })

      // Mock: update call
      const updateChain = createChain()
      updateChain.eq.mockReturnValue(updateChain)
      updateChain.single.mockResolvedValue({ data: { id: 'existing-src-id' }, error: null })

      mockFrom.mockReturnValueOnce(lookupChain)
      mockFrom.mockReturnValueOnce(updateChain)

      const res = await request(app)
        .get('/api/calendar-sources/google/callback')
        .query({ code: 'valid-auth-code', state: validState })

      expect(res.status).toBe(302)
      expect(res.headers.location).toContain('oauth_success=true')
    })
  })

  // ─── POST /api/calendar-sources/public-url ─────────────────

  describe('POST /public-url — Add public calendar URL', () => {
    it('should create a public URL calendar source', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => validIcsFeed,
      })

      const newSource = {
        id: 'src-pub-1',
        source_type: 'google_public_url',
        public_url: 'https://calendar.google.com/calendar/ical/test/basic.ics',
        display_name: 'Holidays',
        color: '#10B981',
        is_active: true,
      }
      setupSupabaseMock({ data: newSource, error: null })

      const res = await request(app)
        .post('/api/calendar-sources/public-url')
        .set('Authorization', 'Bearer test-token')
        .send({
          public_url: 'https://calendar.google.com/calendar/ical/test/basic.ics',
          display_name: 'Holidays',
          color: '#10B981',
        })

      expect(res.status).toBe(201)
      expect(res.body.source.display_name).toBe('Holidays')
    })

    it('should normalize Google cid URL to a public ICS URL before saving', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => validIcsFeed,
      })

      const newSource = {
        id: 'src-pub-2',
        source_type: 'google_public_url',
        public_url: 'https://calendar.google.com/calendar/ical/singularitynetambassadors%40gmail.com/public/basic.ics',
        display_name: 'Ambassadors',
        color: '#10B981',
        is_active: true,
      }
      setupSupabaseMock({ data: newSource, error: null })

      const res = await request(app)
        .post('/api/calendar-sources/public-url')
        .set('Authorization', 'Bearer test-token')
        .send({
          public_url: 'https://calendar.google.com/calendar/u/2?cid=c2luZ3VsYXJpdHluZXRhbWJhc3NhZG9yc0BnbWFpbC5jb20',
          display_name: 'Ambassadors',
          color: '#10B981',
        })

      expect(res.status).toBe(201)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://calendar.google.com/calendar/ical/singularitynetambassadors%40gmail.com/public/basic.ics',
        expect.objectContaining({
          headers: expect.objectContaining({ Accept: expect.any(String) }),
        })
      )
      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        public_url: 'https://calendar.google.com/calendar/ical/singularitynetambassadors%40gmail.com/public/basic.ics',
      }))
    })

    it('should return 400 when public_url is missing', async () => {
      const res = await request(app)
        .post('/api/calendar-sources/public-url')
        .set('Authorization', 'Bearer test-token')
        .send({ display_name: 'Missing URL' })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('public_url is required')
    })

    it('should return 400 when display_name is missing', async () => {
      const res = await request(app)
        .post('/api/calendar-sources/public-url')
        .set('Authorization', 'Bearer test-token')
        .send({ public_url: 'https://example.com/cal.ics' })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('display_name is required')
    })

    it('should return 400 for invalid URL format', async () => {
      const res = await request(app)
        .post('/api/calendar-sources/public-url')
        .set('Authorization', 'Bearer test-token')
        .send({
          public_url: 'not-a-url',
          display_name: 'Bad URL',
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Invalid URL format')
    })

    it('should return 409 when URL is already added', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => validIcsFeed,
      })

      setupSupabaseMock({
        data: null,
        error: { code: '23505', message: 'duplicate' },
      })

      const res = await request(app)
        .post('/api/calendar-sources/public-url')
        .set('Authorization', 'Bearer test-token')
        .send({
          public_url: 'https://calendar.google.com/calendar/ical/test/basic.ics',
          display_name: 'Duplicate',
        })

      expect(res.status).toBe(409)
      expect(res.body.error).toContain('already added')
    })

    it('should reject URLs that are reachable but not ICS feeds', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '<html><body>Google Calendar</body></html>',
      })

      const res = await request(app)
        .post('/api/calendar-sources/public-url')
        .set('Authorization', 'Bearer test-token')
        .send({
          public_url: 'https://calendar.google.com/calendar/u/2?cid=c2luZ3VsYXJpdHluZXRhbWJhc3NhZG9yc0BnbWFpbC5jb20',
          display_name: 'Bad Link',
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('iCalendar')
    })

    it('should reject URLs that are not accessible', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => '',
      })

      const res = await request(app)
        .post('/api/calendar-sources/public-url')
        .set('Authorization', 'Bearer test-token')
        .send({
          public_url: 'https://calendar.google.com/calendar/ical/test/public/basic.ics',
          display_name: 'Missing Calendar',
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('not accessible')
    })

    it('should reject URLs whose hostname resolves to a private address', async () => {
      mockLookup.mockResolvedValueOnce([{ address: '10.0.0.25', family: 4 }])

      const res = await request(app)
        .post('/api/calendar-sources/public-url')
        .set('Authorization', 'Bearer test-token')
        .send({
          public_url: 'https://calendar-proxy.example.com/feed.ics',
          display_name: 'Private Target',
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('private or internal')
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  // ─── PUT /api/calendar-sources/:id ─────────────────────────

  describe('PUT /:id — Update calendar source', () => {
    it('should update display_name', async () => {
      const updated = {
        id: 'src-1',
        display_name: 'Renamed Calendar',
        color: '#3B82F6',
        is_active: true,
      }
      setupSupabaseMock({ data: updated, error: null })

      const res = await request(app)
        .put('/api/calendar-sources/src-1')
        .set('Authorization', 'Bearer test-token')
        .send({ display_name: 'Renamed Calendar' })

      expect(res.status).toBe(200)
      expect(res.body.source.display_name).toBe('Renamed Calendar')
    })

    it('should update color and is_active', async () => {
      const updated = {
        id: 'src-1',
        display_name: 'Work',
        color: '#EF4444',
        is_active: false,
      }
      setupSupabaseMock({ data: updated, error: null })

      const res = await request(app)
        .put('/api/calendar-sources/src-1')
        .set('Authorization', 'Bearer test-token')
        .send({ color: '#EF4444', is_active: false })

      expect(res.status).toBe(200)
      expect(res.body.source.color).toBe('#EF4444')
      expect(res.body.source.is_active).toBe(false)
    })

    it('should return 400 when no fields are provided', async () => {
      const res = await request(app)
        .put('/api/calendar-sources/src-1')
        .set('Authorization', 'Bearer test-token')
        .send({})

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('No fields to update')
    })

    it('should return 404 when source does not exist', async () => {
      setupSupabaseMock({ data: null, error: null })

      const res = await request(app)
        .put('/api/calendar-sources/nonexistent')
        .set('Authorization', 'Bearer test-token')
        .send({ display_name: 'New Name' })

      expect(res.status).toBe(404)
      expect(res.body.error).toContain('not found')
    })
  })

  // ─── DELETE /api/calendar-sources/:id ──────────────────────

  describe('DELETE /:id — Remove calendar source', () => {
    it('should delete a calendar source', async () => {
      const deleted = {
        id: 'src-1',
        display_name: 'Work Calendar',
      }
      setupSupabaseMock({ data: deleted, error: null })

      const res = await request(app)
        .delete('/api/calendar-sources/src-1')
        .set('Authorization', 'Bearer test-token')

      expect(res.status).toBe(200)
      expect(res.body.message).toContain('removed')
      expect(res.body.source.id).toBe('src-1')
    })

    it('should return 404 when source does not exist', async () => {
      setupSupabaseMock({ data: null, error: null })

      const res = await request(app)
        .delete('/api/calendar-sources/nonexistent')
        .set('Authorization', 'Bearer test-token')

      expect(res.status).toBe(404)
      expect(res.body.error).toContain('not found')
    })

    it('should return 400 when delete fails', async () => {
      setupSupabaseMock({ data: null, error: { message: 'Foreign key violation' } })

      const res = await request(app)
        .delete('/api/calendar-sources/src-1')
        .set('Authorization', 'Bearer test-token')

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Foreign key violation')
    })
  })

  // ─── POST /api/calendar-sources/export ─────────────────────

  describe('POST /export — Export meetings to Google Calendar', () => {
    it('should return 400 when no meetings are provided', async () => {
      const res = await request(app)
        .post('/api/calendar-sources/export')
        .set('Authorization', 'Bearer test-token')
        .send({ meetings: [], targetSourceIds: ['src-1'] })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('No meetings')
    })

    it('should return 400 when no target source IDs are provided', async () => {
      const res = await request(app)
        .post('/api/calendar-sources/export')
        .set('Authorization', 'Bearer test-token')
        .send({ meetings: [{ id: 'm1' }], targetSourceIds: [] })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('No target')
    })

    it('should return 400 when no writable google_oauth sources are found', async () => {
      // All sources are public_url type, none are google_oauth
      setupSupabaseMock({
        data: [
          { id: 'src-1', source_type: 'google_public_url', google_email: null },
        ],
        error: null,
      })

      // Override the .in() to return the filter result
      const chain = createChain()
      chain.order.mockResolvedValue({
        data: [{ id: 'src-1', source_type: 'google_public_url' }],
        error: null,
      })
      mockFrom.mockReturnValue(chain)
      mockSelect.mockReturnValue(chain)
      mockEq.mockReturnValue(chain)
      mockIn.mockReturnValue({
        data: [{ id: 'src-1', source_type: 'google_public_url' }],
        error: null,
      })

      const res = await request(app)
        .post('/api/calendar-sources/export')
        .set('Authorization', 'Bearer test-token')
        .send({
          meetings: [{ id: 'm1', title: 'Test Meeting' }],
          targetSourceIds: ['src-1'],
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('No writable')
    })

    it('should return 400 when OAuth sources exist but have no tokens', async () => {
      const chain = createChain()
      mockFrom.mockReturnValue(chain)
      mockSelect.mockReturnValue(chain)
      mockEq.mockReturnValue(chain)
      mockIn.mockResolvedValue({
        data: [
          {
            id: 'src-1',
            source_type: 'google_oauth',
            google_email: 'test@gmail.com',
            google_access_token: null,
            google_refresh_token: null,
          },
        ],
        error: null,
      })

      const res = await request(app)
        .post('/api/calendar-sources/export')
        .set('Authorization', 'Bearer test-token')
        .send({
          meetings: [{ id: 'm1', title: 'Test Meeting' }],
          targetSourceIds: ['src-1'],
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('tokens are missing')
    })

    it('should create events on Google Calendar and return results', async () => {
      const chain = createChain()
      mockFrom.mockReturnValue(chain)
      mockSelect.mockReturnValue(chain)
      mockEq.mockReturnValue(chain)
      mockUpdate.mockReturnValue(chain)
      mockIn.mockResolvedValue({
        data: [
          {
            id: 'src-1',
            source_type: 'google_oauth',
            google_email: 'test@gmail.com',
            google_access_token: 'ya29.valid-token',
            google_refresh_token: '1//refresh',
            token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
          },
        ],
        error: null,
      })

      // Mock Google Calendar API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'gcal-event-123',
          htmlLink: 'https://calendar.google.com/event?eid=gcal-event-123',
          status: 'confirmed',
        }),
      })

      const res = await request(app)
        .post('/api/calendar-sources/export')
        .set('Authorization', 'Bearer test-token')
        .send({
          meetings: [{
            cellId: '2026-02-10_14:00',
            title: 'Team Standup',
            description: 'Daily standup meeting',
            duration: 30,
            meetingLink: 'https://meet.google.com/abc-xyz',
          }],
          targetSourceIds: ['src-1'],
        })

      expect(res.status).toBe(200)
      expect(res.body.exported).toBe(true)
      expect(res.body.totalCreated).toBe(1)
      expect(res.body.totalFailed).toBe(0)
      expect(res.body.results[0].eventLinks).toHaveLength(1)

      // Verify Google Calendar API was called with correct event data
      expect(mockFetch).toHaveBeenCalledWith(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer ya29.valid-token',
            'Content-Type': 'application/json',
          }),
        }),
      )

      // Verify event body includes location, reminders, and description
      const calendarCall = mockFetch.mock.calls.find(
        (c: any[]) => c[0] === 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
      )
      const sentBody = JSON.parse(calendarCall![1].body)
      expect(sentBody.location).toBe('https://meet.google.com/abc-xyz')
      expect(sentBody.reminders).toEqual({ useDefault: false })
      expect(sentBody.description).toContain('Meeting link: https://meet.google.com/abc-xyz')
    })

    it('should refresh expired token before creating events', async () => {
      const chain = createChain()
      mockFrom.mockReturnValue(chain)
      mockSelect.mockReturnValue(chain)
      mockEq.mockReturnValue(chain)
      mockUpdate.mockReturnValue(chain)
      mockIn.mockResolvedValue({
        data: [
          {
            id: 'src-1',
            source_type: 'google_oauth',
            google_email: 'test@gmail.com',
            google_access_token: 'ya29.expired-token',
            google_refresh_token: '1//refresh',
            token_expires_at: new Date(Date.now() - 3600 * 1000).toISOString(), // expired
          },
        ],
        error: null,
      })

      // Mock token refresh response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'ya29.new-token',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'calendar',
        }),
      })

      // Mock Google Calendar API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'gcal-event-456',
          htmlLink: 'https://calendar.google.com/event?eid=gcal-event-456',
          status: 'confirmed',
        }),
      })

      const res = await request(app)
        .post('/api/calendar-sources/export')
        .set('Authorization', 'Bearer test-token')
        .send({
          meetings: [{
            cellId: '2026-02-10_10:00',
            title: 'Review',
            duration: 60,
          }],
          targetSourceIds: ['src-1'],
        })

      expect(res.status).toBe(200)
      expect(res.body.totalCreated).toBe(1)

      // Should have called token endpoint first, then calendar API
      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(mockFetch.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/token')
      expect(mockFetch.mock.calls[1][0]).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events')
    })

    it('should handle Google Calendar API errors gracefully', async () => {
      const chain = createChain()
      mockFrom.mockReturnValue(chain)
      mockSelect.mockReturnValue(chain)
      mockEq.mockReturnValue(chain)
      mockUpdate.mockReturnValue(chain)
      mockIn.mockResolvedValue({
        data: [
          {
            id: 'src-1',
            source_type: 'google_oauth',
            google_email: 'test@gmail.com',
            google_access_token: 'ya29.valid-token',
            google_refresh_token: '1//refresh',
            token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
          },
        ],
        error: null,
      })

      // Mock Google Calendar API failure
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({
          error: { code: 403, message: 'Insufficient permissions' },
        }),
      })

      const res = await request(app)
        .post('/api/calendar-sources/export')
        .set('Authorization', 'Bearer test-token')
        .send({
          meetings: [{
            cellId: '2026-02-10_14:00',
            title: 'Test Meeting',
            duration: 30,
          }],
          targetSourceIds: ['src-1'],
        })

      expect(res.status).toBe(200)
      expect(res.body.totalCreated).toBe(0)
      expect(res.body.totalFailed).toBe(1)
      expect(res.body.results[0].errors).toHaveLength(1)
      expect(res.body.results[0].errors[0]).toContain('Insufficient permissions')
    })
  })

  // ─── POST /api/calendar-sources/add-event ─────────────────

  describe('POST /add-event — Add an event to Google Calendar', () => {
    const event = {
      title: 'Mailbox invite',
      description: 'Bring the agenda',
      start_time: '2026-11-01T10:00:00.000Z',
      end_time: '2026-11-01T11:00:00.000Z',
      location: 'Room 2',
    }
    const idempotencyKey = '20000000-0000-4000-8000-000000000001'

    function setupGoogleSource() {
      const chain = createChain()
      mockFrom.mockReturnValue(chain)
      mockSelect.mockReturnValue(chain)
      mockEq.mockReturnValue(chain)
      mockIn.mockResolvedValue({
        data: [
          {
            id: 'src-1',
            source_type: 'google_oauth',
            google_email: 'user@gmail.com',
            google_access_token: 'valid-token',
            google_refresh_token: 'refresh-token',
            token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          },
        ],
        error: null,
      })
    }

    it('confirms an existing Google event after an idempotent retry', async () => {
      setupGoogleSource()
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 409,
          json: async () => ({ error: { code: 409, message: 'Already exists' } }),
        })
        .mockImplementationOnce(async (url: string) => {
          const eventId = JSON.parse(mockFetch.mock.calls[0][1].body).id
          expect(url).toBe(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`
          )
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: eventId,
              htmlLink: 'https://calendar.google.com/event?eid=existing',
              summary: event.title,
              description: event.description,
              location: event.location,
              start: { dateTime: event.start_time },
              end: { dateTime: event.end_time },
            }),
          }
        })

      const response = await request(app)
        .post('/api/calendar-sources/add-event')
        .set('Authorization', '******')
        .send({ event, targetSourceIds: ['src-1'], idempotencyKey })

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ succeeded: 1, failed: 0 })
      expect(response.body.results[0].success).toBe(true)
      const sentEvent = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(sentEvent.id).toMatch(/^[0-9a-f]{64}$/)
    })

    it('marks provider rate limits as retryable per destination', async () => {
      setupGoogleSource()
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ error: { code: 429, message: 'Rate limited' } }),
      })

      const response = await request(app)
        .post('/api/calendar-sources/add-event')
        .set('Authorization', '******')
        .send({ event, targetSourceIds: ['src-1'], idempotencyKey })

      expect(response.status).toBe(200)
      expect(response.body.results[0]).toMatchObject({
        success: false,
        error: 'Rate limited',
        retryable: true,
      })
    })
  })

  // ─────────────────────────────────────────────────────────
  // POST /busy — Fetch Google Calendar busy times
  // ─────────────────────────────────────────────────────────

  describe('POST /busy — Fetch Google Calendar busy times', () => {
    it('should return 400 when no sourceIds are provided', async () => {
      const res = await request(app)
        .post('/api/calendar-sources/busy')
        .set('Authorization', 'Bearer test-token')
        .send({ sourceIds: [], timeMin: '2026-01-01T00:00:00Z', timeMax: '2026-01-08T00:00:00Z' })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('No source IDs')
    })

    it('should return 400 when timeMin or timeMax is missing', async () => {
      const res = await request(app)
        .post('/api/calendar-sources/busy')
        .set('Authorization', 'Bearer test-token')
        .send({ sourceIds: ['src-1'] })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('timeMin and timeMax')
    })

    it('should return empty busyBlocks when no google_oauth sources found', async () => {
      const chain = createChain()
      chain.order.mockResolvedValue({ data: [], error: null })
      mockFrom.mockReturnValue(chain)
      mockSelect.mockReturnValue(chain)
      mockEq.mockReturnValue(chain)
      mockIn.mockReturnValue({ data: [], error: null })

      const res = await request(app)
        .post('/api/calendar-sources/busy')
        .set('Authorization', 'Bearer test-token')
        .send({ sourceIds: ['src-1'], timeMin: '2026-01-01T00:00:00Z', timeMax: '2026-01-08T00:00:00Z' })

      expect(res.status).toBe(200)
      expect(res.body.busyBlocks).toEqual([])
    })

    it('should return busy blocks from Google FreeBusy API', async () => {
      // Set up supabase to return an oauth source with valid token
      const chain = createChain()
      const oauthSource = {
        id: 'src-1',
        source_type: 'google_oauth',
        google_email: 'test@gmail.com',
        google_access_token: 'valid-access-token',
        google_refresh_token: 'refresh-token',
        token_expires_at: new Date(Date.now() + 3600000).toISOString(),
        color: '#4285F4',
      }
      chain.order.mockResolvedValue({ data: [oauthSource], error: null })
      mockFrom.mockReturnValue(chain)
      mockSelect.mockReturnValue(chain)
      mockEq.mockReturnValue(chain)
      mockIn.mockReturnValue({ data: [oauthSource], error: null })

      // Mock calendarList API response (fetched before freeBusy)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ id: 'primary', accessRole: 'owner' }] }),
      })

      // Mock FreeBusy API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          calendars: {
            primary: {
              busy: [
                { start: '2026-01-02T09:00:00Z', end: '2026-01-02T10:00:00Z' },
                { start: '2026-01-03T14:00:00Z', end: '2026-01-03T15:30:00Z' },
              ],
            },
          },
        }),
      })

      const res = await request(app)
        .post('/api/calendar-sources/busy')
        .set('Authorization', 'Bearer test-token')
        .send({ sourceIds: ['src-1'], timeMin: '2026-01-01T00:00:00Z', timeMax: '2026-01-08T00:00:00Z' })

      expect(res.status).toBe(200)
      expect(res.body.busyBlocks).toHaveLength(2)
      expect(res.body.busyBlocks[0]).toEqual({
        start: '2026-01-02T09:00:00.000Z',
        end: '2026-01-02T10:00:00.000Z',
        sourceId: 'src-1',
        color: '#4285F4',
      })
      expect(res.body.busyBlocks[1]).toEqual({
        start: '2026-01-03T14:00:00.000Z',
        end: '2026-01-03T15:30:00.000Z',
        sourceId: 'src-1',
        color: '#4285F4',
      })

      // Verify FreeBusy API was called correctly
      expect(mockFetch).toHaveBeenCalledWith(
        'https://www.googleapis.com/calendar/v3/freeBusy',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer valid-access-token',
          }),
        })
      )
    })

    it('should refresh expired token before calling FreeBusy API', async () => {
      // Source with expired token
      const expiredSource = {
        id: 'src-1',
        source_type: 'google_oauth',
        google_email: 'test@gmail.com',
        google_access_token: 'expired-token',
        google_refresh_token: 'refresh-token',
        token_expires_at: new Date(Date.now() - 60000).toISOString(), // expired
        color: '#34A853',
      }
      const chain = createChain()
      chain.order.mockResolvedValue({ data: [expiredSource], error: null })
      mockFrom.mockReturnValue(chain)
      mockSelect.mockReturnValue(chain)
      mockEq.mockReturnValue(chain)
      mockIn.mockReturnValue({ data: [expiredSource], error: null })
      mockUpdate.mockReturnValue(chain)

      // Mock token refresh
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          expires_in: 3600,
        }),
      })

      // Mock calendarList API response (fetched before freeBusy)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ id: 'primary', accessRole: 'owner' }] }),
      })

      // Mock FreeBusy response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          calendars: {
            primary: {
              busy: [{ start: '2026-01-02T09:00:00Z', end: '2026-01-02T10:00:00Z' }],
            },
          },
        }),
      })

      const res = await request(app)
        .post('/api/calendar-sources/busy')
        .set('Authorization', 'Bearer test-token')
        .send({ sourceIds: ['src-1'], timeMin: '2026-01-01T00:00:00Z', timeMax: '2026-01-08T00:00:00Z' })

      expect(res.status).toBe(200)
      expect(res.body.busyBlocks).toHaveLength(1)

      // Verify token refresh was called first
      expect(mockFetch).toHaveBeenCalledTimes(3)
      expect(mockFetch.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/token')
      expect(mockFetch.mock.calls[2][0]).toBe('https://www.googleapis.com/calendar/v3/freeBusy')
    })

    it('should continue with other sources if one fails', async () => {
      const sources = [
        {
          id: 'src-1',
          source_type: 'google_oauth',
          google_email: 'fail@gmail.com',
          google_access_token: 'token-1',
          google_refresh_token: 'refresh-1',
          token_expires_at: new Date(Date.now() + 3600000).toISOString(),
          color: '#EA4335',
        },
        {
          id: 'src-2',
          source_type: 'google_oauth',
          google_email: 'ok@gmail.com',
          google_access_token: 'token-2',
          google_refresh_token: 'refresh-2',
          token_expires_at: new Date(Date.now() + 3600000).toISOString(),
          color: '#FBBC04',
        },
      ]
      const chain = createChain()
      chain.order.mockResolvedValue({ data: sources, error: null })
      mockFrom.mockReturnValue(chain)
      mockSelect.mockReturnValue(chain)
      mockEq.mockReturnValue(chain)
      mockIn.mockReturnValue({ data: sources, error: null })

      // First source: calendarList
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ id: 'primary', accessRole: 'owner' }] }),
      })

      // First source fails (freeBusy)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: { message: 'Forbidden' } }),
      })

      // Second source: calendarList
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ id: 'primary', accessRole: 'owner' }] }),
      })

      // Second source succeeds (freeBusy)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          calendars: {
            primary: {
              busy: [{ start: '2026-01-04T11:00:00Z', end: '2026-01-04T12:00:00Z' }],
            },
          },
        }),
      })

      const res = await request(app)
        .post('/api/calendar-sources/busy')
        .set('Authorization', 'Bearer test-token')
        .send({ sourceIds: ['src-1', 'src-2'], timeMin: '2026-01-01T00:00:00Z', timeMax: '2026-01-08T00:00:00Z' })

      expect(res.status).toBe(200)
      // Only the second source's busy block should be returned
      expect(res.body.busyBlocks).toHaveLength(1)
      expect(res.body.busyBlocks[0].sourceId).toBe('src-2')
      expect(res.body.busyBlocks[0].color).toBe('#FBBC04')
    })

    it('should fall back to Events API when FreeBusy fails with insufficient scope', async () => {
      const oauthSource = {
        id: 'src-1',
        source_type: 'google_oauth',
        google_email: 'test@gmail.com',
        google_access_token: 'valid-access-token',
        google_refresh_token: 'refresh-token',
        token_expires_at: new Date(Date.now() + 3600000).toISOString(),
        color: '#4285F4',
        display_name: 'SingularityNET Calendar',
      }
      const chain = createChain()
      chain.order.mockResolvedValue({ data: [oauthSource], error: null })
      mockFrom.mockReturnValue(chain)
      mockSelect.mockReturnValue(chain)
      mockEq.mockReturnValue(chain)
      mockIn.mockReturnValue({ data: [oauthSource], error: null })
      mockUpdate.mockReturnValue(chain)

      // CalendarList
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ id: 'primary', accessRole: 'owner' }] }),
      })

      // FreeBusy fails for legacy tokens with narrow scopes
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: { message: 'Request had insufficient authentication scopes.' } }),
      })

      // Events fallback
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              id: 'evt-1',
              summary: 'Team Sync',
              start: { dateTime: '2026-01-02T09:00:00Z' },
              end: { dateTime: '2026-01-02T10:00:00Z' },
            },
          ],
        }),
      })

      const res = await request(app)
        .post('/api/calendar-sources/busy')
        .set('Authorization', 'Bearer test-token')
        .send({ sourceIds: ['src-1'], timeMin: '2026-01-01T00:00:00Z', timeMax: '2026-01-08T00:00:00Z' })

      expect(res.status).toBe(200)
      expect(res.body.sourceErrors).toEqual([])
      expect(res.body.busyBlocks).toEqual([
        {
          start: '2026-01-02T09:00:00.000Z',
          end: '2026-01-02T10:00:00.000Z',
          sourceId: 'src-1',
          color: '#4285F4',
          summary: 'Team Sync',
        },
      ])
    })

    it('should surface reconnect guidance when Google returns insufficient scope', async () => {
      const oauthSource = {
        id: 'src-1',
        source_type: 'google_oauth',
        google_email: 'test@gmail.com',
        google_access_token: 'valid-access-token',
        google_refresh_token: 'refresh-token',
        token_expires_at: new Date(Date.now() + 3600000).toISOString(),
        color: '#4285F4',
        display_name: 'SingularityNET Calendar',
      }
      const chain = createChain()
      chain.order.mockResolvedValue({ data: [oauthSource], error: null })
      mockFrom.mockReturnValue(chain)
      mockSelect.mockReturnValue(chain)
      mockEq.mockReturnValue(chain)
      mockIn.mockReturnValue({ data: [oauthSource], error: null })
      mockUpdate.mockReturnValue(chain)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ id: 'primary', accessRole: 'owner' }] }),
      })

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: { message: 'Request had insufficient authentication scopes.' } }),
      })

      // Events fallback also fails due insufficient permissions
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: { message: 'Insufficient Permission' } }),
      })

      const res = await request(app)
        .post('/api/calendar-sources/busy')
        .set('Authorization', 'Bearer test-token')
        .send({ sourceIds: ['src-1'], timeMin: '2026-01-01T00:00:00Z', timeMax: '2026-01-08T00:00:00Z' })

      expect(res.status).toBe(200)
      expect(res.body.busyBlocks).toEqual([])
      expect(res.body.sourceErrors).toEqual([
        {
          sourceId: 'src-1',
          displayName: 'SingularityNET Calendar',
          error: 'Calendar authorization is missing required access -- reconnect this calendar in Settings.',
        },
      ])
    })

    it('should return busy blocks from a public ICS URL source', async () => {
      const icsContent = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'DTSTART:20260102T090000Z',
        'DTEND:20260102T100000Z',
        'SUMMARY:Morning standup',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'DTSTART:20260103T140000Z',
        'DTEND:20260103T153000Z',
        'SUMMARY:Afternoon meeting',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'DTSTART:20260115T090000Z',
        'DTEND:20260115T100000Z',
        'SUMMARY:Out of range event',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n')

      const publicSource = {
        id: 'src-pub',
        source_type: 'google_public_url',
        public_url: 'https://calendar.google.com/calendar/ical/test/basic.ics',
        google_email: null,
        google_access_token: null,
        google_refresh_token: null,
        token_expires_at: null,
        color: '#0EA5E9',
      }
      const chain = createChain()
      chain.order.mockResolvedValue({ data: [publicSource], error: null })
      mockFrom.mockReturnValue(chain)
      mockSelect.mockReturnValue(chain)
      mockEq.mockReturnValue(chain)
      mockIn.mockReturnValue({ data: [publicSource], error: null })

      // Mock ICS fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => icsContent,
      })

      const res = await request(app)
        .post('/api/calendar-sources/busy')
        .set('Authorization', 'Bearer test-token')
        .send({ sourceIds: ['src-pub'], timeMin: '2026-01-01T00:00:00Z', timeMax: '2026-01-08T00:00:00Z' })

      expect(res.status).toBe(200)
      // Only 2 events are in range; the Jan 15 event is outside the range
      expect(res.body.busyBlocks).toHaveLength(2)
      expect(res.body.busyBlocks[0]).toEqual({
        start: '2026-01-02T09:00:00.000Z',
        end: '2026-01-02T10:00:00.000Z',
        sourceId: 'src-pub',
        color: '#0EA5E9',
        summary: 'Morning standup',
      })
      expect(res.body.busyBlocks[1]).toEqual({
        start: '2026-01-03T14:00:00.000Z',
        end: '2026-01-03T15:30:00.000Z',
        sourceId: 'src-pub',
        color: '#0EA5E9',
        summary: 'Afternoon meeting',
      })
    })

    it('should handle all-day ICS events (VALUE=DATE)', async () => {
      const icsContent = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Test//Test//EN',
        'BEGIN:VEVENT',
        'UID:allday-1@test',
        'DTSTART;VALUE=DATE:20260105',
        'DTEND;VALUE=DATE:20260106',
        'SUMMARY:All day event',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n')

      const publicSource = {
        id: 'src-pub',
        source_type: 'google_public_url',
        public_url: 'https://example.com/cal.ics',
        google_email: null,
        google_access_token: null,
        google_refresh_token: null,
        token_expires_at: null,
        color: '#10B981',
      }
      const chain = createChain()
      chain.order.mockResolvedValue({ data: [publicSource], error: null })
      mockFrom.mockReturnValue(chain)
      mockSelect.mockReturnValue(chain)
      mockEq.mockReturnValue(chain)
      mockIn.mockReturnValue({ data: [publicSource], error: null })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => icsContent,
      })

      const res = await request(app)
        .post('/api/calendar-sources/busy')
        .set('Authorization', 'Bearer test-token')
        .send({ sourceIds: ['src-pub'], timeMin: '2026-01-01T00:00:00Z', timeMax: '2026-01-08T00:00:00Z' })

      expect(res.status).toBe(200)
      expect(res.body.busyBlocks).toHaveLength(1)
      // All-day events are "floating" dates — ical.js converts using local TZ
      // Just verify the event is in the right date range
      const start = new Date(res.body.busyBlocks[0].start)
      const end = new Date(res.body.busyBlocks[0].end)
      expect(start.getUTCFullYear()).toBe(2026)
      expect(start.getUTCMonth()).toBe(0) // January
      expect(end > start).toBe(true)
    })

    it('should expand recurring RRULE events into the queried range', async () => {
      // Weekly recurring event starting Jan 5 2026 (Monday), every week
      const icsContent = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Test//Test//EN',
        'BEGIN:VEVENT',
        'UID:recurring-weekly@test',
        'DTSTART:20260105T100000Z',
        'DTEND:20260105T110000Z',
        'RRULE:FREQ=WEEKLY;COUNT=10',
        'SUMMARY:Weekly standup',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n')

      const publicSource = {
        id: 'src-pub',
        source_type: 'google_public_url',
        public_url: 'https://example.com/cal.ics',
        google_email: null,
        google_access_token: null,
        google_refresh_token: null,
        token_expires_at: null,
        color: '#8B5CF6',
      }
      const chain = createChain()
      chain.order.mockResolvedValue({ data: [publicSource], error: null })
      mockFrom.mockReturnValue(chain)
      mockSelect.mockReturnValue(chain)
      mockEq.mockReturnValue(chain)
      mockIn.mockReturnValue({ data: [publicSource], error: null })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => icsContent,
      })

      // Query Feb 2-8 range — should find the Feb 2 occurrence (5th week)
      const res = await request(app)
        .post('/api/calendar-sources/busy')
        .set('Authorization', 'Bearer test-token')
        .send({ sourceIds: ['src-pub'], timeMin: '2026-02-02T00:00:00Z', timeMax: '2026-02-09T00:00:00Z' })

      expect(res.status).toBe(200)
      // One occurrence on Monday Feb 2
      expect(res.body.busyBlocks).toHaveLength(1)
      expect(res.body.busyBlocks[0].start).toBe('2026-02-02T10:00:00.000Z')
      expect(res.body.busyBlocks[0].end).toBe('2026-02-02T11:00:00.000Z')
      expect(res.body.busyBlocks[0].sourceId).toBe('src-pub')
      expect(res.body.busyBlocks[0].color).toBe('#8B5CF6')
    })

    it('should handle mixed oauth and public URL sources together', async () => {
      const oauthSource = {
        id: 'src-oauth',
        source_type: 'google_oauth',
        public_url: null,
        google_email: 'user@gmail.com',
        google_access_token: 'valid-token',
        google_refresh_token: 'refresh-token',
        token_expires_at: new Date(Date.now() + 3600000).toISOString(),
        color: '#4285F4',
      }
      const publicSource = {
        id: 'src-pub',
        source_type: 'google_public_url',
        public_url: 'https://example.com/cal.ics',
        google_email: null,
        google_access_token: null,
        google_refresh_token: null,
        token_expires_at: null,
        color: '#EA4335',
      }

      const chain = createChain()
      chain.order.mockResolvedValue({ data: [oauthSource, publicSource], error: null })
      mockFrom.mockReturnValue(chain)
      mockSelect.mockReturnValue(chain)
      mockEq.mockReturnValue(chain)
      mockIn.mockReturnValue({ data: [oauthSource, publicSource], error: null })

      // Mock calendarList API response for oauth source
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ id: 'primary', accessRole: 'owner' }] }),
      })

      // Mock FreeBusy API for oauth source
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          calendars: {
            primary: {
              busy: [{ start: '2026-01-02T09:00:00Z', end: '2026-01-02T10:00:00Z' }],
            },
          },
        }),
      })

      // Mock ICS fetch for public URL source
      const icsContent = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'DTSTART:20260103T140000Z',
        'DTEND:20260103T150000Z',
        'SUMMARY:ICS event',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n')
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => icsContent,
      })

      const res = await request(app)
        .post('/api/calendar-sources/busy')
        .set('Authorization', 'Bearer test-token')
        .send({ sourceIds: ['src-oauth', 'src-pub'], timeMin: '2026-01-01T00:00:00Z', timeMax: '2026-01-08T00:00:00Z' })

      expect(res.status).toBe(200)
      expect(res.body.busyBlocks).toHaveLength(2)
      // OAuth source block
      expect(res.body.busyBlocks[0].sourceId).toBe('src-oauth')
      expect(res.body.busyBlocks[0].color).toBe('#4285F4')
      // Public URL source block
      expect(res.body.busyBlocks[1].sourceId).toBe('src-pub')
      expect(res.body.busyBlocks[1].color).toBe('#EA4335')
    })
  })
})
