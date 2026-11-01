import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { STATUS_TONE_CLASS, type StatusTone } from '../../lib/design-tokens'

const BASE_CLASS = 'inline-flex items-center gap-1 rounded border font-medium'

const DENSITY_CLASS = {
  standard: 'px-2 py-0.5 text-xs',
  compact: 'px-1.5 py-0 text-[11px]',
}

export interface StatusBadgeProps {
  /** Normalized tone for the badge colour. */
  tone: StatusTone
  /** The domain label to display, e.g. "Opted out" rather than "neutral". */
  children: ReactNode
  icon?: ReactNode
  density?: keyof typeof DENSITY_CLASS
  className?: string
}

/**
 * Reports workflow state: does this need action, is it running, did it fail.
 *
 * Not for quantities (CountBadge), classifications (CategoryTag), or measured
 * values (ScoreDisplay) -- those are not states and must not be coloured as if
 * they were.
 */
export function StatusBadge({
  tone,
  children,
  icon,
  density = 'standard',
  className,
}: StatusBadgeProps) {
  return (
    <span className={cn(BASE_CLASS, DENSITY_CLASS[density], STATUS_TONE_CLASS[tone], className)}>
      {icon}
      {children}
    </span>
  )
}
