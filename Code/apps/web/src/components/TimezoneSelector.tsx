import { useState, useCallback, useRef } from 'react'
import { Globe, Plus, X, Pencil } from 'lucide-react'
import { findTimezone, formatTimezoneShort, MAX_TIMEZONES, type TimezoneEntry } from '../lib/timezone-data'
import type { UseTimezonesReturn } from '../lib/use-timezones'
import TimezoneSearchPanel from './TimezoneSearchPanel'

interface TimezoneSelectorProps {
  /** Timezones hook return value */
  timezones: UseTimezonesReturn
  /** Show in compact mode (visitor view) */
  compact?: boolean
}

type PanelTarget = 'primary' | 'add' | number // number = additional slot index

export default function TimezoneSelector({ timezones, compact: _compact }: TimezoneSelectorProps) {
  const compact = _compact ?? false
  const [expanded, setExpanded] = useState(false)
  const [searchTarget, setSearchTarget] = useState<PanelTarget | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const primaryEntry = findTimezone(timezones.primary)
  const primaryLabel = primaryEntry ? formatTimezoneShort(primaryEntry) : timezones.primary

  const handleToggle = useCallback(() => {
    setExpanded((prev) => {
      if (prev) setSearchTarget(null)
      return !prev
    })
  }, [])

  const openSearch = useCallback((target: PanelTarget) => {
    setSearchTarget(target)
  }, [])

  const closeSearch = useCallback(() => {
    setSearchTarget(null)
  }, [])

  const handleSelect = useCallback(
    (entry: TimezoneEntry) => {
      if (searchTarget === 'primary') {
        timezones.setPrimary(entry.iana)
      } else if (searchTarget === 'add') {
        timezones.addTimezone(entry.iana)
      } else if (typeof searchTarget === 'number') {
        timezones.replaceTimezone(searchTarget + 1, entry.iana)
      }
      setSearchTarget(null)
    },
    [searchTarget, timezones]
  )

  const searchTitle =
    searchTarget === 'primary'
      ? 'Change Primary Timezone'
      : searchTarget === 'add'
        ? 'Add Timezone'
        : 'Change Timezone'

  return (
    <div ref={containerRef} className="relative">
      {/* Main timezone button -- click to expand options below */}
      <button
        type="button"
        onClick={handleToggle}
        className={`
          group flex items-center text-sm transition-all duration-200
          rounded-lg border-2 font-semibold
          ${compact ? 'gap-1 px-2 py-1 text-xs' : 'gap-2 px-4 py-1.5'}
          ${expanded
            ? 'bg-blue-600 dark:bg-blue-500 border-blue-600 dark:border-blue-500 text-white shadow-md shadow-blue-500/25'
            : 'bg-blue-600/10 dark:bg-blue-500/15 border-blue-500/40 dark:border-blue-400/30 text-blue-700 dark:text-blue-300 hover:bg-blue-600/20 dark:hover:bg-blue-500/25 hover:border-blue-500/60 hover:shadow-sm hover:shadow-blue-500/15'
          }
          cursor-pointer
        `}
      >
        <Globe className={`${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} flex-shrink-0 transition-transform duration-500 ${expanded ? 'animate-spin-once' : 'group-hover:rotate-12'}`} />
        <span>{compact ? primaryLabel : `Timezone: ${primaryLabel}`}</span>
        {timezones.additional.length > 0 && (
          <span className={`px-1.5 py-0.5 text-xs rounded-full font-medium ${
            expanded
              ? 'bg-blue-500/40 text-white'
              : 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
          }`}>
            +{timezones.additional.length}
          </span>
        )}
      </button>

      {/* Expanded options panel -- slides down below the button */}
      <div
        className={`
          overflow-hidden transition-all duration-300 ease-out
          ${expanded ? 'max-h-[500px] opacity-100 mt-2' : 'max-h-0 opacity-0'}
        `}
      >
        <div className="bg-card border border-border rounded-lg shadow-md p-3 space-y-2.5">
          {/* Primary Timezone row */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Primary
            </span>
            <button
              type="button"
              onClick={() => openSearch('primary')}
              className="flex items-center gap-1.5 px-2.5 py-1 text-sm rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-300 transition-colors font-medium"
            >
              <Globe className="w-3.5 h-3.5" />
              {primaryLabel}
              <Pencil className="w-3 h-3 opacity-50" />
            </button>
          </div>

          {/* Additional Timezones */}
          {timezones.additional.map((iana, idx) => {
            const entry = findTimezone(iana)
            const label = entry ? formatTimezoneShort(entry) : iana
            return (
              <div key={iana} className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Display {idx + 2}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openSearch(idx)}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-sm rounded-md bg-muted hover:bg-muted/80 text-foreground transition-colors"
                  >
                    <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                    {label}
                    <Pencil className="w-3 h-3 opacity-40" />
                  </button>
                  <button
                    type="button"
                    onClick={() => timezones.removeTimezone(iana)}
                    className="p-1 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 text-muted-foreground hover:text-red-600 transition-colors"
                    title="Remove timezone"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )
          })}

          {/* Add More Button */}
          {timezones.canAddMore && (
            <button
              type="button"
              onClick={() => openSearch('add')}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 hover:bg-muted/30 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Timezone ({timezones.additional.length + 1}/{MAX_TIMEZONES})
            </button>
          )}
        </div>
      </div>

      {/* Search Panel (overlay below) */}
      {searchTarget !== null && (
        <TimezoneSearchPanel
          title={searchTitle}
          onSelect={handleSelect}
          onClose={closeSearch}
          activeTimezones={timezones.all}
        />
      )}
    </div>
  )
}
