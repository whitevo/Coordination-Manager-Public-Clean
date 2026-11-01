-- Consolidated feature migration file: feature-announcements-and-comms
-- Generated from incremental files for easier agent navigation.
-- Keep statements idempotent when adding future changes.

-- ============================================================
-- BEGIN SOURCE: 001_dm_opt_outs.sql
-- ============================================================
-- ============================================================
-- DM Opt-Outs & First-Contact Tracking
-- Run this in Supabase SQL Editor on existing databases.
-- For fresh installs, 000_full_schema.sql includes these tables.
-- ============================================================

-- DM Opt-Outs: recipients can block DMs from specific senders (or all)
CREATE TABLE IF NOT EXISTS dm_opt_outs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  recipient_discord_id TEXT NOT NULL,          -- Discord user who opted out
  sender_user_id UUID REFERENCES public.users(id) ON DELETE CASCADE, -- NULL = block all bot DMs

  reason TEXT,                                 -- Optional feedback: 'spam', 'unwanted', etc.

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique: one opt-out per recipient+sender pair (NULL sender = global opt-out)
CREATE UNIQUE INDEX IF NOT EXISTS idx_dm_opt_outs_unique
  ON dm_opt_outs(recipient_discord_id, COALESCE(sender_user_id, '00000000-0000-0000-0000-000000000000'));

CREATE INDEX IF NOT EXISTS idx_dm_opt_outs_recipient
  ON dm_opt_outs(recipient_discord_id);

COMMENT ON TABLE dm_opt_outs IS 'DM recipients who opted out of receiving messages from specific senders or all bot DMs';

-- First-Contact Tracking: track when a sender first DMs a recipient
-- so we only send the intro message once per sender→recipient pair
CREATE TABLE IF NOT EXISTS dm_first_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  sender_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  recipient_discord_id TEXT NOT NULL,

  first_sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dm_first_contacts_unique
  ON dm_first_contacts(sender_user_id, recipient_discord_id);

COMMENT ON TABLE dm_first_contacts IS 'Tracks first-contact between platform senders and DM recipients for intro message logic';


-- END SOURCE: 001_dm_opt_outs.sql

-- ============================================================
-- BEGIN SOURCE: 015_announcement_is_immediate.sql
-- ============================================================
-- 015: Add is_immediate flag to announcement_schedules
-- Distinguishes "Send Now" (Posted) from future "Schedule" (Scheduled) for attribution text

ALTER TABLE public.announcement_schedules
ADD COLUMN IF NOT EXISTS is_immediate BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.announcement_schedules.is_immediate IS
  'True when created via Send Now, false when scheduled for future delivery. Controls attribution text (Posted vs Scheduled).';


-- END SOURCE: 015_announcement_is_immediate.sql

-- ============================================================
-- BEGIN SOURCE: 016_announcement_template_targets.sql
-- ============================================================
-- ============================================================
-- 016: Add distribution targets and meeting context to announcement templates
-- Adds columns so templates can persist:
--   • meeting_ids — selected meeting UUIDs for attached context
--   • distribution_channel_ids — selected Discord channel IDs
--   • dm_recipient_ids — selected DM recipient Discord user IDs
-- ============================================================

ALTER TABLE public.announcement_templates
  ADD COLUMN IF NOT EXISTS meeting_ids TEXT[] DEFAULT '{}';

ALTER TABLE public.announcement_templates
  ADD COLUMN IF NOT EXISTS distribution_channel_ids TEXT[] DEFAULT '{}';

ALTER TABLE public.announcement_templates
  ADD COLUMN IF NOT EXISTS dm_recipient_ids TEXT[] DEFAULT '{}';

COMMENT ON COLUMN public.announcement_templates.meeting_ids IS
  'Array of meeting UUIDs whose context is attached to this template';

COMMENT ON COLUMN public.announcement_templates.distribution_channel_ids IS
  'Array of Discord channel IDs selected as distribution targets';

COMMENT ON COLUMN public.announcement_templates.dm_recipient_ids IS
  'Array of Discord user IDs selected as DM recipients';


-- END SOURCE: 016_announcement_template_targets.sql

-- ============================================================
-- BEGIN SOURCE: 025_email_contacts.sql
-- ============================================================
-- ============================================================
-- Email Contacts & Privacy Preferences
-- Stores manually-added email contacts, notification preferences,
-- privacy visibility settings, and connection invites.
-- ============================================================

-- Email contacts: manually collected emails for announcement distribution
CREATE TABLE IF NOT EXISTS email_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  owner_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT,                           -- Optional label for the contact

  -- Source tracking: how was this email obtained?
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'platform_verified', 'both')),

  -- If the email owner has created an account, link it
  linked_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,

  -- Opt-out: if the email owner opts out from this sender
  opted_out BOOLEAN NOT NULL DEFAULT FALSE,
  opted_out_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_contacts_owner_email
  ON email_contacts(owner_user_id, email);

CREATE INDEX IF NOT EXISTS idx_email_contacts_linked_user
  ON email_contacts(linked_user_id) WHERE linked_user_id IS NOT NULL;

COMMENT ON TABLE email_contacts IS 'Manually collected email contacts for announcement distribution';

-- Notification preferences: what kind of messages a user wants to receive
CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- Preference description: free-text describing what messages they want
  preference_description TEXT,

  -- Channel preferences: which channels they prefer
  preferred_channels TEXT[] DEFAULT '{}',

  -- Visibility: who can see these preferences
  -- 'private' = only the user, 'followers' = calendar followers, 'contacts' = connected contacts, 'public' = everyone
  preference_visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (preference_visibility IN ('private', 'followers', 'contacts', 'public')),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT notification_preferences_user_unique UNIQUE (user_id)
);

COMMENT ON TABLE notification_preferences IS 'User notification preferences and channel tuning settings';

-- Privacy visibility settings: granular privacy controls
CREATE TABLE IF NOT EXISTS privacy_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- Multiple privacy levels can be active simultaneously (except public overrides)
  private_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  followers_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  contacts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  public_enabled BOOLEAN NOT NULL DEFAULT FALSE,

  -- Per-level feature toggles (what data to share at each level)
  followers_show_email BOOLEAN NOT NULL DEFAULT FALSE,
  followers_show_preferences BOOLEAN NOT NULL DEFAULT FALSE,
  followers_allow_connection_requests BOOLEAN NOT NULL DEFAULT FALSE,

  contacts_show_email BOOLEAN NOT NULL DEFAULT FALSE,
  contacts_show_preferences BOOLEAN NOT NULL DEFAULT FALSE,
  contacts_allow_connection_requests BOOLEAN NOT NULL DEFAULT FALSE,

  public_show_email BOOLEAN NOT NULL DEFAULT FALSE,
  public_show_preferences BOOLEAN NOT NULL DEFAULT FALSE,
  public_allow_connection_requests BOOLEAN NOT NULL DEFAULT FALSE,

  -- Snapshot of public features at the time public was enabled (for outdated detection)
  public_features_snapshot JSONB,
  public_enabled_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT privacy_settings_user_unique UNIQUE (user_id)
);

COMMENT ON TABLE privacy_settings IS 'Granular privacy visibility settings per user';

-- Connection invites: URL-based invite codes for connecting contacts
CREATE TABLE IF NOT EXISTS connection_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  sender_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  invite_code TEXT NOT NULL UNIQUE,

  -- The invite can only be used once
  used_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  used_at TIMESTAMPTZ,

  -- Status of the connection
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'connected', 'declined', 'ignored')),

  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connection_invites_sender
  ON connection_invites(sender_user_id);

CREATE INDEX IF NOT EXISTS idx_connection_invites_code
  ON connection_invites(invite_code);

COMMENT ON TABLE connection_invites IS 'URL-based invite codes for connecting contacts between users';

-- User connections: established connections between users
CREATE TABLE IF NOT EXISTS user_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_a_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  user_b_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  invite_id UUID REFERENCES connection_invites(id) ON DELETE SET NULL,

  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'disconnected')),

  created_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT user_connections_unique UNIQUE (user_a_id, user_b_id),
  CONSTRAINT user_connections_no_self CHECK (user_a_id != user_b_id)
);

COMMENT ON TABLE user_connections IS 'Established connections between platform users';

-- Email opt-outs: global opt-out for email from Coordination Manager
CREATE TABLE IF NOT EXISTS email_opt_outs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  email TEXT NOT NULL,
  sender_user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,  -- NULL = opt out from all

  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_opt_outs_unique
  ON email_opt_outs(email, COALESCE(sender_user_id, '00000000-0000-0000-0000-000000000000'));

COMMENT ON TABLE email_opt_outs IS 'Email recipients who opted out of receiving messages';


-- END SOURCE: 025_email_contacts.sql

-- ============================================================
-- BEGIN SOURCE: 026_invite_48h_cleanup.sql
-- ============================================================
-- Migration: Auto-delete expired invite codes after 48 hours
-- Invites now expire after 48h (changed from 30 days).
-- This migration adds a scheduled cleanup function.

-- 1. Create the cleanup function
CREATE OR REPLACE FUNCTION cleanup_expired_invites()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM connection_invites
  WHERE status = 'pending'
    AND created_at < NOW() - INTERVAL '48 hours';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION cleanup_expired_invites IS 'Deletes pending invite codes older than 48 hours';

-- 2. Update existing pending invites to have 48h expiry from their creation time
UPDATE connection_invites
SET expires_at = created_at + INTERVAL '48 hours'
WHERE status = 'pending'
  AND (expires_at IS NULL OR expires_at > created_at + INTERVAL '48 hours');

-- 3. Schedule via pg_cron (runs every hour). Supabase has pg_cron enabled by default.
--    If pg_cron is not available, this will be skipped gracefully.
DO $$
BEGIN
  -- Remove old schedule if it exists
  PERFORM cron.unschedule('cleanup-expired-invites');
EXCEPTION WHEN OTHERS THEN
  NULL; -- ignore if doesn't exist
END;
$$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'cleanup-expired-invites',
    '0 * * * *', -- every hour
    'SELECT cleanup_expired_invites()'
  );
  RAISE NOTICE 'pg_cron job scheduled: cleanup-expired-invites (hourly)';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not available -- run cleanup_expired_invites() manually or via external scheduler';
END;
$$;


-- END SOURCE: 026_invite_48h_cleanup.sql

-- ============================================================
-- BEGIN SOURCE: 027_user_smtp_configs.sql
-- ============================================================
-- Migration: User SMTP configurations for email announcements
-- Allows users to store their own SMTP credentials to send emails from their own address.
-- Falls back to platform default (SMTP_USER) when no user config exists.

-- 1. Create the user_smtp_configs table
CREATE TABLE IF NOT EXISTS user_smtp_configs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_address  TEXT NOT NULL,          -- sender address, e.g. user@gmail.com
  smtp_host      TEXT NOT NULL DEFAULT 'smtp.gmail.com',
  smtp_port      INTEGER NOT NULL DEFAULT 587,
  smtp_secure    BOOLEAN NOT NULL DEFAULT false, -- true for port 465 (SSL), false for STARTTLS
  smtp_password_encrypted TEXT NOT NULL,  -- AES-256-GCM encrypted app password
  display_name   TEXT,                    -- optional: "John Doe" shown in From header
  is_verified    BOOLEAN NOT NULL DEFAULT false, -- set true after a successful test send
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One SMTP config per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_smtp_configs_user
  ON user_smtp_configs(user_id);

-- RLS
ALTER TABLE user_smtp_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_smtp_configs_owner ON user_smtp_configs
  FOR ALL USING (user_id = auth.uid());

COMMENT ON TABLE user_smtp_configs IS 'Per-user SMTP credentials for sending email announcements from their own address';
COMMENT ON COLUMN user_smtp_configs.smtp_password_encrypted IS 'AES-256-GCM encrypted SMTP password. Encryption key is held server-side only (SMTP_ENCRYPTION_KEY env var).';

-- 2. updated_at trigger
CREATE OR REPLACE FUNCTION update_user_smtp_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_user_smtp_configs_updated_at ON user_smtp_configs;
CREATE TRIGGER trigger_user_smtp_configs_updated_at
  BEFORE UPDATE ON user_smtp_configs
  FOR EACH ROW EXECUTE FUNCTION update_user_smtp_configs_updated_at();


-- END SOURCE: 027_user_smtp_configs.sql

-- ============================================================
-- BEGIN SOURCE: 028_email_verification.sql
-- ============================================================
-- 028: Email verification system + email_subject on announcement_schedules

-- ── Add email_subject column to announcement_schedules ─────────────────────
ALTER TABLE announcement_schedules
  ADD COLUMN IF NOT EXISTS email_subject TEXT DEFAULT NULL;

COMMENT ON COLUMN announcement_schedules.email_subject IS 'Separate subject line for email targets (overrides title for emails)';

-- ── Verified emails table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS verified_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verification_method TEXT NOT NULL DEFAULT 'code'
    CHECK (verification_method IN ('google_oauth', 'code')),
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, email)
);

CREATE INDEX IF NOT EXISTS idx_verified_emails_user ON verified_emails(user_id);
CREATE INDEX IF NOT EXISTS idx_verified_emails_email ON verified_emails(email);

ALTER TABLE verified_emails ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'verified_emails' AND policyname = 'Users manage own verified emails') THEN
    CREATE POLICY "Users manage own verified emails" ON verified_emails FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

COMMENT ON TABLE verified_emails IS 'User-verified email addresses for sender attribution';

-- ── Email verification codes table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_verification_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_codes_user ON email_verification_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_email ON email_verification_codes(email);

ALTER TABLE email_verification_codes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'email_verification_codes' AND policyname = 'Users manage own verification codes') THEN
    CREATE POLICY "Users manage own verification codes" ON email_verification_codes FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

-- ── Email verification timeouts (abuse protection) ─────────────────────────
CREATE TABLE IF NOT EXISTS email_verification_timeouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  timeout_until TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '48 hours'),
  report_token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_timeouts_email ON email_verification_timeouts(email);
CREATE INDEX IF NOT EXISTS idx_email_verification_timeouts_token ON email_verification_timeouts(report_token);

-- No RLS needed - accessed via service role only

COMMENT ON TABLE email_verification_timeouts IS 'Abuse protection: blocks verification emails for 48h after report';

-- ── Updated-at triggers ────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trigger_verified_emails_updated_at ON verified_emails;
CREATE TRIGGER trigger_verified_emails_updated_at
  BEFORE UPDATE ON verified_emails FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- END SOURCE: 028_email_verification.sql

-- ============================================================
-- BEGIN SOURCE: 033_email_contact_tags.sql
-- ============================================================
-- ============================================================
-- Add tags column to email_contacts
-- Stores comma-separated or JSON array of tags for grouping contacts
-- ============================================================

ALTER TABLE email_contacts
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_email_contacts_tags
  ON email_contacts USING GIN (tags);

COMMENT ON COLUMN email_contacts.tags IS 'Array of user-defined tags for grouping contacts';


-- END SOURCE: 033_email_contact_tags.sql

-- ============================================================
-- BEGIN SOURCE: 050_dm_opt_ins.sql
-- ============================================================
-- ============================================================
-- DM Opt-Ins: recipients who explicitly opted in to reminders & updates
-- ============================================================

CREATE TABLE IF NOT EXISTS dm_opt_ins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  recipient_discord_id TEXT NOT NULL,          -- Discord user who opted in
  sender_user_id UUID REFERENCES public.users(id) ON DELETE CASCADE, -- NULL = opted in globally

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique: one opt-in per recipient+sender pair (NULL sender = global opt-in)
CREATE UNIQUE INDEX IF NOT EXISTS idx_dm_opt_ins_unique
  ON dm_opt_ins(recipient_discord_id, COALESCE(sender_user_id, '00000000-0000-0000-0000-000000000000'));

CREATE INDEX IF NOT EXISTS idx_dm_opt_ins_recipient
  ON dm_opt_ins(recipient_discord_id);

COMMENT ON TABLE dm_opt_ins IS 'DM recipients who explicitly opted in to receiving reminders and updates';

-- Enable RLS
ALTER TABLE dm_opt_ins ENABLE ROW LEVEL SECURITY;


-- END SOURCE: 050_dm_opt_ins.sql

-- ============================================================
-- BEGIN SOURCE: 052_dm_subscription_status.sql
-- ============================================================
-- Migration 052: Add subscription status to dm_calendar_invites
-- Consolidates per-calendar subscription state into a single status column.
-- Statuses: invited (first DM sent, awaiting response), subscribed, unsubscribed, opted_out

-- 1. Add status column with default 'invited'
ALTER TABLE dm_calendar_invites
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited', 'subscribed', 'unsubscribed', 'opted_out'));

-- 2. Add optional CM user link (populated when Discord account is linked)
ALTER TABLE dm_calendar_invites
  ADD COLUMN IF NOT EXISTS cm_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 3. Add updated_at for tracking status changes
ALTER TABLE dm_calendar_invites
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 4. Index for fast status lookups by calendar (API uses this to enrich DM members table)
CREATE INDEX IF NOT EXISTS idx_dm_calendar_invites_calendar_status
  ON dm_calendar_invites (calendar_id, status);

-- 5. Index for fast lookup by discord user (retroactive linking query)
CREATE INDEX IF NOT EXISTS idx_dm_calendar_invites_discord_user
  ON dm_calendar_invites (recipient_discord_id);

-- 6. Backfill existing rows: mark any invite that has a matching dm_opt_ins row as 'subscribed'
UPDATE dm_calendar_invites inv
SET status = 'subscribed', updated_at = NOW()
WHERE EXISTS (
  SELECT 1 FROM dm_opt_ins oi
  WHERE oi.recipient_discord_id = inv.recipient_discord_id
    AND oi.calendar_id = inv.calendar_id
);

-- 7. Backfill: link cm_user_id from discord_integrations where possible
UPDATE dm_calendar_invites inv
SET cm_user_id = di.user_id
FROM discord_integrations di
WHERE di.discord_user_id = inv.recipient_discord_id
  AND di.is_active = true
  AND inv.cm_user_id IS NULL;


-- END SOURCE: 052_dm_subscription_status.sql

-- ============================================================
-- BEGIN SOURCE: 053_delivery_log_recipient_response.sql
-- ============================================================
-- Migration 053: Add recipient_response to announcement_delivery_log
-- Stores the subscription status at the time of delivery (historical snapshot).
-- Values: 'invited', 'subscribed', 'unsubscribed', 'opted_out', 'muted_bot', or NULL for non-DM / pre-migration entries.

ALTER TABLE announcement_delivery_log
  ADD COLUMN IF NOT EXISTS recipient_response TEXT DEFAULT NULL;

COMMENT ON COLUMN announcement_delivery_log.recipient_response IS
  'Subscription status snapshot at delivery time. NULL for non-DM channels or pre-migration entries.';


-- END SOURCE: 053_delivery_log_recipient_response.sql

-- ============================================================
-- BEGIN SOURCE: 054_partially_sent_status.sql
-- ============================================================
-- Migration 054: Add 'partially_sent' to announcement_schedules status check constraint
-- When some DMs succeed but others fail, the bot sets partially_sent

-- Drop old constraint and recreate with the new value
ALTER TABLE announcement_schedules DROP CONSTRAINT IF EXISTS announcement_schedules_status_check;
ALTER TABLE announcement_schedules
  ADD CONSTRAINT announcement_schedules_status_check
  CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'cancelled', 'partially_sent'));


-- END SOURCE: 054_partially_sent_status.sql

-- ============================================================
-- BEGIN SOURCE: 055_announcement_source_env.sql
-- ============================================================
-- Migration 055: Add source_env to announcement_schedules
-- Prevents Railway (production) bot from claiming localhost (development) schedules and vice versa.
-- Each bot filters by its own NODE_ENV when polling for pending work.

ALTER TABLE announcement_schedules
  ADD COLUMN IF NOT EXISTS source_env TEXT DEFAULT 'production';

-- Backfill: mark all existing rows as production (they were created on the live platform)
UPDATE announcement_schedules SET source_env = 'production' WHERE source_env IS NULL;

-- Index for the bot poll query (status + source_env)
CREATE INDEX IF NOT EXISTS idx_announcement_schedules_env_pending
  ON announcement_schedules(status, source_env) WHERE status = 'pending';


-- END SOURCE: 055_announcement_source_env.sql

-- BEGIN SOURCE: 036_announcement_message_deletion.sql
-- Migration 036: Track sender-initiated deletion of posted Discord announcement messages
--
-- A sender can delete the Discord channel posts and DMs that an announcement
-- already delivered. The API (service role) records the outcome per delivery
-- log row: deleted_at when the Discord message is gone (or was already gone),
-- delete_error when the bot could not delete it. Email deliveries cannot be
-- recalled and are never marked.
--
-- RLS: no change. The existing "Users view own delivery logs" SELECT policy
-- covers the new columns; writes go through the backend service role only
-- (there is no INSERT/UPDATE/DELETE policy for authenticated users).

ALTER TABLE announcement_delivery_log
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE announcement_delivery_log
  ADD COLUMN IF NOT EXISTS delete_error TEXT;

COMMENT ON COLUMN announcement_delivery_log.deleted_at IS
  'When the sender deleted the posted Discord message (NULL = still posted or never posted)';

COMMENT ON COLUMN announcement_delivery_log.delete_error IS
  'Last error from a sender-initiated Discord message deletion attempt (NULL = none)';
-- END SOURCE: 036_announcement_message_deletion.sql

