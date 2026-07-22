import { describe, expect, it } from 'vitest'
import type express from 'express'
import { getRateLimitKey } from '../rate-limiters.js'

function createRequest(overrides?: {
  remoteAddress?: string | null
  ip?: string
}): express.Request {
  const remoteAddress = overrides && 'remoteAddress' in overrides
    ? overrides.remoteAddress
    : '203.0.113.10'

  return {
    socket: {
      remoteAddress,
    },
    ip: overrides?.ip ?? '198.51.100.20',
  } as express.Request
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
})