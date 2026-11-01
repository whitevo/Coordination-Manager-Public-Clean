import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BellOff, Loader2 } from 'lucide-react'
import { IconButton } from './ui/IconButton'

export interface CalendarSubscription {
  id: string
  calendar_id: string
  created_at: string
  calendars: { id: string; hash: string; title: string; visibility: string } | null
}

interface SubscriptionMeeting {
  calendar_id: string
  start_time: string
  end_time: string
}

interface CalendarSubscriptionListProps {
  subscriptions: CalendarSubscription[]
  meetings: SubscriptionMeeting[]
  subscriptionsLoading: boolean
  subscriptionsError: boolean
  meetingsLoading: boolean
  meetingsError: boolean
  pendingHashes: ReadonlySet<string>
  timezone: string
  onUnsubscribe: (hash: string) => Promise<void>
  onRetry: () => void
}

export default function CalendarSubscriptionList({
  subscriptions, meetings, subscriptionsLoading, subscriptionsError,
  meetingsLoading, meetingsError, pendingHashes, timezone, onUnsubscribe, onRetry,
}: CalendarSubscriptionListProps) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const dateFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, month: 'short', day: 'numeric', year: 'numeric',
  })
  const summaries = new Map<string, { last?: number; upcoming: number; ongoing: boolean; invalid: boolean }>()
  for (const meeting of meetings) {
    const summary = summaries.get(meeting.calendar_id) || { upcoming: 0, ongoing: false, invalid: false }
    const start = Date.parse(meeting.start_time)
    const end = Date.parse(meeting.end_time)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      summary.invalid = true
    } else if (end <= now) {
      summary.last = Math.max(summary.last ?? -Infinity, start)
    } else if (start > now) {
      summary.upcoming += 1
    } else {
      summary.ongoing = true
    }
    summaries.set(meeting.calendar_id, summary)
  }

  return (
    <div className="px-3 pb-2 space-y-2">
      {(subscriptionsError || meetingsError) && (
        <div role="alert" className="rounded-md border border-danger-muted bg-danger-subtle p-2 text-xs text-danger">
          {subscriptionsError ? 'Unable to refresh subscriptions.' : 'Meeting timing is unavailable.'}
          <button type="button" onClick={onRetry} disabled={subscriptionsLoading || meetingsLoading}
            className="ml-2 min-h-11 underline rounded focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
            Retry
          </button>
        </div>
      )}
      {subscriptions.length === 0 ? (
        <p role="status" className="rounded-md border border-border bg-background/50 p-3 text-sm text-muted-foreground">
          {subscriptionsLoading ? 'Loading subscriptions...' : subscriptionsError
            ? 'Subscriptions unavailable.'
            : 'You are not subscribed to any coordination calendars yet.'}
        </p>
      ) : (
        <>
          <p className="text-[10px] text-muted-foreground">Dates in {timezone}</p>
          <table className="w-full table-fixed text-xs leading-tight text-foreground">
            <caption className="sr-only">Subscribed coordination calendars and meeting timing</caption>
            <thead>
              <tr className="border-b border-border text-left text-[10px] text-muted-foreground">
                <th scope="col" className="py-1 pr-2 font-medium">Calendar</th>
                <th scope="col" className="w-20 py-1 pr-1 font-medium">Last meeting</th>
                <th scope="col" className="w-14 py-1 text-center font-medium">Upcoming</th>
                <th scope="col" className="w-7 py-1 font-medium pointer-coarse:w-11"><span className="sr-only">Unsubscribe</span></th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map(sub => {
                const calendar = sub.calendars
                const title = calendar?.title || calendar?.hash || 'Calendar unavailable'
                const summary = summaries.get(sub.calendar_id)
                const pending = !!calendar && pendingHashes.has(calendar.hash)
                const timingStatus = !calendar ? 'Calendar details unavailable.'
                  : meetingsError ? 'Meeting timing unavailable.'
                    : meetingsLoading ? 'Loading meeting timing...'
                      : summary?.invalid ? 'Meeting timing unavailable: invalid dates.'
                        : null
                const upcoming = summary?.upcoming ?? 0
                return (
                  <tr key={sub.id} className="border-b border-border last:border-b-0">
                    <th scope="row" className="py-1.5 pr-2 text-left align-middle font-medium wrap-break-word wrap-anywhere">
                      {calendar?.hash ? (
                        <Link to={`/calendar/${calendar.hash}`} aria-label={`Open calendar ${title}`} title={`Open calendar ${title}`}
                          className="rounded hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
                          {title}
                        </Link>
                      ) : title}
                      {!timingStatus && summary?.ongoing && <p className="mt-1 text-[10px] font-normal text-muted-foreground">Meeting in progress</p>}
                    </th>
                    {timingStatus ? (
                      <td colSpan={2} className="py-1.5 pr-1 text-[10px] text-muted-foreground">{timingStatus}</td>
                    ) : (
                      <>
                        <td className="py-1.5 pr-1 text-[11px] text-muted-foreground">
                          {summary?.last !== undefined ? dateFormatter.format(summary.last) : <span aria-label="No completed meetings" title="No completed meetings">-</span>}
                        </td>
                        <td className="py-1.5 text-center">
                          <span aria-label={`${upcoming} upcoming meetings`} title={`${upcoming} upcoming meetings`}
                            className={`inline-flex min-w-6 items-center justify-center rounded px-1 py-0.5 text-[10px] font-semibold tabular-nums ${
                              upcoming > 0 ? 'bg-success-subtle text-success' : 'bg-muted text-muted-foreground'
                            }`}>
                            {upcoming}
                          </span>
                        </td>
                      </>
                    )}
                    <td className="py-1 align-middle text-right">
                      {calendar?.hash && (
                        <IconButton emphasis="outline" intent="danger" disabled={pending} label={`Unsubscribe from ${title}`}
                          title={pending ? 'Unsubscribing...' : `Unsubscribe from ${title}`}
                          onClick={() => { void onUnsubscribe(calendar.hash) }}
                          className="pointer-coarse:h-11 pointer-coarse:w-11"
                          icon={pending ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <BellOff aria-hidden="true" className="h-3.5 w-3.5" />}
                        />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
