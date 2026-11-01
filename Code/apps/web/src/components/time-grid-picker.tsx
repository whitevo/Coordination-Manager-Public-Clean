import { useEffect, useId, useRef, useState } from 'react'
import { Clock } from 'lucide-react'
import { OVERLAY_LAYER_CLASS } from '../lib/overlay-layers'
import { IconButton } from './ui/IconButton'
import { ToggleButton } from './ui/ToggleButton'

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
const DEFAULT_MINUTE_STEP = 15

function formatMinuteOfDay(minute: number): string {
  const safeMinute = Math.min(Math.max(Math.round(minute), 0), 24 * 60 - 1)
  const hours = Math.floor(safeMinute / 60)
  const minutes = safeMinute % 60
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
}

export interface TimeGridPickerProps {
  /** Visible field label, e.g. "Start" or "End". */
  label: string
  /** Minute of day (0-1439) currently selected. */
  valueMinute: number
  /** Called with the new minute of day when the user commits a valid time. */
  onChangeMinute: (minute: number) => void
  /** Minute grid granularity. Defaults to 15. */
  minuteStep?: number
  /** Edge of the field the popover aligns to. Defaults to left. */
  align?: 'left' | 'right'
}

/**
 * HH:mm text field with an hour/minute grid popover that closes as soon as a
 * value is chosen. Same selection pattern as the MeetingSidePanel time picker
 * (the Coordination Calendar fix for native time dropdowns staying open).
 */
export default function TimeGridPicker({
  label,
  valueMinute,
  onChangeMinute,
  minuteStep = DEFAULT_MINUTE_STEP,
  align = 'left',
}: TimeGridPickerProps) {
  const fieldId = useId()
  const panelId = `${fieldId}-picker`
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [draft, setDraft] = useState(() => formatMinuteOfDay(valueMinute))

  const selectedHour = String(Math.floor(valueMinute / 60)).padStart(2, '0')
  const selectedMinute = String(valueMinute % 60).padStart(2, '0')
  const minuteOptions = Array.from(
    { length: Math.ceil(60 / minuteStep) },
    (_, index) => String(index * minuteStep).padStart(2, '0'),
  )

  useEffect(() => {
    setDraft(formatMinuteOfDay(valueMinute))
  }, [valueMinute])

  const closePicker = () => {
    setIsOpen(false)
    triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!isOpen) return

    panelRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus()
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panelRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('pointerdown', dismissOutside)
    return () => document.removeEventListener('pointerdown', dismissOutside)
  }, [isOpen])

  const commitDraft = (value: string) => {
    setDraft(value)
    if (TIME_PATTERN.test(value)) {
      const [hours = '0', minutes = '0'] = value.split(':')
      onChangeMinute(Number.parseInt(hours, 10) * 60 + Number.parseInt(minutes, 10))
    }
  }

  return (
    <div className="relative min-w-0">
      <label htmlFor={fieldId} className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <div className="mt-1 flex items-center gap-1">
        <input
          id={fieldId}
          type="text"
          value={draft}
          pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
          placeholder="HH:mm"
          onChange={(event) => commitDraft(event.target.value)}
          onBlur={() => {
            if (!TIME_PATTERN.test(draft)) {
              setDraft(formatMinuteOfDay(valueMinute))
            }
          }}
          onKeyDown={(event) => {
            if ((event.altKey && event.key === 'ArrowDown') || event.key === 'F4') {
              event.preventDefault()
              setIsOpen(true)
            }
          }}
          className="w-full min-w-0 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:ring-2 focus:ring-primary"
        />
        <IconButton
          ref={triggerRef}
          label={`Open ${label.toLowerCase()} time picker`}
          aria-expanded={isOpen}
          aria-controls={panelId}
          icon={<Clock />}
          onClick={() => setIsOpen((open) => !open)}
        />
      </div>
      {isOpen && (
        <div
          ref={panelRef}
          id={panelId}
          role="group"
          aria-label={`Choose ${label.toLowerCase()} time (UTC)`}
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-full ${OVERLAY_LAYER_CLASS.popover} mt-1 grid w-64 max-w-[calc(100vw-1rem)] grid-cols-2 gap-2 rounded-md border border-border bg-card p-2 shadow-lg`}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              closePicker()
            }
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== triggerRef.current) {
              setIsOpen(false)
            }
          }}
        >
          <div role="group" aria-label="Hour">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Hour</p>
            <div className="grid grid-cols-4 gap-1">
              {Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0')).map((hour) => (
                <ToggleButton
                  key={hour}
                  size="compact"
                  pressed={hour === selectedHour}
                  aria-label={`Select ${label.toLowerCase()} hour ${hour}`}
                  onPressedChange={() => {
                    onChangeMinute(Number.parseInt(hour, 10) * 60 + (valueMinute % 60))
                    closePicker()
                  }}
                >
                  {hour}
                </ToggleButton>
              ))}
            </div>
          </div>
          <div role="group" aria-label="Minute">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Minute</p>
            <div className="grid grid-cols-2 gap-1">
              {minuteOptions.map((minute) => (
                <ToggleButton
                  key={minute}
                  size="compact"
                  pressed={minute === selectedMinute}
                  aria-label={`Select ${label.toLowerCase()} minute ${minute}`}
                  onPressedChange={() => {
                    onChangeMinute(Math.floor(valueMinute / 60) * 60 + Number.parseInt(minute, 10))
                    closePicker()
                  }}
                >
                  {minute}
                </ToggleButton>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
