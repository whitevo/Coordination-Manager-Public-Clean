import { useLayoutEffect, useRef, useState } from 'react'

export function useMobileMenuHeight(isOpen: boolean) {
  const navigationRef = useRef<HTMLElement | null>(null)
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined)

  useLayoutEffect(() => {
    if (!isOpen) return
    const nav = navigationRef.current
    if (!nav) return
    const viewport = window.visualViewport
    const updateHeight = () => {
      const viewportBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight
      setMaxHeight(Math.max(0, viewportBottom - nav.getBoundingClientRect().bottom))
    }
    updateHeight()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateHeight) : null
    observer?.observe(nav)
    window.addEventListener('resize', updateHeight)
    window.addEventListener('scroll', updateHeight, { passive: true })
    viewport?.addEventListener('resize', updateHeight)
    viewport?.addEventListener('scroll', updateHeight)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', updateHeight)
      window.removeEventListener('scroll', updateHeight)
      viewport?.removeEventListener('resize', updateHeight)
      viewport?.removeEventListener('scroll', updateHeight)
    }
  }, [isOpen])

  return { navigationRef, maxHeight }
}
