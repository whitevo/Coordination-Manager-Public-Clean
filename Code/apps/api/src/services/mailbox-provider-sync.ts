import { supabaseAdmin } from '../supabaseClient.js'
import { refreshMailboxOAuthAccessToken, type MailboxOAuthProvider } from './mailbox-oauth.js'
import { getMailboxCredential, upsertMailboxCredential } from './mailbox-credentials.js'
import sanitizeHtml from 'sanitize-html'
import { sanitizeUUID } from '../middleware/validation.js'

interface MailAccountProviderSyncInput {
  accountId: string
  userId: string
  provider: MailboxOAuthProvider
  options?: Partial<MailboxProviderSyncOptions>
}

export interface MailboxProviderSyncOptions {
  maxMessages: number
  daysBack: number
  includeInbox: boolean
  includeSent: boolean
  includeTrash: boolean
  includeSpam: boolean
  includeArchived: boolean
  newMailOnly: boolean
  quickSyncAfter?: string | null
}

interface ProviderMessageProjection {
  providerMessageId: string
  providerThreadId: string | null
  /** RFC 5322 Message-ID header, used to build In-Reply-To/References on later replies. */
  rfcMessageId: string | null
  providerSent: boolean
  providerTrashed: boolean
  providerJunk: boolean
  providerArchived: boolean
  subject: string | null
  fromEmail: string | null
  fromName: string | null
  toEmails: string | null
  ccEmails: string | null
  bccEmails: string | null
  preview: string | null
  receivedAt: string | null
  bodyText: string | null
  bodyHtmlSanitized: string | null
  // Raw VCALENDAR/ICS text found alongside the message (never rendered to the user).
  calendarRawText: string | null
  isRead: boolean
  hasAttachments: boolean
  raw: Record<string, unknown>
}

interface ProviderSyncSummary {
  inserted: number
  updated: number
  insertedProviderMessageIds: string[]
  junkedProviderMessageIds: string[]
  cursor: string | null
  newestMessageReceivedAt: string | null
  /** Present only for quick syncs that run against a quick_sync_after watermark. */
  quickSync?: QuickSyncProgress
}

/**
 * Outcome of a bounded quick-sync window walk.
 * - advanceTo: the point quick_sync_after may advance to (everything newer is known to be
 *   fetched), or null while a gap is still open. Never in the future.
 * - gapState: serialized QuickSyncGapState to persist (null = no open gap).
 * - persistGapState: false when there was no stored state and no new gap (skip the write).
 */
export interface QuickSyncProgress {
  advanceTo: string | null
  gapState: string | null
  persistGapState: boolean
}

/** mail_sync_cursors.resource_type for the quick-sync gap state (separate from the full-sync 'messages' cursor). */
export const QUICK_SYNC_GAP_RESOURCE_TYPE = 'messages_quick_gap'
// Provider indexing can lag or reorder, so windows re-request a small overlap; dedupe stays local.
const QUICK_SYNC_OVERLAP_MS = 5 * 60 * 1000
// Per-run bounds (each page is one provider list call plus detail fetches for unknown ids only).
const QUICK_SYNC_MAX_TOP_PAGES_PER_STREAM = 3
const QUICK_SYNC_MAX_GAP_PAGES_PER_RUN = 5
const QUICK_SYNC_MAX_GAP_SEGMENTS = 8
// Stop starting new pages after this long so the whole run stays well inside the 120s sync timeout.
const QUICK_SYNC_TIME_BUDGET_MS = 45_000
const QUICK_SYNC_MAX_TOKEN_LENGTH = 4096

/**
 * One unfinished newest-first walk over a stream (Gmail: one stream; Outlook: one per folder),
 * listing messages received after `afterMs`. `token` resumes the walk (null = restart from the
 * first page of that window; always safe because dedupe is local).
 */
interface QuickSyncGapSegment {
  stream: string
  afterMs: number
  token: string | null
}

/**
 * Open quick-sync gap. While it exists quick_sync_after (the floor) is NOT advanced.
 * Everything newer than `upper` is fetched; the segments cover what may still be missing
 * between the floor and `upper`. When every segment finishes, the watermark advances.
 */
interface QuickSyncGapState {
  v: 1
  provider: MailboxOAuthProvider
  floor: string
  upper: string
  segments: QuickSyncGapSegment[]
}

interface QuickSyncPage {
  messages: ProviderMessageProjection[]
  nextToken: string | null
  /** True once the newest-first listing has reached the window's lower bound. */
  reachedWindowEnd: boolean
}

function parseIsoMs(value: unknown): number {
  return typeof value === 'string' ? new Date(value).getTime() : NaN
}

function sanitizeQuickSyncToken(provider: MailboxOAuthProvider, token: unknown): string | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > QUICK_SYNC_MAX_TOKEN_LENGTH) return null
  // Outlook tokens are full nextLink URLs fetched with the user's bearer token: only ever follow Graph URLs.
  if (provider === 'outlook' && !token.startsWith(`${OUTLOOK_GRAPH_BASE}/`)) return null
  return token
}

/** Parse and validate a stored gap state; anything unusable is treated as "no gap". */
function parseQuickSyncGapState(
  raw: string | null,
  provider: MailboxOAuthProvider,
  streams: string[],
): QuickSyncGapState | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  if (record.v !== 1 || record.provider !== provider) return null
  if (!Number.isFinite(parseIsoMs(record.floor)) || !Number.isFinite(parseIsoMs(record.upper))) return null
  if (!Array.isArray(record.segments)) return null

  const allowedStreams = new Set(streams)
  const segments: QuickSyncGapSegment[] = []
  for (const entry of record.segments as unknown[]) {
    if (!entry || typeof entry !== 'object') continue
    const segment = entry as Record<string, unknown>
    // A stream (folder) the user no longer quick-syncs is dropped with its gap.
    if (typeof segment.stream !== 'string' || !allowedStreams.has(segment.stream)) continue
    if (typeof segment.afterMs !== 'number' || !Number.isFinite(segment.afterMs)) continue
    segments.push({ stream: segment.stream, afterMs: segment.afterMs, token: sanitizeQuickSyncToken(provider, segment.token) })
  }

  return { v: 1, provider, floor: record.floor as string, upper: record.upper as string, segments }
}

/**
 * Bounded quick-sync walk that never skips new mail under a burst.
 *
 * 1. Top walk per stream over (upper - overlap, now]: page newest-first until the listing
 *    reaches the window bound, up to QUICK_SYNC_MAX_TOP_PAGES_PER_STREAM pages. A stream that
 *    hits the cap (or the time budget) leaves a gap segment that resumes from its page token.
 * 2. Continue stored gap segments with the remaining per-run gap page budget.
 * 3. Only when no segment is left does the watermark advance (to the newest fetched time,
 *    clamped to now). Otherwise the floor is kept and the gap state is persisted, so successive
 *    runs converge once the burst subsides.
 */
async function runQuickSyncWalk(params: {
  provider: MailboxOAuthProvider
  streams: string[]
  watermarkMs: number
  state: QuickSyncGapState | null
  nowMs: number
  fetchPage: (stream: string, afterMs: number, token: string | null) => Promise<QuickSyncPage>
}): Promise<{ messages: ProviderMessageProjection[]; progress: QuickSyncProgress }> {
  const { provider, streams, watermarkMs, state, nowMs, fetchPage } = params
  const deadlineMs = Date.now() + QUICK_SYNC_TIME_BUDGET_MS
  const collected = new Map<string, ProviderMessageProjection>()
  const collect = (messages: ProviderMessageProjection[]) => {
    for (const message of messages) {
      if (!collected.has(message.providerMessageId)) collected.set(message.providerMessageId, message)
    }
  }

  const storedUpperMs = state ? parseIsoMs(state.upper) : NaN
  const upperMs = Math.min(nowMs, Number.isFinite(storedUpperMs) ? Math.max(storedUpperMs, watermarkMs) : watermarkMs)
  const topAfterMs = Math.max(0, upperMs - QUICK_SYNC_OVERLAP_MS)

  const newSegments: QuickSyncGapSegment[] = []
  for (const stream of streams) {
    let token: string | null = null
    let pages = 0
    for (;;) {
      if (pages >= QUICK_SYNC_MAX_TOP_PAGES_PER_STREAM || Date.now() >= deadlineMs) {
        newSegments.push({ stream, afterMs: topAfterMs, token })
        break
      }
      const page = await fetchPage(stream, topAfterMs, token)
      pages++
      collect(page.messages)
      if (page.reachedWindowEnd || !page.nextToken) break
      token = page.nextToken
    }
  }

  const pendingSegments: QuickSyncGapSegment[] = []
  let gapPages = 0
  for (const segment of state?.segments ?? []) {
    let current: QuickSyncGapSegment | null = { ...segment }
    while (current && gapPages < QUICK_SYNC_MAX_GAP_PAGES_PER_RUN && Date.now() < deadlineMs) {
      const page = await fetchPage(current.stream, current.afterMs, current.token)
      gapPages++
      collect(page.messages)
      current = page.reachedWindowEnd || !page.nextToken ? null : { ...current, token: page.nextToken }
    }
    if (current) pendingSegments.push(current)
  }

  // Newest fetched receivedAt, clamped so a bogus future-dated message cannot push the
  // watermark past now (which would make every later quick sync skip real new mail).
  let newestMs = -Infinity
  for (const message of collected.values()) {
    const receivedMs = parseIsoMs(message.receivedAt)
    if (Number.isFinite(receivedMs) && receivedMs > newestMs) newestMs = receivedMs
  }
  const nextUpperMs = Math.min(nowMs, Math.max(upperMs, newestMs))

  // Newer gaps first so the freshest missing mail is filled first on the next run.
  let segments = [...newSegments, ...pendingSegments]
  const floorIso = state?.floor ?? new Date(watermarkMs).toISOString()
  if (segments.length > QUICK_SYNC_MAX_GAP_SEGMENTS) {
    // Too fragmented: collapse to one restart per stream over the whole open window.
    const floorMs = Math.min(nowMs, parseIsoMs(floorIso))
    const restartStreams = Array.from(new Set(segments.map((segment) => segment.stream)))
    segments = restartStreams.map((stream) => ({ stream, afterMs: Math.max(0, floorMs - QUICK_SYNC_OVERLAP_MS), token: null }))
  }

  if (segments.length === 0) {
    return {
      messages: Array.from(collected.values()),
      progress: { advanceTo: new Date(nextUpperMs).toISOString(), gapState: null, persistGapState: state !== null },
    }
  }

  const nextState: QuickSyncGapState = {
    v: 1,
    provider,
    floor: floorIso,
    upper: new Date(nextUpperMs).toISOString(),
    segments,
  }
  return {
    messages: Array.from(collected.values()),
    progress: { advanceTo: null, gapState: JSON.stringify(nextState), persistGapState: true },
  }
}

interface MailTagActionEventRow {
  message_id: string
  action: string
  action_value: string | null
}

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1'
const OUTLOOK_GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const EMAIL_ADDRESS_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

// Keyed by accountId; see syncMailboxProviderDelta's refreshCredentials for why this exists.
const inFlightMailboxCredentialRefreshes = new Map<string, Promise<unknown>>()

type OutlookMailboxFolderKind = 'inbox' | 'sent' | 'trash' | 'junk' | 'archive'

interface OutlookMailboxFolderTarget {
  kind: OutlookMailboxFolderKind
  folderId: string
}

export const DEFAULT_SYNC_OPTIONS: MailboxProviderSyncOptions = {
  maxMessages: 40,
  daysBack: 1,
  includeInbox: true,
  includeSent: true,
  includeTrash: true,
  includeSpam: true,
  includeArchived: true,
  newMailOnly: false,
}

function normalizeSyncOptions(options?: Partial<MailboxProviderSyncOptions>): MailboxProviderSyncOptions {
  const rawMaxMessages = Number(options?.maxMessages)
  const rawDaysBack = Number(options?.daysBack)

  const maxMessages = Number.isFinite(rawMaxMessages)
    ? Math.min(500, Math.max(25, Math.floor(rawMaxMessages)))
    : DEFAULT_SYNC_OPTIONS.maxMessages

  const daysBack = Number.isFinite(rawDaysBack)
    ? Math.min(365, Math.max(1, Math.floor(rawDaysBack)))
    : DEFAULT_SYNC_OPTIONS.daysBack

  return {
    maxMessages,
    daysBack,
    includeInbox: options?.includeInbox ?? DEFAULT_SYNC_OPTIONS.includeInbox,
    includeSent: options?.includeSent ?? DEFAULT_SYNC_OPTIONS.includeSent,
    includeTrash: options?.includeTrash ?? DEFAULT_SYNC_OPTIONS.includeTrash,
    includeSpam: options?.includeSpam ?? DEFAULT_SYNC_OPTIONS.includeSpam,
    includeArchived: options?.includeArchived ?? DEFAULT_SYNC_OPTIONS.includeArchived,
    newMailOnly: options?.newMailOnly ?? DEFAULT_SYNC_OPTIONS.newMailOnly,
    quickSyncAfter: typeof options?.quickSyncAfter === 'string' ? options.quickSyncAfter : null,
  }
}

function extractProviderErrorDetail(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null

  const directError = (payload as Record<string, unknown>).error
  if (typeof directError === 'string' && directError.trim()) {
    return directError.trim()
  }

  if (directError && typeof directError === 'object') {
    const errorObj = directError as Record<string, unknown>
    if (typeof errorObj.message === 'string' && errorObj.message.trim()) {
      return errorObj.message.trim()
    }
  }

  if (typeof (payload as Record<string, unknown>).message === 'string') {
    const msg = ((payload as Record<string, unknown>).message as string).trim()
    return msg || null
  }

  return null
}

function isCursorRejectedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return /page\s*token|invalid\s*cursor|skip\s*token|syncstate/i.test(err.message)
}

function isUnauthorizedProviderError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return /\b401\b|invalid authentication credentials|invalid_grant|expired/i.test(err.message)
}

function selectContinuationCursor(
  storedCursor: string | null,
  lastError: string | null,
  newMailOnly: boolean,
): string | null {
  if (newMailOnly || !storedCursor) return null
  return lastError && isCursorRejectedError(new Error(lastError)) ? null : storedCursor
}

function isCredentialExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false
  const expiresAtMs = new Date(expiresAt).getTime()
  if (Number.isNaN(expiresAtMs)) return false
  // Wide skew: a full sync pass can run for minutes, and a token that expires mid-pass surfaces as
  // a 401 that gets classified as a revoked grant.
  return expiresAtMs <= (Date.now() + 5 * 60_000)
}

function decodeBase64UrlToUtf8(value: string): string {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return Buffer.from(padded, 'base64').toString('utf-8')
  } catch {
    return ''
  }
}

function parseEmailsFromHeader(value: string | null): string[] {
  if (!value) return []

  const matches = value.match(EMAIL_ADDRESS_RE) || []
  const seen = new Set<string>()
  const emails: string[] = []

  for (const match of matches) {
    const normalized = match.trim().toLowerCase()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    emails.push(normalized)
  }

  return emails
}

function parseDisplayNameFromHeader(value: string | null): string | null {
  if (!value) return null

  const withoutAddress = value
    .replace(/<[^>]+>/g, ' ')
    .replace(/"/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return withoutAddress || null
}

function joinRecipientEmails(emails: string[]): string | null {
  if (emails.length === 0) return null
  return emails.join(', ')
}

function splitJoinedEmails(value: string | null): string[] {
  if (!value) return []
  return value.split(',').map(part => part.trim().toLowerCase()).filter(Boolean)
}

/** Loads this user's junk sender/domain entries (mail_user_preferences.junk_domains) as a lowercase set. */
export async function fetchJunkEntrySet(userId: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from('mail_user_preferences')
    .select('junk_domains')
    .eq('user_id', userId)
    .maybeSingle()

  const raw = Array.isArray(data?.junk_domains) ? (data!.junk_domains as unknown[]) : []
  return new Set(
    raw.filter((value): value is string => typeof value === 'string').map(value => value.trim().toLowerCase()),
  )
}

/** An address is junk if it (or its domain) is in the user's junk sender/domain list. */
export function isJunkEmail(email: string, junkEntries: Set<string>): boolean {
  if (junkEntries.size === 0) return false
  if (junkEntries.has(email)) return true
  const domain = email.includes('@') ? email.slice(email.lastIndexOf('@') + 1) : email
  return junkEntries.has(domain)
}

/** Loads this user's own connected mailbox addresses, so cross-account mail never turns into a self-contact. */
async function fetchOwnAccountAddresses(userId: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from('mail_accounts')
    .select('address')
    .eq('user_id', userId)

  return new Set((data || []).map(row => row.address.trim().toLowerCase()))
}

/**
 * Derives Contacts from synced messages. Any address the account has sent to or
 * received from qualifies -- one-way correspondence is enough -- so long as it is
 * not on the user's junk sender/domain list, which keeps out newsletters and
 * no-reply senders the user has already flagged. Sent and received traffic are
 * tallied separately so downstream suggestions can reason about "you email this
 * person often" vs "they mostly email you".
 */
async function upsertMailboxContactsFromMessages(
  userId: string,
  messages: ProviderMessageProjection[],
): Promise<void> {
  if (messages.length === 0) return

  interface CorrespondentTally {
    name: string | null
    sentCount: number
    receivedCount: number
    lastSentAt: string | null
    lastReceivedAt: string | null
  }

  const correspondents = new Map<string, CorrespondentTally>()
  const touch = (rawEmail: string, name: string | null, at: string | null, direction: 'sent' | 'received') => {
    const email = rawEmail.trim().toLowerCase()
    if (!email) return
    const existing = correspondents.get(email) || {
      name: null,
      sentCount: 0,
      receivedCount: 0,
      lastSentAt: null,
      lastReceivedAt: null,
    }
    if (!existing.name && name) existing.name = name
    if (direction === 'sent') {
      existing.sentCount += 1
      if (!existing.lastSentAt || (at ?? '') > existing.lastSentAt) existing.lastSentAt = at
    } else {
      existing.receivedCount += 1
      if (!existing.lastReceivedAt || (at ?? '') > existing.lastReceivedAt) existing.lastReceivedAt = at
    }
    correspondents.set(email, existing)
  }

  for (const message of messages) {
    if (message.providerSent) {
      for (const email of splitJoinedEmails(message.toEmails)) touch(email, null, message.receivedAt, 'sent')
      for (const email of splitJoinedEmails(message.ccEmails)) touch(email, null, message.receivedAt, 'sent')
    } else if (message.fromEmail) {
      touch(message.fromEmail, message.fromName, message.receivedAt, 'received')
    }
  }

  if (correspondents.size === 0) return

  const [junkEntries, ownAddresses] = await Promise.all([
    fetchJunkEntrySet(userId),
    fetchOwnAccountAddresses(userId),
  ])
  const candidateEmails = Array.from(correspondents.keys())
    .filter(email => !isJunkEmail(email, junkEntries) && !ownAddresses.has(email))
  if (candidateEmails.length === 0) return

  const { data: existingIdentities } = await supabaseAdmin
    .from('mail_contact_identities')
    .select('id, contact_id, email, mail_contacts!inner(user_id)')
    .eq('mail_contacts.user_id', userId)
    .in('email', candidateEmails)

  const existingByEmail = new Map((existingIdentities || []).map(row => [row.email.toLowerCase(), row]))
  const nowIso = new Date().toISOString()

  for (const email of candidateEmails) {
    const info = correspondents.get(email)!
    const latestAt = [info.lastSentAt, info.lastReceivedAt].filter(Boolean).sort().reverse()[0] || nowIso
    const existingIdentity = existingByEmail.get(email)

    if (existingIdentity) {
      const { data: contact } = await supabaseAdmin
        .from('mail_contacts')
        .select('interaction_count, sent_count, received_count, last_sent_at, last_received_at')
        .eq('id', existingIdentity.contact_id)
        .maybeSingle()

      await supabaseAdmin
        .from('mail_contacts')
        .update({
          last_interaction_at: latestAt,
          interaction_count: (contact?.interaction_count || 0) + info.sentCount + info.receivedCount,
          sent_count: (contact?.sent_count || 0) + info.sentCount,
          received_count: (contact?.received_count || 0) + info.receivedCount,
          last_sent_at: info.lastSentAt && info.lastSentAt > (contact?.last_sent_at || '') ? info.lastSentAt : contact?.last_sent_at,
          last_received_at: info.lastReceivedAt && info.lastReceivedAt > (contact?.last_received_at || '') ? info.lastReceivedAt : contact?.last_received_at,
          updated_at: nowIso,
        })
        .eq('id', existingIdentity.contact_id)
      continue
    }

    if (info.name) {
      const { data: namedContacts } = await supabaseAdmin
        .from('mail_contacts')
        .select('id, interaction_count, sent_count, received_count, last_sent_at, last_received_at')
        .eq('user_id', userId)
        .eq('display_name', info.name)
        .limit(2)

      if (namedContacts?.length === 1) {
        const contact = namedContacts[0]
        await supabaseAdmin
          .from('mail_contact_identities')
          .insert({
            contact_id: contact.id,
            email,
            provider_source: 'mailbox_sync',
            is_primary: false,
          })
        await supabaseAdmin
          .from('mail_contacts')
          .update({
            last_interaction_at: latestAt,
            interaction_count: (contact.interaction_count || 0) + info.sentCount + info.receivedCount,
            sent_count: (contact.sent_count || 0) + info.sentCount,
            received_count: (contact.received_count || 0) + info.receivedCount,
            last_sent_at: info.lastSentAt && info.lastSentAt > (contact.last_sent_at || '') ? info.lastSentAt : contact.last_sent_at,
            last_received_at: info.lastReceivedAt && info.lastReceivedAt > (contact.last_received_at || '') ? info.lastReceivedAt : contact.last_received_at,
            updated_at: nowIso,
          })
          .eq('id', contact.id)
        continue
      }
    }

    const { data: newContact, error: contactError } = await supabaseAdmin
      .from('mail_contacts')
      .insert({
        user_id: userId,
        display_name: info.name || email,
        last_interaction_at: latestAt,
        interaction_count: info.sentCount + info.receivedCount,
        sent_count: info.sentCount,
        received_count: info.receivedCount,
        last_sent_at: info.lastSentAt,
        last_received_at: info.lastReceivedAt,
        source_summary: { origin: 'mailbox_sync' },
      })
      .select('id')
      .single()

    if (contactError || !newContact) {
      console.warn('[Contacts] Failed to create contact for', email, contactError)
      continue
    }

    // The contact row was just created, so this identity cannot already exist.
    await supabaseAdmin
      .from('mail_contact_identities')
      .insert({
        contact_id: newContact.id,
        email,
        provider_source: 'mailbox_sync',
        is_primary: true,
      })
  }
}


function buildOutlookFolderTargets(options: MailboxProviderSyncOptions): OutlookMailboxFolderTarget[] {
  const targets: OutlookMailboxFolderTarget[] = []
  if (options.includeInbox) targets.push({ kind: 'inbox', folderId: 'inbox' })
  if (options.includeSent) targets.push({ kind: 'sent', folderId: 'sentitems' })
  if (options.includeTrash) targets.push({ kind: 'trash', folderId: 'deleteditems' })
  if (options.includeSpam) targets.push({ kind: 'junk', folderId: 'junkemail' })
  if (options.includeArchived) targets.push({ kind: 'archive', folderId: 'archive' })
  return targets.length > 0 ? targets : [{ kind: 'inbox', folderId: 'inbox' }]
}

function buildOutlookFolderMessagesUrl(
  folderId: string,
  limit: number,
): string {
  const params = new URLSearchParams({
    $top: String(limit),
    $select: 'id,conversationId,internetMessageId,subject,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,sentDateTime,bodyPreview,body,isRead,hasAttachments',
    $orderby: 'receivedDateTime desc',
  })

  return `${OUTLOOK_GRAPH_BASE}/me/mailFolders/${encodeURIComponent(folderId)}/messages?${params.toString()}`
}

function inferOutlookFolderKindFromUrl(value: string): OutlookMailboxFolderKind {
  const normalized = value.toLowerCase()
  if (normalized.includes('sentitems')) return 'sent'
  if (normalized.includes('deleteditems')) return 'trash'
  if (normalized.includes('junkemail')) return 'junk'
  if (normalized.includes('archive')) return 'archive'
  return 'inbox'
}

export function isMailboxTimestampWithinDaysBack(receivedAt: string | null, daysBack: number, nowMs = Date.now()): boolean {
  if (!receivedAt) return true
  const receivedAtMs = new Date(receivedAt).getTime()
  if (!Number.isFinite(receivedAtMs)) return true
  const cutoffMs = nowMs - (daysBack * 24 * 60 * 60 * 1000)
  return receivedAtMs >= cutoffMs
}

function applyDaysBackCap(
  messages: ProviderMessageProjection[],
  daysBack: number,
  nowMs = Date.now(),
): { messages: ProviderMessageProjection[]; removed: number } {
  const filtered = messages.filter((message) => isMailboxTimestampWithinDaysBack(message.receivedAt, daysBack, nowMs))
  return { messages: filtered, removed: messages.length - filtered.length }
}

function extractOutlookRecipientEmails(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const emails: string[] = []

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const emailAddress = (entry as Record<string, unknown>).emailAddress
    if (!emailAddress || typeof emailAddress !== 'object') continue
    const rawAddress = (emailAddress as Record<string, unknown>).address
    if (typeof rawAddress !== 'string') continue

    const normalized = rawAddress.trim().toLowerCase()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    emails.push(normalized)
  }

  return emails
}

function stripHtmlToText(html: string): string {
  // Fixpoint strip so nested/overlapping style and script blocks cannot
  // survive a single pass; end-tag match tolerates whitespace (</script >).
  let text = html
  for (;;) {
    const next = text
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    if (next === text) break
    text = next
  }
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    // Decode &amp; last so sequences like &amp;lt; become &lt; (text), not <.
    .replace(/&amp;/gi, '&')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      'html',
      'head',
      'body',
      'img',
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'td',
      'th',
      'colgroup',
      'col',
      'caption',
      'section',
      'article',
      'header',
      'footer',
      'main',
      'span',
      'font',
      'center',
      // Kept: rendered only inside a sandboxed iframe (no scripts, no allow-same-origin),
      // so plain CSS in <style> can't execute or read host cookies/storage.
      'style',
    ],
    allowedAttributes: {
      '*': [
        'style',
        'class',
        'id',
        'align',
        'valign',
        'width',
        'height',
        'bgcolor',
        'cellpadding',
        'cellspacing',
        'border',
        'role',
      ],
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'srcset', 'alt', 'title', 'width', 'height'],
      meta: ['charset', 'http-equiv', 'content'],
      style: ['type', 'media'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel', 'data'],
    allowedSchemesByTag: {
      img: ['http', 'https', 'data', 'cid'],
    },
    allowProtocolRelative: false,
    parseStyleAttributes: true,
    // sanitize-html warns 'style' is a "vulnerable" tag; safe here due to iframe sandboxing above.
    allowVulnerableTags: true,
    transformTags: {
      a: (tagName, attribs) => {
        const nextAttribs = { ...attribs }
        if (nextAttribs.href) {
          nextAttribs.target = '_blank'
          nextAttribs.rel = 'noopener noreferrer nofollow'
        }
        return { tagName, attribs: nextAttribs }
      },
    },
    nonTextTags: ['script', 'textarea', 'option'],
  }).trim()
}

interface ExtractedGmailBodies {
  textParts: string[]
  htmlParts: string[]
  calendarParts: string[]
  hasPlainText: boolean
}

function extractGmailBodiesFromPart(part: Record<string, unknown>): ExtractedGmailBodies {
  const mimeType = typeof part.mimeType === 'string' ? part.mimeType.toLowerCase() : ''
  const body = (part.body && typeof part.body === 'object') ? part.body as Record<string, unknown> : null
  const rawData = body && typeof body.data === 'string' ? body.data : null

  let localText = ''
  let localHtml = ''
  let localCalendar = ''
  if (rawData) {
    const decoded = decodeBase64UrlToUtf8(rawData)
    if (decoded) {
      if (mimeType.includes('text/html')) {
        localHtml = decoded
        localText = stripHtmlToText(decoded)
      } else if (mimeType.includes('text/plain')) {
        localText = decoded
      } else if (mimeType.includes('text/calendar') || mimeType.includes('application/ics')) {
        localCalendar = decoded
      }
    }
  }

  const childParts = Array.isArray(part.parts)
    ? part.parts.filter((child): child is Record<string, unknown> => typeof child === 'object' && child !== null)
    : []

  const textParts = localText ? [localText] : []
  const htmlParts = localHtml ? [localHtml] : []
  const calendarParts = localCalendar ? [localCalendar] : []

  const extractedChildren = childParts.map(extractGmailBodiesFromPart)
  const hasPlainText = (mimeType.includes('text/plain') && Boolean(localText.trim()))
    || extractedChildren.some(child => child.hasPlainText)

  if (mimeType === 'multipart/alternative') {
    // Alternatives describe the same content; never append the HTML fallback to plain text.
    const textAlternative = extractedChildren.find(child => child.hasPlainText)
      ?? [...extractedChildren].reverse().find(child => child.textParts.some(text => text.trim()))
    const htmlAlternative = [...extractedChildren].reverse().find(child => child.htmlParts.length > 0)
    return {
      textParts: textAlternative?.textParts ?? [],
      htmlParts: htmlAlternative?.htmlParts ?? [],
      calendarParts: extractedChildren.flatMap(child => child.calendarParts),
      hasPlainText,
    }
  }

  for (const childExtracted of extractedChildren) {
    textParts.push(...childExtracted.textParts)
    htmlParts.push(...childExtracted.htmlParts)
    calendarParts.push(...childExtracted.calendarParts)
  }

  return { textParts, htmlParts, calendarParts, hasPlainText }
}

/** Reads a header value (case-insensitive) off a Gmail message part. */
function getGmailPartHeader(part: Record<string, unknown>, name: string): string | null {
  const headers = Array.isArray(part.headers) ? part.headers as Array<Record<string, unknown>> : []
  const match = headers.find(h =>
    typeof h.name === 'string' && h.name.toLowerCase() === name.toLowerCase() && typeof h.value === 'string'
  )
  return match && typeof match.value === 'string' ? match.value.trim() : null
}

function normalizeContentId(value: string): string {
  return value.trim().replace(/^</, '').replace(/>$/, '').toLowerCase()
}

interface GmailInlineImagePart {
  mimeType: string
  data: string | null
  attachmentId: string | null
}

/** Walks the payload tree collecting inline image parts keyed by their Content-Id header. */
function collectGmailInlineImagesByContentId(part: Record<string, unknown>, out: Map<string, GmailInlineImagePart>): void {
  const mimeType = typeof part.mimeType === 'string' ? part.mimeType.toLowerCase() : ''
  const contentId = getGmailPartHeader(part, 'Content-Id')

  if (contentId && mimeType.startsWith('image/')) {
    const body = (part.body && typeof part.body === 'object') ? part.body as Record<string, unknown> : null
    out.set(normalizeContentId(contentId), {
      mimeType,
      data: body && typeof body.data === 'string' ? body.data : null,
      attachmentId: body && typeof body.attachmentId === 'string' ? body.attachmentId : null,
    })
  }

  const childParts = Array.isArray(part.parts)
    ? part.parts.filter((child): child is Record<string, unknown> => typeof child === 'object' && child !== null)
    : []
  for (const child of childParts) collectGmailInlineImagesByContentId(child, out)
}

/**
 * Rewrites `src="cid:..."` references in HTML to inline data: URIs so the sandboxed
 * iframe can actually render them (a bare `cid:` URI is not a browser-fetchable
 * scheme -- it only means anything inside the original MIME container). Small
 * inline images are already present as base64 in the payload (no extra call);
 * larger ones require one attachments.get call per unique image, bounded to the
 * images actually referenced in this message. Unresolvable references are
 * stripped so the UI shows nothing instead of a broken-image icon.
 */
async function resolveGmailCidImages(
  html: string,
  payload: Record<string, unknown>,
  accessToken: string,
  gmailMessageId: string,
): Promise<string> {
  if (!html.includes('cid:')) return html

  const cidPattern = /cid:([^"'\s)>]+)/gi
  const referencedCids = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = cidPattern.exec(html)) !== null) {
    referencedCids.add(normalizeContentId(match[1]))
  }
  if (referencedCids.size === 0) return html

  const inlineImagesByContentId = new Map<string, GmailInlineImagePart>()
  collectGmailInlineImagesByContentId(payload, inlineImagesByContentId)

  const dataUriByCid = new Map<string, string>()
  const fetchTargets: Array<{ cid: string; part: GmailInlineImagePart }> = []

  for (const cid of referencedCids) {
    const part = inlineImagesByContentId.get(cid)
    if (!part) continue
    if (part.data) {
      const normalizedBase64 = part.data.replace(/-/g, '+').replace(/_/g, '/')
      dataUriByCid.set(cid, `data:${part.mimeType};base64,${normalizedBase64}`)
    } else if (part.attachmentId) {
      fetchTargets.push({ cid, part })
    }
  }

  const FETCH_CONCURRENCY = 5
  for (let i = 0; i < fetchTargets.length; i += FETCH_CONCURRENCY) {
    const batch = fetchTargets.slice(i, i + FETCH_CONCURRENCY)
    await Promise.all(batch.map(async ({ cid, part }) => {
      try {
        const response = await fetch(
          `${GMAIL_API_BASE}/users/me/messages/${encodeURIComponent(gmailMessageId)}/attachments/${encodeURIComponent(part.attachmentId!)}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        )
        if (!response.ok) return
        const body = await response.json() as { data?: string }
        if (typeof body.data !== 'string') return
        const normalizedBase64 = body.data.replace(/-/g, '+').replace(/_/g, '/')
        dataUriByCid.set(cid, `data:${part.mimeType};base64,${normalizedBase64}`)
      } catch (err) {
        console.warn('[Gmail-Fetch] Failed to resolve inline image', cid, err instanceof Error ? err.message : String(err))
      }
    }))
  }

  return html.replace(/(<img\b[^>]*\bsrc=["'])cid:([^"']+)(["'][^>]*>)/gi, (_fullMatch, prefix, rawCid, suffix) => {
    const resolved = dataUriByCid.get(normalizeContentId(rawCid))
    if (!resolved) return '' // unresolved inline image: drop the tag rather than show a broken icon
    return `${prefix}${resolved}${suffix}`
  })
}

async function extractGmailBodies(
  detailPayload: Record<string, unknown>,
  accessToken: string,
  gmailMessageId: string,
): Promise<{ bodyText: string | null; bodyHtmlSanitized: string | null; calendarRawText: string | null }> {
  const payload = (detailPayload.payload && typeof detailPayload.payload === 'object')
    ? detailPayload.payload as Record<string, unknown>
    : null

  if (!payload) return { bodyText: null, bodyHtmlSanitized: null, calendarRawText: null }

  const extracted = extractGmailBodiesFromPart(payload)
  const bodyText = extracted.textParts
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim()

  const combinedHtml = extracted.htmlParts
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n<hr/>\n')

  const resolvedHtml = combinedHtml
    ? await resolveGmailCidImages(combinedHtml, payload, accessToken, gmailMessageId)
    : combinedHtml

  const bodyHtmlSanitized = resolvedHtml
    ? sanitizeEmailHtml(resolvedHtml)
    : null

  const calendarRawText = extracted.calendarParts
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n')
    .trim()

  return {
    bodyText: bodyText || null,
    bodyHtmlSanitized: bodyHtmlSanitized || null,
    calendarRawText: calendarRawText || null,
  }
}

/** Mirrors collectGmailAttachmentParts (routes/mailbox.ts) but only needs a boolean. */
function payloadHasGmailAttachment(part: Record<string, unknown>): boolean {
  const filename = typeof part.filename === 'string' ? part.filename : ''
  const body = (part.body && typeof part.body === 'object') ? part.body as Record<string, unknown> : null
  if (filename && (typeof body?.attachmentId === 'string' || typeof body?.data === 'string')) return true

  const children = Array.isArray(part.parts)
    ? part.parts.filter((child): child is Record<string, unknown> => typeof child === 'object' && child !== null)
    : []
  return children.some(payloadHasGmailAttachment)
}

async function fetchGmailDelta(
  accessToken: string,
  accountId: string,
  cursor: string | null,
  options: MailboxProviderSyncOptions,
  // Quick-sync window walks pass an explicit lower bound so a page token is always continued
  // with exactly the query it was issued for.
  afterMsOverride?: number,
): Promise<{ messages: ProviderMessageProjection[]; cursor: string | null }> {
  const queryParams = new URLSearchParams({ maxResults: String(options.maxMessages) })

  const qParts: string[] = []

  const configuredLookbackMs = options.daysBack * 24 * 60 * 60 * 1000
  const watermarkMs = options.newMailOnly && options.quickSyncAfter
    ? new Date(options.quickSyncAfter).getTime()
    : NaN
  // Provider indexing can lag or reorder, so re-request a small overlap and dedupe locally.
  const afterMs = typeof afterMsOverride === 'number' && Number.isFinite(afterMsOverride)
    ? Math.max(0, afterMsOverride)
    : Number.isFinite(watermarkMs)
      ? Math.max(0, watermarkMs - QUICK_SYNC_OVERLAP_MS)
      : Date.now() - configuredLookbackMs
  const afterEpochSeconds = Math.floor(afterMs / 1000)
  qParts.push(`after:${afterEpochSeconds}`)

  // Gmail labelIds uses AND -- build OR query via 'q' instead
  const labelFilters: string[] = []
  if (options.includeInbox) labelFilters.push('in:inbox')
  if (options.includeSent) labelFilters.push('in:sent')
  if (options.includeTrash) labelFilters.push('in:trash')
  if (options.includeSpam) labelFilters.push('in:spam')
  if (options.includeArchived) labelFilters.push('(-in:inbox -in:sent -in:trash -in:spam -in:drafts)')
  if (labelFilters.length === 0) labelFilters.push('in:inbox')

  if (labelFilters.length === 1) {
    qParts.push(labelFilters[0])
  } else {
    qParts.push(`(${labelFilters.join(' OR ')})`)
  }

  if (qParts.length > 0) {
    queryParams.set('q', qParts.join(' '))
  }

  if (cursor) queryParams.set('pageToken', cursor)

  const listUrl = `${GMAIL_API_BASE}/users/me/messages?${queryParams.toString()}`
  const listResponse = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  const listPayload = await listResponse.json().catch(() => null)
  if (!listResponse.ok) {
    const detail = extractProviderErrorDetail(listPayload)
    const message = detail
      ? `Gmail message list request failed (${listResponse.status}): ${detail}`
      : `Gmail message list request failed (${listResponse.status})`
    console.error('[Gmail-Fetch] ERROR:', message)
    throw new Error(message)
  }

  const typedPayload = (listPayload && typeof listPayload === 'object')
    ? listPayload as Record<string, unknown>
    : {}

  const refs = Array.isArray(typedPayload.messages) ? typedPayload.messages as Array<Record<string, unknown>> : []
  const nextCursor = typeof typedPayload.nextPageToken === 'string' ? typedPayload.nextPageToken : null

  if (refs.length === 0) {
    return { messages: [], cursor: nextCursor }
  }

  // Fetch message details concurrently (max 10 concurrent) to avoid rate limits and timeouts
  const CONCURRENT_LIMIT = 10
  const projections: ProviderMessageProjection[] = []
  const listedMessageIds = refs
    .map(ref => typeof ref.id === 'string' ? ref.id : null)
    .filter((id): id is string => id !== null)

  const existingProviderMessageIds = options.newMailOnly
    ? await fetchExistingProviderMessageIds(accountId, listedMessageIds)
    : new Set<string>()

  const messageIds = listedMessageIds
    .filter((id) => !existingProviderMessageIds?.has(id))

  const fetchMessageDetail = async (messageId: string): Promise<ProviderMessageProjection | null> => {
    try {
      const detailResponse = await fetch(`${GMAIL_API_BASE}/users/me/messages/${encodeURIComponent(messageId)}?format=full`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const detailPayload = await detailResponse.json() as Record<string, unknown>
      if (!detailResponse.ok) {
        console.warn('[Gmail-Fetch] Failed to fetch message detail', messageId, 'status:', detailResponse.status)
        return null
      }

      const payload = (detailPayload.payload && typeof detailPayload.payload === 'object')
        ? detailPayload.payload as Record<string, unknown>
        : {}
      const headers = Array.isArray(payload.headers) ? payload.headers as Array<Record<string, unknown>> : []

      const getHeader = (name: string): string | null => {
        const match = headers.find(h =>
          typeof h.name === 'string' &&
          h.name.toLowerCase() === name.toLowerCase() &&
          typeof h.value === 'string'
        )
        return match && typeof match.value === 'string' ? match.value : null
      }

      const internalDate = typeof detailPayload.internalDate === 'string' ? Number(detailPayload.internalDate) : NaN
      const receivedAt = Number.isFinite(internalDate) ? new Date(internalDate).toISOString() : null
      const fromHeader = getHeader('From')
      const toHeader = getHeader('To')
      const ccHeader = getHeader('Cc')
      const bccHeader = getHeader('Bcc')
      const parsedFromEmail = parseEmailsFromHeader(fromHeader)[0] || null
      const parsedFromName = parseDisplayNameFromHeader(fromHeader)

      const { bodyText, bodyHtmlSanitized, calendarRawText } = await extractGmailBodies(detailPayload, accessToken, messageId)

      return {
        providerMessageId: messageId,
        providerThreadId: typeof detailPayload.threadId === 'string' ? detailPayload.threadId : null,
        rfcMessageId: getHeader('Message-ID') || getHeader('Message-Id'),
        providerSent: Array.isArray(detailPayload.labelIds) && (detailPayload.labelIds as unknown[]).includes('SENT'),
        providerTrashed: Array.isArray(detailPayload.labelIds) && (detailPayload.labelIds as unknown[]).includes('TRASH'),
        providerJunk: Array.isArray(detailPayload.labelIds) && (detailPayload.labelIds as unknown[]).includes('SPAM'),
        providerArchived: Array.isArray(detailPayload.labelIds)
          && !(detailPayload.labelIds as unknown[]).includes('INBOX')
          && !(detailPayload.labelIds as unknown[]).includes('SENT')
          && !(detailPayload.labelIds as unknown[]).includes('TRASH')
          && !(detailPayload.labelIds as unknown[]).includes('SPAM')
          && !(detailPayload.labelIds as unknown[]).includes('DRAFT'),
        subject: getHeader('Subject'),
        fromEmail: parsedFromEmail,
        fromName: parsedFromName && parsedFromName.toLowerCase() !== (parsedFromEmail || '').toLowerCase() ? parsedFromName : null,
        toEmails: joinRecipientEmails(parseEmailsFromHeader(toHeader)),
        ccEmails: joinRecipientEmails(parseEmailsFromHeader(ccHeader)),
        bccEmails: joinRecipientEmails(parseEmailsFromHeader(bccHeader)),
        preview: typeof detailPayload.snippet === 'string' ? detailPayload.snippet : null,
        receivedAt,
        bodyText,
        bodyHtmlSanitized,
        calendarRawText,
        isRead: !(Array.isArray(detailPayload.labelIds) && (detailPayload.labelIds as unknown[]).includes('UNREAD')),
        hasAttachments: payloadHasGmailAttachment(payload),
        raw: detailPayload,
      }
    } catch (err) {
      console.warn('[Gmail-Fetch] Error fetching message detail:', err instanceof Error ? err.message : String(err))
      return null
    }
  }

  // Process messages in batches to limit concurrency
  for (let i = 0; i < messageIds.length; i += CONCURRENT_LIMIT) {
    const batch = messageIds.slice(i, i + CONCURRENT_LIMIT)
    const batchResults = await Promise.all(batch.map(id => fetchMessageDetail(id)))
    projections.push(...batchResults.filter((p): p is ProviderMessageProjection => p !== null))
  }

  return { messages: projections, cursor: nextCursor }
}

async function fetchExistingProviderMessageIds(accountId: string, providerMessageIds: string[]): Promise<Set<string>> {
  if (providerMessageIds.length === 0) return new Set()

  const { data, error } = await supabaseAdmin
    .from('mail_messages')
    .select('provider_message_id')
    .eq('account_id', accountId)
    .in('provider_message_id', providerMessageIds)

  if (error) throw error

  return new Set(
    (data || [])
      .map((row: { provider_message_id?: unknown }) => row.provider_message_id)
      .filter((id): id is string => typeof id === 'string'),
  )
}

async function fetchOutlookDelta(
  accessToken: string,
  accountId: string,
  cursor: string | null,
  options: MailboxProviderSyncOptions,
): Promise<{ messages: ProviderMessageProjection[]; cursor: string | null; oldestListedMs: number | null }> {
  const folderTargets = buildOutlookFolderTargets(options)
  const targets = cursor ? [{ kind: inferOutlookFolderKindFromUrl(cursor), endpoint: cursor }] : folderTargets.map((target) => ({
    kind: target.kind,
    endpoint: buildOutlookFolderMessagesUrl(
      target.folderId,
      Math.max(1, Math.ceil(options.maxMessages / folderTargets.length)),
    ),
  }))

  const projections: ProviderMessageProjection[] = []
  const nextCursors: string[] = []
  // Oldest receivedDateTime listed (before local dedupe); quick-sync walks stop once a
  // newest-first page reaches below the watermark.
  let oldestListedMs: number | null = null

  for (const target of targets) {
    const response = await fetch(target.endpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const detail = extractProviderErrorDetail(payload)
      const message = detail
        ? `Microsoft Graph message list request failed (${response.status}): ${detail}`
        : `Microsoft Graph message list request failed (${response.status})`
      throw new Error(message)
    }

    const typedPayload = (payload && typeof payload === 'object')
      ? payload as Record<string, unknown>
      : {}

    let items = Array.isArray(typedPayload.value) ? typedPayload.value as Array<Record<string, unknown>> : []
    const nextCursor = typeof typedPayload['@odata.nextLink'] === 'string' ? typedPayload['@odata.nextLink'] as string : null
    if (nextCursor) nextCursors.push(nextCursor)

    for (const item of items) {
      const listedAt = typeof item.receivedDateTime === 'string' ? new Date(item.receivedDateTime).getTime() : NaN
      if (Number.isFinite(listedAt) && (oldestListedMs === null || listedAt < oldestListedMs)) oldestListedMs = listedAt
    }

    if (options.newMailOnly) {
      // Skip attachment resolution for already stored messages.
      const existingIds = await fetchExistingProviderMessageIds(
        accountId,
        items.flatMap(item => typeof item.id === 'string' ? [item.id] : []),
      )
      items = items.filter(item => typeof item.id === 'string' && !existingIds.has(item.id))
    }

    const buildProjection = async (item: Record<string, unknown>): Promise<ProviderMessageProjection | null> => {
      const fromRecord = (item.from && typeof item.from === 'object')
        ? item.from as Record<string, unknown>
        : null

      const fromEmailAddress = (fromRecord?.emailAddress && typeof fromRecord.emailAddress === 'object')
        ? fromRecord.emailAddress as Record<string, unknown>
        : null

      const fromEmail = (
        fromEmailAddress &&
        typeof fromEmailAddress.address === 'string'
      )
        ? fromEmailAddress.address
        : null

      const fromName = fromEmailAddress && typeof fromEmailAddress.name === 'string'
        ? fromEmailAddress.name
        : null

      const toEmails = extractOutlookRecipientEmails(item.toRecipients)
      const ccEmails = extractOutlookRecipientEmails(item.ccRecipients)
      const bccEmails = extractOutlookRecipientEmails(item.bccRecipients)

      const bodyRecord = (item.body && typeof item.body === 'object')
        ? item.body as Record<string, unknown>
        : null

      const rawBodyContent = bodyRecord && typeof bodyRecord.content === 'string'
        ? bodyRecord.content
        : null

      const contentType = bodyRecord && typeof bodyRecord.contentType === 'string'
        ? bodyRecord.contentType.toLowerCase()
        : ''

      const isHtmlBody = contentType === 'html'
      const providerMessageId = typeof item.id === 'string' ? item.id : ''
      const hasAttachments = item.hasAttachments === true

      let bodyHtmlSanitizedRaw = rawBodyContent && isHtmlBody ? rawBodyContent : null
      let calendarRawText: string | null = null

      // Only make the extra Graph call for messages that actually carry attachments
      // (inline images referenced via cid:, or a .ics calendar attachment).
      if (hasAttachments && providerMessageId) {
        const needsCidResolution = Boolean(bodyHtmlSanitizedRaw && bodyHtmlSanitizedRaw.includes('cid:'))
        try {
          const resolved = await resolveOutlookAttachments(accessToken, providerMessageId, bodyHtmlSanitizedRaw, needsCidResolution)
          if (resolved.html !== null) bodyHtmlSanitizedRaw = resolved.html
          calendarRawText = resolved.calendarRawText
        } catch (err) {
          console.warn('[Outlook-Fetch] Failed to resolve attachments for', providerMessageId, err instanceof Error ? err.message : String(err))
        }
      }

      return {
        providerMessageId,
        providerThreadId: typeof item.conversationId === 'string' ? item.conversationId : null,
        rfcMessageId: typeof item.internetMessageId === 'string' ? item.internetMessageId : null,
        providerSent: target.kind === 'sent',
        providerTrashed: target.kind === 'trash',
        providerJunk: target.kind === 'junk',
        providerArchived: target.kind === 'archive',
        subject: typeof item.subject === 'string' ? item.subject : null,
        fromEmail: typeof fromEmail === 'string' ? fromEmail : null,
        fromName,
        toEmails: joinRecipientEmails(toEmails),
        ccEmails: joinRecipientEmails(ccEmails),
        bccEmails: joinRecipientEmails(bccEmails),
        preview: typeof item.bodyPreview === 'string' ? item.bodyPreview : null,
        receivedAt: typeof item.receivedDateTime === 'string'
          ? item.receivedDateTime
          : typeof item.sentDateTime === 'string'
            ? item.sentDateTime
            : null,
        bodyText: rawBodyContent
          ? (isHtmlBody ? stripHtmlToText(rawBodyContent) : rawBodyContent)
          : (typeof item.bodyPreview === 'string' ? item.bodyPreview : null),
        bodyHtmlSanitized: bodyHtmlSanitizedRaw ? sanitizeEmailHtml(bodyHtmlSanitizedRaw) : null,
        calendarRawText,
        isRead: item.isRead === true,
        hasAttachments,
        raw: { ...item, provider_folder: target.kind },
      }
    }

    const OUTLOOK_CONCURRENCY = 8
    for (let i = 0; i < items.length; i += OUTLOOK_CONCURRENCY) {
      const batch = items.slice(i, i + OUTLOOK_CONCURRENCY)
      const batchResults = await Promise.all(batch.map(buildProjection))
      projections.push(...batchResults.filter((p): p is ProviderMessageProjection => p !== null && p.providerMessageId !== ''))
    }
  }

  return { messages: projections, cursor: nextCursors[0] || null, oldestListedMs }
}

interface OutlookAttachmentResolution {
  html: string | null
  calendarRawText: string | null
}

/**
 * Fetches this message's attachments once (only called for messages that have
 * attachments) to: (1) rewrite `cid:` inline-image references into data: URIs the
 * sandboxed iframe can actually render, and (2) capture any .ics/text-calendar
 * attachment's raw text for invitation parsing. Both needs share one Graph call.
 */
async function resolveOutlookAttachments(
  accessToken: string,
  providerMessageId: string,
  html: string | null,
  needsCidResolution: boolean,
): Promise<OutlookAttachmentResolution> {
  const params = new URLSearchParams({ $select: 'id,name,contentType,isInline,contentId,contentBytes' })
  const response = await fetch(
    `${OUTLOOK_GRAPH_BASE}/me/messages/${encodeURIComponent(providerMessageId)}/attachments?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } },
  )
  if (!response.ok) return { html: null, calendarRawText: null }

  const payload = await response.json().catch(() => null) as { value?: unknown } | null
  const attachmentItems = Array.isArray(payload?.value) ? payload!.value as Array<Record<string, unknown>> : []

  let resolvedHtml = html
  let calendarRawText: string | null = null

  if (needsCidResolution && html) {
    const dataUriByCid = new Map<string, string>()
    for (const item of attachmentItems) {
      const contentId = typeof item.contentId === 'string' ? item.contentId : null
      const contentBytes = typeof item.contentBytes === 'string' ? item.contentBytes : null
      const contentType = typeof item.contentType === 'string' ? item.contentType : 'application/octet-stream'
      if (!contentId || !contentBytes) continue
      dataUriByCid.set(normalizeContentId(contentId), `data:${contentType};base64,${contentBytes}`)
    }

    resolvedHtml = html.replace(/(<img\b[^>]*\bsrc=["'])cid:([^"']+)(["'][^>]*>)/gi, (_fullMatch, prefix, rawCid, suffix) => {
      const resolved = dataUriByCid.get(normalizeContentId(rawCid))
      if (!resolved) return '' // unresolved inline image: drop the tag rather than show a broken icon
      return `${prefix}${resolved}${suffix}`
    })
  }

  const calendarAttachment = attachmentItems.find((item) => {
    const contentType = typeof item.contentType === 'string' ? item.contentType.toLowerCase() : ''
    return contentType === 'text/calendar' || contentType === 'application/ics'
  })
  if (calendarAttachment && typeof calendarAttachment.contentBytes === 'string') {
    try {
      calendarRawText = Buffer.from(calendarAttachment.contentBytes, 'base64').toString('utf-8')
    } catch {
      calendarRawText = null
    }
  }

  return { html: resolvedHtml, calendarRawText }
}

/** Reads the app-owned mailbox tag ids stored alongside the provider payload. */
function readUserTagIds(providerMetadata: unknown): string[] {
  if (!providerMetadata || typeof providerMetadata !== 'object') return []
  const value = (providerMetadata as Record<string, unknown>).user_tag_ids
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function applyTagActionEventsToTagIds(initialTagIds: string[], events: MailTagActionEventRow[]): string[] {
  const nextTagIds = new Set(initialTagIds.filter((entry) => typeof entry === 'string'))

  for (const event of events) {
    const tagId = sanitizeUUID(event.action_value)
    if (!tagId) continue
    if (event.action === 'add_tag') nextTagIds.add(tagId)
    if (event.action === 'remove_tag') nextTagIds.delete(tagId)
  }

  return [...nextTagIds]
}

function setUserTagIdsInProviderMetadata(providerMetadata: unknown, tagIds: string[]): Record<string, unknown> {
  const nextMetadata = providerMetadata && typeof providerMetadata === 'object'
    ? { ...(providerMetadata as Record<string, unknown>) }
    : {}
  const sanitizedTagIds = tagIds.filter((tagId) => typeof tagId === 'string')

  if (sanitizedTagIds.length > 0) nextMetadata.user_tag_ids = sanitizedTagIds
  else delete nextMetadata.user_tag_ids

  return nextMetadata
}

async function reconcileSyncedUserTagIdsFromActionEvents(accountId: string, providerMessageIds: string[]): Promise<void> {
  if (providerMessageIds.length === 0) return

  const { data: messageRows, error: messageError } = await supabaseAdmin
    .from('mail_messages')
    .select('id, provider_metadata')
    .eq('account_id', accountId)
    .in('provider_message_id', providerMessageIds)

  if (messageError) throw messageError

  const messages = (messageRows || []) as Array<{ id: string; provider_metadata: unknown }>
  if (messages.length === 0) return

  const messageIds = messages.map((message) => message.id)
  const { data: eventRows, error: eventError } = await supabaseAdmin
    .from('mail_action_events')
    .select('message_id, action, action_value')
    .in('message_id', messageIds)
    .in('action', ['add_tag', 'remove_tag'])
    .order('created_at', { ascending: true })

  if (eventError) throw eventError

  const eventsByMessageId = new Map<string, MailTagActionEventRow[]>()
  for (const event of (eventRows || []) as MailTagActionEventRow[]) {
    eventsByMessageId.set(event.message_id, [...(eventsByMessageId.get(event.message_id) || []), event])
  }

  for (const message of messages) {
    const events = eventsByMessageId.get(message.id)
    if (!events || events.length === 0) continue

    const currentTagIds = readUserTagIds(message.provider_metadata)
    const reconciledTagIds = applyTagActionEventsToTagIds(currentTagIds, events)
    if (currentTagIds.length === reconciledTagIds.length && currentTagIds.every((tagId, index) => tagId === reconciledTagIds[index])) {
      continue
    }

    const nextMetadata = setUserTagIdsInProviderMetadata(message.provider_metadata, reconciledTagIds)
    const { error: updateError } = await supabaseAdmin
      .from('mail_messages')
      .update({ provider_metadata: nextMetadata, updated_at: new Date().toISOString() })
      .eq('id', message.id)

    if (updateError) throw updateError
  }
}

/**
 * Rebuilds `provider_metadata` from the provider payload while carrying over the
 * app-owned mailbox tags that live in the same column. Without this, any sync
 * that re-fetches a message (for example right after automation trashed it,
 * which changes it provider-side) would silently drop its tags.
 */
export function buildSyncedProviderMetadata(
  userId: string,
  message: Pick<ProviderMessageProjection, 'providerSent' | 'providerTrashed' | 'providerJunk' | 'providerArchived' | 'raw'>,
  existingMetadata: unknown,
): Record<string, unknown> {
  const preservedTagIds = readUserTagIds(existingMetadata)

  return {
    user_id: userId,
    ...(preservedTagIds.length > 0 ? { user_tag_ids: preservedTagIds } : {}),
    provider_sent: message.providerSent,
    provider_trashed: message.providerTrashed,
    provider_junk: message.providerJunk,
    provider_archived: message.providerArchived,
    provider_message: message.raw,
  }
}

export const __testUtils = {
  extractGmailBodiesFromPart,
  resolveGmailCidImages,
  extractGmailBodies,
  resolveOutlookAttachments,
  applyTagActionEventsToTagIds,
  setUserTagIdsInProviderMetadata,
  selectContinuationCursor,
  buildOutlookFolderMessagesUrl,
  parseQuickSyncGapState,
}

export function isProviderMessageJunk(provider: MailboxOAuthProvider | 'imap', providerMetadata: unknown): boolean {
  if (!providerMetadata || typeof providerMetadata !== 'object') return false
  const metadata = providerMetadata as Record<string, unknown>
  if (metadata.provider_junk === true) return true
  const raw = metadata.provider_message
  if (!raw || typeof raw !== 'object') return false
  const message = raw as Record<string, unknown>
  if (provider === 'gmail') return Array.isArray(message.labelIds) && message.labelIds.includes('SPAM')
  return provider === 'outlook' && message.provider_folder === 'junk'
}

async function upsertNormalizedMessages(
  { accountId, userId, provider }: MailAccountProviderSyncInput,
  messages: ProviderMessageProjection[],
  newMailOnly = false,
): Promise<Pick<ProviderSyncSummary, 'inserted' | 'updated' | 'insertedProviderMessageIds' | 'junkedProviderMessageIds'>> {
  if (messages.length === 0) {
    return { inserted: 0, updated: 0, insertedProviderMessageIds: [], junkedProviderMessageIds: [] }
  }

  // Batch lookup all existing messages at once instead of per-message queries
  const providerMessageIds = messages.map(m => m.providerMessageId)
  const { data: existingMessages, error: lookupError } = await supabaseAdmin
    .from('mail_messages')
    .select('id, provider_message_id, provider_metadata')
    .eq('account_id', accountId)
    .in('provider_message_id', providerMessageIds)

  if (lookupError) {
    console.error('[DB-Upsert] Lookup error:', lookupError)
    throw lookupError
  }

  const existingByProviderId = new Map<string, string>()
  const existingMetadataByProviderId = new Map<string, unknown>()
  ;(existingMessages || []).forEach((msg: { id: string; provider_message_id: string; provider_metadata: unknown }) => {
    existingByProviderId.set(msg.provider_message_id, msg.id)
    existingMetadataByProviderId.set(msg.provider_message_id, msg.provider_metadata)
  })

  // Batch upsert threads for all messages with threadIds
  const threadMessages = messages.filter(m => m.providerThreadId)
  const threadIdMap = new Map<string, string>()

  if (threadMessages.length > 0) {
    // Deduplicate: keep only the latest message per thread (to avoid duplicate-key conflict in upsert)
    const latestByThread = new Map<string, typeof threadMessages[number]>()
    for (const msg of threadMessages) {
      const existing = latestByThread.get(msg.providerThreadId!)
      if (!existing || (msg.receivedAt ?? '') > (existing.receivedAt ?? '')) {
        latestByThread.set(msg.providerThreadId!, msg)
      }
    }
    const uniqueThreadMessages = Array.from(latestByThread.values())

    const threadUpserts = uniqueThreadMessages.map(message => ({
      account_id: accountId,
      provider_thread_id: message.providerThreadId!,
      normalized_subject: message.subject,
      latest_message_at: message.receivedAt,
      provider_metadata: {},
    }))

    const { data: threads, error: threadError } = await supabaseAdmin
      .from('mail_threads')
      .upsert(threadUpserts, { onConflict: 'account_id,provider_thread_id' })
      .select('id, provider_thread_id')

    if (threadError) {
      console.error('[DB-Upsert] Thread upsert error:', threadError)
      throw threadError
    }

    // Build a map of provider thread ID to database thread ID
    threads?.forEach(t => {
      threadIdMap.set(t.provider_thread_id, t.id)
    })
  }

  // Prepare ALL message records for batch upsert (with or without threads)
  const nowIso = new Date().toISOString()
  const allMessageRecords = messages.map(message => {
    const threadId = message.providerThreadId && threadIdMap.has(message.providerThreadId)
      ? threadIdMap.get(message.providerThreadId)
      : null

    return {
      account_id: accountId,
      thread_id: threadId,
      provider_message_id: message.providerMessageId,
      rfc_message_id: message.rfcMessageId,
      subject: message.subject,
      normalized_subject: message.subject,
      from_email: message.fromEmail,
      from_name: message.fromName,
      to_emails: message.toEmails,
      cc_emails: message.ccEmails,
      bcc_emails: message.bccEmails,
      received_at: message.receivedAt,
      preview: message.preview,
      body_text: message.bodyText,
      body_html_sanitized: message.bodyHtmlSanitized,
      calendar_raw_text: message.calendarRawText,
      is_read: message.isRead,
      is_archived: message.providerArchived,
      has_attachments: message.hasAttachments,
      provider_metadata: buildSyncedProviderMetadata(
        userId,
        message,
        existingMetadataByProviderId.get(message.providerMessageId),
      ),
      updated_at: nowIso,
      created_at: nowIso,
    }
  })

  // Batch upsert ALL messages at once (Supabase handles updates vs inserts)
  const messageWrite = supabaseAdmin
    .from('mail_messages')
    .upsert(allMessageRecords, {
      onConflict: 'account_id,provider_message_id',
      ignoreDuplicates: newMailOnly,
    })
  const { data: insertedRows, error: upsertError } = newMailOnly
    ? await messageWrite.select('provider_message_id')
    : await messageWrite

  if (upsertError) {
    console.error('[DB-Upsert] Message upsert error:', upsertError)
    throw upsertError
  }

  // Conflict-ignored rows belong to another sync; do not automate or report them as new.
  const insertedIds = newMailOnly
    ? new Set<string>((insertedRows || []).map(row => row.provider_message_id))
    : new Set(messages.filter(message => !existingByProviderId.has(message.providerMessageId)).map(message => message.providerMessageId))
  const syncedMessages = newMailOnly
    ? messages.filter(message => insertedIds.has(message.providerMessageId))
    : messages
  if (syncedMessages.length > 0) {
    await reconcileSyncedUserTagIdsFromActionEvents(accountId, syncedMessages.map(message => message.providerMessageId))
  }

  // Count inserts vs updates based on what existed before
  const inserted = insertedIds.size
  const updated = newMailOnly ? 0 : existingByProviderId.size
  const junkedProviderMessageIds = newMailOnly ? [] : messages
    .filter(message => message.providerJunk && existingByProviderId.has(message.providerMessageId)
      && !isProviderMessageJunk(provider, existingMetadataByProviderId.get(message.providerMessageId)))
    .map(message => message.providerMessageId)

  try {
    await upsertMailboxContactsFromMessages(userId, syncedMessages)
  } catch (contactsError) {
    // Contact population is a best-effort projection; never fail the sync over it.
    console.warn('[Contacts] Failed to update contacts from synced messages:', contactsError)
  }

  return {
    inserted,
    updated,
    insertedProviderMessageIds: [...insertedIds],
    junkedProviderMessageIds,
  }
}

export async function syncMailboxProviderDelta(input: MailAccountProviderSyncInput): Promise<ProviderSyncSummary> {
  const options = normalizeSyncOptions(input.options)

  const storedCredentials = await getMailboxCredential(input.userId, input.accountId, input.provider)
  if (!storedCredentials?.accessToken) {
    throw new Error('Mailbox credentials are missing for provider sync')
  }

  let credentials = storedCredentials

  // Dedupes concurrent refreshes within this process (e.g. an overlapping manual
  // + scheduled auto-sync for the same account). Rotating refresh tokens
  // (Outlook) are single-use, so two independent redemptions in flight at once
  // would invalidate each other. This does NOT protect against a second,
  // separate server process refreshing the same account at the same time --
  // see the 'syncing' status guard in mailbox-sync.ts for that case.
  const refreshCredentials = async (): Promise<typeof credentials> => {
    const existingRefresh = inFlightMailboxCredentialRefreshes.get(input.accountId)
    if (existingRefresh) return existingRefresh as Promise<typeof credentials>

    const refreshPromise = (async () => {
      if (!credentials?.refreshToken) {
        throw new Error('Mailbox authorization expired. Reconnect the provider account.')
      }

      const refreshed = await refreshMailboxOAuthAccessToken(input.provider, credentials.refreshToken)
      await upsertMailboxCredential(input.userId, input.accountId, input.provider, {
        provider: input.provider,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken || credentials.refreshToken,
        expiresAt: refreshed.expiresAt,
        scope: refreshed.scope || credentials.scope,
      })

      credentials = {
        provider: input.provider,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken || credentials.refreshToken,
        expiresAt: refreshed.expiresAt,
        scope: refreshed.scope || credentials.scope,
      }

      return credentials
    })().finally(() => inFlightMailboxCredentialRefreshes.delete(input.accountId))

    inFlightMailboxCredentialRefreshes.set(input.accountId, refreshPromise)
    return refreshPromise
  }

  if (isCredentialExpired(credentials.expiresAt)) {
    credentials = await refreshCredentials()
  }

  const { data: cursorRow, error: cursorError } = await supabaseAdmin
    .from('mail_sync_cursors')
    .select('cursor, last_error')
    .eq('account_id', input.accountId)
    .eq('resource_type', 'messages')
    .maybeSingle()

  if (cursorError) throw cursorError

  // If the previous sync had a cursor error, reset to a fresh provider page.
  const lastError = (cursorRow && typeof cursorRow.last_error === 'string') ? cursorRow.last_error : null
  const storedCursor = (cursorRow && typeof cursorRow.cursor === 'string') ? cursorRow.cursor : null
  const continuationCursor = selectContinuationCursor(storedCursor, lastError, options.newMailOnly)

  const fetchProviderDelta = async (nextCursor: string | null) => (
    input.provider === 'gmail'
      ? fetchGmailDelta(credentials.accessToken, input.accountId, nextCursor, options)
      : fetchOutlookDelta(credentials.accessToken, input.accountId, nextCursor, options)
  )

  const withProviderRecovery = async <T>(run: (token: string | null) => Promise<T>, token: string | null): Promise<T> => {
    try {
      return await run(token)
    } catch (err: unknown) {
      if (token && isCursorRejectedError(err)) {
        return await run(null)
      }
      if (isUnauthorizedProviderError(err)) {
        credentials = await refreshCredentials()
        return await run(token)
      }
      throw err
    }
  }

  const fetchProviderDeltaWithRecovery = (nextCursor: string | null) => withProviderRecovery(fetchProviderDelta, nextCursor)

  const rawQuickSyncAfterMs = options.newMailOnly && options.quickSyncAfter
    ? new Date(options.quickSyncAfter).getTime()
    : NaN
  const hasQuickSyncWatermark = Number.isFinite(rawQuickSyncAfterMs)

  let quickSync: QuickSyncProgress | undefined
  let providerResult: { messages: ProviderMessageProjection[]; cursor: string | null }

  if (hasQuickSyncWatermark) {
    // Quick sync: bounded multi-page walk down to the watermark, resuming any open gap.
    const nowMs = Date.now()
    const outlookTargets = buildOutlookFolderTargets(options)
    const streams = input.provider === 'gmail' ? ['gmail'] : outlookTargets.map((target) => target.folderId)
    const outlookPageSize = Math.max(1, Math.ceil(options.maxMessages / Math.max(1, outlookTargets.length)))

    const { data: gapRow, error: gapError } = await supabaseAdmin
      .from('mail_sync_cursors')
      .select('cursor')
      .eq('account_id', input.accountId)
      .eq('resource_type', QUICK_SYNC_GAP_RESOURCE_TYPE)
      .maybeSingle()
    if (gapError) throw gapError
    const gapState = parseQuickSyncGapState(
      gapRow && typeof gapRow.cursor === 'string' ? gapRow.cursor : null,
      input.provider,
      streams,
    )

    const fetchQuickPage = async (stream: string, afterMs: number, token: string | null): Promise<QuickSyncPage> => {
      if (input.provider === 'gmail') {
        const page = await fetchGmailDelta(credentials.accessToken, input.accountId, token, options, afterMs)
        // Gmail's `after:` query bounds the listing, so the last page has no nextPageToken.
        return { messages: page.messages, nextToken: page.cursor, reachedWindowEnd: !page.cursor }
      }
      const url = token ?? buildOutlookFolderMessagesUrl(stream, outlookPageSize)
      const page = await fetchOutlookDelta(credentials.accessToken, input.accountId, url, options)
      return {
        messages: page.messages,
        nextToken: page.cursor,
        reachedWindowEnd: !page.cursor || (page.oldestListedMs !== null && page.oldestListedMs < afterMs),
      }
    }

    const walk = await runQuickSyncWalk({
      provider: input.provider,
      streams,
      // A stored watermark in the future would hide all real new mail; never start above now.
      watermarkMs: Math.min(rawQuickSyncAfterMs, nowMs),
      state: gapState,
      nowMs,
      fetchPage: (stream, afterMs, token) => withProviderRecovery((t) => fetchQuickPage(stream, afterMs, t), token),
    })
    quickSync = walk.progress
    providerResult = { messages: walk.messages, cursor: storedCursor }
  } else {
    // Provider page tokens (Gmail pageToken / Graph nextLink) are paging state over a newest-first
    // listing, not delta cursors. Resuming one only walks further into OLDER mail, so anything that
    // arrived since the token was issued is skipped for that whole pass -- which is why new mail
    // could lag the provider by several sync cycles. Always fetch the newest page first, then
    // continue the stored token in the same pass so back-fill still makes progress.
    const freshResult = await fetchProviderDeltaWithRecovery(null)
    providerResult = freshResult

    if (continuationCursor) {
      const continuation = await fetchProviderDeltaWithRecovery(continuationCursor)
      const seenIds = new Set(freshResult.messages.map((message) => message.providerMessageId))
      providerResult = {
        messages: freshResult.messages.concat(
          continuation.messages.filter((message) => !seenIds.has(message.providerMessageId)),
        ),
        cursor: continuation.cursor,
      }
    }
  }

  const cappedResult = hasQuickSyncWatermark
    ? { messages: providerResult.messages, removed: 0 }
    : applyDaysBackCap(providerResult.messages, options.daysBack)

  const newOnlyExistingIds = options.newMailOnly
    ? await fetchExistingProviderMessageIds(input.accountId, cappedResult.messages.map((message) => message.providerMessageId))
    : new Set<string>()

  // Gmail's `after:` query has day-level rounding, so the days-back cap above trims a handful of
  // boundary messages on nearly every sync -- that must NOT be treated as "reached the end of the
  // window" and used to drop the continuation cursor, or back-fill can never page past whatever
  // the first couple of pages cover before hitting that rounding edge every single run.
  providerResult = {
    ...providerResult,
    messages: options.newMailOnly
      ? cappedResult.messages.filter((message) => !newOnlyExistingIds.has(message.providerMessageId))
      : cappedResult.messages,
    cursor: options.newMailOnly ? storedCursor : providerResult.cursor,
  }

  const summary = await upsertNormalizedMessages(input, providerResult.messages, options.newMailOnly)
  const newestMessageReceivedAt = providerResult.messages.reduce<string | null>((newest, message) => {
    if (!message.receivedAt || Number.isNaN(new Date(message.receivedAt).getTime())) return newest
    if (!newest || new Date(message.receivedAt).getTime() > new Date(newest).getTime()) {
      return message.receivedAt
    }
    return newest
  }, null)

  return {
    inserted: summary.inserted,
    updated: summary.updated,
    insertedProviderMessageIds: summary.insertedProviderMessageIds,
    junkedProviderMessageIds: summary.junkedProviderMessageIds,
    cursor: providerResult.cursor,
    newestMessageReceivedAt,
    ...(quickSync ? { quickSync } : {}),
  }
}
