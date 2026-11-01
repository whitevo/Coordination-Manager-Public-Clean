import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Check } from 'lucide-react'
import { PreviewSurface } from './PreviewSurface'
import type { CatalogPreviewTheme } from './ThemeComparisonChecklist'
import type { CatalogEntry, CatalogStatus } from './types'
import { explainMissingRoute, getUsedOnHref } from './used-on-links'

const USED_ON_TAG_CLASS = 'rounded border border-surface-700 bg-surface-800 px-1.5 py-0.5 text-[10px] leading-4! text-gray-400'
const TOOLTIP_DELAY_MS = 1200
const TOOLTIP_WIDTH_PX = 224
const TOOLTIP_VIEWPORT_MARGIN_PX = 8

/** A 'used on' tag with no dedicated route: explains why after a 1.2s hover, instead of just being unclickable. */
function UsedOnUnlinkedTag({ label }: { label: string }) {
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tagRef = useRef<HTMLSpanElement>(null)

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  const scheduleShow = () => {
    timer.current = setTimeout(() => {
      const rect = tagRef.current?.getBoundingClientRect()
      if (!rect) return
      const centered = rect.left + rect.width / 2
      const minLeft = TOOLTIP_WIDTH_PX / 2 + TOOLTIP_VIEWPORT_MARGIN_PX
      const maxLeft = window.innerWidth - TOOLTIP_WIDTH_PX / 2 - TOOLTIP_VIEWPORT_MARGIN_PX
      const left = Math.min(Math.max(centered, minLeft), maxLeft)
      setCoords({ top: rect.bottom + 6, left })
    }, TOOLTIP_DELAY_MS)
  }

  const hide = () => {
    clearTimer()
    setCoords(null)
  }

  return (
    <span
      ref={tagRef}
      className={`${USED_ON_TAG_CLASS} cursor-help`}
      onMouseEnter={scheduleShow}
      onMouseLeave={hide}
      onFocus={scheduleShow}
      onBlur={hide}
      tabIndex={0}
    >
      {label}
      {coords && createPortal(
        // Rendered into <body> (position: fixed) so ancestor `overflow-hidden` cards can't clip or bury it.
        <span
          role="tooltip"
          style={{ top: coords.top, left: coords.left, width: TOOLTIP_WIDTH_PX }}
          className="pointer-events-none fixed z-300 -translate-x-1/2 rounded-md border border-surface-700 bg-surface-850 px-2 py-1.5 text-[11px] normal-case leading-4 text-gray-300 shadow-lg"
        >
          {explainMissingRoute(label)}
        </span>,
        document.body
      )}
    </span>
  )
}

const STATUS_STYLE: Record<CatalogStatus, { label: string; cls: string }> = {
  default: { label: 'Default', cls: 'bg-surface-800 text-gray-300 border border-surface-700' },
  alt: { label: 'Alt', cls: 'bg-surface-800 text-gray-300 border border-surface-700' },
  drift: { label: 'Drift', cls: 'bg-amber-900/40 text-amber-300 border border-amber-700/50' },
}

interface CatalogCardProps {
  entry: CatalogEntry
  previewThemes: CatalogPreviewTheme[]
}

export function CatalogCard({ entry, previewThemes }: CatalogCardProps) {
  const [copied, setCopied] = useState(false)
  const status = STATUS_STYLE[entry.status]

  const handleCopy = async () => {
    await navigator.clipboard.writeText(entry.recipe)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-surface-700 bg-surface-800/40">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-surface-700 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="m-0! truncate text-sm! font-semibold leading-5! text-gray-100">{entry.name}</h3>
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-3! tracking-wide ${status.cls}`}>
              {status.label}
            </span>
          </div>
          <p className="mb-0! mt-0.5 text-[11px]! leading-4! text-gray-500">{entry.conceptLabel}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <span className="rounded border border-surface-700 bg-surface-850 px-1.5 py-0.5 text-[10px] text-gray-400">
              {entry.namespace}
            </span>
            <span className="rounded border border-surface-700 bg-surface-850 px-1.5 py-0.5 text-[10px] text-gray-400">
              {entry.previewSource}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 p-3">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-2">
          {previewThemes.map(theme => (
            <div key={theme.id} className="min-w-0">
              <p className="mb-1 text-[10px]! font-semibold uppercase tracking-wider text-gray-500">{theme.name}</p>
              <PreviewSurface dark={theme.dark} colors={theme.colors}>{entry.render()}</PreviewSurface>
            </div>
          ))}
        </div>

        {entry.migration && (
          <p className="mb-0! text-[11px]! leading-5! text-amber-300">
            Replace with: {entry.migration}
          </p>
        )}

        <div className="flex min-w-0 flex-col gap-2">
          {/* Recipe */}
          <div className="flex items-center justify-between gap-2 rounded-md border border-surface-700 bg-surface-850 px-3 py-2">
            <code className="min-w-0 flex-1 truncate bg-transparent! p-0! font-mono text-[11px]! text-gray-300" title={entry.recipe}>
              {entry.recipe}
            </code>
            <button
              onClick={handleCopy}
              className="shrink-0 text-gray-400 transition-colors hover:text-gray-200"
              aria-label="Copy recipe"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>

          {/* Note */}
          {entry.note && <p className="mb-0! text-[11px]! leading-5! text-gray-400">{entry.note}</p>}

          {/* Used on */}
          <div>
            <p className="mb-1.5 text-[10px]! font-semibold uppercase leading-4! tracking-wider text-gray-500">Used on</p>
            <div className="flex flex-wrap gap-1.5">
              {entry.usedOn.map(page => {
                const href = getUsedOnHref(page, entry.id, entry.category, entry.recipe, entry.conceptLabel, entry.note)
                if (!href) return <UsedOnUnlinkedTag key={page} label={page} />

                return (
                  <a
                    key={page}
                    href={href}
                    className={`${USED_ON_TAG_CLASS} transition-colors hover:border-brand-500 hover:text-brand-300 focus:outline-hidden focus:ring-2 focus:ring-brand-500/50`}
                    title={`Open ${page} and highlight this component`}
                  >
                    {page}
                  </a>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
