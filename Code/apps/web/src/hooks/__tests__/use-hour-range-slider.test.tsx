import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useHourRangeSlider } from '../use-hour-range-slider'

describe('calendar hour range slider updates', () => {
  let frames: Map<number, FrameRequestCallback>
  let nextId: number
  const setStartHour = vi.fn()
  const setEndHour = vi.fn()

  function setup() {
    return renderHook(() => useHourRangeSlider({
      startHour: 8, endHour: 19, setStartHour, setEndHour,
    }))
  }

  beforeEach(() => {
    vi.clearAllMocks()
    frames = new Map()
    nextId = 0
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frames.set(++nextId, callback)
      return nextId
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('coalesces rapid moves into one live grid update with the latest bounds', () => {
    const { result } = setup()
    act(() => {
      result.current.handleStartHourSlider(9)
      result.current.handleStartHourSlider(12)
      result.current.handleEndHourSlider(17)
    })
    expect(result.current.displayStartHour).toBe(12)
    expect(result.current.displayEndHour).toBe(17)
    expect(frames.size).toBe(1)
    expect(setStartHour).not.toHaveBeenCalled()
    act(() => {
      const callbacks = [...frames.values()]
      frames.clear()
      callbacks.forEach(callback => callback(16))
    })
    expect(setStartHour).toHaveBeenCalledExactlyOnceWith(12)
    expect(setEndHour).toHaveBeenCalledExactlyOnceWith(17)
  })

  it('flushes the final target on release before the next frame', () => {
    const { result } = setup()
    expect(result.current.hasAdjustedHourRange).toBe(false)
    act(() => result.current.handleEndHourSlider(12))
    expect(result.current.hasAdjustedHourRange).toBe(true)
    act(() => result.current.releaseEndHourSlider())
    expect(result.current.hasAdjustedHourRange).toBe(true)
    expect(frames.size).toBe(0)
    expect(setStartHour).toHaveBeenLastCalledWith(8)
    expect(setEndHour).toHaveBeenLastCalledWith(12)
  })

  it('commits both bounds when one thumb pushes the other, without a stale release', () => {
    const { result } = setup()
    act(() => {
      result.current.handleStartHourSlider(21)
      result.current.handleEndHourSlider(22)
      result.current.releaseStartHourSlider()
      result.current.releaseEndHourSlider()
    })
    expect(setStartHour).toHaveBeenCalledExactlyOnceWith(21)
    expect(setEndHour).toHaveBeenCalledExactlyOnceWith(22)
    act(() => {
      result.current.handleEndHourSlider(4)
      result.current.releaseEndHourSlider()
    })
    expect(setStartHour).toHaveBeenLastCalledWith(3)
    expect(setEndHour).toHaveBeenLastCalledWith(4)
  })

  it('preserves whole-hour bounds and a one-hour minimum', () => {
    const { result } = setup()
    act(() => result.current.handleStartHourSlider(30))
    expect(result.current.displayStartHour).toBe(23)
    expect(result.current.displayEndHour).toBe(24)
    act(() => result.current.handleEndHourSlider(-5))
    expect(result.current.displayStartHour).toBe(0)
    expect(result.current.displayEndHour).toBe(1)
  })

  it('cancels pending grid updates on unmount', () => {
    const { result, unmount } = setup()
    act(() => result.current.handleStartHourSlider(10))
    unmount()
    expect(frames.size).toBe(0)
    expect(setStartHour).not.toHaveBeenCalled()
    expect(setEndHour).not.toHaveBeenCalled()
  })
})
