import { describe, expect, it } from 'vitest'
import {
  analyzeLinkHref,
  annotateEmailLinksWithRealDomain,
  textClaimsDifferentDomain,
} from '../link-safety'

describe('analyzeLinkHref', () => {
  it('reads the real hostname and flags punycode without decoding it', () => {
    expect(analyzeLinkHref('https://sites.google.com/view/microsoft-support')).toEqual({
      hostname: 'sites.google.com',
      isPunycode: false,
    })
    expect(analyzeLinkHref('https://xn--mierosoft-p2a.com/login')).toEqual({
      hostname: 'xn--mierosoft-p2a.com',
      isPunycode: true,
    })
  })

  it('ignores non-http(s) and unparseable links', () => {
    expect(analyzeLinkHref('mailto:someone@example.com')).toBeNull()
    expect(analyzeLinkHref('javascript:alert(1)')).toBeNull()
    expect(analyzeLinkHref('not a url')).toBeNull()
  })
})

describe('textClaimsDifferentDomain', () => {
  it('flags text that names a different domain than the href', () => {
    expect(textClaimsDifferentDomain('Sign in at microsoft.com', 'sites.google.com')).toBe(true)
  })

  it('does not flag matching or parent-domain text', () => {
    expect(textClaimsDifferentDomain('Visit sites.google.com now', 'sites.google.com')).toBe(false)
    expect(textClaimsDifferentDomain('Visit google.com now', 'sites.google.com')).toBe(false)
    expect(textClaimsDifferentDomain('Click here', 'sites.google.com')).toBe(false)
  })
})

describe('annotateEmailLinksWithRealDomain', () => {
  it('adds a hover title with the real hostname on every http(s) link', () => {
    const out = annotateEmailLinksWithRealDomain('<a href="https://example.com/path">Click here</a>')
    expect(out).toContain('title="Goes to: example.com"')
  })

  it('adds a visible warning badge when the link text claims a different domain', () => {
    const out = annotateEmailLinksWithRealDomain(
      '<a href="https://sites.google.com/view/microsoft-support-234">microsoft.com</a>',
    )
    expect(out).toContain('cm-link-domain-warn')
    expect(out).toContain('actually goes to: sites.google.com')
  })

  it('adds a visible warning badge for punycode-encoded destinations', () => {
    const out = annotateEmailLinksWithRealDomain('<a href="https://xn--mcrosoft-h3a.com/login">Sign in</a>')
    expect(out).toContain('cm-link-domain-warn')
    expect(out).toContain('xn--mcrosoft-h3a.com')
  })

  it('does not add a warning badge for a normal matching link', () => {
    const out = annotateEmailLinksWithRealDomain('<a href="https://example.com">example.com</a>')
    expect(out).not.toContain('cm-link-domain-warn')
  })

  it('leaves non-http(s) links untouched', () => {
    const out = annotateEmailLinksWithRealDomain('<a href="mailto:a@b.com">Email us</a>')
    expect(out).not.toContain('title=')
    expect(out).not.toContain('cm-link-domain-warn')
  })
})
