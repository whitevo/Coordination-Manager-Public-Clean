import { beforeEach, describe, expect, it, vi } from 'vitest'
import { extractInvitationsForAccount } from '../mailbox-invitations.js'

const mocks = vi.hoisted(() => ({
  from: vi.fn(), select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn(),
  gte: vi.fn(), range: vi.fn(),
}))
vi.mock('../../supabaseClient.js', () => ({
  supabaseAdmin: { from: mocks.from },
}))

beforeEach(() => {
  vi.resetAllMocks()
  const chain = {
    select: mocks.select, eq: mocks.eq, in: mocks.in, order: mocks.order,
    limit: mocks.limit, maybeSingle: mocks.maybeSingle,
    gte: mocks.gte, range: mocks.range,
    delete: vi.fn().mockReturnThis(),
  }
  mocks.from.mockReturnValue(chain)
  mocks.select.mockReturnThis()
  mocks.eq.mockReturnThis()
  mocks.in.mockReturnThis()
  mocks.order.mockReturnThis()
  mocks.gte.mockReturnThis()
  mocks.range.mockResolvedValue({ data: [], error: null })
  mocks.limit.mockResolvedValue({ data: [], error: null })
  mocks.maybeSingle.mockResolvedValue({ data: { non_organizer_senders: [] }, error: null })
})

describe('incremental invitation extraction', () => {
  it('performs zero database queries when no new messages were inserted', async () => {
    expect(await extractInvitationsForAccount('account', 'user', [])).toEqual({
      parsed: 0, insertedOrUpdated: 0, removed: 0,
    })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('reads only the supplied new message IDs and enforces account/user ownership', async () => {
    mocks.order.mockResolvedValueOnce({ data: [], error: null })
    await extractInvitationsForAccount('account', 'user', ['new-1', 'new-2', 'new-1'])
    expect(mocks.in).toHaveBeenCalledExactlyOnceWith('provider_message_id', ['new-1', 'new-2'])
    expect(mocks.eq).toHaveBeenCalledWith('account_id', 'account')
    expect(mocks.select).toHaveBeenCalledWith(expect.stringContaining('mail_accounts!inner(user_id)'))
    expect(mocks.eq).toHaveBeenCalledWith('mail_accounts.user_id', 'user')
    expect(mocks.limit).not.toHaveBeenCalled()
  })

  it('does not truncate new-message extraction to the old 250-message scan limit', async () => {
    const ids = Array.from({ length: 501 }, (_, index) => `new-${index}`)
    mocks.order.mockResolvedValue({ data: [], error: null })
    await extractInvitationsForAccount('account', 'user', ids)
    expect(mocks.in.mock.calls.map(call => call[1])).toEqual([
      ids.slice(0, 200), ids.slice(200, 400), ids.slice(400),
    ])
  })

  it('preserves the full recent-message scan for explicit imports or reparsing', async () => {
    await extractInvitationsForAccount('account', 'user')
    expect(mocks.limit).toHaveBeenCalledWith(250)
    expect(mocks.in).not.toHaveBeenCalled()
  })

  it('propagates read failures before parsing any partial batch', async () => {
    mocks.order.mockResolvedValueOnce({ data: [], error: new Error('read failed') })
    await expect(extractInvitationsForAccount('account', 'user', ['new'])).rejects.toThrow('read failed')
  })

  it('queries newly stored messages since the last successful check when recovering', async () => {
    const since = '2026-10-01T00:00:00Z'
    await extractInvitationsForAccount('account', 'user', [], since)
    expect(mocks.gte).toHaveBeenCalledWith('created_at', since)
    expect(mocks.range).toHaveBeenCalledWith(0, 199)
    expect(mocks.limit).not.toHaveBeenCalled()
  })

  it('reports recovery-read failures instead of dropping pending invitations', async () => {
    mocks.range.mockResolvedValueOnce({ data: null, error: new Error('recovery read failed') })
    await expect(extractInvitationsForAccount('account', 'user', [], '2026-10-01T00:00:00Z'))
      .rejects.toThrow('recovery read failed')
  })

  it('paginates recovery reads and deduplicates messages already supplied as new', async () => {
    const message = {
      id: 'db-new', subject: null, body_text: '', body_html_sanitized: '',
      calendar_raw_text: '', from_email: null, received_at: null,
    }
    mocks.order.mockResolvedValueOnce({ data: [message], error: null })
    mocks.range.mockResolvedValueOnce({ data: [message], error: null })
      .mockResolvedValueOnce({ data: [{ ...message, id: 'db-retry' }], error: null })
    const result = await extractInvitationsForAccount('account', 'user', ['new'], '2026-10-01T00:00:00Z')
    expect(result.parsed).toBe(2)
    expect(mocks.range.mock.calls).toEqual([[0, 199], [1, 200], [2, 201]])
  })
})
