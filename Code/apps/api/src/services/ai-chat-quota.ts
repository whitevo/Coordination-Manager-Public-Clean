import { supabaseAdmin } from '../supabaseClient.js'
import { ApplicationError } from '../middleware/error-handler.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import { getDailyUsageLimit } from './ai-usage.js'

export interface ChatQuota {
  limit: number
  remaining: number
  reservationId?: string
}

const pendingChecks = new Map<string, Promise<void>>()

export async function getChatUsageCount(userId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('ai_prompt_usage')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('category', 'chat')
    .gte('created_at', `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`)
  if (error || count === null) {
    console.error('Failed to query AI chat allowance:', error?.message ?? 'Missing usage count')
    throw new ApplicationError('Unable to check your AI allowance. Please try again.', 503, 'AI_QUOTA_UNAVAILABLE')
  }
  return count
}

/** Reserve before calling the provider so concurrent requests include in-flight usage. */
export async function reserveChatQuota(req: AuthenticatedRequest): Promise<ChatQuota> {
  const userId = req.userId!
  const previous = pendingChecks.get(userId) ?? Promise.resolve()
  let unlock!: () => void
  const current = new Promise<void>(resolve => { unlock = resolve })
  pendingChecks.set(userId, current)
  await previous
  try {
    const limit = getDailyUsageLimit(req, 'chat')
    const used = await getChatUsageCount(userId)
    if (used >= limit) return { limit, remaining: 0 }

    const { data, error } = await supabaseAdmin
      .from('ai_prompt_usage')
      .insert({ user_id: userId, category: 'chat' })
      .select('id')
      .single()
    if (error || typeof data?.id !== 'string') {
      console.error('Failed to reserve AI chat allowance:', error?.message ?? 'Missing usage row')
      throw new ApplicationError('Unable to reserve your AI allowance. Please try again.', 503, 'AI_QUOTA_UNAVAILABLE')
    }
    return { limit, remaining: limit - used - 1, reservationId: data.id }
  } finally {
    unlock()
    if (pendingChecks.get(userId) === current) pendingChecks.delete(userId)
  }
}

export async function releaseChatQuota(userId: string, quota: ChatQuota): Promise<void> {
  if (!quota.reservationId) return
  const { error } = await supabaseAdmin
    .from('ai_prompt_usage')
    .delete()
    .eq('id', quota.reservationId)
    .eq('user_id', userId)
    .eq('category', 'chat')
  if (error) {
    console.error('Failed to restore AI chat allowance:', error.message)
    throw new ApplicationError('The AI request failed and your allowance could not be restored. Please contact support.', 503, 'AI_QUOTA_RESTORE_FAILED')
  }
  quota.remaining = Math.max(0, quota.limit - await getChatUsageCount(userId))
  quota.reservationId = undefined
}
