import {
  MAILBOX_SYSTEM_TAG_IDS,
  MAILBOX_SYSTEM_TAG_LABELS,
  buildSystemSortId,
  buildUserSortId,
  messageHasTag,
  readSystemTagFromSortId,
  readUserTagFromSortId,
  type MailboxSortableMessage,
  type MailboxSystemTagId,
} from './mailbox-sort'

/**
 * notify / mute are soft signals from a matching tag; always / never are hard
 * overrides. never beats always, which beats mute, which beats notify. A
 * message that matches no rule-bearing tag at all never notifies -- notification is opt-in per tag.
 */
export type MailboxNotifyMode = 'notify' | 'mute' | 'always' | 'never'

export interface MailboxNotifyTagEntry {
  id: string
  mode: MailboxNotifyMode
}

export interface MailboxNotificationRulesState {
  enabled: boolean
  systemTags: MailboxNotifyTagEntry[]
  userTags: MailboxNotifyTagEntry[]
}

export const MAILBOX_NOTIFY_MODES: MailboxNotifyMode[] = ['notify', 'mute', 'always', 'never']

export const MAILBOX_NOTIFY_MODE_LABELS: Record<MailboxNotifyMode, string> = {
  notify: 'Notify',
  mute: "Don't notify",
  always: 'Definitely notify',
  never: "Definitely don't notify",
}

export const MAILBOX_NOTIFY_MODE_HINTS: Record<MailboxNotifyMode, string> = {
  notify: 'Included in notifications unless another matching tag mutes or overrides it',
  mute: 'Excluded from notifications unless another matching tag forces it back on',
  always:
    'Always notifies, even if another matching tag says not to -- unless a tag says definitely not',
  never: 'Never notifies, no matter what any other matching tag says',
}

// Everything is opt-in: every tag (system and custom alike) starts as "Don't notify" until you
// explicitly turn one on. Junk/Trash start one step further, as a hard "Definitely don't notify",
// since they should never light up the badge even if another matching tag says otherwise.
const DEFAULT_SYSTEM_NOTIFY_MODES: Partial<Record<MailboxSystemTagId, MailboxNotifyMode>> = {
  trash: 'never',
  junk: 'never',
}

export function cycleNotifyMode(mode: MailboxNotifyMode): MailboxNotifyMode {
  return MAILBOX_NOTIFY_MODES[
    (MAILBOX_NOTIFY_MODES.indexOf(mode) + 1) % MAILBOX_NOTIFY_MODES.length
  ]
}

export function buildDefaultMailboxNotificationRulesState(
  userTagIds: string[]
): MailboxNotificationRulesState {
  return {
    enabled: false,
    systemTags: MAILBOX_SYSTEM_TAG_IDS.map((tag) => ({
      id: buildSystemSortId(tag),
      mode: DEFAULT_SYSTEM_NOTIFY_MODES[tag] ?? 'mute',
    })),
    userTags: userTagIds.map((tagId) => ({ id: buildUserSortId(tagId), mode: 'mute' as const })),
  }
}

export function withNotifyMode(
  state: MailboxNotificationRulesState,
  entryId: string,
  mode: MailboxNotifyMode
): MailboxNotificationRulesState {
  const apply = (entries: MailboxNotifyTagEntry[]) =>
    entries.map((entry) => (entry.id === entryId ? { ...entry, mode } : entry))

  return readUserTagFromSortId(entryId) !== null
    ? { ...state, userTags: apply(state.userTags) }
    : { ...state, systemTags: apply(state.systemTags) }
}

function reconcileEntries(
  stored: MailboxNotifyTagEntry[],
  expected: MailboxNotifyTagEntry[]
): MailboxNotifyTagEntry[] {
  const expectedIds = new Set(expected.map((entry) => entry.id))
  const kept = stored.filter((entry) => expectedIds.has(entry.id))
  const keptIds = new Set(kept.map((entry) => entry.id))
  return [...kept, ...expected.filter((entry) => !keptIds.has(entry.id))]
}

/** Drop entries for tags that no longer exist and append entries for tags that appeared since the state was stored. */
export function reconcileMailboxNotificationRulesState(
  state: MailboxNotificationRulesState,
  userTagIds: string[]
): MailboxNotificationRulesState {
  const defaults = buildDefaultMailboxNotificationRulesState(userTagIds)
  return {
    enabled: state.enabled,
    systemTags: reconcileEntries(state.systemTags, defaults.systemTags),
    userTags: reconcileEntries(state.userTags, defaults.userTags),
  }
}

function parseNotifyMode(value: unknown): MailboxNotifyMode {
  return value === 'mute' || value === 'always' || value === 'never' ? value : 'notify'
}

function parseNotifyEntries(
  value: unknown,
  isValidId: (id: string) => boolean
): MailboxNotifyTagEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return []
    const source = item as Record<string, unknown>
    if (typeof source.id !== 'string' || !isValidId(source.id)) return []
    return [{ id: source.id, mode: parseNotifyMode(source.mode) }]
  })
}

export function parseMailboxNotificationRulesState(
  value: unknown,
  userTagIds: string[]
): MailboxNotificationRulesState {
  if (typeof value !== 'object' || value === null)
    return buildDefaultMailboxNotificationRulesState(userTagIds)

  const source = value as Record<string, unknown>
  return reconcileMailboxNotificationRulesState(
    {
      enabled: source.enabled === true,
      systemTags: parseNotifyEntries(
        source.systemTags,
        (id) => readSystemTagFromSortId(id) !== null
      ),
      userTags: parseNotifyEntries(source.userTags, (id) => readUserTagFromSortId(id) !== null),
    },
    userTagIds
  )
}

/** Notify rules, keyed by sort entry id (same `system:`/`user:` ids used by mailbox-sort). */
export type MailboxNotifyModeMap = Map<string, MailboxNotifyMode>

export function resolveEffectiveNotifyModes(
  state: MailboxNotificationRulesState
): MailboxNotifyModeMap {
  const modes: MailboxNotifyModeMap = new Map()
  for (const entry of [...state.systemTags, ...state.userTags]) modes.set(entry.id, entry.mode)
  return modes
}

export function resolveTagLabel(
  entryId: string,
  resolveUserTagLabel: (tagId: string) => string
): string {
  const systemTag = readSystemTagFromSortId(entryId)
  if (systemTag) return MAILBOX_SYSTEM_TAG_LABELS[systemTag]
  const userTagId = readUserTagFromSortId(entryId)
  return userTagId ? resolveUserTagLabel(userTagId) : 'Unknown tag'
}

/** never > always > mute > notify > (no matching tag at all -- do not notify). */
export function shouldNotifyForMessage<T extends MailboxSortableMessage>(
  message: T,
  modes: MailboxNotifyModeMap,
  isJunk: (message: T) => boolean
): boolean {
  const matchingModes: MailboxNotifyMode[] = []
  for (const [entryId, mode] of modes) {
    if (messageHasTag(message, entryId, isJunk)) matchingModes.push(mode)
  }

  if (matchingModes.includes('never')) return false
  if (matchingModes.includes('always')) return true
  if (matchingModes.includes('mute')) return false
  if (matchingModes.includes('notify')) return true
  return false
}

// ─── Persistence (per-browser fallback; server is the source of truth) ─────

export function readMailboxNotificationRulesState(
  storageKey: string,
  userTagIds: string[]
): MailboxNotificationRulesState {
  if (typeof window === 'undefined') return buildDefaultMailboxNotificationRulesState(userTagIds)

  try {
    const stored = window.localStorage.getItem(storageKey)
    return parseMailboxNotificationRulesState(stored ? JSON.parse(stored) : null, userTagIds)
  } catch {
    return buildDefaultMailboxNotificationRulesState(userTagIds)
  }
}

export function writeMailboxNotificationRulesState(
  storageKey: string,
  state: MailboxNotificationRulesState
): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state))
  } catch {
    // Local storage can be unavailable (private mode / quota); the server copy still applies next load.
  }
}

// ─── Nav "pin" coordination (notifications only matter if Mailbox is visible in the quick menu) ───

/** Layout.tsx's pinned quick-tools localStorage key -- read-only here, Layout owns writing it. */
export const NAV_QUICK_TOOLS_STORAGE_KEY = 'cm-nav-quick-tools'

/** Fired by Layout.tsx whenever the pinned quick-tools list changes (pin/unpin, server sync). */
export const NAV_QUICK_TOOLS_CHANGED_EVENT = 'quickToolsChanged'

/** Asks Layout.tsx to pin Mailbox to the quick menu; Layout listens and owns the actual persistence. */
export const MAILBOX_REQUEST_PIN_EVENT = 'mailbox-request-pin'

export function readIsMailboxPinnedToQuickMenu(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const stored = window.localStorage.getItem(NAV_QUICK_TOOLS_STORAGE_KEY)
    const parsed: unknown = stored ? JSON.parse(stored) : []
    return Array.isArray(parsed) && parsed.includes('mailbox')
  } catch {
    return false
  }
}

export function requestPinMailboxToQuickMenu(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(MAILBOX_REQUEST_PIN_EVENT))
}

// ─── New-mail badge flag (in-app dot indicator, no OS permission needed) ───

export const MAILBOX_NOTIFICATION_FLAG_EVENT = 'mailbox-notification-flag'
const MAILBOX_NOTIFICATION_FLAG_KEY_PREFIX = 'mailbox:has-new-notification:v1:'
const MAILBOX_NOTIFICATION_ELIGIBILITY_KEY_PREFIX = 'mailbox:notification-eligibility:v1:'
const MAILBOX_NOTIFICATION_ELIGIBILITY_MAX = 1000

export function buildMailboxNotificationFlagKey(userKey: string): string {
  return `${MAILBOX_NOTIFICATION_FLAG_KEY_PREFIX}${userKey}`
}

export function readMailboxNotificationFlag(storageKey: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(storageKey) === '1'
  } catch {
    return false
  }
}

interface MailboxNotificationCheckResult {
  enabled?: unknown
  hasNew?: unknown
}

export function resolveMailboxNotificationFlagFromCheck(
  currentValue: boolean,
  result: MailboxNotificationCheckResult
): boolean {
  if (result.enabled === false) return false
  if (result.hasNew === true) return true
  return currentValue
}

export function writeMailboxNotificationFlag(storageKey: string, value: boolean): void {
  if (typeof window === 'undefined') return
  try {
    if (value) window.localStorage.setItem(storageKey, '1')
    else window.localStorage.removeItem(storageKey)
  } catch {
    // Local storage can be unavailable (private mode / quota); the badge just won't persist.
  }
  window.dispatchEvent(
    new CustomEvent(MAILBOX_NOTIFICATION_FLAG_EVENT, { detail: { key: storageKey, value } })
  )
}

/**
 * Fired by the background `/notifications/check` poll when the SERVER reports mail that the
 * currently loaded inbox list may not contain yet. Separate from
 * MAILBOX_NOTIFICATION_FLAG_EVENT, which the Mailbox page itself also emits while deriving the
 * badge from already-loaded messages -- listening to that one would re-fetch in a loop.
 */
export const MAILBOX_REMOTE_NEW_MAIL_EVENT = 'mailbox-remote-new-mail'

export function announceRemoteNewMail(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(MAILBOX_REMOTE_NEW_MAIL_EVENT))
}

/**
 * Per-message "did this message currently qualify for a notification" record, so a message that
 * starts matching (e.g. manually marked unread again, or a tag rule changes) is detected the same
 * way a brand-new message is -- a plain "have we ever seen this id" set would permanently ignore
 * a message the moment it is first loaded, even if its state later starts matching the rules.
 */
export function readMailboxNotificationEligibility(userKey: string): Map<string, boolean> {
  if (typeof window === 'undefined') return new Map()
  try {
    const stored = window.localStorage.getItem(
      `${MAILBOX_NOTIFICATION_ELIGIBILITY_KEY_PREFIX}${userKey}`
    )
    const parsed: unknown = stored ? JSON.parse(stored) : []
    if (!Array.isArray(parsed)) return new Map()
    const entries = parsed.filter(
      (entry): entry is [string, boolean] =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === 'string' &&
        typeof entry[1] === 'boolean'
    )
    return new Map(entries)
  } catch {
    return new Map()
  }
}

/** Caps the stored map so it cannot grow unbounded across a long-lived mailbox. */
export function writeMailboxNotificationEligibility(
  userKey: string,
  eligibility: Map<string, boolean>
): void {
  if (typeof window === 'undefined') return
  try {
    const capped = Array.from(eligibility.entries()).slice(-MAILBOX_NOTIFICATION_ELIGIBILITY_MAX)
    window.localStorage.setItem(
      `${MAILBOX_NOTIFICATION_ELIGIBILITY_KEY_PREFIX}${userKey}`,
      JSON.stringify(capped)
    )
  } catch {
    // Local storage can be unavailable (private mode / quota); eligibility will be re-baselined next load.
  }
}
