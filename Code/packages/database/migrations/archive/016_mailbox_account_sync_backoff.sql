-- Back-off state for the mailbox auto-sync loop.
-- Without this the loop retried every account with status 'error' on every pass,
-- so a permanently revoked OAuth grant kept hammering the provider token endpoint.

ALTER TABLE public.mail_accounts
  ADD COLUMN IF NOT EXISTS sync_failure_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.mail_accounts
  ADD COLUMN IF NOT EXISTS sync_retry_after TIMESTAMPTZ;

-- 'auth' means the grant itself is dead (revoked/expired refresh token) and only a
-- user reconnect can fix it; 'transient' means network/rate-limit/provider errors.
ALTER TABLE public.mail_accounts
  ADD COLUMN IF NOT EXISTS sync_error_kind TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mail_accounts_sync_error_kind_check'
  ) THEN
    ALTER TABLE public.mail_accounts
      ADD CONSTRAINT mail_accounts_sync_error_kind_check
      CHECK (sync_error_kind IS NULL OR sync_error_kind IN ('auth', 'transient'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mail_accounts_autosync_due
  ON public.mail_accounts(status, sync_retry_after)
  WHERE sync_error_kind IS DISTINCT FROM 'auth';
