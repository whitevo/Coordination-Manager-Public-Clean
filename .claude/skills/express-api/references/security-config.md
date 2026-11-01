# CORS, CSP, and WebSocket security

Read when changing CORS or Helmet/CSP configuration, or adding WebSocket features.

## CORS hardening

- Use a strict allowlist for `Access-Control-Allow-Origin` (existing pattern)
- NEVER use `*` or blindly reflect the request `Origin` header
- In production, consider rejecting or logging requests with no `Origin` header
  (allowed for mobile apps/curl -- tighten if not needed)
- CORS is NOT CSRF protection. CORS only controls browser cross-origin
  requests; it does not prevent server-to-server or non-browser attacks.
- Preflight cache: 86400s (24h) to reduce OPTIONS overhead

## Security headers (Helmet + CSP)

- Helmet is already applied globally for basic security headers
- CSP should be strict: use nonce- or hash-based directives for script/style sources
- Do NOT assume Helmet defaults match the app -- configure explicitly. `index.ts` currently sets only `defaultSrc` and `frameAncestors`; the rest is a target list:
  - `defaultSrc: ["'none'"]`
  - `scriptSrc: ["'self'"]` (add nonces if inline scripts needed)
  - `styleSrc: ["'self'", "'unsafe-inline'"]` (TailwindCSS may need unsafe-inline)
  - `imgSrc: ["'self'", "data:", "https:"]`
  - `connectSrc: ["'self'", FRONTEND_URL, SUPABASE_URL]`
  - `frameAncestors: ["'none'"]`

## WebSocket security (no WebSocket code exists yet; checklist for when real-time features are added)

- Validate `Origin` header during the handshake (prevent CSWSH attacks)
- Authenticate during the handshake (verify JWT before upgrading the connection)
- Authorize per message type (not just at connection time)
- Use `wss://` (TLS) for all socket traffic with sensitive data
- Enforce message size limits (64KB recommended max)
- Rate limit messages per connection (prevent flooding/DoS)
- Implement connection limits per user and globally
- Add heartbeat/ping-pong to detect stale connections
- Never use `eval()` on message content -- use `JSON.parse()` only
- Log security events (connect, disconnect, auth failures) without tokens
- Rotate tokens for long-lived connections to limit hijack window
