import { describe, expect, it } from 'vitest'
import {
  MAILBOX_NOTIFY_MODES,
  buildDefaultMailboxNotificationRulesState,
  cycleNotifyMode,
  parseMailboxNotificationRulesState,
  reconcileMailboxNotificationRulesState,
  resolveEffectiveNotifyModes,
  resolveMailboxNotificationFlagFromCheck,
  shouldNotifyForMessage,
  withNotifyMode,
  type MailboxNotifyModeMap,
} from '../mailbox-notifications'
import { buildSystemSortId, buildUserSortId, type MailboxSortableMessage } from '../mailbox-sort'

function makeMessage(overrides: Partial<MailboxSortableMessage> & { id: string }): MailboxSortableMessage & { id: string } {
  return {
    received_at: '2026-08-01T10:00:00.000Z',
    is_read: true,
    is_archived: false,
    has_attachments: false,
    is_provider_trashed: false,
    is_provider_junk: false,
    is_provider_sent: false,
    user_tag_ids: [],
    ...overrides,
  }
}

const noJunk = () => false

describe('buildDefaultMailboxNotificationRulesState', () => {
  it('starts disabled with everything opt-in ("Don\'t notify"), except Junk/Trash locked to a hard veto', () => {
    const state = buildDefaultMailboxNotificationRulesState(['tag-a'])

    expect(state.enabled).toBe(false)
    expect(state.systemTags.find((e) => e.id === 'system:draft')?.mode).toBe('mute')
    expect(state.systemTags.find((e) => e.id === 'system:sent')?.mode).toBe('mute')
    expect(state.systemTags.find((e) => e.id === 'system:archived')?.mode).toBe('mute')
    expect(state.systemTags.find((e) => e.id === 'system:unread')?.mode).toBe('mute')
    expect(state.systemTags.find((e) => e.id === 'system:attachments')?.mode).toBe('mute')
    expect(state.systemTags.find((e) => e.id === 'system:trash')?.mode).toBe('never')
    expect(state.systemTags.find((e) => e.id === 'system:junk')?.mode).toBe('never')
    expect(state.userTags).toEqual([{ id: 'user:tag-a', mode: 'mute' }])
  })
})

describe('cycleNotifyMode', () => {
  it('cycles notify -> mute -> always -> never -> notify', () => {
    expect(cycleNotifyMode('notify')).toBe('mute')
    expect(cycleNotifyMode('mute')).toBe('always')
    expect(cycleNotifyMode('always')).toBe('never')
    expect(cycleNotifyMode('never')).toBe('notify')
    expect(MAILBOX_NOTIFY_MODES).toHaveLength(4)
  })
})

describe('withNotifyMode', () => {
  it('updates only the targeted entry within its own group', () => {
    const state = withNotifyMode(buildDefaultMailboxNotificationRulesState(['tag-a']), buildSystemSortId('junk'), 'always')
    expect(state.systemTags.find((e) => e.id === 'system:junk')?.mode).toBe('always')
    expect(state.userTags).toEqual([{ id: 'user:tag-a', mode: 'mute' }])

    const withUserTag = withNotifyMode(state, buildUserSortId('tag-a'), 'never')
    expect(withUserTag.userTags).toEqual([{ id: 'user:tag-a', mode: 'never' }])
  })
})

describe('reconcileMailboxNotificationRulesState', () => {
  it('drops removed custom tags and appends new ones', () => {
    const stored = buildDefaultMailboxNotificationRulesState(['tag-a'])
    const reconciled = reconcileMailboxNotificationRulesState(stored, ['tag-b'])
    expect(reconciled.userTags).toEqual([{ id: 'user:tag-b', mode: 'mute' }])
  })
})

describe('parseMailboxNotificationRulesState', () => {
  it('falls back to defaults for non-object input', () => {
    expect(parseMailboxNotificationRulesState(null, [])).toEqual(buildDefaultMailboxNotificationRulesState([]))
  })

  it('restores persisted enabled flag and tag modes', () => {
    const state = parseMailboxNotificationRulesState({
      enabled: true,
      systemTags: [{ id: 'system:junk', mode: 'always' }],
      userTags: [],
    }, [])

    expect(state.enabled).toBe(true)
    expect(state.systemTags.find((e) => e.id === 'system:junk')?.mode).toBe('always')
  })
})

describe('shouldNotifyForMessage', () => {
  const junkMessage = makeMessage({ id: 'junk', is_provider_junk: true })
  const unreadMessage = makeMessage({ id: 'unread', is_read: false })
  const taggedMessage = makeMessage({ id: 'tagged', user_tag_ids: ['tag-a'] })

  it('does not notify when no matching tag has a rule', () => {
    const modes: MailboxNotifyModeMap = new Map()
    expect(shouldNotifyForMessage(unreadMessage, modes, noJunk)).toBe(false)
  })

  it('mute suppresses notification for a matching tag', () => {
    const modes: MailboxNotifyModeMap = new Map([['system:unread', 'mute']])
    expect(shouldNotifyForMessage(unreadMessage, modes, noJunk)).toBe(false)
  })

  it('always overrides mute from another matching tag', () => {
    const modes: MailboxNotifyModeMap = new Map([
      ['system:unread', 'mute'],
      ['user:tag-a', 'always'],
    ])
    expect(shouldNotifyForMessage({ ...unreadMessage, user_tag_ids: ['tag-a'] }, modes, noJunk)).toBe(true)
  })

  it('never is a hard veto over always', () => {
    const modes: MailboxNotifyModeMap = new Map([
      ['system:junk', 'never'],
      ['user:tag-a', 'always'],
    ])
    expect(shouldNotifyForMessage({ ...junkMessage, user_tag_ids: ['tag-a'] }, modes, noJunk)).toBe(false)
  })

  it('applies custom tag rules the same way as system tags, and never notifies for an unmatched message', () => {
    const modes: MailboxNotifyModeMap = new Map([['user:tag-a', 'mute']])
    expect(shouldNotifyForMessage(taggedMessage, modes, noJunk)).toBe(false)
    expect(shouldNotifyForMessage(makeMessage({ id: 'untagged' }), modes, noJunk)).toBe(false)
  })

  it('only notifies for the tag explicitly marked to notify, e.g. "only Unread should notify"', () => {
    const modes: MailboxNotifyModeMap = new Map([['system:unread', 'always']])
    const plainReadMessage = makeMessage({ id: 'plain-read' })
    expect(shouldNotifyForMessage(unreadMessage, modes, noJunk)).toBe(true)
    expect(shouldNotifyForMessage(plainReadMessage, modes, noJunk)).toBe(false)
  })
})

describe('resolveEffectiveNotifyModes', () => {
  it('reads every system and custom tag rule into one map', () => {
    const state = buildDefaultMailboxNotificationRulesState(['tag-a'])
    const modes = resolveEffectiveNotifyModes(state)

    expect(modes.get('system:trash')).toBe('never')
    expect(modes.get('user:tag-a')).toBe('mute')
  })
})

describe('resolveMailboxNotificationFlagFromCheck', () => {
  it('clears a stale badge when notifications are disabled', () => {
    expect(resolveMailboxNotificationFlagFromCheck(true, { enabled: false, hasNew: false })).toBe(false)
  })

  it('lights the badge for new matching mail and otherwise preserves it', () => {
    expect(resolveMailboxNotificationFlagFromCheck(false, { enabled: true, hasNew: true })).toBe(true)
    expect(resolveMailboxNotificationFlagFromCheck(true, { enabled: true, hasNew: false })).toBe(true)
  })
})
