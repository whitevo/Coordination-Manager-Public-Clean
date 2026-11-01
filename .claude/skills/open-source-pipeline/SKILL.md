---
name: open-source-pipeline
description: Runs the curated private to public repo sync for occasional open-source releases of Coordination Manager - sync ledger, exclusion list, scrub and safety greps, sync branch and public PR, divergence rules. Use when asked to publish a public release, sync the public repo, open-source the latest version, add a private-only exclusion pattern, audit what a sync would expose, or investigate a sync leak. Not for private branching (github-workflow), history scrubbing or first-release readiness checklists (security-hardening), or dependency hygiene (supply-chain-security).
---

# open-source-pipeline

Private repo `whitevo/Coordination-Manager` drives production. Public repo
`whitevo/Coordination-Manager-Public-Clean` is a curated snapshot, not a mirror. Sync is
occasional and milestone-driven (typically every 4-12 weeks or per grant deliverable);
every release is a reviewed PR from one sync branch `sync/public-YYYY-MM-DD-HHmmss`.

## Local-only safety boundary

`scripts/release-open-source-loop.ps1` is the publication workflow, not a dry run.
All aliases (`prepare:public-pr`, `release:loop`, `release:loop:no-ci`,
`release:loop:prep`) install dependencies, commit working changes, push private and
public branches, and create a public PR. The prep variant only skips GitHub Actions
and live API checks; it STILL pushes.

For local-only hygiene use read-only git inspection and
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-public-sync-exclusions.ps1`.
Do not run the release loop, switch branches, or stage unrelated changes on a shared
dirty worktree. Publication steps below require separate authorization.

## Workflow

Checklist (copy and tick):

```
- [ ] 1 Pre-flight (clean tree, CI green, gitleaks, ledger read, new-file review)
- [ ] 2 Exclusion list updated and committed to private main
- [ ] 3 Public-only divergences resolved
- [ ] 4 Publication workflow run (authorized only), all safety greps return zero
- [ ] 5 Post-merge tasks and ledger row
```

1. **Pre-flight** (private `main`):
   - Confirm clean tree (`git status`) and CI green on latest `main`.
   - Run `gitleaks detect` against the working tree, not just history. Any finding: STOP and remediate.
   - Read the latest row of [references/public-sync-ledger.md](references/public-sync-ledger.md);
     set `LAST_SYNC_PRIVATE_SHA=<private_base_sha>` as the lower bound for review. A provisional
     baseline is not proof of a previous safety review, so also check the whole curated index
     against current policy.
   - List new files:
     ```powershell
     git log --name-only --pretty=format: <LAST_SYNC_PRIVATE_SHA>..HEAD | Sort-Object -Unique
     ```
   - For each new file: ship publicly OR add to
     [references/public-sync-exclusions.md](references/public-sync-exclusions.md).

2. **Update the exclusion list FIRST** if new private-only patterns exist:
   - Edit [references/public-sync-exclusions.md](references/public-sync-exclusions.md): add pattern + reason
     to the matching category, plus a corresponding safety-check grep at the bottom.
   - Update the matching pattern in `scripts/release-open-source-loop.ps1` and regression
     cases in `scripts/test-public-sync-exclusions.ps1`.
   - Commit to private `main` BEFORE starting an authorized publication.

3. **Resolve explicit public-only divergences before publication**:
   - Private source is authoritative for governance files (`LICENSE`, `CONTRIBUTING.md`,
     `.github` workflows/templates). Nothing is restored from `public/main` by default; never
     restore the whole `.github` folder over private source.
   - If a divergence is listed in the exclusions reference, STOP and arrange a reviewed,
     narrowly scoped preservation step. The script does not implement divergence restoration.

4. **Run the authorized publication workflow** from a dedicated clean worktree:
   ```powershell
   pnpm prepare:public-pr
   ```
   - Script: runs preflight/readiness checks, checkpoints working changes, pushes private
     source, checks CI/live API status; fetches `public`, creates a timestamped sync branch
     from `public/main`, clears its tracked tree, snapshots private source; removes
     exclusions and asserts every configured pattern; then commits, pushes, and creates the PR.
   - The local `_sync-report-YYYY-MM-DD.md` is the PR description, deleted by script
     cleanup. It must never be committed (excluded at repo root).
   - Before pushing any sync branch, run every check in
     [references/public-sync-exclusions.md](references/public-sync-exclusions.md#safety-checks-before-pushing-the-sync-branch);
     each must return zero matches, including the content grep for personal emails and
     absolute local paths (fix or scrub hits). Confirm `.env.example` files are complete and accurate for
     public consumers (see `environment-variables`). Also spot check that no PR diff file matches an exclusion
     and the sync report lists added/removed/preserved files.
   - If any stage fails, fix and restart from stage 1 (only when publication is authorized).

5. **Post-merge**:
   - Tag a GitHub Release on the public repo with feature highlights.
   - Update `docs/public/PRIVACY_POLICY.md` and `TERMS_OF_SERVICE.md` if public-repo link semantics changed.
   - Re-run `gitleaks detect` on the public repo as a backstop.
   - Append a ledger row to [references/public-sync-ledger.md](references/public-sync-ledger.md): branch,
     source SHA, PR URL, public merge SHA, net file counts, review notes. Archive the report locally if needed.

## Shipped publicly (deliberate, currently true)

These are NOT in the exclusion list and ship to the public repo on purpose:
`.claude/settings.json` and `.claude/skills/**` (incl. this skill and its ledger),
`.claude/rules/**`, root `CLAUDE.md`, `docs/proposals/**`, `docs/public/**`.
Do not add them to the exclusions without a user decision. Review each sync for
private references inside them (see the content grep in the exclusions reference).
`docs/proposals/` needs a per-sync content review before publication.

## Divergence rules

- Governance files live in private source and sync forward; public-only divergences need an
  explicit exclusions-reference entry and a reviewed preservation step.
- Private-only files are listed in the exclusions reference and stripped every sync.
- Shared files flow private -> public only. If a public contributor opens a PR, port the
  change manually into private `main`; do NOT pull `public/main` into private.

## Gotchas

- NEVER push private `main` directly to `public`; NEVER force push `public/main`.
- Treat every sync as irreversible publication; assume it is mirrored elsewhere.
- Update the exclusions reference before the sync that needs the new pattern.

## Key files

- `scripts/release-open-source-loop.ps1` - publication workflow
- `scripts/test-public-sync-exclusions.ps1` - exclusion regression tests (read-only)
- `docs/proposals/` - public-ready docs and release notes
- `docs/private/*_REPORT_*.md` - internal-only release reports
- `.claude/skills/security-hardening/references/` - `open-source-checklist.md`,
  `security-test-catalog.md`, `platform-settings.md`, `gitleaks-rationale.md`; source of truth
  for a first public release (use it instead of this skill for readiness checks)

## References

- [references/public-sync-exclusions.md](references/public-sync-exclusions.md) - read when deciding what to exclude or running safety greps
- [references/public-sync-ledger.md](references/public-sync-ledger.md) - read when starting or recording a sync
