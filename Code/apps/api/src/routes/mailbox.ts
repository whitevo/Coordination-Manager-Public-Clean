import { Router, Response } from 'express'
import type { Router as RouterType } from 'express'
import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '../supabaseClient.js'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js'
import { sanitizeString, sanitizeUUID, safeErrorMessage } from '../middleware/validation.js'
import {
  buildMailboxOAuthAuthUrl,
  buildMailboxOAuthRedirectUri,
  exchangeMailboxOAuthCode,
  fetchMailboxProviderIdentity,
  MailboxOAuthProvider,
  refreshMailboxOAuthAccessToken,
  createMailboxOAuthTransaction,
  consumeMailboxOAuthTransaction,
  mailboxOAuthCookieName,
  readMailboxOAuthCookie,
  MAILBOX_OAUTH_MAX_AGE_MS,
} from '../services/mailbox-oauth.js'
import { extractInvitationsForAccount } from '../services/mailbox-invitations.js'
import { computeMailboxAnalytics } from '../services/mailbox-analytics.js'
import { runMailboxAccountSync, setMailboxSyncAutomationHook } from '../services/mailbox-sync.js'
import { normalizeRecipientList, sendMailboxMessage, type MailAttachment } from '../services/mailbox-send.js'
import { buildReplyBodies, type QuoteSource } from '../services/mailbox-quote.js'
import {
  DEFAULT_SYNC_OPTIONS,
  isJunkEmail,
  isProviderMessageJunk,
  sanitizeEmailHtml,
  type MailboxProviderSyncOptions,
} from '../services/mailbox-provider-sync.js'
import { getMailboxCredential, isMailboxEncryptionConfigured, upsertMailboxCredential } from '../services/mailbox-credentials.js'
import {
  EXECUTABLE_AUTOMATION_ACTIONS,
  MAX_AUTOMATION_RULES,
  cheapConditionsDecideRule,
  evaluateAutomationRule,
  fromRuleColumns,
  normalizeAutomationRule,
  toRuleColumns,
  type AutomationActionEvent,
  type AutomationActionType,
  type AutomationConditionStep,
  type AutomationFieldId,
  type AutomationMessage,
  type AutomationReceiveActionType,
  type AutomationRuleDefinition,
  type AutomationRuleMatch,
} from '../services/mailbox-automation.js'
import { assessMessage } from '../services/mailbox-assessment.js'
import { generateDraftReply } from '../services/mailbox-draft.js'
import { checkAndRecordAiUsageForUserId } from '../services/ai-usage.js'
import { ensureDefaultMailboxAutomationSetup } from '../services/mailbox-default-rules.js'
import {
  findBroadThreadMessageIds,
  normalizeMailboxThreadingOptions,
} from '../services/mailbox-threading.js'

const router: RouterType = Router()
const MAILBOX_MESSAGES_LIMIT_MAX = 1000

router.use((req, res, next) => {
  if (/^\/oauth\/(gmail|outlook)\/callback$/.test(req.path) && req.method === 'GET') {
    return next()
  }

  return authMiddleware(req as AuthenticatedRequest, res, next)
})

interface MailAccountRow {
  id: string
  user_id: string
  provider: 'gmail' | 'outlook' | 'imap'
  address: string
  display_name: string | null
  identity_group: string
  status: 'connected' | 'syncing' | 'error' | 'disconnected'
  is_primary: boolean
  connected_at: string
  last_sent_at: string | null
  quick_sync_after: string | null
  quick_sync_max_messages: number
  last_synced_at: string | null
  sync_error: string | null
  sync_error_kind: 'auth' | 'transient' | null
  sync_options: MailboxSavedSyncOptions | null
}

interface MailboxSavedSyncOptions extends Partial<MailboxProviderSyncOptions> {
  quickSyncIncludeInbox?: boolean
  quickSyncIncludeSent?: boolean
  quickSyncIncludeTrash?: boolean
  quickSyncIncludeSpam?: boolean
  quickSyncIncludeArchived?: boolean
}

// Thrown when the provider reports the message no longer exists (already deleted/moved outside this app).
class ProviderItemGoneError extends Error {}

interface MailMessageRow {
  id: string
  account_id: string
  thread_id: string | null
  subject: string | null
  from_email: string | null
  from_name: string | null
  to_emails: string | null
  cc_emails: string | null
  bcc_emails: string | null
  received_at: string | null
  preview: string | null
  body_html_sanitized: string | null
  is_read: boolean
  is_archived: boolean
  has_attachments: boolean
  provider_metadata?: unknown
}

interface MailThreadRow {
  id: string
  account_id: string
  normalized_subject: string | null
  latest_message_at: string | null
  message_count: number
  participants: unknown
}

interface MailRuleRow {
  id: string
  user_id: string
  account_id: string | null
  name: string
  conditions: unknown
  actions: unknown
  mode: 'active' | 'dry_run' | 'disabled'
  stop_processing: boolean
  created_at: string
}

interface MailUserPreferencesRow {
  user_id: string
  trusted_html_domains: unknown
  junk_domains: unknown
  non_organizer_senders: unknown
  mailbox_threading_options: unknown
  mailbox_settings_sections: unknown
  mailbox_tags: unknown
  mailbox_filter_rules: unknown
  mailbox_notifications_enabled: unknown
  mailbox_notification_rules: unknown
  mailbox_notifications_last_checked_at: unknown
}

interface MailboxTagRecord {
  id: string
  label: string
  color: string
  sort_order: number
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMAIL_ADDRESS_RE = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/
const DEFAULT_MAILBOX_TAG_COLOR = '#2563eb'
const MAX_MAILBOX_FILTER_RULES = 10
const MAX_MAILBOX_FILTER_TAGS = 100
const MAILBOX_NOTIFY_MODES = new Set(['notify', 'mute', 'always', 'never'])
const MAILBOX_SORT_BLOCK_IDS = new Set(['date', 'group:system', 'group:user'])
const MAILBOX_SYSTEM_TAG_IDS = new Set([
  'system:unread',
  'system:draft',
  'system:sent',
  'system:trash',
  'system:junk',
  'system:archived',
  'system:attachments',
])

function parseOAuthProvider(value: string): MailboxOAuthProvider | null {
  return value === 'gmail' || value === 'outlook' ? value : null
}

function readOAuthParam(req: { query: unknown; body?: unknown }, key: 'code' | 'state' | 'error', maxLength: number): string | null {
  const queryValue = typeof req.query === 'object' && req.query !== null
    ? (req.query as Record<string, unknown>)[key]
    : undefined
  const bodyValue = typeof req.body === 'object' && req.body !== null
    ? (req.body as Record<string, unknown>)[key]
    : undefined

  return sanitizeString(queryValue, maxLength) || sanitizeString(bodyValue, maxLength)
}

function logOAuthCallbackIssue(
  provider: MailboxOAuthProvider | null,
  issue: string,
  req: { method: string; get(name: string): string | undefined; query: unknown; body?: unknown },
): void {
  const query = typeof req.query === 'object' && req.query !== null ? (req.query as Record<string, unknown>) : {}
  const body = typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {}
  console.warn('[mailbox-oauth] callback issue', {
    provider: provider || 'unknown',
    issue,
    method: req.method,
    contentType: req.get('content-type') || 'unknown',
    hasQueryCode: typeof query.code === 'string',
    hasQueryState: typeof query.state === 'string',
    hasBodyCode: typeof body.code === 'string',
    hasBodyState: typeof body.state === 'string',
  })
}

function getMailboxSuccessRedirect(): string {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
  return `${frontendUrl}/mailbox?oauth_success=true`
}

function getMailboxErrorRedirect(errorMessage: string): string {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
  return `${frontendUrl}/mailbox?oauth_error=${encodeURIComponent(errorMessage)}`
}

function isTruthy(value: string | undefined): boolean {
  return value === '1' || value === 'true'
}

function isProviderMessageTrashed(provider: MailAccountRow['provider'], providerMetadata: unknown): boolean {
  if (!providerMetadata || typeof providerMetadata !== 'object') return false

  const metadata = providerMetadata as Record<string, unknown>
  if (metadata.provider_trashed === true) return true

  if (provider !== 'gmail') return false

  const providerMessage = metadata.provider_message
  if (!providerMessage || typeof providerMessage !== 'object') return false

  const labelIds = (providerMessage as Record<string, unknown>).labelIds
  return Array.isArray(labelIds) && labelIds.includes('TRASH')
}

function isProviderMessageSent(provider: MailAccountRow['provider'], providerMetadata: unknown): boolean {
  if (!providerMetadata || typeof providerMetadata !== 'object') return false

  const metadata = providerMetadata as Record<string, unknown>
  if (metadata.provider_sent === true) return true

  if (provider !== 'gmail') return false

  const providerMessage = metadata.provider_message
  if (!providerMessage || typeof providerMessage !== 'object') return false

  const labelIds = (providerMessage as Record<string, unknown>).labelIds
  return Array.isArray(labelIds) && labelIds.includes('SENT')
}

function normalizeMailboxEmail(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (!normalized || !EMAIL_RE.test(normalized)) return null
  return normalized
}

function shouldInferSentFromSender(
  senderEmail: string | null | undefined,
  accountAddress: string | null | undefined,
): boolean {
  const normalizedSender = normalizeMailboxEmail(senderEmail)
  const normalizedAccount = normalizeMailboxEmail(accountAddress)
  if (!normalizedSender || !normalizedAccount) return false
  return normalizedSender === normalizedAccount
}

function parseBooleanInput(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return isTruthy(value)
  return fallback
}

function parseIntegerInput(value: unknown, fallback: number, min: number, max: number): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(min, Math.floor(num)))
}

function normalizeMailboxDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized)) return null
  return normalized
}

function normalizeMailboxDomainList(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const unique = new Set<string>()
  for (const value of input) {
    const normalized = normalizeMailboxDomain(value)
    if (normalized) unique.add(normalized)
  }
  return Array.from(unique).sort((a, b) => a.localeCompare(b))
}

function normalizeJunkEntry(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null

  // Accept either sender-level entries (name@domain) or domain-level legacy entries.
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(normalized)) return normalized
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized)) return normalized
  return null
}

function normalizeJunkEntryList(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const unique = new Set<string>()
  for (const value of input) {
    const normalized = normalizeJunkEntry(value)
    if (normalized) unique.add(normalized)
  }
  return Array.from(unique).sort((a, b) => a.localeCompare(b))
}

/** Deletes any of the user's contacts whose only identity matches a newly-junked sender/domain. */
async function removeContactsMatchingJunkEntries(userId: string, junkEntries: string[]): Promise<void> {
  if (junkEntries.length === 0) return
  const junkSet = new Set(junkEntries.map(entry => entry.toLowerCase()))

  const { data: identities } = await supabaseAdmin
    .from('mail_contact_identities')
    .select('contact_id, email, mail_contacts!inner(user_id)')
    .eq('mail_contacts.user_id', userId)

  if (!identities || identities.length === 0) return

  const contactIdsToDelete = new Set<string>()
  for (const identity of identities as Array<{ contact_id: string; email: string }>) {
    if (isJunkEmail(identity.email.toLowerCase(), junkSet)) contactIdsToDelete.add(identity.contact_id)
  }
  if (contactIdsToDelete.size === 0) return

  await supabaseAdmin.from('mail_contacts').delete().in('id', Array.from(contactIdsToDelete))
}

function normalizeMailboxTagColor(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_MAILBOX_TAG_COLOR
  const trimmed = value.trim()
  if (!HEX_COLOR_RE.test(trimmed)) return DEFAULT_MAILBOX_TAG_COLOR
  return trimmed
}

function normalizeMailboxTagId(value: unknown): string {
  const id = sanitizeUUID(value)
  return id || randomUUID()
}

function normalizeMailboxTagRecord(input: unknown): MailboxTagRecord | null {
  if (!input || typeof input !== 'object') return null
  const candidate = input as Record<string, unknown>
  const label = sanitizeString(candidate.label, 40)
  if (!label) return null

  const sortOrder = parseIntegerInput(candidate.sort_order, 0, -10000, 10000)
  return {
    id: normalizeMailboxTagId(candidate.id),
    label,
    color: normalizeMailboxTagColor(candidate.color),
    sort_order: sortOrder,
  }
}

function normalizeMailboxTagList(input: unknown): MailboxTagRecord[] {
  if (!Array.isArray(input)) return []
  const uniqueById = new Map<string, MailboxTagRecord>()
  const uniqueByLabel = new Set<string>()

  for (const entry of input) {
    const normalized = normalizeMailboxTagRecord(entry)
    if (!normalized) continue
    const labelKey = normalized.label.toLowerCase()
    if (uniqueByLabel.has(labelKey)) continue
    if (uniqueById.has(normalized.id)) continue
    uniqueByLabel.add(labelKey)
    uniqueById.set(normalized.id, normalized)
    if (uniqueById.size >= 100) break
  }

  return Array.from(uniqueById.values())
    .sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
      return a.label.localeCompare(b.label)
    })
}

function normalizeMailboxFilterTagRules(value: unknown, isSystemTag: boolean): Array<{ id: string; mode: 'sort' | 'only' | 'hide' }> {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const rules: Array<{ id: string; mode: 'sort' | 'only' | 'hide' }> = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const source = entry as Record<string, unknown>
    const id = typeof source.id === 'string' ? source.id : ''
    const validId = isSystemTag
      ? MAILBOX_SYSTEM_TAG_IDS.has(id)
      : id.startsWith('user:') && Boolean(sanitizeUUID(id.slice('user:'.length)))
    if (!validId || seen.has(id)) continue

    seen.add(id)
    rules.push({
      id,
      mode: source.mode === 'only' || source.mode === 'hide' ? source.mode : 'sort',
    })
    if (rules.length >= MAX_MAILBOX_FILTER_TAGS) break
  }
  return rules
}

function normalizeMailboxFilterRules(input: unknown): unknown[] {
  if (!Array.isArray(input)) return []

  const ids = new Set<string>()
  const rules: unknown[] = []
  for (const entry of input) {
    if (!entry || typeof entry !== 'object') continue
    const source = entry as Record<string, unknown>
    const id = sanitizeString(source.id, 120)
    const name = sanitizeString(source.name, 80)
    if (!id || !name || ids.has(id)) continue

    const sourceSort = source.sort && typeof source.sort === 'object'
      ? source.sort as Record<string, unknown>
      : {}
    const order = Array.isArray(sourceSort.order)
      ? sourceSort.order.filter((value): value is string => typeof value === 'string' && MAILBOX_SORT_BLOCK_IDS.has(value))
      : []

    ids.add(id)
    rules.push({
      id,
      name,
      sort: {
        order,
        dateEnabled: sourceSort.dateEnabled !== false,
        dateDirection: sourceSort.dateDirection === 'oldest' ? 'oldest' : 'newest',
        systemTags: normalizeMailboxFilterTagRules(sourceSort.systemTags, true),
        userTags: normalizeMailboxFilterTagRules(sourceSort.userTags, false),
      },
    })
    if (rules.length >= MAX_MAILBOX_FILTER_RULES) break
  }
  return rules
}

function normalizeMailboxNotificationTagRules(value: unknown, isSystemTag: boolean): Array<{ id: string; mode: 'notify' | 'mute' | 'always' | 'never' }> {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const rules: Array<{ id: string; mode: 'notify' | 'mute' | 'always' | 'never' }> = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const source = entry as Record<string, unknown>
    const id = typeof source.id === 'string' ? source.id : ''
    const validId = isSystemTag
      ? MAILBOX_SYSTEM_TAG_IDS.has(id)
      : id.startsWith('user:') && Boolean(sanitizeUUID(id.slice('user:'.length)))
    if (!validId || seen.has(id)) continue

    seen.add(id)
    const mode = typeof source.mode === 'string' && MAILBOX_NOTIFY_MODES.has(source.mode)
      ? (source.mode as 'notify' | 'mute' | 'always' | 'never')
      : 'mute'
    rules.push({ id, mode })
    if (rules.length >= MAX_MAILBOX_FILTER_TAGS) break
  }
  return rules
}

function normalizeMailboxNotificationRules(input: unknown): { systemTags: Array<{ id: string; mode: 'notify' | 'mute' | 'always' | 'never' }>; userTags: Array<{ id: string; mode: 'notify' | 'mute' | 'always' | 'never' }> } {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  return {
    systemTags: normalizeMailboxNotificationTagRules(source.systemTags, true),
    userTags: normalizeMailboxNotificationTagRules(source.userTags, false),
  }
}

/** Mirrors the system-tag matching used by the client's mailbox-sort/mailbox-notifications logic. */
function messageMatchesNotificationSystemTag(
  systemTagId: string,
  flags: {
    is_read: boolean
    is_archived: boolean
    has_attachments: boolean
    is_provider_trashed: boolean
    is_provider_junk: boolean
    is_provider_sent: boolean
  },
): boolean {
  switch (systemTagId) {
    case 'system:unread': return !flags.is_read
    case 'system:sent': return flags.is_provider_sent
    case 'system:trash': return flags.is_provider_trashed
    case 'system:junk': return flags.is_provider_junk
    case 'system:archived': return flags.is_archived
    case 'system:attachments': return flags.has_attachments
    // 'system:draft' only exists for locally-saved drafts, which never appear in mail_messages.
    default: return false
  }
}

/** never > always > mute > notify > (no matching tag rule -- do not notify) -- mirrors mailbox-notifications.ts on the client. */
function shouldNotifyForMessageRow(
  flags: {
    is_read: boolean
    is_archived: boolean
    has_attachments: boolean
    is_provider_trashed: boolean
    is_provider_junk: boolean
    is_provider_sent: boolean
    user_tag_ids: string[]
  },
  rules: ReturnType<typeof normalizeMailboxNotificationRules>,
): boolean {
  const matchingModes: string[] = []
  for (const entry of rules.systemTags) {
    if (messageMatchesNotificationSystemTag(entry.id, flags)) matchingModes.push(entry.mode)
  }
  for (const entry of rules.userTags) {
    if (flags.user_tag_ids.includes(entry.id.slice('user:'.length))) matchingModes.push(entry.mode)
  }

  if (matchingModes.includes('never')) return false
  if (matchingModes.includes('always')) return true
  if (matchingModes.includes('mute')) return false
  if (matchingModes.includes('notify')) return true
  return false
}

function extractUserTagIdsFromProviderMetadata(providerMetadata: unknown): string[] {
  if (!providerMetadata || typeof providerMetadata !== 'object') return []
  const metadata = providerMetadata as Record<string, unknown>
  const tagIds = metadata.user_tag_ids
  if (!Array.isArray(tagIds)) return []

  const seen = new Set<string>()
  for (const tagId of tagIds) {
    const sanitized = sanitizeUUID(tagId)
    if (!sanitized) continue
    seen.add(sanitized)
    if (seen.size >= 50) break
  }

  return Array.from(seen)
}

const MAILBOX_NOTIFICATION_CANDIDATE_SELECT = [
  'account_id',
  'is_read',
  'is_archived',
  'has_attachments',
  'from_email',
  'meta_user_tag_ids:provider_metadata->user_tag_ids',
  'meta_provider_sent:provider_metadata->provider_sent',
  'meta_provider_trashed:provider_metadata->provider_trashed',
  'meta_provider_junk:provider_metadata->provider_junk',
  'meta_label_ids:provider_metadata->provider_message->labelIds',
  'meta_provider_folder:provider_metadata->provider_message->provider_folder',
].join(', ')

interface MailboxNotificationCandidateRow {
  account_id: string
  is_read: boolean
  is_archived: boolean
  has_attachments: boolean
  from_email: string | null
  meta_user_tag_ids: unknown
  meta_provider_sent: unknown
  meta_provider_trashed: unknown
  meta_provider_junk: unknown
  meta_label_ids: unknown
  meta_provider_folder: unknown
}

function buildNotificationCandidateMetadata(row: MailboxNotificationCandidateRow): Record<string, unknown> {
  return {
    user_tag_ids: row.meta_user_tag_ids,
    provider_sent: row.meta_provider_sent,
    provider_trashed: row.meta_provider_trashed,
    provider_junk: row.meta_provider_junk,
    provider_message: {
      labelIds: row.meta_label_ids,
      provider_folder: row.meta_provider_folder,
    },
  }
}

function setUserTagIdsInProviderMetadata(providerMetadata: unknown, tagIds: string[]): Record<string, unknown> {
  const metadata = (providerMetadata && typeof providerMetadata === 'object')
    ? { ...(providerMetadata as Record<string, unknown>) }
    : {}
  metadata.user_tag_ids = tagIds
  return metadata
}

function extractProviderMessageId(providerMetadata: unknown): string | null {
  if (!providerMetadata || typeof providerMetadata !== 'object') return null
  const metadata = providerMetadata as Record<string, unknown>
  const providerMessage = metadata.provider_message
  if (!providerMessage || typeof providerMessage !== 'object') return null
  const id = (providerMessage as Record<string, unknown>).id
  return typeof id === 'string' && id.trim() ? id : null
}

function extractProviderMessageObject(providerMetadata: unknown): Record<string, unknown> | null {
  if (!providerMetadata || typeof providerMetadata !== 'object') return null
  const metadata = providerMetadata as Record<string, unknown>
  const providerMessage = metadata.provider_message
  if (!providerMessage || typeof providerMessage !== 'object') return null
  return providerMessage as Record<string, unknown>
}

function resolveThreadMessageHtml(
  bodyHtmlSanitized: string | null,
  providerMetadata: unknown,
): string | null {
  if (bodyHtmlSanitized) return bodyHtmlSanitized

  // Older Outlook rows retained the Graph payload but predate body_html_sanitized.
  // Recover only an explicitly HTML body and pass it through the current sanitizer.
  const providerMessage = extractProviderMessageObject(providerMetadata)
  const body = providerMessage?.body
  if (!body || typeof body !== 'object') return null

  const bodyRecord = body as Record<string, unknown>
  const contentType = typeof bodyRecord.contentType === 'string'
    ? bodyRecord.contentType.toLowerCase()
    : ''
  const content = typeof bodyRecord.content === 'string' ? bodyRecord.content : ''
  if (contentType !== 'html' || !content) return null

  return sanitizeEmailHtml(content) || null
}

function extractEmailsFromText(value: string | null): string[] {
  if (!value) return []

  const matches = value.match(EMAIL_ADDRESS_RE) || []
  const deduped = new Set<string>()
  for (const match of matches) {
    const normalized = match.trim().toLowerCase()
    if (!normalized) continue
    deduped.add(normalized)
  }

  return Array.from(deduped)
}

function extractOutlookRecipientEmails(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const deduped = new Set<string>()
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const emailAddress = (entry as Record<string, unknown>).emailAddress
    if (!emailAddress || typeof emailAddress !== 'object') continue
    const address = (emailAddress as Record<string, unknown>).address
    if (typeof address !== 'string') continue

    const normalized = address.trim().toLowerCase()
    if (!normalized) continue
    deduped.add(normalized)
  }

  return Array.from(deduped)
}

function joinRecipientEmails(emails: string[]): string | null {
  if (emails.length === 0) return null
  return emails.join(', ')
}

function extractRecipientEmailsFromProviderMetadata(
  providerMetadata: unknown,
  recipientType: 'to' | 'cc' | 'bcc',
): string | null {
  const providerMessage = extractProviderMessageObject(providerMetadata)
  if (!providerMessage) return null

  const gmailHeaderByType: Record<'to' | 'cc' | 'bcc', string> = {
    to: 'To',
    cc: 'Cc',
    bcc: 'Bcc',
  }

  const gmailHeader = extractGmailHeaderValue(providerMessage, gmailHeaderByType[recipientType])
  let emails = extractEmailsFromText(gmailHeader)

  if (emails.length === 0 && recipientType === 'to') {
    const fallbackHeaders = ['Delivered-To', 'X-Original-To', 'X-Forwarded-To']
    for (const headerName of fallbackHeaders) {
      const value = extractGmailHeaderValue(providerMessage, headerName)
      const parsed = extractEmailsFromText(value)
      if (parsed.length > 0) {
        emails = parsed
        break
      }
    }
  }

  if (emails.length === 0) {
    const outlookFieldByType: Record<'to' | 'cc' | 'bcc', string> = {
      to: 'toRecipients',
      cc: 'ccRecipients',
      bcc: 'bccRecipients',
    }
    emails = extractOutlookRecipientEmails(providerMessage[outlookFieldByType[recipientType]])
  }

  return joinRecipientEmails(emails)
}

function extractGmailHeaderValue(providerMessage: Record<string, unknown>, headerName: string): string | null {
  const payload = (providerMessage.payload && typeof providerMessage.payload === 'object')
    ? providerMessage.payload as Record<string, unknown>
    : null
  if (!payload) return null

  const headers = Array.isArray(payload.headers) ? payload.headers : []
  const wanted = headerName.toLowerCase()

  for (const entry of headers) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name.toLowerCase() : ''
    if (name !== wanted) continue
    const value = typeof record.value === 'string' ? record.value.trim() : ''
    if (value) return value
  }

  return null
}

function extractReplyToFromProviderMetadata(providerMetadata: unknown): string | null {
  const providerMessage = extractProviderMessageObject(providerMetadata)
  if (!providerMessage) return null

  const gmailReplyTo = extractGmailHeaderValue(providerMessage, 'Reply-To')
  if (gmailReplyTo) return gmailReplyTo

  const outlookReplyTo = providerMessage.replyTo
  if (Array.isArray(outlookReplyTo) && outlookReplyTo.length > 0) {
    const firstEntry = outlookReplyTo[0]
    if (firstEntry && typeof firstEntry === 'object') {
      const emailAddress = (firstEntry as Record<string, unknown>).emailAddress
      if (emailAddress && typeof emailAddress === 'object') {
        const record = emailAddress as Record<string, unknown>
        const address = typeof record.address === 'string' ? record.address.trim() : ''
        const name = typeof record.name === 'string' ? record.name.trim() : ''
        if (name && address) return `${name} <${address}>`
        if (address) return address
      }
    }
  }

  return null
}

function extractEncryptionTypeFromProviderMetadata(providerMetadata: unknown): string | null {
  const providerMessage = extractProviderMessageObject(providerMetadata)
  if (!providerMessage) return null

  const contentType = extractGmailHeaderValue(providerMessage, 'Content-Type')
    || extractGmailHeaderValue(providerMessage, 'content-type')
  const contentTypeLower = (contentType || '').toLowerCase()

  if (contentTypeLower.includes('multipart/encrypted') || contentTypeLower.includes('protocol="application/pgp-encrypted"')) {
    return 'PGP/MIME'
  }

  if (contentTypeLower.includes('application/pkcs7-mime') || contentTypeLower.includes('application/x-pkcs7-mime') || contentTypeLower.includes('smime')) {
    return 'S/MIME'
  }

  if (contentTypeLower.includes('multipart/signed')) {
    return 'Signed (multipart/signed)'
  }

  const payload = (providerMessage.payload && typeof providerMessage.payload === 'object')
    ? providerMessage.payload as Record<string, unknown>
    : null
  const payloadMimeType = typeof payload?.mimeType === 'string' ? payload.mimeType.toLowerCase() : ''
  if (payloadMimeType.includes('application/pkcs7-mime') || payloadMimeType.includes('smime')) {
    return 'S/MIME'
  }
  if (payloadMimeType.includes('multipart/encrypted')) {
    return 'PGP/MIME'
  }

  return null
}

// Dedupes concurrent refreshes for the same account (e.g. trashing every message in a thread at
// once) -- without this, parallel calls each see the same stale token and race to refresh it,
// which can burn a rotating (single-use) refresh token and leave the losing calls unauthenticated.
const inFlightTokenRefreshes = new Map<string, Promise<string>>()

async function getAccountAccessToken(account: MailAccountRow): Promise<string> {
  if (account.provider !== 'gmail' && account.provider !== 'outlook') {
    throw new Error(`Provider ${account.provider} does not support remote trash via this API`)
  }

  const provider = account.provider as MailboxOAuthProvider
  const credential = await getMailboxCredential(account.user_id, account.id, provider)
  if (!credential?.accessToken) {
    throw new Error('Mailbox credentials are missing for provider action')
  }

  if (!credential.expiresAt || Number.isNaN(new Date(credential.expiresAt).getTime())) {
    return credential.accessToken
  }

  const expiresAtMs = new Date(credential.expiresAt).getTime()
  const hasGraceWindowExpired = Date.now() > (expiresAtMs - 30_000)
  if (!hasGraceWindowExpired) {
    return credential.accessToken
  }

  if (!credential.refreshToken) {
    return credential.accessToken
  }

  const existingRefresh = inFlightTokenRefreshes.get(account.id)
  if (existingRefresh) return existingRefresh

  const refreshPromise = (async () => {
    const refreshed = await refreshMailboxOAuthAccessToken(provider, credential.refreshToken!)
    await upsertMailboxCredential(account.user_id, account.id, provider, {
      provider,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken || credential.refreshToken,
      expiresAt: refreshed.expiresAt,
      scope: refreshed.scope,
    })
    return refreshed.accessToken
  })()
    .finally(() => inFlightTokenRefreshes.delete(account.id))

  inFlightTokenRefreshes.set(account.id, refreshPromise)
  return refreshPromise
}

async function moveMessageToProviderTrash(
  account: MailAccountRow,
  providerMessageId: string,
): Promise<void> {
  const accessToken = await getAccountAccessToken(account)

  if (account.provider === 'gmail') {
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(providerMessageId)}/trash`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      const payload = await response.text().catch(() => '')
      if (response.status === 404) {
        throw new ProviderItemGoneError(`Gmail trash request failed (${response.status})${payload ? `: ${payload.slice(0, 200)}` : ''}`)
      }
      throw new Error(`Gmail trash request failed (${response.status})${payload ? `: ${payload.slice(0, 200)}` : ''}`)
    }

    return
  }

  if (account.provider === 'outlook') {
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(providerMessageId)}/move`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ destinationId: 'deleteditems' }),
    })

    if (!response.ok) {
      const payload = await response.text().catch(() => '')
      if (response.status === 404) {
        throw new ProviderItemGoneError(`Outlook move-to-trash request failed (${response.status})${payload ? `: ${payload.slice(0, 200)}` : ''}`)
      }
      throw new Error(`Outlook move-to-trash request failed (${response.status})${payload ? `: ${payload.slice(0, 200)}` : ''}`)
    }

    return
  }

  throw new Error(`Provider ${account.provider} does not support remote trash via this API`)
}

async function moveMessageOutOfProviderTrash(
  account: MailAccountRow,
  providerMessageId: string,
): Promise<void> {
  const accessToken = await getAccountAccessToken(account)

  if (account.provider === 'gmail') {
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(providerMessageId)}/untrash`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      const payload = await response.text().catch(() => '')
      throw new Error(`Gmail untrash request failed (${response.status})${payload ? `: ${payload.slice(0, 200)}` : ''}`)
    }

    const inboxResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(providerMessageId)}/modify`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ addLabelIds: ['INBOX'] }),
    })

    if (!inboxResponse.ok) {
      const payload = await inboxResponse.text().catch(() => '')
      throw new Error(`Gmail restore-to-inbox request failed (${inboxResponse.status})${payload ? `: ${payload.slice(0, 200)}` : ''}`)
    }

    return
  }

  if (account.provider === 'outlook') {
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(providerMessageId)}/move`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ destinationId: 'inbox' }),
    })

    if (!response.ok) {
      const payload = await response.text().catch(() => '')
      throw new Error(`Outlook restore-from-trash request failed (${response.status})${payload ? `: ${payload.slice(0, 200)}` : ''}`)
    }

    return
  }

  throw new Error(`Provider ${account.provider} does not support remote trash restore via this API`)
}

async function setProviderMessageReadState(
  account: MailAccountRow,
  providerMessageId: string,
  isRead: boolean,
): Promise<void> {
  const accessToken = await getAccountAccessToken(account)

  if (account.provider === 'gmail') {
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(providerMessageId)}/modify`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(isRead
        ? { removeLabelIds: ['UNREAD'] }
        : { addLabelIds: ['UNREAD'] }),
    })

    if (!response.ok) {
      const payload = await response.text().catch(() => '')
      throw new Error(`Gmail read-state request failed (${response.status})${payload ? `: ${payload.slice(0, 200)}` : ''}`)
    }

    return
  }

  if (account.provider === 'outlook') {
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(providerMessageId)}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ isRead }),
    })

    if (!response.ok) {
      const payload = await response.text().catch(() => '')
      throw new Error(`Outlook read-state request failed (${response.status})${payload ? `: ${payload.slice(0, 200)}` : ''}`)
    }

    return
  }

  throw new Error(`Provider ${account.provider} does not support remote read-state updates via this API`)
}

async function setProviderMessageArchivedState(
  account: MailAccountRow,
  providerMessageId: string,
  isArchived: boolean,
): Promise<void> {
  const accessToken = await getAccountAccessToken(account)

  if (account.provider === 'gmail') {
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(providerMessageId)}/modify`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(isArchived
        ? { removeLabelIds: ['INBOX'] }
        : { addLabelIds: ['INBOX'] }),
    })

    if (!response.ok) {
      const payload = await response.text().catch(() => '')
      if (response.status === 404) {
        throw new ProviderItemGoneError(`Gmail ${isArchived ? 'archive' : 'unarchive'} request failed (${response.status})${payload ? `: ${payload.slice(0, 200)}` : ''}`)
      }
      throw new Error(`Gmail ${isArchived ? 'archive' : 'unarchive'} request failed (${response.status})${payload ? `: ${payload.slice(0, 200)}` : ''}`)
    }

    return
  }

  if (account.provider === 'outlook') {
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(providerMessageId)}/move`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ destinationId: isArchived ? 'archive' : 'inbox' }),
    })

    if (!response.ok) {
      const payload = await response.text().catch(() => '')
      if (response.status === 404) {
        throw new ProviderItemGoneError(`Outlook ${isArchived ? 'archive' : 'unarchive'} request failed (${response.status})${payload ? `: ${payload.slice(0, 200)}` : ''}`)
      }
      throw new Error(`Outlook ${isArchived ? 'archive' : 'unarchive'} request failed (${response.status})${payload ? `: ${payload.slice(0, 200)}` : ''}`)
    }

    return
  }

  throw new Error(`Provider ${account.provider} does not support remote archive updates via this API`)
}

async function moveMessageOutOfProviderJunk(
  account: MailAccountRow,
  providerMessageId: string,
): Promise<void> {
  const accessToken = await getAccountAccessToken(account)

  if (account.provider === 'gmail') {
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(providerMessageId)}/modify`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ removeLabelIds: ['SPAM'], addLabelIds: ['INBOX'] }),
    })

    if (!response.ok) {
      const payload = await response.text().catch(() => '')
      if (response.status === 404) {
        throw new ProviderItemGoneError(`Gmail not-junk request failed (${response.status})${payload ? `: ${payload.slice(0, 200)}` : ''}`)
      }
      throw new Error(`Gmail not-junk request failed (${response.status})${payload ? `: ${payload.slice(0, 200)}` : ''}`)
    }

    return
  }

  if (account.provider === 'outlook') {
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(providerMessageId)}/move`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ destinationId: 'inbox' }),
    })

    if (!response.ok) {
      const payload = await response.text().catch(() => '')
      if (response.status === 404) {
        throw new ProviderItemGoneError(`Outlook not-junk request failed (${response.status})${payload ? `: ${payload.slice(0, 200)}` : ''}`)
      }
      throw new Error(`Outlook not-junk request failed (${response.status})${payload ? `: ${payload.slice(0, 200)}` : ''}`)
    }

    return
  }

  throw new Error(`Provider ${account.provider} does not support remote junk restore via this API`)
}

// ─── Attachments ─────────────────────────────────────────────────────────────

const MAX_ATTACHMENT_DOWNLOAD_BYTES = 26_214_400 // 25 MiB

interface MailAttachmentSummary {
  id: string
  filename: string
  mime_type: string | null
  size_bytes: number | null
}

interface AttachmentDownload {
  filename: string
  mimeType: string
  content: Buffer
}

function decodeBase64UrlToBuffer(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  return Buffer.from(padded, 'base64')
}

function sanitizeAttachmentFilename(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const cleaned = value
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[\\/]/g, '_')
  const withoutControlCharacters = Array.from(cleaned)
    .filter((character) => {
      const codePoint = character.charCodeAt(0)
      return codePoint >= 32 && codePoint !== 127
    })
    .join('')
    .trim()
  return withoutControlCharacters.slice(0, 200) || fallback
}

function isSafeProviderAttachmentId(value: string): boolean {
  return value.length > 0 && value.length <= 2048 && /^[A-Za-z0-9_\-=+/.:@]+$/.test(value)
}

function getProviderMessagePayload(providerMetadata: unknown): Record<string, unknown> | null {
  if (!providerMetadata || typeof providerMetadata !== 'object') return null
  const providerMessage = (providerMetadata as Record<string, unknown>).provider_message
  if (!providerMessage || typeof providerMessage !== 'object') return null
  const payload = (providerMessage as Record<string, unknown>).payload
  if (!payload || typeof payload !== 'object') return null
  return payload as Record<string, unknown>
}

function collectGmailAttachmentParts(
  part: Record<string, unknown>,
  path: string,
  out: Array<{ id: string; part: Record<string, unknown> }>,
): void {
  const filename = typeof part.filename === 'string' ? part.filename : ''
  const body = (part.body && typeof part.body === 'object') ? part.body as Record<string, unknown> : null

  if (filename) {
    const attachmentId = body && typeof body.attachmentId === 'string' ? body.attachmentId : null
    if (attachmentId && isSafeProviderAttachmentId(attachmentId)) {
      out.push({ id: `id:${attachmentId}`, part })
    } else if (body && typeof body.data === 'string') {
      out.push({ id: `part:${path}`, part })
    }
  }

  const children = Array.isArray(part.parts)
    ? part.parts.filter((child): child is Record<string, unknown> => typeof child === 'object' && child !== null)
    : []

  children.forEach((child, index) => {
    collectGmailAttachmentParts(child, path ? `${path}.${index}` : String(index), out)
  })
}

// Calendar invite emails carry both a text/calendar part (drives Gmail's inline
// RSVP widget) and an application/ics part with the identical filename. Outlook
// only surfaces one, so collapse the duplicate to match instead of listing it twice.
function dedupeCalendarInviteAttachments(summaries: MailAttachmentSummary[]): MailAttachmentSummary[] {
  const keptCalendarIndexByFilename = new Map<string, number>()
  const result: MailAttachmentSummary[] = []
  const normalizeMimeType = (mimeType: string | null): string | null =>
    mimeType ? mimeType.split(';', 1)[0].trim().toLowerCase() : null
  const isCalendarMimeType = (mimeType: string | null): boolean => {
    const normalized = normalizeMimeType(mimeType)
    return normalized === 'text/calendar' || normalized === 'application/ics'
  }

  for (const summary of summaries) {
    if (!isCalendarMimeType(summary.mime_type)) {
      result.push(summary)
      continue
    }

    const filenameKey = summary.filename.trim().toLowerCase()
    const existingIndex = keptCalendarIndexByFilename.get(filenameKey)
    if (existingIndex === undefined) {
      keptCalendarIndexByFilename.set(filenameKey, result.length)
      result.push(summary)
      continue
    }

    const existing = result[existingIndex]

    // Prefer the generic application/ics attachment over the inline text/calendar part.
    if (normalizeMimeType(existing.mime_type) === 'text/calendar' &&
        normalizeMimeType(summary.mime_type) === 'application/ics') {
      result[existingIndex] = summary
    }
  }

  return result
}

function listGmailAttachments(providerMetadata: unknown): MailAttachmentSummary[] {
  const payload = getProviderMessagePayload(providerMetadata)
  if (!payload) return []

  const collected: Array<{ id: string; part: Record<string, unknown> }> = []
  collectGmailAttachmentParts(payload, '', collected)

  const summaries = collected.map(({ id, part }, index) => {
    const body = (part.body && typeof part.body === 'object') ? part.body as Record<string, unknown> : null
    return {
      id,
      filename: sanitizeAttachmentFilename(part.filename, `attachment-${index + 1}`),
      mime_type: typeof part.mimeType === 'string' ? part.mimeType : null,
      size_bytes: body && typeof body.size === 'number' ? body.size : null,
    }
  })

  return dedupeCalendarInviteAttachments(summaries)
}

async function listOutlookAttachments(
  account: MailAccountRow,
  providerMessageId: string,
): Promise<MailAttachmentSummary[]> {
  const accessToken = await getAccountAccessToken(account)
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(providerMessageId)}/attachments?$select=id,name,contentType,size,isInline`,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } },
  )

  if (response.status === 404 || response.status === 410) {
    return []
  }

  if (!response.ok) {
    throw new Error(`Outlook attachment list request failed (${response.status})`)
  }

  const payload = await response.json().catch(() => null) as Record<string, unknown> | null
  const items = payload && Array.isArray(payload.value) ? payload.value as Array<Record<string, unknown>> : []

  return items
    .filter(item => item.isInline !== true && typeof item.id === 'string')
    .map((item, index) => ({
      id: `id:${item.id as string}`,
      filename: sanitizeAttachmentFilename(item.name, `attachment-${index + 1}`),
      mime_type: typeof item.contentType === 'string' ? item.contentType : null,
      size_bytes: typeof item.size === 'number' ? item.size : null,
    }))
}

function findGmailPartByPath(payload: Record<string, unknown>, path: string): Record<string, unknown> | null {
  if (!path) return payload

  let current: Record<string, unknown> = payload
  for (const segment of path.split('.')) {
    const index = Number(segment)
    if (!Number.isInteger(index) || index < 0) return null
    const children = Array.isArray(current.parts) ? current.parts : []
    const child = children[index]
    if (!child || typeof child !== 'object') return null
    current = child as Record<string, unknown>
  }

  return current
}

async function downloadGmailAttachment(
  account: MailAccountRow,
  providerMessageId: string,
  providerMetadata: unknown,
  attachmentRef: string,
): Promise<AttachmentDownload | null> {
  const summaries = listGmailAttachments(providerMetadata)
  const summary = summaries.find(item => item.id === attachmentRef)
  if (!summary) return null

  const payload = getProviderMessagePayload(providerMetadata)

  if (attachmentRef.startsWith('part:')) {
    const part = payload ? findGmailPartByPath(payload, attachmentRef.slice('part:'.length)) : null
    const body = (part?.body && typeof part.body === 'object') ? part.body as Record<string, unknown> : null
    if (!body || typeof body.data !== 'string') return null
    return {
      filename: summary.filename,
      mimeType: summary.mime_type || 'application/octet-stream',
      content: decodeBase64UrlToBuffer(body.data),
    }
  }

  const providerAttachmentId = attachmentRef.slice('id:'.length)
  if (!isSafeProviderAttachmentId(providerAttachmentId)) return null

  const accessToken = await getAccountAccessToken(account)
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(providerMessageId)}/attachments/${encodeURIComponent(providerAttachmentId)}`,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } },
  )

  if (!response.ok) {
    throw new Error(`Gmail attachment download failed (${response.status})`)
  }

  const body = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body.data !== 'string') return null

  return {
    filename: summary.filename,
    mimeType: summary.mime_type || 'application/octet-stream',
    content: decodeBase64UrlToBuffer(body.data),
  }
}

async function downloadOutlookAttachment(
  account: MailAccountRow,
  providerMessageId: string,
  attachmentRef: string,
): Promise<AttachmentDownload | null> {
  if (!attachmentRef.startsWith('id:')) return null
  const providerAttachmentId = attachmentRef.slice('id:'.length)
  if (!isSafeProviderAttachmentId(providerAttachmentId)) return null

  const accessToken = await getAccountAccessToken(account)
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(providerMessageId)}/attachments/${encodeURIComponent(providerAttachmentId)}`,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } },
  )

  if (!response.ok) {
    throw new Error(`Outlook attachment download failed (${response.status})`)
  }

  const payload = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!payload || typeof payload.contentBytes !== 'string') return null

  return {
    filename: sanitizeAttachmentFilename(payload.name, 'attachment'),
    mimeType: typeof payload.contentType === 'string' ? payload.contentType : 'application/octet-stream',
    content: Buffer.from(payload.contentBytes, 'base64'),
  }
}

async function getUserAccounts(userId: string): Promise<MailAccountRow[]> {
  const { data, error } = await supabaseAdmin
    .from('mail_accounts')
    .select('id, user_id, provider, address, display_name, identity_group, status, is_primary, connected_at, last_sent_at, quick_sync_after, quick_sync_max_messages, last_synced_at, sync_error, sync_error_kind, sync_options')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data || []) as MailAccountRow[]
}

async function getOwnedAccount(userId: string, accountId: string): Promise<MailAccountRow | null> {
  const { data, error } = await supabaseAdmin
    .from('mail_accounts')
    .select('id, user_id, provider, address, display_name, identity_group, status, is_primary, connected_at, last_sent_at, quick_sync_after, quick_sync_max_messages, last_synced_at, sync_error, sync_error_kind, sync_options')
    .eq('id', accountId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  return (data as MailAccountRow | null) || null
}

async function purgeDisconnectedAccountMailData(userId: string, accountId: string): Promise<void> {
  const deleteByAccountIdTables = [
    'mail_drafts',
    'mail_action_events',
    'mail_messages',
    'mail_threads',
    'mail_folders',
    'mail_labels',
    'mail_sync_cursors',
    'mail_credentials',
  ]

  for (const tableName of deleteByAccountIdTables) {
    const { error } = await supabaseAdmin
      .from(tableName)
      .delete()
      .eq('account_id', accountId)

    if (error) throw error
  }

  const { error } = await supabaseAdmin
    .from('mail_accounts')
    .update({
      status: 'disconnected',
      credentials_ref: null,
      provider_metadata: {},
      last_synced_at: null,
      sync_cursor: null,
      sync_error: null,
      sync_failure_count: 0,
      sync_retry_after: null,
      sync_error_kind: null,
      disconnected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', accountId)
    .eq('user_id', userId)

  if (error) throw error
}

async function writeAuditEvent(
  userId: string,
  actor: string,
  operation: string,
  targetType: string,
  targetId: string,
  outcome: 'success' | 'failure',
  reason?: string,
  accountId?: string,
  requireRecording = false,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('mail_audit_events')
    .insert({
      user_id: userId,
      account_id: accountId || null,
      actor,
      operation,
      target_type: targetType,
      target_id: targetId,
      outcome,
      reason: reason || null,
    })
  if (requireRecording && error) throw error
}

// ─── Accounts ────────────────────────────────────────────────────────────────

router.get('/oauth/:provider/auth-url', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const provider = parseOAuthProvider(req.params.provider)
    if (!provider) return res.status(400).json({ error: 'provider must be gmail or outlook' })

    const identityGroup = sanitizeString(req.query.identity_group, 40) || 'personal'
    const redirectUri = buildMailboxOAuthRedirectUri(provider, req)
    const { state, browserToken } = await createMailboxOAuthTransaction({
      userId: req.userId!,
      provider,
      identityGroup,
    })
    const authUrl = buildMailboxOAuthAuthUrl(provider, redirectUri, state)

    res.cookie(mailboxOAuthCookieName(provider), browserToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: MAILBOX_OAUTH_MAX_AGE_MS,
      path: `/api/mailbox/oauth/${provider}`,
    })
    res.setHeader('Cache-Control', 'no-store')
    res.json({ authUrl })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

async function handleOAuthCallback(
  req: {
    params: { provider: string }
    method: string
    protocol: string
    get(name: string): string | undefined
    query: unknown
    body?: unknown
    userId?: string
  },
  res: Response,
) {
  const provider = parseOAuthProvider(req.params.provider)
  if (!provider) {
    logOAuthCallbackIssue(null, 'unsupported-provider', req)
    return res.redirect(getMailboxErrorRedirect('Unsupported mailbox provider'))
  }

  const oauthError = readOAuthParam(req, 'error', 200)
  const code = readOAuthParam(req, 'code', 8000)
  const stateRaw = readOAuthParam(req, 'state', 2000)
  if ((!code && !oauthError) || !stateRaw) {
    logOAuthCallbackIssue(provider, 'missing-code-or-state', req)
    return res.redirect(getMailboxErrorRedirect('Missing authorization code or state'))
  }

  try {
    if (!isMailboxEncryptionConfigured()) {
      logOAuthCallbackIssue(provider, 'encryption-not-configured', req)
      return res.redirect(getMailboxErrorRedirect('Mailbox encryption key is not configured on the server'))
    }

    const state = await consumeMailboxOAuthTransaction(
      stateRaw,
      readMailboxOAuthCookie(req.get('cookie'), provider),
      provider,
    )
    if (!state) {
      logOAuthCallbackIssue(provider, 'invalid-or-expired-transaction', req)
      return res.redirect(getMailboxErrorRedirect('Invalid or expired OAuth connection. Start again from Mailbox settings.'))
    }

    res.clearCookie(mailboxOAuthCookieName(provider), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: `/api/mailbox/oauth/${provider}`,
    })
    if (req.userId && req.userId !== state.userId) {
      logOAuthCallbackIssue(provider, 'user-mismatch', req)
      return res.redirect(getMailboxErrorRedirect('OAuth connection user mismatch'))
    }
    if (oauthError) {
      logOAuthCallbackIssue(provider, 'provider-authorization-denied', req)
      return res.redirect(getMailboxErrorRedirect(oauthError))
    }

    const redirectUri = buildMailboxOAuthRedirectUri(provider, req)
    const token = await exchangeMailboxOAuthCode(provider, code!, redirectUri)
    const identity = await fetchMailboxProviderIdentity(provider, token.accessToken)

    const { data: existing, error: lookupError } = await supabaseAdmin
      .from('mail_accounts')
      .select('id')
      .eq('user_id', state.userId)
      .eq('provider', provider)
      .eq('address', identity.email)
      .maybeSingle()

    if (lookupError) throw lookupError

    const nowIso = new Date().toISOString()
    const providerMetadata = {
      oauth_connected: true,
      token_expires_at: token.expiresAt,
      scope: token.scope,
      provider_profile: {
        email: identity.email,
        display_name: identity.displayName,
      },
      credentials_storage: 'mail_credentials',
    }

    let accountId: string
    if (existing?.id) {
      accountId = existing.id as string
      const { error: updateError } = await supabaseAdmin
        .from('mail_accounts')
        .update({
          display_name: identity.displayName,
          identity_group: state.identityGroup,
          status: 'connected',
          disconnected_at: null,
          sync_error: null,
          sync_failure_count: 0,
          sync_retry_after: null,
          sync_error_kind: null,
          provider_metadata: providerMetadata,
          updated_at: nowIso,
        })
        .eq('id', existing.id)

      if (updateError) throw updateError
    } else {
      const { data: insertedAccount, error: insertError } = await supabaseAdmin
        .from('mail_accounts')
        .insert({
          user_id: state.userId,
          provider,
          address: identity.email,
          display_name: identity.displayName,
          identity_group: state.identityGroup,
          status: 'connected',
          provider_metadata: providerMetadata,
          connected_at: nowIso,
          created_at: nowIso,
          updated_at: nowIso,
        })
        .select('id')
        .single()

      if (insertError) throw insertError
      accountId = insertedAccount.id as string
    }

    const existingCredential = await getMailboxCredential(state.userId, accountId, provider)
    const credentialId = await upsertMailboxCredential(state.userId, accountId, provider, {
      provider,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken || existingCredential?.refreshToken || null,
      expiresAt: token.expiresAt,
      scope: token.scope || existingCredential?.scope || null,
    })

    const { error: refUpdateError } = await supabaseAdmin
      .from('mail_accounts')
      .update({
        credentials_ref: credentialId,
        updated_at: nowIso,
      })
      .eq('id', accountId)
      .eq('user_id', state.userId)

    if (refUpdateError) throw refUpdateError

    await supabaseAdmin
      .from('mail_audit_events')
      .insert({
        user_id: state.userId,
        account_id: accountId,
        actor: 'oauth_callback',
        operation: 'connect_account_oauth',
        target_type: 'mail_account',
        target_id: accountId,
        outcome: 'success',
      })

    try {
      await ensureDefaultMailboxAutomationSetup(state.userId)
    } catch (seedErr) {
      // Non-critical: the account connected successfully even if default rule seeding failed.
      console.warn('[mailbox-oauth] default automation seeding failed:', safeErrorMessage(seedErr))
    }

    return res.redirect(getMailboxSuccessRedirect())
  } catch (err) {
    // safeErrorMessage() masks everything in production, so log the real cause here (server-side
    // only) and hand the user a reference they can quote when reporting the failure.
    const reference = randomUUID().slice(0, 8)
    console.error('[mailbox-oauth] callback failure', {
      provider,
      reference,
      reason: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    })
    return res.redirect(getMailboxErrorRedirect(`${safeErrorMessage(err)} (ref ${reference})`))
  }
}

router.get('/oauth/:provider/callback', async (req, res: Response) => {
  return handleOAuthCallback(req, res)
})

router.post('/oauth/:provider/callback', async (req, res: Response) => {
  return handleOAuthCallback(req, res)
})

router.get('/accounts', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const accounts = await getUserAccounts(req.userId!)
    res.json({ accounts })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.post('/accounts', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const providerRaw = sanitizeString(req.body.provider, 20)
    const addressRaw = sanitizeString(req.body.address, 320)
    const displayNameRaw = sanitizeString(req.body.display_name, 120)
    const identityGroupRaw = sanitizeString(req.body.identity_group, 40) || 'personal'
    const imapHostRaw = sanitizeString(req.body.imap_host ?? req.body.imapHost, 255)
    const imapUsernameRaw = sanitizeString(req.body.imap_username ?? req.body.imapUsername, 320)
    const imapPasswordRaw = sanitizeString(req.body.imap_password ?? req.body.imapPassword, 512)
    const imapMailboxRaw = sanitizeString(req.body.imap_mailbox ?? req.body.imapMailbox, 80) || null
    const imapSecurityRaw = sanitizeString(req.body.imap_security ?? req.body.imapSecurity, 20)
    const imapPortCandidate = Number(req.body.imap_port ?? req.body.imapPort)
    const imapPortRaw = Number.isFinite(imapPortCandidate) ? Math.floor(imapPortCandidate) : null

    if (!providerRaw || !['gmail', 'outlook', 'imap'].includes(providerRaw)) {
      return res.status(400).json({ error: 'provider must be gmail, outlook, or imap' })
    }

    if (providerRaw !== 'imap' && (!addressRaw || !EMAIL_RE.test(addressRaw.toLowerCase()))) {
      return res.status(400).json({ error: 'A valid email address is required' })
    }

    if (providerRaw === 'imap') {
      if (!imapHostRaw || !imapUsernameRaw || !imapPasswordRaw || !imapPortRaw) {
        return res.status(400).json({
          error: 'IMAP requires imap_host, imap_port, imap_username, and imap_password',
        })
      }

      if (imapSecurityRaw !== 'ssl' && imapSecurityRaw !== 'starttls') {
        return res.status(400).json({
          error: 'IMAP security must be ssl or starttls; unencrypted IMAP connections are not supported',
        })
      }
    }

    const accountAddress = providerRaw === 'imap'
      ? (addressRaw || imapUsernameRaw || imapHostRaw || `imap-${randomUUID().slice(0, 8)}`)
      : addressRaw!.toLowerCase()
    const storedAddress = providerRaw === 'imap' ? accountAddress : accountAddress.toLowerCase()

    const providerMetadata = providerRaw === 'imap'
      ? {
          connection_type: 'manual_imap',
          imap: {
            host: imapHostRaw,
            port: imapPortRaw,
            username: imapUsernameRaw,
            security: imapSecurityRaw,
            mailbox: imapMailboxRaw,
          },
        }
      : {}

    const { data, error } = await supabaseAdmin
      .from('mail_accounts')
      .insert({
        user_id: req.userId,
        provider: providerRaw,
        address: storedAddress,
        display_name: displayNameRaw || null,
        identity_group: identityGroupRaw,
        status: 'connected',
        provider_metadata: providerMetadata,
      })
      .select('id, user_id, provider, address, display_name, identity_group, status, connected_at, last_synced_at, sync_error')
      .single()

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'This account is already connected' })
      }
      throw error
    }

    if (providerRaw === 'imap') {
      const credentialId = await upsertMailboxCredential(req.userId!, data.id, 'imap', {
        provider: 'imap',
        username: imapUsernameRaw!,
        password: imapPasswordRaw!,
        host: imapHostRaw!,
        port: imapPortRaw!,
        security: imapSecurityRaw as 'ssl' | 'starttls',
        mailbox: imapMailboxRaw,
      })

      const { error: credentialRefError } = await supabaseAdmin
        .from('mail_accounts')
        .update({
          credentials_ref: credentialId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', data.id)
        .eq('user_id', req.userId!)

      if (credentialRefError) throw credentialRefError
    }

    await writeAuditEvent(req.userId!, 'user', 'connect_account', 'mail_account', data.id, 'success', undefined, data.id)

    try {
      await ensureDefaultMailboxAutomationSetup(req.userId!)
    } catch (seedErr) {
      // Non-critical: the account connected successfully even if default rule seeding failed.
      console.warn('[mailbox] default automation seeding failed:', safeErrorMessage(seedErr))
    }

    res.status(201).json({ account: data })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.put('/accounts/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const accountId = sanitizeUUID(req.params.id)
    if (!accountId) return res.status(400).json({ error: 'Invalid account id' })

    const account = await getOwnedAccount(req.userId!, accountId)
    if (!account) return res.status(404).json({ error: 'Account not found' })

    const displayNameRaw = sanitizeString(req.body.display_name, 120)
    const identityGroupRaw = sanitizeString(req.body.identity_group, 40)

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if (displayNameRaw !== null) {
      updates.display_name = displayNameRaw || null
    }

    if (identityGroupRaw !== null) {
      updates.identity_group = identityGroupRaw || account.identity_group
    }

    if (req.body?.quick_sync_max_messages !== undefined) {
      const quickSyncMaxMessages = Number(req.body.quick_sync_max_messages)
      if (!Number.isInteger(quickSyncMaxMessages) || quickSyncMaxMessages < 25 || quickSyncMaxMessages > 500) {
        return res.status(400).json({ error: 'quick_sync_max_messages must be an integer from 25 to 500' })
      }
      updates.quick_sync_max_messages = quickSyncMaxMessages
    }

    const quickSyncSourceInputs = {
      quickSyncIncludeInbox: req.body?.quick_sync_include_inbox,
      quickSyncIncludeSent: req.body?.quick_sync_include_sent,
      quickSyncIncludeTrash: req.body?.quick_sync_include_trash,
      quickSyncIncludeSpam: req.body?.quick_sync_include_spam,
      quickSyncIncludeArchived: req.body?.quick_sync_include_archived,
    }
    if (Object.values(quickSyncSourceInputs).some((value) => value !== undefined)) {
      const currentOptions = account.sync_options || {}
      const resolveQuickSource = (
        input: unknown,
        quickKey: keyof MailboxSavedSyncOptions,
        importKey: keyof MailboxProviderSyncOptions,
        fallback: boolean,
      ) => parseBooleanInput(
        input,
        typeof currentOptions[quickKey] === 'boolean'
          ? currentOptions[quickKey] as boolean
          : parseBooleanInput(currentOptions[importKey], fallback),
      )
      const nextQuickSources = {
        quickSyncIncludeInbox: resolveQuickSource(quickSyncSourceInputs.quickSyncIncludeInbox, 'quickSyncIncludeInbox', 'includeInbox', DEFAULT_SYNC_OPTIONS.includeInbox),
        quickSyncIncludeSent: resolveQuickSource(quickSyncSourceInputs.quickSyncIncludeSent, 'quickSyncIncludeSent', 'includeSent', DEFAULT_SYNC_OPTIONS.includeSent),
        quickSyncIncludeTrash: resolveQuickSource(quickSyncSourceInputs.quickSyncIncludeTrash, 'quickSyncIncludeTrash', 'includeTrash', DEFAULT_SYNC_OPTIONS.includeTrash),
        quickSyncIncludeSpam: resolveQuickSource(quickSyncSourceInputs.quickSyncIncludeSpam, 'quickSyncIncludeSpam', 'includeSpam', DEFAULT_SYNC_OPTIONS.includeSpam),
        quickSyncIncludeArchived: resolveQuickSource(quickSyncSourceInputs.quickSyncIncludeArchived, 'quickSyncIncludeArchived', 'includeArchived', DEFAULT_SYNC_OPTIONS.includeArchived),
      }
      if (!Object.values(nextQuickSources).some(Boolean)) {
        return res.status(400).json({ error: 'Quick Sync must include at least one mail source' })
      }
      updates.sync_options = { ...currentOptions, ...nextQuickSources }
    }

    const importSourceInputs = {
      includeInbox: req.body?.include_inbox,
      includeSent: req.body?.include_sent,
      includeTrash: req.body?.include_trash,
      includeSpam: req.body?.include_spam,
      includeArchived: req.body?.include_archived,
    }
    if (Object.values(importSourceInputs).some((value) => value !== undefined)) {
      const currentOptions = (updates.sync_options || account.sync_options || {}) as MailboxSavedSyncOptions
      const nextImportSources = {
        includeInbox: parseBooleanInput(importSourceInputs.includeInbox, currentOptions.includeInbox ?? DEFAULT_SYNC_OPTIONS.includeInbox),
        includeSent: parseBooleanInput(importSourceInputs.includeSent, currentOptions.includeSent ?? DEFAULT_SYNC_OPTIONS.includeSent),
        includeTrash: parseBooleanInput(importSourceInputs.includeTrash, currentOptions.includeTrash ?? DEFAULT_SYNC_OPTIONS.includeTrash),
        includeSpam: parseBooleanInput(importSourceInputs.includeSpam, currentOptions.includeSpam ?? DEFAULT_SYNC_OPTIONS.includeSpam),
        includeArchived: parseBooleanInput(importSourceInputs.includeArchived, currentOptions.includeArchived ?? DEFAULT_SYNC_OPTIONS.includeArchived),
      }
      if (!Object.values(nextImportSources).some(Boolean)) {
        return res.status(400).json({ error: 'Import Settings must include at least one mail source' })
      }
      updates.sync_options = { ...currentOptions, ...nextImportSources }
    }

    const { data, error } = await supabaseAdmin
      .from('mail_accounts')
      .update(updates)
      .eq('id', accountId)
      .eq('user_id', req.userId!)
      .select('id, user_id, provider, address, display_name, identity_group, status, is_primary, connected_at, last_sent_at, quick_sync_after, quick_sync_max_messages, last_synced_at, sync_error, sync_error_kind, sync_options')
      .single()

    if (error) throw error

    await writeAuditEvent(req.userId!, 'user', 'update_account', 'mail_account', accountId, 'success', undefined, accountId)

    res.json({ account: data })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.put('/accounts/:id/primary', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const accountId = sanitizeUUID(req.params.id)
    if (!accountId) return res.status(400).json({ error: 'Invalid account id' })

    const account = await getOwnedAccount(req.userId!, accountId)
    if (!account) return res.status(404).json({ error: 'Account not found' })

    if (typeof req.body?.is_primary !== 'boolean') {
      return res.status(400).json({ error: 'is_primary must be a boolean' })
    }

    const isPrimary = req.body.is_primary
    const nowIso = new Date().toISOString()
    if (isPrimary) {
      const { error: clearError } = await supabaseAdmin
        .from('mail_accounts')
        .update({ is_primary: false, updated_at: nowIso })
        .eq('user_id', req.userId!)
        .eq('is_primary', true)
      if (clearError) throw clearError
    }

    const { data, error } = await supabaseAdmin
      .from('mail_accounts')
      .update({ is_primary: isPrimary, updated_at: nowIso })
      .eq('id', accountId)
      .eq('user_id', req.userId!)
      .select('id, user_id, provider, address, display_name, identity_group, status, is_primary, connected_at, last_sent_at, last_synced_at, sync_error, sync_error_kind, sync_options')
      .single()
    if (error) throw error

    await writeAuditEvent(
      req.userId!,
      'user',
      isPrimary ? 'make_primary_account' : 'remove_primary_account',
      'mail_account',
      accountId,
      'success',
      undefined,
      accountId,
    )

    res.json({ account: data })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.post('/accounts/:id/reset-cursor', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const accountId = sanitizeUUID(req.params.id)
    if (!accountId) return res.status(400).json({ error: 'Invalid account id' })

    const account = await getOwnedAccount(req.userId!, accountId)
    if (!account) return res.status(404).json({ error: 'Account not found' })

    // Reset the sync cursor to force fresh sync of all emails
    await supabaseAdmin
      .from('mail_sync_cursors')
      .update({ cursor: null, last_error: null, updated_at: new Date().toISOString() })
      .eq('account_id', accountId)
      .eq('resource_type', 'messages')

    await writeAuditEvent(req.userId!, 'user', 'reset_cursor', 'mail_account', accountId, 'success', 'Manual cursor reset', accountId)

    // The re-fetch window is the account's saved daysBack (same parse as POST /accounts/:id/sync).
    const resetDaysBack = parseIntegerInput((account.sync_options || {}).daysBack, DEFAULT_SYNC_OPTIONS.daysBack, 1, 365)
    res.json({
      success: true,
      days_back: resetDaysBack,
      message: `Sync cursor reset. The next sync will re-fetch emails from the past ${resetDaysBack} ${resetDaysBack === 1 ? 'day' : 'days'}.`,
    })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.post('/accounts/:id/disconnect', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const accountId = sanitizeUUID(req.params.id)
    if (!accountId) return res.status(400).json({ error: 'Invalid account id' })

    const account = await getOwnedAccount(req.userId!, accountId)
    if (!account) return res.status(404).json({ error: 'Account not found' })

    await purgeDisconnectedAccountMailData(req.userId!, accountId)

    await writeAuditEvent(
      req.userId!,
      'user',
      'disconnect_account',
      'mail_account',
      accountId,
      'success',
      'Purged synced mailbox data; preserved user tags, rules, and preferences',
      accountId,
    )

    res.json({
      success: true,
      preserved: ['mailbox_tags', 'mail_rules', 'mail_user_preferences'],
      purged: ['mail_credentials', 'mail_messages', 'mail_threads', 'mail_folders', 'mail_labels', 'mail_sync_cursors', 'mail_drafts'],
    })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.get('/accounts/:id/removal-preview', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const accountId = sanitizeUUID(req.params.id)
    if (!accountId) return res.status(400).json({ error: 'Invalid account id' })

    const account = await getOwnedAccount(req.userId!, accountId)
    if (!account) return res.status(404).json({ error: 'Account not found' })

    const countRows = async (tableName: string): Promise<number> => {
      const { count, error } = await supabaseAdmin
        .from(tableName)
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)

      if (error) throw error
      return count || 0
    }

    const [messages, threads, drafts] = await Promise.all([
      countRows('mail_messages'),
      countRows('mail_threads'),
      countRows('mail_drafts'),
    ])

    res.json({ address: account.address, messages, threads, drafts })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.delete('/accounts/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const accountId = sanitizeUUID(req.params.id)
    if (!accountId) return res.status(400).json({ error: 'Invalid account id' })

    const account = await getOwnedAccount(req.userId!, accountId)
    if (!account) return res.status(404).json({ error: 'Account not found' })

    // Audit first: mail_audit_events.account_id is set to NULL once the account row is gone.
    await writeAuditEvent(
      req.userId!,
      'user',
      'remove_account',
      'mail_account',
      accountId,
      'success',
      'Removed account and all synced mailbox data; preserved user tags, rules, and preferences',
      accountId,
    )

    await purgeDisconnectedAccountMailData(req.userId!, accountId)

    const { error } = await supabaseAdmin
      .from('mail_accounts')
      .delete()
      .eq('id', accountId)
      .eq('user_id', req.userId!)

    if (error) throw error

    res.json({
      success: true,
      preserved: ['mailbox_tags', 'mail_rules', 'mail_user_preferences'],
      removed: ['mail_accounts', 'mail_credentials', 'mail_messages', 'mail_threads', 'mail_folders', 'mail_labels', 'mail_sync_cursors', 'mail_drafts'],
    })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.post('/accounts/:id/sync', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const accountId = sanitizeUUID(req.params.id)
    if (!accountId) {
      console.error(`[MAILBOX-API] Invalid account ID`)
      return res.status(400).json({ error: 'Invalid account id' })
    }

    const account = await getOwnedAccount(req.userId!, accountId)
    if (!account) {
      console.error(`[MAILBOX-API] Account not found or not owned by user`)
      return res.status(404).json({ error: 'Account not found' })
    }

    const newMailOnly = parseBooleanInput(req.body?.new_mail_only ?? req.body?.newMailOnly, false)
    const resetCursor = parseBooleanInput(req.body?.reset_cursor ?? req.body?.resetCursor, false)
    const savedOptions = account.sync_options || {}
    const maxMessages = parseIntegerInput(
      req.body?.max_messages ?? req.body?.maxMessages,
      newMailOnly ? account.quick_sync_max_messages : DEFAULT_SYNC_OPTIONS.maxMessages,
      25,
      500,
    )
    const daysBack = parseIntegerInput(
      req.body?.days_back ?? req.body?.daysBack,
      parseIntegerInput(savedOptions.daysBack, DEFAULT_SYNC_OPTIONS.daysBack, 1, 365),
      1,
      365,
    )
    const savedSourceOption = (quickKey: keyof MailboxSavedSyncOptions, importKey: keyof MailboxProviderSyncOptions, fallback: boolean) => (
      newMailOnly && typeof savedOptions[quickKey] === 'boolean'
        ? savedOptions[quickKey] as boolean
        : parseBooleanInput(savedOptions[importKey], fallback)
    )
    const includeInbox = parseBooleanInput(req.body?.include_inbox ?? req.body?.includeInbox, savedSourceOption('quickSyncIncludeInbox', 'includeInbox', DEFAULT_SYNC_OPTIONS.includeInbox))
    const includeSent = parseBooleanInput(req.body?.include_sent ?? req.body?.includeSent, savedSourceOption('quickSyncIncludeSent', 'includeSent', DEFAULT_SYNC_OPTIONS.includeSent))
    const includeTrash = parseBooleanInput(req.body?.include_trash ?? req.body?.includeTrash, savedSourceOption('quickSyncIncludeTrash', 'includeTrash', DEFAULT_SYNC_OPTIONS.includeTrash))
    const includeSpam = parseBooleanInput(req.body?.include_spam ?? req.body?.includeSpam, savedSourceOption('quickSyncIncludeSpam', 'includeSpam', DEFAULT_SYNC_OPTIONS.includeSpam))
    const includeArchived = parseBooleanInput(req.body?.include_archived ?? req.body?.includeArchived, savedSourceOption('quickSyncIncludeArchived', 'includeArchived', DEFAULT_SYNC_OPTIONS.includeArchived))
    const syncOptions: MailboxProviderSyncOptions = {
      maxMessages,
      daysBack,
      includeInbox,
      includeSent,
      includeTrash,
      includeSpam,
      includeArchived,
      newMailOnly: false,
    }

    // The lightweight "check for new mail" ping (new_mail_only) fires automatically on every
    // page load/visibility change and defaults maxMessages/daysBack when the client's per-account
    // config hasn't hydrated yet -- persisting those defaults here would silently clobber a
    // user's configured history depth (e.g. 62 days -> 1 day) without them touching the settings.
    if (!newMailOnly) {
      const { error: syncOptionsError } = await supabaseAdmin
        .from('mail_accounts')
        .update({ sync_options: { ...savedOptions, ...syncOptions }, updated_at: new Date().toISOString() })
        .eq('id', accountId)
        .eq('user_id', req.userId!)

      if (syncOptionsError) throw syncOptionsError
    }

    // Reset cursor if requested (for recovering from stuck state)
    if (resetCursor) {
      await supabaseAdmin
        .from('mail_sync_cursors')
        .update({ cursor: null, updated_at: new Date().toISOString() })
        .eq('account_id', accountId)
        .eq('resource_type', 'messages')
    }

    const summary = await runMailboxAccountSync(accountId, req.userId!, 'user', {
      ...syncOptions,
      newMailOnly,
      quickSyncAfter: account.quick_sync_after,
    })

    res.json({
      success: summary.status === 'connected',
      status: summary.status,
      last_synced_at: summary.lastSyncedAt,
      inserted_messages: summary.insertedMessages,
      updated_messages: summary.updatedMessages,
      new_message_count: summary.newMessageProviderIds.length,
      cursor: summary.cursor,
      invitations_parsed: summary.invitationsParsed,
      invitations_changed: summary.invitationsChanged,
      automation: summary.automation,
      error: summary.error || null,
    })
  } catch (err) {
    console.error(`[MAILBOX-API] ERROR in /accounts/:id/sync:`, err instanceof Error ? err.message : String(err))
    console.error(err)
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── Messages and Threads ────────────────────────────────────────────────────

function getSystemMessageTags(message: MailMessageRow, account: MailAccountRow): string[] {
  const tags: string[] = []
  if (!message.is_read) tags.push('Unread')
  if (message.is_archived) tags.push('Archived')
  if (isProviderMessageSent(account.provider, message.provider_metadata)) tags.push('Sent')
  if (isProviderMessageTrashed(account.provider, message.provider_metadata)) tags.push('Trash')
  if (isProviderMessageJunk(account.provider, message.provider_metadata)) tags.push('Junk')
  if (message.has_attachments) tags.push('Has attachments')
  return tags
}

router.get('/messages/:id/activity', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const messageId = sanitizeUUID(req.params.id)
    if (!messageId) return res.status(400).json({ error: 'Invalid message id' })

    const accounts = await getUserAccounts(req.userId!)
    const accountById = new Map(accounts.map((account) => [account.id, account]))
    if (accountById.size === 0) return res.status(404).json({ error: 'Message not found' })

    const { data: messageRow, error: messageError } = await supabaseAdmin
      .from('mail_messages')
      .select('id, account_id, received_at, is_read, is_archived, has_attachments, provider_metadata')
      .eq('id', messageId)
      .in('account_id', Array.from(accountById.keys()))
      .maybeSingle()
    if (messageError) throw messageError
    if (!messageRow) return res.status(404).json({ error: 'Message not found' })

    const message = messageRow as MailMessageRow
    const account = accountById.get(message.account_id)
    if (!account) return res.status(404).json({ error: 'Message not found' })

    const { data: eventRows, error: eventsError } = await supabaseAdmin
      .from('mail_action_events')
      .select('id, action, action_value, source_type, source_rule_id, chain_id, depth, created_at')
      .eq('message_id', messageId)
      .eq('user_id', req.userId!)
      .order('created_at', { ascending: true })
      .order('depth', { ascending: true })
    if (eventsError) throw eventsError

    const events = (eventRows || []) as Array<{
      id: string
      action: string
      action_value: string | null
      source_type: 'manual' | 'rule' | 'import'
      source_rule_id: string | null
      chain_id: string
      depth: number
      created_at: string
    }>
    const { data: preferencesRow, error: preferencesError } = await supabaseAdmin
      .from('mail_user_preferences')
      .select('mailbox_tags')
      .eq('user_id', req.userId!)
      .maybeSingle()
    if (preferencesError) throw preferencesError
    const tagLabelById = new Map(
      normalizeMailboxTagList(
        (preferencesRow as Pick<MailUserPreferencesRow, 'mailbox_tags'> | null)?.mailbox_tags || []
      ).map((tag) => [tag.id, tag.label])
    )
    const ruleIds = events
      .map((event) => event.source_rule_id)
      .filter((ruleId): ruleId is string => Boolean(ruleId))
    const ruleNameById = new Map<string, string>()
    if (ruleIds.length > 0) {
      const { data: ruleRows, error: rulesError } = await supabaseAdmin
        .from('mail_rules')
        .select('id, name')
        .eq('user_id', req.userId!)
        .in('id', ruleIds)
      if (rulesError) throw rulesError
      for (const rule of (ruleRows || []) as Array<{ id: string; name: string }>) {
        ruleNameById.set(rule.id, rule.name)
      }
    }

    res.json({
      arrived_at: message.received_at,
      system_tags: getSystemMessageTags(message, account),
      events: events.map((event) => ({
        ...event,
        action_value:
          (event.action === 'add_tag' || event.action === 'remove_tag') && event.action_value
            ? tagLabelById.get(event.action_value) || event.action_value
            : event.action_value,
        rule_name: event.source_rule_id ? ruleNameById.get(event.source_rule_id) || 'Deleted automation' : null,
      })),
    })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// The list endpoint must NOT select the whole `provider_metadata` column: it stores the
// raw provider payload (Gmail format=full, including base64 message bodies), so pulling it
// for a few hundred rows transfers hundreds of MB and intermittently trips the Postgres
// statement timeout, surfacing as a 500 on GET /api/mailbox/messages.
// Only the JSON sub-fields the response actually derives are selected here.
const MAILBOX_MESSAGE_LIST_SELECT = [
  'id',
  'account_id',
  'thread_id',
  'subject',
  'from_email',
  'from_name',
  'to_emails',
  'cc_emails',
  'bcc_emails',
  'received_at',
  'preview',
  'is_read',
  'is_archived',
  'has_attachments',
  'meta_user_tag_ids:provider_metadata->user_tag_ids',
  'meta_provider_sent:provider_metadata->provider_sent',
  'meta_provider_trashed:provider_metadata->provider_trashed',
  'meta_provider_junk:provider_metadata->provider_junk',
  'meta_label_ids:provider_metadata->provider_message->labelIds',
  'meta_provider_folder:provider_metadata->provider_message->provider_folder',
  'meta_gmail_headers:provider_metadata->provider_message->payload->headers',
  'meta_outlook_to:provider_metadata->provider_message->toRecipients',
  'meta_outlook_cc:provider_metadata->provider_message->ccRecipients',
  'meta_outlook_bcc:provider_metadata->provider_message->bccRecipients',
].join(', ')

interface MailboxMessageListRow {
  id: string
  account_id: string
  thread_id: string | null
  subject: string | null
  from_email: string | null
  from_name: string | null
  to_emails: string | null
  cc_emails: string | null
  bcc_emails: string | null
  received_at: string | null
  preview: string | null
  is_read: boolean
  is_archived: boolean
  has_attachments: boolean
  meta_user_tag_ids: unknown
  meta_provider_sent: unknown
  meta_provider_trashed: unknown
  meta_provider_junk: unknown
  meta_label_ids: unknown
  meta_provider_folder: unknown
  meta_gmail_headers: unknown
  meta_outlook_to: unknown
  meta_outlook_cc: unknown
  meta_outlook_bcc: unknown
}

// Rebuilds the minimal `provider_metadata` shape the extract/isProvider* helpers expect.
function toMailboxMessageListEntry(row: MailboxMessageListRow) {
  const {
    meta_user_tag_ids,
    meta_provider_sent,
    meta_provider_trashed,
    meta_provider_junk,
    meta_label_ids,
    meta_provider_folder,
    meta_gmail_headers,
    meta_outlook_to,
    meta_outlook_cc,
    meta_outlook_bcc,
    ...rest
  } = row

  return {
    ...rest,
    meta: {
      user_tag_ids: meta_user_tag_ids,
      provider_sent: meta_provider_sent,
      provider_trashed: meta_provider_trashed,
      provider_junk: meta_provider_junk,
      provider_message: {
        labelIds: meta_label_ids,
        provider_folder: meta_provider_folder,
        payload: { headers: meta_gmail_headers },
        toRecipients: meta_outlook_to,
        ccRecipients: meta_outlook_cc,
        bccRecipients: meta_outlook_bcc,
      },
    } as Record<string, unknown>,
  }
}

router.get('/messages', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const accounts = await getUserAccounts(req.userId!)
    const connectedAccounts = accounts.filter(account => account.status !== 'disconnected')
    const accountIds = connectedAccounts.map(account => account.id)

    if (accountIds.length === 0) {
      return res.json({ messages: [], total: 0 })
    }

    const accountIdFilter = sanitizeUUID(req.query.accountId)
    const groupFilter = sanitizeString(req.query.group, 40)
    const q = sanitizeString(req.query.q, 100)
    const includeArchived = isTruthy(typeof req.query.includeArchived === 'string' ? req.query.includeArchived : undefined)
    const limit = Math.min(MAILBOX_MESSAGES_LIMIT_MAX, Math.max(1, parseIntegerInput(req.query.limit, 30, 1, MAILBOX_MESSAGES_LIMIT_MAX)))
    const page = Math.max(1, parseIntegerInput(req.query.page, 1, 1, 1000))
    const offset = parseIntegerInput(req.query.offset, (page - 1) * limit, 0, 10000)

    let candidateAccountIds = accountIds
    if (accountIdFilter && candidateAccountIds.includes(accountIdFilter)) {
      candidateAccountIds = [accountIdFilter]
    } else if (groupFilter) {
      candidateAccountIds = connectedAccounts
        .filter(account => account.identity_group.toLowerCase() === groupFilter.toLowerCase())
        .map(account => account.id)
    }

    if (candidateAccountIds.length === 0) {
      return res.json({ messages: [], total: 0 })
    }

    // 'planned' uses the query planner's estimate instead of a full COUNT(*) scan on each request --
    // the frontend calls this endpoint repeatedly with a growing limit while incrementally
    // loading messages, so an exact count here previously caused statement timeouts (57014)
    // once a mailbox grew large.
    let query = supabaseAdmin
      .from('mail_messages')
      .select(MAILBOX_MESSAGE_LIST_SELECT, { count: 'planned' })
      .in('account_id', candidateAccountIds)

    if (!includeArchived) {
      query = query.eq('is_archived', false)
    }

    if (q) {
      query = query.or(`subject.ilike.%${q}%,from_email.ilike.%${q}%,to_emails.ilike.%${q}%,cc_emails.ilike.%${q}%,bcc_emails.ilike.%${q}%,preview.ilike.%${q}%,body_text.ilike.%${q}%`)
    }

    const { data, error, count } = await query
      .order('received_at', { ascending: false })
      .range(offset, offset + limit - 1)

    // Planned counts can overestimate the end. An out-of-range next page is
    // normal pagination exhaustion, not a server failure.
    if (error?.code === 'PGRST103' && offset > 0) {
      return res.json({ messages: [], total: offset, has_more: false })
    }
    if (error) throw error

    const accountById = new Map(connectedAccounts.map(account => [account.id, account]))
    const messages = ((data || []) as unknown as MailboxMessageListRow[]).map((row) => {
      const account = accountById.get(row.account_id)
      const { meta, ...rest } = toMailboxMessageListEntry(row)
      const toEmails = rest.to_emails || extractRecipientEmailsFromProviderMetadata(meta, 'to')
      const ccEmails = rest.cc_emails || extractRecipientEmailsFromProviderMetadata(meta, 'cc')
      const bccEmails = rest.bcc_emails || extractRecipientEmailsFromProviderMetadata(meta, 'bcc')

      return {
        ...rest,
        to_emails: toEmails,
        cc_emails: ccEmails,
        bcc_emails: bccEmails,
        user_tag_ids: extractUserTagIdsFromProviderMetadata(meta),
        is_provider_trashed: account ? isProviderMessageTrashed(account.provider, meta) : false,
        is_provider_junk: account ? isProviderMessageJunk(account.provider, meta) : false,
        is_provider_sent: account
          ? (
              isProviderMessageSent(account.provider, meta)
              || shouldInferSentFromSender(rest.from_email, account.address)
            )
          : false,
        account: account
          ? {
              id: account.id,
              provider: account.provider,
              address: account.address,
              display_name: account.display_name,
              identity_group: account.identity_group,
            }
          : null,
      }
    })

    res.json({ messages, total: count || 0 })
  } catch (err) {
    console.error('[MAILBOX-API] ERROR in GET /messages:', err)
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.get('/threads/:threadId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const threadId = sanitizeUUID(req.params.threadId)
    if (!threadId) return res.status(400).json({ error: 'Invalid thread id' })

    const accounts = await getUserAccounts(req.userId!)
    const accountIds = accounts.map(account => account.id)

    const { data: thread, error: threadError } = await supabaseAdmin
      .from('mail_threads')
      .select('id, account_id, normalized_subject, latest_message_at, message_count, participants')
      .eq('id', threadId)
      .in('account_id', accountIds)
      .maybeSingle()

    if (threadError) throw threadError
    if (!thread) return res.status(404).json({ error: 'Thread not found' })

    const { data: messages, error: messagesError } = await supabaseAdmin
      .from('mail_messages')
      .select('id, account_id, thread_id, provider_message_id, subject, from_email, from_name, to_emails, cc_emails, bcc_emails, received_at, preview, body_text, body_html_sanitized, is_read, is_archived, has_attachments, provider_metadata')
      .eq('thread_id', threadId)
      .order('received_at', { ascending: true })

    if (messagesError) throw messagesError

    const accountById = new Map(accounts.map(account => [account.id, account]))
    const normalizedMessages = ((messages || []) as MailMessageRow[]).map((message) => {
      const account = accountById.get(message.account_id)
      const { provider_metadata: providerMetadata, ...rest } = message
      const toEmails = message.to_emails || extractRecipientEmailsFromProviderMetadata(providerMetadata, 'to')
      const ccEmails = message.cc_emails || extractRecipientEmailsFromProviderMetadata(providerMetadata, 'cc')
      const bccEmails = message.bcc_emails || extractRecipientEmailsFromProviderMetadata(providerMetadata, 'bcc')
      return {
        ...rest,
        body_html_sanitized: resolveThreadMessageHtml(message.body_html_sanitized, providerMetadata),
        to_emails: toEmails,
        cc_emails: ccEmails,
        bcc_emails: bccEmails,
        user_tag_ids: extractUserTagIdsFromProviderMetadata(providerMetadata),
        is_provider_trashed: account ? isProviderMessageTrashed(account.provider, providerMetadata) : false,
        is_provider_junk: account ? isProviderMessageJunk(account.provider, providerMetadata) : false,
        is_provider_sent: account
          ? (
              isProviderMessageSent(account.provider, providerMetadata)
              || shouldInferSentFromSender(message.from_email, account.address)
            )
          : false,
        reply_to: extractReplyToFromProviderMetadata(providerMetadata),
        encryption_type: extractEncryptionTypeFromProviderMetadata(providerMetadata),
      }
    })

    res.json({ thread: thread as MailThreadRow, messages: normalizedMessages })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

async function loadOwnedMessageWithAccount(userId: string, messageId: string): Promise<{
  account: MailAccountRow
  providerMessageId: string | null
  providerMetadata: unknown
} | null> {
  const accounts = await getUserAccounts(userId)
  const accountIds = accounts.map(account => account.id)
  if (accountIds.length === 0) return null

  const { data: message, error } = await supabaseAdmin
    .from('mail_messages')
    .select('id, account_id, provider_message_id, provider_metadata')
    .eq('id', messageId)
    .in('account_id', accountIds)
    .maybeSingle()

  if (error) throw error
  if (!message) return null

  const account = accounts.find(item => item.id === message.account_id)
  if (!account) return null

  const providerMessageId =
    typeof message.provider_message_id === 'string' && message.provider_message_id
      ? message.provider_message_id
      : extractProviderMessageId(message.provider_metadata)

  return { account, providerMessageId, providerMetadata: message.provider_metadata }
}

router.get('/messages/:id/thread', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const messageId = sanitizeUUID(req.params.id)
    if (!messageId) return res.status(400).json({ error: 'Invalid message id' })

    const accounts = await getUserAccounts(req.userId!)
    const accountIds = accounts.map(account => account.id)
    if (accountIds.length === 0) {
      return res.status(404).json({ error: 'Message not found' })
    }

    const { data: preferencesRow, error: preferencesError } = await supabaseAdmin
      .from('mail_user_preferences')
      .select('mailbox_threading_options')
      .eq('user_id', req.userId!)
      .maybeSingle()
    if (preferencesError) throw preferencesError

    const { data: sourceMessage, error: messageError } = await supabaseAdmin
      .from('mail_messages')
      .select('id, thread_id, account_id, subject, from_email, to_emails, received_at, provider_metadata')
      .eq('id', messageId)
      .in('account_id', accountIds)
      .maybeSingle()

    if (messageError) throw messageError
    if (!sourceMessage) return res.status(404).json({ error: 'Message not found' })

    const threadingOptions = normalizeMailboxThreadingOptions(
      (preferencesRow as Pick<MailUserPreferencesRow, 'mailbox_threading_options'> | null)?.mailbox_threading_options,
    )
    const sourceAccount = accounts.find((account) => account.id === sourceMessage.account_id)
    const sourceIsSelfSent = Boolean(
      sourceAccount
      && (
        isProviderMessageSent(sourceAccount.provider, sourceMessage.provider_metadata)
        || shouldInferSentFromSender(sourceMessage.from_email, sourceAccount.address)
      ),
    )
    // Domain/name matching against your own address (always true for anything you sent)
    // would otherwise bucket every unrelated email you've ever sent into one "thread" --
    // key off the recipient instead when the source message is one of yours.
    const threadingIdentityEmail = sourceIsSelfSent
      ? (sourceMessage.to_emails || '').split(',')[0]?.trim() || sourceMessage.from_email
      : sourceMessage.from_email
    const sourceThreadingMessage = {
      id: sourceMessage.id,
      providerMessageId: sourceMessage.id,
      providerThreadId: null,
      subject: sourceMessage.subject,
      fromEmail: threadingIdentityEmail,
      receivedAt: sourceMessage.received_at,
      replyTo: extractReplyToFromProviderMetadata(sourceMessage.provider_metadata),
    }
    const broadThreadMessageIds = await findBroadThreadMessageIds(
      accountIds,
      sourceThreadingMessage,
      threadingOptions,
    )
    const usesBroadThread = broadThreadMessageIds.length > 1
    const threadId = sourceMessage.thread_id
    if (!threadId) return res.status(400).json({ error: 'Message has no thread' })

    // Now fetch the thread and all its messages
    const { data: thread, error: threadError } = await supabaseAdmin
      .from('mail_threads')
      .select('id, account_id, normalized_subject, latest_message_at, message_count, participants')
      .eq('id', threadId)
      .in('account_id', accountIds)
      .maybeSingle()

    if (threadError) throw threadError
    if (!thread) return res.status(404).json({ error: 'Thread not found' })

    let messagesQuery = supabaseAdmin
      .from('mail_messages')
      .select('id, account_id, thread_id, provider_message_id, subject, from_email, from_name, to_emails, cc_emails, bcc_emails, received_at, preview, body_text, body_html_sanitized, is_read, is_archived, has_attachments, provider_metadata')
    messagesQuery = usesBroadThread
      ? messagesQuery.in('id', broadThreadMessageIds)
      : messagesQuery.eq('thread_id', threadId)
    const { data: messages, error: messagesError } = await messagesQuery.order('received_at', { ascending: true })

    if (messagesError) throw messagesError

    const accountById = new Map(accounts.map(account => [account.id, account]))
    const normalizedMessages = ((messages || []) as MailMessageRow[]).map((message) => {
      const account = accountById.get(message.account_id)
      const { provider_metadata: providerMetadata, ...rest } = message
      const toEmails = message.to_emails || extractRecipientEmailsFromProviderMetadata(providerMetadata, 'to')
      const ccEmails = message.cc_emails || extractRecipientEmailsFromProviderMetadata(providerMetadata, 'cc')
      const bccEmails = message.bcc_emails || extractRecipientEmailsFromProviderMetadata(providerMetadata, 'bcc')
      return {
        ...rest,
        to_emails: toEmails,
        cc_emails: ccEmails,
        bcc_emails: bccEmails,
        user_tag_ids: extractUserTagIdsFromProviderMetadata(providerMetadata),
        is_provider_trashed: account ? isProviderMessageTrashed(account.provider, providerMetadata) : false,
        is_provider_junk: account ? isProviderMessageJunk(account.provider, providerMetadata) : false,
        is_provider_sent: account
          ? (
              isProviderMessageSent(account.provider, providerMetadata)
              || shouldInferSentFromSender(message.from_email, account.address)
            )
          : false,
        reply_to: extractReplyToFromProviderMetadata(providerMetadata),
        encryption_type: extractEncryptionTypeFromProviderMetadata(providerMetadata),
      }
    })

    // Messages are ordered oldest-first. Group by the real thread_id (not the
    // broader domain/name heuristic bag from findBroadThreadMessageIds) before
    // scanning for "the reply" -- otherwise an unrelated later sent message from
    // the same sender/domain would falsely mark an older, unrelated message as replied.
    const messagesByThreadId = new Map<string, typeof normalizedMessages>()
    for (const message of normalizedMessages) {
      const key = message.thread_id || ''
      messagesByThreadId.set(key, [...(messagesByThreadId.get(key) || []), message])
    }
    const replyStatusById = new Map<string, { isReplied: boolean; repliedByMessageId: string | null }>()
    for (const group of messagesByThreadId.values()) {
      group.forEach((message, index) => {
        const repliedByMessage = group.slice(index + 1).find((candidate) => candidate.is_provider_sent)
        replyStatusById.set(message.id, {
          isReplied: Boolean(repliedByMessage),
          repliedByMessageId: repliedByMessage?.id || null,
        })
      })
    }
    const messagesWithReplyStatus = normalizedMessages.map((message) => ({
      ...message,
      is_replied: replyStatusById.get(message.id)?.isReplied ?? false,
      replied_by_message_id: replyStatusById.get(message.id)?.repliedByMessageId ?? null,
    }))

    res.json({ thread: thread as MailThreadRow, messages: messagesWithReplyStatus })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.get('/messages/:id/attachments', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const messageId = sanitizeUUID(req.params.id)
    if (!messageId) return res.status(400).json({ error: 'Invalid message id' })

    const loaded = await loadOwnedMessageWithAccount(req.userId!, messageId)
    if (!loaded) return res.status(404).json({ error: 'Message not found' })

    if (loaded.account.provider === 'outlook') {
      if (!loaded.providerMessageId) return res.json({ attachments: [] })
      const attachments = await listOutlookAttachments(loaded.account, loaded.providerMessageId)
      return res.json({ attachments })
    }

    res.json({ attachments: listGmailAttachments(loaded.providerMetadata) })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.get('/messages/:id/attachments/:attachmentRef/download', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const messageId = sanitizeUUID(req.params.id)
    if (!messageId) return res.status(400).json({ error: 'Invalid message id' })

    // Express already URL-decodes route params
    const attachmentRef = req.params.attachmentRef || ''
    if (!/^(id|part):/.test(attachmentRef) || attachmentRef.length > 2100) {
      return res.status(400).json({ error: 'Invalid attachment reference' })
    }

    const loaded = await loadOwnedMessageWithAccount(req.userId!, messageId)
    if (!loaded) return res.status(404).json({ error: 'Message not found' })
    if (!loaded.providerMessageId) return res.status(400).json({ error: 'Message does not have a provider message id' })

    const download = loaded.account.provider === 'outlook'
      ? await downloadOutlookAttachment(loaded.account, loaded.providerMessageId, attachmentRef)
      : await downloadGmailAttachment(loaded.account, loaded.providerMessageId, loaded.providerMetadata, attachmentRef)

    if (!download) return res.status(404).json({ error: 'Attachment not found' })
    if (download.content.byteLength > MAX_ATTACHMENT_DOWNLOAD_BYTES) {
      return res.status(413).json({ error: 'Attachment exceeds the 25 MB download limit' })
    }

    const asciiFilename = download.filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'")
    res.setHeader('Content-Type', download.mimeType.replace(/[\r\n]/g, ''))
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Length', String(download.content.byteLength))
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(download.filename)}`,
    )
    res.send(download.content)
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.post('/messages/:id/read', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const messageId = sanitizeUUID(req.params.id)
    if (!messageId) return res.status(400).json({ error: 'Invalid message id' })

    const isRead = req.body.is_read !== false

    const accounts = await getUserAccounts(req.userId!)
    const accountIds = accounts.map(account => account.id)
    const accountById = new Map(accounts.map(account => [account.id, account]))

    const { data: message, error: lookupError } = await supabaseAdmin
      .from('mail_messages')
      .select('id, account_id, provider_message_id, provider_metadata')
      .eq('id', messageId)
      .in('account_id', accountIds)
      .maybeSingle()

    if (lookupError) throw lookupError
    if (!message) return res.status(404).json({ error: 'Message not found' })

    const account = accountById.get(message.account_id)
    if (!account) return res.status(404).json({ error: 'Mailbox account not found for message' })

    const providerMessageId =
      typeof message.provider_message_id === 'string' && message.provider_message_id
        ? message.provider_message_id
        : extractProviderMessageId(message.provider_metadata)

    if (!providerMessageId) {
      return res.status(400).json({ error: 'Message does not have a provider message id' })
    }

    try {
      await setProviderMessageReadState(account, providerMessageId, isRead)
    } catch (providerError) {
      await writeAuditEvent(
        req.userId!,
        'user',
        'mark_read',
        'mail_message',
        messageId,
        'failure',
        safeErrorMessage(providerError),
        message.account_id,
      )
    }

    const { error } = await supabaseAdmin
      .from('mail_messages')
      .update({ is_read: isRead, updated_at: new Date().toISOString() })
      .eq('id', messageId)

    if (error) throw error

    await writeAuditEvent(req.userId!, 'user', 'mark_read', 'mail_message', messageId, 'success', undefined, message.account_id)

    await handleManualMailboxAction(req.userId!, message.account_id, messageId, isRead ? 'mark_read' : 'mark_unread')

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.post('/messages/:id/archive', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const messageId = sanitizeUUID(req.params.id)
    if (!messageId) return res.status(400).json({ error: 'Invalid message id' })

    const isArchived = req.body.is_archived !== false

    const accounts = await getUserAccounts(req.userId!)
    const accountById = new Map(accounts.map(account => [account.id, account]))
    const accountIds = accounts.map(account => account.id)

    const { data: message, error: lookupError } = await supabaseAdmin
      .from('mail_messages')
      .select('id, account_id, provider_message_id, provider_metadata')
      .eq('id', messageId)
      .in('account_id', accountIds)
      .maybeSingle()

    if (lookupError) throw lookupError
    if (!message) return res.status(404).json({ error: 'Message not found' })

    const account = accountById.get(message.account_id)
    if (!account) return res.status(404).json({ error: 'Mailbox account not found for message' })

    const providerMessageId =
      typeof message.provider_message_id === 'string' && message.provider_message_id
        ? message.provider_message_id
        : extractProviderMessageId(message.provider_metadata)

    if (!providerMessageId) {
      return res.status(400).json({ error: 'Message does not have a provider message id' })
    }

    let alreadyGoneRemotely = false
    try {
      await setProviderMessageArchivedState(account, providerMessageId, isArchived)
    } catch (moveError) {
      if (!(moveError instanceof ProviderItemGoneError)) throw moveError
      // Provider says the item no longer exists (deleted/moved outside this app) -- sync local state instead of erroring forever.
      alreadyGoneRemotely = true
    }

    const providerMetadata = (message.provider_metadata && typeof message.provider_metadata === 'object')
      ? { ...(message.provider_metadata as Record<string, unknown>) }
      : {}

    const providerMessage = providerMetadata.provider_message
    if (providerMessage && typeof providerMessage === 'object') {
      const messageObject = { ...(providerMessage as Record<string, unknown>) }
      const existingLabels = Array.isArray(messageObject.labelIds) ? messageObject.labelIds : []
      const labelSet = new Set(existingLabels.filter((value): value is string => typeof value === 'string'))
      if (isArchived) labelSet.delete('INBOX')
      else labelSet.add('INBOX')
      messageObject.labelIds = Array.from(labelSet)
      providerMetadata.provider_message = messageObject
    }

    const { error } = await supabaseAdmin
      .from('mail_messages')
      .update({ is_archived: isArchived, provider_metadata: providerMetadata, updated_at: new Date().toISOString() })
      .eq('id', messageId)

    if (error) throw error

    await writeAuditEvent(
      req.userId!,
      'user',
      'archive',
      'mail_message',
      messageId,
      'success',
      alreadyGoneRemotely ? 'Provider item already gone; synced local state' : undefined,
      message.account_id,
    )

    await handleManualMailboxAction(req.userId!, message.account_id, messageId, isArchived ? 'archive' : 'unarchive')

    res.json({ success: true, alreadyGoneRemotely })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.post('/messages/:id/junk', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const messageId = sanitizeUUID(req.params.id)
    if (!messageId) return res.status(400).json({ error: 'Invalid message id' })

    const accounts = await getUserAccounts(req.userId!)
    const accountIds = accounts.map(account => account.id)

    const { data: message, error: lookupError } = await supabaseAdmin
      .from('mail_messages')
      .select('id, account_id, from_email')
      .eq('id', messageId)
      .in('account_id', accountIds)
      .maybeSingle()

    if (lookupError) throw lookupError
    if (!message) return res.status(404).json({ error: 'Message not found' })

    const entry = normalizeJunkEntry((message as { from_email: string | null }).from_email)
    if (!entry) return res.status(400).json({ error: 'Sender address could not be normalized for the junk list' })

    const { data: prefs, error: prefsError } = await supabaseAdmin
      .from('mail_user_preferences')
      .select('junk_domains')
      .eq('user_id', req.userId!)
      .maybeSingle()
    if (prefsError) throw prefsError

    const current = normalizeJunkEntryList((prefs as MailUserPreferencesRow | null)?.junk_domains || [])
    const junkDomains = current.includes(entry) ? current : normalizeJunkEntryList([...current, entry])

    const { error: upsertError } = await supabaseAdmin
      .from('mail_user_preferences')
      .upsert({ user_id: req.userId, junk_domains: junkDomains, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    if (upsertError) throw upsertError

    await removeContactsMatchingJunkEntries(req.userId!, [entry])

    await writeAuditEvent(req.userId!, 'user', 'junk', 'mail_message', messageId, 'success', undefined, message.account_id)

    const requestedMessageIds = Array.isArray(req.body?.message_ids)
      ? req.body.message_ids
          .map((value: unknown) => sanitizeUUID(value))
          .filter((value: string | null): value is string => Boolean(value))
          .slice(0, AUTOMATION_RUN_MESSAGE_LIMIT)
      : []
    const relatedMessageIds = Array.from(new Set([messageId, ...requestedMessageIds]))
    const { data: relatedRows, error: relatedError } = await supabaseAdmin
      .from('mail_messages')
      .select('id, account_id')
      .in('id', relatedMessageIds)
      .in('account_id', accountIds)
    if (relatedError) throw relatedError

    // A thread-level click is one manual action whose receive-action cascade applies to every owned email in view.
    const automationWarnings = await handleManualMailboxActions(
      req.userId!,
      ((relatedRows || []) as Array<{ id: string; account_id: string }>).map((row) => ({
        accountId: row.account_id,
        messageId: row.id,
      })),
      'junk',
      entry,
    )

    res.json({ success: true, junk_domains: junkDomains, automation_warnings: automationWarnings })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.post('/messages/:id/not-junk', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const messageId = sanitizeUUID(req.params.id)
    if (!messageId) return res.status(400).json({ error: 'Invalid message id' })

    const accounts = await getUserAccounts(req.userId!)
    const accountById = new Map(accounts.map(account => [account.id, account]))
    const accountIds = accounts.map(account => account.id)

    const { data: message, error: lookupError } = await supabaseAdmin
      .from('mail_messages')
      .select('id, account_id, provider_message_id, provider_metadata')
      .eq('id', messageId)
      .in('account_id', accountIds)
      .maybeSingle()

    if (lookupError) throw lookupError
    if (!message) return res.status(404).json({ error: 'Message not found' })

    const account = accountById.get(message.account_id)
    if (!account) return res.status(404).json({ error: 'Mailbox account not found for message' })

    const providerMessageId =
      typeof message.provider_message_id === 'string' && message.provider_message_id
        ? message.provider_message_id
        : extractProviderMessageId(message.provider_metadata)

    if (!providerMessageId) {
      return res.status(400).json({ error: 'Message does not have a provider message id' })
    }

    let alreadyGoneRemotely = false
    try {
      await moveMessageOutOfProviderJunk(account, providerMessageId)
    } catch (moveError) {
      if (!(moveError instanceof ProviderItemGoneError)) throw moveError
      alreadyGoneRemotely = true
    }

    const providerMetadata = (message.provider_metadata && typeof message.provider_metadata === 'object')
      ? { ...(message.provider_metadata as Record<string, unknown>) }
      : {}

    providerMetadata.provider_junk = false
    const providerMessage = providerMetadata.provider_message
    if (providerMessage && typeof providerMessage === 'object') {
      const messageObject = { ...(providerMessage as Record<string, unknown>) }
      const existingLabels = Array.isArray(messageObject.labelIds) ? messageObject.labelIds : []
      const labelSet = new Set(existingLabels.filter((value): value is string => typeof value === 'string' && value !== 'SPAM'))
      if (account.provider === 'gmail') labelSet.add('INBOX')
      if (account.provider === 'outlook') messageObject.provider_folder = 'inbox'
      messageObject.labelIds = Array.from(labelSet)
      providerMetadata.provider_message = messageObject
    }

    const { error: updateError } = await supabaseAdmin
      .from('mail_messages')
      .update({ provider_metadata: providerMetadata, updated_at: new Date().toISOString() })
      .eq('id', messageId)

    if (updateError) throw updateError

    await writeAuditEvent(
      req.userId!,
      'user',
      'not_junk',
      'mail_message',
      messageId,
      'success',
      alreadyGoneRemotely ? 'Provider item already gone; synced local state' : undefined,
      message.account_id,
    )

    res.json({ success: true, alreadyGoneRemotely })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.post('/messages/:id/trash', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const messageId = sanitizeUUID(req.params.id)
    if (!messageId) return res.status(400).json({ error: 'Invalid message id' })

    const accounts = await getUserAccounts(req.userId!)
    const accountById = new Map(accounts.map(account => [account.id, account]))
    const accountIds = accounts.map(account => account.id)

    const { data: message, error: lookupError } = await supabaseAdmin
      .from('mail_messages')
      .select('id, account_id, provider_message_id, provider_metadata')
      .eq('id', messageId)
      .in('account_id', accountIds)
      .maybeSingle()

    if (lookupError) throw lookupError
    if (!message) return res.status(404).json({ error: 'Message not found' })

    const account = accountById.get(message.account_id)
    if (!account) return res.status(404).json({ error: 'Mailbox account not found for message' })

    const providerMessageId =
      typeof message.provider_message_id === 'string' && message.provider_message_id
        ? message.provider_message_id
        : extractProviderMessageId(message.provider_metadata)

    if (!providerMessageId) {
      return res.status(400).json({ error: 'Message does not have a provider message id' })
    }

    let alreadyGoneRemotely = false
    try {
      await moveMessageToProviderTrash(account, providerMessageId)
    } catch (moveError) {
      if (!(moveError instanceof ProviderItemGoneError)) throw moveError
      // Provider says the item no longer exists (deleted/moved outside this app) -- sync local state instead of erroring forever.
      alreadyGoneRemotely = true
    }

    const providerMetadata = (message.provider_metadata && typeof message.provider_metadata === 'object')
      ? { ...(message.provider_metadata as Record<string, unknown>) }
      : {}

    providerMetadata.provider_trashed = true
    const providerMessage = providerMetadata.provider_message
    if (providerMessage && typeof providerMessage === 'object') {
      const messageObject = { ...(providerMessage as Record<string, unknown>) }
      const existingLabels = Array.isArray(messageObject.labelIds) ? messageObject.labelIds : []
      const labelSet = new Set(existingLabels.filter((value): value is string => typeof value === 'string'))
      labelSet.add('TRASH')
      messageObject.labelIds = Array.from(labelSet)
      providerMetadata.provider_message = messageObject
    }

    const { error: updateError } = await supabaseAdmin
      .from('mail_messages')
      .update({ provider_metadata: providerMetadata, updated_at: new Date().toISOString() })
      .eq('id', messageId)

    if (updateError) throw updateError

    await writeAuditEvent(
      req.userId!,
      'user',
      'trash',
      'mail_message',
      messageId,
      'success',
      alreadyGoneRemotely ? 'Provider item already gone; synced local state' : undefined,
      message.account_id,
    )

    await handleManualMailboxAction(req.userId!, message.account_id, messageId, 'trash')

    res.json({ success: true, alreadyGoneRemotely })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.post('/messages/:id/untrash', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const messageId = sanitizeUUID(req.params.id)
    if (!messageId) return res.status(400).json({ error: 'Invalid message id' })

    const accounts = await getUserAccounts(req.userId!)
    const accountById = new Map(accounts.map(account => [account.id, account]))
    const accountIds = accounts.map(account => account.id)

    const { data: message, error: lookupError } = await supabaseAdmin
      .from('mail_messages')
      .select('id, account_id, provider_message_id, provider_metadata')
      .eq('id', messageId)
      .in('account_id', accountIds)
      .maybeSingle()

    if (lookupError) throw lookupError
    if (!message) return res.status(404).json({ error: 'Message not found' })

    const account = accountById.get(message.account_id)
    if (!account) return res.status(404).json({ error: 'Mailbox account not found for message' })

    const providerMessageId =
      typeof message.provider_message_id === 'string' && message.provider_message_id
        ? message.provider_message_id
        : extractProviderMessageId(message.provider_metadata)

    if (!providerMessageId) {
      return res.status(400).json({ error: 'Message does not have a provider message id' })
    }

    await moveMessageOutOfProviderTrash(account, providerMessageId)

    const providerMetadata = (message.provider_metadata && typeof message.provider_metadata === 'object')
      ? { ...(message.provider_metadata as Record<string, unknown>) }
      : {}

    providerMetadata.provider_trashed = false
    const providerMessage = providerMetadata.provider_message
    if (providerMessage && typeof providerMessage === 'object') {
      const messageObject = { ...(providerMessage as Record<string, unknown>) }
      const existingLabels = Array.isArray(messageObject.labelIds) ? messageObject.labelIds : []
      const labelSet = new Set(existingLabels.filter((value): value is string => typeof value === 'string' && value !== 'TRASH'))
      if (account.provider === 'gmail') labelSet.add('INBOX')
      messageObject.labelIds = Array.from(labelSet)
      providerMetadata.provider_message = messageObject
    }

    const { error: updateError } = await supabaseAdmin
      .from('mail_messages')
      .update({ provider_metadata: providerMetadata, updated_at: new Date().toISOString() })
      .eq('id', messageId)

    if (updateError) throw updateError

    await writeAuditEvent(req.userId!, 'user', 'untrash', 'mail_message', messageId, 'success', undefined, message.account_id)

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.delete('/messages/:id/local', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const messageId = sanitizeUUID(req.params.id)
    if (!messageId) return res.status(400).json({ error: 'Invalid message id' })

    const accounts = await getUserAccounts(req.userId!)
    const accountIds = accounts.map(account => account.id)

    const { data: message, error: lookupError } = await supabaseAdmin
      .from('mail_messages')
      .select('id, account_id')
      .eq('id', messageId)
      .in('account_id', accountIds)
      .maybeSingle()

    if (lookupError) throw lookupError
    if (!message) return res.status(404).json({ error: 'Message not found' })

    const { error: deleteError } = await supabaseAdmin
      .from('mail_messages')
      .delete()
      .eq('id', messageId)

    if (deleteError) throw deleteError

    await writeAuditEvent(req.userId!, 'user', 'delete_local_copy', 'mail_message', messageId, 'success', undefined, message.account_id)

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── Drafts ──────────────────────────────────────────────────────────────────

interface MailDraftRow {
  id: string
  user_id: string
  account_id: string
  thread_id: string | null
  in_reply_to_message_id: string | null
  mode: 'reply' | 'forward' | 'new'
  from_address: string
  to_emails: string | null
  cc_emails: string | null
  bcc_emails: string | null
  subject: string | null
  body_text: string | null
  attachments: MailAttachment[] | null
  status: 'draft' | 'sent'
  sent_at: string | null
  created_at: string
  updated_at: string
}

const DRAFT_COLUMNS =
  'id, user_id, account_id, thread_id, in_reply_to_message_id, mode, from_address, to_emails, cc_emails, bcc_emails, subject, body_text, attachments, status, sent_at, created_at, updated_at'

const MAX_DRAFT_ATTACHMENTS = 5
const MAX_DRAFT_ATTACHMENT_BYTES = 5 * 1024 * 1024
const MAX_DRAFT_ATTACHMENT_TOTAL_BYTES = 10 * 1024 * 1024

function parseDraftAttachments(value: unknown): MailAttachment[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > MAX_DRAFT_ATTACHMENTS) {
    throw new Error(`A draft can contain up to ${MAX_DRAFT_ATTACHMENTS} attachments`)
  }

  let totalBytes = 0
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid attachment')
    const raw = entry as Record<string, unknown>
    const filename = sanitizeString(raw.filename, 255)?.replace(/[\\/\r\n"]/g, '_').trim()
    const contentType = sanitizeString(raw.contentType, 150)?.trim().toLowerCase()
    const contentBase64 = typeof raw.contentBase64 === 'string' ? raw.contentBase64 : ''
    if (!filename || !contentType || !contentBase64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64)) {
      throw new Error('Invalid attachment data')
    }

    const byteLength = Buffer.from(contentBase64, 'base64').length
    if (byteLength > MAX_DRAFT_ATTACHMENT_BYTES) {
      throw new Error(`Each attachment must be ${MAX_DRAFT_ATTACHMENT_BYTES / 1024 / 1024} MB or smaller`)
    }
    totalBytes += byteLength
    if (totalBytes > MAX_DRAFT_ATTACHMENT_TOTAL_BYTES) {
      throw new Error(`Attachments must total ${MAX_DRAFT_ATTACHMENT_TOTAL_BYTES / 1024 / 1024} MB or less`)
    }
    return { filename, contentType, contentBase64 }
  })
}

function parseDraftMode(value: unknown): MailDraftRow['mode'] {
  return value === 'forward' || value === 'new' ? value : 'reply'
}

/** Joins a recipient list into the comma-separated storage format, or null when empty. */
function joinDraftRecipients(values: unknown, label: string): string | null {
  const normalized = normalizeRecipientList(values, label)
  return normalized.length > 0 ? normalized.join(', ') : null
}

function resolveDraftFromAddress(account: MailAccountRow, requested: unknown): string {
  const candidate = (sanitizeString(requested, 320) || '').trim().toLowerCase()
  if (!candidate || candidate === account.address.toLowerCase()) return account.address

  throw new Error('From address must match the connected account address')
}

function extractProviderThreadId(provider: MailAccountRow['provider'], providerMetadata: unknown): string | null {
  if (provider !== 'gmail' || !providerMetadata || typeof providerMetadata !== 'object') return null

  const providerMessage = (providerMetadata as Record<string, unknown>).provider_message
  if (!providerMessage || typeof providerMessage !== 'object') return null

  const threadId = (providerMessage as Record<string, unknown>).threadId
  return typeof threadId === 'string' ? threadId : null
}

// Manual "AI: suggest a reply" action for the compose panel. Unlike automation's
// agent_prompt action, this never saves anything itself -- it only returns text
// for the user to review in the draft form before they save or send it.
router.post('/messages/:id/draft-suggestion', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const messageId = sanitizeUUID(req.params.id)
    if (!messageId) return res.status(400).json({ error: 'Invalid message id' })

    const instruction = sanitizeString(req.body?.instruction, 1000)
    if (!instruction) return res.status(400).json({ error: 'Tell the AI what the reply should say' })

    const accounts = await getUserAccounts(req.userId!)
    const accountIds = accounts.map((account) => account.id)

    const { data: message, error: lookupError } = await supabaseAdmin
      .from('mail_messages')
      .select('id, account_id, subject, from_email, from_name, to_emails, body_text, preview')
      .eq('id', messageId)
      .in('account_id', accountIds)
      .maybeSingle()

    if (lookupError) throw lookupError
    if (!message) return res.status(404).json({ error: 'Message not found' })

    const usage = await checkAndRecordAiUsageForUserId(req.userId!, 'mailbox_draft')
    if (!usage.allowed) {
      return res.status(429).json({ error: `Today's mailbox draft limit (${usage.limit} per day) has been reached. It resets tomorrow.` })
    }

    const generated = await generateDraftReply({
      subject: message.subject,
      fromEmail: message.from_email,
      fromName: message.from_name,
      toEmails: message.to_emails,
      body: message.body_text || message.preview,
      context: '',
      intent: instruction,
    })

    if (!generated.available) {
      return res.status(502).json({ error: generated.reasoning })
    }

    await writeAuditEvent(req.userId!, 'user', 'ai_draft_suggestion', 'mail_message', messageId, 'success', undefined, message.account_id)

    res.json({ subject: generated.subject, body_text: generated.bodyText, reasoning: generated.reasoning })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.get('/drafts', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('mail_drafts')
      .select(DRAFT_COLUMNS)
      .eq('user_id', req.userId!)
      .eq('status', 'draft')
      .order('updated_at', { ascending: false })
      .limit(200)

    if (error) throw error

    res.json({ drafts: (data || []) as MailDraftRow[] })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.post('/drafts', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const accountId = sanitizeUUID(req.body?.account_id)
    if (!accountId) return res.status(400).json({ error: 'Invalid account id' })

    const account = await getOwnedAccount(req.userId!, accountId)
    if (!account) return res.status(404).json({ error: 'Account not found' })

    const draftId = sanitizeUUID(req.body?.id)
    const record = {
      user_id: req.userId!,
      account_id: account.id,
      thread_id: sanitizeUUID(req.body?.thread_id) || null,
      in_reply_to_message_id: sanitizeUUID(req.body?.in_reply_to_message_id) || null,
      mode: parseDraftMode(req.body?.mode),
      from_address: resolveDraftFromAddress(account, req.body?.from_address),
      to_emails: joinDraftRecipients(req.body?.to_emails, 'To'),
      cc_emails: joinDraftRecipients(req.body?.cc_emails, 'Cc'),
      bcc_emails: joinDraftRecipients(req.body?.bcc_emails, 'Bcc'),
      subject: sanitizeString(req.body?.subject, 500) || null,
      body_text: sanitizeString(req.body?.body_text, 100000) || null,
      attachments: parseDraftAttachments(req.body?.attachments),
      status: 'draft' as const,
    }

    const query = draftId
      ? supabaseAdmin.from('mail_drafts').update(record).eq('id', draftId).eq('user_id', req.userId!)
      : supabaseAdmin.from('mail_drafts').insert(record)

    const { data, error } = await query.select(DRAFT_COLUMNS).single()
    if (error) throw error

    await writeAuditEvent(req.userId!, 'user', 'save_draft', 'mail_draft', (data as MailDraftRow).id, 'success', undefined, account.id)

    res.json({ draft: data as MailDraftRow })
  } catch (err) {
    res.status(400).json({ error: safeErrorMessage(err) })
  }
})

router.delete('/drafts/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const draftId = sanitizeUUID(req.params.id)
    if (!draftId) return res.status(400).json({ error: 'Invalid draft id' })

    const { error } = await supabaseAdmin
      .from('mail_drafts')
      .delete()
      .eq('id', draftId)
      .eq('user_id', req.userId!)

    if (error) throw error

    await writeAuditEvent(req.userId!, 'user', 'delete_draft', 'mail_draft', draftId, 'success')

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.post('/drafts/:id/send', async (req: AuthenticatedRequest, res: Response) => {
  const draftId = sanitizeUUID(req.params.id)
  if (!draftId) return res.status(400).json({ error: 'Invalid draft id' })

  try {
    const { data: draftRow, error: draftError } = await supabaseAdmin
      .from('mail_drafts')
      .select(DRAFT_COLUMNS)
      .eq('id', draftId)
      .eq('user_id', req.userId!)
      .maybeSingle()

    if (draftError) throw draftError
    if (!draftRow) return res.status(404).json({ error: 'Draft not found' })

    const draft = draftRow as MailDraftRow
    if (draft.status === 'sent') return res.status(409).json({ error: 'This draft was already sent' })

    const account = await getOwnedAccount(req.userId!, draft.account_id)
    if (!account) return res.status(404).json({ error: 'Account not found' })
    if (account.provider === 'imap') {
      return res.status(400).json({ error: 'Sending from IMAP accounts is not supported yet' })
    }

    const to = normalizeRecipientList(draft.to_emails, 'To')
    if (to.length === 0) return res.status(400).json({ error: 'Add at least one To recipient before sending' })

    let providerThreadId: string | null = null
    let inReplyToRfcId: string | null = null
    let outlookReplyToMessageId: string | null = null
    let quoteSource: QuoteSource | null = null

    if (draft.in_reply_to_message_id) {
      const { data: sourceMessage, error: sourceError } = await supabaseAdmin
        .from('mail_messages')
        .select('rfc_message_id, provider_metadata, account_id, from_name, from_email, received_at, body_text, preview')
        .eq('id', draft.in_reply_to_message_id)
        .maybeSingle()

      if (sourceError) throw sourceError
      if (sourceMessage && (sourceMessage as { account_id: string }).account_id === account.id) {
        const row = sourceMessage as {
          rfc_message_id: string | null
          provider_metadata: unknown
          from_name: string | null
          from_email: string | null
          received_at: string | null
          body_text: string | null
          preview: string | null
        }
        inReplyToRfcId = row.rfc_message_id
        providerThreadId = extractProviderThreadId(account.provider, row.provider_metadata)
        if (account.provider === 'outlook' && draft.mode === 'reply') {
          outlookReplyToMessageId = extractProviderMessageId(row.provider_metadata)
        }

        // Forwards already carry their quote in the draft body the user edited.
        if (draft.mode === 'reply') {
          quoteSource = {
            fromName: row.from_name,
            fromEmail: row.from_email,
            sentAt: row.received_at,
            bodyText: row.body_text || row.preview,
          }
        }
      }
    }

    const bodies = buildReplyBodies(draft.body_text || '', quoteSource)

    const result = await sendMailboxMessage({
      userId: req.userId!,
      accountId: account.id,
      provider: account.provider,
      fromAddress: draft.from_address,
      fromName: account.display_name,
      to,
      cc: normalizeRecipientList(draft.cc_emails, 'Cc'),
      bcc: normalizeRecipientList(draft.bcc_emails, 'Bcc'),
      subject: draft.subject || '(no subject)',
      bodyText: bodies.text,
      bodyHtml: bodies.html,
      attachments: draft.attachments || [],
      providerThreadId,
      inReplyToRfcId,
      outlookReplyToMessageId,
    })

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('mail_drafts')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        provider_message_id: result.providerMessageId,
      })
      .eq('id', draft.id)
      .eq('user_id', req.userId!)
      .select(DRAFT_COLUMNS)
      .single()

    if (updateError) throw updateError

    const { error: lastSentError } = await supabaseAdmin
      .from('mail_accounts')
      .update({ last_sent_at: updated.sent_at, updated_at: new Date().toISOString() })
      .eq('id', account.id)
      .eq('user_id', req.userId!)
    if (lastSentError) throw lastSentError

    await writeAuditEvent(req.userId!, 'user', 'send_draft', 'mail_draft', draft.id, 'success', `recipients:${to.length}`, account.id)

    res.json({ draft: updated as MailDraftRow, provider_message_id: result.providerMessageId })
  } catch (err) {
    await writeAuditEvent(req.userId!, 'user', 'send_draft', 'mail_draft', draftId, 'failure', safeErrorMessage(err))
    res.status(400).json({ error: safeErrorMessage(err) })
  }
})

// ─── Mailbox Preferences ─────────────────────────────────────────────────────

router.get('/preferences/filter-rules', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('mail_user_preferences')
      .select('user_id, mailbox_filter_rules')
      .eq('user_id', req.userId!)
      .maybeSingle()

    if (error) throw error

    const row = (data || null) as Pick<MailUserPreferencesRow, 'mailbox_filter_rules'> | null
    res.json({ filters: normalizeMailboxFilterRules(row?.mailbox_filter_rules) })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.put('/preferences/filter-rules', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const filters = normalizeMailboxFilterRules(req.body?.filters)

    const { error } = await supabaseAdmin
      .from('mail_user_preferences')
      .upsert({
        user_id: req.userId,
        mailbox_filter_rules: filters,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })

    if (error) throw error

    await writeAuditEvent(req.userId!, 'user', 'save_mailbox_filter_rules', 'mail_user_preferences', req.userId!, 'success', `filters:${filters.length}`)

    res.json({ filters })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.get('/preferences/threading', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('mail_user_preferences')
      .select('mailbox_threading_options')
      .eq('user_id', req.userId!)
      .maybeSingle()

    if (error) throw error

    const options = normalizeMailboxThreadingOptions(
      (data as Pick<MailUserPreferencesRow, 'mailbox_threading_options'> | null)?.mailbox_threading_options,
    )
    res.json({ options })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.put('/preferences/threading', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const options = normalizeMailboxThreadingOptions(req.body?.options)
    const { error } = await supabaseAdmin
      .from('mail_user_preferences')
      .upsert({
        user_id: req.userId,
        mailbox_threading_options: options,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })

    if (error) throw error

    await writeAuditEvent(
      req.userId!,
      'user',
      'save_mailbox_threading_options',
      'mail_user_preferences',
      req.userId!,
      'success',
      'saved_without_regrouping',
    )
    res.json({ options })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

const DEFAULT_MAILBOX_SETTINGS_SECTIONS = {
  threadView: true,
  inboxDisplay: true,
  confirmations: true,
  syncDefaults: true,
  notifications: true,
}

function normalizeMailboxSettingsSections(value: unknown): typeof DEFAULT_MAILBOX_SETTINGS_SECTIONS {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_MAILBOX_SETTINGS_SECTIONS
  }
  const candidate = value as Record<string, unknown>
  return {
    threadView: candidate.threadView !== false,
    inboxDisplay: candidate.inboxDisplay !== false,
    confirmations: candidate.confirmations !== false,
    syncDefaults: candidate.syncDefaults !== false,
    notifications: candidate.notifications !== false,
  }
}

router.get('/preferences/settings-sections', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('mail_user_preferences')
      .select('mailbox_settings_sections')
      .eq('user_id', req.userId!)
      .maybeSingle()
    if (error) throw error

    res.json({
      sections: normalizeMailboxSettingsSections(
        (data as Pick<MailUserPreferencesRow, 'mailbox_settings_sections'> | null)?.mailbox_settings_sections,
      ),
    })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.put('/preferences/settings-sections', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sections = normalizeMailboxSettingsSections(req.body?.sections)
    const { error } = await supabaseAdmin
      .from('mail_user_preferences')
      .upsert({
        user_id: req.userId,
        mailbox_settings_sections: sections,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
    if (error) throw error

    await writeAuditEvent(req.userId!, 'user', 'save_mailbox_settings_sections', 'mail_user_preferences', req.userId!, 'success')
    res.json({ sections })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.get('/preferences/notification-rules', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('mail_user_preferences')
      .select('user_id, mailbox_notifications_enabled, mailbox_notification_rules')
      .eq('user_id', req.userId!)
      .maybeSingle()

    if (error) throw error

    const row = (data || null) as Pick<MailUserPreferencesRow, 'mailbox_notifications_enabled' | 'mailbox_notification_rules'> | null
    res.json({
      enabled: row?.mailbox_notifications_enabled === true,
      rules: normalizeMailboxNotificationRules(row?.mailbox_notification_rules),
    })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.put('/preferences/notification-rules', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const enabled = parseBooleanInput(req.body?.enabled, false)
    const rules = normalizeMailboxNotificationRules(req.body?.rules)

    const { error } = await supabaseAdmin
      .from('mail_user_preferences')
      .upsert({
        user_id: req.userId,
        mailbox_notifications_enabled: enabled,
        mailbox_notification_rules: rules,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })

    if (error) throw error

    await writeAuditEvent(req.userId!, 'user', 'save_mailbox_notification_rules', 'mail_user_preferences', req.userId!, 'success', `enabled:${enabled}`)

    res.json({ enabled, rules })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// Lightweight, watermark-based poll for the nav badge -- callable from any page, not just the
// Mailbox page, and cheap when notifications are disabled or nothing changed since last check.
router.get('/notifications/check', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data: prefsData, error: prefsError } = await supabaseAdmin
      .from('mail_user_preferences')
      .select('mailbox_notifications_enabled, mailbox_notification_rules, mailbox_notifications_last_checked_at')
      .eq('user_id', req.userId!)
      .maybeSingle()
    if (prefsError) throw prefsError

    const prefsRow = prefsData as Pick<MailUserPreferencesRow, 'mailbox_notifications_enabled' | 'mailbox_notification_rules' | 'mailbox_notifications_last_checked_at'> | null
    if (prefsRow?.mailbox_notifications_enabled !== true) {
      return res.json({ enabled: false, hasNew: false })
    }

    const rules = normalizeMailboxNotificationRules(prefsRow.mailbox_notification_rules)
    const sinceIso = typeof prefsRow.mailbox_notifications_last_checked_at === 'string'
      ? prefsRow.mailbox_notifications_last_checked_at
      : new Date(0).toISOString()
    const nowIso = new Date().toISOString()

    const { data: accountRows, error: accountsError } = await supabaseAdmin
      .from('mail_accounts')
      .select('id, provider, address, status')
      .eq('user_id', req.userId!)
      .neq('status', 'disconnected')
    if (accountsError) throw accountsError

    const accounts = (accountRows || []) as Array<Pick<MailAccountRow, 'id' | 'provider' | 'address' | 'status'>>
    if (accounts.length === 0) {
      await supabaseAdmin
        .from('mail_user_preferences')
        .upsert({ user_id: req.userId, mailbox_notifications_last_checked_at: nowIso, updated_at: nowIso }, { onConflict: 'user_id' })
      return res.json({ enabled: true, hasNew: false })
    }

    if (accounts.some((account) => account.status === 'syncing')) {
      return res.json({ enabled: true, hasNew: false, deferred: true })
    }

    const accountById = new Map(accounts.map((account) => [account.id, account]))
    const { data: candidateRows, error: messagesError } = await supabaseAdmin
      .from('mail_messages')
      .select(MAILBOX_NOTIFICATION_CANDIDATE_SELECT)
      .in('account_id', accounts.map((account) => account.id))
      .gt('updated_at', sinceIso)
      .order('updated_at', { ascending: false })
      .limit(200)
    if (messagesError) throw messagesError

    const hasNew = ((candidateRows || []) as unknown as MailboxNotificationCandidateRow[]).some((row) => {
      const account = accountById.get(row.account_id)
      if (!account) return false
      const providerMetadata = buildNotificationCandidateMetadata(row)
      return shouldNotifyForMessageRow({
        is_read: row.is_read,
        is_archived: row.is_archived,
        has_attachments: row.has_attachments,
        is_provider_trashed: isProviderMessageTrashed(account.provider, providerMetadata),
        is_provider_junk: isProviderMessageJunk(account.provider, providerMetadata),
        is_provider_sent:
          isProviderMessageSent(account.provider, providerMetadata)
          || shouldInferSentFromSender(row.from_email, account.address),
        user_tag_ids: extractUserTagIdsFromProviderMetadata(providerMetadata),
      }, rules)
    })

    await supabaseAdmin
      .from('mail_user_preferences')
      .upsert({ user_id: req.userId, mailbox_notifications_last_checked_at: nowIso, updated_at: nowIso }, { onConflict: 'user_id' })

    res.json({ enabled: true, hasNew })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.get('/preferences/html-trust', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('mail_user_preferences')
      .select('user_id, trusted_html_domains')
      .eq('user_id', req.userId!)
      .maybeSingle()

    if (error) throw error

    const row = (data || null) as MailUserPreferencesRow | null
    const trustedDomains = normalizeMailboxDomainList(row?.trusted_html_domains || [])
    res.json({ trusted_domains: trustedDomains })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.post('/preferences/html-trust', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const trustedDomains = normalizeMailboxDomainList(req.body?.trusted_domains)

    const { error } = await supabaseAdmin
      .from('mail_user_preferences')
      .upsert({
        user_id: req.userId,
        trusted_html_domains: trustedDomains,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })

    if (error) throw error

    await writeAuditEvent(req.userId!, 'user', 'save_mailbox_preferences', 'mail_user_preferences', req.userId!, 'success', `trusted_domains:${trustedDomains.length}`)

    res.json({ success: true, trusted_domains: trustedDomains })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.get('/preferences/junk-domains', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('mail_user_preferences')
      .select('user_id, junk_domains')
      .eq('user_id', req.userId!)
      .maybeSingle()

    if (error) throw error

    const row = (data || null) as MailUserPreferencesRow | null
    const junkDomains = normalizeJunkEntryList(row?.junk_domains || [])
    res.json({ junk_domains: junkDomains })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.post('/preferences/junk-domains', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const junkDomains = normalizeJunkEntryList(req.body?.junk_domains)

    const { error } = await supabaseAdmin
      .from('mail_user_preferences')
      .upsert({
        user_id: req.userId,
        junk_domains: junkDomains,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })

    if (error) throw error

    await removeContactsMatchingJunkEntries(req.userId!, junkDomains)

    await writeAuditEvent(req.userId!, 'user', 'save_mailbox_preferences', 'mail_user_preferences', req.userId!, 'success', `junk_domains:${junkDomains.length}`)

    res.json({ success: true, junk_domains: junkDomains })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.get('/preferences/non-organizers', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('mail_user_preferences')
      .select('user_id, non_organizer_senders')
      .eq('user_id', req.userId!)
      .maybeSingle()

    if (error) throw error

    const row = (data || null) as MailUserPreferencesRow | null
    res.json({ non_organizer_senders: normalizeJunkEntryList(row?.non_organizer_senders || []) })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.post('/preferences/non-organizers', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const senders = normalizeJunkEntryList(req.body?.non_organizer_senders)

    const { error } = await supabaseAdmin
      .from('mail_user_preferences')
      .upsert({
        user_id: req.userId,
        non_organizer_senders: senders,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })

    if (error) throw error

    await writeAuditEvent(req.userId!, 'user', 'save_mailbox_preferences', 'mail_user_preferences', req.userId!, 'success', `non_organizer_senders:${senders.length}`)

    res.json({ success: true, non_organizer_senders: senders })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

/** Marks an organizer as never producing meetings and removes their existing invitations. */
router.post('/invitations/dismiss-organizer', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizer = normalizeJunkEntry(sanitizeString(req.body?.organizer, 320))
    if (!organizer) {
      return res.status(400).json({ error: 'Invalid organizer' })
    }

    const { data: existingRow, error: readError } = await supabaseAdmin
      .from('mail_user_preferences')
      .select('user_id, non_organizer_senders')
      .eq('user_id', req.userId!)
      .maybeSingle()

    if (readError) throw readError

    const current = normalizeJunkEntryList((existingRow as MailUserPreferencesRow | null)?.non_organizer_senders || [])
    const senders = normalizeJunkEntryList([...current, organizer])

    const { error: upsertError } = await supabaseAdmin
      .from('mail_user_preferences')
      .upsert({
        user_id: req.userId,
        non_organizer_senders: senders,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })

    if (upsertError) throw upsertError

    const { data: removed, error: deleteError } = await supabaseAdmin
      .from('mail_invitations')
      .delete()
      .eq('user_id', req.userId!)
      .ilike('organizer', `%${organizer}`)
      .select('id')

    if (deleteError) throw deleteError

    await writeAuditEvent(req.userId!, 'user', 'dismiss_invitation_organizer', 'mail_invitations', req.userId!, 'success', `removed:${removed?.length || 0}`)

    res.json({ success: true, organizer, non_organizer_senders: senders, removed_count: removed?.length || 0 })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.get('/preferences/tags', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('mail_user_preferences')
      .select('user_id, mailbox_tags')
      .eq('user_id', req.userId!)
      .maybeSingle()

    if (error) throw error

    const row = (data || null) as Pick<MailUserPreferencesRow, 'mailbox_tags'> | null
    const tags = normalizeMailboxTagList(row?.mailbox_tags || [])
    res.json({ tags })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.post('/preferences/tags', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const label = sanitizeString(req.body?.label, 40)
    if (!label) {
      return res.status(400).json({ error: 'label is required (1-40 chars)' })
    }

    const color = normalizeMailboxTagColor(req.body?.color)
    const sortOrder = parseIntegerInput(req.body?.sort_order, 0, -10000, 10000)

    const { data: prefs, error: prefsError } = await supabaseAdmin
      .from('mail_user_preferences')
      .select('mailbox_tags')
      .eq('user_id', req.userId!)
      .maybeSingle()

    if (prefsError) throw prefsError

    const existingTags = normalizeMailboxTagList((prefs as Pick<MailUserPreferencesRow, 'mailbox_tags'> | null)?.mailbox_tags || [])
    if (existingTags.some((tag) => tag.label.toLowerCase() === label.toLowerCase())) {
      return res.status(409).json({ error: 'A mailbox tag with this label already exists' })
    }

    const nextTag: MailboxTagRecord = {
      id: randomUUID(),
      label,
      color,
      sort_order: sortOrder,
    }

    const nextTags = normalizeMailboxTagList([...existingTags, nextTag])

    const { error: upsertError } = await supabaseAdmin
      .from('mail_user_preferences')
      .upsert({
        user_id: req.userId,
        mailbox_tags: nextTags,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })

    if (upsertError) throw upsertError

    res.status(201).json({ tag: nextTag, tags: nextTags })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.put('/preferences/tags/:tagId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tagId = sanitizeUUID(req.params.tagId)
    if (!tagId) return res.status(400).json({ error: 'Invalid tag id' })

    const { data: prefs, error: prefsError } = await supabaseAdmin
      .from('mail_user_preferences')
      .select('mailbox_tags')
      .eq('user_id', req.userId!)
      .maybeSingle()

    if (prefsError) throw prefsError

    const existingTags = normalizeMailboxTagList((prefs as Pick<MailUserPreferencesRow, 'mailbox_tags'> | null)?.mailbox_tags || [])
    const current = existingTags.find((tag) => tag.id === tagId)
    if (!current) return res.status(404).json({ error: 'Tag not found' })

    const nextLabel = req.body?.label === undefined ? current.label : sanitizeString(req.body.label, 40)
    if (!nextLabel) return res.status(400).json({ error: 'label is required (1-40 chars)' })

    const labelConflict = existingTags.some((tag) => (
      tag.id !== tagId && tag.label.toLowerCase() === nextLabel.toLowerCase()
    ))
    if (labelConflict) {
      return res.status(409).json({ error: 'A mailbox tag with this label already exists' })
    }

    const nextColor = req.body?.color === undefined
      ? current.color
      : normalizeMailboxTagColor(req.body.color)
    const nextSortOrder = req.body?.sort_order === undefined
      ? current.sort_order
      : parseIntegerInput(req.body.sort_order, current.sort_order, -10000, 10000)

    const nextTags = normalizeMailboxTagList(existingTags.map((tag) => (
      tag.id === tagId
        ? {
            ...tag,
            label: nextLabel,
            color: nextColor,
            sort_order: nextSortOrder,
          }
        : tag
    )))

    const updatedTag = nextTags.find((tag) => tag.id === tagId)
    if (!updatedTag) return res.status(404).json({ error: 'Tag not found' })

    const { error: upsertError } = await supabaseAdmin
      .from('mail_user_preferences')
      .upsert({
        user_id: req.userId,
        mailbox_tags: nextTags,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })

    if (upsertError) throw upsertError

    res.json({ tag: updatedTag, tags: nextTags })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.delete('/preferences/tags/:tagId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tagId = sanitizeUUID(req.params.tagId)
    if (!tagId) return res.status(400).json({ error: 'Invalid tag id' })

    const { data: prefs, error: prefsError } = await supabaseAdmin
      .from('mail_user_preferences')
      .select('mailbox_tags')
      .eq('user_id', req.userId!)
      .maybeSingle()

    if (prefsError) throw prefsError

    const existingTags = normalizeMailboxTagList((prefs as Pick<MailUserPreferencesRow, 'mailbox_tags'> | null)?.mailbox_tags || [])
    const nextTags = normalizeMailboxTagList(existingTags.filter((tag) => tag.id !== tagId))
    if (nextTags.length === existingTags.length) {
      return res.status(404).json({ error: 'Tag not found' })
    }

    const { error: upsertError } = await supabaseAdmin
      .from('mail_user_preferences')
      .upsert({
        user_id: req.userId,
        mailbox_tags: nextTags,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })

    if (upsertError) throw upsertError

    const accounts = await getUserAccounts(req.userId!)
    const accountIds = accounts.map((account) => account.id)

    if (accountIds.length > 0) {
      const { data: candidateMessages, error: messageQueryError } = await supabaseAdmin
        .from('mail_messages')
        .select('id, provider_metadata')
        .in('account_id', accountIds)

      if (messageQueryError) throw messageQueryError

      for (const row of (candidateMessages || []) as Array<{ id: string; provider_metadata: unknown }>) {
        const existingTagIds = extractUserTagIdsFromProviderMetadata(row.provider_metadata)
        if (!existingTagIds.includes(tagId)) continue

        const nextTagIds = existingTagIds.filter((entry) => entry !== tagId)
        const nextProviderMetadata = setUserTagIdsInProviderMetadata(row.provider_metadata, nextTagIds)
        const { error: messageUpdateError } = await supabaseAdmin
          .from('mail_messages')
          .update({ provider_metadata: nextProviderMetadata, updated_at: new Date().toISOString() })
          .eq('id', row.id)

        if (messageUpdateError) throw messageUpdateError
      }
    }

    res.json({ success: true, tags: nextTags })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.post('/messages/:id/tags', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const messageId = sanitizeUUID(req.params.id)
    if (!messageId) return res.status(400).json({ error: 'Invalid message id' })

    const accounts = await getUserAccounts(req.userId!)
    const accountIds = accounts.map((account) => account.id)

    const { data: message, error: lookupError } = await supabaseAdmin
      .from('mail_messages')
      .select('id, account_id, provider_metadata')
      .eq('id', messageId)
      .in('account_id', accountIds)
      .maybeSingle()

    if (lookupError) throw lookupError
    if (!message) return res.status(404).json({ error: 'Message not found' })

    const requestedTagIdsRaw: unknown[] = Array.isArray(req.body?.tag_ids) ? req.body.tag_ids : []
    const requestedTagIds: string[] = Array.from(new Set<string>(
      requestedTagIdsRaw
        .map((value: unknown): string | null => sanitizeUUID(value) || null)
        .filter((value): value is string => typeof value === 'string')
    )).slice(0, 50)

    const { data: prefs, error: prefsError } = await supabaseAdmin
      .from('mail_user_preferences')
      .select('mailbox_tags')
      .eq('user_id', req.userId!)
      .maybeSingle()

    if (prefsError) throw prefsError

    const existingTags = normalizeMailboxTagList((prefs as Pick<MailUserPreferencesRow, 'mailbox_tags'> | null)?.mailbox_tags || [])
    const allowedTagIds = new Set(existingTags.map((tag) => tag.id))
    const invalidTagId = requestedTagIds.find((tagId) => !allowedTagIds.has(tagId))
    if (invalidTagId) {
      return res.status(400).json({ error: 'One or more tag ids are invalid for this user' })
    }

    const nextProviderMetadata = setUserTagIdsInProviderMetadata(message.provider_metadata, requestedTagIds)

    const { error: updateError } = await supabaseAdmin
      .from('mail_messages')
      .update({ provider_metadata: nextProviderMetadata, updated_at: new Date().toISOString() })
      .eq('id', messageId)

    if (updateError) throw updateError

    const previousTagIds = new Set(extractUserTagIdsFromProviderMetadata(message.provider_metadata))
    const nextTagIds = new Set(requestedTagIds)
    for (const tagId of nextTagIds) {
      if (!previousTagIds.has(tagId)) await handleManualMailboxAction(req.userId!, message.account_id, messageId, 'add_tag', tagId)
    }
    for (const tagId of previousTagIds) {
      if (!nextTagIds.has(tagId)) await handleManualMailboxAction(req.userId!, message.account_id, messageId, 'remove_tag', tagId)
    }

    res.json({ success: true, tag_ids: requestedTagIds })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── People and Invitations ───────────────────────────────────────────────────

router.get('/people', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const q = sanitizeString(req.query.q, 100)
    const contactSelect = 'id, display_name, notes, last_interaction_at, interaction_count, labels, region, timezone, sent_count, received_count, last_sent_at, last_received_at'

    let contacts: Array<Record<string, unknown>> = []

    if (q) {
      const [nameMatches, identityMatches] = await Promise.all([
        supabaseAdmin
          .from('mail_contacts')
          .select(contactSelect)
          .eq('user_id', req.userId!)
          .ilike('display_name', `%${q}%`)
          .order('last_interaction_at', { ascending: false })
          .limit(50),
        supabaseAdmin
          .from('mail_contact_identities')
          .select('contact_id, mail_contacts!inner(user_id)')
          .eq('mail_contacts.user_id', req.userId!)
          .ilike('email', `%${q}%`)
          .limit(50),
      ])

      if (nameMatches.error) throw nameMatches.error
      if (identityMatches.error) throw identityMatches.error

      const nameMatchIds = new Set((nameMatches.data || []).map(c => c.id as string))
      const extraIds = Array.from(
        new Set((identityMatches.data || []).map(row => row.contact_id as string)),
      ).filter(id => !nameMatchIds.has(id))

      let extraContacts: Array<Record<string, unknown>> = []
      if (extraIds.length > 0) {
        const { data, error } = await supabaseAdmin
          .from('mail_contacts')
          .select(contactSelect)
          .eq('user_id', req.userId!)
          .in('id', extraIds)
        if (error) throw error
        extraContacts = data || []
      }

      contacts = [...(nameMatches.data || []), ...extraContacts]
        .sort((a, b) => String(b.last_interaction_at || '').localeCompare(String(a.last_interaction_at || '')))
        .slice(0, 50)
    } else {
      const { data, error } = await supabaseAdmin
        .from('mail_contacts')
        .select(contactSelect)
        .eq('user_id', req.userId!)
        .order('last_interaction_at', { ascending: false })
        .limit(50)
      if (error) throw error
      contacts = data || []
    }

    const contactIds = (contacts || []).map(c => c.id as string)
    const { data: identities, error: identitiesError } = contactIds.length > 0
      ? await supabaseAdmin
        .from('mail_contact_identities')
        .select('id, contact_id, email, provider_source, confidence, is_primary, is_user_override, label')
        .in('contact_id', contactIds)
      : { data: [], error: null }

    if (identitiesError) throw identitiesError

    const identityMap = new Map<string, Array<Record<string, unknown>>>()
    for (const identity of identities || []) {
      const current = identityMap.get(identity.contact_id) || []
      current.push(identity)
      identityMap.set(identity.contact_id, current)
    }

    const people = (contacts || []).map(contact => {
      const contactId = typeof contact.id === 'string' ? contact.id : null
      return {
        ...contact,
        identities: contactId ? identityMap.get(contactId) || [] : [],
      }
    })

    res.json({ people })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

const MAILBOX_CONTACT_LABEL_MAX = 15
const MAILBOX_CONTACT_LABEL_LENGTH_MAX = 40

// ─── PATCH /api/mailbox/people/:id — Edit a contact's identity details ────────
router.patch('/people/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const contactId = sanitizeUUID(req.params.id)
    if (!contactId) return res.status(400).json({ error: 'Invalid contact id' })

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('mail_contacts')
      .select('id')
      .eq('id', contactId)
      .eq('user_id', req.userId!)
      .maybeSingle()

    if (fetchError) throw fetchError
    if (!existing) return res.status(404).json({ error: 'Contact not found' })

    const updates: Record<string, unknown> = {}

    if (req.body.display_name !== undefined) {
      updates.display_name = sanitizeString(req.body.display_name, 200) || null
    }
    if (req.body.notes !== undefined) {
      updates.notes = sanitizeString(req.body.notes, 2000) || null
    }
    if (req.body.region !== undefined) {
      updates.region = sanitizeString(req.body.region, 100) || null
    }
    if (req.body.timezone !== undefined) {
      updates.timezone = sanitizeString(req.body.timezone, 100) || null
    }
    if (req.body.labels !== undefined) {
      if (!Array.isArray(req.body.labels)) {
        return res.status(400).json({ error: 'labels must be an array of strings' })
      }
      const labels = req.body.labels
        .map((label: unknown) => sanitizeString(label, MAILBOX_CONTACT_LABEL_LENGTH_MAX))
        .filter((label: string): label is string => Boolean(label))
        .slice(0, MAILBOX_CONTACT_LABEL_MAX)
      updates.labels = Array.from(new Set(labels))
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No editable fields provided' })
    }

    updates.updated_at = new Date().toISOString()

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('mail_contacts')
      .update(updates)
      .eq('id', contactId)
      .select('id, display_name, notes, last_interaction_at, interaction_count, labels, region, timezone, sent_count, received_count, last_sent_at, last_received_at')
      .single()

    if (updateError) throw updateError

    res.json({ contact: updated })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

const CONTACT_SELECT_FIELDS = 'id, display_name, notes, last_interaction_at, interaction_count, labels, region, timezone, sent_count, received_count, last_sent_at, last_received_at'
const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function normalizeContactEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return EMAIL_ADDRESS_PATTERN.test(trimmed) ? trimmed : null
}

// ─── POST /api/mailbox/people — Manually add a contact ───────────────────────
router.post('/people', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const email = normalizeContactEmail(req.body.email)
    if (!email) return res.status(400).json({ error: 'A valid email is required' })

    const displayName = sanitizeString(req.body.display_name, 200) || email

    const { data: existingIdentity } = await supabaseAdmin
      .from('mail_contact_identities')
      .select('id, contact_id, mail_contacts!inner(user_id)')
      .eq('email', email)
      .eq('mail_contacts.user_id', req.userId!)
      .maybeSingle()

    if (existingIdentity) return res.status(409).json({ error: 'A contact with this email already exists' })

    const { data: contact, error: contactError } = await supabaseAdmin
      .from('mail_contacts')
      .insert({
        user_id: req.userId,
        display_name: displayName,
        region: sanitizeString(req.body.region, 100) || null,
        timezone: sanitizeString(req.body.timezone, 100) || null,
        source_summary: { origin: 'manual' },
      })
      .select(CONTACT_SELECT_FIELDS)
      .single()

    if (contactError || !contact) throw contactError || new Error('Failed to create contact')

    const { data: identity, error: identityError } = await supabaseAdmin
      .from('mail_contact_identities')
      .insert({ contact_id: contact.id, email, provider_source: 'manual', is_primary: true, is_user_override: true })
      .select('id, contact_id, email, provider_source, confidence, is_primary, is_user_override, label')
      .single()

    if (identityError) throw identityError

    res.status(201).json({ contact: { ...contact, identities: [identity] } })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── POST /api/mailbox/people/:id/identities — Add another email to a contact ─
router.post('/people/:id/identities', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const contactId = sanitizeUUID(req.params.id)
    if (!contactId) return res.status(400).json({ error: 'Invalid contact id' })

    const email = normalizeContactEmail(req.body.email)
    if (!email) return res.status(400).json({ error: 'A valid email is required' })

    const { data: contact, error: contactError } = await supabaseAdmin
      .from('mail_contacts')
      .select('id')
      .eq('id', contactId)
      .eq('user_id', req.userId!)
      .maybeSingle()
    if (contactError) throw contactError
    if (!contact) return res.status(404).json({ error: 'Contact not found' })

    const { data: identity, error: identityError } = await supabaseAdmin
      .from('mail_contact_identities')
      .insert({ contact_id: contactId, email, provider_source: 'manual', is_primary: false, is_user_override: true })
      .select('id, contact_id, email, provider_source, confidence, is_primary, is_user_override, label')
      .single()

    if (identityError) {
      if (identityError.code === '23505') return res.status(409).json({ error: 'This email is already linked to a contact' })
      throw identityError
    }

    res.status(201).json({ identity })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── DELETE /api/mailbox/people/:id/identities/:identityId — Unlink an email ──
router.delete('/people/:id/identities/:identityId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const contactId = sanitizeUUID(req.params.id)
    const identityId = sanitizeUUID(req.params.identityId)
    if (!contactId || !identityId) return res.status(400).json({ error: 'Invalid contact or identity id' })

    const { data: contact, error: contactError } = await supabaseAdmin
      .from('mail_contacts')
      .select('id')
      .eq('id', contactId)
      .eq('user_id', req.userId!)
      .maybeSingle()
    if (contactError) throw contactError
    if (!contact) return res.status(404).json({ error: 'Contact not found' })

    const { data: identities, error: identitiesError } = await supabaseAdmin
      .from('mail_contact_identities')
      .select('id')
      .eq('contact_id', contactId)
    if (identitiesError) throw identitiesError
    if (!identities || identities.length <= 1) {
      return res.status(400).json({ error: 'A contact must keep at least one email identity' })
    }

    const { error: deleteError } = await supabaseAdmin
      .from('mail_contact_identities')
      .delete()
      .eq('id', identityId)
      .eq('contact_id', contactId)
    if (deleteError) throw deleteError

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── DELETE /api/mailbox/people/:id — Remove a contact entirely ──────────────
router.delete('/people/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const contactId = sanitizeUUID(req.params.id)
    if (!contactId) return res.status(400).json({ error: 'Invalid contact id' })

    const { error } = await supabaseAdmin
      .from('mail_contacts')
      .delete()
      .eq('id', contactId)
      .eq('user_id', req.userId!)

    if (error) throw error

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.get('/invitations', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const status = sanitizeString(req.query.status, 20)
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50))

    let query = supabaseAdmin
      .from('mail_invitations')
      .select('id, message_id, method, uid, sequence, recurrence_id, organizer, attendee_emails, starts_at, ends_at, summary, location, status, provider_event_ref, created_at')
      .eq('user_id', req.userId!)
      .order('starts_at', { ascending: true })
      .limit(limit)

    if (status && ['proposed', 'tentative', 'accepted', 'declined', 'cancelled', 'imported'].includes(status)) {
      query = query.eq('status', status)
    }

    const { data, error } = await query
    if (error) throw error

    // Fetch source email info for invitations that have a message_id
    interface MailInvitationRow {
      message_id: string | null
      [key: string]: unknown
    }

    interface InvitationSourceMessageRow {
      id: string
      account_id: string | null
      from_email: string | null
      received_at: string | null
      provider_metadata: unknown
    }

    const invitations = (data || []) as unknown as MailInvitationRow[]
    const messageIds = invitations.flatMap((invitation) => (
      typeof invitation.message_id === 'string' ? [invitation.message_id] : []
    ))

    const messagesByIdMap = new Map<string, { account_id: string | null; from_email: string | null; received_at: string | null; provider_metadata: unknown }>()
    if (messageIds.length > 0) {
      const { data: messages } = await supabaseAdmin
        .from('mail_messages')
        .select('id, account_id, from_email, received_at, provider_metadata')
        .in('id', messageIds)

      const sourceMessages = (messages || []) as unknown as InvitationSourceMessageRow[]
      if (sourceMessages.length > 0) {
        sourceMessages.forEach((message) => {
          messagesByIdMap.set(message.id, {
            account_id: message.account_id,
            from_email: message.from_email,
            received_at: message.received_at,
            provider_metadata: message.provider_metadata,
          })
        })
      }
    }

    const accounts = await getUserAccounts(req.userId!)
    const accountById = new Map(accounts.map(account => [account.id, account]))

    const enrichedInvitations = invitations.map((invitation) => {
      const sourceMessage = invitation.message_id ? messagesByIdMap.get(invitation.message_id) : null
      const sourceAccount = sourceMessage && sourceMessage.account_id
        ? accountById.get(sourceMessage.account_id) ?? null
        : null

      return {
        ...invitation,
        source_email: sourceMessage?.from_email || null,
        source_received_at: sourceMessage?.received_at || null,
        source_deleted: Boolean(
          sourceMessage && sourceAccount && isProviderMessageTrashed(sourceAccount.provider, sourceMessage.provider_metadata),
        ),
      }
    })

    res.json({ invitations: enrichedInvitations })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.patch('/invitations/:id/status', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const invitationId = sanitizeUUID(req.params.id)
    if (!invitationId) {
      return res.status(400).json({ error: 'Invalid invitation id' })
    }

    const status = sanitizeString(req.body.status, 20)?.toLowerCase()
    const allowedStatuses = new Set(['proposed', 'tentative', 'accepted', 'declined', 'cancelled', 'imported'])
    if (!status || !allowedStatuses.has(status)) {
      return res.status(400).json({ error: 'Invalid invitation status' })
    }

    const providerEventRef = sanitizeString(req.body.provider_event_ref, 255)

    const { data: updated, error } = await supabaseAdmin
      .from('mail_invitations')
      .update({
        status,
        provider_event_ref: providerEventRef || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', invitationId)
      .eq('user_id', req.userId!)
      .select('id, status, provider_event_ref')
      .maybeSingle()

    if (error) throw error
    if (!updated) {
      return res.status(404).json({ error: 'Invitation not found' })
    }

    await writeAuditEvent(req.userId!, 'user', 'update_invitation_status', 'mail_invitation', invitationId, 'success', `status:${status}`)

    return res.json({ success: true, invitation: updated })
  } catch (err) {
    return res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.post('/invitations/extract', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const accountId = sanitizeUUID(req.body.account_id)

    const accounts = await getUserAccounts(req.userId!)
    const eligible = accountId
      ? accounts.filter(account => account.id === accountId && account.status !== 'disconnected')
      : accounts.filter(account => account.status !== 'disconnected')

    if (eligible.length === 0) {
      if (accountId) {
        return res.status(404).json({ error: 'No eligible mailbox accounts found' })
      }
      // No connected accounts yet is a normal state (e.g. before the first OAuth connect), not an error.
      return res.json({ success: true, parsed: 0, changed: 0, removed: 0, accounts: 0 })
    }

    let parsed = 0
    let changed = 0
    let removed = 0
    for (const account of eligible) {
      const result = await extractInvitationsForAccount(account.id, req.userId!)
      parsed += result.parsed
      changed += result.insertedOrUpdated
      removed += result.removed
    }

    await writeAuditEvent(req.userId!, 'user', 'extract_invitations', 'mail_invitation', accountId || 'all', 'success', `parsed:${parsed},changed:${changed},removed:${removed}`)

    return res.json({ success: true, parsed, changed, removed, accounts: eligible.length })
  } catch (err) {
    return res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── Rules and Automations ───────────────────────────────────────────────────

const RULE_SELECT = 'id, user_id, account_id, name, conditions, actions, mode, stop_processing, created_at'
const AUTOMATION_RUN_MESSAGE_LIMIT = 500

function serializeRuleRow(row: MailRuleRow) {
  return { ...row, definition: fromRuleColumns(row) }
}

async function readAutomationRuleBody(userId: string, body: unknown): Promise<
  | { ok: true; accountId: string | null; definition: AutomationRuleDefinition }
  | { ok: false; status: number; error: string }
> {
  const payload = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>

  const accountId = sanitizeUUID(payload.account_id)
  if (accountId) {
    const account = await getOwnedAccount(userId, accountId)
    if (!account) return { ok: false, status: 404, error: 'Scoped account not found' }
  }

  const definition = normalizeAutomationRule(payload.definition ?? payload)
  if (!definition) return { ok: false, status: 400, error: 'A rule name and a valid step list are required' }

  return { ok: true, accountId: accountId || null, definition }
}

router.get('/rules', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('mail_rules')
      .select(RULE_SELECT)
      .eq('user_id', req.userId!)
      .order('created_at', { ascending: true })

    if (error) throw error

    res.json({ rules: ((data || []) as MailRuleRow[]).map(serializeRuleRow) })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.post('/rules', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = await readAutomationRuleBody(req.userId!, req.body)
    if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error })

    const { count, error: countError } = await supabaseAdmin
      .from('mail_rules')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', req.userId!)

    if (countError) throw countError
    if ((count || 0) >= MAX_AUTOMATION_RULES) {
      return res.status(409).json({ error: `Limit of ${MAX_AUTOMATION_RULES} automation rules reached` })
    }

    const columns = toRuleColumns(parsed.definition)
    const { data, error } = await supabaseAdmin
      .from('mail_rules')
      .insert({
        user_id: req.userId,
        account_id: parsed.accountId,
        name: parsed.definition.name,
        conditions: columns.conditions,
        actions: columns.actions,
        mode: parsed.definition.mode,
        stop_processing: parsed.definition.stopProcessing,
      })
      .select(RULE_SELECT)
      .single()

    if (error) throw error

    await writeAuditEvent(req.userId!, 'user', 'create_rule', 'mail_rule', data.id, 'success', undefined, data.account_id || undefined)

    res.status(201).json({ rule: serializeRuleRow(data as MailRuleRow) })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// Idempotent: gives the current user the default "Possible Phishing" tag and the two
// default scam-detection rules (created disabled) without touching any rule/tag they already have.
router.post('/rules/seed-defaults', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await ensureDefaultMailboxAutomationSetup(req.userId!)
    res.json({ tag_id: result.tagId, rules_created: result.rulesCreated })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.put('/rules/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ruleId = sanitizeUUID(req.params.id)
    if (!ruleId) return res.status(400).json({ error: 'Invalid rule id' })

    const parsed = await readAutomationRuleBody(req.userId!, req.body)
    if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error })

    const columns = toRuleColumns(parsed.definition)
    const { data, error } = await supabaseAdmin
      .from('mail_rules')
      .update({
        account_id: parsed.accountId,
        name: parsed.definition.name,
        conditions: columns.conditions,
        actions: columns.actions,
        mode: parsed.definition.mode,
        stop_processing: parsed.definition.stopProcessing,
        updated_at: new Date().toISOString(),
      })
      .eq('id', ruleId)
      .eq('user_id', req.userId!)
      .select(RULE_SELECT)
      .maybeSingle()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Rule not found' })

    await writeAuditEvent(req.userId!, 'user', 'update_rule', 'mail_rule', ruleId, 'success', undefined, data.account_id || undefined)

    res.json({ rule: serializeRuleRow(data as MailRuleRow) })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.delete('/rules/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ruleId = sanitizeUUID(req.params.id)
    if (!ruleId) return res.status(400).json({ error: 'Invalid rule id' })

    const { data, error } = await supabaseAdmin
      .from('mail_rules')
      .delete()
      .eq('id', ruleId)
      .eq('user_id', req.userId!)
      .select('id')
      .maybeSingle()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Rule not found' })

    await writeAuditEvent(req.userId!, 'user', 'delete_rule', 'mail_rule', ruleId, 'success')

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

router.post('/rules/run', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>
    const dryRun = parseBooleanInput(body.dry_run ?? body.dryRun, true)

    const requestedRuleIds = Array.isArray(body.rule_ids)
      ? body.rule_ids.map((value) => sanitizeUUID(value)).filter((value): value is string => Boolean(value))
      : []
    const requestedMessageIds = Array.isArray(body.message_ids)
      ? body.message_ids
          .map((value) => sanitizeUUID(value))
          .filter((value): value is string => Boolean(value))
          .slice(0, AUTOMATION_RUN_MESSAGE_LIMIT)
      : []

    let rulesQuery = supabaseAdmin
      .from('mail_rules')
      .select(RULE_SELECT)
      .eq('user_id', req.userId!)
      .order('created_at', { ascending: true })

    if (requestedRuleIds.length > 0) {
      rulesQuery = rulesQuery.in('id', requestedRuleIds)
    }

    const { data: ruleRows, error: rulesError } = await rulesQuery
    if (rulesError) throw rulesError

    const rules = ((ruleRows || []) as MailRuleRow[])
      .map((row) => ({ row, definition: fromRuleColumns(row) }))
      .filter((entry) => entry.definition.mode !== 'disabled')

    if (rules.length === 0) {
      return res.json({ dry_run: dryRun, evaluated_messages: 0, matches: [], evaluations: [], summary: { matched: 0, applied: 0, deferred: 0 } })
    }

    const result = await runMailboxAutomation(req.userId!, rules, {
      dryRun,
      messageIds: requestedMessageIds,
      accountId: sanitizeUUID(body.account_id) || null,
      limit: parseIntegerInput(body.limit, 200, 1, AUTOMATION_RUN_MESSAGE_LIMIT),
    })

    await writeAuditEvent(
      req.userId!,
      'user',
      dryRun ? 'automation_dry_run' : 'automation_run',
      'mail_rule',
      requestedRuleIds.join(',') || 'all',
      'success',
      `matched:${result.summary.matched},applied:${result.summary.applied}`,
    )

    res.json({ dry_run: dryRun, ...result })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

const EXECUTABLE_ACTION_SET = new Set<AutomationActionType>(
  // Manual mass-actions only cover mechanical, no-AI-call actions; agent_prompt
  // (AI drafting) is reserved for automation rules and the compose panel, where
  // it can carry per-message context/intent and its own usage accounting.
  EXECUTABLE_AUTOMATION_ACTIONS.filter((action) => action !== 'agent_prompt'),
)

const MAX_BULK_ACTION_STEPS = 20

interface BulkActionInput {
  action: AutomationActionType
  value: string
}

/** Reads the untrusted action list from a mass-action request, keeping only executable steps. */
function readBulkActionSteps(raw: unknown): BulkActionInput[] {
  if (!Array.isArray(raw)) return []

  const steps: BulkActionInput[] = []
  for (const entry of raw.slice(0, MAX_BULK_ACTION_STEPS)) {
    if (!entry || typeof entry !== 'object') continue
    const source = entry as Record<string, unknown>
    const action = sanitizeString(source.action, 40) as AutomationActionType
    if (!EXECUTABLE_ACTION_SET.has(action)) continue

    const value = action === 'add_tag' || action === 'remove_tag'
      ? sanitizeUUID(source.value) || ''
      : sanitizeString(source.value, 2000) || ''

    steps.push({ action, value })
  }

  return steps
}

/**
 * Applies a user-composed list of "Take action" steps to an explicit set of
 * messages -- the mass-action panel in the inbox. Unlike `/rules/run` this needs
 * no saved rule. Follow-up automations only run when the caller opts in.
 */
interface BulkActionOutcome {
  action_index: number
  action: AutomationActionType
  value: string
  status: 'applied' | 'uncertain' | 'unavailable'
  error?: string
}

interface BulkMessageOutcome {
  message_id: string
  actions: BulkActionOutcome[]
}

interface BulkActionWarning {
  code: 'ACTION_EVENT_NOT_RECORDED' | 'CASCADE_NOT_COMPLETED' | 'AUDIT_NOT_RECORDED'
  message_id?: string
  action_index?: number
}

router.post('/messages/bulk-action', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>

    const steps = readBulkActionSteps(body.actions)
    if (steps.length === 0) return res.status(400).json({ error: 'At least one executable action is required' })
    if (steps.some((step) => (step.action === 'add_tag' || step.action === 'remove_tag') && !step.value)) {
      return res.status(400).json({ error: 'A mailbox tag must be selected for every add tag or remove tag action' })
    }

    const messageIds = Array.isArray(body.message_ids)
      ? Array.from(new Set(body.message_ids
          .map((value) => sanitizeUUID(value))
          .filter((value): value is string => Boolean(value))))
          .slice(0, AUTOMATION_RUN_MESSAGE_LIMIT)
      : []
    if (messageIds.length === 0) return res.status(400).json({ error: 'At least one message id is required' })

    const cascade = parseBooleanInput(body.cascade, false)

    const accounts = await getUserAccounts(req.userId!)
    const accountById = new Map(accounts.map((account) => [account.id, account]))
    if (accountById.size === 0) return res.status(404).json({ error: 'No connected mail accounts' })

    // Scoping the query to the caller's own accounts is what enforces object-level authorization here.
    const { data: messageRows, error: messagesError } = await supabaseAdmin
      .from('mail_messages')
      .select('id, account_id, subject, from_email, from_name, to_emails, cc_emails, preview, body_text, is_read, is_archived, has_attachments, provider_message_id, provider_metadata')
      .in('id', messageIds)
      .in('account_id', [...accountById.keys()])

    if (messagesError) throw messagesError

    let applied = 0
    let failed = 0
    const errors: string[] = []
    const warnings: BulkActionWarning[] = []
    const results: BulkMessageOutcome[] = messageIds.map(messageId => ({
      message_id: messageId,
      actions: steps.map((step, actionIndex) => ({
        action_index: actionIndex,
        action: step.action,
        value: step.value,
        status: 'unavailable',
      })),
    }))
    const resultById = new Map(results.map(result => [result.message_id, result]))

    for (const row of (messageRows || []) as Array<Record<string, unknown>>) {
      const accountId = String(row.account_id)
      const account = accountById.get(accountId)
      if (!account) continue
      const result = resultById.get(String(row.id))
      if (!result) continue
      result.actions = []

      const providerMetadata = row.provider_metadata
      const message: AutomationMessage = {
        id: String(row.id),
        account_id: accountId,
        from_email: (row.from_email as string | null) ?? null,
        from_name: (row.from_name as string | null) ?? null,
        to_emails: (row.to_emails as string | null) ?? null,
        cc_emails: (row.cc_emails as string | null) ?? null,
        subject: (row.subject as string | null) ?? null,
        body_text: (row.body_text as string | null) ?? null,
        preview: (row.preview as string | null) ?? null,
        has_attachments: row.has_attachments === true,
        attachments: account.provider === 'gmail' ? listGmailAttachments(providerMetadata) : [],
        is_read: row.is_read === true,
        is_archived: row.is_archived === true,
        is_provider_trashed: isProviderMessageTrashed(account.provider, providerMetadata),
        user_tag_ids: extractUserTagIdsFromProviderMetadata(providerMetadata),
        account_address: account.address,
        identity_group: account.identity_group,
        recentActionEvents: [],
      }

      // Shared so a later action in the list cannot clobber an earlier one's metadata write.
      const metadataRef = { current: providerMetadata }
      const providerMessageId = typeof row.provider_message_id === 'string' && row.provider_message_id
        ? row.provider_message_id
        : extractProviderMessageId(providerMetadata)

      const chainId = randomUUID()
      let appliedForMessage = false

      for (const [actionIndex, step] of steps.entries()) {
        try {
          await applyAutomationAction(req.userId!, account, message, step.action, step.value, metadataRef, providerMessageId)
          applied += 1
          appliedForMessage = true
          result.actions.push({ action_index: actionIndex, action: step.action, value: step.value, status: 'applied' })
        } catch (actionError) {
          failed += 1
          const error = safeErrorMessage(actionError)
          result.actions.push({ action_index: actionIndex, action: step.action, value: step.value, status: 'uncertain', error })
          if (errors.length < 20) errors.push(`${step.action}: ${error}`)
          continue
        }
        try {
          await recordActionEvent({
            userId: req.userId!, accountId, messageId: message.id, action: step.action, value: step.value,
            source: 'manual', ruleId: null, chainId, depth: 0,
          })
        } catch {
          warnings.push({ code: 'ACTION_EVENT_NOT_RECORDED', message_id: message.id, action_index: actionIndex })
        }
      }

      if (cascade && appliedForMessage) {
        try {
          const cascadeWarnings = await triggerManualActionCascade(req.userId!, accountId, [message.id], chainId)
          if (cascadeWarnings.length > 0) warnings.push({ code: 'CASCADE_NOT_COMPLETED', message_id: message.id })
        } catch {
          warnings.push({ code: 'CASCADE_NOT_COMPLETED', message_id: message.id })
        }
      }
    }

    try {
      await writeAuditEvent(
        req.userId!,
        'user',
        'mailbox_bulk_action',
        'mail_message',
        `${messageIds.length} messages`,
        failed === 0 ? 'success' : 'failure',
        `actions:${steps.map((step) => step.action).join(',')},applied:${applied},failed:${failed}`,
        undefined,
        true,
      )
    } catch {
      warnings.push({ code: 'AUDIT_NOT_RECORDED' })
    }

    res.json({
      contract_version: 1,
      processed_messages: (messageRows || []).length,
      applied,
      failed,
      errors,
      results,
      warnings,
    })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

interface AutomationRunOptions {
  dryRun: boolean
  messageIds: string[]
  accountId: string | null
  limit: number
  /** Automatic new-mail runs skip rules that already applied to this message. */
  skipPreviouslyAppliedRules?: boolean
  /** Groups every action stemming from one trigger (a click or a run) for `mail_action_events`. */
  chainId?: string
}

interface AutomationMatchReport {
  rule_id: string
  rule_name: string
  message_id: string
  subject: string | null
  applied: string[]
  deferred: string[]
  errors: string[]
}

/** One entry per checked message, matched or not, so a preview can show every score. */
interface AutomationEvaluationReport {
  message_id: string
  subject: string | null
  matched: boolean
  /** 0..1 share of the best-scoring rule that this message satisfies. */
  confidence: number
  rule_id: string | null
  rule_name: string | null
  applied: string[]
  deferred: string[]
  errors: string[]
  /** Per-check outcome of the reported rule, so the preview can say why. */
  checks: Array<{
    step_id: string
    kind: 'condition' | 'receive_action'
    field: AutomationFieldId | null
    action: AutomationReceiveActionType | null
    passed: boolean
  }>
  /** What the AI judged for each assessment check on this message. */
  assessments: Array<{
    step_id: string
    score: number
    reasoning: string
    available: boolean
    input_summary: { hasBody: boolean; bodyChars: number; hasContext: boolean; hasIntent: boolean }
  }>
}

/** Caps the AI spend of a single run; messages past this get no assessment score. */
const AUTOMATION_MAX_ASSESSMENT_CALLS = 25

/** Caps the AI spend of a single run on draft generation (heavier calls than assessment). */
const AUTOMATION_MAX_DRAFT_CALLS = 15

function toCheckReports(evaluation: AutomationRuleMatch): AutomationEvaluationReport['checks'] {
  return evaluation.conditionResults.map((result) => ({
    step_id: result.stepId,
    kind: result.kind,
    field: result.field,
    action: result.action,
    passed: result.passed,
  }))
}

interface MailActionEventRow {
  message_id: string
  action: string
  action_value: string | null
  source_type: 'manual' | 'rule' | 'import'
  source_rule_id: string | null
}

/** A rule can only cascade this many times against the same message before the run gives up. */
const AUTOMATION_MAX_CASCADE_PASSES = 5

/** Loads every recorded action event for the given messages, grouped by message id. */
async function loadActionEventsForMessages(messageIds: string[]): Promise<Map<string, AutomationActionEvent[]>> {
  const grouped = new Map<string, AutomationActionEvent[]>()
  if (messageIds.length === 0) return grouped

  const { data, error } = await supabaseAdmin
    .from('mail_action_events')
    .select('message_id, action, action_value, source_type, source_rule_id')
    .in('message_id', messageIds)

  if (error) throw error

  for (const row of (data || []) as MailActionEventRow[]) {
    const event: AutomationActionEvent = {
      action: row.action as AutomationReceiveActionType,
      value: row.action_value || '',
      source: row.source_type,
      ruleId: row.source_rule_id,
    }
    grouped.set(row.message_id, [...(grouped.get(row.message_id) || []), event])
  }

  return grouped
}

/** Records that an action was applied to a message, so "Receive action" steps can react to it. */
async function recordActionEvent(params: {
  userId: string
  accountId: string
  messageId: string
  action: AutomationReceiveActionType
  value: string
  source: 'manual' | 'rule' | 'import'
  ruleId: string | null
  chainId: string
  depth: number
}): Promise<void> {
  const { error } = await supabaseAdmin.from('mail_action_events').insert({
    user_id: params.userId,
    account_id: params.accountId,
    message_id: params.messageId,
    action: params.action,
    action_value: params.value || null,
    source_type: params.source,
    source_rule_id: params.ruleId,
    chain_id: params.chainId,
    depth: params.depth,
  })
  if (error) throw error
}

/**
 * Evaluates rules against stored messages. Reply and forward actions are
 * reported but never executed in this release.
 *
 * Rules with an enabled "Receive action" step react to actions already
 * applied to a message. After each pass this re-evaluates every rule that
 * has not fired yet for a message so a chain (e.g. junk -> trash) can play
 * out, capped at `AUTOMATION_MAX_CASCADE_PASSES` passes. A rule that already
 * fired for a message in this run is never evaluated again for it, which is
 * what prevents an endless loop.
 */
function buildAutomationMessage(
  row: Record<string, unknown>,
  account: MailAccountRow,
  recentActionEvents: AutomationActionEvent[],
): AutomationMessage {
  const providerMetadata = row.provider_metadata
  return {
    id: String(row.id),
    account_id: String(row.account_id),
    thread_id: (row.thread_id as string | null) ?? null,
    from_email: (row.from_email as string | null) ?? null,
    from_name: (row.from_name as string | null) ?? null,
    to_emails: (row.to_emails as string | null) ?? null,
    cc_emails: (row.cc_emails as string | null) ?? null,
    subject: (row.subject as string | null) ?? null,
    body_text: (row.body_text as string | null) ?? null,
    preview: (row.preview as string | null) ?? null,
    has_attachments: row.has_attachments === true,
    attachments: account.provider === 'gmail' ? listGmailAttachments(providerMetadata) : [],
    is_read: row.is_read === true,
    is_archived: row.is_archived === true,
    is_provider_trashed: isProviderMessageTrashed(account.provider, providerMetadata),
    user_tag_ids: extractUserTagIdsFromProviderMetadata(providerMetadata),
    account_address: account.address,
    identity_group: account.identity_group,
    recentActionEvents,
    assessmentScores: {},
  }
}

async function runMailboxAutomation(
  userId: string,
  rules: Array<{ row: MailRuleRow; definition: AutomationRuleDefinition }>,
  options: AutomationRunOptions,
): Promise<{
  evaluated_messages: number
  matches: AutomationMatchReport[]
  evaluations: AutomationEvaluationReport[]
  summary: { matched: number; applied: number; deferred: number }
}> {
  const accounts = await getUserAccounts(userId)
  const accountById = new Map(accounts.map((account) => [account.id, account]))
  const accountIds = options.accountId && accountById.has(options.accountId)
    ? [options.accountId]
    : accounts.filter((account) => account.status !== 'disconnected').map((account) => account.id)

  if (accountIds.length === 0) {
    return { evaluated_messages: 0, matches: [], evaluations: [], summary: { matched: 0, applied: 0, deferred: 0 } }
  }

  let messagesQuery = supabaseAdmin
    .from('mail_messages')
    .select('id, account_id, thread_id, subject, from_email, from_name, to_emails, cc_emails, preview, body_text, is_read, is_archived, has_attachments, provider_message_id, provider_metadata')
    .in('account_id', accountIds)
    .order('received_at', { ascending: false })
    .limit(options.limit)

  if (options.messageIds.length > 0) {
    messagesQuery = messagesQuery.in('id', options.messageIds)
  }

  const { data: messageRows, error: messagesError } = await messagesQuery
  if (messagesError) throw messagesError

  const preparedRules = rules.map(rule => ({
    ...rule,
    assessmentSteps: rule.definition.steps.filter(
      (step): step is AutomationConditionStep => step.kind === 'condition' && step.enabled && step.field === 'assessment',
    ),
  }))
  const chainId = options.chainId || randomUUID()
  const hasReceiveActionSteps = rules.some(({ definition }) =>
    definition.steps.some((step) => step.kind === 'receive_action' && step.enabled))

  // The event log also records which rules have already applied to a message.
  const eventsByMessage = await loadActionEventsForMessages(
    (messageRows || []).map((row) => String((row as { id: string }).id)),
  )

  const matches: AutomationMatchReport[] = []
  const evaluations: AutomationEvaluationReport[] = []
  let appliedCount = 0
  let deferredCount = 0
  let assessmentCalls = 0
  // Shared across every message/rule in this run, so one run cannot fan out into
  // an unbounded number of AI draft-generation calls.
  const draftCallsRef = { current: 0 }

  for (const row of (messageRows || []) as Array<Record<string, unknown>>) {
    const accountId = String(row.account_id)
    const account = accountById.get(accountId)
    if (!account) continue

    const providerMetadata = row.provider_metadata
    const message = buildAutomationMessage(row, account, eventsByMessage.get(String(row.id)) || [])

    // Actions share one metadata reference so a later action cannot clobber an earlier one's write.
    const metadataRef = { current: providerMetadata }
    const providerMessageId = typeof row.provider_message_id === 'string' && row.provider_message_id
      ? row.provider_message_id
      : extractProviderMessageId(providerMetadata)

    // Loop guard: once a rule fires for this message in this run, it is never evaluated again for it.
    const firedRuleIds = new Set<string>()
    const maxPasses = hasReceiveActionSteps ? AUTOMATION_MAX_CASCADE_PASSES : 1
    const previouslyAppliedRuleIds = new Set(
      message.recentActionEvents
        .map((event) => event.ruleId)
        .filter((ruleId): ruleId is string => Boolean(ruleId)),
    )

    const evaluationReport: AutomationEvaluationReport = {
      message_id: message.id,
      subject: message.subject,
      matched: false,
      confidence: 0,
      rule_id: null,
      rule_name: null,
      applied: [],
      deferred: [],
      errors: [],
      checks: [],
      assessments: [],
    }

    // Cheap (non-AI) checks run first for every applicable rule; an AI assessment
    // step only runs when its rule's other checks have not already decided the
    // match, so a failing "all" rule or an already-matching "any" rule never
    // burns an AI call on this message.
    for (const { row: ruleRow, definition, assessmentSteps: ruleAssessmentSteps } of preparedRules) {
      if (ruleRow.account_id && ruleRow.account_id !== accountId) continue
      if (options.skipPreviouslyAppliedRules && previouslyAppliedRuleIds.has(ruleRow.id)) continue

      if (ruleAssessmentSteps.length === 0) continue

      if (cheapConditionsDecideRule(definition, message)) {
        for (const step of ruleAssessmentSteps) {
          evaluationReport.assessments.push({
            step_id: step.id,
            score: 0,
            reasoning: 'No AI call was made: this rule\'s other checks already decided the match.',
            available: false,
            input_summary: { hasBody: false, bodyChars: 0, hasContext: false, hasIntent: false },
          })
        }
        continue
      }

      for (const step of ruleAssessmentSteps) {
        if (assessmentCalls >= AUTOMATION_MAX_ASSESSMENT_CALLS) {
          evaluationReport.assessments.push({
            step_id: step.id,
            score: 0,
            reasoning: `No score was produced: this run already used its limit of ${AUTOMATION_MAX_ASSESSMENT_CALLS} AI assessments.`,
            available: false,
            input_summary: { hasBody: false, bodyChars: 0, hasContext: false, hasIntent: false },
          })
          continue
        }

        const usage = await checkAndRecordAiUsageForUserId(userId, 'mailbox_assessment')
        if (!usage.allowed) {
          evaluationReport.assessments.push({
            step_id: step.id,
            score: 0,
            reasoning: `No score was produced: today's mailbox assessment limit (${usage.limit} per day) has been reached. It resets tomorrow.`,
            available: false,
            input_summary: { hasBody: false, bodyChars: 0, hasContext: false, hasIntent: false },
          })
          continue
        }

        assessmentCalls += 1
        const outcome = await assessMessage({
          subject: message.subject,
          fromEmail: message.from_email,
          fromName: message.from_name,
          toEmails: message.to_emails,
          body: message.body_text || message.preview,
          context: step.assessmentContext || '',
          intent: step.assessmentIntent || '',
        })

        if (outcome.available) message.assessmentScores![step.id] = outcome.score
        evaluationReport.assessments.push({
          step_id: step.id,
          score: outcome.score,
          reasoning: outcome.reasoning,
          available: outcome.available,
          input_summary: outcome.inputSummary,
        })
      }
    }

    for (let pass = 0; pass < maxPasses; pass += 1) {
      let anyActionApplied = false

      for (const { row: ruleRow, definition } of rules) {
        if (ruleRow.account_id && ruleRow.account_id !== accountId) continue
        if (firedRuleIds.has(ruleRow.id)) continue
        if (options.skipPreviouslyAppliedRules && previouslyAppliedRuleIds.has(ruleRow.id)) continue

        const evaluation = evaluateAutomationRule(definition, message)
        if (!evaluationReport.matched && (evaluation.confidence > evaluationReport.confidence || evaluationReport.checks.length === 0)) {
          evaluationReport.confidence = Math.max(evaluationReport.confidence, evaluation.confidence)
          evaluationReport.rule_id = ruleRow.id
          evaluationReport.rule_name = definition.name
          evaluationReport.checks = toCheckReports(evaluation)
        }
        if (!evaluation.matched) continue

        firedRuleIds.add(ruleRow.id)

        const report: AutomationMatchReport = {
          rule_id: ruleRow.id,
          rule_name: definition.name,
          message_id: message.id,
          subject: message.subject,
          applied: [],
          deferred: evaluation.deferredActions.map((step) => step.action),
          errors: [],
        }
        deferredCount += report.deferred.length

        const shouldExecute = !options.dryRun && definition.mode === 'active'
        for (const step of evaluation.actions) {
          if (!shouldExecute) {
            report.applied.push(`${step.action} (preview)`)
            continue
          }

          try {
            await applyAutomationAction(userId, account, message, step.action, step.value, metadataRef, providerMessageId, {
              context: step.agentContext,
              intent: step.agentIntent,
              draftCallsRef,
            })
            report.applied.push(step.action)
            appliedCount += 1
            anyActionApplied = true

            const event: AutomationActionEvent = { action: step.action, value: step.value, source: 'rule', ruleId: ruleRow.id }
            message.recentActionEvents = [...message.recentActionEvents, event]
            await recordActionEvent({
              userId, accountId, messageId: message.id, action: step.action, value: step.value,
              source: 'rule', ruleId: ruleRow.id, chainId, depth: pass,
            })
          } catch (actionError) {
            report.errors.push(`${step.action}: ${safeErrorMessage(actionError)}`)
          }
        }

        matches.push(report)
        if (!evaluationReport.matched) {
          evaluationReport.matched = true
          evaluationReport.confidence = evaluation.confidence
          evaluationReport.rule_id = ruleRow.id
          evaluationReport.rule_name = definition.name
          evaluationReport.checks = toCheckReports(evaluation)
        }
        evaluationReport.applied.push(...report.applied)
        evaluationReport.deferred.push(...report.deferred)
        evaluationReport.errors.push(...report.errors)
        if (definition.stopProcessing) break
      }

      if (!anyActionApplied) break
    }

    evaluations.push(evaluationReport)
  }

  return {
    evaluated_messages: (messageRows || []).length,
    matches,
    evaluations,
    summary: { matched: matches.length, applied: appliedCount, deferred: deferredCount },
  }
}

async function applyAutomationAction(
  userId: string,
  account: MailAccountRow,
  message: AutomationMessage,
  action: AutomationActionType,
  value: string,
  metadataRef: { current: unknown },
  providerMessageId: string | null,
  agentOptions?: { context?: string; intent?: string; draftCallsRef?: { current: number } },
): Promise<void> {
  const nowIso = new Date().toISOString()

  if (action === 'archive' || action === 'unarchive') {
    const isArchived = action === 'archive'
    if (providerMessageId) {
      try {
        await setProviderMessageArchivedState(account, providerMessageId, isArchived)
      } catch (moveError) {
        if (!(moveError instanceof ProviderItemGoneError)) throw moveError
        // Provider already deleted/moved this message outside the app -- treat as satisfied instead of erroring.
      }
    }
    const { error } = await supabaseAdmin
      .from('mail_messages')
      .update({ is_archived: isArchived, updated_at: nowIso })
      .eq('id', message.id)
    if (error) throw error
    message.is_archived = isArchived
    return
  }

  if (action === 'mark_read' || action === 'mark_unread') {
    const isRead = action === 'mark_read'
    if (providerMessageId) {
      await setProviderMessageReadState(account, providerMessageId, isRead)
    }
    const { error } = await supabaseAdmin
      .from('mail_messages')
      .update({ is_read: isRead, updated_at: nowIso })
      .eq('id', message.id)
    if (error) throw error
    message.is_read = isRead
    return
  }

  if (action === 'trash') {
    if (message.is_provider_trashed) return
    if (!providerMessageId) throw new Error('Message does not have a provider message id')

    try {
      await moveMessageToProviderTrash(account, providerMessageId)
    } catch (moveError) {
      if (!(moveError instanceof ProviderItemGoneError)) throw moveError
      // Provider already deleted/moved this message outside the app -- treat "trash" as satisfied instead of erroring.
    }
    const nextMetadata = (metadataRef.current && typeof metadataRef.current === 'object')
      ? { ...(metadataRef.current as Record<string, unknown>) }
      : {}
    nextMetadata.provider_trashed = true

    const { error } = await supabaseAdmin
      .from('mail_messages')
      .update({ provider_metadata: nextMetadata, updated_at: nowIso })
      .eq('id', message.id)
    if (error) throw error
    metadataRef.current = nextMetadata
    message.is_provider_trashed = true
    return
  }

  if (action === 'junk') {
    const entry = normalizeJunkEntry(message.from_email)
    if (!entry) throw new Error('Sender address could not be normalized for the junk list')

    const { data: prefs, error: readError } = await supabaseAdmin
      .from('mail_user_preferences')
      .select('junk_domains')
      .eq('user_id', userId)
      .maybeSingle()
    if (readError) throw readError

    const current = normalizeJunkEntryList((prefs as MailUserPreferencesRow | null)?.junk_domains || [])
    if (current.includes(entry)) return

    const { error } = await supabaseAdmin
      .from('mail_user_preferences')
      .upsert({ user_id: userId, junk_domains: normalizeJunkEntryList([...current, entry]), updated_at: nowIso }, { onConflict: 'user_id' })
    if (error) throw error
    await removeContactsMatchingJunkEntries(userId, [entry])
    return
  }

  if (action === 'add_tag' || action === 'remove_tag') {
    const tagId = sanitizeUUID(value)
    if (!tagId) throw new Error('A mailbox tag must be selected for this action')

    const { data: prefs, error: prefsError } = await supabaseAdmin
      .from('mail_user_preferences')
      .select('mailbox_tags')
      .eq('user_id', userId)
      .maybeSingle()
    if (prefsError) throw prefsError

    const knownTags = normalizeMailboxTagList((prefs as Pick<MailUserPreferencesRow, 'mailbox_tags'> | null)?.mailbox_tags || [])
    if (!knownTags.some((tag) => tag.id === tagId)) throw new Error('Selected mailbox tag no longer exists')

    const nextTagIds = action === 'add_tag'
      ? Array.from(new Set([...message.user_tag_ids, tagId]))
      : message.user_tag_ids.filter((entry) => entry !== tagId)

    const nextMetadata = setUserTagIdsInProviderMetadata(metadataRef.current, nextTagIds)
    const { error } = await supabaseAdmin
      .from('mail_messages')
      .update({ provider_metadata: nextMetadata, updated_at: nowIso })
      .eq('id', message.id)
    if (error) throw error
    metadataRef.current = nextMetadata
    message.user_tag_ids = nextTagIds
    return
  }

  if (action === 'agent_prompt') {
    // Always creates a mail_drafts row for human review -- never sends or forwards anything.
    const draftCallsRef = agentOptions?.draftCallsRef ?? { current: 0 }
    if (draftCallsRef.current >= AUTOMATION_MAX_DRAFT_CALLS) {
      throw new Error(`AI draft skipped: this run already used its limit of ${AUTOMATION_MAX_DRAFT_CALLS} AI drafts`)
    }

    const bodySource = message.body_text || message.preview
    if (!bodySource) throw new Error('AI draft skipped: message has no body text to draft a reply from')

    const usage = await checkAndRecordAiUsageForUserId(userId, 'mailbox_draft')
    if (!usage.allowed) {
      throw new Error(`AI draft skipped: today's mailbox draft limit (${usage.limit} per day) has been reached`)
    }
    draftCallsRef.current += 1

    const generated = await generateDraftReply({
      subject: message.subject,
      fromEmail: message.from_email,
      fromName: message.from_name,
      toEmails: message.to_emails,
      body: bodySource,
      context: agentOptions?.context || '',
      intent: agentOptions?.intent || value || '',
    })
    if (!generated.available) throw new Error(generated.reasoning)

    const { error } = await supabaseAdmin
      .from('mail_drafts')
      .insert({
        user_id: userId,
        account_id: account.id,
        thread_id: message.thread_id || null,
        in_reply_to_message_id: message.id,
        mode: 'reply',
        from_address: account.address,
        to_emails: message.from_email,
        subject: generated.subject,
        body_text: generated.bodyText,
        status: 'draft',
        created_at: nowIso,
        updated_at: nowIso,
      })
    if (error) throw error
    return
  }

  throw new Error(`Action ${action} is not executable in this release`)
}

/** Resolves provider ids returned by the sync into owned database message ids. */
async function findSyncedMessageIds(accountId: string, providerMessageIds: string[]): Promise<string[]> {
  if (providerMessageIds.length === 0) return []

  const { data, error } = await supabaseAdmin
    .from('mail_messages')
    .select('id')
    .eq('account_id', accountId)
    .in('provider_message_id', providerMessageIds)

  if (error) throw error
  return (data || []).map(row => String(row.id))
}

/** Existing messages only run receive-action rules when their provider state changes. */
async function runSyncedMessageAutomation(userId: string, accountId: string, providerMessageIds: string[], junkTransitionsOnly = false) {
  try {
    const messageIds = await findSyncedMessageIds(accountId, providerMessageIds)
    if (messageIds.length === 0) return { matched: 0, applied: 0, deferred: 0 }

    await recordImportedMailboxStateEvents(userId, accountId, messageIds, junkTransitionsOnly)

    const { data, error } = await supabaseAdmin
      .from('mail_rules')
      .select(RULE_SELECT)
      .eq('user_id', userId)
      .order('created_at', { ascending: true })

    if (error) throw error

    const rules = ((data || []) as MailRuleRow[])
      .map((row) => ({ row, definition: fromRuleColumns(row) }))
      .filter((entry) => entry.definition.mode === 'active')
      .filter((entry) => !junkTransitionsOnly || entry.definition.steps.some(
        (step) => step.kind === 'receive_action' && step.enabled,
      ))

    if (rules.length === 0) return { matched: 0, applied: 0, deferred: 0 }

    const result = await runMailboxAutomation(userId, rules, {
      dryRun: false,
      messageIds,
      accountId,
      limit: messageIds.length,
    })

    const failedMessageIds = result.evaluations
      .filter((evaluation) => evaluation.errors.length > 0)
      .map((evaluation) => evaluation.message_id)

    if (failedMessageIds.length > 0) {
      console.warn(
        '[MAILBOX-API] Sync automation had action errors, retrying once:',
        result.evaluations
          .filter((evaluation) => evaluation.errors.length > 0)
          .map((evaluation) => `${evaluation.message_id}: ${evaluation.errors.join('; ')}`)
          .join(' | '),
      )

      // Actions are idempotent (trash/add_tag no-op if already applied), so a single
      // retry can recover from transient errors (e.g. provider rate limits) without
      // risking duplicate side effects.
      const retryResult = await runMailboxAutomation(userId, rules, {
        dryRun: false,
        messageIds: failedMessageIds,
        accountId,
        limit: failedMessageIds.length,
      })

      const stillFailing = retryResult.evaluations.filter((evaluation) => evaluation.errors.length > 0)
      if (stillFailing.length > 0) {
        console.warn(
          '[MAILBOX-API] Sync automation still failing after retry:',
          stillFailing.map((evaluation) => `${evaluation.message_id}: ${evaluation.errors.join('; ')}`).join(' | '),
        )
      }

      return {
        matched: result.summary.matched,
        applied: result.summary.applied + retryResult.summary.applied,
        deferred: result.summary.deferred,
      }
    }

    return result.summary
  } catch (err) {
    console.warn('[MAILBOX-API] Sync automation failed:', safeErrorMessage(err))
    return { matched: 0, applied: 0, deferred: 0 }
  }
}

/** Records initial provider state, or just a newly observed Junk transition. */
async function recordImportedMailboxStateEvents(userId: string, accountId: string, messageIds: string[], junkTransitionsOnly = false): Promise<void> {
  const account = await getOwnedAccount(userId, accountId)
  if (!account || messageIds.length === 0) return

  const { data, error } = await supabaseAdmin
    .from('mail_messages')
    .select('id, from_email, is_archived, provider_metadata')
    .eq('account_id', accountId)
    .in('id', messageIds)
  if (error) throw error
  const { data: preferences, error: preferencesError } = await supabaseAdmin
    .from('mail_user_preferences')
    .select('junk_domains')
    .eq('user_id', userId)
    .maybeSingle()
  if (preferencesError) throw preferencesError
  const junkEntries = new Set(normalizeJunkEntryList((preferences as MailUserPreferencesRow | null)?.junk_domains || []))

  for (const row of (data || []) as Array<{ id: string; from_email: string | null; is_archived: boolean; provider_metadata: unknown }>) {
    const actions: AutomationReceiveActionType[] = []
    if (isProviderMessageJunk(account.provider, row.provider_metadata)) actions.push('import_junk')
    else if (!junkTransitionsOnly && row.from_email && isJunkEmail(row.from_email.toLowerCase(), junkEntries)) actions.push('junk')
    if (!junkTransitionsOnly && isProviderMessageTrashed(account.provider, row.provider_metadata)) actions.push('import_trash')
    if (!junkTransitionsOnly && row.is_archived) actions.push('import_archived')

    const chainId = randomUUID()
    for (const action of actions) {
      await recordActionEvent({
        userId,
        accountId,
        messageId: row.id,
        action,
        value: '',
        source: 'import',
        ruleId: null,
        chainId,
        depth: 0,
      })
    }
  }
}

setMailboxSyncAutomationHook(async ({ userId, accountId, newMessageProviderIds, junkedProviderMessageIds }) => {
  const inserted = await runSyncedMessageAutomation(userId, accountId, newMessageProviderIds)
  const insertedIds = new Set(newMessageProviderIds)
  const transitionedIds = (junkedProviderMessageIds || []).filter(id => !insertedIds.has(id))
  if (transitionedIds.length === 0) return inserted
  const changed = await runSyncedMessageAutomation(userId, accountId, transitionedIds, true)
  return {
    matched: inserted.matched + changed.matched,
    applied: inserted.applied + changed.applied,
    deferred: inserted.deferred + changed.deferred,
  }
})

/**
 * Re-evaluates only the rules that have an enabled "Receive action" step
 * against a single message, immediately after a manual mailbox action. Rules
 * without such a step are skipped entirely so an ordinary click never pays
 * for an automation pass. Failures are logged and swallowed -- the manual
 * action the user requested has already succeeded and must not be undone by
 * a cascade error. Return warnings so callers can distinguish partial success.
 */
async function triggerManualActionCascade(userId: string, accountId: string, messageIds: string[], chainId: string): Promise<string[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('mail_rules')
      .select(RULE_SELECT)
      .eq('user_id', userId)
      .order('created_at', { ascending: true })

    if (error) throw error

    const rules = ((data || []) as MailRuleRow[])
      .map((row) => ({ row, definition: fromRuleColumns(row) }))
      .filter((entry) => entry.definition.mode !== 'disabled'
        && entry.definition.steps.some((step) => step.kind === 'receive_action' && step.enabled))

    if (rules.length === 0) return []

    const result = await runMailboxAutomation(userId, rules, {
      dryRun: false,
      messageIds,
      accountId,
      limit: messageIds.length,
      chainId,
    })
    const warnings = result.evaluations.flatMap(evaluation => evaluation.errors)
    if (warnings.length > 0) console.warn('[MAILBOX-API] Manual action cascade had action errors:', warnings.join('; '))
    return warnings
  } catch (err) {
    console.warn('[MAILBOX-API] Manual action cascade failed:', safeErrorMessage(err))
    return [safeErrorMessage(err)]
  }
}

/** Records a manual mailbox action and lets any "Receive action" rule react to it. */
async function handleManualMailboxAction(
  userId: string,
  accountId: string,
  messageId: string,
  action: AutomationActionType,
  value = '',
): Promise<void> {
  await handleManualMailboxActions(userId, [{ accountId, messageId }], action, value)
}

async function handleManualMailboxActions(
  userId: string,
  messages: Array<{ accountId: string; messageId: string }>,
  action: AutomationActionType,
  value = '',
): Promise<string[]> {
  const chainId = randomUUID()
  const warnings: string[] = []
  const messageIdsByAccount = new Map<string, string[]>()
  for (const message of messages) {
    try {
      await recordActionEvent({
        userId,
        accountId: message.accountId,
        messageId: message.messageId,
        action,
        value,
        source: 'manual',
        ruleId: null,
        chainId,
        depth: 0,
      })
      messageIdsByAccount.set(message.accountId, [
        ...(messageIdsByAccount.get(message.accountId) || []),
        message.messageId,
      ])
    } catch (err) {
      console.warn('[MAILBOX-API] Failed to record manual mailbox action event:', safeErrorMessage(err))
      warnings.push(safeErrorMessage(err))
    }
  }

  for (const [accountId, messageIds] of messageIdsByAccount) {
    warnings.push(...await triggerManualActionCascade(userId, accountId, messageIds, chainId))
  }
  return warnings
}

// ─── Analytics ───────────────────────────────────────────────────────────────

router.get('/analytics', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await computeMailboxAnalytics(req.userId!)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── Controlled AI Retrieval ─────────────────────────────────────────────────

router.post('/ai/retrieve', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const query = sanitizeString(req.body.query, 200)
    if (!query) return res.status(400).json({ error: 'query is required' })

    const accounts = await getUserAccounts(req.userId!)
    const accountIds = accounts.filter(account => account.status !== 'disconnected').map(account => account.id)

    if (accountIds.length === 0) {
      return res.json({ results: [] })
    }

    const limit = Math.min(20, Math.max(1, Number(req.body.limit) || 8))

    const { data, error } = await supabaseAdmin
      .from('mail_messages')
      .select('id, account_id, thread_id, subject, from_email, received_at, preview, body_text')
      .in('account_id', accountIds)
      .or(`subject.ilike.%${query}%,from_email.ilike.%${query}%,preview.ilike.%${query}%,body_text.ilike.%${query}%`)
      .order('received_at', { ascending: false })
      .limit(limit)

    if (error) throw error

    const results = (data || []).map(message => ({
      id: message.id,
      thread_id: message.thread_id,
      account_id: message.account_id,
      subject: message.subject,
      from_email: message.from_email,
      received_at: message.received_at,
      preview: message.preview,
      snippet: (message.body_text || message.preview || '').slice(0, 400),
    }))

    await writeAuditEvent(req.userId!, 'ai_retrieval_api', 'search_mail', 'mail_query', query, 'success', `results:${results.length}`)

    res.json({ results })
  } catch (err) {
    await writeAuditEvent(req.userId!, 'ai_retrieval_api', 'search_mail', 'mail_query', 'unknown', 'failure', safeErrorMessage(err))
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── Audit ────────────────────────────────────────────────────────────────────

router.get('/audit', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100))

    const { data, error } = await supabaseAdmin
      .from('mail_audit_events')
      .select('id, account_id, actor, operation, target_type, target_id, outcome, reason, created_at')
      .eq('user_id', req.userId!)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) throw error

    res.json({ events: data || [] })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

export default router
