import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import TimezoneSelector from '../TimezoneSelector'
import { useTimezones, STORAGE_KEY, type TimezoneState } from '../../lib/use-timezones'
import { detectLocalTimezone, findTimezone, formatTimezoneShort } from '../../lib/timezone-data'

interface HarnessProps {
  initialState?: TimezoneState
  compact?: boolean
  iconOnly?: boolean
}

function Harness({ initialState = { primary: 'UTC', additional: [] }, ...props }: HarnessProps) {
  const timezones = useTimezones(undefined, { initialState })
  return <TimezoneSelector timezones={timezones} {...props} />
}

function label(iana: string) {
  const entry = findTimezone(iana)
  if (!entry) throw new Error(`Missing timezone fixture: ${iana}`)
  return formatTimezoneShort(entry)
}

function openSettings() {
  const trigger = screen.getByRole('button', { name: /^(Timezone:|Change timezone)/ })
  trigger.focus()
  fireEvent.click(trigger)
  return trigger
}

function chooseCity(city: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Search timezones' }), {
    target: { value: city },
  })
  fireEvent.click(screen.getByRole('button', { name: new RegExp(city) }))
}

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('Timezone settings popup', () => {
  it.each([
    { compact: false, iconOnly: false },
    { compact: true, iconOnly: false },
    { compact: true, iconOnly: true },
  ])('portals settings outside the header for variant %j', (props) => {
    const { container } = render(<Harness {...props} />)
    expect(screen.queryByText('Primary')).not.toBeInTheDocument()
    const trigger = openSettings()
    const dialog = screen.getByRole('dialog', { name: 'Timezone settings' })
    expect(container).not.toContainElement(dialog)
    expect(container).not.toHaveTextContent('Primary')
    expect(within(dialog).getByText('Primary')).toBeVisible()
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('changes primary timezone in the same dialog and preserves preferences', async () => {
    render(<Harness />)
    openSettings()
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: label('UTC') }))
    expect(screen.getByRole('dialog', { name: 'Change Primary Timezone' })).toBe(dialog)
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('textbox', { name: 'Search timezones' })).toHaveFocus()
    chooseCity('Tallinn')
    expect(screen.getByRole('dialog', { name: 'Timezone settings' })).toBe(dialog)
    const primary = within(dialog).getByRole('button', { name: label('Europe/Tallinn') })
    await waitFor(() => expect(primary).toHaveFocus())
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual({
      primary: 'Europe/Tallinn',
      additional: [],
    })
  })

  it('adds, replaces and removes additional timezones without closing settings', () => {
    render(<Harness />)
    openSettings()
    const dialog = screen.getByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: /Add Timezone/ }))
    chooseCity('Tallinn')
    fireEvent.click(within(dialog).getByRole('button', { name: label('Europe/Tallinn') }))
    expect(dialog).toHaveAccessibleName('Change Timezone')
    chooseCity('Tokyo')
    expect(
      within(dialog).queryByRole('button', { name: label('Europe/Tallinn') })
    ).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: label('Asia/Tokyo') })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Remove timezone' }))
    expect(dialog).toHaveAccessibleName('Timezone settings')
    expect(screen.queryByText('Display 2')).not.toBeInTheDocument()
  })

  it('returns with Back without changing data and resets search on reopening', async () => {
    render(<Harness />)
    openSettings()
    fireEvent.click(screen.getByRole('button', { name: /Add Timezone/ }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Tallinn' } })
    fireEvent.click(screen.getByRole('button', { name: 'Back to timezone settings' }))
    const add = screen.getByRole('button', { name: /Add Timezone/ })
    await waitFor(() => expect(add).toHaveFocus())
    expect(screen.queryByText('Display 2')).not.toBeInTheDocument()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    fireEvent.click(add)
    expect(screen.getByRole('textbox')).toHaveValue('')
  })

  it('applies the browser timezone then returns to settings', () => {
    render(<Harness />)
    openSettings()
    fireEvent.click(screen.getByRole('button', { name: label('UTC') }))
    fireEvent.click(screen.getByRole('button', { name: /Apply browser timezone/ }))
    const dialog = screen.getByRole('dialog', { name: 'Timezone settings' })
    expect(within(dialog).getByRole('button', { name: label(detectLocalTimezone()) })).toBeVisible()
  })

  it('enforces the existing display limit and restores focus when Add disappears', async () => {
    render(
      <Harness
        initialState={{
          primary: 'UTC',
          additional: ['Europe/Tallinn', 'Europe/London', 'America/New_York'],
        }}
      />
    )
    openSettings()
    fireEvent.click(screen.getByRole('button', { name: /Add Timezone/ }))
    chooseCity('Tokyo')
    expect(screen.queryByRole('button', { name: /Add Timezone/ })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: label('UTC') })).toHaveFocus())
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove timezone' })[0])
    expect(screen.getByRole('button', { name: /Add Timezone/ })).toBeVisible()
  })

  it('closes the entire popup with Escape from search and reopens at settings', () => {
    render(<Harness />)
    const trigger = openSettings()
    fireEvent.click(screen.getByRole('button', { name: /Add Timezone/ }))
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Timezone settings' })).toBeVisible()
  })

  it('supports grouping, clearing and empty search results inside the popup', () => {
    render(<Harness />)
    openSettings()
    fireEvent.click(screen.getByRole('button', { name: /Add Timezone/ }))
    fireEvent.click(screen.getByRole('radio', { name: /Country/ }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'not-a-real-timezone' } })
    expect(screen.getByText(/No timezones found/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getByRole('textbox')).toHaveValue('')
    expect(screen.getByRole('button', { name: /Apply browser timezone/ })).toBeVisible()
  })
})
