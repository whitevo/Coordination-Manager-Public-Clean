import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto'
import { supabaseAdmin } from '../supabaseClient.js'

export type MailboxOAuthProvider = 'gmail' | 'outlook'

interface OAuthTokenResult {
  accessToken: string
  refreshToken: string | null
  expiresAt: string | null
  scope: string | null
  raw: Record<string, unknown>
}

interface ProviderIdentity {
  email: string
  displayName: string | null
}

interface SignedStatePayload {
  userId: string
  provider: MailboxOAuthProvider
  identityGroup: string
  transactionId: string
  expiresAt: number
}

export const MAILBOX_OAUTH_MAX_AGE_MS = 10 * 60 * 1000

export function mailboxOAuthCookieName(provider: MailboxOAuthProvider): string {
  return `cm_mailbox_oauth_${provider}`
}

export function readMailboxOAuthCookie(header: string | undefined, provider: MailboxOAuthProvider): string | null {
  const name = mailboxOAuthCookieName(provider)
  const values = (header || '').split(';')
    .map(pair => pair.trim().split('='))
    .filter(([key]) => key === name)
  if (values.length !== 1) return null
  const value = values[0][1]
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null
}

export async function createMailboxOAuthTransaction(
  payload: Pick<SignedStatePayload, 'userId' | 'provider' | 'identityGroup'>,
): Promise<{ state: string; browserToken: string }> {
  const now = Date.now()
  const browserToken = randomBytes(32).toString('hex')
  const statePayload: SignedStatePayload = {
    ...payload,
    transactionId: randomUUID(),
    expiresAt: now + MAILBOX_OAUTH_MAX_AGE_MS,
  }
  const state = signMailboxOAuthState(statePayload)
  const { error: cleanupError } = await supabaseAdmin.from('mailbox_oauth_transactions')
    .delete().lt('expires_at', new Date(now).toISOString())
  if (cleanupError) throw cleanupError
  const { error } = await supabaseAdmin.from('mailbox_oauth_transactions').insert({
    id: statePayload.transactionId,
    user_id: payload.userId,
    provider: payload.provider,
    browser_token_hash: createHash('sha256').update(browserToken).digest('hex'),
    expires_at: new Date(statePayload.expiresAt).toISOString(),
  })
  if (error) throw error
  return { state, browserToken }
}

export async function consumeMailboxOAuthTransaction(
  stateRaw: string,
  browserToken: string | null,
  provider: MailboxOAuthProvider,
): Promise<SignedStatePayload | null> {
  const state = verifyMailboxOAuthState(stateRaw)
  if (!state || state.provider !== provider || !browserToken || !/^[a-f0-9]{64}$/.test(browserToken)) return null

  // DELETE ... RETURNING atomically claims the transaction across API instances.
  const { data, error } = await supabaseAdmin.from('mailbox_oauth_transactions')
    .delete()
    .eq('id', state.transactionId)
    .eq('user_id', state.userId)
    .eq('provider', provider)
    .eq('browser_token_hash', createHash('sha256').update(browserToken).digest('hex'))
    .gt('expires_at', new Date().toISOString())
    .select('id')
    .maybeSingle()
  if (error) throw error
  return data ? state : null
}

const GMAIL_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const GMAIL_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const GMAIL_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo'

const OUTLOOK_AUTH_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const OUTLOOK_TOKEN_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const OUTLOOK_USERINFO_ENDPOINT = 'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName'

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

const OUTLOOK_SCOPES = [
  'offline_access',
  'Mail.ReadWrite',
  'Mail.Send',
  'User.Read',
].join(' ')

const devOnlyMailboxStateKey = randomBytes(32).toString('hex')

function getStateSigningKey(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET

  const allowInsecureDevSigning =
    process.env.NODE_ENV === 'test' ||
    (process.env.NODE_ENV !== 'production' && process.env.ALLOW_INSECURE_DEV_SIGNING === 'true')

  if (!allowInsecureDevSigning) {
    throw new Error('JWT_SECRET is required for mailbox OAuth state signing')
  }

  return devOnlyMailboxStateKey
}

function readEnvValue(name: string): string | null {
  const value = process.env[name]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getGoogleConfig() {
  // The id and secret must come from the same OAuth client. Falling back per-variable can pair a
  // MAILBOX_ id with a GOOGLE_ secret, which Google rejects as "The provided client secret is invalid."
  const mailboxId = readEnvValue('MAILBOX_GOOGLE_CLIENT_ID')
  const mailboxSecret = readEnvValue('MAILBOX_GOOGLE_CLIENT_SECRET')
  if (mailboxId || mailboxSecret) {
    if (!mailboxId || !mailboxSecret) {
      throw new Error('MAILBOX_GOOGLE_CLIENT_ID and MAILBOX_GOOGLE_CLIENT_SECRET must both be set')
    }
    return { clientId: mailboxId, clientSecret: mailboxSecret }
  }

  const clientId = readEnvValue('GOOGLE_CLIENT_ID')
  const clientSecret = readEnvValue('GOOGLE_CLIENT_SECRET')
  if (!clientId || !clientSecret) {
    throw new Error('Missing MAILBOX_GOOGLE_CLIENT_ID or MAILBOX_GOOGLE_CLIENT_SECRET')
  }
  return { clientId, clientSecret }
}

function getOutlookConfig() {
  const clientId = readEnvValue('MAILBOX_MICROSOFT_CLIENT_ID')
  const clientSecret = readEnvValue('MAILBOX_MICROSOFT_CLIENT_SECRET')
  if (!clientId || !clientSecret) {
    throw new Error('Missing MAILBOX_MICROSOFT_CLIENT_ID or MAILBOX_MICROSOFT_CLIENT_SECRET')
  }
  return { clientId, clientSecret }
}

export function buildMailboxOAuthRedirectUri(
  provider: MailboxOAuthProvider,
  req: { protocol: string; get(name: string): string | undefined }
): string {
  if (provider === 'gmail' && process.env.MAILBOX_GMAIL_REDIRECT_URI) {
    return process.env.MAILBOX_GMAIL_REDIRECT_URI
  }
  if (provider === 'outlook' && process.env.MAILBOX_OUTLOOK_REDIRECT_URI) {
    return process.env.MAILBOX_OUTLOOK_REDIRECT_URI
  }

  const host = req.get('host')
  if (host) {
    return `${req.protocol}://${host}/api/mailbox/oauth/${provider}/callback`
  }

  return `http://localhost:3001/api/mailbox/oauth/${provider}/callback`
}

export function signMailboxOAuthState(payload: SignedStatePayload): string {
  const json = JSON.stringify(payload)
  const data = Buffer.from(json).toString('base64url')
  const sig = createHmac('sha256', getStateSigningKey()).update(data).digest('base64url')
  return `${data}.${sig}`
}

export function verifyMailboxOAuthState(state: string): SignedStatePayload | null {
  const parts = state.split('.')
  if (parts.length !== 2) return null
  const [data, sig] = parts
  const expectedSig = createHmac('sha256', getStateSigningKey()).update(data).digest('base64url')

  const sigBuf = Buffer.from(sig)
  const expectedBuf = Buffer.from(expectedSig)
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null
  }

  try {
    const payload: unknown = JSON.parse(Buffer.from(data, 'base64url').toString('utf-8'))
    if (typeof payload !== 'object' || payload === null) return null
    const value = payload as Record<string, unknown>
    if (
      typeof value.userId !== 'string' || !value.userId ||
      (value.provider !== 'gmail' && value.provider !== 'outlook') ||
      typeof value.identityGroup !== 'string' || !value.identityGroup ||
      typeof value.transactionId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.transactionId) ||
      typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt) ||
      value.expiresAt <= Date.now() || value.expiresAt > Date.now() + MAILBOX_OAUTH_MAX_AGE_MS
    ) {
      return null
    }
    return {
      userId: value.userId,
      provider: value.provider,
      identityGroup: value.identityGroup,
      transactionId: value.transactionId,
      expiresAt: value.expiresAt,
    }
  } catch {
    return null
  }
}

export function buildMailboxOAuthAuthUrl(
  provider: MailboxOAuthProvider,
  redirectUri: string,
  state: string,
): string {
  if (provider === 'gmail') {
    const { clientId } = getGoogleConfig()
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GMAIL_SCOPES,
      access_type: 'offline',
      include_granted_scopes: 'true',
      state,
    })
    return `${GMAIL_AUTH_ENDPOINT}?${params.toString()}`
  }

  const { clientId } = getOutlookConfig()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    response_mode: 'query',
    scope: OUTLOOK_SCOPES,
    state,
  })
  return `${OUTLOOK_AUTH_ENDPOINT}?${params.toString()}`
}

export async function exchangeMailboxOAuthCode(
  provider: MailboxOAuthProvider,
  code: string,
  redirectUri: string,
): Promise<OAuthTokenResult> {
  if (provider === 'gmail') {
    const { clientId, clientSecret } = getGoogleConfig()
    const response = await fetch(GMAIL_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })

    const payload = (await response.json()) as Record<string, unknown>
    if (!response.ok || typeof payload.error === 'string') {
      throw new Error(
        (typeof payload.error_description === 'string' && payload.error_description) ||
        (typeof payload.error === 'string' && payload.error) ||
        'Google token exchange failed',
      )
    }

    const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 3600
    return {
      accessToken: typeof payload.access_token === 'string' ? payload.access_token : '',
      refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : null,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      scope: typeof payload.scope === 'string' ? payload.scope : null,
      raw: payload,
    }
  }

  const { clientId, clientSecret } = getOutlookConfig()
  const response = await fetch(OUTLOOK_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  const payload = (await response.json()) as Record<string, unknown>
  if (!response.ok || typeof payload.error === 'string') {
    throw new Error(
      (typeof payload.error_description === 'string' && payload.error_description) ||
      (typeof payload.error === 'string' && payload.error) ||
      'Microsoft token exchange failed',
    )
  }

  const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 3600
  return {
    accessToken: typeof payload.access_token === 'string' ? payload.access_token : '',
    refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : null,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    scope: typeof payload.scope === 'string' ? payload.scope : null,
    raw: payload,
  }
}

export async function refreshMailboxOAuthAccessToken(
  provider: MailboxOAuthProvider,
  refreshToken: string,
): Promise<OAuthTokenResult> {
  if (!refreshToken) {
    throw new Error('Mailbox refresh token is missing')
  }

  if (provider === 'gmail') {
    const { clientId, clientSecret } = getGoogleConfig()
    const response = await fetch(GMAIL_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    })

    const payload = (await response.json()) as Record<string, unknown>
    if (!response.ok || typeof payload.error === 'string') {
      throw new Error(
        (typeof payload.error_description === 'string' && payload.error_description) ||
        (typeof payload.error === 'string' && payload.error) ||
        'Google token refresh failed',
      )
    }

    const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 3600
    return {
      accessToken: typeof payload.access_token === 'string' ? payload.access_token : '',
      refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : null,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      scope: typeof payload.scope === 'string' ? payload.scope : null,
      raw: payload,
    }
  }

  const { clientId, clientSecret } = getOutlookConfig()
  const response = await fetch(OUTLOOK_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      scope: OUTLOOK_SCOPES,
      grant_type: 'refresh_token',
    }),
  })

  const payload = (await response.json()) as Record<string, unknown>
  if (!response.ok || typeof payload.error === 'string') {
    throw new Error(
      (typeof payload.error_description === 'string' && payload.error_description) ||
      (typeof payload.error === 'string' && payload.error) ||
      'Microsoft token refresh failed',
    )
  }

  const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 3600
  return {
    accessToken: typeof payload.access_token === 'string' ? payload.access_token : '',
    refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : null,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    scope: typeof payload.scope === 'string' ? payload.scope : null,
    raw: payload,
  }
}

export async function fetchMailboxProviderIdentity(
  provider: MailboxOAuthProvider,
  accessToken: string,
): Promise<ProviderIdentity> {
  if (!accessToken) {
    throw new Error('OAuth access token is missing')
  }

  if (provider === 'gmail') {
    const response = await fetch(GMAIL_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const payload = (await response.json()) as Record<string, unknown>
    if (!response.ok) {
      throw new Error('Failed to read Google user profile')
    }

    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : ''
    if (!email) throw new Error('Google profile does not include an email')

    return {
      email,
      displayName: typeof payload.name === 'string' ? payload.name : null,
    }
  }

  const response = await fetch(OUTLOOK_USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const payload = (await response.json()) as Record<string, unknown>
  if (!response.ok) {
    throw new Error('Failed to read Microsoft user profile')
  }

  const primaryEmail = typeof payload.mail === 'string' && payload.mail
    ? payload.mail
    : (typeof payload.userPrincipalName === 'string' ? payload.userPrincipalName : '')

  if (!primaryEmail) {
    throw new Error('Microsoft profile does not include an email')
  }

  return {
    email: primaryEmail.toLowerCase(),
    displayName: typeof payload.displayName === 'string' ? payload.displayName : null,
  }
}
