-- Senders the user marked as never producing meetings. Invitations from these
-- addresses/domains are dropped during extraction and hidden from the UI.

ALTER TABLE IF EXISTS public.mail_user_preferences
  ADD COLUMN IF NOT EXISTS non_organizer_senders JSONB;

UPDATE public.mail_user_preferences
SET non_organizer_senders = '[]'::jsonb
WHERE non_organizer_senders IS NULL;

ALTER TABLE IF EXISTS public.mail_user_preferences
  ALTER COLUMN non_organizer_senders SET DEFAULT '[]'::jsonb;

ALTER TABLE IF EXISTS public.mail_user_preferences
  ALTER COLUMN non_organizer_senders SET NOT NULL;
