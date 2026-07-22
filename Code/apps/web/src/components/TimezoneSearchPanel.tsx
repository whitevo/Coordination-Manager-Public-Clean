import { useState, useMemo, useRef, useEffect } from 'react'
import { Search, X, MapPin, Clock, Globe } from 'lucide-react'
import {
  searchTimezones,
  groupByRegion,
  groupByCountry,
  type TimezoneEntry,
} from '../lib/timezone-data'

interface TimezoneSearchPanelProps {
  /** Called when a timezone is selected */
  onSelect: (entry: TimezoneEntry) => void
  /** Called when the panel should close */
  onClose: () => void
  /** Currently active timezone IANA ids (to highlight) */
  activeTimezones?: string[]
  /** Label shown in header, e.g. "Set Primary Timezone" */
  title?: string
}

const REGION_LABELS: Record<string, string> = {
  UTC: 'UTC',
  America: 'Americas',
  Europe: 'Europe',
  Asia: 'Asia',
  Africa: 'Africa',
  Australia: 'Oceania',
  Pacific: 'Pacific',
}

function regionLabel(key: string): string {
  return REGION_LABELS[key] || key
}

type GroupMode = 'region' | 'country'

export default function TimezoneSearchPanel({
  onSelect,
  onClose,
  activeTimezones = [],
  title = 'Select Timezone',
}: TimezoneSearchPanelProps) {
  const [query, setQuery] = useState('')
  const [groupMode, setGroupMode] = useState<GroupMode>('region')
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Auto-focus search input
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 100)
    return () => clearTimeout(timer)
  }, [])

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  // No click-outside-to-close -- panel stays open until user clicks X or presses Escape

  const filtered = useMemo(() => searchTimezones(query), [query])

  const grouped = useMemo(() => {
    if (groupMode === 'country') return groupByCountry(filtered)
    return groupByRegion(filtered)
  }, [filtered, groupMode])

  const groupKeys = useMemo(() => {
    const keys = Object.keys(grouped)
    if (groupMode === 'region') {
      // Sort regions in a sensible order
      const order = ['UTC', 'America', 'Europe', 'Africa', 'Asia', 'Australia', 'Pacific']
      return keys.sort((a, b) => {
        const ai = order.indexOf(a)
        const bi = order.indexOf(b)
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
      })
    }
    return keys.sort()
  }, [grouped, groupMode])

  const totalResults = filtered.length

  return (
    <div
      ref={panelRef}
      className="absolute z-50 mt-2 w-[28rem] bg-card border border-border rounded-xl shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <button
          onClick={onClose}
          className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Search Input */}
      <div className="px-4 py-3 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            ref={inputRef}
            id="timezone-search-input"
            name="timezoneSearch"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search city, country, or timezone..."
            className="w-full pl-10 pr-10 py-2 text-sm border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted text-muted-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Group mode toggle + result count */}
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-muted-foreground">
            {totalResults} timezone{totalResults !== 1 ? 's' : ''}
          </span>
          <div className="flex rounded-md border border-border overflow-hidden">
            <button
              onClick={() => setGroupMode('region')}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                groupMode === 'region'
                  ? 'bg-blue-600 text-white'
                  : 'bg-background text-muted-foreground hover:bg-muted'
              }`}
            >
              <Globe className="w-3 h-3 inline mr-1" />
              Region
            </button>
            <button
              onClick={() => setGroupMode('country')}
              className={`px-2.5 py-1 text-xs font-medium transition-colors border-l border-border ${
                groupMode === 'country'
                  ? 'bg-blue-600 text-white'
                  : 'bg-background text-muted-foreground hover:bg-muted'
              }`}
            >
              <MapPin className="w-3 h-3 inline mr-1" />
              Country
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable Results */}
      <div className="max-h-[28rem] overflow-y-auto overscroll-contain">
        {groupKeys.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No timezones found for &quot;{query}&quot;
          </div>
        ) : (
          groupKeys.map((groupKey) => (
            <div key={groupKey}>
              {/* Group Header */}
              <div className="sticky top-0 z-10 px-4 py-1.5 bg-muted/60 backdrop-blur-sm border-b border-border">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {groupMode === 'region' ? regionLabel(groupKey) : groupKey}
                </span>
              </div>

              {/* Timezone Rows */}
              <table className="w-full">
                <tbody>
                  {grouped[groupKey].map((tz) => {
                    const isActive = activeTimezones.includes(tz.iana)
                    return (
                      <tr
                        key={tz.iana}
                        onClick={() => onSelect(tz)}
                        className={`cursor-pointer transition-colors ${
                          isActive
                            ? 'bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-950/50'
                            : 'hover:bg-muted/50'
                        }`}
                      >
                        <td className="pl-4 pr-2 py-2">
                          <div className="flex items-center gap-2">
                            <Clock className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}`} />
                            <span className={`text-sm font-medium ${isActive ? 'text-blue-700 dark:text-blue-300' : 'text-foreground'}`}>
                              {tz.city}
                            </span>
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <span className="text-xs text-muted-foreground">{tz.country}</span>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <span className="inline-block px-1.5 py-0.5 text-xs font-mono rounded bg-muted text-muted-foreground">
                            {tz.abbr}
                          </span>
                        </td>
                        <td className="pr-4 pl-2 py-2 text-right">
                          <span className="text-xs font-mono text-muted-foreground">
                            {tz.utcOffset}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
