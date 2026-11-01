---
name: supabase-database
description: Guides Supabase (PostgreSQL) work in packages/database - idempotent migrations, 000_full_schema.sql sync, RLS policies and regression tests, JSONB column conventions, hash lookups, and polymorphic created_by identity. Use when creating or changing tables, writing a migration, adding RLS policies or indexes, working with JSONB config or time_slots, or traveler expiry cleanup.
---

# supabase-database

## Workflow

1. **Update the consolidated baseline first.**
   - Add core schema to `Code/packages/database/migrations/000_full_schema.sql`;
     add feature schema to its `000_feature-*.sql` file. Feature baselines
     contain distinct schemas; for example, `user_events` is in
     `000_feature-time-and-calendar.sql`.
   - Preserve source markers (`-- BEGIN SOURCE:` / `-- END SOURCE:`) when
     incorporating an incremental SQL file. List baseline coverage and any
     required install/upgrade order in `migrations/README.md`.
   - The existing `migrations/archive/` SQL files are immutable historical
     upgrades. Never edit or add new files there.
2. **Add a forward migration only when existing databases need one.**
   - Create the next sequential `NNN_{description}.sql` in `migrations/` for
     operations that cannot safely be delivered by re-running a baseline.
     Use the next number after the highest historical or active incremental
     file, and include the operation in the matching baseline.
   - Keep the forward migration idempotent and add it to `migrations/README.md`.
     New installs run the core and feature baselines; existing installs apply
     only unapplied forward migrations. Do not apply a baseline as a production
     upgrade procedure.

2. **Column patterns**:
   - Primary key: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` (most tables; older core tables use `uuid_generate_v4()`)
   - Timestamps: `created_at TIMESTAMPTZ DEFAULT NOW()`, `updated_at TIMESTAMPTZ DEFAULT NOW()`
   - Foreign keys: `REFERENCES {table}(id) ON DELETE CASCADE` where appropriate
   - JSONB for flexible config: `config JSONB`, `time_slots JSONB`, `theme_preferences JSONB`
   - Enums: `CHECK (column IN ('value1', 'value2'))`

3. **Identity patterns**:
   - `users.account_type TEXT CHECK (account_type IN ('google', 'traveler', 'cardano', 'managed_cardano'))`
   - Auth identity links (`wallet_address`, `account_type`, `redirect_to_user_id`) live in `auth.users.raw_app_meta_data`; never trust `raw_user_meta_data` (user-writable)
   - `calendars.creator_account_type TEXT DEFAULT 'google'` has no CHECK
   - Users table links: `id UUID REFERENCES auth.users(id)`
   - `wallet_address TEXT` -- for Cardano wallet lookup after account merge
   - `expires_at TIMESTAMPTZ` -- traveler auto-expiry (64 days, set in `routes/auth.ts`; `cleanup_expired_travelers()` deletes expired rows)
   - Nullable unique indexes: `CREATE UNIQUE INDEX ... WHERE column IS NOT NULL` (used for `email` and `google_id`, which are null for travelers)

4. **Hash lookup** (public-facing URLs; UUIDs stay internal):
   - `hash TEXT UNIQUE NOT NULL` -- nanoid(10) generated in the app layer
   - `CREATE INDEX idx_{table}_hash ON {table}(hash)`

5. **RLS policies** (always add a policy, even for service-only tables -- use the deny-all form below; every allowed operation needs its own policy):
   - Public read: `CREATE POLICY "name" ON {table} FOR SELECT USING (true)`
   - Owner write: `CREATE POLICY "name" ON {table} FOR UPDATE USING (auth.uid() = user_id)`
   - Service-only: `CREATE POLICY "Deny all" ON {table} FOR ALL USING (false) WITH CHECK (false)`
   - App-layer enforcement supplements RLS (e.g. hash-gated calendar access); the backend uses `supabaseAdmin` to bypass RLS when needed
   - Do not grant direct Data API access to `availability` or `meetings`: hash-link reads/guest participation are served by API routes that verify the calendar hash and use `supabaseAdmin`. User profile creation/edits also go through authenticated API routes; client roles must not write `users.roles` or other profile columns.
   - Views bypass RLS by default. Postgres 15+: `CREATE VIEW ... WITH (security_invoker = true)`. Older versions: revoke direct access to the view or put it in an unexposed schema.
   - Use `auth.uid()` in policy expressions. Role checks go through `private.current_user_has_role(role)`, which reads `public.users.roles` (not JWT claims).

6. **RLS regression tests**: SQL tests in `Code/packages/database/tests/` run by hand against a disposable database (each file refuses to run elsewhere); CI has no database job. `verify/rls-performance.sql` checks policy performance. For a new table, the tests should prove:
   - Cross-tenant reads fail (User A cannot SELECT User B's objects)
   - Cross-tenant writes fail (User A cannot UPDATE/DELETE User B's rows)
   - Insert ownership enforced (`created_by` / `user_id` consistent with session identity)
   - Privileged operations guarded (admin roles come from `users.roles`)
   - Policy performance checked with `EXPLAIN ANALYZE`
   - Run `tests/user-calendar-access-security.sql` through the consolidation smoke runner when changing the profile or hash-link access boundary; it checks client-role denial and retained service-role operations.

7. **Indexes**:
   - Visibility filters: `CREATE INDEX idx_{table}_visibility ON {table}(visibility)`
   - Foreign keys: `CREATE INDEX idx_{table}_{fk} ON {table}({fk_column})`
   - Account type: `CREATE INDEX idx_users_account_type ON users(account_type)`
   - Expiry queries: `CREATE INDEX idx_users_expires_at ON users(expires_at) WHERE expires_at IS NOT NULL`
   - Partial indexes for polling: `CREATE INDEX ... WHERE status = 'pending'` (used on `announcement_schedules` for scheduled sends)

8. **JSONB column shapes**:
   - Calendar config: `{ eventName, timeInterval, customStartDate, customEndDate, startHour, endHour, skippedDays, hideDateNumbers, socialLinks, onboardingUrl, communityResources }`
   - Time slots: `["2025-01-15T09:00", "2025-01-15T09:30", ...]` (ISO 8601 cell IDs; also used by `availability` and `meetings`)
   - Meeting `recurrence_rule`: `{ type, interval, unit, weekDays (0=Mon..6=Sun), endType, endDate, endCount, ... }` -- full shape in coordination-calendar
   - Theme preferences: `{ mode, darkThemeId, lightThemeId, customThemes, notificationSettings?, calendarSettings?, aiSettings? }`
   - AI settings (nested in theme_preferences): `{ preferredModel, sentimentToolEnabled?, timeManagementAiAccess? }`
   - Permissions (`calendars.permissions`): `{ canEdit: string[] }`
   - Roles: `["user", "admin"]` (`users.roles` JSONB array, default `["user"]`; auth middleware parses the first element plus the full array)

9. **Guardian and Discord tables**:
   - `guardian_rule_groups`: `{ name, description, is_enabled, action_delete_message, action_timeout_member, action_timeout_duration, action_ban_member }`
   - `guardian_rules`: `{ group_id, pattern, pattern_type ('regex'|'wildcard'), is_enabled }`
   - `guardian_message_log`: all scanned messages (dashboard stats)
   - `guardian_flagged_messages`: violations only (for review); edit versioning via `edit_version`
   - `discord_integrations`: `discord_guild_channels.integration_id` is `ON DELETE CASCADE`; the API only sets `is_active = false` on the integration, not on its channels

## Gotchas

- Never store secrets or API keys in the database. Core tables `calendars`, `availability`, `meetings` still use plain `TIMESTAMP`; use `TIMESTAMPTZ` for new columns.
