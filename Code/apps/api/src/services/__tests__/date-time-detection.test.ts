import { describe, expect, it } from 'vitest'
import { detectDateTimeCandidates, hasDateWithTime } from '../date-time-detection.js'

const BOOKING_EMAIL = `Hea Tevo Kask,

Olete broneerinud:
Floating - 75 min, Floating at 20-08-2026 15:00. Appointment code: w6k5on7yk
Floating - 75 min, Floating at 20-08-2026 15:00. Appointment code: w6k5oo7sa
Olete oodatud!

Parimate soovidega,
Floating

p.s. kui on soov broneering tuhistada siis vajutage siia`

describe('deterministic date + time detection', () => {
  it('collapses repeated identical date and time mentions into one candidate', () => {
    const candidates = detectDateTimeCandidates(BOOKING_EMAIL)

    expect(candidates).toHaveLength(1)
    expect(candidates[0].startLocal).toBe('2026-08-20T15:00')
    expect(candidates[0].durationMinutes).toBe(75)
    expect(candidates[0].endSource).toBe('duration')
    expect(candidates[0].endLocal).toBe('2026-08-20T16:15')
  })

  it('does not trigger when only a date is present', () => {
    expect(hasDateWithTime('Your booking is confirmed for 20-08-2026. See you!')).toBe(false)
  })

  it('does not trigger when only a time is present', () => {
    expect(hasDateWithTime('We start at 15:00 sharp, room 4.')).toBe(false)
  })

  it('does not trigger on empty or plain text', () => {
    expect(hasDateWithTime('')).toBe(false)
    expect(hasDateWithTime('Thanks for your message, talk soon.')).toBe(false)
  })

  it('supports dot, slash and dash separators', () => {
    expect(detectDateTimeCandidates('Kohtume 20.08.2026 kell 15:00')[0]?.startLocal).toBe('2026-08-20T15:00')
    expect(detectDateTimeCandidates('Meeting 20/08/2026 at 15:00')[0]?.startLocal).toBe('2026-08-20T15:00')
    expect(detectDateTimeCandidates('Meeting 20-08-2026 at 15:00')[0]?.startLocal).toBe('2026-08-20T15:00')
  })

  it('supports ISO ordered numeric dates', () => {
    expect(detectDateTimeCandidates('Scheduled 2026-08-20 09:30')[0]?.startLocal).toBe('2026-08-20T09:30')
  })

  it('supports written month names with filler words between date parts', () => {
    expect(detectDateTimeCandidates('On 20th of August 2026 at 15:00')[0]?.startLocal).toBe('2026-08-20T15:00')
    expect(detectDateTimeCandidates('August 20, 2026 3:00 pm')[0]?.startLocal).toBe('2026-08-20T15:00')
    expect(detectDateTimeCandidates('20. august 2026 15.00')[0]?.startLocal).toBe('2026-08-20T15:00')
  })

  it('uses an explicit end time when a range is given', () => {
    const candidate = detectDateTimeCandidates('Workshop 11.08.2026 18:30 - 19:15')[0]
    expect(candidate?.startLocal).toBe('2026-08-11T18:30')
    expect(candidate?.endLocal).toBe('2026-08-11T19:15')
    expect(candidate?.endSource).toBe('explicit')
  })

  it('falls back to a default duration when no end time or duration is present', () => {
    const candidate = detectDateTimeCandidates('Call on 20-08-2026 15:00')[0]
    expect(candidate?.endLocal).toBe('2026-08-20T16:00')
    expect(candidate?.endSource).toBe('default')
  })

  it('keeps distinct date and time combinations separate', () => {
    const candidates = detectDateTimeCandidates('Session A 20-08-2026 15:00\nSession B 21-08-2026 09:00')
    expect(candidates.map((item) => item.startLocal)).toEqual(['2026-08-20T15:00', '2026-08-21T09:00'])
  })

  it('rejects impossible dates and times', () => {
    expect(hasDateWithTime('Invoice 32-13-2026 at 15:00')).toBe(false)
    expect(hasDateWithTime('Reference 20-08-2026 code 99:99')).toBe(false)
  })

  it('ignores a time that is far away from the date', () => {
    const text = 'Contract dated 20-08-2026 with terms, conditions, appendices and other clauses.\n\nOffice opens 09:00'
    expect(hasDateWithTime(text)).toBe(false)
  })

  it('resolves ambiguous numeric dates as day-first by default', () => {
    const candidate = detectDateTimeCandidates('Meeting 05/08/2026 at 10:00')[0]
    expect(candidate?.startLocal).toBe('2026-08-05T10:00')
    expect(candidate?.dayFirstAssumed).toBe(true)

    const monthFirst = detectDateTimeCandidates('Meeting 05/08/2026 at 10:00', { dayFirst: false })[0]
    expect(monthFirst?.startLocal).toBe('2026-05-08T10:00')
  })

  it('uses the reference year when the written date omits it', () => {
    const candidate = detectDateTimeCandidates('Dinner on 20 August at 19:00', { referenceYear: 2031 })[0]
    expect(candidate?.startLocal).toBe('2031-08-20T19:00')
    expect(candidate?.yearAssumed).toBe(true)
  })
})

describe('timestamp and document noise rejection', () => {
  it('ignores invoice and billing lines', () => {
    expect(hasDateWithTime('Invoice INV-4471 issued 20-08-2026 15:00')).toBe(false)
    expect(hasDateWithTime('Payment due 20-08-2026 15:00')).toBe(false)
    expect(hasDateWithTime('Arve tahtaeg 20-08-2026 15:00')).toBe(false)
  })

  it('ignores document and log timestamps', () => {
    expect(hasDateWithTime('Last updated: 20-08-2026 15:00')).toBe(false)
    expect(hasDateWithTime('Document generated on 20-08-2026 15:00')).toBe(false)
    expect(hasDateWithTime('Copyright 2026 Example Ltd, version 3.2 released 20-08-2026 15:00')).toBe(false)
  })

  it('ignores mail header and quoted reply lines', () => {
    expect(hasDateWithTime('Sent: 20-08-2026 15:00')).toBe(false)
    expect(hasDateWithTime('On 20-08-2026 15:00 Tevo Kask wrote:')).toBe(false)
  })

  it('ignores times that carry a seconds component', () => {
    expect(hasDateWithTime('Backup completed 20-08-2026 15:00:32 successfully')).toBe(false)
  })

  it('keeps noise matches when explicitly allowed', () => {
    expect(hasDateWithTime('Last updated: 20-08-2026 15:00', { allowNoiseContext: true })).toBe(true)
  })

  it('drops candidates that match an excluded instant such as the message send time', () => {
    const text = 'Booking confirmed 20-08-2026 15:00'
    expect(hasDateWithTime(text)).toBe(true)
    expect(hasDateWithTime(text, { excludeInstants: ['2026-08-20T15:02:00.000Z'] })).toBe(false)
    expect(hasDateWithTime(text, { excludeInstants: ['2026-08-20T18:00:00.000Z'] })).toBe(true)
  })

  it('still detects a real booking line that sits next to noise lines', () => {
    const text = [
      'Invoice INV-4471 issued 01-08-2026 09:00',
      'Your session is booked at 20-08-2026 15:00.',
      'Last updated: 02-08-2026 11:30',
    ].join('\n')

    const candidates = detectDateTimeCandidates(text)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].startLocal).toBe('2026-08-20T15:00')
  })

  it('detects a booking in a single-line body even when a noise word appears far away', () => {
    const singleLine = BOOKING_EMAIL.replace(/\n+/g, ' ') + ' Unsubscribe from these emails at any time.'
    const candidates = detectDateTimeCandidates(singleLine)

    expect(candidates).toHaveLength(1)
    expect(candidates[0].startLocal).toBe('2026-08-20T15:00')
    expect(candidates[0].durationMinutes).toBe(75)
  })
})
