import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import GoogleSyncStatus from '../google-sync-status'

const { get, post, put } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }))
vi.mock('../../lib/api-client', () => ({ apiClient: { get, post, put } }))

const link = {
  sourceId: 'src-1',
  googleEmail: 'me@example.com',
  htmlLink: 'https://calendar.google.com/event?eid=1',
  keepInSync: false,
  state: 'changed_on_google' as const,
  changedFields: ['title'],
  lastPushedAt: null,
  lastPushError: null,
}

describe('GoogleSyncStatus', () => {
  beforeEach(() => {
    get.mockReset(); post.mockReset(); put.mockReset()
  })

  it('renders nothing for items that were never exported', async () => {
    get.mockResolvedValue({ data: { links: [] } })
    const { container } = render(<GoogleSyncStatus eventId="evt-1" />)
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/google-sync/user-events/evt-1/status'))
    expect(container).toBeEmptyDOMElement()
  })

  it('shows Google-side edits and pushes on request', async () => {
    get.mockResolvedValue({ data: { links: [link] } })
    post.mockResolvedValue({ data: { links: [{ ...link, state: 'in_sync', changedFields: [] }] } })
    render(<GoogleSyncStatus eventId="evt-1" />)

    expect(await screen.findByText('Changed in Google (title)')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Update Google copy'))
    expect(await screen.findByText('In sync')).toBeInTheDocument()
    expect(post).toHaveBeenCalledWith('/api/google-sync/user-events/evt-1/push')
  })

  it('toggles keep-in-sync for the item', async () => {
    get.mockResolvedValue({ data: { links: [link] } })
    put.mockResolvedValue({ data: { updated: 1 } })
    render(<GoogleSyncStatus eventId="evt-1" />)

    fireEvent.click(await screen.findByLabelText('Keep Google copy in sync'))
    expect(put).toHaveBeenCalledWith('/api/google-sync/user-events/evt-1/keep-in-sync', { keepInSync: true })
  })
})
