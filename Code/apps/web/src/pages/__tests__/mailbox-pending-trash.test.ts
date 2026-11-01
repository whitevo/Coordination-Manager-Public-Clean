import { describe, expect, it } from 'vitest'
import { createPendingTrashOverlay } from '../mailbox-pending-trash'

const row = (id: string, trashed: boolean) => ({ id, is_provider_trashed: trashed })

describe('createPendingTrashOverlay', () => {
  it('keeps optimistic trash while the server still reports the old flag', () => {
    const overlay = createPendingTrashOverlay()
    overlay.register(['a', 'b'], true)

    const seq = overlay.beginRead()
    const result = overlay.apply([row('a', false), row('b', false), row('c', false)], seq)
    overlay.completeRead(seq)

    expect(result).toEqual([row('a', true), row('b', true), row('c', false)])
    expect(overlay.has('a')).toBe(true)
  })

  it('still overrides reads that started before the mutation settled', () => {
    const overlay = createPendingTrashOverlay()
    overlay.register(['a'], true)
    const staleSeq = overlay.beginRead()
    overlay.settle(['a'])

    const result = overlay.apply([row('a', false)], staleSeq)
    overlay.completeRead(staleSeq)

    expect(result).toEqual([row('a', true)])
    expect(overlay.has('a')).toBe(true)
  })

  it('trusts and prunes after a read that started post-settle completes', () => {
    const overlay = createPendingTrashOverlay()
    overlay.register(['a'], true)
    overlay.settle(['a'])

    const freshSeq = overlay.beginRead()
    const result = overlay.apply([row('a', false)], freshSeq)
    overlay.completeRead(freshSeq)

    expect(result).toEqual([row('a', false)])
    expect(overlay.has('a')).toBe(false)
  })

  it('drops discarded ids immediately so a rollback is not overridden', () => {
    const overlay = createPendingTrashOverlay()
    overlay.register(['a'], true)
    overlay.discard(['a'])

    const seq = overlay.beginRead()
    expect(overlay.apply([row('a', false)], seq)).toEqual([row('a', false)])
    expect(overlay.has('a')).toBe(false)
  })

  it('pins restored ids to untrashed against reads that began before the restore', () => {
    const overlay = createPendingTrashOverlay()
    const staleSeq = overlay.beginRead()
    overlay.register(['a'], false)
    overlay.settle(['a'])

    expect(overlay.apply([row('a', true)], staleSeq)).toEqual([row('a', false)])
  })

  it('returns the same array reference when nothing changes', () => {
    const overlay = createPendingTrashOverlay()
    const items = [row('a', false)]
    expect(overlay.apply(items, overlay.beginRead())).toBe(items)

    overlay.register(['a'], false)
    expect(overlay.apply(items, overlay.beginRead())).toBe(items)
  })
})
