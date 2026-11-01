DO $$ BEGIN
  IF (SELECT last_booted_at FROM public.guardian_ban_accounts WHERE discord_user_id = '223456789012345678')
    IS DISTINCT FROM '2026-10-02T10:00:00Z'::TIMESTAMPTZ THEN RAISE EXCEPTION 'Receipt backfill did not use latest confirmed removal'; END IF;
  IF (SELECT last_booted_at FROM public.guardian_ban_accounts WHERE discord_user_id = '323456789012345678')
    IS NOT NULL THEN RAISE EXCEPTION 'Absent pre-ban invented a boot timestamp'; END IF;
END $$;
ROLLBACK;
