import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Calendar, Video, ArrowRight, CheckCircle2, Loader2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { Button } from '../components/ui'

const SETTINGS_ZOOM_URL = '/settings?tab=calendar&section=integrations'

/**
 * Hidden page for Zoom Marketplace reviewers to test the OAuth integration.
 * Provides one-click guest login and redirects to the Zoom integration settings.
 */
export default function ZoomReviewPage() {
  const navigate = useNavigate()
  const { isAuthenticated, isLoading: authLoading, loginAsTraveler } = useAuth()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingRedirect, setPendingRedirect] = useState(false)

  // Navigate only after React has committed the auth state update,
  // so ProtectedRoute sees isAuthenticated=true and doesn't redirect to login.
  // Also wait for authLoading to settle to avoid stale-session races.
  useEffect(() => {
    if (pendingRedirect && isAuthenticated && !authLoading) {
      navigate(SETTINGS_ZOOM_URL)
    }
  }, [pendingRedirect, isAuthenticated, authLoading, navigate])

  // While auth is still initialising, show a spinner
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-background to-muted">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-info" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  const handleStartReview = async () => {
    if (isAuthenticated) {
      navigate(SETTINGS_ZOOM_URL)
      return
    }

    setError(null)
    setIsLoading(true)
    try {
      await loginAsTraveler()
      setPendingRedirect(true)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create test account'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-linear-to-br from-background to-muted flex flex-col">
      {/* Header */}
      <header className="p-6 flex items-center gap-2">
        <Calendar className="h-6 w-6 text-info" />
        <span className="font-semibold text-lg text-foreground">Coordination Manager</span>
        <span className="ml-2 px-2 py-0.5 text-[10px] font-medium bg-warning-subtle text-warning rounded-full uppercase tracking-wider">
          Zoom Review
        </span>
      </header>

      {/* Main */}
      <main className="flex-1 flex items-center justify-center px-4 pb-16">
        <div className="w-full max-w-lg">
          <div className="bg-card rounded-2xl shadow-xl border border-border p-8">
            {/* Icon */}
            <div className="flex items-center justify-center mb-6">
              <div className="w-16 h-16 bg-info-subtle rounded-2xl flex items-center justify-center">
                <Video className="w-8 h-8 text-primary" />
              </div>
            </div>

            <h1 className="text-2xl font-bold text-center text-foreground mb-2">
              Zoom Integration Review
            </h1>
            <p className="text-center text-muted-foreground mb-8">
              Welcome, Zoom Marketplace reviewer. This page will help you test the Zoom OAuth integration in Coordination Manager.
            </p>

            {/* Steps */}
            <div className="space-y-4 mb-8">
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-info-subtle flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-sm font-semibold text-primary">1</span>
                </div>
                <div>
                  <p className="font-medium text-foreground">Click "Start Testing" below</p>
                  <p className="text-sm text-muted-foreground">
                    A guest test account will be created automatically -- no email or password needed.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-info-subtle flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-sm font-semibold text-primary">2</span>
                </div>
                <div>
                  <p className="font-medium text-foreground">Connect your Zoom account</p>
                  <p className="text-sm text-muted-foreground">
                    You will be redirected to Settings where you can click "Connect Zoom" to start the OAuth flow.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-info-subtle flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-sm font-semibold text-primary">3</span>
                </div>
                <div>
                  <p className="font-medium text-foreground">Verify the integration</p>
                  <p className="text-sm text-muted-foreground">
                    Once connected, the settings page will show your Zoom account details. You can also disconnect at any time.
                  </p>
                </div>
              </div>
            </div>

            {/* CTA */}
            <Button
              intent="primary"
              fullWidth
              onClick={handleStartReview}
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Creating test account...
                </>
              ) : isAuthenticated ? (
                <>
                  <CheckCircle2 className="w-5 h-5" />
                  Go to Zoom Integration Settings
                  <ArrowRight className="w-4 h-4" />
                </>
              ) : (
                <>
                  Start Testing
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </Button>

            {error && (
              <p className="mt-3 text-sm text-danger text-center">{error}</p>
            )}

            {/* Info box */}
            <div className="mt-6 p-4 bg-muted/50 rounded-xl border border-border">
              <h3 className="text-sm font-semibold text-foreground mb-2">About this app</h3>
              <p className="text-sm text-muted-foreground">
                Coordination Manager is a meeting coordination platform for the Cardano blockchain community. The Zoom integration allows users to generate Zoom meeting links directly when scheduling events on their coordination calendars.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
