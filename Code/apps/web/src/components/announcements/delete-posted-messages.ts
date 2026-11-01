/** The delivery log fields the delete-posted-messages action needs. */
export interface DeletableLogEntry {
  id: string
  channel_type: string
  status: string
  discord_message_id: string | null
  deleted_at?: string | null
}

export interface DeleteMessagesSummary {
  deleted: number
  failed: number
  skippedEmail: number
}

export function countDeletableMessages(log: DeletableLogEntry[]): { discord: number; email: number } {
  let discord = 0
  let email = 0
  for (const entry of log) {
    if (entry.status !== 'sent') continue
    if (entry.channel_type === 'email') {
      email++
    } else if (
      (entry.channel_type === 'discord_channel' || entry.channel_type === 'discord_dm') &&
      entry.discord_message_id &&
      !entry.deleted_at
    ) {
      discord++
    }
  }
  return { discord, email }
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

export function buildDeleteConfirmMessage(discord: number, email: number): string {
  const base = `This deletes ${plural(discord, 'Discord message')} this announcement posted (channel posts and DMs). Recipients will no longer see them. This cannot be undone.`
  if (email === 0) return base
  return `${base} ${plural(email, 'email')} already delivered cannot be recalled and will stay in recipients' inboxes.`
}

export function buildDeleteResultToast(summary: DeleteMessagesSummary): { message: string; type: 'success' | 'error' } {
  const parts = [`Deleted ${plural(summary.deleted, 'Discord message')}`]
  if (summary.failed > 0) parts.push(`${summary.failed} could not be deleted`)
  if (summary.skippedEmail > 0) parts.push(`${plural(summary.skippedEmail, 'email')} cannot be recalled`)
  return {
    message: parts.join('. ') + '.',
    type: summary.failed > 0 && summary.deleted === 0 ? 'error' : 'success',
  }
}

export function deleteErrorMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'response' in err) {
    const data = (err as { response?: { data?: unknown } }).response?.data
    if (typeof data === 'object' && data !== null && 'message' in data) {
      const message = (data as { message?: unknown }).message
      if (typeof message === 'string' && message) return message
    }
  }
  return 'Could not delete the posted messages. Please try again.'
}
