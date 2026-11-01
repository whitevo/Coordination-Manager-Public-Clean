import { useCallback, useEffect, useId, useState } from 'react'
import { Bell } from 'lucide-react'
import { apiClient } from '../lib/api-client'
import { isoToLocalInput, localInputToIso } from '../lib/datetime-local'
import { Button, Disclosure, Switch } from './ui'
import { useToast } from './Toast'

export interface NotificationSettingsResponse {
  enabled: boolean
  email: string | null
  notifyFrom: string | null
  defaultEmail: string | null
  effectiveEmail: string | null
}

interface CalendarNotificationSettingsProps {
  calendarHash: string
}

const INPUT_CLASS = 'px-3 py-2 border border-border rounded-md text-sm bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-primary'

/**
 * Organiser-only email notification settings for participation changes,
 * rendered as its own collapsible section. The on/off Switch sits beside the
 * Disclosure header (never inside it) so it works while collapsed.
 * Saved through its own endpoint because the notification email is private
 * and calendar config is readable by anyone with the link.
 */
export default function CalendarNotificationSettings({ calendarHash }: CalendarNotificationSettingsProps) {
  const { showToast } = useToast()
  const [settings, setSettings] = useState<NotificationSettingsResponse | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [emailDraft, setEmailDraft] = useState('')
  const [notifyFromDraft, setNotifyFromDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()

  const applyResponse = useCallback((data: NotificationSettingsResponse) => {
    setSettings(data)
    setEmailDraft(data.email ?? '')
    setNotifyFromDraft(isoToLocalInput(data.notifyFrom))
  }, [])

  useEffect(() => {
    let cancelled = false
    apiClient
      .get<NotificationSettingsResponse>(`/api/calendars/${encodeURIComponent(calendarHash)}/notification-settings`)
      .then(({ data }) => { if (!cancelled) applyResponse(data) })
      .catch(() => { if (!cancelled) setLoadError(true) })
    return () => { cancelled = true }
  }, [calendarHash, applyResponse])

  const save = useCallback(async (next: { enabled: boolean; email: string; notifyFrom: string }) => {
    setSaving(true)
    try {
      const { data } = await apiClient.put<NotificationSettingsResponse>(
        `/api/calendars/${encodeURIComponent(calendarHash)}/notification-settings`,
        { enabled: next.enabled, email: next.email.trim() || null, notifyFrom: localInputToIso(next.notifyFrom) },
      )
      applyResponse(data)
      showToast('Notification settings saved', 'success')
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      showToast(message || 'Could not save notification settings', 'error')
    } finally {
      setSaving(false)
    }
  }, [calendarHash, applyResponse, showToast])

  const toggleLabel = 'Email me about participation changes'
  const notifyFromLabel = settings?.notifyFrom && new Date(settings.notifyFrom).getTime() > Date.now()
    ? ` from ${new Date(settings.notifyFrom).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`
    : ''
  const summary = loadError
    ? 'Notification settings are unavailable right now.'
    : !settings
      ? 'Loading notification settings...'
      : !settings.enabled
        ? 'Off'
        : settings.effectiveEmail
          ? `On - sending to ${settings.effectiveEmail}${notifyFromLabel}`
          : 'On - add a notification email to receive updates'

  const isDirty = settings != null && (
    emailDraft.trim().toLowerCase() !== (settings.email ?? '')
    || notifyFromDraft !== isoToLocalInput(settings.notifyFrom)
  )
  const hasRecipient = Boolean(emailDraft.trim() || settings?.defaultEmail)

  return (
    <div className="flex flex-col gap-1" data-testid="calendar-notification-settings">
      <div className="flex items-start gap-2">
        <Disclosure
          className="min-w-0 flex-1"
          title={`${expanded ? 'Hide' : 'Show'} Participation Email Notifications`}
          description={summary}
          icon={<Bell />}
          expanded={expanded}
          onToggle={setExpanded}
          panelId={panelId}
          testId="calendar-notification-settings-toggle"
        />
        <Switch
          className="mt-1.5 shrink-0"
          checked={settings?.enabled ?? false}
          onCheckedChange={(enabled) => void save({ enabled, email: emailDraft, notifyFrom: notifyFromDraft })}
          label={toggleLabel}
          disabled={!settings || saving}
        />
      </div>

      {expanded && settings && (
        <div
          id={panelId}
          className="flex flex-col gap-2 p-4 border border-border rounded-lg bg-card animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none"
        >
          <p className="text-xs text-muted-foreground">
            Changes near the current time are sent within about 2 minutes, later ones are grouped for 15 minutes.
            Changes to past times and your own edits are skipped. Updates from all your calendars arrive in one email.
          </p>
          {settings.enabled ? (
            <>
              <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground w-full sm:w-72">
                  Notification email
                  <input
                    type="email"
                    name="notificationEmail"
                    value={emailDraft}
                    onChange={e => setEmailDraft(e.target.value)}
                    placeholder={settings.defaultEmail ?? 'you@example.com'}
                    className={INPUT_CLASS}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground w-full sm:w-56">
                  Start notifying from (optional)
                  <input
                    type="datetime-local"
                    name="notificationNotifyFrom"
                    value={notifyFromDraft}
                    onChange={e => setNotifyFromDraft(e.target.value)}
                    className={INPUT_CLASS}
                  />
                </label>
                <Button
                  emphasis="outline"
                  size="compact"
                  disabled={!isDirty || saving}
                  onClick={() => void save({ enabled: settings.enabled, email: emailDraft, notifyFrom: notifyFromDraft })}
                  className="w-fit"
                >
                  Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {hasRecipient
                  ? `Leave the email empty to use ${settings.defaultEmail ?? 'your account email'}. Changes made before the start time never send an email.`
                  : 'Your account has no email address. Add a notification email to receive updates.'}
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Turn notifications on to choose the email and start time.</p>
          )}
        </div>
      )}
    </div>
  )
}