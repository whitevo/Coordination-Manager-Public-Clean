import { describe, it, expect } from 'vitest'
import { getRailwayNodeEnvWarning } from '../runtime-env.js'

describe('getRailwayNodeEnvWarning', () => {
  it('returns null when not running on Railway', () => {
    expect(getRailwayNodeEnvWarning({ NODE_ENV: 'development' })).toBeNull()
    expect(getRailwayNodeEnvWarning({})).toBeNull()
  })

  it('returns null on Railway when NODE_ENV is production', () => {
    expect(getRailwayNodeEnvWarning({ RAILWAY_ENVIRONMENT_NAME: 'production', NODE_ENV: 'production' })).toBeNull()
    expect(getRailwayNodeEnvWarning({ RAILWAY_ENVIRONMENT: 'production', NODE_ENV: 'production' })).toBeNull()
  })

  it('warns on Railway when NODE_ENV is unset', () => {
    const warning = getRailwayNodeEnvWarning({ RAILWAY_ENVIRONMENT_NAME: 'production' })
    expect(warning).toContain('NODE_ENV is (unset)')
    expect(warning).toContain('NODE_ENV=production')
  })

  it('warns via the legacy RAILWAY_ENVIRONMENT variable when NODE_ENV is development', () => {
    const warning = getRailwayNodeEnvWarning({ RAILWAY_ENVIRONMENT: 'staging', NODE_ENV: 'development' })
    expect(warning).toContain('"staging"')
    expect(warning).toContain('NODE_ENV is development')
  })

  it('sanitizes control characters and does not include other env values', () => {
    const warning = getRailwayNodeEnvWarning({
      RAILWAY_ENVIRONMENT_NAME: 'prod\r\nFAKE LOG LINE',
      NODE_ENV: 'dev\nx',
      JWT_SECRET: 'super-secret-value',
    })
    expect(warning).not.toMatch(/[\r\n]/)
    expect(warning).not.toContain('super-secret-value')
  })
})
