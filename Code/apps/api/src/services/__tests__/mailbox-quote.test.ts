import { describe, it, expect } from 'vitest'
import { buildAttributionLine, buildReplyBodies, escapeHtml } from '../mailbox-quote.js'

const source = {
  fromName: 'Ada Lovelace',
  fromEmail: 'ada@example.com',
  sentAt: '2026-09-01T10:30:00.000Z',
  bodyText: 'Line one\nLine two',
}

describe('escapeHtml', () => {
  it('escapes markup characters', () => {
    expect(escapeHtml('<b>"x" & \'y\'</b>')).toBe('&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;')
  })
})

describe('buildAttributionLine', () => {
  it('includes date, name and address', () => {
    expect(buildAttributionLine(source)).toBe(
      'On 2026-09-01 10:30 UTC, Ada Lovelace <ada@example.com> wrote:'
    )
  })

  it('falls back when the date is missing or unparseable', () => {
    expect(buildAttributionLine({ ...source, sentAt: 'not-a-date' })).toBe(
      'Ada Lovelace <ada@example.com> wrote:'
    )
  })

  it('falls back when no sender is known', () => {
    expect(buildAttributionLine({ fromName: null, fromEmail: null, sentAt: null, bodyText: null })).toBe(
      'the sender wrote:'
    )
  })
})

describe('buildReplyBodies', () => {
  it('returns the authored body untouched when there is nothing to quote', () => {
    const bodies = buildReplyBodies('Hello there', null)
    expect(bodies.text).toBe('Hello there')
    expect(bodies.html).toBe('<div dir="ltr">Hello there</div>')
  })

  it('appends a plain-text quote with > prefixes', () => {
    const bodies = buildReplyBodies('Thanks!', source)
    expect(bodies.text).toBe(
      ['Thanks!', '', buildAttributionLine(source), '> Line one', '> Line two'].join('\n')
    )
  })

  it('wraps the quote in a gmail_quote blockquote so clients collapse it', () => {
    const bodies = buildReplyBodies('Thanks!', source)
    expect(bodies.html).toContain('<div class="gmail_quote">')
    expect(bodies.html).toContain('class="gmail_attr"')
    expect(bodies.html).toContain('<blockquote class="gmail_quote"')
    expect(bodies.html).toContain('Line one<br>Line two')
  })

  it('escapes untrusted markup from the quoted message', () => {
    const bodies = buildReplyBodies('Hi', {
      ...source,
      bodyText: '<img src=x onerror="alert(1)">',
    })
    expect(bodies.html).not.toContain('<img')
    expect(bodies.html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
  })

  it('escapes markup typed by the author', () => {
    const bodies = buildReplyBodies('<script>bad()</script>', null)
    expect(bodies.html).not.toContain('<script>')
  })

  it('handles a source message with no stored body', () => {
    const bodies = buildReplyBodies('Hi', { ...source, bodyText: null })
    expect(bodies.text).toContain('> (no message content available)')
  })

  it('normalizes CRLF line endings', () => {
    const bodies = buildReplyBodies('a\r\nb', { ...source, bodyText: 'q1\r\nq2' })
    expect(bodies.text).not.toContain('\r')
    expect(bodies.text).toContain('> q1\n> q2')
  })
})
