import { Clock, Mail, MessageSquare, BookOpen, Headphones, ExternalLink, X, LifeBuoy, AlertCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import MobilePanelSwitcher from './MobilePanelSwitcher'
import type { PanelId } from './FloatingPanels'

interface SupportSidePanelProps {
  isOpen: boolean
  onClose: () => void
  onPanelChange: (panel: Exclude<PanelId, null>) => void
}

export function SupportSidePanel({ isOpen, onClose, onPanelChange }: SupportSidePanelProps) {
  return (
    <aside
      className={`
        fixed inset-y-0 right-0 z-50 w-screen transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0 pointer-events-auto sm:w-[22rem] md:w-96' : 'translate-x-full pointer-events-none sm:w-0'}
        sm:sticky sm:top-0 sm:h-screen sm:shrink-0 sm:overflow-hidden sm:translate-x-0 sm:pointer-events-auto
      `}
    >
      <div className={`ml-auto h-full w-screen flex flex-col bg-card border-l-2 border-blue-400 dark:border-blue-500 shadow-xl sm:w-[22rem] sm:min-w-[22rem] md:w-96 md:min-w-[24rem]`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-blue-50 dark:bg-blue-950/40">
        <div className="flex items-center gap-2">
          <LifeBuoy className="h-5 w-5 text-blue-500" />
          <h2 className="font-semibold text-sm">Support</h2>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <MobilePanelSwitcher activePanel="support" onPanelChange={onPanelChange} />

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Hours & SLA */}
        <div className="rounded-lg border border-border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-500" />
            <span className="text-xs font-semibold">Hours of Operation</span>
          </div>
          <p className="text-xs text-muted-foreground">Daily: 9:00 AM - 6:00 PM (UTC)</p>
          <p className="text-xs text-muted-foreground">Including weekends</p>
        </div>

        <div className="rounded-lg border border-border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-semibold">Response Time</span>
          </div>
          <p className="text-xs text-muted-foreground">
            First response within <strong className="text-foreground">48 hours</strong>. Critical issues prioritized.
          </p>
        </div>

        {/* Quick Actions */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Get Help</h3>

          <Link
            to="/feedback?tab=support"
            onClick={onClose}
            className="flex items-center gap-3 rounded-lg border border-border p-3 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-accent/30 transition-all"
          >
            <MessageSquare className="w-4 h-4 text-blue-500 shrink-0" />
            <div>
              <p className="text-sm font-medium">Create a Support Case</p>
              <p className="text-xs text-muted-foreground">Submit and track a request</p>
            </div>
          </Link>

          <a
            href="mailto:support@coordinationmanager.com"
            className="flex items-center gap-3 rounded-lg border border-border p-3 hover:border-green-300 dark:hover:border-green-700 hover:bg-accent/30 transition-all"
          >
            <Mail className="w-4 h-4 text-green-500 shrink-0" />
            <div>
              <p className="text-sm font-medium">Email Support</p>
              <p className="text-xs text-muted-foreground">support@coordinationmanager.com</p>
            </div>
          </a>

          <a
            href="https://coordinationmanager.com/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-lg border border-border p-3 hover:border-purple-300 dark:hover:border-purple-700 hover:bg-accent/30 transition-all"
          >
            <BookOpen className="w-4 h-4 text-purple-500 shrink-0" />
            <div>
              <p className="text-sm font-medium flex items-center gap-1">
                Knowledge Base <ExternalLink className="w-3 h-3" />
              </p>
              <p className="text-xs text-muted-foreground">Guides, FAQs, and docs</p>
            </div>
          </a>

          <a
            href="https://discord.gg/8ywJuK7ruY"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-lg border border-border p-3 hover:border-indigo-300 dark:hover:border-indigo-700 hover:bg-accent/30 transition-all"
          >
            <Headphones className="w-4 h-4 text-indigo-500 shrink-0" />
            <div>
              <p className="text-sm font-medium flex items-center gap-1">
                Live Community Support <ExternalLink className="w-3 h-3" />
              </p>
              <p className="text-xs text-muted-foreground">Catalyst Swarm Discord</p>
            </div>
          </a>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border">
        <Link
          to="/support"
          onClick={onClose}
          className="flex items-center justify-center gap-2 w-full py-2 rounded-lg text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950 transition-colors"
        >
          <LifeBuoy className="w-4 h-4" />
          View Full Support Page
        </Link>
      </div>
      </div>
    </aside>
  )
}
