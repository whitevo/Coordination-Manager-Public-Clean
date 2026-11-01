import { Tag } from 'lucide-react'
import {
  MAILBOX_NOTIFY_MODE_HINTS,
  MAILBOX_NOTIFY_MODE_LABELS,
  cycleNotifyMode,
  resolveTagLabel,
  type MailboxNotificationRulesState,
  type MailboxNotifyMode,
  type MailboxNotifyTagEntry,
} from '../pages/mailbox-notifications'
import { Button } from './ui/Button'

interface MailboxNotificationRulesEditorProps {
  value: MailboxNotificationRulesState
  onChange: (next: MailboxNotificationRulesState) => void
  resolveUserTagLabel: (tagId: string) => string
  onRequestTagPanel: () => void
}

const MODE_STYLES: Record<MailboxNotifyMode, string> = {
  notify: 'border-primary/60 bg-primary/10 text-primary',
  mute: 'border-border bg-muted text-muted-foreground',
  always: 'border-success-muted bg-success-subtle text-success',
  never: 'border-danger-muted bg-danger-subtle text-danger',
}

export function MailboxNotificationRulesEditor({
  value,
  onChange,
  resolveUserTagLabel,
  onRequestTagPanel,
}: MailboxNotificationRulesEditorProps) {
  const updateEntries = (group: 'systemTags' | 'userTags', next: MailboxNotifyTagEntry[]) => {
    onChange({ ...value, [group]: next })
  }

  const renderGroup = (group: 'systemTags' | 'userTags', label: string) => {
    const entries = value[group]
    const restrictedCount = entries.filter((entry) => entry.mode !== 'notify').length

    return (
      <div key={group} className="min-w-0 rounded-md border border-border bg-background">
        <div className="flex items-center justify-between gap-1 px-2 py-1 text-[11px] font-medium">
          <span className="truncate" title={label}>{label}</span>
          <span className="shrink-0 text-[10px] font-normal text-muted-foreground">
            {restrictedCount > 0 ? `${restrictedCount} rule${restrictedCount === 1 ? '' : 's'}` : `${entries.length} tags`}
          </span>
        </div>

        <div className="space-y-0.5 border-t border-border px-1 py-1">
          {entries.map((entry) => {
            const entryLabel = resolveTagLabel(entry.id, resolveUserTagLabel)
            return (
              <div key={entry.id} className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-[11px]" title={entryLabel}>
                  {entryLabel}
                </span>
                <button
                  type="button"
                  onClick={() => updateEntries(group, entries.map((item) => (
                    item.id === entry.id ? { ...item, mode: cycleNotifyMode(item.mode) } : item
                  )))}
                  title={MAILBOX_NOTIFY_MODE_HINTS[entry.mode]}
                  aria-label={`${entryLabel} notification rule: ${MAILBOX_NOTIFY_MODE_LABELS[entry.mode]}`}
                  className={`w-32 shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${MODE_STYLES[entry.mode]}`}
                >
                  {MAILBOX_NOTIFY_MODE_LABELS[entry.mode]}
                </button>
              </div>
            )
          })}

          {group === 'userTags' && entries.length === 0 && (
            <Button
              emphasis="outline"
              size="compact"
              onClick={onRequestTagPanel}
              icon={<Tag className="h-3 w-3" />}
            >
              Create tags
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {renderGroup('systemTags', 'System tags')}
      {renderGroup('userTags', 'Custom tags')}
    </div>
  )
}

export default MailboxNotificationRulesEditor
