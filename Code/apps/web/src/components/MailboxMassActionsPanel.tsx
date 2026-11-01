import { useMemo, useState } from 'react'
import { Plus, Trash2, Zap } from 'lucide-react'
import {
  AUTOMATION_ACTION_LABELS,
  DEFERRED_AUTOMATION_ACTIONS,
  EXECUTABLE_AUTOMATION_ACTIONS,
  actionNeedsTag,
  actionNeedsText,
  buildActionStep,
  type AutomationActionStep,
  type AutomationActionType,
} from '../pages/mailbox-automation'
import type { MailboxAutomationTagOption } from './MailboxAutomationEditor'
import type { MailboxBulkMessageOutcome } from '../pages/mailbox-page-helpers'
import { Button } from './ui/Button'
import { IconButton } from './ui/IconButton'
import { CountBadge } from './ui/CountBadge'
import { Disclosure } from './ui/Disclosure'

export interface MailboxMassActionResult {
  processed_messages: number
  applied: number
  failed: number
  errors: string[]
  contract_version?: 1
  results?: MailboxBulkMessageOutcome[]
  warnings?: Array<{ code: string; message_id?: string; action_index?: number }>
}

interface MailboxMassActionsPanelProps {
  isOpen: boolean
  onToggle: () => void
  tags: MailboxAutomationTagOption[]
  /** Number of emails currently rendered in the inbox list ("Showing N"). */
  visibleCount: number
  /** Only true when the user has at least one enabled "Receive action" rule. */
  canCascade: boolean
  isApplying: boolean
  error: string | null
  result: MailboxMassActionResult | null
  onApply: (actions: Array<{ action: AutomationActionType; value: string }>, cascade: boolean) => void
  /** Opens the tag library side panel and focuses its creation input. */
  onRequestCreateTag: () => void
}

// Sentinel value for the extra "Create tag" option inside the tag dropdown.
const CREATE_TAG_OPTION = '__create_tag__'

// Mirrors MAX_BULK_ACTION_STEPS in apps/api/src/routes/mailbox.ts.
const MAX_MASS_ACTION_STEPS = 20

const EXECUTABLE_ACTIONS = new Set<AutomationActionType>(EXECUTABLE_AUTOMATION_ACTIONS)

export function MailboxMassActionsPanel({
  isOpen,
  onToggle,
  tags,
  visibleCount,
  canCascade,
  isApplying,
  error,
  result,
  onApply,
  onRequestCreateTag,
}: MailboxMassActionsPanelProps) {
  const [steps, setSteps] = useState<AutomationActionStep[]>([])
  const [cascade, setCascade] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const uncertainCount = result?.results?.reduce((count, message) => count + message.actions.filter(action => action.status === 'uncertain').length, 0) ?? 0
  const unavailableCount = result?.results?.filter(message => message.actions.some(action => action.status === 'unavailable')).length ?? 0

  const blockingIssue = useMemo(() => {
    const enabled = steps.filter((step) => step.enabled)
    if (enabled.length === 0) return 'Add at least one action to run.'
    if (enabled.every((step) => !EXECUTABLE_ACTIONS.has(step.action))) {
      return 'Reply and forward are not executed yet -- add an action that runs.'
    }
    if (enabled.some((step) => actionNeedsTag(step.action) && !step.value)) return 'Select a tag for every tag action.'
    if (visibleCount === 0) return 'No emails are currently showing.'
    return null
  }, [steps, visibleCount])

  const skippedCount = steps.filter((step) => step.enabled && !EXECUTABLE_ACTIONS.has(step.action)).length

  const patchStep = (stepId: string, patch: Partial<AutomationActionStep>) => {
    setConfirming(false)
    setSteps((current) => current.map((step) => (step.id === stepId ? { ...step, ...patch } : step)))
  }

  const addStep = () => {
    setConfirming(false)
    setSteps((current) => (current.length >= MAX_MASS_ACTION_STEPS ? current : [...current, buildActionStep(current.length)]))
  }

  const removeStep = (stepId: string) => {
    setConfirming(false)
    setSteps((current) => current.filter((step) => step.id !== stepId))
  }

  const handleRunClick = () => {
    if (blockingIssue) return
    if (!confirming) {
      setConfirming(true)
      return
    }
    setConfirming(false)
    onApply(
      steps
        .filter((step) => step.enabled && EXECUTABLE_ACTIONS.has(step.action))
        .map((step) => ({ action: step.action, value: step.value })),
      cascade,
    )
  }

  return (
    <div className="mb-2 rounded-lg border border-border/70 bg-background/40" data-testid="mailbox-mass-actions">
      <Disclosure
        size="compact"
        title="Mass Actions"
        icon={<Zap />}
        expanded={isOpen}
        onToggle={() => onToggle()}
        panelId="mailbox-mass-actions-panel"
        trailing={
          <span className="flex items-center gap-1.5">
            {steps.length > 0 && <CountBadge count={steps.length} emphasis="active" />}
            <span className="text-[10px] font-normal text-muted-foreground">{visibleCount} showing</span>
          </span>
        }
      />

      {isOpen && (
        <div id="mailbox-mass-actions-panel" className="space-y-2 border-t border-border/70 px-3 pb-3 pt-2">
          <div className="space-y-1">
            {steps.map((step, index) => (
              <div key={step.id} className="rounded-md border border-border bg-background px-1.5 py-1.5">
                <div className="flex items-start gap-1.5">
                  <span className="w-4 shrink-0 pt-1 text-center text-[10px] font-semibold text-muted-foreground">{index + 1}</span>

                  <input
                    type="checkbox"
                    checked={step.enabled}
                    onChange={() => patchStep(step.id, { enabled: !step.enabled })}
                    aria-label={step.enabled ? 'Disable this action' : 'Enable this action'}
                    className="mt-1 h-3.5 w-3.5 shrink-0 rounded border-input accent-primary"
                  />

                  <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded border border-warning-muted bg-warning-subtle px-1.5 py-0.5 text-[10px] font-medium text-warning">
                    <Zap className="h-3 w-3" />
                    Take action
                  </span>

                  <div className={`grid min-w-0 flex-1 gap-1.5 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)] ${step.enabled ? '' : 'opacity-50'}`}>
                    <select
                      value={step.action}
                      onChange={(event) => patchStep(step.id, { action: event.target.value as AutomationActionType, value: '' })}
                      aria-label="Action to run"
                      className="min-w-0 rounded-md border border-input bg-background px-2 py-1 text-[11px]"
                    >
                      <optgroup label="Executed">
                        {EXECUTABLE_AUTOMATION_ACTIONS.map((action) => (
                          <option key={action} value={action}>{AUTOMATION_ACTION_LABELS[action]}</option>
                        ))}
                      </optgroup>
                      <optgroup label="Planned">
                        {DEFERRED_AUTOMATION_ACTIONS.map((action) => (
                          <option key={action} value={action}>{AUTOMATION_ACTION_LABELS[action]}</option>
                        ))}
                      </optgroup>
                    </select>

                    {actionNeedsTag(step.action) ? (
                      <select
                        value={tags.some((tag) => tag.id === step.value) ? step.value : ''}
                        onChange={(event) => {
                          if (event.target.value === CREATE_TAG_OPTION) {
                            onRequestCreateTag()
                            return
                          }
                          patchStep(step.id, { value: event.target.value })
                        }}
                        aria-label="Tag to apply"
                        className="min-w-0 rounded-md border border-input bg-background px-2 py-1 text-[11px]"
                      >
                        <option value="">Select a tag</option>
                        {tags.map((tag) => (
                          <option key={tag.id} value={tag.id}>{tag.label}</option>
                        ))}
                        <option value={CREATE_TAG_OPTION}>+ Create tag...</option>
                      </select>
                    ) : actionNeedsText(step.action) ? (
                      <span className="self-center text-[10px] text-warning">Not executed yet -- this step is skipped</span>
                    ) : (
                      <span className="self-center text-[10px] text-muted-foreground">No configuration needed</span>
                    )}
                  </div>

                  <IconButton
                    intent="danger"
                    onClick={() => removeStep(step.id)}
                    label="Delete action"
                    className="mt-0.5"
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                  />
                </div>
              </div>
            ))}

            {steps.length === 0 && (
              <p className="rounded-md border border-dashed border-border px-2 py-3 text-center text-[11px] text-muted-foreground">
                No actions yet. Add a take action, then run it on every email currently showing.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              emphasis="outline"
              size="compact"
              onClick={addStep}
              disabled={steps.length >= MAX_MASS_ACTION_STEPS}
              icon={<Plus className="h-3 w-3" />}
            >
              Add take action
            </Button>

            <Button
              intent={confirming ? 'danger' : 'primary'}
              size="compact"
              onClick={handleRunClick}
              disabled={Boolean(blockingIssue) || isApplying}
              title={blockingIssue || `Apply these actions to the ${visibleCount} emails currently showing`}
              className="ml-auto"
              data-testid="mailbox-mass-actions-run"
              icon={<Zap className="h-3 w-3" />}
            >
              {isApplying
                ? 'Applying...'
                : confirming
                  ? `Confirm on ${visibleCount} emails`
                  : `Apply to ${visibleCount} showing`}
            </Button>

            {confirming && !isApplying && (
              <Button
                emphasis="ghost"
                size="compact"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
            )}
          </div>

          {canCascade && (
            <label className="flex cursor-pointer items-start gap-1.5 text-[10px] text-muted-foreground">
              <input
                type="checkbox"
                checked={cascade}
                onChange={(event) => {
                  setConfirming(false)
                  setCascade(event.target.checked)
                }}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-input accent-primary"
              />
              Let these actions trigger your other automation rules (Receive action steps). Leave off to change only the emails you selected.
            </label>
          )}

          {skippedCount > 0 && (
            <p className="rounded-md border border-warning-muted bg-warning-subtle px-2 py-1.5 text-[10px] text-warning">
              Reply and forward are not executed yet, so {skippedCount} step{skippedCount === 1 ? '' : 's'} will be skipped.
            </p>
          )}

          {confirming && !isApplying && (
            <p className="rounded-md border border-danger-muted bg-danger-subtle px-2 py-1.5 text-[10px] text-danger">
              This runs on all {visibleCount} emails currently showing and cannot be undone from here. Click Confirm to continue.
            </p>
          )}

          {error && (
            <p className="rounded-md border border-danger-muted bg-danger-subtle px-2 py-1.5 text-[10px] text-danger">
              {error}
            </p>
          )}

          {result && (
            <div className="space-y-1 rounded-md border border-border bg-background/60 px-2 py-1.5">
              <p className="text-[10px] text-muted-foreground">
                Applied {result.applied} action{result.applied === 1 ? '' : 's'} across {result.processed_messages} email
                {result.processed_messages === 1 ? '' : 's'}
                {uncertainCount > 0 ? ` -- ${uncertainCount} need verification.` : result.failed > 0 ? ` -- ${result.failed} failed.` : '.'}
              </p>
              {unavailableCount > 0 && (
                <p className="text-[10px] text-warning" role="status">{unavailableCount} email{unavailableCount === 1 ? ' is' : 's are'} no longer available.</p>
              )}
              {Boolean(result.warnings?.length) && (
                <p className="text-[10px] text-warning" role="status">Some action records or follow-up rules could not be confirmed. Completed actions have not been rolled back.</p>
              )}
              {result.errors.map((message) => (
                <p key={message} className="text-[10px] text-danger">{message}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
