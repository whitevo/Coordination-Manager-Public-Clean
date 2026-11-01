import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { apiClient } from '../lib/api-client'
import { Bot, Send, Trash2, AlertTriangle, Loader2, Sparkles, User, MessageSquare, CheckCircle, Info, Eye, Paperclip, X as XIcon } from 'lucide-react'
import type { AiModelId } from '../lib/theme-types'
import { AI_MODEL_OPTIONS } from '../lib/theme-types'
import SentimentGrid from '../components/SentimentGrid'
import LearnerHelpIcon from '../components/LearnerHelpIcon'
import { Button, Disclosure, IconButton } from '../components/ui'
import { AiUserMessage } from '@/components/ai-user-message'
import { AI_MESSAGE_MAX_LENGTH, getAiMessageError } from '@/lib/ai-message'

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
  /** Index of the user prompt this assistant message responds to */
  userPromptIndex?: number
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
  supportsVision?: boolean
}

export default function AiChatPage() {
  const { user } = useAuth()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [limit, setLimit] = useState<number | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [pendingImage, setPendingImage] = useState<{ base64: string; mimeType: string } | null>(null)

  // Oversight — determines system-prompt transparency + sentiment tools
  const isOversight = user?.themePreferences?.aiSettings?.sentimentToolEnabled === true
    || user?.roles?.includes('admin')
  const sentimentToolEnabled = isOversight
  const [expandedSentimentIdx, setExpandedSentimentIdx] = useState<number | null>(null)
  const [sentimentStates, setSentimentStates] = useState<Record<number, SentimentState>>({})
  const [expandedSystemIdx, setExpandedSystemIdx] = useState<Set<number>>(new Set())

  // Scroll to bottom whenever messages change
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // Check AI service availability on mount
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const { data } = await apiClient.get('/api/ai-chat/status')
        setStatus(data)
        if (typeof data.remaining === 'number') setRemaining(data.remaining)
        if (typeof data.limit === 'number') setLimit(data.limit)
      } catch (statusError) {
        console.error('Unable to check AI availability and allowance:', statusError)
        setError('Unable to check AI availability or your daily allowance. Please refresh the page and try again.')
      } finally {
        setStatusLoading(false)
      }
    }
    checkStatus()
  }, [])

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'
  }

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || sending) return
    if (remaining === 0) {
      setError('Your daily AI prompt allowance has been used. It resets tomorrow.')
      return
    }
    const messageError = getAiMessageError(input)
    if (messageError) {
      setError(messageError)
      return
    }

    setError('')
    // Show a user message with image indicator if one is pending
    const imageLabel = pendingImage ? ' [image attached]' : ''
    const userMessage: ChatMessage = {
      role: 'user',
      content: input + imageLabel,
      timestamp: new Date(),
    }
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setSending(true)

    const capturedImage = pendingImage
    setPendingImage(null)

    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }

    try {
      // Send conversation history (last 50 messages) for context, excluding system bubbles
      const history = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }))

      // Read user's AI model preference from themePreferences
      const preferredModel: AiModelId = user?.themePreferences?.aiSettings?.preferredModel || 'openai'

      const payload: Record<string, unknown> = { message: input, history, preferredModel }
      if (capturedImage) {
        payload.imageBase64 = capturedImage.base64
        payload.imageMimeType = capturedImage.mimeType
      }

      const { data } = await apiClient.post('/api/ai-chat', payload)
      if (typeof data.remaining === 'number') setRemaining(data.remaining)
      if (typeof data.limit === 'number') setLimit(data.limit)

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

      // If the AI submitted feedback on behalf of the user, show a note
      if (data.feedbackSubmitted?.submitted) {
        const fbCat = data.feedbackSubmitted.category || 'general'
        const feedbackNote: ChatMessage = {
          role: 'assistant',
          content: `✅ **Feedback submitted** (category: ${fbCat}). You can view it on the [Feedback page](/feedback).`,
          timestamp: new Date(),
        }
        setMessages(prev => [...prev, feedbackNote])
      }
    } catch (err) {
      const responseData = (err as { response?: { data?: { message?: string; remaining?: number; limit?: number } } }).response?.data
      const errorMsg = responseData?.message || 'Failed to get a response. Please try again.'
      setError(errorMsg)
      if (typeof responseData?.remaining === 'number') setRemaining(responseData.remaining)
      if (typeof responseData?.limit === 'number') setLimit(responseData.limit)
      if (typeof responseData?.remaining !== 'number') {
        try {
          const { data } = await apiClient.get('/api/ai-chat/status')
          if (typeof data.remaining === 'number') setRemaining(data.remaining)
          if (typeof data.limit === 'number') setLimit(data.limit)
        } catch (statusError) {
          console.error('Unable to refresh AI allowance after a failed request:', statusError)
        }
      }
    } finally {
      setSending(false)
      // Re-focus input after response
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Send on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  /** Handle image file selection or paste for vision input */
  const loadImageFile = (file: File): Promise<{ base64: string; mimeType: string }> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = e => {
        const dataUrl = e.target?.result as string
        const base64 = dataUrl.split(',')[1] ?? dataUrl
        resolve({ base64, mimeType: file.type })
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

  const handleImageFile = async (file: File) => {
    try {
      const img = await loadImageFile(file)
      setPendingImage(img)
    } catch {
      // Ignore read errors
    }
  }

  const handleInputPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items).filter(i => i.kind === 'file' && i.type.startsWith('image/'))
    if (items.length === 0) return
    const file = items[0].getAsFile()
    if (file && status?.supportsVision) {
      e.preventDefault()
      await handleImageFile(file)
    }
  }

  const clearChat = () => {
    setMessages([])
    setError('')
    setSentimentStates({})
    setExpandedSentimentIdx(null)
    setExpandedSystemIdx(new Set())
    setPendingImage(null)
  }

  // ─── Sentiment feedback handlers ─────────────────
  const getSentimentState = (msgIndex: number): SentimentState =>
    sentimentStates[msgIndex] || { valence: 0, trust: 0, feedbackText: '', submitted: false, submitting: false }

  const updateSentiment = (msgIndex: number, updates: Partial<SentimentState>) => {
    setSentimentStates(prev => ({
      ...prev,
      [msgIndex]: { ...getSentimentState(msgIndex), ...updates },
    }))
  }

  const submitSentimentFeedback = async (msgIndex: number) => {
    const state = getSentimentState(msgIndex)
    const assistantMsg = messages[msgIndex]
    // Find the preceding user message
    let userPrompt = ''
    for (let i = msgIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        userPrompt = messages[i].content
        break
      }
    }

    if (!userPrompt || !assistantMsg) return

    updateSentiment(msgIndex, { submitting: true })

    try {
      await apiClient.post('/api/ai-feedback', {
        user_prompt: userPrompt,
        ai_answer: assistantMsg.content,
        sentiment_valence: state.valence,
        sentiment_trust: state.trust,
        feedback_text: state.feedbackText || null,
      })
      updateSentiment(msgIndex, { submitted: true, submitting: false })
    } catch (err) {
      console.error('Failed to submit AI feedback:', err)
      updateSentiment(msgIndex, { submitting: false })
    }
  }

  // Format message text with basic markdown-like rendering
  const formatMessage = (text: string) => {
    // Split by code blocks first
    const parts = text.split(/(```[\s\S]*?```)/g)
    return parts.map((part, i) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const code = part.slice(3, -3)
        const firstNewline = code.indexOf('\n')
        const codeContent = firstNewline > -1 ? code.slice(firstNewline + 1) : code
        return (
          <pre key={i} className="bg-muted rounded-lg p-3 my-2 overflow-x-auto text-sm">
            <code>{codeContent}</code>
          </pre>
        )
      }
      // Render inline code
      const inlineParts = part.split(/(`[^`]+`)/g)
      return (
        <span key={i}>
          {inlineParts.map((ip, j) => {
            if (ip.startsWith('`') && ip.endsWith('`')) {
              return (
                <code key={j} className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">
                  {ip.slice(1, -1)}
                </code>
              )
            }
            // Bold
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

  if (statusLoading) {
    return (
      <div className="container mx-auto px-4 py-8 flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-4xl flex flex-col" style={{ height: 'calc(100vh - 4rem)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-feature-ai-subtle text-feature-ai">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">AI Assistant</h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium border bg-feature-ai-subtle text-feature-ai border-feature-ai-muted">guider</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Guidance, onboarding &amp; coordination philosophy
              {(() => {
                const preferredId = user?.themePreferences?.aiSettings?.preferredModel || 'openai'
                const modelOption = AI_MODEL_OPTIONS.find(m => m.id === preferredId)
                return modelOption ? ` · ${modelOption.provider} · ${modelOption.label}` : ''
              })()}
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <Button
            emphasis="ghost"
            intent="danger"
            size="compact"
            onClick={clearChat}
            title="Clear conversation"
            icon={<Trash2 className="h-4 w-4" />}
          >
            Clear
          </Button>
        )}
      </div>

      {/* Service unavailable warning */}
      {status && !status.available && (
        <div className="mb-4 p-4 bg-warning-subtle border border-warning-muted rounded-lg flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-warning">AI Service Not Configured</p>
            <p className="text-sm text-warning mt-1">
              The AI chat service requires an API key to be configured. Contact your administrator to set up the 
              <code className="bg-warning-subtle px-1 rounded text-xs">AI_API_KEY</code> environment variable.
            </p>
          </div>
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4 min-h-0">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
            <Bot className="h-16 w-16 mb-4 opacity-30" />
            <p className="text-lg font-medium mb-1">Welcome to the AI Assistant</p>
            <p className="text-sm max-w-md">
              I can help with app features, coordination philosophy, meeting best practices, drafting announcements, and more.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-6 w-full max-w-lg">
              {[
                'What is coordination philosophy?',
                'How do shared calendars work?',
                'Best practices for inclusive meetings',
                'Help me draft a team announcement',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setInput(suggestion)
                    inputRef.current?.focus()
                  }}
                  className="text-left text-sm px-4 py-3 rounded-lg border border-border hover:bg-accent/50 hover:border-accent transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className="space-y-1">
            {msg.role === 'system' ? (
              /* System prompt bubble — Oversight only */
              <div className="max-w-[80%] rounded-2xl border border-warning-muted bg-warning-subtle">
                <Disclosure
                  size="compact"
                  icon={<Eye />}
                  title="System Prompt"
                  expanded={expandedSystemIdx.has(i)}
                  onToggle={() => setExpandedSystemIdx(prev => {
                    const next = new Set(prev)
                    if (next.has(i)) next.delete(i); else next.add(i)
                    return next
                  })}
                  panelClassName="px-4 pb-3 border-t border-warning-muted"
                >
                  <pre className="text-xs text-muted-foreground whitespace-pre-wrap mt-2 max-h-96 overflow-y-auto font-mono leading-relaxed">{msg.content}</pre>
                </Disclosure>
              </div>
            ) : (
            <>
            <div
              className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'assistant' && (
                <div className="shrink-0 w-8 h-8 rounded-full bg-feature-ai-subtle flex items-center justify-center text-feature-ai">
                  <Sparkles className="h-4 w-4" />
                </div>
              )}
              <div
                className={`min-w-0 max-w-[80%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-br-md'
                    : 'bg-muted text-foreground rounded-bl-md'
                }`}
              >
                {msg.role === 'assistant' ? formatMessage(msg.content) : <AiUserMessage content={msg.content} />}
              </div>
              {msg.role === 'user' && (
                <div className="shrink-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground overflow-hidden">
                  {user?.avatarUrl ? (
                    <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  ) : null}
                  {!user?.avatarUrl && (
                    <User className="h-4 w-4" />
                  )}
                </div>
              )}
            </div>

            {/* Sentiment Analysis Tool — oversight/admin only */}
            {msg.role === 'assistant' && sentimentToolEnabled && (
              <div className="ml-11">
                {(() => {
                  const state = getSentimentState(i)
                  const isExpanded = expandedSentimentIdx === i

                  if (state.submitted) {
                    return (
                      <div className="flex items-center gap-1.5 text-xs text-success py-1">
                        <CheckCircle className="h-3.5 w-3.5" />
                        Feedback submitted
                      </div>
                    )
                  }

                  return (
                    <div className="mt-1">
                      <Disclosure
                        size="compact"
                        icon={<MessageSquare />}
                        title="Sentiment Feedback"
                        expanded={isExpanded}
                        onToggle={() => setExpandedSentimentIdx(isExpanded ? null : i)}
                        panelId={`ai-chat-sentiment-${i}`}
                      />

                      {isExpanded && (
                        <div id={`ai-chat-sentiment-${i}`} className="mt-2 p-4 rounded-lg border border-warning-muted bg-warning-subtle">
                          <div className="flex flex-col sm:flex-row gap-4">
                            {/* Sentiment Grid */}
                            <div className="shrink-0">
                              <SentimentGrid
                                valence={state.valence}
                                trust={state.trust}
                                onChange={(v, t) => updateSentiment(i, { valence: v, trust: t })}
                                size={200}
                              />
                            </div>

                            {/* Feedback text */}
                            <div className="flex-1 flex flex-col gap-2">
                              <label className="text-xs font-medium text-muted-foreground">
                                Additional Feedback (optional)
                              </label>
                              <textarea
                                value={state.feedbackText}
                                onChange={(e) => updateSentiment(i, { feedbackText: e.target.value })}
                                placeholder="Describe what was good, bad, or could be improved..."
                                rows={4}
                                className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
                                maxLength={2000}
                              />

                              {/* Privacy notice */}
                              <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
                                <Info className="h-3 w-3 shrink-0 mt-0.5" />
                                <span>
                                  By submitting, your name, the prompt you sent, the AI answer, 
                                  sentiment values, and feedback text will be stored and visible to platform admins.
                                </span>
                              </div>

                              <Button
                                emphasis="outline"
                                intent="primary"
                                className="self-end"
                                onClick={() => submitSentimentFeedback(i)}
                                loading={state.submitting}
                                icon={<CheckCircle className="h-4 w-4" />}
                              >
                                Submit Feedback
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
            )}
            </>
            )}
          </div>
        ))}

        {/* Typing indicator */}
        {sending && (
          <div className="flex gap-3 justify-start">
            <div className="shrink-0 w-8 h-8 rounded-full bg-feature-ai-subtle flex items-center justify-center text-feature-ai">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1.5">
                <div className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="flex items-start gap-2 p-3 bg-danger-subtle border border-danger-muted rounded-lg text-sm text-danger">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <form onSubmit={handleSend} className="border-t border-border pt-4 relative">
        <LearnerHelpIcon
          description={<><p className="font-semibold text-info mb-1">Chat Input</p><p className="mb-1.5">Type your message below and press <strong>Enter</strong> to send. Use <strong>Shift + Enter</strong> for line breaks.</p><p className="font-semibold text-info mb-1">What you can ask about</p><ul className="list-disc list-inside space-y-0.5"><li>App features and how to use them.</li><li>Coordination best practices for groups.</li><li>Help drafting announcements or feedback.</li><li>Any general question - the AI adapts to context.</li></ul><p className="font-semibold text-info mt-2 mb-1">AI Roles</p><p className="mb-1">This page uses the <strong>Guider</strong> role. Other pages activate different roles:</p><ul className="list-disc list-inside space-y-0.5"><li><strong>Guider</strong> - General guide for platform features and coordination philosophy.</li><li><strong>Composer</strong> - Drafts and refines messages (Distribute Messages page).</li><li><strong>Operator</strong> - Configures calendars via natural language (Calendar page).</li></ul></>}
          size={4}
          className="absolute top-0 right-0 z-10"
        />

        {/* Pending image preview (vision-capable models only) */}
        {pendingImage && (
          <div className="mb-2 flex items-center gap-2">
            <div className="relative group">
              <img
                src={`data:${pendingImage.mimeType};base64,${pendingImage.base64}`}
                alt="Image to send"
                className="h-16 w-16 object-cover rounded-md border border-border"
              />
              <IconButton
                label="Remove image"
                icon={<XIcon />}
                emphasis="solid"
                size="micro"
                onClick={() => setPendingImage(null)}
                className="absolute -top-1 -right-1"
              />
            </div>
            <span className="text-xs text-muted-foreground">Image will be sent with your message</span>
          </div>
        )}

        {/* Hidden image file input */}
        {status?.supportsVision && (
          <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) handleImageFile(file)
            }}
          />
        )}

        {remaining !== null && limit !== null && (
          <p className="text-xs text-muted-foreground mb-2">AI prompts left today: {remaining} of {limit}</p>
        )}
        <div className="flex gap-2 items-end">
          {/* Image attach button — only shown when model supports vision */}
          {status?.supportsVision && (
            <IconButton
              label="Attach image (or paste from clipboard)"
              icon={<Paperclip />}
              emphasis="outline"
              size="standard"
              disabled={sending || !status.available}
              onClick={() => imageInputRef.current?.click()}
            />
          )}
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handleInputPaste}
            placeholder={status?.available ? 'Type a message... (Enter to send, Shift+Enter for new line)' : 'AI service not configured'}
            disabled={!status?.available || sending}
            rows={1}
            aria-label="Message to AI"
            aria-describedby="ai-chat-message-length"
            aria-invalid={input.length > AI_MESSAGE_MAX_LENGTH || undefined}
            className="min-w-0 flex-1 max-h-[200px] overflow-y-auto resize-none rounded-xl border border-border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <IconButton
            type="submit"
            label="Send message"
            icon={<Send />}
            emphasis="solid"
            intent="primary"
            size="standard"
            disabled={!input.trim() || !status?.available || remaining === 0}
            loading={sending}
          />
        </div>
        <p id="ai-chat-message-length" className={input.length > AI_MESSAGE_MAX_LENGTH ? 'text-xs text-danger mt-2' : 'text-xs text-muted-foreground mt-2'}>
          {input.length} / {AI_MESSAGE_MAX_LENGTH} characters
        </p>
        <p className="text-xs text-muted-foreground mt-2 text-center">AI responses may be inaccurate.</p>
      </form>
    </div>
  )
}
