/**
 * Mailbox automation rule schema, normalization, and evaluation.
 *
 * A rule is an ordered list of steps of three kinds: "condition" (field
 * checks), "receive_action" (a trigger that matches once a given action has
 * already been applied to the message, e.g. "was junked"), and "action"
 * ("Take action" -- what happens when the rule matches). Condition and
 * receive_action steps both gate the match; action steps only run once it
 * does. Steps carry an explicit position so the interleaved order the user
 * built survives the split into the `conditions` and `actions` JSONB columns
 * of `mail_rules` (receive_action steps are stored alongside conditions).
 */

export type AutomationFieldId =
  | 'from_email'
  | 'from_name'
  | 'to_emails'
  | 'cc_emails'
  | 'subject'
  | 'body'
  | 'assessment'
  | 'account_address'
  | 'identity_group'
  | 'has_attachments'
  | 'attachment_name'
  | 'attachment_format'
  | 'attachment_size_kb'
  | 'is_read'
  | 'is_archived'
  | 'is_trashed'
  | 'tag'

export type AutomationOperator =
  | 'contains_words'
  | 'contains_characters'
  | 'not_contains'
  | 'exact_match'
  | 'starts_with'
  | 'ends_with'
  | 'has_value'
  | 'is_empty'
  | 'is_true'
  | 'is_false'
  | 'greater_than'
  | 'less_than'

export type AutomationActionType =
  | 'trash'
  | 'junk'
  | 'archive'
  | 'unarchive'
  | 'mark_read'
  | 'mark_unread'
  | 'add_tag'
  | 'remove_tag'
  | 'reply'
  | 'forward'
   | 'agent_prompt'

export type AutomationReceiveActionType =
  | AutomationActionType
  | 'import_junk'
  | 'import_trash'
  | 'import_archived'

export type AutomationRuleMode = 'active' | 'dry_run' | 'disabled'

export type AutomationMatchMode = 'all' | 'any'

export interface AutomationConditionStep {
  id: string
  kind: 'condition'
  position: number
  enabled: boolean
  field: AutomationFieldId
  operator: AutomationOperator
  value: string
  caseSensitive: boolean
  assessmentContext?: string
  assessmentIntent?: string
  assessmentScoreThreshold?: number
}

export interface AutomationActionStep {
  id: string
  kind: 'action'
  position: number
  enabled: boolean
  action: AutomationActionType
  value: string
  agentContext?: string
  agentIntent?: string
}

/**
 * A trigger step that matches once `action` has already been applied to the
 * message (recorded in `mail_action_events`), instead of checking a field.
 * `allowRecursion` decides whether automation-caused occurrences of that
 * action count, not just manual ones -- see `evaluateReceiveAction`.
 */
export interface AutomationReceiveActionStep {
  id: string
  kind: 'receive_action'
  position: number
  enabled: boolean
  action: AutomationReceiveActionType
  value: string
  allowRecursion: boolean
}

export type AutomationStep = AutomationConditionStep | AutomationActionStep | AutomationReceiveActionStep

export interface AutomationRuleDefinition {
  name: string
  mode: AutomationRuleMode
  stopProcessing: boolean
  match: AutomationMatchMode
  steps: AutomationStep[]
}

/** Actions that this release is allowed to execute against real data. */
export const EXECUTABLE_AUTOMATION_ACTIONS: readonly AutomationActionType[] = [
  'trash',
  'junk',
  'archive',
  'unarchive',
  'mark_read',
  'mark_unread',
  'add_tag',
  'remove_tag',
  'agent_prompt',
]

/** Actions the builder can express but that stay permanently non-executable: they model sending mail. */
export const DEFERRED_AUTOMATION_ACTIONS: readonly AutomationActionType[] = ['reply', 'forward']

/** Actions a "Receive action" step can match on. Reply/forward are never applied, so they cannot be received. */
export const RECEIVABLE_AUTOMATION_ACTIONS: readonly AutomationReceiveActionType[] = [
  ...EXECUTABLE_AUTOMATION_ACTIONS,
  'import_junk',
  'import_trash',
  'import_archived',
]

function actionUsesTagValue(action: AutomationReceiveActionType): boolean {
  return action === 'add_tag' || action === 'remove_tag'
}

const FIELD_IDS = new Set<AutomationFieldId>([
  'from_email', 'from_name', 'to_emails', 'cc_emails', 'subject', 'body', 'assessment',
  'account_address', 'identity_group', 'has_attachments', 'attachment_name',
  'attachment_format', 'attachment_size_kb', 'is_read', 'is_archived', 'is_trashed', 'tag',
])

const OPERATOR_IDS = new Set<AutomationOperator>([
  'contains_words', 'contains_characters', 'not_contains', 'exact_match',
  'starts_with', 'ends_with', 'has_value', 'is_empty', 'is_true', 'is_false',
  'greater_than', 'less_than',
])

const ACTION_IDS = new Set<AutomationActionType>([
  'trash', 'junk', 'archive', 'unarchive', 'mark_read', 'mark_unread',
  'add_tag', 'remove_tag', 'reply', 'forward', 'agent_prompt',
])

const RECEIVE_ACTION_IDS = new Set<AutomationReceiveActionType>(RECEIVABLE_AUTOMATION_ACTIONS)

const BOOLEAN_FIELDS = new Set<AutomationFieldId>(['has_attachments', 'is_read', 'is_archived', 'is_trashed'])
const NUMERIC_FIELDS = new Set<AutomationFieldId>(['attachment_size_kb'])

export const MAX_AUTOMATION_STEPS = 40
export const MAX_AUTOMATION_RULES = 50

function readString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  // Control characters are dropped so stored rule text cannot inject into logs or JSON views.
  const stripped = Array.from(value)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0
      return code > 31 && code !== 127
    })
    .join('')
  return stripped.trim().slice(0, maxLength)
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

function readInteger(value: unknown, fallback: number, min: number, max: number): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(min, Math.floor(num)))
}

function readStepId(value: unknown, index: number): string {
  const raw = readString(value, 64)
  return /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : `step-${index}`
}

/** Operators that are valid for a field, in the order the UI should offer them. */
export function allowedOperatorsForField(field: AutomationFieldId): AutomationOperator[] {
  if (field === 'assessment') return ['has_value']
  if (BOOLEAN_FIELDS.has(field)) return ['is_true', 'is_false']
  if (NUMERIC_FIELDS.has(field)) return ['greater_than', 'less_than', 'exact_match', 'has_value']
  if (field === 'tag') return ['has_value', 'is_empty', 'exact_match', 'not_contains']
  return [
    'contains_words', 'contains_characters', 'not_contains', 'exact_match',
    'starts_with', 'ends_with', 'has_value', 'is_empty',
  ]
}

function normalizeStep(input: unknown, index: number): AutomationStep | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  const position = readInteger(raw.position, index, 0, MAX_AUTOMATION_STEPS)
  const enabled = readBoolean(raw.enabled, true)
  const id = readStepId(raw.id, index)

  if (raw.kind === 'action') {
    const action = readString(raw.action, 40) as AutomationActionType
    if (!ACTION_IDS.has(action)) return null
    return {
      id, kind: 'action', position, enabled, action, value: readString(raw.value, 2000),
      ...(action === 'agent_prompt' ? {
        agentContext: readString(raw.agentContext ?? raw.context, 2000),
        agentIntent: readString(raw.agentIntent ?? raw.intent, 1000),
      } : {}),
    }
  }

  if (raw.kind === 'receive_action') {
    const action = readString(raw.action, 40) as AutomationReceiveActionType
    if (!RECEIVE_ACTION_IDS.has(action)) return null
    return {
      id,
      kind: 'receive_action',
      position,
      enabled,
      action,
      value: readString(raw.value, 500),
      // Defaults to off so an existing rule cannot start reacting to its own automation output unexpectedly.
      allowRecursion: readBoolean(raw.allowRecursion, false),
    }
  }

  const field = readString(raw.field, 40) as AutomationFieldId
  if (!FIELD_IDS.has(field)) return null

  const operator = readString(raw.operator, 40) as AutomationOperator
  if (!OPERATOR_IDS.has(operator)) return null
  if (!allowedOperatorsForField(field).includes(operator)) return null

  return {
    id,
    kind: 'condition',
    position,
    enabled,
    field,
    operator,
    value: readString(raw.value, 500),
    caseSensitive: readBoolean(raw.caseSensitive, false),
    ...(field === 'assessment' ? {
      assessmentContext: readString(raw.assessmentContext ?? raw.context, 2000),
      assessmentIntent: readString(raw.assessmentIntent ?? raw.intent, 1000),
      assessmentScoreThreshold: Number.isFinite(Number(raw.assessmentScoreThreshold))
        ? Math.min(1, Math.max(0, Number(raw.assessmentScoreThreshold)))
        : 0.8,
    } : {}),
  }
}

/** Accepts untrusted client input and returns a rule that is safe to persist. */
export function normalizeAutomationRule(input: unknown): AutomationRuleDefinition | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>

  const name = readString(raw.name, 120)
  if (!name) return null

  const modeRaw = readString(raw.mode, 20)
  const mode: AutomationRuleMode =
    modeRaw === 'dry_run' || modeRaw === 'disabled' || modeRaw === 'active' ? modeRaw : 'dry_run'

  const rawSteps = Array.isArray(raw.steps) ? raw.steps.slice(0, MAX_AUTOMATION_STEPS) : []
  const steps = rawSteps
    .map((step, index) => normalizeStep(step, index))
    .filter((step): step is AutomationStep => step !== null)
    .sort((a, b) => a.position - b.position)
    .map((step, index) => ({ ...step, position: index }))

  return {
    name,
    mode,
    stopProcessing: readBoolean(raw.stopProcessing, false),
    match: raw.match === 'any' ? 'any' : 'all',
    steps,
  }
}

/** Splits a rule into the `conditions` and `actions` JSONB payloads. Receive-action steps are triggers, so they ride with conditions. */
export function toRuleColumns(rule: AutomationRuleDefinition): { conditions: unknown; actions: unknown } {
  return {
    conditions: {
      version: 1,
      match: rule.match,
      steps: rule.steps.filter(
        (step): step is AutomationConditionStep | AutomationReceiveActionStep =>
          step.kind === 'condition' || step.kind === 'receive_action',
      ),
    },
    actions: {
      version: 1,
      steps: rule.steps.filter((step): step is AutomationActionStep => step.kind === 'action'),
    },
  }
}

/** Rebuilds the ordered rule from a stored `mail_rules` row. */
export function fromRuleColumns(row: {
  name: string
  mode: string
  stop_processing: boolean
  conditions: unknown
  actions: unknown
}): AutomationRuleDefinition {
  const conditions = (row.conditions && typeof row.conditions === 'object' ? row.conditions : {}) as Record<string, unknown>
  const actions = (row.actions && typeof row.actions === 'object' ? row.actions : {}) as Record<string, unknown>
  const merged = [
    ...(Array.isArray(conditions.steps) ? conditions.steps : []),
    ...(Array.isArray(actions.steps) ? actions.steps : []),
  ]

  const normalized = normalizeAutomationRule({
    name: row.name,
    mode: row.mode,
    stopProcessing: row.stop_processing,
    match: conditions.match,
    steps: merged,
  })

  return normalized || {
    name: row.name,
    mode: 'disabled',
    stopProcessing: row.stop_processing,
    match: 'all',
    steps: [],
  }
}

// ─── Evaluation ──────────────────────────────────────────────────────────────

export interface AutomationAttachment {
  filename: string
  mime_type: string | null
  size_bytes: number | null
}

/** A previously applied action on a message, used to evaluate `receive_action` steps. */
export interface AutomationActionEvent {
  action: AutomationReceiveActionType
  value: string
  source: 'manual' | 'rule' | 'import'
  ruleId: string | null
}

export interface AutomationMessage {
  id: string
  account_id: string
  thread_id?: string | null
  from_email: string | null
  from_name: string | null
  to_emails: string | null
  cc_emails: string | null
  subject: string | null
  body_text: string | null
  assessment_intent?: string | null
  assessment_context?: string | null
  assessment_score?: number | null
  /** AI assessment scores for this message, keyed by the assessment step id. */
  assessmentScores?: Record<string, number>
  preview: string | null
  has_attachments: boolean
  attachments: AutomationAttachment[]
  is_read: boolean
  is_archived: boolean
  is_provider_trashed: boolean
  user_tag_ids: string[]
  account_address: string
  identity_group: string
  /** Actions already applied to this message, most recent last. */
  recentActionEvents: AutomationActionEvent[]
}

function textForField(message: AutomationMessage, field: AutomationFieldId): string[] {
  switch (field) {
    case 'from_email': return [message.from_email || '']
    case 'from_name': return [message.from_name || '']
    case 'to_emails': return [message.to_emails || '']
    case 'cc_emails': return [message.cc_emails || '']
    case 'subject': return [message.subject || '']
    case 'body': return [message.body_text || message.preview || '']
    case 'assessment': return [message.assessment_context || '', message.assessment_intent || '']
    case 'account_address': return [message.account_address]
    case 'identity_group': return [message.identity_group]
    case 'attachment_name': return message.attachments.map((item) => item.filename)
    case 'attachment_format': return message.attachments.map((item) => {
      const dotIndex = item.filename.lastIndexOf('.')
      const extension = dotIndex > 0 ? item.filename.slice(dotIndex + 1) : ''
      return extension || item.mime_type || ''
    })
    case 'tag': return message.user_tag_ids
    default: return []
  }
}

function booleanForField(message: AutomationMessage, field: AutomationFieldId): boolean {
  switch (field) {
    case 'has_attachments': return message.has_attachments || message.attachments.length > 0
    case 'is_read': return message.is_read
    case 'is_archived': return message.is_archived
    case 'is_trashed': return message.is_provider_trashed
    default: return false
  }
}

function numbersForField(message: AutomationMessage, field: AutomationFieldId): number[] {
  if (field === 'attachment_size_kb') {
    return message.attachments
      .map((item) => (typeof item.size_bytes === 'number' ? item.size_bytes / 1024 : Number.NaN))
      .filter((value) => Number.isFinite(value))
  }

  return []
}

function matchesText(haystack: string, step: AutomationConditionStep): boolean {
  const subject = step.caseSensitive ? haystack : haystack.toLowerCase()
  const needle = step.caseSensitive ? step.value : step.value.toLowerCase()

  switch (step.operator) {
    case 'has_value': return subject.trim().length > 0
    case 'is_empty': return subject.trim().length === 0
    case 'exact_match': return subject.trim() === needle.trim()
    case 'starts_with': return subject.startsWith(needle)
    case 'ends_with': return subject.endsWith(needle)
    case 'contains_characters': return needle.length > 0 && subject.includes(needle)
    case 'not_contains': return needle.length === 0 || !subject.includes(needle)
    case 'contains_words': {
      const words = needle.split(/\s+/).filter(Boolean)
      if (words.length === 0) return false
      // Word mode requires every listed word to appear as a standalone token.
      const tokens = new Set(subject.split(/[^\p{L}\p{N}]+/u).filter(Boolean))
      return words.every((word) => tokens.has(word))
    }
    default: return false
  }
}

function evaluateCondition(message: AutomationMessage, step: AutomationConditionStep): boolean {
  // An assessment check is satisfied by its AI score alone; there is no text to compare.
  if (step.field === 'assessment') {
    const score = message.assessmentScores?.[step.id] ?? message.assessment_score
    if (typeof score !== 'number') return false
    return score >= (step.assessmentScoreThreshold ?? 0.8)
  }

  if (BOOLEAN_FIELDS.has(step.field)) {
    const actual = booleanForField(message, step.field)
    return step.operator === 'is_true' ? actual : !actual
  }

  if (NUMERIC_FIELDS.has(step.field)) {
    const values = numbersForField(message, step.field)
    if (step.operator === 'has_value') return values.length > 0
    const threshold = Number(step.value)
    if (!Number.isFinite(threshold)) return false
    if (step.operator === 'greater_than') return values.some((value) => value > threshold)
    if (step.operator === 'less_than') return values.some((value) => value < threshold)
    if (step.operator === 'exact_match') return values.some((value) => Math.round(value) === Math.round(threshold))
    return false
  }

  const candidates = textForField(message, step.field)
  // Negations must hold for every candidate; positives only need one hit.
  if (step.operator === 'not_contains' || step.operator === 'is_empty') {
    return candidates.length === 0 || candidates.every((value) => matchesText(value, step))
  }
  return candidates.some((value) => matchesText(value, step))
}

/**
 * A "Receive action" step matches when its action was already applied to the
 * message. Manual occurrences always count; automation-caused ones only
 * count when the step opts into recursion, so one rule's output does not
 * silently retrigger another unless the user explicitly allows it.
 */
function evaluateReceiveAction(message: AutomationMessage, step: AutomationReceiveActionStep): boolean {
  return message.recentActionEvents.some((event) => {
    const matchesImportedJunk = step.action === 'junk'
      && event.action === 'import_junk' && event.source === 'import'
    if (event.action !== step.action && !matchesImportedJunk) return false
    if (actionUsesTagValue(step.action) && step.value && event.value !== step.value) return false
    if (event.source === 'manual' || event.source === 'import') return true
    return step.allowRecursion
  })
}

function evaluateTriggerStep(message: AutomationMessage, step: AutomationConditionStep | AutomationReceiveActionStep): boolean {
  return step.kind === 'condition' ? evaluateCondition(message, step) : evaluateReceiveAction(message, step)
}

/**
 * True when the rule's non-assessment steps already settle whether it
 * matches, so an AI assessment call would not change the outcome. Callers
 * use this to skip assessment steps for a rule instead of scoring every
 * message against every AI check up front.
 */
export function cheapConditionsDecideRule(rule: AutomationRuleDefinition, message: AutomationMessage): boolean {
  const cheapSteps = rule.steps.filter(
    (step): step is AutomationConditionStep | AutomationReceiveActionStep =>
      (step.kind === 'condition' || step.kind === 'receive_action') && step.enabled &&
      !(step.kind === 'condition' && step.field === 'assessment'),
  )
  if (cheapSteps.length === 0) return false

  const results = cheapSteps.map((step) => evaluateTriggerStep(message, step))
  // "All" mode is already broken by one failure; "any" mode is already satisfied by one pass.
  return rule.match === 'any' ? results.some(Boolean) : results.some((passed) => !passed)
}

export interface AutomationConditionResult {
  stepId: string
  kind: 'condition' | 'receive_action'
  field: AutomationFieldId | null
  action: AutomationReceiveActionType | null
  passed: boolean
}

export interface AutomationRuleMatch {
  matched: boolean
  evaluatedConditions: number
  /** How many enabled trigger steps passed for this message. */
  passedConditions: number
  /** 0..1 share of the rule the message satisfies, reported for every message. */
  confidence: number
  /** Per-step outcome, so a preview can explain why a message did or did not match. */
  conditionResults: AutomationConditionResult[]
  actions: AutomationActionStep[]
  deferredActions: AutomationActionStep[]
}

export function evaluateAutomationRule(rule: AutomationRuleDefinition, message: AutomationMessage): AutomationRuleMatch {
  const conditions = rule.steps.filter(
    (step): step is AutomationConditionStep | AutomationReceiveActionStep =>
      (step.kind === 'condition' || step.kind === 'receive_action') && step.enabled,
  )
  const actions = rule.steps.filter(
    (step): step is AutomationActionStep => step.kind === 'action' && step.enabled,
  )

  const results = conditions.map((step) => evaluateTriggerStep(message, step))
  const passedConditions = results.filter(Boolean).length

  // A rule with no active condition would apply to every message, so treat it as inert.
  const matched = conditions.length > 0 && (rule.match === 'any'
    ? passedConditions > 0
    : passedConditions === conditions.length)

  // "Any" mode is satisfied by a single passing check, so a partial share would understate it.
  const confidence = conditions.length === 0
    ? 0
    : rule.match === 'any'
      ? (matched ? 1 : 0)
      : passedConditions / conditions.length

  return {
    matched,
    evaluatedConditions: conditions.length,
    passedConditions,
    confidence,
    conditionResults: conditions.map((step, index) => ({
      stepId: step.id,
      kind: step.kind,
      field: step.kind === 'condition' ? step.field : null,
      action: step.kind === 'receive_action' ? step.action : null,
      passed: results[index],
    })),
    actions: matched ? actions.filter((step) => EXECUTABLE_AUTOMATION_ACTIONS.includes(step.action)) : [],
    deferredActions: matched ? actions.filter((step) => DEFERRED_AUTOMATION_ACTIONS.includes(step.action)) : [],
  }
}
