import { describe, expect, it } from 'vitest'
import { formatLastBooted } from '../guardian-ban-time'

const now = Date.parse('2026-10-05T12:00:00Z')
describe('Guardian last booted elapsed tiers', () => {
  it.each([
    [0, '1 second ago'], [1, '1 second ago'], [119, '119 seconds ago'],
    [120, '2 minutes ago'], [7199, '119 minutes ago'], [7200, '2 hours ago'],
    [172799, '47 hours ago'], [172800, '2 days ago'],
    [1209599, '13 days ago'], [1209600, '2 weeks ago'],
    [2419199, '3 weeks ago'], [2419200, '1 month ago'],
  ])('formats boundary %s seconds as %s', (seconds, expected) => {
    expect(formatLastBooted(new Date(now - seconds * 1000).toISOString(), now)).toBe(expected)
  })
  it('uses calendar months until 24 complete months, then calendar years', () => {
    expect(formatLastBooted('2024-10-05T12:00:01Z', now)).toBe('23 months ago')
    expect(formatLastBooted('2024-10-05T12:00:00Z', now)).toBe('2 years ago')
    expect(formatLastBooted('2023-10-05T12:00:00Z', now)).toBe('3 years ago')
  })
  it('does not invent a historical boot timestamp', () => {
    expect(formatLastBooted(null, now)).toBe('Never')
    expect(formatLastBooted('invalid', now)).toBe('Unknown')
    expect(formatLastBooted(new Date(now + 1000).toISOString(), now)).toBe('1 second ago')
  })
})
