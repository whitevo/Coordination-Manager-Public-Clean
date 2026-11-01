---
name: express-api
description: Guides creating and modifying Express.js endpoints in apps/api - route files, authMiddleware/optionalAuthMiddleware and bot-secret middleware, rate limiter tiers, input validation, error classes, CORS/Helmet/CSP, and Supabase client usage. Use when adding or editing API routes, middleware, or services, adding rate limiting, wiring auth to an endpoint, or building an endpoint that queries Supabase.
---

# express-api

Inputs that change the steps: auth requirement (required, optional, bot-secret, or agent-bearer) selects step 2; public-facing endpoints need step 4.

## Workflow

1. **Create the route file** `Code/apps/api/src/routes/{feature}.ts` (`const router = Router()`).
   - Import Supabase clients from `../supabaseClient.js`:
     - `supabase` -- anon key, respects RLS (user-scoped queries)
     - `supabaseAdmin` -- service role key, bypasses RLS (backend-only operations)
   - For auth sign-in flows, create a request-scoped client to avoid session contamination: `const tempClient = createClient(url, serviceKey)` (isolated, not reused)

2. **Apply auth**:
   - Required: `router.use(authMiddleware)` (401 if no valid token). Optional: `router.use(optionalAuthMiddleware)`
   - Bot-to-API: verify the `X-Bot-Secret` header against `BOT_API_SECRET` with `timingSafeEqual()` (not `===`); see `/api/internal/send-email` in `index.ts`
   - Agent bearer: custom bearer token auth with scope enforcement (`agent-api.ts`)
   - Access the user via `req as AuthenticatedRequest`: `req.userId`, `req.userEmail`, `req.userRole`, `req.userRoles`, `req.rawAuthUserId` (pre-merge redirect ID), `req.accessToken` (raw JWT for forwarding)
   - Merged user resolution: middleware checks `redirect_to_user_id`, then wallet_address lookup, read only from `app_metadata` via `getTrustedAuthMetadata()`. Never read identity links (wallet_address, account_type, redirect) from `user_metadata`: users can edit it with `supabase.auth.updateUser`
   - `created_by` identity: `req.userEmail || req.userId` (server-verified, as in `meetings.ts`). Never trust client identity; endpoints that create owned records require a verified session (`calendars.ts` POST returns 401 without one) rather than accepting body `created_by`. Account types: UUID (google), email, traveler_name, wallet_address. Use the `buildCreatorNameMap()` pattern for display name resolution.

3. **Validate input** with helpers from `../middleware/validation.ts`:
   - `sanitizeString(input, maxLength?)` -- trim, type check, length bounds
   - `sanitizeUUID(input)` -- regex validation for UUID v4
   - Return 400 with a descriptive error; use early returns
   - `ANNOUNCEMENT_BODY_MAX_LENGTH = 1800` for text limits

4. **Rate limit** (create a limiter if the endpoint is public-facing):
   - Import `rateLimit` from `express-rate-limit`
   - Use `getRateLimitKey` from `config/rate-limiters.ts` (per client: `req.ip` behind the trusted Railway proxy, socket address in dev; never the raw socket address in production, which is the proxy)
   - Register it in `Code/apps/api/src/config/rate-limiters.ts` (`limiterDefinitions`); that file is the source of truth for tiers. Examples: auth 120 req/15min (per auth path), profile 240, announcement writes 80, announcement status reads 800, global 1200
   - Soft warning at 25% remaining: `index.ts` sets `X-RateLimit-Warn` globally; no per-route code needed

5. **Handle errors**: custom classes from `../middleware/error-handler.ts`:
   - `ValidationError(message)` -- 400
   - `UnauthorizedError(message)` -- 401
   - `ApplicationError(message, statusCode, code)` -- custom
   - Wrap handlers in try/catch and throw custom errors for known cases; the global error handler catches the rest
   - Response format: `{ error: "CODE", message: "text", statusCode: N }`

6. **Register the route** in `Code/apps/api/src/index.ts`: import the router and mount `app.use('/api/{feature}', featureRoutes)`, after the middleware stack (Helmet, CORS, rate limiters) and before the error handler. `trust proxy` is enabled when `NODE_ENV=production` (Railway reverse proxy).

7. **Guest-facing endpoints, dynamic captcha**:
   - SignupRateTracker: sliding window, more than 10 signups in 60 seconds triggers a 1-hour lockdown
   - `GET /api/auth/captcha-required` returns current state (deduplicated by frontend)
   - When active, verify the Cloudflare Turnstile token on guest signup

8. **Add a test** `Code/apps/api/src/routes/__tests__/{feature}.test.ts` (services use `src/services/__tests__/`) (see testing-strategy for the chain-mocking pattern).

## Gotchas

- CORS config and Helmet/CSP directives are in the reference. The API has no WebSocket code today.
- NEVER use `eval()` to process request or message content.

## References

- [references/security-config.md](references/security-config.md) -- read when changing CORS or Helmet/CSP (WebSocket checklist is for a future feature).
