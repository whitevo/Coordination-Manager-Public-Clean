import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/cn'

export type DisclosureSize = 'compact' | 'standard' | 'section'

export type DisclosureHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

export interface DisclosureProps {
  /** Visible header text; also names the panel region. */
  title: ReactNode
  /** Secondary line under the title. */
  description?: ReactNode
  /** Leading icon; rendered muted and decorative. */
  icon?: ReactNode
  /**
   * Non-interactive trailing content before the chevron, such as a
   * CountBadge or StatusBadge. It sits inside the button, so never put a
   * control here.
   */
  trailing?: ReactNode
  /** Controlled open state. Pair with `onToggle`. */
  expanded?: boolean
  /** Called with the next open state on every toggle (controlled or not). */
  onToggle?: (expanded: boolean) => void
  /** Initial open state when uncontrolled. Defaults to false. */
  defaultExpanded?: boolean
  /** Wraps the button in an `h1`..`h6` so the header joins the outline. */
  headingLevel?: DisclosureHeadingLevel
  /**
   * `compact`: text-xs card/editor header (RecurrenceEditor);
   * `standard`: text-sm semibold sidebar section (CalendarPage);
   * `section`: text-lg semibold page section (EventsPage).
   * Defaults to standard.
   */
  size?: DisclosureSize
  /**
   * id of the controlled panel. Defaults to a generated id. When `children`
   * are passed the panel is rendered here with this id; otherwise render your
   * own panel with this id.
   */
  panelId?: string
  /** Panel content, rendered only while expanded. */
  children?: ReactNode
  /** Classes for the rendered panel (layout and spacing). */
  panelClassName?: string
  disabled?: boolean
  /** Rendered as `data-testid` on the header button. */
  testId?: string
  /** Layout-only classes for the wrapper (margin, flex, grid placement). */
  className?: string
}

const ROW_SIZE_CLASS: Record<DisclosureSize, string> = {
  compact: 'gap-2 px-3 py-2 text-xs font-medium',
  standard: 'gap-2 px-2 py-1.5 text-sm font-semibold',
  section: 'gap-2 px-1 py-1 text-lg font-semibold',
}

const ICON_SIZE_CLASS: Record<DisclosureSize, string> = {
  compact: '[&_svg]:h-3.5 [&_svg]:w-3.5',
  standard: '[&_svg]:h-4 [&_svg]:w-4',
  section: '[&_svg]:h-5 [&_svg]:w-5',
}

const CHEVRON_SIZE_CLASS: Record<DisclosureSize, string> = {
  compact: 'h-3.5 w-3.5',
  standard: 'h-4 w-4',
  section: 'h-5 w-5',
}

const DESCRIPTION_SIZE_CLASS: Record<DisclosureSize, string> = {
  compact: 'text-[11px]',
  standard: 'text-xs',
  section: 'text-sm',
}

/**
 * Full-width header row that shows and hides a section.
 *
 * Replaces the hand-rolled `aria-expanded` button + rotating ChevronDown
 * recipe. The chevron rotates 180deg when expanded (static under reduced
 * motion); state is also exposed through `aria-expanded`, so it is never
 * carried by the icon alone. Works controlled (`expanded` + `onToggle`) or
 * uncontrolled (`defaultExpanded`).
 */
export function Disclosure({
  title,
  description,
  icon,
  trailing,
  expanded: expandedProp,
  onToggle,
  defaultExpanded = false,
  headingLevel,
  size = 'standard',
  panelId,
  children,
  panelClassName,
  disabled,
  testId,
  className,
}: DisclosureProps) {
  const generatedId = useId()
  const resolvedPanelId = panelId ?? `${generatedId}-panel`
  const buttonId = `${generatedId}-button`
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(defaultExpanded)
  const isControlled = expandedProp !== undefined
  const expanded = isControlled ? expandedProp : uncontrolledExpanded

  const toggle = () => {
    const next = !expanded
    if (!isControlled) setUncontrolledExpanded(next)
    onToggle?.(next)
  }

  const button = (
    <button
      type="button"
      id={buttonId}
      aria-expanded={expanded}
      aria-controls={resolvedPanelId}
      disabled={disabled}
      data-testid={testId}
      onClick={toggle}
      className={cn(
        'flex w-full items-center justify-between rounded-md text-left text-foreground transition-colors',
        'hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:pointer-events-none disabled:opacity-50',
        ROW_SIZE_CLASS[size]
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {icon != null && (
          <span
            aria-hidden="true"
            className={cn('inline-flex shrink-0 text-muted-foreground', ICON_SIZE_CLASS[size])}
          >
            {icon}
          </span>
        )}
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{title}</span>
          {description != null && ' '}
          {description != null && (
            <span
              className={cn('font-normal text-muted-foreground', DESCRIPTION_SIZE_CLASS[size])}
            >
              {description}
            </span>
          )}
        </span>
      </span>
      {trailing != null && ' '}
      {trailing != null && <span className="inline-flex shrink-0 items-center">{trailing}</span>}
      <ChevronDown
        aria-hidden="true"
        className={cn(
          'shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none',
          CHEVRON_SIZE_CLASS[size],
          expanded && 'rotate-180'
        )}
      />
    </button>
  )

  const Heading = headingLevel ? (`h${headingLevel}` as const) : null

  return (
    <div className={className}>
      {Heading ? <Heading className="m-0">{button}</Heading> : button}
      {children !== undefined && expanded && (
        <div id={resolvedPanelId} role="region" aria-labelledby={buttonId} className={panelClassName}>
          {children}
        </div>
      )}
    </div>
  )
}
