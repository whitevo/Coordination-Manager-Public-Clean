import { useEffect, useLayoutEffect, useRef, useState } from 'react'

interface PresenceEntry<T> {
  item: T
  exiting: boolean
}

interface Position {
  left: number
  top: number
}

export function useListPresence<T extends { id: string }>(items: T[], enabled = true, exitMs = 150, moveMs = 180) {
  const [entries, setEntries] = useState<PresenceEntry<T>[]>(() => items.map(item => ({ item, exiting: false })))
  const containerRef = useRef<HTMLDivElement>(null)
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const positions = useRef(new Map<string, Position>())
  const reducedMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useLayoutEffect(() => {
    setEntries(previous => {
      const next = items.map(item => ({ item, exiting: false }))
      if (!enabled || reducedMotion) return next
      const nextIds = new Set(items.map(item => item.id))
      previous.forEach((entry, index) => {
        if (!nextIds.has(entry.item.id)) {
          next.splice(Math.min(index, next.length), 0, { item: entry.item, exiting: true })
        }
      })
      return next
    })
  }, [items, enabled, reducedMotion])

  useEffect(() => {
    const exitingIds = new Set(entries.filter(entry => entry.exiting).map(entry => entry.item.id))
    for (const [id, timer] of timers.current) {
      if (!exitingIds.has(id)) {
        clearTimeout(timer)
        timers.current.delete(id)
      }
    }
    for (const id of exitingIds) {
      if (timers.current.has(id)) continue
      timers.current.set(id, setTimeout(() => {
        timers.current.delete(id)
        setEntries(current => current.filter(entry => entry.item.id !== id || !entry.exiting))
      }, exitMs))
    }
  }, [entries, exitMs])

  useEffect(() => {
    const pendingTimers = timers.current
    return () => {
      for (const timer of pendingTimers.values()) clearTimeout(timer)
      pendingTimers.clear()
    }
  }, [])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const containerRect = container.getBoundingClientRect()
    const nextPositions = new Map<string, Position>()
    const exitingIds = new Set(entries.filter(entry => entry.exiting).map(entry => entry.item.id))
    for (const node of container.querySelectorAll<HTMLElement>('[data-presence-key]')) {
      const id = node.dataset.presenceKey
      if (!id) continue
      node.inert = exitingIds.has(id)
      if (node.inert && node.contains(document.activeElement)) {
        const nextNode = Array.from(container.querySelectorAll<HTMLElement>('[data-presence-key]'))
          .find(candidate => !exitingIds.has(candidate.dataset.presenceKey ?? ''))
        ;(nextNode ?? container).focus()
      }
      const rect = node.getBoundingClientRect()
      const next = { left: rect.left - containerRect.left, top: rect.top - containerRect.top }
      const previous = positions.current.get(id)
      if (previous && !reducedMotion && typeof node.animate === 'function') {
        const deltaLeft = previous.left - next.left
        const deltaTop = previous.top - next.top
        if (deltaLeft !== 0 || deltaTop !== 0) {
          node.animate([
            { transform: `translate(${deltaLeft}px, ${deltaTop}px)` },
            { transform: 'translate(0, 0)' },
          ], { duration: moveMs, easing: 'ease-out' })
        }
      }
      nextPositions.set(id, next)
    }
    positions.current = nextPositions
  }, [entries, reducedMotion, moveMs])

  return {
    items: entries.map(entry => entry.item),
    exitingIds: new Set(entries.filter(entry => entry.exiting).map(entry => entry.item.id)),
    containerRef,
  }
}