import { useRef, useCallback, useEffect, useState } from 'react'

interface DualThumbSliderProps {
  min: number
  max: number
  startValue: number
  endValue: number
  onStartChange: (value: number) => void
  onEndChange: (value: number) => void
  onStartRelease: () => void
  onEndRelease: () => void
  /** Minimum gap between start and end (default: 1) */
  minGap?: number
  /** 'horizontal' for mobile, 'vertical' for desktop sidebar */
  orientation?: 'horizontal' | 'vertical'
  /** Label for start thumb */
  startLabel?: string
  /** Label for end thumb */
  endLabel?: string
  className?: string
}

interface SliderDrag {
  thumb: 'start' | 'end'
  pointerId: number
  element: HTMLElement
  rect: DOMRect
  offset: number
  start: number
  end: number
  pushed: boolean
}

export default function DualThumbSlider({
  min,
  max,
  startValue,
  endValue,
  onStartChange,
  onEndChange,
  onStartRelease,
  onEndRelease,
  minGap = 1,
  orientation = 'horizontal',
  startLabel,
  endLabel,
  className = '',
}: DualThumbSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef<SliderDrag | null>(null)
  const suppressClickRef = useRef(false)
  const [dragPosition, setDragPosition] = useState<{ thumb: 'start' | 'end'; value: number } | null>(null)
  const [hoveredThumb, setHoveredThumb] = useState<'start' | 'end' | null>(null)

  const totalRange = max - min

  // Convert a value to a percentage position on the track
  const valueToPercent = useCallback(
    (value: number) => ((value - min) / totalRange) * 100,
    [min, totalRange]
  )

  // Freeze track geometry while dragging so grid reflow cannot move the pointer's target.
  const positionToValue = useCallback(
    (clientX: number, clientY: number, drag?: SliderDrag) => {
      const track = trackRef.current
      if (!track) return min
      const rect = drag?.rect ?? track.getBoundingClientRect()

      let ratio: number
      if (orientation === 'vertical') {
        // For vertical: top = min, bottom = max
        ratio = (clientY - rect.top - (drag?.offset ?? 0)) / rect.height
      } else {
        ratio = (clientX - rect.left - (drag?.offset ?? 0)) / rect.width
      }

      ratio = Math.max(0, Math.min(1, ratio))
      return min + ratio * totalRange
    },
    [min, totalRange, orientation]
  )

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, thumb: 'start' | 'end') => {
      if (e.button !== 0 || draggingRef.current || !trackRef.current) return
      e.preventDefault()
      e.stopPropagation()
      const rect = trackRef.current.getBoundingClientRect()
      const value = thumb === 'start' ? startValue : endValue
      const ratio = (value - min) / totalRange
      const offset = orientation === 'vertical'
        ? e.clientY - (rect.top + rect.height * ratio)
        : e.clientX - (rect.left + rect.width * ratio)
      draggingRef.current = {
        thumb, pointerId: e.pointerId, element: e.currentTarget, rect, offset,
        start: startValue, end: endValue, pushed: false,
      }
      suppressClickRef.current = true
      setDragPosition({ thumb, value })
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [startValue, endValue, min, totalRange, orientation]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = draggingRef.current
      if (!drag || drag.pointerId !== e.pointerId) return
      e.preventDefault()

      const raw = positionToValue(e.clientX, e.clientY, drag)

      if (drag.thumb === 'start') {
        const visual = Math.max(min, Math.min(raw, max - minGap))
        const clamped = Math.round(visual)
        setDragPosition({ thumb: 'start', value: visual })
        if (clamped !== drag.start) {
          drag.start = clamped
          onStartChange(clamped)
        }
        // Push end if start would cross
        if (clamped + minGap > drag.end) {
          drag.end = clamped + minGap
          drag.pushed = true
          onEndChange(drag.end)
        }
      } else {
        const visual = Math.min(max, Math.max(raw, min + minGap))
        const clamped = Math.round(visual)
        setDragPosition({ thumb: 'end', value: visual })
        if (clamped !== drag.end) {
          drag.end = clamped
          onEndChange(clamped)
        }
        // Push start if end would cross
        if (clamped - minGap < drag.start) {
          drag.start = clamped - minGap
          drag.pushed = true
          onStartChange(drag.start)
        }
      }
    },
    [positionToValue, min, max, minGap, onStartChange, onEndChange]
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const drag = draggingRef.current
      if (!drag || drag.pointerId !== e.pointerId) return
      draggingRef.current = null
      setDragPosition(null)
      if (drag.element.hasPointerCapture(e.pointerId)) {
        drag.element.releasePointerCapture(e.pointerId)
      }
      if (drag.thumb === 'start' || drag.pushed) {
        onStartRelease()
      }
      if (drag.thumb === 'end' || drag.pushed) {
        onEndRelease()
      }
    },
    [onStartRelease, onEndRelease]
  )

  // Also handle track clicks to jump the nearest thumb
  const handleTrackClick = useCallback(
    (e: React.MouseEvent) => {
      if (draggingRef.current || suppressClickRef.current) {
        suppressClickRef.current = false
        return
      }
      const raw = Math.round(positionToValue(e.clientX, e.clientY))

      const distToStart = Math.abs(raw - startValue)
      const distToEnd = Math.abs(raw - endValue)

      if (distToStart <= distToEnd) {
        const clamped = Math.max(min, Math.min(raw, endValue - minGap))
        onStartChange(clamped)
        onStartRelease()
      } else {
        const clamped = Math.min(max, Math.max(raw, startValue + minGap))
        onEndChange(clamped)
        onEndRelease()
      }
    },
    [positionToValue, startValue, endValue, min, max, minGap, onStartChange, onEndChange, onStartRelease, onEndRelease]
  )

  // Cleanup on unmount - release any pending drag
  useEffect(() => {
    return () => {
      draggingRef.current = null
    }
  }, [])

  const startPercent = valueToPercent(dragPosition?.thumb === 'start' ? dragPosition.value : startValue)
  const endPercent = valueToPercent(dragPosition?.thumb === 'end' ? dragPosition.value : endValue)

  const isVertical = orientation === 'vertical'

  // Build wrapper class
  const wrapperClass = isVertical
    ? `dual-thumb-slider dual-thumb-vertical ${className}`
    : `dual-thumb-slider dual-thumb-horizontal ${className}`

  return (
    <div className={wrapperClass}>
      {/* Labels row */}
      {!isVertical && (startLabel || endLabel) && (
        <div className="flex items-center justify-between mb-1">
          {startLabel && <span className="text-xs font-medium text-foreground">{startLabel}</span>}
          {endLabel && <span className="text-xs font-medium text-foreground">{endLabel}</span>}
        </div>
      )}

      {isVertical && startLabel && (
        <span className="block text-sm font-medium text-foreground mb-2 text-center">{startLabel}</span>
      )}

      {/* Track container */}
      <div
        ref={trackRef}
        className="dual-thumb-track-container"
        onClick={handleTrackClick}
        onPointerDownCapture={() => {
          if (!draggingRef.current) suppressClickRef.current = false
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onLostPointerCapture={handlePointerUp}
      >
        {/* Background track */}
        <div className="dual-thumb-track" />

        {/* Active range highlight */}
        <div
          className="dual-thumb-range"
          style={
            isVertical
              ? { top: `${startPercent}%`, height: `${endPercent - startPercent}%` }
              : { left: `${startPercent}%`, width: `${endPercent - startPercent}%` }
          }
        />

        {/* Start thumb */}
        <div
          className={`dual-thumb-handle dual-thumb-start ${dragPosition?.thumb === 'start' ? 'active' : ''} ${hoveredThumb === 'start' ? 'hovered' : ''}`}
          style={isVertical ? { top: `${startPercent}%` } : { left: `${startPercent}%` }}
          onPointerDown={(e) => handlePointerDown(e, 'start')}
          onMouseEnter={() => setHoveredThumb('start')}
          onMouseLeave={() => setHoveredThumb(null)}
          role="slider"
          aria-label="Start hour"
          aria-valuemin={min}
          aria-valuemax={endValue - minGap}
          aria-valuenow={startValue}
          aria-orientation={orientation}
          tabIndex={0}
        >
          <span className="dual-thumb-tooltip">{startValue.toString().padStart(2, '0')}:00</span>
        </div>

        {/* End thumb */}
        <div
          className={`dual-thumb-handle dual-thumb-end ${dragPosition?.thumb === 'end' ? 'active' : ''} ${hoveredThumb === 'end' ? 'hovered' : ''}`}
          style={isVertical ? { top: `${endPercent}%` } : { left: `${endPercent}%` }}
          onPointerDown={(e) => handlePointerDown(e, 'end')}
          onMouseEnter={() => setHoveredThumb('end')}
          onMouseLeave={() => setHoveredThumb(null)}
          role="slider"
          aria-label="End hour"
          aria-valuemin={startValue + minGap}
          aria-valuemax={max}
          aria-valuenow={endValue}
          aria-orientation={orientation}
          tabIndex={0}
        >
          <span className="dual-thumb-tooltip">{endValue.toString().padStart(2, '0')}:00</span>
        </div>
      </div>

      {isVertical && endLabel && (
        <span className="block text-sm font-medium text-foreground mt-2 text-center">{endLabel}</span>
      )}
    </div>
  )
}
