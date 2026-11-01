import { createHash, createHmac } from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rows, mockFrom, storageError } = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  mockFrom: vi.fn(),
  storageError: { value: null as Error | null },
}))

vi.mock('../../supabaseClient.js', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      mockFrom(table)
      const equals: Array<[string, unknown]> = []
      let expiry = ''
      const query = {
        delete: () => query,
        eq: (column: string, value: unknown) => { equals.push([column, value]); return query },
        gt: (_column: string, value: string) => { expiry = value; return query },
        select: () => query,
        lt: async (_column: string, value: string) => {
          if (storageError.value) return { error: storageError.value }
          for (const [id, row] of rows) {
            if (typeof row.expires_at === 'string' && row.expires_at < value) rows.delete(id)
          }
          return { error: null }
        },
        insert: async (row: Record<string, unknown>) => {
          if (storageError.value) return { error: storageError.value }
          rows.set(String(row.id), row)
          return { error: null }
        },
        maybeSingle: async () => {
          if (storageError.value) return { data: null, error: storageError.value }
          for (const [id, row] of rows) {
            if (equals.every(([column, value]) => row[column] === value) &&
              typeof row.expires_at === 'string' && row.expires_at > expiry) {
              rows.delete(id)
              return { data: { id }, error: null }
            }
          }
          return { data: null, error: null }
        },
      }
      return query
    },
  },
}))

import {
  consumeMailboxOAuthTransaction,
  createMailboxOAuthTransaction,
  MAILBOX_OAUTH_MAX_AGE_MS,
  readMailboxOAuthCookie,
  signMailboxOAuthState,
  verifyMailboxOAuthState,
} from '../mailbox-oauth.js'

const owner = { userId: '550e8400-e29b-41d4-a716-446655440000', provider: 'gmail' as const, identityGroup: 'work' }

describe('Mailbox OAuth transactions', () => {
  beforeEach(() => {
    rows.clear()
    mockFrom.mockClear()
    storageError.value = null
    vi.stubEnv('JWT_SECRET', 'test-jwt-secret')
    vi.useRealTimers()
  })

  it('stores only a browser-token hash and binds the signed state to the initiating owner', async () => {
    const transaction = await createMailboxOAuthTransaction(owner)
    const state = verifyMailboxOAuthState(transaction.state)
    expect(state).toMatchObject(owner)
    expect(state?.expiresAt).toBeGreaterThan(Date.now())
    const row = [...rows.values()][0]
    expect(row.browser_token_hash).toBe(createHash('sha256').update(transaction.browserToken).digest('hex'))
    expect(JSON.stringify(row)).not.toContain(transaction.browserToken)
    expect(await consumeMailboxOAuthTransaction(transaction.state, transaction.browserToken, 'gmail')).toMatchObject(owner)
    expect(await consumeMailboxOAuthTransaction(transaction.state, transaction.browserToken, 'gmail')).toBeNull()
  })

  it('leaves a transaction available to its owner after wrong-browser and wrong-provider attempts', async () => {
    const transaction = await createMailboxOAuthTransaction(owner)
    expect(await consumeMailboxOAuthTransaction(transaction.state, 'a'.repeat(64), 'gmail')).toBeNull()
    expect(await consumeMailboxOAuthTransaction(transaction.state, null, 'gmail')).toBeNull()
    expect(await consumeMailboxOAuthTransaction(transaction.state, transaction.browserToken, 'outlook')).toBeNull()
    expect(rows.size).toBe(1)
    expect(await consumeMailboxOAuthTransaction(transaction.state, transaction.browserToken, 'gmail')).not.toBeNull()
  })

  it('permits only one simultaneous callback to claim a transaction', async () => {
    const transaction = await createMailboxOAuthTransaction(owner)
    const results = await Promise.all([
      consumeMailboxOAuthTransaction(transaction.state, transaction.browserToken, 'gmail'),
      consumeMailboxOAuthTransaction(transaction.state, transaction.browserToken, 'gmail'),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('rejects expired state and prunes abandoned transactions on the next initiation', async () => {
    vi.useFakeTimers()
    const transaction = await createMailboxOAuthTransaction(owner)
    vi.advanceTimersByTime(MAILBOX_OAUTH_MAX_AGE_MS + 1)
    expect(await consumeMailboxOAuthTransaction(transaction.state, transaction.browserToken, 'gmail')).toBeNull()
    await createMailboxOAuthTransaction(owner)
    expect(rows.size).toBe(1)
    vi.useRealTimers()
  })

  it('propagates transaction storage failures rather than returning an authorization URL or success', async () => {
    storageError.value = new Error('Storage unavailable')
    await expect(createMailboxOAuthTransaction(owner)).rejects.toThrow('Storage unavailable')
    storageError.value = null
    const transaction = await createMailboxOAuthTransaction(owner)
    storageError.value = new Error('Storage unavailable')
    await expect(consumeMailboxOAuthTransaction(transaction.state, transaction.browserToken, 'gmail')).rejects.toThrow('Storage unavailable')
  })

  it('rejects legacy, tampered, and incorrectly typed signed payloads', async () => {
    const transaction = await createMailboxOAuthTransaction(owner)
    expect(verifyMailboxOAuthState(`${transaction.state}x`)).toBeNull()
    const valid = verifyMailboxOAuthState(transaction.state)!
    expect(verifyMailboxOAuthState(signMailboxOAuthState({ ...valid, expiresAt: Date.now() + MAILBOX_OAUTH_MAX_AGE_MS * 2 }))).toBeNull()
    for (const payload of [owner, { ...valid, userId: {} }, { ...valid, expiresAt: 'tomorrow' }, null]) {
      const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
      const state = `${data}.${createHmac('sha256', 'test-jwt-secret').update(data).digest('base64url')}`
      expect(verifyMailboxOAuthState(state)).toBeNull()
    }
  })

  it('rejects missing, duplicate, or malformed browser cookies', () => {
    expect(readMailboxOAuthCookie(undefined, 'gmail')).toBeNull()
    expect(readMailboxOAuthCookie('cm_mailbox_oauth_gmail=bad', 'gmail')).toBeNull()
    const cookie = `cm_mailbox_oauth_gmail=${'a'.repeat(64)}`
    expect(readMailboxOAuthCookie(`${cookie}; ${cookie}`, 'gmail')).toBeNull()
    expect(readMailboxOAuthCookie(`other=value; ${cookie}`, 'gmail')).toBe('a'.repeat(64))
  })
})
