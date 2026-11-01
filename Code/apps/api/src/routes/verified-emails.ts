import { Router, Response } from 'express'
import type { Router as RouterType } from 'express'
import { supabaseAdmin } from '../supabaseClient.js'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js'
import { safeErrorMessage } from '../middleware/validation.js'
import { sendEmail, getPlatformSmtpConfig } from '../services/email.js'
import { randomBytes, createHash } from 'crypto'

const router: RouterType = Router()

// All routes except the public abuse-report endpoint require auth
// The abuse report route is registered separately in index.ts

router.use(authMiddleware)

// ─── GET / — List user's verified emails ──────────────────────────────────────

router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('verified_emails')
      .select('id, email, verification_method, is_primary, verified_at, created_at')
      .eq('user_id', req.userId!)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true })

    if (error) throw error

    res.json({ emails: data || [] })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── POST /send-code — Send verification code to an email ─────────────────────

router.post('/send-code', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { email } = req.body
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required' })
    }

    const emailLower = email.toLowerCase().trim()

    // Validate email format
    if (!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(emailLower) || emailLower.length > 320) {
      return res.status(400).json({ error: 'Invalid email address' })
    }

    // Check if already verified by this user
    const { data: existing } = await supabaseAdmin
      .from('verified_emails')
      .select('id')
      .eq('user_id', req.userId!)
      .eq('email', emailLower)
      .maybeSingle()

    if (existing) {
      return res.status(400).json({ error: 'This email is already verified' })
    }

    // Check abuse timeout — block if email was reported
    const { data: timeout } = await supabaseAdmin
      .from('email_verification_timeouts')
      .select('timeout_until')
      .eq('email', emailLower)
      .maybeSingle()

    if (timeout && new Date(timeout.timeout_until) > new Date()) {
      return res.status(429).json({ error: 'Verification emails to this address are temporarily blocked. Please try again later.' })
    }

    // Rate limit: max 3 pending codes per email per hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count } = await supabaseAdmin
      .from('email_verification_codes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', req.userId!)
      .eq('email', emailLower)
      .eq('used', false)
      .gte('created_at', oneHourAgo)

    if ((count || 0) >= 3) {
      return res.status(429).json({ error: 'Too many verification attempts. Please wait before trying again.' })
    }

    // Generate 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000))
    const codeHash = createHash('sha256').update(code).digest('hex')
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString() // 15 min

    // Generate abuse report token
    const reportToken = randomBytes(32).toString('hex')

    // Store the verification code
    const { error: insertError } = await supabaseAdmin
      .from('email_verification_codes')
      .insert({
        user_id: req.userId,
        email: emailLower,
        code_hash: codeHash,
        expires_at: expiresAt,
      })

    if (insertError) throw insertError

    // Store or update the report token for this email (so the verification email links work)
    await supabaseAdmin
      .from('email_verification_timeouts')
      .upsert({
        email: emailLower,
        report_token: reportToken,
        reported_at: new Date(0).toISOString(), // not reported yet
        timeout_until: new Date(0).toISOString(), // not timed out
      }, { onConflict: 'email' })

    // Build the abuse report URL (points to API which redirects to frontend)
    const apiBase = process.env.API_URL || `http://localhost:${process.env.PORT || 3001}`
    const reportUrl = `${apiBase}/api/email-abuse/report/${reportToken}`

    // Send professional verification email
    const smtpConfig = getPlatformSmtpConfig()
    const emailBody = [
      'Coordination Manager - Email Verification',
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      `Your verification code is:  ${code}`,
      '',
      'Enter this code on the Coordination Manager website to verify your email address.',
      'This code expires in 15 minutes.',
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      'If you did not request this verification, someone may have entered your',
      'email address by mistake. You can safely ignore this email.',
      '',
      'If you believe your email address is being misused, click the link below',
      'to block further verification attempts for 48 hours:',
      '',
      `Report abuse: ${reportUrl}`,
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      'Coordination Manager',
      'https://coordinationmanager.com',
    ].join('\n')

    const result = await sendEmail(
      emailLower,
      'Coordination Manager - Verify Your Email Address',
      emailBody,
      smtpConfig,
    )

    if (!result.success) {
      return res.status(500).json({ error: `Failed to send verification email: ${result.error}` })
    }

    res.json({ success: true, message: 'Verification code sent. Check your inbox.' })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── POST /verify-code — Verify with the 6-digit code ────────────────────────

router.post('/verify-code', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { email, code } = req.body
    if (!email || !code) {
      return res.status(400).json({ error: 'Email and code are required' })
    }

    const emailLower = email.toLowerCase().trim()
    const codeHash = createHash('sha256').update(String(code).trim()).digest('hex')

    // Find matching unused code
    const { data: verification, error: findError } = await supabaseAdmin
      .from('email_verification_codes')
      .select('id, expires_at, attempts')
      .eq('user_id', req.userId!)
      .eq('email', emailLower)
      .eq('code_hash', codeHash)
      .eq('used', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (findError) throw findError

    if (!verification) {
      // Increment attempts on the latest code for this email to detect brute force
      const { data: latestCode } = await supabaseAdmin
        .from('email_verification_codes')
        .select('id, attempts')
        .eq('user_id', req.userId!)
        .eq('email', emailLower)
        .eq('used', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (latestCode) {
        await supabaseAdmin
          .from('email_verification_codes')
          .update({ attempts: latestCode.attempts + 1 })
          .eq('id', latestCode.id)

        // Lock out after 5 failed attempts
        if (latestCode.attempts + 1 >= 5) {
          await supabaseAdmin
            .from('email_verification_codes')
            .update({ used: true })
            .eq('id', latestCode.id)
          return res.status(400).json({ error: 'Too many failed attempts. Please request a new code.' })
        }
      }

      return res.status(400).json({ error: 'Invalid verification code' })
    }

    // Check expiry
    if (new Date(verification.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Verification code has expired. Please request a new one.' })
    }

    // Mark code as used
    await supabaseAdmin
      .from('email_verification_codes')
      .update({ used: true })
      .eq('id', verification.id)

    // Check if this is the user's first verified email (make it primary)
    const { count: existingCount } = await supabaseAdmin
      .from('verified_emails')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', req.userId!)

    const isPrimary = (existingCount || 0) === 0

    // Insert verified email
    const { data: verified, error: insertError } = await supabaseAdmin
      .from('verified_emails')
      .upsert({
        user_id: req.userId,
        email: emailLower,
        verification_method: 'code',
        verified_at: new Date().toISOString(),
        is_primary: isPrimary,
      }, { onConflict: 'user_id,email' })
      .select()
      .single()

    if (insertError) throw insertError

    res.json({ success: true, email: verified })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── POST /google — Auto-verify from Google OAuth session ─────────────────────

router.post('/google', async (req: AuthenticatedRequest, res: Response) => {
  try {
    // The user's Google email is available from their Supabase auth profile
    const googleEmail = req.userEmail
    if (!googleEmail || googleEmail.endsWith('@cardano.wallet')) {
      return res.status(400).json({ error: 'No Google email associated with this account' })
    }

    // Check if already verified
    const { data: existing } = await supabaseAdmin
      .from('verified_emails')
      .select('id')
      .eq('user_id', req.userId!)
      .eq('email', googleEmail.toLowerCase())
      .maybeSingle()

    if (existing) {
      return res.json({ success: true, message: 'Email already verified', alreadyVerified: true })
    }

    // Check if this is the user's first verified email
    const { count: existingCount } = await supabaseAdmin
      .from('verified_emails')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', req.userId!)

    const isPrimary = (existingCount || 0) === 0

    const { data: verified, error } = await supabaseAdmin
      .from('verified_emails')
      .insert({
        user_id: req.userId,
        email: googleEmail.toLowerCase(),
        verification_method: 'google_oauth',
        verified_at: new Date().toISOString(),
        is_primary: isPrimary,
      })
      .select()
      .single()

    if (error) throw error

    res.json({ success: true, email: verified })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── PUT /:id/primary — Set a verified email as primary ───────────────────────

router.put('/:id/primary', async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Verify ownership
    const { data: email } = await supabaseAdmin
      .from('verified_emails')
      .select('id')
      .eq('id', req.params.id)
      .eq('user_id', req.userId!)
      .maybeSingle()

    if (!email) return res.status(404).json({ error: 'Verified email not found' })

    // Unset all primaries for this user
    await supabaseAdmin
      .from('verified_emails')
      .update({ is_primary: false })
      .eq('user_id', req.userId!)

    // Set the selected one as primary
    const { data, error } = await supabaseAdmin
      .from('verified_emails')
      .update({ is_primary: true })
      .eq('id', req.params.id)
      .eq('user_id', req.userId!)
      .select()
      .single()

    if (error) throw error

    res.json({ email: data })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

// ─── DELETE /:id — Remove a verified email ────────────────────────────────────

router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('verified_emails')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.userId!)
      .select()
      .single()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Verified email not found' })

    // If we deleted the primary, promote the next one
    if (data.is_primary) {
      const { data: next } = await supabaseAdmin
        .from('verified_emails')
        .select('id')
        .eq('user_id', req.userId!)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (next) {
        await supabaseAdmin
          .from('verified_emails')
          .update({ is_primary: true })
          .eq('id', next.id)
      }
    }

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) })
  }
})

export default router
