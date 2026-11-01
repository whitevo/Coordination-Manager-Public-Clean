import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Switch } from '../Switch'

describe('Switch card', () => {
  it('uses one focusable switch for its label, description, track, and padding', () => {
    const onCheckedChange = vi.fn()
    render(
      <Switch variant="card" checked={false} onCheckedChange={onCheckedChange} label="Hidden mode" aria-describedby="description">
        <span>Hidden mode</span>
        <span id="description">Hide private content.</span>
      </Switch>
    )
    const control = screen.getByRole('switch', { name: 'Hidden mode' })
    expect(control).not.toBeChecked()
    expect(control).toHaveAccessibleDescription('Hide private content.')
    expect(within(control).queryByRole('button')).not.toBeInTheDocument()
    expect(control.querySelectorAll('button, input, [tabindex]')).toHaveLength(0)
    const track = control.querySelector('[aria-hidden="true"]')
    expect(track).not.toBeNull()
    if (!track) throw new Error('Expected a decorative switch track')

    for (const target of [screen.getByText('Hidden mode'), screen.getByText('Hide private content.'), track, control]) {
      onCheckedChange.mockClear()
      fireEvent.click(target)
      expect(onCheckedChange).toHaveBeenCalledExactlyOnceWith(true)
    }

    control.focus()
    expect(control).toHaveFocus()
  })

  it('reports the unchecked value when the card is on', () => {
    const onCheckedChange = vi.fn()
    render(<Switch variant="card" checked onCheckedChange={onCheckedChange} label="Hidden mode">Hidden mode</Switch>)
    const control = screen.getByRole('switch')
    expect(control).toBeChecked()
    fireEvent.click(control)
    expect(onCheckedChange).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('does not toggle a disabled card', () => {
    const onCheckedChange = vi.fn()
    render(<Switch variant="card" disabled checked={false} onCheckedChange={onCheckedChange} label="Hidden mode">Hidden mode</Switch>)
    fireEvent.click(screen.getByText('Hidden mode'))
    expect(onCheckedChange).not.toHaveBeenCalled()
  })

  it('supports warning cards without changing default switches', () => {
    const { rerender } = render(
      <Switch variant="card" cardTone="warning" checked onCheckedChange={vi.fn()} label="Hidden mode">Hidden mode</Switch>
    )
    const card = screen.getByRole('switch')
    expect(card).toHaveClass('border-warning-muted', 'bg-warning-subtle', 'hover:border-warning')
    expect(card.querySelector('[aria-hidden="true"]')).toHaveClass('bg-warning')
    expect(card.querySelector('.switch-card-trace')).toHaveClass('text-warning')
    rerender(<Switch checked onCheckedChange={vi.fn()} label="Other setting" />)
    expect(screen.getByRole('switch')).toHaveClass('bg-primary')
    expect(screen.getByRole('switch')).not.toHaveClass('switch-card')
  })
})
