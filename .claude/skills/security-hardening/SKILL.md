---
name: security-hardening
description: Hardens the Coordination Manager stack (Supabase RLS, Express rate limiting, CORS, input and URL validation, Discord bot, secrets rotation, gitleaks), with open-source prep checklists and a catalog of security test scenarios (IDs A1 to W4). Use when reviewing security posture, auditing RLS or rate limits, scanning for leaked secrets, running security tests, or setting platform dashboard security. Not for dependency or CI pinning; use supply-chain-security.
---

# security-hardening

Pick the area first: platform settings, code hardening, open-source prep, or test
scenarios. Baseline rules (RLS everywhere, sanitize helpers, no secrets in logs) are in
`.claude/rules/security.md`; this skill adds the project specifics.

## Workflow

1. **Platform settings (manual dashboards, not automatable).** Walk the tables in
   `references/platform-settings.md` (Supabase, Vercel, Railway, Discord Developer Portal).
2. **Code-level hardening.**
   - RLS key tables: `calendars`, `availability`, `meetings`, `calendar_sources`,
     `announcement_templates`. Tables/functions with no client access use REVOKE as well as RLS.
     RLS SQL tests in `Code/packages/database/tests` are manual (no CI DB job).
   - Auth: admin routes need MFA aal2 (`hasMfaAssurance`). Identity links come only from
     `app_metadata` via `getTrustedAuthMetadata`; roles from `users.roles`. `POST /api/calendars`
     requires a verified session and `created_by` comes from the token.
   - BOLA: every endpoint taking a calendar hash, meeting ID, or template ID checks that the
     user owns or can access that object. The API check runs before RLS as defense-in-depth.
     Nanoid hashes are not authorization.
   - Rate limiting: `express-rate-limit` keyed per client by `getRateLimitKey`: behind the trusted
     Railway proxy (production, `trust proxy` = 1) it uses `req.ip` (the proxy-appended client address;
     client-supplied X-Forwarded-For entries are ignored), otherwise the socket address. Never key on the
     socket address alone in production (it is the proxy: one shared bucket). Only signup/captcha
     (`SignupRateTracker`) is intentionally global. Hits are logged by `logRateLimitHit`. Limiters are
     skipped for localhost only when `NODE_ENV !== 'production'`.

     Limits live in `Code/apps/api/src/config/rate-limiters.ts`; read it for current
     values (they change). Examples: global 1200 / 15 min (not `/health`), auth
     login/wallet/logout/account 120 / 15 min, Discord key generation 20 / hour,
     AI chat 480 / 15 min.

   - Input validation: `sanitizeString()` and `sanitizeUUID()` from `Code/apps/api/src/middleware/validation.ts`.
   - User-supplied URLs (meeting links, onboarding URLs, resource URLs, callbacks) must pass
     `isSafeUrl()` from `Code/apps/web/src/lib/calendar-utils.ts` (frontend only; http/https
     only, so it rejects `javascript:`, `data:`, `vbscript:`, `file:`) before rendering or
     navigating. Server-side fetches of user-supplied URLs go through `fetchPublicCalendarUrl`
     (`services/public-calendar-fetch.ts`): https only, private/internal hosts blocked, DNS checked,
     redirects followed manually (max 3) with every hop re-validated. Use it for any new server-side
     `fetch` of a user URL.

     | Pattern | Guard |
     |---------|-------|
     | `<a href={userVar}>` | `{isSafeUrl(userVar) && <a href={userVar}>...}` |
     | `window.location.href = apiVar` | `if (/^https:\/\//i.test(apiVar)) window.location.href = apiVar` |
     | `window.open(apiVar)` | `if (isSafeUrl(apiVar)) window.open(apiVar, '_blank', 'noopener')` |

     For any new link, check whether the source is user-controlled or API-returned; if
     either, guard it.
   - Production errors: generic messages when `NODE_ENV === 'production'`; no stack traces
     or raw Supabase errors in responses; log details server-side only.
   - CORS, log hygiene, Discord bot rules (`allowedMentions`, `X-Bot-Secret`), the
     protected-URL file list, NanoID note, and WebSocket rules: read
     `references/code-hardening-details.md`.
3. **Open-source preparation.** Follow `references/open-source-checklist.md`:
   1. `gitleaks detect` on full repo history -- must return zero findings
   2. Scrub real URLs, project IDs, hardcoded secrets from docs
   3. Enable GitHub Secret Scanning + Push Protection + Dependabot
   4. Verify `SECURITY.md` and `LICENSE` exist
   5. Rotate ALL secrets after open-sourcing
4. **Security test scenarios.** Run scenarios from `references/security-test-catalog.md`
   and record pass/fail for each ID:
   - A1-A6 auth/authz, B1-B4 BOLA, D1-D5 Discord abuse, R1-R5 API abuse
   - E1-E3 data exposure, L1-L3 logging, S1-S3 supply chain
   - P1-P3 prompt injection (future), W1-W4 WebSocket (future; no WebSockets in the code today)
5. **Automated gate.** Before security reports or public-sync decisions run
   `pnpm security:check`; if it fails, fix and re-run. Use `pnpm security:check:fast`
   pre-commit and `pnpm security:premerge` pre-merge. Layers, gitleaks modes and
   baseline, secrets rotation, and habits: `references/security-automation.md`.

## Key files

- `.github/workflows/security-drift-weekly.yml` - weekly medium-severity drift report
- `.github/workflows/gitleaks.yml` - gitleaks CLI scans; `ci.yml` - quality gate + OSV audit; `dependency-review.yml` - advisory
- `.github/workflows/codeql.yml` - CodeQL, explicitly non-blocking
- `scripts/security-check.ps1` - local gate; `scripts/security-premerge.ps1` - pre-merge helper
- `scripts/weekly-security-drift-summary.mjs` - drift summary for CI output
- `Code/apps/api/src/middleware/validation.ts` - sanitizers
- `Code/apps/api/src/config/rate-limiters.ts` - rate limit config
- `Code/apps/api/src/middleware/auth.ts` - `authMiddleware` (the rules' requireAuth), `optionalAuthMiddleware`
- `Code/apps/web/vercel.json` - frontend security headers
- `SECURITY.md` - disclosure instructions
- `packages/database/migrations/*.sql` - RLS policies

## Gotchas

- CodeQL `continue-on-error: true` is intentional; do not "fix" it.
- Use the gitleaks CLI in a `run:` step, not `gitleaks/gitleaks-action` (license needed for orgs).
- Rotating `JWT_SECRET` invalidates in-flight OAuth flows and wallet credentials, not Supabase sessions; rotate in a low-traffic window.

## References

- `references/platform-settings.md` - read when applying dashboard settings
- `references/code-hardening-details.md` - read when touching CORS, logging, Discord bot, URL-guard locations, or WebSockets
- `references/open-source-checklist.md` - read when preparing a public release
- `references/security-test-catalog.md` - read when running or adding test scenarios
- `references/security-automation.md` - read for CI layers, local gate, secrets rotation schedule
- `references/gitleaks-rationale.md` - read when changing gitleaks setup or trust decisions
