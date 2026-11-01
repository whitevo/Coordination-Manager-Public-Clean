DO $$ BEGIN
  IF current_database() <> 'event_calendar_networks_test'
    AND current_setting('coordination_manager.disposable_network_test', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Requires disposable event_calendar_networks_test database';
  END IF;
END $$;
BEGIN;
INSERT INTO public.networks(id, name)
VALUES ('40000000-0000-4000-8000-000000000001', 'Delete destination'),
       ('40000000-0000-4000-8000-000000000002', 'Delete joined'),
       ('40000000-0000-4000-8000-000000000003', 'Delete chained'),
       ('40000000-0000-4000-8000-000000000004', 'Keep constituent'),
       ('40000000-0000-4000-8000-000000000005', 'Keep unrelated');
INSERT INTO public.networks(id, name, source_key, source_type, source_id)
VALUES ('40000000-0000-4000-8000-000000000006', 'Delete source alias',
  'source_' || repeat('d', 64), 'calendar_source', 'preserved-provider-source');
SELECT public.join_event_network('40000000-0000-4000-8000-000000000003', 'Delete joined');
SELECT public.join_event_network('40000000-0000-4000-8000-000000000002', 'Delete destination');
SELECT public.join_event_network('40000000-0000-4000-8000-000000000006', 'Delete destination');
UPDATE public.networks SET member_keys = ARRAY['40000000-0000-4000-8000-000000000004']
  WHERE name = 'Delete destination';
INSERT INTO public.networks(id, name, member_keys)
VALUES ('40000000-0000-4000-8000-000000000007', 'Keep parent union',
  ARRAY['40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000006',
    'source_' || repeat('d', 64), '40000000-0000-4000-8000-000000000004']);
INSERT INTO public.network_mappings(network_id, source_string, source_type)
SELECT id, 'Delete-test mapping', 'meeting_title' FROM public.networks WHERE name LIKE 'Delete %' OR name = 'Keep unrelated';
INSERT INTO public.network_rules(network_id, pattern, match_type, match_field)
SELECT id, 'Delete-test rule', 'contains', 'meeting_title' FROM public.networks WHERE name LIKE 'Delete %' OR name = 'Keep unrelated';
INSERT INTO public.network_event_assignments(network_id, target_type, target_id, created_by)
SELECT id, 'meeting', '50000000-0000-4000-8000-000000000001', 'delete-test-owner'
FROM public.networks WHERE name LIKE 'Delete %' OR name = 'Keep unrelated';

-- A failure in any descendant must roll back the destination and all cleanup.
CREATE FUNCTION pg_temp.reject_fixture_network_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.name = 'Delete chained' THEN
    RAISE EXCEPTION 'Fixture cascade failure' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER reject_fixture_network_delete BEFORE DELETE ON public.networks
FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_fixture_network_delete();
DO $$ BEGIN
  BEGIN
    DELETE FROM public.networks WHERE name = 'Delete destination';
    RAISE EXCEPTION 'Fixture failure did not block deletion';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT count(*) FROM public.networks WHERE name LIKE 'Delete %') <> 4
    OR (SELECT count(*) FROM public.network_mappings WHERE source_string = 'Delete-test mapping') <> 5
    OR (SELECT count(*) FROM public.network_rules WHERE pattern = 'Delete-test rule') <> 5
    OR (SELECT count(*) FROM public.network_event_assignments WHERE created_by = 'delete-test-owner') <> 5 THEN
    RAISE EXCEPTION 'Failed cascade did not roll back all tagging data';
  END IF;
  IF (SELECT cardinality(member_keys) FROM public.networks WHERE name = 'Keep parent union') <> 6 THEN
    RAISE EXCEPTION 'Failed cascade did not roll back union cleanup';
  END IF;
END $$;
DROP TRIGGER reject_fixture_network_delete ON public.networks;

DELETE FROM public.networks WHERE name = 'Delete destination';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.networks WHERE name LIKE 'Delete %') THEN
    RAISE EXCEPTION 'Destination, chained joins or source alias survived cascade';
  END IF;
  IF (SELECT member_keys FROM public.networks WHERE name = 'Keep parent union')
    <> ARRAY['40000000-0000-4000-8000-000000000004'] THEN
    RAISE EXCEPTION 'Cascade left deleted network or source references in union';
  END IF;
  IF (SELECT count(*) FROM public.networks WHERE name IN ('Keep constituent', 'Keep unrelated', 'Keep parent union')) <> 3 THEN
    RAISE EXCEPTION 'Cascade deleted unrelated networks or ordinary combination members';
  END IF;
  IF (SELECT count(*) FROM public.network_mappings WHERE source_string = 'Delete-test mapping') <> 1
    OR (SELECT count(*) FROM public.network_rules WHERE pattern = 'Delete-test rule') <> 1
    OR (SELECT count(*) FROM public.network_event_assignments WHERE created_by = 'delete-test-owner') <> 1 THEN
    RAISE EXCEPTION 'Cascade retained deleted relationships or removed unrelated memberships';
  END IF;
END $$;
ROLLBACK;
