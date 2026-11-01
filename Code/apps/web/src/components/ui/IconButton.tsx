import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/cn'
import { BUTTON_INTENT_CLASS, type Emphasis, type Intent } from '../../lib/design-tokens'

/**
 * `micro` (h-6 w-6, 3.5 icon) is for dense rows, grid header controls and
 * in-input clear buttons only. h-6 is 1.5rem, so it stays at or above the 24px
 * minimum target at any root font of 16px or more. No `relative` + `after:`
 * hit-area extension is used: `relative` would compete with a caller's
 * `absolute` (the in-input clear button case) because cn() does not merge.
 */
export type IconButtonSize = 'micro' | 'compact' | 'standard'

/** compact/standard hit areas stay at/above 32px so touch targets do not vary per page. */
const SIZE_CLASS: Record<IconButtonSize, string> = {
  micro: 'h-6 w-6',
  compact: 'h-8 w-8',
  standard: 'h-10 w-10',
}

/**
 * Icon size lives on the child svg, never on the button, so the button's own
 * height and width are unambiguous. The `[&>svg]` selector outranks a class on
 * the icon itself, so every icon in one size renders the same.
 */
const ICON_SIZE_CLASS: Record<IconButtonSize, string> = {
  micro: '[&>svg]:h-3.5 [&>svg]:w-3.5',
  compact: '[&>svg]:h-4 [&>svg]:w-4',
  standard: '[&>svg]:h-4 [&>svg]:w-4',
}

const BASE_CLASS =
  'inline-flex shrink-0 items-center justify-center rounded-md transition-colors ' +
  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50'

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Required: an icon-only control has no visible text to name it. */
  label: string
  icon: ReactNode
  emphasis?: Emphasis
  /**
   * Defaults to `neutral`. `success`, `info` and `warning` are for
   * status-bearing actions only (save-state feedback, link-exists tiles,
   * warning-banner actions), never for decoration.
   */
  intent?: Intent
  /** `micro`, `compact` or `standard`. Defaults to compact. */
  size?: IconButtonSize
  loading?: boolean
  /** Renders the label as a tooltip too. Defaults to true. */
  showTitle?: boolean
}

/**
 * Icon-only action with a guaranteed accessible name and consistent hit area.
 *
 * `className` is for layout only (margin, positioning, grid placement); see
 * the note on Button and cn().
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    icon,
    emphasis = 'ghost',
    intent = 'neutral',
    size = 'compact',
    loading = false,
    showTitle = true,
    className,
    disabled,
    type = 'button',
    ...rest
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={showTitle ? label : undefined}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        BASE_CLASS,
        SIZE_CLASS[size],
        ICON_SIZE_CLASS[size],
        BUTTON_INTENT_CLASS[emphasis][intent],
        className
      )}
      {...rest}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : icon}
    </button>
  )
})
