-- Locally composed mailbox drafts (reply, forward, or new message).
-- Drafts live only in this platform until they are sent through the owning
-- account's provider, at which point the row is marked 'sent'.

CREATE TABLE IF NOT EXISTS public.mail_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.mail_accounts(id) ON DELETE CASCADE,
  thread_id UUID REFERENCES public.mail_threads(id) ON DELETE SET NULL,
  in_reply_to_message_id UUID REFERENCES public.mail_messages(id) ON DELETE SET NULL,
  mode TEXT NOT NULL DEFAULT 'reply' CHECK (mode IN ('reply', 'forward', 'new')),
  from_address TEXT NOT NULL,
  to_emails TEXT,
  cc_emails TEXT,
  bcc_emails TEXT,
  subject TEXT,
  body_text TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent')),
  sent_at TIMESTAMPTZ,
  provider_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mail_drafts_user
  ON public.mail_drafts(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_drafts_account
  ON public.mail_drafts(account_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_drafts_thread
  ON public.mail_drafts(thread_id, updated_at DESC);

ALTER TABLE public.mail_drafts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mail_drafts'
      AND policyname = 'Users manage own mailbox drafts'
  ) THEN
    CREATE POLICY "Users manage own mailbox drafts"
      ON public.mail_drafts FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trigger_mail_drafts_updated_at
  ON public.mail_drafts;
CREATE TRIGGER trigger_mail_drafts_updated_at
  BEFORE UPDATE ON public.mail_drafts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.mail_drafts IS 'Platform-held email drafts awaiting send through the owning mail account provider';
