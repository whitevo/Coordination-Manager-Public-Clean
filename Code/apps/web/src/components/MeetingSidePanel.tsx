import { useState, useEffect, useRef, useId } from 'react'
import { format, parse, addWeeks } from 'date-fns'
import {
  Calendar, ChevronDown, Repeat2, X, Link as LinkIcon,
  FileText, Copy, Clock, Check, ExternalLink, Loader2, Video, AlertCircle, Pencil
} from 'lucide-react'
import { apiClient } from '../lib/api-client'
import { isSafeUrl } from '../lib/calendar-utils'
import { useAuth } from '../contexts/AuthContext'
import { useTimezones } from '../lib/use-timezones'
import { formatUtcTimeWithPeriodInTimezone } from '../lib/timezone-data'
import { getWeekdayIndexFromIsoDate } from '../lib/recurrence'
import type { RecurrenceRule, RecurrenceType, RecurrenceUnit, RecurrenceEndType } from '../lib/recurrence'
import LearnerHelpIcon from './LearnerHelpIcon'

// Removed standalone formatTimeWithPeriod -- uses formatUtcTimeWithPeriodInTimezone via hook

interface MeetingSidePanelProps {
  isOpen: boolean
  cellId: string | null
  widthClassName?: string
  mobileOverlay?: boolean
  title: string
  duration: number
  recurrenceRule: RecurrenceRule
  meetingLink: string
  description: string
  timeInterval: number
  isEditing: boolean
  meetingId?: string | null
  isAuthenticated?: boolean
  hasGoogleOAuth?: boolean
  googleOAuthSources?: Array<{ id: string; google_email: string | null; display_name: string }>
  defaultGoogleSourceId?: string
  calendarName?: string
  hideDateNumbers?: boolean
  existingLinks: string[]
  existingDescriptions: string[]
  onSave: (data: {
    title: string
    duration: number
    recurrenceRule: RecurrenceRule
    meetingLink: string
    description: string
  }) => void
  onCancel: () => void
  onCellIdChange?: (newCellId: string) => void
}

export default function MeetingSidePanel({
  isOpen,
  cellId,
  widthClassName = 'w-80 min-w-[20rem]',
  mobileOverlay = false,
  title,
  duration,
  recurrenceRule,
  meetingLink,
  description,
  timeInterval,
  isEditing,
  meetingId,
  isAuthenticated,
  hasGoogleOAuth,
  googleOAuthSources = [],
  defaultGoogleSourceId,
  calendarName,
  hideDateNumbers,
  existingLinks,
  existingDescriptions,
  onSave,
  onCancel,
  onCellIdChange,
}: MeetingSidePanelProps) {
  const fieldIdPrefix = useId().replace(/:/g, '')
  const dateFieldId = `${fieldIdPrefix}-meeting-date`
  const timeFieldId = `${fieldIdPrefix}-meeting-time`
  const titleFieldId = `${fieldIdPrefix}-meeting-title`
  const durationFieldId = `${fieldIdPrefix}-meeting-duration`
  const recurrenceIntervalFieldId = `${fieldIdPrefix}-recurrence-interval`
  const recurrenceUnitFieldId = `${fieldIdPrefix}-recurrence-unit`
  const linkFieldId = `${fieldIdPrefix}-meeting-link`
  const detailsFieldId = `${fieldIdPrefix}-meeting-details`
  const lumaApiKeyFieldId = `${fieldIdPrefix}-luma-api-key`

  const [localTitle, setLocalTitle] = useState(title)
  const [localDuration, setLocalDuration] = useState(duration)
  const [localRecurrenceRule, setLocalRecurrenceRule] = useState<RecurrenceRule>(recurrenceRule)
  const [localLink, setLocalLink] = useState(meetingLink)
  const [localDescription, setLocalDescription] = useState(description)
  const [showRecurrence, setShowRecurrence] = useState(recurrenceRule.type !== 'none')

  // ─── Google Meet generation state ────────────────────────────
  const effectiveSourceId = defaultGoogleSourceId || (googleOAuthSources.length > 0 ? googleOAuthSources[0].id : '')
  const effectiveSource = googleOAuthSources.find(s => s.id === effectiveSourceId)
  const hasMeetLink = /^https:\/\/meet\.google\.com\//.test(localLink)
  const [isGeneratingMeet, setIsGeneratingMeet] = useState(false)
  const [meetError, setMeetError] = useState<string | null>(null)
  // Tracks whether the current localLink was produced by the connected Google
  // account in this session. We only show "via <email>" when the link was
  // generated here (or when no link exists yet and the button would create one).
  // A pasted/manually-entered link should not advertise an account attribution.
  const [meetLinkGeneratedHere, setMeetLinkGeneratedHere] = useState(false)

  // ─── Timezone state ───────────────────────────────────────────
  const tzState = useTimezones()

  // ─── Zoom generation state ────────────────────────────────
  const { user } = useAuth()
  const _isAdmin = user?.roles?.includes('admin')
  const hasZoomLink = /^https:\/\/[\w.-]*zoom\.us\//.test(localLink)
  const [zoomConnected, setZoomConnected] = useState(false)
  const [isGeneratingZoom, setIsGeneratingZoom] = useState(false)
  const [zoomError, setZoomError] = useState<string | null>(null)

  // ─── Luma integration state ──────────────────────────────────
  const [lumaConnected, setLumaConnected] = useState(false)
  const [lumaExpanded, setLumaExpanded] = useState(false)
  const [lumaPublishing, setLumaPublishing] = useState(false)
  const [lumaPublished, setLumaPublished] = useState<{ luma_event_url: string | null } | null>(null)
  const [lumaError, setLumaError] = useState<string | null>(null)
  const [lumaVisibility, setLumaVisibility] = useState<'public' | 'members-only' | 'private'>('public')

  // ─── Inline integration setup state ──────────────────────────
  const [showLumaSetup, setShowLumaSetup] = useState(false)
  const [inlineLumaApiKey, setInlineLumaApiKey] = useState('')
  const [inlineLumaConnecting, setInlineLumaConnecting] = useState(false)
  const [inlineLumaError, setInlineLumaError] = useState<string | null>(null)

  const [showZoomSetup, setShowZoomSetup] = useState(false)
  const [inlineZoomConnecting, setInlineZoomConnecting] = useState(false)
  const [inlineZoomError, setInlineZoomError] = useState<string | null>(null)

  // Check Zoom integration status
  useEffect(() => {
    if (!isAuthenticated) return
    apiClient.get('/api/zoom/integration')
      .then(res => setZoomConnected(!!res.data?.integration?.is_active))
      .catch(() => setZoomConnected(false))
  }, [isAuthenticated])

  // Check Luma integration status
  useEffect(() => {
    if (!isAuthenticated) return
    apiClient.get('/api/luma/integration')
      .then(res => setLumaConnected(!!res.data?.integration?.is_active))
      .catch(() => setLumaConnected(false))
  }, [isAuthenticated])

  // Check if this meeting was already published to Luma
  useEffect(() => {
    if (!isAuthenticated || !meetingId || !lumaConnected) {
      setLumaPublished(null)
      return
    }
    apiClient.get(`/api/luma/published/${meetingId}`)
      .then(res => setLumaPublished(res.data?.published || null))
      .catch(() => setLumaPublished(null))
  }, [isAuthenticated, meetingId, lumaConnected])

  // Sync when the external cellId changes (e.g. user selects a different time)
  useEffect(() => {
    if (!cellId || !isOpen) return
    setLocalTitle(title)
    setLocalDuration(duration)
    setLocalRecurrenceRule(recurrenceRule)
    setLocalLink(meetingLink)
    setMeetLinkGeneratedHere(false)
    setLocalDescription(description)
    setShowRecurrence(recurrenceRule.type !== 'none')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally re-sync local state when the selected meeting is opened
  }, [cellId, isOpen])

  // Sync duration when it changes externally (e.g. user drags on grid to extend)
  useEffect(() => {
    setLocalDuration(duration)
  }, [duration])

  // When panel is not open or has no cellId, render the shell offscreen for animation
  const safeCell = cellId || '2000-01-01_00:00'
  const [rawDateStr, timeStr] = safeCell.split('_')

  // Track whether user has manually overridden the date (skip auto-advance after that)
  const [userOverrodeDate, setUserOverrodeDate] = useState(false)

  // Reset override flag when panel opens for a brand-new cell selection
  const prevCellIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (cellId && cellId !== prevCellIdRef.current) {
      // Only reset if this is a genuinely new cell selection from the grid,
      // not a change we triggered ourselves via onCellIdChange
      if (!userOverrodeDate || prevCellIdRef.current === null) {
        prevCellIdRef.current = cellId
      }
    }
  }, [cellId, userOverrodeDate])

  // For any-week calendars: auto-advance to next future occurrence
  // Check both the date and the time -- if today but time already passed, advance too
  const effectiveDateStr = (() => {
    if (userOverrodeDate) return rawDateStr
    if (!hideDateNumbers || !cellId) return rawDateStr
    const parsed = parse(rawDateStr, 'yyyy-MM-dd', new Date())
    const now = new Date()
    const slotDateTime = new Date(`${rawDateStr}T${timeStr}:00Z`)
    // If the full date+time is in the future, keep it
    if (slotDateTime > now) return rawDateStr
    // Otherwise advance by weeks until the slot is in the future
    let advanced = parsed
    let attempts = 0
    while (attempts < 53) {
      advanced = addWeeks(advanced, 1)
      const advancedSlot = new Date(`${format(advanced, 'yyyy-MM-dd')}T${timeStr}:00Z`)
      if (advancedSlot > now) break
      attempts++
    }
    return format(advanced, 'yyyy-MM-dd')
  })()

  // Whether we auto-advanced (so we can show what happened)
  const wasAutoAdvanced = effectiveDateStr !== rawDateStr

  // Push the auto-advanced date to the parent on initial cell selection only
  const autoAdvancedRef = useRef(false)
  useEffect(() => {
    if (wasAutoAdvanced && cellId && onCellIdChange && !userOverrodeDate && !autoAdvancedRef.current) {
      autoAdvancedRef.current = true
      onCellIdChange(`${effectiveDateStr}_${timeStr}`)
    }
    // Reset when a genuinely new cell is selected from the grid
    if (!wasAutoAdvanced) {
      autoAdvancedRef.current = false
    }
  }, [cellId, wasAutoAdvanced]) // eslint-disable-line react-hooks/exhaustive-deps

  // Use effectiveDateStr as the canonical date for display and state
  const dateStr = effectiveDateStr

  // Manual date/time editing state
  const [isEditingDateTime, setIsEditingDateTime] = useState(false)
  const [localDate, setLocalDate] = useState(dateStr)
  const [localTime, setLocalTime] = useState(timeStr)
  const dateInputRef = useRef<HTMLInputElement>(null)
  const meetingDate = parse(dateStr, 'yyyy-MM-dd', new Date())

  // Check if the current displayed date+time is in the past
  const isDateInPast = new Date(`${dateStr}T${timeStr}:00Z`) < new Date()

  const handleSave = () => {
    const roundedDuration = Math.max(timeInterval, Math.round(localDuration / timeInterval) * timeInterval)
    onSave({
      title: localTitle.trim(),
      duration: roundedDuration,
      recurrenceRule: localRecurrenceRule,
      meetingLink: localLink,
      description: localDescription,
    })
  }

  return (
    <aside
      className={`
        overflow-hidden transition-all duration-300 ease-in-out
        ${mobileOverlay
          ? `fixed inset-y-0 left-0 z-[94] h-screen w-screen transform ${isOpen ? 'translate-x-0 pointer-events-auto' : '-translate-x-full pointer-events-none'}`
          : `shrink-0 sticky top-0 h-screen ${isOpen ? widthClassName : 'w-0'}`
        }
      `}
    >
      <div className={`${mobileOverlay ? 'w-screen min-w-full' : widthClassName} h-full flex flex-col bg-card border-r-2 border-primary/40 shadow-xl`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
        <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
          <Calendar className="w-4 h-4 text-primary" />
          {isEditing ? 'Edit Meeting' : 'New Meeting'}
          <LearnerHelpIcon size={4} description={<><p className="font-semibold text-blue-700 dark:text-blue-300 mb-1">Meeting Configuration</p><p className="mb-1.5">This panel lets you configure a confirmed meeting on the calendar. Meetings are placed on specific time slots that you clicked on the grid.</p><p className="font-semibold text-blue-700 dark:text-blue-300 mb-1">What you can set</p><ul className="list-disc list-inside space-y-0.5"><li><strong>Duration</strong> — how long the meeting lasts.</li><li><strong>Meeting link</strong> — a Zoom, Google Meet, or other URL.</li><li><strong>Description</strong> — agenda or notes for attendees.</li><li><strong>Recurrence</strong> — repeat weekly, biweekly, or monthly.</li></ul></>} />
        </h3>
        <button
          onClick={onCancel}
          className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* ── Time summary (with manual edit) ───────────────── */}
        <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
          {isEditingDateTime ? (
            <div className="space-y-2">
              <div>
                <label htmlFor={dateFieldId} className="block text-[10px] font-medium text-blue-700 dark:text-blue-300 mb-0.5">Date</label>
                <input
                  ref={dateInputRef}
                  id={dateFieldId}
                  name="meetingDate"
                  type="date"
                  value={localDate}
                  onChange={(e) => setLocalDate(e.target.value)}
                  className="w-full px-2 py-1 text-sm border border-blue-300 dark:border-blue-700 rounded bg-white dark:bg-blue-950/50 text-blue-900 dark:text-blue-100 focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label htmlFor={timeFieldId} className="block text-[10px] font-medium text-blue-700 dark:text-blue-300 mb-0.5">Time (UTC)</label>
                <input
                  id={timeFieldId}
                  name="meetingTimeUtc"
                  type="time"
                  value={localTime}
                  step={timeInterval * 60}
                  onChange={(e) => setLocalTime(e.target.value)}
                  className="w-full px-2 py-1 text-sm border border-blue-300 dark:border-blue-700 rounded bg-white dark:bg-blue-950/50 text-blue-900 dark:text-blue-100 focus:ring-2 focus:ring-primary"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (localDate && localTime && onCellIdChange) {
                      setUserOverrodeDate(true)
                      const newCellId = `${localDate}_${localTime}`
                      onCellIdChange(newCellId)
                    }
                    setIsEditingDateTime(false)
                  }}
                  className="flex-1 px-2 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                >
                  Apply
                </button>
                <button
                  onClick={() => {
                    setLocalDate(dateStr)
                    setLocalTime(timeStr)
                    setIsEditingDateTime(false)
                  }}
                  className="flex-1 px-2 py-1 text-xs text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700 rounded hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between">
              <div>
                <div className="font-semibold text-blue-900 dark:text-blue-100 text-sm">
                  {format(meetingDate, 'EEEE, MMMM d, yyyy')}
                </div>
                <div className="text-blue-700 dark:text-blue-300 text-sm mt-0.5">
                  at {formatUtcTimeWithPeriodInTimezone(timeStr, tzState.primary)}
                </div>
              </div>
              <button
                onClick={() => {
                  setLocalDate(dateStr)
                  setLocalTime(timeStr)
                  setIsEditingDateTime(true)
                }}
                className="p-1 rounded hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors text-blue-600 dark:text-blue-400"
                title="Edit date and time manually"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {wasAutoAdvanced && !isEditingDateTime && (
            <div className="mt-2 flex items-start gap-1.5 text-blue-600 dark:text-blue-400">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span className="text-[11px] leading-tight">
                Auto-advanced to next {format(meetingDate, 'EEEE')} (original week date was in the past).
              </span>
            </div>
          )}
          {isDateInPast && !isEditingDateTime && (
            <div className="mt-2 flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span className="text-[11px] leading-tight">
                This date and time is in the past.
              </span>
            </div>
          )}
        </div>

        {/* ── Custom Meeting Name ───────────────────────────── */}
        <div>
          <label htmlFor={titleFieldId} className="block text-xs font-medium text-foreground mb-1">
            <Calendar className="w-3.5 h-3.5 inline mr-1 text-muted-foreground" />
            Custom Meeting Name
          </label>
          <input
            id={titleFieldId}
            name="meetingTitle"
            type="text"
            value={localTitle}
            onChange={(e) => setLocalTitle(e.target.value)}
            placeholder="Optional -- falls back to the calendar name"
            className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
          />
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Used on exports and event pages when provided.
          </p>
        </div>

        {/* ── Duration ────────────────────────────────────────── */}
        <div>
          <label htmlFor={durationFieldId} className="block text-xs font-medium text-foreground mb-1">
            <Clock className="w-3.5 h-3.5 inline mr-1 text-muted-foreground" />
            Duration (minutes)
          </label>
          <input
            id={durationFieldId}
            name="meetingDurationMinutes"
            type="number"
            value={localDuration}
            onChange={(e) => setLocalDuration(parseInt(e.target.value) || 0)}
            onBlur={(e) => {
              const value = parseInt(e.target.value) || 60
              const rounded = Math.max(timeInterval, Math.round(value / timeInterval) * timeInterval)
              setLocalDuration(rounded)
            }}
            min="1"
            className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
          />
          <p className="mt-0.5 text-[10px] text-muted-foreground">Rounded to {timeInterval}-min intervals</p>
        </div>

        {/* ── Recurrence ──────────────────────────────────────── */}
        <div className="border border-border rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setShowRecurrence(v => !v)}
            className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-foreground bg-muted/50 hover:bg-muted transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <Repeat2 className="w-3.5 h-3.5 text-muted-foreground" />
              Recurrence
              {localRecurrenceRule.type !== 'none' && (
                <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-full">
                  {localRecurrenceRule.type === 'weekly' ? 'Weekly' :
                   localRecurrenceRule.type === 'biweekly' ? 'Bi-weekly' :
                   localRecurrenceRule.type === 'monthly' ? 'Monthly' : 'Custom'}
                </span>
              )}
            </span>
            <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${showRecurrence ? 'rotate-180' : ''}`} />
          </button>

          {showRecurrence && (
            <div className="p-3 space-y-3 bg-card">
              {/* Recurrence type chooser */}
              <div className="grid grid-cols-3 gap-1">
                {(['none', 'weekly', 'biweekly', 'monthly', 'custom'] as RecurrenceType[]).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setLocalRecurrenceRule(prev => ({
                      ...prev,
                      type: t,
                      ...(t === 'custom' ? {
                        interval: prev.interval || 1,
                        unit: prev.unit || 'week',
                        weekDays: prev.weekDays || [getWeekdayIndexFromIsoDate(dateStr)],
                        endType: prev.endType || 'never',
                      } : {}),
                    }))}
                    className={`px-1.5 py-1 text-[11px] rounded-md border transition-colors ${
                      localRecurrenceRule.type === t
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-foreground border-border hover:bg-muted'
                    }`}
                  >
                    {t === 'none' ? 'None' :
                     t === 'weekly' ? 'Weekly' :
                     t === 'biweekly' ? 'Bi-wkly' :
                     t === 'monthly' ? 'Monthly' : 'Custom'}
                  </button>
                ))}
              </div>

              {/* Custom options */}
              {localRecurrenceRule.type === 'custom' && (() => {
                const rule = localRecurrenceRule
                const updateRule = (patch: Partial<RecurrenceRule>) =>
                  setLocalRecurrenceRule(prev => ({ ...prev, ...patch }))
                const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
                const DAY_FULL = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
                return (
                  <div className="space-y-2 pt-2 border-t border-border">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap">Every</span>
                      <input
                        id={recurrenceIntervalFieldId}
                        name="recurrenceInterval"
                        aria-label="Recurrence interval"
                        type="number"
                        min={1}
                        max={99}
                        value={rule.interval || 1}
                        onChange={e => updateRule({ interval: Math.max(1, parseInt(e.target.value) || 1) })}
                        className="w-10 px-1 py-0.5 text-[11px] border border-border rounded bg-background text-foreground text-center"
                      />
                      <select
                        id={recurrenceUnitFieldId}
                        name="recurrenceUnit"
                        aria-label="Recurrence interval unit"
                        value={rule.unit || 'week'}
                        onChange={e => updateRule({ unit: e.target.value as RecurrenceUnit })}
                        className="flex-1 px-1 py-0.5 text-[11px] border border-border rounded bg-background text-foreground"
                      >
                        <option value="day">day</option>
                        <option value="week">week</option>
                        <option value="month">month</option>
                      </select>
                    </div>
                    {rule.unit === 'week' && (
                      <div>
                        <p className="text-[11px] text-muted-foreground mb-1">On</p>
                        <div className="flex gap-0.5">
                          {DAY_LABELS.map((label, idx) => {
                            const isSelected = (rule.weekDays || []).includes(idx)
                            return (
                              <button
                                key={idx}
                                type="button"
                                title={DAY_FULL[idx]}
                                onClick={() => {
                                  const current = rule.weekDays || []
                                  const next = isSelected
                                    ? current.filter(d => d !== idx)
                                    : [...current, idx].sort((a, b) => a - b)
                                  updateRule({ weekDays: next.length > 0 ? next : [idx] })
                                }}
                                className={`w-7 h-7 rounded-full text-[10px] font-medium border transition-colors ${
                                  isSelected
                                    ? 'bg-primary text-primary-foreground border-primary'
                                    : 'bg-background text-foreground border-border hover:bg-muted'
                                }`}
                              >
                                {label}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                    <RecurrenceEndOptions rule={rule} updateRule={updateRule} />
                  </div>
                )
              })()}

              {/* Quick end selector for non-custom recurring */}
              {localRecurrenceRule.type !== 'none' && localRecurrenceRule.type !== 'custom' && (
                <RecurrenceEndOptions
                  rule={localRecurrenceRule}
                  updateRule={(patch) => setLocalRecurrenceRule(prev => ({ ...prev, ...patch }))}
                />
              )}
            </div>
          )}
        </div>

        {/* ── Divider ─────────────────────────────────────────── */}
        <hr className="border-border" />

        {/* ── Meeting Link ────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor={linkFieldId} className="text-xs font-medium text-foreground flex items-center gap-1">
              <LinkIcon className="w-3.5 h-3.5 text-muted-foreground" />
              Meeting Link
            </label>
            {existingLinks.length > 0 && (
              <ReuseDropdown
                label="Reuse"
                items={existingLinks}
                onSelect={(link) => { setLocalLink(link); setMeetLinkGeneratedHere(false) }}
              />
            )}
          </div>
          <input
            data-meeting-link-input
            id={linkFieldId}
            name="meetingLink"
            type="url"
            value={localLink}
            onChange={(e) => { setLocalLink(e.target.value); setMeetLinkGeneratedHere(false) }}
            placeholder="https://meet.google.com/..."
            className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
          />
          {/* Link generation buttons */}
          <div className="space-y-2 mt-2">
            <p className="text-[11px] font-medium text-muted-foreground">Create a link with:</p>

            {/* Google Meet */}
            <div className="space-y-1">
              {hasGoogleOAuth ? (
                <>
                  <button
                    type="button"
                    disabled={isGeneratingMeet}
                    onClick={async () => {
                      if (!effectiveSourceId) return
                      setIsGeneratingMeet(true)
                      setMeetError(null)
                      try {
                        const res = await apiClient.post('/api/calendar-sources/generate-meet-link', { sourceId: effectiveSourceId })
                        setLocalLink(res.data.meetLink)
                        setMeetLinkGeneratedHere(true)
                      } catch (err) {
                        setMeetError((err as { response?: { data?: { error?: string } } }).response?.data?.error || (err as { message?: string }).message || 'Failed to generate link')
                      } finally {
                        setIsGeneratingMeet(false)
                      }
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                      isGeneratingMeet
                        ? 'text-muted-foreground bg-muted/30 border-border cursor-not-allowed opacity-50'
                        : hasMeetLink
                          ? 'text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-950/50 border-green-200 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/50'
                          : 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/50'
                    }`}
                  >
                    {isGeneratingMeet ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : hasMeetLink ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="15" height="10" rx="2"/><path d="m17 9 5-3v12l-5-3z"/></svg>
                    )}
                    <span className="flex flex-col items-start min-w-0 flex-1">
                      <span>{isGeneratingMeet ? 'Generating...' : hasMeetLink ? 'Google Meet ✓' : 'Google Meet'}</span>
                      {effectiveSource && (!hasMeetLink || meetLinkGeneratedHere) && (
                        <span className="text-[9px] font-normal text-muted-foreground truncate w-full -ml-3" title={effectiveSource.google_email || undefined}>
                          via {effectiveSource.google_email || effectiveSource.display_name}
                        </span>
                      )}
                    </span>
                  </button>
                  {meetError && (
                    <p className="text-[11px] text-red-500 dark:text-red-400">{meetError}</p>
                  )}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => window.open('/settings?tab=calendar&section=connections', '_blank')}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
                  >
                    <LinkIcon className="w-3 h-3" />
                    Integrate Google Meet
                    <ExternalLink className="w-2.5 h-2.5 ml-auto" />
                  </button>
                  <p className="text-[10px] text-muted-foreground">Opens settings in a new tab — your progress is preserved.</p>
                </>
              )}
            </div>

            {/* Zoom */}
            <div className="space-y-1">
              {window.location.hostname === 'localhost' ? (
                <div className="space-y-1">
                  <button
                    type="button"
                    disabled
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border transition-colors text-muted-foreground bg-muted/30 border-border cursor-not-allowed opacity-50"
                  >
                    <Video className="w-4 h-4" />
                    Zoom
                    <span className="ml-auto text-[10px] text-amber-500">(disabled on localhost)</span>
                  </button>
                  <p className="text-[10px] text-amber-600 dark:text-amber-400">Zoom requires a fully qualified domain name for OAuth. Use the production site to connect Zoom.</p>
                </div>
              ) : zoomConnected ? (
                <>
                  <button
                    type="button"
                    disabled={isGeneratingZoom}
                    onClick={async () => {
                      setIsGeneratingZoom(true)
                      setZoomError(null)
                      try {
                        const zoomTopic = localTitle.trim() || calendarName || 'Meeting'
                        const zoomPayload: Record<string, unknown> = { topic: zoomTopic, agenda: zoomTopic, timezone: 'UTC' }
                        if (cellId) {
                          const [dateStr, timeStr] = cellId.split('_')
                          if (dateStr && timeStr) {
                            zoomPayload.startTime = `${dateStr}T${timeStr}:00Z`
                          }
                        }
                        if (localDuration) zoomPayload.duration = localDuration
                        const res = await apiClient.post('/api/zoom/create-meeting', zoomPayload)
                        setLocalLink(res.data.join_url)
                      } catch (err) {
                        setZoomError((err as { response?: { data?: { error?: string } } }).response?.data?.error || (err as { message?: string }).message || 'Failed to generate Zoom link')
                      } finally {
                        setIsGeneratingZoom(false)
                      }
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
                      isGeneratingZoom
                        ? 'text-muted-foreground bg-muted/30 border-border cursor-not-allowed opacity-50'
                        : hasZoomLink
                          ? 'text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-950/50 border-green-200 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/50'
                          : 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/50'
                    }`}
                  >
                    {isGeneratingZoom ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : hasZoomLink ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Video className="w-4 h-4" />
                    )}
                    {isGeneratingZoom ? 'Generating...' : hasZoomLink ? 'Zoom \u2713' : 'Zoom'}
                  </button>
                  {zoomError && (
                    <p className="text-[11px] text-red-500 dark:text-red-400">{zoomError}</p>
                  )}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setShowZoomSetup(v => !v)}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
                  >
                    <LinkIcon className="w-3 h-3" />
                    Integrate Zoom
                    <ChevronDown className={`w-3 h-3 ml-auto transition-transform ${showZoomSetup ? 'rotate-180' : ''}`} />
                  </button>
                  {showZoomSetup && (
                    <div className="p-2 space-y-2 bg-muted/20 border border-border rounded-lg">
                      <p className="text-[10px] text-muted-foreground">
                        Connect your Zoom account to generate meeting links.
                      </p>
                      <button
                        type="button"
                        disabled={inlineZoomConnecting}
                        onClick={async () => {
                          setInlineZoomConnecting(true)
                          setInlineZoomError(null)
                          try {
                            const returnTo = window.location.pathname + window.location.search
                            const res = await apiClient.get('/api/zoom/auth-url', { params: { returnTo } })
                            if (res.data?.url && isSafeUrl(res.data.url)) {
                              window.open(res.data.url, '_blank')
                            } else {
                              setInlineZoomError('Failed to get Zoom authorization URL.')
                            }
                          } catch (err) {
                            setInlineZoomError((err as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to start Zoom connection')
                          } finally {
                            setInlineZoomConnecting(false)
                          }
                        }}
                        className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50"
                      >
                        {inlineZoomConnecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Video className="w-3 h-3" />}
                        Connect Zoom Account
                      </button>
                      <p className="text-[10px] text-muted-foreground">Opens Zoom authorization in a new tab. After connecting, click Refresh.</p>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const check = await apiClient.get('/api/zoom/integration')
                            if (check.data?.integration?.is_active) {
                              setZoomConnected(true)
                              setShowZoomSetup(false)
                            } else {
                              setInlineZoomError('Not connected yet. Complete authorization in the new tab first.')
                            }
                          } catch {
                            setInlineZoomError('Failed to check connection status.')
                          }
                        }}
                        className="w-full flex items-center justify-center gap-1.5 px-2 py-1 text-[10px] font-medium text-muted-foreground border border-border rounded-md hover:bg-muted transition-colors"
                      >
                        Refresh Connection Status
                      </button>
                      {inlineZoomError && (
                        <p className="text-[10px] text-red-500">{inlineZoomError}</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Luma */}
            <div className="space-y-1">
              <button
                type="button"
                disabled={!lumaConnected}
                onClick={() => setLumaExpanded(v => !v)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
                  lumaConnected
                    ? 'text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-950/50 border-orange-200 dark:border-orange-800 hover:bg-orange-100 dark:hover:bg-orange-900/50'
                    : 'text-muted-foreground bg-muted/30 border-border cursor-not-allowed opacity-50'
                }`}
              >
                <span className="w-4 h-4 bg-gradient-to-br from-orange-400 to-pink-500 rounded flex items-center justify-center shrink-0">
                  <span className="text-white text-[7px] font-bold">Lu</span>
                </span>
                Luma
                {lumaPublished && (
                  <span className="ml-auto px-1.5 py-0.5 text-[10px] font-semibold bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded-full">
                    Published
                  </span>
                )}
              </button>
              {!lumaConnected && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowLumaSetup(v => !v)}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
                  >
                    <LinkIcon className="w-3 h-3" />
                    Integrate Luma
                    <ChevronDown className={`w-3 h-3 ml-auto transition-transform ${showLumaSetup ? 'rotate-180' : ''}`} />
                  </button>
                  {showLumaSetup && (
                    <div className="p-2 space-y-2 bg-muted/20 border border-border rounded-lg">
                      <p className="text-[10px] text-muted-foreground">
                        Connect with an API key from{' '}
                        <a href="https://luma.com/settings/api" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">
                          luma.com/settings/api <ExternalLink className="w-2.5 h-2.5 inline" />
                        </a>
                      </p>
                      <p className="text-[10px] text-amber-600 dark:text-amber-400 flex items-start gap-1">
                        <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                        <span>Requires <strong>Luma Plus</strong> (paid) subscription.</span>
                      </p>
                      <div className="flex gap-1.5">
                        <input
                          id={lumaApiKeyFieldId}
                          name="lumaApiKey"
                          aria-label="Luma API key"
                          type="password"
                          value={inlineLumaApiKey}
                          onChange={(e) => setInlineLumaApiKey(e.target.value)}
                          placeholder="Luma API key"
                          className="flex-1 px-2 py-1 text-[11px] border border-border rounded-md bg-background text-foreground focus:ring-1 focus:ring-ring focus:border-ring outline-none"
                        />
                        <button
                          type="button"
                          disabled={inlineLumaConnecting || !inlineLumaApiKey.trim()}
                          onClick={async () => {
                            setInlineLumaConnecting(true)
                            setInlineLumaError(null)
                            try {
                              await apiClient.post('/api/luma/connect', { apiKey: inlineLumaApiKey })
                              setLumaConnected(true)
                              setInlineLumaApiKey('')
                              setShowLumaSetup(false)
                            } catch (err) {
                              setInlineLumaError((err as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to connect')
                            } finally {
                              setInlineLumaConnecting(false)
                            }
                          }}
                          className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-white bg-gradient-to-r from-orange-500 to-pink-500 rounded-md hover:from-orange-600 hover:to-pink-600 transition-colors disabled:opacity-50"
                        >
                          {inlineLumaConnecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <LinkIcon className="w-3 h-3" />}
                          Connect
                        </button>
                      </div>
                      {inlineLumaError && (
                        <p className="text-[10px] text-red-500">{inlineLumaError}</p>
                      )}
                    </div>
                  )}
                </>
              )}
              {lumaConnected && lumaExpanded && (
                <div className="p-2 space-y-2 bg-muted/20 border border-border rounded-lg">
                  {lumaPublished ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
                        <Check className="w-3.5 h-3.5" />
                        <span>Published to Luma</span>
                      </div>
                      {isSafeUrl(lumaPublished.luma_event_url) && (
                        <a
                          href={lumaPublished.luma_event_url ?? undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" />
                          View on Luma
                        </a>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div>
                        <label className="text-[11px] text-muted-foreground mb-1 block">Visibility</label>
                        <div className="flex gap-1">
                          {(['public', 'members-only', 'private'] as const).map(v => (
                            <button
                              key={v}
                              type="button"
                              onClick={() => setLumaVisibility(v)}
                              className={`px-2 py-1 text-[10px] rounded-md border transition-colors ${
                                lumaVisibility === v
                                  ? 'bg-primary text-primary-foreground border-primary'
                                  : 'bg-background text-foreground border-border hover:bg-muted'
                              }`}
                            >
                              {v === 'members-only' ? 'Members' : v.charAt(0).toUpperCase() + v.slice(1)}
                            </button>
                          ))}
                        </div>
                      </div>
                      {lumaError && (
                        <p className="text-[11px] text-red-500">{lumaError}</p>
                      )}
                      <button
                        type="button"
                        disabled={lumaPublishing}
                        onClick={async () => {
                          setLumaPublishing(true)
                          setLumaError(null)
                          try {
                            const startIso = `${dateStr}T${timeStr}:00Z`
                            const roundedDur = Math.max(timeInterval, Math.round(localDuration / timeInterval) * timeInterval)
                            const endIso = new Date(new Date(startIso).getTime() + roundedDur * 60_000).toISOString()
                            const res = await apiClient.post('/api/luma/publish-event', {
                              meetingId: meetingId || undefined,
                              name: localTitle.trim() || calendarName || 'Meeting',
                              description: localDescription || undefined,
                              startAt: startIso,
                              endAt: endIso,
                              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                              meetingUrl: localLink || undefined,
                              visibility: lumaVisibility,
                            })
                            setLumaPublished({ luma_event_url: res.data?.luma_event_url || null })
                          } catch (err) {
                            setLumaError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to publish to Luma')
                          } finally {
                            setLumaPublishing(false)
                          }
                        }}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-orange-500 to-pink-500 rounded-lg hover:from-orange-600 hover:to-pink-600 transition-colors disabled:opacity-50"
                      >
                        {lumaPublishing ? (
                          <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Publishing...</>
                        ) : (
                          <><ExternalLink className="w-3.5 h-3.5" /> Publish to Luma</>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <p className="mt-0.5 text-[10px] text-muted-foreground">Optional</p>
        </div>

        {/* ── Details / Description ───────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor={detailsFieldId} className="text-xs font-medium text-foreground flex items-center gap-1">
              <FileText className="w-3.5 h-3.5 text-muted-foreground" />
              Details
            </label>
            {existingDescriptions.length > 0 && (
              <ReuseDropdown
                label="Reuse"
                items={existingDescriptions}
                onSelect={(desc) => setLocalDescription(desc)}
                truncateLength={50}
              />
            )}
          </div>
          <textarea
            id={detailsFieldId}
            name="meetingDetails"
            value={localDescription}
            onChange={(e) => setLocalDescription(e.target.value)}
            placeholder="Agenda, instructions, notes..."
            rows={3}
            className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-primary resize-none transition-colors"
          />
        </div>


      </div>

      {/* Footer actions */}
      <div className="px-4 py-3 border-t border-border bg-muted/20 space-y-2">
        <button
          data-meeting-confirm-btn
          onClick={handleSave}
          className="w-full px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
        >
          <Check className="w-4 h-4" />
          {isEditing ? 'Update Meeting' : 'Confirm Meeting'}
        </button>
        <button
          onClick={onCancel}
          className="w-full px-3 py-1.5 text-xs text-muted-foreground border border-border rounded-lg hover:bg-muted transition-colors"
        >
          Cancel
        </button>
      </div>
      </div>
    </aside>
  )
}

function RecurrenceEndOptions({ rule, updateRule }: {
  rule: RecurrenceRule
  updateRule: (patch: Partial<RecurrenceRule>) => void
}) {
  return (
    <div className="pt-2 border-t border-border">
      <p className="text-[11px] text-muted-foreground mb-1">Ends</p>
      <div className="space-y-1">
        {(['never', 'on', 'after'] as RecurrenceEndType[]).map(et => (
          <label key={et} className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="recEndType"
              checked={(rule.endType || 'never') === et}
              onChange={() => updateRule({ endType: et })}
              className="text-primary accent-primary"
            />
            <span className="text-[11px] flex items-center gap-1">
              {et === 'never' && 'Never'}
              {et === 'on' && (
                <>
                  On
                  <input
                    name="recurrenceEndDate"
                    aria-label="Recurrence end date"
                    type="date"
                    value={rule.endDate || ''}
                    onChange={e => updateRule({ endDate: e.target.value })}
                    onClick={() => updateRule({ endType: 'on' })}
                    className="px-1 py-0.5 text-[11px] border border-border rounded bg-background text-foreground"
                  />
                </>
              )}
              {et === 'after' && (
                <>
                  After
                  <input
                    name="recurrenceEndCount"
                    aria-label="Recurrence end count"
                    type="number"
                    min={1}
                    max={999}
                    value={rule.endCount || 13}
                    onChange={e => updateRule({ endCount: Math.max(1, parseInt(e.target.value) || 1) })}
                    onClick={() => updateRule({ endType: 'after' })}
                    className="w-12 px-1 py-0.5 text-[11px] border border-border rounded bg-background text-foreground text-center"
                  />
                  times
                </>
              )}
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}

/* ── Dropdown to reuse existing links/descriptions ──────────────────────── */
function ReuseDropdown({ label, items, onSelect, truncateLength }: {
  label: string
  items: string[]
  onSelect: (item: string) => void
  truncateLength?: number
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        type="button"
        className="flex items-center gap-0.5 text-[10px] text-blue-600 hover:text-blue-800 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <Copy className="w-3 h-3" />
        {label}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg min-w-[180px] max-w-[280px] py-1">
            {items.map((item, i) => (
              <button
                key={i}
                type="button"
                className="w-full text-left px-3 py-1.5 text-[11px] text-foreground hover:bg-accent hover:text-accent-foreground transition-colors truncate"
                title={item}
                onClick={() => {
                  onSelect(item)
                  setOpen(false)
                }}
              >
                {truncateLength && item.length > truncateLength ? item.slice(0, truncateLength) + '\u2026' : item}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
