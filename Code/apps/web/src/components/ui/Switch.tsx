import { forwardRef } from 'react'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** Accessible name. Required unless the switch is wired to a visible label. */
  label?: string
  size?: 'compact' | 'standard'
  variant?: 'default' | 'card'
  cardTone?: 'primary' | 'warning'
}

const TRACK_SIZE = {
  compact: 'h-5 w-9',
  standard: 'h-6 w-11',
}

const THUMB_SIZE = {
  compact: 'h-4 w-4',
  standard: 'h-5 w-5',
}

const THUMB_OFFSET = {
  compact: { on: 'translate-x-4', off: 'translate-x-0.5' },
  standard: { on: 'translate-x-5', off: 'translate-x-0.5' },
}

const CARD_TONE_CLASS = {
  primary: {
    interaction: 'hover:border-primary hover:bg-primary-subtle focus-visible:border-primary focus-visible:bg-primary-subtle',
    checked: 'border-primary-muted bg-primary-subtle',
    track: 'bg-primary',
    trace: 'text-primary',
  },
  warning: {
    interaction: 'hover:border-warning hover:bg-warning-subtle focus-visible:border-warning focus-visible:bg-warning-subtle',
    checked: 'border-warning-muted bg-warning-subtle',
    track: 'bg-warning',
    trace: 'text-warning',
  },
}

/**
 * Immediate on/off setting.
 *
 * Off is `neutral`, never red: turning something off is a choice, not an error.
 * On is the theme primary, so it follows a custom theme rather than being blue.
 */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onCheckedChange, label, size = 'standard', variant = 'default', cardTone = 'primary', children, className, disabled, ...rest },
  ref
) {
  const thumb = (
    <span
      className={cn(
        'absolute top-1/2 -translate-y-1/2 rounded-full bg-background shadow-sm transition-transform',
        variant === 'card' && 'motion-reduce:transition-none',
        THUMB_SIZE[size],
        checked ? THUMB_OFFSET[size].on : THUMB_OFFSET[size].off
      )}
    />
  )

  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        variant === 'card'
          ? 'switch-card flex w-full cursor-pointer items-center justify-between gap-3 rounded-md border p-2 text-left transition-colors motion-reduce:transition-none'
          : 'relative inline-flex shrink-0 rounded-full transition-colors',
        variant === 'card' && CARD_TONE_CLASS[cardTone].interaction,
        'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
        variant === 'card'
          ? checked ? CARD_TONE_CLASS[cardTone].checked : 'border-border bg-background/70'
          : cn(TRACK_SIZE[size], checked ? 'bg-primary' : 'bg-neutral-muted'),
        className
      )}
      {...rest}
    >
      {variant === 'card' ? (
        <>
          <span className="min-w-0">{children}</span>
          <span
            aria-hidden="true"
            className={cn(
              'relative inline-flex shrink-0 rounded-full transition-colors motion-reduce:transition-none',
              TRACK_SIZE[size],
              checked ? CARD_TONE_CLASS[cardTone].track : 'bg-neutral-muted'
            )}
          >
            <span className={cn('switch-card-trace pointer-events-none absolute -inset-1 rounded-full', CARD_TONE_CLASS[cardTone].trace)} />
            {thumb}
          </span>
        </>
      ) : (
        thumb
      )}
    </button>
  )
})
