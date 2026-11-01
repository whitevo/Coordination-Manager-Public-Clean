import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, EyeOff, Loader2, RefreshCw, Scale, ShieldCheck, X } from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import { apiClient } from '@/lib/api-client'
import { useToast } from '@/components/Toast'
import { notifyPublicEventsSync } from '@/lib/public-events-sync'
import MobilePanelSwitcher from './MobilePanelSwitcher'
import type { PanelId } from './panel-types'
import { SHELL_LAYER_CLASS } from '../lib/overlay-layers'
import { Button, IconButton } from './ui'

interface CommonsSidePanelProps {
  isOpen: boolean
  onClose: () => void
  onPanelChange: (panel: Exclude<PanelId, null>) => void
}

interface EventFlagTarget {
  type: 'user_event' | 'meeting'
  id: string
  title: string
  status: 'pending' | 'confirmed' | 'removal_accepted' | 'updated' | 'expired'
  responded_at: string | null
}

interface EventFlag {
  id: string
  flag_type: 'removal' | 'confirmation'
  status: EventFlagTarget['status']
  rationale: string | null
  reporter_type: 'authenticated' | 'anonymous'
  respond_by: string | null
  resolved_at: string | null
  created_at: string
  targets: EventFlagTarget[]
}

type ResponseAction = 'confirmed' | 'removal_accepted' | 'updated'

export function CommonsSidePanel({ isOpen, onClose, onPanelChange }: CommonsSidePanelProps) {
  const { showToast } = useToast()
  const [flags, setFlags] = useState<EventFlag[]>([])
  const [loading, setLoading] = useState(false)
  const [respondingId, setRespondingId] = useState<string | null>(null)

  const loadFlags = useCallback(async () => {
    if (!isOpen) return
    setFlags([])
    setLoading(true)
    try {
      const response = await apiClient.get('/api/event-flags/mine')
      setFlags(response.data.flags || [])
    } catch {
      showToast('Could not load event flags.', 'error')
    } finally {
      setLoading(false)
    }
  }, [isOpen, showToast])

  useEffect(() => {
    void loadFlags()
  }, [loadFlags])

  useEffect(() => {
    const refresh = () => void loadFlags()
    window.addEventListener('eventFlagsChanged', refresh)
    return () => window.removeEventListener('eventFlagsChanged', refresh)
  }, [loadFlags])

  const respond = async (flagId: string, action: ResponseAction, flagType?: 'removal' | 'confirmation') => {
    setRespondingId(flagId)
    try {
      await apiClient.post(`/api/event-flags/${flagId}/respond`, { action })
      let toastMsg = 'Flag response saved.'
      if (action === 'confirmed') {
        toastMsg = flagType === 'removal'
          ? 'Event republished to public calendar.'
          : 'Event confirmed active and public status maintained.'
      } else if (action === 'removal_accepted') {
        toastMsg = flagType === 'removal'
          ? 'Removal approved. Event is now private.'
          : 'Event set to private.'
      } else if (action === 'updated') {
        toastMsg = 'Event details marked as updated.'
      }
      showToast(toastMsg)
      window.dispatchEvent(new CustomEvent('cm:hover-event-flag', { detail: null }))
      notifyPublicEventsSync('flag-response')
      await loadFlags()
      window.dispatchEvent(new Event('eventFlagsChanged'))
    } catch (error) {
      const data = (error as { response?: { data?: { message?: string; error?: string } } }).response?.data
      showToast(data?.message || data?.error || 'Could not respond to the flag.', 'error')
    } finally {
      window.dispatchEvent(new CustomEvent('cm:hover-event-flag', { detail: null }))
      setRespondingId(null)
    }
  }

  return (
    <aside
      className={`fixed inset-y-0 right-0 ${SHELL_LAYER_CLASS.sidePanel} w-screen transition-transform duration-300 ease-in-out ${
        isOpen ? 'translate-x-0 pointer-events-auto sm:w-88 md:w-96' : 'translate-x-full pointer-events-none sm:w-0'
      } sm:sticky sm:top-0 sm:h-screen sm:shrink-0 sm:overflow-hidden sm:translate-x-0 sm:pointer-events-auto`}
    >
      <div className="ml-auto flex h-full w-screen flex-col border-l-2 border-feature-commons bg-card shadow-xl sm:w-88 sm:min-w-88 md:w-96 md:min-w-[24rem]">
        <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-3">
          <div className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-feature-commons" />
            <div>
              <h2 className="text-sm font-semibold">Commons</h2>
              <p className="text-[11px] text-muted-foreground">Public event confirmations and reports</p>
            </div>
          </div>
          <IconButton label="Close" icon={<X />} onClick={onClose} />
        </div>
        <MobilePanelSwitcher activePanel="commons" onPanelChange={onPanelChange} />

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {loading && flags.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading flags...
            </div>
          ) : (() => {
            const actionableFlags = flags.filter(flag => {
              return (flag.status === 'pending' || flag.status === 'expired') &&
                flag.targets.some(target => target.status === 'pending' || target.status === 'expired')
            })

            if (actionableFlags.length === 0) {
              return (
                <div className="py-12 text-center">
                  <ShieldCheck className="mx-auto mb-3 h-9 w-9 text-success" />
                  <p className="text-sm font-medium">No event flags</p>
                  <p className="mt-1 text-xs text-muted-foreground">Your public events have no moderation requests.</p>
                </div>
              )
            }

            return actionableFlags.map(flag => {
              const isRemoval = flag.flag_type === 'removal'
              const isActionable = true
              const deadline = flag.respond_by
                ? new Date(flag.respond_by)
                : flag.created_at
                  ? new Date(new Date(flag.created_at).getTime() + (isRemoval ? 14 : 7) * 24 * 60 * 60 * 1000)
                  : null

              return (
                <article
                  key={flag.id}
                  onMouseEnter={() => {
                    window.dispatchEvent(new CustomEvent('cm:hover-event-flag', {
                      detail: {
                        targetIds: flag.targets.map(t => t.id),
                        targetTitles: flag.targets.map(t => t.title),
                      },
                    }))
                  }}
                  onMouseLeave={() => {
                    window.dispatchEvent(new CustomEvent('cm:hover-event-flag', { detail: null }))
                  }}
                  className={`rounded-md border p-3 transition-colors ${
                    isRemoval
                      ? 'border-danger-muted bg-danger-subtle hover:bg-danger-muted'
                      : 'border-warning-muted bg-warning-subtle hover:bg-warning-muted'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {isRemoval
                      ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                      : <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-warning" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-semibold">
                          {isRemoval ? 'Removal requested' : 'Confirmation requested'}
                        </h3>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          isActionable
                            ? isRemoval
                              ? 'bg-danger-subtle text-danger'
                              : 'bg-warning-subtle text-warning'
                            : 'bg-muted text-muted-foreground'
                        }`}>
                          {isActionable ? 'Action needed' : flag.status.replace('_', ' ')}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {flag.reporter_type === 'anonymous' ? 'Anonymous community report' : 'Account community report'} - {format(new Date(flag.created_at), 'MMM d, yyyy HH:mm')}
                      </p>
                    </div>
                  </div>

                  {/* Public visibility status banner */}
                  {isActionable && (
                    <div className={`mt-2.5 flex items-center gap-1.5 rounded px-2 py-1 text-xs ${
                      isRemoval
                        ? 'bg-danger-subtle text-danger'
                        : 'bg-warning-subtle text-warning'
                    }`}>
                      {isRemoval ? (
                        <>
                          <EyeOff className="h-3.5 w-3.5 shrink-0" />
                          <span>Hidden from public calendar until reviewed</span>
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-3.5 w-3.5 shrink-0" />
                          <span>Active on public calendar — confirmation needed</span>
                        </>
                      )}
                    </div>
                  )}

                  <div className="mt-2.5 space-y-1">
                    {flag.targets.map(target => (
                      <div key={`${target.type}:${target.id}`} className="flex items-center justify-between gap-2 rounded bg-muted/50 px-2 py-1.5 text-xs">
                        <span className="truncate">{target.title}</span>
                        <span className="shrink-0 capitalize text-muted-foreground">{target.status.replace('_', ' ')}</span>
                      </div>
                    ))}
                  </div>

                  {flag.rationale && (
                    <p className={`mt-2.5 whitespace-pre-wrap wrap-break-word border-l-2 pl-2 text-xs text-muted-foreground ${
                      isRemoval ? 'border-danger-muted' : 'border-warning-muted'
                    }`}>
                      {flag.rationale}
                    </p>
                  )}

                  {/* Deadline text */}
                  {isActionable && deadline && flag.status !== 'expired' && (
                    <p className={`mt-2.5 flex items-center gap-1.5 text-xs ${
                      isRemoval ? 'text-danger' : 'text-warning'
                    }`}>
                      <Clock className="h-3.5 w-3.5" />
                      {isRemoval
                        ? `Auto-approves removal ${formatDistanceToNow(deadline, { addSuffix: true })}`
                        : `Respond ${formatDistanceToNow(deadline, { addSuffix: true })}`}
                    </p>
                  )}

                  {isActionable && flag.status === 'expired' && (
                    <p className="mt-2.5 flex items-center gap-1.5 text-xs font-medium text-danger">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {isRemoval
                        ? 'Response overdue — removal auto-approved'
                        : 'Response overdue — event moved to private'}
                    </p>
                  )}

                  {/* Action buttons */}
                  <div className="mt-3">
                    {isRemoval ? (
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          intent="danger"
                          size="compact"
                          onClick={() => void respond(flag.id, 'removal_accepted', flag.flag_type)}
                          loading={respondingId === flag.id}
                          icon={<EyeOff className="h-3.5 w-3.5" />}
                        >
                          Approve removal
                        </Button>
                        <Button
                          intent="primary"
                          emphasis="outline"
                          size="compact"
                          onClick={() => void respond(flag.id, 'confirmed', flag.flag_type)}
                          loading={respondingId === flag.id}
                          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                        >
                          Republish
                        </Button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          intent="primary"
                          emphasis="outline"
                          size="compact"
                          onClick={() => void respond(flag.id, 'confirmed', flag.flag_type)}
                          loading={respondingId === flag.id}
                          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                        >
                          Confirm active
                        </Button>
                        <Button
                          intent="danger"
                          emphasis="outline"
                          size="compact"
                          onClick={() => void respond(flag.id, 'removal_accepted', flag.flag_type)}
                          disabled={respondingId === flag.id}
                        >
                          Keep private
                        </Button>
                      </div>
                    )}
                  </div>
                </article>
              )
            })
          })()}
        </div>
      </div>
    </aside>
  )
}