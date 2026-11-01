import { describe, expect, it } from 'vitest'
import { mergeFetchedEventsWithLocalState, reuseUnchangedEvents, type UserEventRecord } from '../time-management-event-reconciliation'

const row = (id: string, start: string, overrides: Partial<UserEventRecord> = {}): UserEventRecord => ({
  id, title: id, start_time: `${start}T09:00:00Z`, end_time: `${start}T10:00:00Z`,
  description: null, meeting_link: null, location: null, source_type: 'manual', source_id: 'mode', ...overrides,
})
const window = { windowStart: '2026-10-05T00:00:00Z', windowEnd: '2026-10-12T00:00:00Z' }
const merge = (localEvents: UserEventRecord[], fetchedEvents: UserEventRecord[], extra = {}) => mergeFetchedEventsWithLocalState({
  localEvents, fetchedEvents, window, authoritative: true,
  preserveEventIds: new Set<string>(), attributePreserveEventIds: new Set<string>(), ...extra,
})

describe('window-scoped reconciliation', () => {
  it('keeps completion shared and irreversible when an older refresh arrives', () => {
    const recurrence = {
      id: 'series', status: 'completed' as const, latest_event_id: 'latest',
      recurrence_rule: { type: 'weekly' as const, endType: 'whenCompleted' as const },
      completed_at: '2026-10-10T10:00:00Z', updated_at: '2026-10-10T10:00:00Z',
    }
    const historical = row('historical', '2026-10-05', { recurrence_id: 'series', recurrence, completed_at: null })
    const latest = row('latest', '2026-10-06', { recurrence_id: 'series', recurrence, completed_at: recurrence.completed_at })
    const stale = { ...recurrence, status: 'active' as const, completed_at: null, updated_at: '2026-10-09T10:00:00Z' }
    const next = merge([historical, latest], [
      { ...historical, recurrence: stale },
      { ...latest, recurrence: stale, completed_at: null },
    ])
    expect(next).toHaveLength(2)
    expect(next.every(event => event.recurrence?.status === 'completed')).toBe(true)
    expect(next.every(event => event.recurrence_rule?.endType === 'whenCompleted')).toBe(true)
    expect(next.find(event => event.id === 'historical')?.completed_at).toBeNull()
    expect(next.find(event => event.id === 'latest')?.completed_at).toBe(recurrence.completed_at)
  })
  it('reconciles deletions inside the observed window without removing other weeks', () => {
    const outside = row('outside', '2026-10-19')
    expect(merge([row('inside', '2026-10-06'), outside], [])).toEqual([outside])
  })
  it('preserves pending, unsynced and protected field edits in the observed window', () => {
    const local = row('edit', '2026-10-06', { title: 'Local edit' })
    const pending = row('pending-create', '2026-10-07')
    expect(merge([local, pending], [row('edit', '2026-10-06')], {
      preserveEventIds: new Set(['edit']),
    })).toEqual([local, pending])
  })
  it('drops resolved optimistic ghosts even when they belong to another week', () => {
    expect(merge([row('pending-create', '2026-11-01')], [], {
      resolvedPendingEventIds: new Map([['pending-create', 'server-id']]),
    })).toEqual([])
  })
  it('treats old recurrence masters as part of the requested observation', () => {
    expect(merge([row('series', '2021-01-04', { recurrence_rule: { type: 'weekly' } })], [])).toEqual([])
  })
  it('does not duplicate an optimistic create when its server echo arrives first', () => {
    const pending = row('pending-create', '2026-10-06', { title: 'New item' })
    const echo = { ...pending, id: 'server-id' }
    expect(merge([pending], [echo])).toEqual([pending])
  })
})

describe('reuseUnchangedEvents', () => {
  it('keeps the previous array when a refetch returns identical rows in any order', () => {
    const previous = [row('a', '2026-10-05'), row('b', '2026-10-06')]
    const refetched = [row('b', '2026-10-06'), row('a', '2026-10-05')]
    expect(reuseUnchangedEvents(previous, refetched)).toBe(previous)
  })

  it('returns new rows but reuses unchanged objects when something changed', () => {
    const previous = [row('a', '2026-10-05'), row('b', '2026-10-06')]
    const changed = row('b', '2026-10-06', { title: 'renamed' })
    const next = reuseUnchangedEvents(previous, [row('a', '2026-10-05'), changed])
    expect(next).not.toBe(previous)
    expect(next[0]).toBe(previous[0])
    expect(next[1]).toBe(changed)
    expect(reuseUnchangedEvents(previous, [previous[0]])).toEqual([previous[0]])
  })
})
