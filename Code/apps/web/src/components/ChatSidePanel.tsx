import { useState } from 'react'
import { X, MessageCircle, Vote, CheckCircle } from 'lucide-react'
import LearnerHelpIcon from './LearnerHelpIcon'
import MobilePanelSwitcher from './MobilePanelSwitcher'
import type { PanelId } from './FloatingPanels'

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
        fixed inset-y-0 right-0 z-50 w-screen transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0 pointer-events-auto sm:w-[22rem] md:w-96' : 'translate-x-full pointer-events-none sm:w-0'}
        sm:sticky sm:top-0 sm:h-screen sm:shrink-0 sm:overflow-hidden sm:translate-x-0 sm:pointer-events-auto
      `}
    >
      <div className={`ml-auto h-full w-screen flex flex-col bg-card border-l-2 border-sky-400 dark:border-sky-500 shadow-xl sm:w-[22rem] sm:min-w-[22rem] md:w-96 md:min-w-[24rem]`}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-sky-50 dark:bg-sky-950/40">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-sky-500" />
          <h2 className="font-semibold text-sm">Chat</h2>
          <LearnerHelpIcon size={4} description={<><p className="font-semibold text-blue-700 dark:text-blue-300 mb-1">Side Panel — Chat</p><p className="mb-1.5">Side panels slide in from the right on every page, giving you quick access to conversational tools without leaving what you’re doing.</p><p className="mb-1.5">The <strong>Chat panel</strong> is a place to communicate with other users on the platform — share ideas, coordinate plans, or ask questions in real time.</p><p><strong>Coming soon:</strong> This feature is currently gathering interest. Vote below to help shape its development!</p></>} />
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md text-muted-foreground hover:bg-accent/50 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <MobilePanelSwitcher activePanel="chat" onPanelChange={onPanelChange} />

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-5 flex flex-col items-center justify-center text-center gap-6">
        {!submitted ? (
          <>
            <div className="space-y-3">
              <div className="w-16 h-16 mx-auto rounded-full bg-sky-100 dark:bg-sky-900/40 flex items-center justify-center">
                <Vote className="h-8 w-8 text-sky-500" />
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
                      ? 'border-sky-400 bg-sky-50 dark:bg-sky-900/30 ring-1 ring-sky-300'
                      : 'border-border hover:border-sky-300 hover:bg-accent/30'
                  }`}
                >
                  <span className="mr-2">{opt.emoji}</span>
                  {opt.label}
                </button>
              ))}
            </div>

            <button
              onClick={handleVote}
              disabled={!selectedOption}
              className={`px-6 py-2.5 rounded-lg text-sm font-medium text-white transition-all duration-200 ${
                selectedOption
                  ? 'bg-sky-500 hover:bg-sky-600 shadow-md'
                  : 'bg-sky-300 dark:bg-sky-800 cursor-not-allowed'
              }`}
            >
              Submit Vote
            </button>
          </>
        ) : (
          <div className="space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <CheckCircle className="h-8 w-8 text-emerald-500" />
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
