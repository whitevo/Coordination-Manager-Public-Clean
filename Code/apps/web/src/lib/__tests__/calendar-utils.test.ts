import { describe, it, expect } from 'vitest'
import {
  isSafeUrl,
  generateICSContent,
  buildOutlookCalendarUrl,
  resolveMeetingTitle,
} from '../calendar-utils'

// ---------------------------------------------------------------------------
// isSafeUrl
// ---------------------------------------------------------------------------

describe('isSafeUrl', () => {
  it('accepts http URLs', () => {
    expect(isSafeUrl('http://example.com')).toBe(true)
  })

  it('accepts https URLs', () => {
    expect(isSafeUrl('https://example.com/path?q=1')).toBe(true)
  })

  it('is case-insensitive for scheme', () => {
    expect(isSafeUrl('HTTPS://Example.com')).toBe(true)
    expect(isSafeUrl('HTTP://Example.com')).toBe(true)
  })

  it('trims whitespace before checking', () => {
    expect(isSafeUrl('  https://example.com  ')).toBe(true)
  })

  it('rejects javascript: URLs', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false)
  })

  it('rejects data: URLs', () => {
    expect(isSafeUrl('data:text/html,<h1>Hi</h1>')).toBe(false)
  })

  it('rejects ftp: URLs', () => {
    expect(isSafeUrl('ftp://files.example.com')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isSafeUrl('')).toBe(false)
  })

  it('rejects null and undefined', () => {
    expect(isSafeUrl(null)).toBe(false)
    expect(isSafeUrl(undefined)).toBe(false)
  })

  it('rejects bare text', () => {
    expect(isSafeUrl('just some text')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// generateICSContent
// ---------------------------------------------------------------------------

describe('generateICSContent', () => {
  const baseEvent = {
    title: 'Team Standup',
    start_time: '2026-03-15T10:00:00Z',
    end_time: '2026-03-15T10:30:00Z',
  }

  it('returns valid VCALENDAR structure', () => {
    const ics = generateICSContent(baseEvent)
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('END:VCALENDAR')
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('END:VEVENT')
  })

  it('includes correct PRODID', () => {
    const ics = generateICSContent(baseEvent)
    expect(ics).toContain('PRODID:-//Coordination Manager//EN')
  })

  it('formats DTSTART and DTEND in UTC', () => {
    const ics = generateICSContent(baseEvent)
    expect(ics).toContain('DTSTART:20260315T100000Z')
    expect(ics).toContain('DTEND:20260315T103000Z')
  })

  it('includes event title as SUMMARY', () => {
    const ics = generateICSContent(baseEvent)
    expect(ics).toContain('SUMMARY:Team Standup')
  })

  it('generates a UID ending with @coordination-manager', () => {
    const ics = generateICSContent(baseEvent)
    expect(ics).toMatch(/UID:[a-z0-9]+@coordination-manager/)
  })

  it('includes DESCRIPTION when provided', () => {
    const event = { ...baseEvent, description: 'Daily sync meeting' }
    const ics = generateICSContent(event)
    expect(ics).toContain('DESCRIPTION:Daily sync meeting')
  })

  it('includes meeting_link in DESCRIPTION and URL', () => {
    const event = { ...baseEvent, meeting_link: 'https://zoom.us/j/123' }
    const ics = generateICSContent(event)
    expect(ics).toContain('Meeting link: https://zoom.us/j/123')
    expect(ics).toContain('URL:https://zoom.us/j/123')
  })

  it('uses location when provided', () => {
    const event = { ...baseEvent, location: 'Room 42' }
    const ics = generateICSContent(event)
    expect(ics).toContain('LOCATION:Room 42')
  })

  it('falls back to meeting_link as LOCATION when no location', () => {
    const event = { ...baseEvent, meeting_link: 'https://meet.google.com/abc' }
    const ics = generateICSContent(event)
    expect(ics).toContain('LOCATION:https://meet.google.com/abc')
  })

  it('escapes special iCal characters in text', () => {
    const event = { ...baseEvent, title: 'Meeting; with, special\\chars\nnewline' }
    const ics = generateICSContent(event)
    expect(ics).toContain('SUMMARY:Meeting\\; with\\, special\\\\chars\\nnewline')
  })

  it('includes Outlook-compatible properties', () => {
    const ics = generateICSContent(baseEvent)
    expect(ics).toContain('TRANSP:OPAQUE')
    expect(ics).toContain('STATUS:CONFIRMED')
    expect(ics).toContain('X-MICROSOFT-CDO-BUSYSTATUS:BUSY')
  })

  it('uses CRLF line endings', () => {
    const ics = generateICSContent(baseEvent)
    // The content is joined with \r\n
    expect(ics).toContain('\r\n')
  })

  it('folds long lines (>75 chars)', () => {
    const event = {
      ...baseEvent,
      description: 'A'.repeat(200),
    }
    const ics = generateICSContent(event)
    // Folded lines start with a space on continuation
    const lines = ics.split('\r\n')
    const foldedLines = lines.filter(l => l.startsWith(' '))
    expect(foldedLines.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// buildOutlookCalendarUrl
// ---------------------------------------------------------------------------

describe('buildOutlookCalendarUrl', () => {
  const baseEvent = {
    title: 'Sprint Planning',
    start_time: '2026-03-15T14:00:00Z',
    end_time: '2026-03-15T15:00:00Z',
  }

  it('returns an outlook.live.com URL', () => {
    const url = buildOutlookCalendarUrl(baseEvent)
    expect(url).toContain('https://outlook.live.com/calendar/0/action/compose')
  })

  it('includes subject parameter', () => {
    const url = buildOutlookCalendarUrl(baseEvent)
    expect(url).toContain('subject=Sprint+Planning')
  })

  it('includes startdt and enddt parameters', () => {
    const url = buildOutlookCalendarUrl(baseEvent)
    expect(url).toContain('startdt=')
    expect(url).toContain('enddt=')
  })

  it('sets allday to false', () => {
    const url = buildOutlookCalendarUrl(baseEvent)
    expect(url).toContain('allday=false')
  })

  it('includes description in body parameter', () => {
    const event = { ...baseEvent, description: 'Discuss roadmap' }
    const url = buildOutlookCalendarUrl(event)
    const params = new URL(url).searchParams
    expect(params.get('body')).toContain('Discuss roadmap')
  })

  it('includes meeting_link in body', () => {
    const event = { ...baseEvent, meeting_link: 'https://zoom.us/j/456' }
    const url = buildOutlookCalendarUrl(event)
    const params = new URL(url).searchParams
    expect(params.get('body')).toContain('Meeting link: https://zoom.us/j/456')
  })

  it('includes location parameter', () => {
    const event = { ...baseEvent, location: 'Conference Room B' }
    const url = buildOutlookCalendarUrl(event)
    const params = new URL(url).searchParams
    expect(params.get('location')).toBe('Conference Room B')
  })

  it('falls back to meeting_link as location', () => {
    const event = { ...baseEvent, meeting_link: 'https://meet.google.com/xyz' }
    const url = buildOutlookCalendarUrl(event)
    const params = new URL(url).searchParams
    expect(params.get('location')).toBe('https://meet.google.com/xyz')
  })
})

describe('resolveMeetingTitle', () => {
  it('prefers the custom meeting title when present', () => {
    expect(resolveMeetingTitle({ title: 'Design Review', calendarTitle: 'Weekly Ops' })).toBe('Design Review')
  })

  it('falls back to the coordination calendar name when title is blank', () => {
    expect(resolveMeetingTitle({ title: '   ', calendarTitle: 'Weekly Ops' })).toBe('Weekly Ops')
  })

  it('falls back to the default label when both names are blank', () => {
    expect(resolveMeetingTitle({ title: '', calendarTitle: '', fallbackTitle: 'Meeting' })).toBe('Meeting')
  })
})
