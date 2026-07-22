import { useState, useRef, useEffect } from 'react'
import { X, MessageSquare, Send, CheckCircle, AlertTriangle, ExternalLink, Loader2, Paperclip, X as XIcon, ZoomIn } from 'lucide-react'
import { Link } from 'react-router-dom'
import { apiClient } from '../lib/api-client'
import LearnerHelpIcon from './LearnerHelpIcon'
import MobilePanelSwitcher from './MobilePanelSwitcher'
import type { PanelId } from './FloatingPanels'

interface FeedbackSidePanelProps {
  isOpen: boolean
  onClose: () => void
  onPanelChange: (panel: Exclude<PanelId, null>) => void
}

export function FeedbackSidePanel({ isOpen, onClose, onPanelChange }: FeedbackSidePanelProps) {
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitSuccess, setSubmitSuccess] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [attachments, setAttachments] = useState<string[]>([])
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const attachFileRef = useRef<HTMLInputElement>(null)

  // Close lightbox on Escape
  useEffect(() => {
    if (!previewSrc) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreviewSrc(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [previewSrc])

  const readImageFiles = (files: File[], existing: string[]): Promise<string[]> => {
    const remaining = 3 - existing.length
    return Promise.all(files.slice(0, remaining).map(file => new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = e => resolve(e.target?.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })))
  }

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items).filter(i => i.kind === 'file' && i.type.startsWith('image/'))
    if (items.length === 0) return
    const files = items.map(i => i.getAsFile()).filter(Boolean) as File[]
    const newImages = await readImageFiles(files, attachments)
    setAttachments(prev => [...prev, ...newImages].slice(0, 3))
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
        throw new Error('Unexpected response — feedback may not have been saved')
      }
      setMessage('')
      setAttachments([])
      setSubmitSuccess(true)
      setTimeout(() => setSubmitSuccess(false), 5000)
    } catch (err) {
      setSubmitError(
        (err as { response?: { data?: { error?: string } } }).response?.data?.error || (err as { message?: string }).message || 'Failed to submit feedback'
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <aside
      className={`
        fixed inset-y-0 right-0 z-50 w-screen transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0 pointer-events-auto sm:w-[22rem] md:w-96' : 'translate-x-full pointer-events-none sm:w-0'}
        sm:sticky sm:top-0 sm:h-screen sm:shrink-0 sm:overflow-hidden sm:translate-x-0 sm:pointer-events-auto
      `}
    >
      <div className={`ml-auto h-full w-screen flex flex-col bg-card border-l-2 border-amber-400 dark:border-amber-500 shadow-xl sm:w-[22rem] sm:min-w-[22rem] md:w-96 md:min-w-[24rem]`}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-amber-50 dark:bg-amber-950/40">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-amber-500" />
          <h2 className="font-semibold text-sm">Feedback</h2>
          <LearnerHelpIcon size={4} usePortal description={<><p className="font-semibold text-blue-700 dark:text-blue-300 mb-1">Side Panel — Feedback</p><p className="mb-1.5">Side panels slide in from the right on every page, giving you quick access to conversational tools without leaving what you're doing.</p><p className="mb-1.5">The <strong>Feedback panel</strong> lets you share your thoughts, report bugs, or suggest improvements directly to the platform team.</p><p><strong>Tip:</strong> You can open this from any page — your feedback automatically includes context about where you were.</p></>} />
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md text-muted-foreground hover:bg-accent/50 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <MobilePanelSwitcher activePanel="feedback" onPanelChange={onPanelChange} />

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col">
        <div className="flex flex-col gap-5">
        {/* Quick-submit form */}
        <form onSubmit={handleSubmit} onPaste={handlePaste} className="space-y-3">
          <label htmlFor="fb-msg" className="text-sm font-medium">
            Share your thoughts
          </label>
          <textarea
            id="fb-msg"
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="What's on your mind? Bugs, ideas, praise — all welcome…"
            rows={5}
            maxLength={2000}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400/50"
          />

          {/* Hidden file input */}
          <input
            ref={attachFileRef}
            id="feedback-attachments"
            name="feedbackAttachments"
            aria-label="Attach feedback images"
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            className="hidden"
            onChange={async e => {
              if (!e.target.files) return
              const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'))
              const newImages = await readImageFiles(files, attachments)
              setAttachments(prev => [...prev, ...newImages].slice(0, 3))
            }}
          />

          {/* Attach button + clipboard hint */}
          {attachments.length < 3 && (
            <div className="flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() => attachFileRef.current?.click()}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                title="Attach image (or paste from clipboard)"
              >
                <Paperclip className="h-3.5 w-3.5" />
                {attachments.length > 0 ? `${attachments.length}/3 images` : 'Attach image'}
              </button>
              <span className="text-xs text-muted-foreground/60 pl-5">or paste from clipboard (Ctrl+V)</span>
            </div>
          )}

          {/* Image previews */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachments.map((src, i) => (
                <div key={i} className="relative group w-16 h-16 rounded-md overflow-hidden border border-border">
                  <img src={src} alt={`Attachment ${i + 1}`} className="w-full h-full object-cover cursor-pointer" onClick={() => setPreviewSrc(src)} />
                  {/* Enlarge hint */}
                  <button
                    type="button"
                    onClick={() => setPreviewSrc(src)}
                    className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Enlarge"
                  >
                    <ZoomIn className="w-5 h-5 text-white drop-shadow" />
                  </button>
                  {/* Remove button */}
                  <button
                    type="button"
                    onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
                    className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity z-10"
                    title="Remove"
                  >
                    <XIcon className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {submitError && (
            <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          {submitSuccess && (
            <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle className="h-4 w-4 shrink-0" />
              <span>Thank you — your feedback has been submitted!</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !message.trim()}
            className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white transition-all duration-200 ${
              submitting || !message.trim()
                ? 'bg-amber-300 dark:bg-amber-800 cursor-not-allowed'
                : 'bg-amber-500 hover:bg-amber-600 shadow-md'
            }`}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {submitting ? 'Sending…' : 'Send Feedback'}
          </button>
        </form>

        {/* Divider */}
        <div className="border-t border-border" />

        {/* Links to full feedback page */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Want to see all feedback or review past submissions?
          </p>
          <Link
            to="/feedback"
            onClick={onClose}
            className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border text-sm font-medium hover:bg-accent/50 transition-colors"
          >
            <ExternalLink className="h-4 w-4 text-amber-500" />
            Go to Feedback History
          </Link>
        </div>
        </div>
      </div>
      </div>

      {/* Lightbox overlay */}
      {previewSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setPreviewSrc(null)}
        >
          <button
            type="button"
            onClick={() => setPreviewSrc(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
            title="Close"
          >
            <XIcon className="w-5 h-5" />
          </button>
          <img
            src={previewSrc}
            alt="Preview"
            className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl object-contain"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </aside>
  )
}
