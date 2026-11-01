DO $$ BEGIN
  IF current_database() <> 'advisor_test' THEN
    RAISE EXCEPTION 'Advisor tests require the disposable advisor_test database';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.advisor_original_oids
    WHERE helper_oid = 'private.current_user_has_role(text)'::regprocedure::OID
      AND index_oid = 'public.idx_mail_messages_search_trgm'::regclass::OID
  ) THEN
    RAISE EXCEPTION 'Migration replaced existing helper or search index';
  END IF;
END $$;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
DO $$ BEGIN
  IF (SELECT COUNT(*) FROM public.users) <> 1
    OR (SELECT COUNT(*) FROM public.ai_feedback) <> 1
    OR private.current_user_has_role('admin')
    OR private.current_user_has_role('oversight')
    OR private.current_user_has_role('nonexistent')
    OR private.current_user_has_role(NULL)
  THEN
    RAISE EXCEPTION 'Ordinary-user isolation or role checks failed';
  END IF;
END $$;
DO $$
DECLARE affected INTEGER;
BEGIN
  UPDATE public.feedback_responses SET content = 'ordinary-user update';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'Ordinary user updated privileged responses';
  END IF;
END $$;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$ BEGIN
  IF (SELECT COUNT(*) FROM public.users) <> 3
    OR (SELECT COUNT(*) FROM public.ai_feedback) <> 3
    OR NOT private.current_user_has_role('admin')
  THEN
    RAISE EXCEPTION 'Admin RLS access failed';
  END IF;
END $$;
DO $$
DECLARE affected INTEGER;
BEGIN
  UPDATE public.feedback_responses SET content = 'admin update';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'Admin response ownership restriction changed';
  END IF;
  BEGIN
    UPDATE public.feedback_responses
    SET admin_id = '00000000-0000-0000-0000-000000000001'
    WHERE admin_id = auth.uid();
    RAISE EXCEPTION 'Admin transferred response ownership';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  DELETE FROM public.feedback_responses;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'Admin response delete restriction changed';
  END IF;
END $$;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
DO $$ BEGIN
  IF (SELECT COUNT(*) FROM public.users) <> 1
    OR (SELECT COUNT(*) FROM public.ai_feedback) <> 3
    OR NOT private.current_user_has_role('oversight')
  THEN
    RAISE EXCEPTION 'Oversight RLS access failed';
  END IF;
END $$;
SELECT set_config('request.jwt.claim.sub', '', true);
DO $$ BEGIN
  IF private.current_user_has_role('admin') THEN
    RAISE EXCEPTION 'Missing identity must not grant roles';
  END IF;
END $$;
RESET ROLE;

INSERT INTO public.mail_accounts (user_id) VALUES ('00000000-0000-0000-0000-000000000001');
INSERT INTO public.mail_accounts (user_id) VALUES ('00000000-0000-0000-0000-000000000001');
DO $$ BEGIN
  IF (SELECT COUNT(*) FROM public.mail_accounts WHERE is_primary) <> 1
    OR (SELECT COUNT(*) FROM public.mail_accounts WHERE NOT is_primary) <> 1
  THEN
    RAISE EXCEPTION 'First-account primary selection changed';
  END IF;
END $$;

INSERT INTO public.mail_messages VALUES ('coordination meeting'), ('unrelated');
CREATE INDEX advisor_fresh_trgm_index ON public.mail_messages USING GIN (search_text extensions.gin_trgm_ops);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF extensions.similarity('meeting', 'meeting') <> 1 THEN
    RAISE EXCEPTION 'Authenticated trigram access failed';
  END IF;
END $$;
RESET ROLE;
SET LOCAL enable_seqscan = off;
DO $$
DECLARE query_plan JSON;
BEGIN
  EXECUTE 'EXPLAIN (FORMAT JSON) SELECT * FROM public.mail_messages WHERE search_text ILIKE ''%meeting%'''
    INTO query_plan;
  IF query_plan::TEXT NOT LIKE '%Bitmap Index Scan%' THEN
    RAISE EXCEPTION 'Trigram index is not usable for mailbox search';
  END IF;
END $$;
DO $$ BEGIN
  IF (SELECT COUNT(*) FROM public.mail_messages WHERE search_text ILIKE '%meeting%') <> 1 THEN
    RAISE EXCEPTION 'Mailbox substring search changed';
  END IF;
END $$;
ROLLBACK;
