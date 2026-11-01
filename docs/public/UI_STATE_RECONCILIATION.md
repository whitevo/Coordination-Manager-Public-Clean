# UI State and Refresh Reliability

## Implementation Status

The application has a shared Tier 1 client reliability pilot. It does not yet
implement the proposal's Tier 2 server-version, idempotency, or conflict protocol.
Do not describe sessionStorage or local-generation counters as server authority.

The shared checkpoint, read guard, and presentation-only presence hooks are
implemented and tested. Subsequent edits to Mailbox and Time Management have left
some page paths on legacy wiring; do not assume every current reader/writer uses
these hooks. The motion and calendar sections below describe the previously
validated pilot behavior, not a page-wide migration guarantee. Existing domain
behavior is being preserved while paths are migrated incrementally.

The current bulk-action continuation adds a version-1 per-message API outcome
contract and a validated adapter in the current Mailbox page. It does not restore
the entire older pilot over newer page edits.

## Ownership

| Layer | Implementation | Responsibility |
| --- | --- | --- |
| Read/mutation guards | `ResourceReconciliationGuard`, `useResourceReconciliation` | Actual shared-transport metadata, pending operation identities, local generation fences, query response order |
| Domain projection | Page adapters and `projectMailboxActions` | Domain-specific flags, filtering, recurrence, write outcomes |
| Presentation | `useListPresence` | Concurrent exit ghosts, latest-state completion, inert ghosts, 180ms survivor reflow, reduced-motion fallback |

The guard does not own API calls or cache persistence. The new primitives have a
scoped ESLint restriction against importing the feature API client/session cache;
the scoped checkpoint hook is the explicit persistence owner. Negative import and
re-export fixtures keep that restriction testable.

The large pages still contain direct transport and legacy mutation paths. They
are not fully migrated domain-hook-only modules. Keep the allowlist honest and
expand enforcement only after migrating a resource's complete reader/writer set.

## Client Rules

1. Record local intent before sending a write. Never wait for an exit animation.
2. Use `guard.read(queryKey, loader)` so deduplicated callers share the actual
   observation start/generation. Pass `false` for a genuinely fresh forced read.
3. Capture query identity including parameters; partial pages only upsert.
   A complete observation may reconcile membership only for its declared scope.
4. Reconcile through the guard before applying domain-specific preservation.
   Pending entities and reads predating a tracked local mutation cannot overwrite
   local state. Reversed responses for the same query cannot replace newer ones.
5. Complete the specific operation token. The Time Management compatibility
   wrapper ends one registered operation per ID; other overlapping operations
   remain protected. New adapters should retain explicit operation tokens.
6. A failed read retains usable content, reports the error, and allows retry.
   Initial loading with no usable snapshot may show a placeholder.
7. Use `rollbackResourcePatch` for failed field patches rather than replacing an
   entire list. Restore a field only if it still equals the failed patch's value.
   This is a Tier 1 ownership check, not a complete journal rebase algorithm.
8. Cache semantic state only. Ghosts, layout measurements, and pointer state are
   never persisted. A user switch gets a separate collection/ref and invalidates
   the old guard; old setters cannot write the new user's checkpoint.

## Pilot Mailbox Motion

Single-email and thread trash apply the Trash category immediately and checkpoint
the semantic list. Bulk actions apply local trash/archive/read/tag projection
before the request; automation applies known results before presentation starts.
A row the user trashes in the current session always exits the list, even if the
selected filter includes Trash; only a Trash-only view keeps showing it. Restore
or a failed trash request brings it back. Trash does not switch the user's filter.
Restore (untrash) is optimistic too: the TRASH badge and restore button flip
before the provider call, a pending pin keeps older reads from re-applying the
trashed flag, and only failed IDs roll back.

When a row leaves the visible selector, a noninteractive visual ghost remains in
its old slot: the card fades (160ms), then the slot height collapses (220ms) so
rows below glide up. A row that already played this exit is never re-added as a
filter-hidden row, so the exit plays exactly once. Thread-sync merges use a
functional state update so a stale snapshot cannot resurrect a just-trashed row.
`Code/apps/web/e2e/mailbox-trash-sequence.spec.ts` samples every frame of single,
back-to-back, and thread deletes to guard this. Batch ghosts start together. Their removal
uses current state, not a timeout's captured filtered list; survivors reflow once.
The same owner handles filter-driven disappearance. The old manual-removal wait
and separate filter-row timer no longer own row state.

Exiting rows are inert, removed from keyboard interaction and accessibility
selection, and excluded from semantic counts/actions. A restored selector cancels
an in-progress exit. Reduced motion removes ghosts immediately. Calendar dragging
continues using its existing pointer-follow behavior, not mailbox choreography.

List, load-more, thread-open, and thread-prefetch responses use the read guard.
Protected inbox flags are projected back into refreshed thread data. Partial
mailbox pages cannot prove that an absent entity was deleted.

## Pilot Time Management

The event collection uses the shared guard and actual read metadata. Pending
operations are no longer represented by a single membership bit per event ID.
Existing recent-completion protections, delete tombstones, queued offline writes,
and authoritative revision reconciliation remain; they have not been promoted
into causal server versions.

A refresh error retains calendar items. The editor move path uses field-owned
rollback; bulk deletion uses individual outcomes and restores only failed IDs.
Other legacy whole-list rollback paths still require separate migration and tests.
Existing pending-create identity, drag, recurrence, and viewport behavior is not
replaced by the list-presence hook.

### Scoped event loading and deferred UI

Time Management requests `/api/user-events` with `windowStart` and `windowEnd`
for its displayed seven-day UTC-calendar window. Both bounds are required, must
be valid UTC ISO timestamps, and may span at most 35 days. The endpoint still
supports full paginated reads when neither bound is supplied, preserving other
calendar consumers and the fix for PostgREST's 1,000-row response cap.

A scoped read includes events overlapping the window and older recurrence
masters. Recurrence masters are deliberately conservative candidates; the
client expands their actual occurrences. The response declares its window
scope and does not present a window count as the global event revision.
Global revision polling remains separate.

Only the observed window may reconcile membership. Other weeks, pending
creates, queued offline writes, and protected local edits are retained.
Per-query response ordering and per-entity observation counters prevent older
overlapping reads from restoring newer observed deletions or overwriting newer
rows. These counters are client ordering fences, not causal server versions.
Failures retain usable events; stale/nonvisible failures cannot replace the
visible week's error or loading state. Week-cache identities include the user
and enabled sources; cached snapshots are not restored over current state.
Visible hydration precedes background neighbor-window warming.
The Time Management workspace is keyed by account identity. Switching accounts
remounts its event union and editor state and invalidates late reads from the
previous account, rather than merging another user's partial window into it.

The note composer lives in `time-management-markdown-composer.tsx` behind a
local lazy boundary, not the page-level loading boundary. Its placeholder
retains the current note text. The shared layout loads optional panels on first
open, then retains them on close to preserve drafts and closing transitions.
AI message delivery is buffered while its panel has not loaded. These boundaries
defer code downloads; they do not change persisted data or make animation an
owner of semantic state.

## Executable Examples and Gates

The design catalog at `/docs/design/catalog` contains **Concurrent exit and
guarded refresh**, a version-1 synthetic fixture using production hooks. It
supports batch trash, replaying an old observation, simulated completion or
partial rejection, and reset. It makes no API writes. The dialog catalog example
now mounts the production shared Dialog rather than copied modal markup.

Tests to run from the repository root:

```powershell
pnpm --dir ./Code/apps/web exec vitest run src/lib/__tests__/resource-reconciliation.test.ts
pnpm --dir ./Code/apps/web exec vitest run src/hooks/__tests__/use-list-presence.test.tsx
pnpm --dir ./Code/apps/web exec vitest run src/pages/__tests__/MailboxPage.test.tsx
pnpm --dir ./Code/apps/web exec vitest run src/pages/__tests__/TimeManagementEditorBehavior.test.tsx
pnpm --dir ./Code/apps/web exec playwright test e2e/resource-reconciliation.spec.ts --project=chromium
pnpm --dir ./Code/apps/web typecheck
pnpm --dir ./Code/apps/docs exec tsc --noEmit
```

Gate behavior, not just final screenshots: stale responses after mutation,
overlapping operations, partial pages, reversed reads, account switches, partial
rejection, latest survivor values during exit, and exit cancellation. Preserve
existing domain and cross-session regressions. Verify native pointer/keyboard
behavior, desktop/phone geometry, reduced motion, and focus in a real browser.
DOM-dispatched fixture tests do not substitute for native-pointer verification.
The public fixture also has native Chromium regressions for desktop batch removal,
stale response replay after completion, phone reduced motion, and partial rejection.
They require the docs dev server; `E2E_DOCS_BASE_URL` overrides its default URL.

## Bulk Action Outcome Contract

`POST /api/mailbox/messages/bulk-action` preserves `processed_messages`, `applied`,
`failed`, and `errors`. It adds `contract_version: 1`, `results`, and `warnings`.
Results are ordered by deduplicated requested message IDs; each action carries
its submitted index, name, value, and status:

- `applied`: the existing action handler completed. This is not a versioned ACK,
  cross-provider transaction, or proof that future reads cannot be stale.
- `uncertain`: mutation execution threw; an external or database effect might
  already have happened. Verify before rerunning; no automatic write retry.
- `unavailable`: the scoped query did not yield an owned message. Missing and
  unauthorized IDs receive the same result without disclosing ownership details.

An action-event or audit recording failure does not turn a known-applied mutation
into a rejection. Codes `ACTION_EVENT_NOT_RECORDED`, `CASCADE_NOT_COMPLETED`, and
`AUDIT_NOT_RECORDED` are separate warnings. They must be investigated; this change
does not introduce a durable repair queue for missing records.

The client validates message IDs, indexes, action identity/value, status, and
complete result coverage before consuming the detailed contract. It projects
reported applied effects without replacing newer local fields and preserves
uncertain fields. Unsupported/malformed or old aggregate-only responses use the
existing refresh fallback. Cascade, nonprojected actions, and unresolved results
still require refresh; a read does not by itself prove provider completion.

## Production Handoff

This continuation requires both an API and frontend production update. No changes
have been deployed automatically.

1. Deploy the updated API to Railway first through the normal approved release
   workflow. Old clients keep working because the response fields are additive.
2. Verify the bulk response shape with a dedicated staging/test mailbox, including
   partial outcomes and unavailable IDs. Do not trash customer mail for a smoke test.
3. Build/deploy the frontend with bundled docs to Vercel using the normal
   `build:with-docs` workflow. The frontend tolerates an older API but only gains
   precise outcome reconciliation when the new API is available.
4. Verify uncertainty/warning feedback and existing Mailbox behavior after rollout.
   Rolling the frontend back remains compatible with the additive API.

No SQL migration, new environment variable, or new dependency is required for this
slice. Server revisions, durable journals, operation-status/idempotency, and
conflicts remain a separate gated change with different production prerequisites.

Focused checks:

```powershell
pnpm --dir ./Code/apps/api exec vitest run src/routes/__tests__/mailbox.test.ts
pnpm --dir ./Code/apps/web exec vitest run src/pages/__tests__/MailboxPage.test.tsx
pnpm --dir ./Code/apps/api typecheck
pnpm --dir ./Code/apps/web typecheck
```

## Remaining Protocol Work

- A read begun after acknowledgment may still see a stale replica/provider.
  Local-generation ordering alone cannot prove causal read coverage.
- There is no canonical versioned ACK fence, persisted operation journal, or
  server mutation-status/idempotency contract in this pilot.
- Existing count/latest-update revision polling remains an invalidation hint,
  not an ordered server commit sequence.
- Mailbox bulk responses now include per-message outcomes. Durable provider-status
   verification, failed-record repair, and uncertain-write recovery remain pending.
- An uncertain write must eventually gain a verified outcome; do not advertise
  automatic retries as safe for non-idempotent provider actions.
- Queries outside the refreshed window and remote/local conflicts need explicit
  deletion/coverage and conflict contracts before strong convergence is claimed.
- Additional domain mutations, dialogs/panels/status examples, native browser
  scenarios, and application surfaces remain separately gated migrations.

See the [Testing Guide](./TESTING_GUIDE.md) and
[Mailbox Architecture Guide](./MAILBOX_ARCHITECTURE.md) for domain checks.