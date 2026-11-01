import { format } from 'date-fns'

export type UserDateFormat = 'dd.mm.yyyy' | 'mm/dd/yyyy' | 'yyyy-mm-dd'

export const DEFAULT_USER_DATE_FORMAT: UserDateFormat = 'dd.mm.yyyy'

export function normalizeUserDateFormat(value: unknown): UserDateFormat {
  if (value === 'dd.mm.yyyy' || value === 'mm/dd/yyyy' || value === 'yyyy-mm-dd') {
    return value
  }
  return DEFAULT_USER_DATE_FORMAT
}

export function getDateFnsPatternForUserDateFormat(dateFormat: UserDateFormat): string {
  if (dateFormat === 'mm/dd/yyyy') return 'MM/dd/yyyy'
  if (dateFormat === 'yyyy-mm-dd') return 'yyyy-MM-dd'
  return 'dd.MM.yyyy'
}

export function readUserDateFormatFromLocalStorage(): UserDateFormat {
  try {
    const raw = localStorage.getItem('userCalendarSettings')
    if (!raw) return DEFAULT_USER_DATE_FORMAT
    const parsed = JSON.parse(raw) as { dateFormat?: unknown }
    return normalizeUserDateFormat(parsed.dateFormat)
  } catch {
    return DEFAULT_USER_DATE_FORMAT
  }
}

export function formatDateWithUserPreference(date: Date, dateFormat: UserDateFormat): string {
  return format(date, getDateFnsPatternForUserDateFormat(dateFormat))
}

export function formatDateTimeWithUserPreference(date: Date, dateFormat: UserDateFormat): string {
  return `${formatDateWithUserPreference(date, dateFormat)} ${format(date, 'HH:mm')}`
}

export function formatDateWithWeekdayUserPreference(date: Date, dateFormat: UserDateFormat): string {
  return `${format(date, 'EEE')}, ${formatDateWithUserPreference(date, dateFormat)}`
}
