DO $$ BEGIN
  IF (SELECT count(*) FROM public.guardian_ban_accounts) <> 1 THEN RAISE EXCEPTION 'Legacy IDs not deduplicated'; END IF;
  IF (SELECT created_at FROM public.guardian_ban_accounts LIMIT 1) <> '2026-01-01T00:00:00Z'::TIMESTAMPTZ THEN
    RAISE EXCEPTION 'Earliest added date lost';
  END IF;
  IF (SELECT boot_count FROM public.guardian_ban_accounts LIMIT 1) <> 0 THEN RAISE EXCEPTION 'Invented historical boots'; END IF;
  IF (SELECT count(*) FROM public.guardian_ban_entries) <> 3 THEN RAISE EXCEPTION 'Legacy audit rows lost'; END IF;
  IF EXISTS (SELECT 1 FROM public.guardian_ban_entries WHERE status <> 'registered') THEN
    RAISE EXCEPTION 'Migration directly queued live bans';
  END IF;
END $$;
ROLLBACK;
