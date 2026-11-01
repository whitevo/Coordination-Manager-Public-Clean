-- Browser-bound, single-use mailbox OAuth connections. No provider credentials.
CREATE TABLE IF NOT EXISTS public.mailbox_oauth_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('gmail', 'outlook')),
  browser_token_hash TEXT NOT NULL CHECK (browser_token_hash ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_mailbox_oauth_transactions_expires_at
  ON public.mailbox_oauth_transactions(expires_at);
CREATE INDEX IF NOT EXISTS idx_mailbox_oauth_transactions_user_id
  ON public.mailbox_oauth_transactions(user_id);

ALTER TABLE public.mailbox_oauth_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mailbox_oauth_transactions FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.mailbox_oauth_transactions TO service_role;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mailbox_oauth_transactions'
      AND policyname = 'Deny direct client access to mailbox OAuth transactions'
  ) THEN
    CREATE POLICY "Deny direct client access to mailbox OAuth transactions"
      ON public.mailbox_oauth_transactions FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;
