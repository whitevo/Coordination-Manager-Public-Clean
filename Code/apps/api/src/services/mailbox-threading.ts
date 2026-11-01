import { createHash } from 'node:crypto'
import { supabaseAdmin } from '../supabaseClient.js'

export interface ThreadingMessage {
  id: string
  providerMessageId: string
  providerThreadId: string | null
  subject: string | null
  fromEmail: string | null
  receivedAt: string | null
  replyTo: string | null
}

export interface MailboxThreadingOptions {
  sameNameAndEmail: boolean
  sameNameAndEmailDays?: number
  sameNameWithoutReply: boolean
  sameNameWithoutReplyDays?: number
  sameNameWithinSevenDays: boolean
  sameNameWithinDays?: number
  sameEmailWithoutReply: boolean
  sameEmailWithoutReplyDays?: number
  sameEmailWithinSevenDays: boolean
  sameEmailWithinDays?: number
}

export const DEFAULT_MAILBOX_THREADING_OPTIONS: MailboxThreadingOptions = {
  sameNameAndEmail: false,
  sameNameAndEmailDays: 7,
  sameNameWithoutReply: false,
  sameNameWithoutReplyDays: 7,
  sameNameWithinSevenDays: false,
  sameNameWithinDays: 7,
  sameEmailWithoutReply: false,
  sameEmailWithoutReplyDays: 7,
  sameEmailWithinSevenDays: false,
  sameEmailWithinDays: 7,
}

export function normalizeMailboxThreadingOptions(value: unknown): MailboxThreadingOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_MAILBOX_THREADING_OPTIONS
  }

  const candidate = value as Record<string, unknown>
  return {
    sameNameAndEmail: readBooleanOption(candidate, 'sameNameAndEmail', 'sameNameAndDomain'),
    sameNameAndEmailDays: normalizeThreadingDays(candidate.sameNameAndEmailDays ?? candidate.sameNameAndDomainDays),
    sameNameWithoutReply: candidate.sameNameWithoutReply === true,
    sameNameWithoutReplyDays: normalizeThreadingDays(candidate.sameNameWithoutReplyDays),
    sameNameWithinSevenDays: candidate.sameNameWithinSevenDays === true,
    sameNameWithinDays: Number.isFinite(Number(candidate.sameNameWithinDays))
      ? Math.min(60, Math.max(1, Math.floor(Number(candidate.sameNameWithinDays))))
      : 7,
    sameEmailWithoutReply: readBooleanOption(candidate, 'sameEmailWithoutReply', 'sameDomainWithoutReply'),
    sameEmailWithoutReplyDays: normalizeThreadingDays(candidate.sameEmailWithoutReplyDays ?? candidate.sameDomainWithoutReplyDays),
    sameEmailWithinSevenDays: readBooleanOption(candidate, 'sameEmailWithinSevenDays', 'sameDomainWithinSevenDays'),
    sameEmailWithinDays: Number.isFinite(Number(candidate.sameEmailWithinDays ?? candidate.sameDomainWithinDays))
      ? Math.min(60, Math.max(1, Math.floor(Number(candidate.sameEmailWithinDays ?? candidate.sameDomainWithinDays))))
      : 7,
  }
}

function readBooleanOption(
  candidate: Record<string, unknown>,
  currentKey: string,
  legacyKey: string,
): boolean {
  if (typeof candidate[currentKey] === 'boolean') return candidate[currentKey] === true
  return candidate[legacyKey] === true
}

function normalizeThreadingDays(value: unknown): number {
  const days = Number(value)
  return Number.isFinite(days) ? Math.min(60, Math.max(1, Math.floor(days))) : 7
}

const REPLY_PREFIX_RE = /^(?:(?:re|fw|fwd)\s*:\s*)+/i
const NO_REPLY_LOCAL_PART_RE = /^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer[-_.]?daemon)(?:[-_.].*)?$/i

export function normalizeThreadSubject(subject: string | null | undefined): string {
  return (subject || '')
    .trim()
    .normalize('NFKC')
    .replace(REPLY_PREFIX_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase()
}

export function normalizeThreadingEmail(email: string | null | undefined): string | null {
  const value = (email || '').trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+$/.test(value) ? value : null
}

export function hasNoReplyAddress(message: Pick<ThreadingMessage, 'fromEmail' | 'replyTo'>): boolean {
  const getLocalPart = (value: string | null | undefined): string => {
    const address = value?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || value || ''
    return address.trim().split('@')[0] || ''
  }
  const senderLocalPart = getLocalPart(message.fromEmail)
  const replyToLocalPart = getLocalPart(message.replyTo)
  return NO_REPLY_LOCAL_PART_RE.test(senderLocalPart) || NO_REPLY_LOCAL_PART_RE.test(replyToLocalPart)
}

export function canMergeMessages(
  left: ThreadingMessage,
  right: ThreadingMessage,
  options: MailboxThreadingOptions,
): boolean {
  const leftSubject = normalizeThreadSubject(left.subject)
  const sameNameAndEmailDays = options.sameNameAndEmailDays ?? 7
  const sameNameWithoutReplyDays = options.sameNameWithoutReplyDays ?? 7
  const sameEmailWithoutReplyDays = options.sameEmailWithoutReplyDays ?? 7
  const sameNameWithinDays = options.sameNameWithinDays ?? 7
  const sameSenderEmail = Boolean(
    normalizeThreadingEmail(left.fromEmail) &&
    normalizeThreadingEmail(left.fromEmail) === normalizeThreadingEmail(right.fromEmail),
  )
  const bothWithoutReply = hasNoReplyAddress(left) && hasNoReplyAddress(right)
  const receivedWithinDays = (days: number): boolean => {
    if (!left.receivedAt || !right.receivedAt) return false
    const difference = Math.abs(Date.parse(left.receivedAt) - Date.parse(right.receivedAt))
    return Number.isFinite(difference) && difference < days * 24 * 60 * 60 * 1000
  }

  if (options.sameEmailWithoutReply && sameSenderEmail && bothWithoutReply && receivedWithinDays(sameEmailWithoutReplyDays)) return true

  if (options.sameEmailWithinSevenDays && sameSenderEmail && receivedWithinDays(options.sameEmailWithinDays ?? 7)) return true

  if (!leftSubject || leftSubject !== normalizeThreadSubject(right.subject)) return false

  if (options.sameNameAndEmail && sameSenderEmail && receivedWithinDays(sameNameAndEmailDays)) return true

  if (options.sameNameWithoutReply && bothWithoutReply && receivedWithinDays(sameNameWithoutReplyDays)) return true
  if (options.sameNameWithinSevenDays && receivedWithinDays(sameNameWithinDays)) return true
  return false
}

export function buildAppThreadId(accountId: string, messages: ThreadingMessage[]): string {
  const key = messages
    .map((message) => message.providerMessageId)
    .sort()
    .join('|')
  return `app:${createHash('sha256').update(`${accountId}|${key}`).digest('hex').slice(0, 32)}`
}

export function readReplyTo(providerMetadata: unknown): string | null {
  if (!providerMetadata || typeof providerMetadata !== 'object') return null
  const metadata = providerMetadata as Record<string, unknown>
  const providerMessage = metadata.provider_message
  if (!providerMessage || typeof providerMessage !== 'object') return null
  const message = providerMessage as Record<string, unknown>

  if (Array.isArray(message.replyTo)) {
    const address = message.replyTo.find((entry) => {
      if (!entry || typeof entry !== 'object') return false
      const email = (entry as Record<string, unknown>).emailAddress
      return Boolean(email && typeof email === 'object' && typeof (email as Record<string, unknown>).address === 'string')
    }) as Record<string, unknown> | undefined
    const email = address?.emailAddress
    if (email && typeof email === 'object' && typeof (email as Record<string, unknown>).address === 'string') {
      return (email as Record<string, string>).address
    }
  }

  const payload = message.payload
  const headers = payload && typeof payload === 'object' ? (payload as Record<string, unknown>).headers : null
  if (Array.isArray(headers)) {
    const header = headers.find((entry) => {
      if (!entry || typeof entry !== 'object') return false
      return String((entry as Record<string, unknown>).name || '').toLocaleLowerCase() === 'reply-to'
    }) as Record<string, unknown> | undefined
    return typeof header?.value === 'string' ? header.value : null
  }

  return null
}

interface ThreadingCandidateRow {
  id: string
  subject: string | null
  from_email: string | null
  received_at: string | null
  meta_gmail_headers: unknown
  meta_outlook_reply_to: unknown
}

export async function findBroadThreadMessageIds(
  accountIds: string[],
  source: ThreadingMessage,
  options: MailboxThreadingOptions,
): Promise<string[]> {
  const email = normalizeThreadingEmail(source.fromEmail)
  const sourceTime = source.receivedAt ? Date.parse(source.receivedAt) : Number.NaN
  const sameNameWithoutReplyDays = options.sameNameWithoutReplyDays ?? 7
  const sameNameWithinDays = options.sameNameWithinDays ?? 7
  const sameEmailWithinDays = options.sameEmailWithinDays ?? 7
  const shouldUseSubjectAndEmail = options.sameNameAndEmail
  const shouldUseSubjectWithinDays = options.sameNameWithinSevenDays && Number.isFinite(sourceTime)
  const shouldUseSubjectWithoutReply = options.sameNameWithoutReply && Number.isFinite(sourceTime)
  const shouldUseNoReply = options.sameEmailWithoutReply && hasNoReplyAddress(source)
  const shouldUseWithinDays = options.sameEmailWithinSevenDays && Number.isFinite(sourceTime)
  if (!email && !shouldUseSubjectWithinDays && !shouldUseSubjectWithoutReply) return [source.id]
  if (
    !shouldUseSubjectAndEmail &&
    !shouldUseSubjectWithinDays &&
    !shouldUseSubjectWithoutReply &&
    !shouldUseNoReply &&
    !shouldUseWithinDays
  ) return [source.id]

  const candidateQueries: Array<PromiseLike<{ data: unknown; error: unknown }>> = []
  const select = 'id, subject, from_email, received_at, meta_gmail_headers:provider_metadata->provider_message->payload->headers, meta_outlook_reply_to:provider_metadata->provider_message->replyTo'

  if (email && (shouldUseSubjectAndEmail || shouldUseNoReply)) {
    candidateQueries.push(
      supabaseAdmin
        .from('mail_messages')
        .select(select)
        .in('account_id', accountIds)
        .ilike('from_email', escapeLikePattern(email))
        .then((result) => result as { data: unknown; error: unknown }),
    )
  }

  if (email && shouldUseWithinDays) {
    const rangeMs = sameEmailWithinDays * 24 * 60 * 60 * 1000
    const rangeStart = new Date(sourceTime - rangeMs).toISOString()
    const rangeEnd = new Date(sourceTime + rangeMs).toISOString()
    candidateQueries.push(
      supabaseAdmin
        .from('mail_messages')
        .select(select)
        .in('account_id', accountIds)
        .ilike('from_email', escapeLikePattern(email))
        .gte('received_at', rangeStart)
        .lte('received_at', rangeEnd)
        .then((result) => result as { data: unknown; error: unknown }),
    )
  }

  if (shouldUseSubjectWithinDays) {
    const rangeMs = sameNameWithinDays * 24 * 60 * 60 * 1000
    const rangeStart = new Date(sourceTime - rangeMs).toISOString()
    const rangeEnd = new Date(sourceTime + rangeMs).toISOString()
    candidateQueries.push(
      supabaseAdmin
        .from('mail_messages')
        .select(select)
        .in('account_id', accountIds)
        .gte('received_at', rangeStart)
        .lte('received_at', rangeEnd)
        .then((result) => result as { data: unknown; error: unknown }),
    )
  }

  if (shouldUseSubjectWithoutReply) {
    const rangeMs = sameNameWithoutReplyDays * 24 * 60 * 60 * 1000
    const rangeStart = new Date(sourceTime - rangeMs).toISOString()
    const rangeEnd = new Date(sourceTime + rangeMs).toISOString()
    candidateQueries.push(
      supabaseAdmin
        .from('mail_messages')
        .select(select)
        .in('account_id', accountIds)
        .gte('received_at', rangeStart)
        .lte('received_at', rangeEnd)
        .then((result) => result as { data: unknown; error: unknown }),
    )
  }

  const results = await Promise.all(candidateQueries)
  const ids = new Set<string>([source.id])
  for (const result of results) {
    if (result.error) throw result.error
    for (const row of (result.data || []) as ThreadingCandidateRow[]) {
      const replyTo = row.meta_outlook_reply_to || row.meta_gmail_headers
      const candidate: ThreadingMessage = {
        id: row.id,
        providerMessageId: row.id,
        providerThreadId: null,
        subject: row.subject,
        fromEmail: row.from_email,
        receivedAt: row.received_at,
        replyTo: readReplyTo({ provider_message: { replyTo, payload: { headers: row.meta_gmail_headers } } }),
      }
      if (canMergeMessages(source, candidate, options)) ids.add(row.id)
    }
  }

  return Array.from(ids)
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

