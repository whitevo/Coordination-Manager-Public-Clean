import { afterEach, describe, expect, it, vi } from 'vitest'

const { responseQueue, fromMock } = vi.hoisted(() => {
  const queue: unknown[] = []
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.upsert = vi.fn(() => chain)
  chain.insert = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(() => Promise.resolve(queue.shift()))
  chain.then = (resolve: (value: unknown) => void, reject: (reason: unknown) => void) =>
    Promise.resolve(queue.shift()).then(resolve, reject)
  return { responseQueue: queue, fromMock: vi.fn(() => chain) }
})

vi.mock('../../supabaseClient.js', () => ({
  supabaseAdmin: { from: fromMock },
}))

const { ensureDefaultMailboxAutomationSetup, DEFAULT_PHISHING_TAG_LABEL } = await import('../mailbox-default-rules.js')

afterEach(() => {
  responseQueue.length = 0
  fromMock.mockClear()
})

describe('ensureDefaultMailboxAutomationSetup', () => {
  it('creates the phishing tag and both default rules when neither exists', async () => {
    responseQueue.push({ data: null, error: null }) // mailbox_tags lookup (maybeSingle)
    responseQueue.push({ error: null }) // tag upsert
    responseQueue.push({ data: [], error: null }) // existing rule names
    responseQueue.push({ error: null }) // insert rule 1
    responseQueue.push({ error: null }) // insert rule 2

    const result = await ensureDefaultMailboxAutomationSetup('user-1')

    expect(result.rulesCreated).toEqual([
      'Suspicious language: urgent account verification',
      'AI check: credential request under urgency',
    ])
    expect(typeof result.tagId).toBe('string')
  })

  it('is a no-op when the tag and both rules already exist', async () => {
    responseQueue.push({
      data: { mailbox_tags: [{ id: 'tag-1', label: DEFAULT_PHISHING_TAG_LABEL, color: '#dc2626', sort_order: 0 }] },
      error: null,
    })
    responseQueue.push({
      data: [
        { name: 'Suspicious language: urgent account verification' },
        { name: 'AI check: credential request under urgency' },
      ],
      error: null,
    })

    const result = await ensureDefaultMailboxAutomationSetup('user-1')

    expect(result.tagId).toBe('tag-1')
    expect(result.rulesCreated).toEqual([])
  })
})
