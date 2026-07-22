---
name: security-hardening
description: Platform security hardening, open-source prep, and security test scenarios
---

# security-hardening

> **NOTE**: File paths and service configurations below are Coordination Manager specific.
> Adjust for other projects as needed.

## Purpose

Guides security hardening across the full stack (Supabase, Railway, Vercel, Discord bot),
preparation for open-sourcing the repository, and maintains a catalog of security test
scenarios for validating the platform resists common attacks.

## When to Use

- Reviewing or improving platform security posture
- Auditing RLS policies, rate limiting, or input validation
- Preparing the repo for open-sourcing (scrubbing secrets, git history)
- Running or updating security test scenarios
- Configuring platform-level security settings
- Checking for leaked secrets or exposed credentials

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| Target area | platform settings, code hardening, open-source prep, or test scenarios | yes |
| Specific service | Supabase, Vercel, Railway, Discord, or all | no |

## Workflow

### 1. Platform Settings (Manual -- Dashboard)

Review and apply dashboard-level security settings for each platform.
These are **not automatable** -- they require manual action in each service dashboard.

See `references/platform-settings.md` for full configuration tables covering:
- Supabase (RLS, auth rate limits, JWT expiry, pgAudit)
- Vercel (deployment protection, RBAC, branch protection)
- Railway (private networking, env isolation, restart policy)
- Discord Developer Portal (intents, permissions, token rotation)
- Secret rotation schedule

### 2. Code-Level Hardening

#### RLS Policies

All tables must have RLS enabled. Key tables: `calendars`, `availability`, `meetings`,
`calendar_sources`, `announcement_templates`. Service role key (`supabaseAdmin`) bypasses
RLS -- only use in trusted backend code.

#### Object-Level Authorization (BOLA Prevention)

OWASP API Security #1 risk. Every endpoint that accepts an object ID (calendar hash,
meeting ID, template ID) MUST enforce authorization at the object level -- not just
"is the user logged in?" Checks:
- Verify the requesting user owns or has access to the specific object
- RLS policies enforce this at the database layer
- API layer adds checks before RLS as defense-in-depth
- Random IDs (nanoid hash) are usability features, NOT authorization. Never rely
  solely on unguessable URLs for access control -- always enforce with server-side checks.
- NanoID(10) has ~1 trillion combinations. This provides defense-in-depth against
  enumeration but is less collision-resistant than the default NanoID(21). Back it with
  rate limiting + monitoring to make brute-force attempts noisy and expensive.

#### Rate Limiting

Uses `express-rate-limit` with socket-address-based identification (not header-based,
to prevent proxy spoofing):

| Endpoint Group | Limit |
|----------------|-------|
| Global API | 100 requests / 15 min per socket address |
| Auth endpoints | 15 requests / 15 min |
| Discord key generation | 5 requests / hour |
| Calendar operations | 30 requests / 15 min |
| AI endpoints | 20 requests / 15 min |

Rate limiter uses `trustProxy: false` and `req.socket.remoteAddress`.

#### Input Validation

- Use `sanitizeString()` and `sanitizeUUID()` from `middleware/validation.ts`
- Validate at API boundary before any database operations
- Never trust client-supplied identity -- verify from JWT via auth middleware

#### User-Supplied URL Safety

Any URL that originates from user input (meeting links, onboarding URLs, community
resource URLs, external service callback URLs) MUST be validated before rendering
as a clickable link or navigating to it.

**Use `isSafeUrl()` from `lib/calendar-utils.ts`** which validates the URL starts
with `http://` or `https://`. This prevents:
- `javascript:` URIs (XSS -- executes code in app context when clicked)
- `data:` URIs (can load arbitrary HTML/scripts)
- `vbscript:`, `file:`, and other exotic schemes

**Patterns to guard:**

| Pattern | Guard |
|---------|-------|
| `<a href={userVar}>` in JSX | `{isSafeUrl(userVar) && <a href={userVar}>...}` |
| `window.location.href = apiVar` | `if (/^https:\/\//i.test(apiVar)) window.location.href = apiVar` |
| `window.open(apiVar)` | `if (isSafeUrl(apiVar)) window.open(apiVar, '_blank', 'noopener')` |

**Currently protected locations** (as of April 2026):
- `CalendarPage.tsx` -- meeting links, community resource URLs
- `CoordinateEventsPage.tsx` -- event meeting links, sub-meeting links
- `EventsCalendarPage.tsx` -- event meeting links
- `MeetingPage.tsx` -- meeting join button
- `MeetingSidePanel.tsx` -- Luma event URL, Zoom auth URL
- `GuestBookingPage.tsx` -- onboarding URL
- `SettingsPage.tsx` -- Google/Zoom OAuth redirects (inline regex check)
- `GuardianPage.tsx` -- bot invite URL
- `LinkifyText` components -- regex-extracted, only match `https?://`

**When adding new user-facing links**: Always check if the URL source is user-controlled
or API-returned. If either, guard with `isSafeUrl()` or an inline scheme check.

#### CORS Hardening

- Use strict allowlist for `Access-Control-Allow-Origin` (never `*`, never reflect Origin)
- In production, reject or log requests with no `Origin` header (except health checks)
- CORS is NOT CSRF protection -- it only controls browser cross-origin requests

#### Log Injection Prevention

- Sanitize all user-supplied data before logging (strip CR/LF characters)
- Never log tokens, passwords, or sensitive headers (Authorization, Cookie)
- Use `morgan('short')` or custom format in production (not `'dev'` format)
- Encode log output correctly to prevent log injection attacks
- Treat WebSocket events the same as HTTP: log security events (auth failures,
  validation failures, rate-limit triggers) without sensitive payload/token data

#### Error Handling in Production

- Never expose stack traces or internal Supabase errors in responses
- Use generic error messages in production (`NODE_ENV === 'production'`)
- Log detailed errors server-side only

#### Discord Bot

- Always set `allowedMentions: { parse: [] }` to suppress @everyone/@here
- Validate announcement content length before sending (Discord limit: 2000 chars)
- Bot-to-API uses `X-Bot-Secret` header verified with `timingSafeEqual()`
- Remove fallback defaults for `BOT_API_SECRET` -- fail hard if missing

#### WebSocket Security (When Added)

Currently no WebSockets in use, but when added:
- Validate `Origin` header during handshake (prevent Cross-Site WebSocket Hijacking)
- Use `wss://` (TLS) for all socket traffic carrying sensitive data
- Authenticate during handshake AND validate authorization per message type
- Implement DoS controls: connection limits, per-user limits, message size limits
  (recommend 64KB max), rate limiting per connection, heartbeats, and backpressure
- Rotate tokens for long-lived connections
- Never use `eval()` to process message content -- use `JSON.parse()` only
- Log connect/disconnect, auth failures, validation failures without logging tokens

### 3. Open-Source Preparation

Follow the full checklist and scrub list in `references/open-source-checklist.md`.

Key steps:
1. Run `gitleaks detect` on full repo history
2. Scrub real URLs, project IDs, and hardcoded secrets from docs
3. Enable GitHub Secret Scanning + Push Protection + Dependabot
4. Verify SECURITY.md and LICENSE exist
5. Rotate ALL secrets after open-sourcing

### 4. Security Test Scenarios

Run test scenarios from `references/security-test-catalog.md` covering:
- **A1-A5**: Authentication and authorization (JWT, RLS, user isolation)
- **B1-B4**: BOLA / object-level authorization (cross-tenant data access)
- **D1-D5**: Discord bot abuse (brute-force, mentions, content length)
- **R1-R5**: API abuse (rate limiting, input size, access control)
- **E1-E3**: Data exposure (service keys, error messages, build artifacts)
- **L1-L3**: Logging and monitoring (log injection, sensitive data leakage)
- **S1-S3**: Supply chain (dependency audit, lockfile integrity, build reproducibility)
- **P1-P3**: AI chatbot prompt injection (future)
- **W1-W4**: WebSocket security (future -- when WebSockets are added)

### 5. Continuous Security Testing Loop

Don't rely solely on code review. Run repeatable automated checks:

| Layer | Tool | Frequency | Purpose |
|-------|------|-----------|---------|
| SAST | CodeQL (GitHub, non-blocking by design) | Every PR + weekly | Static code vulnerability detection with maintainer review at PR/deploy time |
| SCA | Dependabot + `pnpm audit` | Every PR + weekly alerts | Known dependency vulnerabilities |
| DAST | OWASP ZAP baseline scan | Monthly or pre-release | Dynamic runtime vulnerability scanning |
| Supply chain | OpenSSF Scorecard | Weekly in CI | Repo security posture drift detection |
| Secrets | gitleaks + GitHub secret scanning | Every push | Credential leakage prevention |
| RLS regression | Custom test suite | Every PR with DB changes | Cross-tenant access prevention |
| Drift visibility | Weekly security drift workflow (`audit-level=moderate` + outdated snapshot) | Weekly | Non-blocking visibility into medium-severity dependency drift |

CodeQL policy note:
- `continue-on-error: true` is intentional for this repository.
- Maintainers are expected to review CodeQL results during PR/deployment checks.
- Weekly drift reporting complements this non-blocking posture.

OWASP ZAP can run as a GitHub Action for automated baseline scans.
For WebSocket testing when added: use ZAP's WebSocket tab to intercept/replay/fuzz.

Consider adopting OWASP SAMM as a maturity model to structure ongoing security improvement
across governance, design, implementation, verification, and operations.

### 5.1 Local Security Gate (Automation)

Before security reports or public-sync decisions, run the repo automation gate:

- Command: `pnpm security:check`
- Fast pre-commit variant: `pnpm security:check:fast`
- Pre-merge helper (runs local gate subset + fetches latest branch CodeQL run when `gh` CLI is available): `pnpm security:premerge`
- Script location: `scripts/security-check.ps1`

The gate verifies governance files, CI workflow directory presence, dependency audit,
test gate, and gitleaks availability/scanning. This reduces ad hoc checks and makes
security posture reports repeatable.

#### Gitleaks scanning modes

Gitleaks has three modes. Use them in sequence for a complete picture:

| Mode | Command | When |
|------|---------|------|
| Full history (`git`) | `gitleaks detect --source . --verbose` | One-time audit; pre-release |
| PR delta only | `gitleaks detect --source . --log-opts "origin/main..HEAD"` | CI on every PR |
| Working tree (`dir`) | `gitleaks detect --source . --no-git` | Pre-commit spot check |

#### Gitleaks baseline workflow

After first installation:
1. Run `gitleaks detect --report-path .gitleaks-baseline.json`
2. Review findings. Rotate any real secrets. Add false-positive rules to `.gitleaks.toml`.
3. Commit `.gitleaks-baseline.json` and `.gitleaks.toml`.
4. All subsequent runs add `--baseline-path .gitleaks-baseline.json` to suppress known findings.
5. Regenerate the baseline at each public-sync milestone.

#### Gitleaks CI integration note

Use the CLI directly inside a `run:` step rather than the official `gitleaks/gitleaks-action`.
The official Action requires a `GITLEAKS_LICENSE` for organization-owned repositories.
The CLI is MIT-licensed with no such requirement.

Full rationale, trust model, and recommended commands are in
`references/gitleaks-rationale.md`.

### 6. Secrets Lifecycle Management

Treat all secrets as having a lifecycle (creation, rotation, revocation):

| Secret | Rotation Schedule | Notes |
|--------|-------------------|-------|
| SUPABASE_SERVICE_ROLE_KEY | Quarterly | Regenerate in Supabase dashboard |
| JWT_SECRET | Quarterly | Invalidates all active sessions |
| DISCORD_BOT_TOKEN | On suspicion + annually | Reset in Discord Developer Portal |
| BOT_API_SECRET | Quarterly | Coordinate bot + API deployment |
| SMTP credentials | Annually | Update in email provider |
| AI API keys | Annually or on suspicion | Regenerate in provider dashboard |

- Use platform features: Vercel sensitive env vars (unreadable), Railway sealed variables
- Environment isolation: never share secrets across prod/preview/dev
- Rotation procedure: deploy new secret -> verify -> revoke old secret
- Log rotation events in team security channel

### 7. Ongoing Security Habits

- Check Supabase auth logs weekly for unusual patterns
- Monitor `auth.audit_log_entries` for anomalies
- Watch Vercel/Railway dashboards for traffic or resource spikes
- Discord Developer Portal: monitor guild count changes
- Follow secret rotation schedule above
- Review Dependabot alerts weekly
- Run OpenSSF Scorecard weekly

## Key Files

> Paths are relative to the Coordination Manager monorepo root.

| File | Purpose |
|------|---------|
| `.github/workflows/security-drift-weekly.yml` | Weekly medium-severity drift report + artifact capture |
| `.github/workflows/codeql.yml` | CodeQL configuration with explicit non-blocking policy |
| `scripts/security-premerge.ps1` | Local pre-merge security helper with CodeQL status lookup |
| `scripts/weekly-security-drift-summary.mjs` | Weekly drift summary generation for CI job output |
| `Code/apps/api/src/middleware/validation.ts` | sanitizeString(), sanitizeUUID() |
| `Code/apps/api/src/middleware/rate-limiter.ts` | Rate limiting configuration |
| `Code/apps/api/src/middleware/auth.ts` | requireAuth, optionalAuth middleware |
| `Code/apps/web/vercel.json` | Frontend security headers |
| `.claude/rules/security.md` | Security rules for AI agents |
| `SECURITY.md` | Responsible disclosure instructions |
| `packages/database/migrations/*.sql` | RLS policy definitions |

## Outputs

| Artifact | Location |
|----------|----------|
| Platform settings audit | `references/platform-settings.md` (manual checklist) |
| Security test results | Logged in conversation or CI output |
| Open-source readiness report | `references/open-source-checklist.md` (checked items) |
| Code hardening changes | Committed to relevant source files |
| Secret rotation log | Documented in team security channel |

## Self-Validation

### Trigger Indicators
- User mentions "security", "hardening", "RLS", "rate limit", "open-source prep",
  "secret scanning", or "security test" in their request
- User asks to audit platform settings or check for leaked credentials
- User references a specific test scenario ID (A1-P3)

### Completion Markers
- All applicable workflow sections (1-5) addressed for the requested scope
- Platform dashboard items reviewed (manual confirmation noted)
- Code-level changes committed with security-related commit messages
- Test scenarios executed and results documented
- Open-source checklist items checked off (if applicable)

### Quality Signals
- No secrets or real credentials appear in any committed file
- RLS is confirmed enabled on all tables
- Rate limiting thresholds match the defined table
- Error responses in production return generic messages only
- `gitleaks detect` returns zero findings on repo history
- All referenced test scenario IDs (A1-P3) have pass/fail results
