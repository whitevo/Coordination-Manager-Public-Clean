-- Community moderation for public event listings.

CREATE TABLE IF NOT EXISTS public.event_flags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flag_type TEXT NOT NULL CHECK (flag_type IN ('removal', 'confirmation')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'removal_accepted', 'updated', 'expired')),
  rationale TEXT,
  reporter_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reporter_anonymous_id TEXT,
  respond_by TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT event_flags_reporter_chk CHECK (
    num_nonnulls(reporter_user_id, reporter_anonymous_id) = 1
  ),
  CONSTRAINT event_flags_rationale_chk CHECK (
    flag_type <> 'removal' OR char_length(trim(rationale)) >= 2
  ),
  CONSTRAINT event_flags_deadline_chk CHECK (
    (flag_type = 'confirmation' AND respond_by IS NOT NULL)
    OR (flag_type = 'removal' AND respond_by IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.event_flag_targets (
  flag_id UUID NOT NULL REFERENCES public.event_flags(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('user_event', 'meeting')),
  target_id UUID NOT NULL,
  owner_identity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'removal_accepted', 'updated', 'expired')),
  responded_at TIMESTAMPTZ,
  PRIMARY KEY (flag_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS public.public_event_moderation_state (
  target_type TEXT NOT NULL CHECK (target_type IN ('user_event', 'meeting')),
  target_id UUID NOT NULL,
  is_suspended BOOLEAN NOT NULL DEFAULT FALSE,
  suspension_reason_flag_id UUID REFERENCES public.event_flags(id) ON DELETE SET NULL,
  suspended_at TIMESTAMPTZ,
  restored_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (target_type, target_id)
);

CREATE TABLE IF NOT EXISTS public.event_flag_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flag_id UUID NOT NULL REFERENCES public.event_flags(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (
    action IN ('submitted', 'suspended', 'confirmed', 'removal_accepted', 'updated', 'expired', 'restored')
  ),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('authenticated', 'anonymous', 'system')),
  actor_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  actor_anonymous_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_flags_active_deadline
  ON public.event_flags(status, respond_by)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_event_flags_reporter_user
  ON public.event_flags(reporter_user_id)
  WHERE reporter_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_event_flag_targets_owner
  ON public.event_flag_targets(owner_identity, status, flag_id);
CREATE INDEX IF NOT EXISTS idx_event_flag_targets_target
  ON public.event_flag_targets(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_event_flag_actions_flag_created
  ON public.event_flag_actions(flag_id, created_at);
CREATE INDEX IF NOT EXISTS idx_public_event_moderation_suspended
  ON public.public_event_moderation_state(target_type, target_id)
  WHERE is_suspended = TRUE;

ALTER TABLE public.event_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_flag_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_event_moderation_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_flag_actions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'event_flags'
      AND policyname = 'Event flags are service managed'
  ) THEN
    CREATE POLICY "Event flags are service managed"
      ON public.event_flags FOR ALL USING (FALSE) WITH CHECK (FALSE);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'event_flag_targets'
      AND policyname = 'Event flag targets are service managed'
  ) THEN
    CREATE POLICY "Event flag targets are service managed"
      ON public.event_flag_targets FOR ALL USING (FALSE) WITH CHECK (FALSE);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'public_event_moderation_state'
      AND policyname = 'Public event moderation state is service managed'
  ) THEN
    CREATE POLICY "Public event moderation state is service managed"
      ON public.public_event_moderation_state FOR ALL USING (FALSE) WITH CHECK (FALSE);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'event_flag_actions'
      AND policyname = 'Event flag actions are service managed'
  ) THEN
    CREATE POLICY "Event flag actions are service managed"
      ON public.event_flag_actions FOR ALL USING (FALSE) WITH CHECK (FALSE);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trigger_event_flags_updated_at ON public.event_flags;
CREATE TRIGGER trigger_event_flags_updated_at
  BEFORE UPDATE ON public.event_flags
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_public_event_moderation_state_updated_at
  ON public.public_event_moderation_state;
CREATE TRIGGER trigger_public_event_moderation_state_updated_at
  BEFORE UPDATE ON public.public_event_moderation_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.event_flags IS 'Community requests to remove or reconfirm public event listings';
COMMENT ON TABLE public.event_flag_targets IS 'Underlying user events or meetings associated with a community flag';
COMMENT ON TABLE public.public_event_moderation_state IS 'Moderation suspension independent of owner publication settings';
COMMENT ON TABLE public.event_flag_actions IS 'Append-only audit history for event moderation activity';