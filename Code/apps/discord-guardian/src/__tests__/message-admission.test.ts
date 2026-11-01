import { describe, expect, it } from 'vitest'
import {
  getSettingsSkipReason,
  isRecentContentEdit,
  isWithinHistoryWindow,
  MESSAGE_HISTORY_WINDOW_MS,
  shouldProcessMessageUpdate,
} from '../message-admission.js'

const NOW = Date.parse('2026-10-04T19:00:00Z')
const YEAR_OLD = NOW - 365 * 24 * MESSAGE_HISTORY_WINDOW_MS

describe('Guardian message admission', () => {
  it.each([
    [NOW, true],
    [NOW - MESSAGE_HISTORY_WINDOW_MS + 1, true],
    [NOW - MESSAGE_HISTORY_WINDOW_MS, true],
    [NOW - MESSAGE_HISTORY_WINDOW_MS - 1, false],
    [YEAR_OLD, false],
    [NOW + 1, false],
    [null, false],
    [Number.NaN, false],
  ])('admits timestamp %s only within the last hour', (timestamp, expected) => {
    expect(isWithinHistoryWindow(timestamp, NOW)).toBe(expected)
  })

  const oldMessage = {
    createdTimestamp: YEAR_OLD,
    editedTimestamp: null,
    content: 'same content',
    previousContent: 'same content',
    previousEditedTimestamp: null,
  }

  it('rejects metadata updates to year-old messages', () => {
    expect(shouldProcessMessageUpdate(oldMessage, NOW)).toBe(false)
  })

  it('rejects historical edits even when the old content differs or is unknown', () => {
    for (const previousContent of ['old content', undefined]) {
      expect(shouldProcessMessageUpdate({
        ...oldMessage,
        previousContent,
        editedTimestamp: NOW - MESSAGE_HISTORY_WINDOW_MS - 1,
      }, NOW)).toBe(false)
    }
  })

  it('admits a genuinely recent edit of an old message for scanning and actions', () => {
    const edit = { ...oldMessage, editedTimestamp: NOW, content: 'new forbidden content' }
    expect(shouldProcessMessageUpdate(edit, NOW)).toBe(true)
    expect(isRecentContentEdit(edit, NOW)).toBe(true)
  })

  it('admits recent edits when the previous message is partial', () => {
    const edit = {
      ...oldMessage,
      editedTimestamp: NOW,
      previousContent: undefined,
      previousEditedTimestamp: undefined,
    }
    expect(shouldProcessMessageUpdate(edit, NOW)).toBe(true)
    expect(isRecentContentEdit(edit, NOW)).toBe(true)
  })

  it('admits a new edit timestamp for attachment-only edits', () => {
    expect(shouldProcessMessageUpdate({
      ...oldMessage,
      editedTimestamp: NOW,
      previousEditedTimestamp: NOW - 1000,
    }, NOW)).toBe(true)
  })

  it('rejects unchanged metadata on old messages even with a recent edit timestamp', () => {
    expect(shouldProcessMessageUpdate({
      ...oldMessage,
      editedTimestamp: NOW,
      previousEditedTimestamp: NOW,
    }, NOW)).toBe(false)
  })

  it('continues scanning recent messages when Discord adds embeds', () => {
    expect(shouldProcessMessageUpdate({ ...oldMessage, createdTimestamp: NOW }, NOW)).toBe(true)
  })
})

describe('settings-based scan exclusions', () => {
  it.each([
    [{ channelDisabled: false, parentChannelDisabled: false, ignoredRole: false }, null],
    [{ channelDisabled: false, parentChannelDisabled: false, ignoredRole: true }, 'ignored_role'],
    [{ channelDisabled: false, parentChannelDisabled: true, ignoredRole: false }, 'parent_channel_disabled'],
    [{ channelDisabled: true, parentChannelDisabled: false, ignoredRole: false }, 'channel_disabled'],
    [{ channelDisabled: true, parentChannelDisabled: true, ignoredRole: true }, 'channel_disabled'],
  ])('records the effective exclusion for %j', (settings, reason) => {
    expect(getSettingsSkipReason(settings)).toBe(reason)
  })
})
