import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Button } from '../Button'
import { IconButton } from '../IconButton'
import { Switch } from '../Switch'
import { SegmentedControl } from '../SegmentedControl'
import { StatusBadge } from '../StatusBadge'
import { CountBadge } from '../CountBadge'
import { Dialog } from '../Dialog'
import { BUTTON_INTENT_CLASS, STATUS_TONE_CLASS } from '../../../lib/design-tokens'

describe('Button', () => {
  it('defaults to neutral so primary has to be asked for', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button')).toHaveClass('bg-muted')
  })

  it('exposes no hue-named intent', () => {
    expect(Object.keys(BUTTON_INTENT_CLASS.solid)).toEqual([
      'primary',
      'neutral',
      'danger',
      'success',
      'info',
      'warning',
    ])
    for (const emphasis of Object.values(BUTTON_INTENT_CLASS)) {
      for (const key of Object.keys(emphasis)) {
        expect(key).not.toMatch(/blue|green|emerald|indigo|rose|red|amber|yellow|sky/)
      }
    }
  })

  it('resolves primary through the theme token, never a palette colour', () => {
    render(<Button intent="primary">Continue</Button>)
    const button = screen.getByRole('button')
    expect(button).toHaveClass('bg-primary')
    expect(button.className).not.toMatch(/bg-(blue|green|emerald|indigo|rose)-/)
  })

  it('blocks interaction and marks busy while loading', () => {
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>
    )
    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('IconButton', () => {
  it('always has an accessible name', () => {
    render(<IconButton label="Dismiss notice" icon={<span />} />)
    expect(screen.getByRole('button', { name: 'Dismiss notice' })).toBeInTheDocument()
  })
})

describe('Switch', () => {
  it('uses the switch role with a checked state', () => {
    render(<Switch checked onCheckedChange={() => {}} label="Email notifications" />)
    expect(screen.getByRole('switch', { name: 'Email notifications' })).toBeChecked()
  })

  it('renders off as neutral rather than an error colour', () => {
    render(<Switch checked={false} onCheckedChange={() => {}} label="Email notifications" />)
    const control = screen.getByRole('switch')
    expect(control).toHaveClass('bg-neutral-muted')
    expect(control.className).not.toMatch(/rose|red|danger/)
  })

  it('reports the next value on toggle', () => {
    const onCheckedChange = vi.fn()
    render(<Switch checked={false} onCheckedChange={onCheckedChange} label="Email" />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })
})

describe('SegmentedControl', () => {
  it('keeps every option visible and reachable', () => {
    render(
      <SegmentedControl
        label="Sort mode"
        value="sort"
        onChange={() => {}}
        options={[
          { value: 'sort', label: 'Sort' },
          { value: 'only', label: 'Only' },
          { value: 'hide', label: 'Hide' },
        ]}
      />
    )
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByRole('radio', { name: 'Sort' })).toBeChecked()
  })
})

describe('StatusBadge', () => {
  it('maps every tone to an explicit literal class', () => {
    for (const classes of Object.values(STATUS_TONE_CLASS)) {
      expect(classes).not.toContain('${')
    }
  })

  it('shows the domain label while using the normalized tone', () => {
    render(<StatusBadge tone="neutral">Opted out</StatusBadge>)
    const badge = screen.getByText('Opted out')
    expect(badge).toHaveClass('bg-neutral-subtle')
    expect(badge.className).not.toMatch(/danger/)
  })
})

describe('CountBadge', () => {
  it('has no state colour, because a count is not a state', () => {
    render(<CountBadge count={5} label="flagged messages" />)
    const badge = screen.getByLabelText('5 flagged messages')
    expect(badge.className).not.toMatch(/danger|success|warning/)
  })

  it('caps the displayed value', () => {
    render(<CountBadge count={250} max={99} />)
    expect(screen.getByText('99+')).toBeInTheDocument()
  })
})

describe('Dialog', () => {
  it('closes only when the pointer press and release both happen on the scrim', () => {
    vi.stubGlobal('PointerEvent', MouseEvent)
    try {
      const onClose = vi.fn()
      const view = render(<Dialog open title="Rename" onClose={onClose}><input aria-label="Network name" /></Dialog>)
      const dialog = screen.getByRole('dialog', { name: 'Rename' })
      const scrim = dialog.parentElement!
      const input = screen.getByRole('textbox', { name: 'Network name' })
      fireEvent.pointerDown(input, { button: 0 })
      fireEvent.pointerUp(scrim, { button: 0 })
      fireEvent.click(scrim)
      expect(onClose).not.toHaveBeenCalled()
      fireEvent.pointerDown(scrim, { button: 0 })
      fireEvent.pointerUp(input, { button: 0 })
      fireEvent.click(scrim)
      expect(onClose).not.toHaveBeenCalled()
      fireEvent.pointerDown(scrim, { button: 0 })
      fireEvent.pointerCancel(scrim)
      fireEvent.pointerUp(scrim, { button: 0 })
      fireEvent.click(scrim)
      expect(onClose).not.toHaveBeenCalled()
      fireEvent.pointerDown(scrim, { button: 0 })
      fireEvent.pointerUp(scrim, { button: 0 })
      fireEvent.click(scrim)
      expect(onClose).toHaveBeenCalledOnce()
      onClose.mockClear()
      view.rerender(<Dialog open title="Rename" onClose={onClose} closeOnScrimClick={false}><input aria-label="Network name" /></Dialog>)
      fireEvent.pointerDown(scrim, { button: 0 })
      fireEvent.pointerUp(scrim, { button: 0 })
      fireEvent.click(scrim)
      expect(onClose).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('inerts the app, focuses its first action, and restores the app state on close', async () => {
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.appendChild(appRoot)
    const onClose = vi.fn()
    const view = render(
      <Dialog
        open
        onClose={onClose}
        title="Confirm action"
        actions={<Button>Continue</Button>}
      />
    )

    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toHaveFocus())
    expect(appRoot).toHaveAttribute('aria-hidden', 'true')
    expect(appRoot.inert).toBe(true)

    view.rerender(<Dialog open={false} onClose={onClose} title="Confirm action" />)
    await waitFor(() => expect(appRoot.inert).toBe(false))
    expect(appRoot).not.toHaveAttribute('aria-hidden')
    appRoot.remove()
  })

  it('renders a named close button, focuses it for read-only content, and closes on Escape', async () => {
    const onClose = vi.fn()
    const view = render(
      <Dialog open onClose={onClose} title="Event details" showCloseButton closeLabel="Close details" size="lg">
        <button type="button">Delete event</button>
      </Dialog>
    )

    const close = await screen.findByRole('button', { name: 'Close details' })
    await waitFor(() => expect(close).toHaveFocus())
    expect(screen.getByRole('dialog', { name: 'Event details' })).toHaveClass('max-w-lg')

    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(close, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
    view.unmount()
  })

  it('focuses the first form field instead of header chrome', async () => {
    const view = render(
      <Dialog open onClose={vi.fn()} title="Create event" showCloseButton headerActions={<button type="button">Pin</button>}>
        <input aria-label="Title" />
      </Dialog>
    )

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Title' })).toHaveFocus())
    view.unmount()
  })

  it('can ignore scrim clicks while still honouring Escape, and renders a free-form footer', async () => {
    const onClose = vi.fn()
    const view = render(
      <Dialog
        open
        onClose={onClose}
        title="Publish events"
        closeOnScrimClick={false}
        scrollBody
        footer={<button type="button">Publish 2 events</button>}
      >
        <p>List</p>
      </Dialog>
    )

    const dialog = await screen.findByRole('dialog', { name: 'Publish events' })
    const scrim = dialog.parentElement as HTMLElement
    fireEvent.click(scrim)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Publish 2 events' })).toBeInTheDocument()

    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it('returns focus to the trigger on close', async () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    const view = render(
      <Dialog open onClose={vi.fn()} title="Mode JSON">
        <input aria-label="Draft" />
      </Dialog>
    )
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveFocus())

    view.rerender(
      <Dialog open={false} onClose={vi.fn()} title="Mode JSON">
        <input aria-label="Draft" />
      </Dialog>
    )
    await waitFor(() => expect(trigger).toHaveFocus())
    view.unmount()
    trigger.remove()
  })
})
