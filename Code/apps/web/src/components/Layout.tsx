import { lazy, useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react'
import { useMobileMenuHeight } from '../hooks/use-mobile-menu-height'
import { dismissPanelsForMobileNavigation } from '../hooks/use-mobile-navigation-panel-dismiss'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import { Calendar, CalendarPlus, Home, User, LogOut, ChevronDown, ChevronRight, Compass, AlertTriangle, Palette, Megaphone, MessageSquare, MessageCircle, Menu, X, Sparkles, Bell, Shield, Wrench, CalendarDays, CalendarClock, Users, Wallet, UserPlus, WifiOff, Eye, LifeBuoy, Video, Loader2, ExternalLink, Info, SlidersHorizontal, Inbox, LayoutGrid, FileText, Clock, Scale, Flag } from 'lucide-react'
import { detectWallets } from '../lib/cardano-wallet'
import type { WalletInfo } from '../lib/cardano-types'
import { generateManagedWallet } from '../lib/managed-wallet'
import { OVERLAY_LAYER_CLASS, SHELL_LAYER_CLASS } from '../lib/overlay-layers'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { Button, Dialog, IconButton } from './ui'
import { useSetup } from '../contexts/SetupContext'
import { isSetupAccessible } from '../lib/setup-api'
import { apiClient, dedupedGet, RATE_LIMIT_WARN_EVENT, RATE_LIMIT_WARN_TTL_MS, getPersistedRateLimitWarn } from '../lib/api-client'
import { useCaptchaMode } from '../lib/use-captcha-mode'
import { getPrimaryTimezone, formatDateInTimezone, formatTimeInTimezone } from '../lib/timezone-data'
import { DeferredSidePanel } from './deferred-side-panel'
import { bufferAiAssistantMessages } from '@/lib/ai-assistant-message-events'
import { FeatureDisabledBanner } from './FeatureDisabledBanner'
import { DesignCatalogHighlighter } from './DesignCatalogHighlighter'
import { AiAssistantProvider } from '../contexts/AiAssistantContext'
import { LeftPanelSlot, RightPanelSlot } from '../contexts/LayoutContext'
import { isPanelId, type PanelId } from './panel-types'
import QuickPinButton from './QuickPinButton'
import { isNavQuickToolVisible } from '../lib/nav-quick-tool-visibility'
import {
  MAILBOX_NOTIFICATION_FLAG_EVENT,
  MAILBOX_REQUEST_PIN_EVENT,
  announceRemoteNewMail,
  buildMailboxNotificationFlagKey,
  readMailboxNotificationFlag,
  resolveMailboxNotificationFlagFromCheck,
  writeMailboxNotificationFlag,
} from '../pages/mailbox-notifications'

const AiGuideSidePanel = lazy(async () => ({ default: (await import('./AiGuideSidePanel')).AiGuideSidePanel }))
const FeedbackSidePanel = lazy(async () => ({ default: (await import('./FeedbackSidePanel')).FeedbackSidePanel }))
const ChatSidePanel = lazy(async () => ({ default: (await import('./ChatSidePanel')).ChatSidePanel }))
const SupportSidePanel = lazy(async () => ({ default: (await import('./SupportSidePanel')).SupportSidePanel }))
const CommonsSidePanel = lazy(async () => ({ default: (await import('./CommonsSidePanel')).CommonsSidePanel }))

const DOCS_OVERVIEW_URL = import.meta.env.DEV
  ? 'http://localhost:5174/docs/overview'
  : 'https://coordinationmanager.com/docs/overview'

// Interactive tools reachable from the "Assistance" nav dropdown.
const ASSISTANCE_OPTIONS: Array<{
  id: NavQuickToolKey
  label: string
  description: string
  icon: typeof Sparkles
  iconClass: string
  panel?: boolean
  to?: string
}> = [
  { id: 'ai', label: 'AI Assistant', description: 'Page-aware guidance and actions', icon: Sparkles, iconClass: 'text-feature-ai', panel: true },
  { id: 'chat', label: 'Chat', description: 'Talk with other accounts', icon: MessageCircle, iconClass: 'text-feature-chat', panel: true },
  { id: 'support', label: 'Support', description: 'Hours, cases, and knowledge base', icon: LifeBuoy, iconClass: 'text-feature-support', panel: true },
  { id: 'feedback', label: 'Feedback', description: 'Report bugs or share ideas', icon: MessageSquare, iconClass: 'text-feature-feedback', panel: true },
  { id: 'documentation', label: 'Documentation', description: 'Guides, API refs, and documentation', icon: FileText, iconClass: 'text-muted-foreground', panel: false, to: DOCS_OVERVIEW_URL },
]

const ACTIVE_PANEL_KEY = 'cm-active-right-panel'
/** Settings deep link used by the nav Theme button (SettingsPage scrolls to and focuses #settings-theme-mode). */
const THEME_SETTINGS_PATH = '/settings?tab=profile&section=theme-mode'

// How often to poll for new mail matching notification rules while the user is on any page.
const MAILBOX_NOTIFICATION_POLL_INTERVAL_MS = 120_000
const MAILBOX_ACTIVE_NEW_MAIL_SYNC_INTERVAL_MS = 5 * 60_000

function loadActivePanel(): PanelId {
  try {
    const value = sessionStorage.getItem(ACTIVE_PANEL_KEY)
    return isPanelId(value) ? value : null
  } catch {
    return null
  }
}

// Left-side "quick button" bar: pinnable navigation shortcuts + assistance panels.
// Route-based tools navigate directly; panel-based tools open a right side panel.
type NavRouteToolKey =
  | 'events-calendar' | 'calendars' | 'create-calendar' | 'time-management'
  | 'mailbox' | 'mailbox-people' | 'mailbox-invitations' | 'mailbox-settings'
  | 'distribute' | 'distribute-templates' | 'distribute-scheduled' | 'distribute-responses'
  | 'coordinate-events' | 'documentation' | 'guardian' | 'admin-oversight' | 'admin-users'
type NavQuickToolKey = NavRouteToolKey | Exclude<PanelId, null>

const NAV_QUICK_TOOLS_KEY = 'cm-nav-quick-tools'
const DEFAULT_NAV_QUICK_TOOLS: NavQuickToolKey[] = ['events-calendar', 'calendars', 'time-management']

type NavToolMeta =
  | { panel: false; to: string; label: string; icon: typeof CalendarDays; needsAuth?: boolean; external?: boolean }
  | { panel: true; label: string; icon: typeof CalendarDays }

const NAV_TOOL_META: Record<NavQuickToolKey, NavToolMeta> = {
  'events-calendar': { panel: false, to: '/events-calendar', label: 'All Public Events', icon: CalendarDays },
  calendars: { panel: false, to: '/calendars', label: 'Coordination Calendars', icon: Calendar },
  'create-calendar': { panel: false, to: '/calendar', label: 'Create Coordination Calendar', icon: CalendarPlus },
  'time-management': { panel: false, to: '/time-management', label: 'Time Management', icon: CalendarClock },
  mailbox: { panel: false, to: '/mailbox', label: 'Mailbox', icon: Inbox, needsAuth: true },
  'mailbox-people': { panel: false, to: '/mailbox?tab=people', label: 'Mailbox People', icon: Users, needsAuth: true },
  'mailbox-invitations': { panel: false, to: '/mailbox?tab=invitations', label: 'Mailbox Invitations', icon: UserPlus, needsAuth: true },
  'mailbox-settings': { panel: false, to: '/mailbox?tab=settings', label: 'Mailbox Settings', icon: SlidersHorizontal, needsAuth: true },
  distribute: { panel: false, to: '/distribute', label: 'Distribute Messages', icon: Megaphone, needsAuth: true },
  'distribute-templates': { panel: false, to: '/distribute?tab=templates', label: 'Distribute Templates', icon: FileText, needsAuth: true },
  'distribute-scheduled': { panel: false, to: '/distribute?tab=scheduled', label: 'Distribute Scheduled', icon: Clock, needsAuth: true },
  'distribute-responses': { panel: false, to: '/distribute?tab=responses', label: 'Distribute Responses', icon: MessageSquare, needsAuth: true },
  'coordinate-events': { panel: false, to: '/coordinate-events', label: 'Coordinate Events', icon: CalendarDays, needsAuth: true },
  guardian: { panel: false, to: '/guardian', label: 'Discord Guardian', icon: Shield, needsAuth: true },
  'admin-oversight': { panel: false, to: '/admin/oversight', label: 'Platform Oversight', icon: Eye, needsAuth: true },
  'admin-users': { panel: false, to: '/admin/users', label: 'User List', icon: Users, needsAuth: true },
  documentation: { panel: false, to: DOCS_OVERVIEW_URL, label: 'Documentation', icon: FileText, external: true },
  ai: { panel: true, label: 'AI Assistant', icon: Sparkles },
  chat: { panel: true, label: 'Chat', icon: MessageCircle },
  support: { panel: true, label: 'Support', icon: LifeBuoy },
  commons: { panel: true, label: 'Commons', icon: Scale },
  feedback: { panel: true, label: 'Feedback', icon: MessageSquare },
}

// Complete key order used to validate persisted quick-tool sequences.
const NAV_QUICK_TOOL_ORDER: NavQuickToolKey[] = [
  'events-calendar', 'calendars', 'create-calendar', 'time-management',
  'mailbox', 'mailbox-people', 'mailbox-invitations', 'mailbox-settings',
  'distribute', 'distribute-templates', 'distribute-scheduled', 'distribute-responses',
  'coordinate-events', 'ai', 'chat', 'support', 'feedback', 'commons', 'documentation',
  'guardian', 'admin-oversight', 'admin-users',
]

function getNavQuickLabel(key: NavQuickToolKey, wordCount: number): string {
  if (wordCount === 0) return ''

  if (key === 'documentation') {
    if (wordCount >= 2) return 'Documentation'
    if (wordCount === 1) return 'Docs'
    return ''
  }

  const words = NAV_TOOL_META[key].label.split(' ')
  if (key === 'create-calendar') return words.slice(0, wordCount).join(' ')
  return words.slice(0, wordCount).join(' ')
}

function getNavQuickWordCounts(): Record<NavQuickToolKey, number> {
  return Object.fromEntries(
    NAV_QUICK_TOOL_ORDER.map((key) => {
      if (key === 'documentation') return [key, 2]
      return [key, NAV_TOOL_META[key].label.split(' ').length]
    }),
  ) as Record<NavQuickToolKey, number>
}

// Tools dropdown rows that reveal a hover-triggered flyout of related sub-pages.
// The flyout widens the dropdown to the left (the dropdown is right-anchored),
// so the right edge never moves and cannot overflow the viewport.
const TOOLS_MENU_FLYOUTS: Record<string, Array<{ key: NavQuickToolKey; to: string; label: string; icon: typeof CalendarDays }>> = {
  calendars: [
    { key: 'create-calendar', to: '/calendar', label: 'Create Coordination Calendar', icon: CalendarPlus },
  ],
  mailbox: [
    { key: 'mailbox-people', to: '/mailbox?tab=people', label: 'People', icon: Users },
    { key: 'mailbox-invitations', to: '/mailbox?tab=invitations', label: 'Invitations', icon: UserPlus },
    { key: 'mailbox-settings', to: '/mailbox?tab=settings', label: 'Settings', icon: SlidersHorizontal },
  ],
  distribute: [
    { key: 'distribute-templates', to: '/distribute?tab=templates', label: 'Templates', icon: FileText },
    { key: 'distribute-scheduled', to: '/distribute?tab=scheduled', label: 'Scheduled', icon: Clock },
    { key: 'distribute-responses', to: '/distribute?tab=responses', label: 'Responses', icon: MessageSquare },
  ],
}

function isNavQuickToolKey(value: unknown): value is NavQuickToolKey {
  return typeof value === 'string' && (NAV_QUICK_TOOL_ORDER as string[]).includes(value)
}

function normalizeNavQuickTools(value: unknown): NavQuickToolKey[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<NavQuickToolKey>()
  const normalized: NavQuickToolKey[] = []
  for (const item of value) {
    if (!isNavQuickToolKey(item) || seen.has(item)) continue
    seen.add(item)
    normalized.push(item)
  }
  return normalized
}

function loadNavQuickTools(): NavQuickToolKey[] {
  try {
    const raw = localStorage.getItem(NAV_QUICK_TOOLS_KEY)
    if (!raw) return DEFAULT_NAV_QUICK_TOOLS
    const parsed = JSON.parse(raw)
    const normalized = normalizeNavQuickTools(parsed)
    return normalized.length ? normalized : DEFAULT_NAV_QUICK_TOOLS
  } catch {
    return DEFAULT_NAV_QUICK_TOOLS
  }
}

export default function Layout() {
  useEffect(bufferAiAssistantMessages, [])
  const location = useLocation()
  const pathnameRef = useRef(location.pathname)
  pathnameRef.current = location.pathname
  const fromCalendarView = location.pathname.startsWith('/calendar/')
  const shouldRenderMainBottomSpacer = location.pathname !== '/time-management'
  const shouldLockViewportScroll = location.pathname === '/time-management'
  const navigate = useNavigate()

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 })
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
  }, [location.pathname, location.search])
  const [showUserMenu, setShowUserMenu] = useState(false)
  const userMenuButtonRef = useRef<HTMLButtonElement>(null)
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const { navigationRef: mobileNavigationRef, maxHeight: mobileMenuMaxHeight } = useMobileMenuHeight(showMobileMenu)
  const [showMobileAccountMenu, setShowMobileAccountMenu] = useState(false)
  const [showToolsMenu, setShowToolsMenu] = useState(false)
  const [toolsFlyout, setToolsFlyout] = useState<string | null>(null)
  const [toolsFlyoutTop, setToolsFlyoutTop] = useState(0)
  const [showAssistanceMenu, setShowAssistanceMenu] = useState(false)
  const [showSignInMenu, setShowSignInMenu] = useState(false)
  // Cardano wallet picker state
  const [cardanoPickerMode, setCardanoPickerMode] = useState<null | 'wallets' | 'no-wallets'>(null)
  const [cardanoPickerWallets, setCardanoPickerWallets] = useState<WalletInfo[]>([])
  const [_creatingWallet, setCreatingWallet] = useState(false)
  const [createWalletError, setCreateWalletError] = useState<string | null>(null)
  const cardanoPickerOpen = cardanoPickerMode !== null
  const toolsMenuRef = useRef<HTMLDivElement>(null)
  const toolsHoverTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const toolsFlyoutTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const assistanceMenuRef = useRef<HTMLDivElement>(null)
  const assistanceHoverTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const userHoverTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const signInMenuRef = useRef<HTMLDivElement>(null)
  const signInHoverTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const navContentRef = useRef<HTMLDivElement>(null)
  const navQuickToolsRef = useRef<HTMLDivElement>(null)
  const navActionsRef = useRef<HTMLDivElement>(null)
  const previousNavWidthRef = useRef(0)
  
  const { user, isAuthenticated, isLoading: authLoading, isTraveler, login, loginAsTraveler, registerWithManagedWallet, logout, refreshProfile } = useAuth()

  const mailboxNotificationFlagKey = buildMailboxNotificationFlagKey(user?.id || 'guest')
  const [hasMailboxNotification, setHasMailboxNotification] = useState(false)

  useEffect(() => {
    setHasMailboxNotification(readMailboxNotificationFlag(mailboxNotificationFlagKey))

    const handleFlagChange = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; value: boolean }>).detail
      if (detail?.key !== mailboxNotificationFlagKey) return
      setHasMailboxNotification(detail.value)
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== mailboxNotificationFlagKey) return
      setHasMailboxNotification(readMailboxNotificationFlag(mailboxNotificationFlagKey))
    }

    window.addEventListener(MAILBOX_NOTIFICATION_FLAG_EVENT, handleFlagChange)
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener(MAILBOX_NOTIFICATION_FLAG_EVENT, handleFlagChange)
      window.removeEventListener('storage', handleStorage)
    }
  }, [mailboxNotificationFlagKey])

  // Background poll so the badge can light up from any page, not only while the Mailbox
  // page itself is mounted (that page also does its own faster, more precise check).
  useEffect(() => {
    if (!isAuthenticated || isTraveler) return

    let cancelled = false
    let fastSyncInFlight = false
    let lastFastSyncAt = 0

    const applyNotificationCheck = (result: { enabled?: unknown; hasNew?: unknown }): boolean => {
      const currentValue = readMailboxNotificationFlag(mailboxNotificationFlagKey)
      const nextValue = resolveMailboxNotificationFlagFromCheck(currentValue, result)
      if (nextValue !== currentValue) {
        writeMailboxNotificationFlag(mailboxNotificationFlagKey, nextValue)
      }
      if (result.hasNew === true) {
        // The badge alone is not enough: an open Mailbox page must also pull the new rows in.
        announceRemoteNewMail()
      }
      return result.enabled === false || result.hasNew === true
    }

    const syncNewMailForActiveUser = async (): Promise<boolean> => {
      if (fastSyncInFlight || document.visibilityState !== 'visible' || pathnameRef.current === '/mailbox') return false
      const nowMs = Date.now()
      if (nowMs - lastFastSyncAt < MAILBOX_ACTIVE_NEW_MAIL_SYNC_INTERVAL_MS) return false

      fastSyncInFlight = true
      lastFastSyncAt = nowMs
      try {
        const { data } = await dedupedGet<{ accounts?: Array<{ id?: unknown; status?: unknown }> }>('/api/mailbox/accounts')
        const accounts = Array.isArray(data?.accounts) ? data.accounts : []
        const activeAccounts = accounts.filter(
          (account: { id?: unknown; status?: unknown }) =>
            typeof account.id === 'string' && account.status !== 'disconnected'
        ) as Array<{ id: string }>
        if (activeAccounts.length === 0) return false

        await Promise.allSettled(
          activeAccounts.map((account) =>
            apiClient.post(
              `/api/mailbox/accounts/${account.id}/sync`,
              { new_mail_only: true },
              { timeout: 70_000 }
            )
          )
        )

        return true
      } finally {
        fastSyncInFlight = false
      }
    }

    const checkForNewMail = async () => {
      try {
        const { data } = await dedupedGet<{ enabled?: boolean; hasNew?: boolean; deferred?: boolean }>('/api/mailbox/notifications/check')
        if (!cancelled && applyNotificationCheck(data || {})) return

        if (cancelled || data?.deferred === true) return
        const didSync = await syncNewMailForActiveUser()
        if (!didSync || cancelled) return

        const refreshed = await dedupedGet<{ enabled?: boolean; hasNew?: boolean }>('/api/mailbox/notifications/check')
        if (!cancelled) applyNotificationCheck(refreshed.data || {})
      } catch {
        // Best-effort background poll; failures are silent and retried on the next tick.
      }
    }

    void checkForNewMail()
    const timer = setInterval(() => { void checkForNewMail() }, MAILBOX_NOTIFICATION_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [isAuthenticated, isTraveler, mailboxNotificationFlagKey])

  // Tools requiring a full account: redirect to login (or traveler upgrade) instead of navigating.
  const goToTool = useCallback((e: React.MouseEvent, path: string) => {
    if (!isAuthenticated || isTraveler) {
      e.preventDefault()
      sessionStorage.setItem('authReturnTo', path)
      navigate(isTraveler ? '/auth/login?upgrade=true' : '/auth/login')
    }
    setShowToolsMenu(false)
    setShowMobileMenu(false)
  }, [isAuthenticated, isTraveler, navigate])

  const handleCardanoWalletClick = useCallback(() => {
    setCreateWalletError(null)
    const updateWalletPicker = () => {
      const wallets = detectWallets()
      const installed = wallets.filter((w) => w.installed)
      setCardanoPickerWallets(installed)
      setCardanoPickerMode(installed.length > 0 ? 'wallets' : 'no-wallets')
      setShowSignInMenu(false)
      setShowMobileMenu(false)
    }

    // Retry a few times in case extensions inject after click.
    ;[0, 350, 1000, 2200].forEach((delay) => {
      setTimeout(updateWalletPicker, delay)
    })
  }, [])

  const _handleCreateManagedWallet = useCallback(async () => {
    setCreatingWallet(true)
    setCreateWalletError(null)
    try {
      const walletData = await generateManagedWallet()
      if (!isAuthenticated) {
        // Not logged in -- register a brand-new account with this wallet
        await registerWithManagedWallet(walletData)
      } else {
        // Already logged in -- attach wallet to existing account
        await apiClient.post('/api/auth/wallet/managed/create', {
          address: walletData.address,
          encryptedBlob: walletData.encryptedBlob,
          publicKey: walletData.publicKeyHex,
        })
        await refreshProfile()
      }
      setCardanoPickerMode(null)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create wallet'
      setCreateWalletError(msg)
    } finally {
      setCreatingWallet(false)
    }
  }, [isAuthenticated, registerWithManagedWallet, refreshProfile])
  const { showNavThemeToggle } = useTheme()
  const { captchaMode } = useCaptchaMode()
  const { status: setupStatus, shouldTakeOver: setupNeeded } = useSetup()

  // Admin block power — read from localStorage
  const isAdmin = user?.roles?.includes('admin')
  const [adminBlockPower, setAdminBlockPower] = useState(false)
  useEffect(() => {
    if (isAdmin) {
      try {
        const stored = localStorage.getItem('adminPowers')
        if (stored) setAdminBlockPower(!!JSON.parse(stored).blockPower)
      } catch { /* ignore */ }
    } else {
      setAdminBlockPower(false)
    }
  }, [isAdmin])

  // Listen for localStorage changes from other tabs
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === 'adminPowers' && isAdmin) {
        try {
          setAdminBlockPower(!!JSON.parse(e.newValue || '{}').blockPower)
        } catch { /* ignore */ }
      }
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [isAdmin])

  // Listen for admin power changes within the same tab
  useEffect(() => {
    const handler = (e: Event) => {
      if (isAdmin) {
        const detail = (e as CustomEvent).detail
        setAdminBlockPower(!!detail?.blockPower)
      }
    }
    window.addEventListener('adminPowersChanged', handler)
    return () => window.removeEventListener('adminPowersChanged', handler)
  }, [isAdmin])

  const [activePanel, setActivePanel] = useState<PanelId>(loadActivePanel)
  const leftEdgeTouchStartRef = useRef<number | null>(null)

  // Pinned "quick button" tools shown on the left side of the nav bar.
  const [navQuickTools, setNavQuickTools] = useState<NavQuickToolKey[]>(loadNavQuickTools)
  const visibleNavQuickTools = useMemo(
    () => navQuickTools.filter(key => isNavQuickToolVisible(key, !!isAdmin && adminBlockPower)),
    [navQuickTools, isAdmin, adminBlockPower],
  )
  const [animatedNavQuickTools, setAnimatedNavQuickTools] = useState<NavQuickToolKey[]>([])
  const [quickToolsLoaded, setQuickToolsLoaded] = useState(false)
  const [mobileExpandedTool, setMobileExpandedTool] = useState<string | null>(null)
  const quickToolsSaveChainRef = useRef(Promise.resolve())

  // The server sequence is shared by every signed-in device. Keep local storage
  // as an offline fallback for guests and temporary API failures.
  useEffect(() => {
    if (!isAuthenticated) {
      setQuickToolsLoaded(true)
      return
    }

    let cancelled = false
    setQuickToolsLoaded(false)
    dedupedGet<{ toolKeys?: unknown }>('/api/quick-tools')
      .then((response) => {
        if (cancelled) return
        const serverKeys = Array.isArray(response.data?.toolKeys)
          ? normalizeNavQuickTools(response.data.toolKeys)
          : null
        if (serverKeys !== null) setNavQuickTools(serverKeys)
        setQuickToolsLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setQuickToolsLoaded(true)
      })

    return () => {
      cancelled = true
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (!quickToolsLoaded) return
    try {
      localStorage.setItem(NAV_QUICK_TOOLS_KEY, JSON.stringify(navQuickTools))
    } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('quickToolsChanged', { detail: { toolKeys: navQuickTools } }))
    if (isAuthenticated) {
      quickToolsSaveChainRef.current = quickToolsSaveChainRef.current
        .catch(() => undefined)
        .then(async () => {
          await apiClient.put('/api/quick-tools', { toolKeys: navQuickTools })
        })
        .catch(() => undefined)
    }
  }, [isAuthenticated, navQuickTools, quickToolsLoaded])

  const toggleNavQuickTool = useCallback((toolKey: NavQuickToolKey) => {
    if (!navQuickTools.includes(toolKey)) {
      setAnimatedNavQuickTools((previous) => (
        previous.includes(toolKey) ? previous : [...previous, toolKey]
      ))
    }
    setNavQuickTools((prev) => (
      prev.includes(toolKey) ? prev.filter((key) => key !== toolKey) : [...prev, toolKey]
    ))
  }, [navQuickTools])

  // Lets the Mailbox notifications settings panel request a pin without duplicating the
  // localStorage + server persistence this component already owns for quick tools.
  useEffect(() => {
    const handleRequestPin = () => {
      if (!navQuickTools.includes('mailbox')) toggleNavQuickTool('mailbox')
    }
    window.addEventListener(MAILBOX_REQUEST_PIN_EVENT, handleRequestPin)
    return () => window.removeEventListener(MAILBOX_REQUEST_PIN_EVENT, handleRequestPin)
  }, [navQuickTools, toggleNavQuickTool])

  // Close the sub-page flyout whenever the Tools dropdown itself closes.
  useEffect(() => {
    if (!showToolsMenu) setToolsFlyout(null)
  }, [showToolsMenu])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('rightPanelChanged', { detail: { activePanel } }))
    try {
      if (activePanel) {
        sessionStorage.setItem(ACTIVE_PANEL_KEY, activePanel)
      } else {
        sessionStorage.removeItem(ACTIVE_PANEL_KEY)
      }
    } catch { /* ignore */ }
  }, [activePanel])

  // ─── Zoom integration check (for Traveler quick link) ─────
  const [travelerHasZoom, setTravelerHasZoom] = useState(false)
  useEffect(() => {
    if (!isAuthenticated || !isTraveler) { setTravelerHasZoom(false); return }
    apiClient.get('/api/zoom/integration')
      .then(res => setTravelerHasZoom(!!res.data?.integration?.is_active))
      .catch(() => setTravelerHasZoom(false))
  }, [isAuthenticated, isTraveler])

  // ─── API health check ─────────────────────────────────────
  const [apiDown, setApiDown] = useState(false)
  const apiFailCount = useRef(0)
  const healthInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  const startHealthCheck = useCallback(() => {
    if (healthInterval.current) clearInterval(healthInterval.current)
    const check = async () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return
      }
      try {
        await dedupedGet('/health', { timeout: 8000 })
        apiFailCount.current = 0
        setApiDown(false)
      } catch {
        apiFailCount.current += 1
        // Show banner after 2 consecutive failures to avoid false positives
        if (apiFailCount.current >= 2) setApiDown(true)
      }
    }
    check()
    healthInterval.current = setInterval(check, 30_000) // check every 30s

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void check()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    const cleanup = startHealthCheck()
    return () => {
      if (healthInterval.current) clearInterval(healthInterval.current)
      cleanup?.()
    }
  }, [startHealthCheck])

  // ─── Rate-limit soft warning ───────────────────────────────
  const [rateLimitWarn, setRateLimitWarn] = useState(false)
  const [rateLimitSince, setRateLimitSince] = useState<string | null>(null)

  // Restore only a recent warning, never an old incident as current demand.
  useEffect(() => {
    if (!isAdmin) return
    const persisted = getPersistedRateLimitWarn()
    if (persisted.active) {
      setRateLimitWarn(true)
      setRateLimitSince(persisted.since)
    }
  }, [isAdmin])

  useEffect(() => {
    if (!rateLimitWarn || !rateLimitSince) return
    const remaining = Math.max(0, Date.parse(rateLimitSince) + RATE_LIMIT_WARN_TTL_MS - Date.now())
    const timer = window.setTimeout(() => {
      setRateLimitWarn(false)
      setRateLimitSince(null)
    }, remaining)
    return () => window.clearTimeout(timer)
  }, [rateLimitWarn, rateLimitSince])

  // Listen for live warning events
  useEffect(() => {
    const handler = (e: Event) => {
      const warn = !!(e as CustomEvent).detail?.warn
      if (warn) {
        setRateLimitWarn(true)
        const persisted = getPersistedRateLimitWarn()
        setRateLimitSince(persisted.since)
      } else {
        setRateLimitWarn(false)
        setRateLimitSince(null)
      }
    }
    window.addEventListener(RATE_LIMIT_WARN_EVENT, handler)
    return () => window.removeEventListener(RATE_LIMIT_WARN_EVENT, handler)
  }, [isAdmin])

  // ─── New friend connections alert ──────────────────────────
  const [newFriendCount, setNewFriendCount] = useState(0)
  useEffect(() => {
    if (!isAuthenticated || isTraveler) { setNewFriendCount(0); return }
    const check = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return
      }
      const since = localStorage.getItem('lastFriendSeenAt') || new Date(0).toISOString()
      apiClient.get('/api/connections/new-count', { params: { since } })
        .then(res => setNewFriendCount(res.data.count || 0))
        .catch(() => {})
    }
    check()
    const interval = setInterval(check, 60_000) // check every minute

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        check()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [isAuthenticated, isTraveler])
  const [activeEventFlagCount, setActiveEventFlagCount] = useState(0)
  useEffect(() => {
    if (!isAuthenticated) { setActiveEventFlagCount(0); return }
    const check = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      apiClient.get('/api/event-flags/active-count')
        .then(response => setActiveEventFlagCount(response.data.count || 0))
        .catch(() => {})
    }
    check()
    const interval = setInterval(check, 60_000)
    window.addEventListener('eventFlagsChanged', check)
    return () => {
      clearInterval(interval)
      window.removeEventListener('eventFlagsChanged', check)
    }
  }, [isAuthenticated])
  const aiPanelOpen = activePanel === 'ai'
  
  // Listen for requests to open the AI panel from child pages
  useEffect(() => {
    const handler = () => setActivePanel(prev => prev === 'ai' ? null : 'ai')
    window.addEventListener('openAiPanel', handler)
    return () => window.removeEventListener('openAiPanel', handler)
  }, [])

  // Listen for requests to open the Feedback panel from child pages
  useEffect(() => {
    const handler = () => setActivePanel(prev => prev === 'feedback' ? null : 'feedback')
    window.addEventListener('openFeedbackPanel', handler)
    return () => window.removeEventListener('openFeedbackPanel', handler)
  }, [])

  // Listen for requests to open the Chat panel from child pages
  useEffect(() => {
    const handler = () => setActivePanel(prev => prev === 'chat' ? null : 'chat')
    window.addEventListener('openChatPanel', handler)
    return () => window.removeEventListener('openChatPanel', handler)
  }, [])

  // Listen for requests to open the Support panel from child pages
  useEffect(() => {
    const handler = () => setActivePanel(prev => prev === 'support' ? null : 'support')
    window.addEventListener('openSupportPanel', handler)
    return () => window.removeEventListener('openSupportPanel', handler)
  }, [])

  useEffect(() => {
    const handler = () => {
      if (location.pathname !== '/coordinate-events') {
        navigate('/coordinate-events', { state: { openCommons: true } })
      }
      setActivePanel('commons')
    }
    window.addEventListener('openCommonsPanel', handler)
    return () => window.removeEventListener('openCommonsPanel', handler)
  }, [location.pathname, navigate])

  useEffect(() => {
    if (location.state?.openCommons) {
      setActivePanel('commons')
    }
  }, [location.state])

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      const node = target instanceof Node ? target : null
      const element = node instanceof HTMLElement ? node : node?.parentElement
      if (!(element instanceof HTMLElement)) return false
      const tagName = element.tagName.toLowerCase()
      if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return true
      return element.isContentEditable
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (event.defaultPrevented) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (activePanel === null) return
      if (isEditableTarget(event.target)) return

      event.preventDefault()
      setActivePanel(null)
    }

    // Capture-phase ensures global right-panel close runs before page-level
    // Escape handlers, so panel-closing is always the first action.
    window.addEventListener('keydown', handleEscape, true)
    return () => window.removeEventListener('keydown', handleEscape, true)
  }, [activePanel])

  // Allow page-level Esc handlers to close global right-side panels first.
  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<{ closed?: boolean }>
      if (activePanel === null) {
        if (customEvent.detail) customEvent.detail.closed = false
        return
      }
      if (customEvent.detail) customEvent.detail.closed = true
      setActivePanel(null)
    }

    window.addEventListener('closeRightSidebarPanels', handler)
    return () => window.removeEventListener('closeRightSidebarPanels', handler)
  }, [activePanel])

  const [isCompactNav, setIsCompactNav] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 768 : false)
  const [navQuickWordCounts, setNavQuickWordCounts] = useState<Record<NavQuickToolKey, number>>(getNavQuickWordCounts)
  const navQuickWordCountsRef = useRef<Record<NavQuickToolKey, number>>(getNavQuickWordCounts())
  useLayoutEffect(() => {
    const fullWordCounts = getNavQuickWordCounts()
    navQuickWordCountsRef.current = fullWordCounts
    setNavQuickWordCounts(fullWordCounts)
  }, [navQuickTools])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleResize = () => {
      const navWidth = navContentRef.current?.getBoundingClientRect().width ?? window.innerWidth
      const quickTools = navQuickToolsRef.current
      const quickToolsOverflow = quickTools !== null && quickTools.scrollWidth > quickTools.clientWidth
      const navWidthGrew = navWidth > previousNavWidthRef.current + 1

      previousNavWidthRef.current = navWidth
      setIsCompactNav(window.innerWidth < 768)
      if (navWidthGrew) {
        const fullWordCounts = getNavQuickWordCounts()
        navQuickWordCountsRef.current = fullWordCounts
        setNavQuickWordCounts(fullWordCounts)
        requestAnimationFrame(handleResize)
        return
      }
      if (!quickToolsOverflow) return

      const longestLabel = visibleNavQuickTools.reduce<NavQuickToolKey | null>((longest, key) => {
        if (longest === null || navQuickWordCountsRef.current[key] > navQuickWordCountsRef.current[longest]) {
          return key
        }
        return longest
      }, null)
      if (longestLabel === null || navQuickWordCountsRef.current[longestLabel] === 0) return

      const nextWordCounts = {
        ...navQuickWordCountsRef.current,
        [longestLabel]: navQuickWordCountsRef.current[longestLabel] - 1,
      }
      navQuickWordCountsRef.current = nextWordCounts
      setNavQuickWordCounts(nextWordCounts)
      requestAnimationFrame(handleResize)
    }

    handleResize()
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(handleResize) : null
    if (navContentRef.current && resizeObserver) resizeObserver.observe(navContentRef.current)
    if (navQuickToolsRef.current && resizeObserver) resizeObserver.observe(navQuickToolsRef.current)
    if (navActionsRef.current && resizeObserver) resizeObserver.observe(navActionsRef.current)
    window.addEventListener('resize', handleResize)
    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', handleResize)
    }
  }, [visibleNavQuickTools])

  useEffect(() => {
    const el = navQuickToolsRef.current
    if (!el) return
    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY === 0 || el.scrollWidth <= el.clientWidth) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [])

  const isActive = (path: string) => location.pathname === path
  const isActiveRoute = (to: string) => {
    const [path, query] = to.split('?')
    return isActive(path) && (!query || location.search === `?${query}`)
  }

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target as Node)) {
        setShowToolsMenu(false)
      }
      if (assistanceMenuRef.current && !assistanceMenuRef.current.contains(e.target as Node)) {
        setShowAssistanceMenu(false)
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false)
      }
      if (signInMenuRef.current && !signInMenuRef.current.contains(e.target as Node)) {
        setShowSignInMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleLogout = async () => {
    setShowUserMenu(false)
    setShowMobileMenu(false)
    setShowMobileAccountMenu(false)
    try {
      await logout()
    } catch {
      // logout() already handles cleanup; navigate regardless
    }
    navigate('/')
  }

  useEffect(() => {
    if (!shouldLockViewportScroll) return

    const root = document.documentElement
    const body = document.body
    const previous = {
      rootOverflow: root.style.overflow,
      bodyOverflow: body.style.overflow,
      rootHeight: root.style.height,
      bodyHeight: body.style.height,
    }

    root.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    root.style.height = '100%'
    body.style.height = '100%'

    return () => {
      root.style.overflow = previous.rootOverflow
      body.style.overflow = previous.bodyOverflow
      root.style.height = previous.rootHeight
      body.style.height = previous.bodyHeight
    }
  }, [shouldLockViewportScroll])

  return (
    <AiAssistantProvider>
    <div className={`flex min-h-screen bg-background text-foreground ${shouldLockViewportScroll ? 'overflow-hidden' : ''}`}>
      <div
        className="fixed inset-y-0 left-0 z-20 w-3 md:hidden"
        aria-hidden
        onTouchStart={(event) => {
          if (showMobileMenu || showMobileAccountMenu) return
          const touch = event.touches[0]
          if (touch.clientX > 24) return
          leftEdgeTouchStartRef.current = touch.clientX
        }}
        onTouchEnd={(event) => {
          if (leftEdgeTouchStartRef.current === null) return
          const touch = event.changedTouches[0]
          const delta = touch.clientX - leftEdgeTouchStartRef.current
          leftEdgeTouchStartRef.current = null
          if (delta > 48) {
            setShowMobileAccountMenu(false)
            setShowMobileMenu(true)
          }
        }}
      />

      {/* LEFT PANEL SLOT -- Portal target for page-level left panels */}
      <LeftPanelSlot />

      {/* Main content column -- shrinks when a side panel opens */}
      <div className={`flex flex-1 min-w-0 flex-col ${shouldLockViewportScroll ? 'min-h-0 overflow-hidden' : ''}`}>
      {apiDown && (
        <div className="bg-destructive/90 text-destructive-foreground px-4 py-2 text-center text-sm font-medium flex items-center justify-center gap-2">
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>Unable to reach the server. Some features may not work as expected.</span>
          <button
            onClick={() => {
              apiFailCount.current = 0
              setApiDown(false)
              startHealthCheck()
            }}
            className="ml-2 underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}
      {rateLimitWarn && !apiDown && (
        <div role="status" data-testid="request-limit-warning" className="bg-warning text-warning-foreground px-4 py-2 text-center text-sm font-medium flex items-center justify-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-warning-foreground" />
          <span>
            This connection is approaching an API request limit. Some actions may be temporarily delayed; this does not indicate high server traffic.
            {isAdmin && rateLimitSince && (
              <span className="ml-1">
                (last detected {formatDateInTimezone(rateLimitSince, getPrimaryTimezone()).replace(/,? \d{4}$/, '')}{' '}
                {formatTimeInTimezone(rateLimitSince, getPrimaryTimezone())})
              </span>
            )}
          </span>
          <button
            onClick={() => {
              setRateLimitWarn(false)
              setRateLimitSince(null)
              if (isAdmin) {
                try { localStorage.removeItem('rateLimitWarnAt') } catch { /* ignore */ }
              }
            }}
            className="ml-2 underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}
      <nav
        ref={mobileNavigationRef}
        data-app-nav=""
        className={`relative ${SHELL_LAYER_CLASS.nav} border-b border-border bg-background`}
        onClickCapture={(event) => {
          if (dismissPanelsForMobileNavigation(event.target)) setActivePanel(null)
        }}
        onKeyDownCapture={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          if (!(event.target instanceof Element) || !event.target.matches('[role="button"], [role="menuitem"]')) return
          if (dismissPanelsForMobileNavigation(event.target)) setActivePanel(null)
        }}
      >
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <div ref={navContentRef} className="flex items-center justify-between h-14 md:h-16">
            <div className={`flex flex-1 items-center min-w-0 ${isCompactNav ? 'gap-2' : 'gap-4 md:gap-6 xl:gap-8'}`}>
              <Link to="/" className="hidden md:flex items-center gap-2" aria-label="Coordination Manager home" title="Coordination Manager">
                <Home className="h-5 w-5 md:h-6 md:w-6" />
                <span className={`${isCompactNav ? 'sr-only' : 'hidden xl:inline'} font-semibold text-base md:text-lg`}>Coordination Manager</span>
              </Link>

              <div className="flex items-center gap-1 md:hidden">
                <IconButton
                  label={showMobileMenu ? 'Close navigation menu' : 'Open navigation menu'}
                  icon={showMobileMenu ? <X /> : <Menu />}
                  size="standard"
                  showTitle={false}
                  onClick={() => {
                    setShowMobileAccountMenu(false)
                    setShowMobileMenu((prev) => !prev)
                  }}
                />

                <div className="scrollbar-none flex max-w-[calc(100vw-7rem)] items-center gap-0.5 overflow-x-auto rounded-full border border-border bg-card/80 px-1 py-1">
                  {visibleNavQuickTools.map((key) => {
                    const meta = NAV_TOOL_META[key]
                    const Icon = meta.icon
                    const itemClass = `${animatedNavQuickTools.includes(key) ? 'animate-calendar-quick-add ' : ''}flex h-9 w-9 shrink-0 items-center justify-center rounded-full p-2 transition-colors ${
                      meta.panel
                        ? activePanel === key
                          ? 'bg-accent text-accent-foreground'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                        : isActive(meta.to)
                          ? 'bg-accent text-accent-foreground'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                    }`

                    if (meta.panel) {
                      const panelKey = key as Exclude<PanelId, null>
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => {
                            if (panelKey === 'commons') {
                              if (activePanel === 'commons') {
                                setActivePanel(null)
                              } else {
                                window.dispatchEvent(new Event('openCommonsPanel'))
                              }
                            } else {
                              setActivePanel(activePanel === panelKey ? null : panelKey)
                            }
                          }}
                          className={itemClass}
                          aria-label={meta.label}
                          title={meta.label}
                        >
                          <Icon className="h-4 w-4" />
                        </button>
                      )
                    }

                    if (meta.external || meta.to.startsWith('http')) {
                      return (
                        <a
                          key={key}
                          href={meta.to}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={itemClass}
                          aria-label={meta.label}
                          title={meta.label}
                        >
                          <Icon className="h-4 w-4" />
                        </a>
                      )
                    }

                    return (
                      <Link
                        key={key}
                        to={meta.to}
                        state={key === 'calendars' && fromCalendarView ? { fromCalendarView: true } : undefined}
                        onClick={meta.needsAuth ? (event) => goToTool(event, meta.to) : undefined}
                        className={`relative ${itemClass}`}
                        aria-label={meta.label}
                        title={meta.label}
                      >
                        <Icon className="h-4 w-4" />
                        {key === 'mailbox' && hasMailboxNotification && (
                          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-danger" aria-hidden="true" />
                        )}
                      </Link>
                    )
                  })}
                  {showNavThemeToggle && (
                    <Link
                      to={THEME_SETTINGS_PATH}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full p-2 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-accent-foreground"
                      aria-label="Theme settings"
                      title="Theme settings"
                    >
                      <Palette className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  )}
                </div>
              </div>

              {/* Desktop nav links - left side: pinned "quick button" tools (see Tools / Assistance dropdowns) */}
              <div
                ref={navQuickToolsRef}
                className="scrollbar-none hidden md:flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
              >
                {visibleNavQuickTools.map((key) => {
                  const meta = NAV_TOOL_META[key]
                  const Icon = meta.icon
                  const quickLabel = getNavQuickLabel(key, navQuickWordCounts[key])

                  if (meta.panel) {
                    const panelKey = key as Exclude<PanelId, null>
                    const isOpenPanel = activePanel === panelKey
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          if (panelKey === 'commons') {
                            if (isOpenPanel) {
                              setActivePanel(null)
                            } else {
                              window.dispatchEvent(new Event('openCommonsPanel'))
                            }
                          } else {
                            setActivePanel((prev) => (prev === panelKey ? null : panelKey))
                          }
                        }}
                        className={`${animatedNavQuickTools.includes(key) ? 'animate-calendar-quick-add ' : ''}shrink-0 px-2 xl:px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                          isOpenPanel
                            ? 'bg-accent text-accent-foreground'
                            : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                        }`}
                        aria-label={meta.label}
                        title={meta.label}
                      >
                        <span className="flex items-center gap-1.5 whitespace-nowrap">
                          <Icon className="w-4 h-4" />
                          {quickLabel && <span>{quickLabel}</span>}
                        </span>
                      </button>
                    )
                  }

                  if (meta.external || meta.to.startsWith('http')) {
                    return (
                      <a
                        key={key}
                        href={meta.to}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`${animatedNavQuickTools.includes(key) ? 'animate-calendar-quick-add ' : ''}shrink-0 px-2 xl:px-3 py-2 rounded-md text-sm font-medium transition-colors text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground`}
                        aria-label={meta.label}
                        title={meta.label}
                      >
                        <span className="flex items-center gap-1.5 whitespace-nowrap">
                          <Icon className="w-4 h-4" />
                          {quickLabel && <span>{quickLabel}</span>}
                        </span>
                      </a>
                    )
                  }

                  return (
                    <Link
                      key={key}
                      to={meta.to}
                      state={key === 'calendars' && fromCalendarView ? { fromCalendarView: true } : undefined}
                      onClick={meta.needsAuth ? (e) => goToTool(e, meta.to) : undefined}
                      className={`${animatedNavQuickTools.includes(key) ? 'animate-calendar-quick-add ' : ''}shrink-0 px-2 xl:px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                        isActive(meta.to)
                          ? 'bg-accent text-accent-foreground'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                      }`}
                      aria-label={meta.label}
                      title={meta.label}
                    >
                      <span className="flex items-center gap-1.5 whitespace-nowrap">
                        <span className="relative inline-flex">
                          <Icon className="w-4 h-4" />
                          {key === 'mailbox' && hasMailboxNotification && (
                            <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-danger" aria-hidden="true" />
                          )}
                        </span>
                        {quickLabel && <span>{quickLabel}</span>}
                      </span>
                    </Link>
                  )
                })}
              </div>
            </div>
            
            {/* Right side: Tools + Feedback + Theme button + User Menu + Mobile hamburger */}
            <div ref={navActionsRef} className="flex shrink-0 items-center gap-1 md:gap-2">
              {/* Desktop nav links - right side */}
              <div className="hidden md:flex items-center gap-1">
                {/* Setup button -- only visible on dev / localhost. Hidden on the
                    public production deployment so it does not advertise the
                    /setup route or /api/setup/* endpoints to public users. */}
                {isSetupAccessible() && (
                  <Link
                    to="/setup"
                    className={`relative flex items-center gap-1 px-2 xl:px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      isActive('/setup')
                        ? 'bg-accent text-accent-foreground'
                        : setupNeeded
                          ? 'text-warning bg-warning-subtle ring-1 ring-warning-muted hover:bg-warning-muted'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                    }`}
                    title={
                      setupNeeded
                        ? 'Setup required'
                        : setupStatus
                          ? `Mode: ${setupStatus.mode}`
                          : 'Setup'
                    }
                    aria-label="Setup"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    <span className={isCompactNav ? 'sr-only' : 'inline'}>Setup</span>
                  </Link>
                )}

                {/* Tools dropdown */}
                <div
                  className="relative"
                  ref={toolsMenuRef}
                  onMouseEnter={() => { clearTimeout(toolsHoverTimeout.current); setShowToolsMenu(true) }}
                  onMouseLeave={() => { toolsHoverTimeout.current = setTimeout(() => setShowToolsMenu(false), 150) }}
                >
                  <button
                    className={`flex items-center gap-1 px-2 xl:px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      isActive('/events-calendar') || isActive('/calendars') || isActive('/calendar') || isActive('/time-management') || isActive('/mailbox') || isActive('/distribute') || isActive('/coordinate-events') || isActive('/guardian') || isActive('/admin/users') || isActive('/admin/oversight')
                        ? 'bg-accent/30 text-foreground'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                    }`}
                    aria-label="Tools"
                    title="Tools"
                  >
                    <Wrench className="h-3.5 w-3.5" />
                    <span className={isCompactNav ? 'sr-only' : 'inline'}>Tools</span>
                    <ChevronDown className={isCompactNav ? 'sr-only' : 'inline h-3.5 w-3.5'} />
                  </button>
                  {showToolsMenu && (
                    // Wrapper is a zero-size positioning anchor; both boxes below are absolutely
                    // positioned against it so the main list never shifts when the flyout appears.
                    <div className={`absolute right-0 mt-1 ${OVERLAY_LAYER_CLASS.popover}`}>
                      <div className="absolute right-0 top-0 w-72 bg-popover text-popover-foreground rounded-lg shadow-lg border border-border py-1">
                      <Link
                        to="/events-calendar"
                        onClick={() => setShowToolsMenu(false)}
                        className={`flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${
                          isActive('/events-calendar')
                            ? 'bg-accent/30 text-foreground'
                            : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                        }`}
                      >
                        <QuickPinButton pinned={navQuickTools.includes('events-calendar')} onToggle={() => toggleNavQuickTool('events-calendar')} label="All Public Events" />
                        <CalendarDays className="h-4 w-4" />
                        All Public Events
                      </Link>
                      <Link
                        to="/calendars"
                        state={fromCalendarView ? { fromCalendarView: true } : undefined}
                        onClick={() => setShowToolsMenu(false)}
                        onMouseEnter={(e) => { clearTimeout(toolsFlyoutTimeout.current); setToolsFlyout('calendars'); setToolsFlyoutTop(e.currentTarget.offsetTop) }}
                        onMouseLeave={() => { toolsFlyoutTimeout.current = setTimeout(() => setToolsFlyout((prev) => (prev === 'calendars' ? null : prev)), 150) }}
                        className={`flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${
                          isActive('/calendars')
                            ? 'bg-accent/30 text-foreground'
                            : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                        }`}
                      >
                        <QuickPinButton pinned={navQuickTools.includes('calendars')} onToggle={() => toggleNavQuickTool('calendars')} label="Coordination Calendars" />
                        <Calendar className="h-4 w-4" />
                        Coordination Calendars
                        <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </Link>
                      <div className="border-t border-border my-1" />
                      <Link
                        to="/time-management"
                        onClick={() => setShowToolsMenu(false)}
                        className={`flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${
                          isActive('/time-management')
                            ? 'bg-accent/30 text-foreground'
                            : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                        }`}
                      >
                        <QuickPinButton pinned={navQuickTools.includes('time-management')} onToggle={() => toggleNavQuickTool('time-management')} label="Time Management" />
                        <CalendarClock className="h-4 w-4" />
                        Time Management
                        <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
                          NEW
                        </span>
                      </Link>
                      <Link
                        to="/mailbox"
                        onClick={(e) => goToTool(e, '/mailbox')}
                        onMouseEnter={(e) => { clearTimeout(toolsFlyoutTimeout.current); setToolsFlyout('mailbox'); setToolsFlyoutTop(e.currentTarget.offsetTop) }}
                        onMouseLeave={() => { toolsFlyoutTimeout.current = setTimeout(() => setToolsFlyout((prev) => (prev === 'mailbox' ? null : prev)), 150) }}
                        className={`flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${
                          isActive('/mailbox')
                            ? 'bg-accent/30 text-foreground'
                            : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                        }`}
                      >
                        <QuickPinButton pinned={navQuickTools.includes('mailbox')} onToggle={() => toggleNavQuickTool('mailbox')} label="Mailbox" />
                        <Inbox className="h-4 w-4" />
                        Mailbox
                        <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
                          NEW
                        </span>
                        <ChevronRight className="ml-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </Link>
                      <Link
                        to="/distribute"
                        onClick={(e) => goToTool(e, '/distribute')}
                        onMouseEnter={(e) => { clearTimeout(toolsFlyoutTimeout.current); setToolsFlyout('distribute'); setToolsFlyoutTop(e.currentTarget.offsetTop) }}
                        onMouseLeave={() => { toolsFlyoutTimeout.current = setTimeout(() => setToolsFlyout((prev) => (prev === 'distribute' ? null : prev)), 150) }}
                        className={`flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${
                          isActive('/distribute')
                            ? 'bg-accent/30 text-foreground'
                            : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                        }`}
                      >
                        <QuickPinButton pinned={navQuickTools.includes('distribute')} onToggle={() => toggleNavQuickTool('distribute')} label="Distribute Messages" />
                        <Megaphone className="h-4 w-4" />
                        Distribute Messages
                        <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </Link>
                      <Link
                        to="/coordinate-events"
                        onClick={(e) => goToTool(e, '/coordinate-events')}
                        className={`flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${
                          isActive('/coordinate-events')
                            ? 'bg-accent/30 text-foreground'
                            : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                        }`}
                      >
                        <QuickPinButton pinned={navQuickTools.includes('coordinate-events')} onToggle={() => toggleNavQuickTool('coordinate-events')} label="Coordinate Events" />
                        <CalendarDays className="h-4 w-4" />
                        Coordinate Events
                      </Link>
                      <div className="border-t border-border my-1" />
                      <Link
                        to="/guardian"
                        onClick={(e) => goToTool(e, '/guardian')}
                        className={`flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${
                          isActive('/guardian')
                            ? 'bg-danger-subtle text-danger'
                            : 'text-danger hover:bg-danger-subtle'
                        }`}
                      >
                        <QuickPinButton pinned={navQuickTools.includes('guardian')} onToggle={() => toggleNavQuickTool('guardian')} label="Discord Guardian" />
                        <Shield className="h-4 w-4" />
                        Discord Guardian
                      </Link>
                      {adminBlockPower && (
                        <>
                          <div className="border-t border-border my-1" />
                          <Link
                            to="/admin/oversight"
                            onClick={() => setShowToolsMenu(false)}
                            className={`flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${
                              isActive('/admin/oversight')
                                ? 'bg-accent/30 text-foreground'
                                : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                            }`}
                          >
                            <QuickPinButton pinned={navQuickTools.includes('admin-oversight')} onToggle={() => toggleNavQuickTool('admin-oversight')} label="Platform Oversight" />
                            <Eye className="h-4 w-4" />
                            Platform Oversight
                          </Link>
                          <Link
                            to="/admin/users"
                            onClick={() => setShowToolsMenu(false)}
                            className={`flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${
                              isActive('/admin/users')
                                ? 'bg-accent/30 text-foreground'
                                : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                            }`}
                          >
                            <QuickPinButton pinned={navQuickTools.includes('admin-users')} onToggle={() => toggleNavQuickTool('admin-users')} label="User List" />
                            <Users className="h-4 w-4" />
                            User List
                          </Link>
                        </>
                      )}
                      </div>
                      {toolsFlyout && TOOLS_MENU_FLYOUTS[toolsFlyout] && (
                        <div
                          className="absolute left-1 w-64 bg-popover text-popover-foreground rounded-lg shadow-lg border border-border py-1"
                          style={{ top: toolsFlyoutTop }}
                          onMouseEnter={() => clearTimeout(toolsFlyoutTimeout.current)}
                          onMouseLeave={() => { toolsFlyoutTimeout.current = setTimeout(() => setToolsFlyout(null), 150) }}
                        >
                          <p className="px-4 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Related pages
                          </p>
                          {TOOLS_MENU_FLYOUTS[toolsFlyout].map((sub) => {
                            const SubIcon = sub.icon
                            const needsAuth = toolsFlyout === 'mailbox' || toolsFlyout === 'distribute'
                            return (
                              <Link
                                key={sub.key}
                                to={sub.to}
                                onClick={needsAuth ? (e) => goToTool(e, sub.to) : () => setShowToolsMenu(false)}
                                className={`flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${
                                  isActiveRoute(sub.to)
                                    ? 'bg-accent/30 text-foreground'
                                    : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                                }`}
                              >
                                <QuickPinButton pinned={navQuickTools.includes(sub.key)} onToggle={() => toggleNavQuickTool(sub.key)} label={sub.label} />
                                <SubIcon className="h-4 w-4" />
                                {sub.label}
                              </Link>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Assistance dropdown -- opens the right side panels (replaces the old floating bubbles) */}
                <div
                  className="relative"
                  ref={assistanceMenuRef}
                  onMouseEnter={() => { clearTimeout(assistanceHoverTimeout.current); setShowAssistanceMenu(true) }}
                  onMouseLeave={() => { assistanceHoverTimeout.current = setTimeout(() => setShowAssistanceMenu(false), 150) }}
                  onFocus={() => { clearTimeout(assistanceHoverTimeout.current); setShowAssistanceMenu(true) }}
                  onBlur={() => { assistanceHoverTimeout.current = setTimeout(() => setShowAssistanceMenu(false), 150) }}
                >
                  <button
                    type="button"
                    className={`flex items-center gap-1 px-2 xl:px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-default ${
                      activePanel !== null
                        ? 'bg-accent/30 text-foreground'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                    }`}
                    aria-haspopup="menu"
                    aria-expanded={showAssistanceMenu}
                    aria-label="Assistance"
                    title="Assistance"
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                    <span className={isCompactNav ? 'sr-only' : 'inline'}>Assistance</span>
                    <ChevronDown className={isCompactNav ? 'sr-only' : 'inline h-3.5 w-3.5'} />
                  </button>
                  {showAssistanceMenu && (
                    <div role="menu" className={`absolute right-0 mt-1 w-72 bg-popover text-popover-foreground rounded-lg shadow-lg border border-border py-1 ${OVERLAY_LAYER_CLASS.popover}`}>
                      {ASSISTANCE_OPTIONS.map(option => {
                        const Icon = option.icon
                        const isOpenPanel = option.panel ? activePanel === option.id : false

                        if (option.to) {
                          return (
                            <a
                              key={option.id}
                              href={option.to}
                              target="_blank"
                              rel="noopener noreferrer"
                              role="menuitem"
                              onClick={() => setShowAssistanceMenu(false)}
                              className="w-full flex items-start gap-2.5 px-4 py-2.5 text-left text-sm transition-colors hover:bg-accent/50"
                            >
                              <QuickPinButton pinned={navQuickTools.includes(option.id)} onToggle={() => toggleNavQuickTool(option.id)} label={option.label} className="mt-0.5 shrink-0" />
                              <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${option.iconClass}`} />
                              <span className="flex flex-col">
                                <span className="font-medium flex items-center gap-1">
                                  {option.label}
                                  <ExternalLink className="h-3 w-3 text-muted-foreground opacity-70" />
                                </span>
                                <span className="text-xs text-muted-foreground">{option.description}</span>
                              </span>
                            </a>
                          )
                        }

                        return (
                          <div
                            key={option.id}
                            role="menuitem"
                            tabIndex={0}
                            onClick={() => {
                              const nextPanel = isOpenPanel ? null : (option.id as Exclude<PanelId, null>)
                              if (nextPanel === 'commons' && location.pathname !== '/coordinate-events') {
                                navigate('/coordinate-events')
                              }
                              setActivePanel(nextPanel)
                              setShowAssistanceMenu(false)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                const nextPanel = isOpenPanel ? null : (option.id as Exclude<PanelId, null>)
                                if (nextPanel === 'commons' && location.pathname !== '/coordinate-events') {
                                  navigate('/coordinate-events')
                                }
                                setActivePanel(nextPanel)
                                setShowAssistanceMenu(false)
                              }
                            }}
                            className={`w-full flex items-start gap-2.5 px-4 py-2.5 text-left text-sm cursor-pointer transition-colors ${
                              isOpenPanel ? 'bg-accent/30 text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                            }`}
                          >
                            <QuickPinButton pinned={navQuickTools.includes(option.id)} onToggle={() => toggleNavQuickTool(option.id)} label={option.label} className="mt-0.5 shrink-0" />
                            <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${option.iconClass}`} />
                            <span className="flex flex-col">
                              <span className="font-medium">{option.label}</span>
                              <span className="text-xs text-muted-foreground">{option.description}</span>
                            </span>
                            {isOpenPanel && (
                              <span className="ml-auto self-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Open
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
              {/* Theme button (pinned by default; unpin in Settings > Appearance): opens the Theme mode section.
                  Desktop only here; on phones it is the last item of the mobile quick bar. */}
              {showNavThemeToggle && (
                <span className="hidden md:inline-flex">
                  <IconButton
                    label="Theme settings"
                    icon={<Palette aria-hidden="true" />}
                    size="standard"
                    onClick={() => navigate(THEME_SETTINGS_PATH)}
                  />
                </span>
              )}

              {/* New friend request alert (temporary attention signal: gentle loop, static under reduced motion) */}
              {newFriendCount > 0 && (
                <Link
                  to="/user-management"
                  onClick={() => {
                    localStorage.setItem('lastFriendSeenAt', new Date().toISOString())
                    setNewFriendCount(0)
                  }}
                  className="hidden md:flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full
                    bg-primary-subtle text-primary border border-primary-muted hover:bg-primary-muted transition-colors
                    animate-pulse motion-reduce:animate-none"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  New friend request{newFriendCount > 1 ? 's' : ''}
                </Link>
              )}

              {activeEventFlagCount > 0 && (
                <span className="hidden md:inline-flex">
                  <Button
                    intent="danger"
                    size="compact"
                    icon={<Flag className="h-3.5 w-3.5" />}
                    onClick={() => {
                      window.dispatchEvent(new Event('openCommonsPanel'))
                    }}
                  >
                    {activeEventFlagCount} event flag{activeEventFlagCount !== 1 ? 's' : ''}
                  </Button>
                </span>
              )}

              {/* Desktop user menu */}
              <div
                className="relative hidden md:block"
                ref={userMenuRef}
                onMouseEnter={() => { clearTimeout(userHoverTimeout.current); setShowUserMenu(true) }}
                onMouseLeave={() => { userHoverTimeout.current = setTimeout(() => setShowUserMenu(false), 200) }}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape' || !showUserMenu) return
                  setShowUserMenu(false)
                  userMenuButtonRef.current?.focus()
                }}
              >
              {isAuthenticated ? (
                <>
                  <button
                    ref={userMenuButtonRef}
                    type="button"
                    onClick={() => setShowUserMenu(true)}
                    aria-haspopup="true"
                    aria-expanded={showUserMenu}
                    aria-label={`Account menu: ${user?.displayName || user?.travelerName || 'User'}`}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-accent/50 transition-colors cursor-default"
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium overflow-hidden ${
                      isTraveler 
                        ? 'bg-warning'
                        : 'bg-primary'
                    }`}>
                      {user?.avatarUrl ? (
                        <img src={user.avatarUrl} alt={user.displayName || ''} className="w-full h-full object-cover" referrerPolicy="no-referrer" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                      ) : null}
                      {!user?.avatarUrl && isTraveler ? (
                        <Compass className="w-4 h-4" />
                      ) : !user?.avatarUrl ? (
                        (user?.displayName || user?.email || '?').charAt(0).toUpperCase()
                      ) : null}
                    </div>
                    <span className="text-sm font-medium hidden xl:block">
                      {user?.displayName || user?.travelerName || 'User'}
                    </span>
                    {isTraveler && (
                      <span className="text-xs bg-warning-subtle text-warning px-1.5 py-0.5 rounded-full hidden xl:inline">
                        Traveler
                      </span>
                    )}
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </button>
                  
                    {showUserMenu && (
                      <div className={`absolute right-0 mt-2 w-64 bg-popover text-popover-foreground rounded-lg shadow-lg border border-border py-1 ${OVERLAY_LAYER_CLASS.popover}`}>
                        <div className="px-4 py-3 border-b border-border">
                          <p className="text-sm font-medium truncate">
                            {user?.displayName || user?.travelerName || 'User'}
                          </p>
                          {isTraveler && (
                            <p className="text-xs text-warning mt-0.5">Traveler account</p>
                          )}
                        </div>

                        {/* Traveler expiry warning */}
                        {isTraveler && user?.expiresAt && (
                          <div className="px-4 py-2.5 bg-warning-subtle border-b border-border flex items-start gap-2">
                            <AlertTriangle className="w-3.5 h-3.5 text-warning mt-0.5 shrink-0" />
                            <div className="text-xs text-warning">
                              <p>Expires {(() => { const d = new Date(user.expiresAt); const day = String(d.getUTCDate()).padStart(2, '0'); const month = String(d.getUTCMonth() + 1).padStart(2, '0'); return `${day}.${month}.${d.getUTCFullYear()}`; })()}</p>
                              <p className="text-warning mt-0.5">Sign in to keep your data</p>
                            </div>
                          </div>
                        )}
                        
                        {!isTraveler && (
                          <>
                            <Link
                              to="/settings?tab=profile"
                              onClick={() => setShowUserMenu(false)}
                              className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent/50 transition-colors"
                            >
                              <User className="h-4 w-4" />
                              Profile
                            </Link>
                            <Link
                              to="/user-management"
                              onClick={() => setShowUserMenu(false)}
                              className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent/50 transition-colors"
                            >
                              <Users className="h-4 w-4" />
                              Friend List
                            </Link>
                            <Link
                              to="/settings?tab=notifications"
                              onClick={() => setShowUserMenu(false)}
                              className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent/50 transition-colors"
                            >
                              <Bell className="h-4 w-4" />
                              Notifications
                            </Link>
                            <Link
                              to="/settings?tab=calendar"
                              onClick={() => setShowUserMenu(false)}
                              className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent/50 transition-colors"
                            >
                              <Calendar className="h-4 w-4" />
                              Calendar
                            </Link>
                            <Link
                              to="/settings?tab=ai"
                              onClick={() => setShowUserMenu(false)}
                              className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent/50 transition-colors"
                            >
                              <Sparkles className="h-4 w-4" />
                              AI
                            </Link>
                            <Link
                              to="/settings?tab=privacy"
                              onClick={() => setShowUserMenu(false)}
                              className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent/50 transition-colors"
                            >
                              <Shield className="h-4 w-4" />
                              Privacy
                            </Link>
                          </>
                        )}

                        {isTraveler && (
                          <>
                            {travelerHasZoom && (
                              <Link
                                to="/settings?tab=calendar&section=integrations"
                                onClick={() => setShowUserMenu(false)}
                                className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent/50 transition-colors"
                              >
                                <Video className="h-4 w-4" />
                                Meeting Integrations
                              </Link>
                            )}
                            <button
                              onClick={() => {
                                setShowUserMenu(false)
                                if (user?.id) sessionStorage.setItem('previousTravelerId', user.id)
                                sessionStorage.setItem('authReturnTo', window.location.pathname)
                                navigate('/auth/login?upgrade=true')
                              }}
                              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-primary hover:bg-primary-subtle transition-colors"
                            >
                              <User className="h-4 w-4" />
                              Create Account
                            </button>
                          </>
                        )}
                        
                        <div className="border-t border-border my-1" />
                        
                        <button
                          onClick={handleLogout}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-danger hover:bg-danger-subtle transition-colors"
                        >
                          <LogOut className="h-4 w-4" />
                          Sign out
                        </button>
                      </div>
                  )}
                </>
              ) : authLoading ? (
                <Button intent="primary" loading>
                  Signing in...
                </Button>
              ) : (
                <div
                  className="relative"
                  ref={signInMenuRef}
                  onMouseEnter={() => { clearTimeout(signInHoverTimeout.current); setShowSignInMenu(true) }}
                  onMouseLeave={() => { signInHoverTimeout.current = setTimeout(() => setShowSignInMenu(false), 150) }}
                >
                  <Button
                    intent="primary"
                    onClick={() => {
                      sessionStorage.setItem('authReturnTo', location.pathname)
                      navigate('/auth/login')
                    }}
                  >
                    Sign in
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                  {showSignInMenu && (
                    <div className={`absolute right-0 mt-1 w-56 bg-popover text-popover-foreground rounded-lg shadow-lg border border-border py-1 ${OVERLAY_LAYER_CLASS.popover}`}>
                      <button
                        onClick={async () => {
                          setShowSignInMenu(false)
                          sessionStorage.setItem('authReturnTo', location.pathname)
                          try { await login() } catch (err) {
                            if (err instanceof Error && err.name === 'AbortError') return
                          }
                        }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-accent/50 transition-colors"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24">
                          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                        </svg>
                        Google Account
                      </button>
                      <button
                        onClick={handleCardanoWalletClick}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-accent/50 transition-colors"
                      >
                        <Wallet className="h-4 w-4 text-muted-foreground" />
                        Cardano Wallet
                      </button>
                      {captchaMode ? (
                        <Link
                          to="/auth/login"
                          state={{ from: { pathname: location.pathname } }}
                          onClick={() => { sessionStorage.setItem('authReturnTo', location.pathname); setShowSignInMenu(false) }}
                          className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-accent/50 transition-colors"
                        >
                          <Compass className="h-4 w-4 text-muted-foreground" />
                          Travel Account
                        </Link>
                      ) : (
                        <button
                          onClick={async () => {
                            setShowSignInMenu(false)
                            try {
                              await loginAsTraveler()
                            } catch { /* handled by auth context */ }
                          }}
                          className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-accent/50 transition-colors"
                        >
                          <Compass className="h-4 w-4 text-muted-foreground" />
                          Travel Account
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              </div>

              <span className="inline-flex md:hidden">
                <IconButton
                  label={showMobileAccountMenu ? 'Close account menu' : 'Open account menu'}
                  icon={showMobileAccountMenu ? <X /> : <Menu />}
                  size="standard"
                  showTitle={false}
                  onClick={() => {
                    setShowMobileMenu(false)
                    setShowMobileAccountMenu((prev) => !prev)
                  }}
                />
              </span>
            </div>
          </div>
        </div>

        {/* Mobile tools/pages menu */}
        {showMobileMenu && (
          <>
            <div className="fixed inset-0 z-30 bg-black/20" onClick={() => setShowMobileMenu(false)} />
            <div
              data-testid="mobile-navigation-scroll"
              className="md:hidden absolute top-full left-0 right-0 z-40 max-h-dvh overflow-y-auto overscroll-contain bg-background border-b border-border shadow-lg"
              style={{ maxHeight: mobileMenuMaxHeight }}
            >
              <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-col gap-1">
                <Link
                  to="/"
                  onClick={() => setShowMobileMenu(false)}
                  className={`px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                    isActive('/') 
                      ? 'bg-accent text-accent-foreground' 
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                  }`}
                >
                  Home
                </Link>
                <Link
                  to="/events-calendar"
                  onClick={() => setShowMobileMenu(false)}
                  className={`px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                    isActive('/events-calendar')
                      ? 'bg-accent/30 text-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <QuickPinButton pinned={navQuickTools.includes('events-calendar')} onToggle={() => toggleNavQuickTool('events-calendar')} label="All Public Events" className="shrink-0" />
                    <CalendarDays className="w-4 h-4" />
                    All Public Events
                  </span>
                </Link>
                <div>
                  <div className="flex items-center gap-1">
                    <Link
                      to="/calendars"
                      state={fromCalendarView ? { fromCalendarView: true } : undefined}
                      onClick={() => setShowMobileMenu(false)}
                      className={`flex min-w-0 flex-1 items-center gap-1.5 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                        isActive('/calendars')
                          ? 'bg-accent/30 text-foreground'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                      }`}
                    >
                      <QuickPinButton pinned={navQuickTools.includes('calendars')} onToggle={() => toggleNavQuickTool('calendars')} label="Coordination Calendars" className="shrink-0" />
                      <Calendar className="w-4 h-4" />
                      Coordination Calendars
                    </Link>
                    <IconButton
                      label={`${mobileExpandedTool === 'calendars' ? 'Collapse' : 'Expand'} Coordination Calendars related pages`}
                      icon={mobileExpandedTool === 'calendars' ? <ChevronDown /> : <ChevronRight />}
                      showTitle={false}
                      onClick={() => setMobileExpandedTool(mobileExpandedTool === 'calendars' ? null : 'calendars')}
                      aria-expanded={mobileExpandedTool === 'calendars'}
                    />
                  </div>
                  {mobileExpandedTool === 'calendars' && (
                    <div className="ml-4 border-l border-border pl-2">
                      <div className="flex items-center gap-1">
                        <Link to="/calendar" onClick={() => setShowMobileMenu(false)} className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-3 py-2 text-sm transition-colors ${
                          isActive('/calendar')
                            ? 'bg-accent/30 text-foreground'
                            : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                        }`}>
                          <QuickPinButton pinned={navQuickTools.includes('create-calendar')} onToggle={() => toggleNavQuickTool('create-calendar')} label="Create Coordination Calendar" className="shrink-0" />
                          <CalendarPlus className="h-4 w-4" />
                          Create Coordination Calendar
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
                <Link
                  to="/time-management"
                  onClick={() => setShowMobileMenu(false)}
                  className={`px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                    isActive('/time-management')
                      ? 'bg-accent/30 text-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <QuickPinButton pinned={navQuickTools.includes('time-management')} onToggle={() => toggleNavQuickTool('time-management')} label="Time Management" className="shrink-0" />
                    <CalendarClock className="w-4 h-4" />
                    Time Management
                    <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
                      NEW
                    </span>
                  </span>
                </Link>
                <div>
                  <div className="flex items-center gap-1">
                    <Link
                      to="/mailbox"
                      onClick={(e) => goToTool(e, '/mailbox')}
                      className={`flex min-w-0 flex-1 items-center gap-1.5 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                        isActive('/mailbox')
                          ? 'bg-accent/30 text-foreground'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                      }`}
                    >
                      <QuickPinButton pinned={navQuickTools.includes('mailbox')} onToggle={() => toggleNavQuickTool('mailbox')} label="Mailbox" className="shrink-0" />
                      <Inbox className="w-4 h-4" />
                      Mailbox
                      <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
                        NEW
                      </span>
                    </Link>
                    <IconButton
                      label={`${mobileExpandedTool === 'mailbox' ? 'Collapse' : 'Expand'} Mailbox related pages`}
                      icon={mobileExpandedTool === 'mailbox' ? <ChevronDown /> : <ChevronRight />}
                      showTitle={false}
                      onClick={() => setMobileExpandedTool(mobileExpandedTool === 'mailbox' ? null : 'mailbox')}
                      aria-expanded={mobileExpandedTool === 'mailbox'}
                    />
                  </div>
                  {mobileExpandedTool === 'mailbox' && (
                    <div className="ml-4 border-l border-border pl-2">
                      {[
                        { key: 'mailbox-people' as const, to: '/mailbox?tab=people', label: 'People', icon: Users },
                        { key: 'mailbox-invitations' as const, to: '/mailbox?tab=invitations', label: 'Invitations', icon: UserPlus },
                        { key: 'mailbox-settings' as const, to: '/mailbox?tab=settings', label: 'Settings', icon: SlidersHorizontal },
                      ].map((related) => {
                        const RelatedIcon = related.icon
                        return (
                          <div key={related.key} className="flex items-center gap-1">
                            <Link to={related.to} onClick={(e) => goToTool(e, related.to)} className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-3 py-2 text-sm transition-colors ${
                              isActiveRoute(related.to)
                                ? 'bg-accent/30 text-foreground'
                                : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                            }`}>
                              <QuickPinButton pinned={navQuickTools.includes(related.key)} onToggle={() => toggleNavQuickTool(related.key)} label={related.label} className="shrink-0" />
                              <RelatedIcon className="h-4 w-4" />
                              {related.label}
                            </Link>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
                <Link
                  to="/coordinate-events"
                  onClick={(e) => goToTool(e, '/coordinate-events')}
                  className={`px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                    isActive('/coordinate-events')
                      ? 'bg-accent/30 text-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <QuickPinButton pinned={navQuickTools.includes('coordinate-events')} onToggle={() => toggleNavQuickTool('coordinate-events')} label="Coordinate Events" className="shrink-0" />
                    <CalendarDays className="w-4 h-4" />
                    Coordinate Events
                  </span>
                </Link>
                <div>
                  <div className="flex items-center gap-1">
                    <Link
                      to="/distribute"
                      onClick={(e) => goToTool(e, '/distribute')}
                      className={`flex min-w-0 flex-1 items-center gap-1.5 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                        isActive('/distribute')
                          ? 'bg-accent/30 text-foreground'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                      }`}
                    >
                      <QuickPinButton pinned={navQuickTools.includes('distribute')} onToggle={() => toggleNavQuickTool('distribute')} label="Distribute Messages" className="shrink-0" />
                      <Megaphone className="w-4 h-4" />
                      Distribute Messages
                    </Link>
                    <IconButton
                      label={`${mobileExpandedTool === 'distribute' ? 'Collapse' : 'Expand'} Distribute Messages related pages`}
                      icon={mobileExpandedTool === 'distribute' ? <ChevronDown /> : <ChevronRight />}
                      showTitle={false}
                      onClick={() => setMobileExpandedTool(mobileExpandedTool === 'distribute' ? null : 'distribute')}
                      aria-expanded={mobileExpandedTool === 'distribute'}
                    />
                  </div>
                  {mobileExpandedTool === 'distribute' && (
                    <div className="ml-4 border-l border-border pl-2">
                      {[
                        { key: 'distribute-templates' as const, to: '/distribute?tab=templates', label: 'Templates', icon: FileText },
                        { key: 'distribute-scheduled' as const, to: '/distribute?tab=scheduled', label: 'Scheduled', icon: Clock },
                        { key: 'distribute-responses' as const, to: '/distribute?tab=responses', label: 'Responses', icon: MessageSquare },
                      ].map((related) => {
                        const RelatedIcon = related.icon
                        return (
                          <div key={related.key} className="flex items-center gap-1">
                            <Link to={related.to} onClick={(e) => goToTool(e, related.to)} className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-3 py-2 text-sm transition-colors ${
                              isActiveRoute(related.to)
                                ? 'bg-accent/30 text-foreground'
                                : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                            }`}>
                              <QuickPinButton pinned={navQuickTools.includes(related.key)} onToggle={() => toggleNavQuickTool(related.key)} label={related.label} className="shrink-0" />
                              <RelatedIcon className="h-4 w-4" />
                              {related.label}
                            </Link>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
                <Link
                  to="/guardian"
                  onClick={(e) => goToTool(e, '/guardian')}
                  className={`px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                    isActive('/guardian')
                      ? 'bg-danger-subtle text-danger'
                      : 'text-danger hover:bg-danger-subtle'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <QuickPinButton pinned={navQuickTools.includes('guardian')} onToggle={() => toggleNavQuickTool('guardian')} label="Discord Guardian" className="shrink-0" />
                    <Shield className="w-4 h-4" />
                    Discord Guardian
                  </span>
                </Link>
                {adminBlockPower && (
                  <Link
                    to="/admin/oversight"
                    onClick={() => setShowMobileMenu(false)}
                    className={`px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                      isActive('/admin/oversight')
                          ? 'bg-accent/30 text-foreground'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <QuickPinButton pinned={navQuickTools.includes('admin-oversight')} onToggle={() => toggleNavQuickTool('admin-oversight')} label="Platform Oversight" className="shrink-0" />
                      <Eye className="w-4 h-4" />
                      Platform Oversight
                    </span>
                  </Link>
                )}
                {adminBlockPower && (
                  <Link
                    to="/admin/users"
                    onClick={() => setShowMobileMenu(false)}
                    className={`px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                      isActive('/admin/users')
                          ? 'bg-accent/30 text-foreground'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <QuickPinButton pinned={navQuickTools.includes('admin-users')} onToggle={() => toggleNavQuickTool('admin-users')} label="User List" className="shrink-0" />
                      <Users className="w-4 h-4" />
                      User List
                    </span>
                  </Link>
                )}
                <div className="mt-1 pt-2 border-t border-border">
                  <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Assistance
                  </p>
                  {ASSISTANCE_OPTIONS.map(option => {
                    const Icon = option.icon
                    if (option.to) {
                      return (
                        <a
                          key={option.id}
                          href={option.to}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setShowMobileMenu(false)}
                          className="w-full flex items-center gap-1.5 px-3 py-2.5 rounded-md text-left text-sm font-medium transition-colors text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
                        >
                          <QuickPinButton pinned={navQuickTools.includes(option.id)} onToggle={() => toggleNavQuickTool(option.id)} label={option.label} className="shrink-0" />
                          <Icon className={`w-4 h-4 ${option.iconClass}`} />
                          <span className="flex items-center gap-1">
                            {option.label}
                            <ExternalLink className="w-3 h-3 text-muted-foreground opacity-70" />
                          </span>
                        </a>
                      )
                    }

                    return (
                      <div
                        key={option.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setActivePanel(activePanel === option.id ? null : (option.id as Exclude<PanelId, null>))
                          setShowMobileMenu(false)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setActivePanel(activePanel === option.id ? null : (option.id as Exclude<PanelId, null>))
                            setShowMobileMenu(false)
                          }
                        }}
                        className={`w-full flex items-center gap-1.5 px-3 py-2.5 rounded-md text-left text-sm font-medium cursor-pointer transition-colors ${
                          activePanel === option.id
                            ? 'bg-accent/30 text-foreground'
                            : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                        }`}
                      >
                        <QuickPinButton pinned={navQuickTools.includes(option.id)} onToggle={() => toggleNavQuickTool(option.id)} label={option.label} className="shrink-0" />
                        <Icon className={`w-4 h-4 ${option.iconClass}`} />
                        {option.label}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Mobile account/auth menu */}
        {showMobileAccountMenu && (
          <>
            <div className="fixed inset-0 z-30 bg-black/20" onClick={() => setShowMobileAccountMenu(false)} />
            <div className="md:hidden absolute left-0 right-0 z-40 bg-background border-b border-border shadow-lg">
              <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-col gap-1">
                {newFriendCount > 0 && (
                  <Link
                    to="/user-management"
                    onClick={() => {
                      setShowMobileAccountMenu(false)
                      localStorage.setItem('lastFriendSeenAt', new Date().toISOString())
                      setNewFriendCount(0)
                    }}
                    className="flex items-center gap-2 mb-2 px-3 py-2.5 text-sm font-semibold rounded-lg bg-primary-subtle text-primary border border-primary-muted"
                  >
                    <UserPlus className="w-4 h-4" />
                    New friend request{newFriendCount > 1 ? 's' : ''}
                  </Link>
                )}
                {activeEventFlagCount > 0 && (
                  <Button
                    intent="danger"
                    fullWidth
                    icon={<Flag className="h-4 w-4" />}
                    onClick={() => {
                      setShowMobileAccountMenu(false)
                      window.dispatchEvent(new Event('openCommonsPanel'))
                    }}
                    className="mb-2"
                  >
                    {activeEventFlagCount} event flag{activeEventFlagCount !== 1 ? 's' : ''} to review
                  </Button>
                )}
                {authLoading ? (
                  <div className="flex items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Signing in...
                  </div>
                ) : isAuthenticated ? (
                  <div className="flex flex-col gap-1">
                    <div className="px-3 py-2 text-sm font-medium text-foreground flex items-center gap-2">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium overflow-hidden ${
                        isTraveler ? 'bg-warning' : 'bg-primary'
                      }`}>
                        {user?.avatarUrl ? (
                          <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                        ) : null}
                        {!user?.avatarUrl && isTraveler ? (
                          <Compass className="w-3 h-3" />
                        ) : !user?.avatarUrl ? (
                          (user?.displayName || user?.email || '?').charAt(0).toUpperCase()
                        ) : null}
                      </div>
                      {user?.displayName || user?.travelerName || 'User'}
                      {isTraveler && (
                        <span className="text-xs bg-warning-subtle text-warning px-1.5 py-0.5 rounded-full">
                          Traveler
                        </span>
                      )}
                    </div>
                    {!isTraveler && (
                      <>
                        <Link to="/settings?tab=profile" onClick={() => setShowMobileAccountMenu(false)} className="flex items-center gap-3 px-3 py-2.5 text-sm text-muted-foreground hover:bg-accent/50 rounded-md transition-colors">
                          <User className="h-4 w-4" />
                          Profile
                        </Link>
                        <Link to="/user-management" onClick={() => setShowMobileAccountMenu(false)} className="flex items-center gap-3 px-3 py-2.5 text-sm text-muted-foreground hover:bg-accent/50 rounded-md transition-colors">
                          <Users className="h-4 w-4" />
                          Friend List
                        </Link>
                        <Link to="/settings?tab=notifications" onClick={() => setShowMobileAccountMenu(false)} className="flex items-center gap-3 px-3 py-2.5 text-sm text-muted-foreground hover:bg-accent/50 rounded-md transition-colors">
                          <Bell className="h-4 w-4" />
                          Notifications
                        </Link>
                        <Link to="/settings?tab=calendar" onClick={() => setShowMobileAccountMenu(false)} className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-accent/50 rounded-md transition-colors">
                          <Calendar className="h-4 w-4" />
                          Calendar
                        </Link>
                        <Link to="/settings?tab=privacy" onClick={() => setShowMobileAccountMenu(false)} className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-accent/50 rounded-md transition-colors">
                          <Shield className="h-4 w-4" />
                          Privacy
                        </Link>
                      </>
                    )}
                    {isTraveler && (
                      <button
                        onClick={() => {
                          setShowMobileAccountMenu(false)
                          if (user?.id) sessionStorage.setItem('previousTravelerId', user.id)
                          sessionStorage.setItem('authReturnTo', window.location.pathname)
                          navigate('/auth/login?upgrade=true')
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-primary hover:bg-primary-subtle rounded-md transition-colors"
                      >
                        <User className="h-4 w-4" />
                        Create Account
                      </button>
                    )}
                    <button onClick={handleLogout} className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-danger hover:bg-danger-subtle rounded-md transition-colors">
                      <LogOut className="h-4 w-4" />
                      Sign out
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={async () => {
                        setShowMobileAccountMenu(false)
                        sessionStorage.setItem('authReturnTo', location.pathname)
                        try { await login() } catch (err) {
                          if (err instanceof Error && err.name === 'AbortError') return
                        }
                      }}
                      className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-accent/50 rounded-md transition-colors"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                      </svg>
                      Google Account
                    </button>
                    <button onClick={handleCardanoWalletClick} className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-accent/50 rounded-md transition-colors w-full">
                      <Wallet className="h-4 w-4 text-primary" />
                      Cardano Wallet
                    </button>
                    {captchaMode ? (
                      <Link
                        to="/auth/login"
                        state={{ from: { pathname: location.pathname } }}
                        onClick={() => setShowMobileAccountMenu(false)}
                        className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-accent/50 rounded-md transition-colors"
                      >
                        <Compass className="h-4 w-4 text-muted-foreground" />
                        Travel Account
                      </Link>
                    ) : (
                      <button
                        onClick={async () => {
                          setShowMobileAccountMenu(false)
                          try {
                            await loginAsTraveler()
                            navigate(location.pathname)
                          } catch { /* ignore traveler login failure */ }
                        }}
                        className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-accent/50 rounded-md transition-colors"
                      >
                        <Compass className="h-4 w-4 text-muted-foreground" />
                        Travel Account
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </nav>
      
      <FeatureDisabledBanner status={setupStatus} />

      <main className={[
        '/',
        '/calendar',
        '/time-management',
        '/mailbox',
        '/settings',
        '/distribute',
        '/ai-chat',
        '/coordinate-events',
        '/events-calendar',
      ].includes(location.pathname)
        ? shouldLockViewportScroll
          ? 'flex-1 min-h-0 overflow-hidden'
          : ''
        : 'container mx-auto px-4 py-8'}>
        <DesignCatalogHighlighter />
        <Outlet key={location.pathname} />
        {shouldRenderMainBottomSpacer && <div className="h-[30vh]" />}
      </main>
      </div>

      {/* RIGHT PANEL SLOT -- Portal target for page-level right panels */}
      <RightPanelSlot />

      {/* Push side panels — flex siblings that shrink main content */}
      <DeferredSidePanel isOpen={aiPanelOpen} onClose={() => setActivePanel(null)}>
        <AiGuideSidePanel isOpen={aiPanelOpen} onClose={() => setActivePanel(null)} onPanelChange={setActivePanel} />
      </DeferredSidePanel>
      <DeferredSidePanel isOpen={activePanel === 'feedback'} onClose={() => setActivePanel(null)}>
        <FeedbackSidePanel isOpen={activePanel === 'feedback'} onClose={() => setActivePanel(null)} onPanelChange={setActivePanel} />
      </DeferredSidePanel>
      <DeferredSidePanel isOpen={activePanel === 'chat'} onClose={() => setActivePanel(null)}>
        <ChatSidePanel isOpen={activePanel === 'chat'} onClose={() => setActivePanel(null)} onPanelChange={setActivePanel} />
      </DeferredSidePanel>
      <DeferredSidePanel isOpen={activePanel === 'support'} onClose={() => setActivePanel(null)}>
        <SupportSidePanel isOpen={activePanel === 'support'} onClose={() => setActivePanel(null)} onPanelChange={setActivePanel} />
      </DeferredSidePanel>
      <DeferredSidePanel isOpen={activePanel === 'commons'} onClose={() => setActivePanel(null)}>
        <CommonsSidePanel isOpen={activePanel === 'commons'} onClose={() => setActivePanel(null)} onPanelChange={setActivePanel} />
      </DeferredSidePanel>

      {/* ── Cardano wallet picker overlay ──────────────── */}
      <Dialog
        open={cardanoPickerOpen}
        onClose={() => setCardanoPickerMode(null)}
        title={(
          <span className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
            Cardano Wallet
          </span>
        )}
        showCloseButton
      >
            {/* Error message */}
            {createWalletError && (
              <div className="mb-3 p-2 rounded-lg bg-danger-subtle border border-danger-muted text-sm text-danger">
                {createWalletError}
              </div>
            )}

            {cardanoPickerMode === 'no-wallets' ? (
              <div className="space-y-3">
                <div className="flex items-start gap-2 p-3 rounded-lg bg-muted border border-border">
                  <Info className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <p className="text-sm text-muted-foreground">
                    No Cardano wallet extensions detected. Install a supported wallet extension and try again.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  <a
                    href="https://lace.io"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-accent/50 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Install Lace
                  </a>
                  <a
                    href="https://eternl.io"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-accent/50 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Install Eternl
                  </a>
                  <a
                    href="https://typhonwallet.io"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-accent/50 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Install Typhon
                  </a>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground mb-3">Choose a wallet:</p>

                {/* Installed CIP-30 wallets */}
                {cardanoPickerWallets.map((wallet) => (
                  <button
                    key={wallet.id}
                    onClick={async () => {
                      setCardanoPickerMode(null)
                      sessionStorage.setItem('authReturnTo', location.pathname)
                      navigate('/auth/login', { state: { from: { pathname: location.pathname }, cardanoWalletId: wallet.id } })
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-border hover:bg-accent/50 transition-colors"
                  >
                    {wallet.icon ? (
                      <img src={wallet.icon} alt={wallet.name} className="w-5 h-5 rounded shrink-0" />
                    ) : (
                      <Wallet className="w-5 h-5 text-muted-foreground shrink-0" />
                    )}
                    <div className="text-left">
                      <div className="text-sm font-medium">{wallet.name}</div>
                      <div className="text-xs text-muted-foreground">Connect existing wallet</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
      </Dialog>
    </div>
    </AiAssistantProvider>
  )
}
