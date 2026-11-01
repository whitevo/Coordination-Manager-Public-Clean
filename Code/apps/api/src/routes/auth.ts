import { Router, Response, NextFunction } from 'express'
import { randomBytes, randomUUID } from 'crypto'
import { supabaseAdmin } from '../supabaseClient.js'
import { authMiddleware, createIsolatedAuthClient, getTrustedAuthMetadata, AuthenticatedRequest } from '../middleware/auth.js'
import { ValidationError, UnauthorizedError, ApplicationError } from '../middleware/error-handler.js'
import { createMergeToken, consumeMergeToken, mergeAccounts } from '../services/account-merge.js'
import { verifyCaptcha } from '../services/captcha.js'
import { recordSignup, getCaptchaStatus, getSignupSource } from '../services/signup-rate-tracker.js'

const router: ReturnType<typeof Router> = Router()

/** Traveler (guest) accounts expire after this many days. */
const TRAVELER_EXPIRY_DAYS = 64
const TRAVELER_EXPIRY_MS = TRAVELER_EXPIRY_DAYS * 24 * 60 * 60 * 1000

// ── Traveler name generator ──────────────────────────────────────────

const ADJECTIVES = [
  'Wandering', 'Curious', 'Swift', 'Gentle', 'Bold', 'Silent', 'Bright',
  'Drifting', 'Calm', 'Eager', 'Nimble', 'Steady', 'Vivid', 'Quiet',
  'Roaming', 'Flowing', 'Distant', 'Rising', 'Gleaming', 'Whispering',
]
const NOUNS = [
  'Falcon', 'Tide', 'Ember', 'Creek', 'Sage', 'Breeze', 'Fox',
  'Meadow', 'Comet', 'Ridge', 'Heron', 'Cloud', 'Stone', 'Willow',
  'Spark', 'River', 'Leaf', 'Peak', 'Dove', 'Trail',
]

function generateTravelerName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  const num = Math.floor(Math.random() * 100)
  return `${adj} ${noun} ${num}`
}

// ── Guest / Traveler sign-in ─────────────────────────────────────────

/**
 * POST /api/auth/guest
 * Create an anonymous "Traveler" account via Supabase anonymous sign-in.
 * No email or password required.
 */
router.post('/guest', async (req, res: Response, next: NextFunction) => {
  try {
    const { captchaToken } = req.body || {}
    await verifyCaptcha(captchaToken, req.ip)

    const travelerId = randomUUID()
    const tempEmail = `traveler-${travelerId}@guest.local`
    const tempPassword = randomBytes(32).toString('hex')
    const travelerName = generateTravelerName()

    // Create user with a generated email/password
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: tempEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        account_type: 'traveler',
        display_name: travelerName,
      },
      app_metadata: { account_type: 'traveler' },
    })

    if (error || !data.user) {
      console.error('Failed to create traveler account:', error?.message, error?.status)
      throw new ApplicationError(
        'Unable to create traveler account. Please try again later.',
        503,
        'TRAVELER_CREATE_FAILED'
      )
    }

    // Create user profile in our users table
    const expiresAt = new Date(Date.now() + TRAVELER_EXPIRY_MS)

    const newProfile: Record<string, unknown> = {
      id: data.user.id,
      email: null,
      display_name: travelerName,
      avatar_url: null,
      google_id: null,
      timezone: 'UTC',
      roles: ['traveler'],
      account_type: 'traveler',
      traveler_name: travelerName,
      expires_at: expiresAt.toISOString(),
      last_login_at: new Date().toISOString(),
      signup_source: getSignupSource(req),
    }

    // Use admin client to bypass RLS for profile creation
    const { error: profileError } = await supabaseAdmin
      .from('users')
      .upsert(newProfile)

    if (profileError) {
      console.error('Failed to create traveler profile:', profileError)
    }

    // Sign in with a temporary per-request client to avoid contaminating
    // the shared server supabase client's session state.
    // Use the service-role key so the request bypasses Supabase's built-in
    // CAPTCHA enforcement — our own verifyCaptcha() already consumed the
    // one-time Turnstile token earlier in this handler.
    const tempClient = createIsolatedAuthClient()
    const { data: signInData, error: signInError } = await tempClient.auth.signInWithPassword({
      email: tempEmail,
      password: tempPassword,
    })

    if (signInError || !signInData.session) {
      console.error('Failed to sign in traveler:', signInError?.message, signInError?.status)
      await supabaseAdmin.auth.admin.deleteUser(data.user.id).catch(() => {})
      throw new ApplicationError(
        'Unable to create traveler session. Please try again later.',
        503,
        'TRAVELER_SESSION_FAILED'
      )
    }

    // Record successful signup for rate-tracking (captcha spike detection)
    recordSignup()

    res.json({
      success: true,
      session: {
        access_token: signInData.session.access_token,
        refresh_token: signInData.session.refresh_token,
        expires_in: signInData.session.expires_in,
        expires_at: signInData.session.expires_at,
      },
      user: {
        id: data.user.id,
        displayName: travelerName,
        accountType: 'traveler',
        expiresAt: expiresAt.toISOString(),
        roles: ['traveler'],
      },
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/auth/me
 * Get current authenticated user profile
 */
router.get('/me', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!

    // Fetch user profile from the users table
    // Use supabaseAdmin to bypass RLS (the server anon-key client has no user
    // context so auth.uid() is NULL and the SELECT policy denies the read,
    // which would cause the UPSERT fallback to overwrite the profile).
    const { data: profile, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', userId)
      .single()

    if (error || !profile) {
      // User exists in auth but not in users table yet — create profile.
      // BUT: guard against creating a "phantom" profile for a merged wallet
      // user.  If the auth user's wallet_address already belongs to another
      // user in the `users` table, return THAT user's profile instead.
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId)

      if (!authUser?.user) {
        throw new UnauthorizedError('User not found')
      }

      const trustedMeta = getTrustedAuthMetadata(authUser.user)
      const walletAddr = trustedMeta.wallet_address as string | undefined
      if (walletAddr) {
        const { data: walletOwner } = await supabaseAdmin
          .from('users')
          .select('*')
          .eq('wallet_address', walletAddr)
          .maybeSingle()

        if (walletOwner && walletOwner.id !== userId) {
          // Wallet belongs to the surviving merged account — return it
          await supabaseAdmin
            .from('users')
            .update({ last_login_at: new Date().toISOString() })
            .eq('id', walletOwner.id)

          return res.json({
            success: true,
            user: mapUserProfile(walletOwner),
          })
        }
      }

      const metaAccountType = trustedMeta.account_type as string | undefined
      const isTraveler = metaAccountType === 'traveler'
      const isCardano = metaAccountType === 'cardano' || metaAccountType === 'managed_cardano'
      const expiresAt = isTraveler ? new Date(Date.now() + TRAVELER_EXPIRY_MS).toISOString() : null

      const newProfile: Record<string, unknown> = {
        id: userId,
        email: (isTraveler || isCardano) ? null : authUser.user.email,
        display_name: authUser.user.user_metadata?.full_name || authUser.user.user_metadata?.name || authUser.user.user_metadata?.display_name || null,
        avatar_url: authUser.user.user_metadata?.avatar_url || authUser.user.user_metadata?.picture || null,
        google_id: (isTraveler || isCardano) ? null : (authUser.user.user_metadata?.provider_id || null),
        timezone: 'UTC',
        roles: isTraveler ? ['traveler'] : ['user'],
        account_type: metaAccountType || 'google',
        traveler_name: isTraveler ? (authUser.user.user_metadata?.display_name || null) : null,
        expires_at: expiresAt,
        last_login_at: new Date().toISOString(),
        signup_source: getSignupSource(req),
      }

      if (isCardano) {
        newProfile.wallet_address = walletAddr || null
      }

      // Use insert instead of upsert to avoid overwriting existing data (like role).
      // If the row already exists, we just re-read it.
      const { data: created, error: createError } = await supabaseAdmin
        .from('users')
        .insert(newProfile)
        .select()
        .single()

      if (createError) {
        // If insert failed because row already exists (race condition with the SELECT above),
        // just re-read the existing row — don't overwrite it.
        if (createError.code === '23505') {
          const { data: existingProfile } = await supabaseAdmin
            .from('users')
            .select('*')
            .eq('id', userId)
            .single()
          if (existingProfile) {
            return res.json({
              success: true,
              user: mapUserProfile(existingProfile),
            })
          }
        }
        console.error('Failed to create user profile:', createError)
        throw new Error('Failed to create user profile')
      }

      return res.json({
        success: true,
        user: mapUserProfile(created),
      })
    }

    // Update last login & refresh avatar URL from auth metadata
    const loginUpdates: Record<string, unknown> = { last_login_at: new Date().toISOString() }

    // Google may rotate profile picture URLs, so refresh from auth metadata
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId)
    if (authUser?.user) {
      const freshAvatar = authUser.user.user_metadata?.avatar_url || authUser.user.user_metadata?.picture || null
      if (freshAvatar && freshAvatar !== profile.avatar_url) {
        loginUpdates.avatar_url = freshAvatar
      }
    }

    const { data: updatedProfile } = await supabaseAdmin
      .from('users')
      .update(loginUpdates)
      .eq('id', userId)
      .select('*')
      .single()

    res.json({
      success: true,
      user: mapUserProfile(updatedProfile || profile),
    })
  } catch (error) {
    next(error)
  }
})

/**
 * PUT /api/auth/profile
 * Update user profile
 */
router.put('/profile', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const { displayName, timezone, defaultReminderMinutes, themePreferences, feedbackStatusOrder, email } = req.body

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if (email !== undefined) {
      if (email !== null && typeof email !== 'string') {
        throw new ValidationError('Email must be a string or null')
      }
      if (typeof email === 'string' && email.trim().length > 0) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(email.trim())) {
          throw new ValidationError('Invalid email address')
        }
        updates.email = email.trim()
      } else {
        updates.email = null
      }
    }

    if (displayName !== undefined) {
      if (typeof displayName !== 'string' || displayName.trim().length === 0) {
        throw new ValidationError('Display name must be a non-empty string')
      }
      updates.display_name = displayName.trim()
    }

    if (timezone !== undefined) {
      if (typeof timezone !== 'string') {
        throw new ValidationError('Timezone must be a string')
      }
      updates.timezone = timezone
    }

    if (defaultReminderMinutes !== undefined) {
      if (typeof defaultReminderMinutes !== 'number' || defaultReminderMinutes < 0) {
        throw new ValidationError('Default reminder minutes must be a non-negative number')
      }
      updates.default_reminder_minutes = defaultReminderMinutes
    }

    if (themePreferences !== undefined) {
      if (themePreferences !== null && typeof themePreferences !== 'object') {
        throw new ValidationError('Theme preferences must be an object or null')
      }
      updates.theme_preferences = themePreferences
    }

    if (feedbackStatusOrder !== undefined) {
      const validStatuses = ['open', 'reviewed', 'affirmed', 'resolved', 'dismissed']
      if (feedbackStatusOrder === null) {
        updates.feedback_status_order = null
      } else if (
        Array.isArray(feedbackStatusOrder) &&
        feedbackStatusOrder.length === validStatuses.length &&
        feedbackStatusOrder.every((s: unknown) => typeof s === 'string' && validStatuses.includes(s as string)) &&
        new Set(feedbackStatusOrder).size === validStatuses.length
      ) {
        updates.feedback_status_order = feedbackStatusOrder
      } else {
        throw new ValidationError(`feedbackStatusOrder must be an array containing exactly these statuses: ${validStatuses.join(', ')}`)
      }
    }

    const { data, error } = await supabaseAdmin
      .from('users')
      .update(updates)
      .eq('id', userId)
      .select()
      .single()

    if (error) {
      console.error('Failed to update profile:', error)
      throw new Error('Failed to update profile')
    }

    res.json({
      success: true,
      user: mapUserProfile(data),
    })
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/auth/logout
 * Sign out user (invalidates Supabase session)
 */
router.post('/logout', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!

    // Invalidate the user's session server-side using the raw JWT
    const token = req.accessToken
    // Only attempt signOut if the token looks like a valid JWT (3 dot-separated segments)
    if (token && token.split('.').length === 3) {
      // 'local' scope: only revoke this session's refresh token, not every device the user is signed into.
      const { error } = await supabaseAdmin.auth.admin.signOut(token, 'local')
      if (error) {
        console.warn(`Failed to invalidate session for user ${userId}:`, error.message)
      }
    }

    console.log(`User ${userId} logged out`)

    res.json({
      success: true,
      message: 'Logged out successfully',
    })
  } catch (error) {
    next(error)
  }
})

/**
 * DELETE /api/auth/account
 * Delete user account and all related data
 */
router.delete('/account', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const userEmail = req.userEmail

    const { data: profileForTelemetry } = await supabaseAdmin
      .from('users')
      .select('account_type, signup_source, wallet_address')
      .eq('id', userId)
      .maybeSingle()

    // Build match conditions: calendars.created_by can be a userId or email
    const createdByMatches = [userId]
    if (userEmail) createdByMatches.push(userEmail)

    // Use supabaseAdmin to bypass RLS for all delete operations
    // 1. Find all calendars owned by this user
    const { data: ownedCalendars } = await supabaseAdmin
      .from('calendars')
      .select('id')
      .in('created_by', createdByMatches)

    const calendarIds = (ownedCalendars || []).map((c: { id: string }) => c.id)
    const deletedCalendarCount = calendarIds.length

    if (calendarIds.length > 0) {
      // 2. Delete availability for owned calendars
      await supabaseAdmin
        .from('availability')
        .delete()
        .in('calendar_id', calendarIds)

      // 3. Delete meetings for owned calendars
      await supabaseAdmin
        .from('meetings')
        .delete()
        .in('calendar_id', calendarIds)

      // 4. Delete owned calendars
      await supabaseAdmin
        .from('calendars')
        .delete()
        .in('created_by', createdByMatches)
    }

    // 5. Delete calendar sources (Google calendar connections)
    await supabaseAdmin
      .from('calendar_sources')
      .delete()
      .eq('user_id', userId)

    // 6. Delete user profile
    await supabaseAdmin
      .from('users')
      .delete()
      .eq('id', userId)

    // 7. Delete auth user (requires service_role key)
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId)
    const authDeleteSucceeded = !error

    if (error) {
      console.error('Failed to delete auth user:', error)
    }

    // Best-effort telemetry for oversight trend analysis.
    try {
      await supabaseAdmin
        .from('account_deletion_events')
        .insert({
          user_id: userId,
          account_type: profileForTelemetry?.account_type || 'unknown',
          signup_source: profileForTelemetry?.signup_source || null,
          had_wallet: !!profileForTelemetry?.wallet_address,
          deleted_calendar_count: deletedCalendarCount,
          auth_delete_succeeded: authDeleteSucceeded,
          deleted_by: 'self-service',
        })
    } catch (telemetryError) {
      console.warn('Failed to record account deletion telemetry:', telemetryError)
    }

    console.log(`Account deleted for user ${userId}`)

    res.json({
      success: true,
      message: 'Account deleted successfully',
    })
  } catch (error) {
    next(error)
  }
})

/**
 * Map database user row to a clean API response
 */
function mapUserProfile(dbUser: Record<string, unknown>) {
  return {
    id: dbUser.id,
    email: dbUser.email,
    displayName: dbUser.display_name,
    avatarUrl: dbUser.avatar_url,
    googleId: dbUser.google_id,
    timezone: dbUser.timezone,
    roles: (() => {
      const raw = dbUser.roles
      if (Array.isArray(raw)) return raw
      if (typeof raw === 'string') { try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) return parsed } catch { /* fall through to default */ } }
      return ['user']
    })(),
    accountType: dbUser.account_type || 'google',
    travelerName: dbUser.traveler_name || null,
    expiresAt: dbUser.expires_at || null,
    walletAddress: dbUser.wallet_address || null,
    encryptedWalletBlob: dbUser.encrypted_wallet_blob || null,
    defaultReminderMinutes: dbUser.default_reminder_minutes,
    createdAt: dbUser.created_at,
    updatedAt: dbUser.updated_at,
    lastLoginAt: dbUser.last_login_at,
    themePreferences: dbUser.theme_preferences || null,
    feedbackStatusOrder: dbUser.feedback_status_order || null,
  }
}

// ── Account Linking ──────────────────────────────────────────────────

/**
 * POST /api/auth/account/prepare-link
 * Create a one-time merge token for the currently authenticated user.
 * Called BEFORE the user initiates OAuth with the other provider.
 */
router.post('/account/prepare-link', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('account_type')
      .eq('id', userId)
      .single()

    if (!user) throw new Error('User not found')

    const token = await createMergeToken(userId, user.account_type || 'google')

    res.json({
      success: true,
      mergeToken: token,
      expiresIn: 600, // seconds
    })
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/auth/account/complete-link
 * Complete an account merge after the user signed in with the other
 * provider. The caller is now authenticated as the TARGET account
 * (the one that will survive). The source account (identified by the
 * merge token) will be merged in and deleted.
 *
 * Body: { mergeToken: string }
 */
router.post('/account/complete-link', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const targetUserId = req.userId!
    const { mergeToken } = req.body

    if (!mergeToken) {
      throw new ValidationError('mergeToken is required')
    }

    if (typeof mergeToken !== 'string') {
      throw new ValidationError('mergeToken is required')
    }

    // Single-use: consuming deletes the token from the store
    const pending = await consumeMergeToken(mergeToken)

    if (!pending) {
      throw new UnauthorizedError('Invalid or expired merge token')
    }

    if (pending.expired) {
      throw new UnauthorizedError('Merge token has expired. Please try linking again.')
    }

    if (pending.sourceUserId === targetUserId) {
      throw new ValidationError('Cannot merge an account with itself')
    }

    // The initiating account's settings take precedence
    await mergeAccounts(pending.sourceUserId, targetUserId, /* keepSettingsFromSource */ true)

    // Return updated profile
    const { data: updatedUser } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', targetUserId)
      .single()

    res.json({
      success: true,
      message: 'Accounts merged successfully. All events, templates, and data have been combined.',
      user: updatedUser ? mapUserProfile(updatedUser) : null,
    })
  } catch (error) {
    next(error)
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// AGENT API KEY MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

const AVAILABLE_SCOPES = ['read', 'write:calendars', 'write:meetings', 'write:announcements', 'write:feedback', '*'] as const

const DEFAULT_DAILY_LIMIT = 1000
const MAX_DAILY_LIMIT = 10000
// Hard cap on simultaneously-issued keys per user. Stops a compromised session
// from spam-creating keys and obscuring revocation. Users can delete unused
// keys to free slots.
const MAX_KEYS_PER_USER = 25

function containsWriteScope(scopes: readonly string[]): boolean {
  return scopes.some((s) => s.startsWith('write:') || s === '*')
}

/**
 * GET /api/auth/agent-keys
 * List all agent API keys for the authenticated user
 */
router.get('/agent-keys', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!

    const { data: keys, error } = await supabaseAdmin
      .from('agent_api_keys')
      .select('id, name, scopes, is_active, expires_at, last_used_at, created_at, ack_writes_at, daily_request_limit, rate_window_start, rate_window_count')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Failed to fetch agent API keys:', error)
      throw new ApplicationError('Failed to fetch API keys. Please try again.', 500, 'KEY_FETCH_FAILED')
    }

    res.json({ keys: keys || [] })
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/auth/agent-keys
 * Create a new agent API key
 */
router.post('/agent-keys', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const { name, scopes, expiresAt, confirmWriteAccess, dailyRequestLimit } = req.body

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new ValidationError('Key name is required')
    }

    // Validate scopes -- silently drop unknown values, default to read-only.
    const requestedScopes: string[] = Array.isArray(scopes) ? scopes : []
    const validScopes = requestedScopes.filter((s: string) =>
      AVAILABLE_SCOPES.includes(s as typeof AVAILABLE_SCOPES[number]),
    )
    const finalScopes = validScopes.length > 0 ? validScopes : ['read']

    // Ethics gate: any write scope requires an explicit, per-request acknowledgement.
    // This forces the UI to surface a confirmation step before granting write access
    // so users can explore the system safely before changing anything.
    const hasWriteScope = containsWriteScope(finalScopes)
    if (hasWriteScope && confirmWriteAccess !== true) {
      throw new ValidationError(
        'Write scopes require an explicit acknowledgement. Re-send the request with confirmWriteAccess: true.',
      )
    }

    // Optional per-key daily limit (clamped).
    let dailyLimit = DEFAULT_DAILY_LIMIT
    if (dailyRequestLimit !== undefined) {
      const n = Number(dailyRequestLimit)
      if (!Number.isFinite(n) || n < 1 || n > MAX_DAILY_LIMIT) {
        throw new ValidationError(`dailyRequestLimit must be between 1 and ${MAX_DAILY_LIMIT}`)
      }
      dailyLimit = Math.floor(n)
    }

    // Verify the user has a profile row (required for the FK constraint on agent_api_keys.user_id).
    // A profile may be missing if account creation failed on first sign-in.
    const { data: userRow } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('id', userId)
      .maybeSingle()

    if (!userRow) {
      throw new ApplicationError(
        'User profile not found. Please reload the page to finish setting up your account, then try again.',
        400,
        'USER_PROFILE_MISSING'
      )
    }

    // Enforce per-user key cap (defence against compromised-session spam).
    const { count: existingKeyCount, error: countErr } = await supabaseAdmin
      .from('agent_api_keys')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)

    if (countErr) {
      console.error('Failed to count agent API keys:', countErr)
      throw new ApplicationError('Failed to create API key. Please try again.', 500, 'KEY_COUNT_FAILED')
    }
    if ((existingKeyCount ?? 0) >= MAX_KEYS_PER_USER) {
      throw new ValidationError(
        `You already have the maximum of ${MAX_KEYS_PER_USER} API keys. Delete an unused key before creating a new one.`,
      )
    }

    // Generate a secure API key: cm_agent_ prefix + 32 random hex chars
    const apiKey = `cm_agent_${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '').slice(0, 16)}`

    const { data: newKey, error } = await supabaseAdmin
      .from('agent_api_keys')
      .insert({
        user_id: userId,
        name: name.trim(),
        api_key: apiKey,
        scopes: finalScopes,
        expires_at: expiresAt || null,
        ack_writes_at: hasWriteScope ? new Date().toISOString() : null,
        daily_request_limit: dailyLimit,
      })
      .select('id, name, api_key, scopes, is_active, expires_at, created_at, ack_writes_at, daily_request_limit')
      .single()

    if (error) {
      console.error('Failed to create agent API key:', error)
      throw new ApplicationError('Failed to create API key. Please try again.', 500, 'KEY_CREATE_FAILED')
    }

    // Return the full API key only once at creation time
    res.status(201).json({
      key: newKey,
      message: 'API key created. Copy it now -- you won\'t be able to see it again.',
    })
  } catch (error) {
    next(error)
  }
})

/**
 * DELETE /api/auth/agent-keys/:keyId
 * Delete an agent API key
 */
router.delete('/agent-keys/:keyId', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const { keyId } = req.params

    // Verify ownership and delete
    const { error } = await supabaseAdmin
      .from('agent_api_keys')
      .delete()
      .eq('id', keyId)
      .eq('user_id', userId)

    if (error) {
      console.error('Failed to delete agent API key:', error)
      throw new ApplicationError('Failed to delete API key. Please try again.', 500, 'KEY_DELETE_FAILED')
    }

    res.json({ success: true, message: 'API key deleted' })
  } catch (error) {
    next(error)
  }
})

/**
 * PATCH /api/auth/agent-keys/:keyId
 * Update an agent API key (name, scopes, is_active)
 */
router.patch('/agent-keys/:keyId', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const { keyId } = req.params
    const { name, scopes, is_active, confirmWriteAccess, dailyRequestLimit } = req.body

    // Look up current key so we can detect scope *widening* and require ack only then.
    const { data: existingKey, error: lookupErr } = await supabaseAdmin
      .from('agent_api_keys')
      .select('scopes, ack_writes_at')
      .eq('id', keyId)
      .eq('user_id', userId)
      .maybeSingle()

    if (lookupErr || !existingKey) {
      throw new ApplicationError('API key not found', 404, 'KEY_NOT_FOUND')
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        throw new ValidationError('Key name cannot be empty')
      }
      updates.name = name.trim()
    }

    if (scopes !== undefined) {
      const requestedScopes: string[] = Array.isArray(scopes) ? scopes : []
      const validScopes = requestedScopes.filter((s: string) =>
        AVAILABLE_SCOPES.includes(s as typeof AVAILABLE_SCOPES[number]),
      )
      if (validScopes.length === 0) {
        throw new ValidationError('At least one valid scope is required')
      }

      // Ethics gate: widening to include a write scope the key does not already
      // have requires an explicit acknowledgement.
      const previousScopes: string[] = (existingKey.scopes as string[]) || []
      const newWriteScopes = validScopes.filter(
        (s) => (s.startsWith('write:') || s === '*') && !previousScopes.includes(s),
      )
      if (newWriteScopes.length > 0 && confirmWriteAccess !== true) {
        throw new ValidationError(
          'Adding write scopes requires an explicit acknowledgement. Re-send with confirmWriteAccess: true.',
        )
      }

      updates.scopes = validScopes
      if (containsWriteScope(validScopes) && !existingKey.ack_writes_at) {
        updates.ack_writes_at = new Date().toISOString()
      }
    }

    if (is_active !== undefined) {
      updates.is_active = Boolean(is_active)
    }

    if (dailyRequestLimit !== undefined) {
      const n = Number(dailyRequestLimit)
      if (!Number.isFinite(n) || n < 1 || n > MAX_DAILY_LIMIT) {
        throw new ValidationError(`dailyRequestLimit must be between 1 and ${MAX_DAILY_LIMIT}`)
      }
      updates.daily_request_limit = Math.floor(n)
    }

    const { data: updatedKey, error } = await supabaseAdmin
      .from('agent_api_keys')
      .update(updates)
      .eq('id', keyId)
      .eq('user_id', userId)
      .select('id, name, scopes, is_active, expires_at, last_used_at, created_at, ack_writes_at, daily_request_limit, rate_window_start, rate_window_count')
      .single()

    if (error) {
      console.error('Failed to update agent API key:', error)
      throw new ApplicationError('Failed to update API key. Please try again.', 500, 'KEY_UPDATE_FAILED')
    }

    res.json({ key: updatedKey })
  } catch (error) {
    next(error)
  }
})

// ── GET /api/auth/captcha-required ──────────────────────────────────
// Frontend polls this to decide whether to render the Turnstile widget.
router.get('/captcha-required', (_req, res: Response) => {
  res.json(getCaptchaStatus())
})

export default router
