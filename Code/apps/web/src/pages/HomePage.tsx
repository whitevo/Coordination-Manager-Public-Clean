import { Link, useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { Calendar, Globe, HeartHandshake, Send, Bot, ArrowRight, Code, Compass, Info, MessageSquare, Archive, CalendarClock, Inbox, FolderGit2 } from 'lucide-react'
import { addWeeks } from 'date-fns'
import { apiClient } from '../lib/api-client'
import { Button } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { getPrimaryTimezone, formatTimeOnlyInTimezone, formatDateInTimezone } from '../lib/timezone-data'
import { isCalendarArchived, selectHomePageCalendars } from '../lib/calendar-listing'
import { ensureUTC, expandRecurringPublicEvents, PublicEvent } from '../lib/recurrence'
import { SITE_TAGLINE } from '../../../../shared/site-discovery'

// ─── Scroll-reveal hook ──────────────────────────────────────
function useReveal() {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect() } },
      { threshold: 0.15 },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return { ref, visible }
}

function RevealSection({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const { ref, visible } = useReveal()
  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  )
}

// ─── Flowy animated backdrop (decorative) ────────────────────
// Fixed to the viewport (not the page content) so the gradient always fills
// the visible screen, including the extra bottom spacer the layout adds.
function FlowyBackdrop() {
  return (
    <div className="home-flow-bg fixed inset-0 overflow-hidden pointer-events-none" aria-hidden>
      <div className="home-flow-base-gradient" />
      <div className="home-flow-beam home-flow-beam-a" />
      <div className="home-flow-beam home-flow-beam-b" />
      <div className="home-flow-wave home-flow-wave-a" />
      <div className="home-flow-wave home-flow-wave-b" />
      <div className="home-flow-grid" />
    </div>
  )
}

// ─── Helpers ───────────────────────────────────────────────────
// Prefer the most recently synced version of an event when deduplicating.
function getEventPriorityTime(ev: PublicEvent): number {
  if (ev.updated_at) {
    const updatedAt = new Date(ev.updated_at).getTime()
    if (Number.isFinite(updatedAt)) return updatedAt
  }
  if (ev.created_at) {
    const createdAt = new Date(ev.created_at).getTime()
    if (Number.isFinite(createdAt)) return createdAt
  }
  const startTime = new Date(ev.start_time).getTime()
  return Number.isFinite(startTime) ? startTime : 0
}

// Collapse events that share the same title, meeting link, and location on the
// same UTC day (e.g. the same meeting synced from multiple calendars) into a
// single entry, keeping the latest sync details.
function dedupeEvents(events: PublicEvent[]): PublicEvent[] {
  const groups = new Map<string, PublicEvent>()

  for (const ev of events) {
    const day = ev.start_time.slice(0, 10) // YYYY-MM-DD
    const key = `${ev.title}|${ev.meeting_link ?? ''}|${ev.location ?? ''}|${day}`
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, ev)
    } else if (getEventPriorityTime(ev) >= getEventPriorityTime(existing)) {
      groups.set(key, ev)
    }
  }

  return Array.from(groups.values())
}

type PublicCalendar = {
  id: string
  hash: string
  title: string
  config?: {
    customStartDate?: string
    customEndDate?: string
    hideDateNumbers?: boolean
    [key: string]: unknown
  }
  creator_display_name?: string
  created_at?: string
  archived_at?: string | null
  has_recurring_meetings?: boolean
}

// ─── Component ───────────────────────────────────────────────
export default function HomePage() {
  const { isAuthenticated, login, loginAsTraveler } = useAuth()
  const navigate = useNavigate()

  // Distribution card expanded state (for auth options)
  const [distExpanded, setDistExpanded] = useState(false)
  const [distLoading, setDistLoading] = useState(false)
  const [distError, setDistError] = useState<string | null>(null)

  // Upcoming public events (top 6)
  const [events, setEvents] = useState<PublicEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(true)

  // Public coordination calendars (top 6)
  const [calendars, setCalendars] = useState<PublicCalendar[]>([])
  const [calendarsLoading, setCalendarsLoading] = useState(true)

  useEffect(() => {
    // Fetch upcoming events
    apiClient
      .get('/api/user-events/public')
      .then(res => {
        const raw: PublicEvent[] = res.data.events || []
        const normalized = raw.map(ev => ({
          ...ev,
          start_time: ensureUTC(ev.start_time),
          end_time: ensureUTC(ev.end_time),
        }))
        const now = new Date()
        const windowEnd = addWeeks(now, 12)
        const expanded = expandRecurringPublicEvents(normalized, now, windowEnd)
        const nowIso = now.toISOString()
        const upcoming = dedupeEvents(expanded.filter(e => e.end_time > nowIso))
          .sort((a, b) => a.start_time.localeCompare(b.start_time))
          .slice(0, 6)
        setEvents(upcoming)
      })
      .catch(() => {})
      .finally(() => setEventsLoading(false))

    // Fetch public calendars
    apiClient
      .get('/api/calendars')
      .then(res => {
        const all: PublicCalendar[] = res.data || []
        setCalendars(selectHomePageCalendars(all))
      })
      .catch(() => {})
      .finally(() => setCalendarsLoading(false))
  }, [])

  return (
    <div className="relative isolate overflow-hidden w-full min-h-screen">
      <FlowyBackdrop />

      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="relative min-h-[58vh] sm:min-h-[70vh] flex items-center justify-center overflow-hidden">
        <div className="relative z-10 text-center px-4 max-w-3xl mx-auto">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4 animate-fade-in-up">
            Coordination Manager
          </h1>
          <p className="mx-auto max-w-2xl text-lg sm:text-xl leading-relaxed text-muted-foreground mb-8 sm:mb-12 animate-fade-in-up [animation-delay:200ms]">
            {SITE_TAGLINE}
          </p>

          {/* Primary CTAs — two entry points */}
          <div className="flex w-full max-w-sm mx-auto sm:max-w-none flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 sm:gap-4 animate-fade-in-up [animation-delay:400ms]">
            <Link
              to="/events-calendar"
              className="w-full sm:w-auto px-7 py-3 rounded-xl font-medium text-center text-primary-foreground bg-primary shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/35 hover:scale-[1.02] active:scale-[0.98] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-all"
            >
              Explore Public Events
            </Link>

            <Link
              to="/calendar"
              className="w-full sm:w-auto px-7 py-3 rounded-xl border-2 border-primary/40 bg-primary-subtle shadow-xs hover:border-primary/70 hover:bg-primary-muted hover:shadow-md hover:shadow-primary/15 hover:scale-[1.02] active:scale-[0.98] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring transition-all font-medium text-center"
            >
              Create a Coordination Calendar
            </Link>
          </div>
        </div>
      </section>

      {/* ── Feature Categories ───────────────────────────── */}
      <section className="max-w-5xl mx-auto px-4 py-20">
        <RevealSection>
          <h2 className="text-3xl font-semibold text-center mb-12">Explore</h2>
        </RevealSection>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
          {/* Agentic Tools — opens AI Chat side panel */}
          <RevealSection delay={0}>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('openAiPanel'))}
              className="group flex h-full w-full flex-col items-center justify-between gap-3 rounded-xl border border-border bg-card p-6 text-center hover:border-primary/40 hover:shadow-md transition-all"
            >
              <Bot size={28} className="text-primary transition-transform group-hover:scale-110" />
              <span className="font-medium">Agentic Tools</span>
              <span className="text-xs text-muted-foreground">AI-assisted coordination</span>
            </button>
          </RevealSection>

          {/* Distribution — inline auth options for non-auth users */}
          <RevealSection delay={80}>
            <div className="h-full rounded-xl border border-border bg-card hover:border-primary/40 hover:shadow-md transition-all overflow-hidden">
              <button
                onClick={() => {
                  if (isAuthenticated) {
                    navigate('/distribute')
                  } else {
                    setDistExpanded(prev => !prev)
                  }
                }}
                className="group flex w-full flex-col items-center justify-between gap-3 p-6 text-center"
              >
                <Send size={28} className="text-primary transition-transform group-hover:scale-110" />
                <span className="font-medium">Distribution</span>
                <span className="text-xs text-muted-foreground">Reach people across channels</span>
              </button>

              {/* Inline auth options */}
              {!isAuthenticated && distExpanded && (
                <div className="px-5 pb-5 border-t border-border">
                  <p className="text-xs text-muted-foreground text-center mt-4 mb-3">Create an account to distribute messages</p>

                  {distError && (
                    <p className="text-xs text-danger text-center mb-3">{distError}</p>
                  )}

                  <Button
                    emphasis="outline"
                    fullWidth
                    onClick={async () => {
                      setDistError(null)
                      try {
                        sessionStorage.setItem('authReturnTo', '/distribute')
                        await login()
                      } catch (err: unknown) {
                        if (err instanceof Error && err.name === 'AbortError') return
                        setDistError(err instanceof Error ? err.message : 'Sign-in failed')
                      }
                    }}
                    className="mb-2"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                    <span className="font-medium">Continue with Google</span>
                  </Button>

                  <Button
                    emphasis="outline"
                    intent="warning"
                    fullWidth
                    onClick={async () => {
                      setDistError(null)
                      setDistLoading(true)
                      try {
                        await loginAsTraveler()
                        navigate('/distribute')
                      } catch (err: unknown) {
                        setDistError(err instanceof Error ? err.message : 'Failed to create traveler account')
                      } finally {
                        setDistLoading(false)
                      }
                    }}
                    disabled={distLoading}
                  >
                    <Compass className="w-4 h-4 text-warning" />
                    <span className="font-medium text-warning">
                      {distLoading ? 'Creating...' : 'Continue as Traveler'}
                    </span>
                  </Button>

                  <div className="flex items-start gap-1.5 mt-3 text-[10px] text-muted-foreground">
                    <Info className="w-3 h-3 mt-0.5 shrink-0" />
                    <span>Traveler: no email needed, random identity, expires in 64 days</span>
                  </div>
                </div>
              )}
            </div>
          </RevealSection>

          {/* Time Management */}
          <RevealSection delay={160}>
            <Link
              to="/time-management"
              className="group flex h-full flex-col items-center justify-between gap-3 rounded-xl border border-border bg-card p-6 text-center hover:border-primary/40 hover:shadow-md transition-all"
            >
              <CalendarClock size={28} className="text-primary transition-transform group-hover:scale-110" />
              <span className="font-medium">Time Management</span>
              <span className="text-xs text-muted-foreground">Plan your own schedule</span>
            </Link>
          </RevealSection>

          {/* Availability */}
          <RevealSection delay={240}>
            <Link
              to="/calendars"
              className="group flex h-full flex-col items-center justify-between gap-3 rounded-xl border border-border bg-card p-6 text-center hover:border-primary/40 hover:shadow-md transition-all"
            >
              <HeartHandshake size={28} className="text-primary transition-transform group-hover:scale-110" />
              <span className="font-medium">Availability</span>
              <span className="text-xs text-muted-foreground">Find shared time</span>
            </Link>
          </RevealSection>

          {/* Public Events */}
          <RevealSection delay={320}>
            <Link
              to="/events-calendar"
              className="group flex h-full flex-col items-center justify-between gap-3 rounded-xl border border-border bg-card p-6 text-center hover:border-primary/40 hover:shadow-md transition-all"
            >
              <Globe size={28} className="text-primary transition-transform group-hover:scale-110" />
              <span className="font-medium">Public Events</span>
              <span className="text-xs text-muted-foreground">Open participation</span>
            </Link>
          </RevealSection>

          {/* Mailbox */}
          <RevealSection delay={400}>
            <Link
              to="/mailbox"
              className="group flex h-full flex-col items-center justify-between gap-3 rounded-xl border border-border bg-card p-6 text-center hover:border-primary/40 hover:shadow-md transition-all"
            >
              <Inbox size={28} className="text-primary transition-transform group-hover:scale-110" />
              <span className="font-medium">Mailbox</span>
              <span className="text-xs text-muted-foreground">Messages and invitations</span>
            </Link>
          </RevealSection>

          {/* API Integration */}
          <RevealSection delay={480}>
            <a
              href={import.meta.env.DEV ? 'http://localhost:5174/docs/overview' : '/docs/overview'}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex h-full flex-col items-center justify-between gap-3 rounded-xl border border-border bg-card p-6 text-center hover:border-primary/40 hover:shadow-md transition-all"
            >
              <Code size={28} className="text-primary transition-transform group-hover:scale-110" />
              <span className="font-medium">API Integration</span>
              <span className="text-xs text-muted-foreground">Connect your own tools</span>
            </a>
          </RevealSection>

          {/* Feedback — opens Feedback side panel */}
          <RevealSection delay={560}>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('openFeedbackPanel'))}
              className="group flex h-full w-full flex-col items-center justify-between gap-3 rounded-xl border border-border bg-card p-6 text-center hover:border-primary/40 hover:shadow-md transition-all"
            >
              <MessageSquare size={28} className="text-primary transition-transform group-hover:scale-110" />
              <span className="font-medium">Feedback</span>
              <span className="text-xs text-muted-foreground">Share your thoughts</span>
            </button>
          </RevealSection>

          {/* GitHub — public open-source repo */}
          <RevealSection delay={640}>
            <a
              href="https://github.com/whitevo/Coordination-Manager-Public-Clean"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex h-full flex-col items-center justify-between gap-3 rounded-xl border border-border bg-card p-6 text-center hover:border-primary/40 hover:shadow-md transition-all"
            >
              <FolderGit2 size={28} aria-hidden="true" className="text-primary transition-transform group-hover:scale-110" />
              <span className="font-medium">GitHub</span>
              <span className="text-xs text-muted-foreground">Explore the open-source code</span>
            </a>
          </RevealSection>
        </div>
      </section>

      {/* ── Public Coordination Calendars ────────────────── */}
      <section className="max-w-5xl mx-auto px-4 py-20">
        <RevealSection>
          <div className="mb-8 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-3xl font-semibold">Coordination Calendars</h2>
            <Link
              to="/calendars"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              View all <ArrowRight size={14} />
            </Link>
          </div>
        </RevealSection>

        {calendarsLoading ? (
          <div className="grid sm:grid-cols-2 gap-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-28 rounded-xl border border-border bg-card animate-pulse" />
            ))}
          </div>
        ) : calendars.length === 0 ? (
          <RevealSection>
            <div className="text-center py-12 text-muted-foreground border border-dashed border-border rounded-xl">
              No public coordination calendars yet.
            </div>
          </RevealSection>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {calendars.map((cal, i) => {
              const tz = getPrimaryTimezone()
              const dateRange = cal.config?.customStartDate && cal.config?.customEndDate
                ? `${formatDateInTimezone(cal.config.customStartDate + 'T00:00:00', tz).replace(/,? \d{4}$/, '')} -- ${formatDateInTimezone(cal.config.customEndDate + 'T00:00:00', tz).replace(/,? \d{4}$/, '')}`
                : null
              const archived = isCalendarArchived(cal)
              const cardClass = archived
                ? 'border-border bg-muted/80 hover:border-primary/30'
                : 'border-border bg-card hover:border-primary/30'
              return (
                <RevealSection key={cal.id} delay={i * 100}>
                  <Link
                    to={`/calendar/${cal.hash}`}
                    className={`group block h-full rounded-xl border p-5 hover:shadow-xs transition-all ${cardClass}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${
                        archived ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'
                      }`}>
                        <Calendar size={20} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-medium wrap-break-word leading-tight">{cal.title}</h3>
                          {archived && (
                            <span
                              className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                              title="Archived -- past its date range or with no meeting planned in the listing window"
                            >
                              <Archive size={11} />
                              Archived
                            </span>
                          )}
                        </div>
                        {dateRange && (
                          <p className="text-xs text-muted-foreground mt-1">{dateRange}</p>
                        )}
                        {cal.creator_display_name && (
                          <p className="text-xs text-muted-foreground mt-1 wrap-break-word">by {cal.creator_display_name}</p>
                        )}
                      </div>
                    </div>
                  </Link>
                </RevealSection>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Upcoming Events ──────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-4 py-20">
        <RevealSection>
          <div className="mb-8 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-3xl font-semibold">Upcoming Events</h2>
            <Link
              to="/events-calendar"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              View all <ArrowRight size={14} />
            </Link>
          </div>
        </RevealSection>

        {eventsLoading ? (
          <div className="grid sm:grid-cols-2 gap-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-32 rounded-xl border border-border bg-card animate-pulse" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <RevealSection>
            <div className="text-center py-12 text-muted-foreground border border-dashed border-border rounded-xl">
              No upcoming public events right now.
            </div>
          </RevealSection>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {events.map((ev, i) => {
              const start = new Date(ev.start_time)
              const end = new Date(ev.end_time)
              const tz = getPrimaryTimezone()
              const meetingId = ev.id.replace(/__occ__.*$/, '').replace(/^coord_/, '')
              const eventDestination = `/meeting/${meetingId}`
              return (
                <RevealSection key={ev.id} delay={i * 100}>
                  <Link
                    to={eventDestination}
                    className="group block h-full rounded-xl border border-border bg-card p-5 hover:border-primary/30 hover:shadow-xs transition-all"
                  >
                    <div className="flex items-start gap-3">
                      <div className="shrink-0 w-12 h-12 rounded-lg bg-primary/10 flex flex-col items-center justify-center text-primary">
                        <span className="text-xs font-medium leading-none">{formatDateInTimezone(start, tz).split(' ')[0]}</span>
                        <span className="text-lg font-bold leading-none">{new Intl.DateTimeFormat('en-US', { timeZone: tz, day: 'numeric' }).format(start)}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-medium wrap-break-word leading-tight">{ev.title}</h3>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatTimeOnlyInTimezone(start, tz)}
                          {' -- '}
                          {formatTimeOnlyInTimezone(end, tz)}
                        </p>
                        {ev.calendar_title && (
                          <span className="mt-2 inline-flex max-w-full items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                            <Calendar size={10} className="shrink-0" />
                            <span className="wrap-break-word leading-tight">{ev.calendar_title}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                </RevealSection>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Principles (compact) ───────────────────────── */}
      <section className="max-w-5xl mx-auto px-4 py-20">
        <RevealSection>
          <div className="grid gap-6 text-center sm:grid-cols-3 sm:gap-8">
            {[
              { title: 'Equivalence', text: 'Every participant deserves a seat at the table.' },
              { title: 'Privacy by Design', text: 'Your data is protected first — openness is a choice, not a default.' },
              { title: 'Continuous Improvement', text: 'Shaped by contributors and real feedback.' },
            ].map((p, i) => (
              <RevealSection key={p.title} delay={i * 120}>
                <h3 className="font-semibold mb-1">{p.title}</h3>
                <p className="text-sm text-muted-foreground">{p.text}</p>
              </RevealSection>
            ))}
          </div>
        </RevealSection>
      </section>

      {/* ── Footer ───────────────────────────────────────── */}
      <footer className="border-t py-6 text-center">
        <nav aria-label="Documentation and discovery" className="mb-4 flex flex-wrap items-center justify-center gap-4 px-4 text-sm text-muted-foreground">
          <a href={import.meta.env.DEV ? 'http://localhost:5174/docs/overview' : '/docs/overview'} className="hover:text-foreground transition-colors">Documentation</a>
          <a href={import.meta.env.DEV ? 'http://localhost:5174/docs/getting-started' : '/docs/getting-started'} className="hover:text-foreground transition-colors">Agent API guide</a>
          <a href="/llms.txt" className="hover:text-foreground transition-colors">AI and agent guide</a>
          <a href="/sitemap.xml" className="hover:text-foreground transition-colors">Sitemap</a>
        </nav>
        <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground">
          <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
          <span>·</span>
          <Link to="/terms" className="hover:text-foreground transition-colors">Terms</Link>
          <span>·</span>
          <a href="https://github.com/whitevo/Coordination-Manager-Public-Clean" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">GitHub</a>
        </div>
      </footer>
    </div>
  )
}
