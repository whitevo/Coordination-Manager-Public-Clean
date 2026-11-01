import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { errorHandler } from '../../middleware/error-handler.js'

// --- Mock Supabase (chain pattern from testing-strategy) ---

const mockFrom = vi.fn()
const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockEq = vi.fn()
const mockIn = vi.fn()
const mockIs = vi.fn()
const mockNot = vi.fn()
const mockGte = vi.fn()
const mockLte = vi.fn()
const mockOrder = vi.fn()
const mockRange = vi.fn()
const mockMaybeSingle = vi.fn()
let thenResult: { data: unknown[]; count: number; error: null } = { data: [], count: 0, error: null }

function createChain() {
  return {
    select: mockSelect,
    insert: mockInsert,
    eq: mockEq,
    in: mockIn,
    is: mockIs,
    not: mockNot,
    gte: mockGte,
    lte: mockLte,
    order: mockOrder,
    range: mockRange,
    maybeSingle: mockMaybeSingle,
    then: (resolve: (value: { data: unknown[]; count: number; error: null }) => void) => resolve(thenResult),
  }
}

vi.mock('../../supabaseClient.js', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => {
      mockFrom(...args)
      return createChain()
    },
  },
}))

// --- Mock auth ---

const MOCK_USER_ID = '550e8400-e29b-41d4-a716-446655440000'
let mockUserRoles: string[] = ['moderator', 'user']

vi.mock('../../middleware/auth.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.userId = MOCK_USER_ID
    req.userEmail = 'mod@example.com'
    req.userRole = mockUserRoles[0]
    req.userRoles = mockUserRoles
    next()
  },
  hasRole: (req: any, role: string) => req.userRoles?.includes(role) ?? false,
  AuthenticatedRequest: {},
}))

const FLAGGED_ID = '6f1c2b7e-9a4d-4c1e-8f3a-2b5d7e9c1a3f'
const GUILD_ID = '123456789012345678'
const AUTHOR_ID = '223456789012345678'
const BOT_TOKEN = 'fake.bot.token-value'

function flaggedRow(actionTaken: string) {
  return {
    id: FLAGGED_ID,
    guild_id: GUILD_ID,
    guild_name: 'Server',
    channel_id: '323456789012345678',
    channel_name: 'general',
    message_id: '423456789012345678',
    author_id: AUTHOR_ID,
    author_username: 'spammer',
    action_taken: actionTaken,
    matched_rule_id: null,
    matched_rule_group_id: null,
    matched_rule_group_name: 'Invites',
  }
}

function discordResponse(status: number, body: unknown = null) {
  return { status, ok: status >= 200 && status < 300, json: async () => body }
}

let app: express.Express
let fetchMock: ReturnType<typeof vi.fn>

async function createApp() {
  const { default: guardianRouter } = await import('../guardian.js')
  app = express()
  app.use(express.json())
  app.use('/api/guardian', guardianRouter)
  app.use(errorHandler)
}

function insertedLogRow(): Record<string, unknown> {
  const call = mockInsert.mock.calls.at(-1)
  expect(call).toBeDefined()
  return call![0] as Record<string, unknown>
}

describe('Guardian undo actions', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockUserRoles = ['moderator', 'user']
    thenResult = { data: [], count: 0, error: null }
    for (const m of [mockSelect, mockInsert, mockEq, mockIn, mockIs, mockNot, mockGte, mockLte, mockOrder, mockRange]) {
      m.mockReturnThis()
    }
    vi.stubEnv('GUARDIAN_BOT_TOKEN', BOT_TOKEN)
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await createApp()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  describe('POST /flagged/:id/unban', () => {
    it('returns 403 for non-moderators without touching the database or Discord', async () => {
      mockUserRoles = ['user']
      const res = await request(app).post(`/api/guardian/flagged/${FLAGGED_ID}/unban`)
      expect(res.status).toBe(403)
      expect(res.body.error).toBe('GUARDIAN_MODERATOR_REQUIRED')
      expect(mockFrom).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('returns 400 for an invalid flagged message ID', async () => {
      const res = await request(app).post('/api/guardian/flagged/not-a-uuid/unban')
      expect(res.status).toBe(400)
      expect(mockFrom).not.toHaveBeenCalled()
    })

    it('returns 404 when the flagged message does not exist', async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
      const res = await request(app).post(`/api/guardian/flagged/${FLAGGED_ID}/unban`)
      expect(res.status).toBe(404)
      expect(res.body.error).toBe('GUARDIAN_FLAGGED_NOT_FOUND')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('returns 503 when the Guardian bot token is not configured', async () => {
      vi.stubEnv('GUARDIAN_BOT_TOKEN', '')
      const res = await request(app).post(`/api/guardian/flagged/${FLAGGED_ID}/unban`)
      expect(res.status).toBe(503)
      expect(res.body.error).toBe('GUARDIAN_NOT_CONFIGURED')
    })

    it('returns 409 when the flagged message did not lead to a ban', async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: flaggedRow('flagged,deleted'), error: null })
      const res = await request(app).post(`/api/guardian/flagged/${FLAGGED_ID}/unban`)
      expect(res.status).toBe(409)
      expect(res.body.error).toBe('GUARDIAN_UNDO_NOT_APPLICABLE')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('unbans through Discord with an audit reason and records a moderator log row', async () => {
      mockMaybeSingle
        .mockResolvedValueOnce({ data: flaggedRow('flagged,deleted,banned'), error: null })
        .mockResolvedValueOnce({ data: null, error: null })
      fetchMock.mockResolvedValueOnce(discordResponse(204))

      const res = await request(app).post(`/api/guardian/flagged/${FLAGGED_ID}/unban`)

      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ action: 'unban', status: 'unbanned', flagged_message_id: FLAGGED_ID, logged: true })
      expect(JSON.stringify(res.body)).not.toContain(BOT_TOKEN)
      expect(mockFrom).toHaveBeenCalledWith('guardian_ban_accounts')

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(`https://discord.com/api/v10/guilds/${GUILD_ID}/bans/${AUTHOR_ID}`)
      expect(init.method).toBe('DELETE')
      expect(init.headers.Authorization).toBe(`Bot ${BOT_TOKEN}`)
      expect(decodeURIComponent(init.headers['X-Audit-Log-Reason'])).toContain('unban by a Coordination Manager moderator')
      expect(decodeURIComponent(init.headers['X-Audit-Log-Reason'])).not.toContain(MOCK_USER_ID)

      expect(mockFrom).toHaveBeenCalledWith('guardian_action_log')
      expect(insertedLogRow()).toMatchObject({
        action: 'unban', success: true, actor_kind: 'moderator', actor_user_id: MOCK_USER_ID,
        flagged_message_id: FLAGGED_ID, guild_id: GUILD_ID, author_id: AUTHOR_ID, failure_reason: null,
      })
    })

    it('reports already-unbanned users (Discord Unknown Ban) as success', async () => {
      mockMaybeSingle
        .mockResolvedValueOnce({ data: flaggedRow('banned'), error: null })
        .mockResolvedValueOnce({ data: null, error: null })
      fetchMock.mockResolvedValueOnce(discordResponse(404, { code: 10026, message: 'Unknown Ban' }))

      const res = await request(app).post(`/api/guardian/flagged/${FLAGGED_ID}/unban`)

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('already_unbanned')
      expect(insertedLogRow()).toMatchObject({ action: 'unban', success: true })
      expect(insertedLogRow().failure_reason).toMatch(/Already unbanned/)
    })

    it('returns 409 and does not call Discord when the user is on the global Ban list', async () => {
      mockMaybeSingle
        .mockResolvedValueOnce({ data: flaggedRow('banned'), error: null })
        .mockResolvedValueOnce({ data: { discord_user_id: AUTHOR_ID }, error: null })

      const res = await request(app).post(`/api/guardian/flagged/${FLAGGED_ID}/unban`)

      expect(res.status).toBe(409)
      expect(res.body.error).toBe('GUARDIAN_BAN_REGISTRY_ACTIVE')
      expect(res.body.message).toMatch(/Ban list/)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(mockInsert).not.toHaveBeenCalled()
    })

    it('returns 503 when the global Ban list cannot be checked', async () => {
      mockMaybeSingle
        .mockResolvedValueOnce({ data: flaggedRow('banned'), error: null })
        .mockResolvedValueOnce({ data: null, error: { message: 'db down' } })
      const res = await request(app).post(`/api/guardian/flagged/${FLAGGED_ID}/unban`)
      expect(res.status).toBe(503)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('maps a Discord permission failure to 502 and records a failed log row', async () => {
      mockMaybeSingle
        .mockResolvedValueOnce({ data: flaggedRow('banned'), error: null })
        .mockResolvedValueOnce({ data: null, error: null })
      fetchMock.mockResolvedValueOnce(discordResponse(403, { code: 50013, message: 'Missing Permissions' }))

      const res = await request(app).post(`/api/guardian/flagged/${FLAGGED_ID}/unban`)

      expect(res.status).toBe(502)
      expect(res.body.error).toBe('DISCORD_PERMISSION_DENIED')
      expect(JSON.stringify(res.body)).not.toContain(BOT_TOKEN)
      expect(insertedLogRow()).toMatchObject({
        action: 'unban', success: false, failure_reason: 'Discord error 50013 (HTTP 403)',
      })
    })

    it('maps a Discord network failure to 502 DISCORD_UNREACHABLE', async () => {
      mockMaybeSingle
        .mockResolvedValueOnce({ data: flaggedRow('banned'), error: null })
        .mockResolvedValueOnce({ data: null, error: null })
      fetchMock.mockRejectedValueOnce(new Error('fetch failed'))

      const res = await request(app).post(`/api/guardian/flagged/${FLAGGED_ID}/unban`)

      expect(res.status).toBe(502)
      expect(res.body.error).toBe('DISCORD_UNREACHABLE')
      expect(insertedLogRow()).toMatchObject({ success: false })
    })
  })

  describe('POST /flagged/:id/untimeout', () => {
    it('returns 403 for non-moderators', async () => {
      mockUserRoles = ['user']
      const res = await request(app).post(`/api/guardian/flagged/${FLAGGED_ID}/untimeout`)
      expect(res.status).toBe(403)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('removes an active timeout and records an unmute log row', async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: flaggedRow('flagged,timeout'), error: null })
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
      fetchMock
        .mockResolvedValueOnce(discordResponse(200, { communication_disabled_until: future }))
        .mockResolvedValueOnce(discordResponse(200, { communication_disabled_until: null }))

      const res = await request(app).post(`/api/guardian/flagged/${FLAGGED_ID}/untimeout`)

      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ action: 'unmute', status: 'timeout_removed', logged: true })
      const [url, init] = fetchMock.mock.calls[1]
      expect(url).toBe(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${AUTHOR_ID}`)
      expect(init.method).toBe('PATCH')
      expect(JSON.parse(init.body)).toEqual({ communication_disabled_until: null })
      expect(decodeURIComponent(init.headers['X-Audit-Log-Reason'])).toContain('remove timeout by a Coordination Manager moderator')
      expect(insertedLogRow()).toMatchObject({ action: 'unmute', success: true, actor_kind: 'moderator' })
      // Untimeout does not consult the ban registry.
      expect(mockFrom).not.toHaveBeenCalledWith('guardian_ban_accounts')
    })

    it('reports no active timeout without a Discord write', async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: flaggedRow('timeout'), error: null })
      fetchMock.mockResolvedValueOnce(discordResponse(200, { communication_disabled_until: null }))

      const res = await request(app).post(`/api/guardian/flagged/${FLAGGED_ID}/untimeout`)

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('not_timed_out')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('returns 409 when the member has left the server (Discord Unknown Member)', async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: flaggedRow('timeout'), error: null })
      fetchMock.mockResolvedValueOnce(discordResponse(404, { code: 10007, message: 'Unknown Member' }))

      const res = await request(app).post(`/api/guardian/flagged/${FLAGGED_ID}/untimeout`)

      expect(res.status).toBe(409)
      expect(res.body.error).toBe('GUARDIAN_MEMBER_NOT_FOUND')
      expect(insertedLogRow()).toMatchObject({ action: 'unmute', success: false })
    })

    it('returns 409 when the flagged message did not lead to a timeout', async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: flaggedRow('banned'), error: null })
      const res = await request(app).post(`/api/guardian/flagged/${FLAGGED_ID}/untimeout`)
      expect(res.status).toBe(409)
      expect(res.body.error).toBe('GUARDIAN_UNDO_NOT_APPLICABLE')
    })
  })

  describe('GET /flagged undo state', () => {
    it('attaches the latest successful undo for the same author and server made after the row was flagged', async () => {
      mockRange.mockResolvedValueOnce({
        data: [
          { ...flaggedRow('banned,timeout'), flagged_at: '2026-10-17T10:00:00Z' },
          { ...flaggedRow('banned'), id: 'later-row', flagged_at: '2026-10-19T12:00:00Z' },
        ],
        count: 2,
        error: null,
      })
      thenResult = {
        data: [
          { guild_id: GUILD_ID, author_id: AUTHOR_ID, action: 'unban', created_at: '2026-10-18T10:00:00Z' },
          { guild_id: GUILD_ID, author_id: AUTHOR_ID, action: 'unban', created_at: '2026-10-19T10:00:00Z' },
          { guild_id: '999999999999999999', author_id: AUTHOR_ID, action: 'unmute', created_at: '2026-10-19T10:00:00Z' },
        ],
        count: 3,
        error: null,
      }

      const res = await request(app).get('/api/guardian/flagged?skip_count=1')

      expect(res.status).toBe(200)
      expect(res.body.flagged[0].undo).toEqual({ unban_at: '2026-10-19T10:00:00Z' })
      // Re-banned after the last unban: the undo control must show again.
      expect(res.body.flagged[1].undo).toBeNull()
      expect(mockIn).toHaveBeenCalledWith('action', ['unban', 'unmute'])
    })
  })
})
