import { describe, expect, it } from 'vitest'
import { __testUtils } from '../mailbox-invitations.js'

describe('mailbox invitation timezone parsing', () => {
  it('uses timezone markers from the subject when the body lacks them', () => {
    const parsed = __testUtils.parseHumanReadableInvitation(
      'Organizer: Pedro Lucas\nLocation: https://meet.google.com/example\nThis event has been updated.',
      'Updated invitation from an unknown sender: 45B Web3 Workshop @ Tue Aug 11, 2026 18:30 - 19:15 (EEST) (recipient@example.com)',
      'calendar-notification@google.com',
    )

    expect(parsed).not.toBeNull()
    expect(parsed?.startsAt).toBe('2026-08-11T15:30:00.000Z')
    expect(parsed?.endsAt).toBe('2026-08-11T16:15:00.000Z')
  })

  it('respects TZID-based ICS times', () => {
    const parsed = __testUtils.parseSingleInvitationBlock([
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:test-uid',
      'SUMMARY:45B Web3 Workshop',
      'DTSTART;TZID=Europe/Tallinn:20260811T183000',
      'DTEND;TZID=Europe/Tallinn:20260811T191500',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n'))

    expect(parsed).not.toBeNull()
    expect(parsed?.startsAt).toBe('2026-08-11T15:30:00.000Z')
    expect(parsed?.endsAt).toBe('2026-08-11T16:15:00.000Z')
  })
})

describe('detected appointment fallback', () => {
  const bookingBody = [
    'Hea Tevo Kask,',
    '',
    'Olete broneerinud:',
    'Floating - 75 min, Floating at 20-08-2026 15:00. Appointment code: w6k5on7yk',
    'Floating - 75 min, Floating at 20-08-2026 15:00. Appointment code: w6k5oo7sa',
    'Olete oodatud!',
  ].join('\n')

  it('creates a single suggestion from repeated identical date and time mentions', () => {
    const parsed = __testUtils.parseDetectedAppointment(bookingBody, 'Broneeringu kinnitus', 'info@floating.ee')

    expect(parsed).not.toBeNull()
    expect(parsed?.startsAt).toBe('2026-08-20T15:00:00.000Z')
    expect(parsed?.endsAt).toBe('2026-08-20T16:15:00.000Z')
    expect(parsed?.rawPayload.detected_matches).toBe(1)
  })

  it('returns null when the text has a date but no time', () => {
    expect(__testUtils.parseDetectedAppointment('Broneeritud 20-08-2026.', 'Kinnitus', 'info@floating.ee')).toBeNull()
  })

  it('returns null when the text has a time but no date', () => {
    expect(__testUtils.parseDetectedAppointment('Oleme avatud kell 15:00.', 'Info', 'info@floating.ee')).toBeNull()
  })
})
