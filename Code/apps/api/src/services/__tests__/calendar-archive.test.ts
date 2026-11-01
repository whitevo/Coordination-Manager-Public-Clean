import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = vi.hoisted(() => ({
  calendarRows: [] as unknown[],
  updates: [] as Array<{ id: unknown; payload: unknown }>,
}))

vi.mock('../../supabaseClient.js', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'calendars') {
        return {
          select: () => ({ eq: async () => ({ data: mockDb.calendarRows, error: null }) }),
          update: (payload: unknown) => ({
            eq: async (_column: string, id: unknown) => {
              mockDb.updates.push({ id, payload })
              return { error: null }
            },
          }),
        }
      }
      return { select: () => ({ in: async () => ({ data: [], error: null }) }) }
    },
  },
}))

const {
  computeListingExpiry,
  isAnyWeekCalendar,
  isManuallyArchived,
  sweepPublicCalendarArchiveState,
  LISTING_GRACE_DAYS,
} = await import('../calendar-archive.js')

const DAY_MS = 24 * 60 * 60 * 1000
const CREATED = '2026-01-01T00:00:00Z'

describe('calendar-archive', () => {
  it('detects any-week calendars', () => {
    expect(isAnyWeekCalendar({ hideDateNumbers: true })).toBe(true)
    expect(isAnyWeekCalendar({ customEndDate: '2026-01-10' })).toBe(false)
    expect(isAnyWeekCalendar(null)).toBe(false)
  })

  it('keeps a calendar listed for the grace period after creation', () => {
    const expiry = computeListingExpiry({ id: 'a', created_at: CREATED }, [])
    expect(expiry?.getTime()).toBe(new Date(CREATED).getTime() + LISTING_GRACE_DAYS * DAY_MS)
  })

  it('extends the window past the last planned meeting', () => {
    const expiry = computeListingExpiry({ id: 'a', created_at: CREATED }, [
      { calendar_id: 'a', start_time: '2026-02-01 10:00:00', end_time: '2026-02-01 11:00:00' },
      { calendar_id: 'a', start_time: '2026-03-01 10:00:00', end_time: '2026-03-01 11:00:00' },
    ])
    expect(expiry?.toISOString()).toBe(
      new Date(new Date('2026-03-01T11:00:00Z').getTime() + LISTING_GRACE_DAYS * DAY_MS).toISOString()
    )
  })

  it('never expires when a meeting recurs without an end', () => {
    const expiry = computeListingExpiry({ id: 'a', created_at: CREATED }, [
      { calendar_id: 'a', start_time: '2026-01-05 10:00:00', recurrence_rule: { type: 'weekly', endType: 'never' } },
    ])
    expect(expiry).toBeNull()
  })

  it('uses the recurrence end date when the series stops', () => {
    const expiry = computeListingExpiry({ id: 'a', created_at: CREATED }, [
      {
        calendar_id: 'a',
        start_time: '2026-01-05 10:00:00',
        recurrence_rule: { type: 'weekly', endType: 'on', endDate: '2026-04-01' },
      },
    ])
    expect(expiry?.toISOString().slice(0, 10)).toBe('2026-04-15')
  })

  describe('manual archive', () => {
    beforeEach(() => {
      mockDb.calendarRows = []
      mockDb.updates = []
    })

    it('detects manually archived calendars', () => {
      expect(isManuallyArchived({ hideDateNumbers: true, archived: true })).toBe(true)
      expect(isManuallyArchived({ hideDateNumbers: true })).toBe(false)
      expect(isManuallyArchived(null)).toBe(false)
    })

    it('keeps a manually archived calendar archived even inside the listing window', async () => {
      const createdAt = new Date().toISOString()
      const expiry = new Date(new Date(createdAt).getTime() + LISTING_GRACE_DAYS * DAY_MS).toISOString()
      mockDb.calendarRows = [
        {
          id: 'manual',
          config: { hideDateNumbers: true, archived: true },
          created_at: createdAt,
          archived_at: '2026-01-02T00:00:00.000Z',
          listing_expires_at: expiry,
        },
        {
          id: 'auto',
          config: { hideDateNumbers: true },
          created_at: createdAt,
          archived_at: '2026-01-02T00:00:00.000Z',
          listing_expires_at: expiry,
        },
      ]

      const result = await sweepPublicCalendarArchiveState()

      expect(result).toEqual({ archived: 0, unarchived: 1 })
      expect(mockDb.updates).toEqual([
        { id: 'auto', payload: { archived_at: null, listing_expires_at: expiry } },
      ])
    })

    it('archives a manually archived calendar that has no archived_at yet', async () => {
      const createdAt = new Date().toISOString()
      mockDb.calendarRows = [
        { id: 'manual', config: { hideDateNumbers: true, archived: true }, created_at: createdAt, archived_at: null },
      ]

      const result = await sweepPublicCalendarArchiveState()

      expect(result).toEqual({ archived: 1, unarchived: 0 })
      expect(mockDb.updates).toHaveLength(1)
      expect((mockDb.updates[0].payload as { archived_at: unknown }).archived_at).toEqual(expect.any(String))
    })
  })
})
