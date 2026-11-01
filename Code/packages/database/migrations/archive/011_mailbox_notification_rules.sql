-- Per-user notification rules: which system/custom tags should (or should
-- not) surface the in-app "new mail" badge. Mirrors mailbox_filter_rules'
-- shape (system:*/user:* tag ids) but with a 4-mode notify/mute/always/never
-- vocabulary instead of sort/only/hide, since ordering has no meaning here.

ALTER TABLE public.mail_user_preferences
  ADD COLUMN IF NOT EXISTS mailbox_notifications_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.mail_user_preferences
  ADD COLUMN IF NOT EXISTS mailbox_notification_rules JSONB NOT NULL DEFAULT '{"systemTags":[],"userTags":[]}'::jsonb;
