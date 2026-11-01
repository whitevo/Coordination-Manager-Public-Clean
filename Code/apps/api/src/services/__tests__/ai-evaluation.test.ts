import { describe, expect, it } from 'vitest'
import {
  AI_RETRY_TOKEN_TTL_MS,
  consumeAiRetryToken,
  evaluateFeedbackSubmission,
  issueAiRetryToken,
  normaliseEvaluationFeedback,
} from '../ai-evaluation.js'

describe('AI retry tokens', () => {
  it('accepts a fresh token once for the same user', () => {
    const token = issueAiRetryToken('user-1')
    expect(consumeAiRetryToken(token, 'user-1')).toBe(true)
    expect(consumeAiRetryToken(token, 'user-1')).toBe(false)
  })

  it('rejects tokens for another user', () => {
    const token = issueAiRetryToken('user-1')
    expect(consumeAiRetryToken(token, 'user-2')).toBe(false)
  })

  it('rejects expired tokens', () => {
    const now = Date.now()
    const token = issueAiRetryToken('user-1', now)
    expect(consumeAiRetryToken(token, 'user-1', now + AI_RETRY_TOKEN_TTL_MS + 1)).toBe(false)
  })

  it('rejects forged or malformed tokens', () => {
    const token = issueAiRetryToken('user-1')
    const [payload] = token.split('.')
    const forgedPayload = Buffer.from(JSON.stringify({ u: 'user-1', e: Date.now() + 60_000, n: 'x' })).toString('base64url')
    expect(consumeAiRetryToken(`${forgedPayload}.${token.split('.')[1]}`, 'user-1')).toBe(false)
    expect(consumeAiRetryToken(`${payload}.bad`, 'user-1')).toBe(false)
    expect(consumeAiRetryToken('nope', 'user-1')).toBe(false)
    expect(consumeAiRetryToken(undefined, 'user-1')).toBe(false)
  })
})

describe('normaliseEvaluationFeedback', () => {
  it('returns null for missing or blank feedback', () => {
    expect(normaliseEvaluationFeedback(undefined)).toBeNull()
    expect(normaliseEvaluationFeedback('   ')).toBeNull()
  })

  it('truncates oversized feedback instead of dropping it', () => {
    const result = normaliseEvaluationFeedback('x'.repeat(10_000))
    expect(result).not.toBeNull()
    expect(result!.length).toBeLessThanOrEqual(3000)
  })
})

describe('evaluateFeedbackSubmission', () => {
  it('extracts a valid submission block and strips it from visible text', () => {
    const result = evaluateFeedbackSubmission(
      'I\'ll submit this as a bug.\n[SUBMIT_FEEDBACK]\n{"message": "Button broken", "category": "bug"}\n[/SUBMIT_FEEDBACK]',
    )
    expect(result.issue).toBeNull()
    expect(result.payload).toEqual({ message: 'Button broken', category: 'bug' })
    expect(result.visibleText).toBe('I\'ll submit this as a bug.')
  })

  it('flags a claimed submission without a block', () => {
    const result = evaluateFeedbackSubmission('Thanks! I have submitted your feature request.')
    expect(result.payload).toBeNull()
    expect(result.issue).toMatch(/did not include/)
  })

  it('flags invalid JSON and empty messages', () => {
    expect(evaluateFeedbackSubmission('[SUBMIT_FEEDBACK]{bad json}[/SUBMIT_FEEDBACK]').issue).toMatch(/valid JSON/)
    expect(evaluateFeedbackSubmission('[SUBMIT_FEEDBACK]{"message": ""}[/SUBMIT_FEEDBACK]').issue).toMatch(/empty or missing/)
  })

  it('falls back to the general category for unknown categories', () => {
    const result = evaluateFeedbackSubmission('[SUBMIT_FEEDBACK]{"message": "Hi", "category": "praise"}[/SUBMIT_FEEDBACK]')
    expect(result.payload?.category).toBe('general')
  })

  it('does not flag ordinary answers', () => {
    expect(evaluateFeedbackSubmission('Shared calendars let people mark availability.').issue).toBeNull()
  })
})
