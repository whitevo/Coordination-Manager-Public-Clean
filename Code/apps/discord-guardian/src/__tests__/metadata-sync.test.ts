import { beforeEach, describe, expect, it, vi } from 'vitest'
import { syncGuardianChannelMetadata, syncGuardianRoleMetadata } from '../metadata-sync.js'

const mocks = vi.hoisted(() => ({
  from: vi.fn(), range: vi.fn(), upsert: vi.fn(), eq: vi.fn(), order: vi.fn(),
}))
vi.mock('../supabase.js', () => ({
  supabase: {
    from: mocks.from,
  },
}))

const channel = {
  guild_id: 'guild', guild_name: 'Server', channel_id: 'channel', channel_name: 'General',
  channel_type: 0, parent_id: null, synced_at: '2026-10-05T09:00:00Z',
}
const role = {
  guild_id: 'guild', guild_name: 'Server', role_id: 'role', role_name: 'Member',
  role_color: 123, role_position: 1, synced_at: '2026-10-05T09:00:00Z',
}

beforeEach(() => {
  vi.resetAllMocks()
  const chain = { select: vi.fn().mockReturnThis(), eq: mocks.eq, order: mocks.order, range: mocks.range, upsert: mocks.upsert }
  mocks.from.mockReturnValue(chain)
  mocks.eq.mockReturnThis()
  mocks.order.mockReturnThis()
  mocks.range.mockResolvedValue({ data: [], error: null })
  mocks.upsert.mockResolvedValue({ error: null })
})

describe('Guardian metadata reconciliation', () => {
  it('performs zero channel writes for repeated unchanged checks and ignores synced_at', async () => {
    const defaults = vi.fn(() => true)
    for (let check = 0; check < 2; check++) {
      mocks.range.mockResolvedValueOnce({ data: [{ ...channel, is_monitored: false }], error: null })
      expect(await syncGuardianChannelMetadata('guild', [{ ...channel, synced_at: 'new-time' }], defaults)).toBe(0)
    }
    expect(mocks.upsert).not.toHaveBeenCalled()
    expect(defaults).not.toHaveBeenCalled()
    expect(mocks.eq).toHaveBeenCalledWith('guild_id', 'guild')
  })

  it('writes new and changed channels only, preserving existing moderator choices', async () => {
    mocks.range.mockResolvedValueOnce({ data: [channel], error: null })
    const added = { ...channel, channel_id: 'thread', parent_id: 'channel', channel_type: 11 }
    const defaults = vi.fn(() => false)
    expect(await syncGuardianChannelMetadata('guild', [
      { ...channel, channel_name: 'Renamed' }, added,
    ], defaults)).toBe(2)
    expect(defaults).toHaveBeenCalledExactlyOnceWith(added)
    expect(mocks.upsert).toHaveBeenNthCalledWith(1, [
      { ...added, is_monitored: false },
    ], { onConflict: 'guild_id,channel_id', ignoreDuplicates: true })
    expect(mocks.upsert).toHaveBeenNthCalledWith(2, [
      { ...channel, channel_name: 'Renamed' },
    ], { onConflict: 'guild_id,channel_id' })
  })

  it.each([
    { guild_name: 'Renamed server' }, { channel_type: 5 }, { parent_id: 'category' },
  ])('detects channel metadata changes: %o', async change => {
    mocks.range.mockResolvedValueOnce({ data: [channel], error: null })
    expect(await syncGuardianChannelMetadata('guild', [{ ...channel, ...change }], () => true)).toBe(1)
  })

  it('performs zero role writes for unchanged metadata', async () => {
    mocks.range.mockResolvedValueOnce({ data: [role], error: null })
    expect(await syncGuardianRoleMetadata('guild', [{ ...role, synced_at: 'new-time' }])).toBe(0)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it.each([
    { guild_name: 'Renamed server' }, { role_name: 'Renamed role' },
    { role_color: 456 }, { role_position: 2 }, { role_id: 'new-role' },
  ])('writes changed or new roles: %o', async change => {
    mocks.range.mockResolvedValueOnce({ data: [role], error: null })
    expect(await syncGuardianRoleMetadata('guild', [{ ...role, ...change }])).toBe(1)
    expect(mocks.upsert).toHaveBeenCalledWith([{ ...role, ...change }], { onConflict: 'guild_id,role_id' })
  })

  it('reads all metadata pages before deciding what changed', async () => {
    mocks.range.mockResolvedValueOnce({ data: [channel], error: null })
      .mockResolvedValueOnce({ data: [{ ...channel, channel_id: 'later' }], error: null })
    expect(await syncGuardianChannelMetadata('guild', [{ ...channel, channel_id: 'later' }], () => true)).toBe(0)
    expect(mocks.range.mock.calls).toEqual([[0, 999], [1, 1000], [2, 1001]])
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('propagates read failures without performing writes', async () => {
    mocks.range.mockResolvedValueOnce({ data: [channel], error: null })
      .mockResolvedValueOnce({ data: null, error: new Error('read failed') })
    await expect(syncGuardianChannelMetadata('guild', [channel], () => true)).rejects.toThrow('read failed')
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('propagates write failures rather than reporting success', async () => {
    mocks.upsert.mockResolvedValueOnce({ error: new Error('write failed') })
    await expect(syncGuardianRoleMetadata('guild', [role])).rejects.toThrow('write failed')
  })
})
