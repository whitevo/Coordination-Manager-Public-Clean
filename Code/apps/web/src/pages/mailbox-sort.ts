export type MailboxSortBlockId = 'date' | 'group:system' | 'group:user'

/** sort = visible and used for ordering, only = restrict the inbox to this tag, hide = remove from the inbox. */
export type MailboxTagMode = 'sort' | 'only' | 'hide'

export interface MailboxSortTagEntry {
  id: string
  mode: MailboxTagMode
}

export type MailboxSortDateDirection = 'newest' | 'oldest'

export interface MailboxSortState {
  order: MailboxSortBlockId[]
  dateEnabled: boolean
  dateDirection: MailboxSortDateDirection
  systemTags: MailboxSortTagEntry[]
  userTags: MailboxSortTagEntry[]
}

export interface MailboxSortableMessage {
  received_at: string | null
  is_read: boolean
  is_archived: boolean
  has_attachments: boolean
  is_provider_trashed: boolean
  is_provider_junk: boolean
  is_provider_sent: boolean
  is_draft?: boolean
  user_tag_ids: string[]
}

export const MAILBOX_SORT_BLOCK_IDS: MailboxSortBlockId[] = ['date', 'group:system', 'group:user']

export const MAILBOX_SORT_BLOCK_LABELS: Record<MailboxSortBlockId, string> = {
  date: 'Date',
  'group:system': 'System Tags',
  'group:user': 'Custom Tags',
}

export const MAILBOX_SYSTEM_TAG_IDS = ['unread', 'draft', 'sent', 'trash', 'junk', 'archived', 'attachments'] as const

export type MailboxSystemTagId = (typeof MAILBOX_SYSTEM_TAG_IDS)[number]

export const MAILBOX_SYSTEM_TAG_LABELS: Record<MailboxSystemTagId, string> = {
  unread: 'Unread',
  draft: 'Draft',
  sent: 'Sent',
  trash: 'Trash',
  junk: 'Junk',
  archived: 'Archived',
  attachments: 'Attachments',
}

export const MAILBOX_TAG_MODES: MailboxTagMode[] = ['sort', 'only', 'hide']

export const MAILBOX_TAG_MODE_LABELS: Record<MailboxTagMode, string> = {
  sort: 'Sort',
  only: 'Only',
  hide: 'Hide',
}

export const MAILBOX_TAG_MODE_HINTS: Record<MailboxTagMode, string> = {
  sort: 'Shown, and used for sort priority',
  only: 'Show only messages with this tag',
  hide: 'Hide messages with this tag from the inbox',
}

export function cycleTagMode(mode: MailboxTagMode): MailboxTagMode {
  return MAILBOX_TAG_MODES[(MAILBOX_TAG_MODES.indexOf(mode) + 1) % MAILBOX_TAG_MODES.length]
}

export function buildSystemSortId(tag: MailboxSystemTagId): string {
  return `system:${tag}`
}

export function buildUserSortId(tagId: string): string {
  return `user:${tagId}`
}

export function readSystemTagFromSortId(id: string): MailboxSystemTagId | null {
  if (!id.startsWith('system:')) return null
  const tag = id.slice('system:'.length)
  return (MAILBOX_SYSTEM_TAG_IDS as readonly string[]).includes(tag) ? (tag as MailboxSystemTagId) : null
}

export function readUserTagFromSortId(id: string): string | null {
  return id.startsWith('user:') ? id.slice('user:'.length) : null
}

export function buildDefaultMailboxSortState(userTagIds: string[]): MailboxSortState {
  return {
    order: [...MAILBOX_SORT_BLOCK_IDS],
    dateEnabled: true,
    dateDirection: 'newest',
    systemTags: MAILBOX_SYSTEM_TAG_IDS.map((tag) => ({
      id: buildSystemSortId(tag),
      mode: 'sort' as const,
    })),
    userTags: userTagIds.map((tagId) => ({ id: buildUserSortId(tagId), mode: 'sort' as const })),
  }
}

export function withTagMode(state: MailboxSortState, entryId: string, mode: MailboxTagMode): MailboxSortState {
  const apply = (entries: MailboxSortTagEntry[]) =>
    entries.map((entry) => (entry.id === entryId ? { ...entry, mode } : entry))

  return readUserTagFromSortId(entryId) !== null
    ? { ...state, userTags: apply(state.userTags) }
    : { ...state, systemTags: apply(state.systemTags) }
}

function reconcileEntries(stored: MailboxSortTagEntry[], expected: MailboxSortTagEntry[]): MailboxSortTagEntry[] {
  const expectedIds = new Set(expected.map((entry) => entry.id))
  const kept = stored.filter((entry) => expectedIds.has(entry.id))
  const keptIds = new Set(kept.map((entry) => entry.id))
  return [...kept, ...expected.filter((entry) => !keptIds.has(entry.id))]
}

/** Drop entries for tags that no longer exist and append entries for tags that appeared since the state was stored. */
export function reconcileMailboxSortState(state: MailboxSortState, userTagIds: string[]): MailboxSortState {
  const defaults = buildDefaultMailboxSortState(userTagIds)
  const keptOrder = state.order.filter((blockId) => MAILBOX_SORT_BLOCK_IDS.includes(blockId))
  const missingOrder = MAILBOX_SORT_BLOCK_IDS.filter((blockId) => !keptOrder.includes(blockId))

  return {
    order: [...keptOrder, ...missingOrder],
    dateEnabled: state.dateEnabled,
    dateDirection: state.dateDirection,
    systemTags: reconcileEntries(state.systemTags, defaults.systemTags),
    userTags: reconcileEntries(state.userTags, defaults.userTags),
  }
}

function parseTagMode(value: unknown): MailboxTagMode {
  return value === 'only' || value === 'hide' ? value : 'sort'
}

function parseTagEntries(value: unknown, isValidId: (id: string) => boolean): MailboxSortTagEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return []
    const source = item as Record<string, unknown>
    if (typeof source.id !== 'string' || !isValidId(source.id)) return []
    return [{ id: source.id, mode: parseTagMode(source.mode) }]
  })
}

export function parseMailboxSortState(value: unknown, userTagIds: string[]): MailboxSortState {
  if (typeof value !== 'object' || value === null) return buildDefaultMailboxSortState(userTagIds)

  const source = value as Record<string, unknown>
  const order = Array.isArray(source.order)
    ? source.order.filter((blockId): blockId is MailboxSortBlockId =>
        typeof blockId === 'string' && (MAILBOX_SORT_BLOCK_IDS as string[]).includes(blockId))
    : []

  return reconcileMailboxSortState({
    order,
    dateEnabled: source.dateEnabled !== false,
    dateDirection: source.dateDirection === 'oldest' ? 'oldest' : 'newest',
    systemTags: parseTagEntries(source.systemTags, (id) => readSystemTagFromSortId(id) !== null),
    userTags: parseTagEntries(source.userTags, (id) => readUserTagFromSortId(id) !== null),
  }, userTagIds)
}

/** Move the item at index one step towards the front (delta -1) or the back (delta 1). */
export function moveSortItem<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return list

  const next = [...list]
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved)
  return next
}

export function moveSortEntryById(list: MailboxSortTagEntry[], id: string, delta: number): MailboxSortTagEntry[] {
  return moveSortItem(list, list.findIndex((entry) => entry.id === id), delta)
}

export function messageHasTag<T extends MailboxSortableMessage>(
  message: T,
  entryId: string,
  isJunk: (message: T) => boolean,
): boolean {
  const systemTag = readSystemTagFromSortId(entryId)
  if (systemTag) {
    switch (systemTag) {
      case 'unread':
        return !message.is_read
      case 'draft':
        return message.is_draft === true
      case 'sent':
        return message.is_provider_sent
      case 'trash':
        return message.is_provider_trashed
      case 'junk':
        return message.is_provider_junk || isJunk(message)
      case 'archived':
        return message.is_archived
      case 'attachments':
        return message.has_attachments
    }
  }

  const userTagId = readUserTagFromSortId(entryId)
  return userTagId !== null && message.user_tag_ids.includes(userTagId)
}

/** Tag visibility rules, keyed by sort entry id. */
export type MailboxTagModeMap = Map<string, MailboxTagMode>

export function isMessageVisible<T extends MailboxSortableMessage>(
  message: T,
  modes: MailboxTagModeMap,
  isJunk: (message: T) => boolean,
): boolean {
  for (const [entryId, mode] of modes) {
    if (mode === 'sort') continue
    const hasTag = messageHasTag(message, entryId, isJunk)
    if (mode === 'hide' && hasTag) return false
    if (mode === 'only' && !hasTag) return false
  }

  return true
}

function compareTimestamps(a: string | null, b: string | null, direction: MailboxSortDateDirection): number {
  const aMs = a ? new Date(a).getTime() : Number.NaN
  const bMs = b ? new Date(b).getTime() : Number.NaN
  const aValid = Number.isFinite(aMs)
  const bValid = Number.isFinite(bMs)

  if (!aValid && !bValid) return 0
  if (!aValid) return 1
  if (!bValid) return -1
  return direction === 'newest' ? bMs - aMs : aMs - bMs
}

export function sortMailboxMessages<T extends MailboxSortableMessage>(
  messages: T[],
  state: MailboxSortState,
  isJunk: (message: T) => boolean,
): T[] {
  const getFirstMatchingEntryIndex = (message: T, entries: MailboxSortTagEntry[]): number | null => {
    const index = entries.findIndex((entry) => entry.mode !== 'hide' && messageHasTag(message, entry.id, isJunk))
    return index >= 0 ? index : null
  }

  const compareEntries = (a: T, b: T, entries: MailboxSortTagEntry[]): number => {
    const aIndex = getFirstMatchingEntryIndex(a, entries)
    const bIndex = getFirstMatchingEntryIndex(b, entries)

    if (aIndex === null && bIndex === null) return 0
    if (aIndex === null) return 1
    if (bIndex === null) return -1
    return aIndex - bIndex
  }

  return [...messages].sort((a, b) => {
    for (const blockId of state.order) {
      if (blockId === 'date') {
        if (!state.dateEnabled) continue
        const result = compareTimestamps(a.received_at, b.received_at, state.dateDirection)
        if (result !== 0) return result
        continue
      }

      const result = compareEntries(a, b, blockId === 'group:system' ? state.systemTags : state.userTags)
      if (result !== 0) return result
    }

    return 0
  })
}
