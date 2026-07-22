import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { apiClient } from '../lib/api-client'
import { signInWithGoogle } from '../lib/auth-service'
import ThemeCreator from '../components/ThemeCreator'
import { 
  User, 
  Bell, 
  Calendar, 
  Shield, 
  LogOut, 
  ChevronRight,
  ChevronDown,
  Moon,
  Sun,
  Trash2,
  Save,
  Plus,
  Link2,
  RefreshCw,
  HelpCircle,
  Globe,
  Mail,
  ToggleLeft,
  ToggleRight,
  AlertCircle,
  ExternalLink,
  FileText,
  Pencil,
  Check as CheckIcon,
  X,
  Palette,
  Monitor,
  Wallet,
  Unlink,
  CreditCard,
  Users,
  Copy,
  LinkIcon,
  Merge,
  Loader2,
  Sparkles,
  Bot,
  Info,
  Key,
  BookOpen,
  ShieldCheck,
  Eye,
  UserCircle,
  MessageSquare,
  ShieldBan,
  UserX,
  Video,
  Lock,
  CheckCircle2,
  ArrowUp,
  ArrowDown,
} from 'lucide-react'
import SentimentGrid from '../components/SentimentGrid'
import { detectWallets, connectWallet, getWalletAddress } from '../lib/cardano-wallet'
import type { WalletInfo, CardanoWalletId } from '../lib/cardano-types'
import {
  generateManagedWallet,
  exportPrivateKeyHex,
  hasDeviceKey,
  isManagedAddress,
  formatManagedAddress,
} from '../lib/managed-wallet'
import { AI_MODEL_OPTIONS } from '../lib/theme-types'
import type { AiSettings } from '../lib/theme-types'
import { useLearnerMode } from '../contexts/LearnerModeContext'
import { useTimezones } from '../lib/use-timezones'
import type { UseTimezonesReturn } from '../lib/use-timezones'
import { getPrimaryTimezone, formatDateInTimezone } from '../lib/timezone-data'
import TimezoneSelector from '../components/TimezoneSelector'

type SettingsTab = 'profile' | 'notifications' | 'calendar' | 'ai' | 'privacy'

interface SubcategoryLink {
  id: string
  label: string
}

const TAB_SUBCATEGORIES: Record<SettingsTab, SubcategoryLink[]> = {
  profile: [
    { id: 'profile-info', label: 'Profile Information' },
    { id: 'role-info', label: 'Role & Permissions' },
    { id: 'appearance', label: 'Appearance' },
  ],
  notifications: [
    { id: 'channels', label: 'Channels' },
    { id: 'notification-preferences', label: 'Preferences' },
    { id: 'reminders', label: 'Event Reminders' },
  ],
  calendar: [
    { id: 'connections', label: 'Network Connections' },
    { id: 'integrations', label: 'Meeting Integrations' },
    { id: 'defaults', label: 'Default Parameters' },
  ],
  ai: [
    { id: 'ai-model', label: 'AI Model' },
    { id: 'ai-usage', label: 'Usage & Costs' },
    { id: 'agent-api-keys', label: 'Agent API Keys' },
  ],
  privacy: [
    { id: 'email-contact', label: 'Email & Contact' },
    { id: 'cardano-wallet', label: 'Cardano Wallet' },
    { id: 'account-linking', label: 'Account Linking' },
    { id: 'visibility', label: 'Profile Visibility' },
    { id: 'sharing', label: 'Invite Friends' },
    { id: 'legal', label: 'Legal' },
    { id: 'proposals', label: 'Proposals' },
    { id: 'account-actions', label: 'Account Actions' },
  ],
}

interface UserProfile {
  displayName: string
  email: string
  timezone: string
  avatarUrl: string
}

interface NotificationSettings {
  emailNotifications: boolean
  discordNotifications: boolean
  reminderTimes: string[]
}

interface CalendarSettings {
  defaultView: 'week' | 'day' | 'month'
  defaultTimeInterval: 15 | 30 | 60
  startHour: number
  endHour: number
  weekStartsOn: 0 | 1 // 0 = Sunday, 1 = Monday
  showWeekNumbers: boolean
}

interface PrivacySettings {
  profileVisibility: 'public' | 'private' | 'contacts'
  showEmail: boolean
  allowInvites: boolean
}

interface CalendarSourceData {
  id: string
  source_type: 'google_oauth' | 'google_public_url'
  google_email: string | null
  public_url: string | null
  display_name: string
  color: string
  is_active: boolean
  last_synced: string | null
  sync_error: string | null
  created_at: string
}

interface AgentApiKey {
  id: string
  name: string
  api_key?: string // Only present when first created
  scopes: string[]
  is_active: boolean
  expires_at: string | null
  last_used_at: string | null
  created_at: string
  ack_writes_at?: string | null
  daily_request_limit?: number
  rate_window_start?: string | null
  rate_window_count?: number
}

const AGENT_SCOPES = [
  { id: 'read', label: 'Read', description: 'View calendars, meetings, availability' },
  { id: 'write:calendars', label: 'Write Calendars', description: 'Create/update calendars' },
  { id: 'write:meetings', label: 'Write Meetings', description: 'Create/update meetings' },
  { id: 'write:announcements', label: 'Write Announcements', description: 'Create announcement drafts' },
  { id: 'write:feedback', label: 'Write Feedback', description: 'Submit feedback on behalf of the user' },
] as const

function scopesIncludeWrite(scopes: readonly string[]): boolean {
  return scopes.some((s) => s.startsWith('write:') || s === '*')
}

const SOURCE_COLORS = [
  { value: '#3B82F6', label: 'Blue' },
  { value: '#10B981', label: 'Green' },
  { value: '#F59E0B', label: 'Amber' },
  { value: '#EF4444', label: 'Red' },
  { value: '#8B5CF6', label: 'Purple' },
  { value: '#EC4899', label: 'Pink' },
  { value: '#06B6D4', label: 'Cyan' },
  { value: '#F97316', label: 'Orange' },
]



export default function SettingsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, session, logout, isTraveler, isCardano, isAuthenticated, refreshProfile } = useAuth()
  const { isDark, mode, setMode, activeThemeId, customThemes, applyTheme, saveCustomTheme, deleteCustomTheme, reloadThemeFromBackend } = useTheme()
  const { learnerMode, setLearnerMode } = useLearnerMode()
  const initialTab = (searchParams.get('tab') as SettingsTab) || 'profile'
  const _initialSection = searchParams.get('section') || null
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab)
  const sectionScrolledRef = useRef(false)

  // Sync activeTab when searchParams change (e.g. navigating from user menu shortcuts)
  useEffect(() => {
    const tab = searchParams.get('tab') as SettingsTab
    if (tab && tab !== activeTab) {
      setActiveTab(tab)
    }
    // Reset scroll ref so section scroll can fire again on new navigation
    const section = searchParams.get('section')
    if (section) {
      sectionScrolledRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: sync activeTab FROM the URL only when search params change; adding activeTab would revert user tab clicks that do not alter the URL
  }, [searchParams])
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [oversightInfoExpanded, setOversightInfoExpanded] = useState(false)
  const [adminPowersExpanded, setAdminPowersExpanded] = useState(false)
  const [adminDeletePower, setAdminDeletePower] = useState(false)
  const [adminBlockPower, setAdminBlockPower] = useState(false)
  const [demoValence, setDemoValence] = useState(0)
  const [demoTrust, setDemoTrust] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  
  // Calendar sources state
  const [calendarSources, setCalendarSources] = useState<CalendarSourceData[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [showAddGoogle, setShowAddGoogle] = useState(false)
  const [showAddPublicUrl, setShowAddPublicUrl] = useState(false)
  const [showUrlGuide, setShowUrlGuide] = useState(false)
  const [newGoogleName, setNewGoogleName] = useState('')
  const [newGoogleColor, setNewGoogleColor] = useState('#3B82F6')
  const [newUrlName, setNewUrlName] = useState('')
  const [newUrlValue, setNewUrlValue] = useState('')
  const [newUrlColor, setNewUrlColor] = useState('#10B981')
  const [sourceActionLoading, setSourceActionLoading] = useState<string | null>(null)
  const [pendingRemoveSourceId, setPendingRemoveSourceId] = useState<string | null>(null)
  const [oauthMessage, setOauthMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null)
  const [editingSourceName, setEditingSourceName] = useState('')
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // Wallet linking state
  const [walletStatus, setWalletStatus] = useState<{
    linked: boolean
    walletAddress: string | null
    stakeAddress: string | null
    accountType: string | null
  }>({ linked: false, walletAddress: null, stakeAddress: null, accountType: null })
  const [walletLoading, setWalletLoading] = useState(false)
  const [walletActionLoading, setWalletActionLoading] = useState(false)
  const [walletError, setWalletError] = useState<string | null>(null)
  const [walletSuccess, setWalletSuccess] = useState<string | null>(null)
  const [availableWallets, setAvailableWallets] = useState<WalletInfo[]>([])
  const [showWalletPicker, setShowWalletPicker] = useState(false)
  const [walletCopied, setWalletCopied] = useState(false)

  // Account linking state
  const [linkLoading, setLinkLoading] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [linkSuccess, setLinkSuccess] = useState<string | null>(null)
  const [showMergeConfirm, setShowMergeConfirm] = useState(false)
  // Stores wallet info for pending merge (address + walletId only — signature comes after confirmation)
  const [pendingMergeWalletData, setPendingMergeWalletData] = useState<{
    address: string; walletId: CardanoWalletId
  } | null>(null)

  // Managed wallet state
  const [_managedWalletCreating, setManagedWalletCreating] = useState(false)
  const [managedWalletError, setManagedWalletError] = useState<string | null>(null)
  const [managedWalletSuccess, setManagedWalletSuccess] = useState<string | null>(null)
  const [exportedPrivateKey, setExportedPrivateKey] = useState<string | null>(null)
  const [exportKeyLoading, setExportKeyLoading] = useState(false)
  const [exportedKeyCopied, setExportedKeyCopied] = useState(false)
  const [showExportConfirm, setShowExportConfirm] = useState(false)
  const [showWalletInfo, setShowWalletInfo] = useState(false)

  // Agent API keys state
  const [agentApiKeys, setAgentApiKeys] = useState<AgentApiKey[]>([])
  // Zoom integration state
  const [zoomIntegration, setZoomIntegration] = useState<{ id: string; zoom_email: string | null; zoom_display_name: string | null; is_active: boolean } | null>(null)
  const [zoomLoading, setZoomLoading] = useState(false)
  const [zoomConnecting, setZoomConnecting] = useState(false)
  const [zoomError, setZoomError] = useState<string | null>(null)
  const [zoomSuccess, setZoomSuccess] = useState<string | null>(null)

  // Luma integration state
  const [lumaIntegration, setLumaIntegration] = useState<{ id: string; luma_user_email: string | null; luma_user_name: string | null; is_active: boolean } | null>(null)
  const [lumaLoading, _setLumaLoading] = useState(false)
  const [lumaApiKey, setLumaApiKey] = useState('')
  const [lumaConnecting, setLumaConnecting] = useState(false)
  const [lumaError, setLumaError] = useState<string | null>(null)
  const [lumaSuccess, setLumaSuccess] = useState<string | null>(null)

  const [agentKeysLoading, setAgentKeysLoading] = useState(false)
  const [showCreateAgentKey, setShowCreateAgentKey] = useState(false)
  const [newAgentKeyName, setNewAgentKeyName] = useState('')
  const [newAgentKeyScopes, setNewAgentKeyScopes] = useState<string[]>(['read'])
  const [confirmWriteAccess, setConfirmWriteAccess] = useState(false)

  const [agentKeyCreating, setAgentKeyCreating] = useState(false)
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null)
  const [agentKeyCopied, setAgentKeyCopied] = useState(false)
  const [docsUrlCopied, setDocsUrlCopied] = useState(false)
  const [agentKeyError, setAgentKeyError] = useState<string | null>(null)
  
  // Profile from auth context
  const [profile, setProfile] = useState<UserProfile>({
    displayName: user?.displayName || '',
    email: user?.email || '',
    timezone: user?.timezone || 'UTC',
    avatarUrl: user?.avatarUrl || '',
  })
  
  const [notifications, setNotifications] = useState<NotificationSettings>({
    emailNotifications: false,
    discordNotifications: false,
    reminderTimes: [],
  })
  
  const [calendarSettings, setCalendarSettings] = useState<CalendarSettings>({
    defaultView: 'week',
    defaultTimeInterval: 30,
    startHour: 8,
    endHour: 18,
    weekStartsOn: 1,
    showWeekNumbers: false,
  })
  
  const [_privacy, setPrivacy] = useState<PrivacySettings>({
    profileVisibility: 'private',
    showEmail: false,
    allowInvites: false,
  })

  const [aiSettings, setAiSettings] = useState<AiSettings>({
    preferredModel: 'openai',
  })

  // Notification preferences state
  const [notifPrefsExpanded, setNotifPrefsExpanded] = useState(false)
  const [notifPrefVisibility, setNotifPrefVisibility] = useState<'private' | 'followers' | 'contacts' | 'public'>('private')
  const [_notifPrefSaved, _setNotifPrefSaved] = useState(false)
  const [showPrefVisibilityNotice, setShowPrefVisibilityNotice] = useState(false)
  // Notification channel toggles (email, discord)
  const [notifChannelEmail, setNotifChannelEmail] = useState(false)
  const [notifChannelDiscord, setNotifChannelDiscord] = useState(false)
  // Channel priority order (drag/reorder list)
  const [notifChannelPriority, setNotifChannelPriority] = useState<string[]>(['Email', 'Discord DM'])

  // Privacy settings expanded states
  const [_privacyExpandedLevel, _setPrivacyExpandedLevel] = useState<string | null>(null)
  const [privacyFollowersEnabled, setPrivacyFollowersEnabled] = useState(false)
  const [privacyContactsEnabled, setPrivacyContactsEnabled] = useState(false)
  const [privacyPublicEnabled, setPrivacyPublicEnabled] = useState(false)
  // Visibility guide topic for the description area above matrix
  const [visibilityGuideKey, setVisibilityGuideKey] = useState<'default' | 'followers' | 'contacts' | 'feature' | 'email' | 'prefs' | 'connections'>('default')
  // Per-level feature toggles
  const [followersShowEmail, setFollowersShowEmail] = useState(false)
  const [followersShowPrefs, setFollowersShowPrefs] = useState(false)
  const [followersAllowConnections, setFollowersAllowConnections] = useState(false)
  const [contactsShowEmail, setContactsShowEmail] = useState(false)
  const [contactsShowPrefs, setContactsShowPrefs] = useState(false)
  const [contactsAllowConnections, setContactsAllowConnections] = useState(false)
  const [publicShowEmail, setPublicShowEmail] = useState(false)
  const [publicShowPrefs, setPublicShowPrefs] = useState(false)
  const [publicAllowConnections, setPublicAllowConnections] = useState(false)
  const [_publicOutdated, setPublicOutdated] = useState(false)
  // Any matrix feature actually active?
  const anyMatrixFeatureEnabled =
    (followersShowEmail && privacyFollowersEnabled) ||
    (followersShowPrefs && privacyFollowersEnabled) ||
    (followersAllowConnections && privacyFollowersEnabled) ||
    (contactsShowEmail && privacyContactsEnabled) ||
    (contactsShowPrefs && privacyContactsEnabled) ||
    (contactsAllowConnections && privacyContactsEnabled)
  // Private is active whenever nothing in the matrix is enabled
  const privacyPrivateEnabled = !anyMatrixFeatureEnabled

  // ── Email Verification state ──
  const [verifiedEmails, setVerifiedEmails] = useState<{ id: string; email: string; verification_method: string; is_primary: boolean; verified_at: string }[]>([])
  const [loadingVerifiedEmails, setLoadingVerifiedEmails] = useState(false)
  const [verifyEmailInput, setVerifyEmailInput] = useState('')
  const [verifyCodeInput, setVerifyCodeInput] = useState('')
  const [verifyStep, setVerifyStep] = useState<'idle' | 'sending' | 'code-sent' | 'verifying'>('idle')
  const [verifyPendingEmail, setVerifyPendingEmail] = useState('')
  const [verifyResult, setVerifyResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Settings page invite code generation
  const [settingsInviteCode, setSettingsInviteCode] = useState<string | null>(null)
  const [settingsInviteCopied, setSettingsInviteCopied] = useState(false)

  // AI model availability from backend
  const [modelAvailability, setModelAvailability] = useState<Record<string, boolean>>({})
  const [modelAvailabilityLoaded, setModelAvailabilityLoaded] = useState(false)

  // ─── Fetch wallet link status ───────────────────────────────
  const fetchWalletStatus = useCallback(async () => {
    if (!session?.access_token) return
    setWalletLoading(true)
    try {
      const res = await apiClient.get('/api/auth/wallet/status', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      setWalletStatus(res.data)
    } catch (err) {
      console.error('Failed to fetch wallet status:', err)
    } finally {
      setWalletLoading(false)
    }
  }, [session?.access_token])

  useEffect(() => {
    fetchWalletStatus()
  }, [fetchWalletStatus])

  // ─── Agent API Keys ─────────────────────────────────────────
  const fetchAgentApiKeys = useCallback(async () => {
    if (!session?.access_token) return
    setAgentKeysLoading(true)
    try {
      const res = await apiClient.get('/api/auth/agent-keys', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      setAgentApiKeys(res.data.keys || [])
    } catch (err) {
      console.error('Failed to fetch agent API keys:', err)
    } finally {
      setAgentKeysLoading(false)
    }
  }, [session?.access_token])

  useEffect(() => {
    if (activeTab === 'ai') {
      fetchAgentApiKeys()
      // Fetch model availability from backend
      if (!modelAvailabilityLoaded && session?.access_token) {
        apiClient.get('/api/ai-chat/status', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }).then(res => {
          const avail: Record<string, boolean> = {}
          for (const m of (res.data.availableModels || [])) {
            avail[m.id] = m.available
          }
          setModelAvailability(avail)
          setModelAvailabilityLoaded(true)
        }).catch(err => {
          console.error('Failed to fetch AI status:', err)
        })
      }
    }
  }, [activeTab, fetchAgentApiKeys, modelAvailabilityLoaded, session?.access_token])

  const handleCreateAgentKey = useCallback(async () => {
    if (!session?.access_token || !newAgentKeyName.trim()) return
    const hasWrite = scopesIncludeWrite(newAgentKeyScopes)
    if (hasWrite && !confirmWriteAccess) {
      setAgentKeyError('Tick the acknowledgement below before granting write access.')
      return
    }
    setAgentKeyCreating(true)
    setAgentKeyError(null)
    try {
      const res = await apiClient.post('/api/auth/agent-keys', {
        name: newAgentKeyName.trim(),
        scopes: newAgentKeyScopes,
        confirmWriteAccess: hasWrite ? true : undefined,
      }, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      setNewlyCreatedKey(res.data.key.api_key)
      setAgentApiKeys(prev => [res.data.key, ...prev])
      setNewAgentKeyName('')
      setNewAgentKeyScopes(['read'])
      setConfirmWriteAccess(false)
    } catch (err: unknown) {
      // Extract error message from axios error response or fallback
      let errorMessage = 'Failed to create API key'
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string; message?: string } } }
        errorMessage = axiosErr.response?.data?.error || axiosErr.response?.data?.message || errorMessage
      } else if (err instanceof Error) {
        errorMessage = err.message
      }
      setAgentKeyError(errorMessage)
    } finally {
      setAgentKeyCreating(false)
    }
  }, [session?.access_token, newAgentKeyName, newAgentKeyScopes, confirmWriteAccess])

  const handleDeleteAgentKey = useCallback(async (keyId: string) => {
    if (!session?.access_token) return
    if (!confirm('Are you sure you want to delete this API key? Any agents using it will stop working.')) return
    try {
      await apiClient.delete(`/api/auth/agent-keys/${keyId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      setAgentApiKeys(prev => prev.filter(k => k.id !== keyId))
    } catch (err) {
      console.error('Failed to delete agent API key:', err)
    }
  }, [session?.access_token])

  const handleCopyAgentKey = useCallback((key: string) => {
    navigator.clipboard.writeText(key)
    setAgentKeyCopied(true)
    setTimeout(() => setAgentKeyCopied(false), 2000)
  }, [])

  // Detect available browser wallets when privacy tab is active
  useEffect(() => {
    if (activeTab === 'privacy') {
      const timer = setTimeout(() => {
        setAvailableWallets(detectWallets())
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [activeTab])

  const handleLinkWallet = useCallback(async (walletId: CardanoWalletId, mergeIfConflict = false) => {
    if (!session?.access_token) return
    setWalletActionLoading(true)
    setWalletError(null)
    setWalletSuccess(null)
    setShowWalletPicker(false)
    setLinkError(null)

    try {
      // Step 1: Connect to the wallet
      const api = await connectWallet(walletId)

      // Step 2: Get the wallet address
      const hexAddress = await getWalletAddress(api)

      // Step 3: Check for conflicts BEFORE requesting a challenge/signing
      if (!mergeIfConflict) {
        const checkRes = await apiClient.post('/api/auth/wallet/check-conflict', {
          address: hexAddress,
        }, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })

        if (checkRes.data?.conflict && checkRes.data?.canMerge) {
          // Wallet belongs to an existing Cardano account — show merge dialog BEFORE signing
          setPendingMergeWalletData({ address: hexAddress, walletId })
          setShowMergeConfirm(true)
          setWalletActionLoading(false)
          return
        }

        if (checkRes.data?.conflict && !checkRes.data?.canMerge) {
          throw new Error('This wallet is already linked to another account and cannot be merged.')
        }
      }

      // Step 4: Request a challenge nonce (only after conflict check passed or merge confirmed)
      const challengeRes = await apiClient.post('/api/auth/wallet/challenge', {
        address: hexAddress,
      })
      const { nonce } = challengeRes.data
      if (!nonce) throw new Error('Failed to receive authentication challenge')

      // Step 5: Sign the nonce.
      // We sign the raw nonce (not a multi-line message) because Lace and other
      // CIP-30 wallets can hang or fail when signData receives long/multi-line payloads.
      const hexPayload = Array.from(new TextEncoder().encode(nonce))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      let dataSignature: { signature: string; key: string }
      try {
        dataSignature = await api.signData(hexAddress, hexPayload)
      } catch (signErr: unknown) {
        // CIP-30 DataSignError: plain object { code: number, info: string }
        const cipErr = signErr as Record<string, unknown>
        if (cipErr && typeof cipErr === 'object' && 'code' in cipErr) {
          const code = cipErr.code as number
          const info = ((cipErr.info as string) || '').trim()
          if (code === 3) throw new Error('Signing was cancelled. If the wallet prompt looked broken or frozen, close all open wallet windows and try again.')
          if (code === 2) throw new Error('This address cannot sign data. Try reconnecting your wallet.')
          if (code === 1) throw new Error(`Wallet could not generate a proof.${info ? ' ' + info : ''}`)
          throw new Error(`Wallet signing error (code ${code})${info ? ': ' + info : ''}`)
        }
        if (signErr instanceof Error) {
          const m = signErr.message.toLowerCase()
          if (m.includes('declined') || m.includes('rejected') || m.includes('cancel')) {
            throw new Error('Signing was cancelled. If the wallet prompt looked broken or frozen, close all open wallet windows and try again.')
          }
          throw new Error(`Failed to sign: ${signErr.message}`)
        }
        throw new Error(`Failed to sign: ${JSON.stringify(signErr) || 'Wallet returned an unexpected error'}`)
      }

      // Step 6: Submit to link endpoint
      const linkRes = await apiClient.post('/api/auth/wallet/link', {
        address: hexAddress,
        nonce,
        signature: dataSignature.signature,
        key: dataSignature.key,
        merge: mergeIfConflict,
      }, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })

      if (!linkRes.data?.success) {
        throw new Error(linkRes.data?.error || linkRes.data?.message || 'Failed to link wallet')
      }

      if (linkRes.data?.merged) {
        setWalletSuccess('Accounts merged and wallet linked! All your data has been combined.')
        setLinkSuccess('Accounts merged successfully.')
        // Refresh profile + theme so the UI reflects the primary account's merged settings
        await refreshProfile()
        reloadThemeFromBackend()
      } else {
        setWalletSuccess('Wallet linked successfully!')
      }
      await fetchWalletStatus()
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string }).response?.data?.error || (err as { message?: string }).message || 'Failed to link wallet'
      setWalletError(msg)
    } finally {
      setWalletActionLoading(false)
    }
  }, [session?.access_token, fetchWalletStatus, refreshProfile, reloadThemeFromBackend])

  const handleRemoveWalletAccess = useCallback(async () => {
    if (!session?.access_token) return
    if (!confirm(
      'Remove wallet access?\n\n' +
      'This will revoke this wallet\'s permission to access your account. ' +
      'If the wallet owner logs in again, they will start as a brand-new user ' +
      'with no prior data or settings.\n\n' +
      'Your merged data (calendars, events, templates) will stay on this account.'
    )) return
    setWalletActionLoading(true)
    setWalletError(null)
    setWalletSuccess(null)

    try {
      const response = await apiClient.delete('/api/auth/wallet/link', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const msg = response.data?.message || 'Wallet access removed.'
      setWalletSuccess(msg)
      // Refresh wallet status and user profile so the UI reflects the unlink.
      // The session stays alive even if logged in via wallet (backend metadata
      // redirect handles identity transparency).
      await fetchWalletStatus()
      await refreshProfile()
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string }).response?.data?.error || (err as { message?: string }).message || 'Failed to remove wallet access'
      setWalletError(msg)
    } finally {
      setWalletActionLoading(false)
    }
  }, [session?.access_token, fetchWalletStatus, refreshProfile])

  const copyWalletAddress = useCallback(() => {
    if (walletStatus.walletAddress) {
      navigator.clipboard.writeText(walletStatus.walletAddress)
      setWalletCopied(true)
      setTimeout(() => setWalletCopied(false), 2000)
    }
  }, [walletStatus.walletAddress])

  // ─── Managed wallet handlers ────────────────────────────────────────

  const _handleCreateManagedWallet = useCallback(async () => {
    setManagedWalletCreating(true)
    setManagedWalletError(null)
    setManagedWalletSuccess(null)
    try {
      const { address, encryptedBlob, publicKeyHex } = await generateManagedWallet()
      await apiClient.post('/api/auth/wallet/managed/create', {
        address,
        encryptedBlob,
        publicKey: publicKeyHex,
      })
      await refreshProfile()
      setManagedWalletSuccess('Managed wallet created and linked to your account.')
      // Refresh wallet status
      await fetchWalletStatus()
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { message?: string } }; message?: string }
      setManagedWalletError(axErr.response?.data?.message || axErr.message || 'Failed to create wallet')
    } finally {
      setManagedWalletCreating(false)
    }
  }, [refreshProfile, fetchWalletStatus])

  const handleExportPrivateKey = useCallback(async () => {
    setExportKeyLoading(true)
    try {
      const blob = user?.encryptedWalletBlob
      if (!blob) {
        setManagedWalletError('No encrypted wallet found on this account.')
        return
      }
      const hex = await exportPrivateKeyHex(blob)
      if (!hex) {
        setManagedWalletError('Cannot decrypt wallet on this device. The key was created on a different device.')
        return
      }
      setExportedPrivateKey(hex)
    } catch {
      setManagedWalletError('Failed to export private key')
    } finally {
      setExportKeyLoading(false)
      setShowExportConfirm(false)
    }
  }, [user?.encryptedWalletBlob])

  // ─── Handle merge confirmation (Google user linking existing Cardano wallet)
  const handleConfirmMerge = useCallback(async () => {
    if (!session?.access_token || !pendingMergeWalletData) return
    setShowMergeConfirm(false)
    setWalletActionLoading(true)
    setWalletError(null)

    try {
      // User confirmed merge — now do the full challenge + sign + link flow
      // This is the ONLY time we request a signature
      await handleLinkWallet(pendingMergeWalletData.walletId, true)
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string }).response?.data?.error || (err as { message?: string }).message || 'Merge failed'
      setWalletError(msg)
      setWalletActionLoading(false)
    } finally {
      setPendingMergeWalletData(null)
    }
  }, [session?.access_token, pendingMergeWalletData, handleLinkWallet])

  // ─── Handle Google account linking (Cardano user → Google)
  const handleLinkGoogleAccount = useCallback(async () => {
    if (!session?.access_token) return
    setLinkLoading(true)
    setLinkError(null)

    try {
      // Step 1: Create a merge token on the backend
      const res = await apiClient.post('/api/auth/account/prepare-link', {}, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })

      if (!res.data?.mergeToken) {
        throw new Error('Failed to prepare account link')
      }

      // Step 2: Save merge intent to localStorage
      localStorage.setItem('pendingAccountLink', JSON.stringify({
        mergeToken: res.data.mergeToken,
        sourceUserId: user?.id,
        sourceAccountType: user?.accountType,
        initiatedAt: Date.now(),
      }))

      // Step 3: Set return URL so after OAuth we come back to Settings
      sessionStorage.setItem('authReturnTo', '/settings?tab=privacy&section=account-linking')

      // Step 4: Redirect to Google OAuth
      await signInWithGoogle()
    } catch (err) {
      setLinkError((err as { message?: string }).message || 'Failed to start Google account linking')
      setLinkLoading(false)
    }
  }, [session?.access_token, user?.id, user?.accountType])

  // ─── Complete pending account merge after OAuth redirect
  useEffect(() => {
    const completePendingMerge = async () => {
      const pendingRaw = localStorage.getItem('pendingAccountLink')
      if (!pendingRaw || !session?.access_token) return

      try {
        const pending = JSON.parse(pendingRaw)
        if (!pending.mergeToken) return

        // Check if token is still within the 10-minute window
        if (Date.now() - pending.initiatedAt > 10 * 60 * 1000) {
          localStorage.removeItem('pendingAccountLink')
          setLinkError('Account linking expired. Please try again.')
          return
        }

        setLinkLoading(true)
        setLinkError(null)

        const res = await apiClient.post('/api/auth/account/complete-link', {
          mergeToken: pending.mergeToken,
        }, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })

        localStorage.removeItem('pendingAccountLink')

        if (res.data?.success) {
          setLinkSuccess(res.data.message || 'Accounts merged successfully!')
          // Refresh profile + theme so the UI reflects the merged settings
          await refreshProfile()
          reloadThemeFromBackend()
        }
      } catch (err) {
        localStorage.removeItem('pendingAccountLink')
        const msg = (err as { response?: { data?: { error?: string } }; message?: string }).response?.data?.error || (err as { message?: string }).message || 'Failed to complete account merge'
        setLinkError(msg)
      } finally {
        setLinkLoading(false)
      }
    }

    completePendingMerge()
  }, [session?.access_token, refreshProfile, reloadThemeFromBackend])

  // ─── Sync profile state when user context updates (after merge/login) ─
  // Only syncs when there are no pending edits to avoid overwriting user input
  useEffect(() => {
    if (user && !hasUnsavedChanges) {
      setProfile({
        displayName: user.displayName || '',
        email: user.email || '',
        timezone: user.timezone || 'UTC',
        avatarUrl: user.avatarUrl || '',
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.displayName, user?.email, user?.timezone])

  // ─── Timezone selector (shared with calendar pages) ───────────────
  const tzState = useTimezones()
  // Sync DB-stored timezone to localStorage on load (without marking unsaved)
  useEffect(() => {
    const dbTz = user?.timezone
    if (dbTz && dbTz !== tzState.primary) {
      tzState.setPrimary(dbTz)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.timezone])

  // ─── Admin powers: load from localStorage ─────────────────────────
  const isAdmin = user?.roles?.includes('admin')
  useEffect(() => {
    if (isAdmin) {
      const stored = localStorage.getItem('adminPowers')
      if (stored) {
        try {
          const parsed = JSON.parse(stored)
          setAdminDeletePower(!!parsed.deletePower)
          setAdminBlockPower(!!parsed.blockPower)
        } catch { /* ignore */ }
      }
    } else {
      // Clear powers if user is not admin
      setAdminDeletePower(false)
      setAdminBlockPower(false)
    }
  }, [isAdmin])

  const toggleAdminPower = (power: 'deletePower' | 'blockPower') => {
    const newDelete = power === 'deletePower' ? !adminDeletePower : adminDeletePower
    const newBlock = power === 'blockPower' ? !adminBlockPower : adminBlockPower
    if (power === 'deletePower') setAdminDeletePower(newDelete)
    if (power === 'blockPower') setAdminBlockPower(newBlock)
    localStorage.setItem('adminPowers', JSON.stringify({ deletePower: newDelete, blockPower: newBlock }))
    window.dispatchEvent(new CustomEvent('adminPowersChanged', { detail: { deletePower: newDelete, blockPower: newBlock } }))
  }

  // ─── Load notification + calendar settings from user's themePreferences ─
  // Falls back to localStorage for calendarSettings for backward compatibility
  useEffect(() => {
    const themePrefs = user?.themePreferences
    if (themePrefs?.notificationSettings) {
      setNotifications(themePrefs.notificationSettings)
    }
    if (themePrefs?.calendarSettings) {
      setCalendarSettings(prev => ({ ...prev, ...themePrefs.calendarSettings }))
    } else {
      // Fallback: read from localStorage (pre-persistence compatibility)
      const saved = localStorage.getItem('userCalendarSettings')
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          setCalendarSettings(prev => ({ ...prev, ...parsed }))
        } catch (e) {
          console.warn('Failed to load saved calendar settings:', e)
        }
      }
    }
    if (themePrefs?.aiSettings) {
      setAiSettings(prev => ({ ...prev, ...themePrefs.aiSettings }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  // ─── Load privacy settings & notification preferences from DB ──
  useEffect(() => {
    if (!session?.access_token) return
    const headers = { Authorization: `Bearer ${session.access_token}` }

    // Load privacy settings
    apiClient.get('/api/privacy-settings', { headers }).then(res => {
      const s = res.data.settings
      if (s) {
        setPrivacyFollowersEnabled(!!s.followers_enabled)
        setPrivacyContactsEnabled(!!s.contacts_enabled)
        setPrivacyPublicEnabled(!!s.public_enabled)
        setFollowersShowEmail(!!s.followers_show_email)
        setFollowersShowPrefs(!!s.followers_show_preferences)
        setFollowersAllowConnections(!!s.followers_allow_connection_requests)
        setContactsShowEmail(!!s.contacts_show_email)
        setContactsShowPrefs(!!s.contacts_show_preferences)
        setContactsAllowConnections(!!s.contacts_allow_connection_requests)
        setPublicShowEmail(!!s.public_show_email)
        setPublicShowPrefs(!!s.public_show_preferences)
        setPublicAllowConnections(!!s.public_allow_connection_requests)
        // Detect outdated public config
        if (s.public_enabled && s.public_features_snapshot) {
          const currentFeatures = ['show_email', 'show_preferences', 'allow_connection_requests']
          const snapshotFeatures = s.public_features_snapshot as string[]
          if (JSON.stringify(currentFeatures) !== JSON.stringify(snapshotFeatures)) {
            setPublicOutdated(true)
          }
        }
      }
    }).catch(err => console.warn('Failed to load privacy settings:', err))

    // Load notification preferences
    apiClient.get('/api/notification-preferences', { headers }).then(res => {
      const p = res.data.preferences
      if (p) {
        setNotifPrefVisibility(p.preference_visibility || 'private')
        const channels: string[] = p.preferred_channels || []
        // Derive channel toggles from stored channels
        setNotifChannelEmail(channels.includes('Email'))
        setNotifChannelDiscord(channels.includes('Discord DM'))
        // Set priority order from channels (enabled ones first, then remaining)
        const allChannels = ['Email', 'Discord DM']
        const orderedPriority = [...channels.filter(c => allChannels.includes(c)), ...allChannels.filter(c => !channels.includes(c))]
        setNotifChannelPriority(orderedPriority)
      }
    }).catch(err => console.warn('Failed to load notification preferences:', err))
   
  }, [session?.access_token])

  // ─── Scroll to section after tab renders ────────────────────
  useEffect(() => {
    const section = searchParams.get('section')
    if (section && !sectionScrolledRef.current) {
      // Wait for DOM to render the section (tab switch may still be pending)
      const timer = setTimeout(() => {
        const el = document.getElementById(`settings-${section}`)
        if (el) {
          sectionScrolledRef.current = true
          const y = el.getBoundingClientRect().top + window.scrollY - 80
          window.scrollTo({ top: y, behavior: 'smooth' })
          const heading = el.querySelector('h2, h3') as HTMLElement | null
          if (heading) {
            heading.style.position = 'relative'
            heading.classList.add('section-highlight')
            const sparks = ['\u2726', '\u2728', '\u269D'].map((char, i) => {
              const spark = document.createElement('span')
              spark.className = `section-spark section-spark-${i + 1}`
              spark.textContent = char
              spark.setAttribute('aria-hidden', 'true')
              return spark
            })
            sparks.forEach(s => heading.appendChild(s))
            setTimeout(() => {
              heading.classList.remove('section-highlight')
              heading.querySelectorAll('.section-spark').forEach(s => s.remove())
            }, 6500)
          }
        }
      }, 200)
      return () => clearTimeout(timer)
    }
  }, [searchParams, activeTab])

  // ─── Track active section via IntersectionObserver ─────────
  useEffect(() => {
    const subcategories = TAB_SUBCATEGORIES[activeTab]
    if (!subcategories || subcategories.length === 0) return

    // Set first section as default active
    setActiveSection(subcategories[0].id)

    const observer = new IntersectionObserver(
      (entries) => {
        // Find the most visible section
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
        if (visible.length > 0) {
          const id = visible[0].target.id.replace('settings-', '')
          setActiveSection(id)
        }
      },
      {
        rootMargin: '-80px 0px -40% 0px',
        threshold: [0, 0.1, 0.25, 0.5, 0.75],
      }
    )

    // Observe all section elements for this tab
    const timer = setTimeout(() => {
      subcategories.forEach(sub => {
        const el = document.getElementById(`settings-${sub.id}`)
        if (el) observer.observe(el)
      })
    }, 50)

    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [activeTab])

  // ─── Handle OAuth redirect result ──────────────────────────
  useEffect(() => {
    const oauthSuccess = searchParams.get('oauth_success')
    const oauthError = searchParams.get('oauth_error')

    if (oauthSuccess) {
      setOauthMessage({ type: 'success', text: 'Google Calendar connected successfully!' })
      setActiveTab('calendar')
      fetchCalendarSources()
      // Clean up URL params
      const newParams = new URLSearchParams(searchParams)
      newParams.delete('oauth_success')
      window.history.replaceState({}, '', `${window.location.pathname}?${newParams.toString()}`)
    } else if (oauthError) {
      setOauthMessage({ type: 'error', text: `Google Calendar connection failed: ${oauthError}` })
      setActiveTab('calendar')
      const newParams = new URLSearchParams(searchParams)
      newParams.delete('oauth_error')
      window.history.replaceState({}, '', `${window.location.pathname}?${newParams.toString()}`)
    }

    // Handle Zoom OAuth redirect result
    const zoomOauthSuccess = searchParams.get('zoom_success')
    const zoomOauthError = searchParams.get('zoom_error')
    if (zoomOauthSuccess) {
      setZoomSuccess('Zoom connected successfully!')
      setActiveTab('calendar')
      // Refetch Zoom integration status with retry (session may not be ready yet after redirect)
      const fetchZoomWithRetry = async (attempts = 3) => {
        for (let i = 0; i < attempts; i++) {
          try {
            const res = await apiClient.get('/api/zoom/integration')
            if (res.data?.integration) {
              setZoomIntegration(res.data.integration)
              return
            }
          } catch { /* retry */ }
          await new Promise(r => setTimeout(r, 1500))
        }
      }
      fetchZoomWithRetry()
      const newParams = new URLSearchParams(searchParams)
      newParams.delete('zoom_success')
      newParams.delete('zoom_return_to')
      window.history.replaceState({}, '', `${window.location.pathname}?${newParams.toString()}`)
    } else if (zoomOauthError) {
      setZoomError(`Zoom connection failed: ${zoomOauthError}`)
      setActiveTab('calendar')
      const newParams = new URLSearchParams(searchParams)
      newParams.delete('zoom_error')
      window.history.replaceState({}, '', `${window.location.pathname}?${newParams.toString()}`)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Fetch calendar sources on mount ────────────────────────
  const fetchCalendarSources = useCallback(async () => {
    if (!session?.access_token) return
    setSourcesLoading(true)
    try {
      const res = await apiClient.get('/api/calendar-sources', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      setCalendarSources(res.data.sources || [])
      setPendingRemoveSourceId(null)
    } catch (err) {
      console.error('Failed to fetch calendar sources:', err)
    } finally {
      setSourcesLoading(false)
    }
  }, [session?.access_token])

  useEffect(() => {
    fetchCalendarSources()
  }, [fetchCalendarSources])

  // ─── Fetch Zoom integration status on mount ─────────────────
  useEffect(() => {
    if (!session?.access_token) return
    setZoomLoading(true)
    apiClient.get('/api/zoom/integration')
      .then(res => setZoomIntegration(res.data?.integration || null))
      .catch(() => setZoomIntegration(null))
      .finally(() => setZoomLoading(false))
  }, [session?.access_token])

  // ─── Fetch verified emails ─────────────────────────────────
  const fetchVerifiedEmails = useCallback(async () => {
    if (!session?.access_token) return
    setLoadingVerifiedEmails(true)
    try {
      const res = await apiClient.get('/api/verified-emails', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      setVerifiedEmails(res.data.emails || [])
    } catch { /* silent */ } finally {
      setLoadingVerifiedEmails(false)
    }
  }, [session?.access_token])

  useEffect(() => {
    fetchVerifiedEmails()
  }, [fetchVerifiedEmails])

  const handleSendVerificationCode = async () => {
    const email = verifyEmailInput.trim().toLowerCase()
    if (!email || !session?.access_token) return
    setVerifyStep('sending')
    setVerifyResult(null)
    try {
      await apiClient.post('/api/verified-emails/send-code', { email }, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      setVerifyPendingEmail(email)
      setVerifyStep('code-sent')
      setVerifyResult({ type: 'success', message: 'Verification code sent! Check your inbox.' })
    } catch (err) {
      setVerifyStep('idle')
      setVerifyResult({ type: 'error', message: (err as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to send verification code' })
    }
  }

  const handleVerifyCode = async () => {
    const code = verifyCodeInput.trim()
    if (!code || !verifyPendingEmail || !session?.access_token) return
    setVerifyStep('verifying')
    setVerifyResult(null)
    try {
      await apiClient.post('/api/verified-emails/verify-code', {
        email: verifyPendingEmail,
        code,
      }, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      setVerifyResult({ type: 'success', message: 'Email verified successfully!' })
      setVerifyStep('idle')
      setVerifyEmailInput('')
      setVerifyCodeInput('')
      setVerifyPendingEmail('')
      fetchVerifiedEmails()
    } catch (err) {
      setVerifyStep('code-sent')
      setVerifyResult({ type: 'error', message: (err as { response?: { data?: { error?: string } } }).response?.data?.error || 'Verification failed' })
    }
  }

  const handleVerifyGoogleEmail = async () => {
    if (!session?.access_token) return
    setVerifyResult(null)
    try {
      const res = await apiClient.post('/api/verified-emails/google', {}, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.data.alreadyVerified) {
        setVerifyResult({ type: 'success', message: 'Your Google email is already verified.' })
      } else {
        setVerifyResult({ type: 'success', message: 'Google email verified!' })
      }
      fetchVerifiedEmails()
    } catch (err) {
      setVerifyResult({ type: 'error', message: (err as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to verify Google email' })
    }
  }

  const handleSetPrimaryEmail = async (id: string) => {
    if (!session?.access_token) return
    try {
      await apiClient.put(`/api/verified-emails/${id}/primary`, {}, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      fetchVerifiedEmails()
    } catch { /* silent */ }
  }

  const handleRemoveVerifiedEmail = async (id: string) => {
    if (!session?.access_token) return
    try {
      await apiClient.delete(`/api/verified-emails/${id}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      fetchVerifiedEmails()
    } catch { /* silent */ }
  }

  // ─── Calendar source actions ────────────────────────────────
  const addGoogleSource = async () => {
    if (!newGoogleName.trim() || !session?.access_token) return
    setSourceActionLoading('add-google')
    try {
      // Request the Google OAuth consent URL from our backend
      const params = new URLSearchParams({
        display_name: newGoogleName.trim(),
        color: newGoogleColor,
      })
      const res = await apiClient.get(`/api/calendar-sources/google/auth-url?${params.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const { authUrl } = res.data
      if (authUrl && /^https:\/\//i.test(authUrl)) {
        // Redirect the user to Google's OAuth consent screen
        window.location.href = authUrl
      } else {
        alert('Failed to generate Google authorization URL')
      }
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to start Google Calendar connection'
      alert(msg)
      setSourceActionLoading(null)
    }
    // Note: no finally — we're navigating away so don't reset loading state
  }

  const addPublicUrlSource = async () => {
    if (!newUrlName.trim() || !newUrlValue.trim() || !session?.access_token) return
    setSourceActionLoading('add-url')
    try {
      await apiClient.post('/api/calendar-sources/public-url', {
        public_url: newUrlValue.trim(),
        display_name: newUrlName.trim(),
        color: newUrlColor,
      }, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      setNewUrlName('')
      setNewUrlValue('')
      setNewUrlColor('#10B981')
      setShowAddPublicUrl(false)
      await fetchCalendarSources()
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to add public calendar'
      alert(msg)
    } finally {
      setSourceActionLoading(null)
    }
  }

  const toggleSourceActive = async (source: CalendarSourceData) => {
    if (!session?.access_token) return
    setSourceActionLoading(source.id)
    try {
      await apiClient.put(`/api/calendar-sources/${source.id}`, {
        is_active: !source.is_active,
      }, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      await fetchCalendarSources()
    } catch (err) {
      console.error('Failed to toggle source:', err)
    } finally {
      setSourceActionLoading(null)
    }
  }

  const updateSourceLabel = async (source: CalendarSourceData, newName: string) => {
    if (!newName.trim() || !session?.access_token) return
    setSourceActionLoading(source.id)
    try {
      await apiClient.put(`/api/calendar-sources/${source.id}`, {
        display_name: newName.trim(),
      }, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      await fetchCalendarSources()
      setEditingSourceId(null)
      setEditingSourceName('')
    } catch (err) {
      console.error('Failed to update source label:', err)
    } finally {
      setSourceActionLoading(null)
    }
  }

  const removeSource = async (source: CalendarSourceData, confirmed = false) => {
    if (!confirmed) {
      setPendingRemoveSourceId(source.id)
      return
    }
    if (!session?.access_token) return
    setSourceActionLoading(source.id)
    try {
      await apiClient.delete(`/api/calendar-sources/${source.id}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      await fetchCalendarSources()
    } catch (err) {
      console.error('Failed to remove source:', err)
    } finally {
      if (pendingRemoveSourceId === source.id) {
        setPendingRemoveSourceId(null)
      }
      setSourceActionLoading(null)
    }
  }

  const handleSave = async () => {
    if (!session?.access_token) return
    setIsSaving(true)

    try {
      // Build merged themePreferences from the live ThemeContext state.
      // Read localStorage to get BOTH mode themeIds (context's activeThemeId
      // only reflects whichever mode is currently active).
      let liveThemePrefs: Record<string, unknown> = {}
      try {
        const raw = localStorage.getItem('theme-preferences')
        if (raw) liveThemePrefs = JSON.parse(raw)
      } catch { /* ignore */ }

      const themePrefsWithSettings = {
        ...(user?.themePreferences ?? {}),  // preserve any extra DB-only fields
        mode: mode,
        darkThemeId: (liveThemePrefs as { darkThemeId?: string | null; lightThemeId?: string | null }).darkThemeId ?? null,
        lightThemeId: (liveThemePrefs as { darkThemeId?: string | null; lightThemeId?: string | null }).lightThemeId ?? null,
        customThemes,
        notificationSettings: notifications,
        calendarSettings: calendarSettings,
        aiSettings: aiSettings,
      }

      await apiClient.put('/api/auth/profile', {
        displayName: profile.displayName,
        timezone: profile.timezone,
        email: profile.email,
        themePreferences: themePrefsWithSettings,
      }, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })

      // Also persist calendar settings to localStorage for CalendarPage backward compat
      localStorage.setItem('userCalendarSettings', JSON.stringify(calendarSettings))

      await refreshProfile()
      reloadThemeFromBackend()
      setHasUnsavedChanges(false)
    } catch (err) {
      console.error('Failed to save settings:', err)
      alert((err as { response?: { data?: { error?: string } } }).response?.data?.error || (err as { message?: string }).message || 'Failed to save settings. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  // ─── Auto-save: Privacy settings (instant on toggle) ───────
  const savePrivacyNow = useCallback(async (overrides?: {
    followersEnabled?: boolean, contactsEnabled?: boolean, publicEnabled?: boolean,
    fEmail?: boolean, fPrefs?: boolean, fConn?: boolean,
    cEmail?: boolean, cPrefs?: boolean, cConn?: boolean,
    pEmail?: boolean, pPrefs?: boolean, pConn?: boolean,
  }) => {
    if (!session?.access_token) return
    const fE = overrides?.followersEnabled ?? privacyFollowersEnabled
    const cE = overrides?.contactsEnabled ?? privacyContactsEnabled
    const pE = overrides?.publicEnabled ?? privacyPublicEnabled
    const currentPublicFeatures = ['show_email', 'show_preferences', 'allow_connection_requests']
    try {
      await apiClient.put('/api/privacy-settings', {
        followers_enabled: fE,
        contacts_enabled: cE,
        public_enabled: pE,
        followers_show_email: overrides?.fEmail ?? followersShowEmail,
        followers_show_preferences: overrides?.fPrefs ?? followersShowPrefs,
        followers_allow_connection_requests: overrides?.fConn ?? followersAllowConnections,
        contacts_show_email: overrides?.cEmail ?? contactsShowEmail,
        contacts_show_preferences: overrides?.cPrefs ?? contactsShowPrefs,
        contacts_allow_connection_requests: overrides?.cConn ?? contactsAllowConnections,
        public_show_email: overrides?.pEmail ?? publicShowEmail,
        public_show_preferences: overrides?.pPrefs ?? publicShowPrefs,
        public_allow_connection_requests: overrides?.pConn ?? publicAllowConnections,
        public_features_snapshot: pE ? currentPublicFeatures : null,
      }, { headers: { Authorization: `Bearer ${session.access_token}` } })
      if (pE) setPublicOutdated(false)
    } catch (err) {
      console.error('Privacy auto-save failed:', err)
    }
  }, [session?.access_token, privacyFollowersEnabled, privacyContactsEnabled, privacyPublicEnabled,
      followersShowEmail, followersShowPrefs, followersAllowConnections,
      contactsShowEmail, contactsShowPrefs, contactsAllowConnections,
      publicShowEmail, publicShowPrefs, publicAllowConnections])

  // ─── Auto-save: Notification preferences (instant on toggle) ───
  const saveNotifPrefsNow = useCallback(async (overrides?: {
    channelEmail?: boolean, channelDiscord?: boolean,
    visibility?: string, priority?: string[],
  }) => {
    if (!session?.access_token) return
    const email = overrides?.channelEmail ?? notifChannelEmail
    const discord = overrides?.channelDiscord ?? notifChannelDiscord
    const vis = overrides?.visibility ?? notifPrefVisibility
    const prio = overrides?.priority ?? notifChannelPriority
    const channelToggles: Record<string, boolean> = { 'Email': email, 'Discord DM': discord }
    try {
      await apiClient.put('/api/notification-preferences', {
        preference_description: '',
        preferred_channels: Object.entries(channelToggles).filter(([, v]) => v).map(([k]) => k),
        preference_visibility: vis,
        channel_toggles: channelToggles,
        channel_priority: prio,
      }, { headers: { Authorization: `Bearer ${session.access_token}` } })
    } catch (err) {
      console.error('Notification prefs auto-save failed:', err)
    }
  }, [session?.access_token, notifChannelEmail, notifChannelDiscord, notifPrefVisibility, notifChannelPriority])

  // ─── Auto-save: Profile + theme prefs (for selects/toggles) ───
  const saveProfileNow = useCallback(async (overrides?: {
    notifs?: NotificationSettings, calendar?: CalendarSettings, ai?: AiSettings,
  }) => {
    if (!session?.access_token) return
    try {
      let liveThemePrefs: Record<string, unknown> = {}
      try {
        const raw = localStorage.getItem('theme-preferences')
        if (raw) liveThemePrefs = JSON.parse(raw)
      } catch { /* ignore */ }

      const themePrefsWithSettings = {
        ...(user?.themePreferences ?? {}),
        mode: mode,
        darkThemeId: (liveThemePrefs as { darkThemeId?: string | null; lightThemeId?: string | null }).darkThemeId ?? null,
        lightThemeId: (liveThemePrefs as { darkThemeId?: string | null; lightThemeId?: string | null }).lightThemeId ?? null,
        customThemes,
        notificationSettings: overrides?.notifs ?? notifications,
        calendarSettings: overrides?.calendar ?? calendarSettings,
        aiSettings: overrides?.ai ?? aiSettings,
      }

      await apiClient.put('/api/auth/profile', {
        displayName: profile.displayName,
        timezone: profile.timezone,
        email: profile.email,
        themePreferences: themePrefsWithSettings,
      }, { headers: { Authorization: `Bearer ${session.access_token}` } })

      localStorage.setItem('userCalendarSettings', JSON.stringify(overrides?.calendar ?? calendarSettings))
    } catch (err) {
      console.error('Profile auto-save failed:', err)
    }
  }, [session?.access_token, user?.themePreferences, mode, customThemes,
      notifications, calendarSettings, aiSettings, profile.displayName, profile.timezone, profile.email])

  const handleLogout = async () => {
    await logout()
    navigate('/')
  }

  const handleDeleteAccount = async () => {
    if (!confirm('Are you sure you want to delete your account? This action cannot be undone.')) return
    try {
      if (session?.access_token) {
        await apiClient.delete('/api/auth/account', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
      }
      await logout()
      navigate('/auth/login')
    } catch (err) {
      console.error('Failed to delete account:', err)
      alert('Failed to delete account. Please try again.')
    }
  }

  const updateProfile = (updates: Partial<UserProfile>) => {
    setProfile(prev => ({ ...prev, ...updates }))
    setHasUnsavedChanges(true)
  }

  // Wrap timezone hook so changes also update profile state (for DB save)
  const profileTzState: UseTimezonesReturn = {
    ...tzState,
    setPrimary: (iana: string) => {
      tzState.setPrimary(iana)
      updateProfile({ timezone: iana })
    },
    replaceTimezone: (slot: number, iana: string) => {
      tzState.replaceTimezone(slot, iana)
      if (slot === 0) updateProfile({ timezone: iana })
    },
  }

  const updateNotifications = (updates: Partial<NotificationSettings>) => {
    setNotifications(prev => {
      const next = { ...prev, ...updates }
      // Auto-save: reminder times are stored in profile.themePreferences
      saveProfileNow({ notifs: next })
      return next
    })
  }

  const updateCalendarSettings = (updates: Partial<CalendarSettings>) => {
    setCalendarSettings(prev => {
      const next = { ...prev, ...updates }
      saveProfileNow({ calendar: next })
      return next
    })
  }

  const _updatePrivacy = (updates: Partial<PrivacySettings>) => {
    setPrivacy(prev => ({ ...prev, ...updates }))
  }

  const updateAiSettings = (updates: Partial<AiSettings>) => {
    setAiSettings(prev => {
      const next = { ...prev, ...updates }
      saveProfileNow({ ai: next })
      return next
    })
  }

  const toggleReminderTime = (time: string) => {
    const newTimes = notifications.reminderTimes.includes(time)
      ? notifications.reminderTimes.filter(t => t !== time)
      : [...notifications.reminderTimes, time]
    updateNotifications({ reminderTimes: newTimes })
  }

  const tabs = [
    { id: 'profile' as const, label: 'Profile', icon: User },
    { id: 'notifications' as const, label: 'Notifications', icon: Bell },
    { id: 'calendar' as const, label: 'Calendar', icon: Calendar },
    { id: 'ai' as const, label: 'AI', icon: Sparkles },
    { id: 'privacy' as const, label: 'Privacy', icon: Shield },
  ]

  const scrollToSection = (sectionId: string) => {
    const el = document.getElementById(`settings-${sectionId}`)
    if (el) {
      // Immediately select this quicklink
      setActiveSection(sectionId)
      // Scroll with offset for the navbar
      const y = el.getBoundingClientRect().top + window.scrollY - 80
      window.scrollTo({ top: y, behavior: 'smooth' })
      // Flash highlight on the section heading (h2 or h3)
      const heading = el.querySelector('h2, h3') as HTMLElement | null
      if (heading) {
        heading.classList.remove('section-highlight')
        heading.querySelectorAll('.section-spark').forEach(s => s.remove())
        void heading.offsetWidth // force reflow to restart animation
        heading.style.position = 'relative'
        heading.classList.add('section-highlight')
        // Add spark elements
        const sparks = ['\u2726', '\u2728', '\u269D'].map((char, i) => {
          const spark = document.createElement('span')
          spark.className = `section-spark section-spark-${i + 1}`
          spark.textContent = char
          spark.setAttribute('aria-hidden', 'true')
          return spark
        })
        sparks.forEach(s => heading.appendChild(s))
        setTimeout(() => {
          heading.classList.remove('section-highlight')
          heading.querySelectorAll('.section-spark').forEach(s => s.remove())
        }, 6500)
      }
    }
  }

  const handleTabChange = (tab: SettingsTab) => {
    setActiveTab(tab)
    navigate(`/settings?tab=${tab}`)
  }

  const renderProfileTab = () => (
    <div className="space-y-6">
      <div id="settings-profile-info">
        <h3 className="text-lg font-medium mb-4">Profile Information</h3>
        
        {/* Avatar */}
        <div className="flex items-center gap-4 mb-6">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-2xl font-bold overflow-hidden">
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt={profile.displayName || ''} className="w-full h-full object-cover" referrerPolicy="no-referrer" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
            ) : null}
            {!user?.avatarUrl && profile.displayName.charAt(0).toUpperCase()}
          </div>
          <div>
            <button className="px-4 py-2 text-sm font-medium text-primary border border-primary rounded-lg hover:bg-primary/10 transition-colors">
              Change avatar
            </button>
            <p className="mt-1 text-xs text-muted-foreground">JPG, PNG or GIF. Max 2MB.</p>
          </div>
        </div>
        
        <div className="grid gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Display name</label>
            <input
              type="text"
              value={profile.displayName}
              onChange={(e) => updateProfile({ displayName: e.target.value })}
              className="w-full px-4 py-2.5 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-ring outline-none bg-background text-foreground"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Timezone</label>
            <p className="text-xs text-muted-foreground mb-2">
              Sets the default timezone across all your calendars.
            </p>
            <TimezoneSelector timezones={profileTzState} />
          </div>

          {/* Inline Save — only for display name + timezone changes */}
          <div className={`transition-all duration-300 overflow-hidden ${hasUnsavedChanges ? 'max-h-16 opacity-100' : 'max-h-0 opacity-0'}`}>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-all disabled:opacity-50"
            >
              <Save className={`h-4 w-4 ${isSaving ? 'animate-spin' : ''}`} />
              {isSaving ? 'Saving...' : 'Save profile'}
            </button>
          </div>
        </div>
      </div>

      {/* Role & Permissions */}
      <div id="settings-role-info" className="pt-6 border-t border-border">
        <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          Role &amp; Permissions
        </h3>

        {/* Current Role Badges — dynamically include oversight when enabled */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Your Roles</label>
          <div className="flex flex-wrap items-center gap-2">
            {(() => {
              const rawRoles = user?.roles || ['user']
              const rolesArray = Array.isArray(rawRoles) ? rawRoles : (typeof rawRoles === 'string' ? (() => { try { const p = JSON.parse(rawRoles); return Array.isArray(p) ? p : ['user'] } catch { return ['user'] } })() : ['user'])
              const baseRoles = [...new Set(rolesArray)]
              // Add oversight dynamically if sentimentToolEnabled but not yet in DB roles
              let displayRoles = aiSettings.sentimentToolEnabled && !baseRoles.includes('oversight')
                ? [...baseRoles, 'oversight']
                : !aiSettings.sentimentToolEnabled && baseRoles.includes('oversight') && !user?.roles?.includes('admin')
                ? baseRoles.filter((r: string) => r !== 'oversight')
                : baseRoles
              // Add learner dynamically if learnerMode is enabled
              if (learnerMode && !displayRoles.includes('learner')) {
                displayRoles = [...displayRoles, 'learner']
              } else if (!learnerMode) {
                displayRoles = displayRoles.filter((r: string) => r !== 'learner')
              }
              return displayRoles.map((r: string) => (
                <span key={r} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                  r === 'admin'
                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
                    : r === 'moderator'
                    ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300'
                    : r === 'oversight'
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                    : r === 'learner'
                    ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
                    : r === 'traveler'
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                    : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                }`}>
                  {r === 'admin' && <Shield className="h-3.5 w-3.5" />}
                  {r === 'moderator' && <ShieldCheck className="h-3.5 w-3.5" />}
                  {r === 'oversight' && <Eye className="h-3.5 w-3.5" />}
                  {r === 'learner' && <BookOpen className="h-3.5 w-3.5" />}
                  {r === 'traveler' && <Globe className="h-3.5 w-3.5" />}
                  {r === 'user' && <UserCircle className="h-3.5 w-3.5" />}
                  {r === 'admin' ? 'Admin' : r === 'moderator' ? 'Moderator' : r === 'oversight' ? 'Oversight' : r === 'learner' ? 'Learner' : r === 'traveler' ? 'Traveler' : 'User'}
                </span>
              ))
            })()}
          </div>
        </div>

        {/* Account Type */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">Account Type</label>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-muted text-muted-foreground">
              {!isAuthenticated && <><UserCircle className="h-3.5 w-3.5" /> No Account</>}
              {isAuthenticated && isTraveler && <><Globe className="h-3.5 w-3.5" /> Traveler Account</>}
              {isAuthenticated && !isTraveler && user?.walletAddress && user?.email && !user.email.endsWith('@traveler.local') && <><Merge className="h-3.5 w-3.5" /> Multi Account</>}
              {isAuthenticated && !isTraveler && user?.walletAddress && (!user?.email || user.email.endsWith('@traveler.local')) && <><Wallet className="h-3.5 w-3.5" /> Cardano Wallet</>}
              {isAuthenticated && !isTraveler && !user?.walletAddress && <><Mail className="h-3.5 w-3.5" /> Google Account</>}
            </span>
          </div>
        </div>

        {/* Role descriptions */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-muted-foreground">Platform Roles</h4>

          <div className={`p-3 rounded-lg border ${user?.roles?.includes('admin') ? 'border-rose-200 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/20' : 'border-border'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 mb-1">
                <Shield className="h-4 w-4 text-rose-500" />
                <span className="text-sm font-medium">Admin</span>
                {isAdmin && (adminDeletePower || adminBlockPower) && (
                  <span className="ml-1 px-2 py-0.5 text-xs font-medium bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300 rounded-full">
                    {[adminDeletePower && 'Delete', adminBlockPower && 'Block'].filter(Boolean).join(' + ')} Active
                  </span>
                )}
              </div>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setAdminPowersExpanded(prev => !prev)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronDown className={`h-4 w-4 transition-transform ${adminPowersExpanded ? 'rotate-0' : '-rotate-90'}`} />
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Platform administrator can read everyone's feedback and respond to platform feedback.
            </p>

            {/* Admin Powers — expandable, only visible to admins */}
            {isAdmin && adminPowersExpanded && (
              <div className="mt-3 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Toggle elevated privileges on demand. Powers are session-local and not stored on the server.
                </p>

                {/* Delete Content Power */}
                <div className={`p-4 rounded-lg border transition-colors ${adminDeletePower ? 'border-rose-200 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/20' : 'border-border'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${adminDeletePower ? 'bg-rose-100 dark:bg-rose-900/40' : 'bg-muted'}`}>
                        <Trash2 className={`h-4 w-4 ${adminDeletePower ? 'text-rose-500 dark:text-rose-400' : 'text-muted-foreground'}`} />
                      </div>
                      <div>
                        <p className="text-sm font-medium">Delete Content</p>
                        <p className="text-xs text-muted-foreground">
                          Delete any user's calendars from the Coordination Calendars page, including ones you don't own.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleAdminPower('deletePower')}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {adminDeletePower ? (
                        <ToggleRight className="h-7 w-7 text-rose-500" />
                      ) : (
                        <ToggleLeft className="h-7 w-7" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Block Users Power */}
                <div className={`p-4 rounded-lg border transition-colors ${adminBlockPower ? 'border-rose-200 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/20' : 'border-border'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${adminBlockPower ? 'bg-rose-100 dark:bg-rose-900/40' : 'bg-muted'}`}>
                        <UserX className={`h-4 w-4 ${adminBlockPower ? 'text-rose-500 dark:text-rose-400' : 'text-muted-foreground'}`} />
                      </div>
                      <div>
                        <p className="text-sm font-medium">Block Users</p>
                        <p className="text-xs text-muted-foreground">
                          Access the User List to view all accounts, copy user IDs from calendar pages, and silence users to restrict their access.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleAdminPower('blockPower')}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {adminBlockPower ? (
                        <ToggleRight className="h-7 w-7 text-rose-500" />
                      ) : (
                        <ToggleLeft className="h-7 w-7" />
                      )}
                    </button>
                  </div>
                </div>

                {adminBlockPower && (
                  <div className="p-3 bg-card rounded-lg border border-border text-xs text-muted-foreground space-y-1">
                    <p className="flex items-center gap-1.5">
                      <Info className="h-3 w-3 shrink-0" />
                      <strong>User List</strong> is now available in the navigation Tools menu.
                    </p>
                    <p className="flex items-center gap-1.5">
                      <Info className="h-3 w-3 shrink-0" />
                      Creator names on calendar pages are now clickable to copy their user ID.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className={`p-3 rounded-lg border ${user?.roles?.includes('moderator') ? 'border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/20' : 'border-border'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck className="h-4 w-4 text-orange-500" />
                <span className="text-sm font-medium">Moderator</span>
                {user?.roles?.includes('moderator') && (
                  <span className="ml-1 px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 rounded-full">
                    Active
                  </span>
                )}
              </div>
              {/* Toggle — only admins can self-toggle, moderators (non-admin) cannot remove it */}
              {isAdmin && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const newVal = !user?.roles?.includes('moderator')
                      await apiClient.post('/api/admin/moderator-overlay', { enabled: newVal })
                      await refreshProfile()
                    } catch { /* ignore */ }
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title={user?.roles?.includes('moderator') ? 'Remove Moderator Overlay' : 'Enable Moderator Overlay'}
                >
                  {user?.roles?.includes('moderator') ? (
                    <ToggleRight className="h-7 w-7 text-orange-500" />
                  ) : (
                    <ToggleLeft className="h-7 w-7" />
                  )}
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Moderators have access to the Discord Guardian moderation dashboard, where they can manage filter rules,
              review flagged messages, and configure the Guardian bot.
              {isAdmin && ' As an admin, you can toggle this overlay to access Guardian features.'}
              {!isAdmin && user?.roles?.includes('moderator') && ' This role was assigned by a platform administrator.'}
            </p>
          </div>

          <div className={`p-3 rounded-lg border ${(user?.roles?.includes('oversight') || aiSettings.sentimentToolEnabled) ? 'border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20' : 'border-border'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 mb-1">
                <Eye className="h-4 w-4 text-amber-500" />
                <span className="text-sm font-medium">Oversight</span>
              </div>
              {/* Toggle — inline in card, visible to all non-traveler authenticated users */}
              {isAuthenticated && !isTraveler && (
                <button
                  type="button"
                  onClick={() => {
                    const newVal = !aiSettings.sentimentToolEnabled
                    const next = { ...aiSettings, sentimentToolEnabled: newVal }
                    setAiSettings(next)
                    saveProfileNow({ ai: next })
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title={aiSettings.sentimentToolEnabled ? 'Disable Oversight role' : 'Enable Oversight role'}
                >
                  {aiSettings.sentimentToolEnabled ? (
                    <ToggleRight className="h-7 w-7 text-amber-500" />
                  ) : (
                    <ToggleLeft className="h-7 w-7" />
                  )}
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Oversight members have access to expanded sentiment analysis tools on AI chat responses 
              and full system prompt transparency -- every AI request shows the complete prompt sent to the model.
              They can provide detailed feedback with a 2D sentiment grid to help improve the platform experience.
            </p>

            {/* Learn more — expandable, independent of the toggle */}
            {isAuthenticated && !isTraveler && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setOversightInfoExpanded(prev => !prev)}
                  className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 hover:underline"
                >
                  <Info className="h-3 w-3" />
                  {oversightInfoExpanded ? 'Hide details' : 'Learn more'}
                  {oversightInfoExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </button>

                {oversightInfoExpanded && (
                  <div className="mt-3 p-3 bg-background/60 rounded-lg border border-border space-y-3">
                    {/* What oversight users can do */}
                    <div>
                      <h5 className="text-xs font-medium mb-1.5">What Oversight users can do:</h5>
                      <ul className="text-xs text-muted-foreground space-y-1">
                        <li className="flex items-start gap-1.5">
                          <Sparkles className="h-3 w-3 mt-0.5 text-amber-500 shrink-0" />
                          Rate AI responses using a 2D sentiment grid (valence + trust)
                        </li>
                        <li className="flex items-start gap-1.5">
                          <MessageSquare className="h-3 w-3 mt-0.5 text-amber-500 shrink-0" />
                          Add written feedback alongside sentiment ratings
                        </li>
                        <li className="flex items-start gap-1.5">
                          <Eye className="h-3 w-3 mt-0.5 text-amber-500 shrink-0" />
                          Review your own submitted feedback on the Feedback page (AI Feedback tab)
                        </li>
                        <li className="flex items-start gap-1.5">
                          <Eye className="h-3 w-3 mt-0.5 text-amber-500 shrink-0" />
                          View the full system prompt sent to the AI model in an expandable "System" bubble on every AI Assistant response
                        </li>
                      </ul>
                    </div>

                    {/* Where sentiment tools are available */}
                    <div>
                      <h5 className="text-xs font-medium mb-1.5">Where sentiment tools are available:</h5>
                      <ul className="text-xs text-muted-foreground space-y-1">
                        <li className="flex items-center gap-1.5">
                          <Bot className="h-3 w-3 text-amber-500 shrink-0" />
                          <span><strong>AI Chat</strong> — sentiment grid appears on each AI response</span>
                        </li>
                      </ul>
                    </div>

                    {/* Grid demo */}
                    <div>
                      <p className="text-xs text-muted-foreground mb-2 font-medium">Sentiment Grid Preview — drag the pointer to explore:</p>
                      <SentimentGrid
                        valence={demoValence}
                        trust={demoTrust}
                        onChange={(v, t) => { setDemoValence(v); setDemoTrust(t) }}
                        size={200}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className={`p-3 rounded-lg border ${learnerMode ? 'border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/20' : 'border-border'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 mb-1">
                <BookOpen className="h-4 w-4 text-purple-500" />
                <span className="text-sm font-medium">Learner</span>
              </div>
              {isAuthenticated && !isTraveler && (
                <button
                  type="button"
                  onClick={() => setLearnerMode(!learnerMode)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title={learnerMode ? 'Disable Learner mode' : 'Enable Learner mode'}
                >
                  {learnerMode ? (
                    <ToggleRight className="h-7 w-7 text-purple-500" />
                  ) : (
                    <ToggleLeft className="h-7 w-7" />
                  )}
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Learner mode shows contextual help icons throughout the platform, explaining what each feature does and how to use it. Ideal for new users or anyone exploring the platform.
            </p>
          </div>

          <div className={`p-3 rounded-lg border ${user?.roles?.includes('user') || (!user?.roles?.length) ? 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20' : 'border-border'}`}>
            <div className="flex items-center gap-2 mb-1">
              <UserCircle className="h-4 w-4 text-green-500" />
              <span className="text-sm font-medium">User</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Standard platform user. Account types include: No Account (guest), Traveler Account 
              (temporary), Google Account (full), Cardano Wallet user, or Multi Account 
              (linked Google + Wallet).
            </p>
          </div>

        </div>

      </div>


      
      {/* Theme */}
      <div id="settings-appearance" className="pt-6 border-t border-border">
        <h3 className="text-lg font-medium mb-4">Appearance</h3>
        
        {/* Theme mode selector */}
        <div className="mb-6">
          <p className="text-sm font-medium mb-2">Theme Mode</p>
          <div className="flex gap-2">
            {[
              { value: 'light' as const, icon: Sun, label: 'Light' },
              { value: 'dark' as const, icon: Moon, label: 'Dark' },
              { value: 'system' as const, icon: Monitor, label: 'System' },
            ].map(opt => {
              const Icon = opt.icon
              return (
                <button
                  key={opt.value}
                  onClick={() => setMode(opt.value)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors border ${
                    mode === opt.value
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {opt.label}
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {mode === 'system' ? `System preference detected: ${isDark ? 'dark' : 'light'}` : `Currently using ${mode} theme`}
          </p>
        </div>

        {/* Color Theme Creator — comprehensive, Discord-style */}
        {isAuthenticated && !isTraveler && (
          <div className="mt-4 p-4 bg-card rounded-lg border border-border">
            <div className="flex items-center gap-3 mb-4">
              <Palette className="h-5 w-5 text-primary" />
              <div>
                <p className="font-medium">Color Overlay <span className="text-xs font-normal text-muted-foreground ml-1">({isDark ? 'Dark' : 'Light'} mode)</span></p>
                <p className="text-sm text-muted-foreground">Apply a color overlay on top of the current {isDark ? 'dark' : 'light'} theme. Each mode remembers its own overlay independently.</p>
              </div>
            </div>
            <ThemeCreator
              isDark={isDark}
              activeThemeId={activeThemeId}
              customThemes={customThemes}
              onApplyTheme={applyTheme}
              onSaveCustomTheme={saveCustomTheme}
              onDeleteCustomTheme={deleteCustomTheme}
            />
          </div>
        )}

        {isAuthenticated && isTraveler && (
          <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg">
            <p className="text-sm text-amber-700 dark:text-amber-300">
              Color themes are available for registered accounts. Sign in with Google to unlock this feature.
            </p>
          </div>
        )}
      </div>
    </div>
  )

  const notifPrefsEnabledInPrivacy =
    (followersShowPrefs && privacyFollowersEnabled) ||
    (contactsShowPrefs && privacyContactsEnabled)

  const renderNotificationsTab = () => (
    <div className="space-y-6">

      {/* ─── Facilitator note ────────────────────────────────── */}
      <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
          <div className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
            <p>Even if notifications are disabled, facilitators can still contact you directly.</p>
            <p className="text-xs text-blue-600 dark:text-blue-400">
              Disabling notifications stops emails for event invites and updates. Some emails may still come through -- for example if the privacy policy changes or core components change that affect your experience going forward.
            </p>
          </div>
        </div>
      </div>

      {/* ─── Notification Channels ───────────────────────────── */}
      <div id="settings-channels">
        <h3 className="text-lg font-medium mb-2">Notification Channels</h3>

        <p className="text-sm text-muted-foreground mb-4">
          Toggle which notification channels are active. Opt-out links in emails and the Discord bot still work independently.
        </p>

        <div className="space-y-3">
          <div className={`flex flex-col gap-3 p-4 bg-card rounded-lg border-2 transition-colors sm:flex-row sm:items-center sm:justify-between ${notifChannelEmail ? 'border-blue-400 dark:border-blue-500' : 'border-rose-300 dark:border-rose-500/60'}`}>
            <div className="flex items-center gap-3 min-w-0">
              <Mail className="w-5 h-5 text-muted-foreground" />
              <div className="min-w-0">
                <p className="font-medium">Email notifications</p>
                <p className="text-sm text-muted-foreground">Receive announcements and updates via email</p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <span className={`text-xs font-medium ${notifChannelEmail ? 'text-blue-600 dark:text-blue-400' : 'text-rose-500 dark:text-rose-400'}`}>
                {notifChannelEmail ? 'On' : 'Off'}
              </span>
              <button
                onClick={() => { const next = !notifChannelEmail; setNotifChannelEmail(next); saveNotifPrefsNow({ channelEmail: next }) }}
                aria-label="Toggle email notifications"
                aria-pressed={notifChannelEmail}
                className={`relative w-12 h-6 rounded-full transition-colors ${notifChannelEmail ? 'bg-blue-500' : 'bg-rose-300 dark:bg-rose-500/60'}`}
              >
                <span className={`absolute top-1 w-4 h-4 rounded-full transition-all shadow-[0_1px_3px_rgba(0,0,0,0.3)] ${notifChannelEmail ? 'left-7 bg-white' : 'left-1 bg-white dark:bg-gray-200'}`} />
              </button>
            </div>
          </div>

          <div className={`flex flex-col gap-3 p-4 bg-card rounded-lg border-2 transition-colors sm:flex-row sm:items-center sm:justify-between ${notifChannelDiscord ? 'border-blue-400 dark:border-blue-500' : 'border-rose-300 dark:border-rose-500/60'}`}>
            <div className="flex items-center gap-3 min-w-0">
              <MessageSquare className="w-5 h-5 text-muted-foreground" />
              <div className="min-w-0">
                <p className="font-medium">Discord notifications</p>
                <p className="text-sm text-muted-foreground">Receive DMs via Discord bot</p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <span className={`text-xs font-medium ${notifChannelDiscord ? 'text-blue-600 dark:text-blue-400' : 'text-rose-500 dark:text-rose-400'}`}>
                {notifChannelDiscord ? 'On' : 'Off'}
              </span>
              <button
                onClick={() => { const next = !notifChannelDiscord; setNotifChannelDiscord(next); saveNotifPrefsNow({ channelDiscord: next }) }}
                aria-label="Toggle discord notifications"
                aria-pressed={notifChannelDiscord}
                className={`relative w-12 h-6 rounded-full transition-colors ${notifChannelDiscord ? 'bg-blue-500' : 'bg-rose-300 dark:bg-rose-500/60'}`}
              >
                <span className={`absolute top-1 w-4 h-4 rounded-full transition-all shadow-[0_1px_3px_rgba(0,0,0,0.3)] ${notifChannelDiscord ? 'left-7 bg-white' : 'left-1 bg-white dark:bg-gray-200'}`} />
              </button>
            </div>
          </div>
        </div>

        {/* ── Notification Preferences (expandable) ── */}
        <div id="settings-notification-preferences" className="mt-4 border border-border rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setNotifPrefsExpanded(!notifPrefsExpanded)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">Notification Preferences</span>
            </div>
            {notifPrefsExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          </button>

          {notifPrefsExpanded && (
            <div className="border-t border-border px-4 py-4 space-y-4">
              {!notifPrefsEnabledInPrivacy ? (
                /* Privacy gate: prefs are not visible to anyone */
                <div className="text-center py-4 space-y-3">
                  <div className="w-12 h-12 rounded-full mx-auto flex items-center justify-center bg-amber-100 dark:bg-amber-900/50">
                    <Shield className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Notification Preferences are hidden</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Enable "Show notification preferences" in the Privacy tab first so others can see how you prefer to be contacted.
                    </p>
                  </div>
                  <button
                    onClick={() => navigate('/settings?tab=privacy&section=visibility')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    <Shield className="w-4 h-4" />
                    Go to Privacy Settings
                  </button>
                </div>
              ) : (
                /* Normal content: channel priority + visibility notice */
                <>
              <p className="text-sm text-muted-foreground">
                Set your channel priority order. This helps others know which channel to reach you on first.
              </p>

              {/* Channel Priority Order */}
              <div>
                <label className="text-sm font-medium block mb-1">Channel Priority Order</label>
                <p className="text-xs text-muted-foreground mb-2">
                  Drag channels up or down to set your preferred delivery order. Highest priority first.
                </p>
                <div className="space-y-1">
                  {notifChannelPriority.map((channel, index) => (
                    <div
                      key={channel}
                      className="flex items-center gap-2 p-2.5 bg-card rounded-lg border border-border"
                    >
                      <span className="text-xs font-mono text-muted-foreground w-5 text-center">{index + 1}</span>
                      <span className="text-sm flex-1">{channel}</span>
                      <div className="flex gap-0.5">
                        <button
                          onClick={() => {
                            if (index === 0) return
                            const newOrder = [...notifChannelPriority]
                            ;[newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]]
                            setNotifChannelPriority(newOrder)
                            saveNotifPrefsNow({ priority: newOrder })
                          }}
                          disabled={index === 0}
                          className="p-1 rounded hover:bg-muted transition-colors disabled:opacity-30"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            if (index === notifChannelPriority.length - 1) return
                            const newOrder = [...notifChannelPriority]
                            ;[newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]]
                            setNotifChannelPriority(newOrder)
                            saveNotifPrefsNow({ priority: newOrder })
                          }}
                          disabled={index === notifChannelPriority.length - 1}
                          className="p-1 rounded hover:bg-muted transition-colors disabled:opacity-30"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Visibility notice when preferences are private */}
              {showPrefVisibilityNotice && notifPrefVisibility === 'private' && (
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 space-y-2">
                  <div className="flex items-start gap-2">
                    <Info className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                    <div className="text-sm text-amber-800 dark:text-amber-200">
                      <p>Your notification preferences are currently <strong>private</strong>. Nobody other than you can see these preferences.</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 ml-6">
                    <button
                      onClick={() => {
                        setNotifPrefVisibility('followers')
                        setShowPrefVisibilityNotice(false)
                        saveNotifPrefsNow({ visibility: 'followers' })
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Show to Calendar Followers
                    </button>
                    <button
                      onClick={() => {
                        navigate('/settings?tab=privacy&section=visibility')
                        setShowPrefVisibilityNotice(false)
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border hover:bg-muted transition-colors"
                    >
                      <Shield className="w-3.5 h-3.5" />
                      Profile Visibility Options
                    </button>
                    <button
                      onClick={() => setShowPrefVisibilityNotice(false)}
                      className="text-xs text-muted-foreground hover:text-foreground ml-1"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ─── Event Reminders (future feature — interest signal) ── */}
      <div id="settings-reminders" className="pt-6 border-t border-border">
        <h3 className="text-lg font-medium mb-1">Event Reminders</h3>
        <div className="inline-flex items-center gap-1.5 bg-primary/10 text-primary text-xs font-medium px-2 py-0.5 rounded-full mb-3">
          <HelpCircle className="w-3 h-3" />
          Coming soon
        </div>
        <p className="text-sm text-muted-foreground mb-1">
          The idea: when you register for an event, you automatically receive reminders through your
          private notification channel at the intervals you choose below.
        </p>
        <p className="text-sm text-muted-foreground mb-4">
          This feature is not yet implemented. <span className="font-medium text-foreground">Selecting a preference here signals your interest</span> and
          helps us prioritise the rollout.
        </p>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              if (notifications.reminderTimes.length > 0) {
                updateNotifications({ reminderTimes: [] })
              }
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              notifications.reminderTimes.length === 0
                ? 'bg-foreground text-background'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            Not interested
          </button>
          {[
            { value: '0', label: 'At start' },
            { value: '15', label: '15 min before' },
            { value: '30', label: '30 min before' },
            { value: '60', label: '1 hour before' },
            { value: '1440', label: '1 day before' },
          ].map(option => (
            <button
              key={option.value}
              onClick={() => toggleReminderTime(option.value)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                notifications.reminderTimes.includes(option.value)
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Your selection is saved as a preference and will be applied automatically when reminders are introduced.
        </p>
      </div>

    </div>
  )

  const renderCalendarTab = () => {
    const googleSources = calendarSources.filter(s => s.source_type === 'google_oauth')
    const urlSources = calendarSources.filter(s => s.source_type === 'google_public_url')

    return (
    <div className="space-y-6">
      {/* ─── OAuth result banner ─────────────────────────────── */}
      {oauthMessage && (
        <div className={`p-4 rounded-lg border flex items-start justify-between ${
          oauthMessage.type === 'success'
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-rose-50 border-rose-200 text-rose-700'
        }`}>
          <div className="flex items-center gap-2">
            {oauthMessage.type === 'success' ? (
              <svg className="h-5 w-5 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <AlertCircle className="h-5 w-5 text-rose-500 flex-shrink-0" />
            )}
            <p className="text-sm font-medium">{oauthMessage.text}</p>
          </div>
          <button
            onClick={() => setOauthMessage(null)}
            className="text-muted-foreground hover:text-foreground ml-4"
          >
            &times;
          </button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          Subcategory: Network Connections
          ═══════════════════════════════════════════════════════ */}
      <div id="settings-connections">
        <h2 className="text-xl font-semibold mb-1">Network Connections</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Manage your connected Google Calendar accounts and public calendar URLs.
        </p>
      </div>

      {/* ─── Connected Google Calendars ──────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-medium">Google Calendar Accounts</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Connect calendars from one or more Google accounts to see your busy times.
              Each Google account may have multiple calendars (work, personal, shared).
            </p>
          </div>
        </div>

        {/* Info banner */}
        <div className="p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg mb-4">
          <div className="flex gap-2">
            <HelpCircle className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-blue-800 dark:text-blue-200">
              <strong>Multiple accounts?</strong> You can connect calendars from different Google accounts — 
              for example your personal Gmail and a work Google Workspace account. Each connection is listed separately.
            </p>
          </div>
        </div>

        {/* Existing Google sources */}
        {sourcesLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin mr-2" />
            Loading calendar sources...
          </div>
        ) : (
          <div className="space-y-3">
            {googleSources.map(source => (
              <div key={source.id}>
                <div className="flex items-center justify-between p-4 bg-card rounded-lg border border-border">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center shadow-sm border border-border">
                    <svg className="w-6 h-6" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    {editingSourceId === source.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={editingSourceName}
                          onChange={(e) => setEditingSourceName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') updateSourceLabel(source, editingSourceName)
                            if (e.key === 'Escape') { setEditingSourceId(null); setEditingSourceName('') }
                          }}
                          className="px-2 py-0.5 border border-ring rounded text-sm focus:ring-2 focus:ring-ring focus:border-ring outline-none w-40 bg-background text-foreground"
                          autoFocus
                        />
                        <button
                          onClick={() => updateSourceLabel(source, editingSourceName)}
                          className="text-green-600 hover:text-green-700 p-0.5"
                          title="Save"
                        >
                          <CheckIcon className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => { setEditingSourceId(null); setEditingSourceName('') }}
                          className="text-muted-foreground hover:text-foreground p-0.5"
                          title="Cancel"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 group">
                        <p className="font-medium truncate">{source.display_name}</p>
                        <button
                          onClick={() => { setEditingSourceId(source.id); setEditingSourceName(source.display_name) }}
                          className="text-muted-foreground/30 hover:text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
                          title="Edit label"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Mail className="h-3 w-3" />
                      <span className="truncate">{source.google_email}</span>
                    </div>
                  </div>
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: source.color }}
                  />
                </div>
                <div className="flex items-center gap-2 ml-4">
                  {source.sync_error && (
                    <span title={source.sync_error}>
                      <AlertCircle className="h-4 w-4 text-rose-400" />
                    </span>
                  )}
                  <button
                    onClick={() => toggleSourceActive(source)}
                    disabled={sourceActionLoading === source.id}
                    className="text-muted-foreground hover:text-foreground"
                    title={source.is_active ? 'Disable' : 'Enable'}
                  >
                    {source.is_active
                      ? <ToggleRight className="h-6 w-6 text-primary" />
                      : <ToggleLeft className="h-6 w-6" />
                    }
                  </button>
                  {pendingRemoveSourceId === source.id ? (
                    <>
                      <button
                        onClick={() => removeSource(source, true)}
                        disabled={sourceActionLoading === source.id}
                        className="px-2 py-1 text-xs font-medium text-rose-700 dark:text-rose-300 bg-rose-100 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 rounded hover:bg-rose-200 dark:hover:bg-rose-900/50 transition-colors disabled:opacity-50"
                        title="Confirm remove"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setPendingRemoveSourceId(null)}
                        disabled={sourceActionLoading === source.id}
                        className="px-2 py-1 text-xs font-medium text-muted-foreground bg-background border border-border rounded hover:bg-muted transition-colors disabled:opacity-50"
                        title="Cancel"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => removeSource(source)}
                      disabled={sourceActionLoading === source.id}
                      className="text-muted-foreground hover:text-rose-500 dark:hover:text-rose-400 transition-colors"
                      title="Remove"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
              {source.sync_error && (
                <div className="mx-4 -mt-1 mb-2 p-2 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-b-lg">
                  <p className="text-xs text-rose-600 dark:text-rose-300">
                    <strong>Sync issue:</strong> {source.sync_error}
                  </p>
                  <p className="text-[10px] text-rose-500 dark:text-rose-400 mt-0.5">
                    Try removing and re-adding this connection to fix the issue.
                  </p>
                </div>
              )}
              </div>
            ))}

            {googleSources.length === 0 && !sourcesLoading && (
              <div className="text-center py-6 text-muted-foreground bg-card rounded-lg border-2 border-dashed border-border">
                <Calendar className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No Google Calendar accounts connected yet</p>
              </div>
            )}
          </div>
        )}

        {/* Add Google account form */}
        {showAddGoogle ? (
          <div className="mt-4 p-4 border-2 border-blue-200 dark:border-blue-800 rounded-lg bg-blue-50/50 dark:bg-blue-950/50">
            <h4 className="font-medium mb-3">Connect a Google Calendar</h4>
            <p className="text-sm text-muted-foreground mb-3">
              You'll be redirected to Google to sign in and grant calendar permissions.
              Your email will be retrieved automatically.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Label</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {['Work', 'Personal', 'School', 'Freelance', 'Other'].map(label => (
                    <button
                      key={label}
                      onClick={() => setNewGoogleName(label)}
                      className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                        newGoogleName === label
                          ? 'bg-primary/10 border-primary text-primary'
                          : 'bg-background border-border text-muted-foreground hover:bg-muted hover:border-border'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={newGoogleName}
                  onChange={(e) => setNewGoogleName(e.target.value)}
                  placeholder="or create custom label e.g. Connection or Network Name"
                  className="w-full px-3 py-2 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-ring outline-none text-sm bg-background text-foreground"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Color</label>
                <div className="flex gap-2">
                  {SOURCE_COLORS.map(c => (
                    <button
                      key={c.value}
                      onClick={() => setNewGoogleColor(c.value)}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${newGoogleColor === c.value ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'}`}
                      style={{ backgroundColor: c.value }}
                      title={c.label}
                    />
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={addGoogleSource}
                  disabled={!newGoogleName.trim() || sourceActionLoading === 'add-google'}
                  className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2"
                >
                  {sourceActionLoading === 'add-google' ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Redirecting...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" viewBox="0 0 24 24">
                        <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                        <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                      </svg>
                      Sign in with Google
                    </>
                  )}
                </button>
                <button
                  onClick={() => { setShowAddGoogle(false); setNewGoogleName(''); }}
                  className="px-4 py-2 text-sm font-medium text-muted-foreground bg-background border border-border rounded-lg hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAddGoogle(true)}
            disabled={isTraveler}
            className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-blue-600 border-2 border-dashed border-blue-300 rounded-lg hover:bg-blue-50 hover:border-blue-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="h-4 w-4" />
            Connect a Google Calendar Account
          </button>
        )}
        {isTraveler && (
          <p className="mt-2 text-xs text-amber-600">
            Traveler accounts cannot connect Google Calendars. Sign in to use this feature.
          </p>
        )}
      </div>

      {/* ─── Public Calendar URLs ────────────────────────────── */}
      {isTraveler ? (
        <div className="pt-6 border-t border-border">
          <h3 className="text-lg font-medium mb-2">Public Calendar URLs</h3>
          <p className="text-sm text-amber-600 dark:text-amber-400">Public calendar URLs are not available for Traveler accounts. Sign in with Google or a Cardano wallet to add external calendars.</p>
        </div>
      ) : (
      <div className="pt-6 border-t border-border">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-medium">Public Calendar URLs</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Import events from any publicly shared Google Calendar by pasting its URL.
              Great for community events, holidays, or shared team schedules.
            </p>
          </div>
        </div>

        {/* Expandable guidance ribbon */}
        <button
          onClick={() => setShowUrlGuide(!showUrlGuide)}
          className="w-full flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors mb-4"
        >
          <div className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-amber-600" />
            <span className="text-sm font-medium text-amber-800">How do I find a public iCal calendar URL?</span>
          </div>
          <ChevronDown className={`h-4 w-4 text-amber-600 transition-transform ${showUrlGuide ? 'rotate-180' : ''}`} />
        </button>

        {showUrlGuide && (
          <div className="mb-4 p-4 bg-amber-50/50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-foreground space-y-4">
            <div>
              <p className="font-semibold mb-2">Use the iCal address</p>
              <ol className="list-decimal ml-5 space-y-1.5">
                <li>In Google Calendar, click the <strong>⋮</strong> (three dots) next to the calendar name</li>
                <li>Select <strong>"Settings and sharing"</strong></li>
                <li>Scroll to <strong>"Integrate calendar"</strong></li>
                <li>Copy the <strong>"Public address in iCal format"</strong> — it looks like:<br />
                  <code className="text-xs bg-white text-slate-900 px-2 py-1 rounded border mt-1 inline-block break-all">
                    https://calendar.google.com/calendar/ical/...%40group.calendar.google.com/public/basic.ics
                  </code>
                </li>
                <li>Paste that .ics URL here.</li>
              </ol>
            </div>

            <div className="pt-2 border-t border-amber-200">
              <p className="text-xs text-amber-700">
                <strong>Tip:</strong> Use a public iCalendar feed URL that ends in <code className="bg-white text-slate-900 px-1 rounded">.ics</code>. Regular Google Calendar page links (for example with <code className="bg-white text-slate-900 px-1 rounded">?cid=</code>) are not direct feeds.
              </p>
            </div>
          </div>
        )}

        {/* Existing URL sources */}
        <div className="space-y-3">
          {urlSources.map(source => (
            <div key={source.id} className="flex items-center justify-between p-4 bg-card rounded-lg border border-border">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 bg-background rounded-lg flex items-center justify-center shadow-sm border border-border">
                  <Globe className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium truncate">{source.display_name}</p>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Link2 className="h-3 w-3" />
                    <span className="truncate max-w-xs">{source.public_url}</span>
                  </div>
                </div>
                <span
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: source.color }}
                />
              </div>
              <div className="flex items-center gap-2 ml-4">
                {source.sync_error && (
                  <span title={source.sync_error}>
                    <AlertCircle className="h-4 w-4 text-rose-400" />
                  </span>
                )}
                <button
                  onClick={() => toggleSourceActive(source)}
                  disabled={sourceActionLoading === source.id}
                  className="text-muted-foreground hover:text-foreground"
                  title={source.is_active ? 'Disable' : 'Enable'}
                >
                  {source.is_active
                    ? <ToggleRight className="h-6 w-6 text-green-600 dark:text-green-400" />
                    : <ToggleLeft className="h-6 w-6" />
                  }
                </button>
                {pendingRemoveSourceId === source.id ? (
                  <>
                    <button
                      onClick={() => removeSource(source, true)}
                      disabled={sourceActionLoading === source.id}
                      className="px-2 py-1 text-xs font-medium text-rose-700 dark:text-rose-300 bg-rose-100 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 rounded hover:bg-rose-200 dark:hover:bg-rose-900/50 transition-colors disabled:opacity-50"
                      title="Confirm remove"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setPendingRemoveSourceId(null)}
                      disabled={sourceActionLoading === source.id}
                      className="px-2 py-1 text-xs font-medium text-muted-foreground bg-background border border-border rounded hover:bg-muted transition-colors disabled:opacity-50"
                      title="Cancel"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => removeSource(source)}
                    disabled={sourceActionLoading === source.id}
                    className="text-muted-foreground hover:text-rose-500 dark:hover:text-rose-400 transition-colors"
                    title="Remove"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}

          {urlSources.length === 0 && (
            <div className="text-center py-6 text-muted-foreground bg-card rounded-lg border-2 border-dashed border-border">
              <Link2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No public calendar URLs added yet</p>
            </div>
          )}
        </div>

        {/* Add public URL form */}
        {showAddPublicUrl ? (
          <div className="mt-4 p-4 border-2 border-green-200 dark:border-green-800 rounded-lg bg-green-50/50 dark:bg-green-950/50">
            <h4 className="font-medium mb-3">Add a Public Calendar URL</h4>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Label</label>
                <input
                  type="text"
                  value={newUrlName}
                  onChange={(e) => setNewUrlName(e.target.value)}
                  placeholder="e.g. Team Events, Finland Holidays"
                  className="w-full px-3 py-2 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-ring outline-none text-sm bg-background text-foreground"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Calendar URL</label>
                <input
                  type="url"
                  value={newUrlValue}
                  onChange={(e) => setNewUrlValue(e.target.value)}
                  placeholder="https://calendar.google.com/calendar/ical/.../public/basic.ics"
                  className="w-full px-3 py-2 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-ring outline-none text-sm font-mono bg-background text-foreground"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Color</label>
                <div className="flex gap-2">
                  {SOURCE_COLORS.map(c => (
                    <button
                      key={c.value}
                      onClick={() => setNewUrlColor(c.value)}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${newUrlColor === c.value ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'}`}
                      style={{ backgroundColor: c.value }}
                      title={c.label}
                    />
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={addPublicUrlSource}
                  disabled={!newUrlName.trim() || !newUrlValue.trim() || sourceActionLoading === 'add-url'}
                  className="px-4 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {sourceActionLoading === 'add-url' ? 'Adding...' : 'Add Calendar URL'}
                </button>
                <button
                  onClick={() => { setShowAddPublicUrl(false); setNewUrlName(''); setNewUrlValue(''); }}
                  className="px-4 py-2 text-sm font-medium text-muted-foreground bg-background border border-border rounded-lg hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAddPublicUrl(true)}
            className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-green-600 border-2 border-dashed border-green-300 rounded-lg hover:bg-green-50 hover:border-green-400 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add a Public Calendar URL
          </button>
        )}
      </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          Subcategory: Meeting Integrations
          ═══════════════════════════════════════════════════════ */}
      <div id="settings-integrations" className="pt-8 border-t-2 border-border">
        <h2 className="text-xl font-semibold mb-1">Meeting Integrations</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Connect video conferencing and event platforms to generate meeting links and publish events directly from your calendar.
        </p>

        {/* ─── Zoom Integration ────────────────────────────── */}
        <div className="mb-6 p-4 border border-border rounded-xl bg-card">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/50 rounded-lg flex items-center justify-center">
              <Video className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-medium text-foreground">Zoom</h3>
              <p className="text-xs text-muted-foreground">Create Zoom meetings directly from calendar events</p>
            </div>
            {zoomIntegration?.is_active && (
              <span className="px-2 py-1 text-xs font-medium bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded-full">
                Connected
              </span>
            )}
          </div>

          {zoomLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Checking Zoom connection...
            </div>
          ) : zoomIntegration?.is_active ? (
            <div className="space-y-3">
              <div className="p-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg">
                <p className="text-sm text-green-800 dark:text-green-200">
                  <CheckIcon className="w-4 h-4 inline mr-1" />
                  Connected as <strong>{zoomIntegration.zoom_display_name || zoomIntegration.zoom_email || 'Zoom User'}</strong>
                </p>
                <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                  Zoom meeting links will be generated automatically when you create calendar events.
                </p>
              </div>
              <button
                onClick={async () => {
                  try {
                    await apiClient.delete('/api/zoom/disconnect')
                    setZoomIntegration(null)
                    setZoomSuccess('Zoom disconnected.')
                  } catch {
                    setZoomError('Failed to disconnect Zoom.')
                  }
                }}
                className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-rose-500 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900/30 transition-colors"
              >
                <Unlink className="w-3.5 h-3.5" />
                Disconnect Zoom
              </button>
            </div>
          ) : window.location.hostname === 'localhost' ? (
            <div className="space-y-3">
              <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
                <p className="text-sm text-amber-800 dark:text-amber-200 font-medium">
                  Zoom integration is disabled on localhost
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  Zoom requires a fully qualified domain name (FQDN) for OAuth. Please use the deployed production version to connect your Zoom account.
                </p>
              </div>
              <button
                disabled
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg opacity-50 cursor-not-allowed"
              >
                <Video className="w-4 h-4" />
                Connect Zoom
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="p-3 bg-card border border-border rounded-lg">
                <p className="text-sm text-muted-foreground">
                  Connect your Zoom account to generate meeting links automatically when scheduling events.
                </p>
              </div>
              <button
                disabled={zoomConnecting}
                onClick={async () => {
                  setZoomConnecting(true)
                  setZoomError(null)
                  try {
                    const res = await apiClient.get('/api/zoom/auth-url')
                    if (res.data?.url && /^https:\/\//i.test(res.data.url)) {
                      window.location.href = res.data.url
                    } else {
                      setZoomError('Failed to generate Zoom authorization URL.')
                    }
                  } catch (err) {
                    setZoomError((err as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to start Zoom connection')
                  } finally {
                    setZoomConnecting(false)
                  }
                }}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {zoomConnecting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Video className="w-4 h-4" />
                )}
                Connect Zoom
              </button>
            </div>
          )}
          {zoomError && (
            <div className="mt-3 p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-lg text-sm text-rose-600 dark:text-rose-300">
              <AlertCircle className="w-4 h-4 inline mr-1" />
              {zoomError}
            </div>
          )}
          {zoomSuccess && (
            <div className="mt-3 p-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-700 dark:text-green-300">
              <CheckIcon className="w-4 h-4 inline mr-1" />
              {zoomSuccess}
            </div>
          )}
        </div>

        {/* ─── Luma Integration ────────────────────────────── */}
        {isTraveler ? (
          <div className="mb-6 p-4 border border-border rounded-xl bg-card">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-orange-100 to-pink-100 dark:from-orange-950 dark:to-pink-950 rounded-lg flex items-center justify-center">
                <span className="w-6 h-6 bg-gradient-to-br from-orange-400 to-pink-500 rounded flex items-center justify-center">
                  <span className="text-white text-[9px] font-bold">Lu</span>
                </span>
              </div>
              <div>
                <h3 className="font-medium text-foreground">Luma</h3>
                <p className="text-xs text-amber-600 dark:text-amber-400">Luma integration is not available for Traveler accounts.</p>
              </div>
            </div>
          </div>
        ) : (
        <div className="mb-6 p-4 border border-border rounded-xl bg-card">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-gradient-to-br from-orange-100 to-pink-100 dark:from-orange-950 dark:to-pink-950 rounded-lg flex items-center justify-center">
              <span className="w-6 h-6 bg-gradient-to-br from-orange-400 to-pink-500 rounded flex items-center justify-center">
                <span className="text-white text-[9px] font-bold">Lu</span>
              </span>
            </div>
            <div className="flex-1">
              <h3 className="font-medium text-foreground">Luma</h3>
              <p className="text-xs text-muted-foreground">Publish meetings as Luma events with registration pages</p>
            </div>
            {lumaIntegration?.is_active && (
              <span className="px-2 py-1 text-xs font-medium bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded-full">
                Connected
              </span>
            )}
          </div>

          {lumaLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Checking Luma connection...
            </div>
          ) : lumaIntegration?.is_active ? (
            <div className="space-y-3">
              <div className="p-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg">
                <p className="text-sm text-green-800 dark:text-green-200">
                  <CheckIcon className="w-4 h-4 inline mr-1" />
                  Connected as <strong>{lumaIntegration.luma_user_name || lumaIntegration.luma_user_email || 'Luma User'}</strong>
                </p>
                <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                  You can now publish meetings as Luma events from the meeting panel.
                </p>
              </div>
              <button
                onClick={async () => {
                  try {
                    await apiClient.delete('/api/luma/disconnect')
                    setLumaIntegration(null)
                    setLumaSuccess('Luma disconnected.')
                  } catch {
                    setLumaError('Failed to disconnect Luma.')
                  }
                }}
                className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-rose-500 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900/30 transition-colors"
              >
                <Unlink className="w-3.5 h-3.5" />
                Disconnect Luma
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="p-3 bg-card border border-border rounded-lg">
                <p className="text-sm text-muted-foreground mb-2">
                  Connect your Luma account using an API key. When you publish a meeting, a Luma event will be created on your account with a registration page link.
                </p>
                <p className="text-xs text-muted-foreground">
                  Get your API key from{' '}
                  <a href="https://luma.com/settings/api" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">
                    luma.com/settings/api <ExternalLink className="w-3 h-3 inline" />
                  </a>
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span>The Luma API requires a <strong>Luma Plus</strong> (paid) subscription. The API settings page will not appear for free accounts.</span>
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="password"
                  value={lumaApiKey}
                  onChange={(e) => setLumaApiKey(e.target.value)}
                  placeholder="Paste your Luma API key"
                  className="flex-1 px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring focus:border-ring outline-none"
                />
                <button
                  disabled={lumaConnecting || !lumaApiKey.trim() || isTraveler}
                  onClick={async () => {
                    setLumaConnecting(true)
                    setLumaError(null)
                    try {
                      const res = await apiClient.post('/api/luma/connect', { apiKey: lumaApiKey })
                      setLumaIntegration(res.data.integration)
                      setLumaApiKey('')
                      setLumaSuccess('Luma connected successfully!')
                    } catch (err) {
                      setLumaError((err as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to connect Luma')
                    } finally {
                      setLumaConnecting(false)
                    }
                  }}
                  className="flex w-full sm:w-auto items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {lumaConnecting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <LinkIcon className="w-4 h-4" />
                  )}
                  Connect
                </button>
              </div>
              {isTraveler && (
                <p className="text-xs text-muted-foreground">Sign in to connect Luma.</p>
              )}
            </div>
          )}
          {lumaError && (
            <div className="mt-3 p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-lg text-sm text-rose-600 dark:text-rose-300">
              <AlertCircle className="w-4 h-4 inline mr-1" />
              {lumaError}
            </div>
          )}
          {lumaSuccess && (
            <div className="mt-3 p-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-700 dark:text-green-300">
              <CheckIcon className="w-4 h-4 inline mr-1" />
              {lumaSuccess}
            </div>
          )}
        </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════
          Subcategory: Default Parameters
          ═══════════════════════════════════════════════════════ */}
      <div id="settings-defaults" className="pt-8 border-t-2 border-border">
        <h2 className="text-xl font-semibold mb-1">Default Parameters</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Configure defaults for new calendars you create.
        </p>
      </div>

      {/* ─── Time Slot Settings ──────────────────────────────── */}
      <div>
        <h3 className="text-lg font-medium mb-4">Time Slot Settings</h3>
        
        <div className="grid gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Time slot interval</label>
            <select
              value={calendarSettings.defaultTimeInterval}
              onChange={(e) => updateCalendarSettings({ defaultTimeInterval: parseInt(e.target.value) as 15 | 30 | 60 })}
              className="w-full px-4 py-2.5 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-ring outline-none bg-background text-foreground"
            >
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="60">60 minutes</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">Default interval when creating new calendars</p>
          </div>
        </div>
      </div>
      
      {/* ─── Meeting Hours ───────────────────────────────────── */}
      <div className="pt-6 border-t border-border">
        <h3 className="text-lg font-medium mb-4">Meeting Hours</h3>
        <p className="text-sm text-muted-foreground mb-3">Set your typical meeting hours to highlight them in the calendar</p>
        
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Start hour</label>
            <select
              value={calendarSettings.startHour}
              onChange={(e) => updateCalendarSettings({ startHour: parseInt(e.target.value) })}
              className="w-full px-4 py-2.5 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-ring outline-none bg-background text-foreground"
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>{i.toString().padStart(2, '0')}:00</option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">End hour</label>
            <select
              value={calendarSettings.endHour}
              onChange={(e) => updateCalendarSettings({ endHour: parseInt(e.target.value) })}
              className="w-full px-4 py-2.5 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-ring outline-none bg-background text-foreground"
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i + 1} value={i + 1}>{(i + 1).toString().padStart(2, '0')}:00</option>
              ))}
            </select>
          </div>
        </div>
      </div>
      
      {/* ─── Display Options ─────────────────────────────────── */}
      <div className="pt-6 border-t border-border">
        <h3 className="text-lg font-medium mb-4">Display Options</h3>
        
        <div className="flex items-center justify-between p-4 bg-muted rounded-lg opacity-60">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-medium">Show week numbers</p>
              <span className="px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground rounded">Coming soon</span>
            </div>
            <p className="text-sm text-muted-foreground">Display ISO week numbers (1-52) in the calendar sidebar. Useful for scheduling across international teams.</p>
          </div>
          <button
            disabled
            className="relative w-12 h-6 rounded-full bg-muted-foreground/30 cursor-not-allowed"
          >
            <span className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full" />
          </button>
        </div>
      </div>
    </div>
    )
  }

  const renderAiTab = () => (
    <div className="space-y-6">
      {/* ─── AI Model Selection ─────────────────────────────── */}
      <div id="settings-ai-model">
        <h3 className="text-lg font-medium mb-2">AI Model</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Choose which AI model powers your chat assistant, calendar AI, and announcement composer.
          All inference costs are covered by the{' '}
          <span className="font-medium text-foreground">Voltaire Swarm</span>.
        </p>

        <div className="space-y-3">
          {AI_MODEL_OPTIONS.map(model => {
            const isSelected = aiSettings.preferredModel === model.id
            const isAvailable = modelAvailabilityLoaded ? modelAvailability[model.id] !== false : true
            return (
              <button
                key={model.id}
                onClick={() => isAvailable && updateAiSettings({ preferredModel: model.id })}
                disabled={!isAvailable}
                className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                  !isAvailable
                    ? 'border-border bg-muted/20 opacity-60 cursor-not-allowed'
                    : isSelected
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                    : 'border-border bg-muted/30 hover:bg-muted/50 hover:border-border'
                }`}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                      !isAvailable ? 'border-muted-foreground/20' : isSelected ? 'border-primary' : 'border-muted-foreground/40'
                    }`}>
                      {isSelected && isAvailable && (
                        <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                      )}
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{model.label}</span>
                        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                          {model.provider}
                        </span>
                        {model.id === 'openai' && isAvailable && (
                          <span className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950 px-2 py-0.5 rounded-full">
                            Default
                          </span>
                        )}
                        {model.id === 'asi1-mini' && isAvailable && (
                          <span className="text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded-full">
                            Lower cost
                          </span>
                        )}
                        {!isAvailable && (
                          <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 px-2 py-0.5 rounded-full">
                            Not configured
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {model.description}
                        {!isAvailable && ' — API key not set by the administrator.'}
                      </p>
                    </div>
                  </div>
                  <span className="text-sm font-mono text-muted-foreground whitespace-nowrap self-start sm:self-auto sm:ml-4">
                    {model.costPerPrompt}/prompt
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ─── Usage & Costs ──────────────────────────────────── */}
      <div id="settings-ai-usage" className="pt-6 border-t border-border">
        <h3 className="text-lg font-medium mb-2">Usage & Costs</h3>

        <div className="p-4 bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 rounded-lg mb-4">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                Costs covered by Voltaire Swarm
              </p>
              <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-1">
                All AI inference costs are currently sponsored by the Voltaire Swarm initiative.
                You won't be charged for using any AI features in this application.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 bg-card rounded-lg border border-border">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Cost per prompt</p>
            <p className="text-lg font-semibold">
              {AI_MODEL_OPTIONS.find(m => m.id === aiSettings.preferredModel)?.costPerPrompt || '$0.02'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Using {AI_MODEL_OPTIONS.find(m => m.id === aiSettings.preferredModel)?.label || 'GPT-4o'}
            </p>
          </div>
          <div className="p-4 bg-card rounded-lg border border-border">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Daily prompt limit</p>
            <p className="text-lg font-semibold">{isTraveler ? '2' : '10'} prompts/day</p>
            <p className="text-xs text-muted-foreground mt-1">
              {isTraveler ? 'Traveler account' : 'Verified account'}
            </p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground mt-4">
          The AI model powers three features: the AI Assistant chat page, the Calendar AI assistant, and the
          Announcement compose assistant. All share the same daily prompt limit.
        </p>
      </div>

      {/* ─── Agent API Keys ────────────────────────────────────── */}
      {isTraveler ? (
        <div id="settings-agent-api-keys" className="pt-6 border-t border-border">
          <h3 className="text-lg font-medium mb-2">Agent API Keys</h3>
          <p className="text-sm text-amber-600 dark:text-amber-400">API keys are not available for Traveler accounts. Sign in with Google or a Cardano wallet to create agent integrations.</p>
        </div>
      ) : (
      <div id="settings-agent-api-keys" className="pt-6 border-t border-border">
        <h3 className="text-lg font-medium mb-4">Agent API Keys</h3>
        
        <div className="p-4 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg mb-4">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-blue-800 dark:text-blue-200">
              API keys allow AI agents (like ASI:One uAgents) to access your coordination data programmatically. Keys are shown only once when created.
            </p>
          </div>
        </div>

        {/* ─── Agent Setup Guide ──────────────────────────────── */}
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 rounded-lg mb-4">
          <div className="flex items-start gap-3">
            <Bot className="h-5 w-5 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
            <div className="space-y-2">
              <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
                Connect your AI Agent to Coordination Manager
              </p>
              <ol className="text-sm text-emerald-800 dark:text-emerald-200 list-decimal list-inside space-y-1">
                <li>Copy the <strong>Docs URL</strong> below and provide it to your AI agent so it can learn the API.</li>
                <li>Create an <strong>API Key</strong> with the scopes your agent needs (e.g. <code className="px-1 py-0.5 bg-emerald-100 dark:bg-emerald-900 rounded text-xs">read</code>, <code className="px-1 py-0.5 bg-emerald-100 dark:bg-emerald-900 rounded text-xs">write:meetings</code>).</li>
                <li>Give both the <strong>Docs URL</strong> and the <strong>API Key</strong> to your agent — it can then read and update your Coordination Manager data.</li>
              </ol>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  onClick={() => {
                    const docsBase = import.meta.env.DEV ? 'http://localhost:5174/docs/overview' : window.location.origin + '/docs/overview'
                    navigator.clipboard.writeText(docsBase)
                    setDocsUrlCopied(true)
                    setTimeout(() => setDocsUrlCopied(false), 2000)
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-800 transition-colors"
                >
                  {docsUrlCopied ? <CheckIcon className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {docsUrlCopied ? 'Copied!' : 'Copy Docs URL'}
                </button>
                <a
                  href={import.meta.env.DEV ? 'http://localhost:5174/docs/overview' : '/docs/overview'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-800 transition-colors"
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  View API Docs
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>
        </div>

        {agentKeysLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Existing API Keys */}
            {agentApiKeys.length > 0 && (
              <div className="space-y-3">
                {agentApiKeys.map(key => (
                  <div key={key.id} className="p-4 bg-card rounded-lg border border-border">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Key className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{key.name}</span>
                        {!key.is_active && (
                          <span className="px-2 py-0.5 text-xs font-medium bg-rose-100 dark:bg-rose-900 text-rose-600 dark:text-rose-300 rounded">
                            Inactive
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => handleDeleteAgentKey(key.id)}
                        className="p-1.5 text-muted-foreground hover:text-rose-500 transition-colors"
                        title="Delete key"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {key.scopes.map(scope => {
                        const isWriteScope = scope.startsWith('write:') || scope === '*'
                        const ackd = Boolean(key.ack_writes_at)
                        const downgraded = isWriteScope && !ackd
                        return (
                          <span
                            key={scope}
                            className={`px-2 py-0.5 text-xs rounded ${
                              downgraded
                                ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 line-through'
                                : 'bg-primary/10 text-primary'
                            }`}
                            title={downgraded ? 'Write access not acknowledged -- request is treated as read-only' : undefined}
                          >
                            {scope}
                          </span>
                        )
                      })}
                      {scopesIncludeWrite(key.scopes) && !key.ack_writes_at && (
                        <span className="px-2 py-0.5 text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded">
                          Read-only (write not acknowledged)
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <p>Created: {formatDateInTimezone(key.created_at, getPrimaryTimezone())}</p>
                      {key.last_used_at && (
                        <p>Last used: {formatDateInTimezone(key.last_used_at, getPrimaryTimezone())}</p>
                      )}
                      {key.expires_at && (
                        <p>Expires: {formatDateInTimezone(key.expires_at, getPrimaryTimezone())}</p>
                      )}
                      {typeof key.daily_request_limit === 'number' && (
                        <p>
                          Quota: {key.rate_window_count ?? 0} / {key.daily_request_limit} requests in the last 24h
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Show newly created key */}
            {newlyCreatedKey && (
              <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg">
                <div className="flex items-start gap-2 mb-3">
                  <CheckIcon className="h-4 w-4 text-rose-500 dark:text-rose-400 mt-0.5" />
                  <div>
                    <p className="font-medium text-rose-700 dark:text-rose-200">API Key Created!</p>
                    <p className="text-sm text-rose-600 dark:text-rose-300">
                      Copy this key now -- you won't be able to see it again.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 p-2 bg-background border border-rose-200 dark:border-rose-800 rounded text-sm font-mono break-all">
                    {newlyCreatedKey}
                  </code>
                  <button
                    onClick={() => handleCopyAgentKey(newlyCreatedKey)}
                    className="p-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
                    title="Copy to clipboard"
                  >
                    {agentKeyCopied ? <CheckIcon className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
                <button
                  onClick={() => {
                    setNewlyCreatedKey(null)
                    setShowCreateAgentKey(false)
                  }}
                  className="mt-3 text-sm text-green-700 dark:text-green-300 hover:underline"
                >
                  I've copied the key, dismiss this
                </button>
              </div>
            )}

            {/* Create new key form */}
            {showCreateAgentKey && !newlyCreatedKey ? (
              <div className="p-4 border border-border rounded-lg space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Key Name</label>
                  <input
                    type="text"
                    value={newAgentKeyName}
                    onChange={e => setNewAgentKeyName(e.target.value)}
                    placeholder="e.g., Meeting Scheduler Agent"
                    className="w-full px-3 py-2 border border-input rounded-md bg-background"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">Permissions</label>
                  <div className="space-y-2">
                    {AGENT_SCOPES.map(scope => (
                      <label key={scope.id} className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newAgentKeyScopes.includes(scope.id)}
                          onChange={e => {
                            if (e.target.checked) {
                              setNewAgentKeyScopes(prev => [...prev, scope.id])
                            } else {
                              setNewAgentKeyScopes(prev => prev.filter(s => s !== scope.id))
                            }
                          }}
                          className="mt-1"
                        />
                        <div>
                          <span className="font-medium text-sm">{scope.label}</span>
                          <p className="text-xs text-muted-foreground">{scope.description}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Ethics gate -- only shown when at least one write scope is selected.
                    Every new key starts read-only so users can explore the API safely
                    before any code path can modify, delete, or create data on their behalf. */}
                {scopesIncludeWrite(newAgentKeyScopes) && (
                  <div className="p-3 border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 rounded-lg">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={confirmWriteAccess}
                        onChange={e => setConfirmWriteAccess(e.target.checked)}
                        className="mt-1"
                      />
                      <div className="text-sm text-amber-900 dark:text-amber-100">
                        <span className="font-medium">I understand this key can modify, delete, or create data on my account.</span>
                        <p className="text-xs mt-1 text-amber-800 dark:text-amber-200">
                          Every new key starts read-only by default. Tick this box to grant the write scopes selected above.
                          You can revoke or downgrade scopes at any time.
                        </p>
                      </div>
                    </label>
                  </div>
                )}

                {agentKeyError && (
                  <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg">
                    <p className="text-sm text-rose-700 dark:text-rose-200">{agentKeyError}</p>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setShowCreateAgentKey(false)
                      setNewAgentKeyName('')
                      setNewAgentKeyScopes(['read'])
                      setAgentKeyError(null)
                    }}
                    className="px-4 py-2 border border-border rounded-lg hover:bg-muted transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateAgentKey}
                    disabled={agentKeyCreating || !newAgentKeyName.trim()}
                    className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {agentKeyCreating && <Loader2 className="h-4 w-4 animate-spin" />}
                    Create Key
                  </button>
                </div>
              </div>
            ) : !newlyCreatedKey && (
              <button
                onClick={() => setShowCreateAgentKey(true)}
                className="flex items-center gap-2 px-4 py-2 border border-dashed border-border rounded-lg hover:bg-muted/50 transition-colors w-full justify-center"
              >
                <Plus className="h-4 w-4" />
                Create New API Key
              </button>
            )}
          </div>
        )}
      </div>
      )}

    </div>
  )

  const renderPrivacyTab = () => (
    <div className="space-y-6">
      {/* ─── Email Addresses ──────────────────────────────── */}
      {isTraveler ? (
        <div id="settings-email-contact">
          <h3 className="text-lg font-medium mb-2">Email Addresses</h3>
          <p className="text-sm text-amber-600 dark:text-amber-400">Email verification is not available for Traveler accounts. Sign in with Google or a Cardano wallet to add and verify email addresses.</p>
        </div>
      ) : (
      <div id="settings-email-contact">
        <h3 className="text-lg font-medium mb-1">Email Addresses</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Verified emails serve as both your receiving address and your sender identity. Your primary email is used for notifications and appears in the "sent by" attribution on announcements.
        </p>

          {/* Warning when email notifications are disabled */}
          {!notifChannelEmail && (
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Email notifications are disabled. You won't receive any emails until you enable them in Notification settings.
                </p>
              </div>
              <button
                onClick={() => { setNotifChannelEmail(true); saveNotifPrefsNow({ channelEmail: true }) }}
                className="ml-3 flex-shrink-0 relative w-12 h-6 rounded-full transition-colors bg-rose-300 dark:bg-rose-500/60"
                title="Enable email notifications"
              >
                <span className="absolute top-1 left-1 w-4 h-4 rounded-full bg-white dark:bg-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-all" />
              </button>
            </div>
          )}

          {/* Existing verified emails list */}
          {loadingVerifiedEmails ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Loading verified emails...
            </div>
          ) : verifiedEmails.length > 0 ? (
            <div className="space-y-2 mb-4">
              {verifiedEmails.map(ve => (
                <div key={ve.id} className="flex flex-col gap-3 p-3 border border-border rounded-lg bg-muted/30 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-2">
                    <Mail className="w-4 h-4 text-muted-foreground mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium break-all">{ve.email}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {ve.is_primary && (
                          <span className="px-1.5 py-0.5 bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400 text-[10px] font-medium rounded">Primary</span>
                        )}
                        <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 text-[10px] font-medium rounded">
                          {ve.verification_method === 'google_oauth' ? 'Google' : 'Code'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-start gap-3 sm:justify-end sm:gap-1.5">
                    {!ve.is_primary && (
                      <button
                        onClick={() => handleSetPrimaryEmail(ve.id)}
                        className="text-xs text-primary hover:underline"
                      >
                        Set Primary
                      </button>
                    )}
                    <button
                      onClick={() => handleRemoveVerifiedEmail(ve.id)}
                      className="text-xs text-rose-500 hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
              <p className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                No verified emails yet. Verify an email below to receive notifications and use it as your sender identity.
              </p>
            </div>
          )}

          {/* Verify Google email (one-click) */}
          {!isCardano && user?.email && !verifiedEmails.some(ve => ve.email === user.email?.toLowerCase()) && (
            <div className="mb-4 p-3 border border-border rounded-lg bg-card">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <ShieldCheck className="w-4 h-4 text-green-500" />
                  <span className="text-sm break-all">Verify your Google email: <strong>{user.email}</strong></span>
                </div>
                <button
                  onClick={handleVerifyGoogleEmail}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  Verify with Google
                </button>
              </div>
            </div>
          )}

          {/* Add other email with verification code */}
          <div className="p-3 border border-border rounded-lg bg-card">
            <h5 className="text-xs font-semibold mb-2">Add another email address</h5>
            {verifyStep === 'idle' || verifyStep === 'sending' ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="email"
                  value={verifyEmailInput}
                  onChange={e => setVerifyEmailInput(e.target.value)}
                  placeholder="your@email.com"
                  className="flex-1 px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:ring-2 focus:ring-ring outline-none"
                  disabled={verifyStep === 'sending'}
                />
                <button
                  onClick={handleSendVerificationCode}
                  disabled={!verifyEmailInput.trim() || verifyStep === 'sending'}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  {verifyStep === 'sending' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                  Send Code
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  A 6-digit code was sent to <strong>{verifyPendingEmail}</strong>. Enter it below.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    type="text"
                    value={verifyCodeInput}
                    onChange={e => setVerifyCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    maxLength={6}
                    className="w-full sm:w-32 px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground text-center tracking-widest font-mono focus:ring-2 focus:ring-ring outline-none"
                    disabled={verifyStep === 'verifying'}
                  />
                  <button
                    onClick={handleVerifyCode}
                    disabled={verifyCodeInput.length !== 6 || verifyStep === 'verifying'}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                  >
                    {verifyStep === 'verifying' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckIcon className="w-3.5 h-3.5" />}
                    Verify
                  </button>
                  <button
                    onClick={() => { setVerifyStep('idle'); setVerifyCodeInput(''); setVerifyPendingEmail(''); setVerifyResult(null) }}
                    className="px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                </div>
                <button
                  onClick={handleSendVerificationCode}
                  className="text-xs text-primary hover:underline"
                >
                  Resend code
                </button>
              </div>
            )}
          </div>

          {/* Status messages */}
          {verifyResult && (
            <div className={`mt-2 p-2.5 rounded-lg text-xs flex items-center gap-2 ${
              verifyResult.type === 'success'
                ? 'bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
                : 'bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400'
            }`}>
              {verifyResult.type === 'success' ? <CheckIcon className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
              {verifyResult.message}
            </div>
          )}
      </div>
      )}

      {/* ─── Cardano Wallet ───────────────────────────────────── */}
      <div id="settings-cardano-wallet" className="pt-6 border-t border-border">
        <h3 className="text-lg font-medium mb-2">Cardano Wallet</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Link a Cardano wallet to your account for identity verification, event access, and future features.
        </p>

        {/* Status messages (shared) */}
        {(managedWalletError || walletError) && (
          <div className="mb-4 p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg">
            <p className="text-sm text-rose-700 dark:text-rose-200 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {managedWalletError || walletError}
            </p>
          </div>
        )}
        {(managedWalletSuccess || walletSuccess) && (
          <div className="mb-4 p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
            <p className="text-sm text-green-800 dark:text-green-200 flex items-center gap-2">
              <CheckIcon className="h-4 w-4 flex-shrink-0" />
              {managedWalletSuccess || walletSuccess}
            </p>
          </div>
        )}

        {walletLoading ? (
          <div className="p-4 bg-muted rounded-lg animate-pulse">
            <div className="h-5 w-48 bg-muted-foreground/20 rounded" />
          </div>
        ) : walletStatus.linked && walletStatus.walletAddress ? (
          /* ── Linked wallet display ── */
          <div className="space-y-4">
            <div className="p-4 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <Wallet className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-green-900 dark:text-green-100">
                      {isManagedAddress(walletStatus.walletAddress) ? 'Managed Wallet' : 'Linked Wallet'}
                    </p>
                    {isManagedAddress(walletStatus.walletAddress) ? (
                      <p className="text-xs text-green-700 dark:text-green-300 font-mono">
                        {formatManagedAddress(walletStatus.walletAddress)}
                      </p>
                    ) : (
                      <p className="text-xs text-green-700 dark:text-green-300 font-mono truncate">
                        {walletStatus.walletAddress}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 self-start sm:self-auto flex-shrink-0">
                  <button
                    onClick={copyWalletAddress}
                    className="p-2 rounded-lg hover:bg-green-100 dark:hover:bg-green-900 transition-colors"
                    title="Copy address"
                  >
                    {walletCopied ? (
                      <CheckIcon className="h-4 w-4 text-green-600" />
                    ) : (
                      <Copy className="h-4 w-4 text-green-600 dark:text-green-400" />
                    )}
                  </button>
                  {walletStatus.accountType !== 'cardano' && walletStatus.accountType !== 'managed_cardano' && (
                    <button
                      onClick={handleRemoveWalletAccess}
                      disabled={walletActionLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors disabled:opacity-50"
                    >
                      <Unlink className="h-3.5 w-3.5" />
                      {walletActionLoading ? 'Removing...' : 'Remove access'}
                    </button>
                  )}
                </div>
              </div>
              {(walletStatus.accountType === 'cardano' || walletStatus.accountType === 'managed_cardano') && (
                <p className="mt-2 text-xs text-green-600 dark:text-green-400">
                  This is your primary wallet identity and cannot be unlinked.
                </p>
              )}
            </div>

            {/* ── Managed wallet: export private key ── */}
            {isManagedAddress(walletStatus.walletAddress) && (
              <div className="p-4 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg space-y-3">
                <div className="flex items-start gap-2">
                  <Key className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-amber-900 dark:text-amber-100">App-Managed Wallet</p>
                    <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                      This wallet was generated by the app. Your private key is encrypted and stored on this device. Back it up to avoid losing access.
                    </p>
                  </div>
                </div>

                {!hasDeviceKey() && (
                  <div className="flex items-start gap-2 p-2.5 rounded-md bg-amber-100 dark:bg-amber-900/40 border border-amber-200 dark:border-amber-700">
                    <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Device key not found. This device was not used to create the wallet. Key export is only available on the original device.
                    </p>
                  </div>
                )}

                {exportedPrivateKey ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-amber-900 dark:text-amber-100">
                      Private Key (Ed25519 hex) -- keep this secret:
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs font-mono bg-white text-slate-900 dark:bg-black/30 dark:text-slate-100 border border-amber-200 dark:border-amber-700 rounded px-2 py-1.5 break-all">
                        {exportedPrivateKey}
                      </code>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(exportedPrivateKey)
                          setExportedKeyCopied(true)
                          setTimeout(() => setExportedKeyCopied(false), 2000)
                        }}
                        className="p-2 rounded hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors flex-shrink-0"
                        title="Copy"
                      >
                        {exportedKeyCopied ? <CheckIcon className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4 text-amber-600" />}
                      </button>
                    </div>
                    <button
                      onClick={() => setExportedPrivateKey(null)}
                      className="text-xs text-amber-600 dark:text-amber-400 hover:underline"
                    >
                      Hide key
                    </button>
                  </div>
                ) : showExportConfirm ? (
                  <div className="space-y-2">
                    <p className="text-xs text-amber-800 dark:text-amber-200">
                      This will display your private key in plaintext. Do not share it with anyone.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={handleExportPrivateKey}
                        disabled={exportKeyLoading}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white rounded transition-colors disabled:opacity-50"
                      >
                        {exportKeyLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                        {exportKeyLoading ? 'Decrypting...' : 'Reveal key'}
                      </button>
                      <button
                        onClick={() => setShowExportConfirm(false)}
                        className="px-3 py-1.5 text-xs font-medium border border-border rounded hover:bg-muted transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  hasDeviceKey() && (
                    <button
                      onClick={() => setShowExportConfirm(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-300 rounded hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
                    >
                      <Key className="h-3.5 w-3.5" />
                      Export private key
                    </button>
                  )
                )}

                {/* ── How it works / security info ── */}
                <div className="border-t border-amber-200 dark:border-amber-700 pt-2">
                  <button
                    onClick={() => setShowWalletInfo(v => !v)}
                    className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 transition-colors"
                  >
                    <Info className="h-3.5 w-3.5" />
                    How this wallet works &amp; what's at risk
                    {showWalletInfo ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>
                  {showWalletInfo && (
                    <div className="mt-3 space-y-3 text-xs text-amber-800 dark:text-amber-200">
                      <div className="space-y-1">
                        <p className="font-medium flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> How the key is stored</p>
                        <p>Your Ed25519 private key was generated inside your browser using the Web Crypto API. It is immediately encrypted with AES-256-GCM using a device secret stored only in your browser's local storage. The platform never sees your private key -- only the encrypted blob.</p>
                      </div>
                      <div className="space-y-1">
                        <p className="font-medium flex items-center gap-1.5"><AlertCircle className="h-3.5 w-3.5" /> What's at risk</p>
                        <ul className="list-disc pl-4 space-y-0.5">
                          <li>If you clear your browser data or switch devices without exporting your key first, you permanently lose access to this wallet.</li>
                          <li>Anyone with your exported private key can impersonate you. Keep it safe like a password.</li>
                          <li>The platform cannot recover your key if lost -- there is no password reset for wallet identity.</li>
                        </ul>
                      </div>
                      <div className="space-y-1">
                        <p className="font-medium flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5" /> Similar technology</p>
                        <p>
                          This wallet uses the same Ed25519 key technology as{' '}
                          <a
                            href="https://gamechanger.finance/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline hover:text-amber-900 dark:hover:text-amber-100"
                          >
                            GameChanger Wallet
                          </a>
                          {' '}-- a Cardano web wallet that also generates keys in-browser without an extension. If you want full wallet features (sending ADA, NFTs, DApps), consider migrating to GameChanger or another CIP-30 wallet.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* ── No wallet linked ── */
          <div className="space-y-3">
            {/* ── CIP-30 extension wallet (for non-traveler accounts) ── */}
            {!isTraveler && (
              <>
                <div className="p-4 bg-muted/50 rounded-lg border border-border space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Have a CIP-30 wallet (Eternl, Lace, Typhon)? Linking it proves you own a real Cardano address. No transaction is submitted -- only a signature.
                  </p>
                  {walletStatus.accountType !== 'cardano' && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Note: If this wallet belongs to an existing Cardano account, linking will merge both accounts.
                    </p>
                  )}
                  {(() => {
                    const installed = availableWallets.filter(w => w.installed)
                    if (installed.length === 0) {
                      return (
                        <a
                          href="https://lace.io"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          No wallet detected -- Get Lace Wallet
                        </a>
                      )
                    }
                    if (installed.length === 1) {
                      const wallet = installed[0]
                      return (
                        <button
                          onClick={() => handleLinkWallet(wallet.id)}
                          disabled={walletActionLoading}
                          className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {wallet.icon ? (
                            <img src={wallet.icon} alt={wallet.name} className="w-5 h-5 rounded" />
                          ) : (
                            <Wallet className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                          )}
                          <span className="font-medium text-blue-800 dark:text-blue-200">
                            {walletActionLoading ? 'Connecting...' : `Link ${wallet.name} Wallet`}
                          </span>
                        </button>
                      )
                    }
                    return (
                      <div>
                        <button
                          onClick={() => setShowWalletPicker(!showWalletPicker)}
                          disabled={walletActionLoading}
                          className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors disabled:opacity-50"
                        >
                          <Wallet className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                          <span className="font-medium text-blue-800 dark:text-blue-200">
                            {walletActionLoading ? 'Connecting...' : 'Link Cardano Wallet'}
                          </span>
                          <ChevronDown className={`h-4 w-4 text-blue-600 dark:text-blue-400 transition-transform ${showWalletPicker ? 'rotate-180' : ''}`} />
                        </button>
                        {showWalletPicker && (
                          <div className="mt-2 border border-border rounded-lg overflow-hidden">
                            {installed.map(wallet => (
                              <button
                                key={wallet.id}
                                onClick={() => handleLinkWallet(wallet.id)}
                                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors border-b border-border last:border-b-0"
                              >
                                {wallet.icon ? (
                                  <img src={wallet.icon} alt={wallet.name} className="w-5 h-5 rounded" />
                                ) : (
                                  <Wallet className="w-5 h-5 text-muted-foreground" />
                                )}
                                <span className="font-medium">{wallet.name}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Future features preview ── */}
        <div className="mt-6 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Coming Soon</p>
          
          <div className="flex items-start gap-3 p-3 bg-card rounded-lg border border-border opacity-70">
            <CreditCard className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">Billing & Credits</p>
                <span className="px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground rounded">Planned</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Deposit ADA to unlock higher AI inference limits and premium rate limits.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 bg-card rounded-lg border border-border opacity-70">
            <Users className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">Wallet-Gated Events</p>
                <span className="px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground rounded">Planned</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Require a linked wallet address to join specific events or meetings.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 bg-card rounded-lg border border-border opacity-70">
            <Shield className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">Wallet-Based Permissions</p>
                <span className="px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground rounded">Planned</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Grant admin or editor access to calendars by selecting other wallet addresses.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Account Linking ───────────────────────────────────── */}
      <div id="settings-account-linking" className="pt-6 border-t border-border">
        <h3 className="text-lg font-medium mb-2">Account Linking</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Link multiple sign-in methods to access your account with either Google or a Cardano wallet.
          When linking, your events and templates are merged. Settings use your current account's defaults.
        </p>

        {/* Status messages */}
        {linkError && (
          <div className="mb-4 p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg">
            <p className="text-sm text-rose-700 dark:text-rose-200 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {linkError}
            </p>
          </div>
        )}
        {linkSuccess && (
          <div className="mb-4 p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
            <p className="text-sm text-green-800 dark:text-green-200 flex items-center gap-2">
              <CheckIcon className="h-4 w-4 flex-shrink-0" />
              {linkSuccess}
            </p>
          </div>
        )}

        {/* Connected methods summary */}
        <div className="space-y-3 mb-4">
          <div className={`flex items-center gap-3 p-3 rounded-lg border ${
            walletStatus.accountType === 'google' || (walletStatus.accountType !== 'cardano' && user?.accountType === 'google')
              ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950'
              : 'border-border bg-muted/50'
          }`}>
            <Globe className="h-5 w-5 flex-shrink-0 text-blue-600 dark:text-blue-400" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Google Account</p>
              {(walletStatus.accountType === 'google' || (walletStatus.accountType !== 'cardano' && user?.accountType === 'google')) ? (
                <p className="text-xs text-green-700 dark:text-green-300">Connected — {user?.email}</p>
              ) : (
                <p className="text-xs text-muted-foreground">Not connected</p>
              )}
            </div>
            {(walletStatus.accountType === 'google' || (walletStatus.accountType !== 'cardano' && user?.accountType === 'google')) && (
              <CheckIcon className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0" />
            )}
          </div>

          <div className={`flex items-center gap-3 p-3 rounded-lg border ${
            walletStatus.linked
              ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950'
              : 'border-border bg-muted/50'
          }`}>
            <Wallet className="h-5 w-5 flex-shrink-0 text-blue-600 dark:text-blue-400" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Cardano Wallet</p>
              {walletStatus.linked && walletStatus.walletAddress ? (
                <p className="text-xs text-green-700 dark:text-green-300 font-mono truncate">
                  Connected — {walletStatus.walletAddress.slice(0, 12)}...{walletStatus.walletAddress.slice(-6)}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Not connected — link a wallet in the section above</p>
              )}
            </div>
            {walletStatus.linked && (
              <CheckIcon className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0" />
            )}
          </div>
        </div>

        {/* Link Google Account button (for Cardano-native users) */}
        {walletStatus.accountType === 'cardano' && !linkSuccess && (
          <div className="space-y-3">
            <div className="p-4 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                <strong>Note:</strong> Linking a Google Account will merge data from both accounts. Your current settings
                (timezone, theme, preferences) will be preserved. Events, templates, and calendars from both accounts will be combined.
                {user?.email?.endsWith('@cardano.wallet') && (
                  <> Your email will be updated to your Google email address.</>
                )}
              </p>
            </div>

            <button
              onClick={handleLinkGoogleAccount}
              disabled={linkLoading}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {linkLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-blue-600 dark:text-blue-400" />
              ) : (
                <Globe className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              )}
              <span className="font-medium text-blue-800 dark:text-blue-200">
                {linkLoading ? 'Preparing...' : 'Link Google Account'}
              </span>
            </button>
          </div>
        )}

        {/* Both methods connected */}
        {walletStatus.linked && (walletStatus.accountType === 'google' || user?.accountType === 'google') && (
          <div className="p-4 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
            <p className="text-sm text-green-800 dark:text-green-200 flex items-center gap-2">
              <LinkIcon className="h-4 w-4 flex-shrink-0" />
              <strong>Fully linked!</strong> You can sign in with either Google or your Cardano wallet.
            </p>
          </div>
        )}
      </div>

      {/* ── Merge confirmation modal ── */}
      {showMergeConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card text-card-foreground rounded-2xl shadow-xl border border-border p-6 max-w-md w-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-950 flex items-center justify-center">
                <Merge className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <h3 className="text-lg font-semibold">Merge Accounts?</h3>
            </div>

            <p className="text-sm text-muted-foreground mb-4">
              This wallet is linked to an existing Cardano account. Merging will:
            </p>

            <ul className="text-sm space-y-2 mb-4">
              <li className="flex items-start gap-2">
                <CheckIcon className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                <span>Combine all events, calendars, and templates from both accounts</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckIcon className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                <span>Link the wallet to your current account</span>
              </li>
              <li className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <span>Keep your current account's settings (timezone, theme, preferences)</span>
              </li>
              <li className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <span>The old Cardano-only account will be removed</span>
              </li>
            </ul>

            <p className="text-xs text-muted-foreground mb-4 italic">
              After clicking "Merge Accounts", you'll be asked to sign once with your wallet to confirm.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowMergeConfirm(false)
                  setPendingMergeWalletData(null)
                }}
                className="flex-1 px-4 py-2.5 border border-border rounded-lg hover:bg-muted transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmMerge}
                disabled={walletActionLoading}
                className="flex-1 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium disabled:opacity-50"
              >
                {walletActionLoading ? 'Merging...' : 'Merge Accounts'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Profile Visibility ────────────────────────────────── */}
      <div id="settings-visibility" className="pt-6 border-t border-border">
        <h3 className="text-lg font-medium mb-2">Profile Visibility</h3>

        {/* ── Current Status ── */}
        <div className={`p-4 rounded-lg border-2 mb-4 transition-colors duration-300 ${
          privacyPrivateEnabled
            ? 'border-rose-300 dark:border-rose-700 bg-rose-50/30 dark:bg-rose-950/20'
            : 'border-blue-400 dark:border-blue-500 bg-blue-50/30 dark:bg-blue-950/20'
        }`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors duration-300 ${
                privacyPrivateEnabled ? 'bg-rose-400 text-white' : 'bg-blue-500 text-white'
              }`}>
                {privacyPrivateEnabled ? <Lock className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium">Current Status:</p>
                  <span className={`text-sm font-semibold transition-colors duration-300 ${
                    privacyPrivateEnabled
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-blue-700 dark:text-blue-400'
                  }`}>
                    {privacyPrivateEnabled ? 'Hidden' : 'Conditionally Visible'}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {privacyPrivateEnabled
                    ? 'No profile data is shared. Only Coordination Manager Admins can see your data.'
                    : 'Some profile data is shared based on the matrix below.'
                  }
                </p>
              </div>
            </div>
            {!privacyPrivateEnabled && (
              <button
                onClick={() => {
                  setPrivacyFollowersEnabled(false)
                  setPrivacyContactsEnabled(false)
                  setPrivacyPublicEnabled(false)
                  setFollowersShowEmail(false)
                  setFollowersShowPrefs(false)
                  setFollowersAllowConnections(false)
                  setContactsShowEmail(false)
                  setContactsShowPrefs(false)
                  setContactsAllowConnections(false)
                  setPublicShowEmail(false)
                  setPublicShowPrefs(false)
                  setPublicAllowConnections(false)
                  savePrivacyNow({
                    followersEnabled: false, contactsEnabled: false, publicEnabled: false,
                    fEmail: false, fPrefs: false, fConn: false,
                    cEmail: false, cPrefs: false, cConn: false,
                    pEmail: false, pPrefs: false, pConn: false,
                  })
                }}
                className="flex w-full sm:w-auto items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-rose-500 text-white hover:bg-rose-600 transition-colors flex-shrink-0"
              >
                <ShieldBan className="w-3.5 h-3.5" />
                Reset to Hidden
              </button>
            )}
          </div>
        </div>

        {/* ── Guiding Description ── */}
        <div className="mb-4 overflow-hidden">
          <div
            key={visibilityGuideKey}
            className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800"
            style={{ animation: 'fadeSlideIn 0.3s ease-out' }}
          >
            <p className="text-sm text-blue-700 dark:text-blue-400">
              {visibilityGuideKey === 'followers'
                ? 'Followed Calendars: When you submit availability to a Coordination Calendar, you automatically follow it. Only the organiser of that calendar can see the profile data you enable in this column. Click cells below to toggle what organisers can see.'
                : visibilityGuideKey === 'contacts'
                  ? 'Friends: People you have added to your friend list via invite codes. Generate a one-time invite URL and share it. When they accept, they are added to your friend list. Click cells below to toggle what your friends can see.'
                  : visibilityGuideKey === 'feature'
                    ? 'Profile Data Features: These are the types of personal data you can choose to share. Each row represents a different kind of profile information. Click a row label to learn more about that specific data point, or click any cell to toggle sharing.'
                    : visibilityGuideKey === 'email'
                      ? 'Show Email Address: When enabled, users in the selected visibility level can see your email address on your profile. This helps others reach you directly outside the platform.'
                      : visibilityGuideKey === 'prefs'
                        ? 'Show Notification Preferences: When enabled, users in the selected visibility level can see how you prefer to be contacted. Configure your notification preferences in the Notification Preferences section above.'
                        : visibilityGuideKey === 'connections'
                          ? 'Allow Friend Requests: When enabled, users in the selected visibility level can send you a friend request. Accepting a request adds them to your friend list.'
                          : 'Click the column headers or row labels to learn about each visibility level and data point, or click any cell to toggle sharing. Your data is always protected by our Privacy Policy.'
              }
            </p>
          </div>
        </div>
        <style>{`@keyframes fadeSlideIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }`}</style>

        {/* ── Feature Matrix ── */}
        <div className="overflow-x-hidden rounded-lg border border-border mb-4">
          <table className="w-full table-fixed text-xs sm:text-sm">
            <thead>
              <tr className="bg-muted/50">
                <th
                  className={`text-left p-2 sm:p-3 font-medium border-b cursor-pointer transition-colors hover:bg-blue-50/50 dark:hover:bg-blue-950/30 ${
                    visibilityGuideKey === 'feature'
                      ? 'border-blue-400 dark:border-blue-500 bg-blue-100/60 dark:bg-blue-950/30'
                      : 'border-border'
                  }`}
                  onClick={() => setVisibilityGuideKey(visibilityGuideKey === 'feature' ? 'default' : 'feature')}
                >Profile Data Feature</th>
                <th
                  className={`text-center p-2 sm:p-3 font-medium border-b border-l cursor-pointer transition-colors hover:bg-blue-50/50 dark:hover:bg-blue-950/30 ${
                    visibilityGuideKey === 'followers'
                      ? 'border-blue-400 dark:border-blue-500 bg-blue-100/60 dark:bg-blue-950/30'
                      : 'border-border'
                  }`}
                  onClick={() => setVisibilityGuideKey(visibilityGuideKey === 'followers' ? 'default' : 'followers')}
                >
                  <div className="flex items-center justify-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Followed Calendars</span>
                    <span className="sm:hidden">Calendars</span>
                  </div>
                </th>
                <th
                  className={`text-center p-2 sm:p-3 font-medium border-b border-l cursor-pointer transition-colors hover:bg-blue-50/50 dark:hover:bg-blue-950/30 ${
                    visibilityGuideKey === 'contacts'
                      ? 'border-blue-400 dark:border-blue-500 bg-blue-100/60 dark:bg-blue-950/30'
                      : 'border-border'
                  }`}
                  onClick={() => setVisibilityGuideKey(visibilityGuideKey === 'contacts' ? 'default' : 'contacts')}
                >
                  <div className="flex items-center justify-center gap-1.5">
                    <Users className="w-3.5 h-3.5" />
                    <span>Friends</span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: 'Show email address', guideKey: 'email' as const, fVal: followersShowEmail, cVal: contactsShowEmail, fSet: setFollowersShowEmail, cSet: setContactsShowEmail, disableContacts: false },
                { label: 'Show notification preferences', guideKey: 'prefs' as const, fVal: followersShowPrefs, cVal: contactsShowPrefs, fSet: setFollowersShowPrefs, cSet: setContactsShowPrefs, disableContacts: false },
                { label: 'Allow friend requests', guideKey: 'connections' as const, fVal: followersAllowConnections, cVal: contactsAllowConnections, fSet: setFollowersAllowConnections, cSet: setContactsAllowConnections, disableContacts: true },
              ].map((row, i) => {
                const fActive = row.fVal && privacyFollowersEnabled
                const cActive = row.disableContacts ? false : (row.cVal && privacyContactsEnabled)
                const enabledCount = (fActive ? 1 : 0) + (row.disableContacts ? 0 : (cActive ? 1 : 0))
                const maxCount = row.disableContacts ? 1 : 2
                const rowHue = enabledCount === maxCount
                  ? 'bg-blue-50/30 dark:bg-blue-950/10'
                  : enabledCount >= 1
                    ? 'bg-amber-50/30 dark:bg-amber-950/10'
                    : 'bg-rose-50/20 dark:bg-rose-950/10'
                const rowLabelColor = enabledCount === maxCount
                  ? 'text-blue-700 dark:text-blue-400'
                  : enabledCount >= 1
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-rose-500 dark:text-rose-400'
                return (
                  <tr key={row.label} className={`${i < 2 ? 'border-b border-border' : ''} ${rowHue} transition-colors duration-300`}>
                    <td
                      className={`p-2 sm:p-3 font-medium leading-tight transition-colors duration-300 cursor-pointer hover:underline break-words ${rowLabelColor}`}
                      onClick={() => setVisibilityGuideKey(visibilityGuideKey === row.guideKey ? 'default' : row.guideKey)}
                    >{row.label}</td>
                    <td
                      className={`p-2 sm:p-3 text-center border-l cursor-pointer transition-all duration-200 group/cell ${
                        fActive
                          ? 'border-blue-400 dark:border-blue-500 bg-blue-100/50 dark:bg-blue-900/30'
                          : visibilityGuideKey === 'followers'
                            ? 'border-blue-300 dark:border-blue-600 bg-blue-50/30 dark:bg-blue-950/15'
                            : 'border-border hover:border-amber-300 dark:hover:border-amber-600'
                      } hover:bg-blue-100/50 dark:hover:bg-blue-900/30`}
                      onClick={() => {
                        const newFVal = !row.fVal
                        if (!privacyFollowersEnabled) setPrivacyFollowersEnabled(true)
                        row.fSet(newFVal)
                        // Build overrides for the changed feature
                        const fOverrides: Record<string, boolean> = {}
                        if (row.guideKey === 'email') fOverrides.fEmail = newFVal
                        if (row.guideKey === 'prefs') fOverrides.fPrefs = newFVal
                        if (row.guideKey === 'connections') fOverrides.fConn = newFVal
                        savePrivacyNow({ followersEnabled: true, ...fOverrides })
                      }}
                    >
                      <div className="flex items-center justify-center">
                        {fActive
                          ? <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-green-500" />
                          : <>
                              <X className="w-4 h-4 sm:w-5 sm:h-5 text-rose-400 group-hover/cell:hidden" />
                              <span className="hidden group-hover/cell:inline-flex items-center gap-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                                <X className="w-3.5 h-3.5 text-rose-400" />
                                <span>&rarr;</span>
                                <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                              </span>
                            </>
                        }
                      </div>
                    </td>
                    {row.disableContacts ? (
                      <td
                        className="p-2 sm:p-3 text-center border-l border-border bg-muted/30"
                        title="Already connected -- no request needed"
                      >
                        <span className="text-xs text-muted-foreground">N/A</span>
                      </td>
                    ) : (
                      <td
                        className={`p-2 sm:p-3 text-center border-l cursor-pointer transition-all duration-200 group/cell2 ${
                          cActive
                            ? 'border-blue-400 dark:border-blue-500 bg-blue-100/50 dark:bg-blue-900/30'
                            : visibilityGuideKey === 'contacts'
                              ? 'border-blue-300 dark:border-blue-600 bg-blue-50/30 dark:bg-blue-950/15'
                              : 'border-border hover:border-amber-300 dark:hover:border-amber-600'
                        } hover:bg-blue-100/50 dark:hover:bg-blue-900/30`}
                        onClick={() => {
                          const newCVal = !row.cVal
                          if (!privacyContactsEnabled) setPrivacyContactsEnabled(true)
                          row.cSet(newCVal)
                          const cOverrides: Record<string, boolean> = {}
                          if (row.guideKey === 'email') cOverrides.cEmail = newCVal
                          if (row.guideKey === 'prefs') cOverrides.cPrefs = newCVal
                          savePrivacyNow({ contactsEnabled: true, ...cOverrides })
                        }}
                      >
                        <div className="flex items-center justify-center">
                          {cActive
                            ? <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-green-500" />
                            : <>
                                <X className="w-4 h-4 sm:w-5 sm:h-5 text-rose-400 group-hover/cell2:hidden" />
                                <span className="hidden group-hover/cell2:inline-flex items-center gap-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                                  <X className="w-3.5 h-3.5 text-rose-400" />
                                  <span>&rarr;</span>
                                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                                </span>
                              </>
                          }
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* ─── Sharing & Invites ─────────────────────────────────── */}
      {isTraveler ? (
        <div id="settings-sharing" className="pt-6 border-t border-border">
          <h3 className="text-lg font-medium mb-2">Invite Friends</h3>
          <p className="text-sm text-amber-600 dark:text-amber-400">Friend invites are not available for Traveler accounts. Sign in with Google or a Cardano wallet to connect with friends.</p>
        </div>
      ) : (
      <div id="settings-sharing" className="pt-6 border-t border-border">
        <h3 className="text-lg font-medium mb-4">Invite Friends</h3>
        
        <p className="text-sm text-blue-600 dark:text-blue-400 mb-4">
          Generate invite codes to add friends on the platform. Friends can see the profile data you share based on your privacy settings above.
        </p>
        
        <div className="space-y-3">
          <div className="p-4 bg-card rounded-lg border border-border space-y-3">
            {!privacyContactsEnabled || (!contactsShowEmail && !contactsShowPrefs && !contactsAllowConnections) ? (
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-400">
                <p>Enable the <strong>Friends</strong> privacy level above and turn on at least one preference before generating invite codes.</p>
              </div>
            ) : !settingsInviteCode ? (
              <div className="space-y-2">
                <button
                  onClick={async () => {
                    try {
                      const res = await apiClient.post('/api/connections/invites')
                      const invite = res.data.invite
                      if (invite) {
                        setSettingsInviteCode(invite.invite_code)
                      }
                    } catch (err) {
                      console.error('Failed to generate invite:', err)
                    }
                  }}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Generate Invite Code
                </button>
                <p className="text-xs text-muted-foreground">Invite codes expire after 48 hours and are automatically deleted.</p>
              </div>
            ) : null}

            {settingsInviteCode && (
              <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  <span className="text-sm font-medium text-green-700 dark:text-green-300">Invite code generated!</span>
                </div>
                <p className="text-xs text-green-600 dark:text-green-400">
                  This code is shown only once. Copy it and share it with the people you want to connect with.
                </p>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 bg-card rounded-lg p-2 border border-border">
                  <code className="flex-1 text-xs font-mono break-all select-all">{`${window.location.origin}/join/invite/${settingsInviteCode}`}</code>
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(`${window.location.origin}/join/invite/${encodeURIComponent(settingsInviteCode)}`)
                      setSettingsInviteCopied(true)
                      setTimeout(() => setSettingsInviteCopied(false), 2000)
                    }}
                    className="p-1.5 rounded hover:bg-muted transition-colors self-end sm:self-auto shrink-0"
                  >
                    {settingsInviteCopied ? <CheckIcon className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => navigate('/user-management')}
            className="w-full flex items-center justify-between p-4 bg-card rounded-lg border border-border hover:bg-accent/50 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-muted-foreground" />
              <div className="text-left">
                <p className="font-medium">Open Friend List</p>
                <p className="text-sm text-muted-foreground">View and manage your connected friends</p>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-foreground" />
          </button>
        </div>
      </div>
      )}

      {/* ─── Legal ─────────────────────────────────────────────── */}
      <div id="settings-legal" className="pt-6 border-t border-border">
        <h3 className="text-lg font-medium mb-4">Legal</h3>
        
        <div className="space-y-3">
          <a
            href="/policy"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-between p-4 bg-card rounded-lg border border-border hover:bg-accent/50 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <div className="text-left">
                <p className="font-medium">Policy Information</p>
                <p className="text-sm text-muted-foreground">Platform policy summary and legal references</p>
              </div>
            </div>
            <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
          </a>

          <a
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-between p-4 bg-card rounded-lg border border-border hover:bg-accent/50 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <div className="text-left">
                <p className="font-medium">Privacy Policy</p>
                <p className="text-sm text-muted-foreground">How we collect, use, and protect your data</p>
              </div>
            </div>
            <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
          </a>
          
          <a
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-between p-4 bg-card rounded-lg border border-border hover:bg-accent/50 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <div className="text-left">
                <p className="font-medium">Terms of Service</p>
                <p className="text-sm text-muted-foreground">Rules and conditions for using the platform</p>
              </div>
            </div>
            <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
          </a>

          <a
            href="/trademark"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-between p-4 bg-card rounded-lg border border-border hover:bg-accent/50 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <div className="text-left">
                <p className="font-medium">Trademark Policy</p>
                <p className="text-sm text-muted-foreground">Guidelines for using Coordination Manager marks and logos</p>
              </div>
            </div>
            <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
          </a>

          <a
            href="/email-abuse"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-between p-4 bg-card rounded-lg border border-border hover:bg-accent/50 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <div className="text-left">
                <p className="font-medium">Email Abuse Policy</p>
                <p className="text-sm text-muted-foreground">Report unwanted verification emails and abuse handling policy</p>
              </div>
            </div>
            <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
          </a>

          <a
            href="/zoom-review"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-between p-4 bg-card rounded-lg border border-border hover:bg-accent/50 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <div className="text-left">
                <p className="font-medium">Zoom Integration Review</p>
                <p className="text-sm text-muted-foreground">Review and testing flow information for Zoom Marketplace</p>
              </div>
            </div>
            <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
          </a>
        </div>
      </div>
      
      {/* ─── Proposals ─────────────────────────────────────────── */}
      <div id="settings-proposals" className="pt-6 border-t border-border">
        <h3 className="text-lg font-medium mb-4">Proposals</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Proposals shared with the community and sponsors who use and support Coordination Manager.
        </p>

        <div className="space-y-3">
          <a
            href="/proposals/video-meeting"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-between p-4 bg-card rounded-lg border border-border hover:bg-accent/50 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <div className="text-left">
                <p className="font-medium">Video Meeting + Recording</p>
                <p className="text-sm text-muted-foreground">Live meetings and recording inside the platform via self-hosted Jitsi</p>
              </div>
            </div>
            <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
          </a>

          <a
            href="/proposals/data-privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-between p-4 bg-card rounded-lg border border-border hover:bg-accent/50 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <div className="text-left">
                <p className="font-medium">User Data Privacy + Encryption</p>
                <p className="text-sm text-muted-foreground">At-rest encryption options, maintenance cost, and speed trade-offs</p>
              </div>
            </div>
            <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
          </a>
        </div>
      </div>
      
      {/* ─── Account Actions ───────────────────────────────────── */}
      <div id="settings-account-actions" className="pt-6 border-t border-border">
        <h3 className="text-lg font-medium mb-4">Account Actions</h3>
        
        <div className="space-y-3">
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-between p-4 bg-card rounded-lg border border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <LogOut className="h-5 w-5 text-rose-500 dark:text-rose-400" />
              <div className="text-left">
                <p className="font-medium text-rose-800 dark:text-rose-200">Sign out</p>
                <p className="text-sm text-rose-500 dark:text-rose-400">Sign out of your account</p>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-rose-400 group-hover:text-rose-500 dark:group-hover:text-rose-300" />
          </button>
          
          <button
            onClick={handleDeleteAccount}
            className="w-full flex items-center justify-between p-4 bg-rose-50 dark:bg-rose-950/40 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <Trash2 className="h-5 w-5 text-rose-500 dark:text-rose-400" />
              <div className="text-left">
                <p className="font-medium text-rose-800 dark:text-rose-200">Delete account</p>
                <p className="text-sm text-rose-500 dark:text-rose-400">Permanently delete your account and data</p>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-rose-400 group-hover:text-rose-500 dark:group-hover:text-rose-300" />
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-6xl mx-auto py-8 px-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">Settings</h1>
            <p className="text-muted-foreground">Manage your account and preferences</p>
          </div>
        </div>
        
        <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
          {/* Mobile Categories */}
          <nav className="lg:hidden">
            <div className="bg-card text-card-foreground rounded-xl shadow-sm border border-border p-2">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {tabs.map(tab => {
                  const Icon = tab.icon
                  const isPrivate = tab.id === 'calendar' || tab.id === 'privacy'
                  return (
                    <button
                      key={tab.id}
                      onClick={() => handleTabChange(tab.id)}
                      className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm text-center min-w-0 transition-colors ${
                        activeTab === tab.id
                          ? isPrivate
                            ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                            : 'bg-primary/10 text-primary'
                          : isPrivate
                            ? 'text-rose-500 dark:text-rose-400 hover:bg-rose-50/50 dark:hover:bg-rose-950/30 border border-transparent'
                            : 'text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="font-medium truncate">{tab.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </nav>

          {/* Left Sidebar — Categories */}
          <nav className="hidden w-52 flex-shrink-0 lg:block">
            <div className="sticky top-8 bg-card text-card-foreground rounded-xl shadow-sm border border-border p-2">
              {tabs.map(tab => {
                const Icon = tab.icon
                const isPrivate = tab.id === 'calendar' || tab.id === 'privacy'
                return (
                  <button
                    key={tab.id}
                    onClick={() => handleTabChange(tab.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
                      activeTab === tab.id
                        ? isPrivate
                          ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                          : 'bg-primary/10 text-primary'
                        : isPrivate
                          ? 'text-rose-500 dark:text-rose-400 hover:bg-rose-50/50 dark:hover:bg-rose-950/30 border border-transparent'
                          : 'text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="font-medium">{tab.label}</span>
                  </button>
                )
              })}
            </div>
          </nav>
          
          {/* Content */}
          <div className="flex-1 min-w-0" ref={contentRef}>
            <div className="bg-card text-card-foreground rounded-xl shadow-sm border border-border p-4 sm:p-6">
              {activeTab === 'profile' && renderProfileTab()}
              {activeTab === 'notifications' && renderNotificationsTab()}
              {activeTab === 'calendar' && renderCalendarTab()}
              {activeTab === 'ai' && renderAiTab()}
              {activeTab === 'privacy' && renderPrivacyTab()}
            </div>
          </div>

          {/* Right Sidebar — Subcategory Quicklinks */}
          {TAB_SUBCATEGORIES[activeTab].length > 0 && (
            <nav className="w-48 flex-shrink-0 hidden lg:block">
              <div className="sticky top-8 bg-card text-card-foreground rounded-xl shadow-sm border border-border p-2">
                <p className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">On this page</p>
                {TAB_SUBCATEGORIES[activeTab].map(sub => (
                  <button
                    key={sub.id}
                    onClick={() => scrollToSection(sub.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                      activeSection === sub.id
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    <span className={`w-1 h-4 rounded-full flex-shrink-0 transition-colors ${
                      activeSection === sub.id ? 'bg-primary' : 'bg-transparent'
                    }`} />
                    {sub.label}
                  </button>
                ))}
              </div>
            </nav>
          )}
        </div>
      </div>
    </div>
  )
}
