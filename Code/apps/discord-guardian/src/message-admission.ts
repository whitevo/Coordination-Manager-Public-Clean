export const MESSAGE_HISTORY_WINDOW_MS = 60 * 60 * 1000

export type SettingsSkipReason = 'ignored_role' | 'channel_disabled' | 'parent_channel_disabled'

interface MessageActivity {
  createdTimestamp: number
  editedTimestamp: number | null
  content: string
}

interface MessageUpdateActivity extends MessageActivity {
  previousContent: string | undefined
  previousEditedTimestamp: number | null | undefined
}

export function isWithinHistoryWindow(timestamp: number | null, now = Date.now()): boolean {
  return timestamp !== null &&
    Number.isFinite(timestamp) &&
    timestamp <= now &&
    now - timestamp <= MESSAGE_HISTORY_WINDOW_MS
}

export function isRecentContentEdit(message: MessageUpdateActivity, now = Date.now()): boolean {
  if (!isWithinHistoryWindow(message.editedTimestamp, now)) return false
  return message.previousContent === undefined ||
    message.previousContent !== message.content ||
    message.previousEditedTimestamp !== message.editedTimestamp
}

export function shouldProcessMessageUpdate(message: MessageUpdateActivity, now = Date.now()): boolean {
  return isWithinHistoryWindow(message.createdTimestamp, now) || isRecentContentEdit(message, now)
}

export function getSettingsSkipReason(settings: {
  channelDisabled: boolean
  parentChannelDisabled: boolean
  ignoredRole: boolean
}): SettingsSkipReason | null {
  if (settings.channelDisabled) return 'channel_disabled'
  if (settings.parentChannelDisabled) return 'parent_channel_disabled'
  if (settings.ignoredRole) return 'ignored_role'
  return null
}
