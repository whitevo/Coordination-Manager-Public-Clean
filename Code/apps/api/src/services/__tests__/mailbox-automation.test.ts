import { describe, expect, it } from 'vitest'
import {
  allowedOperatorsForField,
  evaluateAutomationRule,
  fromRuleColumns,
  normalizeAutomationRule,
  toRuleColumns,
  type AutomationMessage,
  type AutomationRuleDefinition,
} from '../mailbox-automation.js'

function buildMessage(overrides: Partial<AutomationMessage> = {}): AutomationMessage {
  return {
    id: 'msg-1',
    account_id: 'acc-1',
    from_email: 'invites@partner.com',
    from_name: 'Partner Team',
    to_emails: 'me@example.com',
    cc_emails: null,
    subject: 'Project kickoff invite',
    body_text: 'Please confirm the kickoff meeting.',
    preview: null,
    has_attachments: true,
    attachments: [{ filename: 'agenda.pdf', mime_type: 'application/pdf', size_bytes: 2048 }],
    is_read: false,
    is_archived: false,
    is_provider_trashed: false,
    user_tag_ids: [],
    account_address: 'me@example.com',
    identity_group: 'work',
    recentActionEvents: [],
    ...overrides,
  }
}

function buildRule(overrides: Partial<AutomationRuleDefinition> = {}): AutomationRuleDefinition {
  return {
    name: 'Kickoff triage',
    mode: 'active',
    stopProcessing: false,
    match: 'all',
    steps: [],
    ...overrides,
  }
}

describe('normalizeAutomationRule', () => {
  it('rejects payloads without a name', () => {
    expect(normalizeAutomationRule({ steps: [] })).toBeNull()
    expect(normalizeAutomationRule(null)).toBeNull()
  })

  it('defaults an unknown mode to dry run', () => {
    expect(normalizeAutomationRule({ name: 'Rule', mode: 'destroy' })?.mode).toBe('dry_run')
  })

  it('drops steps with unknown fields, operators, or actions', () => {
    const rule = normalizeAutomationRule({
      name: 'Rule',
      steps: [
        { kind: 'condition', field: 'subject', operator: 'contains_words', value: 'invite' },
        { kind: 'condition', field: 'secret_column', operator: 'contains_words', value: 'x' },
        { kind: 'condition', field: 'subject', operator: 'drop_table', value: 'x' },
        { kind: 'action', action: 'delete_account', value: '' },
        { kind: 'action', action: 'add_tag', value: 'tag-1' },
      ],
    })

    expect(rule?.steps).toHaveLength(2)
    expect(rule?.steps[0].kind).toBe('condition')
    expect(rule?.steps[1].kind).toBe('action')
  })

  it('rejects operators that do not apply to the field type', () => {
    const rule = normalizeAutomationRule({
      name: 'Rule',
      steps: [{ kind: 'condition', field: 'has_attachments', operator: 'contains_words', value: 'pdf' }],
    })

    expect(rule?.steps).toHaveLength(0)
    expect(allowedOperatorsForField('has_attachments')).toEqual(['is_true', 'is_false'])
  })

  it('renumbers positions so the stored order is contiguous', () => {
    const rule = normalizeAutomationRule({
      name: 'Rule',
      steps: [
        { kind: 'action', action: 'trash', position: 9 },
        { kind: 'condition', field: 'subject', operator: 'has_value', position: 4 },
      ],
    })

    expect(rule?.steps.map((step) => [step.kind, step.position])).toEqual([
      ['condition', 0],
      ['action', 1],
    ])
  })
})

describe('column round trip', () => {
  it('preserves interleaved step order through split storage', () => {
    const rule = normalizeAutomationRule({
      name: 'Rule',
      mode: 'active',
      match: 'any',
      steps: [
        { kind: 'condition', field: 'subject', operator: 'contains_words', value: 'invite' },
        { kind: 'action', action: 'add_tag', value: 'tag-1' },
        { kind: 'condition', field: 'has_attachments', operator: 'is_true' },
        { kind: 'action', action: 'archive' },
      ],
    })!

    const columns = toRuleColumns(rule)
    const restored = fromRuleColumns({
      name: rule.name,
      mode: rule.mode,
      stop_processing: rule.stopProcessing,
      conditions: columns.conditions,
      actions: columns.actions,
    })

    expect(restored.match).toBe('any')
    expect(restored.steps.map((step) => step.kind)).toEqual(['condition', 'action', 'condition', 'action'])
  })

  it('falls back to a disabled empty rule when stored JSON is unusable', () => {
    const restored = fromRuleColumns({
      name: '',
      mode: 'active',
      stop_processing: true,
      conditions: 'not-an-object',
      actions: null,
    })

    expect(restored.mode).toBe('disabled')
    expect(restored.steps).toHaveLength(0)
  })
})

describe('evaluateAutomationRule', () => {
  it('does not match when the rule has no enabled condition', () => {
    const rule = buildRule({ steps: [{ id: 'a', kind: 'action', position: 0, enabled: true, action: 'trash', value: '' }] })
    expect(evaluateAutomationRule(rule, buildMessage()).matched).toBe(false)
  })

  it('requires every condition in all mode', () => {
    const rule = buildRule({
      steps: [
        { id: 'c1', kind: 'condition', position: 0, enabled: true, field: 'subject', operator: 'contains_words', value: 'kickoff', caseSensitive: false },
        { id: 'c2', kind: 'condition', position: 1, enabled: true, field: 'from_email', operator: 'ends_with', value: 'other.com', caseSensitive: false },
      ],
    })

    expect(evaluateAutomationRule(rule, buildMessage()).matched).toBe(false)
    expect(evaluateAutomationRule({ ...rule, match: 'any' }, buildMessage()).matched).toBe(true)
  })

  it('matches whole words only for contains_words', () => {
    const rule = buildRule({
      steps: [{ id: 'c1', kind: 'condition', position: 0, enabled: true, field: 'subject', operator: 'contains_words', value: 'kick', caseSensitive: false }],
    })
    expect(evaluateAutomationRule(rule, buildMessage()).matched).toBe(false)

    const substring = buildRule({
      steps: [{ id: 'c1', kind: 'condition', position: 0, enabled: true, field: 'subject', operator: 'contains_characters', value: 'kick', caseSensitive: false }],
    })
    expect(evaluateAutomationRule(substring, buildMessage()).matched).toBe(true)
  })

  it('honours case sensitivity', () => {
    const rule = buildRule({
      steps: [{ id: 'c1', kind: 'condition', position: 0, enabled: true, field: 'subject', operator: 'contains_characters', value: 'Kickoff', caseSensitive: true }],
    })
    expect(evaluateAutomationRule(rule, buildMessage()).matched).toBe(false)
  })

  it('compares attachment size in kilobytes', () => {
    const rule = buildRule({
      steps: [{ id: 'c1', kind: 'condition', position: 0, enabled: true, field: 'attachment_size_kb', operator: 'greater_than', value: '1', caseSensitive: false }],
    })
    expect(evaluateAutomationRule(rule, buildMessage()).matched).toBe(true)

    const tooLarge = { ...rule, steps: [{ ...rule.steps[0], value: '10' }] } as AutomationRuleDefinition
    expect(evaluateAutomationRule(tooLarge, buildMessage()).matched).toBe(false)
  })

  it('reads the attachment extension for format checks', () => {
    const rule = buildRule({
      steps: [{ id: 'c1', kind: 'condition', position: 0, enabled: true, field: 'attachment_format', operator: 'exact_match', value: 'pdf', caseSensitive: false }],
    })
    expect(evaluateAutomationRule(rule, buildMessage()).matched).toBe(true)
  })

  it('requires not_contains to hold for every attachment', () => {
    const rule = buildRule({
      steps: [{ id: 'c1', kind: 'condition', position: 0, enabled: true, field: 'attachment_name', operator: 'not_contains', value: 'agenda', caseSensitive: false }],
    })

    const message = buildMessage({
      attachments: [
        { filename: 'notes.txt', mime_type: 'text/plain', size_bytes: 100 },
        { filename: 'agenda.pdf', mime_type: 'application/pdf', size_bytes: 100 },
      ],
    })

    expect(evaluateAutomationRule(rule, message).matched).toBe(false)
  })

  it('ignores disabled steps', () => {
    const rule = buildRule({
      steps: [
        { id: 'c1', kind: 'condition', position: 0, enabled: true, field: 'subject', operator: 'has_value', value: '', caseSensitive: false },
        { id: 'a1', kind: 'action', position: 1, enabled: false, action: 'trash', value: '' },
        { id: 'a2', kind: 'action', position: 2, enabled: true, action: 'archive', value: '' },
      ],
    })

    const result = evaluateAutomationRule(rule, buildMessage())
    expect(result.matched).toBe(true)
    expect(result.actions.map((step) => step.action)).toEqual(['archive'])
  })

  it('separates reply and forward into deferred actions', () => {
    const rule = buildRule({
      steps: [
        { id: 'c1', kind: 'condition', position: 0, enabled: true, field: 'subject', operator: 'has_value', value: '', caseSensitive: false },
        { id: 'a1', kind: 'action', position: 1, enabled: true, action: 'reply', value: 'Thanks' },
        { id: 'a2', kind: 'action', position: 2, enabled: true, action: 'junk', value: '' },
      ],
    })

    const result = evaluateAutomationRule(rule, buildMessage())
    expect(result.actions.map((step) => step.action)).toEqual(['junk'])
    expect(result.deferredActions.map((step) => step.action)).toEqual(['reply'])
  })
})

describe('receive_action steps', () => {
  it('matches a manual occurrence of the action regardless of allowRecursion', () => {
    const rule = buildRule({
      steps: [
        { id: 'r1', kind: 'receive_action', position: 0, enabled: true, action: 'junk', value: '', allowRecursion: false },
        { id: 'a1', kind: 'action', position: 1, enabled: true, action: 'trash', value: '' },
      ],
    })

    const message = buildMessage({ recentActionEvents: [{ action: 'junk', value: '', source: 'manual', ruleId: null }] })
    expect(evaluateAutomationRule(rule, message).matched).toBe(true)
  })

  it('ignores a rule-caused occurrence when allowRecursion is off', () => {
    const rule = buildRule({
      steps: [
        { id: 'r1', kind: 'receive_action', position: 0, enabled: true, action: 'junk', value: '', allowRecursion: false },
        { id: 'a1', kind: 'action', position: 1, enabled: true, action: 'trash', value: '' },
      ],
    })

    const message = buildMessage({ recentActionEvents: [{ action: 'junk', value: '', source: 'rule', ruleId: 'rule-other' }] })
    expect(evaluateAutomationRule(rule, message).matched).toBe(false)
  })

  it('matches a rule-caused occurrence when allowRecursion is on', () => {
    const rule = buildRule({
      steps: [
        { id: 'r1', kind: 'receive_action', position: 0, enabled: true, action: 'junk', value: '', allowRecursion: true },
        { id: 'a1', kind: 'action', position: 1, enabled: true, action: 'trash', value: '' },
      ],
    })

    const message = buildMessage({ recentActionEvents: [{ action: 'junk', value: '', source: 'rule', ruleId: 'rule-other' }] })
    expect(evaluateAutomationRule(rule, message).matched).toBe(true)
  })

  it('matches imported Junk with Was junked while keeping Import junk provider-only', () => {
    const importRule = buildRule({
      steps: [
        { id: 'r1', kind: 'receive_action', position: 0, enabled: true, action: 'import_junk', value: '', allowRecursion: false },
        { id: 'a1', kind: 'action', position: 1, enabled: true, action: 'trash', value: '' },
      ],
    })
    const manualRule = buildRule({
      steps: [
        { id: 'r1', kind: 'receive_action', position: 0, enabled: true, action: 'junk', value: '', allowRecursion: false },
        { id: 'a1', kind: 'action', position: 1, enabled: true, action: 'trash', value: '' },
      ],
    })
    const importedMessage = buildMessage({
      recentActionEvents: [{ action: 'import_junk', value: '', source: 'import', ruleId: null }],
    })

    expect(evaluateAutomationRule(importRule, importedMessage).matched).toBe(true)
    expect(evaluateAutomationRule(manualRule, importedMessage).matched).toBe(true)
    const manualMessage = buildMessage({
      recentActionEvents: [{ action: 'junk', value: '', source: 'manual', ruleId: null }],
    })
    expect(evaluateAutomationRule(importRule, manualMessage).matched).toBe(false)
    expect(evaluateAutomationRule(manualRule, manualMessage).matched).toBe(true)
    expect(evaluateAutomationRule(manualRule, buildMessage({
      recentActionEvents: [{ action: 'import_trash', value: '', source: 'import', ruleId: null }],
    })).matched).toBe(false)
  })

  it('requires the tag value to match for add_tag/remove_tag receive_action steps', () => {
    const rule = buildRule({
      steps: [
        { id: 'r1', kind: 'receive_action', position: 0, enabled: true, action: 'add_tag', value: 'tag-invoices', allowRecursion: false },
        { id: 'a1', kind: 'action', position: 1, enabled: true, action: 'trash', value: '' },
      ],
    })

    const wrongTag = buildMessage({ recentActionEvents: [{ action: 'add_tag', value: 'tag-other', source: 'manual', ruleId: null }] })
    expect(evaluateAutomationRule(rule, wrongTag).matched).toBe(false)

    const rightTag = buildMessage({ recentActionEvents: [{ action: 'add_tag', value: 'tag-invoices', source: 'manual', ruleId: null }] })
    expect(evaluateAutomationRule(rule, rightTag).matched).toBe(true)
  })
})

describe('normalizeAutomationRule with receive_action', () => {
  it('accepts a valid receive_action step and defaults allowRecursion to false', () => {
    const rule = normalizeAutomationRule({
      name: 'Cascade rule',
      steps: [{ kind: 'receive_action', action: 'junk', value: '' }],
    })

    expect(rule?.steps).toHaveLength(1)
    expect(rule?.steps[0]).toMatchObject({ kind: 'receive_action', action: 'junk', allowRecursion: false })
  })

  it('rejects a receive_action step with an unreceivable action', () => {
    const rule = normalizeAutomationRule({
      name: 'Cascade rule',
      steps: [{ kind: 'receive_action', action: 'reply', value: '' }],
    })

    expect(rule?.steps).toHaveLength(0)
  })

  it('round-trips receive_action steps through the conditions column', () => {
    const rule = normalizeAutomationRule({
      name: 'Cascade rule',
      steps: [
        { kind: 'receive_action', action: 'junk', allowRecursion: true },
        { kind: 'action', action: 'trash' },
      ],
    })!

    const columns = toRuleColumns(rule)
    const restored = fromRuleColumns({
      name: rule.name,
      mode: rule.mode,
      stop_processing: rule.stopProcessing,
      conditions: columns.conditions,
      actions: columns.actions,
    })

    expect(restored.steps.map((step) => step.kind)).toEqual(['receive_action', 'action'])
    expect(restored.steps[0]).toMatchObject({ allowRecursion: true, action: 'junk' })
  })
})
