import { useEffect, useRef } from 'react'

export function useDismissOnlyGesture({
  enabled,
  dismissOutside,
}: {
  enabled: boolean
  dismissOutside: (target: Node | null) => boolean
}) {
  const dismissRef = useRef(dismissOutside)
  dismissRef.current = dismissOutside

  useEffect(() => {
    if (!enabled) return
    let dismissedPointerId: number | null = null
    let suppressFollowUpUntil = 0

    const consume = (event: Event) => {
      if (event.cancelable) event.preventDefault()
      event.stopImmediatePropagation()
    }
    const targetNode = (event: Event) => event.target instanceof Node ? event.target : null
    const pointerDown = (event: PointerEvent) => {
      if (dismissedPointerId !== null) {
        consume(event)
        return
      }
      // A fresh gesture may act normally; only the dismissal's follow-up
      // mouse/click events are blocked after release.
      suppressFollowUpUntil = 0
      if (!dismissRef.current(targetNode(event))) return
      dismissedPointerId = event.pointerId
      suppressFollowUpUntil = Date.now() + 800
      consume(event)
    }
    const pointerMove = (event: PointerEvent) => {
      if (dismissedPointerId !== null) consume(event)
    }
    const pointerEnd = (event: PointerEvent) => {
      if (dismissedPointerId === null) return
      consume(event)
      if (event.pointerId !== dismissedPointerId) return
      dismissedPointerId = null
      suppressFollowUpUntil = Date.now() + 800
    }
    const mouseDown = (event: MouseEvent) => {
      if (dismissedPointerId !== null || Date.now() < suppressFollowUpUntil) {
        consume(event)
        return
      }
      if (!dismissRef.current(targetNode(event))) return
      suppressFollowUpUntil = Date.now() + 800
      consume(event)
    }
    const followUp = (event: Event) => {
      if (dismissedPointerId !== null || Date.now() < suppressFollowUpUntil) consume(event)
    }
    const reset = () => {
      dismissedPointerId = null
      suppressFollowUpUntil = 0
    }
    window.addEventListener('pointerdown', pointerDown, true)
    window.addEventListener('pointermove', pointerMove, true)
    window.addEventListener('pointerup', pointerEnd, true)
    window.addEventListener('pointercancel', pointerEnd, true)
    window.addEventListener('mousedown', mouseDown, true)
    window.addEventListener('mouseup', followUp, true)
    window.addEventListener('click', followUp, true)
    window.addEventListener('contextmenu', followUp, true)
    window.addEventListener('touchmove', followUp, { capture: true, passive: false })
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('pointerdown', pointerDown, true)
      window.removeEventListener('pointermove', pointerMove, true)
      window.removeEventListener('pointerup', pointerEnd, true)
      window.removeEventListener('pointercancel', pointerEnd, true)
      window.removeEventListener('mousedown', mouseDown, true)
      window.removeEventListener('mouseup', followUp, true)
      window.removeEventListener('click', followUp, true)
      window.removeEventListener('contextmenu', followUp, true)
      window.removeEventListener('touchmove', followUp, true)
      window.removeEventListener('blur', reset)
    }
  }, [enabled])
}
