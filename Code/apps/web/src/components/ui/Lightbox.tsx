import { useId } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { IconButton } from './IconButton'
import { useModalSurface } from './use-modal-surface'

/**
 * Media scrim: darker than the form scrims so the image reads as the only
 * content. Recorded in component-matrix (Lightbox); OVERLAY_SCRIM has no media
 * entry yet.
 */
const LIGHTBOX_SCRIM = 'bg-black/80 backdrop-blur-xs'

export interface LightboxProps {
  open: boolean
  onClose: () => void
  /** Image to show. Nothing renders while it is empty. */
  src: string | null | undefined
  /** Alternative text of the enlarged image. */
  alt: string
  /** Accessible name of the lightbox (visually hidden). Defaults to "Image preview". */
  title?: string
  /** Accessible name of the close button. */
  closeLabel?: string
  className?: string
}

/**
 * Full-screen image preview on the overlay layers.
 *
 * Portaled to document.body on the `focusModal` tier with the same focus trap,
 * focus return, Escape (topmost only), scroll lock and inert app root as
 * Dialog. Clicking the area around the image closes it; clicking the image does not.
 */
export function Lightbox({
  open,
  onClose,
  src,
  alt,
  title = 'Image preview',
  closeLabel = 'Close preview',
  className,
}: LightboxProps) {
  const titleId = useId()
  const isOpen = open && Boolean(src)
  const { layer, panelRef, handleKeyDown } = useModalSurface({ open: isOpen, onClose, kind: 'focusModal' })

  if (!isOpen || !layer || !src) return null

  return createPortal(
    <div
      style={{ zIndex: layer.z }}
      className={cn('fixed inset-0', LIGHTBOX_SCRIM)}
      onKeyDown={handleKeyDown}
      data-testid="lightbox-scrim"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex h-full w-full items-center justify-center p-4 focus:outline-hidden"
        onClick={event => {
          // Only the empty area around the image acts as the scrim.
          if (event.target === event.currentTarget) onClose()
        }}
      >
        <h2 id={titleId} className="sr-only">
          {title}
        </h2>
        <IconButton
          label={closeLabel}
          icon={<X />}
          emphasis="outline"
          size="standard"
          onClick={onClose}
          className="absolute right-4 top-4"
          data-dialog-chrome="close"
        />
        <img
          src={src}
          alt={alt}
          className={cn('max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl', className)}
        />
      </div>
    </div>,
    document.body
  )
}
