import { getOffsetOnDate, getTimezoneAbbr } from '../lib/timezone-data'
import { annotateEmailLinksWithRealDomain } from '../lib/link-safety'

interface MailboxActionProjection {
  is_provider_trashed: boolean
  is_archived: boolean
  is_read: boolean
  user_tag_ids: string[]
}

export interface MailboxBulkActionOutcome {
  action_index: number
  action: string
  value: string
  status: 'applied' | 'uncertain' | 'unavailable'
  error?: string
}

export interface MailboxBulkMessageOutcome {
  message_id: string
  actions: MailboxBulkActionOutcome[]
}

export function readMailboxBulkOutcomes(
  raw: unknown,
  actions: Array<{ action: string; value: string }>,
  messageIds: string[]
): MailboxBulkMessageOutcome[] | null {
  if (!raw || typeof raw !== 'object' || !('contract_version' in raw) || raw.contract_version !== 1
    || !('results' in raw) || !Array.isArray(raw.results)) return null
  const expectedIds = new Set(messageIds)
  const seenIds = new Set<string>()
  const results: MailboxBulkMessageOutcome[] = []
  for (const entry of raw.results as unknown[]) {
    if (!entry || typeof entry !== 'object' || !('message_id' in entry) || typeof entry.message_id !== 'string'
      || !expectedIds.has(entry.message_id) || seenIds.has(entry.message_id)
      || !('actions' in entry) || !Array.isArray(entry.actions) || entry.actions.length !== actions.length) return null
    const outcomes: MailboxBulkActionOutcome[] = []
    const seenIndexes = new Set<number>()
    for (const step of entry.actions as unknown[]) {
      if (!step || typeof step !== 'object' || !('action_index' in step) || typeof step.action_index !== 'number'
        || !Number.isInteger(step.action_index) || seenIndexes.has(step.action_index)
        || !('action' in step) || !('value' in step) || !('status' in step)) return null
      const requested = actions[step.action_index]
      if (!requested || step.action !== requested.action || step.value !== requested.value
        || (step.status !== 'applied' && step.status !== 'uncertain' && step.status !== 'unavailable')) return null
      seenIndexes.add(step.action_index)
      outcomes.push({
        action_index: step.action_index, action: requested.action, value: requested.value, status: step.status,
        ...('error' in step && typeof step.error === 'string' ? { error: step.error } : {}),
      })
    }
    seenIds.add(entry.message_id)
    results.push({ message_id: entry.message_id, actions: outcomes.sort((left, right) => left.action_index - right.action_index) })
  }
  return seenIds.size === expectedIds.size ? results : null
}

export function reconcileMailboxBulkOutcomes<T extends MailboxActionProjection & { id: string }>(
  current: T[],
  before: T[],
  requested: Array<{ action: string; value: string }>,
  results: MailboxBulkMessageOutcome[]
): T[] {
  const beforeById = new Map(before.map(message => [message.id, message]))
  const resultsById = new Map(results.map(result => [result.message_id, result]))
  const optimisticTags = requested.filter(step => step.action === 'add_tag' || step.action === 'remove_tag')
  const fields: Array<keyof MailboxActionProjection> = ['is_provider_trashed', 'is_archived', 'is_read', 'user_tag_ids']
  return current.map(message => {
    const original = beforeById.get(message.id)
    const result = resultsById.get(message.id)
    if (!original || !result) return message
    const expected = projectMailboxActions(original, optimisticTags)
    const confirmed = projectMailboxActions(original, result.actions.filter(step => step.status === 'applied'))
    const next = { ...message }
    for (const field of fields) {
      const uncertainField = result.actions.some(step => step.status === 'uncertain' && (
        field === 'user_tag_ids' ? step.action === 'add_tag' || step.action === 'remove_tag'
          : field === 'is_provider_trashed' ? step.action === 'trash'
            : field === 'is_archived' ? step.action === 'archive' || step.action === 'unarchive'
              : step.action === 'mark_read' || step.action === 'mark_unread'
      ))
      if (!uncertainField && JSON.stringify(message[field]) === JSON.stringify(expected[field])) {
        Object.assign(next, { [field]: confirmed[field] })
      }
    }
    return next
  })
}

export function projectMailboxActions<T extends MailboxActionProjection>(
  message: T,
  actions: Array<{ action: string; value: string }>
): T {
  return actions.reduce((current, step) => {
    switch (step.action) {
      case 'trash': return { ...current, is_provider_trashed: true }
      case 'archive': return { ...current, is_archived: true }
      case 'unarchive': return { ...current, is_archived: false }
      case 'mark_read': return { ...current, is_read: true }
      case 'mark_unread': return { ...current, is_read: false }
      case 'add_tag': return { ...current, user_tag_ids: Array.from(new Set([...current.user_tag_ids, step.value])) }
      case 'remove_tag': return { ...current, user_tag_ids: current.user_tag_ids.filter(id => id !== step.value) }
      default: return current
    }
  }, message)
}

export interface MailInvitationLike {
  message_id?: string | null
  summary?: string | null
  organizer?: string | null
  starts_at?: string | null
  ends_at?: string | null
  status?: string | null | undefined
  uid?: string
  provider_event_ref?: string | null
  source_email?: string | null
  source_deleted?: boolean | null
  source_received_at?: string | null
}

export interface LocalDateTimeParts {
  date: string
  time: string
}

interface MailAccountSyncErrorLike {
  status: string
  sync_error: string | null
  sync_error_kind?: string | null
}

export function requiresMailboxReconnect(account: MailAccountSyncErrorLike): boolean {
  if (account.status !== 'error') return false
  if (account.sync_error_kind === 'auth') return true

  return /expired|revoked|reconnect|credentials.*(?:missing|not found)/i.test(
    account.sync_error || ''
  )
}

export function syncRequestTimeoutMs(expectedSeconds: number): number {
  return Math.max(130_000, Math.round(expectedSeconds * 2 + 30) * 1000)
}

function getOrdinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return 'th'
  switch (day % 10) {
    case 1: return 'st'
    case 2: return 'nd'
    case 3: return 'rd'
    default: return 'th'
  }
}

/** Format "Title - N_th Month(short) year - hh:mm (24h) (TIMEZONE)" for a given IANA timezone. */
export function formatInvitationSummaryLine(title: string | null | undefined, startIso: string | null | undefined, iana: string): string {
  const fallbackTitle = title?.trim() || 'Calendar invitation'
  if (!startIso) return fallbackTitle

  const date = new Date(startIso)
  if (Number.isNaN(date.getTime())) return fallbackTitle

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: iana,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = formatter.formatToParts(date)
  const getPart = (type: string) => parts.find((p) => p.type === type)?.value || ''
  const day = parseInt(getPart('day'), 10)
  const dayLabel = Number.isFinite(day) ? `${day}${getOrdinalSuffix(day)}` : getPart('day')
  const month = getPart('month')
  const year = getPart('year')
  const hour = getPart('hour') === '24' ? '00' : getPart('hour')
  const minute = getPart('minute')
  const abbr = getTimezoneAbbr(iana)

  return `${fallbackTitle} - ${dayLabel} ${month} ${year} - ${hour}:${minute} (${abbr})`
}

/** Convert an ISO timestamp into "yyyy-MM-dd" + "HH:mm" wall-clock parts for the given IANA timezone. */
export function isoToLocalDateTimeParts(iso: string | null | undefined, iana: string): LocalDateTimeParts {
  if (!iso) return { date: '', time: '' }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { date: '', time: '' }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: iana,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = formatter.formatToParts(d)
  const getPart = (type: string) => parts.find((p) => p.type === type)?.value || ''
  const date = `${getPart('year')}-${getPart('month')}-${getPart('day')}`
  const hour = getPart('hour') === '24' ? '00' : getPart('hour')
  return { date, time: `${hour}:${getPart('minute')}` }
}

/** Convert "yyyy-MM-dd" + "HH:mm" wall-clock parts in the given IANA timezone back to a UTC ISO string. */
export function localDateTimeToIso(dateStr: string, timeStr: string, iana: string): string | null {
  const [yearStr, monthStr, dayStr] = (dateStr || '').split('-')
  const [hourStr, minuteStr] = (timeStr || '').split(':')
  const year = parseInt(yearStr, 10)
  const month = parseInt(monthStr, 10)
  const day = parseInt(dayStr, 10)
  const hour = parseInt(hourStr, 10)
  const minute = parseInt(minuteStr, 10)
  if ([year, month, day, hour, minute].some((n) => !Number.isFinite(n))) return null

  const wallAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0)
  const offsetMinutes = getOffsetOnDate(iana, new Date(wallAsUtcMs))
  return new Date(wallAsUtcMs - offsetMinutes * 60_000).toISOString()
}

export interface InvitationBadge {
  key: string
  label: string
}

export interface InvitationAddActionState {
  alreadyAdded: boolean
  disabled: boolean
  label: string
}

export interface MailboxConfirmationSettingState {
  active: boolean
  label: string
  buttonLabel: string
}

export interface MailboxJunkCandidate {
  from_email: string | null
  is_provider_junk?: boolean
}

export function extractDomainFromEmail(email: string | null): string | null {
  if (!email) return null
  const normalized = email.trim().toLowerCase()
  const atIndex = normalized.lastIndexOf('@')
  if (atIndex <= 0 || atIndex >= normalized.length - 1) return null
  return normalized.slice(atIndex + 1)
}

export function normalizeSenderIdentity(email: string | null): string | null {
  if (!email) return null
  const normalized = email.trim().toLowerCase()
  if (!normalized || !normalized.includes('@')) return null
  return normalized
}

export function isMailboxMessageJunk(message: MailboxJunkCandidate, junkEntries: Set<string>): boolean {
  if (message.is_provider_junk === true) return true

  const senderIdentity = normalizeSenderIdentity(message.from_email)
  if (senderIdentity && junkEntries.has(senderIdentity)) return true

  const senderDomain = extractDomainFromEmail(message.from_email)
  return !!senderDomain && junkEntries.has(senderDomain)
}

/**
 * Quote markers left by common clients. Thunderbird uses `.moz-cite-prefix`,
 * Gmail `.gmail_quote`, Outlook `#divRplyFwdMsg`; the text patterns catch
 * clients that only emit an attribution paragraph.
 */
const QUOTE_MARKER_SELECTOR = [
  '.moz-cite-prefix',
  '.gmail_quote',
  '.gmail_attr',
  '#divRplyFwdMsg',
  'blockquote[type="cite"]',
  'blockquote.gmail_quote',
].join(', ')

const QUOTE_TEXT_PATTERNS: RegExp[] = [
  /^On\b[\s\S]{0,300}\bwrote:\s*$/i,
  /^-{2,}\s*Original Message\s*-{2,}/i,
  /^-{2,}\s*Forwarded message\s*-{2,}/i,
]

function looksLikeQuoteAttribution(element: Element): boolean {
  const text = (element.textContent || '').trim()
  if (!text || text.length > 400) return false
  return QUOTE_TEXT_PATTERNS.some((pattern) => pattern.test(text))
}

function findQuoteStart(container: Element): Element | null {
  const marked = container.querySelector(QUOTE_MARKER_SELECTOR)
  if (marked) return marked

  for (const child of Array.from(container.querySelectorAll('*'))) {
    if (looksLikeQuoteAttribution(child)) return child
  }

  return null
}

/**
 * Wraps the quoted history of a rendered HTML email in a `<details>` element so
 * it starts collapsed behind a small expander. Uses `<details>` rather than a
 * scripted toggle because the viewer iframe deliberately runs without scripts.
 */
export function collapseQuotedEmailHtml(html: string): string {
  if (!html || typeof DOMParser === 'undefined') return html

  const doc = new DOMParser().parseFromString(html, 'text/html')
  const body = doc.body
  if (!body) return html

  let start = findQuoteStart(body)
  if (!start) return html

  let container = start.parentElement
  while (container) {
    const nodes = Array.from(container.childNodes)
    const preceding = nodes.slice(0, nodes.indexOf(start))
    if (preceding.some(node => (node.textContent || '').trim() ||
      (node.nodeType === 1 && (node as Element).matches('img, hr, table')))) break
    if (container === body) return html
    start = container
    container = container.parentElement
  }
  if (!container) return html
  const siblings = Array.from(container.childNodes)
  const startIndex = siblings.indexOf(start)

  const details = doc.createElement('details')
  details.className = 'cm-quote'
  const summary = doc.createElement('summary')
  summary.className = 'cm-quote-summary'
  summary.textContent = 'Quoted history'
  details.appendChild(summary)

  container.insertBefore(details, start)
  for (const node of siblings.slice(startIndex)) {
    details.appendChild(node)
  }

  return body.innerHTML
}

function useLightEmailColorScheme(css: string): string {
  // color-scheme alone does not change prefers-color-scheme, which follows the OS.
  // Constant media conditions also preserve comma lists, nesting and negation.
  return css.replace(
    /\(\s*prefers-color-scheme\s*:\s*(light|dark)\s*\)/gi,
    (_, scheme: string) => scheme.toLowerCase() === 'light'
      ? '(min-width: 0px)'
      : '(not (min-width: 0px))'
  )
}

function extractLightEmailStylesFromHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return Array.from(doc.querySelectorAll('style')).map(style => {
    const css = useLightEmailColorScheme(style.textContent || '')
    const media = style.getAttribute('media')
    return media ? `@media ${useLightEmailColorScheme(media)} {${css}}` : css
  }).join('\n')
}

export function buildTrustedEmailSrcDoc(html: string): string {
  const preservedSenderCss = extractLightEmailStylesFromHtml(html)
  const htmlWithoutStyles = html.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
  const htmlWithLinkDomains = annotateEmailLinksWithRealDomain(htmlWithoutStyles)
  const htmlWithCollapsedQuote = collapseQuotedEmailHtml(htmlWithLinkDomains)

  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<base target="_blank" />',
    '<style>',
    'html, body { margin: 0; padding: 0; }',
    'html { color-scheme: light; }',
    'body { background: #ffffff; }',
    'img, pre, blockquote { max-width: 100% !important; }',
    'pre { white-space: pre-wrap; overflow-wrap: anywhere; }',
    'body, table, thead, tbody, tfoot, tr, td, th, div, p, span, font, li, center, section, article, header, footer, main, a { font-family: Helvetica, Arial, sans-serif; }',
    'body { color: #111827; }',
    '.cm-link-domain-warn { display: inline-block; margin-left: 4px; padding: 1px 6px; border-radius: 4px; background: #fef3c7; color: #92400e; font-size: 11px; font-family: Helvetica, Arial, sans-serif; font-weight: 600; white-space: nowrap; }',
    'details.cm-quote { margin: 12px 0 0; }',
    'details.cm-quote > summary { list-style: none; cursor: pointer; display: inline-block; padding: 2px 10px; border: 1px solid #d1d5db; border-radius: 999px; background: #f3f4f6; color: #4b5563; font-family: Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.5; user-select: none; }',
    'details.cm-quote > summary::-webkit-details-marker { display: none; }',
    'details.cm-quote > summary::before { content: "\\2022\\2022\\2022  "; letter-spacing: 1px; }',
    'details.cm-quote[open] > summary::before { content: "\\2212  "; }',
    'details.cm-quote > summary:hover { background: #e5e7eb; }',
    'details.cm-quote > *:not(summary) { margin-top: 8px; }',
    preservedSenderCss,
    '</style>',
    '</head>',
    '<body>',
    htmlWithCollapsedQuote,
    '</body>',
    '</html>',
  ].join('')
}

function normalizeInvitationText(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase()
}

export function invitationIdentityKey(invite: MailInvitationLike): string {
  const uid = normalizeInvitationText(invite.uid)
  if (uid) return `uid:${uid}`

  const messageId = normalizeInvitationText(invite.message_id)
  if (messageId) return `message:${messageId}`

  const summary = normalizeInvitationText(invite.summary)
  const startsAt = normalizeInvitationText(invite.starts_at)
  const endsAt = normalizeInvitationText(invite.ends_at)
  return `fallback:${summary}|${startsAt}|${endsAt}`
}

function isInviteStatusImported(status: string | null | undefined): boolean {
  const normalized = (status || '').trim().toLowerCase()
  return normalized === 'imported' || normalized === 'accepted'
}

export function isInvitationAlreadyAdded(target: MailInvitationLike, invitations: MailInvitationLike[]): boolean {
  const targetKey = invitationIdentityKey(target)
  return invitations.some((invite) => invitationIdentityKey(invite) === targetKey && (isInviteStatusImported(invite.status) || Boolean(invite.provider_event_ref)))
}

export function getInvitationMetaBadges(invitation: Partial<MailInvitationLike> | null | undefined): InvitationBadge[] {
  const badges: InvitationBadge[] = []

  if (invitation?.source_deleted) {
    badges.push({ key: 'source-deleted', label: 'Deleted in Gmail' })
  }

  return badges
}

export function getInvitationAddActionState(target: MailInvitationLike | null | undefined, invitations: MailInvitationLike[]): InvitationAddActionState {
  const alreadyAdded = Boolean(target && isInvitationAlreadyAdded(target, invitations))
  return {
    alreadyAdded,
    disabled: false,
    label: alreadyAdded ? 'Add to another calendar' : 'Add to calendar',
  }
}

export interface CollapsedInvitationGroup<T extends MailInvitationLike> {
  invite: T
  mergedCount: number
}

function invitationReceivedMs(invite: MailInvitationLike): number {
  const raw = invite.source_received_at
  if (!raw) return Number.NEGATIVE_INFINITY
  const ms = new Date(raw).getTime()
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms
}

/**
 * Organizers often re-announce the same event with a new subject each week
 * ("STARTS IN TWO WEEKS: ..."), which produces one invitation row per email.
 * Collapse rows that share the same organizer and start instant into a single
 * group; the invitation from the most recently received email wins so the
 * latest announcement's title is shown. Rows missing an organizer or a valid
 * start time are never collapsed.
 */
export function collapseDuplicateInvitations<T extends MailInvitationLike>(
  invitations: T[],
): CollapsedInvitationGroup<T>[] {
  const groups: CollapsedInvitationGroup<T>[] = []
  const groupIndexByKey = new Map<string, number>()

  for (const invite of invitations) {
    const organizer = normalizeInvitationText(invite.organizer)
    const startMs = invite.starts_at ? new Date(invite.starts_at).getTime() : Number.NaN

    if (!organizer || Number.isNaN(startMs)) {
      groups.push({ invite, mergedCount: 1 })
      continue
    }

    const key = `${organizer}|${startMs}`
    const existingIndex = groupIndexByKey.get(key)
    if (existingIndex === undefined) {
      groupIndexByKey.set(key, groups.length)
      groups.push({ invite, mergedCount: 1 })
      continue
    }

    const existing = groups[existingIndex]
    existing.mergedCount += 1
    if (invitationReceivedMs(invite) > invitationReceivedMs(existing.invite)) {
      existing.invite = invite
    }
  }

  return groups
}

export function getMailboxConfirmationSettingState(suppressedCount: number): MailboxConfirmationSettingState {
  const active = suppressedCount > 0
  return {
    active,
    label: active ? 'Prompt suppression active' : 'Prompt suppression inactive',
    buttonLabel: active ? 'Restore confirmation prompts' : 'Confirmation prompts on',
  }
}