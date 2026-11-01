import { useLayoutEffect, useState } from 'react'
import { OVERLAY_BASE_Z, pushOverlay, type OverlayKind } from './overlay-layers'

export interface OverlayLayer {
  id: number
  z: number
}

/**
 * Claims an overlay layer while `active` is true and releases it when it turns
 * false or the component unmounts. Returns the resolved z-index (the kind's
 * base while inactive) and the claim, so callers can check isTopOverlay(id).
 *
 * Claimed in a layout effect so a popover opened inside a dialog is placed
 * above it before the first paint.
 */
export function useOverlayLayer(kind: OverlayKind, active: boolean): { z: number; layer: OverlayLayer | null } {
  const [layer, setLayer] = useState<OverlayLayer | null>(null)

  useLayoutEffect(() => {
    if (!active) return
    const claim = pushOverlay(kind)
    setLayer({ id: claim.id, z: claim.z })
    return () => {
      claim.release()
      setLayer(null)
    }
  }, [active, kind])

  const current = active ? layer : null
  return { z: current?.z ?? OVERLAY_BASE_Z[kind], layer: current }
}
