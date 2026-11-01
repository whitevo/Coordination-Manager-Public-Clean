-- Consolidated feature migration file: feature-security
-- Generated from incremental files for easier agent navigation.
-- Keep statements idempotent when adding future changes.

-- ============================================================
-- BEGIN SOURCE: 012_security_hardening.sql
-- ============================================================
-- ============================================================
-- Migration 012: Supabase Security Advisor — Hardening
-- Addresses the following warnings:
--   1. RLS Disabled on 6 tables (events, notifications,
--      calendar_syncs, discord_channels, dm_opt_outs,
--      dm_first_contacts)
--   2. Function Search Path Mutable on 5 functions
--   3. RLS Policy Always True on 4 tables (availability,
--      meetings, users, wallet_challenges)
--
-- NOTE: "Leaked Password Protection Disabled" must be toggled
-- on in the Supabase Dashboard → Authentication → Settings.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. ENABLE RLS ON TABLES THAT ARE MISSING IT
-- ────────────────────────────────────────────────────────────
-- events, notifications, calendar_syncs, discord_channels are
-- legacy/planned tables managed exclusively by the backend
-- (service_role bypasses RLS). Enabling RLS with no permissive
-- policies locks them to service_role-only access.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'events') THEN
    ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'notifications') THEN
    ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'calendar_syncs') THEN
    ALTER TABLE public.calendar_syncs ENABLE ROW LEVEL SECURITY;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'discord_channels') THEN
    ALTER TABLE public.discord_channels ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- dm_opt_outs & dm_first_contacts are managed by the Discord
-- bot backend (service_role). Lock down direct client access.
ALTER TABLE public.dm_opt_outs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dm_first_contacts ENABLE ROW LEVEL SECURITY;


-- ────────────────────────────────────────────────────────────
-- 2. FIX FUNCTION SEARCH PATH MUTABLE
-- ────────────────────────────────────────────────────────────
-- SECURITY DEFINER functions without a fixed search_path are
-- vulnerable to search-path injection. Recreate each function
-- with SET search_path = '' and fully-qualified table names.

-- 2a. update_updated_at_column (trigger function)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- 2b. cleanup_expired_travelers
CREATE OR REPLACE FUNCTION public.cleanup_expired_travelers()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  expired_user RECORD;
BEGIN
  FOR expired_user IN
    SELECT id FROM public.users
    WHERE account_type = 'traveler'
      AND expires_at IS NOT NULL
      AND expires_at < NOW()
  LOOP
    DELETE FROM public.availability WHERE calendar_id IN (
      SELECT id FROM public.calendars WHERE created_by = expired_user.id::text
    );
    DELETE FROM public.meetings WHERE calendar_id IN (
      SELECT id FROM public.calendars WHERE created_by = expired_user.id::text
    );
    DELETE FROM public.calendars WHERE created_by = expired_user.id::text;
    DELETE FROM public.users WHERE id = expired_user.id;
    DELETE FROM auth.users WHERE id = expired_user.id;
  END LOOP;
END;
$$;

-- 2c. cleanup_expired_wallet_challenges
CREATE OR REPLACE FUNCTION public.cleanup_expired_wallet_challenges()
RETURNS void AS $$
BEGIN
  DELETE FROM public.wallet_challenges
  WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- 2d. user_has_role (multi-role helper)
CREATE OR REPLACE FUNCTION public.user_has_role(uid UUID, check_role TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = uid
    AND roles @> to_jsonb(check_role)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = '';

-- 2e. update_calendar_sources_updated_at (may exist from manual creation)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
    AND p.proname = 'update_calendar_sources_updated_at'
  ) THEN
    ALTER FUNCTION public.update_calendar_sources_updated_at() SET search_path = '';
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 3. FIX RLS POLICIES WITH USING(true) / WITH CHECK(true)
-- ────────────────────────────────────────────────────────────

-- 3a. availability and meetings ────────────────────────────
-- Hash-link reads and guest participation are routed through the
-- API, which verifies the calendar hash and uses supabaseAdmin.
-- No direct Data API role can read or mutate these tables.
DROP POLICY IF EXISTS "Availability is viewable for accessible calendars" ON public.availability;
DROP POLICY IF EXISTS "Users can insert availability" ON public.availability;
DROP POLICY IF EXISTS "Users can update availability" ON public.availability;
DROP POLICY IF EXISTS "Users can delete availability" ON public.availability;
DROP POLICY IF EXISTS "Deny direct client access to availability" ON public.availability;
CREATE POLICY "Deny direct client access to availability" ON public.availability
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL PRIVILEGES ON TABLE public.availability FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.availability TO service_role;

DROP POLICY IF EXISTS "Meetings viewable for calendar members" ON public.meetings;
DROP POLICY IF EXISTS "Authenticated users can create meetings" ON public.meetings;
DROP POLICY IF EXISTS "Users can update meetings" ON public.meetings;
DROP POLICY IF EXISTS "Users can delete meetings" ON public.meetings;
DROP POLICY IF EXISTS "Deny direct client access to meetings" ON public.meetings;
CREATE POLICY "Deny direct client access to meetings" ON public.meetings
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL PRIVILEGES ON TABLE public.meetings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.meetings TO service_role;

-- 3b. users ─────────────────────────────────────────────────
-- Profile reads stay subject to the own/admin SELECT policy. Profile
-- creation and edits go through authenticated API routes using service role.
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;
DROP POLICY IF EXISTS "Service role can insert profiles" ON public.users;
DROP POLICY IF EXISTS "Deny direct client writes to user profiles" ON public.users;
CREATE POLICY "Deny direct client writes to user profiles" ON public.users
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL PRIVILEGES ON TABLE public.users FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.users TO service_role;

-- 3c. wallet_challenges ─────────────────────────────────────
-- "Service role manages wallet challenges" uses FOR ALL
-- USING(true) WITH CHECK(true), giving everyone full access.
-- service_role bypasses RLS, so drop the policy — only the
-- backend can manage challenges.
DROP POLICY IF EXISTS "Service role manages wallet challenges" ON public.wallet_challenges;


-- END SOURCE: 012_security_hardening.sql

-- BEGIN SOURCE: 019_optimize_rls_policies.sql
-- Optimize authenticated RLS policies so Supabase auth helpers are evaluated
-- once per statement instead of once per candidate row.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
REVOKE CREATE ON SCHEMA private FROM authenticated;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.current_user_has_role(check_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = (SELECT auth.uid())
      AND roles @> to_jsonb(check_role)
  );
$$;

REVOKE ALL ON FUNCTION private.current_user_has_role(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.current_user_has_role(TEXT) TO authenticated, service_role;

DO $migration$
DECLARE
  policy_record RECORD;
  optimized_qual TEXT;
  optimized_check TEXT;
  alter_statement TEXT;
BEGIN
  FOR policy_record IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        COALESCE(qual, '') ~ 'auth\.(uid|jwt|role|email)\(\)'
        OR COALESCE(with_check, '') ~ 'auth\.(uid|jwt|role|email)\(\)'
      )
      AND COALESCE(qual, '') !~ '\( SELECT auth\.(uid|jwt|role|email)\(\)'
      AND COALESCE(with_check, '') !~ '\( SELECT auth\.(uid|jwt|role|email)\(\)'
  LOOP
    optimized_qual := policy_record.qual;
    optimized_check := policy_record.with_check;

    IF optimized_qual IS NOT NULL THEN
      optimized_qual := regexp_replace(
        optimized_qual,
        'auth\.(uid|jwt|role|email)\(\)',
        '(SELECT auth.\1())',
        'g'
      );
    END IF;

    IF optimized_check IS NOT NULL THEN
      optimized_check := regexp_replace(
        optimized_check,
        'auth\.(uid|jwt|role|email)\(\)',
        '(SELECT auth.\1())',
        'g'
      );
    END IF;

    alter_statement := format(
      'ALTER POLICY %I ON %I.%I TO authenticated',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );

    IF optimized_qual IS NOT NULL THEN
      alter_statement := alter_statement || format(' USING (%s)', optimized_qual);
    END IF;

    IF optimized_check IS NOT NULL THEN
      alter_statement := alter_statement || format(' WITH CHECK (%s)', optimized_check);
    END IF;

    EXECUTE alter_statement;
  END LOOP;
END
$migration$;

-- Consolidate SELECT policies that grant overlapping access. PostgreSQL ORs
-- permissive policies, so each replacement keeps the same combined predicate.

DROP POLICY IF EXISTS "Users can view own profile" ON public.users;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.users;
DROP POLICY IF EXISTS "Users or admins can view profiles" ON public.users;
CREATE POLICY "Users or admins can view profiles" ON public.users
  FOR SELECT TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR private.current_user_has_role('admin')
  );

DROP POLICY IF EXISTS "Users view own feedback" ON public.feedback;
DROP POLICY IF EXISTS "Admins view all feedback" ON public.feedback;
DROP POLICY IF EXISTS "Admin users can view all feedback" ON public.feedback;
DROP POLICY IF EXISTS "Users or admins view feedback" ON public.feedback;
CREATE POLICY "Users or admins view feedback" ON public.feedback
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR private.current_user_has_role('admin')
  );

DROP POLICY IF EXISTS "Users view own ai feedback" ON public.ai_feedback;
DROP POLICY IF EXISTS "Admins view all ai feedback" ON public.ai_feedback;
DROP POLICY IF EXISTS "Oversight view all ai feedback" ON public.ai_feedback;
DROP POLICY IF EXISTS "Users, admins, or oversight view ai feedback" ON public.ai_feedback;
CREATE POLICY "Users, admins, or oversight view ai feedback" ON public.ai_feedback
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR private.current_user_has_role('admin')
    OR private.current_user_has_role('oversight')
  );

DROP POLICY IF EXISTS "Senders manage own invites" ON public.connection_invites;
DROP POLICY IF EXISTS "Recipients view own invites" ON public.connection_invites;
DROP POLICY IF EXISTS "Participants view own invites" ON public.connection_invites;
DROP POLICY IF EXISTS "Senders insert own invites" ON public.connection_invites;
DROP POLICY IF EXISTS "Senders update own invites" ON public.connection_invites;
DROP POLICY IF EXISTS "Senders delete own invites" ON public.connection_invites;
CREATE POLICY "Participants view own invites" ON public.connection_invites
  FOR SELECT TO authenticated
  USING (
    sender_user_id = (SELECT auth.uid())
    OR used_by_user_id = (SELECT auth.uid())
  );
CREATE POLICY "Senders insert own invites" ON public.connection_invites
  FOR INSERT TO authenticated
  WITH CHECK (sender_user_id = (SELECT auth.uid()));
CREATE POLICY "Senders update own invites" ON public.connection_invites
  FOR UPDATE TO authenticated
  USING (sender_user_id = (SELECT auth.uid()))
  WITH CHECK (sender_user_id = (SELECT auth.uid()));
CREATE POLICY "Senders delete own invites" ON public.connection_invites
  FOR DELETE TO authenticated
  USING (sender_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can manage own events" ON public.user_events;
DROP POLICY IF EXISTS "Public events are viewable" ON public.user_events;
DROP POLICY IF EXISTS "Public or owned events are viewable" ON public.user_events;
DROP POLICY IF EXISTS "Users can insert own events" ON public.user_events;
DROP POLICY IF EXISTS "Users can update own events" ON public.user_events;
DROP POLICY IF EXISTS "Users can delete own events" ON public.user_events;
CREATE POLICY "Public or owned events are viewable" ON public.user_events
  FOR SELECT TO public
  USING (
    is_public = TRUE
    OR user_id = (SELECT auth.uid())
  );
CREATE POLICY "Users can insert own events" ON public.user_events
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can update own events" ON public.user_events
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can delete own events" ON public.user_events
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Remove both historical generations before installing one policy per command.
DROP POLICY IF EXISTS "Admins update feedback responses" ON public.feedback_responses;
DROP POLICY IF EXISTS "Admins update own responses" ON public.feedback_responses;
DROP POLICY IF EXISTS "Admins delete feedback responses" ON public.feedback_responses;
DROP POLICY IF EXISTS "Admins delete own responses" ON public.feedback_responses;
CREATE POLICY "Admins update own responses" ON public.feedback_responses
  FOR UPDATE TO authenticated
  USING (
    admin_id = (SELECT auth.uid())
    AND private.current_user_has_role('admin')
  )
  WITH CHECK (
    admin_id = (SELECT auth.uid())
    AND private.current_user_has_role('admin')
  );
CREATE POLICY "Admins delete own responses" ON public.feedback_responses
  FOR DELETE TO authenticated
  USING (
    admin_id = (SELECT auth.uid())
    AND private.current_user_has_role('admin')
  );

DROP INDEX IF EXISTS public.idx_dm_calendar_invites_discord_user;
-- END SOURCE: 019_optimize_rls_policies.sql

-- BEGIN SOURCE: 029_database_advisor_hardening.sql
-- Run as the database owner after the mailbox and 019 RLS migrations.
-- Keep private out of the Supabase Data API exposed schemas.
BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
REVOKE CREATE ON SCHEMA private FROM authenticated;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

DO $migration$
BEGIN
  IF to_regprocedure('public.current_user_has_role(text)') IS NOT NULL THEN
    IF to_regprocedure('private.current_user_has_role(text)') IS NOT NULL THEN
      RAISE EXCEPTION 'Both public and private role helpers exist; resolve dependencies before migrating';
    END IF;
    -- Moving the existing object preserves the OID referenced by RLS policies.
    ALTER FUNCTION public.current_user_has_role(TEXT) SET SCHEMA private;
  ELSIF to_regprocedure('private.current_user_has_role(text)') IS NULL THEN
    RAISE EXCEPTION 'Role helper missing; apply 019_optimize_rls_policies.sql first';
  END IF;
END
$migration$;

CREATE OR REPLACE FUNCTION private.current_user_has_role(check_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = (SELECT auth.uid())
      AND roles @> to_jsonb(check_role)
  );
$$;

REVOKE ALL ON FUNCTION private.current_user_has_role(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.current_user_has_role(TEXT) TO authenticated, service_role;

ALTER FUNCTION public.set_first_mail_account_primary() SET search_path = '';

CREATE SCHEMA IF NOT EXISTS extensions;
REVOKE CREATE ON SCHEMA extensions FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

DO $migration$
DECLARE
  extension_schema TEXT;
  extension_relocatable BOOLEAN;
BEGIN
  SELECT n.nspname, e.extrelocatable
    INTO extension_schema, extension_relocatable
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pg_trgm';

  IF extension_schema IS NULL THEN
    RAISE EXCEPTION 'pg_trgm missing; apply the mailbox feature schema first';
  END IF;
  IF extension_schema <> 'extensions' THEN
    IF NOT extension_relocatable THEN
      RAISE EXCEPTION 'Installed pg_trgm is not relocatable';
    END IF;
    ALTER EXTENSION pg_trgm SET SCHEMA extensions;
  END IF;
END
$migration$;

COMMIT;
-- END SOURCE: 029_database_advisor_hardening.sql


-- ============================================================
-- BEGIN SOURCE: 034_enable_rls_missing_tables.sql
-- ============================================================
-- 034_enable_rls_missing_tables.sql
-- Enable Row Level Security on all public tables flagged by the Supabase linter.

-- ============================================================
-- 1. email_contacts  (owner_user_id)
-- ============================================================
ALTER TABLE public.email_contacts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'email_contacts' AND policyname = 'Users manage own email contacts') THEN
    CREATE POLICY "Users manage own email contacts" ON public.email_contacts
      FOR ALL USING (auth.uid() = owner_user_id);
  END IF;
END $$;

-- ============================================================
-- 2. notification_preferences  (user_id)
-- ============================================================
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notification_preferences' AND policyname = 'Users manage own notification preferences') THEN
    CREATE POLICY "Users manage own notification preferences" ON public.notification_preferences
      FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

-- ============================================================
-- 3. privacy_settings  (user_id)
-- ============================================================
ALTER TABLE public.privacy_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'privacy_settings' AND policyname = 'Users manage own privacy settings') THEN
    CREATE POLICY "Users manage own privacy settings" ON public.privacy_settings
      FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

-- ============================================================
-- 4. connection_invites  (sender_user_id / used_by_user_id)
-- ============================================================
ALTER TABLE public.connection_invites ENABLE ROW LEVEL SECURITY;

-- Senders can view and manage their own invites
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'connection_invites' AND policyname = 'Senders manage own invites') THEN
    CREATE POLICY "Senders manage own invites" ON public.connection_invites
      FOR ALL USING (auth.uid() = sender_user_id);
  END IF;
END $$;

-- Recipients can view invites used by them
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'connection_invites' AND policyname = 'Recipients view own invites') THEN
    CREATE POLICY "Recipients view own invites" ON public.connection_invites
      FOR SELECT USING (auth.uid() = used_by_user_id);
  END IF;
END $$;

-- ============================================================
-- 5. user_connections  (user_a_id / user_b_id)
-- ============================================================
ALTER TABLE public.user_connections ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_connections' AND policyname = 'Users manage own connections') THEN
    CREATE POLICY "Users manage own connections" ON public.user_connections
      FOR ALL USING (auth.uid() = user_a_id OR auth.uid() = user_b_id);
  END IF;
END $$;

-- ============================================================
-- 6. email_opt_outs  (sender_user_id)
-- ============================================================
ALTER TABLE public.email_opt_outs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'email_opt_outs' AND policyname = 'Users manage own email opt outs') THEN
    CREATE POLICY "Users manage own email opt outs" ON public.email_opt_outs
      FOR ALL USING (auth.uid() = sender_user_id);
  END IF;
END $$;

-- ============================================================
-- 7. email_verification_timeouts  (service-role only)
-- ============================================================
-- No user-facing policies: this table is accessed only via service role.
-- RLS is enabled so the linter is satisfied; service_role bypasses RLS.
ALTER TABLE public.email_verification_timeouts ENABLE ROW LEVEL SECURITY;


-- END SOURCE: 034_enable_rls_missing_tables.sql

-- ============================================================
-- BEGIN SOURCE: 035_fix_search_path_and_permissive_policies.sql
-- ============================================================
-- 035_fix_search_path_and_permissive_policies.sql
-- Fix Supabase linter warnings:
--   1. Set search_path on 6 functions (function_search_path_mutable)
--   2. Replace overly permissive RLS policies (rls_policy_always_true)

-- ============================================================
-- 1. Fix mutable search_path on functions
--    Re-create each function with SET search_path = ''
-- ============================================================

-- 1b. cleanup_expired_invites
CREATE OR REPLACE FUNCTION public.cleanup_expired_invites()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.connection_invites
  WHERE status = 'pending'
    AND created_at < NOW() - INTERVAL '48 hours';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- 1c. grant_moderator_role
CREATE OR REPLACE FUNCTION public.grant_moderator_role(target_user_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE public.users
  SET roles = CASE
    WHEN roles IS NULL THEN '["moderator", "user"]'::jsonb
    WHEN NOT (roles @> '"moderator"'::jsonb) THEN roles || '"moderator"'::jsonb
    ELSE roles
  END
  WHERE id = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- 1d. update_user_smtp_configs_updated_at
CREATE OR REPLACE FUNCTION public.update_user_smtp_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- 1e. revoke_moderator_role
CREATE OR REPLACE FUNCTION public.revoke_moderator_role(target_user_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE public.users
  SET roles = roles - 'moderator'
  WHERE id = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- ============================================================
-- 2. Fix overly permissive RLS policies
--    These tables are accessed via supabaseAdmin (service role)
--    which bypasses RLS. Replace USING(true) with restrictive
--    policies so direct client access is locked down.
-- ============================================================

-- 2a. governance_ratings
--     Anonymous UUIDs are not in auth.users, so auth.uid() won't match.
--     Service role bypasses RLS. Deny all direct client access.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'governance_ratings') THEN
    DROP POLICY IF EXISTS "Users manage own governance ratings" ON public.governance_ratings;

    CREATE POLICY "Deny direct client access to governance ratings" ON public.governance_ratings
      FOR ALL USING (false);
  END IF;
END $$;

-- 2b. governance_facilitator_sentiments
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'governance_facilitator_sentiments') THEN
    DROP POLICY IF EXISTS "Users manage own facilitator sentiments" ON public.governance_facilitator_sentiments;

    CREATE POLICY "Deny direct client access to facilitator sentiments" ON public.governance_facilitator_sentiments
      FOR ALL USING (false);
  END IF;
END $$;


-- END SOURCE: 035_fix_search_path_and_permissive_policies.sql

-- ============================================================
-- BEGIN SOURCE: 036_rls_deny_service_only_tables.sql
-- ============================================================
-- 036_rls_deny_service_only_tables.sql
-- Fix Supabase linter warning: rls_enabled_no_policy
-- These tables are accessed exclusively via service_role (which bypasses RLS).
-- Adding explicit USING(false) policies locks out direct client/anon access
-- and satisfies the linter requirement for at least one policy per RLS-enabled table.

-- ============================================================
-- 1. calendar_syncs
-- ============================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'calendar_syncs') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'calendar_syncs' AND schemaname = 'public') THEN
      CREATE POLICY "Deny direct client access to calendar syncs" ON public.calendar_syncs
        FOR ALL USING (false);
    END IF;
  END IF;
END $$;

-- ============================================================
-- 2. discord_channels
-- ============================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'discord_channels') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'discord_channels' AND schemaname = 'public') THEN
      CREATE POLICY "Deny direct client access to discord channels" ON public.discord_channels
        FOR ALL USING (false);
    END IF;
  END IF;
END $$;

-- ============================================================
-- 3. dm_first_contacts
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'dm_first_contacts' AND schemaname = 'public') THEN
    CREATE POLICY "Deny direct client access to dm first contacts" ON public.dm_first_contacts
      FOR ALL USING (false);
  END IF;
END $$;

-- ============================================================
-- 4. dm_opt_outs
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'dm_opt_outs' AND schemaname = 'public') THEN
    CREATE POLICY "Deny direct client access to dm opt outs" ON public.dm_opt_outs
      FOR ALL USING (false);
  END IF;
END $$;

-- ============================================================
-- 5. email_verification_timeouts
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'email_verification_timeouts' AND schemaname = 'public') THEN
    CREATE POLICY "Deny direct client access to email verification timeouts" ON public.email_verification_timeouts
      FOR ALL USING (false);
  END IF;
END $$;

-- ============================================================
-- 6. events
-- ============================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'events') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'events' AND schemaname = 'public') THEN
      CREATE POLICY "Deny direct client access to events" ON public.events
        FOR ALL USING (false);
    END IF;
  END IF;
END $$;

-- ============================================================
-- 7. notifications
-- ============================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'notifications') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND schemaname = 'public') THEN
      CREATE POLICY "Deny direct client access to notifications" ON public.notifications
        FOR ALL USING (false);
    END IF;
  END IF;
END $$;

-- ============================================================
-- 8. wallet_challenges
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'wallet_challenges' AND schemaname = 'public') THEN
    CREATE POLICY "Deny direct client access to wallet challenges" ON public.wallet_challenges
      FOR ALL USING (false);
  END IF;
END $$;


-- END SOURCE: 036_rls_deny_service_only_tables.sql

-- ============================================================
-- BEGIN SOURCE: 056_security_hardening_round2.sql
-- ============================================================
-- ============================================================
-- Security hardening round 2:
--   1. Explicit deny-all RLS policies on dm_opt_ins, dm_calendar_invites
--   2. Create ai_prompt_usage table for database-backed rate limiting
-- ============================================================

-- ── 1. Deny-all RLS policies (service-role bypasses; anon/user role blocked) ──

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'dm_opt_ins' AND policyname = 'dm_opt_ins_deny_all') THEN
    CREATE POLICY "dm_opt_ins_deny_all" ON dm_opt_ins FOR ALL USING (false);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'dm_calendar_invites' AND policyname = 'dm_calendar_invites_deny_all') THEN
    CREATE POLICY "dm_calendar_invites_deny_all" ON dm_calendar_invites FOR ALL USING (false);
  END IF;
END $$;

-- ── 2. AI prompt usage table for database-backed daily rate limiting ──

CREATE TABLE IF NOT EXISTS ai_prompt_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast daily count queries (user_id + created_at)
CREATE INDEX IF NOT EXISTS idx_ai_prompt_usage_user_day
  ON ai_prompt_usage(user_id, created_at DESC);

-- Cleanup: auto-delete rows older than 90 days to prevent unbounded growth
-- (Run periodically via cron or Supabase Edge Function)
COMMENT ON TABLE ai_prompt_usage IS 'Tracks per-user AI prompt usage for daily rate limiting. Rows older than 90 days can be safely deleted.';

-- Enable RLS + deny-all (only accessed via service role from backend)
ALTER TABLE ai_prompt_usage ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ai_prompt_usage' AND policyname = 'ai_prompt_usage_deny_all') THEN
    CREATE POLICY "ai_prompt_usage_deny_all" ON ai_prompt_usage FOR ALL USING (false);
  END IF;
END $$;

-- ── 3. Per-feature usage category, so each AI feature (chat, mailbox
--      assessment, etc.) gets its own independent daily quota instead of
--      sharing one global counter. Existing rows default to 'chat'. ──

ALTER TABLE ai_prompt_usage
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'chat';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_prompt_usage_category_check') THEN
    ALTER TABLE ai_prompt_usage
      ADD CONSTRAINT ai_prompt_usage_category_check
      CHECK (category IN ('chat', 'mailbox_assessment'));
  END IF;
END $$;

-- Add 'mailbox_draft' (AI reply-draft generation) to the allowed categories.
ALTER TABLE ai_prompt_usage DROP CONSTRAINT IF EXISTS ai_prompt_usage_category_check;
ALTER TABLE ai_prompt_usage ADD CONSTRAINT ai_prompt_usage_category_check
  CHECK (category IN ('chat', 'mailbox_assessment', 'mailbox_draft'));

DROP INDEX IF EXISTS idx_ai_prompt_usage_user_day;
CREATE INDEX IF NOT EXISTS idx_ai_prompt_usage_user_category_day
  ON ai_prompt_usage(user_id, category, created_at DESC);


-- END SOURCE: 056_security_hardening_round2.sql

-- ============================================================
-- BEGIN SOURCE: 057_network_relations_rls_write_deny.sql
-- ============================================================
-- 057: Fix incomplete RLS on network_relations tables.
-- Migration 049 only added FOR SELECT deny policies, leaving INSERT/UPDATE/DELETE
-- unprotected for direct anon/authenticated role access. Add explicit deny-all
-- for all write operations. Service role (supabaseAdmin) bypasses RLS and
-- continues to work normally.
--
-- Guard: each block checks whether the table exists before touching it so this
-- migration is idempotent regardless of whether 049 has been applied.

-- networks
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'networks') THEN
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'networks' AND policyname = 'networks_deny_all') THEN
      DROP POLICY "networks_deny_all" ON public.networks;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'networks' AND policyname = 'networks_deny_all') THEN
      CREATE POLICY "networks_deny_all" ON public.networks FOR ALL USING (false) WITH CHECK (false);
    END IF;
  END IF;
END $$;

-- network_mappings
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'network_mappings') THEN
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'network_mappings' AND policyname = 'network_mappings_deny_all') THEN
      DROP POLICY "network_mappings_deny_all" ON public.network_mappings;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'network_mappings' AND policyname = 'network_mappings_deny_all') THEN
      CREATE POLICY "network_mappings_deny_all" ON public.network_mappings FOR ALL USING (false) WITH CHECK (false);
    END IF;
  END IF;
END $$;

-- network_rules
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'network_rules') THEN
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'network_rules' AND policyname = 'network_rules_deny_all') THEN
      DROP POLICY "network_rules_deny_all" ON public.network_rules;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'network_rules' AND policyname = 'network_rules_deny_all') THEN
      CREATE POLICY "network_rules_deny_all" ON public.network_rules FOR ALL USING (false) WITH CHECK (false);
    END IF;
  END IF;
END $$;


-- END SOURCE: 057_network_relations_rls_write_deny.sql

-- ============================================================
-- BEGIN SOURCE: 064_security_hardening_round3.sql
-- ============================================================
-- ============================================================
-- 064: Security hardening round 3
--   Fixes Supabase database linter warnings (May 2026 scan):
--     1. function_search_path_mutable on 3 governance trigger fns
--     2. rls_policy_always_true on governance_sessions
--     3. anon/authenticated EXECUTE on 6 SECURITY DEFINER fns
--
--   Manual (dashboard-only, NOT in this migration):
--     - auth_leaked_password_protection: enable HaveIBeenPwned check
--       Supabase Dashboard > Authentication > Providers > Email >
--       "Leaked Password Protection" toggle
-- ============================================================

-- ── 1. Set search_path on governance trigger functions ─────────

CREATE OR REPLACE FUNCTION public.update_governance_chart_questions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

CREATE OR REPLACE FUNCTION public.update_governance_statements_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

CREATE OR REPLACE FUNCTION public.update_governance_chart_findings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- ── 2. Replace permissive governance_sessions policy ───────────
-- Table is accessed exclusively via supabaseAdmin (service role),
-- which bypasses RLS. Replace USING(true) with deny-all so direct
-- anon/authenticated client access is blocked.

DROP POLICY IF EXISTS "Service role full access to governance_sessions" ON public.governance_sessions;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'governance_sessions'
      AND policyname = 'governance_sessions_deny_all'
  ) THEN
    CREATE POLICY "governance_sessions_deny_all" ON public.governance_sessions
      FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

-- ── 3. Revoke EXECUTE on SECURITY DEFINER fns from public roles ─
-- These functions are intended to be called from backend service
-- code (supabaseAdmin) only. Revoking from anon + authenticated
-- prevents direct invocation via PostgREST /rest/v1/rpc/*.
-- service_role retains EXECUTE via default grants.

REVOKE EXECUTE ON FUNCTION public.cleanup_expired_invites() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_travelers() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_wallet_challenges() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.grant_moderator_role(target_user_id UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revoke_moderator_role(target_user_id UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.user_has_role(uid UUID, check_role TEXT) FROM PUBLIC, anon, authenticated;


-- END SOURCE: 064_security_hardening_round3.sql

-- ============================================================
-- BEGIN SOURCE: 069_revoke_agent_key_usage_from_anon_authenticated.sql
-- ============================================================
-- Migration 069: Revoke increment_agent_key_usage from anon and authenticated
--
-- Migration 065 created `increment_agent_key_usage(uuid)` as SECURITY DEFINER
-- and ran `REVOKE ALL ... FROM PUBLIC`. However, Supabase grants EXECUTE on
-- functions in the `public` schema to the `anon` and `authenticated` roles
-- by default (via role-level default privileges), and those explicit grants
-- are not removed by `REVOKE ... FROM PUBLIC`. The Supabase database linter
-- (lints 0028 / 0029) flags this because the function is callable via
-- `/rest/v1/rpc/increment_agent_key_usage` by any anon or signed-in user.
--
-- The function is only ever invoked by the API using the service role key
-- (see apps/api/src/routes/agent-api.ts), so it is safe -- and required --
-- to remove the anon/authenticated grants.

REVOKE EXECUTE ON FUNCTION public.increment_agent_key_usage(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_agent_key_usage(UUID) FROM authenticated;

-- Defensive: re-revoke PUBLIC and re-grant service_role in case a later
-- migration accidentally re-grants. Idempotent.
REVOKE ALL ON FUNCTION public.increment_agent_key_usage(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_agent_key_usage(UUID) TO service_role;


-- END SOURCE: 069_revoke_agent_key_usage_from_anon_authenticated.sql

-- ============================================================
-- BEGIN SOURCE: 041_deny_direct_user_calendar_access.sql
-- ============================================================
-- Existing hash-link availability/meeting workflows and profile edits
-- are performed by authenticated API routes using supabaseAdmin. The
-- service role bypasses RLS; direct Data API roles receive no write
-- privileges on profiles and no privileges on availability/meetings.

DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;
DROP POLICY IF EXISTS "Service role can insert profiles" ON public.users;
DROP POLICY IF EXISTS "Deny direct client writes to user profiles" ON public.users;
CREATE POLICY "Deny direct client writes to user profiles" ON public.users
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL PRIVILEGES ON TABLE public.users FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.users TO service_role;

DROP POLICY IF EXISTS "Availability is viewable for accessible calendars" ON public.availability;
DROP POLICY IF EXISTS "Users can insert availability" ON public.availability;
DROP POLICY IF EXISTS "Users can update availability" ON public.availability;
DROP POLICY IF EXISTS "Users can delete availability" ON public.availability;
DROP POLICY IF EXISTS "Deny direct client access to availability" ON public.availability;
CREATE POLICY "Deny direct client access to availability" ON public.availability
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL PRIVILEGES ON TABLE public.availability FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.availability TO service_role;

DROP POLICY IF EXISTS "Meetings viewable for calendar members" ON public.meetings;
DROP POLICY IF EXISTS "Authenticated users can create meetings" ON public.meetings;
DROP POLICY IF EXISTS "Users can update meetings" ON public.meetings;
DROP POLICY IF EXISTS "Users can delete meetings" ON public.meetings;
DROP POLICY IF EXISTS "Deny direct client access to meetings" ON public.meetings;
CREATE POLICY "Deny direct client access to meetings" ON public.meetings
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL PRIVILEGES ON TABLE public.meetings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.meetings TO service_role;

DO $$
DECLARE
  table_name TEXT;
  column_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['users', 'availability', 'meetings'] LOOP
    FOR column_name IN
      SELECT attname
      FROM pg_attribute
      WHERE attrelid = format('public.%I', table_name)::regclass
        AND attnum > 0
        AND NOT attisdropped
    LOOP
      EXECUTE format(
        'REVOKE SELECT (%1$I), INSERT (%1$I), UPDATE (%1$I), REFERENCES (%1$I) ON TABLE public.%2$I FROM PUBLIC, anon, authenticated',
        column_name, table_name
      );
    END LOOP;
  END LOOP;
END
$$;

GRANT SELECT ON TABLE public.users TO authenticated;

-- END SOURCE: 041_deny_direct_user_calendar_access.sql
