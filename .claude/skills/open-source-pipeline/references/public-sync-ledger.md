# Public Sync Ledger

Track each private -> public sync cycle so future releases only review deltas from the last vetted private anchor.

## How to use

- Add one row per release cycle.
- Set `private_base_sha` to the private commit used as the lower bound for the next review cycle.
- For next-cycle file audit, run:

```powershell
git log --name-only --pretty=format: <private_base_sha>..HEAD | Sort-Object -Unique
```

## Ledger

| date | private_base_sha | sync_branch | private_source_sha | private_main_commit | public_pr_url | public_merge_sha | status | notes |
|------|------------------|-------------|--------------------|---------------------|---------------|------------------|--------|-------|
| 2026-07-08 | 2597bfe | sync/public-2026-07 | 15f9cea | 2597bfe | pending | pending | private-main-updated | Cherry-picked tested sync commit into private main; public sync intentionally deferred. |

## Status values

- private-main-updated: change landed in private main, public PR not started
- branch-prepared: sync branch built and safety checks run
- pr-open: PR created against public/main
- merged: public sync PR merged
