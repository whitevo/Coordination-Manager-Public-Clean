import { BookOpen } from 'lucide-react'
import type { Ref } from 'react'
import type { AnimatedTabItem } from './AnimatedTabBar'

interface MailboxMobileNavigationProps<T extends string> {
  tabs: Array<AnimatedTabItem<T> & { mobileLabel?: string }>
  activeId: T
  onSelect: (id: T) => void
  guide?: {
    isOpen: boolean
    onToggle: () => void
    buttonRef: Ref<HTMLButtonElement>
  }
}

export function MailboxMobileNavigation<T extends string>({
  tabs,
  activeId,
  onSelect,
  guide,
}: MailboxMobileNavigationProps<T>) {
  const buttonClassName =
    'flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-lg border px-0.5 py-2 text-[10px] font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <nav
      aria-label="Mailbox sections"
      data-testid="mailbox-mobile-navigation"
      className={`grid gap-1 ${guide ? 'grid-cols-5' : 'grid-cols-4'}`}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon
        const isActive = activeId === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            aria-label={tab.label}
            aria-pressed={isActive}
            title={tab.label}
            onClick={() => onSelect(tab.id)}
            className={`${buttonClassName} ${
              isActive
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-card text-muted-foreground hover:bg-accent/40 hover:text-foreground'
            }`}
          >
            {Icon && <Icon className="h-4 w-4 shrink-0" />}
            <span className="whitespace-nowrap leading-none">{tab.mobileLabel ?? tab.label}</span>
          </button>
        )
      })}
      {guide && (
        <button
          ref={guide.buttonRef}
          type="button"
          aria-label="Learner Guide"
          aria-expanded={guide.isOpen}
          aria-controls="mailbox-learner-guide"
          title="Learner Guide"
          onClick={guide.onToggle}
          className={`${buttonClassName} ${
            guide.isOpen
              ? 'border-info-muted bg-info-subtle text-info'
              : 'border-border bg-card text-muted-foreground hover:bg-accent/40 hover:text-foreground'
          }`}
        >
          <BookOpen className="h-4 w-4 shrink-0" />
          <span className="whitespace-nowrap leading-none">Guide</span>
        </button>
      )}
    </nav>
  )
}
