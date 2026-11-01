import { useState, type ReactNode } from 'react'
import { TimerOff, UserCheck } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { IconButton, StatusBadge } from '@/components/ui'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useToast } from '@/components/Toast'

export type GuardianUndoKind = 'unban' | 'unmute'

/** Latest successful moderator undo per flagged row (from GET /api/guardian/flagged). */
export interface GuardianUndoState {
  unban_at?: string
  unmute_at?: string
}

interface GuardianUndoActionsProps {
  flaggedId: string
  actionTaken: string | null | undefined
  undo: GuardianUndoState | null | undefined
  userLabel: string
  serverLabel: string
  /** Called after Discord confirmed the undo; the parent updates the row in place. */
  onUndone: (flaggedId: string, kind: GuardianUndoKind, at: string) => void
  /** Called after a failed attempt (the failure is recorded in the System Log). */
  onFailed?: () => void
}

interface UndoResponse {
  status?: string
  message?: string
  undone_at?: string
}

const UNDO_COPY: Record<GuardianUndoKind, {
  path: string
  title: string
  confirmText: string
  buttonLabel: string
  doneLabel: string
}> = {
  unban: {
    path: 'unban',
    title: 'Unban user?',
    confirmText: 'Unban',
    buttonLabel: 'Unban user',
    doneLabel: 'Unbanned',
  },
  unmute: {
    path: 'untimeout',
    title: 'Remove timeout?',
    confirmText: 'Remove timeout',
    buttonLabel: 'Remove timeout',
    doneLabel: 'Timeout removed',
  },
}

function tokens(actionTaken: string | null | undefined): string[] {
  return (actionTaken || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
}

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = error.response
    if (typeof response === 'object' && response !== null && 'data' in response) {
      const data = response.data
      if (typeof data === 'object' && data !== null && 'message' in data && typeof data.message === 'string') {
        return data.message
      }
    }
  }
  return fallback
}

/**
 * Per-row moderator undo controls for the Guardian Flagged Messages table:
 * "Unban user" when the row's actions include a ban, "Remove timeout" when
 * they include a timeout. Each asks for confirmation first.
 */
export default function GuardianUndoActions({
  flaggedId,
  actionTaken,
  undo,
  userLabel,
  serverLabel,
  onUndone,
  onFailed,
}: GuardianUndoActionsProps) {
  const { showToast } = useToast()
  const [confirming, setConfirming] = useState<GuardianUndoKind | null>(null)
  const [pending, setPending] = useState<GuardianUndoKind | null>(null)

  const actions = tokens(actionTaken)
  const banned = actions.includes('banned') || actions.includes('ban')
  const timedOut = actions.includes('timeout') || actions.includes('mute') || actions.includes('muted')
  if (!banned && !timedOut) return null

  const run = async (kind: GuardianUndoKind) => {
    setConfirming(null)
    setPending(kind)
    try {
      const res = await apiClient.post<UndoResponse>(`/api/guardian/flagged/${flaggedId}/${UNDO_COPY[kind].path}`)
      showToast(res.data.message || UNDO_COPY[kind].doneLabel, 'success')
      onUndone(flaggedId, kind, res.data.undone_at || new Date().toISOString())
    } catch (error) {
      showToast(errorMessage(error, `Could not ${UNDO_COPY[kind].confirmText.toLowerCase()}. Try again.`), 'error')
      onFailed?.()
    } finally {
      setPending(null)
    }
  }

  const renderControl = (kind: GuardianUndoKind, icon: ReactNode) => {
    const doneAt = kind === 'unban' ? undo?.unban_at : undo?.unmute_at
    if (doneAt) {
      return (
        <span title={`${UNDO_COPY[kind].doneLabel} ${new Date(doneAt).toLocaleString()}`}>
          <StatusBadge tone="success" density="compact">{UNDO_COPY[kind].doneLabel}</StatusBadge>
        </span>
      )
    }
    return (
      <IconButton
        label={UNDO_COPY[kind].buttonLabel}
        icon={icon}
        size="micro"
        loading={pending === kind}
        disabled={pending !== null}
        onClick={() => setConfirming(kind)}
      />
    )
  }

  const message = confirming === 'unban'
    ? `Lift the Discord ban for ${userLabel} on ${serverLabel}. They can rejoin with a new invite.`
    : `Remove the active Discord timeout for ${userLabel} on ${serverLabel}. They can talk again right away.`

  return (
    <>
      {banned && renderControl('unban', <UserCheck />)}
      {timedOut && renderControl('unmute', <TimerOff />)}
      <ConfirmDialog
        open={confirming !== null}
        title={confirming ? UNDO_COPY[confirming].title : undefined}
        message={message}
        intent="primary"
        confirmText={confirming ? UNDO_COPY[confirming].confirmText : 'Confirm'}
        onConfirm={() => { if (confirming) void run(confirming) }}
        onCancel={() => setConfirming(null)}
      />
    </>
  )
}
