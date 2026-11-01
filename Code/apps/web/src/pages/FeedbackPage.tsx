import { useState, useEffect, useCallback, useRef, useId } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useSearchParams } from 'react-router-dom'
import { apiClient } from '../lib/api-client'
import { getPrimaryTimezone, formatDateTimeInTimezone } from '../lib/timezone-data'
import { rollbackResourcePatch } from '../lib/resource-reconciliation'
import { useResourceReconciliation } from '../hooks/use-resource-reconciliation'
import { useListPresence } from '../hooks/use-list-presence'
import {
  planFeedbackStatusMove,
  feedbackPageKey,
  FEEDBACK_STATUS_HOLD_MS,
  FEEDBACK_MOVE_MS,
  FEEDBACK_EXIT_MS,
  FEEDBACK_ENTER_MS,
  FEEDBACK_FLASH_MS,
  FEEDBACK_PAGE_CACHE_TTL_MS,
} from './feedback-list-motion'
import LearnerHelpIcon from '../components/LearnerHelpIcon'
import { MessageSquare, Send, CheckCircle, AlertTriangle, Shield, ChevronDown, ChevronUp, Filter, Reply, Circle, CheckCircle2, XCircle, Eye, UserCheck, Globe, GripVertical, BarChart3, LifeBuoy, Paperclip, ImageIcon, X as XIcon, Trash2, ZoomIn } from 'lucide-react'
import AiFeedbackPage from './AiFeedbackPage'
import { Button, Disclosure, IconButton, Lightbox, SegmentedControl } from '../components/ui'
import AnimatedTabBar from '../components/AnimatedTabBar'

interface FeedbackResponseItem {
  id: string
  admin_id: string
  message: string
  created_at: string
  admin_display_name: string | null
  admin_avatar_url: string | null
}

interface FeedbackItem {
  id: string
  user_id: string | null
  discord_user_id: string | null
  discord_username: string | null
  user_display_name: string | null
  user_email: string | null
  user_avatar_url: string | null
  message: string
  source: string
  status: string
  created_at: string
  attachments?: string[]
  feedback_responses: FeedbackResponseItem[]
}

interface FeedbackPageData {
  feedback?: FeedbackItem[]
  total?: number
  statusCounts?: { open: number; reviewed: number }
  savedStatusOrder?: string[]
  isAdmin?: boolean
}

interface CachedFeedbackPage {
  data: FeedbackPageData
  fetchedAt: number
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export default function FeedbackPage() {
  const { user } = useAuth()
  const isAdminFromAuth = user?.roles?.includes('admin')
  const canViewAiFeedback = user?.roles?.includes('admin') || user?.roles?.includes('oversight') || user?.themePreferences?.aiSettings?.sentimentToolEnabled === true
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTab = searchParams.get('tab') === 'support' ? 'support' : searchParams.get('tab') === 'ai' ? 'ai' : 'general'
  const [feedbackTab, setFeedbackTab] = useState<'general' | 'ai' | 'support'>(initialTab)

  // ── Support form fields ──
  const [supportSubject, setSupportSubject] = useState('')
  const [supportType, setSupportType] = useState<'bug' | 'access' | 'integration' | 'other'>('bug')
  const [supportDescription, setSupportDescription] = useState('')
  const [supportSteps, setSupportSteps] = useState('')
  const [supportSubmitting, setSupportSubmitting] = useState(false)
  const [supportSuccess, setSupportSuccess] = useState(false)
  const [supportError, setSupportError] = useState('')

  // ── Submit form ──
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitSuccess, setSubmitSuccess] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [attachments, setAttachments] = useState<string[]>([])
  const attachFileRef = useRef<HTMLInputElement>(null)

  // ── Support form attachments ──
  const [supportAttachments, setSupportAttachments] = useState<string[]>([])
  const supportAttachFileRef = useRef<HTMLInputElement>(null)

  // ── Image lightbox ──
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)

  // ── Feedback list ──
  const [feedbackList, setFeedbackList] = useState<FeedbackItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [total, setTotal] = useState(0)
  const [statusCounts, setStatusCounts] = useState<{ open: number; reviewed: number }>({ open: 0, reviewed: 0 })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(5)

  // ── Admin panel ──
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [adminResponse, setAdminResponse] = useState('')
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const DEFAULT_STATUS_ORDER = ['open', 'reviewed', 'affirmed', 'resolved', 'dismissed']
  const [statusOrder, setStatusOrder] = useState<string[]>(DEFAULT_STATUS_ORDER)
  const statusOrderInitialisedRef = useRef(false)
  const [draggedStatus, setDraggedStatus] = useState<string | null>(null)
  // Use API-returned isAdmin (authoritative from DB) with auth context as fallback
  const [isAdminFromApi, setIsAdminFromApi] = useState<boolean | null>(null)
  const isAdmin = isAdminFromApi ?? isAdminFromAuth

  // Admin: All Feedback section is collapsed by default (contains private info)
  const [allFeedbackExpanded, setAllFeedbackExpanded] = useState(false)
  const feedbackListPanelId = `${useId()}-feedback-list`

  // -- Reconciliation, page cache, and status-move motion --
  const guard = useResourceReconciliation('feedback')
  const pageCacheRef = useRef(new Map<string, CachedFeedbackPage>())
  const latestRequestRef = useRef(0)
  const feedbackListRef = useRef<FeedbackItem[]>(feedbackList)
  feedbackListRef.current = feedbackList
  const [flashingIds, setFlashingIds] = useState<Set<string>>(() => new Set())
  const [enteringIds, setEnteringIds] = useState<Set<string>>(() => new Set())
  const [activeMotions, setActiveMotions] = useState(0)
  const activeMotionsRef = useRef(0)
  const motionTimersRef = useRef(new Set<ReturnType<typeof setTimeout>>())
  const [statusError, setStatusError] = useState('')
  // Ghost exits only while a status move is animating; page changes swap instantly
  const presence = useListPresence(feedbackList, activeMotions > 0, FEEDBACK_EXIT_MS, FEEDBACK_MOVE_MS)

  useEffect(() => {
    const timers = motionTimersRef.current
    return () => {
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
    }
  }, [])

  const wait = useCallback((ms: number) => new Promise<void>(resolve => {
    const timer = setTimeout(() => {
      motionTimersRef.current.delete(timer)
      resolve()
    }, ms)
    motionTimersRef.current.add(timer)
  }), [])

  const markTransient = useCallback((setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string, ms: number) => {
    setter(prev => new Set(prev).add(id))
    void wait(ms).then(() => setter(prev => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    }))
  }, [wait])

  const queryKeyFor = useCallback((targetPage: number) => feedbackPageKey({
    tab: feedbackTab, statusFilter, statusOrder, pageSize, page: targetPage,
  }), [feedbackTab, statusFilter, statusOrder, pageSize])
  const currentQueryKey = queryKeyFor(page)
  const currentQueryKeyRef = useRef(currentQueryKey)
  currentQueryKeyRef.current = currentQueryKey

  const loadPage = useCallback(async (targetPage: number): Promise<FeedbackPageData> => {
    const params: Record<string, string> = { page: String(targetPage), limit: String(pageSize), statusOrder: JSON.stringify(statusOrder) }
    if (statusFilter !== 'all') params.status = statusFilter
    // Filter by category based on active tab
    params.category = feedbackTab === 'support' ? 'support' : '!support'
    const response = await apiClient.get('/api/feedback', { params })
    return (response?.data ?? {}) as FeedbackPageData
  }, [pageSize, statusOrder, statusFilter, feedbackTab])

  const getFreshCachedPage = useCallback((key: string): CachedFeedbackPage | undefined => {
    const cached = pageCacheRef.current.get(key)
    if (!cached) return undefined
    if (Date.now() - cached.fetchedAt > FEEDBACK_PAGE_CACHE_TTL_MS) {
      pageCacheRef.current.delete(key)
      return undefined
    }
    return cached
  }, [])

  /** Warm the cache for the page after `fromPage` so Next renders without a DB round-trip. */
  const prefetchNextPage = useCallback((fromPage: number, totalCount: number) => {
    if (fromPage * pageSize >= totalCount) return
    const nextPage = fromPage + 1
    const key = queryKeyFor(nextPage)
    if (getFreshCachedPage(key)) return
    guard.read(key, () => loadPage(nextPage))
      .then(({ data }) => { pageCacheRef.current.set(key, { data, fetchedAt: Date.now() }) })
      .catch(() => { /* prefetch is best-effort */ })
  }, [pageSize, queryKeyFor, getFreshCachedPage, guard, loadPage])

  const applyPageMeta = useCallback((data: FeedbackPageData) => {
    setTotal(data.total || 0)
    if (data.statusCounts) setStatusCounts(data.statusCounts)
    // Restore once; a changed order must reload the server-paginated list.
    if (!statusOrderInitialisedRef.current) {
      statusOrderInitialisedRef.current = true
      if (data.savedStatusOrder) {
        const savedOrder = data.savedStatusOrder
        setStatusOrder(current => (
          current.length === savedOrder.length && current.every((status, index) => status === savedOrder[index])
            ? current
            : savedOrder
        ))
      }
    }
    // The API tells us authoritatively whether we're admin
    if (typeof data.isAdmin === 'boolean') {
      setIsAdminFromApi(data.isAdmin)
    }
  }, [])

  /**
   * Load the current page. `silent` keeps the rendered list (no loading state)
   * and merges the server result through the reconciliation guard.
   */
  const fetchFeedback = useCallback(async (options: { silent?: boolean } = {}) => {
    const silent = options.silent === true
    const key = queryKeyFor(page)
    const requestId = ++latestRequestRef.current

    if (!silent) {
      const cached = getFreshCachedPage(key)
      if (cached) {
        setLoadError('')
        setFeedbackList(cached.data.feedback || [])
        applyPageMeta(cached.data)
        setLoading(false)
        return
      }
      setLoading(true)
      setLoadError('')
    }

    try {
      const { observation, data } = await guard.read<FeedbackPageData>(key, () => loadPage(page), !silent)
      if (requestId !== latestRequestRef.current) return
      pageCacheRef.current.set(key, { data, fetchedAt: Date.now() })
      const incoming = data.feedback || []
      if (silent) {
        setFeedbackList(current => guard.reconcile(current, incoming, observation, 'complete'))
      } else {
        setFeedbackList(incoming)
      }
      applyPageMeta(data)
    } catch (err) {
      if (requestId !== latestRequestRef.current || silent) return
      setLoadError((err as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to load feedback')
    } finally {
      if (!silent && requestId === latestRequestRef.current) setLoading(false)
    }
  }, [page, queryKeyFor, getFreshCachedPage, guard, loadPage, applyPageMeta])

  /** Drop cached pages after any write so a later Next never shows stale rows. */
  const invalidatePageCache = useCallback(() => {
    pageCacheRef.current.clear()
  }, [])

  // Sync tab state when URL search params change (e.g. navigating from /support link)
  useEffect(() => {
    const tabParam = searchParams.get('tab')
    const newTab = tabParam === 'support' ? 'support' : tabParam === 'ai' ? 'ai' : 'general'
    setFeedbackTab(newTab)
  }, [searchParams])

  useEffect(() => {
    fetchFeedback()
  }, [fetchFeedback])

  // Once the current page is settled, warm the next page in the background
  useEffect(() => {
    if (loading || loadError || activeMotions > 0) return
    prefetchNextPage(page, total)
  }, [loading, loadError, activeMotions, page, total, prefetchNextPage])

  // Reset page when switching tabs
  useEffect(() => {
    setPage(1)
    setAllFeedbackExpanded(false)
  }, [feedbackTab])

  /** Read image files into base64 data URLs and append to an existing array (capped at 3). */
  const readImageFiles = (files: FileList | File[], existing: string[]): Promise<string[]> => {
    const remaining = 3 - existing.length
    const toRead = Array.from(files).slice(0, remaining)
    return Promise.all(toRead.map(file => new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = e => resolve(e.target?.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })))
  }

  const handleAttachFiles = async (files: FileList | null, setter: React.Dispatch<React.SetStateAction<string[]>>, current: string[]) => {
    if (!files || files.length === 0) return
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'))
    if (imageFiles.length === 0) return
    const newImages = await readImageFiles(imageFiles, current)
    setter(prev => [...prev, ...newImages].slice(0, 3))
  }

  const handlePasteImage = async (
    e: React.ClipboardEvent,
    current: string[],
    setter: React.Dispatch<React.SetStateAction<string[]>>,
  ) => {
    const items = Array.from(e.clipboardData.items)
    const imageItems = items.filter(i => i.kind === 'file' && i.type.startsWith('image/'))
    if (imageItems.length === 0) return
    const files = imageItems.map(i => i.getAsFile()).filter(Boolean) as File[]
    const newImages = await readImageFiles(files, current)
    setter(prev => [...prev, ...newImages].slice(0, 3))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!message.trim()) return

    setSubmitting(true)
    setSubmitError('')
    setSubmitSuccess(false)

    try {
      const resp = await apiClient.post('/api/feedback', {
        message: message.trim(),
        category: 'general',
        attachments,
      })
      if (!resp.data?.feedback?.id) {
        // Server returned 2xx but no feedback object — treat as failure
        throw new Error('Unexpected response — feedback may not have been saved')
      }
      setMessage('')
      setAttachments([])
      setSubmitSuccess(true)
      setTimeout(() => setSubmitSuccess(false), 5000)
      // Refresh the list so the new item appears immediately
      invalidatePageCache()
      if (page === 1) await fetchFeedback({ silent: true })
      else setPage(1)
    } catch (err) {
      console.error('Feedback submit error:', err)
      setSubmitError((err as { response?: { data?: { error?: string } } }).response?.data?.error || (err as { message?: string }).message || 'Failed to submit feedback')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSupportSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supportDescription.trim()) return

    setSupportSubmitting(true)
    setSupportError('')
    setSupportSuccess(false)

    const typeLabel = { bug: 'Bug Report', access: 'Access Issue', integration: 'Integration Help', other: 'Other' }[supportType]
    const fullMessage = [
      supportSubject ? `Subject: ${supportSubject}` : '',
      `Type: ${typeLabel}`,
      '',
      supportDescription.trim(),
      supportSteps.trim() ? `\nSteps to reproduce / additional context:\n${supportSteps.trim()}` : '',
    ].filter(Boolean).join('\n')

    try {
      const resp = await apiClient.post('/api/feedback', {
        message: fullMessage,
        category: 'support',
        attachments: supportAttachments,
      })
      if (!resp.data?.feedback?.id) {
        throw new Error('Unexpected response - support request may not have been saved')
      }
      setSupportSubject('')
      setSupportType('bug')
      setSupportDescription('')
      setSupportSteps('')
      setSupportAttachments([])
      setSupportSuccess(true)
      setTimeout(() => setSupportSuccess(false), 5000)
      invalidatePageCache()
      if (page === 1) await fetchFeedback({ silent: true })
      else setPage(1)
    } catch (err) {
      setSupportError((err as { response?: { data?: { error?: string } } }).response?.data?.error || (err as { message?: string }).message || 'Failed to submit support request')
    } finally {
      setSupportSubmitting(false)
    }
  }

  const handleSetStatus = async (feedbackId: string, status: string) => {
    const before = feedbackListRef.current.find(item => item.id === feedbackId)
    if (!before || before.status === status) return
    const startKey = currentQueryKeyRef.current
    const stillCurrent = () => currentQueryKeyRef.current === startKey
    const reduced = prefersReducedMotion()
    const nextPageItems = getFreshCachedPage(queryKeyFor(page + 1))?.data.feedback ?? []
    const hasMoreAfter = page * pageSize < total

    setStatusError('')
    setUpdatingId(feedbackId)
    activeMotionsRef.current += 1
    setActiveMotions(activeMotionsRef.current)
    const mutation = guard.beginMutation(feedbackId)

    // Phase 1: change the status in place so the stepper animates old -> new
    setFeedbackList(list => list.map(item => item.id === feedbackId ? { ...item, status } : item))
    if (!reduced) markTransient(setFlashingIds, feedbackId, FEEDBACK_FLASH_MS)

    let succeeded = true
    const request = apiClient.patch(`/api/feedback/${feedbackId}`, { status }).catch(() => { succeeded = false })
    await Promise.all([request, reduced ? Promise.resolve() : wait(FEEDBACK_STATUS_HOLD_MS)])

    if (!succeeded) {
      if (stillCurrent()) setFeedbackList(list => rollbackResourcePatch(list, before, { status }))
      setStatusError('Could not update the status. Please try again.')
    } else if (stillCurrent()) {
      const plan = planFeedbackStatusMove({
        list: feedbackListRef.current,
        id: feedbackId,
        status,
        statusOrder,
        statusFilter,
        hasMoreAfter,
        nextPageItems,
      })
      if (plan) {
        if (!plan.exits) {
          // Phase 2: glide to the new slot (FLIP via useListPresence)
          setFeedbackList(plan.order)
          if (!reduced) await wait(FEEDBACK_MOVE_MS)
        } else if (reduced) {
          setFeedbackList(plan.backfill ? [...plan.rest, plan.backfill] : plan.rest)
        } else {
          // Phase 2: travel down to the end of the list
          const currentIndex = feedbackListRef.current.findIndex(item => item.id === feedbackId)
          if (currentIndex !== -1 && currentIndex < feedbackListRef.current.length - 1) {
            setFeedbackList([...plan.rest, plan.updated])
            await wait(FEEDBACK_MOVE_MS)
          }
          // Phase 3: slide under the list edge and disappear
          if (stillCurrent()) {
            setFeedbackList(list => list.filter(item => item.id !== feedbackId))
            await wait(FEEDBACK_EXIT_MS)
          }
          // Phase 4: backfill from the prefetched next page
          const backfill = plan.backfill
          if (backfill && stillCurrent()) {
            setFeedbackList(list => list.some(item => item.id === backfill.id) ? list : [...list, backfill])
            markTransient(setEnteringIds, backfill.id, FEEDBACK_ENTER_MS)
          }
        }
      }
    }

    guard.endMutation(mutation)
    setUpdatingId(current => current === feedbackId ? null : current)
    invalidatePageCache()
    activeMotionsRef.current -= 1
    setActiveMotions(activeMotionsRef.current)
    // Reconcile with the server once no other card is mid-animation
    if (activeMotionsRef.current === 0 && stillCurrent()) {
      await fetchFeedback({ silent: true })
    }
  }

  const handleStatusOrderChange = async (newOrder: string[]) => {
    setStatusOrder(newOrder)
    setPage(1)
    // Persist the preference to the user's account
    try {
      await apiClient.put('/api/auth/profile', { feedbackStatusOrder: newOrder })
    } catch {
      // Non-critical — the order still applies for the current session
    }
  }

  // ── Drag-and-drop handlers for status order ──
  const handleDragStart = (status: string) => {
    setDraggedStatus(status)
  }

  const handleDragOver = (e: React.DragEvent, targetStatus: string) => {
    e.preventDefault()
    if (!draggedStatus || draggedStatus === targetStatus) return
    const newOrder = [...statusOrder]
    const fromIdx = newOrder.indexOf(draggedStatus)
    const toIdx = newOrder.indexOf(targetStatus)
    if (fromIdx === -1 || toIdx === -1) return
    newOrder.splice(fromIdx, 1)
    newOrder.splice(toIdx, 0, draggedStatus)
    setStatusOrder(newOrder)
  }

  const handleDragEnd = () => {
    if (draggedStatus) {
      handleStatusOrderChange(statusOrder)
    }
    setDraggedStatus(null)
  }

  const STATUS_LABELS: Record<string, string> = {
    open: 'Received',
    reviewed: 'Acknowledged',
    affirmed: 'Affirmed',
    resolved: 'Resolved',
    dismissed: 'Dismissed',
  }

  const STATUS_COLORS: Record<string, string> = {
    open: 'bg-warning-subtle text-warning border-warning-muted',
    reviewed: 'bg-info-subtle text-info border-info-muted',
    affirmed: 'bg-primary-subtle text-primary border-primary-muted',
    resolved: 'bg-success-subtle text-success border-success-muted',
    dismissed: 'bg-muted text-muted-foreground border-border',
  }

  const STATUS_TEXT_COLORS: Record<string, string> = {
    open: 'text-warning',
    reviewed: 'text-info',
    affirmed: 'text-primary',
    resolved: 'text-success',
    dismissed: 'text-muted-foreground',
  }

  const handleRespond = async (feedbackId: string) => {
    if (!adminResponse.trim()) return
    setUpdatingId(feedbackId)
    try {
      await apiClient.post(`/api/feedback/${feedbackId}/responses`, {
        message: adminResponse.trim(),
      })
      setAdminResponse('')
      setExpandedId(null)
      invalidatePageCache()
      void fetchFeedback({ silent: true })
    } catch { /* ignore */ } finally {
      setUpdatingId(null)
    }
  }

  const handleDeleteFeedback = async (id: string) => {
    setUpdatingId(id)
    try {
      await apiClient.delete(`/api/feedback/${id}`)
      invalidatePageCache()
      setFeedbackList(prev => prev.filter(f => f.id !== id))
      setTotal(prev => Math.max(0, prev - 1))
      setConfirmDeleteId(null)
      if (expandedId === id) setExpandedId(null)
    } catch { /* ignore */ } finally {
      setUpdatingId(null)
    }
  }

  // ── Status progression helpers ────────────────────────────────────
  type StatusStep = { key: string; label: string }
  const STATUS_STEPS: StatusStep[] = [
    { key: 'open', label: 'Received' },
    { key: 'reviewed', label: 'Acknowledged' },
    { key: 'affirmed', label: 'Affirmed' },
    { key: 'resolved', label: 'Resolved' },
  ]

  /** Which steps are "completed" given the current status */
  const getCompletedSteps = (status: string): Set<string> => {
    const completed = new Set<string>()
    completed.add('open') // always received
    if (status === 'reviewed' || status === 'affirmed' || status === 'resolved') {
      completed.add('reviewed')
    }
    if (status === 'affirmed') completed.add('affirmed')
    if (status === 'resolved') {
      completed.add('affirmed')
      completed.add('resolved')
    }
    return completed
  }

  /** The currently active step (the one that was most recently set) */
  const getActiveStep = (status: string): string => {
    if (status === 'dismissed') return 'dismissed'
    return status
  }

  /** Render the visual progress stepper */
  const renderProgressStepper = (item: FeedbackItem) => {
    const completed = getCompletedSteps(item.status)
    const activeStep = getActiveStep(item.status)
    const isDismissed = item.status === 'dismissed'
    const isUpdating = updatingId === item.id

    if (isDismissed) {
      return (
        <div className="py-2 space-y-1.5">
          <div className={`flex items-center gap-1.5 text-muted-foreground ${flashingIds.has(item.id) ? 'feedback-step-pop' : ''}`}>
            <XCircle className="w-4 h-4" />
            <span className="text-xs font-medium">Dismissed</span>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-xs text-muted-foreground">Move to:</span>
              {STATUS_STEPS.map(step => (
                <Button
                  key={step.key}
                  emphasis="outline"
                  size="micro"
                  onClick={() => handleSetStatus(item.id, step.key)}
                  disabled={isUpdating}
                >
                  {step.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      )
    }

    return (
      <div className="flex items-center gap-0 py-2 overflow-x-auto">
        {STATUS_STEPS.map((step, idx) => {
          const isCompleted = completed.has(step.key)
          const isActive = activeStep === step.key
          const canClick = isAdmin && !isUpdating

          // Clicking any step sets the status directly to that step
          const handleClick = () => {
            if (!canClick) return
            handleSetStatus(item.id, step.key)
          }

          // Colors -- only the ACTIVE step shows its status colour.
          // Completed (but not active) steps stay neutral so users see a single
          // current status at a glance.
          let iconColor = 'text-muted-foreground/60'
          let textColor = 'text-muted-foreground'
          let lineColor = 'bg-muted'

          if (isCompleted) {
            // Faint indicator that the step has been reached, but no status colour.
            iconColor = 'text-muted-foreground'
            textColor = 'text-muted-foreground'
            lineColor = 'bg-border'
          }

          if (isActive) {
            iconColor = step.key === 'affirmed'
              ? 'text-primary'
              : step.key === 'resolved'
                ? 'text-success'
                : step.key === 'open'
                  ? 'text-warning'
                  : 'text-primary'
            textColor = step.key === 'affirmed'
              ? 'text-info font-medium'
              : step.key === 'resolved'
                ? 'text-success font-medium'
                : step.key === 'open'
                  ? 'text-warning font-medium'
                  : 'text-foreground font-medium'
          }

          return (
            <div key={step.key} className="flex items-center">
              {/* Connector line (before item, except first) */}
              {idx > 0 && (
                <div className={`w-4 sm:w-6 h-0.5 ${isCompleted ? lineColor : 'bg-muted'} shrink-0`} />
              )}

              {/* Step */}
              <button
                type="button"
                disabled={!canClick}
                onClick={handleClick}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md transition-all shrink-0 ${
                  canClick
                    ? 'hover:bg-accent/60 cursor-pointer'
                    : 'cursor-default'
                } ${isActive ? 'bg-accent/40 ring-1 ring-primary/20' : ''} ${isActive && flashingIds.has(item.id) ? 'feedback-step-pop' : ''}`}
                title={isAdmin ? `Set status to ${step.label}` : step.label}
              >
                {isCompleted ? (
                  <CheckCircle2 className={`w-4 h-4 ${iconColor} shrink-0`} />
                ) : (
                  <Circle className={`w-4 h-4 ${iconColor} shrink-0`} />
                )}
                <span className={`text-xs whitespace-nowrap ${textColor}`}>
                  {step.label}
                </span>
              </button>
            </div>
          )
        })}

        {/* Dismiss option for admin (far right) */}
        {isAdmin && (
          <div className="flex items-center ml-auto pl-2 shrink-0">
            <Button
              emphasis="ghost"
              size="micro"
              onClick={() => handleSetStatus(item.id, 'dismissed')}
              disabled={isUpdating}
              title="Dismiss this feedback"
              icon={<XCircle className="w-3.5 h-3.5" />}
            >
              <span className="hidden sm:inline">Dismiss</span>
            </Button>
          </div>
        )}
      </div>
    )
  }

  const getSubmitterLabel = (item: FeedbackItem): string => {
    if (item.user_display_name) return item.user_display_name
    if (item.user_email) return item.user_email
    if (item.discord_username) return `@${item.discord_username}`
    return 'Unknown'
  }

  const totalPages = Math.ceil(total / pageSize)

  return (
    <>
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MessageSquare className="w-6 h-6" />
          Feedback
          {isAdmin ? (
            <span className="inline-flex items-center gap-1 text-xs bg-primary-subtle text-primary px-2 py-0.5 rounded-full font-medium">
              <Shield className="w-3 h-3" />
              Admin
            </span>
          ) : user?.accountType === 'traveler' ? (
            <span className="inline-flex items-center gap-1 text-xs bg-warning-subtle text-warning px-2 py-0.5 rounded-full font-medium">
              <Globe className="w-3 h-3" />
              Traveler
            </span>
          ) : user ? (
            <span className="inline-flex items-center gap-1 text-xs bg-success-subtle text-success px-2 py-0.5 rounded-full font-medium">
              <UserCheck className="w-3 h-3" />
              Verified
            </span>
          ) : null}
        </h1>
        <p className="text-muted-foreground mt-1">
          Share your thoughts, report bugs, or suggest features.
          {isAdmin && (
            <span className="inline-flex items-center gap-1 ml-2 text-xs bg-primary-subtle text-primary px-2 py-0.5 rounded-full">
              <Shield className="w-3 h-3" />
              Viewing all feedback
            </span>
          )}
          {feedbackTab === 'ai' && canViewAiFeedback && (
            <LearnerHelpIcon
              description={<><p className="font-semibold text-info mb-1">Sentiment Feedback Entry</p><p className="mb-1.5">Each card represents feedback that was submitted on an AI chat response. It captures how the user felt about the AI's answer.</p><p className="font-semibold text-info mb-1">What's inside</p><ul className="list-disc list-inside space-y-0.5"><li><strong>Sentiment grid</strong> -- a 2D rating of valence (positive/negative) and trust.</li><li><strong>Written comments</strong> -- optional text elaborating on the rating.</li><li><strong>Conversation context</strong> -- the original AI exchange that was rated.</li></ul></>}
              size={4}
              className="ml-1 align-middle"
            />
          )}
        </p>
      </div>

      {/* Tab Switcher */}
      <AnimatedTabBar<'general' | 'support' | 'ai'>
        tabs={[
          { id: 'general', label: 'Feedback', icon: MessageSquare },
          { id: 'support', label: 'Support Request', icon: LifeBuoy },
          ...(canViewAiFeedback ? [{ id: 'ai' as const, label: 'AI Feedback', icon: BarChart3 }] : []),
        ]}
        activeId={feedbackTab}
        onSelect={tabId => setSearchParams(tabId === 'general' ? {} : { tab: tabId }, { replace: true })}
        ariaLabel="Feedback sections"
        testId="feedback-tabs"
        className="flex flex-wrap gap-1.5"
        buttonClassName="px-4 py-2 text-sm font-medium"
        iconClassName="w-4 h-4"
      />

      {/* AI Feedback Tab */}
      {feedbackTab === 'ai' && canViewAiFeedback ? (
        <AiFeedbackPage embedded statusOrder={statusOrder} />
      ) : feedbackTab === 'support' ? (
      <>
        {/* ── Support Request Form ── */}
        <form
          onSubmit={handleSupportSubmit}
          onPaste={e => handlePasteImage(e, supportAttachments, setSupportAttachments)}
          className="rounded-lg border-2 border-info-muted bg-card p-5 space-y-4 relative"
        >
          <LearnerHelpIcon
            description="Submit a support request for technical issues, access problems, or integration help. Provide as much detail as possible so we can assist you quickly."
            size={4}
            className="absolute top-3 right-3 z-10"
          />
          <div className="flex items-center gap-2 mb-1">
            <LifeBuoy className="w-5 h-5 text-info" />
            <h2 className="font-semibold">Submit a Support Request</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Describe your issue below. The more detail you provide, the faster we can help.
          </p>

          {/* Issue Type */}
          <div>
            <label className="block text-sm font-medium mb-1.5">What type of issue are you experiencing?</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: 'bug' as const, label: 'Bug / Something broken', icon: '🐛' },
                { value: 'access' as const, label: 'Access / Login issue', icon: '🔑' },
                { value: 'integration' as const, label: 'Integration help (Zoom, Calendar, etc.)', icon: '🔗' },
                { value: 'other' as const, label: 'Other', icon: '💬' },
              ]).map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSupportType(opt.value)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm text-left transition-all ${
                    supportType === opt.value
                      ? 'border-info-muted bg-info-subtle ring-1 ring-info-muted'
                      : 'border-border hover:border-info-muted hover:bg-accent/30'
                  }`}
                >
                  <span>{opt.icon}</span>
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Subject */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Subject <span className="text-muted-foreground font-normal">(brief summary)</span></label>
            <input
              type="text"
              value={supportSubject}
              onChange={e => setSupportSubject(e.target.value)}
              placeholder="e.g. Cannot connect Zoom account"
              maxLength={200}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Describe the issue <span className="text-danger">*</span></label>
            <textarea
              value={supportDescription}
              onChange={e => setSupportDescription(e.target.value)}
              placeholder="What happened? What did you expect to happen? Please include any error messages you saw."
              rows={4}
              maxLength={2000}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring resize-y"
            />
          </div>

          {/* Steps to reproduce */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Steps to reproduce <span className="text-muted-foreground font-normal">(optional)</span></label>
            <textarea
              value={supportSteps}
              onChange={e => setSupportSteps(e.target.value)}
              placeholder={"1. Go to...\n2. Click on...\n3. See error..."}
              rows={3}
              maxLength={1000}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring resize-y"
            />
          </div>

          {/* Screenshot attachments */}
          {supportAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {supportAttachments.map((src, i) => (
                <div key={i} className="relative group w-20 h-20 rounded-md overflow-hidden border border-border">
                  <img src={src} alt={`Screenshot ${i + 1}`} className="w-full h-full object-cover cursor-pointer" onClick={() => setPreviewSrc(src)} />
                  <button
                    type="button"
                    onClick={() => setPreviewSrc(src)}
                    className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Enlarge"
                  >
                    <ZoomIn className="w-5 h-5 text-white drop-shadow-sm" />
                  </button>
                  <IconButton
                    label="Remove image"
                    icon={<XIcon />}
                    emphasis="solid"
                    size="micro"
                    onClick={() => setSupportAttachments(prev => prev.filter((_, idx) => idx !== i))}
                    className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 z-10"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Hidden file input for support */}
          <input
            ref={supportAttachFileRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            className="hidden"
            onChange={e => handleAttachFiles(e.target.files, setSupportAttachments, supportAttachments)}
          />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{supportDescription.length} / 2000</span>
              <div className="flex flex-col gap-0.5">
                <Button
                  emphasis="outline"
                  size="micro"
                  onClick={() => supportAttachFileRef.current?.click()}
                  disabled={supportAttachments.length >= 3}
                  title="Attach a screenshot (or paste from clipboard)"
                  icon={<ImageIcon className="w-3.5 h-3.5" />}
                >
                  {supportAttachments.length > 0 ? `${supportAttachments.length}/3 screenshots` : 'Add screenshot'}
                </Button>
                {supportAttachments.length < 3 && (
                  <span className="text-xs text-muted-foreground/60 pl-1">or paste from clipboard (Ctrl+V)</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {supportError && (
                <span className="flex items-center gap-1 text-sm text-danger">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {supportError}
                </span>
              )}
              {supportSuccess && (
                <span className="flex items-center gap-1 text-sm text-success">
                  <CheckCircle className="w-3.5 h-3.5" />
                  Support request submitted!
                </span>
              )}
              <Button
                type="submit"
                intent="primary"
                disabled={!supportDescription.trim()}
                loading={supportSubmitting}
                icon={<Send className="w-4 h-4" />}
              >
                {supportSubmitting ? 'Sending...' : 'Submit Request'}
              </Button>
            </div>
          </div>

          <div className="flex items-start gap-2 p-3 bg-info-subtle border border-info-muted rounded-md">
            <Shield className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <p className="text-xs text-info">
              <span className="font-medium">Response time:</span> We aim to respond to support requests within 48 hours.
              For urgent issues you can also email us at{' '}
              <a href="mailto:support@coordinationmanager.com" className="underline">support@coordinationmanager.com</a>.
            </p>
          </div>
        </form>
      </>
      ) : feedbackTab === 'general' ? (
      <>

      {/* ── Submit Form ── */}
      <form
        onSubmit={handleSubmit}
        onPaste={e => handlePasteImage(e, attachments, setAttachments)}
        className="rounded-lg border border-border bg-card p-5 space-y-3 relative"
      >
        <LearnerHelpIcon
          description="Share your thoughts with the platform team. Report bugs, suggest features, or leave general comments. Your feedback helps improve the platform for everyone."
          size={4}
          className="absolute top-3 right-3 z-10"
        />
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="What's on your mind? Report a bug, suggest a feature, or share general feedback..."
          rows={3}
          maxLength={2000}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring resize-y"
        />

        {/* Image previews */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((src, i) => (
              <div key={i} className="relative group w-20 h-20 rounded-md overflow-hidden border border-border">
                <img src={src} alt={`Attachment ${i + 1}`} className="w-full h-full object-cover cursor-pointer" onClick={() => setPreviewSrc(src)} />
                <button
                  type="button"
                  onClick={() => setPreviewSrc(src)}
                  className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Enlarge"
                >
                  <ZoomIn className="w-5 h-5 text-white drop-shadow-sm" />
                </button>
                <IconButton
                  label="Remove image"
                  icon={<XIcon />}
                  emphasis="solid"
                  size="micro"
                  onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
                  className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 z-10"
                />
              </div>
            ))}
          </div>
        )}

        {/* Hidden file input */}
        <input
          ref={attachFileRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          multiple
          className="hidden"
          onChange={e => handleAttachFiles(e.target.files, setAttachments, attachments)}
        />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{message.length} / 2000</span>
            <div className="flex flex-col gap-0.5">
              <Button
                emphasis="outline"
                size="micro"
                onClick={() => attachFileRef.current?.click()}
                disabled={attachments.length >= 3}
                title="Attach image (or paste from clipboard)"
                icon={<Paperclip className="w-3.5 h-3.5" />}
              >
                {attachments.length > 0 ? `${attachments.length}/3 images` : 'Attach image'}
              </Button>
              {attachments.length < 3 && (
                <span className="text-xs text-muted-foreground/60 pl-1">or paste from clipboard (Ctrl+V)</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {submitError && (
              <span className="flex items-center gap-1 text-sm text-danger">
                <AlertTriangle className="w-3.5 h-3.5" />
                {submitError}
              </span>
            )}
            {submitSuccess && (
              <span className="flex items-center gap-1 text-sm text-success">
                <CheckCircle className="w-3.5 h-3.5" />
                Submitted!
              </span>
            )}
            <Button
              type="submit"
              intent="primary"
              disabled={!message.trim()}
              loading={submitting}
              icon={<Send className="w-4 h-4" />}
            >
              {submitting ? 'Sending...' : 'Submit'}
            </Button>
          </div>
        </div>

        {/* Privacy Notice */}
        <div className="flex items-start gap-2 p-3 bg-info-subtle border border-info-muted rounded-md">
          <Shield className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <p className="text-xs text-info">
            <span className="font-medium">Privacy:</span> Your feedback is visible only to platform administrators. 
            It will not be shared publicly or with other users.
          </p>
        </div>

        <p className="text-xs text-muted-foreground">
          You can also submit feedback via Discord using the <code className="bg-accent/20 text-foreground border border-accent/40 font-mono px-1 rounded">/feedback</code> command.
        </p>
      </form>
      </>
      ) : null}

      {/* ── Feedback / Support List (shared across general & support tabs) ── */}
      {feedbackTab !== 'ai' && (
      <div className={isAdmin ? 'rounded-lg border-2 border-danger-muted p-4' : ''}>
        {/* Section header */}
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          {isAdmin ? (
            <Disclosure
              size="section"
              className="min-w-0 flex-1"
              title={feedbackTab === 'support' ? 'All Support Requests' : 'All Feedback'}
              trailing={
                <span className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1 text-sm font-bold px-2 py-0.5 rounded-full ${
                    statusCounts.open > 0
                      ? 'bg-danger-subtle text-danger'
                      : 'bg-muted text-muted-foreground'
                  }`}>
                    {statusCounts.open} open
                  </span>
                  {statusCounts.reviewed > 0 && (
                    <span className="text-sm text-muted-foreground font-normal">
                      {statusCounts.reviewed} acknowledged
                    </span>
                  )}
                </span>
              }
              expanded={allFeedbackExpanded}
              onToggle={setAllFeedbackExpanded}
              panelId={feedbackListPanelId}
            />
          ) : (
            <h2 className="text-lg font-semibold flex items-center gap-2">
              {feedbackTab === 'support' ? 'Your Support Requests' : 'Your Submissions'}
              <span className={`inline-flex items-center text-sm font-bold px-2 py-0.5 rounded-full ${
                statusCounts.open > 0
                  ? 'bg-warning-subtle text-warning'
                  : 'bg-muted text-muted-foreground'
              }`}>
                {statusCounts.open} open
              </span>
              {statusCounts.reviewed > 0 && (
                <span className="text-sm text-muted-foreground font-normal">
                  {statusCounts.reviewed} acknowledged
                </span>
              )}
            </h2>
          )}
          {/* Status filter (admin only, visible when expanded) */}
          {isAdmin && allFeedbackExpanded && (
            <div className="flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-muted-foreground" />
              <select
                value={statusFilter}
                onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
                className="px-2 py-1 border border-input rounded text-xs bg-background text-foreground focus:ring-1 focus:ring-ring outline-hidden"
              >
                <option value="all">All statuses</option>
                <option value="open">Open</option>
                <option value="reviewed">Acknowledged</option>
                <option value="affirmed">Affirmed</option>
                <option value="resolved">Resolved</option>
                <option value="dismissed">Dismissed</option>
              </select>
            </div>
          )}
        </div>

        {/* Admin collapsed summary */}
        {isAdmin && !allFeedbackExpanded && (
          <div className="text-sm text-muted-foreground flex items-center gap-2 py-2">
            <Shield className="w-4 h-4 text-danger" />
            {statusCounts.open > 0
              ? <span>Contains private user {feedbackTab === 'support' ? 'support requests' : 'feedback'}. <span className="font-medium text-danger">{statusCounts.open} open</span> item{statusCounts.open !== 1 ? 's' : ''} to review.{statusCounts.reviewed > 0 && <span className="ml-1 text-primary">{statusCounts.reviewed} acknowledged.</span>}</span>
              : <span>Nothing new to review -- all {feedbackTab === 'support' ? 'support requests have' : 'feedback has'} been addressed.</span>
            }
          </div>
        )}

        {/* Expandable content (always visible for non-admins) */}
        {(!isAdmin || allFeedbackExpanded) && (<div id={feedbackListPanelId}>

        {/* ── Drag-to-reorder status groups ── */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Order by:</span>
          {statusOrder.map(status => (
            <div
              key={status}
              draggable
              onDragStart={() => handleDragStart(status)}
              onDragOver={e => handleDragOver(e, status)}
              onDragEnd={handleDragEnd}
              className={`flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-medium cursor-grab active:cursor-grabbing select-none transition-all ${
                STATUS_COLORS[status] || 'bg-accent text-foreground border-border'
              } ${draggedStatus === status ? 'opacity-50 scale-95' : 'hover:shadow-xs'}`}
            >
              <GripVertical className="w-3 h-3 opacity-40" />
              {STATUS_LABELS[status] || status}
            </div>
          ))}
        </div>

        {/* ── Top pagination controls ── */}
        {!loading && !loadError && (total > 0 || feedbackList.length > 0) && (
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>Show:</span>
              <SegmentedControl
                label="Items per page"
                size="micro"
                value={String(pageSize)}
                onChange={size => { setPageSize(Number(size)); setPage(1) }}
                options={[5, 10, 25, 50].map(size => ({ value: String(size), label: String(size) }))}
              />
              <span>per page</span>
              <span className="ml-2 text-muted-foreground/60">{total} total</span>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  emphasis="outline"
                  size="compact"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  {page} / {totalPages}
                </span>
                <Button
                  emphasis="outline"
                  size="compact"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        )}

        {statusError && (
          <div role="alert" className="mb-3 text-xs text-danger flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            {statusError}
          </div>
        )}

        {loading ? (
          <div className="text-center py-8 text-muted-foreground text-sm">Loading feedback...</div>
        ) : loadError ? (
          <div className="text-center py-8 text-sm text-danger flex items-center justify-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            {loadError}
          </div>
        ) : feedbackList.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            {feedbackTab === 'support' ? 'No support requests yet.' : 'No feedback yet. Be the first to share your thoughts!'}
          </div>
        ) : (
          <div ref={presence.containerRef} className="space-y-3 overflow-y-clip pb-1">
            {presence.items.map(item => {
              const isExpanded = expandedId === item.id
              const hasResponses = item.feedback_responses?.length > 0
              const responseCount = item.feedback_responses?.length || 0
              const isExiting = presence.exitingIds.has(item.id)
              const motionClass = isExiting
                ? 'feedback-card-exit'
                : enteringIds.has(item.id)
                  ? 'feedback-card-enter'
                  : flashingIds.has(item.id)
                    ? 'feedback-status-flash'
                    : ''

              return (
                <div
                  key={item.id}
                  data-presence-key={item.id}
                  data-testid={`feedback-card-${item.id}`}
                  aria-hidden={isExiting || undefined}
                  className={`rounded-lg border transition-colors duration-300 ${motionClass} ${
                    item.status === 'dismissed'
                      ? 'border-border/50 bg-card/50 opacity-70'
                      : item.status === 'affirmed'
                        ? 'border-info-muted/60 bg-card'
                        : item.status === 'resolved'
                          ? 'border-success-muted/60 bg-card'
                          : 'border-border bg-card'
                  }`}
                >
                  {/* ── Card body ── */}
                  <div className="p-4 pb-2">
                    {/* Header: who + when + source */}
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {item.user_avatar_url ? (
                          <img src={item.user_avatar_url} alt="" className="w-5 h-5 rounded-full" />
                        ) : (
                          <div className="w-5 h-5 rounded-full bg-accent flex items-center justify-center text-[10px] font-medium">
                            {getSubmitterLabel(item).charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span className="font-medium text-foreground">{getSubmitterLabel(item)}</span>
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                          item.source === 'bot'
                            ? 'bg-accent text-accent-foreground'
                            : 'bg-muted text-muted-foreground'
                        }`}>
                          {item.source === 'bot' ? 'Discord' : 'Web'}
                        </span>
                        {item.attachments && item.attachments.length > 0 && (
                          <span className="flex items-center gap-0.5 text-muted-foreground" title={`${item.attachments.length} image${item.attachments.length !== 1 ? 's' : ''} attached`}>
                            <Paperclip className="w-3 h-3" />
                            <span className="text-[10px]">{item.attachments.length}</span>
                          </span>
                        )}
                      </div>
                      <time className="shrink-0">{formatDateTimeInTimezone(item.created_at, getPrimaryTimezone())}</time>
                    </div>

                    {/* Message */}
                    <p className={`text-sm whitespace-pre-wrap mb-1 ${STATUS_TEXT_COLORS[item.status] || ''}`}>{item.message}</p>

                    {/* Attachments */}
                    {item.attachments && item.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {item.attachments.map((src, i) => (
                          <div key={i} className="relative group">
                            <img
                              src={src}
                              alt={`Attachment ${i + 1}`}
                              className="w-24 h-24 object-cover rounded-md border border-border cursor-pointer hover:opacity-90 transition-opacity"
                              onClick={() => setPreviewSrc(src)}
                            />
                            <button
                              type="button"
                              onClick={() => setPreviewSrc(src)}
                              className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity rounded-md"
                              title="Enlarge"
                            >
                              <ZoomIn className="w-6 h-6 text-white drop-shadow-sm" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* ── Progress stepper ── */}
                  <div className="px-4 border-t border-border/50">
                    {renderProgressStepper(item)}
                  </div>

                  {/* ── Admin response thread (visible to everyone) ── */}
                  {hasResponses && (
                    <div className="px-4 pb-1 border-t border-border/50">
                      {/* Threaded responses */}
                      {hasResponses && (
                        <div className="mt-2 space-y-2 pb-2">
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Reply className="w-3 h-3" />
                            <span>{responseCount} {responseCount === 1 ? 'reply' : 'replies'}</span>
                          </div>
                          {item.feedback_responses.map(resp => (
                            <div key={resp.id} className="ml-2 rounded-md bg-accent/20 border-l-2 border-primary/40 p-3 text-sm">
                              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                                <div className="flex items-center gap-2">
                                  {resp.admin_avatar_url ? (
                                    <img src={resp.admin_avatar_url} alt="" className="w-4 h-4 rounded-full" />
                                  ) : (
                                    <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center text-[9px] font-medium">
                                      {(resp.admin_display_name || 'A').charAt(0).toUpperCase()}
                                    </div>
                                  )}
                                  <span className="font-medium text-foreground">
                                    {resp.admin_display_name || 'Admin'}
                                  </span>
                                  <span className="px-1 py-0.5 rounded text-[10px] font-medium bg-primary-subtle text-primary">
                                    Admin
                                  </span>
                                </div>
                                <time>{formatDateTimeInTimezone(resp.created_at, getPrimaryTimezone())}</time>
                              </div>
                              <p className="whitespace-pre-wrap">{resp.message}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Admin reply toggle ── */}
                  {isAdmin && (
                    <div className="px-4 py-2 border-t border-border/50 flex items-center gap-2">
                      <Button
                        emphasis="ghost"
                        intent="primary"
                        size="compact"
                        aria-expanded={isExpanded}
                        onClick={() => {
                          if (isExpanded) {
                            setExpandedId(null)
                          } else {
                            setExpandedId(item.id)
                            setAdminResponse('')
                          }
                        }}
                        icon={<Reply className="w-3.5 h-3.5" />}
                      >
                        {isExpanded ? 'Cancel reply' : 'Reply'}
                        {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </Button>

                      {/* Delete controls */}
                      <div className="ml-auto flex items-center gap-1">
                        {confirmDeleteId === item.id ? (
                          <>
                            <span className="text-xs text-danger mr-1">Delete permanently?</span>
                            <Button
                              intent="danger"
                              size="micro"
                              onClick={() => handleDeleteFeedback(item.id)}
                              disabled={updatingId === item.id}
                            >
                              {updatingId === item.id ? 'Deleting...' : 'Delete'}
                            </Button>
                            <Button
                              emphasis="outline"
                              size="micro"
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <IconButton
                            label="Delete this entry"
                            icon={<Trash2 />}
                            intent="danger"
                            onClick={() => setConfirmDeleteId(item.id)}
                          />
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── Admin reply form ── */}
                  {isAdmin && isExpanded && (
                    <div className="px-4 pb-4 space-y-2 border-t border-border/50 pt-3">
                      <textarea
                        value={adminResponse}
                        onChange={e => setAdminResponse(e.target.value)}
                        placeholder="Write a reply..."
                        rows={2}
                        maxLength={2000}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring resize-y"
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <Button
                          emphasis="outline"
                          intent="primary"
                          size="compact"
                          onClick={() => handleRespond(item.id)}
                          disabled={!adminResponse.trim()}
                          loading={updatingId === item.id}
                          icon={<Send className="w-3 h-3" />}
                        >
                          {updatingId === item.id ? 'Sending...' : 'Send Reply'}
                        </Button>
                        <Button
                          emphasis="outline"
                          size="compact"
                          onClick={() => { setExpandedId(null); setAdminResponse('') }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* ── User-facing "Your feedback is being tracked" indicator ── */}
                  {!isAdmin && item.status !== 'open' && !hasResponses && (
                    <div className="px-4 py-2 border-t border-border/50">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Eye className="w-3.5 h-3.5 text-primary/60" />
                        <span>Your feedback has been seen by an admin</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4">
            <Button
              emphasis="outline"
              size="compact"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              {page} / {totalPages}
            </span>
            <Button
              emphasis="outline"
              size="compact"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next
            </Button>
          </div>
        )}
        </div>)}
      </div>
      )}
    </div>

      <Lightbox
        open={previewSrc !== null}
        onClose={() => setPreviewSrc(null)}
        src={previewSrc}
        alt="Attachment preview"
      />
    </>
  )
}
