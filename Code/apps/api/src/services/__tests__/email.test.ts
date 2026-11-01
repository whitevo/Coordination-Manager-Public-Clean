/**
 * Email sending tests — verifies both platform and user-flow SMTP methods.
 *
 * Sends exactly 2 REAL emails when SMTP credentials are configured:
 *   1. "TEST 1/2: Platform SMTP" -- default env-var path (sendEmail with no SmtpConfig)
 *   2. "TEST 2/2: User SMTP"    -- custom SmtpConfig path (sendEmail with explicit config)
 *
 * Run:   pnpm test -- --run src/services/__tests__/email.test.ts
 */

import { describe, it, expect } from 'vitest'
import dotenv from 'dotenv'
import { getTestEmailRecipient } from './helpers/test-email.js'

// Load .env BEFORE the email module is imported (it reads env at top level)
dotenv.config({ quiet: true })

// Dynamic import so env vars are available when the module initializes
const emailMod = await import('../email.js')
const { sendEmail, getPlatformSmtpConfig } = emailMod
type SmtpConfig = import('../email.js').SmtpConfig

// Real sends go here when SMTP is configured; EMAIL_TEST_RECIPIENT configures the inbox.
const TEST_RECIPIENT = getTestEmailRecipient()

// ─── Unit tests (no emails sent) ────────────────────────────

describe('email service -- unit tests', () => {
  it('getPlatformSmtpConfig returns null when env vars are empty', () => {
    const cfg = getPlatformSmtpConfig()
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      expect(cfg).toBeNull()
    } else {
      expect(cfg).toBeTruthy()
      expect(cfg!.host).toBeTruthy()
      expect(cfg!.user).toBe(process.env.SMTP_USER)
    }
  })

  it('sendEmail returns dry-run result when smtpConfig is null', async () => {
    const result = await sendEmail(
      TEST_RECIPIENT,
      'Dry-run test',
      'This should not actually send.',
      null, // force no SMTP config -> dry-run
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain('not configured')
  })
})

// ─── Integration tests (2 real emails, require credentials) ─

const platformCfg = getPlatformSmtpConfig()
const hasPlatformSmtp = !!platformCfg

describe('email service -- integration (real SMTP)', () => {
  // ── Email 1/2: Platform default SMTP path ──
  it.skipIf(!hasPlatformSmtp)(
    'TEST 1/2: sends via platform default SMTP (env vars)',
    async () => {
      const result = await sendEmail(
        TEST_RECIPIENT,
        'TEST 1/2: Platform SMTP -- Coordination Manager',
        'Code path tested: sendEmail() with NO SmtpConfig argument.\n'
          + 'This uses SMTP_USER / SMTP_PASS env vars (platform default).\n'
          + '\nIf you see this email, the platform SMTP path is working.',
      )

      console.log('[platform method] result:', JSON.stringify(result, null, 2))
      expect(result.success).toBe(true)
      expect(result.messageId).toBeTruthy()
    },
    30_000,
  )

  // ── Email 2/2: User-supplied SmtpConfig path ──
  const userSmtpConfig: SmtpConfig | null = hasPlatformSmtp
    ? {
        host: platformCfg!.host,
        port: platformCfg!.port,
        secure: platformCfg!.secure,
        user: platformCfg!.user,
        pass: platformCfg!.pass,
        displayName: 'User Flow Test',
      }
    : null

  it.skipIf(!userSmtpConfig)(
    'TEST 2/2: sends via user-configured SmtpConfig object',
    async () => {
      const result = await sendEmail(
        TEST_RECIPIENT,
        'TEST 2/2: User SMTP -- Coordination Manager',
        'Code path tested: sendEmail() with an explicit SmtpConfig object.\n'
          + 'This simulates a user who configured their own SMTP credentials.\n'
          + '\nIf you see this email, the user SMTP path is working.',
        userSmtpConfig,
        'TestUser',
      )

      console.log('[user flow method] result:', JSON.stringify(result, null, 2))
      expect(result.success).toBe(true)
      expect(result.messageId).toBeTruthy()
    },
    30_000,
  )
})
