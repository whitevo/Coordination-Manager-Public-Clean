import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DualThumbSlider from '../DualThumbSlider'
import { useHourRangeSlider } from '../../hooks/use-hour-range-slider'

function Harness({ orientation = 'vertical' }: { orientation?: 'vertical' | 'horizontal' }) {
  const [startHour, setStartHour] = useState(8)
  const [endHour, setEndHour] = useState(19)
  const slider = useHourRangeSlider({ startHour, endHour, setStartHour, setEndHour })
  return <>
    <DualThumbSlider
      min={0} max={24}
      startValue={slider.displayStartHour} endValue={slider.displayEndHour}
      onStartChange={slider.handleStartHourSlider} onEndChange={slider.handleEndHourSlider}
      onStartRelease={slider.releaseStartHourSlider} onEndRelease={slider.releaseEndHourSlider}
      orientation={orientation}
    />
    <output data-testid="grid-range">{startHour}-{endHour}</output>
  </>
}

describe('calendar slider drag interaction', () => {
  let frames: Map<number, FrameRequestCallback>
  let nextId: number

  function setup(orientation: 'vertical' | 'horizontal' = 'vertical') {
    render(<Harness orientation={orientation} />)
    const start = screen.getByRole('slider', { name: 'Start hour' })
    const end = screen.getByRole('slider', { name: 'End hour' })
    const track = start.parentElement!
    const geometry = vi.spyOn(track, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(100, 100, 240, 240))
    for (const thumb of [start, end]) {
      let captured = false
      Object.defineProperties(thumb, {
        setPointerCapture: { value: vi.fn(() => { captured = true }) },
        hasPointerCapture: { value: vi.fn(() => captured) },
        releasePointerCapture: { value: vi.fn(() => { captured = false }) },
      })
    }
    return { start, end, track, geometry }
  }

  function flushFrame() {
    act(() => {
      const callbacks = [...frames.values()]
      frames.clear()
      callbacks.forEach(callback => callback(16))
    })
  }

  beforeEach(() => {
    frames = new Map()
    nextId = 0
    vi.stubGlobal('PointerEvent', class extends MouseEvent {
      readonly pointerId: number
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init)
        this.pointerId = init.pointerId ?? 1
      }
    })
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frames.set(++nextId, callback)
      return nextId
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)))
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('moves the handle continuously while keeping grid hours snapped', () => {
    const { start, track } = setup()
    fireEvent.pointerDown(start, { pointerId: 1, clientY: 180 })
    fireEvent.pointerMove(track, { pointerId: 1, clientY: 183 })
    expect(parseFloat(start.style.top)).toBeCloseTo(8.3 / 24 * 100)
    expect(start).toHaveAttribute('aria-valuenow', '8')
    fireEvent.pointerMove(track, { pointerId: 1, clientY: 212 })
    expect(start).toHaveAttribute('aria-valuenow', '11')
    expect(screen.getByTestId('grid-range')).toHaveTextContent('8-19')
    flushFrame()
    expect(screen.getByTestId('grid-range')).toHaveTextContent('11-19')
  })

  it('keeps the grab offset and original geometry when the layout shifts', () => {
    const { start, track, geometry } = setup()
    fireEvent.pointerDown(start, { pointerId: 1, clientY: 186 })
    geometry.mockReturnValue(new DOMRect(100, 0, 240, 120))
    fireEvent.pointerMove(track, { pointerId: 1, clientY: 196 })
    expect(start).toHaveAttribute('aria-valuenow', '9')
    fireEvent.pointerMove(track, { pointerId: 1, clientY: 206 })
    expect(start).toHaveAttribute('aria-valuenow', '10')
    expect(geometry).toHaveBeenCalledTimes(1)
  })

  it('flushes both pushed bounds on release and ignores the synthetic drag click', () => {
    const { start, end, track } = setup()
    fireEvent.pointerDown(start, { pointerId: 1, clientY: 180 })
    fireEvent.pointerMove(track, { pointerId: 1, clientY: 310 })
    fireEvent.pointerUp(track, { pointerId: 1, clientY: 310 })
    expect(screen.getByTestId('grid-range')).toHaveTextContent('21-22')
    expect(start).toHaveAttribute('aria-valuenow', '21')
    expect(end).toHaveAttribute('aria-valuenow', '22')
    expect(frames.size).toBe(0)
    fireEvent.click(track, { clientY: 120 })
    expect(screen.getByTestId('grid-range')).toHaveTextContent('21-22')
    fireEvent.pointerDown(track, { pointerId: 2, clientY: 120 })
    fireEvent.click(track, { clientY: 120 })
    expect(screen.getByTestId('grid-range')).toHaveTextContent('2-22')
  })

  it.each(['pointerCancel', 'lostPointerCapture'] as const)('ends the drag on %s', event => {
    const { end, track } = setup()
    fireEvent.pointerDown(end, { pointerId: 1, clientY: 290 })
    fireEvent.pointerMove(track, { pointerId: 1, clientY: 150 })
    fireEvent[event](track, { pointerId: 1 })
    expect(screen.getByTestId('grid-range')).toHaveTextContent('4-5')
    expect(frames.size).toBe(0)
    expect(end).not.toHaveClass('active')
    fireEvent.pointerMove(track, { pointerId: 1, clientY: 300 })
    expect(end).toHaveAttribute('aria-valuenow', '5')
  })

  it('uses the same live update behavior for the horizontal mobile slider', () => {
    const { start, track } = setup('horizontal')
    fireEvent.pointerDown(start, { pointerId: 1, clientX: 180 })
    fireEvent.pointerMove(track, { pointerId: 1, clientX: 202 })
    expect(parseFloat(start.style.left)).toBeCloseTo(10.2 / 24 * 100)
    expect(start).toHaveAttribute('aria-orientation', 'horizontal')
    flushFrame()
    expect(screen.getByTestId('grid-range')).toHaveTextContent('10-19')
    fireEvent.pointerUp(track, { pointerId: 1 })
    expect(frames.size).toBe(0)
  })

  it('ignores another pointer while dragging', () => {
    const { start, track } = setup()
    fireEvent.pointerDown(start, { pointerId: 1, clientY: 180 })
    fireEvent.pointerMove(track, { pointerId: 2, clientY: 300 })
    fireEvent.pointerUp(track, { pointerId: 2 })
    expect(start).toHaveAttribute('aria-valuenow', '8')
    expect(start).toHaveClass('active')
    fireEvent.pointerCancel(track, { pointerId: 1 })
  })
})
