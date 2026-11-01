-- Covers GET /api/mailbox/messages's dominant query shape:
-- account_id IN (...) AND is_archived = false ORDER BY received_at DESC.
-- The existing (account_id, received_at DESC) index makes Postgres visit rows
-- across multiple accounts and filter out archived ones after the fact, which
-- degrades badly on larger mailboxes and can trip statement_timeout (57014).

CREATE INDEX IF NOT EXISTS idx_mail_messages_account_archived_received
  ON public.mail_messages(account_id, is_archived, received_at DESC);
