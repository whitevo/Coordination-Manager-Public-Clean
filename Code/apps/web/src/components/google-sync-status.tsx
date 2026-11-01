import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { apiClient } from '../lib/api-client'
import { Button, IconButton } from './ui'

export type GoogleSyncState = 'in_sync' | 'outdated' | 'changed_on_google' | 'deleted_on_google' | 'error'

export interface GoogleLinkStatus {
  sourceId: string
  googleEmail: string | null
  htmlLink: string | null
  keepInSync: boolean
  state: GoogleSyncState
  changedFields: string[]
  lastPushedAt: string | null
  lastPushError: string | null
}

const STATE_LABELS: Record<GoogleSyncState, string> = {
  in_sync: 'In sync',
  outdated: 'Out of date on Google',
  changed_on_google: 'Changed in Google',
  deleted_on_google: 'Deleted in Google',
  error: 'Could not check Google',
}

const STATE_CLASSES: Record<GoogleSyncState, string> = {
  in_sync: 'text-success',
  outdated: 'text-warning',
  changed_on_google: 'text-warning',
  deleted_on_google: 'text-danger',
  error: 'text-danger',
}

interface GoogleSyncStatusProps {
  /** The recurring series (or single item) that was exported. */
  eventId: string
  /** Changes when the item is edited, so the status is re-checked. */
  refreshKey?: string
}

/** Google Calendar copy status for an exported Time Management item, with push and keep-in-sync controls. */
export default function GoogleSyncStatus({ eventId, refreshKey }: GoogleSyncStatusProps) {
  const [links, setLinks] = useState<GoogleLinkStatus[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    try {
      const { data } = await apiClient.get<{ links: GoogleLinkStatus[] }>(`/api/google-sync/user-events/${eventId}/status`)
      setLinks(Array.isArray(data?.links) ? data.links : [])
    } catch {
      setLinks([])
    }
  }, [eventId])

  useEffect(() => {
    if (eventId.startsWith('pending-')) return
    void loadStatus()
  }, [loadStatus, refreshKey, eventId])

  if (links.length === 0) return null

  const pushNow = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const { data } = await apiClient.post<{ links: GoogleLinkStatus[] }>(`/api/google-sync/user-events/${eventId}/push`)
      if (Array.isArray(data?.links)) setLinks(data.links)
      setMessage('Google copy updated.')
    } catch {
      setMessage('Could not update the Google copy.')
    } finally {
      setBusy(false)
    }
  }

  const setKeepInSync = async (keepInSync: boolean) => {
    setLinks((prev) => prev.map((link) => ({ ...link, keepInSync })))
    try {
      await apiClient.put(`/api/google-sync/user-events/${eventId}/keep-in-sync`, { keepInSync })
    } catch {
      setLinks((prev) => prev.map((link) => ({ ...link, keepInSync: !keepInSync })))
      setMessage('Could not change the sync setting.')
    }
  }

  const keepInSync = links.some((link) => link.keepInSync)
  const needsAttention = links.some((link) => link.state !== 'in_sync')

  return (
    <div className="rounded-md border border-border bg-muted/30 px-2.5 py-2 text-xs" data-testid="google-sync-status">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">Google Calendar copy</span>
        <IconButton
          label="Re-check Google Calendar copy"
          icon={<RefreshCw />}
          size="micro"
          showTitle={false}
          onClick={() => { void loadStatus() }}
        />
      </div>
      <ul className="space-y-1">
        {links.map((link) => (
          <li key={link.sourceId} className="flex flex-wrap items-center gap-x-2">
            <span className="truncate text-muted-foreground">{link.googleEmail || 'Google Calendar'}</span>
            <span className={`font-medium ${STATE_CLASSES[link.state]}`}>
              {STATE_LABELS[link.state]}
              {link.state === 'changed_on_google' && link.changedFields.length > 0 ? ` (${link.changedFields.join(', ')})` : ''}
            </span>
            {link.htmlLink && link.state !== 'deleted_on_google' && (
              <a href={link.htmlLink} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Open</a>
            )}
          </li>
        ))}
      </ul>
      {links.some((link) => link.state === 'changed_on_google') && (
        <p className="mt-1 text-muted-foreground">Updating Google will replace the edits made there.</p>
      )}
      <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-foreground">
        <input
          type="checkbox"
          checked={keepInSync}
          onChange={(event) => { void setKeepInSync(event.target.checked) }}
          className="h-3.5 w-3.5 rounded border-border"
        />
        Keep Google copy in sync
      </label>
      {needsAttention && !links.every((link) => link.state === 'deleted_on_google') && (
        <Button
          emphasis="outline"
          size="micro"
          fullWidth
          onClick={() => { void pushNow() }}
          disabled={busy}
          className="mt-1.5"
        >
          {busy ? 'Updating...' : 'Update Google copy'}
        </Button>
      )}
      {message && <p className="mt-1 text-muted-foreground">{message}</p>}
    </div>
  )
}
