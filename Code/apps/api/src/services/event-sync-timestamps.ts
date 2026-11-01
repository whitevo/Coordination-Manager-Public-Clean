const EVENT_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:\d{2})$/

export function eventTimestampKey(timestamp: string): string {
  const match = typeof timestamp === 'string' ? EVENT_TIMESTAMP_PATTERN.exec(timestamp) : null
  const milliseconds = match ? Date.parse(timestamp) : NaN
  const localDate = match ? new Date(`${timestamp.slice(0, 19)}Z`) : null
  if (
    !Number.isFinite(milliseconds) ||
    !localDate ||
    !Number.isFinite(localDate.getTime()) ||
    localDate.toISOString().slice(0, 19) !== timestamp.slice(0, 19)
  ) {
    throw new Error('Imported event timestamps must be valid ISO timestamps with a timezone')
  }

  // Date.parse truncates fractions beyond milliseconds; retain PostgreSQL's microseconds.
  const subMilliseconds = (match?.[1] || '').padEnd(6, '0').slice(3)
  return `${milliseconds}:${subMilliseconds}`
}

export function eventTimestampsEqual(left: string, right: string): boolean {
  return eventTimestampKey(left) === eventTimestampKey(right)
}
