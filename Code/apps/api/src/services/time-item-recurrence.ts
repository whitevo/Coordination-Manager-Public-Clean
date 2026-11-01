import { supabaseAdmin } from '../supabaseClient.js'

export interface TimeItemRecurrence {
  id: string
  status: 'active' | 'completed'
  recurrence_rule: unknown
  latest_event_id: string | null
  completed_at: string | null
  updated_at: string
}

export async function withTimeItemRecurrences<T extends { recurrence_id?: unknown }>(events: T[], userId: string) {
  const ids = [...new Set(events.flatMap(event => typeof event.recurrence_id === 'string' ? [event.recurrence_id] : []))]
  if (ids.length === 0) return events
  const seriesById = new Map<string, TimeItemRecurrence>()
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await supabaseAdmin.from('time_item_recurrences')
      .select('id, status, recurrence_rule, latest_event_id, completed_at, updated_at')
      .eq('user_id', userId).in('id', ids.slice(offset, offset + 100))
    if (error) throw error
    for (const series of (data || []) as TimeItemRecurrence[]) seriesById.set(series.id, series)
  }
  return events.map(event => {
    if (typeof event.recurrence_id !== 'string') return event
    const recurrence = seriesById.get(event.recurrence_id)
    if (!recurrence) throw new Error('Time Item recurrence state is unavailable')
    return { ...event, recurrence_rule: recurrence.recurrence_rule, recurrence }
  })
}
