import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Calendar } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { clearStaleAuthState } from '../../lib/auth-service'

/**
 * OAuth callback page.
 * Supabase handles the token exchange automatically via the URL hash/params.
 * This page waits for the session to be established before redirecting.
 */
export default function AuthCallbackPage() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    const failWithCleanup = async (message: string) => {
      await clearStaleAuthState()
      if (mounted) {
        setError(message)
      }
    }

    // Check URL for error params (e.g., user cancelled)
    const params = new URLSearchParams(window.location.search)
    const hashParams = new URLSearchParams(window.location.hash.substring(1))

    const errorParam = params.get('error') || hashParams.get('error')
    const errorDescription = params.get('error_description') || hashParams.get('error_description')

    if (errorParam) {
      void failWithCleanup(errorDescription || errorParam)
      return
    }

    const returnTo = sessionStorage.getItem('authReturnTo') || '/'

    // Wait for Supabase to process the OAuth callback and establish a session
    const checkSession = async () => {
      try {
        // Give Supabase a moment to process the URL hash tokens
        const { data: { session }, error: sessionError } = await supabase.auth.getSession()

        if (sessionError) {
          await failWithCleanup(sessionError.message)
          return
        }

        if (session) {
          // Session established — redirect
          sessionStorage.removeItem('authReturnTo')
          navigate(returnTo, { replace: true })
          return
        }

        // No session yet — listen for auth state change
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
          (event, currentSession) => {
            if (event === 'SIGNED_IN' && currentSession) {
              sessionStorage.removeItem('authReturnTo')
              subscription.unsubscribe()
              navigate(returnTo, { replace: true })
            }
          }
        )

        // Safety timeout: redirect after 8 seconds even if session isn't detected
        setTimeout(() => {
          subscription.unsubscribe()
          sessionStorage.removeItem('authReturnTo')
          navigate(returnTo, { replace: true })
        }, 8000)
      } catch (err) {
        console.error('Auth callback error:', err)
        await failWithCleanup('Failed to complete authentication')
      }
    }

    // Small delay to let Supabase client process the URL hash
    const timer = setTimeout(checkSession, 500)
    return () => {
      mounted = false
      clearTimeout(timer)
    }
  }, [navigate])

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background to-muted flex flex-col items-center justify-center px-4">
        <div className="bg-card text-card-foreground rounded-2xl shadow-xl border border-border p-8 max-w-md w-full text-center">
          <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-950 flex items-center justify-center mx-auto mb-4">
            <span className="text-red-600 dark:text-red-400 text-xl">!</span>
          </div>
          <h2 className="text-xl font-bold mb-2">Authentication Failed</h2>
          <p className="text-muted-foreground mb-6">{error}</p>
          <button
            onClick={() => navigate('/auth/login', { replace: true })}
            className="px-6 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-lg transition-colors"
          >
            Back to Login
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted flex flex-col items-center justify-center px-4">
      <div className="flex flex-col items-center gap-4">
        <Calendar className="h-10 w-10 text-primary animate-pulse" />
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-muted-foreground font-medium">Signing you in...</p>
      </div>
    </div>
  )
}
