import { PANEL_IDS } from './panel-types'
import { LifeBuoy, MessageCircle, MessageSquare, Scale, Sparkles } from 'lucide-react'
import type { ActivePanelId } from './panel-types'

interface MobilePanelSwitcherProps {
  activePanel: ActivePanelId
  onPanelChange: (panel: ActivePanelId) => void
}

const OPTION_BY_ID = {
  ai: { label: 'AI', icon: Sparkles },
  feedback: { label: 'Feedback', icon: MessageSquare },
  chat: { label: 'Chat', icon: MessageCircle },
  support: { label: 'Support', icon: LifeBuoy },
  commons: { label: 'Commons', icon: Scale },
} satisfies Record<ActivePanelId, { label: string; icon: typeof Sparkles }>

const OPTIONS = PANEL_IDS.map((id) => ({ id, ...OPTION_BY_ID[id] }))

export default function MobilePanelSwitcher({ activePanel, onPanelChange }: MobilePanelSwitcherProps) {
  return (
    <div className="sm:hidden border-b border-border bg-background/95 px-3 py-2 backdrop-blur-sm supports-backdrop-filter:bg-background/75">
      <div className="grid grid-cols-5 gap-2">
        {OPTIONS.map((option) => {
          const Icon = option.icon
          const isActive = option.id === activePanel

          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => onPanelChange(option.id)}
              className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg border px-1 py-2 text-[11px] font-medium transition-colors ${
                isActive
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:bg-accent/40 hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="leading-none">{option.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}