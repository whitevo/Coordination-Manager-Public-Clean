import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __testUtils, syncMailboxProviderDelta } from '../mailbox-provider-sync.js'

const state = vi.hoisted(() => ({
  existingIds: new Set<string>(),
  existingJunk: false,
  concurrentIds: new Set<string>(),
  messageWrites: vi.fn(),
  writeError: null as Error | null,
  // Stored quick-sync gap state (mail_sync_cursors resource_type 'messages_quick_gap').
  gapCursor: null as string | null,
}))

vi.mock('../mailbox-credentials.js', () => ({
  getMailboxCredential: vi.fn(async () => ({
    accessToken: 'test-token', refreshToken: null,
    expiresAt: '2099-01-01T00:00:00Z',
  })),
  upsertMailboxCredential: vi.fn(),
}))
vi.mock('../mailbox-oauth.js', () => ({ refreshMailboxOAuthAccessToken: vi.fn() }))
vi.mock('../../supabaseClient.js', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      let ids: string[] = []
      let written: Array<{ provider_message_id: string }> | null = null
      let ignoreDuplicates = false
      let resourceType: string | null = null
      const result = () => {
        if (table === 'mail_messages' && written) {
          const inserted = written.filter(row => !state.concurrentIds.has(row.provider_message_id))
          return {
            data: ignoreDuplicates ? inserted : null,
            error: state.writeError,
          }
        }
        return {
          data: table === 'mail_messages'
            ? ids.filter(id => state.existingIds.has(id)).map(id => ({
              id: `db-${id}`, provider_message_id: id, provider_metadata: { provider_junk: state.existingJunk },
            }))
            : [],
          error: null,
        }
      }
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn((column: string, value: unknown) => {
          if (column === 'resource_type') resourceType = String(value)
          return chain
        }),
        order: vi.fn(() => chain),
        in: vi.fn((column: string, values: string[]) => {
          if (column === 'provider_message_id') ids = values
          return chain
        }),
        upsert: vi.fn((records: Array<{ provider_message_id: string }>, options: { ignoreDuplicates?: boolean }) => {
          written = records
          ignoreDuplicates = options.ignoreDuplicates === true
          if (table === 'mail_messages') state.messageWrites(records, options)
          return chain
        }),
        maybeSingle: vi.fn(async () => (resourceType === 'messages_quick_gap'
          ? { data: state.gapCursor === null ? null : { cursor: state.gapCursor }, error: null }
          : { data: { cursor: 'manual-history-page', last_error: null }, error: null })),
        then: (resolve: (value: ReturnType<typeof result>) => unknown) => resolve(result()),
      }
      return chain
    },
  },
}))

const receivedAt = new Date().toISOString()
const quickOptions = {
  newMailOnly: true, quickSyncAfter: receivedAt, includeInbox: true,
  includeSent: false, includeTrash: false, includeSpam: false, includeArchived: false,
}

function mockGmail(ids: string[], junk = false) {
  const fetchMock = vi.fn(async (input: string) => {
    const url = new URL(input)
    if (url.pathname.endsWith('/messages')) {
      return { ok: true, json: async () => ({ messages: ids.map(id => ({ id })) }) }
    }
    const id = url.pathname.split('/').at(-1)
    return {
      ok: true,
      json: async () => ({
        id, labelIds: junk ? ['SPAM'] : ['INBOX'], internalDate: String(new Date(receivedAt).getTime()),
        payload: { mimeType: 'text/plain', headers: [], body: { data: Buffer.from('Hello').toString('base64url') } },
      }),
    }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  state.existingIds.clear()
  state.existingJunk = false
  state.concurrentIds.clear()
  state.messageWrites.mockClear()
  state.writeError = null
  state.gapCursor = null
})
afterEach(() => vi.unstubAllGlobals())

describe('additions-only provider sync', () => {
  it('performs no message writes or body fetches for repeated unchanged Gmail checks', async () => {
    state.existingIds.add('known')
    const fetchMock = mockGmail(['known'])
    for (let check = 0; check < 2; check++) {
      expect(await syncMailboxProviderDelta({
        userId: 'user', accountId: 'account', provider: 'gmail', options: quickOptions,
      })).toMatchObject({ inserted: 0, updated: 0, insertedProviderMessageIds: [], cursor: 'manual-history-page' })
    }
    expect(state.messageWrites).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [url] of fetchMock.mock.calls) {
      expect(new URL(url).searchParams.has('pageToken')).toBe(false)
      expect(new URL(url).searchParams.get('q')).toContain('after:')
    }
  })

  it('fetches and inserts only new Gmail IDs while preserving the manual-import cursor', async () => {
    state.existingIds.add('known')
    const fetchMock = mockGmail(['known', 'new'])
    const result = await syncMailboxProviderDelta({
      userId: 'user', accountId: 'account', provider: 'gmail', options: quickOptions,
    })
    expect(result).toMatchObject({ inserted: 1, updated: 0, insertedProviderMessageIds: ['new'], cursor: 'manual-history-page' })
    expect(state.messageWrites).toHaveBeenCalledWith(
      [expect.objectContaining({ provider_message_id: 'new' })],
      { onConflict: 'account_id,provider_message_id', ignoreDuplicates: true },
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('ignores a concurrent insert without rewriting it or reporting it for automation', async () => {
    state.concurrentIds.add('new')
    mockGmail(['new'])
    const result = await syncMailboxProviderDelta({
      userId: 'user', accountId: 'account', provider: 'gmail', options: quickOptions,
    })
    expect(result).toMatchObject({ inserted: 0, updated: 0, insertedProviderMessageIds: [] })
    expect(state.messageWrites.mock.calls[0][1].ignoreDuplicates).toBe(true)
  })

  it('still refreshes existing message contents during a manual import', async () => {
    state.existingIds.add('known')
    mockGmail(['known'])
    const result = await syncMailboxProviderDelta({
      userId: 'user', accountId: 'account', provider: 'gmail',
      options: { ...quickOptions, newMailOnly: false },
    })
    expect(result).toMatchObject({ inserted: 0, updated: 1 })
    expect(state.messageWrites.mock.calls[0][1].ignoreDuplicates).toBe(false)
  })

  it('reports only existing messages newly transitioned into Junk, not new or unchanged Junk', async () => {
    state.existingIds.add('known')
    mockGmail(['known', 'new'], true)
    const sync = () => syncMailboxProviderDelta({
      userId: 'user', accountId: 'account', provider: 'gmail',
      options: { ...quickOptions, newMailOnly: false, includeInbox: false, includeSpam: true },
    })
    expect(await sync()).toMatchObject({
      insertedProviderMessageIds: ['new'], junkedProviderMessageIds: ['known'],
    })
    state.existingJunk = true
    expect(await sync()).toMatchObject({ junkedProviderMessageIds: [] })
    state.existingJunk = false
    mockGmail(['known'])
    expect(await sync()).toMatchObject({ junkedProviderMessageIds: [] })
  })

  it('skips attachment fetches and writes for known Outlook messages', async () => {
    state.existingIds.add('known')
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ value: [{ id: 'known', hasAttachments: true, receivedDateTime: receivedAt }] }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await syncMailboxProviderDelta({
      userId: 'user', accountId: 'account', provider: 'outlook', options: quickOptions,
    })
    expect(result).toMatchObject({ inserted: 0, updated: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(state.messageWrites).not.toHaveBeenCalled()
  })

  it('inserts new Outlook messages without rewriting known ones', async () => {
    state.existingIds.add('known')
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ value: [
        { id: 'known', hasAttachments: true, receivedDateTime: receivedAt },
        { id: 'new', hasAttachments: false, receivedDateTime: receivedAt, body: { contentType: 'text', content: 'Hello' } },
      ] }),
    })))
    const result = await syncMailboxProviderDelta({
      userId: 'user', accountId: 'account', provider: 'outlook', options: quickOptions,
    })
    expect(result).toMatchObject({ inserted: 1, updated: 0, insertedProviderMessageIds: ['new'] })
    expect(state.messageWrites).toHaveBeenCalledWith(
      [expect.objectContaining({ provider_message_id: 'new' })],
      { onConflict: 'account_id,provider_message_id', ignoreDuplicates: true },
    )
  })

  it('propagates insertion errors rather than reporting successful new mail', async () => {
    state.writeError = new Error('database unavailable')
    mockGmail(['new'])
    await expect(syncMailboxProviderDelta({
      userId: 'user', accountId: 'account', provider: 'gmail', options: quickOptions,
    })).rejects.toThrow('database unavailable')
  })
})

describe('quick sync burst handling (#38)', () => {
  const MINUTE = 60 * 1000

  // Gmail mock that honours `after:` (epoch seconds), lists newest-first, and pages by offset.
  function mockGmailMailbox(mail: Array<{ id: string; receivedMs: number }>) {
    const listQueries: Array<{ q: string | null; pageToken: string | null }> = []
    const byId = new Map(mail.map(m => [m.id, m]))
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input)
      if (url.pathname.endsWith('/messages')) {
        const q = url.searchParams.get('q')
        const pageToken = url.searchParams.get('pageToken')
        listQueries.push({ q, pageToken })
        const afterSec = Number(/after:(\d+)/.exec(q || '')?.[1] ?? 0)
        const pageSize = Number(url.searchParams.get('maxResults'))
        const matching = mail
          .filter(m => Math.floor(m.receivedMs / 1000) > afterSec)
          .sort((a, b) => b.receivedMs - a.receivedMs)
        const offset = pageToken ? Number(pageToken) : 0
        const page = matching.slice(offset, offset + pageSize)
        const next = offset + pageSize < matching.length ? String(offset + pageSize) : undefined
        return { ok: true, json: async () => ({ messages: page.map(m => ({ id: m.id })), nextPageToken: next }) }
      }
      const id = url.pathname.split('/').at(-1) || ''
      return {
        ok: true,
        json: async () => ({
          id, labelIds: ['INBOX'], internalDate: String(byId.get(id)?.receivedMs ?? Date.now()),
          payload: { mimeType: 'text/plain', headers: [], body: { data: Buffer.from('Hi').toString('base64url') } },
        }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)
    return { fetchMock, listQueries }
  }

  function burst(count: number, startMs: number, stepMs: number) {
    return Array.from({ length: count }, (_, i) => ({ id: `m${String(i).padStart(3, '0')}`, receivedMs: startMs + (i + 1) * stepMs }))
  }

  it('fetches a burst larger than one page across pages and then advances the watermark', async () => {
    const watermarkMs = Date.now() - 60 * MINUTE
    const mail = burst(60, watermarkMs, 20 * 1000) // 60 new messages, page size 25 -> 3 pages
    const { listQueries } = mockGmailMailbox(mail)

    const result = await syncMailboxProviderDelta({
      userId: 'user', accountId: 'account', provider: 'gmail',
      options: { ...quickOptions, maxMessages: 25, quickSyncAfter: new Date(watermarkMs).toISOString() },
    })

    expect(result.inserted).toBe(60)
    expect(new Set(result.insertedProviderMessageIds)).toEqual(new Set(mail.map(m => m.id)))
    expect(listQueries.map(c => c.pageToken)).toEqual([null, '25', '50'])
    // Every page continues the same query the token was issued for.
    expect(new Set(listQueries.map(c => c.q)).size).toBe(1)
    expect(result.quickSync).toEqual({
      advanceTo: new Date(mail[59].receivedMs).toISOString(),
      gapState: null,
      persistGapState: false,
    })
    // Full-sync history cursor is untouched by quick sync.
    expect(result.cursor).toBe('manual-history-page')
  })

  it('keeps the watermark when the page cap is hit and the next run closes the gap', async () => {
    const watermarkMs = Date.now() - 60 * MINUTE
    const mail = burst(100, watermarkMs, 20 * 1000) // 4 pages of 25; top walk cap is 3 pages
    const { listQueries } = mockGmailMailbox(mail)
    const options = { ...quickOptions, maxMessages: 25, quickSyncAfter: new Date(watermarkMs).toISOString() }

    const first = await syncMailboxProviderDelta({ userId: 'user', accountId: 'account', provider: 'gmail', options })
    expect(first.inserted).toBe(75)
    expect(first.quickSync?.advanceTo).toBeNull()
    expect(first.quickSync?.persistGapState).toBe(true)
    const gap = JSON.parse(first.quickSync?.gapState || 'null') as { floor: string; upper: string; segments: Array<{ token: string | null }> }
    expect(gap.floor).toBe(new Date(watermarkMs).toISOString())
    expect(gap.segments).toEqual([expect.objectContaining({ stream: 'gmail', token: '75' })])

    // Persist what run 1 produced, then run again with the watermark unchanged.
    for (const id of first.insertedProviderMessageIds) state.existingIds.add(id)
    state.gapCursor = first.quickSync?.gapState ?? null
    const firstRunQuery = listQueries[0].q
    listQueries.length = 0

    const second = await syncMailboxProviderDelta({ userId: 'user', accountId: 'account', provider: 'gmail', options })
    const firstIds = new Set(first.insertedProviderMessageIds)
    expect(second.insertedProviderMessageIds.every(id => !firstIds.has(id))).toBe(true)
    expect(new Set([...first.insertedProviderMessageIds, ...second.insertedProviderMessageIds])).toEqual(new Set(mail.map(m => m.id)))
    // The gap walk resumed the stored token with the exact query it was issued for.
    expect(listQueries).toContainEqual({ q: firstRunQuery, pageToken: '75' })
    expect(second.quickSync).toEqual({
      advanceTo: new Date(mail[99].receivedMs).toISOString(),
      gapState: null,
      persistGapState: true,
    })
  })

  it('never advances the watermark past now for a future-dated message', async () => {
    const watermarkMs = Date.now() - 10 * MINUTE
    mockGmailMailbox([
      { id: 'normal', receivedMs: watermarkMs + MINUTE },
      { id: 'bogus-future', receivedMs: Date.now() + 2 * 24 * 60 * MINUTE },
    ])
    const result = await syncMailboxProviderDelta({
      userId: 'user', accountId: 'account', provider: 'gmail',
      options: { ...quickOptions, quickSyncAfter: new Date(watermarkMs).toISOString() },
    })
    expect(result.inserted).toBe(2)
    const advanceMs = new Date(result.quickSync?.advanceTo || '').getTime()
    expect(Number.isFinite(advanceMs)).toBe(true)
    expect(advanceMs).toBeLessThanOrEqual(Date.now())
    expect(advanceMs).toBeGreaterThan(watermarkMs)
  })

  it('does not let a stored future watermark hide new mail', async () => {
    const realNewMs = Date.now() - MINUTE
    const { listQueries } = mockGmailMailbox([{ id: 'fresh', receivedMs: realNewMs }])
    const result = await syncMailboxProviderDelta({
      userId: 'user', accountId: 'account', provider: 'gmail',
      options: { ...quickOptions, quickSyncAfter: new Date(Date.now() + 3 * 24 * 60 * MINUTE).toISOString() },
    })
    expect(result.insertedProviderMessageIds).toEqual(['fresh'])
    const afterSec = Number(/after:(\d+)/.exec(listQueries[0].q || '')?.[1])
    expect(afterSec * 1000).toBeLessThanOrEqual(Date.now())
  })

  it('pages Outlook nextLinks until a page reaches below the watermark', async () => {
    const watermarkMs = Date.now() - 30 * MINUTE
    const iso = (ms: number) => new Date(ms).toISOString()
    const nextLink = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skip=2'
    const unusedLink = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skip=4'
    const fetchMock = vi.fn(async (input: string) => ({
      ok: true,
      json: async () => (input === nextLink
        ? { value: [
          { id: 'o3', receivedDateTime: iso(watermarkMs + MINUTE), body: { contentType: 'text', content: 'c' } },
          { id: 'old', receivedDateTime: iso(watermarkMs - 60 * MINUTE), body: { contentType: 'text', content: 'd' } },
        ], '@odata.nextLink': unusedLink }
        : { value: [
          { id: 'o1', receivedDateTime: iso(watermarkMs + 3 * MINUTE), body: { contentType: 'text', content: 'a' } },
          { id: 'o2', receivedDateTime: iso(watermarkMs + 2 * MINUTE), body: { contentType: 'text', content: 'b' } },
        ], '@odata.nextLink': nextLink }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await syncMailboxProviderDelta({
      userId: 'user', accountId: 'account', provider: 'outlook',
      options: { ...quickOptions, quickSyncAfter: iso(watermarkMs) },
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.insertedProviderMessageIds).toEqual(expect.arrayContaining(['o1', 'o2', 'o3']))
    expect(result.quickSync).toMatchObject({ advanceTo: iso(watermarkMs + 3 * MINUTE), gapState: null })
  })

  it('discards stored Outlook gap tokens that are not Microsoft Graph URLs', () => {
    const raw = JSON.stringify({
      v: 1, provider: 'outlook', floor: '2026-10-01T00:00:00.000Z', upper: '2026-10-01T01:00:00.000Z',
      segments: [
        { stream: 'inbox', afterMs: 1, token: 'https://attacker.example/steal' },
        { stream: 'inbox', afterMs: 2, token: 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skip=5' },
        { stream: 'sentitems', afterMs: 3, token: null },
      ],
    })
    const parsed = __testUtils.parseQuickSyncGapState(raw, 'outlook', ['inbox'])
    expect(parsed?.segments).toEqual([
      { stream: 'inbox', afterMs: 1, token: null },
      { stream: 'inbox', afterMs: 2, token: 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skip=5' },
    ])
    expect(__testUtils.parseQuickSyncGapState('not json', 'outlook', ['inbox'])).toBeNull()
    expect(__testUtils.parseQuickSyncGapState(raw, 'gmail', ['gmail'])).toBeNull()
  })
})
