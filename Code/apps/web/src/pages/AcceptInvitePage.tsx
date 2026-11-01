import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { apiClient } from '../lib/api-client'
import { Button } from '../components/ui'
import { CheckCircle2, XCircle, Loader2, Users } from 'lucide-react'

export default function AcceptInvitePage() {
  const { code } = useParams<{ code: string }>()
  const { session, isLoading: authLoading } = useAuth()
  const navigate = useNavigate()

  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'login-required'>('loading')
  const [errorMsg, setErrorMsg] = useState('')

  // Auto-redirect to friend list after successful acceptance
  useEffect(() => {
    if (status === 'success') {
      const timer = setTimeout(() => navigate('/user-management', { replace: true }), 1500)
      return () => clearTimeout(timer)
    }
  }, [status, navigate])

  useEffect(() => {
    // Wait for auth to finish initializing — this ensures the user profile
    // has been created in the database (via /api/auth/me) before we attempt
    // to accept the invite, avoiding FK violations for brand-new accounts.
    if (authLoading) return

    if (!session?.access_token) {
      setStatus('login-required')
      return
    }
    if (!code) {
      setStatus('error')
      setErrorMsg('No invite code provided')
      return
    }

    let cancelled = false

    apiClient.post('/api/connections/invites/accept', { code })
      .then(() => {
        if (!cancelled) setStatus('success')
      })
      .catch((err) => {
        if (cancelled) return
        setStatus('error')
        setErrorMsg(err.response?.data?.error || 'Failed to accept invite')
      })

    return () => { cancelled = true }
  }, [authLoading, session?.access_token, code])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full bg-card rounded-2xl shadow-lg border border-border p-8 text-center space-y-4">
        <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center bg-primary/10">
          <Users className="w-8 h-8 text-primary" />
        </div>

        {status === 'loading' && (
          <>
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
            <p className="text-muted-foreground">Accepting friend invite...</p>
          </>
        )}

        {status === 'login-required' && (
          <>
            <h2 className="text-xl font-semibold">Sign in to accept this invite</h2>
            <p className="text-sm text-muted-foreground">
              You need to be signed in to accept a friend invite. After signing in you will be redirected back here.
            </p>
            <Button
              intent="primary"
              onClick={() => {
                sessionStorage.setItem('authReturnTo', '/join/invite/' + (code || ''))
                navigate('/auth/login')
              }}
            >
              Sign In
            </Button>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle2 className="w-12 h-12 text-success mx-auto" />
            <h2 className="text-xl font-semibold">Friend Added!</h2>
            <p className="text-sm text-muted-foreground">
              They have been added to your friend list. Redirecting...
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <XCircle className="w-12 h-12 text-danger mx-auto" />
            <h2 className="text-xl font-semibold">Could not accept invite</h2>
            <p className="text-sm text-muted-foreground">{errorMsg}</p>
            <Button intent="primary" onClick={() => navigate('/')}>
              Go Home
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
