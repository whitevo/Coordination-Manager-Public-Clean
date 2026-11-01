import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Tag } from 'lucide-react'
import {
  MAILBOX_SORT_BLOCK_LABELS,
  MAILBOX_SYSTEM_TAG_LABELS,
  MAILBOX_TAG_MODES,
  MAILBOX_TAG_MODE_HINTS,
  MAILBOX_TAG_MODE_LABELS,
  moveSortEntryById,
  readSystemTagFromSortId,
  readUserTagFromSortId,
  type MailboxSortBlockId,
  type MailboxSortState,
  type MailboxSortTagEntry,
  type MailboxTagMode,
} from '../pages/mailbox-sort'
import { Button } from './ui/Button'
import { IconButton } from './ui/IconButton'
import { SegmentedControl } from './ui/SegmentedControl'

interface MailboxSortOrderEditorProps {
  value: MailboxSortState
  onChange: (next: MailboxSortState) => void
  resolveUserTagLabel: (tagId: string) => string
  onRequestTagPanel: () => void
}

type MailboxSortGroupId = Exclude<MailboxSortBlockId, 'date'>

const MODE_STYLES: Record<MailboxTagMode, string> = {
  sort: 'border-border bg-background text-foreground',
  only: 'border-primary-muted bg-primary-subtle text-primary',
  hide: 'border-neutral-muted bg-neutral-subtle text-neutral',
}

export function MailboxSortOrderEditor({ value, onChange, resolveUserTagLabel, onRequestTagPanel }: MailboxSortOrderEditorProps) {
  // The two tag groups sit side by side, so date can only rank before or after the pair.
  const groupIds = value.order.filter((blockId): blockId is MailboxSortGroupId => blockId !== 'date')
  const dateFirst = value.order.indexOf('date') === 0

  const resolveEntryLabel = (entryId: string): string => {
    const systemTag = readSystemTagFromSortId(entryId)
    if (systemTag) return MAILBOX_SYSTEM_TAG_LABELS[systemTag]

    const userTagId = readUserTagFromSortId(entryId)
    return userTagId ? resolveUserTagLabel(userTagId) : 'Unknown tag'
  }

  const updateEntries = (blockId: MailboxSortGroupId, next: MailboxSortTagEntry[]) => {
    onChange(blockId === 'group:system' ? { ...value, systemTags: next } : { ...value, userTags: next })
  }

  const moveDate = (toFront: boolean) => {
    onChange({ ...value, order: toFront ? ['date', ...groupIds] : [...groupIds, 'date'] })
  }

  const swapGroups = () => {
    const swapped: MailboxSortGroupId[] = [groupIds[1], groupIds[0]]
    onChange({ ...value, order: dateFirst ? ['date', ...swapped] : [...swapped, 'date'] })
  }

  const dateRow = (
    <div className="rounded-md border border-border bg-background">
      <div className="flex items-center gap-2 px-1.5 py-1">
        <div className="flex flex-col">
          <IconButton
            size="micro"
            label="Raise Date priority"
            title="Raise priority"
            icon={<ArrowUp />}
            onClick={() => moveDate(true)}
            disabled={dateFirst}
          />
          <IconButton
            size="micro"
            label="Lower Date priority"
            title="Lower priority"
            icon={<ArrowDown />}
            onClick={() => moveDate(false)}
            disabled={!dateFirst}
          />
        </div>
        <span className="w-4 shrink-0 text-center text-[10px] font-semibold text-muted-foreground">{dateFirst ? 1 : 3}</span>

        <SegmentedControl
          label="Date sort direction"
          size="compact"
          options={[
            { value: 'newest', label: 'Descending', title: 'Newest first' },
            { value: 'oldest', label: 'Ascending', title: 'Oldest first' },
          ]}
          value={value.dateDirection}
          onChange={(direction) => onChange({ ...value, dateDirection: direction })}
        />

        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-medium">
          <input
            type="checkbox"
            checked={value.dateEnabled}
            onChange={() => onChange({ ...value, dateEnabled: !value.dateEnabled })}
            aria-label="Use Date for sorting"
            className="h-3.5 w-3.5 rounded border-input accent-primary"
          />
          <span className={value.dateEnabled ? 'text-foreground' : 'text-muted-foreground'}>
            {MAILBOX_SORT_BLOCK_LABELS.date}
          </span>
        </label>
      </div>
    </div>
  )

  const renderGroup = (blockId: MailboxSortGroupId, columnIndex: number) => {
    const entries = blockId === 'group:system' ? value.systemTags : value.userTags
    const restrictedCount = entries.filter((entry) => entry.mode !== 'sort').length

    return (
      <div key={blockId} className="min-w-0 rounded-md border border-border bg-background">
        <div className="flex items-center gap-1 px-1 py-1">
          <IconButton
            size="micro"
            label={`Raise ${MAILBOX_SORT_BLOCK_LABELS[blockId]} priority`}
            title="Raise priority"
            icon={<ArrowLeft />}
            onClick={swapGroups}
            disabled={columnIndex === 0}
          />
          <IconButton
            size="micro"
            label={`Lower ${MAILBOX_SORT_BLOCK_LABELS[blockId]} priority`}
            title="Lower priority"
            icon={<ArrowRight />}
            onClick={swapGroups}
            disabled={columnIndex === groupIds.length - 1}
          />
          <div className="flex min-w-0 flex-1 items-center justify-between gap-1 text-[11px] font-medium">
            <span className="truncate" title={MAILBOX_SORT_BLOCK_LABELS[blockId]}>
              {(dateFirst ? 2 : 1) + columnIndex}. {MAILBOX_SORT_BLOCK_LABELS[blockId]}
            </span>
            <span className="shrink-0 text-[10px] font-normal text-muted-foreground">
              {restrictedCount > 0 ? `${restrictedCount} rule${restrictedCount === 1 ? '' : 's'}` : `${entries.length} tags`}
            </span>
          </div>
        </div>

        <div className="space-y-0.5 border-t border-border px-1 py-1">
          {entries.map((entry, entryIndex) => (
            <div key={entry.id} className="flex items-center gap-1">
              <div className="flex flex-col">
                <IconButton
                  size="micro"
                  label={`Raise ${resolveEntryLabel(entry.id)} priority`}
                  title="Raise priority"
                  icon={<ArrowUp />}
                  onClick={() => updateEntries(blockId, moveSortEntryById(entries, entry.id, -1))}
                  disabled={entryIndex === 0}
                />
                <IconButton
                  size="micro"
                  label={`Lower ${resolveEntryLabel(entry.id)} priority`}
                  title="Lower priority"
                  icon={<ArrowDown />}
                  onClick={() => updateEntries(blockId, moveSortEntryById(entries, entry.id, 1))}
                  disabled={entryIndex === entries.length - 1}
                />
              </div>
              <span className="min-w-0 flex-1 truncate text-[11px]" title={resolveEntryLabel(entry.id)}>
                {resolveEntryLabel(entry.id)}
              </span>
              <select
                value={entry.mode}
                onChange={(event) => updateEntries(blockId, entries.map((item) => (
                  item.id === entry.id ? { ...item, mode: event.target.value as MailboxTagMode } : item
                )))}
                title={MAILBOX_TAG_MODE_HINTS[entry.mode]}
                aria-label={`${resolveEntryLabel(entry.id)} rule`}
                className={`w-16 shrink-0 rounded-md border px-1 py-0.5 text-[10px] font-medium transition-colors ${MODE_STYLES[entry.mode]}`}
              >
                {MAILBOX_TAG_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {MAILBOX_TAG_MODE_LABELS[mode]}
                  </option>
                ))}
              </select>
            </div>
          ))}

          {blockId === 'group:user' && entries.length === 0 && (
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
    <div className="space-y-1">
      {dateFirst && dateRow}
      <div className="grid grid-cols-2 items-start gap-1">
        {groupIds.map(renderGroup)}
      </div>
      {!dateFirst && dateRow}
    </div>
  )
}

export default MailboxSortOrderEditor
