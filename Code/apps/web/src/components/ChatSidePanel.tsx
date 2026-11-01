import { useState } from 'react'
import { X, MessageCircle, Vote, CheckCircle } from 'lucide-react'
import LearnerHelpIcon from './LearnerHelpIcon'
import MobilePanelSwitcher from './MobilePanelSwitcher'
import CalendarQuickButtonToggle from './CalendarQuickButtonToggle'
import type { PanelId } from './panel-types'
import { SHELL_LAYER_CLASS } from '../lib/overlay-layers'
import { Button, IconButton } from './ui'

interface ChatSidePanelProps {
  isOpen: boolean
  onClose: () => void
  onPanelChange: (panel: Exclude<PanelId, null>) => void
}

const POLL_OPTIONS = [
  { id: 'yes', label: "Yes \u2014 I'd love to chat with others here!", emoji: '\uD83D\uDE4C' },
  { id: 'maybe', label: 'Maybe \u2014 depends on how it works', emoji: '\uD83E\uDD14' },
  { id: 'no', label: 'Not really \u2014 I prefer other tools', emoji: '\uD83D\uDC4B' },
] as const

export function ChatSidePanel({ isOpen, onClose, onPanelChange }: ChatSidePanelProps) {
  const [selectedOption, setSelectedOption] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const handleVote = () => {
    if (!selectedOption) return
    // Store locally so the user doesn't get asked again this session
    sessionStorage.setItem('cm-chat-poll-vote', selectedOption)
    setSubmitted(true)
  }

  return (
    <aside
      className={`
        fixed inset-y-0 right-0 ${SHELL_LAYER_CLASS.sidePanel} w-screen transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0 pointer-events-auto sm:w-88 md:w-96' : 'translate-x-full pointer-events-none sm:w-0'}
        sm:sticky sm:top-0 sm:h-screen sm:shrink-0 sm:overflow-hidden sm:translate-x-0 sm:pointer-events-auto
      `}
    >
      <div className={`ml-auto h-full w-screen flex flex-col bg-card border-l-2 border-feature-chat shadow-xl sm:w-88 sm:min-w-88 md:w-96 md:min-w-[24rem]`}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between px-4 py-3 border-b border-border bg-muted/40">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-feature-chat" />
          <h2 className="font-semibold text-sm">Chat</h2>
          <LearnerHelpIcon size={4} description={<><p className="font-semibold text-info mb-1">Side Panel — Chat</p><p className="mb-1.5">Side panels slide in from the right on every page, giving you quick access to conversational tools without leaving what you’re doing.</p><p className="mb-1.5">The <strong>Chat panel</strong> is a place to communicate with other users on the platform — share ideas, coordinate plans, or ask questions in real time.</p><p><strong>Coming soon:</strong> This feature is currently gathering interest. Vote below to help shape its development!</p></>} />
        </div>
        <div className="flex items-center gap-1">
          <CalendarQuickButtonToggle toolKey="chat" label="Chat" />
          <IconButton label="Close" icon={<X />} onClick={onClose} />
        </div>
      </div>
      <MobilePanelSwitcher activePanel="chat" onPanelChange={onPanelChange} />

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto p-5 flex flex-col items-center justify-center-safe text-center gap-6 *:shrink-0">
        {!submitted ? (
          <>
            <div className="space-y-3">
              <div className="w-16 h-16 mx-auto rounded-full bg-muted flex items-center justify-center">
                <Vote className="h-8 w-8 text-feature-chat" />
              </div>
              <h3 className="text-lg font-semibold">Coming Soon — Maybe!</h3>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-[280px] mx-auto">
                Would you like a <strong>built-in chat feature</strong> to talk with other accounts on this platform?
              </p>
            </div>

            {/* Poll options */}
            <div className="w-full space-y-2">
              {POLL_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setSelectedOption(opt.id)}
                  className={`w-full text-left px-4 py-3 rounded-lg border text-sm transition-all duration-150 ${
                    selectedOption === opt.id
                      ? 'border-primary-muted bg-primary-subtle ring-1 ring-primary-muted'
                      : 'border-border hover:border-primary-muted hover:bg-accent/30'
                  }`}
                >
                  <span className="mr-2">{opt.emoji}</span>
                  {opt.label}
                </button>
              ))}
            </div>

            <Button intent="primary" onClick={handleVote} disabled={!selectedOption}>
              Submit Vote
            </Button>
          </>
        ) : (
          <div className="space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-success-subtle flex items-center justify-center">
              <CheckCircle className="h-8 w-8 text-success" />
            </div>
            <h3 className="text-lg font-semibold">Thanks for your input!</h3>
            <p className="text-sm text-muted-foreground max-w-[280px] mx-auto leading-relaxed">
              Your vote has been recorded. If enough people are interested we'll build this feature!
            </p>
          </div>
        )}
      </div>
      </div>
    </aside>
  )
}
