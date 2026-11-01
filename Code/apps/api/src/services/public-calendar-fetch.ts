import { lookup } from 'dns/promises'
import { BlockList } from 'net'

const MAX_PUBLIC_CALENDAR_REDIRECTS = 3

const PRIVATE_ADDRESS_BLOCKLIST = new BlockList()

PRIVATE_ADDRESS_BLOCKLIST.addSubnet('0.0.0.0', 8, 'ipv4')
PRIVATE_ADDRESS_BLOCKLIST.addSubnet('10.0.0.0', 8, 'ipv4')
PRIVATE_ADDRESS_BLOCKLIST.addSubnet('100.64.0.0', 10, 'ipv4')
PRIVATE_ADDRESS_BLOCKLIST.addSubnet('127.0.0.0', 8, 'ipv4')
PRIVATE_ADDRESS_BLOCKLIST.addSubnet('169.254.0.0', 16, 'ipv4')
PRIVATE_ADDRESS_BLOCKLIST.addSubnet('172.16.0.0', 12, 'ipv4')
PRIVATE_ADDRESS_BLOCKLIST.addSubnet('192.168.0.0', 16, 'ipv4')
PRIVATE_ADDRESS_BLOCKLIST.addSubnet('198.18.0.0', 15, 'ipv4')
PRIVATE_ADDRESS_BLOCKLIST.addSubnet('::', 128, 'ipv6')
PRIVATE_ADDRESS_BLOCKLIST.addSubnet('::1', 128, 'ipv6')
PRIVATE_ADDRESS_BLOCKLIST.addSubnet('fc00::', 7, 'ipv6')
PRIVATE_ADDRESS_BLOCKLIST.addSubnet('fe80::', 10, 'ipv6')

const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/,
  /^0\.0\.0\.0$/,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/,
  /^198\.(1[89])\.\d+\.\d+$/,
  /^::1$/,
  /^::$/,
  /\.local$/,
  /\.internal$/,
  /\.svc\.cluster\.local$/,
]

function decodeBase64Url(value: string): string | null {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    return Buffer.from(padded, 'base64').toString('utf-8')
  } catch {
    return null
  }
}

export function normalizePublicCalendarUrl(inputUrl: string): string {
  const parsed = new URL(inputUrl)

  if (parsed.hostname.toLowerCase() === 'calendar.google.com') {
    const cid = parsed.searchParams.get('cid')
    if (cid) {
      const decodedCid = decodeBase64Url(cid) || cid
      const calendarId = decodedCid.trim()
      if (calendarId) {
        const encodedId = encodeURIComponent(calendarId)
        return `https://calendar.google.com/calendar/ical/${encodedId}/public/basic.ics`
      }
    }
  }

  return parsed.toString()
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '').split('%')[0]
}

export function isBlockedIpAddress(address: string): boolean {
  const normalized = normalizeHostname(address)
  if (!normalized) return true

  if (normalized.startsWith('::ffff:')) {
    return isBlockedIpAddress(normalized.slice(7))
  }

  const family = normalized.includes(':') ? 'ipv6' : 'ipv4'
  return PRIVATE_ADDRESS_BLOCKLIST.check(normalized, family)
}

export async function assertSafePublicCalendarHost(hostname: string): Promise<void> {
  const normalizedHostname = normalizeHostname(hostname)
  if (!normalizedHostname) {
    throw new Error('Invalid calendar host')
  }

  if (BLOCKED_HOSTNAME_PATTERNS.some((pattern) => pattern.test(normalizedHostname))) {
    throw new Error('URLs pointing to private or internal addresses are not allowed')
  }

  if (isBlockedIpAddress(normalizedHostname)) {
    throw new Error('URLs pointing to private or internal addresses are not allowed')
  }

  let resolvedAddresses: Array<{ address: string; family: number }>
  try {
    resolvedAddresses = await lookup(normalizedHostname, { all: true as const })
  } catch {
    throw new Error('Calendar host could not be resolved')
  }

  if (!Array.isArray(resolvedAddresses) || resolvedAddresses.length === 0) {
    throw new Error('Calendar host could not be resolved')
  }

  if (resolvedAddresses.some((entry) => isBlockedIpAddress(entry.address))) {
    throw new Error('URLs pointing to private or internal addresses are not allowed')
  }
}

export async function resolveSafePublicCalendarUrl(inputUrl: string): Promise<string> {
  let normalizedUrl: URL
  try {
    normalizedUrl = new URL(normalizePublicCalendarUrl(inputUrl))
  } catch {
    throw new Error('Invalid URL format')
  }

  if (normalizedUrl.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are allowed')
  }

  await assertSafePublicCalendarHost(normalizedUrl.hostname)
  return normalizedUrl.toString()
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

/**
 * Fetch a user-supplied public calendar feed URL without ever following
 * redirects to unvalidated hosts. Redirects are followed manually (max 3) and
 * every hop re-runs HTTPS + DNS + blocked-range validation.
 */
export async function fetchPublicCalendarUrl(inputUrl: string, init: RequestInit = {}): Promise<Response> {
  let currentUrl = await resolveSafePublicCalendarUrl(inputUrl)

  for (let hop = 0; hop <= MAX_PUBLIC_CALENDAR_REDIRECTS; hop++) {
    const response = await fetch(currentUrl, { ...init, redirect: 'manual' })

    if (!isRedirectStatus(response.status)) {
      return response
    }

    const location = response.headers.get('location')
    if (!location) {
      throw new Error('Calendar URL redirected without a destination')
    }
    if (hop === MAX_PUBLIC_CALENDAR_REDIRECTS) {
      throw new Error('Calendar URL redirected too many times')
    }

    let nextUrl: string
    try {
      nextUrl = new URL(location, currentUrl).toString()
    } catch {
      throw new Error('Invalid URL format')
    }
    currentUrl = await resolveSafePublicCalendarUrl(nextUrl)
  }

  throw new Error('Calendar URL redirected too many times')
}
