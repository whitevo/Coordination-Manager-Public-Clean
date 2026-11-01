# Database Package

Contains the SQL schema for the Coordination Manager application, targeting Supabase (PostgreSQL).

## Setup

For a fresh database, run the core baseline followed by the required feature
baselines in the order documented in `migrations/README.md`:

```sql
-- Copy and run in Supabase SQL Editor:
-- migrations/000_full_schema.sql
```

The core baseline does not create every feature table. The feature baselines
are required for the selected application features; run the security baseline
last, after its core, Time Management, feedback, wallet/auth, and mailbox
dependencies.

## Tables

| Table | Purpose |
|-------|---------|
| `public.users` | User profiles (linked to `auth.users`) |
| `calendars` | Coordination calendars with config and permissions |
| `availability` | User availability time slots per calendar |
| `meetings` | Confirmed meetings within calendars |
| `calendar_sources` | External calendar connections (Google OAuth, public URLs) |
| `discord_integrations` | Links platform users to their Discord accounts |
| `discord_guild_channels` | Discord server channels enabled for announcements |
| `announcement_templates` | Reusable announcement message templates |
| `announcement_schedules` | Scheduled announcement deliveries with targets |
| `announcement_delivery_log` | Per-target delivery status tracking |

## Schema

The core schema and feature schemas are separate idempotent files:

- `migrations/000_full_schema.sql` — Core tables, indexes, RLS policies, triggers, and functions

Feature migrations are flat files in `migrations/` with `000_` prefixes:

- `migrations/000_feature-agent-platform.sql`
- `migrations/000_feature-announcements-and-comms.sql`
- `migrations/000_feature-discord-guardian.sql`
- `migrations/000_feature-feedback.sql`
- `migrations/000_feature-integrations.sql`
- `migrations/000_feature-mailbox.sql`
- `migrations/000_feature-maintenance-and-seeding.sql`
- `migrations/000_feature-misc.sql`
- `migrations/000_feature-network.sql`
- `migrations/000_feature-security.sql`
- `migrations/000_feature-time-and-calendar.sql`
- `migrations/000_feature-wallet-and-auth.sql`

Examples:

- `migrations/000_feature-discord-guardian.sql`
- `migrations/000_feature-time-and-calendar.sql`

The original numbered SQL upgrades are retained unchanged in
`migrations/archive/` for existing databases. Apply only migrations that are
not already present; do not re-run the historical sequence on a database
initialized from current baselines.

See `migrations/README.md` for the fresh-install order, legacy upgrade caveats,
and archive index.

## Database advisor regression checks

Use a disposable PostgreSQL container (no production credentials):

```powershell
docker run --rm --name cm-advisor-sql-tests -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16
```

In another terminal, after `pg_isready` succeeds:

```powershell
docker exec cm-advisor-sql-tests pg_isready -U postgres
docker exec cm-advisor-sql-tests psql -U postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE advisor_test;"
Get-Content -Raw 'Code\packages\database\tests\database-advisor-fixture.sql', 'Code\packages\database\migrations\archive\017_mailbox_primary_accounts.sql', 'Code\packages\database\migrations\archive\029_database_advisor_hardening.sql', 'Code\packages\database\migrations\archive\029_database_advisor_hardening.sql', 'Code\packages\database\verify\database-advisor-hardening.sql', 'Code\packages\database\tests\database-advisor-hardening.sql' | docker exec -i cm-advisor-sql-tests psql -U postgres -d advisor_test -v ON_ERROR_STOP=1
Get-Content -Raw 'Code\packages\database\migrations\archive\019_optimize_rls_policies.sql', 'Code\packages\database\verify\rls-performance.sql', 'Code\packages\database\verify\database-advisor-hardening.sql', 'Code\packages\database\tests\database-advisor-hardening.sql' | docker exec -i cm-advisor-sql-tests psql -U postgres -d advisor_test -v ON_ERROR_STOP=1
docker stop cm-advisor-sql-tests
```

These checks cover repeat application, preserved function/index identity, ordinary-user isolation, admin/oversight RLS access without recursion, response write ownership, trigger behavior, search-index usability, and rerunning 019 without restoring public RPC exposure. They do not check live Data API settings; keep `private` out of exposed schemas before running migration 029 in Supabase.

## Guardian SQL regression checks

The Guardian queue and RLS checks use a disposable PostgreSQL 16 database, not production credentials. The test setup refuses to run unless the database is named `guardian_test`. From the repository root, with Docker running:

```powershell
docker run --rm --name cm-guardian-sql-tests -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16
```

Leave that foreground container running. In another terminal:

```powershell
docker exec cm-guardian-sql-tests pg_isready -U postgres
docker exec cm-guardian-sql-tests psql -U postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE guardian_test;"
Get-Content -Raw 'Code\packages\database\tests\guardian-test-schema.sql' | docker exec -i cm-guardian-sql-tests psql -U postgres -d guardian_test -v ON_ERROR_STOP=1
Get-Content -Raw 'Code\packages\database\migrations\archive\024_guardian_settings_skips.sql', 'Code\packages\database\migrations\archive\025_guardian_ban_registry.sql' | docker exec -i cm-guardian-sql-tests psql -U postgres -d guardian_test -v ON_ERROR_STOP=1
Get-Content -Raw 'Code\packages\database\tests\guardian-ban-registry.sql' | docker exec -i cm-guardian-sql-tests psql -U postgres -d guardian_test -v ON_ERROR_STOP=1
Get-Content -Raw 'Code\packages\database\migrations\archive\027_guardian_global_bans.sql' | docker exec -i cm-guardian-sql-tests psql -U postgres -d guardian_test -v ON_ERROR_STOP=1
Get-Content -Raw 'Code\packages\database\tests\guardian-global-bans.sql' | docker exec -i cm-guardian-sql-tests psql -U postgres -d guardian_test -v ON_ERROR_STOP=1
Get-Content -Raw 'Code\packages\database\tests\guardian-global-migration-fixture.sql', 'Code\packages\database\migrations\archive\027_guardian_global_bans.sql', 'Code\packages\database\migrations\archive\027_guardian_global_bans.sql', 'Code\packages\database\tests\guardian-global-migration-check.sql' | docker exec -i cm-guardian-sql-tests psql -U postgres -d guardian_test -v ON_ERROR_STOP=1
Get-Content -Raw 'Code\packages\database\migrations\archive\028_guardian_ban_management.sql', 'Code\packages\database\tests\guardian-ban-management.sql' | docker exec -i cm-guardian-sql-tests psql -U postgres -d guardian_test -v ON_ERROR_STOP=1
Get-Content -Raw 'Code\packages\database\tests\guardian-ban-time-fixture.sql', 'Code\packages\database\migrations\archive\028_guardian_ban_management.sql', 'Code\packages\database\tests\guardian-ban-time-check.sql' | docker exec -i cm-guardian-sql-tests psql -U postgres -d guardian_test -v ON_ERROR_STOP=1
Get-Content -Raw 'Code\packages\database\migrations\archive\028_guardian_ban_management.sql', 'Code\packages\database\tests\guardian-ban-management.sql' | docker exec -i cm-guardian-sql-tests psql -U postgres -d guardian_test -v ON_ERROR_STOP=1
docker stop cm-guardian-sql-tests
```

Run each historical regression before its successor migration: 027 replaces scoped join/import semantics, and 028 retires the old periodic sweep. The scripts roll back fixtures and verify leader-only claims, stale-claim recovery, confirmation idempotency, future-server coverage, join enforcement, duplicate-removal receipts, exclusion of absent pre-bans from counters, direct client denial, and service-only RPC permissions. Management checks also cover removal/re-add fencing, late Discord write compensation, preserved audit history, inactive-account arrival/recovery exclusion, and last-booted timestamps. Stop old workers and apply 028 before deploying the matching API and event-driven ban/unban worker; never run an older worker against unban jobs.
