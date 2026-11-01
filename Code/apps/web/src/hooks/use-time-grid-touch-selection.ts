import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { createTouchSelectGate, type TouchPressPoint } from '../lib/touch-select-gate'

export const TIME_GRID_TOUCH_HOLD_MS = 500

interface TouchGridSelectionOptions {
  onPlace?: (dayIndex: number, minute: number) => void
  onStart: (dayIndex: number, minute: number, point: TouchPressPoint) => boolean
  onMove: (dayIndex: number, anchorMinute: number, minute: number) => void
  onFinish: () => void
  onCancel: () => void
  autoScroll: (clientY: number) => boolean
}

export function useTimeGridTouchSelection(options: TouchGridSelectionOptions) {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const gateRef = useRef(createTouchSelectGate({ holdMs: TIME_GRID_TOUCH_HOLD_MS }))
  const cleanupRef = useRef<(() => void) | null>(null)
  const suppressMouseUntilRef = useRef(0)

  useEffect(() => () => {
    gateRef.current.dispose()
    cleanupRef.current?.()
  }, [])

  const onTouchPointerDown = (event: ReactPointerEvent<HTMLDivElement>, dayIndex: number) => {
    if (event.pointerType !== 'touch') return
    suppressMouseUntilRef.current = Date.now() + TIME_GRID_TOUCH_HOLD_MS + 800
    if (!event.isPrimary || gateRef.current.isEngaged()) return
    const column = event.currentTarget
    const point: TouchPressPoint = {
      pointerId: event.pointerId, pointerType: event.pointerType,
      clientX: event.clientX, clientY: event.clientY,
    }
    const minuteAt = (clientY: number) => {
      const rect = column.getBoundingClientRect()
      return ((clientY - rect.top) / rect.height) * 1440
    }
    const anchorMinute = minuteAt(point.clientY)
    const onPlace = optionsRef.current.onPlace
    let lastPoint = point
    let active = false
    let frameId: number | null = null

    const cleanup = () => {
      active = false
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      frameId = null
      if (column.hasPointerCapture?.(point.pointerId)) column.releasePointerCapture(point.pointerId)
      cleanupRef.current = null
      suppressMouseUntilRef.current = Date.now() + 800
    }
    const update = () => {
      optionsRef.current.onMove(dayIndex, anchorMinute, minuteAt(lastPoint.clientY))
    }
    const scrollFrame = () => {
      frameId = null
      if (!active) return
      if (optionsRef.current.autoScroll(lastPoint.clientY)) update()
      frameId = window.requestAnimationFrame(scrollFrame)
    }

    gateRef.current.pressStart(point, {
      onActivate: () => {
        if (onPlace) return
        active = optionsRef.current.onStart(dayIndex, anchorMinute, point)
        if (!active) {
          gateRef.current.dispose()
          return
        }
        column.setPointerCapture?.(point.pointerId)
        frameId = window.requestAnimationFrame(scrollFrame)
      },
      onTap: () => {
        if (onPlace) {
          cleanup()
          onPlace(dayIndex, anchorMinute)
          return
        }
        const started = optionsRef.current.onStart(dayIndex, anchorMinute, point)
        cleanup()
        if (started) optionsRef.current.onFinish()
      },
      onMove: (nextPoint) => {
        if (!active) return
        lastPoint = nextPoint
        update()
      },
      onEnd: () => {
        const wasActive = active
        cleanup()
        if (onPlace) {
          onPlace(dayIndex, anchorMinute)
          return
        }
        if (wasActive) optionsRef.current.onFinish()
      },
      onCancel: () => {
        const wasActive = active
        cleanup()
        if (wasActive) optionsRef.current.onCancel()
      },
    })
    cleanupRef.current = cleanup
  }

  return {
    onTouchPointerDown,
    suppressCompatibilityMouse: () => gateRef.current.isEngaged() || Date.now() < suppressMouseUntilRef.current,
  }
}
