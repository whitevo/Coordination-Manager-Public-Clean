-- Watermark for the background "check for new mail" poll (Layout-level, not
-- tied to the Mailbox page being open) so it only re-evaluates messages that
-- changed since the last check instead of rescanning the whole mailbox.

ALTER TABLE public.mail_user_preferences
  ADD COLUMN IF NOT EXISTS mailbox_notifications_last_checked_at TIMESTAMPTZ;
