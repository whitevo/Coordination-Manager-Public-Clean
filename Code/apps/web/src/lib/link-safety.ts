/**
 * Client-side link display safety for the Trusted HTML mailbox viewer.
 *
 * Never unicode-decodes a hostname: punycode ("xn--...") is shown as-is,
 * because decoding it back to Unicode is exactly what would let a lookalike
 * domain render as if it were the brand it is impersonating.
 */

export interface LinkDisplayInfo {
  /** ASCII/punycode hostname exactly as the browser would navigate to. */
  hostname: string
  isPunycode: boolean
}

const SAFE_PROTOCOLS = new Set(['http:', 'https:'])

/** Parses an anchor href for display purposes only; returns null for non-http(s) or unparseable links. */
export function analyzeLinkHref(href: string): LinkDisplayInfo | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (!SAFE_PROTOCOLS.has(url.protocol)) return null

  return {
    hostname: url.hostname,
    isPunycode: url.hostname.split('.').some((label) => label.startsWith('xn--')),
  }
}

const DOMAIN_LOOKALIKE_RE = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}\b/gi

/**
 * True when the anchor's visible text itself claims a domain (e.g. link text reads
 * "microsoft.com") that differs from where the link actually points -- the classic
 * phishing trick of showing one destination and linking to another.
 */
export function textClaimsDifferentDomain(visibleText: string, actualHostname: string): boolean {
  const claimed = visibleText.match(DOMAIN_LOOKALIKE_RE)
  if (!claimed) return false

  const normalizedActual = actualHostname.toLowerCase()
  return claimed.some((candidate) => {
    const normalizedCandidate = candidate.toLowerCase().replace(/\.$/, '')
    if (normalizedCandidate === normalizedActual) return false
    // A claimed parent domain of the real host (e.g. text says "example.com", href is "mail.example.com") is not a mismatch.
    if (normalizedActual.endsWith(`.${normalizedCandidate}`)) return false
    return true
  })
}

/**
 * Rewrites every http(s) link in sanitized email HTML so the real destination hostname
 * is always discoverable (native title tooltip) and, when the link text claims a
 * different domain or uses punycode, adds a visible warning badge right next to it --
 * no JavaScript required, so this works inside a script-disabled sandboxed iframe.
 */
export function annotateEmailLinksWithRealDomain(html: string): string {
  if (typeof document === 'undefined' || !html) return html

  const container = document.createElement('div')
  container.innerHTML = html

  const anchors = Array.from(container.querySelectorAll('a[href]'))
  for (const anchor of anchors) {
    const href = anchor.getAttribute('href') || ''
    const info = analyzeLinkHref(href)
    if (!info) continue

    const visibleText = anchor.textContent || ''
    const mismatch = textClaimsDifferentDomain(visibleText, info.hostname)
    const suspicious = mismatch || info.isPunycode

    anchor.setAttribute('title', `Goes to: ${info.hostname}`)

    if (suspicious) {
      const badge = document.createElement('span')
      badge.className = 'cm-link-domain-warn'
      badge.textContent = `\u26A0 actually goes to: ${info.hostname}`
      anchor.insertAdjacentElement('afterend', badge)
    }
  }

  return container.innerHTML
}
