import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GuardianBanList from '../GuardianBanList'

const m = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/lib/api-client', () => ({ apiClient: { post: m.post }, dedupedGet: m.get }))
vi.mock('@/components/ConfirmDialog', () => ({
  default: (props: { open: boolean; message: string; confirmText: string; onConfirm: () => void; onCancel: () => void }) =>
    props.open ? <div role="dialog"><p>{props.message}</p><button onClick={props.onConfirm}>{props.confirmText}</button><button onClick={props.onCancel}>Cancel</button></div> : null,
}))
const TARGET = '223456789012345678'
const EXISTING = '323456789012345678'
const PREVIEW = 'preview-id'
let reviewStatus = 'ready'
let registered = false
beforeEach(() => {
  vi.resetAllMocks()
  reviewStatus = 'ready'
  registered = false
  m.get.mockImplementation(async (url: string) => ({
    data: url.includes('/preview/') ? {
      id: PREVIEW, status: reviewStatus, expired: false, error: null, checked: 6, checks_total: 6, servers: 3,
      confirmation_requested: ['confirming', 'confirmed'].includes(reviewStatus),
      rows: [
        { discord_user_id: TARGET, member_servers: reviewStatus === 'ready' ? 2 : null, already_registered: registered },
        { discord_user_id: EXISTING, member_servers: reviewStatus === 'ready' ? 0 : null, already_registered: true },
      ],
    } : {
      entries: [{ discord_user_id: EXISTING, created_at: '2026-10-05T08:00:00Z', boot_count: 3, last_booted_at: '2026-10-05T08:00:00Z' }], total: 1, failures: [],
    },
  }))
  m.post.mockImplementation(async (url: string) => {
    if (url.endsWith('/preview')) return { data: { preview_id: PREVIEW } }
    reviewStatus = 'confirmed'
    registered = true
    return { data: { added: 1 } }
  })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })
async function ready() {
  render(<GuardianBanList />)
  await screen.findByText('2026-10-05 08:00:00')
}
async function readyClock() {
  vi.useFakeTimers()
  await act(async () => { render(<GuardianBanList />) })
  expect(screen.getByText('2026-10-05 08:00:00')).toBeInTheDocument()
}
async function submitReview() {
  fireEvent.change(screen.getByLabelText('Discord IDs'), { target: { value: `${TARGET}, ${TARGET}\n${EXISTING}` } })
  fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }))
  await screen.findByRole('table', { name: 'Submitted IDs membership and registry review' })
}
describe('Global three-step Ban List', () => {
  it('renders three steps and a global dashboard with only the requested columns', async () => {
    await ready()
    expect(screen.getByRole('heading', { name: '1. Enter Discord IDs' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '2. Review and confirm' })).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'All registered Discord IDs' })
    expect(within(table).getAllByRole('columnheader').map(header => header.textContent))
      .toEqual(['Select', 'Discord ID', 'Date added (UTC)', 'Times booted', 'Last booted'])
    expect(screen.queryByLabelText(/Reason/)).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: `Select ${EXISTING}` })).toBeInTheDocument()
    expect(screen.queryByText('Disable registry entry')).not.toBeInTheDocument()
  })
  it('submits a persistent review but does not confirm or ban before consent', async () => {
    await ready()
    await submitReview()
    expect(m.post).toHaveBeenCalledExactlyOnceWith('/api/guardian/ban-list/preview', { discord_ids: `${TARGET}, ${TARGET}\n${EXISTING}` })
    expect(screen.getByText(/2 unique IDs; 1 duplicates removed/)).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Submitted IDs membership and registry review' })
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent(`${TARGET}2No`)
    expect(within(table).getAllByRole('row')[2]).toHaveTextContent(`${EXISTING}0Yes`)
  })
  it('confirms new IDs everywhere using only the server-owned preview', async () => {
    await ready()
    await submitReview()
    fireEvent.click(screen.getByRole('button', { name: 'Update Ban Registry and execute bans' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('1 new IDs')
    expect(screen.getByRole('dialog')).toHaveTextContent('all 3 current Demon X servers')
    expect(screen.getByRole('dialog')).toHaveTextContent('future servers')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm global bans' }))
    await waitFor(() => expect(m.post).toHaveBeenCalledWith('/api/guardian/ban-list/confirm', { preview_id: PREVIEW, confirmed: true }))
    await screen.findByText(/Registry updated. Global bans queued/)
    expect(screen.queryByRole('table', { name: 'Submitted IDs membership and registry review' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Discord IDs')).toHaveValue('')
    expect(screen.getByText('Submit IDs above to check membership and the global registry.')).toBeInTheDocument()
    reviewStatus = 'ready'
    await submitReview()
    expect(screen.queryByText(/Registry updated. Global bans queued/)).not.toBeInTheDocument()
  })
  it('reconciles asynchronous confirmation, resets the working dashboard, and dismisses the completion notice', async () => {
    await readyClock()
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Discord IDs'), { target: { value: TARGET } })
      fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }))
    })
    m.post.mockImplementationOnce(async () => { reviewStatus = 'confirming'; return { data: { confirmation_requested: true } } })
    fireEvent.click(screen.getByRole('button', { name: 'Update Ban Registry and execute bans' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm global bans' })) })
    expect(screen.getByText(/Rechecking all server permissions/)).toBeInTheDocument()
    expect(screen.queryByText(/Confirmation requested/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeDisabled()
    reviewStatus = 'confirmed'
    registered = true
    const reads = m.get.mock.calls.length
    await act(async () => { vi.advanceTimersByTime(119_999) })
    expect(m.get).toHaveBeenCalledTimes(reads)
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(screen.getByText(/Registry updated. Global bans queued/)).toBeInTheDocument()
    expect(screen.queryByText(/Rechecking all server permissions/)).not.toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Submitted IDs membership and registry review' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Discord IDs')).toHaveValue('')
    expect(m.get.mock.calls.slice(reads).map(([url]) => url)).toEqual([
      `/api/guardian/ban-list/preview/${PREVIEW}`, '/api/guardian/ban-list/entries?offset=0',
    ])
    await act(async () => { vi.advanceTimersByTime(10_000) })
    expect(screen.queryByText(/Registry updated. Global bans queued/)).not.toBeInTheDocument()
  })
  it('replaces confirmation progress with failure while retaining IDs for retry', async () => {
    await ready()
    await submitReview()
    m.post.mockImplementationOnce(async () => { reviewStatus = 'confirming'; return { data: {} } })
    fireEvent.click(screen.getByRole('button', { name: 'Update Ban Registry and execute bans' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm global bans' }))
    await screen.findByText(/Rechecking all server permissions/)
    reviewStatus = 'failed'
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await screen.findByText(/Review failed/)
    expect(screen.queryByText(/Rechecking all server permissions/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Registry updated/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Discord IDs')).toHaveValue(`${TARGET}, ${TARGET}\n${EXISTING}`)
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeEnabled()
  })
  it('canceling confirmation does not mutate the registry', async () => {
    await ready()
    await submitReview()
    fireEvent.click(screen.getByRole('button', { name: 'Update Ban Registry and execute bans' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(m.post).toHaveBeenCalledTimes(1)
  })
  it('blocks malformed IDs and oversized submissions without requiring notes', async () => {
    await ready()
    fireEvent.change(screen.getByLabelText('Discord IDs'), { target: { value: 'bad' } })
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid IDs')
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Discord IDs'), { target: { value: Array(1001).fill(TARGET).join(' ') } })
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeDisabled()
    expect(m.post).not.toHaveBeenCalled()
  })
  it('shows incomplete membership as unverified and disables confirmation', async () => {
    reviewStatus = 'processing'
    await ready()
    await submitReview()
    expect(screen.getAllByText('Not yet verified')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Update Ban Registry and execute bans' })).toBeDisabled()
  })
  it('disables confirmation when every ID is already registered', async () => {
    registered = true
    await ready()
    await submitReview()
    expect(screen.getByRole('button', { name: 'Update Ban Registry and execute bans' })).toBeDisabled()
  })
  it('never announces success after failed confirmation', async () => {
    await ready()
    await submitReview()
    m.post.mockRejectedValueOnce({ response: { data: { message: 'Permission revoked' } } })
    fireEvent.click(screen.getByRole('button', { name: 'Update Ban Registry and execute bans' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm global bans' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Permission revoked')
    expect(screen.queryByText(/new Discord IDs added/)).not.toBeInTheDocument()
  })
  it('does not present failed registry reads as a successful empty result', async () => {
    m.get.mockRejectedValue(new Error('Registry migration has not been applied'))
    render(<GuardianBanList />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Registry migration has not been applied')
    expect(screen.queryByText('No global registry entries on this page.')).not.toBeInTheDocument()
  })
  it('preserves a completed review when a refresh fails and blocks confirmation', async () => {
    await ready()
    await submitReview()
    const original = m.get.getMockImplementation()
    m.get.mockImplementation(async url => {
      if (url.includes('/preview/')) throw new Error('Preview refresh failed')
      return original?.(url)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Preview refresh failed')
    expect(screen.getByRole('table', { name: 'Submitted IDs membership and registry review' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update Ban Registry and execute bans' })).toBeDisabled()
  })
    it('automatically reads no faster than every two minutes, without inserting a loading line', async () => {
      await readyClock()
      const initial = m.get.mock.calls.length
      await act(async () => { vi.advanceTimersByTime(119_999) })
      expect(m.get).toHaveBeenCalledTimes(initial)
      await act(async () => { vi.advanceTimersByTime(1) })
      expect(m.get).toHaveBeenCalledTimes(initial + 1)
      expect(screen.queryByText('Loading global registry...')).not.toBeInTheDocument()
      expect(screen.getByText('2026-10-05 08:00:00')).toBeInTheDocument()
    })
    it('does not automatically fetch while hidden and stops fetching after tab unmount', async () => {
      await readyClock()
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
      const initial = m.get.mock.calls.length
      await act(async () => { vi.advanceTimersByTime(240_000) })
      expect(m.get).toHaveBeenCalledTimes(initial)
      cleanup()
      await act(async () => { vi.advanceTimersByTime(240_000) })
      expect(m.get).toHaveBeenCalledTimes(initial)
    })
    it.each(['confirmed', 'failed'])('stops polling %s previews while continuing two-minute registry reads', async status => {
      reviewStatus = status
      await readyClock()
      await act(async () => {
        fireEvent.change(screen.getByLabelText('Discord IDs'), { target: { value: TARGET } })
        fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }))
      })
      const reads = m.get.mock.calls.filter(([url]) => url.includes('/preview/')).length
      await act(async () => { vi.advanceTimersByTime(240_000) })
      expect(m.get.mock.calls.filter(([url]) => url.includes('/preview/'))).toHaveLength(reads)
    })
    it('keeps pending preview reads on the same two-minute schedule', async () => {
      reviewStatus = 'processing'
      await readyClock()
      await act(async () => {
        fireEvent.change(screen.getByLabelText('Discord IDs'), { target: { value: TARGET } })
        fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }))
      })
      const reads = m.get.mock.calls.filter(([url]) => url.includes('/preview/')).length
      await act(async () => { vi.advanceTimersByTime(119_999) })
      expect(m.get.mock.calls.filter(([url]) => url.includes('/preview/'))).toHaveLength(reads)
      await act(async () => { vi.advanceTimersByTime(1) })
      expect(m.get.mock.calls.filter(([url]) => url.includes('/preview/'))).toHaveLength(reads + 1)
    })
    it('refreshes manually before two minutes and preserves rows and selection while loading', async () => {
      await ready()
      fireEvent.click(screen.getByRole('checkbox', { name: `Select ${EXISTING}` }))
      let resolveRead: (value: unknown) => void = () => { throw new Error('Refresh not started') }
      m.get.mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve }))
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh' })) })
      expect(screen.queryByText('Loading global registry...')).not.toBeInTheDocument()
      expect(screen.getByText('2026-10-05 08:00:00')).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: `Select ${EXISTING}` })).toBeChecked()
      await act(async () => resolveRead({ data: { entries: [{ discord_user_id: EXISTING, created_at: '2026-10-05T08:00:00Z', boot_count: 3, last_booted_at: null }], total: 1, failures: [] } }))
      expect(screen.getByRole('checkbox', { name: `Select ${EXISTING}` })).toBeChecked()
    })
    it('updates elapsed seconds locally without network requests', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-10-05T08:00:01Z'))
      await act(async () => { render(<GuardianBanList />) })
      expect(screen.getByText('1 second ago')).toBeInTheDocument()
      const reads = m.get.mock.calls.length
      await act(async () => { vi.advanceTimersByTime(1000) })
      expect(screen.getByText('2 seconds ago')).toBeInTheDocument()
      expect(m.get).toHaveBeenCalledTimes(reads)
    })
    it('supports selection and explicit global removal/unban confirmation', async () => {
      await ready()
      fireEvent.click(screen.getByRole('checkbox', { name: `Select ${EXISTING}` }))
      fireEvent.click(screen.getByRole('button', { name: 'Remove and unban selected (1)' }))
      expect(m.post).not.toHaveBeenCalled()
      expect(screen.getByRole('dialog')).toHaveTextContent(EXISTING)
      expect(screen.getByRole('dialog')).toHaveTextContent('all connected servers')
      m.post.mockResolvedValueOnce({ data: { removed: 1 } })
      fireEvent.click(screen.getByRole('button', { name: 'Remove and unban' }))
      await waitFor(() => expect(m.post).toHaveBeenCalledWith('/api/guardian/ban-list/remove', { discord_ids: EXISTING, confirmed: true }))
      await screen.findByText(/1 IDs removed from Guardian enforcement/)
    })
    it('preserves selection and reports failed removals without success', async () => {
      await ready()
      fireEvent.click(screen.getByRole('checkbox', { name: `Select ${EXISTING}` }))
      fireEvent.click(screen.getByRole('button', { name: 'Remove and unban selected (1)' }))
      m.post.mockRejectedValueOnce(new Error('Removal failed'))
      fireEvent.click(screen.getByRole('button', { name: 'Remove and unban' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Removal failed')
      expect(screen.getByRole('checkbox', { name: `Select ${EXISTING}` })).toBeChecked()
      expect(screen.queryByText(/IDs removed from Guardian enforcement/)).not.toBeInTheDocument()
    })
    it('filters by pasted IDs and selects all matching IDs including other pages', async () => {
      await ready()
      fireEvent.click(screen.getByRole('button', { name: 'Filter IDs' }))
      fireEvent.change(screen.getByLabelText('Filter Discord IDs'), { target: { value: `${EXISTING}, ${TARGET}` } })
      m.post.mockResolvedValueOnce({ data: {
        entries: [{ discord_user_id: EXISTING, created_at: '2026-10-05T08:00:00Z', boot_count: 0, last_booted_at: null }], total: 2, failures: [],
      } })
      fireEvent.click(screen.getByRole('button', { name: 'Apply ID filter' }))
      await screen.findByText('Never')
      expect(m.post).toHaveBeenCalledWith('/api/guardian/ban-list/search', { discord_ids: `${EXISTING} ${TARGET}`, offset: '0' })
      m.post.mockResolvedValueOnce({ data: { ids: [EXISTING, TARGET] } })
      fireEvent.click(screen.getByRole('button', { name: 'Select all matching' }))
      await screen.findByRole('button', { name: 'Remove and unban selected (2)' })
      expect(m.post).toHaveBeenCalledWith('/api/guardian/ban-list/matching-ids', { discord_ids: `${EXISTING} ${TARGET}` })
    })
})
