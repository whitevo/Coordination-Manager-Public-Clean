import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../lib/cn'

interface CalendarQuickToolButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  icon: ReactNode
}

export function CalendarQuickToolButton({
  active,
  icon,
  children,
  className,
  ...props
}: CalendarQuickToolButtonProps) {
  return (
    <button
      type="button"
      {...props}
      aria-pressed={active}
      className={cn(
        'relative inline-flex h-10 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium text-foreground transition-colors',
        'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
        active
          ? 'border-primary bg-primary-muted ring-1 ring-primary'
          : 'border-primary-muted bg-primary-subtle hover:bg-primary-muted',
        className
      )}
    >
      {icon}
      {children}
    </button>
  )
}
