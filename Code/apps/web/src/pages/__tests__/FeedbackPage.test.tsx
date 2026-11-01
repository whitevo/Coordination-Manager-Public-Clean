import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import FeedbackPage from '../FeedbackPage'
import { apiClient } from '../../lib/api-client'

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    put: vi.fn(),
  },
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      email: 'test@example.com',
      displayName: 'Test User',
      roles: [],
      accountType: 'google',
      themePreferences: null,
    },
    isAuthenticated: true,
    isLoading: false,
  }),
}))

// Stub LearnerHelpIcon -- simple icon, not under test
vi.mock('../../components/LearnerHelpIcon', () => ({
  default: () => null,
}))

// Stub AiFeedbackPage -- large sub-page, not under test here
vi.mock('../AiFeedbackPage', () => ({
  default: () => <div data-testid="ai-feedback-stub" />,
}))

// ── Helpers ────────────────────────────────────────────────────────────────

const IMAGE_URL = 'https://example.com/screenshot.png'

function makeFeedbackResponse(attachments: string[] = []) {
  return {
    data: {
      feedback: [
        {
          id: 'fb-1',
          user_id: 'user-1',
          discord_user_id: null,
          discord_username: null,
          user_display_name: 'Test User',
          user_email: 'test@example.com',
          user_avatar_url: null,
          message: 'Test feedback message',
          source: 'web',
          status: 'open',
          created_at: '2026-04-19T10:00:00Z',
          attachments,
          feedback_responses: [],
        },
      ],
      total: 1,
      statusCounts: { open: 1, reviewed: 0 },
      isAdmin: false,
    },
  }
}

async function renderPage(route = '/feedback') {
  let result!: ReturnType<typeof render>
  await act(async () => {
    result = render(
      <MemoryRouter initialEntries={[route]}>
        <FeedbackPage />
      </MemoryRouter>
    )
  })
  // Wait for the loading indicator to disappear
  await waitFor(
    () => expect(screen.queryByText('Loading feedback...')).not.toBeInTheDocument(),
    { timeout: 5000 }
  )
  return result
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('FeedbackPage -- image lightbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiClient.get).mockResolvedValue(makeFeedbackResponse([IMAGE_URL]))
  })

  it('renders the feedback list with an attachment image', async () => {
    await renderPage()
    const img = await screen.findByAltText('Attachment 1')
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute('src', IMAGE_URL)
  })

  it('lightbox is not visible on initial render', async () => {
    await renderPage()
    expect(screen.queryByRole('img', { name: 'Attachment preview' })).not.toBeInTheDocument()
  })

  it('clicking an attachment image opens the lightbox', async () => {
    await renderPage()
    const thumb = await screen.findByAltText('Attachment 1')
    await act(async () => { fireEvent.click(thumb) })
    const preview = await screen.findByRole('img', { name: 'Attachment preview' })
    expect(preview).toBeInTheDocument()
    expect(preview).toHaveAttribute('src', IMAGE_URL)
  })

  it('clicking the Enlarge button on the attachment also opens the lightbox', async () => {
    await renderPage()
    const enlargeBtn = await screen.findByTitle('Enlarge')
    await act(async () => { fireEvent.click(enlargeBtn) })
    const preview = await screen.findByRole('img', { name: 'Attachment preview' })
    expect(preview).toBeInTheDocument()
  })

  it('pressing Escape while lightbox is open closes it', async () => {
    await renderPage()
    const thumb = await screen.findByAltText('Attachment 1')
    await act(async () => { fireEvent.click(thumb) })
    expect(await screen.findByRole('img', { name: 'Attachment preview' })).toBeInTheDocument()
    const lightbox = screen.getByRole('dialog', { name: 'Image preview' })
    await act(async () => { fireEvent.keyDown(lightbox, { key: 'Escape' }) })
    await waitFor(() => {
      expect(screen.queryByRole('img', { name: 'Attachment preview' })).not.toBeInTheDocument()
    })
  })

  it('clicking the Close button in the lightbox closes it', async () => {
    await renderPage()
    const thumb = await screen.findByAltText('Attachment 1')
    await act(async () => { fireEvent.click(thumb) })
    const closeBtn = await screen.findByRole('button', { name: 'Close preview' })
    await act(async () => { fireEvent.click(closeBtn) })
    await waitFor(() => {
      expect(screen.queryByRole('img', { name: 'Attachment preview' })).not.toBeInTheDocument()
    })
  })

  it('clicking the lightbox overlay closes it', async () => {
    await renderPage()
    const thumb = await screen.findByAltText('Attachment 1')
    await act(async () => { fireEvent.click(thumb) })
    const preview = await screen.findByRole('img', { name: 'Attachment preview' })
    // The area around the image (the lightbox panel) acts as the scrim
    const overlay = preview.parentElement as HTMLElement
    await act(async () => { fireEvent.click(overlay) })
    await waitFor(() => {
      expect(screen.queryByRole('img', { name: 'Attachment preview' })).not.toBeInTheDocument()
    })
  })

  it('clicking the preview image itself does NOT close the lightbox', async () => {
    await renderPage()
    const thumb = await screen.findByAltText('Attachment 1')
    await act(async () => { fireEvent.click(thumb) })
    const preview = await screen.findByRole('img', { name: 'Attachment preview' })
    // Only clicks on the area around the image close the lightbox
    await act(async () => { fireEvent.click(preview) })
    expect(screen.getByRole('img', { name: 'Attachment preview' })).toBeInTheDocument()
  })
})

describe('FeedbackPage -- attachment list (no attachments)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiClient.get).mockResolvedValue(makeFeedbackResponse([]))
  })

  it('does not render attachment images when feedback has none', async () => {
    await renderPage()
    expect(screen.queryByAltText('Attachment 1')).not.toBeInTheDocument()
  })
})

describe('FeedbackPage -- page renders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiClient.get).mockResolvedValue(makeFeedbackResponse([]))
  })

  it('renders the Feedback heading', async () => {
    await renderPage()
    expect(screen.getByRole('heading', { name: /feedback/i })).toBeInTheDocument()
  })

  it('renders the Your Submissions section for non-admin users', async () => {
    await renderPage()
    expect(screen.getByText('Your Submissions')).toBeInTheDocument()
  })

  it('labels the order-by chip as Received for open feedback', async () => {
    await renderPage()
    const orderByRow = screen.getByText('Order by:').parentElement as HTMLElement
    expect(within(orderByRow).getByText('Received')).toBeInTheDocument()
  })

  it('shows the feedback submission form textarea', async () => {
    await renderPage()
    expect(
      screen.getByPlaceholderText(/report a bug, suggest a feature/i)
    ).toBeInTheDocument()
  })
})

// -- Status change motion + next-page prefetch (stateful mock server) --------

interface ServerRow { id: string; status: string; created_at: string }

const STATUS_ORDER = ['open', 'reviewed', 'affirmed', 'resolved', 'dismissed']

function makeRow(row: ServerRow) {
  return {
    ...row,
    user_id: 'user-2',
    discord_user_id: null,
    discord_username: null,
    user_display_name: `User ${row.id}`,
    user_email: null,
    user_avatar_url: null,
    message: `Message ${row.id}`,
    source: 'web',
    attachments: [],
    feedback_responses: [],
  }
}

function installServer(rows: ServerRow[], options: { failPatch?: boolean; savedStatusOrder?: string[] } = {}) {
  const server = rows.map(row => ({ ...row }))
  vi.mocked(apiClient.get).mockImplementation(async (_url, config) => {
    const params = config?.params
    const pageNum = Number(
      typeof params === 'object' && params !== null && 'page' in params
        ? params.page
        : '1'
    )
    const limit = Number(
      typeof params === 'object' && params !== null && 'limit' in params
        ? params.limit
        : '5'
    )
    const statusOrder: string[] = typeof params === 'object' && params !== null && 'statusOrder' in params
      ? JSON.parse(String(params.statusOrder))
      : STATUS_ORDER
    const sorted = [...server].sort((a, b) => {
      const byStatus = statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status)
      return byStatus !== 0 ? byStatus : Date.parse(b.created_at) - Date.parse(a.created_at)
    })
    return {
      data: {
        feedback: sorted.slice((pageNum - 1) * limit, pageNum * limit).map(makeRow),
        total: sorted.length,
        statusCounts: {
          open: server.filter(r => r.status === 'open').length,
          reviewed: server.filter(r => r.status === 'reviewed').length,
        },
        isAdmin: true,
        savedStatusOrder: options.savedStatusOrder,
      },
    }
  })
  vi.mocked(apiClient.patch).mockImplementation(async (url: string, body?: unknown) => {
    if (options.failPatch) throw new Error('boom')
    const id = url.split('/').pop()
    const row = server.find(r => r.id === id)
    if (row && body && typeof body === 'object' && 'status' in body) row.status = String(body.status)
    return { data: {} }
  })
}

function pageRequests(pageNum: number) {
  return vi.mocked(apiClient.get).mock.calls.filter(([, config]) =>
    (config as { params?: Record<string, string> } | undefined)?.params?.page === String(pageNum))
}

function cardOrder() {
  return screen.getAllByTestId(/^feedback-card-/).map(el => el.getAttribute('data-testid')?.replace('feedback-card-', ''))
}

async function renderAdminExpanded() {
  await renderPage()
  const toggle = await screen.findByRole('button', { name: /all feedback/i })
  await act(async () => { fireEvent.click(toggle) })
  await screen.findByTestId('feedback-card-a')
}

async function setStatus(id: string, label: string) {
  const card = screen.getByTestId(`feedback-card-${id}`)
  const step = within(card).getByTitle(`Set status to ${label}`)
  await act(async () => { fireEvent.click(step) })
}

describe('FeedbackPage -- saved status order', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const savedStatusOrder = ['resolved', 'reviewed', 'affirmed', 'open', 'dismissed']
  const rows: ServerRow[] = [
    { id: 'a', status: 'open', created_at: '2026-04-06T10:00:00Z' },
    { id: 'b', status: 'open', created_at: '2026-04-05T10:00:00Z' },
    { id: 'c', status: 'open', created_at: '2026-04-04T10:00:00Z' },
    { id: 'd', status: 'open', created_at: '2026-04-03T10:00:00Z' },
    { id: 'e', status: 'reviewed', created_at: '2026-04-02T10:00:00Z' },
    { id: 'f', status: 'resolved', created_at: '2026-04-01T10:00:00Z' },
  ]

  it.each(['/feedback', '/feedback?tab=support'])(
    'restores the saved order on returning to %s, including paginated cards',
    async route => {
      installServer(rows, { savedStatusOrder })
      const firstVisit = await renderPage(route)
      firstVisit.unmount()

      await renderPage(route)
      await act(async () => {
        fireEvent.click(await screen.findByRole('button', { name: /all (feedback|support requests)/i }))
      })
      await waitFor(() => expect(cardOrder()).toEqual(['f', 'e', 'a', 'b', 'c']))
      const orderByRow = screen.getByText('Order by:').parentElement
      expect(orderByRow?.textContent).toBe('Order by:ResolvedAcknowledgedAffirmedReceivedDismissed')

      await waitFor(() => expect(pageRequests(2).some(([, config]) => {
        const params = config?.params
        return typeof params === 'object' && params !== null && 'statusOrder' in params
          && params.statusOrder === JSON.stringify(savedStatusOrder)
      })).toBe(true))
      await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Next' })[0]) })
      await waitFor(() => expect(cardOrder()).toEqual(['d']))

      await act(async () => { fireEvent.click(screen.getByRole('radio', { name: '10' })) })
      await waitFor(() => expect(cardOrder()).toEqual(['f', 'e', 'a', 'b', 'c', 'd']))
    }
  )

  it.each([undefined, STATUS_ORDER])('does not refetch for an unchanged saved order (%s)', async savedOrder => {
    installServer(rows.slice(0, 2), { savedStatusOrder: savedOrder })
    await renderAdminExpanded()
    expect(cardOrder()).toEqual(['a', 'b'])
    expect(pageRequests(1)).toHaveLength(1)
  })
})

describe('FeedbackPage -- status change motion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('moves the card to its new slot without reloading the list', async () => {
    installServer([
      { id: 'a', status: 'open', created_at: '2026-04-05T10:00:00Z' },
      { id: 'b', status: 'open', created_at: '2026-04-04T10:00:00Z' },
      { id: 'c', status: 'reviewed', created_at: '2026-04-03T10:00:00Z' },
      { id: 'd', status: 'resolved', created_at: '2026-04-02T10:00:00Z' },
    ])
    await renderAdminExpanded()
    expect(cardOrder()).toEqual(['a', 'b', 'c', 'd'])

    await setStatus('a', 'Acknowledged')
    // Status changes in place first; the list is never replaced by the loader
    expect(screen.queryByText('Loading feedback...')).not.toBeInTheDocument()
    expect(cardOrder()).toEqual(['a', 'b', 'c', 'd'])
    expect(within(screen.getByTestId('feedback-card-a')).getByTitle('Set status to Acknowledged').className).toContain('ring-1')

    await waitFor(() => expect(cardOrder()).toEqual(['b', 'a', 'c', 'd']), { timeout: 3000 })
    expect(screen.queryByText('Loading feedback...')).not.toBeInTheDocument()
    expect(apiClient.patch).toHaveBeenCalledWith('/api/feedback/a', { status: 'reviewed' })
  })

  it('exits a card whose new position is past this page and backfills from the prefetched next page', async () => {
    installServer([
      { id: 'a', status: 'open', created_at: '2026-04-06T10:00:00Z' },
      { id: 'b', status: 'open', created_at: '2026-04-05T10:00:00Z' },
      { id: 'c', status: 'open', created_at: '2026-04-04T10:00:00Z' },
      { id: 'd', status: 'open', created_at: '2026-04-03T10:00:00Z' },
      { id: 'e', status: 'open', created_at: '2026-04-02T10:00:00Z' },
      { id: 'f', status: 'open', created_at: '2026-04-01T10:00:00Z' },
    ])
    await renderAdminExpanded()
    await waitFor(() => expect(pageRequests(2).length).toBe(1))

    await setStatus('a', 'Resolved')
    expect(screen.queryByText('Loading feedback...')).not.toBeInTheDocument()

    await waitFor(() => expect(cardOrder()).toEqual(['b', 'c', 'd', 'e', 'f']), { timeout: 3000 })
    expect(screen.queryByText('Loading feedback...')).not.toBeInTheDocument()
  })

  it('serves Next from the background prefetch without another request', async () => {
    installServer([
      { id: 'a', status: 'open', created_at: '2026-04-06T10:00:00Z' },
      { id: 'b', status: 'open', created_at: '2026-04-05T10:00:00Z' },
      { id: 'c', status: 'open', created_at: '2026-04-04T10:00:00Z' },
      { id: 'd', status: 'open', created_at: '2026-04-03T10:00:00Z' },
      { id: 'e', status: 'open', created_at: '2026-04-02T10:00:00Z' },
      { id: 'f', status: 'open', created_at: '2026-04-01T10:00:00Z' },
    ])
    await renderAdminExpanded()
    await waitFor(() => expect(pageRequests(2).length).toBe(1))

    const [nextButton] = screen.getAllByRole('button', { name: 'Next' })
    await act(async () => { fireEvent.click(nextButton) })

    expect(screen.queryByText('Loading feedback...')).not.toBeInTheDocument()
    expect(cardOrder()).toEqual(['f'])
    expect(pageRequests(2).length).toBe(1)
  })

  it('rolls the status back in place when the update fails', async () => {
    installServer([
      { id: 'a', status: 'open', created_at: '2026-04-05T10:00:00Z' },
      { id: 'b', status: 'reviewed', created_at: '2026-04-04T10:00:00Z' },
    ], { failPatch: true })
    await renderAdminExpanded()

    await setStatus('a', 'Resolved')
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not update the status')
    expect(cardOrder()).toEqual(['a', 'b'])
    const card = screen.getByTestId('feedback-card-a')
    expect(within(card).getByTitle('Set status to Received').className).toContain('ring-1')
  })
})
