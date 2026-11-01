// Evaluate -> retry contract shared by every AI assistant side panel.
// A page's onSubmit applies the model's answer, then reports whether the change
// actually landed (DB write succeeded, target found, action supported). If not,
// the side panel re-asks the model once with this evaluation as feedback.

export interface AiEvaluation {
  ok: boolean
  /** Problems the model can act on, phrased as what went wrong and why. */
  issues: string[]
  /** Changes that did land, so the retry does not repeat them. */
  applied?: string[]
}

export interface AiRetryRequest {
  evaluationFeedback: string
  retryToken: string
}

const MAX_FEEDBACK_LENGTH = 2900
const MAX_PREVIOUS_RESPONSE_LENGTH = 600

export function buildAiEvaluation(issues: string[], applied: string[] = []): AiEvaluation {
  return { ok: issues.length === 0, issues, applied }
}

/** Feedback sent back to the model on the automatic retry. */
export function buildEvaluationFeedback(previousResponse: string, evaluation: AiEvaluation): string {
  const lines = ['Problems found after applying your answer:', ...evaluation.issues.map(issue => `- ${issue}`)]
  if (evaluation.applied && evaluation.applied.length > 0) {
    lines.push('', 'Already applied successfully (do NOT repeat these):', ...evaluation.applied.map(item => `- ${item}`))
  }
  const previous = previousResponse.trim().slice(0, MAX_PREVIOUS_RESPONSE_LENGTH)
  if (previous) {
    lines.push('', `What you told the user: "${previous}"`)
  }
  return lines.join('\n').slice(0, MAX_FEEDBACK_LENGTH)
}

/** Appended to the final reply when the change still did not land after the retry. */
export function formatUnresolvedIssues(issues: string[]): string {
  if (issues.length === 0) return ''
  return [
    '',
    '',
    'Not completed -- the self-check found:',
    ...issues.map(issue => `- ${issue}`),
    '',
    'Next step: rephrase using the exact names shown on this page, or make this change manually in the panel.',
  ].join('\n')
}

/** Heuristic: does the prompt ask the assistant to change something (vs. ask a question)? */
export function isMutationRequest(message: string): boolean {
  const trimmed = message.trim()
  const isPoliteRequest = /^(please\s+)?(can|could|would|will)\s+you\b/i.test(trimmed)
  const isQuestion = trimmed.endsWith('?') || /^(how|what|why|where|when|which|who|can|could|is|are|does|do|should)\b/i.test(trimmed)
  if (isQuestion && !isPoliteRequest) return false
  return /\b(create|add|new|set|make|update|change|edit|rename|delete|remove|enable|disable|activate|switch|apply|save|configure|schedule|move)\b/i.test(trimmed)
}
