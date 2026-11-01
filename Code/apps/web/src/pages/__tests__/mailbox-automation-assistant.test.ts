import { describe, expect, it } from 'vitest'
import {
  buildMailboxAssistantState,
  describeAssistantRule,
  parseMailboxAssistantPlan,
  resolveAssistantTagId,
  type MailboxAssistantTag,
} from '../mailbox-automation-assistant'
import { buildEmptyAutomationRule } from '../mailbox-automation'

const TAGS: MailboxAssistantTag[] = [
  { id: 'tag-auto-delete', label: 'Auto-delete' },
  { id: 'tag-invoices', label: 'Invoices' },
]

const OPEN_EMAIL = {
  id: 'msg-1',
  subject: 'Coordination Manager -- test run succeeded',
  from_email: 'no-reply@coordination-manager.app',
  from_name: 'Coordination Manager',
  to_emails: 'me@example.com',
  preview: 'All 42 checks passed.',
  body_text: 'All 42 checks passed. No action required.',
  is_read: false,
  user_tag_ids: [],
}

function planContext(draft = null as ReturnType<typeof buildEmptyAutomationRule> | null) {
  return { tags: TAGS, fallbackName: 'Rule 1', currentDraft: draft }
}

describe('buildMailboxAssistantState', () => {
  it('gives the model the open email, the visible list, and the trial-run limits', () => {
    const state = buildMailboxAssistantState({
      openEmail: OPEN_EMAIL,
      visibleMessages: [OPEN_EMAIL, { ...OPEN_EMAIL, id: 'msg-2' }],
      tags: TAGS,
      draft: null,
      savedRules: [{
        id: 'rule-1',
        name: 'Newsletters',
        mode: 'dry_run',
        assessmentChecks: [{
          context: 'Use the rejection wording and hiring outcome.',
          intent: 'Decide whether this is an automated job rejection.',
          scoreThreshold: 0.8,
        }],
      }],
    })

    expect(state.openEmail?.subject).toBe('Coordination Manager -- test run succeeded')
    expect(state.openEmail?.body_text).toBe('All 42 checks passed. No action required.')
    expect(state.visibleMessageCount).toBe(2)
    expect(state.tags).toEqual(TAGS)
    expect(state.savedRules[0].assessmentChecks).toEqual([{
      context: 'Use the rejection wording and hiring outcome.',
      intent: 'Decide whether this is an automated job rejection.',
      scoreThreshold: 0.8,
    }])
    expect(state.capabilities.canActivateRules).toBe(false)
    expect(state.capabilities.canRunLive).toBe(false)
    expect(state.capabilities.runScopes).toEqual(['visible'])
    expect(state.capabilities.actions).toContain('trash')
    expect(state.capabilities.actions).toContain('add_tag')
  })

  it('caps the visible sample so a large inbox cannot flood the prompt', () => {
    const messages = Array.from({ length: 60 }, (_, index) => ({ ...OPEN_EMAIL, id: `msg-${index}` }))
    const state = buildMailboxAssistantState({
      openEmail: null,
      visibleMessages: messages,
      tags: [],
      draft: null,
      savedRules: [],
    })

    expect(state.visibleMessageCount).toBe(60)
    expect(state.visibleMessages).toHaveLength(25)
  })
})

// Regression case from AI feedback 2e56124c-5cb5-42c8-bf7d-1ee54b731e82, where the
// assistant told the user to build a filter in Gmail instead of configuring the rule.
describe('feedback 2e56124c: "Based on current email, update the rules so that the coordination manager\'s successful tests get trashed and apply the auto-delete tag."', () => {
  const modelResponse = {
    rule: {
      name: 'Trash successful Coordination Manager tests',
      mode: 'dry_run',
      match: 'all',
      steps: [
        { kind: 'condition', field: 'from_email', operator: 'contains_characters', value: 'no-reply@coordination-manager.app' },
        { kind: 'condition', field: 'subject', operator: 'contains_words', value: 'succeeded' },
        { kind: 'action', action: 'trash' },
        { kind: 'action', action: 'add_tag', value: 'Auto-delete' },
      ],
    },
    run: { scope: 'visible', dryRun: true },
    explanation: 'Saved as a trial run so nothing is deleted until you activate it.',
  }

  it('builds the rule from the open email instead of deferring to an external mail client', () => {
    const plan = parseMailboxAssistantPlan(modelResponse, planContext())

    expect(plan.rule).not.toBeNull()
    expect(plan.rule?.name).toBe('Trash successful Coordination Manager tests')
    expect(plan.rule?.steps.map((step) => step.kind)).toEqual(['condition', 'condition', 'action', 'action'])
    expect(plan.rule?.steps.map((step) => step.position)).toEqual([0, 1, 2, 3])
    expect(plan.issues).toEqual([])
    expect(plan.explanation).toContain('trial run')
  })

  it('resolves the auto-delete tag the user named in prose to its tag id', () => {
    const plan = parseMailboxAssistantPlan(modelResponse, planContext())
    const tagAction = plan.rule?.steps.find((step) => step.kind === 'action' && step.action === 'add_tag')

    expect(tagAction).toMatchObject({ value: 'tag-auto-delete' })
    expect(plan.notes).toEqual([])
  })

  it('requests the run-on-visible preview once the draft is complete', () => {
    const plan = parseMailboxAssistantPlan(modelResponse, planContext())
    expect(plan.run).toEqual({ scope: 'visible', dryRun: true })
  })

  it('keeps the rule in dry run', () => {
    const plan = parseMailboxAssistantPlan(modelResponse, planContext())
    expect(plan.rule?.mode).toBe('dry_run')
  })

  it('summarises the configured rule for the chat reply', () => {
    const plan = parseMailboxAssistantPlan(modelResponse, planContext())
    const summary = describeAssistantRule(plan.rule!, TAGS)

    expect(summary).toContain('Trash successful Coordination Manager tests')
    expect(summary).toContain('Trash email')
    expect(summary).toContain('Add tag: Auto-delete')
  })
})

describe('trial-run safety envelope', () => {
  it('preserves an import receive action as a trigger rather than a take action', () => {
    const plan = parseMailboxAssistantPlan(
      {
        rule: {
          name: 'Imported junk cleanup',
          steps: [
            { kind: 'receive_action', action: 'import_junk', allowRecursion: true },
            { kind: 'action', action: 'trash' },
          ],
        },
        run: { scope: 'visible' },
      },
      planContext(),
    )

    expect(plan.rule?.steps[0]).toMatchObject({
      kind: 'receive_action',
      action: 'import_junk',
      allowRecursion: false,
    })
    expect(plan.issues).toEqual([])
  })

  it('accepts assessment-intent and detection-score checks for AI triage rules', () => {
    const plan = parseMailboxAssistantPlan(
      {
        rule: {
          name: 'AI invoice triage',
          steps: [
            { kind: 'condition', field: 'assessment', context: 'Use the email and its dates to assess the request.', intent: 'Decide whether this is a coordination request.', protectionScore: 0.8 },
            { kind: 'action', action: 'add_tag', value: 'Invoices' },
          ],
        },
        run: { scope: 'visible' },
      },
      planContext(),
    )

    expect(plan.issues).toEqual([])
    expect(plan.rule?.steps[0]).toMatchObject({ field: 'assessment', operator: 'has_value', assessmentContext: 'Use the email and its dates to assess the request.', assessmentIntent: 'Decide whether this is a coordination request.', assessmentScoreThreshold: 0.8 })
    expect(plan.run.scope).toBe('visible')
  })

  it('downgrades an active rule to dry run and says so', () => {
    const plan = parseMailboxAssistantPlan(
      {
        rule: {
          name: 'Trash tests',
          mode: 'active',
          steps: [
            { kind: 'condition', field: 'subject', operator: 'contains_words', value: 'succeeded' },
            { kind: 'action', action: 'trash' },
          ],
        },
        run: { scope: 'visible', dryRun: true },
      },
      planContext(),
    )

    expect(plan.rule?.mode).toBe('dry_run')
    expect(plan.notes.join(' ')).toContain('kept in Dry run')
  })

  it('refuses a live run over the whole mailbox', () => {
    const plan = parseMailboxAssistantPlan(
      {
        rule: {
          name: 'Trash tests',
          steps: [
            { kind: 'condition', field: 'subject', operator: 'contains_words', value: 'succeeded' },
            { kind: 'action', action: 'trash' },
          ],
        },
        run: { scope: 'all', dryRun: false },
      },
      planContext(),
    )

    expect(plan.run).toEqual({ scope: 'visible', dryRun: true })
    expect(plan.notes.join(' ')).toContain('emails currently visible')
    expect(plan.notes.join(' ')).toContain('nothing was changed')
  })

  it('keeps a disabled rule disabled', () => {
    const plan = parseMailboxAssistantPlan(
      { rule: { name: 'Paused', mode: 'disabled', steps: [] }, run: { scope: 'none' } },
      planContext(),
    )
    expect(plan.rule?.mode).toBe('disabled')
  })
})

describe('untrusted model output', () => {
  it('reports an unknown tag and blocks the preview run', () => {
    const plan = parseMailboxAssistantPlan(
      {
        rule: {
          name: 'Tag tests',
          steps: [
            { kind: 'condition', field: 'subject', operator: 'contains_words', value: 'succeeded' },
            { kind: 'action', action: 'add_tag', value: 'Nonexistent' },
          ],
        },
        run: { scope: 'visible' },
      },
      planContext(),
    )

    expect(plan.notes.join(' ')).toContain('No mailbox tag matches "Nonexistent"')
    expect(plan.issues.length).toBeGreaterThan(0)
    expect(plan.run.scope).toBe('none')
  })

  it('drops unknown fields and actions', () => {
    const plan = parseMailboxAssistantPlan(
      {
        rule: {
          name: 'Bad rule',
          steps: [
            { kind: 'condition', field: 'secret_column', operator: 'contains_words', value: 'x' },
            { kind: 'action', action: 'delete_account' },
            { kind: 'condition', field: 'subject', operator: 'contains_words', value: 'succeeded' },
            { kind: 'action', action: 'trash' },
          ],
        },
        run: { scope: 'visible' },
      },
      planContext(),
    )

    expect(plan.rule?.steps).toHaveLength(2)
    expect(plan.notes.join(' ')).toContain('secret_column')
    expect(plan.notes.join(' ')).toContain('delete_account')
  })

  it('coerces an operator that does not apply to the field', () => {
    const plan = parseMailboxAssistantPlan(
      {
        rule: {
          name: 'Attachments',
          steps: [
            { kind: 'condition', field: 'has_attachments', operator: 'contains_words', value: 'pdf' },
            { kind: 'action', action: 'archive' },
          ],
        },
        run: { scope: 'visible' },
      },
      planContext(),
    )

    expect(plan.rule?.steps[0]).toMatchObject({ field: 'has_attachments', operator: 'is_true', value: '' })
    expect(plan.notes.join(' ')).toContain('does not apply to that field')
  })

  it('returns no rule when the model only answered with prose', () => {
    const plan = parseMailboxAssistantPlan(
      { rule: null, run: { scope: 'none' }, explanation: 'That is not an automation request.' },
      planContext(),
    )

    expect(plan.rule).toBeNull()
    expect(plan.run.scope).toBe('none')
    expect(plan.explanation).toBe('That is not an automation request.')
  })

  it('falls back to the current draft name when the model omits one', () => {
    const draft = buildEmptyAutomationRule('Existing rule')
    const plan = parseMailboxAssistantPlan({ rule: { steps: [] } }, planContext(draft))
    expect(plan.rule?.name).toBe('Existing rule')
  })
})

describe('resolveAssistantTagId', () => {
  it('matches by id, by exact label, and by loose label', () => {
    expect(resolveAssistantTagId('tag-invoices', TAGS)).toBe('tag-invoices')
    expect(resolveAssistantTagId('Auto-delete', TAGS)).toBe('tag-auto-delete')
    expect(resolveAssistantTagId('auto delete', TAGS)).toBe('tag-auto-delete')
    expect(resolveAssistantTagId('unknown', TAGS)).toBeNull()
    expect(resolveAssistantTagId('', TAGS)).toBeNull()
  })
})
