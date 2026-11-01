import { Router, Response } from 'express'
import type { Router as RouterType } from 'express'
import { supabaseAdmin } from '../supabaseClient.js'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js'
import { safeErrorMessage } from '../middleware/validation.js'
import {
  encryptPassword,
  decryptPassword,
  testSmtpConfig,
  isEncryptionConfigured,
  type SmtpConfig,
} from '../services/email.js'

const router: RouterType = Router()

router.use(authMiddleware)

// ─── GET /api/smtp-config — Get current user's SMTP config (password masked) ──

router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_smtp_configs')
      .select('id, email_address, smtp_host, smtp_port, smtp_secure, display_name, is_verified, created_at, updated_at')
      .eq('user_id', req.userId!)
      .maybeSingle()

    if (error) throw error

    res.json({ config: data || null })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── PUT /api/smtp-config — Save/update SMTP config ───────────────────────────

router.put('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isEncryptionConfigured()) {
      return res.status(503).json({ error: 'Email configuration is not available. Server encryption key not set.' })
    }

    const { emailAddress, smtpHost, smtpPort, smtpSecure, password, displayName } = req.body

    if (!emailAddress || !password) {
      return res.status(400).json({ error: 'emailAddress and password are required' })
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(emailAddress) || emailAddress.length > 320) {
      return res.status(400).json({ error: 'Invalid email address format' })
    }

    // Validate SMTP host — must be a valid hostname (no URLs, paths, or injection)
    const host = smtpHost || 'smtp.gmail.com'
    if (!/^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host) || host.length > 253) {
      return res.status(400).json({ error: 'Invalid SMTP host' })
    }

    const port = parseInt(smtpPort || '587', 10)
    if (isNaN(port) || port < 1 || port > 65535) {
      return res.status(400).json({ error: 'Invalid SMTP port' })
    }

    const secure = smtpSecure ?? (port === 465)

    // Limit password length to prevent abuse
    if (password.length > 500) {
      return res.status(400).json({ error: 'Password too long' })
    }

    // Limit display name length
    if (displayName && (typeof displayName !== 'string' || displayName.length > 200)) {
      return res.status(400).json({ error: 'Display name too long (max 200 chars)' })
    }

    const encrypted = encryptPassword(password)

    const { data, error } = await supabaseAdmin
      .from('user_smtp_configs')
      .upsert({
        user_id: req.userId,
        email_address: emailAddress,
        smtp_host: host,
        smtp_port: port,
        smtp_secure: secure,
        smtp_password_encrypted: encrypted,
        display_name: displayName || null,
        is_verified: false, // reset on update
      }, { onConflict: 'user_id' })
      .select('id, email_address, smtp_host, smtp_port, smtp_secure, display_name, is_verified, created_at, updated_at')
      .single()

    if (error) throw error

    res.json({ config: data })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── POST /api/smtp-config/test — Test SMTP connection + send verification ────

router.post('/test', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isEncryptionConfigured()) {
      return res.status(503).json({ error: 'Email configuration is not available. Server encryption key not set.' })
    }

    // Load the user's saved config
    const { data: config, error } = await supabaseAdmin
      .from('user_smtp_configs')
      .select('*')
      .eq('user_id', req.userId!)
      .maybeSingle()

    if (error) throw error
    if (!config) {
      return res.status(404).json({ error: 'No SMTP configuration found. Save your config first.' })
    }

    let password: string
    try {
      password = decryptPassword(config.smtp_password_encrypted)
    } catch {
      return res.status(500).json({ error: 'Failed to decrypt stored password. Please re-save your configuration.' })
    }

    const smtpConfig: SmtpConfig = {
      host: config.smtp_host,
      port: config.smtp_port,
      secure: config.smtp_secure,
      user: config.email_address,
      pass: password,
      displayName: config.display_name,
    }

    const result = await testSmtpConfig(smtpConfig)

    if (result.success) {
      // Mark as verified
      await supabaseAdmin
        .from('user_smtp_configs')
        .update({ is_verified: true })
        .eq('id', config.id)
    }

    res.json({ success: result.success, error: result.error || null })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── DELETE /api/smtp-config — Remove SMTP config ─────────────────────────────

router.delete('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('user_smtp_configs')
      .delete()
      .eq('user_id', req.userId!)

    if (error) throw error

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

export default router
