import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { CommonsSidePanel } from '../CommonsSidePanel'
import { apiClient } from '../../lib/api-client'

const showToast = vi.fn()

vi.mock('../../lib/api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}))

vi.mock('../Toast', () => ({
  useToast: () => ({ showToast }),
}))

describe('CommonsSidePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({
        data: {
          flags: [{
            id: 'flag-1',
            flag_type: 'confirmation',
            status: 'pending',
            rationale: 'Is this weekly session still active?',
            reporter_type: 'anonymous',
            respond_by: '2026-09-20T12:00:00.000Z',
            resolved_at: null,
            created_at: '2026-09-13T12:00:00.000Z',
            targets: [{ type: 'user_event', id: 'event-1', title: 'Weekly Commons', status: 'pending', responded_at: null }],
          }],
        },
      })
      .mockResolvedValue({ data: { flags: [] } })
    vi.mocked(apiClient.post).mockResolvedValue({ data: { success: true } })
  })

  it('lets an owner confirm an active event flag', async () => {
    render(
      <MemoryRouter>
        <CommonsSidePanel isOpen onClose={vi.fn()} onPanelChange={vi.fn()} />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Weekly Commons')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm active' }))

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/api/event-flags/flag-1/respond', { action: 'confirmed' })
    })
  })

  it('renders removal request cards with "Approve removal" and "Republish" options', async () => {
    vi.mocked(apiClient.get).mockReset().mockResolvedValueOnce({
      data: {
        flags: [{
          id: 'flag-2',
          flag_type: 'removal',
          status: 'pending',
          rationale: 'Link is broken and source is unknown',
          reporter_type: 'anonymous',
          respond_by: '2026-09-27T12:00:00.000Z',
          resolved_at: null,
          created_at: '2026-09-13T12:00:00.000Z',
          targets: [{ type: 'user_event', id: 'event-2', title: 'ODIN Meeting', status: 'pending', responded_at: null }],
        }],
      },
    }).mockResolvedValue({ data: { flags: [] } })

    render(
      <MemoryRouter>
        <CommonsSidePanel isOpen onClose={vi.fn()} onPanelChange={vi.fn()} />
      </MemoryRouter>,
    )

    expect(await screen.findByText('ODIN Meeting')).toBeInTheDocument()
    expect(screen.getByText('Hidden from public calendar until reviewed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve removal' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Republish' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Approve removal' }))

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/api/event-flags/flag-2/respond', { action: 'removal_accepted' })
    })
  })
})