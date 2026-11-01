# Migrations Layout

This folder contains current consolidated baselines and immutable historical upgrade files.

For a fresh database, run `000_full_schema.sql`, then the feature baselines required by
the application. Existing databases must use the historical upgrade files in
`archive/` only for migrations that are not already applied. Do not apply a
baseline over an existing production database as an upgrade procedure.

## Canonical Baseline

- `000_full_schema.sql` -- idempotent core baseline. Feature files supply additional schemas and later changes.

## Active Forward Migration

- `041_deny_direct_user_calendar_access.sql` -- revoke direct client writes to user profiles and direct Data API access to availability/meetings. The security feature baseline includes the same hardening for fresh installs and repeated baseline runs. Apply this migration to existing installations after their previously applied upgrades; it remains active and must not be moved to `archive/`.

## Feature Files

- `000_feature-agent-platform.sql` -- agent API keys and quota/ethics controls
- `000_feature-announcements-and-comms.sql` -- announcements, DM subscriptions, email contacts, SMTP, invite flows
- `000_feature-discord-guardian.sql` -- guardian moderation schema and operational state tables
- `000_feature-feedback.sql` -- feedback domain, responses, sentiment, attachments
- `000_feature-integrations.sql` -- third-party integrations (Luma, Zoom, embed behavior)
- `000_feature-mailbox.sql` -- mailbox accounts, normalized messages/threads, contacts, rules, AI artifacts, and audit trails
- `000_feature-maintenance-and-seeding.sql` -- cleanup, compatibility, polling, seed/maintenance migrations
- `000_feature-network.sql` -- network relation schemas
- `000_feature-security.sql` -- RLS hardening, policy/search_path fixes, privilege revocations
- `000_feature-time-and-calendar.sql` -- recurrence, event calendar, time-management page schema
- `000_feature-wallet-and-auth.sql` -- Cardano wallet and managed wallet auth support
- `000_feature-misc.sql` -- uncategorized cross-cutting migrations

## Page/Feature Quick Map

- Time Management page -> `000_feature-time-and-calendar.sql`
- Discord Guardian app -> `000_feature-discord-guardian.sql`
- Announcements and DM calendar subscriptions -> `000_feature-announcements-and-comms.sql`
- Feedback pages and agent feedback -> `000_feature-feedback.sql`
- Security/RLS hardening -> `000_feature-security.sql`

## Fresh-install order

Run the core baseline first. Then run the feature baselines you use in this
order (skip only features the deployment does not use):

1. `000_feature-wallet-and-auth.sql`
2. `000_feature-time-and-calendar.sql`
3. `000_feature-announcements-and-comms.sql`
4. `000_feature-feedback.sql`
5. `000_feature-integrations.sql`
6. `000_feature-mailbox.sql`
7. `000_feature-network.sql`
8. `000_feature-discord-guardian.sql`
9. `000_feature-agent-platform.sql`
10. `000_feature-misc.sql`
11. `000_feature-maintenance-and-seeding.sql`
12. `000_feature-security.sql` (last)

The security feature depends on the core, Time Management, feedback, wallet/auth,
and mailbox schemas. In particular, its consolidated 019 RLS policies require
`user_events`, feedback, and invitation tables; the 029 hardening requires the
mailbox primary-account trigger and `pg_trgm`. Keep `private` out of Supabase
Data API exposed schemas after installation. Availability and meeting reads and
writes are served by hash-verifying API routes using `supabaseAdmin`; direct
anon/authenticated access is revoked. User profile reads remain scoped to the
authenticated user (and admins where configured), while profile edits and
creation stay behind authenticated API routes using the service role.

## Isolated SQL smoke test

Run `powershell -NoProfile -File .\Code\packages\database\tests\run-consolidation-smoke.ps1`
from the repository root when Docker Engine is already available. The runner
does not start Docker Desktop. It uses a uniquely named PostgreSQL 16 container
with no host ports, mounted volumes, or network access, and removes that
container when done. It applies the current baselines twice to a fresh database,
checks representative schema/RLS/function/index invariants, then applies the
pre-consolidation `HEAD` baselines followed by all 41 archived upgrades and
active migration 041 twice to a separate disposable database. Catalog
fingerprints detect schema drift on the repeat pass. The user/calendar security
regression test proves client-role escalation and direct calendar data access
are blocked while service-role API operations remain available. It also checks
archive hashes against the original Git blobs. This is a PostgreSQL smoke test
with minimal local `auth`/role shims;
it does not emulate Supabase services or prove application behavior on a live
Supabase project.

The Time Management feature includes the Google-sync schema (migration 032),
conditional recurrence/completion (034/035), and calendar change notifications
(historical 039). The wallet/auth feature includes the 031 trusted-metadata
backfill; on a fresh empty database it is a no-op, and newly created accounts
receive trusted metadata from the API. Consolidated baselines are repeatable,
but running the backfill against an existing database can update trusted
`auth.users.raw_app_meta_data` values.

## Archived incremental files

All 41 original `001`-and-higher SQL files are retained unchanged in
`archive/` for upgrades of databases that predate consolidation. Their
historical filenames are preserved, including both `039_*.sql` files. Apply
only unapplied migrations, in dependency order, to an existing database; do not
run the archive on top of a database initialized from the current baselines.

- `archive/001_mailbox_junk_domains.sql` -- mailbox junk domain preferences
- `archive/002_calendar_archive_state.sql` -- public calendar auto-archive state (`archived_at`, `listing_expires_at`)
- `archive/003_mailbox_non_organizer_senders.sql` -- mailbox non-organizer sender preferences
- `archive/004_mailbox_action_events.sql` -- `mail_action_events` table for "Receive action" automation triggers (manual vs. rule provenance, cascade loop guard)
- `archive/005_mailbox_drafts.sql` -- `mail_drafts` table for locally composed replies/forwards and provider send bookkeeping
- `archive/006_mailbox_contact_details.sql` -- adds `labels`/`region`/`timezone` to `mail_contacts` and `label` to `mail_contact_identities`
- `archive/007_mailbox_contact_frequency.sql` -- adds `sent_count`/`received_count`/`last_sent_at`/`last_received_at` to `mail_contacts`
- `archive/008_mailbox_messages_archived_index.sql` -- composite `(account_id, is_archived, received_at DESC)` index on `mail_messages` to prevent statement timeouts on the message list query
- `archive/009_ai_prompt_usage_category.sql` -- repairs deployed `ai_prompt_usage` tables missing the per-feature `category` quota column
- `archive/010_mailbox_filter_rules.sql` -- adds user-scoped shared mailbox filter and sorting rules
- `archive/011_mailbox_notification_rules.sql` -- per-user notify/mute/always/never rules for the in-app new-mail badge
- `archive/012_mailbox_notification_check_watermark.sql` -- watermark for the background new-mail check so it only re-evaluates changed messages
- `archive/013_event_moderation.sql` -- community moderation for public event listings
- `archive/014_mailbox_calendar_raw_text.sql` -- stores raw VCALENDAR/ICS text found with a message for invitation detection
- `archive/015_mailbox_account_sync_options.sql` -- per-account mailbox import settings
- `archive/016_mailbox_account_sync_backoff.sql` -- back-off state so the auto-sync loop stops hammering accounts in error
- `archive/017_mailbox_primary_accounts.sql` -- primary mailbox account selection and last-used From account fallback
- `archive/018_mailbox_quick_sync_watermark.sql` -- per-account watermark for efficient new-mail checks
- `archive/019_optimize_rls_policies.sql` -- optimizes auth evaluation, consolidates overlapping policies, and removes a duplicate invite index
- `archive/020_mailbox_threading_options.sql` -- adds global Mailbox Thread View conditions
- `archive/021_mailbox_messages_list_index.sql` -- index for the synced mailbox list query when archived messages are included
- `archive/022_mailbox_settings_sections.sql` -- persists Mailbox Settings section expansion state per user
- `archive/023_mailbox_import_action_events.sql` -- provider-import receive actions, kept separate from manual and automation actions
- `archive/024_guardian_settings_skips.sql` -- records settings-based Guardian skip reasons and indexes actual scans
- `archive/025_guardian_ban_registry.sql` -- server-scoped ban registry, service-only queue RPCs, and restart-safe claims
- `archive/026_user_events_list_index.sql` -- composite `(user_id, start_time)` index for authenticated event-list filtering and ordering
- `archive/027_guardian_global_bans.sql` -- global account registry, resumable membership reviews, confirmation queue, and deduplicated member-removal counts
- `archive/028_guardian_ban_management.sql` -- inactive registry tombstones, global unban jobs, last-booted receipt timestamps, event-driven recovery, and late-write compensation
- `archive/029_database_advisor_hardening.sql` -- database-owner hardening (search paths, `pg_trgm` relocation, private role helper); see existing-database upgrade caveats
- `archive/030_mailbox_oauth_transactions.sql` -- browser-bound, single-use mailbox OAuth connection transactions
- `archive/031_auth_trusted_app_metadata.sql` -- backfills wallet_address / account_type into auth `app_metadata` (the API no longer trusts user-writable `user_metadata`); run as database owner
- `archive/032_google_event_links.sql` -- outbound Google Calendar links for Time Management items (`google_event_links`) and `user_events.series_id` / `original_start_time` for single-occurrence replacements
- `archive/033_account_merge_tokens.sql` -- single-use, hashed account-merge tokens (`account_merge_tokens`) so merge links survive restarts and multiple API instances
- `archive/034_time_item_conditional_recurrence.sql` -- shared Time Item recurrence identity/status, unique occurrence windows, atomic incremental generation and completion; apply before deploying conditional recurrence
- `archive/035_time_item_completion.sql` -- individual Time Item completion timestamps; completing a recurrence atomically completes only its latest item without changing history; apply after 034 before deploying the completion refinement
- `archive/038_event_calendar_networks.sql` -- Events Calendar-only source aliases, preserved original names, live network unions and many-to-many event assignments; apply before deploying network relations changes
- `archive/039_network_rename_joins.sql` -- durable rename-to-existing redirects, service-only atomic joins, combined union/redirect cycle validation; apply after 038 before enabling joins
- `archive/040_network_delete_cascade.sql` -- deleting a destination cascades through joined networks and their tagging rules/assignments; removes deleted source references from combinations; apply after network migration 039
- `archive/039_calendar_change_notifications.sql` -- organiser email notification settings per Coordination Calendar (`calendar_notification_settings`) and the aggregated change queue (`calendar_change_events`), both service-role only; apply before deploying participation change emails. Included in `000_feature-time-and-calendar.sql`

## Consolidated baseline coverage

The current baselines were checked against all 41 archived upgrade files and
provide the consolidated fresh-install schema, policy, index, and function
state. Already-equivalent table definitions are retained rather than repeated,
and missing operations are incorporated in source blocks or directly in their
owning baseline. Data normalization needed only by older installations remains
in the unchanged archived upgrade; never use a baseline as its substitute:

- Core (`000_full_schema.sql`): 002 calendar archive metadata, 009 AI usage
  category/index cleanup, 013 event moderation, and 030 mailbox OAuth
  transactions.
- Mailbox (`000_feature-mailbox.sql`): 001, 003-008, 010-012, 014-018, and
  020-023. Existing table definitions already covered the preference defaults,
  calendar raw text, sync options/backoff, threading/settings options, and
  action-event foundation. The baseline also includes the missing contact
  details/frequency, archived-message index, notification settings/watermark,
  primary-account data migration, quick-sync fields, and import action checks.
- Security (`000_feature-security.sql`): 019 optimized RLS policies and 029
  database-advisor hardening, ordered after the mailbox primary-account
  function; the latter remains transactional and requires database-owner
  privileges.
- Wallet/auth (`000_feature-wallet-and-auth.sql`): 031 trusted `app_metadata`
  backfill and 033 merge-token schema.
- Guardian (`000_feature-discord-guardian.sql`): 024, 025, 027, 028, and 037.
- Time/calendar (`000_feature-time-and-calendar.sql`): 026, 032, 034, 035, and
  the calendar-notification 039. The source block omits only the historical
  `BEGIN`/`COMMIT` wrapper.
- Announcements (`000_feature-announcements-and-comms.sql`): 036.
- Network (`000_feature-network.sql`): 038, network-join 039, and 040.

The two `039_*.sql` files are distinct upgrades: calendar notifications are
independent, while network joins require 038 and precede 040.

## Legacy upgrade ordering

On an older database, apply only missing files in the original numeric
sequence. Migration 019 follows the core, feedback, invitation, event, and
mailbox schemas; 029 follows both mailbox primary-account migration 017 and
019. Run 029 as database owner. Migration 031 also requires database-owner
access and must precede deployment that trusts `auth.users.raw_app_meta_data`;
032 precedes Google-sync API changes. Apply 034 before conditional recurrence
code and 035 after 034 before completion refinements. Apply 038 before network
join behavior, `archive/039_network_rename_joins.sql` after 038, and
`archive/040_network_delete_cascade.sql` after that 039 before network deletion
behavior. The separate `archive/039_calendar_change_notifications.sql` must
precede participation-change
email deployment but has no dependency on network joins. For Guardian upgrades,
stop old workers and follow 024 -> 025 -> 027 -> 028 with the coordinated
rollouts described below.

Events Calendar networks require the core baseline, the time-and-calendar
feature, and event moderation. Existing installations must have the archived
`archive/013_event_moderation.sql` upgrade applied before the network updates.
The consolidated network feature includes 038, 039 and 040 for new installations.
Only unjoined network names are unique. Retained joined records preserve
their original identities but are not separate public filter options.
The API supports migration-038 reads during the rolling upgrade; attempts to
join before 039 return an explicit schema-required error. The migration
notifies PostgREST to reload its schema. Joins never overwrite destination
metadata or delete origin mappings/assignments. After 040, deleting a
destination atomically deletes all networks joined into it, including chained
joins, plus their mappings/rules/assignments. Ordinary combination members
survive; references to deleted tags are removed. Meetings and provider
calendars are untouched. Apply 040 alongside the updated confirmation UI.
Run `tests/event-calendar-networks.sql` on a disposable
`event_calendar_networks_test` database after applying the network feature to
check immutable provenance, cycles, overlapping assignments, RLS, and deletion
cleanup. Do not run regression fixtures on production.
Run these fixtures after 040. Also run `tests/network-rename-joins.sql` and
`tests/network-delete-cascade.sql` to verify chained joins, source provenance,
idempotent retries, cycle rejection, RPC access, and cascade cleanup.

## Existing-database upgrade caveats

- Use `archive/` files only for existing databases that have not already received
  the corresponding schema change. Review the live schema and deployment history
  first; the repository does not track applied migrations for Supabase SQL Editor
  users. Do not mix a current `000_` baseline with its historical changes as a
  second upgrade path.
- For existing mailbox installations, apply `archive/017_mailbox_primary_accounts.sql`
  and `archive/019_optimize_rls_policies.sql` before
  `archive/029_database_advisor_hardening.sql`. Run 029 as database owner. It
  fixes the primary-account trigger search path, relocates `pg_trgm` to
  `extensions` without rebuilding the search index, and moves the existing role
  helper to `private` without replacing its policy dependencies. Missing
  prerequisites or duplicate public/private helpers abort it.
- Keep `private` out of Supabase Data API exposed schemas (Dashboard API settings). Authenticated users retain schema USAGE and helper EXECUTE for RLS; anon is denied. Do not revoke authenticated execution or change the helper to invoker security.
- Run `verify/database-advisor-hardening.sql` after 029, then rerun Security
  Advisor and check mailbox search plus ordinary-user/admin/oversight access.
  Catalog verification cannot establish Data API exposed-schema configuration.
  Current baselines use the private helper and schema-qualified trigram
  operators; do not re-run 029 as an upgrade after those baselines.
- Keep new changes grouped into the consolidated feature file unless there is a strong reason to split.
- Existing mailbox installations must run `archive/020_mailbox_threading_options.sql`
  before using Thread View settings and `archive/022_mailbox_settings_sections.sql`
  to sync settings section state across devices.
- Existing Guardian installations must run `archive/024_guardian_settings_skips.sql`
  before deploying the bot/API settings-skip changes. The Guardian feature
  baseline includes this change. Legacy message-log rows retain a null skip
  reason; current settings cannot establish whether an old row was actually scanned.
- Fresh Guardian installations must also run `000_feature-discord-guardian.sql`; the core baseline does not create the optional Guardian tables. Rerunning the baseline upgrades skip metadata only when the Guardian message-log table already exists.
- Existing Guardian installations must apply `archive/025_guardian_ban_registry.sql`
  before deploying Ban List routes and the bot worker. Registry schema/RPCs are
  also included in the core and Guardian baselines; the claim function requires
  the Guardian instance-lock table at execution time.
- The global Ban List requires `archive/027_guardian_global_bans.sql` on older
  databases. Stop old Guardian workers during rollout and deploy the matching
  API/web/Guardian versions together. It consolidates enabled legacy entries by
  Discord ID and earliest added date, preserves legacy audit rows, and initializes
  removal counts at zero. New workers enforce migrated IDs globally. The old
  scoped import RPC is revoked; do not run older API/bot versions against the
  upgraded schema. Current baselines include its schema and RPCs.
- Ban List management requires `archive/028_guardian_ban_management.sql` after
  027. Stop old Guardian workers before applying it; old workers do not
  understand `action = 'unban'`. Deploy matching API/web/Guardian versions
  together. Removed IDs retain service-only audit data but stop join/recovery
  enforcement; selected removals queue unbans with claim fencing and late-write
    compensation. The old sweep RPC raises an explicit retirement error.
    Last-booted metadata is backfilled only from confirmed receipts. This migration
  does not perform Discord bans/unbans. Current baselines include it.
- Existing installations can apply `archive/026_user_events_list_index.sql`
  separately. Index creation does not change event data or RLS policies, but
  takes a write-blocking lock on `user_events`; schedule it during low traffic.
  Current core and time/calendar baselines include the index. Do not raise
  `work_mem` as part of this migration.
- Imported-event reconciliation compares timezone-aware timestamps by instant (including microseconds) and pages through all existing source events. Repeating an unchanged import should report zero event inserts, updates, and deletes and preserve event revisions. Verify this with mocked API tests locally; after deployment compare query-statistic deltas during normal usage without resetting production counters or running load tests. Existing sync ranges, publishing choices, and polling intervals are unchanged.
- Existing installations must apply `archive/036_announcement_message_deletion.sql`
  before deploying API/bot/web versions that let senders delete posted Discord
  announcement messages. Guardian installations must apply
  `archive/037_guardian_undo_actions.sql` before deploying dashboard unban and
  remove-timeout actions. Current consolidated feature baselines include both.
