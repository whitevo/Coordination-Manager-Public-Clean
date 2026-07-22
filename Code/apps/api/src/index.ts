import dotenv from 'dotenv'
dotenv.config()

import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import { errorHandler } from './middleware/error-handler.js'
import healthRoutes from './routes/health.js'
import calendarsRoutes from './routes/calendars.js'
import availabilityRoutes from './routes/availability.js'
import meetingsRoutes from './routes/meetings.js'
import authRoutes from './routes/auth.js'
import walletAuthRoutes from './routes/wallet-auth.js'
import calendarSourcesRoutes from './routes/calendar-sources.js'
import discordRoutes from './routes/discord.js'
import announcementsRoutes from './routes/announcements.js'
import feedbackRoutes from './routes/feedback.js'
import aiFeedbackRoutes from './routes/ai-feedback.js'
import aiChatRoutes from './routes/ai-chat.js'
import agentApiRoutes from './routes/agent-api.js'
import userEventsRoutes, { runPersistedUserEventAutoSync } from './routes/user-events.js'
import timeManagementRoutes from './routes/time-management.js'
import calendarSubscriptionsRoutes from './routes/calendar-subscriptions.js'
import adminRoutes from './routes/admin.js'
import lumaRoutes from './routes/luma.js'
import zoomRoutes from './routes/zoom.js'
import guardianRoutes from './routes/guardian.js'
import figmaRoutes from './routes/figma.js'
import emailContactsRoutes from './routes/email-contacts.js'
import privacySettingsRoutes from './routes/privacy-settings.js'
import notificationPreferencesRoutes from './routes/notification-preferences.js'
import connectionsRoutes from './routes/connections.js'
import smtpConfigRoutes from './routes/smtp-config.js'
import verifiedEmailsRoutes from './routes/verified-emails.js'
import networkRelationsRoutes from './routes/network-relations.js'
import setupRoutes from './routes/setup.js'
import { sendEmail, decryptPassword, getPlatformSmtpConfig } from './services/email.js'
import { supabaseAdmin, isSupabaseConfigured } from './supabaseClient.js'
import { printSetupBanner } from './services/local-config.js'
import { registerRateLimiters } from './config/rate-limiters.js'
import { timingSafeEqual } from 'crypto'

const app = express()
const PORT = process.env.PORT || 3001

// Trust the first reverse proxy (Railway / Nixpacks / load-balancer).
// This ensures req.ip reflects the real client IP from X-Forwarded-For
// for routes that intentionally inspect the forwarded client address
// (for example captcha verification and request logging).
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1)
}

// Middleware

// CORS must be applied BEFORE helmet and rate limiters so that:
// 1. Preflight OPTIONS requests are handled without hitting rate limits
// 2. Rate-limited responses still include proper CORS headers
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://coordinationmanager.com',
  'https://www.coordinationmanager.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
].filter((v, i, arr) => Boolean(v) && arr.indexOf(v) === i) as string[]

console.log('CORS allowed origins:', allowedOrigins)

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g., mobile apps, curl, health checks)
      if (!origin) return callback(null, true)
      if (allowedOrigins.some(allowed => origin === allowed)) {
        return callback(null, true)
      }
      // Strip CR/LF from origin before logging to prevent log injection
      const safeOrigin = origin.replace(/[\r\n]/g, '')
      console.warn(`CORS blocked origin: ${safeOrigin}`)
      callback(null, false)
    },
    credentials: true,
    maxAge: 86400, // Cache preflight OPTIONS responses for 24 hours
    exposedHeaders: ['X-RateLimit-Warn'], // Allow frontend to read soft-limit warning
  })
)

// Helmet after CORS -- disable policies that conflict with cross-origin API usage
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  })
)

// ─── Rate Limiting ────────────────────────────────────────────────────

// Skip all rate limits for localhost (dev environment only).
// In production every request is subject to the limits below.
//
// IMPORTANT: We intentionally use req.socket.remoteAddress (the actual TCP
// connection address) rather than req.ip.  req.ip can be influenced by the
// X-Forwarded-For header, which an attacker could set to "127.0.0.1" from
// the public internet to bypass every limiter.  The socket address is the
// real transport-layer peer and cannot be spoofed via HTTP headers.
const skipLocalhost = (req: express.Request): boolean => {
  if (process.env.NODE_ENV === 'production') return false
  const socketAddr = req.socket?.remoteAddress ?? ''
  return (
    socketAddr === '127.0.0.1' ||
    socketAddr === '::1' ||
    socketAddr === '::ffff:127.0.0.1'
  )
}

registerRateLimiters({ app, skipLocalhost })

// ─── Soft-limit warning header ───────────────────────────────────────────
// All limits above are 4x the "comfortable" threshold. When a client has used
// more than 75% of the hard limit (i.e. the old limit), we add a warning
// header so the frontend can show a yellow banner.
app.use((req, res, next) => {
  const originalEnd = res.end.bind(res) as (...args: unknown[]) => ReturnType<typeof res.end>
  res.end = ((...args: unknown[]) => {
    const skipWarnHeader =
      req.path === '/health' ||
      req.path === '/api/connections/new-count'

    const limit = res.getHeader('ratelimit-limit')
    const remaining = res.getHeader('ratelimit-remaining')
    if (!skipWarnHeader && limit != null && remaining != null) {
      const max = Number(limit)
      const left = Number(remaining)
      // Warn when 75% consumed (= only 25% remaining = old limit threshold)
      if (max > 0 && left <= max * 0.25) {
        res.setHeader('X-RateLimit-Warn', 'true')
      }
    }
    return originalEnd(...args)
  }) as typeof res.end
  next()
})

// AI chat requests can include large payloads (channel lists, DM member lists)
app.use('/api/ai-chat', express.json({ limit: '1mb' }))
// Announcement schedules can include many targets with body overrides
app.use('/api/announcements', express.json({ limit: '1mb' }))
app.use(express.json())
// Use 'short' format in production to avoid verbose output and potential info leakage.
// 'dev' format includes colored status codes and response times useful for local debugging.
app.use(morgan(process.env.NODE_ENV === 'production' ? 'short' : 'dev'))

// Routes
app.use('/health', healthRoutes)
// Setup wizard -- must be registered BEFORE any route that requires Supabase
// so the API can serve the wizard even when DB credentials are missing.
app.use('/api/setup', setupRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/auth/wallet', walletAuthRoutes)
app.use('/api/calendars', calendarsRoutes)
app.use('/api/calendar-sources', calendarSourcesRoutes)
app.use('/api/discord', discordRoutes)
app.use('/api/announcements', announcementsRoutes)
app.use('/api/feedback', feedbackRoutes)
app.use('/api/ai-feedback', aiFeedbackRoutes)
app.use('/api/ai-chat', aiChatRoutes)
app.use('/api/agent', agentApiRoutes)
app.use('/api/availability', availabilityRoutes)
app.use('/api/meetings', meetingsRoutes)
app.use('/api/user-events', userEventsRoutes)
app.use('/api/time-management', timeManagementRoutes)
app.use('/api/calendar-subscriptions', calendarSubscriptionsRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/luma', lumaRoutes)
app.use('/api/zoom', zoomRoutes)
app.use('/api/guardian', guardianRoutes)
app.use('/api/figma', figmaRoutes)
app.use('/api/email-contacts', emailContactsRoutes)
app.use('/api/privacy-settings', privacySettingsRoutes)
app.use('/api/notification-preferences', notificationPreferencesRoutes)
app.use('/api/connections', connectionsRoutes)
app.use('/api/smtp-config', smtpConfigRoutes)
app.use('/api/verified-emails', verifiedEmailsRoutes)
app.use('/api/network-relations', networkRelationsRoutes)

// ─── Internal email endpoint (called by bot with BOT_API_SECRET) ──────────────
app.post('/api/internal/send-email', async (req, res) => {
  // Timing-safe secret comparison to prevent timing attacks
  const secret = req.headers['x-bot-secret']
  const expected = process.env.BOT_API_SECRET
  if (!secret || !expected || typeof secret !== 'string') {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    const secretBuf = Buffer.from(secret, 'utf8')
    const expectedBuf = Buffer.from(expected, 'utf8')
    if (secretBuf.length !== expectedBuf.length || !timingSafeEqual(secretBuf, expectedBuf)) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  } catch {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { to, subject, textBody, senderUsername, senderUserId } = req.body
  if (!to || !subject) {
    return res.status(400).json({ error: 'Missing required fields: to, subject' })
  }

  // Validate email format
  if (typeof to !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || to.length > 320) {
    return res.status(400).json({ error: 'Invalid recipient email address' })
  }

  // Enforce length limits to prevent abuse
  if (typeof subject !== 'string' || subject.length > 500) {
    return res.status(400).json({ error: 'Subject too long (max 500 chars)' })
  }
  if (textBody && (typeof textBody !== 'string' || textBody.length > 10_000)) {
    return res.status(400).json({ error: 'Email body too long (max 10000 chars)' })
  }

  // Check email opt-out
  const { data: optOut } = await supabaseAdmin
    .from('email_opt_outs')
    .select('id')
    .eq('email', to.toLowerCase())
    .limit(1)
    .maybeSingle()

  if (optOut) {
    return res.json({ success: false, error: 'Recipient has opted out of emails' })
  }

  // Try user's SMTP config first, then platform default
  let smtpConfig = getPlatformSmtpConfig()
  if (senderUserId) {
    try {
      const { data } = await supabaseAdmin
        .from('user_smtp_configs')
        .select('*')
        .eq('user_id', senderUserId)
        .eq('is_verified', true)
        .maybeSingle()

      if (data) {
        smtpConfig = {
          host: data.smtp_host,
          port: data.smtp_port,
          secure: data.smtp_secure,
          user: data.email_address,
          pass: decryptPassword(data.smtp_password_encrypted),
          displayName: data.display_name || undefined,
        }
      }
    } catch (err) {
      console.warn('[internal/send-email] Failed to load user SMTP config:', err)
    }
  }

  const result = await sendEmail(to, subject, textBody || '', smtpConfig, senderUsername)
  res.json(result)
})

// ─── Public abuse report endpoint (no auth required) ──────────────────────────
app.get('/api/email-abuse/report/:token', async (req, res) => {
  const { token } = req.params
  if (!token || typeof token !== 'string' || token.length !== 64) {
    return res.status(400).json({ error: 'Invalid report token' })
  }

  try {
    const { data: timeout, error } = await supabaseAdmin
      .from('email_verification_timeouts')
      .select('email, timeout_until')
      .eq('report_token', token)
      .maybeSingle()

    if (error) throw error
    if (!timeout) {
      return res.status(404).json({ error: 'Report token not found or already expired' })
    }

    // Set 48-hour timeout from now
    const timeoutUntil = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
    await supabaseAdmin
      .from('email_verification_timeouts')
      .update({
        reported_at: new Date().toISOString(),
        timeout_until: timeoutUntil,
      })
      .eq('report_token', token)

    // Redirect to frontend abuse confirmation page
    const siteBase = process.env.FRONTEND_URL || 'http://localhost:5173'
    res.redirect(`${siteBase}/email-abuse?reported=true`)
  } catch {
    res.status(500).json({ error: 'Failed to process report' })
  }
})

// 404 catch-all — must come after all route registrations
app.use((_req, res) => {
  res.status(404).json({
    error: 'NOT_FOUND',
    message: `Cannot ${_req.method} ${_req.path}`,
    statusCode: 404,
  })
})

// ─── Required Environment Validation ──────────────────────────────────────────
// JWT_SECRET is used for HMAC signing (OAuth state, wallet credentials).
// Without it, cryptographic operations use predictable values -- fatal in production.
if (!process.env.JWT_SECRET) {
  const allowInsecureDevSigning =
    process.env.NODE_ENV === 'test' ||
    (process.env.NODE_ENV !== 'production' && process.env.ALLOW_INSECURE_DEV_SIGNING === 'true')

  if (!allowInsecureDevSigning) {
    console.error('FATAL: JWT_SECRET environment variable is required for cryptographic signing.')
    console.error('Set JWT_SECRET to a random 64+ character string and restart.')
    console.error('Local-only override: set ALLOW_INSECURE_DEV_SIGNING=true (never in production).')
    process.exit(1)
  }

  console.warn('WARNING: JWT_SECRET is not set. ALLOW_INSECURE_DEV_SIGNING=true is enabled.')
  console.warn('WARNING: Development-only ephemeral signing keys will be used for this process.')
}

// Error handling
app.use(errorHandler)

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`)
  console.log(`📝 Environment: ${process.env.NODE_ENV}`)
  // If the app booted without DB credentials, print the setup banner with
  // the one-time token so the user can complete the wizard.
  if (!isSupabaseConfigured() && process.env.NODE_ENV !== 'production') {
    printSetupBanner()
  }

  const autoSyncEnabled = process.env.USER_EVENTS_SERVER_AUTO_SYNC_ENABLED !== 'false'
  if (autoSyncEnabled) {
    const intervalMsRaw = Number(process.env.USER_EVENTS_SERVER_AUTO_SYNC_INTERVAL_MS)
    const intervalMs = Number.isFinite(intervalMsRaw)
      ? Math.max(60_000, Math.floor(intervalMsRaw))
      : 5 * 60 * 1000

    const maxUsersRaw = Number(process.env.USER_EVENTS_SERVER_AUTO_SYNC_MAX_USERS)
    const maxUsers = Number.isFinite(maxUsersRaw)
      ? Math.max(1, Math.floor(maxUsersRaw))
      : 100

    let inFlight = false
    const runPass = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const summary = await runPersistedUserEventAutoSync({ maxUsers })
        if (summary.syncedSources > 0 || summary.failedSources > 0) {
          console.log(
            `[user-events:auto-sync] users=${summary.users} sources=${summary.syncedSources} failed=${summary.failedSources} +${summary.inserted} ~${summary.updated} -${summary.deleted}`
          )
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Server auto-sync failed'
        console.error(`[user-events:auto-sync] ${message}`)
      } finally {
        inFlight = false
      }
    }

    setTimeout(() => {
      void runPass()
    }, 20_000)

    setInterval(() => {
      void runPass()
    }, intervalMs)

    console.log(`[user-events:auto-sync] enabled interval=${Math.floor(intervalMs / 1000)}s maxUsers=${maxUsers}`)
  } else {
    console.log('[user-events:auto-sync] disabled by USER_EVENTS_SERVER_AUTO_SYNC_ENABLED=false')
  }
})
