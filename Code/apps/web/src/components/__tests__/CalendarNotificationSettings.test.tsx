import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CalendarNotificationSettings from '../CalendarNotificationSettings'
import { isoToLocalInput, localInputToIso } from '../../lib/datetime-local'
import { apiClient } from '../../lib/api-client'

const showToast = vi.fn()

vi.mock('../../lib/api-client', () => ({
  apiClient: { get: vi.fn(), put: vi.fn() },
}))

vi.mock('../Toast', () => ({
  useToast: () => ({ showToast }),
}))

const defaults = {
  enabled: true,
  email: null,
  notifyFrom: null,
  defaultEmail: 'organiser@example.com',
  effectiveEmail: 'organiser@example.com',
}

describe('CalendarNotificationSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiClient.get).mockResolvedValue({ data: defaults })
  })

  const expand = async () => fireEvent.click(await screen.findByTestId('calendar-notification-settings-toggle'))

  it('starts collapsed with a working toggle and an on summary', async () => {
    render(<CalendarNotificationSettings calendarHash="abc123" />)

    const toggle = await screen.findByRole('switch', { name: 'Email me about participation changes' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(toggle).toBeEnabled()
    expect(screen.getByText('On - sending to organiser@example.com')).toBeInTheDocument()
    expect(screen.getByTestId('calendar-notification-settings-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByPlaceholderText('organiser@example.com')).not.toBeInTheDocument()
    expect(apiClient.get).toHaveBeenCalledWith('/api/calendars/abc123/notification-settings')
  })

  it('shows the email and start-time details when expanded', async () => {
    render(<CalendarNotificationSettings calendarHash="abc123" />)
    await expand()

    expect(screen.getByTestId('calendar-notification-settings-toggle')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByPlaceholderText('organiser@example.com')).toBeInTheDocument()
    expect(screen.getByLabelText(/Start notifying from/)).toBeInTheDocument()
  })

  it('turns notifications off from the collapsed header', async () => {
    vi.mocked(apiClient.put).mockResolvedValue({ data: { ...defaults, enabled: false } })
    render(<CalendarNotificationSettings calendarHash="abc123" />)

    fireEvent.click(await screen.findByRole('switch'))

    await waitFor(() => {
      expect(apiClient.put).toHaveBeenCalledWith('/api/calendars/abc123/notification-settings', {
        enabled: false, email: null, notifyFrom: null,
      })
    })
    expect(await screen.findByRole('switch')).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText('Off')).toBeInTheDocument()
    expect(screen.getByTestId('calendar-notification-settings-toggle')).toHaveAttribute('aria-expanded', 'false')
  })

  it('saves a custom email and notify-from time', async () => {
    vi.mocked(apiClient.put).mockImplementation(async (_url, body) => ({
      data: { ...defaults, email: (body as { email: string }).email, notifyFrom: (body as { notifyFrom: string }).notifyFrom },
    }))
    render(<CalendarNotificationSettings calendarHash="abc123" />)
    await expand()

    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText('organiser@example.com'), { target: { value: 'notify-inbox@example.com' } })
    fireEvent.change(screen.getByLabelText(/Start notifying from/), { target: { value: '2026-11-05T09:00' } })
    fireEvent.click(save)

    await waitFor(() => {
      expect(apiClient.put).toHaveBeenCalledWith('/api/calendars/abc123/notification-settings', {
        enabled: true,
        email: 'notify-inbox@example.com',
        notifyFrom: new Date('2026-11-05T09:00').toISOString(),
      })
    })
    expect(showToast).toHaveBeenCalledWith('Notification settings saved', 'success')
  })
  it('round-trips datetime-local values', () => {
    const iso = new Date('2026-11-05T09:30').toISOString()
    expect(isoToLocalInput(iso)).toBe('2026-11-05T09:30')
    expect(localInputToIso('')).toBeNull()
    expect(localInputToIso('2026-11-05T09:30')).toBe(iso)
  })
})
