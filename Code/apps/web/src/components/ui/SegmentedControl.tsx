import type { KeyboardEvent, ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cn } from '../../lib/cn'
import { CONTROL_SIZE_CLASS, type ControlSize } from '../../lib/design-tokens'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
  /** Tooltip for the option. */
  title?: string
  /** Disables this option only; arrow-key navigation skips it. */
  disabled?: boolean
  /** Rendered as `data-testid` on the option button. */
  testId?: string
}

export interface SegmentedControlProps<T extends string> {
  /** Names the group for assistive tech. */
  label: string
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** `micro`, `compact` or `standard`. Defaults to standard. */
  size?: ControlSize
  /** Adds a check marker to the selected option, for colour-independent state. */
  showSelectedMarker?: boolean
  className?: string
}

const NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown'])
const PREV_KEYS = new Set(['ArrowLeft', 'ArrowUp'])

/**
 * Mutually exclusive choice where every option stays visible.
 *
 * Use this instead of a button that cycles through hidden states: the options
 * a user cannot see are options they cannot find.
 *
 * Arrow keys move to and select the next/previous enabled option (wrapping);
 * Home/End jump to the first/last enabled option. Disabled options are skipped.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  size = 'standard',
  showSelectedMarker = false,
  className,
}: SegmentedControlProps<T>) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const { key } = event
    if (!NEXT_KEYS.has(key) && !PREV_KEYS.has(key) && key !== 'Home' && key !== 'End') return
    const enabled = options.filter(option => !option.disabled)
    if (enabled.length === 0) return
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="radio"]')
    )
    const focusedIndex = buttons.findIndex(button => button === document.activeElement)
    const currentValue = focusedIndex >= 0 ? options[focusedIndex]?.value : value
    const currentEnabledIndex = enabled.findIndex(option => option.value === currentValue)

    let target: SegmentedOption<T> | undefined
    if (key === 'Home') {
      target = enabled[0]
    } else if (key === 'End') {
      target = enabled[enabled.length - 1]
    } else {
      const step = NEXT_KEYS.has(key) ? 1 : -1
      const start = currentEnabledIndex >= 0 ? currentEnabledIndex : step === 1 ? -1 : 0
      target = enabled[(start + step + enabled.length) % enabled.length]
    }
    if (!target) return

    event.preventDefault()
    buttons[options.indexOf(target)]?.focus()
    if (target.value !== value) onChange(target.value)
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className={cn('inline-flex rounded-md border border-border bg-background p-0.5', className)}
    >
      {options.map(option => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            title={option.title}
            disabled={option.disabled}
            data-testid={option.testId}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex items-center justify-center rounded font-medium transition-colors',
              'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:pointer-events-none disabled:opacity-50',
              CONTROL_SIZE_CLASS[size],
              selected
                ? 'bg-primary-subtle text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {selected && showSelectedMarker && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
            {option.icon}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
