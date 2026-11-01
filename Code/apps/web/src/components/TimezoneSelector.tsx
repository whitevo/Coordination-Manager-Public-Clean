import { useState, useCallback, useRef } from 'react'
import { ArrowLeft, Globe, Plus, X, Pencil } from 'lucide-react'
import {
  findTimezone,
  formatTimezoneShort,
  detectLocalTimezone,
  MAX_TIMEZONES,
  type TimezoneEntry,
} from '../lib/timezone-data'
import type { UseTimezonesReturn } from '../lib/use-timezones'
import TimezoneSearchPanel from './TimezoneSearchPanel'
import { Button, Dialog, IconButton } from './ui'

interface TimezoneSelectorProps {
  /** Timezones hook return value */
  timezones: UseTimezonesReturn
  /** Show in compact mode (visitor view) */
  compact?: boolean
  /** Hide label text and show just the icon */
  iconOnly?: boolean
}

type PanelTarget = 'primary' | 'add' | number // number = additional slot index

export default function TimezoneSelector({
  timezones,
  compact: _compact,
  iconOnly: _iconOnly,
}: TimezoneSelectorProps) {
  const compact = _compact ?? false
  const iconOnly = _iconOnly ?? false
  const [expanded, setExpanded] = useState(false)
  const [searchTarget, setSearchTarget] = useState<PanelTarget | null>(null)
  const settingsRef = useRef<HTMLDivElement>(null)
  const returnTargetRef = useRef<PanelTarget>('primary')

  const primaryEntry = findTimezone(timezones.primary)
  const primaryLabel = primaryEntry ? formatTimezoneShort(primaryEntry) : timezones.primary

  const closeSettings = useCallback(() => {
    setExpanded(false)
    setSearchTarget(null)
  }, [])

  const openSearch = useCallback((target: PanelTarget) => {
    returnTargetRef.current = target
    setSearchTarget(target)
  }, [])

  const closeSearch = useCallback(() => {
    setSearchTarget(null)
    requestAnimationFrame(() => {
      const settings = settingsRef.current
      const target =
        settings?.querySelector<HTMLButtonElement>(
          `[data-timezone-target="${returnTargetRef.current}"]`
        ) ?? settings?.querySelector<HTMLButtonElement>('button')
      target?.focus()
    })
  }, [])

  const applyIana = useCallback(
    (iana: string) => {
      if (searchTarget === 'primary') {
        timezones.setPrimary(iana)
      } else if (searchTarget === 'add') {
        timezones.addTimezone(iana)
      } else if (typeof searchTarget === 'number') {
        timezones.replaceTimezone(searchTarget + 1, iana)
      }
      closeSearch()
    },
    [searchTarget, timezones, closeSearch]
  )

  const handleSelect = useCallback((entry: TimezoneEntry) => applyIana(entry.iana), [applyIana])

  const handleApplyBrowserTimezone = useCallback(() => {
    applyIana(detectLocalTimezone())
  }, [applyIana])

  const searchTitle =
    searchTarget === 'primary'
      ? 'Change Primary Timezone'
      : searchTarget === 'add'
        ? 'Add Timezone'
        : 'Change Timezone'

  return (
    <div>
      <Button
        emphasis={expanded ? 'solid' : 'outline'}
        intent="info"
        size={iconOnly || compact ? 'compact' : 'standard'}
        onClick={() => setExpanded(true)}
        aria-expanded={expanded}
        aria-haspopup="dialog"
        className="group"
        title={iconOnly ? 'Change timezone' : `Timezone: ${primaryLabel}`}
        aria-label={iconOnly ? 'Change timezone' : `Timezone: ${primaryLabel}`}
      >
        <Globe
          className={`${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} shrink-0 transition-transform duration-500 motion-reduce:transition-none ${expanded ? 'animate-spin-once motion-reduce:animate-none' : 'group-hover:rotate-12 motion-reduce:transform-none'}`}
        />
        {!iconOnly && <span>{compact ? primaryLabel : `Timezone: ${primaryLabel}`}</span>}
        {!iconOnly && timezones.additional.length > 0 && (
          <span
            className={`px-1.5 py-0.5 text-xs rounded-full font-medium ${
              expanded ? 'bg-info-foreground/25 text-info-foreground' : 'bg-info-muted text-info'
            }`}
          >
            +{timezones.additional.length}
          </span>
        )}
      </Button>

      <Dialog
        open={expanded}
        onClose={closeSettings}
        title={searchTarget === null ? 'Timezone settings' : searchTitle}
        kind="focusModal"
        size="md"
        scrollBody
        showCloseButton
        closeOnScrimClick={false}
        className="[&_[data-dialog-chrome=close]]:min-h-11 [&_[data-dialog-chrome=close]]:min-w-11"
        headerActions={
          searchTarget !== null ? (
            <IconButton
              label="Back to timezone settings"
              icon={<ArrowLeft />}
              onClick={closeSearch}
              className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0"
            />
          ) : undefined
        }
      >
        {searchTarget === null && (
          <div ref={settingsRef} className="space-y-3">
            {/* Primary Timezone row */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Primary
              </span>
              <Button
                emphasis="outline"
                size="compact"
                icon={<Globe className="w-3.5 h-3.5" />}
                onClick={() => openSearch('primary')}
                data-timezone-target="primary"
                className="min-h-11 sm:min-h-0"
              >
                {primaryLabel}
                <Pencil className="w-3 h-3 opacity-50" />
              </Button>
            </div>

            {/* Additional Timezones */}
            {timezones.additional.map((iana, idx) => {
              const entry = findTimezone(iana)
              const label = entry ? formatTimezoneShort(entry) : iana
              return (
                <div key={iana} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Display {idx + 2}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      emphasis="ghost"
                      size="compact"
                      icon={<Globe className="w-3.5 h-3.5" />}
                      onClick={() => openSearch(idx)}
                      data-timezone-target={idx}
                      className="min-h-11 sm:min-h-0"
                    >
                      {label}
                      <Pencil className="w-3 h-3 opacity-40" />
                    </Button>
                    <IconButton
                      label="Remove timezone"
                      intent="danger"
                      icon={<X />}
                      onClick={() => timezones.removeTimezone(iana)}
                      className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0"
                    />
                  </div>
                </div>
              )
            })}

            {/* Add More Button */}
            {timezones.canAddMore && (
              <Button
                emphasis="outline"
                size="compact"
                fullWidth
                icon={<Plus className="w-3.5 h-3.5" />}
                onClick={() => openSearch('add')}
                data-timezone-target="add"
                className="min-h-11 sm:min-h-0"
              >
                Add Timezone ({timezones.additional.length + 1}/{MAX_TIMEZONES})
              </Button>
            )}
          </div>
        )}
        {searchTarget !== null && (
          <TimezoneSearchPanel
            onSelect={handleSelect}
            onApplyBrowserTimezone={handleApplyBrowserTimezone}
            activeTimezones={timezones.all}
          />
        )}
      </Dialog>
    </div>
  )
}
