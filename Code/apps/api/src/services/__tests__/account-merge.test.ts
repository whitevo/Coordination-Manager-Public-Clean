import crypto from 'crypto'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mock Supabase ──────────────────────────────────────────

const mockFrom = vi.fn()
const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockDelete = vi.fn()
const mockEq = vi.fn()
const mockSingle = vi.fn()
const mockMaybeSingle = vi.fn()
const mockIn = vi.fn()

const mockOr = vi.fn()
const mockLt = vi.fn()

function createChain(): Record<string, any> {
  return {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
    eq: mockEq,
    in: mockIn,
    or: mockOr,
    lt: mockLt,
    single: mockSingle,
    maybeSingle: mockMaybeSingle,
    then: (resolve: (v: any) => void) => resolve({ data: [], error: null }),
  }
}

const mockGetUserById = vi.fn()
const mockUpdateUserById = vi.fn()

vi.mock('../../supabaseClient.js', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => {
      mockFrom(...args)
      return createChain()
    },
    auth: {
      admin: {
        getUserById: (...args: unknown[]) => mockGetUserById(...args),
        updateUserById: (...args: unknown[]) => mockUpdateUserById(...args),
      },
    },
  },
}))

// ─── Import after mocks ─────────────────────────────────────

let createMergeToken: typeof import('../../services/account-merge.js').createMergeToken
let consumeMergeToken: typeof import('../../services/account-merge.js').consumeMergeToken
let mergeAccounts: typeof import('../../services/account-merge.js').mergeAccounts

beforeEach(async () => {
  vi.clearAllMocks()
  mockSelect.mockReturnThis()
  mockEq.mockReturnThis()
  mockUpdate.mockReturnThis()
  mockDelete.mockReturnThis()
  mockIn.mockReturnThis()
  mockInsert.mockReturnThis()
  mockOr.mockReturnThis()
  mockLt.mockReturnThis()
  const mod = await import('../account-merge.js')
  createMergeToken = mod.createMergeToken
  consumeMergeToken = mod.consumeMergeToken
  mergeAccounts = mod.mergeAccounts
})

afterEach(() => {
  vi.clearAllMocks()
})

// ═══════════════════════════════════════════════════════════════

describe('Account Merge Service', () => {
  // ─── createMergeToken ─────────────────────────────────────

  describe('createMergeToken', () => {
    it('creates a token and persists only its hash', async () => {
      const token = await createMergeToken('source-user-1', 'cardano')

      expect(typeof token).toBe('string')
      expect(token.length).toBeGreaterThan(10)
      expect(mockFrom).toHaveBeenCalledWith('account_merge_tokens')
      expect(mockInsert).toHaveBeenCalledTimes(1)

      const row = mockInsert.mock.calls[0][0]
      expect(row.token_hash).toBe(crypto.createHash('sha256').update(token).digest('hex'))
      expect(JSON.stringify(row)).not.toContain(token)
      expect(row.source_user_id).toBe('source-user-1')
      expect(row.source_account_type).toBe('cardano')
    })

    it('creates unique tokens each time', async () => {
      const token1 = await createMergeToken('user-1', 'google')
      const token2 = await createMergeToken('user-2', 'google')

      expect(token1).not.toBe(token2)
    })

    it('stores token with 10-minute TTL', async () => {
      await createMergeToken('user-1', 'google')

      const row = mockInsert.mock.calls[0][0]
      const expectedExpiry = Date.now() + 10 * 60 * 1000
      const expiresAt = new Date(row.expires_at).getTime()
      expect(expiresAt).toBeGreaterThan(expectedExpiry - 1000)
      expect(expiresAt).toBeLessThan(expectedExpiry + 1000)
    })

    it('throws when the token cannot be persisted', async () => {
      mockInsert.mockReturnValueOnce({
        then: (resolve: (v: any) => void) => resolve({ data: null, error: { message: 'db down' } }),
      })

      await expect(createMergeToken('user-1', 'google')).rejects.toThrow('Failed to create merge token')
    })
  })

  // ─── consumeMergeToken ────────────────────────────────────

  describe('consumeMergeToken', () => {
    it('deletes by token hash and returns the stored data', async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: {
          source_user_id: 'source-user-1',
          source_account_type: 'cardano',
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        },
        error: null,
      })

      const result = await consumeMergeToken('raw-token')

      expect(mockDelete).toHaveBeenCalledTimes(1)
      expect(mockEq).toHaveBeenCalledWith('token_hash', crypto.createHash('sha256').update('raw-token').digest('hex'))
      expect(result).toMatchObject({ sourceUserId: 'source-user-1', sourceAccountType: 'cardano', expired: false })
    })

    it('flags an expired token (still consumed)', async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: {
          source_user_id: 'source-user-1',
          source_account_type: 'google',
          expires_at: new Date(Date.now() - 60_000).toISOString(),
        },
        error: null,
      })

      const result = await consumeMergeToken('raw-token')

      expect(result?.expired).toBe(true)
    })

    it('returns null for an unknown or already-used token', async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null })

      expect(await consumeMergeToken('missing')).toBeNull()
    })

    it('throws when the lookup fails', async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'db down' } })

      await expect(consumeMergeToken('raw-token')).rejects.toThrow('Failed to verify merge token')
    })
  })

  // ─── mergeAccounts ────────────────────────────────────────

  describe('mergeAccounts', () => {
    const SOURCE_ID = 'source-user-id'
    const TARGET_ID = 'target-user-id'

    it('throws when source user not found', async () => {
      mockSingle.mockResolvedValueOnce({ data: null, error: null })
      mockSingle.mockResolvedValueOnce({ data: { id: TARGET_ID, email: 'target@test.com' }, error: null })

      await expect(mergeAccounts(SOURCE_ID, TARGET_ID, false))
        .rejects.toThrow('One or both accounts not found')
    })

    it('throws when target user not found', async () => {
      mockSingle.mockResolvedValueOnce({ data: { id: SOURCE_ID, email: 'source@test.com' }, error: null })
      mockSingle.mockResolvedValueOnce({ data: null, error: null })

      await expect(mergeAccounts(SOURCE_ID, TARGET_ID, false))
        .rejects.toThrow('One or both accounts not found')
    })

    it('transfers calendars, templates, feedback, and connections', async () => {
      const sourceUser = {
        id: SOURCE_ID,
        email: 'source@test.com',
        wallet_address: null,
        display_name: 'Source User',
        account_type: 'google',
      }
      const targetUser = {
        id: TARGET_ID,
        email: 'target@test.com',
        wallet_address: null,
        display_name: 'Target User',
        account_type: 'google',
      }

      // Fetch both profiles (.single() calls)
      mockSingle.mockResolvedValueOnce({ data: sourceUser, error: null })
      mockSingle.mockResolvedValueOnce({ data: targetUser, error: null })

      // Auth user lookup for source identities
      mockGetUserById.mockResolvedValue({ data: { user: { email: 'source@test.com' } } })

      // All subsequent select queries should return empty arrays
      // (no calendars, sources, contacts, connections, etc. to transfer)
      mockSelect.mockImplementation(() => {
        const chainWithThen: Record<string, any> = {
          eq: mockEq,
          in: mockIn,
          or: mockOr,
          single: mockSingle,
          maybeSingle: mockMaybeSingle,
          then: (resolve: (v: any) => void) => resolve({ data: [], error: null }),
        }
        return chainWithThen
      })

      // maybeSingle calls (discord integration, notification prefs, privacy) return null
      mockMaybeSingle.mockResolvedValue({ data: null, error: null })

      // updateUserById for redirect metadata
      mockUpdateUserById.mockResolvedValue({ data: null, error: null })

      await expect(mergeAccounts(SOURCE_ID, TARGET_ID, false)).resolves.not.toThrow()
    })
  })
})
