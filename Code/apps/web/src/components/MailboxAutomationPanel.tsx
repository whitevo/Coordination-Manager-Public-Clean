import { useEffect, useMemo, useState } from 'react'
import { Bot, Loader2, PlayCircle, Save, Settings2, X } from 'lucide-react'
import MailboxAutomationEditor, { type MailboxAutomationTagOption } from './MailboxAutomationEditor'
import { Button, IconButton, ScoreDisplay, StatusBadge } from './ui'
import { useAiAssistant } from '../contexts/AiAssistantContext'
import { OVERLAY_BASE_Z } from '../lib/overlay-layers'
import {
  AUTOMATION_FIELD_LABELS,
  AUTOMATION_RECEIVE_ACTION_LABELS,
  type AutomationRuleDefinition,
  type AutomationRunEvaluation,
  type AutomationRunResult,
} from '../pages/mailbox-automation'

export const MAILBOX_AUTOMATION_PANEL_WIDTH_PX = 440

interface MailboxAutomationPanelProps {
  open: boolean
  isMobileLayout: boolean
  /** z-index of the phone full-screen drawer, from the caller's drawer layer claim. */
  mobileLayerZ?: number
  onClose: () => void
  /** Opens the shared app-wide AI assistant panel into the slot below this one. */
  onOpenAssistant: () => void
  selectedRuleId: string | null
  draft: AutomationRuleDefinition | null
  tags: MailboxAutomationTagOption[]
  saving: boolean
  running: boolean
  /** True when the draft differs from the saved rule. */
  dirty: boolean
  runResult: AutomationRunResult | null
  /** True when the draft has changed since runResult was produced -- the result no longer reflects what is on screen. */
  runResultStale: boolean
  error: string | null
  visibleMessageCount: number
  onDraftChange: (next: AutomationRuleDefinition) => void
  onSaveDraft: () => void
  onRun: (scope: 'visible' | 'all', dryRun: boolean) => void
  onOpenRuleSettings: () => void
  /** Opens the email behind a matched preview result. */
  onOpenMatch: (messageId: string) => void
  /** Opens the mailbox tags panel focused on tag creation. */
  onRequestCreateTag: () => void
}

export function MailboxAutomationPanel(props: MailboxAutomationPanelProps) {
  const {
    open, isMobileLayout, mobileLayerZ = OVERLAY_BASE_Z.drawer, onClose, onOpenAssistant,
    selectedRuleId, draft, tags, saving, running, dirty, runResult, runResultStale, error,
    visibleMessageCount, onDraftChange, onSaveDraft, onRun, onOpenRuleSettings,
    onOpenMatch, onRequestCreateTag,
  } = props

  const { setAssistantHost } = useAiAssistant()
  const [hostNode, setHostNode] = useState<HTMLDivElement | null>(null)

  // Register the slot so the single shared assistant renders below the config while this panel is open.
  useEffect(() => {
    if (!open || !hostNode) return
    setAssistantHost(hostNode)
    return () => setAssistantHost(null)
  }, [open, hostNode, setAssistantHost])

  const panelWidth = isMobileLayout ? '100vw' : `${MAILBOX_AUTOMATION_PANEL_WIDTH_PX}px`

  // Every checked email is listed; older API responses only carry the matches.
  const resultRows = useMemo<AutomationRunEvaluation[]>(() => {
    if (!runResult) return []
    if (runResult.evaluations) return runResult.evaluations
    return runResult.matches.map((match) => ({
      message_id: match.message_id,
      subject: match.subject,
      matched: true,
      confidence: 1,
      rule_id: match.rule_id,
      rule_name: match.rule_name,
      applied: match.applied,
      deferred: match.deferred,
      errors: match.errors,
    }))
  }, [runResult])

  return (
    <aside
      className={`${isMobileLayout ? 'fixed inset-0 h-screen w-screen border-0 shadow-2xl' : 'sticky top-0 h-screen shrink-0 border-l border-border'} overflow-hidden bg-card transition-[width,transform,opacity] duration-300 ease-out`}
      style={{ width: open ? panelWidth : 0, zIndex: isMobileLayout ? mobileLayerZ : undefined }}
      aria-hidden={!open}
    >
      <div
        className={`flex h-full min-h-0 min-w-0 flex-col transition-all duration-300 ease-out ${
          open ? 'translate-x-0 opacity-100' : (isMobileLayout ? 'translate-x-full opacity-0' : 'translate-x-3 opacity-0')
        }`}
        style={{ width: panelWidth }}
      >
        <section className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2.5">
          <h2 className="text-sm font-semibold text-foreground">Automation Configuration</h2>
          <div className="flex items-center gap-1">
            <Button
              emphasis="outline"
              size="compact"
              onClick={onOpenAssistant}
              title="Open the AI assistant below this panel"
              icon={<Bot className="h-3 w-3" />}
            >
              AI Assistant
            </Button>
            <Button
              emphasis="outline"
              size="compact"
              onClick={onOpenRuleSettings}
              title="Open the full automation rules settings"
              icon={<Settings2 className="h-3 w-3" />}
            >
              Rule settings
            </Button>
            <IconButton
              onClick={onClose}
              label="Close automation configuration"
              icon={<X className="h-4 w-4" />}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {error && (
            <p className="rounded-md border border-danger-muted bg-danger-subtle px-2 py-1.5 text-[11px] text-danger">
              {error}
            </p>
          )}

          {draft && (
            <section className={`space-y-2 rounded-lg border border-border bg-background/50 p-2.5 ${error ? 'mt-2' : ''}`}>
              <MailboxAutomationEditor value={draft} onChange={onDraftChange} tags={tags} dense onRequestCreateTag={onRequestCreateTag} />

              <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
                <Button
                  emphasis={dirty ? 'solid' : 'outline'}
                  intent={dirty ? 'primary' : 'neutral'}
                  size="compact"
                  onClick={onSaveDraft}
                  disabled={saving}
                  title={dirty ? 'Save the unsaved changes' : 'No changes to save'}
                  icon={<Save className="h-3 w-3" />}
                >
                  {saving ? 'Saving...' : selectedRuleId ? (dirty ? 'Save rule *' : 'Saved') : 'Create rule'}
                </Button>
                <Button
                  emphasis="outline"
                  size="compact"
                  onClick={() => onRun('visible', true)}
                  disabled={running || !selectedRuleId}
                  title={selectedRuleId ? 'Preview matches without changing anything' : 'Save the rule first'}
                  aria-busy={running}
                  icon={running ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlayCircle className="h-3 w-3" />}
                >
                  {running ? 'Running...' : `Preview on visible (${visibleMessageCount})`}
                </Button>
                <Button
                  emphasis="outline"
                  intent="danger"
                  size="compact"
                  onClick={() => onRun('visible', false)}
                  disabled={running || !selectedRuleId}
                  title={
                    running
                      ? 'A run is already in progress -- please wait for it to finish'
                      : selectedRuleId
                        ? `Execute this rule on all ${visibleMessageCount} visible emails`
                        : 'Save the rule first'
                  }
                  aria-busy={running}
                  icon={running ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlayCircle className="h-3 w-3" />}
                >
                  {running ? 'Running...' : `Run on all visible (${visibleMessageCount})`}
                </Button>
              </div>

              {draft.mode !== 'active' && (
                <p className="rounded-md border border-warning-muted bg-warning-subtle px-2 py-1.5 text-[10px] text-warning">
                  This rule is set to <span className="font-semibold">{draft.mode === 'dry_run' ? 'Dry run' : 'Disabled'}</span>, so Run on all visible only reports matches and changes nothing. Switch the mode to Active to apply its actions.
                </p>
              )}

              <p className="text-[10px] text-muted-foreground">
                Reply and forward actions can be configured now but are never executed yet. A rule in dry run mode only reports matches.
              </p>
            </section>
          )}

          {runResult && (
            <section className="mt-3 space-y-1.5 rounded-lg border border-border bg-background/50 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {runResult.dry_run ? 'Preview result' : 'Run result'}
                </p>
                <span className="text-[10px] text-muted-foreground">
                  {runResult.summary.matched} matched of {runResult.evaluated_messages} checked
                </span>
              </div>

              <p className="text-[10px] text-muted-foreground">
                A written explanation of these scores was posted to the AI Assistant.
              </p>

              {runResultStale && (
                <p className="rounded-md border border-warning-muted bg-warning-subtle px-2 py-1.5 text-[10px] text-warning">
                  The rule has changed since this {runResult.dry_run ? 'preview' : 'run'} was produced -- these results no longer match the configuration shown above. Preview or run again to refresh them.
                </p>
              )}

              {!runResult.dry_run && runResult.summary.matched > 0 && runResult.summary.applied === 0 && (
                <p className="rounded-md border border-warning-muted bg-warning-subtle px-2 py-1.5 text-[10px] text-warning">
                  Nothing was changed because the rule is not Active. Set the mode to Active and run again to apply these actions.
                </p>
              )}

              <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                {resultRows.map((row) => {
                  const didApply = row.matched && row.applied.length > 0
                  return (
                    <button
                      key={`${row.rule_id || 'none'}:${row.message_id}`}
                      type="button"
                      onClick={() => onOpenMatch(row.message_id)}
                      title="Open this email"
                      className={`block w-full rounded-md border px-2 py-1.5 text-left transition-colors hover:border-primary hover:bg-accent/40 ${
                        didApply
                          ? 'border-success-muted bg-success-subtle'
                          : row.matched
                            ? 'border-border bg-background'
                            : 'border-dashed border-border bg-muted/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className={`truncate text-[11px] font-medium ${row.matched ? '' : 'text-muted-foreground'}`}>
                          {row.subject || '(no subject)'}
                        </p>
                        <span className="flex shrink-0 items-center gap-1">
                          <ScoreDisplay value={row.confidence} label="rule match confidence" />
                          {didApply ? (
                            <StatusBadge tone="success" density="compact">Applied</StatusBadge>
                          ) : row.matched ? (
                            <StatusBadge tone="active" density="compact">Matched</StatusBadge>
                          ) : null}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {row.rule_name ? `${row.rule_name} -- ` : ''}
                        {row.matched
                          ? (row.applied.length > 0 ? row.applied.join(', ') : 'no executable action')
                          : 'not applied'}
                      </p>
                      {(row.checks || []).map((check) => (
                        <p key={check.step_id} className="mt-0.5 text-[10px] text-muted-foreground">
                          <span className={check.passed ? 'text-success' : 'text-danger'}>
                            {check.passed ? 'PASS' : 'FAIL'}
                          </span>{' '}
                          {check.kind === 'receive_action'
                            ? AUTOMATION_RECEIVE_ACTION_LABELS[check.action ?? 'trash']
                            : AUTOMATION_FIELD_LABELS[check.field ?? 'subject']}
                        </p>
                      ))}
                      {(row.assessments || []).map((assessment) => (
                        <p
                          key={`assessment-${assessment.step_id}`}
                          className={`mt-0.5 text-[10px] ${assessment.available ? 'text-muted-foreground' : 'text-warning'}`}
                        >
                          Assessment {Math.round(assessment.score * 100)}%: {assessment.reasoning}
                          {assessment.available && !assessment.input_summary.hasBody && ' (no body text was available for this email)'}
                        </p>
                      ))}
                      {row.deferred.length > 0 && (
                        <p className="text-[10px] text-warning">Skipped: {row.deferred.join(', ')}</p>
                      )}
                      {row.errors.map((message) => (
                        <p key={message} className="text-[10px] text-danger">{message}</p>
                      ))}
                    </button>
                  )
                })}

                {resultRows.length === 0 && (
                  <p className="rounded-md border border-dashed border-border px-2 py-3 text-center text-[11px] text-muted-foreground">
                    No emails were checked for this rule.
                  </p>
                )}
              </div>
            </section>
          )}

        </div>
        </section>

        {/* The shared AI assistant portals into this slot; empty:hidden lets the config fill when it is closed. */}
        <div ref={setHostNode} className="flex min-h-0 flex-1 flex-col border-t border-border empty:hidden" />
      </div>
    </aside>
  )
}

export default MailboxAutomationPanel
