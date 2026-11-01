/**
 * Input validation & sanitization helpers for API routes.
 * Prevents oversized payloads, injection, and type confusion.
 */

/** Trim and validate a string input. Strips control characters. Returns null if invalid. */
export function sanitizeString(input: unknown, maxLength = 500): string | null {
  if (typeof input !== 'string') return null
  // Strip control characters (C0/C1) except newline/tab, and strip CR to prevent log injection
  // eslint-disable-next-line no-control-regex -- intentional: remove control chars from untrusted input
  const cleaned = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\r]/g, '')
  const trimmed = cleaned.trim()
  if (trimmed.length === 0 || trimmed.length > maxLength) return null
  return trimmed
}

/** Validate a UUID string. Returns null if invalid. */
export function sanitizeUUID(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(input) ? input : null
}

/**
 * Return a safe error message for API responses.
 * In production, hides internal/Supabase error details from clients.
 */
export function safeErrorMessage(err: unknown): string {
  if (process.env.NODE_ENV === 'production') {
    return 'An internal error occurred'
  }
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const message = (err as { message?: unknown }).message
    if (typeof message === 'string' && message) {
      return message
    }
  }
  return 'An internal error occurred'
}

function getErrorMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const message = (err as { message?: unknown }).message
    return typeof message === 'string' ? message : ''
  }
  return ''
}

function getErrorStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null
  const candidate = err as { status?: unknown; statusCode?: unknown; code?: unknown }
  const status = candidate.status ?? candidate.statusCode ?? candidate.code
  if (typeof status === 'number') return status
  if (typeof status === 'string') {
    const parsed = Number(status)
    return Number.isInteger(parsed) ? parsed : null
  }
  return null
}

export function safeExternalErrorMessage(
  err: unknown,
  fallback = 'External service unavailable. Please try again later.'
): string {
  return collapseExternalServiceErrorMessage(err, fallback) ?? safeErrorMessage(err)
}

export function collapseExternalServiceErrorMessage(
  err: unknown,
  fallback = 'External service unavailable. Please try again later.'
): string | null {
  const message = getErrorMessage(err)
  const lowerMessage = message.toLowerCase()
  const status = getErrorStatus(err)

  if (
    status === 522 ||
    (status !== null && status >= 500) ||
    lowerMessage.includes('<!doctype html') ||
    lowerMessage.includes('<html') ||
    lowerMessage.includes('cloudflare') ||
    lowerMessage.includes('connection timed out')
  ) {
    return fallback
  }

  return null
}

/** Max announcement body length (allows room for attribution suffix) */
export const ANNOUNCEMENT_BODY_MAX_LENGTH = 1800
