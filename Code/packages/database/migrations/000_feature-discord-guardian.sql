-- Consolidated feature migration file: feature-discord-guardian
-- Generated from incremental files for easier agent navigation.
-- Keep statements idempotent when adding future changes.

-- ============================================================
-- BEGIN SOURCE: 021_discord_guardian.sql
-- ============================================================
-- Migration 021: Discord Guardian — Moderation Bot Schema
-- Adds tables for:
--   1. guardian_rule_groups — Named groups of regex/filter rules
--   2. guardian_rules — Individual regex patterns or wildcard phrases within a group
--   3. guardian_flagged_messages — Messages flagged by the bot
--   4. guardian_message_log — All scanned messages (recent window for dashboard)
--   5. guardian_config — Bot-level configuration (guilds, channels, etc.)

-- ─── Rule Groups ──────────────────────────────────────────────────────
-- Each group has a name (e.g. "URL-Encoded Phishing Links", "Scam Phrases")
-- and can be enabled/disabled independently.

CREATE TABLE IF NOT EXISTS public.guardian_rule_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  is_enabled BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ─── Rules ────────────────────────────────────────────────────────────
-- Each rule belongs to a group. Can be a regex pattern or a wildcard phrase.
-- pattern_type: 'regex' | 'wildcard'
--   regex: standard JS regex (stored without delimiters)
--   wildcard: uses * for partial matching, auto-converted to regex at scan time

CREATE TABLE IF NOT EXISTS public.guardian_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.guardian_rule_groups(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  pattern_type TEXT NOT NULL DEFAULT 'regex' CHECK (pattern_type IN ('regex', 'wildcard')),
  description TEXT,
  is_enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guardian_rules_group_id ON public.guardian_rules(group_id);

-- ─── Flagged Messages ─────────────────────────────────────────────────
-- Messages that matched one or more rules. Stores the message content,
-- author info, which rule matched, and the matched text.

CREATE TABLE IF NOT EXISTS public.guardian_flagged_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL,
  guild_name TEXT,
  channel_id TEXT NOT NULL,
  channel_name TEXT,
  message_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_username TEXT,
  author_display_name TEXT,
  content TEXT,
  referenced_content TEXT,
  matched_rule_id UUID REFERENCES public.guardian_rules(id) ON DELETE SET NULL,
  matched_rule_group_id UUID REFERENCES public.guardian_rule_groups(id) ON DELETE SET NULL,
  matched_rule_group_name TEXT,
  matched_pattern TEXT,
  matched_text TEXT,
  source_type TEXT NOT NULL DEFAULT 'direct' CHECK (source_type IN ('direct', 'reply', 'forward', 'embed')),
  action_taken TEXT DEFAULT 'flagged' CHECK (action_taken IN ('flagged', 'deleted', 'ignored')),
  reviewed_by UUID REFERENCES public.users(id),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  flagged_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guardian_flagged_guild ON public.guardian_flagged_messages(guild_id);
CREATE INDEX IF NOT EXISTS idx_guardian_flagged_author ON public.guardian_flagged_messages(author_id);
CREATE INDEX IF NOT EXISTS idx_guardian_flagged_at ON public.guardian_flagged_messages(flagged_at DESC);
CREATE INDEX IF NOT EXISTS idx_guardian_flagged_group ON public.guardian_flagged_messages(matched_rule_group_id);

-- ─── Message Log (recent window) ─────────────────────────────────────
-- Stores recent scanned messages for dashboard stats.
-- Should be periodically pruned (keep last 7 days).

CREATE TABLE IF NOT EXISTS public.guardian_message_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL UNIQUE,
  author_id TEXT NOT NULL,
  author_username TEXT,
  content_preview TEXT,
  was_flagged BOOLEAN DEFAULT FALSE,
  skip_reason TEXT,
  scanned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.guardian_message_log
  ADD COLUMN IF NOT EXISTS skip_reason TEXT;

DO $$ BEGIN
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
END $$;

CREATE INDEX IF NOT EXISTS idx_guardian_log_scanned_not_skipped
  ON public.guardian_message_log(scanned_at DESC)
  WHERE skip_reason IS NULL;

CREATE INDEX IF NOT EXISTS idx_guardian_log_scanned ON public.guardian_message_log(scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_guardian_log_guild ON public.guardian_message_log(guild_id);

-- ─── Bot Config ───────────────────────────────────────────────────────
-- Stores per-guild configuration for the Demon X bot.

CREATE TABLE IF NOT EXISTS public.guardian_bot_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL UNIQUE,
  guild_name TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  log_channel_id TEXT,
  scan_replies BOOLEAN DEFAULT TRUE,
  scan_forwards BOOLEAN DEFAULT TRUE,
  scan_embeds BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ─── RLS Policies ─────────────────────────────────────────────────────
-- Only users with 'moderator' or 'admin' role can access guardian tables.

ALTER TABLE public.guardian_rule_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_flagged_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_message_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_bot_config ENABLE ROW LEVEL SECURITY;

-- Moderators and admins can read/write all guardian tables
DO $$ BEGIN
  -- Rule Groups
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'guardian_rule_groups' AND policyname = 'Moderators can manage rule groups') THEN
    CREATE POLICY "Moderators can manage rule groups" ON public.guardian_rule_groups
      FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = auth.uid()
          AND (u.roles @> '"moderator"'::jsonb OR u.roles @> '"admin"'::jsonb)
        )
      );
  END IF;

  -- Rules
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'guardian_rules' AND policyname = 'Moderators can manage rules') THEN
    CREATE POLICY "Moderators can manage rules" ON public.guardian_rules
      FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = auth.uid()
          AND (u.roles @> '"moderator"'::jsonb OR u.roles @> '"admin"'::jsonb)
        )
      );
  END IF;

  -- Flagged Messages
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'guardian_flagged_messages' AND policyname = 'Moderators can view flagged messages') THEN
    CREATE POLICY "Moderators can view flagged messages" ON public.guardian_flagged_messages
      FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = auth.uid()
          AND (u.roles @> '"moderator"'::jsonb OR u.roles @> '"admin"'::jsonb)
        )
      );
  END IF;

  -- Message Log
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'guardian_message_log' AND policyname = 'Moderators can view message log') THEN
    CREATE POLICY "Moderators can view message log" ON public.guardian_message_log
      FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = auth.uid()
          AND (u.roles @> '"moderator"'::jsonb OR u.roles @> '"admin"'::jsonb)
        )
      );
  END IF;

  -- Bot Config
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'guardian_bot_config' AND policyname = 'Moderators can manage bot config') THEN
    CREATE POLICY "Moderators can manage bot config" ON public.guardian_bot_config
      FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = auth.uid()
          AND (u.roles @> '"moderator"'::jsonb OR u.roles @> '"admin"'::jsonb)
        )
      );
  END IF;
END $$;


-- END SOURCE: 021_discord_guardian.sql

-- ============================================================
-- BEGIN SOURCE: 022_guardian_flagged_unique.sql
-- ============================================================
-- Migration 022: Add unique constraint on message_id for guardian_flagged_messages
-- Prevents the same message from being flagged multiple times.

-- First, remove duplicates (keep the earliest flagged entry per message_id)
DELETE FROM public.guardian_flagged_messages a
USING public.guardian_flagged_messages b
WHERE a.id > b.id
  AND a.message_id = b.message_id;

-- Add unique constraint
ALTER TABLE public.guardian_flagged_messages
  ADD CONSTRAINT guardian_flagged_messages_message_id_unique UNIQUE (message_id);


-- END SOURCE: 022_guardian_flagged_unique.sql

-- ============================================================
-- BEGIN SOURCE: 023_moderator_role.sql
-- ============================================================
-- Migration 023: Moderator Role Definition & Guardian Access Refinement
--
-- Formally defines the "moderator" role within the Coordination Manager.
-- This role is manually assigned by an admin (not self-service).
-- Admins can overlay the moderator role onto themselves via Settings.
-- Moderators (non-admin) cannot remove the role from themselves.
--
-- ─── Role: moderator ──────────────────────────────────────────────────
--
-- Description:
--   Moderators are trusted community members who oversee Discord moderation
--   through the Discord Guardian system. This role is granted manually by
--   a platform administrator.
--
-- Capabilities:
--   - Access the Discord Guardian moderation dashboard
--   - View flagged messages and message scan logs
--   - Review and take action on flagged content (flag, delete, ignore)
--   - Create, edit, and delete Guardian rule groups
--   - Create, edit, and delete Guardian filter rules (regex/wildcard)
--   - Manage Guardian bot configuration (guilds, channels, scanning options)
--   - View Discord Guardian analytics and statistics
--
-- Limitations (compared to admin):
--   - Cannot manage other users or assign roles
--   - Cannot silence/un-silence user accounts
--   - Cannot access admin-only endpoints or dashboards
--   - Cannot modify platform-wide settings
--
-- Assignment:
--   - For non-admins: Manually granted via SQL by a platform administrator.
--   - For admins: Self-toggle via Settings > Role & Permissions > Moderator Overlay.
--   - Moderators (non-admin) cannot remove the role from themselves.
--   See bottom of this file for the grant/revoke queries.
--
-- Technical:
--   The role is stored in the users.roles JSONB array column.
--   Checked via: hasRole(req, 'moderator') in the API
--   Admin role alone no longer grants Guardian access — admins must
--   enable the Moderator Overlay to get the moderator role added.
--
-- ─── RLS Policy Update ──────────────────────────────────────────────
-- Guardian tables now check ONLY for 'moderator' role (not 'admin').
-- Admins who want Guardian access must have 'moderator' in their roles.

-- Drop old policies that checked for both moderator and admin
DO $$ BEGIN
  -- Rule Groups
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'guardian_rule_groups' AND policyname = 'Moderators can manage rule groups') THEN
    DROP POLICY "Moderators can manage rule groups" ON public.guardian_rule_groups;
  END IF;

  -- Rules
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'guardian_rules' AND policyname = 'Moderators can manage rules') THEN
    DROP POLICY "Moderators can manage rules" ON public.guardian_rules;
  END IF;

  -- Flagged Messages
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'guardian_flagged_messages' AND policyname = 'Moderators can view flagged messages') THEN
    DROP POLICY "Moderators can view flagged messages" ON public.guardian_flagged_messages;
  END IF;

  -- Message Log
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'guardian_message_log' AND policyname = 'Moderators can view message log') THEN
    DROP POLICY "Moderators can view message log" ON public.guardian_message_log;
  END IF;

  -- Bot Config
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'guardian_bot_config' AND policyname = 'Moderators can manage bot config') THEN
    DROP POLICY "Moderators can manage bot config" ON public.guardian_bot_config;
  END IF;
END $$;

-- Recreate policies checking ONLY for moderator role
CREATE POLICY "Moderators can manage rule groups" ON public.guardian_rule_groups
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
      AND u.roles @> '"moderator"'::jsonb
    )
  );

CREATE POLICY "Moderators can manage rules" ON public.guardian_rules
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
      AND u.roles @> '"moderator"'::jsonb
    )
  );

CREATE POLICY "Moderators can view flagged messages" ON public.guardian_flagged_messages
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
      AND u.roles @> '"moderator"'::jsonb
    )
  );

CREATE POLICY "Moderators can view message log" ON public.guardian_message_log
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
      AND u.roles @> '"moderator"'::jsonb
    )
  );

CREATE POLICY "Moderators can manage bot config" ON public.guardian_bot_config
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
      AND u.roles @> '"moderator"'::jsonb
    )
  );

-- ─── Helper: Grant moderator role to a user ──────────────────────────
-- Usage: SELECT grant_moderator_role('user-uuid-here');

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── Helper: Revoke moderator role from a user ──────────────────────
-- Usage: SELECT revoke_moderator_role('user-uuid-here');

CREATE OR REPLACE FUNCTION public.revoke_moderator_role(target_user_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE public.users
  SET roles = roles - 'moderator'
  WHERE id = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── Manual SQL Examples ─────────────────────────────────────────────
--
-- Grant moderator by user ID:
--   SELECT grant_moderator_role('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
--
-- Grant moderator by email:
--   SELECT grant_moderator_role(id) FROM public.users WHERE email = 'user@example.com';
--
-- Revoke moderator:
--   SELECT revoke_moderator_role('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
--
-- List all moderators:
--   SELECT id, name, email FROM public.users WHERE roles @> '"moderator"'::jsonb;


-- END SOURCE: 023_moderator_role.sql

-- ============================================================
-- BEGIN SOURCE: 046_guardian_server_roles.sql
-- ============================================================
-- Migration 046: Discord Guardian — Server Roles & Message Types
-- Adds:
--   1. guardian_server_roles — Cached Discord roles per guild, with ignore toggle
--   2. message_type column on guardian_message_log — Classify empty-content messages

-- ─── Server Roles ─────────────────────────────────────────────────────
-- The bot syncs guild roles here on startup and periodically.
-- Moderators can toggle is_ignored to whitelist certain roles from scanning.

CREATE TABLE IF NOT EXISTS public.guardian_server_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL,
  guild_name TEXT,
  role_id TEXT NOT NULL,
  role_name TEXT NOT NULL,
  role_color INTEGER DEFAULT 0,
  role_position INTEGER DEFAULT 0,
  is_ignored BOOLEAN DEFAULT FALSE,
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(guild_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_guardian_server_roles_guild ON public.guardian_server_roles(guild_id);

-- ─── Message Type on Log ──────────────────────────────────────────────
-- Classify messages so the dashboard can show meaningful info instead of "(no content)"
-- Values: 'text', 'attachment', 'embed', 'sticker', 'system', 'mixed'

ALTER TABLE public.guardian_message_log
  ADD COLUMN IF NOT EXISTS message_type TEXT DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS has_attachments BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS has_embeds BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS attachment_types TEXT;

-- ─── RLS for server roles ─────────────────────────────────────────────

ALTER TABLE public.guardian_server_roles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'guardian_server_roles' AND policyname = 'Moderators can manage server roles') THEN
    CREATE POLICY "Moderators can manage server roles" ON public.guardian_server_roles
      FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = auth.uid()
          AND (u.roles @> '"moderator"'::jsonb OR u.roles @> '"admin"'::jsonb)
        )
      );
  END IF;
END $$;


-- END SOURCE: 046_guardian_server_roles.sql

-- ============================================================
-- BEGIN SOURCE: 047_guardian_edit_tracking.sql
-- ============================================================
-- Migration 047: Guardian Edit Tracking & Server Name in Message Log
-- Changes:
--   1. Drop UNIQUE on guardian_message_log.message_id to allow multiple rows per edit
--   2. Add guild_name, channel_name, edit_version, is_edit to guardian_message_log
--   3. Add edit_version, is_edit to guardian_flagged_messages
--   4. Indexes for edit grouping

-- ─── Message Log: allow multiple rows per message_id (edit versions) ──
ALTER TABLE public.guardian_message_log
  DROP CONSTRAINT IF EXISTS guardian_message_log_message_id_key;

-- ─── Message Log: new columns ─────────────────────────────────────────
ALTER TABLE public.guardian_message_log
  ADD COLUMN IF NOT EXISTS guild_name TEXT,
  ADD COLUMN IF NOT EXISTS channel_name TEXT,
  ADD COLUMN IF NOT EXISTS edit_version INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_edit BOOLEAN DEFAULT FALSE;

-- ─── Flagged Messages: edit tracking ──────────────────────────────────
ALTER TABLE public.guardian_flagged_messages
  ADD COLUMN IF NOT EXISTS edit_version INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_edit BOOLEAN DEFAULT FALSE;

-- ─── Indexes for fast edit grouping ───────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_guardian_log_message_id ON public.guardian_message_log(message_id);
CREATE INDEX IF NOT EXISTS idx_guardian_log_edit ON public.guardian_message_log(message_id, edit_version DESC);
CREATE INDEX IF NOT EXISTS idx_guardian_flagged_message_edit ON public.guardian_flagged_messages(message_id, edit_version DESC);


-- END SOURCE: 047_guardian_edit_tracking.sql

-- ============================================================
-- BEGIN SOURCE: 047_guardian_group_actions.sql
-- ============================================================
-- Migration 047: Guardian Rule Group Actions
-- Adds configurable bot actions per rule group:
--   - Delete flagged message
--   - Timeout the member for a specified duration
--   - Ban the member from the server

ALTER TABLE public.guardian_rule_groups
  ADD COLUMN IF NOT EXISTS action_delete_message BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS action_timeout_member BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS action_timeout_duration INTEGER DEFAULT 60,
  ADD COLUMN IF NOT EXISTS action_ban_member BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN public.guardian_rule_groups.action_delete_message IS 'Delete the flagged message automatically';
COMMENT ON COLUMN public.guardian_rule_groups.action_timeout_member IS 'Timeout the message author for action_timeout_duration seconds';
COMMENT ON COLUMN public.guardian_rule_groups.action_timeout_duration IS 'Timeout duration in seconds (default 60)';
COMMENT ON COLUMN public.guardian_rule_groups.action_ban_member IS 'Ban the message author from the server';

-- Relax the action_taken CHECK to allow comma-separated action strings
-- (e.g. 'flagged,deleted,timeout,banned')
ALTER TABLE public.guardian_flagged_messages DROP CONSTRAINT IF EXISTS guardian_flagged_messages_action_taken_check;


-- END SOURCE: 047_guardian_group_actions.sql

-- ============================================================
-- BEGIN SOURCE: 048_guardian_channel_settings.sql
-- ============================================================
-- Migration 048: Discord Guardian — Channel Monitoring Settings
-- Adds guardian_server_channels table so server owners can disable
-- monitoring on specific channels instead of fiddling with Discord bot permissions.

CREATE TABLE IF NOT EXISTS public.guardian_server_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL,
  guild_name TEXT,
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  channel_type INTEGER DEFAULT 0,        -- Discord channel type enum (0=text, 2=voice, 5=announcement, etc.)
  is_monitored BOOLEAN DEFAULT TRUE,     -- TRUE = bot scans this channel, FALSE = skip
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(guild_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_guardian_server_channels_guild ON public.guardian_server_channels(guild_id);
CREATE INDEX IF NOT EXISTS idx_guardian_server_channels_monitored ON public.guardian_server_channels(guild_id, channel_id) WHERE is_monitored = FALSE;

-- ─── RLS ──────────────────────────────────────────────────────────────

ALTER TABLE public.guardian_server_channels ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'guardian_server_channels' AND policyname = 'Moderators can manage server channels') THEN
    CREATE POLICY "Moderators can manage server channels" ON public.guardian_server_channels
      FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = auth.uid()
          AND (u.roles @> '"moderator"'::jsonb OR u.roles @> '"admin"'::jsonb)
        )
      );
  END IF;
END $$;


-- END SOURCE: 048_guardian_channel_settings.sql

-- ============================================================
-- BEGIN SOURCE: 060_guardian_notifications_and_deletion.sql
-- ============================================================
-- Migration 060: Guardian -- deletion tracking, user notifications, and per-guild notification channels
--
-- Adds:
--   1. Deletion tracking columns on guardian_message_log + guardian_flagged_messages
--      (no new rows -- columns are updated in place when an action is taken)
--   2. DM tracking columns on guardian_flagged_messages so we know we already
--      sent the user their flagged content + reaction prompt
--   3. New guardian_user_responses table to capture reactions ("false flag",
--      "escalate", "republish", "unmute") that users place on the bot's DM
--   4. Two new per-guild notification channel columns on guardian_bot_config:
--        - actions_log_channel_id  (where the bot posts moderation actions)
--        - user_feedback_channel_id (where the bot posts user reaction signals)

-- ---------------------------------------------------------------------
-- 1. Deletion tracking (no new rows -- update existing rows in place)
-- ---------------------------------------------------------------------

ALTER TABLE public.guardian_message_log
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by_kind TEXT
    CHECK (deleted_by_kind IS NULL OR deleted_by_kind IN ('bot', 'user', 'moderator', 'unknown'));

ALTER TABLE public.guardian_flagged_messages
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by_kind TEXT
    CHECK (deleted_by_kind IS NULL OR deleted_by_kind IN ('bot', 'user', 'moderator', 'unknown'));

CREATE INDEX IF NOT EXISTS idx_guardian_log_deleted_at
  ON public.guardian_message_log(deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_guardian_flagged_deleted_at
  ON public.guardian_flagged_messages(deleted_at)
  WHERE deleted_at IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2. DM tracking on flagged messages
-- ---------------------------------------------------------------------

ALTER TABLE public.guardian_flagged_messages
  ADD COLUMN IF NOT EXISTS dm_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dm_message_id TEXT,
  ADD COLUMN IF NOT EXISTS dm_failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS channel_notice_message_id TEXT;

-- Look up flagged record by the DM we sent (used by reaction handler)
CREATE INDEX IF NOT EXISTS idx_guardian_flagged_dm_message_id
  ON public.guardian_flagged_messages(dm_message_id)
  WHERE dm_message_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3. User responses (reactions on the bot's DM)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.guardian_user_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flagged_message_id UUID NOT NULL REFERENCES public.guardian_flagged_messages(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,
  guild_name TEXT,
  channel_id TEXT,
  channel_name TEXT,
  discord_user_id TEXT NOT NULL,
  discord_username TEXT,
  response_kind TEXT NOT NULL CHECK (response_kind IN ('false_flag', 'escalate', 'republish', 'unmute')),
  emoji TEXT,
  notes TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.users(id),
  resolution_kind TEXT CHECK (resolution_kind IS NULL OR resolution_kind IN ('confirmed', 'rejected', 'republished', 'unmuted', 'no_action')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- Idempotency: one row per (flagged_message, user, kind)
  UNIQUE (flagged_message_id, discord_user_id, response_kind)
);

CREATE INDEX IF NOT EXISTS idx_guardian_user_responses_flagged
  ON public.guardian_user_responses(flagged_message_id);
CREATE INDEX IF NOT EXISTS idx_guardian_user_responses_guild
  ON public.guardian_user_responses(guild_id);
CREATE INDEX IF NOT EXISTS idx_guardian_user_responses_unresolved
  ON public.guardian_user_responses(created_at DESC)
  WHERE resolved_at IS NULL;

ALTER TABLE public.guardian_user_responses ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'guardian_user_responses'
      AND policyname = 'Moderators can manage user responses'
  ) THEN
    CREATE POLICY "Moderators can manage user responses" ON public.guardian_user_responses
      FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = auth.uid()
          AND (u.roles @> '"moderator"'::jsonb OR u.roles @> '"admin"'::jsonb)
        )
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 4. Per-guild notification channels
-- ---------------------------------------------------------------------

ALTER TABLE public.guardian_bot_config
  ADD COLUMN IF NOT EXISTS actions_log_channel_id TEXT,
  ADD COLUMN IF NOT EXISTS user_feedback_channel_id TEXT;


-- END SOURCE: 060_guardian_notifications_and_deletion.sql

-- ============================================================
-- BEGIN SOURCE: 061_guardian_seed_invite_rules.sql
-- ============================================================
-- Migration 061: Seed default Discord-invite phishing rules for the Guardian bot
--
-- Real-world scam example that bypassed prior configurations:
--   .-.contact.-.team.<emoji> > >📥👉**<ht > tp > > :////\\\@dis > cord > app > .com/ >
--    invite\<code> > >>**<@<userId>>
--
-- The raw text never contains the literal substring "discord.gg" or
-- "discordapp.com/invite" because Discord markdown control characters
-- (>, *, \, <, >) and stray whitespace fragment the URL. The Guardian bot
-- now scans a deobfuscated variant of the message in addition to the raw
-- text, so the wildcard rules below match both the obfuscated and
-- non-obfuscated forms.
--
-- This migration is idempotent: it only seeds the group + rules if the
-- group does not already exist. Operators may freely edit/disable rules
-- via the Guardian admin UI after seeding.

DO $$
DECLARE
  group_uuid UUID;
BEGIN
  -- Skip if a group with this exact name already exists
  SELECT id INTO group_uuid
  FROM public.guardian_rule_groups
  WHERE name = 'Discord Invite Links (default)'
  LIMIT 1;

  IF group_uuid IS NULL THEN
    INSERT INTO public.guardian_rule_groups (
      name,
      description,
      is_enabled,
      action_delete_message,
      action_timeout_member,
      action_timeout_duration,
      action_ban_member
    ) VALUES (
      'Discord Invite Links (default)',
      'Catches off-server Discord invite links (discord.gg, discord.com/invite, discordapp.com/invite) including obfuscated variants. Same-server channel links are excluded by the bot.',
      TRUE,
      TRUE,   -- delete the message
      FALSE,  -- do not timeout by default; admins can opt in
      60,
      FALSE
    )
    RETURNING id INTO group_uuid;

    INSERT INTO public.guardian_rules (group_id, pattern, pattern_type, description, is_enabled) VALUES
      (group_uuid, '*discord.gg/*',            'wildcard', 'discord.gg invite domain',                     TRUE),
      (group_uuid, '*discord.com/invite*',     'wildcard', 'Canonical Discord invite path',                TRUE),
      (group_uuid, '*discordapp.com/invite*',  'wildcard', 'Legacy discordapp.com invite path',            TRUE),
      (group_uuid, '*discord.com/servers/*',   'wildcard', 'Discord server discovery share links',         TRUE),
      -- Regex catches scheme-prefixed invites with optional userinfo (e.g. "://@discord.com/invite/...")
      (group_uuid, '(?:https?:)?\/{2,}(?:[^\s/@]*@)?discord(?:app)?\.com\/invite\/[A-Za-z0-9-]+', 'regex',
        'Scheme + optional userinfo prefix on canonical invite URL', TRUE),
      (group_uuid, '(?:https?:)?\/{2,}(?:[^\s/@]*@)?discord\.gg\/[A-Za-z0-9-]+', 'regex',
        'Scheme + optional userinfo prefix on discord.gg invite URL', TRUE);
  END IF;
END $$;


-- END SOURCE: 061_guardian_seed_invite_rules.sql

-- ============================================================
-- BEGIN SOURCE: 062_guardian_renumber_duplicate_versions.sql
-- ============================================================
-- Backfill: renumber duplicate v1 rows that came from gateway resumes /
-- duplicate MessageCreate deliveries. The bot now bumps edit_version on
-- repeat inserts (see logMessage / logFlaggedMessage), but rows written
-- before that fix all share edit_version = 1, which makes them appear as
-- separate "first versions" of the same message in the dashboard.
--
-- For each (message_id) that has more than one row, renumber them by
-- chronological insert order (oldest = v1, next = v2, ...) and mark the
-- non-first rows as is_edit = true. Idempotent: the WHERE clause restricts
-- the update to message_ids that actually have duplicates, and the row_number()
-- ordering is deterministic so re-running yields the same numbers.

-- guardian_message_log
DO $$
BEGIN
  WITH ranked AS (
    SELECT
      id,
      ROW_NUMBER() OVER (PARTITION BY message_id ORDER BY scanned_at, id) AS rn
    FROM guardian_message_log
    WHERE message_id IN (
      SELECT message_id
      FROM guardian_message_log
      WHERE message_id IS NOT NULL AND message_id <> ''
      GROUP BY message_id
      HAVING COUNT(*) > 1
    )
  )
  UPDATE guardian_message_log m
  SET edit_version = r.rn,
      is_edit = (r.rn > 1)
  FROM ranked r
  WHERE m.id = r.id
    AND (m.edit_version IS DISTINCT FROM r.rn OR m.is_edit IS DISTINCT FROM (r.rn > 1));
END $$;

-- guardian_flagged_messages
DO $$
BEGIN
  WITH ranked AS (
    SELECT
      id,
      ROW_NUMBER() OVER (PARTITION BY message_id ORDER BY flagged_at, id) AS rn
    FROM guardian_flagged_messages
    WHERE message_id IN (
      SELECT message_id
      FROM guardian_flagged_messages
      WHERE message_id IS NOT NULL AND message_id <> ''
      GROUP BY message_id
      HAVING COUNT(*) > 1
    )
  )
  UPDATE guardian_flagged_messages f
  SET edit_version = r.rn,
      is_edit = (r.rn > 1)
  FROM ranked r
  WHERE f.id = r.id
    AND (f.edit_version IS DISTINCT FROM r.rn OR f.is_edit IS DISTINCT FROM (r.rn > 1));
END $$;


-- END SOURCE: 062_guardian_renumber_duplicate_versions.sql

-- ============================================================
-- BEGIN SOURCE: 063_guardian_state_checked_at.sql
-- ============================================================
-- Track when each guardian message had its live state (deleted yes/no) verified
-- against the Discord REST API. This lets the dashboard reconcile only rows
-- that have not been recently checked, and lets us "freeze" rows that have
-- been verified at least once after the 3-day observation window without
-- needing repeated polling.

ALTER TABLE guardian_message_log
  ADD COLUMN IF NOT EXISTS state_checked_at TIMESTAMPTZ;

ALTER TABLE guardian_flagged_messages
  ADD COLUMN IF NOT EXISTS state_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_guardian_message_log_state_checked_at
  ON guardian_message_log (state_checked_at);

CREATE INDEX IF NOT EXISTS idx_guardian_flagged_messages_state_checked_at
  ON guardian_flagged_messages (state_checked_at);


-- END SOURCE: 063_guardian_state_checked_at.sql

-- ============================================================
-- BEGIN SOURCE: 066_guardian_action_log.sql
-- ============================================================
-- Migration 066: Guardian -- per-action audit log
--
-- Adds a dedicated table that records ONE row per moderation action taken
-- by the bot (flag, delete, mute, ban). This enables a clean breakdown
-- chart ("Activity Over Time" by action type) and per-user/per-rule
-- aggregations that the comma-separated action_taken column cannot
-- support without parsing.
--
-- Backwards compatibility: guardian_flagged_messages.action_taken is
-- still written (legacy consumers depend on it). The new table is an
-- additive, normalised mirror.

CREATE TABLE IF NOT EXISTS public.guardian_action_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What action was taken
  action TEXT NOT NULL CHECK (action IN ('flag', 'delete', 'mute', 'ban', 'unban', 'unmute')),
  -- Why it was taken
  matched_rule_id UUID REFERENCES public.guardian_rules(id) ON DELETE SET NULL,
  matched_rule_group_id UUID REFERENCES public.guardian_rule_groups(id) ON DELETE SET NULL,
  matched_rule_group_name TEXT,
  matched_pattern TEXT,
  matched_text TEXT,
  source_type TEXT CHECK (source_type IN ('direct', 'reply', 'forward', 'embed')),

  -- Who/where
  guild_id TEXT NOT NULL,
  guild_name TEXT,
  channel_id TEXT,
  channel_name TEXT,
  message_id TEXT,
  author_id TEXT,
  author_username TEXT,

  -- Action-specific extras
  duration_seconds INTEGER,         -- non-null for action='mute'
  actor_kind TEXT NOT NULL DEFAULT 'bot'
    CHECK (actor_kind IN ('bot', 'user', 'moderator', 'unknown')),
  success BOOLEAN NOT NULL DEFAULT true,
  failure_reason TEXT,

  -- Cross-reference back to the flagged message row (best effort)
  flagged_message_id UUID REFERENCES public.guardian_flagged_messages(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guardian_action_log_created_at
  ON public.guardian_action_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_guardian_action_log_guild_action_time
  ON public.guardian_action_log(guild_id, action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_guardian_action_log_author
  ON public.guardian_action_log(author_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_guardian_action_log_message
  ON public.guardian_action_log(message_id);

ALTER TABLE public.guardian_action_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'guardian_action_log'
      AND policyname = 'Moderators can read action log'
  ) THEN
    CREATE POLICY "Moderators can read action log" ON public.guardian_action_log
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = auth.uid()
          AND (u.roles @> '"moderator"'::jsonb OR u.roles @> '"admin"'::jsonb)
        )
      );
  END IF;
END $$;

-- Only the service role (bot) inserts; no policy needed for INSERT/UPDATE
-- because RLS denies by default and the bot uses SUPABASE_SERVICE_ROLE_KEY
-- which bypasses RLS.

COMMENT ON TABLE public.guardian_action_log IS
  'One row per moderation action taken by Demon X. Powers the Activity Over Time chart and per-action aggregations.';


-- END SOURCE: 066_guardian_action_log.sql

-- ============================================================
-- BEGIN SOURCE: 067_guardian_instance_lock.sql
-- ============================================================
-- Migration 067: Guardian -- singleton instance lock
--
-- When more than one guardian bot process is running (e.g. local dev + Railway
-- production both connected to Discord, possibly with different tokens but
-- watching the same guild), Discord can deliver events to both, causing
-- duplicate actions (double DMs, duplicate flag rows, duplicate deletes).
--
-- This table acts as a singleton "leader lease". All guardian instances
-- connect to Discord and keep their gateway warm, but only the instance that
-- currently owns the lease acts on events. The lease is renewed via heartbeat
-- and considered stale if not refreshed within the staleness window, allowing
-- automatic failover when the active instance crashes or is restarted.
--
-- Local dev can intentionally steal the lease via GUARDIAN_FORCE_TAKEOVER=true
-- to test the latest code path while production stays connected but idle.

CREATE TABLE IF NOT EXISTS public.guardian_instance_lock (
  -- Singleton row: only one row ever exists in this table.
  id TEXT PRIMARY KEY DEFAULT 'singleton' CHECK (id = 'singleton'),

  -- Unique per-process identifier (uuid generated at boot).
  instance_id TEXT NOT NULL,

  -- Human-readable label for ops visibility (e.g. 'local-dev', 'railway-prod').
  instance_label TEXT,

  -- When this instance first acquired the current lease.
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Last heartbeat from the lease holder. Used to detect stale leases.
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Service role only -- bot writes via SUPABASE_SERVICE_ROLE_KEY.
ALTER TABLE public.guardian_instance_lock ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'guardian_instance_lock'
      AND policyname = 'guardian_instance_lock_deny_all'
  ) THEN
    CREATE POLICY guardian_instance_lock_deny_all
      ON public.guardian_instance_lock
      FOR ALL
      USING (false)
      WITH CHECK (false);
  END IF;
END $$;

COMMENT ON TABLE public.guardian_instance_lock IS
  'Singleton leader-lease for the Discord guardian bot. Only the instance whose instance_id matches the row acts on Discord events; others stay connected but idle. Renewed via heartbeat; auto-failover when stale.';


-- END SOURCE: 067_guardian_instance_lock.sql

-- ============================================================
-- BEGIN SOURCE: 068_guardian_instance_lock_force_rls.sql
-- ============================================================
-- Migration 068: Guardian instance lock -- FORCE row-level security
--
-- Migration 067 created guardian_instance_lock with a "deny all" policy and
-- ENABLE ROW LEVEL SECURITY, but did not FORCE it. Without FORCE, the table
-- owner (e.g. the supabase admin role) can bypass RLS, which weakens the
-- "only the service role writes to this table" guarantee documented on the
-- table comment. The Discord guardian bot already uses SUPABASE_SERVICE_ROLE_KEY
-- (which bypasses RLS regardless), so adding FORCE has no functional impact
-- on the bot but closes the owner-bypass gap. Matches the FORCE pattern used
-- by migration 065 on agent_api_keys.

ALTER TABLE public.guardian_instance_lock FORCE ROW LEVEL SECURITY;


-- END SOURCE: 068_guardian_instance_lock_force_rls.sql

-- ============================================================
-- BEGIN SOURCE: 069_guardian_category_monitoring.sql
-- ============================================================
-- Migration 069: Guardian -- category-level monitoring defaults + auto-monitor toggle
--
-- 1. guardian_server_channels.parent_id -- Discord category (parent channel)
--    id, so categories can be synced/toggled as their own rows (channel_type
--    = 4) and text/voice channels can be grouped under them in the UI.
--    A category's is_monitored value is used only as the DEFAULT applied to
--    channels newly discovered under it -- it never overrides an existing
--    per-channel toggle (per-channel setting always wins).
--
-- 2. guardian_bot_config.default_monitor_new_channels -- per-guild fallback
--    default used when a brand-new channel/category is discovered and it has
--    no category default to inherit from.

ALTER TABLE public.guardian_server_channels
  ADD COLUMN IF NOT EXISTS parent_id TEXT;

COMMENT ON COLUMN public.guardian_server_channels.parent_id IS 'Discord category (parent) channel_id, if any. Categories are stored as their own rows with channel_type = 4.';

CREATE INDEX IF NOT EXISTS idx_guardian_server_channels_parent ON public.guardian_server_channels(guild_id, parent_id);

ALTER TABLE public.guardian_bot_config
  ADD COLUMN IF NOT EXISTS default_monitor_new_channels BOOLEAN DEFAULT TRUE;

COMMENT ON COLUMN public.guardian_bot_config.default_monitor_new_channels IS 'Fallback monitoring default applied when a newly discovered channel/category has no category default to inherit from.';


-- END SOURCE: 069_guardian_category_monitoring.sql

-- ============================================================
-- BEGIN SOURCE: 070_guardian_thread_monitoring.sql
-- ============================================================
-- Migration 070: Guardian -- thread parent relationships and monitoring defaults
--
-- NULL means inherit the default from the related channel/category or guild.
ALTER TABLE public.guardian_server_channels
  ADD COLUMN IF NOT EXISTS default_monitor_new_threads BOOLEAN;

COMMENT ON COLUMN public.guardian_server_channels.default_monitor_new_threads IS 'Default monitoring state for threads created under this channel or category; NULL inherits.';

-- END SOURCE: 070_guardian_thread_monitoring.sql

-- Guardian ban registry (025_guardian_ban_registry.sql).
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

-- Global Ban List (027_guardian_global_bans.sql).
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

-- Guardian Ban List management (028_guardian_ban_management.sql).
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

-- BEGIN SOURCE: 037_guardian_undo_actions.sql
-- Migration 037: Guardian -- moderator undo actions in the action log
--
-- Moderators can undo a moderation action from the Guardian dashboard
-- (unban a user, remove a Discord timeout). Each undo writes one
-- guardian_action_log row with action 'unban' or 'unmute',
-- actor_kind = 'moderator' (already allowed) and the platform user who
-- acted in actor_user_id.
--
-- Idempotent: safe to run more than once.

-- 1. Allow the undo actions in the action CHECK. The original inline CHECK
--    from 066_guardian_action_log.sql is named guardian_action_log_action_check.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.guardian_action_log'::regclass
      AND conname = 'guardian_action_log_action_check'
      AND pg_get_constraintdef(oid) LIKE '%unmute%'
  ) THEN
    ALTER TABLE public.guardian_action_log
      DROP CONSTRAINT IF EXISTS guardian_action_log_action_check;
    ALTER TABLE public.guardian_action_log
      ADD CONSTRAINT guardian_action_log_action_check
      CHECK (action IN ('flag', 'delete', 'mute', 'ban', 'unban', 'unmute'));
  END IF;
END $$;

-- 2. Record which platform moderator performed a manual action.
--    NULL for bot actions.
ALTER TABLE public.guardian_action_log
  ADD COLUMN IF NOT EXISTS actor_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_guardian_action_log_actor_user
  ON public.guardian_action_log(actor_user_id)
  WHERE actor_user_id IS NOT NULL;

COMMENT ON COLUMN public.guardian_action_log.actor_user_id IS
  'Platform user (moderator) who performed a manual action such as unban/unmute; NULL for bot actions.';
-- END SOURCE: 037_guardian_undo_actions.sql
