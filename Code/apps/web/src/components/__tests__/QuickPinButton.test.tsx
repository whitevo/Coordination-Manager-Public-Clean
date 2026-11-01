import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Link, MemoryRouter, useLocation } from 'react-router-dom'
import QuickPinButton from '../QuickPinButton'

function CurrentPath() {
  const location = useLocation()
  return <output data-testid="current-path">{location.pathname}</output>
}

describe('QuickPinButton', () => {
  it('toggles the quick tool without following its enclosing navigation link', () => {
    const onToggle = vi.fn()

    render(
      <MemoryRouter initialEntries={['/calendar']}>
        <Link to="/distribute?tab=templates">
          <QuickPinButton pinned={false} onToggle={onToggle} label="Distribute Templates" />
        </Link>
        <CurrentPath />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add Distribute Templates quick button' }))

    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('current-path')).toHaveTextContent('/calendar')
  })
})