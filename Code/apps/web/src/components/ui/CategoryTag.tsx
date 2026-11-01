import type { CSSProperties, ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { readableForegroundFor } from '../../lib/contrast'

const BASE_CLASS = 'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium'

export interface CategoryTagProps {
  children: ReactNode
  icon?: ReactNode
  /**
   * A user-chosen category colour as `#rrggbb`. When set, the foreground is
   * computed for contrast rather than assumed. Omit for a neutral tag.
   */
  color?: string | null
  className?: string
}

/**
 * Classifies an item (channel, category, label). Carries no state meaning, so
 * it never borrows success/warning/danger tokens.
 */
export function CategoryTag({ children, icon, color, className }: CategoryTagProps) {
  const style: CSSProperties | undefined = color
    ? {
        backgroundColor: color,
        color: readableForegroundFor(color),
        borderColor: color,
      }
    : undefined

  return (
    <span
      style={style}
      className={cn(BASE_CLASS, !color && 'border-border bg-muted text-muted-foreground', className)}
    >
      {icon}
      {children}
    </span>
  )
}
