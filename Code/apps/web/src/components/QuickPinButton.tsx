import { Pin, PinOff } from 'lucide-react'
import { QUICK_PIN_BUTTON_BASE_CLASS, QUICK_PIN_BUTTON_PINNED_CLASS, QUICK_PIN_BUTTON_UNPINNED_CLASS, QUICK_PIN_BUTTON_STYLE } from './quick-pin-button-styles'

interface QuickPinButtonProps {
  pinned: boolean
  onToggle: () => void
  label: string
  className?: string
}

// Shared pin/unpin toggle used to add or remove an item from a "quick button" bar.
export default function QuickPinButton({ pinned, onToggle, label, className }: QuickPinButtonProps) {
  const PinIcon = pinned ? PinOff : Pin

  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onToggle()
      }}
      className={`${QUICK_PIN_BUTTON_BASE_CLASS} ${pinned ? QUICK_PIN_BUTTON_PINNED_CLASS : QUICK_PIN_BUTTON_UNPINNED_CLASS} ${className || ''}`}
      style={QUICK_PIN_BUTTON_STYLE}
      title={`${pinned ? 'Remove' : 'Add'} ${label} quick button`}
      aria-label={`${pinned ? 'Remove' : 'Add'} ${label} quick button`}
      aria-pressed={pinned}
    >
      <PinIcon className="h-3.5 w-3.5" />
    </button>
  )
}
