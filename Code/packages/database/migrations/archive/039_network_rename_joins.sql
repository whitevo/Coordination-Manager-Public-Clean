BEGIN;
ALTER TABLE public.networks ADD COLUMN IF NOT EXISTS merged_into UUID REFERENCES public.networks(id);
CREATE INDEX IF NOT EXISTS networks_merged_into_idx ON public.networks(merged_into);
ALTER TABLE public.networks DROP CONSTRAINT IF EXISTS networks_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS networks_active_name_unique ON public.networks(name) WHERE merged_into IS NULL;

CREATE OR REPLACE FUNCTION public.validate_network_relations()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(138004, 1);
  IF TG_OP = 'DELETE' THEN
    IF OLD.source_key IS NOT NULL THEN
      UPDATE public.networks SET member_keys = array_replace(member_keys, OLD.id::text, OLD.source_key)
        WHERE OLD.id::text = ANY(member_keys);
    ELSE
      UPDATE public.networks SET member_keys = array_remove(member_keys, OLD.id::text)
        WHERE OLD.id::text = ANY(member_keys);
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.original_name IS DISTINCT FROM OLD.original_name OR NEW.source_key IS DISTINCT FROM OLD.source_key
    OR NEW.source_type IS DISTINCT FROM OLD.source_type OR NEW.source_id IS DISTINCT FROM OLD.source_id
  ) THEN
    RAISE EXCEPTION 'Original network source identity cannot be changed' USING ERRCODE = '23514';
  END IF;
  NEW.original_name := COALESCE(NEW.original_name, NEW.name);
  IF cardinality(NEW.member_keys) > 100 OR array_position(NEW.member_keys, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid network members' USING ERRCODE = '23514';
  END IF;
  -- A union depends on its members; a destination also depends on networks
  -- redirected into it. Check the proposed graph, including this pending row.
  IF EXISTS (
    WITH RECURSIVE nodes AS (
      SELECT id, source_key, member_keys, merged_into FROM public.networks WHERE id <> NEW.id
      UNION ALL SELECT NEW.id, NEW.source_key, NEW.member_keys, NEW.merged_into
    ), edges(parent, child) AS (
      SELECT n.id, m.id FROM nodes n JOIN nodes m
        ON m.id::text = ANY(n.member_keys) OR m.source_key = ANY(n.member_keys)
      UNION SELECT merged_into, id FROM nodes WHERE merged_into IS NOT NULL
    ), paths(origin, child) AS (
      SELECT parent, child FROM edges
      UNION SELECT p.origin, e.child FROM paths p JOIN edges e ON e.parent = p.child
    )
    SELECT 1 FROM paths WHERE origin = child
  ) THEN
    RAISE EXCEPTION 'Network joins and combinations cannot contain cycles' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.join_event_network(
  p_network_id UUID, p_destination_name TEXT, p_source JSONB DEFAULT NULL
) RETURNS public.networks LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE destination public.networks; origin public.networks;
BEGIN
  PERFORM pg_advisory_xact_lock(138004, 1);
  SELECT * INTO destination FROM public.networks
    WHERE name = p_destination_name AND merged_into IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Destination network no longer exists' USING ERRCODE = 'P0002'; END IF;
  IF p_network_id IS NOT NULL THEN
    SELECT * INTO origin FROM public.networks WHERE id = p_network_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Original network no longer exists' USING ERRCODE = 'P0002'; END IF;
  ELSE
    IF p_source IS NULL THEN RAISE EXCEPTION 'Verified source required' USING ERRCODE = '23514'; END IF;
    SELECT * INTO origin FROM public.networks WHERE source_key = p_source->>'key' FOR UPDATE;
  END IF;
  IF origin.id IS NOT NULL THEN
    IF origin.id = destination.id THEN RETURN origin; END IF;
    IF origin.merged_into IS NOT NULL THEN
      IF origin.merged_into = destination.id THEN RETURN origin; END IF;
      RAISE EXCEPTION 'This network has already joined another network' USING ERRCODE = '23514';
    END IF;
    UPDATE public.networks SET merged_into = destination.id, updated_at = NOW()
      WHERE id = origin.id RETURNING * INTO origin;
  ELSE
    INSERT INTO public.networks(name, original_name, source_key, source_type, source_id, created_by, merged_into)
    VALUES (p_source->>'name', p_source->>'name', p_source->>'key',
      p_source->>'source_type', p_source->>'source_id', p_source->>'created_by', destination.id)
    RETURNING * INTO origin;
  END IF;
  RETURN origin;
END $$;
REVOKE ALL ON FUNCTION public.join_event_network(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_event_network(UUID, TEXT, JSONB) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
