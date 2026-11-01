import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/cn'
import {
  BUTTON_INTENT_CLASS,
  CONTROL_SIZE_CLASS,
  type ControlSize,
  type Emphasis,
  type Intent,
} from '../../lib/design-tokens'

/**
 * `micro` (h-6, text-xs) is for dense rows, grid header controls and in-input
 * clear buttons only; it is still at least 24px tall and wide.
 */
export type ButtonSize = ControlSize

const SIZE_CLASS: Record<ButtonSize, string> = CONTROL_SIZE_CLASS

const ICON_SIZE_CLASS: Record<ButtonSize, string> = {
  micro: 'h-3.5 w-3.5',
  compact: 'h-3.5 w-3.5',
  standard: 'h-4 w-4',
}

const BASE_CLASS =
  'inline-flex items-center justify-center rounded-md font-medium transition-colors ' +
  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Visual weight. Defaults to solid. */
  emphasis?: Emphasis
  /**
   * What the action means. Defaults to `neutral` on purpose: a screen has at
   * most one primary action, so primary has to be asked for.
   *
   * `success`, `info` and `warning` are for status-bearing actions only
   * (save-state feedback, link-exists tiles, warning-banner actions), never
   * for decoration.
   */
  intent?: Intent
  /** `micro`, `compact` or `standard`. Defaults to standard. */
  size?: ButtonSize
  /** Shows a spinner and blocks interaction without collapsing the layout. */
  loading?: boolean
  /** Rendered before the label. */
  icon?: ReactNode
  fullWidth?: boolean
  children: ReactNode
}

/**
 * The single button surface for the app.
 *
 * There is intentionally no blue, green, or indigo variant: `primary` resolves
 * through the active theme, so a hue cannot be hardcoded by copying a recipe.
 *
 * `className` is for layout only (margin, flex, width, grid placement).
 * `cn()` does not resolve Tailwind conflicts, so a visual class passed here
 * (colour, height, padding, text size) competes with the primitive's own
 * classes by stylesheet order. Change visuals through `emphasis`, `intent`
 * and `size` instead.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    emphasis = 'solid',
    intent = 'neutral',
    size = 'standard',
    loading = false,
    icon,
    fullWidth = false,
    className,
    disabled,
    type = 'button',
    children,
    ...rest
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        BASE_CLASS,
        SIZE_CLASS[size],
        BUTTON_INTENT_CLASS[emphasis][intent],
        fullWidth && 'w-full',
        className
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 className={cn(ICON_SIZE_CLASS[size], 'animate-spin')} aria-hidden="true" />
      ) : (
        icon
      )}
      {children}
    </button>
  )
})
