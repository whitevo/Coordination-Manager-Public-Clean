/**
 * AI scoring for the "Assessment" automation check.
 *
 * The check asks a model how confident it is that an email satisfies the
 * user's stated context and intent. Everything here degrades to an
 * unavailable result with an explanation instead of throwing, so a rule run
 * never fails because the AI provider is down or unconfigured.
 */

const AI_PROVIDER = process.env.AI_PROVIDER || 'openai'

const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  'asi-create': 'https://api.asicreate.io/v1',
  custom: '',
}

const AI_BASE_URL = process.env.AI_BASE_URL || DEFAULT_BASE_URLS[AI_PROVIDER] || DEFAULT_BASE_URLS.openai
const AI_API_KEY = process.env.AI_API_KEY || ''
const AI_MODEL = process.env.AI_MODEL || 'gpt-4o'
const AI_ASSESSMENT_PROMPT_VERSION = process.env.AI_ASSESSMENT_PROMPT_VERSION || 'rubric-v2'

const MAX_BODY_CHARS = 4000
const REQUEST_TIMEOUT_MS = 20000

export type AssessmentPromptVersion = 'baseline' | 'rubric-v2' | 'conservative-v3'

const BASE_SYSTEM_PROMPT = `You score one email against a user's assessment context and intent.

Return raw JSON only, no markdown fences:
{"score": 0.0, "reasoning": "one or two sentences"}

- "score" is your confidence from 0 to 1 that the email satisfies the intent.
- "reasoning" must name the concrete evidence in the email that drove the score, and say what was missing when the score is low.
- Judge only what the email text supports. Never invent facts.`

const PROMPT_VARIANT_GUIDANCE: Record<AssessmentPromptVersion, string> = {
  baseline: '',
  'rubric-v2': `

Scoring rubric:
- 0.90-1.00: direct, unambiguous evidence supports the intent and no material contradiction is present.
- 0.70-0.89: strong evidence supports the intent, but a minor detail is missing or indirect.
- 0.40-0.69: mixed, incomplete, or ambiguous evidence; do not use a high score to compensate for missing proof.
- 0.00-0.39: the message is unrelated, contradicts the intent, or lacks the evidence needed to satisfy it.
- Treat the assessment context as instructions about what evidence matters, and treat the assessment intent as the decision to make. Do not treat either one as evidence about the email.
- A sender or subject match alone is not enough unless the intent explicitly says that it is sufficient.`,
  'conservative-v3': `

Use a conservative evidence standard:
- Start at 0.50 and move upward only for explicit evidence in the email that satisfies the intent.
- Cap the score at 0.69 when the conclusion depends on implication, sender identity, or a generic template rather than explicit email content.
- Score 0.90 or higher only when the email states the relevant outcome clearly and directly.
- Contradictory evidence should outweigh weak supporting clues.
- The context explains what to inspect; it is not evidence. The intent defines the decision; it is not evidence.
- Mention the strongest supporting fact and the strongest missing or contradictory fact in the reasoning.`,
}

export function buildAssessmentSystemPrompt(version: AssessmentPromptVersion = 'rubric-v2'): string {
  return `${BASE_SYSTEM_PROMPT}${PROMPT_VARIANT_GUIDANCE[version]}`
}

function getAssessmentPromptVersion(value: string): AssessmentPromptVersion {
  if (value === 'baseline' || value === 'conservative-v3') return value
  return 'rubric-v2'
}

export interface AssessmentInput {
  subject: string | null
  fromEmail: string | null
  fromName: string | null
  toEmails: string | null
  body: string | null
  context: string
  intent: string
}

export interface AssessmentResult {
  score: number
  reasoning: string
  /** False when no score could be produced, so the rule must not treat 0 as a judgement. */
  available: boolean
  /** What the model was given, so the user can see whether it had enough to work with. */
  inputSummary: { hasBody: boolean; bodyChars: number; hasContext: boolean; hasIntent: boolean }
}

function clampScore(value: unknown): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0
  return Math.min(1, Math.max(0, num))
}

function readReasoning(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, 600)
}

function parseJsonPayload(raw: string): Record<string, unknown> | null {
  const withoutFences = raw.replace(/```(?:json)?/gi, '').trim()
  const start = withoutFences.indexOf('{')
  const end = withoutFences.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(withoutFences.slice(start, end + 1)) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export async function assessMessage(input: AssessmentInput): Promise<AssessmentResult> {
  const body = (input.body || '').replace(/\s+/g, ' ').trim().slice(0, MAX_BODY_CHARS)
  const inputSummary = {
    hasBody: body.length > 0,
    bodyChars: body.length,
    hasContext: input.context.trim().length > 0,
    hasIntent: input.intent.trim().length > 0,
  }

  if (!AI_API_KEY) {
    return {
      score: 0,
      reasoning: 'No score was produced: this server has no AI provider configured for assessments.',
      available: false,
      inputSummary,
    }
  }

  if (!inputSummary.hasIntent) {
    return {
      score: 0,
      reasoning: 'No score was produced: the assessment check has no intent, so there is nothing to judge the email against.',
      available: false,
      inputSummary,
    }
  }

  const userContent = [
    `Assessment context: ${input.context || '(none given)'}`,
    `Assessment intent: ${input.intent}`,
    '',
    'Email:',
    `From: ${input.fromName || ''} <${input.fromEmail || ''}>`,
    `To: ${input.toEmails || ''}`,
    `Subject: ${input.subject || '(no subject)'}`,
    `Body: ${body || '(no body text was stored for this email)'}`,
  ].join('\n')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: buildAssessmentSystemPrompt(getAssessmentPromptVersion(AI_ASSESSMENT_PROMPT_VERSION)) },
          { role: 'user', content: userContent },
        ],
        max_tokens: 300,
        temperature: 0,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      return {
        score: 0,
        reasoning: `No score was produced: the AI provider returned status ${response.status}.`,
        available: false,
        inputSummary,
      }
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const content = data.choices?.[0]?.message?.content || ''
    const parsed = parseJsonPayload(content)

    if (!parsed) {
      return {
        score: 0,
        reasoning: 'No score was produced: the AI reply could not be read as JSON.',
        available: false,
        inputSummary,
      }
    }

    return {
      score: clampScore(parsed.score),
      reasoning: readReasoning(parsed.reasoning) || 'The model returned a score without an explanation.',
      available: true,
      inputSummary,
    }
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    return {
      score: 0,
      reasoning: aborted
        ? 'No score was produced: the AI provider did not answer in time.'
        : 'No score was produced: the AI provider could not be reached.',
      available: false,
      inputSummary,
    }
  } finally {
    clearTimeout(timeout)
  }
}
