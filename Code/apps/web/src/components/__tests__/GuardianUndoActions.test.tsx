import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GuardianUndoActions from '../GuardianUndoActions'

const m = vi.hoisted(() => ({ post: vi.fn(), showToast: vi.fn() }))
vi.mock('@/lib/api-client', () => ({ apiClient: { post: m.post } }))
vi.mock('@/components/Toast', () => ({ useToast: () => ({ showToast: m.showToast }) }))
vi.mock('@/components/ConfirmDialog', () => ({
  default: (props: { open: boolean; title?: string; message: string; confirmText: string; intent?: string; onConfirm: () => void; onCancel: () => void }) =>
    props.open ? (
      <div role="dialog" aria-label={props.title} data-intent={props.intent}>
        <p>{props.message}</p>
        <button onClick={props.onConfirm}>{props.confirmText}</button>
        <button onClick={props.onCancel}>Cancel</button>
      </div>
    ) : null,
}))

const FLAGGED_ID = '6f1c2b7e-9a4d-4c1e-8f3a-2b5d7e9c1a3f'

function renderActions(overrides: Partial<Parameters<typeof GuardianUndoActions>[0]> = {}) {
  const onUndone = vi.fn()
  const onFailed = vi.fn()
  render(
    <GuardianUndoActions
      flaggedId={FLAGGED_ID}
      actionTaken="flagged,deleted,timeout,banned"
      undo={null}
      userLabel="spammer"
      serverLabel="Test Server"
      onUndone={onUndone}
      onFailed={onFailed}
      {...overrides}
    />,
  )
  return { onUndone, onFailed }
}

beforeEach(() => { vi.resetAllMocks() })
afterEach(() => { cleanup() })

describe('GuardianUndoActions', () => {
  it('renders nothing for flag-only or delete-only rows', () => {
    renderActions({ actionTaken: 'flagged,deleted' })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows only the controls that match the actions taken', () => {
    renderActions({ actionTaken: 'flagged,timeout' })
    expect(screen.getByRole('button', { name: 'Remove timeout' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unban user' })).not.toBeInTheDocument()
  })

  it('shows the undone state instead of the button', () => {
    renderActions({ undo: { unban_at: '2026-10-19T10:00:00Z' } })
    expect(screen.getByText('Unbanned')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unban user' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove timeout' })).toBeInTheDocument()
  })

  it('does nothing when the confirmation is cancelled', () => {
    renderActions()
    fireEvent.click(screen.getByRole('button', { name: 'Unban user' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(m.post).not.toHaveBeenCalled()
  })

  it('unbans after a non-destructive confirmation and reports success', async () => {
    m.post.mockResolvedValueOnce({ data: { status: 'unbanned', message: 'User unbanned', undone_at: '2026-10-19T12:00:00Z' } })
    const { onUndone } = renderActions()

    fireEvent.click(screen.getByRole('button', { name: 'Unban user' }))
    const dialog = screen.getByRole('dialog', { name: 'Unban user?' })
    expect(dialog).toHaveAttribute('data-intent', 'primary')
    expect(dialog).toHaveTextContent('spammer on Test Server')
    fireEvent.click(screen.getByRole('button', { name: 'Unban' }))

    await waitFor(() => expect(onUndone).toHaveBeenCalledWith(FLAGGED_ID, 'unban', '2026-10-19T12:00:00Z'))
    expect(m.post).toHaveBeenCalledWith(`/api/guardian/flagged/${FLAGGED_ID}/unban`)
    expect(m.showToast).toHaveBeenCalledWith('User unbanned', 'success')
  })

  it('removes a timeout through the untimeout endpoint', async () => {
    m.post.mockResolvedValueOnce({ data: { status: 'timeout_removed', message: 'Timeout removed', undone_at: '2026-10-19T12:00:00Z' } })
    const { onUndone } = renderActions()

    fireEvent.click(screen.getByRole('button', { name: 'Remove timeout' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Remove timeout?' })).getByRole('button', { name: 'Remove timeout' }))

    await waitFor(() => expect(onUndone).toHaveBeenCalledWith(FLAGGED_ID, 'unmute', '2026-10-19T12:00:00Z'))
    expect(m.post).toHaveBeenCalledWith(`/api/guardian/flagged/${FLAGGED_ID}/untimeout`)
  })

  it('shows the server message on failure (e.g. global Ban list conflict) and keeps the button', async () => {
    m.post.mockRejectedValueOnce({
      response: { status: 409, data: { error: 'GUARDIAN_BAN_REGISTRY_ACTIVE', message: 'This user is on the global Ban list.' } },
    })
    const { onUndone, onFailed } = renderActions()

    fireEvent.click(screen.getByRole('button', { name: 'Unban user' }))
    fireEvent.click(screen.getByRole('button', { name: 'Unban' }))

    await waitFor(() => expect(m.showToast).toHaveBeenCalledWith('This user is on the global Ban list.', 'error'))
    expect(onFailed).toHaveBeenCalled()
    expect(onUndone).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Unban user' })).toBeEnabled()
  })
})
