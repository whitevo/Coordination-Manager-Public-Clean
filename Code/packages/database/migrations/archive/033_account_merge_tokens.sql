-- Single-use, short-lived account merge tokens. Only a SHA-256 hash of the token is stored.
CREATE TABLE IF NOT EXISTS public.account_merge_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  source_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source_account_type TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_merge_tokens_expires_at
  ON public.account_merge_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_account_merge_tokens_source_user_id
  ON public.account_merge_tokens(source_user_id);

ALTER TABLE public.account_merge_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_merge_tokens FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.account_merge_tokens TO service_role;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'account_merge_tokens'
      AND policyname = 'Deny direct client access to account merge tokens'
  ) THEN
    CREATE POLICY "Deny direct client access to account merge tokens"
      ON public.account_merge_tokens FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;
