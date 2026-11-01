import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import MeetingPage from '../MeetingPage'

const mockGet = vi.fn()
const mockPost = vi.fn()
const mockLogin = vi.fn()
const mockShowToast = vi.fn()
const mockUseAuth = vi.fn()

vi.mock('../../lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock('../../components/Toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}))

const meeting = {
  id: 'meeting-123',
  kind: 'event' as const,
  title: 'Team planning',
  description: 'Review the next milestone.',
  location: 'Room 4',
  start_time: '2030-01-15T10:00:00.000Z',
  end_time: '2030-01-15T11:00:00.000Z',
  duration_minutes: 60,
  meeting_link: 'https://example.com/meeting',
  source_label: 'Community event',
}

function renderMeetingPage() {
  return render(
    <MemoryRouter initialEntries={['/meeting/meeting-123']}>
      <Routes>
        <Route path="/meeting/:meetingId" element={<MeetingPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('MeetingPage Time Manager action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({ isAuthenticated: true, login: mockLogin })
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/api/meetings/single/meeting-123') {
        return { data: { meeting } }
      }
      if (url === '/api/time-management/modes') {
        return {
          data: {
            modes: [
              { id: 'mode-work', name: 'Work' },
              { id: 'mode-personal', name: 'Personal' },
            ],
          },
        }
      }
      return { data: {} }
    })
    mockPost.mockResolvedValue({ data: { event: {} } })
  })

  it('adds the meeting to the selected Time Manager mode', async () => {
    renderMeetingPage()

    await screen.findByRole('heading', { name: 'Team planning' })
    fireEvent.click(screen.getByRole('button', { name: /time manager/i }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Work' }))

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/api/user-events', {
        title: 'Team planning',
        description: 'Review the next milestone.',
        meeting_link: 'https://example.com/meeting',
        location: 'Room 4',
        start_time: '2030-01-15T10:00:00.000Z',
        end_time: '2030-01-15T11:00:00.000Z',
        is_public: false,
        source_id: 'mode-work',
      })
    })
    expect(mockShowToast).toHaveBeenCalledWith('Added to Time Manager: Work.')
  })

  it('prompts signed-out visitors to sign in instead of loading modes', async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false, login: mockLogin })
    renderMeetingPage()

    await screen.findByRole('heading', { name: 'Team planning' })
    fireEvent.click(screen.getByRole('button', { name: /time manager/i }))

    await waitFor(() => expect(mockLogin).toHaveBeenCalledOnce())
    expect(mockGet).not.toHaveBeenCalledWith('/api/time-management/modes')
  })

  it('supports keyboard navigation and returns focus to the trigger on Escape', async () => {
    renderMeetingPage()

    await screen.findByRole('heading', { name: 'Team planning' })
    const trigger = screen.getByRole('button', { name: /time manager/i })
    fireEvent.click(trigger)
    const workMode = await screen.findByRole('menuitem', { name: 'Work' })
    const personalMode = screen.getByRole('menuitem', { name: 'Personal' })

    await waitFor(() => expect(workMode).toHaveFocus())
    fireEvent.keyDown(workMode, { key: 'ArrowDown' })
    expect(personalMode).toHaveFocus()

    fireEvent.keyDown(personalMode, { key: 'Escape' })
    expect(trigger).toHaveFocus()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('keeps the calendar actions aligned with larger icons', async () => {
    renderMeetingPage()

    await screen.findByRole('heading', { name: 'Team planning' })

    const actions = [
      screen.getByRole('link', { name: 'Google' }),
      screen.getByRole('link', { name: 'Outlook' }),
      screen.getByRole('button', { name: '.ics' }),
      screen.getByRole('button', { name: /time manager/i }),
    ]

    for (const action of actions) {
      expect(action).toHaveClass('min-h-12')
      expect(action.querySelector('svg')).toHaveClass('h-5', 'w-5')
    }

    expect(document.querySelector('.max-w-4xl')).toBeInTheDocument()
  })
})
