# Open-Source Release Loop

This runbook defines the repeatable sequence for taking private main all the way to an opened public sync PR.

## One-command execution

From repository root:

```powershell
pnpm release:loop
```

Faster variant that skips the CI status poll and the live API wait:

```powershell
pnpm release:loop:prep
```

Skip only CI status poll:

```powershell
pnpm release:loop:no-ci
```

Every variant, including `release:loop:prep`, still installs dependencies, commits, pushes the private branch, pushes a public sync branch and opens the public PR. There is no dry run; for a read-only check of the exclusion policy run `scripts/test-public-sync-exclusions.ps1`.

## What the loop does

1. testing-strategy
- Runs `pnpm test`

2. monorepo-conventions
- Runs `pnpm build`

3. security-hardening
- Runs `pnpm security:check`

4. open-source-pipeline + security-hardening
- Verifies governance/workflow files exist
- Runs public-sync safety checks against tracked files:
  - no non-example `.env` files tracked
  - no `.vscode/mcp.json` tracked
  - reports private-only paths that must be excluded at sync time (`Code/apps/api/_*`, `tools/improvmx-mcp/`, `docs/private/**`)

5. github-workflow
- Commits any local working-tree changes (if present)
- Pushes private branch updates to the private remote

6. github-workflow
- Polls latest GitHub Actions run for current branch until success

7. testing-strategy
- Waits 180 seconds for deployment propagation
- Runs live API smoke suite: `pnpm --dir Code/apps/api test:public`

8. open-source-pipeline + github-workflow
- Creates a sync branch from `public/main`
- Snapshots private source tree onto the sync branch
- Applies curated public-sync exclusions
- Pushes the sync branch to the public remote
- Opens the PR against public `main` via GitHub CLI

## Failure policy

- The loop is fail-fast by design.
- If any stage fails, fix the issue, then rerun from stage 1.
- This keeps confidence high and avoids partial release state.

## Loop completion state

On success, the loop ends only after the public PR is created.

## Optional CI/live knobs

You can pass script args through npm using `--`:

```powershell
pnpm release:loop -- -CiWaitTimeoutMinutes 30 -CiPollSeconds 30
pnpm release:loop -- -LiveApiWaitSeconds 240
pnpm release:loop -- -PublicRemote public
pnpm release:loop -- -PublicRepo whitevo/Coordination-Manager-Public-Clean
```
