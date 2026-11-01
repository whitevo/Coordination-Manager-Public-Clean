-- Apply migrations 024 and 025 to the disposable test schema before running.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'guardian_test' THEN
    RAISE EXCEPTION 'Guardian SQL tests require the disposable guardian_test database';
  END IF;
END $$;

INSERT INTO public.users VALUES ('550e8400-e29b-41d4-a716-446655440000');
INSERT INTO public.guardian_instance_lock VALUES ('singleton', 'leader', NOW());

DO $$
DECLARE actor UUID := '550e8400-e29b-41d4-a716-446655440000'; claimed public.guardian_ban_entries;
BEGIN
  IF public.register_guardian_bans(
    ARRAY['123456789012345678'], ARRAY['223456789012345678', '323456789012345678'],
    'Reviewed report', actor, '423456789012345678', TRUE
  ) <> 2 THEN RAISE EXCEPTION 'Import count mismatch'; END IF;
  IF (SELECT count(*) FROM public.guardian_ban_entries WHERE guild_id <> '123456789012345678') <> 0 THEN
    RAISE EXCEPTION 'Import leaked to an unselected server';
  END IF;
  IF EXISTS (SELECT 1 FROM public.claim_guardian_ban('follower')) THEN
    RAISE EXCEPTION 'Follower claimed a ban';
  END IF;

  SELECT * INTO claimed FROM public.claim_guardian_ban('leader');
  IF claimed.status <> 'processing' OR claimed.attempts <> 1 OR claimed.processing_token IS NULL THEN
    RAISE EXCEPTION 'Invalid queue claim';
  END IF;
  IF public.register_guardian_bans(
    ARRAY[claimed.guild_id], ARRAY[claimed.discord_user_id], 'Changed', actor, '423456789012345678', TRUE
  ) <> 0 THEN RAISE EXCEPTION 'Import overwrote an in-flight claim'; END IF;
  IF (SELECT reason FROM public.guardian_ban_entries WHERE id = claimed.id) <> 'Reviewed report' THEN
    RAISE EXCEPTION 'Import changed processing metadata';
  END IF;

  UPDATE public.guardian_ban_entries SET is_enabled = FALSE
    WHERE id <> claimed.id;
  IF EXISTS (SELECT 1 FROM public.claim_guardian_ban('leader')) THEN
    RAISE EXCEPTION 'Disabled entry was claimed or active claim was duplicated';
  END IF;
  UPDATE public.guardian_ban_entries
    SET processing_started_at = NOW() - INTERVAL '6 minutes' WHERE id = claimed.id;
  SELECT * INTO claimed FROM public.claim_guardian_ban('leader');
  IF claimed.attempts <> 2 THEN RAISE EXCEPTION 'Stale claim did not recover'; END IF;

  UPDATE public.guardian_ban_entries SET status = 'banned', processing_token = NULL, processing_started_at = NULL
    WHERE id = claimed.id;
  PERFORM public.enqueue_guardian_join_ban('999999999999999999', claimed.discord_user_id);
  IF (SELECT status FROM public.guardian_ban_entries WHERE id = claimed.id) <> 'banned' THEN
    RAISE EXCEPTION 'Join enforcement affected another server';
  END IF;
  PERFORM public.enqueue_guardian_join_ban(claimed.guild_id, claimed.discord_user_id);
  IF (SELECT status FROM public.guardian_ban_entries WHERE id = claimed.id) <> 'pending' THEN
    RAISE EXCEPTION 'Registered join was not queued';
  END IF;

  UPDATE public.guardian_ban_entries SET status = 'pending', next_attempt_at = NOW() + INTERVAL '1 hour'
    WHERE id = claimed.id;
  IF EXISTS (SELECT 1 FROM public.claim_guardian_ban('leader')) THEN
    RAISE EXCEPTION 'Retry delay was ignored';
  END IF;
  UPDATE public.guardian_instance_lock SET heartbeat_at = NOW() - INTERVAL '1 minute';
  UPDATE public.guardian_ban_entries SET next_attempt_at = NOW() WHERE id = claimed.id;
  IF EXISTS (SELECT 1 FROM public.claim_guardian_ban('leader')) THEN
    RAISE EXCEPTION 'Expired leader lease claimed a ban';
  END IF;

  PERFORM public.register_guardian_bans(
    ARRAY['623456789012345678'], ARRAY['723456789012345678'],
    'Join only', actor, '423456789012345678', FALSE
  );
  IF (SELECT status FROM public.guardian_ban_entries WHERE guild_id = '623456789012345678') <> 'registered' THEN
    RAISE EXCEPTION 'Join-only import was pre-banned';
  END IF;
END $$;

INSERT INTO public.guardian_message_log (was_flagged, skip_reason) VALUES (FALSE, 'ignored_role'), (FALSE, NULL);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.guardian_message_log WHERE skip_reason IS NULL) <> 1 THEN
    RAISE EXCEPTION 'Skipped row inflated scan count';
  END IF;
  BEGIN
    INSERT INTO public.guardian_message_log (was_flagged, skip_reason) VALUES (TRUE, 'ignored_role');
    RAISE EXCEPTION 'Flagged settings skip was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.guardian_ban_entries TO anon, authenticated;
SET LOCAL ROLE authenticated;
DO $$
DECLARE affected INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM public.guardian_ban_entries) THEN
    RAISE EXCEPTION 'Authenticated client can read service-only registry';
  END IF;
  BEGIN
    INSERT INTO public.guardian_ban_entries (
      guild_id, discord_user_id, reason, created_by, requested_by, requested_by_discord_id
    ) VALUES (
      '123456789012345678', '823456789012345678', 'Spoofed',
      '550e8400-e29b-41d4-a716-446655440000',
      '550e8400-e29b-41d4-a716-446655440000', '423456789012345678'
    );
    RAISE EXCEPTION 'Authenticated client inserted a registry entry';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE public.guardian_ban_entries SET status = 'pending';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'Authenticated client updated registry entries'; END IF;
  DELETE FROM public.guardian_ban_entries;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'Authenticated client deleted registry entries'; END IF;
  BEGIN
    PERFORM public.claim_guardian_ban('leader');
    RAISE EXCEPTION 'Authenticated client can claim bans';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.enqueue_guardian_join_ban('123456789012345678', '223456789012345678');
    RAISE EXCEPTION 'Authenticated client can enqueue bans';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.register_guardian_bans(
      ARRAY['123456789012345678'], ARRAY['223456789012345678'], 'Spoofed',
      '550e8400-e29b-41d4-a716-446655440000', '423456789012345678', TRUE
    );
    RAISE EXCEPTION 'Authenticated client can register bans';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.guardian_ban_entries) THEN
    RAISE EXCEPTION 'Anonymous client can read registry';
  END IF;
  IF has_function_privilege('public.register_guardian_bans(text[],text[],text,uuid,text,boolean)', 'EXECUTE')
    OR has_function_privilege('public.claim_guardian_ban(text)', 'EXECUTE')
    OR has_function_privilege('public.enqueue_guardian_join_ban(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous client can execute ban registry RPCs';
  END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.guardian_ban_entries) <> 3 THEN
    RAISE EXCEPTION 'Service role cannot read registry';
  END IF;
END $$;
RESET ROLE;
ROLLBACK;
