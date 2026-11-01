CREATE TABLE IF NOT EXISTS public.guardian_ban_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL CHECK (guild_id ~ '^[0-9]{17,20}$'),
  discord_user_id TEXT NOT NULL CHECK (discord_user_id ~ '^[0-9]{17,20}$'),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 400),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'registered'
    CHECK (status IN ('registered', 'pending', 'processing', 'banned', 'failed')),
  created_by UUID NOT NULL REFERENCES public.users(id),
  requested_by UUID NOT NULL REFERENCES public.users(id),
  requested_by_discord_id TEXT NOT NULL,
  disabled_by UUID REFERENCES public.users(id),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_started_at TIMESTAMPTZ,
  processing_token UUID,
  last_error TEXT,
  banned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (guild_id, discord_user_id)
);

CREATE INDEX IF NOT EXISTS idx_guardian_ban_queue
  ON public.guardian_ban_entries(next_attempt_at, created_at)
  WHERE is_enabled AND status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_guardian_ban_guild_created
  ON public.guardian_ban_entries(guild_id, created_at DESC);
ALTER TABLE public.guardian_ban_entries ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'guardian_ban_entries'
      AND policyname = 'Ban registry is service only'
  ) THEN
    CREATE POLICY "Ban registry is service only" ON public.guardian_ban_entries
      FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.register_guardian_bans(
  p_guild_ids TEXT[], p_discord_ids TEXT[], p_reason TEXT,
  p_actor UUID, p_actor_discord TEXT, p_preban BOOLEAN
) RETURNS INTEGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE affected INTEGER;
BEGIN
  INSERT INTO public.guardian_ban_entries (
    guild_id, discord_user_id, reason, created_by, requested_by,
    requested_by_discord_id, status
  )
  SELECT guild_id, discord_id, p_reason, p_actor, p_actor, p_actor_discord,
    CASE WHEN p_preban THEN 'pending' ELSE 'registered' END
  FROM unnest(p_guild_ids) AS g(guild_id)
  CROSS JOIN unnest(p_discord_ids) AS d(discord_id)
  ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
    reason = EXCLUDED.reason,
    requested_by = EXCLUDED.requested_by,
    requested_by_discord_id = EXCLUDED.requested_by_discord_id,
    is_enabled = TRUE,
    disabled_by = NULL,
    status = CASE WHEN p_preban THEN 'pending'
      WHEN guardian_ban_entries.status = 'banned' THEN 'banned' ELSE 'registered' END,
    attempts = 0,
    next_attempt_at = NOW(),
    processing_started_at = NULL,
    processing_token = NULL,
    last_error = NULL,
    updated_at = NOW()
  WHERE guardian_ban_entries.status <> 'processing';
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_guardian_ban(p_instance_id TEXT)
RETURNS SETOF public.guardian_ban_entries
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.guardian_instance_lock
    WHERE id = 'singleton' AND instance_id = p_instance_id
      AND heartbeat_at > NOW() - INTERVAL '30 seconds'
  ) THEN RETURN; END IF;

  RETURN QUERY
  UPDATE public.guardian_ban_entries SET
    status = 'processing', processing_started_at = NOW(),
    processing_token = gen_random_uuid(), attempts = attempts + 1, updated_at = NOW()
  WHERE id = (
    SELECT id FROM public.guardian_ban_entries
    WHERE is_enabled AND (
      (status = 'pending' AND next_attempt_at <= NOW()) OR
      (status = 'processing' AND processing_started_at < NOW() - INTERVAL '5 minutes')
    )
    ORDER BY next_attempt_at, created_at
    LIMIT 1 FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_guardian_join_ban(p_guild_id TEXT, p_discord_id TEXT)
RETURNS VOID LANGUAGE sql SET search_path = public AS $$
  UPDATE public.guardian_ban_entries SET
    status = 'pending', attempts = 0, next_attempt_at = NOW(),
    last_error = NULL, updated_at = NOW()
  WHERE guild_id = p_guild_id AND discord_user_id = p_discord_id
    AND is_enabled AND status <> 'processing';
$$;

REVOKE ALL ON FUNCTION public.register_guardian_bans(TEXT[], TEXT[], TEXT, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_guardian_ban(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_guardian_join_ban(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_guardian_bans(TEXT[], TEXT[], TEXT, UUID, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_guardian_ban(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_guardian_join_ban(TEXT, TEXT) TO service_role;
