import { afterEach, describe, expect, it, vi } from 'vitest'
import { __testUtils, buildSyncedProviderMetadata, isMailboxTimestampWithinDaysBack, isProviderMessageJunk, sanitizeEmailHtml } from '../mailbox-provider-sync.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('provider Junk state shared by import triggers and message projections', () => {
  it.each([
    { provider: 'gmail' as const, metadata: { provider_junk: true }, junk: true },
    { provider: 'outlook' as const, metadata: { provider_junk: true }, junk: true },
    { provider: 'gmail' as const, metadata: { provider_message: { labelIds: ['SPAM'] } }, junk: true },
    { provider: 'outlook' as const, metadata: { provider_message: { provider_folder: 'junk' } }, junk: true },
    { provider: 'gmail' as const, metadata: { provider_message: { labelIds: ['INBOX'] } }, junk: false },
    { provider: 'outlook' as const, metadata: { provider_message: { provider_folder: 'inbox' } }, junk: false },
    { provider: 'gmail' as const, metadata: null, junk: false },
  ])('recognizes $provider Junk state: $junk', ({ provider, metadata, junk }) => {
    expect(isProviderMessageJunk(provider, metadata)).toBe(junk)
  })
})

describe('extractGmailBodiesFromPart calendar parts', () => {
  it('captures a text/calendar MIME part separately from the visible body', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'text/plain',
          body: { data: Buffer.from('Please join us').toString('base64url') },
        },
        {
          mimeType: 'text/calendar',
          body: { data: Buffer.from('BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:abc\nEND:VEVENT\nEND:VCALENDAR').toString('base64url') },
        },
      ],
    }

    const extracted = __testUtils.extractGmailBodiesFromPart(payload)
    expect(extracted.textParts.join('')).toContain('Please join us')
    expect(extracted.calendarParts.join('')).toContain('BEGIN:VCALENDAR')
    expect(extracted.calendarParts.join('')).toContain('UID:abc')
  })
})

describe('extractGmailBodiesFromPart MIME alternatives', () => {
  const part = (mimeType: string, text: string) => ({
    mimeType,
    body: { data: Buffer.from(text).toString('base64url') },
  })

  it('uses plain text once while retaining its HTML alternative', () => {
    const html = '<p>Thanks!</p><div class="moz-cite-prefix">On Monday, Ada wrote:</div><blockquote>Original</blockquote>'
    const plain = 'Thanks!\n\nOn Monday, Ada wrote:\n> Original'
    const result = __testUtils.extractGmailBodiesFromPart({
      mimeType: 'multipart/alternative',
      parts: [part('text/plain', plain), part('text/html', html)],
    })
    expect(result.textParts).toEqual([plain])
    expect(result.htmlParts).toEqual([html])
  })

  it('prefers plain text regardless of alternative order and nested related images', () => {
    const result = __testUtils.extractGmailBodiesFromPart({
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'multipart/related', parts: [part('text/html', '<p>Hello</p>'), part('image/png', 'image')] },
        part('text/plain', 'Hello'),
      ],
    })
    expect(result.textParts).toEqual(['Hello'])
    expect(result.htmlParts).toEqual(['<p>Hello</p>'])
  })

  it('falls back to HTML-derived text when the plain alternative is empty', () => {
    const result = __testUtils.extractGmailBodiesFromPart({
      mimeType: 'multipart/alternative',
      parts: [part('text/plain', '  '), part('text/html', '<p>Hello</p>')],
    })
    expect(result.textParts).toEqual(['Hello'])
  })

  it('preserves separate mixed body parts and calendar alternatives', () => {
    const result = __testUtils.extractGmailBodiesFromPart({
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            part('text/plain', 'Hello'),
            part('text/html', '<p>Hello</p>'),
            part('text/calendar', 'BEGIN:VCALENDAR\nEND:VCALENDAR'),
          ],
        },
        part('text/html', '<p>Separate content</p>'),
        part('text/plain', 'Final note'),
      ],
    })
    expect(result.textParts).toEqual(['Hello', 'Separate content', 'Final note'])
    expect(result.calendarParts).toEqual(['BEGIN:VCALENDAR\nEND:VCALENDAR'])
  })

  it('keeps only one HTML representation when several alternatives are supplied', () => {
    const result = __testUtils.extractGmailBodiesFromPart({
      mimeType: 'multipart/alternative',
      parts: [part('text/html', '<p>First</p>'), part('text/html', '<p>Last</p>')],
    })
    expect(result.htmlParts).toEqual(['<p>Last</p>'])
    expect(result.textParts).toEqual(['Last'])
  })
})

describe('resolveGmailCidImages', () => {
  it('rewrites an inline image whose bytes are already in the payload (no fetch needed)', async () => {
    const payload = {
      mimeType: 'multipart/related',
      parts: [
        {
          mimeType: 'image/png',
          headers: [{ name: 'Content-Id', value: '<logo123>' }],
          body: { data: Buffer.from('fake-png-bytes').toString('base64url') },
        },
      ],
    }
    const html = '<img src="cid:logo123">'

    const resolved = await __testUtils.resolveGmailCidImages(html, payload, 'token', 'msg-1')
    expect(resolved).toContain('data:image/png;base64,')
    expect(resolved).not.toContain('cid:')
  })

  it('fetches large inline images referenced only by attachmentId', async () => {
    const payload = {
      mimeType: 'multipart/related',
      parts: [
        {
          mimeType: 'image/png',
          headers: [{ name: 'Content-Id', value: '<logo456>' }],
          body: { attachmentId: 'att-1' },
        },
      ],
    }
    const html = '<img src="cid:logo456">'

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: Buffer.from('big-png-bytes').toString('base64url') }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const resolved = await __testUtils.resolveGmailCidImages(html, payload, 'token', 'msg-1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(resolved).toContain('data:image/png;base64,')
  })

  it('drops an unresolvable cid reference instead of leaving a broken image', async () => {
    const payload = { mimeType: 'text/plain', body: {} }
    const html = '<p>Hi</p><img src="cid:unknown">'

    const resolved = await __testUtils.resolveGmailCidImages(html, payload, 'token', 'msg-1')
    expect(resolved).not.toContain('cid:')
    expect(resolved).not.toContain('<img')
    expect(resolved).toContain('<p>Hi</p>')
  })

  it('leaves html unchanged when there is no cid: reference', async () => {
    const html = '<p>No images here</p>'
    const resolved = await __testUtils.resolveGmailCidImages(html, { mimeType: 'text/plain', body: {} }, 'token', 'msg-1')
    expect(resolved).toBe(html)
  })
})

describe('sanitizeEmailHtml', () => {
  it('preserves semantic formatting used by Outlook HTML messages', () => {
    const sanitized = sanitizeEmailHtml([
      '<p><strong>1. Sign in</strong> at <a href="https://example.com">example.com</a></p>',
      '<ul><li><em>Keep this selected</em></li></ul>',
      '<blockquote><p>Previous message</p></blockquote>',
    ].join(''))

    expect(sanitized).toContain('<strong>1. Sign in</strong>')
    expect(sanitized).toContain('<a href="https://example.com"')
    expect(sanitized).toContain('<ul><li><em>Keep this selected</em></li></ul>')
    expect(sanitized).toContain('<blockquote><p>Previous message</p></blockquote>')
  })

  it('preserves style blocks (rendered only in a sandboxed iframe) without console warnings', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const sanitized = sanitizeEmailHtml([
      '<html>',
      '<head><style>body{background:red}</style></head>',
      '<body><p style="color: blue">Hello</p></body>',
      '</html>',
    ].join(''))

    expect(sanitized).toContain('<style>body{background:red}</style>')
    expect(sanitized).toContain('<p style="color:blue">Hello</p>')
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('allowedTags'))
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('style'))
  })

  it('still strips script tags', () => {
    const sanitized = sanitizeEmailHtml('<p>Hi</p><script>alert(1)</script>')
    expect(sanitized).not.toContain('<script')
    expect(sanitized).not.toContain('alert(1)')
  })
})

describe('isMailboxTimestampWithinDaysBack', () => {
  const nowMs = new Date('2026-08-21T12:00:00.000Z').getTime()

  it('keeps messages inside the configured history window', () => {
    expect(isMailboxTimestampWithinDaysBack('2026-08-01T12:00:00.000Z', 30, nowMs)).toBe(true)
  })

  it('drops messages older than the configured history window', () => {
    expect(isMailboxTimestampWithinDaysBack('2024-08-01T12:00:00.000Z', 30, nowMs)).toBe(false)
  })

  it('keeps messages with unknown timestamps rather than risking data loss', () => {
    expect(isMailboxTimestampWithinDaysBack(null, 30, nowMs)).toBe(true)
    expect(isMailboxTimestampWithinDaysBack('not-a-date', 30, nowMs)).toBe(true)
  })
})

describe('buildSyncedProviderMetadata', () => {
  const projection = {
    providerSent: false,
    providerTrashed: true,
    providerJunk: false,
    providerArchived: false,
    raw: { id: 'gmail-1', labelIds: ['TRASH'] },
  }

  // Regression: an automation rule that trashes a message changes it provider-side,
  // so the next delta sync re-fetched it and rebuilt provider_metadata without the
  // tag the same rule had just applied.
  it('preserves mailbox tags applied by automation or the user', () => {
    const metadata = buildSyncedProviderMetadata('user-1', projection, {
      user_id: 'user-1',
      user_tag_ids: ['tag-assess-delete'],
      provider_trashed: false,
    })

    expect(metadata.user_tag_ids).toEqual(['tag-assess-delete'])
    expect(metadata.provider_trashed).toBe(true)
    expect(metadata.provider_archived).toBe(false)
    expect(metadata.provider_message).toEqual(projection.raw)
  })

  it('omits the tag list entirely when the message has no tags', () => {
    expect(buildSyncedProviderMetadata('user-1', projection, null)).not.toHaveProperty('user_tag_ids')
    expect(buildSyncedProviderMetadata('user-1', projection, { user_tag_ids: [] })).not.toHaveProperty('user_tag_ids')
  })

  it('drops non-string entries from stored tag ids', () => {
    const metadata = buildSyncedProviderMetadata('user-1', projection, { user_tag_ids: ['tag-1', 42, null] })
    expect(metadata.user_tag_ids).toEqual(['tag-1'])
  })

  it('ignores unusable stored metadata', () => {
    expect(buildSyncedProviderMetadata('user-1', projection, 'not-an-object')).not.toHaveProperty('user_tag_ids')
    expect(buildSyncedProviderMetadata('user-1', projection, { user_tag_ids: 'tag-1' })).not.toHaveProperty('user_tag_ids')
  })
})

describe('provider metadata tag event reconciliation', () => {
  it('replays tag add and remove events onto the synced tag list', () => {
    const tagA = '981d2127-97cc-4e59-a87c-b74bda9b1775'
    const tagB = '8f004dbd-789c-41fd-8111-b5243cf67daf'

    const tagIds = __testUtils.applyTagActionEventsToTagIds([], [
      { message_id: 'message-1', action: 'add_tag', action_value: tagA },
      { message_id: 'message-1', action: 'add_tag', action_value: tagB },
      { message_id: 'message-1', action: 'remove_tag', action_value: tagA },
    ])

    expect(tagIds).toEqual([tagB])
  })

  it('writes the reconciled tag ids without dropping provider state', () => {
    const metadata = __testUtils.setUserTagIdsInProviderMetadata(
      { provider_trashed: true, provider_message: { labelIds: ['TRASH'] } },
      ['981d2127-97cc-4e59-a87c-b74bda9b1775'],
    )

    expect(metadata).toMatchObject({
      provider_trashed: true,
      provider_message: { labelIds: ['TRASH'] },
      user_tag_ids: ['981d2127-97cc-4e59-a87c-b74bda9b1775'],
    })
  })
})

describe('selectContinuationCursor', () => {
  it('keeps each account continuation token for wide history imports', () => {
    expect(__testUtils.selectContinuationCursor('gmail-account-a-page-2', null, false)).toBe(
      'gmail-account-a-page-2',
    )
    expect(__testUtils.selectContinuationCursor('gmail-account-b-page-7', null, false)).toBe(
      'gmail-account-b-page-7',
    )
  })

  it('bypasses continuation only for new-mail checks or rejected cursors', () => {
    expect(__testUtils.selectContinuationCursor('page-2', null, true)).toBeNull()
    expect(__testUtils.selectContinuationCursor('page-2', 'Invalid page token', false)).toBeNull()
  })
})

describe('buildOutlookFolderMessagesUrl', () => {
  it('requests the newest provider page without a cross-folder timestamp filter', () => {
    const url = new URL(__testUtils.buildOutlookFolderMessagesUrl('inbox', 25))

    expect(url.searchParams.get('$top')).toBe('25')
    expect(url.searchParams.get('$orderby')).toBe('receivedDateTime desc')
    expect(url.searchParams.has('$filter')).toBe(false)
  })
})