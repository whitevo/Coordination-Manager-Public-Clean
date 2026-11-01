# Security Rules

## Secrets
- NEVER commit .env files, API keys, tokens, or credentials
- NEVER expose SUPABASE_SERVICE_ROLE_KEY in API responses or logs
- NEVER expose JWT_SECRET, DISCORD_BOT_TOKEN, or SMTP passwords
- Use environment variables for all secrets (VITE_ prefix for frontend-safe values)
- VITE_ prefixed variables are bundled into browser JS -- they are public
- Rotate secrets on a schedule; rotate immediately on suspected exposure

## Input Validation
- Validate and sanitize ALL user input at the API boundary
- Use sanitizeString() and sanitizeUUID() helpers from middleware/validation.ts
- Never trust client-supplied user identity -- verify from JWT
- Server-verified identity: req.userEmail || req.userId (from auth middleware)
- Strip CR/LF from user input before logging (prevent log injection)

## Authentication
- Use authMiddleware (middleware/auth.ts) for protected endpoints
- Use optionalAuthMiddleware for public endpoints that benefit from user context
- Rate limit all public-facing endpoints per client via `getRateLimitKey` (trusted-proxy `req.ip` in production, never raw client-supplied headers)
- Captcha required for traveler/guest account creation
- NEVER store authorization data in raw_user_meta_data (user-writable)
- USE raw_app_meta_data for roles/permissions (service-role only)
- Force token refresh after role/permission changes (JWT freshness)

## Authorization
- Enforce object-level authorization on every endpoint accepting object IDs (BOLA prevention)
- Random IDs (nanoid hash) are defense-in-depth, NOT authorization -- always enforce server-side
- RLS policies must exist for every operation (SELECT/INSERT/UPDATE/DELETE) you allow
- Views bypass RLS by default -- use security_invoker = true on Postgres 15+

## Database
- Enable RLS on all new tables
- Use supabaseAdmin (service role) only in backend code, never in frontend
- Frontend uses supabase client with anon key (respects RLS)
- Index all columns used in RLS policy expressions (performance)
- Write RLS regression tests for cross-tenant access prevention

## Frontend
- No secrets in frontend code (VITE_ vars are public)
- Sanitize user-generated content before rendering
- Use Content Security Policy headers (configured in Helmet + Vercel)
- NEVER use dangerouslySetInnerHTML with untrusted content
- Include HSTS header in production (Strict-Transport-Security)

## Logging
- NEVER log tokens, passwords, API keys, or Authorization headers
- Use morgan 'short' or custom format in production (not 'dev')
- Log security events (auth failures, rate limits) with sanitized context
- Strip CR/LF from logged values to prevent log injection

## Supply Chain
- Pin GitHub Actions to commit SHAs (not mutable tags)
- CI fails on high/critical advisories via the OSV audit in scripts/security-check.ps1 (pnpm audit runs locally and in the weekly non-blocking drift workflow)
- Enable blockExoticSubdeps in pnpm config
- Use allowBuilds (pnpm-workspace.yaml) to restrict install scripts
- Use --frozen-lockfile in CI for reproducible builds
