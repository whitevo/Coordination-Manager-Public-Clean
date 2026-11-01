-- Per-account watermark for efficient new-mail checks.

ALTER TABLE public.mail_accounts
  ADD COLUMN IF NOT EXISTS quick_sync_after TIMESTAMPTZ;

ALTER TABLE public.mail_accounts
  ADD COLUMN IF NOT EXISTS quick_sync_max_messages INTEGER NOT NULL DEFAULT 100;

ALTER TABLE public.mail_accounts
  DROP CONSTRAINT IF EXISTS mail_accounts_quick_sync_max_messages_check;

ALTER TABLE public.mail_accounts
  ADD CONSTRAINT mail_accounts_quick_sync_max_messages_check
  CHECK (quick_sync_max_messages BETWEEN 25 AND 500);

CREATE INDEX IF NOT EXISTS idx_mail_accounts_quick_sync_after
  ON public.mail_accounts(user_id, quick_sync_after);