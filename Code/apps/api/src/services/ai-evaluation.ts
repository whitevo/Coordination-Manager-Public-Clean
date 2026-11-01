import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { sanitizeString } from '../middleware/validation.js'

// Evaluate -> retry support for AI assistants. After an AI turn, the caller checks
// whether the requested change actually landed (DB row written, action applied).
// If not, it may re-ask the model once with the evaluation results attached. The
// retry is authorised by a short-lived, single-use token so it does not consume
// another daily prompt and cannot be replayed.

export const AI_RETRY_TOKEN_TTL_MS = 5 * 60 * 1000
export const MAX_EVALUATION_FEEDBACK_LENGTH = 3000

// Per-process fallback only matters in dev/test; index.ts refuses to boot in production without JWT_SECRET.
const processFallbackKey = randomBytes(32).toString('hex')
const consumedNonces = new Map<string, number>()

function getSigningKey(): string {
  return process.env.JWT_SECRET || processFallbackKey
}

function sign(payload: string): string {
  return createHmac('sha256', getSigningKey()).update(`ai-retry:${payload}`).digest('base64url')
}

function pruneConsumedNonces(now: number): void {
  for (const [nonce, expiresAt] of consumedNonces) {
    if (expiresAt <= now) consumedNonces.delete(nonce)
  }
}

export function issueAiRetryToken(userId: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({
    u: userId,
    e: now + AI_RETRY_TOKEN_TTL_MS,
    n: randomBytes(12).toString('base64url'),
  })).toString('base64url')
  return `${payload}.${sign(payload)}`
}

/** Verify and burn a retry token. Returns false for forged, expired, foreign, or reused tokens. */
export function consumeAiRetryToken(token: unknown, userId: string, now = Date.now()): boolean {
  if (typeof token !== 'string' || token.length > 512) return false
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra !== undefined) return false

  const expected = Buffer.from(sign(payload))
  const provided = Buffer.from(signature)
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return false

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'))
  } catch {
    return false
  }
  if (!parsed || typeof parsed !== 'object') return false
  const { u, e, n } = parsed as { u?: unknown; e?: unknown; n?: unknown }
  if (u !== userId || typeof e !== 'number' || typeof n !== 'string') return false
  if (e <= now) return false

  pruneConsumedNonces(now)
  if (consumedNonces.has(n)) return false
  consumedNonces.set(n, e)
  return true
}

/** Normalise client-supplied evaluation feedback; returns null when absent or empty. */
export function normaliseEvaluationFeedback(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  return sanitizeString(raw.slice(0, MAX_EVALUATION_FEEDBACK_LENGTH), MAX_EVALUATION_FEEDBACK_LENGTH)
}

/** The message appended after the user's prompt when the model is asked to try again. */
export function buildEvaluationRetryMessage(feedback: string): string {
  return [
    '[AUTOMATIC EVALUATION OF YOUR PREVIOUS ATTEMPT]',
    'Your previous answer to the request above was executed and then checked. It did not fully achieve what the user asked:',
    feedback,
    '',
    'Try again for the SAME user request:',
    '- Fix the problems listed above (use only supported action types, valid fields, and identifiers/names that exist in the provided state).',
    '- Keep the exact same response format required by your instructions.',
    '- If the request genuinely cannot be completed, return no changes and explain to the user concretely what is blocking it and what they can do next (which setting, page, or value to change).',
    '[END EVALUATION]',
  ].join('\n')
}

export const JSON_FORMAT_RETRY_MESSAGE = [
  '[AUTOMATIC EVALUATION OF YOUR PREVIOUS ATTEMPT]',
  'Your previous answer could not be parsed as the required JSON object, so nothing was applied.',
  'Answer the same user request again and return ONLY the raw JSON object in the exact shape from your instructions -- no markdown fences, no prose before or after, no comments, no trailing commas.',
  '[END EVALUATION]',
].join('\n')

const FEEDBACK_BLOCK_RE = /\[SUBMIT_FEEDBACK\]\s*([\s\S]*?)\s*\[\/SUBMIT_FEEDBACK\]/
const FEEDBACK_CATEGORIES = ['general', 'bug', 'feature', 'other'] as const
// Catches "I'll submit this...", "I've filed your bug report", "has been submitted" etc.
const SUBMISSION_CLAIM_RE = /\b(i(?:'ll| will)\s+(?:submit|file|send|log|record)|i(?:'ve| have)\s+(?:submitted|filed|sent|logged|recorded)|(?:has|have) been (?:submitted|filed|sent|logged|recorded))\b/i
const FEEDBACK_TOPIC_RE = /\b(feedback|bug|feature|request|report|suggestion)\b/i

export interface FeedbackSubmissionEvaluation {
  /** Response text with any submission block removed. */
  visibleText: string
  payload: { message: string; category: (typeof FEEDBACK_CATEGORIES)[number] } | null
  /** Set when the model broke the submission contract in a way a retry can fix. */
  issue: string | null
}

/** Check the general assistant's [SUBMIT_FEEDBACK] contract before anything is written to the DB. */
export function evaluateFeedbackSubmission(content: string): FeedbackSubmissionEvaluation {
  const match = content.match(FEEDBACK_BLOCK_RE)
  const visibleText = content.replace(/\[SUBMIT_FEEDBACK\][\s\S]*?\[\/SUBMIT_FEEDBACK\]/, '').trim()

  if (!match) {
    const claimsSubmission = SUBMISSION_CLAIM_RE.test(content) && FEEDBACK_TOPIC_RE.test(content)
    return {
      visibleText,
      payload: null,
      issue: claimsSubmission
        ? 'You told the user their feedback is being submitted, but you did not include the [SUBMIT_FEEDBACK]{...}[/SUBMIT_FEEDBACK] block, so nothing was saved. Include the block at the very end, or do not claim it was submitted.'
        : null,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(match[1].trim())
  } catch {
    return {
      visibleText,
      payload: null,
      issue: 'The [SUBMIT_FEEDBACK] block did not contain valid JSON, so nothing was saved. It must be exactly {"message": "...", "category": "general|bug|feature|other"}.',
    }
  }

  const record = parsed && typeof parsed === 'object' ? parsed as { message?: unknown; category?: unknown } : {}
  const message = typeof record.message === 'string' ? record.message.trim().slice(0, 2000) : ''
  if (!message) {
    return {
      visibleText,
      payload: null,
      issue: 'The [SUBMIT_FEEDBACK] block had an empty or missing "message", so nothing was saved. Put the user\'s feedback text in "message".',
    }
  }

  const category = FEEDBACK_CATEGORIES.find(c => c === record.category) ?? 'general'
  return { visibleText, payload: { message, category }, issue: null }
}
