import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AnnouncementsPage from '../AnnouncementsPage'
import { apiClient } from '../../lib/api-client'

const mockUseAuth = vi.fn()
const mockSetPageContext = vi.fn()
const mockShowToast = vi.fn()

vi.mock('../../lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock('../../contexts/AiAssistantContext', () => ({
  useAiAssistant: () => ({
    setPageContext: mockSetPageContext,
  }),
}))

vi.mock('../../components/Toast', () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
}))

vi.mock('../../components/LearnerHelpIcon', () => ({
  default: () => null,
}))

vi.mock('../../components/announcements/ResponsesTab', () => ({
  default: () => <div data-testid="responses-tab-stub" />,
}))

vi.mock('../../components/announcements/EmojiPicker', () => ({
  default: () => null,
}))

function mockAnnouncementsApiDefaults(aiAvailable = false): void {
  vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
    if (url === '/api/discord/integration') return { data: { integration: null } }
    if (url === '/api/announcements/templates') return { data: { templates: [] } }
    if (url === '/api/announcements/schedules') return { data: { schedules: [] } }
    if (url === '/api/notification-preferences') return { data: { preferences: null } }
    if (url === '/api/ai-chat/status') return { data: { available: aiAvailable } }
    if (url === '/api/email-contacts') return { data: { contacts: [] } }
    if (url === '/api/connections') return { data: { connections: [] } }
    if (url === '/api/verified-emails') return { data: { emails: [] } }
    if (url === '/api/announcements/email-status') return { data: { configured: false, userConfig: null } }
    if (url === '/api/smtp-config') return { data: { config: null } }
    if (url === '/api/announcements/meetings') return { data: { meetings: [], calendars: [] } }
    return { data: {} }
  })

  vi.mocked(apiClient.post).mockResolvedValue({ data: {} })
  vi.mocked(apiClient.patch).mockResolvedValue({ data: {} })
  vi.mocked(apiClient.put).mockResolvedValue({ data: {} })
  vi.mocked(apiClient.delete).mockResolvedValue({ data: {} })
}

function renderAnnouncementsPage(): void {
  render(
    <MemoryRouter initialEntries={['/announcements?tab=compose']}>
      <Routes>
        <Route path="/announcements" element={<AnnouncementsPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('AnnouncementsPage prefill fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    localStorage.clear()

    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isCardano: false,
      user: {
        id: 'user-1',
        email: 'user@example.com',
        roles: [],
      },
    })

    mockAnnouncementsApiDefaults()
  })

  it('uses an AI-tinted context header rather than the theme accent and preserves its draft', async () => {
    mockAnnouncementsApiDefaults(true)
    renderAnnouncementsPage()
    const toggle = await screen.findByRole('button', { name: 'AI Context' })
    expect(toggle.parentElement).toHaveClass('bg-feature-ai-subtle', 'text-foreground')
    expect(toggle.parentElement).not.toHaveClass('bg-accent')
    if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle)
    const field = screen.getByPlaceholderText(/Provide background context for the AI/)
    expect(field).toHaveClass('bg-card', 'text-foreground', 'border-border')
    fireEvent.change(field, { target: { value: 'Audience: calendar organizers' } })
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(screen.getByPlaceholderText(/Provide background context for the AI/)).toHaveValue('Audience: calendar organizers')
  })

  it('applies title/body prefill from session storage when URL prefill params are missing', async () => {
    sessionStorage.setItem('cm-ann-prefill-title', 'Planning invite: Team Sync')
    sessionStorage.setItem('cm-ann-prefill-body', "You're invited to help plan \"Team Sync\".")
    sessionStorage.setItem('cm-ann-prefill-reset', '1')

    renderAnnouncementsPage()

    const titleInput = await screen.findByPlaceholderText('e.g., Weekly Raid Schedule Update')
    const bodyInput = await screen.findByPlaceholderText('Write your announcement message here...')

    await waitFor(() => {
      expect(titleInput).toHaveValue('Planning invite: Team Sync')
      expect(bodyInput).toHaveValue("You're invited to help plan \"Team Sync\".")
    })

    await waitFor(() => {
      expect(sessionStorage.getItem('cm-ann-prefill-title')).toBeNull()
      expect(sessionStorage.getItem('cm-ann-prefill-body')).toBeNull()
      expect(sessionStorage.getItem('cm-ann-prefill-reset')).toBeNull()
    })
  })
})
