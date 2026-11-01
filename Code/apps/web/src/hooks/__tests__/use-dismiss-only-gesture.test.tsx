import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { useDismissOnlyGesture } from '../use-dismiss-only-gesture'

function pointer(target: HTMLElement, type: string, pointerId = 1) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { pointerId, pointerType: 'touch' })
  fireEvent(target, event)
}

function Harness({ enabled = true, action, dismiss }: {
  enabled?: boolean
  action: () => void
  dismiss: () => void
}) {
  const [open, setOpen] = useState(true)
  useDismissOnlyGesture({
    enabled,
    dismissOutside: (target) => {
      if (!open || document.getElementById('popup')?.contains(target)) return false
      setOpen(false)
      dismiss()
      return true
    },
  })
  return <>
    {open && <div id="popup"><button onClick={action}>Inside</button></div>}
    <button onPointerDown={action} onClick={action}>Outside</button>
  </>
}

afterEach(cleanup)

describe('dismiss-only gesture', () => {
  it('consumes the entire outside gesture and its compatibility events, but permits the next tap', () => {
    const action = vi.fn()
    const dismiss = vi.fn()
    render(<Harness action={action} dismiss={dismiss} />)
    const outside = screen.getByText('Outside')
    pointer(outside, 'pointerdown')
    pointer(outside, 'pointermove')
    pointer(outside, 'pointerup')
    fireEvent.mouseDown(outside)
    fireEvent.mouseUp(outside)
    fireEvent.click(outside)
    expect(dismiss).toHaveBeenCalledOnce()
    expect(action).not.toHaveBeenCalled()
    pointer(outside, 'pointerdown')
    pointer(outside, 'pointerup')
    fireEvent.click(outside)
    expect(action).toHaveBeenCalledTimes(2)
  })

  it('permits popup controls without dismissing', () => {
    const action = vi.fn()
    const dismiss = vi.fn()
    render(<Harness action={action} dismiss={dismiss} />)
    const inside = screen.getByText('Inside')
    pointer(inside, 'pointerdown')
    pointer(inside, 'pointerup')
    fireEvent.click(inside)
    expect(action).toHaveBeenCalledOnce()
    expect(dismiss).not.toHaveBeenCalled()
  })

  it('does not consume desktop gestures when disabled', () => {
    const action = vi.fn()
    const dismiss = vi.fn()
    render(<Harness enabled={false} action={action} dismiss={dismiss} />)
    pointer(screen.getByText('Outside'), 'pointerdown')
    fireEvent.click(screen.getByText('Outside'))
    expect(action).toHaveBeenCalledTimes(2)
    expect(dismiss).not.toHaveBeenCalled()
  })

  it('consumes a long dismissal gesture until cancellation and cleans up on unmount', () => {
    const action = vi.fn()
    const view = render(<Harness action={action} dismiss={vi.fn()} />)
    const outside = screen.getByText('Outside')
    pointer(outside, 'pointerdown')
    const touchMove = new Event('touchmove', { bubbles: true, cancelable: true })
    fireEvent(outside, touchMove)
    expect(touchMove.defaultPrevented).toBe(true)
    pointer(outside, 'pointercancel')
    fireEvent.click(outside)
    expect(action).not.toHaveBeenCalled()
    view.unmount()
    const click = new Event('click', { bubbles: true, cancelable: true })
    document.body.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(false)
  })
})
