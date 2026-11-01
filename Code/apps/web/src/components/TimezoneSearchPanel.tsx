import { useState, useMemo, useRef, useEffect, useId } from 'react'
import { Search, X, MapPin, Clock, Globe, LocateFixed } from 'lucide-react'
import {
  searchTimezones,
  groupByRegion,
  groupByCountry,
  detectLocalTimezone,
  type TimezoneEntry,
} from '../lib/timezone-data'
import { IconButton, SegmentedControl } from './ui'

interface TimezoneSearchPanelProps {
  /** Called when a timezone is selected */
  onSelect: (entry: TimezoneEntry) => void
  /** Called when the user chooses to apply the browser-detected timezone */
  onApplyBrowserTimezone?: () => void
  /** Currently active timezone IANA ids (to highlight) */
  activeTimezones?: string[]
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
  onApplyBrowserTimezone,
  activeTimezones = [],
}: TimezoneSearchPanelProps) {
  const [query, setQuery] = useState('')
  const [groupMode, setGroupMode] = useState<GroupMode>('region')
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const browserTimezone = useMemo(() => detectLocalTimezone(), [])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

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
    <div className="space-y-3">
      {/* Search Input */}
      <div className="pb-3 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            ref={inputRef}
            id={inputId}
            aria-label="Search timezones"
            name="timezoneSearch"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search city, country, or timezone..."
            className="w-full min-h-11 pl-10 pr-10 py-2 text-sm border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring/50 focus:border-ring"
          />
          {query && (
            <IconButton
              label="Clear search"
              icon={<X />}
              onClick={() => {
                setQuery('')
                inputRef.current?.focus()
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 min-h-11 min-w-11"
            />
          )}
        </div>

        {/* Group mode toggle + result count */}
        <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
          <span className="text-xs text-muted-foreground">
            {totalResults} timezone{totalResults !== 1 ? 's' : ''}
          </span>
          <SegmentedControl<GroupMode>
            label="Group timezones by"
            size="compact"
            className="[&_button]:min-h-11 sm:[&_button]:min-h-0"
            value={groupMode}
            onChange={setGroupMode}
            options={[
              {
                value: 'region',
                label: 'Region',
                icon: <Globe className="w-3 h-3" aria-hidden="true" />,
              },
              {
                value: 'country',
                label: 'Country',
                icon: <MapPin className="w-3 h-3" aria-hidden="true" />,
              },
            ]}
          />
        </div>
      </div>

      <div>
        {onApplyBrowserTimezone && !query && (
          <button
            type="button"
            onClick={onApplyBrowserTimezone}
            className="flex w-full min-h-11 items-center gap-2 px-3 py-2.5 text-left sm:px-4 border-b border-border bg-info-subtle hover:bg-info-muted transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            <LocateFixed className="w-4 h-4 shrink-0 text-primary" />
            <span className="flex-1 min-w-0">
              <span className="text-sm font-medium text-info">Apply browser timezone</span>
              <span className="block text-xs text-muted-foreground truncate">
                {browserTimezone}
              </span>
            </span>
          </button>
        )}
        {groupKeys.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No timezones found for &quot;{query}&quot;
          </div>
        ) : (
          groupKeys.map((groupKey) => (
            <div key={groupKey}>
              {/* Group Header */}
              <div className="px-3 py-1.5 bg-muted border-b border-border">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {groupMode === 'region' ? regionLabel(groupKey) : groupKey}
                </span>
              </div>

              {/* Timezone Rows */}
              {grouped[groupKey].map((tz) => {
                const isActive = activeTimezones.includes(tz.iana)
                return (
                  <button
                    type="button"
                    key={tz.iana}
                    onClick={() => onSelect(tz)}
                    className={`grid w-full min-h-11 grid-cols-2 items-start gap-x-3 gap-y-1 px-3 py-2 text-left sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto_auto] transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                      isActive ? 'bg-info-subtle hover:bg-info-muted' : 'hover:bg-muted/50'
                    }`}
                  >
                    <span className="flex min-w-0 items-start gap-2">
                      <Clock
                        className={`hidden sm:block w-3.5 h-3.5 shrink-0 mt-0.5 ${isActive ? 'text-primary' : 'text-muted-foreground'}`}
                      />
                      <span
                        className={`text-sm font-medium wrap-break-word whitespace-normal ${isActive ? 'text-info' : 'text-foreground'}`}
                      >
                        {tz.city}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground wrap-break-word whitespace-normal">
                      {tz.country}
                    </span>
                    <span className="justify-self-start px-1.5 py-0.5 text-xs font-mono rounded bg-muted text-muted-foreground whitespace-nowrap">
                      {tz.abbr}
                    </span>
                    <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                      {tz.utcOffset}
                    </span>
                  </button>
                )
              })}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
