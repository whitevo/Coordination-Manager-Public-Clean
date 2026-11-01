-- Consolidated feature migration file: feature-misc
-- Generated from incremental files for easier agent navigation.
-- Keep statements idempotent when adding future changes.

-- ============================================================
-- User quick-tool order shared across devices
-- ============================================================

CREATE TABLE IF NOT EXISTS public.quick_tool_preferences (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  tool_keys JSONB NOT NULL DEFAULT '["events-calendar", "calendars", "time-management"]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT quick_tool_preferences_tool_keys_array CHECK (jsonb_typeof(tool_keys) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_quick_tool_preferences_updated_at
  ON public.quick_tool_preferences(updated_at DESC);

ALTER TABLE public.quick_tool_preferences ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'quick_tool_preferences'
      AND policyname = 'Deny direct client access to quick tool preferences'
  ) THEN
    CREATE POLICY "Deny direct client access to quick tool preferences"
      ON public.quick_tool_preferences FOR ALL USING (false);
  END IF;
END $$;

INSERT INTO public.quick_tool_preferences (user_id)
SELECT id FROM public.users
WHERE NOT EXISTS (
  SELECT 1 FROM public.quick_tool_preferences existing
  WHERE existing.user_id = public.users.id
);

-- ============================================================
-- BEGIN SOURCE: 017_admin_powers.sql
-- ============================================================
-- ============================================================
-- Migration 017: Admin Powers & User Silencing
-- Adds:
--   1. is_silenced flag on users table for admin moderation
--   2. silenced_at timestamp to track when user was silenced
--   3. silenced_by to track which admin silenced the user
-- ============================================================

-- Add silencing columns to users table
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_silenced BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS silenced_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS silenced_by UUID DEFAULT NULL;

-- Index for quickly finding silenced users
CREATE INDEX IF NOT EXISTS idx_users_is_silenced ON public.users(is_silenced) WHERE is_silenced = TRUE;

-- Allow admins to read all user profiles (for user list)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'users' AND policyname = 'Admins can view all profiles') THEN
    CREATE POLICY "Admins can view all profiles" ON public.users
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = auth.uid()
          AND u.roles @> '"admin"'::jsonb
        )
      );
  END IF;
END $$;


-- END SOURCE: 017_admin_powers.sql

-- ============================================================
-- BEGIN SOURCE: 072_account_deletion_telemetry.sql
-- ============================================================
-- ============================================================
-- Migration 072: Account Deletion Telemetry
-- Adds service-only telemetry table for account deletion events
-- used by the admin oversight interactions-over-time chart.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.account_deletion_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  account_type TEXT,
  signup_source TEXT,
  had_wallet BOOLEAN NOT NULL DEFAULT false,
  deleted_calendar_count INTEGER NOT NULL DEFAULT 0,
  auth_delete_succeeded BOOLEAN NOT NULL DEFAULT true,
  deleted_by TEXT NOT NULL DEFAULT 'self-service',
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_deletion_events_deleted_at
  ON public.account_deletion_events(deleted_at);

CREATE INDEX IF NOT EXISTS idx_account_deletion_events_deleted_by
  ON public.account_deletion_events(deleted_by);

ALTER TABLE public.account_deletion_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'account_deletion_events'
      AND schemaname = 'public'
      AND policyname = 'Deny direct client access to account deletion telemetry'
  ) THEN
    CREATE POLICY "Deny direct client access to account deletion telemetry"
      ON public.account_deletion_events
      FOR ALL
      USING (false);
  END IF;
END $$;


-- END SOURCE: 072_account_deletion_telemetry.sql

