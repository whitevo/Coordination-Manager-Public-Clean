import { describe, expect, it } from 'vitest'
import { compareFeedback, feedbackPageKey, planFeedbackStatusMove, type FeedbackSortable } from '../feedback-list-motion'

const ORDER = ['open', 'reviewed', 'affirmed', 'resolved', 'dismissed']

function row(id: string, status: string, day: number): FeedbackSortable {
  return { id, status, created_at: `2026-04-${String(day).padStart(2, '0')}T10:00:00Z` }
}

describe('compareFeedback', () => {
  it('sorts by status order first, then newest first', () => {
    const items = [row('old-open', 'open', 1), row('reviewed', 'reviewed', 9), row('new-open', 'open', 5)]
    expect([...items].sort((a, b) => compareFeedback(a, b, ORDER)).map(i => i.id))
      .toEqual(['new-open', 'old-open', 'reviewed'])
  })

  it('places unknown statuses last', () => {
    expect(compareFeedback(row('x', 'mystery', 9), row('y', 'dismissed', 1), ORDER)).toBeGreaterThan(0)
  })
})

describe('planFeedbackStatusMove', () => {
  const list = [row('a', 'open', 9), row('b', 'open', 8), row('c', 'reviewed', 7), row('d', 'resolved', 6)]

  it('settles inside the page when the new slot is on this page', () => {
    const plan = planFeedbackStatusMove({ list, id: 'a', status: 'reviewed', statusOrder: ORDER, statusFilter: 'all', hasMoreAfter: false, nextPageItems: [] })
    expect(plan?.exits).toBe(false)
    expect(plan?.order.map(i => i.id)).toEqual(['b', 'a', 'c', 'd'])
    expect(plan?.targetIndex).toBe(1)
  })

  it('stays at the end of the last page', () => {
    const plan = planFeedbackStatusMove({ list, id: 'a', status: 'dismissed', statusOrder: ORDER, statusFilter: 'all', hasMoreAfter: false, nextPageItems: [] })
    expect(plan?.exits).toBe(false)
    expect(plan?.order.map(i => i.id)).toEqual(['b', 'c', 'd', 'a'])
  })

  it('exits and backfills when the new slot is beyond the next page head', () => {
    const plan = planFeedbackStatusMove({ list, id: 'a', status: 'dismissed', statusOrder: ORDER, statusFilter: 'all', hasMoreAfter: true, nextPageItems: [row('e', 'resolved', 5)] })
    expect(plan?.exits).toBe(true)
    expect(plan?.order.map(i => i.id)).toEqual(['b', 'c', 'd'])
    expect(plan?.backfill?.id).toBe('e')
  })

  it('stays at the end when it still sorts before the next page head', () => {
    const plan = planFeedbackStatusMove({ list, id: 'a', status: 'dismissed', statusOrder: ORDER, statusFilter: 'all', hasMoreAfter: true, nextPageItems: [row('e', 'dismissed', 1)] })
    expect(plan?.exits).toBe(false)
    expect(plan?.order.map(i => i.id)).toEqual(['b', 'c', 'd', 'a'])
  })

  it('exits without backfill when the next page is unknown', () => {
    const plan = planFeedbackStatusMove({ list, id: 'a', status: 'dismissed', statusOrder: ORDER, statusFilter: 'all', hasMoreAfter: true, nextPageItems: [] })
    expect(plan?.exits).toBe(true)
    expect(plan?.backfill).toBeNull()
  })

  it('exits when the new status no longer matches the active filter', () => {
    const openOnly = [row('a', 'open', 9), row('b', 'open', 8)]
    const plan = planFeedbackStatusMove({ list: openOnly, id: 'a', status: 'reviewed', statusOrder: ORDER, statusFilter: 'open', hasMoreAfter: false, nextPageItems: [] })
    expect(plan?.exits).toBe(true)
    expect(plan?.order.map(i => i.id)).toEqual(['b'])
  })

  it('returns null for an unknown id', () => {
    expect(planFeedbackStatusMove({ list, id: 'zzz', status: 'open', statusOrder: ORDER, statusFilter: 'all', hasMoreAfter: false, nextPageItems: [] })).toBeNull()
  })
})

describe('feedbackPageKey', () => {
  it('changes with every query dimension', () => {
    const base = { tab: 'general', statusFilter: 'all', statusOrder: ORDER, pageSize: 5, page: 1 }
    const key = feedbackPageKey(base)
    expect(feedbackPageKey({ ...base, page: 2 })).not.toBe(key)
    expect(feedbackPageKey({ ...base, statusOrder: [...ORDER].reverse() })).not.toBe(key)
    expect(feedbackPageKey({ ...base, tab: 'support' })).not.toBe(key)
    expect(feedbackPageKey({ ...base, pageSize: 10 })).not.toBe(key)
    expect(feedbackPageKey({ ...base, statusFilter: 'open' })).not.toBe(key)
  })
})
