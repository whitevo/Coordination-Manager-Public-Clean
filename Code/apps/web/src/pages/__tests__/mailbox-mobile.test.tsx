import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import MailboxPage from '../MailboxPage'
import { MOBILE_NAVIGATION_PANEL_DISMISS_EVENT } from '../../hooks/use-mobile-navigation-panel-dismiss'
import {
  MAILBOX_DEFAULT_FILTER_ID,
  MAILBOX_FILTERS_STATE_KEY_PREFIX,
  MAILBOX_PRIMARY_FILTER_KEY_PREFIX,
  buildCustomMailboxFilter,
  buildDefaultMailboxFilterState,
  parseMailboxFilterState,
} from '../mailbox-filters'
import { MAILBOX_REMOTE_NEW_MAIL_EVENT } from '../mailbox-notifications'

const mocks = vi.hoisted(() => ({
  get: vi.fn<(url: string, config?: { params?: Record<string, unknown> }) => Promise<{ data: unknown }>>(),
  getSessionCacheValue: vi.fn<(key: string) => unknown>(),
  post: vi.fn().mockResolvedValue({ data: { success: true, new_message_count: 0 } }),
  patch: vi.fn().mockResolvedValue({ data: {} }),
  put: vi.fn().mockResolvedValue({ data: {} }),
  setPageContext: vi.fn(),
  setAssistantHost: vi.fn(),
}))

vi.mock('../../lib/api-client', () => ({
  apiClient: { get: mocks.get, post: mocks.post, patch: mocks.patch, put: mocks.put },
  dedupedGet: (url: string, config?: { params?: Record<string, unknown> }) => mocks.get(url, config),
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'mobile-user', email: 'mobile@example.com' } }),
}))
vi.mock('../../contexts/AiAssistantContext', () => ({
  useAiAssistant: () => ({
    setPageContext: mocks.setPageContext,
    setAssistantHost: mocks.setAssistantHost,
  }),
}))
vi.mock('../../contexts/LayoutContext', () => ({
  LeftPanelPortal: () => null,
  RightPanelPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('../../lib/session-data-cache', () => ({
  getSessionCacheValue: mocks.getSessionCacheValue,
  isSessionCacheFresh: () => false,
  setSessionCacheValue: vi.fn(),
}))

const account = {
  id: 'mobile-account',
  provider: 'gmail',
  address: 'mobile@example.com',
  display_name: 'Mobile account',
  identity_group: 'personal',
  status: 'connected',
  connected_at: '2026-10-04T12:00:00Z',
  last_synced_at: '2026-10-04T12:00:00Z',
  sync_error: null,
}
const message = {
  id: 'mobile-message',
  account_id: account.id,
  account,
  thread_id: 'mobile-thread',
  subject: 'Mobile navigation fixture',
  from_name: 'Fixture',
  from_email: 'fixture@example.com',
  to_emails: account.address,
  received_at: '2026-10-04T12:00:00Z',
  preview: 'Navigation test',
  body_text: 'Email reader content',
  is_read: true,
  is_archived: false,
  is_provider_trashed: false,
  is_provider_junk: false,
  is_provider_sent: false,
  has_attachments: false,
  user_tag_ids: [],
}
const threadResponse = {
  data: { thread: { id: 'mobile-thread', account_id: account.id }, messages: [message] },
}
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollIntoView'
)
let mockInboxHeaderWidth = 343

async function renderMailbox() {
  render(
    <MemoryRouter
      initialEntries={['/mailbox?tab=mailbox']}
    >
      <MailboxPage />
    </MemoryRouter>
  )
  await screen.findAllByTestId('mailbox-message-row')
}

describe('Mailbox request reliability', () => {
  it('does not send delayed prefetch requests after leaving the mailbox', async () => {
    localStorage.setItem('mailbox:last-new-mail-check:v1:mobile-user', String(Date.now()))
    const defaultGet = mocks.get.getMockImplementation()!
    mocks.get.mockImplementation(async (url) => url === '/api/mailbox/messages'
      ? { data: {
          messages: Array.from({ length: 30 }, (_, index) => ({ ...message, id: `leaving-${index}`, thread_id: null })),
          total: 500,
        } }
      : defaultGet(url))
    await renderMailbox()
    cleanup()
    mocks.get.mockClear()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)) })
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('resumes a populated cached inbox in full batches rather than one-row requests', async () => {
    localStorage.setItem('mailbox:last-new-mail-check:v1:mobile-user', String(Date.now()))
    localStorage.setItem('mailbox:filters:v5:mobile-user', JSON.stringify({
      ...buildDefaultMailboxFilterState([]), activeFilterId: 'preset-hide-trashed',
    }))
    const cached = Array.from({ length: 90 }, (_, index) => ({
      ...message, id: `cached-${index}`, is_provider_trashed: true,
    }))
    mocks.getSessionCacheValue.mockImplementation(key => key === 'mailbox:messages:mobile-user' ? cached : undefined)
    const defaultGet = mocks.get.getMockImplementation()!
    mocks.get.mockImplementation(async (url, config) => {
      if (url === '/api/mailbox/messages') {
        return { data: { messages: config?.params?.offset ? [] : [message], total: 200 } }
      }
      return defaultGet(url)
    })
    await renderMailbox()
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/api/mailbox/messages', expect.objectContaining({
      params: expect.objectContaining({ offset: 91, limit: 15 }),
    })))
    expect(mocks.get.mock.calls.some(([url, config]) => url === '/api/mailbox/messages' && config?.params?.limit === 1)).toBe(false)
  })

  it('limits speculative prefetch to one batch even when later messages do not match', async () => {
    localStorage.setItem('mailbox:last-new-mail-check:v1:mobile-user', String(Date.now()))
    localStorage.setItem('mailbox:filters:v5:mobile-user', JSON.stringify({
      ...buildDefaultMailboxFilterState([]), activeFilterId: 'preset-hide-trashed',
    }))
    const defaultGet = mocks.get.getMockImplementation()!
    mocks.get.mockImplementation(async (url, config) => {
      if (url === '/api/mailbox/messages') {
        const offset = Number(config?.params?.offset || 0)
        return { data: {
          messages: Array.from({ length: Number(config?.params?.limit || 30) }, (_, index) => ({
            ...message, id: `prefetch-${offset + index}`, thread_id: null,
            is_provider_trashed: offset > 0,
          })),
          total: 500,
        } }
      }
      return defaultGet(url)
    })
    await renderMailbox()
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/api/mailbox/messages', expect.objectContaining({
      params: expect.objectContaining({ offset: 30, limit: 15 }),
    })))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)) })
    const scans = mocks.get.mock.calls.filter(([url, config]) => url === '/api/mailbox/messages' && config?.params?.offset !== undefined)
    expect(scans).toHaveLength(1)
  })

  it('opens the inbox without reparsing invitation bodies or repeating the People search', async () => {
    localStorage.setItem('mailbox:last-new-mail-check:v1:mobile-user', String(Date.now()))
    await renderMailbox()
    await screen.findByRole('button', { name: 'Quick Sync' })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)) })
    expect(mocks.post.mock.calls.some(([url]) => url === '/api/mailbox/invitations/extract')).toBe(false)
    expect(mocks.get.mock.calls.filter(([url]) => url === '/api/mailbox/people')).toHaveLength(1)
    expect(mocks.get.mock.calls.filter(([url]) => url === '/api/mailbox/invitations')).toHaveLength(1)
  })

  it('reports the failing account and reason while refreshing successful Quick Sync results', async () => {
    localStorage.setItem('mailbox:last-new-mail-check:v1:mobile-user', String(Date.now()))
    const defaultGet = mocks.get.getMockImplementation()!
    mocks.get.mockImplementation(async (url) => url === '/api/mailbox/accounts'
      ? { data: { accounts: [account, { ...account, id: 'other-account', address: 'other@example.com' }] } }
      : defaultGet(url))
    let resolveSync!: (response: { data: { success: boolean; new_message_count: number } }) => void
    mocks.post.mockImplementation(async (url: string) => {
      if (url === `/api/mailbox/accounts/${account.id}/sync`) {
        return new Promise(resolve => { resolveSync = resolve })
      }
      if (url === '/api/mailbox/accounts/other-account/sync') {
        return { data: { success: false, error: 'Access expired. Reconnect this account.' } }
      }
      return { data: {} }
    })
    await renderMailbox()
    const initialReads = mocks.get.mock.calls.filter(([url]) => url === '/api/mailbox/messages').length
    const sync = screen.getByRole('button', { name: 'Quick Sync' })
    fireEvent.click(sync)
    fireEvent.click(sync)
    await waitFor(() => expect(resolveSync).toBeDefined())
    expect(mocks.post.mock.calls.filter(([url]) => url === `/api/mailbox/accounts/${account.id}/sync`)).toHaveLength(1)
    await act(async () => { resolveSync({ data: { success: true, new_message_count: 1 } }) })
    await screen.findByText(/Quick Sync completed for 1 of 2 accounts/)
    expect(screen.getByText(/other@example.com: Access expired/)).toBeInTheDocument()
    expect(mocks.get.mock.calls.filter(([url]) => url === '/api/mailbox/messages').length).toBeGreaterThan(initialReads)
  })
})

describe('Mailbox thread calendar actions', () => {
  it('lets the thread calendar action choose which source email invitation to add', async () => {
    const earlier = { ...message, id: 'earlier-message', subject: 'Earlier meeting' }
    const latest = { ...message, id: 'latest-message', subject: 'Latest meeting' }
    const invitations = [
      {
        id: 'earlier-invitation',
        message_id: earlier.id,
        summary: 'Earlier meeting details',
        location: 'Earlier room',
        organizer: 'Earlier organizer',
        starts_at: '2026-11-01T10:00:00.000Z',
        ends_at: '2026-11-01T11:00:00.000Z',
        status: 'proposed',
        uid: 'earlier-uid',
      },
      {
        id: 'latest-invitation',
        message_id: latest.id,
        summary: 'Latest meeting details',
        location: 'Latest room',
        organizer: 'Latest organizer',
        starts_at: '2026-11-02T10:00:00.000Z',
        ends_at: '2026-11-02T11:00:00.000Z',
        status: 'proposed',
        uid: 'latest-uid',
      },
    ]
    const defaultGet = mocks.get.getMockImplementation()!
    mocks.get.mockImplementation(async (url) => {
      if (url === '/api/mailbox/messages/mobile-message/thread') {
        return { data: { ...threadResponse.data, messages: [earlier, latest] } }
      }
      if (url === '/api/mailbox/invitations') return { data: { invitations } }
      return defaultGet(url)
    })

    await renderMailbox()
    fireEvent.click(screen.getByTestId('mailbox-message-row'))
    const headers = await screen.findAllByTestId('mailbox-thread-message-header')
    fireEvent.click(headers[0])
    expect(within(headers[0]).getByText('Selected message')).toBeInTheDocument()
    expect(within(headers[1]).queryByText('Selected message')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('mailbox-thread-add-to-calendar'))

    fireEvent.click(screen.getByRole('button', { name: /Earlier meeting details/ }))
    fireEvent.click(screen.getByRole('button', { name: /Earlier meeting details/ }))
    expect(screen.getByLabelText('Title')).toHaveValue('Earlier meeting details')
    expect(screen.queryByDisplayValue('Latest meeting details')).not.toBeInTheDocument()
    expect(within(headers[0]).getByText('Selected message')).toBeInTheDocument()
    expect(within(headers[1]).queryByText('Selected message')).not.toBeInTheDocument()
  })

  it('uses only the source email invitation from its message header action', async () => {
    const earlier = { ...message, id: 'earlier-message', subject: 'Earlier meeting' }
    const latest = { ...message, id: 'latest-message', subject: 'Latest meeting' }
    const invitations = [
      {
        id: 'earlier-invitation',
        message_id: earlier.id,
        summary: 'Earlier meeting details',
        location: 'Earlier room',
        organizer: 'Earlier organizer',
        starts_at: '2026-11-01T10:00:00.000Z',
        ends_at: '2026-11-01T11:00:00.000Z',
        status: 'proposed',
        uid: 'earlier-uid',
      },
      {
        id: 'latest-invitation',
        message_id: latest.id,
        summary: 'Latest meeting details',
        location: 'Latest room',
        organizer: 'Latest organizer',
        starts_at: '2026-11-02T10:00:00.000Z',
        ends_at: '2026-11-02T11:00:00.000Z',
        status: 'proposed',
        uid: 'latest-uid',
      },
    ]
    const defaultGet = mocks.get.getMockImplementation()!
    mocks.get.mockImplementation(async (url) => {
      if (url === '/api/mailbox/messages/mobile-message/thread') {
        return { data: { ...threadResponse.data, messages: [earlier, latest] } }
      }
      if (url === '/api/mailbox/invitations') return { data: { invitations } }
      return defaultGet(url)
    })

    await renderMailbox()
    fireEvent.click(screen.getByTestId('mailbox-message-row'))
    const headers = await screen.findAllByTestId('mailbox-thread-message-header')
    fireEvent.click(within(headers[0]).getByTestId('mailbox-thread-message-add-to-calendar'))

    fireEvent.click(screen.getByRole('button', { name: /Earlier meeting details/ }))
    expect(screen.getByLabelText('Title')).toHaveValue('Earlier meeting details')
    expect(screen.queryByRole('dialog', { name: 'Choose an invitation' })).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('Latest meeting details')).not.toBeInTheDocument()
  })

  it('opens the thread calendar panel directly when there is one invitation', async () => {
    const invitation = {
      id: 'single-invitation',
      message_id: message.id,
      summary: 'Single meeting',
      location: 'Meeting room',
      organizer: 'Organizer',
      starts_at: '2026-11-01T10:00:00.000Z',
      ends_at: '2026-11-01T11:00:00.000Z',
      status: 'proposed',
      uid: 'single-uid',
    }
    const defaultGet = mocks.get.getMockImplementation()!
    mocks.get.mockImplementation(async (url) => url === '/api/mailbox/invitations'
      ? { data: { invitations: [invitation] } }
      : defaultGet(url))

    await renderMailbox()
    fireEvent.click(screen.getByTestId('mailbox-message-row'))
    fireEvent.click(await screen.findByTestId('mailbox-thread-add-to-calendar'))

    fireEvent.click(screen.getByRole('button', { name: /Single meeting/ }))
    expect(screen.getByLabelText('Title')).toHaveValue('Single meeting')
    expect(screen.queryByRole('dialog', { name: 'Choose an invitation' })).not.toBeInTheDocument()
  })

  it('shows separate confirmed and failed destination banners and retries only the failed target', async () => {
    const invitation = {
      id: '20000000-0000-4000-8000-000000000001',
      message_id: message.id,
      summary: 'Retryable meeting',
      location: 'Meeting room',
      organizer: 'Organizer',
      starts_at: '2026-11-01T10:00:00.000Z',
      ends_at: '2026-11-01T11:00:00.000Z',
      status: 'proposed',
      uid: 'retryable-uid',
    }
    const defaultGet = mocks.get.getMockImplementation()!
    mocks.get.mockImplementation(async (url) => {
      if (url === '/api/mailbox/invitations') return { data: { invitations: [invitation] } }
      if (url === '/api/calendar-sources') {
        return {
          data: {
            sources: [
              { id: 'google-work', display_name: 'Work', source_type: 'google_oauth', is_active: true },
              { id: 'google-personal', display_name: 'Personal', source_type: 'google_oauth', is_active: true },
            ],
          },
        }
      }
      if (url === '/api/calendars') return { data: { calendars: [] } }
      if (url === '/api/time-management/modes') return { data: { modes: [] } }
      if (url === '/api/time-management/categories') return { data: { categories: [] } }
      return defaultGet(url)
    })

    let personalAttempts = 0
    mocks.post.mockImplementation(async (url: string, payload: unknown) => {
      if (url === '/api/calendar-sources/add-event') {
        const request = payload as { targetSourceIds: string[]; idempotencyKey: string }
        const sourceId = request.targetSourceIds[0]
        if (sourceId === 'google-personal' && personalAttempts++ === 0) {
          return {
            data: {
              results: [
                {
                  sourceId,
                  success: false,
                  error: 'Calendar is temporarily unavailable',
                  retryable: true,
                },
              ],
            },
          }
        }
        return { data: { results: [{ sourceId, success: true }] } }
      }
      return { data: {} }
    })

    await renderMailbox()
    await waitFor(() =>
      expect(mocks.get.mock.calls.some(([url]) => url === '/api/mailbox/invitations')).toBe(true)
    )
    fireEvent.click(screen.getByTestId('mailbox-message-row'))
    await screen.findByTestId('mailbox-thread-add-to-calendar')
    fireEvent.click(screen.getByTestId('mailbox-thread-add-to-calendar'))
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/api/calendar-sources'))
    await screen.findByLabelText('Work')
    await screen.findByLabelText('Personal')
    fireEvent.click(screen.getByLabelText('Work'))
    fireEvent.click(screen.getByLabelText('Personal'))
    vi.useFakeTimers()

    await act(async () => {
      fireEvent.click(screen.getByTestId('mailbox-invitation-add-to-calendar-submit'))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.post.mock.calls.filter(([url]) => url === '/api/calendar-sources/add-event')).toHaveLength(2)
    expect(screen.getByTestId('mailbox-calendar-delivery-success')).toHaveTextContent(
      'Google Calendar (Work)'
    )
    expect(screen.getByTestId('mailbox-calendar-delivery-failure')).toHaveTextContent(
      'Google Calendar (Personal)'
    )
    expect(mocks.patch.mock.calls.filter(([url]) => url === '/api/mailbox/invitations/20000000-0000-4000-8000-000000000001/status')).toHaveLength(0)

    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    expect(screen.queryByTestId('mailbox-calendar-delivery-success')).toBeNull()
    expect(screen.getByTestId('mailbox-calendar-delivery-failure')).toBeInTheDocument()
    expect(mocks.post.mock.calls.filter(([url]) => url === '/api/calendar-sources/add-event')).toHaveLength(2)

    await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByTestId('mailbox-calendar-delivery-success')).toHaveTextContent(
      'Added "Retryable meeting" to all selected destinations'
    )
    expect(screen.queryByTestId('mailbox-calendar-delivery-failure')).toBeNull()
    expect(mocks.post.mock.calls.filter(([url]) => url === '/api/calendar-sources/add-event')).toHaveLength(3)

    const personalRequests = mocks.post.mock.calls
      .filter(([url, payload]) =>
        url === '/api/calendar-sources/add-event' &&
        (payload as { targetSourceIds: string[] }).targetSourceIds[0] === 'google-personal'
      )
    expect((personalRequests[0][1] as { idempotencyKey: string }).idempotencyKey).toBe(
      (personalRequests[1][1] as { idempotencyKey: string }).idempotencyKey
    )
    expect(mocks.patch).toHaveBeenCalledWith(
      '/api/mailbox/invitations/20000000-0000-4000-8000-000000000001/status',
      expect.objectContaining({ status: 'imported' })
    )
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    expect(screen.queryByTestId('mailbox-calendar-delivery-success')).toBeNull()
  })
})

describe('Mailbox per-message thread actions', () => {
  it('builds Reply and Forward drafts from the message whose header action was clicked', async () => {
    const earlier = {
      ...message,
      id: 'earlier-action-message',
      subject: 'Earlier invitation',
      from_email: 'earlier-sender@example.com',
      reply_to: 'earlier-reply@example.com',
      body_text: 'Earlier email body',
    }
    const latest = {
      ...message,
      id: 'latest-action-message',
      subject: 'Latest invitation',
      from_email: 'latest-sender@example.com',
      reply_to: 'latest-reply@example.com',
      body_text: 'Latest email body',
    }
    const defaultGet = mocks.get.getMockImplementation()!
    mocks.get.mockImplementation(async (url) => url === '/api/mailbox/messages/mobile-message/thread'
      ? { data: { ...threadResponse.data, messages: [earlier, latest] } }
      : defaultGet(url))

    await renderMailbox()
    fireEvent.click(screen.getByTestId('mailbox-message-row'))
    const headers = await screen.findAllByTestId('mailbox-thread-message-header')
    fireEvent.click(within(headers[0]).getByTestId('mailbox-thread-message-reply'))

    expect(screen.getByLabelText('Subject')).toHaveValue('Re: Earlier invitation')
    expect(screen.getByRole('textbox', { name: 'To recipient 1' })).toHaveValue('earlier-reply@example.com')
    expect(within(headers[0]).getByText('Selected message')).toBeInTheDocument()
    expect(within(headers[1]).queryByText('Selected message')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close Draft' }))
    fireEvent.click(within(headers[1]).getByTestId('mailbox-thread-message-forward'))

    expect(screen.getByLabelText('Subject')).toHaveValue('Fwd: Latest invitation')
    const forwardedBody = screen.getByRole('textbox', { name: 'Message body' }) as HTMLTextAreaElement
    expect(forwardedBody.value).toContain('Latest email body')
    expect(forwardedBody.value).not.toContain('Earlier email body')
    expect(within(headers[1]).getByText('Selected message')).toBeInTheDocument()
    expect(within(headers[0]).queryByText('Selected message')).not.toBeInTheDocument()
  })
})

function selectSection(name: string) {
  fireEvent.click(
    within(screen.getByTestId('mailbox-mobile-navigation')).getByRole('button', { name })
  )
}

function mockThreadScrollGeometry(messageIds: string[]) {
  const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.testid === 'mailbox-thread-scroll') return new DOMRect(0, 100, 300, 200)
    if (this.dataset.testid === 'mailbox-thread-message-header') {
      const index = messageIds.indexOf(this.dataset.messageId ?? '')
      const reader = this.closest<HTMLElement>('[data-testid="mailbox-thread-scroll"]')
      return new DOMRect(0, 100 + index * 120 - (reader?.scrollTop ?? 0), 300, 40)
    }
    return originalGetBoundingClientRect.call(this)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSessionCacheValue.mockReset()
  mocks.post.mockReset().mockResolvedValue({ data: { success: true, new_message_count: 0 } })
  mocks.patch.mockReset().mockResolvedValue({ data: {} })
  localStorage.clear()
  sessionStorage.clear()
  mockInboxHeaderWidth = 343
  vi.stubGlobal('innerWidth', 375)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}

      observe(target: Element) {
        this.callback(
          [
            {
              contentRect: { width: mockInboxHeaderWidth } as DOMRectReadOnly,
              target,
            } as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver
        )
      }

      disconnect() {}

      unobserve() {}
    }
  )
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  )
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
  mocks.get.mockImplementation(async (url) => {
    if (url === '/api/mailbox/accounts') return { data: { accounts: [account] } }
    if (url === '/api/mailbox/messages') return { data: { messages: [message], total: 1 } }
    if (url === '/api/mailbox/messages/mobile-message/thread') return threadResponse
    if (url === '/api/mailbox/preferences/tags') return { data: { tags: [] } }
    if (url === '/api/mailbox/people') return { data: { people: [] } }
    if (url === '/api/mailbox/invitations') return { data: { invitations: [] } }
    if (url === '/api/mailbox/rules') return { data: { rules: [] } }
    if (url === '/api/mailbox/drafts') return { data: { drafts: [] } }
    return { data: {} }
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (originalScrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView)
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  }
})

describe('Mailbox filter recovery', () => {
  it('shows addressed emails without changing the primary filter', async () => {
    const filterState = buildDefaultMailboxFilterState([])
    filterState.activeFilterId = 'preset-hide-read'
    filterState.filters.push(buildCustomMailboxFilter('Custom view', []))
    const filterStateKey = `${MAILBOX_FILTERS_STATE_KEY_PREFIX}mobile-user`
    const primaryFilterKey = `${MAILBOX_PRIMARY_FILTER_KEY_PREFIX}mobile-user`
    localStorage.setItem(filterStateKey, JSON.stringify(filterState))
    localStorage.setItem(primaryFilterKey, 'preset-hide-read')

    render(
      <MemoryRouter
        initialEntries={['/mailbox?tab=mailbox']}
      >
        <MailboxPage />
      </MemoryRouter>
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Show addressed emails' }))

    await waitFor(() => {
      const savedFilterState = parseMailboxFilterState(localStorage.getItem(filterStateKey), [])
      expect(savedFilterState.activeFilterId).toBe(MAILBOX_DEFAULT_FILTER_ID)
      expect(savedFilterState.filters).toEqual(filterState.filters)
    })
    expect(localStorage.getItem(primaryFilterKey)).toBe('preset-hide-read')
  })

  it.each(['renamed', 'deleted'] as const)(
    'restores a default Show All filter when it was %s',
    async (change) => {
      const filterState = buildDefaultMailboxFilterState([])
      filterState.activeFilterId = 'preset-hide-read'
      if (change === 'renamed') {
        filterState.filters[0] = { ...filterState.filters[0], name: 'Everything' }
      } else {
        filterState.filters = filterState.filters.filter(
          (filter) => filter.id !== MAILBOX_DEFAULT_FILTER_ID
        )
      }
      const filterStateKey = `${MAILBOX_FILTERS_STATE_KEY_PREFIX}mobile-user`
      const primaryFilterKey = `${MAILBOX_PRIMARY_FILTER_KEY_PREFIX}mobile-user`
      localStorage.setItem(filterStateKey, JSON.stringify(filterState))
      localStorage.setItem(primaryFilterKey, 'preset-hide-read')

      render(
        <MemoryRouter
          initialEntries={['/mailbox?tab=mailbox']}
        >
          <MailboxPage />
        </MemoryRouter>
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Show addressed emails' }))

      await waitFor(() => {
        const savedFilterState = parseMailboxFilterState(localStorage.getItem(filterStateKey), [])
        const showAllFilter = savedFilterState.filters.find(
          (filter) => filter.id === MAILBOX_DEFAULT_FILTER_ID
        )
        expect(showAllFilter?.name).toBe('Show All')
        expect(showAllFilter?.sort).toEqual(buildDefaultMailboxFilterState([]).filters[0].sort)
        expect(savedFilterState.activeFilterId).toBe(MAILBOX_DEFAULT_FILTER_ID)
      })
      expect(localStorage.getItem(primaryFilterKey)).toBe('preset-hide-read')
    }
  )
})

describe('Mailbox mobile reader navigation', () => {
  it('rates the original AI reply after editing the draft and resets feedback for the next suggestion', async () => {
    let generation = 0
    mocks.post.mockImplementation(async (url: string) => {
      if (url.endsWith('/draft-suggestion')) return { data: { subject: 'AI subject', body_text: `Original suggestion ${++generation}` } }
      return { data: { success: true } }
    })
    await renderMailbox()
    fireEvent.click(screen.getByTestId('mailbox-message-row'))
    fireEvent.click(await screen.findByRole('button', { name: 'Reply' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'AI reply instruction' }), { target: { value: 'Make a friendly reply' } })
    fireEvent.click(screen.getByRole('button', { name: 'AI: Suggest reply' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message body' })).toHaveValue('Original suggestion 1'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Message body' }), { target: { value: 'My private edits' } })
    fireEvent.click(screen.getByRole('button', { name: 'Hide details' }))
    fireEvent.click(screen.getByRole('button', { name: 'Give feedback on AI reply' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'AI reply feedback comment' }), { target: { value: 'Helpful' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit feedback' }))
    await screen.findByRole('button', { name: 'Feedback submitted' })
    expect(mocks.post).toHaveBeenCalledWith('/api/ai-feedback', expect.objectContaining({
      user_prompt: 'Mailbox AI: Suggest reply\nMake a friendly reply',
      ai_answer: 'Subject: AI subject\n\nOriginal suggestion 1', feedback_text: 'Helpful',
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    fireEvent.click(screen.getByRole('button', { name: 'AI: Suggest reply' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message body' })).toHaveValue('Original suggestion 2'))
    expect(screen.getByRole('button', { name: 'Give feedback on AI reply' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Feedback submitted' })).not.toBeInTheDocument()
  })

  it('ignores a late AI suggestion after opening another draft', async () => {
    let finish!: (response: { data: { subject: string; body_text: string } }) => void
    mocks.post.mockImplementation(async (url: string) => url.endsWith('/draft-suggestion')
      ? new Promise(resolve => { finish = resolve })
      : { data: { success: true } })
    await renderMailbox()
    fireEvent.click(screen.getByTestId('mailbox-message-row'))
    fireEvent.click(await screen.findByRole('button', { name: 'Reply' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'AI reply instruction' }), { target: { value: 'Please reply' } })
    fireEvent.click(screen.getByRole('button', { name: 'AI: Suggest reply' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close Draft' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Message body' }), { target: { value: 'New draft body' } })
    await act(async () => finish({ data: { subject: 'Old subject', body_text: 'Old suggestion' } }))
    expect(screen.getByRole('textbox', { name: 'Message body' })).toHaveValue('New draft body')
    expect(screen.queryByRole('button', { name: 'Give feedback on AI reply' })).not.toBeInTheDocument()
  })

  it('opens Reply details by default and can edit details in reading mode without losing draft fields', async () => {
    await renderMailbox()
    fireEvent.click(screen.getByTestId('mailbox-message-row'))
    fireEvent.click(await screen.findByRole('button', { name: 'Reply' }))
    const body = screen.getByRole('textbox', { name: 'Message body' })
    fireEvent.change(body, { target: { value: 'Unsent reply body' } })
    expect(screen.getByRole('combobox', { name: 'From' })).toBeVisible()
    fireEvent.change(screen.getByRole('textbox', { name: 'To recipient 1' }), { target: { value: 'recipient@example.com' } })
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Edited subject' } })
    fireEvent.click(screen.getByRole('button', { name: 'Hide details' }))
    fireEvent.click(screen.getByRole('button', { name: 'Read emails' }))
    expect(document.getElementById('mailbox-draft-content')).toHaveAttribute('inert')
    expect(screen.queryByRole('textbox', { name: 'Message body' })).not.toBeInTheDocument()
    expect(screen.getByText('Email reader content')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    expect(screen.getByRole('button', { name: 'Back to draft' })).toBeVisible()
    expect(screen.queryByRole('textbox', { name: 'Message body' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'To recipient 1' })).toHaveValue('recipient@example.com')
    expect(screen.getByLabelText('Subject')).toHaveValue('Edited subject')
    fireEvent.click(screen.getByRole('button', { name: 'Back to draft' }))
    expect(body).toHaveValue('Unsent reply body')
    expect(mocks.post.mock.calls.some(([url]) => String(url).endsWith('/send'))).toBe(false)
  })

  it('starts new messages expanded, keeps forwards compact, and expands missing recipients on Send', async () => {
    await renderMailbox()
    fireEvent.click(screen.getByRole('button', { name: 'Compose a new email' }))
    expect(screen.getByRole('combobox', { name: 'From' })).toBeVisible()
    expect(screen.getByLabelText('Subject')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Hide details' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByRole('textbox', { name: 'To recipient 1' })).toBeVisible()
    expect(screen.getByText('Add at least one To recipient before sending')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close Draft' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back to Inbox' }))
    fireEvent.click(screen.getByTestId('mailbox-message-row'))
    fireEvent.click(await screen.findByRole('button', { name: 'Forward' }))
    expect(screen.getByRole('button', { name: 'Details' })).toHaveAttribute('aria-expanded', 'false')
    expect((screen.getByRole('textbox', { name: 'Message body' }) as HTMLTextAreaElement).value).toContain('Email reader content')
  })

  it('toggles one fixed control only with a hover-capable mouse and retains mode after pointer exit', async () => {
    await renderMailbox()
    fireEvent.click(screen.getByTestId('mailbox-message-row'))
    fireEvent.click(await screen.findByRole('button', { name: 'Reply' }))
    const read = screen.getByRole('button', { name: 'Read emails' })
    // PointerEvent is not provided by jsdom, so supply its pointerType explicitly.
    const enter = (pointerType: string, target: HTMLElement = read) => {
      const event = new Event('pointerover', { bubbles: true })
      Object.defineProperty(event, 'pointerType', { value: pointerType })
      fireEvent(target, event)
    }
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList)
    enter('touch')
    expect(read).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('button', { name: 'Back to draft' })).not.toBeInTheDocument()
    enter('mouse')
    expect(screen.getByRole('button', { name: 'Back to draft' })).toBeVisible()
    expect(read).toHaveAttribute('aria-pressed', 'true')
    fireEvent.pointerLeave(read.closest('article')!)
    expect(read).toHaveAttribute('aria-pressed', 'true')
    const back = screen.getByRole('button', { name: 'Back to draft' })
    expect(back).toBe(read)
    enter('touch', back)
    expect(read).toHaveAttribute('aria-pressed', 'true')
    enter('mouse', back)
    expect(read).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('textbox', { name: 'Message body' })).toBeVisible()
  })

  it('counts Receive Action as a check in the saved rule card and editor', async () => {
    const defaultGet = mocks.get.getMockImplementation()!
    const definition = {
      name: 'Junk is trash', mode: 'active', stopProcessing: false, match: 'all',
      steps: [
        { id: 'receive', kind: 'receive_action', position: 0, enabled: true, action: 'junk', value: '', allowRecursion: false },
        { id: 'trash', kind: 'action', position: 1, enabled: true, action: 'trash', value: '' },
      ],
    }
    mocks.get.mockImplementation(async (url, config) => url === '/api/mailbox/rules'
      ? { data: { rules: [{ id: 'junk-rule', name: definition.name, mode: 'active', definition }] } }
      : defaultGet(url, config))
    render(
      <MemoryRouter initialEntries={['/mailbox?tab=settings&settings=automations']}>
        <MailboxPage />
      </MemoryRouter>,
    )
    await screen.findByText('1 check, 1 action')
    fireEvent.click(screen.getByRole('button', { name: 'Open in editor' }))
    await screen.findByText('Check: Receive action')
    expect(screen.getByText('Manual Junk or provider-imported/synced Junk')).toBeInTheDocument()
  })

  it('refreshes manual Junk automation results without closing the reader or replacing a reply draft', async () => {
    const defaultGet = mocks.get.getMockImplementation()!
    let junked = false
    mocks.get.mockImplementation(async (url, config) => {
      if (url === '/api/mailbox/messages/mobile-message/thread' && junked) {
        return { data: { ...threadResponse.data, messages: [{ ...message, is_provider_trashed: true }] } }
      }
      return defaultGet(url, config)
    })
    mocks.post.mockImplementation(async (url: string) => {
      if (url === '/api/mailbox/messages/mobile-message/junk') junked = true
      return { data: { success: true, automation_warnings: [] } }
    })
    await renderMailbox()
    fireEvent.click(screen.getAllByTestId('mailbox-message-row')[0])
    await screen.findByText('Email reader content')
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
    const draft = await screen.findByPlaceholderText('Write your message')
    fireEvent.change(draft, { target: { value: 'Keep this draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Mark sender as junk' }))
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith(
      '/api/mailbox/messages/mobile-message/junk', { message_ids: ['mobile-message'] },
    ))
    await screen.findByRole('button', { name: 'Restore 1 emails from provider trash' })
    expect(draft).toHaveValue('Keep this draft')
    expect(screen.getByRole('heading', { name: 'Thread Viewer' })).toBeVisible()
  })

  it.each(['request', 'cascade'])('shows manual Junk %s failures instead of silently reporting success', async (failure) => {
    mocks.post.mockImplementation(async (url: string) => {
      if (url === '/api/mailbox/messages/mobile-message/junk') {
        if (failure === 'request') throw new Error('Junk request failed')
        return { data: { success: true, automation_warnings: ['Trash provider unavailable'] } }
      }
      return { data: { success: true } }
    })
    await renderMailbox()
    fireEvent.click(screen.getAllByTestId('mailbox-message-row')[0])
    const junkButton = await screen.findByRole('button', { name: 'Mark sender as junk' })
    fireEvent.click(junkButton)
    await screen.findByText(failure === 'request'
      ? 'Junk request failed'
      : 'Junk was saved, but automation did not fully complete: Trash provider unavailable')
    if (failure === 'request') expect(junkButton).toBeEnabled()
  })

  it('does not reopen an older thread or replace a newer draft when Junk automation finishes', async () => {
    const nextMessage = { ...message, id: 'next-message', thread_id: 'next-thread', body_text: 'Next thread content' }
    const defaultGet = mocks.get.getMockImplementation()!
    mocks.get.mockImplementation(async (url, config) => {
      if (url === '/api/mailbox/messages') return { data: { messages: [message, nextMessage], total: 2 } }
      if (url === '/api/mailbox/messages/next-message/thread') {
        return { data: { thread: { ...threadResponse.data.thread, id: 'next-thread' }, messages: [nextMessage] } }
      }
      return defaultGet(url, config)
    })
    let finishJunk!: (value: { data: { success: boolean; automation_warnings: string[] } }) => void
    mocks.post.mockImplementation(async (url: string) => url === '/api/mailbox/messages/mobile-message/junk'
      ? new Promise(resolve => { finishJunk = resolve })
      : { data: { success: true } })
    await renderMailbox()
    fireEvent.click(screen.getAllByTestId('mailbox-message-row')[0])
    fireEvent.click(await screen.findByRole('button', { name: 'Mark sender as junk' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back to Inbox' }))
    fireEvent.click(screen.getAllByTestId('mailbox-message-row')[1])
    await screen.findByText('Next thread content')
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
    fireEvent.change(screen.getByPlaceholderText('Write your message'), { target: { value: 'Newer draft' } })
    await act(async () => {
      finishJunk({ data: { success: true, automation_warnings: ['Old thread warning'] } })
    })
    expect(screen.getByText('Next thread content')).toBeVisible()
    expect(screen.getByPlaceholderText('Write your message')).toHaveValue('Newer draft')
    expect(screen.queryByText(/Old thread warning/)).not.toBeInTheDocument()
  })

  it.each([
    { width: 390, providerId: 'provider-reply' },
    { width: 1280, providerId: 'provider-reply' },
    { width: 390, providerId: null },
  ])('opens a confirmed sent reply and dismisses success after 4 seconds at $width px (provider id: $providerId)', async ({ width, providerId }) => {
    vi.stubGlobal('innerWidth', width)
    const replySource = { ...message, from_email: 'recipient@example.com' }
    const sentAt = new Date().toISOString()
    const imported = {
      ...message, id: 'imported-reply', provider_message_id: providerId,
      from_email: account.address, to_emails: 'recipient@example.com',
      subject: 'Re: Mobile navigation fixture', body_text: 'Confirmed reply body',
      received_at: sentAt, is_provider_sent: true,
    }
    const defaultGet = mocks.get.getMockImplementation()!
    let synced = false
    let resolveSync!: (response: { data: { success: boolean } }) => void
    mocks.get.mockImplementation(async (url) => {
      if (url === '/api/mailbox/messages/mobile-message/thread') {
        return { data: { ...threadResponse.data, messages: synced ? [replySource, imported] : [replySource] } }
      }
      return defaultGet(url)
    })
    mocks.post.mockImplementation(async (url: string, payload: unknown) => {
      if (url === '/api/mailbox/drafts') {
        return { data: { draft: { ...(payload as Record<string, unknown>), id: 'sent-draft' } } }
      }
      if (url === '/api/mailbox/drafts/sent-draft/send') {
        return { data: { draft: { sent_at: sentAt }, provider_message_id: providerId } }
      }
      if (url === `/api/mailbox/accounts/${account.id}/sync`) {
        return new Promise((resolve) => { resolveSync = resolve })
      }
      return { data: {} }
    })
    await renderMailbox()
    fireEvent.click(screen.getByTestId('mailbox-message-row'))
    await screen.findByRole('button', { name: 'Reply' })
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
    fireEvent.change(screen.getByPlaceholderText('Write your message'), { target: { value: 'Confirmed reply body' } })
    vi.useFakeTimers()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })) })
    expect(screen.getByText('Message sent to recipient@example.com')).toBeInTheDocument()
    let headers = screen.getAllByTestId('mailbox-thread-message-header')
    expect(headers).toHaveLength(2)
    expect(headers[1]).toHaveAttribute('data-message-id', 'sent-draft:sent-draft')
    expect(headers[1]).toHaveAttribute('aria-expanded', 'true')
    expect(within(headers[1]).getByText('Selected message')).toBeInTheDocument()
    expect(screen.getByText('Confirmed reply body', { exact: true })).toBeInTheDocument()
    expect(within(headers[1]).getByTestId('mailbox-thread-message-reply')).toBeDisabled()
    expect(within(headers[1]).getByTestId('mailbox-thread-message-forward')).toBeDisabled()
    expect(within(headers[0]).getByTestId('mailbox-thread-message-reply')).toBeEnabled()
    const localReply = headers[1].closest('[data-testid="mailbox-thread-message"]') as HTMLElement
    expect(within(localReply).getByRole('button', { name: 'Apply or remove tags' })).toBeDisabled()
    expect(within(localReply).getByRole('button', { name: 'Log' })).toBeDisabled()
    expect(mocks.get).not.toHaveBeenCalledWith('/api/mailbox/messages/sent-draft:sent-draft/attachments')
    await act(async () => { vi.advanceTimersByTime(3999) })
    expect(screen.getByText('Message sent to recipient@example.com')).toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(screen.queryByText('Message sent to recipient@example.com')).toBeNull()
    await act(async () => {
      synced = true
      resolveSync({ data: { success: true } })
    })
    headers = screen.getAllByTestId('mailbox-thread-message-header')
    expect(headers).toHaveLength(2)
    expect(headers[1]).toHaveAttribute('data-message-id', 'imported-reply')
    expect(within(headers[1]).getByText('Selected message')).toBeInTheDocument()
    expect(screen.getAllByText('Confirmed reply body', { exact: true })).toHaveLength(1)
    expect(within(headers[1]).getByTestId('mailbox-thread-message-reply')).toBeEnabled()
    expect(screen.queryByRole('alert')).toBeNull()
    if (width === 390) {
      synced = false
      fireEvent.click(screen.getByRole('button', { name: 'Back to Inbox' }))
      await act(async () => { fireEvent.click(screen.getByTestId('mailbox-message-row')) })
      const reopenedHeaders = screen.getAllByTestId('mailbox-thread-message-header')
      expect(reopenedHeaders).toHaveLength(2)
      expect(reopenedHeaders[1]).toHaveAttribute('data-message-id', 'imported-reply')
      expect(screen.getAllByText('Confirmed reply body', { exact: true })).toHaveLength(1)
    }
  })

  it.each(['send-failure', 'sync-failure', 'sync-delayed', 'navigation'] as const)(
    'preserves the correct reader and draft for %s after sending',
    async (scenario) => {
      const source = { ...message, from_email: 'recipient@example.com' }
      const other = { ...message, id: 'other-email', thread_id: 'other-thread', subject: 'Other conversation' }
      const defaultGet = mocks.get.getMockImplementation()!
      let rejectSync!: (error: Error) => void
      let resolveSend!: (response: { data: { draft: { sent_at: string }; provider_message_id: string } }) => void
      mocks.get.mockImplementation(async (url) => {
        if (url === '/api/mailbox/messages') return { data: { messages: [source, other], total: 2 } }
        if (url === '/api/mailbox/messages/mobile-message/thread') {
          return { data: { ...threadResponse.data, messages: [source] } }
        }
        if (url === '/api/mailbox/messages/other-email/thread') {
          return { data: { thread: { id: 'other-thread', account_id: account.id }, messages: [other] } }
        }
        return defaultGet(url)
      })
      mocks.post.mockImplementation(async (url: string, payload: unknown) => {
        if (url === '/api/mailbox/drafts') {
          return { data: { draft: { ...(payload as Record<string, unknown>), id: 'sent-draft' } } }
        }
        if (url === '/api/mailbox/drafts/sent-draft/send') {
          if (scenario === 'send-failure') throw new Error('Provider refused sending')
          if (scenario === 'navigation') return new Promise((resolve) => { resolveSend = resolve })
          return { data: { draft: { sent_at: new Date().toISOString() }, provider_message_id: 'provider-reply' } }
        }
        if (url === `/api/mailbox/accounts/${account.id}/sync`) {
          if (scenario === 'sync-delayed') return { data: { success: true } }
          return new Promise((_resolve, reject) => { rejectSync = reject })
        }
        return { data: {} }
      })
      await renderMailbox()
      fireEvent.click(screen.getAllByTestId('mailbox-message-row')[0])
      await screen.findByRole('button', { name: 'Reply' })
      fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
      fireEvent.change(screen.getByPlaceholderText('Write your message'), { target: { value: 'Test sent reply' } })
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
      if (scenario === 'send-failure') {
        await screen.findByText('Provider refused sending', { exact: false })
        expect(screen.getByPlaceholderText('Write your message').textContent).toBe('Test sent reply')
        expect(screen.getAllByTestId('mailbox-thread-message-header')).toHaveLength(1)
        expect(screen.queryByText('Message sent to recipient@example.com')).toBeNull()
        return
      }
      if (scenario === 'navigation') {
        await waitFor(() => expect(resolveSend).toBeDefined())
        fireEvent.click(screen.getByRole('button', { name: 'Back to Inbox' }))
        fireEvent.click(screen.getAllByTestId('mailbox-message-row').find(row => row.textContent?.includes('Other conversation'))!)
        await screen.findByRole('button', { name: 'Reply' })
        fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
        fireEvent.change(screen.getByPlaceholderText('Write your message'), { target: { value: 'New unsaved draft' } })
        await act(async () => { resolveSend({ data: { draft: { sent_at: new Date().toISOString() }, provider_message_id: 'provider-reply' } }) })
        expect(screen.getByPlaceholderText('Write your message').textContent).toBe('New unsaved draft')
        const header = screen.getByTestId('mailbox-thread-message-header')
        expect(header).toHaveAttribute('data-message-id', 'other-email')
        await act(async () => { rejectSync(new Error('Sent sync unavailable')) })
        expect(screen.getByPlaceholderText('Write your message').textContent).toBe('New unsaved draft')
        expect(header).toHaveAttribute('data-message-id', 'other-email')
        return
      }
      await screen.findByText('Message sent to recipient@example.com')
      if (scenario === 'sync-failure') {
        await act(async () => { rejectSync(new Error('Sent sync unavailable')) })
      }
      await screen.findByRole('alert')
      expect(screen.getByRole('alert')).toHaveTextContent('Your email was sent')
      expect(screen.getByRole('alert')).toHaveTextContent(
        scenario === 'sync-failure' ? 'Sent sync unavailable' : 'provider copy is not available yet'
      )
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss sent confirmation' }))
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByText('Test sent reply', { exact: true })).toBeInTheDocument()
    }
  )

  it.each([360, 390, 430, 768, 844])(
    'keeps format beside the mobile reader title and actions with each email at %ipx',
    async (width) => {
      vi.stubGlobal('innerWidth', width)
      await renderMailbox()
      fireEvent.click(screen.getByTestId('mailbox-message-row'))
      await screen.findByRole('heading', { name: 'Thread Viewer' })
      const actions = screen.getByTestId('mailbox-thread-actions')
      const back = within(actions).getByRole('button', { name: 'Back to Inbox' })
      expect(back.textContent).toBe('')
      expect(back.querySelector('.lucide-inbox')).not.toBeNull()
      const mailboxNavigation = within(screen.getByTestId('mailbox-mobile-navigation'))
        .getByRole('button', { name: 'Mailbox' })
      expect(mailboxNavigation.querySelector('.lucide-inbox')).not.toBeNull()
      const summary = within(actions).getByLabelText('Email format: Raw')
      const primary = screen.getByTestId('mailbox-thread-primary-actions')
      expect(within(primary).getByRole('heading', { name: 'Thread Viewer' })).toBeInTheDocument()
      const emailHeader = screen.getByTestId('mailbox-thread-message-header')
      expect(within(emailHeader).getByTestId('mailbox-thread-message-reply')).toBeInTheDocument()
      expect(within(emailHeader).getByTestId('mailbox-thread-message-forward')).toBeInTheDocument()
      expect(primary.contains(within(emailHeader).getByTestId('mailbox-thread-message-reply'))).toBe(false)
      expect(primary.contains(summary.closest('details'))).toBe(true)
      expect(primary.contains(back)).toBe(false)
      expect(summary.closest('details')).not.toHaveAttribute('open')
      expect(within(actions).getByRole('button', { name: 'Raw' })).not.toBeVisible()
      fireEvent.click(back)
      expect(await screen.findByRole('heading', { name: 'Inbox' })).toBeInTheDocument()
    }
  )

  it('changes mobile formats through the picker without bypassing domain trust', async () => {
    const defaultGet = mocks.get.getMockImplementation()!
    mocks.get.mockImplementation(async (url) => {
      if (url === '/api/mailbox/messages/mobile-message/thread') {
        return {
          data: {
            ...threadResponse.data,
            messages: [{ ...message, body_html_sanitized: '<p>Trusted email content</p>' }],
          },
        }
      }
      return defaultGet(url)
    })
    await renderMailbox()
    fireEvent.click(screen.getByTestId('mailbox-message-row'))
    const summary = await screen.findByLabelText('Email format: Raw')
    // React 19 can still have the thread's viewer-format reset effect pending here; flush it so
    // it does not overwrite the format picked below.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const picker = summary.closest('details')!
    fireEvent.click(summary)
    expect(picker).toHaveAttribute('open')
    const formats = screen.getByRole('group', { name: 'Email format' })
    expect(within(formats).getByRole('button', { name: 'Raw' }))
      .toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(formats).getByRole('button', { name: 'System' }))
    expect(picker).not.toHaveAttribute('open')
    expect(summary).toHaveAccessibleName('Email format: System')
    expect(summary).toHaveFocus()
    fireEvent.click(summary)
    expect(within(formats).getByRole('button', { name: 'System' }))
      .toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(formats).getByRole('button', { name: 'Trusted' }))
    expect(picker).not.toHaveAttribute('open')
    await screen.findByRole('heading', { name: 'Trust Domain To Render HTML?' })
    expect(summary).toHaveAccessibleName('Email format: System')
    fireEvent.click(screen.getByRole('button', { name: 'Trust domain and render HTML' }))
    expect(summary).toHaveAccessibleName('Email format: Trusted')
    expect(summary.querySelector('.lucide-check')).not.toBeNull()
    expect(summary.querySelector('.lucide-help-circle')).toBeNull()
    expect(screen.getByTitle(`Trusted HTML message ${message.id}`)).toBeInTheDocument()
    fireEvent.click(summary)
    expect(within(formats).getByRole('button', { name: 'Trusted' }))
      .toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(formats).getByRole('button', { name: 'Raw' }))
    expect(picker).not.toHaveAttribute('open')
    expect(summary).toHaveAccessibleName('Email format: Raw')
    expect(screen.getByText('Email reader content')).toBeInTheDocument()
  })

  it('dismisses the mobile format picker on Escape, outside tap, or focus leaving', async () => {
    await renderMailbox()
    fireEvent.click(screen.getByTestId('mailbox-message-row'))
    const summary = await screen.findByLabelText('Email format: Raw')
    const picker = summary.closest('details')!
    fireEvent.click(summary)
    fireEvent.keyDown(within(picker).getByRole('button', { name: 'Raw' }), {
      key: 'Escape',
    })
    expect(picker).not.toHaveAttribute('open')
    expect(summary).toHaveFocus()
    fireEvent.click(summary)
    fireEvent.pointerDown(screen.getByRole('heading', { name: 'Thread Viewer' }))
    expect(picker).not.toHaveAttribute('open')
    fireEvent.click(summary)
    fireEvent.blur(summary, { relatedTarget: screen.getByRole('button', { name: 'Forward' }) })
    expect(picker).not.toHaveAttribute('open')
  })

  it('uses a warning question mark for the selected untrusted sender, including plain text', async () => {
    await renderMailbox()
    fireEvent.click(screen.getByTestId('mailbox-message-row'))
    const summary = await screen.findByLabelText('Email format: Raw')
    expect(summary).toHaveClass('border-warning-muted', 'bg-warning-subtle', 'text-warning')
    expect(summary).toHaveAttribute('title', 'Choose email format - sender domain not trusted')
    expect(summary.querySelector('.lucide-help-circle')).not.toBeNull()
    expect(summary.querySelector('.lucide-check')).toBeNull()
  })

  it('uses the selected sender trust state rather than the newest or all thread senders', async () => {
    const trustedMessage = { ...message, id: 'trusted-message', from_email: 'trusted@approved.example' }
    const untrustedMessage = { ...message, id: 'untrusted-message', from_email: 'untrusted@other.example' }
    const defaultGet = mocks.get.getMockImplementation()!
    mocks.get.mockImplementation(async (url) => {
      if (url === '/api/mailbox/preferences/html-trust') {
        return { data: { trusted_domains: ['approved.example'] } }
      }
      if (url === '/api/mailbox/messages') {
        return { data: { messages: [trustedMessage], total: 1 } }
      }
      if (url === '/api/mailbox/messages/trusted-message/thread') {
        return { data: { ...threadResponse.data, messages: [trustedMessage, untrustedMessage] } }
      }
      return defaultGet(url)
    })
    await renderMailbox()
    fireEvent.click(screen.getByTestId('mailbox-message-row'))
    const summary = await screen.findByLabelText('Email format: Raw')
    expect(summary.querySelector('.lucide-check')).not.toBeNull()
    const headers = screen.getAllByTestId('mailbox-thread-message-header')
    fireEvent.click(headers[1])
    expect(summary.querySelector('.lucide-help-circle')).not.toBeNull()
    expect(summary).toHaveClass('text-warning')
  })

  it.each([390, 1280])('uses a shield-check icon for reversing provider junk at %ipx', async (width) => {
    vi.stubGlobal('innerWidth', width)
    const junkMessage = { ...message, is_provider_junk: true }
    const defaultGet = mocks.get.getMockImplementation()!
    mocks.get.mockImplementation(async (url) => {
      if (url === '/api/mailbox/messages') return { data: { messages: [junkMessage], total: 1 } }
      if (url === '/api/mailbox/messages/mobile-message/thread') {
        return { data: { ...threadResponse.data, messages: [junkMessage] } }
      }
      return defaultGet(url)
    })
    await renderMailbox()
    fireEvent.click(screen.getByTestId('mailbox-message-row'))
    const notJunk = await screen.findByRole('button', { name: 'Move this email out of provider junk' })
    expect(notJunk.querySelector('.lucide-shield-check')).not.toBeNull()
    expect(notJunk.querySelector('.lucide-inbox')).toBeNull()
    fireEvent.click(notJunk)
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/api/mailbox/messages/mobile-message/not-junk'))
  })

  it.each([390, 1280])(
    'uses previous-header context on initial load and direct selection afterwards at %ipx',
    async (width) => {
      vi.stubGlobal('innerWidth', width)
      const conversation = [
        { ...message, id: 'first', subject: 'First email' },
        { ...message, id: 'previous', subject: 'Previous email' },
        message,
      ]
      mockThreadScrollGeometry(conversation.map((entry) => entry.id))
      const defaultGet = mocks.get.getMockImplementation()!
      mocks.get.mockImplementation(async (url) => {
        if (url === '/api/mailbox/messages/mobile-message/thread') {
          return { data: { ...threadResponse.data, messages: conversation } }
        }
        return defaultGet(url)
      })
      await renderMailbox()
      fireEvent.click(screen.getByTestId('mailbox-message-row'))
      const reader = await screen.findByTestId('mailbox-thread-scroll')
      const headers = screen.getAllByTestId('mailbox-thread-message-header')
      await waitFor(() => expect(reader.scrollTop).toBe(120))
      expect(headers[0]).toHaveAttribute('aria-expanded', 'false')
      expect(headers[1]).toHaveAttribute('aria-expanded', 'false')
      expect(headers[2]).toHaveAttribute('aria-expanded', 'true')
      expect(within(headers[2]).getByText('Selected message')).toBeInTheDocument()
      fireEvent.click(headers[1])
      expect(reader.scrollTop).toBe(120)
      expect(within(headers[1]).getByText('Selected message')).toBeInTheDocument()
      expect(headers[0]).toHaveAttribute('aria-expanded', 'false')
      expect(headers[2]).toHaveAttribute('aria-expanded', 'true')
      reader.scrollTop = 80
      fireEvent.click(within(headers[1]).getByTestId('mailbox-thread-message-reply'))
      expect(reader.scrollTop).toBe(80)
      expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled()
    }
  )

  it.each([390, 1280])('reuses rendered emails across provider threads without fetching or discarding drafts at %ipx', async (width) => {
    vi.stubGlobal('innerWidth', width)
    const previous = { ...message, id: 'previous', thread_id: 'other-provider-thread', subject: 'Previous email' }
    const conversation = [previous, message]
    mockThreadScrollGeometry(conversation.map((entry) => entry.id))
    const defaultGet = mocks.get.getMockImplementation()!
    mocks.get.mockImplementation(async (url) => {
      if (url === '/api/mailbox/messages') return { data: { messages: conversation, total: 2 } }
      if (url === '/api/mailbox/messages/mobile-message/thread') {
        return { data: { ...threadResponse.data, messages: conversation } }
      }
      return defaultGet(url)
    })
    await renderMailbox()
    fireEvent.click(screen.getAllByTestId('mailbox-message-row').find(row => row.textContent?.includes(message.subject))!)
    const reader = await screen.findByTestId('mailbox-thread-scroll')
    const headers = screen.getAllByTestId('mailbox-thread-message-header')
    fireEvent.click(headers[0])
    fireEvent.click(within(headers[0]).getByTestId('mailbox-thread-message-reply'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Message body' }), { target: { value: 'Keep my unsaved reply' } })
    if (width < 1024) fireEvent.click(screen.getByRole('button', { name: 'Back to Inbox' }))
    const requestsBefore = mocks.get.mock.calls.filter(([url]) => /\/thread(s\/|$)/.test(url)).length
    fireEvent.click(screen.getAllByTestId('mailbox-message-row').find(row => row.textContent?.includes('Previous email'))!)
    await waitFor(() => expect(within(headers[0]).getByText('Selected message')).toBeVisible())
    expect(screen.getByTestId('mailbox-thread-scroll')).toBe(reader)
    expect(screen.getAllByTestId('mailbox-thread-message-header')[0]).toBe(headers[0])
    expect(headers[0]).toHaveAttribute('aria-expanded', 'true')
    expect(headers[1]).toHaveAttribute('aria-expanded', 'true')
    expect(reader.scrollTop).toBe(0)
    expect(screen.getByRole('textbox', { name: 'Message body' })).toHaveValue('Keep my unsaved reply')
    expect(mocks.get.mock.calls.filter(([url]) => /\/thread(s\/|$)/.test(url))).toHaveLength(requestsBefore)
  })

  it.each([false, true])('merges newly discovered mail (already read: %s) without remounting, resetting selection, or refetching on click', async (isRead) => {
    vi.stubGlobal('innerWidth', 1280)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    localStorage.setItem('mailbox:last-new-mail-check:v1:mobile-user', String(Date.now()))
    const incoming = { ...message, id: 'incoming', subject: 'Newly synced email', received_at: '2026-10-05T12:00:00Z', is_read: isRead }
    let synced = false
    let finishRefresh!: (response: typeof threadResponse) => void
    const defaultGet = mocks.get.getMockImplementation()!
    mocks.get.mockImplementation(async (url) => {
      if (url === '/api/mailbox/messages') {
        return { data: { messages: synced ? [message, incoming] : [message], total: synced ? 2 : 1 } }
      }
      if (url === '/api/mailbox/messages/mobile-message/thread' && synced) {
        return new Promise(resolve => { finishRefresh = resolve })
      }
      return defaultGet(url)
    })
    mockThreadScrollGeometry([message.id, incoming.id])
    await renderMailbox()
    fireEvent.click(screen.getByTestId('mailbox-message-row'))
    const reader = await screen.findByTestId('mailbox-thread-scroll')
    const header = screen.getByTestId('mailbox-thread-message-header')
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Message body' }), { target: { value: 'Unsent reply during sync' } })
    fireEvent.click(screen.getByRole('button', { name: 'System' }))
    reader.scrollTop = 45
    synced = true
    act(() => { window.dispatchEvent(new Event(MAILBOX_REMOTE_NEW_MAIL_EVENT)) })
    await waitFor(() => expect(finishRefresh).toBeTypeOf('function'))
    expect(screen.getByTestId('mailbox-thread-scroll')).toBe(reader)
    expect(header).toBeVisible()
    await act(async () => {
      finishRefresh({ data: { ...threadResponse.data, messages: [message, incoming, incoming] } })
    })
    await waitFor(() => expect(screen.getAllByTestId('mailbox-thread-message-header')).toHaveLength(2))
    expect(screen.getAllByTestId('mailbox-thread-message-header')[0]).toBe(header)
    expect(reader.scrollTop).toBe(45)
    expect(within(header).getByText('Selected message')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Message body' })).toHaveValue('Unsent reply during sync')
    expect(screen.getByRole('button', { name: 'System' })).toHaveClass('bg-primary-subtle')
    const requestsBefore = mocks.get.mock.calls.filter(([url]) => url.endsWith('/thread')).length
    fireEvent.click(screen.getAllByTestId('mailbox-message-row').find(row => row.textContent?.includes(incoming.subject))!)
    const incomingHeader = screen.getAllByTestId('mailbox-thread-message-header')[1]
    expect(within(incomingHeader).getByText('Selected message')).toBeVisible()
    expect(reader.scrollTop).toBe(120)
    expect(mocks.get.mock.calls.filter(([url]) => url.endsWith('/thread'))).toHaveLength(requestsBefore)
    expect(screen.getByRole('textbox', { name: 'Message body' })).toHaveValue('Unsent reply during sync')
  })

  it.each([390, 1280])('keeps the viewer usable and reports an incremental refresh error without a retry loop at %ipx', async (width) => {
    vi.stubGlobal('innerWidth', width)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    localStorage.setItem('mailbox:last-new-mail-check:v1:mobile-user', String(Date.now()))
    let synced = false
    const defaultGet = mocks.get.getMockImplementation()!
    mocks.get.mockImplementation(async (url) => {
      if (url === '/api/mailbox/messages') {
        return { data: { messages: synced ? [message, { ...message, id: 'incoming' }] : [message], total: synced ? 2 : 1 } }
      }
      if (url === '/api/mailbox/messages/mobile-message/thread' && synced) throw new Error('Thread refresh unavailable')
      return defaultGet(url)
    })
    await renderMailbox()
    fireEvent.click(screen.getByTestId('mailbox-message-row'))
    const reader = await screen.findByTestId('mailbox-thread-scroll')
    synced = true
    act(() => { window.dispatchEvent(new Event(MAILBOX_REMOTE_NEW_MAIL_EVENT)) })
    await screen.findByText(/Thread refresh unavailable/)
    expect(screen.getByTestId('mailbox-thread-scroll')).toBe(reader)
    expect(screen.getByText('Email reader content')).toBeVisible()
    expect(mocks.get.mock.calls.filter(([url]) => url.endsWith('/thread'))).toHaveLength(2)
  })

  it('merges a clicked new custom-group member without reconstructing the viewer or dropping absent emails', async () => {
    vi.stubGlobal('innerWidth', 1280)
    const older = { ...message, id: 'older', subject: 'Older grouped email' }
    const incoming = { ...message, id: 'incoming', thread_id: 'different-provider-thread', subject: 'New group member' }
    const conversation = [older, message]
    let finishOpen!: (response: typeof threadResponse) => void
    const defaultGet = mocks.get.getMockImplementation()!
    mocks.get.mockImplementation(async (url) => {
      if (url === '/api/mailbox/messages') return { data: { messages: [...conversation, incoming], total: 3 } }
      if (url === '/api/mailbox/messages/mobile-message/thread') {
        return { data: { ...threadResponse.data, messages: conversation } }
      }
      if (url === '/api/mailbox/messages/incoming/thread') {
        return new Promise(resolve => { finishOpen = resolve })
      }
      return defaultGet(url)
    })
    mockThreadScrollGeometry([older.id, message.id, incoming.id])
    await renderMailbox()
    fireEvent.click(screen.getAllByTestId('mailbox-message-row').find(row => row.textContent?.includes(message.subject))!)
    const reader = await screen.findByTestId('mailbox-thread-scroll')
    const headers = screen.getAllByTestId('mailbox-thread-message-header')
    fireEvent.click(headers[0])
    fireEvent.click(within(headers[0]).getByTestId('mailbox-thread-message-reply'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Message body' }), { target: { value: 'Keep draft across group update' } })
    fireEvent.click(screen.getAllByTestId('mailbox-message-row').find(row => row.textContent?.includes(incoming.subject))!)
    expect(screen.getByTestId('mailbox-thread-scroll')).toBe(reader)
    expect(headers[0]).toBeVisible()
    await act(async () => {
      finishOpen({ data: {
        thread: { ...threadResponse.data.thread, id: incoming.thread_id },
        messages: [message, incoming],
      } })
    })
    expect(screen.getAllByTestId('mailbox-thread-message-header')).toHaveLength(3)
    expect(screen.getAllByTestId('mailbox-thread-message-header')[0]).toBe(headers[0])
    expect(headers[0]).toHaveAttribute('aria-expanded', 'true')
    expect(within(screen.getAllByTestId('mailbox-thread-message-header')[2]).getByText('Selected message')).toBeVisible()
    expect(reader.scrollTop).toBe(240)
    expect(screen.getByRole('textbox', { name: 'Message body' })).toHaveValue('Keep draft across group update')
  })

  it('ignores an incremental response after opening another conversation', async () => {
    vi.stubGlobal('innerWidth', 1280)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    localStorage.setItem('mailbox:last-new-mail-check:v1:mobile-user', String(Date.now()))
    const other = { ...message, id: 'other', thread_id: 'other-thread', subject: 'Other conversation', body_text: 'Other conversation body' }
    const incoming = { ...message, id: 'incoming', subject: 'Incoming email' }
    let synced = false
    let finishRefresh!: (response: typeof threadResponse) => void
    const defaultGet = mocks.get.getMockImplementation()!
    mocks.get.mockImplementation(async (url) => {
      if (url === '/api/mailbox/messages') return { data: { messages: synced ? [message, other, incoming] : [message, other], total: synced ? 3 : 2 } }
      if (url === '/api/mailbox/messages/mobile-message/thread' && synced) {
        return new Promise(resolve => { finishRefresh = resolve })
      }
      if (url === '/api/mailbox/messages/other/thread') {
        return { data: { thread: { ...threadResponse.data.thread, id: other.thread_id }, messages: [other] } }
      }
      return defaultGet(url)
    })
    await renderMailbox()
    fireEvent.click(screen.getAllByTestId('mailbox-message-row').find(row => row.textContent?.includes(message.subject))!)
    await screen.findByTestId('mailbox-thread-scroll')
    synced = true
    act(() => { window.dispatchEvent(new Event(MAILBOX_REMOTE_NEW_MAIL_EVENT)) })
    await waitFor(() => expect(finishRefresh).toBeTypeOf('function'))
    fireEvent.click(screen.getAllByTestId('mailbox-message-row').find(row => row.textContent?.includes(other.subject))!)
    await screen.findByText(other.body_text)
    await act(async () => {
      finishRefresh({ data: { ...threadResponse.data, messages: [message, incoming] } })
    })
    expect(screen.getByText(other.body_text)).toBeVisible()
    expect(screen.getAllByTestId('mailbox-thread-message-header')).toHaveLength(1)
    expect(screen.queryByText(message.body_text)).not.toBeInTheDocument()
  })

  it.each([1, 3])('anchors to its own header for the first message in a %i-message thread', async (count) => {
    const conversation = [
      message,
      ...Array.from({ length: count - 1 }, (_, index) => ({ ...message, id: `later-${index}` })),
    ]
    mockThreadScrollGeometry(conversation.map((entry) => entry.id))
    const defaultGet = mocks.get.getMockImplementation()!
    mocks.get.mockImplementation(async (url) => {
      if (url === '/api/mailbox/messages/mobile-message/thread') {
        return { data: { ...threadResponse.data, messages: conversation } }
      }
      return defaultGet(url)
    })
    await renderMailbox()
    fireEvent.click(screen.getByTestId('mailbox-message-row'))
    const reader = await screen.findByTestId('mailbox-thread-scroll')
    expect(reader.scrollTop).toBe(0)
    const header = screen.getAllByTestId('mailbox-thread-message-header')[0]
    expect(within(header).getByText('Selected message')).toBeInTheDocument()
    expect(header).toHaveAttribute('aria-expanded', 'true')
  })

  it.each([390, 1280])('distinguishes Restore and puts it before thread removal at %ipx', async (width) => {
    vi.stubGlobal('innerWidth', width)
    const trashedMessage = { ...message, is_provider_trashed: true }
    const defaultGet = mocks.get.getMockImplementation()!
    mocks.get.mockImplementation(async (url) => {
      if (url === '/api/mailbox/messages') {
        return { data: { messages: [trashedMessage], total: 1 } }
      }
      if (url === '/api/mailbox/messages/mobile-message/thread') {
        return { data: { ...threadResponse.data, messages: [trashedMessage] } }
      }
      return defaultGet(url)
    })
    await renderMailbox()
    expect(screen.getByRole('button', { name: 'Restore from provider trash' })
      .querySelector('.lucide-trash-restore')).not.toBeNull()
    fireEvent.click(screen.getByTestId('mailbox-message-row'))
    const restore = await screen.findByRole('button', { name: 'Restore 1 emails from provider trash' })
    expect(restore.querySelector('.lucide-trash-restore')).not.toBeNull()
    expect(restore.nextElementSibling)
      .toBe(screen.getByRole('button', { name: 'Remove 1 local copies' }))
  })

  it('retains the three direct format buttons on desktop', async () => {
    vi.stubGlobal('innerWidth', 1280)
    await renderMailbox()
    fireEvent.click(screen.getByTestId('mailbox-message-row'))
    await screen.findByRole('heading', { name: 'Thread Viewer' })
    for (const name of ['Raw', 'Trusted', 'System']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.queryByLabelText('Email format: Raw')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Back to Inbox' })).toBeNull()
  })

  it('hides automation on header navigation while preserving the unsaved rule for reopening', async () => {
    await renderMailbox()
    fireEvent.click(screen.getByTestId('mailbox-message-row'))
    await screen.findByRole('heading', { name: 'Thread Viewer' })
    const openAutomation = screen.getByRole('button', { name: 'Open automation configuration and the AI assistant' })
    fireEvent.click(openAutomation)
    const heading = screen.getByRole('heading', { name: 'Automation Configuration' })
    const panel = heading.closest('aside')
    const rule = screen.getByRole('textbox', { name: 'Rule name' })
    fireEvent.change(rule, { target: { value: 'Unsaved mobile rule' } })
    expect(panel).toHaveAttribute('aria-hidden', 'false')
    act(() => window.dispatchEvent(new Event(MOBILE_NAVIGATION_PANEL_DISMISS_EVENT)))
    expect(panel).toHaveAttribute('aria-hidden', 'true')
    expect(rule).toHaveValue('Unsaved mobile rule')
    fireEvent.click(openAutomation)
    expect(panel).toHaveAttribute('aria-hidden', 'false')
    expect(screen.getByRole('textbox', { name: 'Rule name' })).toHaveValue('Unsaved mobile rule')
    expect(mocks.post).not.toHaveBeenCalledWith('/api/mailbox/rules', expect.anything())
  })

  it('shows the New Email label when the mobile Inbox header has room', async () => {
    mockInboxHeaderWidth = 343
    await renderMailbox()
    expect(screen.getByRole('button', { name: 'Compose a new email' }).textContent).toContain('New Email')
  })

  it('keeps the New Email button icon-only when the mobile Inbox header is narrow', async () => {
    mockInboxHeaderWidth = 279
    await renderMailbox()
    expect(screen.getByRole('button', { name: 'Compose a new email' }).textContent).not.toContain('New Email')
  })

  it('keeps guide panels responsive and the Accounts shortcut inside Start here', async () => {
    await renderMailbox()
    selectSection('Learner Guide')
    const panels = screen.getByTestId('mailbox-guide-panels')
    expect(panels.classList.contains('flex-col')).toBe(true)
    expect(panels.classList.contains('lg:flex-row')).toBe(true)
    const guide = panels.closest('#mailbox-learner-guide')
    if (!(guide instanceof HTMLElement)) throw new Error('Mailbox guide is missing')
    const tags = within(guide).getByText('Tags panel (slide-out)').closest('section')
    expect(tags?.classList.contains('w-full')).toBe(true)
    expect(tags?.parentElement?.classList.contains('hidden')).toBe(true)
    fireEvent.click(within(guide).getByRole('button', { name: 'Open Tags' }))
    expect(tags?.parentElement?.classList.contains('hidden')).toBe(false)
    expect(tags?.parentElement?.style.maxWidth).toBe('')
    fireEvent.click(within(guide).getByRole('button', { name: 'Close Tags' }))
    expect(tags?.parentElement?.classList.contains('hidden')).toBe(true)

    fireEvent.click(within(screen.getByTestId('mailbox-guide-start')).getByRole('button', {
      name: 'Go to Settings -> Accounts',
    }))
    await screen.findByRole('heading', { name: 'Connected Accounts' })
    expect(screen.queryByTestId('mailbox-guide-start')).toBeNull()
  })

  it('returns to the list from the active Mailbox button, preserving search and scroll', async () => {
    await renderMailbox()
    fireEvent.change(
      screen.getByPlaceholderText('Search subject, sender, recipients, and content'),
      {
        target: { value: 'Fixture' },
      }
    )
    const scroller = screen.getByTestId('mailbox-inbox-scroll')
    scroller.scrollTop = 80
    fireEvent.scroll(scroller)
    fireEvent.click(screen.getByTestId('mailbox-message-row'))
    await screen.findByRole('heading', { name: 'Thread Viewer' })
    selectSection('Mailbox')
    expect(screen.queryByRole('heading', { name: 'Thread Viewer' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeTruthy()
    expect(
      screen
        .getByPlaceholderText('Search subject, sender, recipients, and content')
        .getAttribute('value')
    ).toBe('Fixture')
    expect(screen.getByTestId('mailbox-inbox-scroll').scrollTop).toBe(80)

    selectSection('People and Domains')
    selectSection('Mailbox')
    expect(screen.queryByRole('heading', { name: 'Thread Viewer' })).toBeNull()
    expect(screen.getByTestId('mailbox-inbox-scroll').scrollTop).toBe(80)
  })

  it.each([375, 1280])('shows a legacy Gmail reply once with expandable history at %ipx', async width => {
    vi.stubGlobal('innerWidth', width)
    const plain = 'New reply\n\nOn Monday, Ada wrote:\n> Original message'
    const previousGet = mocks.get.getMockImplementation()
    mocks.get.mockImplementation(async url => {
      if (url === '/api/mailbox/messages/mobile-message/thread') {
        return {
          data: {
            ...threadResponse.data,
            messages: [{
              ...message,
              body_text: `${plain}\n\nNew reply\n\nOn Monday, Ada wrote:\nOriginal message`,
              body_html_sanitized: '<p>New reply</p><div class="moz-cite-prefix">On Monday, Ada wrote:</div><blockquote>Original message</blockquote>',
            }],
          },
        }
      }
      if (!previousGet) throw new Error('Mailbox GET mock is missing')
      return previousGet(url)
    })
    await renderMailbox()
    fireEvent.click(screen.getByTestId('mailbox-message-row'))
    const reply = await screen.findByText('New reply', { exact: true })
    expect(reply.textContent).toBe('New reply')
    expect(screen.getAllByText('New reply', { exact: true })).toHaveLength(1)
    const summary = screen.getByText('Quoted history')
    const details = summary.closest('details')
    expect(details).not.toBeNull()
    expect(details?.hasAttribute('open')).toBe(false)
    expect(details?.textContent).toContain('> Original message')
    expect(details?.textContent).not.toContain('New reply')
  })

  it('ignores a pending reader response after returning to Mailbox', async () => {
    await renderMailbox()
    let resolveThread!: (response: typeof threadResponse) => void
    mocks.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveThread = resolve
        })
    )
    fireEvent.click(screen.getByTestId('mailbox-message-row'))
    expect(screen.getByTestId('mailbox-message-row')).toHaveAttribute('aria-busy', 'true')
    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith('/api/mailbox/messages/mobile-message/thread')
    )
    selectSection('Mailbox')
    expect(screen.getByTestId('mailbox-message-row')).not.toHaveAttribute('aria-busy')
    await act(async () => {
      resolveThread(threadResponse)
    })
    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Thread Viewer' })).toBeNull()
  })

  it.each([
    [360, 0], [360, 1], [390, 0], [390, 1], [430, 0], [430, 1], [768, 0], [844, 0],
  ])(
    'keeps the border trace at %ipx on remaining row %i until its details open after mobile trash',
    async (width, rowIndex) => {
      vi.stubGlobal('innerWidth', width)
      const remainingMessages = [0, 1].map((index) => ({
        ...message,
        id: `remaining-${index}`,
        thread_id: `remaining-thread-${index}`,
        subject: `Remaining email ${index}`,
      }))
      const defaultGet = mocks.get.getMockImplementation()!
      let resolveDetails!: (response: typeof threadResponse) => void
      let trashed = false
      mocks.post.mockImplementation(async (url: string) => {
        if (url === '/api/mailbox/messages/mobile-message/trash') trashed = true
        return { data: { success: true, new_message_count: 0 } }
      })
      mocks.get.mockImplementation(async (url) => {
        if (url === '/api/mailbox/messages') {
          const messages = trashed ? remainingMessages : [message, ...remainingMessages]
          return { data: { messages, total: messages.length } }
        }
        if (url === `/api/mailbox/messages/remaining-${rowIndex}/thread`) {
          return new Promise((resolve) => { resolveDetails = resolve })
        }
        return defaultGet(url)
      })
      await renderMailbox()
      fireEvent.click(screen.getAllByTestId('mailbox-message-row')[0])
      await screen.findByRole('button', { name: 'Move 1 emails to provider trash' })
      fireEvent.click(screen.getByRole('button', { name: 'Move 1 emails to provider trash' }))
      fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }))
      await waitFor(() => expect(screen.getAllByTestId('mailbox-message-row')).toHaveLength(2))
      const row = screen.getAllByTestId('mailbox-message-row')[rowIndex]
      fireEvent.click(row)
      fireEvent.mouseLeave(row)
      expect(row).toHaveAttribute('aria-busy', 'true')
      expect(row).toHaveClass('border-primary', 'bg-primary/20')
      expect(row.querySelector('.mailbox-filter-highlight-trace')).not.toBeNull()
      expect(within(row).getByRole('status')).toHaveTextContent('Loading email details')
      // The existing hover fade ends at 600ms; loading must outlast it.
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 750)) })
      expect(row).toHaveAttribute('aria-busy', 'true')
      expect(row.querySelector('.mailbox-filter-highlight-trace')).not.toBeNull()
      expect(screen.queryByRole('heading', { name: 'Thread Viewer' })).toBeNull()
      await act(async () => {
        resolveDetails({
          data: {
            thread: { id: remainingMessages[rowIndex].thread_id, account_id: account.id },
            messages: [remainingMessages[rowIndex]],
          },
        })
      })
      await screen.findByRole('heading', { name: 'Thread Viewer' })
      expect(row).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Back to Inbox' }))
      const returnedRow = screen.getAllByTestId('mailbox-message-row')[rowIndex]
      expect(returnedRow).not.toHaveAttribute('aria-busy')
      expect(returnedRow.querySelector('.mailbox-filter-highlight-trace')).toBeNull()
    }
  )

  it('clears the mobile row loading feedback and reports a detail request failure', async () => {
    await renderMailbox()
    let rejectDetails!: (reason: Error) => void
    mocks.get.mockImplementationOnce(
      () => new Promise((_resolve, reject) => { rejectDetails = reject })
    )
    const row = screen.getByTestId('mailbox-message-row')
    fireEvent.click(row)
    expect(row).toHaveAttribute('aria-busy', 'true')
    await act(async () => { rejectDetails(new Error('Email details unavailable')) })
    await screen.findByText('Error: Email details unavailable')
    expect(row).not.toHaveAttribute('aria-busy')
    expect(row.querySelector('.mailbox-filter-highlight-trace')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeTruthy()
  })

  it('keeps the latest row loading when an earlier request finishes', async () => {
    const secondMessage = { ...message, id: 'second-message', thread_id: 'second-thread' }
    const defaultGet = mocks.get.getMockImplementation()!
    let resolveFirst!: (response: typeof threadResponse) => void
    let resolveSecond!: (response: typeof threadResponse) => void
    mocks.get.mockImplementation(async (url) => {
      if (url === '/api/mailbox/messages') {
        return { data: { messages: [message, secondMessage], total: 2 } }
      }
      if (url === '/api/mailbox/messages/mobile-message/thread') {
        return new Promise((resolve) => { resolveFirst = resolve })
      }
      if (url === '/api/mailbox/messages/second-message/thread') {
        return new Promise((resolve) => { resolveSecond = resolve })
      }
      return defaultGet(url)
    })
    await renderMailbox()
    const [firstRow, secondRow] = screen.getAllByTestId('mailbox-message-row')
    fireEvent.click(firstRow)
    fireEvent.click(secondRow)
    expect(firstRow).not.toHaveAttribute('aria-busy')
    expect(secondRow).toHaveAttribute('aria-busy', 'true')
    await act(async () => { resolveFirst(threadResponse) })
    expect(secondRow).toHaveAttribute('aria-busy', 'true')
    expect(secondRow.querySelector('.mailbox-filter-highlight-trace')).not.toBeNull()
    expect(screen.queryByRole('heading', { name: 'Thread Viewer' })).toBeNull()
    selectSection('People and Domains')
    expect(secondRow).not.toHaveAttribute('aria-busy')
    await act(async () => {
      resolveSecond({
        data: { thread: { id: 'second-thread', account_id: account.id }, messages: [secondMessage] },
      })
    })
    selectSection('Mailbox')
    expect(screen.queryByRole('heading', { name: 'Thread Viewer' })).toBeNull()
  })

  it('does not add mobile row loading feedback on desktop', async () => {
    vi.stubGlobal('innerWidth', 1280)
    await renderMailbox()
    let resolveDetails!: (response: typeof threadResponse) => void
    mocks.get.mockImplementationOnce(
      () => new Promise((resolve) => { resolveDetails = resolve })
    )
    const row = screen.getByTestId('mailbox-message-row')
    fireEvent.click(row)
    expect(row).not.toHaveAttribute('aria-busy')
    expect(row.querySelector('.mailbox-filter-highlight-trace')).toBeNull()
    await act(async () => { resolveDetails(threadResponse) })
  })

  it('uses the same safe return behavior for Back to Inbox', async () => {
    await renderMailbox()
    fireEvent.click(screen.getByTestId('mailbox-message-row'))
    await screen.findByRole('heading', { name: 'Thread Viewer' })
    fireEvent.click(screen.getByRole('button', { name: 'Back to Inbox' }))
    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Thread Viewer' })).toBeNull()
  })

  it.each([true, false])(
    'returns to Inbox before the trash response and preserves drafts (other email remaining: %s)',
    async (hasOtherMessage) => {
      const defaultGet = mocks.get.getMockImplementation()!
      mocks.get.mockImplementation(async (url) => {
        if (url === '/api/mailbox/messages') {
          return {
            data: {
              messages: hasOtherMessage
                ? [message, { ...message, id: 'other-message', thread_id: 'other-thread' }]
                : [message],
              total: hasOtherMessage ? 2 : 1,
            },
          }
        }
        return defaultGet(url)
      })
      await renderMailbox()
      fireEvent.change(
        screen.getByPlaceholderText('Search subject, sender, recipients, and content'),
        { target: { value: 'Fixture' } }
      )
      const scroller = screen.getByTestId('mailbox-inbox-scroll')
      scroller.scrollTop = 80
      fireEvent.scroll(scroller)
      fireEvent.click(screen.getAllByTestId('mailbox-message-row')[0])
      await screen.findByRole('heading', { name: 'Thread Viewer' })
      await screen.findByRole('button', { name: 'Move 1 emails to provider trash' })
      fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
      fireEvent.change(screen.getByPlaceholderText('Write your message'), {
        target: { value: 'Unsaved reply' },
      })
      let resolveTrash!: (response: { data: { success: boolean } }) => void
      mocks.post.mockImplementationOnce(
        () => new Promise((resolve) => {
          resolveTrash = resolve
        })
      )
      fireEvent.click(screen.getByRole('button', { name: 'Move 1 emails to provider trash' }))
      fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }))
      await waitFor(() =>
        expect(mocks.post).toHaveBeenCalledWith('/api/mailbox/messages/mobile-message/trash')
      )
      expect(screen.getByRole('heading', { name: 'Inbox' })).toBeTruthy()
      expect(screen.queryByRole('heading', { name: 'Thread Viewer' })).toBeNull()
      expect(screen.getByTestId('mailbox-inbox-scroll').scrollTop).toBe(80)
      expect(
        screen.getByPlaceholderText('Search subject, sender, recipients, and content')
          .getAttribute('value')
      ).toBe('Fixture')
      await act(async () => {
        resolveTrash({ data: { success: true } })
      })
      expect(screen.queryByRole('heading', { name: 'Thread Viewer' })).toBeNull()
      vi.stubGlobal('innerWidth', 1280)
      fireEvent(window, new Event('resize'))
      expect(screen.getByPlaceholderText('Write your message').textContent).toBe('Unsaved reply')
    }
  )

  it('keeps the thread open when its trash confirmation is cancelled', async () => {
    await renderMailbox()
    fireEvent.click(screen.getByTestId('mailbox-message-row'))
    await screen.findByRole('heading', { name: 'Thread Viewer' })
    fireEvent.click(screen.getByRole('button', { name: 'Move 1 emails to provider trash' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('heading', { name: 'Thread Viewer' })).toBeTruthy()
    expect(mocks.post).not.toHaveBeenCalledWith('/api/mailbox/messages/mobile-message/trash')
  })

  it('shows trash failures in Inbox and restores the email without reopening the reader', async () => {
    await renderMailbox()
    fireEvent.click(screen.getByTestId('mailbox-message-row'))
    await screen.findByRole('heading', { name: 'Thread Viewer' })
    mocks.post.mockRejectedValueOnce(new Error('Provider trash failed'))
    fireEvent.click(screen.getByRole('button', { name: 'Move 1 emails to provider trash' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }))
    await screen.findByText('Error: Provider trash failed')
    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Thread Viewer' })).toBeNull()
    await screen.findByTestId('mailbox-message-row')
  })

  it('still opens the next thread after trashing on desktop', async () => {
    vi.stubGlobal('innerWidth', 1280)
    const nextMessage = {
      ...message,
      id: 'next-message',
      thread_id: 'next-thread',
      subject: 'Next thread fixture',
    }
    const nextConversation = [
      { ...nextMessage, id: 'next-first', subject: 'Start of next conversation' },
      { ...nextMessage, id: 'next-previous', subject: 'Previous email in next conversation' },
      nextMessage,
      { ...nextMessage, id: 'next-later', subject: 'Later email in next conversation' },
    ]
    mockThreadScrollGeometry(nextConversation.map((entry) => entry.id))
    let trashed = false
    mocks.post.mockImplementation(async (url: string) => {
      if (url === '/api/mailbox/messages/mobile-message/trash') trashed = true
      return { data: { success: true, new_message_count: 0 } }
    })
    const defaultGet = mocks.get.getMockImplementation()!
    mocks.get.mockImplementation(async (url) => {
      if (url === '/api/mailbox/messages') {
        return { data: { messages: [{ ...message, is_provider_trashed: trashed }, nextMessage], total: 2 } }
      }
      if (url === '/api/mailbox/messages/next-message/thread' || url === '/api/mailbox/threads/next-thread') {
        return {
          data: {
            thread: { id: 'next-thread', account_id: account.id },
            messages: nextConversation,
          },
        }
      }
      return defaultGet(url)
    })
    render(
      <MemoryRouter
        initialEntries={['/mailbox?tab=mailbox']}
      >
        <MailboxPage />
      </MemoryRouter>
    )
    const rows = await screen.findAllByTestId('mailbox-message-row')
    fireEvent.click(rows[0])
    await screen.findByRole('button', { name: 'Move 1 emails to provider trash' })
    fireEvent.click(screen.getByRole('button', { name: 'Move 1 emails to provider trash' }))
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Move thread to trash?' }))
        .getByRole('button', { name: 'Move to trash' })
    )
    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith('/api/mailbox/messages/next-message/thread')
    )
    await waitFor(() => {
      const headers = screen.getAllByTestId('mailbox-thread-message-header')
      expect(headers).toHaveLength(4)
      expect(within(headers[2]).getByText('Selected message')).toBeInTheDocument()
      expect(headers[2]).toHaveAttribute('aria-expanded', 'true')
      expect(headers[1]).toHaveAttribute('aria-expanded', 'false')
      expect(headers[3]).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getByTestId('mailbox-thread-scroll').scrollTop).toBe(120)
    })
    expect(screen.getByRole('heading', { name: 'Thread Viewer' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeTruthy()
  })

  it('keeps unsaved draft state and the desktop reader when leaving the mobile reader', async () => {
    await renderMailbox()
    fireEvent.click(screen.getByTestId('mailbox-message-row'))
    await screen.findByRole('heading', { name: 'Thread Viewer' })
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
    fireEvent.change(screen.getByPlaceholderText('Write your message'), {
      target: { value: 'Unsaved reply' },
    })
    selectSection('Mailbox')
    vi.stubGlobal('innerWidth', 1280)
    fireEvent(window, new Event('resize'))
    expect(screen.getByPlaceholderText('Write your message').textContent).toBe('Unsaved reply')
    expect(screen.getByTestId('mailbox-main-tabs')).toBeTruthy()
    expect(screen.queryByTestId('mailbox-mobile-navigation')).toBeNull()
  })
})
