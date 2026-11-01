import { beforeEach, describe, expect, it, vi } from 'vitest'

const { results, started, release } = vi.hoisted(() => ({
  results: new Map<string, { data?: unknown; count?: number; error?: unknown }>(),
  started: [] as string[],
  release: new Map<string, () => void>(),
}))

vi.mock('../../supabaseClient.js', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const chain = {
        select: () => chain, eq: () => chain, neq: () => chain, in: () => chain,
        order: () => chain, limit: () => chain, maybeSingle: () => chain,
        then: (resolve: (value: unknown) => void) => {
          started.push(table)
          if (table === 'mail_accounts') resolve(results.get(table))
          else release.set(table, () => resolve(results.get(table) ?? { data: [], error: null }))
        },
      }
      return chain
    },
  },
}))

import { buildMailboxAnalytics, computeMailboxAnalytics, type RawMessage } from '../mailbox-analytics.js'

const message = (id: string, from: string, overrides: Partial<RawMessage> = {}): RawMessage => ({
  id, account_id: 'account', thread_id: 'thread', from_email: from,
  received_at: '2026-10-05T09:00:00Z', is_read: false, is_archived: false, has_attachments: false,
  body_text: 'Hello there', preview: null, meta_user_tag_ids: [], meta_provider_sent: false,
  meta_provider_trashed: false, meta_provider_junk: false, meta_label_ids: [], ...overrides,
})

beforeEach(() => {
  results.clear()
  started.length = 0
  release.clear()
})

describe('mailbox analytics', () => {
  it('starts all five independent reads after the owner account lookup', async () => {
    results.set('mail_accounts', { data: [{ id: 'account', address: 'self@example.com' }], error: null })
    results.set('mail_messages', { data: [message('m', 'friend@example.com')], error: null })
    const pending = computeMailboxAnalytics('user')
    await vi.waitFor(() => expect(release.size).toBe(5))
    expect(started).toEqual([
      'mail_accounts', 'mail_messages', 'mail_invitations', 'mail_user_preferences', 'mail_drafts', 'mail_action_events',
    ])
    for (const resolve of release.values()) resolve()
    expect((await pending).totalMessages).toBe(1)
  })
  it('reports read failures instead of returning success-shaped incomplete statistics', async () => {
    results.set('mail_accounts', { error: new Error('Account read failed') })
    await expect(computeMailboxAnalytics('user')).rejects.toThrow('Account read failed')
    expect(started).toEqual(['mail_accounts'])
  })
  it('preserves statistical fields, thread ordering, sample labels and action totals', () => {
    const result = buildMailboxAnalytics({
      accounts: [{ id: 'account', address: 'SELF@example.com' }],
      messages: [
        message('reply', 'self@example.com', { received_at: '2026-10-05T11:00:00Z', has_attachments: true }),
        message('initial', 'friend@example.com'),
      ],
      invitationCount: 1, rawTags: [], draftCount: 2,
      actionEvents: [
        { message_id: 'initial', action: 'archive', action_value: null, source_type: 'rule' },
        { message_id: 'initial', action: 'mark_read', action_value: null, source_type: 'manual' },
      ],
    })
    expect(result.totalMessages).toBe(2)
    expect(result.dataScope).toBe('Based on 2 most recent messages')
    expect(result.volumeByWeekday[1]).toMatchObject({ received: 1, sent: 1 })
    expect(result.responseTimeByWeekday[1].asResponderHours).toBe(2)
    expect(result.threadInitiator).toEqual({ iInitiated: 0, theyInitiated: 1 })
    expect(result.attachmentFrequency).toEqual({ receivedPct: 0, sentPct: 100, totalReceived: 1, totalSent: 1 })
    expect(result.meetingEmailRatio).toBe(50)
    expect(result.tagUsage.find(tag => tag.tagId === 'system:draft')?.count).toBe(2)
    expect(result.actionSummary.automationTriggeredEmails).toBe(1)
    expect(result.actionSummary.manualActionEmails).toBe(1)
  })
  it('keeps the empty response shape', () => {
    expect(buildMailboxAnalytics({ accounts: [], messages: [], invitationCount: 0, rawTags: [], draftCount: 0, actionEvents: [] }))
      .toMatchObject({ totalMessages: 0, dataScope: 'No messages indexed yet', tagUsage: [], tagCombinations: [] })
  })
})
