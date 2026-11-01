-- Apply migrations 024, 025, and 027 before running in a disposable database.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'guardian_test' THEN
    RAISE EXCEPTION 'Guardian SQL tests require guardian_test';
  END IF;
END $$;
INSERT INTO public.users VALUES ('550e8400-e29b-41d4-a716-446655440000');
INSERT INTO public.guardian_instance_lock VALUES ('singleton', 'leader', NOW());

DO $$
DECLARE
  actor UUID := '550e8400-e29b-41d4-a716-446655440000';
  preview public.guardian_ban_previews;
  claimed public.guardian_ban_entries;
  previous_operation UUID;
  affected INTEGER;
BEGIN
  INSERT INTO public.guardian_ban_previews(created_by, actor_discord_id, discord_ids, guild_ids)
  VALUES (actor, '423456789012345678', ARRAY['223456789012345678', '323456789012345678'],
    ARRAY['123456789012345678', '623456789012345678']) RETURNING * INTO preview;
  IF EXISTS (SELECT 1 FROM public.claim_guardian_ban_preview('follower')) THEN
    RAISE EXCEPTION 'Follower claimed preview';
  END IF;
  SELECT * INTO preview FROM public.claim_guardian_ban_preview('leader');
  IF preview.processing_token IS NULL THEN RAISE EXCEPTION 'Preview claim missing'; END IF;
  IF EXISTS (SELECT 1 FROM public.guardian_ban_accounts) OR EXISTS (SELECT 1 FROM public.guardian_ban_entries) THEN
    RAISE EXCEPTION 'Preview mutated registry';
  END IF;
  BEGIN
    PERFORM public.confirm_guardian_global_bans(preview.id, actor, preview.processing_token);
    RAISE EXCEPTION 'Unconfirmed preview registered IDs';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Unconfirmed preview registered IDs' THEN RAISE; END IF;
  END;
  UPDATE public.guardian_ban_previews SET status = 'ready', cursor = 4, member_counts = '{"223456789012345678":1}' WHERE id = preview.id;
  UPDATE public.guardian_ban_previews SET status = 'confirming', cursor = 0, confirmation_requested = TRUE,
    processing_token = NULL WHERE id = preview.id;
  SELECT * INTO preview FROM public.claim_guardian_ban_preview('leader');
  affected := public.confirm_guardian_global_bans(preview.id, actor, preview.processing_token);
  IF affected <> 2 OR (SELECT count(*) FROM public.guardian_ban_accounts) <> 2 OR
    (SELECT count(*) FROM public.guardian_ban_entries) <> 4 THEN RAISE EXCEPTION 'Global registration count mismatch'; END IF;
  IF public.confirm_guardian_global_bans(preview.id, actor, preview.processing_token) <> 0 THEN
    RAISE EXCEPTION 'Repeated confirmation duplicated registration';
  END IF;
  IF (SELECT cursor FROM public.guardian_ban_previews WHERE id = preview.id) <> 2 THEN
    RAISE EXCEPTION 'Confirmed preview progress was not completed';
  END IF;
  INSERT INTO public.guardian_ban_previews(created_by, actor_discord_id, discord_ids, guild_ids,
    confirmation_requested, status, processing_token)
  VALUES (actor, '423456789012345678', ARRAY['223456789012345678'], ARRAY['123456789012345678'],
    TRUE, 'processing', gen_random_uuid()) RETURNING * INTO preview;
  IF public.confirm_guardian_global_bans(preview.id, actor, preview.processing_token) <> 0 THEN
    RAISE EXCEPTION 'Reimport requeued existing IDs';
  END IF;

  -- New servers get all registered IDs, repeated reconciliation does not requeue successes.
  PERFORM public.sync_guardian_global_bans(ARRAY['723456789012345678'], '');
  IF (SELECT count(*) FROM public.guardian_ban_entries) <> 6 THEN RAISE EXCEPTION 'New server was not covered'; END IF;
  SELECT * INTO claimed FROM public.claim_guardian_ban('leader');
  previous_operation := claimed.operation_id;
  PERFORM public.finish_guardian_global_ban(claimed.id, claimed.processing_token, TRUE);
  PERFORM public.finish_guardian_global_ban(claimed.id, claimed.processing_token, TRUE);
  IF (SELECT boot_count FROM public.guardian_ban_accounts WHERE discord_user_id = claimed.discord_user_id) <> 1 THEN
    RAISE EXCEPTION 'Duplicate receipt inflated boot count';
  END IF;
  PERFORM public.sync_guardian_global_bans(ARRAY[claimed.guild_id], '');
  IF (SELECT status FROM public.guardian_ban_entries WHERE id = claimed.id) <> 'banned' THEN
    RAISE EXCEPTION 'Reconciliation requeued a completed ban';
  END IF;
  PERFORM public.enqueue_guardian_join_ban(claimed.guild_id, claimed.discord_user_id);
  IF (SELECT operation_id FROM public.guardian_ban_entries WHERE id = claimed.id) = previous_operation THEN
    RAISE EXCEPTION 'Rejoin did not create a new removal operation';
  END IF;
  UPDATE public.guardian_ban_entries SET next_attempt_at = NOW() + INTERVAL '1 hour' WHERE id <> claimed.id;
  SELECT * INTO claimed FROM public.claim_guardian_ban('leader');
  PERFORM public.finish_guardian_global_ban(claimed.id, claimed.processing_token, FALSE);
  IF (SELECT boot_count FROM public.guardian_ban_accounts WHERE discord_user_id = claimed.discord_user_id) <> 1 THEN
    RAISE EXCEPTION 'Absent pre-ban inflated boot count';
  END IF;
  PERFORM public.enqueue_guardian_join_ban('823456789012345678', claimed.discord_user_id);
  IF NOT EXISTS (SELECT 1 FROM public.guardian_ban_entries WHERE guild_id = '823456789012345678'
    AND discord_user_id = claimed.discord_user_id AND status = 'pending') THEN
    RAISE EXCEPTION 'Join in a future server was not covered';
  END IF;
  SELECT * INTO claimed FROM public.claim_guardian_ban('leader');
  UPDATE public.guardian_ban_entries SET processing_started_at = NOW() - INTERVAL '6 minutes' WHERE id = claimed.id;
  SELECT * INTO claimed FROM public.claim_guardian_ban('leader');
  IF claimed.attempts <> 2 THEN RAISE EXCEPTION 'Stale ban claim did not recover'; END IF;
  PERFORM public.finish_guardian_global_ban(claimed.id, gen_random_uuid(), TRUE);
  IF (SELECT status FROM public.guardian_ban_entries WHERE id = claimed.id) <> 'processing' THEN
    RAISE EXCEPTION 'Stale token finished a newer claim';
  END IF;
  PERFORM public.enqueue_guardian_join_ban(claimed.guild_id, claimed.discord_user_id);
  IF NOT (SELECT join_pending FROM public.guardian_ban_entries WHERE id = claimed.id) THEN
    RAISE EXCEPTION 'Join during processing was dropped';
  END IF;
  PERFORM public.finish_guardian_global_ban(claimed.id, claimed.processing_token, FALSE);
  IF (SELECT status FROM public.guardian_ban_entries WHERE id = claimed.id) <> 'pending' THEN
    RAISE EXCEPTION 'Deferred join was not requeued after completing the in-flight ban';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.guardian_ban_accounts, public.guardian_ban_previews, public.guardian_ban_removals TO authenticated, anon;
SET LOCAL ROLE authenticated;
DO $$ DECLARE t TEXT; affected INTEGER; BEGIN
  IF EXISTS (SELECT 1 FROM public.guardian_ban_accounts) OR EXISTS (SELECT 1 FROM public.guardian_ban_previews)
    OR EXISTS (SELECT 1 FROM public.guardian_ban_removals) THEN RAISE EXCEPTION 'Client read service-only data'; END IF;
  BEGIN
    INSERT INTO public.guardian_ban_accounts(discord_user_id, created_by, requested_by_discord_id)
    VALUES ('923456789012345678', '550e8400-e29b-41d4-a716-446655440000', '423456789012345678');
    RAISE EXCEPTION 'Client wrote service-only data';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.guardian_ban_previews(created_by, actor_discord_id, discord_ids, guild_ids)
    VALUES ('550e8400-e29b-41d4-a716-446655440000', '423456789012345678',
      ARRAY['923456789012345678'], ARRAY['123456789012345678']);
    RAISE EXCEPTION 'Client wrote preview';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.guardian_ban_removals(operation_id, discord_user_id, guild_id)
    VALUES (gen_random_uuid(), '223456789012345678', '123456789012345678');
    RAISE EXCEPTION 'Client wrote removal receipt';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  FOREACH t IN ARRAY ARRAY['guardian_ban_accounts', 'guardian_ban_previews', 'guardian_ban_removals'] LOOP
    EXECUTE format('DELETE FROM public.%I', t);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN RAISE EXCEPTION 'Client deleted from %', t; END IF;
  END LOOP;
  UPDATE public.guardian_ban_accounts SET boot_count = 999;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'Client updated counters'; END IF;
  UPDATE public.guardian_ban_previews SET status = 'confirmed';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'Client confirmed a preview'; END IF;
  IF has_function_privilege('public.confirm_guardian_global_bans(uuid,uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('public.claim_guardian_ban_preview(text)', 'EXECUTE')
    OR has_function_privilege('public.sync_guardian_global_bans(text[],text)', 'EXECUTE')
    OR has_function_privilege('public.finish_guardian_global_ban(uuid,uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Client can execute global ban RPCs';
  END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.guardian_ban_accounts) THEN RAISE EXCEPTION 'Anonymous registry read'; END IF;
  IF has_function_privilege('public.confirm_guardian_global_bans(uuid,uuid,uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'Anonymous global RPC'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.guardian_ban_accounts) <> 2 THEN RAISE EXCEPTION 'Service cannot read global registry'; END IF;
  IF has_function_privilege('public.register_guardian_bans(text[],text[],text,uuid,text,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Legacy scoped registration remains enabled';
  END IF;
END $$;
RESET ROLE;
ROLLBACK;
