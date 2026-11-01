/**
 * The app nav sits above page popovers (SHELL_LAYER_Z.navDesktop / navMobile >
 * OVERLAY_BASE_Z.popover) so it covers scrolled page content. Fixed or
 * portaled popovers that clamp toward the viewport top must therefore stop
 * below the nav's bottom edge instead of sliding under it.
 */

/** Marks the app nav element (`data-app-nav` in Layout) so its live bottom edge can be read. */
export const APP_NAV_ATTR = 'data-app-nav'

/** Default gap kept between the nav and a clamped popover. */
export const TOP_OBSTRUCTION_GAP_PX = 8

/**
 * Viewport y (px) of the lowest edge of the app chrome covering the top of the
 * viewport: the nav's bottom, which already includes any banner rendered above
 * it in flow. Returns 0 when the nav is absent or scrolled out of view.
 */
export function getTopObstructionPx(root: ParentNode = document): number {
  const nav = root.querySelector<HTMLElement>(`[${APP_NAV_ATTR}]`)
  if (!nav) return 0
  const { bottom } = nav.getBoundingClientRect()
  const viewportHeight = typeof window === 'undefined' ? bottom : window.innerHeight
  return Math.max(0, Math.min(bottom, viewportHeight))
}

/** Raises a viewport `top` so the element starts below the nav (plus a gap). */
export function clampTopBelowObstruction(top: number, gap: number = TOP_OBSTRUCTION_GAP_PX): number {
  return Math.max(top, getTopObstructionPx() + gap)
}
