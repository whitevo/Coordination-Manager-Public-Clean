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
