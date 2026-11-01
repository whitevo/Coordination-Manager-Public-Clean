/**
 * Pure helpers for the Feedback list: client-side ordering that mirrors the
 * API (`GET /api/feedback` sorts by status order, then newest first), status
 * move planning for the reorder animation, and the next-page cache key.
 */

export interface FeedbackSortable {
  id: string
  status: string
  created_at: string
}

export const FEEDBACK_STATUS_HOLD_MS = 450
export const FEEDBACK_MOVE_MS = 350
export const FEEDBACK_EXIT_MS = 300
export const FEEDBACK_ENTER_MS = 300
export const FEEDBACK_FLASH_MS = 700
export const FEEDBACK_PAGE_CACHE_TTL_MS = 60_000

function statusRank(status: string, statusOrder: readonly string[]): number {
  const index = statusOrder.indexOf(status)
  return index === -1 ? statusOrder.length : index
}

function createdAtMs(value: string): number {
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? 0 : ms
}

export function compareFeedback(a: FeedbackSortable, b: FeedbackSortable, statusOrder: readonly string[]): number {
  const byStatus = statusRank(a.status, statusOrder) - statusRank(b.status, statusOrder)
  if (byStatus !== 0) return byStatus
  return createdAtMs(b.created_at) - createdAtMs(a.created_at)
}

export interface PlanFeedbackStatusMoveInput<T extends FeedbackSortable> {
  list: T[]
  id: string
  status: string
  statusOrder: readonly string[]
  statusFilter: string
  /** True when more items exist after the current page. */
  hasMoreAfter: boolean
  /** Prefetched items of the next page (same query), if available. */
  nextPageItems: readonly T[]
}

export interface FeedbackStatusMovePlan<T extends FeedbackSortable> {
  updated: T
  /** Items that remain on the page, without the moved item when it exits. */
  rest: T[]
  /** Final in-page order (equals `rest` when the item exits). */
  order: T[]
  /** Index the item settles at; -1 when it leaves the page. */
  targetIndex: number
  exits: boolean
  /** Next-page item that slides in to keep the page full after an exit. */
  backfill: T | null
}

export function planFeedbackStatusMove<T extends FeedbackSortable>(
  input: PlanFeedbackStatusMoveInput<T>,
): FeedbackStatusMovePlan<T> | null {
  const { list, id, status, statusOrder, statusFilter, hasMoreAfter, nextPageItems } = input
  const current = list.find(item => item.id === id)
  if (!current) return null
  const updated: T = { ...current, status }
  const rest = list.filter(item => item.id !== id)
  const restIds = new Set(rest.map(item => item.id))
  const nextCandidate = nextPageItems.find(item => item.id !== id && !restIds.has(item.id)) ?? null

  let exits = statusFilter !== 'all' && status !== statusFilter
  let targetIndex = -1
  if (!exits) {
    const insertAt = rest.findIndex(other => compareFeedback(updated, other, statusOrder) < 0)
    targetIndex = insertAt === -1 ? rest.length : insertAt
    if (targetIndex === rest.length && hasMoreAfter) {
      exits = !nextCandidate || compareFeedback(updated, nextCandidate, statusOrder) > 0
    }
    if (exits) targetIndex = -1
  }

  const order = exits
    ? rest
    : [...rest.slice(0, targetIndex), updated, ...rest.slice(targetIndex)]

  return {
    updated,
    rest,
    order,
    targetIndex,
    exits,
    backfill: exits && hasMoreAfter ? nextCandidate : null,
  }
}

export interface FeedbackPageQuery {
  tab: string
  statusFilter: string
  statusOrder: readonly string[]
  pageSize: number
  page: number
}

export function feedbackPageKey(query: FeedbackPageQuery): string {
  return `feedback:${query.tab}:${query.statusFilter}:${query.statusOrder.join(',')}:${query.pageSize}:${query.page}`
}
