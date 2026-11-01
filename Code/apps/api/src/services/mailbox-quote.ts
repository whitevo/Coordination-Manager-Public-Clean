/**
 * Builds the quoted-history block appended to outgoing replies.
 *
 * The user's compose box stays clean -- the quote is generated here at send
 * time so the recipient still has context. The HTML part uses the
 * `gmail_quote` attribution + blockquote structure that Gmail, Outlook and
 * most webmail clients recognize, which is what makes them render the history
 * collapsed behind a "..." expander instead of inline.
 *
 * Only the original plain-text body is quoted, never its HTML: inbound HTML is
 * untrusted, and re-emitting it in our own outgoing message would forward
 * whatever markup a sender embedded.
 */

const MAX_QUOTE_CHARS = 20000

export interface QuoteSource {
  fromName: string | null
  fromEmail: string | null
  sentAt: string | null
  bodyText: string | null
}

export interface ReplyBodies {
  text: string
  html: string
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeLines(value: string): string[] {
  return value.replace(/\r\n?/g, '\n').split('\n')
}

function formatAttributionDate(sentAt: string | null): string {
  if (!sentAt) return ''
  const parsed = new Date(sentAt)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

/** "On <date>, <Name> <addr> wrote:" -- the line clients match to detect a quote. */
export function buildAttributionLine(source: QuoteSource): string {
  const name = (source.fromName || '').trim()
  const email = (source.fromEmail || '').trim()
  const who = name && email ? `${name} <${email}>` : name || email || 'the sender'
  const when = formatAttributionDate(source.sentAt)
  return when ? `On ${when}, ${who} wrote:` : `${who} wrote:`
}

function quoteSourceBody(source: QuoteSource): string {
  const body = (source.bodyText || '').trim()
  if (!body) return '(no message content available)'
  return body.slice(0, MAX_QUOTE_CHARS)
}

/** Converts the author's plain-text draft into a safe HTML paragraph block. */
function bodyTextToHtml(bodyText: string): string {
  return normalizeLines(bodyText)
    .map((line) => escapeHtml(line))
    .join('<br>')
}

/**
 * Combines the author's draft text with a quoted copy of the message being
 * replied to, returning matched plain-text and HTML alternatives.
 */
export function buildReplyBodies(bodyText: string, source: QuoteSource | null): ReplyBodies {
  const authored = bodyText.replace(/\r\n?/g, '\n')

  if (!source) {
    return { text: authored, html: `<div dir="ltr">${bodyTextToHtml(authored)}</div>` }
  }

  const attribution = buildAttributionLine(source)
  const quotedLines = normalizeLines(quoteSourceBody(source))

  const text = [
    authored.trimEnd(),
    '',
    attribution,
    ...quotedLines.map((line) => (line ? `> ${line}` : '>')),
  ].join('\n')

  const html = [
    `<div dir="ltr">${bodyTextToHtml(authored)}</div>`,
    '<div class="gmail_quote">',
    `<div dir="ltr" class="gmail_attr">${escapeHtml(attribution)}<br></div>`,
    '<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">',
    `<div dir="ltr">${quotedLines.map((line) => escapeHtml(line)).join('<br>')}</div>`,
    '</blockquote>',
    '</div>',
  ].join('')

  return { text, html }
}
