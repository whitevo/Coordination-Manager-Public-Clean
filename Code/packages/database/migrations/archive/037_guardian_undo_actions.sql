-- Migration 037: Guardian -- moderator undo actions in the action log
--
-- Moderators can undo a moderation action from the Guardian dashboard
-- (unban a user, remove a Discord timeout). Each undo writes one
-- guardian_action_log row with action 'unban' or 'unmute',
-- actor_kind = 'moderator' (already allowed) and the platform user who
-- acted in actor_user_id.
--
-- Idempotent: safe to run more than once.

-- 1. Allow the undo actions in the action CHECK. The original inline CHECK
--    from 066_guardian_action_log.sql is named guardian_action_log_action_check.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.guardian_action_log'::regclass
      AND conname = 'guardian_action_log_action_check'
      AND pg_get_constraintdef(oid) LIKE '%unmute%'
  ) THEN
    ALTER TABLE public.guardian_action_log
      DROP CONSTRAINT IF EXISTS guardian_action_log_action_check;
    ALTER TABLE public.guardian_action_log
      ADD CONSTRAINT guardian_action_log_action_check
      CHECK (action IN ('flag', 'delete', 'mute', 'ban', 'unban', 'unmute'));
  END IF;
END $$;

-- 2. Record which platform moderator performed a manual action.
--    NULL for bot actions.
ALTER TABLE public.guardian_action_log
  ADD COLUMN IF NOT EXISTS actor_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_guardian_action_log_actor_user
  ON public.guardian_action_log(actor_user_id)
  WHERE actor_user_id IS NOT NULL;

COMMENT ON COLUMN public.guardian_action_log.actor_user_id IS
  'Platform user (moderator) who performed a manual action such as unban/unmute; NULL for bot actions.';
