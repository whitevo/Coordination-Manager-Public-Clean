import { useState, useRef, useCallback, type ReactNode } from 'react'
import { HelpCircle } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useLearnerMode } from '../contexts/LearnerModeContext'
import { useAuth } from '../contexts/AuthContext'
import { OVERLAY_LAYER_CLASS } from '../lib/overlay-layers'
import { useOverlayLayer } from '../lib/use-overlay-layer'

interface LearnerHelpIconProps {
  description: ReactNode
  /** Size of the icon in pixels (default: 5 = h-5 w-5) */
  size?: 4 | 5
  /** Additional classes on the wrapper span */
  className?: string
  /** Force tooltip to render via portal (useful inside overflow containers) */
  usePortal?: boolean
}

const tooltipClasses = 'w-80 px-5 py-4 text-[13px] font-normal rounded-xl shadow-2xl border border-info-muted bg-info-subtle text-foreground'

export default function LearnerHelpIcon({ description, size = 5, className = '', usePortal = false }: LearnerHelpIconProps) {
  const { learnerMode } = useLearnerMode()
  const { isAuthenticated } = useAuth()
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null)
  const iconRef = useRef<HTMLButtonElement>(null)

  const visible = pinned || hovered
  // The portaled tooltip claims the tooltip layer so it also sits above a dialog or drawer.
  const { z: portalTooltipZ } = useOverlayLayer('tooltip', visible && (usePortal || className.includes('absolute')))

  const updatePosition = useCallback(() => {
    if (iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect()
      let left = rect.left + rect.width / 2 - 160 // 160 = half of w-80 (320px)
      if (left < 8) left = 8
      if (left + 320 > window.innerWidth - 8) left = window.innerWidth - 328
      // Estimate tooltip height (~200px) and flip above if it would overflow viewport
      const estimatedHeight = 200
      let top = rect.bottom + 8
      if (top + estimatedHeight > window.innerHeight - 8) {
        top = rect.top - estimatedHeight - 8
        if (top < 8) top = 8
      }
      setTooltipPos({ top, left })
    }
  }, [])

  const handleEnter = () => {
    if (!pinned) {
      setHovered(true)
      updatePosition()
    }
  }

  const handleLeave = () => {
    if (!pinned) {
      setHovered(false)
    }
  }

  const handleClick = () => {
    const next = !pinned
    setPinned(next)
    if (next) {
      setHovered(false)
      updatePosition()
    }
  }

  // Always show for non-logged-in users; respect toggle for logged-in users
  if (isAuthenticated && !learnerMode) return null

  const sizeClass = size === 4 ? 'h-4 w-4' : 'h-5 w-5'
  const isAbsolute = className.includes('absolute')
  const shouldPortal = isAbsolute || usePortal

  const iconColor = pinned
    ? 'text-danger'
    : 'text-info hover:opacity-80'

  return (
    <>
      <button
        type="button"
        ref={iconRef}
        className={`${isAbsolute ? 'inline-flex items-center' : 'relative inline-flex items-center'} p-0.5 rounded-md hover:bg-muted/60 transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring ${className}`}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onClick={handleClick}
        aria-pressed={pinned}
        aria-label={pinned ? 'Unpin tip' : 'Show tip'}
      >
        <HelpCircle className={`${sizeClass} ${iconColor} cursor-pointer transition-colors`} />
        {visible && !shouldPortal && (
          <div className={`absolute left-1/2 -translate-x-1/2 top-full mt-2 ${OVERLAY_LAYER_CLASS.tooltip} pointer-events-none ${tooltipClasses}`}>
            <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-info-subtle border-l border-t border-info-muted" />
            <div className="relative z-10 leading-relaxed learner-tooltip-content">{description}</div>
          </div>
        )}
      </button>
      {visible && shouldPortal && tooltipPos && createPortal(
        <div
          className={`fixed pointer-events-none ${tooltipClasses}`}
          style={{ top: tooltipPos.top, left: tooltipPos.left, zIndex: portalTooltipZ }}
        >
          <div className="leading-relaxed learner-tooltip-content">{description}</div>
        </div>,
        document.body
      )}
    </>
  )
}
