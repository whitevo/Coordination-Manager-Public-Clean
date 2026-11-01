import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { Calendar, ExternalLink, Download, CalendarPlus, MapPin, ArrowLeft, Loader2, Copy, Check, Clock, Bell, BellOff, ChevronDown } from 'lucide-react'
import { apiClient } from '../lib/api-client'
import { downloadICSFile, buildOutlookCalendarUrl, isSafeUrl, resolveMeetingTitle } from '../lib/calendar-utils'
import { getPrimaryTimezone, getTimezoneAbbr } from '../lib/timezone-data'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import { Button } from '../components/ui'
import { OVERLAY_LAYER_CLASS } from '../lib/overlay-layers'

/** Render URLs as clickable links with copy buttons */
function LinkifyText({ text }: { text: string }) {
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)
  const stripped = text.replace(/<[^>]*>/g, '')
  const markdownLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g
  const normalized = stripped.replace(markdownLinkRegex, (_match, label: string, url: string) => {
    const trimmedLabel = label.trim()
    const trimmedUrl = url.trim()
    return trimmedLabel === trimmedUrl ? trimmedUrl : `${trimmedLabel} ${trimmedUrl}`
  })
  const parts = normalized.split(/(https?:\/\/[^\s]+)/g)
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <span key={i} className="inline-flex items-center gap-1">
            <a href={part} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{part}</a>
            <button
              onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(part); setCopiedUrl(part); setTimeout(() => setCopiedUrl(null), 2000) }}
              className="inline-flex p-0.5 rounded hover:bg-muted transition-colors shrink-0 align-middle"
              title="Copy link"
            >
              {copiedUrl === part ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
            </button>
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}

type MeetingData = {
  id: string
  kind: 'calendar' | 'event'
  title: string
  description: string | null
  location: string | null
  start_time: string
  end_time: string
  duration_minutes: number
  meeting_link: string | null
  calendar_hash?: string
  calendar_title?: string
  source_label?: string
}

interface TimeManagerMode {
  id: string
  name: string
}

function formatInUserTz(iso: string, options: Intl.DateTimeFormatOptions) {
  const tz = getPrimaryTimezone()
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, ...options }).format(new Date(iso))
}

function buildGoogleCalendarUrl(meeting: MeetingData): string {
  const displayTitle = resolveMeetingTitle({ title: meeting.title, calendarTitle: meeting.calendar_title })
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: displayTitle,
    dates: `${new Date(meeting.start_time).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}/${new Date(meeting.end_time).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
  })
  if (meeting.description) params.set('details', meeting.description)
  if (meeting.meeting_link) params.set('location', meeting.meeting_link)
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

const JOIN_WINDOW_MS = 5 * 60_000

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

function buildCountdown(targetIso: string | null, now: number) {
  if (!targetIso) return null
  const diff = new Date(targetIso).getTime() - now
  if (diff <= 0) return null
  const days = Math.floor(diff / 86_400_000)
  const hours = Math.floor((diff % 86_400_000) / 3_600_000)
  const minutes = Math.floor((diff % 3_600_000) / 60_000)
  const seconds = Math.floor((diff % 60_000) / 1_000)
  return { days, hours, minutes, seconds, diff }
}

export default function MeetingPage() {
  const { meetingId } = useParams<{ meetingId: string }>()
  const navigate = useNavigate()
  const { isAuthenticated, login } = useAuth()
  const { showToast } = useToast()
  const [meeting, setMeeting] = useState<MeetingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [subscriptionLoading, setSubscriptionLoading] = useState(false)
  const [subscriptionChecking, setSubscriptionChecking] = useState(false)
  const [isTimeManagerMenuOpen, setIsTimeManagerMenuOpen] = useState(false)
  const [timeManagerModes, setTimeManagerModes] = useState<TimeManagerMode[] | null>(null)
  const [timeManagerModesLoading, setTimeManagerModesLoading] = useState(false)
  const [timeManagerModesError, setTimeManagerModesError] = useState<string | null>(null)
  const [addingModeKeys, setAddingModeKeys] = useState<Set<string>>(() => new Set())
  const [addedModeKeys, setAddedModeKeys] = useState<Set<string>>(() => new Set())
  const timeManagerMenuRef = useRef<HTMLDivElement>(null)
  const timeManagerTriggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!meetingId) return
    const fetchMeeting = async () => {
      try {
        const res = await apiClient.get(`/api/meetings/single/${meetingId}`)
        setMeeting(res.data.meeting)
      } catch {
        setError('Meeting not found or no longer available.')
      } finally {
        setLoading(false)
      }
    }
    fetchMeeting()
  }, [meetingId])

  useEffect(() => {
    if (!isAuthenticated || !meeting?.calendar_hash) {
      setIsSubscribed(false)
      return
    }

    const checkSubscription = async () => {
      setSubscriptionChecking(true)
      try {
        const res = await apiClient.get(`/api/calendar-subscriptions/check/${meeting.calendar_hash}`)
        setIsSubscribed(!!res.data?.subscribed)
      } catch {
        setIsSubscribed(false)
      } finally {
        setSubscriptionChecking(false)
      }
    }

    void checkSubscription()
  }, [isAuthenticated, meeting?.calendar_hash])

  const handleSubscriptionToggle = async () => {
    if (!meeting?.calendar_hash || subscriptionLoading) return

    if (!isAuthenticated) {
      try {
        await login()
      } catch {
        showToast('Sign in is required to subscribe to this calendar.', 'error')
      }
      return
    }

    setSubscriptionLoading(true)
    try {
      if (isSubscribed) {
        await apiClient.delete(`/api/calendar-subscriptions/${meeting.calendar_hash}`)
        setIsSubscribed(false)
        showToast('You will no longer receive automatic updates from this calendar.')
      } else {
        await apiClient.post('/api/calendar-subscriptions', { calendar_hash: meeting.calendar_hash })
        setIsSubscribed(true)
        showToast('Subscribed. New and updated meetings from this calendar will stay in sync.')
      }
    } catch (err) {
      showToast((err as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to update subscription.', 'error')
    } finally {
      setSubscriptionLoading(false)
    }
  }

  const loadTimeManagerModes = async () => {
    if (timeManagerModesLoading) return
    setTimeManagerModesLoading(true)
    setTimeManagerModesError(null)
    try {
      const { data } = await apiClient.get<{ modes: TimeManagerMode[] }>('/api/time-management/modes')
      if (!Array.isArray(data?.modes)) {
        throw new Error('Time Manager returned an invalid mode list.')
      }
      setTimeManagerModes(data.modes)
    } catch (err) {
      const apiError = (err as { response?: { data?: { error?: unknown } } }).response?.data?.error
      const message = typeof apiError === 'string'
        ? apiError
        : err instanceof Error
          ? err.message
          : 'Failed to load Time Manager modes.'
      setTimeManagerModesError(message)
    } finally {
      setTimeManagerModesLoading(false)
    }
  }

  const handleTimeManagerButtonClick = async () => {
    if (!isAuthenticated) {
      try {
        await login()
      } catch {
        showToast('Sign in is required to add meetings to Time Manager.', 'error')
      }
      return
    }

    if (isTimeManagerMenuOpen) {
      setIsTimeManagerMenuOpen(false)
      return
    }

    setIsTimeManagerMenuOpen(true)
    if (!timeManagerModes) {
      void loadTimeManagerModes()
    }
  }

  const handleAddToTimeManager = async (mode: TimeManagerMode) => {
    if (!meeting) return
    const modeKey = `${meeting.id}:${mode.id}`
    if (addingModeKeys.has(modeKey) || addedModeKeys.has(modeKey)) return

    setAddingModeKeys((current) => new Set(current).add(modeKey))
    setIsTimeManagerMenuOpen(false)
    timeManagerTriggerRef.current?.focus()
    try {
      await apiClient.post('/api/user-events', {
        title: resolveMeetingTitle({ title: meeting.title, calendarTitle: meeting.calendar_title }),
        description: meeting.description,
        meeting_link: meeting.meeting_link,
        location: meeting.location,
        start_time: meeting.start_time,
        end_time: meeting.end_time,
        is_public: false,
        source_id: mode.id,
      })
      setAddedModeKeys((current) => new Set(current).add(modeKey))
      showToast(`Added to Time Manager: ${mode.name}.`)
    } catch (err) {
      const apiError = (err as { response?: { data?: { error?: unknown } } }).response?.data?.error
      const message = typeof apiError === 'string' ? apiError : 'Failed to add meeting to Time Manager.'
      showToast(message, 'error')
    } finally {
      setAddingModeKeys((current) => {
        const next = new Set(current)
        next.delete(modeKey)
        return next
      })
    }
  }

  useEffect(() => {
    if (!isTimeManagerMenuOpen) return

    if (!timeManagerModesLoading) {
      timeManagerMenuRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
        ?.focus()
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !timeManagerMenuRef.current?.contains(event.target)) {
        setIsTimeManagerMenuOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setIsTimeManagerMenuOpen(false)
        timeManagerTriggerRef.current?.focus()
        return
      }

      if (!timeManagerMenuRef.current?.contains(document.activeElement)) return
      const menuItems = Array.from(
        timeManagerMenuRef.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
      )
      if (menuItems.length === 0) return

      const currentIndex = menuItems.indexOf(document.activeElement as HTMLButtonElement)
      let nextIndex: number | null = null
      if (event.key === 'ArrowDown') {
        nextIndex = (currentIndex + 1) % menuItems.length
      } else if (event.key === 'ArrowUp') {
        nextIndex = (currentIndex - 1 + menuItems.length) % menuItems.length
      } else if (event.key === 'Home') {
        nextIndex = 0
      } else if (event.key === 'End') {
        nextIndex = menuItems.length - 1
      }

      if (nextIndex !== null) {
        event.preventDefault()
        menuItems[nextIndex]?.focus()
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isTimeManagerMenuOpen, timeManagerModesLoading])

  const startMs = meeting ? new Date(meeting.start_time).getTime() : 0
  const endMs = meeting ? new Date(meeting.end_time).getTime() : 0
  // Tick every second when meeting is near (within join window) so the countdown
  // can update second-by-second and the join button can flip on/off cleanly.
  // Otherwise tick once a minute to save work.
  const nearStart = meeting ? Math.abs(startMs - Date.now()) <= JOIN_WINDOW_MS + 1000 : false
  const now = useNow(nearStart ? 1_000 : 60_000)
  const isPast = meeting ? endMs < now : false
  const hasStarted = meeting ? startMs <= now : true
  const displayTitle = meeting
    ? resolveMeetingTitle({ title: meeting.title, calendarTitle: meeting.calendar_title })
    : 'Meeting'
  const countdown = useMemo(
    () => buildCountdown(meeting && !hasStarted ? meeting.start_time : null, now),
    [meeting, hasStarted, now]
  )
  const withinJoinWindow = meeting ? startMs - now <= JOIN_WINDOW_MS && endMs > now : false

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !meeting) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold text-foreground mb-2">Meeting Not Found</h1>
          <p className="text-muted-foreground mb-4">{error || 'This meeting does not exist.'}</p>
          <Link to="/events-calendar" className="text-primary hover:underline text-sm">
            Browse Events Calendar
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8 md:py-16">
        {/* Back link */}
        {meeting.kind === 'calendar' ? (
          <Link
            to={`/calendar/${meeting.calendar_hash}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            {meeting.calendar_title}
          </Link>
        ) : (
          <Link
            to="/events-calendar"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            All Events
          </Link>
        )}

        {/* Meeting card */}
        <div className="bg-card border border-border rounded-xl shadow-xs p-6 md:p-8">
          {isPast && (
            <div className="inline-block px-2 py-0.5 mb-3 text-xs font-medium bg-muted text-muted-foreground rounded">
              Past Event
            </div>
          )}

          <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-4 wrap-break-word overflow-hidden">
            {displayTitle}
          </h1>

          <div className="space-y-3 mb-6">
            {/* Date and time */}
            <div className="flex items-start gap-3 text-foreground">
              <Calendar className="w-5 h-5 mt-0.5 text-muted-foreground shrink-0" />
              <div>
                <div className="font-medium">
                  {formatInUserTz(meeting.start_time, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                </div>
                <div className="text-muted-foreground text-sm">
                  {formatInUserTz(meeting.start_time, { hour: 'numeric', minute: '2-digit', hour12: true })} - {formatInUserTz(meeting.end_time, { hour: 'numeric', minute: '2-digit', hour12: true })} {getTimezoneAbbr(getPrimaryTimezone())}
                  {meeting.duration_minutes && ` (${meeting.duration_minutes} min)`}
                </div>
              </div>
            </div>

            {/* Location */}
            {meeting.location && (
              <div className="flex items-start gap-3 text-sm text-foreground">
                <MapPin className="w-5 h-5 mt-0.5 text-muted-foreground shrink-0" />
                <span>{meeting.location}</span>
              </div>
            )}

            {/* Meeting link */}
            {meeting.meeting_link && (
              <div className="flex items-start gap-3">
                <MapPin className="w-5 h-5 mt-0.5 text-muted-foreground shrink-0" />
                <div className="text-sm">
                  <LinkifyText text={meeting.meeting_link} />
                </div>
              </div>
            )}

            {meeting.description && (
              <div className="text-muted-foreground text-sm whitespace-pre-wrap border-l-2 border-border pl-4 py-1 mt-2 wrap-break-word overflow-hidden">
                <LinkifyText text={meeting.description} />
              </div>
            )}
          </div>

          {/* Add to Calendar section */}
          <div className="border-t border-border pt-5 space-y-3">
            <h2 className="text-sm font-semibold text-foreground">Add to your calendar</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <a
                href={buildGoogleCalendarUrl(meeting)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-12 items-center justify-center gap-2 px-4 py-3 rounded-lg text-base font-medium bg-primary text-primary-foreground hover:opacity-90 transition-colors"
              >
                <CalendarPlus className="w-5 h-5 shrink-0" />
                Google
              </a>

              <a
                href={buildOutlookCalendarUrl({
                  title: displayTitle,
                  description: meeting.description,
                  start_time: meeting.start_time,
                  end_time: meeting.end_time,
                  meeting_link: meeting.meeting_link,
                })}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-12 items-center justify-center gap-2 px-4 py-3 rounded-lg text-base font-medium bg-[#0078d4] text-white hover:bg-[#106ebe] transition-colors"
              >
                <CalendarPlus className="w-5 h-5 shrink-0" />
                Outlook
              </a>

              <button
                onClick={() => downloadICSFile({
                  title: displayTitle,
                  description: meeting.description,
                  start_time: meeting.start_time,
                  end_time: meeting.end_time,
                  meeting_link: meeting.meeting_link,
                })}
                className="flex min-h-12 items-center justify-center gap-2 px-4 py-3 rounded-lg text-base font-medium bg-muted text-foreground hover:bg-muted/80 transition-colors border border-border"
              >
                <Download className="w-5 h-5 shrink-0" />
                .ics
              </button>

              <div className="relative min-w-0" ref={timeManagerMenuRef}>
                <Button
                  ref={timeManagerTriggerRef}
                  fullWidth
                  emphasis="outline"
                  intent="neutral"
                  icon={<CalendarPlus className="w-5 h-5 shrink-0" />}
                  className="min-h-12 gap-2 text-base"
                  onClick={() => { void handleTimeManagerButtonClick() }}
                  aria-haspopup={isAuthenticated ? 'menu' : undefined}
                  aria-expanded={isAuthenticated ? isTimeManagerMenuOpen : undefined}
                >
                  Time Manager
                  <ChevronDown className="w-5 h-5 shrink-0" aria-hidden="true" />
                </Button>

                {isTimeManagerMenuOpen && (
                  <div
                    role="menu"
                    aria-label="Add meeting to Time Manager"
                    className={`absolute right-0 mt-1 w-full min-w-48 rounded-lg border border-border bg-popover text-popover-foreground p-1 shadow-lg ${OVERLAY_LAYER_CLASS.popover}`}
                  >
                    {timeManagerModesLoading && (
                      <div role="status" className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading modes...
                      </div>
                    )}
                    {!timeManagerModesLoading && timeManagerModesError && (
                      <div className="space-y-1 p-1">
                        <p className="px-2 py-1 text-sm text-danger">{timeManagerModesError}</p>
                        <button
                          type="button"
                          role="menuitem"
                          className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => { void loadTimeManagerModes() }}
                        >
                          Try again
                        </button>
                      </div>
                    )}
                    {!timeManagerModesLoading && !timeManagerModesError && timeManagerModes?.length === 0 && (
                      <p className="px-3 py-2 text-sm text-muted-foreground">No Time Manager modes available.</p>
                    )}
                    {!timeManagerModesLoading && !timeManagerModesError && timeManagerModes?.map((mode) => {
                      const modeKey = `${meeting.id}:${mode.id}`
                      const isAdding = addingModeKeys.has(modeKey)
                      const isAdded = addedModeKeys.has(modeKey)
                      return (
                        <button
                          key={mode.id}
                          type="button"
                          role="menuitem"
                          disabled={isAdding || isAdded}
                          className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => { void handleAddToTimeManager(mode) }}
                        >
                          <span className="flex items-center justify-between gap-3">
                            <span className="truncate">{mode.name}</span>
                            {isAdded && (
                              <>
                                <Check className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                                <span className="sr-only">Added</span>
                              </>
                            )}
                            {isAdding && (
                              <>
                                <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
                                <span className="sr-only">Adding</span>
                              </>
                            )}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Use Google or Outlook links to add directly. The .ics file works with Apple Calendar and other apps.
            </p>

            {meeting.kind === 'calendar' && (
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Subscribe mode</p>
                    <p className="text-xs text-muted-foreground">
                      Subscribe to this Coordination Calendar to keep new and changed meetings synced without re-adding manually.
                    </p>
                  </div>
                  <Button
                    emphasis="outline"
                    intent={isSubscribed ? 'success' : 'neutral'}
                    size="compact"
                    onClick={handleSubscriptionToggle}
                    disabled={subscriptionLoading || subscriptionChecking}
                    className="shrink-0"
                    icon={subscriptionLoading || subscriptionChecking ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : isSubscribed ? (
                      <BellOff className="w-3.5 h-3.5" />
                    ) : (
                      <Bell className="w-3.5 h-3.5" />
                    )}
                  >
                    {subscriptionLoading || subscriptionChecking
                      ? 'Checking...'
                      : isSubscribed
                        ? 'Unsubscribe'
                        : 'Subscribe'}
                  </Button>
                </div>
                {!isAuthenticated && (
                  <p className="text-xs text-muted-foreground">
                    Sign in to enable subscribe mode.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Countdown for future meetings */}
          {countdown && (
            <div className="mt-5 pt-5 border-t border-border">
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground mb-3">
                <Clock className="w-4 h-4" />
                <span>Meeting starts in</span>
              </div>
              <div className="flex items-center justify-center gap-4">
                {countdown.days > 0 && (
                  <div className="text-center">
                    <div className="text-2xl font-bold text-foreground">{countdown.days}</div>
                    <div className="text-xs text-muted-foreground">{countdown.days === 1 ? 'day' : 'days'}</div>
                  </div>
                )}
                <div className="text-center">
                  <div className="text-2xl font-bold text-foreground">{countdown.hours}</div>
                  <div className="text-xs text-muted-foreground">{countdown.hours === 1 ? 'hour' : 'hours'}</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-foreground">{countdown.minutes}</div>
                  <div className="text-xs text-muted-foreground">{countdown.minutes === 1 ? 'min' : 'mins'}</div>
                </div>
                {withinJoinWindow && (
                  <div className="text-center">
                    <div className="text-2xl font-bold text-foreground">{countdown.seconds}</div>
                    <div className="text-xs text-muted-foreground">{countdown.seconds === 1 ? 'sec' : 'secs'}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Join meeting button -- visible from 5 minutes before start until end */}
          {isSafeUrl(meeting.meeting_link) && !isPast && (hasStarted || withinJoinWindow) && (
            <div className="mt-5 pt-5 border-t border-border">
              <a
                href={meeting.meeting_link ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                Join Meeting
              </a>
            </div>
          )}

          {/* Meeting Over button */}
          {isPast && (
            <div className="mt-5 pt-5 border-t border-border">
              <Button
                fullWidth
                onClick={() => navigate(meeting.kind === 'calendar' ? `/calendar/${meeting.calendar_hash}` : '/events-calendar')}
              >
                Meeting Over
              </Button>
            </div>
          )}
        </div>

        {/* Source attribution */}
        <div className="text-center mt-6">
          <p className="text-xs text-muted-foreground">
            {meeting.kind === 'calendar' ? (
              <>
                From{' '}
                <Link
                  to={`/calendar/${meeting.calendar_hash}`}
                  className="text-primary hover:underline font-medium"
                >
                  {meeting.calendar_title}
                </Link>
                {' '}on Coordination Manager
              </>
            ) : (
              <>
                {meeting.source_label}
                {' '}&middot;{' '}
                <Link to="/events-calendar" className="text-primary hover:underline font-medium">
                  Browse all events
                </Link>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  )
}
