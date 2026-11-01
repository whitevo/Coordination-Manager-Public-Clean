import { supabaseAdmin } from '../supabaseClient.js'
import { sanitizeUUID } from '../middleware/validation.js'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export interface VolumeByWeekday { day: number; dayName: string; received: number; sent: number }
export interface WordCountBucket { bucket: string; count: number; pct: number }
export interface ResponseBehaviorItem { label: string; count: number; pct: number; colorKey: string }
export interface TopCorrespondent { email: string; count: number }
export interface ResponseTimeByWeekday { day: number; dayName: string; asInitiatorHours: number | null; asResponderHours: number | null }
export interface TagUsageCount { tagId: string; label: string; color: string; count: number }
export interface TagCombinationCount { tagIds: string[]; labels: string[]; size: number; count: number }
export interface ActionTypeCount { action: string; label: string; count: number; pct: number }
export interface AutomationTagAssignment { tagId: string; label: string; color: string; count: number }
export interface ActionSourceSummary {
  automationTriggeredEmails: number
  manualActionEmails: number
  automationActions: ActionTypeCount[]
  manualActions: ActionTypeCount[]
  automationTagBreakdown: AutomationTagAssignment[]
}

export interface MailboxAnalyticsResult {
  volumeByWeekday: VolumeByWeekday[]
  wordCountBuckets: WordCountBucket[]
  responseBehavior: ResponseBehaviorItem[]
  threadInitiator: { iInitiated: number; theyInitiated: number }
  topCorrespondents: TopCorrespondent[]
  attachmentFrequency: { receivedPct: number; sentPct: number; totalReceived: number; totalSent: number }
  responseTimeByWeekday: ResponseTimeByWeekday[]
  meetingEmailRatio: number
  totalMessages: number
  dataScope: string
  tagUsage: TagUsageCount[]
  tagCombinations: TagCombinationCount[]
  actionSummary: ActionSourceSummary
}

export interface RawMessage {
  id: string
  account_id: string
  thread_id: string | null
  from_email: string | null
  received_at: string | null
  is_read: boolean
  is_archived: boolean
  has_attachments: boolean
  body_text: string | null
  preview: string | null
  meta_user_tag_ids: unknown
  meta_provider_sent: unknown
  meta_provider_trashed: unknown
  meta_provider_junk: unknown
  meta_label_ids: unknown
}

// Mirrors the system tag ids/labels used by the inbox sort/filter UI (mailbox-sort.ts).
const SYSTEM_TAG_META: Record<string, { label: string; color: string }> = {
  'system:unread': { label: 'Unread', color: '#f59e0b' },
  'system:draft': { label: 'Draft', color: '#8b5cf6' },
  'system:sent': { label: 'Sent', color: '#3b82f6' },
  'system:trash': { label: 'Trash', color: '#ef4444' },
  'system:junk': { label: 'Junk', color: '#f97316' },
  'system:archived': { label: 'Archived', color: '#10b981' },
  'system:attachments': { label: 'Has attachment', color: '#0ea5e9' },
}

const AUTOMATION_ACTION_LABELS: Record<string, string> = {
  trash: 'Trash',
  junk: 'Mark as junk',
  archive: 'Archive',
  unarchive: 'Unarchive',
  mark_read: 'Mark read',
  mark_unread: 'Mark unread',
  add_tag: 'Add tag',
  remove_tag: 'Remove tag',
  agent_prompt: 'AI draft reply',
}

/** Caps combination fan-out for messages with an unusually large number of tags. */
const MAX_TAGS_PER_MESSAGE_FOR_COMBOS = 10
const MAX_TAG_COMBINATIONS_RETURNED = 10

function extractMessageTagIds(metaUserTagIds: unknown): string[] {
  if (!Array.isArray(metaUserTagIds)) return []
  const seen = new Set<string>()
  for (const value of metaUserTagIds) {
    const sanitized = sanitizeUUID(value)
    if (sanitized) seen.add(sanitized)
  }
  return Array.from(seen)
}

function combinations(items: string[], size: number): string[][] {
  if (size > items.length) return []
  const result: string[][] = []
  const combo: string[] = []
  function build(start: number) {
    if (combo.length === size) {
      result.push([...combo])
      return
    }
    for (let i = start; i < items.length; i++) {
      combo.push(items[i])
      build(i + 1)
      combo.pop()
    }
  }
  build(0)
  return result
}

function wordCount(text: string | null): number {
  if (!text) return 0
  return text.trim().split(/\s+/).filter(Boolean).length
}

function toWeekday(iso: string | null): number | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.getUTCDay()
}

function hoursBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null
  const diff = (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000
  return diff > 0 && diff < 8760 ? diff : null
}

export async function computeMailboxAnalytics(userId: string): Promise<MailboxAnalyticsResult> {
  const { data: accountRows, error: accountError } = await supabaseAdmin
    .from('mail_accounts')
    .select('id, address')
    .eq('user_id', userId)
    .neq('status', 'disconnected')

  if (accountError) throw accountError
  const accounts = (accountRows || []) as { id: string; address: string }[]
  const accountIds = accounts.map(a => a.id)

  if (accountIds.length === 0) {
    return emptyResult()
  }

  const [messageResult, invitationResult, preferencesResult, draftResult, actionResult] = await Promise.all([
    supabaseAdmin
    .from('mail_messages')
    .select('id, account_id, thread_id, from_email, received_at, is_read, is_archived, has_attachments, body_text, preview, meta_user_tag_ids:provider_metadata->user_tag_ids, meta_provider_sent:provider_metadata->provider_sent, meta_provider_trashed:provider_metadata->provider_trashed, meta_provider_junk:provider_metadata->provider_junk, meta_label_ids:provider_metadata->provider_message->labelIds')
    .in('account_id', accountIds)
    .order('received_at', { ascending: false })
    .limit(2000),
    supabaseAdmin.from('mail_invitations').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabaseAdmin.from('mail_user_preferences').select('mailbox_tags').eq('user_id', userId).maybeSingle(),
    supabaseAdmin.from('mail_drafts').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabaseAdmin.from('mail_action_events')
      .select('message_id, action, action_value, source_type')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(5000),
  ])
  for (const result of [messageResult, invitationResult, preferencesResult, draftResult, actionResult]) {
    if (result.error) throw result.error
  }
  const rawTags: unknown = preferencesResult.data?.mailbox_tags
  return buildMailboxAnalytics({
    accounts,
    messages: (messageResult.data || []) as RawMessage[],
    invitationCount: invitationResult.count ?? 0,
    rawTags: Array.isArray(rawTags) ? rawTags : [],
    draftCount: draftResult.count ?? 0,
    actionEvents: (actionResult.data || []) as AnalyticsActionEvent[],
  })
}

interface AnalyticsActionEvent {
  message_id: string
  action: string
  action_value: string | null
  source_type: 'manual' | 'rule' | 'import'
}

interface AnalyticsInput {
  accounts: Array<{ id: string; address: string }>
  messages: RawMessage[]
  invitationCount: number
  rawTags: unknown[]
  draftCount: number
  actionEvents: AnalyticsActionEvent[]
}

export function buildMailboxAnalytics({
  accounts, messages, invitationCount, rawTags, draftCount, actionEvents,
}: AnalyticsInput): MailboxAnalyticsResult {
  const selfEmails = new Set(accounts.map(a => a.address.toLowerCase()))
  const total = messages.length
  if (total === 0) return emptyResult()

  const isSelf = (email: string | null) => !!email && selfEmails.has(email.toLowerCase())

  // ── Volume by weekday ────────────────────────────────────────────────────
  const volumeMap: Record<number, { r: number; s: number }> = {}
  for (let d = 0; d < 7; d++) volumeMap[d] = { r: 0, s: 0 }
  for (const m of messages) {
    const d = toWeekday(m.received_at)
    if (d === null) continue
    if (isSelf(m.from_email)) volumeMap[d].s++
    else volumeMap[d].r++
  }
  const volumeByWeekday: VolumeByWeekday[] = DAY_NAMES.map((name, i) => ({
    day: i, dayName: name, received: volumeMap[i].r, sent: volumeMap[i].s,
  }))

  // ── Word count buckets ───────────────────────────────────────────────────
  const bucketKeys = ['< 20', '20-100', '100-300', '300-1k', '> 1k']
  const bucketCounts = [0, 0, 0, 0, 0]
  for (const m of messages) {
    const wc = wordCount(m.body_text || m.preview)
    if (wc < 20) bucketCounts[0]++
    else if (wc < 100) bucketCounts[1]++
    else if (wc < 300) bucketCounts[2]++
    else if (wc < 1000) bucketCounts[3]++
    else bucketCounts[4]++
  }
  const wordCountBuckets: WordCountBucket[] = bucketKeys.map((bucket, i) => ({
    bucket, count: bucketCounts[i], pct: Math.round((bucketCounts[i] / total) * 100),
  }))

  // ── Thread analysis ──────────────────────────────────────────────────────
  const threadMessages: Record<string, RawMessage[]> = {}
  for (const m of messages) {
    if (!m.thread_id) continue
    if (!threadMessages[m.thread_id]) threadMessages[m.thread_id] = []
    threadMessages[m.thread_id].push(m)
  }
  // Sort each thread by received_at ascending
  for (const tid of Object.keys(threadMessages)) {
    threadMessages[tid].sort((a, b) =>
      (a.received_at ?? '').localeCompare(b.received_at ?? ''))
  }

  let iInitiated = 0; let theyInitiated = 0
  let receivedNoReply = 0; let receivedReplied = 0; let sentGotReply = 0; let sentIgnored = 0

  // response time buckets: [day][asInitiator[], asResponder[]]
  const rtBuckets: Record<number, { init: number[]; resp: number[] }> = {}
  for (let d = 0; d < 7; d++) rtBuckets[d] = { init: [], resp: [] }

  for (const msgs of Object.values(threadMessages)) {
    if (msgs.length === 0) continue
    const first = msgs[0]
    const iStarted = isSelf(first.from_email)
    if (iStarted) iInitiated++; else theyInitiated++

    if (msgs.length === 1) {
      if (iStarted) sentIgnored++; else receivedNoReply++
    } else {
      const second = msgs[1]
      if (iStarted) sentGotReply++; else receivedReplied++
      const d = toWeekday(first.received_at)
      const hours = hoursBetween(first.received_at, second.received_at)
      if (d !== null && hours !== null) {
        if (iStarted) rtBuckets[d].init.push(hours)
        else rtBuckets[d].resp.push(hours)
      }
    }
  }

  // also count single messages not in threads
  for (const m of messages) {
    if (m.thread_id && threadMessages[m.thread_id]) continue
    if (isSelf(m.from_email)) sentIgnored++
    else receivedNoReply++
  }

  const bTotal = receivedNoReply + receivedReplied + sentGotReply + sentIgnored || 1
  const responseBehavior: ResponseBehaviorItem[] = [
    { label: 'Received, no reply', count: receivedNoReply, pct: Math.round((receivedNoReply / bTotal) * 100), colorKey: 'muted' },
    { label: 'Received, I replied', count: receivedReplied, pct: Math.round((receivedReplied / bTotal) * 100), colorKey: 'emerald' },
    { label: 'I sent, got reply', count: sentGotReply, pct: Math.round((sentGotReply / bTotal) * 100), colorKey: 'blue' },
    { label: 'I sent, ignored', count: sentIgnored, pct: Math.round((sentIgnored / bTotal) * 100), colorKey: 'amber' },
  ]

  const avg = (arr: number[]) => arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : null
  const responseTimeByWeekday: ResponseTimeByWeekday[] = DAY_NAMES.map((name, i) => ({
    day: i, dayName: name,
    asInitiatorHours: avg(rtBuckets[i].init),
    asResponderHours: avg(rtBuckets[i].resp),
  }))

  // ── Top correspondents ───────────────────────────────────────────────────
  const corrMap: Record<string, number> = {}
  for (const m of messages) {
    if (!m.from_email || isSelf(m.from_email)) continue
    const e = m.from_email.toLowerCase()
    corrMap[e] = (corrMap[e] ?? 0) + 1
  }
  const topCorrespondents: TopCorrespondent[] = Object.entries(corrMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([email, count]) => ({ email, count }))

  // ── Attachment frequency ─────────────────────────────────────────────────
  const received = messages.filter(m => !isSelf(m.from_email))
  const sent = messages.filter(m => isSelf(m.from_email))
  const attachmentFrequency = {
    receivedPct: received.length ? Math.round((received.filter(m => m.has_attachments).length / received.length) * 100) : 0,
    sentPct: sent.length ? Math.round((sent.filter(m => m.has_attachments).length / sent.length) * 100) : 0,
    totalReceived: received.length,
    totalSent: sent.length,
  }

  // ── Meeting ratio ────────────────────────────────────────────────────────
  const meetingEmailRatio = total ? Math.round((invitationCount / total) * 100) : 0

  // ── Tag usage + tag combinations ─────────────────────────────────────────
  const tagMetaById = new Map<string, { label: string; color: string }>()
  for (const entry of rawTags) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id : null
    const label = typeof record.label === 'string' ? record.label : null
    if (!id || !label) continue
    tagMetaById.set(id, { label, color: typeof record.color === 'string' ? record.color : '#2563eb' })
  }

  const tagCountMap: Record<string, number> = {}
  const pairCountMap = new Map<string, number>()
  const tripletCountMap = new Map<string, number>()

  // ── System tags (unread, sent, trash, junk, archived, attachments, draft) ─
  for (const [tagId, meta] of Object.entries(SYSTEM_TAG_META)) tagMetaById.set(tagId, meta)

  const isGmailSpam = (labelIds: unknown) => Array.isArray(labelIds) && labelIds.includes('SPAM')

  /** System tag ids that apply to this message, for both counts and combinations. */
  function systemTagIdsForMessage(m: RawMessage): string[] {
    const ids: string[] = []
    if (!m.is_read) ids.push('system:unread')
    if (m.meta_provider_sent === true || isSelf(m.from_email)) ids.push('system:sent')
    if (m.meta_provider_trashed === true) ids.push('system:trash')
    if (m.meta_provider_junk === true || isGmailSpam(m.meta_label_ids)) ids.push('system:junk')
    if (m.is_archived) ids.push('system:archived')
    if (m.has_attachments) ids.push('system:attachments')
    return ids
  }

  for (const m of messages) {
    for (const tagId of systemTagIdsForMessage(m)) tagCountMap[tagId] = (tagCountMap[tagId] ?? 0) + 1
    for (const tagId of extractMessageTagIds(m.meta_user_tag_ids)) tagCountMap[tagId] = (tagCountMap[tagId] ?? 0) + 1
  }

  if (draftCount) tagCountMap['system:draft'] = draftCount

  // Combinations are computed separately from a possibly-truncated tag list so a
  // message with an unusually large tag count cannot blow up the pair/triplet fan-out.
  for (const m of messages) {
    const tagIds = [...extractMessageTagIds(m.meta_user_tag_ids), ...systemTagIdsForMessage(m)]
      .slice(0, MAX_TAGS_PER_MESSAGE_FOR_COMBOS)
    if (tagIds.length < 2) continue

    const sortedTagIds = [...tagIds].sort()
    for (const pair of combinations(sortedTagIds, 2)) {
      const key = pair.join('|')
      pairCountMap.set(key, (pairCountMap.get(key) ?? 0) + 1)
    }
    for (const triplet of combinations(sortedTagIds, 3)) {
      const key = triplet.join('|')
      tripletCountMap.set(key, (tripletCountMap.get(key) ?? 0) + 1)
    }
  }

  const tagUsage: TagUsageCount[] = Array.from(tagMetaById.entries())
    .map(([tagId, meta]) => ({ tagId, label: meta.label, color: meta.color, count: tagCountMap[tagId] ?? 0 }))
    .sort((a, b) => b.count - a.count)

  const toCombinationCounts = (map: Map<string, number>, size: number): TagCombinationCount[] =>
    Array.from(map.entries())
      .map(([key, count]) => {
        const tagIds = key.split('|')
        return {
          tagIds,
          labels: tagIds.map((id) => tagMetaById.get(id)?.label ?? 'Unknown tag'),
          size,
          count,
        }
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_TAG_COMBINATIONS_RETURNED)

  const tagCombinations: TagCombinationCount[] = [
    ...toCombinationCounts(pairCountMap, 2),
    ...toCombinationCounts(tripletCountMap, 3),
  ].sort((a, b) => b.count - a.count)

  // ── Automation vs manual actions ─────────────────────────────────────────
  const automationMessageIds = new Set<string>()
  const manualMessageIds = new Set<string>()
  const automationActionCounts: Record<string, number> = {}
  const manualActionCounts: Record<string, number> = {}
  const automationAddTagCounts: Record<string, number> = {}

  for (const event of actionEvents) {
    if (event.source_type === 'rule') {
      automationMessageIds.add(event.message_id)
      automationActionCounts[event.action] = (automationActionCounts[event.action] ?? 0) + 1
      if (event.action === 'add_tag') {
        const tagId = sanitizeUUID(event.action_value)
        if (tagId) automationAddTagCounts[tagId] = (automationAddTagCounts[tagId] ?? 0) + 1
      }
    } else if (event.source_type === 'manual') {
      manualMessageIds.add(event.message_id)
      manualActionCounts[event.action] = (manualActionCounts[event.action] ?? 0) + 1
    }
  }

  const automationTagBreakdown: AutomationTagAssignment[] = Object.entries(automationAddTagCounts)
    .map(([tagId, count]) => ({
      tagId,
      label: tagMetaById.get(tagId)?.label ?? 'Unknown tag',
      color: tagMetaById.get(tagId)?.color ?? '#2563eb',
      count,
    }))
    .sort((a, b) => b.count - a.count)

  const toActionTypeCounts = (counts: Record<string, number>): ActionTypeCount[] => {
    const eventTotal = Object.values(counts).reduce((a, b) => a + b, 0) || 1
    return Object.entries(counts)
      .map(([action, count]) => ({
        action,
        label: AUTOMATION_ACTION_LABELS[action] ?? action,
        count,
        pct: Math.round((count / eventTotal) * 100),
      }))
      .sort((a, b) => b.count - a.count)
  }

  const actionSummary: ActionSourceSummary = {
    automationTriggeredEmails: automationMessageIds.size,
    manualActionEmails: manualMessageIds.size,
    automationActions: toActionTypeCounts(automationActionCounts),
    manualActions: toActionTypeCounts(manualActionCounts),
    automationTagBreakdown,
  }

  return {
    volumeByWeekday, wordCountBuckets, responseBehavior,
    threadInitiator: { iInitiated, theyInitiated },
    topCorrespondents, attachmentFrequency, responseTimeByWeekday,
    meetingEmailRatio, totalMessages: total,
    dataScope: `Based on ${total} most recent messages`,
    tagUsage, tagCombinations, actionSummary,
  }
}

function emptyResult(): MailboxAnalyticsResult {
  const days = DAY_NAMES.map((dayName, day) => ({
    day, dayName, received: 0, sent: 0,
    asInitiatorHours: null, asResponderHours: null,
  }))
  return {
    volumeByWeekday: days,
    wordCountBuckets: [],
    responseBehavior: [],
    threadInitiator: { iInitiated: 0, theyInitiated: 0 },
    topCorrespondents: [],
    attachmentFrequency: { receivedPct: 0, sentPct: 0, totalReceived: 0, totalSent: 0 },
    responseTimeByWeekday: days,
    meetingEmailRatio: 0,
    totalMessages: 0,
    dataScope: 'No messages indexed yet',
    tagUsage: [],
    tagCombinations: [],
    actionSummary: {
      automationTriggeredEmails: 0,
      manualActionEmails: 0,
      automationActions: [],
      manualActions: [],
      automationTagBreakdown: [],
    },
  }
}
