-- Read-only catalog checks after the current security baseline or archived
-- 029_database_advisor_hardening.sql upgrade.
DO $verification$
BEGIN
  IF to_regprocedure('public.current_user_has_role(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Role helper is still exposed in public';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = to_regprocedure('private.current_user_has_role(text)')
      AND prosecdef
      AND proconfig @> ARRAY['search_path=""']::TEXT[]
  ) THEN
    RAISE EXCEPTION 'Private role helper missing or security configuration incorrect';
  END IF;
  IF has_function_privilege('anon', 'private.current_user_has_role(text)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'private.current_user_has_role(text)', 'EXECUTE')
    OR NOT has_schema_privilege('authenticated', 'private', 'USAGE')
    OR has_schema_privilege('authenticated', 'private', 'CREATE')
  THEN
    RAISE EXCEPTION 'Private role helper permissions incorrect';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = to_regprocedure('public.set_first_mail_account_primary()')
      AND NOT prosecdef
      AND proconfig @> ARRAY['search_path=""']::TEXT[]
  ) THEN
    RAISE EXCEPTION 'Mailbox trigger security configuration incorrect';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_trgm' AND n.nspname = 'extensions'
  ) THEN
    RAISE EXCEPTION 'pg_trgm is not in extensions';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index
    WHERE indexrelid = to_regclass('public.idx_mail_messages_search_trgm')
      AND indisvalid AND indisready
  ) THEN
    RAISE EXCEPTION 'Mailbox trigram index missing or invalid';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE COALESCE(qual, '') LIKE '%public.current_user_has_role(%'
       OR COALESCE(with_check, '') LIKE '%public.current_user_has_role(%'
  ) THEN
    RAISE EXCEPTION 'RLS policies still reference the public role helper';
  END IF;
  RAISE NOTICE 'Database advisor hardening catalog verification passed';
END
$verification$;
