import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import DeletePostedMessagesAction from '../DeletePostedMessagesAction'
import { buildDeleteConfirmMessage, buildDeleteResultToast, countDeletableMessages } from '../delete-posted-messages'
import type { DeletableLogEntry } from '../delete-posted-messages'
import { apiClient } from '../../../lib/api-client'

const mockShowToast = vi.fn()

vi.mock('../../../lib/api-client', () => ({
  apiClient: { post: vi.fn() },
}))

vi.mock('../../Toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}))

const SCHEDULE_ID = '33333333-3333-4333-8333-333333333333'

function entry(overrides: Partial<DeletableLogEntry>): DeletableLogEntry {
  return {
    id: 'log-1',
    channel_type: 'discord_channel',
    status: 'sent',
    discord_message_id: '900000000000000001',
    deleted_at: null,
    ...overrides,
  }
}

const LOG: DeletableLogEntry[] = [
  entry({ id: 'log-1' }),
  entry({ id: 'log-2', channel_type: 'discord_dm' }),
  entry({ id: 'log-3', channel_type: 'email', discord_message_id: null }),
  entry({ id: 'log-4', channel_type: 'discord_dm', deleted_at: '2026-10-01T00:00:00.000Z' }),
  entry({ id: 'log-5', channel_type: 'discord_dm', status: 'failed', discord_message_id: null }),
]

describe('countDeletableMessages', () => {
  it('counts sent, undeleted Discord messages and sent emails', () => {
    expect(countDeletableMessages(LOG)).toEqual({ discord: 2, email: 1 })
  })
})

describe('confirm and toast copy', () => {
  it('states the count and that emails cannot be recalled', () => {
    const message = buildDeleteConfirmMessage(2, 1)
    expect(message).toContain('2 Discord messages')
    expect(message).toContain('1 email already delivered cannot be recalled')
  })

  it('omits the email note when no emails were sent', () => {
    expect(buildDeleteConfirmMessage(1, 0)).not.toContain('email')
  })

  it('reports an error toast only when nothing was deleted', () => {
    expect(buildDeleteResultToast({ deleted: 0, failed: 2, skippedEmail: 0 }).type).toBe('error')
    expect(buildDeleteResultToast({ deleted: 1, failed: 1, skippedEmail: 1 })).toEqual({
      message: 'Deleted 1 Discord message. 1 could not be deleted. 1 email cannot be recalled.',
      type: 'success',
    })
  })
})

describe('DeletePostedMessagesAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when there is nothing left to delete', () => {
    const { container } = render(
      <DeletePostedMessagesAction scheduleId={SCHEDULE_ID} deliveryLog={[LOG[2], LOG[3]]} onSettled={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('confirms, deletes, toasts, and refreshes the log', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { deleted: 2, failed: 0, skippedEmail: 1, results: [] } })
    const onSettled = vi.fn()
    render(<DeletePostedMessagesAction scheduleId={SCHEDULE_ID} deliveryLog={LOG} onSettled={onSettled} />)

    fireEvent.click(screen.getByRole('button', { name: /delete posted messages/i }))
    expect(screen.getByText(/1 email already delivered cannot be recalled/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete messages (2)' }))

    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1))
    expect(apiClient.post).toHaveBeenCalledWith(
      `/api/announcements/schedules/${SCHEDULE_ID}/delete-messages`,
      {},
      expect.objectContaining({ timeout: expect.any(Number) }),
    )
    expect(mockShowToast).toHaveBeenCalledWith('Deleted 2 Discord messages. 1 email cannot be recalled.', 'success')
  })

  it('does nothing when the confirm is cancelled', () => {
    render(<DeletePostedMessagesAction scheduleId={SCHEDULE_ID} deliveryLog={LOG} onSettled={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /delete posted messages/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(apiClient.post).not.toHaveBeenCalled()
  })

  it('shows the server message when the bot is unreachable', async () => {
    vi.mocked(apiClient.post).mockRejectedValueOnce({
      response: { status: 502, data: { error: 'BOT_UNAVAILABLE', message: 'The Discord bot is unreachable, so no messages were deleted.' } },
    })
    const onSettled = vi.fn()
    render(<DeletePostedMessagesAction scheduleId={SCHEDULE_ID} deliveryLog={LOG} onSettled={onSettled} />)

    fireEvent.click(screen.getByRole('button', { name: /delete posted messages/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete messages (2)' }))

    await waitFor(() => expect(onSettled).toHaveBeenCalled())
    expect(mockShowToast).toHaveBeenCalledWith('The Discord bot is unreachable, so no messages were deleted.', 'error')
  })
})
