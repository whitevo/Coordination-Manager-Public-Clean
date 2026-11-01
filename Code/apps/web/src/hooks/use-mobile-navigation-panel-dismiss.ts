import { useEffect, useRef } from 'react'

export const MOBILE_NAVIGATION_PANEL_DISMISS_EVENT = 'cm:mobile-navigation-panel-dismiss'

export function dismissPanelsForMobileNavigation(target: EventTarget | null): boolean {
  if (window.innerWidth >= 768 || !(target instanceof Element)) return false
  if (!target.closest('a[href], button, [role="button"], [role="menuitem"]')) return false
  window.dispatchEvent(new Event(MOBILE_NAVIGATION_PANEL_DISMISS_EVENT))
  return true
}

export function useMobileNavigationPanelDismiss(onDismiss: () => void) {
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  useEffect(() => {
    const handleDismiss = () => {
      if (window.innerWidth < 768) dismissRef.current()
    }
    window.addEventListener(MOBILE_NAVIGATION_PANEL_DISMISS_EVENT, handleDismiss)
    return () => window.removeEventListener(MOBILE_NAVIGATION_PANEL_DISMISS_EVENT, handleDismiss)
  }, [])
}
