import { Request, Response, NextFunction } from 'express'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { supabase, supabaseAdmin } from '../supabaseClient.js'
import { ApplicationError, UnauthorizedError } from './error-handler.js'
import { isMeaningfulEnvValue } from '../services/local-config.js'
import { getSupabaseServerKey } from '../services/supabase-key.js'

// Express 5 types widen params to string | string[] for splat routes; no route here uses a splat.
export interface AuthenticatedRequest extends Request<Record<string, string>> {
  userId?: string
  userEmail?: string
  userRole?: string
  userRoles?: string[]
  authAal?: string
  /** The raw Supabase Auth user ID before any merged-user redirect */
  rawAuthUserId?: string
  /** The raw JWT access token from the Authorization header */
  accessToken?: string
}

// Unambiguous: `\s+` ends at the first non-space, so no overlap with the
// token group (polynomial-backtracking safe).
const BEARER_PATTERN = /^Bearer\s+(\S.*)$/i

/** Extract the token from an `Authorization: Bearer <token>` header (case-insensitive scheme). */
function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined
  const match = BEARER_PATTERN.exec(header)
  const token = match?.[1]?.trim()
  return token || undefined
}

/**
 * Create a throwaway Supabase client for password sign-in. signInWithPassword
 * stores session state on the client it is called on, so it must never run on
 * the shared admin client. Uses the environment-selected secret API key so the request
 * bypasses Supabase's built-in CAPTCHA enforcement (callers verify captcha
 * themselves).
 */
export function createIsolatedAuthClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const { name, value: key } = getSupabaseServerKey()
  if (!url?.trim() || !key || !isMeaningfulEnvValue(name, key)) {
    throw new ApplicationError(
      'Supabase server credentials are required for password sign-in',
      503,
      'SUPABASE_AUTH_UNCONFIGURED'
    )
  }
  return createClient(
    url,
    key,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  try {
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8')
    const parsed = JSON.parse(payload) as unknown
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

/** Check if the authenticated user has a specific role */
export function hasRole(req: AuthenticatedRequest, role: string): boolean {
  return req.userRoles?.includes(role) ?? req.userRole === role
}

/** Supabase marks sessions verified by MFA as aal2. */
export function hasMfaAssurance(req: AuthenticatedRequest): boolean {
  return req.authAal === 'aal2'
}

/** Parse roles from DB JSONB array */
function parseRoles(dbRoles: unknown): string[] {
  if (Array.isArray(dbRoles) && dbRoles.length > 0) {
    return dbRoles.map(String)
  }
  return ['user']
}

/**
 * Identity-linking metadata (wallet_address, redirect_to_user_id, account_type) is read
 * ONLY from app_metadata, which only the service role can write. user_metadata is
 * user-writable via supabase.auth.updateUser, so trusting it would let any signed-in
 * user redirect their session to another account.
 */
export function getTrustedAuthMetadata(user: { app_metadata?: unknown } | null | undefined): Record<string, unknown> {
  const appMetadata = user?.app_metadata
  return appMetadata && typeof appMetadata === 'object' ? appMetadata as Record<string, unknown> : {}
}

/**
 * Resolve a merged wallet user: when a Supabase Auth user has no matching
 * row in the `users` table (because the merge deleted it), look up the
 * surviving account by wallet_address.
 *
 * Returns the redirected { userId, userEmail, userRole, userRoles } or null.
 */
async function resolveMergedUser(
  authUserId: string,
  authUserEmail: string | undefined,
  trustedMetadata: Record<string, unknown>
): Promise<{ userId: string; userEmail: string | undefined; userRole: string; userRoles: string[] } | null> {
  // 1. Check for an explicit redirect (set when wallet was unlinked while
  //    the user was logged in via the wallet session — keeps session alive).
  const redirectToUserId = trustedMetadata.redirect_to_user_id as string | undefined
  if (redirectToUserId && redirectToUserId !== authUserId) {
    const { data: targetUser } = await supabaseAdmin
      .from('users')
      .select('id, email, roles')
      .eq('id', redirectToUserId)
      .maybeSingle()
    if (targetUser) {
      const roles = parseRoles(targetUser.roles)
      return {
        userId: targetUser.id,
        userEmail: targetUser.email || authUserEmail,
        userRole: roles[0] || 'user',
        userRoles: roles,
      }
    }
  }

  // 2. If the auth user's wallet_address is known, see if another user owns it
  const walletAddress =
    trustedMetadata.wallet_address as string | undefined

  if (!walletAddress) return null

  const { data: linkedUser } = await supabaseAdmin
    .from('users')
    .select('id, email, roles')
    .eq('wallet_address', walletAddress)
    .maybeSingle()

  if (linkedUser && linkedUser.id !== authUserId) {
    const roles = parseRoles(linkedUser.roles)
    return {
      userId: linkedUser.id,
      userEmail: linkedUser.email || authUserEmail,
      userRole: roles[0] || 'user',
      userRoles: roles,
    }
  }

  return null
}

interface PhantomProfileRow {
  wallet_address?: string | null
  email?: string | null
  google_id?: string | null
  account_type?: string | null
}

/**
 * Delete an auto-created "phantom" profile row. Only rows that are clearly
 * empty (cardano account with no email and no google_id) are removed; anything
 * else is left alone and the caller just redirects. Failures are logged and
 * never block the request.
 */
async function cleanUpPhantomProfile(authUserId: string, profile: PhantomProfileRow): Promise<void> {
  if (profile.email || profile.google_id || profile.account_type !== 'cardano') return
  try {
    const { error } = await supabaseAdmin.from('users').delete().eq('id', authUserId)
    if (error) {
      console.warn('Failed to remove phantom profile:', String(error.message ?? '').replace(/[\r\n]+/g, ' '))
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('Failed to remove phantom profile:', message.replace(/[\r\n]+/g, ' '))
  }
}

/**
 * Detect a "phantom" profile: a profile auto-created for a merged wallet auth
 * user (before the redirect fix existed). Signature: the auth user has a
 * trusted wallet_address in app_metadata but the profile row does NOT have
 * wallet_address, and another user owns the wallet now. When the redirect
 * target resolves, the request is redirected and the empty row is cleaned up.
 *
 * Returns true when the request was redirected.
 */
async function redirectPhantomProfile(
  req: AuthenticatedRequest,
  authUser: { id: string; email?: string; app_metadata?: unknown },
  profile: PhantomProfileRow
): Promise<boolean> {
  const trustedMetadata = getTrustedAuthMetadata(authUser)
  if (!trustedMetadata.wallet_address || profile.wallet_address) return false

  const merged = await resolveMergedUser(authUser.id, authUser.email, trustedMetadata)
  if (!merged) return false

  req.userId = merged.userId
  req.userEmail = merged.userEmail
  req.userRole = merged.userRole
  req.userRoles = merged.userRoles
  // Clean up the phantom row so future requests skip this check
  await cleanUpPhantomProfile(authUser.id, profile)
  return true
}

/**
 * Middleware that verifies the Supabase access token from the Authorization header.
 * Attaches user info to the request object for downstream handlers.
 * Rejects unauthenticated requests.
 *
 * If the authenticated Supabase user has no `users`-table row (post-merge),
 * the middleware transparently redirects to the surviving account that holds
 * the same wallet_address.
 */
export async function authMiddleware(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
) {
  try {
    const token = extractBearerToken(req.headers.authorization)

    if (!token) {
      throw new UnauthorizedError('Missing authentication token')
    }

    // Verify the token with Supabase to get the user
    const { data, error } = await supabase.auth.getUser(token)

    if (error || !data.user) {
      throw new UnauthorizedError('Invalid or expired token')
    }

    // Attach user info to request
    req.userId = data.user.id
    req.userEmail = data.user.email
    req.rawAuthUserId = data.user.id  // preserve before any redirect
    req.accessToken = token  // preserve raw JWT for server-side sign-out
    const jwtPayload = decodeJwtPayload(token)
    req.authAal = typeof jwtPayload?.aal === 'string' ? jwtPayload.aal : undefined

    // Fetch roles (and wallet_address) from the database so admin
    // role set directly in the DB is respected.
    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('roles, wallet_address, email, google_id, account_type')
      .eq('id', data.user.id)
      .maybeSingle()

    if (profile) {
      const roles = parseRoles(profile.roles)
      req.userRole = roles[0] || 'user'
      req.userRoles = roles

      // Detect and redirect a "phantom" profile (see redirectPhantomProfile)
      await redirectPhantomProfile(req, data.user, profile)
    } else {
      // No users-table row — this auth user may have been merged.
      // Check if the wallet_address now belongs to a different (surviving) user.
      const merged = await resolveMergedUser(
        data.user.id,
        data.user.email,
        getTrustedAuthMetadata(data.user)
      )
      if (merged) {
        req.userId = merged.userId
        req.userEmail = merged.userEmail
        req.userRole = merged.userRole
        req.userRoles = merged.userRoles
      } else {
        // SECURITY: Never read roles from user_metadata (user-writable via
        // supabase.auth.updateUser). Default to unprivileged 'user' role.
        req.userRole = 'user'
        req.userRoles = ['user']
      }
    }

    next()
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      next(error)
    } else {
      next(new UnauthorizedError('Token verification failed'))
    }
  }
}

/**
 * Optional auth middleware — extracts user info if a valid token is present,
 * but allows the request to proceed without auth for public access.
 * Use on routes that are publicly readable but need auth for write operations.
 *
 * Also handles merged-user redirection (same as authMiddleware).
 */
export async function optionalAuthMiddleware(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
) {
  try {
    const token = extractBearerToken(req.headers.authorization)

    if (token) {
      const { data, error } = await supabase.auth.getUser(token)
      if (!error && data.user) {
        req.userId = data.user.id
        req.userEmail = data.user.email
        req.rawAuthUserId = data.user.id  // preserve before any redirect

        const { data: profile } = await supabaseAdmin
          .from('users')
          .select('roles, wallet_address, email, google_id, account_type')
          .eq('id', data.user.id)
          .maybeSingle()

        if (profile) {
          const roles = parseRoles(profile.roles)
          req.userRole = roles[0] || 'user'
          req.userRoles = roles

          // Detect phantom profile (see redirectPhantomProfile)
          await redirectPhantomProfile(req, data.user, profile)
        } else {
          // No users-table row — check for merged wallet user
          const merged = await resolveMergedUser(
            data.user.id,
            data.user.email,
            getTrustedAuthMetadata(data.user)
          )
          if (merged) {
            req.userId = merged.userId
            req.userEmail = merged.userEmail
            req.userRole = merged.userRole
            req.userRoles = merged.userRoles
          } else {
            // SECURITY: Never read roles from user_metadata (user-writable via
            // supabase.auth.updateUser). Default to unprivileged 'user' role.
            req.userRole = 'user'
            req.userRoles = ['user']
          }
        }
      }
    }
  } catch {
    // Token invalid or missing — proceed as unauthenticated
  }
  next()
}

/**
 * Check if the current user has edit permission on a calendar.
 * Matches by email or userId against `created_by` and `permissions.canEdit`.
 */
export function hasCalendarEditPermission(
  calendar: { created_by: string; permissions?: { canEdit?: string[] } | null },
  req: AuthenticatedRequest
): { isCreator: boolean; canEdit: boolean } {
  const createdBy = calendar.created_by || ''
  const isCreator = createdBy === req.userEmail || createdBy === req.userId
  // Normalize canEdit to an array — legacy data may store it as a space-separated string
  const rawEditList = (calendar.permissions as { canEdit?: unknown } | null)?.canEdit
  const editList: string[] = Array.isArray(rawEditList)
    ? rawEditList
    : typeof rawEditList === 'string' && rawEditList
      ? rawEditList.split(/\s+/)
      : []
  const canEdit = isCreator ||
    (!!req.userEmail && editList.includes(req.userEmail)) ||
    (!!req.userId && editList.includes(req.userId))
  return { isCreator, canEdit }
}

/**
 * Like hasCalendarEditPermission but also resolves cross-format identity
 * mismatches (e.g. created_by is a UUID but the requester authenticates
 * with an email, or vice-versa). Queries the users table when the simple
 * string comparison fails.
 */
export async function hasCalendarEditPermissionAsync(
  calendar: { created_by: string; permissions?: { canEdit?: string[] } | null },
  req: AuthenticatedRequest
): Promise<{ isCreator: boolean; canEdit: boolean }> {
  // Fast path — synchronous check first
  const sync = hasCalendarEditPermission(calendar, req)
  if (sync.canEdit) return sync

  // Slow path — created_by might be stored in a different format than the
  // requester's identity. Look up the user row to cross-reference.
  const createdBy = calendar.created_by || ''
  if (!createdBy || !req.userId) return sync

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  try {
    if (uuidPattern.test(createdBy)) {
      // created_by is a UUID — check if it matches the requester's user row
      const { data: creatorUser } = await supabaseAdmin
        .from('users')
        .select('id, email')
        .eq('id', createdBy)
        .maybeSingle()

      if (creatorUser) {
        const isCreator =
          creatorUser.id === req.userId ||
          (!!req.userEmail && creatorUser.email === req.userEmail)
        if (isCreator) return { isCreator: true, canEdit: true }
      }
    } else if (createdBy.includes('@')) {
      // created_by is an email — check if it belongs to the requester
      const { data: creatorUser } = await supabaseAdmin
        .from('users')
        .select('id, email')
        .eq('email', createdBy)
        .maybeSingle()

      if (creatorUser && creatorUser.id === req.userId) {
        return { isCreator: true, canEdit: true }
      }
    }
  } catch {
    // DB lookup failed — fall through to sync result
  }

  return sync
}
