import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EventFlagPanel from '../EventFlagPanel'
import { apiClient } from '../../lib/api-client'

const showToast = vi.fn()

vi.mock('../../lib/api-client', () => ({
  apiClient: { post: vi.fn() },
}))

vi.mock('../Toast', () => ({
  useToast: () => ({ showToast }),
}))

describe('EventFlagPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiClient.post).mockResolvedValue({ data: {} })
  })

  it('requires a two-character rationale before submitting a removal flag', async () => {
    render(
      <EventFlagPanel
        eventTitle="Weekly Commons"
        targets={[{ type: 'user_event', id: 'event-1' }]}
        onClose={vi.fn()}
        onSubmitted={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByLabelText(/Remove from public/))
    const submit = screen.getByRole('button', { name: 'Submit flag' })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText('Describe what should be checked'), { target: { value: 'No longer listed by the organizer' } })
    fireEvent.click(submit)

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/api/event-flags', {
        flagType: 'removal',
        rationale: 'No longer listed by the organizer',
        targets: [{ type: 'user_event', id: 'event-1' }],
      })
    })
  })
})