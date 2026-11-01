import { describe, expect, it } from 'vitest'
import { buildAiEvaluation, buildEvaluationFeedback, formatUnresolvedIssues, isMutationRequest } from '../ai-evaluation'

describe('ai-evaluation helpers', () => {
  it('marks evaluations ok only when there are no issues', () => {
    expect(buildAiEvaluation([]).ok).toBe(true)
    expect(buildAiEvaluation(['missing category']).ok).toBe(false)
  })

  it('builds retry feedback with issues, applied changes, and the previous reply', () => {
    const feedback = buildEvaluationFeedback('Created Deep Work.', buildAiEvaluation(['create_category was rejected'], ['Set slot width to 15 minutes']))
    expect(feedback).toContain('- create_category was rejected')
    expect(feedback).toContain('do NOT repeat')
    expect(feedback).toContain('- Set slot width to 15 minutes')
    expect(feedback).toContain('Created Deep Work.')
  })

  it('formats unresolved issues as an actionable section', () => {
    expect(formatUnresolvedIssues([])).toBe('')
    expect(formatUnresolvedIssues(['no mode matches "Focus"'])).toContain('Not completed')
  })

  it('detects change requests but not questions', () => {
    expect(isMutationRequest('Create category Deep Work in blue')).toBe(true)
    expect(isMutationRequest('Could you add a Sleep background?')).toBe(true)
    expect(isMutationRequest('How do I add a category?')).toBe(false)
    expect(isMutationRequest('Find my Miro links')).toBe(false)
  })
})
