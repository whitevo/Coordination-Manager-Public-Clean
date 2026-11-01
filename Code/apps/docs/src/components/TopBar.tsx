import { Link } from 'react-router-dom'
import { Sparkles, Menu, ArrowLeft } from 'lucide-react'

interface TopBarProps {
  onMenuToggle: () => void
  aiPanelOpen: boolean
  onAiSearchClick: () => void
}

export function TopBar({ onMenuToggle, aiPanelOpen, onAiSearchClick }: TopBarProps) {
  const appUrl = import.meta.env.DEV
    ? `${window.location.protocol}//${window.location.hostname}:5173`
    : '/'

  return (
    <header className="sticky top-0 z-50 h-16 border-b border-surface-700 bg-surface-900/95 backdrop-blur-sm supports-backdrop-filter:bg-surface-900/80">
      <div className="flex items-center justify-between h-full px-4 lg:px-6">
        {/* Left: back to app + logo + menu */}
        <div className="flex items-center gap-3">
          <a
            href={appUrl}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-brand-500/40 text-brand-300 bg-brand-950/30 hover:bg-brand-900/50 hover:border-brand-400/60 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Back to App</span>
          </a>
          <div className="w-px h-6 bg-surface-700 hidden sm:block" />
          <button
            onClick={onMenuToggle}
            className="lg:hidden p-2 rounded-md hover:bg-surface-800 text-gray-400"
          >
            <Menu className="w-5 h-5" />
          </button>
          <Link to="/" className="flex items-center gap-2.5 text-white font-semibold text-lg">
            <div className="w-8 h-8 rounded-lg bg-linear-to-br from-brand-500 to-brand-700 flex items-center justify-center text-sm font-bold">
              CM
            </div>
            <span className="hidden sm:inline">Coordination Manager</span>
            <span className="text-xs text-brand-400 font-medium ml-1 hidden md:inline">Docs</span>
          </Link>
        </div>

        {/* Right: AI Search */}
        <div className="flex items-center gap-4">
          <button
            onClick={onAiSearchClick}
            className={`flex items-center gap-2 text-sm rounded-lg px-3 py-1.5 transition-colors ${
              aiPanelOpen
                ? 'border border-brand-500/60 text-brand-300 bg-brand-950/30'
                : 'border border-surface-700 text-gray-400 hover:text-gray-200 hover:border-brand-500/40'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span className="hidden sm:inline">AI Search</span>
            <kbd className="hidden lg:inline-flex items-center gap-0.5 ml-2 text-xs text-gray-500 border border-surface-700 rounded px-1.5 py-0.5">
              ⌘K
            </kbd>
          </button>
        </div>
      </div>
    </header>
  )
}
