/**
 * Long-press gate for touch-based grid selection.
 *
 * Touch selection on a scrollable grid must not start on pointerdown: a quick
 * touch usually means "scroll", not "paint cells". This gate delays selection
 * until the finger has held still for TOUCH_SELECT_HOLD_MS.
 *
 * - Release before the threshold without moving -> onTap (single cell toggle)
 * - Move past TOUCH_SELECT_SLOP_PX before the threshold -> cancelled, the
 *   browser keeps the gesture as a native scroll
 * - Hold reaches the threshold -> onActivate (drag-select mode); a non-passive
 *   touchmove blocker then stops the browser from stealing the gesture back,
 *   so the grid's custom edge auto-scroll can take over
 *
 * Framework-free so calendar grids can share it. Mouse and pen pointers
 * are ignored -- callers keep their existing immediate pointerdown behavior.
 */

export const TOUCH_SELECT_HOLD_MS = 400
export const TOUCH_SELECT_SLOP_PX = 10

export interface TouchPressPoint {
  pointerId: number
  pointerType: string
  clientX: number
  clientY: number
}

export interface TouchSelectGateHandlers {
  /** Hold threshold reached -- enter drag-select mode. */
  onActivate: () => void
  /** Released before the threshold without scrolling -- single tap. */
  onTap: () => void
  onMove?: (point: TouchPressPoint) => void
  onEnd?: () => void
  onCancel?: () => void
}

type GateState = 'idle' | 'pending' | 'active'

export interface TouchSelectGate {
  /** Begin tracking a touch press. No-op for non-touch pointers. */
  pressStart: (point: TouchPressPoint, handlers: TouchSelectGateHandlers) => void
  /** True while a touch press is pending or has activated select mode. */
  isEngaged: () => boolean
  /** Detach all listeners (unmount safety). */
  dispose: () => void
}

export function createTouchSelectGate(options: { holdMs?: number; slopPx?: number } = {}): TouchSelectGate {
  const holdMs = options.holdMs ?? TOUCH_SELECT_HOLD_MS
  const slopPx = options.slopPx ?? TOUCH_SELECT_SLOP_PX

  let state: GateState = 'idle'
  let trackedPointerId: number | null = null
  let startX = 0
  let startY = 0
  let holdTimer: ReturnType<typeof setTimeout> | null = null
  let handlers: TouchSelectGateHandlers | null = null

  const preventDefault = (event: Event) => {
    event.preventDefault()
  }
  const blockActiveScroll = (event: Event) => {
    if (state === 'active') event.preventDefault()
  }

  function handlePointerMove(event: PointerEvent) {
    if (event.pointerId !== trackedPointerId) return
    if (state === 'active') {
      handlers?.onMove?.(event)
      return
    }
    if (state !== 'pending') return
    const dx = event.clientX - startX
    const dy = event.clientY - startY
    // Finger moved before the hold elapsed: scroll wins, selection cancels.
    if (dx * dx + dy * dy > slopPx * slopPx) cancel()
  }

  function handleExtraPointerDown(event: PointerEvent) {
    if (event.pointerId === trackedPointerId) return
    // Second finger means pinch/zoom intent -- bail out of selection.
    cancel()
  }

  function handlePointerRelease(event: PointerEvent) {
    if (event.pointerId !== trackedPointerId) return
    const wasPending = state === 'pending'
    const wasActive = state === 'active'
    const settledHandlers = handlers
    reset()
    // Callers can finish active drags here or use their own pointerup handlers.
    if (wasPending && event.type === 'pointerup') settledHandlers?.onTap()
    if (wasPending && event.type === 'pointercancel') settledHandlers?.onCancel?.()
    if (wasActive) {
      if (event.type === 'pointerup') settledHandlers?.onEnd?.()
      else settledHandlers?.onCancel?.()
    }
  }

  function cancel() {
    const settledHandlers = handlers
    reset()
    settledHandlers?.onCancel?.()
  }

  const detachGestureListeners = () => {
    window.removeEventListener('pointermove', handlePointerMove, true)
    window.removeEventListener('pointerup', handlePointerRelease, true)
    window.removeEventListener('pointercancel', handlePointerRelease, true)
    window.removeEventListener('pointerdown', handleExtraPointerDown, true)
    document.removeEventListener('touchmove', blockActiveScroll)
    document.removeEventListener('contextmenu', preventDefault)
    window.removeEventListener('blur', cancel)
  }

  const clearHoldTimer = () => {
    if (holdTimer !== null) {
      clearTimeout(holdTimer)
      holdTimer = null
    }
  }

  function reset() {
    clearHoldTimer()
    detachGestureListeners()
    state = 'idle'
    trackedPointerId = null
    handlers = null
  }

  const activate = () => {
    if (state !== 'pending') return
    state = 'active'
    // Block native scrolling for the rest of the drag; the grid's custom
    // edge auto-scroll handles viewport movement during selection.
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(15)
    }
    handlers?.onActivate()
  }

  const pressStart = (point: TouchPressPoint, nextHandlers: TouchSelectGateHandlers) => {
    if (point.pointerType !== 'touch' || state !== 'idle') return
    state = 'pending'
    trackedPointerId = point.pointerId
    startX = point.clientX
    startY = point.clientY
    handlers = nextHandlers
    window.addEventListener('pointermove', handlePointerMove, true)
    window.addEventListener('pointerup', handlePointerRelease, true)
    window.addEventListener('pointercancel', handlePointerRelease, true)
    window.addEventListener('pointerdown', handleExtraPointerDown, true)
    window.addEventListener('blur', cancel)
    // Register before the first movement so Safari can cancel native panning
    // once the hold activates, without disabling ordinary swipe scrolling.
    document.addEventListener('touchmove', blockActiveScroll, { passive: false })
    // Suppress the Android long-press context menu while the gate decides.
    document.addEventListener('contextmenu', preventDefault)
    holdTimer = setTimeout(activate, holdMs)
  }

  return {
    pressStart,
    isEngaged: () => state !== 'idle',
    dispose: cancel,
  }
}
