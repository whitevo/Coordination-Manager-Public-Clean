import {
  buildDefaultMailboxSortState,
  buildSystemSortId,
  parseMailboxSortState,
  reconcileMailboxSortState,
  withTagMode,
  type MailboxSortState,
  type MailboxTagMode,
  type MailboxTagModeMap,
} from './mailbox-sort'

export interface MailboxFilter {
  id: string
  name: string
  sort: MailboxSortState
}

export interface MailboxFilterState {
  filters: MailboxFilter[]
  /** Only one filter applies at a time; null falls back to the built-in default view. */
  activeFilterId: string | null
}

export const MAILBOX_FILTERS_STATE_KEY_PREFIX = 'mailbox:filters:v5:'

export const MAILBOX_PRIMARY_FILTER_KEY_PREFIX = 'mailbox:primary-filter:v1:'

export const MAILBOX_MAX_FILTERS = 10

export const MAILBOX_DEFAULT_FILTER_ID = 'preset-default'

/** The initial mailbox view includes every imported message. */
export function buildDefaultViewSortState(userTagIds: string[]): MailboxSortState {
  return buildDefaultMailboxSortState(userTagIds)
}

interface PresetDefinition {
  id: string
  name: string
  tagId: string
  mode: MailboxTagMode
}

const PRESET_DEFINITIONS: PresetDefinition[] = [
  { id: 'preset-hide-trashed', name: 'Hide Trashed', tagId: buildSystemSortId('trash'), mode: 'hide' },
  { id: 'preset-hide-read', name: 'Hide Read', tagId: buildSystemSortId('unread'), mode: 'only' },
  { id: 'preset-hide-junk', name: 'Hide Junk', tagId: buildSystemSortId('junk'), mode: 'hide' },
  { id: 'preset-has-attachments', name: 'Has Attachments', tagId: buildSystemSortId('attachments'), mode: 'only' },
]

export function buildDefaultMailboxFilterState(userTagIds: string[]): MailboxFilterState {
  return {
    filters: [
      { id: MAILBOX_DEFAULT_FILTER_ID, name: 'Show All', sort: buildDefaultViewSortState(userTagIds) },
      ...PRESET_DEFINITIONS.map((preset) => ({
        id: preset.id,
        name: preset.name,
        sort: withTagMode(buildDefaultViewSortState(userTagIds), preset.tagId, preset.mode),
      })),
    ],
    activeFilterId: MAILBOX_DEFAULT_FILTER_ID,
  }
}

export function buildCustomMailboxFilter(name: string, userTagIds: string[]): MailboxFilter {
  return {
    id: `filter-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    sort: buildDefaultViewSortState(userTagIds),
  }
}

export function canDeleteMailboxFilter(state: MailboxFilterState): boolean {
  return state.filters.length > 1
}

export function canCreateMailboxFilter(state: MailboxFilterState): boolean {
  return state.filters.length < MAILBOX_MAX_FILTERS
}

export function isPrimaryMailboxFilter(primaryFilterId: string | null, filterId: string): boolean {
  return primaryFilterId === filterId
}

export function orderMailboxFiltersPrimaryFirst(
  filters: MailboxFilter[],
  primaryFilterId: string | null
): MailboxFilter[] {
  const primaryIndex = filters.findIndex((filter) => filter.id === primaryFilterId)
  if (primaryIndex <= 0) return filters

  return [filters[primaryIndex], ...filters.slice(0, primaryIndex), ...filters.slice(primaryIndex + 1)]
}

/** Primary selection is persisted separately per device, not by reordering shared filter rules. */
export function makeMailboxFilterPrimary(state: MailboxFilterState, filterId: string): MailboxFilterState {
  if (!state.filters.some((filter) => filter.id === filterId)) return state

  return {
    filters: state.filters,
    activeFilterId: filterId,
  }
}

function parseFilter(value: unknown, userTagIds: string[]): MailboxFilter | null {
  if (typeof value !== 'object' || value === null) return null
  const source = value as Record<string, unknown>
  if (typeof source.id !== 'string' || typeof source.name !== 'string') return null

  return {
    id: source.id,
    name: source.name,
    sort: parseMailboxSortState(source.sort, userTagIds),
  }
}

export function parseMailboxFilterState(raw: string | null, userTagIds: string[]): MailboxFilterState {
  if (!raw) return buildDefaultMailboxFilterState(userTagIds)

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return buildDefaultMailboxFilterState(userTagIds)

    const source = parsed as Record<string, unknown>
    const filters = Array.isArray(source.filters)
      ? source.filters.flatMap((item) => {
          const filter = parseFilter(item, userTagIds)
          return filter ? [filter] : []
        }).slice(0, MAILBOX_MAX_FILTERS)
      : []

    if (filters.length === 0) return buildDefaultMailboxFilterState(userTagIds)

    const activeFilterId = typeof source.activeFilterId === 'string' ? source.activeFilterId : null

    return {
      filters: filters.map((filter) => ({ ...filter, sort: reconcileMailboxSortState(filter.sort, userTagIds) })),
      // Falling back to the primary (first) filter keeps a deliberate default view after a storage reset.
      activeFilterId: filters.some((filter) => filter.id === activeFilterId) ? activeFilterId : filters[0].id,
    }
  } catch {
    return buildDefaultMailboxFilterState(userTagIds)
  }
}

export function readMailboxFilterState(storageKey: string, userTagIds: string[]): MailboxFilterState {
  if (typeof window === 'undefined') return buildDefaultMailboxFilterState(userTagIds)

  try {
    const currentValue = window.localStorage.getItem(storageKey)
    if (currentValue) return parseMailboxFilterState(currentValue, userTagIds)

    const sessionValue = window.sessionStorage.getItem(storageKey.replace(':v5:', ':v4:'))
    if (sessionValue) return parseMailboxFilterState(sessionValue, userTagIds)

    const legacyValue = window.sessionStorage.getItem(storageKey.replace(':v5:', ':v3:'))
    const legacyState = parseMailboxFilterState(legacyValue, userTagIds)

    return {
      ...legacyState,
      filters: legacyState.filters.map((filter) => ({
        ...filter,
        sort: withTagMode(filter.sort, buildSystemSortId('sent'), 'sort'),
      })),
    }
  } catch {
    return buildDefaultMailboxFilterState(userTagIds)
  }
}

/** True when this device already has a usable copy of the filter rules, so the inbox can be filtered on the very first paint. */
export function hasStoredMailboxFilterState(storageKey: string): boolean {
  if (typeof window === 'undefined') return false

  try {
    return Boolean(
      window.localStorage.getItem(storageKey) ||
        window.sessionStorage.getItem(storageKey.replace(':v5:', ':v4:')) ||
        window.sessionStorage.getItem(storageKey.replace(':v5:', ':v3:'))
    )
  } catch {
    return false
  }
}

export function writeMailboxFilterState(storageKey: string, state: MailboxFilterState): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state))
  } catch {
    // Local storage can be unavailable (private mode / quota); filters still apply for this view.
  }
}

export function readMailboxPrimaryFilterId(storageKey: string, filterIds: string[]): string | null {
  if (typeof window === 'undefined') return null

  try {
    const stored = window.localStorage.getItem(storageKey)
    return stored && filterIds.includes(stored) ? stored : null
  } catch {
    return null
  }
}

export function writeMailboxPrimaryFilterId(storageKey: string, filterId: string | null): void {
  if (typeof window === 'undefined') return

  try {
    if (filterId) window.localStorage.setItem(storageKey, filterId)
    else window.localStorage.removeItem(storageKey)
  } catch {
    // Local storage can be unavailable (private mode / quota); the current view still applies.
  }
}

export function resolveActiveFilter(state: MailboxFilterState): MailboxFilter | null {
  return state.filters.find((filter) => filter.id === state.activeFilterId) ?? null
}

export function resolveActiveSortState(state: MailboxFilterState, userTagIds: string[]): MailboxSortState {
  return resolveActiveFilter(state)?.sort ?? buildDefaultViewSortState(userTagIds)
}

export function resolveEffectiveTagModes(state: MailboxFilterState, userTagIds: string[]): MailboxTagModeMap {
  const sort = resolveActiveSortState(state, userTagIds)
  const modes: MailboxTagModeMap = new Map()

  for (const entry of [...sort.systemTags, ...sort.userTags]) {
    modes.set(entry.id, entry.mode)
  }

  return modes
}
