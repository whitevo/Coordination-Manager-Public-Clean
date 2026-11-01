import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'crypto'
import express from 'express'
import request from 'supertest'
import { errorHandler } from '../../middleware/error-handler.js'

const mockFrom = vi.fn()
const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockOrder = vi.fn()
const mockIn = vi.fn()
const mockMaybeSingle = vi.fn()
const mockSingle = vi.fn()
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockUpsert = vi.fn()
const mockDelete = vi.fn()
const mockRange = vi.fn()
const mockLimit = vi.fn()
const mockOr = vi.fn()
const mockIlike = vi.fn()
const mockIs = vi.fn()
const mockLt = vi.fn()
const mockGt = vi.fn()
const mockGetMailboxCredential = vi.fn()

const mockFetch = vi.fn()
const mockRunMailboxAccountSync = vi.fn()
const mockSendMailboxMessage = vi.fn()
const automationHook = vi.hoisted(() => ({
  run: null as ((input: {
    userId: string; accountId: string; newMessageProviderIds: string[]; junkedProviderMessageIds: string[]
  }) => Promise<{ matched: number; applied: number; deferred: number }>) | null,
}))
vi.stubGlobal('fetch', mockFetch)

vi.stubEnv('NODE_ENV', 'test')
vi.stubEnv('JWT_SECRET', 'test-jwt-secret')
vi.stubEnv('FRONTEND_URL', 'http://localhost:5173')
vi.stubEnv('GOOGLE_CLIENT_ID', 'test-google-client-id')
vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-google-client-secret')
vi.stubEnv('MAILBOX_MICROSOFT_CLIENT_ID', 'test-ms-client-id')
vi.stubEnv('MAILBOX_MICROSOFT_CLIENT_SECRET', 'test-ms-client-secret')
vi.stubEnv('MAILBOX_ENCRYPTION_KEY', '1111111111111111111111111111111111111111111111111111111111111111')

function createChain() {
  return {
    select: mockSelect,
    eq: mockEq,
    order: mockOrder,
    in: mockIn,
    maybeSingle: mockMaybeSingle,
    single: mockSingle,
    insert: mockInsert,
    update: mockUpdate,
    upsert: mockUpsert,
    delete: mockDelete,
    range: mockRange,
    limit: mockLimit,
    or: mockOr,
    ilike: mockIlike,
    is: mockIs,
    lt: mockLt,
    gt: mockGt,
  }
}

vi.mock('../../supabaseClient.js', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => {
      mockFrom(...args)
      return createChain()
    },
  },
}))

vi.mock('../../middleware/auth.js', () => ({
  authMiddleware: (req: { userId?: string; userEmail?: string }, _res: unknown, next: () => void) => {
    req.userId = '550e8400-e29b-41d4-a716-446655440000'
    req.userEmail = 'user@example.com'
    next()
  },
  AuthenticatedRequest: {},
}))

vi.mock('../../services/mailbox-sync.js', () => ({
  runMailboxAccountSync: mockRunMailboxAccountSync,
  setMailboxSyncAutomationHook: vi.fn((hook: NonNullable<typeof automationHook.run>) => { automationHook.run = hook }),
}))

vi.mock('../../services/mailbox-send.js', async () => ({
  ...(await vi.importActual('../../services/mailbox-send.js')),
  sendMailboxMessage: mockSendMailboxMessage,
}))

vi.mock('../../services/mailbox-credentials.js', async () => ({
  ...(await vi.importActual('../../services/mailbox-credentials.js')),
  getMailboxCredential: mockGetMailboxCredential,
  isMailboxEncryptionConfigured: vi.fn(() => true),
}))

async function createApp() {
  const { default: mailboxRouter } = await import('../mailbox.js')
  const app = express()
  app.use(express.json())
  app.use(express.urlencoded({ extended: false }))
  app.use('/api/mailbox', mailboxRouter)
  app.use(errorHandler)
  return app
}

describe('Mailbox Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    mockOrder.mockReset()
    mockIn.mockReset()
    mockMaybeSingle.mockReset()
    mockSingle.mockReset()
    mockRunMailboxAccountSync.mockReset()
    mockSendMailboxMessage.mockReset()
    mockSelect.mockReturnThis()
    mockEq.mockReturnThis()
    mockOrder.mockReturnThis()
    mockIn.mockReturnThis()
    mockInsert.mockReturnThis()
    mockUpdate.mockReturnThis()
    mockUpsert.mockReturnThis()
    mockDelete.mockReturnThis()
    mockRange.mockReturnThis()
    mockLimit.mockReturnThis()
    mockOr.mockReturnThis()
    mockIlike.mockReturnThis()
    mockIs.mockReturnThis()
    mockLt.mockResolvedValue({ error: null })
    mockGt.mockReturnThis()
    mockGetMailboxCredential.mockReset()
  })

  async function startOAuth(app: express.Express, provider: 'gmail' | 'outlook') {
    const response = await request(app).get(`/api/mailbox/oauth/${provider}/auth-url`)
      .query({ identity_group: 'work' })
    expect(response.status).toBe(200)
    const state = new URL(response.body.authUrl).searchParams.get('state')!
    const cookies = response.headers['set-cookie']
    if (!Array.isArray(cookies) || typeof cookies[0] !== 'string') throw new Error('Missing OAuth browser cookie')
    return { state, cookie: cookies[0].split(';')[0] }
  }

  it('returns the confirmed provider message id for sent-copy reconciliation', async () => {
    const app = await createApp()
    const draftId = '11111111-1111-4111-8111-111111111111'
    const draft = {
      id: draftId, account_id: '22222222-2222-4222-8222-222222222222',
      mode: 'new', status: 'draft', from_address: 'sender@example.com',
      to_emails: 'recipient@example.com', subject: 'Mocked send', body_text: 'Test reply',
      cc_emails: null, bcc_emails: null, attachments: [], in_reply_to_message_id: null,
    }
    mockMaybeSingle
      .mockResolvedValueOnce({ data: draft, error: null })
      .mockResolvedValueOnce({ data: { id: draft.account_id, provider: 'gmail', address: draft.from_address }, error: null })
    mockSendMailboxMessage.mockResolvedValueOnce({ providerMessageId: 'provider-sent-id' })
    mockSingle.mockResolvedValueOnce({ data: { ...draft, status: 'sent', sent_at: new Date().toISOString() }, error: null })
    const response = await request(app).post(`/api/mailbox/drafts/${draftId}/send`)
    expect(response.status).toBe(200)
    expect(response.body.provider_message_id).toBe('provider-sent-id')
    expect(response.body.draft.status).toBe('sent')
    expect(mockSendMailboxMessage).toHaveBeenCalledWith(expect.objectContaining({
      to: ['recipient@example.com'], cc: [], bcc: [],
    }))
  })

  it.each(['thread', 'message'] as const)('includes provider IDs when opening a %s for sent-copy reconciliation', async (mode) => {
    const app = await createApp()
    const accountId = '11111111-1111-4111-8111-111111111111'
    const threadId = '22222222-2222-4222-8222-222222222222'
    const messageId = '33333333-3333-4333-8333-333333333333'
    const thread = { id: threadId, account_id: accountId }
    const message = {
      id: messageId, account_id: accountId, thread_id: threadId,
      provider_message_id: 'provider-sent-id', subject: 'Reply',
      from_email: 'sender@example.com', to_emails: 'recipient@example.com',
      body_text: 'Sent reply', received_at: new Date().toISOString(),
    }
    mockOrder.mockResolvedValueOnce({
      data: [{ id: accountId, provider: 'gmail', address: 'sender@example.com' }], error: null,
    }).mockResolvedValueOnce({ data: [message], error: null })
    if (mode === 'message') {
      mockMaybeSingle
        .mockResolvedValueOnce({ data: { mailbox_threading_options: {} }, error: null })
        .mockResolvedValueOnce({ data: message, error: null })
    }
    mockMaybeSingle.mockResolvedValueOnce({ data: thread, error: null })
    const path = mode === 'thread' ? `/threads/${threadId}` : `/messages/${messageId}/thread`
    const response = await request(app).get(`/api/mailbox${path}`)
    expect(response.status).toBe(200)
    expect(response.body.messages[0].provider_message_id).toBe('provider-sent-id')
    expect(mockSelect).toHaveBeenCalledWith(expect.stringContaining('thread_id, provider_message_id, subject'))
  })

  it('POST /messages/bulk-action reports ordered per-message outcomes without exposing unavailable IDs', async () => {
    const app = await createApp()
    const accountId = '11111111-1111-4111-8111-111111111111'
    const successfulId = '22222222-2222-4222-8222-222222222222'
    const failedId = '33333333-3333-4333-8333-333333333333'
    const unavailableId = '44444444-4444-4444-8444-444444444444'
    mockOrder.mockResolvedValueOnce({
      data: [{ id: accountId, user_id: '550e8400-e29b-41d4-a716-446655440000', provider: 'imap', address: 'test@example.com' }],
      error: null,
    })
    mockIn.mockImplementation((column: string) => column === 'account_id'
      ? Promise.resolve({ data: [successfulId, failedId].map(id => ({ id, account_id: accountId, is_read: false })), error: null })
      : createChain())
    mockEq.mockImplementation((column: string, value: string) => column === 'id' && value === failedId
      ? Promise.resolve({ error: new Error('Simulated write failure') })
      : createChain())

    const response = await request(app).post('/api/mailbox/messages/bulk-action').send({
      message_ids: [successfulId, failedId, unavailableId], actions: [{ action: 'mark_read', value: '' }], cascade: false,
    })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ processed_messages: 2, applied: 1, failed: 1, contract_version: 1 })
    expect(response.body.results).toEqual([
      { message_id: successfulId, actions: [{ action_index: 0, action: 'mark_read', value: '', status: 'applied' }] },
      { message_id: failedId, actions: [{ action_index: 0, action: 'mark_read', value: '', status: 'uncertain', error: 'Simulated write failure' }] },
      { message_id: unavailableId, actions: [{ action_index: 0, action: 'mark_read', value: '', status: 'unavailable' }] },
    ])
    expect(mockIn).toHaveBeenCalledWith('account_id', [accountId])
    expect(JSON.stringify(response.body.results[2])).not.toContain('user_id')
  })

  it('POST /messages/bulk-action keeps successful effects applied when action-event recording fails', async () => {
    const app = await createApp()
    const accountId = '11111111-1111-4111-8111-111111111111'
    const messageId = '22222222-2222-4222-8222-222222222222'
    mockOrder.mockResolvedValueOnce({ data: [{ id: accountId, provider: 'imap', address: 'test@example.com' }], error: null })
    mockIn.mockImplementation((column: string) => column === 'account_id'
      ? Promise.resolve({ data: [{ id: messageId, account_id: accountId, is_read: false }], error: null })
      : createChain())
    mockInsert.mockImplementation((payload: Record<string, unknown>) => payload.source_type === 'manual'
      ? Promise.resolve({ error: new Error('Simulated action-event failure') })
      : createChain())

    const response = await request(app).post('/api/mailbox/messages/bulk-action').send({
      message_ids: [messageId], actions: [{ action: 'mark_read', value: '' }],
    })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ applied: 1, failed: 0 })
    expect(response.body.results[0].actions[0].status).toBe('applied')
    expect(response.body.warnings).toContainEqual({ code: 'ACTION_EVENT_NOT_RECORDED', message_id: messageId, action_index: 0 })
  })

  it('POST /messages/bulk-action reports audit failure without discarding applied outcomes', async () => {
    const app = await createApp()
    const accountId = '11111111-1111-4111-8111-111111111111'
    const messageId = '22222222-2222-4222-8222-222222222222'
    mockOrder.mockResolvedValueOnce({ data: [{ id: accountId, provider: 'imap', address: 'test@example.com' }], error: null })
    mockIn.mockImplementation((column: string) => column === 'account_id'
      ? Promise.resolve({ data: [{ id: messageId, account_id: accountId, is_read: false }], error: null })
      : createChain())
    mockInsert.mockImplementation((payload: Record<string, unknown>) => payload.operation === 'mailbox_bulk_action'
      ? Promise.resolve({ error: new Error('Simulated audit failure') })
      : createChain())
    const response = await request(app).post('/api/mailbox/messages/bulk-action').send({
      message_ids: [messageId], actions: [{ action: 'mark_read', value: '' }],
    })
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ applied: 1, failed: 0 })
    expect(response.body.results[0].actions[0].status).toBe('applied')
    expect(response.body.warnings).toContainEqual({ code: 'AUDIT_NOT_RECORDED' })
  })

  it('GET /accounts returns user accounts', async () => {
    const app = await createApp()

    mockOrder.mockResolvedValueOnce({
      data: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          provider: 'gmail',
          address: 'work@example.com',
          display_name: 'Work',
          identity_group: 'work',
          status: 'connected',
        },
      ],
      error: null,
    })

    const res = await request(app).get('/api/mailbox/accounts')

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.accounts)).toBe(true)
    expect(res.body.accounts[0].address).toBe('work@example.com')
  })

  it('POST /accounts validates provider', async () => {
    const app = await createApp()

    const res = await request(app)
      .post('/api/mailbox/accounts')
      .send({ provider: 'unknown', address: 'test@example.com' })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('provider must be gmail, outlook, or imap')
  })

  it('POST /accounts creates an account', async () => {
    const app = await createApp()

    mockSingle.mockResolvedValueOnce({
      data: {
        id: '22222222-2222-4222-8222-222222222222',
        provider: 'gmail',
        address: 'mail@example.com',
        identity_group: 'personal',
        status: 'connected',
      },
      error: null,
    })

    mockInsert.mockReturnThis()
    mockSelect.mockReturnThis()

    const res = await request(app)
      .post('/api/mailbox/accounts')
      .send({
        provider: 'gmail',
        address: 'mail@example.com',
        display_name: 'Main',
        identity_group: 'personal',
      })

    expect(res.status).toBe(201)
    expect(res.body.account.provider).toBe('gmail')
  })

  it('PUT /accounts/:id/primary transfers the primary account', async () => {
    const app = await createApp()
    const accountId = '22222222-2222-4222-8222-222222222222'
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: accountId,
        user_id: '550e8400-e29b-41d4-a716-446655440000',
        provider: 'gmail',
        address: 'mail@example.com',
        display_name: 'Main',
        identity_group: 'personal',
        status: 'connected',
        is_primary: false,
      },
      error: null,
    })
    mockSingle.mockResolvedValueOnce({
      data: { id: accountId, is_primary: true },
      error: null,
    })

    const res = await request(app)
      .put(`/api/mailbox/accounts/${accountId}/primary`)
      .send({ is_primary: true })

    expect(res.status).toBe(200)
    expect(res.body.account.is_primary).toBe(true)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ is_primary: false }))
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ is_primary: true }))
  })

  it('POST /accounts validates IMAP settings', async () => {
    const app = await createApp()

    const res = await request(app)
      .post('/api/mailbox/accounts')
      .send({
        provider: 'imap',
        address: 'mail@example.com',
        display_name: 'Manual IMAP',
        identity_group: 'personal',
      })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('IMAP requires imap_host, imap_port, imap_username, and imap_password')
  })

  it('POST /accounts creates an IMAP account with stored connection metadata', async () => {
    const app = await createApp()

    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
    mockSingle.mockResolvedValueOnce({
      data: {
        id: '33333333-3333-4333-8333-333333333333',
        provider: 'imap',
        address: 'mail@example.com',
        identity_group: 'personal',
        status: 'connected',
      },
      error: null,
    })
    mockSingle.mockResolvedValueOnce({ data: { id: 'cred-1' }, error: null })

    mockInsert.mockReturnThis()
    mockSelect.mockReturnThis()

    const res = await request(app)
      .post('/api/mailbox/accounts')
      .send({
        provider: 'imap',
        address: 'mail@example.com',
        display_name: 'Manual IMAP',
        identity_group: 'personal',
        imap_host: 'imap.example.com',
        imap_port: 993,
        imap_username: 'mail@example.com',
        imap_password: 'app-password',
        imap_security: 'ssl',
        imap_mailbox: 'INBOX',
      })

    expect(res.status).toBe(201)
    expect(res.body.account.provider).toBe('imap')
  })

  it('PUT /accounts/:id updates connected account settings', async () => {
    const app = await createApp()

    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: '44444444-4444-4444-8444-444444444444',
        user_id: '550e8400-e29b-41d4-a716-446655440000',
        provider: 'imap',
        address: 'mail.example.com',
        display_name: 'Manual IMAP',
        identity_group: 'personal',
        status: 'connected',
      },
      error: null,
    })

    mockSingle.mockResolvedValueOnce({
      data: {
        id: '44444444-4444-4444-8444-444444444444',
        user_id: '550e8400-e29b-41d4-a716-446655440000',
        provider: 'imap',
        address: 'mail.example.com',
        display_name: 'Personal Mail',
        identity_group: 'work',
        status: 'connected',
      },
      error: null,
    })

    mockUpdate.mockReturnThis()
    mockSelect.mockReturnThis()
    mockEq.mockReturnThis()

    const res = await request(app)
      .put('/api/mailbox/accounts/44444444-4444-4444-8444-444444444444')
      .send({
        display_name: 'Personal Mail',
        identity_group: 'work',
      })

    expect(res.status).toBe(200)
    expect(res.body.account.display_name).toBe('Personal Mail')
    expect(res.body.account.identity_group).toBe('work')
  })

  it('PUT /accounts/:id persists independent Quick Sync sources', async () => {
    const app = await createApp()

    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: '44444444-4444-4444-8444-444444444444',
        user_id: '550e8400-e29b-41d4-a716-446655440000',
        provider: 'gmail',
        address: 'mail@example.com',
        display_name: 'Mailbox',
        identity_group: 'personal',
        status: 'connected',
        sync_options: {
          includeInbox: true,
          includeSent: false,
          includeTrash: false,
          includeSpam: false,
        },
      },
      error: null,
    })
    mockSingle.mockResolvedValueOnce({ data: { id: '44444444-4444-4444-8444-444444444444' }, error: null })

    const res = await request(app)
      .put('/api/mailbox/accounts/44444444-4444-4444-8444-444444444444')
      .send({ quick_sync_include_sent: true })

    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      sync_options: expect.objectContaining({
        includeInbox: true,
        includeSent: false,
        quickSyncIncludeInbox: true,
        quickSyncIncludeSent: true,
        quickSyncIncludeTrash: false,
        quickSyncIncludeSpam: false,
      }),
    }))
  })

  it('PUT /accounts/:id persists Import Settings sources immediately', async () => {
    const app = await createApp()

    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: '44444444-4444-4444-8444-444444444444',
        user_id: '550e8400-e29b-41d4-a716-446655440000',
        provider: 'gmail',
        address: 'mail@example.com',
        display_name: 'Mailbox',
        identity_group: 'personal',
        status: 'connected',
        sync_options: {
          includeInbox: true,
          includeSent: true,
          includeTrash: false,
          includeSpam: false,
          quickSyncIncludeInbox: true,
          quickSyncIncludeSent: false,
        },
      },
      error: null,
    })
    mockSingle.mockResolvedValueOnce({ data: { id: '44444444-4444-4444-8444-444444444444' }, error: null })

    const res = await request(app)
      .put('/api/mailbox/accounts/44444444-4444-4444-8444-444444444444')
      .send({ include_trash: true })

    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      sync_options: expect.objectContaining({
        includeInbox: true,
        includeSent: true,
        includeTrash: true,
        includeSpam: false,
        quickSyncIncludeInbox: true,
        quickSyncIncludeSent: false,
      }),
    }))
  })

  it('POST /accounts/:id/disconnect purges imported account data and preserves user configuration', async () => {
    const app = await createApp()

    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: '44444444-4444-4444-8444-444444444444',
        user_id: '550e8400-e29b-41d4-a716-446655440000',
        provider: 'gmail',
        address: 'mail.example.com',
        display_name: 'Mailbox',
        identity_group: 'personal',
        status: 'connected',
        connected_at: new Date().toISOString(),
        last_synced_at: new Date().toISOString(),
        sync_error: null,
      },
      error: null,
    })

    const res = await request(app)
      .post('/api/mailbox/accounts/44444444-4444-4444-8444-444444444444/disconnect')

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(mockFrom).toHaveBeenCalledWith('mail_credentials')
    expect(mockFrom).toHaveBeenCalledWith('mail_messages')
    expect(mockFrom).toHaveBeenCalledWith('mail_threads')
    expect(mockFrom).toHaveBeenCalledWith('mail_sync_cursors')
    expect(mockFrom).toHaveBeenCalledWith('mail_accounts')
    expect(mockFrom).not.toHaveBeenCalledWith('mail_user_preferences')
    expect(mockFrom).not.toHaveBeenCalledWith('mail_rules')
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'disconnected',
      credentials_ref: null,
      provider_metadata: {},
      last_synced_at: null,
      sync_cursor: null,
      sync_error: null,
    }))
  })

  it('GET /preferences/filter-rules returns the authenticated user shared rules', async () => {
    const app = await createApp()
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        mailbox_filter_rules: [{
          id: 'filter-invoices',
          name: 'Invoices',
          sort: {
            order: ['group:system', 'date'],
            dateEnabled: true,
            dateDirection: 'newest',
            systemTags: [{ id: 'system:unread', mode: 'only' }],
            userTags: [],
          },
        }],
      },
      error: null,
    })

    const res = await request(app).get('/api/mailbox/preferences/filter-rules')

    expect(res.status).toBe(200)
    expect(res.body.filters).toEqual([expect.objectContaining({ id: 'filter-invoices', name: 'Invoices' })])
    expect(mockEq).toHaveBeenCalledWith('user_id', '550e8400-e29b-41d4-a716-446655440000')
  })

  it('PUT /preferences/filter-rules persists only normalized shared rules', async () => {
    const app = await createApp()
    mockUpsert.mockResolvedValueOnce({ error: null })

    const res = await request(app)
      .put('/api/mailbox/preferences/filter-rules')
      .send({
        filters: [
          {
            id: 'filter-invoices',
            name: 'Invoices',
            sort: {
              order: ['group:system', 'invalid'],
              dateEnabled: false,
              dateDirection: 'oldest',
              systemTags: [{ id: 'system:unread', mode: 'only' }, { id: 'system:unknown', mode: 'hide' }],
              userTags: [{ id: 'user:not-a-uuid', mode: 'hide' }],
            },
          },
          { id: '', name: 'Ignored', sort: {} },
        ],
      })

    expect(res.status).toBe(200)
    expect(res.body.filters).toHaveLength(1)
    expect(res.body.filters[0].sort).toMatchObject({
      order: ['group:system'],
      dateEnabled: false,
      dateDirection: 'oldest',
      systemTags: [{ id: 'system:unread', mode: 'only' }],
      userTags: [],
    })
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: '550e8400-e29b-41d4-a716-446655440000',
      mailbox_filter_rules: res.body.filters,
    }), { onConflict: 'user_id' })
  })

  it('GET /messages returns empty when no connected accounts', async () => {
    const app = await createApp()

    mockOrder.mockResolvedValueOnce({ data: [], error: null })

    const res = await request(app).get('/api/mailbox/messages')

    expect(res.status).toBe(200)
    expect(res.body.messages).toEqual([])
    expect(res.body.total).toBe(0)
  })

  it('GET /oauth/:provider/auth-url returns provider auth url', async () => {
    const app = await createApp()

    const res = await request(app)
      .get('/api/mailbox/oauth/gmail/auth-url')
      .query({ identity_group: 'work' })

    expect(res.status).toBe(200)
    expect(res.body.authUrl).toContain('accounts.google.com')
    expect(res.body.authUrl).toContain('state=')
    const authUrl = new URL(res.body.authUrl)
    const scopes = authUrl.searchParams.get('scope')?.split(' ') || []
    expect(authUrl.searchParams.get('prompt')).toBeNull()
    expect(authUrl.searchParams.get('include_granted_scopes')).toBe('true')
    expect(scopes).toContain('https://www.googleapis.com/auth/gmail.modify')
    expect(scopes).toContain('https://www.googleapis.com/auth/gmail.send')
    expect(scopes).not.toContain('https://www.googleapis.com/auth/gmail.readonly')
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['set-cookie'][0]).toContain('HttpOnly')
    expect(res.headers['set-cookie'][0]).toContain('SameSite=Lax')
    expect(res.headers['set-cookie'][0]).toContain('Path=/api/mailbox/oauth/gmail')
  })

  it('GET /oauth/:provider/auth-url does not request redundant Outlook mail scopes', async () => {
    const app = await createApp()

    const res = await request(app)
      .get('/api/mailbox/oauth/outlook/auth-url')
      .query({ identity_group: 'work' })

    expect(res.status).toBe(200)
    expect(res.body.authUrl).toContain('login.microsoftonline.com')
    const authUrl = new URL(res.body.authUrl)
    const scopes = authUrl.searchParams.get('scope')?.split(' ') || []
    expect(scopes).toContain('offline_access')
    expect(scopes).toContain('Mail.ReadWrite')
    expect(scopes).toContain('Mail.Send')
    expect(scopes).not.toContain('Mail.Read')
  })

  it('does not issue OAuth URLs or browser cookies when transaction storage fails', async () => {
    const app = await createApp()
    mockLt.mockResolvedValueOnce({ error: new Error('Transaction storage unavailable') })
    const response = await request(app).get('/api/mailbox/oauth/gmail/auth-url')
    expect(response.status).toBe(500)
    expect(response.body.authUrl).toBeUndefined()
    expect(response.headers['set-cookie']).toBeUndefined()
  })

  it('sets Secure on production browser-binding cookies', async () => {
    const app = await createApp()
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const response = await request(app).get('/api/mailbox/oauth/gmail/auth-url')
      expect(response.status).toBe(200)
      expect(response.headers['set-cookie'][0]).toContain('Secure')
    } finally {
      vi.stubEnv('NODE_ENV', 'test')
    }
  })

  it('POST /accounts/:id/sync uses the new default import settings when omitted', async () => {
    const app = await createApp()

    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: '11111111-1111-4111-8111-111111111111',
        user_id: '550e8400-e29b-41d4-a716-446655440000',
        provider: 'gmail',
        address: 'default@example.com',
        display_name: 'Default',
        identity_group: 'work',
        status: 'connected',
        connected_at: new Date().toISOString(),
        last_synced_at: null,
        sync_error: null,
      },
      error: null,
    })
    mockRunMailboxAccountSync.mockResolvedValueOnce({
      status: 'connected',
      lastSyncedAt: new Date().toISOString(),
      insertedMessages: 0,
      updatedMessages: 0,
      newMessageProviderIds: [],
      cursor: null,
      invitationsParsed: 0,
      invitationsChanged: false,
      error: null,
    })

    const res = await request(app).post('/api/mailbox/accounts/11111111-1111-4111-8111-111111111111/sync')

    expect(res.status).toBe(200)
    expect(mockRunMailboxAccountSync).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      '550e8400-e29b-41d4-a716-446655440000',
      'user',
      {
        maxMessages: 40,
        daysBack: 1,
        includeInbox: true,
        includeSent: true,
        includeTrash: true,
        includeSpam: true,
        includeArchived: true,
        newMailOnly: false,
        quickSyncAfter: undefined,
      },
    )
  })

  it('POST /accounts/:id/sync forwards the new-mail-only option', async () => {
    const app = await createApp()

    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: '11111111-1111-4111-8111-111111111111',
        user_id: '550e8400-e29b-41d4-a716-446655440000',
        provider: 'gmail',
        address: 'default@example.com',
        display_name: 'Default',
        identity_group: 'work',
        status: 'connected',
        connected_at: new Date().toISOString(),
        last_synced_at: null,
        sync_error: null,
      },
      error: null,
    })
    mockRunMailboxAccountSync.mockResolvedValueOnce({
      status: 'connected',
      lastSyncedAt: new Date().toISOString(),
      insertedMessages: 0,
      updatedMessages: 0,
      newMessageProviderIds: [],
      cursor: null,
      invitationsParsed: 0,
      invitationsChanged: false,
      automation: { matched: 0, applied: 0, deferred: 0 },
      error: null,
    })

    const res = await request(app)
      .post('/api/mailbox/accounts/11111111-1111-4111-8111-111111111111/sync')
      .send({ new_mail_only: true, include_sent: false, include_trash: false, include_spam: false })

    expect(res.status).toBe(200)
    expect(mockRunMailboxAccountSync).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      '550e8400-e29b-41d4-a716-446655440000',
      'user',
      expect.objectContaining({
        includeInbox: true,
        includeSent: false,
        includeTrash: false,
        includeSpam: false,
        newMailOnly: true,
      }),
    )
  })

  it('POST /accounts/:id/sync uses Quick Sync sources independently from import sources', async () => {
    const app = await createApp()

    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: '11111111-1111-4111-8111-111111111111',
        user_id: '550e8400-e29b-41d4-a716-446655440000',
        provider: 'gmail',
        address: 'default@example.com',
        display_name: 'Default',
        identity_group: 'work',
        status: 'connected',
        connected_at: new Date().toISOString(),
        last_synced_at: null,
        sync_error: null,
        sync_options: {
          includeInbox: true,
          includeSent: true,
          quickSyncIncludeInbox: true,
          quickSyncIncludeSent: false,
          quickSyncIncludeTrash: false,
          quickSyncIncludeSpam: false,
        },
      },
      error: null,
    })
    mockRunMailboxAccountSync.mockResolvedValueOnce({
      status: 'connected',
      lastSyncedAt: new Date().toISOString(),
      insertedMessages: 0,
      updatedMessages: 0,
      newMessageProviderIds: [],
      cursor: null,
      invitationsParsed: 0,
      invitationsChanged: false,
      automation: { matched: 0, applied: 0, deferred: 0 },
      error: null,
    })

    const res = await request(app)
      .post('/api/mailbox/accounts/11111111-1111-4111-8111-111111111111/sync')
      .send({ new_mail_only: true })

    expect(res.status).toBe(200)
    expect(mockRunMailboxAccountSync).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      '550e8400-e29b-41d4-a716-446655440000',
      'user',
      expect.objectContaining({
        includeInbox: true,
        includeSent: false,
        includeTrash: false,
        includeSpam: false,
        newMailOnly: true,
      }),
    )
  })

  it('GET /messages supports page-based pagination', async () => {
    const app = await createApp()

    mockOrder
      .mockResolvedValueOnce({ data: [{ id: 'acc-1', user_id: '550e8400-e29b-41d4-a716-446655440000', provider: 'gmail', address: 'mail@example.com', display_name: 'Main', identity_group: 'personal', status: 'connected', connected_at: new Date().toISOString(), last_synced_at: null, sync_error: null }], error: null })
      .mockReturnThis()

    mockRange.mockResolvedValueOnce({
      data: [{ id: 'msg-1', account_id: 'acc-1', thread_id: null, subject: 'Hello', from_email: 'sender@example.com', from_name: 'Sender', to_emails: 'user@example.com', received_at: new Date().toISOString(), preview: 'Hi', is_read: false, is_archived: false, has_attachments: false, provider_metadata: null }],
      error: null,
      count: 42,
    })

    const res = await request(app)
      .get('/api/mailbox/messages')
      .query({ page: 2, limit: 10 })

    expect(res.status).toBe(200)
    expect(mockRange).toHaveBeenCalledWith(10, 19)
    expect(res.body.total).toBe(42)
  })

  it.each([
    { code: 'PGRST103', offset: 1030, status: 200 },
    { code: 'PGRST103', offset: 0, status: 500 },
    { code: '57014', offset: 1030, status: 500 },
  ])('handles pagination exhaustion without hiding other failures ($code, offset $offset)', async ({ code, offset, status }) => {
    const app = await createApp()
    mockOrder.mockResolvedValueOnce({
      data: [{ id: 'acc-1', provider: 'gmail', status: 'connected' }], error: null,
    }).mockReturnThis()
    mockRange.mockResolvedValueOnce({
      data: null, error: { code, message: code === 'PGRST103' ? 'Requested range not satisfiable' : 'statement timeout' },
    })
    const res = await request(app).get('/api/mailbox/messages').query({ offset, limit: 30 })
    expect(res.status).toBe(status)
    if (status === 200) {
      expect(res.body).toEqual({ messages: [], total: offset, has_more: false })
    } else {
      expect(res.body.error).toBeTruthy()
    }
  })

  it('GET /messages allows limits above 100', async () => {
    const app = await createApp()

    mockOrder
      .mockResolvedValueOnce({ data: [{ id: 'acc-1', user_id: '550e8400-e29b-41d4-a716-446655440000', provider: 'gmail', address: 'mail@example.com', display_name: 'Main', identity_group: 'personal', status: 'connected', connected_at: new Date().toISOString(), last_synced_at: null, sync_error: null }], error: null })
      .mockReturnThis()

    mockRange.mockResolvedValueOnce({
      data: [],
      error: null,
      count: 250,
    })

    const res = await request(app)
      .get('/api/mailbox/messages')
      .query({ page: 1, limit: 250 })

    expect(res.status).toBe(200)
    expect(mockRange).toHaveBeenCalledWith(0, 249)
    expect(res.body.total).toBe(250)
  })

  it('GET /oauth/:provider/callback creates mailbox account and redirects', async () => {
    const app = await createApp()
    const { state, cookie } = await startOAuth(app, 'gmail')

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'gmail-access-token',
        refresh_token: 'gmail-refresh-token',
        expires_in: 3600,
        scope: 'mail.readonly',
      }),
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        email: 'newmail@example.com',
        name: 'Mailbox User',
      }),
    })

    mockMaybeSingle
      .mockResolvedValueOnce({ data: { id: 'transaction' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null })

    mockSingle
      .mockResolvedValueOnce({ data: { id: 'acc-1' }, error: null })
      .mockResolvedValueOnce({ data: { id: 'cred-1' }, error: null })

    const res = await request(app)
      .get('/api/mailbox/oauth/gmail/callback')
      .set('Cookie', cookie)
      .query({ code: 'auth-code', state })

    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('/mailbox?oauth_success=true')
    expect(mockFrom).toHaveBeenCalledWith('mail_accounts')
    expect(mockFrom).toHaveBeenCalledWith('mail_credentials')
    expect(res.headers['set-cookie'][0]).toContain('Expires=Thu, 01 Jan 1970')
  })

  it('POST /oauth/:provider/callback accepts Microsoft form posts', async () => {
    const app = await createApp()
    const { state, cookie } = await startOAuth(app, 'outlook')

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'outlook-access-token',
        refresh_token: 'outlook-refresh-token',
        expires_in: 3600,
        scope: 'Mail.Read User.Read',
      }),
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        mail: 'user@example.com',
        displayName: 'Mailbox User',
      }),
    })

    mockMaybeSingle
      .mockResolvedValueOnce({ data: { id: 'transaction' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null })

    mockSingle
      .mockResolvedValueOnce({ data: { id: 'acc-1' }, error: null })
      .mockResolvedValueOnce({ data: { id: 'cred-1' }, error: null })

    const res = await request(app)
      .post('/api/mailbox/oauth/outlook/callback')
      .set('Cookie', cookie)
      .type('form')
      .send({ code: 'auth-code', state })

    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('/mailbox?oauth_success=true')
    expect(mockFrom).toHaveBeenCalledWith('mail_accounts')
    expect(mockFrom).toHaveBeenCalledWith('mail_credentials')
  })

  it('rejects a callback opened in another browser without exchanging codes or writing credentials', async () => {
    const app = await createApp()
    const { state } = await startOAuth(app, 'gmail')
    mockFrom.mockClear()
    const response = await request(app).get('/api/mailbox/oauth/gmail/callback')
      .query({ code: 'victim-code', state })
    expect(response.headers.location).toContain('oauth_error=')
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it.each(['wrong-cookie', 'replayed', 'provider-mismatch', 'expired', 'tampered'])(
    'rejects %s callbacks before provider exchange',
    async (scenario) => {
      const app = await createApp()
      const started = await startOAuth(app, 'gmail')
      let { state, cookie } = started
      if (scenario === 'wrong-cookie') cookie = `cm_mailbox_oauth_gmail=${'a'.repeat(64)}`
      if (scenario === 'expired') {
        const payload = JSON.parse(Buffer.from(state.split('.')[0], 'base64url').toString())
        payload.expiresAt = Date.now() - 1
        const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
        state = `${data}.${createHmac('sha256', 'test-jwt-secret').update(data).digest('base64url')}`
      }
      if (scenario === 'tampered') state += 'x'
      mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
      const provider = scenario === 'provider-mismatch' ? 'outlook' : 'gmail'
      const response = await request(app).get(`/api/mailbox/oauth/${provider}/callback`)
        .set('Cookie', cookie).query({ code: 'victim-code', state })
      expect(response.headers.location).toContain('oauth_error=')
      expect(mockFetch).not.toHaveBeenCalled()
      expect(mockFrom).not.toHaveBeenCalledWith('mail_accounts')
      expect(mockFrom).not.toHaveBeenCalledWith('mail_credentials')
    },
  )

  it('consumes provider-denied transactions and fails closed on transaction storage errors', async () => {
    const app = await createApp()
    const { state, cookie } = await startOAuth(app, 'gmail')
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: 'transaction' }, error: null })
    const denied = await request(app).get('/api/mailbox/oauth/gmail/callback')
      .set('Cookie', cookie).query({ error: 'access_denied', state })
    expect(denied.headers.location).toContain('access_denied')
    expect(mockFetch).not.toHaveBeenCalled()

    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: new Error('Transaction storage unavailable') })
    const failed = await request(app).get('/api/mailbox/oauth/gmail/callback')
      .set('Cookie', cookie).query({ code: 'code', state })
    expect(failed.headers.location).toContain('oauth_error=')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('POST /messages/:id/read updates the provider before saving local read state', async () => {
    const app = await createApp()

    mockOrder
      .mockResolvedValueOnce({
        data: [
          {
            id: 'acc-1',
            user_id: '550e8400-e29b-41d4-a716-446655440000',
            provider: 'gmail',
            address: 'mail@example.com',
            display_name: 'Main',
            identity_group: 'personal',
            status: 'connected',
            connected_at: new Date().toISOString(),
            last_synced_at: null,
            sync_error: null,
          },
        ],
        error: null,
      })
      .mockReturnThis()

    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: '33333333-3333-4333-8333-333333333333',
        account_id: 'acc-1',
        provider_message_id: 'gmail-msg-123',
        provider_metadata: { provider_message: { id: 'gmail-msg-123' } },
      },
      error: null,
    })

    mockGetMailboxCredential.mockResolvedValueOnce({
      accessToken: 'access-token',
      refreshToken: null,
      expiresAt: null,
      scope: null,
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
    })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
    })

    const res = await request(app)
      .post('/api/mailbox/messages/33333333-3333-4333-8333-333333333333/read')
      .send({ is_read: true })

    expect(res.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/gmail-msg-123/modify',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
      }),
    )
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ is_read: true, updated_at: expect.any(String) }),
    )
  })

  it('POST /messages/:id/read still persists local state when the provider update fails', async () => {
    const app = await createApp()

    mockOrder
      .mockResolvedValueOnce({
        data: [
          {
            id: 'acc-1',
            user_id: '550e8400-e29b-41d4-a716-446655440000',
            provider: 'gmail',
            address: 'mail@example.com',
            display_name: 'Main',
            identity_group: 'personal',
            status: 'connected',
            connected_at: new Date().toISOString(),
            last_synced_at: null,
            sync_error: null,
          },
        ],
        error: null,
      })
      .mockReturnThis()

    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: '33333333-3333-4333-8333-333333333333',
        account_id: 'acc-1',
        provider_message_id: 'gmail-msg-123',
        provider_metadata: { provider_message: { id: 'gmail-msg-123' } },
      },
      error: null,
    })

    mockGetMailboxCredential.mockResolvedValueOnce({
      accessToken: 'access-token',
      refreshToken: null,
      expiresAt: null,
      scope: null,
    })

    mockFetch.mockRejectedValueOnce(new Error('provider unavailable'))

    const res = await request(app)
      .post('/api/mailbox/messages/33333333-3333-4333-8333-333333333333/read')
      .send({ is_read: true })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ is_read: true, updated_at: expect.any(String) }),
    )
  })

  it('POST /messages/:id/junk records the manual action for every owned thread message', async () => {
    const app = await createApp()
    const firstMessageId = '33333333-3333-4333-8333-333333333333'
    const secondMessageId = '44444444-4444-4444-8444-444444444444'

    mockOrder
      .mockResolvedValueOnce({
        data: [{
          id: 'acc-1',
          user_id: '550e8400-e29b-41d4-a716-446655440000',
          provider: 'gmail',
          address: 'mail@example.com',
          display_name: 'Main',
          identity_group: 'personal',
          status: 'connected',
          connected_at: new Date().toISOString(),
          last_synced_at: null,
          sync_error: null,
        }],
        error: null,
      })
      .mockResolvedValueOnce({ data: [], error: null })

    mockMaybeSingle
      .mockResolvedValueOnce({
        data: { id: firstMessageId, account_id: 'acc-1', from_email: 'spam@example.com' },
        error: null,
      })
      .mockResolvedValueOnce({ data: { junk_domains: [] }, error: null })

    mockIn
      .mockReturnValueOnce(createChain())
      .mockReturnValueOnce(createChain())
      .mockResolvedValueOnce({
        data: [
          { id: firstMessageId, account_id: 'acc-1' },
          { id: secondMessageId, account_id: 'acc-1' },
        ],
        error: null,
      })

    const res = await request(app)
      .post(`/api/mailbox/messages/${firstMessageId}/junk`)
      .send({ message_ids: [firstMessageId, secondMessageId] })

    expect(res.status).toBe(200)
    const manualJunkEvents = mockInsert.mock.calls
      .map(([value]) => value as Record<string, unknown>)
      .filter((value) => value.source_type === 'manual' && value.action === 'junk')
    expect(manualJunkEvents.map((event) => event.message_id)).toEqual([firstMessageId, secondMessageId])
  })

  it.each(['active', 'dry_run', 'disabled', 'provider_failure'])(
    'runs the manual Junk receive-action cascade with mode %s',
    async (scenario) => {
      const app = await createApp()
      const messageId = '33333333-3333-4333-8333-333333333333'
      const tagId = '44444444-4444-4444-8444-444444444444'
      const ownedAccount = {
        id: 'acc-1', user_id: '550e8400-e29b-41d4-a716-446655440000',
        provider: 'gmail', address: 'mail@example.com', status: 'connected',
      }
      const rule = {
        id: 'rule-junk-trash', name: 'Junk is trash', account_id: null,
        mode: scenario === 'provider_failure' ? 'active' : scenario, stop_processing: false,
        conditions: { match: 'all', steps: [
          { id: 'receive', kind: 'receive_action', position: 0, enabled: true, action: 'junk', value: '', allowRecursion: false },
        ] },
        actions: { steps: [
          { id: 'tag', kind: 'action', position: 1, enabled: true, action: 'add_tag', value: tagId },
          { id: 'trash', kind: 'action', position: 2, enabled: true, action: 'trash', value: '' },
        ] },
      }
      mockOrder
        .mockResolvedValueOnce({ data: [ownedAccount], error: null })
        .mockResolvedValueOnce({ data: [rule], error: null })
        .mockResolvedValueOnce({ data: [ownedAccount], error: null })
      mockMaybeSingle
        .mockResolvedValueOnce({ data: { id: messageId, account_id: 'acc-1', from_email: 'spam@example.com' }, error: null })
        .mockResolvedValueOnce({ data: { junk_domains: [] }, error: null })
        .mockResolvedValueOnce({ data: { mailbox_tags: [{ id: tagId, label: 'Processed junk', color: '#ff0000' }] }, error: null })
      mockIn
        .mockReturnValueOnce(createChain())
        .mockReturnValueOnce(createChain())
        .mockResolvedValueOnce({ data: [{ id: messageId, account_id: 'acc-1' }], error: null })
        .mockReturnValueOnce(createChain())
        .mockResolvedValueOnce({ data: [{
          id: messageId, account_id: 'acc-1', provider_message_id: 'gmail-junk',
          provider_metadata: {}, from_email: 'spam@example.com', subject: 'Junk fixture',
        }], error: null })
        .mockResolvedValueOnce({ data: [{
          message_id: messageId, action: 'junk', action_value: '',
          source_type: 'manual', source_rule_id: null,
        }], error: null })
      mockGetMailboxCredential.mockResolvedValue({
        accessToken: 'test-access', expiresAt: '2099-01-01T00:00:00Z',
      })
      mockFetch.mockResolvedValue({
        ok: scenario !== 'provider_failure', status: scenario === 'provider_failure' ? 503 : 200,
        json: async () => scenario === 'provider_failure' ? { error: { message: 'Provider temporarily unavailable' } } : {},
        text: async () => 'Provider temporarily unavailable',
      })
      const res = await request(app).post(`/api/mailbox/messages/${messageId}/junk`).send({})
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      if (scenario === 'active' || scenario === 'provider_failure') {
        expect(mockFetch).toHaveBeenCalledTimes(1)
        expect(mockFetch.mock.calls[0][0]).toContain('/messages/gmail-junk/trash')
        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
          provider_metadata: expect.objectContaining({ user_tag_ids: [tagId] }),
        }))
        if (scenario === 'active') {
          expect(res.body.automation_warnings).toEqual([])
          expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
            provider_metadata: expect.objectContaining({ user_tag_ids: [tagId], provider_trashed: true }),
          }))
        } else {
          expect(res.body.automation_warnings.join(' ')).toContain('Provider temporarily unavailable')
        }
      } else {
        expect(mockFetch).not.toHaveBeenCalled()
        expect(mockUpdate).not.toHaveBeenCalled()
      }
    },
  )

  it.each(['provider_import', 'sender_list_import', 'existing_transition'])(
    'applies Junk is trash during %s before sync completes',
    async (scenario) => {
      await createApp()
      const messageId = '33333333-3333-4333-8333-333333333333'
      const tagId = '44444444-4444-4444-8444-444444444444'
      const account = {
        id: 'acc-1', user_id: '550e8400-e29b-41d4-a716-446655440000',
        provider: 'gmail', address: 'mail@example.com', status: 'connected',
      }
      const row = {
        id: messageId, account_id: account.id, provider_message_id: 'gmail-junk',
        from_email: 'spam@example.com', is_archived: false,
        provider_metadata: { provider_junk: scenario !== 'sender_list_import' },
      }
      const rule = {
        id: 'junk-rule', name: 'Junk is trash', mode: 'active', stop_processing: false,
        conditions: { match: 'all', steps: [
          { id: 'receive', kind: 'receive_action', position: 0, enabled: true, action: 'junk', value: '', allowRecursion: false },
        ] },
        actions: { steps: [
          { id: 'tag', kind: 'action', position: 1, enabled: true, action: 'add_tag', value: tagId },
          { id: 'trash', kind: 'action', position: 2, enabled: true, action: 'trash', value: '' },
        ] },
      }
      const ordinaryRule = {
        id: 'ordinary', name: 'New mail only', mode: 'active', stop_processing: false,
        conditions: { match: 'all', steps: [
          { id: 'subject', kind: 'condition', position: 0, enabled: true, field: 'from_email', operator: 'contains', value: 'spam' },
        ] },
        actions: { steps: [
          { id: 'unread', kind: 'action', position: 1, enabled: true, action: 'mark_unread', value: '' },
        ] },
      }
      mockOrder
        .mockResolvedValueOnce({ data: scenario === 'existing_transition' ? [rule, ordinaryRule] : [rule], error: null })
        .mockResolvedValueOnce({ data: [account], error: null })
      mockMaybeSingle
        .mockResolvedValueOnce({ data: account, error: null })
        .mockResolvedValueOnce({ data: { junk_domains: scenario === 'sender_list_import' ? ['example.com'] : [] }, error: null })
        .mockResolvedValueOnce({ data: { mailbox_tags: [{ id: tagId, label: 'Processed junk', color: '#ff0000' }] }, error: null })
      const action = scenario === 'sender_list_import' ? 'junk' : 'import_junk'
      mockIn
        .mockResolvedValueOnce({ data: [{ id: messageId }], error: null })
        .mockResolvedValueOnce({ data: [row], error: null })
        .mockReturnValueOnce(createChain())
        .mockResolvedValueOnce({ data: [row], error: null })
        .mockResolvedValueOnce({ data: [{
          message_id: messageId, action, source_type: 'import', source_rule_id: null,
        }], error: null })
      mockGetMailboxCredential.mockResolvedValue({ accessToken: 'test-access', expiresAt: '2099-01-01T00:00:00Z' })
      mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
      if (!automationHook.run) throw new Error('Sync automation hook was not registered')
      const result = await automationHook.run({
        userId: account.user_id, accountId: account.id,
        newMessageProviderIds: scenario === 'existing_transition' ? [] : ['gmail-junk'],
        junkedProviderMessageIds: scenario === 'existing_transition' ? ['gmail-junk'] : [],
      })
      expect(result).toEqual({ matched: 1, applied: 2, deferred: 0 })
      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        message_id: messageId, action, source_type: 'import',
      }))
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch.mock.calls[0][0]).toContain('/messages/gmail-junk/trash')
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
        provider_metadata: expect.objectContaining({ user_tag_ids: [tagId], provider_trashed: true }),
      }))
    },
  )

  it('does not junk or run automation for a message outside the user accounts', async () => {
    const app = await createApp()
    mockOrder.mockResolvedValueOnce({ data: [{ id: 'owned-account' }], error: null })
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
    const response = await request(app).post('/api/mailbox/messages/33333333-3333-4333-8333-333333333333/junk').send({})
    expect(response.status).toBe(404)
    expect(mockInsert).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('POST /messages/:id/untrash restores the provider message and clears local trash metadata', async () => {
    const app = await createApp()

    mockOrder
      .mockResolvedValueOnce({
        data: [
          {
            id: 'acc-1',
            user_id: '550e8400-e29b-41d4-a716-446655440000',
            provider: 'gmail',
            address: 'mail@example.com',
            display_name: 'Main',
            identity_group: 'personal',
            status: 'connected',
            connected_at: new Date().toISOString(),
            last_synced_at: null,
            sync_error: null,
          },
        ],
        error: null,
      })
      .mockReturnThis()

    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: '33333333-3333-4333-8333-333333333333',
        account_id: 'acc-1',
        provider_message_id: 'gmail-msg-123',
        provider_metadata: {
          provider_trashed: true,
          provider_message: { id: 'gmail-msg-123', labelIds: ['INBOX', 'TRASH', 'UNREAD'] },
        },
      },
      error: null,
    })

    mockGetMailboxCredential.mockResolvedValueOnce({
      accessToken: 'access-token',
      refreshToken: null,
      expiresAt: null,
      scope: null,
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
    })

    const res = await request(app)
      .post('/api/mailbox/messages/33333333-3333-4333-8333-333333333333/untrash')

    expect(res.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/gmail-msg-123/untrash',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(mockFetch).toHaveBeenCalledWith(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/gmail-msg-123/modify',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ addLabelIds: ['INBOX'] }),
      }),
    )
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        provider_metadata: {
          provider_trashed: false,
          provider_message: { id: 'gmail-msg-123', labelIds: ['INBOX', 'UNREAD'] },
        },
        updated_at: expect.any(String),
      }),
    )
  })

  it('POST /messages/:id/not-junk removes Gmail spam and restores the message to inbox', async () => {
    const app = await createApp()

    mockOrder
      .mockResolvedValueOnce({
        data: [
          {
            id: 'acc-1',
            user_id: '550e8400-e29b-41d4-a716-446655440000',
            provider: 'gmail',
            address: 'mail@example.com',
            display_name: 'Main',
            identity_group: 'personal',
            status: 'connected',
            connected_at: new Date().toISOString(),
            last_synced_at: null,
            sync_error: null,
          },
        ],
        error: null,
      })
      .mockReturnThis()

    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: '33333333-3333-4333-8333-333333333333',
        account_id: 'acc-1',
        provider_message_id: 'gmail-msg-123',
        provider_metadata: {
          provider_junk: true,
          provider_message: { id: 'gmail-msg-123', labelIds: ['SPAM', 'UNREAD'] },
        },
      },
      error: null,
    })

    mockGetMailboxCredential.mockResolvedValueOnce({
      accessToken: 'access-token',
      refreshToken: null,
      expiresAt: null,
      scope: null,
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
    })

    const res = await request(app)
      .post('/api/mailbox/messages/33333333-3333-4333-8333-333333333333/not-junk')

    expect(res.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/gmail-msg-123/modify',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ removeLabelIds: ['SPAM'], addLabelIds: ['INBOX'] }),
      }),
    )
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        provider_metadata: {
          provider_junk: false,
          provider_message: { id: 'gmail-msg-123', labelIds: ['UNREAD', 'INBOX'] },
        },
        updated_at: expect.any(String),
      }),
    )
  })

  describe('POST /accounts/:id/reset-cursor', () => {
    const ACCOUNT_ID = '44444444-4444-4444-8444-444444444444'

    function ownedAccount(syncOptions: Record<string, unknown> | null) {
      return {
        id: ACCOUNT_ID,
        user_id: '550e8400-e29b-41d4-a716-446655440000',
        provider: 'gmail',
        address: 'user@example.com',
        status: 'connected',
        sync_options: syncOptions,
      }
    }

    it('reports the account saved daysBack window', async () => {
      const app = await createApp()
      mockMaybeSingle.mockResolvedValueOnce({ data: ownedAccount({ daysBack: 30 }), error: null })

      const res = await request(app).post(`/api/mailbox/accounts/${ACCOUNT_ID}/reset-cursor`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.days_back).toBe(30)
      expect(res.body.message).toBe('Sync cursor reset. The next sync will re-fetch emails from the past 30 days.')
      expect(res.body.message).not.toContain('7 days')
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ cursor: null }))
      expect(mockFrom).toHaveBeenCalledWith('mail_audit_events')
    })

    it('falls back to the default daysBack when none is saved', async () => {
      const app = await createApp()
      mockMaybeSingle.mockResolvedValueOnce({ data: ownedAccount(null), error: null })

      const res = await request(app).post(`/api/mailbox/accounts/${ACCOUNT_ID}/reset-cursor`)

      expect(res.status).toBe(200)
      expect(res.body.days_back).toBe(1)
      expect(res.body.message).toBe('Sync cursor reset. The next sync will re-fetch emails from the past 1 day.')
    })

    it('returns 400 for an invalid id and 404 for an account the user does not own', async () => {
      const app = await createApp()
      const bad = await request(app).post('/api/mailbox/accounts/not-a-uuid/reset-cursor')
      expect(bad.status).toBe(400)

      mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
      const missing = await request(app).post(`/api/mailbox/accounts/${ACCOUNT_ID}/reset-cursor`)
      expect(missing.status).toBe(404)
      expect(mockUpdate).not.toHaveBeenCalled()
    })
  })
})
