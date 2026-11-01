import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import {
  installDefaultApiMocks,
  installEditorDomPolyfills,
  mockDedupedGet,
  mockUseAuth,
} from './time-management-test-harness'
import TimeManagementPage from '../TimeManagementPage'

const SEED_PERIOD = {
  id: 'bg-sleep',
  label: 'Sleep',
  startMinute: 60,
  endMinute: 480,
  color: '#334455',
  opacity: 0.35,
}

function installModesWithBackgroundPeriod() {
  mockDedupedGet.mockImplementation(async (url: string) => {
    if (url === '/api/calendar-sources') return { data: { sources: [] } }
    if (url === '/api/time-management/modes') {
      return {
        data: {
          activeModeId: 'mode-main',
          modes: [
            {
              id: 'mode-main',
              name: 'Main',
              main_color: '#2563eb',
              slot_minutes: 30,
              sync_calendars: [{ id: 'coord-main', enabled: true }],
              time_backgrounds: [SEED_PERIOD],
              collapsed_background_ids: [],
              quick_templates: [],
              show_quick_templates_in_main: false,
            },
          ],
        },
      }
    }
    if (url === '/api/time-management/categories') return { data: { categories: [] } }
    if (url === '/api/user-events') return { data: { events: [] } }
    return { data: {} }
  })
}

function renderPage() {
  return render(
    <MemoryRouter>
      <TimeManagementPage />
    </MemoryRouter>
  )
}

async function openBackgroundPeriodsSection() {
  renderPage()
  await screen.findByRole('heading', { name: 'Time Management' })
  fireEvent.click(await screen.findByRole('button', { name: 'Time Width and background' }))
  await screen.findByText('Recurring background periods')
}

describe('Time Management - Recurring background period time picker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    mockUseAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      isTraveler: false,
    })
    installDefaultApiMocks()
    installModesWithBackgroundPeriod()
    installEditorDomPolyfills()
  })

  it('closes the start time picker as soon as an hour is chosen and applies it', async () => {
    await openBackgroundPeriodsSection()

    const trigger = screen.getByRole('button', { name: 'Open start time picker' })
    fireEvent.click(trigger)
    expect(screen.getByRole('group', { name: 'Choose start time (UTC)' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Select start hour 09' }))

    expect(screen.queryByRole('group', { name: 'Choose start time (UTC)' })).not.toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveFocus()
    expect(screen.getByText('09:00-08:00 UTC')).toBeInTheDocument()
  })

  it('closes the start time picker as soon as a minute is chosen and applies it', async () => {
    await openBackgroundPeriodsSection()

    fireEvent.click(screen.getByRole('button', { name: 'Open start time picker' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select start minute 30' }))

    expect(screen.queryByRole('group', { name: 'Choose start time (UTC)' })).not.toBeInTheDocument()
    expect(screen.getByText('01:30-08:00 UTC')).toBeInTheDocument()
  })

  it('closes the end time picker on selection too', async () => {
    await openBackgroundPeriodsSection()

    fireEvent.click(screen.getByRole('button', { name: 'Open end time picker' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select end hour 22' }))

    expect(screen.queryByRole('group', { name: 'Choose end time (UTC)' })).not.toBeInTheDocument()
    expect(screen.getByText('01:00-22:00 UTC')).toBeInTheDocument()
  })

  it('commits a typed HH:mm value and resets an invalid draft on blur', async () => {
    await openBackgroundPeriodsSection()

    const input = screen.getByLabelText('Start') as HTMLInputElement
    fireEvent.change(input, { target: { value: '07:45' } })
    expect(screen.getByText('07:45-08:00 UTC')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: '99:99' } })
    fireEvent.blur(input)
    expect(input.value).toBe('07:45')
    expect(screen.getByText('07:45-08:00 UTC')).toBeInTheDocument()
  })
})
