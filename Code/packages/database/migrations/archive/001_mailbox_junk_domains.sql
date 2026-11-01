ALTER TABLE IF EXISTS public.mail_user_preferences
  ADD COLUMN IF NOT EXISTS junk_domains JSONB;

UPDATE public.mail_user_preferences
SET junk_domains = '[]'::jsonb
WHERE junk_domains IS NULL;

ALTER TABLE IF EXISTS public.mail_user_preferences
  ALTER COLUMN junk_domains SET DEFAULT '[]'::jsonb;

ALTER TABLE IF EXISTS public.mail_user_preferences
  ALTER COLUMN junk_domains SET NOT NULL;