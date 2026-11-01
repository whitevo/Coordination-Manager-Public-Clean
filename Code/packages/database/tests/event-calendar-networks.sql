-- Run after the network feature migration, only on a disposable database.
DO $$ BEGIN
  IF current_database() <> 'event_calendar_networks_test'
    AND current_setting('coordination_manager.disposable_network_test', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Requires disposable event_calendar_networks_test database';
  END IF;
END $$;
BEGIN;
INSERT INTO public.networks (id, name, created_by)
VALUES ('10000000-0000-4000-8000-000000000001', 'Network A', 'owner-a'),
       ('10000000-0000-4000-8000-000000000002', 'Network B', 'owner-b');
INSERT INTO public.networks (id, name, created_by, member_keys)
VALUES ('10000000-0000-4000-8000-000000000003', 'Combined C', 'owner-c',
        ARRAY['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002']);
INSERT INTO public.networks (id, name, created_by, source_key, source_type, source_id)
VALUES ('10000000-0000-4000-8000-000000000004', 'Renamed source', 'owner-a',
        'source_' || repeat('a', 64), 'calendar_source', 'private-source');
UPDATE public.networks SET name = 'Renamed again' WHERE id = '10000000-0000-4000-8000-000000000004';
DO $$ BEGIN
  IF (SELECT original_name FROM public.networks WHERE id = '10000000-0000-4000-8000-000000000004') <> 'Renamed source' THEN
    RAISE EXCEPTION 'Original name was not preserved';
  END IF;
  BEGIN
    UPDATE public.networks SET original_name = 'Forged' WHERE id = '10000000-0000-4000-8000-000000000004';
    RAISE EXCEPTION 'Original identity modification was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.networks SET member_keys = ARRAY['10000000-0000-4000-8000-000000000003']
      WHERE id = '10000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'Indirect network cycle was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.networks (id, name, member_keys)
    VALUES ('10000000-0000-4000-8000-000000000005', 'Self cycle', ARRAY['10000000-0000-4000-8000-000000000005']);
    RAISE EXCEPTION 'Self network cycle was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.networks (name, source_key) VALUES ('Partial source identity', 'source_' || repeat('b', 64));
    RAISE EXCEPTION 'Partial source identity was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

INSERT INTO public.network_event_assignments (network_id, target_type, target_id, created_by)
VALUES ('10000000-0000-4000-8000-000000000001', 'meeting', '20000000-0000-4000-8000-000000000001', 'owner-a'),
       ('10000000-0000-4000-8000-000000000002', 'meeting', '20000000-0000-4000-8000-000000000001', 'owner-a');
DO $$ BEGIN
  IF (SELECT count(*) FROM public.network_event_assignments WHERE target_id = '20000000-0000-4000-8000-000000000001') <> 2 THEN
    RAISE EXCEPTION 'Multiple meeting memberships were not retained';
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.network_event_assignments TO anon, authenticated;
GRANT SELECT ON public.networks TO anon, authenticated;
SET LOCAL ROLE anon;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.networks) THEN RAISE EXCEPTION 'Anonymous source identity reads bypass RLS'; END IF;
  IF EXISTS (SELECT 1 FROM public.network_event_assignments) THEN RAISE EXCEPTION 'Anonymous assignment reads bypass RLS'; END IF;
  BEGIN
    INSERT INTO public.network_event_assignments (network_id, target_type, target_id, created_by)
    VALUES ('10000000-0000-4000-8000-000000000001', 'meeting', gen_random_uuid(), 'forged');
    RAISE EXCEPTION 'Anonymous assignment insertion bypasses RLS';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.networks) THEN RAISE EXCEPTION 'Authenticated source identity reads bypass RLS'; END IF;
  IF EXISTS (SELECT 1 FROM public.network_event_assignments) THEN RAISE EXCEPTION 'Authenticated assignment reads bypass RLS'; END IF;
  BEGIN
    INSERT INTO public.network_event_assignments (network_id, target_type, target_id, created_by)
    VALUES ('10000000-0000-4000-8000-000000000001', 'meeting', gen_random_uuid(), 'forged');
    RAISE EXCEPTION 'Authenticated assignment insertion bypasses RLS';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE public.network_event_assignments SET created_by = 'forged';
  DELETE FROM public.network_event_assignments;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.network_event_assignments) <> 2 THEN RAISE EXCEPTION 'Client assignment mutations bypass RLS'; END IF;
  IF EXISTS (SELECT 1 FROM public.network_event_assignments WHERE created_by = 'forged') THEN
    RAISE EXCEPTION 'Client assignment ownership updates bypass RLS';
  END IF;
END $$;
DELETE FROM public.networks WHERE id = '10000000-0000-4000-8000-000000000001';
DO $$ BEGIN
  IF (SELECT member_keys FROM public.networks WHERE id = '10000000-0000-4000-8000-000000000003') <> ARRAY['10000000-0000-4000-8000-000000000002'] THEN
    RAISE EXCEPTION 'Deleted network still referenced by union';
  END IF;
  IF (SELECT count(*) FROM public.network_event_assignments) <> 1 THEN RAISE EXCEPTION 'Assignment deletion did not cascade'; END IF;
END $$;
UPDATE public.networks SET member_keys = member_keys || ARRAY['source_' || repeat('a', 64)]
  WHERE id = '10000000-0000-4000-8000-000000000003';
DELETE FROM public.networks WHERE id = '10000000-0000-4000-8000-000000000004';
DO $$ BEGIN
  IF (SELECT ('source_' || repeat('a', 64)) = ANY(member_keys)
    FROM public.networks WHERE id = '10000000-0000-4000-8000-000000000003') THEN
    RAISE EXCEPTION 'Deleting a source tag left a stale combined-network reference';
  END IF;
END $$;
ROLLBACK;
