CREATE TABLE IF NOT EXISTS public.guardian_ban_accounts (
  discord_user_id TEXT PRIMARY KEY CHECK (discord_user_id ~ '^[0-9]{17,20}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES public.users(id),
  requested_by_discord_id TEXT NOT NULL,
  boot_count INTEGER NOT NULL DEFAULT 0 CHECK (boot_count >= 0)
);

INSERT INTO public.guardian_ban_accounts (discord_user_id, created_at, created_by, requested_by_discord_id)
SELECT DISTINCT ON (discord_user_id) discord_user_id, created_at, created_by, requested_by_discord_id
FROM public.guardian_ban_entries WHERE is_enabled
ORDER BY discord_user_id, created_at, id
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.guardian_ban_previews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES public.users(id),
  actor_discord_id TEXT NOT NULL,
  discord_ids TEXT[] NOT NULL CHECK (cardinality(discord_ids) BETWEEN 1 AND 1000),
  guild_ids TEXT[] NOT NULL CHECK (cardinality(guild_ids) > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'confirming', 'failed', 'confirmed')),
  cursor INTEGER NOT NULL DEFAULT 0,
  member_counts JSONB NOT NULL DEFAULT '{}',
  last_error TEXT,
  processing_token UUID,
  processing_started_at TIMESTAMPTZ,
  confirmation_requested BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);
CREATE INDEX IF NOT EXISTS idx_guardian_preview_pending ON public.guardian_ban_previews(created_at)
  WHERE status IN ('pending', 'processing', 'confirming');
CREATE INDEX IF NOT EXISTS idx_guardian_preview_actor ON public.guardian_ban_previews(created_by, created_at);

CREATE TABLE IF NOT EXISTS public.guardian_ban_removals (
  operation_id UUID PRIMARY KEY,
  discord_user_id TEXT NOT NULL REFERENCES public.guardian_ban_accounts(discord_user_id),
  guild_id TEXT NOT NULL,
  removed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_guardian_removals_account ON public.guardian_ban_removals(discord_user_id);
ALTER TABLE public.guardian_ban_entries ADD COLUMN IF NOT EXISTS operation_id UUID DEFAULT gen_random_uuid();
ALTER TABLE public.guardian_ban_entries ADD COLUMN IF NOT EXISTS join_pending BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.guardian_ban_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_ban_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_ban_removals ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.guardian_ban_accounts, public.guardian_ban_previews, public.guardian_ban_removals TO service_role;
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['guardian_ban_accounts', 'guardian_ban_previews', 'guardian_ban_removals'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'Guardian global bans service only') THEN
      EXECUTE format('CREATE POLICY "Guardian global bans service only" ON public.%I FOR ALL USING (false) WITH CHECK (false)', t);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.claim_guardian_ban_preview(p_instance_id TEXT)
RETURNS SETOF public.guardian_ban_previews LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM guardian_instance_lock WHERE id = 'singleton'
    AND instance_id = p_instance_id AND heartbeat_at > NOW() - INTERVAL '30 seconds') THEN RETURN; END IF;
  RETURN QUERY UPDATE guardian_ban_previews SET status = 'processing',
    processing_token = gen_random_uuid(), processing_started_at = NOW()
  WHERE id = (
    SELECT id FROM guardian_ban_previews WHERE expires_at > NOW() AND
      (status IN ('pending', 'confirming') OR (status = 'processing' AND processing_started_at < NOW() - INTERVAL '5 minutes'))
    ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
  ) RETURNING *;
END $$;

CREATE OR REPLACE FUNCTION public.confirm_guardian_global_bans(p_preview UUID, p_actor UUID, p_token UUID)
RETURNS INTEGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE preview guardian_ban_previews; affected INTEGER;
BEGIN
  SELECT * INTO preview FROM guardian_ban_previews WHERE id = p_preview AND created_by = p_actor FOR UPDATE;
  IF NOT FOUND OR preview.expires_at <= NOW() OR NOT preview.confirmation_requested OR
    preview.status NOT IN ('processing', 'confirmed') OR
    (preview.status <> 'confirmed' AND preview.processing_token IS DISTINCT FROM p_token) THEN
    RAISE EXCEPTION 'Preview is incomplete or expired';
  END IF;
  IF preview.status = 'confirmed' THEN RETURN 0; END IF;
  WITH added AS (
    INSERT INTO guardian_ban_accounts(discord_user_id, created_by, requested_by_discord_id)
    SELECT unnest(preview.discord_ids), p_actor, preview.actor_discord_id ON CONFLICT DO NOTHING
    RETURNING *
  ), queued AS (
    INSERT INTO guardian_ban_entries(guild_id, discord_user_id, reason, created_by, requested_by,
      requested_by_discord_id, status)
    SELECT g, a.discord_user_id, 'Global Guardian ban registry', a.created_by, a.created_by,
      a.requested_by_discord_id, 'pending' FROM added a CROSS JOIN unnest(preview.guild_ids) g
    ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
      is_enabled = TRUE, disabled_by = NULL, status = 'pending', attempts = 0,
      requested_by = EXCLUDED.requested_by, requested_by_discord_id = EXCLUDED.requested_by_discord_id,
      next_attempt_at = NOW(), processing_token = NULL, processing_started_at = NULL,
      operation_id = gen_random_uuid(), last_error = NULL, updated_at = NOW()
    RETURNING id
  ) SELECT count(*) INTO affected FROM added;
  UPDATE guardian_ban_previews SET status = 'confirmed', cursor = cardinality(guild_ids), last_error = NULL,
    processing_token = NULL, processing_started_at = NULL WHERE id = p_preview;
  RETURN affected;
END $$;

-- Paged reconciliation fills new-server coverage and upgrades legacy scoped pairs.
CREATE OR REPLACE FUNCTION public.sync_guardian_global_bans(p_guild_ids TEXT[], p_after TEXT DEFAULT '')
RETURNS TABLE(last_id TEXT, account_count INTEGER) LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RETURN QUERY WITH accounts AS MATERIALIZED (
    SELECT * FROM guardian_ban_accounts WHERE discord_user_id > p_after ORDER BY discord_user_id LIMIT 100
  ), queued AS (
    INSERT INTO guardian_ban_entries(guild_id, discord_user_id, reason, created_by, requested_by,
      requested_by_discord_id, status)
    SELECT g, a.discord_user_id, 'Global Guardian ban registry', a.created_by, a.created_by,
      a.requested_by_discord_id, 'pending' FROM accounts a CROSS JOIN unnest(p_guild_ids) g
    ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
      is_enabled = TRUE, disabled_by = NULL, status = 'pending', attempts = 0,
      requested_by = EXCLUDED.requested_by, requested_by_discord_id = EXCLUDED.requested_by_discord_id,
      next_attempt_at = NOW(), operation_id = gen_random_uuid(), last_error = NULL, updated_at = NOW()
    WHERE NOT guardian_ban_entries.is_enabled OR guardian_ban_entries.status = 'registered'
    RETURNING id
  ) SELECT max(discord_user_id), count(*)::INTEGER FROM accounts;
END $$;

CREATE OR REPLACE FUNCTION public.enqueue_guardian_join_ban(p_guild_id TEXT, p_discord_id TEXT)
RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  INSERT INTO guardian_ban_entries(guild_id, discord_user_id, reason, created_by, requested_by,
    requested_by_discord_id, status)
  SELECT p_guild_id, discord_user_id, 'Global Guardian ban registry', created_by, created_by,
    requested_by_discord_id, 'pending' FROM guardian_ban_accounts WHERE discord_user_id = p_discord_id
  ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
    is_enabled = TRUE,
    status = CASE WHEN guardian_ban_entries.status = 'processing' THEN 'processing' ELSE 'pending' END,
    attempts = CASE WHEN guardian_ban_entries.status = 'processing' THEN guardian_ban_entries.attempts ELSE 0 END,
    next_attempt_at = NOW(), join_pending = guardian_ban_entries.status = 'processing',
    operation_id = CASE WHEN guardian_ban_entries.status = 'processing' THEN guardian_ban_entries.operation_id ELSE gen_random_uuid() END,
    last_error = NULL, updated_at = NOW();
END $$;

CREATE OR REPLACE FUNCTION public.finish_guardian_global_ban(
  p_entry UUID, p_token UUID, p_removed BOOLEAN
) RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
DECLARE entry guardian_ban_entries; inserted INTEGER;
BEGIN
  SELECT * INTO entry FROM guardian_ban_entries WHERE id = p_entry AND processing_token = p_token FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF p_removed THEN
    INSERT INTO guardian_ban_removals(operation_id, discord_user_id, guild_id)
    VALUES (entry.operation_id, entry.discord_user_id, entry.guild_id) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS inserted = ROW_COUNT;
    IF inserted = 1 THEN
      UPDATE guardian_ban_accounts SET boot_count = boot_count + 1 WHERE discord_user_id = entry.discord_user_id;
    END IF;
  END IF;
  UPDATE guardian_ban_entries SET status = CASE WHEN entry.join_pending THEN 'pending' ELSE 'banned' END,
    next_attempt_at = NOW(), attempts = CASE WHEN entry.join_pending THEN 0 ELSE attempts END,
    operation_id = CASE WHEN entry.join_pending THEN gen_random_uuid() ELSE operation_id END,
    join_pending = FALSE, banned_at = NOW(), last_error = NULL,
    processing_token = NULL, processing_started_at = NULL, updated_at = NOW() WHERE id = p_entry;
END $$;

-- The old server-specific import API must not be usable alongside global enforcement.
REVOKE ALL ON FUNCTION public.register_guardian_bans(TEXT[], TEXT[], TEXT, UUID, TEXT, BOOLEAN) FROM service_role;
REVOKE ALL ON FUNCTION public.claim_guardian_ban_preview(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_guardian_global_bans(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_guardian_global_bans(TEXT[], TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_guardian_global_ban(UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_guardian_ban_preview(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_guardian_global_bans(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_guardian_global_bans(TEXT[], TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_guardian_global_ban(UUID, UUID, BOOLEAN) TO service_role;
