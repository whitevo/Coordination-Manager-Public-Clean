-- ============================================================
-- Coordination Manager — Full Database Schema
-- Run this in the Supabase SQL Editor to set up a fresh database.
-- This script is idempotent (safe to run multiple times).
-- This is the core baseline. Run consolidated feature files afterwards
-- for enabled features; see README.md for the Time Management/Google-sync setup.
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. USER PROFILES (linked to Supabase auth.users)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  google_id TEXT,
  timezone TEXT DEFAULT 'UTC',
  default_reminder_minutes INTEGER DEFAULT 30,
  role TEXT DEFAULT 'user' CHECK (role IN ('admin', 'user', 'traveler')),
  account_type TEXT DEFAULT 'google' CHECK (account_type IN ('google', 'traveler', 'cardano', 'managed_cardano')),
  traveler_name TEXT,
  expires_at TIMESTAMP WITH TIME ZONE,
  last_login_at TIMESTAMP WITH TIME ZONE,
  theme_preferences JSONB DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON COLUMN users.theme_preferences IS 'User color theme preferences: mode (light/dark/system), active theme ID, and saved custom themes with full color palettes';

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

-- Browser-bound, single-use mailbox OAuth connections. No provider credentials.
CREATE TABLE IF NOT EXISTS public.mailbox_oauth_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('gmail', 'outlook')),
  browser_token_hash TEXT NOT NULL CHECK (browser_token_hash ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_mailbox_oauth_transactions_expires_at
  ON public.mailbox_oauth_transactions(expires_at);
CREATE INDEX IF NOT EXISTS idx_mailbox_oauth_transactions_user_id
  ON public.mailbox_oauth_transactions(user_id);

ALTER TABLE public.mailbox_oauth_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mailbox_oauth_transactions FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.mailbox_oauth_transactions TO service_role;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mailbox_oauth_transactions'
      AND policyname = 'Deny direct client access to mailbox OAuth transactions'
  ) THEN
    CREATE POLICY "Deny direct client access to mailbox OAuth transactions"
      ON public.mailbox_oauth_transactions FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

-- Unique constraints that allow NULLs
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON public.users(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id_unique ON public.users(google_id) WHERE google_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_expires_at ON public.users(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_account_type ON public.users(account_type);

-- RLS
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'users' AND policyname = 'Users can view own profile') THEN
    CREATE POLICY "Users can view own profile" ON public.users FOR SELECT USING (auth.uid() = id);
  END IF;
END $$;

DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;
DROP POLICY IF EXISTS "Deny direct client writes to user profiles" ON public.users;
CREATE POLICY "Deny direct client writes to user profiles" ON public.users
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL PRIVILEGES ON TABLE public.users FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.users TO service_role;

CREATE TABLE IF NOT EXISTS public.ai_prompt_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'chat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.ai_prompt_usage
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'chat';

ALTER TABLE public.ai_prompt_usage
  DROP CONSTRAINT IF EXISTS ai_prompt_usage_category_check;

ALTER TABLE public.ai_prompt_usage
  ADD CONSTRAINT ai_prompt_usage_category_check
  CHECK (category IN ('chat', 'mailbox_assessment', 'mailbox_draft'));

CREATE INDEX IF NOT EXISTS idx_ai_prompt_usage_user_category_day
  ON public.ai_prompt_usage(user_id, category, created_at DESC);
DROP INDEX IF EXISTS public.idx_ai_prompt_usage_user_day;

COMMENT ON TABLE public.ai_prompt_usage IS 'Tracks per-user AI prompt usage for daily rate limiting. Rows older than 90 days can be safely deleted.';

ALTER TABLE public.ai_prompt_usage ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ai_prompt_usage'
      AND policyname = 'ai_prompt_usage_deny_all'
  ) THEN
    CREATE POLICY "ai_prompt_usage_deny_all" ON public.ai_prompt_usage FOR ALL USING (false);
  END IF;
END $$;

-- ============================================================
-- 26. TIME MANAGEMENT
-- ============================================================

CREATE TABLE IF NOT EXISTS public.time_management_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#2563eb',
  sort_order INTEGER NOT NULL DEFAULT 0,
  font_color TEXT NOT NULL DEFAULT '#ffffff',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tm_categories_user_id
  ON public.time_management_categories(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tm_categories_user_label
  ON public.time_management_categories(user_id, lower(label));

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tm_categories_label_len_chk'
      AND conrelid = 'public.time_management_categories'::regclass
  ) THEN
    ALTER TABLE public.time_management_categories
      ADD CONSTRAINT tm_categories_label_len_chk
      CHECK (char_length(trim(label)) BETWEEN 1 AND 80);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tm_categories_color_hex_chk'
      AND conrelid = 'public.time_management_categories'::regclass
  ) THEN
    ALTER TABLE public.time_management_categories
      ADD CONSTRAINT tm_categories_color_hex_chk
      CHECK (color ~ '^#[0-9A-Fa-f]{6}$');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tm_categories_font_color_hex_chk'
      AND conrelid = 'public.time_management_categories'::regclass
  ) THEN
    ALTER TABLE public.time_management_categories
      ADD CONSTRAINT tm_categories_font_color_hex_chk
      CHECK (font_color ~ '^#[0-9A-Fa-f]{6}$');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tm_categories_sort_order_range_chk'
      AND conrelid = 'public.time_management_categories'::regclass
  ) THEN
    ALTER TABLE public.time_management_categories
      ADD CONSTRAINT tm_categories_sort_order_range_chk
      CHECK (sort_order BETWEEN -10000 AND 10000);
  END IF;
END $$;

ALTER TABLE public.time_management_categories ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'time_management_categories'
      AND policyname = 'Users manage own time-management categories'
  ) THEN
    CREATE POLICY "Users manage own time-management categories"
      ON public.time_management_categories FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trigger_tm_categories_updated_at
  ON public.time_management_categories;
CREATE TRIGGER trigger_tm_categories_updated_at
  BEFORE UPDATE ON public.time_management_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.time_management_prefs (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  main_color TEXT NOT NULL DEFAULT '#2563eb',
  main_label TEXT NOT NULL DEFAULT 'Coordination Manager Main',
  category_color_display_style TEXT NOT NULL DEFAULT 'horizontal',
  active_mode_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tm_prefs_color_hex_chk'
      AND conrelid = 'public.time_management_prefs'::regclass
  ) THEN
    ALTER TABLE public.time_management_prefs
      ADD CONSTRAINT tm_prefs_color_hex_chk
      CHECK (main_color ~ '^#[0-9A-Fa-f]{6}$');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tm_prefs_label_len_chk'
      AND conrelid = 'public.time_management_prefs'::regclass
  ) THEN
    ALTER TABLE public.time_management_prefs
      ADD CONSTRAINT tm_prefs_label_len_chk
      CHECK (char_length(trim(main_label)) BETWEEN 1 AND 80);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tm_prefs_category_color_display_style_chk'
      AND conrelid = 'public.time_management_prefs'::regclass
  ) THEN
    ALTER TABLE public.time_management_prefs
      ADD CONSTRAINT tm_prefs_category_color_display_style_chk
      CHECK (category_color_display_style IN ('horizontal', 'vertical_left', 'vertical_right'));
  END IF;
END $$;

ALTER TABLE public.time_management_prefs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'time_management_prefs'
      AND policyname = 'Users manage own time-management prefs'
  ) THEN
    CREATE POLICY "Users manage own time-management prefs"
      ON public.time_management_prefs FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trigger_tm_prefs_updated_at
  ON public.time_management_prefs;
CREATE TRIGGER trigger_tm_prefs_updated_at
  BEFORE UPDATE ON public.time_management_prefs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.time_management_modes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  main_color TEXT NOT NULL DEFAULT '#2563eb',
  slot_minutes INTEGER NOT NULL DEFAULT 30,
  category_color_display_style TEXT NOT NULL DEFAULT 'horizontal',
  sync_calendars JSONB NOT NULL DEFAULT '[]'::jsonb,
  time_backgrounds JSONB NOT NULL DEFAULT '[]'::jsonb,
  collapsed_background_ids TEXT[] NOT NULL DEFAULT '{}',
  quick_templates JSONB NOT NULL DEFAULT '[]'::jsonb,
  show_quick_templates_in_main BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tm_modes_user_id
  ON public.time_management_modes(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tm_modes_user_name
  ON public.time_management_modes(user_id, lower(name));

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tm_modes_name_len_chk'
      AND conrelid = 'public.time_management_modes'::regclass
  ) THEN
    ALTER TABLE public.time_management_modes
      ADD CONSTRAINT tm_modes_name_len_chk
      CHECK (char_length(trim(name)) BETWEEN 1 AND 80);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tm_modes_color_hex_chk'
      AND conrelid = 'public.time_management_modes'::regclass
  ) THEN
    ALTER TABLE public.time_management_modes
      ADD CONSTRAINT tm_modes_color_hex_chk
      CHECK (main_color ~ '^#[0-9A-Fa-f]{6}$');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tm_modes_category_color_display_style_chk'
      AND conrelid = 'public.time_management_modes'::regclass
  ) THEN
    ALTER TABLE public.time_management_modes
      ADD CONSTRAINT tm_modes_category_color_display_style_chk
      CHECK (category_color_display_style IN ('horizontal', 'vertical_left', 'vertical_right'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tm_modes_slot_minutes_chk'
      AND conrelid = 'public.time_management_modes'::regclass
  ) THEN
    ALTER TABLE public.time_management_modes
      ADD CONSTRAINT tm_modes_slot_minutes_chk
      CHECK (slot_minutes IN (15, 30, 60));
  END IF;
END $$;

ALTER TABLE public.time_management_modes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'time_management_modes'
      AND policyname = 'Users manage own time-management modes'
  ) THEN
    CREATE POLICY "Users manage own time-management modes"
      ON public.time_management_modes FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trigger_tm_modes_updated_at
  ON public.time_management_modes;
CREATE TRIGGER trigger_tm_modes_updated_at
  BEFORE UPDATE ON public.time_management_modes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tm_prefs_active_mode_fk'
      AND conrelid = 'public.time_management_prefs'::regclass
  ) THEN
    ALTER TABLE public.time_management_prefs
      ADD CONSTRAINT tm_prefs_active_mode_fk
      FOREIGN KEY (active_mode_id)
      REFERENCES public.time_management_modes(id)
      ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.user_events
  ADD COLUMN IF NOT EXISTS category_ids UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE public.user_events
  ADD COLUMN IF NOT EXISTS recurrence_rule JSONB DEFAULT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_events_external_upsert
  ON public.user_events(user_id, source_type, source_id, external_event_id);

CREATE INDEX IF NOT EXISTS idx_user_events_category_ids
  ON public.user_events USING GIN (category_ids);

CREATE INDEX IF NOT EXISTS idx_user_events_user_start
  ON public.user_events(user_id, start_time);

-- ============================================================
-- 2. CALENDARS
-- ============================================================

CREATE TABLE IF NOT EXISTS calendars (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hash TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  config JSONB,
  permissions JSONB,
  created_by TEXT,
  visibility TEXT DEFAULT 'unlisted' CHECK (visibility IN ('unlisted', 'public')),
  creator_account_type TEXT DEFAULT 'google',
  archived_at TIMESTAMPTZ,
  listing_expires_at TIMESTAMPTZ,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE IF EXISTS public.calendars ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS public.calendars ADD COLUMN IF NOT EXISTS listing_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_calendars_hash ON calendars(hash);
CREATE INDEX IF NOT EXISTS idx_calendars_visibility ON calendars(visibility) WHERE visibility = 'public';
CREATE INDEX IF NOT EXISTS idx_calendars_archived_at ON calendars(archived_at) WHERE archived_at IS NOT NULL;
COMMENT ON COLUMN public.calendars.archived_at IS 'Set when a public calendar auto-archives (no planned meetings within the listing window). Cleared automatically when a new meeting is planned.';
COMMENT ON COLUMN public.calendars.listing_expires_at IS 'Next check date for the public listing window. NULL means the calendar does not expire.';

-- RLS (hash-based access — broader policies, app layer enforces via hash)
ALTER TABLE public.calendars ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'calendars' AND policyname = 'Public calendars are viewable') THEN
    CREATE POLICY "Public calendars are viewable"
    ON public.calendars FOR SELECT
    USING (visibility = 'public' OR visibility = 'unlisted');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'calendars' AND policyname = 'Authenticated users can create calendars') THEN
    CREATE POLICY "Authenticated users can create calendars"
    ON public.calendars FOR INSERT TO authenticated
    WITH CHECK (created_by = auth.uid()::text);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'calendars' AND policyname = 'Creator can update own calendars') THEN
    CREATE POLICY "Creator can update own calendars"
    ON public.calendars FOR UPDATE TO authenticated
    USING (created_by = auth.uid()::text);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'calendars' AND policyname = 'Creator can delete own calendars') THEN
    CREATE POLICY "Creator can delete own calendars"
    ON public.calendars FOR DELETE TO authenticated
    USING (created_by = auth.uid()::text);
  END IF;
END $$;

COMMENT ON POLICY "Public calendars are viewable" ON public.calendars IS 'Allow reading calendars that are public or unlisted (hash-gated at app layer)';
COMMENT ON POLICY "Creator can update own calendars" ON public.calendars IS 'Only the calendar creator can modify it';
COMMENT ON POLICY "Creator can delete own calendars" ON public.calendars IS 'Only the calendar creator can delete it';

-- ============================================================
-- 3. AVAILABILITY
-- ============================================================

CREATE TABLE IF NOT EXISTS availability (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  calendar_id UUID REFERENCES calendars(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  time_slots JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(calendar_id, username)
);

CREATE INDEX IF NOT EXISTS idx_availability_calendar_id ON availability(calendar_id);

-- RLS (direct availability access is API-only; the API verifies hash links)
ALTER TABLE public.availability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Availability is viewable for accessible calendars" ON public.availability;
DROP POLICY IF EXISTS "Users can insert availability" ON public.availability;
DROP POLICY IF EXISTS "Users can update availability" ON public.availability;
DROP POLICY IF EXISTS "Users can delete availability" ON public.availability;
DROP POLICY IF EXISTS "Deny direct client access to availability" ON public.availability;
CREATE POLICY "Deny direct client access to availability" ON public.availability
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL PRIVILEGES ON TABLE public.availability FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.availability TO service_role;

-- ============================================================
-- 4. MEETINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS meetings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  calendar_id UUID REFERENCES calendars(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,
  duration_minutes INTEGER NOT NULL,
  meeting_link TEXT,
  created_by TEXT,
  time_slots JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meetings_calendar_id ON meetings(calendar_id);

-- RLS (direct meeting access is API-only; the API verifies hash links)
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Meetings viewable for calendar members" ON public.meetings;
DROP POLICY IF EXISTS "Authenticated users can create meetings" ON public.meetings;
DROP POLICY IF EXISTS "Users can update meetings" ON public.meetings;
DROP POLICY IF EXISTS "Users can delete meetings" ON public.meetings;
DROP POLICY IF EXISTS "Deny direct client access to meetings" ON public.meetings;
CREATE POLICY "Deny direct client access to meetings" ON public.meetings
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL PRIVILEGES ON TABLE public.meetings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.meetings TO service_role;

-- ============================================================
-- 5. CALENDAR SOURCES (external calendar connections)
-- ============================================================

DO $$ BEGIN
  CREATE TYPE calendar_source_type AS ENUM ('google_oauth', 'google_public_url');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.calendar_sources (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type calendar_source_type NOT NULL,
  google_email TEXT,
  google_access_token TEXT,
  google_refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  public_url TEXT,
  display_name TEXT NOT NULL,
  color TEXT DEFAULT '#3B82F6',
  is_active BOOLEAN DEFAULT TRUE,
  last_synced TIMESTAMPTZ,
  sync_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendar_sources_user_id ON public.calendar_sources(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_sources_google_email
  ON public.calendar_sources(user_id, google_email) WHERE source_type = 'google_oauth';
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_sources_public_url
  ON public.calendar_sources(user_id, public_url) WHERE source_type = 'google_public_url';

-- RLS for calendar_sources
ALTER TABLE public.calendar_sources ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'calendar_sources' AND policyname = 'Users can view own calendar sources') THEN
    CREATE POLICY "Users can view own calendar sources" ON public.calendar_sources FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'calendar_sources' AND policyname = 'Users can insert own calendar sources') THEN
    CREATE POLICY "Users can insert own calendar sources" ON public.calendar_sources FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'calendar_sources' AND policyname = 'Users can update own calendar sources') THEN
    CREATE POLICY "Users can update own calendar sources" ON public.calendar_sources FOR UPDATE USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'calendar_sources' AND policyname = 'Users can delete own calendar sources') THEN
    CREATE POLICY "Users can delete own calendar sources" ON public.calendar_sources FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;

-- ============================================================
-- 6. DISCORD INTEGRATIONS (user ↔ Discord link)
-- ============================================================

CREATE TABLE IF NOT EXISTS discord_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Custom key the user shares with the bot via DM to authenticate
  link_key TEXT UNIQUE NOT NULL,
  link_key_expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),

  -- Populated after user authenticates via Discord OAuth2
  discord_user_id TEXT,
  discord_username TEXT,
  discord_avatar TEXT,

  -- Populated after bot verifies the link_key
  bot_verified BOOLEAN DEFAULT FALSE,
  bot_verified_at TIMESTAMPTZ,

  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_discord_integrations_user
  ON discord_integrations(user_id) WHERE is_active = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_discord_integrations_discord_user
  ON discord_integrations(discord_user_id) WHERE discord_user_id IS NOT NULL AND is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_discord_integrations_link_key
  ON discord_integrations(link_key);

ALTER TABLE discord_integrations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'discord_integrations' AND policyname = 'Users manage own discord integrations') THEN
    CREATE POLICY "Users manage own discord integrations" ON discord_integrations FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

COMMENT ON TABLE discord_integrations IS 'Links platform users to their Discord accounts via the Swarm Coordinator bot';

-- ============================================================
-- 7. DISCORD GUILD CHANNELS (servers + channels the bot has access to)
-- ============================================================

CREATE TABLE IF NOT EXISTS discord_guild_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which user added this channel mapping
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES discord_integrations(id) ON DELETE CASCADE,

  -- Discord IDs
  guild_id TEXT NOT NULL,
  guild_name TEXT NOT NULL,
  guild_icon TEXT,
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,

  -- User-defined label for this channel (e.g. "Raid Announcements")
  label TEXT,

  -- Permission tracking
  bot_can_send BOOLEAN DEFAULT TRUE,
  user_can_send BOOLEAN DEFAULT TRUE,

  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, guild_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_discord_guild_channels_user
  ON discord_guild_channels(user_id);
CREATE INDEX IF NOT EXISTS idx_discord_guild_channels_integration
  ON discord_guild_channels(integration_id);

ALTER TABLE discord_guild_channels ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'discord_guild_channels' AND policyname = 'Users manage own guild channels') THEN
    CREATE POLICY "Users manage own guild channels" ON discord_guild_channels FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

COMMENT ON TABLE discord_guild_channels IS 'Discord server channels the user has enabled for announcements';
COMMENT ON COLUMN discord_guild_channels.bot_can_send IS 'Whether the bot has SendMessages permission in this channel';
COMMENT ON COLUMN discord_guild_channels.user_can_send IS 'Whether the linked Discord user has SendMessages permission in this channel';

-- ============================================================
-- 8. ANNOUNCEMENT TEMPLATES (reusable message content)
-- ============================================================

CREATE TABLE IF NOT EXISTS announcement_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  title TEXT NOT NULL,
  body TEXT NOT NULL,

  -- Optional: linked calendar for meeting-related announcements
  calendar_id UUID REFERENCES calendars(id) ON DELETE SET NULL,

  -- Tags for filtering / grouping
  tags TEXT[] DEFAULT '{}',

  is_archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_announcement_templates_user
  ON announcement_templates(user_id);

ALTER TABLE announcement_templates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'announcement_templates' AND policyname = 'Users manage own templates') THEN
    CREATE POLICY "Users manage own templates" ON announcement_templates FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

COMMENT ON TABLE announcement_templates IS 'Reusable announcement message templates';

-- ============================================================
-- 9. ANNOUNCEMENT SCHEDULES (when to send)
-- ============================================================

CREATE TABLE IF NOT EXISTS announcement_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id UUID REFERENCES announcement_templates(id) ON DELETE SET NULL,

  -- Schedule info
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  timezone TEXT DEFAULT 'UTC',

  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'cancelled')),

  -- Where to send (array of channel references)
  -- Each entry: { "type": "discord_channel" | "discord_dm", "target_id": "...", "label": "..." }
  targets JSONB NOT NULL DEFAULT '[]',

  sent_at TIMESTAMPTZ,
  error_message TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_announcement_schedules_user
  ON announcement_schedules(user_id);
CREATE INDEX IF NOT EXISTS idx_announcement_schedules_status
  ON announcement_schedules(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_announcement_schedules_scheduled_at
  ON announcement_schedules(scheduled_at) WHERE status = 'pending';

ALTER TABLE announcement_schedules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'announcement_schedules' AND policyname = 'Users manage own schedules') THEN
    CREATE POLICY "Users manage own schedules" ON announcement_schedules FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

COMMENT ON TABLE announcement_schedules IS 'Scheduled announcement deliveries with target channels';

-- ============================================================
-- 10. ANNOUNCEMENT DELIVERY LOG (per-target delivery tracking)
-- ============================================================

CREATE TABLE IF NOT EXISTS announcement_delivery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES announcement_schedules(id) ON DELETE CASCADE,

  -- Target info
  channel_type TEXT NOT NULL, -- 'discord_channel', 'discord_dm', 'email', etc.
  target_id TEXT NOT NULL,    -- Discord channel ID, Discord user ID, email address
  target_label TEXT,          -- Human-readable label

  -- Delivery
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  discord_message_id TEXT,    -- For Discord: the sent message ID
  error_message TEXT,
  delivered_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,     -- Sender deleted the posted Discord message (036)
  delete_error TEXT,          -- Last sender-initiated delete error (036)

  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE announcement_delivery_log ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE announcement_delivery_log ADD COLUMN IF NOT EXISTS delete_error TEXT;

CREATE INDEX IF NOT EXISTS idx_delivery_log_schedule
  ON announcement_delivery_log(schedule_id);

ALTER TABLE announcement_delivery_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'announcement_delivery_log' AND policyname = 'Users view own delivery logs') THEN
    CREATE POLICY "Users view own delivery logs" ON announcement_delivery_log
      FOR SELECT USING (
        schedule_id IN (SELECT id FROM announcement_schedules WHERE user_id = auth.uid())
      );
  END IF;
END $$;

COMMENT ON TABLE announcement_delivery_log IS 'Per-target delivery status tracking for announcements';

-- ============================================================
-- 11. DM OPT-OUTS (recipients block DMs from specific senders)
-- ============================================================

CREATE TABLE IF NOT EXISTS dm_opt_outs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  recipient_discord_id TEXT NOT NULL,          -- Discord user who opted out
  sender_user_id UUID REFERENCES public.users(id) ON DELETE CASCADE, -- NULL = block all bot DMs

  reason TEXT,                                 -- Optional feedback: 'spam', 'unwanted', etc.

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dm_opt_outs_unique
  ON dm_opt_outs(recipient_discord_id, COALESCE(sender_user_id, '00000000-0000-0000-0000-000000000000'));

CREATE INDEX IF NOT EXISTS idx_dm_opt_outs_recipient
  ON dm_opt_outs(recipient_discord_id);

COMMENT ON TABLE dm_opt_outs IS 'DM recipients who opted out of receiving messages from specific senders or all bot DMs';

-- RLS — only service_role can manage opt-outs (backend only)
ALTER TABLE public.dm_opt_outs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 12. DM FIRST-CONTACT TRACKING (intro message sent once per pair)
-- ============================================================

CREATE TABLE IF NOT EXISTS dm_first_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  sender_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  recipient_discord_id TEXT NOT NULL,

  first_sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dm_first_contacts_unique
  ON dm_first_contacts(sender_user_id, recipient_discord_id);

COMMENT ON TABLE dm_first_contacts IS 'Tracks first-contact between platform senders and DM recipients for intro message logic';

-- RLS — only service_role can manage first-contacts (backend only)
ALTER TABLE public.dm_first_contacts ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 13. FEEDBACK (user + bot submissions)
-- ============================================================

CREATE TABLE IF NOT EXISTS feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who submitted it (one of these will be set)
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,  -- web submissions
  discord_user_id TEXT,                                          -- bot submissions
  discord_username TEXT,                                         -- bot submissions

  -- Content
  message TEXT NOT NULL,
  category TEXT DEFAULT 'general' CHECK (category IN ('general', 'bug', 'feature', 'other')),
  source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'bot')),

  -- Admin management
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'resolved', 'dismissed', 'affirmed')),
  admin_response TEXT,

  -- Attached images (base64 data URLs stored as JSONB array)
  attachments JSONB DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at DESC);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'feedback' AND policyname = 'Users view own feedback') THEN
    CREATE POLICY "Users view own feedback" ON feedback
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'feedback' AND policyname = 'Users insert own feedback') THEN
    CREATE POLICY "Users insert own feedback" ON feedback
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'feedback' AND policyname = 'Admins view all feedback') THEN
    CREATE POLICY "Admins view all feedback" ON feedback
      FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'feedback' AND policyname = 'Admins update feedback') THEN
    CREATE POLICY "Admins update feedback" ON feedback
      FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
      );
  END IF;
END $$;

COMMENT ON TABLE feedback IS 'User and Discord feedback submissions with admin management';

-- ============================================================
-- 13b. FEEDBACK RESPONSES (threaded admin replies)
-- ============================================================

CREATE TABLE IF NOT EXISTS feedback_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_id UUID NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  admin_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_responses_feedback_id ON feedback_responses(feedback_id);
CREATE INDEX IF NOT EXISTS idx_feedback_responses_created_at ON feedback_responses(created_at ASC);

ALTER TABLE feedback_responses ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'feedback_responses' AND policyname = 'Users view feedback responses') THEN
    CREATE POLICY "Users view feedback responses" ON feedback_responses
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM feedback f
          WHERE f.id = feedback_responses.feedback_id
          AND (
            f.user_id = auth.uid()
            OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
          )
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'feedback_responses' AND policyname = 'Admins insert feedback responses') THEN
    CREATE POLICY "Admins insert feedback responses" ON feedback_responses
      FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'feedback_responses' AND policyname = 'Admins update own responses') THEN
    CREATE POLICY "Admins update own responses" ON feedback_responses
      FOR UPDATE USING (
        admin_id = auth.uid()
        AND EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'feedback_responses' AND policyname = 'Admins delete own responses') THEN
    CREATE POLICY "Admins delete own responses" ON feedback_responses
      FOR DELETE USING (
        admin_id = auth.uid()
        AND EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
      );
  END IF;
END $$;

COMMENT ON TABLE feedback_responses IS 'Admin responses to feedback items, supporting threaded conversations';

-- ============================================================
-- 14. TRIGGERS (auto-update updated_at)
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

DROP TRIGGER IF EXISTS trigger_calendar_sources_updated_at ON public.calendar_sources;
CREATE TRIGGER trigger_calendar_sources_updated_at
  BEFORE UPDATE ON public.calendar_sources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_discord_integrations_updated_at ON discord_integrations;
CREATE TRIGGER trigger_discord_integrations_updated_at
  BEFORE UPDATE ON discord_integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_discord_guild_channels_updated_at ON discord_guild_channels;
CREATE TRIGGER trigger_discord_guild_channels_updated_at
  BEFORE UPDATE ON discord_guild_channels FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_announcement_templates_updated_at ON announcement_templates;
CREATE TRIGGER trigger_announcement_templates_updated_at
  BEFORE UPDATE ON announcement_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_announcement_schedules_updated_at ON announcement_schedules;
CREATE TRIGGER trigger_announcement_schedules_updated_at
  BEFORE UPDATE ON announcement_schedules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_feedback_updated_at ON feedback;
CREATE TRIGGER trigger_feedback_updated_at
  BEFORE UPDATE ON feedback FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_feedback_responses_updated_at ON feedback_responses;
CREATE TRIGGER trigger_feedback_responses_updated_at
  BEFORE UPDATE ON feedback_responses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 15. TRAVELER ACCOUNT CLEANUP
-- ============================================================

CREATE OR REPLACE FUNCTION cleanup_expired_travelers()
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
    DELETE FROM availability WHERE calendar_id IN (
      SELECT id FROM calendars WHERE created_by = expired_user.id::text
    );
    DELETE FROM meetings WHERE calendar_id IN (
      SELECT id FROM calendars WHERE created_by = expired_user.id::text
    );
    DELETE FROM calendars WHERE created_by = expired_user.id::text;
    DELETE FROM public.users WHERE id = expired_user.id;
    DELETE FROM auth.users WHERE id = expired_user.id;
  END LOOP;
END;
$$;

-- To schedule daily cleanup in Supabase (enable pg_cron extension first):
-- SELECT cron.schedule('cleanup-expired-travelers', '0 3 * * *', $$ SELECT cleanup_expired_travelers(); $$);

-- ============================================================
-- 16. NETWORK RELATIONS (group calendars/meetings by network)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.networks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#3B82F6',
  description TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.networks ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.network_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  network_id UUID NOT NULL REFERENCES public.networks(id) ON DELETE CASCADE,
  source_string TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('calendar_title', 'meeting_title', 'description')),
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.network_mappings ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_network_mappings_network_id ON public.network_mappings(network_id);
CREATE INDEX IF NOT EXISTS idx_network_mappings_source_string ON public.network_mappings(source_string);

CREATE TABLE IF NOT EXISTS public.network_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  network_id UUID NOT NULL REFERENCES public.networks(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  match_type TEXT NOT NULL CHECK (match_type IN ('contains', 'starts_with', 'exact', 'regex')),
  match_field TEXT NOT NULL CHECK (match_field IN ('calendar_title', 'meeting_title', 'description')),
  priority INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.network_rules ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_network_rules_network_id ON public.network_rules(network_id);
CREATE INDEX IF NOT EXISTS idx_network_rules_active ON public.network_rules(is_active) WHERE is_active = true;

-- ============================================================
-- 17. COMMUNITY EVENT MODERATION
-- ============================================================

CREATE TABLE IF NOT EXISTS public.event_flags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flag_type TEXT NOT NULL CHECK (flag_type IN ('removal', 'confirmation')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'removal_accepted', 'updated', 'expired')),
  rationale TEXT,
  reporter_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reporter_anonymous_id TEXT,
  respond_by TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT event_flags_reporter_chk CHECK (num_nonnulls(reporter_user_id, reporter_anonymous_id) = 1),
  CONSTRAINT event_flags_rationale_chk CHECK (flag_type <> 'removal' OR char_length(trim(rationale)) >= 2),
  CONSTRAINT event_flags_deadline_chk CHECK (
    (flag_type = 'confirmation' AND respond_by IS NOT NULL)
    OR (flag_type = 'removal' AND respond_by IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.event_flag_targets (
  flag_id UUID NOT NULL REFERENCES public.event_flags(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('user_event', 'meeting')),
  target_id UUID NOT NULL,
  owner_identity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'removal_accepted', 'updated', 'expired')),
  responded_at TIMESTAMPTZ,
  PRIMARY KEY (flag_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS public.public_event_moderation_state (
  target_type TEXT NOT NULL CHECK (target_type IN ('user_event', 'meeting')),
  target_id UUID NOT NULL,
  is_suspended BOOLEAN NOT NULL DEFAULT FALSE,
  suspension_reason_flag_id UUID REFERENCES public.event_flags(id) ON DELETE SET NULL,
  suspended_at TIMESTAMPTZ,
  restored_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (target_type, target_id)
);

CREATE TABLE IF NOT EXISTS public.event_flag_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flag_id UUID NOT NULL REFERENCES public.event_flags(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (
    action IN ('submitted', 'suspended', 'confirmed', 'removal_accepted', 'updated', 'expired', 'restored')
  ),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('authenticated', 'anonymous', 'system')),
  actor_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  actor_anonymous_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_flags_active_deadline ON public.event_flags(status, respond_by) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_event_flags_reporter_user ON public.event_flags(reporter_user_id) WHERE reporter_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_event_flag_targets_owner ON public.event_flag_targets(owner_identity, status, flag_id);
CREATE INDEX IF NOT EXISTS idx_event_flag_targets_target ON public.event_flag_targets(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_event_flag_actions_flag_created ON public.event_flag_actions(flag_id, created_at);
CREATE INDEX IF NOT EXISTS idx_public_event_moderation_suspended ON public.public_event_moderation_state(target_type, target_id) WHERE is_suspended = TRUE;

ALTER TABLE public.event_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_flag_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_event_moderation_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_flag_actions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'event_flags' AND policyname = 'Event flags are service managed') THEN
    CREATE POLICY "Event flags are service managed" ON public.event_flags FOR ALL USING (FALSE) WITH CHECK (FALSE);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'event_flag_targets' AND policyname = 'Event flag targets are service managed') THEN
    CREATE POLICY "Event flag targets are service managed" ON public.event_flag_targets FOR ALL USING (FALSE) WITH CHECK (FALSE);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'public_event_moderation_state' AND policyname = 'Public event moderation state is service managed') THEN
    CREATE POLICY "Public event moderation state is service managed" ON public.public_event_moderation_state FOR ALL USING (FALSE) WITH CHECK (FALSE);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'event_flag_actions' AND policyname = 'Event flag actions are service managed') THEN
    CREATE POLICY "Event flag actions are service managed" ON public.event_flag_actions FOR ALL USING (FALSE) WITH CHECK (FALSE);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trigger_event_flags_updated_at ON public.event_flags;
CREATE TRIGGER trigger_event_flags_updated_at
  BEFORE UPDATE ON public.event_flags
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_public_event_moderation_state_updated_at ON public.public_event_moderation_state;
CREATE TRIGGER trigger_public_event_moderation_state_updated_at
  BEFORE UPDATE ON public.public_event_moderation_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.event_flags IS 'Community requests to remove or reconfirm public event listings';
COMMENT ON TABLE public.event_flag_targets IS 'Underlying user events or meetings associated with a community flag';
COMMENT ON TABLE public.public_event_moderation_state IS 'Moderation suspension independent of owner publication settings';
COMMENT ON TABLE public.event_flag_actions IS 'Append-only audit history for event moderation activity';

-- RLS performance optimization. Existing environments may use the historical
-- upgrade at migrations/archive/019_optimize_rls_policies.sql.
-- Keep private out of the Supabase Data API exposed schemas.
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

DROP POLICY IF EXISTS "Users can view own profile" ON public.users;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.users;
DROP POLICY IF EXISTS "Users or admins can view profiles" ON public.users;
CREATE POLICY "Users or admins can view profiles" ON public.users
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR private.current_user_has_role('admin'));

DROP POLICY IF EXISTS "Users view own feedback" ON public.feedback;
DROP POLICY IF EXISTS "Admins view all feedback" ON public.feedback;
DROP POLICY IF EXISTS "Admin users can view all feedback" ON public.feedback;
DROP POLICY IF EXISTS "Users or admins view feedback" ON public.feedback;
CREATE POLICY "Users or admins view feedback" ON public.feedback
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR private.current_user_has_role('admin'));

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
  USING (sender_user_id = (SELECT auth.uid()) OR used_by_user_id = (SELECT auth.uid()));
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
  USING (is_public = TRUE OR user_id = (SELECT auth.uid()));
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

DROP POLICY IF EXISTS "Admins update feedback responses" ON public.feedback_responses;
DROP POLICY IF EXISTS "Admins update own responses" ON public.feedback_responses;
DROP POLICY IF EXISTS "Admins delete feedback responses" ON public.feedback_responses;
DROP POLICY IF EXISTS "Admins delete own responses" ON public.feedback_responses;
CREATE POLICY "Admins update own responses" ON public.feedback_responses
  FOR UPDATE TO authenticated
  USING (admin_id = (SELECT auth.uid()) AND private.current_user_has_role('admin'))
  WITH CHECK (admin_id = (SELECT auth.uid()) AND private.current_user_has_role('admin'));
CREATE POLICY "Admins delete own responses" ON public.feedback_responses
  FOR DELETE TO authenticated
  USING (admin_id = (SELECT auth.uid()) AND private.current_user_has_role('admin'));

DROP INDEX IF EXISTS public.idx_dm_calendar_invites_discord_user;

-- Guardian ban registry (historical upgrade: archive/025_guardian_ban_registry.sql).
CREATE TABLE IF NOT EXISTS public.guardian_ban_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL CHECK (guild_id ~ '^[0-9]{17,20}$'),
  discord_user_id TEXT NOT NULL CHECK (discord_user_id ~ '^[0-9]{17,20}$'),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 400),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'registered'
    CHECK (status IN ('registered', 'pending', 'processing', 'banned', 'failed')),
  created_by UUID NOT NULL REFERENCES public.users(id),
  requested_by UUID NOT NULL REFERENCES public.users(id),
  requested_by_discord_id TEXT NOT NULL,
  disabled_by UUID REFERENCES public.users(id),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_started_at TIMESTAMPTZ,
  processing_token UUID,
  last_error TEXT,
  banned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (guild_id, discord_user_id)
);

CREATE INDEX IF NOT EXISTS idx_guardian_ban_queue
  ON public.guardian_ban_entries(next_attempt_at, created_at)
  WHERE is_enabled AND status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_guardian_ban_guild_created
  ON public.guardian_ban_entries(guild_id, created_at DESC);
ALTER TABLE public.guardian_ban_entries ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'guardian_ban_entries'
      AND policyname = 'Ban registry is service only'
  ) THEN
    CREATE POLICY "Ban registry is service only" ON public.guardian_ban_entries
      FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.register_guardian_bans(
  p_guild_ids TEXT[], p_discord_ids TEXT[], p_reason TEXT,
  p_actor UUID, p_actor_discord TEXT, p_preban BOOLEAN
) RETURNS INTEGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE affected INTEGER;
BEGIN
  INSERT INTO public.guardian_ban_entries (
    guild_id, discord_user_id, reason, created_by, requested_by,
    requested_by_discord_id, status
  )
  SELECT guild_id, discord_id, p_reason, p_actor, p_actor, p_actor_discord,
    CASE WHEN p_preban THEN 'pending' ELSE 'registered' END
  FROM unnest(p_guild_ids) AS g(guild_id)
  CROSS JOIN unnest(p_discord_ids) AS d(discord_id)
  ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
    reason = EXCLUDED.reason,
    requested_by = EXCLUDED.requested_by,
    requested_by_discord_id = EXCLUDED.requested_by_discord_id,
    is_enabled = TRUE,
    disabled_by = NULL,
    status = CASE WHEN p_preban THEN 'pending'
      WHEN guardian_ban_entries.status = 'banned' THEN 'banned' ELSE 'registered' END,
    attempts = 0,
    next_attempt_at = NOW(),
    processing_started_at = NULL,
    processing_token = NULL,
    last_error = NULL,
    updated_at = NOW()
  WHERE guardian_ban_entries.status <> 'processing';
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_guardian_ban(p_instance_id TEXT)
RETURNS SETOF public.guardian_ban_entries
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.guardian_instance_lock
    WHERE id = 'singleton' AND instance_id = p_instance_id
      AND heartbeat_at > NOW() - INTERVAL '30 seconds'
  ) THEN RETURN; END IF;

  RETURN QUERY
  UPDATE public.guardian_ban_entries SET
    status = 'processing', processing_started_at = NOW(),
    processing_token = gen_random_uuid(), attempts = attempts + 1, updated_at = NOW()
  WHERE id = (
    SELECT id FROM public.guardian_ban_entries
    WHERE is_enabled AND (
      (status = 'pending' AND next_attempt_at <= NOW()) OR
      (status = 'processing' AND processing_started_at < NOW() - INTERVAL '5 minutes')
    )
    ORDER BY next_attempt_at, created_at
    LIMIT 1 FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_guardian_join_ban(p_guild_id TEXT, p_discord_id TEXT)
RETURNS VOID LANGUAGE sql SET search_path = public AS $$
  UPDATE public.guardian_ban_entries SET
    status = 'pending', attempts = 0, next_attempt_at = NOW(),
    last_error = NULL, updated_at = NOW()
  WHERE guild_id = p_guild_id AND discord_user_id = p_discord_id
    AND is_enabled AND status <> 'processing';
$$;

REVOKE ALL ON FUNCTION public.register_guardian_bans(TEXT[], TEXT[], TEXT, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_guardian_ban(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_guardian_join_ban(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_guardian_bans(TEXT[], TEXT[], TEXT, UUID, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_guardian_ban(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_guardian_join_ban(TEXT, TEXT) TO service_role;

-- Global Ban List (historical upgrade: archive/027_guardian_global_bans.sql).
CREATE TABLE IF NOT EXISTS public.guardian_ban_accounts (
  discord_user_id TEXT PRIMARY KEY CHECK (discord_user_id ~ '^[0-9]{17,20}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES public.users(id),
  requested_by_discord_id TEXT NOT NULL,
  boot_count INTEGER NOT NULL DEFAULT 0 CHECK (boot_count >= 0)
);

INSERT INTO public.guardian_ban_accounts (discord_user_id, created_at, created_by, requested_by_discord_id)
SELECT DISTINCT ON (discord_user_id) discord_user_id, created_at, created_by, requested_by_discord_id
FROM public.guardian_ban_entries WHERE is_enabled
ORDER BY discord_user_id, created_at, id
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.guardian_ban_previews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES public.users(id),
  actor_discord_id TEXT NOT NULL,
  discord_ids TEXT[] NOT NULL CHECK (cardinality(discord_ids) BETWEEN 1 AND 1000),
  guild_ids TEXT[] NOT NULL CHECK (cardinality(guild_ids) > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'confirming', 'failed', 'confirmed')),
  cursor INTEGER NOT NULL DEFAULT 0,
  member_counts JSONB NOT NULL DEFAULT '{}',
  last_error TEXT,
  processing_token UUID,
  processing_started_at TIMESTAMPTZ,
  confirmation_requested BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);
CREATE INDEX IF NOT EXISTS idx_guardian_preview_pending ON public.guardian_ban_previews(created_at)
  WHERE status IN ('pending', 'processing', 'confirming');
CREATE INDEX IF NOT EXISTS idx_guardian_preview_actor ON public.guardian_ban_previews(created_by, created_at);

CREATE TABLE IF NOT EXISTS public.guardian_ban_removals (
  operation_id UUID PRIMARY KEY,
  discord_user_id TEXT NOT NULL REFERENCES public.guardian_ban_accounts(discord_user_id),
  guild_id TEXT NOT NULL,
  removed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_guardian_removals_account ON public.guardian_ban_removals(discord_user_id);
ALTER TABLE public.guardian_ban_entries ADD COLUMN IF NOT EXISTS operation_id UUID DEFAULT gen_random_uuid();
ALTER TABLE public.guardian_ban_entries ADD COLUMN IF NOT EXISTS join_pending BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.guardian_ban_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_ban_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_ban_removals ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.guardian_ban_accounts, public.guardian_ban_previews, public.guardian_ban_removals TO service_role;
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['guardian_ban_accounts', 'guardian_ban_previews', 'guardian_ban_removals'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'Guardian global bans service only') THEN
      EXECUTE format('CREATE POLICY "Guardian global bans service only" ON public.%I FOR ALL USING (false) WITH CHECK (false)', t);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.claim_guardian_ban_preview(p_instance_id TEXT)
RETURNS SETOF public.guardian_ban_previews LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM guardian_instance_lock WHERE id = 'singleton'
    AND instance_id = p_instance_id AND heartbeat_at > NOW() - INTERVAL '30 seconds') THEN RETURN; END IF;
  RETURN QUERY UPDATE guardian_ban_previews SET status = 'processing',
    processing_token = gen_random_uuid(), processing_started_at = NOW()
  WHERE id = (
    SELECT id FROM guardian_ban_previews WHERE expires_at > NOW() AND
      (status IN ('pending', 'confirming') OR (status = 'processing' AND processing_started_at < NOW() - INTERVAL '5 minutes'))
    ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
  ) RETURNING *;
END $$;

CREATE OR REPLACE FUNCTION public.confirm_guardian_global_bans(p_preview UUID, p_actor UUID, p_token UUID)
RETURNS INTEGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE preview guardian_ban_previews; affected INTEGER;
BEGIN
  SELECT * INTO preview FROM guardian_ban_previews WHERE id = p_preview AND created_by = p_actor FOR UPDATE;
  IF NOT FOUND OR preview.expires_at <= NOW() OR NOT preview.confirmation_requested OR
    preview.status NOT IN ('processing', 'confirmed') OR
    (preview.status <> 'confirmed' AND preview.processing_token IS DISTINCT FROM p_token) THEN
    RAISE EXCEPTION 'Preview is incomplete or expired';
  END IF;
  IF preview.status = 'confirmed' THEN RETURN 0; END IF;
  WITH added AS (
    INSERT INTO guardian_ban_accounts(discord_user_id, created_by, requested_by_discord_id)
    SELECT unnest(preview.discord_ids), p_actor, preview.actor_discord_id ON CONFLICT DO NOTHING
    RETURNING *
  ), queued AS (
    INSERT INTO guardian_ban_entries(guild_id, discord_user_id, reason, created_by, requested_by,
      requested_by_discord_id, status)
    SELECT g, a.discord_user_id, 'Global Guardian ban registry', a.created_by, a.created_by,
      a.requested_by_discord_id, 'pending' FROM added a CROSS JOIN unnest(preview.guild_ids) g
    ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
      is_enabled = TRUE, disabled_by = NULL, status = 'pending', attempts = 0,
      requested_by = EXCLUDED.requested_by, requested_by_discord_id = EXCLUDED.requested_by_discord_id,
      next_attempt_at = NOW(), processing_token = NULL, processing_started_at = NULL,
      operation_id = gen_random_uuid(), last_error = NULL, updated_at = NOW()
    RETURNING id
  ) SELECT count(*) INTO affected FROM added;
  UPDATE guardian_ban_previews SET status = 'confirmed', cursor = cardinality(guild_ids), last_error = NULL,
    processing_token = NULL, processing_started_at = NULL WHERE id = p_preview;
  RETURN affected;
END $$;

-- Paged reconciliation fills new-server coverage and upgrades legacy scoped pairs.
CREATE OR REPLACE FUNCTION public.sync_guardian_global_bans(p_guild_ids TEXT[], p_after TEXT DEFAULT '')
RETURNS TABLE(last_id TEXT, account_count INTEGER) LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RETURN QUERY WITH accounts AS MATERIALIZED (
    SELECT * FROM guardian_ban_accounts WHERE discord_user_id > p_after ORDER BY discord_user_id LIMIT 100
  ), queued AS (
    INSERT INTO guardian_ban_entries(guild_id, discord_user_id, reason, created_by, requested_by,
      requested_by_discord_id, status)
    SELECT g, a.discord_user_id, 'Global Guardian ban registry', a.created_by, a.created_by,
      a.requested_by_discord_id, 'pending' FROM accounts a CROSS JOIN unnest(p_guild_ids) g
    ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
      is_enabled = TRUE, disabled_by = NULL, status = 'pending', attempts = 0,
      requested_by = EXCLUDED.requested_by, requested_by_discord_id = EXCLUDED.requested_by_discord_id,
      next_attempt_at = NOW(), operation_id = gen_random_uuid(), last_error = NULL, updated_at = NOW()
    WHERE NOT guardian_ban_entries.is_enabled OR guardian_ban_entries.status = 'registered'
    RETURNING id
  ) SELECT max(discord_user_id), count(*)::INTEGER FROM accounts;
END $$;

CREATE OR REPLACE FUNCTION public.enqueue_guardian_join_ban(p_guild_id TEXT, p_discord_id TEXT)
RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  INSERT INTO guardian_ban_entries(guild_id, discord_user_id, reason, created_by, requested_by,
    requested_by_discord_id, status)
  SELECT p_guild_id, discord_user_id, 'Global Guardian ban registry', created_by, created_by,
    requested_by_discord_id, 'pending' FROM guardian_ban_accounts WHERE discord_user_id = p_discord_id
  ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
    is_enabled = TRUE,
    status = CASE WHEN guardian_ban_entries.status = 'processing' THEN 'processing' ELSE 'pending' END,
    attempts = CASE WHEN guardian_ban_entries.status = 'processing' THEN guardian_ban_entries.attempts ELSE 0 END,
    next_attempt_at = NOW(), join_pending = guardian_ban_entries.status = 'processing',
    operation_id = CASE WHEN guardian_ban_entries.status = 'processing' THEN guardian_ban_entries.operation_id ELSE gen_random_uuid() END,
    last_error = NULL, updated_at = NOW();
END $$;

CREATE OR REPLACE FUNCTION public.finish_guardian_global_ban(
  p_entry UUID, p_token UUID, p_removed BOOLEAN
) RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
DECLARE entry guardian_ban_entries; inserted INTEGER;
BEGIN
  SELECT * INTO entry FROM guardian_ban_entries WHERE id = p_entry AND processing_token = p_token FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF p_removed THEN
    INSERT INTO guardian_ban_removals(operation_id, discord_user_id, guild_id)
    VALUES (entry.operation_id, entry.discord_user_id, entry.guild_id) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS inserted = ROW_COUNT;
    IF inserted = 1 THEN
      UPDATE guardian_ban_accounts SET boot_count = boot_count + 1 WHERE discord_user_id = entry.discord_user_id;
    END IF;
  END IF;
  UPDATE guardian_ban_entries SET status = CASE WHEN entry.join_pending THEN 'pending' ELSE 'banned' END,
    next_attempt_at = NOW(), attempts = CASE WHEN entry.join_pending THEN 0 ELSE attempts END,
    operation_id = CASE WHEN entry.join_pending THEN gen_random_uuid() ELSE operation_id END,
    join_pending = FALSE, banned_at = NOW(), last_error = NULL,
    processing_token = NULL, processing_started_at = NULL, updated_at = NOW() WHERE id = p_entry;
END $$;

-- The old server-specific import API must not be usable alongside global enforcement.
REVOKE ALL ON FUNCTION public.register_guardian_bans(TEXT[], TEXT[], TEXT, UUID, TEXT, BOOLEAN) FROM service_role;
REVOKE ALL ON FUNCTION public.claim_guardian_ban_preview(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_guardian_global_bans(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_guardian_global_bans(TEXT[], TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_guardian_global_ban(UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_guardian_ban_preview(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_guardian_global_bans(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_guardian_global_bans(TEXT[], TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_guardian_global_ban(UUID, UUID, BOOLEAN) TO service_role;

-- Guardian Ban List management (historical upgrade: archive/028_guardian_ban_management.sql).
ALTER TABLE public.guardian_ban_accounts ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.guardian_ban_accounts ADD COLUMN IF NOT EXISTS last_booted_at TIMESTAMPTZ;
ALTER TABLE public.guardian_ban_accounts ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;
ALTER TABLE public.guardian_ban_accounts ADD COLUMN IF NOT EXISTS removed_by UUID REFERENCES public.users(id);
ALTER TABLE public.guardian_ban_entries ADD COLUMN IF NOT EXISTS action TEXT NOT NULL DEFAULT 'ban';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.guardian_ban_entries'::regclass
    AND conname = 'guardian_ban_entry_action_check') THEN
    ALTER TABLE public.guardian_ban_entries ADD CONSTRAINT guardian_ban_entry_action_check CHECK (action IN ('ban', 'unban'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_guardian_active_accounts ON public.guardian_ban_accounts(created_at DESC, discord_user_id) WHERE is_active;
UPDATE public.guardian_ban_accounts a SET last_booted_at = r.last_booted
FROM (SELECT discord_user_id, max(removed_at) AS last_booted FROM public.guardian_ban_removals GROUP BY discord_user_id) r
WHERE a.discord_user_id = r.discord_user_id AND a.last_booted_at IS NULL;

CREATE OR REPLACE FUNCTION public.remove_guardian_global_bans(
  p_discord_ids TEXT[], p_guild_ids TEXT[], p_actor UUID, p_actor_discord TEXT
) RETURNS INTEGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE affected INTEGER;
BEGIN
  -- Account row locks serialize removal with re-registration and event reconciliation.
  WITH removed AS (
    UPDATE guardian_ban_accounts SET is_active = FALSE, removed_at = NOW(), removed_by = p_actor
    WHERE discord_user_id = ANY(p_discord_ids) AND is_active RETURNING *
  ), targets AS (
    SELECT a.discord_user_id, g AS guild_id FROM removed a CROSS JOIN unnest(p_guild_ids) g
    UNION SELECT e.discord_user_id, e.guild_id FROM guardian_ban_entries e JOIN removed a USING(discord_user_id)
  ), queued AS (
    INSERT INTO guardian_ban_entries(guild_id, discord_user_id, reason, created_by, requested_by,
      requested_by_discord_id, status, action)
    SELECT guild_id, discord_user_id, 'Guardian registry removal', p_actor, p_actor, p_actor_discord, 'pending', 'unban'
    FROM targets
    ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
      action = 'unban', is_enabled = TRUE, status = 'pending', requested_by = p_actor,
      requested_by_discord_id = p_actor_discord, attempts = 0, next_attempt_at = NOW(),
      processing_token = NULL, processing_started_at = NULL, operation_id = gen_random_uuid(),
      join_pending = FALSE, last_error = NULL, updated_at = NOW()
    RETURNING id
  ) SELECT count(*) INTO affected FROM removed;
  RETURN affected;
END $$;

CREATE OR REPLACE FUNCTION public.confirm_guardian_global_bans(p_preview UUID, p_actor UUID, p_token UUID)
RETURNS INTEGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE preview guardian_ban_previews; affected INTEGER;
BEGIN
  SELECT * INTO preview FROM guardian_ban_previews WHERE id = p_preview AND created_by = p_actor FOR UPDATE;
  IF NOT FOUND OR preview.expires_at <= NOW() OR NOT preview.confirmation_requested OR
    preview.status NOT IN ('processing', 'confirmed') OR
    (preview.status <> 'confirmed' AND preview.processing_token IS DISTINCT FROM p_token) THEN
    RAISE EXCEPTION 'Preview is incomplete or expired';
  END IF;
  IF preview.status = 'confirmed' THEN RETURN 0; END IF;
  WITH added AS (
    INSERT INTO guardian_ban_accounts(discord_user_id, created_by, requested_by_discord_id)
    SELECT id, p_actor, preview.actor_discord_id FROM unnest(preview.discord_ids) id ORDER BY id
    ON CONFLICT (discord_user_id) DO UPDATE SET
      is_active = TRUE, removed_at = NULL, removed_by = NULL, created_at = NOW(),
      created_by = EXCLUDED.created_by, requested_by_discord_id = EXCLUDED.requested_by_discord_id
    WHERE NOT guardian_ban_accounts.is_active RETURNING *
  ), queued AS (
    INSERT INTO guardian_ban_entries(guild_id, discord_user_id, reason, created_by, requested_by,
      requested_by_discord_id, status, action)
    SELECT g, a.discord_user_id, 'Global Guardian ban registry', a.created_by, a.created_by,
      a.requested_by_discord_id, 'pending', 'ban' FROM added a CROSS JOIN unnest(preview.guild_ids) g
    ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
      action = 'ban', is_enabled = TRUE, disabled_by = NULL, status = 'pending', attempts = 0,
      requested_by = EXCLUDED.requested_by, requested_by_discord_id = EXCLUDED.requested_by_discord_id,
      next_attempt_at = NOW(), processing_token = NULL, processing_started_at = NULL,
      operation_id = gen_random_uuid(), join_pending = FALSE, last_error = NULL, updated_at = NOW()
    RETURNING id
  ) SELECT count(*) INTO affected FROM added;
  UPDATE guardian_ban_previews SET status = 'confirmed', cursor = cardinality(guild_ids), last_error = NULL,
    processing_token = NULL, processing_started_at = NULL WHERE id = p_preview;
  RETURN affected;
END $$;

CREATE OR REPLACE FUNCTION public.enqueue_guardian_join_ban(p_guild_id TEXT, p_discord_id TEXT)
RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM guardian_ban_accounts WHERE discord_user_id = p_discord_id AND is_active FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO guardian_ban_entries(guild_id, discord_user_id, reason, created_by, requested_by,
    requested_by_discord_id, status, action)
  SELECT p_guild_id, discord_user_id, 'Global Guardian ban registry', created_by, created_by,
    requested_by_discord_id, 'pending', 'ban' FROM guardian_ban_accounts WHERE discord_user_id = p_discord_id AND is_active
  ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
    action = 'ban', is_enabled = TRUE,
    status = CASE WHEN guardian_ban_entries.status = 'processing' AND guardian_ban_entries.action = 'ban' THEN 'processing' ELSE 'pending' END,
    attempts = CASE WHEN guardian_ban_entries.status = 'processing' AND guardian_ban_entries.action = 'ban' THEN guardian_ban_entries.attempts ELSE 0 END,
    next_attempt_at = NOW(), join_pending = guardian_ban_entries.status = 'processing' AND guardian_ban_entries.action = 'ban',
    operation_id = CASE WHEN guardian_ban_entries.status = 'processing' AND guardian_ban_entries.action = 'ban' THEN guardian_ban_entries.operation_id ELSE gen_random_uuid() END,
    last_error = NULL, updated_at = NOW();
END $$;

CREATE OR REPLACE FUNCTION public.recover_guardian_global_bans(p_guild_ids TEXT[], p_after TEXT DEFAULT '')
RETURNS TABLE(last_id TEXT, account_count INTEGER) LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RETURN QUERY WITH accounts AS MATERIALIZED (
    SELECT * FROM guardian_ban_accounts WHERE is_active AND discord_user_id > p_after
    ORDER BY discord_user_id LIMIT 100 FOR UPDATE
  ), queued AS (
    INSERT INTO guardian_ban_entries(guild_id, discord_user_id, reason, created_by, requested_by,
      requested_by_discord_id, status, action)
    SELECT g, a.discord_user_id, 'Global Guardian ban registry', a.created_by, a.created_by,
      a.requested_by_discord_id, 'pending', 'ban' FROM accounts a CROSS JOIN unnest(p_guild_ids) g
    ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
      action = 'ban', is_enabled = TRUE, status = 'pending', attempts = 0,
      requested_by = EXCLUDED.requested_by, requested_by_discord_id = EXCLUDED.requested_by_discord_id,
      next_attempt_at = NOW(), operation_id = gen_random_uuid(), last_error = NULL, updated_at = NOW()
    WHERE guardian_ban_entries.status NOT IN ('pending', 'processing')
    RETURNING id
  ) SELECT max(discord_user_id), count(*)::INTEGER FROM accounts;
END $$;

CREATE OR REPLACE FUNCTION public.finish_guardian_global_ban(p_entry UUID, p_token UUID, p_removed BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
DECLARE entry guardian_ban_entries; inserted INTEGER;
BEGIN
  SELECT * INTO entry FROM guardian_ban_entries WHERE id = p_entry AND processing_token = p_token;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM 1 FROM guardian_ban_accounts WHERE discord_user_id = entry.discord_user_id FOR UPDATE;
  SELECT * INTO entry FROM guardian_ban_entries WHERE id = p_entry AND processing_token = p_token FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF entry.action = 'ban' AND p_removed THEN
    INSERT INTO guardian_ban_removals(operation_id, discord_user_id, guild_id)
    VALUES (entry.operation_id, entry.discord_user_id, entry.guild_id) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS inserted = ROW_COUNT;
    IF inserted = 1 THEN
      UPDATE guardian_ban_accounts SET boot_count = boot_count + 1, last_booted_at = NOW()
      WHERE discord_user_id = entry.discord_user_id;
    END IF;
  END IF;
  UPDATE guardian_ban_entries SET status = CASE
      WHEN entry.action = 'unban' THEN 'registered' WHEN entry.join_pending THEN 'pending' ELSE 'banned' END,
    is_enabled = entry.action <> 'unban',
    next_attempt_at = NOW(), attempts = CASE WHEN entry.join_pending THEN 0 ELSE attempts END,
    operation_id = CASE WHEN entry.join_pending THEN gen_random_uuid() ELSE operation_id END,
    join_pending = FALSE, banned_at = CASE WHEN entry.action = 'ban' THEN NOW() ELSE banned_at END,
    last_error = NULL, processing_token = NULL, processing_started_at = NULL, updated_at = NOW() WHERE id = p_entry;
END $$;

-- Old periodic reconciliation cannot reactivate a removed ID.
CREATE OR REPLACE FUNCTION public.sync_guardian_global_bans(p_guild_ids TEXT[], p_after TEXT DEFAULT '')
RETURNS TABLE(last_id TEXT, account_count INTEGER) LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Periodic Guardian reconciliation is retired; deploy the event-driven worker';
END;
$$;
REVOKE ALL ON FUNCTION public.remove_guardian_global_bans(TEXT[], TEXT[], UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recover_guardian_global_bans(TEXT[], TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_guardian_global_bans(TEXT[], TEXT[], UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_guardian_global_bans(TEXT[], TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.report_guardian_registry_write(
  p_entry UUID, p_token UUID, p_action TEXT, p_removed BOOLEAN, p_wrote BOOLEAN
) RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
DECLARE entry guardian_ban_entries; active BOOLEAN; desired TEXT;
BEGIN
  SELECT * INTO entry FROM guardian_ban_entries WHERE id = p_entry;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registry operation missing'; END IF;
  SELECT is_active INTO active FROM guardian_ban_accounts WHERE discord_user_id = entry.discord_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registry account missing'; END IF;
  SELECT * INTO entry FROM guardian_ban_entries WHERE id = p_entry FOR UPDATE;
  desired := CASE WHEN active THEN 'ban' ELSE 'unban' END;
  IF entry.processing_token = p_token AND entry.action = p_action AND desired = p_action THEN
    PERFORM finish_guardian_global_ban(p_entry, p_token, p_removed);
  ELSIF p_wrote AND desired <> p_action THEN
    -- A late Discord write must be compensated even after a newer worker finished.
    UPDATE guardian_ban_entries SET action = desired, status = 'pending', is_enabled = TRUE,
      attempts = 0, next_attempt_at = NOW(), processing_token = NULL, processing_started_at = NULL,
      operation_id = gen_random_uuid(), join_pending = FALSE, last_error = NULL, updated_at = NOW()
    WHERE id = p_entry;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.report_guardian_registry_write(UUID, UUID, TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_guardian_registry_write(UUID, UUID, TEXT, BOOLEAN, BOOLEAN) TO service_role;

-- Guardian is installed through 000_feature-discord-guardian.sql.
-- Keep existing optional Guardian installations current when rerunning the baseline.
DO $$ BEGIN
  IF to_regclass('public.guardian_message_log') IS NOT NULL THEN
    ALTER TABLE public.guardian_message_log
      ADD COLUMN IF NOT EXISTS skip_reason TEXT;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.guardian_message_log'::regclass
        AND conname = 'guardian_message_log_skip_reason_check'
    ) THEN
      ALTER TABLE public.guardian_message_log
        ADD CONSTRAINT guardian_message_log_skip_reason_check
        CHECK (
          skip_reason IS NULL OR
          (skip_reason IN ('ignored_role', 'channel_disabled', 'parent_channel_disabled')
            AND was_flagged IS FALSE)
        );
    END IF;
    CREATE INDEX IF NOT EXISTS idx_guardian_log_scanned_not_skipped
      ON public.guardian_message_log(scanned_at DESC)
      WHERE skip_reason IS NULL;
  END IF;
END $$;
