import { useState, useRef, useCallback, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { Calendar, Compass, Info, RefreshCw } from 'lucide-react'
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'
import { useAuth } from '../../contexts/AuthContext'
import { useCaptchaMode } from '../../lib/use-captcha-mode'
import CardanoWalletButton from '../../components/CardanoWalletButton'
import { Button } from '../../components/ui'

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, loginAsTraveler, isAuthenticated, isTraveler, isLoading: authLoading } = useAuth()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [captchaFailed, setCaptchaFailed] = useState(false)
  const [captchaReady, setCaptchaReady] = useState(false)
  const [captchaRetryKey, setCaptchaRetryKey] = useState(0)
  const [rememberMe, setRememberMe] = useState(false)
  const captchaTokenRef = useRef<string | null>(null)
  const turnstileRef = useRef<TurnstileInstance | null>(null)

  const { captchaMode } = useCaptchaMode()

  // Effective flag: captcha is active only when both the site key exists AND the backend says it's required
  const captchaActive = !!TURNSTILE_SITE_KEY && captchaMode

  const onCaptchaSuccess = useCallback((token: string) => {
    captchaTokenRef.current = token
    setCaptchaReady(true)
    setCaptchaFailed(false)
  }, [])

  const onCaptchaError = useCallback(() => {
    // Turnstile failed to load (network issue, blocked by extension, etc.)
    // Hide the broken widget and show a clean retry prompt instead.
    setCaptchaFailed(true)
    captchaTokenRef.current = null
  }, [])

  const retryCaptcha = useCallback(() => {
    setCaptchaFailed(false)
    setCaptchaReady(false)
    captchaTokenRef.current = null
    setCaptchaRetryKey(k => k + 1)
  }, [])

  // Check if this is an upgrade flow (traveler wanting to create account)
  const searchParams = new URLSearchParams(location.search)
  const isUpgradeFlow = searchParams.get('upgrade') === 'true'

  // Determine where to redirect after login
  // Priority: route state > sessionStorage (set by Layout) > home
  // Captured in a ref so it survives re-renders (onAuthStateChange can
  // trigger multiple renders before navigation completes).
  // Preserve search string so deep links like
  // /settings?tab=ai&section=agent-api-keys land on the right subsection.
  const fromRef = useRef((() => {
    const from = (location.state as { from?: { pathname?: string; search?: string; hash?: string } })?.from
    if (from?.pathname) {
      return `${from.pathname}${from.search || ''}${from.hash || ''}`
    }
    return sessionStorage.getItem('authReturnTo') || '/'
  })())

  // If already authenticated, redirect — unless this is an upgrade flow for a traveler
  const shouldRedirect = !authLoading && isAuthenticated && !(isUpgradeFlow && isTraveler)

  useEffect(() => {
    if (shouldRedirect) {
      sessionStorage.removeItem('authReturnTo')
      navigate(fromRef.current, { replace: true })
    }
  }, [shouldRedirect, navigate])

  if (authLoading || shouldRedirect) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const handleGoogleLogin = async () => {
    setError(null)
    try {
      // Preserve return path through OAuth redirect
      sessionStorage.setItem('authReturnTo', fromRef.current)
      await login(rememberMe)
    } catch (err: unknown) {
      // AbortError is expected during OAuth redirect: signInWithOAuth sets
      // window.location.href which unloads the page and aborts in-flight
      // promises. This is not a real failure — the redirect will proceed.
      if (err instanceof Error && err.name === 'AbortError') return
      const message = err instanceof Error ? err.message : 'Google sign-in failed'
      setError(message)
    }
  }

  const handleTravelerLogin = async () => {
    setError(null)
    if (captchaActive && !captchaTokenRef.current) {
      setError(captchaFailed
        ? 'Security check could not load. Please click "Retry" below.'
        : 'Please complete the captcha verification first.')
      return
    }
    setIsLoading(true)
    try {
      await loginAsTraveler(captchaTokenRef.current || undefined, rememberMe)
      // Auth state change triggers re-render; the render-time redirect
      // reads authReturnTo and navigates correctly (e.g. back to invite page).
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create traveler account'
      setError(message)
      turnstileRef.current?.reset()
      captchaTokenRef.current = null
      setCaptchaReady(false)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-linear-to-br from-background to-muted flex flex-col">
      {/* Header */}
      <header className="p-6">
        <Link to="/" className="flex items-center gap-2 w-fit">
          <Calendar className="h-6 w-6 text-primary" />
          <span className="font-semibold text-lg">Coordination Manager</span>
        </Link>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md">
          <div className="bg-card text-card-foreground rounded-2xl shadow-xl border border-border p-8">
            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold mb-2">Welcome</h1>
              <p className="text-muted-foreground">
                Coordinate schedules, find shared time, and organise together.
              </p>
            </div>

            {/* Error message */}
            {error && (
              <div className="mb-6 p-3 bg-danger-subtle border border-danger-muted rounded-lg text-sm text-danger">
                {error}
              </div>
            )}

            <label className="mb-5 flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(event) => setRememberMe(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
              />
              <span>
                <span className="block text-sm font-medium text-foreground">Remember me on this device</span>
                <span className="block text-xs text-muted-foreground">Keep this account available across tabs and browser restarts for up to 14 days of inactivity.</span>
              </span>
            </label>

            {/* Google Sign In */}
            <button
              onClick={handleGoogleLogin}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-border rounded-xl bg-card hover:bg-muted/60 transition-colors mb-4"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              <span className="font-medium">Continue with Google</span>
            </button>

            <p className="text-xs text-center text-muted-foreground mb-6">
              Full access — calendar sync, public events, persistent account
            </p>

            {/* Divider */}
            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 bg-card text-muted-foreground">or</span>
              </div>
            </div>

            {/* Traveler / Guest Sign In */}
            <button
              onClick={isUpgradeFlow && isTraveler ? () => navigate(-1) : handleTravelerLogin}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-warning-subtle border border-warning-muted rounded-xl hover:bg-warning-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-3"
            >
              <Compass className="w-5 h-5 text-warning" />
              <span className="font-medium text-warning">
                {isLoading ? 'Creating your identity...' : isUpgradeFlow && isTraveler ? 'Keep Traveler Account' : 'Continue as Traveler'}
              </span>
            </button>

            {/* Traveler info box */}
            <div className="bg-card border border-border rounded-lg p-4 text-sm text-muted-foreground">
              <div className="flex gap-2">
                <Info className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium mb-1">Traveler accounts</p>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    <li>• No email or password required</li>
                    <li>• You get a random identity (e.g. <em>Wandering Falcon 42</em>)</li>
                    <li>• Create and manage <strong>unlisted</strong> calendars</li>
                    <li>• Account auto-expires after <strong>64 days</strong></li>
                    <li>• If you lose your session, it cannot be recovered</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 bg-card text-muted-foreground">or</span>
              </div>
            </div>

            {/* Cardano Wallet Sign In — for existing Cardano users with a browser extension */}
            <div>
              <CardanoWalletButton
                getCaptchaToken={() => captchaTokenRef.current}
                isCaptchaReady={!captchaActive || captchaReady}
                rememberMe={rememberMe}
                onSuccess={() => {
                  sessionStorage.removeItem('authReturnTo')
                }}
                onError={(msg) => setError(msg)}
              />
              <p className="text-xs text-center text-muted-foreground mt-2">
                Already have Eternl, Lace, or Typhon installed? Sign in with your Cardano wallet.
              </p>
            </div>

            {/* Turnstile captcha — only shown when backend detects a signup spike */}
            {captchaActive && (
              <div className="flex justify-center my-4">
                {captchaFailed ? (
                  <Button
                    emphasis="outline"
                    icon={<RefreshCw className="w-4 h-4" />}
                    onClick={retryCaptcha}
                  >
                    Security check failed to load — click to retry
                  </Button>
                ) : (
                  <Turnstile
                    key={captchaRetryKey}
                    ref={turnstileRef}
                    siteKey={TURNSTILE_SITE_KEY}
                    onSuccess={onCaptchaSuccess}
                    onError={onCaptchaError}
                    onExpire={() => { captchaTokenRef.current = null; setCaptchaReady(false) }}
                    options={{ theme: 'auto', size: 'flexible' }}
                  />
                )}
              </div>
            )}

            {/* Links */}
            <div className="mt-6 flex justify-center gap-4 text-xs text-muted-foreground">
              <a
                href="https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/docs/public/PRIVACY_POLICY.md"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground"
              >
                Privacy Policy
              </a>
              <span>·</span>
              <a
                href="https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/docs/public/TERMS_OF_SERVICE.md"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground"
              >
                Terms of Service
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
