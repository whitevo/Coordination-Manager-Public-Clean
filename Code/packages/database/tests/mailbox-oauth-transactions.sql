DO $$ BEGIN
  IF current_database() <> 'mailbox_oauth_test' THEN
    RAISE EXCEPTION 'OAuth tests require the disposable mailbox_oauth_test database';
  END IF;
END $$;

BEGIN;
INSERT INTO public.users(id) VALUES
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002');
INSERT INTO public.mailbox_oauth_transactions(id, user_id, provider, browser_token_hash, expires_at)
VALUES (
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'gmail', repeat('a', 64), NOW() + INTERVAL '10 minutes'
);

DO $$ BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.mailbox_oauth_transactions'::regclass) THEN
    RAISE EXCEPTION 'OAuth transaction RLS is disabled';
  END IF;
  IF has_table_privilege('anon', 'public.mailbox_oauth_transactions', 'SELECT,INSERT,UPDATE,DELETE')
    OR has_table_privilege('authenticated', 'public.mailbox_oauth_transactions', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'Clients have direct OAuth transaction privileges';
  END IF;
END $$;

SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM * FROM public.mailbox_oauth_transactions;
    RAISE EXCEPTION 'Anonymous transaction read succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$ BEGIN
  BEGIN
    DELETE FROM public.mailbox_oauth_transactions;
    RAISE EXCEPTION 'Cross-user transaction delete succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.mailbox_oauth_transactions(user_id, provider, browser_token_hash, expires_at)
    VALUES ('00000000-0000-0000-0000-000000000002', 'gmail', repeat('b', 64), NOW() + INTERVAL '10 minutes');
    RAISE EXCEPTION 'Client transaction insert succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $$
DECLARE affected INTEGER;
BEGIN
  DELETE FROM public.mailbox_oauth_transactions
  WHERE id = '10000000-0000-0000-0000-000000000001'
    AND browser_token_hash = repeat('b', 64);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'Wrong browser claimed a transaction'; END IF;

  DELETE FROM public.mailbox_oauth_transactions
  WHERE id = '10000000-0000-0000-0000-000000000001'
    AND user_id = '00000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'Wrong owner claimed a transaction'; END IF;

  DELETE FROM public.mailbox_oauth_transactions
  WHERE id = '10000000-0000-0000-0000-000000000001' AND provider = 'outlook';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'Wrong provider claimed a transaction'; END IF;

  DELETE FROM public.mailbox_oauth_transactions
  WHERE id = '10000000-0000-0000-0000-000000000001'
    AND user_id = '00000000-0000-0000-0000-000000000001'
    AND provider = 'gmail' AND browser_token_hash = repeat('a', 64) AND expires_at > NOW();
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'Valid transaction claim failed'; END IF;

  DELETE FROM public.mailbox_oauth_transactions
  WHERE id = '10000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'Transaction replay succeeded'; END IF;

  INSERT INTO public.mailbox_oauth_transactions(id, user_id, provider, browser_token_hash, created_at, expires_at)
  VALUES (
    '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001',
    'gmail', repeat('a', 64), NOW() - INTERVAL '20 minutes', NOW() - INTERVAL '10 minutes'
  );
  DELETE FROM public.mailbox_oauth_transactions
  WHERE id = '10000000-0000-0000-0000-000000000002' AND expires_at > NOW();
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'Expired transaction claimed'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
