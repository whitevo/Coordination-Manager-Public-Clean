/**
 * Splits a plain-text email body into the newly written part and the quoted
 * history below it, so the viewer can render the history collapsed.
 *
 * Detection is intentionally conservative: only a run of `>` lines, or a
 * recognized attribution line ("On ... wrote:", "-----Original Message-----",
 * "---------- Forwarded message ----------") that is followed by more content,
 * starts the quoted section. Anything ambiguous stays in the visible body.
 */

const ATTRIBUTION_PATTERNS: RegExp[] = [
  /^On\s.+\bwrote:\s*$/i,
  /^-{2,}\s*Original Message\s*-{2,}\s*$/i,
  /^-{2,}\s*Forwarded message\s*-{2,}\s*$/i,
  /^_{5,}\s*$/,
]

export interface SplitBody {
  body: string
  quoted: string
}

/**
 * Older Gmail syncs appended HTML-derived text to its plain-text alternative.
 * Only recover that exact two-copy pattern, corroborated by the stored HTML.
 * This is a display projection; the stored source is never modified.
 */
export function recoverGmailPlainTextAlternative(text: string, html: string | null): string {
  if (!html || typeof DOMParser === 'undefined') return text
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('style, script, head').forEach(node => node.remove())
  const htmlText = (doc.body.textContent || '').replace(/\s/g, '')
  if (!htmlText) return text

  const normalized = text.replace(/\r\n?/g, '\n')
  const withoutQuotePrefixes = normalized.replace(/^[ \t]*>+[ \t]?/gm, prefix => ' '.repeat(prefix.length))
  const comparable = withoutQuotePrefixes.replace(/\s/g, '')
  if (comparable !== htmlText + htmlText) return text

  let contentChars = 0
  for (let index = 0; index < withoutQuotePrefixes.length; index++) {
    if (/\s/.test(withoutQuotePrefixes[index])) continue
    contentChars++
    if (contentChars === htmlText.length) {
      const remainder = normalized.slice(index + 1)
      if (!/^[ \t]*\n[ \t]*\n/.test(remainder)) return text
      return normalized.slice(0, index + 1)
    }
  }
  return text
}

function isQuoteStart(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.startsWith('>')) return true
  return ATTRIBUTION_PATTERNS.some((pattern) => pattern.test(trimmed))
}

export function splitQuotedBody(text: string): SplitBody {
  const normalized = text.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')

  const startIndex = lines.findIndex((line) => isQuoteStart(line))
  if (startIndex === -1) return { body: normalized, quoted: '' }

  const quoted = lines.slice(startIndex).join('\n').trim()
  if (!quoted) return { body: normalized, quoted: '' }

  // A trailing attribution with nothing under it is not a real quote.
  const remainder = lines.slice(startIndex + 1).join('').trim()
  if (!lines[startIndex].trim().startsWith('>') && !remainder) {
    return { body: normalized, quoted: '' }
  }

  return { body: lines.slice(0, startIndex).join('\n').trimEnd(), quoted }
}
