import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { apiClient } from '../../lib/api-client'
import { Button } from '../ui'
import ConfirmDialog from '../ConfirmDialog'
import { useToast } from '../Toast'
import {
  buildDeleteConfirmMessage,
  buildDeleteResultToast,
  countDeletableMessages,
  deleteErrorMessage,
} from './delete-posted-messages'
import type { DeletableLogEntry, DeleteMessagesSummary } from './delete-posted-messages'

// Deleting many DMs runs at the bot's bounded concurrency, so allow more than
// the default 30s client timeout.
const DELETE_REQUEST_TIMEOUT_MS = 5 * 60 * 1000

interface DeletePostedMessagesActionProps {
  scheduleId: string
  deliveryLog: DeletableLogEntry[]
  /** Called after the request settles so the caller can refresh the log in place. */
  onSettled: () => void | Promise<void>
}

/**
 * Danger action that deletes the Discord channel posts and DMs an announcement
 * already delivered. Hidden when nothing is left to delete.
 */
export default function DeletePostedMessagesAction({ scheduleId, deliveryLog, onSettled }: DeletePostedMessagesActionProps) {
  const { showToast } = useToast()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { discord, email } = countDeletableMessages(deliveryLog)

  if (discord === 0 && !deleting) return null

  const runDelete = async () => {
    setConfirmOpen(false)
    setDeleting(true)
    try {
      const res = await apiClient.post(
        `/api/announcements/schedules/${encodeURIComponent(scheduleId)}/delete-messages`,
        {},
        { timeout: DELETE_REQUEST_TIMEOUT_MS },
      )
      const toast = buildDeleteResultToast(res.data as DeleteMessagesSummary)
      showToast(toast.message, toast.type)
    } catch (err: unknown) {
      showToast(deleteErrorMessage(err), 'error')
    } finally {
      setDeleting(false)
      await onSettled()
    }
  }

  return (
    <>
      <Button
        emphasis="outline"
        intent="danger"
        size="compact"
        loading={deleting}
        icon={<Trash2 className="w-3.5 h-3.5" />}
        onClick={() => setConfirmOpen(true)}
      >
        Delete posted messages
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        title="Delete posted messages?"
        message={buildDeleteConfirmMessage(discord, email)}
        confirmText="Delete messages"
        affectedCount={discord}
        onConfirm={runDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  )
}
