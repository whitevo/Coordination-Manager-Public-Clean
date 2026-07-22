import { useRef, useState } from 'react'
import { MessageSquare, Sparkles, MessageCircle, ChevronDown, ChevronLeft, LayoutGrid, LifeBuoy } from 'lucide-react'

// ── Types ───────────────────────────────────────────────────────────────────────

type PanelId = 'feedback' | 'ai' | 'chat' | 'support' | null

interface FloatingPanelsProps {
  /** Currently open panel – lifted so Layout can control the AI panel too */
  activePanel: PanelId
  onPanelChange: (panel: PanelId) => void
}

// ── Color Scheme ────────────────────────────────────────────────────────────────
// Each panel gets a distinct color so buttons & headers are instantly recognisable.

const PANEL_COLORS = {
  feedback: {
    bg: 'bg-amber-500 hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-700',
    faded: 'bg-amber-500/25 hover:bg-amber-500/40 dark:bg-amber-700/25 dark:hover:bg-amber-700/40 text-white/60',
    active: 'bg-amber-500 dark:bg-amber-600 ring-2 ring-amber-300 shadow-amber-400/30 shadow-lg scale-105',
  },
  ai: {
    bg: 'ai-floating-button hover:shadow-purple-500/40 hover:shadow-lg',
    faded: 'bg-purple-500/25 hover:bg-purple-500/40 dark:bg-purple-700/25 dark:hover:bg-purple-700/40 text-white/60',
    active: 'ai-floating-button ring-2 ring-purple-300 shadow-purple-400/30 shadow-lg scale-105',
  },
  chat: {
    bg: 'bg-sky-500 hover:bg-sky-600 dark:bg-sky-600 dark:hover:bg-sky-700',
    faded: 'bg-sky-500/25 hover:bg-sky-500/40 dark:bg-sky-700/25 dark:hover:bg-sky-700/40 text-white/60',
    active: 'bg-sky-500 dark:bg-sky-600 ring-2 ring-sky-300 shadow-sky-400/30 shadow-lg scale-105',
  },
  support: {
    bg: 'bg-blue-500 hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700',
    faded: 'bg-blue-500/25 hover:bg-blue-500/40 dark:bg-blue-700/25 dark:hover:bg-blue-700/40 text-white/60',
    active: 'bg-blue-500 dark:bg-blue-600 ring-2 ring-blue-300 shadow-blue-400/30 shadow-lg scale-105',
  },
} as const

// ── Component ───────────────────────────────────────────────────────────────────

export default function FloatingPanels({ activePanel, onPanelChange }: FloatingPanelsProps) {
  const [fabOpen, setFabOpen] = useState(false)
  const touchStartXRef = useRef<number | null>(null)

  const toggle = (panel: PanelId) => {
    if (activePanel === panel) {
      onPanelChange(null)
    } else {
      onPanelChange(panel)
    }
  }

  const isAnyPanelOpen = activePanel !== null

  const isMobileViewport = () => typeof window !== 'undefined' && window.innerWidth < 640

  const handleEdgeTouchStart = (event: React.TouchEvent<HTMLButtonElement>) => {
    if (typeof window === 'undefined' || window.innerWidth >= 640) return
    const touch = event.touches[0]
    if (window.innerWidth - touch.clientX > 48) return
    touchStartXRef.current = touch.clientX
  }

  const handleEdgeTouchEnd = (event: React.TouchEvent<HTMLButtonElement>) => {
    if (!isMobileViewport()) return
    if (touchStartXRef.current === null) return

    const touch = event.changedTouches[0]
    const delta = touchStartXRef.current - touch.clientX
    touchStartXRef.current = null

    if (delta > 48 && activePanel === null) {
      onPanelChange('ai')
      setFabOpen(false)
    }
  }

  const handleLauncherClick = () => {
    if (isMobileViewport()) {
      onPanelChange('ai')
      setFabOpen(false)
      return
    }

    setFabOpen(prev => !prev)
  }

  // Determine button style based on whether this panel is the active one
  const btnStyle = (panel: 'feedback' | 'ai' | 'chat' | 'support') => {
    if (!isAnyPanelOpen) return PANEL_COLORS[panel].bg            // all full colour when no panel open
    if (activePanel === panel) return PANEL_COLORS[panel].active   // active = ring highlight
    return PANEL_COLORS[panel].faded                              // inactive = faded/transparent
  }

  return (
    <>
      {/* ── Floating Action Buttons ──────────────────────────────────────── */}
      {/* Container: when a panel is open the buttons slide left to sit beside it */}
      <div
        className={`fixed z-[55] flex flex-col-reverse items-end gap-2 transition-all duration-300 ease-in-out ${
          isAnyPanelOpen
            ? 'right-0 top-1/2 -translate-y-1/2 sm:top-auto sm:translate-y-0 sm:bottom-6 sm:right-[24.5rem]'
            : 'right-0 top-1/2 -translate-y-1/2 sm:top-auto sm:translate-y-0 sm:bottom-6 sm:right-6'
        }`}
      >
        {/* ── Expanded option buttons (visible when fabOpen OR a panel is open) ── */}
        <div
          className={`hidden sm:flex flex-col-reverse items-end gap-2 transition-all duration-200 ${
            fabOpen || isAnyPanelOpen
              ? 'opacity-100 translate-y-0 pointer-events-auto'
              : 'opacity-0 translate-y-4 pointer-events-none'
          }`}
        >
          {/* Feedback */}
          <button
            onClick={() => toggle('feedback')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-white text-xs sm:text-sm font-medium shadow-lg transition-all duration-200 ${btnStyle('feedback')}`}
            title="Send Feedback"
          >
            <MessageSquare className="h-4 w-4" />
            <span>Feedback</span>
          </button>

          {/* AI Assistant */}
          <button
            onClick={() => toggle('ai')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-white text-xs sm:text-sm font-medium shadow-lg transition-all duration-200 ${btnStyle('ai')}`}
            title="AI Assistant"
          >
            <Sparkles className="h-4 w-4" />
            <span>AI Assistant</span>
          </button>

          {/* Chat */}
          <button
            onClick={() => toggle('chat')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-white text-xs sm:text-sm font-medium shadow-lg transition-all duration-200 ${btnStyle('chat')}`}
            title="Chat"
          >
            <MessageCircle className="h-4 w-4" />
            <span>Chat</span>
          </button>

          {/* Support */}
          <button
            onClick={() => toggle('support')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-white text-xs sm:text-sm font-medium shadow-lg transition-all duration-200 ${btnStyle('support')}`}
            title="Support"
          >
            <LifeBuoy className="h-4 w-4" />
            <span>Support</span>
          </button>
        </div>

        {/* ── Main FAB / Hide toggle ─────────────────────────────────────── */}
        {/* When collapsed: gradient circle with chat icon.                   */}
        {/* When expanded (fabOpen): pill button saying "Hide".               */}
        {/* When a panel is open: the options stay visible; this button       */}
        {/* collapses back to the circle and also closes the panel.           */}
        {!isAnyPanelOpen && (
          <button
            onClick={handleLauncherClick}
            onTouchStart={handleEdgeTouchStart}
            onTouchEnd={handleEdgeTouchEnd}
            className={`shadow-xl flex items-center justify-center text-white transition-all duration-300 ${
              fabOpen
                ? 'px-4 py-2.5 rounded-full bg-gray-500 hover:bg-gray-600 dark:bg-gray-600 dark:hover:bg-gray-700 text-sm font-medium gap-2'
                : 'h-14 w-5 rounded-l-2xl rounded-r-none bg-gradient-to-br from-purple-500 via-sky-500 to-amber-500 sm:h-14 sm:w-14 sm:rounded-full'
            }`}
            title={fabOpen ? 'Hide options' : 'Open AI panel or swipe left from the edge'}
          >
            {fabOpen ? (
              <>
                <ChevronDown className="h-4 w-4" />
                <span>Hide</span>
              </>
            ) : (
              <>
                <ChevronLeft className="h-4 w-4 sm:hidden" />
                <LayoutGrid className="hidden h-6 w-6 sm:block" />
              </>
            )}
          </button>
        )}

        {/* When a panel IS open, show a "Hide" pill at the bottom (shorter = pyramid feel) */}
        {isAnyPanelOpen && (
          <button
            onClick={() => { onPanelChange(null); setFabOpen(false) }}
            className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-full shadow-lg text-white text-xs font-medium bg-gray-500/70 hover:bg-gray-600 dark:bg-gray-600/70 dark:hover:bg-gray-700 transition-all duration-200"
            title="Close panel"
          >
            <ChevronDown className="h-3.5 w-3.5" />
            <span>Hide</span>
          </button>
        )}
      </div>
    </>
  )
}

export type { PanelId }
