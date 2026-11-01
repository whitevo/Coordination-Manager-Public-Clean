/**
 * Client-side mirror of the mailbox automation schema in
 * apps/api/src/services/mailbox-automation.ts. The API re-validates every
 * payload, so this module only needs to build well-formed rules and label them.
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

/** A trigger step that matches once `action` has already been applied to the message. */
export interface AutomationReceiveActionStep {
  id: string
  kind: 'receive_action'
  position: number
  enabled: boolean
  action: AutomationReceiveActionType
  value: string
  /** When off, only manual occurrences of the action count -- automation-caused ones are ignored. */
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

export interface AutomationRuleRecord {
  id: string
  account_id: string | null
  name: string
  mode: AutomationRuleMode
  stop_processing: boolean
  created_at: string
  definition: AutomationRuleDefinition
}

export interface AutomationRunMatch {
  rule_id: string
  rule_name: string
  message_id: string
  subject: string | null
  applied: string[]
  deferred: string[]
  errors: string[]
}

/** One entry per checked email, matched or not, so a preview can show every score. */
export interface AutomationRunEvaluation {
  message_id: string
  subject: string | null
  matched: boolean
  /** 0..1 share of the best-scoring rule that this email satisfies. */
  confidence: number
  rule_id: string | null
  rule_name: string | null
  applied: string[]
  deferred: string[]
  errors: string[]
  checks?: Array<{
    step_id: string
    kind: 'condition' | 'receive_action'
    field: AutomationFieldId | null
    action: AutomationReceiveActionType | null
    passed: boolean
  }>
  assessments?: Array<{
    step_id: string
    score: number
    reasoning: string
    available: boolean
    input_summary: { hasBody: boolean; bodyChars: number; hasContext: boolean; hasIntent: boolean }
  }>
}

export interface AutomationRunResult {
  dry_run: boolean
  evaluated_messages: number
  matches: AutomationRunMatch[]
  /** Absent on responses from an API build older than per-message scoring. */
  evaluations?: AutomationRunEvaluation[]
  summary: { matched: number; applied: number; deferred: number }
}

export const MAX_AUTOMATION_STEPS = 40
export const MAX_AUTOMATION_RULES = 50

export const AUTOMATION_FIELD_LABELS: Record<AutomationFieldId, string> = {
  from_email: 'Sender email',
  from_name: 'Sender name',
  to_emails: 'Recipients (To)',
  cc_emails: 'Recipients (Cc)',
  subject: 'Subject',
  body: 'Body text',
  assessment: 'Assessment',
  account_address: 'Receiving account',
  identity_group: 'Identity group',
  has_attachments: 'Has attachments',
  attachment_name: 'Attachment name',
  attachment_format: 'Attachment format',
  attachment_size_kb: 'Attachment size (KB)',
  is_read: 'Is read',
  is_archived: 'Is archived',
  is_trashed: 'Is trashed',
  tag: 'Applied tag',
}

export const AUTOMATION_FIELD_GROUPS: Array<{ label: string; fields: AutomationFieldId[] }> = [
  { label: 'People', fields: ['from_email', 'to_emails', 'cc_emails'] },
  { label: 'Content', fields: ['subject', 'body'] },
  { label: 'Agent', fields: ['assessment'] },
  { label: 'Attachments', fields: ['has_attachments', 'attachment_name', 'attachment_format', 'attachment_size_kb'] },
  { label: 'State', fields: ['is_read', 'is_archived', 'is_trashed', 'tag'] },
  { label: 'Account', fields: ['account_address', 'identity_group'] },
]

export const AUTOMATION_OPERATOR_LABELS: Record<AutomationOperator, string> = {
  contains_words: 'Contains words',
  contains_characters: 'Contains characters',
  not_contains: 'Does not contain',
  exact_match: 'Exact match',
  starts_with: 'Starts with',
  ends_with: 'Ends with',
  has_value: 'Has any value',
  is_empty: 'Is empty',
  is_true: 'Is yes',
  is_false: 'Is no',
  greater_than: 'Greater than',
  less_than: 'Less than',
}

export const AUTOMATION_ACTION_LABELS: Record<AutomationActionType, string> = {
  trash: 'Trash email',
  junk: 'Junk sender',
  archive: 'Archive email',
  unarchive: 'Unarchive email',
  mark_read: 'Mark as read',
  mark_unread: 'Mark as unread',
  add_tag: 'Add tag',
  remove_tag: 'Remove tag',
  reply: 'Draft reply with AI assistant',
  forward: 'Draft forward with AI assistant',
  agent_prompt: 'Prompt internal AI assistant',
}

/** Labels for the same actions when used as a "Receive action" trigger ("has been junked" rather than "junk it"). */
export const AUTOMATION_RECEIVE_ACTION_LABELS: Record<AutomationReceiveActionType, string> = {
  trash: 'Was trashed',
  junk: 'Was junked',
  archive: 'Was archived',
  unarchive: 'Was unarchived',
  mark_read: 'Was marked read',
  mark_unread: 'Was marked unread',
  add_tag: 'Had a tag added',
  remove_tag: 'Had a tag removed',
  reply: 'Was replied to',
  forward: 'Was forwarded',
  agent_prompt: 'Triggered internal AI assistant',
  import_junk: 'Import junk',
  import_trash: 'Import trash',
  import_archived: 'Import archived',
}

export const EXECUTABLE_AUTOMATION_ACTIONS: readonly AutomationActionType[] = [
  'trash', 'junk', 'archive', 'unarchive', 'mark_read', 'mark_unread', 'add_tag', 'remove_tag', 'agent_prompt',
]

export const DEFERRED_AUTOMATION_ACTIONS: readonly AutomationActionType[] = ['reply', 'forward']

/** Actions a "Receive action" step can match on -- the same ones that are actually executed. */
export const RECEIVABLE_AUTOMATION_ACTIONS: readonly AutomationReceiveActionType[] = [
  ...EXECUTABLE_AUTOMATION_ACTIONS,
  'import_junk',
  'import_trash',
  'import_archived',
]

const BOOLEAN_FIELDS: AutomationFieldId[] = ['has_attachments', 'is_read', 'is_archived', 'is_trashed']
const NUMERIC_FIELDS: AutomationFieldId[] = ['attachment_size_kb']

export function allowedOperatorsForField(field: AutomationFieldId): AutomationOperator[] {
  if (field === 'assessment') return ['has_value']
  if (BOOLEAN_FIELDS.includes(field)) return ['is_true', 'is_false']
  if (NUMERIC_FIELDS.includes(field)) return ['greater_than', 'less_than', 'exact_match', 'has_value']
  if (field === 'tag') return ['has_value', 'is_empty', 'exact_match', 'not_contains']
  return ['contains_words', 'contains_characters', 'not_contains', 'exact_match', 'starts_with', 'ends_with', 'has_value', 'is_empty']
}

/** True when the operator compares against a user-supplied value. */
export function operatorNeedsValue(operator: AutomationOperator): boolean {
  return operator !== 'has_value' && operator !== 'is_empty' && operator !== 'is_true' && operator !== 'is_false'
}

/** True when the action targets a mailbox tag rather than free text. */
export function actionNeedsTag(action: AutomationReceiveActionType): boolean {
  return action === 'add_tag' || action === 'remove_tag'
}

export function actionNeedsText(action: AutomationActionType): boolean {
  return action === 'reply' || action === 'forward' || action === 'agent_prompt'
}

function nextStepId(): string {
  return `step-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function buildConditionStep(position: number): AutomationConditionStep {
  return {
    id: nextStepId(),
    kind: 'condition',
    position,
    enabled: true,
    field: 'from_email',
    operator: 'contains_characters',
    value: '',
    caseSensitive: false,
  }
}

export function buildActionStep(position: number): AutomationActionStep {
  return { id: nextStepId(), kind: 'action', position, enabled: true, action: 'add_tag', value: '' }
}

export function buildReceiveActionStep(position: number): AutomationReceiveActionStep {
  return { id: nextStepId(), kind: 'receive_action', position, enabled: true, action: 'junk', value: '', allowRecursion: false }
}

export function buildEmptyAutomationRule(name: string): AutomationRuleDefinition {
  return {
    name,
    mode: 'dry_run',
    stopProcessing: false,
    match: 'all',
    steps: [buildConditionStep(0), buildActionStep(1)],
  }
}

const RUN_EXPLANATION_MAX_EMAILS = 10

/** Written account of a run, posted into the AI assistant so the user can question the scores. */
export function describeAutomationRunResult(result: AutomationRunResult): string {
  const rows = result.evaluations ?? []
  const lines = [
    `${result.dry_run ? 'Preview' : 'Run'} finished: ${result.summary.matched} of ${result.evaluated_messages} emails matched.`,
  ]

  for (const row of rows.slice(0, RUN_EXPLANATION_MAX_EMAILS)) {
    lines.push('')
    lines.push(`${row.subject || '(no subject)'} -- ${Math.round(row.confidence * 100)}%, ${row.matched ? 'matched' : 'not applied'}`)

    for (const check of row.checks || []) {
      const label = check.kind === 'receive_action'
        ? AUTOMATION_RECEIVE_ACTION_LABELS[check.action ?? 'trash']
        : AUTOMATION_FIELD_LABELS[check.field ?? 'subject']
      lines.push(`- ${check.passed ? 'passed' : 'failed'}: ${label}`)
    }

    for (const assessment of row.assessments || []) {
      lines.push(`- assessment scored ${Math.round(assessment.score * 100)}%: ${assessment.reasoning}`)
      if (!assessment.available) {
        lines.push('- no usable score came back, so the assessment check could not pass')
      } else if (!assessment.input_summary.hasBody) {
        lines.push('- the AI only saw the header fields; no body text was stored for this email')
      } else {
        lines.push(`- the AI read ${assessment.input_summary.bodyChars} characters of body text${assessment.input_summary.hasContext ? ' plus your context' : ' but no context was given'}`)
      }
    }
  }

  if (rows.length > RUN_EXPLANATION_MAX_EMAILS) {
    lines.push('')
    lines.push(`${rows.length - RUN_EXPLANATION_MAX_EMAILS} more emails are listed in the automation panel.`)
  }

  return lines.join('\n')
}

/** Reindexes positions so they always mirror array order. */
export function renumberSteps(steps: AutomationStep[]): AutomationStep[] {
  return steps.map((step, index) => ({ ...step, position: index }))}

export function moveAutomationStep(steps: AutomationStep[], stepId: string, offset: number): AutomationStep[] {
  const index = steps.findIndex((step) => step.id === stepId)
  const target = index + offset
  if (index < 0 || target < 0 || target >= steps.length) return steps

  const next = [...steps]
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved)
  return renumberSteps(next)
}

/** Switching field can invalidate the operator, so it is coerced to a legal one. */
export function withConditionField(step: AutomationConditionStep, field: AutomationFieldId): AutomationConditionStep {
  const operators = allowedOperatorsForField(field)
  const operator = operators.includes(step.operator) ? step.operator : operators[0]
  return { ...step, field, operator, value: operator === step.operator ? step.value : '' }
}

export function describeAutomationStep(step: AutomationStep, resolveTagLabel: (tagId: string) => string): string {
  if (step.kind === 'action') {
    if (actionNeedsTag(step.action)) return `${AUTOMATION_ACTION_LABELS[step.action]}: ${step.value ? resolveTagLabel(step.value) : 'no tag selected'}`
    return AUTOMATION_ACTION_LABELS[step.action]
  }

  if (step.kind === 'receive_action') {
    const label = actionNeedsTag(step.action) && step.value
      ? `${AUTOMATION_RECEIVE_ACTION_LABELS[step.action]} (${resolveTagLabel(step.value)})`
      : AUTOMATION_RECEIVE_ACTION_LABELS[step.action]
    if (step.action.startsWith('import_')) return label
    if (step.allowRecursion) return `${label} -- including by automation`
    return `${label} -- ${step.action === 'junk' ? 'manual or provider import/sync' : 'manually only'}`
  }

  const base = `${AUTOMATION_FIELD_LABELS[step.field]} ${AUTOMATION_OPERATOR_LABELS[step.operator].toLowerCase()}`
  return operatorNeedsValue(step.operator) ? `${base} "${step.value}"` : base
}

/** Pretty-printed JSON shown in the rule editor's JSON view. */
export function serializeAutomationRule(rule: AutomationRuleDefinition): string {
  return JSON.stringify(rule, null, 2)
}

/** Stable signature used to detect unsaved edits; step ids are excluded so they never count as changes. */
export function automationRuleFingerprint(rule: AutomationRuleDefinition): string {
  return JSON.stringify({
    name: rule.name.trim(),
    mode: rule.mode,
    stopProcessing: rule.stopProcessing,
    match: rule.match,
    steps: rule.steps.map((step) => (step.kind === 'condition'
      ? { k: 'c', p: step.position, e: step.enabled, f: step.field, o: step.operator, v: step.value, s: step.caseSensitive, c: step.assessmentContext, i: step.assessmentIntent, q: step.assessmentScoreThreshold }
      : step.kind === 'receive_action'
        ? { k: 'r', p: step.position, e: step.enabled, a: step.action, v: step.value, r: step.allowRecursion }
        : { k: 'a', p: step.position, e: step.enabled, a: step.action, v: step.value, c: step.agentContext, i: step.agentIntent })),
  })
}

export interface AutomationValidationIssue {
  stepId: string | null
  message: string
}

export function validateAutomationRule(rule: AutomationRuleDefinition): AutomationValidationIssue[] {
  const issues: AutomationValidationIssue[] = []
  if (!rule.name.trim()) issues.push({ stepId: null, message: 'Give the rule a name.' })

  const conditions = rule.steps.filter((step) => (step.kind === 'condition' || step.kind === 'receive_action') && step.enabled)
  const actions = rule.steps.filter((step) => step.kind === 'action' && step.enabled)
  if (conditions.length === 0) issues.push({ stepId: null, message: 'Add at least one enabled check, otherwise the rule never runs.' })
  if (actions.length === 0) issues.push({ stepId: null, message: 'Add at least one enabled action.' })

  for (const step of rule.steps) {
    if (!step.enabled) continue
    if (step.kind === 'condition' && step.field === 'assessment') {
      if (!step.assessmentContext?.trim()) issues.push({ stepId: step.id, message: 'Assessment needs a context prompt.' })
      if (!step.assessmentIntent?.trim()) issues.push({ stepId: step.id, message: 'Assessment needs an intent prompt.' })
    }
    if (step.kind === 'condition' && operatorNeedsValue(step.operator) && !step.value.trim()) {
      issues.push({ stepId: step.id, message: `${AUTOMATION_FIELD_LABELS[step.field]} needs a value to compare against.` })
    }
    if (step.kind === 'action' && step.action === 'agent_prompt') {
      if (!step.agentContext?.trim()) issues.push({ stepId: step.id, message: 'The AI assistant action needs a context prompt.' })
      if (!step.agentIntent?.trim()) issues.push({ stepId: step.id, message: 'The AI assistant action needs an intent prompt.' })
    }
    if (step.kind === 'action' && actionNeedsTag(step.action) && !step.value) {
      issues.push({ stepId: step.id, message: `${AUTOMATION_ACTION_LABELS[step.action]} needs a tag.` })
    }
    if (step.kind === 'receive_action' && actionNeedsTag(step.action) && !step.value) {
      issues.push({ stepId: step.id, message: `${AUTOMATION_RECEIVE_ACTION_LABELS[step.action]} needs a tag.` })
    }
  }

  return issues
}
