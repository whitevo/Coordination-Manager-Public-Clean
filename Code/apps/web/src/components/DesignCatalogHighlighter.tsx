import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { X } from 'lucide-react'
import { OVERLAY_LAYER_CLASS } from '../lib/overlay-layers'
import { IconButton } from './ui'

const HIGHLIGHT_CLASS = 'design-catalog-highlight'
const HIGHLIGHT_DURATION_MS = 6000
const FIND_TIMEOUT_MS = 3000
const IGNORED_CLASSES = new Set([
  'flex', 'inline-flex', 'grid', 'items-center', 'justify-center', 'gap-1', 'gap-2',
  'w-full', 'text-xs', 'text-sm', 'font-medium', 'font-semibold', 'transition-colors',
])

function recipeClasses(recipe: string): string[] {
  return recipe
    .split(/\s+/)
    .map(token => token.replace(/^[a-z-]+:/, ''))
    .filter(token => /^[a-z0-9][a-z0-9-[\]/.]+$/i.test(token) && !token.includes('{') && !IGNORED_CLASSES.has(token))
}

function findBestTarget(recipe: string, detail: string, category: string): HTMLElement | null {
  const root = document.querySelector('main') ?? document.body
  const candidates = Array.from(root.querySelectorAll<HTMLElement>('[class]'))
  const classes = recipeClasses(recipe)
  const detailWords = detail.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2)
  let best: { element: HTMLElement; score: number } | null = null

  for (const element of candidates) {
    if (element.offsetParent === null) continue
    const classScore = classes.reduce((total, className) => total + (element.classList.contains(className) ? 2 : 0), 0)
    const text = element.textContent?.toLowerCase() ?? ''
    const detailScore = detailWords.reduce((total, word) => total + (text.includes(word) ? 3 : 0), 0)
    // Require a genuine class/detail match before considering a candidate at all --
    // otherwise the category/interactive bonus below would let ANY visible button "match".
    if (classScore === 0 && detailScore === 0) continue

    let score = classScore + detailScore
    const isInteractive = element.matches('button, a, input, select, [role="button"]')
    if (category === 'Buttons' || category === 'Inputs') score += isInteractive ? 3 : 0
    else if (category === 'Cards' || category === 'Data' || category === 'Panels') score += isInteractive ? -2 : 2
    if (!best || score > best.score) best = { element, score }
  }

  if (best && best.score >= 3) {
    if (category === 'Cards' || category === 'Data' || category === 'Panels') {
      return best.element.closest<HTMLElement>('.border') ?? best.element
    }
    return best.element
  }
  return null
}

function openSourcePanel(source: string): void {
  const events: Record<string, string> = {
    AiGuideSidePanel: 'openAiPanel',
    ChatSidePanel: 'openChatPanel',
    FeedbackSidePanel: 'openFeedbackPanel',
    SupportSidePanel: 'openSupportPanel',
  }
  const eventName = events[source]
  if (eventName) window.dispatchEvent(new Event(eventName))
}

/** Builds the "how to see this" guidance shown when a target can't be located on the page. */
function buildNotFoundMessage(concept: string, detail: string, hint: string, category: string): string {
  if (hint) return hint
  if (detail) return `"${concept}" appears under ${detail}. Navigate there to see it.`
  const categoryHint: Record<string, string> = {
    Overlays: 'It may only appear after opening a dialog or menu.',
    Panels: 'It may only appear once a side panel is open.',
    Feedback: 'It may only appear during a specific loading, success, or error state.',
    Disclosure: 'It may be collapsed or hidden until you expand a section.',
  }
  const generic = categoryHint[category] ?? 'It may require specific data, a selection, or an open panel to appear.'
  return `Could not find "${concept}" visible on this page yet. ${generic}`
}

export function DesignCatalogHighlighter() {
  const location = useLocation()
  const [notFoundMessage, setNotFoundMessage] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const entryId = params.get('designEntry')
    if (!entryId) return

    setNotFoundMessage(null)
    const source = params.get('designSource') ?? ''
    const category = params.get('designCategory') ?? ''
    const recipe = params.get('designRecipe') ?? ''
    const detail = params.get('designDetail') ?? ''
    const concept = params.get('designConcept') ?? 'This component'
    const hint = params.get('designHint') ?? ''
    openSourcePanel(source)

    let settled = false
    let highlighted: HTMLElement | null = null
    let removeTimer: ReturnType<typeof setTimeout> | null = null

    // Polling with setInterval proved unreliable on some routes, so a MutationObserver
    // plus a single deterministic timeout replaces it -- neither depends on repeated ticks.
    const attempt = () => {
      if (settled) return
      const target = findBestTarget(recipe, detail, category)
      if (!target) return
      settled = true
      observer.disconnect()
      window.clearTimeout(giveUpTimer)
      highlighted = target
      target.classList.remove(HIGHLIGHT_CLASS)
      void target.offsetWidth
      target.classList.add(HIGHLIGHT_CLASS)
      target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
      removeTimer = setTimeout(() => target.classList.remove(HIGHLIGHT_CLASS), HIGHLIGHT_DURATION_MS)
    }

    const observer = new MutationObserver(attempt)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true })

    const giveUpTimer = window.setTimeout(() => {
      if (settled) return
      settled = true
      observer.disconnect()
      setNotFoundMessage(buildNotFoundMessage(concept, detail, hint, category))
    }, FIND_TIMEOUT_MS)

    attempt()

    return () => {
      observer.disconnect()
      window.clearTimeout(giveUpTimer)
      if (removeTimer) clearTimeout(removeTimer)
      highlighted?.classList.remove(HIGHLIGHT_CLASS)
    }
  }, [location.search])

  if (!notFoundMessage) return null

  return (
    <div
      role="status"
      className={`fixed inset-x-0 top-0 ${OVERLAY_LAYER_CLASS.toast} mx-auto flex w-full max-w-xl items-start gap-2 rounded-b-lg border border-t-0 border-warning-muted bg-warning-subtle px-4 py-3 text-sm text-warning shadow-lg sm:left-1/2 sm:-translate-x-1/2`}
    >
      <p className="flex-1 mb-0! leading-5">{notFoundMessage}</p>
      <IconButton
        label="Dismiss"
        icon={<X />}
        intent="warning"
        showTitle={false}
        onClick={() => setNotFoundMessage(null)}
        className="-my-1.5"
      />
    </div>
  )
}