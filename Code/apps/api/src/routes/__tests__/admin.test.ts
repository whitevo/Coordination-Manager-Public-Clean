import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { errorHandler } from '../../middleware/error-handler.js'

// ─── Mock Supabase ──────────────────────────────────────────

const mockFrom = vi.fn()
const mockSelect = vi.fn()
const mockUpdate = vi.fn()
const mockDelete = vi.fn()
const mockEq = vi.fn()
const mockSingle = vi.fn()
const mockIn = vi.fn()
const mockRange = vi.fn()
const mockOrder = vi.fn()

function createChain() {
  return {
    select: mockSelect,
    update: mockUpdate,
    delete: mockDelete,
    eq: mockEq,
    in: mockIn,
    range: mockRange,
    order: mockOrder,
    single: mockSingle,
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

// ─── Mock auth ──────────────────────────────────────────────

const MOCK_USER_ID = '550e8400-e29b-41d4-a716-446655440000'
let mockUserRole = 'admin'
let mockUserRoles = ['admin', 'user']
let mockAuthAal = 'aal2'

vi.mock('../../middleware/auth.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.userId = MOCK_USER_ID
    req.userEmail = 'admin@example.com'
    req.userRole = mockUserRole
    req.userRoles = mockUserRoles
    req.authAal = mockAuthAal
    next()
  },
  hasRole: (req: any, role: string) => req.userRoles?.includes(role) ?? false,
  hasMfaAssurance: (req: any) => req.authAal === 'aal2',
  AuthenticatedRequest: {},
}))

vi.mock('../../middleware/validation.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return { ...actual }
})

vi.mock('../../services/signup-rate-tracker.js', () => ({
  getCaptchaStatus: vi.fn().mockReturnValue({ active: false }),
  setCaptchaOverride: vi.fn(),
  getSignupTimestamps: vi.fn().mockReturnValue([]),
}))

// ─── Test setup ─────────────────────────────────────────────

let app: express.Express

async function createApp() {
  const { default: adminRouter } = await import('../admin.js')
  app = express()
  app.use(express.json())
  app.use('/api/admin', adminRouter)
  app.use(errorHandler)
  return app
}

// ═══════════════════════════════════════════════════════════════

describe('Admin Routes', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockSelect.mockReturnThis()
    mockEq.mockReturnThis()
    mockUpdate.mockReturnThis()
    mockDelete.mockReturnThis()
    mockIn.mockReturnThis()
    mockOrder.mockReturnThis()
    mockUserRole = 'admin'
    mockUserRoles = ['admin', 'user']
    mockAuthAal = 'aal2'
    await createApp()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ─── GET /api/admin/users ─────────────────────────────────

  describe('GET /users', () => {
    it('returns paginated user list for admins', async () => {
      mockRange.mockResolvedValue({
        data: [
          { id: 'user-1', email: 'alice@test.com', display_name: 'Alice', roles: ['user'] },
          { id: 'user-2', email: 'bob@test.com', display_name: 'Bob', roles: ['user'] },
        ],
        error: null,
        count: 2,
      })

      const res = await request(app).get('/api/admin/users')

      expect(res.status).toBe(200)
      expect(res.body.users).toHaveLength(2)
      expect(res.body.total).toBe(2)
      expect(res.body.page).toBe(1)
    })

    it('rejects non-admin users with 403', async () => {
      mockUserRole = 'user'
      mockUserRoles = ['user']
      await createApp()

      const res = await request(app).get('/api/admin/users')

      expect(res.status).toBe(403)
      expect(res.body.error).toContain('Admin role required')
    })

    it('rejects admin users without MFA assurance', async () => {
      mockAuthAal = 'aal1'
      await createApp()

      const res = await request(app).get('/api/admin/users')

      expect(res.status).toBe(403)
      expect(res.body.error).toBe('ADMIN_MFA_REQUIRED')
    })

    it('respects pagination params', async () => {
      mockRange.mockResolvedValue({ data: [], error: null, count: 0 })

      const res = await request(app).get('/api/admin/users?page=2&limit=10')

      expect(res.status).toBe(200)
      expect(res.body.page).toBe(2)
      expect(res.body.limit).toBe(10)
    })

    it('clamps limit to max 100', async () => {
      mockRange.mockResolvedValue({ data: [], error: null, count: 0 })

      const res = await request(app).get('/api/admin/users?limit=500')

      expect(res.body.limit).toBe(100)
    })
  })

  // ─── POST /api/admin/users/silence ────────────────────────

  describe('POST /users/silence', () => {
    it('silences valid user IDs', async () => {
      const targetId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

      // Target user lookup (not admin)
      mockIn.mockReturnThis()
      mockSelect.mockReturnThis()
      mockIn.mockResolvedValueOnce({ data: [{ id: targetId, roles: ['user'] }] })
      // Update users
      mockIn.mockResolvedValueOnce({ error: null })
      // Update calendars
      mockEq.mockResolvedValueOnce({ error: null })

      const res = await request(app)
        .post('/api/admin/users/silence')
        .send({ userIds: [targetId] })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.silencedCount).toBe(1)
    })

    it('prevents silencing self', async () => {
      const res = await request(app)
        .post('/api/admin/users/silence')
        .send({ userIds: [MOCK_USER_ID] })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Cannot silence your own account')
    })

    it('prevents silencing other admins', async () => {
      const adminId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
      mockIn.mockResolvedValueOnce({ data: [{ id: adminId, roles: ['admin'] }] })

      const res = await request(app)
        .post('/api/admin/users/silence')
        .send({ userIds: [adminId] })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Cannot silence admin')
    })

    it('returns 400 when userIds is empty', async () => {
      const res = await request(app)
        .post('/api/admin/users/silence')
        .send({ userIds: [] })

      expect(res.status).toBe(400)
    })

    it('returns 400 when userIds contains invalid UUIDs', async () => {
      const res = await request(app)
        .post('/api/admin/users/silence')
        .send({ userIds: ['not-a-uuid'] })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('not valid UUIDs')
    })

    it('rejects non-admin with 403', async () => {
      mockUserRole = 'user'
      mockUserRoles = ['user']
      await createApp()

      const res = await request(app)
        .post('/api/admin/users/silence')
        .send({ userIds: ['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'] })

      expect(res.status).toBe(403)
    })
  })

  // ─── POST /api/admin/users/unsilence ──────────────────────

  describe('POST /users/unsilence', () => {
    it('unsilences valid user IDs', async () => {
      const targetId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
      mockIn.mockResolvedValueOnce({ error: null })

      const res = await request(app)
        .post('/api/admin/users/unsilence')
        .send({ userIds: [targetId] })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.unsilencedCount).toBe(1)
    })

    it('returns 400 when userIds is missing', async () => {
      const res = await request(app)
        .post('/api/admin/users/unsilence')
        .send({})

      expect(res.status).toBe(400)
    })
  })

  // ─── POST /api/admin/users/moderator ──────────────────────

  describe('POST /users/moderator', () => {
    it('grants moderator role to a user', async () => {
      const targetId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
      mockSingle.mockResolvedValueOnce({ data: { roles: ['user'] }, error: null })

      const res = await request(app)
        .post('/api/admin/users/moderator')
        .send({ userId: targetId, enabled: true })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.roles).toContain('moderator')
    })

    it('removes moderator role from a user', async () => {
      const targetId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
      mockSingle.mockResolvedValueOnce({ data: { roles: ['user', 'moderator'] }, error: null })

      const res = await request(app)
        .post('/api/admin/users/moderator')
        .send({ userId: targetId, enabled: false })

      expect(res.status).toBe(200)
      expect(res.body.roles).not.toContain('moderator')
    })

    it('returns 400 when userId is missing', async () => {
      const res = await request(app)
        .post('/api/admin/users/moderator')
        .send({ enabled: true })

      expect(res.status).toBe(400)
    })

    it('returns 400 when enabled is not boolean', async () => {
      const res = await request(app)
        .post('/api/admin/users/moderator')
        .send({ userId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', enabled: 'yes' })

      expect(res.status).toBe(400)
    })

    it('returns 404 when user not found', async () => {
      mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'not found' } })

      const res = await request(app)
        .post('/api/admin/users/moderator')
        .send({ userId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', enabled: true })

      expect(res.status).toBe(404)
    })
  })
})
