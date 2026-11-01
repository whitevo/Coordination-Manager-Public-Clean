import { cn } from '../../lib/cn'

export interface ScoreDisplayProps {
  /** 0..1 or 0..100; values above 1 are treated as already-percent. */
  value: number
  /** Names the measure, e.g. "match confidence". */
  label: string
  showBar?: boolean
  className?: string
}

/**
 * A measured value such as match confidence.
 *
 * Deliberately colour-free: the number means "how certain", not "how good".
 * Whether the match was applied is separate state and belongs in a StatusBadge
 * next to this, not encoded in this component's colour.
 */
export function ScoreDisplay({ value, label, showBar = false, className }: ScoreDisplayProps) {
  const percent = Math.round(Math.max(0, Math.min(100, value > 1 ? value : value * 100)))

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span
        role="meter"
        aria-label={label}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground"
      >
        {percent}%
      </span>
      {showBar && (
        <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <span className="block h-full rounded-full bg-neutral" style={{ width: `${percent}%` }} />
        </span>
      )}
    </span>
  )
}
