import { useMemo, useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, X } from 'lucide-react'
import type { SetupStatus, FeatureFlag } from '../lib/setup-api'
import { IconButton } from './ui'

// Human-readable labels for each optional feature returned by /api/setup/status.
const FEATURE_LABELS: Record<FeatureFlag, string> = {
  admin: 'Admin actions',
  jwt: 'Sessions',
  google: 'Google sign-in',
  discord: 'Discord bot (Coordination bot)',
  smtp: 'Email delivery',
  captcha: 'Bot protection (Turnstile)',
  ai: 'AI assistant',
}

// Feature flag -> Setup page card id. Used so the "Configure in Setup" link
// scrolls to the right section (the FeatureFlag enum and the per-card ids do
// not line up one-to-one: Discord has two cards, SMTP has none, etc.).
const FEATURE_TO_SETUP_HASH: Record<FeatureFlag, string> = {
  admin: 'database',
  jwt: 'database',
  google: 'google',
  discord: 'discord-coord',
  smtp: 'database',
  captcha: 'captcha',
  ai: 'ai',
}

// Features that the user explicitly opts into via the Setup page and which
// are commonly absent on first-run. We show a banner only when one of these
// is missing -- core stuff like `jwt` is already covered by the Setup
// wizard takeover, so listing it here would be noisy.
const FEATURES_TO_SURFACE: FeatureFlag[] = ['discord', 'google', 'smtp', 'ai', 'captcha']

// FeatureFlag -> disable key. When a feature is intentionally turned off
// from the Setup page we must NOT nag about it being unconfigured.
const FEATURE_TO_DISABLE_KEY: Partial<Record<FeatureFlag, 'discord-coord' | 'ai' | 'captcha'>> = {
  discord: 'discord-coord',
  ai: 'ai',
  captcha: 'captcha',
}

const DISMISS_STORAGE_KEY = 'cm_feature_banner_dismissed_v1'

interface Props {
  status: SetupStatus | null
}

/**
 * Shows a thin amber banner listing optional integrations that are not
 * configured, with a link to the Setup page. Dismissible per browser. The
 * banner is suppressed entirely when the Setup wizard takeover is active (the
 * wizard is a better signal in that case).
 */
export function FeatureDisabledBanner({ status }: Props) {
  const [dismissed, setDismissed] = useState<boolean>(false)

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_STORAGE_KEY) === '1')
    } catch {
      /* localStorage unavailable -- treat as not dismissed */
    }
  }, [])

  const missing = useMemo<FeatureFlag[]>(() => {
    if (!status?.features) return []
    const disabled = status.disabled ?? {}
    return FEATURES_TO_SURFACE.filter((f) => {
      if (status.features?.[f] !== false) return false
      // Skip features the operator explicitly disabled in Setup -- they
      // chose to turn this off, do not nag about it being unconfigured.
      const disableKey = FEATURE_TO_DISABLE_KEY[f]
      if (disableKey && disabled[disableKey] === true) return false
      return true
    })
  }, [status])

  // Hide if: the wizard takeover is active, nothing is missing, the user
  // dismissed it, or we are in production (production must not advertise the
  // local setup endpoint).
  if (!status) return null
  if (status.environment === 'production') return null
  if (!status.isApiConfigured) return null // SetupContext will be running the wizard
  if (missing.length === 0) return null
  if (dismissed) return null

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISS_STORAGE_KEY, '1')
    } catch {
      /* ignore */
    }
    setDismissed(true)
  }

  return (
    <div className="border-b border-warning-muted bg-warning-subtle">
      <div className="container mx-auto flex items-start gap-3 px-4 py-2 text-sm text-foreground">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="flex-1">
          <span className="font-medium">Some features are disabled:</span>{' '}
          <span>{missing.map((f) => FEATURE_LABELS[f]).join(', ')}.</span>{' '}
          <Link to={`/setup#${FEATURE_TO_SETUP_HASH[missing[0]]}`} className="underline underline-offset-2 hover:text-warning">
            Configure in Setup
          </Link>
        </div>
        <IconButton
          label="Dismiss notice"
          icon={<X />}
          intent="warning"
          showTitle={false}
          onClick={handleDismiss}
          className="-my-1"
        />
      </div>
    </div>
  )
}
