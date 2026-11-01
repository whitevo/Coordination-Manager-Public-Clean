-- Primary mailbox account selection and last-used From account fallback.

ALTER TABLE public.mail_accounts
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.mail_accounts
  ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ;

WITH ranked_accounts AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY user_id
    ORDER BY created_at ASC, id ASC
  ) AS account_rank
  FROM public.mail_accounts
)
UPDATE public.mail_accounts AS account
SET is_primary = ranked_accounts.account_rank = 1
FROM ranked_accounts
WHERE account.id = ranked_accounts.id
  AND NOT EXISTS (
    SELECT 1
    FROM public.mail_accounts AS existing_primary
    WHERE existing_primary.user_id = account.user_id
      AND existing_primary.is_primary
  );

UPDATE public.mail_accounts AS account
SET last_sent_at = latest_draft.sent_at
FROM (
  SELECT account_id, MAX(sent_at) AS sent_at
  FROM public.mail_drafts
  WHERE status = 'sent'
    AND sent_at IS NOT NULL
  GROUP BY account_id
) AS latest_draft
WHERE account.id = latest_draft.account_id
  AND account.last_sent_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_accounts_one_primary_per_user
  ON public.mail_accounts(user_id)
  WHERE is_primary;

CREATE INDEX IF NOT EXISTS idx_mail_accounts_user_last_sent
  ON public.mail_accounts(user_id, last_sent_at DESC NULLS LAST);

CREATE OR REPLACE FUNCTION public.set_first_mail_account_primary()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT NEW.is_primary AND NOT EXISTS (
    SELECT 1
    FROM public.mail_accounts
    WHERE user_id = NEW.user_id
  ) THEN
    NEW.is_primary := TRUE;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_first_mail_account_primary ON public.mail_accounts;
CREATE TRIGGER trigger_first_mail_account_primary
  BEFORE INSERT ON public.mail_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_first_mail_account_primary();