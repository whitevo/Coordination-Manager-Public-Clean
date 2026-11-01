import { describe, expect, it } from 'vitest'
import {
  allowedOperatorsForField,
  buildActionStep,
  buildConditionStep,
  buildEmptyAutomationRule,
  buildReceiveActionStep,
  describeAutomationStep,
  moveAutomationStep,
  operatorNeedsValue,
  validateAutomationRule,
  withConditionField,
  type AutomationRuleDefinition,
} from '../mailbox-automation'

const resolveTagLabel = (tagId: string) => (tagId === 'tag-1' ? 'Invoices' : 'Unknown tag')

describe('buildEmptyAutomationRule', () => {
  it('starts in dry run with one check and one action', () => {
    const rule = buildEmptyAutomationRule('Rule 1')
    expect(rule.mode).toBe('dry_run')
    expect(rule.steps.map((step) => step.kind)).toEqual(['condition', 'action'])
  })
})

describe('withConditionField', () => {
  it('keeps a compatible operator and its value', () => {
    const step = { ...buildConditionStep(0), operator: 'contains_words' as const, value: 'invoice' }
    const next = withConditionField(step, 'subject')
    expect(next.operator).toBe('contains_words')
    expect(next.value).toBe('invoice')
  })

  it('coerces an incompatible operator and clears the stale value', () => {
    const step = { ...buildConditionStep(0), operator: 'contains_words' as const, value: 'invoice' }
    const next = withConditionField(step, 'has_attachments')
    expect(next.operator).toBe('is_true')
    expect(next.value).toBe('')
    expect(allowedOperatorsForField('has_attachments')).toEqual(['is_true', 'is_false'])
  })
})

describe('moveAutomationStep', () => {
  it('reorders and renumbers positions', () => {
    const steps = [buildConditionStep(0), buildActionStep(1), buildConditionStep(2)]
    const moved = moveAutomationStep(steps, steps[2].id, -1)
    expect(moved.map((step) => step.id)).toEqual([steps[0].id, steps[2].id, steps[1].id])
    expect(moved.map((step) => step.position)).toEqual([0, 1, 2])
  })

  it('ignores moves that fall outside the list', () => {
    const steps = [buildConditionStep(0), buildActionStep(1)]
    expect(moveAutomationStep(steps, steps[0].id, -1)).toBe(steps)
    expect(moveAutomationStep(steps, steps[1].id, 1)).toBe(steps)
  })
})

describe('operatorNeedsValue', () => {
  it('is false for presence and boolean operators', () => {
    expect(operatorNeedsValue('has_value')).toBe(false)
    expect(operatorNeedsValue('is_empty')).toBe(false)
    expect(operatorNeedsValue('is_true')).toBe(false)
    expect(operatorNeedsValue('contains_words')).toBe(true)
  })
})

describe('validateAutomationRule', () => {
  function buildRule(overrides: Partial<AutomationRuleDefinition> = {}): AutomationRuleDefinition {
    return { ...buildEmptyAutomationRule('Rule'), ...overrides }
  }

  it('flags a rule with no enabled check', () => {
    const rule = buildRule({ steps: [buildActionStep(0)] })
    expect(validateAutomationRule(rule).some((issue) => issue.message.includes('enabled check'))).toBe(true)
  })

  it('flags a check that is missing its comparison value', () => {
    const condition = { ...buildConditionStep(0), operator: 'contains_words' as const, value: '' }
    const rule = buildRule({ steps: [condition, buildActionStep(1)] })
    const issue = validateAutomationRule(rule).find((entry) => entry.stepId === condition.id)
    expect(issue?.message).toContain('needs a value')
  })

  it('flags a tag action with no tag selected', () => {
    const condition = { ...buildConditionStep(0), operator: 'has_value' as const }
    const action = { ...buildActionStep(1), action: 'add_tag' as const, value: '' }
    const rule = buildRule({ steps: [condition, action] })
    expect(validateAutomationRule(rule).find((entry) => entry.stepId === action.id)?.message).toContain('needs a tag')
  })

  it('passes a complete rule', () => {
    const condition = { ...buildConditionStep(0), operator: 'contains_words' as const, value: 'invoice' }
    const action = { ...buildActionStep(1), action: 'add_tag' as const, value: 'tag-1' }
    expect(validateAutomationRule(buildRule({ steps: [condition, action] }))).toEqual([])
  })

  it('ignores disabled steps when checking for missing values', () => {
    const condition = { ...buildConditionStep(0), operator: 'has_value' as const }
    const broken = { ...buildActionStep(1), action: 'add_tag' as const, value: '', enabled: false }
    const action = { ...buildActionStep(2), action: 'archive' as const, value: '' }
    expect(validateAutomationRule(buildRule({ steps: [condition, broken, action] }))).toEqual([])
  })
})

describe('describeAutomationStep', () => {
  it('renders the value only when the operator uses one', () => {
    const withValue = { ...buildConditionStep(0), field: 'subject' as const, operator: 'contains_words' as const, value: 'invoice' }
    expect(describeAutomationStep(withValue, resolveTagLabel)).toBe('Subject contains words "invoice"')

    const withoutValue = { ...buildConditionStep(0), field: 'subject' as const, operator: 'has_value' as const }
    expect(describeAutomationStep(withoutValue, resolveTagLabel)).toBe('Subject has any value')
  })

  it('resolves tag labels for tag actions', () => {
    const action = { ...buildActionStep(0), action: 'add_tag' as const, value: 'tag-1' }
    expect(describeAutomationStep(action, resolveTagLabel)).toBe('Add tag: Invoices')

    const empty = { ...buildActionStep(0), action: 'add_tag' as const, value: '' }
    expect(describeAutomationStep(empty, resolveTagLabel)).toBe('Add tag: no tag selected')
  })

  it('notes whether a receive_action step reacts to automation-caused occurrences', () => {
    const manualOnly = buildReceiveActionStep(0)
    expect(describeAutomationStep(manualOnly, resolveTagLabel)).toContain('manual or provider import/sync')

    const recursive = { ...buildReceiveActionStep(0), allowRecursion: true }
    expect(describeAutomationStep(recursive, resolveTagLabel)).toContain('including by automation')
  })

  it('describes provider import triggers without manual or recursion wording', () => {
    const imported = { ...buildReceiveActionStep(0), action: 'import_junk' as const }
    expect(describeAutomationStep(imported, resolveTagLabel)).toBe('Import junk')
  })
})

describe('buildReceiveActionStep', () => {
  it('defaults to junk with recursion off', () => {
    const step = buildReceiveActionStep(0)
    expect(step.kind).toBe('receive_action')
    expect(step.action).toBe('junk')
    expect(step.allowRecursion).toBe(false)
  })
})
