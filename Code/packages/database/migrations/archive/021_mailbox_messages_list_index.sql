-- Optimize the already-synced mailbox list query when archived messages are included.

CREATE INDEX IF NOT EXISTS idx_mail_messages_account_received_covering
  ON public.mail_messages(account_id, received_at DESC)
  INCLUDE (thread_id, is_archived);