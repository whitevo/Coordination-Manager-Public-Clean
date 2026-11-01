# Security Policy

## Reporting a Vulnerability

Security vulnerabilities should be reported privately to security@coordinationmanager.com

For reporting steps, required details, response targets, safe-harbor rules, and related security guidance, see the [Vulnerability Reporting Guide](/docs/guides/security/vulnerability-reporting).

## Supported Service

Coordination Manager is primarily a hosted web application. The hosted service receives security updates continuously. Only the currently deployed production version is supported.

## Security Practices

- Endpoints handling authenticated user data require verified Supabase authentication and object-level authorization through [authentication middleware](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/Code/apps/api/src/middleware/auth.ts#L114-L174).
- Application admin endpoints require Supabase MFA assurance level [`aal2`](https://supabase.com/docs/guides/auth/auth-mfa).
- User-scoped database data is protected with [PostgreSQL Row Level Security policies](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/Code/packages/database/migrations/000_full_schema.sql#L66-L77).
- Public-facing and abuse-prone API routes use [risk-appropriate rate limiting](/docs/limits).
- API error responses use [sanitized error-message helpers](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/Code/apps/api/src/middleware/validation.ts) to reduce information leakage.
- Browser authentication sessions are scoped and cleared on logout as documented in the [Session Handling Guide](/docs/guides/security/session-handling).
- Discord bot messages suppress mention parsing through the [Discord message configuration](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/Code/apps/discord-bot/src/index.ts#L858-L858).
- Internal service communication uses authenticated service boundaries described in the [API authentication middleware](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/Code/apps/api/src/middleware/auth.ts).
- Production security headers are configured and explained in the [Security Headers Guide](/docs/guides/security/security-headers).
- Security event handling and safe reporting procedures are described in the [Vulnerability Reporting Guide](/docs/guides/security/vulnerability-reporting).
- Dependency scanning, secret scanning, and release checks are maintained in the [Security Tooling Guide](/docs/guides/security/security-tooling).
- Sensitive mailbox credentials are encrypted before storage as described in the [Mailbox Credential Encryption Guide](/docs/guides/security/mailbox-credential-encryption).

## Third-Party Services

Coordination Manager relies on third-party infrastructure and identity, mailbox, communication, and deployment providers. Coordination Manager is responsible for securely configuring and integrating those services, protecting credentials issued to the application, and responding to security events affecting those integrations. Security of the providers' underlying infrastructure remains the responsibility of those providers.

## Security Control Guides

This section uses the security-assessment intent of [Google's restricted-scope
requirements](https://support.google.com/cloud/answer/13464321) and the
[CASA specification](https://github.com/appdefensealliance/ASA-WG/blob/main/CASA/CASA%20Specification.md)
as practical references for organizing and improving application security controls.
References to Supabase [`aal2`](https://supabase.com/docs/guides/auth/auth-mfa)
mean Supabase's MFA assurance level and are unrelated to CASA assessment levels,
including CASA's [AL2 definition](https://github.com/appdefensealliance/ASA-WG/blob/main/CASA/CASA%20Specification.md#definitions).
This section describes how Coordination Manager implements, documents, and reviews security controls. It is not a CASA report, certification, or independent validation. Coordination Manager has not completed a CASA or equivalent independent security assessment.

The implementation map separates references customers can inspect from records
that must stay private. Private records can be shared with an authorized
assessor or customer under an appropriate agreement, but they must not contain
credentials, personal data, raw production logs, or exploitable infrastructure
details.

### Implementation Map

Last reviewed: 23 Sep 2026.

Status vocabulary:

- **Implemented -- Public reference:** The control is implemented and has a public guide, code reference, or documentation reference.
- **Implemented -- Private record:** The control is implemented, but raw supporting records should remain private.
- **Documented control:** The control is documented as architecture, policy, or risk-management guidance.
- **Planned / not yet implemented:** Work is planned or in progress and should not be treated as implemented.

| Security area | Control or implementation outcome | Reference | Status |
|---|---|---|---|
| Authentication and authorization | Endpoints handling authenticated user data derive identity from verified Supabase JWTs. | [Authentication middleware `authMiddleware()`](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/Code/apps/api/src/middleware/auth.ts#L114-L174) | Implemented |
| Authentication and authorization | Admin surfaces require Supabase MFA assurance level [`aal2`](https://supabase.com/docs/guides/auth/auth-mfa). CASA separately defines [AL2](https://github.com/appdefensealliance/ASA-WG/blob/main/CASA/CASA%20Specification.md#definitions); this policy uses Supabase `aal2` as the implemented MFA gate. | [MFA assurance helper](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/Code/apps/api/src/middleware/auth.ts#L35-L38), [admin route guard](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/Code/apps/api/src/routes/admin.ts#L13-L27), and [authentication documentation](/docs/authentication) | Implemented |
| Authentication and authorization | Browser sessions are scoped and cleared on logout. | [Session handling guide](/docs/guides/security/session-handling) and [implementation reference](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/Code/apps/web/src/lib/auth-service.ts) | Implemented -- Public reference |
| OAuth security | OAuth state is signed, redirect URIs are explicit, and provider-managed authorization code flow is used. | [OAuth security guide](/docs/guides/security/oauth-security) and [implementation reference](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/Code/apps/api/src/services/mailbox-oauth.ts) | Implemented -- Public reference |
| OAuth security | Production OAuth client configuration and exact registered redirect URIs are retained for assessment review. | No public reference. This is retained as a private assessor record because a public summary cannot prove the live provider configuration matches it. | Implemented -- Private record |
| Data authorization | User/account-scoped data tables use [Supabase/Postgres Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) where database-level ownership enforcement applies. | [RLS enablement and user ownership policies](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/Code/packages/database/migrations/000_full_schema.sql#L66-L77) | Implemented |
| Input and API protection | API input is sanitized and public-facing or abuse-prone endpoints use rate limiting. | [Mailbox route input sanitization](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/Code/apps/api/src/routes/mailbox.ts#L1697-L1705), [mailbox UUID checks](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/Code/apps/api/src/routes/mailbox.ts#L1810-L1817), and [rate limiter registration](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/Code/apps/api/src/index.ts#L136-L136) | Implemented |
| Data protection | Mailbox OAuth credentials are encrypted before storage. | [Mailbox credential encryption guide](/docs/guides/security/mailbox-credential-encryption) and [implementation reference](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/Code/apps/api/src/services/mailbox-credentials.ts) | Implemented -- Public reference |
| Data protection | Production secrets are stored in deployment-provider secret stores and are not committed to source control. | No public reference. Raw secret-store screenshots, exports, and resource identifiers must remain private. | Implemented -- Private record |
| Secure operations | Security checks cover dependency risk, secret scanning, tests, and repository governance. | [`pnpm security:check` script](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/package.json#L24-L26) and [CI quality gate](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/.github/workflows/ci.yml#L1-L53) | Implemented |
| Secure operations | Sanitized authentication and failure-event samples are retained without tokens, cookies, or authorization headers. | No public reference. Real production logs can contain personal data and security-sensitive metadata; synthetic examples would not prove production logging behavior. | Implemented -- Private record |
| Application security | Production responses include security headers such as CSP and frame protections where applicable. | [Production security headers guide](/docs/guides/security/security-headers) and [Helmet security-header configuration](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/Code/apps/api/src/index.ts#L102-L119) | Implemented -- Public reference |
| Network security | Production certificates support modern TLS and production DNS records are controlled and reviewed. | No public reference. Customers can independently inspect public TLS details, but DNS ownership, provider exports, and internal review records are operational records that should remain private. | Implemented -- Private record |
| Mailbox data handling | Mailbox synchronization, local projection, provider actions, and data-security boundaries are documented. | [Mailbox Architecture and API Guide](/docs/guides/mailbox-architecture) | Documented control |
| Risk and accountability | Known limitations, risk decisions, and the vulnerability-reporting process are documented. | [Risk and Ethics](/docs/section/risk), [Security Policy](/docs/legal/security-policy), and [Vulnerability Reporting Guide](/docs/guides/security/vulnerability-reporting) | Documented control |

These controls and references describe security measures and available implementation detail; they do not constitute a guarantee that vulnerabilities cannot exist.

## Security Testing

Security testing includes both public repository checks and private tests where publishing the implementation would expose sensitive attack or infrastructure details. Expected coverage includes:

- Authentication and authorization boundaries
- Tenant isolation and object-level data access
- Abuse and rate-limiting protections
- Sensitive-data exposure regressions
- OAuth and account-linking flows
- Privileged/admin operations and MFA requirements
- Regression tests for previously discovered vulnerabilities

Significant vulnerabilities are reviewed for root causes and, where practical, result in regression tests or improvements to related development controls.

If you're contributing and need access to security tests, contact the maintainers through a private channel.

## Software Supply Chain

This project uses dependency vulnerability checks, secret scanning, CI quality gates, and security-focused scripts to reduce supply-chain risk. The public `security:check` entrypoint is intended to collect the standard local security checks for maintainers before release or public sync. Operational tooling instructions are maintained in the [Security Tooling Guide](/docs/guides/security/security-tooling).

### Dependency Override Review

Reviewed on 2026-10-02 against npm release metadata and OSV advisory ranges:

- Axios 1.20.0 replaces vulnerable direct and transitive versions below 1.20.0.
- Nodemailer 10.0.13 replaces versions affected by address-parser denial of service.
- brace-expansion 5.0.12 updates the existing overrides for nested-brace denial of service.
- Undici 8.11.2 patches the existing 8.x override. Discord retains patched 6.28.1 for compatibility with its expected major version.

These overrides are maintained in `Code/package.json` with resolved versions in `Code/pnpm-lock.yaml`. Recheck advisories and compatibility when updating them; a passing audit is a point-in-time check, not a security guarantee.

Additional overrides reviewed on 2026-10-07 against GitHub advisory patched-version ranges:

- proxy-addr 2.0.8 replaces versions below 2.0.8 to address IPv4-mapped IPv6 trust-subnet IP spoofing (GHSA-jqcg-44mw-7w3h).
- shell-quote 1.11.0 replaces the existing 1.9.0 pin to address command injection when quoting line terminators after comment tokens (GHSA-pqg4-j6r4-53mv).
- source-map-js 1.2.2 replaces affected 1.x versions below 1.2.2 to address event-loop denial of service through indexed source-map section offsets (GHSA-68fv-2mgg-jv7q).

Review these pins when upstream consumers adopt patched versions. They preserve the affected packages' major versions and do not suppress advisory checks.

## Secret and Key Management

Production credentials are stored using deployment-provider secret management and are rotated according to risk. Public documentation intentionally does not list exact secret names, deployment locations, or operator procedures.

Rotation triggers include confirmed or suspected compromise, accidental exposure, personnel or access changes where relevant, provider recommendations, cryptoperiod expiration, operational risk events, and planned rotation exercises. Detailed key inventory and rotation steps are maintained in a private key-rotation runbook.

## Secret Scanning

This project uses [Gitleaks](https://github.com/gitleaks/gitleaks) for secret detection.

- Local and pre-release checks can scan repository history for previously committed secrets.
- CI performs secret scanning appropriate to the checked-out commit or configured workflow range.
- Pre-release review includes full-history scanning before public milestone sync.

Tool installation and local command details are documented in the [Security Tooling Guide](/docs/guides/security/security-tooling).
