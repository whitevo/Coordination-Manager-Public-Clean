---
name: authentication-system
description: Guides the Google OAuth, Cardano CIP-30 wallet, and traveler guest login flows, plus AuthContext, auth middleware, dynamic captcha, and account merge. Use when modifying login flows, auth middleware, account merge or linking, wallet support, traveler expiry or captcha, ProtectedRoute, or debugging session persistence and token refresh.
---

# authentication-system

First decide which flow the change touches: google, cardano, traveler, or merge. Then use the matching step.

## Workflow

1. **Google OAuth**:
   - Frontend `supabase.auth.signInWithOAuth({ provider: 'google' })`, returning to `/auth/callback`
     (AuthCallbackPage waits for the session, then loads the profile). The redirect URI in Google Cloud
     Console must match exactly (no wildcards).
   - PKCE: `lib/supabase.ts` sets `flowType: 'pkce'`; supabase-js exchanges `?code=` on
     `/auth/callback` using the code verifier kept in the auth storage adapter (same tab). Never use
     the implicit grant or Resource Owner Password Credentials.
   - The `users` row is created lazily by the first `GET /api/auth/me` (insert, not upsert; a 23505 race
     re-reads): `account_type = app_metadata.account_type || 'google'`, `google_id` from `provider_id`.

2. **Cardano wallet (CIP-30)**:
   - Frontend detects wallets via `window.cardano` (Lace, Eternl, Typhon, Yoroi):
     `connectWallet(walletId)` -> `getWalletAddress()`.
   - `POST /api/auth/wallet/challenge` returns a nonce (5-min TTL, one-time; captcha is enforced here, not
     at verify); frontend calls `wallet.signData(buildSignMessage(nonce))`; then
     `POST /api/auth/wallet/verify` (`address, nonce, signature, key`).
   - Signing message MUST stay under 80 chars (Lace UI breaks): `"Coordination Manager Login\nNonce: ${nonce}"`.
   - The wallet address shown in the UI is never proof of identity (injected wallet objects are
     adversarial); always require the challenge-response signature.
   - Credentials: HMAC-SHA256 (key `JWT_SECRET`) of the wallet address gives a deterministic password and `wallet-{address prefix}@cardano.wallet` email for the
     Supabase auth user (derived, never stored); `JWT_SECRET` is required outside tests. Wallet and
     traveler sign-ins use a per-request client from `createIsolatedAuthClient()` (middleware/auth.ts),
     never the shared `supabaseAdmin`.
   - `account_type = 'cardano'`, `wallet_address` stored.
   - Log wallet-linking events (connect, disconnect, account change, signature failure) without payloads or keys.

3. **Traveler (guest) with dynamic captcha**:
   - Frontend `POST /api/auth/guest { captchaToken }`.
   - `SignupRateTracker` (sliding window): more than 10 signups in 60 seconds triggers a 1-hour lockdown with captcha required.
     Frontend checks `GET /api/auth/captcha-required` (deduplicated via `useCaptchaMode()`).
   - Captcha is Cloudflare Turnstile; tokens are single-use; `verifyCaptcha` only enforces them while captcha is required.
   - Backend creates a UUID-based temp email + password and a random name `{Adjective} {Noun} {0-99}`
     (20 adjectives x 20 nouns); Supabase auth user + profile with `account_type = 'traveler'`.
   - `expires_at = NOW() + 64 days` MUST be set (`cleanup_expired_travelers()` removes them; it must be scheduled separately). Returns `{ session, user }` with full JWT.

4. **AuthContext (frontend)**:
   - Exposes `user, session, isLoading, isAuthenticated, isTraveler, isCardano` and
     `login(), loginAsTraveler(), loginWithCardano(), logout(), updateProfile(), refreshProfile()`.
   - `isLoading` never exceeds 5 seconds (safety timeout). `initializedRef` prevents duplicate loads;
     `walletLoginInProgressRef` suppresses `onAuthStateChange` during wallet login (local signOut + signIn).
   - Logout: `signOut()` in `auth-service.ts` calls `/api/auth/logout` (best effort), then `supabase.auth.signOut()`, then clears sessionStorage and user-specific localStorage keys.
   - Auth is JWT Bearer (no cookies, so no cookie CSRF); tokens live in sessionStorage by default; "Remember me" moves them to localStorage (`setAuthPersistence` in `lib/supabase.ts`), bounded by a 14-day inactivity limit (`lib/session-activity.ts`).
   - `ProtectedRoute` shows a spinner while `isLoading`, then redirects to `/auth/login` with `state.from`.
     If cookies are ever added - Secure, HttpOnly, SameSite=Lax minimum, plus CSRF tokens.

5. **Auth middleware (backend)**:
   - `AuthenticatedRequest` adds `userId, userEmail, userRole, userRoles, rawAuthUserId, accessToken,
     authAal` (JWT `aal`; `hasMfaAssurance(req)` checks aal2 for admin actions).
     `userRoles` is parsed from the JSONB `roles` column, default `['user']`.
   - Merged-user resolution checks `redirect_to_user_id`, then wallet_address lookup, and
     transparently redirects to the surviving account when the profile row was deleted after a merge
     (this keeps an unlinked wallet session alive in every tab). Identity links (`wallet_address`,
     `account_type`, `redirect_to_user_id`) are written to and read from `app_metadata` only
     (`getTrustedAuthMetadata()`); `user_metadata` is user-writable and holds display data only.
   - Roles come from the `users.roles` column, loaded by the middleware on every request; never from
     `user_metadata`.

6. **Account merge**:
   - `createMergeToken(sourceUserId, sourceAccountType)` / `consumeMergeToken(token)`: stored as a sha256
     hash in `account_merge_tokens` (migration 033), 10-min TTL, single use (consumed even if the merge
     then fails).
   - `mergeAccounts(source, target, keepSettings)` moves calendars (meetings follow via calendar_id),
     calendar sources, templates, schedules, feedback, Discord integrations, contacts, connections and
     prefs; copies missing identity fields (wallet_address, stake_address, google_id, email); always merges
     custom themes; keepSettings copies timezone, reminder, theme, display name, avatar. Deletes the source
     `users` row (auth.users kept for wallet lookup). `POST /api/auth/account/complete-link` always passes
     keepSettings=true.

## Key files

- `Code/apps/api/src/routes/auth.ts`, `Code/apps/api/src/routes/wallet-auth.ts` - auth routes
- `Code/apps/api/src/middleware/auth.ts` - authMiddleware / optionalAuthMiddleware
- `Code/apps/api/src/services/signup-rate-tracker.ts` - SignupRateTracker
- `Code/apps/web/src/lib/auth-service.ts` - frontend auth calls
- `Code/apps/web/src/contexts/AuthContext.tsx` - AuthContext
- `Code/apps/web/src/lib/cardano-wallet.ts` - wallet utils
- `Code/apps/api/src/services/account-merge.ts`, `services/captcha.ts` - merge and Turnstile
- `Code/apps/web/src/lib/supabase.ts`, `lib/session-activity.ts`, `pages/auth/AuthCallbackPage.tsx`, `components/ProtectedRoute.tsx`
