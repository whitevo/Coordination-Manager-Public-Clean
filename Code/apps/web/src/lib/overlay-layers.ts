/**
 * Named overlay layers, replacing hand-picked z-index values.
 *
 * Kinds give a baseline ordering. On top of that the stack is tracked, so an
 * overlay opened from another overlay always renders above its parent instead
 * of needing a bespoke escalated value.
 */
export type OverlayKind = 'popover' | 'tooltip' | 'drawer' | 'dialog' | 'focusModal' | 'toast'

/** Kinds that do not block the page: no scrim, never the "top" overlay. */
export type NonBlockingOverlayKind = Extract<OverlayKind, 'popover' | 'tooltip' | 'toast'>

/** Kinds that block the page behind a scrim. */
export type BlockingOverlayKind = Exclude<OverlayKind, NonBlockingOverlayKind>

/** Anchored floating kinds: menus, popovers, hover cards, tooltips. */
export type FloatingOverlayKind = Extract<OverlayKind, 'popover' | 'tooltip'>

export const OVERLAY_BASE_Z: Record<OverlayKind, number> = {
  popover: 60,
  tooltip: 80,
  drawer: 95,
  dialog: 100,
  focusModal: 110,
  toast: 200,
}

/**
 * Static class for a non-blocking element rendered in page flow (not inside a
 * dialog or drawer). Literal strings so Tailwind generates them; must match
 * OVERLAY_BASE_Z. A popover opened from inside a blocking overlay should call
 * pushOverlay('popover') (or useOverlayLayer) instead so it resolves above its
 * parent. Toasts always sit at their fixed base, so the class is enough.
 */
export const OVERLAY_LAYER_CLASS: Record<NonBlockingOverlayKind, string> = {
  popover: 'z-60',
  tooltip: 'z-80',
  toast: 'z-200',
}

/** App-shell surfaces: persistent chrome that is mounted, not claimed like an overlay. */
export type ShellLayer = 'sidePanelBackdrop' | 'sidePanel' | 'navDesktop' | 'navMobile'

/**
 * Fixed layers for the app shell. They interleave with OVERLAY_BASE_Z on
 * purpose and are never pushed on the overlay stack:
 * - sidePanelBackdrop / sidePanel (40 / 50): assistance side panels (full
 *   width on phones) and their mobile backdrop sit under page popovers.
 * - navDesktop (70): the top nav covers page popovers but stays under
 *   tooltips and every blocking overlay.
 * - navMobile (100): on phones the nav stays above full-screen drawers so it
 *   remains reachable; it ties the dialog base, and dialogs still paint above
 *   it because they portal to document.body after the app root.
 */
export const SHELL_LAYER_Z: Record<ShellLayer, number> = {
  sidePanelBackdrop: 40,
  sidePanel: 50,
  navDesktop: 70,
  navMobile: 100,
}

/** Literal classes for SHELL_LAYER_Z (Tailwind must see the strings). */
export const SHELL_LAYER_CLASS = {
  sidePanelBackdrop: 'z-40',
  sidePanel: 'z-50',
  /** Mobile-first: navMobile below md, navDesktop from md up. */
  nav: 'z-100 md:z-70',
} as const

const NON_BLOCKING_KINDS: ReadonlySet<OverlayKind> = new Set<OverlayKind>(['popover', 'tooltip', 'toast'])

/** True for kinds that block the page (drawer, dialog, focusModal). */
export function isBlockingOverlayKind(kind: OverlayKind): kind is BlockingOverlayKind {
  return !NON_BLOCKING_KINDS.has(kind)
}

/** Scrim recipes. Popovers, tooltips and toasts have none; they do not block. */
export const OVERLAY_SCRIM: Record<BlockingOverlayKind, string> = {
  drawer: 'bg-black/55',
  dialog: 'bg-black/30',
  focusModal: 'bg-black/45 backdrop-blur-xs',
}

/** Step between stacked overlays, small enough to stay under the next kind. */
const STACK_STEP = 2

interface StackEntry {
  id: number
  kind: OverlayKind
  z: number
}

let nextId = 1
const stack: StackEntry[] = []

/** Highest z currently claimed by a blocking overlay (non-blocking kinds excluded). */
function topBlockingZ(): number {
  return stack.reduce(
    (max, entry) => (isBlockingOverlayKind(entry.kind) ? Math.max(max, entry.z) : max),
    0
  )
}

/**
 * Claims a layer. Returns the resolved z-index and a release function.
 *
 * Toasts always sit at their fixed base so they stay above blocking overlays
 * without being pushed further by them. Popovers and tooltips resolve above
 * the current blocking stack (so a menu inside a dialog renders over it) but
 * never raise later overlays and never count as the top overlay.
 */
export function pushOverlay(kind: OverlayKind): { id: number; z: number; release: () => void } {
  const base = OVERLAY_BASE_Z[kind]
  // Floating kinds take half a step so a dialog opened from a menu still
  // lands above that menu.
  const step = kind === 'popover' || kind === 'tooltip' ? STACK_STEP / 2 : STACK_STEP
  const z = kind === 'toast' ? base : Math.max(base, topBlockingZ() + step)
  const entry: StackEntry = { id: nextId++, kind, z }
  stack.push(entry)

  return {
    id: entry.id,
    z,
    release: () => {
      const index = stack.findIndex(item => item.id === entry.id)
      if (index !== -1) stack.splice(index, 1)
    },
  }
}

/** True when the given overlay id is the top blocking overlay. */
export function isTopOverlay(id: number): boolean {
  const blocking = stack.filter(entry => isBlockingOverlayKind(entry.kind))
  return blocking.length > 0 && blocking[blocking.length - 1].id === id
}

/** Test seam: clears the stack between cases. */
export function resetOverlayStack(): void {
  stack.length = 0
}
