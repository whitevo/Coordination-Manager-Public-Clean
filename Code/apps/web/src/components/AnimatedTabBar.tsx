import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface AnimatedTabItem<T extends string> {
  id: T
  label: string
  icon?: React.ComponentType<{ className?: string }>
  title?: string
}

interface AnimatedTabBarProps<T extends string> {
  tabs: Array<AnimatedTabItem<T>>
  activeId: T
  onSelect: (id: T) => void
  /** Layout classes for the tab container (grid/flex definition). */
  className?: string
  /** Sizing and typography classes shared by every tab button. */
  buttonClassName?: string
  iconClassName?: string
  ariaLabel: string
  testId: string
}

interface TabRect {
  left: number
  top: number
  width: number
  height: number
}

/** Time the travelling threads need to reach the newly selected tab. */
export const TAB_TRAVEL_MS = 1100
/** Total length of the navigation effect (travel + background fade-in). */
export const TAB_SEQUENCE_MS = 2000
/** The tab that is being left drops its background much faster than the new one builds up. */
export const TAB_FADE_OUT_MS = 600

const TRAVEL_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

interface ThreadStyle {
  topPercent: number
  trailPx: number
  delayMs: number
  durationMs: number
  peakOpacity: number
  restOpacity: number
  wavePx: number
  heightPx: number
  startScaleY: number
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

/**
 * Builds one throwaway wave profile per navigation so no two transitions look alike.
 * The leading threads are dense, thick and bright; the trailing ones are thinner, slower
 * and ghostly, which reads as a spike of energy decaying on its way to the destination.
 */
function buildThreadWave(direction: number): ThreadStyle[] {
  const count = Math.round(randomBetween(4, 7))
  return Array.from({ length: count }, (_, index) => {
    const decay = count === 1 ? 0 : index / (count - 1)
    return {
      topPercent: ((index + 1) / (count + 1)) * 100 + randomBetween(-7, 7),
      trailPx: -direction * randomBetween(16, 32) * (index + 1),
      delayMs: Math.round(index * randomBetween(40, 95)),
      durationMs: Math.round(TAB_TRAVEL_MS + index * randomBetween(80, 170)),
      peakOpacity: Math.min(1, Math.max(0.12, 1 - decay * 0.62 + randomBetween(-0.08, 0.08))),
      restOpacity: Math.max(0.06, 0.34 - decay * 0.24),
      wavePx: randomBetween(2, 5.5) * (index % 2 === 0 ? 1 : -1),
      heightPx: decay < 0.45 ? 2 : 1,
      startScaleY: randomBetween(1.6, 3.2),
    }
  })
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Tab bar that animates the active-state change: a bundle of thin threads slithers from the
 * previously selected tab to the new one, the tab being left drops its background quickly and
 * the new one builds its background up over the full sequence.
 * Selection changes triggered elsewhere (quick links, deep links, arrivals from other pages)
 * animate the same way because the effect is driven purely by the `activeId` prop.
 */
export function AnimatedTabBar<T extends string>({
  tabs,
  activeId,
  onSelect,
  className,
  buttonClassName,
  iconClassName = 'h-4 w-4',
  ariaLabel,
  testId,
}: AnimatedTabBarProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const buttonRefs = useRef(new Map<T, HTMLButtonElement>())
  const hasPositionedRef = useRef(false)
  const previousLeftRef = useRef<number | null>(null)
  const previousActiveIdRef = useRef<T | null>(null)
  const [indicator, setIndicator] = useState<TabRect | null>(null)
  const [isTraveling, setIsTraveling] = useState(false)
  const [travelKey, setTravelKey] = useState(0)
  const [threads, setThreads] = useState<ThreadStyle[]>(() => buildThreadWave(1))
  const [leavingTabId, setLeavingTabId] = useState<T | null>(null)
  // Lags one frame behind `activeId` so the incoming background always renders at zero
  // opacity first and can then transition to the active colour.
  const [fadedInTabId, setFadedInTabId] = useState<T | null>(null)
  const [reducedMotion] = useState(prefersReducedMotion)

  const measure = useCallback((id: T): TabRect | null => {
    const container = containerRef.current
    const button = buttonRefs.current.get(id)
    if (!container || !button) return null
    const containerRect = container.getBoundingClientRect()
    const buttonRect = button.getBoundingClientRect()
    return {
      left: buttonRect.left - containerRect.left,
      top: buttonRect.top - containerRect.top,
      width: buttonRect.width,
      height: buttonRect.height,
    }
  }, [])

  useLayoutEffect(() => {
    const target = measure(activeId)
    if (!target) return

    if (reducedMotion) {
      hasPositionedRef.current = true
      previousLeftRef.current = target.left
      previousActiveIdRef.current = activeId
      setIndicator(target)
      setFadedInTabId(activeId)
      return
    }

    if (!hasPositionedRef.current) {
      hasPositionedRef.current = true
      // Arriving from another view: the threads enter from the edge of the bar.
      setIndicator({ left: 0, top: target.top, width: Math.min(14, target.width), height: target.height })
      previousLeftRef.current = 0
    }

    const origin = previousLeftRef.current ?? target.left
    const previousActiveId = previousActiveIdRef.current
    previousLeftRef.current = target.left
    previousActiveIdRef.current = activeId
    if (previousActiveId && previousActiveId !== activeId) setLeavingTabId(previousActiveId)

    const frame = requestAnimationFrame(() => {
      setIndicator(target)
      setIsTraveling(true)
      setThreads(buildThreadWave(target.left >= origin ? 1 : -1))
      setFadedInTabId(activeId)
      setTravelKey((key) => key + 1)
    })
    return () => cancelAnimationFrame(frame)
  }, [activeId, measure, reducedMotion, tabs])

  useEffect(() => {
    if (!leavingTabId) return
    const timer = window.setTimeout(() => setLeavingTabId(null), TAB_FADE_OUT_MS)
    return () => window.clearTimeout(timer)
  }, [leavingTabId, travelKey])

  useEffect(() => {
    if (!isTraveling) return
    const timer = window.setTimeout(() => setIsTraveling(false), TAB_SEQUENCE_MS)
    return () => window.clearTimeout(timer)
  }, [isTraveling, travelKey])

  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const target = measure(activeId)
      if (target) setIndicator(target)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [activeId, measure])

  return (
    <div
      ref={containerRef}
      role="tablist"
      aria-label={ariaLabel}
      data-testid={testId}
      className={`relative ${className ?? ''}`}
    >
      {indicator && (
        <span
          aria-hidden="true"
          data-testid={`${testId}-indicator`}
          data-traveling={isTraveling ? 'true' : 'false'}
          className="pointer-events-none absolute z-0"
          style={{
            left: `${indicator.left}px`,
            top: `${indicator.top}px`,
            width: `${indicator.width}px`,
            height: `${indicator.height}px`,
            transition: reducedMotion
              ? 'none'
              : `left ${TAB_TRAVEL_MS}ms ${TRAVEL_EASING}, top ${TAB_TRAVEL_MS}ms ${TRAVEL_EASING}, width ${TAB_TRAVEL_MS}ms ${TRAVEL_EASING}, height ${TAB_TRAVEL_MS}ms ${TRAVEL_EASING}`,
          }}
        >
          {threads.map((thread, index) => (
            <span
              key={`${travelKey}-${index}`}
              className={`tab-thread ${isTraveling ? 'tab-thread--travelling' : ''}`}
              style={{
                top: `${thread.topPercent}%`,
                height: `${thread.heightPx}px`,
                animationDuration: `${thread.durationMs}ms`,
                animationDelay: `${thread.delayMs}ms`,
                ['--thread-trail' as string]: `${thread.trailPx}px`,
                ['--thread-wave' as string]: `${thread.wavePx}px`,
                ['--thread-peak' as string]: `${thread.peakOpacity}`,
                ['--thread-rest' as string]: `${thread.restOpacity}`,
                ['--thread-thickness' as string]: `${thread.startScaleY}`,
              }}
            />
          ))}
        </span>
      )}

      {tabs.map((tab) => {
        const Icon = tab.icon
        const isActive = activeId === tab.id
        const isLeaving = !isActive && leavingTabId === tab.id
        return (
          <button
            key={tab.id}
            ref={(node) => {
              if (node) buttonRefs.current.set(tab.id, node)
              else buttonRefs.current.delete(tab.id)
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            title={tab.title}
            data-tab-id={tab.id}
            data-active={isActive ? 'true' : 'false'}
            onClick={() => onSelect(tab.id)}
            className={`relative z-10 flex items-center justify-center gap-2 overflow-hidden rounded-lg transition-colors ${buttonClassName ?? ''} ${
              isActive ? 'text-primary-foreground' : 'hover:bg-accent/50 text-muted-foreground hover:text-accent-foreground'
            }`}
          >
            {(isActive || isLeaving) && (
              <span
                aria-hidden="true"
                data-testid={isActive ? `${testId}-active-bg` : `${testId}-leaving-bg`}
                className="pointer-events-none absolute inset-0 rounded-lg bg-primary"
                style={{
                  opacity: fadedInTabId === tab.id ? 1 : 0,
                  transition: reducedMotion
                    ? 'none'
                    : `opacity ${isActive ? `${TAB_SEQUENCE_MS}ms ease-out` : `${TAB_FADE_OUT_MS}ms ease-in`}`,
                }}
              />
            )}
            <span className="relative z-10 flex items-center justify-center gap-2">
              {Icon && <Icon className={iconClassName} />}
              {tab.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export default AnimatedTabBar
