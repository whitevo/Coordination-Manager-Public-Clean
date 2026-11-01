import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { ShieldAlert, CheckCircle2, Loader2, AlertCircle } from 'lucide-react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'
const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || 'support@example.com'

export default function EmailAbusePage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const reported = searchParams.get('reported')

  const [status, setStatus] = useState<'idle' | 'processing' | 'success' | 'error'>(
    reported === 'true' ? 'success' : 'idle'
  )
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (token && status === 'idle') {
      setStatus('processing')
      fetch(`${API_URL}/api/email-abuse/report/${encodeURIComponent(token)}`, {
        redirect: 'manual',
      })
        .then(res => {
          if (res.ok || res.type === 'opaqueredirect' || res.status === 302 || res.status === 301) {
            setStatus('success')
          } else {
            return res.json().then(d => {
              setErrorMessage(d.error || 'Failed to process report')
              setStatus('error')
            })
          }
        })
        .catch(() => {
          // Redirect responses may trigger a network error with manual redirect
          // Treat as success since the API processed it
          setStatus('success')
        })
    }
  }, [token, status])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full">
        <div className="bg-card border border-border rounded-xl shadow-lg p-8 text-center">
          {status === 'processing' && (
            <>
              <Loader2 className="w-12 h-12 mx-auto text-primary animate-spin mb-4" />
              <h1 className="text-xl font-bold mb-2">Processing Report</h1>
              <p className="text-sm text-muted-foreground">
                Please wait while we process your abuse report...
              </p>
            </>
          )}

          {status === 'success' && (
            <>
              <CheckCircle2 className="w-12 h-12 mx-auto text-success mb-4" />
              <h1 className="text-xl font-bold mb-2">Report Received</h1>
              <p className="text-sm text-muted-foreground mb-4">
                Thank you for reporting this. Verification emails to your address have been blocked
                for the next <strong>48 hours</strong>.
              </p>
              <p className="text-xs text-muted-foreground mb-6">
                If you continue to receive unwanted emails after this period, please contact us at{' '}
                <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:underline">{SUPPORT_EMAIL}</a>.
              </p>
              <div className="pt-4 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  <ShieldAlert className="w-4 h-4 inline mr-1" />
                  Coordination Manager takes email abuse seriously.
                </p>
              </div>
            </>
          )}

          {status === 'error' && (
            <>
              <AlertCircle className="w-12 h-12 mx-auto text-danger mb-4" />
              <h1 className="text-xl font-bold mb-2">Report Failed</h1>
              <p className="text-sm text-muted-foreground mb-4">
                {errorMessage || 'The report link may have expired or already been used.'}
              </p>
              <p className="text-xs text-muted-foreground">
                If you believe your email is being misused, please contact us at{' '}
                <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:underline">{SUPPORT_EMAIL}</a>.
              </p>
            </>
          )}

          {status === 'idle' && !token && !reported && (
            <>
              <ShieldAlert className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <h1 className="text-xl font-bold mb-2">Email Abuse Report</h1>
              <p className="text-sm text-muted-foreground mb-4">
                This page is used to report unwanted email verification attempts.
                If you received a verification email you did not request, use the report link
                included in that email.
              </p>
            </>
          )}

          <Link
            to="/"
            className="inline-block mt-6 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
          >
            Go to Homepage
          </Link>
        </div>
      </div>
    </div>
  )
}
