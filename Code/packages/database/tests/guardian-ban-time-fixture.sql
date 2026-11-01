BEGIN;
DO $$ BEGIN
  IF current_database() <> 'guardian_test' THEN RAISE EXCEPTION 'Requires guardian_test'; END IF;
END $$;
INSERT INTO public.users VALUES ('550e8400-e29b-41d4-a716-446655440000');
INSERT INTO public.guardian_ban_accounts(discord_user_id, created_by, requested_by_discord_id)
VALUES ('223456789012345678', '550e8400-e29b-41d4-a716-446655440000', '423456789012345678'),
  ('323456789012345678', '550e8400-e29b-41d4-a716-446655440000', '423456789012345678');
INSERT INTO public.guardian_ban_removals(operation_id, discord_user_id, guild_id, removed_at)
VALUES (gen_random_uuid(), '223456789012345678', '123456789012345678', '2026-10-01T10:00:00Z'),
  (gen_random_uuid(), '223456789012345678', '123456789012345678', '2026-10-02T10:00:00Z');
INSERT INTO public.guardian_ban_entries(guild_id, discord_user_id, reason, created_by, requested_by, requested_by_discord_id, status, banned_at)
VALUES ('123456789012345678', '323456789012345678', 'Absent pre-ban',
  '550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440000',
  '423456789012345678', 'banned', '2026-10-03T10:00:00Z');
