import { describe, expect, it, vi } from 'vitest'
import type express from 'express'
import { getRateLimitKey, logRateLimitHit } from '../rate-limiters.js'

function createRequest(overrides?: {
  remoteAddress?: string | null
  ip?: string
  trustProxy?: number | boolean
}): express.Request {
  const remoteAddress = overrides && 'remoteAddress' in overrides
    ? overrides.remoteAddress
    : '203.0.113.10'

  return {
    socket: {
      remoteAddress,
    },
    ip: overrides?.ip ?? '198.51.100.20',
    app: { get: (name: string) => (name === 'trust proxy' ? overrides?.trustProxy : undefined) },
    method: 'POST',
    path: '/api/auth/guest',
  } as unknown as express.Request
}

describe('getRateLimitKey', () => {
  it('prefers the socket remote address over req.ip', () => {
    const request = createRequest({
      remoteAddress: '203.0.113.44',
      ip: '198.51.100.99',
    })

    expect(getRateLimitKey(request)).toBe('203.0.113.44')
  })

  it('falls back to req.ip when the socket address is missing', () => {
    const request = createRequest({
      remoteAddress: null,
      ip: '198.51.100.77',
    })

    expect(getRateLimitKey(request)).toBe('198.51.100.77')
  })

  it('keys on the proxy-supplied client ip when the proxy is trusted (production)', () => {
    const fromClientA = createRequest({ remoteAddress: '100.64.0.2', ip: '203.0.113.5', trustProxy: 1 })
    const fromClientB = createRequest({ remoteAddress: '100.64.0.2', ip: '198.51.100.8', trustProxy: 1 })

    expect(getRateLimitKey(fromClientA)).toBe('203.0.113.5')
    expect(getRateLimitKey(fromClientB)).toBe('198.51.100.8')
  })
})

describe('logRateLimitHit', () => {
  it('logs the limiter, client key, method and path without line breaks', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const request = createRequest({ remoteAddress: '203.0.113.9' })
    Object.assign(request, { path: '/api/x' + String.fromCharCode(13, 10) + 'injected' })

    logRateLimitHit('Too many requests', request)

    expect(warn).toHaveBeenCalledWith('[rate-limit] Too many requests key=203.0.113.9 POST /api/x injected')
    warn.mockRestore()
  })
})
