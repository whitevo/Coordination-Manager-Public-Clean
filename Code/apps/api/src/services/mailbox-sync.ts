import { supabaseAdmin } from '../supabaseClient.js'
import { extractInvitationsForAccount } from './mailbox-invitations.js'
import {
  DEFAULT_SYNC_OPTIONS,
  MailboxProviderSyncOptions,
  QUICK_SYNC_GAP_RESOURCE_TYPE,
  QuickSyncProgress,
  syncMailboxProviderDelta,
} from './mailbox-provider-sync.js'

interface MailAccountSyncRow {
  id: string
  user_id: string
  status: 'connected' | 'syncing' | 'error' | 'disconnected'
  provider: 'gmail' | 'outlook' | 'imap'
  address: string
  updated_at: string | null
  last_synced_at: string | null
  created_at: string
  quick_sync_after: string | null
  sync_failure_count: number | null
}

type MailboxSyncErrorKind = 'auth' | 'transient'

export interface MailboxSyncResult {
  accountId: string
  userId: string
  status: 'connected' | 'error'
  lastSyncedAt: string | null
  invitationsParsed: number
  invitationsChanged: number
  insertedMessages: number
  updatedMessages: number
  newMessageProviderIds: string[]
  cursor: string | null
  automation: MailboxSyncAutomationSummary
  error?: string
}

interface MailboxSyncAutomationSummary {
  matched: number
  applied: number
  deferred: number
}

const EMPTY_AUTOMATION_SUMMARY: MailboxSyncAutomationSummary = { matched: 0, applied: 0, deferred: 0 }

type MailboxSyncAutomationHook = (input: {
  userId: string
  accountId: string
  newMessageProviderIds: string[]
  junkedProviderMessageIds: string[]
}) => Promise<MailboxSyncAutomationSummary>

let mailboxSyncAutomationHook: MailboxSyncAutomationHook | null = null

export function setMailboxSyncAutomationHook(hook: MailboxSyncAutomationHook): void {
  mailboxSyncAutomationHook = hook
}

const SYNC_TIMEOUT_MS = 120_000 // 2 minutes
const SYNC_TIMEOUT_MESSAGE = 'Sync timeout: Email provider took too long to respond'
const SYNC_STATE_WRITE_FAILED_PREFIX = 'Mailbox sync state write failed'
const RETRY_BASE_MS = 60_000

interface ProviderSyncSummary {
  inserted: number
  updated: number
  insertedProviderMessageIds: string[]
  junkedProviderMessageIds?: string[]
  cursor: string | null
  newestMessageReceivedAt: string | null
  quickSync?: QuickSyncProgress
}

/**
 * Next quick_sync_after value: only moves forward, and never past `nowMs` (a future-dated
 * message, or a previously stored future value, must not stall quick sync).
 */
export function resolveNextQuickSyncAfter(current: string | null, candidate: string | null, nowMs: number): string | null {
  const currentMs = current ? new Date(current).getTime() : NaN
  const candidateMs = candidate ? new Date(candidate).getTime() : NaN
  const hasCurrent = Number.isFinite(currentMs)
  const hasCandidate = Number.isFinite(candidateMs)
  if (!hasCurrent && !hasCandidate) return current
  const nextMs = Math.min(nowMs, Math.max(hasCurrent ? currentMs : -Infinity, hasCandidate ? candidateMs : -Infinity))
  if (hasCurrent && nextMs === currentMs) return current
  return new Date(nextMs).toISOString()
}

interface InvitationSyncSummary {
  parsed: number
  insertedOrUpdated: number
}

interface SupabaseWriteResult {
  error?: unknown
}

// Short, log-safe description of a Supabase write error: code + message only,
// CR/LF stripped (log injection) and truncated. Never includes request payloads.
function describeWriteError(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error).replace(/[\r\n]+/g, ' ').slice(0, 200)
  const record = error as { code?: unknown; message?: unknown }
  const code = typeof record.code === 'string' ? record.code : 'unknown'
  const message = typeof record.message === 'string' ? record.message : ''
  return `${code} ${message}`.replace(/[\r\n]+/g, ' ').slice(0, 200)
}

// supabase-js reports write failures via { error } instead of throwing. Finalizing
// writes must throw so the catch path marks the account 'error' instead of leaving
// it stuck in 'syncing' or recording success without a status change.
function assertSyncStateWrite(result: SupabaseWriteResult | null | undefined, target: string, syncId: string): void {
  if (!result?.error) return
  console.error(`[SYNC-${syncId}] ${target} write failed: ${describeWriteError(result.error)}`)
  throw new Error(`${SYNC_STATE_WRITE_FAILED_PREFIX}: ${target}`)
}

function logSyncWriteError(result: SupabaseWriteResult | null | undefined, target: string, syncId: string): void {
  if (!result?.error) return
  console.error(`[SYNC-${syncId}] ${target} write failed: ${describeWriteError(result.error)}`)
}
const RETRY_MAX_MS = 60 * 60 * 1000

function nextRetryDelayMs(failureCount: number): number {
  const exponent = Math.max(0, failureCount - 1)
  const base = RETRY_BASE_MS * Math.pow(2, Math.min(exponent, 10))
  const jitter = Math.floor(Math.random() * RETRY_BASE_MS)
  return Math.min(RETRY_MAX_MS, base) + jitter
}

export async function runMailboxAccountSync(
  accountId: string,
  userId: string,
  actor: string,
  options?: Partial<MailboxProviderSyncOptions>,
): Promise<MailboxSyncResult> {
  const syncId = Math.random().toString(36).substring(7)
  const startMs = Date.now()

  const { data: account, error: accountError } = await supabaseAdmin
    .from('mail_accounts')
    .select('id, user_id, status, provider, address, updated_at, last_synced_at, created_at, quick_sync_after, sync_failure_count')
    .eq('id', accountId)
    .eq('user_id', userId)
    .maybeSingle()

  if (accountError) {
    console.error(`[SYNC-${syncId}] Account lookup error:`, accountError)
    throw accountError
  }
  if (!account) {
    console.error(`[SYNC-${syncId}] Account not found`)
    throw new Error('Mailbox account not found')
  }

  const typedAccount = account as MailAccountSyncRow
  const syncOptions = {
    ...options,
    newMailOnly: actor === 'server_auto_sync' || options?.newMailOnly === true,
    quickSyncAfter: typedAccount.quick_sync_after,
  }
  const nowIso = new Date().toISOString()

  // Guards against two processes syncing the SAME account concurrently (e.g. a
  // local dev server and production both pointed at the same Supabase project,
  // or overlapping manual + scheduled auto-sync). Without this, both would race
  // to refresh the same OAuth credentials -- rotating refresh tokens (Outlook)
  // get invalidated by the loser, producing a fast auth failure on one side and
  // a stalled/timed-out request on the other. A 'syncing' status is only
  // trusted while fresher than the sync timeout; past that it is treated as a
  // stale lock left by a crashed/killed process, not a real in-progress sync.
  const lastUpdatedMs = typedAccount.updated_at ? new Date(typedAccount.updated_at).getTime() : 0
  const syncingElapsedMs = Date.now() - lastUpdatedMs
  if (typedAccount.status === 'syncing' && Number.isFinite(lastUpdatedMs) && lastUpdatedMs > 0 && syncingElapsedMs < SYNC_TIMEOUT_MS) {
    console.warn(`[SYNC-${syncId}] Skipped: another sync for this account started ${Math.round(syncingElapsedMs / 1000)}s ago is still in progress`)
    return {
      accountId: typedAccount.id,
      userId: typedAccount.user_id,
      status: 'connected',
      lastSyncedAt: typedAccount.last_synced_at,
      invitationsParsed: 0,
      invitationsChanged: 0,
      insertedMessages: 0,
      updatedMessages: 0,
      newMessageProviderIds: [],
      cursor: null,
      automation: EMPTY_AUTOMATION_SUMMARY,
    }
  }

  // Mark as syncing
  await supabaseAdmin
    .from('mail_accounts')
    .update({
      status: 'syncing',
      sync_error: null,
      updated_at: nowIso,
    })
    .eq('id', typedAccount.id)
    .eq('user_id', typedAccount.user_id)

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  try {
    // The whole post-'syncing' pipeline (provider delta + automation hook +
    // invitation extraction) is bounded by one timeout so a hang in any stage
    // still lands in the catch path below and the account leaves 'syncing'.
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        console.error(`[SYNC-${syncId}] TIMEOUT: Sync exceeded 120 seconds`)
        reject(new Error(SYNC_TIMEOUT_MESSAGE))
      }, SYNC_TIMEOUT_MS)
    })

    const pipelinePromise = (async () => {
      const providerSummary: ProviderSyncSummary = typedAccount.provider === 'imap'
        ? { inserted: 0, updated: 0, insertedProviderMessageIds: [], cursor: null, newestMessageReceivedAt: null }
        : await syncMailboxProviderDelta({
            accountId: typedAccount.id,
            userId: typedAccount.user_id,
            provider: typedAccount.provider,
            options: syncOptions,
          }) as ProviderSyncSummary

      const automationSummary = mailboxSyncAutomationHook
        ? await mailboxSyncAutomationHook({
          userId: typedAccount.user_id,
          accountId: typedAccount.id,
          newMessageProviderIds: providerSummary.insertedProviderMessageIds,
          junkedProviderMessageIds: providerSummary.junkedProviderMessageIds || [],
        })
        : EMPTY_AUTOMATION_SUMMARY

      const recoveringQuickSync = syncOptions.newMailOnly
        && (typedAccount.status === 'error' || typedAccount.status === 'syncing')
      const invitationSummary: InvitationSyncSummary = recoveringQuickSync
        ? await extractInvitationsForAccount(
            typedAccount.id,
            typedAccount.user_id,
            providerSummary.insertedProviderMessageIds,
            typedAccount.last_synced_at || typedAccount.created_at,
          )
        : await extractInvitationsForAccount(
            typedAccount.id,
            typedAccount.user_id,
            syncOptions.newMailOnly ? providerSummary.insertedProviderMessageIds : undefined,
          )

      return { providerSummary, automationSummary, invitationSummary }
    })()

    const { providerSummary, automationSummary, invitationSummary } = await Promise.race([pipelinePromise, timeoutPromise])

    const cursorWrite = await supabaseAdmin
      .from('mail_sync_cursors')
      .upsert({
        account_id: typedAccount.id,
        resource_type: 'messages',
        cursor: providerSummary.cursor,
        last_successful_sync_at: nowIso,
        last_error: null,
        updated_at: nowIso,
      }, { onConflict: 'account_id,resource_type' })
    assertSyncStateWrite(cursorWrite, 'mail_sync_cursors', syncId)

    // Quick-sync gap state is written before the watermark moves: if this write fails the
    // sync errors out and quick_sync_after is not advanced past unfetched mail.
    if (providerSummary.quickSync?.persistGapState) {
      const gapWrite = await supabaseAdmin
        .from('mail_sync_cursors')
        .upsert({
          account_id: typedAccount.id,
          resource_type: QUICK_SYNC_GAP_RESOURCE_TYPE,
          cursor: providerSummary.quickSync.gapState,
          last_successful_sync_at: nowIso,
          last_error: null,
          updated_at: nowIso,
        }, { onConflict: 'account_id,resource_type' })
      assertSyncStateWrite(gapWrite, 'mail_sync_cursors (quick gap)', syncId)
    }

    // Quick syncs advance only to the point where everything newer is known to be fetched
    // (null while a gap is open); other syncs keep using the newest fetched message.
    const watermarkCandidate = providerSummary.quickSync
      ? providerSummary.quickSync.advanceTo
      : providerSummary.newestMessageReceivedAt
    const nextQuickSyncAfter = resolveNextQuickSyncAfter(typedAccount.quick_sync_after, watermarkCandidate, Date.now())

    const connectedWrite = await supabaseAdmin
      .from('mail_accounts')
      .update({
        status: 'connected',
        last_synced_at: nowIso,
        sync_error: null,
        sync_failure_count: 0,
        sync_retry_after: null,
        sync_error_kind: null,
        quick_sync_after: nextQuickSyncAfter,
        updated_at: nowIso,
      })
      .eq('id', typedAccount.id)
      .eq('user_id', typedAccount.user_id)
    assertSyncStateWrite(connectedWrite, 'mail_accounts', syncId)

    // The account is already 'connected' here; an audit write failure is logged
    // rather than flipping a completed sync to 'error'.
    const successAuditWrite = await supabaseAdmin
      .from('mail_audit_events')
      .insert({
        user_id: typedAccount.user_id,
        account_id: typedAccount.id,
        actor,
        operation: 'sync_account',
        target_type: 'mail_account',
        target_id: typedAccount.id,
        outcome: 'success',
        reason: `inserted:${providerSummary.inserted},updated:${providerSummary.updated},invitations_changed:${invitationSummary.insertedOrUpdated}`,
      })
    logSyncWriteError(successAuditWrite, 'mail_audit_events', syncId)

    return {
      accountId: typedAccount.id,
      userId: typedAccount.user_id,
      status: 'connected',
      lastSyncedAt: nowIso,
      invitationsParsed: invitationSummary.parsed,
      invitationsChanged: invitationSummary.insertedOrUpdated,
      insertedMessages: providerSummary.inserted,
      updatedMessages: providerSummary.updated,
      newMessageProviderIds: providerSummary.insertedProviderMessageIds,
      cursor: providerSummary.cursor,
      automation: automationSummary,
    }
  } catch (err: unknown) {
    const durationMs = Date.now() - startMs
    let displayMessage = 'Mailbox sync failed'
    let errorKind: MailboxSyncErrorKind = 'transient'

    if (err instanceof Error) {
      const msg = err.message.toLowerCase()
      console.error(`[SYNC-${syncId}] ERROR: ${err.message}`)

      // Classify error for user-facing message
      if (/401|403|invalid.*credential|invalid_grant|expired|unauthorized/i.test(msg)) {
        displayMessage = 'Account access expired or revoked. Please reconnect your email account.'
        errorKind = 'auth'
      } else if (/429|rate.*limit|too.*many|quota.*exceed/i.test(msg)) {
        displayMessage = 'Email provider rate limit reached. Please try again in a few minutes.'
      } else if (/timeout|econnrefused|enotfound|network|dns|unreachable/i.test(msg)) {
        displayMessage = 'Network error. Check your connection and try again.'
      } else if (/credentials.*missing/i.test(msg)) {
        displayMessage = 'Email account credentials not found. Please reconnect your account.'
        errorKind = 'auth'
      } else if (msg.startsWith(SYNC_STATE_WRITE_FAILED_PREFIX.toLowerCase())) {
        displayMessage = 'Could not save mailbox sync progress. Please try again.'
      } else {
        displayMessage = err.message
      }
    }

    const failureCount = Math.max(0, Number(typedAccount.sync_failure_count) || 0) + 1
    // An 'auth' failure cannot recover without a user reconnect, so it gets no retry time at all --
    // the auto-sync loop skips it outright instead of re-redeeming a dead refresh token every pass.
    const retryAfterIso = errorKind === 'auth'
      ? null
      : new Date(Date.now() + nextRetryDelayMs(failureCount)).toISOString()

    if (errorKind === 'auth') {
      console.error(`[SYNC-${syncId}] Auth failure -- auto-sync paused for this account until it is reconnected`)
    } else {
      console.error(`[SYNC-${syncId}] Transient failure #${failureCount} -- next auto-sync attempt after ${retryAfterIso}`)
    }

    console.error(`[SYNC-${syncId}] Setting account status to 'error': ${displayMessage}`)
    const errorStatusWrite = await supabaseAdmin
      .from('mail_accounts')
      .update({
        status: 'error',
        sync_error: displayMessage,
        sync_failure_count: failureCount,
        sync_retry_after: retryAfterIso,
        sync_error_kind: errorKind,
        updated_at: new Date().toISOString(),
      })
      .eq('id', typedAccount.id)
      .eq('user_id', typedAccount.user_id)
    // No retry here: a failed write is logged (sanitized) and the stale-'syncing'
    // lock expiry plus the next auto-sync pass recover the account.
    logSyncWriteError(errorStatusWrite, 'mail_accounts (status=error)', syncId)

    const errorCursorWrite = await supabaseAdmin
      .from('mail_sync_cursors')
      .upsert({
        account_id: typedAccount.id,
        resource_type: 'messages',
        last_error: displayMessage,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'account_id,resource_type' })
    logSyncWriteError(errorCursorWrite, 'mail_sync_cursors', syncId)

    const failureAuditWrite = await supabaseAdmin
      .from('mail_audit_events')
      .insert({
        user_id: typedAccount.user_id,
        account_id: typedAccount.id,
        actor,
        operation: 'sync_account',
        target_type: 'mail_account',
        target_id: typedAccount.id,
        outcome: 'failure',
        reason: displayMessage,
      })
    logSyncWriteError(failureAuditWrite, 'mail_audit_events', syncId)

    console.error(`[SYNC-${syncId}] FAILED: ${displayMessage} (${durationMs}ms)`)

    return {
      accountId: typedAccount.id,
      userId: typedAccount.user_id,
      status: 'error',
      lastSyncedAt: null,
      invitationsParsed: 0,
      invitationsChanged: 0,
      insertedMessages: 0,
      updatedMessages: 0,
      newMessageProviderIds: [],
      cursor: null,
      automation: EMPTY_AUTOMATION_SUMMARY,
      error: displayMessage,
    }
  } finally {
    clearTimeout(timeoutHandle)
  }
}

export async function runPersistedMailboxAutoSync(opts?: { maxAccounts?: number }): Promise<{ synced: number; failed: number }> {
  const maxAccounts = Number.isFinite(Number(opts?.maxAccounts))
    ? Math.max(1, Math.floor(Number(opts?.maxAccounts)))
    : 100

  // Keep stale status intact so the account-sync path can recover unfinished invitation work.
  const staleThreshold = new Date(Date.now() - 3 * 60 * 1000).toISOString()
  // Accounts whose OAuth grant is dead ('auth') are excluded until the user reconnects: retrying
  // them every pass only re-redeems a revoked refresh token, which providers throttle. Transient
  // failures are excluded only until their backoff window elapses.
  const { data: accounts, error } = await supabaseAdmin
    .from('mail_accounts')
    .select('id, user_id, sync_options, quick_sync_max_messages')
    .in('status', ['connected', 'error', 'syncing'])
    .or(`status.neq.syncing,updated_at.is.null,updated_at.lt.${staleThreshold}`)
    .or('sync_error_kind.is.null,sync_error_kind.neq.auth')
    .or(`sync_retry_after.is.null,sync_retry_after.lte.${new Date().toISOString()}`)
    .order('last_synced_at', { ascending: true, nullsFirst: true })
    .limit(maxAccounts)

  if (error) throw error

  let synced = 0
  let failed = 0
  for (const row of accounts || []) {
    const persistedOptions = row.sync_options && typeof row.sync_options === 'object' && !Array.isArray(row.sync_options)
      ? row.sync_options as Partial<MailboxProviderSyncOptions>
      : DEFAULT_SYNC_OPTIONS
    const savedOptions: Record<string, unknown> = row.sync_options || {}
    const quickSourceOption = (key: string, fallback: boolean | undefined) => (
      typeof savedOptions[key] === 'boolean' ? savedOptions[key] : fallback
    )
    const result = await runMailboxAccountSync(row.id as string, row.user_id as string, 'server_auto_sync', {
      ...persistedOptions,
      maxMessages: row.quick_sync_max_messages ?? DEFAULT_SYNC_OPTIONS.maxMessages,
      newMailOnly: true,
      includeInbox: quickSourceOption('quickSyncIncludeInbox', persistedOptions.includeInbox),
      includeSent: quickSourceOption('quickSyncIncludeSent', persistedOptions.includeSent),
      includeTrash: quickSourceOption('quickSyncIncludeTrash', persistedOptions.includeTrash),
      includeSpam: quickSourceOption('quickSyncIncludeSpam', persistedOptions.includeSpam),
      includeArchived: quickSourceOption('quickSyncIncludeArchived', persistedOptions.includeArchived),
    })
    if (result.status === 'connected') synced++
    else failed++
  }

  return { synced, failed }
}
