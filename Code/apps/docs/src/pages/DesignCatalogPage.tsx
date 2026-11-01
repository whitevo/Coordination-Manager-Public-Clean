import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { catalog } from '../design-catalog/registry'
import { CatalogCard } from '../design-catalog/CatalogCard'
import { CATALOG_PREVIEW_THEMES, ThemeComparisonChecklist } from '../design-catalog/ThemeComparisonChecklist'
import type { CatalogCategory, CatalogNamespace, CatalogStatus } from '../design-catalog/types'

const CATEGORIES: CatalogCategory[] = ['Buttons', 'Cards', 'Status', 'Category', 'Count', 'Score', 'Inputs', 'Overlays', 'Panels', 'Disclosure', 'Feedback', 'Data', 'Motion']
const NAMESPACES: { id: CatalogNamespace | 'all'; label: string }[] = [
  { id: 'all', label: 'All namespaces' },
  { id: 'structural', label: 'Structural' },
  { id: 'semantic', label: 'Semantic' },
  { id: 'feature', label: 'Feature identity' },
  { id: 'data', label: 'Data / category' },
]
const STATUSES: { id: CatalogStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'default', label: 'Default' },
  { id: 'alt', label: 'Alt' },
  { id: 'drift', label: 'Drift' },
]
const PREVIEW_SOURCES = [
  { id: 'all', label: 'All preview sources' },
  { id: 'primitive', label: 'Web primitive' },
  { id: 'recipe snapshot', label: 'Recipe snapshot' },
  { id: 'target only', label: 'Target only' },
] as const

/** Extracts source page/component names (leading PascalCase token) from an entry's usedOn list. */
function entrySources(usedOn: string[]): string[] {
  const out = new Set<string>()
  for (const raw of usedOn) {
    const base = raw.split('(')[0].trim()
    if (/^[A-Z][A-Za-z0-9]+$/.test(base)) out.add(base)
  }
  return [...out]
}

export function DesignCatalogPage() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<CatalogCategory | 'All'>('All')
  const [status, setStatus] = useState<CatalogStatus | 'all'>('all')
  const [namespace, setNamespace] = useState<CatalogNamespace | 'all'>('all')
  const [previewSource, setPreviewSource] = useState<(typeof PREVIEW_SOURCES)[number]['id']>('all')
  const [source, setSource] = useState<string>('all')
  const [selectedThemeIds, setSelectedThemeIds] = useState<Set<string>>(
    () => new Set(['default-light', 'default-dark'])
  )

  const selectedPreviewThemes = CATALOG_PREVIEW_THEMES.filter(theme => selectedThemeIds.has(theme.id))

  const toggleTheme = (themeId: string) => {
    setSelectedThemeIds(current => {
      const next = new Set(current)
      if (next.has(themeId)) next.delete(themeId)
      else next.add(themeId)
      return next
    })
  }

  const selectAllThemes = () => setSelectedThemeIds(new Set(CATALOG_PREVIEW_THEMES.map(theme => theme.id)))
  const deselectAllThemes = () => setSelectedThemeIds(new Set())

  const sourceOptions = useMemo(() => {
    const m = new Map<string, number>()
    for (const entry of catalog) {
      for (const s of entrySources(entry.usedOn)) m.set(s, (m.get(s) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return catalog.filter(entry => {
      if (category !== 'All' && entry.category !== category) return false
      if (status !== 'all' && entry.status !== status) return false
      if (namespace !== 'all' && entry.namespace !== namespace) return false
      if (previewSource !== 'all' && entry.previewSource !== previewSource) return false
      if (source !== 'all' && !entrySources(entry.usedOn).includes(source)) return false
      if (!q) return true
      const haystack = [
        entry.name,
        entry.conceptLabel,
        entry.concept,
        entry.category,
        entry.namespace,
        entry.previewSource,
        entry.migration ?? '',
        entry.recipe,
        entry.note ?? '',
        entry.color ?? '',
        ...entry.tags,
        ...entry.usedOn,
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [query, category, status, namespace, previewSource, source])

  // Group filtered results by concept so all variants of a concept sit together.
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; items: typeof catalog }>()
    for (const entry of filtered) {
      const g = map.get(entry.concept)
      if (g) g.items.push(entry)
      else map.set(entry.concept, { label: entry.conceptLabel, items: [entry] })
    }
    return Array.from(map.values())
  }, [filtered])

  const counts = useMemo(() => {
    const c: Record<string, number> = { All: catalog.length }
    for (const cat of CATEGORIES) c[cat] = catalog.filter(e => e.category === cat).length
    return c
  }, [])

  const clearAll = () => {
    setQuery('')
    setCategory('All')
    setStatus('all')
    setNamespace('all')
    setPreviewSource('all')
    setSource('all')
  }

  const hasFilters = query !== '' || category !== 'All' || status !== 'all' || namespace !== 'all' || previewSource !== 'all' || source !== 'all'

  return (
    <div className="prose-docs w-full">
      {/* Header */}
      <div className="not-prose mb-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-brand-400">Design</p>
        <h1 className="mb-3 text-3xl font-bold text-white">Component Catalog</h1>
        <p className="max-w-3xl text-gray-400">
          Compare canonical primitive previews with legacy recipe snapshots. Each entry identifies
          its implementation source, color namespace, status, and migration target.
        </p>
      </div>

      <ThemeComparisonChecklist
        selectedThemeIds={selectedThemeIds}
        onToggleTheme={toggleTheme}
        onSelectAll={selectAllThemes}
        onDeselectAll={deselectAllThemes}
      />

      {/* Controls */}
      <div className="not-prose sticky top-16 z-20 -mx-2 mb-6 rounded-xl border border-surface-700 bg-surface-900/95 p-3 backdrop-blur-sm">
        {/* Search */}
        <div className="mb-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search components, recipes, pages, tags..."
              className="w-full rounded-lg border border-surface-700 bg-surface-850 py-2 pl-10 pr-9 text-sm text-gray-200 outline-hidden placeholder:text-gray-500 focus:border-brand-500/50 focus:ring-2 focus:ring-brand-500/20"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Source filter */}
        <div className="mb-2 flex items-center gap-2">
          <label htmlFor="source-filter" className="text-[11px] font-medium text-gray-500">
            Source
          </label>
          <select
            id="source-filter"
            value={source}
            onChange={e => setSource(e.target.value)}
            title="Filter by the page or component a variant is used on"
            className="max-w-[16rem] rounded-lg border border-surface-700 bg-surface-850 px-2.5 py-1.5 text-xs font-medium text-gray-300 outline-hidden focus:border-brand-500/50 focus:ring-2 focus:ring-brand-500/20"
          >
            <option value="all">All sources ({catalog.length})</option>
            {sourceOptions.map(([name, n]) => (
              <option key={name} value={name}>
                {name} ({n})
              </option>
            ))}
          </select>
          {source !== 'all' && (
            <button
              onClick={() => setSource('all')}
              className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-300"
            >
              <X className="h-3.5 w-3.5" />
              Clear source
            </button>
          )}
        </div>

        <div className="mb-2 flex items-center gap-2">
          <label htmlFor="preview-source-filter" className="text-[11px] font-medium text-gray-500">
            Preview
          </label>
          <select
            id="preview-source-filter"
            value={previewSource}
            onChange={e => setPreviewSource(e.target.value as (typeof PREVIEW_SOURCES)[number]['id'])}
            className="max-w-[16rem] rounded-lg border border-surface-700 bg-surface-850 px-2.5 py-1.5 text-xs font-medium text-gray-300 outline-hidden focus:border-brand-500/50 focus:ring-2 focus:ring-brand-500/20"
          >
            {PREVIEW_SOURCES.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </div>

        <div className="mb-2 flex items-center gap-2">
          <label htmlFor="namespace-filter" className="text-[11px] font-medium text-gray-500">
            Namespace
          </label>
          <select
            id="namespace-filter"
            value={namespace}
            onChange={e => setNamespace(e.target.value as CatalogNamespace | 'all')}
            className="max-w-[16rem] rounded-lg border border-surface-700 bg-surface-850 px-2.5 py-1.5 text-xs font-medium text-gray-300 outline-hidden focus:border-brand-500/50 focus:ring-2 focus:ring-brand-500/20"
          >
            {NAMESPACES.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </div>

        {/* Category chips */}
        <div className="mb-2 flex flex-wrap gap-1.5">
          {(['All', ...CATEGORIES] as const).map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                category === cat
                  ? 'bg-brand-600 text-white'
                  : 'border border-surface-700 bg-surface-850 text-gray-400 hover:bg-surface-800 hover:text-gray-200'
              }`}
            >
              {cat}
              <span className={`ml-1.5 ${category === cat ? 'text-brand-200' : 'text-gray-600'}`}>
                {counts[cat] ?? 0}
              </span>
            </button>
          ))}
        </div>

        {/* Status chips + clear */}
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUSES.map(s => (
            <button
              key={s.id}
              onClick={() => setStatus(s.id)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                status === s.id
                  ? 'bg-surface-200 text-surface-900'
                  : 'border border-surface-700 bg-surface-850 text-gray-400 hover:bg-surface-800 hover:text-gray-200'
              }`}
            >
              {s.label}
            </button>
          ))}
          {hasFilters && (
            <button
              onClick={clearAll}
              className="ml-auto flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300"
            >
              <X className="h-3.5 w-3.5" />
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="not-prose">
        <p className="mb-2 text-sm text-gray-400">
          Variants are implementations of the same component concept. Compare variants side by side,
          with the selected themes inside each card. Both grids adapt to the available space.
        </p>
        <p className="mb-4 text-xs text-gray-500">
          {filtered.length} variant{filtered.length === 1 ? '' : 's'} across {groups.length} concept
          {groups.length === 1 ? '' : 's'}
        </p>

        {groups.length === 0 ? (
          <div className="rounded-xl border border-dashed border-surface-700 py-16 text-center text-gray-500">
            No components match these filters.
          </div>
        ) : (
          <div className="space-y-8">
            {groups.map(group => (
              <section key={group.label}>
                <div className="mb-3 flex items-center gap-3">
                  <h2 className="text-lg font-semibold text-gray-100">{group.label}</h2>
                  <span className="rounded-full bg-surface-800 px-2 py-0.5 text-[11px] text-gray-400">
                    {group.items.length} variant{group.items.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,28rem),1fr))] items-start gap-4">
                  {group.items.map(entry => (
                    <CatalogCard key={entry.id} entry={entry} previewThemes={selectedPreviewThemes} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
