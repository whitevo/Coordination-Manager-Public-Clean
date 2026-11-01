import { Router, Response, NextFunction } from 'express'
import { supabaseAdmin } from '../supabaseClient.js'
import crypto from 'crypto'
import { ValidationError, UnauthorizedError, ApplicationError } from '../middleware/error-handler.js'
import { authMiddleware, createIsolatedAuthClient, getTrustedAuthMetadata, type AuthenticatedRequest } from '../middleware/auth.js'
import { mergeAccounts } from '../services/account-merge.js'
import { verifyCaptcha } from '../services/captcha.js'
import { recordSignup, getSignupSource } from '../services/signup-rate-tracker.js'

const router: ReturnType<typeof Router> = Router()

// ── In-memory challenge store (with TTL cleanup) ──────────────────────
// For production at scale, replace with Redis or the DB table.
interface Challenge {
  nonce: string
  address: string
  expiresAt: number // Unix ms
}

const challengeStore = new Map<string, Challenge>()
const CHALLENGE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const devOnlyWalletKey = crypto.randomBytes(32).toString('hex')

// Periodic cleanup of expired challenges (every 60 seconds)
setInterval(() => {
  const now = Date.now()
  for (const [key, challenge] of challengeStore.entries()) {
    if (challenge.expiresAt < now) {
      challengeStore.delete(key)
    }
  }
}, 60_000)

// ── Helpers ───────────────────────────────────────────────────────────

/** Validate a Cardano address (bech32 or hex-encoded from CIP-30) */
function isValidCardanoAddress(address: string): boolean {
  // Bech32 format: addr1... (mainnet) or addr_test1... (testnet)
  const isBech32 = /^addr1[a-z0-9]{50,120}$/.test(address) || /^addr_test1[a-z0-9]{50,120}$/.test(address)
  
  // Hex-encoded format from CIP-30 wallets (raw address bytes)
  // Typically 58-116 hex characters (29-58 bytes)
  const isHex = /^[0-9a-fA-F]{58,116}$/.test(address)
  
  return isBech32 || isHex
}

/** Truncate address for display: addr1qx...7k3m */
function truncateAddress(address: string): string {
  if (address.length <= 20) return address
  return `${address.slice(0, 10)}...${address.slice(-4)}`
}

/** Generate a unique challenge nonce (kept short so Lace signData dialog renders correctly) */
function generateNonce(): string {
  return crypto.randomBytes(16).toString('hex')
}

/**
 * Build a SHORT human-readable signing message from a nonce.
 * Displayed in the wallet's signing prompt so the user sees the intent.
 *
 * IMPORTANT: Keep this short (< 80 chars) — Lace breaks on long payloads.
 * Both frontend and backend MUST produce the identical string.
 */
function buildSignMessage(nonce: string): string {
  return `Coordination Manager Login\nNonce: ${nonce}`
}

/**
 * Derive a deterministic email and password for a wallet address.
 * This lets us create a Supabase auth user once and sign them in reliably.
 * The password is derived using HMAC-SHA256 with the JWT_SECRET as key,
 * so it's not guessable but is reproducible on this server.
 */
function deriveWalletCredentials(address: string): { email: string; password: string } {
  const secret = getSigningSecret()
  const hmac = crypto.createHmac('sha256', secret).update(`cardano-wallet:${address}`).digest('hex')
  return {
    email: `wallet-${address.slice(0, 20)}@cardano.wallet`,
    password: hmac,
  }
}

function getSigningSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET

  const allowInsecureDevSigning =
    process.env.NODE_ENV === 'test' ||
    (process.env.NODE_ENV !== 'production' && process.env.ALLOW_INSECURE_DEV_SIGNING === 'true')

  if (!allowInsecureDevSigning) {
    throw new ApplicationError('JWT_SECRET is required for wallet credential signing', 500, 'JWT_SECRET_REQUIRED')
  }

  return devOnlyWalletKey
}

// ── POST /api/auth/wallet/challenge ───────────────────────────────────
/**
 * Request a challenge nonce to sign with the Cardano wallet.
 * Body: { address: string }
 * Returns: { nonce, expiresIn }
 */
router.post('/challenge', async (req, res: Response, next: NextFunction) => {
  try {
    const { address, captchaToken } = req.body
    await verifyCaptcha(captchaToken, req.ip)

    if (!address || typeof address !== 'string') {
      throw new ValidationError('Wallet address is required')
    }

    if (!isValidCardanoAddress(address)) {
      throw new ValidationError('Invalid Cardano address format')
    }

    const nonce = generateNonce()
    const expiresAt = Date.now() + CHALLENGE_TTL_MS

    // Store challenge keyed by address (overwrites previous challenge for same address)
    challengeStore.set(address, { nonce, address, expiresAt })

    // Also persist to DB for durability (optional, enables multi-instance)
    try {
      await supabaseAdmin.from('wallet_challenges').upsert(
        {
          wallet_address: address,
          nonce,
          expires_at: new Date(expiresAt).toISOString(),
        },
        { onConflict: 'wallet_address' }
      )
    } catch {
      // DB persistence is best-effort; in-memory is primary
    }

    // Build the human-readable message the wallet will display for signing
    const message = buildSignMessage(nonce)

    res.json({
      success: true,
      nonce,
      message,
      expiresIn: Math.floor(CHALLENGE_TTL_MS / 1000),
    })
  } catch (error) {
    next(error)
  }
})

// ── POST /api/auth/wallet/verify ──────────────────────────────────────
/**
 * Verify the wallet signature and create/login the user.
 * Body: { address, nonce, signature, key }
 * Returns: { session, user }
 */
router.post('/verify', async (req, res: Response, next: NextFunction) => {
  try {
    const { address, nonce, signature, key } = req.body

    // ── Validate inputs ──
    if (!address || !nonce || !signature || !key) {
      throw new ValidationError('address, nonce, signature, and key are all required')
    }

    if (!isValidCardanoAddress(address)) {
      throw new ValidationError('Invalid Cardano address format')
    }

    // ── Check challenge exists and hasn't expired ──
    let storedChallenge = challengeStore.get(address)

    if (!storedChallenge) {
      // Fallback: check DB
      const { data } = await supabaseAdmin
        .from('wallet_challenges')
        .select('*')
        .eq('wallet_address', address)
        .single()

      if (data && new Date(data.expires_at).getTime() > Date.now()) {
        storedChallenge = {
          nonce: data.nonce,
          address: data.wallet_address,
          expiresAt: new Date(data.expires_at).getTime(),
        }
      }
    }

    if (!storedChallenge) {
      throw new UnauthorizedError('No pending challenge found. Please request a new challenge.')
    }

    if (storedChallenge.expiresAt < Date.now()) {
      challengeStore.delete(address)
      throw new UnauthorizedError('Challenge has expired. Please request a new one.')
    }

    if (storedChallenge.nonce !== nonce) {
      throw new UnauthorizedError('Invalid nonce. Please request a new challenge.')
    }

    // ── Verify the CIP-8 signature ──
    // The frontend signed toHex(buildSignMessage(nonce)), so we verify
    // against the same human-readable message here.
    const signedMessage = buildSignMessage(nonce)
    let isValid = false
    try {
      const { checkSignature } = await import('@meshsdk/core')
      isValid = await checkSignature(signedMessage, { signature, key })
    } catch (importError) {
      console.error('Failed to import @meshsdk/core for signature verification:', importError)
      throw new Error(
        'Cardano signature verification is not available. Ensure @meshsdk/core is installed.',
        { cause: importError }
      )
    }

    // Delete the challenge regardless of result (one-time use)
    challengeStore.delete(address)
    try {
      await supabaseAdmin
        .from('wallet_challenges')
        .delete()
        .eq('wallet_address', address)
    } catch {
      // Best-effort cleanup of DB challenge
    }

    if (!isValid) {
      throw new UnauthorizedError('Invalid wallet signature')
    }

    // ── Signature verified — create or find user ──
    const { email: walletEmail, password: walletPassword } = deriveWalletCredentials(address)
    const defaultDisplayName = truncateAddress(address)

    // Try to sign in first (existing user).
    // Use a per-request client with the service role key to bypass captcha
    // enforcement on the server side (the frontend already verified captcha
    // at /challenge) without storing session state on the shared admin client.
    const signInClient = createIsolatedAuthClient()
    let signInResult = await signInClient.auth.signInWithPassword({
      email: walletEmail,
      password: walletPassword,
    })

    if (signInResult.error) {
      // Before creating a new user, check if this wallet_address already
      // belongs to a surviving account (post-merge scenario where the old
      // auth entry was deleted before this fix was deployed).
      const { data: linkedUser } = await supabaseAdmin
        .from('users')
        .select('id, display_name, account_type, email, wallet_address')
        .eq('wallet_address', address)
        .maybeSingle()

      // Re-create the wallet auth credentials so future logins work,
      // but DON'T create a new users-table row if the wallet is already owned.
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: walletEmail,
        password: walletPassword,
        email_confirm: true,
        user_metadata: {
          account_type: 'cardano',
          display_name: linkedUser?.display_name || defaultDisplayName,
          wallet_address: address,
        },
        // Trusted copy: auth middleware reads identity links only from app_metadata.
        app_metadata: { account_type: 'cardano', wallet_address: address },
      })

      if (authError) {
        if (authError.code === 'email_exists') {
          // Auth entry exists with stale/mismatched credentials.
          // Look up the existing auth user via generateLink (reliable
          // email-based lookup) then reset the password and sign in.
          const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
            type: 'magiclink',
            email: walletEmail,
          })

          const staleUserId = linkData?.user?.id

          if (staleUserId) {
            // Repair only the credential. Preserve existing identity-link
            // fields in app_metadata (redirect_to_user_id and any merge/link
            // state): a wallet login merged into a Google account keeps its
            // redirect. Fill account_type/wallet_address only when absent.
            const existingAppMeta = getTrustedAuthMetadata(linkData?.user)
            const repairedAppMeta: Record<string, unknown> = { ...existingAppMeta }
            if (repairedAppMeta.account_type === undefined) repairedAppMeta.account_type = 'cardano'
            if (repairedAppMeta.wallet_address === undefined) repairedAppMeta.wallet_address = address
            await supabaseAdmin.auth.admin.updateUserById(staleUserId, {
              password: walletPassword,
              email_confirm: true,
              user_metadata: {
                account_type: 'cardano',
                display_name: linkedUser?.display_name || defaultDisplayName,
                wallet_address: address,
              },
              app_metadata: repairedAppMeta,
            })

            signInResult = await signInClient.auth.signInWithPassword({
              email: walletEmail,
              password: walletPassword,
            })

            if (signInResult.error || !signInResult.data.session) {
              console.error('Sign-in after password reset failed:', signInResult.error)
              throw new Error('Failed to establish wallet session')
            }

            // Update last login on existing profile
            if (linkedUser) {
              await supabaseAdmin
                .from('users')
                .update({ last_login_at: new Date().toISOString() })
                .eq('id', linkedUser.id)
            }
          } else {
            console.error('Failed to look up stale auth user:', linkError)
            throw new Error('Failed to create wallet account')
          }
        } else {
          console.error('Failed to create Cardano wallet user:', authError)
          throw new Error('Failed to create wallet account')
        }
      } else if (!authData.user) {
        console.error('Failed to create Cardano wallet user: no user returned')
        throw new Error('Failed to create wallet account')
      } else {
        // createUser succeeded — handle profile creation + sign-in
        // Record signup for rate-tracking (captcha spike detection)
        recordSignup()

        if (!linkedUser) {
          // Genuinely new user — create profile in our users table
          const { error: profileError } = await supabaseAdmin.from('users').upsert({
            id: authData.user.id,
            email: null,
            display_name: defaultDisplayName,
            avatar_url: null,
            google_id: null,
            timezone: 'UTC',
            roles: '["user"]',
            account_type: 'cardano',
            wallet_address: address,
            last_login_at: new Date().toISOString(),
            signup_source: getSignupSource(req),
          })

          if (profileError) {
            console.error('Failed to create wallet user profile:', profileError)
          }
        }
        // If linkedUser exists, the auth middleware will redirect this
        // new auth ID to the linked user via wallet_address lookup.

        // Sign in with the newly created credentials
        signInResult = await signInClient.auth.signInWithPassword({
          email: walletEmail,
          password: walletPassword,
        })

        if (signInResult.error || !signInResult.data.session) {
          console.error('Sign-in after creation failed:', signInResult.error)
          throw new Error('Failed to establish wallet session')
        }
      }
    } else {
      // Existing auth user — check if there's a users-table row for them,
      // or if they've been merged into another account.
      const authUserId = signInResult.data.user?.id
      if (authUserId) {
        const { data: existingProfile } = await supabaseAdmin
          .from('users')
          .select('id')
          .eq('id', authUserId)
          .maybeSingle()

        if (existingProfile) {
          // Normal case: user row exists, update last login
          await supabaseAdmin
            .from('users')
            .update({ last_login_at: new Date().toISOString() })
            .eq('id', authUserId)
        } else {
          // No profile row — could be a merged wallet user (auth middleware
          // redirects to the surviving account) OR the auth entry was
          // preserved when the wallet was unlinked while the user was logged
          // in via this wallet session (skippedAuthDeletion = true).
          // Distinguish by checking if any account still owns this wallet_address.
          const { data: survivingUser } = await supabaseAdmin
            .from('users')
            .select('id')
            .eq('wallet_address', address)
            .maybeSingle()

          if (!survivingUser) {
            // No account owns this wallet — it was unlinked. Create a
            // fresh users profile so the wallet owner gets a clean account.
            const { error: freshProfileError } = await supabaseAdmin
              .from('users')
              .insert({
                id: authUserId,
                email: null,
                display_name: defaultDisplayName,
                avatar_url: null,
                google_id: null,
                timezone: 'UTC',
                roles: '["user"]',
                account_type: 'cardano',
                wallet_address: address,
                last_login_at: new Date().toISOString(),
              })
            if (freshProfileError) {
              console.error('Failed to create fresh profile for unlinked wallet:', freshProfileError)
            }

            // Clean up stale redirect metadata so the auth middleware
            // stops redirecting this session to the old Google user.
            const authUserMeta = getTrustedAuthMetadata(signInResult.data.user)
            if (authUserMeta.redirect_to_user_id) {
              try {
                await supabaseAdmin.auth.admin.updateUserById(authUserId, {
                  app_metadata: {
                    redirect_to_user_id: null,
                    wallet_address: address,
                  },
                })
              } catch { /* best-effort */ }
            }
          }
          // If survivingUser exists: the auth middleware handles the redirect
        }
      }
    }

    const session = signInResult.data.session!
    const authUserId = signInResult.data.user!.id

    // Fetch the actual user profile to return the correct display name.
    // First check by auth user ID, then by wallet_address (post-merge redirect).
    let userProfile = await supabaseAdmin
      .from('users')
      .select('id, display_name, account_type, wallet_address, roles, email')
      .eq('id', authUserId)
      .maybeSingle()

    if (!userProfile?.data) {
      // Auth user has no profile row — find the surviving merged account
      userProfile = await supabaseAdmin
        .from('users')
        .select('id, display_name, account_type, wallet_address, roles, email')
        .eq('wallet_address', address)
        .maybeSingle()
    }

    const resolvedUser = userProfile?.data
    const resolvedDisplayName = resolvedUser?.display_name || defaultDisplayName
    const resolvedRoles: string[] = Array.isArray(resolvedUser?.roles) ? resolvedUser.roles : ['user']
    const resolvedId = resolvedUser?.id || authUserId
    const resolvedAccountType = resolvedUser?.account_type || 'cardano'

    res.json({
      success: true,
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_in: session.expires_in,
        expires_at: session.expires_at,
      },
      user: {
        id: resolvedId,
        email: resolvedUser?.email || '',
        displayName: resolvedDisplayName,
        accountType: resolvedAccountType,
        walletAddress: address,
        roles: resolvedRoles,
      },
    })
  } catch (error) {
    next(error)
  }
})

// ── GET /api/auth/wallet/supported ────────────────────────────────────
/**
 * Return list of supported Cardano wallets (informational endpoint).
 */
router.get('/supported', (_req, res: Response) => {
  res.json({
    success: true,
    wallets: [
      { id: 'eternl', name: 'Eternl', icon: 'https://eternl.io/favicon.ico' },
      { id: 'lace', name: 'Lace', icon: 'https://lace.io/favicon.ico' },
      { id: 'typhonwallet', name: 'Typhon', icon: 'https://typhonwallet.io/favicon.ico' },
      { id: 'yoroi', name: 'Yoroi', icon: 'https://yoroi-wallet.com/favicon.ico' },
    ],
  })
})

// ── GET /api/auth/wallet/status ───────────────────────────────────────
/**
 * Get the current wallet link status for the authenticated user.
 * Returns the linked wallet address (if any).
 */
router.get('/status', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId
    if (!userId) throw new UnauthorizedError('Not authenticated')

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('wallet_address, stake_address, account_type')
      .eq('id', userId)
      .single()

    if (error || !user) {
      throw new Error('Failed to fetch user wallet status')
    }

    res.json({
      success: true,
      linked: !!user.wallet_address,
      walletAddress: user.wallet_address || null,
      stakeAddress: user.stake_address || null,
      accountType: user.account_type,
    })
  } catch (error) {
    next(error)
  }
})

// ── POST /api/auth/wallet/check-conflict ──────────────────────────────
/**
 * Pre-check whether a wallet address would trigger a merge conflict.
 * This endpoint does NOT require a signature — it only checks ownership
 * so the frontend can show a confirmation dialog BEFORE any signing.
 *
 * Body: { address }
 * Returns: { conflict, canMerge, existingAccountType? }
 */
router.post('/check-conflict', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId
    if (!userId) throw new UnauthorizedError('Not authenticated')

    const { address } = req.body

    if (!address || typeof address !== 'string') {
      throw new ValidationError('Wallet address is required')
    }

    if (!isValidCardanoAddress(address)) {
      throw new ValidationError('Invalid Cardano address format')
    }

    // Check if this wallet is already linked to another user
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id, account_type')
      .eq('wallet_address', address)
      .maybeSingle()

    if (!existingUser || existingUser.id === userId) {
      // No conflict — wallet is unowned or already belongs to current user
      return res.json({
        success: true,
        conflict: false,
        canMerge: false,
      })
    }

    // Wallet belongs to a different user
    if (existingUser.account_type === 'cardano') {
      // Cardano-native account — merge is possible
      return res.json({
        success: true,
        conflict: true,
        canMerge: true,
        existingAccountType: 'cardano',
        message: 'This wallet is linked to an existing Cardano account. Merging will combine all data from both accounts.',
      })
    } else {
      // Non-cardano account (e.g. Google) — can't auto-merge
      return res.json({
        success: true,
        conflict: true,
        canMerge: false,
        existingAccountType: existingUser.account_type,
        message: 'This wallet is already linked to another account.',
      })
    }
  } catch (error) {
    next(error)
  }
})

// ── POST /api/auth/wallet/link ────────────────────────────────────────
/**
 * Link a Cardano wallet to an existing authenticated account.
 * Uses the same challenge-response flow: the frontend must first
 * call POST /challenge, sign the nonce, then call this endpoint.
 *
 * Body: { address, nonce, signature, key, merge? }
 *
 * When the wallet is already owned by a different Cardano-native account:
 *   - Without `merge: true` → returns { conflict: true, canMerge: true }
 *   - With `merge: true`    → merges that account's data into the caller,
 *     transfers the wallet, and deletes the old account.
 */
router.post('/link', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId
    if (!userId) throw new UnauthorizedError('Not authenticated')

    const { address, nonce, signature, key, merge } = req.body

    // ── Validate inputs ──
    if (!address || !nonce || !signature || !key) {
      throw new ValidationError('address, nonce, signature, and key are all required')
    }

    if (!isValidCardanoAddress(address)) {
      throw new ValidationError('Invalid Cardano address format')
    }

    // ── Check that this wallet is not already linked to another user ──
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id, account_type')
      .eq('wallet_address', address)
      .maybeSingle()

    let mergeSourceId: string | null = null

    if (existingUser && existingUser.id !== userId) {
      // Wallet belongs to a different user
      if (existingUser.account_type === 'cardano' && !merge) {
        // Inform the frontend that a merge is possible
        return res.status(409).json({
          success: false,
          conflict: true,
          canMerge: true,
          message: 'This wallet is linked to an existing Cardano account. You can merge the accounts to combine all data.',
        })
      }
      if (existingUser.account_type === 'cardano' && merge) {
        // Will merge after signature verification
        mergeSourceId = existingUser.id
      } else {
        // Wallet belongs to a non-cardano account — can't auto-merge
        throw new ValidationError('This wallet address is already linked to another account')
      }
    }

    // ── Check challenge exists and hasn't expired ──
    let storedChallenge = challengeStore.get(address)

    if (!storedChallenge) {
      const { data } = await supabaseAdmin
        .from('wallet_challenges')
        .select('*')
        .eq('wallet_address', address)
        .single()

      if (data && new Date(data.expires_at).getTime() > Date.now()) {
        storedChallenge = {
          nonce: data.nonce,
          address: data.wallet_address,
          expiresAt: new Date(data.expires_at).getTime(),
        }
      }
    }

    if (!storedChallenge) {
      throw new UnauthorizedError('No pending challenge found. Please request a new challenge.')
    }

    if (storedChallenge.expiresAt < Date.now()) {
      challengeStore.delete(address)
      throw new UnauthorizedError('Challenge has expired. Please request a new one.')
    }

    if (storedChallenge.nonce !== nonce) {
      throw new UnauthorizedError('Invalid nonce. Please request a new challenge.')
    }

    // ── Verify the CIP-8 signature ──
    // The frontend signed toHex(buildSignMessage(nonce)), so we verify
    // against the same human-readable message here.
    const signedMessage = buildSignMessage(nonce)
    let isValid = false
    try {
      const { checkSignature } = await import('@meshsdk/core')
      isValid = await checkSignature(signedMessage, { signature, key })
    } catch (importError) {
      console.error('Failed to import @meshsdk/core for signature verification:', importError)
      throw new Error('Cardano signature verification is not available.', { cause: importError })
    }

    // Delete the challenge (one-time use)
    challengeStore.delete(address)
    try {
      await supabaseAdmin.from('wallet_challenges').delete().eq('wallet_address', address)
    } catch { /* best-effort */ }

    if (!isValid) {
      throw new UnauthorizedError('Invalid wallet signature')
    }

    // ── Link the wallet (with optional merge) ──
    if (mergeSourceId) {
      // Merge the Cardano account into the current user, then the
      // wallet_address is transferred as part of the merge.
      // Google user is initiating → keep Google user's settings.
      await mergeAccounts(mergeSourceId, userId, /* keepSettingsFromSource */ false)

      res.json({
        success: true,
        walletAddress: address,
        merged: true,
        message: 'Accounts merged and wallet linked successfully. All events, templates, and data have been combined.',
      })
    } else {
      const { error: updateError } = await supabaseAdmin
        .from('users')
        .update({ wallet_address: address })
        .eq('id', userId)

      if (updateError) {
        console.error('Failed to link wallet:', updateError)
        throw new Error('Failed to link wallet to account')
      }

      res.json({
        success: true,
        walletAddress: address,
        message: 'Wallet linked successfully',
      })
    }
  } catch (error) {
    next(error)
  }
})

// ── DELETE /api/auth/wallet/link ──────────────────────────────────────
/**
 * Remove wallet access from the authenticated account.
 * Only allowed for non-cardano account types (Google/Traveler accounts
 * that linked a wallet). Pure Cardano accounts cannot remove their wallet.
 *
 * This performs a full permission removal:
 * 1. Clears wallet_address / stake_address on the user profile
 * 2. Deletes the Cardano Supabase Auth entry so the wallet can no longer
 *    log in as this user. If the wallet owner logs in again they will
 *    start as a brand-new user with no prior data or settings.
 */
router.delete('/link', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId
    if (!userId) throw new UnauthorizedError('Not authenticated')

    // Check current account type
    const { data: user, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('account_type, wallet_address')
      .eq('id', userId)
      .single()

    if (fetchError || !user) {
      throw new Error('Failed to fetch user')
    }

    if (user.account_type === 'cardano') {
      throw new ValidationError(
        'Cannot remove wallet from a Cardano-native account. Your wallet is your primary login method.'
      )
    }

    if (!user.wallet_address) {
      throw new ValidationError('No wallet is currently linked to your account')
    }

    // ── 1. Clear wallet fields on the user profile ──
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ wallet_address: null, stake_address: null })
      .eq('id', userId)

    if (updateError) {
      console.error('Failed to remove wallet access:', updateError)
      throw new Error('Failed to remove wallet access')
    }

    // ── 2. Handle the Cardano Supabase Auth entry ──
    // If the current session uses a DIFFERENT auth entry (e.g. Google
    // login), we can safely delete the wallet auth entry outright.
    //
    // If the current session IS the wallet auth entry, deleting it would
    // invalidate the active session and force a logout. Instead we update
    // the auth entry's metadata to redirect future requests to the Google
    // user so the session stays alive transparently.
    const { email: walletEmail } = deriveWalletCredentials(user.wallet_address)
    let sessionPreserved = false
    try {
      // Look up the auth user by their derived wallet email
      const { data: authList } = await supabaseAdmin.auth.admin.listUsers()
      const walletAuthUser = authList?.users?.find(
        (u) => u.email === walletEmail
      )
      if (walletAuthUser) {
        if (walletAuthUser.id === req.rawAuthUserId) {
          // Current session IS the wallet auth entry.
          // Keep it alive but update metadata so the auth middleware
          // redirects all future requests to the Google user.
          sessionPreserved = true
          try {
            await supabaseAdmin.auth.admin.updateUserById(walletAuthUser.id, {
              user_metadata: {
                ...((walletAuthUser.user_metadata || {}) as Record<string, unknown>),
                wallet_address: null,
              },
              // Server-only: keeps this wallet session (and its other tabs) alive as the Google user.
              app_metadata: {
                wallet_address: null,
                redirect_to_user_id: userId,
              },
            })
          } catch (metaErr) {
            console.warn('Could not update wallet auth metadata (best-effort):', metaErr)
          }
        } else {
          await supabaseAdmin.auth.admin.deleteUser(walletAuthUser.id)
        }
      }
    } catch (authCleanupErr) {
      // Best-effort — the wallet fields are already cleared so the
      // redirect path in auth middleware will no longer match.
      console.warn('Could not clean up wallet auth entry (best-effort):', authCleanupErr)
    }

    res.json({
      success: true,
      message: sessionPreserved
        ? 'Wallet access removed. You remain logged in — use Google to sign in next time.'
        : 'Wallet access removed. If the wallet owner logs in again they will start as a new user.',
    })
  } catch (error) {
    next(error)
  }
})
// ── POST /api/auth/wallet/managed/create ─────────────────────────────
/**
 * Save an app-generated (managed) wallet for the authenticated user.
 * The private key is AES-256-GCM encrypted in the browser with a device
 * secret that never leaves the client. We store only the opaque blob.
 *
 * Body: { address, encryptedBlob, publicKey }
 *   address       - "managed_" + 64-char hex public key
 *   encryptedBlob - base64url(salt|iv|ciphertext) produced by the browser
 *   publicKey     - 64-char hex of the Ed25519 public key (informational)
 *
 * Returns: { success, walletAddress }
 */
router.post('/managed/create', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId
    if (!userId) throw new UnauthorizedError('Not authenticated')

    const { address, encryptedBlob, publicKey } = req.body as {
      address: unknown
      encryptedBlob: unknown
      publicKey: unknown
    }

    // ── Validate inputs ──
    if (typeof address !== 'string' || !/^managed_[0-9a-f]{64}$/.test(address)) {
      throw new ValidationError('Invalid managed wallet address format')
    }
    if (typeof encryptedBlob !== 'string' || encryptedBlob.length < 40 || encryptedBlob.length > 8192) {
      throw new ValidationError('Invalid encrypted wallet blob')
    }
    if (typeof publicKey !== 'string' || !/^[0-9a-f]{64}$/.test(publicKey)) {
      throw new ValidationError('Invalid public key format')
    }

    // Confirm the address encodes the same public key
    if (address !== `managed_${publicKey}`) {
      throw new ValidationError('Address and public key do not match')
    }

    // ── Check the address is not taken by another user ──
    const { data: existing } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('wallet_address', address)
      .maybeSingle()

    if (existing && existing.id !== userId) {
      throw new ValidationError('This wallet address is already registered to another account')
    }

    // ── Fetch current user to check they do not already have a wallet ──
    const { data: currentUser, error: fetchErr } = await supabaseAdmin
      .from('users')
      .select('wallet_address, account_type')
      .eq('id', userId)
      .single()

    if (fetchErr || !currentUser) {
      throw new Error('Failed to fetch user record')
    }

    // If they already have a managed wallet at the same address, update the blob
    // (allows re-encryption when device secret changes). If they have a real
    // CIP-30 address, reject -- they should use the full sign-in flow instead.
    if (
      currentUser.wallet_address &&
      !currentUser.wallet_address.startsWith('managed_') &&
      currentUser.wallet_address !== address
    ) {
      throw new ValidationError(
        'Your account already has a CIP-30 wallet linked. Managed wallet creation is not available.'
      )
    }

    // ── Save the blob and set the wallet address ──
    const { error: updateErr } = await supabaseAdmin
      .from('users')
      .update({
        wallet_address: address,
        encrypted_wallet_blob: encryptedBlob,
        account_type: currentUser.account_type === 'traveler' ? 'managed_cardano' : currentUser.account_type,
      })
      .eq('id', userId)

    if (updateErr) {
      console.error('Failed to save managed wallet:', updateErr)
      throw new Error('Failed to save managed wallet')
    }

    res.json({ success: true, walletAddress: address })
  } catch (error) {
    next(error)
  }
})

// ── POST /api/auth/wallet/managed/register ──────────────────────────────
/**
 * Create a new account with a managed wallet in one step.
 * No authentication required -- creates a managed_cardano account immediately.
 * The wallet keypair is generated client-side; we store only the encrypted blob.
 *
 * Body: { address, encryptedBlob, publicKey }
 * Returns: { success, session, user }
 */
router.post('/managed/register', async (req, res: Response, next: NextFunction) => {
  try {
    const { address, encryptedBlob, publicKey, captchaToken } = req.body as {
      address: unknown
      encryptedBlob: unknown
      publicKey: unknown
      captchaToken?: unknown
    }

    // Captcha required to prevent automated mass account creation
    await verifyCaptcha(typeof captchaToken === 'string' ? captchaToken : undefined, req.ip)

    if (typeof address !== 'string' || !/^managed_[0-9a-f]{64}$/.test(address)) {
      throw new ValidationError('Invalid managed wallet address format')
    }
    if (typeof encryptedBlob !== 'string' || encryptedBlob.length < 40 || encryptedBlob.length > 8192) {
      throw new ValidationError('Invalid encrypted wallet blob')
    }
    if (typeof publicKey !== 'string' || !/^[0-9a-f]{64}$/.test(publicKey)) {
      throw new ValidationError('Invalid public key format')
    }
    if (address !== `managed_${publicKey}`) {
      throw new ValidationError('Address and public key do not match')
    }

    // Reject if this wallet is already registered
    const { data: existing } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('wallet_address', address)
      .maybeSingle()

    if (existing) {
      throw new ValidationError('This wallet address is already registered')
    }

    // Create a new account
    const accountId = crypto.randomUUID()
    const tempEmail = `managed-${accountId}@wallet.local`
    // High-entropy random password (256 bits). Used only for the immediate
    // sign-in below; never returned to the client and never stored anywhere
    // outside Supabase Auth's salted hash.
    const tempPassword = crypto.randomBytes(32).toString('hex')
    const shortKey = address.slice(8, 14)
    const displayName = `Wallet ${shortKey}`

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: tempEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        account_type: 'managed_cardano',
        display_name: displayName,
      },
      app_metadata: { account_type: 'managed_cardano' },
    })

    if (error || !data.user) {
      console.error('Failed to create managed wallet account:', error?.message)
      throw new ApplicationError(
        'Unable to create account. Please try again later.',
        503,
        'ACCOUNT_CREATE_FAILED'
      )
    }

    // Create profile
    const { error: profileError } = await supabaseAdmin
      .from('users')
      .upsert({
        id: data.user.id,
        email: null,
        display_name: displayName,
        avatar_url: null,
        google_id: null,
        timezone: 'UTC',
        roles: ['user'],
        account_type: 'managed_cardano',
        wallet_address: address,
        encrypted_wallet_blob: encryptedBlob,
        last_login_at: new Date().toISOString(),
        signup_source: getSignupSource(req),
      })

    if (profileError) {
      console.error('Failed to create managed wallet profile:', profileError)
      // Non-fatal -- auth user exists, profile will be created on next /me call
    }

    // Sign in to get a real session
    const tempClient = createIsolatedAuthClient()
    const { data: signInData, error: signInError } = await tempClient.auth.signInWithPassword({
      email: tempEmail,
      password: tempPassword,
    })

    if (signInError || !signInData.session) {
      console.error('Failed to sign in managed wallet account:', signInError?.message)
      await supabaseAdmin.auth.admin.deleteUser(data.user.id).catch(() => {})
      throw new ApplicationError(
        'Unable to create session. Please try again later.',
        503,
        'SESSION_FAILED'
      )
    }

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
        displayName,
        accountType: 'managed_cardano',
        walletAddress: address,
        roles: ['user'],
      },
    })
  } catch (error) {
    next(error)
  }
})

// ── GET /api/auth/wallet/managed/blob ─────────────────────────────────
/**
 * Return the encrypted wallet blob for the authenticated user so they can
 * decrypt it on a new device (after exporting the device secret separately).
 * Returns null if the user has no managed wallet.
 */
router.get('/managed/blob', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId
    if (!userId) throw new UnauthorizedError('Not authenticated')

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('wallet_address, encrypted_wallet_blob')
      .eq('id', userId)
      .single()

    if (error || !user) {
      throw new Error('Failed to fetch user')
    }

    if (!user.wallet_address?.startsWith('managed_') || !user.encrypted_wallet_blob) {
      return res.json({ success: true, blob: null })
    }

    res.json({ success: true, blob: user.encrypted_wallet_blob })
  } catch (error) {
    next(error)
  }
})
export default router
