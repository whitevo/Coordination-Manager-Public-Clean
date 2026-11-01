import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadPublicNetworkInventory, getNetworkSourceOwner, type NetworkRecord } from '../network-relations.js'
import { getNetworkSourceKey } from '../network-source-key.js'

const { from, results, queries } = vi.hoisted(() => ({
  from: vi.fn(),
  results: new Map<string, { data: unknown[] | null; error: unknown }>(),
  queries: [] as Array<{ table: string; method: string; args: unknown[] }>,
}))
vi.mock('../../supabaseClient.js', () => ({
  supabaseAdmin: { from: (...args: unknown[]) => from(...args) },
}))

beforeEach(() => {
  vi.clearAllMocks()
  results.clear()
  queries.length = 0
  from.mockImplementation((table: string) => {
    const result = () => results.get(table) || { data: [], error: null }
    const chain = {
      select: (...args: unknown[]) => { queries.push({ table, method: 'select', args }); return chain },
      eq: (...args: unknown[]) => { queries.push({ table, method: 'eq', args }); return chain },
      in: (...args: unknown[]) => { queries.push({ table, method: 'in', args }); return chain },
      maybeSingle: async () => ({ ...result(), data: result().data?.[0] || null }),
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => resolve(result()),
    }
    return chain
  })
})

describe('Public network source inventory and verified ownership', () => {
  it('derives the same opaque identity for both Google source types without exposing their private id', () => {
    const key = getNetworkSourceKey('google_oauth', 'private-source-id')
    expect(key).toMatch(/^source_[0-9a-f]{64}$/)
    expect(key).toBe(getNetworkSourceKey('google_public_url', 'private-source-id'))
    expect(key).not.toContain('private-source-id')
    expect(getNetworkSourceKey('manual', 'private-mode')).toBeUndefined()
    expect(getNetworkSourceKey('coordination_calendar', 'hash')).not.toBe(key)
  })

  it('collects public sources and targets, excluding suspended events and their imported meetings', async () => {
    const sourceId = '550e8400-e29b-41d4-a716-446655440000'
    results.set('user_events', { data: [
      { id: 'published', title: 'Published', user_id: 'owner', source_type: 'google_oauth', source_id: sourceId },
      { id: 'suspended', title: 'Hidden', user_id: 'owner', source_type: 'google_oauth', source_id: sourceId },
      { id: 'imported-hidden', title: 'Imported hidden', user_id: 'owner', source_type: 'coordination_calendar', source_id: 'hash', external_event_id: 'hidden-meeting' },
    ], error: null })
    results.set('calendars', { data: [{ id: 'calendar-id', hash: 'hash', title: 'Public calendar', created_by: 'calendar-owner' }], error: null })
    results.set('calendar_sources', { data: [{ id: sourceId, display_name: 'Google calendar', user_id: 'owner' }], error: null })
    results.set('meetings', { data: [{ id: 'visible-meeting', title: 'Visible', calendar_id: 'calendar-id' }, { id: 'hidden-meeting', title: 'Hidden', calendar_id: 'calendar-id' }], error: null })
    results.set('public_event_moderation_state', { data: [
      { target_type: 'user_event', target_id: 'suspended' }, { target_type: 'meeting', target_id: 'hidden-meeting' },
    ], error: null })
    const inventory = await loadPublicNetworkInventory()
    expect(inventory.targets.map(target => target.target_id)).toEqual(['published', 'visible-meeting'])
    expect(inventory.sources).toHaveLength(2)
    expect(inventory.sources.find(source => source.source_type === 'calendar_source')).toMatchObject({ owner: 'owner', name: 'Google calendar' })
    expect(queries).toContainEqual({ table: 'user_events', method: 'eq', args: ['is_public', true] })
    expect(queries).toContainEqual({ table: 'calendars', method: 'eq', args: ['visibility', 'public'] })
  })

  it('surfaces source and publication query failures instead of returning an empty success', async () => {
    results.set('user_events', { data: null, error: { message: 'Database unavailable' } })
    await expect(loadPublicNetworkInventory()).rejects.toEqual({ message: 'Database unavailable' })
  })

  it.each(['calendar_source', 'coordination_calendar'] as const)('checks the underlying %s owner rather than display-name strings', async sourceType => {
    const network: NetworkRecord = {
      id: 'network-id', name: 'Name', original_name: 'Original', color: '#3B82F6', description: null,
      source_key: 'source-key', source_type: sourceType, source_id: 'private-source', created_by: 'creator', member_keys: [],
    }
    results.set(sourceType === 'calendar_source' ? 'calendar_sources' : 'calendars', {
      data: [sourceType === 'calendar_source' ? { user_id: 'verified-owner' } : { created_by: 'verified-owner' }], error: null,
    })
    expect(await getNetworkSourceOwner(network)).toBe('verified-owner')
    expect(queries).toContainEqual({
      table: sourceType === 'calendar_source' ? 'calendar_sources' : 'calendars',
      method: 'eq', args: [sourceType === 'calendar_source' ? 'id' : 'hash', 'private-source'],
    })
  })
})
