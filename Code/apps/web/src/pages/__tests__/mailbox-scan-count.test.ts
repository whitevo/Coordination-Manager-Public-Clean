import { describe, expect, it, vi } from 'vitest'
import { getMailboxScanVisibleCount } from '../mailbox-scan-count'

describe('incremental mailbox scan counting', () => {
  const previous = [{ id: 'a', visible: true }, { id: 'b', visible: false }]
  const changed = [{ id: 'b', visible: true }, { id: 'c', visible: true }]
  const messages = [previous[0], ...changed]
  const input = {
    previousCount: 1, previousSnapshot: previous, countedSnapshot: previous,
    messages, changedMessages: changed, replacedMessages: [previous[1]], filtersChanged: false,
  }
  it('counts only changed rows, including changed flags on existing ids', () => {
    const count = vi.fn((rows: typeof previous) => rows.filter(row => row.visible).length)
    expect(getMailboxScanVisibleCount({ ...input, count })).toBe(3)
    expect(count.mock.calls.map(([rows]) => rows.length)).toEqual([2, 1])
  })
  it.each(['filters', 'refresh'])('recounts the current collection after an intervening %s', reason => {
    const count = vi.fn((rows: typeof previous) => rows.filter(row => row.visible).length)
    expect(getMailboxScanVisibleCount({
      ...input, count,
      filtersChanged: reason === 'filters',
      countedSnapshot: reason === 'refresh' ? [...previous] : previous,
    })).toBe(3)
    expect(count).toHaveBeenCalledExactlyOnceWith(messages)
  })
})
