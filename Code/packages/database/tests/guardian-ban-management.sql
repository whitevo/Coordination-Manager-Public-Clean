BEGIN;
DO $$ BEGIN
  IF current_database() <> 'guardian_test' THEN RAISE EXCEPTION 'Requires guardian_test'; END IF;
END $$;
INSERT INTO public.users VALUES ('550e8400-e29b-41d4-a716-446655440000');
INSERT INTO public.guardian_instance_lock VALUES ('singleton', 'leader', NOW());
DO $$
DECLARE
  actor UUID := '550e8400-e29b-41d4-a716-446655440000';
  target TEXT := '223456789012345678';
  guild TEXT := '123456789012345678';
  claim guardian_ban_entries;
  old_token UUID;
  preview guardian_ban_previews;
BEGIN
  INSERT INTO guardian_ban_accounts(discord_user_id, created_by, requested_by_discord_id)
    VALUES (target, actor, '423456789012345678');
  PERFORM enqueue_guardian_join_ban(guild, target);
  SELECT * INTO claim FROM claim_guardian_ban('leader');
  PERFORM finish_guardian_global_ban(claim.id, claim.processing_token, TRUE);
  IF (SELECT boot_count FROM guardian_ban_accounts WHERE discord_user_id = target) <> 1 OR
    (SELECT last_booted_at FROM guardian_ban_accounts WHERE discord_user_id = target) IS NULL THEN
    RAISE EXCEPTION 'Confirmed removal timestamp/count missing';
  END IF;
  PERFORM finish_guardian_global_ban(claim.id, claim.processing_token, TRUE);
  IF (SELECT boot_count FROM guardian_ban_accounts WHERE discord_user_id = target) <> 1 THEN
    RAISE EXCEPTION 'Duplicate removal inflated count';
  END IF;
  -- Recovery catches an arrival missed while offline, once, without a normal-message scan.
  PERFORM recover_guardian_global_bans(ARRAY[guild], '');
  IF (SELECT status FROM guardian_ban_entries WHERE id = claim.id) <> 'pending' THEN
    RAISE EXCEPTION 'Recovery missed existing registry entry';
  END IF;
  SELECT * INTO claim FROM claim_guardian_ban('leader');
  old_token := claim.processing_token;
  IF remove_guardian_global_bans(ARRAY[target], ARRAY[guild, '623456789012345678'], actor, '423456789012345678') <> 1 THEN
    RAISE EXCEPTION 'Removal count mismatch';
  END IF;
  IF (SELECT is_active FROM guardian_ban_accounts WHERE discord_user_id = target) THEN RAISE EXCEPTION 'Removal left enforcement active'; END IF;
  IF (SELECT count(*) FROM guardian_ban_entries WHERE discord_user_id = target AND action = 'unban' AND status = 'pending') <> 2 THEN
    RAISE EXCEPTION 'Global unbans not queued';
  END IF;
  PERFORM finish_guardian_global_ban(claim.id, old_token, TRUE);
  IF (SELECT action FROM guardian_ban_entries WHERE id = claim.id) <> 'unban' OR
    (SELECT status FROM guardian_ban_entries WHERE id = claim.id) <> 'pending' THEN
    RAISE EXCEPTION 'Late ban receipt overwrote unban';
  END IF;
  PERFORM enqueue_guardian_join_ban('723456789012345678', target);
  PERFORM recover_guardian_global_bans(ARRAY['723456789012345678'], '');
  IF EXISTS (SELECT 1 FROM guardian_ban_entries WHERE guild_id = '723456789012345678') THEN
    RAISE EXCEPTION 'Removed account reactivated by arrival/recovery';
  END IF;
  IF remove_guardian_global_bans(ARRAY[target], ARRAY[guild], actor, '423456789012345678') <> 0 THEN
    RAISE EXCEPTION 'Duplicate removal was not idempotent';
  END IF;
  SELECT * INTO claim FROM claim_guardian_ban('leader');
  IF claim.action <> 'unban' THEN RAISE EXCEPTION 'Worker did not claim an unban'; END IF;
  PERFORM finish_guardian_global_ban(claim.id, claim.processing_token, FALSE);
  IF (SELECT is_enabled FROM guardian_ban_entries WHERE id = claim.id) THEN RAISE EXCEPTION 'Completed unban stayed enabled'; END IF;
  IF (SELECT boot_count FROM guardian_ban_accounts WHERE discord_user_id = target) <> 1 THEN RAISE EXCEPTION 'Unban inflated boot count'; END IF;
  SELECT * INTO claim FROM claim_guardian_ban('leader');
  old_token := claim.processing_token;
  INSERT INTO guardian_ban_previews(created_by, actor_discord_id, discord_ids, guild_ids, confirmation_requested,
    status, processing_token) VALUES (actor, '423456789012345678', ARRAY[target], ARRAY[guild, '623456789012345678'],
    TRUE, 'processing', gen_random_uuid()) RETURNING * INTO preview;
  IF confirm_guardian_global_bans(preview.id, actor, preview.processing_token) <> 1 THEN RAISE EXCEPTION 'Removed ID could not be re-added'; END IF;
  PERFORM finish_guardian_global_ban(claim.id, old_token, FALSE);
  IF EXISTS (SELECT 1 FROM guardian_ban_entries WHERE discord_user_id = target AND action <> 'ban') OR
    EXISTS (SELECT 1 FROM guardian_ban_entries WHERE discord_user_id = target AND status <> 'pending') THEN
    RAISE EXCEPTION 'Late unban receipt overwrote re-added bans';
  END IF;
  IF (SELECT boot_count FROM guardian_ban_accounts WHERE discord_user_id = target) <> 1 THEN
    RAISE EXCEPTION 'Re-add lost historical counts';
  END IF;
  IF (SELECT count(*) FROM guardian_ban_removals WHERE discord_user_id = target) <> 1 THEN
    RAISE EXCEPTION 'Removal audit evidence lost';
  END IF;
  -- An old unban can complete after re-add; its report must queue a compensating ban.
  PERFORM report_guardian_registry_write(claim.id, old_token, 'unban', FALSE, TRUE);
  IF (SELECT action FROM guardian_ban_entries WHERE id = claim.id) <> 'ban' OR
    (SELECT status FROM guardian_ban_entries WHERE id = claim.id) <> 'pending' THEN
    RAISE EXCEPTION 'Late Discord unban was not compensated';
  END IF;
  IF remove_guardian_global_bans(ARRAY[target], ARRAY[guild], actor, '423456789012345678') <> 1 THEN
    RAISE EXCEPTION 'Second removal failed';
  END IF;
  UPDATE guardian_ban_entries SET status = 'registered', is_enabled = FALSE
    WHERE discord_user_id = target AND action = 'unban';
  -- Even if unban has finished, an old ban result must restart the desired unban.
  PERFORM report_guardian_registry_write(claim.id, old_token, 'ban', TRUE, TRUE);
  IF (SELECT action FROM guardian_ban_entries WHERE id = claim.id) <> 'unban' OR
    (SELECT status FROM guardian_ban_entries WHERE id = claim.id) <> 'pending' THEN
    RAISE EXCEPTION 'Late Discord ban was not compensated';
  END IF;
  IF (SELECT boot_count FROM guardian_ban_accounts WHERE discord_user_id = target) <> 1 THEN
    RAISE EXCEPTION 'Superseded operation inflated counts';
  END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF has_function_privilege('public.remove_guardian_global_bans(text[],text[],uuid,text)', 'EXECUTE') OR
    has_function_privilege('public.recover_guardian_global_bans(text[],text)', 'EXECUTE') OR
    has_function_privilege('public.report_guardian_registry_write(uuid,uuid,text,boolean,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Client can remove/recover global registry';
  END IF;
END $$;
RESET ROLE;
ROLLBACK;
