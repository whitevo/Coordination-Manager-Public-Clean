import { CALENDAR_BUSY_BLOCK_COUNT } from '../lib/calendar-busy-overlay'

interface CalendarBusyOverlayProps {
  colors: readonly [string, string]
}

export default function CalendarBusyOverlay({ colors }: CalendarBusyOverlayProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-busy-overlay="true"
      className="pointer-events-none absolute inset-0 h-full w-full overflow-hidden"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      {Array.from({ length: CALENDAR_BUSY_BLOCK_COUNT }, (_, index) => {
        const start = (index / CALENDAR_BUSY_BLOCK_COUNT) * 92
        const end = ((index + 1) / CALENDAR_BUSY_BLOCK_COUNT) * 92
        return (
          <polygon
            key={index}
            points={`${start + 8},0 ${end + 8},0 ${end},100 ${start},100`}
            fill={colors[index % 2]}
            fillOpacity="0.4"
          />
        )
      })}
    </svg>
  )
}
