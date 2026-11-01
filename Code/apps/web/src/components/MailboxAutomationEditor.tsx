import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useOverlayLayer } from '../lib/use-overlay-layer'
import { Button } from './ui/Button'
import { IconButton } from './ui/IconButton'
import { ToggleButton } from './ui/ToggleButton'
import { ArrowDown, ArrowUp, Braces, Check, Copy, Filter, Plus, Repeat, Trash2, Zap } from 'lucide-react'
import {
  AUTOMATION_ACTION_LABELS,
  AUTOMATION_FIELD_GROUPS,
  AUTOMATION_FIELD_LABELS,
  AUTOMATION_OPERATOR_LABELS,
  AUTOMATION_RECEIVE_ACTION_LABELS,
  DEFERRED_AUTOMATION_ACTIONS,
  EXECUTABLE_AUTOMATION_ACTIONS,
  RECEIVABLE_AUTOMATION_ACTIONS,
  MAX_AUTOMATION_STEPS,
  actionNeedsTag,
  actionNeedsText,
  allowedOperatorsForField,
  buildActionStep,
  buildConditionStep,
  buildReceiveActionStep,
  moveAutomationStep,
  operatorNeedsValue,
  renumberSteps,
  serializeAutomationRule,
  validateAutomationRule,
  withConditionField,
  type AutomationActionStep,
  type AutomationActionType,
  type AutomationConditionStep,
  type AutomationFieldId,
  type AutomationOperator,
  type AutomationReceiveActionStep,
  type AutomationReceiveActionType,
  type AutomationRuleDefinition,
  type AutomationRuleMode,
  type AutomationStep,
} from '../pages/mailbox-automation'

export interface MailboxAutomationTagOption {
  id: string
  label: string
  color: string
}

interface MailboxAutomationEditorProps {
  value: AutomationRuleDefinition
  onChange: (next: AutomationRuleDefinition) => void
  tags: MailboxAutomationTagOption[]
  /** Stacks each step's inputs vertically for narrow containers such as the side panel. */
  dense?: boolean
  /** Invoked when the user picks "Create tag" from a tag dropdown. */
  onRequestCreateTag?: () => void
}

// Sentinel value for the extra "Create tag" option inside tag dropdowns.
const CREATE_TAG_OPTION = '__create_tag__'

const MODE_OPTIONS: Array<{ id: AutomationRuleMode; label: string; hint: string }> = [
  { id: 'active', label: 'Active', hint: 'Actions are executed for real' },
  { id: 'dry_run', label: 'Dry run', hint: 'Matches are reported, nothing is changed' },
  { id: 'disabled', label: 'Disabled', hint: 'The rule is skipped entirely' },
]

// Delay (ms) before a hover explainer appears, so it doesn't flash on quick mouse passes.
const HOVER_HINT_DELAY_MS = 2000
const HOVER_HINT_WIDTH_PX = 224 // matches w-56
const VIEWPORT_EDGE_PADDING_PX = 8

/** Wraps a label and shows an explainer tooltip after the mouse hovers over it for HOVER_HINT_DELAY_MS. */
function HoverHintLabel({ text, hint }: { text: string; hint: string }) {
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const anchorRef = useRef<HTMLSpanElement>(null)
  // Portaled to body; the editor can sit in a phone drawer, so the hint claims the tooltip layer.
  const { z: hintZ } = useOverlayLayer('tooltip', visible)

  const handleEnter = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (!rect) return
      // Center under the label, then clamp so it never crosses either viewport edge.
      let left = rect.left + rect.width / 2 - HOVER_HINT_WIDTH_PX / 2
      const maxLeft = window.innerWidth - HOVER_HINT_WIDTH_PX - VIEWPORT_EDGE_PADDING_PX
      left = Math.min(Math.max(left, VIEWPORT_EDGE_PADDING_PX), maxLeft)
      setPosition({ top: rect.bottom + 6, left })
      setVisible(true)
    }, HOVER_HINT_DELAY_MS)
  }
  const handleLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    setVisible(false)
  }

  return (
    <span ref={anchorRef} onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <span className="text-muted-foreground">{text}</span>
      {visible && position && createPortal(
        <span
          className="pointer-events-none fixed rounded-md border border-border bg-popover px-2 py-1.5 text-[11px] font-normal normal-case text-popover-foreground shadow-lg"
          style={{ top: position.top, left: position.left, width: HOVER_HINT_WIDTH_PX, zIndex: hintZ }}
        >
          {hint}
        </span>,
        document.body
      )}
    </span>
  )
}

export function MailboxAutomationEditor({ value, onChange, tags, dense = false, onRequestCreateTag }: MailboxAutomationEditorProps) {
  const [showJson, setShowJson] = useState(false)
  const [jsonCopied, setJsonCopied] = useState(false)
  // Validation stays quiet on a pristine draft so a brand new rule does not open covered in errors.
  const [touchedStepIds, setTouchedStepIds] = useState<Set<string>>(new Set())

  const issues = useMemo(() => validateAutomationRule(value), [value])
  const issuesByStep = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const issue of issues) {
      if (!issue.stepId || !touchedStepIds.has(issue.stepId)) continue
      map.set(issue.stepId, [...(map.get(issue.stepId) || []), issue.message])
    }
    return map
  }, [issues, touchedStepIds])
  const generalIssues = issues.filter((issue) => !issue.stepId)

  const updateSteps = (steps: AutomationStep[]) => onChange({ ...value, steps: renumberSteps(steps) })

  const patchStep = (
    stepId: string,
    patch: Partial<AutomationConditionStep> | Partial<AutomationActionStep> | Partial<AutomationReceiveActionStep>,
  ) => {
    setTouchedStepIds((current) => new Set(current).add(stepId))
    updateSteps(value.steps.map((step) => (step.id === stepId ? { ...step, ...patch } as AutomationStep : step)))
  }

  const addStep = (kind: AutomationStep['kind']) => {
    if (value.steps.length >= MAX_AUTOMATION_STEPS) return
    const step = kind === 'condition'
      ? buildConditionStep(value.steps.length)
      : kind === 'receive_action'
        ? buildReceiveActionStep(value.steps.length)
        : buildActionStep(value.steps.length)
    updateSteps([...value.steps, step])
  }

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(serializeAutomationRule(value))
      setJsonCopied(true)
      setTimeout(() => setJsonCopied(false), 1500)
    } catch {
      // Clipboard access can be blocked; leave the button state unchanged.
    }
  }

  const renderTagSelect = (stepId: string, selected: string, ariaLabel: string) => (
    <select
      value={tags.some((tag) => tag.id === selected) ? selected : ''}
      onChange={(event) => {
        if (event.target.value === CREATE_TAG_OPTION) {
          onRequestCreateTag?.()
          return
        }
        patchStep(stepId, { value: event.target.value })
      }}
      aria-label={ariaLabel}
      className="min-w-0 rounded-md border border-input bg-background px-2 py-1 text-[11px]"
    >
      <option value="">Select a tag</option>
      {tags.map((tag) => (
        <option key={tag.id} value={tag.id}>{tag.label}</option>
      ))}
      {onRequestCreateTag && <option value={CREATE_TAG_OPTION}>+ Create tag...</option>}
    </select>
  )

  const renderCondition = (step: AutomationConditionStep) => {
    const operators = allowedOperatorsForField(step.field)
    const isAssessment = step.field === 'assessment'
    return (
      <div className={`grid gap-1.5 ${dense || isAssessment ? '' : 'sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.2fr)]'}`}>
        <select
          value={step.field}
          onChange={(event) => patchStep(step.id, withConditionField(step, event.target.value as AutomationFieldId))}
          aria-label="Field to check"
          className="min-w-0 rounded-md border border-input bg-background px-2 py-1 text-[11px]"
        >
          {AUTOMATION_FIELD_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.fields.map((field) => (
                <option key={field} value={field}>{AUTOMATION_FIELD_LABELS[field]}</option>
              ))}
            </optgroup>
          ))}
        </select>

        {!isAssessment && <select
          value={step.operator}
          onChange={(event) => patchStep(step.id, { operator: event.target.value as AutomationOperator })}
          aria-label="Check type"
          className="min-w-0 rounded-md border border-input bg-background px-2 py-1 text-[11px]"
        >
          {operators.map((operator) => (
            <option key={operator} value={operator}>{AUTOMATION_OPERATOR_LABELS[operator]}</option>
          ))}
        </select>}

        {step.field === 'tag' && operatorNeedsValue(step.operator) ? (
          renderTagSelect(step.id, step.value, 'Tag to match')
        ) : operatorNeedsValue(step.operator) ? (
          <div className="flex min-w-0 items-center gap-1">
            <input
              value={step.value}
              onChange={(event) => patchStep(step.id, { value: event.target.value })}
              placeholder={step.field === 'attachment_size_kb' ? 'Size in KB' : 'Value to match'}
              inputMode={step.field === 'attachment_size_kb' ? 'numeric' : 'text'}
              aria-label="Value to match"
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-[11px]"
            />
            <ToggleButton
              size="compact"
              pressed={Boolean(step.caseSensitive)}
              onPressedChange={() => patchStep(step.id, { caseSensitive: !step.caseSensitive })}
              title={step.caseSensitive ? 'Case sensitive comparison' : 'Case insensitive comparison'}
              className="shrink-0"
            >
              Aa
            </ToggleButton>
          </div>
        ) : (
          <span className="self-center text-[10px] text-muted-foreground">No value needed</span>
        )}
        {isAssessment && (
          <div className="mt-1.5 space-y-1.5">
            <textarea value={step.assessmentContext ?? ''} onChange={(event) => patchStep(step.id, { assessmentContext: event.target.value })} placeholder="Context: information to use and problem to address" aria-label="Assessment context" rows={2} className="w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-[11px]" />
            <textarea value={step.assessmentIntent ?? ''} onChange={(event) => patchStep(step.id, { assessmentIntent: event.target.value })} placeholder="Intent: end goal or result to predict" aria-label="Assessment intent" rows={2} className="w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-[11px]" />
            <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
              Confidence threshold at least
          <input
            type="number"
            min={0}
            max={100}
            step={5}
            value={Math.round((step.assessmentScoreThreshold ?? 0.8) * 100)}
            onChange={(event) => patchStep(step.id, { assessmentScoreThreshold: Math.min(100, Math.max(0, Number(event.target.value) || 0)) / 100 })}
            aria-label="Assessment confidence threshold percentage"
            className="w-20 rounded-md border border-input bg-background px-2 py-1 text-[11px]"
          />
          <span>%</span>
            </label>
          </div>
        )}
      </div>
    )
  }

  const renderAction = (step: AutomationActionStep) => (
    <div className={`grid gap-1.5 ${dense ? '' : 'sm:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)]'}`}>
      <select
        value={step.action}
        onChange={(event) => patchStep(step.id, { action: event.target.value as AutomationActionType, value: '' })}
        aria-label="Action to run"
        className="min-w-0 rounded-md border border-input bg-background px-2 py-1 text-[11px]"
      >
        <optgroup label="Executed">
          {EXECUTABLE_AUTOMATION_ACTIONS.filter((action) => action !== 'agent_prompt').map((action) => (
            <option key={action} value={action}>{AUTOMATION_ACTION_LABELS[action]}</option>
          ))}
        </optgroup>
        <optgroup label="Agent">
          <option value="agent_prompt">Prompt internal AI assistant</option>
          {DEFERRED_AUTOMATION_ACTIONS.map((action) => (
            <option key={action} value={action}>{AUTOMATION_ACTION_LABELS[action]}</option>
          ))}
        </optgroup>
      </select>

      {step.action === 'agent_prompt' ? (
        <div className="space-y-1.5">
          <textarea value={step.agentContext ?? ''} onChange={(event) => patchStep(step.id, { agentContext: event.target.value })} placeholder="Context: information to use and problem to address" aria-label="AI action context" rows={2} className="w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-[11px]" />
          <textarea value={step.agentIntent ?? ''} onChange={(event) => patchStep(step.id, { agentIntent: event.target.value })} placeholder="Intent: end goal or result to prepare" aria-label="AI action intent" rows={2} className="w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-[11px]" />
        </div>
      ) : actionNeedsTag(step.action) ? (
        renderTagSelect(step.id, step.value, 'Tag to apply')
      ) : actionNeedsText(step.action) ? (
        <input
          value={step.value}
          onChange={(event) => patchStep(step.id, { value: event.target.value })}
          placeholder={step.action === 'forward' ? 'Forward draft instructions or address' : 'AI reply draft instructions'}
          aria-label="Action detail"
          className="min-w-0 rounded-md border border-input bg-background px-2 py-1 text-[11px]"
        />
      ) : (
        <span className="self-center text-[10px] text-muted-foreground">No configuration needed</span>
      )}
    </div>
  )

  const renderReceiveAction = (step: AutomationReceiveActionStep) => (
    <div className="space-y-1.5">
      <div className={`grid gap-1.5 ${dense ? '' : 'sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]'}`}>
        <select
          value={step.action}
          onChange={(event) => patchStep(step.id, { action: event.target.value as AutomationReceiveActionType, value: '' })}
          aria-label="Action to react to"
          className="min-w-0 rounded-md border border-input bg-background px-2 py-1 text-[11px]"
        >
          {RECEIVABLE_AUTOMATION_ACTIONS.map((action) => (
            <option key={action} value={action}>{AUTOMATION_RECEIVE_ACTION_LABELS[action]}</option>
          ))}
        </select>

        {actionNeedsTag(step.action) ? (
          renderTagSelect(step.id, step.value, 'Tag to match')
        ) : (
          <span className="self-center text-[10px] text-muted-foreground">
            {step.action === 'junk' ? 'Manual Junk or provider-imported/synced Junk' : 'Any email that matches'}
          </span>
        )}
      </div>

      {!step.action.startsWith('import_') && <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-muted-foreground">
        <input
          type="checkbox"
          checked={step.allowRecursion}
          onChange={(event) => patchStep(step.id, { allowRecursion: event.target.checked })}
          className="h-3.5 w-3.5 rounded border-input accent-primary"
        />
        Also trigger when another rule caused this action (recursion)
      </label>}
    </div>
  )

  return (
    <div className="space-y-2">
      <div className="grid gap-1.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <input
          value={value.name}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
          placeholder="Rule name"
          maxLength={120}
          aria-label="Rule name"
          className="min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-xs font-medium"
        />
        <select
          value={value.mode}
          onChange={(event) => onChange({ ...value, mode: event.target.value as AutomationRuleMode })}
          aria-label="Rule mode"
          title={MODE_OPTIONS.find((option) => option.id === value.mode)?.hint}
          className="min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-xs"
        >
          {MODE_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5">
        <label className="flex items-center gap-1 text-[11px]">
          <span className="text-muted-foreground">Match</span>
          <select
            value={value.match}
            onChange={(event) => onChange({ ...value, match: event.target.value === 'any' ? 'any' : 'all' })}
            aria-label="Condition match mode"
            className="rounded-md border border-input bg-background px-1.5 py-0.5 text-[11px]"
          >
            <option value="all">all checks</option>
            <option value="any">any check</option>
          </select>
        </label>

        <label className="flex cursor-pointer items-center gap-1.5 text-[11px]">
          <input
            type="checkbox"
            checked={value.stopProcessing}
            onChange={(event) => onChange({ ...value, stopProcessing: event.target.checked })}
            className="h-3.5 w-3.5 rounded border-input accent-primary"
          />
          <HoverHintLabel
            text="Stop after match"
            hint="Once this rule matches a message, no other automation rules are checked against it."
          />
        </label>
      </div>

      <div className="space-y-1">
        {value.steps.map((step, index) => {
          const stepIssues = issuesByStep.get(step.id) || []
          return (
            <div
              key={step.id}
              className={`rounded-md border px-1.5 py-1.5 transition-colors ${
                stepIssues.length > 0
                  ? 'border-danger-muted bg-danger-subtle'
                  : step.enabled
                    ? 'border-border bg-background'
                    : 'border-dashed border-border bg-background/50'
              }`}
            >
              <div className="flex items-start gap-1.5">
                <div className="flex flex-col pt-0.5">
                  <IconButton
                    size="micro"
                    label="Move step up"
                    icon={<ArrowUp />}
                    onClick={() => updateSteps(moveAutomationStep(value.steps, step.id, -1))}
                    disabled={index === 0}
                  />
                  <IconButton
                    size="micro"
                    label="Move step down"
                    icon={<ArrowDown />}
                    onClick={() => updateSteps(moveAutomationStep(value.steps, step.id, 1))}
                    disabled={index === value.steps.length - 1}
                  />
                </div>

                <span className="w-4 shrink-0 pt-1 text-center text-[10px] font-semibold text-muted-foreground">{index + 1}</span>

                <input
                  type="checkbox"
                  checked={step.enabled}
                  onChange={() => patchStep(step.id, { enabled: !step.enabled })}
                  aria-label={step.enabled ? 'Disable this step' : 'Enable this step'}
                  className="mt-1 h-3.5 w-3.5 shrink-0 rounded border-input accent-primary"
                />

                <span
                  className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                    step.kind === 'condition'
                      ? 'border-primary/50 bg-primary/10 text-primary'
                      : step.kind === 'receive_action'
                        ? 'border-info-muted bg-info-subtle text-info dark:border-info-muted bg-info-subtle text-info'
                        : 'border-warning-muted bg-warning-subtle text-warning'
                  }`}
                >
                  {step.kind === 'condition' ? <Filter className="h-3 w-3" /> : step.kind === 'receive_action' ? <Repeat className="h-3 w-3" /> : <Zap className="h-3 w-3" />}
                  {step.kind === 'condition' ? 'Check' : step.kind === 'receive_action' ? 'Check: Receive action' : 'Take action'}
                </span>

                <div className={`min-w-0 flex-1 ${step.enabled ? '' : 'opacity-50'}`}>
                  {step.kind === 'condition' ? renderCondition(step) : step.kind === 'receive_action' ? renderReceiveAction(step) : renderAction(step)}
                  {stepIssues.map((message) => (
                    <p key={message} className="mt-1 text-[10px] text-danger">{message}</p>
                  ))}
                </div>

                <IconButton
                  intent="danger"
                  onClick={() => updateSteps(value.steps.filter((entry) => entry.id !== step.id))}
                  label="Delete step"
                  className="mt-0.5"
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                />
              </div>
            </div>
          )
        })}

        {value.steps.length === 0 && (
          <p className="rounded-md border border-dashed border-border px-2 py-3 text-center text-[11px] text-muted-foreground">
            No steps yet. Add a check to decide which emails match, then an action to run on them.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          emphasis="outline"
          size="compact"
          onClick={() => addStep('condition')}
          disabled={value.steps.length >= MAX_AUTOMATION_STEPS}
          icon={<Plus className="h-3 w-3" />}
        >
          Add check
        </Button>
        <Button
          emphasis="outline"
          size="compact"
          onClick={() => addStep('receive_action')}
          disabled={value.steps.length >= MAX_AUTOMATION_STEPS}
          title="Trigger this rule when an email has already had an action applied (e.g. junked, trashed)"
          icon={<Plus className="h-3 w-3" />}
        >
          Add receive action
        </Button>
        <Button
          emphasis="outline"
          size="compact"
          onClick={() => addStep('action')}
          disabled={value.steps.length >= MAX_AUTOMATION_STEPS}
          icon={<Plus className="h-3 w-3" />}
        >
          Add take action
        </Button>
        <Button
          emphasis="outline"
          intent={showJson ? 'primary' : 'neutral'}
          size="compact"
          onClick={() => setShowJson((current) => !current)}
          aria-expanded={showJson}
          className="ml-auto"
          icon={<Braces className="h-3 w-3" />}
        >
          {showJson ? 'Hide JSON' : 'Show JSON'}
        </Button>
        <Button
          emphasis="outline"
          size="compact"
          onClick={() => void copyJson()}
          title="Copy the rule JSON to the clipboard -- paste it into the AI Assistant chat to import it"
          icon={jsonCopied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
        >
          {jsonCopied ? 'Copied' : 'Copy JSON'}
        </Button>
      </div>

      {generalIssues.length > 0 && (
        <ul className="space-y-0.5 rounded-md border border-warning-muted bg-warning-subtle px-2 py-1.5">
          {generalIssues.map((issue) => (
            <li key={issue.message} className="text-[10px] text-warning">{issue.message}</li>
          ))}
        </ul>
      )}

      {showJson && (
        <div className="space-y-1">
          <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted/50 p-2 text-[10px] font-mono leading-relaxed">
            {serializeAutomationRule(value)}
          </pre>
          <p className="text-[10px] text-muted-foreground">
            To import this JSON elsewhere, paste it into the AI Assistant chat rather than into a field directly -- the assistant resolves tag names/labels to the correct tag id (offering to create one if it does not exist yet) and repairs malformed steps instead of silently leaving them blank.
          </p>
        </div>
      )}
    </div>
  )
}

export default MailboxAutomationEditor
