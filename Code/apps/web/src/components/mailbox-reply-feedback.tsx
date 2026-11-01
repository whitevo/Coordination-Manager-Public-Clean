import { useRef, useState } from 'react'
import SentimentGrid from '@/components/SentimentGrid'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/Button'

interface MailboxReplyFeedbackProps {
  instruction: string
  subject: string
  body: string
}

export default function MailboxReplyFeedback({ instruction, subject, body }: MailboxReplyFeedbackProps) {
  const [expanded, setExpanded] = useState(false)
  const [valence, setValence] = useState(0)
  const [trust, setTrust] = useState(0)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlightRef = useRef(false)

  const submit = async () => {
    if (inFlightRef.current || submitted) return
    inFlightRef.current = true
    setSubmitting(true)
    setError(null)
    try {
      await apiClient.post('/api/ai-feedback', {
        user_prompt: `Mailbox AI: Suggest reply\n${instruction}`,
        ai_answer: `Subject: ${subject}\n\n${body}`,
        sentiment_valence: valence,
        sentiment_trust: trust,
        feedback_text: comment.trim() || null,
      })
      setSubmitted(true)
    } catch (err) {
      console.warn('[MailboxReplyFeedback] Submission failed:', err)
      setError('Could not submit feedback. Your rating and comment have been kept; please try again.')
    } finally {
      inFlightRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <section aria-label="AI reply suggestion feedback" className="rounded-md border border-border p-2 text-xs">
      <Button emphasis="ghost" size="compact" aria-expanded={expanded} onClick={() => setExpanded(current => !current)}
        className="min-h-11">
        {submitted ? 'Feedback submitted' : 'Give feedback on AI reply'}
      </Button>
      {expanded && (submitted ? (
        <p role="status" className="text-success">Thank you for your feedback!</p>
      ) : (
        <div className="space-y-2">
          <p className="text-muted-foreground">
            Submitting shares your AI instruction and the original generated reply with feedback reviewers.
            Your later edits and the source thread are not attached.
          </p>
          <div className="flex justify-center">
            <SentimentGrid valence={valence} trust={trust} onChange={(quality, confidence) => {
              setValence(quality)
              setTrust(confidence)
            }} size={160} disabled={submitting} />
          </div>
          <label className="block">
            Optional feedback
            <textarea aria-label="AI reply feedback comment" value={comment}
              onChange={event => setComment(event.target.value)} maxLength={2000} rows={2} disabled={submitting}
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-2 text-foreground" />
          </label>
          {error && <p role="alert" className="text-danger">{error}</p>}
          <Button intent="primary" size="compact" onClick={() => void submit()} disabled={submitting}
            className="min-h-11">
            {submitting ? 'Submitting feedback...' : 'Submit feedback'}
          </Button>
        </div>
      ))}
    </section>
  )
}
