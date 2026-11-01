import { describe, expect, it } from 'vitest'
import {
  buildDefaultMailboxSortState,
  buildSystemSortId,
  buildUserSortId,
  cycleTagMode,
  isMessageVisible,
  messageHasTag,
  moveSortEntryById,
  moveSortItem,
  parseMailboxSortState,
  reconcileMailboxSortState,
  sortMailboxMessages,
  withTagMode,
  type MailboxSortableMessage,
  type MailboxTagModeMap,
} from '../mailbox-sort'

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

describe('buildDefaultMailboxSortState', () => {
  it('orders date, system tags, then custom tags with every tag in sort mode', () => {
    const state = buildDefaultMailboxSortState(['tag-a'])

    expect(state.order).toEqual(['date', 'group:system', 'group:user'])
    expect(state.dateEnabled).toBe(true)
    expect(state.dateDirection).toBe('newest')
    expect(state.systemTags.map((entry) => entry.id)).toEqual([
      'system:unread',
      'system:draft',
      'system:sent',
      'system:trash',
      'system:junk',
      'system:archived',
      'system:attachments',
    ])
    expect(state.systemTags.every((entry) => entry.mode === 'sort')).toBe(true)
    expect(state.userTags).toEqual([{ id: 'user:tag-a', mode: 'sort' }])
  })
})

describe('messageHasTag', () => {
  it('matches the draft system tag on locally saved drafts', () => {
    const draft = makeMessage({ id: 'draft', is_draft: true })
    const synced = makeMessage({ id: 'synced' })

    expect(messageHasTag(draft, 'system:draft', noJunk)).toBe(true)
    expect(messageHasTag(synced, 'system:draft', noJunk)).toBe(false)
  })

  it('matches the junk system tag for provider junk messages', () => {
    const providerJunk = makeMessage({ id: 'provider-junk', is_provider_junk: true })

    expect(messageHasTag(providerJunk, 'system:junk', noJunk)).toBe(true)
  })
})

describe('cycleTagMode', () => {
  it('cycles sort -> only -> hide -> sort', () => {
    expect(cycleTagMode('sort')).toBe('only')
    expect(cycleTagMode('only')).toBe('hide')
    expect(cycleTagMode('hide')).toBe('sort')
  })
})

describe('withTagMode', () => {
  it('updates a system tag without touching the custom tags', () => {
    const state = withTagMode(buildDefaultMailboxSortState(['tag-a']), buildSystemSortId('junk'), 'hide')

    expect(state.systemTags.find((entry) => entry.id === 'system:junk')?.mode).toBe('hide')
    expect(state.userTags).toEqual([{ id: 'user:tag-a', mode: 'sort' }])
  })

  it('updates a custom tag', () => {
    const state = withTagMode(buildDefaultMailboxSortState(['tag-a']), buildUserSortId('tag-a'), 'only')
    expect(state.userTags).toEqual([{ id: 'user:tag-a', mode: 'only' }])
  })
})

describe('moveSortItem', () => {
  it('moves an item towards the front and back', () => {
    expect(moveSortItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b'])
    expect(moveSortItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
  })

  it('leaves the list untouched at the boundaries or for unknown items', () => {
    expect(moveSortItem(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
    expect(moveSortItem(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
    expect(moveSortEntryById([{ id: 'system:unread', mode: 'sort' }], 'user:none', -1)).toEqual([
      { id: 'system:unread', mode: 'sort' },
    ])
  })
})

describe('reconcileMailboxSortState', () => {
  it('drops removed custom tags and appends new ones without losing the stored order', () => {
    const stored = buildDefaultMailboxSortState(['tag-a'])
    stored.order = ['group:system', 'date', 'group:user']

    const reconciled = reconcileMailboxSortState(stored, ['tag-b'])

    expect(reconciled.order).toEqual(['group:system', 'date', 'group:user'])
    expect(reconciled.userTags).toEqual([{ id: 'user:tag-b', mode: 'sort' }])
  })
})

describe('parseMailboxSortState', () => {
  it('falls back to defaults for values that are not objects', () => {
    expect(parseMailboxSortState(null, [])).toEqual(buildDefaultMailboxSortState([]))
    expect(parseMailboxSortState('nope', [])).toEqual(buildDefaultMailboxSortState([]))
  })

  it('restores a persisted order, direction, and tag modes', () => {
    const state = parseMailboxSortState({
      order: ['group:system', 'date', 'group:user'],
      dateEnabled: false,
      dateDirection: 'oldest',
      systemTags: [{ id: 'system:junk', mode: 'hide' }, { id: 'system:unread', mode: 'only' }],
      userTags: [],
    }, [])

    expect(state.order).toEqual(['group:system', 'date', 'group:user'])
    expect(state.dateEnabled).toBe(false)
    expect(state.dateDirection).toBe('oldest')
    expect(state.systemTags.slice(0, 2)).toEqual([
      { id: 'system:junk', mode: 'hide' },
      { id: 'system:unread', mode: 'only' },
    ])
  })
})

describe('isMessageVisible', () => {
  const junk = makeMessage({ id: 'junk' })
  const unread = makeMessage({ id: 'unread', is_read: false })

  it('keeps everything when no rule restricts a tag', () => {
    const modes: MailboxTagModeMap = new Map([['system:unread', 'sort']])
    expect(isMessageVisible(unread, modes, noJunk)).toBe(true)
  })

  it('hides messages carrying a hidden tag', () => {
    const modes: MailboxTagModeMap = new Map([['system:junk', 'hide']])
    expect(isMessageVisible(junk, modes, () => true)).toBe(false)
    expect(isMessageVisible(junk, modes, noJunk)).toBe(true)
  })

  it('hides provider junk messages when the junk tag is hidden', () => {
    const modes: MailboxTagModeMap = new Map([['system:junk', 'hide']])

    expect(isMessageVisible(makeMessage({ id: 'provider-junk', is_provider_junk: true }), modes, noJunk)).toBe(false)
  })

  it('shows sent messages in the default view', () => {
    const sent = makeMessage({ id: 'sent', is_provider_sent: true })
    const modes: MailboxTagModeMap = new Map(buildDefaultMailboxSortState([]).systemTags.map((entry) => [entry.id, entry.mode]))

    expect(isMessageVisible(sent, modes, noJunk)).toBe(true)
  })

  it('restricts the inbox to messages carrying an only tag', () => {
    const modes: MailboxTagModeMap = new Map([['system:unread', 'only']])
    expect(isMessageVisible(unread, modes, noJunk)).toBe(true)
    expect(isMessageVisible(makeMessage({ id: 'read' }), modes, noJunk)).toBe(false)
  })

  it('applies custom tag rules', () => {
    const modes: MailboxTagModeMap = new Map([['user:tag-a', 'hide']])
    expect(isMessageVisible(makeMessage({ id: 'tagged', user_tag_ids: ['tag-a'] }), modes, noJunk)).toBe(false)
  })
})

describe('sortMailboxMessages', () => {
  const older = makeMessage({ id: 'older', received_at: '2026-08-01T10:00:00.000Z', is_read: false })
  const newer = makeMessage({ id: 'newer', received_at: '2026-08-05T10:00:00.000Z' })

  it('sorts by newest date first by default', () => {
    const sorted = sortMailboxMessages([older, newer], buildDefaultMailboxSortState([]), noJunk)
    expect(sorted.map((message) => message.id)).toEqual(['newer', 'older'])
  })

  it('sorts oldest first in ascending direction', () => {
    const state = { ...buildDefaultMailboxSortState([]), dateDirection: 'oldest' as const }
    const sorted = sortMailboxMessages([newer, older], state, noJunk)
    expect(sorted.map((message) => message.id)).toEqual(['older', 'newer'])
  })

  it('promotes unread messages when system tags outrank date', () => {
    const state = buildDefaultMailboxSortState([])
    state.order = ['group:system', 'date', 'group:user']

    const sorted = sortMailboxMessages([newer, older], state, noJunk)
    expect(sorted.map((message) => message.id)).toEqual(['older', 'newer'])
  })

  it('promotes sent messages above newer junk and trash when sent is the top system tag', () => {
    const state = buildDefaultMailboxSortState([])
    state.order = ['group:system', 'date', 'group:user']
    state.systemTags = [
      { id: buildSystemSortId('sent'), mode: 'sort' },
      ...state.systemTags.filter((entry) => entry.id !== buildSystemSortId('sent')),
    ]

    const sent = makeMessage({ id: 'sent', received_at: '2026-07-01T10:00:00.000Z', is_provider_sent: true })
    const trash = makeMessage({ id: 'trash', received_at: '2026-08-06T10:00:00.000Z', is_provider_trashed: true })
    const junk = makeMessage({ id: 'junk', received_at: '2026-08-05T10:00:00.000Z' })

    const sorted = sortMailboxMessages([trash, junk, sent], state, (message) => message.id === 'junk')
    expect(sorted.map((message) => message.id)).toEqual(['sent', 'trash', 'junk'])
  })

  it('uses the first matching system tag as the message priority bucket', () => {
    const state = buildDefaultMailboxSortState([])
    state.order = ['group:system', 'date', 'group:user']
    state.systemTags = [
      { id: buildSystemSortId('sent'), mode: 'sort' },
      { id: buildSystemSortId('unread'), mode: 'sort' },
      { id: buildSystemSortId('trash'), mode: 'sort' },
      { id: buildSystemSortId('junk'), mode: 'sort' },
      { id: buildSystemSortId('archived'), mode: 'sort' },
      { id: buildSystemSortId('attachments'), mode: 'sort' },
      { id: buildSystemSortId('draft'), mode: 'sort' },
    ]

    const sentOlder = makeMessage({ id: 'sent-older', received_at: '2026-07-01T10:00:00.000Z', is_provider_sent: true })
    const sentUnreadNewer = makeMessage({
      id: 'sent-unread-newer',
      received_at: '2026-08-07T10:00:00.000Z',
      is_provider_sent: true,
      is_read: false,
    })
    const unreadNewest = makeMessage({ id: 'unread-newest', received_at: '2026-08-08T10:00:00.000Z', is_read: false })

    const sorted = sortMailboxMessages([unreadNewest, sentOlder, sentUnreadNewer], state, noJunk)
    expect(sorted.map((message) => message.id)).toEqual(['sent-unread-newer', 'sent-older', 'unread-newest'])
  })

  it('skips hidden tags when building the sort priority', () => {
    let state = buildDefaultMailboxSortState([])
    state.order = ['group:system', 'date', 'group:user']
    state = withTagMode(state, buildSystemSortId('unread'), 'hide')

    const sorted = sortMailboxMessages([older, newer], state, noJunk)
    expect(sorted.map((message) => message.id)).toEqual(['newer', 'older'])
  })

  it('ignores date entirely when date sorting is switched off', () => {
    const state = { ...buildDefaultMailboxSortState([]), dateEnabled: false }
    const sorted = sortMailboxMessages([newer, older], state, noJunk)
    expect(sorted.map((message) => message.id)).toEqual(['older', 'newer'])
  })

  it('ranks custom tags by their position once the custom block outranks date', () => {
    const state = buildDefaultMailboxSortState(['tag-a'])
    state.order = ['group:user', 'date', 'group:system']

    const tagged = makeMessage({ id: 'tagged', received_at: '2026-07-01T10:00:00.000Z', user_tag_ids: ['tag-a'] })
    const sorted = sortMailboxMessages([newer, tagged], state, noJunk)

    expect(sorted.map((message) => message.id)).toEqual(['tagged', 'newer'])
  })

  it('pushes messages without a usable timestamp to the end', () => {
    const undated = makeMessage({ id: 'undated', received_at: null })
    const sorted = sortMailboxMessages([undated, newer], buildDefaultMailboxSortState([]), noJunk)
    expect(sorted.map((message) => message.id)).toEqual(['newer', 'undated'])
  })
})
