ALTER TABLE public.guardian_ban_accounts ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.guardian_ban_accounts ADD COLUMN IF NOT EXISTS last_booted_at TIMESTAMPTZ;
ALTER TABLE public.guardian_ban_accounts ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;
ALTER TABLE public.guardian_ban_accounts ADD COLUMN IF NOT EXISTS removed_by UUID REFERENCES public.users(id);
ALTER TABLE public.guardian_ban_entries ADD COLUMN IF NOT EXISTS action TEXT NOT NULL DEFAULT 'ban';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.guardian_ban_entries'::regclass
    AND conname = 'guardian_ban_entry_action_check') THEN
    ALTER TABLE public.guardian_ban_entries ADD CONSTRAINT guardian_ban_entry_action_check CHECK (action IN ('ban', 'unban'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_guardian_active_accounts ON public.guardian_ban_accounts(created_at DESC, discord_user_id) WHERE is_active;
UPDATE public.guardian_ban_accounts a SET last_booted_at = r.last_booted
FROM (SELECT discord_user_id, max(removed_at) AS last_booted FROM public.guardian_ban_removals GROUP BY discord_user_id) r
WHERE a.discord_user_id = r.discord_user_id AND a.last_booted_at IS NULL;

CREATE OR REPLACE FUNCTION public.remove_guardian_global_bans(
  p_discord_ids TEXT[], p_guild_ids TEXT[], p_actor UUID, p_actor_discord TEXT
) RETURNS INTEGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE affected INTEGER;
BEGIN
  -- Account row locks serialize removal with re-registration and event reconciliation.
  WITH removed AS (
    UPDATE guardian_ban_accounts SET is_active = FALSE, removed_at = NOW(), removed_by = p_actor
    WHERE discord_user_id = ANY(p_discord_ids) AND is_active RETURNING *
  ), targets AS (
    SELECT a.discord_user_id, g AS guild_id FROM removed a CROSS JOIN unnest(p_guild_ids) g
    UNION SELECT e.discord_user_id, e.guild_id FROM guardian_ban_entries e JOIN removed a USING(discord_user_id)
  ), queued AS (
    INSERT INTO guardian_ban_entries(guild_id, discord_user_id, reason, created_by, requested_by,
      requested_by_discord_id, status, action)
    SELECT guild_id, discord_user_id, 'Guardian registry removal', p_actor, p_actor, p_actor_discord, 'pending', 'unban'
    FROM targets
    ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
      action = 'unban', is_enabled = TRUE, status = 'pending', requested_by = p_actor,
      requested_by_discord_id = p_actor_discord, attempts = 0, next_attempt_at = NOW(),
      processing_token = NULL, processing_started_at = NULL, operation_id = gen_random_uuid(),
      join_pending = FALSE, last_error = NULL, updated_at = NOW()
    RETURNING id
  ) SELECT count(*) INTO affected FROM removed;
  RETURN affected;
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
    SELECT id, p_actor, preview.actor_discord_id FROM unnest(preview.discord_ids) id ORDER BY id
    ON CONFLICT (discord_user_id) DO UPDATE SET
      is_active = TRUE, removed_at = NULL, removed_by = NULL, created_at = NOW(),
      created_by = EXCLUDED.created_by, requested_by_discord_id = EXCLUDED.requested_by_discord_id
    WHERE NOT guardian_ban_accounts.is_active RETURNING *
  ), queued AS (
    INSERT INTO guardian_ban_entries(guild_id, discord_user_id, reason, created_by, requested_by,
      requested_by_discord_id, status, action)
    SELECT g, a.discord_user_id, 'Global Guardian ban registry', a.created_by, a.created_by,
      a.requested_by_discord_id, 'pending', 'ban' FROM added a CROSS JOIN unnest(preview.guild_ids) g
    ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
      action = 'ban', is_enabled = TRUE, disabled_by = NULL, status = 'pending', attempts = 0,
      requested_by = EXCLUDED.requested_by, requested_by_discord_id = EXCLUDED.requested_by_discord_id,
      next_attempt_at = NOW(), processing_token = NULL, processing_started_at = NULL,
      operation_id = gen_random_uuid(), join_pending = FALSE, last_error = NULL, updated_at = NOW()
    RETURNING id
  ) SELECT count(*) INTO affected FROM added;
  UPDATE guardian_ban_previews SET status = 'confirmed', cursor = cardinality(guild_ids), last_error = NULL,
    processing_token = NULL, processing_started_at = NULL WHERE id = p_preview;
  RETURN affected;
END $$;

CREATE OR REPLACE FUNCTION public.enqueue_guardian_join_ban(p_guild_id TEXT, p_discord_id TEXT)
RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM guardian_ban_accounts WHERE discord_user_id = p_discord_id AND is_active FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO guardian_ban_entries(guild_id, discord_user_id, reason, created_by, requested_by,
    requested_by_discord_id, status, action)
  SELECT p_guild_id, discord_user_id, 'Global Guardian ban registry', created_by, created_by,
    requested_by_discord_id, 'pending', 'ban' FROM guardian_ban_accounts WHERE discord_user_id = p_discord_id AND is_active
  ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
    action = 'ban', is_enabled = TRUE,
    status = CASE WHEN guardian_ban_entries.status = 'processing' AND guardian_ban_entries.action = 'ban' THEN 'processing' ELSE 'pending' END,
    attempts = CASE WHEN guardian_ban_entries.status = 'processing' AND guardian_ban_entries.action = 'ban' THEN guardian_ban_entries.attempts ELSE 0 END,
    next_attempt_at = NOW(), join_pending = guardian_ban_entries.status = 'processing' AND guardian_ban_entries.action = 'ban',
    operation_id = CASE WHEN guardian_ban_entries.status = 'processing' AND guardian_ban_entries.action = 'ban' THEN guardian_ban_entries.operation_id ELSE gen_random_uuid() END,
    last_error = NULL, updated_at = NOW();
END $$;

CREATE OR REPLACE FUNCTION public.recover_guardian_global_bans(p_guild_ids TEXT[], p_after TEXT DEFAULT '')
RETURNS TABLE(last_id TEXT, account_count INTEGER) LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RETURN QUERY WITH accounts AS MATERIALIZED (
    SELECT * FROM guardian_ban_accounts WHERE is_active AND discord_user_id > p_after
    ORDER BY discord_user_id LIMIT 100 FOR UPDATE
  ), queued AS (
    INSERT INTO guardian_ban_entries(guild_id, discord_user_id, reason, created_by, requested_by,
      requested_by_discord_id, status, action)
    SELECT g, a.discord_user_id, 'Global Guardian ban registry', a.created_by, a.created_by,
      a.requested_by_discord_id, 'pending', 'ban' FROM accounts a CROSS JOIN unnest(p_guild_ids) g
    ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
      action = 'ban', is_enabled = TRUE, status = 'pending', attempts = 0,
      requested_by = EXCLUDED.requested_by, requested_by_discord_id = EXCLUDED.requested_by_discord_id,
      next_attempt_at = NOW(), operation_id = gen_random_uuid(), last_error = NULL, updated_at = NOW()
    WHERE guardian_ban_entries.status NOT IN ('pending', 'processing')
    RETURNING id
  ) SELECT max(discord_user_id), count(*)::INTEGER FROM accounts;
END $$;

CREATE OR REPLACE FUNCTION public.finish_guardian_global_ban(p_entry UUID, p_token UUID, p_removed BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
DECLARE entry guardian_ban_entries; inserted INTEGER;
BEGIN
  SELECT * INTO entry FROM guardian_ban_entries WHERE id = p_entry AND processing_token = p_token;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM 1 FROM guardian_ban_accounts WHERE discord_user_id = entry.discord_user_id FOR UPDATE;
  SELECT * INTO entry FROM guardian_ban_entries WHERE id = p_entry AND processing_token = p_token FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF entry.action = 'ban' AND p_removed THEN
    INSERT INTO guardian_ban_removals(operation_id, discord_user_id, guild_id)
    VALUES (entry.operation_id, entry.discord_user_id, entry.guild_id) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS inserted = ROW_COUNT;
    IF inserted = 1 THEN
      UPDATE guardian_ban_accounts SET boot_count = boot_count + 1, last_booted_at = NOW()
      WHERE discord_user_id = entry.discord_user_id;
    END IF;
  END IF;
  UPDATE guardian_ban_entries SET status = CASE
      WHEN entry.action = 'unban' THEN 'registered' WHEN entry.join_pending THEN 'pending' ELSE 'banned' END,
    is_enabled = entry.action <> 'unban',
    next_attempt_at = NOW(), attempts = CASE WHEN entry.join_pending THEN 0 ELSE attempts END,
    operation_id = CASE WHEN entry.join_pending THEN gen_random_uuid() ELSE operation_id END,
    join_pending = FALSE, banned_at = CASE WHEN entry.action = 'ban' THEN NOW() ELSE banned_at END,
    last_error = NULL, processing_token = NULL, processing_started_at = NULL, updated_at = NOW() WHERE id = p_entry;
END $$;

-- Old periodic reconciliation cannot reactivate a removed ID.
CREATE OR REPLACE FUNCTION public.sync_guardian_global_bans(p_guild_ids TEXT[], p_after TEXT DEFAULT '')
RETURNS TABLE(last_id TEXT, account_count INTEGER) LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Periodic Guardian reconciliation is retired; deploy the event-driven worker';
END;
$$;
REVOKE ALL ON FUNCTION public.remove_guardian_global_bans(TEXT[], TEXT[], UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recover_guardian_global_bans(TEXT[], TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_guardian_global_bans(TEXT[], TEXT[], UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_guardian_global_bans(TEXT[], TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.report_guardian_registry_write(
  p_entry UUID, p_token UUID, p_action TEXT, p_removed BOOLEAN, p_wrote BOOLEAN
) RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
DECLARE entry guardian_ban_entries; active BOOLEAN; desired TEXT;
BEGIN
  SELECT * INTO entry FROM guardian_ban_entries WHERE id = p_entry;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registry operation missing'; END IF;
  SELECT is_active INTO active FROM guardian_ban_accounts WHERE discord_user_id = entry.discord_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registry account missing'; END IF;
  SELECT * INTO entry FROM guardian_ban_entries WHERE id = p_entry FOR UPDATE;
  desired := CASE WHEN active THEN 'ban' ELSE 'unban' END;
  IF entry.processing_token = p_token AND entry.action = p_action AND desired = p_action THEN
    PERFORM finish_guardian_global_ban(p_entry, p_token, p_removed);
  ELSIF p_wrote AND desired <> p_action THEN
    -- A late Discord write must be compensated even after a newer worker finished.
    UPDATE guardian_ban_entries SET action = desired, status = 'pending', is_enabled = TRUE,
      attempts = 0, next_attempt_at = NOW(), processing_token = NULL, processing_started_at = NULL,
      operation_id = gen_random_uuid(), join_pending = FALSE, last_error = NULL, updated_at = NOW()
    WHERE id = p_entry;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.report_guardian_registry_write(UUID, UUID, TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_guardian_registry_write(UUID, UUID, TEXT, BOOLEAN, BOOLEAN) TO service_role;
