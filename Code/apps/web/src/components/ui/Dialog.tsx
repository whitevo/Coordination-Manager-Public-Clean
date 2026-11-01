import { useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode, RefObject } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { OVERLAY_SCRIM, type OverlayKind } from '../../lib/overlay-layers'
import { IconButton } from './IconButton'
import { useModalSurface } from './use-modal-surface'

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl'

const SIZE_CLASS: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
}

export interface DialogProps {
  open: boolean
  onClose: () => void
  /** Visible heading; also names the dialog via aria-labelledby. */
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  /** Right-aligned action row. */
  actions?: ReactNode
  /** Free-form footer for layouts the right-aligned action row does not fit. */
  footer?: ReactNode
  /** `dialog` for decisions, `focusModal` for content-heavy forms. */
  kind?: Extract<OverlayKind, 'dialog' | 'focusModal'>
  /** Panel width. Defaults to `sm` for `dialog` and `2xl` for `focusModal`. */
  size?: DialogSize
  /** Blocks scrim-click and Escape when the choice cannot be deferred. */
  dismissible?: boolean
  /**
   * A press and release on the scrim closes the dialog. Defaults to
   * `dismissible`; set false to keep
   * Escape and the close button but ignore stray clicks outside the panel.
   */
  closeOnScrimClick?: boolean
  /** Renders a close (X) button in the header that calls `onClose`. */
  showCloseButton?: boolean
  /** Accessible name of the header close button. */
  closeLabel?: string
  /** Extra header controls rendered before the close button. */
  headerActions?: ReactNode
  /**
   * Keeps the header and footer fixed and scrolls only the body, for long
   * lists or forms whose primary action must stay reachable.
   */
  scrollBody?: boolean
  /** Element to focus on open instead of the default choice. */
  initialFocusRef?: RefObject<HTMLElement | null>
  className?: string
  /** Test id placed on the panel element. */
  panelTestId?: string
}

/**
 * The shared blocking-overlay shell.
 *
 * Owns scrim, layer, Escape, focus entry and return, and scroll lock, so those
 * are implemented once rather than per dialog. Escape only closes the topmost
 * dialog, so a dialog opened from a dialog does not close both.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  actions,
  footer,
  kind = 'dialog',
  size,
  dismissible = true,
  closeOnScrimClick,
  showCloseButton = false,
  closeLabel = 'Close',
  headerActions,
  scrollBody = false,
  initialFocusRef,
  className,
  panelTestId,
}: DialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const scrimCloses = closeOnScrimClick ?? dismissible
  const outsidePress = useRef(false)
  const outsideRelease = useRef(false)
  const { layer, panelRef, handleKeyDown } = useModalSurface({
    open,
    onClose,
    kind,
    dismissible,
    initialFocusRef,
  })

  if (!open || !layer) return null

  const hasHeaderControls = showCloseButton || Boolean(headerActions)
  const header = (
    <div
      className={cn(
        'flex items-start justify-between gap-3',
        scrollBody ? 'shrink-0 border-b border-border px-6 py-4' : description ? 'mb-6' : 'mb-4'
      )}
    >
      <div className="min-w-0 flex-1">
        <h2 id={titleId} className="text-lg font-bold">
          {title}
        </h2>
        {description && (
          <p id={descriptionId} className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {hasHeaderControls && (
        <div className="-mr-2 -mt-1 flex shrink-0 items-center gap-1" data-dialog-chrome="header">
          {headerActions}
          {showCloseButton && (
            <IconButton
              label={closeLabel}
              icon={<X />}
              onClick={onClose}
              data-dialog-chrome="close"
            />
          )}
        </div>
      )}
    </div>
  )

  return createPortal(
    <div
      style={{ zIndex: layer.z }}
      className={cn('fixed inset-0 flex items-center justify-center p-4', OVERLAY_SCRIM[kind])}
      onPointerDownCapture={event => {
        outsidePress.current = event.target === event.currentTarget && event.button === 0
        outsideRelease.current = false
      }}
      onPointerUpCapture={event => {
        outsideRelease.current = event.target === event.currentTarget
      }}
      onPointerCancel={() => {
        outsidePress.current = false
        outsideRelease.current = false
      }}
      onClick={event => {
        const close = scrimCloses && event.target === event.currentTarget
          && outsidePress.current && outsideRelease.current
        outsidePress.current = false
        outsideRelease.current = false
        if (close) onClose()
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        data-testid={panelTestId}
        onClick={event => event.stopPropagation()}
        className={cn(
          'w-full rounded-lg border border-border bg-card text-card-foreground shadow-xl focus:outline-hidden',
          SIZE_CLASS[size ?? (kind === 'dialog' ? 'sm' : '2xl')],
          scrollBody ? 'flex max-h-[85vh] flex-col overflow-hidden' : 'max-h-[90vh] overflow-y-auto p-6',
          className
        )}
      >
        {header}
        {scrollBody ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
        ) : (
          children
        )}
        {actions && (
          <div
            className={cn(
              'flex flex-wrap justify-end gap-2',
              scrollBody ? 'shrink-0 border-t border-border px-6 py-4' : 'mt-6'
            )}
          >
            {actions}
          </div>
        )}
        {footer && (
          <div className={scrollBody ? 'shrink-0 border-t border-border px-6 py-4' : 'mt-6'}>{footer}</div>
        )}
      </div>
    </div>,
    document.body
  )
}
