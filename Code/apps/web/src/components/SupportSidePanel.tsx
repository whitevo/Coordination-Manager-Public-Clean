import { Clock, Mail, MessageSquare, BookOpen, Headphones, ExternalLink, X, LifeBuoy, AlertCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import MobilePanelSwitcher from './MobilePanelSwitcher'
import CalendarQuickButtonToggle from './CalendarQuickButtonToggle'
import type { PanelId } from './panel-types'
import { SHELL_LAYER_CLASS } from '../lib/overlay-layers'
import { IconButton } from './ui'

interface SupportSidePanelProps {
  isOpen: boolean
  onClose: () => void
  onPanelChange: (panel: Exclude<PanelId, null>) => void
}

export function SupportSidePanel({ isOpen, onClose, onPanelChange }: SupportSidePanelProps) {
  return (
    <aside
      className={`
        fixed inset-y-0 right-0 ${SHELL_LAYER_CLASS.sidePanel} w-screen transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0 pointer-events-auto sm:w-88 md:w-96' : 'translate-x-full pointer-events-none sm:w-0'}
        sm:sticky sm:top-0 sm:h-screen sm:shrink-0 sm:overflow-hidden sm:translate-x-0 sm:pointer-events-auto
      `}
    >
      <div className={`ml-auto h-full w-screen flex flex-col bg-card border-l-2 border-feature-support shadow-xl sm:w-88 sm:min-w-88 md:w-96 md:min-w-[24rem]`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/40">
        <div className="flex items-center gap-2">
          <LifeBuoy className="h-5 w-5 text-feature-support" />
          <h2 className="font-semibold text-sm">Support</h2>
        </div>
        <div className="flex items-center gap-1">
          <CalendarQuickButtonToggle toolKey="support" label="Support" />
          <IconButton label="Close" icon={<X />} onClick={onClose} />
        </div>
      </div>
      <MobilePanelSwitcher activePanel="support" onPanelChange={onPanelChange} />

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Hours & SLA */}
        <div className="rounded-lg border border-border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-semibold">Hours of Operation</span>
          </div>
          <p className="text-xs text-muted-foreground">Daily: 9:00 AM - 6:00 PM (UTC)</p>
          <p className="text-xs text-muted-foreground">Including weekends</p>
        </div>

        <div className="rounded-lg border border-border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-warning" />
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
            className="flex items-center gap-3 rounded-lg border border-border p-3 hover:border-primary-muted hover:bg-accent/30 transition-all"
          >
            <MessageSquare className="w-4 h-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-sm font-medium">Create a Support Case</p>
              <p className="text-xs text-muted-foreground">Submit and track a request</p>
            </div>
          </Link>

          <a
            href="mailto:support@coordinationmanager.com"
            className="flex items-center gap-3 rounded-lg border border-border p-3 hover:border-primary-muted hover:bg-accent/30 transition-all"
          >
            <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-sm font-medium">Email Support</p>
              <p className="text-xs text-muted-foreground">support@coordinationmanager.com</p>
            </div>
          </a>

          <a
            href="https://coordinationmanager.com/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-lg border border-border p-3 hover:border-primary-muted hover:bg-accent/30 transition-all"
          >
            <BookOpen className="w-4 h-4 text-muted-foreground shrink-0" />
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
            className="flex items-center gap-3 rounded-lg border border-border p-3 hover:border-primary-muted hover:bg-accent/30 transition-all"
          >
            <Headphones className="w-4 h-4 text-muted-foreground shrink-0" />
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
          className="flex items-center justify-center gap-2 w-full py-2 rounded-lg text-sm font-medium text-primary hover:bg-primary-subtle transition-colors"
        >
          <LifeBuoy className="w-4 h-4" />
          View Full Support Page
        </Link>
      </div>
      </div>
    </aside>
  )
}
