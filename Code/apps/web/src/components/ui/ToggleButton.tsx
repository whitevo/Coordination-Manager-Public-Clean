import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'
import {
  CONTROL_SIZE_CLASS,
  TOGGLE_PRESSED_CLASS,
  type ControlSize,
  type Intent,
} from '../../lib/design-tokens'

export interface ToggleButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  pressed: boolean
  onPressedChange: (pressed: boolean) => void
  icon?: ReactNode
  /** `micro`, `compact` or `standard`. Defaults to standard. */
  size?: ControlSize
  /**
   * Tint of the pressed state. Defaults to `primary`. `success`, `info` and
   * `warning` are for status-bearing modes only (for example a pressed
   * warning filter), never for decoration. Unpressed is always neutral.
   */
  intent?: Intent
  children: ReactNode
}

/**
 * A toolbar mode that stays pressed.
 *
 * Pressed uses the intent tint (theme primary by default) plus `aria-pressed`,
 * so the state is never carried by colour alone.
 */
export const ToggleButton = forwardRef<HTMLButtonElement, ToggleButtonProps>(function ToggleButton(
  { pressed, onPressedChange, icon, size = 'standard', intent = 'primary', className, children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={pressed}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        'inline-flex items-center justify-center rounded-md border font-medium transition-colors',
        'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
        CONTROL_SIZE_CLASS[size],
        pressed
          ? TOGGLE_PRESSED_CLASS[intent]
          : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
        className
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
})
