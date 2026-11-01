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
