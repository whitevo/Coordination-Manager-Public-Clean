---
name: github-workflow
description: Defines the Coordination Manager GitHub workflow - feature/fix/chore branching, conventional commits, branch protection, repo security settings, .gitignore, GitHub Actions CI and CodeQL with SHA-pinned actions, and Vercel/Railway auto-deploy from main. Use when creating a branch, writing a commit message, opening or reviewing a PR, setting up CI or branch protection, or configuring repo security. Not for dependency policy, audit gates or SBOMs (use supply-chain-security), secret rotation or gitleaks policy (use security-hardening), or Vercel/Railway config (use deployment).
---

# github-workflow

Publishing a public snapshot or adding a private-only file pattern is a different task - use `open-source-pipeline`. Never force push to `main`.

## Workflow

1. **Branch from main** (all changes to main go through PRs; squash or merge commit):
   - Names: `feature/*` or `feat/*` (CONTRIBUTING.md uses `feat/`; e.g. feature/calendar-recurrence), `fix/*` (e.g. fix/wallet-auth-redirect), `chore/*` (e.g. chore/update-deps)
   - `git checkout -b feature/my-feature`, then `git push -u origin feature/my-feature` and open a PR

2. **Commit with conventional messages**: `feat`, `fix`, `chore`, `docs`, `refactor`, `test` (a habit, not enforced: no commitlint or husky config exists).
   - Optional scope: `feat(calendar): add time zone support`
   - Subject under 72 characters, imperative mood

3. **Know the deploy side effects**:
   - Push to `main` triggers Vercel production deploy + Railway auto-deploy (API + guardian)
   - PRs get Vercel preview deployments
   - Broken main = broken production, immediately

4. **Repo settings**:
   - Settings > Code Security: enable Secret Scanning, Push Protection, Dependabot Alerts, Dependabot Security Updates, CodeQL Code Scanning (PRs + weekly), Private Vulnerability Reporting
   - Branch protection on `main`: require PR reviews, require status checks (when CI configured), no force pushes, no deletions

5. **Maintain .gitignore** (both repo root and `Code/` have one). Essentials:
   - `node_modules/`, `pnpm-debug.log*`, `dist/`, `build/`, `*.tsbuildinfo`
   - `.env`, `.env.local`, `.env.*.local`
   - `.vscode/mcp.json` (contains API tokens)
   - `.claude/settings.local.json` is intentionally not ignored (personal permission settings; each developer decides)
   - `.DS_Store`, `Thumbs.db`, `*.tmp`, `.cache`

6. **CI** lives in `.github/workflows/` (`ci.yml`, `codeql.yml`; also `dependency-review.yml`, `gitleaks.yml`, `security-drift-weekly.yml`).
   - `ci.yml` job `quality-gate` runs with `working-directory: Code` (not repo root): `pnpm install --frozen-lockfile`, typecheck, lint, test, the OSV audit script (`../scripts/security-check.ps1`), web+docs build, Playwright CSS check. Triggers: push and PR on `main`
   - Workflow default is `permissions: contents: read`; escalate per-job only
   - Pin every action to a commit SHA (policy: supply-chain-security); current pins are in the workflow files
   - `codeql.yml` is non-blocking by design (`continue-on-error`; no GHAS upload on this account); `dependency-review.yml` is advisory and repo-name gated; `gitleaks.yml` scans PR/push diffs plus weekly full history. Policy for these: security-hardening
   - Dependabot and branch protection are dashboard settings (no dependabot.yml or CODEOWNERS in the repo)
   - Full YAML, CodeQL, fork-PR rules, Scorecard: see references/ci-workflows.md

7. **Before merging, run the PR review checklist**:
   - [ ] No secrets or .env values in diff
   - [ ] All new env vars added to .env.example
   - [ ] No `any` types added
   - [ ] New API endpoints have rate limiting and input validation
   - [ ] Database changes include migration + 000_full_schema.sql update
   - [ ] ASCII-safe text in all UI strings

8. **Security habits**: weekly review cadence and rotation live in `security-hardening`; audit repo access monthly and review every PR diff for hardcoded secrets.

## Gotchas

- Never use `pull_request_target` with a checkout of fork code plus secrets (rules in references/ci-workflows.md).
- Public repo (`whitevo/Coordination-Manager-Public-Clean`) is a curated snapshot of private `main`, not a mirror.

## References

- references/ci-workflows.md - read when writing or editing CI/CodeQL workflows, fork-PR handling, or Scorecard.
