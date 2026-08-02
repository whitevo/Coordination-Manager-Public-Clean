import { useState, useRef, useEffect, useCallback } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import { Calendar, CalendarPlus, Home, User, LogOut, ChevronDown, Compass, AlertTriangle, Moon, Sun, Megaphone, MessageSquare, Menu, X, Sparkles, Bell, Shield, Wrench, CalendarDays, CalendarClock, Users, Wallet, UserPlus, WifiOff, Eye, LifeBuoy, Video, Loader2, ExternalLink, Info, SlidersHorizontal } from 'lucide-react'
import { detectWallets } from '../lib/cardano-wallet'
import type { WalletInfo } from '../lib/cardano-types'
import { generateManagedWallet } from '../lib/managed-wallet'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { useSetup } from '../contexts/SetupContext'
import { isSetupAccessible } from '../lib/setup-api'
import { apiClient, dedupedGet, RATE_LIMIT_WARN_EVENT, getPersistedRateLimitWarn } from '../lib/api-client'
import { useCaptchaMode } from '../lib/use-captcha-mode'
import { getPrimaryTimezone, formatDateInTimezone, formatTimeInTimezone } from '../lib/timezone-data'
import { AiGuideSidePanel } from './AiGuideSidePanel'
import { FeedbackSidePanel } from './FeedbackSidePanel'
import { ChatSidePanel } from './ChatSidePanel'
import { SupportSidePanel } from './SupportSidePanel'
import { FeatureDisabledBanner } from './FeatureDisabledBanner'
import { AiAssistantProvider } from '../contexts/AiAssistantContext'
import { LeftPanelSlot, RightPanelSlot } from '../contexts/LayoutContext'
import FloatingPanels from './FloatingPanels'
import type { PanelId } from './FloatingPanels'

export default function Layout() {
  const location = useLocation()
  const fromCalendarView = location.pathname.startsWith('/calendar/')
  const shouldRenderMainBottomSpacer = location.pathname !== '/time-management'
  const shouldLockViewportScroll = location.pathname === '/time-management'
  const navigate = useNavigate()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const [showMobileAccountMenu, setShowMobileAccountMenu] = useState(false)
  const [showToolsMenu, setShowToolsMenu] = useState(false)
  const [showSignInMenu, setShowSignInMenu] = useState(false)
  // Cardano wallet picker state
  const [cardanoPickerMode, setCardanoPickerMode] = useState<null | 'wallets' | 'no-wallets'>(null)
  const [cardanoPickerWallets, setCardanoPickerWallets] = useState<WalletInfo[]>([])
  const [_creatingWallet, setCreatingWallet] = useState(false)
  const [createWalletError, setCreateWalletError] = useState<string | null>(null)
  const cardanoPickerRef = useRef<HTMLDivElement>(null)
  const toolsMenuRef = useRef<HTMLDivElement>(null)
  const toolsHoverTimeout = useRef<ReturnType<typeof setTimeout>>()
  const userMenuRef = useRef<HTMLDivElement>(null)
  const userHoverTimeout = useRef<ReturnType<typeof setTimeout>>()
  const signInMenuRef = useRef<HTMLDivElement>(null)
  const signInHoverTimeout = useRef<ReturnType<typeof setTimeout>>()
  
  const { user, isAuthenticated, isLoading: authLoading, isTraveler, login, loginAsTraveler, registerWithManagedWallet, logout, refreshProfile } = useAuth()

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
  const { isDark, toggleDark } = useTheme()
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

  const [activePanel, setActivePanel] = useState<PanelId>(null)
  const leftEdgeTouchStartRef = useRef<number | null>(null)

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
  // Admins: persisted in localStorage indefinitely, must dismiss manually.
  // Regular users: transient, auto-clears after 2 min of no warnings.
  const [rateLimitWarn, setRateLimitWarn] = useState(false)
  const [rateLimitSince, setRateLimitSince] = useState<string | null>(null)

  // On mount, check for persisted warning (admins see it across refreshes)
  useEffect(() => {
    if (!isAdmin) return
    const persisted = getPersistedRateLimitWarn()
    if (persisted.active) {
      setRateLimitWarn(true)
      setRateLimitSince(persisted.since)
    }
  }, [isAdmin])

  // Listen for live warning events
  useEffect(() => {
    const handler = (e: Event) => {
      const warn = !!(e as CustomEvent).detail?.warn
      if (warn) {
        setRateLimitWarn(true)
        const persisted = getPersistedRateLimitWarn()
        setRateLimitSince(persisted.since)
      } else if (!isAdmin) {
        // Non-admins auto-clear; admins must dismiss manually
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
  const aiPanelOpen = activePanel === 'ai'
  const _setAiPanelOpen = (open: boolean | ((prev: boolean) => boolean)) => {
    if (typeof open === 'function') {
      setActivePanel(prev => {
        const wasOpen = prev === 'ai'
        return open(wasOpen) ? 'ai' : null
      })
    } else {
      setActivePanel(open ? 'ai' : null)
    }
  }
  
  // Listen for requests to open the AI panel from child pages
  useEffect(() => {
    const handler = () => setActivePanel('ai')
    window.addEventListener('openAiPanel', handler)
    return () => window.removeEventListener('openAiPanel', handler)
  }, [])

  // Listen for requests to open the Feedback panel from child pages
  useEffect(() => {
    const handler = () => setActivePanel('feedback')
    window.addEventListener('openFeedbackPanel', handler)
    return () => window.removeEventListener('openFeedbackPanel', handler)
  }, [])

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

  const isActive = (path: string) => location.pathname === path

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target as Node)) {
        setShowToolsMenu(false)
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
        <div className="bg-yellow-500/90 text-yellow-950 px-4 py-2 text-center text-sm font-medium flex items-center justify-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            High demand detected — the app is not yet optimized for this level of traffic. You may experience slower responses.
            {isAdmin && rateLimitSince && (
              <span className="ml-1 opacity-75">
                (since {formatDateInTimezone(rateLimitSince, getPrimaryTimezone()).replace(/,? \d{4}$/, '')}{' '}
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
      <nav className="border-b border-border bg-background">
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 md:h-16">
            <div className="flex items-center gap-4 md:gap-6 xl:gap-8 min-w-0">
              <Link to="/" className="hidden md:flex items-center gap-2" aria-label="Coordination Manager home" title="Coordination Manager">
                <Calendar className="h-5 w-5 md:h-6 md:w-6" />
                <span className="hidden xl:inline font-semibold text-base md:text-lg">Coordination Manager</span>
              </Link>

              <div className="flex items-center gap-1 md:hidden">
                <button
                  onClick={() => {
                    setShowMobileAccountMenu(false)
                    setShowMobileMenu((prev) => !prev)
                  }}
                  className="p-2 rounded-lg text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground transition-colors"
                  aria-label={showMobileMenu ? 'Close navigation menu' : 'Open navigation menu'}
                >
                  {showMobileMenu ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                </button>

                <div className="flex items-center gap-0.5 rounded-full border border-border bg-card/80 px-1 py-1">
                  <Link
                    to="/"
                    className={`rounded-full p-2 transition-colors ${
                      isActive('/') ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                    }`}
                    aria-label="Home"
                  >
                    <Home className="h-4 w-4" />
                  </Link>
                  <Link
                    to="/events-calendar"
                    className={`rounded-full p-2 transition-colors ${
                      isActive('/events-calendar') ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                    }`}
                    aria-label="Events"
                  >
                    <CalendarDays className="h-4 w-4" />
                  </Link>
                  <Link
                    to="/calendars"
                    state={fromCalendarView ? { fromCalendarView: true } : undefined}
                    className={`rounded-full p-2 transition-colors ${
                      isActive('/calendars') ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                    }`}
                    aria-label="Coordination calendars"
                  >
                    <Calendar className="h-4 w-4" />
                  </Link>
                  <Link
                    to="/calendar"
                    className={`rounded-full p-2 transition-colors ${
                      isActive('/calendar') ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                    }`}
                    aria-label="Create calendar"
                  >
                    <CalendarPlus className="h-4 w-4" />
                  </Link>
                  <Link
                    to="/time-management"
                    className={`rounded-full p-2 transition-colors ${
                      isActive('/time-management') ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                    }`}
                    aria-label="Time management"
                  >
                    <CalendarClock className="h-4 w-4" />
                  </Link>
                </div>
              </div>
              
              {/* Desktop nav links - left side */}
              <div className="hidden md:flex items-center gap-1">
                <Link
                  to="/"
                  className={`px-2 xl:px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive('/') 
                      ? 'bg-accent text-accent-foreground' 
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                  }`}
                  aria-label="Home"
                  title="Home"
                >
                  <span className="flex items-center gap-1.5">
                    <Home className="w-4 h-4" />
                    <span className="hidden xl:inline">Home</span>
                  </span>
                </Link>

                <Link
                  to="/events-calendar"
                  className={`px-2 xl:px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive('/events-calendar')
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                  }`}
                  aria-label="All Public Events"
                  title="All Public Events"
                >
                  <span className="flex items-center gap-1.5">
                    <CalendarDays className="w-4 h-4" />
                    <span className="hidden xl:inline">All Public Events</span>
                  </span>
                </Link>

                <Link
                  to="/calendars"
                  state={fromCalendarView ? { fromCalendarView: true } : undefined}
                  className={`px-2 xl:px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive('/calendars')
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                  }`}
                  aria-label="Coordination Calendars"
                  title="Coordination Calendars"
                >
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-4 h-4" />
                    <span className="hidden xl:inline">Coordination Calendars</span>
                  </span>
                </Link>
              </div>
            </div>
            
            {/* Right side: Tools + Feedback + Theme toggle + User Menu + Mobile hamburger */}
            <div className="flex items-center gap-1 md:gap-2">
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
                          ? 'text-orange-900 dark:text-orange-100 bg-orange-400/30 dark:bg-orange-500/25 ring-1 ring-orange-500/40 animate-pulse hover:bg-orange-400/40 dark:hover:bg-orange-500/35'
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
                    <span className="hidden xl:inline">Setup</span>
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
                      isActive('/calendar') || isActive('/time-management') || isActive('/distribute') || isActive('/coordinate-events') || isActive('/guardian') || isActive('/admin/users') || isActive('/admin/oversight')
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                    }`}
                    aria-label="Tools"
                    title="Tools"
                  >
                    <Wrench className="h-3.5 w-3.5" />
                    <span className="hidden xl:inline">Tools</span>
                    <ChevronDown className="hidden xl:inline h-3.5 w-3.5" />
                  </button>
                  {showToolsMenu && (
                    <div className="absolute right-0 mt-1 w-72 bg-popover text-popover-foreground rounded-lg shadow-lg border border-border py-1 z-50">
                      <Link
                        to="/calendar"
                        onClick={() => setShowToolsMenu(false)}
                        className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-accent/50 transition-colors"
                      >
                        <CalendarPlus className="h-4 w-4" />
                        Create Coordination Calendar
                      </Link>
                      <Link
                        to="/time-management"
                        onClick={() => setShowToolsMenu(false)}
                        className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-accent/50 transition-colors"
                      >
                        <CalendarClock className="h-4 w-4" />
                        Time Management
                        <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
                          NEW
                        </span>
                      </Link>
                      {isAuthenticated && !isTraveler && (
                        <Link
                          to="/distribute"
                          onClick={() => setShowToolsMenu(false)}
                          className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-accent/50 transition-colors"
                        >
                          <Megaphone className="h-4 w-4" />
                          Distribute Messages
                        </Link>
                      )}
                      {isAuthenticated && !isTraveler && (
                        <Link
                          to="/coordinate-events"
                          onClick={() => setShowToolsMenu(false)}
                          className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-accent/50 transition-colors"
                        >
                          <CalendarDays className="h-4 w-4" />
                          Coordinate Events
                        </Link>
                      )}
                      {isAuthenticated && !isTraveler && (
                        <>
                          <div className="border-t border-border my-1" />
                          <Link
                            to="/guardian"
                            onClick={() => setShowToolsMenu(false)}
                            className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                          >
                            <Shield className="h-4 w-4" />
                            Discord Guardian
                          </Link>
                        </>
                      )}
                      {adminBlockPower && (
                        <>
                          <div className="border-t border-border my-1" />
                          <Link
                            to="/admin/oversight"
                            onClick={() => setShowToolsMenu(false)}
                            className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950 transition-colors"
                          >
                            <Eye className="h-4 w-4" />
                            Platform Oversight
                          </Link>
                          <Link
                            to="/admin/users"
                            onClick={() => setShowToolsMenu(false)}
                            className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                          >
                            <Users className="h-4 w-4" />
                            User List
                          </Link>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {isAuthenticated && (
                  <Link
                    to="/feedback"
                    className={`px-2 xl:px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      isActive('/feedback') 
                        ? 'bg-accent text-accent-foreground' 
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                    }`}
                    aria-label="Feedback"
                    title="Feedback"
                  >
                    <span className="flex items-center gap-1.5">
                      <MessageSquare className="w-4 h-4" />
                      <span className="hidden xl:inline">Feedback</span>
                    </span>
                  </Link>
                )}

                <Link
                  to="/support"
                  className={`px-2 xl:px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive('/support') 
                      ? 'bg-accent text-accent-foreground' 
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                  }`}
                  aria-label="Support"
                  title="Support"
                >
                  <span className="flex items-center gap-1.5">
                    <LifeBuoy className="w-4 h-4" />
                    <span className="hidden xl:inline">Support</span>
                  </span>
                </Link>
              </div>
              {/* Dark mode toggle */}
              <button
                onClick={toggleDark}
                className="p-2 rounded-lg text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground transition-colors"
                title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </button>

              {/* New friend request alert */}
              {newFriendCount > 0 && (
                <Link
                  to="/user-management"
                  onClick={() => {
                    localStorage.setItem('lastFriendSeenAt', new Date().toISOString())
                    setNewFriendCount(0)
                  }}
                  className="hidden md:flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full text-white
                    bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-600 hover:to-rose-600
                    shadow-[0_0_12px_rgba(239,68,68,0.5)] animate-pulse transition-all"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  New friend request{newFriendCount > 1 ? 's' : ''}
                </Link>
              )}

              {/* Desktop user menu */}
              <div
                className="relative hidden md:block"
                ref={userMenuRef}
                onMouseEnter={() => { clearTimeout(userHoverTimeout.current); setShowUserMenu(true) }}
                onMouseLeave={() => { userHoverTimeout.current = setTimeout(() => setShowUserMenu(false), 200) }}
              >
              {isAuthenticated ? (
                <>
                  <button
                    className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-accent/50 transition-colors cursor-default"
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium overflow-hidden ${
                      isTraveler 
                        ? 'bg-gradient-to-br from-amber-500 to-orange-500'
                        : 'bg-gradient-to-br from-blue-500 to-purple-500'
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
                      <span className="text-xs bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-200 px-1.5 py-0.5 rounded-full hidden xl:inline">
                        Traveler
                      </span>
                    )}
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </button>
                  
                    {showUserMenu && (
                      <div className="absolute right-0 mt-2 w-64 bg-popover text-popover-foreground rounded-lg shadow-lg border border-border py-1 z-50">
                        <div className="px-4 py-3 border-b border-border">
                          <p className="text-sm font-medium">
                            {user?.displayName || user?.travelerName || 'User'}
                          </p>
                          {isTraveler && (
                            <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">Traveler account</p>
                          )}
                        </div>
                        
                        {/* Traveler expiry warning */}
                        {isTraveler && user?.expiresAt && (
                          <div className="px-4 py-2.5 bg-amber-50 dark:bg-amber-950 border-b border-border flex items-start gap-2">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                            <div className="text-xs text-amber-700 dark:text-amber-300">
                              <p>Expires {(() => { const d = new Date(user.expiresAt); const day = String(d.getUTCDate()).padStart(2, '0'); const month = String(d.getUTCMonth() + 1).padStart(2, '0'); return `${day}.${month}.${d.getUTCFullYear()}`; })()}</p>
                              <p className="text-amber-600 dark:text-amber-400 mt-0.5">Sign in to keep your data</p>
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
                              className="flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
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
                              className="flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
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
                                className="flex items-center gap-3 px-4 py-2.5 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950 transition-colors"
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
                              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950 transition-colors"
                            >
                              <User className="h-4 w-4" />
                              Create Account
                            </button>
                          </>
                        )}
                        
                        <div className="border-t border-border my-1" />
                        
                        <button
                          onClick={handleLogout}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                        >
                          <LogOut className="h-4 w-4" />
                          Sign out
                        </button>
                      </div>
                  )}
                </>
              ) : authLoading ? (
                <button
                  disabled
                  className="px-4 py-2 text-sm font-medium text-primary-foreground bg-primary/70 rounded-lg flex items-center gap-2 cursor-default"
                >
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Signing in...
                </button>
              ) : (
                <div
                  className="relative"
                  ref={signInMenuRef}
                  onMouseEnter={() => { clearTimeout(signInHoverTimeout.current); setShowSignInMenu(true) }}
                  onMouseLeave={() => { signInHoverTimeout.current = setTimeout(() => setShowSignInMenu(false), 150) }}
                >
                  <button
                    onClick={() => {
                      sessionStorage.setItem('authReturnTo', location.pathname)
                      navigate('/auth/login')
                    }}
                    className="px-4 py-2 text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 rounded-lg transition-colors flex items-center gap-1"
                  >
                    Sign in
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  {showSignInMenu && (
                    <div className="absolute right-0 mt-1 w-56 bg-popover text-popover-foreground rounded-lg shadow-lg border border-border py-1 z-50">
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
                        <Wallet className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        Cardano Wallet
                      </button>
                      {captchaMode ? (
                        <Link
                          to="/auth/login"
                          state={{ from: { pathname: location.pathname } }}
                          onClick={() => { sessionStorage.setItem('authReturnTo', location.pathname); setShowSignInMenu(false) }}
                          className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-accent/50 transition-colors"
                        >
                          <Compass className="h-4 w-4 text-amber-600 dark:text-amber-400" />
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
                          <Compass className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                          Travel Account
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              </div>

              <button
                onClick={() => {
                  setShowMobileMenu(false)
                  setShowMobileAccountMenu((prev) => !prev)
                }}
                className="md:hidden p-2 rounded-lg text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground transition-colors"
                aria-label={showMobileAccountMenu ? 'Close account menu' : 'Open account menu'}
              >
                {showMobileAccountMenu ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile tools/pages menu */}
        {showMobileMenu && (
          <>
            <div className="fixed inset-0 z-30 bg-black/20" onClick={() => setShowMobileMenu(false)} />
            <div className="md:hidden absolute left-0 right-0 z-40 bg-background border-b border-border shadow-lg">
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
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <CalendarDays className="w-4 h-4" />
                    All Public Events
                  </span>
                </Link>
                <Link
                  to="/calendars"
                  state={fromCalendarView ? { fromCalendarView: true } : undefined}
                  onClick={() => setShowMobileMenu(false)}
                  className={`px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                    isActive('/calendars') 
                      ? 'bg-accent text-accent-foreground' 
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-4 h-4" />
                    Coordination Calendars
                  </span>
                </Link>
                <Link
                  to="/calendar"
                  onClick={() => setShowMobileMenu(false)}
                  className={`px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                    isActive('/calendar') 
                      ? 'bg-accent text-accent-foreground' 
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <CalendarPlus className="w-4 h-4" />
                    Create Coordination Calendar
                  </span>
                </Link>
                <Link
                  to="/time-management"
                  onClick={() => setShowMobileMenu(false)}
                  className={`px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                    isActive('/time-management')
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <CalendarClock className="w-4 h-4" />
                    Time Management
                    <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
                      NEW
                    </span>
                  </span>
                </Link>
                {isAuthenticated && !isTraveler && (
                  <Link
                    to="/coordinate-events"
                    onClick={() => setShowMobileMenu(false)}
                    className={`px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                      isActive('/coordinate-events')
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <CalendarDays className="w-4 h-4" />
                      Coordinate Events
                    </span>
                  </Link>
                )}
                {isAuthenticated && !isTraveler && (
                  <Link
                    to="/distribute"
                    onClick={() => setShowMobileMenu(false)}
                    className={`px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                      isActive('/distribute') 
                        ? 'bg-accent text-accent-foreground' 
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Megaphone className="w-4 h-4" />
                      Distribute Messages
                    </span>
                  </Link>
                )}
                {isAuthenticated && !isTraveler && (
                  <Link
                    to="/guardian"
                    onClick={() => setShowMobileMenu(false)}
                    className={`px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                      isActive('/guardian')
                        ? 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300'
                        : 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Shield className="w-4 h-4" />
                      Discord Guardian
                    </span>
                  </Link>
                )}
                {adminBlockPower && (
                  <Link
                    to="/admin/oversight"
                    onClick={() => setShowMobileMenu(false)}
                    className={`px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                      isActive('/admin/oversight')
                        ? 'bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300'
                        : 'text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
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
                        ? 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300'
                        : 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Users className="w-4 h-4" />
                      User List
                    </span>
                  </Link>
                )}
                <Link
                  to="/feedback"
                  onClick={() => setShowMobileMenu(false)}
                  className={`px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                    isActive('/feedback') 
                      ? 'bg-accent text-accent-foreground' 
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <MessageSquare className="w-4 h-4" />
                    Feedback
                  </span>
                </Link>
                <Link
                  to="/support"
                  onClick={() => setShowMobileMenu(false)}
                  className={`px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                    isActive('/support')
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <LifeBuoy className="w-4 h-4" />
                    Support
                  </span>
                </Link>
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
                    className="flex items-center gap-2 mb-2 px-3 py-2.5 text-sm font-semibold rounded-lg text-white bg-gradient-to-r from-red-500 to-rose-500 shadow-[0_0_12px_rgba(239,68,68,0.5)] animate-pulse"
                  >
                    <UserPlus className="w-4 h-4" />
                    New friend request{newFriendCount > 1 ? 's' : ''}
                  </Link>
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
                        isTraveler ? 'bg-gradient-to-br from-amber-500 to-orange-500' : 'bg-gradient-to-br from-blue-500 to-purple-500'
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
                        <span className="text-xs bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-200 px-1.5 py-0.5 rounded-full">
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
                        <Link to="/settings?tab=calendar" onClick={() => setShowMobileAccountMenu(false)} className="flex items-center gap-3 px-3 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 rounded-md transition-colors">
                          <Calendar className="h-4 w-4" />
                          Calendar
                        </Link>
                        <Link to="/settings?tab=privacy" onClick={() => setShowMobileAccountMenu(false)} className="flex items-center gap-3 px-3 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 rounded-md transition-colors">
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
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950 rounded-md transition-colors"
                      >
                        <User className="h-4 w-4" />
                        Create Account
                      </button>
                    )}
                    <button onClick={handleLogout} className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 rounded-md transition-colors">
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
                      <Wallet className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      Cardano Wallet
                    </button>
                    {captchaMode ? (
                      <Link
                        to="/auth/login"
                        state={{ from: { pathname: location.pathname } }}
                        onClick={() => setShowMobileAccountMenu(false)}
                        className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-accent/50 rounded-md transition-colors"
                      >
                        <Compass className="h-4 w-4 text-amber-600 dark:text-amber-400" />
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
                        <Compass className="h-4 w-4 text-amber-600 dark:text-amber-400" />
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
        <Outlet key={location.pathname} />
        {shouldRenderMainBottomSpacer && <div className="h-[30vh]" />}
      </main>
      </div>

      {/* RIGHT PANEL SLOT -- Portal target for page-level right panels */}
      <RightPanelSlot />

      {/* Push side panels — flex siblings that shrink main content */}
      <AiGuideSidePanel isOpen={aiPanelOpen} onClose={() => setActivePanel(null)} onPanelChange={setActivePanel} />
      <FeedbackSidePanel isOpen={activePanel === 'feedback'} onClose={() => setActivePanel(null)} onPanelChange={setActivePanel} />
      <ChatSidePanel isOpen={activePanel === 'chat'} onClose={() => setActivePanel(null)} onPanelChange={setActivePanel} />
      <SupportSidePanel isOpen={activePanel === 'support'} onClose={() => setActivePanel(null)} onPanelChange={setActivePanel} />

      {/* Floating action buttons (fixed overlay) */}
      <FloatingPanels activePanel={activePanel} onPanelChange={setActivePanel} />

      {/* ── Cardano wallet picker overlay ──────────────── */}
      {cardanoPickerMode !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setCardanoPickerMode(null)}
        >
          <div
            ref={cardanoPickerRef}
            className="bg-popover text-popover-foreground rounded-xl shadow-xl border border-border w-full max-w-sm mx-4 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Wallet className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                <h2 className="text-base font-semibold">Cardano Wallet</h2>
              </div>
              <button
                onClick={() => setCardanoPickerMode(null)}
                className="p-1 rounded-md hover:bg-accent/50 text-muted-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Error message */}
            {createWalletError && (
              <div className="mb-3 p-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-sm text-rose-700 dark:text-rose-300">
                {createWalletError}
              </div>
            )}

            {cardanoPickerMode === 'no-wallets' ? (
              <div className="space-y-3">
                <div className="flex items-start gap-2 p-3 rounded-lg bg-muted border border-border">
                  <Info className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
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
                      <img src={wallet.icon} alt={wallet.name} className="w-5 h-5 rounded flex-shrink-0" />
                    ) : (
                      <Wallet className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    )}
                    <div className="text-left">
                      <div className="text-sm font-medium">{wallet.name}</div>
                      <div className="text-xs text-muted-foreground">Connect existing wallet</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
    </AiAssistantProvider>
  )
}
