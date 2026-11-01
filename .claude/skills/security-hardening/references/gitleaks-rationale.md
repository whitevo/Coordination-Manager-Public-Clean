# Gitleaks -- Tool Rationale

## Contents
- What it is
- What it adds over homegrown checks
- Scanning modes
- Baseline workflow
- CI integration approach
- Where this fits the project
- Where it is used
- Installation (Windows)
- Trust model
- References

## What it is

Gitleaks is a SAST tool for detecting hardcoded secrets (passwords, API keys, tokens,
private keys, HTTP auth headers, bearer tokens) in Git repositories and local directories.
It is open source (MIT), maintained by Gitleaks LLC / Zachary Rice, and distributed via
official GitHub releases and the winget package `Gitleaks.Gitleaks`.

Pinned version: see `VERSION=` in `.github/workflows/gitleaks.yml` (do not hardcode it here).

## What it adds over homegrown checks

The most important thing Gitleaks adds over many homegrown checks is **history awareness**.
It has three scanning modes -- `git`, `dir`, and `stdin` -- and the `git` mode explicitly
uses `git log -p`. That lets you do a one-time full-history scan, limit scans to a commit
range, or scan the repo as part of CI in a way that is grounded in actual git deltas rather
than only the files sitting in the current working tree.

Operationally, Gitleaks is more than a grep script. Its built-in workflow supports:

- Creating a **baseline** and ignoring already-known historical findings on future runs.
- A rule model that supports custom configs, extension of default rules, keyword prefilters,
  entropy thresholds, and global or rule-specific allowlists.
- **Secret redaction in logs** and structured report output (JSON) that other tooling can consume.

That matters because once a repo has even a small amount of legacy noise, the long-term
success of secret scanning depends less on raw detection and more on whether the team can
keep the signal-to-noise ratio manageable.

## Scanning modes

| Mode | How it works | When to use |
|------|-------------|-------------|
| `git` | Walks `git log -p`; sees the full commit history | CI + one-time full-history audit |
| `dir` | Scans files in the current working tree | Pre-release working-tree check |
| `stdin` | Reads from standard input | Pipe integration |

**Recommended command for this repo:**

```bash
# Full history scan (run once per release and after any suspected exposure)
gitleaks detect --source . --verbose

# CI: only new commits in a PR (faster; avoids re-scanning all of history)
gitleaks detect --source . --log-opts "origin/main..HEAD" --verbose

# Generate baseline file (run once, commit .gitleaks-baseline.json)
gitleaks detect --source . --report-path .gitleaks-baseline.json

# Subsequent runs: ignore findings already in the baseline
gitleaks detect --source . --baseline-path .gitleaks-baseline.json --verbose
```

## Baseline workflow

1. Run `gitleaks detect --report-path .gitleaks-baseline.json` on the current repo state.
2. Review the output. Rotate any real secrets found. Document known false positives.
3. Commit `.gitleaks-baseline.json` to the repo.
4. Add a `.gitleaks.toml` config with allowlist rules for confirmed non-secrets.
5. Baseline is optional and currently absent: CI does not pass `--baseline-path`; only
   `scripts/security-check.ps1` uses it, and only if `.gitleaks-baseline.json` exists.
6. Rotate the baseline (regenerate) at each public release milestone.

## CI integration approach

The `discord-client-id` rule has a narrow exception for the two synthetic Discord
user IDs in `Code/packages/database/tests/guardian-ban-time-check.sql`. Both the
exact test-file path and one of the two exact fixture values must match. Other
values, files, and secret-detection rules remain active. This configuration also
applies to historical commits; changing only the fixture would not clear a
PR-delta scan of the original commit.

The Gitleaks CLI is MIT-licensed and can be invoked inside any standard GitHub Actions job
(e.g. `run: gitleaks detect ...` after installing the binary). This is the approach used
in `gitleaks.yml` for this project.

The official Gitleaks GitHub Action (`gitleaks/gitleaks-action`) requires a
`GITLEAKS_LICENSE` for organization-owned repositories. To avoid this dependency, the
workflow uses the CLI directly in a standard `run:` step rather than the Action. This is
explicitly the pattern their documentation recommends for org repos that do not have a
license.

## Where this fits the project

Gitleaks is a good fit for Coordination Manager because:

- The repo touches many secret namespaces: Supabase keys, JWT secrets, Discord tokens,
  SMTP credentials, Google OAuth secrets, bot shared secrets, AI API keys.
- The curated private-to-public sync pipeline requires high confidence that no secrets
  appear anywhere in history before publishing. A git-history-aware scan is essential.
- The MIT license is compatible with our open-source goals.
- It is easy to understand: non-ML, rule-based, inspectable, and self-hostable.

## Where it is used

| Location | Purpose |
|----------|---------|
| `scripts/security-check.ps1` | Local developer gate; invoked by `pnpm security:check` |
| `.github/workflows/gitleaks.yml` | PR and push delta scans plus weekly full-history scan (CLI 8.30.1, SHA256-verified) |
| Pre-release checklist | One-time full-history scan before public milestone sync |

## Installation (Windows)

```powershell
# Via winget (recommended -- verifies SHA256 against published GitHub release checksum)
winget install --id Gitleaks.Gitleaks --exact --accept-source-agreements

# Or run the security gate script with -InstallGitleaks flag
pnpm security:check -InstallGitleaks
```

## Trust model

| Factor | Detail |
|--------|--------|
| Publisher | Gitleaks LLC / Zachary Rice |
| Homepage | https://github.com/gitleaks/gitleaks |
| License | MIT |
| Distribution | GitHub Releases; winget package with published SHA256 |
| Maintenance | Actively maintained; tagged releases; community contributions |
| Verification | Always install via winget (SHA256 checked) or verify the binary checksum against the published GitHub release before first use |

## References

- https://github.com/gitleaks/gitleaks
- https://gitleaks.io/
- https://github.com/gitleaks/gitleaks/blob/master/README.md
