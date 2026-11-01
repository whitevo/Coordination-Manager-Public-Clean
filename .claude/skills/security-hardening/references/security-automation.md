# Security Automation and Lifecycle

## Contents
- Continuous testing layers
- CodeQL policy
- Local security gate
- Gitleaks modes and baseline
- Secrets lifecycle
- Ongoing habits

## Continuous testing layers

| Layer | Tool | Frequency | Purpose |
|-------|------|-----------|---------|
| SAST | CodeQL (GitHub, non-blocking by design) | Every PR + weekly | Static code vulnerability detection with maintainer review at PR/deploy time |
| SCA | OSV audit in CI (`ci.yml`, every PR and push), dependency-review (PR only, non-blocking), weekly `pnpm audit` drift report | Every PR + weekly | Known dependency vulnerabilities |
| DAST | OWASP ZAP baseline scan (not set up; no workflow in repo) | Monthly or pre-release | Dynamic runtime vulnerability scanning |
| Supply chain | OpenSSF Scorecard (manual; no workflow in repo) | Weekly | Repo security posture drift detection |
| Secrets | gitleaks + GitHub secret scanning | Every push | Credential leakage prevention |
| RLS regression | Manual SQL tests in `Code/packages/database/tests`; run by hand for every PR with DB changes (no CI DB job) | Every PR with DB changes | Cross-tenant access prevention |
| Drift visibility | Weekly security drift workflow (`audit-level=moderate` + outdated snapshot) | Weekly | Non-blocking visibility into medium-severity dependency drift |

OWASP SAMM can be adopted as a maturity model (governance, design, implementation,
verification, operations).

## CodeQL policy

- `continue-on-error: true` is intentional for this repository.
- Maintainers review CodeQL results during PR/deployment checks.
- Weekly drift reporting complements this non-blocking posture.

## Local security gate

- `pnpm security:check` (script `scripts/security-check.ps1`)
- `pnpm security:check:fast` - fast pre-commit variant
- `pnpm security:premerge` - local gate subset plus latest branch CodeQL run when `gh` CLI is available

The gate verifies governance files, CI workflow directory presence, dependency audit,
test gate, and gitleaks availability/scanning.

## Gitleaks modes and baseline

| Mode | Command | When |
|------|---------|------|
| Full history (`git`) | `gitleaks detect --source . --verbose` | One-time audit; pre-release |
| PR delta only | `gitleaks detect --source . --log-opts "origin/main..HEAD"` | CI on every PR |

CI (`gitleaks.yml`): PR scans base..head, push scans before..sha, weekly cron plus
`workflow_dispatch` scan full history; all with `--config .gitleaks.toml --redact`.
| Working tree (`dir`) | `gitleaks detect --source . --no-git` | Pre-commit spot check |

Baseline, after first installation:
1. Run `gitleaks detect --report-path .gitleaks-baseline.json`
2. Review findings. Rotate any real secrets. Add false-positive rules to `.gitleaks.toml`.
3. Commit `.gitleaks-baseline.json` and `.gitleaks.toml`.
4. Baseline is optional and currently absent; `security-check.ps1` adds
   `--baseline-path .gitleaks-baseline.json` only if the file exists. CI relies on delta scans
   plus the `.gitleaks.toml` allowlist, not a baseline.
5. Regenerate the baseline at each public-sync milestone.

CI: use the CLI in a `run:` step, not `gitleaks/gitleaks-action` (it needs a
`GITLEAKS_LICENSE` for organization-owned repos; the CLI is MIT with no such need).
Full rationale is in the gitleaks reference listed in SKILL.md.

## Secrets lifecycle

The source is `docs/private/security-key-rotation-runbook.md`. It sets triggers (suspected
compromise or exposure, access changes, provider advice, cryptoperiod expiry, planned
exercises), not a fixed calendar interval. Set any routine cadence per risk and record it.

| Secret | Rotation impact (runbook) |
|--------|---------------------------|
| SUPABASE_SECRET_KEY_LOCALHOST / SUPABASE_SECRET_KEY_PRODUCTION | Rotate in Supabase dashboard, then update the matching environment in every API/bot service; legacy fallback is unsupported |
| JWT_SECRET | Signs OAuth state and wallet credentials; invalidates in-flight OAuth flows. Rotate in a low-traffic window |
| DISCORD_BOT_TOKEN | Regenerate in Discord Developer Portal, then update Railway env |
| GOOGLE_CLIENT_SECRET | Regenerate in Google Cloud Console; existing OAuth tokens stay valid |
| BOT_API_SECRET | Shared by API and bot; update both at once |
| SMTP_ENCRYPTION_KEY | AES-256-GCM, 64 hex chars; needs a re-encryption migration (runbook procedure) |

- Use Vercel sensitive env vars (unreadable) and Railway sealed variables
- Never share secrets across prod/preview/dev
- Procedure: deploy new secret -> verify -> revoke old secret
- Log rotation events in team security channel

## Ongoing habits

- Check Supabase auth logs weekly; monitor `auth.audit_log_entries` for anomalies
- Watch Vercel/Railway dashboards for traffic or resource spikes
- Discord Developer Portal: monitor guild count changes
- Review Dependabot alerts and OpenSSF Scorecard weekly
