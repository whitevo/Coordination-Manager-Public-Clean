interface ConditionalRecurrenceIconProps {
  completed?: boolean
}

export function ConditionalRecurrenceIcon({ completed = false }: ConditionalRecurrenceIconProps) {
  const label = completed ? 'Recurrence completed' : 'Repeats until marked as completed.'
  return (
    <span title={label} className={`inline-flex leading-none ${completed ? 'text-success' : 'text-foreground'}`}>
      <svg role="img" aria-label={label} className="h-3 w-3" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 20H10a7 7 0 0 1 0-14V3M6 7l4-4 4 4" />
        {completed ? <path d="m16 7 2 2 4-4" /> : <circle cx="20" cy="4" r="1" fill="currentColor" stroke="none" />}
      </svg>
    </span>
  )
}
