/**
 * Catalog of Time Management data the AI assistant may read. Defaults are off
 * because calendar time items can contain private notes and meeting links.
 */

export type TimeManagementAiAccessId =
  | 'timeItems'
  | 'categories'
  | 'connectedCalendars'

export interface TimeManagementAiAccessEntry {
  id: TimeManagementAiAccessId
  label: string
  data: string[]
  abilities: string[]
  status: 'active' | 'planned'
}

export const TIME_MANAGEMENT_AI_ACCESS_ENTRIES: readonly TimeManagementAiAccessEntry[] = [
  {
    id: 'timeItems',
    label: 'Calendar time items',
    data: [
      'Time item titles, descriptions, dates, times, recurrence, categories, and address fields (meeting links and locations)',
    ],
    abilities: [
      'Search visible time items by title, date range, or description text.',
      'Answer questions about what is scheduled in the current Time Management view.',
      'Find meeting links and locations attached to time items, and summarise recurrence.',
    ],
    status: 'active',
  },
  {
    id: 'categories',
    label: 'Categories',
    data: ['Category labels and colors'],
    abilities: [
      'Filter or group time items by category.',
      'Use existing category names when creating or updating items.',
    ],
    status: 'active',
  },
  {
    id: 'connectedCalendars',
    label: 'Connected calendar sources',
    data: ['Calendar source names, enabled state, and source type'],
    abilities: [
      'Explain which connected calendars feed the visible schedule.',
      'Scope suggestions to a specific calendar source.',
    ],
    status: 'active',
  },
] as const

export type TimeManagementAiAccessConfig = Record<TimeManagementAiAccessId, boolean>

export const DEFAULT_TIME_MANAGEMENT_AI_ACCESS: TimeManagementAiAccessConfig = TIME_MANAGEMENT_AI_ACCESS_ENTRIES.reduce(
  (acc, entry) => {
    acc[entry.id] = false
    return acc
  },
  {} as TimeManagementAiAccessConfig,
)

export function normalizeTimeManagementAiAccess(value: unknown): TimeManagementAiAccessConfig {
  const source = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return TIME_MANAGEMENT_AI_ACCESS_ENTRIES.reduce((acc, entry) => {
    acc[entry.id] = typeof source[entry.id] === 'boolean' ? (source[entry.id] as boolean) : false
    return acc
  }, {} as TimeManagementAiAccessConfig)
}
