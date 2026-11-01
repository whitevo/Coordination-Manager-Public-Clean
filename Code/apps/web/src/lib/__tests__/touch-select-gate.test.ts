import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import { createTouchSelectGate, TOUCH_SELECT_HOLD_MS, TOUCH_SELECT_SLOP_PX } from '../touch-select-gate'
import type { TouchPressPoint, TouchSelectGate } from '../touch-select-gate'

const press = (overrides: Partial<TouchPressPoint> = {}): TouchPressPoint => ({
  pointerId: 1,
  pointerType: 'touch',
  clientX: 100,
  clientY: 100,
  ...overrides,
})

const firePointer = (type: string, init: { pointerId?: number; clientX?: number; clientY?: number } = {}) => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, {
    pointerId: init.pointerId ?? 1,
    clientX: init.clientX ?? 100,
    clientY: init.clientY ?? 100,
  })
  window.dispatchEvent(event)
}

describe('createTouchSelectGate', () => {
  let gate: TouchSelectGate
  let onActivate: Mock<() => void>
  let onTap: Mock<() => void>

  beforeEach(() => {
    vi.useFakeTimers()
    onActivate = vi.fn()
    onTap = vi.fn()
    gate = createTouchSelectGate()
  })

  afterEach(() => {
    gate.dispose()
    vi.useRealTimers()
  })

  it('fires onTap for a quick stationary press released before the threshold', () => {
    gate.pressStart(press(), { onActivate, onTap })
    vi.advanceTimersByTime(TOUCH_SELECT_HOLD_MS - 100)
    firePointer('pointerup')
    expect(onTap).toHaveBeenCalledTimes(1)
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('fires onActivate when the hold threshold is reached, and no tap on release', () => {
    gate.pressStart(press(), { onActivate, onTap })
    expect(gate.isEngaged()).toBe(true)
    vi.advanceTimersByTime(TOUCH_SELECT_HOLD_MS)
    expect(onActivate).toHaveBeenCalledTimes(1)
    firePointer('pointerup')
    expect(onTap).not.toHaveBeenCalled()
    expect(gate.isEngaged()).toBe(false)
  })

  it('cancels selection when the finger moves past the slop before the threshold (scroll wins)', () => {
    gate.pressStart(press(), { onActivate, onTap })
    firePointer('pointermove', { clientX: 100 + TOUCH_SELECT_SLOP_PX + 20, clientY: 100 })
    vi.advanceTimersByTime(TOUCH_SELECT_HOLD_MS + 100)
    firePointer('pointerup')
    expect(onActivate).not.toHaveBeenCalled()
    expect(onTap).not.toHaveBeenCalled()
    expect(gate.isEngaged()).toBe(false)
  })

  it('still activates when the finger wiggles within the slop', () => {
    gate.pressStart(press(), { onActivate, onTap })
    firePointer('pointermove', { clientX: 105, clientY: 103 })
    vi.advanceTimersByTime(TOUCH_SELECT_HOLD_MS)
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('ignores mouse pointers entirely', () => {
    gate.pressStart(press({ pointerType: 'mouse' }), { onActivate, onTap })
    expect(gate.isEngaged()).toBe(false)
    vi.advanceTimersByTime(TOUCH_SELECT_HOLD_MS * 4)
    firePointer('pointerup')
    expect(onActivate).not.toHaveBeenCalled()
    expect(onTap).not.toHaveBeenCalled()
  })

  it('cancels when a second finger touches (pinch intent)', () => {
    gate.pressStart(press(), { onActivate, onTap })
    firePointer('pointerdown', { pointerId: 2 })
    vi.advanceTimersByTime(TOUCH_SELECT_HOLD_MS + 100)
    firePointer('pointerup')
    expect(onActivate).not.toHaveBeenCalled()
    expect(onTap).not.toHaveBeenCalled()
  })

  it('does not fire onTap after pointercancel', () => {
    gate.pressStart(press(), { onActivate, onTap })
    vi.advanceTimersByTime(TOUCH_SELECT_HOLD_MS - 100)
    firePointer('pointercancel')
    expect(onTap).not.toHaveBeenCalled()
    expect(gate.isEngaged()).toBe(false)
  })

  it('ignores pointer events from a different pointer id', () => {
    gate.pressStart(press(), { onActivate, onTap })
    firePointer('pointerup', { pointerId: 99 })
    expect(gate.isEngaged()).toBe(true)
    vi.advanceTimersByTime(TOUCH_SELECT_HOLD_MS)
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('can gate a new press after the previous one settles', () => {
    gate.pressStart(press(), { onActivate, onTap })
    vi.advanceTimersByTime(TOUCH_SELECT_HOLD_MS - 100)
    firePointer('pointerup')
    expect(onTap).toHaveBeenCalledTimes(1)

    gate.pressStart(press(), { onActivate, onTap })
    vi.advanceTimersByTime(TOUCH_SELECT_HOLD_MS)
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('supports a caller-specific 1-second threshold without changing the shared default', () => {
    gate.dispose()
    gate = createTouchSelectGate({ holdMs: 1000 })
    gate.pressStart(press(), { onActivate, onTap })
    vi.advanceTimersByTime(999)
    expect(onActivate).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onActivate).toHaveBeenCalledOnce()
    expect(TOUCH_SELECT_HOLD_MS).toBe(400)
  })

  it('allows native touch scrolling while pending and blocks it only after activation', () => {
    gate.pressStart(press(), { onActivate, onTap })
    const pendingMove = new Event('touchmove', { cancelable: true })
    document.dispatchEvent(pendingMove)
    expect(pendingMove.defaultPrevented).toBe(false)
    vi.advanceTimersByTime(TOUCH_SELECT_HOLD_MS)
    const activeMove = new Event('touchmove', { cancelable: true })
    document.dispatchEvent(activeMove)
    expect(activeMove.defaultPrevented).toBe(true)
    firePointer('pointerup')
    const releasedMove = new Event('touchmove', { cancelable: true })
    document.dispatchEvent(releasedMove)
    expect(releasedMove.defaultPrevented).toBe(false)
  })

  it('reports active pointer movement and finishes only the tracked pointer', () => {
    const onMove = vi.fn()
    const onEnd = vi.fn()
    gate.pressStart(press(), { onActivate, onTap, onMove, onEnd })
    vi.advanceTimersByTime(TOUCH_SELECT_HOLD_MS)
    firePointer('pointermove', { pointerId: 99, clientY: 200 })
    expect(onMove).not.toHaveBeenCalled()
    firePointer('pointermove', { clientY: 200 })
    expect(onMove).toHaveBeenCalledOnce()
    firePointer('pointerup')
    expect(onEnd).toHaveBeenCalledOnce()
    expect(onTap).not.toHaveBeenCalled()
  })

  it.each(['pointercancel', 'blur', 'dispose'])('notifies cancellation and detaches scroll blocking on %s', (reason) => {
    const onCancel = vi.fn()
    const onEnd = vi.fn()
    gate.pressStart(press(), { onActivate, onTap, onCancel, onEnd })
    vi.advanceTimersByTime(TOUCH_SELECT_HOLD_MS)
    if (reason === 'dispose') gate.dispose()
    else if (reason === 'blur') window.dispatchEvent(new Event('blur'))
    else firePointer('pointercancel')
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onEnd).not.toHaveBeenCalled()
    const move = new Event('touchmove', { cancelable: true })
    document.dispatchEvent(move)
    expect(move.defaultPrevented).toBe(false)
  })
})
