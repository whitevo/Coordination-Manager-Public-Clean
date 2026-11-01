DO $$ BEGIN
  IF current_database() <> 'event_calendar_networks_test'
    AND current_setting('coordination_manager.disposable_network_test', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Requires disposable event_calendar_networks_test database';
  END IF;
END $$;
BEGIN;
INSERT INTO public.networks (id, name, created_by)
VALUES ('30000000-0000-4000-8000-000000000001', 'Join A', 'owner-a'),
       ('30000000-0000-4000-8000-000000000002', 'Join B', 'owner-b'),
       ('30000000-0000-4000-8000-000000000003', 'Join C', 'owner-c');
INSERT INTO public.network_mappings(network_id, source_string, source_type)
VALUES ('30000000-0000-4000-8000-000000000001', 'MeTTa Coders', 'meeting_title');
INSERT INTO public.network_event_assignments(network_id, target_type, target_id, created_by)
VALUES ('30000000-0000-4000-8000-000000000001', 'meeting', gen_random_uuid(), 'owner-a');
SELECT public.join_event_network('30000000-0000-4000-8000-000000000001', 'Join B');
SELECT public.join_event_network('30000000-0000-4000-8000-000000000001', 'Join B');
SELECT public.join_event_network('30000000-0000-4000-8000-000000000002', 'Join C');
SELECT public.join_event_network(NULL, 'Join C', jsonb_build_object(
  'key', 'source_' || repeat('c', 64), 'name', 'Original source',
  'source_type', 'calendar_source', 'source_id', 'private-source', 'created_by', 'source-owner'));
SELECT public.join_event_network(NULL, 'Join C', jsonb_build_object(
  'key', 'source_' || repeat('c', 64), 'name', 'Original source',
  'source_type', 'calendar_source', 'source_id', 'private-source', 'created_by', 'source-owner'));
DO $$ BEGIN
  IF (SELECT merged_into FROM public.networks WHERE name = 'Join A') <> '30000000-0000-4000-8000-000000000002'::uuid THEN
    RAISE EXCEPTION 'Original redirect was not retained';
  END IF;
  IF (SELECT original_name FROM public.networks WHERE name = 'Join A') <> 'Join A' THEN
    RAISE EXCEPTION 'Join lost original name';
  END IF;
  IF (SELECT count(*) FROM public.networks WHERE source_key = 'source_' || repeat('c', 64)) <> 1 THEN
    RAISE EXCEPTION 'Source join retry duplicated provenance';
  END IF;
  IF (SELECT count(*) FROM public.networks WHERE merged_into IS NULL AND name IN ('Join A', 'Join B', 'Join C')) <> 1 THEN
    RAISE EXCEPTION 'Joined origins remain independent filters';
  END IF;
  IF (SELECT count(*) FROM public.network_mappings WHERE source_string = 'MeTTa Coders') <> 1
    OR (SELECT count(*) FROM public.network_event_assignments WHERE created_by = 'owner-a') <> 1 THEN
    RAISE EXCEPTION 'Join deleted origin memberships';
  END IF;
  IF (SELECT created_by FROM public.networks WHERE name = 'Join C') <> 'owner-c' THEN
    RAISE EXCEPTION 'Join overwrote destination ownership';
  END IF;
  BEGIN
    UPDATE public.networks SET member_keys = ARRAY['30000000-0000-4000-8000-000000000003']
      WHERE name = 'Join A';
    RAISE EXCEPTION 'Union/redirect cycle accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.networks SET merged_into = '30000000-0000-4000-8000-000000000001' WHERE name = 'Join C';
    RAISE EXCEPTION 'Redirect cycle accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF has_function_privilege('anon', 'public.join_event_network(uuid,text,jsonb)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.join_event_network(uuid,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Client can execute privileged join RPC';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.join_event_network(uuid,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Service cannot execute join RPC';
  END IF;
END $$;
DELETE FROM public.networks WHERE name = 'Join C';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.networks WHERE name IN ('Join A', 'Join B', 'Join C', 'Original source')) THEN
    RAISE EXCEPTION 'Destination deletion did not cascade through joined networks';
  END IF;
  IF EXISTS (SELECT 1 FROM public.network_mappings WHERE source_string = 'MeTTa Coders')
    OR EXISTS (SELECT 1 FROM public.network_event_assignments WHERE created_by = 'owner-a') THEN
    RAISE EXCEPTION 'Cascading deletion retained tagging relationships';
  END IF;
END $$;
ROLLBACK;
