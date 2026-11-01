import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MailboxMassActionsPanel } from '../../components/MailboxMassActionsPanel'
import {
  buildTrustedEmailSrcDoc,
  collapseQuotedEmailHtml,
  getInvitationAddActionState,
  getInvitationMetaBadges,
  getMailboxConfirmationSettingState,
  isMailboxMessageJunk,
  isoToLocalDateTimeParts,
  localDateTimeToIso,
  requiresMailboxReconnect,
  projectMailboxActions,
  readMailboxBulkOutcomes,
  reconcileMailboxBulkOutcomes,
} from '../mailbox-page-helpers'

describe('mailbox local action projection', () => {
  it('reconciles exact applied effects without overwriting newer fields or uncertain tags', () => {
    const actions = [{ action: 'trash', value: '' }, { action: 'add_tag', value: 'auto-delete' }]
    const original = { id: 'a', is_provider_trashed: false, is_archived: false, is_read: false, user_tag_ids: [] as string[] }
    const unavailable = { ...original, id: 'b' }
    const outcomes = readMailboxBulkOutcomes({ contract_version: 1, results: [
      { message_id: 'a', actions: [
        { action_index: 0, ...actions[0], status: 'applied' },
        { action_index: 1, ...actions[1], status: 'uncertain' },
      ] },
      { message_id: 'b', actions: actions.map((action, action_index) => ({ action_index, ...action, status: 'unavailable' })) },
    ] }, actions, ['a', 'b'])
    expect(outcomes).not.toBeNull()
    expect(reconcileMailboxBulkOutcomes([
      { ...original, is_read: true, user_tag_ids: ['auto-delete'] },
      { ...unavailable, user_tag_ids: ['auto-delete'] },
    ], [original, unavailable], actions, outcomes!)).toEqual([
      { ...original, is_provider_trashed: true, is_read: true, user_tag_ids: ['auto-delete'] },
      unavailable,
    ])
  })

  it('rejects legacy, malformed, duplicate, or mismatched outcomes for safe refresh fallback', () => {
    const actions = [{ action: 'trash', value: '' }]
    expect(readMailboxBulkOutcomes({ applied: 1 }, actions, ['a'])).toBeNull()
    const result = { message_id: 'a', actions: [{ action_index: 0, action: 'trash', value: '', status: 'applied' }] }
    expect(readMailboxBulkOutcomes({ contract_version: 1, results: [result, result] }, actions, ['a'])).toBeNull()
    expect(readMailboxBulkOutcomes({ contract_version: 1, results: [result] }, actions, ['a', 'b'])).toBeNull()
    expect(readMailboxBulkOutcomes({ contract_version: 1, results: [result] }, [{ action: 'archive', value: '' }], ['a'])).toBeNull()
  })

  it('applies trash and tags in order without losing the trash category', () => {
    expect(projectMailboxActions({
      id: 'a', is_provider_trashed: false, is_archived: false, is_read: false, user_tag_ids: [],
    }, [{ action: 'trash', value: '' }, { action: 'add_tag', value: 'auto-delete' }]))
      .toEqual({ id: 'a', is_provider_trashed: true, is_archived: false, is_read: false, user_tag_ids: ['auto-delete'] })
  })
})

describe('bulk action outcome feedback', () => {
  afterEach(cleanup)
  const props = {
    isOpen: true, onToggle: vi.fn(), tags: [], visibleCount: 1, canCascade: false,
    isApplying: false, error: null, onApply: vi.fn(), onRequestCreateTag: vi.fn(),
  }

  it('distinguishes an uncertain action from a confirmed rejection and bookkeeping warnings', () => {
    render(<MailboxMassActionsPanel {...props} result={{
      processed_messages: 1, applied: 1, failed: 1, errors: [], contract_version: 1,
      results: [{ message_id: 'a', actions: [
        { action_index: 0, action: 'mark_read', value: '', status: 'applied' },
        { action_index: 1, action: 'trash', value: '', status: 'uncertain' },
      ] }],
      warnings: [{ code: 'ACTION_EVENT_NOT_RECORDED' }],
    }} />)
    expect(screen.getByText(/1 need verification/).textContent).not.toContain('failed')
    expect(screen.getByText(/Completed actions have not been rolled back/).textContent).toContain('follow-up rules')
  })

  it('keeps legacy aggregate-only results readable', () => {
    render(<MailboxMassActionsPanel {...props} result={{ processed_messages: 1, applied: 0, failed: 1, errors: [] }} />)
    expect(screen.getByText(/1 failed/)).toBeTruthy()
  })
})

describe('requiresMailboxReconnect', () => {
  it('identifies classified and legacy OAuth failures', () => {
    expect(requiresMailboxReconnect({ status: 'error', sync_error: null, sync_error_kind: 'auth' })).toBe(true)
    expect(requiresMailboxReconnect({ status: 'error', sync_error: 'Account access expired or revoked. Please reconnect your email account.' })).toBe(true)
  })

  it('does not treat transient or connected accounts as reconnect-required', () => {
    expect(requiresMailboxReconnect({ status: 'error', sync_error: 'Provider rate limit reached', sync_error_kind: 'transient' })).toBe(false)
    expect(requiresMailboxReconnect({ status: 'connected', sync_error: 'expired', sync_error_kind: 'auth' })).toBe(false)
  })
})

describe('getInvitationMetaBadges', () => {
  it('adds a deleted-source badge when the original email was trashed', () => {
    const badges = getInvitationMetaBadges({
      source_email: 'alice@example.com',
      source_deleted: true,
      status: 'proposed',
    })

    expect(badges).toContainEqual({ key: 'source-deleted', label: 'Deleted in Gmail' })
  })
})

describe('getInvitationAddActionState', () => {
  it('keeps the add action available when the invitation is already imported elsewhere', () => {
    const target = {
      id: 'invite-1',
      message_id: 'msg-1',
      summary: 'Planning sync',
      location: 'https://example.com/meet',
      organizer: 'Alice',
      starts_at: '2026-08-10T10:00:00.000Z',
      ends_at: '2026-08-10T11:00:00.000Z',
      status: 'proposed',
      uid: 'uid-1',
    }

    const invitations = [{
      ...target,
      status: 'imported',
      provider_event_ref: 'evt-1',
    }]

    const state = getInvitationAddActionState(target, invitations)

    expect(state.alreadyAdded).toBe(true)
    expect(state.disabled).toBe(false)
    expect(state.label).toBe('Add to another calendar')
  })
})

describe('getMailboxConfirmationSettingState', () => {
  it('reports when confirmation prompts have been suppressed and exposes a restore action', () => {
    const state = getMailboxConfirmationSettingState(2)

    expect(state.active).toBe(true)
    expect(state.label).toBe('Prompt suppression active')
    expect(state.buttonLabel).toBe('Restore confirmation prompts')
  })
})

describe('invitation picker wall-clock round-trip', () => {
  // Regression: an invite for Tue Sep 8 2026 01:30 EEST (Europe/Tallinn) is stored
  // as 2026-09-07T22:30:00.000Z. The picker must prefill and convert back in the
  // same timezone so the instant is preserved. When the editing timezone defaulted
  // to UTC, users saw 22:30, "corrected" it to the Tallinn wall time, and the
  // Google event landed 3 hours late.
  it('preserves the instant across the Europe/Tallinn round-trip', () => {
    const startIso = '2026-09-07T22:30:00.000Z'
    const parts = isoToLocalDateTimeParts(startIso, 'Europe/Tallinn')

    expect(parts).toEqual({ date: '2026-09-08', time: '01:30' })
    expect(localDateTimeToIso(parts.date, parts.time, 'Europe/Tallinn')).toBe(startIso)
  })
})

describe('isMailboxMessageJunk', () => {
  it('treats provider spam or junk as junk even when the sender list is empty', () => {
    expect(isMailboxMessageJunk({ from_email: 'alerts@example.com', is_provider_junk: true }, new Set())).toBe(true)
  })

  it('still treats saved sender and domain entries as junk', () => {
    expect(isMailboxMessageJunk({ from_email: 'alerts@example.com' }, new Set(['example.com']))).toBe(true)
    expect(isMailboxMessageJunk({ from_email: 'alerts@example.com' }, new Set(['alerts@example.com']))).toBe(true)
  })
})

describe('buildTrustedEmailSrcDoc', () => {
  it('preserves sender text and background styles as a pair', () => {
    const srcDoc = buildTrustedEmailSrcDoc([
      '<style>.secondary-text { color: #70757a !important; background: #ffffff; }</style>',
      '<p class="secondary-text">Calendar invitation</p>',
    ].join(''))

    expect(srcDoc).toContain('.secondary-text { color: #70757a !important; background: #ffffff; }')
    expect(srcDoc).toContain('<p class="secondary-text">Calendar invitation</p>')
    expect(srcDoc).toContain('body { color: #111827; }')
  })

  it('keeps @media rules so responsive layout (e.g. mobile-width tables, icon show/hide) survives', () => {
    const srcDoc = buildTrustedEmailSrcDoc([
      '<style>.plain-color { color: red; }',
      '@media (max-width: 512px) { .mercado-container { width: 100% !important; } }',
      '@media (max-width: 480px) { .inline-button { display: none !important; } }</style>',
      '<table class="mercado-container" width="512"><tr><td class="inline-button">Icon</td></tr></table>',
    ].join(''))

    expect(srcDoc).toContain('.plain-color { color: red; }')
    expect(srcDoc).toContain('@media (max-width: 512px)')
    expect(srcDoc).toContain('.mercado-container { width: 100% !important; }')
    expect(srcDoc).toContain('@media (max-width: 480px)')
    expect(srcDoc).toContain('.inline-button { display: none !important; }')
  })

  it('pins Google invitation color queries to light without dropping responsive conditions', () => {
    const srcDoc = buildTrustedEmailSrcDoc([
      '<style>',
      '.primary-text { color: #3c4043; }',
      '@media (prefers-color-scheme: dark) { .primary-text { color: #e8eaed; } }',
      '@media screen and (prefers-color-scheme: light) and (max-width: 600px) { .card { background: white; } }',
      '</style><p class="primary-text">When</p>',
    ].join(''))

    expect(srcDoc).toContain('.primary-text { color: #3c4043; }')
    expect(srcDoc).toContain('@media (not (min-width: 0px))')
    expect(srcDoc).toContain('@media screen and (min-width: 0px) and (max-width: 600px)')
    expect(srcDoc).not.toContain('prefers-color-scheme:')
    expect(srcDoc).toContain('html { color-scheme: light; }')
  })

  it('preserves style media attributes and handles mixed-case and negated color queries', () => {
    const srcDoc = buildTrustedEmailSrcDoc([
      '<style media="screen and (Prefers-Color-Scheme: DARK)">.primary-text { color: white; }</style>',
      '<style media="print">.card { border: none; }</style>',
      '<style>@media not all and (prefers-color-scheme: dark), (max-width: 480px) { .card { width: 100%; } }</style>',
    ].join(''))

    expect(srcDoc).toContain('@media screen and (not (min-width: 0px))')
    expect(srcDoc).toContain('@media print {.card { border: none; }}')
    expect(srcDoc).toContain('@media not all and (not (min-width: 0px)), (max-width: 480px)')
  })
})

describe('collapseQuotedEmailHtml', () => {
  it('wraps a Thunderbird cite prefix and its blockquote in a collapsed details', () => {
    const result = collapseQuotedEmailHtml(
      [
        '<p>My reply</p>',
        '<div class="moz-cite-prefix">On 31/08/2026 14:34, Contact Person wrote:</div>',
        '<blockquote>Older text</blockquote>',
      ].join('')
    )

    expect(result).toContain('<details class="cm-quote">')
    expect(result).not.toContain('<details class="cm-quote" open>')
    expect(result).toContain('<p>My reply</p>')
    expect(result.indexOf('My reply')).toBeLessThan(result.indexOf('<details'))
    expect(result).toContain('Older text')
  })

  it('collapses a Gmail quote block', () => {
    const result = collapseQuotedEmailHtml(
      '<div dir="ltr">Thanks</div><div class="gmail_quote"><blockquote>Older</blockquote></div>'
    )
    expect(result).toContain('<details class="cm-quote">')
    expect(result).toContain('Thanks')
  })

  it('collapses a bare attribution paragraph', () => {
    const result = collapseQuotedEmailHtml(
      '<p>Sure thing</p><p>On 31/08/2026 14:34, Ada wrote:</p><p>Older text</p>'
    )
    expect(result).toContain('<details class="cm-quote">')
  })

  it('leaves messages without quoted history untouched', () => {
    const html = '<p>Just a note</p><p>Regards</p>'
    expect(collapseQuotedEmailHtml(html)).toBe(html)
  })

  it('recognizes a nested quote without hiding the authored text in the same wrapper', () => {
    const result = collapseQuotedEmailHtml(
      '<div><div>My reply<div class="gmail_quote">Older text</div>Trailing history</div></div>'
    )
    const doc = new DOMParser().parseFromString(result, 'text/html')
    const details = doc.querySelector('details')
    expect(details?.textContent).toBe('Quoted historyOlder textTrailing history')
    expect(details?.parentElement?.firstChild?.textContent).toBe('My reply')
  })

  it('keeps trailing text nodes inside the quote instead of duplicating them outside', () => {
    const result = collapseQuotedEmailHtml(
      'My reply<div class="moz-cite-prefix">On Monday, Ada wrote:</div><blockquote>Older</blockquote>End of history'
    )
    const doc = new DOMParser().parseFromString(result, 'text/html')
    expect(doc.querySelector('details')?.textContent).toContain('End of history')
    expect(doc.body.lastChild?.nodeName).toBe('DETAILS')
    expect(doc.body.firstChild?.textContent).toBe('My reply')
  })

  it('recognizes Outlook reply headers inside a wrapper', () => {
    const result = collapseQuotedEmailHtml(
      '<div><p>My reply</p><div><div id="divRplyFwdMsg">From: Ada</div><p>Original</p></div></div>'
    )
    const doc = new DOMParser().parseFromString(result, 'text/html')
    expect(doc.querySelector('details')?.textContent).toContain('Original')
    expect(doc.querySelector('details')?.textContent).not.toContain('My reply')
  })

  it('leaves ordinary blockquotes visible without a reply-history marker', () => {
    const html = '<p>Here is a passage:</p><blockquote>Important content</blockquote>'
    expect(collapseQuotedEmailHtml(html)).toBe(html)
  })

  it('does not collapse when the quote is the entire message', () => {
    const html = '<div class="moz-cite-prefix">On 31/08/2026 14:34, Ada wrote:</div><blockquote>Old</blockquote>'
    expect(collapseQuotedEmailHtml(html)).toBe(html)
  })

  it('is applied by the trusted viewer srcDoc', () => {
    const srcDoc = buildTrustedEmailSrcDoc(
      '<p>Hi</p><div class="moz-cite-prefix">On 31/08/2026 14:34, Ada wrote:</div><blockquote>Old</blockquote>'
    )
    expect(srcDoc).toContain('<details class="cm-quote">')
    expect(srcDoc).toContain('details.cm-quote > summary')
  })
})
