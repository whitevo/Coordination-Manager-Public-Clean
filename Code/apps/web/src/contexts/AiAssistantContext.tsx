import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react'
import type { AiEvaluation, AiRetryRequest } from '../lib/ai-evaluation'

// ── Types ───────────────────────────────────────────────────────────────────────

export interface AiPageContext {
  /** Display name shown in panel header subtitle */
  pageName: string
  /** Suggested prompts shown when chat is empty */
  suggestions: string[]
  /** Input placeholder text */
  placeholder: string
  /**
   * Custom submit handler. If provided, the panel calls this instead of the
   * default /api/ai-chat endpoint. Should return the assistant's response text
   * and an optional action label for display.
   *
   * Return `evaluation` + `retryToken` to opt into the evaluate -> retry loop: when
   * evaluation.ok is false the panel calls onSubmit once more with `retry` set.
   */
  onSubmit: (
    message: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
    retry?: AiRetryRequest,
  ) => Promise<{
    message: string
    action?: string
    systemPrompt?: string
    remaining?: number
    limit?: number
    cta?: { label: string; to: string }
    ctas?: Array<{ label: string; to: string; retryPrompt?: string }>
    quotaConsumed?: boolean
    evaluation?: AiEvaluation
    retryToken?: string
  }>
  /** Optional page-level save hook before assistant CTAs navigate away. */
  beforeNavigate?: () => Promise<boolean> | boolean
}

interface AiAssistantContextValue {
  pageContext: AiPageContext | null
  setPageContext: (ctx: AiPageContext | null) => void
  /** When set, the AI assistant renders into this element instead of its default right position. */
  assistantHost: HTMLElement | null
  setAssistantHost: (element: HTMLElement | null) => void
}

// ── Context ─────────────────────────────────────────────────────────────────────

const AiAssistantContext = createContext<AiAssistantContextValue>({
  pageContext: null,
  setPageContext: () => {},
  assistantHost: null,
  setAssistantHost: () => {},
})

// ── Provider ────────────────────────────────────────────────────────────────────

export function AiAssistantProvider({ children }: { children: ReactNode }) {
  const [pageContext, setPageContextRaw] = useState<AiPageContext | null>(null)
  const [assistantHost, setAssistantHostRaw] = useState<HTMLElement | null>(null)

  const setPageContext = useCallback((ctx: AiPageContext | null) => {
    setPageContextRaw(ctx)
  }, [])

  const setAssistantHost = useCallback((element: HTMLElement | null) => {
    setAssistantHostRaw(element)
  }, [])

  const value = useMemo(
    () => ({ pageContext, setPageContext, assistantHost, setAssistantHost }),
    [pageContext, setPageContext, assistantHost, setAssistantHost],
  )

  return (
    <AiAssistantContext.Provider value={value}>
      {children}
    </AiAssistantContext.Provider>
  )
}

// ── Hook ────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line react-refresh/only-export-components -- hook intentionally co-located with its provider
export function useAiAssistant() {
  return useContext(AiAssistantContext)
}
