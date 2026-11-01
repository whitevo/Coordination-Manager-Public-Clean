import type { TimeItemRecurrence } from '@/pages/time-management-event-reconciliation'
import { Button } from './ui'

interface TimeItemRecurrenceStatusProps {
  eventId: string
  recurrence: TimeItemRecurrence
  busy: boolean
  onGoToLatest: () => void
  onComplete: () => void
  completedAt?: string | null
}

export function TimeItemRecurrenceStatus({ eventId, recurrence, busy, onGoToLatest, onComplete, completedAt }: TimeItemRecurrenceStatusProps) {
  const isLatest = recurrence.latest_event_id === eventId
  const completed = recurrence.status === 'completed'
  return (
    <div aria-label="Recurrence status" className="flex flex-wrap items-center gap-1.5 text-[11px]">
      {completed && <span className="font-semibold text-success">Recurrence completed</span>}
      {completedAt && <span className="font-semibold text-success">Time Item completed</span>}
      {!isLatest && (
        <Button emphasis="outline" size="micro" disabled={busy || !recurrence.latest_event_id} onClick={onGoToLatest}>
          Go to latest occurrence
        </Button>
      )}
      {isLatest && !completed && (
        <Button emphasis="outline" intent="primary" size="micro" disabled={busy} onClick={onComplete}>
          Complete recurrence
        </Button>
      )}
    </div>
  )
}
