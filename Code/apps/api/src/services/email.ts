/**
 * Email sending service for announcements — SMTP via nodemailer.
 *
 * Two modes:
 *   1. Per-user SMTP: user configures their own email + app password
 *   2. Platform default: the SMTP_USER sender (configured via env vars)
 *
 * Environment variables (platform default):
 *   SMTP_HOST              - default: smtp.gmail.com
 *   SMTP_PORT              - default: 587
 *   SMTP_USER              - default sender, e.g. sender@example.com
 *   SMTP_PASS              - app password for the default sender
 *   SMTP_ENCRYPTION_KEY    - 32-byte hex key for encrypting user SMTP passwords
 */

import { createTransport, type Transporter } from 'nodemailer'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

// ── Platform default SMTP config ──
const PLATFORM_SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com'
const PLATFORM_SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10)
const PLATFORM_SMTP_USER = process.env.SMTP_USER || ''
const PLATFORM_SMTP_PASS = process.env.SMTP_PASS || ''

// ── Encryption key for storing user SMTP passwords ──
const ENCRYPTION_KEY = process.env.SMTP_ENCRYPTION_KEY || ''

export interface EmailSendResult {
  success: boolean
  messageId?: string
  error?: string
}

export interface SmtpConfig {
  host: string
  port: number
  secure: boolean  // true = SSL (465), false = STARTTLS (587)
  user: string
  pass: string
  displayName?: string
}

/** Build a nodemailer transporter from SMTP config. */
function buildTransporter(cfg: SmtpConfig): Transporter {
  return createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  })
}

/** Send a single email via SMTP. */
export async function sendEmail(
  to: string,
  subject: string,
  textBody: string,
  smtpConfig?: SmtpConfig | null,
  senderUsername?: string,
): Promise<EmailSendResult> {
  let body = textBody
  if (senderUsername) {
    body += `\n\n-- Sent via Coordination Manager by ${senderUsername}`
  }

  // Determine which SMTP config to use
  // null = explicitly no config (dry-run), undefined = fall back to platform default
  const cfg = smtpConfig === undefined ? getPlatformSmtpConfig() : smtpConfig
  if (!cfg) {
    console.log(`[email:dry-run] To: ${to} | Subject: ${subject} | Body length: ${body.length}`)
    return { success: false, error: 'Email not configured. Set SMTP_USER and SMTP_PASS, or configure your own email in Settings.' }
  }

  try {
    const transporter = buildTransporter(cfg)
    const fromStr = cfg.displayName
      ? `"${cfg.displayName}" <${cfg.user}>`
      : cfg.user

    const info = await transporter.sendMail({
      from: fromStr,
      to,
      subject,
      text: body,
    })

    return { success: true, messageId: info.messageId }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'SMTP send failed' }
  }
}

/** Test an SMTP config by sending a verification email to the config's own address. */
export async function testSmtpConfig(cfg: SmtpConfig): Promise<EmailSendResult> {
  try {
    const transporter = buildTransporter(cfg)
    await transporter.verify()

    const info = await transporter.sendMail({
      from: cfg.displayName ? `"${cfg.displayName}" <${cfg.user}>` : cfg.user,
      to: cfg.user,
      subject: 'Coordination Manager - Email Configuration Verified',
      text: 'Your email integration is working. You can now send announcements from this address.\n\n-- Coordination Manager',
    })

    return { success: true, messageId: info.messageId }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'SMTP connection failed' }
  }
}

/** Get platform default SMTP config (returns null if not configured). */
export function getPlatformSmtpConfig(): SmtpConfig | null {
  if (!PLATFORM_SMTP_USER || !PLATFORM_SMTP_PASS) return null
  return {
    host: PLATFORM_SMTP_HOST,
    port: PLATFORM_SMTP_PORT,
    secure: PLATFORM_SMTP_PORT === 465,
    user: PLATFORM_SMTP_USER,
    pass: PLATFORM_SMTP_PASS,
    displayName: 'Coordination Manager',
  }
}

// ── Password encryption helpers ──
// Uses AES-256-GCM with 12-byte IV, stored as iv:authTag:ciphertext (hex)

export function encryptPassword(plaintext: string): string {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 64) {
    throw new Error('SMTP_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)')
  }
  const key = Buffer.from(ENCRYPTION_KEY, 'hex')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted.toString('hex')
}

export function decryptPassword(stored: string): string {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 64) {
    throw new Error('SMTP_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)')
  }
  const parts = stored.split(':')
  if (parts.length !== 3) throw new Error('Invalid encrypted password format')
  const key = Buffer.from(ENCRYPTION_KEY, 'hex')
  const iv = Buffer.from(parts[0], 'hex')
  const authTag = Buffer.from(parts[1], 'hex')
  const encrypted = Buffer.from(parts[2], 'hex')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return decrypted.toString('utf8')
}

export function isEncryptionConfigured(): boolean {
  return !!(ENCRYPTION_KEY && ENCRYPTION_KEY.length >= 64)
}
