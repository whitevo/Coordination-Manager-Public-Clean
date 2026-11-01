import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  events: [] as string[],
  syncMailboxProviderDelta: vi.fn(),
  extractInvitationsForAccount: vi.fn(),
  accountRow: {
    id: 'account-1',
    user_id: 'user-1',
    status: 'connected' as string,
    provider: 'gmail',
    address: 'mail@example.com',
    updated_at: null as string | null,
    last_synced_at: null as string | null,
    created_at: '2026-09-01T00:00:00.000Z',
    quick_sync_after: null as string | null,
    sync_failure_count: 0 as number | null,
  },
  accountUpdates: [] as Array<Record<string, unknown>>,
  // Per-status { error } returned by an awaited mail_accounts update chain.
  accountUpdateErrors: {} as Record<string, unknown>,
  auditInserts: [] as Array<Record<string, unknown>>,
  cursorUpserts: [] as Array<Record<string, unknown>>,
  autoSyncFilters: [] as string[],
  autoSyncRows: [] as Array<{ id: string; user_id: string; sync_options: Record<string, unknown> }>,
}))

function createSupabaseChain(table: string) {
  let pendingUpdateStatus: string | null = null
  const chain = {
    // Awaiting an update(...).eq(...) chain resolves like supabase-js: { data, error }.
    then: (resolve: (value: { data: null; error: unknown }) => unknown) => resolve({
      data: null,
      error: pendingUpdateStatus !== null ? (mocks.accountUpdateErrors[pendingUpdateStatus] ?? null) : null,
    }),
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    or: vi.fn((filter: string) => {
      mocks.autoSyncFilters.push(filter)
      return chain
    }),
    order: vi.fn(() => chain),
    lt: vi.fn(async () => ({ data: [], error: null })),
    limit: vi.fn(async () => ({ data: table === 'mail_accounts' ? mocks.autoSyncRows : [], error: null })),
    maybeSingle: vi.fn(async () => {
      mocks.events.push(`${table}:maybeSingle`)
      return {
        data: { ...mocks.accountRow },
        error: null,
      }
    }),
    update: vi.fn((values: { status?: string }) => {
      mocks.events.push(`${table}:update:${values.status || 'unknown'}`)
      if (table === 'mail_accounts') {
        mocks.accountUpdates.push({ ...values })
        pendingUpdateStatus = values.status || 'unknown'
      }
      return chain
    }),
    upsert: vi.fn(async (values: Record<string, unknown>) => {
      mocks.events.push(`${table}:upsert`)
      if (table === 'mail_sync_cursors') mocks.cursorUpserts.push({ ...values })
      return { error: null }
    }),
    insert: vi.fn(async (values: Record<string, unknown>) => {
      mocks.events.push(`${table}:insert`)
      if (table === 'mail_audit_events') mocks.auditInserts.push({ ...values })
      return { error: null }
    }),
  }
  return chain
}

vi.mock('../../supabaseClient.js', () => ({
  supabaseAdmin: {
    from: (table: string) => createSupabaseChain(table),
  },
}))

vi.mock('../mailbox-provider-sync.js', () => ({
  DEFAULT_SYNC_OPTIONS: { maxMessages: 100, daysBack: 30 },
  QUICK_SYNC_GAP_RESOURCE_TYPE: 'messages_quick_gap',
  syncMailboxProviderDelta: mocks.syncMailboxProviderDelta,
}))

vi.mock('../mailbox-invitations.js', () => ({
  extractInvitationsForAccount: mocks.extractInvitationsForAccount,
}))

describe('runMailboxAccountSync', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    mocks.events.length = 0
    mocks.syncMailboxProviderDelta.mockReset()
    mocks.extractInvitationsForAccount.mockReset()
    mocks.accountRow.status = 'connected'
    mocks.accountRow.updated_at = null
    mocks.accountRow.last_synced_at = null
    mocks.accountRow.quick_sync_after = null
    mocks.accountRow.sync_failure_count = 0
    mocks.accountUpdates.length = 0
    mocks.accountUpdateErrors = {}
    mocks.auditInserts.length = 0
    mocks.cursorUpserts.length = 0
    mocks.autoSyncFilters.length = 0
    mocks.autoSyncRows = []
    // Reset the module-level automation hook so a previous test's hook (which may
    // wait on a manually-resolved promise) doesn't leak into and hang this one.
    const { setMailboxSyncAutomationHook } = await import('../mailbox-sync.js')
    setMailboxSyncAutomationHook(async () => ({ matched: 0, applied: 0, deferred: 0 }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('awaits import automation before marking the sync connected', async () => {
    const { runMailboxAccountSync, setMailboxSyncAutomationHook } = await import('../mailbox-sync.js')
    let finishAutomation: (() => void) | null = null
    const automationStarted = new Promise<void>((resolve) => {
      setMailboxSyncAutomationHook(async () => {
        mocks.events.push('automation:start')
        resolve()
        await new Promise<void>((finish) => {
          finishAutomation = finish
        })
        mocks.events.push('automation:end')
        return { matched: 1, applied: 1, deferred: 0 }
      })
    })

    mocks.syncMailboxProviderDelta.mockResolvedValueOnce({
      inserted: 1,
      updated: 0,
      insertedProviderMessageIds: ['provider-message-1'],
      cursor: 'cursor-1',
    })
    mocks.extractInvitationsForAccount.mockResolvedValueOnce({ parsed: 0, insertedOrUpdated: 0 })

    const syncPromise = runMailboxAccountSync('account-1', 'user-1', 'user')
    await automationStarted

    expect(mocks.events).toContain('mail_accounts:update:syncing')
    expect(mocks.events).not.toContain('mail_accounts:update:connected')

    finishAutomation?.()
    const result = await syncPromise

    expect(mocks.events.indexOf('automation:end')).toBeLessThan(
      mocks.events.indexOf('mail_accounts:update:connected'),
    )
    expect(result.automation).toEqual({ matched: 1, applied: 1, deferred: 0 })
  })

  it('passes existing Junk transitions to automation even when no messages were inserted', async () => {
    const { runMailboxAccountSync, setMailboxSyncAutomationHook } = await import('../mailbox-sync.js')
    const hook = vi.fn(async () => ({ matched: 1, applied: 2, deferred: 0 }))
    setMailboxSyncAutomationHook(hook)
    mocks.syncMailboxProviderDelta.mockResolvedValueOnce({
      inserted: 0, updated: 1, insertedProviderMessageIds: [],
      junkedProviderMessageIds: ['existing-junk'], cursor: null,
    })
    mocks.extractInvitationsForAccount.mockResolvedValueOnce({ parsed: 0, insertedOrUpdated: 0 })
    const result = await runMailboxAccountSync('account-1', 'user-1', 'user')
    expect(hook).toHaveBeenCalledWith({
      userId: 'user-1', accountId: 'account-1', newMessageProviderIds: [],
      junkedProviderMessageIds: ['existing-junk'],
    })
    expect(result.automation).toEqual({ matched: 1, applied: 2, deferred: 0 })
  })

  it('skips starting a new provider sync when another one for this account is still fresh-in-progress', async () => {
    mocks.accountRow.status = 'syncing'
    mocks.accountRow.updated_at = new Date().toISOString() // just started, well inside the timeout window
    mocks.accountRow.last_synced_at = '2026-09-01T00:00:00.000Z'

    const { runMailboxAccountSync } = await import('../mailbox-sync.js')
    const result = await runMailboxAccountSync('account-1', 'user-1', 'user')

    expect(mocks.syncMailboxProviderDelta).not.toHaveBeenCalled()
    expect(mocks.extractInvitationsForAccount).not.toHaveBeenCalled()
    expect(mocks.events).not.toContain('mail_accounts:update:syncing')
    expect(result).toEqual({
      accountId: 'account-1',
      userId: 'user-1',
      status: 'connected',
      lastSyncedAt: '2026-09-01T00:00:00.000Z',
      invitationsParsed: 0,
      invitationsChanged: 0,
      insertedMessages: 0,
      updatedMessages: 0,
      newMessageProviderIds: [],
      cursor: null,
      automation: { matched: 0, applied: 0, deferred: 0 },
    })
  })

  it('treats a stale "syncing" status (older than the sync timeout) as a dead lock and proceeds', async () => {
    mocks.accountRow.status = 'syncing'
    mocks.accountRow.updated_at = new Date(Date.now() - 3 * 60 * 1000).toISOString() // 3 minutes ago > 120s timeout

    mocks.syncMailboxProviderDelta.mockResolvedValueOnce({
      inserted: 0,
      updated: 0,
      insertedProviderMessageIds: [],
      cursor: null,
    })
    mocks.extractInvitationsForAccount.mockResolvedValueOnce({ parsed: 0, insertedOrUpdated: 0 })

    const { runMailboxAccountSync } = await import('../mailbox-sync.js')
    const result = await runMailboxAccountSync('account-1', 'user-1', 'user')

    expect(mocks.syncMailboxProviderDelta).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('connected')
  })

  it('uses saved source choices but forces additions-only scheduled sync', async () => {
    const savedOptions = {
      maxMessages: 250,
      daysBack: 62,
      includeInbox: true,
      includeSent: false,
      includeTrash: false,
      includeSpam: false,
      newMailOnly: false,
      quickSyncIncludeInbox: false,
      quickSyncIncludeSent: true,
    }
    mocks.accountRow.quick_sync_after = '2026-10-05T08:00:00.000Z'
    mocks.autoSyncRows = [{ id: 'account-1', user_id: 'user-1', sync_options: savedOptions }]
    mocks.syncMailboxProviderDelta.mockResolvedValueOnce({
      inserted: 0,
      updated: 0,
      insertedProviderMessageIds: [],
      cursor: null,
    })
    mocks.extractInvitationsForAccount.mockResolvedValueOnce({ parsed: 0, insertedOrUpdated: 0 })

    const { runPersistedMailboxAutoSync } = await import('../mailbox-sync.js')
    await runPersistedMailboxAutoSync()

    expect(mocks.syncMailboxProviderDelta).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-1',
        options: expect.objectContaining({
          maxMessages: 100,
          daysBack: 62,
          includeInbox: false,
          includeSent: true,
          includeTrash: false,
          includeSpam: false,
          newMailOnly: true,
          quickSyncAfter: '2026-10-05T08:00:00.000Z',
        }),
      }),
    )
    expect(mocks.extractInvitationsForAccount).toHaveBeenCalledWith('account-1', 'user-1', [])
  })

  it('keeps quick_sync_after and persists the gap state while a quick-sync gap is open (#38)', async () => {
    mocks.accountRow.quick_sync_after = '2026-10-05T08:00:00.000Z'
    const gapState = JSON.stringify({ v: 1, provider: 'gmail', floor: '2026-10-05T08:00:00.000Z', upper: '2026-10-05T09:00:00.000Z', segments: [{ stream: 'gmail', afterMs: 1, token: '75' }] })
    mocks.syncMailboxProviderDelta.mockResolvedValueOnce({
      inserted: 75, updated: 0, insertedProviderMessageIds: ['a'], cursor: 'history-cursor',
      newestMessageReceivedAt: '2026-10-05T09:00:00.000Z',
      quickSync: { advanceTo: null, gapState, persistGapState: true },
    })
    mocks.extractInvitationsForAccount.mockResolvedValueOnce({ parsed: 0, insertedOrUpdated: 0 })
    const { runMailboxAccountSync } = await import('../mailbox-sync.js')
    const result = await runMailboxAccountSync('account-1', 'user-1', 'user', { newMailOnly: true })

    expect(result.status).toBe('connected')
    expect(mocks.cursorUpserts).toContainEqual(expect.objectContaining({
      account_id: 'account-1', resource_type: 'messages_quick_gap', cursor: gapState,
    }))
    // The full-sync history cursor is still written separately and unchanged in meaning.
    expect(mocks.cursorUpserts).toContainEqual(expect.objectContaining({ resource_type: 'messages', cursor: 'history-cursor' }))
    const connected = mocks.accountUpdates.find(update => update.status === 'connected')
    expect(connected?.quick_sync_after).toBe('2026-10-05T08:00:00.000Z')
  })

  it('advances quick_sync_after when the quick-sync gap closes and clears the gap state', async () => {
    mocks.accountRow.quick_sync_after = '2026-10-05T08:00:00.000Z'
    mocks.syncMailboxProviderDelta.mockResolvedValueOnce({
      inserted: 25, updated: 0, insertedProviderMessageIds: [], cursor: null,
      newestMessageReceivedAt: '2026-10-05T08:30:00.000Z',
      quickSync: { advanceTo: '2026-10-05T09:00:00.000Z', gapState: null, persistGapState: true },
    })
    mocks.extractInvitationsForAccount.mockResolvedValueOnce({ parsed: 0, insertedOrUpdated: 0 })
    const { runMailboxAccountSync } = await import('../mailbox-sync.js')
    await runMailboxAccountSync('account-1', 'user-1', 'user', { newMailOnly: true })

    expect(mocks.cursorUpserts).toContainEqual(expect.objectContaining({ resource_type: 'messages_quick_gap', cursor: null }))
    const connected = mocks.accountUpdates.find(update => update.status === 'connected')
    expect(connected?.quick_sync_after).toBe('2026-10-05T09:00:00.000Z')
  })

  it('skips the gap-state write when there is no gap to persist', async () => {
    mocks.accountRow.quick_sync_after = '2026-10-05T08:00:00.000Z'
    mocks.syncMailboxProviderDelta.mockResolvedValueOnce({
      inserted: 0, updated: 0, insertedProviderMessageIds: [], cursor: null, newestMessageReceivedAt: null,
      quickSync: { advanceTo: '2026-10-05T08:00:00.000Z', gapState: null, persistGapState: false },
    })
    mocks.extractInvitationsForAccount.mockResolvedValueOnce({ parsed: 0, insertedOrUpdated: 0 })
    const { runMailboxAccountSync } = await import('../mailbox-sync.js')
    await runMailboxAccountSync('account-1', 'user-1', 'user', { newMailOnly: true })

    expect(mocks.cursorUpserts.some(row => row.resource_type === 'messages_quick_gap')).toBe(false)
    const connected = mocks.accountUpdates.find(update => update.status === 'connected')
    expect(connected?.quick_sync_after).toBe('2026-10-05T08:00:00.000Z')
  })

  it('clamps quick_sync_after to now when a future-dated message is the newest', async () => {
    vi.setSystemTime(new Date('2026-10-18T12:00:00.000Z'))
    mocks.accountRow.quick_sync_after = '2026-10-18T11:00:00.000Z'
    mocks.syncMailboxProviderDelta.mockResolvedValueOnce({
      inserted: 1, updated: 0, insertedProviderMessageIds: ['future'], cursor: null,
      newestMessageReceivedAt: '2027-01-01T00:00:00.000Z',
    })
    mocks.extractInvitationsForAccount.mockResolvedValueOnce({ parsed: 0, insertedOrUpdated: 0 })
    const { runMailboxAccountSync } = await import('../mailbox-sync.js')
    await runMailboxAccountSync('account-1', 'user-1', 'user', { newMailOnly: false })

    const connected = mocks.accountUpdates.find(update => update.status === 'connected')
    expect(connected?.quick_sync_after).toBe('2026-10-18T12:00:00.000Z')
  })

  it('resolveNextQuickSyncAfter only moves forward and never past now', async () => {
    const { resolveNextQuickSyncAfter } = await import('../mailbox-sync.js')
    const nowMs = new Date('2026-10-18T12:00:00.000Z').getTime()
    expect(resolveNextQuickSyncAfter(null, null, nowMs)).toBeNull()
    expect(resolveNextQuickSyncAfter('2026-10-18T10:00:00.000Z', null, nowMs)).toBe('2026-10-18T10:00:00.000Z')
    expect(resolveNextQuickSyncAfter('2026-10-18T10:00:00.000Z', '2026-10-18T09:00:00.000Z', nowMs)).toBe('2026-10-18T10:00:00.000Z')
    expect(resolveNextQuickSyncAfter('2026-10-18T10:00:00.000Z', '2026-10-18T11:00:00Z', nowMs)).toBe('2026-10-18T11:00:00.000Z')
    expect(resolveNextQuickSyncAfter(null, '2030-01-01T00:00:00.000Z', nowMs)).toBe('2026-10-18T12:00:00.000Z')
    // A previously stored future watermark is pulled back to now.
    expect(resolveNextQuickSyncAfter('2030-01-01T00:00:00.000Z', null, nowMs)).toBe('2026-10-18T12:00:00.000Z')
  })

  it('limits invitation extraction to newly inserted messages during a quick check', async () => {
    mocks.syncMailboxProviderDelta.mockResolvedValueOnce({
      inserted: 1, updated: 0, insertedProviderMessageIds: ['new-id'], cursor: 'history-cursor',
    })
    mocks.extractInvitationsForAccount.mockResolvedValueOnce({ parsed: 1, insertedOrUpdated: 1 })
    const { runMailboxAccountSync } = await import('../mailbox-sync.js')
    await runMailboxAccountSync('account-1', 'user-1', 'user', { newMailOnly: true })
    expect(mocks.extractInvitationsForAccount).toHaveBeenCalledWith('account-1', 'user-1', ['new-id'])
  })

  it('preserves history-import mode and full invitation extraction for manual imports', async () => {
    mocks.syncMailboxProviderDelta.mockResolvedValueOnce({
      inserted: 0, updated: 1, insertedProviderMessageIds: [], cursor: 'next-page',
    })
    mocks.extractInvitationsForAccount.mockResolvedValueOnce({ parsed: 250, insertedOrUpdated: 0 })
    const { runMailboxAccountSync } = await import('../mailbox-sync.js')
    await runMailboxAccountSync('account-1', 'user-1', 'user', { newMailOnly: false })
    expect(mocks.syncMailboxProviderDelta).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ newMailOnly: false }),
    }))
    expect(mocks.extractInvitationsForAccount).toHaveBeenCalledWith('account-1', 'user-1', undefined)
  })

  it.each(['error', 'syncing'])('retries invitations inserted during a failed or interrupted check (%s)', async status => {
    mocks.accountRow.status = status
    mocks.accountRow.last_synced_at = '2026-10-01T00:00:00.000Z'
    mocks.syncMailboxProviderDelta.mockResolvedValueOnce({
      inserted: 0, updated: 0, insertedProviderMessageIds: [], cursor: null,
    })
    mocks.extractInvitationsForAccount.mockResolvedValueOnce({ parsed: 1, insertedOrUpdated: 1 })
    const { runMailboxAccountSync } = await import('../mailbox-sync.js')
    const result = await runMailboxAccountSync('account-1', 'user-1', 'server_auto_sync')
    expect(result.status).toBe('connected')
    expect(mocks.extractInvitationsForAccount).toHaveBeenCalledWith(
      'account-1', 'user-1', [], '2026-10-01T00:00:00.000Z',
    )
  })

  it('uses account creation as the invitation recovery boundary before the first successful check', async () => {
    mocks.accountRow.status = 'error'
    mocks.syncMailboxProviderDelta.mockResolvedValueOnce({
      inserted: 0, updated: 0, insertedProviderMessageIds: [], cursor: null,
    })

    mocks.extractInvitationsForAccount.mockResolvedValueOnce({ parsed: 0, insertedOrUpdated: 0 })
    const { runMailboxAccountSync } = await import('../mailbox-sync.js')
    await runMailboxAccountSync('account-1', 'user-1', 'server_auto_sync')
    expect(mocks.extractInvitationsForAccount).toHaveBeenCalledWith(
      'account-1', 'user-1', [], mocks.accountRow.created_at,
    )
  })

  it('recovers stale scheduled checks without clearing their unfinished state first', async () => {
    mocks.accountRow.status = 'syncing'
    mocks.accountRow.updated_at = new Date(Date.now() - 4 * 60 * 1000).toISOString()
    mocks.autoSyncRows = [{ id: 'account-1', user_id: 'user-1', sync_options: { newMailOnly: false } }]
    mocks.syncMailboxProviderDelta.mockResolvedValueOnce({
      inserted: 0, updated: 0, insertedProviderMessageIds: [], cursor: null,
    })
    mocks.extractInvitationsForAccount.mockResolvedValueOnce({ parsed: 0, insertedOrUpdated: 0 })
    const { runPersistedMailboxAutoSync } = await import('../mailbox-sync.js')
    await runPersistedMailboxAutoSync()
    expect(mocks.accountUpdates[0].status).toBe('syncing')
    expect(mocks.autoSyncFilters).toContainEqual(expect.stringContaining('status.neq.syncing,updated_at.is.null,updated_at.lt.'))
    expect(mocks.extractInvitationsForAccount).toHaveBeenCalledWith(
      'account-1', 'user-1', [], mocks.accountRow.created_at,
    )
  })

  it('marks a revoked grant as a terminal auth failure with no retry time', async () => {
    mocks.syncMailboxProviderDelta.mockRejectedValueOnce(new Error('Token has been expired or revoked.'))

    const { runMailboxAccountSync } = await import('../mailbox-sync.js')
    const result = await runMailboxAccountSync('account-1', 'user-1', 'server_auto_sync')

    expect(result.status).toBe('error')
    const errorUpdate = mocks.accountUpdates.find((values) => values.status === 'error')
    expect(errorUpdate).toMatchObject({
      sync_error_kind: 'auth',
      sync_retry_after: null,
      sync_failure_count: 1,
    })
  })

  it('backs a transient failure off exponentially from the stored failure count', async () => {
    mocks.accountRow.sync_failure_count = 3
    mocks.syncMailboxProviderDelta.mockRejectedValueOnce(new Error('Sync timeout: Email provider took too long to respond'))

    const { runMailboxAccountSync } = await import('../mailbox-sync.js')
    await runMailboxAccountSync('account-1', 'user-1', 'server_auto_sync')

    const errorUpdate = mocks.accountUpdates.find((values) => values.status === 'error')
    expect(errorUpdate).toMatchObject({ sync_error_kind: 'transient', sync_failure_count: 4 })

    const retryAfterMs = new Date(String(errorUpdate?.sync_retry_after)).getTime()
    const delayMs = retryAfterMs - Date.now()
    expect(delayMs).toBeGreaterThanOrEqual(8 * 60_000)
    expect(delayMs).toBeLessThanOrEqual(9 * 60_000)
  })

  it('clears backoff state after a successful sync', async () => {
    mocks.accountRow.sync_failure_count = 5
    mocks.syncMailboxProviderDelta.mockResolvedValueOnce({
      inserted: 0,
      updated: 0,
      insertedProviderMessageIds: [],
      cursor: null,
    })
    mocks.extractInvitationsForAccount.mockResolvedValueOnce({ parsed: 0, insertedOrUpdated: 0 })

    const { runMailboxAccountSync } = await import('../mailbox-sync.js')
    await runMailboxAccountSync('account-1', 'user-1', 'server_auto_sync')

    const connectedUpdate = mocks.accountUpdates.find((values) => values.status === 'connected')
    expect(connectedUpdate).toMatchObject({
      sync_failure_count: 0,
      sync_retry_after: null,
      sync_error_kind: null,
    })
  })

  const TIMEOUT_DISPLAY_MESSAGE = 'Network error. Check your connection and try again.'

  function expectTimeoutFailureRecorded(result: { status: string; error?: string }): void {
    expect(result.status).toBe('error')
    expect(result.error).toBe(TIMEOUT_DISPLAY_MESSAGE)
    const lastUpdate = mocks.accountUpdates[mocks.accountUpdates.length - 1]
    expect(lastUpdate).toMatchObject({ status: 'error', sync_error: TIMEOUT_DISPLAY_MESSAGE, sync_error_kind: 'transient' })
    expect(mocks.accountUpdates.some((values) => values.status === 'connected')).toBe(false)
    expect(mocks.auditInserts).toContainEqual(expect.objectContaining({
      operation: 'sync_account',
      outcome: 'failure',
      reason: TIMEOUT_DISPLAY_MESSAGE,
    }))
  }

  it('times out and marks the account error when invitation extraction never resolves', async () => {
    mocks.syncMailboxProviderDelta.mockResolvedValueOnce({
      inserted: 1, updated: 0, insertedProviderMessageIds: ['new-id'], cursor: 'cursor-1',
    })
    mocks.extractInvitationsForAccount.mockImplementationOnce(() => new Promise<never>(() => undefined))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const { runMailboxAccountSync } = await import('../mailbox-sync.js')
    const syncPromise = runMailboxAccountSync('account-1', 'user-1', 'user')
    await vi.advanceTimersByTimeAsync(120_000)
    const result = await syncPromise

    expect(mocks.extractInvitationsForAccount).toHaveBeenCalledTimes(1)
    expectTimeoutFailureRecorded(result)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('times out and marks the account error when the automation hook hangs', async () => {
    const { runMailboxAccountSync, setMailboxSyncAutomationHook } = await import('../mailbox-sync.js')
    setMailboxSyncAutomationHook(() => new Promise<never>(() => undefined))
    mocks.syncMailboxProviderDelta.mockResolvedValueOnce({
      inserted: 1, updated: 0, insertedProviderMessageIds: ['new-id'], cursor: 'cursor-1',
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const syncPromise = runMailboxAccountSync('account-1', 'user-1', 'user')
    await vi.advanceTimersByTimeAsync(120_000)
    const result = await syncPromise

    expect(mocks.extractInvitationsForAccount).not.toHaveBeenCalled()
    expectTimeoutFailureRecorded(result)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the sync timeout timer after a successful sync', async () => {
    mocks.syncMailboxProviderDelta.mockResolvedValueOnce({
      inserted: 0, updated: 0, insertedProviderMessageIds: [], cursor: null,
    })
    mocks.extractInvitationsForAccount.mockResolvedValueOnce({ parsed: 0, insertedOrUpdated: 0 })

    const { runMailboxAccountSync } = await import('../mailbox-sync.js')
    const result = await runMailboxAccountSync('account-1', 'user-1', 'user')

    expect(result.status).toBe('connected')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('marks the account error when the final connected status write returns an error', async () => {
    mocks.accountUpdateErrors.connected = { code: '57014', message: 'canceling statement due to statement timeout' }
    mocks.syncMailboxProviderDelta.mockResolvedValueOnce({
      inserted: 0, updated: 0, insertedProviderMessageIds: [], cursor: null,
    })
    mocks.extractInvitationsForAccount.mockResolvedValueOnce({ parsed: 0, insertedOrUpdated: 0 })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const { runMailboxAccountSync } = await import('../mailbox-sync.js')
    const result = await runMailboxAccountSync('account-1', 'user-1', 'user')

    const displayMessage = 'Could not save mailbox sync progress. Please try again.'
    expect(result.status).toBe('error')
    expect(result.error).toBe(displayMessage)
    expect(mocks.accountUpdates[mocks.accountUpdates.length - 1]).toMatchObject({
      status: 'error',
      sync_error: displayMessage,
    })
    expect(mocks.auditInserts).toEqual([expect.objectContaining({
      operation: 'sync_account',
      outcome: 'failure',
      reason: displayMessage,
    })])
  })

  it('logs a failed error-status write instead of dropping it silently', async () => {
    mocks.accountUpdateErrors.error = { code: '08006', message: 'connection failure\r\nInjected: line' }
    mocks.syncMailboxProviderDelta.mockRejectedValueOnce(new Error('Rate limit exceeded (429)'))
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const { runMailboxAccountSync } = await import('../mailbox-sync.js')
    const result = await runMailboxAccountSync('account-1', 'user-1', 'user')

    expect(result.status).toBe('error')
    const writeFailureLog = errorLog.mock.calls
      .map((args) => String(args[0]))
      .find((line) => line.includes('mail_accounts (status=error) write failed'))
    expect(writeFailureLog).toBeDefined()
    expect(writeFailureLog).toContain('08006')
    expect(writeFailureLog).not.toMatch(/[\r\n]/)
  })
})