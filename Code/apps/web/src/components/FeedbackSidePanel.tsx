import { useState, useRef } from 'react'
import { X, MessageSquare, Send, CheckCircle, AlertTriangle, ExternalLink, Paperclip, X as XIcon, ZoomIn } from 'lucide-react'
import { Link } from 'react-router-dom'
import { apiClient } from '../lib/api-client'
import LearnerHelpIcon from './LearnerHelpIcon'
import MobilePanelSwitcher from './MobilePanelSwitcher'
import CalendarQuickButtonToggle from './CalendarQuickButtonToggle'
import type { PanelId } from './panel-types'
import { SHELL_LAYER_CLASS } from '../lib/overlay-layers'
import { Button, IconButton, Lightbox } from './ui'

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
        fixed inset-y-0 right-0 ${SHELL_LAYER_CLASS.sidePanel} w-screen transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0 pointer-events-auto sm:w-88 md:w-96' : 'translate-x-full pointer-events-none sm:w-0'}
        sm:sticky sm:top-0 sm:h-screen sm:shrink-0 sm:overflow-hidden sm:translate-x-0 sm:pointer-events-auto
      `}
    >
      <div className={`ml-auto h-full w-screen flex flex-col bg-card border-l-2 border-feature-feedback shadow-xl sm:w-88 sm:min-w-88 md:w-96 md:min-w-[24rem]`}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/40">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-feature-feedback" />
          <h2 className="font-semibold text-sm">Feedback</h2>
          <LearnerHelpIcon size={4} usePortal description={<><p className="font-semibold text-info mb-1">Side Panel — Feedback</p><p className="mb-1.5">Side panels slide in from the right on every page, giving you quick access to conversational tools without leaving what you're doing.</p><p className="mb-1.5">The <strong>Feedback panel</strong> lets you share your thoughts, report bugs, or suggest improvements directly to the platform team.</p><p><strong>Tip:</strong> You can open this from any page — your feedback automatically includes context about where you were.</p></>} />
        </div>
        <div className="flex items-center gap-1">
          <CalendarQuickButtonToggle toolKey="feedback" label="Feedback" />
          <IconButton label="Close" icon={<X />} onClick={onClose} />
        </div>
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
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-hidden focus:ring-2 focus:ring-ring"
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
              <Button
                emphasis="ghost"
                size="micro"
                onClick={() => attachFileRef.current?.click()}
                className="self-start"
                title="Attach image (or paste from clipboard)"
                icon={<Paperclip className="h-3.5 w-3.5" />}
              >
                {attachments.length > 0 ? `${attachments.length}/3 images` : 'Attach image'}
              </Button>
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
                    <ZoomIn className="w-5 h-5 text-white drop-shadow-sm" />
                  </button>
                  {/* Remove button */}
                  <IconButton
                    label="Remove"
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

          {submitError && (
            <div className="flex items-start gap-2 text-sm text-danger">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          {submitSuccess && (
            <div className="flex items-center gap-2 text-sm text-success">
              <CheckCircle className="h-4 w-4 shrink-0" />
              <span>Thank you — your feedback has been submitted!</span>
            </div>
          )}

          <Button
            type="submit"
            intent="primary"
            fullWidth
            disabled={!message.trim()}
            loading={submitting}
            icon={<Send className="h-4 w-4" />}
          >
            {submitting ? 'Sending…' : 'Send Feedback'}
          </Button>
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
            <ExternalLink className="h-4 w-4 text-feature-feedback" />
            Go to Feedback History
          </Link>
        </div>
        </div>
      </div>
      </div>

      <Lightbox
        open={previewSrc !== null}
        onClose={() => setPreviewSrc(null)}
        src={previewSrc}
        alt="Attachment preview"
      />
    </aside>
  )
}
