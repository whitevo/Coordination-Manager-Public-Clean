# CI and CodeQL workflow examples

## Contents
- CI workflow (.github/workflows/ci.yml)
- CodeQL workflow (.github/workflows/codeql.yml)
- Fork workflow security
- OpenSSF Scorecard

## CI workflow (.github/workflows/ci.yml)

```yaml
name: CI
on:
  pull_request: { branches: [main] }
  push: { branches: [main] }

# Default to minimal permissions -- escalate only per-job
permissions:
  contents: read

jobs:
  quality-gate:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: Code
    steps:
      # Pin actions to immutable commit SHAs (not mutable tags); copy current SHAs from the live ci.yml.
      # Live pins: checkout v5.0.1, pnpm/action-setup v4.4.0, setup-node v5.0.0 (no version comments in the file)
      - uses: actions/checkout@<sha>
      - uses: pnpm/action-setup@<sha>
        with: { version: 12.15.0 }
      - uses: actions/setup-node@<sha>
        with: { node-version: 26, cache: pnpm, cache-dependency-path: Code/pnpm-lock.yaml }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pwsh -NoProfile -File ../scripts/security-check.ps1 -SkipMonorepoTests -SkipGitleaks
      - run: pnpm --filter @coordination-manager/web --filter @coordination-manager/docs build
      # then Playwright chromium install + e2e/tailwind-compatibility.spec.ts
```

The live `ci.yml` also sets a `concurrency` group with cancel-in-progress. Read it for exact SHAs and steps.

- Pins in the live workflows have no version comments; add one when you update a pin. Pin policy: supply-chain-security.
- Escalate permissions per-job only (e.g. `security-events: write` for CodeQL).
- The audit step is the OSV-based `scripts/security-check.ps1` (high/critical), not `pnpm audit`.
- Cache pnpm store via `cache-dependency-path: Code/pnpm-lock.yaml`.
- All commands run with `working-directory: Code` (not repo root).

## CodeQL workflow (.github/workflows/codeql.yml)

```yaml
name: CodeQL Analysis
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
  schedule:
    - cron: '23 3 * * 1'  # Weekly Monday
permissions:
  contents: read
  security-events: write
  actions: read
jobs:
  analyze:
    runs-on: ubuntu-latest
    if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository
    steps:
      - uses: actions/checkout@SHA
      - uses: github/codeql-action/init@SHA
        with: { languages: javascript-typescript }
      # live file then sets up pnpm 12 + Node 26, runs `pnpm install --frozen-lockfile`
      # and `pnpm -r --if-present run build` (working-directory: Code)
      - uses: github/codeql-action/analyze@SHA
        continue-on-error: true   # non-blocking by design; do not remove
```

The live file also has an `if: always()` info step: code scanning upload needs GitHub Advanced Security, which this personal account lacks. CodeQL policy: security-hardening.

Detects XSS, injection, path traversal, hardcoded credentials, prototype pollution.

## Fork workflow security

- Use `pull_request` trigger for untrusted fork PRs (no secret access -- safe).
- NEVER use `pull_request_target` with `actions/checkout` of fork code + secret access.
- If secrets are needed for fork validation, use two workflows:
  1. `pull_request` runs tests without secrets
  2. `workflow_run` runs trusted checks after the PR workflow completes
- Never expose secrets in PR logs or artifact uploads.

## OpenSSF Scorecard (optional, GitHub Action)

- Audits branch protection, token permissions, dependency hygiene, vulnerability
  disclosure, signed releases, code review requirements.
- Run weekly in CI to detect security posture drift; results can be a README badge.
