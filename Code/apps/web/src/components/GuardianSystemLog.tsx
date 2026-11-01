import { useState, useEffect, useCallback, useId } from 'react'
import { apiClient } from '../lib/api-client'
import { AlertTriangle, RefreshCw, Trash2, VolumeX, Gavel, Flag, ExternalLink, UserCheck, TimerOff } from 'lucide-react'
import { Button, Disclosure } from './ui'

interface SystemLogEntry {
  id: string
  created_at: string
  /** unban / unmute are moderator undo actions from the flagged table. */
  action: 'flag' | 'delete' | 'mute' | 'ban' | 'unban' | 'unmute'
  failure_reason: string | null
  author_id: string | null
  author_username: string | null
  guild_name: string | null
  channel_name: string | null
  channel_id: string | null
  message_id: string | null
  matched_rule_group_name: string | null
}

interface Props {
  guildIdLookup?: (guildName: string | null) => string | null
  /** Optional: when provided, the panel's Refresh button triggers a full
   *  page refresh starting from this section (instead of just reloading
   *  the system log in isolation). */
  onRefreshAll?: () => void
  /** Optional: parent-driven loading flag (mirrors the page-level refresh
   *  so the spinner keeps animating during the sequential refresh). */
  externalLoading?: boolean
}

function actionIcon(action: SystemLogEntry['action']) {
  if (action === 'delete') return <Trash2 className="h-3.5 w-3.5 text-warning" />
  if (action === 'mute') return <VolumeX className="h-3.5 w-3.5 text-warning" />
  if (action === 'ban') return <Gavel className="h-3.5 w-3.5 text-danger" />
  if (action === 'unban') return <UserCheck className="h-3.5 w-3.5 text-warning" />
  if (action === 'unmute') return <TimerOff className="h-3.5 w-3.5 text-warning" />
  return <Flag className="h-3.5 w-3.5 text-muted-foreground" />
}

function actionLabel(action: SystemLogEntry['action']) {
  if (action === 'delete') return 'Delete message'
  if (action === 'mute') return 'Mute user'
  if (action === 'ban') return 'Ban user'
  if (action === 'unban') return 'Unban user'
  if (action === 'unmute') return 'Remove timeout'
  return 'Flag'
}

/**
 * Collapsible "System Log" panel showing recent intent-vs-result mismatches
 * (rows from guardian_action_log where success = false). Default collapsed
 * to keep the dashboard quiet when everything is healthy.
 */

import React, { forwardRef, useImperativeHandle } from 'react'
export interface GuardianSystemLogRef {
  refresh: () => Promise<void>
}
const GuardianSystemLog = forwardRef<GuardianSystemLogRef, Props>(({ guildIdLookup, onRefreshAll, externalLoading }, ref) => {
  const [expanded, setExpanded] = useState(false)
  const systemLogPanelId = `${useId()}-system-log`
  const [entries, setEntries] = useState<SystemLogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [count, setCount] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiClient.get('/api/guardian/system-log?limit=50')
      setEntries(res.data.entries || [])
      setCount((res.data.entries || []).length)
    } catch (err) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to load system log')
    } finally {
      await new Promise(res => setTimeout(res, 1500))
      setLoading(false)
    }
  }, [])

  useImperativeHandle(ref, () => ({ refresh: load }), [load])
  useEffect(() => { load() }, [load])

  return (
    <div className="bg-card border border-border rounded-lg">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <Disclosure
          className="mr-2 min-w-0 flex-1"
          icon={<AlertTriangle className={count && count > 0 ? 'text-danger' : 'text-muted-foreground'} />}
          title={
            <>
              System Log{' '}
              <span className="text-muted-foreground font-normal">
                ({count === null ? '...' : count}{count === 50 ? '+' : ''})
              </span>
            </>
          }
          description="-- failed bot and moderator undo actions (permission gaps, intent vs result mismatches)"
          expanded={expanded}
          onToggle={setExpanded}
          panelId={systemLogPanelId}
        />
        <Button
          emphasis="outline"
          size="micro"
          onClick={onRefreshAll ?? load}
          disabled={loading || externalLoading}
          title={onRefreshAll ? 'Refresh -- updates this panel first, then the rest of the page' : 'Refresh'}
          icon={<RefreshCw className={`h-3 w-3 ${(loading || externalLoading) ? 'animate-spin' : ''}`} />}
        >
          Refresh
        </Button>
      </div>

      {expanded && (
        <div id={systemLogPanelId} className="p-4">
          {error && (
            <div className="text-sm text-danger mb-2">{error}</div>
          )}
          {!error && entries.length === 0 && !loading && (
            <div className="text-xs text-muted-foreground italic py-2">
              No failed actions in the recent log. Everything is healthy.
            </div>
          )}
          {entries.length > 0 && (
            <ul className="space-y-2">
              {entries.map(e => {
                const guildId = guildIdLookup?.(e.guild_name) || null
                const discordUrl = guildId && e.channel_id && e.message_id
                  ? `https://discord.com/channels/${guildId}/${e.channel_id}/${e.message_id}`
                  : null
                return (
                  <li
                    key={e.id}
                    className="rounded border border-danger-muted/50 bg-danger-subtle p-3 text-xs"
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        {actionIcon(e.action)}
                        <span className="font-semibold text-foreground">FAILED to {actionLabel(e.action).toLowerCase()}</span>
                        {e.author_username && (
                          <span className="text-muted-foreground">
                            -- target: <span className="text-foreground">{e.author_username}</span>
                          </span>
                        )}
                        {e.channel_name && (
                          <span className="text-muted-foreground">
                            in <span className="text-foreground">#{e.channel_name}</span>
                          </span>
                        )}
                        {e.matched_rule_group_name && (
                          <span className="px-1.5 py-0.5 rounded bg-danger-subtle text-danger text-[10px] font-medium">
                            {e.matched_rule_group_name}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground text-[11px]">
                        <span title={new Date(e.created_at).toISOString()}>
                          {new Date(e.created_at).toLocaleString()}
                        </span>
                        {discordUrl && (
                          <a
                            href={discordUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 hover:text-primary"
                            title="Open message in Discord"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                    {e.failure_reason && (
                      <div className="mt-1.5 font-mono text-[11px] text-danger whitespace-pre-wrap wrap-break-word">
                        {e.failure_reason}
                      </div>
                    )}
                    {/* Helpful hint for the most common failure */}
                    {e.failure_reason && /missing permissions/i.test(e.failure_reason) && (
                      <div className="mt-1.5 text-[11px] text-warning">
                        {'-->'} Demon X likely lacks the required permission in this channel.
                        Grant it via Server Settings &rarr; Roles &rarr; Demon X, or via the
                        channel-level permission overrides.
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
})
GuardianSystemLog.displayName = 'GuardianSystemLog'
export default GuardianSystemLog
