-- Tracks directional email frequency per contact so the assistant can reason
-- about "you email this person often" vs "they mostly email you" instead of
-- only a single combined interaction_count.

ALTER TABLE public.mail_contacts
  ADD COLUMN IF NOT EXISTS sent_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS received_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_received_at TIMESTAMPTZ;

COMMENT ON COLUMN public.mail_contacts.sent_count IS 'Number of synced messages this account sent to the contact';
COMMENT ON COLUMN public.mail_contacts.received_count IS 'Number of synced messages this account received from the contact';
COMMENT ON COLUMN public.mail_contacts.last_sent_at IS 'Most recent synced message sent to the contact';
COMMENT ON COLUMN public.mail_contacts.last_received_at IS 'Most recent synced message received from the contact';
