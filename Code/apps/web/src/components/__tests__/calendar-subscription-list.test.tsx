import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CalendarSubscriptionList from '../calendar-subscription-list'
import type { ComponentProps } from 'react'

type Props = ComponentProps<typeof CalendarSubscriptionList>
const title = 'Strategic Governance Feedback from Jerome Glenn'
const subscription = {
  id: 'sub-1', calendar_id: 'cal-1', created_at: '2026-06-01T00:00:00Z',
  calendars: { id: 'cal-1', hash: 'publicHash', title, visibility: 'public' },
}

function props(overrides: Partial<Props> = {}): Props {
  return {
    subscriptions: [subscription], meetings: [],
    subscriptionsLoading: false, subscriptionsError: false,
    meetingsLoading: false, meetingsError: false,
    pendingHashes: new Set(), timezone: 'UTC',
    onUnsubscribe: vi.fn().mockResolvedValue(undefined), onRetry: vi.fn(),
    ...overrides,
  }
}

function renderList(overrides: Partial<Props> = {}) {
  const values = props(overrides)
  const result = render(
    <MemoryRouter>
      <CalendarSubscriptionList {...values} />
    </MemoryRouter>,
  )
  return { ...result, values }
}

describe('CalendarSubscriptionList', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-10T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('renders a table with full titles and separate accessible actions', () => {
    const { values } = renderList()
    expect(within(screen.getByRole('table')).getByText(title)).toBeVisible()
    expect(screen.getByRole('link', { name: `Open calendar ${title}` })).toHaveAttribute('href', '/calendar/publicHash')
    fireEvent.click(screen.getByRole('button', { name: `Unsubscribe from ${title}` }))
    expect(values.onUnsubscribe).toHaveBeenCalledWith('publicHash')
    expect(screen.getByLabelText('No completed meetings')).toHaveTextContent('-')
    expect(screen.getByLabelText('0 upcoming meetings')).toHaveTextContent('0')
    expect(screen.getByLabelText('0 upcoming meetings')).toHaveClass('text-muted-foreground')
    expect(screen.queryByRole('columnheader', { name: 'Next' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: `Open calendar ${title}` })).toHaveTextContent(title)
    expect(screen.getByRole('button', { name: `Unsubscribe from ${title}` })).toHaveTextContent('')
  })

  it('finds last completed date and counts future meetings only for this calendar', () => {
    renderList({ meetings: [
      { calendar_id: 'cal-1', start_time: '2026-06-15T14:00:00Z', end_time: '2026-06-15T15:00:00Z' },
      { calendar_id: 'other', start_time: '2026-06-10T13:00:00Z', end_time: '2026-06-10T14:00:00Z' },
      { calendar_id: 'cal-1', start_time: '2026-06-08T10:00:00Z', end_time: '2026-06-08T11:00:00Z' },
      { calendar_id: 'cal-1', start_time: '2026-06-11T14:00:00Z', end_time: '2026-06-11T15:00:00Z' },
      { calendar_id: 'cal-1', start_time: '2026-06-09T10:00:00Z', end_time: '2026-06-09T11:00:00Z' },
    ] })
    expect(screen.getByText('9 Jun 2026')).toBeVisible()
    expect(screen.getByLabelText('2 upcoming meetings')).toHaveTextContent('2')
    expect(screen.getByLabelText('2 upcoming meetings')).toHaveClass('bg-success-subtle', 'text-success')
    expect(screen.queryByText(/AM|PM/)).not.toBeInTheDocument()
  })

  it('uses the selected timezone, includes the year, and updates an ongoing meeting when it ends', () => {
    renderList({ timezone: 'America/New_York', meetings: [
      { calendar_id: 'cal-1', start_time: '2026-06-10T11:30:00Z', end_time: '2026-06-10T12:01:00Z' },
    ] })
    expect(screen.getByText('Dates in America/New_York')).toBeVisible()
    expect(screen.getByText('Meeting in progress')).toBeVisible()
    expect(screen.getByLabelText('0 upcoming meetings')).toBeVisible()
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(screen.queryByText('Meeting in progress')).not.toBeInTheDocument()
    expect(screen.getByText('10 Jun 2026')).toBeVisible()
  })

  it('formats date-only values on the correct day in the selected timezone', () => {
    renderList({ timezone: 'America/New_York', meetings: [
      { calendar_id: 'cal-1', start_time: '2026-06-10T00:30:00Z', end_time: '2026-06-10T01:30:00Z' },
    ] })
    expect(screen.getByText('9 Jun 2026')).toBeVisible()
    expect(screen.queryByText('10 Jun 2026')).not.toBeInTheDocument()
  })

  it('updates the upcoming count as a meeting starts without counting an ongoing meeting', () => {
    renderList({ meetings: [
      { calendar_id: 'cal-1', start_time: '2026-06-10T12:01:00Z', end_time: '2026-06-10T13:00:00Z' },
    ] })
    expect(screen.getByLabelText('1 upcoming meetings')).toHaveClass('text-success')
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(screen.getByLabelText('0 upcoming meetings')).toHaveClass('text-muted-foreground')
    expect(screen.getByText('Meeting in progress')).toBeVisible()
  })

  it('keeps rows visible while loading timing and disables pending unsubscribe', () => {
    renderList({ meetingsLoading: true, pendingHashes: new Set(['publicHash']) })
    expect(screen.getByText(title)).toBeVisible()
    expect(screen.getByText('Loading meeting timing...')).toBeVisible()
    expect(screen.getByRole('button', { name: `Unsubscribe from ${title}` })).toBeDisabled()
    expect(screen.queryByLabelText('No completed meetings')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('0 upcoming meetings')).not.toBeInTheDocument()
  })

  it('surfaces failed timing reads without claiming there are no meetings and offers retry', () => {
    const { values } = renderList({ meetingsError: true })
    expect(screen.getByRole('alert')).toHaveTextContent('Meeting timing is unavailable.')
    expect(screen.getByText('Meeting timing unavailable.')).toBeVisible()
    expect(screen.queryByLabelText('No completed meetings')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('0 upcoming meetings')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(values.onRetry).toHaveBeenCalledOnce()
  })

  it('distinguishes initial loading, failed subscriptions, and an empty successful list', () => {
    const { rerender } = renderList({ subscriptions: [], subscriptionsLoading: true })
    expect(screen.getByRole('status')).toHaveTextContent('Loading subscriptions...')
    rerender(<CalendarSubscriptionList {...props({ subscriptions: [], subscriptionsError: true })} />)
    expect(screen.getByRole('status')).toHaveTextContent('Subscriptions unavailable.')
    rerender(<CalendarSubscriptionList {...props({ subscriptions: [] })} />)
    expect(screen.getByRole('status')).toHaveTextContent('You are not subscribed')
  })

  it('handles unavailable calendars without invalid navigation or mutation actions', () => {
    renderList({ subscriptions: [{ ...subscription, calendars: null }] })
    expect(screen.getByText('Calendar details unavailable.')).toBeVisible()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('reports invalid meeting dates instead of presenting false timing', () => {
    renderList({ meetings: [{ calendar_id: 'cal-1', start_time: 'invalid', end_time: 'invalid' }] })
    expect(screen.getByText('Meeting timing unavailable: invalid dates.')).toBeVisible()
    expect(screen.queryByLabelText('No completed meetings')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('0 upcoming meetings')).not.toBeInTheDocument()
  })
})
