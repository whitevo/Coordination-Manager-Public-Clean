# Public Sync Ledger

Track each private -> public sync cycle so future releases only review deltas from the last vetted private anchor.

## How to use

- Add one row per release cycle.
- Set `private_base_sha` to the private commit used as the lower bound for the next review cycle.
- A `local-evidence-provisional` row is a planning baseline, not a certified
  security/exclusion review or confirmation of current remote state.
- For next-cycle file audit, run:

```powershell
git log --name-only --pretty=format: <private_base_sha>..HEAD | Sort-Object -Unique
```

## Ledger

| date | private_base_sha | sync_branch | private_source_sha | private_main_commit | public_pr_url | public_merge_sha | status | notes |
|------|------------------|-------------|--------------------|---------------------|---------------|------------------|--------|-------|
| 2026-07-08 | 2597bfe | sync/public-2026-07 | 15f9cea | 2597bfe | pending | pending | private-main-updated | Cherry-picked tested sync commit into private main; public sync intentionally deferred. |
| 2026-08-02 | ef95e760bbafed224c8028508940664320790e01 | sync/public-2026-08-02-172722 | ef95e760bbafed224c8028508940664320790e01 | ef95e760bbafed224c8028508940664320790e01 | #4 (local merge message only) | 2275782e119057d1e59629db9a898fb303a1ebed | local-evidence-provisional | Recorded 2026-10-10 from local objects/remote-tracking refs only; snapshot 52b44d04d682bd3f9a0d52533581dd2b6e684e7b names private source @ef95e76. Merge and snapshot trees match. File counts not recorded; prior safety review not certified. No remote fetch or publication performed. |

Notes on history (from the local Public Clean clone, which may be behind remote):
the July sync branch `sync/public-2026-07` predates the timestamped branch
convention; the clone shows it merged as public PR #1 (df45f5c, 2026-07-08). A later
timestamped branch `sync/public-2026-07-22-172906` merged as PR #3 (e23ece3,
2026-07-22) and has no ledger row. Existing rows are unchanged; verify against the
remote before relying on these.

## Provisional August baseline evidence

Read-only local evidence inspected on 2026-10-10:

- `git show -s --format='%H %cI %s' 2275782 52b44d0 ef95e76`:
  all three objects exist with 2026-08-02 commit timestamps.
- `git show -s --format='%H%n%P%n%s%n%b' 2275782 52b44d0 ef95e76`:
  `2275782` has snapshot `52b44d0` as its second parent and names public PR #4;
  `52b44d0` names private source `ef95e76` in its sync commit subject.
- `git diff --name-status 52b44d0 2275782`: no differences.
- `git for-each-ref --format='%(refname) %(objectname)' refs/remotes/public`:
  local `public/main` points to `2275782` and the August sync ref to `52b44d0`.

These cached refs and commit metadata justify a provisional delta-planning
anchor at `ef95e76`, not a claim that current policy was enforced in August.
No remote was fetched, and the current remote PR/merge status was not verified.
Before an authorized publication, confirm remote state and audit all current
exclusions against the full curated index, not just additions since the anchor.

## Status values

- private-main-updated: change landed in private main, public PR not started
- branch-prepared: sync branch built and safety checks run
- pr-open: PR created against public/main
- merged: public sync PR merged
- local-evidence-provisional: local snapshot/merge/source evidence only; remote
  state and previous safety review remain unverified
