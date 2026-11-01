import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { errorHandler } from '../../middleware/error-handler.js'

// ─── Mock Supabase ──────────────────────────────────────────

const mockFrom = vi.fn()
const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockUpsert = vi.fn()
const mockUpdate = vi.fn()
const mockDelete = vi.fn()
const mockEq = vi.fn()
const mockSingle = vi.fn()
const mockMaybeSingle = vi.fn()

function createChain(overrides: Record<string, any> = {}) {
  const chain: any = {
    select: overrides.select ?? mockSelect.mockReturnThis(),
    insert: overrides.insert ?? mockInsert.mockReturnThis(),
    upsert: overrides.upsert ?? mockUpsert.mockReturnThis(),
    update: overrides.update ?? mockUpdate.mockReturnThis(),
    delete: overrides.delete ?? mockDelete.mockReturnThis(),
    eq: overrides.eq ?? mockEq.mockReturnThis(),
    single: overrides.single ?? mockSingle,
    maybeSingle: overrides.maybeSingle ?? mockMaybeSingle,
  }
  return chain
}

const mockCreateUser = vi.fn()
const mockGetUserById = vi.fn()
const mockGenerateLink = vi.fn()
const mockUpdateUserById = vi.fn()
const mockListUsers = vi.fn()
const mockDeleteUser = vi.fn()
const mockSignInWithPassword = vi.fn()
const mockVerifyOtp = vi.fn()

vi.mock('../../supabaseClient.js', () => ({
  supabaseAdmin: {
    from: (...args: any[]) => {
      mockFrom(...args)
      return createChain()
    },
    auth: {
      signInWithPassword: (...args: any[]) => mockSignInWithPassword(...args),
      admin: {
        createUser: (...args: any[]) => mockCreateUser(...args),
        getUserById: (...args: any[]) => mockGetUserById(...args),
        generateLink: (...args: any[]) => mockGenerateLink(...args),
        updateUserById: (...args: any[]) => mockUpdateUserById(...args),
        listUsers: (...args: any[]) => mockListUsers(...args),
        deleteUser: (...args: any[]) => mockDeleteUser(...args),
      },
    },
  },
}))

// Mock @supabase/supabase-js createClient (used for session verification)
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      verifyOtp: (...args: any[]) => mockVerifyOtp(...args),
      signInWithPassword: (...args: any[]) => mockSignInWithPassword(...args),
    },
  }),
}))

// ─── Mock @meshsdk/core ─────────────────────────────────────

const mockCheckSignature = vi.fn()

vi.mock('@meshsdk/core', () => ({
  checkSignature: (...args: any[]) => mockCheckSignature(...args),
}))

// ─── Mock environment variables ─────────────────────────────

vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co')
vi.stubEnv('SUPABASE_KEY', 'test-anon-key')
vi.stubEnv('SUPABASE_SECRET_KEY_LOCALHOST', 'sb_secret_offline-wallet-credential')

// ─── Test constants ─────────────────────────────────────────

// Valid mainnet Cardano address (103 characters after addr1)
const VALID_MAINNET_ADDR =
  'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp'

// Valid testnet address
const VALID_TESTNET_ADDR =
  'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwqfjkjv7'

// Invalid addresses
const INVALID_ADDR_SHORT = 'addr1abc'
const INVALID_ADDR_WRONG_PREFIX = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'

const MOCK_SIGNATURE = '845846a201276761646472657373583900a4010103272006215820'
const MOCK_KEY = 'a4010103272006215820ba76745b3f12ef3b4a03a50a8ab4e7b4d8f7e5c2a1'
const MOCK_USER_ID = '550e8400-e29b-41d4-a716-446655440000'

// ─── Test app setup ─────────────────────────────────────────

let app: express.Express

async function createApp() {
  const { default: walletAuthRouter } = await import('../wallet-auth.js')
  app = express()
  app.use(express.json())
  app.use('/api/auth/wallet', walletAuthRouter)
  app.use(errorHandler)
  return app
}

// ═══════════════════════════════════════════════════════════════
// TEST SUITES
// ═══════════════════════════════════════════════════════════════

describe('Wallet Auth Routes', () => {
  beforeEach(async () => {
    vi.clearAllMocks()

    // Default mock: DB upsert for challenges succeeds
    mockUpsert.mockResolvedValue({ data: null, error: null })
    mockSelect.mockReturnThis()
    mockEq.mockReturnThis()
    mockDelete.mockReturnThis()

    await createApp()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ─── GET /api/auth/wallet/supported ───────────────────────

  describe('GET /supported', () => {
    it('should return the list of supported wallets', async () => {
      const res = await request(app).get('/api/auth/wallet/supported')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.wallets).toBeInstanceOf(Array)
      expect(res.body.wallets.length).toBeGreaterThanOrEqual(3)

      // Verify each wallet has required fields
      for (const wallet of res.body.wallets) {
        expect(wallet).toHaveProperty('id')
        expect(wallet).toHaveProperty('name')
        expect(wallet).toHaveProperty('icon')
      }
    })

    it('should include Eternl, Lace, Typhon, and Yoroi', async () => {
      const res = await request(app).get('/api/auth/wallet/supported')

      const walletIds = res.body.wallets.map((w: any) => w.id)
      expect(walletIds).toContain('eternl')
      expect(walletIds).toContain('lace')
      expect(walletIds).toContain('typhonwallet')
      expect(walletIds).toContain('yoroi')
    })

    it('should NOT include deprecated wallets (Nami, Flint, GeroWallet)', async () => {
      const res = await request(app).get('/api/auth/wallet/supported')

      const walletIds = res.body.wallets.map((w: any) => w.id)
      expect(walletIds).not.toContain('nami')
      expect(walletIds).not.toContain('flint')
      expect(walletIds).not.toContain('gerowallet')
    })
  })

  // ─── POST /api/auth/wallet/challenge ──────────────────────

  describe('POST /challenge', () => {
    it('should return a nonce for a valid mainnet address', async () => {
      const res = await request(app)
        .post('/api/auth/wallet/challenge')
        .send({ address: VALID_MAINNET_ADDR })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.nonce).toBeDefined()
      expect(res.body.nonce).toMatch(/^[0-9a-f]{32}$/)
      expect(res.body.expiresIn).toBe(300) // 5 minutes
    })

    it('should return a nonce for a valid testnet address', async () => {
      const res = await request(app)
        .post('/api/auth/wallet/challenge')
        .send({ address: VALID_TESTNET_ADDR })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.nonce).toBeDefined()
    })

    it('should reject missing address', async () => {
      const res = await request(app)
        .post('/api/auth/wallet/challenge')
        .send({})

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/address/i)
    })

    it('should reject empty string address', async () => {
      const res = await request(app)
        .post('/api/auth/wallet/challenge')
        .send({ address: '' })

      expect(res.status).toBe(400)
    })

    it('should reject non-string address', async () => {
      const res = await request(app)
        .post('/api/auth/wallet/challenge')
        .send({ address: 12345 })

      expect(res.status).toBe(400)
    })

    it('should reject an address that is too short', async () => {
      const res = await request(app)
        .post('/api/auth/wallet/challenge')
        .send({ address: INVALID_ADDR_SHORT })

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/invalid.*cardano.*address/i)
    })

    it('should reject a Bitcoin address', async () => {
      const res = await request(app)
        .post('/api/auth/wallet/challenge')
        .send({ address: INVALID_ADDR_WRONG_PREFIX })

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/invalid.*cardano.*address/i)
    })

    it('should return different nonces for different requests', async () => {
      const res1 = await request(app)
        .post('/api/auth/wallet/challenge')
        .send({ address: VALID_MAINNET_ADDR })

      const res2 = await request(app)
        .post('/api/auth/wallet/challenge')
        .send({ address: VALID_MAINNET_ADDR })

      expect(res1.body.nonce).not.toBe(res2.body.nonce)
    })

    it('should attempt to persist challenge to DB', async () => {
      await request(app)
        .post('/api/auth/wallet/challenge')
        .send({ address: VALID_MAINNET_ADDR })

      expect(mockFrom).toHaveBeenCalledWith('wallet_challenges')
    })
  })

  // ─── POST /api/auth/wallet/verify ─────────────────────────

  describe('POST /verify', () => {
    let challengeNonce: string

    beforeEach(async () => {
      // First, request a challenge to populate the in-memory store
      const challengeRes = await request(app)
        .post('/api/auth/wallet/challenge')
        .send({ address: VALID_MAINNET_ADDR })

      challengeNonce = challengeRes.body.nonce
    })

    it('should reject when address is missing', async () => {
      const res = await request(app)
        .post('/api/auth/wallet/verify')
        .send({ nonce: challengeNonce, signature: MOCK_SIGNATURE, key: MOCK_KEY })

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/required/i)
    })

    it('should reject when nonce is missing', async () => {
      const res = await request(app)
        .post('/api/auth/wallet/verify')
        .send({ address: VALID_MAINNET_ADDR, signature: MOCK_SIGNATURE, key: MOCK_KEY })

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/required/i)
    })

    it('should reject when signature is missing', async () => {
      const res = await request(app)
        .post('/api/auth/wallet/verify')
        .send({ address: VALID_MAINNET_ADDR, nonce: challengeNonce, key: MOCK_KEY })

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/required/i)
    })

    it('should reject when key is missing', async () => {
      const res = await request(app)
        .post('/api/auth/wallet/verify')
        .send({ address: VALID_MAINNET_ADDR, nonce: challengeNonce, signature: MOCK_SIGNATURE })

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/required/i)
    })

    it('should reject an invalid Cardano address', async () => {
      const res = await request(app)
        .post('/api/auth/wallet/verify')
        .send({
          address: INVALID_ADDR_SHORT,
          nonce: challengeNonce,
          signature: MOCK_SIGNATURE,
          key: MOCK_KEY,
        })

      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/invalid.*cardano.*address/i)
    })

    it('should reject a wrong nonce', async () => {
      const res = await request(app)
        .post('/api/auth/wallet/verify')
        .send({
          address: VALID_MAINNET_ADDR,
          nonce: 'cm-auth-wrong-nonce-999999',
          signature: MOCK_SIGNATURE,
          key: MOCK_KEY,
        })

      expect(res.status).toBe(401)
      expect(res.body.message).toMatch(/nonce/i)
    })

    it('should reject an address with no pending challenge', async () => {
      // Use a different address that has no challenge issued
      const otherAddr =
        'addr1qyv3svlnekphm94m7djkqsrfzz8q2z7yn5n8rkwvtj3txv7cu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwqwa8s4z'

      // DB fallback returns nothing
      mockSingle.mockResolvedValue({ data: null, error: null })

      const res = await request(app)
        .post('/api/auth/wallet/verify')
        .send({
          address: otherAddr,
          nonce: challengeNonce,
          signature: MOCK_SIGNATURE,
          key: MOCK_KEY,
        })

      expect(res.status).toBe(401)
      expect(res.body.message).toMatch(/no pending challenge/i)
    })

    it('should reject an invalid signature (checkSignature returns false)', async () => {
      mockCheckSignature.mockReturnValue(false)
      mockSingle.mockResolvedValue({ data: null, error: null })

      const res = await request(app)
        .post('/api/auth/wallet/verify')
        .send({
          address: VALID_MAINNET_ADDR,
          nonce: challengeNonce,
          signature: MOCK_SIGNATURE,
          key: MOCK_KEY,
        })

      expect(res.status).toBe(401)
      expect(res.body.message).toMatch(/invalid wallet signature/i)

      // Verify checkSignature was called with the signed message (not raw nonce)
      const expectedMessage = `Coordination Manager Login\nNonce: ${challengeNonce}`
      expect(mockCheckSignature).toHaveBeenCalledWith(
        expectedMessage,
        { signature: MOCK_SIGNATURE, key: MOCK_KEY },
      )
    })

    it('should consume the nonce after a failed verification (one-time use)', async () => {
      mockCheckSignature.mockReturnValue(false)
      mockSingle.mockResolvedValue({ data: null, error: null })

      // First attempt — nonce exists but signature is bad
      await request(app)
        .post('/api/auth/wallet/verify')
        .send({
          address: VALID_MAINNET_ADDR,
          nonce: challengeNonce,
          signature: MOCK_SIGNATURE,
          key: MOCK_KEY,
        })

      // DB fallback returns nothing for second attempt
      mockSingle.mockResolvedValue({ data: null, error: null })

      // Second attempt with same nonce — challenge should be consumed
      const res = await request(app)
        .post('/api/auth/wallet/verify')
        .send({
          address: VALID_MAINNET_ADDR,
          nonce: challengeNonce,
          signature: MOCK_SIGNATURE,
          key: MOCK_KEY,
        })

      expect(res.status).toBe(401)
      expect(res.body.message).toMatch(/no pending challenge/i)
    })

    it('should succeed with valid signature and create a new user', async () => {
      mockCheckSignature.mockReturnValue(true)

      // signInWithPassword fails first time (user doesn't exist)
      mockSignInWithPassword.mockResolvedValueOnce({
        data: { session: null, user: null },
        error: { message: 'Invalid login credentials' },
      })

      // No existing user with this wallet
      mockMaybeSingle.mockResolvedValue({ data: null, error: null })

      // Create auth user
      mockCreateUser.mockResolvedValue({
        data: { user: { id: MOCK_USER_ID, email: `wallet-test@cardano.wallet` } },
        error: null,
      })

      // Create profile upsert
      mockUpsert.mockResolvedValue({ data: null, error: null })

      // signInWithPassword succeeds on second call (after user creation)
      mockSignInWithPassword.mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'mock-access-token',
            refresh_token: 'mock-refresh-token',
            expires_in: 3600,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          },
          user: { id: MOCK_USER_ID },
        },
        error: null,
      })

      const res = await request(app)
        .post('/api/auth/wallet/verify')
        .send({
          address: VALID_MAINNET_ADDR,
          nonce: challengeNonce,
          signature: MOCK_SIGNATURE,
          key: MOCK_KEY,
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.session).toBeDefined()
      expect(res.body.session.access_token).toBe('mock-access-token')
      expect(res.body.session.refresh_token).toBe('mock-refresh-token')
      expect(res.body.user).toBeDefined()
      expect(res.body.user.accountType).toBe('cardano')
      expect(res.body.user.walletAddress).toBe(VALID_MAINNET_ADDR)
      expect(res.body.user.roles).toContain('user')

      // Verify MeshSDK checkSignature was called with signed message
      const expectedMessage = `Coordination Manager Login\nNonce: ${challengeNonce}`
      expect(mockCheckSignature).toHaveBeenCalledWith(
        expectedMessage,
        { signature: MOCK_SIGNATURE, key: MOCK_KEY },
      )
    })

    it('should succeed with valid signature and login existing user', async () => {
      mockCheckSignature.mockReturnValue(true)

      // signInWithPassword succeeds (existing user)
      mockSignInWithPassword.mockResolvedValue({
        data: {
          session: {
            access_token: 'existing-access-token',
            refresh_token: 'existing-refresh-token',
            expires_in: 3600,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          },
          user: { id: MOCK_USER_ID },
        },
        error: null,
      })

      // Existing user profile found
      mockMaybeSingle.mockResolvedValue({
        data: { id: MOCK_USER_ID, display_name: 'Existing User', account_type: 'cardano', wallet_address: VALID_MAINNET_ADDR, role: 'user' },
        error: null,
      })

      // Update last login
      mockUpdate.mockReturnThis()
      mockEq.mockResolvedValue({ data: null, error: null })

      const res = await request(app)
        .post('/api/auth/wallet/verify')
        .send({
          address: VALID_MAINNET_ADDR,
          nonce: challengeNonce,
          signature: MOCK_SIGNATURE,
          key: MOCK_KEY,
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.session.access_token).toBe('existing-access-token')

      // Should NOT have called createUser since user already exists
      expect(mockCreateUser).not.toHaveBeenCalled()
    })

    it('stale-credential recovery keeps redirect_to_user_id for a merged wallet user (#35)', async () => {
      const GOOGLE_USER_ID = '7d9f0c1e-2b3a-4c5d-8e6f-a1b2c3d4e5f6'
      mockCheckSignature.mockReturnValue(true)

      // Derived credential no longer matches (e.g. JWT_SECRET rotated)
      mockSignInWithPassword.mockResolvedValueOnce({
        data: { session: null, user: null },
        error: { message: 'Invalid login credentials' },
      })
      // Wallet is owned by the surviving Google account
      mockMaybeSingle.mockResolvedValue({
        data: { id: GOOGLE_USER_ID, display_name: 'Google User', account_type: 'google', email: 'g@example.com', wallet_address: VALID_MAINNET_ADDR, roles: ['user'] },
        error: null,
      })
      mockCreateUser.mockResolvedValue({
        data: { user: null },
        error: { code: 'email_exists', message: 'already registered' },
      })
      mockGenerateLink.mockResolvedValue({
        data: {
          user: {
            id: MOCK_USER_ID,
            app_metadata: {
              provider: 'email',
              account_type: 'cardano',
              wallet_address: VALID_MAINNET_ADDR,
              redirect_to_user_id: GOOGLE_USER_ID,
            },
          },
        },
        error: null,
      })
      mockUpdateUserById.mockResolvedValue({ data: { user: { id: MOCK_USER_ID } }, error: null })
      mockUpdate.mockReturnThis()
      mockEq.mockReturnThis()
      mockSignInWithPassword.mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'recovered-access-token',
            refresh_token: 'recovered-refresh-token',
            expires_in: 3600,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          },
          user: { id: MOCK_USER_ID },
        },
        error: null,
      })

      const res = await request(app)
        .post('/api/auth/wallet/verify')
        .send({
          address: VALID_MAINNET_ADDR,
          nonce: challengeNonce,
          signature: MOCK_SIGNATURE,
          key: MOCK_KEY,
        })

      expect(res.status).toBe(200)
      expect(res.body.session.access_token).toBe('recovered-access-token')
      expect(mockUpdateUserById).toHaveBeenCalledTimes(1)
      const [updatedId, attrs] = mockUpdateUserById.mock.calls[0] as [string, { password?: unknown; app_metadata?: Record<string, unknown> }]
      expect(updatedId).toBe(MOCK_USER_ID)
      expect(typeof attrs.password).toBe('string')
      expect(attrs.app_metadata?.redirect_to_user_id).toBe(GOOGLE_USER_ID)
      expect(attrs.app_metadata?.wallet_address).toBe(VALID_MAINNET_ADDR)
      expect(attrs.app_metadata?.account_type).toBe('cardano')
    })

    it('should pass the correct signed message to checkSignature', async () => {
      mockCheckSignature.mockReturnValue(false)
      mockSingle.mockResolvedValue({ data: null, error: null })

      await request(app)
        .post('/api/auth/wallet/verify')
        .send({
          address: VALID_MAINNET_ADDR,
          nonce: challengeNonce,
          signature: MOCK_SIGNATURE,
          key: MOCK_KEY,
        })

      // First arg should be the signed message (buildSignMessage(nonce))
      const calledMessage = mockCheckSignature.mock.calls[0][0]
      expect(calledMessage).toBe(`Coordination Manager Login\nNonce: ${challengeNonce}`)
    })

    it('should display a truncated address as displayName', async () => {
      mockCheckSignature.mockReturnValue(true)

      // signInWithPassword fails first (new user)
      mockSignInWithPassword.mockResolvedValueOnce({
        data: { session: null, user: null },
        error: { message: 'Invalid login credentials' },
      })

      mockMaybeSingle.mockResolvedValue({ data: null, error: null })
      mockCreateUser.mockResolvedValue({
        data: { user: { id: MOCK_USER_ID, email: 'w@c.w' } },
        error: null,
      })
      mockUpsert.mockResolvedValue({ data: null, error: null })

      // signInWithPassword succeeds after creation
      mockSignInWithPassword.mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'at',
            refresh_token: 'rt',
            expires_in: 3600,
            expires_at: 9999,
          },
          user: { id: MOCK_USER_ID },
        },
        error: null,
      })

      const res = await request(app)
        .post('/api/auth/wallet/verify')
        .send({
          address: VALID_MAINNET_ADDR,
          nonce: challengeNonce,
          signature: MOCK_SIGNATURE,
          key: MOCK_KEY,
        })

      expect(res.status).toBe(200)
      // addr1qx2fx...jqp → 10 chars + ... + 4 chars
      const displayName = res.body.user.displayName
      expect(displayName).toMatch(/^addr1qx2fx\.\.\./)
      expect(displayName.length).toBeLessThan(VALID_MAINNET_ADDR.length)
    })
  })

  // ─── Address validation edge cases ────────────────────────

  describe('Address validation', () => {
    it('should accept a mainnet address with correct prefix and length', async () => {
      const res = await request(app)
        .post('/api/auth/wallet/challenge')
        .send({ address: VALID_MAINNET_ADDR })

      expect(res.status).toBe(200)
    })

    it('should accept a testnet address (addr_test1)', async () => {
      const res = await request(app)
        .post('/api/auth/wallet/challenge')
        .send({ address: VALID_TESTNET_ADDR })

      expect(res.status).toBe(200)
    })

    it('should reject uppercase characters in address', async () => {
      const upperAddr = 'addr1' + 'A'.repeat(60)
      const res = await request(app)
        .post('/api/auth/wallet/challenge')
        .send({ address: upperAddr })

      expect(res.status).toBe(400)
    })

    it('should reject special characters in address', async () => {
      const specialAddr = 'addr1' + 'a!b@c#'.repeat(10)
      const res = await request(app)
        .post('/api/auth/wallet/challenge')
        .send({ address: specialAddr })

      expect(res.status).toBe(400)
    })
  })

  // ─── Nonce format and uniqueness ──────────────────────────

  describe('Nonce integrity', () => {
    it('should produce nonces as 32-character hex strings', async () => {
      const res = await request(app)
        .post('/api/auth/wallet/challenge')
        .send({ address: VALID_MAINNET_ADDR })

      const nonce = res.body.nonce
      // 16 random bytes = 32 hex characters
      expect(nonce).toMatch(/^[0-9a-f]{32}$/)
      expect(nonce.length).toBe(32)
    })

    it('should generate unique nonces across many requests', async () => {
      const nonces = new Set<string>()

      for (let i = 0; i < 20; i++) {
        const res = await request(app)
          .post('/api/auth/wallet/challenge')
          .send({ address: VALID_MAINNET_ADDR })

        nonces.add(res.body.nonce)
      }

      expect(nonces.size).toBe(20)
    })
  })

  // ─── MeshSDK checkSignature integration ───────────────────

  describe('MeshSDK checkSignature call contract', () => {
    let nonce: string

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/auth/wallet/challenge')
        .send({ address: VALID_MAINNET_ADDR })
      nonce = res.body.nonce
    })

    it('should call checkSignature(signedMessage, {signature, key})', async () => {
      mockCheckSignature.mockReturnValue(false)
      mockSingle.mockResolvedValue({ data: null, error: null })

      await request(app)
        .post('/api/auth/wallet/verify')
        .send({
          address: VALID_MAINNET_ADDR,
          nonce,
          signature: 'sig123',
          key: 'key456',
        })

      const expectedMessage = `Coordination Manager Login\nNonce: ${nonce}`
      expect(mockCheckSignature).toHaveBeenCalledTimes(1)
      expect(mockCheckSignature).toHaveBeenCalledWith(
        expectedMessage,
        { signature: 'sig123', key: 'key456' },
      )
    })

    it('should treat checkSignature returning true as valid', async () => {
      mockCheckSignature.mockReturnValue(true)

      // signInWithPassword fails first (new user)
      mockSignInWithPassword.mockResolvedValueOnce({
        data: { session: null, user: null },
        error: { message: 'Invalid login credentials' },
      })

      mockMaybeSingle.mockResolvedValue({ data: null, error: null })
      mockCreateUser.mockResolvedValue({
        data: { user: { id: MOCK_USER_ID, email: 'w@c.w' } },
        error: null,
      })
      mockUpsert.mockResolvedValue({ data: null, error: null })

      // signInWithPassword succeeds after creation
      mockSignInWithPassword.mockResolvedValueOnce({
        data: {
          session: { access_token: 'a', refresh_token: 'r', expires_in: 3600, expires_at: 9 },
          user: { id: MOCK_USER_ID },
        },
        error: null,
      })

      const res = await request(app)
        .post('/api/auth/wallet/verify')
        .send({
          address: VALID_MAINNET_ADDR,
          nonce,
          signature: MOCK_SIGNATURE,
          key: MOCK_KEY,
        })

      expect(res.status).toBe(200)
    })

    it('should treat checkSignature returning false as invalid', async () => {
      mockCheckSignature.mockReturnValue(false)
      mockSingle.mockResolvedValue({ data: null, error: null })

      const res = await request(app)
        .post('/api/auth/wallet/verify')
        .send({
          address: VALID_MAINNET_ADDR,
          nonce,
          signature: MOCK_SIGNATURE,
          key: MOCK_KEY,
        })

      expect(res.status).toBe(401)
      expect(res.body.message).toMatch(/invalid wallet signature/i)
    })
  })

  // ─── Hex address support ──────────────────────────────────

  describe('Hex-encoded CIP-30 addresses', () => {
    // Valid hex address (58 hex chars = 29 bytes, minimum)
    const VALID_HEX_ADDR = '00' + 'a1b2c3d4e5f6'.repeat(5) + 'a1b2c3d4e5f6a1b2c3d4'

    it('should accept a valid hex-encoded address for challenge', async () => {
      const res = await request(app)
        .post('/api/auth/wallet/challenge')
        .send({ address: VALID_HEX_ADDR })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.nonce).toBeDefined()
    })

    it('should reject hex address that is too short (< 58 chars)', async () => {
      const res = await request(app)
        .post('/api/auth/wallet/challenge')
        .send({ address: '00a1b2c3d4' })

      expect(res.status).toBe(400)
    })

    it('should reject hex address with non-hex characters', async () => {
      const res = await request(app)
        .post('/api/auth/wallet/challenge')
        .send({ address: '00' + 'g1h2i3j4k5l6'.repeat(5) + 'a1b2c3d4e5f6a1b2c3d4' })

      expect(res.status).toBe(400)
    })
  })

  // ─── Challenge expiry ─────────────────────────────────────

  describe('Challenge expiry', () => {
    it('should reject verification of an expired challenge', async () => {
      // Request a challenge
      const challengeRes = await request(app)
        .post('/api/auth/wallet/challenge')
        .send({ address: VALID_MAINNET_ADDR })

      const nonce = challengeRes.body.nonce

      // Manually expire the challenge by manipulating Date.now
      const originalDateNow = Date.now
      Date.now = () => originalDateNow() + 6 * 60 * 1000 // 6 minutes later

      try {
        const res = await request(app)
          .post('/api/auth/wallet/verify')
          .send({
            address: VALID_MAINNET_ADDR,
            nonce,
            signature: MOCK_SIGNATURE,
            key: MOCK_KEY,
          })

        expect(res.status).toBe(401)
        expect(res.body.message).toMatch(/expired/i)
      } finally {
        Date.now = originalDateNow
      }
    })
  })

  // ─── Sign message construction ────────────────────────────

  describe('Sign message construction', () => {
    it('should include the nonce in the challenge response message', async () => {
      const res = await request(app)
        .post('/api/auth/wallet/challenge')
        .send({ address: VALID_MAINNET_ADDR })

      expect(res.body.message).toBeDefined()
      expect(res.body.message).toContain('Coordination Manager Login')
      expect(res.body.message).toContain(res.body.nonce)
    })

    it('should use the same message format between challenge response and verification', async () => {
      const challengeRes = await request(app)
        .post('/api/auth/wallet/challenge')
        .send({ address: VALID_MAINNET_ADDR })

      const nonce = challengeRes.body.nonce
      const expectedMessage = challengeRes.body.message

      mockCheckSignature.mockReturnValue(false)
      mockSingle.mockResolvedValue({ data: null, error: null })

      await request(app)
        .post('/api/auth/wallet/verify')
        .send({
          address: VALID_MAINNET_ADDR,
          nonce,
          signature: MOCK_SIGNATURE,
          key: MOCK_KEY,
        })

      // The message passed to checkSignature must match what was returned in the challenge
      expect(mockCheckSignature.mock.calls[0][0]).toBe(expectedMessage)
    })
  })

  // ─── Session creation failure handling ────────────────────

  describe('Session creation error handling', () => {
    let challengeNonce: string

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/auth/wallet/challenge')
        .send({ address: VALID_MAINNET_ADDR })
      challengeNonce = res.body.nonce
    })

    it('should return 500 when signInWithPassword fails after user creation', async () => {
      mockCheckSignature.mockReturnValue(true)

      // First signIn fails (new user)
      mockSignInWithPassword.mockResolvedValueOnce({
        data: { session: null, user: null },
        error: { message: 'Invalid login credentials' },
      })

      mockMaybeSingle.mockResolvedValue({ data: null, error: null })
      mockCreateUser.mockResolvedValue({
        data: { user: { id: MOCK_USER_ID, email: 'w@c.w' } },
        error: null,
      })
      mockUpsert.mockResolvedValue({ data: null, error: null })

      // Second signIn also fails
      mockSignInWithPassword.mockResolvedValueOnce({
        data: { session: null, user: null },
        error: { message: 'Something went wrong' },
      })

      const res = await request(app)
        .post('/api/auth/wallet/verify')
        .send({
          address: VALID_MAINNET_ADDR,
          nonce: challengeNonce,
          signature: MOCK_SIGNATURE,
          key: MOCK_KEY,
        })

      expect(res.status).toBe(500)
    })

    it('should return 500 when user creation fails', async () => {
      mockCheckSignature.mockReturnValue(true)

      // signIn fails (new user)
      mockSignInWithPassword.mockResolvedValueOnce({
        data: { session: null, user: null },
        error: { message: 'Invalid login credentials' },
      })

      mockMaybeSingle.mockResolvedValue({ data: null, error: null })

      // createUser fails
      mockCreateUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'User already exists' },
      })

      const res = await request(app)
        .post('/api/auth/wallet/verify')
        .send({
          address: VALID_MAINNET_ADDR,
          nonce: challengeNonce,
          signature: MOCK_SIGNATURE,
          key: MOCK_KEY,
        })

      expect(res.status).toBe(500)
    })
  })

  // ─── Supported wallets endpoint details ───────────────────

  describe('Supported wallets response structure', () => {
    it('should return exactly 4 supported wallets', async () => {
      const res = await request(app).get('/api/auth/wallet/supported')

      expect(res.body.wallets).toHaveLength(4)
    })

    it('should return wallet objects with icon URLs', async () => {
      const res = await request(app).get('/api/auth/wallet/supported')

      for (const wallet of res.body.wallets) {
        expect(wallet.icon).toMatch(/^https:\/\//)
      }
    })
  })
})
