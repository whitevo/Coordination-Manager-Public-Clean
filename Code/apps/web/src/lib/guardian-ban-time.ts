import { differenceInMonths, differenceInYears } from 'date-fns'

export function formatLastBooted(timestamp: string | null, now: number): string {
  if (timestamp === null) return 'Never'
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return 'Unknown'
  const seconds = Math.max(1, Math.floor((now - date.getTime()) / 1000))
  let count: number
  let unit: string
  if (seconds < 120) { count = seconds; unit = 'second' }
  else if (seconds < 120 * 60) { count = Math.floor(seconds / 60); unit = 'minute' }
  else if (seconds < 48 * 3600) { count = Math.floor(seconds / 3600); unit = 'hour' }
  else if (seconds < 14 * 86400) { count = Math.floor(seconds / 86400); unit = 'day' }
  else if (seconds < 28 * 86400) { count = Math.floor(seconds / (7 * 86400)); unit = 'week' }
  else {
    const months = Math.max(1, differenceInMonths(new Date(now), date))
    if (months < 24) { count = months; unit = 'month' }
    else { count = differenceInYears(new Date(now), date); unit = 'year' }
  }
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`
}
