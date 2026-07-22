import { useState, useEffect, useRef, useCallback } from 'react'
import { useLocation, Link } from 'react-router-dom'
import { X, Sparkles, Send, Loader2, Trash2, MessageSquare, ChevronDown, ChevronUp, CheckCircle, AlertTriangle, Info, Compass, Eye } from 'lucide-react'
import { apiClient } from '../lib/api-client'
import { useAuth } from '../contexts/AuthContext'
import { useAiAssistant } from '../contexts/AiAssistantContext'
import type { AiModelId } from '../lib/theme-types'
import { AI_MODEL_OPTIONS, AI_ROLE_OPTIONS, resolveAiRole } from '../lib/theme-types'
import SentimentGrid from './SentimentGrid'
import LearnerHelpIcon from './LearnerHelpIcon'
import MobilePanelSwitcher from './MobilePanelSwitcher'
import type { PanelId } from './FloatingPanels'

// ── Types ───────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
  action?: string
}

interface SentimentState {
  valence: number
  trust: number
  feedbackText: string
  submitted: boolean
  submitting: boolean
}

interface AiStatus {
  available: boolean
  provider: string
  model: string
}

interface AiGuideSidePanelProps {
  isOpen: boolean
  onClose: () => void
  onPanelChange: (panel: Exclude<PanelId, null>) => void
}

const SESSION_KEY = 'cm-ai-guide-messages'

function loadMessages(): ChatMessage[] {
  try {
    const saved = sessionStorage.getItem(SESSION_KEY)
    if (!saved) return []
    return (JSON.parse(saved) as ChatMessage[]).map(m => ({
      ...m,
      timestamp: new Date(m.timestamp),
    }))
  } catch {
    return []
  }
}

// ── Component ───────────────────────────────────────────────────────────────────

// ── Page-aware suggestion defaults ──────────────────────────────────────────────

const PAGE_SUGGESTIONS: Record<string, { suggestions: string[]; placeholder: string; description: string }> = {
  '/distribute': {
    suggestions: [
      'Help me draft a team message',
      'Improve the tone of my message',
      'Make this message more concise',
      'Translate my message to a friendlier tone',
    ],
    placeholder: 'Ask for help with your message...',
    description: 'I can help you draft, refine, and improve your messages. On this page, I can also apply changes directly to the compose form.',
  },
  '/feedback': {
    suggestions: [
      'How do I give constructive feedback?',
      'Help me phrase this feedback positively',
      'What makes good feedback?',
      'Summarise feedback best practices',
    ],
    placeholder: 'Ask about feedback...',
    description: 'I can help with feedback best practices and phrasing.',
  },
  '/settings': {
    suggestions: [
      'What settings are available?',
      'How do I connect Discord?',
      'Explain AI model options',
      'How do notifications work?',
    ],
    placeholder: 'Ask about settings...',
    description: 'I can help you understand and configure your settings.',
  },
  '/coordinate-events': {
    suggestions: [
      'How does event coordination work?',
      'Best practices for scheduling group events',
      'How to create a coordination calendar',
      'Tips for finding optimal meeting times',
    ],
    placeholder: 'Ask about event coordination...',
    description: 'I can help with event coordination and scheduling. For poll/channel auto-fill, use AI on the Distribute Messages page.',
  },
  '/time-management': {
    suggestions: [
      'Create a Sleepz background from 01:00 to 08:00 Estonian time and keep UTC primary',
      'Set slot width to 15 minutes',
      'Create category Deep Work in blue',
      'Open mode settings and export mode JSON',
    ],
    placeholder: 'Ask me to update Time Management tools...',
    description: 'I can operate Time Management left-panel tools directly: open sections, set slot width, manage recurring backgrounds, categories, modes, and timezone-related updates. I preserve your current primary timezone unless you explicitly ask to change it. Saying "apply X timezone" adds it for scheduling context.',
  },
}

const DEFAULT_SUGGESTIONS = [
  'What is coordination philosophy?',
  'How do shared calendars work?',
  'Best practices for inclusive meetings',
  'Help me draft a team announcement',
]

const DEFAULT_PLACEHOLDER = 'Ask me anything...'
const DEFAULT_DESCRIPTION = 'I can help with app features, coordination philosophy, meeting best practices, and more. Form auto-fill is available on the Distribute Messages page.'

export function AiGuideSidePanel({ isOpen, onClose, onPanelChange }: AiGuideSidePanelProps) {
  const { user, isAuthenticated } = useAuth()
  const { pageContext } = useAiAssistant()
  const location = useLocation()
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [limit, setLimit] = useState<number | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Resolve page-aware suggestions, placeholder, and description
  const pagePath = location.pathname
  const pageDefaults = PAGE_SUGGESTIONS[pagePath]
  const activeSuggestions = pageContext?.suggestions ?? pageDefaults?.suggestions ?? DEFAULT_SUGGESTIONS
  const activePlaceholder = pageContext?.placeholder ?? pageDefaults?.placeholder ?? DEFAULT_PLACEHOLDER
  const activeDescription = pageDefaults?.description ?? DEFAULT_DESCRIPTION
  const activePageName = pageContext?.pageName ?? null
  const activeRole = resolveAiRole(activePageName)

  // Oversight — determines system-prompt transparency + sentiment tools
  const isOversight = user?.themePreferences?.aiSettings?.sentimentToolEnabled === true
    || user?.roles?.includes('admin')

  // Collapsible system prompt state per-message
  const [expandedSystemIdx, setExpandedSystemIdx] = useState<Set<number>>(new Set())

  // Sentiment state
  const sentimentToolEnabled = isOversight
  const [expandedFeedbackIdx, setExpandedFeedbackIdx] = useState<number | null>(null)
  const [sentimentStates, setSentimentStates] = useState<Record<number, SentimentState>>({})

  // Persist messages (exclude system prompts — they are large and session-only)
  useEffect(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(messages.filter(m => m.role !== 'system')))
  }, [messages])

  // Auto-focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 350)
    }
  }, [isOpen])

  // Auto-grow the input textarea so text remains visible while typing.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [input, isOpen])

  // Check AI status when panel opens (only for authenticated users)
  useEffect(() => {
    if (!isOpen || !isAuthenticated) return
    const checkStatus = async () => {
      try {
        const { data } = await apiClient.get('/api/ai-chat/status')
        setStatus(data)
        if (typeof data.remaining === 'number') setRemaining(data.remaining)
        if (typeof data.limit === 'number') setLimit(data.limit)
      } catch {
        setStatus({ available: false, provider: 'unknown', model: 'unknown' })
      }
    }
    checkStatus()
  }, [isOpen, isAuthenticated])

  // Scroll to bottom on new messages (within the panel only, not the page)
  useEffect(() => {
    const container = scrollContainerRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }, [messages])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const autoGrowTextarea = (el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }

  // Core send logic — accepts explicit text so suggestion buttons can bypass stale state
  const doSend = useCallback(async (text: string) => {
    if (!text || sending) return

    setError('')
    const userMessage: ChatMessage = { role: 'user', content: text, timestamp: new Date() }
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setSending(true)

    try {
      // If a page has registered a custom handler, use it
      if (pageContext?.onSubmit) {
        const history = messages
          .filter((m): m is ChatMessage & { role: 'user' | 'assistant' } => m.role !== 'system')
          .map(m => ({ role: m.role, content: m.content }))
        const result = await pageContext.onSubmit(text, history)
        const newMessages: ChatMessage[] = []
        if (result.systemPrompt) {
          newMessages.push({
            role: 'system',
            content: result.systemPrompt,
            timestamp: new Date(),
          })
        }
        newMessages.push({
          role: 'assistant',
          content: result.message,
          timestamp: new Date(),
          action: result.action,
        })
        setMessages(prev => [...prev, ...newMessages])
      } else {
        // Default: general AI chat
        const history = messages
          .filter(m => m.role !== 'system')
          .map(m => ({ role: m.role, content: m.content }))
        const preferredModel: AiModelId = user?.themePreferences?.aiSettings?.preferredModel || 'openai'

        const { data } = await apiClient.post('/api/ai-chat', {
          message: text,
          history,
          preferredModel,
        })

        // Insert a system-prompt bubble before the assistant reply (Oversight only)
        const newMessages: ChatMessage[] = []
        if (data.systemPrompt) {
          newMessages.push({
            role: 'system',
            content: data.systemPrompt,
            timestamp: new Date(),
          })
        }
        newMessages.push({
          role: 'assistant',
          content: data.message,
          timestamp: new Date(),
        })
        setMessages(prev => [...prev, ...newMessages])

        if (data.feedbackSubmitted?.submitted) {
          const fbCat = data.feedbackSubmitted.category || 'general'
          const feedbackNote: ChatMessage = {
            role: 'assistant',
            content: `✅ Feedback submitted (category: ${fbCat}). You can view it on the Feedback page.`,
            timestamp: new Date(),
          }
          setMessages(prev => [...prev, feedbackNote])
        }
      }
    } catch (err) {
      const errorMsg = (err as { response?: { data?: { message?: string } } }).response?.data?.message || 'Failed to get a response. Please try again.'
      setError(errorMsg)
    } finally {
      setSending(false)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [sending, messages, user, pageContext])

  const handleSend = useCallback(() => {
    doSend(input.trim())
  }, [input, doSend])

  const clearChat = () => {
    setMessages([])
    setError('')
    setSentimentStates({})
    setExpandedFeedbackIdx(null)
    setExpandedSystemIdx(new Set())
    sessionStorage.removeItem(SESSION_KEY)
  }

  // Sentiment feedback helpers
  const _getSentimentState = (idx: number): SentimentState =>
    sentimentStates[idx] || { valence: 0, trust: 0, feedbackText: '', submitted: false, submitting: false }

  const toggleFeedback = (idx: number) => {
    setExpandedFeedbackIdx(prev => prev === idx ? null : idx)
    if (!sentimentStates[idx]) {
      setSentimentStates(prev => ({
        ...prev,
        [idx]: { valence: 0, trust: 0, feedbackText: '', submitted: false, submitting: false },
      }))
    }
  }

  const handleSubmitFeedback = async (idx: number) => {
    const assistantMsg = messages[idx]
    const state = sentimentStates[idx]
    if (!assistantMsg || !state || state.submitted || state.submitting) return

    let userPrompt = ''
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        userPrompt = messages[i].content
        break
      }
    }
    if (!userPrompt) return

    setSentimentStates(prev => ({ ...prev, [idx]: { ...prev[idx], submitting: true } }))

    try {
      await apiClient.post('/api/ai-feedback', {
        user_prompt: userPrompt,
        ai_answer: assistantMsg.content,
        sentiment_valence: state.valence,
        sentiment_trust: state.trust,
        feedback_text: state.feedbackText || null,
      })
      setSentimentStates(prev => ({ ...prev, [idx]: { ...prev[idx], submitted: true, submitting: false } }))
    } catch {
      setSentimentStates(prev => ({ ...prev, [idx]: { ...prev[idx], submitting: false } }))
    }
  }

  // Basic markdown-like rendering for assistant messages
  const formatMessage = (text: string) => {
    const parts = text.split(/(```[\s\S]*?```)/g)
    return parts.map((part, i) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const code = part.slice(3, -3)
        const firstNewline = code.indexOf('\n')
        const codeContent = firstNewline > -1 ? code.slice(firstNewline + 1) : code
        return (
          <pre key={i} className="bg-muted rounded-lg p-2 my-1.5 overflow-x-auto text-[11px]">
            <code>{codeContent}</code>
          </pre>
        )
      }
      const inlineParts = part.split(/(`[^`]+`)/g)
      return (
        <span key={i}>
          {inlineParts.map((ip, j) => {
            if (ip.startsWith('`') && ip.endsWith('`')) {
              return (
                <code key={j} className="bg-muted px-1 py-0.5 rounded text-[11px] font-mono">
                  {ip.slice(1, -1)}
                </code>
              )
            }
            const boldParts = ip.split(/(\*\*[^*]+\*\*)/g)
            return boldParts.map((bp, k) => {
              if (bp.startsWith('**') && bp.endsWith('**')) {
                return <strong key={`${j}-${k}`}>{bp.slice(2, -2)}</strong>
              }
              return <span key={`${j}-${k}`}>{bp}</span>
            })
          })}
        </span>
      )
    })
  }

  const modelLabel = (() => {
    const preferredId = user?.themePreferences?.aiSettings?.preferredModel || 'openai'
    const opt = AI_MODEL_OPTIONS.find(m => m.id === preferredId)
    return opt ? `${opt.provider} · ${opt.label}` : ''
  })()

  return (
    <>
      {/* Panel */}
      <aside
        className={`
          fixed inset-y-0 right-0 z-50 w-screen transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0 pointer-events-auto sm:w-[22rem] md:w-96' : 'translate-x-full pointer-events-none sm:w-0'}
          sm:sticky sm:top-0 sm:h-screen sm:shrink-0 sm:overflow-hidden sm:translate-x-0 sm:pointer-events-auto
        `}
      >
      <div className={`ml-auto h-full w-screen flex flex-col bg-card border-l border-border shadow-xl sm:w-[22rem] sm:min-w-[22rem] md:w-96 md:min-w-[24rem]`}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-500" />
            <div>
              <span className="text-sm font-semibold text-foreground">AI Assistant</span>
              <LearnerHelpIcon size={4} description={<><p className="font-semibold text-blue-700 dark:text-blue-300 mb-1">Side Panel - AI Assistant</p><p className="mb-1.5">Side panels slide in from the right on every page, giving you quick access to conversational tools without leaving what you're doing.</p><p className="mb-1.5">The AI Assistant adapts its <strong>role</strong> based on which page you are on. There are three roles:</p><ul className="list-disc pl-4 mb-1.5 space-y-1"><li><strong>Guider</strong> - General-purpose guide. Explains features, answers questions about coordination philosophy, and helps with onboarding. Active on most pages.</li><li><strong>Composer</strong> - Message specialist. Helps draft messages, configure distribution targets, create polls, and refine content. Active on the Distribute Messages page.</li><li><strong>Operator</strong> - Operational assistant for Calendar and Time Management. Interprets natural-language commands to set availability, adjust time ranges, configure calendar parameters, and update left-side Time Management tools.</li></ul><p>The current role is highlighted in the header. The role switches automatically when you navigate between pages.</p></>} />
              {(activePageName || modelLabel) && (
                <p className="text-[10px] text-muted-foreground">
                  {activePageName ? `${activePageName}` : ''}
                  {activePageName && modelLabel ? ' · ' : ''}
                  {modelLabel}
                </p>
              )}
            </div>
          </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  onClick={clearChat}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Clear history"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={onClose}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* AI Role pills */}
          <div className="flex items-center gap-1.5 mt-2">
            {AI_ROLE_OPTIONS.map(role => {
              const isActive = role.id === activeRole
              const colorMap: Record<string, { active: string; inactive: string }> = {
                purple: {
                  active: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-700',
                  inactive: 'bg-muted/40 text-muted-foreground border-transparent hover:bg-muted/70',
                },
                sky: {
                  active: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 border-sky-300 dark:border-sky-700',
                  inactive: 'bg-muted/40 text-muted-foreground border-transparent hover:bg-muted/70',
                },
                emerald: {
                  active: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700',
                  inactive: 'bg-muted/40 text-muted-foreground border-transparent hover:bg-muted/70',
                },
              }
              const colors = colorMap[role.color] || colorMap.purple
              return (
                <span
                  key={role.id}
                  title={role.description}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
                    isActive ? colors.active : colors.inactive
                  }`}
                >
                  {role.tag}
                </span>
              )
            })}
          </div>
        </div>
        <MobilePanelSwitcher activePanel="ai" onPanelChange={onPanelChange} />

        {/* Service unavailable warning */}
        {isAuthenticated && status && !status.available && (
          <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950 border-b border-amber-200 dark:border-amber-800 flex-shrink-0">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
              <p className="text-[11px] text-amber-700 dark:text-amber-300">AI service not configured. Contact your administrator.</p>
            </div>
          </div>
        )}

        {/* Sign-in prompt for unauthenticated users */}
        {!isAuthenticated ? (
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-8">
            <Sparkles className="w-10 h-10 text-purple-400 mb-4" />
            <h3 className="text-sm font-semibold mb-2">Sign in to use AI Assistant</h3>
            <p className="text-xs text-muted-foreground text-center mb-6">Create an account or continue as a traveler to chat with the AI assistant.</p>
            <div className="w-full max-w-[220px] space-y-2">
              <Link
                to="/auth/login"
                state={{ from: { pathname: location.pathname } }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 border border-border rounded-lg hover:bg-muted transition-colors text-sm"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                <span className="font-medium">Continue with Google</span>
              </Link>
              <Link
                to="/auth/login"
                state={{ from: { pathname: location.pathname } }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900 transition-colors text-sm"
              >
                <Compass className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <span className="font-medium text-amber-800 dark:text-amber-200">Continue as Traveler</span>
              </Link>
            </div>
            <div className="flex items-start gap-1.5 mt-4 text-[10px] text-muted-foreground max-w-[220px]">
              <Info className="w-3 h-3 mt-0.5 shrink-0" />
              <span>Traveler: no email needed, random identity, expires in 64 days</span>
            </div>
          </div>
        ) : (
        <>
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 py-4 flex flex-col">
          <div className="mt-auto space-y-3">
          {messages.length === 0 ? (
            <div className="space-y-3">
              <div className="text-center py-6">
                <Sparkles className="w-8 h-8 text-purple-400 mx-auto mb-3" />
                <p className="text-sm font-medium text-foreground mb-1">
                  {activePageName ? `${activePageName} Assistant` : 'AI Assistant'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {activeDescription}
                </p>
              </div>
              <div className="space-y-1.5">
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider px-1">
                  {pageContext ? 'Try saying:' : 'Try asking:'}
                </p>
                {activeSuggestions.map((q) => (
                  <button
                    key={q}
                    onClick={() => doSend(q)}
                    className="w-full text-left text-xs px-3 py-2 rounded-lg border border-border text-muted-foreground
                               hover:border-purple-300 dark:hover:border-purple-700 hover:text-foreground transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div key={idx} className="space-y-2">
                {msg.role === 'system' ? (
                  /* System prompt bubble — Oversight only */
                  <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20 mr-6">
                    <button
                      onClick={() => setExpandedSystemIdx(prev => {
                        const next = new Set(prev)
                        if (next.has(idx)) next.delete(idx); else next.add(idx)
                        return next
                      })}
                      className="w-full flex items-center gap-1.5 px-3 py-2 text-left"
                    >
                      <Eye className="w-3 h-3 text-amber-500 shrink-0" />
                      <span className="text-[10px] font-medium text-amber-700 dark:text-amber-300 uppercase tracking-wider">System Prompt</span>
                      <span className="ml-auto">
                        {expandedSystemIdx.has(idx) ? <ChevronUp className="w-3 h-3 text-amber-500" /> : <ChevronDown className="w-3 h-3 text-amber-500" />}
                      </span>
                    </button>
                    {expandedSystemIdx.has(idx) && (
                      <div className="px-3 pb-3 border-t border-amber-200/50 dark:border-amber-800/50">
                        <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap mt-2 max-h-80 overflow-y-auto font-mono leading-relaxed">{msg.content}</pre>
                      </div>
                    )}
                  </div>
                ) : msg.role === 'user' ? (
                  /* User prompt */
                  <div className="rounded-lg p-3 bg-purple-50/50 dark:bg-purple-950/30 border border-purple-200/50 dark:border-purple-800/30 ml-6">
                    <div className="flex items-center gap-1.5 mb-1">
                      <MessageSquare className="w-3 h-3 text-purple-500" />
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">You</span>
                    </div>
                    <p className="text-xs text-foreground">{msg.content}</p>
                  </div>
                ) : (
                  /* AI Response */
                  <div className="rounded-lg p-3 bg-muted/50 border border-border mr-6">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Sparkles className="w-3 h-3 text-purple-500" />
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">AI</span>
                      {msg.action && msg.action !== 'none' && (
                        <span className="ml-auto text-[9px] font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/40 px-1.5 py-0.5 rounded">
                          {
                            msg.action === 'set_availability'
                              ? 'Applied'
                              : msg.action === 'clear_availability'
                                ? 'Cleared'
                                : msg.action === 'configure'
                                  ? 'Configured'
                                  : msg.action === 'configure_time_management'
                                    ? 'Updated TM'
                                    : msg.action
                          }
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-foreground whitespace-pre-wrap">{formatMessage(msg.content)}</div>

                    {/* Sentiment feedback — oversight/admin only */}
                    {sentimentToolEnabled && (
                      <>
                        <button
                          onClick={() => toggleFeedback(idx)}
                          className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {expandedFeedbackIdx === idx ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          {sentimentStates[idx]?.submitted ? 'Feedback submitted' : 'Give feedback'}
                        </button>

                        {expandedFeedbackIdx === idx && sentimentStates[idx] && (
                          <div className="mt-2 pt-2 border-t border-border space-y-2">
                            {sentimentStates[idx].submitted ? (
                              <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                                <CheckCircle className="w-3.5 h-3.5" />
                                Thank you for your feedback!
                              </div>
                            ) : (
                              <>
                                <div className="flex justify-center">
                                  <SentimentGrid
                                    valence={sentimentStates[idx].valence}
                                    trust={sentimentStates[idx].trust}
                                    onChange={(v, t) =>
                                      setSentimentStates(prev => ({
                                        ...prev,
                                        [idx]: { ...prev[idx], valence: v, trust: t },
                                      }))
                                    }
                                    size={160}
                                    disabled={sentimentStates[idx].submitting}
                                  />
                                </div>
                                <textarea
                                  ref={(el) => autoGrowTextarea(el)}
                                  value={sentimentStates[idx].feedbackText}
                                  onChange={(e) =>
                                    {
                                      autoGrowTextarea(e.currentTarget)
                                      setSentimentStates(prev => ({
                                        ...prev,
                                        [idx]: { ...prev[idx], feedbackText: e.target.value },
                                      }))
                                    }
                                  }
                                  onFocus={(e) => autoGrowTextarea(e.currentTarget)}
                                  placeholder="Optional: any additional thoughts..."
                                  rows={2}
                                  disabled={sentimentStates[idx].submitting}
                                  className="w-full px-2 py-1.5 border border-border rounded text-xs bg-background text-foreground resize-none overflow-hidden focus:ring-1 focus:ring-purple-400 outline-none disabled:opacity-50 leading-5"
                                />
                                <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
                                  <Info className="h-3 w-3 shrink-0 mt-0.5" />
                                  <span>Prompt, AI answer, and sentiment data will be stored and visible to admins.</span>
                                </div>
                                <button
                                  onClick={() => handleSubmitFeedback(idx)}
                                  disabled={sentimentStates[idx].submitting}
                                  className="w-full px-3 py-1.5 bg-purple-600 text-white rounded text-xs font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                                >
                                  {sentimentStates[idx].submitting ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Send className="w-3 h-3" />
                                  )}
                                  Submit Feedback
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            ))
          )}

          {sending && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground px-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-500" />
              Thinking...
            </div>
          )}

          <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Error bar */}
        {error && (
          <div className="px-4 py-2 bg-red-50 dark:bg-red-950/50 border-y border-red-200 dark:border-red-800 flex-shrink-0">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-red-600 dark:text-red-400 flex-1">{error}</p>
              <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 shrink-0">
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {/* Input bar */}
        <div className="px-3 py-3 border-t border-border flex-shrink-0">
          {remaining !== null && limit !== null && (
            <p className="text-[10px] text-muted-foreground mb-1.5 px-1">
              {remaining}/{limit} AI prompts remaining today
            </p>
          )}
          <div className="flex gap-2 items-end border border-border rounded-lg px-3 py-2
                          focus-within:border-purple-400 dark:focus-within:border-purple-600 transition-colors bg-background">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder={
                remaining === 0
                  ? 'Daily AI limit reached'
                  : status && !status.available
                    ? 'AI service not configured'
                    : activePlaceholder
              }
              disabled={remaining === 0 || (status !== null && !status.available)}
              className="flex-1 bg-transparent outline-none text-xs text-foreground placeholder-muted-foreground/50 disabled:opacity-50 resize-none overflow-hidden leading-5"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending || remaining === 0 || (status !== null && !status.available)}
              className="p-1.5 rounded-md text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
              style={{
                background: 'linear-gradient(135deg, #8B5CF6, #6366F1, #3B82F6)',
              }}
            >
              {sending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
          <p className="text-[9px] text-muted-foreground mt-1.5 text-center">
            AI responses may be inaccurate. Powered by ASI Alliance &amp; SingularityNET.
          </p>
        </div>
        </>
        )}
      </div>
      </aside>
    </>
  )
}
