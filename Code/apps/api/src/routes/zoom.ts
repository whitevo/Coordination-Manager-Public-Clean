import { Router, Response, Request } from 'express'
import type { Router as RouterType } from 'express'
import { createHmac, createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { supabaseAdmin } from '../supabaseClient.js'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js'
import { safeErrorMessage } from '../middleware/validation.js'

const router: RouterType = Router()
const devOnlyZoomStateKey = randomBytes(32).toString('hex')

const ZOOM_AUTH_ENDPOINT = 'https://zoom.us/oauth/authorize'
const ZOOM_TOKEN_ENDPOINT = 'https://zoom.us/oauth/token'
const ZOOM_API_BASE = 'https://api.zoom.us/v2'

// ─── Config helpers ──────────────────────────────────────────────────────────

function getZoomOAuthConfig() {
  const clientId = process.env.ZOOM_CLIENT_ID
  const clientSecret = process.env.ZOOM_CLIENT_SECRET
  const redirectUri =
    process.env.ZOOM_REDIRECT_URI ||
    'http://localhost:3001/api/zoom/callback'

  if (!clientId || !clientSecret) {
    throw new Error('Missing ZOOM_CLIENT_ID or ZOOM_CLIENT_SECRET environment variables')
  }

  return { clientId, clientSecret, redirectUri }
}

// ─── Encryption (same scheme as Luma) ────────────────────────────────────────

function getEncryptionKey(): Buffer {
  const envKey = process.env.ZOOM_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY
  if (envKey) return Buffer.from(envKey, 'hex').subarray(0, 32)
  if (process.env.NODE_ENV === 'production') {
    console.warn('⚠️  ZOOM_ENCRYPTION_KEY not set — using insecure dev fallback!')
  }
  return Buffer.alloc(32, 'dev-zoom-key-not-for-production!!')
}

function encrypt(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

function decrypt(stored: string): string {
  const key = getEncryptionKey()
  const [ivHex, tagHex, ciphertextHex] = stored.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const tag = Buffer.from(tagHex, 'hex')
  const ciphertext = Buffer.from(ciphertextHex, 'hex')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return decipher.update(ciphertext) + decipher.final('utf8')
}

// ─── State parameter signing (HMAC) ─────────────────────────────────────────

function getStateSigningKey(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET

  const allowInsecureDevSigning =
    process.env.NODE_ENV === 'test' ||
    (process.env.NODE_ENV !== 'production' && process.env.ALLOW_INSECURE_DEV_SIGNING === 'true')

  if (!allowInsecureDevSigning) {
    throw new Error('JWT_SECRET is required for OAuth state signing')
  }

  return devOnlyZoomStateKey
}

function signState(payload: object): string {
  const json = JSON.stringify(payload)
  const data = Buffer.from(json).toString('base64url')
  const sig = createHmac('sha256', getStateSigningKey()).update(data).digest('base64url')
  return `${data}.${sig}`
}

function verifyState(state: string): object | null {
  const parts = state.split('.')
  if (parts.length !== 2) return null
  const [data, sig] = parts
  const expectedSig = createHmac('sha256', getStateSigningKey()).update(data).digest('base64url')
  if (sig !== expectedSig) return null
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf-8'))
  } catch {
    return null
  }
}

// ─── Token refresh helper ────────────────────────────────────────────────────

async function refreshZoomToken(userId: string): Promise<string> {
  const { data: integration, error } = await supabaseAdmin
    .from('zoom_integrations')
    .select('access_token_encrypted, refresh_token_encrypted, token_expires_at')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  if (error || !integration) throw new Error('No active Zoom integration found')

  // If token is still valid (with 5-min buffer), return it
  if (integration.token_expires_at) {
    const expiresAt = new Date(integration.token_expires_at).getTime()
    if (expiresAt > Date.now() + 5 * 60 * 1000) {
      return decrypt(integration.access_token_encrypted)
    }
  }

  // Refresh the token
  const { clientId, clientSecret } = getZoomOAuthConfig()
  const refreshToken = decrypt(integration.refresh_token_encrypted)

  const tokenRes = await fetch(ZOOM_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (!tokenRes.ok) {
    const errText = await tokenRes.text()
    console.error('Zoom token refresh failed:', tokenRes.status, errText)
    // Mark integration as inactive if refresh fails
    await supabaseAdmin
      .from('zoom_integrations')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
    throw new Error('Zoom token refresh failed. Please reconnect your account.')
  }

  const tokens = await tokenRes.json() as { access_token: string; refresh_token?: string; expires_in?: number }
  const newAccessToken = tokens.access_token
  const newRefreshToken = tokens.refresh_token || refreshToken
  const expiresIn = tokens.expires_in || 3600

  await supabaseAdmin
    .from('zoom_integrations')
    .update({
      access_token_encrypted: encrypt(newAccessToken),
      refresh_token_encrypted: encrypt(newRefreshToken),
      token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)

  return newAccessToken
}

// ─── POST /api/zoom/deauthorize — Zoom compliance webhook ───────────────────
// Zoom sends this when a user uninstalls the app from Zoom's side.
// Required for published Zoom apps.

router.post('/deauthorize', async (req: Request, res: Response) => {
  try {
    const event = req.body?.event
    const payload = req.body?.payload

    if (event !== 'app_deauthorized' || !payload) {
      return res.status(400).json({ error: 'Invalid event' })
    }

    // Verify the webhook came from Zoom using the verification token
    const verificationToken = process.env.ZOOM_VERIFICATION_TOKEN
    if (verificationToken && req.headers.authorization !== verificationToken) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const zoomUserId = payload.user_id
    if (zoomUserId) {
      // Remove the integration for this Zoom user
      await supabaseAdmin
        .from('zoom_integrations')
        .delete()
        .eq('zoom_user_id', zoomUserId)
    }

    // Zoom requires a data compliance response
    const { clientId } = getZoomOAuthConfig()
    await fetch('https://api.zoom.us/oauth/data/compliance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        user_id: zoomUserId,
        account_id: payload.account_id,
        deauthorization_event_received: payload,
        compliance_completed: true,
      }),
    })

    res.json({ message: 'Deauthorization processed' })
  } catch (err) {
    console.error('Zoom deauthorize error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// ─── Auth middleware for all routes EXCEPT callback & deauthorize ────────────

router.use((req, res, next) => {
  if (req.path === '/callback' && req.method === 'GET') {
    return next()
  }
  if (req.path === '/deauthorize' && req.method === 'POST') {
    return next()
  }
  return authMiddleware(req as AuthenticatedRequest, res, next)
})

// ─── GET /api/zoom/integration — Get connection status ──────────────────────

router.get('/integration', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('zoom_integrations')
      .select('id, zoom_user_id, zoom_email, zoom_display_name, is_active, created_at, updated_at')
      .eq('user_id', req.userId!)
      .eq('is_active', true)
      .maybeSingle()

    if (error) throw error

    res.json({ integration: data })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── GET /api/zoom/auth-url — Generate OAuth consent URL ────────────────────

router.get('/auth-url', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { clientId, redirectUri } = getZoomOAuthConfig()

    // Optional returnTo path — validated to be a relative URL to prevent open redirect
    const returnTo = typeof req.query.returnTo === 'string' && req.query.returnTo.startsWith('/')
      ? req.query.returnTo
      : undefined

    const state = signState({
      userId: req.userId,
      ts: Date.now(),
      ...(returnTo ? { returnTo } : {}),
    })

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
    })

    res.json({ url: `${ZOOM_AUTH_ENDPOINT}?${params.toString()}` })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── GET /api/zoom/callback — OAuth callback from Zoom ──────────────────────

router.get('/callback', async (req: Request, res: Response) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'

  try {
    const { code, state, error: oauthError } = req.query

    if (oauthError) {
      return res.redirect(`${frontendUrl}/settings?tab=calendar&section=integrations&zoom_error=${encodeURIComponent(oauthError as string)}`)
    }

    if (!code || !state) {
      return res.redirect(`${frontendUrl}/settings?tab=calendar&section=integrations&zoom_error=missing_params`)
    }

    // Verify signed state
    const statePayload = verifyState(state as string) as { userId?: string; returnTo?: string } | null
    if (!statePayload?.userId) {
      return res.redirect(`${frontendUrl}/settings?tab=calendar&section=integrations&zoom_error=invalid_state`)
    }

    const userId = statePayload.userId

    // Exchange code for tokens
    const { clientId, clientSecret, redirectUri } = getZoomOAuthConfig()

    const tokenRes = await fetch(ZOOM_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: redirectUri,
      }),
    })

    if (!tokenRes.ok) {
      const errText = await tokenRes.text()
      console.error('Zoom token exchange failed:', tokenRes.status, errText)
      return res.redirect(`${frontendUrl}/settings?tab=calendar&section=integrations&zoom_error=token_exchange_failed`)
    }

    const tokens = await tokenRes.json() as { access_token: string; refresh_token: string; expires_in?: number }

    // Get user info from Zoom
    const userRes = await fetch(`${ZOOM_API_BASE}/users/me`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })

    let zoomUserId: string | null = null
    let zoomEmail: string | null = null
    let zoomDisplayName: string | null = null

    if (userRes.ok) {
      const userInfo = await userRes.json() as { id?: string; email?: string; display_name?: string; first_name?: string }
      zoomUserId = userInfo.id || null
      zoomEmail = userInfo.email || null
      zoomDisplayName = userInfo.display_name || userInfo.first_name || null
    }

    // Store encrypted tokens
    const expiresIn = tokens.expires_in || 3600

    const { error: dbError } = await supabaseAdmin
      .from('zoom_integrations')
      .upsert({
        user_id: userId,
        access_token_encrypted: encrypt(tokens.access_token),
        refresh_token_encrypted: encrypt(tokens.refresh_token),
        zoom_user_id: zoomUserId,
        zoom_email: zoomEmail,
        zoom_display_name: zoomDisplayName,
        token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
        is_active: true,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id',
      })

    if (dbError) {
      console.error('Zoom integration DB error:', dbError)
      return res.redirect(`${frontendUrl}/settings?tab=calendar&section=integrations&zoom_error=db_error`)
    }

    // If a returnTo path was provided (e.g. from the calendar side panel),
    // redirect there with zoom_success appended instead of going to settings.
    const returnTo = statePayload.returnTo as string | undefined
    if (returnTo && typeof returnTo === 'string' && returnTo.startsWith('/')) {
      const sep = returnTo.includes('?') ? '&' : '?'
      return res.redirect(`${frontendUrl}${returnTo}${sep}zoom_success=true`)
    }

    res.redirect(`${frontendUrl}/settings?tab=calendar&section=integrations&zoom_success=true`)
  } catch (err) {
    console.error('Zoom callback error:', err)
    res.redirect(`${frontendUrl}/settings?tab=calendar&section=integrations&zoom_error=unknown`)
  }
})

// ─── DELETE /api/zoom/disconnect — Remove integration ───────────────────────

router.delete('/disconnect', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('zoom_integrations')
      .delete()
      .eq('user_id', req.userId!)

    if (error) throw error

    res.json({ message: 'Zoom integration disconnected' })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── POST /api/zoom/create-meeting — Create a Zoom meeting ─────────────────

router.post('/create-meeting', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { topic, startTime, duration, timezone, agenda } = req.body

    if (!topic) {
      return res.status(400).json({ error: 'Meeting topic is required' })
    }

    const accessToken = await refreshZoomToken(req.userId!)

    const meetingPayload: Record<string, unknown> = {
      topic,
      type: startTime ? 2 : 1, // 2 = scheduled, 1 = instant
      settings: {
        join_before_host: true,
        waiting_room: false,
        approval_type: 2,           // No registration required
        auto_recording: 'none',
        meeting_authentication: false,
        continuous_meeting_chat: {
          enable: true,
          auto_add_invited_external_users: true,
        },
      },
    }
    if (startTime) meetingPayload.start_time = startTime
    if (duration) meetingPayload.duration = duration
    if (timezone) meetingPayload.timezone = timezone
    if (agenda) meetingPayload.agenda = agenda

    const meetingRes = await fetch(`${ZOOM_API_BASE}/users/me/meetings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(meetingPayload),
    })

    if (!meetingRes.ok) {
      const errBody = await meetingRes.text()
      console.error('Zoom create meeting error:', meetingRes.status, errBody)
      return res.status(meetingRes.status === 429 ? 429 : 502).json({
        error: meetingRes.status === 429
          ? 'Zoom rate limit exceeded. Please wait and try again.'
          : `Zoom API error: ${errBody}`,
      })
    }

    const meeting = await meetingRes.json() as {
      id?: number
      join_url?: string
      start_url?: string
      password?: string
      topic?: string
    }

    res.json({
      meeting_id: meeting.id,
      join_url: meeting.join_url,
      start_url: meeting.start_url,
      password: meeting.password,
      topic: meeting.topic,
    })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

export default router
