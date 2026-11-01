import { afterEach, describe, expect, it } from 'vitest'
import {
  APP_NAV_ATTR,
  TOP_OBSTRUCTION_GAP_PX,
  clampTopBelowObstruction,
  getTopObstructionPx,
} from '../top-obstruction'

function mountNav(bottom: number): HTMLElement {
  const nav = document.createElement('nav')
  nav.setAttribute(APP_NAV_ATTR, '')
  nav.getBoundingClientRect = () => ({
    x: 0, y: bottom - 64, top: bottom - 64, left: 0, right: 1024, bottom, width: 1024, height: 64,
    toJSON: () => ({}),
  })
  document.body.appendChild(nav)
  return nav
}

describe('top obstruction', () => {
  afterEach(() => {
    document.querySelectorAll(`[${APP_NAV_ATTR}]`).forEach(node => node.remove())
  })

  it('is 0 when there is no app nav', () => {
    expect(getTopObstructionPx()).toBe(0)
  })

  it('reads the live bottom edge of the app nav, including banners above it', () => {
    // A 40px banner above a 64px nav puts the nav bottom at 104.
    mountNav(104)
    expect(getTopObstructionPx()).toBe(104)
  })

  it('is 0 when the nav has scrolled out of view', () => {
    mountNav(-20)
    expect(getTopObstructionPx()).toBe(0)
  })

  it('never reports more than the viewport height', () => {
    mountNav(window.innerHeight + 500)
    expect(getTopObstructionPx()).toBe(window.innerHeight)
  })

  describe('clampTopBelowObstruction', () => {
    it('keeps a top that is already below the nav', () => {
      mountNav(64)
      expect(clampTopBelowObstruction(300)).toBe(300)
    })

    it('pushes a top that would sit under the nav to its bottom plus the gap', () => {
      mountNav(64)
      expect(clampTopBelowObstruction(12)).toBe(64 + TOP_OBSTRUCTION_GAP_PX)
      expect(clampTopBelowObstruction(12, 12)).toBe(76)
    })

    it('falls back to the viewport margin when there is no nav', () => {
      expect(clampTopBelowObstruction(-40, 8)).toBe(8)
      expect(clampTopBelowObstruction(40, 8)).toBe(40)
    })
  })
})
