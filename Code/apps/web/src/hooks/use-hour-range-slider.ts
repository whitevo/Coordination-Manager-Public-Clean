import { useCallback, useEffect, useRef, useState } from 'react'

interface HourRange {
  start: number
  end: number
}

interface HourRangeSliderOptions {
  startHour: number
  endHour: number
  setStartHour: (value: number) => void
  setEndHour: (value: number) => void
}

export function useHourRangeSlider({
  startHour,
  endHour,
  setStartHour,
  setEndHour,
}: HourRangeSliderOptions) {
  const [preview, setPreview] = useState<HourRange | null>(null)
  const [hasAdjustedHourRange, setHasAdjustedHourRange] = useState(false)
  const pendingRef = useRef<HourRange | null>(null)
  const frameRef = useRef<number | null>(null)

  const commit = useCallback(() => {
    const pending = pendingRef.current
    if (!pending) return
    setStartHour(pending.start)
    setEndHour(pending.end)
  }, [setStartHour, setEndHour])

  const schedule = useCallback((range: HourRange) => {
    setHasAdjustedHourRange(true)
    pendingRef.current = range
    setPreview(range)
    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      commit()
    })
  }, [commit])

  const handleStartHourSlider = useCallback((target: number) => {
    const range = pendingRef.current ?? { start: startHour, end: endHour }
    const start = Math.max(0, Math.min(23, Math.round(target)))
    schedule({ start, end: Math.max(range.end, start + 1) })
  }, [startHour, endHour, schedule])

  const handleEndHourSlider = useCallback((target: number) => {
    const range = pendingRef.current ?? { start: startHour, end: endHour }
    const end = Math.max(1, Math.min(24, Math.round(target)))
    schedule({ start: Math.min(range.start, end - 1), end })
  }, [startHour, endHour, schedule])

  const releaseHourSlider = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    // Flush both bounds together, including an opposite thumb pushed during dragging.
    commit()
    pendingRef.current = null
    setPreview(null)
  }, [commit])

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
  }, [])

  return {
    hasAdjustedHourRange,
    displayStartHour: preview?.start ?? startHour,
    displayEndHour: preview?.end ?? endHour,
    handleStartHourSlider,
    handleEndHourSlider,
    releaseStartHourSlider: releaseHourSlider,
    releaseEndHourSlider: releaseHourSlider,
  }
}
