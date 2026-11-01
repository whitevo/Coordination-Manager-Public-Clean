import { describe, expect, it } from 'vitest'
import { networkFilterKey, resolveNetworkFilterKey, getNetworkOriginalNames, resolveEventNetworkKeys, type EventNetwork, type EventNetworkMapping, type EventNetworkRule } from '../event-network-relations'
import type { PublicEvent } from '../recurrence'

const sourceKey = `source_${'a'.repeat(64)}`
const makeNetwork = (id: string, overrides: Partial<EventNetwork> = {}): EventNetwork => ({
  id, name: id, color: '#3B82F6', description: null, ...overrides,
})
const event: PublicEvent = {
  id: 'event-1', title: 'Weekly meeting', calendar_title: 'Original source',
  start_time: '2026-06-11T12:00:00Z', end_time: '2026-06-11T13:00:00Z',
}
const resolve = (overrides: Partial<Parameters<typeof resolveEventNetworkKeys>[0]> = {}) =>
  resolveEventNetworkKeys({ inputs: [event], networks: [], mappings: [], rules: [], assignments: [], ...overrides })

describe('Events Calendar network memberships', () => {
  it('joins source and canonical identities into one visible destination, including future meetings and parent unions', () => {
    const networks = [
      makeNetwork('A', { source_key: sourceKey, original_name: 'Original A', merged_into: 'B' }),
      makeNetwork('B', { merged_into: 'C' }), makeNetwork('C'),
      makeNetwork('Parent', { member_keys: ['A'] }),
    ]
    for (const id of ['today', 'future']) {
      expect(resolve({ inputs: [{ ...event, id, network_source_key: sourceKey }], networks })).toEqual(new Set(['C', 'Parent']))
    }
    expect(resolveNetworkFilterKey('A', networks)).toBe('C')
    expect(resolveNetworkFilterKey(sourceKey, networks)).toBe('C')
    expect(getNetworkOriginalNames(networks[2], networks)).toEqual(['Original A', 'B'])
  })

  it('preserves mappings and active rules on joined networks but ignores legacy assignments', () => {
    const networks = [makeNetwork('A', { merged_into: 'B' }), makeNetwork('B')]
    expect(resolve({
      networks, mappings: [{ id: 'm', network_id: 'A', source_type: 'meeting_title', source_string: event.title }],
    })).toEqual(new Set(['B', 'cal_Original source']))
    expect(resolve({
      networks, assignments: [{ id: 'a', network_id: 'A', target_type: 'user_event', target_id: event.id }],
    })).toEqual(new Set(['cal_Original source']))
    expect(resolve({ networks, rules: [{
      id: 'r', network_id: 'A', match_field: 'meeting_title', match_type: 'exact', pattern: event.title,
      priority: 1, is_active: true,
    }] })).toEqual(new Set(['B', 'cal_Original source']))
  })

  it('does not reinterpret calendar mappings as meeting-title mappings for MeTTa Coders', () => {
    const inputs = [{ ...event, title: 'MeTTa Coders', calendar_title: 'Other calendar' }]
    const networks = [makeNetwork('SingularityNET')]
    const mapping: EventNetworkMapping = { id: 'm', network_id: 'SingularityNET', source_string: 'MeTTa Coders', source_type: 'calendar_title' }
    expect(resolve({ inputs, networks, mappings: [mapping] })).toEqual(new Set(['cal_Other calendar']))
    expect(resolve({ inputs, networks, mappings: [{ ...mapping, source_type: 'meeting_title' }] })).toEqual(new Set(['SingularityNET', 'cal_Other calendar']))
  })

  it('rejects redirect cycles explicitly and preserves unavailable keys', () => {
    expect(() => resolveNetworkFilterKey('A', [makeNetwork('A', { merged_into: 'B' }), makeNetwork('B', { merged_into: 'A' })])).toThrow('cycle')
    expect(resolveNetworkFilterKey('unavailable', [])).toBe('unavailable')
  })
  it('collects every matching mapping and rule rather than choosing a winner', () => {
    const mappings: EventNetworkMapping[] = ['A', 'B'].map(id => ({ id, network_id: id, source_type: 'calendar_title', source_string: 'Original source' }))
    const rules: EventNetworkRule[] = ['C', 'D'].map(id => ({
      id, network_id: id, match_field: 'meeting_title', match_type: 'contains', pattern: 'weekly', priority: 1, is_active: true,
    }))
    expect(resolve({ networks: ['A', 'B', 'C', 'D'].map(id => makeNetwork(id)), mappings, rules })).toEqual(new Set(['A', 'B', 'C', 'D', 'cal_Original source']))
  })

  it('retains source membership without applying stored direct assignments', () => {
    expect(resolve({
      inputs: [{ ...event, network_source_key: sourceKey }], networks: [makeNetwork('A')],
      assignments: [{ id: 'assignment', network_id: 'A', target_type: 'user_event', target_id: event.id }],
    })).toEqual(new Set([sourceKey]))
  })

  it('uses only the renamed source filter while retaining stable identity', () => {
    const renamed = makeNetwork('database-id', { name: 'Renamed', source_key: sourceKey, original_name: 'Original source' })
    expect(networkFilterKey(renamed)).toBe(sourceKey)
    expect(resolve({ inputs: [{ ...event, network_source_key: sourceKey }], networks: [renamed] })).toEqual(new Set([sourceKey]))
  })

  it('includes nested live unions, deduplicating diamond membership', () => {
    const networks = [
      makeNetwork('A', { source_key: sourceKey }), makeNetwork('B', { member_keys: [sourceKey] }),
      makeNetwork('C', { member_keys: [sourceKey] }), makeNetwork('D', { member_keys: ['B', 'C'] }),
    ]
    expect(resolve({ inputs: [{ ...event, network_source_key: sourceKey }], networks })).toEqual(new Set([sourceKey, 'B', 'C', 'D']))
    expect(resolve({ inputs: [{ ...event, id: 'future-event', network_source_key: sourceKey }], networks })).toEqual(new Set([sourceKey, 'B', 'C', 'D']))
  })

  it('retains automatic source tags alongside mappings across duplicate event sources', () => {
    const mapping: EventNetworkMapping = { id: 'm', network_id: 'A', source_type: 'meeting_title', source_string: event.title }
    expect(resolve({ inputs: [event, { ...event, id: 'other-event' }], networks: [makeNetwork('A')], mappings: [mapping] })).toEqual(new Set(['A', 'cal_Original source']))
    expect(resolve({
      inputs: [{ ...event, network_source_key: sourceKey }, { ...event, network_source_key: 'source_other' }],
      networks: [makeNetwork('Combined', { member_keys: [sourceKey, 'source_other'] })],
    })).toEqual(new Set([sourceKey, 'source_other', 'Combined']))
  })

  it('ignores stored series assignments for expanded recurrence and imported meetings', () => {
    expect(resolve({
      inputs: [{ ...event, id: 'coord_meeting-id__occ__future', moderation_targets: [{ type: 'meeting', id: 'meeting-id' }] }],
      networks: [makeNetwork('A')],
      assignments: [{ id: 'assignment', network_id: 'A', target_type: 'meeting', target_id: 'meeting-id' }],
    })).toEqual(new Set(['cal_Original source']))
  })

  it('preserves legacy unmapped calendar filters and ignores inactive rules', () => {
    expect(resolve({ networks: [makeNetwork('A')], rules: [{
      id: 'r', network_id: 'A', match_field: 'calendar_title', match_type: 'exact',
      pattern: 'Original source', priority: 1, is_active: false,
    }] })).toEqual(new Set(['cal_Original source']))
  })

  it('aggregates same-name source tags with a custom tag before resolving parent unions', () => {
    const networks = [makeNetwork('tag', { name: 'SingularityNET' }), makeNetwork('parent', { member_keys: ['tag'] })]
    const sources = [{ key: sourceKey, name: 'SingularityNET' }]
    expect(resolve({
      inputs: [{ ...event, network_source_key: sourceKey }], networks, sources,
    })).toEqual(new Set(['tag', 'parent']))
    expect(resolveNetworkFilterKey(sourceKey, networks, sources)).toBe('tag')
    expect(resolveNetworkFilterKey('cal_SingularityNET', networks, sources)).toBe('tag')
  })

  it('aggregates identically named automatic sources under a stable key regardless of source order', () => {
    const otherKey = `source_${'b'.repeat(64)}`
    const sources = [{ key: otherKey, name: 'Same tag' }, { key: sourceKey, name: 'Same tag' }]
    expect(resolve({
      inputs: [{ ...event, network_source_key: otherKey }], sources,
    })).toEqual(new Set([sourceKey]))
    expect(resolveNetworkFilterKey(otherKey, [], [...sources].reverse())).toBe(sourceKey)
    expect(resolveNetworkFilterKey('cal_Same tag', [], sources)).toBe(sourceKey)
  })

  it('uses current names only and prioritizes an explicit source rename over same-name automatic grouping', () => {
    const networks = [makeNetwork('renamed', { name: 'New name', original_name: 'Old name', source_key: sourceKey }),
      makeNetwork('old-name-tag', { name: 'Old name' })]
    const sources = [{ key: sourceKey, name: 'Old name' }]
    expect(resolve({ inputs: [{ ...event, network_source_key: sourceKey }], networks, sources })).toEqual(new Set([sourceKey]))
    expect(resolveNetworkFilterKey('cal_Old name', networks, sources)).toBe(sourceKey)
    expect(resolve({ inputs: [{ ...event, calendar_title: 'Old name' }], networks, sources })).toEqual(new Set([sourceKey]))
  })

  it('does not combine different names or broaden exact name matching', () => {
    const networks = [makeNetwork('tag', { name: 'SingularityNET' })]
    const sources = [{ key: sourceKey, name: 'singularitynet' }]
    expect(resolve({ inputs: [{ ...event, network_source_key: sourceKey }], networks, sources })).toEqual(new Set([sourceKey]))
  })

  it('keeps same-name source membership after the custom tag is renamed or joined', () => {
    const sources = [{ key: sourceKey, name: 'SingularityNET' }]
    const renamed = makeNetwork('tag', { name: 'New name', original_name: 'SingularityNET' })
    expect(resolveNetworkFilterKey(sourceKey, [renamed], sources)).toBe('tag')
    expect(resolve({
      inputs: [{ ...event, network_source_key: sourceKey }],
      sources, networks: [renamed],
    })).toEqual(new Set(['tag']))
    expect(resolveNetworkFilterKey(sourceKey, [{ ...renamed, merged_into: 'destination' }, makeNetwork('destination')], sources)).toBe('destination')
  })
})
