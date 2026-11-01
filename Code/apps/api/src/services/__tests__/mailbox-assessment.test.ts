import { describe, expect, it } from 'vitest'
import { buildAssessmentSystemPrompt } from '../mailbox-assessment.js'

describe('assessment prompt variants', () => {
  it('keeps the response contract stable across prompt versions', () => {
    for (const version of ['baseline', 'rubric-v2', 'conservative-v3'] as const) {
      const prompt = buildAssessmentSystemPrompt(version)
      expect(prompt).toContain('Return raw JSON only')
      expect(prompt).toContain('"score": 0.0')
      expect(prompt).toContain('Judge only what the email text supports')
    }
  })

  it('adds an evidence rubric to the default-oriented variant', () => {
    expect(buildAssessmentSystemPrompt('rubric-v2')).toContain('A sender or subject match alone is not enough')
    expect(buildAssessmentSystemPrompt('rubric-v2')).not.toContain('Start at 0.50')
  })

  it('adds conservative caps to the conservative variant', () => {
    expect(buildAssessmentSystemPrompt('conservative-v3')).toContain('Cap the score at 0.69')
    expect(buildAssessmentSystemPrompt('conservative-v3')).toContain('Contradictory evidence should outweigh weak supporting clues')
  })
})