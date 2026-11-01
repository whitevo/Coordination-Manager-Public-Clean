import { cn } from '../../lib/cn'

export interface CountBadgeProps {
  count: number
  /** Describes what is counted, e.g. "unread messages". */
  label?: string
  /** Emphasises the count when it belongs to the active context. */
  emphasis?: 'quiet' | 'active'
  /** Renders as "99+" past this value. */
  max?: number
  className?: string
}

/**
 * Shows a quantity. A count is never a state, so this has no success/error
 * variant -- a badge showing "5" should not imply five problems.
 */
export function CountBadge({
  count,
  label,
  emphasis = 'quiet',
  max = 99,
  className,
}: CountBadgeProps) {
  const display = count > max ? `${max}+` : String(count)

  return (
    <span
      aria-label={label ? `${count} ${label}` : undefined}
      className={cn(
        'inline-flex min-w-5 items-center justify-center rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
        emphasis === 'active'
          ? 'bg-primary-subtle text-primary'
          : 'bg-muted text-muted-foreground',
        className
      )}
    >
      {display}
    </span>
  )
}
