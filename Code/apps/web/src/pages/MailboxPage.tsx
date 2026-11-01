import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getMailboxScanVisibleCount } from './mailbox-scan-count'
import {
  Archive,
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarCheck,
  CalendarPlus,
  Check,
  CircleOff,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CornerDownLeft,
  Forward,
  HelpCircle,
  Inbox,
  Link,
  Mail,
  MailOpen,
  Loader2,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Tag,
  Trash2,
  createLucideIcon,
  X,
  UserRound,
} from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { apiClient, dedupedGet } from '../lib/api-client'
import MailboxReplyFeedback from '@/components/mailbox-reply-feedback'
import { getSessionCacheValue, isSessionCacheFresh, setSessionCacheValue } from '../lib/session-data-cache'
import { buildOutlookCalendarUrl, downloadICSFile } from '../lib/calendar-utils'
import { detectDateTimeCandidates, detectedLocalToIso } from '../lib/date-time-detection'
import { getMailboxPullStep } from '../lib/mailbox-pull-slider'
import { recoverGmailPlainTextAlternative, splitQuotedBody } from '@/lib/mailbox-quote'
import { buildSystemSortId, isMessageVisible, sortMailboxMessages, type MailboxSortState } from './mailbox-sort'
import {
  MAILBOX_DEFAULT_FILTER_ID,
  MAILBOX_FILTERS_STATE_KEY_PREFIX,
  MAILBOX_MAX_FILTERS,
  MAILBOX_PRIMARY_FILTER_KEY_PREFIX,
  buildCustomMailboxFilter,
  buildDefaultMailboxFilterState,
  canCreateMailboxFilter,
  canDeleteMailboxFilter,
  hasStoredMailboxFilterState,
  isPrimaryMailboxFilter,
  makeMailboxFilterPrimary,
  orderMailboxFiltersPrimaryFirst,
  parseMailboxFilterState,
  readMailboxFilterState,
  readMailboxPrimaryFilterId,
  resolveActiveSortState,
  resolveEffectiveTagModes,
  writeMailboxFilterState,
  writeMailboxPrimaryFilterId,
  type MailboxFilterState,
} from './mailbox-filters'
import {
  buildTrustedEmailSrcDoc,
  collapseDuplicateInvitations,
  extractDomainFromEmail,
  formatInvitationSummaryLine,
  getInvitationAddActionState,
  getInvitationMetaBadges,
  invitationIdentityKey,
  isMailboxMessageJunk,
  isoToLocalDateTimeParts,
  localDateTimeToIso,
  normalizeSenderIdentity,
  requiresMailboxReconnect,
  readMailboxBulkOutcomes,
  reconcileMailboxBulkOutcomes,
  syncRequestTimeoutMs,
} from './mailbox-page-helpers'
import {
  CalendarDeliveryError,
  getCalendarDeliveryRetryDelay,
  isRetryableCalendarDeliveryError,
  type CalendarDeliveryNotice,
  type CalendarDeliveryTarget,
} from './mailbox-calendar-delivery'
import { createPendingTrashOverlay } from './mailbox-pending-trash'
import {
  buildDefaultMailboxNotificationRulesState,
  buildMailboxNotificationFlagKey,
  NAV_QUICK_TOOLS_CHANGED_EVENT,
  parseMailboxNotificationRulesState,
  readIsMailboxPinnedToQuickMenu,
  MAILBOX_REMOTE_NEW_MAIL_EVENT,
  readMailboxNotificationEligibility,
  readMailboxNotificationRulesState,
  requestPinMailboxToQuickMenu,
  resolveEffectiveNotifyModes,
  shouldNotifyForMessage,
  writeMailboxNotificationEligibility,
  writeMailboxNotificationFlag,
  writeMailboxNotificationRulesState,
  type MailboxNotificationRulesState,
} from './mailbox-notifications'
import { AnimatedTabBar } from '../components/AnimatedTabBar'
import { MailboxMobileNavigation } from '@/components/mailbox-mobile-navigation'
import MailboxSortOrderEditor from '../components/MailboxSortOrderEditor'
import MailboxNotificationRulesEditor from '../components/MailboxNotificationRulesEditor'
import MailboxAutomationEditor from '../components/MailboxAutomationEditor'
import MailboxAutomationPanel from '../components/MailboxAutomationPanel'
import {
  MailboxMassActionsPanel,
  type MailboxMassActionResult,
} from '../components/MailboxMassActionsPanel'
import {
  MAX_AUTOMATION_RULES,
  automationRuleFingerprint,
  buildEmptyAutomationRule,
  describeAutomationRunResult,
  validateAutomationRule,
  type AutomationActionType,
  type AutomationConditionStep,
  type AutomationRuleDefinition,
  type AutomationRuleRecord,
  type AutomationRunResult,
} from './mailbox-automation'
import {
  buildMailboxAssistantState,
  describeAssistantRule,
  parseMailboxAssistantPlan,
} from './mailbox-automation-assistant'
import {
  DEFAULT_MAILBOX_AI_ACCESS,
  MAILBOX_AI_ACCESS_ENTRIES,
  buildMailboxAiAccess,
  normalizeMailboxAiAccess,
  buildMailboxFeatureRequestMessage,
  type MailboxAiAccessConfig,
  type MailboxAiAccessId,
} from './mailbox-ai-access'
import {
  formatDateTimeWithUserPreference,
  readUserDateFormatFromLocalStorage,
} from '../lib/date-format-preferences'
import { getEditingTimezone } from '../lib/timezone-data'
import { useAuth } from '../contexts/AuthContext'
import { useAiAssistant } from '../contexts/AiAssistantContext'
import { buildAiEvaluation, isMutationRequest, type AiEvaluation, type AiRetryRequest } from '../lib/ai-evaluation'
import { LeftPanelPortal, RightPanelPortal } from '../contexts/LayoutContext'
import { useMobileNavigationPanelDismiss } from '../hooks/use-mobile-navigation-panel-dismiss'
import { AddToCalendarShell } from '../components/AddToCalendarShell'
import { Dialog } from '../components/ui/Dialog'
import { Button } from '../components/ui/Button'
import { IconButton } from '../components/ui/IconButton'
import { ToggleButton } from '../components/ui/ToggleButton'
import { Disclosure } from '../components/ui/Disclosure'
import { OVERLAY_SCRIM } from '../lib/overlay-layers'
import { useOverlayLayer } from '../lib/use-overlay-layer'
import { clampTopBelowObstruction } from '../lib/top-obstruction'
import { ChoiceDialog } from '../components/ui/ChoiceDialog'
import ConfirmDialog from '../components/ConfirmDialog'
import {
  persistAddToCalendarDisplayMode,
  readAddToCalendarDisplayMode,
  type AddToCalendarDisplayMode,
} from '../components/add-to-calendar-shell-state'

const TrashRestore = createLucideIcon('TrashRestore', [
  ['path', { d: 'M6 10v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V10', key: 'bin' }],
  ['path', { d: 'M3 7h5m8 0h5', key: 'lid' }],
  ['path', { d: 'M12 14V2m-3 3 3-3 3 3', key: 'restore-arrow' }],
])

interface MailAccount {
  id: string
  provider: 'gmail' | 'outlook' | 'imap'
  address: string
  display_name: string | null
  identity_group: string
  status: 'connected' | 'syncing' | 'error' | 'disconnected'
  is_primary: boolean
  connected_at: string
  last_sent_at: string | null
  quick_sync_after: string | null
  quick_sync_max_messages: number
  last_synced_at: string | null
  sync_error: string | null
  sync_error_kind: 'auth' | 'transient' | null
  sync_options: AccountSyncOptions | null
}

interface MessageAccount {
  id: string
  provider: string
  address: string
  display_name: string | null
  identity_group: string
}

interface MailMessage {
  id: string
  account_id: string
  thread_id: string | null
  subject: string | null
  from_email: string | null
  from_name: string | null
  to_emails: string | null
  cc_emails: string | null
  bcc_emails: string | null
  received_at: string | null
  preview: string | null
  is_read: boolean
  is_archived: boolean
  has_attachments: boolean
  user_tag_ids: string[]
  is_provider_trashed: boolean
  is_provider_junk: boolean
  is_provider_sent: boolean
  /** Set on synthetic rows that represent a locally saved draft rather than a synced message. */
  is_draft?: boolean
  draft_id?: string
  account: MessageAccount | null
}

interface MailActivityEvent {
  id: string
  action: string
  action_value: string | null
  source_type: 'manual' | 'rule' | 'import'
  source_rule_id: string | null
  rule_name: string | null
  chain_id: string
  depth: number
  created_at: string
}

interface MailActivityLog {
  arrived_at: string | null
  system_tags: string[]
  events: MailActivityEvent[]
}

interface MailThread {
  id: string
  account_id: string
  normalized_subject: string | null
  latest_message_at: string | null
  message_count: number
  participants: unknown
}

interface ThreadMessage {
  id: string
  provider_message_id?: string | null
  subject: string | null
  from_email: string | null
  from_name: string | null
  to_emails: string | null
  cc_emails: string | null
  bcc_emails: string | null
  received_at: string | null
  preview: string | null
  body_text: string | null
  body_html_sanitized: string | null
  is_read: boolean
  is_archived: boolean
  user_tag_ids: string[]
  is_provider_trashed: boolean
  is_provider_junk: boolean
  is_provider_sent: boolean
  reply_to?: string | null
  encryption_type?: string | null
  is_replied?: boolean
  replied_by_message_id?: string | null
}

interface CachedThread {
  thread: MailThread | null
  messages: ThreadMessage[]
}

interface PendingSentReply {
  threadId: string
  sourceMessageId: string
  message: ThreadMessage
  knownMessageIds: Set<string>
  importedMessage?: ThreadMessage
}

interface MailboxTagItem {
  id: string
  label: string
  color: string
  sort_order: number
}

interface MailAttachmentSummary {
  id: string
  filename: string
  mime_type: string | null
  size_bytes: number | null
}

interface ThreadAttachmentEntry extends MailAttachmentSummary {
  message_id: string
}

interface MailContactIdentity {
  id: string
  email: string
  provider_source: string | null
  confidence: number | null
  is_primary: boolean
  is_user_override: boolean
  label: string | null
}

interface MailPerson {
  id: string
  display_name: string | null
  notes: string | null
  last_interaction_at: string | null
  interaction_count: number
  labels: string[]
  region: string | null
  timezone: string | null
  sent_count: number
  received_count: number
  last_sent_at: string | null
  last_received_at: string | null
  identities: MailContactIdentity[]
}

interface MailInvitation {
  id: string
  message_id: string | null
  summary: string | null
  location: string | null
  organizer: string | null
  starts_at: string | null
  ends_at: string | null
  status: string
  uid: string
  provider_event_ref?: string | null
  source_email?: string | null
  source_deleted?: boolean | null
  source_received_at?: string | null
  // Client-only: set when duplicate announcements were merged into this card.
  merged_count?: number
}

interface CalendarSourceTarget {
  id: string
  display_name: string | null
  source_type: string
  is_active: boolean
}

interface CoordinationCalendarTarget {
  id: string
  hash: string
  title: string
  visibility: string
  created_by: string | null
  updated_at?: string
  created_at?: string
}

interface TimeManagerModeTarget {
  id: string
  name: string
}

interface TimeManagerCategoryTarget {
  id: string
  mode_id: string
  label: string
  color: string
  font_color?: string
}

type MailDraftMode = 'reply' | 'forward' | 'new'

type MailDraftRecipientField = 'to' | 'cc' | 'bcc'

interface MailDraftRecord {
  id: string
  account_id: string
  thread_id: string | null
  in_reply_to_message_id: string | null
  mode: MailDraftMode
  from_address: string
  to_emails: string | null
  cc_emails: string | null
  bcc_emails: string | null
  subject: string | null
  body_text: string | null
  attachments: MailDraftAttachment[] | null
  status: 'draft' | 'sent'
  updated_at: string
}

interface MailDraftAttachment {
  filename: string
  contentType: string
  contentBase64: string
}

interface MailDraft {
  id: string | null
  mode: MailDraftMode
  accountId: string
  fromAddress: string
  threadId: string | null
  inReplyToMessageId: string | null
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  body: string
  attachments: MailDraftAttachment[]
}

interface AccountImportConfig {
  maxMessages: number
  daysBack: number
  includeInbox: boolean
  includeSent: boolean
  includeTrash: boolean
  includeSpam: boolean
  includeArchived: boolean
}

interface AccountQuickSyncConfig {
  includeInbox: boolean
  includeSent: boolean
  includeTrash: boolean
  includeSpam: boolean
  includeArchived: boolean
}

interface MailboxThreadingOptions {
  sameNameAndEmail: boolean
  sameNameAndEmailDays: number
  sameNameWithoutReply: boolean
  sameNameWithoutReplyDays: number
  sameNameWithinSevenDays: boolean
  sameNameWithinDays: number
  sameEmailWithoutReply: boolean
  sameEmailWithoutReplyDays: number
  sameEmailWithinSevenDays: boolean
  sameEmailWithinDays: number
}

const DEFAULT_MAILBOX_THREADING_OPTIONS: MailboxThreadingOptions = {
  sameNameAndEmail: false,
  sameNameAndEmailDays: 7,
  sameNameWithoutReply: false,
  sameNameWithoutReplyDays: 7,
  sameNameWithinSevenDays: false,
  sameNameWithinDays: 7,
  sameEmailWithoutReply: false,
  sameEmailWithoutReplyDays: 7,
  sameEmailWithinSevenDays: false,
  sameEmailWithinDays: 7,
}

interface AccountSyncOptions extends Partial<AccountImportConfig> {
  quickSyncIncludeInbox?: boolean
  quickSyncIncludeSent?: boolean
  quickSyncIncludeTrash?: boolean
  quickSyncIncludeSpam?: boolean
  quickSyncIncludeArchived?: boolean
}

const DEFAULT_ACCOUNT_IMPORT_CONFIG: AccountImportConfig = {
  maxMessages: 40,
  daysBack: 1,
  includeInbox: true,
  includeSent: true,
  includeTrash: true,
  includeSpam: true,
  includeArchived: true,
}

function normalizeAccountImportConfig(value: unknown): AccountImportConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_ACCOUNT_IMPORT_CONFIG
  }

  const candidate = value as Record<string, unknown>
  const maxMessages = Number(candidate.maxMessages)
  const daysBack = Number(candidate.daysBack)
  return {
    maxMessages: Number.isFinite(maxMessages)
      ? Math.min(500, Math.max(25, Math.floor(maxMessages)))
      : DEFAULT_ACCOUNT_IMPORT_CONFIG.maxMessages,
    daysBack: Number.isFinite(daysBack)
      ? Math.min(365, Math.max(1, Math.floor(daysBack)))
      : DEFAULT_ACCOUNT_IMPORT_CONFIG.daysBack,
    includeInbox:
      typeof candidate.includeInbox === 'boolean'
        ? candidate.includeInbox
        : DEFAULT_ACCOUNT_IMPORT_CONFIG.includeInbox,
    includeSent:
      typeof candidate.includeSent === 'boolean'
        ? candidate.includeSent
        : DEFAULT_ACCOUNT_IMPORT_CONFIG.includeSent,
    includeTrash:
      typeof candidate.includeTrash === 'boolean'
        ? candidate.includeTrash
        : DEFAULT_ACCOUNT_IMPORT_CONFIG.includeTrash,
    includeSpam:
      typeof candidate.includeSpam === 'boolean'
        ? candidate.includeSpam
        : DEFAULT_ACCOUNT_IMPORT_CONFIG.includeSpam,
    includeArchived:
      typeof candidate.includeArchived === 'boolean'
        ? candidate.includeArchived
        : DEFAULT_ACCOUNT_IMPORT_CONFIG.includeArchived,
  }
}

function normalizeAccountQuickSyncConfig(value: AccountSyncOptions | null): AccountQuickSyncConfig {
  const importConfig = normalizeAccountImportConfig(value)
  return {
    includeInbox: value?.quickSyncIncludeInbox ?? importConfig.includeInbox,
    includeSent: value?.quickSyncIncludeSent ?? importConfig.includeSent,
    includeTrash: value?.quickSyncIncludeTrash ?? importConfig.includeTrash,
    includeSpam: value?.quickSyncIncludeSpam ?? importConfig.includeSpam,
    includeArchived: value?.quickSyncIncludeArchived ?? importConfig.includeArchived,
  }
}

type SyncPhase = 'preparing' | 'importing' | 'finalizing' | 'complete'

interface SyncProgressState {
  startedAtMs: number
  expectedSeconds: number
  source: 'local' | 'background'
  phase: SyncPhase
  completedAtMs: number | null
}

interface SyncProgressView {
  elapsedSeconds: number
  progressPct: number
  etaSeconds: number
  phase: SyncPhase
  label: string
  detail: string
}

interface MailboxAnalytics {
  volumeByWeekday: { day: number; dayName: string; received: number; sent: number }[]
  wordCountBuckets: { bucket: string; count: number; pct: number }[]
  responseBehavior: { label: string; count: number; pct: number; colorKey: string }[]
  threadInitiator: { iInitiated: number; theyInitiated: number }
  topCorrespondents: { email: string; count: number }[]
  attachmentFrequency: {
    receivedPct: number
    sentPct: number
    totalReceived: number
    totalSent: number
  }
  responseTimeByWeekday: {
    day: number
    dayName: string
    asInitiatorHours: number | null
    asResponderHours: number | null
  }[]
  meetingEmailRatio: number
  totalMessages: number
  dataScope: string
  tagUsage: { tagId: string; label: string; color: string; count: number }[]
  tagCombinations: { tagIds: string[]; labels: string[]; size: number; count: number }[]
  actionSummary: {
    automationTriggeredEmails: number
    manualActionEmails: number
    automationActions: { action: string; label: string; count: number; pct: number }[]
    manualActions: { action: string; label: string; count: number; pct: number }[]
    automationTagBreakdown: { tagId: string; label: string; color: string; count: number }[]
  }
}

type MainTab = 'mailbox' | 'people' | 'invitations' | 'settings'
type SettingsTab = 'accounts' | 'automations' | 'ai'
type MailboxAccountProvider = 'gmail' | 'outlook' | 'imap'
type ImapSecurity = 'ssl' | 'starttls'

const AUTOSYNC_COHORT_DAYS = 30
const AUTOSYNC_COHORT_MS = AUTOSYNC_COHORT_DAYS * 24 * 60 * 60 * 1000
const MESSAGE_LOAD_DEFAULT = 30
const MESSAGE_SCAN_STEP_MAX = 15
// How often an idle, visible Mailbox re-pulls the inbox list so server-side auto-sync results
// show up without a manual refresh.
const MAILBOX_INBOX_REFRESH_INTERVAL_MS = 60_000
// When this device last asked the providers for new mail. Deliberately per device (localStorage),
// not the server-side account.last_synced_at: a sync run from a phone must not stop the desktop
// from checking when the mailbox is opened there.
const MAILBOX_DEVICE_CHECK_STORAGE_KEY_PREFIX = 'mailbox:last-new-mail-check:v1:'
const MAILBOX_DEVICE_CHECK_MIN_INTERVAL_MS = 2 * 60_000
const MAILBOX_MANUAL_QUICK_SYNC_GUIDANCE_WINDOW_MS = 5 * 60_000
const MAILBOX_MANUAL_QUICK_SYNC_ATTEMPTS_KEY_PREFIX = 'mailbox:manual-quick-sync-attempts:v1:'

function readDeviceNewMailCheckAt(storageKey: string): number | null {
  if (typeof window === 'undefined') return null
  try {
    const parsed = Number(window.localStorage.getItem(storageKey))
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  } catch {
    return null
  }
}

function writeDeviceNewMailCheckAt(storageKey: string, atMs: number): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey, String(atMs))
  } catch {
    // Storage can be unavailable (private mode / quota); the check still ran.
  }
}

function normalizeMessageList(raw: unknown): MailMessage[] {
  if (!Array.isArray(raw)) return []
  return raw.map((message: MailMessage) => ({
    ...message,
    user_tag_ids: Array.isArray(message.user_tag_ids)
      ? message.user_tag_ids.filter((value): value is string => typeof value === 'string')
      : [],
  }))
}
const MESSAGE_PRIORITY_SORT_LOAD_LIMIT = 1000
const MAILBOX_THREAD_CACHE_MAX = 60
const MAILBOX_THREAD_PREFETCH_LIMIT = 6
const MAILBOX_THREAD_PREFETCH_DELAY_MS = 400
const MAILBOX_INBOX_WIDTH_DEFAULT_RATIO = 0.25
const MAILBOX_INBOX_WIDTH_MIN_RATIO = 0.18
const MAILBOX_INBOX_WIDTH_MAX_RATIO = 0.45
const MAILBOX_INBOX_MIN_WIDTH_PX = 280
const MAILBOX_MOBILE_BREAKPOINT_PX = 1024
const MAILBOX_NEW_EMAIL_LABEL_MIN_HEADER_WIDTH_PX = 280
// Row exit runs in two overlapping phases: the card slides/fades out, then its slot collapses so the
// rows below glide up instead of snapping. Total stays short enough to feel instant.
const MAILBOX_ROW_FADE_MS = 160
const MAILBOX_ROW_COLLAPSE_DELAY_MS = 120
const MAILBOX_ROW_COLLAPSE_MS = 220
const MAILBOX_ROW_EXIT_MS = MAILBOX_ROW_COLLAPSE_DELAY_MS + MAILBOX_ROW_COLLAPSE_MS
// How long an exited row stays exempt from the filter-hide fade (covers slow re-renders/reads).
const MAILBOX_ROW_EXITED_GRACE_MS = 10_000
const MAILBOX_TRASH_SORT_ID = buildSystemSortId('trash')

// A row the user trashed this session stays out of the list while trashed, unless the view is Trash-only.
function isSessionTrashedHidden(
  msg: { id: string; is_provider_trashed?: boolean | null },
  modes: ReadonlyMap<string, string>,
  sessionTrashedIds: ReadonlySet<string>
): boolean {
  return (
    msg.is_provider_trashed === true &&
    sessionTrashedIds.has(msg.id) &&
    modes.get(MAILBOX_TRASH_SORT_ID) !== 'only'
  )
}
// Tag chip removal: slow fade so the change reads clearly, then a quicker settle as rows reflow.
const MAILBOX_TAG_FADE_MS = 1500
const MAILBOX_TAG_SETTLE_MS = 800
// A message that falls out of the active filters (not deleted) gets this long to visibly exit before
// it's actually dropped from the list, so the open Thread Viewer has time to collapse in sync.
const MAILBOX_FILTER_HIDE_MS = 1600
// The Thread Viewer collapse itself runs twice as fast as the inbox row fade -- the long duration is
// meant to be felt on the inbox cards, not on the (already-departed) email you're currently reading.
const MAILBOX_THREAD_COLLAPSE_MS = MAILBOX_FILTER_HIDE_MS / 2
// Hover-to-preview delay for image attachment chips, so a passing cursor doesn't trigger a fetch.
const MAILBOX_ATTACHMENT_PREVIEW_HOVER_MS = 800
// Changing the active filter or its sort mode still applies any search text / date range underneath it;
// briefly wave-highlight those fields so that carry-over reads as deliberate instead of confusing.
const MAILBOX_ADDITIONAL_FILTERS_HIGHLIGHT_MS = 6000
const MAILBOX_INBOX_WIDTH_STORAGE_KEY_PREFIX = 'mailbox:inbox-width-ratio:v1:'
const MAILBOX_HTML_TRUST_STORAGE_KEY_PREFIX = 'mailbox:trusted-html-domains:v1:'
const MAILBOX_JUNK_DOMAIN_STORAGE_KEY_PREFIX = 'mailbox:junk-domains:v1:'
const MAILBOX_NON_ORGANIZER_STORAGE_KEY_PREFIX = 'mailbox:non-organizer-senders:v1:'
const MAILBOX_INVITATION_VIEW_STORAGE_KEY_PREFIX = 'mailbox:invitation-view:v1:'
const MAILBOX_PANEL_VISIBILITY_STORAGE_KEY_PREFIX = 'mailbox:panel-visibility:v1:'
const MAILBOX_SUPPRESSED_CONFIRMS_STORAGE_KEY_PREFIX = 'mailbox:suppressed-confirms:v1:'
const MAILBOX_AI_ACCESS_STORAGE_KEY_PREFIX = 'mailbox:ai-access:v1:'
const MAILBOX_SETTINGS_TAB_STORAGE_KEY_PREFIX = 'mailbox:settings-tab:v1:'
const MAILBOX_SETTINGS_SECTIONS_STORAGE_KEY_PREFIX = 'mailbox:settings-sections:v1:'
const MAILBOX_ACCOUNT_SETTINGS_EXPANSION_KEY_PREFIX = 'mailbox:account-settings-expansion:v1:'

interface MailboxAccountSettingsExpansionState {
  expandedAccountIds: string[]
  sections: Record<string, { import?: boolean; quick?: boolean }>
}

function readMailboxAccountSettingsExpansion(
  storageKey: string
): MailboxAccountSettingsExpansionState {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) || 'null')
    if (!parsed || typeof parsed !== 'object') {
      return { expandedAccountIds: [], sections: {} }
    }
    const source = parsed as Record<string, unknown>
    const rawSections = source.sections
    const sections: Record<string, { import?: boolean; quick?: boolean }> = {}
    if (rawSections && typeof rawSections === 'object' && !Array.isArray(rawSections)) {
      for (const [accountId, value] of Object.entries(rawSections)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue
        const section = value as Record<string, unknown>
        sections[accountId] = {
          import: section.import === true,
          quick: section.quick === true,
        }
      }
    }
    const expandedAccountIds = Array.isArray(source.expandedAccountIds)
      ? source.expandedAccountIds.filter(
          (accountId): accountId is string => typeof accountId === 'string'
        )
      : typeof source.expandedAccountId === 'string'
        ? [source.expandedAccountId]
        : []
    return {
      expandedAccountIds,
      sections,
    }
  } catch {
    return { expandedAccountIds: [], sections: {} }
  }
}

type MailboxConfirmKey =
  | 'trash-thread'
  | 'remove-local-copy'
  | 'remove-thread-local-copies'
  | 'remove-account'

interface MailboxConfirmPrompt {
  key: MailboxConfirmKey
  title: string
  message: string
  confirmLabel: string
  // Omitted for prompts that must always be shown, such as removing an account.
  suppressLabel?: string
  details?: string[]
  run: () => void
}

function isMailboxConfirmKey(value: unknown): value is MailboxConfirmKey {
  return (
    value === 'trash-thread' ||
    value === 'remove-local-copy' ||
    value === 'remove-thread-local-copies'
  )
}
const MAILBOX_CONFIRMATION_OPTIONS: Array<{
  key: MailboxConfirmKey
  label: string
  description: string
}> = [
  {
    key: 'trash-thread',
    label: 'Trash a thread',
    description: 'Confirm before moving an entire conversation to your email provider trash.',
  },
  {
    key: 'remove-local-copy',
    label: 'Remove a local email copy',
    description: 'Confirm before removing one imported email from Coordination Manager.',
  },
  {
    key: 'remove-thread-local-copies',
    label: 'Remove local thread copies',
    description: 'Confirm before removing all imported emails in a conversation.',
  },
]
const MAILBOX_LOAD_LIMIT_STORAGE_KEY = 'mailbox:load-limit:v1'
const MAILBOX_FILTERS_STORAGE_KEY_PREFIX = 'mailbox:additional-filters:v1:'
const MAILBOX_NOTIFICATION_RULES_STORAGE_KEY_PREFIX = 'mailbox:notification-rules:v1:'

type MailboxSettingsSection = 'threadView' | 'inboxDisplay' | 'confirmations' | 'syncDefaults' | 'notifications'
type MailboxSettingsSectionState = Record<MailboxSettingsSection, boolean>

const DEFAULT_MAILBOX_SETTINGS_SECTION_STATE: MailboxSettingsSectionState = {
  threadView: true,
  inboxDisplay: true,
  confirmations: true,
  syncDefaults: true,
  notifications: true,
}

function readMailboxSettingsSectionState(storageKey: string): MailboxSettingsSectionState {
  if (typeof window === 'undefined') return DEFAULT_MAILBOX_SETTINGS_SECTION_STATE
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) || 'null')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return DEFAULT_MAILBOX_SETTINGS_SECTION_STATE
    }
    const source = parsed as Record<string, unknown>
    return {
      threadView: source.threadView !== false,
      inboxDisplay: source.inboxDisplay !== false,
      confirmations: source.confirmations !== false,
      syncDefaults: source.syncDefaults !== false,
      notifications: source.notifications !== false,
    }
  } catch {
    return DEFAULT_MAILBOX_SETTINGS_SECTION_STATE
  }
}
const MAILBOX_TAG_PANEL_WIDTH_PX = 360
const MAILBOX_TAG_DEFAULT_COLOR = '#2563eb'

type MailViewerMode = 'raw-text' | 'html' | 'system'

type InvitationSortOrder = 'latest-first' | 'earliest-first'

function parseInvitationSortOrder(value: unknown): InvitationSortOrder {
  return value === 'earliest-first' ? 'earliest-first' : 'latest-first'
}

function normalizeSenderEntry(value: string | null | undefined): string | null {
  const normalized = (value || '').trim().toLowerCase()
  if (!normalized) return null
  const emailMatch = normalized.match(/[^\s<>()"',;]+@[^\s<>()"',;]+\.[a-z]{2,}/i)
  if (emailMatch) return emailMatch[0]
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(normalized)) return normalized
  return null
}

function matchesSenderEntry(value: string | null | undefined, entries: Set<string>): boolean {
  if (entries.size === 0) return false
  const normalized = normalizeSenderEntry(value)
  if (!normalized) return false
  if (entries.has(normalized)) return true
  const domain = normalized.includes('@')
    ? normalized.slice(normalized.lastIndexOf('@') + 1)
    : normalized
  return entries.has(domain)
}

const mainTabs: Array<{
  id: MainTab
  label: string
  mobileLabel?: string
  icon: React.ComponentType<{ className?: string }>
}> = [
  { id: 'mailbox', label: 'Mailbox', icon: Inbox },
  { id: 'people', label: 'People and Domains', mobileLabel: 'People', icon: UserRound },
  { id: 'invitations', label: 'Invitations', mobileLabel: 'Invites', icon: CalendarCheck },
  { id: 'settings', label: 'Settings', icon: Settings2 },
]

const settingsTabs: Array<{
  id: SettingsTab
  label: string
  icon: React.ComponentType<{ className?: string }>
}> = [
  { id: 'accounts', label: 'Accounts', icon: Link },
  { id: 'automations', label: 'Automations', icon: Bot },
  { id: 'ai', label: 'AI Assistant', icon: Sparkles },
]

function parseMainTab(value: string | null): MainTab {
  if (
    value === 'mailbox' ||
    value === 'people' ||
    value === 'invitations' ||
    value === 'settings'
  ) {
    return value
  }
  return 'mailbox'
}

function parseSettingsTab(value: string | null): SettingsTab {
  if (value === 'accounts' || value === 'automations' || value === 'ai') {
    return value
  }
  return 'accounts'
}

function readPersistedSettingsTab(storageKey: string): SettingsTab {
  try {
    return parseSettingsTab(window.localStorage.getItem(storageKey))
  } catch {
    return 'accounts'
  }
}

function readPersistedStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
}

function formatTimestamp(
  value: string | null,
  dateFormat: ReturnType<typeof readUserDateFormatFromLocalStorage>
): string {
  if (!value) return 'Unknown time'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return formatDateTimeWithUserPreference(d, dateFormat)
}

function collapseConsecutiveBlankLines(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n')
  return normalized.replace(/\n[ \t]*(?:\n[ \t]*)+/g, '\n\n')
}

function normalizeEmailListFromField(value: string | null): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

/** Pulls the bare address out of `Name <user@host>` entries so providers accept the recipient list. */
function extractEmailAddresses(value: string | null): string[] {
  return normalizeEmailListFromField(value)
    .map((entry) => {
      const angled = entry.match(/<([^<>]+)>/)
      return (angled ? angled[1] : entry).trim()
    })
    .filter((entry) => entry.includes('@'))
}

function formatSenderLine(name: string | null, email: string | null): string {
  const normalizedName = (name || '').trim()
  const normalizedEmail = (email || '').trim()

  if (
    normalizedName &&
    normalizedEmail &&
    normalizedName.toLowerCase() !== normalizedEmail.toLowerCase()
  ) {
    return `${normalizedName} <${normalizedEmail}>`
  }

  return normalizedName || normalizedEmail || 'Unknown sender'
}

function formatRecipientLine(value: string | null): string | null {
  const recipients = normalizeEmailListFromField(value).join(', ')
  return recipients || null
}

function buildReplySubject(subject: string | null): string {
  const normalizedSubject = (subject || '').trim()
  if (!normalizedSubject) return 'Re: (no subject)'
  if (/^re:/i.test(normalizedSubject)) return normalizedSubject
  return `Re: ${normalizedSubject}`
}

function buildForwardSubject(subject: string | null): string {
  const normalizedSubject = (subject || '').trim()
  if (!normalizedSubject) return 'Fwd: (no subject)'
  if (/^fwd:/i.test(normalizedSubject)) return normalizedSubject
  return `Fwd: ${normalizedSubject}`
}

function monthNameToIndex(value: string): number | null {
  const months = [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sep',
    'oct',
    'nov',
    'dec',
  ]
  const normalized = value.trim().slice(0, 3).toLowerCase()
  const index = months.indexOf(normalized)
  return index >= 0 ? index : null
}

function parseTimezoneOffsetHours(value: string): number | null {
  const normalized = value.trim().toUpperCase()
  const explicitOffset = normalized.match(/(?:UTC|GMT)\s*([+-]\d{1,2})(?::?(\d{2}))?/)
  if (explicitOffset?.[1]) {
    const hours = Number(explicitOffset[1])
    const minutes = explicitOffset[2] ? Number(explicitOffset[2]) : 0
    if (Number.isFinite(hours) && Number.isFinite(minutes)) {
      return hours + (hours >= 0 ? minutes : -minutes) / 60
    }
  }

  const offsetTokens: Array<[string, number]> = [
    ['EASTERN EUROPEAN SUMMER TIME', 3],
    ['EASTERN EUROPEAN TIME', 2],
    ['EEST', 3],
    ['CEST', 2],
    ['WEST', 1],
    ['EET', 2],
    ['CET', 1],
    ['BST', 1],
    ['PDT', -7],
    ['MDT', -6],
    ['CDT', -5],
    ['EDT', -4],
    ['PST', -8],
    ['MST', -7],
    ['CST', -6],
    ['EST', -5],
    ['WET', 0],
    ['UTC', 0],
    ['GMT', 0],
  ]

  for (const [token, offset] of offsetTokens) {
    const tokenPattern = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'i')
    if (tokenPattern.test(normalized)) return offset
  }

  return null
}

function parseInvitationDateRange(text: string): {
  startsAt: string | null
  endsAt: string | null
} {
  const patterns = [
    /(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\s+([a-z]{3,9})\s+(\d{1,2}),\s+(\d{4})[^\n\r]*?(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})(?:\s*\(([^)]+)\))?/i,
    /([a-z]{3,9})\s+(\d{1,2}),\s+(\d{4})[^\n\r]*?(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})(?:\s*\(([^)]+)\))?/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match) continue

    const monthIndex = monthNameToIndex(match[1])
    if (monthIndex === null) continue

    const year = Number(match[3])
    const day = Number(match[2])
    const startHour = Number(match[4])
    const startMinute = Number(match[5])
    const endHour = Number(match[6])
    const endMinute = Number(match[7])
    const timezoneText = match[8] || ''
    const offsetHours = parseTimezoneOffsetHours(timezoneText) ?? 0

    return {
      startsAt: new Date(
        Date.UTC(year, monthIndex, day, startHour - offsetHours, startMinute, 0)
      ).toISOString(),
      endsAt: new Date(
        Date.UTC(year, monthIndex, day, endHour - offsetHours, endMinute, 0)
      ).toISOString(),
    }
  }

  return { startsAt: null, endsAt: null }
}

function detectAppointmentDateRange(text: string): {
  startsAt: string | null
  endsAt: string | null
} {
  const candidates = detectDateTimeCandidates(text)
  if (candidates.length === 0) return { startsAt: null, endsAt: null }

  const offsetHours = parseTimezoneOffsetHours(text) ?? 0
  return {
    startsAt: detectedLocalToIso(candidates[0].startLocal, offsetHours),
    endsAt: detectedLocalToIso(candidates[0].endLocal, offsetHours),
  }
}

function extractInvitationLocationFromText(text: string): string | null {
  const labelMatch = text.match(/(?:^|\n)\s*location\s*[:-]?\s*(.+)$/im)
  if (labelMatch?.[1]) {
    const value = labelMatch[1].trim()
    if (value) return value.split(/\s*\n/)[0].trim()
  }

  const urlMatch = text.match(/https?:\/\/[^\s<>()\]]+/i)
  return urlMatch?.[0] || null
}

function buildInvitationFromThreadMessage(message: ThreadMessage): MailInvitation | null {
  const sourceText = [message.subject, message.body_text, message.body_html_sanitized]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n')

  const lowered = sourceText.toLowerCase()
  const looksLikeInvite =
    lowered.includes('when') ||
    lowered.includes('location') ||
    lowered.includes('organizer') ||
    lowered.includes('guests') ||
    lowered.includes('this event has been updated') ||
    lowered.includes('this event has been cancelled') ||
    lowered.includes('view map') ||
    lowered.includes('google calendar')

  const dateRange = looksLikeInvite
    ? parseInvitationDateRange(sourceText)
    : { startsAt: null, endsAt: null }
  const resolvedRange =
    dateRange.startsAt && dateRange.endsAt ? dateRange : detectAppointmentDateRange(sourceText)
  if (!resolvedRange.startsAt || !resolvedRange.endsAt) return null

  const summaryFromSubject =
    message.subject
      ?.replace(/^updated invitation from an unknown sender:\s*/i, '')
      .replace(/^updated invitation:\s*/i, '')
      .replace(/^invitation:\s*/i, '')
      .trim()
      .split(/\s+@\s+/i)[0]
      ?.trim() ||
    message.subject?.trim() ||
    'Calendar invitation'

  return {
    id: message.id,
    message_id: message.id,
    summary: summaryFromSubject,
    location: extractInvitationLocationFromText(sourceText),
    organizer: formatSenderLine(message.from_name, message.from_email),
    starts_at: resolvedRange.startsAt,
    ends_at: resolvedRange.endsAt,
    status: 'proposed',
    uid: `thread-message:${message.id}`,
    provider_event_ref: null,
  }
}

function normalizeThreadMessages(raw: unknown): ThreadMessage[] {
  if (!Array.isArray(raw)) return []
  return (raw as ThreadMessage[]).map((message) => ({
    ...message,
    user_tag_ids: Array.isArray(message.user_tag_ids)
      ? message.user_tag_ids.filter((value): value is string => typeof value === 'string')
      : [],
  }))
}

// Read state is deliberately excluded: a background revalidation must not undo an optimistic "mark as read".
function threadContentSignature(messages: ThreadMessage[]): string {
  return messages
    .map((message) =>
      [
        message.id,
        message.received_at || '',
        (message.body_text || '').length,
        (message.body_html_sanitized || '').length,
        message.is_archived,
        message.is_provider_trashed,
        message.user_tag_ids.join('.'),
      ].join(':')
    )
    .join('|')
}

function getDefaultCollapsedThreadMessageIds(
  messages: ThreadMessage[],
  focusedMessageId: string | null
): Set<string> {
  const openMessageId = focusedMessageId || messages[messages.length - 1]?.id || null
  return new Set(
    messages.filter((message) => message.id !== openMessageId).map((message) => message.id)
  )
}

function isInteractiveMailboxHeaderTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('button, a, input, select, textarea'))
}

function apiErrorMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const response = (err as { response?: { data?: { error?: string } } }).response
    if (response?.data?.error) return response.data.error
    const msg = (err as { message?: string }).message
    if (msg) return msg
  }
  return 'Request failed'
}

function estimateSyncDurationSeconds(config: AccountImportConfig): number {
  const sourceCount =
    [config.includeInbox, config.includeSent, config.includeTrash, config.includeSpam, config.includeArchived].filter(
      Boolean
    ).length || 1

  const estimate =
    10 + Math.ceil(config.maxMessages / 20) + Math.ceil(config.daysBack / 10) + sourceCount * 3

  return Math.max(15, Math.min(180, estimate))
}

// Progress runs on one continuous 0-100 curve so every surface shows the same number.
const SYNC_COMPLETE_HOLD_MS = 1200

function computeSyncProgress(
  tracker: SyncProgressState,
  nowMs: number
): { rawPct: number; elapsedSeconds: number; etaSeconds: number } {
  const elapsedMs = Math.max(0, nowMs - tracker.startedAtMs)
  const elapsedSeconds = Math.floor(elapsedMs / 1000)
  const expectedSeconds = Math.max(1, tracker.expectedSeconds)
  const ratio = elapsedMs / (expectedSeconds * 1000)

  if (tracker.phase === 'complete') {
    return { rawPct: 100, elapsedSeconds, etaSeconds: 0 }
  }

  if (tracker.phase === 'finalizing') {
    const finalizingMs = Math.max(0, nowMs - (tracker.completedAtMs ?? nowMs))
    return {
      rawPct: Math.min(98, 92 + (finalizingMs / 1000) * 2),
      elapsedSeconds,
      etaSeconds: 0,
    }
  }

  const eased = ratio <= 1 ? ratio : 1 + (ratio - 1) * 0.15
  return {
    rawPct: Math.min(92, eased * 92),
    elapsedSeconds,
    etaSeconds: Math.max(0, expectedSeconds - elapsedSeconds),
  }
}

function syncPhaseLabel(phase: SyncPhase): string {
  if (phase === 'preparing') return 'Preparing import'
  if (phase === 'finalizing') return 'Saving to your mailbox'
  if (phase === 'complete') return 'Import complete'
  return 'Importing email history'
}

function MailboxSyncProgress({
  view,
  variant,
}: {
  view: SyncProgressView
  variant: 'banner' | 'inline'
}) {
  const pct = Math.round(view.progressPct)
  const isComplete = view.phase === 'complete'

  if (variant === 'inline') {
    return (
      <div className="mt-2 space-y-1" data-testid="mailbox-sync-progress-inline">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            {view.label}... {pct}%
          </span>
          <span>
            {isComplete
              ? formatSeconds(view.elapsedSeconds)
              : `~${formatSeconds(view.etaSeconds)} left`}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-[width] duration-700 ease-out ${isComplete ? 'bg-success' : 'bg-primary'}`}
            style={{ width: `${Math.max(2, view.progressPct)}%` }}
          />
        </div>
      </div>
    )
  }

  return (
    <div
      className={`mb-3 rounded-lg border px-3 py-3 transition-opacity duration-500 ${
        isComplete
          ? 'border-success-muted bg-success-subtle'
          : 'border-border bg-card'
      }`}
      data-testid="mailbox-sync-progress-banner"
    >
      <div className="flex items-center gap-3">
        <div className="relative h-5 w-5 shrink-0">
          <div className="absolute inset-0 rounded-full border-2 border-border" />
          {!isComplete && (
            <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-primary" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            {view.label}... {pct}%
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{view.detail}</p>
        </div>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {formatSeconds(view.elapsedSeconds)}
        </span>
      </div>
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-[width] duration-700 ease-out ${isComplete ? 'bg-success' : 'bg-primary'}`}
          style={{ width: `${Math.max(3, view.progressPct)}%` }}
        />
      </div>
    </div>
  )
}

function AccountActionTooltip({
  text,
  children,
  align = 'center',
}: {
  text: string
  children: React.ReactNode
  align?: 'center' | 'start'
}) {
  return (
    <div className="group relative flex items-center">
      {children}
      <span className={`pointer-events-none absolute bottom-full z-20 mb-2 w-max max-w-52 rounded-md bg-info px-2 py-1 text-center text-[11px] leading-snug text-white opacity-0 shadow-md transition-opacity delay-500 group-hover:opacity-100 group-focus-within:opacity-100 ${
        align === 'start' ? 'left-0' : 'left-1/2 -translate-x-1/2'
      }`}>
        {text}
      </span>
    </div>
  )
}

function AccountQuickSyncSettings({
  maxMessages,
  sources,
  isExpanded,
  onToggle,
  onMaxMessagesChange,
  onSourceChange,
}: {
  maxMessages: number
  sources: AccountQuickSyncConfig
  isExpanded: boolean
  onToggle: () => void
  onMaxMessagesChange: (value: number) => void
  onSourceChange: (key: keyof AccountQuickSyncConfig, value: boolean) => void
}) {
  const selectedSourceCount = Object.values(sources).filter(Boolean).length

  return (
    <section className="rounded-lg border border-border bg-card">
      <Disclosure
        title="Quick Sync Settings"
        expanded={isExpanded}
        onToggle={() => onToggle()}
        panelClassName="border-t border-border px-3 py-3 text-xs text-muted-foreground space-y-2"
      >
        <>
          <p>Uses this account's newest imported email time, with a short overlap to avoid skipped mail.</p>
          <label className="flex items-center justify-between gap-3 text-foreground">
            <span className="font-medium">Maximum messages per Quick Sync</span>
            <select
              value={maxMessages}
              onChange={(event) => onMaxMessagesChange(Number(event.target.value))}
              className="rounded border border-input bg-background px-2 py-1 text-xs"
            >
              {[25, 50, 100, 200, 300, 500].map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <div className="space-y-2 pt-1">
            <p className="font-medium text-foreground">Mail sources</p>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['includeInbox', 'Inbox'],
                  ['includeSent', 'Sent'],
                  ['includeTrash', 'Trash'],
                  ['includeSpam', 'Spam'],
                  ['includeArchived', 'Archived'],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-3 py-2"
                >
                  <input
                    type="checkbox"
                    checked={sources[key]}
                    disabled={sources[key] && selectedSourceCount === 1}
                    onChange={(event) => onSourceChange(key, event.target.checked)}
                    className="accent-primary disabled:opacity-50"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <ul className="list-disc space-y-1 pl-4">
            <li>Imports up to {maxMessages} new messages.</li>
            <li>Uses only the mail sources selected above.</li>
            <li>First Quick Sync uses the Import Settings history window.</li>
          </ul>
        </>
      </Disclosure>
    </section>
  )
}

function describeMailActivityAction(event: MailActivityEvent): string {
  const actionLabels: Record<string, string> = {
    trash: 'Moved to trash',
    junk: 'Marked as junk',
    archive: 'Archived',
    unarchive: 'Removed from archive',
    mark_read: 'Marked as read',
    mark_unread: 'Marked as unread',
    add_tag: 'Added tag',
    remove_tag: 'Removed tag',
    import_junk: 'Imported as junk',
    import_trash: 'Imported from trash',
    import_archived: 'Imported as archived',
  }
  const label = actionLabels[event.action] || event.action
  return event.action_value ? `${label}: ${event.action_value}` : label
}

function formatSeconds(value: number): string {
  const safeValue = Math.max(0, Math.floor(value))
  if (safeValue < 60) return `${safeValue}s`
  const min = Math.floor(safeValue / 60)
  const sec = safeValue % 60
  return `${min}m ${sec.toString().padStart(2, '0')}s`
}

function formatRelativeAgeFromMs(ageMs: number): string {
  const totalMinutes = Math.max(0, Math.floor(ageMs / 60_000))
  if (totalMinutes < 1) return 'just now'
  if (totalMinutes < 60) return `${totalMinutes}m ago`

  const totalHours = Math.floor(totalMinutes / 60)
  if (totalHours < 24) return `${totalHours}h ago`

  const totalDays = Math.floor(totalHours / 24)
  if (totalDays < 30) return `${totalDays}d ago`

  const totalMonths = Math.floor(totalDays / 30)
  if (totalMonths < 12) return `${totalMonths}mo ago`

  const totalYears = Math.floor(totalDays / 365)
  return `${totalYears}y ago`
}

function parseDateInputStart(value: string): number | null {
  if (!value) return null
  const parsed = new Date(`${value}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.getTime()
}

function parseDateInputEnd(value: string): number | null {
  if (!value) return null
  const parsed = new Date(`${value}T23:59:59.999`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.getTime()
}

function parseTimestamp(value: string | null): number | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.getTime()
}

// Pull-strength slider: cursor distance from thumb drives speed; <20px = 1 day/tick
function PullSlider({
  min,
  max,
  value,
  onChange,
}: {
  min: number
  max: number
  value: number
  onChange: (v: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef({ active: false, cursorX: 0, lastMoveAt: 0, lastAppliedAt: 0 })
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    valueRef.current = value
  }, [value])
  useEffect(() => {
    onChangeRef.current = onChange
  })

  const pct = ((value - min) / (max - min)) * 100

  // tickFnRef is re-assigned each render so the interval always sees fresh props
  const tickFnRef = useRef<() => void>(() => {})
  tickFnRef.current = () => {
    const d = dragRef.current
    if (!d.active || !trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const thumbX = rect.left + ((valueRef.current - min) / (max - min)) * rect.width
    const pull = d.cursorX - thumbX
    const absP = Math.abs(pull)
    if (absP < 5) return

    const now = Date.now()
    const idle = now - d.lastMoveAt > 400
    const distanceToEdge = Math.min(
      Math.abs(rect.left - d.cursorX),
      Math.abs(rect.right - d.cursorX)
    )

    const step = getMailboxPullStep(absP, distanceToEdge)
    const moveMs = step >= 19 ? 90 : step >= 9 ? 140 : step >= 3 ? 320 : 500
    const idleMs = step >= 19 ? 130 : step >= 9 ? 200 : step >= 3 ? 500 : 1000

    if (now - d.lastAppliedAt < (idle ? idleMs : moveMs)) return

    const dir = pull > 0 ? 1 : -1
    const next = Math.max(min, Math.min(max, valueRef.current + dir * step))
    if (next !== valueRef.current) {
      d.lastAppliedAt = now
      valueRef.current = next
      onChangeRef.current(next)
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
    dragRef.current = { active: true, cursorX: e.clientX, lastMoveAt: Date.now(), lastAppliedAt: 0 }
    if (tickRef.current) clearInterval(tickRef.current)
    tickRef.current = setInterval(() => tickFnRef.current(), 50)
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current.active) return
    dragRef.current.cursorX = e.clientX
    dragRef.current.lastMoveAt = Date.now()
  }

  function stopDrag() {
    dragRef.current.active = false
    if (tickRef.current) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
  }

  useEffect(
    () => () => {
      if (tickRef.current) clearInterval(tickRef.current)
    },
    []
  )

  return (
    <div
      ref={trackRef}
      className="relative h-6 flex items-center cursor-ew-resize touch-none select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
    >
      <div className="absolute inset-x-0 h-2 rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary/40" style={{ width: `${pct}%` }} />
      </div>
      <div
        className="absolute h-4 w-4 rounded-full bg-primary shadow-sm border-2 border-background -translate-x-1/2 hover:scale-110 transition-transform"
        style={{ left: `${pct}%` }}
      />
    </div>
  )
}

function InboxSkeletonRows({ count = 8 }: { count?: number }) {
  return (
    <div
      className="space-y-1"
      data-testid="mailbox-inbox-skeleton"
      aria-busy="true"
      aria-label="Loading inbox"
    >
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-lg border border-border bg-background px-2 py-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="h-2.5 w-2/5 rounded bg-muted animate-pulse motion-reduce:[animation-duration:3s]" />
              <div className="h-2 w-4/5 rounded bg-muted/70 animate-pulse motion-reduce:[animation-duration:3s]" />
            </div>
            <div className="h-2 w-10 shrink-0 rounded bg-muted/60 animate-pulse motion-reduce:[animation-duration:3s]" />
          </div>
          <div className="mt-2 flex items-center gap-1">
            <div className="h-2.5 w-10 rounded bg-muted/50 animate-pulse motion-reduce:[animation-duration:3s]" />
            <div className="h-2.5 w-8 rounded bg-muted/50 animate-pulse motion-reduce:[animation-duration:3s]" />
          </div>
        </div>
      ))}
    </div>
  )
}

function getLuminance(hexColor: string): number {
  if (!/^#[0-9a-fA-F]{6}$/.test(hexColor.trim())) return 128
  const hex = hexColor.trim().slice(1)
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return (r * 299 + g * 587 + b * 114) / 1000
}

function getLegibleTextColor(bgColor: string, fontColor?: string): string {
  if (fontColor && /^#[0-9a-fA-F]{6}$/.test(fontColor.trim())) {
    const fHex = fontColor.trim().toLowerCase()
    const bHex = bgColor.trim().toLowerCase()
    const bgLum = getLuminance(bHex)
    const fontLum = getLuminance(fHex)
    if (Math.abs(bgLum - fontLum) > 70) {
      return fontColor.trim()
    }
    return bgLum >= 128 ? '#000000' : '#ffffff'
  }
  return getLuminance(bgColor) >= 128 ? '#000000' : '#ffffff'
}

export default function MailboxPage() {
  const userDateFormat = useMemo(() => readUserDateFormatFromLocalStorage(), [])
  const { user } = useAuth()
  const { setPageContext } = useAiAssistant()
  const isLocalhost = window.location.hostname === 'localhost'
  const docsBaseUrl = import.meta.env.DEV
    ? 'http://localhost:5174/docs'
    : `${window.location.origin}/docs`
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = parseMainTab(searchParams.get('tab'))
  const activeSettingsTab = parseSettingsTab(searchParams.get('settings'))

  // Cross-navigation cache: lets the inbox repaint instantly when the user
  // comes back from another page (e.g. Time Management) instead of showing the
  // skeleton again, while the loads below still run and reconcile in the background.
  const mailboxAccountsCacheKey = `mailbox:accounts:${user?.id ?? 'anon'}`
  const mailboxMessagesCacheKey = `mailbox:messages:${user?.id ?? 'anon'}`
  // Tags are cached too so the persisted filter rules can be reconciled against the real tag ids
  // on the very first render, before the tags request comes back.
  const mailboxTagsCacheKey = `mailbox:tags:${user?.id ?? 'anon'}`
  const mailboxAccountSettingsExpansionKey =
    `${MAILBOX_ACCOUNT_SETTINGS_EXPANSION_KEY_PREFIX}${user?.id ?? 'anon'}`
  const mailboxSettingsSectionsStorageKey =
    `${MAILBOX_SETTINGS_SECTIONS_STORAGE_KEY_PREFIX}${user?.id ?? 'anon'}`
  const initialAccountSettingsExpansionRef = useRef(
    readMailboxAccountSettingsExpansion(mailboxAccountSettingsExpansionKey)
  )
  const MAILBOX_SESSION_CACHE_TTL_MS = 5 * 60 * 1000
  const hadFreshCachedMailboxAtMountRef = useRef(
    isSessionCacheFresh(mailboxMessagesCacheKey, MAILBOX_SESSION_CACHE_TTL_MS)
  )
  const isFirstMailboxLoadRef = useRef(true)

  // Critical phase only (accounts + messages + tags). Everything else streams in afterwards.
  const [isLoading, setIsLoading] = useState(() => !hadFreshCachedMailboxAtMountRef.current)
  const [isEnriching, setIsEnriching] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mailboxPreferenceSnapshotsRef = useRef(new Map<string, string>())
  const saveMailboxPreference = useCallback(async (path: string, payload: Record<string, unknown>) => {
    const snapshot = JSON.stringify(payload)
    if (mailboxPreferenceSnapshotsRef.current.get(path) === snapshot) return
    mailboxPreferenceSnapshotsRef.current.set(path, snapshot)
    try {
      await apiClient.put(path, payload)
    } catch (err) {
      if (mailboxPreferenceSnapshotsRef.current.get(path) === snapshot) {
        mailboxPreferenceSnapshotsRef.current.delete(path)
      }
      setError(`Could not save mailbox settings: ${apiErrorMessage(err)}`)
    }
  }, [])
  const [oauthNotice, setOauthNotice] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null)
  // True while this device is asking the providers for new mail, so the inbox can say so.
  const [isCheckingNewMail, setIsCheckingNewMail] = useState(false)
  const newMailCheckInFlightRef = useRef(false)
  const [syncProgressByAccountId, setSyncProgressByAccountId] = useState<
    Record<string, SyncProgressState>
  >({})
  // Keeps the displayed percentage monotonic so phase changes never rewind the bar.
  const syncPctFloorRef = useRef<Record<string, number>>({})
  const quickSyncSourceSaveSequenceRef = useRef<Record<string, number>>({})
  const importSourceSaveSequenceRef = useRef<Record<string, number>>({})
  const [syncTicker, setSyncTicker] = useState(0)
  const [_lastSyncTicker, setLastSyncTicker] = useState(0)
  const [expandedAccountIds, setExpandedAccountIds] = useState<string[]>(
    () => initialAccountSettingsExpansionRef.current.expandedAccountIds
  )
  const [expandedAccountSettings, setExpandedAccountSettings] = useState<
    Record<string, { import?: boolean; quick?: boolean }>
  >(() => initialAccountSettingsExpansionRef.current.sections)
  // Account id to briefly pulse-highlight the sync CTAs for after "Yes, open import settings"
  const [highlightSyncCtaAccountId, setHighlightSyncCtaAccountId] = useState<string | null>(null)
  const [importConfigs, setImportConfigs] = useState<Record<string, AccountImportConfig>>({})
  // connect card hidden by default once accounts exist; connected list hidden by default when no accounts
  const [showConnectCard, setShowConnectCard] = useState(false)
  const [showGmailOAuthInfo, setShowGmailOAuthInfo] = useState(false)
  const [showConnectedCard, setShowConnectedCard] = useState(true)
  const [showAnalytics, setShowAnalytics] = useState(false)
  const [analyticsHighlight, setAnalyticsHighlight] = useState(false)
  const [analyticsData, setAnalyticsData] = useState<MailboxAnalytics | null>(null)
  const [showMailboxSettings, setShowMailboxSettings] = useState(false)
  const [mailboxSettingsSections, setMailboxSettingsSections] = useState<MailboxSettingsSectionState>(
    () => readMailboxSettingsSectionState(mailboxSettingsSectionsStorageKey),
  )
  const [hydratedMailboxSettingsSectionsKey, setHydratedMailboxSettingsSectionsKey] = useState<string | null>(null)
  const [mailboxSettingsSectionsServerHydrated, setMailboxSettingsSectionsServerHydrated] = useState(false)
  const [mailboxSettingsHighlight, setMailboxSettingsHighlight] = useState(false)
  const [guideTagsPanelOpen, setGuideTagsPanelOpen] = useState(false)
  const [expandedSettingsGuideTabs, setExpandedSettingsGuideTabs] = useState<
    Record<string, boolean>
  >({})
  const [createTagHighlight, setCreateTagHighlight] = useState(false)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setMailboxSettingsSections(readMailboxSettingsSectionState(mailboxSettingsSectionsStorageKey))
    setHydratedMailboxSettingsSectionsKey(mailboxSettingsSectionsStorageKey)
    setMailboxSettingsSectionsServerHydrated(false)

    const hydrateFromDatabase = async () => {
      if (!user?.id) {
        if (!cancelled) setMailboxSettingsSectionsServerHydrated(true)
        return
      }
      try {
        const { data } = await dedupedGet<{ sections?: Partial<MailboxSettingsSectionState> }>('/api/mailbox/preferences/settings-sections')
        const sections = data?.sections as Partial<MailboxSettingsSectionState> | undefined
        if (!cancelled && sections) {
          const nextSections = {
            threadView: sections.threadView !== false,
            inboxDisplay: sections.inboxDisplay !== false,
            confirmations: sections.confirmations !== false,
            syncDefaults: sections.syncDefaults !== false,
            notifications: sections.notifications !== false,
          }
          mailboxPreferenceSnapshotsRef.current.set('/api/mailbox/preferences/settings-sections', JSON.stringify({ sections: nextSections }))
          setMailboxSettingsSections(nextSections)
        }
      } catch {
        // Local storage remains the fallback when the preference API is unavailable.
      } finally {
        if (!cancelled) setMailboxSettingsSectionsServerHydrated(true)
      }
    }

    void hydrateFromDatabase()
    return () => { cancelled = true }
  }, [mailboxSettingsSectionsStorageKey, user?.id])

  useEffect(() => {
    if (hydratedMailboxSettingsSectionsKey !== mailboxSettingsSectionsStorageKey) return
    window.localStorage.setItem(
      mailboxSettingsSectionsStorageKey,
      JSON.stringify(mailboxSettingsSections),
    )
    if (mailboxSettingsSectionsServerHydrated && user?.id) {
      void saveMailboxPreference('/api/mailbox/preferences/settings-sections', {
        sections: mailboxSettingsSections,
      })
    }
  }, [hydratedMailboxSettingsSectionsKey, mailboxSettingsSections, mailboxSettingsSectionsServerHydrated, mailboxSettingsSectionsStorageKey, saveMailboxPreference, user?.id])

  const getImportConfig = useCallback(
    (accountId: string): AccountImportConfig =>
      importConfigs[accountId] ?? DEFAULT_ACCOUNT_IMPORT_CONFIG,
    [importConfigs]
  )

  const setImportConfig = (accountId: string, patch: Partial<AccountImportConfig>) =>
    setImportConfigs((prev) => ({
      ...prev,
      [accountId]: { ...getImportConfig(accountId), ...patch },
    }))

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true)
    try {
      const { data } = await apiClient.get('/api/mailbox/analytics')
      setAnalyticsData(data as MailboxAnalytics)
    } catch {
      // analytics are non-critical; fail silently
    } finally {
      setAnalyticsLoading(false)
    }
  }, [])

  const [accounts, setAccounts] = useState<MailAccount[]>(
    () => getSessionCacheValue<MailAccount[]>(mailboxAccountsCacheKey) ?? []
  )
  const [messages, setMessages] = useState<MailMessage[]>(
    () => getSessionCacheValue<MailMessage[]>(mailboxMessagesCacheKey) ?? []
  )
  const [messagesTotal, setMessagesTotal] = useState(0)
  const [inboxLoadLimit, setInboxLoadLimit] = useState(() => {
    try {
      const stored = localStorage.getItem(MAILBOX_LOAD_LIMIT_STORAGE_KEY)
      const parsed = stored ? parseInt(stored, 10) : NaN
      return Number.isFinite(parsed) && parsed >= 10 && parsed <= 500
        ? parsed
        : MESSAGE_LOAD_DEFAULT
    } catch {
      return MESSAGE_LOAD_DEFAULT
    }
  })
  const [inboxLoadStep, setInboxLoadStep] = useState(MESSAGE_LOAD_DEFAULT)
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false)
  const [loadMoreProgress, setLoadMoreProgress] = useState<{
    checked: number
    total: number
  } | null>(null)
  const [visibleTarget, setVisibleTarget] = useState(MESSAGE_LOAD_DEFAULT)
  const [selectedThread, setSelectedThread] = useState<MailThread | null>(null)
  const selectedThreadIdentity = selectedThread?.id
  // Set when opening a thread 404s (e.g. its account was removed in another session/tab while this
  // one still had it cached in the inbox list) so the error panel can offer to clear it out locally.
  const [inaccessibleThread, setInaccessibleThread] = useState<{
    threadId: string
    messageId: string | null
  } | null>(null)
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([])
  const threadMessagesRef = useRef(threadMessages)
  threadMessagesRef.current = threadMessages
  const [focusedThreadMessageId, setFocusedThreadMessageId] = useState<string | null>(null)
  const [threadScrollRequest, setThreadScrollRequest] = useState<{
    messageId: string
    includePreviousHeader?: boolean
  } | null>(null)
  const [openingMailboxMessageId, setOpeningMailboxMessageId] = useState<string | null>(null)
  const threadMessageHeaderRefs = useRef(new Map<string, HTMLDivElement>())
  const threadReaderRef = useRef<HTMLDivElement>(null)
  const threadHeaderPointerRef = useRef<{ x: number; y: number } | null>(null)
  const [threadAttachments, setThreadAttachments] = useState<ThreadAttachmentEntry[]>([])
  const [attachmentsLoading, setAttachmentsLoading] = useState(false)
  const [downloadingAttachmentKey, setDownloadingAttachmentKey] = useState<string | null>(null)
  const [isDownloadingAllAttachments, setIsDownloadingAllAttachments] = useState(false)
  const [hoveredAttachmentPreview, setHoveredAttachmentPreview] = useState<{
    key: string
    url: string | null
    loading: boolean
    error: string | null
  } | null>(null)
  const [confirmPrompt, setConfirmPrompt] = useState<MailboxConfirmPrompt | null>(null)
  const [confirmSuppressDraft, setConfirmSuppressDraft] = useState(false)
  const [suppressedConfirmKeys, setSuppressedConfirmKeys] = useState<MailboxConfirmKey[]>([])
  const [removingAccountId, setRemovingAccountId] = useState<string | null>(null)
  const [updatingPrimaryAccountId, setUpdatingPrimaryAccountId] = useState<string | null>(null)
  const [accountRemovalPreview, setAccountRemovalPreview] = useState<{
    accountId: string
    messages: number
    threads: number
    drafts: number
  } | null>(null)
  const [threadTrashing, setThreadTrashing] = useState(false)
  const [collapsedThreadMessageIds, setCollapsedThreadMessageIds] = useState<Set<string>>(
    new Set()
  )
  const [hoveredMailboxMessageId, setHoveredMailboxMessageId] = useState<string | null>(null)
  const [fadingMailboxMessageId, setFadingMailboxMessageId] = useState<string | null>(null)
  const mailboxMessageHoverFadeTimeoutRef = useRef<number | null>(null)
  const [expandedSourceDetailsMessageIds, setExpandedSourceDetailsMessageIds] = useState<
    Set<string>
  >(new Set())
  const [mailboxTags, setMailboxTags] = useState<MailboxTagItem[]>(
    () => getSessionCacheValue<MailboxTagItem[]>(mailboxTagsCacheKey) ?? []
  )
  // Guards filter-state hydration: reconciling against an empty tag list before tags load would strip stored custom tag rules.
  const [mailboxTagsLoaded, setMailboxTagsLoaded] = useState(false)
  const [isTagPanelOpen, setIsTagPanelOpen] = useState(false)
  const [isTagPickerOpen, setIsTagPickerOpen] = useState(false)
  const [tagPickerPosition, setTagPickerPosition] = useState<{ left: number; top: number } | null>(
    null
  )
  const [selectedTagMessageId, setSelectedTagMessageId] = useState<string | null>(null)
  const [newTagLabel, setNewTagLabel] = useState('')
  const [newTagColor, setNewTagColor] = useState(MAILBOX_TAG_DEFAULT_COLOR)
  const [editingTagId, setEditingTagId] = useState<string | null>(null)
  const [editingTagLabel, setEditingTagLabel] = useState('')
  const [editingTagColor, setEditingTagColor] = useState(MAILBOX_TAG_DEFAULT_COLOR)
  const [tagsSaving, setTagsSaving] = useState(false)
  const [tagPickerScope, setTagPickerScope] = useState<'message' | 'thread'>('message')
  // Tag ids kept mounted (visually fading out) after being unchecked, keyed by message id.
  const [fadingTagRemovals, setFadingTagRemovals] = useState<Map<string, Set<string>>>(
    () => new Map()
  )
  // Message ids given a slower transition duration briefly after a tag fade completes, so the reflow reads as a deliberate move.
  const [settlingMessageIds, setSettlingMessageIds] = useState<Set<string>>(() => new Set())

  const [people, setPeople] = useState<MailPerson[]>([])
  const [peopleSearchQuery, setPeopleSearchQuery] = useState('')
  const [editingContactId, setEditingContactId] = useState<string | null>(null)
  const [contactEditDraft, setContactEditDraft] = useState({
    display_name: '',
    region: '',
    timezone: '',
    labels: '',
  })
  const [contactSaving, setContactSaving] = useState(false)
  const [newIdentityEmail, setNewIdentityEmail] = useState('')
  const [identitySaving, setIdentitySaving] = useState(false)
  const [showAddContactForm, setShowAddContactForm] = useState(false)
  const [newContactDraft, setNewContactDraft] = useState({ display_name: '', email: '' })
  const [addContactSaving, setAddContactSaving] = useState(false)
  const [addContactError, setAddContactError] = useState('')
  const [invitations, setInvitations] = useState<MailInvitation[]>([])
  const [rules, setRules] = useState<AutomationRuleRecord[]>([])
  const [isAutomationPanelOpen, setIsAutomationPanelOpen] = useState(false)
  useMobileNavigationPanelDismiss(() => {
    setIsTagPanelOpen(false)
    setIsAutomationPanelOpen(false)
    setGuideTagsPanelOpen(false)
    if (invitationCalendarDisplayMode === 'panel') setInvitationCalendarPanelHidden(true)
  })
  const [selectedAutomationRuleId, setSelectedAutomationRuleId] = useState<string | null>(null)
  const [automationDraft, setAutomationDraft] = useState<AutomationRuleDefinition | null>(null)
  const [automationSaving, setAutomationSaving] = useState(false)
  const [automationRunning, setAutomationRunning] = useState(false)
  // Synchronous guard against double-invocation from rapid repeat clicks -- `automationRunning`
  // state is not guaranteed to have committed yet by the time a second click handler runs.
  const automationRunningRef = useRef(false)
  const [automationRunResult, setAutomationRunResult] = useState<AutomationRunResult | null>(null)
  // Fingerprint of the rule as it existed when automationRunResult was produced, so a later
  // edit (or save) can be detected and the stale preview/run result flagged in the UI.
  const [automationRunResultFingerprint, setAutomationRunResultFingerprint] = useState<
    string | null
  >(null)
  const [automationError, setAutomationError] = useState<string | null>(null)
  const [selectedAutomationSettingsRuleId, setSelectedAutomationSettingsRuleId] = useState<
    string | null
  >(null)
  const [automationSettingsDraft, setAutomationSettingsDraft] =
    useState<AutomationRuleDefinition | null>(null)
  const [automationSettingsSaving, setAutomationSettingsSaving] = useState(false)
  const [automationSettingsError, setAutomationSettingsError] = useState<string | null>(null)
  const [calendarSources, setCalendarSources] = useState<CalendarSourceTarget[]>([])
  const [coordinationCalendars, setCoordinationCalendars] = useState<CoordinationCalendarTarget[]>(
    []
  )
  const [timeManagerModes, setTimeManagerModes] = useState<TimeManagerModeTarget[]>([])
  const [timeManagerCategories, setTimeManagerCategories] = useState<TimeManagerCategoryTarget[]>(
    []
  )
  const [selectedTimeManagerCategoryIds, setSelectedTimeManagerCategoryIds] = useState<Set<string>>(
    () => {
      if (typeof window === 'undefined') return new Set()
      try {
        const stored = localStorage.getItem('mailbox:time-manager-categories:v1')
        return stored ? new Set(JSON.parse(stored)) : new Set()
      } catch {
        return new Set()
      }
    }
  )
  const [categoryTagModalMode, setCategoryTagModalMode] = useState<TimeManagerModeTarget | null>(
    null
  )
  const [calendarTargetsLoaded, setCalendarTargetsLoaded] = useState(false)
  const [calendarTargetsLoading, setCalendarTargetsLoading] = useState(false)
  const [selectedInvitation, setSelectedInvitation] = useState<MailInvitation | null>(null)
  const [threadInvitationChoices, setThreadInvitationChoices] = useState<MailInvitation[] | null>(null)
  const [invitationCalendarPanelHidden, setInvitationCalendarPanelHidden] = useState(false)
  const [invitationCalendarDisplayMode, setInvitationCalendarDisplayMode] =
    useState<AddToCalendarDisplayMode>(readAddToCalendarDisplayMode)
  const handleInvitationCalendarModeChange = useCallback((mode: AddToCalendarDisplayMode) => {
    setInvitationCalendarPanelHidden(false)
    setInvitationCalendarDisplayMode(mode)
    persistAddToCalendarDisplayMode(mode)
  }, [])
  const [invitationDetailsExpanded, setInvitationDetailsExpanded] = useState(false)
  const [invitationEditTitle, setInvitationEditTitle] = useState('')
  const [invitationEditDate, setInvitationEditDate] = useState('')
  const [invitationEditTime, setInvitationEditTime] = useState('')
  const [invitationEditAddress, setInvitationEditAddress] = useState('')
  const [invitationEditDescription, setInvitationEditDescription] = useState('')
  const [selectedGoogleTargetIds, setSelectedGoogleTargetIds] = useState<Set<string>>(new Set())
  const [selectedTimeManagerModeIds, setSelectedTimeManagerModeIds] = useState<Set<string>>(
    new Set()
  )
  const [selectedCoordinationHashes, setSelectedCoordinationHashes] = useState<Set<string>>(
    new Set()
  )
  const [createNewCoordinationCalendar, setCreateNewCoordinationCalendar] = useState(false)
  const [newCoordinationCalendarTitle, setNewCoordinationCalendarTitle] = useState('')
  const [showAllCoordinationCalendars, setShowAllCoordinationCalendars] = useState(false)
  const [calendarActionSaving, setCalendarActionSaving] = useState(false)
  const [calendarActionError, setCalendarActionError] = useState<string | null>(null)
  const [calendarDeliveryNotices, setCalendarDeliveryNotices] = useState<CalendarDeliveryNotice[]>([])
  const calendarDeliveryTimersRef = useRef(new Map<string, number>())
  const calendarDeliveryRetryActionsRef = useRef(
    new Map<string, (attempts: number) => void>()
  )
  const calendarDeliveryInvitationsRef = useRef(new Map<string, MailInvitation>())

  const updateCalendarDeliveryNotice = useCallback(
    (noticeId: string, update: (notice: CalendarDeliveryNotice) => CalendarDeliveryNotice) => {
      setCalendarDeliveryNotices((current) =>
        current.map((notice) => (notice.id === noticeId ? update(notice) : notice))
      )
    },
    []
  )

  const updateCalendarDeliveryTarget = useCallback(
    (
      noticeId: string,
      targetId: string,
      update: (target: CalendarDeliveryTarget) => CalendarDeliveryTarget,
      successAt?: number
    ) => {
      setCalendarDeliveryNotices((current) =>
        current.map((notice) => {
          if (notice.id !== noticeId) return notice
          let targetFailed = false
          const targets = notice.targets.map((target) => {
            if (target.id !== targetId) return target
            const updated = update(target)
            targetFailed = updated.status === 'failed'
            return updated
          })
          return {
            ...notice,
            targets,
            ...(targetFailed ? { failureDismissed: false } : {}),
            ...(successAt !== undefined
              ? { successVisible: true, successExpiresAt: successAt }
              : {}),
          }
        })
      )
    },
    []
  )

  const persistImportedInvitationStatus = useCallback(
    async (notice: CalendarDeliveryNotice) => {
      try {
        await apiClient.patch(`/api/mailbox/invitations/${notice.invitationId}/status`, {
          status: 'imported',
          provider_event_ref: `mailbox-ui:${notice.id}`,
        })
        const source = calendarDeliveryInvitationsRef.current.get(notice.id)
        setInvitations((current) => {
          let found = false
          const next = current.map((invite) => {
            if (invitationIdentityKey(invite) !== notice.invitationIdentity) return invite
            found = true
            return {
              ...invite,
              status: 'imported',
              provider_event_ref: invite.provider_event_ref || `mailbox-ui:${notice.id}`,
            }
          })
          if (!found && source) {
            next.unshift({
              ...source,
              status: 'imported',
              provider_event_ref: `mailbox-ui:${notice.id}`,
            })
          }
          return next
        })
        updateCalendarDeliveryNotice(notice.id, (current) => ({
          ...current,
          invitationStatus: 'saved',
          invitationStatusWarningDismissed: false,
          invitationStatusError: undefined,
        }))
      } catch (error) {
        updateCalendarDeliveryNotice(notice.id, (current) => ({
          ...current,
          invitationStatus: 'failed',
          invitationStatusWarningDismissed: false,
          invitationStatusError: apiErrorMessage(error),
        }))
      }
    },
    [updateCalendarDeliveryNotice]
  )

  const retryCalendarDeliveryTarget = useCallback(
    (noticeId: string, target: CalendarDeliveryTarget) => {
      const retry = calendarDeliveryRetryActionsRef.current.get(`${noticeId}:${target.id}`)
      retry?.(target.attempts)
    },
    []
  )

  const retryImportedInvitationStatus = useCallback(
    (notice: CalendarDeliveryNotice) => {
      updateCalendarDeliveryNotice(notice.id, (current) => ({
        ...current,
        invitationStatus: 'saving',
        invitationStatusWarningDismissed: false,
        invitationStatusError: undefined,
      }))
      void persistImportedInvitationStatus(notice)
    },
    [persistImportedInvitationStatus, updateCalendarDeliveryNotice]
  )

  const dismissCalendarDeliverySuccess = useCallback((noticeId: string) => {
    setCalendarDeliveryNotices((current) =>
      current.flatMap((notice) => {
        if (notice.id !== noticeId) return [notice]
        const next = { ...notice, successVisible: false, successExpiresAt: null }
        const allSucceeded = next.targets.every((target) => target.status === 'succeeded')
        return allSucceeded &&
          !next.successVisible &&
          (next.invitationStatus === 'saved' || next.invitationStatusWarningDismissed)
          ? []
          : [next]
      })
    )
  }, [])

  const dismissCalendarDeliveryFailure = useCallback((noticeId: string) => {
    setCalendarDeliveryNotices((current) =>
      current.flatMap((notice) => {
        if (notice.id !== noticeId) return [notice]
        const hasActiveTarget = notice.targets.some(
          (target) => target.status === 'pending' || target.status === 'sending' || target.status === 'retrying'
        )
        if (!hasActiveTarget && !notice.successVisible && notice.invitationStatus !== 'failed') {
          return []
        }
        return [{ ...notice, failureDismissed: true }]
      })
    )
  }, [])

  useEffect(() => {
    for (const notice of calendarDeliveryNotices) {
      if (
        notice.targets.length > 0 &&
        notice.targets.every((target) => target.status === 'succeeded') &&
        notice.invitationStatus === 'pending'
      ) {
        updateCalendarDeliveryNotice(notice.id, (current) => ({
          ...current,
          invitationStatus: 'saving',
        }))
        void persistImportedInvitationStatus(notice)
      }
    }
  }, [calendarDeliveryNotices, persistImportedInvitationStatus, updateCalendarDeliveryNotice])

  useEffect(() => {
    const timers: number[] = []
    for (const notice of calendarDeliveryNotices) {
      if (!notice.successVisible || notice.successExpiresAt === null) continue
      const timer = window.setTimeout(() => {
        setCalendarDeliveryNotices((current) =>
          current.flatMap((entry) => {
            if (entry.id !== notice.id) return [entry]
            const next = {
              ...entry,
              successVisible: false,
              successExpiresAt: null,
            }
            const allSucceeded = next.targets.every((target) => target.status === 'succeeded')
              const hasActiveTarget = next.targets.some(
                (target) =>
                  target.status === 'pending' ||
                  target.status === 'sending' ||
                  target.status === 'retrying'
              )
              return allSucceeded &&
                (next.invitationStatus === 'saved' || next.invitationStatusWarningDismissed) ||
                next.failureDismissed && !hasActiveTarget && next.invitationStatus !== 'failed'
                ? []
                : [next]
            })
        )
      }, Math.max(0, notice.successExpiresAt - Date.now()))
      timers.push(timer)
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [calendarDeliveryNotices])

  useEffect(() => {
    const activeNoticeIds = new Set(calendarDeliveryNotices.map((notice) => notice.id))
    for (const noticeId of calendarDeliveryInvitationsRef.current.keys()) {
      if (!activeNoticeIds.has(noticeId)) calendarDeliveryInvitationsRef.current.delete(noticeId)
    }
    for (const key of calendarDeliveryRetryActionsRef.current.keys()) {
      const noticeId = key.slice(0, key.indexOf(':'))
      if (!activeNoticeIds.has(noticeId)) calendarDeliveryRetryActionsRef.current.delete(key)
    }
    for (const [key, timer] of calendarDeliveryTimersRef.current) {
      const noticeId = key.slice(0, key.indexOf(':'))
      if (!activeNoticeIds.has(noticeId)) {
        window.clearTimeout(timer)
        calendarDeliveryTimersRef.current.delete(key)
      }
    }
  }, [calendarDeliveryNotices])

  useEffect(
    () => () => {
      for (const timer of calendarDeliveryTimersRef.current.values()) {
        window.clearTimeout(timer)
      }
      calendarDeliveryTimersRef.current.clear()
      calendarDeliveryRetryActionsRef.current.clear()
    },
    []
  )

  const [queryInput, setQueryInput] = useState('')
  const [committedQuery, setCommittedQuery] = useState('')
  const [isSearchComputing, setIsSearchComputing] = useState(false)
  const [showAdditionalFilters, setShowAdditionalFilters] = useState(false)
  const [showMassActions, setShowMassActions] = useState(false)
  const [massActionRunning, setMassActionRunning] = useState(false)
  const [massActionError, setMassActionError] = useState<string | null>(null)
  const [massActionResult, setMassActionResult] = useState<MailboxMassActionResult | null>(null)
  const [excludedAccountIds, setExcludedAccountIds] = useState<string[]>([])
  const [excludedGroups, setExcludedGroups] = useState<string[]>([])
  // Account checklist always starts collapsed on load, so its expansion is not persisted.
  const [isAccountFilterListExpanded, setIsAccountFilterListExpanded] = useState(false)
  const [isGroupFilterListExpanded, setIsGroupFilterListExpanded] = useState(false)
  const [dateFromFilter, setDateFromFilter] = useState('')
  const [dateToFilter, setDateToFilter] = useState('')
  // Briefly rings the search bar / date fields when a filter or sort-mode change is applied on top
  // of an already-set search query or date range, so the user notices those still apply.
  const [additionalFiltersHighlightActive, setAdditionalFiltersHighlightActive] = useState(false)
  const additionalFiltersHighlightTimeoutRef = useRef<number | null>(null)
  const triggerAdditionalFiltersHighlight = useCallback(() => {
    const hasSearchQuery = queryInput.trim().length > 0
    const hasDateFilter = Boolean(dateFromFilter || dateToFilter)
    if (!hasSearchQuery && !hasDateFilter) return

    if (additionalFiltersHighlightTimeoutRef.current) {
      window.clearTimeout(additionalFiltersHighlightTimeoutRef.current)
    }
    setAdditionalFiltersHighlightActive(true)
    additionalFiltersHighlightTimeoutRef.current = window.setTimeout(() => {
      setAdditionalFiltersHighlightActive(false)
      additionalFiltersHighlightTimeoutRef.current = null
    }, MAILBOX_ADDITIONAL_FILTERS_HIGHLIGHT_MS)
  }, [queryInput, dateFromFilter, dateToFilter])
  useEffect(
    () => () => {
      if (additionalFiltersHighlightTimeoutRef.current) {
        window.clearTimeout(additionalFiltersHighlightTimeoutRef.current)
      }
    },
    []
  )
  // Hydrated synchronously from this device's storage so the very first paint already honours the
  // primary filter and its sorting. Waiting for the tags + shared filter-rules requests used to
  // render the unfiltered mailbox for a moment on every reload.
  const initialFilterHydration = useRef<{
    state: MailboxFilterState
    primaryFilterId: string | null
    hadStoredState: boolean
  } | null>(null)
  if (initialFilterHydration.current === null) {
    const userKey = user?.id || 'guest'
    const storageKey = `${MAILBOX_FILTERS_STATE_KEY_PREFIX}${userKey}`
    const cachedTagIds = (getSessionCacheValue<MailboxTagItem[]>(mailboxTagsCacheKey) ?? []).map(
      (tag) => tag.id
    )
    const storedState = readMailboxFilterState(storageKey, cachedTagIds)
    const storedPrimaryFilterId = readMailboxPrimaryFilterId(
      `${MAILBOX_PRIMARY_FILTER_KEY_PREFIX}${userKey}`,
      storedState.filters.map((filter) => filter.id)
    )
    initialFilterHydration.current = {
      state: storedPrimaryFilterId
        ? { ...storedState, activeFilterId: storedPrimaryFilterId }
        : storedState,
      primaryFilterId: storedPrimaryFilterId ?? storedState.activeFilterId,
      hadStoredState: hasStoredMailboxFilterState(storageKey),
    }
  }

  const [filterState, setFilterState] = useState<MailboxFilterState>(
    () => initialFilterHydration.current!.state
  )
  const [notificationRulesState, setNotificationRulesState] = useState<MailboxNotificationRulesState>(() =>
    buildDefaultMailboxNotificationRulesState([])
  )
  const [threadingOptions, setThreadingOptions] = useState<MailboxThreadingOptions>(
    DEFAULT_MAILBOX_THREADING_OPTIONS,
  )
  const [threadingOptionsLoaded, setThreadingOptionsLoaded] = useState(false)
  const [hydratedNotificationRulesKey, setHydratedNotificationRulesKey] = useState<string | null>(null)
  const [primaryFilterId, setPrimaryFilterId] = useState<string | null>(
    () => initialFilterHydration.current!.primaryFilterId
  )
  const [expandedFilterIds, setExpandedFilterIds] = useState<string[]>([])
  const [renamingFilterId, setRenamingFilterId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [newFilterName, setNewFilterName] = useState('')
  const [isAddingFilter, setIsAddingFilter] = useState(false)
  const [showLearnerGuide, setShowLearnerGuide] = useState(false)
  const [selectedThreadLoading, setSelectedThreadLoading] = useState(false)
  const [showPeopleHtmlTrustTool, setShowPeopleHtmlTrustTool] = useState(true)
  const [showPeopleJunkTool, setShowPeopleJunkTool] = useState(true)
  const [showPeopleCard, setShowPeopleCard] = useState(true)
  const [trustedHtmlDomains, setTrustedHtmlDomains] = useState<Set<string>>(new Set())
  const [junkDomains, setJunkDomains] = useState<Set<string>>(new Set())
  const [savingJunk, setSavingJunk] = useState(false)
  const [junkActionWarning, setJunkActionWarning] = useState<{ threadId: string | null; message: string } | null>(null)
  const [nonOrganizerSenders, setNonOrganizerSenders] = useState<Set<string>>(new Set())
  const [nonOrganizerSendersLoaded, setNonOrganizerSendersLoaded] = useState(false)
  const [showPeopleNonOrganizerTool, setShowPeopleNonOrganizerTool] = useState(true)
  const [invitationQuery, setInvitationQuery] = useState('')
  const [invitationSortOrder, setInvitationSortOrder] =
    useState<InvitationSortOrder>('latest-first')
  const [trustedDomainsLoaded, setTrustedDomainsLoaded] = useState(false)
  const [junkDomainsLoaded, setJunkDomainsLoaded] = useState(false)
  const [mailViewerMode, setMailViewerMode] = useState<MailViewerMode>('raw-text')
  const mobileFormatPickerRef = useRef<HTMLDetailsElement>(null)
  const [pendingTrustMessageId, setPendingTrustMessageId] = useState<string | null>(null)
  const [activeDraft, setActiveDraft] = useState<MailDraft | null>(null)
  const [draftDetailsExpanded, setDraftDetailsExpanded] = useState(false)
  const [draftReading, setDraftReading] = useState(false)
  const [draftReadDetailsExpanded, setDraftReadDetailsExpanded] = useState(false)
  const draftToggleHoveredRef = useRef(false)
  const isReadingWithDraft = Boolean(activeDraft && threadMessages.length > 0
    && draftReading)
  const showingDraftDetails = isReadingWithDraft ? draftReadDetailsExpanded : draftDetailsExpanded
  const draftContentMinimized = isReadingWithDraft && !draftReadDetailsExpanded
  const toggleDraftReading = () => {
    setDraftReading(current => !current)
    setDraftReadDetailsExpanded(false)
  }
  const activeDraftRef = useRef(activeDraft)
  activeDraftRef.current = activeDraft
  const pendingSentRepliesRef = useRef(new Map<string, PendingSentReply>())
  const [messageActivityLog, setMessageActivityLog] = useState<{
    message: Pick<MailMessage, 'id' | 'subject'>
    activity: MailActivityLog | null
    loading: boolean
  } | null>(null)
  const draftAttachmentInputRef = useRef<HTMLInputElement>(null)
  const [drafts, setDrafts] = useState<MailDraftRecord[]>([])
  const [draftRecipientsExpanded, setDraftRecipientsExpanded] = useState(false)
  const [recipientSuggestionTarget, setRecipientSuggestionTarget] = useState<{
    field: MailDraftRecipientField
    index: number
  } | null>(null)
  const [draftVisibleFields, setDraftVisibleFields] = useState<MailDraftRecipientField[]>(['to'])
  const [draftSaving, setDraftSaving] = useState(false)
  const [draftSending, setDraftSending] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [draftNotice, setDraftNotice] = useState<string | null>(null)
  const [aiDraftInstruction, setAiDraftInstruction] = useState('')
  const [aiDraftLoading, setAiDraftLoading] = useState(false)
  const draftSuggestionSessionRef = useRef(0)
  const [aiReplySuggestion, setAiReplySuggestion] = useState<{
    id: number; instruction: string; subject: string; body: string
  } | null>(null)
  const aiReplySuggestionIdRef = useRef(0)
  const [sentNotice, setSentNotice] = useState<{
    id: string
    recipients: string[]
    subject: string
    threadId: string | null
    syncing: boolean
    syncFailed?: boolean
  } | null>(null)
  const [sentSyncWarnings, setSentSyncWarnings] = useState<Record<string, string>>({})
  const sentNoticeId = sentNotice?.id
  useEffect(() => {
    if (!sentNoticeId) return
    const timer = window.setTimeout(() => {
      setSentNotice((current) => current?.id === sentNoticeId ? null : current)
    }, 4000)
    return () => window.clearTimeout(timer)
  }, [sentNoticeId])
  const [mobileMailboxScreen, setMobileMailboxScreen] = useState<'list' | 'thread'>('list')
  const [isMobileMailboxLayout, setIsMobileMailboxLayout] = useState(
    typeof window !== 'undefined' ? window.innerWidth < MAILBOX_MOBILE_BREAKPOINT_PX : false
  )
  const [inboxPanelRatio, setInboxPanelRatio] = useState(MAILBOX_INBOX_WIDTH_DEFAULT_RATIO)
  const [isInboxHeaderCompact, setIsInboxHeaderCompact] = useState(false)
  const [showNewEmailLabel, setShowNewEmailLabel] = useState(true)
  const [filteredMessages, setFilteredMessages] = useState<MailMessage[]>([])
  const [removingMessageIds, setRemovingMessageIds] = useState<Set<string>>(() => new Set())
  // Ids that no longer match the active filters but are kept mounted (animating out) for MAILBOX_FILTER_HIDE_MS.
  const [filterVanishingMessageIds, setFilterVanishingMessageIds] = useState<Set<string>>(
    () => new Set()
  )
  // True while the open thread's message is vanishing due to a filter change, so the Thread Viewer collapses in sync.
  const [isThreadViewerCollapsing, setIsThreadViewerCollapsing] = useState(false)
  const learnerGuideRef = useRef<HTMLButtonElement>(null)
  const mailboxSplitRef = useRef<HTMLDivElement>(null)
  const mailboxListScrollTopRef = useRef(0)
  const inboxHeaderRef = useRef<HTMLDivElement>(null)
  const resizePointerIdRef = useRef<number | null>(null)
  const inboxLoadLimitRef = useRef(MESSAGE_LOAD_DEFAULT)
  const mailboxMountedRef = useRef(true)
  const messagesRef = useRef<MailMessage[]>([])
  const messagesTotalRef = useRef(0)
  const hasMountedFiltersRef = useRef(false)
  const visibleTargetRef = useRef(MESSAGE_LOAD_DEFAULT)
  const isLoadingMoreRef = useRef(false)
  const activeTargetRef = useRef(MESSAGE_LOAD_DEFAULT)
  const activeSilentRef = useRef(false)
  const scanEpochRef = useRef(0)
  useEffect(() => () => { scanEpochRef.current += 1 }, [])
  const mailboxSettingsInputRef = useRef<HTMLInputElement>(null)
  const newTagInputRef = useRef<HTMLInputElement>(null)
  const selectedThreadIdRef = useRef<string | null>(null)
  const openThreadRequestSeqRef = useRef(0)
  const threadRefreshInFlightRef = useRef<number | null>(null)
  const threadRefreshQueuedRef = useRef(false)
  const observedThreadInboxRef = useRef<{ threadId: string; messageIds: Set<string> } | null>(null)
  const viewerFormatThreadIdRef = useRef<string | null>(null)
  const threadCacheRef = useRef(new Map<string, CachedThread>())
  const threadPrefetchInFlightRef = useRef(new Set<string>())
  const attachmentCacheRef = useRef(new Map<string, ThreadAttachmentEntry[]>())
  const attachmentPreviewCacheRef = useRef(new Map<string, string>())
  const attachmentHoverTimeoutRef = useRef<number | null>(null)
  const selectTopThreadAfterTrashRef = useRef(false)
  // Trash/restore flags the server has not persisted yet; stale reads must not overwrite them.
  const pendingTrashRef = useRef(createPendingTrashOverlay())
  // Rows that already played the trash/junk/archive exit (id -> expiry ms). The filter effect must
  // drop them instantly instead of treating them as filter-hidden and fading the gap in a second time.
  const exitedMessageIdsRef = useRef(new Map<string, number>())
  // Exit-animation ids whose state update is queued; cleared by the filter effect (see clearMessageRemovalAnimation).
  const pendingExitClearIdsRef = useRef(new Set<string>())
  // Messages the user trashed in this session. They stay out of the inbox list while still trashed,
  // even when the active filter shows Trash, so the exit never "springs back" as a Trash-labelled row.
  const sessionTrashedIdsRef = useRef(new Set<string>())
  const previousCommittedQueryRef = useRef('')
  const previousFilteredMessagesRef = useRef<MailMessage[]>([])
  const previousBaseFilterKeyRef = useRef('')
  const trustedDomainsPersistedKeyRef = useRef<string | null>(null)
  const junkDomainsPersistedKeyRef = useRef<string | null>(null)
  const nonOrganizerPersistedKeyRef = useRef<string | null>(null)

  const [hydratedPanelVisibilityKey, setHydratedPanelVisibilityKey] = useState<string | null>(null)
  const [hydratedFiltersKey, setHydratedFiltersKey] = useState<string | null>(null)
  const [hydratedFilterRulesKey, setHydratedFilterRulesKey] = useState<string | null>(null)

  const [aiAccess, setAiAccess] = useState<MailboxAiAccessConfig>(DEFAULT_MAILBOX_AI_ACCESS)
  const aiAccessHydratedRef = useRef(false)
  const [requestedFeatureIds, setRequestedFeatureIds] = useState<Set<MailboxAiAccessId>>(new Set())
  const [requestingFeatureId, setRequestingFeatureId] = useState<MailboxAiAccessId | null>(null)

  const defaultAccountForm = useMemo(
    () => ({
      provider: 'gmail' as MailboxAccountProvider,
      address: '',
      display_name: '',
      identity_group: 'personal',
      imap_host: '',
      imap_port: '993',
      imap_username: '',
      imap_password: '',
      imap_security: 'ssl' as ImapSecurity,
      imap_mailbox: 'INBOX',
    }),
    []
  )

  const [accountForm, setAccountForm] = useState({
    ...defaultAccountForm,
  })

  const uniqueGroups = useMemo(() => {
    const values = new Set<string>()
    for (const account of accounts) values.add(account.identity_group)
    return Array.from(values).sort((a, b) => a.localeCompare(b))
  }, [accounts])

  const toggleAccountFilter = useCallback((accountId: string) => {
    setExcludedAccountIds((prev) =>
      prev.includes(accountId) ? prev.filter((id) => id !== accountId) : [...prev, accountId]
    )
  }, [])

  const toggleGroupFilter = useCallback((group: string) => {
    setExcludedGroups((prev) =>
      prev.includes(group) ? prev.filter((value) => value !== group) : [...prev, group]
    )
  }, [])

  const selectCustomFilter = useCallback((filterId: string) => {
    setFilterState((prev) => ({ ...prev, activeFilterId: filterId }))
    triggerAdditionalFiltersHighlight()
  }, [triggerAdditionalFiltersHighlight])

  const selectShowAllFilter = useCallback(() => {
    const defaultFilter = buildDefaultMailboxFilterState(mailboxTags.map((tag) => tag.id)).filters[0]

    setFilterState((prev) => {
      const filters = [...prev.filters]
      const defaultFilterIndex = filters.findIndex((filter) => filter.id === MAILBOX_DEFAULT_FILTER_ID)

      if (defaultFilterIndex === -1) {
        if (filters.length >= MAILBOX_MAX_FILTERS) {
          let removableIndex = filters.length - 1
          while (removableIndex >= 0 && filters[removableIndex].id === primaryFilterId) {
            removableIndex -= 1
          }
          if (removableIndex >= 0) filters.splice(removableIndex, 1)
        }
        filters.unshift(defaultFilter)
      } else if (filters[defaultFilterIndex].name !== defaultFilter.name) {
        filters[defaultFilterIndex] = defaultFilter
      }

      return { filters, activeFilterId: MAILBOX_DEFAULT_FILTER_ID }
    })
    triggerAdditionalFiltersHighlight()
  }, [mailboxTags, primaryFilterId, triggerAdditionalFiltersHighlight])

  const updateCustomFilterSort = useCallback((filterId: string, sort: MailboxSortState) => {
    setFilterState((prev) => ({
      ...prev,
      filters: prev.filters.map((filter) =>
        filter.id === filterId ? { ...filter, sort } : filter
      ),
    }))
    triggerAdditionalFiltersHighlight()
  }, [triggerAdditionalFiltersHighlight])

  const toggleFilterConfiguration = useCallback((filterId: string) => {
    setExpandedFilterIds((prev) =>
      prev.includes(filterId) ? prev.filter((id) => id !== filterId) : [...prev, filterId]
    )
  }, [])

  const makeFilterPrimary = useCallback((filterId: string) => {
    setPrimaryFilterId(filterId)
    setFilterState((prev) => makeMailboxFilterPrimary(prev, filterId))
    triggerAdditionalFiltersHighlight()
  }, [triggerAdditionalFiltersHighlight])

  const startRenamingFilter = useCallback((filterId: string, currentName: string) => {
    setRenamingFilterId(filterId)
    setRenameDraft(currentName)
  }, [])

  const cancelRenamingFilter = useCallback(() => {
    setRenamingFilterId(null)
    setRenameDraft('')
  }, [])

  const saveFilterName = useCallback(() => {
    const name = renameDraft.trim()
    if (!name || !renamingFilterId) return

    setFilterState((prev) => ({
      ...prev,
      filters: prev.filters.map((filter) =>
        filter.id === renamingFilterId ? { ...filter, name } : filter
      ),
    }))
    setRenamingFilterId(null)
    setRenameDraft('')
  }, [renameDraft, renamingFilterId])

  const deleteCustomFilter = useCallback((filterId: string) => {
    setFilterState((prev) => {
      if (!canDeleteMailboxFilter(prev)) return prev

      const filters = prev.filters.filter((filter) => filter.id !== filterId)
      // A filter is always applied, so deleting the active one falls back to the first remaining filter.
      return {
        filters,
        activeFilterId: prev.activeFilterId === filterId ? filters[0].id : prev.activeFilterId,
      }
    })
    setExpandedFilterIds((prev) => prev.filter((id) => id !== filterId))
    setRenamingFilterId((prev) => (prev === filterId ? null : prev))
  }, [])

  const createCustomFilter = useCallback(() => {
    const name = newFilterName.trim()
    if (!name) return

    const created = buildCustomMailboxFilter(
      name,
      mailboxTags.map((tag) => tag.id)
    )
    setFilterState((prev) =>
      canCreateMailboxFilter(prev) ? { ...prev, filters: [...prev.filters, created] } : prev
    )
    setNewFilterName('')
    setIsAddingFilter(false)
    setExpandedFilterIds((prev) => [...prev, created.id])
  }, [mailboxTags, newFilterName])

  const selectedAccountIds = useMemo(
    () =>
      accounts
        .filter((account) => !excludedAccountIds.includes(account.id))
        .map((account) => account.id),
    [accounts, excludedAccountIds]
  )

  const selectedGroups = useMemo(
    () => uniqueGroups.filter((group) => !excludedGroups.includes(group)),
    [uniqueGroups, excludedGroups]
  )

  const selectedAccountSummary = useMemo(() => {
    if (selectedAccountIds.length === 0) return 'No accounts selected'
    if (selectedAccountIds.length === accounts.length) return 'All accounts included'
    return accounts
      .filter((account) => selectedAccountIds.includes(account.id))
      .map((account) => account.address)
      .join(', ')
  }, [accounts, selectedAccountIds])

  const selectedGroupSummary = useMemo(() => {
    if (selectedGroups.length === 0) return 'No groups selected'
    if (selectedGroups.length === uniqueGroups.length) return 'All groups included'
    return selectedGroups.join(', ')
  }, [selectedGroups, uniqueGroups])

  const hasConnectedAccounts = useMemo(
    () => accounts.some((account) => account.status !== 'disconnected'),
    [accounts]
  )
  const reconnectRequiredAccounts = useMemo(
    () => accounts.filter(
      (account): account is MailAccount & { provider: 'gmail' | 'outlook' } =>
        account.provider !== 'imap' && requiresMailboxReconnect(account)
    ),
    [accounts]
  )
  const [quickSyncGuidanceAccountIds, setQuickSyncGuidanceAccountIds] = useState<string[]>([])

  useEffect(() => {
    if (
      activeTab !== 'settings' ||
      activeSettingsTab !== 'accounts' ||
      !showAnalytics ||
      !hasConnectedAccounts ||
      analyticsData
    )
      return

    void loadAnalytics()
  }, [
    activeSettingsTab,
    activeTab,
    analyticsData,
    hasConnectedAccounts,
    loadAnalytics,
    showAnalytics,
  ])

  const syncingAccounts = useMemo(
    () => accounts.filter((account) => account.status === 'syncing'),
    [accounts]
  )

  const hasBackgroundSync =
    syncingAccountId !== null ||
    syncingAccounts.length > 0 ||
    Object.keys(syncProgressByAccountId).length > 0

  const inboxPanelStorageKey = useMemo(() => {
    const userKey = user?.id || 'guest'
    return `${MAILBOX_INBOX_WIDTH_STORAGE_KEY_PREFIX}${userKey}`
  }, [user?.id])

  const trustedHtmlStorageKey = useMemo(() => {
    const userKey = user?.id || 'guest'
    return `${MAILBOX_HTML_TRUST_STORAGE_KEY_PREFIX}${userKey}`
  }, [user?.id])

  const junkDomainStorageKey = useMemo(() => {
    const userKey = user?.id || 'guest'
    return `${MAILBOX_JUNK_DOMAIN_STORAGE_KEY_PREFIX}${userKey}`
  }, [user?.id])

  const nonOrganizerStorageKey = useMemo(() => {
    const userKey = user?.id || 'guest'
    return `${MAILBOX_NON_ORGANIZER_STORAGE_KEY_PREFIX}${userKey}`
  }, [user?.id])

  const invitationViewStorageKey = useMemo(() => {
    const userKey = user?.id || 'guest'
    return `${MAILBOX_INVITATION_VIEW_STORAGE_KEY_PREFIX}${userKey}`
  }, [user?.id])

  const panelVisibilityStorageKey = useMemo(() => {
    const userKey = user?.id || 'guest'
    return `${MAILBOX_PANEL_VISIBILITY_STORAGE_KEY_PREFIX}${userKey}`
  }, [user?.id])

  const suppressedConfirmsStorageKey = useMemo(() => {
    const userKey = user?.id || 'guest'
    return `${MAILBOX_SUPPRESSED_CONFIRMS_STORAGE_KEY_PREFIX}${userKey}`
  }, [user?.id])

  const aiAccessStorageKey = useMemo(() => {
    const userKey = user?.id || 'guest'
    return `${MAILBOX_AI_ACCESS_STORAGE_KEY_PREFIX}${userKey}`
  }, [user?.id])

  const settingsTabStorageKey = useMemo(() => {
    const userKey = user?.id || 'guest'
    return `${MAILBOX_SETTINGS_TAB_STORAGE_KEY_PREFIX}${userKey}`
  }, [user?.id])

  const filtersStorageKey = useMemo(() => {
    const userKey = user?.id || 'guest'
    return `${MAILBOX_FILTERS_STORAGE_KEY_PREFIX}${userKey}`
  }, [user?.id])

  const sortStorageKey = useMemo(() => {
    const userKey = user?.id || 'guest'
    return `${MAILBOX_FILTERS_STATE_KEY_PREFIX}${userKey}`
  }, [user?.id])

  const primaryFilterStorageKey = useMemo(() => {
    const userKey = user?.id || 'guest'
    return `${MAILBOX_PRIMARY_FILTER_KEY_PREFIX}${userKey}`
  }, [user?.id])

  const notificationRulesStorageKey = useMemo(() => {
    const userKey = user?.id || 'guest'
    return `${MAILBOX_NOTIFICATION_RULES_STORAGE_KEY_PREFIX}${userKey}`
  }, [user?.id])

  const deviceNewMailCheckStorageKey = useMemo(() => {
    const userKey = user?.id || 'guest'
    return `${MAILBOX_DEVICE_CHECK_STORAGE_KEY_PREFIX}${userKey}`
  }, [user?.id])

  const manualQuickSyncAttemptsStorageKey = useMemo(() => {
    const userKey = user?.id || 'guest'
    return `${MAILBOX_MANUAL_QUICK_SYNC_ATTEMPTS_KEY_PREFIX}${userKey}`
  }, [user?.id])

  const notificationSeenIdsUserKey = useMemo(() => user?.id || 'guest', [user?.id])
  const notificationFlagStorageKey = useMemo(
    () => buildMailboxNotificationFlagKey(notificationSeenIdsUserKey),
    [notificationSeenIdsUserKey]
  )

  const clampInboxPanelRatio = useCallback((ratio: number, containerWidthPx: number) => {
    if (!Number.isFinite(ratio)) return MAILBOX_INBOX_WIDTH_DEFAULT_RATIO
    const widthBasedMinRatio =
      containerWidthPx > 0
        ? MAILBOX_INBOX_MIN_WIDTH_PX / containerWidthPx
        : MAILBOX_INBOX_WIDTH_MIN_RATIO
    const minRatio = Math.max(MAILBOX_INBOX_WIDTH_MIN_RATIO, widthBasedMinRatio)
    const maxRatio = Math.max(minRatio, MAILBOX_INBOX_WIDTH_MAX_RATIO)
    return Math.min(Math.max(ratio, minRatio), maxRatio)
  }, [])

  const resizeInboxPanel = useCallback(
    (nextRatio: number) => {
      const containerWidth = mailboxSplitRef.current?.getBoundingClientRect().width || 0
      setInboxPanelRatio(clampInboxPanelRatio(nextRatio, containerWidth))
    },
    [clampInboxPanelRatio]
  )

  const handleInboxResizeMove = useCallback(
    (event: PointerEvent) => {
      const containerWidth = mailboxSplitRef.current?.getBoundingClientRect().width || 0
      if (containerWidth <= 0) return
      const rect = mailboxSplitRef.current?.getBoundingClientRect()
      if (!rect) return
      const ratio = (event.clientX - rect.left) / rect.width
      setInboxPanelRatio(clampInboxPanelRatio(ratio, rect.width))
    },
    [clampInboxPanelRatio]
  )

  const stopInboxResize = useCallback(() => {
    resizePointerIdRef.current = null
    window.removeEventListener('pointermove', handleInboxResizeMove)
    window.removeEventListener('pointerup', stopInboxResize)
  }, [handleInboxResizeMove])

  const handleInboxResizeStart = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (isMobileMailboxLayout) return
      resizePointerIdRef.current = event.pointerId
      event.currentTarget.setPointerCapture(event.pointerId)
      window.addEventListener('pointermove', handleInboxResizeMove)
      window.addEventListener('pointerup', stopInboxResize)
    },
    [handleInboxResizeMove, isMobileMailboxLayout, stopInboxResize]
  )

  const handleInboxResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        resizeInboxPanel(inboxPanelRatio - 0.02)
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        resizeInboxPanel(inboxPanelRatio + 0.02)
      }
    },
    [inboxPanelRatio, resizeInboxPanel]
  )

  useEffect(() => {
    const handleResize = () => {
      setIsMobileMailboxLayout(window.innerWidth < MAILBOX_MOBILE_BREAKPOINT_PX)
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Labels hide by actual header width (not viewport) since the inbox column is user-resizable.
  // Ignore the temporary zero-width layout reported while another mailbox tab is active.
  useEffect(() => {
    const node = inboxHeaderRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      if (width > 0) {
        setIsInboxHeaderCompact(width < 360)
        setShowNewEmailLabel(width >= MAILBOX_NEW_EMAIL_LABEL_MIN_HEADER_WIDTH_PX)
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (activeTab !== 'mailbox') return
    const node = inboxHeaderRef.current
    if (!node) return
    const frame = window.requestAnimationFrame(() => {
      const width = node.getBoundingClientRect().width
      if (width > 0) {
        setIsInboxHeaderCompact(width < 360)
        setShowNewEmailLabel(width >= MAILBOX_NEW_EMAIL_LABEL_MIN_HEADER_WIDTH_PX)
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeTab, inboxPanelRatio])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = window.localStorage.getItem(inboxPanelStorageKey)
    if (!stored) {
      setInboxPanelRatio(MAILBOX_INBOX_WIDTH_DEFAULT_RATIO)
      return
    }

    const parsed = Number(stored)
    if (!Number.isFinite(parsed)) {
      setInboxPanelRatio(MAILBOX_INBOX_WIDTH_DEFAULT_RATIO)
      return
    }

    const containerWidth =
      mailboxSplitRef.current?.getBoundingClientRect().width || window.innerWidth
    setInboxPanelRatio(clampInboxPanelRatio(parsed, containerWidth))
  }, [clampInboxPanelRatio, inboxPanelStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(inboxPanelStorageKey, String(inboxPanelRatio))
  }, [inboxPanelRatio, inboxPanelStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined') return

    try {
      const parsed: unknown = JSON.parse(
        window.localStorage.getItem(suppressedConfirmsStorageKey) || '[]'
      )
      setSuppressedConfirmKeys(Array.isArray(parsed) ? parsed.filter(isMailboxConfirmKey) : [])
    } catch {
      setSuppressedConfirmKeys([])
    }
  }, [suppressedConfirmsStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined') return

    aiAccessHydratedRef.current = false
    const stored = window.localStorage.getItem(aiAccessStorageKey)
    if (stored) {
      try {
        setAiAccess(normalizeMailboxAiAccess(JSON.parse(stored)))
      } catch {
        setAiAccess(DEFAULT_MAILBOX_AI_ACCESS)
      }
    } else {
      setAiAccess(DEFAULT_MAILBOX_AI_ACCESS)
    }
    aiAccessHydratedRef.current = true
  }, [aiAccessStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined' || !aiAccessHydratedRef.current) return
    window.localStorage.setItem(aiAccessStorageKey, JSON.stringify(aiAccess))
  }, [aiAccess, aiAccessStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined') return

    setHydratedPanelVisibilityKey(null)
    const stored = window.localStorage.getItem(panelVisibilityStorageKey)
    if (stored) {
      try {
        const parsed: unknown = JSON.parse(stored)
        if (typeof parsed === 'object' && parsed !== null) {
          const source = parsed as Record<string, unknown>

          if (typeof source.showConnectCard === 'boolean')
            setShowConnectCard(source.showConnectCard)
          if (typeof source.showConnectedCard === 'boolean')
            setShowConnectedCard(source.showConnectedCard)
          if (typeof source.showAnalytics === 'boolean') setShowAnalytics(source.showAnalytics)
          if (typeof source.showMailboxSettings === 'boolean')
            setShowMailboxSettings(source.showMailboxSettings)
          if (typeof source.showPeopleCard === 'boolean') setShowPeopleCard(source.showPeopleCard)
          if (typeof source.showPeopleHtmlTrustTool === 'boolean')
            setShowPeopleHtmlTrustTool(source.showPeopleHtmlTrustTool)
          if (typeof source.showPeopleJunkTool === 'boolean')
            setShowPeopleJunkTool(source.showPeopleJunkTool)
          if (typeof source.showPeopleNonOrganizerTool === 'boolean')
            setShowPeopleNonOrganizerTool(source.showPeopleNonOrganizerTool)
        }
      } catch {
        // Ignore malformed persisted UI state and keep defaults.
      }
    }

    setHydratedPanelVisibilityKey(panelVisibilityStorageKey)
  }, [panelVisibilityStorageKey])

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      hydratedPanelVisibilityKey !== panelVisibilityStorageKey
    )
      return

    window.localStorage.setItem(
      panelVisibilityStorageKey,
      JSON.stringify({
        showConnectCard,
        showConnectedCard,
        showAnalytics,
        showMailboxSettings,
        showPeopleCard,
        showPeopleHtmlTrustTool,
        showPeopleJunkTool,
        showPeopleNonOrganizerTool,
      })
    )
  }, [
    hydratedPanelVisibilityKey,
    panelVisibilityStorageKey,
    showConnectCard,
    showConnectedCard,
    showAnalytics,
    showMailboxSettings,
    showPeopleCard,
    showPeopleHtmlTrustTool,
    showPeopleJunkTool,
    showPeopleNonOrganizerTool,
  ])

  useEffect(() => {
    if (typeof window === 'undefined') return

    setHydratedFiltersKey(null)
    const stored = window.localStorage.getItem(filtersStorageKey)
    if (stored) {
      try {
        const parsed: unknown = JSON.parse(stored)
        if (typeof parsed === 'object' && parsed !== null) {
          const source = parsed as Record<string, unknown>

          setExcludedAccountIds(readPersistedStringList(source.excludedAccountIds))
          setExcludedGroups(readPersistedStringList(source.excludedGroups))
          if (typeof source.showAdditionalFilters === 'boolean')
            setShowAdditionalFilters(source.showAdditionalFilters)
          if (typeof source.showMassActions === 'boolean')
            setShowMassActions(source.showMassActions)
          if (typeof source.isGroupFilterListExpanded === 'boolean')
            setIsGroupFilterListExpanded(source.isGroupFilterListExpanded)
        }
      } catch {
        // Ignore malformed persisted filter state and keep defaults.
      }
    }

    setHydratedFiltersKey(filtersStorageKey)
  }, [filtersStorageKey])
  useEffect(() => {
    // Writing is blocked until the hydrated values for this key are committed, otherwise stale state overwrites them.
    if (typeof window === 'undefined' || hydratedFiltersKey !== filtersStorageKey) return

    // Date range filters are intentionally excluded so they always reset to blank.
    window.localStorage.setItem(
      filtersStorageKey,
      JSON.stringify({
        excludedAccountIds,
        excludedGroups,
        showAdditionalFilters,
        showMassActions,
        isGroupFilterListExpanded,
      })
    )
  }, [
    filtersStorageKey,
    hydratedFiltersKey,
    excludedAccountIds,
    excludedGroups,
    showAdditionalFilters,
    showMassActions,
    isGroupFilterListExpanded,
  ])

  const sortableUserTagIds = useMemo(() => mailboxTags.map((tag) => tag.id), [mailboxTags])

  useEffect(() => {
    // Wait for mailbox tags to load first; reconciling against an empty tag list here would strip stored custom tag rules.
    if (!mailboxTagsLoaded) return

    let cancelled = false
    setHydratedFilterRulesKey(null)
    const localState = readMailboxFilterState(sortStorageKey, sortableUserTagIds)
    const applyState = (sharedState: MailboxFilterState) => {
      if (cancelled) return
      mailboxPreferenceSnapshotsRef.current.set('/api/mailbox/preferences/filter-rules', JSON.stringify({ filters: sharedState.filters }))
      const primaryId = readMailboxPrimaryFilterId(
        primaryFilterStorageKey,
        sharedState.filters.map((filter) => filter.id)
      ) || (sharedState.filters.some((filter) => filter.id === localState.activeFilterId)
        ? localState.activeFilterId
        : sharedState.filters[0]?.id ?? null)
      setPrimaryFilterId(primaryId)
      setFilterState({ ...sharedState, activeFilterId: primaryId })
      setHydratedFilterRulesKey(sortStorageKey)
    }

    if (!user?.id) {
      applyState(localState)
      return () => { cancelled = true }
    }

    const loadSharedRules = async () => {
      try {
        const { data } = await dedupedGet<{ filters?: unknown[] }>('/api/mailbox/preferences/filter-rules')
        const remoteFilters = Array.isArray(data?.filters) ? data.filters : []
        if (remoteFilters.length === 0) {
          await apiClient.put('/api/mailbox/preferences/filter-rules', { filters: localState.filters })
          applyState(localState)
          return
        }
        applyState(parseMailboxFilterState(JSON.stringify({ filters: remoteFilters }), sortableUserTagIds))
      } catch {
        // Keep local rules available if the shared preference request is temporarily unavailable.
        applyState(localState)
      }
    }

    void loadSharedRules()
    return () => { cancelled = true }
  }, [mailboxTagsLoaded, primaryFilterStorageKey, sortStorageKey, sortableUserTagIds, user?.id])

  useEffect(() => {
    // Wait for mailbox tags to load first; reconciling against an empty tag list here would strip stored custom tag rules.
    if (!mailboxTagsLoaded) return

    let cancelled = false
    setHydratedNotificationRulesKey(null)
    const localState = readMailboxNotificationRulesState(notificationRulesStorageKey, sortableUserTagIds)
    const applyState = (state: MailboxNotificationRulesState) => {
      if (cancelled) return
      mailboxPreferenceSnapshotsRef.current.set('/api/mailbox/preferences/notification-rules', JSON.stringify({
        enabled: state.enabled, rules: { systemTags: state.systemTags, userTags: state.userTags },
      }))
      setNotificationRulesState(state)
      setHydratedNotificationRulesKey(notificationRulesStorageKey)
    }

    if (!user?.id) {
      applyState(localState)
      return () => { cancelled = true }
    }

    const loadSharedNotificationRules = async () => {
      try {
        const { data } = await dedupedGet<{ enabled?: boolean; rules?: Partial<MailboxNotificationRulesState> }>('/api/mailbox/preferences/notification-rules')
        applyState(parseMailboxNotificationRulesState(
          { enabled: data?.enabled === true, ...(data?.rules || {}) },
          sortableUserTagIds,
        ))
      } catch {
        // Keep local rules available if the shared preference request is temporarily unavailable.
        applyState(localState)
      }
    }

    void loadSharedNotificationRules()
    return () => { cancelled = true }
  }, [mailboxTagsLoaded, notificationRulesStorageKey, sortableUserTagIds, user?.id])

  useEffect(() => {
    // Writing is blocked until the hydrated values for this key are committed, otherwise stale state overwrites them.
    if (hydratedNotificationRulesKey !== notificationRulesStorageKey) return

    writeMailboxNotificationRulesState(notificationRulesStorageKey, notificationRulesState)

    if (!user?.id) return

    void saveMailboxPreference('/api/mailbox/preferences/notification-rules', {
      enabled: notificationRulesState.enabled,
      rules: { systemTags: notificationRulesState.systemTags, userTags: notificationRulesState.userTags },
    })
  }, [hydratedNotificationRulesKey, notificationRulesState, notificationRulesStorageKey, saveMailboxPreference, user?.id])

  useEffect(() => {
    let cancelled = false
    setThreadingOptionsLoaded(false)

    const loadThreadingOptions = async () => {
      if (!user?.id) {
        if (!cancelled) {
          setThreadingOptions(DEFAULT_MAILBOX_THREADING_OPTIONS)
          setThreadingOptionsLoaded(true)
        }
        return
      }

      try {
        const { data } = await dedupedGet<{
          options?: Partial<MailboxThreadingOptions> & {
            sameNameAndDomain?: boolean
            sameNameAndDomainDays?: number
            sameDomainWithoutReply?: boolean
            sameDomainWithoutReplyDays?: number
            sameDomainWithinSevenDays?: boolean
            sameDomainWithinDays?: number
          }
        }>('/api/mailbox/preferences/threading')
        const options = data?.options
        if (!cancelled) {
          const nextOptions: MailboxThreadingOptions = {
            sameNameAndEmail: (options?.sameNameAndEmail ?? options?.sameNameAndDomain) === true,
            sameNameAndEmailDays: Number.isFinite(Number(options?.sameNameAndEmailDays ?? options?.sameNameAndDomainDays))
              ? Math.min(60, Math.max(1, Math.floor(Number(options?.sameNameAndEmailDays ?? options?.sameNameAndDomainDays))))
              : 7,
            sameNameWithoutReply: options?.sameNameWithoutReply === true,
            sameNameWithoutReplyDays: Number.isFinite(Number(options?.sameNameWithoutReplyDays))
              ? Math.min(60, Math.max(1, Math.floor(Number(options?.sameNameWithoutReplyDays))))
              : 7,
            sameNameWithinSevenDays: options?.sameNameWithinSevenDays === true,
            sameNameWithinDays: Number.isFinite(Number(options?.sameNameWithinDays))
              ? Math.min(60, Math.max(1, Math.floor(Number(options?.sameNameWithinDays))))
              : 7,
            sameEmailWithoutReply: (options?.sameEmailWithoutReply ?? options?.sameDomainWithoutReply) === true,
            sameEmailWithoutReplyDays: Number.isFinite(Number(options?.sameEmailWithoutReplyDays ?? options?.sameDomainWithoutReplyDays))
              ? Math.min(60, Math.max(1, Math.floor(Number(options?.sameEmailWithoutReplyDays ?? options?.sameDomainWithoutReplyDays))))
              : 7,
            sameEmailWithinSevenDays: (options?.sameEmailWithinSevenDays ?? options?.sameDomainWithinSevenDays) === true,
            sameEmailWithinDays: Number.isFinite(Number(options?.sameEmailWithinDays ?? options?.sameDomainWithinDays))
              ? Math.min(60, Math.max(1, Math.floor(Number(options?.sameEmailWithinDays ?? options?.sameDomainWithinDays))))
              : 7,
          }
          mailboxPreferenceSnapshotsRef.current.set('/api/mailbox/preferences/threading', JSON.stringify({ options: nextOptions }))
          setThreadingOptions(nextOptions)
          setThreadingOptionsLoaded(true)
        }
      } catch {
        if (!cancelled) setThreadingOptionsLoaded(true)
      }
    }

    void loadThreadingOptions()
    return () => { cancelled = true }
  }, [user?.id])

  useEffect(() => {
    if (!threadingOptionsLoaded || !user?.id) return
    void saveMailboxPreference('/api/mailbox/preferences/threading', { options: threadingOptions })
  }, [saveMailboxPreference, threadingOptions, threadingOptionsLoaded, user?.id])

  useEffect(() => {
    // Writing is blocked until the hydrated values for this key are committed, otherwise stale state overwrites them.
    if (hydratedFilterRulesKey !== sortStorageKey) return
    writeMailboxPrimaryFilterId(primaryFilterStorageKey, primaryFilterId)

    // Always kept on the device, even for signed-in users whose rules live server-side: it is what
    // lets the next page load filter the inbox on the first paint instead of flashing every email.
    writeMailboxFilterState(sortStorageKey, {
      filters: filterState.filters,
      activeFilterId: filterState.activeFilterId,
    })

    if (!user?.id) return

    void saveMailboxPreference('/api/mailbox/preferences/filter-rules', { filters: filterState.filters })
  }, [filterState.activeFilterId, filterState.filters, hydratedFilterRulesKey, primaryFilterId, primaryFilterStorageKey, saveMailboxPreference, sortStorageKey, user?.id])

  useEffect(() => {
    if (primaryFilterId && filterState.filters.some((filter) => filter.id === primaryFilterId)) return
    setPrimaryFilterId(filterState.filters[0]?.id ?? null)
  }, [filterState.filters, primaryFilterId])

  useEffect(() => {
    let cancelled = false

    const loadTrustedDomains = async () => {
      const readLocalDomains = (): string[] => {
        if (typeof window === 'undefined') return []
        const stored = window.localStorage.getItem(trustedHtmlStorageKey)
        if (!stored) return []

        try {
          const parsed = JSON.parse(stored)
          if (!Array.isArray(parsed)) return []
          return parsed
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.trim().toLowerCase())
            .filter((value) => value.length > 0)
        } catch {
          return []
        }
      }

      try {
        const { data } = await dedupedGet<{ trusted_domains?: unknown[] }>('/api/mailbox/preferences/html-trust')
        const dbDomains: string[] = Array.isArray(data?.trusted_domains)
          ? data.trusted_domains
              .filter((value: unknown): value is string => typeof value === 'string')
              .map((value: string) => value.trim().toLowerCase())
              .filter((value: string) => value.length > 0)
          : []

        if (!cancelled) {
          // If DB returned empty, recover from localStorage (handles prior POST failures).
          // Omitting the persisted ref causes the save effect to re-persist to DB.
          if (dbDomains.length === 0) {
            const local = readLocalDomains()
            if (local.length > 0) {
              const sortedLocal = Array.from(new Set(local)).sort((a, b) => a.localeCompare(b))
              setTrustedHtmlDomains(new Set(sortedLocal))
              // Do not set trustedDomainsPersistedKeyRef so the save effect fires and re-saves to DB
              return
            }
          }
          const sortedUnique = Array.from(new Set(dbDomains)).sort((a, b) => a.localeCompare(b))
          setTrustedHtmlDomains(new Set(sortedUnique))
          trustedDomainsPersistedKeyRef.current = JSON.stringify(sortedUnique)
        }
      } catch {
        if (!cancelled) {
          const fallback = Array.from(new Set(readLocalDomains())).sort((a, b) =>
            a.localeCompare(b)
          )
          setTrustedHtmlDomains(new Set(fallback))
          trustedDomainsPersistedKeyRef.current = JSON.stringify(fallback)
        }
      } finally {
        if (!cancelled) {
          setTrustedDomainsLoaded(true)
        }
      }
    }

    void loadTrustedDomains()

    return () => {
      cancelled = true
    }
  }, [trustedHtmlStorageKey])

  useEffect(() => {
    let cancelled = false

    const loadJunkDomains = async () => {
      const readLocalDomains = (): string[] => {
        if (typeof window === 'undefined') return []
        const stored = window.localStorage.getItem(junkDomainStorageKey)
        if (!stored) return []

        try {
          const parsed = JSON.parse(stored)
          if (!Array.isArray(parsed)) return []
          return parsed
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.trim().toLowerCase())
            .filter((value) => value.length > 0)
        } catch {
          return []
        }
      }

      try {
        const { data } = await dedupedGet<{ junk_domains?: unknown[] }>('/api/mailbox/preferences/junk-domains')
        const dbDomains: string[] = Array.isArray(data?.junk_domains)
          ? data.junk_domains
              .filter((value: unknown): value is string => typeof value === 'string')
              .map((value: string) => value.trim().toLowerCase())
              .filter((value: string) => value.length > 0)
          : []

        if (!cancelled) {
          if (dbDomains.length === 0) {
            const local = readLocalDomains()
            if (local.length > 0) {
              const sortedLocal = Array.from(new Set(local)).sort((a, b) => a.localeCompare(b))
              setJunkDomains(new Set(sortedLocal))
              return
            }
          }

          const sortedUnique = Array.from(new Set(dbDomains)).sort((a, b) => a.localeCompare(b))
          setJunkDomains(new Set(sortedUnique))
          junkDomainsPersistedKeyRef.current = JSON.stringify(sortedUnique)
        }
      } catch {
        if (!cancelled) {
          const fallback = Array.from(new Set(readLocalDomains())).sort((a, b) =>
            a.localeCompare(b)
          )
          setJunkDomains(new Set(fallback))
          junkDomainsPersistedKeyRef.current = JSON.stringify(fallback)
        }
      } finally {
        if (!cancelled) {
          setJunkDomainsLoaded(true)
        }
      }
    }

    void loadJunkDomains()

    return () => {
      cancelled = true
    }
  }, [junkDomainStorageKey])

  useEffect(() => {
    if (!trustedDomainsLoaded) return
    const sortedDomains = Array.from(trustedHtmlDomains).sort((a, b) => a.localeCompare(b))
    const serialized = JSON.stringify(sortedDomains)

    if (trustedDomainsPersistedKeyRef.current === serialized) return

    trustedDomainsPersistedKeyRef.current = serialized

    if (typeof window === 'undefined') return
    window.localStorage.setItem(trustedHtmlStorageKey, serialized)

    void apiClient
      .post('/api/mailbox/preferences/html-trust', {
        trusted_domains: sortedDomains,
      })
      .catch((err: unknown) => {
        console.warn('[MailboxPage] Failed to persist trusted HTML domains to DB:', err)
      })
  }, [trustedDomainsLoaded, trustedHtmlDomains, trustedHtmlStorageKey])

  useEffect(() => {
    if (!junkDomainsLoaded) return
    const sortedDomains = Array.from(junkDomains).sort((a, b) => a.localeCompare(b))
    const serialized = JSON.stringify(sortedDomains)

    if (junkDomainsPersistedKeyRef.current === serialized) return

    junkDomainsPersistedKeyRef.current = serialized

    if (typeof window === 'undefined') return
    window.localStorage.setItem(junkDomainStorageKey, serialized)

    void apiClient
      .post('/api/mailbox/preferences/junk-domains', {
        junk_domains: sortedDomains,
      })
      .catch((err: unknown) => {
        console.warn('[MailboxPage] Failed to persist junk domains to DB:', err)
      })
  }, [junkDomains, junkDomainsLoaded, junkDomainStorageKey])

  useEffect(() => {
    let cancelled = false

    const readLocalSenders = (): string[] => {
      if (typeof window === 'undefined') return []
      const stored = window.localStorage.getItem(nonOrganizerStorageKey)
      if (!stored) return []
      try {
        const parsed = JSON.parse(stored)
        return readPersistedStringList(parsed)
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean)
      } catch {
        return []
      }
    }

    const loadNonOrganizers = async () => {
      try {
        const { data } = await dedupedGet<{ non_organizer_senders?: unknown }>('/api/mailbox/preferences/non-organizers')
        const dbSenders = readPersistedStringList(data?.non_organizer_senders)
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean)

        if (cancelled) return

        if (dbSenders.length === 0) {
          const local = readLocalSenders()
          if (local.length > 0) {
            setNonOrganizerSenders(
              new Set(Array.from(new Set(local)).sort((a, b) => a.localeCompare(b)))
            )
            return
          }
        }

        const sortedUnique = Array.from(new Set(dbSenders)).sort((a, b) => a.localeCompare(b))
        setNonOrganizerSenders(new Set(sortedUnique))
        nonOrganizerPersistedKeyRef.current = JSON.stringify(sortedUnique)
      } catch {
        if (cancelled) return
        const fallback = Array.from(new Set(readLocalSenders())).sort((a, b) => a.localeCompare(b))
        setNonOrganizerSenders(new Set(fallback))
        nonOrganizerPersistedKeyRef.current = JSON.stringify(fallback)
      } finally {
        if (!cancelled) setNonOrganizerSendersLoaded(true)
      }
    }

    void loadNonOrganizers()

    return () => {
      cancelled = true
    }
  }, [nonOrganizerStorageKey])

  useEffect(() => {
    if (!nonOrganizerSendersLoaded) return
    const sortedSenders = Array.from(nonOrganizerSenders).sort((a, b) => a.localeCompare(b))
    const serialized = JSON.stringify(sortedSenders)

    if (nonOrganizerPersistedKeyRef.current === serialized) return

    nonOrganizerPersistedKeyRef.current = serialized

    if (typeof window === 'undefined') return
    window.localStorage.setItem(nonOrganizerStorageKey, serialized)

    void apiClient
      .post('/api/mailbox/preferences/non-organizers', {
        non_organizer_senders: sortedSenders,
      })
      .catch((err: unknown) => {
        console.warn('[MailboxPage] Failed to persist non-organizer senders to DB:', err)
      })
  }, [nonOrganizerSenders, nonOrganizerSendersLoaded, nonOrganizerStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = window.localStorage.getItem(invitationViewStorageKey)
    if (!stored) return
    try {
      const parsed = JSON.parse(stored)
      if (typeof parsed !== 'object' || parsed === null) return
      setInvitationSortOrder(
        parseInvitationSortOrder((parsed as Record<string, unknown>).sortOrder)
      )
    } catch {
      // Ignore malformed cached view state.
    }
  }, [invitationViewStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(
      invitationViewStorageKey,
      JSON.stringify({ sortOrder: invitationSortOrder })
    )
  }, [invitationSortOrder, invitationViewStorageKey])

  useEffect(() => {
    if (isMobileMailboxLayout && selectedThreadIdentity) {
      setMobileMailboxScreen('thread')
      return
    }
    if (isMobileMailboxLayout && !selectedThreadIdentity) {
      setMobileMailboxScreen('list')
    }
  }, [isMobileMailboxLayout, selectedThreadIdentity])

  useEffect(() => {
    return () => {
      window.removeEventListener('pointermove', handleInboxResizeMove)
      window.removeEventListener('pointerup', stopInboxResize)
    }
  }, [handleInboxResizeMove, stopInboxResize])

  useEffect(() => {
    if (!hasBackgroundSync) return

    const timer = setInterval(() => setSyncTicker((value) => value + 1), 500)
    return () => clearInterval(timer)
  }, [hasBackgroundSync])

  useEffect(() => {
    if (!accounts.length) return

    const timer = setInterval(() => setLastSyncTicker((value) => value + 1), 60_000)
    return () => clearInterval(timer)
  }, [accounts.length])

  useEffect(() => {
    if (!accounts.length) return

    setSyncProgressByAccountId((prev) => {
      const next = { ...prev }
      let changed = false

      for (const account of accounts) {
        const tracker = next[account.id]

        if (account.status === 'syncing') {
          if (!tracker) {
            next[account.id] = {
              startedAtMs: Date.now(),
              expectedSeconds: estimateSyncDurationSeconds(getImportConfig(account.id)),
              source: 'background',
              phase: 'importing',
              completedAtMs: null,
            }
            changed = true
          } else if (tracker.phase === 'preparing') {
            next[account.id] = { ...tracker, phase: 'importing' }
            changed = true
          }
          continue
        }

        if (account.status === 'error' && tracker) {
          delete next[account.id]
          delete syncPctFloorRef.current[account.id]
          changed = true
          continue
        }

        if (tracker?.source === 'background' && tracker.phase !== 'complete') {
          next[account.id] = { ...tracker, phase: 'complete', completedAtMs: Date.now() }
          changed = true
        }
      }

      return changed ? next : prev
    })
  }, [accounts, getImportConfig, importConfigs])

  // Completed trackers linger briefly at 100% so the bar settles instead of vanishing mid-animation.
  useEffect(() => {
    const completedIds = Object.entries(syncProgressByAccountId)
      .filter(([, tracker]) => tracker.phase === 'complete')
      .map(([accountId]) => accountId)
    if (!completedIds.length) return

    const timer = setTimeout(() => {
      setSyncProgressByAccountId((prev) => {
        const next = { ...prev }
        let changed = false
        for (const accountId of completedIds) {
          if (next[accountId]?.phase === 'complete') {
            delete next[accountId]
            delete syncPctFloorRef.current[accountId]
            changed = true
          }
        }
        return changed ? next : prev
      })
    }, SYNC_COMPLETE_HOLD_MS)

    return () => clearTimeout(timer)
  }, [syncProgressByAccountId])

  const syncUiByAccountId = useMemo(() => {
    void syncTicker
    const now = Date.now()
    const result: Record<string, SyncProgressView> = {}

    for (const [accountId, tracker] of Object.entries(syncProgressByAccountId)) {
      const { rawPct, elapsedSeconds, etaSeconds } = computeSyncProgress(tracker, now)
      const floorPct = syncPctFloorRef.current[accountId] ?? 0
      const progressPct = Math.max(floorPct, rawPct)
      syncPctFloorRef.current[accountId] = progressPct

      result[accountId] = {
        elapsedSeconds,
        progressPct,
        etaSeconds,
        phase: tracker.phase,
        label: syncPhaseLabel(tracker.phase),
        detail:
          tracker.phase === 'complete'
            ? `Finished in ${formatSeconds(elapsedSeconds)}.`
            : tracker.phase === 'finalizing'
              ? 'Writing messages, threads and invitations into your mailbox.'
              : `Fetching from your provider. Estimated remaining time: ${formatSeconds(etaSeconds)}.`,
      }
    }

    return result
  }, [syncProgressByAccountId, syncTicker])

  const syncCoverageByAccountId = (() => {
    const nowMs = Date.now()
    const coverage: Record<string, { lastImportText: string; gapText: string | null }> = {}

    for (const account of accounts) {
      if (!account.last_synced_at) {
        coverage[account.id] = {
          lastImportText: 'Last imported: never',
          gapText: `Auto-sync coverage gap. This mailbox has no sync baseline yet, so changes older than the last ${AUTOSYNC_COHORT_DAYS} days may be missing until you run Import history.`,
        }
        continue
      }

      const lastSyncMs = new Date(account.last_synced_at).getTime()
      if (Number.isNaN(lastSyncMs)) {
        coverage[account.id] = {
          lastImportText: `Last imported: ${formatTimestamp(account.last_synced_at, userDateFormat)}`,
          gapText: null,
        }
        continue
      }

      const ageMs = Math.max(0, nowMs - lastSyncMs)
      const ageLabel = formatRelativeAgeFromMs(ageMs)
      const outOfCohort = ageMs > AUTOSYNC_COHORT_MS

      coverage[account.id] = {
        lastImportText: `Last imported: ${ageLabel} (${formatTimestamp(account.last_synced_at, userDateFormat)})`,
        gapText: outOfCohort
          ? `Auto-sync coverage gap: last sync was ${ageLabel}. Changes to messages older than the last ${AUTOSYNC_COHORT_DAYS} days may be missing until you run Import history.`
          : null,
      }
    }

    return coverage
  })()

  const activeSyncAccountId =
    syncingAccountId || syncingAccounts[0]?.id || Object.keys(syncProgressByAccountId)[0] || null

  const pendingTrustMessage = useMemo(
    () => threadMessages.find((message) => message.id === pendingTrustMessageId) ?? null,
    [pendingTrustMessageId, threadMessages]
  )

  const selectedTagMessage = useMemo(
    () =>
      threadMessages.find((message) => message.id === selectedTagMessageId) ??
      messages.find((message) => message.id === selectedTagMessageId) ??
      null,
    [selectedTagMessageId, threadMessages, messages]
  )

  const mailboxTagById = useMemo(() => {
    return new Map(mailboxTags.map((tag) => [tag.id, tag]))
  }, [mailboxTags])

  const resolveUserTagLabel = useCallback(
    (tagId: string): string => {
      return mailboxTagById.get(tagId)?.label || 'Unknown tag'
    },
    [mailboxTagById]
  )

  const effectiveTagModes = useMemo(
    () => resolveEffectiveTagModes(filterState, sortableUserTagIds),
    [filterState, sortableUserTagIds]
  )
  const activeSortState = useMemo(
    () => resolveActiveSortState(filterState, sortableUserTagIds),
    [filterState, sortableUserTagIds]
  )
  // The inbox must never paint with the fallback "Show All" rules. A device that already stored the
  // rules is ready on the first render; a brand new device keeps the skeleton until they arrive.
  const areFiltersReady =
    initialFilterHydration.current!.hadStoredState || hydratedFilterRulesKey === sortStorageKey
  const shouldUsePrioritySortWindow = useMemo(() => {
    const firstActiveBlock = activeSortState.order.find(
      (blockId) => blockId !== 'date' || activeSortState.dateEnabled
    )
    return firstActiveBlock !== undefined && firstActiveBlock !== 'date'
  }, [activeSortState])

  const pendingTrustDomain = useMemo(
    () => extractDomainFromEmail(pendingTrustMessage?.from_email || null),
    [pendingTrustMessage]
  )

  const selectedThreadLatestMessage = useMemo(
    () => threadMessages[threadMessages.length - 1] ?? null,
    [threadMessages]
  )

  const threadReaderMessages = useMemo(() => {
    const isGmailThread = accounts.some(account =>
      account.id === selectedThread?.account_id && account.provider === 'gmail'
    )
    return threadMessages.map(message => {
      const rawBody = message.body_text || message.preview || 'No message content available'
      const displayBody = isGmailThread
        ? recoverGmailPlainTextAlternative(rawBody, message.body_html_sanitized)
        : rawBody
      return { message, splitBody: splitQuotedBody(collapseConsecutiveBlankLines(displayBody)) }
    })
  }, [accounts, selectedThread?.account_id, threadMessages])

  // Custom threading can group emails with different sender and Reply-To addresses.
  const selectedThreadMessage = useMemo(
    () =>
      threadMessages.find((message) => message.id === focusedThreadMessageId) ??
      selectedThreadLatestMessage,
    [focusedThreadMessageId, selectedThreadLatestMessage, threadMessages]
  )

  const threadInvitations = useMemo(() => threadMessages.flatMap((message) => {
    const persistedInvitations = invitations.filter((invite) => invite.message_id === message.id)
    if (persistedInvitations.length > 0) return persistedInvitations
    const inferredInvitation = buildInvitationFromThreadMessage(message)
    return inferredInvitation ? [inferredInvitation] : []
  }), [invitations, threadMessages])

  const threadInvitationsByMessageId = useMemo(() => {
    const byMessageId = new Map<string, MailInvitation[]>()
    for (const invitation of threadInvitations) {
      if (!invitation.message_id) continue
      const messageInvitations = byMessageId.get(invitation.message_id) ?? []
      messageInvitations.push(invitation)
      byMessageId.set(invitation.message_id, messageInvitations)
    }
    return byMessageId
  }, [threadInvitations])

  const singleThreadInvitationAddActionState = useMemo(
    () => threadInvitations.length === 1
      ? getInvitationAddActionState(threadInvitations[0], invitations)
      : null,
    [invitations, threadInvitations]
  )

  const selectedInvitationAddActionState = useMemo(() => {
    return getInvitationAddActionState(selectedInvitation, invitations)
  }, [invitations, selectedInvitation])

  const selectedInvitationAlreadyAdded = selectedInvitationAddActionState.alreadyAdded

  const isDomainTrusted = useCallback(
    (domain: string | null) => {
      if (!domain) return false
      return trustedHtmlDomains.has(domain)
    },
    [trustedHtmlDomains]
  )

  const resolveMessageDomain = useCallback((message: { from_email: string | null }) => {
    return extractDomainFromEmail(message.from_email)
  }, [])

  const selectedMessageDomainTrusted =
    selectedThreadMessage != null && isDomainTrusted(resolveMessageDomain(selectedThreadMessage))

  const resolveMessageSenderIdentity = useCallback((message: { from_email: string | null }) => {
    return normalizeSenderIdentity(message.from_email)
  }, [])

  const isMessageJunk = useCallback(
    (message: { from_email: string | null; is_provider_junk?: boolean }) =>
      isMailboxMessageJunk(message, junkDomains),
    [junkDomains]
  )

  const selectedThreadJunkTarget = useMemo(
    () =>
      selectedThreadLatestMessage
        ? resolveMessageSenderIdentity(selectedThreadLatestMessage) ||
          resolveMessageDomain(selectedThreadLatestMessage)
        : null,
    [resolveMessageDomain, resolveMessageSenderIdentity, selectedThreadLatestMessage]
  )

  const selectedThreadIsJunk = useMemo(
    () => (selectedThreadLatestMessage ? isMessageJunk(selectedThreadLatestMessage) : false),
    [isMessageJunk, selectedThreadLatestMessage]
  )

  const selectedThreadIsProviderJunk = selectedThreadLatestMessage?.is_provider_junk === true
  const threadHasPendingSentCopy = threadMessages.some((message) => message.id.startsWith('sent-draft:'))
  // Notifications are only meaningful once Mailbox is pinned to the quick menu (that is the only
  // place the badge renders), so enabling is gated on it and stays in sync with Layout's pin state.
  const [isMailboxPinnedToQuickMenu, setIsMailboxPinnedToQuickMenu] = useState(readIsMailboxPinnedToQuickMenu)

  useEffect(() => {
    const handleQuickToolsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ toolKeys?: unknown }>).detail
      setIsMailboxPinnedToQuickMenu(
        Array.isArray(detail?.toolKeys) ? detail.toolKeys.includes('mailbox') : readIsMailboxPinnedToQuickMenu()
      )
    }
    window.addEventListener(NAV_QUICK_TOOLS_CHANGED_EVENT, handleQuickToolsChanged)
    return () => window.removeEventListener(NAV_QUICK_TOOLS_CHANGED_EVENT, handleQuickToolsChanged)
  }, [])

  useEffect(() => {
    if (!isMailboxPinnedToQuickMenu && notificationRulesState.enabled) {
      setNotificationRulesState((prev) => ({ ...prev, enabled: false }))
    }
  }, [isMailboxPinnedToQuickMenu, notificationRulesState.enabled])

  useEffect(() => {
    // The badge is a single on/off dot (not one notification per message), so there is no "spam"
    // risk in flagging it the moment rules are enabled against an existing inbox -- only messages
    // that are not already recorded as eligible (new arrivals, or a state change such as being
    // marked unread again) flip it on. Conversely, once nothing currently loaded still qualifies
    // (e.g. the one unread notify-worthy message was just opened and marked read), the badge clears
    // -- merely visiting the inbox is not enough, since the badge should reflect real outstanding mail.
    if (hydratedNotificationRulesKey !== notificationRulesStorageKey) return
    if (!notificationRulesState.enabled) {
      writeMailboxNotificationFlag(notificationFlagStorageKey, false)
      return
    }
    if (messages.length === 0) return

    const previousEligibility = readMailboxNotificationEligibility(notificationSeenIdsUserKey)
    const modes = resolveEffectiveNotifyModes(notificationRulesState)
    let hasNewNotifiable = false
    const nextEligibility = new Map(previousEligibility)

    for (const message of messages) {
      const eligible = shouldNotifyForMessage(message, modes, isMessageJunk)
      const wasEligible = previousEligibility.get(message.id) === true
      if (eligible && !wasEligible) hasNewNotifiable = true
      nextEligibility.set(message.id, eligible)
    }

    writeMailboxNotificationEligibility(notificationSeenIdsUserKey, nextEligibility)

    if (hasNewNotifiable) {
      writeMailboxNotificationFlag(notificationFlagStorageKey, true)
    } else if (!messages.some((message) => nextEligibility.get(message.id) === true)) {
      writeMailboxNotificationFlag(notificationFlagStorageKey, false)
    }
  }, [hydratedNotificationRulesKey, messages, notificationRulesState, notificationRulesStorageKey, notificationSeenIdsUserKey, notificationFlagStorageKey, isMessageJunk])

  const canRenderMessageHtml = useCallback(
    (message: ThreadMessage) => {
      if (!message.body_html_sanitized) return false
      const senderDomain = resolveMessageDomain(message)
      return isDomainTrusted(senderDomain)
    },
    [isDomainTrusted, resolveMessageDomain]
  )

  const requestHtmlViewerMode = useCallback(() => {
    const blockedMessage = threadMessages.find((message) => {
      if (!message.body_html_sanitized) return false
      const senderDomain = resolveMessageDomain(message)
      return !!senderDomain && !isDomainTrusted(senderDomain)
    })

    if (blockedMessage) {
      setPendingTrustMessageId(blockedMessage.id)
      return
    }

    setMailViewerMode('html')
  }, [isDomainTrusted, resolveMessageDomain, threadMessages])

  useEffect(() => {
    const dismissFormatPicker = (event: PointerEvent) => {
      const picker = mobileFormatPickerRef.current
      if (picker?.open && event.target instanceof Node && !picker.contains(event.target)) {
        picker.open = false
      }
    }
    document.addEventListener('pointerdown', dismissFormatPicker)
    return () => document.removeEventListener('pointerdown', dismissFormatPicker)
  }, [])

  const selectMobileViewerMode = (mode: MailViewerMode) => {
    const picker = mobileFormatPickerRef.current
    if (picker) {
      picker.open = false
      picker.querySelector('summary')?.focus()
    }
    if (mode === 'html') requestHtmlViewerMode()
    else setMailViewerMode(mode)
  }

  const trustDomainFromPendingMessage = useCallback(() => {
    if (!pendingTrustDomain) return
    setTrustedHtmlDomains((prev) => new Set(prev).add(pendingTrustDomain))
    setMailViewerMode('html')
    setPendingTrustMessageId(null)
  }, [pendingTrustDomain])

  useEffect(() => {
    if (!threadMessages.length) {
      viewerFormatThreadIdRef.current = null
      return
    }
    if (viewerFormatThreadIdRef.current === selectedThread?.id) return
    viewerFormatThreadIdRef.current = selectedThread?.id ?? null
    const hasTrustedHtml = threadMessages.some((message) => canRenderMessageHtml(message))
    setMailViewerMode(hasTrustedHtml ? 'html' : 'raw-text')
  }, [threadMessages, canRenderMessageHtml, selectedThread?.id])

  useEffect(() => {
    if (!threadMessages.length) {
      // Keep the explicitly picked Inbox-row message selected while its picker is open outside a thread.
      if (isTagPickerOpen && tagPickerScope === 'message') return
      setSelectedTagMessageId(null)
      return
    }

    if (!selectedTagMessageId) {
      setSelectedTagMessageId(threadMessages[threadMessages.length - 1].id)
      return
    }

    const stillExists = threadMessages.some((message) => message.id === selectedTagMessageId)
    if (!stillExists) {
      setSelectedTagMessageId(threadMessages[threadMessages.length - 1].id)
    }
  }, [threadMessages, selectedTagMessageId, isTagPickerOpen, tagPickerScope])

  const selectThreadMessage = useCallback(
    (
      messageId: string | null,
      options: { availableMessages?: ThreadMessage[]; includePreviousHeader?: boolean } = {}
    ) => {
      const availableMessages = options.availableMessages ?? threadMessages
      const selectedMessage =
        availableMessages.find((message) => message.id === messageId) ??
        availableMessages[availableMessages.length - 1]
      const selectedId = selectedMessage?.id ?? null
      setFocusedThreadMessageId(selectedId)
      setCollapsedThreadMessageIds((previous) => {
        if (!selectedId || !previous.has(selectedId)) return previous
        const next = new Set(previous)
        next.delete(selectedId)
        return next
      })
      setThreadScrollRequest(selectedId
        ? { messageId: selectedId, includePreviousHeader: options.includePreviousHeader }
        : null)
    },
    [threadMessages]
  )

  useEffect(() => {
    if (!threadScrollRequest || selectedThreadLoading) return
    if (isMobileMailboxLayout && mobileMailboxScreen !== 'thread') return
    const selectedIndex = threadMessages.findIndex(
      (message) => message.id === threadScrollRequest.messageId
    )
    if (selectedIndex < 0) return
    const anchorMessage = threadMessages[
      threadScrollRequest.includePreviousHeader ? Math.max(0, selectedIndex - 1) : selectedIndex
    ]
    const header = threadMessageHeaderRefs.current.get(anchorMessage.id)
    const reader = threadReaderRef.current
    if (!header || !reader) return
    reader.scrollTop += header.getBoundingClientRect().top - reader.getBoundingClientRect().top
    setThreadScrollRequest(null)
  }, [threadScrollRequest, selectedThreadLoading, threadMessages, isMobileMailboxLayout, mobileMailboxScreen])

  useEffect(() => {
    if (filteredMessages.length === 0 && selectedThread) {
      setThreadMessages([])
      setSelectedThread(null)
      selectedThreadIdRef.current = null
      if (!isMobileMailboxLayout) setActiveDraft(null)
    }
  }, [filteredMessages.length, selectedThread, isMobileMailboxLayout])

  const setTabInUrl = useCallback(
    (tab: MainTab, settingsTab?: SettingsTab) => {
      const next = new URLSearchParams(searchParams)
      next.set('tab', tab)
      if (tab === 'settings') {
        const nextSettingsTab = settingsTab || readPersistedSettingsTab(settingsTabStorageKey)
        next.set('settings', nextSettingsTab)
        try {
          window.localStorage.setItem(settingsTabStorageKey, nextSettingsTab)
        } catch {
          // Keep URL navigation working when browser storage is unavailable.
        }
      } else {
        next.delete('settings')
      }
      setSearchParams(next)
    },
    [searchParams, setSearchParams, settingsTabStorageKey]
  )

  const returnToMobileMailboxList = () => {
    // Ignore pending reader loads without discarding the selected thread or unsaved draft.
    openThreadRequestSeqRef.current += 1
    selectedThreadIdRef.current = selectedThread?.id || null
    setSelectedThreadLoading(false)
    setThreadScrollRequest(null)
    setOpeningMailboxMessageId(null)
    setMobileMailboxScreen('list')
  }

  const selectMailboxSection = (tab: MainTab) => {
    if (isMobileMailboxLayout) returnToMobileMailboxList()
    setTabInUrl(tab)
  }

  useEffect(() => {
    if (activeTab !== 'settings' || searchParams.get('settings') !== activeSettingsTab) return

    try {
      window.localStorage.setItem(settingsTabStorageKey, activeSettingsTab)
    } catch {
      // Keep explicit URL navigation working when browser storage is unavailable.
    }
  }, [activeSettingsTab, activeTab, searchParams, settingsTabStorageKey])

  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    let changed = false

    if (!searchParams.get('tab')) {
      next.set('tab', 'mailbox')
      changed = true
    }

    if (parseMainTab(next.get('tab')) === 'settings' && !next.get('settings')) {
      next.set('settings', readPersistedSettingsTab(settingsTabStorageKey))
      changed = true
    }

    if (changed) {
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams, settingsTabStorageKey])

  const loadAccounts = useCallback(async () => {
    const { data } = await dedupedGet<{ accounts: MailAccount[] }>('/api/mailbox/accounts')
    const nextAccounts = Array.isArray(data.accounts) ? (data.accounts as MailAccount[]) : []
    setAccounts(nextAccounts)
    setImportConfigs((prev) => {
      const next = { ...prev }
      for (const account of nextAccounts) {
        if (!next[account.id]) {
          next[account.id] = normalizeAccountImportConfig(account.sync_options)
        }
      }
      return next
    })
  }, [])

  const loadMailboxTags = useCallback(async () => {
    const { data } = await dedupedGet<{ tags: unknown[] }>('/api/mailbox/preferences/tags')
    const rawTags: unknown[] = Array.isArray(data?.tags) ? data.tags : []
    const tags = rawTags
      .filter((tag: unknown): tag is MailboxTagItem => {
        if (!tag || typeof tag !== 'object') return false
        const candidate = tag as Record<string, unknown>
        return (
          typeof candidate.id === 'string' &&
          typeof candidate.label === 'string' &&
          typeof candidate.color === 'string'
        )
      })
      .map((tag) => ({
        id: tag.id,
        label: tag.label,
        color: tag.color,
        sort_order: Number.isFinite(tag.sort_order) ? Number(tag.sort_order) : 0,
      }))
    setMailboxTags(tags)
    setMailboxTagsLoaded(true)
  }, [])

  const loadDrafts = useCallback(async () => {
    const { data } = await dedupedGet<{ drafts: MailDraftRecord[] }>('/api/mailbox/drafts')
    setDrafts(Array.isArray(data?.drafts) ? (data.drafts as MailDraftRecord[]) : [])
  }, [])

  const loadMessages = useCallback(async (limit = MESSAGE_LOAD_DEFAULT) => {
    const readSeq = pendingTrashRef.current.beginRead()
    const { data } = await dedupedGet<{ messages: unknown; total: number }>('/api/mailbox/messages', {
      // Archived messages are filtered client-side (like trash/junk), so they must still be fetched.
      params: {
        page: 1,
        limit,
        includeArchived: true,
      },
    })
    const page = pendingTrashRef.current.apply(normalizeMessageList(data?.messages), readSeq)
    pendingTrashRef.current.completeRead(readSeq)
    const total = data.total || 0
    // Merge into the existing set instead of replacing it wholesale: this endpoint always
    // returns just the newest `limit` messages, so once the loaded window grows past `limit`
    // (via Load More / prefetch), a plain replace would silently drop any already-known
    // message that new mail has since pushed past that boundary -- it would flicker out of
    // the inbox on the next periodic refresh and only come back after another Load More.
    // Downstream rendering re-sorts via sortMailboxMessages, so merge order doesn't matter.
    const byId = new Map(messagesRef.current.map((message) => [message.id, message]))
    for (const message of page) byId.set(message.id, message)
    const merged = Array.from(byId.values())
    setMessages(merged)
    messagesRef.current = merged
    setMessagesTotal(total)
    return { messages: merged, total }
  }, [])

  // Appends only the next slice instead of re-downloading everything from offset 0.
  // The incremental scan used to refetch 1..N on every step, which grew quadratically and
  // periodically timed the API out (500) on large mailboxes.
  const loadMoreMessages = useCallback(async (offset: number, count: number) => {
    const readSeq = pendingTrashRef.current.beginRead()
    const { data } = await apiClient.get('/api/mailbox/messages', {
      params: {
        offset,
        limit: count,
        includeArchived: true,
      },
    })
    const page = pendingTrashRef.current.apply(normalizeMessageList(data?.messages), readSeq)
    pendingTrashRef.current.completeRead(readSeq)
    const total = data.total || 0
    // Update-in-place for already-known ids (not just append-new): otherwise a message whose
    // provider/tag flags changed after it was first loaded (e.g. trashed/tagged by automation
    // or a later sync) keeps showing its stale badge state in the inbox list forever, even
    // though a fresh fetch (like opening its Thread Viewer) shows the correct state.
    const previousSnapshot = messagesRef.current
    const byId = new Map(previousSnapshot.map((message) => [message.id, message]))
    const changedMessages = Array.from(new Map(page.map(message => [message.id, message])).values())
    const replacedMessages = changedMessages.flatMap(message => {
      const previous = byId.get(message.id)
      return previous ? [previous] : []
    })
    for (const message of changedMessages) byId.set(message.id, message)
    const merged = Array.from(byId.values())
    messagesRef.current = merged
    setMessages(merged)
    setMessagesTotal(total)
    return { messages: merged, total, previousSnapshot, changedMessages, replacedMessages }
  }, [])

  // Thread fetches (`/api/mailbox/threads/:id`) always return authoritative per-message
  // flags/tags. Reflect them back into the cached inbox list so a row that fell outside the
  // periodic top-N `loadMessages` window (e.g. an older message that just got trashed/tagged)
  // shows the correct badge as soon as its thread is opened, instead of only self-correcting
  // once it happens to re-enter that window.
  const syncInboxListFromThreadMessages = useCallback((threadMsgs: ThreadMessage[]) => {
    if (threadMsgs.length === 0) return
    const freshById = new Map(threadMsgs.map((message) => [message.id, message]))
    // Functional update: messagesRef lags behind queued optimistic writes (e.g. a trash flag set a
    // moment ago), and merging over that stale snapshot would resurrect the just-trashed row.
    setMessages((prev) => {
      let matched = false
      const merged = prev.map((message) => {
        const fresh = freshById.get(message.id)
        if (!fresh) return message
        matched = true
        return {
          ...message,
          is_read: fresh.is_read,
          is_archived: fresh.is_archived,
          user_tag_ids: fresh.user_tag_ids,
          is_provider_trashed: fresh.is_provider_trashed,
          is_provider_junk: fresh.is_provider_junk,
          is_provider_sent: fresh.is_provider_sent,
        }
      })
      if (!matched) return prev
      messagesRef.current = merged
      return merged
    })
  }, [])

  const computeVisibleCount = useCallback(
    (msgs: MailMessage[]) => {
      const fromDateMs = parseDateInputStart(dateFromFilter)
      const toDateMs = parseDateInputEnd(dateToFilter)
      const query = committedQuery

      return msgs.filter((msg) => {
        if (excludedAccountIds.includes(msg.account_id)) return false
        if (excludedGroups.length > 0) {
          const group = msg.account?.identity_group
          if (group && excludedGroups.includes(group)) return false
        }
        const receivedAtMs = parseTimestamp(msg.received_at)
        if ((fromDateMs !== null || toDateMs !== null) && receivedAtMs === null) return false
        if (fromDateMs !== null && receivedAtMs !== null && receivedAtMs < fromDateMs) return false
        if (toDateMs !== null && receivedAtMs !== null && receivedAtMs > toDateMs) return false
        if (!isMessageVisible(msg, effectiveTagModes, isMessageJunk)) return false
        if (isSessionTrashedHidden(msg, effectiveTagModes, sessionTrashedIdsRef.current)) return false
        if (!query) return true
        const haystack = [
          msg.subject,
          msg.from_name,
          msg.from_email,
          msg.to_emails,
          msg.preview,
          msg.account?.address,
          msg.account?.display_name,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return haystack.includes(query)
      }).length
    },
    [
      dateFromFilter,
      dateToFilter,
      committedQuery,
      excludedAccountIds,
      excludedGroups,
      effectiveTagModes,
      isMessageJunk,
    ]
  )
  const computeVisibleCountRef = useRef(computeVisibleCount)
  computeVisibleCountRef.current = computeVisibleCount

  // Keeps fetching bigger batches until at least `targetVisibleCount` messages pass the active filters, or everything is loaded.
  // Scans in small chunks (capped at MESSAGE_SCAN_STEP_MAX) so the "Checking X of Y" progress updates frequently, regardless of the user's Load step size.
  // `silent` skips the visible progress UI -- used for the low-priority background prefetch of the next page.
  // If a loop is already in flight (e.g. a silent prefetch), a new request hands it a higher target and flips it
  // visible instead of starting a second competing loop, so progress continues from wherever it currently stands.
  const loadUntilVisibleTarget = useCallback(
    async (
      startingLimit: number,
      total: number,
      currentVisibleCount: number,
      targetVisibleCount: number,
      options?: { silent?: boolean }
    ) => {
      if (startingLimit >= total || currentVisibleCount >= targetVisibleCount) return
      if (isLoadingMoreRef.current) {
        if (targetVisibleCount > activeTargetRef.current)
          activeTargetRef.current = targetVisibleCount
        if (!options?.silent) {
          activeSilentRef.current = false
          setIsLoadingMoreMessages(true)
        }
        return
      }
      isLoadingMoreRef.current = true
      const silent = options?.silent ?? false
      activeTargetRef.current = targetVisibleCount
      activeSilentRef.current = silent
      const requestedStep = Math.max(1, Math.floor(inboxLoadStep) || 1)
      const scanStep = Math.max(1, Math.min(requestedStep, MESSAGE_SCAN_STEP_MAX))
      if (!silent) setIsLoadingMoreMessages(true)
      const epoch = scanEpochRef.current
      let countedSnapshot = messagesRef.current
      let count = computeVisibleCountRef.current
      try {
        let currentLimit = Math.max(startingLimit, messagesRef.current.length)
        let visibleCount = currentVisibleCount
        while (mailboxMountedRef.current && visibleCount < activeTargetRef.current && currentLimit < total && epoch === scanEpochRef.current) {
          const nextLimit = Math.min(total, currentLimit + scanStep)
          if (!activeSilentRef.current) setLoadMoreProgress({ checked: nextLimit, total })
          const offset = messagesRef.current.length
              const result = await loadMoreMessages(offset, Math.min(scanStep, Math.max(1, total - offset)))
          if (epoch !== scanEpochRef.current) break
          if (result.messages.length <= offset) break
          currentLimit = Math.max(nextLimit, result.messages.length)
          const latestCount = computeVisibleCountRef.current
          visibleCount = getMailboxScanVisibleCount({
            previousCount: visibleCount,
            previousSnapshot: result.previousSnapshot,
            countedSnapshot,
            messages: result.messages,
            changedMessages: result.changedMessages,
            replacedMessages: result.replacedMessages,
            count: latestCount,
            filtersChanged: latestCount !== count,
          })
          count = latestCount
          countedSnapshot = result.messages
          if (activeSilentRef.current) break
        }
      } finally {
        isLoadingMoreRef.current = false
        if (!activeSilentRef.current) {
          setIsLoadingMoreMessages(false)
          setLoadMoreProgress(null)
        }
        activeSilentRef.current = false
      }
    },
    [inboxLoadStep, loadMoreMessages]
  )

  // Speculatively fetch at most one batch. Sparse filters must not scan the
  // entire mailbox in the background just to warm the next page.
  const prefetchNextPage = useCallback(() => {
    if (!mailboxMountedRef.current || isLoadingMoreRef.current) return
    const total = messagesTotalRef.current
    const currentLimit = messagesRef.current.length
    if (currentLimit >= total) return
    const requestedStep = Math.max(1, Math.floor(inboxLoadStep) || 1)
    const nextTarget = visibleTargetRef.current + requestedStep
    const visibleCount = computeVisibleCount(messagesRef.current)
    if (visibleCount >= nextTarget) return
    void loadUntilVisibleTarget(currentLimit, total, visibleCount, nextTarget, { silent: true })
      .catch((err) => console.warn('[MailboxPage] Inbox prefetch failed:', apiErrorMessage(err)))
  }, [computeVisibleCount, inboxLoadStep, loadUntilVisibleTarget])

  const loadPeople = useCallback(async (searchText?: string) => {
    const q = (searchText ?? '').trim()
    const params = q ? { q } : undefined
    const { data } = await dedupedGet<{ people: MailPerson[] }>('/api/mailbox/people', { params })
    setPeople(data.people || [])
  }, [])

  // Debounced so typing doesn't fire a request per keystroke.
  useEffect(() => {
    if (activeTab !== 'people') return
    const handle = setTimeout(() => {
      void loadPeople(peopleSearchQuery).catch((err) => setError(apiErrorMessage(err)))
    }, 300)
    return () => clearTimeout(handle)
  }, [activeTab, peopleSearchQuery, loadPeople])

  const startEditingContact = useCallback((person: MailPerson) => {
    setEditingContactId(person.id)
    setNewIdentityEmail('')
    setContactEditDraft({
      display_name: person.display_name || '',
      region: person.region || '',
      timezone: person.timezone || '',
      labels: (person.labels || []).join(', '),
    })
  }, [])

  const handleSaveContactEdit = useCallback(
    async (contactId: string) => {
      setContactSaving(true)
      try {
        const labels = contactEditDraft.labels
          .split(',')
          .map((label) => label.trim())
          .filter(Boolean)
        const { data } = await apiClient.patch(`/api/mailbox/people/${contactId}`, {
          display_name: contactEditDraft.display_name.trim() || null,
          region: contactEditDraft.region.trim() || null,
          timezone: contactEditDraft.timezone.trim() || null,
          labels,
        })
        setPeople((prev) =>
          prev.map((person) => (person.id === contactId ? { ...person, ...data.contact } : person))
        )
        setEditingContactId(null)
      } catch (err) {
        console.error('Failed to save contact:', err)
      } finally {
        setContactSaving(false)
      }
    },
    [contactEditDraft]
  )

  const handleAddIdentity = useCallback(
    async (contactId: string) => {
      const email = newIdentityEmail.trim()
      if (!email) return
      setIdentitySaving(true)
      try {
        const { data } = await apiClient.post(`/api/mailbox/people/${contactId}/identities`, {
          email,
        })
        setPeople((prev) =>
          prev.map((person) =>
            person.id === contactId
              ? { ...person, identities: [...person.identities, data.identity] }
              : person
          )
        )
        setNewIdentityEmail('')
      } catch (err) {
        console.error('Failed to add email to contact:', err)
      } finally {
        setIdentitySaving(false)
      }
    },
    [newIdentityEmail]
  )

  const handleRemoveIdentity = useCallback(async (contactId: string, identityId: string) => {
    try {
      await apiClient.delete(`/api/mailbox/people/${contactId}/identities/${identityId}`)
      setPeople((prev) =>
        prev.map((person) =>
          person.id === contactId
            ? { ...person, identities: person.identities.filter((i) => i.id !== identityId) }
            : person
        )
      )
    } catch (err) {
      console.error('Failed to remove contact email:', err)
    }
  }, [])

  const handleAddContact = useCallback(async () => {
    const email = newContactDraft.email.trim()
    if (!email) return
    setAddContactSaving(true)
    setAddContactError('')
    try {
      const { data } = await apiClient.post('/api/mailbox/people', {
        display_name: newContactDraft.display_name.trim() || undefined,
        email,
      })
      setPeople((prev) => [data.contact, ...prev])
      setNewContactDraft({ display_name: '', email: '' })
      setShowAddContactForm(false)
    } catch (err) {
      setAddContactError(
        (err as { response?: { data?: { error?: string } } }).response?.data?.error ||
          'Failed to add contact'
      )
    } finally {
      setAddContactSaving(false)
    }
  }, [newContactDraft])

  const handleDeleteContact = useCallback(async (contactId: string) => {
    try {
      await apiClient.delete(`/api/mailbox/people/${contactId}`)
      setPeople((prev) => prev.filter((person) => person.id !== contactId))
      setEditingContactId((current) => (current === contactId ? null : current))
    } catch (err) {
      console.error('Failed to delete contact:', err)
    }
  }, [])

  const loadInvitations = useCallback(async () => {
    const { data } = await dedupedGet<{ invitations: MailInvitation[] }>('/api/mailbox/invitations', {
      params: { sort: 'latest', limit: 500 },
    })
    setInvitations(data.invitations || [])
  }, [])

  const visibleInvitations = useMemo(() => {
    const search = invitationQuery.trim().toLowerCase()
    const filtered = invitations.filter((invite) => {
      if (matchesSenderEntry(invite.organizer, nonOrganizerSenders)) return false
      if (!search) return true
      return [invite.summary, invite.organizer, invite.location, invite.status].some((field) =>
        (field || '').toLowerCase().includes(search)
      )
    })

    const collapsed = collapseDuplicateInvitations(filtered).map(({ invite, mergedCount }) =>
      mergedCount > 1 ? { ...invite, merged_count: mergedCount } : invite
    )

    const direction = invitationSortOrder === 'latest-first' ? -1 : 1
    return collapsed.sort((a, b) => {
      const aTime = a.starts_at ? new Date(a.starts_at).getTime() : Number.NaN
      const bTime = b.starts_at ? new Date(b.starts_at).getTime() : Number.NaN
      if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0
      if (Number.isNaN(aTime)) return 1
      if (Number.isNaN(bTime)) return -1
      return (aTime - bTime) * direction
    })
  }, [invitationQuery, invitationSortOrder, invitations, nonOrganizerSenders])

  const markOrganizerAsNonOrganizer = useCallback(async (invite: MailInvitation) => {
    const entry = normalizeSenderEntry(invite.organizer)
    if (!entry) return

    setNonOrganizerSenders((prev) => new Set(prev).add(entry))
    setInvitations((current) =>
      current.filter((item) => !matchesSenderEntry(item.organizer, new Set([entry])))
    )

    try {
      await apiClient.post('/api/mailbox/invitations/dismiss-organizer', { organizer: entry })
    } catch (err) {
      console.warn('[MailboxPage] Failed to dismiss organizer:', err)
    }
  }, [])

  const toggleTimeManagerCategory = useCallback((catId: string) => {
    setSelectedTimeManagerCategoryIds((prev) => {
      const next = new Set(prev)
      if (next.has(catId)) next.delete(catId)
      else next.add(catId)
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(
            'mailbox:time-manager-categories:v1',
            JSON.stringify(Array.from(next))
          )
        } catch {
          /* ignore */
        }
      }
      return next
    })
  }, [])

  const loadCalendarTargets = useCallback(async () => {
    if (calendarTargetsLoaded || calendarTargetsLoading) return
    setCalendarTargetsLoading(true)
    try {
      const [sourcesResponse, calendarsResponse, modesResponse, categoriesResponse] =
        await Promise.all([
          apiClient.get('/api/calendar-sources'),
          apiClient.get('/api/calendars', { params: { include_own: 1 } }),
          apiClient.get('/api/time-management/modes'),
          apiClient.get('/api/time-management/categories', { params: { all_modes: 1 } }),
        ])

      const rawCalendars = Array.isArray(calendarsResponse.data)
        ? calendarsResponse.data
        : Array.isArray(calendarsResponse.data?.calendars)
          ? calendarsResponse.data.calendars
          : []
      const normalizedCalendars: CoordinationCalendarTarget[] = rawCalendars
        .filter((calendar: unknown): calendar is CoordinationCalendarTarget => {
          if (!calendar || typeof calendar !== 'object') return false
          const candidate = calendar as Record<string, unknown>
          return (
            typeof candidate.id === 'string' &&
            typeof candidate.hash === 'string' &&
            typeof candidate.title === 'string'
          )
        })
        .sort((a: CoordinationCalendarTarget, b: CoordinationCalendarTarget) => {
          const aTime = a.updated_at
            ? new Date(a.updated_at).getTime()
            : a.created_at
              ? new Date(a.created_at).getTime()
              : 0
          const bTime = b.updated_at
            ? new Date(b.updated_at).getTime()
            : b.created_at
              ? new Date(b.created_at).getTime()
              : 0
          return bTime - aTime
        })

      const rawModes = Array.isArray(modesResponse.data?.modes) ? modesResponse.data.modes : []
      const normalizedModes: TimeManagerModeTarget[] = rawModes.filter(
        (mode: unknown): mode is TimeManagerModeTarget => {
          if (!mode || typeof mode !== 'object') return false
          const candidate = mode as Record<string, unknown>
          return typeof candidate.id === 'string' && typeof candidate.name === 'string'
        }
      )

      const rawCategories = Array.isArray(categoriesResponse.data?.categories)
        ? categoriesResponse.data.categories
        : []
      const normalizedCategories: TimeManagerCategoryTarget[] = rawCategories.filter(
        (cat: unknown): cat is TimeManagerCategoryTarget => {
          if (!cat || typeof cat !== 'object') return false
          const candidate = cat as Record<string, unknown>
          return typeof candidate.id === 'string' && typeof candidate.label === 'string'
        }
      )

      setCalendarSources(
        (sourcesResponse.data.sources || []).filter(
          (source: CalendarSourceTarget) => source.is_active
        )
      )
      setCoordinationCalendars(normalizedCalendars)
      setTimeManagerModes(normalizedModes)
      setTimeManagerCategories(normalizedCategories)
      setCalendarTargetsLoaded(true)
    } finally {
      setCalendarTargetsLoading(false)
    }
  }, [calendarTargetsLoaded, calendarTargetsLoading])

  const googleCalendarTargets = useMemo(
    () =>
      calendarSources.filter((source) => source.source_type === 'google_oauth' && source.is_active),
    [calendarSources]
  )

  const hasManyCoordinationCalendars = coordinationCalendars.length > 6
  const visibleCoordinationCalendars =
    hasManyCoordinationCalendars && !showAllCoordinationCalendars
      ? coordinationCalendars.slice(0, 6)
      : coordinationCalendars

  const openInvitationCalendarPicker = useCallback(
    (invite: MailInvitation) => {
      setInvitationCalendarPanelHidden(false)
      if (invitationCalendarPanelHidden && selectedInvitation?.id === invite.id) return
      setSelectedInvitation(invite)
      setSelectedGoogleTargetIds(new Set())
      setSelectedTimeManagerModeIds(new Set())
      setSelectedCoordinationHashes(new Set())
      setCreateNewCoordinationCalendar(false)
      setNewCoordinationCalendarTitle(invite.summary?.trim() || 'New coordination calendar')
      setShowAllCoordinationCalendars(false)
      setCalendarActionError(null)
      const primaryTz = getEditingTimezone()
      const startParts = isoToLocalDateTimeParts(invite.starts_at, primaryTz)

      const rawLoc = invite.location?.trim() || ''
      const isUrlLoc = /^https?:\/\//i.test(rawLoc)

      setInvitationEditTitle(invite.summary?.trim() || 'Calendar invitation')
      setInvitationEditDate(startParts.date)
      setInvitationEditTime(startParts.time)
      setInvitationEditAddress(rawLoc)
      setInvitationEditDescription(
        [
          invite.organizer ? `Organizer: ${invite.organizer}` : null,
          invite.status ? `Status: ${invite.status}` : null,
          rawLoc ? (isUrlLoc ? `Meeting link: ${rawLoc}` : `Location: ${rawLoc}`) : null,
        ]
          .filter((part): part is string => Boolean(part))
          .join('\n\n')
      )
      setInvitationDetailsExpanded(false)
      void loadCalendarTargets()
    },
    [invitationCalendarPanelHidden, loadCalendarTargets, selectedInvitation?.id]
  )

  const openThreadInvitationCalendarPicker = useCallback(() => {
    if (threadInvitations.length === 1) {
      const invitation = threadInvitations[0]
      if (invitation.message_id) selectThreadMessage(invitation.message_id)
      openInvitationCalendarPicker(invitation)
    } else if (threadInvitations.length > 1) {
      setThreadInvitationChoices(threadInvitations)
    }
  }, [openInvitationCalendarPicker, selectThreadMessage, threadInvitations])

  const chooseThreadInvitation = useCallback((invitationId: string) => {
    const invitation = threadInvitationChoices?.find((candidate) => candidate.id === invitationId)
    if (!invitation) {
      setThreadInvitationChoices(null)
      setError('That invitation is no longer available. Reopen the thread and try again.')
      return
    }

    if (invitation.message_id) selectThreadMessage(invitation.message_id)
    setThreadInvitationChoices(null)
    openInvitationCalendarPicker(invitation)
  }, [openInvitationCalendarPicker, selectThreadMessage, threadInvitationChoices])

  const threadInvitationChoiceOptions = useMemo(
    () => (threadInvitationChoices ?? []).map((invitation) => {
      const sourceMessage = threadMessages.find((message) => message.id === invitation.message_id)
      const sourceDetails = sourceMessage
        ? `${formatSenderLine(sourceMessage.from_name, sourceMessage.from_email)} -- ${formatTimestamp(sourceMessage.received_at, userDateFormat)}`
        : 'Source email unavailable'
      const eventDetails = [
        formatTimestamp(invitation.starts_at, userDateFormat),
        invitation.location?.trim() || null,
      ].filter((detail): detail is string => Boolean(detail)).join(' -- ')
      return {
        value: invitation.id,
        label: invitation.summary?.trim() || sourceMessage?.subject?.trim() || 'Calendar invitation',
        description: `${sourceDetails}${sourceMessage?.subject ? ` -- ${sourceMessage.subject}` : ''}${eventDetails ? ` -- ${eventDetails}` : ''}`,
      }
    }),
    [threadInvitationChoices, threadMessages, userDateFormat]
  )

  const closeInvitationCalendarPicker = useCallback(() => {
    setSelectedInvitation(null)
    setSelectedGoogleTargetIds(new Set())
    setSelectedTimeManagerModeIds(new Set())
    setSelectedCoordinationHashes(new Set())
    setCreateNewCoordinationCalendar(false)
    setNewCoordinationCalendarTitle('')
    setShowAllCoordinationCalendars(false)
    setCalendarActionError(null)
    setCalendarActionSaving(false)
    setInvitationDetailsExpanded(false)
    setInvitationEditTitle('')
    setInvitationEditDate('')
    setInvitationEditTime('')
    setInvitationEditAddress('')
    setInvitationEditDescription('')
    setCategoryTagModalMode(null)
  }, [])

  // Wall-clock date/time edits are entered in the user's primary timezone and converted back to UTC ISO on save.
  const invitationEffectiveStartIso = useMemo(() => {
    if (!invitationEditDate || !invitationEditTime) return selectedInvitation?.starts_at || null
    return (
      localDateTimeToIso(invitationEditDate, invitationEditTime, getEditingTimezone()) ||
      selectedInvitation?.starts_at ||
      null
    )
  }, [invitationEditDate, invitationEditTime, selectedInvitation?.starts_at])

  const invitationEffectiveEndIso = useMemo(() => {
    if (
      !selectedInvitation?.starts_at ||
      !selectedInvitation?.ends_at ||
      !invitationEffectiveStartIso
    ) {
      return selectedInvitation?.ends_at || null
    }
    const originalStartMs = new Date(selectedInvitation.starts_at).getTime()
    const originalEndMs = new Date(selectedInvitation.ends_at).getTime()
    const newStartMs = new Date(invitationEffectiveStartIso).getTime()
    if (
      !Number.isFinite(originalStartMs) ||
      !Number.isFinite(originalEndMs) ||
      !Number.isFinite(newStartMs)
    ) {
      return selectedInvitation.ends_at
    }
    const durationMs = Math.max(0, originalEndMs - originalStartMs)
    return new Date(newStartMs + durationMs).toISOString()
  }, [invitationEffectiveStartIso, selectedInvitation?.starts_at, selectedInvitation?.ends_at])

  const handleDownloadInvitationIcs = useCallback(() => {
    if (!invitationEffectiveStartIso || !invitationEffectiveEndIso) {
      setCalendarActionError('This invitation is missing a start or end time.')
      return
    }

    const title = invitationEditTitle.trim() || 'Calendar invitation'
    const description = invitationEditDescription.trim() || undefined
    const rawAddress = invitationEditAddress.trim() || selectedInvitation?.location?.trim() || ''
    const isUrl = /^https?:\/\//i.test(rawAddress)
    const location = isUrl ? undefined : rawAddress || undefined
    const meetingLink = isUrl ? rawAddress : undefined

    downloadICSFile({
      title,
      description,
      start_time: invitationEffectiveStartIso,
      end_time: invitationEffectiveEndIso,
      meeting_link: meetingLink,
      location,
    })
  }, [
    invitationEffectiveStartIso,
    invitationEffectiveEndIso,
    invitationEditTitle,
    invitationEditDescription,
    invitationEditAddress,
    selectedInvitation,
  ])

  const handleAddInvitationToCalendarTargets = useCallback(async () => {
    if (!selectedInvitation || !invitationEffectiveStartIso || !invitationEffectiveEndIso) {
      setCalendarActionError('This invitation is missing a start or end time.')
      return
    }

    const start = new Date(invitationEffectiveStartIso)
    const end = new Date(invitationEffectiveEndIso)
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
      setCalendarActionError('This invitation has invalid dates.')
      return
    }

    const durationMinutes = Math.max(15, Math.round((end.getTime() - start.getTime()) / 60000))
    const title = invitationEditTitle.trim() || 'Calendar invitation'
    const description = invitationEditDescription.trim() || undefined
    const rawAddress = invitationEditAddress.trim() || selectedInvitation.location?.trim() || ''
    const isUrl = /^https?:\/\//i.test(rawAddress)
    const location = isUrl ? undefined : rawAddress || undefined
    const meetingLink = isUrl ? rawAddress : undefined
    const timeSlots = [start.toISOString()]
    const shouldCreateCalendar = createNewCoordinationCalendar

    if (
      selectedGoogleTargetIds.size === 0 &&
      selectedTimeManagerModeIds.size === 0 &&
      selectedCoordinationHashes.size === 0 &&
      !shouldCreateCalendar
    ) {
      setCalendarActionError(
        'Select at least one destination calendar (Google, Time Manager mode, or Coordination) or create a new coordination calendar.'
      )
      return
    }

    setCalendarActionSaving(true)
    setCalendarActionError(null)
    try {
      const noticeId = crypto.randomUUID()
      const tasks: Array<{ target: CalendarDeliveryTarget; run: () => Promise<void> }> = []
      const googleEvent = {
        title,
        description,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        meeting_link: meetingLink || undefined,
        location: location || undefined,
      }

      for (const sourceId of selectedGoogleTargetIds) {
        const source = googleCalendarTargets.find((entry) => entry.id === sourceId)
        const target: CalendarDeliveryTarget = {
          id: `google:${sourceId}`,
          label: `Google Calendar (${source?.display_name || sourceId})`,
          status: 'pending',
          attempts: 0,
        }
        const idempotencyKey = crypto.randomUUID()
        tasks.push({
          target,
          run: async () => {
            const response = await apiClient.post('/api/calendar-sources/add-event', {
              event: googleEvent,
              targetSourceIds: [sourceId],
              idempotencyKey,
            })
            const result = Array.isArray(response.data?.results)
              ? response.data.results.find(
                  (entry: unknown) =>
                    entry &&
                    typeof entry === 'object' &&
                    (entry as Record<string, unknown>).sourceId === sourceId
                )
              : null
            if (!result || typeof result !== 'object') {
              throw new Error('Google Calendar did not confirm whether the event was added.')
            }
            const resultRecord = result as Record<string, unknown>
            if (resultRecord.success !== true) {
              throw new CalendarDeliveryError(
                typeof resultRecord.error === 'string'
                  ? resultRecord.error
                  : 'Google Calendar did not confirm the event was added.',
                resultRecord.retryable === true
              )
            }
          },
        })
      }

      for (const modeId of selectedTimeManagerModeIds) {
        const mode = timeManagerModes.find((entry) => entry.id === modeId)
        const categoryIdsForMode = timeManagerCategories
          .filter((category) => category.mode_id === modeId && selectedTimeManagerCategoryIds.has(category.id))
          .map((category) => category.id)
        const idempotencyKey = crypto.randomUUID()
        tasks.push({
          target: {
            id: `time-manager:${modeId}`,
            label: `Time Manager (${mode?.name || modeId})`,
            status: 'pending',
            attempts: 0,
          },
          run: async () => {
            await apiClient.post('/api/user-events', {
              id: idempotencyKey,
              title,
              description,
              meeting_link: meetingLink || null,
              location: location || null,
              start_time: start.toISOString(),
              end_time: end.toISOString(),
              is_public: false,
              source_id: modeId,
              category_ids: categoryIdsForMode,
              recurrence_rule: null,
            })
          },
        })
      }

      const coordinationTargets = coordinationCalendars.filter((calendar) =>
        selectedCoordinationHashes.has(calendar.hash)
      )
      for (const calendar of coordinationTargets) {
        const meetingId = crypto.randomUUID()
        tasks.push({
          target: {
            id: `coordination:${calendar.hash}`,
            label: `Coordination Calendar (${calendar.title})`,
            status: 'pending',
            attempts: 0,
          },
          run: async () => {
            await apiClient.post('/api/meetings', {
              id: meetingId,
              calendar_hash: calendar.hash,
              title,
              description,
              start_time: start.toISOString(),
              end_time: end.toISOString(),
              duration_minutes: durationMinutes,
              meeting_link: meetingLink || null,
              time_slots: timeSlots,
              recurrence_rule: null,
            })
          },
        })
      }

      if (shouldCreateCalendar) {
        const calendarTitle = (newCoordinationCalendarTitle || title).trim()
        const calendarId = crypto.randomUUID()
        const meetingId = crypto.randomUUID()
        const startDate = start.toISOString().slice(0, 10)
        const endDate = end.toISOString().slice(0, 10)
        tasks.push({
          target: {
            id: `new-coordination:${calendarId}`,
            label: `New Coordination Calendar (${calendarTitle})`,
            status: 'pending',
            attempts: 0,
          },
          run: async () => {
            const createResponse = await apiClient.post('/api/calendars', {
              id: calendarId,
              title: calendarTitle,
              visibility: 'unlisted',
              creator_account_type: 'google',
              permissions: { canEdit: [] as string[] },
              config: {
                eventName: calendarTitle,
                customStartDate: startDate,
                customEndDate: endDate,
                timeInterval: 30,
                startHour: 0,
                endHour: 24,
                hideDateNumbers: false,
              },
            })
            const created = createResponse.data
            if (!created || typeof created !== 'object') {
              throw new Error('Coordination Calendar creation was not confirmed.')
            }
            const candidate = created as Record<string, unknown>
            const createdHash = typeof candidate.hash === 'string' ? candidate.hash : ''
            if (!createdHash) throw new Error('Coordination Calendar creation was not confirmed.')
            const createdId = typeof candidate.id === 'string' ? candidate.id : calendarId
            const createdTitle =
              typeof candidate.title === 'string' ? candidate.title : calendarTitle
            const createdVisibility =
              typeof candidate.visibility === 'string' ? candidate.visibility : 'unlisted'
            const createdBy = typeof candidate.created_by === 'string' ? candidate.created_by : null
            setCoordinationCalendars((current) =>
              current.some((entry) => entry.hash === createdHash)
                ? current
                : [
                    {
                      id: createdId,
                      hash: createdHash,
                      title: createdTitle,
                      visibility: createdVisibility,
                      created_by: createdBy,
                    },
                    ...current,
                  ]
            )
            await apiClient.post('/api/meetings', {
              id: meetingId,
              calendar_hash: createdHash,
              title,
              description,
              start_time: start.toISOString(),
              end_time: end.toISOString(),
              duration_minutes: durationMinutes,
              meeting_link: meetingLink || null,
              time_slots: timeSlots,
              recurrence_rule: null,
            })
          },
        })
      }

      const notice: CalendarDeliveryNotice = {
        id: noticeId,
        title,
        invitationId: selectedInvitation.id,
        invitationIdentity: invitationIdentityKey(selectedInvitation),
        targets: tasks.map(({ target }) => target),
        successVisible: false,
        successExpiresAt: null,
        failureDismissed: false,
        invitationStatus: 'pending',
        invitationStatusWarningDismissed: false,
      }
      calendarDeliveryInvitationsRef.current.set(noticeId, selectedInvitation)
      setCalendarDeliveryNotices((current) => [notice, ...current])

      const startDeliveryTask = (
        target: CalendarDeliveryTarget,
        run: () => Promise<void>
      ): Promise<void> => {
        const deliveryKey = `${noticeId}:${target.id}`
        const performAttempt = async (
          startedAt: number,
          retryIndex: number,
          attempts: number
        ): Promise<void> => {
          updateCalendarDeliveryTarget(noticeId, target.id, (current) => ({
            ...current,
            status: 'sending',
            attempts,
            error: undefined,
            retryAt: undefined,
          }))
          try {
            await run()
            const timer = calendarDeliveryTimersRef.current.get(deliveryKey)
            if (timer !== undefined) window.clearTimeout(timer)
            calendarDeliveryTimersRef.current.delete(deliveryKey)
            calendarDeliveryRetryActionsRef.current.delete(deliveryKey)
            updateCalendarDeliveryTarget(
              noticeId,
              target.id,
              (current) => ({
                ...current,
                status: 'succeeded',
                attempts,
                error: undefined,
                retryAt: undefined,
              }),
              Date.now() + 4000
            )
          } catch (error) {
            const message = apiErrorMessage(error)
            const retryable = isRetryableCalendarDeliveryError(error)
            const delay = retryable
              ? getCalendarDeliveryRetryDelay(startedAt, retryIndex)
              : null
            if (delay !== null) {
              const retryAt = Date.now() + delay
              updateCalendarDeliveryTarget(noticeId, target.id, (current) => ({
                ...current,
                status: 'retrying',
                attempts,
                error: message,
                retryAt,
              }))
              const previousTimer = calendarDeliveryTimersRef.current.get(deliveryKey)
              if (previousTimer !== undefined) window.clearTimeout(previousTimer)
              const timer = window.setTimeout(() => {
                calendarDeliveryTimersRef.current.delete(deliveryKey)
                void performAttempt(startedAt, retryIndex + 1, attempts + 1)
              }, delay)
              calendarDeliveryTimersRef.current.set(deliveryKey, timer)
            } else {
              updateCalendarDeliveryTarget(noticeId, target.id, (current) => ({
                ...current,
                status: 'failed',
                attempts,
                error: message,
                retryAt: undefined,
              }))
            }
          }
        }

        calendarDeliveryRetryActionsRef.current.set(deliveryKey, (attempts) => {
          const timer = calendarDeliveryTimersRef.current.get(deliveryKey)
          if (timer !== undefined) window.clearTimeout(timer)
          calendarDeliveryTimersRef.current.delete(deliveryKey)
          void performAttempt(Date.now(), 0, attempts + 1)
        })
        return performAttempt(Date.now(), 0, 1)
      }

      await Promise.all(
        tasks.map(({ target, run }) => startDeliveryTask(target, run))
      )
      closeInvitationCalendarPicker()
    } catch (error) {
      setCalendarActionError(apiErrorMessage(error))
    } finally {
      setCalendarActionSaving(false)
    }
  }, [
    closeInvitationCalendarPicker,
    createNewCoordinationCalendar,
    coordinationCalendars,
    invitationEditAddress,
    invitationEffectiveEndIso,
    invitationEffectiveStartIso,
    invitationEditDescription,
    invitationEditTitle,
    googleCalendarTargets,
    newCoordinationCalendarTitle,
    selectedCoordinationHashes,
    selectedGoogleTargetIds,
    selectedInvitation,
    selectedTimeManagerCategoryIds,
    selectedTimeManagerModeIds,
    timeManagerModes,
    timeManagerCategories,
    updateCalendarDeliveryTarget,
  ])

  const loadRules = useCallback(async () => {
    const { data } = await dedupedGet<{ rules: unknown[] }>('/api/mailbox/rules')
    const rawRules: unknown[] = Array.isArray(data?.rules) ? data.rules : []
    setRules(
      rawRules.filter((rule): rule is AutomationRuleRecord => {
        if (!rule || typeof rule !== 'object') return false
        const candidate = rule as Record<string, unknown>
        return (
          typeof candidate.id === 'string' &&
          typeof candidate.definition === 'object' &&
          candidate.definition !== null
        )
      })
    )
  }, [])

  const automationTagOptions = useMemo(
    () => mailboxTags.map((tag) => ({ id: tag.id, label: tag.label, color: tag.color })),
    [mailboxTags]
  )

  // True once the draft has been edited (or saved with different content) since the shown
  // preview/run result was produced -- the result no longer reflects the configuration on screen.
  const automationRunResultStale = useMemo(() => {
    if (!automationRunResult || !automationDraft || automationRunResultFingerprint === null)
      return false
    return automationRuleFingerprint(automationDraft) !== automationRunResultFingerprint
  }, [automationRunResult, automationDraft, automationRunResultFingerprint])

  const automationDraftDirty = useMemo(() => {
    if (!automationDraft) return false
    const saved = rules.find((rule) => rule.id === selectedAutomationRuleId)?.definition
    // An unsaved new rule always needs saving.
    if (!saved) return true
    return automationRuleFingerprint(automationDraft) !== automationRuleFingerprint(saved)
  }, [automationDraft, rules, selectedAutomationRuleId])

  const automationSettingsDraftDirty = useMemo(() => {
    if (!automationSettingsDraft) return false
    const saved = rules.find((rule) => rule.id === selectedAutomationSettingsRuleId)?.definition
    if (!saved) return true
    return automationRuleFingerprint(automationSettingsDraft) !== automationRuleFingerprint(saved)
  }, [automationSettingsDraft, rules, selectedAutomationSettingsRuleId])

  // Keeps the Settings-tab editor in sync when the rule it has open is updated elsewhere (e.g. by
  // the AI Assistant, which saves through the separate Automation Configuration panel). Skipped
  // while the user has unsaved edits open, so this never clobbers in-progress work.
  useEffect(() => {
    if (!selectedAutomationSettingsRuleId || automationSettingsDraftDirty) return
    const rule = rules.find((entry) => entry.id === selectedAutomationSettingsRuleId)
    if (!rule) return
    setAutomationSettingsDraft({ ...rule.definition, steps: [...rule.definition.steps] })
    // automationSettingsDraftDirty is derived from automationSettingsDraft itself; including it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules, selectedAutomationSettingsRuleId])

  // Layout owns the shared assistant panel, so it is opened through its global event.
  const openAiAssistantPanel = useCallback(() => {
    window.dispatchEvent(new Event('openAiPanel'))
  }, [])

  // Opens the mailbox tags panel and drives focus to the tag-creation input.
  const requestCreateMailboxTag = useCallback(() => {
    setTabInUrl('mailbox')
    setIsTagPanelOpen(true)
    setTimeout(() => {
      newTagInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      newTagInputRef.current?.focus()
      setCreateTagHighlight(true)
      setTimeout(() => setCreateTagHighlight(false), 2500)
    }, 350)
  }, [setTabInUrl])

  const openAutomationMatch = useCallback(
    (messageId: string) => {
      setTabInUrl('mailbox')
      void handleOpenThreadFromMessageId(messageId)
      // handleOpenThreadFromMessageId is recreated each render, so it is intentionally omitted.
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setTabInUrl]
  )

  const selectAutomationSettingsRule = useCallback(
    (ruleId: string | null) => {
      setAutomationSettingsError(null)
      setSelectedAutomationSettingsRuleId(ruleId)
      if (!ruleId) {
        setAutomationSettingsDraft(null)
        return
      }
      const rule = rules.find((entry) => entry.id === ruleId)
      setAutomationSettingsDraft(
        rule ? { ...rule.definition, steps: [...rule.definition.steps] } : null
      )
    },
    [rules]
  )

  const startNewAutomationSettingsRule = useCallback(() => {
    setAutomationSettingsError(null)
    setSelectedAutomationSettingsRuleId(null)
    setAutomationSettingsDraft(buildEmptyAutomationRule(`Rule ${rules.length + 1}`))
  }, [rules.length])

  const startNewAutomationRule = useCallback(() => {
    setAutomationError(null)
    setAutomationRunResult(null)
    setAutomationRunResultFingerprint(null)
    setSelectedAutomationRuleId(null)
    setAutomationDraft(buildEmptyAutomationRule(`Rule ${rules.length + 1}`))
  }, [rules.length])

  const openAutomationPanel = useCallback(() => {
    setIsAutomationPanelOpen(true)
    openAiAssistantPanel()
    // The panel is a create form; existing rules are managed on the automations settings tab.
    if (!automationDraft) startNewAutomationRule()
  }, [automationDraft, openAiAssistantPanel, startNewAutomationRule])

  const persistAutomationRule = useCallback(
    async (
      definition: AutomationRuleDefinition,
      ruleIdOverride?: string | null
    ): Promise<string | null> => {
      // Explicit override avoids a stale-closure read of selectedAutomationRuleId right after it was just set.
      const targetRuleId = ruleIdOverride !== undefined ? ruleIdOverride : selectedAutomationRuleId
      const payload = { definition }
      const { data } = targetRuleId
        ? await apiClient.put(`/api/mailbox/rules/${targetRuleId}`, payload)
        : await apiClient.post('/api/mailbox/rules', payload)

      await loadRules()
      const savedId = typeof data?.rule?.id === 'string' ? data.rule.id : targetRuleId
      setSelectedAutomationRuleId(savedId)
      return savedId
    },
    [loadRules, selectedAutomationRuleId]
  )

  const saveAutomationDraft = useCallback(async () => {
    if (!automationDraft) return

    const issues = validateAutomationRule(automationDraft)
    if (issues.length > 0) {
      setAutomationError(issues[0].message)
      return
    }

    setAutomationSaving(true)
    setAutomationError(null)
    try {
      await persistAutomationRule(automationDraft)
    } catch (err) {
      setAutomationError(apiErrorMessage(err))
    } finally {
      setAutomationSaving(false)
    }
  }, [automationDraft, persistAutomationRule])

  const saveAutomationSettingsDraft = useCallback(async () => {
    if (!automationSettingsDraft) return

    const issues = validateAutomationRule(automationSettingsDraft)
    if (issues.length > 0) {
      setAutomationSettingsError(issues[0].message)
      return
    }

    setAutomationSettingsSaving(true)
    setAutomationSettingsError(null)
    try {
      const payload = { definition: automationSettingsDraft }
      const { data } = selectedAutomationSettingsRuleId
        ? await apiClient.put(`/api/mailbox/rules/${selectedAutomationSettingsRuleId}`, payload)
        : await apiClient.post('/api/mailbox/rules', payload)
      await loadRules()
      const savedId =
        typeof data?.rule?.id === 'string' ? data.rule.id : selectedAutomationSettingsRuleId
      setSelectedAutomationSettingsRuleId(savedId)
    } catch (err) {
      setAutomationSettingsError(apiErrorMessage(err))
    } finally {
      setAutomationSettingsSaving(false)
    }
  }, [automationSettingsDraft, loadRules, selectedAutomationSettingsRuleId])

  const deleteAutomationRule = useCallback(
    async (ruleId: string) => {
      setAutomationError(null)
      try {
        await apiClient.delete(`/api/mailbox/rules/${ruleId}`)
        await loadRules()
        if (selectedAutomationRuleId === ruleId) {
          setSelectedAutomationRuleId(null)
          setAutomationDraft(null)
          setAutomationRunResult(null)
          setAutomationRunResultFingerprint(null)
        }
        if (selectedAutomationSettingsRuleId === ruleId) {
          setSelectedAutomationSettingsRuleId(null)
          setAutomationSettingsDraft(null)
        }
      } catch (err) {
        setAutomationError(apiErrorMessage(err))
      }
    },
    [loadRules, selectedAutomationRuleId, selectedAutomationSettingsRuleId]
  )

  /** Hands the rule being edited in settings to the right side panel, where it can be previewed against the mailbox. */
  const moveAutomationSettingsRuleToPanel = useCallback(() => {
    if (!automationSettingsDraft) return
    setAutomationError(null)
    setAutomationRunResult(null)
    setAutomationRunResultFingerprint(null)
    setSelectedAutomationRuleId(selectedAutomationSettingsRuleId)
    setAutomationDraft({ ...automationSettingsDraft, steps: [...automationSettingsDraft.steps] })
    setIsAutomationPanelOpen(true)
  }, [automationSettingsDraft, selectedAutomationSettingsRuleId])

  const reconcileSentReplies = useCallback((threadId: string, observed: ThreadMessage[]) => {
    const merged = [...observed]
    const claimedMessageIds = new Set<string>()
    for (const pending of pendingSentRepliesRef.current.values()) {
      if (pending.threadId !== threadId) continue
      const local = pending.message
      const imported = observed.find((candidate) => {
        if (claimedMessageIds.has(candidate.id) || candidate.id === local.id || pending.knownMessageIds.has(candidate.id)) return false
        if (pending.importedMessage) return candidate.id === pending.importedMessage.id
        if (local.provider_message_id) return candidate.provider_message_id === local.provider_message_id
        // Graph sendMail can return no message id. Only match a new sent copy with the same content and send window.
        const sentAt = Date.parse(local.received_at || '')
        const receivedAt = Date.parse(candidate.received_at || '')
        const body = local.body_text?.trim()
        return candidate.is_provider_sent &&
          candidate.from_email?.toLowerCase() === local.from_email?.toLowerCase() &&
          candidate.subject === local.subject &&
          candidate.to_emails === local.to_emails &&
          Boolean(body) &&
          candidate.body_text?.trim().startsWith(body || '') &&
          Math.abs(receivedAt - sentAt) < 120_000
      })
      if (imported) pending.importedMessage = imported
      const reply = pending.importedMessage ?? local
      claimedMessageIds.add(reply.id)
      const localIndex = merged.findIndex((entry) => entry.id === local.id)
      if (localIndex >= 0) merged.splice(localIndex, 1)
      if (!merged.some((entry) => entry.id === reply.id)) merged.push(reply)
      const sourceIndex = merged.findIndex((entry) => entry.id === pending.sourceMessageId)
      if (sourceIndex >= 0) {
        merged[sourceIndex] = { ...merged[sourceIndex], is_replied: true, replied_by_message_id: reply.id }
      }
      if (imported) {
        setFocusedThreadMessageId((current) => current === local.id ? imported.id : current)
        setThreadScrollRequest((current) => current?.messageId === local.id ? { ...current, messageId: imported.id } : current)
      }
    }
    return merged.sort((left, right) => (left.received_at || '').localeCompare(right.received_at || ''))
  }, [])

  // Most-recently-used cache of opened threads, so reopening an email never waits on the network.
  const writeThreadCache = useCallback((threadId: string, entry: CachedThread) => {
    const cache = threadCacheRef.current
    cache.delete(threadId)
    cache.set(threadId, entry)

    while (cache.size > MAILBOX_THREAD_CACHE_MAX) {
      const oldestKey = cache.keys().next().value
      if (oldestKey === undefined) break
      cache.delete(oldestKey)
    }
  }, [])

  const invalidateThreadCacheForMessages = useCallback((messageIds: string[]) => {
    if (messageIds.length === 0) return
    const targets = new Set(messageIds)

    for (const [threadId, entry] of threadCacheRef.current) {
      if (entry.messages.some((message) => targets.has(message.id))) {
        threadCacheRef.current.delete(threadId)
      }
    }
    for (const messageId of targets) attachmentCacheRef.current.delete(messageId)
    for (const [draftId, pending] of pendingSentRepliesRef.current) {
      if (pending.importedMessage && targets.has(pending.importedMessage.id)) {
        pendingSentRepliesRef.current.delete(draftId)
      }
    }
  }, [])

  const addSelectedThreadTargetToJunk = useCallback(async () => {
    if (!selectedThreadJunkTarget || !selectedThreadLatestMessage || savingJunk) return
    const messageId = selectedThreadLatestMessage.id
    const threadId = selectedThreadIdRef.current
    const requestSeq = openThreadRequestSeqRef.current
    const isCurrentThread = () => mailboxMountedRef.current
      && requestSeq === openThreadRequestSeqRef.current
      && selectedThreadIdRef.current === threadId
    setSavingJunk(true)
    setJunkActionWarning(null)
    let saved = false
    try {
      const { data } = await apiClient.post<{ automation_warnings?: string[] }>(`/api/mailbox/messages/${messageId}/junk`, {
        message_ids: threadMessages.map((message) => message.id),
      })
      saved = true
      setJunkDomains((prev) => new Set(prev).add(selectedThreadJunkTarget))
      invalidateThreadCacheForMessages(threadMessages.map((message) => message.id))
      if (Array.isArray(data?.automation_warnings) && data.automation_warnings.length > 0 && isCurrentThread()) {
        setJunkActionWarning({ threadId, message: `Junk was saved, but automation did not fully complete: ${data.automation_warnings.join('; ')}` })
      }
      const readSeq = pendingTrashRef.current.beginRead()
      const response = await dedupedGet<{ thread?: MailThread | null; messages?: unknown }>(`/api/mailbox/messages/${messageId}/thread`)
      const refreshed = pendingTrashRef.current.apply(
        reconcileSentReplies(threadId || '', normalizeThreadMessages(response.data?.messages)), readSeq
      )
      pendingTrashRef.current.completeRead(readSeq)
      syncInboxListFromThreadMessages(refreshed)
      if (isCurrentThread()) {
        setThreadMessages(refreshed)
        setSelectedThread(response.data?.thread || null)
      }
      void loadMessages(inboxLoadLimitRef.current)
    } catch (err) {
      console.warn('[MailboxPage] Junk action or follow-up refresh failed:', err)
      if (isCurrentThread()) setJunkActionWarning({
        threadId,
        message: `${saved ? 'Junk was saved, but refreshing the thread failed: ' : ''}${apiErrorMessage(err)}`,
      })
    } finally {
      setSavingJunk(false)
    }
  }, [selectedThreadJunkTarget, selectedThreadLatestMessage, savingJunk, threadMessages,
    invalidateThreadCacheForMessages, reconcileSentReplies, syncInboxListFromThreadMessages, loadMessages])

  const removeSelectedMessageFromProviderJunk = useCallback(async () => {
    if (!selectedThreadLatestMessage) return
    const messageId = selectedThreadLatestMessage.id

    setError(null)
    invalidateThreadCacheForMessages([messageId])
    setMessages((prev) =>
      prev.map((message) =>
        message.id === messageId ? { ...message, is_provider_junk: false } : message
      )
    )
    setThreadMessages((prev) =>
      prev.map((message) =>
        message.id === messageId ? { ...message, is_provider_junk: false } : message
      )
    )

    try {
      await apiClient.post(`/api/mailbox/messages/${messageId}/not-junk`)
      void loadMessages(inboxLoadLimitRef.current)
    } catch (err) {
      setError(apiErrorMessage(err))
      setMessages((prev) =>
        prev.map((message) =>
          message.id === messageId ? { ...message, is_provider_junk: true } : message
        )
      )
      setThreadMessages((prev) =>
        prev.map((message) =>
          message.id === messageId ? { ...message, is_provider_junk: true } : message
        )
      )
      void loadMessages(inboxLoadLimitRef.current)
    }
  }, [selectedThreadLatestMessage, loadMessages, invalidateThreadCacheForMessages])

  const clearThreadCache = useCallback(() => {
    threadCacheRef.current.clear()
    attachmentCacheRef.current.clear()
  }, [])

  const prefetchThread = useCallback(
    async (threadId: string) => {
      if (threadCacheRef.current.has(threadId) || threadPrefetchInFlightRef.current.has(threadId))
        return

      threadPrefetchInFlightRef.current.add(threadId)
      try {
        const readSeq = pendingTrashRef.current.beginRead()
        const { data } = await apiClient.get(`/api/mailbox/threads/${threadId}`)
        const normalizedThreadMessages = pendingTrashRef.current.apply(
          reconcileSentReplies(threadId, normalizeThreadMessages(data?.messages)),
          readSeq
        )
        pendingTrashRef.current.completeRead(readSeq)
        writeThreadCache(threadId, {
          thread: data.thread || null,
          messages: normalizedThreadMessages,
        })
        syncInboxListFromThreadMessages(normalizedThreadMessages)
      } catch {
        // Prefetching is best effort; a failure just means the thread loads on demand.
      } finally {
        threadPrefetchInFlightRef.current.delete(threadId)
      }
    },
    [writeThreadCache, syncInboxListFromThreadMessages, reconcileSentReplies]
  )

  // Plays the row exit transition, then resolves so the caller can drop the rows from state.
  const playMessageRemovalAnimation = useCallback((messageIds: string[]) => {
    if (messageIds.length === 0) return Promise.resolve()
    const exitedUntil = Date.now() + MAILBOX_ROW_EXITED_GRACE_MS
    for (const id of messageIds) exitedMessageIdsRef.current.set(id, exitedUntil)
    setRemovingMessageIds((prev) => {
      const next = new Set(prev)
      for (const id of messageIds) next.add(id)
      return next
    })
    return new Promise<void>((resolve) => window.setTimeout(resolve, MAILBOX_ROW_EXIT_MS))
  }, [])

  // Called right after the caller drops/flags the rows in state. The actual clear is handed to the
  // filter effect so the row leaves `filteredMessages` in the same commit -- clearing it here would
  // render one frame where the row is still listed but no longer exiting, so it starts fading back in.
  const clearMessageRemovalAnimation = useCallback((messageIds: string[]) => {
    for (const id of messageIds) pendingExitClearIdsRef.current.add(id)
    // Fallback in case no filter pass follows (e.g. the state update was a no-op).
    window.setTimeout(() => {
      const stale = messageIds.filter((id) => pendingExitClearIdsRef.current.has(id))
      if (stale.length === 0) return
      for (const id of stale) pendingExitClearIdsRef.current.delete(id)
      setRemovingMessageIds((prev) => {
        if (!stale.some((id) => prev.has(id))) return prev
        const next = new Set(prev)
        for (const id of stale) next.delete(id)
        return next
      })
    }, MAILBOX_ROW_EXIT_MS)
  }, [])

  const runAutomationRuleById = useCallback(
    async (
      ruleId: string,
      scope: 'visible' | 'all',
      dryRun: boolean
    ): Promise<AutomationRunResult | null> => {
      if (automationRunningRef.current) return null
      automationRunningRef.current = true
      setAutomationRunning(true)
      setAutomationError(null)
      try {
        const { data } = await apiClient.post('/api/mailbox/rules/run', {
          rule_ids: [ruleId],
          dry_run: dryRun,
          message_ids: scope === 'visible' ? filteredMessages.map((message) => message.id) : [],
          limit: scope === 'visible' ? filteredMessages.length : inboxLoadLimitRef.current,
        })
        setAutomationRunResult(data as AutomationRunResult)
        // Written explanation of every score lands in the AI assistant so the user can push back on it.
        window.dispatchEvent(
          new CustomEvent('aiAssistantMessage', {
            detail: {
              content: describeAutomationRunResult(data as AutomationRunResult),
              action: 'automation-run',
            },
          })
        )
        if (!dryRun) {
          clearThreadCache()
          const selectedRule = rules.find((rule) => rule.id === ruleId)
          const tagSteps =
            selectedRule?.definition.steps.filter(
              (step) =>
                step.kind === 'action' &&
                step.enabled &&
                (step.action === 'add_tag' || step.action === 'remove_tag')
            ) || []
          const appliedByMessageId = new Map<string, { add: string[]; remove: string[] }>()
          // Track state-changing actions too, so trash/junk/archive/read effects show up in the
          // list immediately instead of waiting up to a minute for the next background refresh.
          const trashedIds: string[] = []
          const junkedIds: string[] = []
          const archivedIds: string[] = []
          const unarchivedIds: string[] = []
          const readIds: string[] = []
          const unreadIds: string[] = []

          for (const match of data.matches || []) {
            const appliedTags = appliedByMessageId.get(match.message_id) || { add: [], remove: [] }
            for (const step of tagSteps) {
              if (step.kind !== 'action' || !match.applied.includes(step.action) || !step.value)
                continue
              if (step.action === 'add_tag') appliedTags.add.push(step.value)
              else appliedTags.remove.push(step.value)
            }
            if (appliedTags.add.length > 0 || appliedTags.remove.length > 0) {
              appliedByMessageId.set(match.message_id, appliedTags)
            }
            if (match.applied.includes('trash')) trashedIds.push(match.message_id)
            if (match.applied.includes('junk')) junkedIds.push(match.message_id)
            if (match.applied.includes('archive')) archivedIds.push(match.message_id)
            if (match.applied.includes('unarchive')) unarchivedIds.push(match.message_id)
            if (match.applied.includes('mark_read')) readIds.push(match.message_id)
            if (match.applied.includes('mark_unread')) unreadIds.push(match.message_id)
          }

          const applyLocalTagChanges = <T extends { id: string; user_tag_ids: string[] }>(
            messages: T[]
          ) =>
            messages.map((message) => {
              const changes = appliedByMessageId.get(message.id)
              if (!changes) return message
              return {
                ...message,
                user_tag_ids: Array.from(
                  new Set([
                    ...message.user_tag_ids.filter((tagId) => !changes.remove.includes(tagId)),
                    ...changes.add,
                  ])
                ),
              }
            })

          const stateChangedIds = new Set([
            ...trashedIds,
            ...junkedIds,
            ...archivedIds,
            ...unarchivedIds,
            ...readIds,
            ...unreadIds,
          ])
          const applyLocalStateChanges = <
            T extends {
              id: string
              is_provider_trashed: boolean
              is_provider_junk: boolean
              is_archived: boolean
              is_read: boolean
            },
          >(
            messages: T[]
          ) =>
            messages.map((message) => {
              if (!stateChangedIds.has(message.id)) return message
              return {
                ...message,
                is_provider_trashed: trashedIds.includes(message.id)
                  ? true
                  : message.is_provider_trashed,
                is_provider_junk: junkedIds.includes(message.id)
                  ? true
                  : message.is_provider_junk,
                is_archived: unarchivedIds.includes(message.id)
                  ? false
                  : archivedIds.includes(message.id)
                    ? true
                    : message.is_archived,
                is_read: unreadIds.includes(message.id)
                  ? false
                  : readIds.includes(message.id)
                    ? true
                    : message.is_read,
              }
            })

          if (stateChangedIds.size > 0) {
            // Play the same row-exit animation used by manual trash so removed rows don't just snap away.
            await playMessageRemovalAnimation([...trashedIds, ...junkedIds, ...archivedIds])
          }

          setMessages((messages) =>
            applyLocalStateChanges(applyLocalTagChanges(messages))
          )
          setThreadMessages((messages) =>
            applyLocalStateChanges(applyLocalTagChanges(messages))
          )
          if (stateChangedIds.size > 0) {
            clearMessageRemovalAnimation([...trashedIds, ...junkedIds, ...archivedIds])
            selectTopThreadAfterTrashRef.current = true
          }

          void loadMailboxTags().catch(() => undefined)
        }
        return data as AutomationRunResult
      } catch (err) {
        setAutomationError(apiErrorMessage(err))
        return null
      } finally {
        automationRunningRef.current = false
        setAutomationRunning(false)
      }
    },
    [
      filteredMessages,
      loadMailboxTags,
      clearThreadCache,
      rules,
      playMessageRemovalAnimation,
      clearMessageRemovalAnimation,
    ]
  )

  const runAutomationRule = useCallback(
    async (scope: 'visible' | 'all', dryRun: boolean) => {
      if (!selectedAutomationRuleId) return
      // Records the draft exactly as it looked when the run was requested, so a later edit can be detected as staleness.
      setAutomationRunResultFingerprint(
        automationDraft ? automationRuleFingerprint(automationDraft) : null
      )
      await runAutomationRuleById(selectedAutomationRuleId, scope, dryRun)
    },
    [runAutomationRuleById, selectedAutomationRuleId, automationDraft]
  )

  // The assistant configures the rule builder for the user: it reads the open email,
  // writes the draft, saves it as a trial run, and previews it on the visible list.
  const handleAssistantSubmit = useCallback(
    async (
      message: string,
      history?: Array<{ role: 'user' | 'assistant'; content: string }>,
      retry?: AiRetryRequest
    ): Promise<{ message: string; action?: string; systemPrompt?: string; evaluation?: AiEvaluation; retryToken?: string }> => {
      const openMessage =
        threadMessages.length > 0 ? threadMessages[threadMessages.length - 1] : null
      // Settings / AI Assistant lets the user withhold data sources; withheld sources are simply absent.
      const currentState = buildMailboxAssistantState({
        openEmail:
          openMessage && aiAccess.messages
            ? {
                id: openMessage.id,
                subject: openMessage.subject,
                from_email: openMessage.from_email,
                from_name: openMessage.from_name,
                to_emails: openMessage.to_emails,
                preview: openMessage.preview,
                body_text: openMessage.body_text,
                is_read: openMessage.is_read,
                user_tag_ids: openMessage.user_tag_ids,
              }
            : null,
        visibleMessages: aiAccess.messages
          ? filteredMessages.map((entry) => ({
              id: entry.id,
              subject: entry.subject,
              from_email: entry.from_email,
              from_name: entry.from_name,
              to_emails: entry.to_emails,
              preview: entry.preview,
              has_attachments: entry.has_attachments,
              is_read: entry.is_read,
              user_tag_ids: entry.user_tag_ids,
            }))
          : [],
        tags: aiAccess.tags ? mailboxTags.map((tag) => ({ id: tag.id, label: tag.label })) : [],
        draft: automationDraft,
        savedRules: aiAccess.rules
          ? rules.map((rule) => ({
              id: rule.id,
              name: rule.name,
              mode: rule.mode,
              assessmentChecks: rule.definition.steps
                .filter(
                  (step): step is AutomationConditionStep =>
                    step.kind === 'condition' && step.field === 'assessment' && step.enabled
                )
                .map((step) => ({
                  context: step.assessmentContext || '',
                  intent: step.assessmentIntent || '',
                  scoreThreshold: step.assessmentScoreThreshold ?? 0.8,
                })),
            }))
          : [],
        connectedAccounts: aiAccess.accounts
          ? accounts.map((account) => ({
              id: account.id,
              address: account.address,
              provider: account.provider,
              identity_group: account.identity_group,
            }))
          : [],
      })

      const { data } = await apiClient.post('/api/ai-chat/mailbox-automation', {
        message,
        history,
        currentState,
        preferredModel: user?.themePreferences?.aiSettings?.preferredModel || 'openai',
        ...(retry ?? {}),
      })
      const retryToken: string | undefined = typeof data?.retryToken === 'string' ? data.retryToken : undefined

      const plan = parseMailboxAssistantPlan(data, {
        tags: currentState.tags,
        fallbackName: `Rule ${rules.length + 1}`,
        currentDraft: automationDraft,
      })

      if (!plan.rule) {
        return {
          message: plan.explanation || 'No automation change was needed.',
          systemPrompt: data.systemPrompt,
          evaluation: buildAiEvaluation(
            isMutationRequest(message)
              ? ['The request asks for an automation change, but no rule was returned, so nothing was configured. Return a rule, or explain exactly what is blocking it.']
              : []
          ),
          retryToken,
        }
      }

      // If no rule is currently open in the panel, a same-named saved rule is treated as an update
      // to that rule rather than a new one -- otherwise "configure X" on an existing rule X silently
      // produced an unrelated duplicate draft that never touched the rule the user meant.
      const matchingExistingRule = !selectedAutomationRuleId
        ? rules.find(
            (rule) => rule.name.trim().toLowerCase() === plan.rule!.name.trim().toLowerCase()
          )
        : null
      const targetRuleId = matchingExistingRule?.id ?? selectedAutomationRuleId ?? null

      setIsAutomationPanelOpen(true)
      setAutomationError(null)
      if (matchingExistingRule) setSelectedAutomationRuleId(matchingExistingRule.id)
      setAutomationDraft(plan.rule)

      const lines = [
        `Configured ${describeAssistantRule(plan.rule, currentState.tags)}`,
        ...(matchingExistingRule
          ? [
              `Updating your existing rule "${matchingExistingRule.name}" instead of creating a new one.`,
            ]
          : []),
        ...plan.notes.map((note) => `- ${note}`),
      ]
      if (plan.explanation) lines.push(plan.explanation)

      if (plan.issues.length > 0) {
        lines.push(
          `The draft still needs your input: ${plan.issues.map((issue) => `- ${issue.message}`).join('\n')}`
        )
        return {
          message: lines.join('\n\n'),
          action: 'automation-draft',
          systemPrompt: data.systemPrompt,
          evaluation: buildAiEvaluation(
            plan.issues.map((issue) => `Rule draft is invalid: ${issue.message}`)
          ),
          retryToken,
        }
      }

      const evaluationIssues: string[] = []
      try {
        const ruleId = await persistAutomationRule(plan.rule, targetRuleId)
        if (!ruleId) {
          lines.push('The rule could not be saved, so no preview was run.')
          return {
            message: lines.join('\n\n'),
            action: 'automation-draft',
            systemPrompt: data.systemPrompt,
            evaluation: buildAiEvaluation(['The rule was not saved to the database (save returned no rule id).']),
            retryToken,
          }
        }

        lines.push(
          'Saved as a trial run. It will not change anything until you switch the mode to Active yourself.'
        )

        if (plan.run.scope === 'visible') {
          const result = await runAutomationRuleById(ruleId, 'visible', true)
          lines.push(
            result
              ? `Preview on visible: ${result.summary.matched} of ${result.evaluated_messages} emails matched.`
              : 'The preview run could not be completed -- see the automation panel for details.'
          )
        }
      } catch (err) {
        lines.push(apiErrorMessage(err))
        evaluationIssues.push(`Saving or previewing the rule failed: ${apiErrorMessage(err)}`)
      }

      return {
        message: lines.join('\n\n'),
        action: 'automation-run',
        systemPrompt: data.systemPrompt,
        evaluation: buildAiEvaluation(evaluationIssues),
        retryToken,
      }
    },
    [
      accounts,
      aiAccess,
      automationDraft,
      filteredMessages,
      mailboxTags,
      persistAutomationRule,
      rules,
      runAutomationRuleById,
      selectedAutomationRuleId,
      threadMessages,
      user,
    ]
  )

  // Files an auto-composed feature request on the user's behalf so they never have to write it themselves.
  const handleRequestFeature = useCallback(
    async (accessId: MailboxAiAccessId) => {
      const entry = MAILBOX_AI_ACCESS_ENTRIES.find((candidate) => candidate.id === accessId)
      if (!entry || requestedFeatureIds.has(accessId) || requestingFeatureId) return

      setRequestingFeatureId(accessId)
      try {
        await apiClient.post('/api/feedback', {
          message: buildMailboxFeatureRequestMessage(entry),
          category: 'feature',
        })
        setRequestedFeatureIds((prev) => new Set(prev).add(accessId))
      } catch (err) {
        console.error('Failed to file feature request:', err)
      } finally {
        setRequestingFeatureId(null)
      }
    },
    [requestedFeatureIds, requestingFeatureId]
  )

  // Kept in a ref so the registration effect below does not re-run on every render.
  const assistantSubmitRef = useRef(handleAssistantSubmit)
  assistantSubmitRef.current = handleAssistantSubmit

  useEffect(() => {
    setPageContext({
      pageName: 'Mailbox Automation Assistant',
      suggestions: [
        'Based on this email, trash future messages like it and tag them Auto-delete',
        'Tag every email from this sender as Newsletter and archive it',
        'Preview a rule for invoices with PDF attachments',
        'Apply this rule to newly imported mail too',
      ],
      placeholder: 'e.g. "based on current email, trash these and apply the auto-delete tag"',
      onSubmit: (msg, history, retry) => assistantSubmitRef.current(msg, history, retry),
    })
    return () => setPageContext(null)
  }, [setPageContext])

  useEffect(() => {
    inboxLoadLimitRef.current = inboxLoadLimit
  }, [inboxLoadLimit])

  useEffect(() => {
    messagesRef.current = messages
    messagesTotalRef.current = messagesTotal
  }, [messages, messagesTotal])

  useEffect(() => {
    selectedThreadIdRef.current = selectedThread?.id || null
  }, [selectedThread])

  // Secondary data (people, rules, invitations) only feeds the non-mailbox tabs and the
  // automation panel, so it must never block the inbox from rendering.
  const loadSecondary = useCallback(async () => {
    setIsEnriching(true)
    try {
      const results = await Promise.allSettled([
        loadPeople(),
        loadRules(),
        loadInvitations(),
        loadDrafts(),
      ])
      for (const result of results) {
        if (result.status === 'rejected')
          console.warn('[MailboxPage] Background load failed:', result.reason)
      }
    } finally {
      setIsEnriching(false)
    }
  }, [loadDrafts, loadInvitations, loadPeople, loadRules])

  const loadInitial = useCallback(async () => {
    // Only the very first mount may skip the loading indicator, and only when a
    // fresh cached copy is already painted; manual retries always show it.
    const skipLoadingIndicator = isFirstMailboxLoadRef.current && hadFreshCachedMailboxAtMountRef.current
    isFirstMailboxLoadRef.current = false
    if (!skipLoadingIndicator) {
      setIsLoading(true)
    }
    setError(null)
    visibleTargetRef.current = MESSAGE_LOAD_DEFAULT
    setVisibleTarget(MESSAGE_LOAD_DEFAULT)

    let messagesResult: { messages: MailMessage[]; total: number } | null = null
    try {
      const [, result] = await Promise.all([
        loadAccounts(),
        loadMessages(inboxLoadLimitRef.current),
        loadMailboxTags(),
      ])
      messagesResult = result
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setIsLoading(false)
    }

    if (!mailboxMountedRef.current) return
    void loadSecondary()

    // The filter-fill scan reports its own "Checking X of Y" progress inside the inbox panel,
    // so it runs after the shell is interactive instead of gating it.
    const finishWithPrefetch = () => window.setTimeout(() => prefetchNextPage(), 300)
    if (messagesResult) {
      const visibleCount = computeVisibleCount(messagesResult.messages)
      void loadUntilVisibleTarget(
        inboxLoadLimitRef.current,
        messagesResult.total,
        visibleCount,
        visibleTargetRef.current
      )
        .catch((err) => console.warn('[MailboxPage] Filter scan failed:', err))
        .finally(finishWithPrefetch)
    } else {
      finishWithPrefetch()
    }
  }, [
    loadAccounts,
    loadMailboxTags,
    loadMessages,
    loadSecondary,
    computeVisibleCount,
    loadUntilVisibleTarget,
    prefetchNextPage,
  ])

  const closeTagPicker = useCallback(() => {
    setIsTagPickerOpen(false)
    setTagPickerPosition(null)
    setTagPickerScope('message')
  }, [])

  const openTagPickerForMessage = useCallback((messageId: string, anchor: HTMLButtonElement) => {
    const rect = anchor.getBoundingClientRect()
    const popoverWidth = 260
    const margin = 8
    const left = Math.max(margin, Math.min(window.innerWidth - popoverWidth - margin, rect.left))
    const top = clampTopBelowObstruction(Math.min(window.innerHeight - 320, rect.bottom + 8), margin)

    setTagPickerScope('message')
    setSelectedTagMessageId(messageId)
    setTagPickerPosition({ left, top })
    setIsTagPickerOpen(true)
  }, [])

  // Opens the same tag picker in 'thread' scope: toggling a tag there applies it to every message in the open thread.
  const openThreadTagPicker = useCallback((anchor: HTMLButtonElement) => {
    const rect = anchor.getBoundingClientRect()
    const popoverWidth = 260
    const margin = 8
    const left = Math.max(margin, Math.min(window.innerWidth - popoverWidth - margin, rect.left))
    const top = clampTopBelowObstruction(Math.min(window.innerHeight - 320, rect.bottom + 8), margin)

    setTagPickerScope('thread')
    setTagPickerPosition({ left, top })
    setIsTagPickerOpen(true)
  }, [])

  const getDisplayTagIds = useCallback(
    (message: { id: string; user_tag_ids: string[] }) => {
      const fading = fadingTagRemovals.get(message.id)
      if (!fading || fading.size === 0) return message.user_tag_ids
      return Array.from(new Set([...message.user_tag_ids, ...fading]))
    },
    [fadingTagRemovals]
  )

  // Keeps a removed tag chip mounted (fading out) for MAILBOX_TAG_FADE_MS, then briefly slows the
  // affected rows' transition duration so the layout reflow ('emails move up') reads as an animation.
  const scheduleTagFadeOut = useCallback((messageIds: string[], tagId: string) => {
    setFadingTagRemovals((prev) => {
      const next = new Map(prev)
      for (const id of messageIds) {
        const set = new Set(next.get(id) ?? [])
        set.add(tagId)
        next.set(id, set)
      }
      return next
    })
    window.setTimeout(() => {
      setFadingTagRemovals((prev) => {
        const next = new Map(prev)
        for (const id of messageIds) {
          const set = new Set(next.get(id) ?? [])
          set.delete(tagId)
          if (set.size === 0) next.delete(id)
          else next.set(id, set)
        }
        return next
      })
      setSettlingMessageIds((prev) => {
        const next = new Set(prev)
        for (const id of messageIds) next.add(id)
        return next
      })
      window.setTimeout(() => {
        setSettlingMessageIds((prev) => {
          const next = new Set(prev)
          for (const id of messageIds) next.delete(id)
          return next
        })
      }, MAILBOX_TAG_SETTLE_MS)
    }, MAILBOX_TAG_FADE_MS)
  }, [])

  const handleMailboxMessageHoverEnter = useCallback((messageId: string) => {
    if (mailboxMessageHoverFadeTimeoutRef.current !== null) {
      window.clearTimeout(mailboxMessageHoverFadeTimeoutRef.current)
      mailboxMessageHoverFadeTimeoutRef.current = null
    }
    setFadingMailboxMessageId(null)
    setHoveredMailboxMessageId(messageId)
  }, [])

  const handleMailboxMessageHoverLeave = useCallback((messageId: string) => {
    setHoveredMailboxMessageId((current) => (current === messageId ? null : current))
    setFadingMailboxMessageId(messageId)

    if (mailboxMessageHoverFadeTimeoutRef.current !== null) {
      window.clearTimeout(mailboxMessageHoverFadeTimeoutRef.current)
    }
    mailboxMessageHoverFadeTimeoutRef.current = window.setTimeout(() => {
      setFadingMailboxMessageId((current) => (current === messageId ? null : current))
      mailboxMessageHoverFadeTimeoutRef.current = null
    }, 600)
  }, [])

  useEffect(() => {
    return () => {
      if (mailboxMessageHoverFadeTimeoutRef.current !== null) {
        window.clearTimeout(mailboxMessageHoverFadeTimeoutRef.current)
      }
    }
  }, [])

  const toggleMailboxTagPanel = useCallback(() => {
    setIsTagPanelOpen((current) => !current)
  }, [])

  const toggleSettingsGuideTab = useCallback((tabKey: string) => {
    setExpandedSettingsGuideTabs((current) => ({ ...current, [tabKey]: !current[tabKey] }))
  }, [])

  const handleMailboxLoadLimitChange = useCallback((value: number) => {
    const clamped = Math.min(500, Math.max(10, Math.floor(value)))
    setInboxLoadLimit(clamped)
    inboxLoadLimitRef.current = clamped
    try {
      localStorage.setItem(MAILBOX_LOAD_LIMIT_STORAGE_KEY, String(clamped))
    } catch {
      /* ignore */
    }
  }, [])

  const navigateToMailboxSettings = useCallback(() => {
    setTabInUrl('settings', 'accounts')
    setShowMailboxSettings(true)
    setTimeout(() => {
      mailboxSettingsInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setMailboxSettingsHighlight(true)
      setTimeout(() => setMailboxSettingsHighlight(false), 2500)
    }, 350)
  }, [setTabInUrl])

  const handleCreateMailboxTag = async () => {
    const label = newTagLabel.trim()
    if (!label) return

    setTagsSaving(true)
    setError(null)
    try {
      await apiClient.post('/api/mailbox/preferences/tags', {
        label,
        color: newTagColor,
      })
      setNewTagLabel('')
      setNewTagColor(MAILBOX_TAG_DEFAULT_COLOR)
      await loadMailboxTags()
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setTagsSaving(false)
    }
  }

  const handleStartEditMailboxTag = (tag: MailboxTagItem) => {
    setEditingTagId(tag.id)
    setEditingTagLabel(tag.label)
    setEditingTagColor(tag.color)
  }

  const handleSaveMailboxTag = async () => {
    if (!editingTagId) return
    const label = editingTagLabel.trim()
    if (!label) return

    setTagsSaving(true)
    setError(null)
    try {
      await apiClient.put(`/api/mailbox/preferences/tags/${editingTagId}`, {
        label,
        color: editingTagColor,
      })
      setEditingTagId(null)
      setEditingTagLabel('')
      setEditingTagColor(MAILBOX_TAG_DEFAULT_COLOR)
      await loadMailboxTags()
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setTagsSaving(false)
    }
  }

  const handleDeleteMailboxTag = async (tagId: string) => {
    setTagsSaving(true)
    setError(null)
    try {
      await apiClient.delete(`/api/mailbox/preferences/tags/${tagId}`)
      clearThreadCache()
      await loadMailboxTags()
      setMessages((prev) =>
        prev.map((message) => ({
          ...message,
          user_tag_ids: message.user_tag_ids.filter((id) => id !== tagId),
        }))
      )
      setThreadMessages((prev) =>
        prev.map((message) => ({
          ...message,
          user_tag_ids: message.user_tag_ids.filter((id) => id !== tagId),
        }))
      )
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setTagsSaving(false)
    }
  }

  const handleToggleTagOnSelectedMessage = async (tagId: string) => {
    if (!selectedTagMessage) return

    const messageId = selectedTagMessage.id
    const previousTagIds = selectedTagMessage.user_tag_ids
    const isRemoval = previousTagIds.includes(tagId)
    const nextTagIds = isRemoval
      ? previousTagIds.filter((id) => id !== tagId)
      : [...previousTagIds, tagId]

    const applyTagIds = <T extends { id: string; user_tag_ids: string[] }>(
      list: T[],
      tagIds: string[]
    ) => list.map((message) => (message.id === messageId ? { ...message, user_tag_ids: tagIds } : message))

    // Applied locally before the request resolves so the fade/reflow animation starts immediately
    // instead of waiting on network latency.
    setThreadMessages((prev) => applyTagIds(prev, nextTagIds))
    setMessages((prev) => applyTagIds(prev, nextTagIds))
    if (isRemoval) {
      scheduleTagFadeOut([messageId], tagId)
    }

    setTagsSaving(true)
    setError(null)
    try {
      await apiClient.post(`/api/mailbox/messages/${messageId}/tags`, {
        tag_ids: nextTagIds,
      })
      invalidateThreadCacheForMessages([messageId])
    } catch (err) {
      setError(apiErrorMessage(err))
      setThreadMessages((prev) => applyTagIds(prev, previousTagIds))
      setMessages((prev) => applyTagIds(prev, previousTagIds))
    } finally {
      setTagsSaving(false)
    }
  }

  // Applies (or removes) a tag across every message in the open thread at once.
  const handleToggleTagOnThread = async (tagId: string) => {
    if (!threadMessages.length) return

    const isRemoval = threadMessages.every((message) => message.user_tag_ids.includes(tagId))
    const targets = threadMessages.filter((message) =>
      isRemoval ? message.user_tag_ids.includes(tagId) : !message.user_tag_ids.includes(tagId)
    )
    if (targets.length === 0) return

    const targetIds = targets.map((message) => message.id)
    const previousTagIdsByMessageId = new Map(
      targets.map((message) => [message.id, message.user_tag_ids])
    )
    const targetIdSet = new Set(targetIds)
    const applyChange = <T extends { id: string; user_tag_ids: string[] }>(
      list: T[],
      resolveNextTagIds: (message: T) => string[]
    ) =>
      list.map((message) => {
        if (!targetIdSet.has(message.id)) return message
        return { ...message, user_tag_ids: resolveNextTagIds(message) }
      })

    // Applied locally before the requests resolve so the fade/reflow animation starts immediately
    // instead of waiting on network latency.
    setThreadMessages((prev) =>
      applyChange(prev, (message) =>
        isRemoval
          ? message.user_tag_ids.filter((id) => id !== tagId)
          : Array.from(new Set([...message.user_tag_ids, tagId]))
      )
    )
    setMessages((prev) =>
      applyChange(prev, (message) =>
        isRemoval
          ? message.user_tag_ids.filter((id) => id !== tagId)
          : Array.from(new Set([...message.user_tag_ids, tagId]))
      )
    )
    if (isRemoval) {
      scheduleTagFadeOut(targetIds, tagId)
    }

    setTagsSaving(true)
    setError(null)
    try {
      await Promise.all(
        targets.map((message) => {
          const nextTagIds = isRemoval
            ? message.user_tag_ids.filter((id) => id !== tagId)
            : [...message.user_tag_ids, tagId]
          return apiClient.post(`/api/mailbox/messages/${message.id}/tags`, {
            tag_ids: nextTagIds,
          })
        })
      )
      invalidateThreadCacheForMessages(targetIds)
    } catch (err) {
      setError(apiErrorMessage(err))
      setThreadMessages((prev) =>
        applyChange(prev, (message) => previousTagIdsByMessageId.get(message.id) ?? message.user_tag_ids)
      )
      setMessages((prev) =>
        applyChange(prev, (message) => previousTagIdsByMessageId.get(message.id) ?? message.user_tag_ids)
      )
    } finally {
      setTagsSaving(false)
    }
  }

  useEffect(() => {
    if (!isTagPickerOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      const popover = document.getElementById('mailbox-tag-picker')
      if (popover && target && popover.contains(target)) return
      closeTagPicker()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeTagPicker()
      }
    }

    const handleScroll = (event: Event) => {
      const target = event.target as Node | null
      const popover = document.getElementById('mailbox-tag-picker')
      // Scrolling the tag list itself must not close the popover -- only close on scroll elsewhere.
      if (popover && target && popover.contains(target)) return
      closeTagPicker()
    }

    const handleWindowBlur = () => {
      // Trusted HTML in the Thread Viewer renders inside a sandboxed iframe (separate document), so
      // clicks there never reach the outer window's mousedown listener above. Focus moving into that
      // iframe fires a window blur instead -- treat it the same as an outside click.
      if (document.activeElement instanceof HTMLIFrameElement) {
        closeTagPicker()
      }
    }

    window.addEventListener('mousedown', handlePointerDown, true)
    window.addEventListener('contextmenu', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleScroll)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      window.removeEventListener('mousedown', handlePointerDown, true)
      window.removeEventListener('contextmenu', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleScroll)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [closeTagPicker, isTagPickerOpen])

  useEffect(() => {
    mailboxMountedRef.current = true
    void loadInitial()
    return () => { mailboxMountedRef.current = false }
    // Runs once on mount only -- loadInitial's identity changes as filters change, which must not re-trigger the full workspace reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cross-navigation cache write-through: keeps the last known accounts/messages
  // available in-memory so a return visit to /mailbox can paint instantly.
  useEffect(() => {
    setSessionCacheValue(mailboxAccountsCacheKey, accounts)
  }, [accounts, mailboxAccountsCacheKey])

  useEffect(() => {
    try {
      window.localStorage.setItem(
        mailboxAccountSettingsExpansionKey,
        JSON.stringify({ expandedAccountIds, sections: expandedAccountSettings })
      )
    } catch {
      // Expansion state remains available for the current view when storage is unavailable.
    }
  }, [expandedAccountIds, expandedAccountSettings, mailboxAccountSettingsExpansionKey])

  useEffect(() => {
    setSessionCacheValue(mailboxMessagesCacheKey, messages)
  }, [messages, mailboxMessagesCacheKey])

  useEffect(() => {
    if (!mailboxTagsLoaded) return
    setSessionCacheValue(mailboxTagsCacheKey, mailboxTags)
  }, [mailboxTags, mailboxTagsCacheKey, mailboxTagsLoaded])

  useEffect(() => {
    const oauthSuccess = searchParams.get('oauth_success')
    const oauthError = searchParams.get('oauth_error')
    if (!oauthSuccess && !oauthError) return

    if (oauthSuccess === 'true') {
      setOauthNotice({ type: 'success', message: '__history_prompt__' })
      setError(null)
      void loadAccounts()
    }

    if (oauthError) {
      setOauthNotice({
        type: 'error',
        message: `OAuth connection failed: ${oauthError}`,
      })
      setError(null)
    }

    const next = new URLSearchParams(searchParams)
    next.delete('oauth_success')
    next.delete('oauth_error')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams, loadAccounts, loadMessages])

  useEffect(() => {
    const nextCommittedQuery = queryInput.trim().toLowerCase()
    if (nextCommittedQuery === committedQuery) {
      setIsSearchComputing(false)
      return
    }

    setIsSearchComputing(nextCommittedQuery.length > 0)
    const timer = setTimeout(() => {
      setCommittedQuery(nextCommittedQuery)
      setIsSearchComputing(false)
    }, 2000)

    return () => clearTimeout(timer)
  }, [queryInput, committedQuery])

  const handleConnectAccount = async () => {
    setError(null)
    try {
      await apiClient.post('/api/mailbox/accounts', {
        ...accountForm,
        display_name: accountForm.display_name.trim() || accountForm.address.trim(),
      })
      setAccountForm({ ...defaultAccountForm })
      setInboxLoadLimit(MESSAGE_LOAD_DEFAULT)
      await Promise.all([loadAccounts(), loadMessages(MESSAGE_LOAD_DEFAULT)])
    } catch (err) {
      setError(apiErrorMessage(err))
    }
  }

  const handleConnectOAuth = async (
    provider: 'gmail' | 'outlook',
    identityGroup = accountForm.identity_group || 'personal'
  ) => {
    setError(null)
    try {
      const { data } = await apiClient.get(`/api/mailbox/oauth/${provider}/auth-url`, {
        params: { identity_group: identityGroup },
        withCredentials: true,
      })
      const authUrl = typeof data?.authUrl === 'string' ? data.authUrl : ''
      if (!authUrl) {
        throw new Error('OAuth URL was not returned by the server')
      }
      window.location.assign(authUrl)
    } catch (err) {
      setError(apiErrorMessage(err))
    }
  }

  const handleReconnectAccount = (account: MailAccount) => {
    if (account.provider === 'imap') {
      setTabInUrl('settings', 'accounts')
      setShowConnectedCard(true)
      return
    }

    void handleConnectOAuth(account.provider, account.identity_group)
  }

  const handleSyncAccount = async (accountId: string, resetCursor = false) => {
    setError(null)
    setSyncingAccountId(accountId)

    const config = getImportConfig(accountId)
    syncPctFloorRef.current[accountId] = 0
    setSyncProgressByAccountId((prev) => ({
      ...prev,
      [accountId]: {
        startedAtMs: Date.now(),
        expectedSeconds: estimateSyncDurationSeconds(config),
        source: 'local',
        phase: 'preparing',
        completedAtMs: null,
      },
    }))

    try {
      const { data } = await apiClient.post(
        `/api/mailbox/accounts/${accountId}/sync`,
        {
          max_messages: config.maxMessages,
          days_back: config.daysBack,
          include_inbox: config.includeInbox,
          include_sent: config.includeSent,
          include_trash: config.includeTrash,
          include_spam: config.includeSpam,
          include_archived: config.includeArchived,
          reset_cursor: resetCursor,
        },
        { timeout: syncRequestTimeoutMs(estimateSyncDurationSeconds(config)) }
      )

      if (data?.success !== true) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Mailbox sync failed')
      }

      const serverLastSyncedAt =
        typeof data?.last_synced_at === 'string' ? data.last_synced_at : new Date().toISOString()
      setAccounts((prev) =>
        prev.map((account) =>
          account.id === accountId
            ? {
                ...account,
                status: 'connected',
                last_synced_at: serverLastSyncedAt,
                sync_error: null,
              }
            : account
        )
      )

      setSyncProgressByAccountId((prev) => {
        const tracker = prev[accountId]
        if (!tracker) return prev
        return {
          ...prev,
          [accountId]: { ...tracker, phase: 'finalizing', completedAtMs: Date.now() },
        }
      })

      await Promise.all([loadAccounts(), loadMessages(inboxLoadLimit)])

      setSyncProgressByAccountId((prev) => {
        const tracker = prev[accountId]
        if (!tracker) return prev
        return {
          ...prev,
          [accountId]: { ...tracker, phase: 'complete', completedAtMs: Date.now() },
        }
      })

      setOauthNotice({
        type: 'success',
        message: 'Import complete. New emails arriving automatically every 10 minutes.',
      })
      // auto-open analytics and pulse the button
      setShowAnalytics(true)
      setAnalyticsHighlight(true)
      setTimeout(() => setAnalyticsHighlight(false), 3000)
      void loadAnalytics()
    } catch (err) {
      setError(apiErrorMessage(err))
      setSyncProgressByAccountId((prev) => {
        if (!prev[accountId]) return prev
        const { [accountId]: _removed, ...rest } = prev
        return rest
      })
      delete syncPctFloorRef.current[accountId]
    } finally {
      setSyncingAccountId(null)
    }
  }

  // `silent` is used by the automatic on-open check: it still shows the inbox "Checking for new
  // mail" indicator, but must not raise the success toast or the page-level error banner.
  const fetchNewMail = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent === true
      if (newMailCheckInFlightRef.current) return
      const targetAccounts = accounts.filter((account) => account.status !== 'disconnected')
      if (targetAccounts.length === 0) return

      newMailCheckInFlightRef.current = true
      if (!silent) setError(null)
      setIsCheckingNewMail(true)
      const startedAtMs = Date.now()
      setSyncingAccountId(targetAccounts[0].id)
      setSyncProgressByAccountId((prev) => {
        const next = { ...prev }
        for (const account of targetAccounts) {
          syncPctFloorRef.current[account.id] = 0
          next[account.id] = {
            startedAtMs,
            expectedSeconds: 20,
            source: 'local',
            phase: 'preparing',
            completedAtMs: null,
          }
        }
        return next
      })

      try {
        const results = await Promise.allSettled(
          targetAccounts.map(async (account) => {
            setSyncProgressByAccountId((prev) => ({
              ...prev,
              [account.id]: {
                ...(prev[account.id] || {
                  startedAtMs,
                  expectedSeconds: 20,
                  source: 'local' as const,
                  phase: 'preparing' as const,
                  completedAtMs: null,
                }),
                phase: 'importing',
              },
            }))

            const { data } = await apiClient.post(
              `/api/mailbox/accounts/${account.id}/sync`,
              { new_mail_only: true },
              { timeout: syncRequestTimeoutMs(20) }
            )

            if (data?.success !== true) {
              throw new Error(
                typeof data?.error === 'string' ? data.error : 'New mail fetch failed'
              )
            }

            setSyncProgressByAccountId((prev) => {
              const tracker = prev[account.id]
              if (!tracker) return prev
              return {
                ...prev,
                [account.id]: { ...tracker, phase: 'complete', completedAtMs: Date.now() },
              }
            })

            return Number(data?.new_message_count || 0)
          })
        )

        const failures = results.flatMap((result, index) => result.status === 'rejected'
          ? [`${targetAccounts[index].address}: ${apiErrorMessage(result.reason)}`]
          : [])

        const newMessageCount = results.reduce(
          (sum, result) => sum + (result.status === 'fulfilled' ? result.value : 0),
          0
        )

        if (!mailboxMountedRef.current) return
        await Promise.all([loadAccounts(), loadMessages(inboxLoadLimitRef.current)])
        if (failures.length > 0) {
          throw new Error(`Quick Sync completed for ${results.length - failures.length} of ${results.length} accounts. ${failures.join('; ')}`)
        }
        if (!silent) {
          setOauthNotice({
            type: 'success',
            message:
              newMessageCount > 0
                ? `Fetched ${newMessageCount} new email${newMessageCount === 1 ? '' : 's'}.`
                : 'No new emails found.',
          })
        }
      } catch (err) {
        if (silent) console.warn('[MailboxPage] Automatic new mail check failed:', err)
        else setError(apiErrorMessage(err))
        setSyncProgressByAccountId((prev) => {
          const next = { ...prev }
          for (const account of targetAccounts) delete next[account.id]
          return next
        })
        for (const account of targetAccounts) delete syncPctFloorRef.current[account.id]
      } finally {
        newMailCheckInFlightRef.current = false
        // Recorded even on failure so a persistently failing provider cannot make every visit retry.
        writeDeviceNewMailCheckAt(deviceNewMailCheckStorageKey, Date.now())
        setSyncingAccountId(null)
        setIsCheckingNewMail(false)
      }
    },
    [accounts, deviceNewMailCheckStorageKey, loadAccounts, loadMessages]
  )

  const handleFetchNewMail = useCallback(() => {
    const now = Date.now()
    let recentAttempts: number[] = []
    try {
      const stored: unknown = JSON.parse(
        window.localStorage.getItem(manualQuickSyncAttemptsStorageKey) || '[]'
      )
      if (Array.isArray(stored)) {
        recentAttempts = stored.filter(
          (value): value is number =>
            typeof value === 'number' &&
            now - value < MAILBOX_MANUAL_QUICK_SYNC_GUIDANCE_WINDOW_MS
        )
      }
      recentAttempts.push(now)
      window.localStorage.setItem(
        manualQuickSyncAttemptsStorageKey,
        JSON.stringify(recentAttempts.slice(-2))
      )
    } catch {
      recentAttempts = [now]
    }

    if (recentAttempts.length >= 2) {
      setQuickSyncGuidanceAccountIds(
        accounts
          .filter(
            (account) =>
              account.status !== 'disconnected' &&
              normalizeAccountQuickSyncConfig(account.sync_options).includeInbox === false
          )
          .map((account) => account.id)
      )
    }

    void fetchNewMail()
  }, [accounts, fetchNewMail, manualQuickSyncAttemptsStorageKey])

  // The inbox paints from the indexed copy first; only then does this device ask the providers for
  // anything that arrived since IT last checked. The per-device watermark matters: syncing from a
  // phone advances the server-side account.last_synced_at, which previously made a desktop visit
  // look up to date and skip the check entirely.
  const autoNewMailCheckDoneRef = useRef(false)
  useEffect(() => {
    if (autoNewMailCheckDoneRef.current) return
    if (isLoading || !hasConnectedAccounts || hasBackgroundSync) return

    autoNewMailCheckDoneRef.current = true
    const lastCheckedAtMs = readDeviceNewMailCheckAt(deviceNewMailCheckStorageKey)
    if (
      lastCheckedAtMs !== null &&
      Date.now() - lastCheckedAtMs < MAILBOX_DEVICE_CHECK_MIN_INTERVAL_MS
    ) {
      return
    }

    void fetchNewMail({ silent: true })
  }, [
    deviceNewMailCheckStorageKey,
    fetchNewMail,
    hasBackgroundSync,
    hasConnectedAccounts,
    isLoading,
  ])

  useEffect(() => {
    if (!hasBackgroundSync) return

    let inFlight = false
    const timer = setInterval(() => {
      if (inFlight || document.visibilityState !== 'visible') return
      inFlight = true
      void Promise.all([loadAccounts(), loadMessages(inboxLoadLimit)])
        .catch((err) => console.warn('[MailboxPage] Sync progress refresh failed:', apiErrorMessage(err)))
        .finally(() => { inFlight = false })
    }, 5000)

    return () => clearInterval(timer)
  }, [hasBackgroundSync, inboxLoadLimit, loadAccounts, loadMessages])

  // Server-side auto-sync writes new rows without the page knowing. Without this the nav badge
  // would light up while the inbox list stayed stale until a manual browser refresh.
  useEffect(() => {
    if (!hasConnectedAccounts) return
    // The sync-in-progress poll above already refreshes every 5s; don't stack a second one.
    if (hasBackgroundSync) return

    let cancelled = false
    let inFlight = false
    const refresh = () => {
      if (cancelled || inFlight || document.visibilityState !== 'visible') return
      inFlight = true
      void Promise.all([loadAccounts(), loadMessages(inboxLoadLimitRef.current)])
        .catch((err) => console.warn('[MailboxPage] Inbox refresh failed:', apiErrorMessage(err)))
        .finally(() => {
          inFlight = false
        })
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh()
    }

    const timer = setInterval(refresh, MAILBOX_INBOX_REFRESH_INTERVAL_MS)
    window.addEventListener(MAILBOX_REMOTE_NEW_MAIL_EVENT, refresh)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener(MAILBOX_REMOTE_NEW_MAIL_EVENT, refresh)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [hasBackgroundSync, hasConnectedAccounts, loadAccounts, loadMessages])

  const handleResetCursorAndSync = async (accountId: string) => {
    setError(null)
    try {
      await apiClient.post(`/api/mailbox/accounts/${accountId}/reset-cursor`)
      // Now sync with the reset cursor
      await handleSyncAccount(accountId, false)
    } catch (err) {
      setError(apiErrorMessage(err))
    }
  }

  const handleRetrySync = async (accountId: string, account: MailAccount) => {
    setError(null)
    // If the error is about missing recent emails or cursor issues, offer to reset cursor
    const isCursorError = account.sync_error && /cursor|token|sync/i.test(account.sync_error)
    if (isCursorError) {
      await handleResetCursorAndSync(accountId)
    } else {
      await handleSyncAccount(accountId, false)
    }
  }

  const openMessageActivityLog = async (message: Pick<MailMessage, 'id' | 'subject'>) => {
    setMessageActivityLog({ message, activity: null, loading: true })
    try {
      const { data } = await apiClient.get(`/api/mailbox/messages/${message.id}/activity`)
      const activity: MailActivityLog = {
        arrived_at: typeof data?.arrived_at === 'string' ? data.arrived_at : null,
        system_tags: Array.isArray(data?.system_tags)
          ? data.system_tags.filter((tag: unknown): tag is string => typeof tag === 'string')
          : [],
        events: Array.isArray(data?.events) ? data.events as MailActivityEvent[] : [],
      }
      setMessageActivityLog({ message, activity, loading: false })
    } catch (err) {
      setError(apiErrorMessage(err))
      setMessageActivityLog(null)
    }
  }

  const handlePrimaryAccount = async (account: MailAccount) => {
    setError(null)
    setUpdatingPrimaryAccountId(account.id)
    try {
      await apiClient.put(`/api/mailbox/accounts/${account.id}/primary`, {
        is_primary: !account.is_primary,
      })
      await loadAccounts()
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setUpdatingPrimaryAccountId(null)
    }
  }

  const updateQuickSyncMaxMessages = async (accountId: string, maxMessages: number) => {
    setError(null)
    try {
      await apiClient.put(`/api/mailbox/accounts/${accountId}`, {
        quick_sync_max_messages: maxMessages,
      })
      setAccounts((prev) => prev.map((account) => (
        account.id === accountId ? { ...account, quick_sync_max_messages: maxMessages } : account
      )))
    } catch (err) {
      setError(apiErrorMessage(err))
    }
  }

  const updateQuickSyncSource = async (
    accountId: string,
    key: keyof AccountQuickSyncConfig,
    value: boolean
  ) => {
    const apiKeys: Record<keyof AccountQuickSyncConfig, string> = {
      includeInbox: 'quick_sync_include_inbox',
      includeSent: 'quick_sync_include_sent',
      includeTrash: 'quick_sync_include_trash',
      includeSpam: 'quick_sync_include_spam',
      includeArchived: 'quick_sync_include_archived',
    }
    const optionKeys: Record<keyof AccountQuickSyncConfig, keyof AccountSyncOptions> = {
      includeInbox: 'quickSyncIncludeInbox',
      includeSent: 'quickSyncIncludeSent',
      includeTrash: 'quickSyncIncludeTrash',
      includeSpam: 'quickSyncIncludeSpam',
      includeArchived: 'quickSyncIncludeArchived',
    }
    const account = accounts.find((item) => item.id === accountId)
    if (!account) return

    const previousValue = normalizeAccountQuickSyncConfig(account.sync_options)[key]
    const requestKey = `${accountId}:${key}`
    const requestSequence = (quickSyncSourceSaveSequenceRef.current[requestKey] || 0) + 1
    quickSyncSourceSaveSequenceRef.current[requestKey] = requestSequence

    const setSourceValue = (nextValue: boolean) => {
      setAccounts((prev) => prev.map((item) => (
        item.id === accountId
          ? {
              ...item,
              sync_options: {
                ...(item.sync_options || {}),
                [optionKeys[key]]: nextValue,
              },
            }
          : item
      )))
    }

    setError(null)
    setSourceValue(value)
    try {
      await apiClient.put(`/api/mailbox/accounts/${accountId}`, { [apiKeys[key]]: value })
    } catch (err) {
      if (quickSyncSourceSaveSequenceRef.current[requestKey] === requestSequence) {
        setSourceValue(previousValue)
      }
      setError(apiErrorMessage(err))
    }
  }

  const updateImportSource = async (
    accountId: string,
    key: keyof AccountQuickSyncConfig,
    value: boolean
  ) => {
    const apiKeys: Record<keyof AccountQuickSyncConfig, string> = {
      includeInbox: 'include_inbox',
      includeSent: 'include_sent',
      includeTrash: 'include_trash',
      includeSpam: 'include_spam',
      includeArchived: 'include_archived',
    }
    const previousValue = getImportConfig(accountId)[key]
    const requestKey = `${accountId}:${key}`
    const requestSequence = (importSourceSaveSequenceRef.current[requestKey] || 0) + 1
    importSourceSaveSequenceRef.current[requestKey] = requestSequence

    setError(null)
    setImportConfig(accountId, { [key]: value })
    try {
      await apiClient.put(`/api/mailbox/accounts/${accountId}`, { [apiKeys[key]]: value })
      setAccounts((prev) => prev.map((account) => (
        account.id === accountId
          ? {
              ...account,
              sync_options: { ...(account.sync_options || {}), [key]: value },
            }
          : account
      )))
    } catch (err) {
      if (importSourceSaveSequenceRef.current[requestKey] === requestSequence) {
        setImportConfig(accountId, { [key]: previousValue })
      }
      setError(apiErrorMessage(err))
    }
  }

  const markThreadMessagesRead = async (messagesToMark: ThreadMessage[]) => {
    const unreadIds = messagesToMark
      .filter((message) => !message.is_read)
      .map((message) => message.id)
    if (!unreadIds.length) return

    try {
      await Promise.all(
        unreadIds.map((id) => apiClient.post(`/api/mailbox/messages/${id}/read`, { is_read: true }))
      )
    } catch (err) {
      setError(apiErrorMessage(err))
      return
    }

    const unreadIdSet = new Set(unreadIds)
    setMessages((prev) =>
      prev.map((message) => (unreadIdSet.has(message.id) ? { ...message, is_read: true } : message))
    )
    setThreadMessages((prev) =>
      prev.map((message) => (unreadIdSet.has(message.id) ? { ...message, is_read: true } : message))
    )

    for (const [threadId, entry] of threadCacheRef.current) {
      if (!entry.messages.some((message) => unreadIdSet.has(message.id))) continue
      threadCacheRef.current.set(threadId, {
        ...entry,
        messages: entry.messages.map((message) =>
          unreadIdSet.has(message.id) ? { ...message, is_read: true } : message
        ),
      })
    }
  }

  const threadMessageIdsKey = useMemo(
    () => threadMessages.map((message) => message.id).join(','),
    [threadMessages]
  )

  useEffect(() => {
    const messageIds = threadMessageIdsKey ? threadMessageIdsKey.split(',') : []
    if (messageIds.length === 0) {
      setThreadAttachments([])
      setAttachmentsLoading(false)
      return
    }

    const readCached = () =>
      messageIds.flatMap((messageId) => attachmentCacheRef.current.get(messageId) || [])
    const missingIds = messageIds.filter(
      (messageId) => !messageId.startsWith('sent-draft:') && !attachmentCacheRef.current.has(messageId)
    )

    setThreadAttachments(readCached())
    if (missingIds.length === 0) {
      setAttachmentsLoading(false)
      return
    }

    let cancelled = false
    setAttachmentsLoading(true)

    const loadAttachments = async () => {
      await Promise.all(
        missingIds.map(async (messageId) => {
          try {
            const { data } = await apiClient.get(`/api/mailbox/messages/${messageId}/attachments`)
            const list: MailAttachmentSummary[] = Array.isArray(data?.attachments)
              ? data.attachments
              : []
            const seenAttachmentIds = new Set<string>()
            attachmentCacheRef.current.set(
              messageId,
              list
                .filter((item) => {
                  const key = `${item.id}::${item.filename}`
                  if (seenAttachmentIds.has(key)) return false
                  seenAttachmentIds.add(key)
                  return true
                })
                .map((item) => ({ ...item, message_id: messageId }))
            )
          } catch {
            // Leave the message uncached so the next open can retry.
          }
        })
      )

      if (cancelled) return
      setThreadAttachments(readCached())
      setAttachmentsLoading(false)
    }

    void loadAttachments()

    return () => {
      cancelled = true
    }
  }, [threadMessageIdsKey])

  const downloadAttachmentEntry = useCallback(async (attachment: ThreadAttachmentEntry) => {
    const { data } = await apiClient.get(
      `/api/mailbox/messages/${attachment.message_id}/attachments/${encodeURIComponent(attachment.id)}/download`,
      { responseType: 'blob' }
    )

    const objectUrl = URL.createObjectURL(data as Blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = attachment.filename || 'attachment'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(objectUrl)
  }, [])

  const handleDownloadAttachment = async (attachment: ThreadAttachmentEntry) => {
    setError(null)
    setDownloadingAttachmentKey(`${attachment.message_id}::${attachment.id}`)
    try {
      await downloadAttachmentEntry(attachment)
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setDownloadingAttachmentKey(null)
    }
  }

  const handleDownloadAllAttachments = async (attachments: ThreadAttachmentEntry[]) => {
    if (attachments.length === 0) return
    setError(null)
    setIsDownloadingAllAttachments(true)
    try {
      for (const attachment of attachments) {
        await downloadAttachmentEntry(attachment)
      }
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setIsDownloadingAllAttachments(false)
    }
  }

  const clearAttachmentHoverTimeout = useCallback(() => {
    if (attachmentHoverTimeoutRef.current !== null) {
      window.clearTimeout(attachmentHoverTimeoutRef.current)
      attachmentHoverTimeoutRef.current = null
    }
  }, [])

  const scheduleAttachmentPreview = useCallback(
    (attachment: ThreadAttachmentEntry) => {
      clearAttachmentHoverTimeout()
      if (!attachment.mime_type || !attachment.mime_type.startsWith('image/')) return
      const key = `${attachment.message_id}::${attachment.id}`
      attachmentHoverTimeoutRef.current = window.setTimeout(() => {
        const cachedUrl = attachmentPreviewCacheRef.current.get(key)
        if (cachedUrl) {
          setHoveredAttachmentPreview({ key, url: cachedUrl, loading: false, error: null })
          return
        }
        setHoveredAttachmentPreview({ key, url: null, loading: true, error: null })
        void (async () => {
          try {
            const { data } = await apiClient.get(
              `/api/mailbox/messages/${attachment.message_id}/attachments/${encodeURIComponent(attachment.id)}/download`,
              { responseType: 'blob' }
            )
            const objectUrl = URL.createObjectURL(data as Blob)
            attachmentPreviewCacheRef.current.set(key, objectUrl)
            setHoveredAttachmentPreview((prev) =>
              prev?.key === key ? { key, url: objectUrl, loading: false, error: null } : prev
            )
          } catch {
            setHoveredAttachmentPreview((prev) =>
              prev?.key === key ? { key, url: null, loading: false, error: 'Preview failed' } : prev
            )
          }
        })()
      }, MAILBOX_ATTACHMENT_PREVIEW_HOVER_MS)
    },
    [clearAttachmentHoverTimeout]
  )

  const cancelAttachmentPreview = useCallback(
    (key?: string) => {
      clearAttachmentHoverTimeout()
      setHoveredAttachmentPreview((prev) => (!key || prev?.key === key ? null : prev))
    },
    [clearAttachmentHoverTimeout]
  )

  useEffect(() => {
    const attachmentPreviewCache = attachmentPreviewCacheRef.current
    return () => {
      clearAttachmentHoverTimeout()
      for (const url of attachmentPreviewCache.values()) {
        URL.revokeObjectURL(url)
      }
      attachmentPreviewCache.clear()
    }
  }, [clearAttachmentHoverTimeout])


  const handleOpenThread = async (
    threadId: string | null,
    focusedMessageId: string | null = null
  ) => {
    if (!threadId) return
    const requestSeq = openThreadRequestSeqRef.current + 1
    openThreadRequestSeqRef.current = requestSeq
    selectedThreadIdRef.current = threadId
    setOpeningMailboxMessageId(null)

    setError(null)
    setInaccessibleThread(null)
    setExpandedSourceDetailsMessageIds(new Set())
    setActiveDraft(null)

    // A cached thread renders immediately; the request below only revalidates it.
    const cached = threadCacheRef.current.get(threadId)
    if (cached) {
      setSelectedThread(cached.thread)
      setThreadMessages(cached.messages)
      setCollapsedThreadMessageIds(
        getDefaultCollapsedThreadMessageIds(cached.messages, focusedMessageId)
      )
      selectThreadMessage(focusedMessageId, { availableMessages: cached.messages, includePreviousHeader: true })
      setSelectedThreadLoading(false)
      void markThreadMessagesRead(cached.messages)
    } else {
      setSelectedThreadLoading(true)
    }

    try {
      const readSeq = pendingTrashRef.current.beginRead()
      const { data } = await apiClient.get(`/api/mailbox/threads/${threadId}`)
      const normalizedThreadMessages = pendingTrashRef.current.apply(
        reconcileSentReplies(threadId, normalizeThreadMessages(data?.messages)),
        readSeq
      )
      pendingTrashRef.current.completeRead(readSeq)
      const isStale =
        requestSeq !== openThreadRequestSeqRef.current || selectedThreadIdRef.current !== threadId

      if (cached) {
        if (
          threadContentSignature(cached.messages) ===
          threadContentSignature(normalizedThreadMessages)
        )
          return

        // Locally applied read state is newer than this response, so it wins on merge.
        const readIds = new Set(
          cached.messages.filter((message) => message.is_read).map((message) => message.id)
        )
        const mergedMessages = normalizedThreadMessages.map((message) =>
          readIds.has(message.id) ? { ...message, is_read: true } : message
        )
        writeThreadCache(threadId, { thread: data.thread || null, messages: mergedMessages })
        syncInboxListFromThreadMessages(mergedMessages)
        if (isStale) return
        setSelectedThread(data.thread || null)
        setThreadMessages(mergedMessages)
        return
      }

      writeThreadCache(threadId, {
        thread: data.thread || null,
        messages: normalizedThreadMessages,
      })
      syncInboxListFromThreadMessages(normalizedThreadMessages)
      if (isStale) return

      setSelectedThread(data.thread || null)
      setThreadMessages(normalizedThreadMessages)
      setCollapsedThreadMessageIds(
        getDefaultCollapsedThreadMessageIds(normalizedThreadMessages, focusedMessageId)
      )
      selectThreadMessage(focusedMessageId, { availableMessages: normalizedThreadMessages, includePreviousHeader: true })
      void markThreadMessagesRead(normalizedThreadMessages)
    } catch (err) {
      if (requestSeq !== openThreadRequestSeqRef.current || cached) return
      setError(apiErrorMessage(err))
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 404) setInaccessibleThread({ threadId, messageId: focusedMessageId })
    } finally {
      if (requestSeq === openThreadRequestSeqRef.current) {
        setSelectedThreadLoading(false)
      }
    }
  }

  // Drops the local copy of a thread the server no longer has (its account was removed
  // elsewhere while this session still had it cached), instead of leaving a dead row behind.
  const handleCleanupInaccessibleThread = useCallback(() => {
    if (!inaccessibleThread) return
    const { threadId, messageId } = inaccessibleThread
    const isStaleMessage = (message: MailMessage) =>
      message.thread_id === threadId || (messageId != null && message.id === messageId)

    const remaining = messagesRef.current.filter((message) => !isStaleMessage(message))
    const removedCount = messagesRef.current.length - remaining.length
    messagesRef.current = remaining
    setMessages(remaining)
    setMessagesTotal((prev) => Math.max(0, prev - removedCount))

    threadCacheRef.current.delete(threadId)
    if (selectedThreadIdRef.current === threadId) {
      selectedThreadIdRef.current = null
      setSelectedThread(null)
      setThreadMessages([])
    }

    setInaccessibleThread(null)
    setError(null)
  }, [inaccessibleThread])

  const handleOpenThreadFromMessageId = async (messageId: string, refreshOnly = false) => {
    if (!refreshOnly && !selectedThreadLoading &&
      threadMessagesRef.current.some((message) => message.id === messageId)) {
      if (openingMailboxMessageId) {
        openThreadRequestSeqRef.current += 1
        setOpeningMailboxMessageId(null)
      }
      selectThreadMessage(messageId, { availableMessages: threadMessagesRef.current })
      if (isMobileMailboxLayout) setMobileMailboxScreen('thread')
      return
    }

    const requestSeq = openThreadRequestSeqRef.current + (refreshOnly ? 0 : 1)
    if (refreshOnly && threadRefreshInFlightRef.current === requestSeq) {
      threadRefreshQueuedRef.current = true
      return
    }
    if (refreshOnly) {
      threadRefreshInFlightRef.current = requestSeq
      threadRefreshQueuedRef.current = false
    } else {
      openThreadRequestSeqRef.current = requestSeq
      setOpeningMailboxMessageId(messageId)
      setError(null)
      // Keep usable content mounted until we know whether this is a different conversation.
      setSelectedThreadLoading(threadMessagesRef.current.length === 0)
    }
    const previousThreadId = selectedThreadIdRef.current
    try {
      const readSeq = pendingTrashRef.current.beginRead()
      const url = `/api/mailbox/messages/${messageId}/thread`
      const { data } = refreshOnly
        ? await dedupedGet<{ thread?: MailThread | null; messages?: unknown }>(url)
        : await apiClient.get<{ thread?: MailThread | null; messages?: unknown }>(url)
      pendingTrashRef.current.completeRead(readSeq)

      if (!mailboxMountedRef.current || requestSeq !== openThreadRequestSeqRef.current ||
        (refreshOnly && previousThreadId !== selectedThreadIdRef.current)) {
        return
      }

      const threadId = data.thread?.id
      const normalizedThreadMessages = pendingTrashRef.current.apply(
        reconcileSentReplies(typeof threadId === 'string' ? threadId : '', normalizeThreadMessages(data?.messages)),
        readSeq
      )
      const currentMessages = threadMessagesRef.current
      const currentById = new Map(currentMessages.map((message) => [message.id, message]))
      const isExistingConversation = currentMessages.length > 0 && (
        threadId === selectedThreadIdRef.current ||
        normalizedThreadMessages.some((message) => currentById.has(message.id))
      )
      if (refreshOnly && !isExistingConversation) {
        throw new Error('The open conversation changed. Open the email again to load its updated thread.')
      }
      if (isExistingConversation) {
        for (const message of normalizedThreadMessages) {
          const current = currentById.get(message.id)
          currentById.set(message.id, current?.is_read ? { ...message, is_read: true } : message)
        }
      }
      const nextMessages = isExistingConversation
        ? Array.from(currentById.values()).sort((left, right) =>
            (left.received_at || '').localeCompare(right.received_at || ''))
        : normalizedThreadMessages
      // Broad/custom groups can be opened through members with different provider thread IDs.
      const nextThreadId = isExistingConversation ? previousThreadId : threadId
      const nextThread = isExistingConversation ? selectedThread : data.thread || null
      if (nextThreadId) selectedThreadIdRef.current = nextThreadId
      setSelectedThread(nextThread)
      if (typeof threadId === 'string' && threadId) {
        writeThreadCache(nextThreadId || threadId, {
          thread: nextThread,
          messages: nextMessages,
        })
      }
      syncInboxListFromThreadMessages(normalizedThreadMessages)
      threadMessagesRef.current = nextMessages
      setThreadMessages(nextMessages)
      if (!isExistingConversation) {
        setInaccessibleThread(null)
        setExpandedSourceDetailsMessageIds(new Set())
        setActiveDraft(null)
        setCollapsedThreadMessageIds(getDefaultCollapsedThreadMessageIds(nextMessages, messageId))
      }
      if (!refreshOnly) {
        selectThreadMessage(messageId, {
          availableMessages: nextMessages,
          includePreviousHeader: !isExistingConversation,
        })
      }
      void markThreadMessagesRead(nextMessages)

      if (!refreshOnly && isMobileMailboxLayout) {
        setMobileMailboxScreen('thread')
      }
    } catch (err) {
      if (!mailboxMountedRef.current || requestSeq !== openThreadRequestSeqRef.current ||
        (refreshOnly && previousThreadId !== selectedThreadIdRef.current)) return
      setError(apiErrorMessage(err))
    } finally {
      if (refreshOnly && threadRefreshInFlightRef.current === requestSeq) {
        threadRefreshInFlightRef.current = null
        if (threadRefreshQueuedRef.current && mailboxMountedRef.current &&
          requestSeq === openThreadRequestSeqRef.current &&
          previousThreadId === selectedThreadIdRef.current) {
          void refreshOpenThreadRef.current(messageId, true)
        }
      }
      if (!refreshOnly && requestSeq === openThreadRequestSeqRef.current) {
        setSelectedThreadLoading(false)
        setOpeningMailboxMessageId(null)
      }
    }
  }

  const refreshOpenThreadRef = useRef(handleOpenThreadFromMessageId)
  refreshOpenThreadRef.current = handleOpenThreadFromMessageId
  useEffect(() => {
    if (!selectedThread) {
      observedThreadInboxRef.current = null
      return
    }
    if (selectedThreadLoading) return
    const messageIds = new Set(messages.map((message) => message.id))
    const previous = observedThreadInboxRef.current
    observedThreadInboxRef.current = { threadId: selectedThread.id, messageIds }
    if (!previous || previous.threadId !== selectedThread.id) return
    const loadedIds = new Set(threadMessagesRef.current.map((message) => message.id))
    const hasNewMessages = messages.some((message) =>
      !message.is_draft && !previous.messageIds.has(message.id) && !loadedIds.has(message.id))
    const anchor = threadMessagesRef.current.find((message) => !message.id.startsWith('sent-draft:'))
    // Re-query through a loaded member so server-side custom grouping remains authoritative.
    if (hasNewMessages && anchor) void refreshOpenThreadRef.current(anchor.id, true)
  }, [messages, selectedThread, selectedThreadLoading])

  const handleOpenThreadFromInbox = async (message: MailMessage) => {
    if (message.is_draft) {
      const record = drafts.find((entry) => entry.id === message.draft_id)
      if (record) {
        // The thread must load first: opening a thread clears any active draft.
        if (record.thread_id) {
          const requestSeq = openThreadRequestSeqRef.current + 1
          await handleOpenThread(record.thread_id, record.in_reply_to_message_id)
          if (requestSeq !== openThreadRequestSeqRef.current) return
        }
        openSavedDraft(record)
        if (isMobileMailboxLayout) setMobileMailboxScreen('thread')
      }
      return
    }

    await handleOpenThreadFromMessageId(message.id)
  }

  const handleOpenThreadFromInboxRef = useRef(handleOpenThreadFromInbox)
  handleOpenThreadFromInboxRef.current = handleOpenThreadFromInbox

  const handleMarkRead = async (messageId: string, isRead: boolean) => {
    setError(null)
    try {
      await apiClient.post(`/api/mailbox/messages/${messageId}/read`, { is_read: isRead })
      invalidateThreadCacheForMessages([messageId])
      setMessages((prev) =>
        prev.map((message) =>
          message.id === messageId ? { ...message, is_read: isRead } : message
        )
      )
      setThreadMessages((prev) =>
        prev.map((message) =>
          message.id === messageId ? { ...message, is_read: isRead } : message
        )
      )
      void loadMessages(inboxLoadLimitRef.current)
    } catch (err) {
      setError(apiErrorMessage(err))
    }
  }

  const handleArchive = async (messageId: string, isArchived: boolean) => {
    setError(null)
    try {
      await apiClient.post(`/api/mailbox/messages/${messageId}/archive`, {
        is_archived: isArchived,
      })
      invalidateThreadCacheForMessages([messageId])
      setMessages((prev) =>
        prev.map((message) =>
          message.id === messageId ? { ...message, is_archived: isArchived } : message
        )
      )
      setThreadMessages((prev) =>
        prev.map((message) =>
          message.id === messageId ? { ...message, is_archived: isArchived } : message
        )
      )
      void loadMessages(inboxLoadLimitRef.current)
    } catch (err) {
      setError(apiErrorMessage(err))
    }
  }

  const handleRemoveLocalMessage = async (messageId: string) => {
    setError(null)

    // The row leaves the list before the request resolves; a failure restores it via the reload below.
    await playMessageRemovalAnimation([messageId])
    invalidateThreadCacheForMessages([messageId])
    setMessages((prev) => prev.filter((message) => message.id !== messageId))
    setThreadMessages((prev) => prev.filter((message) => message.id !== messageId))
    clearMessageRemovalAnimation([messageId])
    selectTopThreadAfterTrashRef.current = true

    try {
      await apiClient.delete(`/api/mailbox/messages/${messageId}/local`)
      void loadMessages(inboxLoadLimitRef.current)
    } catch (err) {
      setError(apiErrorMessage(err))
      void loadMessages(inboxLoadLimitRef.current)
    }
  }

  const selectedThreadUntrashedCount = useMemo(
    () => threadMessages.filter((message) => !message.is_provider_trashed).length,
    [threadMessages]
  )

  const selectedThreadTrashedCount = useMemo(
    () => threadMessages.filter((message) => message.is_provider_trashed).length,
    [threadMessages]
  )

  const requestConfirm = (
    prompt: MailboxConfirmPrompt,
    // Kept so call sites stay unchanged; the confirm is a centered dialog now
    // and Dialog returns focus to the trigger on close.
    _event: React.MouseEvent<HTMLButtonElement>
  ) => {
    if (suppressedConfirmKeys.includes(prompt.key)) {
      prompt.run()
      return
    }

    setConfirmSuppressDraft(false)
    setConfirmPrompt(prompt)
  }

  const resolveConfirmPrompt = () => {
    if (!confirmPrompt) return

    if (confirmSuppressDraft) {
      const nextKeys = Array.from(new Set([...suppressedConfirmKeys, confirmPrompt.key]))
      setSuppressedConfirmKeys(nextKeys)
      try {
        localStorage.setItem(suppressedConfirmsStorageKey, JSON.stringify(nextKeys))
      } catch {
        // Suppression preference is best-effort; the action still runs.
      }
    }

    const run = confirmPrompt.run
    setConfirmPrompt(null)
    run()
  }

  const restoreSuppressedConfirms = () => {
    setSuppressedConfirmKeys([])
    try {
      localStorage.removeItem(suppressedConfirmsStorageKey)
    } catch {
      // Suppression preference is best-effort.
    }
  }

  const restoreSuppressedConfirm = (key: MailboxConfirmKey) => {
    const nextKeys = suppressedConfirmKeys.filter((suppressedKey) => suppressedKey !== key)
    setSuppressedConfirmKeys(nextKeys)
    try {
      if (nextKeys.length === 0) {
        localStorage.removeItem(suppressedConfirmsStorageKey)
      } else {
        localStorage.setItem(suppressedConfirmsStorageKey, JSON.stringify(nextKeys))
      }
    } catch {
      // Suppression preference is best-effort.
    }
  }

  const handleRemoveAccount = async (accountId: string) => {
    setError(null)
    setRemovingAccountId(accountId)
    // The row disappears immediately; a failed request restores it from the reload below.
    setAccounts((prev) => prev.filter((account) => account.id !== accountId))
    setExcludedAccountIds((prev) => prev.filter((id) => id !== accountId))
    setExpandedAccountIds((prev) => prev.filter((id) => id !== accountId))

    try {
      await apiClient.delete(`/api/mailbox/accounts/${accountId}`)
      clearThreadCache()
      setSelectedThread(null)
      setThreadMessages([])
      selectedThreadIdRef.current = null
      setActiveDraft(null)
      // loadMessages merges by id rather than replacing wholesale (see its comment), so this
      // removed account's messages must be pruned from local state explicitly -- otherwise
      // they'd keep showing up even though the account/its data no longer exist on the server.
      const pruned = messagesRef.current.filter((message) => message.account_id !== accountId)
      messagesRef.current = pruned
      setMessages(pruned)
      await Promise.all([loadAccounts(), loadMessages(inboxLoadLimitRef.current)])
    } catch (err) {
      setError(apiErrorMessage(err))
      await loadAccounts()
    } finally {
      setRemovingAccountId(null)
    }
  }

  const requestRemoveAccount = (
    account: MailAccount,
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    setAccountRemovalPreview(null)
    requestConfirm(
      {
        key: 'remove-account',
        title: 'Remove this account?',
        message: `${account.address} is disconnected from this mailbox and everything imported from it is deleted here. Nothing is deleted at ${account.provider.toUpperCase()}.`,
        details: [
          `Deleted here: stored access tokens, imported emails, threads, folders, labels, drafts, and sync history for ${account.address}`,
          'Kept: your mailbox tags, automation rules, and mailbox preferences',
          'This cannot be undone -- reconnecting the account requires a fresh import',
        ],
        confirmLabel: 'Remove Account',
        run: () => void handleRemoveAccount(account.id),
      },
      event
    )

    void apiClient
      .get(`/api/mailbox/accounts/${account.id}/removal-preview`)
      .then(({ data }) => {
        setAccountRemovalPreview({
          accountId: account.id,
          messages: Number(data?.messages) || 0,
          threads: Number(data?.threads) || 0,
          drafts: Number(data?.drafts) || 0,
        })
      })
      .catch(() => {
        // The counts are informational only; the prompt still explains what is removed.
      })
  }

  const trashMessagesByIds = async (messageIds: string[]) => {
    if (!messageIds.length) return

    setError(null)
    const trashedIds = new Set(messageIds)
    pendingTrashRef.current.register(messageIds, true)
    for (const id of messageIds) sessionTrashedIdsRef.current.add(id)

    // Optimistic: the rows animate out and the next thread opens before the provider round-trip finishes.
    await playMessageRemovalAnimation(messageIds)
    invalidateThreadCacheForMessages(messageIds)
    // Update the ref eagerly: React 19 defers updater functions to render, and loadMessages merges
    // into messagesRef right away, so a ref write inside the updater would be read stale.
    const trashedNext = messagesRef.current.map((item) =>
      trashedIds.has(item.id) ? { ...item, is_provider_trashed: true } : item
    )
    messagesRef.current = trashedNext
    setMessages(trashedNext)
    setThreadMessages((prev) =>
      prev.map((item) => (trashedIds.has(item.id) ? { ...item, is_provider_trashed: true } : item))
    )
    if (isMobileMailboxLayout && threadMessages.some((item) => trashedIds.has(item.id))) {
      returnToMobileMailboxList()
    }
    clearMessageRemovalAnimation(messageIds)
    selectTopThreadAfterTrashRef.current = true

    try {
      const results = await Promise.allSettled(
        messageIds.map((id) => apiClient.post(`/api/mailbox/messages/${id}/trash`))
      )
      const failedIds = messageIds.filter((_, index) => results[index].status === 'rejected')
      pendingTrashRef.current.discard(failedIds)
      pendingTrashRef.current.settle(messageIds.filter((id) => !failedIds.includes(id)))
      if (failedIds.length > 0) {
        const firstFailure = results.find((result) => result.status === 'rejected') as PromiseRejectedResult
        setError(apiErrorMessage(firstFailure.reason))
        // Roll back only the ids that actually failed; the ones that succeeded stay trashed.
        const failedIdSet = new Set(failedIds)
        for (const id of failedIds) sessionTrashedIdsRef.current.delete(id)
        setMessages((prev) =>
          prev.map((item) =>
            failedIdSet.has(item.id) ? { ...item, is_provider_trashed: false } : item
          )
        )
        setThreadMessages((prev) =>
          prev.map((item) =>
            failedIdSet.has(item.id) ? { ...item, is_provider_trashed: false } : item
          )
        )
      }
      void loadMessages(inboxLoadLimitRef.current)
    } catch (err) {
      setError(apiErrorMessage(err))
      pendingTrashRef.current.discard(messageIds)
      for (const id of messageIds) sessionTrashedIdsRef.current.delete(id)
      // Roll the optimistic flag back; the reload then re-applies whatever the server actually stored.
      setMessages((prev) =>
        prev.map((item) =>
          trashedIds.has(item.id) ? { ...item, is_provider_trashed: false } : item
        )
      )
      setThreadMessages((prev) =>
        prev.map((item) =>
          trashedIds.has(item.id) ? { ...item, is_provider_trashed: false } : item
        )
      )
      void loadMessages(inboxLoadLimitRef.current)
    }
  }

  const restoreMessagesByIds = async (messageIds: string[]) => {
    if (!messageIds.length) return

    setError(null)
    const restoredIds = new Set(messageIds)
    const setTrashedFlag = (ids: Set<string>, trashed: boolean) => {
      // Eager ref write, same reason as in trashMessagesByIds.
      const next = messagesRef.current.map((item) =>
        ids.has(item.id) ? { ...item, is_provider_trashed: trashed } : item
      )
      messagesRef.current = next
      setMessages(next)
      setThreadMessages((prev) =>
        prev.map((item) => (ids.has(item.id) ? { ...item, is_provider_trashed: trashed } : item))
      )
    }

    // Optimistic: the TRASH badge and restore button flip immediately; the provider call follows.
    // The pin keeps reads that start before the untrash lands from re-applying the old flag.
    pendingTrashRef.current.register(messageIds, false)
    for (const id of messageIds) sessionTrashedIdsRef.current.delete(id)
    invalidateThreadCacheForMessages(messageIds)
    setTrashedFlag(restoredIds, false)

    const results = await Promise.allSettled(
      messageIds.map((id) => apiClient.post(`/api/mailbox/messages/${id}/untrash`))
    )
    const failedIds = messageIds.filter((_, index) => results[index].status === 'rejected')
    pendingTrashRef.current.discard(failedIds)
    pendingTrashRef.current.settle(messageIds.filter((id) => !failedIds.includes(id)))
    if (failedIds.length > 0) {
      const firstFailure = results.find((result) => result.status === 'rejected') as PromiseRejectedResult
      setError(apiErrorMessage(firstFailure.reason))
      setTrashedFlag(new Set(failedIds), true)
    }
    void loadMessages(inboxLoadLimitRef.current)
  }

  const handleRestoreMessage = (messageId: string) => {
    void restoreMessagesByIds([messageId])
  }

  const handleTrashMessage = (message: MailMessage, event: React.MouseEvent<HTMLButtonElement>) => {
    setError(null)

    if (message.is_provider_trashed) {
      requestConfirm(
        {
          key: 'remove-local-copy',
          title: 'Remove local copy?',
          message:
            'This email is already in provider trash. Removing the local copy only clears it from this Mailbox view; it stays in your provider trash.',
          confirmLabel: 'Remove copy',
          suppressLabel: 'Do not ask again for local copies',
          run: () => void handleRemoveLocalMessage(message.id),
        },
        event
      )
      return
    }

    void trashMessagesByIds([message.id])
  }

  const trashSelectedThread = async () => {
    const messageIds = threadMessages
      .filter((message) => !message.is_provider_trashed)
      .map((message) => message.id)
    if (!messageIds.length) return

    setThreadTrashing(true)
    try {
      await trashMessagesByIds(messageIds)
    } finally {
      setThreadTrashing(false)
    }
  }

  const removeSelectedThreadLocalCopies = async () => {
    if (!threadMessages.length) return

    setError(null)
    setThreadTrashing(true)
    const messageIds = threadMessages.map((message) => message.id)
    const removedIds = new Set(messageIds)

    await playMessageRemovalAnimation(messageIds)
    invalidateThreadCacheForMessages(messageIds)
    setMessages((prev) => prev.filter((message) => !removedIds.has(message.id)))
    setThreadMessages([])
    setSelectedThread(null)
    selectedThreadIdRef.current = null
    setActiveDraft(null)
    if (isMobileMailboxLayout) setMobileMailboxScreen('list')
    clearMessageRemovalAnimation(messageIds)
    selectTopThreadAfterTrashRef.current = true

    try {
      await Promise.all(
        messageIds.map((id) => apiClient.delete(`/api/mailbox/messages/${id}/local`))
      )
      void loadMessages(inboxLoadLimitRef.current)
    } catch (err) {
      setError(apiErrorMessage(err))
      void loadMessages(inboxLoadLimitRef.current)
    } finally {
      setThreadTrashing(false)
    }
  }

  const requestSelectedThreadTrashAction = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!selectedThread || !threadMessages.length) return

    if (selectedThreadUntrashedCount === 0) {
      requestConfirm(
        {
          key: 'remove-thread-local-copies',
          title: 'Remove local copies?',
          message: `All ${threadMessages.length} email(s) in this thread are already in provider trash. Removing local copies only clears them from this Mailbox view.`,
          confirmLabel: 'Remove copies',
          suppressLabel: 'Do not ask again for local copies',
          run: () => void removeSelectedThreadLocalCopies(),
        },
        event
      )
      return
    }

    requestConfirm(
      {
        key: 'trash-thread',
        title: 'Move thread to trash?',
        message: `This moves all ${selectedThreadUntrashedCount} email(s) in this thread, including replies and same-subject emails, to your provider trash.`,
        confirmLabel: 'Move to trash',
        suppressLabel: 'Do not ask again for threads',
        run: () => void trashSelectedThread(),
      },
      event
    )
  }

  const restoreSelectedThread = async () => {
    const messageIds = threadMessages
      .filter((message) => message.is_provider_trashed)
      .map((message) => message.id)
    if (!messageIds.length) return

    setThreadTrashing(true)
    try {
      await restoreMessagesByIds(messageIds)
    } finally {
      setThreadTrashing(false)
    }
  }

  const openReplyDraft = (message: ThreadMessage) => {
    draftSuggestionSessionRef.current += 1
    setAiReplySuggestion(null)
    if (!selectedThread) return

    const accountId = selectedThread.account_id
    setDraftDetailsExpanded(true)
    setDraftReading(false)
    setDraftReadDetailsExpanded(false)
    setDraftError(null)
    setDraftNotice(null)
    setAiDraftInstruction('')
    setDraftRecipientsExpanded(false)
    setDraftVisibleFields(['to'])
    setActiveDraft({
      id: null,
      mode: 'reply',
      accountId,
      fromAddress: accounts.find((account) => account.id === accountId)?.address || '',
      threadId: selectedThread.id,
      inReplyToMessageId: message.id,
      to: extractEmailAddresses(message.reply_to || message.from_email),
      cc: [],
      bcc: [],
      subject: buildReplySubject(message.subject),
      body: '',
      attachments: [],
    })
  }

  const openForwardDraft = (message: ThreadMessage) => {
    draftSuggestionSessionRef.current += 1
    setAiReplySuggestion(null)
    if (!selectedThread) return

    const sender = formatSenderLine(message.from_name, message.from_email)
    const dateText = formatTimestamp(message.received_at, userDateFormat)
    const toRecipients = formatRecipientLine(message.to_emails) || 'Unknown recipients'
    const ccRecipients = formatRecipientLine(message.cc_emails)
    const bccRecipients = formatRecipientLine(message.bcc_emails)
    const quotedBody = collapseConsecutiveBlankLines(
      message.body_text || message.preview || 'No message content available'
    )
    const accountId = selectedThread.account_id
    setDraftDetailsExpanded(false)
    setDraftReading(false)
    setDraftReadDetailsExpanded(false)

    setDraftError(null)
    setDraftNotice(null)
    setAiDraftInstruction('')
    setDraftRecipientsExpanded(false)
    setDraftVisibleFields(['to'])
    setActiveDraft({
      id: null,
      mode: 'forward',
      accountId,
      fromAddress: accounts.find((account) => account.id === accountId)?.address || '',
      threadId: selectedThread.id,
      inReplyToMessageId: message.id,
      to: [],
      cc: [],
      bcc: [],
      subject: buildForwardSubject(message.subject),
      body: [
        '',
        '---------- Forwarded message ----------',
        `From: ${sender}`,
        `Date: ${dateText}`,
        `Subject: ${message.subject || '(no subject)'}`,
        `To: ${toRecipients}`,
        ...(ccRecipients ? [`Cc: ${ccRecipients}`] : []),
        ...(bccRecipients ? [`Bcc: ${bccRecipients}`] : []),
        '',
        quotedBody,
      ].join('\n'),
      attachments: [],
    })
  }

  const openSavedDraft = useCallback((record: MailDraftRecord) => {
    draftSuggestionSessionRef.current += 1
    setAiReplySuggestion(null)
    const cc = extractEmailAddresses(record.cc_emails)
    const bcc = extractEmailAddresses(record.bcc_emails)
    setDraftDetailsExpanded(record.mode !== 'forward')
    setDraftReading(false)
    setDraftReadDetailsExpanded(false)

    setDraftError(null)
    setDraftNotice(null)
    setAiDraftInstruction('')
    setDraftRecipientsExpanded(cc.length > 0 || bcc.length > 0)
    setDraftVisibleFields([
      'to',
      ...(cc.length > 0 ? ['cc' as const] : []),
      ...(bcc.length > 0 ? ['bcc' as const] : []),
    ])
    setActiveDraft({
      id: record.id,
      mode: record.mode,
      accountId: record.account_id,
      fromAddress: record.from_address,
      threadId: record.thread_id,
      inReplyToMessageId: record.in_reply_to_message_id,
      to: extractEmailAddresses(record.to_emails),
      cc,
      bcc,
      subject: record.subject || '',
      body: record.body_text || '',
      attachments: record.attachments || [],
    })
  }, [])

  const openNewDraft = () => {
    draftSuggestionSessionRef.current += 1
    setAiReplySuggestion(null)
    const availableAccounts = accounts.filter((entry) => entry.status !== 'disconnected')
    const account = availableAccounts.find((entry) => entry.is_primary)
      ?? availableAccounts.reduce<MailAccount | null>((latest, entry) => {
        if (!latest) return entry
        const latestSentAt = latest.last_sent_at ? new Date(latest.last_sent_at).getTime() : 0
        const entrySentAt = entry.last_sent_at ? new Date(entry.last_sent_at).getTime() : 0
        return entrySentAt > latestSentAt ? entry : latest
      }, null)
    if (!account) return
    setDraftDetailsExpanded(true)
    setDraftReading(false)
    setDraftReadDetailsExpanded(false)

    setSelectedThread(null)
    setThreadMessages([])
    setFocusedThreadMessageId(null)
    setDraftError(null)
    setDraftNotice(null)
    setAiDraftInstruction('')
    setDraftRecipientsExpanded(false)
    setDraftVisibleFields(['to'])
    setActiveDraft({
      id: null,
      mode: 'new',
      accountId: account.id,
      fromAddress: account.address,
      threadId: null,
      inReplyToMessageId: null,
      to: [''],
      cc: [],
      bcc: [],
      subject: '',
      body: '',
      attachments: [],
    })

    if (isMobileMailboxLayout) setMobileMailboxScreen('thread')
  }

  const buildDraftPayload = (draft: MailDraft) => ({
    id: draft.id,
    account_id: draft.accountId,
    thread_id: draft.threadId,
    in_reply_to_message_id: draft.inReplyToMessageId,
    mode: draft.mode,
    from_address: draft.fromAddress,
    to_emails: draft.to.filter((entry) => entry.trim().length > 0),
    cc_emails: draft.cc.filter((entry) => entry.trim().length > 0),
    bcc_emails: draft.bcc.filter((entry) => entry.trim().length > 0),
    subject: draft.subject,
    body_text: draft.body,
    attachments: draft.attachments,
  })

  const handleDraftAttachmentChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!activeDraft || files.length === 0) return

    const existingBytes = activeDraft.attachments.reduce(
      (total, attachment) => total + Math.floor((attachment.contentBase64.length * 3) / 4),
      0
    )
    if (activeDraft.attachments.length + files.length > 5) {
      setDraftError('A draft can contain up to 5 attachments')
      return
    }
    if (files.some((file) => file.size > 5 * 1024 * 1024)) {
      setDraftError('Each attachment must be 5 MB or smaller')
      return
    }
    if (existingBytes + files.reduce((total, file) => total + file.size, 0) > 10 * 1024 * 1024) {
      setDraftError('Attachments must total 10 MB or less')
      return
    }

    const attachments = await Promise.all(
      files.map(
        (file) =>
          new Promise<MailDraftAttachment>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => {
              const result = typeof reader.result === 'string' ? reader.result : ''
              const contentBase64 = result.includes(',') ? result.slice(result.indexOf(',') + 1) : ''
              if (!contentBase64) {
                reject(new Error(`Could not read ${file.name}`))
                return
              }
              resolve({
                filename: file.name,
                contentType: file.type || 'application/octet-stream',
                contentBase64,
              })
            }
            reader.onerror = () => reject(new Error(`Could not read ${file.name}`))
            reader.readAsDataURL(file)
          })
      )
    ).catch((error: unknown) => {
      setDraftError(error instanceof Error ? error.message : 'Could not read attachment')
      return []
    })

    if (attachments.length > 0) {
      setDraftError(null)
      setActiveDraft((prev) =>
        prev ? { ...prev, attachments: [...prev.attachments, ...attachments] } : prev
      )
    }
  }

  const removeDraftAttachment = (filename: string) => {
    setActiveDraft((prev) =>
      prev
        ? {
            ...prev,
            attachments: prev.attachments.filter((attachment) => attachment.filename !== filename),
          }
        : prev
    )
  }

  const persistActiveDraft = async (draft: MailDraft): Promise<MailDraftRecord> => {
    const { data } = await apiClient.post('/api/mailbox/drafts', buildDraftPayload(draft))
    const record = data.draft as MailDraftRecord
    setDrafts((prev) => [record, ...prev.filter((entry) => entry.id !== record.id)])
    return record
  }

  const handleSaveDraft = async () => {
    if (!activeDraft || draftSaving || draftSending) return

    setDraftError(null)
    setDraftNotice(null)
    setDraftSaving(true)
    try {
      const record = await persistActiveDraft(activeDraft)
      setActiveDraft((prev) => (prev ? { ...prev, id: record.id } : prev))
      setDraftNotice('Draft saved')
    } catch (err) {
      setDraftError(apiErrorMessage(err))
    } finally {
      setDraftSaving(false)
    }
  }

  const handleSendDraft = async () => {
    if (!activeDraft || draftSaving || draftSending) return
    const submittedDraft = activeDraft
    const readerRequestSeq = openThreadRequestSeqRef.current

    const recipients = activeDraft.to.map((entry) => entry.trim()).filter(Boolean)
    if (recipients.length === 0) {
      setDraftDetailsExpanded(true)
      setDraftError('Add at least one To recipient before sending')
      return
    }

    setDraftError(null)
    setDraftNotice(null)
    setDraftSending(true)
    try {
      const record = await persistActiveDraft(activeDraft)
      const { data } = await apiClient.post(`/api/mailbox/drafts/${record.id}/send`)
      const lastSentAt = typeof data?.draft?.sent_at === 'string'
        ? data.draft.sent_at
        : new Date().toISOString()
      setAccounts((prev) =>
        prev.map((account) =>
          account.id === activeDraft.accountId
            ? { ...account, last_sent_at: lastSentAt }
            : account
        )
      )
      setDrafts((prev) => prev.filter((entry) => entry.id !== record.id))
      setSentNotice({
        id: record.id,
        recipients,
        subject: activeDraft.subject || '(no subject)',
        threadId: activeDraft.threadId,
        syncing: true,
      })
      const mayUpdateReader = readerRequestSeq === openThreadRequestSeqRef.current &&
        activeDraftRef.current === submittedDraft
      if (submittedDraft.mode === 'reply' && submittedDraft.threadId && submittedDraft.inReplyToMessageId) {
        const message: ThreadMessage = {
          id: `sent-draft:${record.id}`,
          provider_message_id: typeof data?.provider_message_id === 'string' ? data.provider_message_id : null,
          subject: submittedDraft.subject,
          from_email: submittedDraft.fromAddress,
          from_name: null,
          to_emails: submittedDraft.to.join(', '),
          cc_emails: submittedDraft.cc.join(', ') || null,
          bcc_emails: submittedDraft.bcc.join(', ') || null,
          received_at: lastSentAt,
          preview: submittedDraft.body.slice(0, 200),
          body_text: submittedDraft.body,
          body_html_sanitized: null,
          is_read: true,
          is_archived: false,
          user_tag_ids: [],
          is_provider_trashed: false,
          is_provider_junk: false,
          is_provider_sent: true,
        }
        pendingSentRepliesRef.current.set(record.id, {
          threadId: submittedDraft.threadId,
          sourceMessageId: submittedDraft.inReplyToMessageId,
          message,
          knownMessageIds: new Set(threadMessages.map((entry) => entry.id)),
        })
        const cached = threadCacheRef.current.get(submittedDraft.threadId)
        const updatedMessages = reconcileSentReplies(
          submittedDraft.threadId, cached?.messages ?? threadMessages
        )
        writeThreadCache(submittedDraft.threadId, {
          thread: cached?.thread ?? selectedThread,
          messages: updatedMessages,
        })
        if (mayUpdateReader) {
          setThreadMessages(updatedMessages)
          selectThreadMessage(message.id, { availableMessages: updatedMessages })
        }
      }
      if (mayUpdateReader) setActiveDraft(null)
      void pullSentMessages({ draft: submittedDraft, noticeId: record.id, readerRequestSeq })
    } catch (err) {
      if (activeDraftRef.current === submittedDraft) setDraftError(apiErrorMessage(err))
      else setError(apiErrorMessage(err))
    } finally {
      setDraftSending(false)
    }
  }

  // A sent message only exists in the provider's Sent folder, so pull it in right away
  // instead of waiting for the next full sync.
  const pullSentMessages = async ({
    draft, noticeId, readerRequestSeq,
  }: { draft: MailDraft; noticeId: string; readerRequestSeq: number }) => {
    try {
      let copyPending = false
      await apiClient.post(
        `/api/mailbox/accounts/${draft.accountId}/sync`,
        {
          max_messages: 25,
          days_back: 7,
          include_inbox: false,
          include_sent: true,
          include_trash: false,
          include_spam: false,
          include_archived: false,
        },
        { timeout: syncRequestTimeoutMs(30) }
      )
      await loadMessages(inboxLoadLimitRef.current)
      if (draft.mode === 'reply' && draft.threadId && draft.inReplyToMessageId) {
        const readSeq = pendingTrashRef.current.beginRead()
        const { data } = await apiClient.get(`/api/mailbox/messages/${draft.inReplyToMessageId}/thread`)
        const updatedMessages = pendingTrashRef.current.apply(
          reconcileSentReplies(draft.threadId, normalizeThreadMessages(data?.messages)), readSeq
        )
        pendingTrashRef.current.completeRead(readSeq)
        writeThreadCache(draft.threadId, { thread: data.thread || null, messages: updatedMessages })
        syncInboxListFromThreadMessages(updatedMessages)
        if (readerRequestSeq === openThreadRequestSeqRef.current && !activeDraftRef.current) {
          setThreadMessages(updatedMessages)
        }
        if (!pendingSentRepliesRef.current.get(noticeId)?.importedMessage) {
          copyPending = true
          setSentSyncWarnings((prev) => ({
            ...prev, [noticeId]: 'Your email was sent, but its provider copy is not available yet. Use Sync to retrieve it.',
          }))
        }
      }
      setSentNotice((prev) => (prev?.id === noticeId ? { ...prev, syncing: false, syncFailed: copyPending } : prev))
    } catch (err) {
      setSentSyncWarnings((prev) => ({
        ...prev, [noticeId]: `Your email was sent, but its copy could not be refreshed. Use Sync to retrieve it. ${apiErrorMessage(err)}`,
      }))
      setSentNotice((prev) => (prev?.id === noticeId ? { ...prev, syncing: false, syncFailed: true } : prev))
    }
  }

  const handleDiscardDraft = async () => {
    const draftId = activeDraft?.id
    setActiveDraft(null)
    setDraftError(null)
    setDraftNotice(null)
    setAiDraftInstruction('')
    if (!draftId) return

    try {
      await apiClient.delete(`/api/mailbox/drafts/${draftId}`)
      setDrafts((prev) => prev.filter((entry) => entry.id !== draftId))
    } catch (err) {
      setError(apiErrorMessage(err))
    }
  }

  const handleAiDraftSuggest = async () => {
    if (
      !activeDraft ||
      !activeDraft.inReplyToMessageId ||
      !aiDraftInstruction.trim() ||
      aiDraftLoading
    )
      return

    setDraftError(null)
    setDraftNotice(null)
    setAiDraftLoading(true)
    const session = draftSuggestionSessionRef.current
    const readerRequestSeq = openThreadRequestSeqRef.current
    const sourceMessageId = activeDraft.inReplyToMessageId
    const instruction = aiDraftInstruction.trim()
    const stillCurrent = () => session === draftSuggestionSessionRef.current
      && readerRequestSeq === openThreadRequestSeqRef.current
      && activeDraftRef.current?.inReplyToMessageId === sourceMessageId
    try {
      const { data } = await apiClient.post<{ subject: string; body_text: string }>(
        `/api/mailbox/messages/${activeDraft.inReplyToMessageId}/draft-suggestion`,
        {
          instruction,
        }
      )
      if (!stillCurrent()) return
      if (typeof data.subject !== 'string' || typeof data.body_text !== 'string' || !data.body_text.trim()) {
        throw new Error('AI returned an invalid reply suggestion')
      }
      setAiReplySuggestion({
        id: ++aiReplySuggestionIdRef.current, instruction, subject: data.subject, body: data.body_text,
      })
      setActiveDraft((prev) =>
        prev
          ? { ...prev, subject: data.subject || prev.subject, body: data.body_text || prev.body }
          : prev
      )
      setDraftNotice('AI suggestion added -- review before saving or sending')
    } catch (err) {
      if (stillCurrent()) setDraftError(apiErrorMessage(err))
    } finally {
      setAiDraftLoading(false)
    }
  }

  const updateDraftRecipient = (field: MailDraftRecipientField, index: number, value: string) => {
    setActiveDraft((prev) => {
      if (!prev) return prev
      const next = [...prev[field]]
      next[index] = value
      return { ...prev, [field]: next }
    })
  }

  const addDraftRecipientRow = (field: MailDraftRecipientField) => {
    setDraftVisibleFields((prev) => (prev.includes(field) ? prev : [...prev, field]))
    setActiveDraft((prev) => (prev ? { ...prev, [field]: [...prev[field], ''] } : prev))
  }

  const removeDraftRecipientRow = (field: MailDraftRecipientField, index: number) => {
    const remaining = activeDraft ? activeDraft[field].filter((_, i) => i !== index).length : 0
    setActiveDraft((prev) =>
      prev ? { ...prev, [field]: prev[field].filter((_, i) => i !== index) } : prev
    )
    setRecipientSuggestionTarget(null)

    // Cc and Bcc disappear entirely once their last row is removed; To always keeps one row.
    if (field !== 'to' && remaining === 0) {
      setDraftVisibleFields((prev) => prev.filter((entry) => entry !== field))
    }
  }

  // Suggestion source for recipient inputs: every known email from the People directory.
  const recipientDirectory = useMemo(() => {
    const seen = new Set<string>()
    const entries: Array<{ email: string; name: string | null }> = []

    for (const person of people) {
      for (const identity of person.identities || []) {
        const email = (identity.email || '').trim().toLowerCase()
        if (!email || seen.has(email)) continue
        seen.add(email)
        entries.push({ email, name: person.display_name })
      }
    }

    return entries
  }, [people])

  const recipientSuggestions = useMemo(() => {
    if (!recipientSuggestionTarget || !activeDraft) return []

    const { field, index } = recipientSuggestionTarget
    const query = (activeDraft[field][index] || '').trim().toLowerCase()
    const alreadyUsed = new Set(
      [
        ...activeDraft.to.map((value, recipientIndex) => ({
          field: 'to' as const,
          index: recipientIndex,
          value,
        })),
        ...activeDraft.cc.map((value, recipientIndex) => ({
          field: 'cc' as const,
          index: recipientIndex,
          value,
        })),
        ...activeDraft.bcc.map((value, recipientIndex) => ({
          field: 'bcc' as const,
          index: recipientIndex,
          value,
        })),
      ]
        .filter((entry) => entry.field !== field || entry.index !== index)
        .map((entry) => entry.value)
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    )

    return recipientDirectory
      .filter(
        (entry) =>
          !query || entry.email.includes(query) || (entry.name || '').toLowerCase().includes(query)
      )
      .map((entry) => ({ ...entry, isAlreadyUsed: alreadyUsed.has(entry.email) }))
      .slice(0, 5)
  }, [recipientSuggestionTarget, activeDraft, recipientDirectory])

  // Outgoing mail sends through the account currently chosen on the draft.
  const draftFromOptions = useMemo(() => {
    return accounts
      .filter((account) => account.status !== 'disconnected')
      .map((account) => ({
        accountId: account.id,
        address: account.address,
        label: account.display_name
          ? `${account.display_name} <${account.address}>`
          : account.address,
      }))
  }, [accounts])

  // Saved drafts are surfaced as synthetic inbox rows so the Draft system tag can filter and sort them.
  const draftMessages = useMemo<MailMessage[]>(() => {
    const accountById = new Map(accounts.map((account) => [account.id, account]))

    return drafts.map((record) => {
      const account = accountById.get(record.account_id)
      return {
        id: `draft:${record.id}`,
        account_id: record.account_id,
        thread_id: record.thread_id,
        subject: record.subject,
        from_email: record.from_address,
        from_name: account?.display_name || null,
        to_emails: record.to_emails,
        cc_emails: record.cc_emails,
        bcc_emails: record.bcc_emails,
        received_at: record.updated_at,
        preview: (record.body_text || '').slice(0, 200),
        is_read: true,
        is_archived: false,
        has_attachments: false,
        user_tag_ids: [],
        is_provider_trashed: false,
        is_provider_junk: false,
        is_provider_sent: false,
        is_draft: true,
        draft_id: record.id,
        account: account
          ? {
              id: account.id,
              provider: account.provider,
              address: account.address,
              display_name: account.display_name,
              identity_group: account.identity_group,
            }
          : null,
      }
    })
  }, [accounts, drafts])

  useEffect(() => {
    const fromDateMs = parseDateInputStart(dateFromFilter)
    const toDateMs = parseDateInputEnd(dateToFilter)
    const sourceMessages = draftMessages.length > 0 ? [...draftMessages, ...messages] : messages

    const baseFiltered = sourceMessages.filter((msg) => {
      if (excludedAccountIds.includes(msg.account_id)) return false
      if (excludedGroups.length > 0) {
        const group = msg.account?.identity_group
        if (group && excludedGroups.includes(group)) return false
      }
      const receivedAtMs = parseTimestamp(msg.received_at)
      if ((fromDateMs !== null || toDateMs !== null) && receivedAtMs === null) return false
      if (fromDateMs !== null && receivedAtMs !== null && receivedAtMs < fromDateMs) return false
      if (toDateMs !== null && receivedAtMs !== null && receivedAtMs > toDateMs) return false
      if (isSessionTrashedHidden(msg, effectiveTagModes, sessionTrashedIdsRef.current)) return false
      return isMessageVisible(msg, effectiveTagModes, isMessageJunk)
    })

    const baseFilterKey = [
      excludedAccountIds.join(','),
      excludedGroups.join(','),
      dateFromFilter,
      dateToFilter,
      [...effectiveTagModes].map(([id, mode]) => `${id}:${mode}`).join(','),
      sourceMessages.map((msg) => msg.id).join(','),
    ].join('|')

    const nextQuery = committedQuery
    const prevQuery = previousCommittedQueryRef.current
    const hasSameBase = previousBaseFilterKeyRef.current === baseFilterKey
    const isNarrowing =
      hasSameBase && nextQuery.length > prevQuery.length && nextQuery.startsWith(prevQuery)

    const candidateMessages = isNarrowing ? previousFilteredMessagesRef.current : baseFiltered

    const nextFiltered = !nextQuery
      ? baseFiltered
      : candidateMessages.filter((msg) => {
          const haystack = [
            msg.subject,
            msg.from_name,
            msg.from_email,
            msg.to_emails,
            msg.preview,
            msg.account?.address,
            msg.account?.display_name,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()

          return haystack.includes(nextQuery)
        })

    const commitFiltered = (list: MailMessage[]) => {
      setFilteredMessages(sortMailboxMessages(list, activeSortState, isMessageJunk))
    }

    // Rows that disappeared purely because the user is typing a search query narrow instantly by
    // design -- only messages hidden for other reasons (tag/filter/account changes) get a graceful exit.
    // Hydration itself is also instant: correcting the first paint to the stored rules must not
    // leave every non-matching email on screen for MAILBOX_FILTER_HIDE_MS.
    const queryUnchanged = nextQuery === prevQuery && areFiltersReady
    const sourceIds = new Set(sourceMessages.map((msg) => msg.id))
    const prevIds = new Set(previousFilteredMessagesRef.current.map((msg) => msg.id))
    const nextIds = new Set(nextFiltered.map((msg) => msg.id))
    // Rows that already played the trash exit leave immediately -- re-adding them as filter-vanishing
    // would show an empty slot and replay the exit (and the Thread Viewer collapse) a second time.
    const exitedIds = exitedMessageIdsRef.current
    const now = Date.now()
    for (const [id, expiresAt] of exitedIds) {
      if (expiresAt <= now || !sourceIds.has(id)) exitedIds.delete(id)
    }
    const justHiddenIds = queryUnchanged
      ? Array.from(prevIds).filter(
          (id) => !nextIds.has(id) && sourceIds.has(id) && !exitedIds.has(id)
        )
      : []
    for (const id of exitedIds.keys()) {
      if (!nextIds.has(id)) exitedIds.delete(id)
    }

    if (justHiddenIds.length > 0) {
      const sourceById = new Map(sourceMessages.map((msg) => [msg.id, msg]))
      const stillShown = justHiddenIds
        .map((id) => sourceById.get(id))
        .filter((msg): msg is MailMessage => Boolean(msg))

      setFilterVanishingMessageIds((prev) => {
        const next = new Set(prev)
        for (const id of justHiddenIds) next.add(id)
        return next
      })
      commitFiltered([...nextFiltered, ...stillShown])

      // Collapse whenever any message currently rendered in the Thread Viewer just got hidden --
      // not only when the whole thread vanishes -- so an untagged email that's open always reacts.
      const openThreadMessageIds = new Set(threadMessages.map((message) => message.id))
      const shouldCollapseThreadViewer =
        openThreadMessageIds.size > 0 && justHiddenIds.some((id) => openThreadMessageIds.has(id))
      if (shouldCollapseThreadViewer) {
        setIsThreadViewerCollapsing(true)
        const previousThreadId = selectedThreadIdRef.current
        // Sorted so "top" matches the row that will actually render first, not raw filter order.
        const sortedNextFiltered = sortMailboxMessages(nextFiltered, activeSortState, isMessageJunk)
        // Runs independently of the (longer) row fade below -- the viewer itself advances at its own, faster pace.
        window.setTimeout(() => {
          setIsThreadViewerCollapsing(false)
          // Skip messages still belonging to the thread that just collapsed -- the mailbox API returns
          // a thread's full conversation regardless of per-message tags, so reopening the same thread_id
          // would just show the exact message that was supposed to have disappeared.
          const topMessage = sortedNextFiltered.find(
            (message) => Boolean(message.thread_id) && message.thread_id !== previousThreadId
          )
          if (topMessage?.thread_id) {
            void handleOpenThreadFromInboxRef.current(topMessage)
          } else {
            setSelectedThread(null)
            setThreadMessages([])
            selectedThreadIdRef.current = null
            setActiveDraft(null)
          }
        }, MAILBOX_THREAD_COLLAPSE_MS)
      }

      window.setTimeout(() => {
        setFilterVanishingMessageIds((prev) => {
          const next = new Set(prev)
          for (const id of justHiddenIds) next.delete(id)
          return next
        })
        commitFiltered(nextFiltered)
      }, MAILBOX_FILTER_HIDE_MS)
    } else {
      commitFiltered(nextFiltered)
    }

    previousCommittedQueryRef.current = nextQuery
    previousFilteredMessagesRef.current = nextFiltered
    previousBaseFilterKeyRef.current = baseFilterKey

    if (pendingExitClearIdsRef.current.size > 0) {
      const finishedIds = Array.from(pendingExitClearIdsRef.current)
      pendingExitClearIdsRef.current.clear()
      setRemovingMessageIds((prev) => {
        if (!finishedIds.some((id) => prev.has(id))) return prev
        const next = new Set(prev)
        for (const id of finishedIds) next.delete(id)
        return next
      })
    }
  }, [
    messages,
    draftMessages,
    committedQuery,
    excludedAccountIds,
    excludedGroups,
    dateFromFilter,
    dateToFilter,
    effectiveTagModes,
    isMessageJunk,
    activeSortState,
    areFiltersReady,
    threadMessages,
  ])

  useEffect(() => {
    if (!shouldUsePrioritySortWindow || isLoading) return

    let cancelled = false
    // On mount, this can run while the initial visible-target scan (loadInitial) is still mid-flight
    // and holding isLoadingMoreRef -- bailing outright in that case (as before) meant the priority
    // window only ever got backfilled if some unrelated filter/sort change happened to re-run this
    // effect afterward. Retrying on a short timer instead means it always eventually runs once that
    // other loader clears, without a second reload/navigation being needed to reveal older
    // priority-tagged mail on a fresh page load.
    const attempt = () => {
      if (cancelled) return
      if (isLoadingMoreRef.current) {
        window.setTimeout(attempt, 250)
        return
      }

      const targetLimit = Math.min(messagesTotalRef.current, MESSAGE_PRIORITY_SORT_LOAD_LIMIT)
      const gap = targetLimit - messagesRef.current.length
      // Small gaps are already covered by the regular periodic refresh, which merges the newest
      // MESSAGE_LOAD_DEFAULT messages into local state without dropping anything already loaded
      // (see loadMessages). Without this guard, every trickle of new mail bumped messagesTotal and
      // re-triggered a full top-N re-fetch of the whole priority window here, which looked like the
      // mailbox was perpetually re-syncing from scratch.
      if (gap <= MESSAGE_LOAD_DEFAULT) return

      setIsLoadingMoreMessages(true)
      void loadMessages(targetLimit)
        .catch((err) => console.warn('[MailboxPage] Priority sort load failed:', err))
        .finally(() => setIsLoadingMoreMessages(false))
    }
    attempt()

    return () => {
      cancelled = true
    }
  }, [isLoading, loadMessages, messages.length, messagesTotal, shouldUsePrioritySortWindow])

  // When filters change (not on mount, and not while messages are still loading), resume the auto-search
  // loop until a full page of visible messages is found again or everything is loaded.
  useEffect(() => {
    if (!hasMountedFiltersRef.current) {
      hasMountedFiltersRef.current = true
      return
    }
    // Checked via the ref (not the isLoadingMoreMessages state) so this effect only re-runs on an
    // actual filter/sort change, not every time some other loader (e.g. the priority sort window
    // fetch) flips isLoadingMoreMessages true/false -- that coupling used to re-run this whole
    // visible-target scan after every background fetch, looking like a never-ending re-sync.
    if (isLoadingMoreRef.current) return
    visibleTargetRef.current = MESSAGE_LOAD_DEFAULT
    setVisibleTarget(MESSAGE_LOAD_DEFAULT)
    const total = messagesTotalRef.current
    const currentLimit = messagesRef.current.length
    const visibleCount = computeVisibleCount(messagesRef.current)
    if (currentLimit >= total || visibleCount >= visibleTargetRef.current) return
    void loadUntilVisibleTarget(currentLimit, total, visibleCount, visibleTargetRef.current).then(
      () => {
        window.setTimeout(() => prefetchNextPage(), 300)
      }
    )
  }, [
    committedQuery,
    excludedAccountIds,
    excludedGroups,
    dateFromFilter,
    dateToFilter,
    effectiveTagModes,
    computeVisibleCount,
    loadUntilVisibleTarget,
    prefetchNextPage,
  ])

  useEffect(() => {
    if (!selectTopThreadAfterTrashRef.current) return

    // Mobile keeps the list screen after trashing, so auto-selection would yank the user back into the viewer.
    if (isMobileMailboxLayout) {
      selectTopThreadAfterTrashRef.current = false
      return
    }

    // Rows still fading out (or whose trash is in flight) linger in filteredMessages; reopening their
    // thread would refetch it before the server has persisted the trash.
    const topMessage = filteredMessages.find(
      (message) =>
        Boolean(message.thread_id) &&
        !filterVanishingMessageIds.has(message.id) &&
        !removingMessageIds.has(message.id) &&
        !(message.is_provider_trashed && pendingTrashRef.current.has(message.id))
    )
    if (!topMessage?.thread_id) {
      if (filteredMessages.length === 0) {
        selectTopThreadAfterTrashRef.current = false
        setSelectedThread(null)
        setThreadMessages([])
        selectedThreadIdRef.current = null
        setActiveDraft(null)
      }
      return
    }

    selectTopThreadAfterTrashRef.current = false
    void handleOpenThreadFromInboxRef.current(topMessage)
  }, [filteredMessages, filterVanishingMessageIds, removingMessageIds, isMobileMailboxLayout])

  const remainingSyncedMessages = Math.max(0, messagesTotal - messages.length)
  // Cap the rendered list to the current page target -- matches beyond it stay cached in `filteredMessages`
  // for an instant reveal (no network call) the next time the user clicks Load.
  const displayedMessages = useMemo(
    () => filteredMessages.slice(0, visibleTarget),
    [filteredMessages, visibleTarget]
  )

  // Warms the cache with the threads the user is most likely to open next: unread first, then the
  // rows just below the open one. Opening any of them is then instant.
  useEffect(() => {
    if (isLoading || displayedMessages.length === 0) return

    const selectedIndex = selectedThread
      ? displayedMessages.findIndex((message) => message.thread_id === selectedThread.id)
      : -1
    const neighbours =
      selectedIndex >= 0 ? displayedMessages.slice(selectedIndex + 1) : displayedMessages
    const candidates: string[] = []

    for (const message of [...displayedMessages.filter((entry) => !entry.is_read), ...neighbours]) {
      const threadId = message.thread_id
      if (!threadId || message.is_draft || threadId === selectedThread?.id) continue
      if (candidates.includes(threadId)) continue
      candidates.push(threadId)
      if (candidates.length >= MAILBOX_THREAD_PREFETCH_LIMIT) break
    }

    if (candidates.length === 0) return

    let cancelled = false
    // Serialized so the prefetch never competes with a thread the user just clicked.
    const runPrefetch = async () => {
      for (const threadId of candidates) {
        if (cancelled) return
        await prefetchThread(threadId)
      }
    }

    const handle = window.setTimeout(() => void runPrefetch(), MAILBOX_THREAD_PREFETCH_DELAY_MS)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [displayedMessages, isLoading, prefetchThread, selectedThread])
  // There's more to show either if the cache already holds hidden matches, or if more synced emails remain unfetched.
  const canLoadMoreMessages =
    filteredMessages.length > displayedMessages.length || remainingSyncedMessages > 0

  // The cascade opt-in is only meaningful when a saved rule can actually react to an applied action.
  const hasReceiveActionRules = useMemo(
    () =>
      rules.some(
        (rule) =>
          rule.definition.mode !== 'disabled' &&
          rule.definition.steps.some((step) => step.kind === 'receive_action' && step.enabled)
      ),
    [rules]
  )

  const applyMassActions = useCallback(
    async (actions: Array<{ action: AutomationActionType; value: string }>, cascade: boolean) => {
      if (actions.length === 0 || displayedMessages.length === 0) return

      setMassActionRunning(true)
      setMassActionError(null)
      setMassActionResult(null)

      const targetMessageIds = displayedMessages.map((message) => message.id)
      const targetIds = new Set(targetMessageIds)
      const beforeMessages = messagesRef.current.filter(message => targetIds.has(message.id))
      const beforeThreadMessages = threadMessages.filter(message => targetIds.has(message.id))

      // Apply tag changes to the visible cards right away instead of waiting on the round trip
      // and a full message refetch, so the tag shows up on every card immediately.
      const addTagIds = actions.filter((step) => step.action === 'add_tag' && step.value).map((step) => step.value)
      const removeTagIds = actions.filter((step) => step.action === 'remove_tag' && step.value).map((step) => step.value)
      if (addTagIds.length > 0 || removeTagIds.length > 0) {
        const targetIdSet = new Set(targetMessageIds)
        const applyLocalTagChanges = <T extends { id: string; user_tag_ids: string[] }>(messages: T[]) =>
          messages.map((message) => {
            if (!targetIdSet.has(message.id)) return message
            return {
              ...message,
              user_tag_ids: Array.from(
                new Set([
                  ...message.user_tag_ids.filter((tagId) => !removeTagIds.includes(tagId)),
                  ...addTagIds,
                ])
              ),
            }
          })
        setMessages((messages) => applyLocalTagChanges(messages))
        setThreadMessages((messages) => applyLocalTagChanges(messages))
      }

      try {
        const { data } = await apiClient.post('/api/mailbox/messages/bulk-action', {
          actions,
          cascade,
          message_ids: targetMessageIds,
        })
        clearThreadCache()
        const outcomes = readMailboxBulkOutcomes(data, actions, targetMessageIds)
        if (outcomes) {
          setMessages(current => reconcileMailboxBulkOutcomes(current, beforeMessages, actions, outcomes))
          setThreadMessages(current => reconcileMailboxBulkOutcomes(current, beforeThreadMessages, actions, outcomes))
          if (outcomes.some(message => message.actions.some(action => action.status === 'uncertain'))) {
            setMassActionError('Some actions need verification. Check their provider state before running them again.')
          }
        }
        setMassActionResult({
          ...data,
          contract_version: outcomes ? 1 : undefined,
          results: outcomes ?? undefined,
          warnings: Array.isArray(data.warnings) ? data.warnings : [],
        } as MailboxMassActionResult)
        setMassActionRunning(false)
        // Reconciles any non-tag actions (trash/archive/read state) and failed rows in the background
        // now that the tag update has already rendered.
        const requiresRefresh = !outcomes || cascade
          || outcomes.some(message => message.actions.some(action => action.status !== 'applied'))
          || actions.some(step => step.action === 'junk' || step.action === 'agent_prompt')
        void Promise.all([
          requiresRefresh ? loadMessages(inboxLoadLimitRef.current) : Promise.resolve(),
          loadMailboxTags(),
        ]).catch(() => undefined)
      } catch (err) {
        setMassActionError(`Bulk action outcome could not be confirmed. ${apiErrorMessage(err)}`)
        setMassActionRunning(false)
        // Roll back the optimistic tag update since we can't tell which messages actually failed.
        void Promise.all([loadMessages(inboxLoadLimitRef.current), loadMailboxTags()]).catch(() => undefined)
      }
    },
    [displayedMessages, loadMailboxTags, loadMessages, clearThreadCache, threadMessages]
  )

  const handleLoadMoreMessages = async () => {
    if (!canLoadMoreMessages) return
    const requestedStep = Math.max(1, Math.floor(inboxLoadStep) || 1)
    const nextTarget = visibleTarget + requestedStep
    visibleTargetRef.current = nextTarget
    setVisibleTarget(nextTarget)
    // If already-loaded matches don't cover it, this fetches more (or upgrades an in-flight background prefetch to visible).
    await loadUntilVisibleTarget(inboxLoadLimit, messagesTotal, filteredMessages.length, nextTarget)
    window.setTimeout(() => prefetchNextPage(), 300)
  }

  // Phone drawers claim the drawer layer while open; scrim and panel share it
  // (the scrim renders first, so the panel paints above it).
  const { z: tagPanelDrawerZ } = useOverlayLayer('drawer', isMobileMailboxLayout && isTagPanelOpen)
  const { z: automationPanelDrawerZ } = useOverlayLayer('drawer', isMobileMailboxLayout && isAutomationPanelOpen)
  const isTagPickerVisible =
    activeTab === 'mailbox' &&
    isTagPickerOpen &&
    (tagPickerScope === 'thread' ? threadMessages.length > 0 : Boolean(selectedTagMessage))
  // The tag picker can open over a phone drawer, so it resolves above the blocking stack.
  const { z: tagPickerZ } = useOverlayLayer('popover', isTagPickerVisible)

  const calendarDeliveryBanners = calendarDeliveryNotices.map((notice) => {
    const activeTargets = notice.targets.filter(
      (target) =>
        target.status === 'pending' ||
        target.status === 'sending' ||
        target.status === 'retrying'
    )
    const successfulTargets = notice.targets.filter((target) => target.status === 'succeeded')
    const failedTargets = notice.targets.filter(
      (target) => target.status === 'failed' || target.status === 'retrying'
    )
    const allSucceeded =
      notice.targets.length > 0 && successfulTargets.length === notice.targets.length

    return (
      <div key={notice.id}>
        {activeTargets.length > 0 && (
          <div
            className="mb-3 rounded-xl border border-info-muted bg-info-subtle p-3 text-info"
            data-testid="mailbox-calendar-delivery-progress"
            role="status"
            aria-live="polite"
          >
            <p className="text-sm font-semibold">Adding "{notice.title}" to selected calendars</p>
            <ul className="mt-2 space-y-1 text-xs">
              {notice.targets.map((target) => (
                <li key={target.id} className="flex items-center gap-2">
                  {(target.status === 'sending' || target.status === 'retrying') && (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 motion-safe:animate-spin motion-reduce:animate-none" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{target.label}</span>
                  <span className="shrink-0">
                    {target.status === 'pending'
                      ? 'Waiting'
                      : target.status === 'sending'
                        ? 'Adding'
                        : target.status === 'retrying'
                          ? `Retry scheduled (attempt ${target.attempts + 1})`
                          : target.status === 'succeeded'
                            ? 'Added'
                            : 'Failed'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {notice.successVisible && successfulTargets.length > 0 && (
          <div
            className="mb-3 rounded-xl border border-success-muted bg-success-subtle p-3"
            data-testid="mailbox-calendar-delivery-success"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-semibold text-success">
                  {allSucceeded
                    ? `Added "${notice.title}" to all selected destinations`
                    : `Confirmed calendar additions for "${notice.title}"`}
                </p>
                <p className="text-xs text-success">
                  {successfulTargets.map((target) => target.label).join(', ')}
                </p>
                {notice.invitationStatus === 'saved' && (
                  <p className="text-[11px] text-success">
                    The invitation is marked as imported in Mailbox.
                  </p>
                )}
              </div>
              <IconButton
                onClick={() => dismissCalendarDeliverySuccess(notice.id)}
                title="Dismiss"
                label="Dismiss calendar addition confirmation"
                className="shrink-0"
                icon={<X className="h-3.5 w-3.5" />}
              />
            </div>
          </div>
        )}

        {!notice.failureDismissed && failedTargets.length > 0 && (
          <div
            className="mb-3 flex items-start justify-between gap-3 rounded-xl border border-danger-muted bg-danger-subtle p-3 text-danger"
            data-testid="mailbox-calendar-delivery-failure"
            role="alert"
          >
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-semibold">Some calendar additions need attention</p>
              <ul className="space-y-2 text-xs">
                {failedTargets.map((target) => (
                  <li key={target.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">{target.label}</span>
                    {target.status === 'retrying' ? (
                      <span>Retrying automatically. Last response: {target.error}</span>
                    ) : (
                      <span>{target.error}</span>
                    )}
                    {target.status === 'failed' && (
                      <Button
                        emphasis="outline"
                        intent="neutral"
                        size="compact"
                        onClick={() => retryCalendarDeliveryTarget(notice.id, target)}
                        icon={<RefreshCw className="h-3.5 w-3.5" />}
                      >
                        Retry
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <IconButton
              onClick={() => dismissCalendarDeliveryFailure(notice.id)}
              title="Dismiss"
              label="Dismiss calendar addition failure"
              className="shrink-0"
              icon={<X className="h-3.5 w-3.5" />}
            />
          </div>
        )}

        {notice.invitationStatus === 'failed' && !notice.invitationStatusWarningDismissed && (
          <div
            className="mb-3 flex items-start justify-between gap-3 rounded-xl border border-warning-muted bg-warning-subtle p-3 text-warning"
            role="alert"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                Calendar items were added, but Mailbox could not save the invitation status.
              </p>
              <p className="mt-1 text-xs">{notice.invitationStatusError}</p>
              <Button
                emphasis="outline"
                intent="neutral"
                size="compact"
                className="mt-2"
                onClick={() => retryImportedInvitationStatus(notice)}
              >
                Retry status update
              </Button>
            </div>
            <IconButton
              onClick={() =>
                updateCalendarDeliveryNotice(notice.id, (current) => ({
                  ...current,
                  invitationStatusWarningDismissed: true,
                }))
              }
              title="Dismiss"
              label="Dismiss invitation status warning"
              className="shrink-0"
              icon={<X className="h-3.5 w-3.5" />}
            />
          </div>
        )}
      </div>
    )
  })

  return (
    <div className="w-full px-2 pb-6 pt-2 md:px-4 md:pt-3 space-y-3">
      {activeTab === 'mailbox' && (
        <LeftPanelPortal>
          {isMobileMailboxLayout && isTagPanelOpen && (
            <button
              type="button"
              aria-label="Close mailbox tag panel"
              className={`fixed inset-0 ${OVERLAY_SCRIM.drawer}`}
              style={{ zIndex: tagPanelDrawerZ }}
              onClick={() => setIsTagPanelOpen(false)}
            />
          )}
          <aside
            data-testid="mailbox-tags-side-panel"
            className={`${isMobileMailboxLayout ? 'fixed inset-0 h-screen w-screen border-0 shadow-2xl' : 'sticky top-0 h-screen shrink-0 border-r border-border'} overflow-hidden bg-card transition-[width,transform,opacity] duration-300 ease-out`}
            style={{
              width: isMobileMailboxLayout
                ? isTagPanelOpen
                  ? '100vw'
                  : 0
                : isTagPanelOpen
                  ? `${MAILBOX_TAG_PANEL_WIDTH_PX}px`
                  : 0,
              zIndex: isMobileMailboxLayout ? tagPanelDrawerZ : undefined,
            }}
          >
            <div
              className={`flex h-full min-w-0 flex-col transition-all duration-300 ease-out ${
                isTagPanelOpen
                  ? 'translate-x-0 opacity-100'
                  : isMobileMailboxLayout
                    ? '-translate-x-full opacity-0'
                    : '-translate-x-3 opacity-0'
              }`}
              style={{ width: isMobileMailboxLayout ? '100vw' : `${MAILBOX_TAG_PANEL_WIDTH_PX}px` }}
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-foreground">Mailbox Tags</h2>
                <IconButton
                  onClick={() => setIsTagPanelOpen(false)}
                  label="Close side panel"
                  icon={<PanelLeftClose className="h-4 w-4" />}
                />
              </div>

              <div className="flex-1 overflow-y-auto px-3 py-3">
                <div className="space-y-4">
                  <section className="rounded-lg border border-border bg-background/50 p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Palette className="h-4 w-4 text-info" />
                      Tag Library
                    </div>

                    <div className="mb-3 space-y-1.5">
                      {mailboxTags.length === 0 && (
                        <div className="rounded-md border border-dashed border-border px-2.5 py-2 text-xs text-muted-foreground">
                          No tags yet. Create one below.
                        </div>
                      )}

                      {mailboxTags.map((tag) => {
                        const isEditing = editingTagId === tag.id
                        if (isEditing) {
                          return (
                            <div
                              key={tag.id}
                              className="rounded-md border border-border bg-background p-2.5 space-y-2"
                            >
                              <input
                                type="text"
                                value={editingTagLabel}
                                onChange={(event) => setEditingTagLabel(event.target.value)}
                                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                                placeholder="Tag label"
                              />
                              <div className="flex items-center gap-2">
                                <input
                                  type="color"
                                  value={editingTagColor}
                                  onChange={(event) => setEditingTagColor(event.target.value)}
                                  className="h-7 w-9 rounded border border-border bg-background p-0.5"
                                  aria-label="Edit mailbox tag color"
                                />
                                <Button
                                  intent="primary"
                                  size="compact"
                                  onClick={() => void handleSaveMailboxTag()}
                                  disabled={tagsSaving || !editingTagLabel.trim()}
                                  icon={<Check className="h-3.5 w-3.5" />}
                                >
                                  Save
                                </Button>
                                <Button
                                  emphasis="ghost"
                                  size="compact"
                                  onClick={() => {
                                    setEditingTagId(null)
                                    setEditingTagLabel('')
                                    setEditingTagColor(MAILBOX_TAG_DEFAULT_COLOR)
                                  }}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          )
                        }

                        return (
                          <div
                            key={tag.id}
                            className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5"
                          >
                            <span
                              className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                              style={{ backgroundColor: `${tag.color}22`, color: tag.color }}
                            >
                              {tag.label}
                            </span>
                            <div className="ml-auto flex items-center gap-1">
                              <Button
                                emphasis="outline"
                                size="compact"
                                onClick={() => handleStartEditMailboxTag(tag)}
                              >
                                Edit
                              </Button>
                              <Button
                                emphasis="outline"
                                intent="danger"
                                size="compact"
                                onClick={() => void handleDeleteMailboxTag(tag.id)}
                                disabled={tagsSaving}
                              >
                                Delete
                              </Button>
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    <div
                      className={`rounded-md border bg-background p-2.5 space-y-2 transition-all ${
                        createTagHighlight
                          ? 'border-primary ring-2 ring-primary animate-pulse motion-reduce:animate-none'
                          : 'border-border'
                      }`}
                    >
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Create Tag
                      </p>
                      <input
                        ref={newTagInputRef}
                        type="text"
                        value={newTagLabel}
                        onChange={(event) => setNewTagLabel(event.target.value)}
                        placeholder="Tag label"
                        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                      />
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={newTagColor}
                          onChange={(event) => setNewTagColor(event.target.value)}
                          className="h-7 w-9 rounded border border-border bg-background p-0.5"
                          aria-label="New mailbox tag color"
                        />
                        <Button
                          intent="primary"
                          size="compact"
                          onClick={() => void handleCreateMailboxTag()}
                          disabled={tagsSaving || !newTagLabel.trim()}
                          icon={<Plus className="h-3.5 w-3.5" />}
                        >
                          Add
                        </Button>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-lg border border-border bg-background/50 p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Tag className="h-4 w-4 text-muted-foreground" />
                      Apply To Email
                    </div>
                    {selectedTagMessage ? (
                      <>
                        <p className="mb-2 text-xs text-muted-foreground wrap-break-word">
                          {selectedTagMessage.subject || '(no subject)'}
                        </p>
                        <div className="space-y-1.5">
                          {mailboxTags.map((tag) => {
                            const checked = selectedTagMessage.user_tag_ids.includes(tag.id)
                            return (
                              <label
                                key={tag.id}
                                className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-xs cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => void handleToggleTagOnSelectedMessage(tag.id)}
                                  className="h-3.5 w-3.5 rounded border-border"
                                />
                                <span
                                  className="h-2.5 w-2.5 rounded-full"
                                  style={{ backgroundColor: tag.color }}
                                />
                                <span>{tag.label}</span>
                              </label>
                            )
                          })}
                        </div>
                        {mailboxTags.length === 0 && (
                          <p className="text-xs text-muted-foreground">
                            Create at least one tag to apply it to this email.
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Open a thread and select Tag on an email to edit its tags.
                      </p>
                    )}
                  </section>
                </div>
              </div>
            </div>
          </aside>
        </LeftPanelPortal>
      )}

      {/* Kept mounted on every tab so navigating (e.g. to Rule settings) never discards the rule being built. */}
      <RightPanelPortal>
        {isMobileMailboxLayout && isAutomationPanelOpen && (
          <button
            type="button"
            aria-label="Close automation panel"
            className={`fixed inset-0 ${OVERLAY_SCRIM.drawer}`}
            style={{ zIndex: automationPanelDrawerZ }}
            onClick={() => setIsAutomationPanelOpen(false)}
          />
        )}
        <MailboxAutomationPanel
          open={isAutomationPanelOpen}
          isMobileLayout={isMobileMailboxLayout}
          mobileLayerZ={automationPanelDrawerZ}
          onClose={() => setIsAutomationPanelOpen(false)}
          onOpenAssistant={openAiAssistantPanel}
          selectedRuleId={selectedAutomationRuleId}
          draft={automationDraft}
          tags={automationTagOptions}
          saving={automationSaving}
          running={automationRunning}
          dirty={automationDraftDirty}
          runResult={automationRunResult}
          runResultStale={automationRunResultStale}
          error={automationError}
          visibleMessageCount={filteredMessages.length}
          onDraftChange={setAutomationDraft}
          onSaveDraft={() => void saveAutomationDraft()}
          onRun={(scope, dryRun) => void runAutomationRule(scope, dryRun)}
          onOpenRuleSettings={() => setTabInUrl('settings', 'automations')}
          onOpenMatch={openAutomationMatch}
          onRequestCreateTag={requestCreateMailboxTag}
        />
      </RightPanelPortal>

      {isTagPickerVisible && (
          <div
            id="mailbox-tag-picker"
            className="fixed w-64 max-w-[calc(100vw-1rem)] rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-xl"
            style={{
              left: tagPickerPosition?.left ?? 16,
              top: tagPickerPosition?.top ?? clampTopBelowObstruction(16),
              zIndex: tagPickerZ,
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
            role="dialog"
            aria-label={
              tagPickerScope === 'thread' ? 'Apply tags to whole thread' : 'Mailbox tags picker'
            }
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {tagPickerScope === 'thread' ? 'Apply Tags to Thread' : 'Apply Tags'}
                </p>
              </div>
              <IconButton
                onClick={toggleMailboxTagPanel}
                intent={isTagPanelOpen ? 'primary' : 'neutral'}
                label={isTagPanelOpen ? 'Close mailbox tag panel' : 'Open mailbox tag panel'}
                icon={
                  isTagPanelOpen ? (
                    <PanelLeftClose className="h-4 w-4" />
                  ) : (
                    <PanelLeftOpen className="h-4 w-4" />
                  )
                }
              />
            </div>

            {tagPickerScope === 'thread' && threadMessages.length > 1 && (
              <div className="mb-2 rounded-md border border-warning-muted bg-warning-subtle px-2 py-1.5 text-[11px] text-warning">
                Applied to all {threadMessages.length} messages in this thread.
              </div>
            )}

            <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
              {mailboxTags.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-2.5 py-2 text-xs text-muted-foreground">
                  Create at least one tag in the Tags panel first.
                </p>
              ) : (
                mailboxTags.map((tag) => {
                  const checked =
                    tagPickerScope === 'thread'
                      ? threadMessages.every((message) => message.user_tag_ids.includes(tag.id))
                      : (selectedTagMessage?.user_tag_ids.includes(tag.id) ?? false)
                  return (
                    <label
                      key={tag.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-xs hover:bg-accent/40"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          void (tagPickerScope === 'thread'
                            ? handleToggleTagOnThread(tag.id)
                            : handleToggleTagOnSelectedMessage(tag.id))
                        }
                        className="h-3.5 w-3.5 rounded border-border"
                      />
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                      <span className="min-w-0 flex-1 truncate">{tag.label}</span>
                    </label>
                  )
                })
              )}
            </div>
          </div>
        )}

      <section className="rounded-2xl border border-border bg-card p-2.5">
        {isMobileMailboxLayout ? (
          <MailboxMobileNavigation
            tabs={mainTabs}
            activeId={activeTab}
            onSelect={selectMailboxSection}
            guide={
              activeTab === 'mailbox'
                ? {
                    isOpen: showLearnerGuide,
                    onToggle: () => setShowLearnerGuide((prev) => !prev),
                    buttonRef: learnerGuideRef,
                  }
                : undefined
            }
          />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {activeTab === 'mailbox' && (
              <Button
                ref={learnerGuideRef}
                emphasis="outline"
                intent="info"
                size="compact"
                onClick={() => setShowLearnerGuide(!showLearnerGuide)}
                aria-expanded={showLearnerGuide}
                aria-controls="mailbox-learner-guide"
                className="shrink-0"
              >
                Learner Guide
                <span
                  className={`text-[10px] font-bold transition-transform inline-block ${showLearnerGuide ? 'rotate-90' : ''}`}
                >
                  &#9654;
                </span>
              </Button>
            )}
            <AnimatedTabBar
              tabs={mainTabs}
              activeId={activeTab}
              onSelect={(tabId) => setTabInUrl(tabId)}
              ariaLabel="Mailbox sections"
              testId="mailbox-main-tabs"
              className="grid min-w-[min(100%,28rem)] flex-1 gap-1.5 sm:grid-cols-3 lg:grid-cols-4"
              buttonClassName="px-3 py-1.5 text-xs font-medium"
            />
          </div>
        )}

        {isEnriching && (
          <div
            className="mt-2 flex items-center gap-2 rounded-lg border border-border/70 bg-background/60 px-3 py-1.5 text-[11px] text-muted-foreground"
            data-testid="mailbox-enriching-notice"
            aria-live="polite"
          >
            <RefreshCw className="h-3 w-3 animate-spin motion-reduce:[animation-duration:2s]" />
            Loading people, automation rules and invitations in the background. You can keep
            working.
          </div>
        )}

        {activeTab === 'mailbox' && showLearnerGuide && (
          <div
            id="mailbox-learner-guide"
            className="mt-2 rounded-xl border border-border bg-background px-4 py-4 text-sm leading-relaxed text-foreground"
          >
            <div className="space-y-5">
              {/* Guide header */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">
                    Learner Guide
                  </p>
                  <p className="text-base font-semibold text-foreground">
                    How the Mailbox works
                  </p>
                  <p className="max-w-3xl text-sm text-muted-foreground">
                    Your email provider stays authoritative. This page adds search, threading, tags,
                    actions, AI helpers, and safer HTML viewing on top. Trash is sent to the
                    provider; archive and junk are managed in this mailbox, and local-only cleanup
                    removes the copy stored here.
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-secondary/30 p-3" data-testid="mailbox-guide-start">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                  Start here
                </p>
                <ol className="grid gap-2 text-xs text-foreground sm:grid-cols-3">
                  <li>
                    <span className="font-semibold text-foreground">1. Connect</span>{' '}
                    -- open Settings -&gt; Accounts and connect Gmail or Outlook.
                  </li>
                  <li>
                    <span className="font-semibold text-foreground">2. Import</span>{' '}
                    -- choose how much history and which provider folders to include, then start an
                    import.
                  </li>
                  <li>
                    <span className="font-semibold text-foreground">3. Work</span> --
                    search and filter the inbox, open a thread, then reply, tag, archive, junk,
                    trash, or add an invitation to a calendar.
                  </li>
                </ol>
                <Button
                  emphasis="outline"
                  size="compact"
                  onClick={() => setTabInUrl('settings', 'accounts')}
                  className="mt-3 min-h-[44px]"
                >
                  Go to Settings -&gt; Accounts
                </Button>
              </div>

              {/* Mailbox panels */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                  Mailbox panels
                </p>
                <div className="flex flex-col gap-3 overflow-hidden lg:flex-row" data-testid="mailbox-guide-panels">
                  {/* Desktop Tags motion mirrors the real side panel; mobile uses a stacked card. */}
                  <div
                    className={`${!guideTagsPanelOpen ? 'hidden lg:block' : ''} shrink-0 overflow-hidden transition-all duration-300 ease-in-out motion-reduce:transition-none`}
                    style={{
                      maxWidth: isMobileMailboxLayout ? undefined : guideTagsPanelOpen ? '360px' : '0px',
                      opacity: guideTagsPanelOpen ? 1 : 0,
                    }}
                  >
                    <section className="w-full rounded-xl border border-border bg-secondary/30 p-3 shadow-xs lg:w-[360px]">
                      <div className="flex items-center gap-2 mb-2">
                        <Tag className="h-4 w-4 shrink-0 text-primary" />
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                          Tags panel (slide-out)
                        </p>
                      </div>
                      <div className="mb-2 rounded-lg border border-border bg-background px-2.5 py-2 space-y-1.5">
                        <p className="text-[11px] font-semibold text-foreground">
                          Two kinds of tags
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          <span className="font-medium">System tags</span> -- UNREAD, DRAFT, SENT,
                          JUNK, TRASH, ARCHIVED, and ATTACHMENTS are applied automatically from
                          message state and provider flags. You cannot create or rename them.
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          <span className="font-medium">User tags</span> -- custom color labels you
                          define in the Tag Library -- are applied manually from the Tag picker on
                          any message. They are stored per user and are never synced back to your
                          provider.
                        </p>
                      </div>
                      <ul className="space-y-1.5 text-xs text-foreground">
                        <li>
                          <span className="font-medium">Tag Library</span> -- lists all user tags
                          you have created; shows label, color swatch, and a count of tagged
                          messages.
                        </li>
                        <li>
                          <span className="font-medium">Create tag</span> -- type a name, pick a
                          color with the color picker, and save. The tag immediately appears in the
                          picker dropdown.
                        </li>
                        <li>
                          <span className="font-medium">Edit / delete</span> -- rename a tag or
                          remove it; all associated message labels are cleared when you delete.
                        </li>
                        <li>
                          <span className="font-medium">Close Tags</span> -- click Close Tags or
                          click Open Tags again in the Inbox panel card.
                        </li>
                      </ul>
                    </section>
                  </div>

                  <section className="min-w-0 rounded-xl border border-border bg-secondary/30 p-3 shadow-xs lg:flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Inbox className="h-4 w-4 shrink-0 text-primary" />
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                        Inbox panel (left column)
                      </p>
                    </div>
                    <ul className="space-y-1.5 text-xs text-foreground">
                      <li>
                        <span className="font-medium">Message list</span> -- threads grouped by
                        subject; click any row to load the full thread on the right.
                      </li>
                      <li>
                        <span className="font-medium">Search bar</span> -- full-text search across
                        subject, sender, recipients, and message body.
                      </li>
                      <li>
                        <span className="font-medium">Filters</span> -- open the filter
                        panel to refine the inbox in four layers:
                        <ul className="mt-1 space-y-1 pl-4">
                          <li>
                            <span className="font-medium">Accounts</span>: checkboxes are inclusive
                            (checked = included). Use <span className="font-medium">All</span> or{' '}
                            <span className="font-medium">None</span> for one-click selection.
                          </li>
                          <li>
                            <span className="font-medium">Identity groups</span>: same
                            include/exclude behavior as accounts. Messages with a selected group
                            stay visible.
                          </li>
                          <li>
                            <span className="font-medium">Date range</span>:{' '}
                            <span className="font-medium">Date from</span> and{' '}
                            <span className="font-medium">Date to</span> apply immediately and are
                            inclusive. These two date fields reset on reload by design.
                          </li>
                          <li>
                            <span className="font-medium">Filters and sorting</span>: one saved
                            filter is active at a time. Each filter can set tag rules (
                            <span className="font-medium">Sort</span>,{' '}
                            <span className="font-medium">Only</span>,{' '}
                            <span className="font-medium">Hide</span>) and priority across Date,
                            System Tags, and Custom Tags.{' '}
                            <span className="font-medium">Make primary</span> moves a filter to the
                            top of the list; the top filter is applied whenever no saved selection
                            is available.
                          </li>
                        </ul>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Persistence: account and group selections (plus panel visibility), filter
                          definitions, and sort rules are all saved per user in this browser.
                        </p>
                      </li>
                      <li className="flex flex-wrap items-center gap-1.5">
                        <span>
                          <span className="font-medium">Tags panel</span> -- slide the Tag Library
                          in from the left:
                        </span>
                        <Button
                          emphasis="outline"
                          intent={guideTagsPanelOpen ? 'primary' : 'neutral'}
                          size="compact"
                          onClick={() => setGuideTagsPanelOpen((v) => !v)}
                          icon={
                            guideTagsPanelOpen ? (
                              <PanelLeftClose className="h-3 w-3" />
                            ) : (
                              <PanelLeftOpen className="h-3 w-3" />
                            )
                          }
                        >
                          {guideTagsPanelOpen ? 'Close Tags' : 'Open Tags'}
                        </Button>
                      </li>
                      <li>
                        <span className="font-medium">Sync</span> button -- pull the latest messages
                        from your provider using the account's saved import settings.
                      </li>
                      <li>
                        <span className="font-medium">Import progress bar</span> -- animated during
                        an import; shows elapsed time and an estimate of the remaining time.
                      </li>
                      <li>
                        <span className="font-medium">Load more / Load all</span> -- extends the
                        inbox list beyond the default {inboxLoadLimit}-message view. The load step
                        can be adjusted inline, and the default can be changed in Settings.
                      </li>
                      <li>
                        <span className="font-medium">Mass Actions</span> -- build a short list of
                        actions and apply them to the emails currently showing. A confirmation is
                        required; Reply and Forward are offered for future rule use but are not
                        executed as mass actions.
                      </li>
                    </ul>
                    <div className="mt-2.5 space-y-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        System tags (auto-applied)
                      </p>
                      <div className="flex flex-wrap gap-1">
                        <span className="rounded bg-info-subtle px-1.5 py-0.5 text-[10px] font-medium text-info">
                          UNREAD
                        </span>
                        <span className="rounded bg-warning-subtle px-1.5 py-0.5 text-[10px] font-medium text-warning">
                          JUNK
                        </span>
                        <span className="rounded bg-danger-subtle px-1.5 py-0.5 text-[10px] font-medium text-danger">
                          TRASH
                        </span>
                        <span className="rounded bg-feature-ai-subtle px-1.5 py-0.5 text-[10px] font-medium text-feature-ai">
                          ARCHIVED
                        </span>
                      </div>
                    </div>
                  </section>

                  <section className="min-w-0 rounded-xl border border-border bg-secondary/30 p-3 shadow-xs lg:flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Mail className="h-4 w-4 shrink-0 text-primary" />
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                        Thread Viewer (right column)
                      </p>
                    </div>
                    <ul className="space-y-1.5 text-xs text-foreground">
                      <li>
                        <span className="font-medium">Reply / Forward</span> -- open a draft form
                        with recipients and subject prefilled. Edit To, Cc, Bcc, subject, and body,
                        then save, send, or discard the draft.
                      </li>
                      <li>
                        <span className="font-medium">Read, Archive, Trash</span> -- change read
                        status, archive or unarchive, and move messages to or from provider trash.
                        The app confirms destructive actions unless you choose to suppress that
                        prompt.
                      </li>
                      <li>
                        <span className="font-medium">Junk</span> -- marks the sender address or
                        domain as junk; the message gets a Junk label in the inbox.
                      </li>
                      <li>
                        <span className="font-medium">Attachments</span> -- view attachment names
                        and download available files from the provider.
                      </li>
                      <li>
                        <span className="font-medium">Add to calendar</span> -- appears when an ICS
                        or human-readable event invite is detected; lets you import to a connected
                        calendar.
                      </li>
                      <li>
                        <span className="font-medium">Raw / Trusted</span> toggle -- Raw shows plain
                        text; Trusted renders sanitized HTML only for sender domains you have
                        explicitly approved. On mobile, open the format picker beside Forward to
                        choose Raw, Trusted, or System. A question mark indicates an untrusted
                        sender domain; a checkmark indicates a trusted domain.
                      </li>
                      <li>
                        <span className="font-medium">Trust domain</span> popup -- prompts when you
                        first request HTML view for an unrecognized domain. Approve once to
                        whitelist it.
                      </li>
                      <li>
                        <span className="font-medium">Tag picker</span> -- click the tag icon on any
                        message to assign or remove color tags you have defined in the Tag Library.
                      </li>
                      <li>
                        <span className="font-medium">Message details</span> -- expand source
                        metadata to inspect From, To, Cc, Bcc, Reply-To, and provider information.
                      </li>
                      <li>
                        <span className="font-medium">Back to Inbox</span> (mobile only) -- returns
                        to the message list on narrow screens using the mailbox icon in the action row.
                      </li>
                    </ul>
                  </section>
                </div>
              </div>

              {/* Navigation tabs */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                  Navigation tabs
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  <section className="rounded-xl border border-border bg-secondary/30 p-3 shadow-xs">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Inbox className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <p className="text-xs font-semibold text-foreground">
                        Mailbox
                      </p>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      The main inbox and thread viewer. Contains the Inbox panel, Thread Viewer, and
                      Tags slide-out described above.
                    </p>
                  </section>

                  <section className="rounded-xl border border-border bg-secondary/30 p-3 shadow-xs">
                    <div className="flex items-center gap-2 mb-1.5">
                      <UserRound className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <p className="text-xs font-semibold text-foreground">
                        People &amp; Domains
                      </p>
                    </div>
                    <p className="text-[11px] text-muted-foreground mb-1">
                      Manage contact identities, trusted HTML domains, and junk sender domains.
                    </p>
                    <ul className="space-y-1 text-[11px] text-muted-foreground">
                      <li>
                        <span className="font-medium">People card</span> -- groups identities (email
                        addresses) that belong to the same contact.
                      </li>
                      <li>
                        <span className="font-medium">Trust domains</span> -- whitelist sender
                        domains for HTML rendering.
                      </li>
                      <li>
                        <span className="font-medium">Junk domains</span> -- blocklist domains whose
                        messages are auto-labeled Junk.
                      </li>
                    </ul>
                  </section>

                  <section className="rounded-xl border border-border bg-secondary/30 p-3 shadow-xs">
                    <div className="flex items-center gap-2 mb-1.5">
                      <CalendarCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <p className="text-xs font-semibold text-foreground">
                        Invitations
                      </p>
                    </div>
                    <p className="text-[11px] text-muted-foreground mb-1">
                      Automatically extracted calendar invitations from your synced emails (ICS and
                      human-readable formats).
                    </p>
                    <ul className="space-y-1 text-[11px] text-muted-foreground">
                      <li>
                        Review proposed events and add them to Google Calendar, Outlook, or a
                        Coordination Calendar.
                      </li>
                      <li>Status badges: proposed, accepted, declined, imported.</li>
                    </ul>
                  </section>

                  <section className="rounded-xl border border-border bg-secondary/30 p-3 shadow-xs">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Settings2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <p className="text-xs font-semibold text-foreground">
                        Settings
                      </p>
                    </div>
                    <p className="text-[11px] text-muted-foreground mb-1">
                      Three sub-tabs:
                    </p>
                    <ul className="space-y-1 text-[11px] text-muted-foreground">
                      {(
                        [
                          {
                            key: 'accounts',
                            label: 'Accounts',
                            summary:
                              'connect Gmail or Outlook, then choose the import history and provider folders.',
                            detail:
                              'Connect Gmail or Outlook with OAuth. Each account has its own maximum message count, history window, and Inbox, Sent, Trash, and Spam folder options. You can connect multiple accounts, choose which accounts and identity groups appear in the inbox, watch import progress, retry failed imports, and remove an account (with everything imported from it) from this tab. Mailbox Analytics summarizes message volume, response behavior, response time, correspondents, attachments, and meeting-related mail from imported history.',
                          },
                          {
                            key: 'automations',
                            label: 'Automations',
                            summary:
                              'create checks and actions for newly imported mail or a visible inbox preview.',
                            detail:
                              'Each rule has a mode (Active applies actions, Dry run reports matches, Disabled skips the rule) and a match mode (all checks vs any check). Add Check steps for sender, recipients, subject, body, attachments, state, tags, account, or an AI Assessment. Add Take action steps such as tag, archive, junk, trash, or read status. A Receive action step can start a follow-up rule after an action happens; recursion is off by default. Preview visible emails before running, and use Stop after match when later rules should not process a matched message. Every new account starts with two disabled example rules for scam/phishing detection (keyword checks and an AI Assessment check) plus a "Possible Phishing" tag -- switch their mode to Dry run or Active once you have reviewed them. Copy JSON exports the current rule; paste it into the AI Assistant chat rather than into a field to import it, since the assistant resolves tag names to real tag ids and repairs any malformed steps.',
                          },
                          {
                            key: 'agent',
                            label: 'AI Assistant',
                            summary:
                              'review mailbox data access and use a guided assistant to draft automation rules.',
                            detail:
                              'The mailbox assistant can read the open email, the visible inbox sample, existing tags, saved rules, and connected account identities when those sources are enabled. It can propose deterministic checks, AI Assessment checks, and executable actions, then place the result in the rule editor. Assistant-created rules stay in Dry run and assistant runs are limited to a preview of visible emails; you must review, save, and activate a rule yourself. Pasting Copy JSON output into the assistant is the recommended way to import it -- the assistant resolves tag names/labels to the correct tag id (creating one first if it does not exist) and will tell you in chat if anything could not be resolved, rather than silently leaving a step blank.',
                          },
                        ] as const
                      ).map((tab) => (
                        <li key={tab.key}>
                          <button
                            type="button"
                            onClick={() => toggleSettingsGuideTab(tab.key)}
                            aria-expanded={!!expandedSettingsGuideTabs[tab.key]}
                            className="flex w-full items-start gap-1 text-left"
                          >
                            {expandedSettingsGuideTabs[tab.key] ? (
                              <ChevronDown className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                            ) : (
                              <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                            )}
                            <span>
                              <span className="font-medium">{tab.label}</span> -- {tab.summary}
                            </span>
                          </button>
                          {expandedSettingsGuideTabs[tab.key] && (
                            <p className="mt-1 ml-4 rounded-lg border border-border bg-background px-2 py-1.5 text-[11px] text-muted-foreground">
                              {tab.detail}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>
              </div>

              {/* Icon taxonomy */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                  Icon reference
                </p>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
                  {(
                    [
                      {
                        icon: <Search className="h-4 w-4 shrink-0" />,
                        name: 'Search',
                        desc: 'Full-text filter across subject, sender, and body',
                      },
                      {
                        icon: <Archive className="h-4 w-4 shrink-0" />,
                        name: 'Archive',
                        desc: 'Archive or unarchive a message',
                      },
                      {
                        icon: <MailOpen className="h-4 w-4 shrink-0" />,
                        name: 'Mark unread',
                        desc: 'Reset read status on a message',
                      },
                      {
                        icon: <Trash2 className="h-4 w-4 shrink-0" />,
                        name: 'Trash',
                        desc: 'Move to provider trash (local copy removed)',
                      },
                      {
                        icon: <Tag className="h-4 w-4 shrink-0" />,
                        name: 'Tag picker',
                        desc: 'Assign or remove user tags on a message',
                      },
                      {
                        icon: <PanelLeftOpen className="h-4 w-4 shrink-0" />,
                        name: 'Open Tags',
                        desc: 'Slide Tag Library panel into view',
                      },
                      {
                        icon: <PanelLeftClose className="h-4 w-4 shrink-0" />,
                        name: 'Close Tags',
                        desc: 'Dismiss Tag Library panel',
                      },
                      {
                        icon: <RefreshCw className="h-4 w-4 shrink-0" />,
                        name: 'Sync',
                        desc: 'Pull latest emails from provider',
                      },
                      {
                        icon: <CornerDownLeft className="h-4 w-4 shrink-0" />,
                        name: 'Reply',
                        desc: 'Draft a reply in the thread viewer',
                      },
                      {
                        icon: <Forward className="h-4 w-4 shrink-0" />,
                        name: 'Forward',
                        desc: 'Forward to a new recipient',
                      },
                      {
                        icon: <CalendarPlus className="h-4 w-4 shrink-0" />,
                        name: 'Add to calendar',
                        desc: 'Import a detected event invitation',
                      },
                      {
                        icon: <Palette className="h-4 w-4 shrink-0" />,
                        name: 'Color picker',
                        desc: 'Choose badge color for a user tag',
                      },
                      {
                        icon: <Plus className="h-4 w-4 shrink-0" />,
                        name: 'Add / create',
                        desc: 'New tag, account, or rule',
                      },
                      {
                        icon: <Check className="h-4 w-4 shrink-0" />,
                        name: 'Confirm',
                        desc: 'Apply or save the current action',
                      },
                      {
                        icon: <X className="h-4 w-4 shrink-0" />,
                        name: 'Dismiss',
                        desc: 'Close, cancel, or clear a filter',
                      },
                      {
                        icon: <ArrowRight className="h-4 w-4 shrink-0" />,
                        name: 'Navigate',
                        desc: 'Open or proceed to a linked item',
                      },
                    ] as { icon: React.ReactNode; name: string; desc: string }[]
                  ).map(({ icon, name, desc }) => (
                    <div
                      key={name}
                      className="flex items-start gap-2 rounded-lg border border-border bg-secondary/30 px-2.5 py-2"
                    >
                      <span className="mt-0.5 text-muted-foreground">{icon}</span>
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-foreground leading-snug">
                          {name}
                        </p>
                        <p className="text-[10px] text-muted-foreground leading-snug">
                          {desc}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Quick actions */}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  emphasis="outline"
                  size="compact"
                  onClick={toggleMailboxTagPanel}
                  icon={<Tag className="h-3.5 w-3.5" />}
                >
                  Toggle Tags Panel
                </Button>
                <Button
                  emphasis="outline"
                  size="compact"
                  onClick={navigateToMailboxSettings}
                  icon={<Settings2 className="h-3.5 w-3.5" />}
                >
                  Configure load limit
                </Button>
                <Button
                  emphasis="outline"
                  size="compact"
                  onClick={() => setTabInUrl('people', 'accounts')}
                  icon={<UserRound className="h-3.5 w-3.5" />}
                >
                  Go to People &amp; Domains
                </Button>
                <Button
                  emphasis="outline"
                  size="compact"
                  onClick={() => setTabInUrl('invitations', 'accounts')}
                  icon={<CalendarCheck className="h-3.5 w-3.5" />}
                >
                  Go to Invitations
                </Button>
                <Button
                  emphasis="outline"
                  size="compact"
                  onClick={() => setTabInUrl('settings', 'automations')}
                  icon={<Bot className="h-3.5 w-3.5" />}
                >
                  Go to Automations
                </Button>
              </div>
            </div>
          </div>
        )}
      </section>

      {activeTab === 'mailbox' && calendarDeliveryBanners}
      {activeTab === 'mailbox' && (
        <section
          ref={mailboxSplitRef}
          className={`flex min-h-[560px] gap-3 ${showLearnerGuide ? 'h-[78vh]' : 'h-[84vh]'}`}
        >
          {(!isMobileMailboxLayout || mobileMailboxScreen === 'list') && (
            <article
              className="rounded-2xl border border-border bg-card p-4 flex flex-col h-full min-w-[280px]"
              style={
                !isMobileMailboxLayout
                  ? { width: `${Math.round(inboxPanelRatio * 100)}%` }
                  : { width: '100%' }
              }
            >
              <div className="mb-3 space-y-3">
                <div ref={inboxHeaderRef} className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">Inbox</h2>
                  <div className="flex items-center gap-2">
                    {!isInboxHeaderCompact && (
                      <span className="text-xs text-muted-foreground">{messagesTotal} total</span>
                    )}
                    <Button
                      emphasis="outline"
                      intent="primary"
                      size="compact"
                      onClick={openNewDraft}
                      disabled={!hasConnectedAccounts}
                      className="whitespace-nowrap"
                      title={
                        hasConnectedAccounts ? 'Compose a new email' : 'Connect an account first'
                      }
                      aria-label="Compose a new email"
                      icon={<Pencil className="h-3.5 w-3.5" />}
                    >
                      {showNewEmailLabel && <span>New Email</span>}
                    </Button>
                    <ToggleButton
                      size="compact"
                      pressed={isTagPanelOpen}
                      onPressedChange={() => toggleMailboxTagPanel()}
                      className="whitespace-nowrap"
                      title={
                        isTagPanelOpen ? 'Close mailbox tag library' : 'Open mailbox tag library'
                      }
                      aria-label={
                        isTagPanelOpen ? 'Close mailbox tag library' : 'Open mailbox tag library'
                      }
                      icon={
                        isTagPanelOpen ? (
                          <PanelLeftClose className="h-3.5 w-3.5" />
                        ) : (
                          <PanelLeftOpen className="h-3.5 w-3.5" />
                        )
                      }
                    >
                      {!isInboxHeaderCompact && (
                        <span>{isTagPanelOpen ? 'Close Tags' : 'Tags'}</span>
                      )}
                    </ToggleButton>
                    <Button
                      emphasis="outline"
                      size="compact"
                      onClick={() => void handleFetchNewMail()}
                      disabled={!hasConnectedAccounts || hasBackgroundSync}
                      className="whitespace-nowrap"
                      title="Fetch new emails from connected accounts"
                      aria-label="Quick Sync"
                      icon={<RefreshCw className={`h-3.5 w-3.5 ${hasBackgroundSync ? 'animate-spin motion-reduce:[animation-duration:2s]' : ''}`} />}
                    >
                      {!isInboxHeaderCompact && <span>Quick Sync</span>}
                    </Button>
                  </div>
                </div>
                <div className="grid gap-2">
                  <div className="flex items-center gap-2">
                    <div
                      className={`relative flex-1 rounded-lg ${
                        additionalFiltersHighlightActive ? 'mailbox-filter-highlight-trace' : ''
                      }`}
                    >
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        value={queryInput}
                        onChange={(e) => setQueryInput(e.target.value)}
                        placeholder="Search subject, sender, recipients, and content"
                        className={`w-full rounded-lg border bg-background pl-9 pr-3 py-2 text-xs transition-colors focus:outline-hidden focus:ring-2 focus:ring-ring ${
                          isSearchComputing
                            ? 'border-warning-muted ring-1 ring-warning-muted animate-pulse motion-reduce:[animation-duration:3s]'
                            : 'border-input'
                        }`}
                      />
                    </div>
                    <Button
                      emphasis="outline"
                      intent={showAdditionalFilters ? 'primary' : 'neutral'}
                      size="compact"
                      onClick={() => setShowAdditionalFilters((prev) => !prev)}
                      className="shrink-0"
                    >
                      Filters
                    </Button>
                  </div>
                </div>
              </div>

              {/* Filters, notices and the message list share one scroll region, so the panel is clipped behind the search row instead of scrolling on its own. */}
              <div
                ref={(node) => {
                  if (node && isMobileMailboxLayout) node.scrollTop = mailboxListScrollTopRef.current
                }}
                onScroll={(event) => {
                  mailboxListScrollTopRef.current = event.currentTarget.scrollTop
                }}
                data-testid="mailbox-inbox-scroll"
                className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1"
              >
                {showAdditionalFilters && (
                  <div className="mb-2 space-y-2 rounded-lg border border-border/70 bg-background/40 p-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="min-w-0 rounded-lg border border-input bg-background p-2">
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                          <button
                            type="button"
                            onClick={() => setIsAccountFilterListExpanded((prev) => !prev)}
                            aria-expanded={isAccountFilterListExpanded}
                            title={
                              isAccountFilterListExpanded
                                ? 'Collapse account list'
                                : 'Expand account list'
                            }
                            className="inline-flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-0.5 text-[11px] font-semibold uppercase text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                          >
                            {isAccountFilterListExpanded ? (
                              <ChevronUp className="h-3 w-3 shrink-0" />
                            ) : (
                              <ChevronDown className="h-3 w-3 shrink-0" />
                            )}
                            <span className="truncate">
                              {excludedAccountIds.length === 0
                                ? 'All accounts'
                                : `${selectedAccountIds.length}/${accounts.length} accounts`}
                            </span>
                          </button>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              emphasis="outline"
                              size="compact"
                              onClick={() => setExcludedAccountIds([])}
                              disabled={excludedAccountIds.length === 0}
                            >
                              All
                            </Button>
                            <Button
                              emphasis="outline"
                              size="compact"
                              onClick={() =>
                                setExcludedAccountIds(accounts.map((account) => account.id))
                              }
                              disabled={accounts.length === 0 || selectedAccountIds.length === 0}
                            >
                              None
                            </Button>
                          </div>
                        </div>
                        <div
                          className={`space-y-1 overflow-y-auto pr-1 ${isAccountFilterListExpanded ? 'max-h-64' : 'hidden'}`}
                        >
                          {accounts.length === 0 && (
                            <p className="text-[11px] text-muted-foreground">
                              No connected accounts.
                            </p>
                          )}
                          {accounts.map((account) => (
                            <label
                              key={account.id}
                              className="flex cursor-pointer items-center gap-2 text-xs"
                            >
                              <input
                                type="checkbox"
                                checked={!excludedAccountIds.includes(account.id)}
                                onChange={() => toggleAccountFilter(account.id)}
                                className="h-4 w-4 shrink-0 rounded border-input accent-primary"
                              />
                              <span className="truncate" title={account.address}>
                                {account.address}
                              </span>
                            </label>
                          ))}
                        </div>
                        {!isAccountFilterListExpanded && (
                          <p
                            className="truncate text-[11px] text-muted-foreground"
                            title={selectedAccountSummary}
                          >
                            {selectedAccountSummary}
                          </p>
                        )}
                      </div>

                      <div className="min-w-0 rounded-lg border border-input bg-background p-2">
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                          <button
                            type="button"
                            onClick={() => setIsGroupFilterListExpanded((prev) => !prev)}
                            aria-expanded={isGroupFilterListExpanded}
                            title={
                              isGroupFilterListExpanded
                                ? 'Collapse group list'
                                : 'Expand group list'
                            }
                            className="inline-flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-0.5 text-[11px] font-semibold uppercase text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                          >
                            {isGroupFilterListExpanded ? (
                              <ChevronUp className="h-3 w-3 shrink-0" />
                            ) : (
                              <ChevronDown className="h-3 w-3 shrink-0" />
                            )}
                            <span className="truncate">
                              {excludedGroups.length === 0
                                ? 'All groups'
                                : `${selectedGroups.length}/${uniqueGroups.length} groups`}
                            </span>
                          </button>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              emphasis="outline"
                              size="compact"
                              onClick={() => setExcludedGroups([])}
                              disabled={excludedGroups.length === 0}
                            >
                              All
                            </Button>
                            <Button
                              emphasis="outline"
                              size="compact"
                              onClick={() => setExcludedGroups(uniqueGroups)}
                              disabled={uniqueGroups.length === 0 || selectedGroups.length === 0}
                            >
                              None
                            </Button>
                          </div>
                        </div>
                        <div
                          className={`space-y-1 overflow-y-auto pr-1 ${isGroupFilterListExpanded ? 'max-h-64' : 'hidden'}`}
                        >
                          {uniqueGroups.length === 0 && (
                            <p className="text-[11px] text-muted-foreground">No identity groups.</p>
                          )}
                          {uniqueGroups.map((group) => (
                            <label
                              key={group}
                              className="flex cursor-pointer items-center gap-2 text-xs"
                            >
                              <input
                                type="checkbox"
                                checked={!excludedGroups.includes(group)}
                                onChange={() => toggleGroupFilter(group)}
                                className="h-4 w-4 shrink-0 rounded border-input accent-primary"
                              />
                              <span className="truncate" title={group}>
                                {group}
                              </span>
                            </label>
                          ))}
                        </div>
                        {!isGroupFilterListExpanded && (
                          <p
                            className="truncate text-[11px] text-muted-foreground"
                            title={selectedGroupSummary}
                          >
                            {selectedGroupSummary}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="flex min-w-0 flex-col gap-1 text-xs">
                        <span className="text-muted-foreground">Date from</span>
                        <div
                          className={`min-w-0 rounded-lg ${
                            additionalFiltersHighlightActive && dateFromFilter
                              ? 'mailbox-filter-highlight-trace'
                              : ''
                          }`}
                        >
                          <input
                            type="date"
                            value={dateFromFilter}
                            onChange={(e) => setDateFromFilter(e.target.value)}
                            className="min-w-0 w-full rounded-lg border border-input bg-background px-3 py-2 text-xs"
                          />
                        </div>
                      </label>
                      <label className="flex min-w-0 flex-col gap-1 text-xs">
                        <span className="text-muted-foreground">Date to</span>
                        <div
                          className={`min-w-0 rounded-lg ${
                            additionalFiltersHighlightActive && dateToFilter
                              ? 'mailbox-filter-highlight-trace'
                              : ''
                          }`}
                        >
                          <input
                            type="date"
                            value={dateToFilter}
                            onChange={(e) => setDateToFilter(e.target.value)}
                            className="min-w-0 w-full rounded-lg border border-input bg-background px-3 py-2 text-xs"
                          />
                        </div>
                      </label>
                    </div>

                    <div className="rounded-lg border border-input bg-background p-2">
                      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                        <span className="min-w-0 truncate text-[11px] font-semibold uppercase text-muted-foreground">
                          Filters and sorting
                        </span>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            emphasis="outline"
                            size="compact"
                            onClick={() => setIsAddingFilter((prev) => !prev)}
                            disabled={!canCreateMailboxFilter(filterState)}
                            title={
                              canCreateMailboxFilter(filterState)
                                ? 'Create a filter'
                                : `Limit of ${MAILBOX_MAX_FILTERS} filters reached`
                            }
                            icon={<Plus className="h-3 w-3" />}
                          >
                            New filter
                          </Button>
                        </div>
                      </div>

                      {isAddingFilter && (
                        <div className="mb-1.5 flex items-center gap-1">
                          <input
                            value={newFilterName}
                            onChange={(e) => setNewFilterName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                createCustomFilter()
                              }
                            }}
                            placeholder="Filter name"
                            maxLength={40}
                            aria-label="New filter name"
                            className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-[11px]"
                          />
                          <Button
                            emphasis="outline"
                            intent="primary"
                            size="compact"
                            onClick={createCustomFilter}
                            disabled={!newFilterName.trim()}
                          >
                            Create
                          </Button>
                          <Button
                            emphasis="ghost"
                            size="compact"
                            onClick={() => {
                              setIsAddingFilter(false)
                              setNewFilterName('')
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      )}

                      <div className="space-y-1">
                        {orderMailboxFiltersPrimaryFirst(filterState.filters, primaryFilterId).map((filter) => {
                          const isActive = filterState.activeFilterId === filter.id
                          const isPrimary = isPrimaryMailboxFilter(primaryFilterId, filter.id)
                          const isEditing = expandedFilterIds.includes(filter.id)
                          const isRenaming = renamingFilterId === filter.id
                          const deletable = canDeleteMailboxFilter(filterState)

                          return (
                            <div
                              key={filter.id}
                              className={`rounded-md border transition-colors ${
                                isActive
                                  ? 'border-primary/60 bg-primary/5'
                                  : 'border-border bg-background'
                              }`}
                            >
                              {/* The highlight is suppressed over action buttons so it only ever advertises selecting the filter. */}
                              <div
                                className={`flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors ${
                                  isRenaming || isActive
                                    ? ''
                                    : 'hover:bg-accent/50 has-[[data-row-action]:hover]:bg-transparent'
                                }`}
                              >
                                <input
                                  type="radio"
                                  name="mailbox-active-filter"
                                  checked={isActive}
                                  onChange={() => selectCustomFilter(filter.id)}
                                  aria-label={`Apply the ${filter.name} filter`}
                                  className="h-3.5 w-3.5 shrink-0 border-input accent-primary"
                                />
                                {/* Opaque background keeps the config button readable while the row highlights underneath. */}
                                <IconButton
                                  size="micro"
                                  emphasis={isEditing ? 'solid' : 'outline'}
                                  intent={isEditing ? 'primary' : 'neutral'}
                                  data-row-action
                                  onClick={() => toggleFilterConfiguration(filter.id)}
                                  aria-expanded={isEditing}
                                  label={`Show rules and sort order for ${filter.name}`}
                                  title="Show rules and sort order"
                                  icon={<Settings2 />}
                                />
                                <span
                                  className={`overflow-hidden transition-all duration-200 ease-out ${
                                    isEditing && !isRenaming
                                      ? 'max-w-[24px] opacity-100'
                                      : 'max-w-0 opacity-0'
                                  }`}
                                >
                                  <IconButton
                                    size="micro"
                                    emphasis="outline"
                                    onClick={() => startRenamingFilter(filter.id, filter.name)}
                                    tabIndex={isEditing && !isRenaming ? 0 : -1}
                                    label={`Rename the ${filter.name} filter`}
                                    title="Rename filter"
                                    icon={<Pencil />}
                                  />
                                </span>

                                {isRenaming ? (
                                  <>
                                    <input
                                      value={renameDraft}
                                      onChange={(e) => setRenameDraft(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault()
                                          saveFilterName()
                                        }
                                        if (e.key === 'Escape') {
                                          e.preventDefault()
                                          cancelRenamingFilter()
                                        }
                                      }}
                                      autoFocus
                                      maxLength={40}
                                      aria-label={`Filter name for ${filter.name}`}
                                      className="min-w-0 flex-1 rounded border border-primary bg-primary/10 px-1 py-0.5 text-[11px] font-medium text-foreground ring-1 ring-primary focus:outline-hidden"
                                    />
                                    <Button
                                      size="micro"
                                      emphasis="outline"
                                      intent="primary"
                                      onClick={saveFilterName}
                                      disabled={!renameDraft.trim()}
                                      className="shrink-0"
                                    >
                                      Save
                                    </Button>
                                    <IconButton
                                      size="micro"
                                      onClick={cancelRenamingFilter}
                                      label="Cancel renaming"
                                      title="Discard the new name"
                                      icon={<X />}
                                    />
                                  </>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => selectCustomFilter(filter.id)}
                                      title={
                                        isActive ? 'This filter is applied' : 'Apply this filter'
                                      }
                                      className="flex min-w-0 flex-1 items-center px-1 py-0.5 text-left"
                                    >
                                      <span
                                        className={`truncate text-[11px] font-medium ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}
                                      >
                                        {filter.name}
                                      </span>
                                    </button>
                                    <span
                                      className={`overflow-hidden transition-all duration-200 ease-out ${
                                        isEditing ? 'max-w-[96px] opacity-100' : 'max-w-0 opacity-0'
                                      }`}
                                    >
                                      <Button
                                        size="micro"
                                        emphasis="outline"
                                        intent={isPrimary ? 'primary' : 'neutral'}
                                        data-row-action
                                        onClick={() => makeFilterPrimary(filter.id)}
                                        disabled={isPrimary}
                                        tabIndex={isEditing ? 0 : -1}
                                        className="shrink-0 whitespace-nowrap"
                                        title={
                                          isPrimary
                                            ? 'Primary filter: applied when saved settings are missing'
                                            : 'Move this filter to the top and use it as the default view'
                                        }
                                        aria-label={
                                          isPrimary
                                            ? `${filter.name} is the primary filter`
                                            : `Make the ${filter.name} filter primary`
                                        }
                                      >
                                        {isPrimary ? 'Primary' : 'Make primary'}
                                      </Button>
                                    </span>
                                    <IconButton
                                      size="micro"
                                      intent="danger"
                                      data-row-action
                                      onClick={() => deleteCustomFilter(filter.id)}
                                      disabled={!deletable}
                                      title={
                                        deletable
                                          ? 'Delete filter'
                                          : 'The last filter cannot be deleted'
                                      }
                                      label={`Delete the ${filter.name} filter`}
                                      icon={<Trash2 />}
                                    />
                                  </>
                                )}
                              </div>
                              {isEditing && (
                                <div className="border-t border-border p-1.5">
                                  <MailboxSortOrderEditor
                                    value={filter.sort}
                                    onChange={(sort) => updateCustomFilterSort(filter.id, sort)}
                                    resolveUserTagLabel={resolveUserTagLabel}
                                    onRequestTagPanel={() => setIsTagPanelOpen(true)}
                                  />
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>

                      <p className="mt-1.5 text-[10px] text-muted-foreground">
                        Click a row to apply that filter. Use the config button to edit its rules
                        and sort order, where a tag set to Hide is removed from the inbox and Only
                        restricts the inbox to it. Make primary moves a filter to the top of the
                        list, and the top filter is applied whenever saved settings are missing.
                        Saved per user in this browser.
                      </p>
                    </div>
                  </div>
                )}

                <MailboxMassActionsPanel
                  isOpen={showMassActions}
                  onToggle={() => setShowMassActions((prev) => !prev)}
                  tags={automationTagOptions}
                  visibleCount={displayedMessages.length}
                  canCascade={hasReceiveActionRules}
                  isApplying={massActionRunning}
                  error={massActionError}
                  result={massActionResult}
                  onApply={(actions, cascade) => void applyMassActions(actions, cascade)}
                  onRequestCreateTag={requestCreateMailboxTag}
                />

                {activeSyncAccountId && syncUiByAccountId[activeSyncAccountId] && (
                  <MailboxSyncProgress
                    view={syncUiByAccountId[activeSyncAccountId]}
                    variant="banner"
                  />
                )}

                {reconnectRequiredAccounts.map((account) => (
                  <div
                    key={account.id}
                    className="mb-3 rounded-lg border border-warning-muted bg-warning-subtle px-3 py-3 text-foreground"
                    data-testid="mailbox-reconnect-warning"
                    role="alert"
                  >
                    <div className="flex items-start gap-2">
                      <CircleOff className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">Email sync paused</p>
                        <p className="mt-0.5 wrap-break-word text-xs">
                          {account.address} needs to be reconnected before new emails can arrive.
                        </p>
                      </div>
                      <Button
                        intent="primary"
                        size="compact"
                        onClick={() => handleReconnectAccount(account)}
                        className="shrink-0"
                      >
                        Reconnect {account.provider === 'gmail' ? 'Gmail' : 'Outlook'}
                      </Button>
                    </div>
                  </div>
                ))}

                {accounts
                  .filter((account) => quickSyncGuidanceAccountIds.includes(account.id))
                  .map((account) => (
                  <div
                    key={account.id}
                    className="mb-3 rounded-lg border border-info-muted bg-info-subtle px-3 py-3 text-info dark:border-info-muted"
                    data-testid="mailbox-inbox-sync-disabled-warning"
                    role="status"
                  >
                    <div className="flex items-start gap-2">
                      <CircleOff className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">Looking for inbox mail?</p>
                        <p className="mt-0.5 wrap-break-word text-xs">
                          Quick Sync for {account.address} currently excludes Inbox. Enable it if
                          you want manual Quick Sync checks to include new inbox messages.
                        </p>
                      </div>
                      <Button
                        emphasis="outline"
                        size="compact"
                        onClick={() => {
                          setTabInUrl('settings', 'accounts')
                          setShowConnectedCard(true)
                          setShowConnectCard(false)
                          setExpandedAccountIds((prev) =>
                            prev.includes(account.id) ? prev : [...prev, account.id]
                          )
                          setExpandedAccountSettings((prev) => ({
                            ...prev,
                            [account.id]: { ...prev[account.id], quick: true },
                          }))
                        }}
                        className="shrink-0"
                      >
                        Review Quick Sync
                      </Button>
                    </div>
                  </div>
                  ))}

                {oauthNotice && oauthNotice.message === '__history_prompt__' && (
                  <div className="mb-3 rounded-lg border border-success-muted bg-success-subtle p-3 space-y-2">
                    <p className="text-sm font-medium text-success">
                      Account connected successfully.
                    </p>
                    <p className="text-xs text-success">
                      Would you like to import your email history into the mailbox?
                    </p>
                    <div className="flex gap-2">
                      <Button
                        intent="primary"
                        size="compact"
                        onClick={() => {
                          setOauthNotice(null)
                          setTabInUrl('settings', 'accounts')
                          setShowConnectedCard(true)
                          setShowConnectCard(false)
                          // Expand the most recently connected account's sync settings and pulse its CTAs
                          const targetAccountId = accounts[0]?.id ?? null
                          if (targetAccountId) {
                            setExpandedAccountIds((prev) =>
                              prev.includes(targetAccountId) ? prev : [...prev, targetAccountId]
                            )
                          }
                          setHighlightSyncCtaAccountId(targetAccountId)
                          setTimeout(() => setHighlightSyncCtaAccountId(null), 5000)
                        }}
                      >
                        Yes, open import settings
                      </Button>
                      <Button
                        emphasis="ghost"
                        size="compact"
                        onClick={() => setOauthNotice(null)}
                      >
                        Not now
                      </Button>
                    </div>
                  </div>
                )}

                {oauthNotice && oauthNotice.message !== '__history_prompt__' && (
                  <div
                    className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
                      oauthNotice.type === 'success'
                        ? 'border-success-muted bg-success-subtle text-success'
                        : 'border-danger-muted bg-danger-subtle text-danger'
                    }`}
                  >
                    {oauthNotice.message}
                  </div>
                )}

                {error && (
                  <div className="mb-3 rounded-lg border border-danger-muted bg-danger-subtle px-3 py-3 text-sm text-danger space-y-2">
                    <div className="font-semibold">Error: {error}</div>
                    <p className="text-xs opacity-90">If the issue persists, try:</p>
                    <ul className="text-xs opacity-90 list-disc list-inside space-y-1">
                      <li>Reconnecting your email account</li>
                      <li>Checking your email provider's app password or permissions</li>
                      <li>Waiting a few minutes if you see rate limit errors</li>
                    </ul>
                    {inaccessibleThread && (
                      <Button
                        intent="danger"
                        size="compact"
                        onClick={handleCleanupInaccessibleThread}
                      >
                        Clean up inaccessible email
                      </Button>
                    )}
                  </div>
                )}

                {!isLoading && !hasConnectedAccounts && (
                  <div className="mb-3 rounded-lg border border-warning-muted bg-warning-subtle px-3 py-2 text-sm text-warning">
                    No accounts are connected yet.
                    <button
                      onClick={() => {
                        setTabInUrl('settings', 'accounts')
                        setShowConnectCard(true)
                        setShowConnectedCard(true)
                      }}
                      className="ml-2 underline underline-offset-2 font-semibold"
                    >
                      Open Accounts setup
                    </button>
                  </div>
                )}

                <div className="space-y-1">
                  {isCheckingNewMail && (
                    <div
                      className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-background/60 px-2 py-1.5 text-[11px] text-muted-foreground"
                      data-testid="mailbox-new-mail-check"
                      aria-live="polite"
                    >
                      <RefreshCw className="h-3 w-3 animate-spin motion-reduce:[animation-duration:2s]" />
                      <span>Checking your accounts for new mail...</span>
                    </div>
                  )}
                  {(isLoading || !areFiltersReady) && <InboxSkeletonRows />}
                  {!isLoading &&
                    areFiltersReady &&
                    displayedMessages.map((message) => {
                      const messageIsJunk = isMessageJunk(message)
                      const isInSelectedThread =
                        Boolean(message.thread_id) && selectedThread?.id === message.thread_id
                      const isFocusedMailboxMessage = focusedThreadMessageId === message.id
                      const isOpeningMailboxMessage =
                        isMobileMailboxLayout && openingMailboxMessageId === message.id
                      const isFilterVanishing = filterVanishingMessageIds.has(message.id)
                      const isExiting = removingMessageIds.has(message.id)
                      const isRemoving = isExiting || isFilterVanishing
                      const isMailboxMessageHovered = hoveredMailboxMessageId === message.id
                      const isMailboxMessageFading = fadingMailboxMessageId === message.id
                      const isSettlingAfterTagRemoval = settlingMessageIds.has(message.id)

                      return (
                        <div
                          key={message.id}
                          data-testid="mailbox-message-slot"
                          data-message-id={message.id}
                          data-exiting={isExiting || undefined}
                          className={`grid grid-cols-[minmax(0,1fr)] ease-in-out motion-reduce:transition-none ${
                            isExiting
                              ? 'grid-rows-[0fr] mb-0 transition-[grid-template-rows,margin]'
                              : 'grid-rows-[1fr]'
                          }`}
                          style={
                            isExiting
                              ? {
                                  transitionDuration: `${MAILBOX_ROW_COLLAPSE_MS}ms`,
                                  transitionDelay: `${MAILBOX_ROW_COLLAPSE_DELAY_MS}ms`,
                                }
                              : undefined
                          }
                        >
                        <div className={`min-h-0 min-w-0 ${isExiting ? 'overflow-hidden' : ''}`}>
                        <div
                          data-testid="mailbox-message-row"
                          onMouseEnter={() => handleMailboxMessageHoverEnter(message.id)}
                          onMouseLeave={() => handleMailboxMessageHoverLeave(message.id)}
                          onClick={() => void handleOpenThreadFromInbox(message)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              void handleOpenThreadFromInbox(message)
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          aria-hidden={isRemoving || undefined}
                          aria-busy={isOpeningMailboxMessage || undefined}
                          style={{
                            transitionDuration: isExiting
                              ? `${MAILBOX_ROW_FADE_MS}ms`
                              : isMailboxMessageHovered
                                ? '150ms'
                                : isFilterVanishing
                                  ? `${MAILBOX_FILTER_HIDE_MS}ms`
                                  : isSettlingAfterTagRemoval
                                    ? `${MAILBOX_TAG_SETTLE_MS}ms`
                                    : '600ms',
                          }}
                          className={`relative w-full rounded-lg border px-2 py-1.5 text-left transition-all motion-reduce:transition-none focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                            isRemoving
                              ? 'pointer-events-none -translate-x-4 scale-[0.98] opacity-0'
                              : ''
                          } ${
                            isOpeningMailboxMessage
                              ? 'border-primary bg-primary/20 ring-1 ring-primary/40'
                              : isMailboxMessageHovered
                              ? 'border-feature-ai-muted bg-feature-ai-subtle ring-1 ring-feature-ai-muted dark:border-feature-ai-muted bg-feature-ai-subtle dark:ring-feature-ai-muted'
                              : isMailboxMessageFading
                                ? 'border-feature-ai-muted bg-feature-ai-subtle ring-1 ring-feature-ai-muted dark:border-feature-ai-muted bg-feature-ai-subtle dark:ring-feature-ai-muted'
                                : isFocusedMailboxMessage
                                  ? 'border-primary bg-primary/30 ring-1 ring-primary/40'
                                  : isInSelectedThread
                                  ? 'border-primary bg-primary/20'
                                  : 'border-border bg-background'
                          }`}
                        >
                          {isOpeningMailboxMessage && (
                            <>
                              <span
                                aria-hidden="true"
                                className="pointer-events-none absolute inset-0 rounded-lg"
                              >
                                <span className="mailbox-filter-highlight-trace block h-full" />
                              </span>
                              <span role="status" className="sr-only">
                                Loading email details...
                              </span>
                            </>
                          )}
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="truncate text-xs font-semibold">
                                {message.from_name || message.from_email || 'Unknown'}
                              </p>
                              <div className="flex min-w-0 flex-wrap items-center gap-1">
                                <p className="min-w-0 max-w-full truncate text-[11px] text-muted-foreground">
                                  {message.subject || '(no subject)'}
                                </p>
                              </div>
                            </div>
                            <span className="text-[10px] text-muted-foreground shrink-0 ml-1">
                              {formatTimestamp(message.received_at, userDateFormat)}
                            </span>
                          </div>
                          {/* Buttons stay on the tag line while they fit and wrap below the tags only on overlap. */}
                          <div className="mt-1.5 flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
                            <div className="mr-auto flex min-w-0 flex-wrap items-center gap-1 text-[9px]">
                              {messageIsJunk && (
                                <span className="rounded bg-warning-subtle px-1.5 py-0.5 text-warning">
                                  JUNK
                                </span>
                              )}
                              {message.is_draft && (
                                <span data-testid="mailbox-draft-badge" className="rounded border border-border bg-card px-1.5 py-0.5 font-semibold text-card-foreground">
                                  Draft
                                </span>
                              )}
                              {!message.is_read && (
                                <span className="rounded bg-info-subtle text-info px-1.5 py-0.5">
                                  UNREAD
                                </span>
                              )}
                              {message.is_provider_sent && (
                                <span className="rounded bg-success-subtle px-1.5 py-0.5 text-success">
                                  SENT
                                </span>
                              )}
                              {message.has_attachments && (
                                <span className="rounded bg-feature-ai-subtle text-feature-ai px-1.5 py-0.5">
                                  FILE
                                </span>
                              )}
                              {message.is_archived && (
                                <span className="inline-flex items-center gap-1 rounded bg-warning-subtle px-1.5 py-0.5 text-warning">
                                  <Archive className="h-3 w-3" />
                                  ARCHIVE
                                </span>
                              )}
                              {message.is_provider_trashed && (
                                <span className="rounded bg-danger-subtle text-danger px-1.5 py-0.5">
                                  TRASH
                                </span>
                              )}
                              {getDisplayTagIds(message).map((tagId) => {
                                const tag = mailboxTagById.get(tagId)
                                if (!tag) return null
                                const isTagFading = fadingTagRemovals.get(message.id)?.has(tagId) ?? false
                                return (
                                  <span
                                    key={tag.id}
                                    className={`rounded px-1.5 py-0.5 transition-opacity ease-out motion-reduce:transition-none ${isTagFading ? 'opacity-0' : 'opacity-100'}`}
                                    style={{
                                      backgroundColor: `${tag.color}22`,
                                      color: tag.color,
                                      transitionDuration: `${MAILBOX_TAG_FADE_MS}ms`,
                                    }}
                                  >
                                    {tag.label}
                                  </span>
                                )
                              })}
                            </div>
                            <div className="ml-auto flex shrink-0 items-center gap-1">
                              <IconButton
                                emphasis="outline"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  openTagPickerForMessage(message.id, event.currentTarget)
                                }}
                                label="Apply or remove tags"
                                icon={<Tag className="h-3.5 w-3.5" />}
                              />
                              {message.is_provider_trashed && (
                                <IconButton
                                  emphasis="outline"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    handleRestoreMessage(message.id)
                                  }}
                                  label="Restore from provider trash"
                                  icon={<TrashRestore className="h-4 w-4" aria-hidden="true" />}
                                />
                              )}
                              {!message.is_provider_trashed && !message.is_draft && (
                                <>
                                  <IconButton
                                    emphasis="outline"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      void handleArchive(message.id, !message.is_archived)
                                    }}
                                    label={
                                      message.is_archived ? 'Unarchive message' : 'Archive message'
                                    }
                                    icon={<Archive className="h-3.5 w-3.5" />}
                                  />
                                  <IconButton
                                    emphasis="outline"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      void handleMarkRead(message.id, false)
                                    }}
                                    label="Mark as unread"
                                    icon={<MailOpen className="h-3.5 w-3.5" />}
                                  />
                                </>
                              )}
                              <IconButton
                                emphasis="outline"
                                intent={message.is_provider_trashed ? 'neutral' : 'danger'}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  handleTrashMessage(message, event)
                                }}
                                label={
                                  message.is_provider_trashed
                                    ? 'Remove local copy (keeps it in provider trash)'
                                    : 'Move to trash'
                                }
                                icon={<Trash2 className="h-3.5 w-3.5" />}
                              />
                            </div>
                          </div>
                        </div>
                        </div>
                        </div>
                      )
                    })}
                  {!isLoading && displayedMessages.length === 0 && hasConnectedAccounts && (
                    <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground text-center space-y-3">
                      {messagesTotal > 0 ? (
                        <>
                          <p className="font-medium text-foreground">
                            No emails need attention with the current filters.
                          </p>
                          <p className="text-xs">
                            The synced emails have been addressed, hidden, or excluded by your
                            current search and filter rules.
                          </p>
                          <Button
                            emphasis="outline"
                            intent="primary"
                            size="compact"
                            onClick={selectShowAllFilter}
                          >
                            Show addressed emails
                          </Button>
                        </>
                      ) : (
                        <div className="flex flex-wrap justify-center gap-2">
                          {accounts
                            .filter((a) => a.status !== 'disconnected')
                            .map((account) => (
                              <Button
                                key={account.id}
                                intent="primary"
                                size="compact"
                                onClick={() => void handleSyncAccount(account.id)}
                                disabled={
                                  Boolean(syncUiByAccountId[account.id]) ||
                                  syncingAccountId === account.id
                                }
                              >
                                {syncUiByAccountId[account.id] &&
                                  syncUiByAccountId[account.id].phase !== 'complete' && (
                                    <span className="inline-block h-3 w-3 rounded-full border border-transparent border-t-primary-foreground animate-spin" />
                                  )}
                                {syncUiByAccountId[account.id]
                                  ? syncUiByAccountId[account.id].label
                                  : `Import from ${account.address}`}
                              </Button>
                            ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div
                className="mt-3 rounded-lg border border-border/70 bg-background/70 p-3 space-y-3"
                data-testid="mailbox-load-more-panel"
              >
                {isLoading ? (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <span className="inline-block h-3 w-3 rounded-full border border-transparent border-t-primary animate-spin" />
                    Loading synced emails...
                  </p>
                ) : isLoadingMoreMessages ? (
                  <p
                    className="text-xs text-muted-foreground flex items-center gap-1.5"
                    data-testid="mailbox-checking-progress"
                  >
                    <span className="inline-block h-3 w-3 rounded-full border border-transparent border-t-primary animate-spin" />
                    {loadMoreProgress
                      ? `Checking ${loadMoreProgress.checked} of ${loadMoreProgress.total} synced emails...`
                      : 'Checking synced emails...'}
                  </p>
                ) : !canLoadMoreMessages ? (
                  <div className="flex items-center justify-between gap-3">
                    <p
                      className="text-xs text-muted-foreground"
                      data-testid="mailbox-showing-count"
                    >
                      Showing {displayedMessages.length} of {messagesTotal} synced emails
                    </p>
                    <p className="text-xs text-muted-foreground">All emails have been loaded.</p>
                  </div>
                ) : displayedMessages.length >= visibleTarget ? (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <p
                        className="text-xs text-muted-foreground"
                        data-testid="mailbox-showing-count"
                      >
                        Showing {displayedMessages.length} of {messagesTotal} synced emails
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {remainingSyncedMessages} remaining
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        intent="primary"
                        size="compact"
                        onClick={() => void handleLoadMoreMessages()}
                        disabled={!canLoadMoreMessages}
                        data-testid="mailbox-load-more-button"
                      >
                        Load
                      </Button>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={inboxLoadStep}
                        onChange={(e) => setInboxLoadStep(Math.max(1, Number(e.target.value) || 1))}
                        aria-label="Load more emails step"
                        className="w-20 rounded-md border border-input bg-background px-2 py-1.5 text-xs disabled:opacity-50"
                      />
                      <span className="text-xs text-muted-foreground">
                        more emails out of {remainingSyncedMessages}
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground" data-testid="mailbox-showing-count">
                    Showing {displayedMessages.length} of {messagesTotal} synced emails
                  </p>
                )}
              </div>
            </article>
          )}

          {!isMobileMailboxLayout && (
            <button
              type="button"
              aria-label="Resize inbox panel"
              aria-orientation="vertical"
              aria-valuemin={Math.round(MAILBOX_INBOX_WIDTH_MIN_RATIO * 100)}
              aria-valuemax={Math.round(MAILBOX_INBOX_WIDTH_MAX_RATIO * 100)}
              aria-valuenow={Math.round(inboxPanelRatio * 100)}
              onPointerDown={handleInboxResizeStart}
              onKeyDown={handleInboxResizeKeyDown}
              className="group relative w-2 shrink-0 rounded-full border border-border/70 bg-background/50 hover:bg-accent/50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="pointer-events-none absolute left-1/2 top-1/2 h-14 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border group-hover:bg-primary/60" />
            </button>
          )}

            <article
              hidden={isMobileMailboxLayout && mobileMailboxScreen !== 'thread'}
              className={`rounded-2xl border border-border bg-card p-3 lg:p-4 min-h-0 min-w-0 flex-1 flex-col h-full ${
                isMobileMailboxLayout && mobileMailboxScreen !== 'thread' ? 'hidden' : 'flex'
              }`}
            >
              {isMobileMailboxLayout && mobileMailboxScreen === 'thread' && error && (
                <div role="alert" className="mb-3 rounded-lg border border-danger-muted bg-danger-subtle px-3 py-3 text-sm text-danger">
                  Error: {error}
                </div>
              )}
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div
                  data-testid="mailbox-thread-actions"
                  className={`flex flex-wrap items-center ${
                    isMobileMailboxLayout
                      ? 'w-full gap-1 [&>button]:min-h-9 [&>button]:min-w-9 [&>button]:justify-center [&>button]:px-2'
                      : 'gap-2'
                  }`}
                >
                  <div
                    data-testid="mailbox-thread-primary-actions"
                    className={isMobileMailboxLayout
                      ? 'flex w-full min-w-0 items-center gap-1 [&>button]:flex [&>button]:min-h-9 [&>button]:min-w-9 [&>button]:justify-center [&>button]:px-2'
                      : 'contents'}
                  >
                  <div className={`flex items-center gap-2 ${isMobileMailboxLayout ? 'min-w-0 flex-1' : ''}`}>
                    <h2 className="whitespace-nowrap text-base font-semibold lg:text-lg">Thread Viewer</h2>
                    {threadMessages.length > 1 && (
                      <span className={isMobileMailboxLayout ? 'sr-only' : 'text-xs text-muted-foreground'}>
                        {threadMessages.length} messages
                      </span>
                    )}
                  </div>
                  {isMobileMailboxLayout && (
                    <details
                      ref={mobileFormatPickerRef}
                      className="relative"
                      onBlur={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget)) {
                          event.currentTarget.open = false
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          event.currentTarget.open = false
                          event.currentTarget.querySelector('summary')?.focus()
                        }
                      }}
                    >
                      <summary
                        aria-label={`Email format: ${mailViewerMode === 'html' ? 'Trusted' : mailViewerMode === 'system' ? 'System' : 'Raw'}`}
                        title={selectedMessageDomainTrusted
                          ? 'Choose email format - sender domain trusted'
                          : 'Choose email format - sender domain not trusted'}
                        className={`flex min-h-9 min-w-9 cursor-pointer list-none items-center justify-center rounded-md border focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden ${
                          selectedMessageDomainTrusted
                            ? 'border-primary bg-primary/10 text-primary hover:bg-primary/15'
                            : 'border-warning-muted bg-warning-subtle text-warning hover:bg-warning-muted'
                        }`}
                      >
                        {selectedMessageDomainTrusted
                          ? <Check className="h-4 w-4" aria-hidden="true" />
                          : <HelpCircle className="h-4 w-4" aria-hidden="true" />}
                        <span className="sr-only">
                          {selectedMessageDomainTrusted ? 'Sender domain trusted' : 'Sender domain not trusted'}
                        </span>
                      </summary>
                      <div
                        role="group"
                        aria-label="Email format"
                        className="absolute right-0 top-full z-20 mt-1 w-40 rounded-lg border border-border bg-card p-1 shadow-lg"
                      >
                        {([
                          ['raw-text', 'Raw'],
                          ['html', 'Trusted'],
                          ['system', 'System'],
                        ] as const).map(([mode, label]) => (
                          <button
                            key={mode}
                            type="button"
                            aria-pressed={mailViewerMode === mode}
                            onClick={() => selectMobileViewerMode(mode)}
                            className="flex min-h-11 w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-accent/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {label}
                            {mailViewerMode === mode && <Check className="h-4 w-4 text-primary" aria-hidden="true" />}
                          </button>
                        ))}
                      </div>
                    </details>
                  )}
                  </div>
                  {isMobileMailboxLayout && (
                    <IconButton
                      emphasis="outline"
                      onClick={returnToMobileMailboxList}
                      label="Back to Inbox"
                      icon={<Inbox className="h-4 w-4" aria-hidden="true" />}
                    />
                  )}
                  <Button
                    emphasis="outline"
                    size="compact"
                    onClick={selectedThreadIsProviderJunk ? removeSelectedMessageFromProviderJunk : addSelectedThreadTargetToJunk}
                    disabled={
                      !selectedThread ||
                      savingJunk ||
                      threadHasPendingSentCopy ||
                      (!selectedThreadIsProviderJunk && (!selectedThreadJunkTarget || selectedThreadIsJunk))
                    }
                    title={
                      selectedThreadIsProviderJunk
                        ? 'Move this email out of provider junk'
                        : selectedThreadIsJunk
                          ? 'Junk preference saved'
                          : 'Mark sender as junk'
                    }
                    aria-label={
                      selectedThreadIsProviderJunk
                        ? 'Move this email out of provider junk'
                        : selectedThreadIsJunk
                          ? 'Junk preference saved'
                          : 'Mark sender as junk'
                    }
                    icon={selectedThreadIsProviderJunk ? <ShieldCheck className="h-3.5 w-3.5" /> : <CircleOff className="h-3.5 w-3.5" />}
                  >
                    <span className="hidden 2xl:inline">
                      {selectedThreadIsProviderJunk ? 'Not Junk' : selectedThreadIsJunk ? 'Junk Saved' : 'Junk'}
                    </span>
                  </Button>
                  {selectedThreadTrashedCount > 0 && (
                    <Button
                      emphasis="outline"
                      size="compact"
                      onClick={() => void restoreSelectedThread()}
                      disabled={!selectedThread || threadTrashing || threadHasPendingSentCopy}
                      title="Restore trashed emails in this thread from provider trash"
                      aria-label={
                        threadTrashing
                          ? 'Restoring thread from provider trash'
                          : `Restore ${selectedThreadTrashedCount} emails from provider trash`
                      }
                      icon={<TrashRestore className="h-4 w-4" aria-hidden="true" />}
                    >
                      <span className="hidden 2xl:inline">
                        {threadTrashing ? 'Working...' : `Restore (${selectedThreadTrashedCount})`}
                      </span>
                    </Button>
                  )}
                  <Button
                    emphasis="outline"
                    intent="danger"
                    size="compact"
                    onClick={requestSelectedThreadTrashAction}
                    disabled={!selectedThread || !threadMessages.length || threadTrashing || threadHasPendingSentCopy}
                    title="Move every email in this thread, including replies and same-subject emails, to provider trash"
                    aria-label={
                      threadTrashing
                        ? 'Moving thread to provider trash'
                        : selectedThreadUntrashedCount === 0
                          ? `Remove ${threadMessages.length} local copies`
                          : `Move ${selectedThreadUntrashedCount} emails to provider trash`
                    }
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                  >
                    <span className="hidden 2xl:inline">
                      {threadTrashing
                        ? 'Working...'
                        : selectedThreadUntrashedCount === 0
                          ? `Remove copies (${threadMessages.length})`
                          : `Trash thread (${selectedThreadUntrashedCount})`}
                    </span>
                  </Button>
                  <ToggleButton
                    size="compact"
                    pressed={isAutomationPanelOpen}
                    onPressedChange={() => openAutomationPanel()}
                    title="Open automation configuration and the AI assistant"
                    aria-label="Open automation configuration and the AI assistant"
                    icon={<Bot className="h-3.5 w-3.5" />}
                  >
                    <span className="hidden 2xl:inline">Automation</span>
                  </ToggleButton>
                  <Button
                    emphasis="outline"
                    intent={isTagPickerOpen && tagPickerScope === 'thread' ? 'primary' : 'neutral'}
                    size="compact"
                    onClick={(event) => openThreadTagPicker(event.currentTarget)}
                    disabled={!selectedThread || !threadMessages.length || threadHasPendingSentCopy}
                    aria-pressed={isTagPickerOpen && tagPickerScope === 'thread'}
                    title="Apply tags to every message in this thread"
                    aria-label="Apply tags to every message in this thread"
                    icon={<Tag className="h-3.5 w-3.5" />}
                  >
                    <span className="hidden 2xl:inline">Tag Thread</span>
                  </Button>
                  {threadInvitations.length > 0 && (
                    <Button
                      emphasis="outline"
                      intent="primary"
                      size="compact"
                      data-testid="mailbox-thread-add-to-calendar"
                      onClick={openThreadInvitationCalendarPicker}
                      title={threadInvitations.length > 1
                        ? 'Choose which email invitation to add to a calendar'
                        : singleThreadInvitationAddActionState?.label ?? 'Add to calendar'}
                      aria-label={threadInvitations.length > 1
                        ? 'Choose invitation from this thread'
                        : singleThreadInvitationAddActionState?.label ?? 'Add to calendar'}
                      icon={<CalendarPlus className="h-3.5 w-3.5" />}
                    >
                      <span className="hidden 2xl:inline">
                        {threadInvitations.length > 1
                          ? 'Choose invitation'
                          : singleThreadInvitationAddActionState?.label ?? 'Add to calendar'}
                      </span>
                    </Button>
                  )}
                </div>
                {!isMobileMailboxLayout && (
                <div className="flex items-center gap-2">
                  <Button
                    emphasis="outline"
                    intent={mailViewerMode === 'raw-text' ? 'primary' : 'neutral'}
                    size="compact"
                    onClick={() => setMailViewerMode('raw-text')}
                  >
                    Raw
                  </Button>
                  <Button
                    emphasis="outline"
                    intent={mailViewerMode === 'html' ? 'primary' : 'neutral'}
                    size="compact"
                    onClick={() => requestHtmlViewerMode()}
                  >
                    Trusted
                  </Button>
                  <Button
                    emphasis="outline"
                    intent={mailViewerMode === 'system' ? 'primary' : 'neutral'}
                    size="compact"
                    onClick={() => setMailViewerMode('system')}
                    title="View raw HTML source code for debugging"
                  >
                    System
                  </Button>
                </div>
                )}
              </div>
              {junkActionWarning && junkActionWarning.threadId === selectedThread?.id && (
                <div role="alert" className="mb-3 flex items-start justify-between gap-2 rounded-xl border border-warning-muted bg-warning-subtle p-3 text-sm text-warning-foreground">
                  <p>{junkActionWarning.message}</p>
                  <IconButton
                    onClick={() => setJunkActionWarning(null)}
                    label="Dismiss Junk warning"
                    showTitle={false}
                    className="shrink-0"
                    icon={<X className="h-4 w-4 text-warning-foreground" />}
                  />
                </div>
              )}
              {Object.entries(sentSyncWarnings).map(([noticeId, warning]) => (
                <div key={noticeId} role="alert" className="mb-3 flex items-start justify-between gap-2 rounded-xl border border-warning-muted bg-warning-subtle p-3 text-sm text-warning">
                  <p>{warning}</p>
                  <IconButton
                    onClick={() => setSentSyncWarnings((prev) => {
                      const next = { ...prev }
                      delete next[noticeId]
                      return next
                    })}
                    label="Dismiss sent copy warning"
                    showTitle={false}
                    className="shrink-0"
                    icon={<X className="h-4 w-4" />}
                  />
                </div>
              ))}
              {sentNotice && (
                <div className="mb-3 rounded-xl border border-success-muted bg-success-subtle p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-semibold text-success">
                        Message sent to {sentNotice.recipients.join(', ')}
                      </p>
                      <p className="truncate text-xs text-success">
                        {sentNotice.subject}
                      </p>
                      <p className="text-[11px] text-success">
                        {sentNotice.syncing
                          ? 'Pulling it into your Sent messages...'
                          : sentNotice.syncFailed
                            ? 'It was sent, but the copy could not be pulled in. Use Sync to retrieve it.'
                            : 'It is now in your message list with the SENT tag.'}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {sentNotice.threadId && !sentNotice.syncing && (
                        <Button
                          emphasis="outline"
                          size="compact"
                          onClick={() => void handleOpenThread(sentNotice.threadId)}
                        >
                          Open thread
                        </Button>
                      )}
                      <IconButton
                        onClick={() => setSentNotice(null)}
                        title="Dismiss"
                        label="Dismiss sent confirmation"
                        icon={<X className="h-3.5 w-3.5" />}
                      />
                    </div>
                  </div>
                </div>
              )}
              {selectedThread || activeDraft ? (
                <>
                  {selectedThreadLoading && (
                    <div className="flex-1 flex items-center justify-center">
                      <div className="text-center">
                        <div className="inline-flex h-8 w-8 items-center justify-center rounded-full border-2 border-primary/20">
                          <div className="h-6 w-6 rounded-full border-2 border-transparent border-t-primary animate-spin" />
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">Loading message...</p>
                      </div>
                    </div>
                  )}
                  {!selectedThreadLoading && threadMessages.length > 0 && (
                    <div
                      ref={threadReaderRef}
                      data-testid="mailbox-thread-scroll"
                      style={{
                        transitionDuration: `${MAILBOX_THREAD_COLLAPSE_MS}ms`,
                        maxHeight: isThreadViewerCollapsing ? '0px' : '5000px',
                        opacity: isThreadViewerCollapsing ? 0 : 1,
                        overflowY: isThreadViewerCollapsing ? 'hidden' : 'auto',
                      }}
                      className={`min-h-24 flex-1 pr-1 space-y-2 transition-all ease-in motion-reduce:transition-none ${
                        isThreadViewerCollapsing ? 'pointer-events-none' : ''
                      }`}
                    >
                      {threadReaderMessages.map(({ message, splitBody }) => {
                        const ccLine = formatRecipientLine(message.cc_emails)
                        const bccLine = formatRecipientLine(message.bcc_emails)
                        const replyToLine =
                          typeof message.reply_to === 'string' ? message.reply_to.trim() : ''
                        const encryptionLine =
                          typeof message.encryption_type === 'string'
                            ? message.encryption_type.trim()
                            : ''
                        const hasAdditionalSourceInfo = Boolean(
                          ccLine || bccLine || replyToLine || encryptionLine
                        )
                        const isSourceDetailsExpanded = expandedSourceDetailsMessageIds.has(
                          message.id
                        )
                        const senderDomain = resolveMessageDomain(message)
                        const hasEmbeddedHtml = Boolean(message.body_html_sanitized)
                        const isSenderDomainTrusted = isDomainTrusted(senderDomain)
                        const isSenderDomainJunk = isMessageJunk(message)
                        const isFocusedThreadMessage = focusedThreadMessageId === message.id
                        const isSelectedThreadMessage = selectedThreadMessage?.id === message.id
                        const isThreadMessageCollapsed = collapsedThreadMessageIds.has(message.id)
                        const isThreadMessageHovered = hoveredMailboxMessageId === message.id
                        const isThreadMessageFading = fadingMailboxMessageId === message.id
                        const isThreadMessageSettling = settlingMessageIds.has(message.id)
                        const messageAttachments = threadAttachments.filter(
                          (attachment) => attachment.message_id === message.id
                        )
                        const messageInvitations =
                          threadInvitationsByMessageId.get(message.id) ?? []
                        const messageInvitation = messageInvitations[0] ?? null
                        const messageInvitationActionLabel = messageInvitations.length > 1
                          ? 'Choose invitation'
                          : messageInvitation
                            ? getInvitationAddActionState(messageInvitation, invitations).label
                            : null
                        const messageAttachmentsLoading =
                          attachmentsLoading && !attachmentCacheRef.current.has(message.id)
                        const openMessageInvitation = () => {
                          setFocusedThreadMessageId(message.id)
                          if (messageInvitations.length === 1) {
                            openInvitationCalendarPicker(messageInvitations[0])
                          } else if (messageInvitations.length > 1) {
                            setThreadInvitationChoices(messageInvitations)
                          }
                        }
                        const toggleThreadMessageCollapsed = () => {
                          setCollapsedThreadMessageIds((prev) => {
                            const next = new Set(prev)
                            if (next.has(message.id)) {
                              next.delete(message.id)
                            } else {
                              next.add(message.id)
                            }
                            return next
                          })
                        }
                        const showTrustDomainIntent =
                          mailViewerMode === 'raw-text' &&
                          hasEmbeddedHtml &&
                          Boolean(senderDomain) &&
                          !isSenderDomainTrusted

                        return (
                          <div
                            key={message.id}
                            data-testid="mailbox-thread-message"
                            data-message-id={message.id}
                            onMouseEnter={() => handleMailboxMessageHoverEnter(message.id)}
                            onMouseLeave={() => handleMailboxMessageHoverLeave(message.id)}
                            style={{
                              transitionDuration: isThreadMessageHovered
                                ? '150ms'
                                : isThreadMessageSettling
                                  ? `${MAILBOX_TAG_SETTLE_MS}ms`
                                  : '600ms',
                            }}
                            className={`w-full rounded-lg border p-3 transition-all motion-reduce:transition-none ${
                              isThreadMessageHovered
                                ? 'border-feature-ai-muted bg-feature-ai-subtle dark:border-feature-ai-muted bg-feature-ai-subtle'
                                : isThreadMessageFading
                                  ? 'border-feature-ai-muted bg-feature-ai-subtle dark:border-feature-ai-muted bg-feature-ai-subtle'
                                : isFocusedThreadMessage
                                  ? 'border-primary bg-primary/10 ring-1 ring-primary/30'
                                  : message.is_provider_sent
                                    ? 'border-success-muted bg-success-subtle'
                                    : 'border-border bg-background'
                            }`}
                          >
                            <div
                              ref={(element) => {
                                if (element) {
                                  threadMessageHeaderRefs.current.set(message.id, element)
                                } else {
                                  threadMessageHeaderRefs.current.delete(message.id)
                                }
                              }}
                              data-testid="mailbox-thread-message-header"
                              data-message-id={message.id}
                              role="button"
                              tabIndex={0}
                              onPointerDown={(event) => {
                                threadHeaderPointerRef.current = {
                                  x: event.clientX,
                                  y: event.clientY,
                                }
                              }}
                              onClick={(event) => {
                                if (isInteractiveMailboxHeaderTarget(event.target)) return
                                const selectedText = window.getSelection()?.toString().trim()
                                if (selectedText) return

                                const pointerStart = threadHeaderPointerRef.current
                                threadHeaderPointerRef.current = null
                                if (pointerStart) {
                                  const moved =
                                    Math.abs(event.clientX - pointerStart.x) > 4 ||
                                    Math.abs(event.clientY - pointerStart.y) > 4
                                  if (moved) return
                                }

                                setFocusedThreadMessageId(message.id)
                                toggleThreadMessageCollapsed()
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== 'Enter' && event.key !== ' ') return
                                if (isInteractiveMailboxHeaderTarget(event.target)) return
                                event.preventDefault()
                                setFocusedThreadMessageId(message.id)
                                toggleThreadMessageCollapsed()
                              }}
                              className="mb-2 flex cursor-pointer items-start gap-3 rounded-md select-text"
                              aria-expanded={!isThreadMessageCollapsed}
                            >
                              <div className="min-w-0 space-y-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span
                                    className="inline-flex h-5 w-5 items-center justify-center rounded border border-border text-muted-foreground"
                                    aria-hidden="true"
                                  >
                                    {isThreadMessageCollapsed ? (
                                      <ChevronRight className="h-3.5 w-3.5" />
                                    ) : (
                                      <ChevronDown className="h-3.5 w-3.5" />
                                    )}
                                  </span>
                                  {isSenderDomainJunk && (
                                    <span className="inline-flex rounded-full border border-warning-muted bg-warning-subtle px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
                                      Junk
                                    </span>
                                  )}
                                  {message.is_provider_sent && (
                                    <span className="inline-flex rounded-full border border-success-muted bg-success-subtle px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
                                      Sent by you
                                    </span>
                                  )}
                                  {isSelectedThreadMessage && (
                                    <span className="inline-flex rounded-full border border-feature-ai-muted bg-feature-ai-subtle px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-feature-ai dark:border-feature-ai-muted">
                                      Selected message
                                    </span>
                                  )}
                                  {message.is_archived && (
                                    <span className="inline-flex items-center gap-1 rounded-full border border-warning-muted bg-warning-subtle px-2 py-0.5 text-[10px] font-medium text-warning">
                                      <Archive className="h-3 w-3" />
                                      Archived
                                    </span>
                                  )}
                                  {message.is_provider_trashed && (
                                    <span className="inline-flex rounded-full bg-danger-subtle px-2 py-0.5 text-[10px] font-medium text-danger">
                                      Deleted in Gmail
                                    </span>
                                  )}
                                  {message.is_replied && message.replied_by_message_id && (
                                    <Button
                                      size="micro"
                                      emphasis="outline"
                                      intent="info"
                                      icon={<CornerDownLeft className="h-3 w-3" />}
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        const replyId = message.replied_by_message_id!
                                        selectThreadMessage(replyId)
                                      }}
                                      className="uppercase tracking-wide"
                                      title="Jump to your reply"
                                      aria-label="Jump to your reply"
                                    >
                                      Replied
                                    </Button>
                                  )}
                                  <p className="text-sm font-medium wrap-break-word">
                                    {message.subject || '(no subject)'}
                                  </p>
                                  {getDisplayTagIds(message).map((tagId) => {
                                    const tag = mailboxTagById.get(tagId)
                                    if (!tag) return null
                                    const isTagFading =
                                      fadingTagRemovals.get(message.id)?.has(tagId) ?? false
                                    return (
                                      <span
                                        key={tag.id}
                                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium transition-opacity ease-out motion-reduce:transition-none ${isTagFading ? 'opacity-0' : 'opacity-100'}`}
                                        style={{
                                          backgroundColor: `${tag.color}22`,
                                          color: tag.color,
                                          transitionDuration: `${MAILBOX_TAG_FADE_MS}ms`,
                                        }}
                                      >
                                        {tag.label}
                                      </span>
                                    )
                                  })}
                                  <Button
                                    emphasis="outline"
                                    size="compact"
                                    disabled={message.id.startsWith('sent-draft:')}
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      openTagPickerForMessage(message.id, event.currentTarget)
                                    }}
                                    title="Apply or remove tags"
                                    aria-label="Apply or remove tags"
                                    icon={<Tag className="h-3 w-3" />}
                                  >
                                    Tag
                                  </Button>
                                    <span className="text-[11px] text-muted-foreground">
                                      {formatTimestamp(message.received_at, userDateFormat)}
                                    </span>
                                    <Button
                                      emphasis="outline"
                                      size="compact"
                                      disabled={message.id.startsWith('sent-draft:')}
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        void openMessageActivityLog(message)
                                      }}
                                      title="Show this email's action timeline"
                                    >
                                      Log
                                    </Button>
                                    <Button
                                      emphasis="outline"
                                      size="compact"
                                      data-testid="mailbox-thread-message-reply"
                                      disabled={message.id.startsWith('sent-draft:')}
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        setFocusedThreadMessageId(message.id)
                                        openReplyDraft(message)
                                      }}
                                      title={message.id.startsWith('sent-draft:')
                                        ? 'Reply available after the sent copy is imported'
                                        : `Reply to ${message.subject || 'this email'}`}
                                      aria-label="Reply"
                                      icon={<CornerDownLeft className="h-3.5 w-3.5" />}
                                    >
                                      Reply
                                    </Button>
                                    <Button
                                      emphasis="outline"
                                      size="compact"
                                      data-testid="mailbox-thread-message-forward"
                                      disabled={message.id.startsWith('sent-draft:')}
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        setFocusedThreadMessageId(message.id)
                                        openForwardDraft(message)
                                      }}
                                      title={message.id.startsWith('sent-draft:')
                                        ? 'Forward available after the sent copy is imported'
                                        : `Forward ${message.subject || 'this email'}`}
                                      aria-label="Forward"
                                      icon={<Forward className="h-3.5 w-3.5" />}
                                    >
                                      Forward
                                    </Button>
                                    {messageInvitationActionLabel && (
                                      <Button
                                        emphasis="outline"
                                        intent="primary"
                                        size="compact"
                                        data-testid="mailbox-thread-message-add-to-calendar"
                                        onClick={(event) => {
                                          event.stopPropagation()
                                          openMessageInvitation()
                                        }}
                                        title={`${messageInvitationActionLabel} for ${message.subject || 'this email'}`}
                                        aria-label={messageInvitations.length > 1
                                          ? 'Choose invitation for this email'
                                          : messageInvitationActionLabel}
                                        icon={<CalendarPlus className="h-3.5 w-3.5" />}
                                      >
                                        {messageInvitationActionLabel}
                                      </Button>
                                    )}
                                    {message.id.startsWith('sent-draft:') && (
                                      <span className="text-[11px] text-muted-foreground">Sent copy awaiting import</span>
                                    )}
                                </div>
                              </div>
                            </div>
                            {(messageAttachments.length > 0 || messageAttachmentsLoading) && (
                              <div className="mb-2 flex flex-wrap items-center gap-2">
                                {messageAttachmentsLoading && messageAttachments.length === 0 && (
                                  <span className="text-xs text-muted-foreground">
                                    Loading attachments...
                                  </span>
                                )}
                                {messageAttachments.map((attachment) => {
                                  const key = `${attachment.message_id}::${attachment.id}`
                                  const isImageAttachment =
                                    !!attachment.mime_type && attachment.mime_type.startsWith('image/')
                                  const preview =
                                    hoveredAttachmentPreview?.key === key ? hoveredAttachmentPreview : null
                                  return (
                                    <div key={key} className="relative">
                                      <Button
                                        emphasis="outline"
                                        size="compact"
                                        onClick={() => handleDownloadAttachment(attachment)}
                                        onMouseEnter={() => scheduleAttachmentPreview(attachment)}
                                        onMouseLeave={() => cancelAttachmentPreview(key)}
                                        onFocus={() => scheduleAttachmentPreview(attachment)}
                                        onBlur={() => cancelAttachmentPreview(key)}
                                        disabled={
                                          downloadingAttachmentKey === key ||
                                          isDownloadingAllAttachments
                                        }
                                        title={`Download ${attachment.filename}`}
                                        className="max-w-full whitespace-nowrap"
                                        icon={<Paperclip className="h-3.5 w-3.5 shrink-0 text-warning" />}
                                      >
                                        <span>{attachment.filename}</span>
                                        {downloadingAttachmentKey === key && (
                                          <span className="text-[10px] text-muted-foreground">...</span>
                                        )}
                                      </Button>
                                      {isImageAttachment && preview && (
                                        <div
                                          className="absolute left-0 top-full z-20 mt-1 w-48 rounded-md border border-border bg-popover p-1.5 shadow-lg"
                                          onMouseEnter={() => clearAttachmentHoverTimeout()}
                                          onMouseLeave={() => cancelAttachmentPreview(key)}
                                        >
                                          {preview.loading && (
                                            <div className="flex h-32 items-center justify-center">
                                              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                                            </div>
                                          )}
                                          {!preview.loading && preview.error && (
                                            <p className="p-2 text-xs text-destructive">{preview.error}</p>
                                          )}
                                          {!preview.loading && preview.url && (
                                            <img
                                              src={preview.url}
                                              alt={attachment.filename}
                                              className="max-h-48 w-full rounded object-contain"
                                            />
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}

                                {messageAttachments.length > 1 && (
                                  <Button
                                    emphasis="outline"
                                    size="compact"
                                    onClick={() =>
                                      void handleDownloadAllAttachments(messageAttachments)
                                    }
                                    disabled={isDownloadingAllAttachments}
                                    className="shrink-0 whitespace-nowrap"
                                    icon={<Paperclip className="h-3.5 w-3.5 shrink-0" />}
                                  >
                                    {isDownloadingAllAttachments
                                      ? 'Downloading...'
                                      : `Download all (${messageAttachments.length})`}
                                  </Button>
                                )}
                              </div>
                            )}
                            <div
                              className={`mb-2 space-y-1 ${isThreadMessageCollapsed ? 'hidden' : ''}`}
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-[11px] text-muted-foreground wrap-break-word">
                                  From: {formatSenderLine(message.from_name, message.from_email)}
                                </p>
                                {showTrustDomainIntent && (
                                  <button
                                    type="button"
                                    onClick={() => setPendingTrustMessageId(message.id)}
                                    className="inline-flex items-center rounded-full border border-warning-muted bg-warning-subtle px-2 py-0.5 text-[10px] font-semibold text-warning shadow-xs transition hover:bg-warning-muted animate-pulse motion-reduce:animate-none"
                                    title={`Trust ${senderDomain} to render sanitized HTML`}
                                    aria-label={`Trust ${senderDomain} to render sanitized HTML`}
                                  >
                                    Trust domain
                                  </button>
                                )}
                                {hasEmbeddedHtml && senderDomain && isSenderDomainTrusted && (
                                  <span className="inline-flex rounded-full border border-info-muted bg-info-subtle px-2 py-0.5 text-[10px] font-medium text-info">
                                    HTML trusted
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-[11px] text-muted-foreground wrap-break-word">
                                  To:{' '}
                                  {formatRecipientLine(message.to_emails) || 'Unknown recipients'}
                                </p>
                                <Button
                                  emphasis="ghost"
                                  size="compact"
                                  onClick={() => {
                                    setExpandedSourceDetailsMessageIds((prev) => {
                                      const next = new Set(prev)
                                      if (next.has(message.id)) {
                                        next.delete(message.id)
                                      } else {
                                        next.add(message.id)
                                      }
                                      return next
                                    })
                                  }}
                                >
                                  {isSourceDetailsExpanded ? 'Hide details' : 'Show details'}
                                </Button>
                              </div>
                              {isSourceDetailsExpanded && (
                                <>
                                  {ccLine && (
                                    <p className="text-[11px] text-muted-foreground wrap-break-word">
                                      Cc: {ccLine}
                                    </p>
                                  )}
                                  {bccLine && (
                                    <p className="text-[11px] text-muted-foreground wrap-break-word">
                                      Bcc: {bccLine}
                                    </p>
                                  )}
                                  {replyToLine && (
                                    <p className="text-[11px] text-muted-foreground wrap-break-word">
                                      Reply-To: {replyToLine}
                                    </p>
                                  )}
                                  {encryptionLine && (
                                    <p className="text-[11px] text-muted-foreground wrap-break-word">
                                      Encryption: {encryptionLine}
                                    </p>
                                  )}
                                  {!hasAdditionalSourceInfo && (
                                    <p className="text-[11px] text-muted-foreground">
                                      No additional source metadata available for this message.
                                    </p>
                                  )}
                                </>
                              )}
                            </div>
                            <div
                              className={`overflow-x-auto rounded border border-border bg-white p-3 text-black ${isThreadMessageCollapsed ? 'hidden' : ''}`}
                            >
                              {mailViewerMode === 'html' && canRenderMessageHtml(message) ? (
                                <iframe
                                  title={`Trusted HTML message ${message.id}`}
                                  srcDoc={buildTrustedEmailSrcDoc(
                                    message.body_html_sanitized || ''
                                  )}
                                  sandbox="allow-popups allow-popups-to-escape-sandbox"
                                  className="h-[60vh] w-full rounded border border-border/60 bg-white lg:h-[68vh]"
                                />
                              ) : mailViewerMode === 'system' ? (
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs font-semibold text-foreground">
                                      Raw HTML Source Code
                                    </p>
                                    <Button
                                      emphasis="outline"
                                      size="compact"
                                      onClick={() => {
                                        if (message.body_html_sanitized) {
                                          navigator.clipboard.writeText(message.body_html_sanitized)
                                        }
                                      }}
                                      disabled={!message.body_html_sanitized}
                                      title="Copy HTML to clipboard for LLM analysis"
                                    >
                                      Copy HTML
                                    </Button>
                                  </div>
                                  {message.body_html_sanitized ? (
                                    <pre className="relative rounded-md border border-border bg-muted/50 p-3 text-xs font-mono leading-relaxed overflow-auto max-h-96 whitespace-pre-wrap wrap-break-word">
                                      {message.body_html_sanitized}
                                    </pre>
                                  ) : (
                                    <div className="rounded-md border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
                                      No HTML content available for this message
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  <p className="whitespace-pre-wrap wrap-break-word font-mono text-xs leading-relaxed text-black">
                                    {splitBody.body || splitBody.quoted}
                                  </p>
                                  {splitBody.body && splitBody.quoted && (
                                    <details className="rounded border border-border text-black">
                                      <summary className="min-h-11 cursor-pointer px-3 py-2 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                                        Quoted history
                                      </summary>
                                      <p className="whitespace-pre-wrap wrap-break-word border-t border-border p-3 font-mono text-xs leading-relaxed">
                                        {splitBody.quoted}
                                      </p>
                                    </details>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {activeDraft && !selectedThreadLoading && (
                    <div data-testid="mailbox-draft-panel" className={`mt-3 flex min-h-0 shrink-0 flex-col rounded-xl border border-border bg-background p-3 ${threadMessages.length ? 'max-h-[60%]' : 'flex-1'}`}>
                      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
                        <div className="inline-flex items-center gap-1 text-xs font-semibold sm:text-sm">
                          <ArrowRight className="h-4 w-4" />
                          Draft Viewer --{' '}
                          {activeDraft.mode === 'reply'
                            ? 'Reply'
                            : activeDraft.mode === 'forward'
                              ? 'Forward'
                              : 'New Message'}
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                        {threadMessages.length > 0 && (
                            <Button
                              emphasis="outline"
                              size="compact"
                              onPointerEnter={(event) => {
                                if (event.pointerType === 'mouse' && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
                                  draftToggleHoveredRef.current = true
                                  toggleDraftReading()
                                }
                              }}
                              onPointerLeave={() => { draftToggleHoveredRef.current = false }}
                              onPointerDown={(event) => {
                                if (event.pointerType !== 'mouse') draftToggleHoveredRef.current = false
                              }}
                              onClick={(event) => {
                                if (event.detail === 0 || !draftToggleHoveredRef.current) toggleDraftReading()
                              }}
                              aria-pressed={isReadingWithDraft}
                              aria-controls="mailbox-draft-content"
                              data-testid="mailbox-draft-reading-toggle"
                              className="min-h-11 w-28 shrink-0"
                            >
                              {isReadingWithDraft ? 'Back to draft' : 'Read emails'}
                            </Button>
                        )}
                        <Button
                          emphasis="outline"
                          size="compact"
                          onClick={() => {
                            if (isReadingWithDraft) setDraftReadDetailsExpanded(current => !current)
                            else setDraftDetailsExpanded(current => !current)
                          }}
                          aria-expanded={showingDraftDetails}
                          aria-controls="mailbox-draft-details"
                          className="min-h-11"
                        >
                          {showingDraftDetails ? 'Hide details' : 'Details'}
                        </Button>
                        <Button
                          emphasis="outline"
                          size="compact"
                          onClick={() => setActiveDraft(null)}
                          className="min-h-11"
                        >
                          Close Draft
                        </Button>
                        </div>
                      </div>

                      <div
                        id="mailbox-draft-content"
                        aria-hidden={draftContentMinimized}
                        inert={draftContentMinimized}
                        className={`grid min-h-0 transition-[grid-template-rows,opacity] duration-200 motion-reduce:transition-none ${draftContentMinimized ? 'grid-rows-[0fr] opacity-10 pointer-events-none' : 'grid-rows-[1fr] opacity-100'}`}
                      >
                      <div className={`min-h-0 ${draftContentMinimized ? 'overflow-hidden' : 'overflow-y-auto'}`}>
                      <div className="space-y-2 pt-2">
                        <div id="mailbox-draft-details" hidden={!showingDraftDetails} className="space-y-2">
                        <div className="grid gap-1 sm:grid-cols-[72px_minmax(0,1fr)] sm:items-center">
                          <label
                            htmlFor="mailbox-draft-from"
                            className="text-xs font-semibold text-foreground"
                          >
                            From
                          </label>
                          <select
                            id="mailbox-draft-from"
                            value={activeDraft.fromAddress}
                            onChange={(event) => {
                              const selectedAddress = event.target.value
                              const selectedOption = draftFromOptions.find(
                                (option) => option.address === selectedAddress
                              )
                              if (!selectedOption) return

                              setActiveDraft((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      accountId: selectedOption.accountId,
                                      fromAddress: selectedOption.address,
                                    }
                                  : prev
                              )
                            }}
                            className="w-full rounded-md border border-input bg-background px-2.5 py-2 text-xs"
                          >
                            <optgroup label="Connected accounts">
                              {draftFromOptions.map((option) => (
                                <option key={`account-${option.accountId}`} value={option.address}>
                                  {option.label}
                                </option>
                              ))}
                            </optgroup>
                          </select>
                        </div>

                        {(['to', 'cc', 'bcc'] as MailDraftRecipientField[])
                          .filter((field) => draftVisibleFields.includes(field))
                          .map((field) => {
                            const fieldLabel = field === 'to' ? 'To' : field === 'cc' ? 'Cc' : 'Bcc'
                            const rows = activeDraft[field].length > 0 ? activeDraft[field] : ['']
                            return (
                              <div
                                key={field}
                                className="grid gap-1 sm:grid-cols-[72px_minmax(0,1fr)] sm:items-start"
                              >
                                <div className="pt-1">
                                  {field === 'to' ? (
                                    <Button
                                      emphasis="outline"
                                      size="compact"
                                      onClick={() =>
                                        setDraftRecipientsExpanded((current) => !current)
                                      }
                                      aria-expanded={draftRecipientsExpanded}
                                      title="Show Cc and Bcc options"
                                    >
                                      To
                                      {draftRecipientsExpanded ? (
                                        <ChevronUp className="h-3 w-3" />
                                      ) : (
                                        <ChevronDown className="h-3 w-3" />
                                      )}
                                    </Button>
                                  ) : (
                                    <span className="text-xs font-semibold text-foreground">
                                      {fieldLabel}
                                    </span>
                                  )}
                                </div>
                                <div className="space-y-1">
                                  {rows.map((value, index) => {
                                    const isSuggestionOpen =
                                      recipientSuggestionTarget?.field === field &&
                                      recipientSuggestionTarget.index === index &&
                                      recipientSuggestions.length > 0

                                    return (
                                      <div
                                        key={`${field}-${index}`}
                                        className="flex items-center gap-1"
                                      >
                                        <div className="relative flex-1">
                                          <input
                                            value={value}
                                            onChange={(event) =>
                                              updateDraftRecipient(field, index, event.target.value)
                                            }
                                            onFocus={() =>
                                              setRecipientSuggestionTarget({ field, index })
                                            }
                                            onBlur={() => setRecipientSuggestionTarget(null)}
                                            placeholder={`${fieldLabel} address`}
                                            aria-label={`${fieldLabel} recipient ${index + 1}`}
                                            autoComplete="off"
                                            type="email"
                                            className="w-full rounded-md border border-input bg-background px-2.5 py-2 text-xs"
                                          />
                                          {isSuggestionOpen && (
                                            <ul className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
                                              {recipientSuggestions.map((suggestion) => (
                                                <li key={suggestion.email}>
                                                  <button
                                                    type="button"
                                                    // Keeps the input focused so blur does not close the list before the click lands.
                                                    onMouseDown={(event) => event.preventDefault()}
                                                    onClick={() => {
                                                      updateDraftRecipient(
                                                        field,
                                                        index,
                                                        suggestion.email
                                                      )
                                                      setRecipientSuggestionTarget(null)
                                                    }}
                                                    className="block w-full px-2.5 py-1.5 text-left text-[11px] hover:bg-accent/50"
                                                  >
                                                    <span
                                                      className={`block truncate font-medium ${suggestion.isAlreadyUsed ? 'text-warning' : ''}`}
                                                    >
                                                      {suggestion.name || suggestion.email}
                                                    </span>
                                                    {suggestion.name && (
                                                      <span className="block truncate text-muted-foreground">
                                                        {suggestion.email}
                                                      </span>
                                                    )}
                                                    {suggestion.isAlreadyUsed && (
                                                      <span className="block truncate text-warning">
                                                        Already added to this draft
                                                      </span>
                                                    )}
                                                  </button>
                                                </li>
                                              ))}
                                            </ul>
                                          )}
                                        </div>
                                        <IconButton
                                          emphasis="outline"
                                          onClick={() => removeDraftRecipientRow(field, index)}
                                          disabled={field === 'to' && rows.length === 1}
                                          title="Remove this recipient"
                                          label={`Remove ${fieldLabel} recipient ${index + 1}`}
                                          icon={<X className="h-3.5 w-3.5" />}
                                        />
                                      </div>
                                    )
                                  })}
                                  <Button
                                    emphasis="ghost"
                                    size="compact"
                                    onClick={() => addDraftRecipientRow(field)}
                                    icon={<Plus className="h-3 w-3" />}
                                  >
                                    Add {fieldLabel}
                                  </Button>
                                </div>
                              </div>
                            )
                          })}

                        {draftRecipientsExpanded && (
                          <div className="grid gap-1 sm:grid-cols-[72px_minmax(0,1fr)]">
                            <span />
                            <div className="flex flex-wrap gap-1">
                              {(['cc', 'bcc'] as MailDraftRecipientField[]).map((field) => (
                                <Button
                                  key={field}
                                  emphasis="outline"
                                  size="compact"
                                  onClick={() => addDraftRecipientRow(field)}
                                  icon={<Plus className="h-3 w-3" />}
                                >
                                  {field === 'cc' ? 'Cc' : 'Bcc'}
                                </Button>
                              ))}
                            </div>
                          </div>
                        )}

                        {activeDraft.mode === 'reply' &&
                          activeDraft.inReplyToMessageId &&
                          aiAccess.drafts && (
                            <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border p-2">
                              <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <input
                                value={aiDraftInstruction}
                                onChange={(event) => setAiDraftInstruction(event.target.value)}
                                placeholder="Tell the AI what this reply should say"
                                aria-label="AI reply instruction"
                                className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-[11px]"
                              />
                              <Button
                                emphasis="outline"
                                size="compact"
                                onClick={() => void handleAiDraftSuggest()}
                                disabled={aiDraftLoading || !aiDraftInstruction.trim()}
                                icon={<Sparkles className="h-3.5 w-3.5" />}
                              >
                                {aiDraftLoading ? 'Drafting...' : 'AI: Suggest reply'}
                              </Button>
                            </div>
                          )}

                        <div className="grid gap-1 sm:grid-cols-[72px_minmax(0,1fr)] sm:items-center">
                          <label
                            htmlFor="mailbox-draft-subject"
                            className="text-xs font-semibold text-foreground"
                          >
                            Subject
                          </label>
                          <input
                            id="mailbox-draft-subject"
                            value={activeDraft.subject}
                            onChange={(event) =>
                              setActiveDraft((prev) =>
                                prev ? { ...prev, subject: event.target.value } : prev
                              )
                            }
                            placeholder="Subject"
                            className="w-full rounded-md border border-input bg-background px-2.5 py-2 text-xs"
                          />
                        </div>

                        </div>
                        <div hidden={isReadingWithDraft} className="space-y-2">
                        {aiReplySuggestion && (
                          <MailboxReplyFeedback key={aiReplySuggestion.id}
                            instruction={aiReplySuggestion.instruction}
                            subject={aiReplySuggestion.subject} body={aiReplySuggestion.body} />
                        )}
                        <textarea
                          value={activeDraft.body}
                          onChange={(event) =>
                            setActiveDraft((prev) =>
                              prev ? { ...prev, body: event.target.value } : prev
                            )
                          }
                          rows={5}
                          placeholder="Write your message"
                          aria-label="Message body"
                          className="w-full rounded-md border border-input bg-background px-2.5 py-2 text-xs resize-y"
                        />

                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            ref={draftAttachmentInputRef}
                            type="file"
                            multiple
                            onChange={(event) => void handleDraftAttachmentChange(event)}
                            className="hidden"
                            aria-label="Add attachments"
                          />
                          <Button
                            emphasis="outline"
                            size="compact"
                            onClick={() => draftAttachmentInputRef.current?.click()}
                            icon={<Paperclip className="h-3.5 w-3.5" />}
                          >
                            Add attachments
                          </Button>
                          {activeDraft.attachments.map((attachment) => (
                            <span
                              key={attachment.filename}
                              className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px]"
                            >
                              <span className="max-w-56 truncate">{attachment.filename}</span>
                              <IconButton
                                size="micro"
                                onClick={() => removeDraftAttachment(attachment.filename)}
                                label={`Remove ${attachment.filename}`}
                                icon={<X />}
                              />
                            </span>
                          ))}
                        </div>

                        {draftError && (
                          <p className="rounded-md border border-danger-muted bg-danger-subtle px-2 py-1 text-[11px] text-danger">
                            {draftError}
                          </p>
                        )}
                        {draftNotice && !draftError && (
                          <p className="rounded-md border border-success-muted bg-success-subtle px-2 py-1 text-[11px] text-success">
                            {draftNotice}
                          </p>
                        )}

                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <Button
                            intent="primary"
                            size="compact"
                            onClick={() => void handleSendDraft()}
                            disabled={draftSending || draftSaving}
                            icon={<ArrowRight className="h-3.5 w-3.5" />}
                          >
                            {draftSending ? 'Sending...' : 'Send'}
                          </Button>
                          <Button
                            emphasis="outline"
                            size="compact"
                            onClick={() => void handleSaveDraft()}
                            disabled={draftSending || draftSaving}
                            icon={<Pencil className="h-3.5 w-3.5" />}
                          >
                            {draftSaving ? 'Saving...' : 'Save as Draft'}
                          </Button>
                          <Button
                            emphasis="ghost"
                            size="compact"
                            onClick={() => void handleDiscardDraft()}
                            disabled={draftSending || draftSaving}
                            icon={<Trash2 className="h-3.5 w-3.5" />}
                          >
                            Discard
                          </Button>
                        </div>
                        </div>
                      </div>
                      </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground text-center">
                    {selectedThreadLoading || isLoading ? (
                      <div>
                        <div className="inline-flex h-8 w-8 items-center justify-center rounded-full border-2 border-primary/20">
                          <div className="h-6 w-6 rounded-full border-2 border-transparent border-t-primary animate-spin" />
                        </div>
                        <p className="mt-2">
                          {selectedThreadLoading
                            ? 'Loading message...'
                            : 'Preparing thread viewer...'}
                        </p>
                      </div>
                    ) : (
                      <p>Select a message with a thread to open its chronological conversation.</p>
                    )}
                  </div>
                </div>
              )}
            </article>
        </section>
      )}

      {activeTab === 'settings' && (
        <section className="space-y-4">
          <section className="rounded-2xl border border-border bg-card p-3">
            <AnimatedTabBar
              tabs={settingsTabs}
              activeId={activeSettingsTab}
              onSelect={(tabId) => setTabInUrl('settings', tabId)}
              ariaLabel="Mailbox settings sections"
              testId="mailbox-settings-tabs"
              className="grid gap-2 sm:grid-cols-3"
              buttonClassName="px-3 py-2 text-sm font-medium"
            />
          </section>

          {activeSettingsTab === 'accounts' && (
            <section className="space-y-4">
              {/* 3rd-level panel toggles */}
              <div className="flex flex-wrap gap-2">
                <Button
                  emphasis="outline"
                  intent={showConnectCard ? 'primary' : 'neutral'}
                  size="compact"
                  onClick={() => setShowConnectCard((v) => !v)}
                >
                  {showConnectCard ? 'Hide: Add Account' : '+ Add Account'}
                </Button>
                <Button
                  emphasis="outline"
                  intent={showConnectedCard ? 'primary' : 'neutral'}
                  size="compact"
                  onClick={() => setShowConnectedCard((v) => !v)}
                >
                  {showConnectedCard
                    ? `Hide: Connected (${accounts.filter((a) => a.status !== 'disconnected').length})`
                    : `Show: Connected (${accounts.filter((a) => a.status !== 'disconnected').length})`}
                </Button>
                <Button
                  emphasis={analyticsHighlight ? 'solid' : 'outline'}
                  intent={analyticsHighlight || showAnalytics ? 'primary' : 'neutral'}
                  size="compact"
                  onClick={() => {
                    const next = !showAnalytics
                    setShowAnalytics(next)
                    if (next) void loadAnalytics()
                  }}
                  className={
                    analyticsHighlight
                      ? 'animate-[primary-pulse_1s_ease-in-out_3] motion-reduce:animate-none'
                      : undefined
                  }
                >
                  {showAnalytics ? 'Hide: Analytics' : 'Show: Analytics'}
                </Button>
                <Button
                  emphasis={mailboxSettingsHighlight ? 'solid' : 'outline'}
                  intent={mailboxSettingsHighlight || showMailboxSettings ? 'primary' : 'neutral'}
                  size="compact"
                  onClick={() => setShowMailboxSettings((v) => !v)}
                  className={
                    mailboxSettingsHighlight ? 'animate-pulse motion-reduce:animate-none' : undefined
                  }
                >
                  {showMailboxSettings ? 'Hide: Mailbox Settings' : 'Mailbox Settings'}
                </Button>
              </div>

              <div
                className={`grid gap-4 ${[showConnectCard, showConnectedCard, showMailboxSettings].filter(Boolean).length >= 2 ? 'lg:grid-cols-[1fr_1.1fr]' : ''} ${[showConnectCard, showConnectedCard, showMailboxSettings].filter(Boolean).length === 3 ? 'xl:grid-cols-3' : ''}`}
              >
                {showConnectCard && (
                  <article className="rounded-2xl border border-border bg-card p-4">
                    <h2 className="text-lg font-semibold">Connect Account</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Use OAuth for Gmail and Outlook for secure provider authorization.
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <Button
                        emphasis="outline"
                        onClick={() => setShowGmailOAuthInfo(true)}
                      >
                        Connect Gmail (OAuth)
                      </Button>
                      <Button
                        emphasis="outline"
                        onClick={() => void handleConnectOAuth('outlook')}
                      >
                        Connect Outlook (OAuth)
                      </Button>
                    </div>

                    {showGmailOAuthInfo && (
                      <div className="mt-4 rounded-xl border border-warning-muted bg-warning-subtle p-4">
                        <div className="flex items-start gap-3">
                          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
                          <div className="min-w-0">
                            <h3 className="text-sm font-semibold text-foreground">
                              Google&apos;s unverified app warning
                            </h3>
                            <p className="mt-1 text-xs leading-5 text-foreground/80">
                              Coordination Manager has not completed Google&apos;s OAuth verification process because the required security assessment has a significant cost for this project. Google will display this warning before you continue. This is expected for this connection and does not change the security protections built into Coordination Manager.
                            </p>
                            <p className="mt-2 text-xs leading-5 text-foreground/80">
                              We use OAuth, encrypted credential storage, least-privilege access where supported, and server-side authorization checks. Our goal is to provide practical coordination tools while treating your data with the care and security expected of a professional service.
                            </p>

                            <p className="mt-3 text-xs leading-5 text-foreground/80">
                              Learn more about our{' '}
                              <a
                                href={`${docsBaseUrl}/legal/security-policy`}
                                target="_blank"
                                rel="noreferrer"
                                className="font-semibold underline underline-offset-2 hover:text-warning"
                              >
                                security stance
                              </a>
                              ,{' '}
                              <a
                                href={`${docsBaseUrl}/section/risk`}
                                target="_blank"
                                rel="noreferrer"
                                className="font-semibold underline underline-offset-2 hover:text-warning"
                              >
                                risk management and ethics
                              </a>
                              , and{' '}
                              <a
                                href={`${docsBaseUrl}/guides/mailbox-architecture`}
                                target="_blank"
                                rel="noreferrer"
                                className="font-semibold underline underline-offset-2 hover:text-warning"
                              >
                                Mailbox architecture
                              </a>
                              .
                            </p>

                            <div className="mt-4">
                              <h4 className="text-xs font-semibold text-foreground">
                                What Google&apos;s warning looks like
                              </h4>
                              <div className="mt-3 space-y-4 text-xs leading-5 text-foreground">
                                <figure className="space-y-2">
                                  <figcaption>
                                    <span className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-warning-muted text-[10px] font-bold text-foreground">1</span>
                                    Select <strong>Advanced</strong>.
                                  </figcaption>
                                  <img
                                    src="/mailbox/google-warning.png"
                                    alt="Google unverified app warning with the Advanced link visible"
                                    className="h-auto w-full max-w-[670px]"
                                  />
                                </figure>
                                <figure className="space-y-2">
                                  <figcaption>
                                    <span className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-warning-muted text-[10px] font-bold text-foreground">2</span>
                                    Select <strong>Go to Coordination Manager (unsafe)</strong>.
                                  </figcaption>
                                  <img
                                    src="/mailbox/google-warning-advanced.png"
                                    alt="Expanded Google unverified app warning with the continue link visible"
                                    className="h-auto w-full max-w-[670px]"
                                  />
                                </figure>
                                <p>
                                  <span className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-warning-muted text-[10px] font-bold text-foreground">3</span>
                                  Continue with the normal Google sign-in and consent steps.
                                </p>
                              </div>
                            </div>

                            <div className="mt-4 flex flex-wrap items-center gap-2">
                              <Button
                                intent="primary"
                                onClick={() => void handleConnectOAuth('gmail')}
                              >
                                Continue to Google
                              </Button>
                              <Button
                                emphasis="ghost"
                                onClick={() => setShowGmailOAuthInfo(false)}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {isLocalhost && (
                      <div className="mt-3 space-y-2 border-t border-border pt-3">
                        <p className="text-xs text-muted-foreground">
                          Manual bootstrap (dev/testing)
                        </p>
                        <input
                          value={accountForm.display_name}
                          onChange={(e) =>
                            setAccountForm((prev) => ({ ...prev, display_name: e.target.value }))
                          }
                          placeholder="Display name (optional)"
                          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                        />
                      <select
                        value={accountForm.provider}
                        onChange={(e) =>
                          setAccountForm((prev) => ({
                            ...prev,
                            provider: e.target.value as MailboxAccountProvider,
                          }))
                        }
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="gmail">Gmail</option>
                        <option value="outlook">Outlook / Hotmail</option>
                      </select>
                      <input
                        value={accountForm.address}
                        onChange={(e) =>
                          setAccountForm((prev) => ({ ...prev, address: e.target.value }))
                        }
                        placeholder="Mailbox address"
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      />
                      <Button
                        intent="primary"
                        fullWidth
                        onClick={() => void handleConnectAccount()}
                      >
                        Connect Account
                      </Button>
                      </div>
                    )}
                  </article>
                )}

                {showConnectedCard && (
                  <article className="rounded-2xl border border-border bg-card p-4">
                    <h2 className="text-lg font-semibold">Connected Accounts</h2>
                    <div className="mt-3 space-y-2">
                      {accounts.map((account) => (
                        <div
                          key={account.id}
                          className="rounded-xl border border-border bg-background p-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold">
                                {account.display_name || account.address}
                              </p>
                              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                <span className="truncate">{account.address}</span>
                                <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase">
                                  {account.provider}
                                </span>
                                {account.is_primary && (
                                  <span className="rounded-full border border-info-muted bg-info-subtle px-1.5 py-0.5 text-[10px] font-medium uppercase text-info dark:border-info-muted">
                                    Primary
                                  </span>
                                )}
                              </div>
                            </div>
                            <span
                              className={`text-[11px] rounded-full px-2 py-0.5 uppercase font-medium ${
                                account.status === 'connected'
                                  ? 'bg-success-subtle text-success'
                                  : account.status === 'syncing'
                                    ? 'bg-info-subtle text-info'
                                    : account.status === 'error'
                                      ? 'bg-danger-subtle text-danger'
                                      : 'bg-muted text-muted-foreground'
                              }`}
                            >
                              {account.status}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {syncCoverageByAccountId[account.id]?.lastImportText ??
                              'Last import status unavailable'}
                          </p>
                          {syncCoverageByAccountId[account.id]?.gapText && (
                            <div className="mt-1 rounded-md border border-warning-muted bg-warning-subtle px-2 py-1 text-[11px] text-warning">
                              {syncCoverageByAccountId[account.id]?.gapText}
                            </div>
                          )}
                          {account.sync_error && (
                            <p className="text-xs text-danger mt-1">
                              {account.sync_error}
                            </p>
                          )}
                          {syncUiByAccountId[account.id] && (
                            <MailboxSyncProgress
                              view={syncUiByAccountId[account.id]}
                              variant="inline"
                            />
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <AccountActionTooltip text="Fetch recent messages from this account." align="start">
                              <Button
                                emphasis={highlightSyncCtaAccountId === account.id ? 'solid' : 'outline'}
                                intent="primary"
                                size="compact"
                                onClick={() => void handleSyncAccount(account.id)}
                                disabled={
                                  Boolean(syncUiByAccountId[account.id]) ||
                                  syncingAccountId === account.id ||
                                  account.status === 'syncing'
                                }
                              >
                                {syncUiByAccountId[account.id] &&
                                  syncUiByAccountId[account.id].phase !== 'complete' && (
                                    <span className="inline-block h-3 w-3 rounded-full border border-transparent border-t-current animate-spin" />
                                  )}
                                {syncUiByAccountId[account.id]
                                  ? syncUiByAccountId[account.id].label
                                  : 'Run Sync'}
                              </Button>
                            </AccountActionTooltip>
                            {account.status === 'error' && (
                              <AccountActionTooltip
                                text={
                                  requiresMailboxReconnect(account)
                                    ? 'Authorize this account again so new email can sync.'
                                    : 'Try importing this account again after a sync error.'
                                }
                              >
                                <Button
                                  emphasis="outline"
                                  size="compact"
                                  onClick={() =>
                                    requiresMailboxReconnect(account)
                                      ? handleReconnectAccount(account)
                                      : void handleRetrySync(account.id, account)
                                  }
                                  disabled={syncingAccountId === account.id}
                                >
                                  {syncingAccountId === account.id && (
                                    <span className="inline-block h-3 w-3 rounded-full border border-transparent border-t-current animate-spin" />
                                  )}
                                  {requiresMailboxReconnect(account)
                                    ? `Reconnect ${account.provider === 'gmail' ? 'Gmail' : 'Outlook'}`
                                    : 'Retry Sync'}
                                </Button>
                              </AccountActionTooltip>
                            )}
                            <AccountActionTooltip text="Change the history and folders included when this account syncs.">
                              <Button
                                emphasis="outline"
                                size="compact"
                                onClick={() => {
                                  const isOpening = !expandedAccountIds.includes(account.id)
                                  setExpandedAccountIds((prev) =>
                                    isOpening
                                      ? [...prev, account.id]
                                      : prev.filter((id) => id !== account.id)
                                  )
                                  if (isOpening) {
                                    setExpandedAccountSettings((prev) => ({
                                      ...prev,
                                      [account.id]: {
                                        ...prev[account.id],
                                        import: account.last_synced_at
                                          ? prev[account.id]?.import
                                          : true,
                                      },
                                    }))
                                  }
                                }}
                              >
                                {expandedAccountIds.includes(account.id)
                                  ? 'Hide settings'
                                  : 'Sync settings'}
                              </Button>
                            </AccountActionTooltip>
                            <AccountActionTooltip text={account.is_primary ? 'Stop using this as the default From account for new messages.' : 'Use this as the default From account for new messages.'}>
                              <Button
                                emphasis="outline"
                                size="compact"
                                onClick={() => void handlePrimaryAccount(account)}
                                disabled={updatingPrimaryAccountId === account.id}
                              >
                                {updatingPrimaryAccountId === account.id
                                  ? 'Saving...'
                                  : account.is_primary
                                    ? 'Remove Primary'
                                    : 'Make Primary'}
                              </Button>
                            </AccountActionTooltip>
                            <AccountActionTooltip text="Disconnect this account and remove its imported mailbox data from Coordination Manager.">
                              <Button
                                emphasis="outline"
                                intent="danger"
                                size="compact"
                                onClick={(event) => requestRemoveAccount(account, event)}
                                disabled={removingAccountId === account.id}
                              >
                                {removingAccountId === account.id && (
                                  <span className="inline-block h-3 w-3 rounded-full border border-transparent border-t-current animate-spin" />
                                )}
                                {removingAccountId === account.id ? 'Removing...' : 'Remove Account'}
                              </Button>
                            </AccountActionTooltip>
                          </div>
                          {expandedAccountIds.includes(account.id) &&
                            (() => {
                              const cfg = getImportConfig(account.id)
                              const quickCfg = normalizeAccountQuickSyncConfig(account.sync_options)
                              const selectedImportSourceCount = [
                                cfg.includeInbox,
                                cfg.includeSent,
                                cfg.includeTrash,
                                cfg.includeSpam,
                                cfg.includeArchived,
                              ].filter(Boolean).length
                              const hasCompletedInitialImport = Boolean(account.last_synced_at)
                              const expandedSections = expandedAccountSettings[account.id] || {
                                import: !hasCompletedInitialImport,
                                quick: false,
                              }
                              const toggleSection = (section: 'import' | 'quick') => {
                                setExpandedAccountSettings((prev) => ({
                                  ...prev,
                                  [account.id]: {
                                    ...expandedSections,
                                    [section]: !expandedSections[section],
                                  },
                                }))
                              }
                              const quickSyncSettings = (
                                <AccountQuickSyncSettings
                                  maxMessages={account.quick_sync_max_messages}
                                  sources={quickCfg}
                                  isExpanded={expandedSections.quick === true}
                                  onToggle={() => toggleSection('quick')}
                                  onMaxMessagesChange={(value) =>
                                    void updateQuickSyncMaxMessages(account.id, value)
                                  }
                                  onSourceChange={(key, value) =>
                                    void updateQuickSyncSource(account.id, key, value)
                                  }
                                />
                              )
                              return (
                                <div className="mt-3 rounded-xl border border-border bg-background p-4 space-y-5">
                                  {hasCompletedInitialImport && quickSyncSettings}
                                  <section className="rounded-lg border border-border bg-card">
                                    <Disclosure
                                      title="Import Settings"
                                      expanded={expandedSections.import === true}
                                      onToggle={() => toggleSection('import')}
                                      panelId={`mailbox-import-settings-${account.id}`}
                                    />
                                    {expandedSections.import === true && (
                                      <div
                                        id={`mailbox-import-settings-${account.id}`}
                                        className="border-t border-border p-4 space-y-5"
                                      >

                                  <div className="space-y-1">
                                    <div className="flex justify-between text-xs">
                                      <span className="font-medium">Max messages per run</span>
                                      <span className="font-mono text-primary">
                                        {cfg.maxMessages}
                                      </span>
                                    </div>
                                    <input
                                      type="range"
                                      min={25}
                                      max={500}
                                      step={25}
                                      value={cfg.maxMessages}
                                      onChange={(e) =>
                                        setImportConfig(account.id, {
                                          maxMessages: Number(e.target.value),
                                        })
                                      }
                                      className="w-full accent-primary"
                                    />
                                    <div className="flex justify-between text-[10px] text-muted-foreground">
                                      <span>25 (fast)</span>
                                      <span>500 (thorough)</span>
                                    </div>
                                    <p className="text-[11px] text-muted-foreground">
                                      Higher values import more history but take longer. Each run
                                      fetches one page; subsequent syncs paginate forward.
                                    </p>
                                  </div>

                                  <div className="space-y-1">
                                    <div className="flex items-center justify-between text-xs gap-2">
                                      <span className="font-medium">History depth</span>
                                      <div className="flex items-center gap-1">
                                        <Button
                                          size="micro"
                                          emphasis="outline"
                                          onClick={() =>
                                            setImportConfig(account.id, {
                                              daysBack: Math.max(1, cfg.daysBack - 1),
                                            })
                                          }
                                          title="-1 day"
                                        >
                                          -
                                        </Button>
                                        <input
                                          type="number"
                                          min={1}
                                          max={365}
                                          value={cfg.daysBack}
                                          onChange={(e) => {
                                            const v = Math.max(
                                              1,
                                              Math.min(365, Number(e.target.value) || 1)
                                            )
                                            setImportConfig(account.id, { daysBack: v })
                                          }}
                                          className="w-14 rounded border border-input bg-background px-1.5 py-0.5 text-center text-xs font-mono focus:outline-hidden focus:ring-1 focus:ring-ring"
                                        />
                                        <span className="text-muted-foreground text-[11px]">
                                          days
                                        </span>
                                        <Button
                                          size="micro"
                                          emphasis="outline"
                                          onClick={() =>
                                            setImportConfig(account.id, {
                                              daysBack: Math.min(365, cfg.daysBack + 1),
                                            })
                                          }
                                          title="+1 day"
                                        >
                                          +
                                        </Button>
                                      </div>
                                    </div>
                                    {/* step=7 gives ~8px per tick -- fine tune with buttons or number input above */}
                                    <PullSlider
                                      min={1}
                                      max={365}
                                      value={cfg.daysBack}
                                      onChange={(v) => setImportConfig(account.id, { daysBack: v })}
                                    />
                                    <div className="flex justify-between text-[10px] text-muted-foreground">
                                      <span>1 day</span>
                                      <span>1 year</span>
                                    </div>
                                    {/* visual timeline strip */}
                                    <div className="relative mt-1 h-4 rounded-full bg-muted overflow-hidden">
                                      <div
                                        className="absolute inset-y-0 right-0 rounded-full bg-primary/20 transition-all"
                                        style={{
                                          width: `${(cfg.daysBack / 365) * 100}%`,
                                          left: 'auto',
                                        }}
                                      />
                                      <div
                                        className="absolute inset-y-0 right-0 w-0.5 bg-primary"
                                        style={{ right: `${100 - (cfg.daysBack / 365) * 100}%` }}
                                      />
                                      <span className="absolute inset-0 flex items-center justify-center text-[9px] text-muted-foreground">
                                        {new Date(
                                          Date.now() - cfg.daysBack * 86400000
                                        ).toLocaleDateString(undefined, {
                                          month: 'short',
                                          day: 'numeric',
                                          year: 'numeric',
                                        })}{' '}
                                        -- today
                                      </span>
                                    </div>
                                  </div>

                                  <div className="space-y-2">
                                    <p className="text-xs font-medium">Mail sources</p>
                                    <div className="grid grid-cols-2 gap-2">
                                      {(
                                        [
                                          'includeInbox',
                                          'includeSent',
                                          'includeTrash',
                                          'includeSpam',
                                          'includeArchived',
                                        ] as const
                                      ).map((key) => {
                                        const labels: Record<string, string> = {
                                          includeInbox: 'Inbox',
                                          includeSent: 'Sent',
                                          includeTrash: 'Trash',
                                          includeSpam: 'Spam',
                                          includeArchived: 'Archived',
                                        }
                                        return (
                                          <label
                                            key={key}
                                            className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs cursor-pointer hover:bg-accent/30"
                                          >
                                            <input
                                              type="checkbox"
                                              checked={cfg[key]}
                                              disabled={cfg[key] && selectedImportSourceCount === 1}
                                              onChange={(e) =>
                                                void updateImportSource(
                                                  account.id,
                                                  key,
                                                  e.target.checked
                                                )
                                              }
                                              className="accent-primary disabled:opacity-50"
                                            />
                                            {labels[key]}
                                          </label>
                                        )
                                      })}
                                    </div>
                                    <p className="text-[11px] text-muted-foreground">
                                      Deleted Gmail emails via IMAP end up in Trash on Gmail servers
                                      -- enable Trash to include them.
                                    </p>
                                  </div>

                                  <Button
                                    intent="primary"
                                    fullWidth
                                    onClick={() => void handleSyncAccount(account.id)}
                                    disabled={
                                      Boolean(syncUiByAccountId[account.id]) ||
                                      syncingAccountId === account.id ||
                                      account.status === 'syncing'
                                    }
                                  >
                                    {syncUiByAccountId[account.id] &&
                                      syncUiByAccountId[account.id].phase !== 'complete' && (
                                        <span className="inline-block h-4 w-4 rounded-full border-2 border-transparent border-t-primary-foreground animate-spin" />
                                      )}
                                    {syncUiByAccountId[account.id]
                                      ? syncUiByAccountId[account.id].label
                                      : `Start Import -- ${cfg.maxMessages} messages, last ${cfg.daysBack} days`}
                                  </Button>
                                      </div>
                                    )}
                                  </section>
                                  {!hasCompletedInitialImport && quickSyncSettings}
                                </div>
                              )
                            })()}
                        </div>
                      ))}
                      {accounts.length === 0 && (
                        <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground text-center">
                          No connected accounts.
                        </div>
                      )}
                    </div>
                  </article>
                )}

                {showMailboxSettings && (
                  <article className="rounded-2xl border border-border bg-card p-4 self-start">
                    <h2 className="text-lg font-semibold">Mailbox Settings</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Adjust default display and sync behaviour. Changes take effect immediately and
                      are saved locally.
                    </p>

                    <div className="mt-4 space-y-4">
                      <details
                        open={mailboxSettingsSections.threadView}
                        onToggle={(event) => { const open = (event.currentTarget as HTMLDetailsElement).open; setMailboxSettingsSections((current) => ({ ...current, threadView: open })) }}
                        className="rounded-xl border border-border/60 bg-background/60 p-3"
                      >
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground [&::-webkit-details-marker]:hidden">
                          <span>Thread View</span>
                          <ChevronDown className="h-4 w-4" />
                        </summary>
                        <div className="mt-3 space-y-3">
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Emails are threaded by the provider first. These optional rules can also
                            group imported emails by normalized subject, sender email address, reply
                            behavior, and timing. Sender email rules compare the complete address,
                            not just its domain.
                          </p>
                        <div className="space-y-2">
                          <label className="flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2 cursor-pointer hover:bg-accent/30">
                            <input
                              type="checkbox"
                              checked={threadingOptions.sameNameAndEmail}
                              onChange={(event) =>
                                setThreadingOptions((current) => ({
                                  ...current,
                                  sameNameAndEmail: event.target.checked,
                                }))
                              }
                              disabled={!threadingOptionsLoaded}
                              className="mt-0.5 accent-primary"
                            />
                            <span>
                              <span className="block text-xs font-medium">
                                Same normalized subject and sender email within days
                              </span>
                              <span className="block text-[11px] text-muted-foreground">
                                Groups matching subjects from the same full sender email address within the configured time window.
                              </span>
                            </span>
                            <input
                              type="number"
                              min={1}
                              max={60}
                              value={threadingOptions.sameNameAndEmailDays}
                              onChange={(event) => setThreadingOptions((current) => ({
                                ...current,
                                sameNameAndEmailDays: Math.min(60, Math.max(1, Number(event.target.value) || 1)),
                              }))}
                              disabled={!threadingOptionsLoaded || !threadingOptions.sameNameAndEmail}
                              aria-label="Subject and sender email thread window in days"
                              className="ml-auto w-16 shrink-0 rounded border border-input bg-background px-1.5 py-1 text-xs text-center disabled:opacity-50"
                            />
                          </label>
                          <label className="flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2 cursor-pointer hover:bg-accent/30">
                            <input
                              type="checkbox"
                              checked={threadingOptions.sameNameWithoutReply}
                              onChange={(event) =>
                                setThreadingOptions((current) => ({
                                  ...current,
                                  sameNameWithoutReply: event.target.checked,
                                }))
                              }
                              disabled={!threadingOptionsLoaded}
                              className="mt-0.5 accent-primary"
                            />
                            <span>
                              <span className="block text-xs font-medium">
                                Same normalized subject, no reply, within days
                              </span>
                              <span className="block text-[11px] text-muted-foreground">
                                Groups matching subjects from no-reply messages within the configured time window.
                              </span>
                            </span>
                            <input
                              type="number"
                              min={1}
                              max={60}
                              value={threadingOptions.sameNameWithoutReplyDays}
                              onChange={(event) => setThreadingOptions((current) => ({
                                ...current,
                                sameNameWithoutReplyDays: Math.min(60, Math.max(1, Number(event.target.value) || 1)),
                              }))}
                              disabled={!threadingOptionsLoaded || !threadingOptions.sameNameWithoutReply}
                              aria-label="Subject and no-reply thread window in days"
                              className="ml-auto w-16 shrink-0 rounded border border-input bg-background px-1.5 py-1 text-xs text-center disabled:opacity-50"
                            />
                          </label>
                          <label className="flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2 cursor-pointer hover:bg-accent/30">
                            <input
                              type="checkbox"
                              checked={threadingOptions.sameNameWithinSevenDays}
                              onChange={(event) =>
                                setThreadingOptions((current) => ({
                                  ...current,
                                  sameNameWithinSevenDays: event.target.checked,
                                }))
                              }
                              disabled={!threadingOptionsLoaded}
                              className="mt-0.5 accent-primary"
                            />
                            <span>
                              <span className="block text-xs font-medium">
                                Same normalized subject within days
                              </span>
                              <span className="block text-[11px] text-muted-foreground">
                                Groups matching messages received within the configured day window (1-60 days).
                              </span>
                            </span>
                            <input
                              type="number"
                              min={1}
                              max={60}
                              step={1}
                              value={threadingOptions.sameNameWithinDays}
                              onChange={(event) =>
                                setThreadingOptions((current) => ({
                                  ...current,
                                  sameNameWithinDays: Math.min(60, Math.max(1, Number(event.target.value) || 1)),
                                }))
                              }
                              disabled={!threadingOptionsLoaded || !threadingOptions.sameNameWithinSevenDays}
                              aria-label="Normalized subject thread window in days"
                              className="ml-auto w-16 shrink-0 rounded border border-input bg-background px-1.5 py-1 text-xs text-center disabled:opacity-50"
                            />
                          </label>
                          <label className="flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2 cursor-pointer hover:bg-accent/30">
                            <input
                              type="checkbox"
                              checked={threadingOptions.sameEmailWithoutReply}
                              onChange={(event) =>
                                setThreadingOptions((current) => ({
                                  ...current,
                                  sameEmailWithoutReply: event.target.checked,
                                }))
                              }
                              disabled={!threadingOptionsLoaded}
                              className="mt-0.5 accent-primary"
                            />
                            <span>
                              <span className="block text-xs font-medium">
                                Same sender email, no reply, within days
                              </span>
                              <span className="block text-[11px] text-muted-foreground">
                                Groups no-reply messages from the same full sender email address within the configured time window, even if subjects differ.
                              </span>
                            </span>
                            <input
                              type="number"
                              min={1}
                              max={60}
                              value={threadingOptions.sameEmailWithoutReplyDays}
                              onChange={(event) => setThreadingOptions((current) => ({
                                ...current,
                                sameEmailWithoutReplyDays: Math.min(60, Math.max(1, Number(event.target.value) || 1)),
                              }))}
                              disabled={!threadingOptionsLoaded || !threadingOptions.sameEmailWithoutReply}
                              aria-label="Sender email and no-reply thread window in days"
                              className="ml-auto w-16 shrink-0 rounded border border-input bg-background px-1.5 py-1 text-xs text-center disabled:opacity-50"
                            />
                          </label>
                          <label className="flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2 cursor-pointer hover:bg-accent/30">
                            <input
                              type="checkbox"
                              checked={threadingOptions.sameEmailWithinSevenDays}
                              onChange={(event) =>
                                setThreadingOptions((current) => ({
                                  ...current,
                                  sameEmailWithinSevenDays: event.target.checked,
                                }))
                              }
                              disabled={!threadingOptionsLoaded}
                              className="mt-0.5 accent-primary"
                            />
                            <span>
                              <span className="block text-xs font-medium">
                                Same sender email within days (any subject)
                              </span>
                              <span className="block text-[11px] text-muted-foreground">
                                Groups messages from the same full sender email address that arrived within the configured day window, even if subjects differ.
                              </span>
                            </span>
                            <input
                              type="number"
                              min={1}
                              max={60}
                              step={1}
                              value={threadingOptions.sameEmailWithinDays}
                              onChange={(event) =>
                                setThreadingOptions((current) => ({
                                  ...current,
                                  sameEmailWithinDays: Math.min(60, Math.max(1, Number(event.target.value) || 1)),
                                }))
                              }
                              disabled={!threadingOptionsLoaded || !threadingOptions.sameEmailWithinSevenDays}
                              aria-label="Sender email thread window in days"
                              className="ml-auto w-16 shrink-0 rounded border border-input bg-background px-1.5 py-1 text-xs text-center disabled:opacity-50"
                            />
                          </label>
                        </div>
                        </div>
                      </details>

                      {/* Inbox display */}
                      <details
                        open={mailboxSettingsSections.inboxDisplay}
                        onToggle={(event) => { const open = (event.currentTarget as HTMLDetailsElement).open; setMailboxSettingsSections((current) => ({ ...current, inboxDisplay: open })) }}
                        className="rounded-xl border border-border/60 bg-background/60 p-3"
                      >
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground [&::-webkit-details-marker]:hidden">
                          <span>Inbox Display</span>
                          <ChevronDown className="h-4 w-4" />
                        </summary>
                        <div className="mt-3 space-y-3">

                        <label className="flex flex-col gap-1.5">
                          <span className="text-xs font-medium">Default messages to load</span>
                          <span className="text-[11px] text-muted-foreground">
                            How many messages are shown in the inbox list on first load and after
                            each sync.
                          </span>
                          <div className="flex items-center gap-3">
                            <input
                              ref={mailboxSettingsInputRef}
                              type="number"
                              min={10}
                              max={500}
                              step={10}
                              value={inboxLoadLimit}
                              onChange={(e) => handleMailboxLoadLimitChange(Number(e.target.value))}
                              className={`w-28 rounded-lg border px-3 py-2 text-sm transition-all focus:outline-hidden focus:ring-2 focus:ring-ring ${
                                mailboxSettingsHighlight
                                  ? 'border-primary ring-2 ring-primary animate-pulse motion-reduce:animate-none bg-primary/5'
                                  : 'border-input bg-background'
                              }`}
                            />
                            <input
                              type="range"
                              min={10}
                              max={500}
                              step={10}
                              value={inboxLoadLimit}
                              onChange={(e) => handleMailboxLoadLimitChange(Number(e.target.value))}
                              className="flex-1"
                            />
                            <span className="text-xs font-mono w-10 text-right text-primary">
                              {inboxLoadLimit}
                            </span>
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            Min 10 -- Max 500. Default: {MESSAGE_LOAD_DEFAULT}.
                          </p>
                        </label>

                        <label className="flex flex-col gap-1.5">
                          <span className="text-xs font-medium">Inbox panel width</span>
                          <span className="text-[11px] text-muted-foreground">
                            Fraction of the split view occupied by the inbox list. Drag the divider
                            to adjust, or set it here.
                          </span>
                          <div className="flex items-center gap-3">
                            <input
                              type="number"
                              min={18}
                              max={45}
                              step={1}
                              value={Math.round(inboxPanelRatio * 100)}
                              onChange={(e) => {
                                const pct = Math.min(45, Math.max(18, Number(e.target.value)))
                                setInboxPanelRatio(pct / 100)
                              }}
                              className="w-20 rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
                            />
                            <span className="text-xs text-muted-foreground">%</span>
                            <input
                              type="range"
                              min={18}
                              max={45}
                              step={1}
                              value={Math.round(inboxPanelRatio * 100)}
                              onChange={(e) => setInboxPanelRatio(Number(e.target.value) / 100)}
                              className="flex-1"
                            />
                            <span className="text-xs font-mono w-10 text-right text-primary">
                              {Math.round(inboxPanelRatio * 100)}%
                            </span>
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            Range: 18% -- 45%. Default:{' '}
                            {Math.round(MAILBOX_INBOX_WIDTH_DEFAULT_RATIO * 100)}%.
                          </p>
                        </label>
                        </div>
                      </details>

                      <details
                        open={mailboxSettingsSections.confirmations}
                        onToggle={(event) => { const open = (event.currentTarget as HTMLDetailsElement).open; setMailboxSettingsSections((current) => ({ ...current, confirmations: open })) }}
                        className="rounded-xl border border-border/60 bg-background/60 p-3"
                      >
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground [&::-webkit-details-marker]:hidden">
                          <span>Confirmation Prompts</span>
                          <ChevronDown className="h-4 w-4" />
                        </summary>
                        <div className="mt-3 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-[11px] text-muted-foreground">
                              Choose whether destructive actions ask for confirmation before
                              continuing.
                            </p>
                          </div>
                          <Button
                            emphasis="outline"
                            size="compact"
                            onClick={restoreSuppressedConfirms}
                            disabled={suppressedConfirmKeys.length === 0}
                          >
                            Restore all
                          </Button>
                        </div>
                        <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border/70 bg-background">
                          {MAILBOX_CONFIRMATION_OPTIONS.map((option) => {
                            const isSuppressed = suppressedConfirmKeys.includes(option.key)

                            return (
                              <div
                                key={option.key}
                                className="flex items-center justify-between gap-3 px-2.5 py-2.5"
                              >
                                <div className="min-w-0">
                                  <p className="text-xs font-medium text-foreground">{option.label}</p>
                                  <p className="text-[11px] text-muted-foreground">
                                    {option.description}
                                  </p>
                                </div>
                                {isSuppressed ? (
                                  <Button
                                    emphasis="outline"
                                    size="compact"
                                    onClick={() => restoreSuppressedConfirm(option.key)}
                                    className="shrink-0"
                                  >
                                    Restore to ask again
                                  </Button>
                                ) : (
                                  <span className="shrink-0 text-[11px] font-medium text-success">
                                    On
                                  </span>
                                )}
                              </div>
                            )
                          })}
                          <div className="flex items-center justify-between gap-3 px-2.5 py-2.5">
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-foreground">Remove a connected account</p>
                              <p className="text-[11px] text-muted-foreground">
                                Always confirmed because it removes the account and its imported data.
                              </p>
                            </div>
                            <span className="shrink-0 text-[11px] font-medium text-success">
                              Always on
                            </span>
                          </div>
                        </div>
                        </div>
                      </details>

                      {/* Sync defaults */}
                      <details
                        open={mailboxSettingsSections.syncDefaults}
                        onToggle={(event) => { const open = (event.currentTarget as HTMLDetailsElement).open; setMailboxSettingsSections((current) => ({ ...current, syncDefaults: open })) }}
                        className="rounded-xl border border-border/60 bg-background/60 p-3"
                      >
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground [&::-webkit-details-marker]:hidden">
                          <span>Sync Defaults (per account)</span>
                          <ChevronDown className="h-4 w-4" />
                        </summary>
                        <div className="mt-3 space-y-2">
                        <p className="text-[11px] text-muted-foreground">
                          Starting values for each account's Import Settings.{' '}
                          <button
                            type="button"
                            onClick={() => setShowConnectedCard((visible) => !visible)}
                            className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
                          >
                            {showConnectedCard ? 'Hide Connected Accounts.' : 'Show Connected Accounts.'}
                          </button>
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2 rounded-xl border border-border/60 bg-background/60 p-3 text-xs">
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">Max messages per sync</span>
                            <span className="font-mono text-foreground">
                              {DEFAULT_ACCOUNT_IMPORT_CONFIG.maxMessages}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">Days of history</span>
                            <span className="font-mono text-foreground">
                              {DEFAULT_ACCOUNT_IMPORT_CONFIG.daysBack}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">Include inbox</span>
                            <span
                              className={`font-mono ${DEFAULT_ACCOUNT_IMPORT_CONFIG.includeInbox ? 'text-success' : 'text-foreground'}`}
                            >
                              {DEFAULT_ACCOUNT_IMPORT_CONFIG.includeInbox ? 'yes' : 'no'}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">Include sent</span>
                            <span
                              className={`font-mono ${DEFAULT_ACCOUNT_IMPORT_CONFIG.includeSent ? 'text-success' : 'text-foreground'}`}
                            >
                              {DEFAULT_ACCOUNT_IMPORT_CONFIG.includeSent ? 'yes' : 'no'}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">Include trash</span>
                            <span
                              className={`font-mono ${DEFAULT_ACCOUNT_IMPORT_CONFIG.includeTrash ? 'text-success' : 'text-foreground'}`}
                            >
                              {DEFAULT_ACCOUNT_IMPORT_CONFIG.includeTrash ? 'yes' : 'no'}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">Include spam</span>
                            <span
                              className={`font-mono ${DEFAULT_ACCOUNT_IMPORT_CONFIG.includeSpam ? 'text-success' : 'text-foreground'}`}
                            >
                              {DEFAULT_ACCOUNT_IMPORT_CONFIG.includeSpam ? 'yes' : 'no'}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">Include archived</span>
                            <span
                              className={`font-mono ${DEFAULT_ACCOUNT_IMPORT_CONFIG.includeArchived ? 'text-success' : 'text-foreground'}`}
                            >
                              {DEFAULT_ACCOUNT_IMPORT_CONFIG.includeArchived ? 'yes' : 'no'}
                            </span>
                          </div>
                        </div>
                        </div>
                      </details>

                      {/* New-mail notifications */}
                      <details
                        open={mailboxSettingsSections.notifications}
                        onToggle={(event) => { const open = (event.currentTarget as HTMLDetailsElement).open; setMailboxSettingsSections((current) => ({ ...current, notifications: open })) }}
                        className="rounded-xl border border-border/60 bg-background/60 p-3"
                      >
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground [&::-webkit-details-marker]:hidden">
                          <span>Notifications</span>
                          <ChevronDown className="h-4 w-4" />
                        </summary>
                        <div className="mt-3 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-[11px] text-muted-foreground">
                              Lights up a badge on the pinned Mailbox icon in the top nav when a
                              synced or updated message matches the rules below -- it does not send
                              a browser/OS notification. Each system and custom tag gets its own
                              rule: <span className="font-medium text-foreground">Notify</span> and{' '}
                              <span className="font-medium text-foreground">Don't notify</span> are
                              soft (another matching tag can override them);{' '}
                              <span className="font-medium text-foreground">Definitely notify</span>{' '}
                              forces the badge on even over a "Don't notify" match; and{' '}
                              <span className="font-medium text-foreground">Definitely don't notify</span>{' '}
                              is an absolute veto that always wins, even over "Definitely notify". A
                              message with no matching tag never triggers the badge -- notifications
                              are opt-in per tag, everything starts as "Don't notify" (Junk and Trash
                              start locked to "Definitely don't notify").
                            </p>
                          </div>
                          {isMailboxPinnedToQuickMenu ? (
                            <ToggleButton
                              size="compact"
                              pressed={notificationRulesState.enabled}
                              onPressedChange={() =>
                                setNotificationRulesState((prev) => ({ ...prev, enabled: !prev.enabled }))
                              }
                              className="shrink-0"
                            >
                              {notificationRulesState.enabled ? 'Enabled' : 'Disabled'}
                            </ToggleButton>
                          ) : (
                            <Button
                              emphasis="outline"
                              intent="primary"
                              size="compact"
                              onClick={requestPinMailboxToQuickMenu}
                              className="shrink-0"
                            >
                              Pin Mailbox to enable
                            </Button>
                          )}
                        </div>

                        {!isMailboxPinnedToQuickMenu && (
                          <p className="rounded-lg border border-dashed border-border/70 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                            The badge only appears on the Mailbox icon in the quick menu, so pin
                            Mailbox there first -- click "Pin Mailbox to enable" above.
                          </p>
                        )}

                        {isMailboxPinnedToQuickMenu && notificationRulesState.enabled && (
                          <MailboxNotificationRulesEditor
                            value={notificationRulesState}
                            onChange={setNotificationRulesState}
                            resolveUserTagLabel={resolveUserTagLabel}
                            onRequestTagPanel={() => setIsTagPanelOpen(true)}
                          />
                        )}
                        </div>
                      </details>
                    </div>
                  </article>
                )}
              </div>

              {/* Analytics dashboard */}
              {showAnalytics &&
                hasConnectedAccounts &&
                (() => {
                  const ad = analyticsData
                  const maxVol = ad
                    ? Math.max(...ad.volumeByWeekday.flatMap((d) => [d.received, d.sent]), 1)
                    : 1
                  const colorMap: Record<string, string> = {
                    muted: 'bg-muted-foreground/40',
                    emerald: 'bg-emerald-400',
                    blue: 'bg-blue-400',
                    amber: 'bg-amber-400',
                  }
                  const maxRt = ad
                    ? Math.max(
                        ...ad.responseTimeByWeekday.flatMap((d) => [
                          d.asInitiatorHours ?? 0,
                          d.asResponderHours ?? 0,
                        ]),
                        1
                      )
                    : 1
                  const maxCorr = ad?.topCorrespondents[0]?.count ?? 1

                  return (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="text-base font-semibold">Mailbox Analytics</h3>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {analyticsLoading
                              ? 'Loading...'
                              : (ad?.dataScope ?? 'Import email history to populate analytics.')}
                          </p>
                        </div>
                        <Button
                          emphasis="outline"
                          size="compact"
                          onClick={() => void loadAnalytics()}
                          disabled={analyticsLoading}
                        >
                          Refresh
                        </Button>
                      </div>

                      {analyticsLoading && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <span className="h-4 w-4 rounded-full border-2 border-transparent border-t-primary animate-spin" />
                          Computing analytics...
                        </div>
                      )}

                      {ad && (
                        <>
                          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                            {/* Volume by weekday */}
                            <article className="rounded-2xl border border-border bg-card p-4 space-y-3">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Volume by weekday
                              </p>
                              <div className="flex items-end gap-1.5 h-20">
                                {ad.volumeByWeekday.map(({ dayName, received, sent }) => (
                                  <div
                                    key={dayName}
                                    className="flex-1 flex flex-col items-center gap-0.5"
                                  >
                                    <div
                                      className="w-full flex flex-col justify-end gap-0.5"
                                      style={{ height: '64px' }}
                                    >
                                      <div
                                        className="w-full rounded-t bg-blue-400 dark:bg-blue-500 transition-all"
                                        style={{
                                          height: `${Math.max(2, (received / maxVol) * 52)}px`,
                                        }}
                                        title={`Received: ${received}`}
                                      />
                                      <div
                                        className="w-full rounded-t bg-primary/50 transition-all"
                                        style={{ height: `${Math.max(2, (sent / maxVol) * 52)}px` }}
                                        title={`Sent: ${sent}`}
                                      />
                                    </div>
                                    <span className="text-[9px] text-muted-foreground">
                                      {dayName}
                                    </span>
                                  </div>
                                ))}
                              </div>
                              <div className="flex gap-3 text-[10px] text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <span className="h-2 w-2 rounded-sm bg-blue-400" />
                                  Received
                                </span>
                                <span className="flex items-center gap-1">
                                  <span className="h-2 w-2 rounded-sm bg-primary/50" />
                                  Sent
                                </span>
                              </div>
                            </article>

                            {/* Word count */}
                            <article className="rounded-2xl border border-border bg-card p-4 space-y-3">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Word count distribution
                              </p>
                              <div className="space-y-1.5">
                                {ad.wordCountBuckets.map(({ bucket, pct }) => (
                                  <div key={bucket} className="space-y-0.5">
                                    <div className="flex justify-between text-[10px] text-muted-foreground">
                                      <span>{bucket}</span>
                                      <span>{pct}%</span>
                                    </div>
                                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                                      <div
                                        className="h-full rounded-full bg-primary/60 transition-all"
                                        style={{ width: `${pct}%` }}
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </article>

                            {/* Response behavior */}
                            <article className="rounded-2xl border border-border bg-card p-4 space-y-3">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Response behavior
                              </p>
                              <div className="space-y-2">
                                {ad.responseBehavior.map(({ label, pct, colorKey }) => (
                                  <div key={label} className="space-y-0.5">
                                    <div className="flex justify-between text-[10px] text-muted-foreground">
                                      <span>{label}</span>
                                      <span>{pct}%</span>
                                    </div>
                                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                                      <div
                                        className={`h-full rounded-full ${colorMap[colorKey] ?? 'bg-primary/50'} transition-all`}
                                        style={{ width: `${pct}%` }}
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </article>

                            {/* Thread initiator donut */}
                            <article className="rounded-2xl border border-border bg-card p-4 space-y-3">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Thread initiator
                              </p>
                              {(() => {
                                const total =
                                  ad.threadInitiator.iInitiated +
                                    ad.threadInitiator.theyInitiated || 1
                                const iPct = Math.round(
                                  (ad.threadInitiator.iInitiated / total) * 100
                                )
                                const circ = 88
                                return (
                                  <>
                                    <div className="flex items-center justify-center">
                                      <div className="relative h-24 w-24">
                                        <svg viewBox="0 0 36 36" className="h-24 w-24 -rotate-90">
                                          <circle
                                            cx="18"
                                            cy="18"
                                            r="14"
                                            fill="none"
                                            strokeWidth="5"
                                            className="stroke-muted"
                                          />
                                          <circle
                                            cx="18"
                                            cy="18"
                                            r="14"
                                            fill="none"
                                            strokeWidth="5"
                                            stroke="hsl(var(--primary))"
                                            strokeDasharray={`${(iPct / 100) * circ} ${circ}`}
                                            strokeLinecap="round"
                                          />
                                          <circle
                                            cx="18"
                                            cy="18"
                                            r="14"
                                            fill="none"
                                            strokeWidth="5"
                                            stroke="rgb(96 165 250)"
                                            strokeDasharray={`${((100 - iPct) / 100) * circ} ${circ}`}
                                            strokeDashoffset={`${-(iPct / 100) * circ}`}
                                            strokeLinecap="round"
                                          />
                                        </svg>
                                        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold">
                                          {iPct}/{100 - iPct}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="flex gap-3 text-[10px] text-muted-foreground justify-center">
                                      <span className="flex items-center gap-1">
                                        <span className="h-2 w-2 rounded-full bg-primary" />I (
                                        {ad.threadInitiator.iInitiated})
                                      </span>
                                      <span className="flex items-center gap-1">
                                        <span className="h-2 w-2 rounded-full bg-blue-400" />
                                        They ({ad.threadInitiator.theyInitiated})
                                      </span>
                                    </div>
                                  </>
                                )
                              })()}
                            </article>
                          </div>

                          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                            {/* Response time by weekday */}
                            <article className="rounded-2xl border border-border bg-card p-4 space-y-3 xl:col-span-2">
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                  Response time by day of week
                                </p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">
                                  Avg hours to first reply, grouped by which day the thread started.
                                  Blue = I sent first, threads where they wait on me. Green = They
                                  sent first, threads where I respond.
                                </p>
                              </div>
                              <div className="flex items-end gap-2 h-24">
                                {ad.responseTimeByWeekday.map(
                                  ({ dayName, asInitiatorHours, asResponderHours }) => (
                                    <div
                                      key={dayName}
                                      className="flex-1 flex flex-col items-center gap-0.5"
                                    >
                                      <div
                                        className="w-full flex gap-0.5 items-end"
                                        style={{ height: '72px' }}
                                      >
                                        <div
                                          className="flex-1 rounded-t bg-primary/60 transition-all"
                                          style={{
                                            height: asInitiatorHours
                                              ? `${Math.max(4, (asInitiatorHours / maxRt) * 68)}px`
                                              : '2px',
                                            opacity: asInitiatorHours ? 1 : 0.2,
                                          }}
                                          title={
                                            asInitiatorHours
                                              ? `I sent first: ${asInitiatorHours.toFixed(1)}h avg reply`
                                              : 'No data'
                                          }
                                        />
                                        <div
                                          className="flex-1 rounded-t bg-emerald-400 transition-all"
                                          style={{
                                            height: asResponderHours
                                              ? `${Math.max(4, (asResponderHours / maxRt) * 68)}px`
                                              : '2px',
                                            opacity: asResponderHours ? 1 : 0.2,
                                          }}
                                          title={
                                            asResponderHours
                                              ? `They sent first: ${asResponderHours.toFixed(1)}h avg I replied`
                                              : 'No data'
                                          }
                                        />
                                      </div>
                                      <span className="text-[9px] text-muted-foreground">
                                        {dayName}
                                      </span>
                                      {(asInitiatorHours || asResponderHours) && (
                                        <span className="text-[8px] text-muted-foreground">
                                          {(asInitiatorHours ?? asResponderHours ?? 0).toFixed(0)}h
                                        </span>
                                      )}
                                    </div>
                                  )
                                )}
                              </div>
                              <div className="flex gap-3 text-[10px] text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <span className="h-2 w-2 rounded-sm bg-primary/60" />
                                  Waiting on their reply (I sent first)
                                </span>
                                <span className="flex items-center gap-1">
                                  <span className="h-2 w-2 rounded-sm bg-emerald-400" />
                                  My reply time (they sent first)
                                </span>
                              </div>
                            </article>

                            {/* Top correspondents */}
                            <article className="rounded-2xl border border-border bg-card p-4 space-y-3">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Top correspondents
                              </p>
                              <div className="space-y-1.5">
                                {ad.topCorrespondents.slice(0, 6).map(({ email, count }, i) => (
                                  <div key={email} className="flex items-center gap-2">
                                    <span className="text-[10px] text-muted-foreground w-3">
                                      {i + 1}
                                    </span>
                                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                                      <div
                                        className="h-full rounded-full bg-primary/50"
                                        style={{ width: `${(count / maxCorr) * 100}%` }}
                                      />
                                    </div>
                                    <span
                                      className="text-[10px] text-muted-foreground truncate max-w-[110px]"
                                      title={email}
                                    >
                                      {email}
                                    </span>
                                  </div>
                                ))}
                                {ad.topCorrespondents.length === 0 && (
                                  <p className="text-xs text-muted-foreground">
                                    No correspondent data yet.
                                  </p>
                                )}
                              </div>
                            </article>
                          </div>

                          <div className="grid gap-4 sm:grid-cols-2">
                            {/* Meeting ratio */}
                            <article className="rounded-2xl border border-border bg-card p-4 space-y-3">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Meeting-related email ratio
                              </p>
                              <div className="flex items-center gap-4">
                                <div className="relative h-16 w-16 shrink-0">
                                  <svg viewBox="0 0 36 36" className="h-16 w-16 -rotate-90">
                                    <circle
                                      cx="18"
                                      cy="18"
                                      r="14"
                                      fill="none"
                                      strokeWidth="6"
                                      className="stroke-muted"
                                    />
                                    <circle
                                      cx="18"
                                      cy="18"
                                      r="14"
                                      fill="none"
                                      strokeWidth="6"
                                      stroke="hsl(var(--primary))"
                                      strokeDasharray={`${(ad.meetingEmailRatio / 100) * 88} 88`}
                                      strokeLinecap="round"
                                    />
                                  </svg>
                                  <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold">
                                    {ad.meetingEmailRatio}%
                                  </span>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  Emails containing calendar invitations parsed from your mailbox
                                  history.
                                </p>
                              </div>
                            </article>

                            {/* Attachment frequency */}
                            <article className="rounded-2xl border border-border bg-card p-4 space-y-3">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Attachment frequency
                              </p>
                              <div className="space-y-2">
                                {[
                                  {
                                    label: `Received with attachment (${ad.attachmentFrequency.totalReceived} msgs)`,
                                    pct: ad.attachmentFrequency.receivedPct,
                                  },
                                  {
                                    label: `Sent with attachment (${ad.attachmentFrequency.totalSent} msgs)`,
                                    pct: ad.attachmentFrequency.sentPct,
                                  },
                                ].map(({ label, pct }) => (
                                  <div key={label} className="space-y-0.5">
                                    <div className="flex justify-between text-[10px] text-muted-foreground">
                                      <span>{label}</span>
                                      <span>{pct}%</span>
                                    </div>
                                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                                      <div
                                        className="h-full rounded-full bg-amber-400 transition-all"
                                        style={{ width: `${pct}%` }}
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </article>
                          </div>

                          {/* Tags and automation analytics */}
                          {(() => {
                            const maxTagCount = Math.max(1, ...ad.tagUsage.map((t) => t.count))
                            const maxComboCount = Math.max(1, ...ad.tagCombinations.map((c) => c.count))
                            const summary = ad.actionSummary
                            const totalTriggeredEmails =
                              summary.automationTriggeredEmails + summary.manualActionEmails || 1
                            const automationPct = Math.round(
                              (summary.automationTriggeredEmails / totalTriggeredEmails) * 100
                            )
                            const maxAutomationAction = Math.max(
                              1,
                              ...summary.automationActions.map((a) => a.count)
                            )
                            const maxManualAction = Math.max(1, ...summary.manualActions.map((a) => a.count))
                            const maxAutomationTagCount = Math.max(
                              1,
                              ...summary.automationTagBreakdown.map((t) => t.count)
                            )

                            return (
                              <div className="space-y-4">
                                <h4 className="text-sm font-semibold">Tags &amp; automation</h4>

                                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                                  {/* Tag usage counts */}
                                  <article className="rounded-2xl border border-border bg-card p-4 space-y-3">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                      Emails per tag
                                    </p>
                                    <p className="text-[10px] text-muted-foreground -mt-2">
                                      Custom tags and system tags (unread, sent, trash, junk, archived,
                                      attachments, draft).
                                    </p>
                                    <div className="space-y-1.5">
                                      {ad.tagUsage.map(({ tagId, label, color, count }) => (
                                        <div key={tagId} className="space-y-0.5">
                                          <div className="flex justify-between text-[10px] text-muted-foreground">
                                            <span className="truncate max-w-[160px]" title={label}>
                                              {label}
                                            </span>
                                            <span>{count}</span>
                                          </div>
                                          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                                            <div
                                              className="h-full rounded-full transition-all"
                                              style={{
                                                width: `${(count / maxTagCount) * 100}%`,
                                                backgroundColor: color,
                                              }}
                                            />
                                          </div>
                                        </div>
                                      ))}
                                      {ad.tagUsage.length === 0 && (
                                        <p className="text-xs text-muted-foreground">
                                          No tagged or flagged emails yet.
                                        </p>
                                      )}
                                    </div>
                                  </article>

                                  {/* Tag combinations */}
                                  <article className="rounded-2xl border border-border bg-card p-4 space-y-3">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                      Most common tag combinations
                                    </p>
                                    <div className="space-y-1.5">
                                      {ad.tagCombinations.map((combo) => (
                                        <div key={combo.tagIds.join('|')} className="space-y-0.5">
                                          <div className="flex justify-between text-[10px] text-muted-foreground">
                                            <span
                                              className="truncate max-w-[180px]"
                                              title={combo.labels.join(' + ')}
                                            >
                                              {combo.labels.join(' + ')}{' '}
                                              <span className="text-muted-foreground/70">
                                                ({combo.size === 2 ? 'pair' : 'triplet'})
                                              </span>
                                            </span>
                                            <span>{combo.count}</span>
                                          </div>
                                          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                                            <div
                                              className="h-full rounded-full bg-violet-400 transition-all"
                                              style={{ width: `${(combo.count / maxComboCount) * 100}%` }}
                                            />
                                          </div>
                                        </div>
                                      ))}
                                      {ad.tagCombinations.length === 0 && (
                                        <p className="text-xs text-muted-foreground">
                                          No emails with 2+ tags yet.
                                        </p>
                                      )}
                                    </div>
                                  </article>

                                  {/* Automation vs manual trigger comparison */}
                                  <article className="rounded-2xl border border-border bg-card p-4 space-y-3">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                      Automation vs manual actions
                                    </p>
                                    <div className="flex items-center gap-4">
                                      <div className="relative h-16 w-16 shrink-0">
                                        <svg viewBox="0 0 36 36" className="h-16 w-16 -rotate-90">
                                          <circle
                                            cx="18"
                                            cy="18"
                                            r="14"
                                            fill="none"
                                            strokeWidth="6"
                                            className="stroke-muted"
                                          />
                                          <circle
                                            cx="18"
                                            cy="18"
                                            r="14"
                                            fill="none"
                                            strokeWidth="6"
                                            stroke="rgb(167 139 250)"
                                            strokeDasharray={`${(automationPct / 100) * 88} 88`}
                                            strokeLinecap="round"
                                          />
                                        </svg>
                                        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold">
                                          {automationPct}%
                                        </span>
                                      </div>
                                      <div className="text-xs text-muted-foreground space-y-1">
                                        <p>
                                          <span className="font-semibold text-foreground">
                                            {summary.automationTriggeredEmails}
                                          </span>{' '}
                                          emails acted on by automation
                                        </p>
                                        <p>
                                          <span className="font-semibold text-foreground">
                                            {summary.manualActionEmails}
                                          </span>{' '}
                                          emails acted on manually
                                        </p>
                                      </div>
                                    </div>
                                  </article>

                                  {/* Automation action type breakdown */}
                                  <article className="rounded-2xl border border-border bg-card p-4 space-y-3">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                      Most taken automation actions
                                    </p>
                                    <div className="space-y-1.5">
                                      {summary.automationActions.map(({ action, label, count, pct }) => (
                                        <div key={action} className="space-y-0.5">
                                          <div className="flex justify-between text-[10px] text-muted-foreground">
                                            <span>{label}</span>
                                            <span>
                                              {count} ({pct}%)
                                            </span>
                                          </div>
                                          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                                            <div
                                              className="h-full rounded-full bg-violet-400 transition-all"
                                              style={{ width: `${(count / maxAutomationAction) * 100}%` }}
                                            />
                                          </div>
                                        </div>
                                      ))}
                                      {summary.automationActions.length === 0 && (
                                        <p className="text-xs text-muted-foreground">
                                          No automation actions recorded yet.
                                        </p>
                                      )}
                                    </div>
                                  </article>

                                  {/* Tags applied by automation, broken down by tag */}
                                  <article className="rounded-2xl border border-border bg-card p-4 space-y-3">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                      Tags applied by automation
                                    </p>
                                    <div className="space-y-1.5">
                                      {summary.automationTagBreakdown.map(({ tagId, label, color, count }) => (
                                        <div key={tagId} className="space-y-0.5">
                                          <div className="flex justify-between text-[10px] text-muted-foreground">
                                            <span className="truncate max-w-[160px]" title={label}>
                                              {label}
                                            </span>
                                            <span>{count}</span>
                                          </div>
                                          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                                            <div
                                              className="h-full rounded-full transition-all"
                                              style={{
                                                width: `${(count / maxAutomationTagCount) * 100}%`,
                                                backgroundColor: color,
                                              }}
                                            />
                                          </div>
                                        </div>
                                      ))}
                                      {summary.automationTagBreakdown.length === 0 && (
                                        <p className="text-xs text-muted-foreground">
                                          No tags applied by automation yet.
                                        </p>
                                      )}
                                    </div>
                                  </article>

                                  {/* Manual action type breakdown */}
                                  <article className="rounded-2xl border border-border bg-card p-4 space-y-3">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                      Most taken manual actions
                                    </p>
                                    <div className="space-y-1.5">
                                      {summary.manualActions.map(({ action, label, count, pct }) => (
                                        <div key={action} className="space-y-0.5">
                                          <div className="flex justify-between text-[10px] text-muted-foreground">
                                            <span>{label}</span>
                                            <span>
                                              {count} ({pct}%)
                                            </span>
                                          </div>
                                          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                                            <div
                                              className="h-full rounded-full bg-amber-400 transition-all"
                                              style={{ width: `${(count / maxManualAction) * 100}%` }}
                                            />
                                          </div>
                                        </div>
                                      ))}
                                      {summary.manualActions.length === 0 && (
                                        <p className="text-xs text-muted-foreground">
                                          No manual actions recorded yet.
                                        </p>
                                      )}
                                    </div>
                                  </article>
                                </div>
                              </div>
                            )
                          })()}

                          {/* Open question */}
                          <article className="rounded-2xl border border-primary/30 bg-primary/5 p-5 space-y-3">
                            <div className="flex items-start gap-3">
                              <span className="text-2xl">&#128172;</span>
                              <div>
                                <h4 className="text-sm font-semibold">
                                  What would you like to see here?
                                </h4>
                                <p className="text-xs text-muted-foreground mt-1">
                                  These analytics use real data from your imported messages. Tell us
                                  which statistics matter most to how you work with email.
                                </p>
                              </div>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2 text-xs">
                              {[
                                'Time of day heatmap (when emails arrive/sent across 24h)',
                                'Subject line patterns and keyword frequency',
                                'Label / category growth over time',
                                'Email chain depth -- how long threads get',
                                'Cross-account message flow comparison',
                                'Unsubscribe / newsletter volume trend',
                                'Response time vs email length correlation',
                                'Custom date-range export of stats',
                              ].map((idea) => (
                                <label
                                  key={idea}
                                  className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 cursor-pointer hover:bg-accent/30"
                                >
                                  <input type="checkbox" className="accent-primary" />
                                  {idea}
                                </label>
                              ))}
                            </div>
                            <textarea
                              rows={2}
                              placeholder="Your own idea -- describe the insight you want..."
                              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs resize-none focus:outline-hidden focus:ring-2 focus:ring-ring"
                            />
                            <Button intent="primary" size="compact">
                              Submit feedback
                            </Button>
                          </article>
                        </>
                      )}
                    </div>
                  )
                })()}
            </section>
          )}
        </section>
      )}

      {activeTab === 'people' && (
        <section className="space-y-4">
          {/* 3rd-level panel toggles */}
          <div className="flex flex-wrap gap-2">
            <Button
              emphasis="outline"
              intent={showPeopleCard ? 'primary' : 'neutral'}
              size="compact"
              onClick={() => setShowPeopleCard((v) => !v)}
            >
              {showPeopleCard
                ? `Hide: Contacts (${people.length})`
                : `Show: Contacts (${people.length})`}
            </Button>
            <Button
              emphasis="outline"
              intent={showPeopleHtmlTrustTool ? 'primary' : 'neutral'}
              size="compact"
              onClick={() => setShowPeopleHtmlTrustTool((v) => !v)}
            >
              {showPeopleHtmlTrustTool
                ? `Hide: HTML Trust (${trustedHtmlDomains.size})`
                : `Show: HTML Trust (${trustedHtmlDomains.size})`}
            </Button>
            <Button
              emphasis="outline"
              intent={showPeopleJunkTool ? 'primary' : 'neutral'}
              size="compact"
              onClick={() => setShowPeopleJunkTool((v) => !v)}
            >
              {showPeopleJunkTool
                ? `Hide: Junk List (${junkDomains.size})`
                : `Show: Junk List (${junkDomains.size})`}
            </Button>
            <Button
              emphasis="outline"
              intent={showPeopleNonOrganizerTool ? 'primary' : 'neutral'}
              size="compact"
              onClick={() => setShowPeopleNonOrganizerTool((v) => !v)}
            >
              {showPeopleNonOrganizerTool
                ? `Hide: Not Organisers (${nonOrganizerSenders.size})`
                : `Show: Not Organisers (${nonOrganizerSenders.size})`}
            </Button>
          </div>

          {/* Tool panels keep a fixed track width; Contacts absorbs whatever space is left. */}
          <div className="flex flex-wrap items-start gap-4">
            {showPeopleCard && (
              <section className="min-w-[18rem] flex-1 rounded-2xl border border-border bg-card p-4">
                <h2 className="text-lg font-semibold">Contacts</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Merges imported contacts and observed correspondents with local overrides.
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={peopleSearchQuery}
                      onChange={(e) => setPeopleSearchQuery(e.target.value)}
                      placeholder="Search contacts by name or email"
                      className="w-full rounded-lg border border-input bg-background py-1.5 pl-8 pr-3 text-xs focus:outline-hidden focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <Button
                    emphasis="outline"
                    intent={showAddContactForm ? 'primary' : 'neutral'}
                    size="compact"
                    onClick={() => {
                      setShowAddContactForm((v) => !v)
                      setAddContactError('')
                    }}
                    className="shrink-0"
                  >
                    + Add
                  </Button>
                </div>
                {showAddContactForm && (
                  <div className="mt-2 space-y-1.5 rounded-lg border border-border bg-background p-2.5">
                    <input
                      value={newContactDraft.display_name}
                      onChange={(e) =>
                        setNewContactDraft((prev) => ({ ...prev, display_name: e.target.value }))
                      }
                      placeholder="Name (optional)"
                      className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                    />
                    <input
                      value={newContactDraft.email}
                      onChange={(e) =>
                        setNewContactDraft((prev) => ({ ...prev, email: e.target.value }))
                      }
                      placeholder="Email address"
                      className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                    />
                    {addContactError && (
                      <p className="text-[10px] text-danger">
                        {addContactError}
                      </p>
                    )}
                    <div className="flex gap-1.5">
                      <Button
                        emphasis="outline"
                        intent="primary"
                        size="compact"
                        onClick={() => void handleAddContact()}
                        disabled={addContactSaving || !newContactDraft.email.trim()}
                      >
                        {addContactSaving ? 'Adding...' : 'Add contact'}
                      </Button>
                      <Button
                        emphasis="ghost"
                        size="compact"
                        onClick={() => {
                          setShowAddContactForm(false)
                          setNewContactDraft({ display_name: '', email: '' })
                          setAddContactError('')
                        }}
                        disabled={addContactSaving}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
                {/* Auto-fill keeps each contact card wide enough for the name to stay on one row. */}
                <div className="mt-3 grid gap-2 grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]">
                  {people.map((person) => (
                    <div
                      key={person.id}
                      className="min-w-0 rounded-lg border border-border bg-background p-2.5"
                    >
                      {editingContactId === person.id ? (
                        <div className="space-y-1.5">
                          <input
                            value={contactEditDraft.display_name}
                            onChange={(e) =>
                              setContactEditDraft((prev) => ({
                                ...prev,
                                display_name: e.target.value,
                              }))
                            }
                            placeholder="Display name"
                            className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                          />
                          <div className="grid grid-cols-2 gap-1.5">
                            <input
                              value={contactEditDraft.region}
                              onChange={(e) =>
                                setContactEditDraft((prev) => ({ ...prev, region: e.target.value }))
                              }
                              placeholder="Region"
                              className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                            />
                            <input
                              value={contactEditDraft.timezone}
                              onChange={(e) =>
                                setContactEditDraft((prev) => ({
                                  ...prev,
                                  timezone: e.target.value,
                                }))
                              }
                              placeholder="Timezone (e.g. America/New_York)"
                              className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                            />
                          </div>
                          <input
                            value={contactEditDraft.labels}
                            onChange={(e) =>
                              setContactEditDraft((prev) => ({ ...prev, labels: e.target.value }))
                            }
                            placeholder="Labels, comma separated"
                            className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                          />
                          <div className="space-y-0.5">
                            {person.identities.map((identity) => (
                              <div
                                key={identity.id}
                                className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
                              >
                                <span className="truncate font-mono flex-1">{identity.email}</span>
                                {identity.is_primary && (
                                  <span className="rounded px-1 py-0.5 bg-info-subtle text-info shrink-0 text-[9px]">
                                    primary
                                  </span>
                                )}
                                <Button
                                  emphasis="outline"
                                  intent="danger"
                                  size="compact"
                                  onClick={() => void handleRemoveIdentity(person.id, identity.id)}
                                  disabled={person.identities.length <= 1}
                                  title={
                                    person.identities.length <= 1
                                      ? 'A contact needs at least one email'
                                      : 'Remove this email'
                                  }
                                  className="shrink-0"
                                >
                                  Remove
                                </Button>
                              </div>
                            ))}
                          </div>
                          <div className="flex gap-1.5">
                            <input
                              value={newIdentityEmail}
                              onChange={(e) => setNewIdentityEmail(e.target.value)}
                              placeholder="Add another email"
                              className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs"
                            />
                            <Button
                              emphasis="outline"
                              size="compact"
                              onClick={() => void handleAddIdentity(person.id)}
                              disabled={identitySaving || !newIdentityEmail.trim()}
                              className="shrink-0"
                            >
                              Add
                            </Button>
                          </div>
                          <div className="flex gap-1.5">
                            <Button
                              emphasis="outline"
                              intent="primary"
                              size="compact"
                              onClick={() => void handleSaveContactEdit(person.id)}
                              disabled={contactSaving}
                            >
                              Save
                            </Button>
                            <Button
                              emphasis="ghost"
                              size="compact"
                              onClick={() => setEditingContactId(null)}
                            >
                              Cancel
                            </Button>
                            <Button
                              emphasis="outline"
                              intent="danger"
                              size="compact"
                              onClick={() => void handleDeleteContact(person.id)}
                              className="ml-auto"
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start justify-between gap-2">
                            <p
                              className="min-w-0 flex-1 truncate text-sm font-semibold"
                              title={person.display_name || 'Unnamed contact'}
                            >
                              {person.display_name || 'Unnamed contact'}
                            </p>
                            <Button
                              emphasis="outline"
                              size="compact"
                              onClick={() => startEditingContact(person)}
                              className="shrink-0"
                            >
                              Edit
                            </Button>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            Sent {person.sent_count} &middot; Received {person.received_count}
                          </p>
                          {(person.region || person.timezone) && (
                            <p className="text-[11px] text-muted-foreground">
                              {[person.region, person.timezone].filter(Boolean).join(' -- ')}
                            </p>
                          )}
                          {person.labels && person.labels.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {person.labels.map((label) => (
                                <span
                                  key={label}
                                  className="rounded px-1.5 py-0.5 bg-muted text-[9px] uppercase text-muted-foreground"
                                >
                                  {label}
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="mt-1.5 space-y-0.5">
                            {person.identities.map((identity) => (
                              <div
                                key={identity.id}
                                className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
                              >
                                <span className="truncate font-mono">{identity.email}</span>
                                {identity.is_primary && (
                                  <span className="rounded px-1 py-0.5 bg-info-subtle text-info shrink-0 text-[9px]">
                                    primary
                                  </span>
                                )}
                                {identity.label && (
                                  <span className="rounded px-1 py-0.5 bg-muted shrink-0 text-[9px]">
                                    {identity.label}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                  {people.length === 0 && (
                    <div className="col-span-full rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground text-center">
                      {peopleSearchQuery.trim()
                        ? 'No contacts match your search.'
                        : 'No people records yet.'}
                    </div>
                  )}
                </div>
              </section>
            )}

            {showPeopleHtmlTrustTool && (
              <section className="w-full shrink-0 rounded-2xl border border-border bg-card p-4 xl:w-104">
                <h2 className="text-lg font-semibold">HTML Rendering Trust Config</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Manage which sender domains are trusted to render HTML content. Untrusted domains
                  stay in raw mode.
                </p>

                <div className="mt-4 rounded-lg border border-info-muted bg-info-subtle p-3 space-y-2">
                  <p className="text-sm font-medium text-info">
                    Active: Trust via Popup
                  </p>
                  <p className="text-xs text-info">
                    In Thread Viewer, switching to HTML or requesting HTML on a message opens a
                    trust popup for untrusted sender domains.
                  </p>
                </div>

                {trustedHtmlDomains.size > 0 && (
                  <div className="mt-4">
                    <h3 className="text-sm font-semibold mb-2">
                      Trusted Domains ({trustedHtmlDomains.size})
                    </h3>
                    <div className="space-y-1">
                      {Array.from(trustedHtmlDomains)
                        .sort()
                        .map((domain) => (
                          <div
                            key={domain}
                            className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background p-2"
                          >
                            <span className="text-sm font-mono text-xs">{domain}</span>
                            <Button
                              emphasis="outline"
                              intent="danger"
                              size="compact"
                              onClick={() => {
                                const next = new Set(trustedHtmlDomains)
                                next.delete(domain)
                                setTrustedHtmlDomains(next)
                              }}
                              className="shrink-0"
                            >
                              Remove
                            </Button>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {trustedHtmlDomains.size === 0 && (
                  <div className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground text-center">
                    No trusted domains yet. They will appear here once you approve HTML rendering
                    for sender domains.
                  </div>
                )}
              </section>
            )}

            {showPeopleJunkTool && (
              <section className="w-full shrink-0 rounded-2xl border border-border bg-card p-4 xl:w-104">
                <h2 className="text-lg font-semibold">Junk Sender List</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Senders added from the Thread Viewer Junk button are treated as a system tag in
                  the inbox and thread viewer.
                </p>

                <div className="mt-4 rounded-lg border border-warning-muted bg-warning-subtle p-3">
                  <p className="text-sm font-medium text-warning">
                    Manual add path: Thread Viewer only
                  </p>
                  <p className="mt-1 text-xs text-warning">
                    Entries cannot be added here. Remove them here when you no longer want messages
                    from that sender marked as junk.
                  </p>
                </div>

                {junkDomains.size > 0 && (
                  <div className="mt-4">
                    <h3 className="mb-2 text-sm font-semibold">
                      Junk Entries ({junkDomains.size})
                    </h3>
                    <div className="space-y-1">
                      {Array.from(junkDomains)
                        .sort()
                        .map((entry) => (
                          <div
                            key={entry}
                            className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background p-2"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                                {entry.includes('@') ? 'sender' : 'domain'}
                              </span>
                              <span className="text-sm font-mono text-xs break-all">{entry}</span>
                            </div>
                            <Button
                              emphasis="outline"
                              intent="danger"
                              size="compact"
                              onClick={() => {
                                const next = new Set(junkDomains)
                                next.delete(entry)
                                setJunkDomains(next)
                              }}
                              className="shrink-0"
                            >
                              Remove
                            </Button>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {junkDomains.size === 0 && (
                  <div className="mt-4 rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                    No junk senders yet. Add one from the Thread Viewer Junk button when you spot a
                    sender you want filtered and labeled.
                  </div>
                )}
              </section>
            )}

            {showPeopleNonOrganizerTool && (
              <section className="w-full shrink-0 rounded-2xl border border-border bg-card p-4 xl:w-104">
                <h2 className="text-lg font-semibold">Not Organisers</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Senders that never produce meetings. Their messages are skipped when invitations
                  are extracted.
                </p>

                <div className="mt-4 rounded-lg border border-info-muted bg-info-subtle p-3 dark:border-info-muted">
                  <p className="text-sm font-medium text-info">
                    Manual add path: Invitations tab
                  </p>
                  <p className="mt-1 text-xs text-info">
                    Use the &quot;Not an organiser&quot; button on an invitation card. Remove an
                    entry here to start detecting that sender again.
                  </p>
                </div>

                {nonOrganizerSenders.size > 0 && (
                  <div className="mt-4">
                    <h3 className="mb-2 text-sm font-semibold">
                      Entries ({nonOrganizerSenders.size})
                    </h3>
                    <div className="space-y-1">
                      {Array.from(nonOrganizerSenders)
                        .sort()
                        .map((entry) => (
                          <div
                            key={entry}
                            className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background p-2"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                                {entry.includes('@') ? 'sender' : 'domain'}
                              </span>
                              <span className="text-sm font-mono text-xs break-all">{entry}</span>
                            </div>
                            <Button
                              emphasis="outline"
                              intent="danger"
                              size="compact"
                              onClick={() => {
                                const next = new Set(nonOrganizerSenders)
                                next.delete(entry)
                                setNonOrganizerSenders(next)
                              }}
                              className="shrink-0"
                            >
                              Remove
                            </Button>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {nonOrganizerSenders.size === 0 && (
                  <div className="mt-4 rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                    No entries yet. Mark a sender from the Invitations tab when their emails never
                    contain real meetings.
                  </div>
                )}
              </section>
            )}
          </div>
        </section>
      )}

      {activeSettingsTab === 'automations' && activeTab === 'settings' && (
        <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <article className="order-2 rounded-2xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">
                  {selectedAutomationSettingsRuleId ? 'Edit Rule' : 'Create Rule'}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Checks decide which emails match; actions run top to bottom on the ones that do.
                </p>
              </div>
              <Button
                emphasis="outline"
                size="compact"
                onClick={startNewAutomationSettingsRule}
                disabled={rules.length >= MAX_AUTOMATION_RULES}
                title={
                  rules.length >= MAX_AUTOMATION_RULES
                    ? `Limit of ${MAX_AUTOMATION_RULES} rules reached`
                    : 'Start a new rule'
                }
                icon={<Plus className="h-3.5 w-3.5" />}
              >
                New rule
              </Button>
            </div>

            {automationSettingsError && (
              <p className="mt-3 rounded-lg border border-danger-muted bg-danger-subtle px-3 py-2 text-xs text-danger">
                {automationSettingsError}
              </p>
            )}

            {automationSettingsDraft ? (
              <div className="mt-3 space-y-3">
                <MailboxAutomationEditor
                  value={automationSettingsDraft}
                  onChange={setAutomationSettingsDraft}
                  tags={automationTagOptions}
                  onRequestCreateTag={requestCreateMailboxTag}
                />
                <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                  <Button
                    emphasis={automationSettingsDraftDirty ? 'solid' : 'outline'}
                    intent={automationSettingsDraftDirty ? 'primary' : 'neutral'}
                    onClick={() => void saveAutomationSettingsDraft()}
                    disabled={automationSettingsSaving}
                    title={
                      automationSettingsDraftDirty
                        ? 'Save the unsaved changes'
                        : 'No changes to save'
                    }
                  >
                    {automationSettingsSaving
                      ? 'Saving...'
                      : selectedAutomationSettingsRuleId
                        ? automationSettingsDraftDirty
                          ? 'Save Rule *'
                          : 'Saved'
                        : 'Create Rule'}
                  </Button>
                  {!selectedAutomationSettingsRuleId && (
                    <Button
                      emphasis="ghost"
                      onClick={() => selectAutomationSettingsRule(null)}
                      disabled={automationSettingsSaving}
                    >
                      Cancel
                    </Button>
                  )}
                  {selectedAutomationSettingsRuleId && (
                    <>
                      <Button
                        emphasis="outline"
                        onClick={moveAutomationSettingsRuleToPanel}
                        title="Load this rule into the right side panel so you can preview it against your emails"
                      >
                        Move to right side panel
                      </Button>
                      <Button
                        emphasis="outline"
                        onClick={() => selectAutomationSettingsRule(null)}
                      >
                        Close editor
                      </Button>
                    </>
                  )}
                </div>

                {automationSettingsDraft.mode !== 'active' && (
                  <p className="rounded-lg border border-warning-muted bg-warning-subtle px-3 py-2 text-xs text-warning">
                    This rule is set to{' '}
                    <span className="font-semibold">
                      {automationSettingsDraft.mode === 'dry_run' ? 'Dry run' : 'Disabled'}
                    </span>
                    , so running it only reports matches and changes nothing. Switch the mode to
                    Active to apply its actions.
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                Select a rule on the left to edit it here, or start a new one.
              </div>
            )}
          </article>

          <article className="order-1 rounded-2xl border border-border bg-card p-4">
            <h2 className="text-lg font-semibold">Automation Rules</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Open a rule to load it into the editor beside this list and compare it against the
              others.
            </p>
            <div className="mt-3 space-y-2">
              {rules.map((rule) => {
                const isEditing = rule.id === selectedAutomationSettingsRuleId
                const checks = rule.definition.steps.filter(
                  (step) => step.kind === 'condition' || step.kind === 'receive_action'
                ).length
                const actions = rule.definition.steps.filter(
                  (step) => step.kind === 'action'
                ).length

                return (
                  <div
                    key={rule.id}
                    className={`rounded-xl border p-3 transition-colors ${
                      isEditing ? 'border-primary/60 bg-primary/5' : 'border-border bg-background'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-semibold">{rule.name}</p>
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] uppercase text-muted-foreground">
                        {rule.mode === 'dry_run' ? 'dry run' : rule.mode}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {checks} check{checks === 1 ? '' : 's'}, {actions} action
                      {actions === 1 ? '' : 's'}
                      {rule.definition.match === 'any' ? ' -- matches any check' : ''}
                    </p>
                    {rule.stop_processing && (
                      <p className="mt-1 text-xs text-warning">
                        Stop processing enabled.
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        emphasis="outline"
                        size="compact"
                        onClick={() => selectAutomationSettingsRule(isEditing ? null : rule.id)}
                      >
                        {isEditing ? 'Close in editor' : 'Open in editor'}
                      </Button>
                      <Button
                        emphasis="outline"
                        intent="danger"
                        size="compact"
                        onClick={() => void deleteAutomationRule(rule.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                )
              })}
              {rules.length === 0 && (
                <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground text-center">
                  No rules yet.
                </div>
              )}
            </div>
          </article>
        </section>
      )}

      {activeTab === 'invitations' && (
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="text-lg font-semibold">Invitations</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Invitation records are parsed and tracked by UID/sequence to avoid duplicate imports.
            Re-announcements from the same organizer for the same start time are merged into one
            card using the latest title.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[min(100%,18rem)] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={invitationQuery}
                onChange={(event) => setInvitationQuery(event.target.value)}
                placeholder="Search title, organizer, or location..."
                className="w-full rounded-lg border border-input bg-background py-1.5 pl-8 pr-8 text-sm"
              />
              {invitationQuery && (
                <IconButton
                  onClick={() => setInvitationQuery('')}
                  label="Clear invitation search"
                  showTitle={false}
                  className="absolute right-0.5 top-1/2 -translate-y-1/2"
                  icon={<X className="h-3.5 w-3.5" />}
                />
              )}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Sort
              <select
                value={invitationSortOrder}
                onChange={(event) =>
                  setInvitationSortOrder(parseInvitationSortOrder(event.target.value))
                }
                className="rounded-lg border border-input bg-background px-2 py-1.5 text-xs text-foreground"
              >
                <option value="latest-first">Latest first</option>
                <option value="earliest-first">Earliest first</option>
              </select>
            </label>
            <span className="text-xs text-muted-foreground">
              {visibleInvitations.length} of {invitations.length}
            </span>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {visibleInvitations.map((invite) => {
              const startsMs = invite.starts_at ? new Date(invite.starts_at).getTime() : Number.NaN
              const isPast = Number.isFinite(startsMs) && startsMs < Date.now()
              return (
                <div
                  key={invite.id}
                  className={`rounded-xl border p-3 ${
                    isPast
                      ? 'border-border/60 bg-muted/40 opacity-75'
                      : 'border-success-muted bg-background'
                  }`}
                >
                  <p className="text-sm font-semibold">
                    {invite.summary || '(untitled invitation)'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Organizer: {invite.organizer || 'Unknown'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Starts: {formatTimestamp(invite.starts_at, userDateFormat)}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] uppercase text-muted-foreground">
                      {invite.status}
                    </span>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        isPast
                          ? 'bg-muted text-muted-foreground'
                          : 'bg-success-subtle text-success'
                      }`}
                    >
                      {isPast ? 'Past' : 'Upcoming'}
                    </span>
                    {(invite.merged_count ?? 1) > 1 && (
                      <span
                        className="inline-flex rounded-full bg-info-subtle px-2 py-0.5 text-[10px] font-medium text-info"
                        title={`Merged ${invite.merged_count} invitations from the same organizer for the same start time`}
                      >
                        {invite.merged_count} updates
                      </span>
                    )}
                    {getInvitationMetaBadges(invite).map((badge) => (
                      <span
                        key={badge.key}
                        className="inline-flex rounded-full bg-danger-subtle px-2 py-0.5 text-[10px] font-medium text-danger"
                      >
                        {badge.label}
                      </span>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      emphasis="outline"
                      intent="primary"
                      size="compact"
                      data-testid="mailbox-invitation-add-to-calendar"
                      onClick={() => openInvitationCalendarPicker(invite)}
                      icon={<CalendarPlus className="h-3.5 w-3.5" />}
                    >
                      {getInvitationAddActionState(invite, invitations).label}
                    </Button>
                    <Button
                      emphasis="outline"
                      size="compact"
                      onClick={() => {
                        if (!invite.starts_at || !invite.ends_at) return
                        downloadICSFile({
                          title: invite.summary || 'Calendar invitation',
                          description:
                            [
                              invite.organizer ? `Organizer: ${invite.organizer}` : null,
                              invite.status ? `Status: ${invite.status}` : null,
                              invite.location
                                ? /^https?:\/\//i.test(invite.location.trim())
                                  ? `Meeting link: ${invite.location}`
                                  : `Location: ${invite.location}`
                                : null,
                            ]
                              .filter((part): part is string => Boolean(part))
                              .join('\n\n') || undefined,
                          start_time: invite.starts_at,
                          end_time: invite.ends_at,
                          meeting_link:
                            invite.location && /^https?:\/\//i.test(invite.location.trim())
                              ? invite.location.trim()
                              : undefined,
                          location: invite.location || undefined,
                        })
                      }}
                    >
                      Download ICS
                    </Button>
                    {invite.location && /^https?:\/\//i.test(invite.location.trim()) && (
                      <Button
                        emphasis="outline"
                        size="compact"
                        onClick={() =>
                          window.open(
                            buildOutlookCalendarUrl({
                              title: invite.summary || 'Calendar invitation',
                              description:
                                [
                                  invite.organizer ? `Organizer: ${invite.organizer}` : null,
                                  invite.status ? `Status: ${invite.status}` : null,
                                ]
                                  .filter((part): part is string => Boolean(part))
                                  .join('\n\n') || undefined,
                              start_time: invite.starts_at || new Date().toISOString(),
                              end_time: invite.ends_at || new Date().toISOString(),
                              meeting_link: invite.location,
                              location: invite.location,
                            }),
                            '_blank',
                            'noopener,noreferrer'
                          )
                        }
                      >
                        Open in Outlook
                      </Button>
                    )}
                    {normalizeSenderEntry(invite.organizer) && (
                      <Button
                        emphasis="outline"
                        intent="danger"
                        size="compact"
                        onClick={() => void markOrganizerAsNonOrganizer(invite)}
                        title="Remove every invitation from this sender and add them to Not Organisers"
                        icon={<UserRound className="h-3.5 w-3.5" />}
                      >
                        Not an organiser
                      </Button>
                    )}
                    {invite.source_email && (
                      <Button
                        emphasis="outline"
                        size="compact"
                        onClick={() => {
                          if (invite.message_id) {
                            const params = new URLSearchParams()
                            params.set('tab', 'mailbox')
                            setSearchParams(params)
                            // Load thread directly by message ID, bypassing filters
                            void handleOpenThreadFromMessageId(invite.message_id)
                          }
                        }}
                        title={`Source email from: ${invite.source_email}`}
                        icon={<Mail className="h-3.5 w-3.5" />}
                      >
                        {invite.source_email.length > 20
                          ? `${invite.source_email.substring(0, 17)}...`
                          : invite.source_email}
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
            {visibleInvitations.length === 0 && (
              <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground text-center sm:col-span-2 lg:col-span-3">
                {invitations.length === 0
                  ? 'No invitations detected yet.'
                  : 'No invitations match the current search.'}
              </div>
            )}
          </div>
        </section>
      )}

      {selectedInvitation && (
        <AddToCalendarShell
          mode={invitationCalendarDisplayMode}
          hidden={invitationCalendarPanelHidden}
          isMobileLayout={isMobileMailboxLayout}
          onClose={closeInvitationCalendarPicker}
          onModeChange={handleInvitationCalendarModeChange}
        >
          <>
            <div className="mt-3 rounded-lg border border-border bg-background">
              <Disclosure
                title={formatInvitationSummaryLine(
                  invitationEditTitle,
                  invitationEffectiveStartIso,
                  getEditingTimezone()
                )}
                expanded={invitationDetailsExpanded}
                onToggle={(next) => setInvitationDetailsExpanded(next)}
                panelId="mailbox-invitation-details-panel"
              />

              {invitationDetailsExpanded && (
                <div id="mailbox-invitation-details-panel" className="space-y-3 border-t border-border p-3">
                  <div>
                    <label
                      htmlFor="invitation-edit-title"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      Title
                    </label>
                    <input
                      id="invitation-edit-title"
                      type="text"
                      value={invitationEditTitle}
                      onChange={(event) => setInvitationEditTitle(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="invitation-edit-date"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Date
                      </label>
                      <input
                        id="invitation-edit-date"
                        type="date"
                        value={invitationEditDate}
                        onChange={(event) => setInvitationEditDate(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="invitation-edit-time"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Time ({getEditingTimezone()})
                      </label>
                      <input
                        id="invitation-edit-time"
                        type="time"
                        value={invitationEditTime}
                        onChange={(event) => setInvitationEditTime(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label
                      htmlFor="invitation-edit-address"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      Meeting Address
                    </label>
                    <input
                      id="invitation-edit-address"
                      type="text"
                      value={invitationEditAddress}
                      onChange={(event) => setInvitationEditAddress(event.target.value)}
                      placeholder="Location or meeting link (e.g. Room 101, https://zoom.us/j/...)"
                      className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="invitation-edit-description"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      Description
                    </label>
                    <textarea
                      id="invitation-edit-description"
                      value={invitationEditDescription}
                      onChange={(event) => setInvitationEditDescription(event.target.value)}
                      rows={10}
                      className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    These details are used for the ICS download and every calendar you add this
                    invitation to.
                  </p>
                </div>
              )}
            </div>

            {invitationDetailsExpanded && (
              <button
                type="button"
                onClick={() => setInvitationDetailsExpanded(false)}
                className="mt-3 flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-accent/40"
              >
                <span>Calendars</span>
                <ChevronDown className="h-4 w-4 shrink-0" />
              </button>
            )}

            {!invitationDetailsExpanded && (
              <div className="mailbox-calendar-targets mt-4 grid gap-4 lg:grid-cols-2">
                <section className="rounded-xl border border-border bg-background p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold">Google calendars</h4>
                    <span className="text-[11px] text-muted-foreground">
                      {googleCalendarTargets.length} available
                    </span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {calendarTargetsLoading ? (
                      <p className="text-xs text-muted-foreground">Loading calendars...</p>
                    ) : googleCalendarTargets.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No writable Google calendars connected.
                      </p>
                    ) : (
                      googleCalendarTargets.map((source) => (
                        <label
                          key={source.id}
                          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent/40"
                        >
                          <input
                            type="checkbox"
                            checked={selectedGoogleTargetIds.has(source.id)}
                            onChange={() =>
                              setSelectedGoogleTargetIds((prev) => {
                                const next = new Set(prev)
                                if (next.has(source.id)) next.delete(source.id)
                                else next.add(source.id)
                                return next
                              })
                            }
                          />
                          <span className="truncate">{source.display_name || source.id}</span>
                        </label>
                      ))
                    )}
                  </div>

                  <div className="mt-4 border-t border-border/70 pt-3">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold">Time Manager calendars</h4>
                      <span className="text-[11px] text-muted-foreground">
                        {timeManagerModes.length} available
                      </span>
                    </div>
                    <div className="mt-3 space-y-2">
                      {calendarTargetsLoading ? (
                        <p className="text-xs text-muted-foreground">Loading modes...</p>
                      ) : timeManagerModes.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          No Time Manager modes found.
                        </p>
                      ) : (
                        timeManagerModes.map((mode) => {
                          const modeCategories = timeManagerCategories.filter(
                            (c) => c.mode_id === mode.id
                          )
                          const selectedModeCategories = modeCategories.filter((c) =>
                            selectedTimeManagerCategoryIds.has(c.id)
                          )
                          const isModeSelected = selectedTimeManagerModeIds.has(mode.id)
                          return (
                            <div
                              key={mode.id}
                              className="rounded-lg border border-border p-2 hover:bg-accent/30 flex flex-wrap items-center gap-2"
                            >
                              <label className="flex items-center gap-2 text-sm cursor-pointer shrink-0">
                                <input
                                  type="checkbox"
                                  checked={isModeSelected}
                                  onChange={() =>
                                    setSelectedTimeManagerModeIds((prev) => {
                                      const next = new Set(prev)
                                      if (next.has(mode.id)) next.delete(mode.id)
                                      else next.add(mode.id)
                                      return next
                                    })
                                  }
                                />
                                <span className="truncate font-medium">{mode.name}</span>
                              </label>
                              {modeCategories.length > 0 && (
                                <Button
                                  emphasis="outline"
                                  size="compact"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    if (!isModeSelected) {
                                      setSelectedTimeManagerModeIds((prev) =>
                                        new Set(prev).add(mode.id)
                                      )
                                    }
                                    setCategoryTagModalMode(mode)
                                  }}
                                  className="shrink-0"
                                  icon={<Tag className="h-3.5 w-3.5 text-primary shrink-0" />}
                                >
                                  <span>
                                    {selectedModeCategories.length > 0
                                      ? 'Categories'
                                      : 'Select category tags...'}
                                  </span>
                                </Button>
                              )}
                              {selectedModeCategories.map((cat) => {
                                const textColor = getLegibleTextColor(cat.color, cat.font_color)
                                return (
                                  <span
                                    key={cat.id}
                                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold shadow-2xs shrink-0"
                                    style={{
                                      backgroundColor: cat.color,
                                      color: textColor,
                                      border: `1px solid ${cat.color}`,
                                    }}
                                  >
                                    <span>{cat.label}</span>
                                  </span>
                                )
                              })}
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>
                </section>

                <section className="rounded-xl border border-border bg-background p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold">Coordination calendars</h4>
                    <span className="text-[11px] text-muted-foreground">
                      {coordinationCalendars.length} available
                    </span>
                  </div>
                  <div className="mt-3 space-y-2">
                    <label className="flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-sm hover:bg-primary/10">
                      <input
                        type="checkbox"
                        checked={createNewCoordinationCalendar}
                        onChange={(event) => {
                          const checked = event.target.checked
                          setCreateNewCoordinationCalendar(checked)
                          if (checked && !newCoordinationCalendarTitle.trim()) {
                            setNewCoordinationCalendarTitle(
                              selectedInvitation?.summary?.trim() || 'New coordination calendar'
                            )
                          }
                        }}
                      />
                      <span>Create new Coordination Calendar from this invite</span>
                    </label>
                    {createNewCoordinationCalendar && (
                      <input
                        type="text"
                        value={newCoordinationCalendarTitle}
                        onChange={(event) => setNewCoordinationCalendarTitle(event.target.value)}
                        placeholder="New calendar title"
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      />
                    )}
                    {calendarTargetsLoading ? (
                      <p className="text-xs text-muted-foreground">Loading calendars...</p>
                    ) : coordinationCalendars.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No coordination calendars found.
                      </p>
                    ) : (
                      <>
                        <div
                          className={
                            hasManyCoordinationCalendars && showAllCoordinationCalendars
                              ? 'max-h-72 overflow-y-auto pr-1 space-y-2'
                              : 'space-y-2'
                          }
                        >
                          {visibleCoordinationCalendars.map((calendar) => (
                            <label
                              key={calendar.hash}
                              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent/40"
                            >
                              <input
                                type="checkbox"
                                checked={selectedCoordinationHashes.has(calendar.hash)}
                                onChange={() =>
                                  setSelectedCoordinationHashes((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(calendar.hash)) next.delete(calendar.hash)
                                    else next.add(calendar.hash)
                                    return next
                                  })
                                }
                              />
                              <span className="truncate">{calendar.title}</span>
                            </label>
                          ))}
                        </div>
                        {hasManyCoordinationCalendars && (
                          <Button
                            emphasis="outline"
                            size="compact"
                            fullWidth
                            onClick={() => setShowAllCoordinationCalendars((current) => !current)}
                          >
                            {showAllCoordinationCalendars
                              ? 'Show last 6 calendars'
                              : `Show all ${coordinationCalendars.length} calendars`}
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </section>
              </div>
            )}

            {calendarActionError && (
              <p className="mt-4 rounded-lg border border-danger-muted bg-danger-subtle px-3 py-2 text-xs text-danger">
                {calendarActionError}
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  emphasis="outline"
                  onClick={handleDownloadInvitationIcs}
                  disabled={calendarActionSaving}
                >
                  Download ICS
                </Button>
                <Button
                  intent="primary"
                  data-testid="mailbox-invitation-add-to-calendar-submit"
                  onClick={() => void handleAddInvitationToCalendarTargets()}
                  disabled={calendarActionSaving || calendarTargetsLoading}
                  icon={<CalendarPlus className="h-4 w-4" />}
                >
                  {calendarActionSaving ? 'Adding...' : selectedInvitationAddActionState.label}
                </Button>
              </div>
              {selectedInvitationAlreadyAdded && (
                <p className="text-xs text-muted-foreground">
                  Already added elsewhere — you can still add it to more calendars.
                </p>
              )}
            </div>
          </>
        </AddToCalendarShell>
      )}

      {categoryTagModalMode && (
        <Dialog
          open
          onClose={() => setCategoryTagModalMode(null)}
          title="Select Category Tags"
          description={
            <>
              Mode:{' '}
              <span className="font-medium text-foreground">{categoryTagModalMode.name}</span>
            </>
          }
          size="md"
          showCloseButton
          closeLabel="Close category picker"
        >
            <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
              {timeManagerCategories
                .filter((cat) => cat.mode_id === categoryTagModalMode.id)
                .map((cat) => {
                  const isSelected = selectedTimeManagerCategoryIds.has(cat.id)
                  const textColor = getLegibleTextColor(cat.color, cat.font_color)
                  return (
                    <label
                      key={cat.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border p-2.5 hover:bg-accent/40 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {
                            if (!selectedTimeManagerModeIds.has(categoryTagModalMode.id)) {
                              setSelectedTimeManagerModeIds((prev) =>
                                new Set(prev).add(categoryTagModalMode.id)
                              )
                            }
                            toggleTimeManagerCategory(cat.id)
                          }}
                          className="h-4 w-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
                        />
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold shadow-2xs"
                          style={{
                            backgroundColor: cat.color,
                            color: textColor,
                            border: `1px solid ${cat.color}`,
                          }}
                        >
                          <span>{cat.label}</span>
                        </span>
                      </div>
                      {isSelected && <Check className="h-4 w-4 text-primary shrink-0" />}
                    </label>
                  )
                })}
            </div>

            <div className="mt-5 pt-3 border-t border-border flex items-center justify-between gap-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!selectedTimeManagerModeIds.has(categoryTagModalMode.id)) {
                      setSelectedTimeManagerModeIds((prev) =>
                        new Set(prev).add(categoryTagModalMode.id)
                      )
                    }
                    const modeCatIds = timeManagerCategories
                      .filter((c) => c.mode_id === categoryTagModalMode.id)
                      .map((c) => c.id)
                    setSelectedTimeManagerCategoryIds((prev) => {
                      const next = new Set(prev)
                      modeCatIds.forEach((id) => next.add(id))
                      if (typeof window !== 'undefined') {
                        try {
                          localStorage.setItem(
                            'mailbox:time-manager-categories:v1',
                            JSON.stringify(Array.from(next))
                          )
                        } catch {
                          /* ignore */
                        }
                      }
                      return next
                    })
                  }}
                  className="text-xs text-primary hover:underline font-medium cursor-pointer"
                >
                  Select All
                </button>
                <span className="text-muted-foreground text-xs">·</span>
                <button
                  type="button"
                  onClick={() => {
                    const modeCatIds = new Set(
                      timeManagerCategories
                        .filter((c) => c.mode_id === categoryTagModalMode.id)
                        .map((c) => c.id)
                    )
                    setSelectedTimeManagerCategoryIds((prev) => {
                      const next = new Set(Array.from(prev).filter((id) => !modeCatIds.has(id)))
                      if (typeof window !== 'undefined') {
                        try {
                          localStorage.setItem(
                            'mailbox:time-manager-categories:v1',
                            JSON.stringify(Array.from(next))
                          )
                        } catch {
                          /* ignore */
                        }
                      }
                      return next
                    })
                  }}
                  className="text-xs text-muted-foreground hover:underline font-medium cursor-pointer"
                >
                  Deselect All
                </button>
              </div>
              <Button
                intent="primary"
                size="compact"
                onClick={() => setCategoryTagModalMode(null)}
              >
                Done
              </Button>
            </div>
        </Dialog>
      )}

      {activeSettingsTab === 'ai' && activeTab === 'settings' && (
        <section className="space-y-4">
          <article className="rounded-2xl border border-border bg-card p-4 space-y-4">
            <div>
              <h2 className="text-lg font-semibold">AI Assistant Data Access</h2>
              <div className="mt-2 space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
                <p>
                  The Mailbox assistant does not browse your mailbox on its own. Each time you send
                  it a message, the page collects the data sources listed below and sends that
                  snapshot along with your question. Unchecking a source removes it from that
                  snapshot, so the assistant loses the abilities it powers.
                </p>
                <p>
                  Everything is enabled by default and nothing here runs in the background: these
                  settings only apply while you are actively chatting with the assistant in the
                  Mailbox. The assistant can still never activate an automation rule or execute a
                  live run -- you approve that yourself.
                </p>
                <p>
                  Sources with a{' '}
                  <span className="font-medium text-foreground">Request feature</span> button are
                  not wired to the assistant yet -- clicking it files a feature request on your
                  behalf describing what that source would unlock.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {MAILBOX_AI_ACCESS_ENTRIES.filter((entry) => aiAccess[entry.id]).length} of{' '}
                {MAILBOX_AI_ACCESS_ENTRIES.length} sources shared
              </span>
              <Button
                emphasis="outline"
                size="compact"
                onClick={() => setAiAccess(buildMailboxAiAccess(true))}
              >
                Allow all
              </Button>
              <Button
                emphasis="outline"
                size="compact"
                onClick={() => setAiAccess(buildMailboxAiAccess(false))}
              >
                Withhold all
              </Button>
            </div>

            <div className="grid gap-2 xl:grid-cols-2">
              {MAILBOX_AI_ACCESS_ENTRIES.map((entry) => (
                <label
                  key={entry.id}
                  className="flex gap-3 rounded-xl border border-border bg-background p-3 cursor-pointer hover:bg-accent/30"
                >
                  <input
                    type="checkbox"
                    checked={aiAccess[entry.id]}
                    onChange={(e) =>
                      setAiAccess((prev) => ({ ...prev, [entry.id]: e.target.checked }))
                    }
                    className="mt-0.5 accent-primary"
                  />
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{entry.label}</span>
                      {entry.status === 'planned' &&
                        (requestedFeatureIds.has(entry.id) ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-success-muted bg-success-subtle px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
                            <Check className="h-3 w-3" />
                            Requested
                          </span>
                        ) : (
                          <Button
                            emphasis="outline"
                            intent="primary"
                            size="compact"
                            onClick={(e) => {
                              e.preventDefault()
                              void handleRequestFeature(entry.id)
                            }}
                            disabled={requestingFeatureId === entry.id}
                            icon={<Sparkles className="h-3 w-3" />}
                          >
                            {requestingFeatureId === entry.id ? 'Requesting...' : 'Request feature'}
                          </Button>
                        ))}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {entry.tables.map((table) => (
                        <code
                          key={table}
                          className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground"
                        >
                          {table}
                        </code>
                      ))}
                    </div>
                    <ul className="space-y-0.5 text-[11px] text-muted-foreground">
                      {entry.abilities.map((ability) => (
                        <li key={ability}>- {ability}</li>
                      ))}
                    </ul>
                  </div>
                </label>
              ))}
            </div>
          </article>
        </section>
      )}

      {threadInvitationChoices && (
        <ChoiceDialog<string>
          open
          title="Choose an invitation"
          description="Choose which email invitation to add. The source email will be selected in the Thread Viewer."
          choices={threadInvitationChoiceOptions}
          onChoose={chooseThreadInvitation}
          onCancel={() => setThreadInvitationChoices(null)}
        />
      )}

      {pendingTrustMessage && pendingTrustDomain && (
        <ChoiceDialog<'trust' | 'keep-raw'>
          open
          title="Trust Domain To Render HTML?"
          description={
            <>
              Raw mode blocked HTML rendering for this email. Trust{' '}
              <span className="font-mono">{pendingTrustDomain}</span> to render sanitized HTML from
              this sender.
              <span className="mt-1 block break-all text-xs">
                Sender: {pendingTrustMessage.from_email || 'Unknown'}
              </span>
            </>
          }
          choices={[
            { value: 'trust', label: 'Trust domain and render HTML', intent: 'primary' },
            { value: 'keep-raw', label: 'Keep raw mode' },
          ]}
          onChoose={(choice) => {
            if (choice === 'trust') {
              trustDomainFromPendingMessage()
              return
            }
            setMailViewerMode('raw-text')
            setPendingTrustMessageId(null)
          }}
          onCancel={() => setPendingTrustMessageId(null)}
          cancelText="Not now"
        />
      )}

      {messageActivityLog && (
        <Dialog
          open
          onClose={() => setMessageActivityLog(null)}
          title="Email Action Log"
          description={
            <span className="block truncate">{messageActivityLog.message.subject || '(no subject)'}</span>
          }
          size="xl"
          showCloseButton
          closeLabel="Close email action log"
        >
            {messageActivityLog.loading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading action log...</p>
            ) : (
              <ol className="space-y-3">
                <li className="border-l-2 border-info-muted pl-3">
                  <p className="text-sm font-medium">Email arrived</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatTimestamp(messageActivityLog.activity?.arrived_at || null, userDateFormat)}
                  </p>
                </li>
                <li className="border-l-2 border-feature-ai-muted pl-3">
                  <p className="text-sm font-medium">System tags applied</p>
                  <p className="text-[11px] text-muted-foreground">
                    {messageActivityLog.activity?.system_tags.length
                      ? messageActivityLog.activity.system_tags.join(', ')
                      : 'No system tags applied'}
                  </p>
                </li>
                {messageActivityLog.activity?.events.map((event, index) => (
                  <li key={event.id} className="border-l-2 border-success-muted pl-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-sm font-medium">
                        {event.source_type === 'rule'
                          ? `Automation: ${event.rule_name || 'Unnamed automation'}`
                          : event.source_type === 'import'
                            ? 'Provider import'
                            : 'Manual action'}
                      </p>
                      {event.source_type === 'rule' && (
                        <span className="rounded bg-success-subtle px-1.5 py-0.5 text-[10px] font-medium text-success">
                          Chain {event.chain_id.slice(0, 8)} - step {event.depth + 1}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-foreground">{describeMailActivityAction(event)}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {index + 1}. {formatTimestamp(event.created_at, userDateFormat)}
                    </p>
                  </li>
                ))}
                {messageActivityLog.activity?.events.length === 0 && (
                  <li className="border-l-2 border-border pl-3 text-xs text-muted-foreground">
                    No manual or automation actions have been recorded.
                  </li>
                )}
              </ol>
            )}
        </Dialog>
      )}

      {confirmPrompt && (
        <ConfirmDialog
          open
          title={confirmPrompt.title}
          message={confirmPrompt.message}
          confirmText={confirmPrompt.confirmLabel}
          intent="danger"
          onConfirm={resolveConfirmPrompt}
          onCancel={() => setConfirmPrompt(null)}
        >
          {confirmPrompt.details && confirmPrompt.details.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
              {confirmPrompt.details.map((detail) => (
                <li key={detail} className="wrap-break-word">
                  {detail}
                </li>
              ))}
            </ul>
          )}
          {confirmPrompt.key === 'remove-account' && (
            <p className="mt-2 text-xs font-medium text-danger">
              {accountRemovalPreview
                ? `${accountRemovalPreview.messages} emails, ${accountRemovalPreview.threads} threads and ${accountRemovalPreview.drafts} drafts stored here will be deleted.`
                : 'Counting the emails stored here...'}
            </p>
          )}
          {confirmPrompt.suppressLabel && (
            <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={confirmSuppressDraft}
                onChange={(event) => setConfirmSuppressDraft(event.target.checked)}
                className="accent-primary"
              />
              {confirmPrompt.suppressLabel}
            </label>
          )}
        </ConfirmDialog>
      )}
    </div>
  )
}
