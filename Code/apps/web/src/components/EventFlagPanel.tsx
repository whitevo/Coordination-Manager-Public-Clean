import { useEffect, useState } from 'react'
import { AlertTriangle, Flag, Loader2, RefreshCw } from 'lucide-react'
import { format } from 'date-fns'
import { apiClient } from '@/lib/api-client'
import { useToast } from '@/components/Toast'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'

export interface EventModerationTarget {
  type: 'user_event' | 'meeting'
  id: string
}

interface EventFlagPanelProps {
  eventTitle: string
  targets: EventModerationTarget[]
  onClose: () => void
  onSubmitted: () => void
}

type FlagType = 'removal' | 'confirmation'

export default function EventFlagPanel({ eventTitle, targets, onClose, onSubmitted }: EventFlagPanelProps) {
  const { showToast } = useToast()
  const [flagType, setFlagType] = useState<FlagType>('confirmation')
  const [rationale, setRationale] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [canRequestConfirmation, setCanRequestConfirmation] = useState(true)
  const [lastConfirmedAt, setLastConfirmedAt] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiClient.post('/api/event-flags/check-status', { targets })
      .then(res => {
        if (cancelled) return
        if (res.data) {
          const allowed = res.data.canRequestConfirmation ?? true
          setCanRequestConfirmation(allowed)
          setLastConfirmedAt(res.data.lastConfirmedAt || null)
          if (!allowed) {
            setFlagType('removal')
          }
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [targets])

  const submitFlag = async () => {
    const trimmedRationale = rationale.trim()
    if (flagType === 'removal' && trimmedRationale.length < 2) {
      showToast('Please provide a rationale of at least 2 characters.', 'error')
      return
    }

    setSubmitting(true)
    try {
      await apiClient.post('/api/event-flags', {
        flagType,
        rationale: trimmedRationale || undefined,
        targets,
      })
      window.dispatchEvent(new Event('eventFlagsChanged'))
      showToast(
        flagType === 'removal'
          ? 'The event was removed from public listings pending review.'
          : 'The coordinator has 7 days to confirm this event.',
      )
      onSubmitted()
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string; error?: string } } })
        .response?.data
      showToast(message?.message || message?.error || 'Could not submit the event flag.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Flag className="h-5 w-5 shrink-0 text-danger" />
          Flag public event
        </span>
      }
      description={<span className="block truncate">{eventTitle}</span>}
      kind="focusModal"
      size="md"
      showCloseButton
      closeLabel="Close flag panel"
      scrollBody
      footer={
        <div className="flex gap-2">
          <Button emphasis="outline" onClick={onClose} className="flex-1">Cancel</Button>
          <Button
            intent="danger"
            onClick={() => void submitFlag()}
            disabled={submitting || targets.length === 0 || (flagType === 'removal' && rationale.trim().length < 2)}
            icon={submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4" />}
            className="flex-1"
          >
            Submit flag
          </Button>
        </div>
      }
    >
        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="mb-2 text-xs font-semibold uppercase text-muted-foreground">What needs attention?</legend>
            <label className={`flex gap-3 rounded-md border p-3 ${!canRequestConfirmation ? 'cursor-not-allowed opacity-60 bg-muted/30 border-border' : 'cursor-pointer'} ${flagType === 'confirmation' ? 'border-warning-muted bg-warning-subtle' : 'border-border'}`}>
              <input
                type="radio"
                name="flagType"
                disabled={!canRequestConfirmation}
                checked={flagType === 'confirmation'}
                onChange={() => canRequestConfirmation && setFlagType('confirmation')}
                className="mt-1 accent-warning disabled:cursor-not-allowed"
              />
              <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>
                <span className="block text-sm font-medium">Request confirmation</span>
                <span className="block text-xs text-muted-foreground">
                  {canRequestConfirmation ? (
                    'Ask the coordinator to confirm that this recurring meeting still happens. It stays public for 7 days.'
                  ) : (
                    <span className="text-warning font-medium">
                      Confirmed on {lastConfirmedAt ? format(new Date(lastConfirmedAt), 'MMM d, yyyy HH:mm') : 'a recent date'}. Confirmation cannot be requested again for 7 days.
                    </span>
                  )}
                </span>
              </span>
            </label>
            <label className={`flex cursor-pointer gap-3 rounded-md border p-3 ${flagType === 'removal' ? 'border-danger-muted bg-danger-subtle' : 'border-border'}`}>
              <input type="radio" name="flagType" checked={flagType === 'removal'} onChange={() => setFlagType('removal')} className="mt-1 accent-danger" />
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
              <span>
                <span className="block text-sm font-medium">Remove from public</span>
                <span className="block text-xs text-muted-foreground">Hide every source represented by this event while its coordinators review the report.</span>
              </span>
            </label>
          </fieldset>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold">
              Rationale {flagType === 'removal' ? '(required)' : '(optional)'}
            </span>
            <textarea
              value={rationale}
              onChange={event => setRationale(event.target.value)}
              maxLength={1000}
              rows={5}
              placeholder="Describe what should be checked"
              className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <span className="block text-right text-[11px] text-muted-foreground">{rationale.trim().length}/1000</span>
          </label>
        </div>
    </Dialog>
  )
}