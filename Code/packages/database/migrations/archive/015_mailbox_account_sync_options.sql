-- Persist mailbox import settings independently for each connected account.

ALTER TABLE public.mail_accounts
  ADD COLUMN IF NOT EXISTS sync_options JSONB NOT NULL DEFAULT '{}'::jsonb;