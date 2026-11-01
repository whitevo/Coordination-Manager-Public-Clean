DO $$ BEGIN
  IF current_database() NOT IN ('cm_fresh_smoke', 'cm_upgrade_smoke') THEN
    RAISE EXCEPTION 'User/calendar access tests require the disposable consolidation smoke database';
  END IF;
END $$;

BEGIN;

INSERT INTO auth.users(id, email) VALUES
  ('10000000-0000-0000-0000-000000000001', 'security-a@example.test'),
  ('10000000-0000-0000-0000-000000000002', 'security-b@example.test'),
  ('10000000-0000-0000-0000-000000000003', 'security-c@example.test');

INSERT INTO public.users(id, email, roles) VALUES
  ('10000000-0000-0000-0000-000000000001', 'security-a@example.test', '["user"]'::jsonb),
  ('10000000-0000-0000-0000-000000000002', 'security-b@example.test', '["user"]'::jsonb);

INSERT INTO public.calendars(id, hash, title, created_by) VALUES
  ('20000000-0000-0000-0000-000000000001', 'security-a1', 'A calendar', 'security-a@example.test'),
  ('20000000-0000-0000-0000-000000000002', 'security-b1', 'B calendar', 'security-b@example.test');

INSERT INTO public.availability(id, calendar_id, username, time_slots) VALUES
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'Participant B', '["2030-01-01T10:00"]'::jsonb);

INSERT INTO public.meetings(
  id, calendar_id, title, start_time, end_time, duration_minutes, time_slots, created_by
) VALUES (
  '40000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002',
  'Meeting B', '2030-01-01 10:00:00', '2030-01-01 11:00:00', 60,
  '["2030-01-01T10:00"]'::jsonb, 'security-b@example.test'
);

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['users', 'availability', 'meetings'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = format('public.%I', table_name)::regclass) THEN
      RAISE EXCEPTION 'RLS is disabled on public.%', table_name;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'users'
      AND policyname = 'Deny direct client writes to user profiles'
      AND cmd = 'ALL'
      AND roles @> ARRAY['anon'::name, 'authenticated'::name]
      AND qual = 'false'
      AND with_check = 'false'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'availability'
      AND policyname = 'Deny direct client access to availability'
      AND cmd = 'ALL'
      AND roles @> ARRAY['anon'::name, 'authenticated'::name]
      AND qual = 'false'
      AND with_check = 'false'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'meetings'
      AND policyname = 'Deny direct client access to meetings'
      AND cmd = 'ALL'
      AND roles @> ARRAY['anon'::name, 'authenticated'::name]
      AND qual = 'false'
      AND with_check = 'false'
  ) THEN
    RAISE EXCEPTION 'Expected client-deny RLS policies are missing or weakened';
  END IF;

  IF has_table_privilege('anon', 'public.users', 'SELECT,INSERT,UPDATE,DELETE')
    OR has_table_privilege('authenticated', 'public.users', 'INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'Direct user profile writes remain granted to client roles';
  END IF;
  IF has_any_column_privilege('anon', 'public.users', 'SELECT,INSERT,UPDATE,REFERENCES')
    OR has_any_column_privilege('authenticated', 'public.users', 'INSERT,UPDATE,REFERENCES') THEN
    RAISE EXCEPTION 'Column-level user profile privileges remain granted to client roles';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.users', 'SELECT') THEN
    RAISE EXCEPTION 'Authenticated users lost profile reads';
  END IF;
  IF has_table_privilege('anon', 'public.availability', 'SELECT,INSERT,UPDATE,DELETE')
    OR has_table_privilege('authenticated', 'public.availability', 'SELECT,INSERT,UPDATE,DELETE')
    OR has_table_privilege('anon', 'public.meetings', 'SELECT,INSERT,UPDATE,DELETE')
    OR has_table_privilege('authenticated', 'public.meetings', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'Client roles retain direct availability or meeting access';
  END IF;
  IF has_any_column_privilege('anon', 'public.availability', 'SELECT,INSERT,UPDATE,REFERENCES')
    OR has_any_column_privilege('authenticated', 'public.availability', 'SELECT,INSERT,UPDATE,REFERENCES')
    OR has_any_column_privilege('anon', 'public.meetings', 'SELECT,INSERT,UPDATE,REFERENCES')
    OR has_any_column_privilege('authenticated', 'public.meetings', 'SELECT,INSERT,UPDATE,REFERENCES') THEN
    RAISE EXCEPTION 'Column-level availability or meeting privileges remain granted to client roles';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.users', 'SELECT,INSERT,UPDATE,DELETE')
    OR NOT has_table_privilege('service_role', 'public.availability', 'SELECT,INSERT,UPDATE,DELETE')
    OR NOT has_table_privilege('service_role', 'public.meetings', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'Service role lost required API database operations';
  END IF;
END
$$;

SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM 1 FROM public.availability;
    RAISE EXCEPTION 'Anonymous availability read succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.availability(calendar_id, username, time_slots)
    VALUES ('20000000-0000-0000-0000-000000000001', 'Anonymous', '[]'::jsonb);
    RAISE EXCEPTION 'Anonymous availability insert succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.meetings;
    RAISE EXCEPTION 'Anonymous meeting read succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = '10000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'Authenticated own-profile read failed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE id = '10000000-0000-0000-0000-000000000002') THEN
    RAISE EXCEPTION 'Cross-user profile read succeeded';
  END IF;

  BEGIN
    UPDATE public.users SET roles = '["admin"]'::jsonb, role = 'admin'
    WHERE id = '10000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'Own-row role escalation succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.users SET roles = '["admin"]'::jsonb, role = 'admin'
    WHERE id = '10000000-0000-0000-0000-000000000002';
    RAISE EXCEPTION 'Cross-user profile role update succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.users(id, roles)
    VALUES ('10000000-0000-0000-0000-000000000003', '["admin"]'::jsonb);
    RAISE EXCEPTION 'Direct admin-profile insert succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.users SET display_name = 'Direct client edit'
    WHERE id = '10000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'Direct client profile edit bypassed the authenticated API';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM 1 FROM public.availability
    WHERE calendar_id = '20000000-0000-0000-0000-000000000002';
    RAISE EXCEPTION 'Cross-calendar availability read succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.availability(calendar_id, username, time_slots)
    VALUES ('20000000-0000-0000-0000-000000000002', 'Attacker', '[]'::jsonb);
    RAISE EXCEPTION 'Cross-calendar availability insert succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.availability SET username = 'Attacker'
    WHERE calendar_id = '20000000-0000-0000-0000-000000000002';
    RAISE EXCEPTION 'Cross-calendar availability update succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM 1 FROM public.meetings
    WHERE calendar_id = '20000000-0000-0000-0000-000000000002';
    RAISE EXCEPTION 'Cross-calendar meeting read succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.meetings(calendar_id, title, start_time, end_time, duration_minutes, time_slots)
    VALUES ('20000000-0000-0000-0000-000000000002', 'Attacker', NOW(), NOW() + INTERVAL '1 hour', 60, '[]'::jsonb);
    RAISE EXCEPTION 'Cross-calendar meeting insert succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.meetings SET title = 'Attacker'
    WHERE calendar_id = '20000000-0000-0000-0000-000000000002';
    RAISE EXCEPTION 'Cross-calendar meeting update succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $$
DECLARE affected INTEGER;
BEGIN
  UPDATE public.users SET display_name = 'API profile edit'
  WHERE id = '10000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'Service-role profile edit failed'; END IF;
  IF (SELECT roles FROM public.users WHERE id = '10000000-0000-0000-0000-000000000001') <> '["user"]'::jsonb THEN
    RAISE EXCEPTION 'Service-role profile edit changed role data';
  END IF;

  IF (SELECT count(*) FROM public.availability WHERE calendar_id = '20000000-0000-0000-0000-000000000002') <> 1
    OR (SELECT count(*) FROM public.meetings WHERE calendar_id = '20000000-0000-0000-0000-000000000002') <> 1 THEN
    RAISE EXCEPTION 'Service-role hash-link API reads failed';
  END IF;

  UPDATE public.availability SET time_slots = '["2030-01-01T11:00"]'::jsonb
  WHERE id = '30000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'Service-role availability update failed'; END IF;

  INSERT INTO public.availability(calendar_id, username, time_slots)
  VALUES ('20000000-0000-0000-0000-000000000001', 'Guest', '[]'::jsonb);
  INSERT INTO public.meetings(calendar_id, title, start_time, end_time, duration_minutes, time_slots)
  VALUES ('20000000-0000-0000-0000-000000000001', 'API meeting', NOW(), NOW() + INTERVAL '1 hour', 60, '[]'::jsonb);

  UPDATE public.meetings SET title = 'API meeting updated'
  WHERE id = '40000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'Service-role meeting update failed'; END IF;

  DELETE FROM public.availability
  WHERE calendar_id = '20000000-0000-0000-0000-000000000001' AND username = 'Guest';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'Service-role guest availability delete failed'; END IF;

  DELETE FROM public.meetings
  WHERE calendar_id = '20000000-0000-0000-0000-000000000001' AND title = 'API meeting';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'Service-role meeting delete failed'; END IF;
END
$$;
RESET ROLE;

ROLLBACK;
