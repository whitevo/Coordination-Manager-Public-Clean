/**
 * Translation layer between the mailbox AI assistant and the automation rule
 * builder. The assistant reads the open email plus the visible list, proposes a
 * rule, and asks for a preview run. Everything it returns is untrusted text, so
 * this module rebuilds a well-formed draft and enforces the safety envelope:
 * the assistant may never activate a rule and may never request a live run.
 */

import {
  AUTOMATION_ACTION_LABELS,
  AUTOMATION_FIELD_LABELS,
  AUTOMATION_RECEIVE_ACTION_LABELS,
  DEFERRED_AUTOMATION_ACTIONS,
  EXECUTABLE_AUTOMATION_ACTIONS,
  RECEIVABLE_AUTOMATION_ACTIONS,
  MAX_AUTOMATION_STEPS,
  actionNeedsTag,
  allowedOperatorsForField,
  buildActionStep,
  buildConditionStep,
  buildReceiveActionStep,
  operatorNeedsValue,
  renumberSteps,
  validateAutomationRule,
  type AutomationActionStep,
  type AutomationActionType,
  type AutomationConditionStep,
  type AutomationFieldId,
  type AutomationOperator,
  type AutomationReceiveActionStep,
  type AutomationReceiveActionType,
  type AutomationRuleDefinition,
  type AutomationStep,
  type AutomationValidationIssue,
} from './mailbox-automation'

// ── Context sent to the model ──────────────────────────────────────────────────

export interface MailboxAssistantTag {
  id: string
  label: string
}

export interface MailboxAssistantAccount {
  id: string
  address: string
  provider: string
  identity_group: string
}

export interface MailboxAssistantSavedRule {
  id: string
  name: string
  mode: string
  assessmentChecks?: Array<{
    context: string
    intent: string
    scoreThreshold: number
  }>
}

export interface MailboxAssistantMessageInput {
  id: string
  subject: string | null
  from_email: string | null
  from_name: string | null
  to_emails: string | null
  assessment_intent?: string | null
  assessment_context?: string | null
  preview: string | null
  has_attachments?: boolean
  is_read?: boolean
  user_tag_ids?: string[]
}

export interface MailboxAssistantOpenEmailInput extends MailboxAssistantMessageInput {
  body_text?: string | null
}

export interface MailboxAssistantStateInput {
  openEmail: MailboxAssistantOpenEmailInput | null
  visibleMessages: MailboxAssistantMessageInput[]
  tags: MailboxAssistantTag[]
  draft: AutomationRuleDefinition | null
  savedRules: MailboxAssistantSavedRule[]
  connectedAccounts?: MailboxAssistantAccount[]
}

export interface MailboxAssistantState {
  openEmail: Record<string, unknown> | null
  visibleMessageCount: number
  visibleMessages: Array<Record<string, unknown>>
  tags: MailboxAssistantTag[]
  currentDraft: AutomationRuleDefinition | null
  savedRules: MailboxAssistantSavedRule[]
  connectedAccounts: MailboxAssistantAccount[]
  capabilities: {
    fields: AutomationFieldId[]
    actions: AutomationActionType[]
    deferredActions: AutomationActionType[]
    receiveActions: AutomationReceiveActionType[]
    canActivateRules: false
    canRunLive: false
    runScopes: ['visible']
  }
}

/** Keeps the prompt payload small enough that a long inbox cannot blow the token budget. */
const MAX_VISIBLE_SAMPLE = 25
const MAX_PREVIEW_CHARS = 300
const MAX_BODY_CHARS = 2000

function trim(value: string | null | undefined, max: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, max)
}

function summarizeMessage(message: MailboxAssistantMessageInput): Record<string, unknown> {
  return {
    id: message.id,
    subject: trim(message.subject, 200),
    from_email: trim(message.from_email, 200),
    from_name: trim(message.from_name, 120),
    to_emails: trim(message.to_emails, 300),
    assessment_context: trim(message.assessment_context, 1000),
    assessment_intent: trim(message.assessment_intent, 500),
    preview: trim(message.preview, MAX_PREVIEW_CHARS),
    has_attachments: Boolean(message.has_attachments),
    is_read: Boolean(message.is_read),
    user_tag_ids: Array.isArray(message.user_tag_ids) ? message.user_tag_ids : [],
  }
}

export function buildMailboxAssistantState(input: MailboxAssistantStateInput): MailboxAssistantState {
  return {
    openEmail: input.openEmail
      ? { ...summarizeMessage(input.openEmail), body_text: trim(input.openEmail.body_text, MAX_BODY_CHARS) }
      : null,
    visibleMessageCount: input.visibleMessages.length,
    visibleMessages: input.visibleMessages.slice(0, MAX_VISIBLE_SAMPLE).map(summarizeMessage),
    tags: input.tags.map((tag) => ({ id: tag.id, label: tag.label })),
    currentDraft: input.draft,
    savedRules: input.savedRules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      mode: rule.mode,
      assessmentChecks: (rule.assessmentChecks || []).map((check) => ({
        context: trim(check.context, 1000),
        intent: trim(check.intent, 500),
        scoreThreshold: Math.min(1, Math.max(0, check.scoreThreshold)),
      })),
    })),
    connectedAccounts: (input.connectedAccounts || []).map((account) => ({
      id: account.id,
      address: account.address,
      provider: account.provider,
      identity_group: account.identity_group,
    })),
    capabilities: {
      fields: Object.keys(AUTOMATION_FIELD_LABELS) as AutomationFieldId[],
      actions: [...EXECUTABLE_AUTOMATION_ACTIONS],
      deferredActions: [...DEFERRED_AUTOMATION_ACTIONS],
      receiveActions: [...RECEIVABLE_AUTOMATION_ACTIONS],
      canActivateRules: false,
      canRunLive: false,
      runScopes: ['visible'],
    },
  }
}

// ── Plan returned to the page ──────────────────────────────────────────────────

export interface MailboxAssistantRunPlan {
  scope: 'visible' | 'none'
  /** The assistant is trial-run only, so this is never false. */
  dryRun: true
}

export interface MailboxAssistantPlan {
  rule: AutomationRuleDefinition | null
  run: MailboxAssistantRunPlan
  explanation: string
  /** Human-readable adjustments made while sanitizing the model output. */
  notes: string[]
  issues: AutomationValidationIssue[]
}

export interface MailboxAssistantPlanContext {
  tags: MailboxAssistantTag[]
  fallbackName: string
  currentDraft: AutomationRuleDefinition | null
}

const VALID_FIELDS = new Set(Object.keys(AUTOMATION_FIELD_LABELS) as AutomationFieldId[])
const VALID_ACTIONS = new Set<AutomationActionType>([
  ...EXECUTABLE_AUTOMATION_ACTIONS,
  ...DEFERRED_AUTOMATION_ACTIONS,
])

function readText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const stripped = Array.from(value)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0
      return code > 31 && code !== 127
    })
    .join('')
  return stripped.trim().slice(0, max)
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Models refer to tags by label as often as by id, so both are accepted. */
export function resolveAssistantTagId(value: string, tags: MailboxAssistantTag[]): string | null {
  if (!value) return null
  const byId = tags.find((tag) => tag.id === value)
  if (byId) return byId.id
  const target = slug(value)
  const byLabel = tags.find((tag) => slug(tag.label) === target)
  return byLabel ? byLabel.id : null
}

function normalizeStep(
  raw: unknown,
  index: number,
  tags: MailboxAssistantTag[],
  notes: string[],
): AutomationStep | null {
  if (!raw || typeof raw !== 'object') return null
  const entry = raw as Record<string, unknown>
  const enabled = readBoolean(entry.enabled, true)

  if (entry.kind === 'receive_action') {
    const action = readText(entry.action, 40) as AutomationReceiveActionType
    if (!RECEIVABLE_AUTOMATION_ACTIONS.includes(action)) {
      notes.push(`Skipped unsupported "receive action" trigger "${readText(entry.action, 40) || 'unknown'}".`)
      return null
    }

    const base: AutomationReceiveActionStep = {
      ...buildReceiveActionStep(index),
      enabled,
      action,
      value: '',
      // Import triggers are explicit system events; recursion only applies to executable actions caused by rules.
      allowRecursion: action.startsWith('import_') ? false : readBoolean(entry.allowRecursion, false),
    }
    if (actionNeedsTag(action)) {
      const requested = readText(entry.value ?? entry.tag ?? entry.tagLabel, 120)
      const tagId = resolveAssistantTagId(requested, tags)
      if (!tagId) {
        notes.push(`No mailbox tag matches "${requested || 'unnamed tag'}" for the "received" trigger.`)
      }
      return { ...base, value: tagId || '' }
    }
    return base
  }

  if (entry.kind === 'action' || typeof entry.action === 'string') {
    const action = readText(entry.action, 40) as AutomationActionType
    if (!VALID_ACTIONS.has(action)) {
      notes.push(`Skipped unsupported action "${readText(entry.action, 40) || 'unknown'}".`)
      return null
    }

    const base: AutomationActionStep = {
      ...buildActionStep(index), enabled, action, value: '',
      ...(action === 'agent_prompt' ? {
        agentContext: readText(entry.agentContext ?? entry.context, 2000),
        agentIntent: readText(entry.agentIntent ?? entry.intent, 1000),
      } : {}),
    }
    if (actionNeedsTag(action)) {
      const requested = readText(entry.value ?? entry.tag ?? entry.tagLabel, 120)
      const tagId = resolveAssistantTagId(requested, tags)
      if (!tagId) {
        notes.push(`No mailbox tag matches "${requested || 'unnamed tag'}" -- pick or create one before saving.`)
      }
      return { ...base, value: tagId || '' }
    }
    return { ...base, value: readText(entry.value, 2000) }
  }

  const field = readText(entry.field, 40) as AutomationFieldId
  if (!VALID_FIELDS.has(field)) {
    notes.push(`Skipped check on unknown field "${readText(entry.field, 40) || 'unknown'}".`)
    return null
  }

  const operators = allowedOperatorsForField(field)
  const requestedOperator = readText(entry.operator, 40) as AutomationOperator
  const operator = operators.includes(requestedOperator) ? requestedOperator : operators[0]
  if (operator !== requestedOperator) {
    notes.push(`Operator for ${AUTOMATION_FIELD_LABELS[field]} changed to "${operator}" because "${requestedOperator || 'none'}" does not apply to that field.`)
  }

  const step: AutomationConditionStep = {
    ...buildConditionStep(index),
    enabled,
    field,
    operator,
    value: '',
    caseSensitive: readBoolean(entry.caseSensitive, false),
    ...(field === 'assessment' ? {
      assessmentContext: readText(entry.assessmentContext ?? entry.context, 2000),
      assessmentIntent: readText(entry.assessmentIntent ?? entry.intent, 1000),
      assessmentScoreThreshold: Number.isFinite(Number(entry.assessmentScoreThreshold ?? entry.protectionScore ?? 0.8))
        ? Math.min(1, Math.max(0, Number(entry.assessmentScoreThreshold ?? entry.protectionScore ?? 0.8)))
        : 0.8,
    } : {}),
  }

  if (field === 'assessment') return step
  if (!operatorNeedsValue(operator)) return step
  if (field === 'tag') {
    const requested = readText(entry.value, 120)
    const tagId = resolveAssistantTagId(requested, tags)
    if (!tagId) notes.push(`No mailbox tag matches "${requested || 'unnamed tag'}" for the tag check.`)
    return { ...step, value: tagId || '' }
  }
  return { ...step, value: readText(entry.value, 500) }
}

/**
 * Rebuilds an assistant response into a draft the rule editor can render.
 * Returns rule: null when the model only replied with prose.
 */
export function parseMailboxAssistantPlan(
  payload: unknown,
  context: MailboxAssistantPlanContext,
): MailboxAssistantPlan {
  const notes: string[] = []
  const data = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const explanation = readText(data.explanation, 4000)

  const runRaw = data.run && typeof data.run === 'object' ? (data.run as Record<string, unknown>) : {}
  const requestedScope = readText(runRaw.scope, 20)
  if (requestedScope === 'all') {
    notes.push('The assistant can only preview against the emails currently visible, so the run was limited to those.')
  }
  if (readBoolean(runRaw.dryRun, true) === false) {
    notes.push('The assistant runs in preview only; nothing was changed in your mailbox.')
  }

  const ruleRaw = data.rule && typeof data.rule === 'object' ? (data.rule as Record<string, unknown>) : null
  if (!ruleRaw) {
    return { rule: null, run: { scope: 'none', dryRun: true }, explanation, notes, issues: [] }
  }

  const requestedMode = readText(ruleRaw.mode, 20)
  if (requestedMode === 'active') {
    notes.push('The rule was kept in Dry run. Switch it to Active yourself once the preview looks right.')
  }
  const mode = requestedMode === 'disabled' ? 'disabled' : 'dry_run'

  const rawSteps = Array.isArray(ruleRaw.steps) ? ruleRaw.steps.slice(0, MAX_AUTOMATION_STEPS) : []
  const steps = rawSteps
    .map((step, index) => normalizeStep(step, index, context.tags, notes))
    .filter((step): step is AutomationStep => step !== null)

  const rule: AutomationRuleDefinition = {
    name: readText(ruleRaw.name, 120) || context.currentDraft?.name || context.fallbackName,
    mode,
    stopProcessing: readBoolean(ruleRaw.stopProcessing, false),
    match: readText(ruleRaw.match, 10) === 'any' ? 'any' : 'all',
    steps: renumberSteps(steps),
  }

  const issues = validateAutomationRule(rule)
  const scope: MailboxAssistantRunPlan['scope'] =
    issues.length === 0 && readText(runRaw.scope, 20) !== 'none' ? 'visible' : 'none'

  return { rule, run: { scope, dryRun: true }, explanation, notes, issues }
}

/** One-line description of the draft, used in the assistant's chat reply. */
export function describeAssistantRule(rule: AutomationRuleDefinition, tags: MailboxAssistantTag[]): string {
  const labelForTag = (id: string) => tags.find((tag) => tag.id === id)?.label || 'no tag'
  const conditions = rule.steps.filter((step): step is AutomationConditionStep => step.kind === 'condition')
  const receiveActions = rule.steps.filter((step): step is AutomationReceiveActionStep => step.kind === 'receive_action')
  const actions = rule.steps.filter((step): step is AutomationActionStep => step.kind === 'action')

  const triggerText = [...conditions, ...receiveActions]
    .map((step) => (step.kind === 'receive_action'
      ? `${AUTOMATION_RECEIVE_ACTION_LABELS[step.action]}${actionNeedsTag(step.action) ? `: ${labelForTag(step.value)}` : ''}`
      : `${AUTOMATION_FIELD_LABELS[step.field]} ${step.operator}${operatorNeedsValue(step.operator) ? ` "${step.value}"` : ''}`))
    .join(rule.match === 'any' ? ' or ' : ' and ')

  const actionText = actions
    .map((step) => (actionNeedsTag(step.action)
      ? `${AUTOMATION_ACTION_LABELS[step.action]}: ${labelForTag(step.value)}`
      : AUTOMATION_ACTION_LABELS[step.action]))
    .join(', ')

  return `"${rule.name}" -- when ${triggerText || 'no check yet'} then ${actionText || 'no action yet'}.`
}
