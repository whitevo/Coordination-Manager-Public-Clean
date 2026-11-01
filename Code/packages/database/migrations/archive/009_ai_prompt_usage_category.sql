-- 009: Repair ai_prompt_usage schema drift for per-feature AI quotas.
-- Some deployed databases created ai_prompt_usage before the category column
-- was added to the consolidated security migration. This forward-only patch is
-- idempotent and safe to run against both old and current schemas.

CREATE TABLE IF NOT EXISTS public.ai_prompt_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'chat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.ai_prompt_usage
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'chat';

ALTER TABLE public.ai_prompt_usage
  DROP CONSTRAINT IF EXISTS ai_prompt_usage_category_check;

ALTER TABLE public.ai_prompt_usage
  ADD CONSTRAINT ai_prompt_usage_category_check
  CHECK (category IN ('chat', 'mailbox_assessment', 'mailbox_draft'));

DROP INDEX IF EXISTS public.idx_ai_prompt_usage_user_day;

CREATE INDEX IF NOT EXISTS idx_ai_prompt_usage_user_category_day
  ON public.ai_prompt_usage(user_id, category, created_at DESC);

COMMENT ON TABLE public.ai_prompt_usage IS 'Tracks per-user AI prompt usage for daily rate limiting. Rows older than 90 days can be safely deleted.';

ALTER TABLE public.ai_prompt_usage ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ai_prompt_usage'
      AND policyname = 'ai_prompt_usage_deny_all'
  ) THEN
    CREATE POLICY "ai_prompt_usage_deny_all" ON public.ai_prompt_usage FOR ALL USING (false);
  END IF;
END $$;