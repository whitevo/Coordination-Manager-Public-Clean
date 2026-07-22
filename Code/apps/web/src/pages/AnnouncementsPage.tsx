import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { resolveMeetingTitle } from '../lib/calendar-utils'
import LearnerHelpIcon from '../components/LearnerHelpIcon'
import ResponsesTab from '../components/announcements/ResponsesTab'
import {
  Megaphone,
  Plus,
  Send,
  Clock,
  Trash2,
  Copy,
  Pencil,
  Check,
  X,
  RefreshCw,
  Unlink,
  Hash,
  Users,
  Bot,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  Key,
  ShieldAlert,
  ShieldCheck,
  CalendarDays,
  Info,
  Search,
  ChevronDown,
  ChevronRight,
  Filter,
  ListChecks,
  Clipboard,
  ClipboardCheck,
  ExternalLink,
  Tags,
  FileText,
  Sparkles,
  MessageSquare,
  Mail,
  Eye,
  EyeOff,
  UserPlus,
  Shield,
  AlertCircle,
  Link2,
  Tag,
  SlidersHorizontal,
  Server,
  Smile,
} from 'lucide-react'
import EmojiPicker from '../components/announcements/EmojiPicker'
import { apiClient } from '../lib/api-client'
import { useAuth } from '../contexts/AuthContext'
import { useAiAssistant } from '../contexts/AiAssistantContext'
import { useToast } from '../components/Toast'
import { getPrimaryTimezone, formatDateDDMMYYYYInTimezone, formatDateTimeDDMMYYYYInTimezone } from '../lib/timezone-data'

// ─── Types ────────────────────────────────────────────────────────────

interface DiscordIntegration {
  id: string
  link_key: string
  link_key_expires_at: string
  discord_user_id: string | null
  discord_username: string | null
  discord_avatar: string | null
  bot_verified: boolean
  bot_verified_at: string | null
  is_active: boolean
  created_at: string
}

interface DiscordChannel {
  channel_id: string
  channel_name: string
  label: string | null
  is_active: boolean
  bot_can_send: boolean
  user_can_send: boolean
}

interface DiscordGuild {
  guild_id: string
  guild_name: string
  guild_icon: string | null
  channels: DiscordChannel[]
}

interface AnnouncementTemplate {
  id: string
  title: string
  body: string
  calendar_id: string | null
  tags: string[]
  meeting_ids: string[]
  distribution_channel_ids: string[]
  dm_recipient_ids: string[]
  created_at: string
  updated_at: string
}

interface AnnouncementTarget {
  type: 'discord_channel' | 'discord_dm' | 'email'
  target_id: string
  label?: string
  body_override?: string  // Optional: overrides schedule.body for this specific target (e.g. DMs get extra content)
}

interface AnnouncementSchedule {
  id: string
  title: string
  body: string
  scheduled_at: string
  timezone: string
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'partially_sent' | 'cancelled'
  targets: AnnouncementTarget[]
  sent_at: string | null
  error_message: string | null
  created_at: string
}

interface DeliveryLogEntry {
  id: string
  channel_type: string
  target_id: string
  target_label: string | null
  status: 'pending' | 'sent' | 'failed'
  discord_message_id: string | null
  error_message: string | null
  delivered_at: string | null
  created_at: string
  subscription_status?: 'invited' | 'subscribed' | 'unsubscribed' | 'opted_out' | 'muted_bot' | null
  recipient_response?: 'invited' | 'subscribed' | 'unsubscribed' | 'opted_out' | 'muted_bot' | null
}

// Poll option for reaction-based polling
interface PollOption {
  emoji: string
  text: string
}

const DEFAULT_POLL_EMOJIS = ['🌟', '🎯', '🌿', '🔥', '🎨', '🐱', '🌊', '🍕', '🏔️', '⭐']

const EMOJI_PICKER_OPTIONS = [
  // Faces & Gestures
  '👍', '👎', '✅', '❌', '🤔', '😍', '🎉', '💯',
  // Nature & Animals
  '🌟', '⭐', '🔥', '🌊', '🌿', '🌸', '🌈', '🐱',
  '🐶', '🦊', '🐻', '🦋', '🌻', '🍀', '🌙', '☀️',
  // Objects & Activities
  '🎯', '🎨', '🎵', '🎲', '🚀', '💎', '🏆', '🎬',
  '📚', '🔮', '🎸', '🎭', '🏔️', '🍕', '🍩', '☕',
  // Symbols
  '❤️', '💙', '💚', '💛', '🟢', '🔵', '🔴', '🟡',
]

// A row in the compose distribution table
interface DistributionRow {
  integration: string        // e.g. "Discord"
  guild_name: string         // Server name
  channel_name: string       // Channel name
  channel_id: string         // For targeting
  bot_can_send: boolean      // Bot permission check
  user_can_send: boolean     // User permission check
  selected: boolean          // Checkbox state
  status: 'composing' | 'scheduled' | 'sending' | 'sent' | 'failed'
  status_msg: string         // Error desc, success desc, or scheduled datetime
}

// DM-able member from shared guilds
interface DmMember {
  user_id: string
  username: string
  display_name: string
  avatar: string | null
  guild_id?: string
  guild_ids?: string[]
  guild_name?: string
  guild_names?: string[]
  roles?: Array<{ id: string; name: string; color: number; guild_id?: string; guild_name?: string }>
  opted_out?: boolean
  opt_out_reason?: string
  subscription_status?: 'invited' | 'subscribed' | 'unsubscribed' | 'opted_out' | 'muted_bot' | null
}

// A DM row in the compose distribution table
interface DmDistributionRow {
  integration: string
  user_id: string
  username: string
  display_name: string
  avatar: string | null
  guild_names: string[]
  roles: Array<{ id: string; name: string; color: number; guild_id?: string; guild_name?: string }>
  opted_out: boolean
  private_dm: boolean
  selected: boolean
  status: 'composing' | 'scheduled' | 'sending' | 'sent' | 'failed'
  status_msg: string
  subscription_status?: 'invited' | 'subscribed' | 'unsubscribed' | 'opted_out' | 'muted_bot' | null
}

// Meeting from user's calendars for announcement context
interface MeetingOption {
  id: string
  calendar_id: string
  calendar_title: string
  calendar_hash: string
  title: string
  description: string | null
  start_time: string
  end_time: string
  duration_minutes: number
  meeting_link: string | null
  time_slots: string[] | null
}

// Coordination Calendar (may or may not have meetings yet)
interface CalendarOption {
  id: string
  title: string
  hash: string
  onboardingUrl?: string | null
}

// Reminder offset for per-meeting scheduled announcements.
// value=0 with unit='min' means "at meeting start time".
type ReminderUnit = 'min' | 'hour' | 'day' | 'week'
interface ReminderOffset {
  id: string
  value: number
  unit: ReminderUnit
}

// Email contact from database
interface EmailContact {
  id: string
  email: string
  display_name: string | null
  tags: string[]
  source: 'manual' | 'platform_verified' | 'both'
  linked_user_id: string | null
  opted_out: boolean
  opted_out_at: string | null
  notification_disabled: boolean // derived: user has notification channels turned off
  created_at: string
}

// Enriched calendar participant for email recipients
interface CalendarParticipantEmail {
  username: string
  user_id: string | null
  email: string | null
  email_status: 'visible' | 'hidden' | 'disabled' | 'no_account'
  calendar_ids: string[]
}

// Unified email recipient row combining all sources
interface EmailRecipientRow {
  key: string           // unique key: source:id
  display_name: string
  email: string | null  // null = no email available
  email_display: string // what to show in the email column
  source: 'manual' | 'calendar' | 'friendlist'
  source_detail: string // calendar name(s), or empty
  status_label: string
  status_color: string
  selectable: boolean   // can this row be selected (has usable email)
}

// ─── Sub-Tab type ─────────────────────────────────────────────────────

type SubTab = 'compose' | 'templates' | 'scheduled' | 'responses' | 'discord' | 'email'

const VALID_TABS: SubTab[] = ['compose', 'templates', 'scheduled', 'responses', 'discord', 'email']

// ─── Date Helpers ─────────────────────────────────────────────────────

/** Format a date as dd.mm.yyyy in user's primary timezone */
const formatDateDDMMYYYY = (date: Date | string): string => {
  const tz = getPrimaryTimezone()
  return formatDateDDMMYYYYInTimezone(date, tz)
}

/** Format a date as dd.mm.yyyy HH:MM TZ in user's primary timezone */
const formatDateTimeDDMMYYYY = (date: Date | string): string => {
  const tz = getPrimaryTimezone()
  return formatDateTimeDDMMYYYYInTimezone(date, tz)
}

/** Render basic Discord markdown to React elements */
const renderDiscordMarkdown = (text: string): React.ReactNode[] => {
  // Split text into lines first, then process inline formatting
  const lines = text.split('\n')
  const result: React.ReactNode[] = []
  lines.forEach((line, lineIdx) => {
    if (lineIdx > 0) result.push(<br key={`br-${lineIdx}`} />)
    // Process inline formatting: **bold**, *italic*, `code`, custom emoji <:name:id> / <a:name:id>
    const parts = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|<a?:\w+:\d+>)/g)
    parts.forEach((part, partIdx) => {
      const key = `${lineIdx}-${partIdx}`
      if (part.startsWith('**') && part.endsWith('**')) {
        result.push(<strong key={key}>{part.slice(2, -2)}</strong>)
      } else if (part.startsWith('*') && part.endsWith('*')) {
        result.push(<em key={key}>{part.slice(1, -1)}</em>)
      } else if (part.startsWith('`') && part.endsWith('`')) {
        result.push(<code key={key} className="px-1 py-0.5 bg-muted rounded text-[11px]">{part.slice(1, -1)}</code>)
      } else {
        const emojiMatch = part.match(/^<(a?):(\w+):(\d+)>$/)
        if (emojiMatch) {
          const [, animated, name, id] = emojiMatch
          const ext = animated ? 'gif' : 'png'
          result.push(
            <img
              key={key}
              src={`https://cdn.discordapp.com/emojis/${id}.${ext}?size=48`}
              alt={`:${name}:`}
              title={`:${name}:`}
              className="inline-block w-5 h-5 align-text-bottom"
              loading="lazy"
            />
          )
        } else {
          result.push(<span key={key}>{part}</span>)
        }
      }
    })
  })
  return result
}

// ─── Component ────────────────────────────────────────────────────────

export default function AnnouncementsPage() {
  const { isAuthenticated, user, isCardano } = useAuth()
  const isAdmin = user?.roles?.includes('admin')
  const { setPageContext } = useAiAssistant()
  const { showToast } = useToast()
  const doAiComposeRef = useRef<((
    message: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  ) => Promise<{ message: string; action?: string; systemPrompt?: string }>) | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const initialTab = (searchParams.get('tab') as SubTab) || 'compose'
  const [activeTab, setActiveTab] = useState<SubTab>(
    VALID_TABS.includes(initialTab) ? initialTab : 'compose'
  )

  // Ensure tab is always visible in URL (default to compose)
  useEffect(() => {
    if (!searchParams.get('tab')) {
      const next = new URLSearchParams(searchParams)
      next.set('tab', 'compose')
      setSearchParams(next, { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const switchTab = useCallback((tab: SubTab) => {
    setActiveTab(tab)
    const next = new URLSearchParams(searchParams)
    next.set('tab', tab)
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  // Discord integration state
  const [integration, setIntegration] = useState<DiscordIntegration | null>(null)
  const [guilds, setGuilds] = useState<DiscordGuild[]>([])
  const [loadingIntegration, setLoadingIntegration] = useState(true)
  const [generatingKey, setGeneratingKey] = useState(false)
  const [keyCopied, setKeyCopied] = useState(false)

  // Templates
  const [templates, setTemplates] = useState<AnnouncementTemplate[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(true)

  // Schedules
  const [schedules, setSchedules] = useState<AnnouncementSchedule[]>([])
  const [loadingSchedules, setLoadingSchedules] = useState(true)
  const [expandedScheduleIds, setExpandedScheduleIds] = useState<Set<string>>(new Set())
  const [scheduleDeliveryLogs, setScheduleDeliveryLogs] = useState<Record<string, DeliveryLogEntry[]>>({})
  const [loadingDeliveryLogIds, setLoadingDeliveryLogIds] = useState<Set<string>>(new Set())

  // Compose state — session-cached so navigating away and back doesn't lose in-progress work.
  // sessionStorage is cleared on tab/browser close — no persistent user data stored.
  const [composeTitle, setComposeTitle] = useState(() => {
    try { return sessionStorage.getItem('cm-ann-title') ?? '' } catch { return '' }
  })
  const [composeBody, setComposeBody] = useState(() => {
    try { return sessionStorage.getItem('cm-ann-body') ?? '' } catch { return '' }
  })
  const [composeDmBody, setComposeDmBody] = useState(() => {
    try { return sessionStorage.getItem('cm-ann-dm-body') ?? '' } catch { return '' }
  })
  const [dmBodyExpanded, setDmBodyExpanded] = useState(false)
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleTime, setScheduleTime] = useState('')
  const [sendMode, setSendMode] = useState<'now' | 'schedule'>(() => {
    try { return (sessionStorage.getItem('cm-ann-send-mode') as 'now' | 'schedule') ?? 'now' } catch { return 'now' }
  })
  // Per-meeting reminder offsets: when scheduling and meetings are selected,
  // create one schedule per (meeting x offset) at meeting.start - offset.
  const [reminderOffsets, setReminderOffsets] = useState<ReminderOffset[]>(() => {
    try {
      const saved = sessionStorage.getItem('cm-ann-reminder-offsets')
      if (saved) {
        const parsed = JSON.parse(saved) as ReminderOffset[]
        if (Array.isArray(parsed)) return parsed
      }
    } catch { /* ignore */ }
    return []
  })
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null)

  // Poll state — session-cached
  const [pollEnabled, setPollEnabled] = useState(() => {
    try { return sessionStorage.getItem('cm-ann-poll-enabled') === 'true' } catch { return false }
  })
  const [pollOptions, setPollOptions] = useState<PollOption[]>(() => {
    try {
      const saved = sessionStorage.getItem('cm-ann-poll-options')
      if (saved) {
        const parsed = JSON.parse(saved) as PollOption[]
        if (Array.isArray(parsed) && parsed.length >= 2) return parsed
      }
    } catch { /* ignore */ }
    return [{ emoji: '🌟', text: '' }, { emoji: '🎯', text: '' }]
  })
  const [emojiPickerIdx, setEmojiPickerIdx] = useState<number | null>(null)
  const emojiPickerRef = useRef<HTMLDivElement>(null)

  // Body emoji picker
  const [showBodyEmojiPicker, setShowBodyEmojiPicker] = useState(false)
  const bodyEmojiPickerRef = useRef<HTMLDivElement>(null)
  const [showDmBodyEmojiPicker, setShowDmBodyEmojiPicker] = useState(false)
  const dmBodyRef = useRef<HTMLTextAreaElement>(null)

  // Suppress link-preview embeds (default: true)
  const [suppressEmbeds, setSuppressEmbeds] = useState(() => {
    try { const v = sessionStorage.getItem('cm-ann-suppress-embeds'); return v === null ? true : v === 'true' } catch { return true }
  })

  // Distribution table (compose tab)
  const [distributionRows, setDistributionRows] = useState<DistributionRow[]>([])
  const [dmRows, setDmRows] = useState<DmDistributionRow[]>([])
  const [dmMembers, setDmMembers] = useState<DmMember[]>([])
  const [loadingDmMembers, setLoadingDmMembers] = useState(false)
  const [dmLoadPhase, setDmLoadPhase] = useState<'idle' | 'phase1' | 'phase2' | 'done'>('idle')
  const [dmPhase2MemberCount, setDmPhase2MemberCount] = useState(0)
  const [dmProgress, setDmProgress] = useState<{ checked: number; total: number; found: number; guildNames: string[] } | null>(null)
  const [dmCancelled, setDmCancelled] = useState(false)
  const dmAbortRef = useRef<AbortController | null>(null)
  const [dmScanInfo, setDmScanInfo] = useState<{
    type: 'idle' | 'loading_members' | 'checking_subscriptions'
    message: string
    debug?: Record<string, unknown>
  }>({ type: 'idle', message: '' })
  const [activeScheduleId, setActiveScheduleId] = useState<string | null>(null)
  const sendingRef = useRef(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [emailDeliveryStatus, setEmailDeliveryStatus] = useState<{ total: number; sent: number; failed: number }>({ total: 0, sent: 0, failed: 0 })

  // Email integration state
  const [emailContacts, setEmailContacts] = useState<EmailContact[]>([])
  const [loadingEmailContacts, setLoadingEmailContacts] = useState(false)
  const [emailIntegrationSetup, setEmailIntegrationSetup] = useState(() => {
    try {
      return localStorage.getItem('cm-ann-email-integration') === 'true'
    } catch { return false }
  })
  const [showEmails, setShowEmails] = useState(false)
  const [addEmailName, setAddEmailName] = useState('')
  const [addEmailAddress, setAddEmailAddress] = useState('')
  const [addingEmail, setAddingEmail] = useState(false)
  const [addEmailTags, setAddEmailTags] = useState('')
  const [bulkEmailInput, setBulkEmailInput] = useState('')
  const [bulkNamesInput, setBulkNamesInput] = useState('')
  const [bulkTagsInput, setBulkTagsInput] = useState('')
  const [bulkImporting, setBulkImporting] = useState(false)
  const [bulkImportResult, setBulkImportResult] = useState<{ imported: number; skipped: number } | null>(null)
  const [editingContactId, setEditingContactId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editTags, setEditTags] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [emailSearchQuery, setEmailSearchQuery] = useState('')
  const [emailSelectedOnly, setEmailSelectedOnly] = useState(false)
  const [selectedEmailRecipients, setSelectedEmailRecipients] = useState<Set<string>>(new Set())
  const [emailSubject, setEmailSubject] = useState('')
  const [friendConnections, setFriendConnections] = useState<{ user_id: string; display_name: string; email: string | null }[]>([])
  const [loadingFriends, setLoadingFriends] = useState(false)
  const [emailServiceStatus, setEmailServiceStatus] = useState<{
    configured: boolean
    platformConfigured: boolean
    platformFrom: string | null
    userConfig: { email: string; verified: boolean } | null
    encryptionAvailable: boolean
    verifiedSenderEmail: string | null
  } | null>(null)

  // Current user's email notification channel toggle (from notification preferences)
  const [notifChannelEmail, setNotifChannelEmail] = useState<boolean | null>(null)

  // Verified email addresses state (mirrors Settings > Privacy > Email Addresses)
  const [verifiedEmails, setVerifiedEmails] = useState<{ id: string; email: string; verification_method: string; is_primary: boolean; verified_at: string }[]>([])
  const [loadingVerifiedEmails, setLoadingVerifiedEmails] = useState(false)
  const [verifyEmailInput, setVerifyEmailInput] = useState('')
  const [verifyCodeInput, setVerifyCodeInput] = useState('')
  const [verifyStep, setVerifyStep] = useState<'idle' | 'sending' | 'code-sent' | 'verifying'>('idle')
  const [verifyPendingEmail, setVerifyPendingEmail] = useState('')
  const [verifyResult, setVerifyResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Email tab collapsible sections
  const [verifiedEmailsCollapsed, setVerifiedEmailsCollapsed] = useState(true)
  const [emailConfCollapsed, setEmailConfCollapsed] = useState(true)
  const [addContactCollapsed, setAddContactCollapsed] = useState(false)
  const [contactsListCollapsed, setContactsListCollapsed] = useState(false)

  // User SMTP config state
  const [smtpEmail, setSmtpEmail] = useState('')
  const [smtpPassword, setSmtpPassword] = useState('')
  const [smtpHost, setSmtpHost] = useState('smtp.gmail.com')
  const [smtpPort, setSmtpPort] = useState('587')
  const [smtpDisplayName, setSmtpDisplayName] = useState('')
  const [savingSmtp, setSavingSmtp] = useState(false)
  const [testingSmtp, setTestingSmtp] = useState(false)
  const [smtpResult, setSmtpResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Template editing
  const [editingTemplate, setEditingTemplate] = useState<AnnouncementTemplate | null>(null)
  const [templateTitle, setTemplateTitle] = useState('')
  const [templateBody, setTemplateBody] = useState('')
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [templatePickerExpanded, setTemplatePickerExpanded] = useState(false)
  const [templateOverrideTarget, setTemplateOverrideTarget] = useState<AnnouncementTemplate | null>(null)

  // Meeting selection for compose context
  const [meetings, setMeetings] = useState<MeetingOption[]>([])
  const [allCalendars, setAllCalendars] = useState<CalendarOption[]>([])
  const [loadingMeetings, setLoadingMeetings] = useState(false)
  const [selectedMeetingIds, setSelectedMeetingIds] = useState<Set<string>>(() => {
    try {
      const saved = sessionStorage.getItem('cm-ann-selected-meetings')
      if (saved) return new Set<string>(JSON.parse(saved) as string[])
    } catch { /* ignore */ }
    return new Set<string>()
  })
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<Set<string>>(() => {
    try {
      const saved = sessionStorage.getItem('cm-ann-selected-calendars')
      if (saved) return new Set<string>(JSON.parse(saved) as string[])
    } catch { /* ignore */ }
    return new Set<string>()
  })
  const [meetingContextExpanded, setMeetingContextExpanded] = useState(false)
  // Snapshot of selected IDs at the time the panel was expanded — used to pin selected items to top
  const pinnedMeetingIdsRef = useRef<Set<string>>(new Set())
  const pinnedCalendarIdsRef = useRef<Set<string>>(new Set())
  const [calendarParticipants, setCalendarParticipants] = useState<Record<string, string[]>>({})
  const [calendarParticipantEmails, setCalendarParticipantEmails] = useState<CalendarParticipantEmail[]>([])
  const [participantPanelExpanded, setParticipantPanelExpanded] = useState(false)
  const [participantsCopied, setParticipantsCopied] = useState(false)

  // Meeting context field toggles — controls which fields are included in the compose output
  const [meetingContextFields, setMeetingContextFields] = useState<Record<string, boolean>>(() => {
    try {
      const saved = sessionStorage.getItem('cm-ann-meeting-context-fields')
      if (saved) return JSON.parse(saved)
    } catch { /* ignore */ }
    return { title: true, description: true, dateTime: true, meetingLink: true, addToCalendar: true, onboardingLink: true }
  })
  const [contextFieldsExpanded, setContextFieldsExpanded] = useState(false)
  const [archivedCalendarsExpanded, setArchivedCalendarsExpanded] = useState(false)
  // Per-calendar collapse state for meeting checkbox lists (default = expanded)
  const [collapsedCalendarMeetings, setCollapsedCalendarMeetings] = useState<Set<string>>(new Set())

  // DM enhancement state
  const [dmSearchQuery, setDmSearchQuery] = useState('')
  const [showDmTooltip, setShowDmTooltip] = useState(false)
  const [dmRoleFilter, setDmRoleFilter] = useState<string[]>([]) // role IDs to filter by
  const [showRoleDropdown, setShowRoleDropdown] = useState(false)
  const [dmPage, setDmPage] = useState(1) // pagination for DM members list
  const [roleSearchQuery, setRoleSearchQuery] = useState('') // search within role dropdown
  const [dmSelectedOnly, setDmSelectedOnly] = useState(false) // filter to show only selected users
  const [distSelectedOnly, setDistSelectedOnly] = useState(false) // filter to show only selected distribution targets

  // Advanced DM filter state
  const [dmAdvancedFilters, setDmAdvancedFilters] = useState(false) // toggle compact vs advanced mode
  const [dmServerFilter, setDmServerFilter] = useState<string[]>([]) // guild names to filter by
  const [dmStatusFilter, setDmStatusFilter] = useState<string[]>([]) // status values to filter by
  const [dmUserFilter, setDmUserFilter] = useState('') // separate user name filter (advanced)
  const [dmServerSearch, setDmServerSearch] = useState('') // search within server filter
  const [dmDetailsFilter, setDmDetailsFilter] = useState<string[]>([]) // details/status_msg filter

  // AI Compose Assistant state — aiContext is session-cached (background knowledge)
  const [aiContext, setAiContext] = useState(() => {
    try { return sessionStorage.getItem('cm-ann-ai-context') ?? '' } catch { return '' }
  })
  const [aiContextExpanded, setAiContextExpanded] = useState(false)
  const [aiAvailable, setAiAvailable] = useState(false)
  const [_nameMatchInput, setNameMatchInput] = useState('')
  const [_nameMatchResult, setNameMatchResult] = useState<{ matched: number; total: number; names: string[] } | null>(null)
  // Temporary per-member match metadata (not persisted) — maps user_id to best score and which input name matched
  const [dmMatchMeta, setDmMatchMeta] = useState<Map<string, { score: number; matchedBy: string }>>(new Map())

  // Auto-resize body textarea: match content + 3 extra lines (min 6, max 15)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const [bodyRows, setBodyRows] = useState(6)
  // Clear any stale inline height on mount (previous code versions may have set it)
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.style.height = ''
  }, [])
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.style.height = ''
    const lineCount = (composeBody.match(/\n/g) || []).length + 1
    const desired = Math.min(Math.max(lineCount + 3, 6), 15)
    setBodyRows(desired)
  }, [composeBody])

  // Collapsible channel state (persisted in localStorage)
  const [collapsedGuilds, setCollapsedGuilds] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('cm-collapsed-guilds')
      return saved ? JSON.parse(saved) : {}
    } catch { return {} }
  })
  const [channelsLastSynced, setChannelsLastSynced] = useState<string | null>(() => {
    try {
      return localStorage.getItem('cm-channels-last-synced')
    } catch { return null }
  })

  // ─── Prefill from query params (e.g. Distribute from Calendar page) ───

  // Store pending meeting pre-selection criteria to apply once meetings finish loading
  const pendingMeetingPrefill = useRef<{ meetingIds?: string[]; calendarHash?: string; calendarOnly?: boolean } | null>(null)

  useEffect(() => {
    let prefillTitle = searchParams.get('prefillTitle')
    let prefillBody = searchParams.get('prefillBody')
    let prefillReset = searchParams.get('prefillReset')
    let prefillMeetingIds = searchParams.get('prefillMeetingIds')
    let prefillCalendarHash = searchParams.get('prefillCalendarHash')
    let prefillCalendarOnly = searchParams.get('prefillCalendarOnly') === '1'

    // Fallback for flows where intermediate redirects/guards strip query params.
    if (!prefillTitle && !prefillBody) {
      try {
        prefillTitle = sessionStorage.getItem('cm-ann-prefill-title')
        prefillBody = sessionStorage.getItem('cm-ann-prefill-body')
        prefillReset = sessionStorage.getItem('cm-ann-prefill-reset')
        prefillMeetingIds = sessionStorage.getItem('cm-ann-prefill-meeting-ids')
        prefillCalendarHash = sessionStorage.getItem('cm-ann-prefill-calendar-hash')
        prefillCalendarOnly = sessionStorage.getItem('cm-ann-prefill-calendar-only') === '1'
      } catch {
        // ignore storage failures
      }
    }

    if (prefillTitle || prefillBody) {
      // When prefillReset is set, clear all cached compose state first
      if (prefillReset) {
        const keysToRemove = [
          'cm-ann-title', 'cm-ann-body', 'cm-ann-dm-body',
          'cm-ann-ai-context', 'cm-ann-ai-input',
          'cm-ann-poll-enabled', 'cm-ann-poll-options',
          'cm-ann-send-mode', 'cm-ann-selected-meetings', 'cm-ann-selected-calendars',
          'cm-ann-meeting-context-fields',
        ]
        keysToRemove.forEach(k => { try { sessionStorage.removeItem(k) } catch { /* ignore */ } })

        // Reset compose state
        setComposeDmBody('')
        setPollEnabled(false)
        setPollOptions([{ text: '', emoji: '' }, { text: '', emoji: '' }])
        setSendMode('now')
        setScheduleDate('')
        setScheduleTime('')
        setSelectedMeetingIds(new Set())
        setSelectedCalendarIds(new Set())
        setMeetingContextFields({ title: true, description: true, dateTime: true, meetingLink: true, addToCalendar: true, onboardingLink: true })
      }

      if (prefillTitle) setComposeTitle(prefillTitle)
      if (prefillBody) setComposeBody(prefillBody)
      switchTab('compose')

      // Queue meeting pre-selection (applied after meetings load)
      if (prefillMeetingIds) {
        const ids = prefillMeetingIds.split(',').filter(Boolean)
        pendingMeetingPrefill.current = { meetingIds: ids }
      } else if (prefillCalendarHash) {
        pendingMeetingPrefill.current = {
          calendarHash: prefillCalendarHash,
          calendarOnly: prefillCalendarOnly,
        }
      }

      // Clean up URL params after applying
      const next = new URLSearchParams(searchParams)
      next.delete('prefillTitle')
      next.delete('prefillBody')
      next.delete('prefillReset')
      next.delete('prefillMeetingIds')
      next.delete('prefillCalendarHash')
      next.delete('prefillCalendarOnly')
      setSearchParams(next, { replace: true })

      try {
        sessionStorage.removeItem('cm-ann-prefill-title')
        sessionStorage.removeItem('cm-ann-prefill-body')
        sessionStorage.removeItem('cm-ann-prefill-reset')
        sessionStorage.removeItem('cm-ann-prefill-meeting-ids')
        sessionStorage.removeItem('cm-ann-prefill-calendar-hash')
        sessionStorage.removeItem('cm-ann-prefill-calendar-only')
      } catch {
        // ignore storage failures
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Apply pending meeting pre-selection once meetings (and/or calendars) have loaded
  useEffect(() => {
    if (!pendingMeetingPrefill.current) return
    const { meetingIds, calendarHash, calendarOnly } = pendingMeetingPrefill.current

    // Calendar-only path: attach the calendar entry itself, no individual meetings.
    // Resolve calendar id by hash from the allCalendars list, then fall back to any
    // meeting carrying that hash if the calendar list hasn't arrived yet.
    if (calendarOnly && calendarHash) {
      let calId = allCalendars.find(c => c.hash === calendarHash)?.id
      if (!calId) {
        calId = meetings.find(m => m.calendar_hash === calendarHash)?.calendar_id
      }
      if (!calId) return // wait for data to load
      pendingMeetingPrefill.current = null
      setSelectedCalendarIds(new Set([calId]))
      setMeetingContextExpanded(true)
      return
    }

    if (meetings.length === 0) return
    pendingMeetingPrefill.current = null

    if (meetingIds && meetingIds.length > 0) {
      // Select specific meetings by their database IDs
      const validIds = new Set(meetings.map(m => m.id))
      setSelectedMeetingIds(new Set(meetingIds.filter(id => validIds.has(id))))
    } else if (calendarHash) {
      // Select all meetings from this calendar
      setSelectedMeetingIds(new Set(
        meetings.filter(m => m.calendar_hash === calendarHash).map(m => m.id)
      ))
    }

    setMeetingContextExpanded(true)
  }, [meetings, allCalendars])  

  // ─── Data Loading ──────────────────────────────────────────

  const fetchIntegration = useCallback(async () => {
    try {
      const res = await apiClient.get('/api/discord/integration')
      setIntegration(res.data.integration)
      if (res.data.integration?.bot_verified) {
        const guildsRes = await apiClient.get('/api/discord/guilds')
        setGuilds(guildsRes.data.guilds || [])
        // Background sync to discover new servers/channels silently
        apiClient.post('/api/discord/refresh-guilds')
          .then(() => apiClient.get('/api/discord/guilds'))
          .then(freshRes => setGuilds(freshRes.data.guilds || []))
          .catch(() => {}) // Silent — user can manually sync if needed
      }
    } catch { /* not connected */ }
    setLoadingIntegration(false)
  }, [])

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await apiClient.get('/api/announcements/templates')
      setTemplates(res.data.templates || [])
    } catch { /* ignore */ }
    setLoadingTemplates(false)
  }, [])

  const fetchSchedules = useCallback(async () => {
    try {
      const res = await apiClient.get('/api/announcements/schedules')
      setSchedules(res.data.schedules || [])
    } catch { /* ignore */ }
    setLoadingSchedules(false)
  }, [])

  useEffect(() => {
    if (isAuthenticated) {
      fetchIntegration()
      fetchTemplates()
      fetchSchedules()
      // Always load email contacts and friends from DB (derive setup state from data)
      fetchEmailContacts()
      fetchFriendConnections()
      // Check email service configuration
      fetchEmailStatus()
      fetchSmtpConfig()
      fetchVerifiedEmails()
      // Fetch current user's email notification channel toggle
      apiClient.get('/api/notification-preferences').then(res => {
        const p = res.data.preferences
        if (p) {
          const channels: string[] = p.preferred_channels || []
          setNotifChannelEmail(channels.includes('Email'))
        } else {
          setNotifChannelEmail(false)
        }
      }).catch(() => setNotifChannelEmail(null))
    }
  }, [isAuthenticated, fetchIntegration, fetchTemplates, fetchSchedules]) // eslint-disable-line react-hooks/exhaustive-deps

  // Derive email integration setup state from DB data (verified emails or SMTP config)
  useEffect(() => {
    if (!emailIntegrationSetup && (verifiedEmails.length > 0 || smtpEmail)) {
      setEmailIntegrationSetup(true)
      try { localStorage.setItem('cm-ann-email-integration', 'true') } catch { /* ignore */ }
    }
  }, [verifiedEmails, smtpEmail, emailIntegrationSetup])

  // Check AI assistant availability
  useEffect(() => {
    if (!isAuthenticated) {
      setAiAvailable(false)
      return
    }
    const checkAi = async () => {
      try {
        const { data } = await apiClient.get('/api/ai-chat/status')
        setAiAvailable(data.available)
      } catch {
        setAiAvailable(false)
      }
    }
    checkAi()
  }, [isAuthenticated])

  // Build distribution rows from guilds whenever guilds change
  // Only show channels the user has activated in the Discord tab
  useEffect(() => {
    const rows: DistributionRow[] = []
    // On fresh mount (no existing rows), restore selections from sessionStorage
    let cachedChannelIds: Set<string> | null = null
    if (distributionRows.length === 0) {
      try {
        const saved = sessionStorage.getItem('cm-ann-selected-channels')
        if (saved) cachedChannelIds = new Set(JSON.parse(saved) as string[])
      } catch { /* ignore */ }
    }
    for (const guild of guilds) {
      for (const ch of guild.channels) {
        // Only show channels that are toggled active in the Discord integration tab
        if (!ch.is_active) continue
        // Preserve existing selection/status if row already exists
        const existing = distributionRows.find(r => r.channel_id === ch.channel_id)
        const _canSend = ch.bot_can_send && ch.user_can_send
        let statusMsg = 'Ready'
        if (!ch.bot_can_send && !ch.user_can_send) {
          statusMsg = 'No permission (bot & you)'
        } else if (!ch.bot_can_send) {
          statusMsg = 'Bot lacks permission'
        } else if (!ch.user_can_send) {
          statusMsg = 'You lack permission'
        }
        rows.push({
          integration: 'Discord',
          guild_name: guild.guild_name,
          channel_name: ch.channel_name,
          channel_id: ch.channel_id,
          bot_can_send: ch.bot_can_send,
          user_can_send: ch.user_can_send,
          selected: existing?.selected ?? (cachedChannelIds ? cachedChannelIds.has(ch.channel_id) : false),
          status: existing?.status ?? 'composing',
          status_msg: existing?.status_msg ?? statusMsg,
        })
      }
    }
    setDistributionRows(rows)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guilds])

  // Build DM rows from fetched members
  useEffect(() => {
    // On fresh mount (no existing rows), restore DM selections from sessionStorage
    let cachedDmUserIds: Set<string> | null = null
    if (dmRows.length === 0) {
      try {
        const saved = sessionStorage.getItem('cm-ann-selected-dms')
        if (saved) cachedDmUserIds = new Set(JSON.parse(saved) as string[])
      } catch { /* ignore */ }
    }
    const rows: DmDistributionRow[] = dmMembers.map(m => {
      const existing = dmRows.find(r => r.user_id === m.user_id)
      const isOptedOut = m.opted_out ?? false
      const subStatus = m.subscription_status ?? existing?.subscription_status ?? null
      const isBlocked = isOptedOut || m.opt_out_reason === 'private' || subStatus === 'opted_out' || subStatus === 'unsubscribed'
      const isSubscribed = subStatus === 'subscribed'
      // Support both old (guild_name) and new (guild_names) format
      const guildNames = m.guild_names || (m.guild_name ? [m.guild_name] : [])
      return {
        integration: 'Discord DM',
        user_id: m.user_id,
        username: m.username,
        display_name: m.display_name,
        avatar: m.avatar,
        guild_names: guildNames,
        roles: m.roles || [],
        opted_out: isOptedOut,
        private_dm: m.opt_out_reason === 'private',
        subscription_status: subStatus,
        selected: isBlocked ? false : isSubscribed ? true : (existing?.selected ?? (cachedDmUserIds ? cachedDmUserIds.has(m.user_id) : false)),
        status: existing?.status ?? 'composing',
        status_msg: (m.opt_out_reason === 'private' || subStatus === 'muted_bot') ? 'Blocked Bot / Private'
          : (isOptedOut && m.opt_out_reason !== 'private') ? 'Blocked You'
          : (subStatus === 'opted_out' || subStatus === 'unsubscribed') ? 'Unsubscribed (Calendar)'
          : subStatus === 'subscribed' ? 'Subscribed'
          : subStatus === 'invited' ? 'Did Not Respond'
          : (existing?.status_msg ?? 'Ready to receive message'),
      }
    })
    setDmRows(rows)
    // Reset role filter when members change
    setDmRoleFilter([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dmMembers])

  // Cleanup poll interval and DM loading on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      dmAbortRef.current?.abort()
    }
  }, [])

  // ─── Discord Actions ───────────────────────────────────────

  const generateKey = async () => {
    setGeneratingKey(true)
    try {
      const res = await apiClient.post('/api/discord/generate-key')
      setIntegration(res.data.integration)
    } catch (err) {
      console.error('Failed to generate key:', err)
    }
    setGeneratingKey(false)
  }

  const disconnectDiscord = async () => {
    if (!confirm('Disconnect your Discord account? All channel mappings will be lost.')) return
    try {
      await apiClient.delete('/api/discord/integration')
      setIntegration(null)
      setGuilds([])
    } catch (err) {
      console.error('Failed to disconnect:', err)
    }
  }

  const copyKey = async (key: string) => {
    await navigator.clipboard.writeText(key)
    setKeyCopied(true)
    setTimeout(() => setKeyCopied(false), 2000)
  }

  const [syncing, setSyncing] = useState(false)

  const refreshGuilds = async (sync = false) => {
    if (sync) setSyncing(true)
    try {
      if (sync) {
        try {
          await apiClient.post('/api/discord/refresh-guilds')
        } catch {
          // Sync failed but still fetch cached guilds below
        }
      }
      const res = await apiClient.get('/api/discord/guilds')
      setGuilds(res.data.guilds || [])
      if (sync) {
        const now = new Date().toISOString()
        setChannelsLastSynced(now)
        try { localStorage.setItem('cm-channels-last-synced', now) } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    setSyncing(false)
  }

  const removeGuild = async (guildId: string, guildName: string) => {
    if (!confirm(`Remove "${guildName}" from your server list? All its channel mappings will be deleted.`)) return
    try {
      await apiClient.delete(`/api/discord/guilds/${encodeURIComponent(guildId)}`)
      setGuilds(prev => prev.filter(g => g.guild_id !== guildId))
    } catch (err) {
      console.error('Failed to remove guild:', err)
    }
  }

  const toggleGuildCollapsed = (guildId: string) => {
    setCollapsedGuilds(prev => {
      const next = { ...prev, [guildId]: !(prev[guildId] ?? true) }
      try { localStorage.setItem('cm-collapsed-guilds', JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  const toggleChannelActive = async (channelId: string) => {
    // Optimistic update — toggle immediately in UI to prevent list reorder flash
    setGuilds(prev => prev.map(g => ({
      ...g,
      channels: g.channels.map(ch =>
        ch.channel_id === channelId ? { ...ch, is_active: !ch.is_active } : ch
      )
    })))
    try {
      await apiClient.post(`/api/discord/channels/${channelId}/toggle`)
    } catch (err) {
      // Revert on error
      setGuilds(prev => prev.map(g => ({
        ...g,
        channels: g.channels.map(ch =>
          ch.channel_id === channelId ? { ...ch, is_active: !ch.is_active } : ch
        )
      })))
      console.error('Failed to toggle channel:', err)
    }
  }

  // ── Email contacts loading ──
  const fetchEmailContacts = async () => {
    setLoadingEmailContacts(true)
    try {
      const res = await apiClient.get('/api/email-contacts')
      const contacts = res.data.contacts || []
      setEmailContacts(contacts)
      // Derive setup state: user has contacts in the DB
      if (contacts.length > 0) {
        setEmailIntegrationSetup(true)
        try { localStorage.setItem('cm-ann-email-integration', 'true') } catch { /* ignore */ }
      }
    } catch (err: unknown) {
      // If 404, no contacts yet - that's fine
      if ((err as { response?: { status?: number } })?.response?.status === 404) {
        setEmailContacts([])
      }
      console.error('Failed to load email contacts:', err)
    } finally {
      setLoadingEmailContacts(false)
    }
  }

  const addEmailContact = async () => {
    if (!addEmailAddress.trim()) return
    setAddingEmail(true)
    try {
      const tags = addEmailTags.trim()
        ? addEmailTags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
        : []
      const res = await apiClient.post('/api/email-contacts', {
        email: addEmailAddress.trim(),
        display_name: addEmailName.trim() || null,
        source: 'manual',
        tags,
      })
      if (res.data.contact) {
        setEmailContacts(prev => [...prev, res.data.contact])
      }
      setAddEmailAddress('')
      setAddEmailName('')
      setAddEmailTags('')
    } catch (err) {
      console.error('Failed to add email contact:', err)
    } finally {
      setAddingEmail(false)
    }
  }

  const bulkImportEmails = async () => {
    if (!bulkEmailInput.trim()) return
    setBulkImporting(true)
    setBulkImportResult(null)
    try {
      const tags = bulkTagsInput.trim()
        ? bulkTagsInput.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
        : []
      const res = await apiClient.post('/api/email-contacts/bulk', {
        emails: bulkEmailInput.trim(),
        names: bulkNamesInput.trim() || undefined,
        tags,
      })
      if (res.data.contacts?.length) {
        setEmailContacts(prev => {
          const existingIds = new Set(prev.map(c => c.id))
          const newContacts = res.data.contacts.filter((c: { id: string }) => !existingIds.has(c.id))
          return [...newContacts, ...prev]
        })
      }
      setBulkImportResult({ imported: res.data.imported ?? 0, skipped: res.data.skipped ?? 0 })
      setBulkEmailInput('')
      setBulkNamesInput('')
      setBulkTagsInput('')
    } catch (err) {
      console.error('Failed to bulk import email contacts:', err)
    } finally {
      setBulkImporting(false)
    }
  }

  const removeEmailContact = async (contactId: string) => {
    try {
      await apiClient.delete(`/api/email-contacts/${encodeURIComponent(contactId)}`)
      setEmailContacts(prev => prev.filter(c => c.id !== contactId))
    } catch (err) {
      console.error('Failed to remove email contact:', err)
    }
  }

  const startEditingContact = (contact: EmailContact) => {
    setEditingContactId(contact.id)
    setEditName(contact.display_name || '')
    setEditEmail(contact.email)
    setEditTags((contact.tags || []).join(', '))
  }

  const cancelEditingContact = () => {
    setEditingContactId(null)
    setEditName('')
    setEditEmail('')
    setEditTags('')
  }

  const saveEditingContact = async () => {
    if (!editingContactId || !editEmail.trim()) return
    setSavingEdit(true)
    try {
      const tags = editTags.trim()
        ? editTags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
        : []
      const res = await apiClient.patch(`/api/email-contacts/${encodeURIComponent(editingContactId)}`, {
        display_name: editName.trim() || null,
        email: editEmail.trim(),
        tags,
      })
      if (res.data.contact) {
        setEmailContacts(prev => prev.map(c => c.id === editingContactId ? res.data.contact : c))
      }
      cancelEditingContact()
    } catch (err) {
      console.error('Failed to update email contact:', err)
    } finally {
      setSavingEdit(false)
    }
  }

  const startEmailIntegration = () => {
    setEmailIntegrationSetup(true)
    try { localStorage.setItem('cm-ann-email-integration', 'true') } catch { /* ignore */ }
    fetchEmailContacts()
    fetchFriendConnections()
  }

  const fetchFriendConnections = async () => {
    setLoadingFriends(true)
    try {
      const res = await apiClient.get('/api/connections')
      setFriendConnections(
        (res.data.connections || [])
          .filter((c: { status?: string }) => c.status === 'connected')
          .map((c: { user_id: string; display_name?: string; email?: string }) => ({ user_id: c.user_id, display_name: c.display_name, email: c.email }))
      )
    } catch {
      // ignore - friendlist is optional
    } finally {
      setLoadingFriends(false)
    }
  }

  const disableEmailIntegration = () => {
    setEmailIntegrationSetup(false)
    try { localStorage.removeItem('cm-ann-email-integration') } catch { /* ignore */ }
    setEmailContacts([])
  }

  // ── Verified email addresses ──
  const fetchVerifiedEmails = useCallback(async () => {
    setLoadingVerifiedEmails(true)
    try {
      const res = await apiClient.get('/api/verified-emails')
      setVerifiedEmails(res.data.emails || [])
    } catch { /* silent */ } finally {
      setLoadingVerifiedEmails(false)
    }
  }, [])

  const handleSendVerificationCode = async () => {
    const email = verifyEmailInput.trim().toLowerCase()
    if (!email) return
    setVerifyStep('sending')
    setVerifyResult(null)
    try {
      await apiClient.post('/api/verified-emails/send-code', { email })
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
    if (!code || !verifyPendingEmail) return
    setVerifyStep('verifying')
    setVerifyResult(null)
    try {
      await apiClient.post('/api/verified-emails/verify-code', {
        email: verifyPendingEmail,
        code,
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
    setVerifyResult(null)
    try {
      const res = await apiClient.post('/api/verified-emails/google')
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
    try {
      await apiClient.put(`/api/verified-emails/${id}/primary`)
      fetchVerifiedEmails()
    } catch { /* silent */ }
  }

  const handleRemoveVerifiedEmail = async (id: string) => {
    try {
      await apiClient.delete(`/api/verified-emails/${id}`)
      fetchVerifiedEmails()
    } catch { /* silent */ }
  }

  // ── SMTP Config helpers ──
  const fetchEmailStatus = async () => {
    try {
      const res = await apiClient.get('/api/announcements/email-status')
      setEmailServiceStatus(res.data)
      // Pre-fill form if user has a saved config
      if (res.data.userConfig) {
        setSmtpEmail(res.data.userConfig.email || '')
      }
    } catch { /* ignore */ }
  }

  const fetchSmtpConfig = async () => {
    try {
      const res = await apiClient.get('/api/smtp-config')
      if (res.data.config) {
        setSmtpEmail(res.data.config.email_address || '')
        setSmtpHost(res.data.config.smtp_host || 'smtp.gmail.com')
        setSmtpPort(String(res.data.config.smtp_port || 587))
        setSmtpDisplayName(res.data.config.display_name || '')
        setSmtpPassword('') // never sent back
      }
    } catch { /* ignore */ }
  }

  const saveSmtpConfig = async () => {
    if (!smtpEmail.trim() || !smtpPassword.trim()) {
      setSmtpResult({ type: 'error', message: 'Email address and app password are required' })
      return
    }
    setSavingSmtp(true)
    setSmtpResult(null)
    try {
      await apiClient.put('/api/smtp-config', {
        emailAddress: smtpEmail.trim(),
        password: smtpPassword,
        smtpHost: smtpHost || 'smtp.gmail.com',
        smtpPort: smtpPort || '587',
        displayName: smtpDisplayName.trim() || undefined,
      })
      setSmtpResult({ type: 'success', message: 'Configuration saved. Click "Test Connection" to verify it works.' })
      fetchEmailStatus()
    } catch (err) {
      setSmtpResult({ type: 'error', message: (err as { response?: { data?: { error?: string } } }).response?.data?.error || (err as { message?: string }).message || 'Failed to save SMTP configuration' })
    } finally {
      setSavingSmtp(false)
    }
  }

  const testSmtpConnection = async () => {
    setTestingSmtp(true)
    setSmtpResult(null)
    try {
      const res = await apiClient.post('/api/smtp-config/test')
      if (res.data.success) {
        setSmtpResult({ type: 'success', message: 'Connection verified! A test email was sent to your inbox. You can now send email announcements.' })
        fetchEmailStatus()
      } else {
        setSmtpResult({ type: 'error', message: res.data.error || 'Connection test failed' })
      }
    } catch (err) {
      setSmtpResult({ type: 'error', message: (err as { response?: { data?: { error?: string } } }).response?.data?.error || (err as { message?: string }).message || 'Connection test failed' })
    } finally {
      setTestingSmtp(false)
    }
  }

  const deleteSmtpConfig = async () => {
    try {
      await apiClient.delete('/api/smtp-config')
      setSmtpEmail('')
      setSmtpPassword('')
      setSmtpHost('smtp.gmail.com')
      setSmtpPort('587')
      setSmtpDisplayName('')
      setSmtpResult(null)
      fetchEmailStatus()
    } catch { /* ignore */ }
  }

  const fetchDmMembers = async () => {
    setLoadingDmMembers(true)
    setDmProgress(null)
    setDmCancelled(false)
    setDmLoadPhase('phase1')
    setDmPhase2MemberCount(0)
    setDmScanInfo({ type: 'loading_members', message: 'Loading recent DM recipients...' })
    const abortController = new AbortController()
    dmAbortRef.current = abortController

    try {
      // ── Phase 1: Quick load from DB (self + recent recipients) ──
      const recentRes = await apiClient.get('/api/discord/dm-members/recent')
      const { self, recentRecipients } = recentRes.data as {
        self: DmMember | null
        recentRecipients: Array<DmMember & { message_count: number }>
      }

      if (abortController.signal.aborted) return

      // Build phase-1 member list
      const phase1Members: DmMember[] = []
      if (self) phase1Members.push(self)
      for (const r of recentRecipients) {
        phase1Members.push(r)
      }

      if (phase1Members.length > 0) {
        setDmMembers(phase1Members)
      }

      // ── Phase 2: Full SSE load from bot (async, runs in background) ──
      setDmLoadPhase('phase2')
      setDmScanInfo({ type: 'loading_members', message: 'Scanning shared servers for all DM-eligible members...' })

      const { data: sessionData } = await (await import('../lib/supabase')).supabase.auth.getSession()
      const token = sessionData.session?.access_token
      const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001'

      const response = await fetch(`${baseUrl}/api/discord/dm-members`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: abortController.signal,
      })

      if (!response.ok || !response.body) {
        throw new Error('Failed to fetch DM members')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // Parse SSE events from buffer
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'init') {
              setDmProgress({ checked: 0, total: event.totalMembers, found: 0, guildNames: event.guildNames || [] })
            } else if (event.type === 'progress') {
              setDmProgress(prev => prev ? { ...prev, checked: event.checked, found: event.found } : prev)
              setDmPhase2MemberCount(event.found)
            } else if (event.type === 'done') {
              setDmMembers(event.members || [])
              setDmProgress(prev => prev ? { ...prev, checked: event.checked, found: event.found } : prev)
              setDmPhase2MemberCount(event.found)
            } else if (event.type === 'error') {
              console.error('DM member stream error:', event.error)
            }
          } catch { /* skip malformed event */ }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        // User cancelled -- handled by cancelDmLoading
        return
      }
      console.error('Failed to fetch DM members:', err)
    }
    setLoadingDmMembers(false)
    setDmLoadPhase('done')
    dmAbortRef.current = null
  }

  /** Lightweight refresh: fetch subscription statuses for selected calendars and auto-select subscribed users */
  const refreshDmSubscriptionStatuses = async (calendarIds: string[]) => {
    setDmScanInfo({
      type: 'checking_subscriptions',
      message: 'Checking subscription statuses from delivery history...',
    })
    try {
      const params: Record<string, string> = {}
      if (calendarIds.length > 0) {
        params.calendarIds = calendarIds.join(',')
        params.calendarId = calendarIds[0]  // backward compat with pre-deploy API
      }
      const res = await apiClient.get('/api/discord/dm-subscription-statuses', { params })
      const statuses: Record<string, string> = res.data.statuses || {}
      const debug = res.data.debug || {}
      // Store for debug cross-reference
      ;(window as unknown as Record<string, unknown>)._lastDmStatuses = statuses

      // Log debug info for diagnostics
      console.log('[DM Subscriptions] Debug:', debug)
      console.log('[DM Subscriptions] Statuses returned:', Object.keys(statuses).length, 'entries')
      console.log('[DM Subscriptions] Sample status IDs (from delivery log target_id):', Object.keys(statuses).slice(0, 5))
      console.log('[DM Subscriptions] Sample DM row user_ids (from member list):', dmRows.slice(0, 5).map(r => r.user_id))

      // Identify unmatched rows — these stay as "Ready to receive message"
      if (Object.keys(statuses).length > 0 && dmRows.length > 0) {
        const matched = dmRows.filter(r => statuses[r.user_id]).length
        const unmatched = dmRows.filter(r => !statuses[r.user_id])
        console.log('[DM Subscriptions] Matched', matched, 'of', dmRows.length, 'DM rows to', Object.keys(statuses).length, 'status entries')
        if (unmatched.length > 0) {
          console.log('[DM Subscriptions] Unmatched user_ids (first 10):', unmatched.slice(0, 10).map(r => ({ user_id: r.user_id, display_name: r.display_name })))
        }
      }

      // Phase 1: Immediately auto-select subscribed users
      let _matchCount = 0
      setDmRows(prev => prev.map(r => {
        const subStatus = (statuses[r.user_id] as DmDistributionRow['subscription_status']) ?? null
        if (subStatus) _matchCount++
        const isBlocked = r.opted_out || r.private_dm || subStatus === 'opted_out' || subStatus === 'unsubscribed' || subStatus === 'muted_bot'
        const isSubscribed = subStatus === 'subscribed'
        // Auto-select subscribed users; block opted_out/unsubscribed; leave others as-is
        const selected = isBlocked ? false : isSubscribed ? true : r.selected
        return {
          ...r,
          subscription_status: subStatus,
          selected,
          status_msg: (r.private_dm || subStatus === 'muted_bot') ? 'Blocked Bot / Private'
            : (r.opted_out && !r.private_dm) ? 'Blocked You'
            : (subStatus === 'opted_out' || subStatus === 'unsubscribed') ? 'Unsubscribed (Calendar)'
            : subStatus === 'subscribed' ? 'Subscribed'
            : subStatus === 'invited' ? 'Did Not Respond'
            : (r.status === 'composing' ? 'Ready to receive message' : r.status_msg),
        }
      }))

      // Count statuses for display
      const statusCounts = debug.statusCounts || {}
      const parts: string[] = []
      if (statusCounts.subscribed) parts.push(`${statusCounts.subscribed} subscribed`)
      if (statusCounts.opted_out) parts.push(`${statusCounts.opted_out} blocked you`)
      if (statusCounts.unsubscribed) parts.push(`${statusCounts.unsubscribed} unsubscribed (calendar)`)
      if (statusCounts.invited) parts.push(`${statusCounts.invited} did not respond`)
      if (statusCounts.muted_bot) parts.push(`${statusCounts.muted_bot} blocked bot / private`)

      setDmScanInfo({
        type: 'idle',
        message: debug.uniqueRecipients > 0
          ? `Found ${debug.uniqueRecipients} recipients with status (${parts.join(', ') || 'no statuses'})`
          : 'No subscription data found in delivery history',
        debug,
      })
    } catch (err) {
      console.error('[DM Subscriptions] Error:', err)
      setDmScanInfo({ type: 'idle', message: 'Failed to check subscription statuses' })
    }
  }

  const cancelDmLoading = () => {
    dmAbortRef.current?.abort()
    dmAbortRef.current = null
    setLoadingDmMembers(false)
    setDmLoadPhase('idle')
    setDmPhase2MemberCount(0)
    setDmProgress(null)
    setDmMembers([])
    setDmRows([])
    setDmCancelled(true)
  }

  const fetchMeetings = useCallback(async () => {
    setLoadingMeetings(true)
    try {
      // Cache-bust with timestamp to ensure fresh data on refresh
      const res = await apiClient.get('/api/announcements/meetings', { params: { _t: Date.now() } })
      setMeetings(res.data.meetings || [])
      setCalendarParticipants(res.data.calendarParticipants || {})
      setCalendarParticipantEmails(res.data.calendarParticipantEmails || [])
      setAllCalendars(res.data.calendars || [])
    } catch { /* ignore */ }
    setLoadingMeetings(false)
  }, [])

  // Fetch meetings when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      fetchMeetings()
    }
  }, [isAuthenticated, fetchMeetings])

  // Quietly pre-load DM members after page load so template selections can be restored
  useEffect(() => {
    if (!isAuthenticated || !integration?.bot_verified) return
    // Delay to let primary data (guilds, templates, meetings) load first
    const timer = setTimeout(() => {
      if (dmMembers.length === 0) fetchDmMembers()
    }, 3000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, integration?.bot_verified])

  // Build a meeting context block for a single meeting
  const buildMeetingBlock = (meeting: MeetingOption): string => {
    // Prefer time_slots (raw grid coordinates, always correct) over start_time
    // which may have been saved with a timezone offset bug
    const startDate = meeting.time_slots?.[0]
      ? new Date(meeting.time_slots[0] + ':00Z')
      : new Date(meeting.start_time)
    const endDate = new Date(startDate.getTime() + meeting.duration_minutes * 60 * 1000)
    const startStr = formatDateTimeDDMMYYYY(startDate)
    const tz = getPrimaryTimezone()
    const endTimeStr = formatDateTimeDDMMYYYYInTimezone(endDate, tz).split(' ').slice(-2).join(' ')

    const meetingName = resolveMeetingTitle({ title: meeting.title, calendarTitle: meeting.calendar_title })
    const descText = meeting.description?.replace(/[*`]/g, '') || null

    let block = ''
    if (meetingContextFields.title) block += `\n🎯 **${meetingName}**`
    if (meetingContextFields.description && descText && descText !== meetingName) block += `\n📝 ${descText}`
    if (meetingContextFields.dateTime) block += `\n🕐 ${startStr} \u2013 ${endTimeStr} (${meeting.duration_minutes} min)`
    if (meetingContextFields.meetingLink && meeting.meeting_link) block += `\n🔗 ${meeting.meeting_link}`
    if (meetingContextFields.addToCalendar) {
      const siteBase = window.location.origin
      block += `\n📅 [Add to calendar](${siteBase}/meeting/${meeting.id})`
    }
    return block
  }

  // Group meetings that share the same title + link + calendar into one block with multiple time lines
  const buildGroupedMeetingBlocks = (selectedMeetings: MeetingOption[]): string[] => {
    const groups = new Map<string, MeetingOption[]>()
    for (const m of selectedMeetings) {
      const key = `${m.calendar_title}|${m.title}|${m.meeting_link ?? ''}|${m.calendar_id}`
      const group = groups.get(key)
      if (group) group.push(m)
      else groups.set(key, [m])
    }

    return Array.from(groups.values()).map(group => {
      if (group.length === 1) return buildMeetingBlock(group[0])

      const first = group[0]
      const meetingName = resolveMeetingTitle({ title: first.title, calendarTitle: first.calendar_title })
      const descText = first.description?.replace(/[*`]/g, '') || null

      let block = ''
      if (meetingContextFields.title) block += `\n🎯 **${meetingName}**`
      if (meetingContextFields.description && descText && descText !== meetingName) block += `\n📝 ${descText}`

      if (meetingContextFields.dateTime) {
        const sorted = [...group].sort((a, b) => {
          const aStart = a.time_slots?.[0] ? a.time_slots[0] : a.start_time
          const bStart = b.time_slots?.[0] ? b.time_slots[0] : b.start_time
          return aStart.localeCompare(bStart)
        })
        for (const m of sorted) {
          const startDate = m.time_slots?.[0]
            ? new Date(m.time_slots[0] + ':00Z')
            : new Date(m.start_time)
          const endDate = new Date(startDate.getTime() + m.duration_minutes * 60 * 1000)
          const startStr = formatDateTimeDDMMYYYY(startDate)
          const endTimeStr = formatDateTimeDDMMYYYYInTimezone(endDate, getPrimaryTimezone()).split(' ').slice(-2).join(' ')
          block += `\n🕐 ${startStr} \u2013 ${endTimeStr} (${m.duration_minutes} min)`
        }
      }

      if (meetingContextFields.meetingLink && first.meeting_link) block += `\n🔗 ${first.meeting_link}`
      if (meetingContextFields.addToCalendar) {
        const siteBase = window.location.origin
        block += `\n📅 [Add to calendar](${siteBase}/meeting/${first.id})`
      }
      return block
    })
  }

  // Build the combined body: user text + all attached meeting blocks
  const buildFullBody = (): string => {
    const parts: string[] = [composeBody]

    // Append meeting blocks for selected meetings
    if (selectedMeetingIds.size > 0) {
      const selected = meetings.filter(m => selectedMeetingIds.has(m.id))
      const blocks = buildGroupedMeetingBlocks(selected)
      parts.push(blocks.join('\n'))
    }

    // Append calendar context for selected calendars without selected meetings
    // (meetingless calendars OR calendars-with-meetings where only the calendar is selected)
    const calIdsWithSelectedMeetings = new Set(
      meetings.filter(m => selectedMeetingIds.has(m.id)).map(m => m.calendar_id)
    )
    const calendarOnlySelected = Array.from(selectedCalendarIds)
      .filter(id => !calIdsWithSelectedMeetings.has(id))
    if (calendarOnlySelected.length > 0) {
      for (const calId of calendarOnlySelected) {
        const cal = allCalendars.find(c => c.id === calId)
        if (!cal) continue
        let block = `\n📋 **${cal.title}** (Coordination Calendar)`
        if (meetingContextFields.onboardingLink) {
          const availabilityUrl = cal.onboardingUrl || `${window.location.origin}/join/${cal.hash}`
          block += `\n🔗 [Add Availability](${availabilityUrl})`
        }
        parts.push(block)
      }
    }

    return parts.filter(p => p.trim()).join('\n')
  }

  // Build the body for a single meeting (used when fan-out reminder schedules
  // are created per (meeting x offset)). Each scheduled message references
  // only its own meeting block, not the full set.
  const buildFullBodyForMeeting = (meetingId: string): string => {
    const parts: string[] = [composeBody]
    const m = meetings.find(mm => mm.id === meetingId)
    if (m) {
      const blocks = buildGroupedMeetingBlocks([m])
      parts.push(blocks.join('\n'))
    }
    // Preserve calendar-only context (calendars selected without their meetings)
    const calIdsWithThisMeeting = new Set(m ? [m.calendar_id] : [])
    const calendarOnlySelected = Array.from(selectedCalendarIds)
      .filter(id => !calIdsWithThisMeeting.has(id))
    for (const calId of calendarOnlySelected) {
      const cal = allCalendars.find(c => c.id === calId)
      if (!cal) continue
      let block = `\n📋 **${cal.title}** (Coordination Calendar)`
      if (meetingContextFields.onboardingLink) {
        const availabilityUrl = cal.onboardingUrl || `${window.location.origin}/join/${cal.hash}`
        block += `\n🔗 [Add Availability](${availabilityUrl})`
      }
      parts.push(block)
    }
    return parts.filter(p => p.trim()).join('\n')
  }

  // Reminder offset helpers
  const offsetToMs = (o: ReminderOffset): number => {
    const v = Math.max(0, Math.floor(o.value))
    switch (o.unit) {
      case 'min': return v * 60_000
      case 'hour': return v * 3_600_000
      case 'day': return v * 86_400_000
      case 'week': return v * 604_800_000
    }
  }
  const formatOffsetLabel = (o: ReminderOffset): string => {
    if (o.value === 0) return 'At meeting start'
    const u = o.unit === 'min' ? 'minute' : o.unit === 'hour' ? 'hour' : o.unit === 'day' ? 'day' : 'week'
    return `${o.value} ${u}${o.value !== 1 ? 's' : ''} before`
  }
  const getMeetingStartMs = (m: MeetingOption): number => {
    return m.time_slots?.[0]
      ? new Date(m.time_slots[0] + ':00Z').getTime()
      : new Date(m.start_time).getTime()
  }
  // Conservative throughput estimate per target type (ms each).
  // Discord channel sends are gated by per-channel + global rate limits;
  // DMs by per-user limits and the bot's outbound queue; email by SMTP.
  const estimateBatchDurationSec = (channelCount: number, dmCount: number, emailCount: number): number => {
    const channelMs = channelCount * 600
    const dmMs = dmCount * 1500
    const emailMs = emailCount * 500
    return Math.max(1, Math.ceil((channelMs + dmMs + emailMs) / 1000))
  }
  const formatDurationShort = (sec: number): string => {
    if (sec < 60) return `~${sec}s`
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return s > 0 ? `~${m}m ${s}s` : `~${m}m`
  }

  // Toggle meeting context
  const toggleMeetingContext = (meetingId: string, checked: boolean) => {
    setSelectedMeetingIds(prev => {
      const s = new Set(prev)
      if (checked) s.add(meetingId); else s.delete(meetingId)
      return s
    })
  }

  // Toggle calendar with meetings: 3-state cycle
  // 1) Nothing selected → select calendar + all meetings
  // 2) Calendar + meetings selected → deselect meetings, keep calendar
  // 3) Calendar only (no meetings) → deselect calendar
  const toggleCalendarMeetings = (calendarId: string) => {
    const calMeetings = meetings.filter(m => m.calendar_id === calendarId)
    const _allMeetingsSelected = calMeetings.length > 0 && calMeetings.every(m => selectedMeetingIds.has(m.id))
    const someMeetingsSelected = calMeetings.some(m => selectedMeetingIds.has(m.id))
    const calendarSelected = selectedCalendarIds.has(calendarId)

    if (calendarSelected && !someMeetingsSelected) {
      // State 3: calendar only → remove calendar entirely
      setSelectedCalendarIds(prev => {
        const s = new Set(prev)
        s.delete(calendarId)
        return s
      })
    } else if (calendarSelected && someMeetingsSelected) {
      // State 2: calendar + some/all meetings → remove meetings, keep calendar
      setSelectedMeetingIds(prev => {
        const s = new Set(prev)
        calMeetings.forEach(m => s.delete(m.id))
        return s
      })
    } else {
      // State 1: nothing selected → select calendar + all meetings
      setSelectedCalendarIds(prev => {
        const s = new Set(prev)
        s.add(calendarId)
        return s
      })
      setSelectedMeetingIds(prev => {
        const s = new Set(prev)
        calMeetings.forEach(m => s.add(m.id))
        return s
      })
    }
  }

  // Toggle a meetingless calendar selection
  const toggleCalendarSelection = (calendarId: string, checked: boolean) => {
    setSelectedCalendarIds(prev => {
      const s = new Set(prev)
      if (checked) s.add(calendarId); else s.delete(calendarId)
      return s
    })
  }

  // ─── Distribution Row Actions ───────────────────────────────

  const toggleRowSelected = (channelId: string) => {
    setDistributionRows(prev => prev.map(r =>
      r.channel_id === channelId ? { ...r, selected: !r.selected } : r
    ))
  }

  const toggleDmRowSelected = (userId: string) => {
    setDmRows(prev => prev.map(r =>
      r.user_id === userId ? { ...r, selected: !r.selected } : r
    ))
  }

  // Discord DM rate limit constants
  // Discord's anti-spam system may flag bots sending too many unique DMs.
  // The bot uses graduated delays (150-600ms) + periodic cool-down pauses to avoid triggering Discord.
  const DM_RATE_LIMIT_WARN = 200  // Soft warning: may trigger slower delivery
  const DM_RATE_LIMIT_DANGER = 500 // Hard warning: likely rate-limited by Discord
  const DM_RATE_LIMIT_MAX = isAdmin ? 4000 : 1000   // Admin: 4000, normal: 1000

  // Estimate delivery time based on bot's actual DM-sending algorithm.
  // Models: graduated inter-DM delays, cool-down pauses (which replace normal delays),
  // per-DM API overhead (5-8 Supabase queries + 2-5 Discord API calls per DM),
  // first-contact intro messages, and intermittent 429 rate-limit backoffs.
  //
  // Calibrated against observed throughput: 1789 DMs took ~2 hours at the >500 tier.
  const estimateDmMinutes = (count: number) => {
    if (count <= 0) return 0
    // Per-DM delay (ms): matches bot's getDmDelayMs()
    const delayMs = count > 500 ? 600 : count > 200 ? 400 : count > 50 ? 250 : 150
    // Cool-down config: matches bot's getCooldownConfig()
    // Cooldowns REPLACE the normal delay (if/else in bot loop), not added on top
    let cooldownEvery = 0
    let cooldownPauseMs = 0
    if (count > 500) { cooldownEvery = 30; cooldownPauseMs = 10_000 }
    else if (count > 200) { cooldownEvery = 40; cooldownPauseMs = 5_000 }
    else if (count > 50) { cooldownEvery = 50; cooldownPauseMs = 3_000 }
    // Delay points: no delay after the last DM
    const delays = Math.max(0, count - 1)
    const numCooldowns = cooldownEvery > 0 ? Math.floor(delays / cooldownEvery) : 0
    const numNormalDelays = delays - numCooldowns
    // Base time: configured inter-DM delays + cooldown pauses
    let totalMs = numNormalDelays * delayMs + numCooldowns * cooldownPauseMs
    // Per-DM API overhead: each DM involves sequential network calls:
    //   Supabase: opt-out check, calendar invite check, discord_integrations lookup,
    //   first_contacts check/insert, delivery log insert (5-8 queries x ~150ms each)
    //   Discord: users.fetch, createDM, send intro (first contact), send message,
    //   suppressEmbeds/react (2-5 calls x ~300ms each)
    // Measured ~2.2s average per DM including all API round-trips.
    totalMs += count * 2_200
    // Rate-limit backoff budget: Discord 429s trigger exponential backoff (1s-30s).
    // For large batches, ~5% of DMs hit rate limits with avg 8s backoff + retry.
    if (count > 50) totalMs += Math.ceil(count * 0.05) * 8_000
    // Additional buffer for network variance and retry overhead
    totalMs = Math.round(totalMs * 1.15)
    return Math.ceil(totalMs / 60_000)
  }

  // Filter DM rows by search query, role filter, server filter, status filter, and selected-only filter
  // Shared helpers for context-aware filter counts (faceted filtering).
  // Each helper applies all active filters EXCEPT its own dimension, so each
  // dimension's tag counts reflect what the user has selected in all other dimensions.

  const dmEffectiveStatus = (row: DmDistributionRow) =>
    row.subscription_status === 'subscribed' ? 'opted_in'
    : (row.private_dm || row.opted_out || row.subscription_status === 'muted_bot' ||
       row.subscription_status === 'unsubscribed' || row.subscription_status === 'opted_out' ||
       row.subscription_status === 'invited') ? 'opted_out'
    : row.status

  const dmEffectiveDetails = (row: DmDistributionRow) =>
    (row.private_dm || row.subscription_status === 'muted_bot') ? 'blocked_bot'
    : (row.opted_out && !row.private_dm) ? 'blocked_you'
    : (row.subscription_status === 'opted_out' || row.subscription_status === 'unsubscribed') ? 'opted_out_calendar'
    : row.subscription_status === 'subscribed' ? 'subscribed'
    : row.subscription_status === 'invited' ? 'did_not_respond'
    : 'ready'

  const applyNonServerFilters = (row: DmDistributionRow) => {
    if (dmSelectedOnly && !row.selected) return false
    if (dmRoleFilter.length > 0 && !row.roles.some(r => dmRoleFilter.includes(r.id))) return false
    if (dmStatusFilter.length > 0 && !dmStatusFilter.includes(dmEffectiveStatus(row))) return false
    if (dmAdvancedFilters && dmDetailsFilter.length > 0 && !dmDetailsFilter.includes(dmEffectiveDetails(row))) return false
    if (dmAdvancedFilters && dmUserFilter.trim()) {
      const uq = dmUserFilter.toLowerCase()
      if (!row.display_name.toLowerCase().includes(uq) && !row.username.toLowerCase().includes(uq)) return false
    }
    if (!dmAdvancedFilters && dmSearchQuery.trim()) {
      const q = dmSearchQuery.toLowerCase()
      if (!(
        row.display_name.toLowerCase().includes(q) ||
        row.username.toLowerCase().includes(q) ||
        row.guild_names.some(g => g.toLowerCase().includes(q)) ||
        row.roles.some(r => r.name.toLowerCase().includes(q))
      )) return false
    }
    return true
  }

  // For STATUS/DETAILS counts: apply server + role + search (not status/details)
  const getBaseFilteredDmRows = (rows: DmDistributionRow[]) => rows.filter(row => {
    if (dmSelectedOnly && !row.selected) return false
    if (dmRoleFilter.length > 0 && !row.roles.some(r => dmRoleFilter.includes(r.id))) return false
    if (dmServerFilter.length > 0 && !row.guild_names.some(g => dmServerFilter.includes(g))) return false
    if (dmAdvancedFilters && dmUserFilter.trim()) {
      const uq = dmUserFilter.toLowerCase()
      if (!row.display_name.toLowerCase().includes(uq) && !row.username.toLowerCase().includes(uq)) return false
    }
    if (!dmAdvancedFilters && dmSearchQuery.trim()) {
      const q = dmSearchQuery.toLowerCase()
      if (!(
        row.display_name.toLowerCase().includes(q) ||
        row.username.toLowerCase().includes(q) ||
        row.guild_names.some(g => g.toLowerCase().includes(q)) ||
        row.roles.some(r => r.name.toLowerCase().includes(q))
      )) return false
    }
    return true
  })

  const getFilteredDmRows = (rows: DmDistributionRow[]) => {
    const filtered = rows.filter(row => {
      if (dmSelectedOnly && !row.selected) return false
      if (dmRoleFilter.length > 0 && !row.roles.some(r => dmRoleFilter.includes(r.id))) return false
      // Advanced: server filter
      if (dmServerFilter.length > 0 && !row.guild_names.some(g => dmServerFilter.includes(g))) return false
      // Advanced: status filter
      if (dmStatusFilter.length > 0) {
        if (!dmStatusFilter.includes(dmEffectiveStatus(row))) return false
      }
      // Advanced: user name filter (separate from search)
      if (dmAdvancedFilters && dmUserFilter.trim()) {
        const uq = dmUserFilter.toLowerCase()
        if (!row.display_name.toLowerCase().includes(uq) && !row.username.toLowerCase().includes(uq)) return false
      }
      // Advanced: details filter (tag-based)
      if (dmAdvancedFilters && dmDetailsFilter.length > 0) {
        if (!dmDetailsFilter.includes(dmEffectiveDetails(row))) return false
      }
      // Compact mode: unified search
      if (!dmAdvancedFilters && dmSearchQuery.trim()) {
        const q = dmSearchQuery.toLowerCase()
        if (!(
          row.display_name.toLowerCase().includes(q) ||
          row.username.toLowerCase().includes(q) ||
          row.guild_names.some(g => g.toLowerCase().includes(q)) ||
          row.roles.some(r => r.name.toLowerCase().includes(q))
        )) return false
      }
      return true
    })

    // Sort: subscribed first, then new/invited (selectable), then blocked at bottom
    const SUB_ORDER: Record<string, number> = { subscribed: 0, invited: 2, unsubscribed: 3, opted_out: 4, muted_bot: 5 }
    return filtered.sort((a, b) => {
      // Blocked users always last
      const aBlocked = a.opted_out || a.private_dm
      const bBlocked = b.opted_out || b.private_dm
      if (aBlocked !== bBlocked) return aBlocked ? 1 : -1
      // Sort by subscription status priority
      const aOrder = a.subscription_status ? (SUB_ORDER[a.subscription_status] ?? 1) : 1
      const bOrder = b.subscription_status ? (SUB_ORDER[b.subscription_status] ?? 1) : 1
      if (aOrder !== bOrder) return aOrder - bOrder
      // Then alphabetically by display name
      return a.display_name.localeCompare(b.display_name)
    })
  }

  const DM_PAGE_SIZE = 50

  const selectAllFiltered = () => {
    const filteredIds = new Set(getFilteredDmRows(dmRows).filter(r =>
      !r.opted_out && !r.private_dm && r.subscription_status !== 'opted_out' && r.subscription_status !== 'unsubscribed' && r.subscription_status !== 'muted_bot'
    ).map(r => r.user_id))
    setDmRows(prev => prev.map(r => filteredIds.has(r.user_id) ? { ...r, selected: true } : r))
  }

  const deselectAllFiltered = () => {
    const filteredIds = new Set(getFilteredDmRows(dmRows).map(r => r.user_id))
    setDmRows(prev => prev.map(r => filteredIds.has(r.user_id) ? { ...r, selected: false } : r))
  }

  // Reset DM page when filters change
  useEffect(() => { setDmPage(1) }, [dmSearchQuery, dmRoleFilter, dmSelectedOnly, dmServerFilter, dmStatusFilter, dmUserFilter, dmDetailsFilter, dmAdvancedFilters])

  // Auto-disable "Show All Selected" only when a deselection causes the list to become empty
  const prevDmSelectedCount = useRef(dmRows.filter(r => r.selected && !r.opted_out).length)
  useEffect(() => {
    const count = dmRows.filter(r => r.selected && !r.opted_out).length
    const wasDeselection = count < prevDmSelectedCount.current
    prevDmSelectedCount.current = count
    if (dmSelectedOnly && wasDeselection && count === 0) {
      setDmSelectedOnly(false)
    }
  }, [dmRows, dmSelectedOnly])

  // Close emoji picker on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setEmojiPickerIdx(null)
      }
    }
    if (emojiPickerIdx !== null) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [emojiPickerIdx])

  // Reset distribution row statuses back to composing when the user edits the form
  // (so it's clear this is a new/modified message not yet sent)
  const resetRowStatuses = useCallback(() => {
    setDistributionRows(prev => {
      // Only reset if any row is NOT in composing state (avoid unnecessary re-renders)
      if (prev.every(r => r.status === 'composing')) return prev
      return prev.map(r => ({
        ...r,
        status: 'composing' as const,
        status_msg: (r.bot_can_send && r.user_can_send) ? 'Ready' : !r.bot_can_send && !r.user_can_send ? 'No permission (bot & you)' : !r.bot_can_send ? 'Bot lacks permission' : 'You lack permission',
      }))
    })
    setDmRows(prev => {
      if (prev.every(r => r.status === 'composing')) return prev
      return prev.map(r => ({
        ...r,
        status: 'composing' as const,
        status_msg: 'Ready',
      }))
    })
    setSendResult(null)
  }, [])

  // When compose fields change, reset statuses
  useEffect(() => { resetRowStatuses() }, [composeTitle, composeBody, composeDmBody, pollEnabled, pollOptions, resetRowStatuses])

  // When target selections change, clear the status message so user knows the form has changed
  const selectionFingerprint = [
    distributionRows.filter(r => r.selected).map(r => r.channel_id).join(),
    dmRows.filter(r => r.selected).map(r => r.user_id).join(),
    [...selectedEmailRecipients].sort().join(),
    [...selectedMeetingIds].sort().join(),
  ].join('|')
  const selectionFingerprintRef = useRef(selectionFingerprint)
  useEffect(() => {
    if (selectionFingerprintRef.current !== selectionFingerprint) {
      selectionFingerprintRef.current = selectionFingerprint
      setSendResult(null)
    }
  }, [selectionFingerprint])

  // Persist compose draft to sessionStorage (session-only — clears on tab close)
  // Only user-authored content is cached — no auth tokens, IDs or sensitive data.
  useEffect(() => { try { sessionStorage.setItem('cm-ann-title', composeTitle) } catch { /* ignore */ } }, [composeTitle])
  useEffect(() => { try { sessionStorage.setItem('cm-ann-body', composeBody) } catch { /* ignore */ } }, [composeBody])
  useEffect(() => { try { sessionStorage.setItem('cm-ann-dm-body', composeDmBody) } catch { /* ignore */ } }, [composeDmBody])
  useEffect(() => { try { sessionStorage.setItem('cm-ann-ai-context', aiContext) } catch { /* ignore */ } }, [aiContext])
  useEffect(() => { try { sessionStorage.setItem('cm-ann-poll-enabled', String(pollEnabled)) } catch { /* ignore */ } }, [pollEnabled])
  useEffect(() => { try { sessionStorage.setItem('cm-ann-poll-options', JSON.stringify(pollOptions)) } catch { /* ignore */ } }, [pollOptions])
  useEffect(() => { try { sessionStorage.setItem('cm-ann-send-mode', sendMode) } catch { /* ignore */ } }, [sendMode])
  useEffect(() => { try { sessionStorage.setItem('cm-ann-reminder-offsets', JSON.stringify(reminderOffsets)) } catch { /* ignore */ } }, [reminderOffsets])
  useEffect(() => { try { sessionStorage.setItem('cm-ann-suppress-embeds', String(suppressEmbeds)) } catch { /* ignore */ } }, [suppressEmbeds])
  useEffect(() => { try { sessionStorage.setItem('cm-ann-selected-meetings', JSON.stringify(Array.from(selectedMeetingIds))) } catch { /* ignore */ } }, [selectedMeetingIds])
  useEffect(() => { try { sessionStorage.setItem('cm-ann-selected-calendars', JSON.stringify(Array.from(selectedCalendarIds))) } catch { /* ignore */ } }, [selectedCalendarIds])
  // Compute the effective calendar IDs to scope subscription lookups by.
  // Includes calendars explicitly selected AND calendars implied by selected meetings.
  // Without this union, selecting only meetings (not the calendar checkbox) would send
  // an empty calendarIds list and the API would return no per-calendar subscribers.
  const effectiveCalendarIds = useMemo(() => {
    const ids = new Set<string>(selectedCalendarIds)
    for (const m of meetings) {
      if (selectedMeetingIds.has(m.id) && m.calendar_id) ids.add(m.calendar_id)
    }
    return Array.from(ids)
  }, [selectedCalendarIds, selectedMeetingIds, meetings])

  // Refresh DM subscription statuses when the effective calendar set changes.
  // Subscriptions are per-calendar -- only query when at least one calendar is in scope.
  useEffect(() => {
    if (dmRows.length === 0) return
    refreshDmSubscriptionStatuses(effectiveCalendarIds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveCalendarIds.join('|')])

  // Re-apply subscription statuses after DM members finish loading (refresh or initial load).
  useEffect(() => {
    if (dmLoadPhase !== 'done') return
    // Small delay to let dmRows build from dmMembers first
    const timer = setTimeout(() => {
      refreshDmSubscriptionStatuses(effectiveCalendarIds)
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dmLoadPhase])
  useEffect(() => { try { sessionStorage.setItem('cm-ann-meeting-context-fields', JSON.stringify(meetingContextFields)) } catch { /* ignore */ } }, [meetingContextFields])
  useEffect(() => { if (distributionRows.length > 0) { try { sessionStorage.setItem('cm-ann-selected-channels', JSON.stringify(distributionRows.filter(r => r.selected).map(r => r.channel_id))) } catch { /* ignore */ } } }, [distributionRows])
  useEffect(() => { if (dmRows.length > 0) { try { sessionStorage.setItem('cm-ann-selected-dms', JSON.stringify(dmRows.filter(r => r.selected).map(r => r.user_id))) } catch { /* ignore */ } } }, [dmRows])

  // ─── AI Compose Assistant ─────────────────────────────────

  // Core AI compose logic — accepts a message string directly.
  // Used by both the inline compose input and the global AI side panel.
  const doAiCompose = useCallback(async (
    message: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<{ message: string; action?: string; systemPrompt?: string }> => {
    const trimmed = message.trim()
    if (!trimmed) return { message: 'Please enter a message.' }

    // eslint-disable-next-line no-useless-catch -- explicit error boundary retained; the body is large and the rethrow keeps error handling at the ref-based caller that renders the toast
    try {
      const preferredModel = user?.themePreferences?.aiSettings?.preferredModel || 'openai'

      // Build current state for the AI
      const currentState: Record<string, unknown> = {
        title: composeTitle,
        body: composeBody,
        aiContext,
        pollEnabled,
        pollOptions,
      }

      // Include available channels with selection state
      if (distributionRows.length > 0) {
        currentState.channels = distributionRows.map(r => ({
          channel_id: r.channel_id,
          guild_name: r.guild_name,
          channel_name: r.channel_name,
          selected: r.selected,
          bot_can_send: r.bot_can_send,
          user_can_send: r.user_can_send,
        }))
      }

      // Include DM members with selection state
      if (dmRows.length > 0) {
        currentState.dmMembers = dmRows.map(r => ({
          user_id: r.user_id,
          username: r.username,
          display_name: r.display_name,
          guild_names: r.guild_names,
          selected: r.selected,
          opted_out: r.opted_out,
        }))
      }

      // Include selected meetings
      if (selectedMeetingIds.size > 0) {
        currentState.selectedMeetings = meetings
          .filter(m => selectedMeetingIds.has(m.id))
          .map(m => ({ id: m.id, title: m.calendar_title || m.title, date: m.start_time }))
      }

      // Include ALL available meetings so AI can search/select by name
      if (meetings.length > 0) {
        currentState.availableMeetings = meetings.map(m => ({
          id: m.id,
          calendar_id: m.calendar_id,
          calendar_title: m.calendar_title,
          title: m.title,
          date: m.start_time,
          selected: selectedMeetingIds.has(m.id),
        }))
      }

      // Include ALL available calendars so AI can search/select by name
      if (allCalendars.length > 0) {
        currentState.availableCalendars = allCalendars.map(c => ({
          id: c.id,
          title: c.title,
          selected: selectedCalendarIds.has(c.id),
        }))
      }

      // Include selected calendars without selected meetings (calendar-only selections)
      if (selectedCalendarIds.size > 0) {
        const calIdsWithSelectedMeetings = new Set(
          meetings.filter(m => selectedMeetingIds.has(m.id)).map(m => m.calendar_id)
        )
        const calendarOnlySelected = Array.from(selectedCalendarIds)
          .filter(id => !calIdsWithSelectedMeetings.has(id))
          .map(id => {
            const cal = allCalendars.find(c => c.id === id)
            return cal ? { id: cal.id, title: cal.title, participants: calendarParticipants[cal.id] || [] } : null
          })
          .filter(Boolean)
        if (calendarOnlySelected.length > 0) {
          currentState.selectedCalendars = calendarOnlySelected
        }
      }

      const { data } = await apiClient.post('/api/ai-chat/announcement', {
        message: trimmed,
        history,
        currentState,
        preferredModel,
      })

      const changes = data.changes || {}
      const appliedFields: string[] = []

      // Surface backend safety-net suppressions (e.g. body change held back because
      // it would have dropped existing links, or user asked to "suggest" only).
      const guardrails = data.guardrails as { suppressedFields?: string[]; notes?: string[] } | undefined
      if (guardrails?.suppressedFields && guardrails.suppressedFields.length > 0) {
        const fields = guardrails.suppressedFields.join(' & ')
        showToast(`AI ${fields} change held back to protect your existing content. See proposal in the chat.`, 'info')
      }

      // Apply changes to form fields
      if ('title' in changes) {
        setComposeTitle(changes.title)
        appliedFields.push('title')
      }
      if ('body' in changes) {
        setComposeBody(changes.body)
        appliedFields.push('body')
      }
      if ('aiContext' in changes && typeof changes.aiContext === 'string' && changes.aiContext.trim().length > 0) {
        // Guard against AI returning filler strings like "Preserve existing context."
        const lc = changes.aiContext.trim().toLowerCase()
        const isPlaceholder = lc === 'preserve existing context.' || lc === 'preserve existing context' || lc === 'no changes' || lc === 'unchanged'
        if (!isPlaceholder) {
          setAiContext(changes.aiContext)
        }
      }
      if ('pollEnabled' in changes) {
        setPollEnabled(changes.pollEnabled)
        appliedFields.push('poll')
      }
      if ('pollOptions' in changes && Array.isArray(changes.pollOptions)) {
        setPollOptions(changes.pollOptions)
        if (!appliedFields.includes('poll')) appliedFields.push('poll options')
      }
      if ('selectedChannels' in changes && Array.isArray(changes.selectedChannels) && changes.selectedChannels.length > 0) {
        const requestedIds = changes.selectedChannels as string[]
        const validIds = new Set(distributionRows.map(r => r.channel_id))
        const validSelected = new Set(requestedIds.filter(id => validIds.has(id)))
        if (validSelected.size > 0) {
          setDistributionRows(prev => prev.map(r => ({ ...r, selected: validSelected.has(r.channel_id) })))
          appliedFields.push('channels')
        } else {
          showToast('AI suggested channels that are not available in your current Distribution Targets list. Channel selection was not changed.', 'info')
        }
      }
      if ('selectedDmUserIds' in changes && Array.isArray(changes.selectedDmUserIds) && changes.selectedDmUserIds.length > 0) {
        const requestedIds = changes.selectedDmUserIds as string[]
        const validIds = new Set(dmRows.map(r => r.user_id))
        const validSelected = new Set(requestedIds.filter(id => validIds.has(id)))
        if (validSelected.size > 0) {
          setDmRows(prev => prev.map(r => ({ ...r, selected: r.opted_out ? false : validSelected.has(r.user_id) })))
          appliedFields.push('DM recipients')
        } else {
          showToast('AI suggested DM recipients that are not available in your current member list. DM selection was not changed.', 'info')
        }
      }
      if ('selectedMeetingIds' in changes && Array.isArray(changes.selectedMeetingIds) && changes.selectedMeetingIds.length > 0) {
        const meetingIdSet = new Set(changes.selectedMeetingIds as string[])
        // Validate against actual available meetings
        const validIds = new Set(meetings.map(m => m.id))
        const validSelected = new Set([...meetingIdSet].filter(id => validIds.has(id)))
        setSelectedMeetingIds(validSelected)
        if (validSelected.size > 0) {
          setMeetingContextExpanded(true)
          appliedFields.push('meetings')
        }
      }
      if ('selectedCalendarIds' in changes && Array.isArray(changes.selectedCalendarIds) && changes.selectedCalendarIds.length > 0) {
        const calIdSet = new Set(changes.selectedCalendarIds as string[])
        // Validate against actual available calendars
        const validCalIds = new Set(allCalendars.map(c => c.id))
        const validSelected = new Set([...calIdSet].filter(id => validCalIds.has(id)))
        setSelectedCalendarIds(validSelected)
        if (validSelected.size > 0) {
          setMeetingContextExpanded(true)
          appliedFields.push('calendars')
        }
      }

      const summary = appliedFields.length > 0
        ? `Updated ${appliedFields.join(', ')}${data.explanation ? ' -- ' + data.explanation : ''}`
        : data.explanation || 'No changes needed.'
      return { message: summary, action: 'compose', systemPrompt: data.systemPrompt }
    } catch (err) {
      throw err
    }
  }, [composeTitle, composeBody, aiContext, pollEnabled, pollOptions, distributionRows, dmRows, selectedMeetingIds, selectedCalendarIds, meetings, allCalendars, calendarParticipants, user, showToast])

  // Keep ref to latest compose handler so the useEffect below doesn't depend on it
  doAiComposeRef.current = doAiCompose

  // Register AI page context so the global AI panel uses announcement-specific logic
  useEffect(() => {
    setPageContext({
      pageName: 'Announcement Assistant',
      suggestions: [
        'Help me draft a team announcement',
        'Create a test message for this calendar',
        'Make this announcement more concise',
        'Create a poll asking about meeting times',
      ],
      placeholder: 'e.g. "draft an announcement for the weekly sync meeting"',
      onSubmit: (msg: string, history?: Array<{ role: 'user' | 'assistant'; content: string }>) => doAiComposeRef.current!(msg, history),
    })
    return () => setPageContext(null)
  }, [setPageContext])

  // ─── Compose & Send ────────────────────────────────────────

  const pollDeliveryStatus = useCallback(async (scheduleId: string) => {
    try {
      const res = await apiClient.get(`/api/announcements/schedules/${scheduleId}/status`)
      const { schedule, deliveryLog } = res.data as {
        schedule: AnnouncementSchedule
        deliveryLog: DeliveryLogEntry[]
      }

      // Helper to map delivery log status
      const friendlyDmError = (msg: string | null): string => {
        if (!msg) return 'Delivery failed'
        if (/cannot send messages|50007/i.test(msg)) return 'User has bot muted or DMs closed'
        return msg
      }
      const mapLogStatus = (logEntry: DeliveryLogEntry) => ({
        status: (logEntry.status === 'sent' ? 'sent' : logEntry.status === 'failed' ? 'failed' : 'sending') as DistributionRow['status'],
        status_msg: logEntry.status === 'sent'
          ? `Delivered at ${formatDateTimeDDMMYYYY(logEntry.delivered_at!)}`
          : logEntry.status === 'failed'
            ? (logEntry.channel_type === 'discord_dm' ? friendlyDmError(logEntry.error_message) : logEntry.error_message || 'Delivery failed')
            : 'Sending...',
      })

      setDistributionRows(prev => prev.map(row => {
        const logEntry = deliveryLog.find(l => l.target_id === row.channel_id)
        if (logEntry) {
          return { ...row, ...mapLogStatus(logEntry) }
        }
        // If schedule is done but no log entry for this target, it wasn't selected
        if (schedule.status === 'sent' || schedule.status === 'failed' || schedule.status === 'partially_sent') {
          if (row.selected && (row.status === 'sending' || row.status === 'scheduled')) {
            return { ...row, status: 'failed', status_msg: 'No delivery record' }
          }
        }
        return row
      }))

      // Also update DM rows with delivery status
      setDmRows(prev => prev.map(row => {
        const logEntry = deliveryLog.find(l => l.target_id === row.user_id)
        if (logEntry) {
          return { ...row, ...mapLogStatus(logEntry) }
        }
        if (schedule.status === 'sent' || schedule.status === 'failed' || schedule.status === 'partially_sent') {
          if (row.selected && (row.status === 'sending' || row.status === 'scheduled')) {
            return { ...row, status: 'failed', status_msg: 'No delivery record' }
          }
        }
        return row
      }))

      // Update email delivery status from log entries
      const emailLogs = deliveryLog.filter(l => l.channel_type === 'email')
      setEmailDeliveryStatus({
        total: emailLogs.length,
        sent: emailLogs.filter(l => l.status === 'sent').length,
        failed: emailLogs.filter(l => l.status === 'failed').length,
      })

      // Stop polling when schedule is complete
      if (schedule.status === 'sent' || schedule.status === 'failed' || schedule.status === 'partially_sent') {
        if (pollRef.current) {
          clearInterval(pollRef.current)
          pollRef.current = null
        }
        setActiveScheduleId(null)
        sendingRef.current = false
        setSending(false)
        fetchSchedules()

        const successCount = deliveryLog.filter(l => l.status === 'sent').length
        const failCount = deliveryLog.filter(l => l.status === 'failed').length
        setSendResult({
          type: failCount > 0 && successCount > 0 ? 'warning' : failCount > 0 ? 'error' : 'success',
          message: `Delivery complete: ${successCount} sent, ${failCount} failed out of ${deliveryLog.length} target(s)`,
        })
      }
    } catch {
      // Keep polling, transient error
    }
  }, [fetchSchedules])

  const handleSend = async () => {
    // Synchronous guard: useRef is immune to React's async state batching,
    // preventing duplicate submissions from rapid double-clicks
    if (sendingRef.current) return
    sendingRef.current = true

    if (!composeBody.trim()) {
      sendingRef.current = false
      setSendResult({ type: 'error', message: 'Message body is required' })
      return
    }

    const selectedRows = distributionRows.filter(r => r.selected)
    const selectedDmRows = dmRows.filter(r => r.selected)

    // Block if DM recipients exceed platform limit
    if (selectedDmRows.length > DM_RATE_LIMIT_MAX) {
      sendingRef.current = false
      setSendResult({
        type: 'error',
        message: isAdmin
          ? `Too many DM recipients (${selectedDmRows.length.toLocaleString()}). Maximum per send is ${DM_RATE_LIMIT_MAX.toLocaleString()}. Please reduce your selection or split into multiple batches.`
          : `Too many DM recipients (${selectedDmRows.length.toLocaleString()}). Maximum per send is ${DM_RATE_LIMIT_MAX.toLocaleString()}. Please reduce your selection, split into multiple batches, or contact support via the Feedback button to request a higher limit.`,
      })
      return
    }

    // Collect selected email recipients (from the unified email table)
    const emailRecipientRows: EmailRecipientRow[] = []
    if (emailIntegrationSetup) {
      // Rebuild allRows the same way the email table does
      for (const c of emailContacts) {
        const key = `manual:${c.id}`
        if (selectedEmailRecipients.has(key) && !c.opted_out && !c.notification_disabled) {
          emailRecipientRows.push({ key, display_name: c.display_name || c.email.split('@')[0], email: c.email, email_display: c.email, source: 'manual', source_detail: '', status_label: 'Active', status_color: '', selectable: true })
        }
      }
      for (const f of friendConnections) {
        const key = `friendlist:${f.user_id}`
        if (selectedEmailRecipients.has(key) && f.email) {
          emailRecipientRows.push({ key, display_name: f.display_name, email: f.email, email_display: f.email, source: 'friendlist', source_detail: '', status_label: 'Active', status_color: '', selectable: true })
        }
      }
      const activeCalIds = new Set([
        ...meetings.filter(m => selectedMeetingIds.has(m.id)).map(m => m.calendar_id),
        ...Array.from(selectedCalendarIds),
      ])
      for (const p of calendarParticipantEmails) {
        const matchedCalIds = p.calendar_ids.filter(cid => activeCalIds.has(cid))
        if (matchedCalIds.length === 0) continue
        const key = `calendar:${p.username}`
        if (selectedEmailRecipients.has(key) && (p.email_status === 'visible' || p.email_status === 'hidden') && p.email) {
          emailRecipientRows.push({ key, display_name: p.username, email: p.email, email_display: p.email, source: 'calendar', source_detail: '', status_label: 'Active', status_color: '', selectable: true })
        }
      }
    }

    if (selectedRows.length === 0 && selectedDmRows.length === 0 && emailRecipientRows.length === 0) {
      sendingRef.current = false
      setSendResult({ type: 'error', message: 'Select at least one target channel, DM recipient, or email recipient' })
      return
    }

    // Require email subject when sending to email recipients
    if (emailRecipientRows.length > 0 && !emailSubject.trim()) {
      sendingRef.current = false
      setSendResult({ type: 'error', message: 'Email Subject is required when sending to email recipients' })
      return
    }

    // Block channels where either user or bot lacks permission
    const noPermRows = selectedRows.filter(r => !r.bot_can_send || !r.user_can_send)
    if (noPermRows.length > 0) {
      const details = noPermRows.map(r => {
        const issues = []
        if (!r.bot_can_send) issues.push('bot')
        if (!r.user_can_send) issues.push('you')
        return `• ${r.guild_name} / #${r.channel_name} (no access: ${issues.join(' & ')})`
      }).join('\n')
      sendingRef.current = false
      setSendResult({
        type: 'error',
        message: `${noPermRows.length} selected channel(s) cannot be used because either you or the bot lack permission. Deselect them to proceed.\n${details}`,
      })
      return
    }

    setSending(true)
    setSendResult(null)

    // Collect valid poll options (sent separately — bot adds as reactions)
    const finalBody = buildFullBody().trim()
    const rawPollOptions = pollEnabled
      ? pollOptions.filter(o => o.text.trim())
      : []
    // Deduplicate emojis before sending — keep first occurrence, skip duplicates
    const validPollOptions: PollOption[] = []
    const sentEmojis = new Set<string>()
    for (const opt of rawPollOptions) {
      if (!sentEmojis.has(opt.emoji)) {
        sentEmojis.add(opt.emoji)
        validPollOptions.push(opt)
      }
    }

    // Build targets from selected channel rows
    const targets: AnnouncementTarget[] = selectedRows.map(r => ({
      type: 'discord_channel' as const,
      target_id: r.channel_id,
      label: `#${r.channel_name} (${r.guild_name})`,
    }))

    // Add DM targets
    for (const dm of selectedDmRows) {
      const dmTarget: AnnouncementTarget = {
        type: 'discord_dm' as const,
        target_id: dm.user_id,
        label: `DM: ${dm.display_name} (${dm.username})`,
      }
      // Attach extra DM content as a per-target body override when set
      if (composeDmBody.trim()) {
        dmTarget.body_override = finalBody + '\n\n' + composeDmBody.trim()
      }
      targets.push(dmTarget)
    }

    // Add email targets (deduplicate by email address)
    const seenEmails = new Set<string>()
    for (const er of emailRecipientRows) {
      if (!er.email) continue
      const emailLower = er.email.toLowerCase()
      if (seenEmails.has(emailLower)) continue
      seenEmails.add(emailLower)
      targets.push({
        type: 'email' as const,
        target_id: er.email,
        label: `Email: ${er.display_name} <${er.email}>`,
      })
    }

    // Set all selected to appropriate status
    const statusForMode = sendMode === 'now' ? 'sending' as const : 'scheduled' as const
    const tzAbbr = getPrimaryTimezone() === 'UTC' ? 'UTC' : getPrimaryTimezone()
    const usingPerMeetingRemindersMsg = sendMode === 'schedule' && selectedMeetingIds.size > 0 && reminderOffsets.length > 0
    const statusMsgForMode = sendMode === 'now'
      ? 'Queued...'
      : usingPerMeetingRemindersMsg
        ? `Scheduled per-meeting reminders (${reminderOffsets.length} offset${reminderOffsets.length !== 1 ? 's' : ''})`
        : `Scheduled: ${scheduleDate} ${scheduleTime} ${tzAbbr}`
    setDistributionRows(prev => prev.map(r =>
      r.selected ? { ...r, status: statusForMode, status_msg: statusMsgForMode } : r
    ))
    setDmRows(prev => prev.map(r =>
      r.selected ? { ...r, status: statusForMode, status_msg: statusMsgForMode } : r
    ))

    // Track email target count for progress bar
    const emailTargetCount = targets.filter(t => t.type === 'email').length
    if (emailTargetCount > 0) {
      setEmailDeliveryStatus({ total: emailTargetCount, sent: 0, failed: 0 })
    }

    // Derive calendarId: prefer explicit calendar selection, fallback to first selected meeting's calendar
    const resolvedCalendarId = selectedCalendarIds.size > 0
      ? Array.from(selectedCalendarIds)[0]
      : selectedMeetingIds.size > 0
        ? meetings.find(m => selectedMeetingIds.has(m.id))?.calendar_id ?? undefined
        : undefined

    // Warn if sending DMs without a calendar context (no Subscribe button, no invite tracking)
    const hasDmTargets = targets.some(t => t.type === 'discord_dm')
    if (hasDmTargets && !resolvedCalendarId && allCalendars.length > 0) {
      const proceed = window.confirm(
        'No Coordination Calendar is attached. DM recipients will not see a Subscribe button and invite tracking will be skipped.\n\nAttach a calendar from the "Attach Coordination Calendar Context" section to enable subscription management.\n\nSend anyway?'
      )
      if (!proceed) {
        sendingRef.current = false
        setSending(false)
        setDistributionRows(prev => prev.map(r =>
          r.selected && r.status === 'sending' ? { ...r, status: 'composing', status_msg: r.bot_can_send ? 'Ready' : 'No permission' } : r
        ))
        setDmRows(prev => prev.map(r =>
          r.selected && r.status === 'sending' ? { ...r, status: 'composing', status_msg: 'Ready' } : r
        ))
        return
      }
    }

    try {
      if (sendMode === 'now') {
        const res = await apiClient.post('/api/announcements/send-now', {
          title: composeTitle,
          body: finalBody,
          targets,
          pollOptions: validPollOptions.length > 0 ? validPollOptions : undefined,
          emailSubject: emailSubject.trim() || undefined,
          suppressEmbeds: suppressEmbeds || undefined,
          calendarId: resolvedCalendarId,
        })
        const scheduleId = res.data.schedule.id
        setActiveScheduleId(scheduleId)

        // If all targets were pre-resolved by the API (e.g. all DMs blocked),
        // poll immediately -- no need to wait for the bot
        if (res.data.preResolved) {
          pollDeliveryStatus(scheduleId)
        } else {
          // Start polling for delivery status every 3 seconds
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = setInterval(() => pollDeliveryStatus(scheduleId), 3000)
          // Also poll immediately after a short delay (bot polls every 30s, but let's check quickly)
          setTimeout(() => pollDeliveryStatus(scheduleId), 2000)
        }
      } else {
        const usingPerMeetingReminders = selectedMeetingIds.size > 0 && reminderOffsets.length > 0

        if (!usingPerMeetingReminders) {
          if (!scheduleDate || !scheduleTime) {
            setSendResult({ type: 'error', message: 'Please set a date and time for the schedule, or attach meetings and add per-meeting reminder offsets.' })
            sendingRef.current = false
            setSending(false)
            setDistributionRows(prev => prev.map(r =>
              r.selected ? { ...r, status: 'composing', status_msg: r.bot_can_send ? 'Ready' : 'No permission' } : r
            ))
            return
          }
          const scheduledAt = new Date(`${scheduleDate}T${scheduleTime}:00Z`).toISOString()
          await apiClient.post('/api/announcements/schedules', {
            title: composeTitle,
            body: finalBody,
            scheduledAt,
            targets,
            pollOptions: validPollOptions.length > 0 ? validPollOptions : undefined,
            emailSubject: emailSubject.trim() || undefined,
            suppressEmbeds: suppressEmbeds || undefined,
            calendarId: resolvedCalendarId,
          })

          setDistributionRows(prev => prev.map(r =>
            r.selected ? { ...r, status: 'scheduled', status_msg: `Scheduled: ${scheduleDate} ${scheduleTime}` } : r
          ))
          setDmRows(prev => prev.map(r =>
            r.selected ? { ...r, status: 'scheduled', status_msg: `Scheduled: ${scheduleDate} ${scheduleTime}` } : r
          ))
          setSendResult({ type: 'success', message: `Announcement scheduled for ${scheduleDate} at ${scheduleTime}` })
          sendingRef.current = false
          setSending(false)
          fetchSchedules()
        } else {
          // Fan out: create one schedule per (meeting x offset) at meeting.start - offset.
          const selectedMeetings = meetings.filter(m => selectedMeetingIds.has(m.id))
          const nowMs = Date.now()
          const minLeadMs = 60_000
          type Plan = { meeting: MeetingOption; offset: ReminderOffset; scheduledAt: string }
          const plans: Plan[] = []
          const skipped: string[] = []
          for (const m of selectedMeetings) {
            const startMs = getMeetingStartMs(m)
            for (const o of reminderOffsets) {
              const sendMs = startMs - offsetToMs(o)
              if (sendMs < nowMs + minLeadMs) {
                skipped.push(`${m.calendar_title || m.title} - ${formatOffsetLabel(o)}`)
                continue
              }
              plans.push({ meeting: m, offset: o, scheduledAt: new Date(sendMs).toISOString() })
            }
          }

          if (plans.length === 0) {
            setSendResult({ type: 'error', message: 'No reminder schedules to create - all (meeting, offset) combinations fall in the past. Add a future offset or unselect past meetings.' })
            setDistributionRows(prev => prev.map(r =>
              r.selected ? { ...r, status: 'composing', status_msg: r.bot_can_send ? 'Ready' : 'No permission' } : r
            ))
            setDmRows(prev => prev.map(r =>
              r.selected ? { ...r, status: 'composing', status_msg: 'Ready' } : r
            ))
            sendingRef.current = false
            setSending(false)
            return
          }

          let successCount = 0
          let failCount = 0
          const failures: string[] = []

          for (const plan of plans) {
            try {
              const perMeetingBody = buildFullBodyForMeeting(plan.meeting.id).trim()
              // Re-derive targets per plan so DM body_override references this meeting only
              const perTargets: AnnouncementTarget[] = targets.map(t => {
                if (t.type === 'discord_dm' && composeDmBody.trim()) {
                  return { ...t, body_override: perMeetingBody + '\n\n' + composeDmBody.trim() }
                }
                return t
              })
              await apiClient.post('/api/announcements/schedules', {
                title: composeTitle,
                body: perMeetingBody,
                scheduledAt: plan.scheduledAt,
                targets: perTargets,
                pollOptions: validPollOptions.length > 0 ? validPollOptions : undefined,
                emailSubject: emailSubject.trim() || undefined,
                suppressEmbeds: suppressEmbeds || undefined,
                calendarId: plan.meeting.calendar_id,
              })
              successCount++
            } catch (e) {
              failCount++
              failures.push(`${plan.meeting.calendar_title || plan.meeting.title} - ${formatOffsetLabel(plan.offset)}: ${(e as { response?: { data?: { error?: string } } }).response?.data?.error || (e as { message?: string }).message}`)
            }
          }

          const reminderLabel = `${successCount} reminder${successCount !== 1 ? 's' : ''}`
          setDistributionRows(prev => prev.map(r =>
            r.selected ? { ...r, status: 'scheduled', status_msg: `Scheduled ${reminderLabel}` } : r
          ))
          setDmRows(prev => prev.map(r =>
            r.selected ? { ...r, status: 'scheduled', status_msg: `Scheduled ${reminderLabel}` } : r
          ))

          // Estimated total delivery time across all reminders
          const selChannels = distributionRows.filter(r => r.selected).length
          const selDms = dmRows.filter(r => r.selected && !r.opted_out).length
          const selEmails = selectedEmailRecipients.size
          const totalSec = estimateBatchDurationSec(selChannels, selDms, selEmails) * successCount

          if (failCount === 0) {
            const skippedNote = skipped.length > 0
              ? ` (${skipped.length} offset${skipped.length !== 1 ? 's' : ''} skipped - already in the past.)`
              : ''
            setSendResult({
              type: 'success',
              message: `Created ${successCount} reminder schedule${successCount !== 1 ? 's' : ''} across ${selectedMeetings.length} meeting${selectedMeetings.length !== 1 ? 's' : ''}. Total estimated delivery time when triggered: ${formatDurationShort(totalSec)}.${skippedNote}`,
            })
          } else {
            setSendResult({
              type: 'warning',
              message: `Scheduled ${successCount}, failed ${failCount}. ${failures.slice(0, 3).join('; ')}${failures.length > 3 ? ` (+${failures.length - 3} more)` : ''}`,
            })
          }
          sendingRef.current = false
          setSending(false)
          fetchSchedules()
        }
      }
    } catch (err) {
      setSendResult({ type: 'error', message: (err as { response?: { data?: { error?: string } } }).response?.data?.error || (err as { message?: string }).message || 'Request failed' })
      setDistributionRows(prev => prev.map(r =>
        r.selected && (r.status === 'sending' || r.status === 'scheduled') ? { ...r, status: 'failed', status_msg: 'Request failed' } : r
      ))
      setDmRows(prev => prev.map(r =>
        r.selected && (r.status === 'sending' || r.status === 'scheduled') ? { ...r, status: 'failed', status_msg: 'Request failed' } : r
      ))
      sendingRef.current = false
      setSending(false)
    }
  }

  const resetCompose = () => {
    setComposeTitle('')
    setComposeBody('')
    setComposeDmBody('')
    setEmailSubject('')
    setBodyRows(6)
    setScheduleDate('')
    setScheduleTime('')
    setReminderOffsets([])
    setSendResult(null)
    setActiveScheduleId(null)
    setPollEnabled(false)
    setPollOptions([
      { emoji: '🌟', text: '' },
      { emoji: '🎯', text: '' },
    ])
    setSuppressEmbeds(true)
    // Clear session cache for compose fields (keep aiContext — it's general knowledge)
    try {
      sessionStorage.removeItem('cm-ann-title')
      sessionStorage.removeItem('cm-ann-body')
      sessionStorage.removeItem('cm-ann-dm-body')
      sessionStorage.removeItem('cm-ann-poll-enabled')
      sessionStorage.removeItem('cm-ann-poll-options')
      sessionStorage.removeItem('cm-ann-suppress-embeds')
      sessionStorage.removeItem('cm-ann-selected-channels')
      sessionStorage.removeItem('cm-ann-selected-dms')
      sessionStorage.removeItem('cm-ann-reminder-offsets')
    } catch { /* ignore */ }
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    // Reset distribution rows to composing state
    setDistributionRows(prev => prev.map(r => ({
      ...r,
      status: 'composing' as const,
      status_msg: (r.bot_can_send && r.user_can_send) ? 'Ready' : !r.bot_can_send && !r.user_can_send ? 'No permission (bot & you)' : !r.bot_can_send ? 'Bot lacks permission' : 'You lack permission',
    })))
    setDmRows(prev => prev.map(r => ({
      ...r,
      status: 'composing' as const,
      status_msg: 'Ready',
    })))
    setEmailDeliveryStatus({ total: 0, sent: 0, failed: 0 })
  }

  // ─── Template Actions ──────────────────────────────────────

  const saveTemplate = async (overrideId?: string) => {
    const body = templateBody.trim() || composeBody.trim()
    if (!body) return

    // Auto-generate title from body if none provided
    const title = templateTitle.trim() || composeTitle.trim() || body.slice(0, 25) + (body.length > 25 ? '…' : '')

    // Check for duplicate title (only when not already overriding)
    if (!overrideId) {
      const duplicate = templates.find(t => t.title.toLowerCase() === title.toLowerCase() && t.id !== editingTemplate?.id)
      if (duplicate) {
        setTemplateOverrideTarget(duplicate)
        setTemplateTitle(title)
        setTemplateBody(body)
        return
      }
    }

    setSavingTemplate(true)
    setTemplateOverrideTarget(null)

    try {
      // Collect current distribution targets and meeting context
      const meetingIds = Array.from(selectedMeetingIds)
      const distributionChannelIds = distributionRows.filter(r => r.selected).map(r => r.channel_id)
      const dmRecipientIds = dmRows.filter(r => r.selected).map(r => r.user_id)

      if (overrideId) {
        // Update the existing template with the same title
        const res = await apiClient.put(`/api/announcements/templates/${overrideId}`, {
          title,
          body,
          meetingIds,
          distributionChannelIds,
          dmRecipientIds,
        })
        setTemplates(prev => prev.map(t => t.id === overrideId ? res.data.template : t))
      } else if (editingTemplate) {
        const res = await apiClient.put(`/api/announcements/templates/${editingTemplate.id}`, {
          title,
          body,
          meetingIds,
          distributionChannelIds,
          dmRecipientIds,
        })
        setTemplates(prev => prev.map(t => t.id === editingTemplate.id ? res.data.template : t))
      } else {
        const res = await apiClient.post('/api/announcements/templates', {
          title,
          body,
          meetingIds,
          distributionChannelIds,
          dmRecipientIds,
        })
        setTemplates(prev => [res.data.template, ...prev])
      }
      setEditingTemplate(null)
      setTemplateTitle('')
      setTemplateBody('')
      const msg = overrideId || editingTemplate ? 'Template updated' : 'Template saved'
      showToast(msg, 'success')
      setSendResult({ type: 'success', message: msg })
    } catch (err) {
      console.error('Failed to save template:', err)
      showToast('Failed to save template', 'error')
      setSendResult({ type: 'error', message: 'Failed to save template' })
    }
    setSavingTemplate(false)
  }

  const deleteTemplate = async (id: string) => {
    try {
      await apiClient.delete(`/api/announcements/templates/${id}`)
      setTemplates(prev => prev.filter(t => t.id !== id))
    } catch (err) {
      console.error('Failed to delete template:', err)
    }
  }

  // ─── Fuzzy Name Matching Utilities ──────────────────────────
  // Levenshtein edit distance between two strings
  const editDistance = (a: string, b: string): number => {
    if (a.length === 0) return b.length
    if (b.length === 0) return a.length
    const matrix: number[][] = []
    for (let i = 0; i <= a.length; i++) matrix[i] = [i]
    for (let j = 0; j <= b.length; j++) matrix[0][j] = j
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost,
        )
      }
    }
    return matrix[a.length][b.length]
  }

  // Score how well a single input word matches a single target word (0–1)
  // Length-aware: short substring matches in long words score low
  const wordSimilarity = (input: string, target: string): number => {
    if (input === target) return 1.0
    const shorter = Math.min(input.length, target.length)
    const longer = Math.max(input.length, target.length)
    if (longer === 0) return 0
    const lenRatio = shorter / longer // how similar in length (0–1)

    // Prefix match: scale by length ratio (short prefix of long word = low score)
    if (target.startsWith(input)) return 0.5 + 0.45 * lenRatio // "fan" of "fanny" = 0.5+0.45*0.6=0.77, "fa" of "fanny" = 0.5+0.45*0.4=0.68
    if (input.startsWith(target)) return 0.5 + 0.45 * lenRatio

    // Substring match: scale by coverage ratio — how much of the longer word is covered
    if (target.includes(input)) {
      const coverage = input.length / target.length
      return 0.3 * coverage + 0.15 * lenRatio // "ja" in "wijaya" = 0.3*0.33+0.15*0.33 = 0.15
    }
    if (input.includes(target)) {
      const coverage = target.length / input.length
      return 0.3 * coverage + 0.15 * lenRatio
    }

    // Edit distance similarity
    const dist = editDistance(input, target)
    return Math.max(0, 1 - dist / longer)
  }

  // Score how well an input name matches a candidate member (0–1)
  // Multi-word input: ALL words must contribute — averaged, not max'd
  const nameSimilarity = (inputName: string, candidateFields: string[]): number => {
    const inputLower = inputName.toLowerCase()
    const inputWords = inputLower.split(/[\s\-_.]+/).filter(Boolean)
    if (inputWords.length === 0) return 0

    let bestScore = 0
    for (const field of candidateFields) {
      const fieldLower = field.toLowerCase()
      const targetWords = fieldLower.split(/[\s\-_.]+/).filter(Boolean)
      if (targetWords.length === 0) continue

      // Strategy 1: Full-string similarity
      const fullStrSim = wordSimilarity(inputLower, fieldLower)

      // Strategy 2: Word-to-word matching — average of best per-input-word scores
      // Each input word finds its best target word; then we average all of them
      // so unmatched words drag the score down properly
      let wordMatchSum = 0
      for (const iw of inputWords) {
        let bestWordMatch = 0
        for (const tw of targetWords) {
          bestWordMatch = Math.max(bestWordMatch, wordSimilarity(iw, tw))
        }
        // Penalize very short input words (1-2 chars) — they match too easily
        if (iw.length <= 2) bestWordMatch *= 0.4
        else if (iw.length === 3) bestWordMatch *= 0.7

        wordMatchSum += bestWordMatch
      }
      const avgWordMatch = wordMatchSum / inputWords.length

      // Strategy 3: Exact prefix of full field (handles nicknames)
      const prefixBonus = fieldLower.startsWith(inputLower)
        ? 0.5 + 0.45 * (inputLower.length / fieldLower.length)
        : 0

      bestScore = Math.max(bestScore, fullStrSim, avgWordMatch, prefixBonus)
    }
    return bestScore
  }

  // ─── Find & Select Members by Name ─────────────────────────
  // Fuzzy-matches a comma-separated list of names against DM members'
  // display_name and username with typo tolerance and confidence-based selection.
  const findAndSelectMembers = (nameList: string) => {
    const inputNames = nameList
      .split(/[,\n]+/)
      .map(n => n.trim())
      .filter(Boolean)
    if (inputNames.length === 0) return

    // If DM members aren't loaded yet, trigger fetch and store names
    // in sessionStorage so we can apply after load
    if (dmRows.length === 0) {
      sessionStorage.setItem('cm-ann-pending-name-match', nameList)
      fetchDmMembers()
      return
    }

    const matchedIds = new Set<string>()
    const matchedNames: string[] = []
    const meta = new Map<string, { score: number; matchedBy: string }>()

    for (const inputName of inputNames) {
      // Score every non-opted-out member against this input name
      const scored: { row: DmDistributionRow; score: number }[] = []
      for (const row of dmRows) {
        if (row.opted_out) continue
        const score = nameSimilarity(inputName, [row.display_name, row.username])
        if (score > 0.3) scored.push({ row, score })
      }

      // Sort by score descending
      scored.sort((a, b) => b.score - a.score)

      // Cap to top 10 candidates per input name
      const top = scored.slice(0, 10)

      if (top.length === 0) continue

      const topScore = top[0].score

      // Threshold: must be within 30% of the top score, and also pass a minimum
      // e.g. top=1.0 → cutoff 0.7, top=0.57 → cutoff 0.27
      // For weak top matches (<0.45), only take the single best candidate
      const gapCutoff = topScore - 0.30
      const minThreshold = topScore >= 0.45 ? 0.35 : topScore - 0.01
      const threshold = Math.max(gapCutoff, minThreshold)

      for (const { row, score } of top) {
        if (score < threshold) break // sorted descending

        matchedIds.add(row.user_id)
        if (!matchedNames.includes(row.display_name)) matchedNames.push(row.display_name)
        const existing = meta.get(row.user_id)
        if (!existing || score > existing.score) {
          meta.set(row.user_id, { score: Math.round(score * 100) / 100, matchedBy: inputName })
        }

        // For weak top scores, only take the single best
        if (topScore < 0.45) break
      }
    }

    // Store match metadata for display
    setDmMatchMeta(meta)

    // Select matched members (additive — keep existing selections)
    if (matchedIds.size > 0) {
      setDmRows(prev => prev.map(r => ({
        ...r,
        selected: r.selected || (matchedIds.has(r.user_id) && !r.opted_out),
      })))
      setDmSelectedOnly(true)
    }

    setNameMatchResult({
      matched: matchedIds.size,
      total: inputNames.length,
      names: matchedNames,
    })
    setNameMatchInput('')

    // Auto-clear result after 8 seconds
    setTimeout(() => setNameMatchResult(null), 8000)
  }

  // Apply pending name match after DM members load
  useEffect(() => {
    if (dmRows.length === 0) return
    try {
      const pending = sessionStorage.getItem('cm-ann-pending-name-match')
      if (pending) {
        sessionStorage.removeItem('cm-ann-pending-name-match')
        findAndSelectMembers(pending)
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dmRows.length])

  const applyTemplate = (template: AnnouncementTemplate) => {
    setComposeTitle(template.title)
    setComposeBody(template.body)
    setPollEnabled(false)
    setPollOptions([{ emoji: '🌟', text: '' }, { emoji: '🎯', text: '' }])

    // Restore meeting context selections
    if (template.meeting_ids?.length) {
      setSelectedMeetingIds(new Set(template.meeting_ids))
      setMeetingContextExpanded(true)
    } else {
      setSelectedMeetingIds(new Set())
    }
    setSelectedCalendarIds(template.calendar_id ? new Set([template.calendar_id]) : new Set())

    // Restore distribution channel selections
    if (template.distribution_channel_ids?.length) {
      const channelSet = new Set(template.distribution_channel_ids)
      setDistributionRows(prev => prev.map(r => ({
        ...r,
        selected: channelSet.has(r.channel_id),
      })))
    }

    // Restore DM recipient selections — if members aren't loaded yet, trigger fetch
    if (template.dm_recipient_ids?.length) {
      const dmSet = new Set(template.dm_recipient_ids)
      if (dmMembers.length > 0) {
        // Members already loaded — apply selection immediately
        setDmRows(prev => prev.map(r => ({
          ...r,
          selected: r.opted_out ? false : dmSet.has(r.user_id),
        })))
      } else {
        // Store in sessionStorage so selection is applied once members load
        sessionStorage.setItem('cm-ann-selected-dms', JSON.stringify(template.dm_recipient_ids))
        fetchDmMembers()
      }
    }

    switchTab('compose')
  }

  const cancelSchedule = async (id: string) => {
    try {
      await apiClient.put(`/api/announcements/schedules/${id}/cancel`)
      setSchedules(prev => prev.map(s => s.id === id ? { ...s, status: 'cancelled' as const } : s))
    } catch (err) {
      console.error('Failed to cancel:', err)
    }
  }

  // ─── Login Required ────────────────────────────────────────

  if (!isAuthenticated) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <Megaphone className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">Sign in Required</h2>
        <p className="text-muted-foreground">You need to be signed in to use the announcement distribution system.</p>
      </div>
    )
  }

  // ─── Render ────────────────────────────────────────────────

  const tabClass = (tab: SubTab) =>
    `px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
      activeTab === tab
        ? 'bg-card border border-b-0 border-border text-foreground'
        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
    }`

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl">
      <div className="flex items-center gap-3 mb-6">
        <Megaphone className="w-7 h-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Distribute Messages</h1>
          <p className="text-sm text-muted-foreground">Compose, schedule, and distribute messages across Discord and Email</p>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-border">
        <button onClick={() => switchTab('compose')} className={tabClass('compose')}>
          <div className="flex items-center gap-1.5"><Send className="w-4 h-4" /> Compose</div>
        </button>
        <button onClick={() => switchTab('templates')} className={tabClass('templates')}>
          <div className="flex items-center gap-1.5"><Copy className="w-4 h-4" /> Templates</div>
        </button>
        <button onClick={() => switchTab('scheduled')} className={tabClass('scheduled')}>
          <div className="flex items-center gap-1.5"><Clock className="w-4 h-4" /> Scheduled</div>
        </button>
        <button onClick={() => switchTab('responses')} className={tabClass('responses')}>
          <div className="flex items-center gap-1.5"><ListChecks className="w-4 h-4" /> Responses</div>
        </button>
        <button onClick={() => switchTab('discord')} className={tabClass('discord')}>
          <div className="flex items-center gap-1.5"><Bot className="w-4 h-4" /> Discord</div>
        </button>
        <button onClick={() => switchTab('email')} className={tabClass('email')}>
          <div className="flex items-center gap-1.5"><Mail className="w-4 h-4" /> Email</div>
        </button>
      </div>

      <div className="bg-card border border-t-0 border-border rounded-b-lg p-6 relative">

        {/* ═══════════════════════════════════════════════════════
            COMPOSE TAB
            ═══════════════════════════════════════════════════════ */}
        {activeTab === 'compose' && (
          <>

            {/* AI Context — collapsible textarea for background knowledge.
                sticky top-0: stays visible while scrolling compose content.
                z-10: below user-menu dropdown (z-20). */}
            {aiAvailable && (
              <div className="sticky top-0 z-10 -mx-6 -mt-6 mb-6">
                <div className="px-6 py-3 bg-purple-50/[0.92] dark:bg-purple-950/[0.88] border-b border-purple-300 dark:border-purple-700 backdrop-blur-sm flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent('openAiPanel'))}
                  className="ai-assistant-btn flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold shrink-0"
                  title="Open AI Assistant"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  AI Assistant
                </button>
                <div className="border border-purple-200 dark:border-purple-800 rounded-lg overflow-hidden flex-1 min-w-0">
                  <div className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/40">
                    <button
                      type="button"
                      onClick={() => setAiContextExpanded(prev => !prev)}
                      className="flex items-center gap-2 flex-1 hover:bg-purple-100 dark:hover:bg-purple-950/60 rounded transition-colors py-0.5 -my-0.5 px-1 -mx-1"
                    >
                      {aiContextExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      <Info className="w-3.5 h-3.5" />
                      AI Context
                      {aiContext && <span className="ml-auto text-[10px] text-purple-400">has context</span>}
                    </button>
                  </div>
                  {aiContextExpanded && (
                    <div className="px-3 py-2 bg-purple-50/50 dark:bg-purple-950/20">
                      <textarea
                        value={aiContext}
                        onChange={(e) => setAiContext(e.target.value)}
                        placeholder="Provide background context for the AI (e.g. audience, tone, project details). The AI will also update this field with relevant context as you interact."
                        rows={3}
                        className="w-full px-3 py-2 border border-purple-200 dark:border-purple-700 rounded-md text-sm bg-background text-foreground focus:ring-2 focus:ring-purple-400 outline-none resize-y placeholder:text-muted-foreground"
                      />
                      <p className="text-[10px] text-muted-foreground mt-1">This context is sent with every AI prompt and can be updated by AI responses.</p>
                    </div>
                  )}
                </div>
                </div>
              </div>
            )}
            <div className="space-y-6">

            {/* Check if Discord is connected */}
            {!integration?.bot_verified && (
              <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800">
                <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Discord not connected</p>
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                    Connect your Discord account in the Discord tab to enable announcement distribution.
                  </p>
                  <button
                    onClick={() => switchTab('discord')}
                    className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300 underline hover:no-underline"
                  >
                    Go to Discord setup →
                  </button>
                </div>
              </div>
            )}

            {/* Load Template — expansion panel with single selection */}
            {templates.length > 0 && !sending && (
              <div className="border border-border rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setTemplatePickerExpanded(!templatePickerExpanded)}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium hover:bg-muted/50 transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    <Clipboard className="w-4 h-4" />
                    Load Template
                    <span className="text-xs font-normal text-muted-foreground">({templates.length})</span>
                  </span>
                  {templatePickerExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
                {templatePickerExpanded && (
                  <div className="border-t border-border max-h-52 overflow-y-auto">
                    {templates.map(t => (
                      <button
                        key={t.id}
                        onClick={() => { applyTemplate(t); setTemplatePickerExpanded(false) }}
                        className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors border-b border-border last:border-b-0 group"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium truncate">{t.title}</span>
                          <Copy className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2" />
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{t.body}</p>
                        {((t.distribution_channel_ids?.length > 0) || (t.dm_recipient_ids?.length > 0) || (t.meeting_ids?.length > 0)) && (
                          <div className="flex items-center gap-1.5 mt-1">
                            {t.distribution_channel_ids?.length > 0 && (
                              <span className="text-[10px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400">
                                {t.distribution_channel_ids.length} ch
                              </span>
                            )}
                            {t.dm_recipient_ids?.length > 0 && (
                              <span className="text-[10px] px-1 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400">
                                {t.dm_recipient_ids.length} DM
                              </span>
                            )}
                            {t.meeting_ids?.length > 0 && (
                              <span className="text-[10px] px-1 py-0.5 rounded bg-green-500/10 text-green-600 dark:text-green-400">
                                {t.meeting_ids.length} mtg
                              </span>
                            )}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Title */}
            <div>
              <label className="text-sm font-medium block mb-1">
                Title <span className="text-xs font-normal text-muted-foreground">(optional — used when saving as template)</span>
              </label>
              <input
                type="text"
                value={composeTitle}
                onChange={e => setComposeTitle(e.target.value)}
                placeholder="e.g., Weekly Raid Schedule Update"
                className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:ring-2 focus:ring-ring outline-none"
                disabled={sending}
              />
            </div>

            {/* Coordination Calendar context — expandable checkbox tree */}
            {allCalendars.length > 0 && (() => {
              // Calendars that have at least one selected meeting or are directly selected
              const calendarIdsWithMeetings = new Set(meetings.map(m => m.calendar_id))
              const meetinglessCalendars = allCalendars.filter(c => !calendarIdsWithMeetings.has(c.id))
              const selectedCalendars = Array.from(
                new Map([
                  ...meetings
                    .filter(m => selectedMeetingIds.has(m.id))
                    .map(m => [m.calendar_id, { id: m.calendar_id, title: m.calendar_title, hash: m.calendar_hash }] as const),
                  ...allCalendars
                    .filter(c => selectedCalendarIds.has(c.id))
                    .map(c => [c.id, { id: c.id, title: c.title, hash: c.hash }] as const),
                ]).values()
              )
              const totalSelected = selectedMeetingIds.size + selectedCalendarIds.size
              return (
              <div className={`border border-border rounded-lg overflow-hidden ${sending ? 'pointer-events-none opacity-70' : ''}`}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (!meetingContextExpanded) {
                      // Snapshot current selections when expanding — these get priority in sort
                      pinnedMeetingIdsRef.current = new Set(selectedMeetingIds)
                      pinnedCalendarIdsRef.current = new Set(selectedCalendarIds)
                    }
                    setMeetingContextExpanded(!meetingContextExpanded)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      if (!meetingContextExpanded) {
                        pinnedMeetingIdsRef.current = new Set(selectedMeetingIds)
                        pinnedCalendarIdsRef.current = new Set(selectedCalendarIds)
                      }
                      setMeetingContextExpanded(!meetingContextExpanded)
                    }
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium hover:bg-muted/50 transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-1.5">
                    <CalendarDays className="w-4 h-4" />
                    Attach Coordination Calendar Context
                    {totalSelected > 0 && (
                      <span className="ml-1 text-xs font-normal text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
                        {totalSelected}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-1">
                    {/* Calendar navigation links — shown when items are selected */}
                    {selectedCalendars.length === 1 && (
                      <Link
                        to={`/calendar/${selectedCalendars[0].hash}`}
                        onClick={e => e.stopPropagation()}
                        className="flex items-center gap-1 text-xs text-primary dark:text-sky-400 hover:underline dark:hover:text-sky-300 px-1.5 py-0.5 rounded hover:bg-primary/10 dark:hover:bg-sky-400/10 transition-colors"
                        title={`Open ${selectedCalendars[0].title} in Calendar`}
                      >
                        <ExternalLink className="w-3 h-3" />
                        View Calendar
                      </Link>
                    )}
                    {selectedCalendars.length > 1 && (
                      <span className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        {selectedCalendars.map(cal => (
                          <Link
                            key={cal.id}
                            to={`/calendar/${cal.hash}`}
                            className="flex items-center gap-0.5 text-xs text-primary dark:text-sky-400 hover:underline dark:hover:text-sky-300 px-1.5 py-0.5 rounded hover:bg-primary/10 dark:hover:bg-sky-400/10 transition-colors max-w-[120px] truncate"
                            title={`Open ${cal.title} in Calendar`}
                          >
                            <ExternalLink className="w-3 h-3 shrink-0" />
                            <span className="truncate">{cal.title}</span>
                          </Link>
                        ))}
                      </span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); fetchMeetings() }}
                      disabled={loadingMeetings}
                      className="p-1 rounded hover:bg-muted transition-colors disabled:opacity-50"
                      title="Refresh"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${loadingMeetings ? 'animate-spin' : ''}`} />
                    </button>
                    {meetingContextExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </span>
                </div>
                {meetingContextExpanded && (
                  <div className="border-t border-border px-3 py-2 space-y-2 max-h-80 overflow-y-auto">
                    {/* Calendars with meetings */}
                    {meetings.length > 0 && (() => {
                      // Group meetings by calendar
                      const grouped = new Map<string, { calendarId: string; calendarTitle: string; calendarHash: string; meetings: MeetingOption[] }>()
                      meetings.forEach(m => {
                        if (!grouped.has(m.calendar_id)) {
                          grouped.set(m.calendar_id, { calendarId: m.calendar_id, calendarTitle: m.calendar_title, calendarHash: m.calendar_hash, meetings: [] })
                        }
                        grouped.get(m.calendar_id)!.meetings.push(m)
                      })
                      const sortNow = Date.now()
                      const getMeetingTime = (m: MeetingOption) =>
                        m.time_slots?.[0] ? new Date(m.time_slots[0] + ':00Z').getTime() : new Date(m.start_time).getTime()

                      // Sort individual meetings within each group: earliest upcoming first, then past descending
                      const allGroups = Array.from(grouped.values())
                      allGroups.forEach(group => {
                        group.meetings.sort((a, b) => {
                          const aT = getMeetingTime(a)
                          const bT = getMeetingTime(b)
                          const aUpcoming = aT >= sortNow
                          const bUpcoming = bT >= sortNow
                          // Upcoming meetings first, sorted ascending (earliest first)
                          if (aUpcoming && bUpcoming) return aT - bT
                          if (aUpcoming && !bUpcoming) return -1
                          if (!aUpcoming && bUpcoming) return 1
                          // Past meetings: most recent first
                          return bT - aT
                        })
                      })

                      // Sort calendar groups: calendars with upcoming meetings first (by earliest upcoming),
                      // then calendars with only past meetings at the bottom (by most recent past meeting desc)
                      allGroups.sort((a, b) => {
                        // Selected calendars (pinned at expand-time) float to top
                        const aHasPinned = a.meetings.some(m => pinnedMeetingIdsRef.current.has(m.id))
                        const bHasPinned = b.meetings.some(m => pinnedMeetingIdsRef.current.has(m.id))
                        if (aHasPinned !== bHasPinned) return aHasPinned ? -1 : 1
                        // Find earliest upcoming meeting per calendar
                        const aNextUpcoming = a.meetings.find(m => getMeetingTime(m) >= sortNow)
                        const bNextUpcoming = b.meetings.find(m => getMeetingTime(m) >= sortNow)
                        // Calendars with upcoming meetings come before those without
                        if (aNextUpcoming && !bNextUpcoming) return -1
                        if (!aNextUpcoming && bNextUpcoming) return 1
                        // Both have upcoming: sort by earliest upcoming ascending
                        if (aNextUpcoming && bNextUpcoming) {
                          return getMeetingTime(aNextUpcoming) - getMeetingTime(bNextUpcoming)
                        }
                        // Both past-only: sort by most recent past meeting descending
                        const aLatest = getMeetingTime(a.meetings[0])
                        const bLatest = getMeetingTime(b.meetings[0])
                        return bLatest - aLatest
                      })

                      // Split into active vs archived (>32 days since last meeting) when >4 calendars
                      const ARCHIVE_THRESHOLD = 32 * 24 * 60 * 60 * 1000
                      let activeGroups = allGroups
                      let archivedGroups: typeof allGroups = []
                      if (allGroups.length > 4) {
                        activeGroups = []
                        archivedGroups = []
                        for (const group of allGroups) {
                          // Find the most recent meeting time in this group
                          const latestTime = Math.max(...group.meetings.map(getMeetingTime))
                          if (sortNow - latestTime > ARCHIVE_THRESHOLD) {
                            archivedGroups.push(group)
                          } else {
                            activeGroups.push(group)
                          }
                        }
                      }

                      const renderCalendarGroup = (group: typeof allGroups[0]) => {
                        const allSelected = group.meetings.every(m => selectedMeetingIds.has(m.id))
                        const someSelected = group.meetings.some(m => selectedMeetingIds.has(m.id))
                        const calendarSelected = selectedCalendarIds.has(group.calendarId)
                        // Checked when calendar is selected (with or without meetings)
                        const isChecked = calendarSelected || allSelected
                        // Indeterminate when some meetings selected OR calendar selected without all meetings
                        const isIndeterminate = (someSelected && !allSelected) || (calendarSelected && !allSelected)
                        const meetingsCollapsed = collapsedCalendarMeetings.has(group.calendarId)
                        return (
                          <div key={group.calendarId}>
                            {/* Calendar-level checkbox */}
                            <label className="flex items-center gap-2 py-1 cursor-pointer hover:bg-muted/30 rounded px-1 -mx-1">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                ref={el => { if (el) el.indeterminate = isIndeterminate }}
                                onChange={() => toggleCalendarMeetings(group.calendarId)}
                                className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                              />
                              <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
                              <span className="text-sm font-medium">{group.calendarTitle}</span>
                              <button
                                type="button"
                                onClick={e => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  setCollapsedCalendarMeetings(prev => {
                                    const next = new Set(prev)
                                    if (next.has(group.calendarId)) next.delete(group.calendarId)
                                    else next.add(group.calendarId)
                                    return next
                                  })
                                }}
                                className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground rounded px-1 -mx-0.5 transition-colors"
                                aria-label={meetingsCollapsed ? 'Expand meetings' : 'Collapse meetings'}
                                aria-expanded={!meetingsCollapsed}
                              >
                                <span>({group.meetings.length} meeting{group.meetings.length !== 1 ? 's' : ''})</span>
                                {meetingsCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                              </button>
                              {calendarSelected && !someSelected && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">Calendar only</span>
                              )}
                            </label>
                            {/* Individual meeting checkboxes */}
                            {!meetingsCollapsed && (
                            <div className="ml-6 space-y-0.5">
                              {group.meetings.map(m => {
                                // Prefer time_slots (raw grid coordinates) over start_time
                                const d = m.time_slots?.[0]
                                  ? new Date(m.time_slots[0] + ':00Z')
                                  : new Date(m.start_time)
                                const isChecked = selectedMeetingIds.has(m.id)
                                return (
                                  <label key={m.id} className={`flex items-start gap-2 py-1 px-1 -mx-1 rounded cursor-pointer transition-colors ${
                                    isChecked ? 'bg-primary/5' : 'hover:bg-muted/30'
                                  }`}>
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={e => toggleMeetingContext(m.id, e.target.checked)}
                                      className="w-4 h-4 mt-0.5 rounded border-border text-primary focus:ring-primary"
                                    />
                                    <div className="flex-1 min-w-0">
                                      <div className="text-xs text-muted-foreground">
                                        {formatDateTimeDDMMYYYY(d)} · {m.duration_minutes} min
                                      </div>
                                    </div>
                                  </label>
                                )
                              })}
                            </div>
                            )}
                          </div>
                        )
                      }

                      return (
                        <>
                          {activeGroups.map(renderCalendarGroup)}
                          {archivedGroups.length > 0 && (
                            <div className="border-t border-border pt-2 mt-2">
                              <button
                                type="button"
                                onClick={() => setArchivedCalendarsExpanded(p => !p)}
                                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
                              >
                                {archivedCalendarsExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                <span>Show {archivedGroups.length} more where last meeting is more than 32 days ago</span>
                              </button>
                              {archivedCalendarsExpanded && (
                                <div className="mt-1.5 space-y-2">
                                  {archivedGroups.map(renderCalendarGroup)}
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )
                    })()}

                    {/* Meetingless calendars — planning stage */}
                    {meetinglessCalendars.length > 0 && (
                      <>
                        {meetings.length > 0 && (
                          <div className="border-t border-border pt-2 mt-2">
                            <p className="text-xs text-muted-foreground mb-1.5">Calendars without meetings (planning stage)</p>
                          </div>
                        )}
                        {[...meetinglessCalendars].sort((a, b) => {
                          // Pinned (selected at expand-time) float to top
                          const aP = pinnedCalendarIdsRef.current.has(a.id) ? 0 : 1
                          const bP = pinnedCalendarIdsRef.current.has(b.id) ? 0 : 1
                          return aP - bP
                        }).map(cal => {
                          const participants = calendarParticipants[cal.id] || []
                          const isChecked = selectedCalendarIds.has(cal.id)
                          return (
                            <label key={cal.id} className={`flex items-start gap-2 py-1 px-1 -mx-1 rounded cursor-pointer transition-colors ${
                              isChecked ? 'bg-primary/5' : 'hover:bg-muted/30'
                            }`}>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={e => toggleCalendarSelection(cal.id, e.target.checked)}
                                className="w-4 h-4 mt-0.5 rounded border-border text-primary focus:ring-primary"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
                                  <span className="text-sm font-medium">{cal.title}</span>
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium">Planning</span>
                                </div>
                                {participants.length > 0 && (
                                  <div className="text-xs text-muted-foreground mt-0.5">
                                    {participants.length} participant{participants.length !== 1 ? 's' : ''}: {participants.slice(0, 5).join(', ')}{participants.length > 5 ? `, +${participants.length - 5} more` : ''}
                                  </div>
                                )}
                                {participants.length === 0 && (
                                  <div className="text-xs text-muted-foreground/60 mt-0.5">No participants yet</div>
                                )}
                              </div>
                            </label>
                          )
                        })}
                      </>
                    )}

                    {meetings.length === 0 && meetinglessCalendars.length === 0 && (
                      <p className="text-xs text-muted-foreground py-2">No coordination calendars found.</p>
                    )}
                  </div>
                )}
              </div>
              )
            })()}

            {/* Meeting context field toggles — appears when any calendar item is selected.
                When only calendars (no meetings) are selected, the meeting-specific fields
                (description, date/time, meeting link, add-to-calendar) are hidden because
                a calendar is not a meeting. The Onboarding Link toggle is always offered
                when at least one calendar is selected (it gracefully no-ops if the calendar
                has no onboarding URL configured). */}
            {(selectedMeetingIds.size > 0 || selectedCalendarIds.size > 0) && !sending && (() => {
              const hasMeetings = selectedMeetingIds.size > 0
              const hasCalendars = selectedCalendarIds.size > 0

              type FieldKey = 'title' | 'description' | 'dateTime' | 'meetingLink' | 'addToCalendar' | 'onboardingLink'
              const allFields: { key: FieldKey; label: string; icon: string; desc: string }[] = [
                { key: 'title', label: 'Title', icon: '\ud83c\udfaf', desc: 'Meeting or calendar name' },
                { key: 'description', label: 'Description', icon: '\ud83d\udcdd', desc: 'Meeting description text' },
                { key: 'dateTime', label: 'Date & Time', icon: '\ud83d\udd50', desc: 'Start/end time and duration' },
                { key: 'meetingLink', label: 'Meeting Link', icon: '\ud83d\udd17', desc: 'Video/call link' },
                { key: 'addToCalendar', label: 'Add to Calendar', icon: '\ud83d\udcc5', desc: 'Calendar invite link' },
                { key: 'onboardingLink', label: 'Onboarding Link', icon: '\ud83e\udded', desc: 'Link to add availability to calendar' },
              ]
              // When no meeting is selected, only show fields relevant to a calendar:
              // Title and Onboarding Link. The Onboarding Link toggle is always offered
              // whenever at least one calendar is selected -- if the calendar has no
              // onboarding URL configured, the body builder will simply skip emission.
              const visibleFields = hasMeetings
                ? allFields.filter(f => f.key !== 'onboardingLink' || hasCalendars)
                : allFields.filter(f => f.key === 'title' || f.key === 'onboardingLink')

              const activeCount = visibleFields.filter(f => meetingContextFields[f.key]).length
              return (
              <div className="border border-border rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setContextFieldsExpanded(!contextFieldsExpanded)}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium hover:bg-muted/50 transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    <ListChecks className="w-4 h-4" />
                    {hasMeetings ? 'Customize Meeting Context Fields' : 'Customize Calendar Context Fields'}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      ({activeCount}/{visibleFields.length})
                    </span>
                  </span>
                  {contextFieldsExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
                {contextFieldsExpanded && (
                  <div className="border-t border-border px-3 py-2 space-y-1">
                    <p className="text-xs text-muted-foreground mb-2">
                      {hasMeetings
                        ? 'Toggle which fields are included in the meeting context output.'
                        : 'No meetings selected -- only calendar-level fields are available. A calendar is not a meeting, so meeting-specific fields are hidden.'}
                    </p>
                    {visibleFields.map(field => (
                      <label
                        key={field.key}
                        className={`flex items-center gap-2 py-1.5 px-2 -mx-1 rounded cursor-pointer transition-colors ${
                          meetingContextFields[field.key] ? 'bg-primary/5' : 'hover:bg-muted/30'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={meetingContextFields[field.key] ?? true}
                          onChange={e => setMeetingContextFields(prev => ({ ...prev, [field.key]: e.target.checked }))}
                          className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                        />
                        <span className="text-sm">{field.icon}</span>
                        <span className="text-sm font-medium">{field.label}</span>
                        <span className="text-xs text-muted-foreground">- {field.desc}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              )
            })()}

            {/* Body */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium">Message Body</label>
                <div className="relative" ref={bodyEmojiPickerRef}>
                  <button
                    type="button"
                    onClick={() => setShowBodyEmojiPicker(p => !p)}
                    disabled={sending}
                    className={`p-1.5 rounded-lg transition-colors ${showBodyEmojiPicker ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted'} disabled:opacity-50`}
                    title="Insert emoji"
                  >
                    <Smile className="w-4 h-4" />
                  </button>
                  {showBodyEmojiPicker && (
                    <div className="absolute right-0 top-full mt-1 z-50">
                      <EmojiPicker
                        onSelect={(emoji) => {
                          const ta = bodyRef.current
                          if (ta) {
                            const start = ta.selectionStart ?? composeBody.length
                            const end = ta.selectionEnd ?? composeBody.length
                            const before = composeBody.slice(0, start)
                            const after = composeBody.slice(end)
                            const newBody = before + emoji + after
                            setComposeBody(newBody)
                            // Restore focus and cursor position after emoji
                            requestAnimationFrame(() => {
                              ta.focus()
                              const newPos = start + emoji.length
                              ta.setSelectionRange(newPos, newPos)
                            })
                          } else {
                            setComposeBody(prev => prev + emoji)
                          }
                        }}
                        onClose={() => setShowBodyEmojiPicker(false)}
                      />
                    </div>
                  )}
                </div>
              </div>
              <textarea
                ref={bodyRef}
                value={composeBody}
                onChange={e => setComposeBody(e.target.value)}
                placeholder="Write your announcement message here..."
                rows={bodyRows}
                className={`w-full px-3 py-2 border rounded-lg text-sm bg-background text-foreground focus:ring-2 focus:ring-ring outline-none resize-y ${composeBody.length > 1800 ? 'border-red-500 dark:border-red-400' : 'border-input'}`}
                disabled={sending}
              />
              <div className="flex items-center justify-between mt-1">
                <p className="text-xs text-muted-foreground">
                  Supports basic Discord markdown: **bold**, *italic*, `code`, etc.
                </p>
                <div className="flex items-center gap-2">
                  <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${composeBody.length > 1800 ? 'bg-red-500' : composeBody.length > 1500 ? 'bg-amber-500' : composeBody.length > 1200 ? 'bg-yellow-400' : 'bg-emerald-500'}`}
                      style={{ width: `${Math.min(100, (composeBody.length / 1800) * 100)}%` }}
                    />
                  </div>
                  <span className={`text-xs font-mono tabular-nums ${composeBody.length > 1800 ? 'text-red-500 dark:text-red-400 font-semibold' : composeBody.length > 1500 ? 'text-amber-500 dark:text-amber-400' : 'text-muted-foreground'}`}>
                    {composeBody.length}/1800
                  </span>
                </div>
              </div>
              {composeBody.length > 1800 && (
                <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">
                  {composeBody.length - 1800} character{composeBody.length - 1800 === 1 ? '' : 's'} over the limit -- message will be rejected
                </p>
              )}
            </div>



            {/* Additional DM Body */}
            {(dmRows.length > 0 || composeDmBody) && (
              <div>
                <button
                  type="button"
                  onClick={() => setDmBodyExpanded(p => !p)}
                  disabled={sending}
                  className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {dmBodyExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <Users className="w-4 h-4" />
                  Additional Message for Direct Recipients
                  {composeDmBody.trim() && (
                    <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-normal">
                      Active
                    </span>
                  )}
                </button>
                {dmBodyExpanded && (
                  <div className="mt-2 pl-6">
                    <div className="relative">
                      <textarea
                        ref={dmBodyRef}
                        value={composeDmBody}
                        onChange={e => setComposeDmBody(e.target.value)}
                        placeholder="Extra content appended only to direct messages -- leave empty to send the same body to everyone..."
                        rows={3}
                        className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:ring-2 focus:ring-ring outline-none resize-y"
                        disabled={sending}
                      />
                      <div className="absolute top-1.5 right-1.5">
                        <button
                          type="button"
                          onClick={() => setShowDmBodyEmojiPicker(p => !p)}
                          disabled={sending}
                          className={`p-1 rounded transition-colors ${showDmBodyEmojiPicker ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/80'} disabled:opacity-50`}
                          title="Insert emoji"
                        >
                          <Smile className="w-3.5 h-3.5" />
                        </button>
                        {showDmBodyEmojiPicker && (
                          <div className="absolute right-0 top-full mt-1 z-50">
                            <EmojiPicker
                              onSelect={(emoji) => {
                                const ta = dmBodyRef.current
                                if (ta) {
                                  const start = ta.selectionStart ?? composeDmBody.length
                                  const end = ta.selectionEnd ?? composeDmBody.length
                                  const before = composeDmBody.slice(0, start)
                                  const after = composeDmBody.slice(end)
                                  setComposeDmBody(before + emoji + after)
                                  requestAnimationFrame(() => {
                                    ta.focus()
                                    const newPos = start + emoji.length
                                    ta.setSelectionRange(newPos, newPos)
                                  })
                                } else {
                                  setComposeDmBody(prev => prev + emoji)
                                }
                              }}
                              onClose={() => setShowDmBodyEmojiPicker(false)}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      This text is appended after the main message -- only for DM recipients. Channel posts use the main body only.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Poll Builder */}
            <div>
              <div className="flex items-center gap-3 mb-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pollEnabled}
                    onChange={() => setPollEnabled(!pollEnabled)}
                    disabled={sending}
                    className="w-4 h-4 rounded border-border text-primary focus:ring-ring"
                  />
                  <span className="text-sm font-medium flex items-center gap-1.5">
                    <ListChecks className="w-4 h-4" />
                    Enable Reaction Poll
                  </span>
                </label>
                {pollEnabled && (
                  <span className="text-xs text-muted-foreground">
                    No deadline — members vote by clicking reactions anytime
                  </span>
                )}
              </div>

              {pollEnabled && (
                <div className="border border-border rounded-lg p-4 space-y-3">
                  <div className="space-y-2">
                    {pollOptions.map((option, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <div className="relative" ref={emojiPickerIdx === idx ? emojiPickerRef : undefined}>
                          <button
                            type="button"
                            onClick={() => setEmojiPickerIdx(prev => prev === idx ? null : idx)}
                            className="w-12 h-10 text-center border border-input rounded-lg text-sm bg-background text-foreground hover:bg-muted focus:ring-2 focus:ring-ring outline-none cursor-pointer transition-colors disabled:opacity-50"
                            disabled={sending}
                            title="Click to pick an emoji"
                          >
                            {option.emoji || '🔵'}
                          </button>
                          {emojiPickerIdx === idx && (
                            <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg p-2 w-[280px]">
                              <div className="grid grid-cols-8 gap-1">
                                {EMOJI_PICKER_OPTIONS.map(em => (
                                  <button
                                    key={em}
                                    type="button"
                                    onClick={() => {
                                      const updated = [...pollOptions]
                                      updated[idx] = { ...updated[idx], emoji: em }
                                      setPollOptions(updated)
                                      setEmojiPickerIdx(null)
                                    }}
                                    className={`w-8 h-8 flex items-center justify-center rounded hover:bg-muted text-base transition-colors ${option.emoji === em ? 'bg-primary/20 ring-1 ring-primary' : ''}`}
                                    title={em}
                                  >
                                    {em}
                                  </button>
                                ))}
                              </div>
                              <div className="mt-2 pt-2 border-t border-border">
                                <input
                                  type="text"
                                  value={option.emoji}
                                  onChange={e => {
                                    const updated = [...pollOptions]
                                    updated[idx] = { ...updated[idx], emoji: e.target.value }
                                    setPollOptions(updated)
                                  }}
                                  placeholder="Custom emoji..."
                                  className="w-full px-2 py-1 text-xs border border-input rounded bg-background text-foreground focus:ring-1 focus:ring-ring outline-none"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                        <input
                          type="text"
                          value={option.text}
                          onChange={e => {
                            const updated = [...pollOptions]
                            updated[idx] = { ...updated[idx], text: e.target.value }
                            setPollOptions(updated)
                          }}
                          placeholder={`Option ${idx + 1}`}
                          className="flex-1 px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:ring-2 focus:ring-ring outline-none"
                          disabled={sending}
                        />
                        {pollOptions.length > 2 && (
                          <button
                            onClick={() => setPollOptions(prev => prev.filter((_, i) => i !== idx))}
                            disabled={sending}
                            className="p-2 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                            title="Remove option"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  {pollOptions.length < 10 && (
                    <button
                      onClick={() => {
                        const nextEmoji = DEFAULT_POLL_EMOJIS[pollOptions.length] || '🔵'
                        setPollOptions(prev => [...prev, { emoji: nextEmoji, text: '' }])
                      }}
                      disabled={sending}
                      className="flex items-center gap-1.5 text-xs text-primary hover:underline disabled:opacity-50"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Option ({pollOptions.length}/10)
                    </button>
                  )}

                  <p className="text-xs text-muted-foreground">
                    The bot will add these emojis as reactions after posting. Members vote by clicking reactions. Click the emoji button to pick from common emojis, or type a custom one.
                  </p>
                </div>
              )}
            </div>

            {/* ── Distribution Table ── */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <label className="text-sm font-medium">Distribution Targets</label>
                {distributionRows.length > 0 && (
                  <button
                    onClick={() => setDistSelectedOnly(prev => !prev)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-all whitespace-nowrap shadow-sm ${
                      distSelectedOnly
                        ? 'border border-green-500 bg-green-500 text-white dark:bg-green-600 dark:border-green-600 hover:bg-green-600 dark:hover:bg-green-700'
                        : 'border border-primary bg-primary/10 text-primary hover:bg-primary/20 dark:border-primary dark:text-primary dark:hover:bg-primary/20'
                    }`}
                  >
                    <Check className={`w-3.5 h-3.5 ${distSelectedOnly ? 'text-white' : 'text-primary'}`} />
                    {distSelectedOnly ? 'Show All' : 'Hide Unselected'}
                  </button>
                )}
              </div>

              {distSelectedOnly && distributionRows.filter(r => r.selected).length === 0 ? null : distributionRows.length === 0 ? (
                <div className="border border-border rounded-lg p-6 text-center">
                  <Hash className="w-6 h-6 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {!integration?.bot_verified
                      ? 'Connect Discord first to see available channels.'
                      : 'No channels found. Sync channels from the Discord tab.'}
                  </p>
                </div>
              ) : (
                <div className="border border-border rounded-lg overflow-hidden">
                  {/* Table header */}
                  <div className="grid grid-cols-[32px_100px_1fr_1fr_100px_1fr] gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground border-b border-border">
                    <div>
                      {(() => {
                        const selectableRows = distributionRows.filter(r => r.bot_can_send && r.user_can_send)
                        const allSelected = selectableRows.length > 0 && selectableRows.every(r => r.selected)
                        const someSelected = selectableRows.some(r => r.selected)
                        return (
                          <input
                            type="checkbox"
                            checked={allSelected}
                            ref={el => { if (el) el.indeterminate = someSelected && !allSelected }}
                            onChange={() => {
                              setDistributionRows(prev => prev.map(r => {
                                if (r.bot_can_send && r.user_can_send) {
                                  return { ...r, selected: !allSelected }
                                }
                                return r
                              }))
                            }}
                            disabled={sending || selectableRows.length === 0}
                            className="w-4 h-4 rounded border-border text-primary focus:ring-ring cursor-pointer disabled:cursor-not-allowed"
                          />
                        )
                      })()}
                    </div>
                    <div>Integration</div>
                    <div>Server</div>
                    <div>Channel</div>
                    <div>Status</div>
                    <div>Details</div>
                  </div>
                  {/* Table rows */}
                  <div className="divide-y divide-border">
                    {distributionRows.filter(row => !distSelectedOnly || row.selected).map(row => {
                      const statusConfig = {
                        composing: { icon: Pencil, color: 'text-muted-foreground', bg: '' },
                        scheduled: { icon: Clock, color: 'text-blue-500', bg: 'bg-blue-50/50 dark:bg-blue-950/30' },
                        sending: { icon: Loader2, color: 'text-yellow-500', bg: 'bg-yellow-50/50 dark:bg-yellow-950/30' },
                        sent: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-50/50 dark:bg-green-950/30' },
                        failed: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-50/50 dark:bg-red-950/30' },
                      }[row.status]
                      const StatusIcon = statusConfig.icon

                      return (
                        <div
                          key={row.channel_id}
                          className={`grid grid-cols-[32px_100px_1fr_1fr_100px_1fr] gap-2 px-3 py-2.5 items-center text-sm ${statusConfig.bg} ${(!row.bot_can_send || !row.user_can_send) ? 'opacity-70' : ''}`}
                        >
                          {/* Checkbox */}
                          <div>
                            <input
                              type="checkbox"
                              checked={row.selected}
                              onChange={() => toggleRowSelected(row.channel_id)}
                              disabled={sending || ((!row.bot_can_send || !row.user_can_send) && row.status === 'composing')}
                              className="w-4 h-4 rounded border-border text-primary focus:ring-ring cursor-pointer disabled:cursor-not-allowed"
                            />
                          </div>
                          {/* Integration */}
                          <div className="flex items-center gap-1.5">
                            <Bot className="w-3.5 h-3.5 text-[#5865F2]" />
                            <span className="text-xs">{row.integration}</span>
                          </div>
                          {/* Server */}
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span className="truncate text-xs">{row.guild_name}</span>
                          </div>
                          {/* Channel */}
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Hash className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span className="truncate text-xs">{row.channel_name}</span>
                            {(!row.bot_can_send || !row.user_can_send) && (
                              <span title={!row.bot_can_send && !row.user_can_send ? 'Neither you nor the bot can send here' : !row.bot_can_send ? 'Bot lacks permission' : 'You lack permission'}>
                                <ShieldAlert className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                              </span>
                            )}
                            {row.bot_can_send && row.user_can_send && row.status === 'composing' && (
                              <span title="Both you and the bot can send here"><ShieldCheck className="w-3 h-3 text-green-500 shrink-0" /></span>
                            )}
                          </div>
                          {/* Status */}
                          <div className="flex items-center gap-1.5">
                            <StatusIcon className={`w-3.5 h-3.5 ${statusConfig.color} ${row.status === 'sending' ? 'animate-spin' : ''}`} />
                            <span className={`text-xs capitalize ${statusConfig.color}`}>{row.status}</span>
                          </div>
                          {/* Details */}
                          <div className="min-w-0">
                            <span className={`text-xs truncate block ${row.status === 'failed' ? 'text-red-500' : 'text-muted-foreground'}`} title={row.status_msg}>
                              {row.status_msg}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  {/* Summary footer */}
                  <div className="px-3 py-2 bg-muted/30 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {distributionRows.some(r => !r.bot_can_send || !r.user_can_send) && (
                        <span className="text-amber-500">
                          {distributionRows.filter(r => !r.bot_can_send || !r.user_can_send).length} without full permission
                        </span>
                      )}
                    </span>
                    {(distributionRows.some(r => r.status === 'sent' || r.status === 'failed')) && (
                      <span>
                        {distributionRows.filter(r => r.status === 'sent').length} sent,{' '}
                        {distributionRows.filter(r => r.status === 'failed').length} failed
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Meeting Participants — names from currently attached meeting calendars */}
            {(() => {
              const meetingCalendarIds = new Set(
                meetings.filter(m => selectedMeetingIds.has(m.id)).map(m => m.calendar_id)
              )
              const participantNames = Array.from(meetingCalendarIds)
                .flatMap(calId => calendarParticipants[calId] || [])
                .filter((name, i, arr) => arr.indexOf(name) === i)
                .sort((a, b) => a.localeCompare(b))

              if (participantNames.length === 0) return null

              const copyAll = async () => {
                await navigator.clipboard.writeText(participantNames.join(', '))
                setParticipantsCopied(true)
                setTimeout(() => setParticipantsCopied(false), 2000)
              }

              return (
                <div className="border border-border rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setParticipantPanelExpanded(p => !p)}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
                  >
                    <span className="flex items-center gap-1.5">
                      <Tags className="w-3.5 h-3.5" />
                      Meeting Participants
                      <span className="bg-muted text-foreground px-1.5 py-0.5 rounded-full text-[10px]">{participantNames.length}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground/70">Expand for details</span>
                      {participantPanelExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </span>
                  </button>
                  {participantPanelExpanded && (
                    <div className="border-t border-border px-3 py-2.5 bg-muted/20 space-y-2">
                      <div className="flex flex-wrap gap-1.5">
                        {participantNames.map(name => (
                          <span
                            key={name}
                            className="inline-block px-2.5 py-1 rounded-full border border-border bg-background text-sm text-foreground cursor-text select-text"
                            style={{ userSelect: 'all' }}
                            title="Double-click to select full name, then Ctrl+C to copy"
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                      <div className="flex items-center gap-3 pt-1">
                        <button
                          onClick={copyAll}
                          className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                          title="Copy all names as comma-separated list"
                        >
                          {participantsCopied
                            ? <><ClipboardCheck className="w-3.5 h-3.5 text-green-500" /><span className="text-green-500">Copied!</span></>
                            : <><Clipboard className="w-3.5 h-3.5" />Copy all names</>}
                        </button>
                        <button
                          onClick={() => findAndSelectMembers(participantNames.join(', '))}
                          className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                          title="Find matching Discord members and select them for DMs"
                        >
                          <Search className="w-3.5 h-3.5" />
                          Find &amp; Select in DMs
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}

            {/* ── DM Recipients ── */}
            {integration?.bot_verified && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium">Direct Message Recipients</label>
                    {dmRows.length > 0 && (
                      <button
                        onClick={() => setDmSelectedOnly(prev => {
                          if (!prev) setDmSearchQuery('')
                          return !prev
                        })}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-all whitespace-nowrap shadow-sm ${
                          dmSelectedOnly
                            ? 'border border-green-500 bg-green-500 text-white dark:bg-green-600 dark:border-green-600 hover:bg-green-600 dark:hover:bg-green-700'
                            : 'border border-primary bg-primary/10 text-primary hover:bg-primary/20 dark:border-primary dark:text-primary dark:hover:bg-primary/20'
                        }`}
                      >
                        <Check className={`w-3.5 h-3.5 ${dmSelectedOnly ? 'text-white' : 'text-primary'}`} />
                        {dmSelectedOnly ? 'Show All' : 'Hide Unselected'}
                      </button>
                    )}
                    <div className="relative">
                      <button
                        onClick={() => setShowDmTooltip(!showDmTooltip)}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        title="About DM recipients"
                      >
                        <Info className="w-3.5 h-3.5" />
                      </button>
                      {showDmTooltip && (
                        <div className="absolute left-0 top-6 z-10 w-80 p-3 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg text-xs space-y-1.5">
                          <p>The bot can send DMs to users who share a server where the bot is present.</p>
                          <p>Recipients can opt out via a button on each message. Opted-out users appear greyed out.</p>
                          <p className="font-medium">Rate limits:</p>
                          <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">
                            <li>Bot uses graduated delays (150-600ms) + periodic cool-down pauses</li>
                            <li>Discord may throttle above ~{DM_RATE_LIMIT_WARN} unique DMs/session</li>
                            <li>Above ~{DM_RATE_LIMIT_DANGER} DMs, expect significant rate limiting</li>
                            <li>Platform max: {DM_RATE_LIMIT_MAX.toLocaleString()} DMs per send operation{isAdmin && ' (admin)'}</li>
                          </ul>
                          {dmRows.length > 0 && dmRows.filter(r => r.selected && !r.opted_out).length > 0 && (
                            <p className="text-muted-foreground">
                              Current selection: {dmRows.filter(r => r.selected && !r.opted_out).length} recipients
                              (~{Math.max(1, estimateDmMinutes(dmRows.filter(r => r.selected && !r.opted_out).length))} min estimated)
                            </p>
                          )}
                          <button onClick={() => setShowDmTooltip(false)} className="text-primary hover:underline mt-1">Dismiss</button>
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={fetchDmMembers}
                    disabled={loadingDmMembers}
                    className="flex items-center gap-1.5 text-xs text-primary hover:underline disabled:opacity-50"
                  >
                    {loadingDmMembers ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    {dmMembers.length > 0 ? 'Refresh' : 'Load Members'}
                  </button>
                </div>

                {/* Scan status indicator */}
                {dmScanInfo.message && (
                  <div className={`flex items-center gap-2 px-3 py-2 mb-2 rounded-lg border text-xs ${
                    dmScanInfo.type === 'checking_subscriptions'
                      ? 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                      : dmScanInfo.type === 'loading_members'
                      ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
                      : dmScanInfo.message.startsWith('No invite')
                      ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
                      : 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                  }`}>
                    {dmScanInfo.type === 'checking_subscriptions' && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
                    {dmScanInfo.type === 'loading_members' && <Users className="w-3.5 h-3.5 shrink-0" />}
                    {dmScanInfo.type === 'idle' && dmScanInfo.message.startsWith('No invite') && <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
                    {dmScanInfo.type === 'idle' && !dmScanInfo.message.startsWith('No invite') && !dmScanInfo.message.startsWith('Failed') && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
                    {dmScanInfo.type === 'idle' && dmScanInfo.message.startsWith('Failed') && <XCircle className="w-3.5 h-3.5 shrink-0" />}
                    <span>{dmScanInfo.message}</span>
                    {dmScanInfo.debug && (
                      <button
                        onClick={() => {
                          console.log('[DM Scan Debug]', dmScanInfo.debug)
                          const d = dmScanInfo.debug as Record<string, unknown>
                          const src = d.sources as Record<string, Record<string, unknown>> | undefined
                          const sampleIds = (d.sampleRecipientIds as string[] | undefined) || []
                          const _unmatchedRows = dmRows.filter(r => {
                            const statuses = (window as unknown as Record<string, unknown>)._lastDmStatuses as Record<string, string> | undefined
                            return statuses ? !statuses[r.user_id] : false
                          })
                          console.log('[DM Scan Debug] Sample status IDs from delivery log:', sampleIds)
                          console.log('[DM Scan Debug] Sample member list user_ids:', dmRows.slice(0, 5).map(r => r.user_id))
                          console.log('[DM Scan Debug] Unmatched rows (Ready):', dmRows.filter(r => r.status_msg === 'Ready to receive message').slice(0, 5).map(r => ({ user_id: r.user_id, display_name: r.display_name })))
                          showToast(`Schedules: ${src?.deliveryLog?.schedules ?? 0}, Delivery rows: ${src?.deliveryLog?.rows ?? 0}, Invites: ${src?.invites?.rows ?? 0}, Opt-outs: ${src?.optOuts?.count ?? 0} | Matched ${d.uniqueRecipients ?? 0} of ${dmRows.length} members. Sample IDs logged to console.`, 'info')
                        }}
                        className="ml-auto text-[10px] underline opacity-70 hover:opacity-100 shrink-0"
                      >
                        Debug
                      </button>
                    )}
                  </div>
                )}

                {dmCancelled ? (
                  <div className="border border-green-200 dark:border-green-800 rounded-lg p-4 bg-green-50 dark:bg-green-950/40 text-center space-y-1">
                    <CheckCircle2 className="w-5 h-5 mx-auto text-green-600 dark:text-green-400 mb-1" />
                    <p className="text-sm font-medium text-green-700 dark:text-green-300">Not using Direct Messages in this compose message</p>
                    <p className="text-xs text-green-600 dark:text-green-400">Refresh the page or click "Load Members" above to re-enable DM features.</p>
                  </div>
                ) : dmMembers.length === 0 && !loadingDmMembers ? (
                  <div className="border border-border rounded-lg p-4 text-center">
                    <Users className="w-5 h-5 mx-auto text-muted-foreground mb-1.5" />
                    <p className="text-xs text-muted-foreground">
                      Click "Load Members" to see users you can DM through shared servers with the bot.
                    </p>
                  </div>
                ) : loadingDmMembers && dmMembers.length === 0 ? (
                  <div className="border border-border rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                        {dmLoadPhase === 'phase1' ? (
                          <span className="text-xs text-muted-foreground">Loading recent recipients...</span>
                        ) : dmProgress ? (
                          <span className="text-xs text-muted-foreground">
                            Scanning {dmProgress.guildNames.length} server{dmProgress.guildNames.length !== 1 ? 's' : ''} -- checked {dmProgress.checked.toLocaleString()} of ~{dmProgress.total.toLocaleString()} members, found {dmProgress.found.toLocaleString()} so far
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Connecting to bot...</span>
                        )}
                      </div>
                      <button
                        onClick={cancelDmLoading}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                      >
                        <X className="w-3 h-3" />
                        Cancel
                      </button>
                    </div>
                    {dmProgress && dmProgress.total > 0 && (
                      <>
                        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all duration-300"
                            style={{ width: `${Math.min(100, (dmProgress.checked / dmProgress.total) * 100)}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-xs text-muted-foreground/70">
                          <span>{dmProgress.guildNames.join(', ')}</span>
                          <span>{Math.round((dmProgress.checked / dmProgress.total) * 100)}%</span>
                        </div>
                      </>
                    )}
                  </div>
                ) : dmSelectedOnly && dmRows.filter(r => r.selected).length === 0 ? null : (
                  <div className="border border-border rounded-lg overflow-hidden">
                    {/* ── DM Rate Limit Warning Banner ── */}
                    {(() => {
                      const selectedCount = dmRows.filter(r => r.selected && !r.opted_out).length
                      if (selectedCount === 0) return null
                      const level = selectedCount > DM_RATE_LIMIT_MAX ? 'block'
                        : selectedCount > DM_RATE_LIMIT_DANGER ? 'danger'
                        : selectedCount > DM_RATE_LIMIT_WARN ? 'warn'
                        : null
                      if (!level) return null
                      const estMinutes = estimateDmMinutes(selectedCount)
                      return (
                        <div className={`px-3 py-2 flex items-start gap-2 text-xs border-b ${
                          level === 'block'
                            ? 'bg-red-100 dark:bg-red-950/40 border-red-300 dark:border-red-800 text-red-800 dark:text-red-300'
                            : level === 'danger'
                            ? 'bg-orange-100 dark:bg-orange-950/40 border-orange-300 dark:border-orange-800 text-orange-800 dark:text-orange-300'
                            : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
                        }`}>
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                          <div className="flex-1 space-y-1">
                            {level === 'block' ? (
                              <>
                                <p className="font-semibold">Exceeds platform limit ({DM_RATE_LIMIT_MAX.toLocaleString()} DMs per send)</p>
                                <p>You have selected {selectedCount.toLocaleString()} recipients. The maximum per send operation is {DM_RATE_LIMIT_MAX.toLocaleString()}.{' '}
                                  {isAdmin
                                    ? 'Please reduce your selection or split into multiple batches.'
                                    : 'Please reduce your selection, split into batches, or use the Feedback button to request a higher limit.'}
                                </p>
                              </>
                            ) : level === 'danger' ? (
                              <>
                                <p className="font-semibold">High recipient count -- delivery will be paced</p>
                                <p>Sending {selectedCount.toLocaleString()} DMs (~{estMinutes} min). The bot uses graduated delays and periodic cool-down pauses to avoid Discord anti-spam. Consider splitting into smaller batches for faster delivery.</p>
                              </>
                            ) : (
                              <>
                                <p className="font-semibold">Large batch -- delivery will be paced</p>
                                <p>Sending {selectedCount.toLocaleString()} DMs (~{estMinutes} min). The bot automatically throttles with cool-down pauses to stay within Discord's limits. Monitor delivery status after sending.</p>
                              </>
                            )}
                          </div>
                        </div>
                      )
                    })()}
                    {/* ── Phase 2 Loading Bar (shown while full member list loads in background) ── */}
                    {dmLoadPhase === 'phase2' && !dmSelectedOnly && (
                      <div className="px-3 py-2 border-b border-border bg-blue-50 dark:bg-blue-950/30 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600 dark:text-blue-400 shrink-0" />
                            {dmProgress ? (
                              <span className="text-xs text-blue-700 dark:text-blue-300">
                                Loading all members -- {dmPhase2MemberCount.toLocaleString()} found, scanning {dmProgress.checked.toLocaleString()} of ~{dmProgress.total.toLocaleString()}
                              </span>
                            ) : (
                              <span className="text-xs text-blue-700 dark:text-blue-300">Loading all server members...</span>
                            )}
                          </div>
                          <button
                            onClick={cancelDmLoading}
                            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                          >
                            <X className="w-3 h-3" />
                            Cancel
                          </button>
                        </div>
                        {dmProgress && dmProgress.total > 0 && (
                          <div className="w-full h-1.5 bg-blue-100 dark:bg-blue-900/40 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 dark:bg-blue-400 rounded-full transition-all duration-300"
                              style={{ width: `${Math.min(100, (dmProgress.checked / dmProgress.total) * 100)}%` }}
                            />
                          </div>
                        )}
                      </div>
                    )}
                    {/* ── Filter Bar: Compact (default) or Advanced ── */}
                    <div className="px-3 py-2 border-b border-border bg-muted/30 space-y-2">
                      {/* Row 1: Search + Selected toggle + Advanced toggle */}
                      <div className="flex items-center gap-2">
                        {!dmAdvancedFilters ? (
                          /* Compact mode: unified search */
                          <div className="relative flex-1">
                            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <input
                              type="text"
                              value={dmSearchQuery}
                              onChange={e => setDmSearchQuery(e.target.value)}
                              placeholder={dmLoadPhase === 'phase2' ? 'Search available after full load...' : 'Search by name, username, server, role...'}
                              disabled={dmLoadPhase === 'phase2'}
                              className="w-full pl-8 pr-3 py-1.5 border border-input rounded text-xs bg-background text-foreground focus:ring-1 focus:ring-ring outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                            />
                          </div>
                        ) : (
                          <span className="text-xs font-medium text-muted-foreground">Advanced Filters</span>
                        )}
                        {/* Advanced filters toggle */}
                        <button
                          onClick={() => {
                            setDmAdvancedFilters(prev => !prev)
                            // Clear advanced-only filters when collapsing
                            if (dmAdvancedFilters) {
                              setDmUserFilter('')
                              setDmServerFilter([])
                              setDmStatusFilter([])
                              setDmDetailsFilter([])
                              setDmServerSearch('')
                              setDmRoleFilter([])
                              setRoleSearchQuery('')
                            }
                          }}
                          disabled={dmLoadPhase === 'phase2'}
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 border rounded text-xs transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed ${
                            dmAdvancedFilters
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-input bg-background text-foreground hover:bg-accent/50'
                          }`}
                          title={dmLoadPhase === 'phase2' ? 'Available after full load completes' : 'Toggle advanced filters'}
                        >
                          <SlidersHorizontal className="w-3 h-3" />
                          {dmAdvancedFilters ? 'Simple' : 'Advanced'}
                        </button>
                      </div>

                      {/* ── Advanced Filter Panels ── */}
                      {dmAdvancedFilters && (
                        <div className="space-y-2 pt-1">
                          {/* Row: User filter */}
                          <div>
                            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">User</label>
                            <div className="relative">
                              <Users className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                              <input
                                type="text"
                                value={dmUserFilter}
                                onChange={e => setDmUserFilter(e.target.value)}
                                placeholder="Filter by display name or username..."
                                className="w-full pl-8 pr-3 py-1.5 border border-input rounded text-xs bg-background text-foreground focus:ring-1 focus:ring-ring outline-none"
                              />
                            </div>
                          </div>

                          {/* Row: Server filter — tags if <10 servers, else text search */}
                          <div>
                            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Server</label>
                            {(() => {
                              const uniqueServers = Array.from(new Set(dmRows.flatMap(r => r.guild_names))).sort()
                              if (uniqueServers.length === 0) return <span className="text-xs text-muted-foreground">No servers</span>
                              // Server counts react to status/details/role/search filters but not to the server filter itself
                              const contextRowsForServer = dmRows.filter(applyNonServerFilters)
                              if (uniqueServers.length <= 10) {
                                // Tag mode: toggle each server on/off
                                return (
                                  <div className="flex flex-wrap gap-1">
                                    {uniqueServers.map(server => {
                                      const active = dmServerFilter.includes(server)
                                      const count = contextRowsForServer.filter(r => r.guild_names.includes(server)).length
                                      return (
                                        <button
                                          key={server}
                                          onClick={() => setDmServerFilter(prev => active ? prev.filter(s => s !== server) : [...prev, server])}
                                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                                            active
                                              ? 'border-primary bg-primary/15 text-primary'
                                              : 'border-border bg-background text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                                          }`}
                                        >
                                          <Server className="w-3 h-3" />
                                          <span className="truncate max-w-[140px]">{server}</span>
                                          <span className="text-[9px] opacity-70">({count})</span>
                                        </button>
                                      )
                                    })}
                                    {dmServerFilter.length > 0 && (
                                      <button onClick={() => setDmServerFilter([])} className="text-[10px] text-primary hover:underline self-center ml-1">Clear</button>
                                    )}
                                  </div>
                                )
                              }
                              // Text search mode for many servers
                              return (
                                <div className="space-y-1">
                                  <div className="relative">
                                    <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                    <input
                                      type="text"
                                      value={dmServerSearch}
                                      onChange={e => setDmServerSearch(e.target.value)}
                                      placeholder={`Search ${uniqueServers.length} servers...`}
                                      className="w-full pl-8 pr-3 py-1.5 border border-input rounded text-xs bg-background text-foreground focus:ring-1 focus:ring-ring outline-none"
                                    />
                                  </div>
                                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                                    {uniqueServers
                                      .filter(s => !dmServerSearch.trim() || s.toLowerCase().includes(dmServerSearch.toLowerCase()))
                                      .map(server => {
                                        const active = dmServerFilter.includes(server)
                                        const count = contextRowsForServer.filter(r => r.guild_names.includes(server)).length
                                        return (
                                          <button
                                            key={server}
                                            onClick={() => setDmServerFilter(prev => active ? prev.filter(s => s !== server) : [...prev, server])}
                                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
                                              active
                                                ? 'border-primary bg-primary/15 text-primary'
                                                : 'border-border bg-background text-muted-foreground hover:bg-accent/50'
                                            }`}
                                          >
                                            {server}
                                            <span className="opacity-60">({count})</span>
                                          </button>
                                        )
                                      })}
                                  </div>
                                  {dmServerFilter.length > 0 && (
                                    <div className="flex items-center gap-1">
                                      <span className="text-[10px] text-muted-foreground">{dmServerFilter.length} server(s) selected</span>
                                      <button onClick={() => setDmServerFilter([])} className="text-[10px] text-primary hover:underline">Clear</button>
                                    </div>
                                  )}
                                </div>
                              )
                            })()}
                          </div>

                          {/* Row: Status filter — always tags since there are few statuses */}
                          <div>
                            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Status</label>
                            {(() => {
                              // Count only within rows that pass all OTHER active filters (server, role, search, details)
                              const contextRows = getBaseFilteredDmRows(dmRows)
                              // Always show all possible statuses so tags don't disappear when filtered
                              const allStatuses = ['opted_in', 'opted_out', 'composing']
                              const statusLabels: Record<string, string> = {
                                opted_in: 'Opted In', opted_out: 'Opted Out',
                                composing: 'Composing', scheduled: 'Scheduled', sending: 'Sending',
                                sent: 'Sent', failed: 'Failed',
                              }
                              const statusColors: Record<string, string> = {
                                opted_in: 'text-emerald-500', opted_out: 'text-red-500',
                                composing: 'text-muted-foreground', scheduled: 'text-blue-500',
                                sending: 'text-yellow-500', sent: 'text-green-500', failed: 'text-red-500',
                              }
                              return (
                                <div className="flex flex-wrap gap-1">
                                  {allStatuses.map(status => {
                                    const active = dmStatusFilter.includes(status)
                                    const count = contextRows.filter(r => dmEffectiveStatus(r) === status).length
                                    const isEmpty = count === 0
                                    return (
                                      <button
                                        key={status}
                                        onClick={() => !isEmpty && setDmStatusFilter(prev => active ? prev.filter(s => s !== status) : [...prev, status])}
                                        disabled={isEmpty}
                                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                                          active
                                            ? 'border-primary bg-primary/15 text-primary'
                                            : isEmpty
                                            ? 'border-border bg-background text-muted-foreground/30 cursor-not-allowed'
                                            : 'border-border bg-background text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                                        }`}
                                      >
                                        <span className={`w-1.5 h-1.5 rounded-full ${isEmpty ? 'opacity-30' : ''} ${statusColors[status] || 'text-muted-foreground'}`} style={{ backgroundColor: 'currentColor' }} />
                                        {statusLabels[status] || status}
                                        <span className="text-[9px] opacity-70">({count})</span>
                                      </button>
                                    )
                                  })}
                                  {dmStatusFilter.length > 0 && (
                                    <button onClick={() => setDmStatusFilter([])} className="text-[10px] text-primary hover:underline self-center ml-1">Clear</button>
                                  )}
                                </div>
                              )
                            })()}
                          </div>

                          {/* Row: Details filter — tag-based */}
                          <div>
                            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Details</label>
                            {(() => {
                              const detailsLabels: Record<string, string> = {
                                blocked_you: 'Blocked You',
                                blocked_bot: 'Blocked Bot / Private',
                                subscribed: 'Subscribed',
                                did_not_respond: 'Did Not Respond',
                                opted_out_calendar: 'Unsubscribed (Calendar)',
                                ready: 'Ready to receive message',
                              }
                              const detailsColors: Record<string, string> = {
                                blocked_you: 'text-red-500',
                                blocked_bot: 'text-purple-500',
                                subscribed: 'text-emerald-500',
                                did_not_respond: 'text-amber-500',
                                opted_out_calendar: 'text-orange-500',
                                ready: 'text-muted-foreground',
                              }
                              // Count only within rows that pass all OTHER active filters (server, role, search)
                              const contextRows = getBaseFilteredDmRows(dmRows)
                              // Always show all possible details so tags don't disappear when filtered
                              const allDetails = ['blocked_you', 'blocked_bot', 'subscribed', 'did_not_respond', 'opted_out_calendar', 'ready']
                              return (
                                <div className="flex flex-wrap gap-1">
                                  {allDetails.map(detail => {
                                    const active = dmDetailsFilter.includes(detail)
                                    const count = contextRows.filter(r => dmEffectiveDetails(r) === detail).length
                                    const isEmpty = count === 0
                                    return (
                                      <button
                                        key={detail}
                                        onClick={() => !isEmpty && setDmDetailsFilter(prev => active ? prev.filter(d => d !== detail) : [...prev, detail])}
                                        disabled={isEmpty}
                                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                                          active
                                            ? 'border-primary bg-primary/15 text-primary'
                                            : isEmpty
                                            ? 'border-border bg-background text-muted-foreground/30 cursor-not-allowed'
                                            : 'border-border bg-background text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                                        }`}
                                      >
                                        <span className={`w-1.5 h-1.5 rounded-full ${isEmpty ? 'opacity-30' : ''} ${detailsColors[detail] || 'text-muted-foreground'}`} style={{ backgroundColor: 'currentColor' }} />
                                        {detailsLabels[detail] || detail}
                                        <span className="text-[9px] opacity-70">({count})</span>
                                      </button>
                                    )
                                  })}
                                  {dmDetailsFilter.length > 0 && (
                                    <button onClick={() => setDmDetailsFilter([])} className="text-[10px] text-primary hover:underline self-center ml-1">Clear</button>
                                  )}
                                </div>
                              )
                            })()}
                          </div>

                          {/* Row: Roles filter (server-aware) — inside advanced section */}
                          {(() => {
                            // Collect roles strictly from selected servers only.
                            // Uses guild_id/guild_name on each role when available (new bot format).
                            // Falls back to user-level guild membership for older data without guild_id on roles.
                            const roleMap = new Map<string, { id: string; name: string; color: number; guild_id?: string; guild_name?: string }>()
                            const selectedServerNames = new Set(dmServerFilter)
                            const hasServerFilter = dmServerFilter.length > 0

                            for (const row of dmRows) {
                              for (const role of row.roles) {
                                if (hasServerFilter) {
                                  // If role has guild_name, check it directly against server filter
                                  if (role.guild_name) {
                                    if (!selectedServerNames.has(role.guild_name)) continue
                                  } else {
                                    // Legacy data without guild attribution: only include if user
                                    // belongs to exactly one of the selected servers (ambiguous otherwise)
                                    const userSelectedServers = row.guild_names.filter(g => selectedServerNames.has(g))
                                    if (userSelectedServers.length === 0) continue
                                  }
                                }
                                // Deduplicate by role id (same role name from same Discord role)
                                if (!roleMap.has(role.id)) roleMap.set(role.id, role)
                              }
                            }

                            const allRoles = Array.from(roleMap.values()).sort((a, b) => a.name.localeCompare(b.name))
                            if (allRoles.length === 0) return null

                            // Auto-prune stale role filter IDs when server filter narrows visible roles
                            const visibleRoleIds = new Set(allRoles.map(r => r.id))
                            const staleIds = dmRoleFilter.filter(id => !visibleRoleIds.has(id))
                            if (staleIds.length > 0) {
                              setTimeout(() => setDmRoleFilter(prev => prev.filter(id => visibleRoleIds.has(id))), 0)
                            }

                            // For member counts: count users who have a given role *from* the selected servers
                            const getMemberCount = (roleId: string) => {
                              return dmRows.filter(r => r.roles.some(rr => {
                                if (rr.id !== roleId) return false
                                if (!hasServerFilter) return true
                                if (rr.guild_name) return selectedServerNames.has(rr.guild_name)
                                return r.guild_names.some(g => selectedServerNames.has(g))
                              })).length
                            }

                            return (
                              <div>
                                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
                                  Roles
                                  {dmServerFilter.length > 0 && (
                                    <span className="text-[9px] font-normal text-primary">(filtered by {dmServerFilter.length} server{dmServerFilter.length !== 1 ? 's' : ''})</span>
                                  )}
                                </label>
                                {allRoles.length <= 10 ? (
                                  /* Tag mode for small number of roles */
                                  <div className="flex flex-wrap gap-1">
                                    {allRoles.map(role => {
                                      const active = dmRoleFilter.includes(role.id)
                                      const roleColor = role.color ? `#${role.color.toString(16).padStart(6, '0')}` : '#99aab5'
                                      const memberCount = getMemberCount(role.id)
                                      return (
                                        <button
                                          key={role.id}
                                          onClick={() => setDmRoleFilter(prev => active ? prev.filter(id => id !== role.id) : [...prev, role.id])}
                                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                                            active
                                              ? 'border-primary bg-primary/15 text-primary'
                                              : 'border-border bg-background text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                                          }`}
                                        >
                                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: roleColor }} />
                                          {role.name}
                                          <span className="text-[9px] opacity-70">({memberCount})</span>
                                        </button>
                                      )
                                    })}
                                    {dmRoleFilter.length > 0 && (
                                      <button onClick={() => setDmRoleFilter([])} className="text-[10px] text-primary hover:underline self-center ml-1">Clear</button>
                                    )}
                                  </div>
                                ) : (
                                  /* Dropdown mode for many roles */
                                  <div className="relative">
                                    <button
                                      onClick={() => setShowRoleDropdown(!showRoleDropdown)}
                                      className={`flex items-center gap-1.5 px-2.5 py-1.5 border rounded text-xs transition-colors ${
                                        dmRoleFilter.length > 0
                                          ? 'border-primary bg-primary/10 text-primary'
                                          : 'border-input bg-background text-foreground hover:bg-accent/50'
                                      }`}
                                    >
                                      <Filter className="w-3 h-3" />
                                      {dmRoleFilter.length > 0 ? `${dmRoleFilter.length} role(s) selected` : `Select from ${allRoles.length} roles`}
                                    </button>
                                    {showRoleDropdown && (
                                      <div className="absolute left-0 top-full mt-1 z-20 w-72 max-h-80 rounded-lg border border-border bg-popover shadow-lg flex flex-col">
                                        <div className="p-2 border-b border-border flex items-center justify-between shrink-0">
                                          <span className="text-xs font-medium text-muted-foreground">
                                            Filter by role ({allRoles.length})
                                            {dmServerFilter.length > 0 && <span className="text-primary ml-1">- server filtered</span>}
                                          </span>
                                          <div className="flex gap-2">
                                            {dmRoleFilter.length > 0 && (
                                              <button onClick={() => setDmRoleFilter([])} className="text-xs text-primary hover:underline">Clear</button>
                                            )}
                                            <button onClick={() => { setShowRoleDropdown(false); setRoleSearchQuery('') }} className="text-xs text-muted-foreground hover:text-foreground">Done</button>
                                          </div>
                                        </div>
                                        <div className="px-2 pt-2 pb-1 shrink-0">
                                          <div className="relative">
                                            <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                            <input
                                              type="text"
                                              value={roleSearchQuery}
                                              onChange={e => setRoleSearchQuery(e.target.value)}
                                              placeholder="Search roles..."
                                              className="w-full pl-7 pr-2 py-1 border border-input rounded text-xs bg-background text-foreground focus:ring-1 focus:ring-ring outline-none"
                                            />
                                          </div>
                                        </div>
                                        <div className="p-1 overflow-y-auto flex-1">
                                          {allRoles
                                            .filter(role => !roleSearchQuery.trim() || role.name.toLowerCase().includes(roleSearchQuery.toLowerCase()))
                                            .map(role => {
                                              const isSelected = dmRoleFilter.includes(role.id)
                                              const roleColor = role.color ? `#${role.color.toString(16).padStart(6, '0')}` : undefined
                                              const memberCount = getMemberCount(role.id)
                                              return (
                                                <button
                                                  key={role.id}
                                                  onClick={() => setDmRoleFilter(prev => isSelected ? prev.filter(id => id !== role.id) : [...prev, role.id])}
                                                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-accent/50 transition-colors ${isSelected ? 'bg-accent/30' : ''}`}
                                                >
                                                  <input type="checkbox" checked={isSelected} readOnly className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-ring pointer-events-none" />
                                                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: roleColor || '#99aab5' }} />
                                                  <span className="truncate flex-1 text-left">{role.name}</span>
                                                  <span className="text-muted-foreground text-[10px]">{memberCount}</span>
                                                </button>
                                              )
                                            })}
                                          {allRoles.filter(role => !roleSearchQuery.trim() || role.name.toLowerCase().includes(roleSearchQuery.toLowerCase())).length === 0 && (
                                            <div className="px-2 py-3 text-center text-xs text-muted-foreground">No roles match "{roleSearchQuery}"</div>
                                          )}
                                        </div>
                                        {dmRoleFilter.length > 0 && (
                                          <div className="p-2 border-t border-border shrink-0">
                                            <button
                                              onClick={() => {
                                                setDmRows(prev => prev.map(r => {
                                                  const matchesRole = r.roles.some(rr => dmRoleFilter.includes(rr.id))
                                                  return matchesRole && !r.opted_out && !r.private_dm ? { ...r, selected: true } : r
                                                }))
                                                setShowRoleDropdown(false)
                                              }}
                                              className="w-full text-xs text-center text-primary hover:underline py-1"
                                            >
                                              Select all matching members
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                    {/* Active role badges below dropdown */}
                                    {dmRoleFilter.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mt-1">
                                        {dmRoleFilter.map(roleId => {
                                          const role = allRoles.find(r => r.id === roleId) || dmRows.flatMap(r => r.roles).find(r => r.id === roleId)
                                          if (!role) return null
                                          const roleColor = role.color ? `#${role.color.toString(16).padStart(6, '0')}` : '#99aab5'
                                          return (
                                            <span key={roleId} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border border-border bg-accent/20">
                                              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: roleColor }} />
                                              {role.name}
                                              <button onClick={() => setDmRoleFilter(prev => prev.filter(id => id !== roleId))} className="hover:text-foreground text-muted-foreground ml-0.5">&times;</button>
                                            </span>
                                          )
                                        })}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })()}

                          {/* Advanced: clear all filters */}
                          {(dmUserFilter || dmServerFilter.length > 0 || dmStatusFilter.length > 0 || dmDetailsFilter || dmRoleFilter.length > 0) && (
                            <div className="flex justify-end">
                              <button
                                onClick={() => {
                                  setDmUserFilter('')
                                  setDmServerFilter([])
                                  setDmStatusFilter([])
                                  setDmDetailsFilter([])
                                  setDmRoleFilter([])
                                  setDmServerSearch('')
                                  setRoleSearchQuery('')
                                }}
                                className="text-[10px] text-primary hover:underline"
                              >
                                Clear all filters
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                    </div>
                    <div className={`grid gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground border-b border-border ${dmMatchMeta.size > 0 ? 'grid-cols-[32px_1fr_1fr_60px_80px_100px_1fr]' : 'grid-cols-[32px_1fr_1fr_100px_1fr]'}`}>
                      <div>
                        {(() => {
                          // Master checkbox for selecting/deselecting visible users on current page
                          const filtered = getFilteredDmRows(dmRows)
                          const totalDmPagesH = Math.max(1, Math.ceil(filtered.length / DM_PAGE_SIZE))
                          const safeDmPageH = Math.min(dmPage, totalDmPagesH)
                          const paginatedRows = filtered.slice((safeDmPageH - 1) * DM_PAGE_SIZE, safeDmPageH * DM_PAGE_SIZE)
                          const selectableRows = paginatedRows.filter(r => !r.opted_out && !r.private_dm && r.subscription_status !== 'opted_out' && r.subscription_status !== 'unsubscribed')
                          const allSelected = selectableRows.length > 0 && selectableRows.every(r => r.selected)
                          const someSelected = selectableRows.some(r => r.selected)
                          return (
                            <input
                              type="checkbox"
                              checked={allSelected}
                              ref={el => { if (el) el.indeterminate = someSelected && !allSelected }}
                              onChange={() => {
                                setDmRows(prev => prev.map(r => {
                                  if (paginatedRows.some(p => p.user_id === r.user_id) && !r.opted_out && !r.private_dm && r.subscription_status !== 'opted_out' && r.subscription_status !== 'unsubscribed') {
                                    return { ...r, selected: !allSelected }
                                  }
                                  return r
                                }))
                              }}
                              disabled={sending || selectableRows.length === 0}
                              className="w-4 h-4 rounded border-border text-primary focus:ring-ring cursor-pointer disabled:cursor-not-allowed"
                              title={`Select/deselect all ${selectableRows.length} on this page`}
                            />
                          )
                        })()}
                      </div>
                      <div>User</div>
                      <div>Shared Server</div>
                      {dmMatchMeta.size > 0 && (
                        <>
                          <div className="text-center" title="Fuzzy match confidence score">
                            Score
                            <button
                              onClick={() => setDmMatchMeta(new Map())}
                              className="ml-1 opacity-50 hover:opacity-100 text-[10px]" title="Clear match data"
                            >✕</button>
                          </div>
                          <div title="Which input name produced the best match">Matched By</div>
                        </>
                      )}
                      <div>Status</div>
                      <div>Details</div>
                    </div>
                    {(() => {
                      const filtered = getFilteredDmRows(dmRows)
                      const totalDmPages = Math.max(1, Math.ceil(filtered.length / DM_PAGE_SIZE))
                      const safeDmPage = Math.min(dmPage, totalDmPages)
                      const paginatedRows = filtered.slice((safeDmPage - 1) * DM_PAGE_SIZE, safeDmPage * DM_PAGE_SIZE)
                      const totalSelectedAll = dmRows.filter(r => r.selected && !r.opted_out).length
                      const selectedOnPage = paginatedRows.filter(r => r.selected && !r.opted_out).length
                      const selectedNotVisible = totalSelectedAll - selectedOnPage
                      return (
                        <>
                    {/* Hidden-selection banner (above rows) */}
                    {selectedNotVisible > 0 && (
                      <div className="px-3 py-1.5 border-b border-primary/20 bg-primary/5 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-xs text-primary">
                          <Users className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            <span className="font-semibold">{selectedNotVisible}</span> more selected member{selectedNotVisible !== 1 ? 's' : ''} not shown on this page
                            <span className="text-primary/60 ml-1">({totalSelectedAll} total selected)</span>
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => {
                              setDmRows(prev => prev.map(r => ({ ...r, selected: false })))
                              setDmSelectedOnly(false)
                              setDmSearchQuery('')
                              setDmRoleFilter([])
                            }}
                            disabled={sending}
                            className="text-[11px] text-red-500 hover:underline disabled:opacity-50"
                          >
                            Deselect all {totalSelectedAll}
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
                      {paginatedRows.map(row => {
                        const isSubBlocked = row.subscription_status === 'opted_out' || row.subscription_status === 'unsubscribed' || row.subscription_status === 'muted_bot'
                        const isSubscribed = row.subscription_status === 'subscribed'
                        const isInvited = row.subscription_status === 'invited'
                        const statusConfig = row.private_dm
                          ? { icon: XCircle, color: 'text-red-500', label: 'opted out' }
                          : row.opted_out
                          ? { icon: XCircle, color: 'text-red-500', label: 'opted out' }
                          : isSubBlocked
                          ? { icon: XCircle, color: 'text-red-500', label: 'opted out' }
                          : isSubscribed
                          ? { icon: CheckCircle2, color: 'text-emerald-500', label: 'opted in' }
                          : isInvited
                          ? { icon: XCircle, color: 'text-red-500', label: 'opted out' }
                          : {
                            composing: { icon: Pencil, color: 'text-muted-foreground', label: 'composing' },
                            scheduled: { icon: Clock, color: 'text-blue-500', label: 'scheduled' },
                            sending: { icon: Loader2, color: 'text-yellow-500', label: 'sending' },
                            sent: { icon: CheckCircle2, color: 'text-green-500', label: 'sent' },
                            failed: { icon: XCircle, color: 'text-red-500', label: 'failed' },
                          }[row.status]
                        const StatusIcon = statusConfig.icon
                        const matchInfo = dmMatchMeta.get(row.user_id)
                        return (
                          <div
                            key={row.user_id}
                            className={`grid gap-2 px-3 py-2 items-center text-sm ${dmMatchMeta.size > 0 ? 'grid-cols-[32px_1fr_1fr_60px_80px_100px_1fr]' : 'grid-cols-[32px_1fr_1fr_100px_1fr]'} ${row.opted_out || row.private_dm || isSubBlocked ? 'opacity-40' : ''}`}
                          >
                            <div>
                              <input
                                type="checkbox"
                                checked={row.selected}
                                onChange={() => toggleDmRowSelected(row.user_id)}
                                disabled={sending || row.opted_out || row.private_dm || isSubBlocked}
                                className="w-4 h-4 rounded border-border text-primary focus:ring-ring cursor-pointer disabled:cursor-not-allowed"
                              />
                            </div>
                            <div className="flex items-center gap-2 min-w-0">
                              {row.avatar && <img src={row.avatar} alt="" className="w-5 h-5 rounded-full shrink-0" />}
                              <div className="min-w-0">
                                <div className="flex items-center gap-1">
                                  <span className="truncate text-xs font-medium">{row.display_name}</span>
                                  <span className="truncate text-xs text-muted-foreground">@{row.username}</span>
                                  {row.private_dm ? (
                                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded-full bg-purple-100 dark:bg-purple-950/30 text-[9px] font-medium text-purple-600 dark:text-purple-400 shrink-0">
                                      <XCircle className="w-2.5 h-2.5" />
                                      Blocked Bot / Private
                                    </span>
                                  ) : row.opted_out && (
                                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded-full bg-red-100 dark:bg-red-950/30 text-[9px] font-medium text-red-600 dark:text-red-400 shrink-0">
                                      <XCircle className="w-2.5 h-2.5" />
                                      DM Opt-out
                                    </span>
                                  )}
                                </div>
                                {row.roles.length > 0 && (
                                  <div className="flex flex-wrap gap-0.5 mt-0.5">
                                    {row.roles.slice(0, 3).map(r => {
                                      const c = r.color ? `#${r.color.toString(16).padStart(6, '0')}` : '#99aab5'
                                      return (
                                        <span key={r.id} className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground">
                                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: c }} />
                                          {r.name}
                                        </span>
                                      )
                                    })}
                                    {row.roles.length > 3 && (
                                      <span className="text-[9px] text-muted-foreground">+{row.roles.length - 3}</span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="text-xs text-muted-foreground truncate" title={row.guild_names.join(', ')}>{row.guild_names.join(', ')}</div>
                            {dmMatchMeta.size > 0 && (
                              <>
                                <div className="text-center">
                                  {matchInfo ? (
                                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                      matchInfo.score >= 0.75 ? 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400'
                                        : matchInfo.score >= 0.5 ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400'
                                        : 'bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400'
                                    }`}>
                                      {Math.round(matchInfo.score * 100)}%
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-muted-foreground/40">—</span>
                                  )}
                                </div>
                                <div className="text-[10px] text-muted-foreground truncate" title={matchInfo?.matchedBy}>
                                  {matchInfo?.matchedBy || '—'}
                                </div>
                              </>
                            )}
                            <div className="flex items-center gap-1.5">
                              <StatusIcon className={`w-3.5 h-3.5 ${statusConfig.color} ${row.status === 'sending' ? 'animate-spin' : ''}`} />
                              <span className={`text-xs capitalize ${statusConfig.color}`}>{statusConfig.label}</span>
                            </div>
                            <div className="min-w-0">
                              <span className={`text-xs truncate block ${row.status === 'failed' ? 'text-red-500' : 'text-muted-foreground'}`}>{row.status_msg}</span>
                            </div>
                          </div>
                        )
                      })}
                      {filtered.length === 0 && (dmSearchQuery.trim() || dmRoleFilter.length > 0) && (
                        <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                          No members match the current filters
                        </div>
                      )}
                    </div>
                    {/* Pagination + Select All / Deselect All */}
                    {filtered.length > 0 && (
                      <div className="px-3 py-2 border-t border-border bg-muted/20 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {/* Always show select/deselect all across all pages */}
                          {(() => {
                            const hasFilters = dmSearchQuery.trim() || dmRoleFilter.length > 0 || dmServerFilter.length > 0 || dmStatusFilter.length > 0 || dmUserFilter.trim() || dmDetailsFilter.length > 0
                            const selectableFiltered = filtered.filter(r => !r.opted_out && !r.private_dm)
                            const allFilteredSelected = selectableFiltered.length > 0 && selectableFiltered.every(r => r.selected)
                            return (
                              <>
                                <button
                                  onClick={selectAllFiltered}
                                  disabled={sending || selectableFiltered.length === 0 || allFilteredSelected}
                                  className="text-xs text-primary hover:underline disabled:opacity-50"
                                >
                                  Select all {selectableFiltered.length}{hasFilters ? ' filtered' : ''}
                                </button>
                                <span className="text-xs text-muted-foreground">|</span>
                                <button
                                  onClick={deselectAllFiltered}
                                  disabled={sending || !selectableFiltered.some(r => r.selected)}
                                  className="text-xs text-muted-foreground hover:underline disabled:opacity-50"
                                >
                                  Deselect all{hasFilters ? ' filtered' : ''}
                                </button>
                              </>
                            )
                          })()}
                        </div>
                        {totalDmPages > 1 && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setDmPage(p => Math.max(1, p - 1))}
                              disabled={safeDmPage <= 1}
                              className="px-2 py-0.5 rounded border border-border text-xs disabled:opacity-50 hover:bg-accent/50 transition-colors"
                            >
                              ‹ Prev
                            </button>
                            <span className="text-xs text-muted-foreground">
                              Page {safeDmPage} / {totalDmPages} · {filtered.length} members
                            </span>
                            <button
                              onClick={() => setDmPage(p => Math.min(totalDmPages, p + 1))}
                              disabled={safeDmPage >= totalDmPages}
                              className="px-2 py-0.5 rounded border border-border text-xs disabled:opacity-50 hover:bg-accent/50 transition-colors"
                            >
                              Next ›
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                        </>
                      )
                    })()}
                    <div className="px-3 py-2 bg-muted/30 border-t border-border text-xs text-muted-foreground">
                      {(() => {
                        const selectedCount = dmRows.filter(r => r.selected && !r.opted_out).length
                        const overMax = selectedCount > DM_RATE_LIMIT_MAX
                        return overMax ? (
                          <span className="text-red-500 font-semibold">
                            {selectedCount} selected -- exceeds {DM_RATE_LIMIT_MAX.toLocaleString()} limit!{!isAdmin && ' Contact support for higher limits.'}
                          </span>
                        ) : null
                      })()}
                      {dmRows.some(r => r.opted_out) && (
                        <span className="text-muted-foreground/60">
                          {dmRows.filter(r => r.opted_out).length} opted out
                        </span>
                      )}
                      {dmRows.some(r => r.status === 'sent' || r.status === 'failed') && (
                        <span className="ml-2">
                          · {dmRows.filter(r => r.status === 'sent').length} delivered, {dmRows.filter(r => r.status === 'failed').length} failed
                        </span>
                      )}
                      <span className="float-right text-muted-foreground/60">
                        {(() => { const d = dmRows.filter(r => r.selected && !r.opted_out).length; return d > 0 ? `~${estimateDmMinutes(d)} min est.` : 'Paced delivery' })() } · max {DM_RATE_LIMIT_MAX.toLocaleString()}/send
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Email DM Recipients ── */}
            {emailIntegrationSetup && (
              <div>
                {(() => {
                  // ── Build unified rows from all 3 sources ──
                  const allRows: EmailRecipientRow[] = []

                  // 1. Manual email contacts
                  for (const c of emailContacts) {
                    allRows.push({
                      key: `manual:${c.id}`,
                      display_name: c.display_name || c.email.split('@')[0],
                      email: c.email,
                      email_display: c.email,
                      source: 'manual',
                      source_detail: '',
                      status_label: c.opted_out ? 'Opted out' : c.notification_disabled ? 'Disabled' : 'Active',
                      status_color: c.opted_out ? 'text-red-500' : c.notification_disabled ? 'text-amber-500' : 'text-green-500',
                      selectable: !c.opted_out && !c.notification_disabled,
                    })
                  }

                  // 2. Friendlist connections
                  for (const f of friendConnections) {
                    allRows.push({
                      key: `friendlist:${f.user_id}`,
                      display_name: f.display_name,
                      email: f.email,
                      email_display: f.email ? f.email : 'N/A',
                      source: 'friendlist',
                      source_detail: '',
                      status_label: f.email ? 'Active' : 'No Email',
                      status_color: f.email ? 'text-green-500' : 'text-muted-foreground',
                      selectable: !!f.email,
                    })
                  }

                  // 3. Calendar participants (from selected meetings/calendars)
                  const activeCalIds = new Set([
                    ...meetings.filter(m => selectedMeetingIds.has(m.id)).map(m => m.calendar_id),
                    ...Array.from(selectedCalendarIds),
                  ])
                  for (const p of calendarParticipantEmails) {
                    const matchedCalIds = p.calendar_ids.filter(cid => activeCalIds.has(cid))
                    if (matchedCalIds.length === 0) continue
                    const calNames = matchedCalIds
                      .map(cid => allCalendars.find(c => c.id === cid)?.title || cid)
                      .filter((t, i, arr) => arr.indexOf(t) === i)

                    let emailDisplay = 'N/A'
                    let statusLabel = 'No Email'
                    let statusColor = 'text-muted-foreground'
                    let selectable = false

                    if (p.email_status === 'visible' && p.email) {
                      emailDisplay = p.email
                      statusLabel = 'Active'
                      statusColor = 'text-green-500'
                      selectable = true
                    } else if (p.email_status === 'hidden') {
                      emailDisplay = 'Email Exists'
                      statusLabel = 'Active'
                      statusColor = 'text-green-500'
                      selectable = true
                    } else if (p.email_status === 'disabled') {
                      statusLabel = 'Disabled'
                      statusColor = 'text-amber-500'
                    }

                    allRows.push({
                      key: `calendar:${p.username}`,
                      display_name: p.username,
                      email: p.email_status === 'visible' ? p.email : null,
                      email_display: emailDisplay,
                      source: 'calendar',
                      source_detail: calNames.join(', '),
                      status_label: statusLabel,
                      status_color: statusColor,
                      selectable,
                    })
                  }

                  // Sort: selectable first, then alphabetically
                  allRows.sort((a, b) => {
                    if (a.selectable !== b.selectable) return a.selectable ? -1 : 1
                    return a.display_name.localeCompare(b.display_name)
                  })

                  // Apply search/filter
                  let filteredRows = allRows
                  if (emailSearchQuery.trim()) {
                    const q = emailSearchQuery.toLowerCase()
                    filteredRows = filteredRows.filter(r =>
                      r.display_name.toLowerCase().includes(q) ||
                      (r.email && r.email.toLowerCase().includes(q)) ||
                      r.source.includes(q) ||
                      r.source_detail.toLowerCase().includes(q)
                    )
                  }
                  if (emailSelectedOnly) {
                    filteredRows = filteredRows.filter(r => selectedEmailRecipients.has(r.key))
                  }

                  const selectableRows = filteredRows.filter(r => r.selectable)
                  const allSelected = selectableRows.length > 0 && selectableRows.every(r => selectedEmailRecipients.has(r.key))
                  const someSelected = selectableRows.some(r => selectedEmailRecipients.has(r.key))

                  // Check if ALL calendar rows have no usable email
                  const calendarRows = allRows.filter(r => r.source === 'calendar')
                  const noCalendarEmailsAvailable = calendarRows.length > 0 && calendarRows.every(r => !r.selectable)

                  const totalSelected = allRows.filter(r => r.selectable && selectedEmailRecipients.has(r.key)).length

                  // Source badge styling
                  const sourceBadge = (src: 'manual' | 'calendar' | 'friendlist') => {
                    const styles = {
                      manual: 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400',
                      calendar: 'bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400',
                      friendlist: 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400',
                    }
                    const labels = { manual: 'Manual', calendar: 'Calendar', friendlist: 'Friendlist' }
                    return { style: styles[src], label: labels[src] }
                  }

                  return (
                    <>
                      {emailServiceStatus && !emailServiceStatus.configured && (
                        <div className="mb-2 px-3 py-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                          <p className="text-xs text-amber-700 dark:text-amber-400">
                            Email sending is not configured. Go to the <button onClick={() => switchTab('email')} className="text-primary hover:underline font-medium">Email tab</button> to set up your email address, or ask an admin to configure the platform default sender.
                          </p>
                        </div>
                      )}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <label className="text-sm font-medium">Email Recipients</label>
                          {allRows.length > 0 && (
                            <button
                              onClick={() => { setEmailSelectedOnly(prev => !prev); setEmailSearchQuery('') }}
                              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-all whitespace-nowrap shadow-sm ${
                                emailSelectedOnly
                                  ? 'border border-green-500 bg-green-500 text-white dark:bg-green-600 dark:border-green-600 hover:bg-green-600 dark:hover:bg-green-700'
                                  : 'border border-primary bg-primary/10 text-primary hover:bg-primary/20 dark:border-primary dark:text-primary dark:hover:bg-primary/20'
                              }`}
                            >
                              <Check className={`w-3.5 h-3.5 ${emailSelectedOnly ? 'text-white' : 'text-primary'}`} />
                              {emailSelectedOnly ? 'Show All' : 'Hide Unselected'}
                            </button>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { fetchEmailContacts(); fetchFriendConnections(); fetchMeetings() }}
                            disabled={loadingEmailContacts || loadingFriends || loadingMeetings}
                            className="flex items-center gap-1.5 text-xs text-primary hover:underline disabled:opacity-50"
                          >
                            {(loadingEmailContacts || loadingFriends || loadingMeetings) ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                            Refresh
                          </button>
                        </div>
                      </div>
                      {emailServiceStatus?.configured && totalSelected > 0 && (
                        <div className="mb-2 px-3 py-1.5 text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                          <Mail className="w-3.5 h-3.5" />
                          Emails sent from: <span className="font-medium text-foreground">
                            {emailServiceStatus.userConfig?.verified
                              ? emailServiceStatus.userConfig.email
                              : emailServiceStatus.platformFrom || '(platform default)'}
                          </span>
                          {emailServiceStatus.userConfig?.verified && (
                            <span className="ml-1 text-[10px] text-green-500">(your email)</span>
                          )}
                          {emailServiceStatus.verifiedSenderEmail && (
                            <>
                              <span className="ml-2 text-muted-foreground/50">|</span>
                              <span>Sender attribution: <span className="font-medium text-foreground">{emailServiceStatus.verifiedSenderEmail}</span></span>
                              <span className="ml-1 text-[10px] text-green-500">(verified)</span>
                            </>
                          )}
                        </div>
                      )}

                      {emailSelectedOnly && totalSelected === 0 ? null : allRows.length === 0 ? (
                        <div className="border border-border rounded-lg p-4 text-center">
                          <Mail className="w-5 h-5 mx-auto text-muted-foreground mb-1.5" />
                          <p className="text-xs text-muted-foreground">
                            No email recipients yet. Add manual contacts in the <button onClick={() => switchTab('email')} className="text-primary hover:underline">Email tab</button>, connect friends, or select Coordination Calendars above.
                          </p>
                        </div>
                      ) : (
                        <div className="border border-border rounded-lg overflow-hidden">
                          {/* No-email notification for calendar participants (hidden when Selected Only is active) */}
                          {noCalendarEmailsAvailable && !emailSelectedOnly && (
                            <div className="px-3 py-2.5 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 flex items-center gap-2">
                              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                              <p className="text-xs text-amber-700 dark:text-amber-400">
                                None of the Coordination Calendar users have a visible email or email on their profile. No email announcements can be sent to these calendar participants.
                              </p>
                            </div>
                          )}
                          {/* Search bar */}
                          <div className="px-3 py-2 border-b border-border bg-muted/30 flex items-center gap-2">
                            <div className="relative flex-1">
                              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                              <input
                                type="text"
                                value={emailSearchQuery}
                                onChange={e => setEmailSearchQuery(e.target.value)}
                                placeholder="Search by name, source, or email..."
                                className="w-full pl-8 pr-3 py-1.5 border border-input rounded text-xs bg-background text-foreground focus:ring-1 focus:ring-ring outline-none"
                              />
                            </div>
                          </div>
                          {/* Table header */}
                          <div className="grid grid-cols-[32px_1fr_90px_1fr_1.2fr_80px] gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground border-b border-border">
                            <div>
                              <input
                                type="checkbox"
                                checked={allSelected}
                                ref={el => { if (el) el.indeterminate = someSelected && !allSelected }}
                                onChange={() => {
                                  const visibleKeys = new Set(selectableRows.map(r => r.key))
                                  setSelectedEmailRecipients(prev => {
                                    const next = new Set(prev)
                                    if (allSelected) {
                                      visibleKeys.forEach(k => next.delete(k))
                                    } else {
                                      visibleKeys.forEach(k => next.add(k))
                                    }
                                    return next
                                  })
                                }}
                                disabled={sending || selectableRows.length === 0}
                                className="w-4 h-4 rounded border-border text-primary focus:ring-ring cursor-pointer disabled:cursor-not-allowed"
                              />
                            </div>
                            <div>Name</div>
                            <div>Source</div>
                            <div>Detail</div>
                            <div>Email</div>
                            <div>Status</div>
                          </div>
                          {/* Rows */}
                          <div className="divide-y divide-border max-h-[400px] overflow-y-auto">
                            {filteredRows.map(row => {
                              const isSelected = selectedEmailRecipients.has(row.key)
                              const badge = sourceBadge(row.source)

                              const displayEmail = (() => {
                                if (!row.email) return row.email_display
                                if (row.email_display === 'Email Exists' || row.email_display === 'N/A') return row.email_display
                                return showEmails ? row.email : row.email.replace(/(.{2})(.*)(@.*)/, '$1***$3')
                              })()

                              return (
                                <div
                                  key={row.key}
                                  className={`grid grid-cols-[32px_1fr_90px_1fr_1.2fr_80px] gap-2 px-3 py-2 items-center text-sm ${!row.selectable ? 'opacity-50' : ''}`}
                                >
                                  <div>
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => {
                                        setSelectedEmailRecipients(prev => {
                                          const next = new Set(prev)
                                          if (next.has(row.key)) next.delete(row.key)
                                          else next.add(row.key)
                                          return next
                                        })
                                      }}
                                      disabled={sending || !row.selectable}
                                      className="w-4 h-4 rounded border-border text-primary focus:ring-ring cursor-pointer disabled:cursor-not-allowed"
                                    />
                                  </div>
                                  <div className="truncate text-xs font-medium flex items-center gap-1.5">
                                    <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                    {row.display_name}
                                  </div>
                                  <div>
                                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.style}`}>
                                      {badge.label}
                                    </span>
                                  </div>
                                  <div className="truncate text-xs text-muted-foreground">
                                    {row.source === 'calendar' && row.source_detail ? (
                                      row.source_detail.split(', ').map((name, i) => (
                                        <span key={name}>
                                          {i > 0 && ', '}
                                          <span className="inline-block px-1.5 py-0.5 rounded bg-muted text-[10px] font-medium">{name}</span>
                                        </span>
                                      ))
                                    ) : (
                                      <span className="text-muted-foreground/50">&mdash;</span>
                                    )}
                                  </div>
                                  <div className="truncate text-xs text-muted-foreground flex items-center gap-1">
                                    <span>{displayEmail}</span>
                                    {row.email && row.email_display !== 'Email Exists' && row.email_display !== 'N/A' && (
                                      <button
                                        onClick={() => setShowEmails(!showEmails)}
                                        className="ml-0.5 text-muted-foreground/50 hover:text-foreground"
                                      >
                                        {showEmails ? <EyeOff className="w-3 h-3 inline" /> : <Eye className="w-3 h-3 inline" />}
                                      </button>
                                    )}
                                  </div>
                                  <div>
                                    <span className={`inline-flex items-center gap-0.5 text-[10px] ${row.status_color}`}>
                                      {row.status_label === 'Active' && <CheckCircle2 className="w-3 h-3" />}
                                      {row.status_label === 'No Email' && <XCircle className="w-3 h-3" />}
                                      {row.status_label === 'Disabled' && <AlertTriangle className="w-3 h-3" />}
                                      {row.status_label === 'Opted out' && <XCircle className="w-3 h-3" />}
                                      {' '}{row.status_label}
                                    </span>
                                  </div>
                                </div>
                              )
                            })}
                            {filteredRows.length === 0 && (
                              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                                {emailSearchQuery.trim() ? 'No recipients match your search' : 'No email recipients yet'}
                              </div>
                            )}
                          </div>
                          <div className="px-3 py-2 bg-muted/30 border-t border-border text-xs text-muted-foreground">
                            {(() => {
                              // Count unique emails among selected to show dedup info
                              const selectedEmails = allRows
                                .filter(r => r.selectable && r.email && selectedEmailRecipients.has(r.key))
                                .map(r => r.email!.toLowerCase())
                              const uniqueEmails = new Set(selectedEmails)
                              if (selectedEmails.length > uniqueEmails.size) {
                                return (
                                  <span className="text-muted-foreground/60">
                                    {uniqueEmails.size} unique email(s) will be sent
                                  </span>
                                )
                              }
                              return null
                            })()}
                          </div>
                        </div>
                      )}
                    </>
                  )
                })()}
              </div>
            )}

            {/* ── Email Subject (required when email recipients selected) ── */}
            {emailIntegrationSetup && selectedEmailRecipients.size > 0 && (
              <div>
                <label className="text-sm font-medium block mb-1">
                  Email Subject <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={emailSubject}
                  onChange={e => setEmailSubject(e.target.value)}
                  placeholder="e.g., Weekly Meeting Update — March 2026"
                  className={`w-full px-3 py-2 border rounded-lg text-sm bg-background text-foreground focus:ring-2 focus:ring-ring outline-none ${
                    !emailSubject.trim() ? 'border-red-300 dark:border-red-700' : 'border-input'
                  }`}
                  disabled={sending}
                  maxLength={500}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  This will be the subject line of emails sent to your selected recipients.
                </p>
              </div>
            )}

            {/* ── Message Preview — color-coded sections ── */}
            {integration?.discord_username && (composeBody.trim() || selectedMeetingIds.size > 0 || selectedCalendarIds.size > 0 || (pollEnabled && pollOptions.some(o => o.text.trim()))) && (
              <div className="border border-border rounded-lg overflow-hidden bg-card">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/50">
                  <p className="text-xs font-medium text-muted-foreground">Message Preview</p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        let text = ''
                        if (composeBody.trim()) text += composeBody.trim()
                        if (selectedMeetingIds.size > 0) {
                          const blocks = buildGroupedMeetingBlocks(
                            meetings.filter(m => selectedMeetingIds.has(m.id))
                          ).join('\n')
                          text += (text ? '\n' : '') + blocks
                        }
                        if (pollEnabled && pollOptions.some(o => o.text.trim())) {
                          const pollText = pollOptions
                            .filter(o => o.text.trim())
                            .map(o => `${o.emoji} ${o.text}`)
                            .join('\n')
                          text += (text ? '\n\n' : '') + pollText
                        }
                        if (composeDmBody.trim()) {
                          text += (text ? '\n\n' : '') + '[DM Only]\n' + composeDmBody.trim()
                        }
                        // If Add to Calendar link is in the body, use plain text to avoid duplicate Discord embed
                        const hasCalendarLink = text.includes('coordinationmanager.com')
                        const viaText = hasCalendarLink ? 'coordinationmanager.com' : '[coordinationmanager.com](https://coordinationmanager.com)'
                        text += `\n\n— ${sendMode === 'now' ? 'Posted' : 'Scheduled'} via ${viaText} by @${integration!.discord_username}`
                        navigator.clipboard.writeText(text)
                      }}
                      className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors cursor-pointer flex items-center gap-0.5"
                      style={{ pointerEvents: 'auto' }}
                      title="Copy message as plain text"
                    >
                      <Clipboard className="w-3 h-3" />
                      copy
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                      className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors cursor-pointer"
                      style={{ pointerEvents: 'auto' }}
                    >
                      edit →
                    </button>
                  </div>
                </div>
                <div className="text-xs leading-relaxed whitespace-pre-wrap select-text">
                  {/* Body section */}
                  {composeBody.trim() && (
                    <div className="px-3 py-2 bg-background border-b border-border/50">
                      <span className="inline-block text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wide mb-1">Body</span>
                      <div className="text-muted-foreground">{renderDiscordMarkdown(composeBody)}</div>
                    </div>
                  )}
                  {/* Calendar context section */}
                  {(selectedMeetingIds.size > 0 || selectedCalendarIds.size > 0) && (
                    <div className="px-3 py-2 bg-sky-50/60 dark:bg-sky-950/20 border-b border-border/50">
                      <span className="inline-block text-[10px] font-medium text-sky-600 dark:text-sky-400 uppercase tracking-wide mb-1">Calendar Context</span>
                      <div className="text-muted-foreground">
                        {selectedMeetingIds.size > 0 && renderDiscordMarkdown(
                          buildGroupedMeetingBlocks(
                            meetings.filter(m => selectedMeetingIds.has(m.id))
                          ).join('\n')
                        )}
                        {(() => {
                          // Render a calendar block for every selected calendar whose meetings
                          // are NOT currently selected (matches buildFullBody's logic). This
                          // covers both meetingless calendars and calendars-with-meetings where
                          // only the calendar itself was attached.
                          const calIdsWithSelectedMeetings = new Set(
                            meetings.filter(m => selectedMeetingIds.has(m.id)).map(m => m.calendar_id)
                          )
                          const calendarOnlySelected = Array.from(selectedCalendarIds)
                            .filter(id => !calIdsWithSelectedMeetings.has(id))
                          if (calendarOnlySelected.length === 0) return null
                          return calendarOnlySelected.map(calId => {
                            const cal = allCalendars.find(c => c.id === calId)
                            if (!cal) return null
                            const availabilityUrl = cal.onboardingUrl || `${window.location.origin}/join/${cal.hash}`
                            return (
                              <div key={calId} className="mt-1">
                                {renderDiscordMarkdown(
                                  `\n📋 **${cal.title}** (Coordination Calendar)` +
                                  (meetingContextFields.onboardingLink ? `\n🔗 [Add Availability](${availabilityUrl})` : '')
                                )}
                              </div>
                            )
                          })
                        })()}
                      </div>
                    </div>
                  )}
                  {/* Poll section */}
                  {pollEnabled && pollOptions.some(o => o.text.trim()) && (
                    <div className="px-3 py-2 bg-amber-50/60 dark:bg-amber-950/20 border-b border-border/50">
                      <span className="inline-block text-[10px] font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wide mb-1">Reaction Poll</span>
                      <div className="text-muted-foreground">
                        {pollOptions.filter(o => o.text.trim()).map((o, i) => (
                          <span key={i}>{o.emoji} {o.text}{'\n'}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* DM-only additional message section */}
                  {composeDmBody.trim() && (
                    <div className="px-3 py-2 bg-violet-50/60 dark:bg-violet-950/20 border-b border-border/50">
                      <span className="inline-block text-[10px] font-medium text-violet-600 dark:text-violet-400 uppercase tracking-wide mb-1">DM Only - Additional Message</span>
                      <div className="text-muted-foreground">{renderDiscordMarkdown(composeDmBody)}</div>
                    </div>
                  )}
                  {/* Attribution footer */}
                  <div className="px-3 py-2 text-[11px] text-muted-foreground/50">
                    — {sendMode === 'now' ? 'Posted' : 'Scheduled'} via {(selectedMeetingIds.size > 0 && meetingContextFields.addToCalendar) ? (
                      <span>coordinationmanager.com</span>
                    ) : (
                      <a href="https://coordinationmanager.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-muted-foreground transition-colors">coordinationmanager.com</a>
                    )} by @{integration.discord_username}
                  </div>
                </div>
              </div>
            )}

            {/* Send mode */}
            {!sending && !activeScheduleId && (
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={sendMode === 'now'}
                    onChange={() => setSendMode('now')}
                    className="text-primary"
                  />
                  <span className="text-sm">Send Now</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={sendMode === 'schedule'}
                    onChange={() => setSendMode('schedule')}
                    className="text-primary"
                  />
                  <span className="text-sm">Schedule</span>
                </label>
              </div>
            )}

            {sendMode === 'schedule' && !sending && !activeScheduleId && (
              <div className="space-y-3">
                {/* Manual fixed schedule (used only when no per-meeting reminders) */}
                {(selectedMeetingIds.size === 0 || reminderOffsets.length === 0) && (
                  <div className="flex gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Date</label>
                      <input
                        type="date"
                        value={scheduleDate}
                        onChange={e => setScheduleDate(e.target.value)}
                        className="px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Time</label>
                      <input
                        type="time"
                        value={scheduleTime}
                        onChange={e => setScheduleTime(e.target.value)}
                        className="px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground"
                      />
                    </div>
                  </div>
                )}

                {/* Per-meeting reminder offsets (only when meetings are attached) */}
                {selectedMeetingIds.size > 0 && (() => {
                  const selChannels = distributionRows.filter(r => r.selected).length
                  const selDms = dmRows.filter(r => r.selected && !r.opted_out).length
                  const selEmails = selectedEmailRecipients.size
                  const batchSec = estimateBatchDurationSec(selChannels, selDms, selEmails)

                  // Build plan preview
                  const selectedMeetings = meetings.filter(m => selectedMeetingIds.has(m.id))
                  const nowMs = Date.now()
                  const minLeadMs = 60_000
                  let plannedCount = 0
                  let skippedCount = 0
                  for (const m of selectedMeetings) {
                    const startMs = getMeetingStartMs(m)
                    for (const o of reminderOffsets) {
                      const sendMs = startMs - offsetToMs(o)
                      if (sendMs < nowMs + minLeadMs) skippedCount++
                      else plannedCount++
                    }
                  }
                  const totalSec = batchSec * Math.max(0, plannedCount)

                  const presets: ReminderOffset[] = [
                    { id: 'p-0m', value: 0, unit: 'min' },
                    { id: 'p-15m', value: 15, unit: 'min' },
                    { id: 'p-30m', value: 30, unit: 'min' },
                    { id: 'p-1h', value: 1, unit: 'hour' },
                    { id: 'p-1d', value: 1, unit: 'day' },
                    { id: 'p-1w', value: 1, unit: 'week' },
                  ]
                  const isActive = (preset: ReminderOffset) =>
                    reminderOffsets.some(o => o.value === preset.value && o.unit === preset.unit)
                  const togglePreset = (preset: ReminderOffset) => {
                    setReminderOffsets(prev => {
                      const exists = prev.find(o => o.value === preset.value && o.unit === preset.unit)
                      if (exists) return prev.filter(o => o.id !== exists.id)
                      return [...prev, { ...preset, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }]
                    })
                  }
                  const addCustom = () => {
                    setReminderOffsets(prev => [
                      ...prev,
                      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, value: 10, unit: 'min' },
                    ])
                  }

                  return (
                    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <Clock className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                        <div className="flex-1">
                          <div className="text-sm font-medium">Per-meeting reminders</div>
                          <div className="text-xs text-muted-foreground">
                            Sends one announcement per selected meeting at each offset, computed from each meeting&apos;s start time. <span className="font-medium">0 min = at meeting start.</span>
                          </div>
                        </div>
                      </div>

                      {/* Preset chips */}
                      <div className="flex flex-wrap gap-1.5">
                        {presets.map(p => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => togglePreset(p)}
                            className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                              isActive(p)
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'bg-background text-muted-foreground border-input hover:border-primary/50'
                            }`}
                          >
                            {formatOffsetLabel(p)}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={addCustom}
                          className="px-2.5 py-1 text-xs rounded-full border border-dashed border-input text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors flex items-center gap-1"
                        >
                          <Plus className="w-3 h-3" /> Custom
                        </button>
                      </div>

                      {/* Active offsets list (editable) */}
                      {reminderOffsets.length > 0 && (
                        <div className="space-y-1.5">
                          {reminderOffsets.map((o, idx) => (
                            <div key={o.id} className="flex items-center gap-2">
                              <input
                                type="number"
                                min={0}
                                value={o.value}
                                onChange={e => {
                                  const v = Math.max(0, Math.floor(Number(e.target.value) || 0))
                                  setReminderOffsets(prev => prev.map((x, i) => i === idx ? { ...x, value: v } : x))
                                }}
                                className="w-20 px-2 py-1 text-sm border border-input rounded bg-background text-foreground"
                              />
                              <select
                                value={o.unit}
                                onChange={e => {
                                  const unit = e.target.value as ReminderUnit
                                  setReminderOffsets(prev => prev.map((x, i) => i === idx ? { ...x, unit } : x))
                                }}
                                className="px-2 py-1 text-sm border border-input rounded bg-background text-foreground"
                              >
                                <option value="min">min</option>
                                <option value="hour">hours</option>
                                <option value="day">days</option>
                                <option value="week">weeks</option>
                              </select>
                              <span className="text-xs text-muted-foreground">before each meeting</span>
                              <button
                                type="button"
                                onClick={() => setReminderOffsets(prev => prev.filter((_, i) => i !== idx))}
                                className="ml-auto p-1 text-muted-foreground hover:text-red-500"
                                aria-label="Remove offset"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Plan summary + delivery duration warning */}
                      {reminderOffsets.length > 0 && (
                        <div className="text-xs text-muted-foreground border-t border-border/50 pt-2 space-y-0.5">
                          <div>
                            <span className="font-medium text-foreground">
                              {plannedCount} schedule{plannedCount !== 1 ? 's' : ''}
                            </span>{' '}
                            will be created across {selectedMeetings.length} meeting{selectedMeetings.length !== 1 ? 's' : ''} x {reminderOffsets.length} offset{reminderOffsets.length !== 1 ? 's' : ''}.
                            {skippedCount > 0 && (
                              <span className="text-amber-600 dark:text-amber-400"> ({skippedCount} skipped - already in the past.)</span>
                            )}
                          </div>
                          {(selChannels + selDms + selEmails) > 0 ? (
                            <div className="flex items-center gap-1.5">
                              <AlertTriangle className="w-3 h-3 text-amber-500" />
                              <span>
                                Each batch delivers to {selChannels + selDms + selEmails} target{(selChannels + selDms + selEmails) !== 1 ? 's' : ''} ({formatDurationShort(batchSec)} per batch).
                                {plannedCount > 1 && (
                                  <> Total send time across all reminders: <span className="font-medium text-foreground">{formatDurationShort(totalSec)}</span>.</>
                                )}
                              </span>
                            </div>
                          ) : (
                            <div className="text-amber-600 dark:text-amber-400">Select at least one channel, DM, or email recipient to deliver these reminders.</div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
            )}

            {/* Suppress Discord link-preview embeds */}
            {!sending && !activeScheduleId && (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={suppressEmbeds}
                  onChange={() => setSuppressEmbeds(!suppressEmbeds)}
                  className="rounded border-input"
                />
                <Link2 className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Suppress link preview embeds</span>
              </label>
            )}

            {/* Result message */}
            {sendResult && (
              <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                sendResult.type === 'success'
                  ? 'bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
                  : sendResult.type === 'warning'
                  ? 'bg-orange-50 dark:bg-orange-950 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800'
                  : 'bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
              }`}>
                {sendResult.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : sendResult.type === 'warning' ? <AlertCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                {sendResult.message}
              </div>
            )}

            {/* ── Target Summary ── */}
            {(() => {
              const selChannels = distributionRows.filter(r => r.selected)
              const selDms = dmRows.filter(r => r.selected && !r.opted_out)
              const selEmails = selectedEmailRecipients.size
              const totalSel = selChannels.length + selDms.length + selEmails
              if (totalSel === 0) return null

              // Build a compact label list: #channel-name, @username, email@...
              const labels: string[] = [
                ...selChannels.map(r => `#${r.channel_name}`),
                ...selDms.map(r => `@${r.display_name || r.username}`),
                ...(selEmails > 0 ? [`${selEmails} email${selEmails !== 1 ? 's' : ''}`] : []),
              ]
              // Truncate to fit ~1 line (~120 chars)
              let display = ''
              let truncated = false
              for (let i = 0; i < labels.length; i++) {
                const next = i === 0 ? labels[i] : `, ${labels[i]}`
                if (display.length + next.length > 120) {
                  truncated = true
                  break
                }
                display += next
              }
              if (truncated) display += ', ...'

              return (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/20 text-sm">
                  <ListChecks className="w-4 h-4 text-primary shrink-0" />
                  <span className="font-medium text-primary">{totalSel} target{totalSel !== 1 ? 's' : ''}</span>
                  <span className="text-muted-foreground truncate">{display}</span>
                </div>
              )
            })()}

            {/* Action buttons */}
            <div className="flex gap-2">
              {!activeScheduleId ? (
                <button
                  onClick={handleSend}
                  disabled={sending || !composeBody.trim() || (distributionRows.filter(r => r.selected).length === 0 && dmRows.filter(r => r.selected).length === 0 && selectedEmailRecipients.size === 0)}
                  className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {sendMode === 'now'
                    ? 'Send Now'
                    : (selectedMeetingIds.size > 0 && reminderOffsets.length > 0)
                      ? 'Schedule Reminders'
                      : 'Schedule'}
                </button>
              ) : (() => {
                const selectedChannels = distributionRows.filter(r => r.selected)
                const selectedDms = dmRows.filter(r => r.selected)
                const emailTotal = emailDeliveryStatus.total || selectedEmailRecipients.size
                const totalTargets = selectedChannels.length + selectedDms.length + emailTotal
                const emailDelivered = emailDeliveryStatus.sent + emailDeliveryStatus.failed
                const delivered = [...selectedChannels, ...selectedDms].filter(r => r.status === 'sent' || r.status === 'failed').length + emailDelivered
                const failedCount = [...selectedChannels, ...selectedDms].filter(r => r.status === 'failed').length + emailDeliveryStatus.failed
                const pct = totalTargets > 0 ? Math.round((delivered / totalTargets) * 100) : 0
                return (
                  <div className="flex-1 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                        <span>Delivering to {totalTargets} target{totalTargets !== 1 ? 's' : ''}...</span>
                      </div>
                      <span className="text-muted-foreground">
                        {delivered}/{totalTargets} complete{failedCount > 0 ? ` (${failedCount} failed)` : ''}
                      </span>
                    </div>
                    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${failedCount > 0 ? 'bg-yellow-500' : 'bg-primary'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {totalTargets > 10 && (
                      <p className="text-[10px] text-muted-foreground">
                        Estimated time: ~{Math.max(1, estimateDmMinutes(totalTargets - delivered))} min remaining
                      </p>
                    )}
                    <p className="text-[10px] text-blue-600 dark:text-blue-400">
                      The bot delivers in the background -- you can close this page or start a new announcement.
                    </p>
                  </div>
                )
              })()}
              {(distributionRows.some(r => r.status !== 'composing') || sendResult) && (
                <button
                  onClick={resetCompose}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  New Announcement
                </button>
              )}
              {composeBody.trim() && !sending && !activeScheduleId && (
                <button
                  onClick={() => {
                    setTemplateTitle(composeTitle)
                    setTemplateBody(composeBody)
                    setEditingTemplate(null)
                    saveTemplate()
                  }}
                  disabled={savingTemplate}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {savingTemplate ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Save as Template
                </button>
              )}

              {/* Template duplicate override confirmation */}
              {templateOverrideTarget && (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800">
                  <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                      Template &quot;{templateOverrideTarget.title}&quot; already exists
                    </p>
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                      Do you want to overwrite it or save as a new template?
                    </p>
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => saveTemplate(templateOverrideTarget.id)}
                        className="px-3 py-1.5 text-xs font-medium rounded bg-amber-600 text-white hover:bg-amber-700 transition-colors"
                      >
                        Overwrite
                      </button>
                      <button
                        onClick={() => {
                          // Save as new with a slightly different title
                          setTemplateOverrideTarget(null)
                          const newTitle = templateTitle + ' (copy)'
                          setTemplateTitle(newTitle)
                          // Retry save with modified title
                          setSavingTemplate(true)
                          apiClient.post('/api/announcements/templates', {
                            title: newTitle,
                            body: templateBody || composeBody,
                          }).then(res => {
                            setTemplates(prev => [res.data.template, ...prev])
                            setTemplateTitle('')
                            setTemplateBody('')
                          }).catch(err => console.error('Failed to save template:', err))
                          .finally(() => setSavingTemplate(false))
                        }}
                        className="px-3 py-1.5 text-xs font-medium rounded border border-border hover:bg-muted transition-colors"
                      >
                        Save as Copy
                      </button>
                      <button
                        onClick={() => setTemplateOverrideTarget(null)}
                        className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
        )}

        {/* ═══════════════════════════════════════════════════════
            TEMPLATES TAB
            ═══════════════════════════════════════════════════════ */}
        {activeTab === 'templates' && (
          <div className="space-y-6">
            {/* Info banner */}
            <div className="border border-border rounded-lg p-4 bg-card flex items-start gap-3">
              <FileText className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
              <div className="flex-1 text-sm text-muted-foreground">
                <p className="font-medium text-foreground mb-1">Templates are created from the Compose tab</p>
                <p>Write your announcement, then click <span className="font-medium text-foreground">Save as Template</span> to save it here for reuse.</p>
              </div>
              <LearnerHelpIcon
                description={<><p className="font-semibold text-blue-700 dark:text-blue-300 mb-1">Announcement Templates</p><p className="mb-1.5">Templates let you save pre-filled announcements so you can reuse them without rewriting everything from scratch.</p><p className="font-semibold text-blue-700 dark:text-blue-300 mb-1">How it works</p><ul className="list-disc list-inside space-y-0.5"><li>Go to the <strong>Compose</strong> tab and fill in your announcement.</li><li>Click <strong>Save as Template</strong> to store it.</li><li>Templates preserve your title, body, channel selections, DM recipients, and meeting context.</li><li>Click the send icon on any template to load it back into Compose.</li></ul></>}
                size={4}
                className="shrink-0"
              />
            </div>

            {/* Template list */}
            {loadingTemplates ? (
              <div className="text-center py-8">
                <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
              </div>
            ) : templates.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No templates yet. Go to the Compose tab and use <span className="font-medium">Save as Template</span> to create one.
              </p>
            ) : (
              <div className="space-y-2">
                {templates.map(template => (
                  <div
                    key={template.id}
                    className="border border-border rounded-lg p-4 hover:border-primary/30 transition-colors cursor-pointer"
                    onClick={() => applyTemplate(template)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); applyTemplate(template); } }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium">{template.title}</h4>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{template.body}</p>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <span className="text-xs text-muted-foreground">
                            Updated {formatDateDDMMYYYY(template.updated_at)}
                          </span>
                          {(template.distribution_channel_ids?.length > 0) && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400">
                              {template.distribution_channel_ids.length} channel{template.distribution_channel_ids.length !== 1 ? 's' : ''}
                            </span>
                          )}
                          {(template.dm_recipient_ids?.length > 0) && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400">
                              {template.dm_recipient_ids.length} DM{template.dm_recipient_ids.length !== 1 ? 's' : ''}
                            </span>
                          )}
                          {(template.meeting_ids?.length > 0) && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-600 dark:text-green-400">
                              {template.meeting_ids.length} meeting{template.meeting_ids.length !== 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1 ml-3 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => deleteTemplate(template.id)}
                          className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════
            SCHEDULED TAB
            ═══════════════════════════════════════════════════════ */}
        {activeTab === 'scheduled' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm font-medium">Announcement History</h3>
                <LearnerHelpIcon
                  description={<><p className="font-semibold text-blue-700 dark:text-blue-300 mb-1">Scheduled Announcement</p><p className="mb-1.5">Each card tracks the lifecycle of an announcement -- from pending delivery to sent or failed.</p><p className="font-semibold text-blue-700 dark:text-blue-300 mb-1">What you can do</p><ul className="list-disc list-inside space-y-0.5"><li><strong>Expand</strong> to see delivery details and channel status.</li><li><strong>Cancel</strong> pending announcements before they send.</li><li><strong>Retry</strong> failed deliveries to try again.</li></ul></>}
                  size={4}
                />
              </div>
              <button
                onClick={fetchSchedules}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border hover:bg-muted transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh
              </button>
            </div>

            {loadingSchedules ? (
              <div className="text-center py-8">
                <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
              </div>
            ) : schedules.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No announcements yet. Compose one in the Compose tab.
              </p>
            ) : (
              <div className="space-y-2">
                {schedules.map(schedule => {
                  const allStatusConfigs = {
                    pending: { icon: Clock, color: 'text-yellow-500 dark:text-blue-400', bg: 'bg-yellow-50 dark:bg-blue-950', label: 'Pending' },
                    sending: { icon: Loader2, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-950', label: 'Sending' },
                    sent: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-950', label: 'Sent' },
                    partially_sent: { icon: AlertCircle, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950', label: 'Partially Sent' },
                    failed: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-950', label: 'Failed' },
                    cancelled: { icon: X, color: 'text-muted-foreground', bg: 'bg-muted', label: 'Cancelled' },
                  }

                  // Derive effective status from delivery log when available
                  const deliveryLog = scheduleDeliveryLogs[schedule.id]
                  let effectiveStatus = schedule.status
                  if (deliveryLog && deliveryLog.length > 0 && schedule.status === 'sent') {
                    const hasSent = deliveryLog.some(l => l.status === 'sent')
                    const hasFailed = deliveryLog.some(l => l.status === 'failed')
                    if (hasSent && hasFailed) effectiveStatus = 'partially_sent'
                  }

                  const statusConfig = allStatusConfigs[effectiveStatus]
                  const StatusIcon = statusConfig.icon

                  const isExpanded = expandedScheduleIds.has(schedule.id)

                  const toggleExpand = async () => {
                    if (isExpanded) {
                      setExpandedScheduleIds(prev => { const next = new Set(prev); next.delete(schedule.id); return next })
                      setScheduleDeliveryLogs(prev => { const next = { ...prev }; delete next[schedule.id]; return next })
                      return
                    }
                    setExpandedScheduleIds(prev => new Set(prev).add(schedule.id))
                    setLoadingDeliveryLogIds(prev => new Set(prev).add(schedule.id))
                    try {
                      const res = await apiClient.get(`/api/announcements/schedules/${schedule.id}/log`)
                      setScheduleDeliveryLogs(prev => ({ ...prev, [schedule.id]: res.data.log || [] }))
                    } catch {
                      setScheduleDeliveryLogs(prev => ({ ...prev, [schedule.id]: [] }))
                    } finally {
                      setLoadingDeliveryLogIds(prev => { const next = new Set(prev); next.delete(schedule.id); return next })
                    }
                  }

                  return (
                    <div
                      key={schedule.id}
                      className={`border border-border rounded-lg overflow-hidden ${statusConfig.bg}`}
                    >
                      <div
                        className="flex items-start justify-between p-4 cursor-pointer hover:bg-accent/20 transition-colors"
                        onClick={toggleExpand}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                            )}
                            <StatusIcon className={`w-4 h-4 ${statusConfig.color} ${schedule.status === 'sending' ? 'animate-spin' : ''} shrink-0`} />
                            <h4 className="text-sm font-medium truncate">{schedule.title}</h4>
                            <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${statusConfig.color}`}>
                              {statusConfig.label}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-1 ml-[52px]">{schedule.body}</p>
                          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground ml-[52px] flex-wrap">
                            <span>Scheduled: {formatDateTimeDDMMYYYY(schedule.scheduled_at)}</span>
                            {schedule.sent_at && <span>Sent: {formatDateTimeDDMMYYYY(schedule.sent_at)}</span>}
                            <span>{schedule.targets.length} target(s)</span>
                          </div>
                          {schedule.error_message && (
                            <p className="text-xs text-red-500 mt-1 ml-[52px]">
                              {(() => {
                                const match = schedule.error_message.match(/^(\d+) of (\d+) failed/)
                                return match ? `${match[1]} of ${match[2]} target(s) failed` : schedule.error_message
                              })()}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-1 ml-3 shrink-0" onClick={e => e.stopPropagation()}>
                          {schedule.status === 'pending' && (
                            <button
                              onClick={() => cancelSchedule(schedule.id)}
                              className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                              title="Cancel"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                      {/* ── Expanded delivery details ── */}
                      {isExpanded && ((() => {
                        const deliveryLog = scheduleDeliveryLogs[schedule.id] || []
                        const isLoading = loadingDeliveryLogIds.has(schedule.id)
                        return (
                        <div className="border-t border-border">
                          {isLoading ? (
                            <div className="p-4 text-center">
                              <Loader2 className="w-4 h-4 animate-spin mx-auto text-muted-foreground" />
                            </div>
                          ) : deliveryLog.length === 0 ? (
                            <div className="p-4 text-center text-xs text-muted-foreground">
                              No delivery records found. {schedule.status === 'pending' ? 'This announcement hasn\'t been sent yet.' : ''}
                            </div>
                          ) : (() => {
                            const sentEntries = deliveryLog.filter(l => l.status === 'sent')
                            const failedEntries = deliveryLog.filter(l => l.status === 'failed')
                            const pendingEntries = deliveryLog.filter(l => l.status === 'pending')

                            const systemBadge = (entry: DeliveryLogEntry) => {
                              if (entry.channel_type !== 'discord_dm' || !entry.recipient_response) return null
                              const isBlockedInvite = entry.recipient_response === 'invited' && entry.status === 'failed'
                              const isFirstMessage = entry.recipient_response === 'invited' && entry.status === 'sent'
                              let badge: { label: string; cls: string } | null = null
                              if (isBlockedInvite) {
                                badge = { label: 'Skipped', cls: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400' }
                              } else if (isFirstMessage) {
                                badge = { label: 'First Message', cls: 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400' }
                              } else if (entry.recipient_response === 'subscribed') {
                                badge = { label: 'Subscribed', cls: 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400' }
                              } else if (entry.recipient_response === 'unsubscribed') {
                                badge = { label: 'Skipped', cls: 'bg-slate-100 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400' }
                              } else if (entry.recipient_response === 'opted_out') {
                                badge = { label: 'Opted Out', cls: 'bg-red-100 dark:bg-red-950/30 text-red-600 dark:text-red-400' }
                              } else if (entry.recipient_response === 'muted_bot') {
                                badge = { label: 'Blocked Bot / Private', cls: 'bg-purple-100 dark:bg-purple-950/30 text-purple-600 dark:text-purple-400' }
                              }
                              if (!badge) return null
                              return <span className={`inline-flex px-1.5 py-0 rounded-full text-[9px] font-medium shrink-0 ${badge.cls}`}>{badge.label}</span>
                            }

                            return (
                              <div className="p-4 space-y-3">
                                {/* Full announcement message */}
                                <div className="text-xs text-foreground whitespace-pre-wrap bg-card/50 rounded p-3 border border-border/50">
                                  {schedule.body}
                                </div>
                                {/* Summary bar */}
                                <div className="flex items-center gap-4 text-xs flex-wrap">
                                  <span className="flex items-center gap-1.5">
                                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                                    {sentEntries.length} sent
                                  </span>
                                  {failedEntries.length > 0 && (
                                    <span className="flex items-center gap-1.5">
                                      <XCircle className="w-3.5 h-3.5 text-red-500" />
                                      {failedEntries.length} failed
                                    </span>
                                  )}
                                  {pendingEntries.length > 0 && (
                                    <span className="flex items-center gap-1.5">
                                      <Clock className="w-3.5 h-3.5 text-yellow-500" />
                                      {pendingEntries.length} pending
                                    </span>
                                  )}
                                  <span className="text-muted-foreground">
                                    {deliveryLog.length} total
                                  </span>
                                </div>
                                {/* Failed targets first */}
                                {failedEntries.length > 0 && (
                                  <div className="space-y-1">
                                    <p className="text-xs font-medium text-red-500">Failed deliveries:</p>
                                    {failedEntries.map(entry => (
                                      <div key={entry.id} className="flex items-center gap-2 px-3 py-1.5 rounded bg-red-50 dark:bg-red-950/40 text-xs flex-wrap">
                                        <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                                        {entry.channel_type === 'discord_dm' ? (
                                          <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                        ) : (
                                          <Hash className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                        )}
                                        <span className="truncate">{entry.target_label || entry.target_id}</span>
                                        {systemBadge(entry)}
                                        <span className="text-red-500 ml-auto shrink-0">
                                          {entry.recipient_response === 'muted_bot'
                                            ? 'User has DMs closed or muted the bot'
                                            : entry.error_message || 'Unknown error'}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {/* Successful deliveries */}
                                {sentEntries.length > 0 && (
                                  <div className="space-y-1">
                                    <p className="text-xs font-medium text-green-600 dark:text-green-400">Successful deliveries:</p>
                                    {sentEntries.map(entry => (
                                      <div key={entry.id} className="flex items-center gap-2 px-3 py-1.5 rounded bg-green-50 dark:bg-green-950/40 text-xs">
                                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                                        {entry.channel_type === 'discord_dm' ? (
                                          <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                        ) : (
                                          <Hash className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                        )}
                                        <span className="truncate">{entry.target_label || entry.target_id}</span>
                                        {systemBadge(entry)}
                                        {entry.delivered_at && (
                                          <span className="text-muted-foreground ml-auto shrink-0">{formatDateTimeDDMMYYYY(entry.delivered_at)}</span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })()}
                        </div>
                        )
                      })())}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════
            RESPONSES TAB
            ═══════════════════════════════════════════════════════ */}
        {activeTab === 'responses' && <ResponsesTab />}

        {/* ═══════════════════════════════════════════════════════
            DISCORD TAB
            ═══════════════════════════════════════════════════════ */}
        {activeTab === 'discord' && (
          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-primary" />
              <h3 className="font-medium">Swarm Coordinator Bot Integration</h3>
            </div>

            {loadingIntegration ? (
              <div className="text-center py-8">
                <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
              </div>
            ) : !integration ? (
              /* ── Not connected ── */
              <div className="space-y-4">
                <div className="border border-border rounded-lg p-6 text-center space-y-4">
                  <Bot className="w-12 h-12 mx-auto text-muted-foreground" />
                  <div>
                    <h4 className="font-medium">Connect to Discord</h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      Link your Discord account to send announcements to your server channels.
                    </p>
                  </div>

                  <div className="text-left max-w-md mx-auto space-y-3 text-sm">
                    <div className="flex items-start gap-2">
                      <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">1</span>
                      <span>Click below to generate your personal link key</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">2</span>
                      <span>Invite <strong>Swarm Coordinator</strong> to your Discord server(s)</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">3</span>
                      <span><strong>DM the key directly to the bot</strong> (recommended for privacy) or use <code className="px-1 py-0.5 bg-muted rounded text-xs">/link &lt;key&gt;</code> in a server</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">4</span>
                      <span>Select channels for announcements from this page</span>
                    </div>
                  </div>

                  <button
                    onClick={generateKey}
                    disabled={generatingKey}
                    className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 mx-auto transition-colors"
                  >
                    {generatingKey ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                    Generate Link Key
                  </button>
                </div>
              </div>
            ) : !integration.bot_verified ? (
              /* ── Key generated but not yet verified ── */
              <div className="space-y-4">
                <div className="border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 rounded-lg p-6 space-y-4">
                  <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
                    <Key className="w-5 h-5" />
                    <h4 className="font-medium">Awaiting Bot Verification</h4>
                  </div>

                  <p className="text-sm text-amber-600 dark:text-amber-400">
                    Your link key has been generated. Follow these steps to complete the connection:
                  </p>

                  {/* Link key display */}
                  <div className="bg-card rounded-lg p-3 flex items-center gap-2 border border-border">
                    <code className="flex-1 text-sm font-mono break-all">{integration.link_key}</code>
                    <button
                      onClick={() => copyKey(integration.link_key)}
                      className="p-2 rounded hover:bg-muted transition-colors shrink-0"
                      title="Copy key"
                    >
                      {keyCopied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>

                  <div className="text-sm space-y-2 text-amber-600 dark:text-amber-400">
                    <p>1. Invite the <strong>Swarm Coordinator</strong> bot to your server if you haven't yet</p>
                    <p>2. <strong>DM the key to the bot</strong> for privacy, or use <code className="px-1 py-0.5 bg-background rounded text-xs">/link {integration.link_key.slice(0, 12)}...</code> in a server</p>
                    <p>3. Once verified, refresh this page</p>
                  </div>

                  <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 text-xs text-blue-600 dark:text-blue-400 flex items-start gap-2">
                    <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>For security, we recommend sending the key via <strong>direct message</strong> to the bot instead of using /link in a public channel where others could see it.</span>
                  </div>

                  <div className="flex gap-2 flex-wrap">
                    <a
                      href={`https://discord.com/users/${import.meta.env.VITE_DISCORD_CLIENT_ID}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-[#5865F2] text-white hover:bg-[#4752C4] transition-colors"
                    >
                      <MessageSquare className="w-4 h-4" />
                      DM the Bot
                    </a>
                    <a
                      href={`https://discord.com/api/oauth2/authorize?client_id=${import.meta.env.VITE_DISCORD_CLIENT_ID}&permissions=3136&scope=bot%20applications.commands`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      Invite Bot to Server
                    </a>
                    <button
                      onClick={fetchIntegration}
                      className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Check Status
                    </button>
                    <button
                      onClick={generateKey}
                      disabled={generatingKey}
                      className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
                    >
                      <Key className="w-4 h-4" />
                      Regenerate Key
                    </button>
                  </div>

                  <p className="text-xs text-amber-500 dark:text-amber-600">
                    Key expires: {formatDateTimeDDMMYYYY(integration.link_key_expires_at)}
                  </p>
                </div>
              </div>
            ) : (
              /* ── Connected ── */
              <div className="space-y-6">
                {/* Connection status */}
                <div className="border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950 rounded-lg p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                    <div>
                      <p className="text-sm font-medium text-green-700 dark:text-green-300">
                        Connected as {integration.discord_username}
                      </p>
                      <p className="text-xs text-green-600 dark:text-green-400">
                        Linked {formatDateDDMMYYYY(integration.bot_verified_at!)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href={`https://discord.com/api/oauth2/authorize?client_id=${import.meta.env.VITE_DISCORD_CLIENT_ID}&permissions=3136&scope=bot%20applications.commands`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Invite Bot to Another Server
                    </a>
                    <button
                      onClick={disconnectDiscord}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                    >
                      <Unlink className="w-3.5 h-3.5" />
                      Disconnect
                    </button>
                  </div>
                </div>

                {/* Available Channels */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h4 className="text-sm font-medium">Server Channels</h4>
                      <p className="text-xs text-muted-foreground mt-0.5">Toggle channels on to use them for announcements</p>
                      {channelsLastSynced && (
                        <p className="text-xs text-muted-foreground/70 mt-0.5">
                          Last synced: {formatDateTimeDDMMYYYY(channelsLastSynced)}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => refreshGuilds(true)}
                      disabled={syncing}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border hover:bg-muted transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                      {syncing ? 'Syncing...' : 'Sync Channels'}
                    </button>
                  </div>

                  {guilds.length === 0 ? (
                    <div className="border border-border rounded-lg p-6 text-center space-y-3">
                      <Hash className="w-8 h-8 mx-auto text-muted-foreground" />
                      <div>
                        <p className="text-sm text-muted-foreground">
                          No channels found yet.
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Make sure the bot is invited to your server, then click "Sync Channels" above.
                        </p>
                      </div>
                      <button
                        onClick={() => refreshGuilds(true)}
                        disabled={syncing}
                        className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 mx-auto transition-colors"
                      >
                        <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                        Sync Now
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {guilds.map(guild => {
                        const activeCount = guild.channels.filter(c => c.is_active).length
                        const isCollapsed = collapsedGuilds[guild.guild_id] ?? true
                        return (
                          <div key={guild.guild_id} className="border border-border rounded-lg overflow-hidden">
                            <div className="flex items-center bg-muted/30">
                              <button
                                onClick={() => toggleGuildCollapsed(guild.guild_id)}
                                className="flex-1 px-4 py-2.5 flex items-center justify-between hover:bg-muted/50 transition-colors"
                              >
                                <div className="flex items-center gap-2">
                                  <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                                  <Users className="w-4 h-4 text-muted-foreground" />
                                  <span className="text-sm font-medium">{guild.guild_name}</span>
                                </div>
                                <span className="text-xs text-muted-foreground">
                                  {activeCount} / {guild.channels.length} active
                                </span>
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); removeGuild(guild.guild_id, guild.guild_name) }}
                                className="px-3 py-2.5 text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                                title={`Remove ${guild.guild_name}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            {!isCollapsed && (
                            <div className="p-2 space-y-0.5">
                              {guild.channels.map(ch => (
                                <button
                                  key={ch.channel_id}
                                  onClick={() => toggleChannelActive(ch.channel_id)}
                                  className={`w-full flex items-center justify-between py-2 px-3 rounded-lg transition-colors ${
                                    ch.is_active
                                      ? 'bg-primary/10 border border-primary/30'
                                      : 'hover:bg-muted/50'
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    <Hash className={`w-3.5 h-3.5 ${ch.is_active ? 'text-primary' : 'text-muted-foreground'}`} />
                                    <span className={`text-sm ${ch.is_active ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                                      {ch.channel_name}
                                    </span>
                                    {/* Permission indicators */}
                                    {ch.bot_can_send && ch.user_can_send && (
                                      <span title="Both you and the bot can send here"><ShieldCheck className="w-3 h-3 text-green-500" /></span>
                                    )}
                                    {!ch.bot_can_send && (
                                      <span className="flex items-center gap-1 text-xs text-amber-500" title="Bot cannot send messages to this channel">
                                        <ShieldAlert className="w-3 h-3" />
                                        Bot: no access
                                      </span>
                                    )}
                                    {!ch.user_can_send && (
                                      <span className="flex items-center gap-1 text-xs text-amber-500" title="You don't have permission to send messages in this channel">
                                        <ShieldAlert className="w-3 h-3" />
                                        You: no access
                                      </span>
                                    )}
                                  </div>
                                  <div className={`w-8 h-5 rounded-full transition-colors relative ${
                                    ch.is_active ? 'bg-primary' : 'bg-muted-foreground/30'
                                  }`}>
                                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-primary-foreground transition-transform ${
                                      ch.is_active ? 'translate-x-3.5' : 'translate-x-0.5'
                                    }`} />
                                  </div>
                                </button>
                              ))}
                            </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════
            EMAIL TAB
            ═══════════════════════════════════════════════════════ */}
        {activeTab === 'email' && (
          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-primary" />
              <h3 className="font-medium">Email Integration</h3>
            </div>

            {!emailIntegrationSetup ? (
              /* ── First-time visitor: describe features and start setup ── */
              <div className="space-y-4">
                <div className="border border-border rounded-lg p-6 text-center space-y-4">
                  <Mail className="w-12 h-12 mx-auto text-muted-foreground" />
                  <div>
                    <h4 className="font-medium">Email Distribution</h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      Reach people outside of Discord by sending announcements directly to email addresses.
                    </p>
                  </div>

                  <div className="text-left max-w-lg mx-auto space-y-3 text-sm">
                    <p className="font-medium text-foreground">How it works:</p>
                    <div className="flex items-start gap-2">
                      <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">1</span>
                      <span>Enable email integration below to get started</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">2</span>
                      <span>Build your contact list by adding emails manually, or let them appear automatically when users join your Coordination Calendars</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">3</span>
                      <span>Select email recipients in the Compose tab alongside Discord DMs</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">4</span>
                      <span>Recipients preferences are always respected and they can opt out at any time</span>
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-xs text-red-600 dark:text-red-400 flex items-start gap-2 max-w-lg mx-auto">
                    <Shield className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      Emails are used only to deliver announcements you write. We never spam, sell, or share addresses.
                      Recipients who create an account can choose which senders they hear from. Anyone who opts out will not receive further emails.
                    </span>
                  </div>

                  <button
                    onClick={startEmailIntegration}
                    className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 mx-auto transition-colors"
                  >
                    <Mail className="w-4 h-4" />
                    Start Email Integration
                  </button>
                </div>
              </div>
            ) : (
              /* ── Email contacts management ── */
              <div className="space-y-6">
                {/* Disable integration option */}
                <div className="flex items-center justify-end">
                  <button
                    onClick={disableEmailIntegration}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-red-500 transition-colors"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Disable Email Integration
                  </button>
                </div>

                {/* ── Verified Email Addresses ── */}
                <div className="border border-red-200 dark:border-red-800/50 rounded-lg overflow-hidden">
                  <button
                    onClick={() => setVerifiedEmailsCollapsed(prev => !prev)}
                    className="w-full flex items-center gap-2 p-4 text-left hover:bg-red-50/50 dark:hover:bg-red-950/20 transition-colors"
                  >
                    {verifiedEmailsCollapsed ? <ChevronRight className="w-4 h-4 text-red-400" /> : <ChevronDown className="w-4 h-4 text-red-400" />}
                    <ShieldCheck className="w-4 h-4 text-red-500" />
                    <h4 className="text-sm font-medium text-red-700 dark:text-red-400">Verified Email Addresses</h4>
                    <span className="text-[10px] text-red-500 dark:text-red-400 font-medium">Private</span>
                    {verifiedEmails.length > 0 && (
                      <span className="text-xs text-muted-foreground">({verifiedEmails.length})</span>
                    )}
                  </button>

                  {!verifiedEmailsCollapsed && (
                  <div className="p-4 space-y-4 border-t border-border">
                    <p className="text-xs text-muted-foreground">
                      Verified emails serve as both your receiving address and your sender identity. Your primary email is used for notifications and appears in the "sent by" attribution on announcements.
                    </p>

                    {/* Warning when email notifications are disabled */}
                    {notifChannelEmail === false && (
                      <div className="flex items-center justify-between p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
                        <div className="flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                          <p className="text-xs text-amber-700 dark:text-amber-400">
                            Email notifications are disabled. You won't receive any emails until you enable them in Notification settings.
                          </p>
                        </div>
                        <button
                          onClick={async () => {
                            try {
                              const res = await apiClient.get('/api/notification-preferences')
                              const p = res.data.preferences
                              const channels: string[] = p?.preferred_channels || []
                              const updatedChannels = channels.includes('Email') ? channels : [...channels, 'Email']
                              const channelToggles: Record<string, boolean> = { 'Email': true, 'Discord DM': channels.includes('Discord DM') }
                              await apiClient.put('/api/notification-preferences', {
                                preference_description: p?.preference_description || '',
                                preferred_channels: updatedChannels,
                                preference_visibility: p?.preference_visibility || 'private',
                                channel_toggles: channelToggles,
                                channel_priority: updatedChannels,
                              })
                              setNotifChannelEmail(true)
                            } catch (err) {
                              console.error('Failed to enable email notifications:', err)
                            }
                          }}
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
                      <div className="space-y-2">
                        {verifiedEmails.map(ve => (
                          <div key={ve.id} className="flex items-center justify-between p-3 border border-border rounded-lg bg-muted/30">
                            <div className="flex items-center gap-2">
                              <Mail className="w-4 h-4 text-muted-foreground" />
                              <span className="text-sm font-medium">{ve.email}</span>
                              {ve.is_primary ? (
                                <span className="px-1.5 py-0.5 bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400 text-[10px] font-medium rounded">Primary</span>
                              ) : (
                                <button
                                  onClick={() => handleSetPrimaryEmail(ve.id)}
                                  className="px-2.5 py-1 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-medium rounded-md border border-primary/20 transition-colors"
                                >
                                  Set Primary
                                </button>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => handleRemoveVerifiedEmail(ve.id)}
                                className="text-xs text-red-500 hover:underline"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
                        <p className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 flex-shrink-0" />
                          No verified emails yet. Verify an email below to receive notifications and use it as your sender identity.
                        </p>
                      </div>
                    )}

                    {/* Verify Google email (one-click) */}
                    {!isCardano && user?.email && !verifiedEmails.some(ve => ve.email === user.email?.toLowerCase()) && (
                      <div className="p-3 border border-border rounded-lg bg-card">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <ShieldCheck className="w-4 h-4 text-green-500" />
                            <span className="text-sm">Verify your Google email: <strong>{user.email}</strong></span>
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
                        <div className="flex gap-2">
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
                            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
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
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={verifyCodeInput}
                              onChange={e => setVerifyCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                              placeholder="123456"
                              maxLength={6}
                              className="w-32 px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground text-center tracking-widest font-mono focus:ring-2 focus:ring-ring outline-none"
                              disabled={verifyStep === 'verifying'}
                            />
                            <button
                              onClick={handleVerifyCode}
                              disabled={verifyCodeInput.length !== 6 || verifyStep === 'verifying'}
                              className="flex items-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                            >
                              {verifyStep === 'verifying' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
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
                      <div className={`p-2.5 rounded-lg text-xs flex items-center gap-2 ${
                        verifyResult.type === 'success'
                          ? 'bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
                          : 'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
                      }`}>
                        {verifyResult.type === 'success' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                        {verifyResult.message}
                      </div>
                    )}

                    <p className="text-[10px] text-muted-foreground">
                      These are the same verified emails shown in Settings &rarr; Privacy &rarr; Email &amp; Contact.
                    </p>
                  </div>
                  )}
                </div>

                {/* ── Your Email Configuration ── */}
                <div className="border border-red-200 dark:border-red-800/50 rounded-lg overflow-hidden">
                  <button
                    onClick={() => setEmailConfCollapsed(prev => !prev)}
                    className="w-full flex items-center gap-2 p-4 text-left hover:bg-red-50/50 dark:hover:bg-red-950/20 transition-colors"
                  >
                    {emailConfCollapsed ? <ChevronRight className="w-4 h-4 text-red-400" /> : <ChevronDown className="w-4 h-4 text-red-400" />}
                    <Key className="w-4 h-4 text-red-500" />
                    <h4 className="text-sm font-medium text-red-700 dark:text-red-400">Your Email Configuration</h4>
                    {emailServiceStatus?.userConfig?.verified && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950 px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="w-3 h-3" /> Verified
                      </span>
                    )}
                    <span className="text-[10px] text-red-500 dark:text-red-400 font-medium">Private</span>
                  </button>

                  {!emailConfCollapsed && (
                  <div className="p-4 space-y-4 border-t border-border">
                  <p className="text-xs text-muted-foreground">
                    Configure your own email to send announcements from your address.
                    {emailServiceStatus?.platformConfigured && (
                      <> Without a personal config, emails are sent from <span className="font-medium text-foreground">{emailServiceStatus.platformFrom}</span>.</>
                    )}
                  </p>

                  {!emailServiceStatus?.encryptionAvailable ? (
                    <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>
                        Custom email configuration is not available yet. The server needs a <code className="px-1 py-0.5 bg-muted rounded text-[10px]">SMTP_ENCRYPTION_KEY</code> to securely store credentials.
                        {emailServiceStatus?.platformConfigured && ' You can still send emails using the platform default sender.'}
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="p-2.5 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-xs text-blue-700 dark:text-blue-400 flex items-start gap-2">
                        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>
                          For Gmail, use an <strong>App Password</strong> (not your regular password).
                          Go to <span className="font-medium">Google Account &rarr; Security &rarr; 2-Step Verification &rarr; App passwords</span> to generate one.
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2 sm:col-span-1">
                          <label className="text-xs text-muted-foreground block mb-1">Email Address *</label>
                          <input
                            type="email"
                            value={smtpEmail}
                            onChange={e => setSmtpEmail(e.target.value)}
                            placeholder="you@gmail.com"
                            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:ring-2 focus:ring-ring outline-none"
                          />
                        </div>
                        <div className="col-span-2 sm:col-span-1">
                          <label className="text-xs text-muted-foreground block mb-1">App Password *</label>
                          <input
                            type="password"
                            value={smtpPassword}
                            onChange={e => setSmtpPassword(e.target.value)}
                            placeholder={emailServiceStatus?.userConfig ? '(saved - enter new to update)' : 'xxxx xxxx xxxx xxxx'}
                            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:ring-2 focus:ring-ring outline-none"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground block mb-1">Display Name (optional)</label>
                          <input
                            type="text"
                            value={smtpDisplayName}
                            onChange={e => setSmtpDisplayName(e.target.value)}
                            placeholder="Your Name"
                            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:ring-2 focus:ring-ring outline-none"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground block mb-1">SMTP Host</label>
                          <input
                            type="text"
                            value={smtpHost}
                            onChange={e => setSmtpHost(e.target.value)}
                            placeholder="smtp.gmail.com"
                            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:ring-2 focus:ring-ring outline-none"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground block mb-1">SMTP Port</label>
                          <input
                            type="text"
                            value={smtpPort}
                            onChange={e => setSmtpPort(e.target.value)}
                            placeholder="587"
                            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:ring-2 focus:ring-ring outline-none"
                          />
                        </div>
                      </div>

                      {smtpResult && (
                        <div className={`flex items-center gap-2 p-2.5 rounded-lg text-xs ${
                          smtpResult.type === 'success'
                            ? 'bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
                            : 'bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                        }`}>
                          {smtpResult.type === 'success' ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 shrink-0" />}
                          {smtpResult.message}
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <button
                          onClick={saveSmtpConfig}
                          disabled={savingSmtp || !smtpEmail.trim() || !smtpPassword.trim()}
                          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                        >
                          {savingSmtp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          Save
                        </button>
                        {emailServiceStatus?.userConfig && (
                          <>
                            <button
                              onClick={testSmtpConnection}
                              disabled={testingSmtp}
                              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-primary text-primary hover:bg-primary/10 disabled:opacity-50 transition-colors"
                            >
                              {testingSmtp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                              Test Connection
                            </button>
                            <button
                              onClick={deleteSmtpConfig}
                              className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground hover:text-red-500 transition-colors ml-auto"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Remove
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                  </div>
                  )}
                </div>

                {/* Add / Import Contacts — single collapsible section */}
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium">Add Email Contacts</span>
                  <LearnerHelpIcon
                    description={<><p className="font-semibold text-blue-700 dark:text-blue-300 mb-1">Who is this for?</p><p className="mb-1.5">Add email addresses of people you want to reach with announcements outside of Discord -- collaborators, community members, or stakeholders who prefer email.</p><p className="mb-1.5">Only add emails of people you intend to communicate with. If someone opts out, they will not receive further messages from you through Coordination Manager.</p><p>Contacts added here appear in the <strong>Compose</strong> tab as selectable email recipients alongside Discord channels and DMs.</p></>}
                    size={4}
                    className="shrink-0"
                  />
                </div>
                <div className="border border-border rounded-lg overflow-hidden">
                  <button
                    onClick={() => setAddContactCollapsed(prev => !prev)}
                    className="w-full flex items-center gap-2 p-4 text-left hover:bg-muted/50 transition-colors"
                  >
                    {addContactCollapsed ? <ChevronRight className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    <h4 className="text-sm font-medium">Add / Import Email Contacts</h4>
                  </button>

                  {!addContactCollapsed && (
                  <div className="p-4 space-y-5 border-t border-border">
                    {/* ── Single contact ── */}
                    <div>
                      <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Single Contact</h5>
                      <div className="flex items-end gap-2 flex-wrap">
                        <div className="flex-1 min-w-[140px]">
                          <label className="text-xs text-muted-foreground block mb-1">Display Name (optional)</label>
                          <input
                            type="text"
                            value={addEmailName}
                            onChange={e => setAddEmailName(e.target.value)}
                            placeholder="e.g., John Doe"
                            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:ring-2 focus:ring-ring outline-none"
                          />
                        </div>
                        <div className="flex-1 min-w-[180px]">
                          <label className="text-xs text-muted-foreground block mb-1">Email Address</label>
                          <input
                            type="email"
                            value={addEmailAddress}
                            onChange={e => setAddEmailAddress(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addEmailContact() } }}
                            placeholder="email@example.com"
                            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:ring-2 focus:ring-ring outline-none"
                          />
                        </div>
                        <div className="flex-1 min-w-[140px]">
                          <label className="text-xs text-muted-foreground block mb-1">Tags (optional, comma-separated)</label>
                          <input
                            type="text"
                            value={addEmailTags}
                            onChange={e => setAddEmailTags(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addEmailContact() } }}
                            placeholder="e.g., team, vip"
                            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:ring-2 focus:ring-ring outline-none"
                          />
                        </div>
                        <button
                          onClick={addEmailContact}
                          disabled={addingEmail || !addEmailAddress.trim()}
                          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                        >
                          {addingEmail ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                          Add
                        </button>
                      </div>
                    </div>

                    <hr className="border-border" />

                    {/* ── Mass import ── */}
                    <div>
                      <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Mass Import</h5>
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs text-muted-foreground block mb-1">Email Addresses (comma, semicolon, or newline separated)</label>
                            <textarea
                              value={bulkEmailInput}
                              onChange={e => { setBulkEmailInput(e.target.value); setBulkImportResult(null) }}
                              placeholder={"alice@example.com, bob@example.com;\ncarol@example.com"}
                              rows={4}
                              className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:ring-2 focus:ring-ring outline-none resize-y"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground block mb-1">Display Names (optional -- matched by position, same separator)</label>
                            <textarea
                              value={bulkNamesInput}
                              onChange={e => setBulkNamesInput(e.target.value)}
                              placeholder={"Alice Smith, Bob Jones;\nCarol Lee"}
                              rows={4}
                              className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:ring-2 focus:ring-ring outline-none resize-y"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground block mb-1">Tags for all imported contacts (optional, comma-separated)</label>
                          <input
                            type="text"
                            value={bulkTagsInput}
                            onChange={e => setBulkTagsInput(e.target.value)}
                            placeholder="e.g., newsletter, batch-march-2026"
                            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:ring-2 focus:ring-ring outline-none"
                          />
                        </div>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={bulkImportEmails}
                            disabled={bulkImporting || !bulkEmailInput.trim()}
                            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                          >
                            {bulkImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                            Import All
                          </button>
                          {bulkImportResult && (
                            <span className="text-xs text-muted-foreground">
                              {bulkImportResult.imported} imported{bulkImportResult.skipped > 0 ? `, ${bulkImportResult.skipped} skipped (max 200)` : ''}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  )}
                </div>

                {/* ── Email Contacts List ── */}
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium">Email Contacts</span>
                  <span className="text-xs text-muted-foreground">({emailContacts.length})</span>
                  <LearnerHelpIcon
                    description={<><p className="font-semibold text-blue-700 dark:text-blue-300 mb-1">Source types explained</p><ul className="list-disc list-inside space-y-0.5"><li><span className="font-medium text-blue-600 dark:text-blue-400">Manual</span>: you typed this email address yourself</li><li><span className="font-medium text-green-600 dark:text-green-400">Verified</span>: the platform has verified this email belongs to a user account</li><li><span className="font-medium text-purple-600 dark:text-purple-400">Both</span>: you added it manually and the platform has also verified the account</li></ul><p className="mt-2">Not all members may show emails here. If someone has turned off Notification Channels in their settings, they will appear with a "Disabled" status and will not receive emails through this system.</p></>}
                    size={4}
                    className="shrink-0"
                  />
                </div>
                <div className="border border-border rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setContactsListCollapsed(prev => !prev)} className="flex items-center gap-1 hover:text-primary transition-colors">
                        {contactsListCollapsed ? <ChevronRight className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                        <span className="text-sm font-medium">Email Contacts</span>
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowEmails(!showEmails)}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {showEmails ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        {showEmails ? 'Hide Emails' : 'Show Emails'}
                      </button>
                      <button
                        onClick={fetchEmailContacts}
                        disabled={loadingEmailContacts}
                        className="flex items-center gap-1.5 text-xs text-primary hover:underline disabled:opacity-50"
                      >
                        {loadingEmailContacts ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                        Refresh
                      </button>
                    </div>
                  </div>

                  {!contactsListCollapsed && (loadingEmailContacts ? (
                    <div className="text-center py-8">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
                    </div>
                  ) : emailContacts.length === 0 ? (
                    <div className="px-4 py-8 text-center">
                      <Mail className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                      <p className="text-sm text-muted-foreground">No email contacts yet. Add your first contact above.</p>
                    </div>
                  ) : (
                    <>
                      {/* Table header */}
                      <div className="grid grid-cols-[1fr_1.5fr_1fr_80px_80px_80px] gap-2 px-3 py-2 bg-muted/30 text-xs font-medium text-muted-foreground border-b border-border">
                        <div>Name</div>
                        <div>Email</div>
                        <div>Tags</div>
                        <div>Source</div>
                        <div>Status</div>
                        <div></div>
                      </div>
                      {/* Table rows */}
                      <div className="divide-y divide-border max-h-[400px] overflow-y-auto">
                        {emailContacts.map(contact => {
                          const isEditing = editingContactId === contact.id
                          const sourceLabel = {
                            manual: 'Manual',
                            platform_verified: 'Verified',
                            both: 'Both',
                          }[contact.source]
                          const sourceBg = {
                            manual: 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400',
                            platform_verified: 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400',
                            both: 'bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400',
                          }[contact.source]

                          if (isEditing) {
                            return (
                              <div key={contact.id} className="px-3 py-2.5 space-y-2 bg-muted/20">
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                  <div>
                                    <label className="text-[10px] text-muted-foreground block mb-0.5">Name</label>
                                    <input
                                      type="text"
                                      value={editName}
                                      onChange={e => setEditName(e.target.value)}
                                      placeholder="Display name"
                                      className="w-full px-2 py-1.5 border border-input rounded text-xs bg-background text-foreground focus:ring-2 focus:ring-ring outline-none"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[10px] text-muted-foreground block mb-0.5">Email</label>
                                    <input
                                      type="email"
                                      value={editEmail}
                                      onChange={e => setEditEmail(e.target.value)}
                                      placeholder="email@example.com"
                                      className="w-full px-2 py-1.5 border border-input rounded text-xs bg-background text-foreground focus:ring-2 focus:ring-ring outline-none"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[10px] text-muted-foreground block mb-0.5">Tags (comma-separated)</label>
                                    <input
                                      type="text"
                                      value={editTags}
                                      onChange={e => setEditTags(e.target.value)}
                                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveEditingContact() } }}
                                      placeholder="e.g., team, vip"
                                      className="w-full px-2 py-1.5 border border-input rounded text-xs bg-background text-foreground focus:ring-2 focus:ring-ring outline-none"
                                    />
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={saveEditingContact}
                                    disabled={savingEdit || !editEmail.trim()}
                                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                                  >
                                    {savingEdit ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                    Save
                                  </button>
                                  <button
                                    onClick={cancelEditingContact}
                                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
                                  >
                                    <X className="w-3 h-3" />
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )
                          }

                          return (
                            <div key={contact.id} className={`grid grid-cols-[1fr_1.5fr_1fr_80px_80px_80px] gap-2 px-3 py-2.5 items-center text-sm ${contact.opted_out ? 'opacity-50' : ''}`}>
                              <div className="truncate font-medium text-xs">{contact.display_name || '--'}</div>
                              <div className="truncate text-xs text-muted-foreground">
                                {showEmails ? contact.email : contact.email.replace(/(.{2})(.*)(@.*)/, '$1***$3')}
                              </div>
                              <div className="flex flex-wrap gap-1 overflow-hidden">
                                {(contact.tags || []).length > 0 ? (contact.tags || []).map(tag => (
                                  <span key={tag} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
                                    <Tag className="w-2.5 h-2.5" />{tag}
                                  </span>
                                )) : <span className="text-[10px] text-muted-foreground">--</span>}
                              </div>
                              <div>
                                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${sourceBg}`}>
                                  {sourceLabel}
                                </span>
                              </div>
                              <div>
                                {contact.opted_out ? (
                                  <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                                    <XCircle className="w-3 h-3" /> Opted out
                                  </span>
                                ) : contact.notification_disabled ? (
                                  <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400" title="This user has disabled emails from Coordination Manager in their Notification Channels settings">
                                    <AlertTriangle className="w-3 h-3" /> Disabled
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">
                                    <CheckCircle2 className="w-3 h-3" /> Active
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center justify-end gap-1">
                                {contact.source === 'manual' && (
                                  <>
                                    <button
                                      onClick={() => startEditingContact(contact)}
                                      className="text-muted-foreground hover:text-primary transition-colors p-1"
                                      title="Edit contact"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => removeEmailContact(contact.id)}
                                      className="text-muted-foreground hover:text-red-500 transition-colors p-1"
                                      title="Remove contact"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                      {/* Summary */}
                      <div className="px-3 py-2 bg-muted/30 border-t border-border text-xs text-muted-foreground">
                        {emailContacts.filter(c => !c.opted_out && !c.notification_disabled).length} active of {emailContacts.length} contact(s)
                        {emailContacts.some(c => c.opted_out) && (
                          <span className="ml-2">· {emailContacts.filter(c => c.opted_out).length} opted out</span>
                        )}
                        {emailContacts.some(c => c.notification_disabled) && (
                          <span className="ml-2 text-amber-500">· {emailContacts.filter(c => c.notification_disabled).length} disabled notifications</span>
                        )}
                      </div>
                    </>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
