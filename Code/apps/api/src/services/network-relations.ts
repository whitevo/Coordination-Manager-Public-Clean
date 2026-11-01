import { supabaseAdmin } from '../supabaseClient.js'
import { getNetworkSourceKey } from './network-source-key.js'
import { sanitizeUUID } from '../middleware/validation.js'

export interface NetworkSource {
  key: string
  name: string
  source_type: 'calendar_source' | 'coordination_calendar'
  source_id: string
  owner: string
}

export interface NetworkTarget {
  target_type: 'user_event' | 'meeting'
  target_id: string
  title: string
  owner: string
}

export interface NetworkRecord {
  id: string
  name: string
  color: string
  description: string | null
  original_name: string
  source_key: string | null
  source_type: NetworkSource['source_type'] | null
  source_id: string | null
  member_keys: string[]
  created_by: string | null
  merged_into?: string | null
}

// Read the row server-side during the rolling 038 -> 039 upgrade. Responses
// must pass through the explicit public projection in network-relations.ts.
export const NETWORK_FIELDS = '*'
export const NETWORK_MANAGEMENT_FIELDS = '*'

// Inventory is limited to published events and public calendars; private source
// identities and owners are used for authorization, never returned publicly.
export async function loadPublicNetworkInventory(): Promise<{ sources: NetworkSource[]; targets: NetworkTarget[] }> {
  const [eventsResult, calendarsResult, suspensionResult] = await Promise.all([
    supabaseAdmin.from('user_events')
      .select('id, user_id, title, source_type, source_id, external_event_id')
      .eq('is_public', true),
    supabaseAdmin.from('calendars').select('id, hash, title, created_by').eq('visibility', 'public'),
    supabaseAdmin.from('public_event_moderation_state').select('target_type, target_id').eq('is_suspended', true),
  ])
  for (const result of [eventsResult, calendarsResult, suspensionResult]) {
    if (result.error) throw result.error
  }
  const suspended = new Set((suspensionResult.data || []).map(row => `${row.target_type}:${row.target_id}`))
  const events = (eventsResult.data || []).filter(event =>
    !suspended.has(`user_event:${event.id}`)
    && !(event.external_event_id && suspended.has(`meeting:${event.external_event_id}`)),
  )
  const calendars = calendarsResult.data || []
  const googleIds = [...new Set(events
    .filter(event => event.source_type === 'google_oauth' || event.source_type === 'google_public_url')
    .map(event => event.source_id).filter((id): id is string => Boolean(sanitizeUUID(id))))]
  const coordHashes = [...new Set(events.filter(event => event.source_type === 'coordination_calendar')
    .map(event => event.source_id).filter((id): id is string => typeof id === 'string' && id.length > 0))]

  const [sourcesResult, importedCalendarsResult, meetingsResult] = await Promise.all([
    googleIds.length ? supabaseAdmin.from('calendar_sources').select('id, display_name, user_id').in('id', googleIds)
      : { data: [], error: null },
    coordHashes.length ? supabaseAdmin.from('calendars').select('id, hash, title, created_by').in('hash', coordHashes)
      : { data: [], error: null },
    calendars.length ? supabaseAdmin.from('meetings').select('id, calendar_id, title').in('calendar_id', calendars.map(cal => cal.id))
      : { data: [], error: null },
  ])
  for (const result of [sourcesResult, importedCalendarsResult, meetingsResult]) {
    if (result.error) throw result.error
  }
  const sources = new Map<string, NetworkSource>()
  for (const source of sourcesResult.data || []) {
    const key = getNetworkSourceKey('google_oauth', source.id)!
    sources.set(key, { key, name: source.display_name, source_type: 'calendar_source', source_id: source.id, owner: source.user_id })
  }
  for (const cal of [...calendars, ...(importedCalendarsResult.data || [])]) {
    const key = getNetworkSourceKey('coordination_calendar', cal.hash)!
    sources.set(key, { key, name: cal.title, source_type: 'coordination_calendar', source_id: cal.hash, owner: cal.created_by })
  }
  const calendarMap = new Map(calendars.map(cal => [cal.id, cal]))
  const targets: NetworkTarget[] = events.map(event => ({
    target_type: 'user_event', target_id: event.id, title: event.title, owner: event.user_id,
  }))
  for (const meeting of meetingsResult.data || []) {
    if (suspended.has(`meeting:${meeting.id}`)) continue
    const cal = calendarMap.get(meeting.calendar_id)
    if (cal) targets.push({ target_type: 'meeting', target_id: meeting.id, title: meeting.title || cal.title, owner: cal.created_by })
  }
  return { sources: [...sources.values()], targets }
}

export async function getNetworkSourceOwner(network: NetworkRecord): Promise<string | null> {
  if (!network.source_type || !network.source_id) return null
  const isCalendar = network.source_type === 'coordination_calendar'
  const { data, error } = await supabaseAdmin
    .from(isCalendar ? 'calendars' : 'calendar_sources')
    .select(isCalendar ? 'created_by' : 'user_id')
    .eq(isCalendar ? 'hash' : 'id', network.source_id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return 'created_by' in data ? data.created_by : data.user_id
}
