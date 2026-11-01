import { isEventInWindow, type UserEventWindow } from '@/lib/user-event-window'
import type { RecurrenceRule } from '../lib/recurrence'

export interface TimeItemRecurrence {
  id: string
  status: 'active' | 'completed'
  recurrence_rule: RecurrenceRule
  latest_event_id: string | null
  completed_at: string | null
  updated_at: string
}

interface UserEventRecord {
  id: string
  title: string
  description: string | null
  meeting_link: string | null
  location: string | null
  start_time: string
  end_time: string
  is_public?: boolean
  source_type: 'manual' | 'google_oauth' | 'google_public_url' | 'coordination_calendar'
  source_id: string | null
  category_ids?: string[]
  recurrence_rule?: RecurrenceRule | null
  series_id?: string | null
  original_start_time?: string | null
  recurrence_id?: string | null
  recurrence?: TimeItemRecurrence
  completed_at?: string | null
  updated_at?: string
}

function isPendingEventId(eventId: string): boolean {
  return eventId.startsWith('pending-')
}

function mergeFetchedEventsWithLocalState(params: {
  fetchedEvents: UserEventRecord[]
  localEvents: UserEventRecord[]
  preserveEventIds: Set<string>
  // Ids whose local field values must win over a fetched row for the SAME id,
  // regardless of `authoritative` -- a just-completed local write can race a
  // slightly-earlier-issued GET that predates it. This never blocks deletion
  // reconciliation (a fetch missing the id entirely still follows `authoritative`).
  attributePreserveEventIds: Set<string>
  authoritative: boolean
  window?: UserEventWindow
  // pending-* id -> server id for creates whose POST already returned.
  resolvedPendingEventIds?: ReadonlyMap<string, string>
}): UserEventRecord[] {
  const { fetchedEvents, localEvents, preserveEventIds, attributePreserveEventIds, authoritative } = params
  const resolvedPendingEventIds = params.resolvedPendingEventIds ?? new Map<string, string>()
  if (localEvents.length === 0) return fetchedEvents

  const localById = new Map(localEvents.map((event) => [event.id, event]))
  const fetchedIds = new Set(fetchedEvents.map((event) => event.id))
  const resolvedCreateIds = new Set(resolvedPendingEventIds.values())
  // A fetch can already contain a just-inserted row while its create POST is
  // still in flight. Hide that echo so it does not render as a duplicate next to
  // its own optimistic placeholder; the POST response swaps the two.
  const awaitingCreates = localEvents.filter(
    (event) => isPendingEventId(event.id) && !resolvedPendingEventIds.has(event.id)
  )
  const isEchoOfAwaitingCreate = (event: UserEventRecord): boolean => (
    awaitingCreates.length > 0
    && !localById.has(event.id)
    && event.source_type === 'manual'
    && awaitingCreates.some((pending) => (
      pending.title === event.title
      && isSameInstant(pending.start_time, event.start_time)
      && isSameInstant(pending.end_time, event.end_time)
    ))
  )
  const merged = fetchedEvents.filter((event) => !isEchoOfAwaitingCreate(event)).map((event) => {
    if (!preserveEventIds.has(event.id) && !attributePreserveEventIds.has(event.id)) {
      return event
    }

    return localById.get(event.id) || event
  })

  for (const localEvent of localEvents) {
    if (fetchedIds.has(localEvent.id)) continue
    if (isPendingEventId(localEvent.id)) {
      // Once the create has resolved, the pending row is a stale ghost of the
      // real row -- keeping it would show the same item twice.
      if (resolvedPendingEventIds.has(localEvent.id)) continue
      merged.push(localEvent)
      continue
    }
    if (params.window && !isEventInWindow(localEvent, params.window)) {
      merged.push(localEvent)
      continue
    }
    if (preserveEventIds.has(localEvent.id)) {
      merged.push(localEvent)
      continue
    }
    // A fetch issued before a create committed cannot contain the new row yet.
    if (resolvedCreateIds.has(localEvent.id) && attributePreserveEventIds.has(localEvent.id)) {
      merged.push(localEvent)
      continue
    }
    // Only an authoritative fetch (initial load, explicit/forced refresh) may
    // remove a locally-present item. A silent background refetch (window focus,
    // visibility change, cross-tab ping) can carry a response that predates a
    // just-committed write, so it must never delete user-owned manual items that
    // the server simply has not echoed back yet. Server-owned synced events are
    // still reconciled so external deletions propagate.
    if (!authoritative && localEvent.source_type === 'manual') {
      merged.push(localEvent)
    }
  }

  const seriesById = new Map<string, TimeItemRecurrence>()
  for (const event of [...localEvents, ...fetchedEvents]) {
    const series = event.recurrence
    if (!series) continue
    const previous = seriesById.get(series.id)
    if (!previous || (previous.status !== 'completed' && (
      series.status === 'completed' || Date.parse(series.updated_at) >= Date.parse(previous.updated_at)
    ))) seriesById.set(series.id, series)
  }
  return dedupeEventsById(merged).map(event => {
    const recurrence = event.recurrence_id ? seriesById.get(event.recurrence_id) : undefined
    if (!recurrence) return event
    const localCompletion = localById.get(event.id)?.completed_at
    return {
      ...event, recurrence, recurrence_rule: recurrence.recurrence_rule,
      ...(localCompletion ? { completed_at: localCompletion } : {}),
    }
  })
}

function isSameInstant(first: string, second: string): boolean {
  if (first === second) return true
  const firstMs = Date.parse(first)
  const secondMs = Date.parse(second)
  return Number.isFinite(firstMs) && firstMs === secondMs
}

function dedupeEventsById(events: UserEventRecord[]): UserEventRecord[] {
  const seen = new Set<string>()
  let hasDuplicate = false
  const next = events.filter((event) => {
    if (seen.has(event.id)) {
      hasDuplicate = true
      return false
    }
    seen.add(event.id)
    return true
  })
  return hasDuplicate ? next : events
}

// Keeps the previous array (and unchanged event objects) when a refetch returns
// the same data, so a background refresh does not force a full calendar re-render.
function reuseUnchangedEvents(previous: UserEventRecord[], next: UserEventRecord[]): UserEventRecord[] {
  if (previous === next) return previous
  const previousById = new Map(previous.map((event) => [event.id, event]))
  let changed = previous.length !== next.length
  const reused = next.map((event) => {
    const previousEvent = previousById.get(event.id)
    if (!previousEvent) {
      changed = true
      return event
    }
    if (previousEvent === event || JSON.stringify(previousEvent) === JSON.stringify(event)) return previousEvent
    changed = true
    return event
  })
  return changed ? reused : previous
}

export { mergeFetchedEventsWithLocalState, reuseUnchangedEvents, type UserEventRecord }
