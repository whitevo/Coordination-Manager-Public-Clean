import { describe, it, expect } from 'vitest'
import { isCalendarArchived, selectHomePageCalendars } from '../calendar-listing'

const past = '2020-01-01'
const future = '2999-01-01'

describe('calendar-listing', () => {
  it('archives dated calendars whose end date has passed', () => {
    expect(isCalendarArchived({ config: { customEndDate: past } })).toBe(true)
    expect(isCalendarArchived({ config: { customEndDate: future } })).toBe(false)
  })

  it('keeps any-week calendars active until the server archives them', () => {
    expect(isCalendarArchived({ config: { hideDateNumbers: true, customEndDate: past } })).toBe(false)
    expect(
      isCalendarArchived({ config: { hideDateNumbers: true, customEndDate: past }, archived_at: '2026-01-01T00:00:00Z' })
    ).toBe(true)
  })

  it('treats manually archived any-week calendars as archived', () => {
    expect(isCalendarArchived({ config: { hideDateNumbers: true, archived: true } })).toBe(true)
  })

  it('hides archived calendars once 4 or more are active', () => {
    const active = Array.from({ length: 4 }, (_, i) => ({
      id: `a${i}`,
      created_at: `2026-0${i + 1}-01T00:00:00Z`,
      config: { customEndDate: future },
    }))
    const archived = { id: 'z', created_at: '2026-12-01T00:00:00Z', archived_at: '2026-12-15T00:00:00Z' }

    const selected = selectHomePageCalendars([archived, ...active])
    expect(selected.map(c => c.id)).not.toContain('z')
    expect(selected).toHaveLength(4)
  })

  it('fills the list with archived calendars when fewer than 4 are active', () => {
    const active = [{ id: 'a', created_at: '2026-01-01T00:00:00Z', config: { customEndDate: future } }]
    const archived = { id: 'z', created_at: '2026-02-01T00:00:00Z', archived_at: '2026-03-01T00:00:00Z' }

    expect(selectHomePageCalendars([active[0], archived]).map(c => c.id)).toEqual(['a', 'z'])
  })
})
