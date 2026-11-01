import { useState, useEffect, useRef } from 'react'
import { X, Loader2, Calendar, Clock } from 'lucide-react'
import { apiClient } from '../lib/api-client'
import { IconButton } from './ui/IconButton'

interface PastAvailabilityEntry {
  calendar_id: string
  calendar_hash: string
  calendar_title: string
  username: string
  time_slots: string[]
  date_range: string
  entry_count: number
  updated_at: string
}

interface ImportAvailabilityModalProps {
  open: boolean
  onClose: () => void
  onImport: (timeSlots: string[], username: string) => void
  onPreview?: (timeSlots: string[] | null) => void
  currentCalendarHash: string
  currentTimeInterval: 15 | 30 | 60
  currentStartHour: number
  currentEndHour: number
  /** Monday of the currently displayed week */
  currentWeekStart: Date
  /** Calendar's custom start date (yyyy-MM-dd) if set */
  customStartDate?: string
  /** Calendar's custom end date (yyyy-MM-dd) if set */
  customEndDate?: string
}

/** Format "YYYY-MM-DD" to { dd, mm, yy } */
function parseDateParts(iso: string): { dd: string; mm: string; yy: string } {
  const [y, m, d] = iso.split('-')
  return { dd: d, mm: m, yy: y.slice(2) }
}

/** Format date range as dd.mm-dd.mm.yy or dd-dd.mm.yy (dd.mm.yy) */
function formatDateRange(minDate: string, maxDate: string): string {
  if (!minDate || !maxDate) return 'N/A'
  const from = parseDateParts(minDate)
  const to = parseDateParts(maxDate)

  if (minDate === maxDate) {
    return `${from.dd}.${from.mm}.${from.yy}`
  }
  if (from.mm === to.mm && from.yy === to.yy) {
    // Same month: dd-dd.mm.yy
    return `${from.dd}-${to.dd}.${to.mm}.${to.yy}`
  }
  // Different months: dd.mm-dd.mm.yy
  return `${from.dd}.${from.mm}-${to.dd}.${to.mm}.${to.yy}`
}

const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Get weekday label for a date range, e.g. "Mon" or "Mon - Fri" */
function formatWeekdayRange(minDate: string, maxDate: string): string {
  if (!minDate) return ''
  const fromDay = SHORT_WEEKDAYS[new Date(minDate + 'T00:00:00').getDay()]
  if (!maxDate || minDate === maxDate) return fromDay
  const toDay = SHORT_WEEKDAYS[new Date(maxDate + 'T00:00:00').getDay()]
  if (fromDay === toDay) return fromDay
  return `${fromDay} - ${toDay}`
}

export default function ImportAvailabilityModal({
  open,
  onClose,
  onImport,
  onPreview,
  currentCalendarHash,
  currentTimeInterval,
  currentStartHour,
  currentEndHour,
  currentWeekStart,
  customStartDate,
  customEndDate,
}: ImportAvailabilityModalProps) {
  const [entries, setEntries] = useState<PastAvailabilityEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const wasOpenRef = useRef(open)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError('')
    apiClient
      .get(`/api/availability/user/past?exclude_hash=${encodeURIComponent(currentCalendarHash)}`)
      .then(res => {
        const fetchedEntries = Array.isArray(res.data.entries) ? res.data.entries : []
        const sortedEntries = [...fetchedEntries].sort((a, b) => {
          const aTime = new Date(a.updated_at || '').getTime()
          const bTime = new Date(b.updated_at || '').getTime()
          const safeATime = Number.isFinite(aTime) ? aTime : 0
          const safeBTime = Number.isFinite(bTime) ? bTime : 0
          return safeBTime - safeATime
        })
        setEntries(sortedEntries)
      })
      .catch(() => {
        setError('Failed to load past availability')
      })
      .finally(() => setLoading(false))
  }, [open, currentCalendarHash])

  useEffect(() => {
    // Clear preview once when the modal transitions from open -> closed.
    // Avoid calling onPreview on every render while closed.
    if (wasOpenRef.current && !open) {
      onPreview?.(null)
    }
    wasOpenRef.current = open
  }, [open, onPreview])

  const parseTimeParts = (timeStr: string): { hours: number; minutes: number } | null => {
    const [hours, minutes] = timeStr.split(':').map(Number)
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
    return { hours, minutes }
  }

  /** Map imported slots to the current calendar's week(s) by day-of-week + time */
  const mapEntrySlotsToTargetWeeks = (entry: PastAvailabilityEntry): string[] => {
    const slots = entry.time_slots
    if (!slots || slots.length === 0) return []

    // Detect date/hour buckets that already contain explicit sub-hour slots.
    // Only hour-root slots without finer-grained siblings should expand.
    const hasSubHourForDateHour = new Set<string>()
    for (const sourceSlot of slots) {
      const [sourceDateStr, sourceTimeStr] = sourceSlot.split('_')
      if (!sourceDateStr || !sourceTimeStr) continue
      const parts = parseTimeParts(sourceTimeStr)
      if (!parts || parts.minutes === 0) continue
      hasSubHourForDateHour.add(`${sourceDateStr}_${parts.hours}`)
    }

    // Determine the source availability's first Monday (week start)
    // Slot format: "YYYY-MM-DD_HH:mm"
    const sourceDates = slots.map(s => s.split('_')[0]).sort()
    const firstSourceDate = new Date(sourceDates[0] + 'T00:00:00')
    // Find the Monday of the first source date's week
    const sourceDay = firstSourceDate.getDay() // 0=Sun
    const sourceMonday = new Date(firstSourceDate)
    sourceMonday.setDate(sourceMonday.getDate() - ((sourceDay + 6) % 7))

    // Calculate how many weeks the current calendar spans
    let calendarWeeks = 1
    if (customStartDate && customEndDate) {
      const calStart = new Date(customStartDate + 'T00:00:00')
      const calEnd = new Date(customEndDate + 'T00:00:00')
      const calStartDay = calStart.getDay()
      const calMonday = new Date(calStart)
      calMonday.setDate(calMonday.getDate() - ((calStartDay + 6) % 7))
      const diffDays = Math.floor((calEnd.getTime() - calMonday.getTime()) / (1000 * 60 * 60 * 24))
      calendarWeeks = Math.max(1, Math.floor(diffDays / 7) + 1)
    }

    // Map each source slot to the target calendar week
    const targetMonday = currentWeekStart
    const mappedSlots = new Set<string>()

    for (const slot of slots) {
      const [dateStr, timeStr] = slot.split('_')
      const slotDate = new Date(dateStr + 'T00:00:00')

      // Calculate which week offset and day-of-week this slot is from the source start
      const daysSinceSourceMonday = Math.floor(
        (slotDate.getTime() - sourceMonday.getTime()) / (1000 * 60 * 60 * 24)
      )
      const weekOffset = Math.floor(daysSinceSourceMonday / 7)
      const dayOfWeek = ((daysSinceSourceMonday % 7) + 7) % 7 // 0=Mon, 6=Sun

      // Only include if this week offset is within the calendar's range
      if (weekOffset >= calendarWeeks) continue

      // Calculate the target date
      const targetDate = new Date(targetMonday)
      targetDate.setDate(targetDate.getDate() + weekOffset * 7 + dayOfWeek)

      // Format as YYYY-MM-DD_HH:mm
      const yyyy = targetDate.getFullYear()
      const mmStr = String(targetDate.getMonth() + 1).padStart(2, '0')
      const ddStr = String(targetDate.getDate()).padStart(2, '0')
      const parsedTargetTime = parseTimeParts(timeStr)
      if (!parsedTargetTime) continue

      const sourceDateHourKey = `${dateStr}_${parsedTargetTime.hours}`
      const shouldExpandHourSlot =
        currentTimeInterval < 60
        && parsedTargetTime.minutes === 0
        && !hasSubHourForDateHour.has(sourceDateHourKey)

      if (shouldExpandHourSlot) {
        for (let minute = 0; minute < 60; minute += currentTimeInterval) {
          const minuteStr = minute.toString().padStart(2, '0')
          mappedSlots.add(`${yyyy}-${mmStr}-${ddStr}_${parsedTargetTime.hours.toString().padStart(2, '0')}:${minuteStr}`)
        }
        continue
      }

      mappedSlots.add(`${yyyy}-${mmStr}-${ddStr}_${timeStr}`)
    }

    return Array.from(mappedSlots)
  }

  type ImportMode = 'selected' | 'unselected'

  const getImportSlots = (entry: PastAvailabilityEntry, mode: ImportMode): string[] => {
    const selectedSlots = mapEntrySlotsToTargetWeeks(entry)
    if (mode === 'selected' || selectedSlots.length === 0) return selectedSlots

    const selectedSet = new Set(selectedSlots)
    const targetDates = Array.from(new Set(selectedSlots.map(slot => slot.split('_')[0]).filter(Boolean)))
    if (targetDates.length === 0) return []

    const universe = new Set<string>()
    for (const dateStr of targetDates) {
      for (let hour = currentStartHour; hour < currentEndHour; hour++) {
        for (let minute = 0; minute < 60; minute += currentTimeInterval) {
          universe.add(`${dateStr}_${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`)
        }
      }
    }

    const unselectedSlots: string[] = []
    for (const slot of universe) {
      if (!selectedSet.has(slot)) {
        unselectedSlots.push(slot)
      }
    }
    return unselectedSlots
  }

  const handleImport = (entry: PastAvailabilityEntry, mode: ImportMode) => {
    const mappedSlots = getImportSlots(entry, mode)
    if (mappedSlots.length === 0) return

    onPreview?.(null)
    onImport(mappedSlots, entry.username)
    onClose()
  }

  if (!open) return null

  return (
    <aside
      className="shrink-0 sticky top-0 h-screen w-154 sm:w-2xl max-w-[95vw] bg-card text-card-foreground border-l border-border shadow-xl flex flex-col"
    >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
          <h2 className="text-base font-bold flex items-center gap-2">
            <Calendar className="w-4 h-4 text-primary" />
            Import Availability
          </h2>
          <IconButton
            onClick={onClose}
            label="Close import availability panel"
            icon={<X className="w-5 h-5" />}
          />
        </div>

        <div className="px-4 pt-3 pb-2">
          <p className="text-sm text-muted-foreground">
            Choose whether to import selected or unselected time from a previous calendar.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Sorted by latest change first. Date format: (dd.mm.yy)
          </p>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="text-sm text-danger py-4 text-center">{error}</div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div className="text-sm text-muted-foreground py-8 text-center px-4">
            No past availability found in other calendars.
          </div>
        )}

        {!loading && !error && entries.length > 0 && (
          <div className="overflow-y-auto flex-1">
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[26%]" />
                <col className="w-[14%]" />
                <col className="w-[30%]" />
              </colgroup>
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-left">
                  <th className="px-2 py-2 font-medium text-muted-foreground">Date Range</th>
                  <th className="px-2 py-2 font-medium text-muted-foreground">Coord. Calendar</th>
                  <th className="px-2 pr-4 py-2 font-medium text-muted-foreground text-right">Entries</th>
                  <th className="px-2 py-2 font-medium text-muted-foreground">Import</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, idx) => {
                  // Compute formatted date range from raw min/max dates
                  const dates = entry.time_slots.map(s => s.split('_')[0]).sort()
                  const minDate = dates[0] || ''
                  const maxDate = dates[dates.length - 1] || ''
                  const displayRange = formatDateRange(minDate, maxDate)
                  const weekdayLabel = formatWeekdayRange(minDate, maxDate)

                  return (
                    <tr
                      key={`${entry.calendar_id}-${entry.username}-${idx}`}
                      onClick={() => handleImport(entry, 'selected')}
                      onMouseEnter={() => onPreview?.(getImportSlots(entry, 'selected'))}
                      onMouseLeave={() => onPreview?.(null)}
                      className="border-b border-border/50 cursor-pointer hover:bg-accent transition-colors"
                    >
                      <td className="px-2 py-2.5 whitespace-nowrap text-foreground">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          {displayRange}
                        </div>
                        {weekdayLabel && (
                          <div className="text-xs text-muted-foreground ml-5 truncate">{weekdayLabel}</div>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-foreground min-w-0">
                        <div className="truncate" title={entry.calendar_title}>
                          {entry.calendar_title}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">as {entry.username}</div>
                      </td>
                      <td className="px-2 pr-4 py-2.5 text-right font-medium text-foreground whitespace-nowrap">
                        {entry.entry_count}h
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleImport(entry, 'selected')
                            }}
                            onMouseEnter={(e) => {
                              e.stopPropagation()
                              onPreview?.(getImportSlots(entry, 'selected'))
                            }}
                            className="px-2 py-1 rounded-md text-[11px] font-medium border border-info-muted text-info hover:bg-info-subtle"
                          >
                            Selected
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleImport(entry, 'unselected')
                            }}
                            onMouseEnter={(e) => {
                              e.stopPropagation()
                              onPreview?.(getImportSlots(entry, 'unselected'))
                            }}
                            className="px-2 py-1 rounded-md text-[11px] font-medium border border-warning-muted text-warning hover:bg-warning-subtle"
                          >
                            Unselected
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
    </aside>
  )
}
