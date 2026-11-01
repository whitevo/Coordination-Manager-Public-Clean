import type { PublicEvent } from './recurrence'

export interface EventNetwork {
  id: string
  name: string
  color: string
  description: string | null
  original_name?: string
  source_key?: string | null
  member_keys?: string[]
  merged_into?: string | null
}

export interface EventNetworkMapping {
  id: string
  network_id: string
  source_string: string
  source_type: 'calendar_title' | 'meeting_title' | 'description'
}

export interface EventNetworkRule {
  id: string
  network_id: string
  pattern: string
  match_type: 'contains' | 'starts_with' | 'exact' | 'regex'
  match_field: 'calendar_title' | 'meeting_title' | 'description'
  priority: number
  is_active: boolean
}

export interface EventNetworkAssignment {
  id: string
  network_id: string
  target_type: 'user_event' | 'meeting'
  target_id: string
}

export interface EventNetworkSource {
  key: string
  name: string
}

export interface EventNetworkCatalog {
  networks: EventNetwork[]
  mappings: EventNetworkMapping[]
  rules: EventNetworkRule[]
  assignments: EventNetworkAssignment[]
  sources: EventNetworkSource[]
}

export function networkFilterKey(network: EventNetwork): string {
  return network.source_key || network.id
}

export function resolveNetworkFilterKey(key: string, networks: EventNetwork[], sources: EventNetworkSource[] = []): string {
  const visited = new Set<string>()
  let current = key
  while (!visited.has(current)) {
    visited.add(current)
    const network = networks.find(candidate => candidate.id === current || candidate.source_key === current)
    if (!network) {
      const name = sources.find(source => source.key === current)?.name
        || (current.startsWith('cal_') ? current.slice(4) : null)
      if (!name) return current
      if (current.startsWith('cal_')) {
        const renamedSource = sources.find(source => source.name === name
          && networks.some(candidate => candidate.source_key === source.key))
        if (renamedSource) {
          current = renamedSource.key
          continue
        }
      }
      const tag = networks.find(candidate => !candidate.merged_into && candidate.name === name)
        || networks.find(candidate => candidate.name === name)
        || networks.find(candidate => candidate.original_name === name)
      if (tag) {
        current = networkFilterKey(tag)
        continue
      }
      // Unconfigured sources with the same name are one automatic tag.
      return sources.filter(source => source.name === name && !networks.some(candidate => candidate.source_key === source.key))
        .map(source => source.key).sort()[0] || current
    }
    if (!network.merged_into) return networkFilterKey(network)
    current = network.merged_into
  }
  throw new Error('Network redirects contain a cycle')
}

export function getNetworkOriginalNames(network: EventNetwork, networks: EventNetwork[]): string[] {
  const key = networkFilterKey(network)
  return [...new Set(networks
    .filter(candidate => resolveNetworkFilterKey(networkFilterKey(candidate), networks) === key)
    .map(candidate => candidate.original_name || candidate.name)
    .filter(name => name !== network.name))]
}

export function resolveEventNetworkKeys({
  inputs, networks, mappings, rules, sources = [],
}: {
  inputs: PublicEvent[]
  networks: EventNetwork[]
  mappings: EventNetworkMapping[]
  rules: EventNetworkRule[]
  /** Retained for caller compatibility; direct assignments no longer tag events. */
  assignments?: EventNetworkAssignment[]
  sources?: EventNetworkSource[]
}): Set<string> {
  const aliases = new Map(networks.map(network => [network.id, networkFilterKey(network)]))
  const matched = new Set<string>()
  for (const event of inputs) {
    const inputMatches = new Set<string>()
    const addNetwork = (id: string) => {
      const key = aliases.get(id)
      if (key) inputMatches.add(key)
    }
    if (event.network_source_key) inputMatches.add(event.network_source_key)
    for (const mapping of mappings) {
      const field = mapping.source_type === 'meeting_title' ? event.title : event[mapping.source_type]
      if (field === mapping.source_string) addNetwork(mapping.network_id)
    }
    for (const rule of rules) {
      if (!rule.is_active) continue
      const field = (rule.match_field === 'meeting_title' ? event.title : event[rule.match_field]) || ''
      if (!field) continue
      const lower = field.toLowerCase()
      const pattern = rule.pattern.toLowerCase()
      const matches = rule.match_type === 'exact' ? lower === pattern
        : rule.match_type === 'contains' ? lower.includes(pattern)
        : rule.match_type === 'starts_with' ? lower.startsWith(pattern)
        : new RegExp(rule.pattern, 'i').test(field)
      if (matches) addNetwork(rule.network_id)
    }
    if (!event.network_source_key && event.calendar_title) {
      inputMatches.add(`cal_${event.calendar_title}`)
    }
    for (const key of inputMatches) matched.add(key)
  }
  // A live union includes all descendants. Fixed-point resolution also handles
  // diamonds and overlapping memberships without duplicating calendar events.
  let changed = true
  while (changed) {
    changed = false
    for (const key of matched) {
      const resolved = resolveNetworkFilterKey(key, networks, sources)
      if (!matched.has(resolved)) {
        matched.add(resolved)
        changed = true
      }
    }
    for (const network of networks) {
      const key = networkFilterKey(network)
      if (network.merged_into && matched.has(key)) {
        const destination = aliases.get(network.merged_into)
        if (destination && !matched.has(destination)) {
          matched.add(destination)
          changed = true
        }
      }
      if (!matched.has(key) && network.member_keys?.some(member => matched.has(aliases.get(member) || member))) {
        matched.add(key)
        changed = true
      }
    }
  }
  return new Set([...matched].map(key => resolveNetworkFilterKey(key, networks, sources)))
}
