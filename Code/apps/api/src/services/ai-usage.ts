import { supabaseAdmin } from '../supabaseClient.js'
import { AuthenticatedRequest, hasRole } from '../middleware/auth.js'

/**
 * Shared, database-backed daily AI usage quotas. Each feature category gets
 * its own independent daily budget (rows are tagged with `category` in
 * `ai_prompt_usage`), so a heavy user of one AI feature never crowds out
 * their quota for another.
 */
export type AiUsageCategory = 'chat' | 'mailbox_assessment' | 'mailbox_draft'

export type AccountTier = 'traveler' | 'verified' | 'admin'

// Chat: interactive assistant prompts (compose, calendar, availability, etc).
// Mailbox assessment: automated per-message AI scoring used by mailbox
// automation rules ("Assessment Check" condition). These calls are smaller,
// cheaper, and driven by rules the user already configured, so the daily
// budget is intentionally much larger than interactive chat.
// Mailbox draft: AI-generated reply drafts, either from the automation
// "Prompt internal AI assistant" action or the manual compose-panel assist
// button. Always saved as a mail_drafts row for human review -- never sent
// automatically. Costs more tokens than an assessment call, so the budget
// sits between chat and mailbox_assessment.
const DAILY_LIMITS: Record<AiUsageCategory, Record<AccountTier, number>> = {
  chat: { traveler: 2, verified: 10, admin: 200 },
  mailbox_assessment: { traveler: 20, verified: 300, admin: 3000 },
  mailbox_draft: { traveler: 5, verified: 50, admin: 500 },
}

function isTravelerAccount(req: AuthenticatedRequest): boolean {
  return hasRole(req, 'traveler') || (req.userEmail?.endsWith('@traveler.local') ?? false)
}

export function getAccountTier(req: AuthenticatedRequest): AccountTier {
  if (hasRole(req, 'admin')) return 'admin'
  return isTravelerAccount(req) ? 'traveler' : 'verified'
}

/** Same tier resolution as {@link getAccountTier}, but for background jobs that only have a user id (no live JWT/req). */
export async function getAccountTierForUserId(userId: string): Promise<AccountTier> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('roles, email')
    .eq('id', userId)
    .single()

  if (error || !data) return 'verified'

  const roles = Array.isArray(data.roles) ? data.roles.map(String) : []
  if (roles.includes('admin')) return 'admin'
  if (roles.includes('traveler') || (typeof data.email === 'string' && data.email.endsWith('@traveler.local'))) return 'traveler'
  return 'verified'
}

export function getDailyUsageLimit(req: AuthenticatedRequest, category: AiUsageCategory): number {
  return DAILY_LIMITS[category][getAccountTier(req)]
}

function getTodayStartIso(): string {
  return `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`
}

/** Counts today's usage rows for a user in a given category. Fails open (returns 0) on DB errors. */
export async function getUserDailyUsageCount(userId: string, category: AiUsageCategory): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('ai_prompt_usage')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('category', category)
    .gte('created_at', getTodayStartIso())

  if (error) {
    console.error(`Failed to query ai_prompt_usage count (${category}):`, error.message)
    return 0
  }
  return count ?? 0
}

/** Records one unit of usage in a given category. */
export async function recordAiUsage(userId: string, category: AiUsageCategory): Promise<void> {
  const { error } = await supabaseAdmin
    .from('ai_prompt_usage')
    .insert({ user_id: userId, category })

  if (error) {
    console.error(`Failed to record ai_prompt_usage (${category}):`, error.message)
  }
}

export interface UsageCheckResult {
  allowed: boolean
  limit: number
  remaining: number
  accountTier: AccountTier
}

async function checkAndRecordAiUsageForTier(
  userId: string,
  tier: AccountTier,
  category: AiUsageCategory,
): Promise<UsageCheckResult> {
  const limit = DAILY_LIMITS[category][tier]
  const currentCount = await getUserDailyUsageCount(userId, category)

  if (currentCount >= limit) {
    return { allowed: false, limit, remaining: 0, accountTier: tier }
  }

  await recordAiUsage(userId, category)
  return { allowed: true, limit, remaining: limit - currentCount - 1, accountTier: tier }
}

/** Checks the caller's remaining daily budget for a category and records one use if allowed. Background jobs (mailbox sync, cascades) with no live req/JWT resolve the tier from the user ID. */
export async function checkAndRecordAiUsageForUserId(
  userId: string,
  category: AiUsageCategory,
): Promise<UsageCheckResult> {
  const tier = await getAccountTierForUserId(userId)
  return checkAndRecordAiUsageForTier(userId, tier, category)
}
