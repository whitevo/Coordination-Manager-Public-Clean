import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Button } from '../Button'
import { IconButton } from '../IconButton'
import { ToggleButton } from '../ToggleButton'
import { SegmentedControl } from '../SegmentedControl'
import { Disclosure } from '../Disclosure'
import { BUTTON_INTENT_CLASS, TOGGLE_PRESSED_CLASS } from '../../../lib/design-tokens'

const STATUS_INTENTS = ['success', 'info', 'warning'] as const

describe('status-bearing intents', () => {
  it.each(STATUS_INTENTS)('%s covers every emphasis with its own semantic tokens', intent => {
    expect(BUTTON_INTENT_CLASS.solid[intent]).toContain(`bg-${intent} text-${intent}-foreground`)
    expect(BUTTON_INTENT_CLASS.outline[intent]).toContain(`border-${intent}-muted bg-${intent}-subtle text-${intent}`)
    expect(BUTTON_INTENT_CLASS.outline[intent]).toContain(`hover:bg-${intent}-muted`)
    expect(BUTTON_INTENT_CLASS.ghost[intent]).toContain(`text-${intent} hover:bg-${intent}-subtle`)
  })

  it.each(STATUS_INTENTS)('Button renders %s for solid, outline and ghost', intent => {
    const { unmount } = render(
      <>
        <Button intent={intent}>Solid</Button>
        <Button intent={intent} emphasis="outline">Outline</Button>
        <Button intent={intent} emphasis="ghost">Ghost</Button>
      </>
    )
    expect(screen.getByRole('button', { name: 'Solid' })).toHaveClass(`bg-${intent}`, `text-${intent}-foreground`)
    expect(screen.getByRole('button', { name: 'Outline' })).toHaveClass(`bg-${intent}-subtle`, `border-${intent}-muted`)
    expect(screen.getByRole('button', { name: 'Ghost' })).toHaveClass(`text-${intent}`)
    unmount()
  })

  it('IconButton accepts a status intent', () => {
    render(<IconButton label="Link exists" intent="success" icon={<svg />} />)
    expect(screen.getByRole('button', { name: 'Link exists' })).toHaveClass('text-success', 'hover:bg-success-subtle')
  })

  it('never uses raw palette classes', () => {
    for (const emphasis of Object.values(BUTTON_INTENT_CLASS)) {
      for (const classes of Object.values(emphasis)) {
        expect(classes).not.toMatch(/-(blue|green|emerald|indigo|rose|red|amber|yellow|sky)-\d/)
      }
    }
  })
})

describe('micro size', () => {
  it('Button micro is h-6 text-xs with tight padding and a 24px minimum width', () => {
    render(<Button size="micro">Clear</Button>)
    expect(screen.getByRole('button')).toHaveClass('h-6', 'min-w-6', 'px-1.5', 'text-xs')
  })

  it('Button micro spinner uses the 3.5 icon size', () => {
    render(<Button size="micro" loading>Clear</Button>)
    expect(screen.getByRole('button').querySelector('svg')).toHaveClass('h-3.5', 'w-3.5')
  })

  it('IconButton micro is h-6 w-6 with a 3.5 icon', () => {
    render(<IconButton label="Clear search" size="micro" icon={<svg />} />)
    const button = screen.getByRole('button', { name: 'Clear search' })
    expect(button).toHaveClass('h-6', 'w-6', '[&>svg]:h-3.5', '[&>svg]:w-3.5')
  })

  it('ToggleButton micro uses the shared micro geometry', () => {
    render(
      <ToggleButton size="micro" pressed={false} onPressedChange={() => {}}>
        Mon
      </ToggleButton>
    )
    expect(screen.getByRole('button')).toHaveClass('h-6', 'text-xs')
  })

  it('existing sizes keep their exact classes', () => {
    render(
      <>
        <Button size="compact">C</Button>
        <Button>S</Button>
      </>
    )
    expect(screen.getByRole('button', { name: 'C' })).toHaveClass('h-8', 'gap-1.5', 'px-2.5', 'text-xs')
    expect(screen.getByRole('button', { name: 'S' })).toHaveClass('h-10', 'gap-2', 'px-3', 'text-sm')
  })
})

describe('IconButton icon sizing', () => {
  it('puts icon size on the svg, not on the button', () => {
    render(
      <>
        <IconButton label="Compact" icon={<svg />} />
        <IconButton label="Standard" size="standard" icon={<svg />} />
      </>
    )
    const compact = screen.getByRole('button', { name: 'Compact' })
    expect(compact).toHaveClass('h-8', 'w-8', '[&>svg]:h-4', '[&>svg]:w-4')
    expect(compact).not.toHaveClass('h-3.5')
    expect(compact).not.toHaveClass('w-3.5')
    const standard = screen.getByRole('button', { name: 'Standard' })
    expect(standard).toHaveClass('h-10', 'w-10', '[&>svg]:h-4', '[&>svg]:w-4')
    expect(standard).not.toHaveClass('h-4')
  })
})

describe('ToggleButton intent', () => {
  it('defaults the pressed tint to the theme primary', () => {
    render(
      <ToggleButton pressed onPressedChange={() => {}}>
        Bold
      </ToggleButton>
    )
    const button = screen.getByRole('button', { name: 'Bold' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button).toHaveClass('border-primary-muted', 'bg-primary-subtle', 'text-primary')
  })

  it('tints the pressed state with the intent', () => {
    render(
      <ToggleButton intent="warning" pressed onPressedChange={() => {}}>
        Conflicts only
      </ToggleButton>
    )
    expect(screen.getByRole('button')).toHaveClass('border-warning-muted', 'bg-warning-subtle', 'text-warning')
  })

  it('keeps the unpressed state neutral whatever the intent', () => {
    render(
      <ToggleButton intent="danger" pressed={false} onPressedChange={() => {}}>
        Flagged
      </ToggleButton>
    )
    const button = screen.getByRole('button')
    expect(button).toHaveClass('border-border', 'bg-background')
    expect(button.className).not.toMatch(/danger/)
  })

  it('has a pressed recipe for every intent', () => {
    expect(Object.keys(TOGGLE_PRESSED_CLASS).sort()).toEqual(Object.keys(BUTTON_INTENT_CLASS.solid).sort())
  })
})

describe('SegmentedControl options', () => {
  function Harness({ onChange }: { onChange: (value: string) => void }) {
    const [value, setValue] = useState('day')
    return (
      <SegmentedControl
        label="Range"
        value={value}
        onChange={next => {
          setValue(next)
          onChange(next)
        }}
        options={[
          { value: 'day', label: 'Day', testId: 'range-day' },
          { value: 'week', label: 'Week', disabled: true, title: 'Unavailable' },
          { value: 'month', label: 'Month' },
          { value: 'year', label: 'Year', disabled: true },
        ]}
      />
    )
  }

  it('renders per-option disabled, title and data-testid', () => {
    render(<Harness onChange={() => {}} />)
    expect(screen.getByTestId('range-day')).toHaveAttribute('role', 'radio')
    const week = screen.getByRole('radio', { name: 'Week' })
    expect(week).toBeDisabled()
    expect(week).toHaveAttribute('title', 'Unavailable')
    expect(screen.getByRole('radio', { name: 'Month' })).toBeEnabled()
  })

  it('skips disabled options in arrow-key navigation and wraps', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const day = screen.getByRole('radio', { name: 'Day' })
    const month = screen.getByRole('radio', { name: 'Month' })
    day.focus()

    fireEvent.keyDown(day, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('month')
    expect(month).toHaveFocus()
    expect(month).toBeChecked()

    fireEvent.keyDown(month, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('day')
    expect(day).toHaveFocus()

    fireEvent.keyDown(day, { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith('month')

    fireEvent.keyDown(month, { key: 'Home' })
    expect(onChange).toHaveBeenLastCalledWith('day')
    fireEvent.keyDown(day, { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith('month')
    expect(onChange).not.toHaveBeenCalledWith('week')
    expect(onChange).not.toHaveBeenCalledWith('year')
  })

  it('ignores unrelated keys', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Day' }), { key: 'a' })
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('Disclosure', () => {
  it('wires aria-expanded and aria-controls to the rendered panel', () => {
    render(
      <Disclosure title="Participants" description="People in this calendar" trailing={<span>3</span>} defaultExpanded>
        <p>Alice</p>
      </Disclosure>
    )
    const button = screen.getByRole('button', { name: /Participants/ })
    expect(button).toHaveAttribute('aria-expanded', 'true')
    const panel = screen.getByRole('region')
    expect(button).toHaveAttribute('aria-controls', panel.id)
    expect(panel).toHaveAttribute('aria-labelledby', button.id)
    expect(panel).toHaveTextContent('Alice')
    expect(button).toHaveTextContent('People in this calendar')
    expect(button.querySelector('svg:last-child')).toHaveClass('rotate-180')
  })

  it('toggles uncontrolled from the keyboard-focusable native button', () => {
    const onToggle = vi.fn()
    render(
      <Disclosure title="Archived" onToggle={onToggle}>
        <p>Old calendar</p>
      </Disclosure>
    )
    const button = screen.getByRole('button', { name: 'Archived' })
    expect(button.tagName).toBe('BUTTON')
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Old calendar')).not.toBeInTheDocument()

    button.focus()
    expect(button).toHaveFocus()
    // jsdom does not synthesise the click a browser fires for Enter/Space on a
    // native button, so dispatch the key and then that activation click.
    fireEvent.keyDown(button, { key: 'Enter' })
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(onToggle).toHaveBeenLastCalledWith(true)
    expect(screen.getByText('Old calendar')).toBeInTheDocument()

    fireEvent.keyDown(button, { key: ' ' })
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(onToggle).toHaveBeenLastCalledWith(false)
  })

  it('follows the controlled expanded prop', () => {
    function Controlled() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <Disclosure title="Syncs" expanded={open} onToggle={setOpen} panelId="sync-panel" />
          {open && <div id="sync-panel">External panel</div>}
        </>
      )
    }
    render(<Controlled />)
    const button = screen.getByRole('button', { name: 'Syncs' })
    expect(button).toHaveAttribute('aria-controls', 'sync-panel')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('External panel')).toBeInTheDocument()
  })

  it('stays closed when controlled and the parent ignores the toggle', () => {
    const onToggle = vi.fn()
    render(<Disclosure title="Locked" expanded={false} onToggle={onToggle} />)
    const button = screen.getByRole('button', { name: 'Locked' })
    fireEvent.click(button)
    expect(onToggle).toHaveBeenCalledWith(true)
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('sits inside a heading when headingLevel is set', () => {
    render(<Disclosure title="Public calendars" headingLevel={2} size="section" testId="public-toggle" />)
    const heading = screen.getByRole('heading', { level: 2, name: 'Public calendars' })
    expect(heading).toContainElement(screen.getByTestId('public-toggle'))
    expect(screen.getByTestId('public-toggle')).toHaveClass('text-lg', 'font-semibold', 'w-full')
  })
})
