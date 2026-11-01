import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { supabaseAdmin } from '../supabaseClient.js'
import type { MailboxOAuthProvider } from './mailbox-oauth.js'

export type MailboxCredentialProvider = MailboxOAuthProvider | 'imap'

export interface OAuthMailboxCredentialPayload {
  accessToken: string
  refreshToken: string | null
  expiresAt: string | null
  scope: string | null
  provider: MailboxOAuthProvider
}

export interface ImapMailboxCredentialPayload {
  provider: 'imap'
  username: string
  password: string
  host: string
  port: number
  security: 'ssl' | 'starttls'
  mailbox: string | null
}

type MailboxCredentialPayload = OAuthMailboxCredentialPayload | ImapMailboxCredentialPayload

interface MailboxCredentialRow {
  id: string
  encrypted_payload: string
}

// aes-256-gcm needs exactly 32 bytes, so the key must be exactly 64 hex chars -- anything else
// silently produces a wrong-length Buffer and fails later inside createCipheriv.
const MAILBOX_ENCRYPTION_KEY_PATTERN = /^[0-9a-fA-F]{64}$/

function getMailboxEncryptionKey(): string {
  const key = process.env.MAILBOX_ENCRYPTION_KEY || process.env.SMTP_ENCRYPTION_KEY
  if (!key || !MAILBOX_ENCRYPTION_KEY_PATTERN.test(key)) {
    throw new Error('MAILBOX_ENCRYPTION_KEY must be a 64-char hex string (or SMTP_ENCRYPTION_KEY fallback)')
  }
  return key
}

function encryptPayload(plaintext: string): string {
  const key = Buffer.from(getMailboxEncryptionKey(), 'hex')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

function decryptPayload(stored: string): string {
  const key = Buffer.from(getMailboxEncryptionKey(), 'hex')
  const parts = stored.split(':')
  if (parts.length !== 3) throw new Error('Invalid encrypted mailbox payload format')
  const iv = Buffer.from(parts[0], 'hex')
  const authTag = Buffer.from(parts[1], 'hex')
  const encrypted = Buffer.from(parts[2], 'hex')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return decrypted.toString('utf8')
}

export function isMailboxEncryptionConfigured(): boolean {
  const key = process.env.MAILBOX_ENCRYPTION_KEY || process.env.SMTP_ENCRYPTION_KEY
  return !!(key && MAILBOX_ENCRYPTION_KEY_PATTERN.test(key))
}

export async function upsertMailboxCredential(
  userId: string,
  accountId: string,
  provider: MailboxCredentialProvider,
  payload: MailboxCredentialPayload,
): Promise<string> {
  const encryptedPayload = encryptPayload(JSON.stringify(payload))

  const { data: existing, error: lookupError } = await supabaseAdmin
    .from('mail_credentials')
    .select('id')
    .eq('user_id', userId)
    .eq('account_id', accountId)
    .eq('provider', provider)
    .maybeSingle()

  if (lookupError) throw lookupError

  const nowIso = new Date().toISOString()

  if (existing?.id) {
    const { error: updateError } = await supabaseAdmin
      .from('mail_credentials')
      .update({
        encrypted_payload: encryptedPayload,
        updated_at: nowIso,
      })
      .eq('id', existing.id)

    if (updateError) throw updateError
    return existing.id as string
  }

  const { data, error } = await supabaseAdmin
    .from('mail_credentials')
    .insert({
      user_id: userId,
      account_id: accountId,
      provider,
      encrypted_payload: encryptedPayload,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id as string
}

export function getMailboxCredential(
  userId: string,
  accountId: string,
  provider: MailboxOAuthProvider,
): Promise<OAuthMailboxCredentialPayload | null>
export function getMailboxCredential(
  userId: string,
  accountId: string,
  provider: 'imap',
): Promise<ImapMailboxCredentialPayload | null>
export async function getMailboxCredential(
  userId: string,
  accountId: string,
  provider: MailboxCredentialProvider,
): Promise<MailboxCredentialPayload | null> {
  const { data, error } = await supabaseAdmin
    .from('mail_credentials')
    .select('id, encrypted_payload')
    .eq('user_id', userId)
    .eq('account_id', accountId)
    .eq('provider', provider)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const row = data as MailboxCredentialRow
  const decrypted = decryptPayload(row.encrypted_payload)
  const parsedPayload = JSON.parse(decrypted) as unknown
  if (!parsedPayload || typeof parsedPayload !== 'object' || Array.isArray(parsedPayload)) {
    throw new Error('Stored mailbox credential payload is invalid')
  }
  const payload = parsedPayload as Record<string, unknown>

  if (payload.provider === 'imap') {
    if (
      typeof payload.username !== 'string'
      || typeof payload.password !== 'string'
      || typeof payload.host !== 'string'
      || typeof payload.port !== 'number'
    ) {
      throw new Error('Stored IMAP credential payload is invalid')
    }

    return {
      provider: 'imap',
      username: payload.username,
      password: payload.password,
      host: payload.host,
      port: payload.port,
      security: payload.security === 'ssl' || payload.security === 'starttls'
        ? payload.security
        : 'ssl',
      mailbox: typeof payload.mailbox === 'string' ? payload.mailbox : null,
    }
  }

  if (
    typeof payload.accessToken !== 'string'
    || (payload.provider !== 'gmail' && payload.provider !== 'outlook')
  ) {
    throw new Error('Stored mailbox credential payload is invalid')
  }

  return {
    accessToken: payload.accessToken,
    refreshToken: typeof payload.refreshToken === 'string' ? payload.refreshToken : null,
    expiresAt: typeof payload.expiresAt === 'string' ? payload.expiresAt : null,
    scope: typeof payload.scope === 'string' ? payload.scope : null,
    provider: payload.provider,
  }
}
