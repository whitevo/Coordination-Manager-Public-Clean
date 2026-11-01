-- Tracks who/what applied an action to a mailbox message (manual click,
-- provider import, or automation rule) for receive-action triggers and loops.

CREATE TABLE IF NOT EXISTS public.mail_action_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.mail_accounts(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES public.mail_messages(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN (
    'trash', 'junk', 'archive', 'unarchive', 'mark_read', 'mark_unread', 'add_tag', 'remove_tag',
    'agent_prompt', 'import_junk', 'import_trash', 'import_archived'
  )),
  action_value TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('manual', 'rule', 'import')),
  source_rule_id UUID REFERENCES public.mail_rules(id) ON DELETE SET NULL,
  chain_id UUID NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mail_action_events_message
  ON public.mail_action_events(message_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_action_events_chain
  ON public.mail_action_events(chain_id, source_rule_id);
CREATE INDEX IF NOT EXISTS idx_mail_action_events_user
  ON public.mail_action_events(user_id, created_at DESC);

ALTER TABLE public.mail_action_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mail_action_events'
      AND policyname = 'Users manage own mailbox action events'
  ) THEN
    CREATE POLICY "Users manage own mailbox action events"
      ON public.mail_action_events FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
