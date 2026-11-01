import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  getAllTimezones,
  findTimezone,
  searchTimezones,
  formatTimezoneLabel,
  formatTimezoneShort,
  groupByRegion,
  groupByCountry,
  detectLocalTimezone,
  convertUtcTimeToTimezone,
  convertUtcTimeToTimezoneOnDate,
  getTimezoneAbbr,
  getTimezoneAbbrOnDate,
  getOffsetOnDate,
  getBrowserTimezone,
  getEditingTimezone,
  formatTimeInTimezone,
  formatDateInTimezone,
  formatDateTimeInTimezone,
  formatDateDDMMYYYYInTimezone,
  formatDateTimeDDMMYYYYInTimezone,
  formatUtcTimeWithPeriodInTimezone,
  formatShortDateInTimezone,
  formatTimeOnlyInTimezone,
  MAX_TIMEZONES,
} from '../timezone-data'

// ---------------------------------------------------------------------------
// 1. Timezone Data Integrity
// ---------------------------------------------------------------------------

describe('timezone data integrity', () => {
  it('returns a populated list of timezones', () => {
    const all = getAllTimezones()
    expect(all.length).toBeGreaterThan(100)
  })

  it('every entry has required fields', () => {
    for (const tz of getAllTimezones()) {
      expect(tz.iana).toBeTruthy()
      expect(tz.city).toBeTruthy()
      expect(tz.country).toBeTruthy()
      expect(typeof tz.offsetMinutes).toBe('number')
      expect(tz.utcOffset).toMatch(/^UTC[+-]\d{2}:\d{2}$/)
    }
  })

  it('includes UTC with offset 0', () => {
    const utc = findTimezone('UTC')
    expect(utc).toBeDefined()
    expect(utc!.offsetMinutes).toBe(0)
    expect(utc!.utcOffset).toBe('UTC+00:00')
  })

  it('includes major IANA zones', () => {
    const required = [
      'America/New_York',
      'America/Los_Angeles',
      'Europe/London',
      'Europe/Berlin',
      'Asia/Tokyo',
      'Asia/Kolkata',
      'Australia/Sydney',
      'Pacific/Auckland',
    ]
    for (const iana of required) {
      expect(findTimezone(iana)).toBeDefined()
    }
  })

  it('entries are sorted by offset ascending', () => {
    const all = getAllTimezones()
    for (let i = 1; i < all.length; i++) {
      expect(all[i].offsetMinutes).toBeGreaterThanOrEqual(all[i - 1].offsetMinutes)
    }
  })

  it('MAX_TIMEZONES is 5', () => {
    expect(MAX_TIMEZONES).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// 2. findTimezone
// ---------------------------------------------------------------------------

describe('findTimezone', () => {
  it('returns entry for known IANA id', () => {
    const ny = findTimezone('America/New_York')
    expect(ny).toBeDefined()
    expect(ny!.city).toBe('New York')
    expect(ny!.country).toBe('United States')
  })

  it('returns undefined for unknown IANA id', () => {
    expect(findTimezone('Fake/Nowhere')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 3. searchTimezones
// ---------------------------------------------------------------------------

describe('searchTimezones', () => {
  it('returns all timezones for empty query', () => {
    const all = getAllTimezones()
    expect(searchTimezones('')).toHaveLength(all.length)
    expect(searchTimezones('  ')).toHaveLength(all.length)
  })

  it('finds by city name', () => {
    const results = searchTimezones('Tokyo')
    expect(results.some((t) => t.iana === 'Asia/Tokyo')).toBe(true)
  })

  it('finds by country name', () => {
    const results = searchTimezones('Germany')
    expect(results.some((t) => t.iana === 'Europe/Berlin')).toBe(true)
  })

  it('finds by IANA identifier substring', () => {
    const results = searchTimezones('America/New')
    expect(results.some((t) => t.iana === 'America/New_York')).toBe(true)
  })

  it('finds by UTC offset string', () => {
    const results = searchTimezones('UTC+00:00')
    expect(results.some((t) => t.iana === 'UTC')).toBe(true)
  })

  it('search is case-insensitive', () => {
    const lower = searchTimezones('london')
    const upper = searchTimezones('LONDON')
    expect(lower.length).toBe(upper.length)
    expect(lower.some((t) => t.iana === 'Europe/London')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 4. formatTimezoneLabel / formatTimezoneShort
// ---------------------------------------------------------------------------

describe('formatTimezoneLabel', () => {
  it('formats UTC specially', () => {
    const utc = findTimezone('UTC')!
    expect(formatTimezoneLabel(utc)).toBe('UTC+00:00 - UTC')
  })

  it('includes offset, city, and abbreviation for non-UTC', () => {
    const ny = findTimezone('America/New_York')!
    const label = formatTimezoneLabel(ny)
    expect(label).toContain(ny.utcOffset)
    expect(label).toContain('New York')
    expect(label).toContain(ny.abbr)
  })
})

describe('formatTimezoneShort', () => {
  it('returns "UTC" for UTC', () => {
    const utc = findTimezone('UTC')!
    expect(formatTimezoneShort(utc)).toBe('UTC')
  })

  it('returns "City (Abbr)" for non-UTC', () => {
    const tokyo = findTimezone('Asia/Tokyo')!
    const short = formatTimezoneShort(tokyo)
    expect(short).toContain('Tokyo')
    expect(short).toMatch(/\(.+\)/)
  })
})

// ---------------------------------------------------------------------------
// 5. groupByRegion / groupByCountry
// ---------------------------------------------------------------------------

describe('groupByRegion', () => {
  it('groups UTC separately', () => {
    const groups = groupByRegion(getAllTimezones())
    expect(groups['UTC']).toBeDefined()
    expect(groups['UTC'].some((t) => t.iana === 'UTC')).toBe(true)
  })

  it('groups by first IANA path segment', () => {
    const groups = groupByRegion(getAllTimezones())
    expect(groups['America']).toBeDefined()
    expect(groups['Europe']).toBeDefined()
    expect(groups['Asia']).toBeDefined()
  })
})

describe('groupByCountry', () => {
  it('groups entries by country name', () => {
    const groups = groupByCountry(getAllTimezones())
    expect(groups['United States']).toBeDefined()
    expect(groups['United States'].length).toBeGreaterThanOrEqual(4) // NY, Chicago, Denver, LA, etc.
  })
})

// ---------------------------------------------------------------------------
// 6. detectLocalTimezone
// ---------------------------------------------------------------------------

describe('detectLocalTimezone', () => {
  it('returns a non-empty IANA string', () => {
    const tz = detectLocalTimezone()
    expect(tz).toBeTruthy()
    expect(typeof tz).toBe('string')
    // Should be a valid IANA-ish format or "UTC"
    expect(tz === 'UTC' || tz.includes('/')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 7. convertUtcTimeToTimezone (core conversion)
// ---------------------------------------------------------------------------

describe('convertUtcTimeToTimezone', () => {
  it('returns same time for UTC', () => {
    expect(convertUtcTimeToTimezone('09:00', 'UTC')).toBe('09:00')
    expect(convertUtcTimeToTimezone('23:30', 'UTC')).toBe('23:30')
    expect(convertUtcTimeToTimezone('00:00', 'UTC')).toBe('00:00')
  })

  it('converts UTC to a fixed-offset timezone (Asia/Kolkata = UTC+5:30)', () => {
    // Kolkata is always UTC+5:30, no DST
    const result = convertUtcTimeToTimezone('09:00', 'Asia/Kolkata')
    expect(result).toBe('14:30')
  })

  it('converts UTC midnight to Kolkata', () => {
    const result = convertUtcTimeToTimezone('00:00', 'Asia/Kolkata')
    expect(result).toBe('05:30')
  })

  it('handles day rollover (UTC 22:00 to Kolkata)', () => {
    // 22:00 UTC + 5:30 = 03:30 next day
    const result = convertUtcTimeToTimezone('22:00', 'Asia/Kolkata')
    expect(result).toBe('03:30')
  })

  it('handles negative offset (UTC to Honolulu = UTC-10)', () => {
    // 09:00 UTC - 10h = 23:00 previous day
    const result = convertUtcTimeToTimezone('09:00', 'Pacific/Honolulu')
    expect(result).toBe('23:00')
  })

  it('converts UTC to non-DST zone (Asia/Tokyo = UTC+9)', () => {
    // 09:00 UTC + 9h = 18:00
    const result = convertUtcTimeToTimezone('09:00', 'Asia/Tokyo')
    expect(result).toBe('18:00')
  })

  it('returns HH:MM format (zero-padded)', () => {
    const result = convertUtcTimeToTimezone('00:00', 'Asia/Tokyo')
    // 00:00 UTC + 9h = 09:00
    expect(result).toBe('09:00')
    expect(result).toMatch(/^\d{2}:\d{2}$/)
  })
})

// ---------------------------------------------------------------------------
// 8. convertUtcTimeToTimezoneOnDate (DST-aware, date-specific conversion)
// ---------------------------------------------------------------------------

describe('convertUtcTimeToTimezoneOnDate', () => {
  it('returns same time for UTC regardless of date', () => {
    const summer = new Date(2026, 6, 15) // July 15
    const winter = new Date(2026, 0, 15) // Jan 15
    expect(convertUtcTimeToTimezoneOnDate('12:00', 'UTC', summer)).toBe('12:00')
    expect(convertUtcTimeToTimezoneOnDate('12:00', 'UTC', winter)).toBe('12:00')
  })

  it('converts correctly for non-DST zone (Asia/Kolkata)', () => {
    const summer = new Date(2026, 6, 15)
    const winter = new Date(2026, 0, 15)
    // Kolkata is always +5:30
    expect(convertUtcTimeToTimezoneOnDate('09:00', 'Asia/Kolkata', summer)).toBe('14:30')
    expect(convertUtcTimeToTimezoneOnDate('09:00', 'Asia/Kolkata', winter)).toBe('14:30')
  })

  it('handles US Eastern DST transition (EST vs EDT)', () => {
    // US Eastern: EST = UTC-5, EDT = UTC-4
    // In 2026, DST starts March 8, ends Nov 1

    // January (EST = UTC-5): 15:00 UTC = 10:00 EST
    const winter = new Date(2026, 0, 15)
    expect(convertUtcTimeToTimezoneOnDate('15:00', 'America/New_York', winter)).toBe('10:00')

    // July (EDT = UTC-4): 15:00 UTC = 11:00 EDT
    const summer = new Date(2026, 6, 15)
    expect(convertUtcTimeToTimezoneOnDate('15:00', 'America/New_York', summer)).toBe('11:00')
  })

  it('handles European DST transition (CET vs CEST)', () => {
    // Europe/Berlin: CET = UTC+1, CEST = UTC+2
    // In 2026, DST starts last Sunday of March (Mar 29), ends last Sunday of October (Oct 25)

    // February (CET = UTC+1): 12:00 UTC = 13:00 CET
    const winter = new Date(2026, 1, 15)
    expect(convertUtcTimeToTimezoneOnDate('12:00', 'Europe/Berlin', winter)).toBe('13:00')

    // June (CEST = UTC+2): 12:00 UTC = 14:00 CEST
    const summer = new Date(2026, 5, 15)
    expect(convertUtcTimeToTimezoneOnDate('12:00', 'Europe/Berlin', summer)).toBe('14:00')
  })

  it('handles Southern Hemisphere DST (Australia/Sydney)', () => {
    // Sydney: AEST = UTC+10, AEDT = UTC+11
    // DST runs approximately October to April (southern summer)

    // January (southern summer, AEDT = UTC+11): 02:00 UTC = 13:00 AEDT
    const janDate = new Date(2026, 0, 15)
    expect(convertUtcTimeToTimezoneOnDate('02:00', 'Australia/Sydney', janDate)).toBe('13:00')

    // July (southern winter, AEST = UTC+10): 02:00 UTC = 12:00 AEST
    const julDate = new Date(2026, 6, 15)
    expect(convertUtcTimeToTimezoneOnDate('02:00', 'Australia/Sydney', julDate)).toBe('12:00')
  })

  it('handles day rollover on a specific date', () => {
    // 23:00 UTC + 9h (Tokyo) = 08:00 next day
    const date = new Date(2026, 3, 10) // April 10
    expect(convertUtcTimeToTimezoneOnDate('23:00', 'Asia/Tokyo', date)).toBe('08:00')
  })

  it('handles day rollback (negative crossing midnight)', () => {
    // 01:00 UTC - 10h (Honolulu) = 15:00 previous day
    const date = new Date(2026, 3, 10)
    expect(convertUtcTimeToTimezoneOnDate('01:00', 'Pacific/Honolulu', date)).toBe('15:00')
  })
})

// ---------------------------------------------------------------------------
// 9. getOffsetOnDate (DST-aware offset retrieval)
// ---------------------------------------------------------------------------

describe('getOffsetOnDate', () => {
  it('returns 0 for UTC', () => {
    expect(getOffsetOnDate('UTC', new Date())).toBe(0)
  })

  it('returns +330 for Asia/Kolkata regardless of date', () => {
    const summer = new Date(2026, 6, 15)
    const winter = new Date(2026, 0, 15)
    expect(getOffsetOnDate('Asia/Kolkata', summer)).toBe(330)
    expect(getOffsetOnDate('Asia/Kolkata', winter)).toBe(330)
  })

  it('returns +540 for Asia/Tokyo (no DST)', () => {
    expect(getOffsetOnDate('Asia/Tokyo', new Date(2026, 0, 15))).toBe(540)
    expect(getOffsetOnDate('Asia/Tokyo', new Date(2026, 6, 15))).toBe(540)
  })

  it('returns different offsets for US Eastern in winter vs summer', () => {
    const winter = new Date(2026, 0, 15) // January
    const summer = new Date(2026, 6, 15) // July
    const winterOffset = getOffsetOnDate('America/New_York', winter)
    const summerOffset = getOffsetOnDate('America/New_York', summer)
    expect(winterOffset).toBe(-300) // EST = UTC-5 = -300min
    expect(summerOffset).toBe(-240) // EDT = UTC-4 = -240min
  })

  it('returns different offsets for Europe/Berlin in winter vs summer', () => {
    const winter = new Date(2026, 1, 15) // February
    const summer = new Date(2026, 5, 15) // June
    expect(getOffsetOnDate('Europe/Berlin', winter)).toBe(60)   // CET = UTC+1
    expect(getOffsetOnDate('Europe/Berlin', summer)).toBe(120)  // CEST = UTC+2
  })

  it('returns different offsets for Australia/Sydney in southern winter vs summer', () => {
    const southernSummer = new Date(2026, 0, 15) // January
    const southernWinter = new Date(2026, 6, 15) // July
    expect(getOffsetOnDate('Australia/Sydney', southernSummer)).toBe(660)  // AEDT = UTC+11
    expect(getOffsetOnDate('Australia/Sydney', southernWinter)).toBe(600)  // AEST = UTC+10
  })
})

// ---------------------------------------------------------------------------
// 10. getTimezoneAbbr / getTimezoneAbbrOnDate
// ---------------------------------------------------------------------------

describe('getTimezoneAbbr', () => {
  it('returns "UTC" for UTC', () => {
    expect(getTimezoneAbbr('UTC')).toBe('UTC')
  })

  it('returns a non-empty string for known zones', () => {
    expect(getTimezoneAbbr('America/New_York')).toBeTruthy()
    expect(getTimezoneAbbr('Asia/Tokyo')).toBeTruthy()
  })
})

describe('getTimezoneAbbrOnDate', () => {
  it('returns "UTC" for UTC on any date', () => {
    expect(getTimezoneAbbrOnDate('UTC', new Date(2026, 0, 1))).toBe('UTC')
  })

  it('returns different abbreviations for DST vs non-DST', () => {
    const winter = new Date(2026, 0, 15)
    const summer = new Date(2026, 6, 15)
    const winterAbbr = getTimezoneAbbrOnDate('America/New_York', winter)
    const summerAbbr = getTimezoneAbbrOnDate('America/New_York', summer)
    // EST vs EDT
    expect(winterAbbr).not.toBe(summerAbbr)
  })

  it('returns same abbreviation for non-DST zone regardless of date', () => {
    const winter = new Date(2026, 0, 15)
    const summer = new Date(2026, 6, 15)
    // JST does not observe DST
    expect(getTimezoneAbbrOnDate('Asia/Tokyo', winter)).toBe(getTimezoneAbbrOnDate('Asia/Tokyo', summer))
  })
})

// ---------------------------------------------------------------------------
// 11. Format functions (date-based formatting in a timezone)
// ---------------------------------------------------------------------------

describe('formatTimeInTimezone', () => {
  // Use a fixed UTC timestamp: 2026-01-15T15:30:00Z
  const utcDate = new Date(Date.UTC(2026, 0, 15, 15, 30, 0))

  it('formats in UTC as 3:30 PM', () => {
    const result = formatTimeInTimezone(utcDate, 'UTC')
    expect(result).toContain('3:30')
    expect(result).toMatch(/PM/i)
  })

  it('formats in Asia/Kolkata as 9:00 PM (UTC+5:30)', () => {
    const result = formatTimeInTimezone(utcDate, 'Asia/Kolkata')
    expect(result).toContain('9:00')
    expect(result).toMatch(/PM/i)
  })

  it('formats in America/New_York as 10:30 AM (EST in January)', () => {
    const result = formatTimeInTimezone(utcDate, 'America/New_York')
    expect(result).toContain('10:30')
    expect(result).toMatch(/AM/i)
  })

  it('accepts ISO string input', () => {
    const result = formatTimeInTimezone('2026-01-15T15:30:00Z', 'UTC')
    expect(result).toContain('3:30')
    expect(result).toMatch(/PM/i)
  })
})

describe('formatDateInTimezone', () => {
  // A UTC timestamp near midnight that crosses date boundary in some zones
  const utcDate = new Date(Date.UTC(2026, 0, 15, 23, 30, 0)) // Jan 15 at 23:30 UTC

  it('shows Jan 15 in UTC', () => {
    const result = formatDateInTimezone(utcDate, 'UTC')
    expect(result).toContain('Jan')
    expect(result).toContain('15')
    expect(result).toContain('2026')
  })

  it('shows Jan 16 in Asia/Tokyo (23:30 UTC + 9h = 08:30 next day)', () => {
    const result = formatDateInTimezone(utcDate, 'Asia/Tokyo')
    expect(result).toContain('Jan')
    expect(result).toContain('16')
    expect(result).toContain('2026')
  })

  it('shows Jan 15 in America/New_York (23:30 UTC - 5h = 18:30 same day)', () => {
    const result = formatDateInTimezone(utcDate, 'America/New_York')
    expect(result).toContain('Jan')
    expect(result).toContain('15')
    expect(result).toContain('2026')
  })
})

describe('formatDateTimeInTimezone', () => {
  const utcDate = new Date(Date.UTC(2026, 0, 15, 15, 30, 0))

  it('includes date, time, and timezone abbreviation', () => {
    const result = formatDateTimeInTimezone(utcDate, 'America/New_York')
    expect(result).toContain('Jan')
    expect(result).toContain('15')
    expect(result).toContain('2026')
    expect(result).toContain('10:30')
    // Should contain the timezone abbr
    expect(result.length).toBeGreaterThan(15)
  })
})

describe('formatDateDDMMYYYYInTimezone', () => {
  const utcDate = new Date(Date.UTC(2026, 0, 15, 12, 0, 0))

  it('formats as dd.mm.yyyy in UTC', () => {
    const result = formatDateDDMMYYYYInTimezone(utcDate, 'UTC')
    expect(result).toBe('15.01.2026')
  })

  it('formats date boundary correctly in Tokyo', () => {
    // UTC 23:30 Jan 15 -> Jan 16 in Tokyo
    const nearMidnight = new Date(Date.UTC(2026, 0, 15, 23, 30, 0))
    const result = formatDateDDMMYYYYInTimezone(nearMidnight, 'Asia/Tokyo')
    expect(result).toBe('16.01.2026')
  })
})

describe('formatDateTimeDDMMYYYYInTimezone', () => {
  const utcDate = new Date(Date.UTC(2026, 0, 15, 15, 30, 0))

  it('includes dd.mm.yyyy, 24h time, and TZ abbr', () => {
    const result = formatDateTimeDDMMYYYYInTimezone(utcDate, 'Asia/Kolkata')
    // 15:30 UTC + 5:30 = 21:00 IST
    expect(result).toContain('15.01.2026')
    expect(result).toContain('21:00')
  })
})

describe('formatUtcTimeWithPeriodInTimezone', () => {
  it('formats UTC noon in Kolkata as 5:30 PM IST', () => {
    const result = formatUtcTimeWithPeriodInTimezone('12:00', 'Asia/Kolkata')
    expect(result).toContain('5:30')
    expect(result).toMatch(/PM/i)
  })

  it('includes timezone abbreviation', () => {
    const result = formatUtcTimeWithPeriodInTimezone('09:00', 'America/New_York')
    // Should end with the TZ abbr (EST or EDT depending on current date)
    expect(result.split(' ').length).toBeGreaterThanOrEqual(3) // "H:MM AM/PM ABBR"
  })
})

describe('formatShortDateInTimezone', () => {
  const utcDate = new Date(Date.UTC(2026, 0, 15, 12, 0, 0)) // Thursday Jan 15, 2026

  it('includes weekday, month, and day', () => {
    const result = formatShortDateInTimezone(utcDate, 'UTC')
    expect(result).toContain('Thu')
    expect(result).toContain('Jan')
    expect(result).toContain('15')
  })
})

describe('formatTimeOnlyInTimezone', () => {
  const utcDate = new Date(Date.UTC(2026, 0, 15, 15, 30, 0))

  it('returns time without timezone suffix', () => {
    const result = formatTimeOnlyInTimezone(utcDate, 'UTC')
    expect(result).toContain('3:30')
    expect(result).toMatch(/PM/i)
    // Should NOT have a timezone abbreviation appended
    expect(result).not.toMatch(/UTC|EST|PST/)
  })
})

// ---------------------------------------------------------------------------
// 12. Date boundary scenarios (critical for calendars)
// ---------------------------------------------------------------------------

describe('date boundary scenarios', () => {
  it('23:00 UTC is same day in London (winter)', () => {
    // GMT = UTC+0 in winter
    const date = new Date(2026, 0, 15)
    expect(convertUtcTimeToTimezoneOnDate('23:00', 'Europe/London', date)).toBe('23:00')
  })

  it('23:00 UTC crosses to next day in Berlin (winter CET = UTC+1)', () => {
    const date = new Date(2026, 0, 15)
    expect(convertUtcTimeToTimezoneOnDate('23:00', 'Europe/Berlin', date)).toBe('00:00')
  })

  it('00:30 UTC is previous day in US Pacific (winter PST = UTC-8)', () => {
    // 00:30 UTC - 8h = 16:30 previous day
    const date = new Date(2026, 0, 15)
    expect(convertUtcTimeToTimezoneOnDate('00:30', 'America/Los_Angeles', date)).toBe('16:30')
  })

  it('midnight UTC stays midnight in UTC', () => {
    const date = new Date(2026, 0, 15)
    expect(convertUtcTimeToTimezoneOnDate('00:00', 'UTC', date)).toBe('00:00')
  })
})

// ---------------------------------------------------------------------------
// 13. Availability time slot format scenarios
// ---------------------------------------------------------------------------

describe('availability time slot format conventions', () => {
  // These test the expected ISO format used for time_slots in the database

  it('web time slots use ISO T separator (YYYY-MM-DDTHH:MM)', () => {
    const webSlot = '2026-01-15T09:00'
    expect(webSlot).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })

  it('agent time slots use underscore separator (YYYY-MM-DD_HH:MM)', () => {
    const agentSlot = '2026-01-15_09:00'
    expect(agentSlot).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}:\d{2}$/)
  })

  it('web to agent format conversion is reversible', () => {
    const webSlot = '2026-01-15T09:00'
    const agentSlot = webSlot.replace('T', '_')
    const backToWeb = agentSlot.replace('_', 'T')
    expect(agentSlot).toBe('2026-01-15_09:00')
    expect(backToWeb).toBe(webSlot)
  })

  it('time slot parsing extracts correct date and time', () => {
    const slot = '2026-03-15T14:30'
    const [datePart, timePart] = slot.split('T')
    expect(datePart).toBe('2026-03-15')
    expect(timePart).toBe('14:30')

    const [year, month, day] = datePart.split('-').map(Number)
    const [hour, minute] = timePart.split(':').map(Number)
    expect(year).toBe(2026)
    expect(month).toBe(3)
    expect(day).toBe(15)
    expect(hour).toBe(14)
    expect(minute).toBe(30)
  })
})

// ---------------------------------------------------------------------------
// 14. Cross-timezone meeting time display
// ---------------------------------------------------------------------------

describe('cross-timezone meeting time display', () => {
  // Scenario: A meeting stored as UTC 2026-01-15T18:00:00Z
  // Should display correctly in multiple timezones
  const meetingUtc = new Date(Date.UTC(2026, 0, 15, 18, 0, 0))

  it('displays correct time in UTC', () => {
    expect(formatTimeInTimezone(meetingUtc, 'UTC')).toContain('6:00')
  })

  it('displays correct time in US Eastern (EST = UTC-5)', () => {
    // 18:00 UTC - 5 = 13:00 = 1:00 PM
    const result = formatTimeInTimezone(meetingUtc, 'America/New_York')
    expect(result).toContain('1:00')
    expect(result).toMatch(/PM/i)
  })

  it('displays correct time in India (IST = UTC+5:30)', () => {
    // 18:00 UTC + 5:30 = 23:30 = 11:30 PM
    const result = formatTimeInTimezone(meetingUtc, 'Asia/Kolkata')
    expect(result).toContain('11:30')
    expect(result).toMatch(/PM/i)
  })

  it('displays correct time in Japan (JST = UTC+9)', () => {
    // 18:00 UTC + 9 = 03:00 next day = 3:00 AM
    const result = formatTimeInTimezone(meetingUtc, 'Asia/Tokyo')
    expect(result).toContain('3:00')
    expect(result).toMatch(/AM/i)
  })

  it('displays correct date when meeting crosses date boundary', () => {
    // 18:00 UTC Jan 15 + 9h = 03:00 Jan 16 in Tokyo
    expect(formatDateInTimezone(meetingUtc, 'Asia/Tokyo')).toContain('16')
    // Same meeting in NY: 18:00 - 5 = 13:00, still Jan 15
    expect(formatDateInTimezone(meetingUtc, 'America/New_York')).toContain('15')
  })
})

// ---------------------------------------------------------------------------
// 15. Half-hour and 45-minute offset timezones
// ---------------------------------------------------------------------------

describe('non-standard offset timezones', () => {
  it('handles +5:30 offset (Asia/Kolkata)', () => {
    const date = new Date(2026, 0, 15)
    // 10:00 UTC + 5:30 = 15:30
    expect(convertUtcTimeToTimezoneOnDate('10:00', 'Asia/Kolkata', date)).toBe('15:30')
  })

  it('handles +5:45 offset (Asia/Kathmandu)', () => {
    // Nepal is UTC+5:45
    const entry = findTimezone('Asia/Kathmandu')
    if (entry) {
      const date = new Date(2026, 0, 15)
      // 10:00 UTC + 5:45 = 15:45
      expect(convertUtcTimeToTimezoneOnDate('10:00', 'Asia/Kathmandu', date)).toBe('15:45')
    }
  })

  it('handles -3:30 offset (America/St_Johns -- Newfoundland)', () => {
    // Newfoundland Standard Time (NST) = UTC-3:30
    const winterDate = new Date(2026, 0, 15) // January, no DST
    // 10:00 UTC - 3:30 = 06:30
    expect(convertUtcTimeToTimezoneOnDate('10:00', 'America/St_Johns', winterDate)).toBe('06:30')
  })
})

// ---------------------------------------------------------------------------
// 16. DST transition edge cases
// ---------------------------------------------------------------------------

describe('DST transition edge cases', () => {
  it('same UTC time maps to different local times across DST boundary (US Eastern)', () => {
    // Before DST: Jan 15 (EST, UTC-5)
    const preDst = new Date(2026, 0, 15)
    // After DST: April 15 (EDT, UTC-4)
    const postDst = new Date(2026, 3, 15)

    const winterLocal = convertUtcTimeToTimezoneOnDate('17:00', 'America/New_York', preDst)
    const summerLocal = convertUtcTimeToTimezoneOnDate('17:00', 'America/New_York', postDst)

    expect(winterLocal).toBe('12:00') // 17:00 - 5 = 12:00
    expect(summerLocal).toBe('13:00') // 17:00 - 4 = 13:00
    expect(winterLocal).not.toBe(summerLocal)
  })

  it('same UTC time maps to different local times across DST boundary (Europe/Berlin)', () => {
    const preDst = new Date(2026, 1, 15) // Feb (CET, UTC+1)
    const postDst = new Date(2026, 5, 15) // June (CEST, UTC+2)

    const winterLocal = convertUtcTimeToTimezoneOnDate('10:00', 'Europe/Berlin', preDst)
    const summerLocal = convertUtcTimeToTimezoneOnDate('10:00', 'Europe/Berlin', postDst)

    expect(winterLocal).toBe('11:00') // 10:00 + 1 = 11:00
    expect(summerLocal).toBe('12:00') // 10:00 + 2 = 12:00
  })

  it('offset changes correctly for Southern Hemisphere (Australia/Sydney)', () => {
    // AEDT (UTC+11) in January (southern summer)
    const aedt = getOffsetOnDate('Australia/Sydney', new Date(2026, 0, 15))
    // AEST (UTC+10) in July (southern winter)
    const aest = getOffsetOnDate('Australia/Sydney', new Date(2026, 6, 15))

    expect(aedt).toBe(660) // +11h
    expect(aest).toBe(600) // +10h
    expect(aedt - aest).toBe(60) // 1 hour difference
  })
})

// ---------------------------------------------------------------------------
// 17. Multi-timezone simultaneous display
// ---------------------------------------------------------------------------

describe('multi-timezone simultaneous display', () => {
  // Simulates what the CalendarPage does: show same UTC event in multiple zones at once
  it('same UTC time renders consistently across 3 timezones', () => {
    const meetingUtc = new Date(Date.UTC(2026, 5, 15, 14, 0, 0)) // June 15 14:00 UTC

    const utcTime = formatTimeInTimezone(meetingUtc, 'UTC')
    const nyTime = formatTimeInTimezone(meetingUtc, 'America/New_York')
    const tokyoTime = formatTimeInTimezone(meetingUtc, 'Asia/Tokyo')

    // UTC: 2:00 PM
    expect(utcTime).toContain('2:00')
    // NY (EDT = UTC-4): 10:00 AM
    expect(nyTime).toContain('10:00')
    // Tokyo (JST = UTC+9): 11:00 PM
    expect(tokyoTime).toContain('11:00')
  })
})

// ---------------------------------------------------------------------------
// 18. Editing timezone resolution (mailbox invitation picker)
// ---------------------------------------------------------------------------

describe('getBrowserTimezone', () => {
  it('returns the runtime local IANA timezone', () => {
    expect(getBrowserTimezone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone || null)
  })
})

describe('getEditingTimezone', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('prefers the configured primary timezone', () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) =>
        key === 'coordination-timezones' ? JSON.stringify({ primary: 'Europe/Tallinn' }) : null,
    })

    expect(getEditingTimezone()).toBe('Europe/Tallinn')
  })

  it('respects an explicit UTC primary choice', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ primary: 'UTC', additional: [] }),
    })

    expect(getEditingTimezone()).toBe('UTC')
  })

  it('falls back to the browser timezone instead of UTC when nothing is stored', () => {
    vi.stubGlobal('localStorage', { getItem: () => null })

    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone
    expect(getEditingTimezone()).toBe(browserTz || 'UTC')
  })

  it('falls back to the browser timezone when stored data is corrupt', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{not json' })

    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone
    expect(getEditingTimezone()).toBe(browserTz || 'UTC')
  })
})
