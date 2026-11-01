import { describe, expect, it } from 'vitest'
import {
  MAILBOX_DEFAULT_FILTER_ID,
  MAILBOX_MAX_FILTERS,
  buildCustomMailboxFilter,
  buildDefaultMailboxFilterState,
  buildDefaultViewSortState,
  canCreateMailboxFilter,
  canDeleteMailboxFilter,
  isPrimaryMailboxFilter,
  makeMailboxFilterPrimary,
  orderMailboxFiltersPrimaryFirst,
  parseMailboxFilterState,
  resolveActiveFilter,
  resolveActiveSortState,
  resolveEffectiveTagModes,
} from '../mailbox-filters'

describe('buildDefaultMailboxFilterState', () => {
  it('starts on a Default view that shows sent mail', () => {
    const state = buildDefaultMailboxFilterState([])

    expect(state.activeFilterId).toBe(MAILBOX_DEFAULT_FILTER_ID)
    expect(state.filters[0].name).toBe('Show All')
    expect(state.filters[0].sort.systemTags.every((entry) => entry.mode === 'sort')).toBe(true)
  })

  it('ships the presets with their own rules', () => {
    const state = buildDefaultMailboxFilterState([])

    expect(state.filters.map((filter) => filter.name)).toEqual([
      'Show All',
      'Hide Trashed',
      'Hide Read',
      'Hide Junk',
      'Has Attachments',
    ])
    expect(state.filters[1].sort.systemTags.find((entry) => entry.id === 'system:trash')?.mode).toBe('hide')
    expect(state.filters[2].sort.systemTags.find((entry) => entry.id === 'system:unread')?.mode).toBe('only')
    expect(state.filters.every((filter) => filter.sort.systemTags.find((entry) => entry.id === 'system:sent')?.mode === 'sort')).toBe(true)
  })

})

describe('filter limits', () => {
  it('allows creating filters up to the maximum', () => {
    const state = buildDefaultMailboxFilterState([])
    expect(canCreateMailboxFilter(state)).toBe(true)

    state.filters = Array.from({ length: MAILBOX_MAX_FILTERS }, (_, i) => buildCustomMailboxFilter(`f${i}`, []))
    expect(canCreateMailboxFilter(state)).toBe(false)
  })

  it('blocks deleting the last remaining filter', () => {
    const state = buildDefaultMailboxFilterState([])
    expect(canDeleteMailboxFilter(state)).toBe(true)

    state.filters = [state.filters[0]]
    expect(canDeleteMailboxFilter(state)).toBe(false)
  })
})

describe('resolveActiveSortState', () => {
  it('uses the active filter', () => {
    const state = buildDefaultMailboxFilterState([])
    state.activeFilterId = 'preset-hide-junk'

    expect(resolveActiveFilter(state)?.name).toBe('Hide Junk')
    expect(resolveActiveSortState(state, [])).toBe(state.filters[3].sort)
  })

  it('falls back to the built-in default view when nothing is active', () => {
    const state = buildDefaultMailboxFilterState([])
    state.activeFilterId = null

    expect(resolveActiveFilter(state)).toBeNull()
    expect(resolveActiveSortState(state, [])).toEqual(buildDefaultViewSortState([]))
  })
})

describe('resolveEffectiveTagModes', () => {
  it('reads the rules of the active filter only', () => {
    const state = buildDefaultMailboxFilterState([])
    state.activeFilterId = 'preset-hide-read'

    const modes = resolveEffectiveTagModes(state, [])

    expect(modes.get('system:unread')).toBe('only')
    expect(modes.get('system:junk')).toBe('sort')
  })

  it('applies the show-all default rules when nothing is active', () => {
    const state = { ...buildDefaultMailboxFilterState([]), activeFilterId: null }
    expect(resolveEffectiveTagModes(state, []).get('system:archived')).toBe('sort')
  })
})

describe('makeMailboxFilterPrimary', () => {
  it('applies the filter without changing the shared rule ordering', () => {
    const state = makeMailboxFilterPrimary(buildDefaultMailboxFilterState([]), 'preset-hide-junk')

    expect(state.activeFilterId).toBe('preset-hide-junk')
    expect(state.filters.map((filter) => filter.name)).toEqual([
      'Show All',
      'Hide Trashed',
      'Hide Read',
      'Hide Junk',
      'Has Attachments',
    ])
  })

  it('keeps the primary designation device-local', () => {
    const state = makeMailboxFilterPrimary(buildDefaultMailboxFilterState([]), 'preset-hide-read')

    expect(isPrimaryMailboxFilter('preset-hide-read', state.activeFilterId!)).toBe(true)
    expect(isPrimaryMailboxFilter('preset-hide-junk', state.activeFilterId!)).toBe(false)
  })

  it('ignores an unknown filter id', () => {
    const state = buildDefaultMailboxFilterState([])
    expect(makeMailboxFilterPrimary(state, 'missing')).toBe(state)
  })
})

describe('orderMailboxFiltersPrimaryFirst', () => {
  it('moves the primary filter first for display without mutating the saved order', () => {
    const filters = buildDefaultMailboxFilterState([]).filters

    const ordered = orderMailboxFiltersPrimaryFirst(filters, 'preset-hide-junk')

    expect(ordered.map((filter) => filter.id)).toEqual([
      'preset-hide-junk',
      'preset-default',
      'preset-hide-trashed',
      'preset-hide-read',
      'preset-has-attachments',
    ])
    expect(filters[0].id).toBe('preset-default')
  })

  it('keeps the saved order when there is no matching primary filter', () => {
    const filters = buildDefaultMailboxFilterState([]).filters

    expect(orderMailboxFiltersPrimaryFirst(filters, 'missing')).toBe(filters)
  })
})

describe('parseMailboxFilterState', () => {
  it('falls back to defaults for malformed or empty session values', () => {
    expect(parseMailboxFilterState('not json', [])).toEqual(buildDefaultMailboxFilterState([]))
    expect(parseMailboxFilterState(null, [])).toEqual(buildDefaultMailboxFilterState([]))
    expect(parseMailboxFilterState(JSON.stringify({ filters: [] }), [])).toEqual(buildDefaultMailboxFilterState([]))
  })

  it('round-trips user-created filters and falls back to the primary filter for a dangling active id', () => {
    const created = buildCustomMailboxFilter('Invoices', ['tag-a'])
    const raw = JSON.stringify({ filters: [created], activeFilterId: 'missing-filter' })

    const state = parseMailboxFilterState(raw, ['tag-a'])

    expect(state.filters).toHaveLength(1)
    expect(state.filters[0].name).toBe('Invoices')
    expect(state.activeFilterId).toBe(created.id)
  })

  it('caps a stored list at the maximum filter count', () => {
    const filters = Array.from({ length: MAILBOX_MAX_FILTERS + 4 }, (_, i) => buildCustomMailboxFilter(`f${i}`, []))
    const state = parseMailboxFilterState(JSON.stringify({ filters, activeFilterId: null }), [])

    expect(state.filters).toHaveLength(MAILBOX_MAX_FILTERS)
  })
})
