-- Consolidated feature migration file: feature-network
-- Generated from incremental files for easier agent navigation.
-- Keep statements idempotent when adding future changes.

-- ============================================================
-- BEGIN SOURCE: 049_network_relations.sql
-- ============================================================
-- Network Relations: group calendars/meetings under canonical network names
-- and define automated string-matching rules for auto-classification.

-- 1. Canonical network table
CREATE TABLE IF NOT EXISTS public.networks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#3B82F6',  -- hex color for consistent display
  description TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.networks ENABLE ROW LEVEL SECURITY;

-- Service-role only: managed by admins through the API
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'networks' AND policyname = 'networks_deny_all'
  ) THEN
    CREATE POLICY "networks_deny_all" ON public.networks FOR SELECT USING (false);
  END IF;
END $$;

-- 2. Mapping table: link calendar_title or meeting_title strings to a network
CREATE TABLE IF NOT EXISTS public.network_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  network_id UUID NOT NULL REFERENCES public.networks(id) ON DELETE CASCADE,
  source_string TEXT NOT NULL,  -- the original calendar_title / meeting title
  source_type TEXT NOT NULL CHECK (source_type IN ('calendar_title', 'meeting_title', 'description')),
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.network_mappings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'network_mappings' AND policyname = 'network_mappings_deny_all'
  ) THEN
    CREATE POLICY "network_mappings_deny_all" ON public.network_mappings FOR SELECT USING (false);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_network_mappings_network_id ON public.network_mappings(network_id);
CREATE INDEX IF NOT EXISTS idx_network_mappings_source_string ON public.network_mappings(source_string);

-- 3. Automated matching rules: regex/contains patterns that auto-classify
CREATE TABLE IF NOT EXISTS public.network_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  network_id UUID NOT NULL REFERENCES public.networks(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,           -- the match pattern string
  match_type TEXT NOT NULL CHECK (match_type IN ('contains', 'starts_with', 'exact', 'regex')),
  match_field TEXT NOT NULL CHECK (match_field IN ('calendar_title', 'meeting_title', 'description')),
  priority INTEGER NOT NULL DEFAULT 0,  -- higher = checked first
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.network_rules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'network_rules' AND policyname = 'network_rules_deny_all'
  ) THEN
    CREATE POLICY "network_rules_deny_all" ON public.network_rules FOR SELECT USING (false);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_network_rules_network_id ON public.network_rules(network_id);
CREATE INDEX IF NOT EXISTS idx_network_rules_active ON public.network_rules(is_active) WHERE is_active = true;


-- END SOURCE: 049_network_relations.sql

-- BEGIN SOURCE: 038_event_calendar_networks.sql
BEGIN;

ALTER TABLE public.networks ADD COLUMN IF NOT EXISTS original_name TEXT;
ALTER TABLE public.networks ADD COLUMN IF NOT EXISTS source_key TEXT;
ALTER TABLE public.networks ADD COLUMN IF NOT EXISTS source_type TEXT;
ALTER TABLE public.networks ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE public.networks ADD COLUMN IF NOT EXISTS member_keys TEXT[] NOT NULL DEFAULT '{}';
UPDATE public.networks SET original_name = name WHERE original_name IS NULL;
ALTER TABLE public.networks ALTER COLUMN original_name SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS networks_source_key_unique ON public.networks(source_key) WHERE source_key IS NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.networks'::regclass AND conname = 'networks_source_identity') THEN
    ALTER TABLE public.networks ADD CONSTRAINT networks_source_identity CHECK (
      (source_key IS NULL AND source_type IS NULL AND source_id IS NULL)
      OR (source_key IS NOT NULL AND source_type IS NOT NULL AND source_id IS NOT NULL
        AND source_key ~ '^source_[0-9a-f]{64}$' AND source_type IN ('calendar_source', 'coordination_calendar'))
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.network_event_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id UUID NOT NULL REFERENCES public.networks(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('user_event', 'meeting')),
  target_id UUID NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(network_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS network_event_assignments_target_idx ON public.network_event_assignments(target_type, target_id);
ALTER TABLE public.network_event_assignments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'network_event_assignments' AND policyname = 'network_event_assignments_deny_all') THEN
    CREATE POLICY network_event_assignments_deny_all ON public.network_event_assignments FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.validate_network_relations()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE own_key TEXT;
BEGIN
  -- Serialize graph edits so two concurrent unions cannot introduce a cycle.
  PERFORM pg_advisory_xact_lock(138004, 1);
  IF TG_OP = 'DELETE' THEN
    IF OLD.source_key IS NOT NULL THEN
      -- Removing a display alias does not remove its upstream source.
      UPDATE public.networks SET member_keys = array_replace(member_keys, OLD.id::text, OLD.source_key)
        WHERE OLD.id::text = ANY(member_keys);
    ELSE
      UPDATE public.networks SET member_keys = array_remove(member_keys, OLD.id::text)
        WHERE OLD.id::text = ANY(member_keys);
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.original_name IS DISTINCT FROM OLD.original_name
    OR NEW.source_key IS DISTINCT FROM OLD.source_key
    OR NEW.source_type IS DISTINCT FROM OLD.source_type
    OR NEW.source_id IS DISTINCT FROM OLD.source_id
  ) THEN
    RAISE EXCEPTION 'Original network source identity cannot be changed' USING ERRCODE = '23514';
  END IF;
  NEW.original_name := COALESCE(NEW.original_name, NEW.name);
  own_key := COALESCE(NEW.source_key, NEW.id::text);
  IF cardinality(NEW.member_keys) > 100 OR array_position(NEW.member_keys, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid network members' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    WITH RECURSIVE descendants(key) AS (
      SELECT unnest(NEW.member_keys)
      UNION
      SELECT unnest(n.member_keys) FROM public.networks n
      JOIN descendants d ON d.key = n.id::text OR d.key = n.source_key
    )
    SELECT 1 FROM descendants WHERE key IN (own_key, NEW.id::text)
  ) THEN
    RAISE EXCEPTION 'Combined networks cannot contain cycles' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS validate_network_relations ON public.networks;
CREATE TRIGGER validate_network_relations BEFORE INSERT OR UPDATE OR DELETE ON public.networks
FOR EACH ROW EXECUTE FUNCTION public.validate_network_relations();
REVOKE ALL ON FUNCTION public.validate_network_relations() FROM PUBLIC, anon, authenticated;

COMMIT;
-- END SOURCE: 038_event_calendar_networks.sql

-- BEGIN SOURCE: 039_network_rename_joins.sql
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
-- END SOURCE: 039_network_rename_joins.sql

-- BEGIN SOURCE: 040_network_delete_cascade.sql
BEGIN;

ALTER TABLE public.networks DROP CONSTRAINT IF EXISTS networks_merged_into_fkey;
ALTER TABLE public.networks ADD CONSTRAINT networks_merged_into_fkey
  FOREIGN KEY (merged_into) REFERENCES public.networks(id) ON DELETE CASCADE;

-- The existing BEFORE DELETE trigger preserves raw source references when
-- removing an alias. Deleting tags now removes those union relationships too.
CREATE OR REPLACE FUNCTION public.cleanup_deleted_network_references()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.networks
    SET member_keys = array_remove(array_remove(member_keys, OLD.id::text), OLD.source_key)
    WHERE OLD.id::text = ANY(member_keys) OR OLD.source_key = ANY(member_keys);
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS cleanup_deleted_network_references ON public.networks;
CREATE TRIGGER cleanup_deleted_network_references AFTER DELETE ON public.networks
FOR EACH ROW EXECUTE FUNCTION public.cleanup_deleted_network_references();
REVOKE ALL ON FUNCTION public.cleanup_deleted_network_references() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
-- END SOURCE: 040_network_delete_cascade.sql
