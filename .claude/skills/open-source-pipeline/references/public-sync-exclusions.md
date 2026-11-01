# Public Sync Exclusions

## Contents
- Categories (1-6)
- What to preserve from public/main
- Safety checks before pushing the sync branch
- Updating this list

Authoritative list of files and patterns that MUST be excluded when
syncing the private repo (`whitevo/Coordination-Manager`) to the public
repo (`whitevo/Coordination-Manager-Public-Clean`).

Implemented by `$publicSyncExclusionPatterns` in
`scripts/release-open-source-loop.ps1` and the public-sync workflow in `SKILL.md`.
The release loop is a publication command, not a local validator:
even `pnpm release:loop:prep` installs dependencies, commits working changes,
pushes private/public branches, and opens a public PR. Never run it for local-only
hygiene or on a shared dirty worktree.

## Categories

### 1. Secrets and credentials (CRITICAL -- never sync)

| Pattern | Reason |
|---------|--------|
| `.env`, `.env.*` (except `.env.example`) | Keep real/local/prod env files private while allowing public templates |
| `.vscode/mcp.json` | Contains MCP server API tokens (Improvmx, Miro, etc.) |
| `.claude/settings.local.json` | Personal Claude config |
| `**/*.pem`, `**/*.key` | Cryptographic keys |
| `**/serviceAccount*.json` | Cloud service account credentials |

### 2. Internal scratch and ad-hoc scripts

| Pattern | Reason |
|---------|--------|
| `_test.js`, `_test_wrap.txt` | Local scratch files at repo root |
| `_sync-report-*.md` (repo root) | Local publication audit reports |
| `Code/apps/api/_*.cjs` | One-off DB query / export scripts (e.g. `_export_ratings.cjs`, `_query_recent.cjs`) |
| `Code/apps/api/_*.js` | Same convention |

The leading underscore is the project convention for "do not ship".

### 3. Internal documentation

| Pattern | Reason |
|---------|--------|
| `**/CHANGELOG_*.md` (including repo root) | Date-bound internal changelogs (release notes belong in PR descriptions or GitHub Releases) |
| `docs/private/**` | Private working documents, temp guides, and scratch notes |
| `**/*-REVIEW.md` | Generic pattern for review docs |
| `**/*-INTERNAL.md` | Explicit internal marker |

### 4. Personal / workspace config

| Pattern | Reason |
|---------|--------|
| `workspace.code-workspace` | Personal VS Code workspace |
| `.vscode/` (entire folder) | Personal editor settings |
| `.idea/` | JetBrains config |
| `tools/improvmx-mcp/` | Personal MCP tooling, not part of product |
| `tools/test-runner-mcp/` | Personal MCP test tooling, not part of product |
| `.mcp.json` | Registers the excluded `tools/test-runner-mcp`; would dangle publicly |

### 5. Project-internal assets

| Pattern | Reason |
|---------|--------|
| `Code/apps/web/playwright-report/**` | Generated browser test reports |
| `Code/apps/web/test-results/**` | Generated browser test state and artifacts |

### 6. Memory and session state

| Pattern | Reason |
|---------|--------|
| `/memories/**` (repo root) | Per-user memory, usually not tracked but listed for safety |
| `.claude/session/**` | Session notes |

## What to preserve from public/main

As of 2026-06-07 the open-source governance files live in the private
repo and sync forward to public. Nothing needs to be restored from
`public/main` by default.

If at any point a file diverges (e.g. a hot-fix lands on public
directly), list it here and arrange a reviewed preservation step before
publication. The release script does not restore divergences automatically:

| File | Reason |
|------|--------|
| (none currently) | -- |

### Shipped publicly by decision (not excluded)

`.claude/settings.json`, `.claude/skills/**`, `.claude/rules/**` and `CLAUDE.md`
are currently shipped on purpose; the
regression script lists `.claude/settings.json` and the open-source-pipeline skill
files as preserved paths.

### Public OSS files now sourced from private repo

These files are authored and maintained in the private repo and ship
publicly via normal sync:

- `LICENSE` -- MIT
- `NOTICE` -- copyright, licence, trademark, third-party attribution
- `TRADEMARKS.md` -- trademark policy (adapted from Model Trademark Guidelines)
- `CONTRIBUTING.md` -- contribution workflow
- `CLA.md` -- Contributor License Agreement text
- `CODE_OF_CONDUCT.md` -- Contributor Covenant 2.1
- `GOVERNANCE.md` -- open governance, BDFL bootstrap
- `SECURITY.md` -- security reporting (already existed)
- `.github/ISSUE_TEMPLATE/**` -- issue templates
- `.github/PULL_REQUEST_TEMPLATE.md` -- PR template

## Safety checks before pushing the sync branch

Run these checks against the curated sync branch's index, not the private
development tree (private-only matches there are expected).
Every category is covered; each check must return zero results before pushing.
Git emits slash-separated paths even on Windows:

```powershell
# 1. No non-example env files
git ls-files | Select-String '(?i)(^|/)\.env($|\.((?!example$).+))'

# 2. No credentials or personal Claude settings
git ls-files | Select-String '(?i)(\.pem$|\.key$|(^|/)serviceAccount[^/]*\.json$|^\.claude/settings\.local\.json$)'

# 3. No internal scratch scripts or local sync reports
git ls-files | Select-String '(^Code/apps/api/_.*\.(cjs|js)$|^_test\.js$|^_test_wrap\.txt$|^_sync-report-.*\.md$)'

# 4. No internal documentation
git ls-files | Select-String '(^docs/private/|(^|/)CHANGELOG_.*\.md$|(^|/).*-REVIEW\.md$|(^|/).*-INTERNAL\.md$)'

# 5. No personal workspace config or private MCP tooling (includes mcp.json)
git ls-files | Select-String '(^\.vscode/|^\.idea/|^workspace\.code-workspace$|^tools/(improvmx-mcp|test-runner-mcp)/|^\.mcp\.json$)'

# 6. No generated browser test artifacts
git ls-files | Select-String '^Code/apps/web/(playwright-report|test-results)/'

# 7. No memory or session state
git ls-files | Select-String '(^memories/|^\.claude/session/)'

# 8. Content grep: personal emails and absolute local paths (not covered by path checks)
git grep -nIE '[A-Za-z]:[\\/](Users|Project Folders)[\\/]'
# Also git grep for the maintainer's personal email and handle. Keep those
# strings out of committed files: this file itself ships publicly.
```

Check 8 is a manual review step, not script-enforced: known hits (for example a
local path in `.claude/skills/vercel-deploy` or `scripts/deploy-vercel.ps1` in older
snapshots) must be scrubbed or consciously accepted before pushing. Also review
`docs/proposals/**` content each sync, since it ships publicly.

The script removes matches and asserts every pattern from the same array,
preventing removal/assertion drift. Local read-only regression validation:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-public-sync-exclusions.ps1
```

This parses the script and tests synthetic paths without executing the release
loop, changing the index, or contacting a remote.

## Updating this list

When adding a new internal-only file pattern:
1. Add the pattern to the appropriate category above with the reason
2. Add a corresponding safety check at the bottom
3. Update `$publicSyncExclusionPatterns` in `scripts/release-open-source-loop.ps1`
   and the focused regression cases in `scripts/test-public-sync-exclusions.ps1`
4. Note the change in the commit message
