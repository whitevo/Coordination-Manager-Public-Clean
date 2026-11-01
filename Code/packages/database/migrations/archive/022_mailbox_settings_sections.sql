-- Persist Mailbox Settings section expansion state across devices.

ALTER TABLE public.mail_user_preferences
  ADD COLUMN IF NOT EXISTS mailbox_settings_sections JSONB NOT NULL
  DEFAULT '{"threadView": true, "inboxDisplay": true, "confirmations": true, "syncDefaults": true, "notifications": true}'::jsonb;