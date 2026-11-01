import { describe, it, expect, vi, afterEach } from 'vitest'
import { sanitizeString, sanitizeUUID, safeErrorMessage, safeExternalErrorMessage, collapseExternalServiceErrorMessage, ANNOUNCEMENT_BODY_MAX_LENGTH } from '../validation.js'

// ---------------------------------------------------------------------------
// sanitizeString
// ---------------------------------------------------------------------------

describe('sanitizeString', () => {
  it('returns trimmed string for valid input', () => {
    expect(sanitizeString('  hello  ')).toBe('hello')
  })

  it('returns null for non-string input', () => {
    expect(sanitizeString(123)).toBeNull()
    expect(sanitizeString(null)).toBeNull()
    expect(sanitizeString(undefined)).toBeNull()
    expect(sanitizeString(true)).toBeNull()
    expect(sanitizeString({})).toBeNull()
    expect(sanitizeString([])).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(sanitizeString('')).toBeNull()
  })

  it('returns null for whitespace-only string', () => {
    expect(sanitizeString('   ')).toBeNull()
    expect(sanitizeString('\t\n')).toBeNull()
  })

  it('returns null when string exceeds default maxLength (500)', () => {
    const longStr = 'a'.repeat(501)
    expect(sanitizeString(longStr)).toBeNull()
  })

  it('accepts string at exactly maxLength', () => {
    const exactStr = 'a'.repeat(500)
    expect(sanitizeString(exactStr)).toBe(exactStr)
  })

  it('respects custom maxLength', () => {
    expect(sanitizeString('hello', 5)).toBe('hello')
    expect(sanitizeString('hello!', 5)).toBeNull()
  })

  it('trims before checking length', () => {
    // '  hi  ' trimmed = 'hi' (length 2), so maxLength 2 should pass
    expect(sanitizeString('  hi  ', 2)).toBe('hi')
  })
})

// ---------------------------------------------------------------------------
// sanitizeUUID
// ---------------------------------------------------------------------------

describe('sanitizeUUID', () => {
  it('returns valid UUIDs unchanged', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    expect(sanitizeUUID(uuid)).toBe(uuid)
  })

  it('accepts uppercase UUIDs (case insensitive)', () => {
    const uuid = '550E8400-E29B-41D4-A716-446655440000'
    expect(sanitizeUUID(uuid)).toBe(uuid)
  })

  it('returns null for non-string input', () => {
    expect(sanitizeUUID(123)).toBeNull()
    expect(sanitizeUUID(null)).toBeNull()
    expect(sanitizeUUID(undefined)).toBeNull()
    expect(sanitizeUUID({})).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(sanitizeUUID('')).toBeNull()
  })

  it('rejects malformed UUIDs', () => {
    expect(sanitizeUUID('not-a-uuid')).toBeNull()
    expect(sanitizeUUID('550e8400-e29b-41d4-a716')).toBeNull()
    expect(sanitizeUUID('550e8400e29b41d4a716446655440000')).toBeNull() // no dashes
    expect(sanitizeUUID('550e8400-e29b-41d4-a716-44665544000g')).toBeNull() // invalid char
  })

  it('rejects UUIDs with extra whitespace', () => {
    expect(sanitizeUUID(' 550e8400-e29b-41d4-a716-446655440000 ')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// safeErrorMessage
// ---------------------------------------------------------------------------

describe('safeErrorMessage', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns error message in non-production', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(safeErrorMessage(new Error('DB connection failed'))).toBe('DB connection failed')
  })

  it('hides error details in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(safeErrorMessage(new Error('DB connection failed'))).toBe('An internal error occurred')
  })

  it('returns fallback for null/undefined error', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(safeErrorMessage(null)).toBe('An internal error occurred')
    expect(safeErrorMessage(undefined)).toBe('An internal error occurred')
  })

  it('returns fallback for error without message', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(safeErrorMessage({})).toBe('An internal error occurred')
  })
})

// ---------------------------------------------------------------------------
// safeExternalErrorMessage
// ---------------------------------------------------------------------------

describe('safeExternalErrorMessage', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('collapses upstream HTML error pages to the external-service fallback', () => {
    vi.stubEnv('NODE_ENV', 'development')
    const htmlError = new Error('<!DOCTYPE html><html><title>supabase.co | 522: Connection timed out</title></html>')

    expect(safeExternalErrorMessage(htmlError, 'Time Manager storage is temporarily unavailable.')).toBe(
      'Time Manager storage is temporarily unavailable.'
    )
  })

  it('collapses 5xx provider statuses to the external-service fallback', () => {
    vi.stubEnv('NODE_ENV', 'development')

    expect(safeExternalErrorMessage({ status: 522, message: 'Connection timed out' })).toBe(
      'External service unavailable. Please try again later.'
    )
  })

  it('keeps normal validation messages in non-production', () => {
    vi.stubEnv('NODE_ENV', 'development')

    expect(safeExternalErrorMessage(new Error('A category with this label already exists'))).toBe(
      'A category with this label already exists'
    )
  })
})

// ---------------------------------------------------------------------------
// collapseExternalServiceErrorMessage
// ---------------------------------------------------------------------------

describe('collapseExternalServiceErrorMessage', () => {
  it('returns fallback for upstream HTML and null for normal errors', () => {
    expect(collapseExternalServiceErrorMessage(new Error('<html>supabase.co | 522: Connection timed out</html>'))).toBe(
      'External service unavailable. Please try again later.'
    )
    expect(collapseExternalServiceErrorMessage(new Error('No refresh token available -- please re-authorize this calendar.'))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('ANNOUNCEMENT_BODY_MAX_LENGTH', () => {
  it('is 1800', () => {
    expect(ANNOUNCEMENT_BODY_MAX_LENGTH).toBe(1800)
  })
})
