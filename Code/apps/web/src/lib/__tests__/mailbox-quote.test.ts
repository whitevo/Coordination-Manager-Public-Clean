import { describe, it, expect } from 'vitest'
import { recoverGmailPlainTextAlternative, splitQuotedBody } from '../mailbox-quote'

describe('recoverGmailPlainTextAlternative', () => {
  it('recovers an already-synced plain plus HTML double body without changing its quote formatting', () => {
    const plain = 'Thanks!\n\nOn Monday, Ada wrote:\n> Hello\n> there'
    const html = '<p>Thanks!</p><div>On Monday, Ada wrote:</div><blockquote>Hello<br>there</blockquote>'
    const derived = 'Thanks!\n\nOn Monday, Ada wrote:\nHello\nthere'
    expect(recoverGmailPlainTextAlternative(`${plain}\n\n${derived}`, html)).toBe(plain)
  })

  it('recovers a double body without quotes and ignores non-content HTML styles', () => {
    expect(recoverGmailPlainTextAlternative(
      'Hello & goodbye\n\nHello & goodbye',
      '<html><head><style>p { color: red }</style></head><body><p>Hello &amp; goodbye</p></body></html>'
    )).toBe('Hello & goodbye')
  })

  it('preserves repeated text without corroborating HTML or a separate MIME-body boundary', () => {
    expect(recoverGmailPlainTextAlternative('Hello\n\nHello', null)).toBe('Hello\n\nHello')
    expect(recoverGmailPlainTextAlternative('Hello\n\nHello', '<p>Other content</p>')).toBe('Hello\n\nHello')
    expect(recoverGmailPlainTextAlternative('Hello Hello', '<p>Hello</p>')).toBe('Hello Hello')
  })

  it('does not truncate different content appended after a matching body', () => {
    const text = 'Hello\n\nHello\n\nAdditional response'
    expect(recoverGmailPlainTextAlternative(text, '<p>Hello</p>')).toBe(text)
  })

  it('preserves a normal single body and empty HTML', () => {
    expect(recoverGmailPlainTextAlternative('Hello', '<p>Hello</p>')).toBe('Hello')
    expect(recoverGmailPlainTextAlternative('Hello\n\nHello', '<p></p>')).toBe('Hello\n\nHello')
  })

  it('normalizes CRLF and handles nested quote prefixes in the verified double body', () => {
    const plain = 'Reply\r\n\r\n>> Earlier'
    expect(recoverGmailPlainTextAlternative(
      `${plain}\r\n\r\nReply\r\n\r\nEarlier`,
      '<p>Reply</p><blockquote>Earlier</blockquote>'
    )).toBe('Reply\n\n>> Earlier')
  })
})

describe('splitQuotedBody', () => {
  it('returns the whole body when there is no quote', () => {
    const result = splitQuotedBody('Hello\n\nThanks')
    expect(result.body).toBe('Hello\n\nThanks')
    expect(result.quoted).toBe('')
  })

  it('splits on a > quoted run', () => {
    const result = splitQuotedBody('Thanks!\n\n> old line\n> another')
    expect(result.body).toBe('Thanks!')
    expect(result.quoted).toBe('> old line\n> another')
  })

  it('splits on an attribution line followed by content', () => {
    const result = splitQuotedBody('Sure.\n\nOn 2026-09-01 10:30 UTC, Ada wrote:\nprevious text')
    expect(result.body).toBe('Sure.')
    expect(result.quoted).toContain('previous text')
  })

  it('splits on a forwarded message separator', () => {
    const result = splitQuotedBody('FYI\n\n---------- Forwarded message ----------\nFrom: a@b.c')
    expect(result.body).toBe('FYI')
    expect(result.quoted).toContain('From: a@b.c')
  })

  it('ignores a trailing attribution with nothing beneath it', () => {
    const text = 'Hello\n\nOn Monday, Ada wrote:'
    expect(splitQuotedBody(text).quoted).toBe('')
  })

  it('normalizes CRLF before splitting', () => {
    const result = splitQuotedBody('Hi\r\n\r\n> quoted')
    expect(result.body).toBe('Hi')
    expect(result.quoted).toBe('> quoted')
  })

  it('handles a body that is entirely quoted', () => {
    const result = splitQuotedBody('> only quote')
    expect(result.body).toBe('')
    expect(result.quoted).toBe('> only quote')
  })
})
