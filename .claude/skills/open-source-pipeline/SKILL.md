---
name: open-source-pipeline
description: Manage the curated private -> public repo sync pipeline for occasional open-source releases
---

# open-source-pipeline

## Purpose

Coordination Manager is developed in a private repo (`whitevo/Coordination-Manager`) that
drives the live production deployment. The public repo
(`whitevo/coordination-manager-public`) is a **curated snapshot**, not a continuous
mirror -- published occasionally to share new features and demonstrate the platform's
architecture to the open-source / Cardano governance audience.

This skill owns that release pipeline: when to publish, what to exclude, how to scrub,
how to push, and how to keep the two repos diverging safely.

## Current Reference Sources

- Public sync exclusions: [references/public-sync-exclusions.md](references/public-sync-exclusions.md)
- Public sync ledger: [references/public-sync-ledger.md](references/public-sync-ledger.md)
- Open-source checklist: [.claude/skills/security-hardening/references/open-source-checklist.md](../security-hardening/references/open-source-checklist.md)
- Security test catalog: [.claude/skills/security-hardening/references/security-test-catalog.md](../security-hardening/references/security-test-catalog.md)
- Platform settings: [.claude/skills/security-hardening/references/platform-settings.md](../security-hardening/references/platform-settings.md)
- Gitleaks rationale: [.claude/skills/security-hardening/references/gitleaks-rationale.md](../security-hardening/references/gitleaks-rationale.md)

Use those files as the current source of truth when preparing a first public release.

## Sync Ledger (Required)

Maintain [references/public-sync-ledger.md](references/public-sync-ledger.md) as the anchor
for each release cycle. This avoids re-reviewing the full repository every time.

Each row records:
- last private base SHA reviewed for public release planning
- sync branch used for that cycle
- private commit used as snapshot source
- resulting public PR and merge SHA (once merged)
- net added/removed file counts and notes

Before starting a new public sync:
- read the latest ledger row
- use that row's `private_base_sha` as the lower bound for file-diff and exclusion review
- only audit newly added paths since that SHA

## When to Use

- User asks to "publish a public release", "sync the public repo", "open-source the latest version"
- Preparing a milestone snapshot for governance / grant deliverables
- Adding a new private-only file pattern that must be excluded from future syncs
- Auditing what would be exposed if a sync ran today
- Onboarding a contributor to the public/private split
- Investigating a leak or near-leak from a previous sync

Do NOT use this skill for: routine private-repo branching (use `github-workflow`),
secret scrubbing in git history (use `security-hardening`), or dependency hygiene
(use `supply-chain-security`).

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| Trigger | Milestone release, feature showcase, or governance deliverable | yes |
| Source commit | Private `main` short SHA | yes |
| New exclusion patterns | Files added since last sync that are private-only | no |
| Public-only files to preserve | LICENSE, CONTRIBUTING.md, .github templates | yes (auto) |

## Release Cadence

- **Driver**: live production updates land on private `main` continuously
- **Public sync**: occasional, milestone-driven (typically every 4-12 weeks or per grant deliverable)
- **NOT a mirror**: never auto-push private commits; every public release is a reviewed PR
- **Single sync branch per release**: `sync/public-YYYY-MM`

## Workflow

1. **Pre-flight checks** (on private `main`):
   - Confirm clean working tree: `git status`
   - Confirm CI green on latest `main`
   - Run `gitleaks detect` against the working tree (not just history)
    - Read last entry in [references/public-sync-ledger.md](references/public-sync-ledger.md)
       and set `LAST_SYNC_PRIVATE_SHA=<private_base_sha>`
   - Review file additions since last sync:
     ```powershell
       git log --name-only --pretty=format: <LAST_SYNC_PRIVATE_SHA>..HEAD | Sort-Object -Unique
     ```
   - For each new file, decide: ship publicly OR add to
     [references/public-sync-exclusions.md](references/public-sync-exclusions.md)

2. **Update the exclusion list FIRST** if any new private-only patterns exist:
   - Edit [references/public-sync-exclusions.md](references/public-sync-exclusions.md)
   - Add pattern + reason to the matching category
   - Add a corresponding safety-check grep at the bottom
   - Commit to private `main` BEFORE starting the sync branch

3. **Create the sync branch from the public repo**:
   ```powershell
   git fetch public
   git checkout -b sync/public-YYYY-MM public/main
   ```

4. **Snapshot the private tree**:
   ```powershell
   # Copy the entire private main on top
   git checkout main -- .
   ```
6. **Restore public-only files**:
   ```powershell
   git checkout public/main -- LICENSE CONTRIBUTING.md .github
   ```

7. **Run all safety checks** from
   [references/public-sync-exclusions.md](references/public-sync-exclusions.md#safety-checks-before-pushing-the-sync-branch).
   Each grep must return zero results. If any returns results: STOP, update exclusions, restart from step 3.

8. **Write a local sync report** (audit trail, NOT committed):
   - Filename: `_sync-report-YYYY-MM-DD.md` at repo root (matches `_*` exclusion pattern)
   - Content: added files, removed files, preserved public-only files, source SHA
   - Use it as the PR description body

9. **Commit and push**:
   ```powershell
   git commit -m "sync: bring public up to private @<short-sha>"
   git push public sync/public-YYYY-MM
   gh pr create --repo whitevo/coordination-manager-public --base main --head sync/public-YYYY-MM `
     --title "Public sync YYYY-MM" --body-file _sync-report-YYYY-MM-DD.md
   ```

10. **Post-merge tasks**:
    - Tag a GitHub Release on the public repo with feature highlights
    - Update `docs/public/PRIVACY_POLICY.md` and `TERMS_OF_SERVICE.md` if the public-repo
      link semantics changed
    - Record the merged sync SHA in `_sync-report-YYYY-MM-DD.md` and archive locally
    - Re-run `gitleaks detect` on the public repo as a backstop
      - Append a new row to [references/public-sync-ledger.md](references/public-sync-ledger.md)
         with the branch, source SHA, PR URL, public merge SHA, and review notes

## Divergence Rules

- **Public-only files** live ONLY on `public/main` and are restored every sync:
  `LICENSE`, `CONTRIBUTING.md`, `.github/ISSUE_TEMPLATE/**`, `.github/PULL_REQUEST_TEMPLATE.md`
- **Private-only files** are listed in
  [references/public-sync-exclusions.md](references/public-sync-exclusions.md) and stripped every sync
- **Shared files** (everything else) flow private -> public only, never the reverse
- If a public contributor opens a PR, port the change manually into private `main` -- do NOT pull `public/main` into private

## Current Repo Surfaces

- Private development source: `Code/`
- Public-ready docs and release notes: `docs/proposals/`
- Internal-only release reports: `docs/private/*_REPORT_*.md`
- Public sync exclusions: `.claude/skills/open-source-pipeline/references/public-sync-exclusions.md`

## Outputs

| Output | Format | Location |
|--------|--------|----------|
| Sync branch | git branch | `public/sync/public-YYYY-MM` |
| Sync PR | GitHub PR | `whitevo/coordination-manager-public` |
| Sync report | .md | `_sync-report-YYYY-MM-DD.md` (local, not committed) |
| Updated exclusion list | .md | [references/public-sync-exclusions.md](references/public-sync-exclusions.md) |
| Release notes | GitHub Release | Public repo |

## Constraints

- NEVER push private `main` directly to `public` -- always via reviewed sync branch
- NEVER force push to `public/main`
- NEVER commit the `_sync-report-*.md` file (the `_*` prefix matches the exclusion convention)
- NEVER pull from `public/main` into private `main` (one-way flow, except for public-only files restored during sync)
- ALWAYS update `references/public-sync-exclusions.md` before the sync that needs the new pattern
- ALWAYS run every safety-check grep before pushing the sync branch
- If gitleaks reports any finding: STOP and remediate before continuing
- Treat every sync as an irreversible publication -- once pushed, assume it is mirrored elsewhere

## Self-Validation

### Trigger Indicators
- User says "sync public", "release public", "open-source update", "publish snapshot"
- User adds files matching `_*`, `*-REVIEW.md`, `*-INTERNAL.md`, or under `tools/`
- User asks "what would the public repo see if we synced today?"

### Completion Markers
- Sync PR opened on public repo with sync report as description
- All safety-check greps returned zero results
- Exclusion list updated for any new private-only patterns
- Public-only files (LICENSE, CONTRIBUTING.md, .github templates) preserved

### Quality Signals
- Zero gitleaks findings on the pushed branch
- No file in the PR diff matches an exclusion pattern (spot check)
- Sync report enumerates added/removed/preserved files
- Public repo release tagged with human-readable feature summary

## Related Skills

- `security-hardening` -- one-time scrub before the very first public release (git history, secrets)
- `github-workflow` -- private repo branching, commit conventions
- `supply-chain-security` -- pin actions, audit dependencies before publishing
- `environment-variables` -- ensure `.env.example` files are complete and accurate for public consumers
