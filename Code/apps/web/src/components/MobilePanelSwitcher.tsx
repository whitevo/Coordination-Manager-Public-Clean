import { LifeBuoy, MessageCircle, MessageSquare, Sparkles } from 'lucide-react'
import type { PanelId } from './FloatingPanels'

interface MobilePanelSwitcherProps {
  activePanel: Exclude<PanelId, null>
  onPanelChange: (panel: Exclude<PanelId, null>) => void
}

const OPTIONS = [
  { id: 'ai', label: 'AI', icon: Sparkles },
  { id: 'feedback', label: 'Feedback', icon: MessageSquare },
  { id: 'chat', label: 'Chat', icon: MessageCircle },
  { id: 'support', label: 'Support', icon: LifeBuoy },
] as const

export default function MobilePanelSwitcher({ activePanel, onPanelChange }: MobilePanelSwitcherProps) {
  return (
    <div className="sm:hidden border-b border-border bg-background/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="grid grid-cols-4 gap-2">
        {OPTIONS.map((option) => {
          const Icon = option.icon
          const isActive = option.id === activePanel

          return (
            <button
              key={option.id}
              type="button"
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