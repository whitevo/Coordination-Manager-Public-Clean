import { useState, useRef, useEffect, useCallback } from 'react'
import { Search, Send, ExternalLink, MessageSquare, Loader2, Sparkles, X, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

// ── Documentation knowledge base ────────────────────────────────────────────────

interface DocEntry {
  id: string
  section: string
  path: string
  content: string
}

const DOC_ENTRIES: DocEntry[] = [
  { id: 'overview-1', section: 'Overview', path: '/overview', content: 'Coordination Manager is an open-source platform for collaborative scheduling, meeting coordination, and community announcements with a first-class API for AI agents and workflow automation.' },
  { id: 'overview-2', section: 'Overview — Key Capabilities', path: '/overview', content: 'Key capabilities include coordination calendars, smart meeting proposals, announcement system with Discord integration and polls, feedback collection, Agent API with Bearer token auth and scoped access, and human-in-the-loop safety.' },
  { id: 'overview-3', section: 'Overview — Who is this for', path: '/overview', content: 'Designed for agent developers integrating meeting scheduling into Fetch.ai uAgents or LangChain chains, community managers coordinating across time zones, and platform integrators embedding calendars and reading availability via REST.' },
  { id: 'section-1', section: 'General Docs', path: '/section/general', content: 'General docs cover the overview, architecture, getting started, authentication, and limits pages for new users and integrators.' },
  { id: 'section-2', section: 'API Reference', path: '/section/api', content: 'API Reference groups calendars, calendar sources, meetings, announcements, Discord, and feedback endpoints.' },
  { id: 'section-3', section: 'Guides', path: '/section/guides', content: 'Guides include examples, roadmap, workshops, Zoom integration, Zoom review, and coordination frameworks.' },
  { id: 'section-4', section: 'Legal', path: '/section/legal', content: 'Legal documentation includes privacy policy, terms of service, security policy, code of conduct, CLA, and trademark policy.' },
  { id: 'section-5', section: 'Proposals', path: '/section/proposals', content: 'Proposal pages cover video meeting and recording, data privacy and encryption, open source security improvement, documentation and onboarding refresh, and deferred email aliases.' },
  { id: 'proposal-1', section: 'Proposals -- Docs Refresh', path: '/proposals/docs-onboarding-licensing', content: 'Proposal for a documentation, onboarding, and enterprise packaging refresh. Covers a stronger docs landing page, role-based onboarding, bring-your-own-agent messaging, self-hosting and licensing clarity, and more screenshots and videos for product storytelling.' },
  { id: 'proposal-2', section: 'Proposals -- Email Aliases', path: '/proposals/email-aliases', content: 'Deferred mailbox aliases proposal. Captures rationale for pausing implementation now and criteria for future governance-based activation when demand and maintenance capacity are clear.' },
  { id: 'arch-1', section: 'Architecture — Stack', path: '/architecture', content: 'Tech stack: React 19 + TypeScript + Vite frontend, Node.js + Express + TypeScript backend, Supabase PostgreSQL database, Discord.js and Google Calendar API integrations, REST Agent API for external clients using scoped API keys. Deployed on Vercel (web) and Railway (API).' },
  { id: 'arch-2', section: 'Architecture — Agent API', path: '/architecture', content: 'The Agent API lives at /api/agent/* and uses Bearer token authentication separate from the web UI. API keys are stored in agent_api_keys table with user association, scopes, and optional expiration.' },
  { id: 'arch-3', section: 'Architecture — Security', path: '/architecture', content: 'Security model: Bearer token auth, scope-based access (read, write:calendars, write:meetings, write:announcements, write:feedback, wildcard *), human-in-the-loop for distribution. Global rate limit: 1,200 requests per 15 minutes per socket address, with stricter per-feature limits documented on the Limits page.' },
  { id: 'arch-4', section: 'Architecture — Data Flow', path: '/architecture', content: 'Data flow: Users create coordination calendar, participants submit availability, agent analyzes overlapping slots and proposes optimal meeting time, meeting created as draft, owner reviews, optionally creates announcement template for Discord distribution.' },
  { id: 'inset-s-1', section: 'Getting Started', path: '/getting-started', content: 'Get an API key from Settings → Agent API Keys in the web app. Set base URL (api.coordinationmanager.com/api/agent for production). Verify with GET /api/agent/me.' },
  { id: 'inset-s-2', section: 'Getting Started — Scopes', path: '/getting-started', content: 'Available scopes: read (list calendars, view availability, meetings, templates, feedback), write:calendars (create calendars), write:meetings (create meeting drafts), write:announcements (create templates), write:feedback (submit feedback), * (wildcard all permissions).' },
  { id: 'auth-1', section: 'Authentication', path: '/authentication', content: 'All requests must include Authorization: Bearer cm_agent_YOUR_KEY header. Keys have properties: api_key (token string), name, scopes array, is_active, expires_at, last_used_at.' },
  { id: 'auth-2', section: 'Authentication — Errors', path: '/authentication', content: '401 Unauthorized: missing key, invalid key, inactive key, expired key. 403 Forbidden: valid key but insufficient scope for the requested endpoint.' },
  { id: 'limits-1', section: 'Limits — AI usage', path: '/limits', content: 'Daily AI prompt budgets by account tier: Traveler 2 chat prompts/day and 20 mailbox email assessments/day, Verified 10 chat prompts/day and 300 mailbox email assessments/day, Admin 200 chat prompts/day and 3,000 mailbox email assessments/day. Mailbox email assessment automation gets a much larger budget than interactive chat because it is a bounded, structured scoring call driven by rules you configure.' },
  { id: 'limits-2', section: 'Limits — API rate limits', path: '/limits', content: 'Per-feature API rate limits over rolling 15-minute windows: global 1,200 requests, authentication 120, AI chat 480, mailbox general 600, mailbox sync 20, mailbox send 40, mailbox automation run/bulk action 60, announcements send 80, Discord channel lookups 60, Zoom meeting creation 20, time management 240.' },
  { id: 'limits-3', section: 'Limits — Mailbox limits', path: '/limits', content: 'Mailbox structural limits: 50 automation rules per user, 500 messages evaluated per automation run, 25 AI assessment calls per automation run, 5 automation cascade passes, 20 bulk-action steps per request, 1,000 messages per inbox page request, 25 MB attachment downloads.' },
  { id: 'cal-1', section: 'API — List Calendars', path: '/api/calendars', content: 'GET /api/agent/calendars — List all coordination calendars owned by the API key holder. Requires read scope. Returns calendars array with id, hash, title, description, visibility, dates, hours, timezone.' },
  { id: 'cal-2', section: 'API — Get Calendar', path: '/api/calendars', content: 'GET /api/agent/calendars/:hash — Get full details for a calendar by hash. Can access own calendars or public ones. Requires read scope.' },
  { id: 'cal-3', section: 'API — Get Availability', path: '/api/calendars', content: 'GET /api/agent/calendars/:hash/availability — Get all availability submissions. Each has username and time_slots object mapping dates to time slot arrays like {"2026-03-03": ["09:00", "09:30"]}. Requires read scope.' },
  { id: 'cal-4', section: 'API — Create Calendar', path: '/api/calendars', content: 'POST /api/agent/calendars — Create a coordination calendar. Required: title. Optional: description, start_date, end_date, start_hour (8), end_hour (18), time_interval (30), timezone (UTC), visibility (unlisted). Requires write:calendars scope.' },
  { id: 'meet-1', section: 'API — List Meetings', path: '/api/meetings', content: 'GET /api/agent/calendars/:hash/meetings — List meetings for a calendar ordered by start_time. Returns meetings with title, description, start_time, end_time, duration_minutes, meeting_link, time_slots. Requires read scope.' },
  { id: 'meet-2', section: 'API — Create Meeting', path: '/api/meetings', content: 'POST /api/agent/calendars/:hash/meetings — Create a meeting draft. Required: title, start_time, end_time, duration_minutes, time_slots. Optional: description, meeting_link. Only calendar owner can create. Requires write:meetings scope. Meeting is a draft, human must approve distribution.' },
  { id: 'meet-3', section: 'API — Meeting Workflow', path: '/api/meetings', content: 'Automated meeting proposal workflow: 1) Fetch availability, 2) Count overlapping slots, 3) Find consecutive slots for desired duration, 4) Create meeting draft via API, 5) Human reviews and approves in web UI.' },
  { id: 'ann-1', section: 'API — List Templates', path: '/api/announcements', content: 'GET /api/agent/announcements/templates — List announcement templates. Returns title, body, is_poll, poll_options. Requires read scope.' },
  { id: 'ann-2', section: 'API — Create Template', path: '/api/announcements', content: 'POST /api/agent/announcements/templates — Create announcement template. Required: body. Optional: title, is_poll (false), poll_options (array). Agents CANNOT send announcements — human must click Send in web UI. Requires write:announcements scope.' },
  { id: 'fb-1', section: 'API — List Feedback', path: '/api/feedback', content: 'GET /api/agent/feedback — List feedback submitted by this agent. Supports pagination (page, limit) and status filtering. Returns feedback array with message, source, status.' },
  { id: 'fb-2', section: 'API — Submit Feedback', path: '/api/feedback', content: 'POST /api/agent/feedback — Submit feedback. Required: message (string, max 2000 chars). Feedback source is marked as "agent". Requires write:feedback scope.' },
  { id: 'openapi-1', section: 'OpenAPI Spec', path: '/examples', content: 'GET /api/agent/openapi.json — Returns OpenAPI 3.0 specification for the Agent API. Can be imported into Swagger UI, Postman, or used by LLM function-calling frameworks for automatic tool discovery.' },
  { id: 'road-1', section: 'Roadmap', path: '/roadmap', content: 'v1.0 (shipped): calendars, agent API, meetings, announcements, Discord bot, feedback, Cardano wallet. v1.1 (Q1 2026): docs site, AI search, playground, webhooks, SDK. v1.2 (Q2): agent marketplace, multi-agent, calendar sync, recurring meetings. v2.0 (Q3-Q4): coordination intelligence, adaptive meeting formats, federation, on-chain governance.' },
  { id: 'ws-1', section: 'Workshops', path: '/workshops', content: 'Coordination meetings to align on next steps for the platform. First meeting: March 4th 2026 at coordinationmanager.com/calendar/sWhdraY420. Open to anyone interested in shaping the platform.' },
]

// ── Search helper ───────────────────────────────────────────────────────────────

function searchDocs(query: string): { entry: DocEntry; score: number }[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []

  return DOC_ENTRIES.map((entry) => {
    const text = `${entry.section} ${entry.content}`.toLowerCase()
    let score = 0
    for (const term of terms) {
      const regex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
      const matches = text.match(regex)
      if (matches) score += matches.length * 2
      if (text.includes(term)) score += 1
    }
    if (text.includes(query.toLowerCase())) score += terms.length * 3
    return { entry, score }
  })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
}

// ── Types ───────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: { section: string; path: string }[]
}

const SESSION_KEY = 'ai-search-messages'

function loadMessages(): ChatMessage[] {
  try {
    const saved = sessionStorage.getItem(SESSION_KEY)
    return saved ? JSON.parse(saved) : []
  } catch {
    return []
  }
}

// ── Component ───────────────────────────────────────────────────────────────────

interface AiSearchPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function AiSearchPanel({ isOpen, onClose }: AiSearchPanelProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages)
  const [isSearching, setIsSearching] = useState(false)
  const [animatePulse, setAnimatePulse] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Persist messages
  useEffect(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(messages))
  }, [messages])

  // Auto-focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 350)
    }
  }, [isOpen])

  // Listen for pulse event (when already open and user clicks AI Search again)
  useEffect(() => {
    const handlePulse = () => {
      setAnimatePulse(true)
      inputRef.current?.focus()
      setTimeout(() => setAnimatePulse(false), 800)
    }
    window.addEventListener('ai-search-focus', handlePulse)
    return () => window.removeEventListener('ai-search-focus', handlePulse)
  }, [])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const clearHistory = useCallback(() => {
    setMessages([])
    sessionStorage.removeItem(SESSION_KEY)
  }, [])

  const handleSearch = async (searchQuery?: string) => {
    const q = searchQuery || query.trim()
    if (!q) return

    const userMsg: ChatMessage = { id: `user-${Date.now()}`, role: 'user', content: q }
    setMessages((prev) => [...prev, userMsg])
    setQuery('')
    setIsSearching(true)

    await new Promise((r) => setTimeout(r, 400))

    const results = searchDocs(q)
    let answer: string
    let sources: { section: string; path: string }[] = []

    if (results.length > 0) {
      const topResults = results.slice(0, 4)
      sources = topResults.map((r) => ({ section: r.entry.section, path: r.entry.path }))
      const seen = new Set<string>()
      sources = sources.filter((s) => {
        const key = `${s.path}#${s.section}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      answer = topResults.map((r) => r.entry.content).join('\n\n')
    } else {
      answer = "I couldn't find specific documentation matching your query. Try rephrasing, or browse the sidebar topics."
    }

    const assistantMsg: ChatMessage = { id: `assistant-${Date.now()}`, role: 'assistant', content: answer, sources }
    setMessages((prev) => [...prev, assistantMsg])
    setIsSearching(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSearch()
    }
  }

  /** Navigate main content area when clicking a source link */
  const handleSourceClick = (path: string) => {
    navigate(path)
    // Panel stays open — no onClose call
  }

  const suggestedQuestions = [
    'How do I authenticate?',
    'Create a meeting draft',
    'What scopes do I need?',
    'Meeting proposal workflow',
    'Can agents send announcements?',
    'Coordination frameworks',
  ]

  return (
    <>
      {/* Backdrop on mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <aside
        className={`
          fixed top-16 right-0 z-40 h-[calc(100vh-4rem)] w-88 sm:w-96
          bg-surface-900 border-l border-surface-700
          flex flex-col
          transform transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
        `}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-4 py-3 border-b border-surface-700 shrink-0
                         ${animatePulse ? 'animate-search-pulse' : ''}`}>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-brand-400" />
            <span className="text-sm font-semibold text-white">AI Search</span>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                onClick={clearHistory}
                className="p-1.5 rounded-md text-gray-500 hover:text-gray-300 hover:bg-surface-800 transition-colors"
                title="Clear history"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-gray-500 hover:text-gray-300 hover:bg-surface-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.length === 0 ? (
            <div>
              <p className="text-xs text-gray-500 mb-3">Ask anything about the API:</p>
              <div className="flex flex-col gap-1.5">
                {suggestedQuestions.map((q) => (
                  <button
                    key={q}
                    onClick={() => handleSearch(q)}
                    className="text-left text-xs px-3 py-2 rounded-lg border border-surface-700 text-gray-400
                               hover:border-brand-600/50 hover:text-gray-200 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`rounded-lg p-3 ${
                  msg.role === 'user'
                    ? 'bg-brand-950/30 border border-brand-800/30 ml-4'
                    : 'bg-surface-800 border border-surface-700 mr-2'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1.5">
                  {msg.role === 'user' ? (
                    <MessageSquare className="w-3.5 h-3.5 text-brand-400" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 text-brand-400" />
                  )}
                  <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                    {msg.role === 'user' ? 'You' : 'Docs AI'}
                  </span>
                </div>
                <div className="text-xs text-gray-300 whitespace-pre-wrap leading-relaxed">
                  {msg.content}
                </div>
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-surface-700">
                    <p className="text-[10px] font-semibold text-gray-500 mb-1.5">Sources</p>
                    <div className="flex flex-wrap gap-1.5">
                      {msg.sources.map((source, i) => (
                        <button
                          key={i}
                          onClick={() => handleSourceClick(source.path)}
                          className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded
                                     bg-surface-700/50 text-brand-300 hover:text-brand-200 hover:bg-surface-700
                                     transition-colors cursor-pointer border-0"
                        >
                          <ExternalLink className="w-3 h-3" />
                          {source.section}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}

          {isSearching && (
            <div className="flex items-center gap-2 text-xs text-gray-500 px-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Searching...
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input bar */}
        <div className="px-3 py-3 border-t border-surface-700 shrink-0">
          <div className="flex gap-2 items-center bg-surface-800 border border-surface-700 rounded-lg px-3 py-2
                          focus-within:border-brand-600/50 transition-colors">
            <Search className="w-4 h-4 text-gray-500 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={messages.length > 0 ? 'Follow-up...' : 'Search the docs...'}
              className="flex-1 bg-transparent outline-hidden text-xs text-gray-200 placeholder-gray-500"
            />
            <button
              onClick={() => handleSearch()}
              disabled={!query.trim() || isSearching}
              className="p-1 rounded-md bg-brand-600 text-white hover:bg-brand-500 disabled:opacity-40
                         disabled:cursor-not-allowed transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
