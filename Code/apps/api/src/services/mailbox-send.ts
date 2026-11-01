import { randomBytes } from 'node:crypto'
import { getMailboxCredential, upsertMailboxCredential } from './mailbox-credentials.js'
import { refreshMailboxOAuthAccessToken, type MailboxOAuthProvider } from './mailbox-oauth.js'

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1'
const OUTLOOK_GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/

interface OAuthCredential {
  provider: MailboxOAuthProvider
  accessToken: string
  refreshToken: string | null
  expiresAt: string | null
  scope: string | null
}

export interface MailboxSendInput {
  userId: string
  accountId: string
  provider: MailboxOAuthProvider
  fromAddress: string
  fromName?: string | null
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  bodyText: string
  /** Optional HTML alternative; when set the message is sent as multipart/alternative. */
  bodyHtml?: string | null
  /** Provider thread id used to keep replies inside the original conversation. */
  providerThreadId?: string | null
  /** RFC 5322 Message-ID of the message being replied to. */
  inReplyToRfcId?: string | null
  /**
   * Outlook provider message id of the message being replied to. Graph's plain
   * sendMail API has no way to attach a reply to an existing conversation, so
   * when this is set the Outlook path uses createReply/createReplyAll instead
   * (the only Graph mechanism that preserves conversationId + In-Reply-To/References).
   */
  outlookReplyToMessageId?: string | null
  attachments?: MailAttachment[]
}

export interface MailAttachment {
  filename: string
  contentType: string
  contentBase64: string
}

export interface MailboxSendResult {
  providerMessageId: string | null
}

/** Rejects CR/LF so a recipient or subject cannot inject extra MIME headers. */
function assertHeaderSafe(value: string, label: string): void {
  if (/[\r\n]/.test(value)) {
    throw new Error(`${label} must not contain line breaks`)
  }
}

export function normalizeRecipientList(values: unknown, label: string): string[] {
  const raw = Array.isArray(values) ? values : typeof values === 'string' ? values.split(',') : []
  const seen = new Set<string>()
  const result: string[] = []

  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    // Accept both bare addresses and `Display Name <user@host>` entries.
    const angled = entry.match(/<([^<>]+)>/)
    const normalized = (angled ? angled[1] : entry).trim().toLowerCase()
    if (!normalized) continue
    assertHeaderSafe(normalized, label)
    if (normalized.length > 320 || !EMAIL_RE.test(normalized)) {
      throw new Error(`${label} contains an invalid address: ${normalized}`)
    }
    if (seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }

  return result
}

function encodeMimeWord(value: string): string {
  return /^[\x20-\x7E]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=`
}

function formatFromHeader(address: string, name: string | null | undefined): string {
  const trimmedName = (name || '').trim()
  if (!trimmedName) return address
  return `${encodeMimeWord(trimmedName)} <${address}>`
}

function buildGmailRaw(input: MailboxSendInput): string {
  const headers = [
    `From: ${formatFromHeader(input.fromAddress, input.fromName)}`,
    `To: ${input.to.join(', ')}`,
    ...(input.cc.length ? [`Cc: ${input.cc.join(', ')}`] : []),
    ...(input.bcc.length ? [`Bcc: ${input.bcc.join(', ')}`] : []),
    `Subject: ${encodeMimeWord(input.subject)}`,
    ...(input.inReplyToRfcId
      ? [`In-Reply-To: ${input.inReplyToRfcId}`, `References: ${input.inReplyToRfcId}`]
      : []),
    'MIME-Version: 1.0',
  ]

  const textPart = Buffer.from(input.bodyText, 'utf-8').toString('base64')

  if (!input.bodyHtml && input.attachments?.length === 0) {
    const raw = [
      ...headers,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
    ].join('\r\n') + `\r\n\r\n${textPart}`
    return Buffer.from(raw, 'utf-8').toString('base64url')
  }

  // Random boundaries so they can never collide with content inside a part.
  const alternativeBoundary = `----cm-alt-${randomBytes(16).toString('hex')}`
  const mixedBoundary = `----cm-mixed-${randomBytes(16).toString('hex')}`
  const htmlPart = input.bodyHtml ? Buffer.from(input.bodyHtml, 'utf-8').toString('base64') : null
  const alternativePart = input.bodyHtml
    ? [
        `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
        '',
        `--${alternativeBoundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
        '',
        textPart,
        `--${alternativeBoundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
        '',
        htmlPart,
        `--${alternativeBoundary}--`,
      ].join('\r\n')
    : [
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
        '',
        textPart,
      ].join('\r\n')

  if (!input.attachments?.length) {
    const raw = [...headers, ...alternativePart.split('\r\n')].join('\r\n') + '\r\n'
    return Buffer.from(raw, 'utf-8').toString('base64url')
  }

  const raw = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    '',
    `--${mixedBoundary}`,
    alternativePart,
    ...input.attachments.flatMap((attachment) => [
      `--${mixedBoundary}`,
      `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      '',
      attachment.contentBase64,
    ]),
    `--${mixedBoundary}--`,
    '',
  ].join('\r\n')

  return Buffer.from(raw, 'utf-8').toString('base64url')
}

function buildOutlookRecipients(addresses: string[]): Array<{ emailAddress: { address: string } }> {
  return addresses.map((address) => ({ emailAddress: { address } }))
}

async function readProviderError(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json()
    if (payload && typeof payload === 'object') {
      const error = (payload as Record<string, unknown>).error
      if (error && typeof error === 'object' && typeof (error as Record<string, unknown>).message === 'string') {
        return (error as Record<string, string>).message
      }
      if (typeof error === 'string') return error
    }
  } catch {
    // Provider returned a non-JSON body; fall back to the status code.
  }

  return `Provider send failed with status ${response.status}`
}

async function sendViaGmail(accessToken: string, input: MailboxSendInput): Promise<MailboxSendResult> {
  const response = await fetch(`${GMAIL_API_BASE}/users/me/messages/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      raw: buildGmailRaw(input),
      ...(input.providerThreadId ? { threadId: input.providerThreadId } : {}),
    }),
  })

  if (!response.ok) throw new Error(await readProviderError(response))

  const payload: unknown = await response.json()
  const providerMessageId = payload && typeof payload === 'object'
    ? (payload as Record<string, unknown>).id
    : null

  return { providerMessageId: typeof providerMessageId === 'string' ? providerMessageId : null }
}

async function outlookGraphFetch(accessToken: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${OUTLOOK_GRAPH_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })
}

/**
 * Plain compose/forward path. Graph's sendMail has no way to attach a brand-new
 * message to an existing conversation, so this must only be used when NOT
 * replying to a specific message (see sendOutlookReply for that case).
 */
async function sendPlainViaOutlook(accessToken: string, input: MailboxSendInput): Promise<MailboxSendResult> {
  const response = await outlookGraphFetch(accessToken, '/me/sendMail', {
    method: 'POST',
    body: JSON.stringify({
      message: {
        subject: input.subject,
        body: input.bodyHtml
          ? { contentType: 'HTML', content: input.bodyHtml }
          : { contentType: 'Text', content: input.bodyText },
        toRecipients: buildOutlookRecipients(input.to),
        ccRecipients: buildOutlookRecipients(input.cc),
        bccRecipients: buildOutlookRecipients(input.bcc),
        from: { emailAddress: { address: input.fromAddress } },
        ...(input.attachments?.length
          ? {
              attachments: input.attachments.map((attachment) => ({
                '@odata.type': '#microsoft.graph.fileAttachment',
                name: attachment.filename,
                contentType: attachment.contentType,
                contentBytes: attachment.contentBase64,
              })),
            }
          : {}),
      },
      saveToSentItems: true,
    }),
  })

  // Graph sendMail answers 202 Accepted with an empty body and no message id.
  if (!response.ok) throw new Error(await readProviderError(response))

  return { providerMessageId: null }
}

/**
 * Replies via Graph's createReply -> patch -> send sequence instead of sendMail.
 * This is the only Graph mechanism that keeps the outgoing message attached to
 * the original conversationId and sets proper In-Reply-To/References headers --
 * a message built from scratch (even with matching subject) starts a brand new
 * conversation, which is why plain sendMail silently broke thread continuity
 * for other recipients on the same domain.
 */
async function sendOutlookReply(
  accessToken: string,
  originalMessageId: string,
  input: MailboxSendInput,
): Promise<MailboxSendResult> {
  const createEndpoint = input.cc.length > 0 ? 'createReplyAll' : 'createReply'
  const createResponse = await outlookGraphFetch(
    accessToken,
    `/me/messages/${encodeURIComponent(originalMessageId)}/${createEndpoint}`,
    { method: 'POST', body: JSON.stringify({}) },
  )
  if (!createResponse.ok) throw new Error(await readProviderError(createResponse))

  const draft = await createResponse.json() as Record<string, unknown>
  const draftId = typeof draft.id === 'string' ? draft.id : null
  if (!draftId) throw new Error('Outlook did not return a reply draft id')

  const patchResponse = await outlookGraphFetch(accessToken, `/me/messages/${encodeURIComponent(draftId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      subject: input.subject,
      body: input.bodyHtml
        ? { contentType: 'HTML', content: input.bodyHtml }
        : { contentType: 'Text', content: input.bodyText },
      toRecipients: buildOutlookRecipients(input.to),
      ccRecipients: buildOutlookRecipients(input.cc),
      bccRecipients: buildOutlookRecipients(input.bcc),
    }),
  })
  if (!patchResponse.ok) throw new Error(await readProviderError(patchResponse))

  for (const attachment of input.attachments || []) {
    const attachResponse = await outlookGraphFetch(accessToken, `/me/messages/${encodeURIComponent(draftId)}/attachments`, {
      method: 'POST',
      body: JSON.stringify({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: attachment.filename,
        contentType: attachment.contentType,
        contentBytes: attachment.contentBase64,
      }),
    })
    if (!attachResponse.ok) throw new Error(await readProviderError(attachResponse))
  }

  const sendResponse = await outlookGraphFetch(accessToken, `/me/messages/${encodeURIComponent(draftId)}/send`, {
    method: 'POST',
  })
  if (!sendResponse.ok) throw new Error(await readProviderError(sendResponse))

  return { providerMessageId: draftId }
}

async function sendViaOutlook(accessToken: string, input: MailboxSendInput): Promise<MailboxSendResult> {
  if (input.outlookReplyToMessageId) {
    return sendOutlookReply(accessToken, input.outlookReplyToMessageId, input)
  }
  return sendPlainViaOutlook(accessToken, input)
}

function isUnauthorizedProviderError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return /\b401\b|unauthorized|invalid authentication credentials|invalid_grant|expired/i.test(err.message)
}

/** Sends a message (plain text, or multipart/alternative when bodyHtml is set) through the connected provider account. */
export async function sendMailboxMessage(input: MailboxSendInput): Promise<MailboxSendResult> {
  if (input.to.length === 0) {
    throw new Error('At least one To recipient is required')
  }
  assertHeaderSafe(input.subject, 'Subject')
  assertHeaderSafe(input.fromAddress, 'From address')

  const stored = await getMailboxCredential(input.userId, input.accountId, input.provider)
  if (!stored || !stored.accessToken) {
    throw new Error('Mailbox credentials are missing. Reconnect the account before sending.')
  }

  let credentials: OAuthCredential = stored

  const refreshCredentials = async (): Promise<OAuthCredential> => {
    if (!credentials.refreshToken) {
      throw new Error('Mailbox authorization expired. Reconnect the provider account.')
    }

    const refreshed = await refreshMailboxOAuthAccessToken(input.provider, credentials.refreshToken)
    const next: OAuthCredential = {
      provider: input.provider,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken || credentials.refreshToken,
      expiresAt: refreshed.expiresAt,
      scope: refreshed.scope || credentials.scope,
    }

    await upsertMailboxCredential(input.userId, input.accountId, input.provider, next)
    credentials = next
    return next
  }

  const dispatch = (accessToken: string) => (
    input.provider === 'gmail' ? sendViaGmail(accessToken, input) : sendViaOutlook(accessToken, input)
  )

  try {
    return await dispatch(credentials.accessToken)
  } catch (err) {
    if (!isUnauthorizedProviderError(err)) throw err
    const refreshed = await refreshCredentials()
    return await dispatch(refreshed.accessToken)
  }
}
