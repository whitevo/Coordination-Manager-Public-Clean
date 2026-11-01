import { describe, it, expect, vi } from 'vitest'
import { deleteMessages, parseDeleteRequest, MAX_DELETE_ITEMS } from '../delete-flow.js'
import type { DeleteDeps, DeleteItem } from '../delete-flow.js'

const CHANNEL_ID = '123456789012345678'
const USER_ID = '223456789012345678'

function item(overrides: Partial<DeleteItem> = {}): DeleteItem {
  return {
    id: 'log-1',
    channelType: 'discord_channel',
    targetId: CHANNEL_ID,
    messageId: '323456789012345678',
    ...overrides,
  }
}

function discordError(code: number, message: string): Error & { code: number } {
  return Object.assign(new Error(message), { code })
}

function makeDeps(overrides: Partial<DeleteDeps> = {}): DeleteDeps {
  return {
    deleteChannelMessage: vi.fn().mockResolvedValue(undefined),
    deleteDmMessage: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('parseDeleteRequest', () => {
  it('accepts a valid body', () => {
    const result = parseDeleteRequest({ items: [item(), item({ id: 'log-2', channelType: 'discord_dm', targetId: USER_ID })] })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.items).toHaveLength(2)
  })

  it('rejects a missing items array', () => {
    expect(parseDeleteRequest({}).ok).toBe(false)
    expect(parseDeleteRequest(null).ok).toBe(false)
  })

  it('rejects an empty items array', () => {
    expect(parseDeleteRequest({ items: [] }).ok).toBe(false)
  })

  it('rejects more than the max item count', () => {
    const items = Array.from({ length: MAX_DELETE_ITEMS + 1 }, (_, i) => item({ id: `log-${i}` }))
    const result = parseDeleteRequest({ items })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain(String(MAX_DELETE_ITEMS))
  })

  it('rejects an unsupported channel type', () => {
    expect(parseDeleteRequest({ items: [{ ...item(), channelType: 'email' }] }).ok).toBe(false)
  })

  it('rejects non-snowflake target and message ids', () => {
    expect(parseDeleteRequest({ items: [item({ targetId: 'abc' })] }).ok).toBe(false)
    expect(parseDeleteRequest({ items: [item({ messageId: '12' })] }).ok).toBe(false)
  })

  it('strips unknown fields', () => {
    const result = parseDeleteRequest({ items: [{ ...item(), extra: 'x' }] })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.items[0]).toEqual(item())
  })
})

describe('deleteMessages', () => {
  it('deletes channel posts and DMs through the matching dep', async () => {
    const deps = makeDeps()
    const results = await deleteMessages(deps, [
      item(),
      item({ id: 'log-2', channelType: 'discord_dm', targetId: USER_ID, messageId: '423456789012345678' }),
    ])

    expect(results).toEqual([{ id: 'log-1', ok: true }, { id: 'log-2', ok: true }])
    expect(deps.deleteChannelMessage).toHaveBeenCalledWith(CHANNEL_ID, '323456789012345678')
    expect(deps.deleteDmMessage).toHaveBeenCalledWith(USER_ID, '423456789012345678')
  })

  it('treats Unknown Message (10008) and Unknown Channel (10003) as already deleted', async () => {
    const deps = makeDeps({
      deleteChannelMessage: vi.fn()
        .mockRejectedValueOnce(discordError(10008, 'Unknown Message'))
        .mockRejectedValueOnce(discordError(10003, 'Unknown Channel')),
    })
    const results = await deleteMessages(deps, [item(), item({ id: 'log-2' })])
    expect(results).toEqual([{ id: 'log-1', ok: true }, { id: 'log-2', ok: true }])
  })

  it('reports other errors as failures without stopping the batch', async () => {
    const deps = makeDeps({
      deleteChannelMessage: vi.fn()
        .mockRejectedValueOnce(discordError(50001, 'Missing Access\nline two'))
        .mockResolvedValueOnce(undefined),
    })
    const results = await deleteMessages(deps, [item(), item({ id: 'log-2' })], 1)
    expect(results[0]).toEqual({ id: 'log-1', ok: false, error: 'Missing Access line two' })
    expect(results[1]).toEqual({ id: 'log-2', ok: true })
  })

  it('caps in-flight deletions at the concurrency limit and keeps input order', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const deps = makeDeps({
      deleteChannelMessage: vi.fn(async () => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise(resolve => setTimeout(resolve, 2))
        inFlight--
      }),
    })
    const items = Array.from({ length: 12 }, (_, i) => item({ id: `log-${i}` }))
    const results = await deleteMessages(deps, items, 3)

    expect(maxInFlight).toBe(3)
    expect(results.map(r => r.id)).toEqual(items.map(i => i.id))
    expect(results.every(r => r.ok)).toBe(true)
  })
})
