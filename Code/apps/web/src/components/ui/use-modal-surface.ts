import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'
import { isTopOverlay, pushOverlay, type BlockingOverlayKind } from '../../lib/overlay-layers'

export const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Text-entry fields only: a checkbox or radio is not a sensible first stop. */
const FORM_FIELD =
  'input:not([disabled]):not([readonly]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea:not([disabled]):not([readonly]), select:not([disabled])'

/** Marks header chrome (close button, header actions) so initial focus skips it. */
export const CHROME_ATTR = 'data-dialog-chrome'

export interface ModalSurfaceOptions {
  open: boolean
  onClose: () => void
  /** Blocking tier claimed from the overlay stack while open. */
  kind: BlockingOverlayKind
  /** Escape closes the surface (only when it is the topmost overlay). */
  dismissible?: boolean
  /** Element to focus on open instead of the default choice. */
  initialFocusRef?: RefObject<HTMLElement | null>
}

export interface ModalSurface {
  /** Claimed layer; null until claimed. Render nothing while null. */
  layer: { id: number; z: number } | null
  /** Attach to the focus-trapping panel element. */
  panelRef: RefObject<HTMLDivElement | null>
  /** Attach to the outermost (scrim) element: Escape + Tab trap. */
  handleKeyDown: (event: ReactKeyboardEvent) => void
}

/**
 * Shared behavior of every blocking modal surface (Dialog, Lightbox): claims a
 * blocking overlay layer, makes the app root inert, moves focus in and returns
 * it to the trigger on close, locks body scroll, closes on Escape only when it
 * is the topmost overlay, and traps Tab inside the panel.
 */
export function useModalSurface({
  open,
  onClose,
  kind,
  dismissible = true,
  initialFocusRef,
}: ModalSurfaceOptions): ModalSurface {
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const [layer, setLayer] = useState<{ id: number; z: number } | null>(null)

  useEffect(() => {
    if (!open) return
    // Captured before the panel renders, so an autoFocus field inside the
    // panel is never mistaken for the trigger.
    triggerRef.current = document.activeElement as HTMLElement | null
    const claim = pushOverlay(kind)
    setLayer({ id: claim.id, z: claim.z })
    return () => {
      claim.release()
      setLayer(null)
    }
  }, [open, kind])

  // Declared before the focus effect so its cleanup runs first: the app root
  // must stop being inert before focus can return to the trigger inside it.
  useEffect(() => {
    if (!open) return
    const appRoot = document.getElementById('root')
    if (!appRoot) return
    const previousInert = appRoot.inert === true
    const previousAriaHidden = appRoot.getAttribute('aria-hidden')
    appRoot.inert = true
    appRoot.setAttribute('aria-hidden', 'true')
    return () => {
      appRoot.inert = previousInert
      if (previousAriaHidden === null) appRoot.removeAttribute('aria-hidden')
      else appRoot.setAttribute('aria-hidden', previousAriaHidden)
    }
  }, [open])

  // Initial focus: an explicit initialFocusRef, else keep an autoFocus field,
  // else the first form field, else the close button (safer than a content
  // action), else the first control. On close, focus returns to the trigger.
  useEffect(() => {
    if (!open || !layer) return
    const panel = panelRef.current
    const requested = initialFocusRef?.current
    if (requested) {
      requested.focus()
    } else if (panel && !panel.contains(document.activeElement)) {
      const isContent = (node: HTMLElement) => !node.closest(`[${CHROME_ATTR}]`)
      const field = Array.from(panel.querySelectorAll<HTMLElement>(FORM_FIELD)).find(isContent)
      const close = panel.querySelector<HTMLElement>(`[${CHROME_ATTR}="close"]`)
      const first = panel.querySelector<HTMLElement>(FOCUSABLE)
      ;(field ?? close ?? first ?? panel).focus()
    }
    const trigger = triggerRef.current
    return () => trigger?.focus?.()
    // initialFocusRef is read once per open; a ref object identity change must not refocus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, layer])

  useEffect(() => {
    if (!open) return
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
    }
  }, [open])

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.key === 'Escape' && dismissible && layer && isTopOverlay(layer.id)) {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
      if (!nodes || nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    },
    [dismissible, layer, onClose]
  )

  return { layer, panelRef, handleKeyDown }
}
