import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMobileMenuHeight } from '../use-mobile-menu-height'

function Harness({ open }: { open: boolean }) {
  const { navigationRef, maxHeight } = useMobileMenuHeight(open)
  return <nav ref={navigationRef}><div data-testid="menu" style={{ maxHeight }} /></nav>
}

describe('mobile navigation menu height', () => {
  const originalHeight = window.innerHeight
  let navBottom: number
  let notifyResize: (() => void) | undefined
  const disconnect = vi.fn()

  beforeEach(() => {
    navBottom = 63
    vi.clearAllMocks()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      x: 0, y: 0, top: 0, left: 0, right: 390, bottom: navBottom,
      width: 390, height: navBottom, toJSON: () => ({}),
    }))
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { notifyResize = callback }
      observe() {}
      disconnect = disconnect
    })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 524 })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight })
  })

  it('bounds the dropdown below the actual header even when document scrolling is locked', () => {
    const originalOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    try {
      render(<Harness open />)
      expect(screen.getByTestId('menu').style.maxHeight).toBe('461px')
    } finally {
      document.documentElement.style.overflow = originalOverflow
    }
  })

  it('remeasures when header banners, viewport size, or document scroll change', () => {
    render(<Harness open />)
    navBottom = 120
    act(() => { notifyResize?.() })
    expect(screen.getByTestId('menu').style.maxHeight).toBe('404px')
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 400 })
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(screen.getByTestId('menu').style.maxHeight).toBe('280px')
    navBottom = 20
    act(() => { window.dispatchEvent(new Event('scroll')) })
    expect(screen.getByTestId('menu').style.maxHeight).toBe('380px')
  })

  it('uses the visual viewport during keyboard and browser-control resizing', () => {
    const viewport = new EventTarget()
    Object.assign(viewport, { height: 300, offsetTop: 10 })
    vi.stubGlobal('visualViewport', viewport)
    render(<Harness open />)
    expect(screen.getByTestId('menu').style.maxHeight).toBe('247px')
    Object.assign(viewport, { height: 200, offsetTop: 20 })
    act(() => { viewport.dispatchEvent(new Event('resize')) })
    expect(screen.getByTestId('menu').style.maxHeight).toBe('157px')
  })

  it('recalculates on reopening and disconnects observers when closed', () => {
    const view = render(<Harness open />)
    view.rerender(<Harness open={false} />)
    expect(disconnect).toHaveBeenCalledOnce()
    navBottom = 100
    view.rerender(<Harness open />)
    expect(screen.getByTestId('menu').style.maxHeight).toBe('424px')
    navBottom = 600
    act(() => { notifyResize?.() })
    expect(parseFloat(screen.getByTestId('menu').style.maxHeight)).toBe(0)
  })
})
