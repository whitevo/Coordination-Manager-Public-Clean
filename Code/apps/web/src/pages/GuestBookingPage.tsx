import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { format, startOfWeek, addDays, addWeeks, subWeeks, isWithinInterval, isSameDay, parse, isValid } from 'date-fns'
import { ChevronLeft, ChevronRight, Calendar, Check, X, Sparkles, PartyPopper, ArrowRight, Users, Clock, Sun, Moon, ExternalLink } from 'lucide-react'
import { apiClient } from '../lib/api-client'
import { isSafeUrl } from '../lib/calendar-utils'

type TimeInterval = 15 | 30 | 60

/**
 * GuestBookingPage — A distraction-free page for first-time participants.
 *
 * Accessed via /join/:hash
 *
 * Flow:
 *   1. See event title + single prompt: "What's your name?"
 *   2. After entering name, the calendar grid appears: "Pick your available times"
 *   3. After submitting, a celebration screen with a soft invite to explore the product
 *
 * No nav bar, no account controls, no cognitive overload.
 */
export default function GuestBookingPage() {
  const { hash } = useParams<{ hash: string }>()

  // --- Theme ---
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === 'undefined') return false
    return document.documentElement.classList.contains('dark')
  })
  const toggleDark = () => {
    setIsDark(prev => {
      const next = !prev
      document.documentElement.classList.toggle('dark', next)
      localStorage.setItem('theme', next ? 'dark' : 'light')
      return next
    })
  }

  // --- Flow state ---
  type Step = 'loading' | 'not-found' | 'name' | 'pick' | 'success'
  const [step, setStep] = useState<Step>('loading')

  // --- Calendar config ---
  const [eventName, setEventName] = useState('')
  const [creatorName, setCreatorName] = useState('')
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')
  const [timeInterval, setTimeInterval] = useState<TimeInterval>(30)
  const [startHour, setStartHour] = useState(0)
  const [endHour, setEndHour] = useState(24)
  const [skippedDays, setSkippedDays] = useState<Set<string>>(new Set())
  const [hideDateNumbers, setHideDateNumbers] = useState(false)
  const [onboardingUrl, setOnboardingUrl] = useState('')
  const [participantCount, setParticipantCount] = useState(0)
  const [confirmedMeetingCount, setConfirmedMeetingCount] = useState(0)

  // --- Week navigation ---
  const [currentWeekStart, setCurrentWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))

  // --- User input ---
  const [username, setUsername] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)

  // --- Selection ---
  const [currentSelection, setCurrentSelection] = useState<Set<string>>(new Set())
  const [savedSelections, setSavedSelections] = useState<Map<string, Set<string>>>(new Map())
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState<string | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // --- Mobile ---
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    const smallScreen = window.screen.width <= 1024 || window.screen.height <= 1024
    return hasTouch && smallScreen
  })
  const [isLandscape, setIsLandscape] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth > window.innerHeight
  })
  useEffect(() => {
    const check = () => {
      const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
      const smallScreen = window.screen.width <= 1024 || window.screen.height <= 1024
      setIsMobile(hasTouch && smallScreen)
      setIsLandscape(window.innerWidth > window.innerHeight)
    }
    window.addEventListener('resize', check)
    window.addEventListener('orientationchange', check)
    return () => {
      window.removeEventListener('resize', check)
      window.removeEventListener('orientationchange', check)
    }
  }, [])

  const MOBILE_DAYS_COUNT = isMobile ? (isLandscape ? 7 : 3) : 7
  const [mobileDayOffset, setMobileDayOffset] = useState(0)
  useEffect(() => { setMobileDayOffset(0) }, [currentWeekStart])

  // --- Confetti ---
  const [confettiPieces, setConfettiPieces] = useState<Array<{ id: number; x: number; y: number; color: string; delay: number; size: number }>>([])

  // ------------------------------------------------------------------
  // Load calendar config first (fast) → show name step immediately
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!hash) { setStep('not-found'); return }
    apiClient.get(`/api/calendars/${hash}`)
      .then(res => {
        setEventName(res.data.config?.eventName || res.data.title || 'Coordination Calendar')
        setCreatorName(res.data.created_by || '')
        if (res.data.config) {
          const c = res.data.config
          if (c.customStartDate) setCustomStartDate(c.customStartDate)
          if (c.customEndDate) setCustomEndDate(c.customEndDate)
          if (c.timeInterval) setTimeInterval(c.timeInterval)
          if (c.startHour !== undefined) setStartHour(c.startHour)
          if (c.endHour !== undefined) setEndHour(c.endHour)
          if (c.skippedDays) setSkippedDays(new Set(c.skippedDays))
          if (c.hideDateNumbers !== undefined) setHideDateNumbers(c.hideDateNumbers)
          if (c.onboardingUrl) setOnboardingUrl(c.onboardingUrl)
          if (c.customStartDate) {
            const sd = parse(c.customStartDate, 'yyyy-MM-dd', new Date())
            const ed = c.customEndDate ? parse(c.customEndDate, 'yyyy-MM-dd', new Date()) : null
            if (isValid(sd)) {
              const thisWeek = startOfWeek(new Date(), { weekStartsOn: 1 })
              const startWeek = startOfWeek(sd, { weekStartsOn: 1 })
              const endWeek = ed && isValid(ed) ? startOfWeek(ed, { weekStartsOn: 1 }) : null
              if (thisWeek < startWeek) {
                setCurrentWeekStart(startWeek)
              } else if (endWeek && thisWeek > endWeek) {
                // Calendar range is fully in the past -- land on the last week
                setCurrentWeekStart(endWeek)
              } else {
                setCurrentWeekStart(thisWeek)
              }
            }
          }
        }
        // Show the name step immediately — no need to wait for availability/meetings
        setStep('name')
      })
      .catch(() => setStep('not-found'))
  }, [hash])

  // ------------------------------------------------------------------
  // Load availability + meetings in background (needed for pick step)
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!hash) return
    // Fire both requests in parallel
    const availPromise = apiClient.get(`/api/availability/${hash}`)
    const meetingsPromise = apiClient.get(`/api/meetings/${hash}`)

    availPromise
      .then(res => {
        const map = new Map<string, Set<string>>()
        if (Array.isArray(res.data)) {
          res.data.forEach((entry: { username: string; time_slots: string[] }) => {
            map.set(entry.username, new Set(entry.time_slots))
          })
        }
        setSavedSelections(map)
        setParticipantCount(map.size)
      })
      .catch(() => {})

    meetingsPromise
      .then(res => {
        if (Array.isArray(res.data)) setConfirmedMeetingCount(res.data.length)
      })
      .catch(() => {})
  }, [hash])

  // Auto-focus name input
  useEffect(() => {
    if (step === 'name') {
      setTimeout(() => nameInputRef.current?.focus(), 300)
    }
  }, [step])

  // ------------------------------------------------------------------
  // Grid helpers (minimal reimplementation)
  // ------------------------------------------------------------------
  const generateTimeSlots = useCallback(() => {
    const slots: string[] = []
    for (let hour = startHour; hour < endHour; hour++) {
      for (let minute = 0; minute < 60; minute += timeInterval) {
        if (hour === endHour - 1 && minute > 0) continue
        slots.push(`${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`)
      }
    }
    return slots
  }, [startHour, endHour, timeInterval])

  const timeSlots = generateTimeSlots()
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i))
  // On mobile, hide non-selectable days entirely (skipped + out-of-range) to save screen space
  const mobileEligibleDays = isMobile
    ? weekDays.filter(d => {
        const ds = format(d, 'yyyy-MM-dd')
        if (skippedDays.has(ds)) return false
        if (!customStartDate || !customEndDate) return true
        const sd = parse(customStartDate, 'yyyy-MM-dd', new Date())
        const ed = parse(customEndDate, 'yyyy-MM-dd', new Date())
        if (!isValid(sd) || !isValid(ed)) return true
        return isWithinInterval(d, { start: sd, end: ed })
      })
    : weekDays
  const mobileMaxOffset = Math.max(0, mobileEligibleDays.length - MOBILE_DAYS_COUNT)
  const visibleDays = isMobile
    ? mobileEligibleDays.slice(mobileDayOffset, mobileDayOffset + MOBILE_DAYS_COUNT)
    : weekDays
  const timeColWidth = isMobile ? (isLandscape ? '50px' : '40px') : '60px'
  const dayCount = isMobile ? MOBILE_DAYS_COUNT : 7
  const gridStyle = { gridTemplateColumns: `${timeColWidth} repeat(${dayCount}, 1fr)` }

  const isDateInRange = (date: Date) => {
    if (!customStartDate || !customEndDate) return false
    const sd = parse(customStartDate, 'yyyy-MM-dd', new Date())
    const ed = parse(customEndDate, 'yyyy-MM-dd', new Date())
    if (!isValid(sd) || !isValid(ed)) return false
    return isWithinInterval(date, { start: sd, end: ed })
  }

  const isDaySkipped = (date: Date) => skippedDays.has(format(date, 'yyyy-MM-dd'))

  const getCellId = (date: Date, time: string) => `${format(date, 'yyyy-MM-dd')}_${time}`

  const parseCellId = (cellId: string) => {
    const [date, time] = cellId.split('_')
    return { date, time }
  }

  const getCellsInRectangle = (startCell: string, endCell: string): Set<string> => {
    const start = parseCellId(startCell)
    const end = parseCellId(endCell)
    const cells = new Set<string>()
    const startDate = parse(start.date, 'yyyy-MM-dd', new Date())
    const endDate = parse(end.date, 'yyyy-MM-dd', new Date())
    const allSlots = generateTimeSlots()
    const startIdx = allSlots.indexOf(start.time)
    const endIdx = allSlots.indexOf(end.time)
    const minIdx = Math.min(startIdx, endIdx)
    const maxIdx = Math.max(startIdx, endIdx)
    let cur = startDate <= endDate ? new Date(startDate) : new Date(endDate)
    const last = startDate <= endDate ? endDate : startDate
    while (cur <= last) {
      for (let i = minIdx; i <= maxIdx; i++) {
        cells.add(getCellId(cur, allSlots[i]))
      }
      cur = addDays(cur, 1)
    }
    return cells
  }

  const getCellAvailability = (cellId: string): string[] => {
    const users: string[] = []
    savedSelections.forEach((sel, u) => { if (sel.has(cellId)) users.push(u) })
    return users
  }

  const getHeatmapColor = (count: number) => {
    if (count === 0) return ''
    if (count === 1) return 'bg-green-200'
    if (count === 2) return 'bg-green-400'
    if (count === 3) return 'bg-green-500'
    return 'bg-green-600'
  }

  const getPurpleGradient = (count: number) => {
    if (count === 0) return 'bg-purple-300'
    if (count === 1) return 'bg-purple-400'
    if (count === 2) return 'bg-purple-500'
    return 'bg-purple-600'
  }

  // ------------------------------------------------------------------
  // Week navigation
  // ------------------------------------------------------------------
  const hasAvailableDays = (ws: Date) => {
    if (!customStartDate || !customEndDate) return true
    const rs = parse(customStartDate, 'yyyy-MM-dd', new Date())
    const re = parse(customEndDate, 'yyyy-MM-dd', new Date())
    for (let i = 0; i < 7; i++) {
      if (isWithinInterval(addDays(ws, i), { start: rs, end: re })) return true
    }
    return false
  }

  const MIN_DATE = new Date(2026, 0, 1)
  const MAX_DATE = new Date(2027, 11, 31)

  const isPrevDisabled = (() => {
    if (customStartDate && customEndDate) {
      const re = parse(customEndDate, 'yyyy-MM-dd', new Date())
      const pw = startOfWeek(re, { weekStartsOn: 1 })
      if (currentWeekStart > pw) return false
      return !hasAvailableDays(subWeeks(currentWeekStart, 1))
    }
    return !isWithinInterval(subWeeks(currentWeekStart, 1), { start: MIN_DATE, end: MAX_DATE })
  })()

  const isNextDisabled = (() => {
    if (customStartDate && customEndDate) {
      const rs = parse(customStartDate, 'yyyy-MM-dd', new Date())
      const pw = startOfWeek(rs, { weekStartsOn: 1 })
      if (currentWeekStart < pw) return false
      return !hasAvailableDays(addWeeks(currentWeekStart, 1))
    }
    return !isWithinInterval(addWeeks(currentWeekStart, 1), { start: MIN_DATE, end: MAX_DATE })
  })()

  // ------------------------------------------------------------------
  // Cell interaction
  // ------------------------------------------------------------------
  const handleCellPointerDown = (date: Date, time: string) => {
    const cellId = getCellId(date, time)
    setIsDragging(true)
    setDragStart(cellId)
    const has = currentSelection.has(cellId)
    setIsRemoving(has)
    if (has) {
      setCurrentSelection(prev => { const s = new Set(prev); s.delete(cellId); return s })
    } else {
      setCurrentSelection(prev => new Set(prev).add(cellId))
    }
  }

  const applySelectionToCell = (cellId: string) => {
    if (!isDragging || !dragStart) return
    const rect = getCellsInRectangle(dragStart, cellId)
    if (isRemoving) {
      setCurrentSelection(prev => { const s = new Set(prev); rect.forEach(c => s.delete(c)); return s })
    } else {
      setCurrentSelection(prev => { const s = new Set(prev); rect.forEach(c => s.add(c)); return s })
    }
  }

  const handleCellPointerEnter = (date: Date, time: string) => {
    const cellId = getCellId(date, time)
    applySelectionToCell(cellId)
  }

  const handleGridPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !dragStart) return
    const hovered = document.elementFromPoint(e.clientX, e.clientY)
    if (!(hovered instanceof HTMLElement)) return
    const cell = hovered.closest<HTMLElement>('[data-cell-id]')
    if (!cell) return
    if (cell.dataset.selectable !== 'true') return
    const cellId = cell.dataset.cellId
    if (!cellId) return
    applySelectionToCell(cellId)
  }

  const handlePointerEnd = () => { setIsDragging(false); setDragStart(null) }

  // ------------------------------------------------------------------
  // Submit availability
  // ------------------------------------------------------------------
  const handleSubmit = async () => {
    if (!username.trim() || currentSelection.size === 0 || !hash) return
    setIsSaving(true)
    try {
      await apiClient.post('/api/availability', {
        calendar_hash: hash,
        username: username.trim(),
        time_slots: Array.from(currentSelection),
      })
      // Trigger celebration
      launchConfetti()
      setStep('success')
    } catch {
      alert('Failed to save — please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  // ------------------------------------------------------------------
  // Confetti 🎉
  // ------------------------------------------------------------------
  const launchConfetti = () => {
    const colors = ['#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#6366F1', '#14B8A6']
    const pieces = Array.from({ length: 60 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: -(Math.random() * 20 + 10),
      color: colors[Math.floor(Math.random() * colors.length)],
      delay: Math.random() * 1.5,
      size: Math.random() * 8 + 4,
    }))
    setConfettiPieces(pieces)
  }

  // ------------------------------------------------------------------
  // Proceed from name → pick
  // ------------------------------------------------------------------
  const handleNameContinue = () => {
    if (username.trim().length < 1) return
    // If user already has saved availability, load it
    const existing = savedSelections.get(username.trim())
    if (existing) setCurrentSelection(new Set(existing))
    setStep('pick')
  }

  // ------------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------------

  // Loading
  if (step === 'loading') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground">
        <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin mb-4" />
        <p className="text-muted-foreground text-sm">Loading event...</p>
      </div>
    )
  }

  // Not found
  if (step === 'not-found') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground p-6">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-950 flex items-center justify-center">
            <X className="w-8 h-8 text-red-600 dark:text-red-400" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Event Not Found</h1>
          <p className="text-muted-foreground mb-6">
            This coordination link doesn't exist or has expired.
          </p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-medium"
          >
            <Calendar className="w-4 h-4" />
            Go to Home
          </Link>
        </div>
      </div>
    )
  }

  // ================================================================
  // SUCCESS – celebration screen
  // ================================================================
  if (step === 'success') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground p-6 relative overflow-hidden">
        {/* Confetti */}
        {confettiPieces.map(p => (
          <div
            key={p.id}
            className="absolute rounded-sm pointer-events-none animate-confetti"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: `${p.size}px`,
              height: `${p.size * 1.5}px`,
              backgroundColor: p.color,
              animationDelay: `${p.delay}s`,
              opacity: 0.9,
            }}
          />
        ))}

        <div className="text-center max-w-lg relative z-10">
          {/* Big party icon */}
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center shadow-lg shadow-green-200 dark:shadow-green-900/30">
            <PartyPopper className="w-10 h-10 text-white" />
          </div>

          <h1 className="text-3xl md:text-4xl font-bold mb-3">You're in!</h1>
          <p className="text-lg text-muted-foreground mb-2">
            Thanks for contributing to the planning of <span className="font-semibold text-foreground">{eventName}</span>!
          </p>
          <p className="text-sm text-muted-foreground mb-8">
            Your availability has been saved. The organizer will pick the best time and let you know.
          </p>

          {/* Onboarding link from calendar owner */}
          {isSafeUrl(onboardingUrl) && (
            <div className="bg-card border border-border rounded-xl p-6 mb-6 text-left">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center shrink-0">
                  <ArrowRight className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="font-semibold text-base mb-1">What's Next?</h2>
                  <p className="text-sm text-muted-foreground">
                    The organizer has a recommended next step for you — check it out to get prepared or learn more.
                  </p>
                </div>
              </div>
              <a
                href={onboardingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-medium text-sm transition-colors w-full sm:w-auto"
              >
                <ExternalLink className="w-4 h-4" />
                Continue to Next Step
              </a>
            </div>
          )}

          {/* Explore the application */}
          <div className="bg-card border border-border rounded-xl p-6 mb-6 text-left">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="font-semibold text-base mb-1">Explore Coordination Manager</h2>
                <p className="text-sm text-muted-foreground">
                  Discover how Coordination Manager helps teams find the best meeting times, coordinate schedules, and stay in sync — all in one place.
                </p>
              </div>
            </div>
            <Link
              to="/"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-medium text-sm transition-colors"
            >
              <ArrowRight className="w-4 h-4" />
              Explore the Application
            </Link>
          </div>

          {/* View the full calendar link */}
          <Link
            to={`/calendar/${hash}`}
            className="text-sm text-primary hover:underline inline-flex items-center gap-1"
          >
            View The Current Coordination Calendar
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    )
  }

  // ================================================================
  // NAME STEP – single focused prompt
  // ================================================================
  if (step === 'name') {
    return (
      <div className="min-h-screen flex flex-col bg-background text-foreground">
        {/* Minimal top bar — just theme toggle */}
        <div className="flex justify-end p-3">
          <button
            onClick={toggleDark}
            className="p-2 rounded-lg text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground transition-colors"
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center px-6 pb-20">
          {/* Event badge */}
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center mb-6 shadow-lg shadow-blue-200 dark:shadow-blue-900/30">
            <Calendar className="w-7 h-7 text-white" />
          </div>

          <p className="text-sm text-muted-foreground mb-1 uppercase tracking-wide font-medium">You're invited to</p>
          <h1 className="text-2xl md:text-3xl font-bold text-center mb-2">{eventName}</h1>
          {creatorName && (
            <p className="text-sm text-muted-foreground mb-1">
              Organized by <span className="font-medium text-foreground">{creatorName}</span>
            </p>
          )}

          {/* Stats badges */}
          <div className="flex items-center gap-4 mt-2 mb-8">
            {participantCount > 0 && (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">
                <Users className="w-3.5 h-3.5" />
                {participantCount} {participantCount === 1 ? 'response' : 'responses'} so far
              </span>
            )}
            {confirmedMeetingCount > 0 && (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">
                <Clock className="w-3.5 h-3.5" />
                {confirmedMeetingCount} meeting{confirmedMeetingCount !== 1 ? 's' : ''} confirmed
              </span>
            )}
          </div>

          {/* Name input — the ONE action */}
          <div className="w-full max-w-sm">
            <label className="block text-sm font-medium mb-2 text-center">
              What's your name?
            </label>
            <input
              ref={nameInputRef}
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleNameContinue() }}
              placeholder="Enter your name..."
              className="w-full px-4 py-3 border border-border rounded-xl text-base bg-background text-foreground text-center focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-shadow"
              autoComplete="off"
            />
            <button
              onClick={handleNameContinue}
              disabled={!username.trim()}
              className="w-full mt-4 px-6 py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed font-semibold text-base transition-all flex items-center justify-center gap-2"
            >
              Pick your times
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          <p className="text-xs text-muted-foreground mt-4 text-center max-w-xs">
            No account needed. Just enter your name and select when you're available.
          </p>

          {/* Bypass link for returning participants */}
          <Link
            to={`/calendar/${hash}`}
            className="mt-6 text-sm text-primary hover:underline inline-flex items-center gap-1"
          >
            View the full calendar instead
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    )
  }

  // ================================================================
  // PICK STEP – calendar grid with minimal chrome
  // ================================================================
  const today = new Date()

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Minimal top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-background/95 backdrop-blur-sm sticky top-0 z-30">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shrink-0">
            <Calendar className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold truncate">{eventName}</h1>
            <p className="text-xs text-muted-foreground">
              Picking times as <span className="font-medium text-foreground">{username}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleDark}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent/50 transition-colors"
            title={isDark ? 'Light mode' : 'Dark mode'}
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Instruction banner */}
      <div className="px-4 py-3 bg-purple-50 dark:bg-purple-950/30 border-b border-purple-200 dark:border-purple-800/50">
        <p className="text-sm text-center text-purple-700 dark:text-purple-300 font-medium">
          Drag or tap to select when you're available, then confirm below
        </p>
      </div>

      {/* Calendar content */}
      <div className="flex-1 flex flex-col p-2 md:p-4 max-w-[1200px] mx-auto w-full overflow-hidden">
        {/* Week navigation */}
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={() => {
              const w = subWeeks(currentWeekStart, 1)
              setCurrentWeekStart(w)
            }}
            disabled={isPrevDisabled}
            className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-sm font-medium">
            {format(currentWeekStart, 'MMM d')} – {format(addDays(currentWeekStart, 6), 'MMM d, yyyy')}
          </span>
          <button
            onClick={() => {
              const w = addWeeks(currentWeekStart, 1)
              setCurrentWeekStart(w)
            }}
            disabled={isNextDisabled}
            className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Mobile day pager */}
        {isMobile && MOBILE_DAYS_COUNT < 7 && mobileEligibleDays.length > MOBILE_DAYS_COUNT && (
          <div className="flex items-center justify-between px-2 py-1.5 bg-card border border-border rounded-lg mb-1">
            <button
              onClick={() => setMobileDayOffset(Math.max(0, mobileDayOffset - 1))}
              disabled={mobileDayOffset === 0}
              className="p-1 rounded hover:bg-muted disabled:opacity-30"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-medium">
              {format(visibleDays[0], 'EEE d')} – {format(visibleDays[visibleDays.length - 1], 'EEE d MMM')}
            </span>
            <button
              onClick={() => setMobileDayOffset(Math.min(mobileMaxOffset, mobileDayOffset + 1))}
              disabled={mobileDayOffset >= mobileMaxOffset}
              className="p-1 rounded hover:bg-muted disabled:opacity-30"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Grid */}
        <div
          className="flex-1 overflow-auto relative"
          style={{
            maxHeight: isMobile ? 'calc(100vh - 260px)' : 'calc(100vh - 280px)',
            minHeight: '200px',
          }}
          onPointerMove={handleGridPointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onPointerLeave={handlePointerEnd}
        >
          <div style={{ minWidth: isMobile ? undefined : '640px' }}>
            {/* Day headers */}
            <div className="sticky top-0 z-20 bg-card border-b border-border">
              <div className="grid" style={gridStyle}>
                <div className="p-1 md:p-2" />
                {visibleDays.map(day => {
                  const inRange = isDateInRange(day)
                  const isToday = isSameDay(day, today)
                  const isSkipped = isDaySkipped(day)
                  return (
                    <div
                      key={day.toISOString()}
                      className={`p-1 md:p-2 text-center font-semibold border-l border-border ${
                        isSkipped ? 'bg-muted text-muted-foreground line-through'
                        : inRange ? 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400'
                        : isToday ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400'
                        : 'text-foreground'
                      }`}
                    >
                      <div className="text-[10px] md:text-xs">{format(day, 'EEE')}</div>
                      {!hideDateNumbers && <div className="text-sm md:text-lg">{format(day, 'd')}</div>}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Time slots */}
            {timeSlots.map((time, index) => (
              <div
                key={time}
                className={`grid hover:bg-muted/30 ${index === timeSlots.length - 1 ? 'border-b-2 border-border' : ''}`}
                style={gridStyle}
              >
                <div className="p-1 text-xs text-muted-foreground text-right pr-2 border-r border-border">
                  {time}
                </div>
                {visibleDays.map(day => {
                  const inRange = isDateInRange(day)
                  const isSkipped = isDaySkipped(day)
                  const cellId = getCellId(day, time)
                  const isSelected = currentSelection.has(cellId)
                  const availUsers = getCellAvailability(cellId)
                  const count = availUsers.length
                  const heatmap = getHeatmapColor(count)
                  const purple = getPurpleGradient(count)
                  const isSelectable = inRange && !isSkipped

                  return (
                    <div
                      key={`${day.toISOString()}-${time}`}
                      data-cell-id={cellId}
                      data-selectable={isSelectable ? 'true' : 'false'}
                      className={`border-l border-b border-border h-[32px] select-none relative ${
                        isSkipped || !inRange
                          ? 'bg-gray-400/70 dark:bg-[hsla(222,47%,11%,0.7)] cursor-not-allowed'
                          : isSelected
                          ? `${purple} cursor-pointer`
                          : count > 0
                          ? `${heatmap} cursor-pointer`
                          : inRange
                          ? 'bg-green-50/30 dark:bg-green-950/10 cursor-pointer'
                          : ''
                      } touch-none`}
                      onPointerDown={(e) => {
                        if (!isSelectable) return
                        e.preventDefault()
                        handleCellPointerDown(day, time)
                      }}
                      onPointerEnter={() => isSelectable && handleCellPointerEnter(day, time)}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Bottom action bar */}
        <div className="pt-3 pb-2 flex flex-col sm:flex-row items-center gap-3 border-t border-border mt-2 bg-background">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            {currentSelection.size > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-purple-600 dark:text-purple-400 font-medium">
                <Check className="w-4 h-4" />
                {currentSelection.size} slot{currentSelection.size !== 1 ? 's' : ''} selected
              </span>
            ) : (
              <span>Drag or tap on the grid to select times</span>
            )}
          </div>
          <div className="flex-1" />
          <button
            onClick={() => { setStep('name'); setCurrentSelection(new Set()) }}
            className="w-full sm:w-auto px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
          >
            Back
          </button>
          <button
            onClick={handleSubmit}
            disabled={currentSelection.size === 0 || isSaving}
            className="w-full sm:w-auto px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-md shadow-green-200 dark:shadow-green-900/30"
          >
            {isSaving ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                Confirm Availability
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
