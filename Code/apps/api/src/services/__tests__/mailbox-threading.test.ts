import { describe, expect, it, vi } from 'vitest'
import {
  canMergeMessages,
  DEFAULT_MAILBOX_THREADING_OPTIONS,
  findBroadThreadMessageIds,
  hasNoReplyAddress,
  normalizeMailboxThreadingOptions,
  normalizeThreadingEmail,
  normalizeThreadSubject,
  type MailboxThreadingOptions,
} from '../mailbox-threading.js'

const supabaseMocks = vi.hoisted(() => ({
  from: vi.fn(),
}))

vi.mock('../../supabaseClient.js', () => ({
  supabaseAdmin: { from: supabaseMocks.from },
}))

class MockMessageQuery implements PromiseLike<{ data: unknown; error: null }> {
  readonly ilikeFilters: Array<[string, string]> = []

  constructor(private readonly data: unknown) {}

  select() { return this }
  in() { return this }
  ilike(column: string, pattern: string) {
    this.ilikeFilters.push([column, pattern])
    return this
  }
  gte() { return this }
  lte() { return this }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.data, error: null }).then(onfulfilled, onrejected)
  }
}

function threadingOptions(overrides: Partial<MailboxThreadingOptions> = {}): MailboxThreadingOptions {
  return { ...DEFAULT_MAILBOX_THREADING_OPTIONS, ...overrides }
}

describe('mailbox threading rules', () => {
  const baseMessage = {
    id: '1',
    providerMessageId: 'provider-1',
    providerThreadId: 'thread-1',
    subject: 'Weekly report',
    fromEmail: 'reports@example.com',
    receivedAt: '2026-09-01T12:00:00.000Z',
    replyTo: 'reports@example.com',
  }

  it('normalizes reply prefixes, spacing, and case', () => {
    expect(normalizeThreadSubject('  Re:   WEEKLY report ')).toBe('weekly report')
  })

  it('matches the same normalized subject and full sender email', () => {
    expect(normalizeThreadingEmail(' Reports@Example.com ')).toBe('reports@example.com')
    expect(canMergeMessages(
      baseMessage,
      { ...baseMessage, id: '2', providerMessageId: 'provider-2', fromEmail: 'REPORTS@example.com' },
      threadingOptions({ sameNameAndEmail: true }),
    )).toBe(true)
    expect(canMergeMessages(
      { ...baseMessage, subject: 'Re: Anthropic invitation' },
      { ...baseMessage, id: '3', providerMessageId: 'provider-3', subject: 'Anthropic invitation' },
      threadingOptions({ sameNameAndEmail: true }),
    )).toBe(true)
    expect(canMergeMessages(
      baseMessage,
      { ...baseMessage, id: '4', fromEmail: 'alerts@example.com' },
      threadingOptions({ sameNameAndEmail: true }),
    )).toBe(false)
  })

  it('maps previously saved sender-domain settings to the new email rule names', () => {
    expect(normalizeMailboxThreadingOptions({
      sameNameAndDomain: true,
      sameNameAndDomainDays: 12,
      sameDomainWithoutReply: true,
      sameDomainWithoutReplyDays: 9,
      sameDomainWithinSevenDays: true,
      sameDomainWithinDays: 21,
    })).toMatchObject({
      sameNameAndEmail: true,
      sameNameAndEmailDays: 12,
      sameEmailWithoutReply: true,
      sameEmailWithoutReplyDays: 9,
      sameEmailWithinSevenDays: true,
      sameEmailWithinDays: 21,
    })
    expect(normalizeMailboxThreadingOptions({
      sameNameAndEmail: false,
      sameNameAndDomain: true,
    }).sameNameAndEmail).toBe(false)
  })

  it('only treats explicit no-reply addresses as no-reply', () => {
    expect(hasNoReplyAddress({ fromEmail: 'no-reply@vendor.test', replyTo: null })).toBe(true)
    expect(hasNoReplyAddress({
      fromEmail: 'no-reply-7jrk_rhsnvw8i4que6pudw@mail.anthropic.com',
      replyTo: 'Anthropic <no-reply-7jrk_rhsnvw8i4que6pudw@mail.anthropic.com>',
    })).toBe(true)
    expect(hasNoReplyAddress({ fromEmail: 'emma@gmail.com', replyTo: null })).toBe(false)
    expect(hasNoReplyAddress({
      fromEmail: 'emma@gmail.com',
      replyTo: 'no-reply@vendor.test',
    })).toBe(true)

    const noReplyBase = { ...baseMessage, fromEmail: 'no-reply@vendor.test', replyTo: null }
    expect(canMergeMessages(
      noReplyBase,
      {
        ...noReplyBase,
        id: '2',
        providerMessageId: 'provider-2',
      },
      threadingOptions({ sameNameWithoutReply: true }),
    )).toBe(true)
    expect(canMergeMessages(
      { ...baseMessage, fromEmail: 'emma@gmail.com', replyTo: null },
      { ...baseMessage, id: '3', fromEmail: 'other@gmail.com', replyTo: null },
      threadingOptions({ sameNameWithoutReply: true }),
    )).toBe(false)
  })

  it('searches broad candidates when same-subject no-reply threading is the only enabled option', async () => {
    const candidate = {
      id: 'candidate',
      subject: 'Re: Weekly report',
      from_email: 'no-reply@vendor.test',
      received_at: '2026-09-01T13:00:00.000Z',
      meta_gmail_headers: null,
      meta_outlook_reply_to: null,
    }
    supabaseMocks.from.mockImplementation(() => new MockMessageQuery([candidate]))

    await expect(findBroadThreadMessageIds(
      ['account-1'],
      { ...baseMessage, fromEmail: 'no-reply@vendor.test', replyTo: null },
      {
        ...threadingOptions({ sameNameWithoutReply: true }),
        sameNameWithoutReplyDays: 7,
      },
    )).resolves.toEqual(['1', 'candidate'])
  })

  it('matches messages received less than seven days apart', () => {
    expect(canMergeMessages(
      baseMessage,
      { ...baseMessage, id: '2', providerMessageId: 'provider-2', receivedAt: '2026-09-07T11:59:59.000Z' },
      threadingOptions({ sameNameWithinSevenDays: true }),
    )).toBe(true)
    expect(canMergeMessages(
      baseMessage,
      { ...baseMessage, id: '3', providerMessageId: 'provider-3', receivedAt: '2026-09-08T12:00:00.000Z' },
      threadingOptions({ sameNameWithinSevenDays: true }),
    )).toBe(false)
  })

  it('matches the same email and no-reply condition together', () => {
    expect(canMergeMessages(
      { ...baseMessage, replyTo: null, fromEmail: 'no-reply@example.com' },
      { ...baseMessage, id: '2', providerMessageId: 'provider-2', subject: 'A different notification', fromEmail: 'no-reply@example.com', replyTo: null },
      threadingOptions({ sameEmailWithoutReply: true }),
    )).toBe(true)
    expect(canMergeMessages(
      { ...baseMessage, replyTo: null, fromEmail: 'no-reply@example.com' },
      { ...baseMessage, id: '3', fromEmail: 'mailer-daemon@example.com', replyTo: null },
      threadingOptions({ sameEmailWithoutReply: true }),
    )).toBe(false)
  })

  it('matches the same email and seven-day condition together', () => {
    expect(canMergeMessages(
      baseMessage,
      { ...baseMessage, id: '2', providerMessageId: 'provider-2', fromEmail: 'REPORTS@example.com', receivedAt: '2026-09-07T11:59:59.000Z' },
      threadingOptions({ sameEmailWithinSevenDays: true }),
    )).toBe(true)
    expect(canMergeMessages(
      { ...baseMessage, subject: 'Rost is waiting for you to join Ristik' },
      { ...baseMessage, id: '3', providerMessageId: 'provider-3', subject: 'You are invited to join Ristik', fromEmail: 'reports@example.com', receivedAt: '2026-09-07T11:59:59.000Z' },
      threadingOptions({ sameEmailWithinSevenDays: true }),
    )).toBe(true)
    expect(canMergeMessages(
      baseMessage,
      { ...baseMessage, id: '4', fromEmail: 'alerts@example.com', receivedAt: '2026-09-07T11:59:59.000Z' },
      threadingOptions({ sameEmailWithinSevenDays: true }),
    )).toBe(false)
  })

  it('queries broad sender rules using the full address', async () => {
    const query = new MockMessageQuery([{
      id: 'different-sender',
      subject: 'Unrelated subject',
      from_email: 'alerts@example.com',
      received_at: '2026-09-01T13:00:00.000Z',
      meta_gmail_headers: null,
      meta_outlook_reply_to: null,
    }])
    supabaseMocks.from.mockImplementation(() => query)

    await expect(findBroadThreadMessageIds(
      ['account-1'],
      baseMessage,
      threadingOptions({ sameEmailWithinSevenDays: true }),
    )).resolves.toEqual(['1'])
    expect(query.ilikeFilters).toContainEqual(['from_email', 'reports@example.com'])
  })
})
