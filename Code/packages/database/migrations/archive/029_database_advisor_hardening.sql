-- Run as the database owner after the mailbox and 019 RLS migrations.
-- Keep private out of the Supabase Data API exposed schemas.
BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
REVOKE CREATE ON SCHEMA private FROM authenticated;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

DO $migration$
BEGIN
  IF to_regprocedure('public.current_user_has_role(text)') IS NOT NULL THEN
    IF to_regprocedure('private.current_user_has_role(text)') IS NOT NULL THEN
      RAISE EXCEPTION 'Both public and private role helpers exist; resolve dependencies before migrating';
    END IF;
    -- Moving the existing object preserves the OID referenced by RLS policies.
    ALTER FUNCTION public.current_user_has_role(TEXT) SET SCHEMA private;
  ELSIF to_regprocedure('private.current_user_has_role(text)') IS NULL THEN
    RAISE EXCEPTION 'Role helper missing; apply 019_optimize_rls_policies.sql first';
  END IF;
END
$migration$;

CREATE OR REPLACE FUNCTION private.current_user_has_role(check_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = (SELECT auth.uid())
      AND roles @> to_jsonb(check_role)
  );
$$;

REVOKE ALL ON FUNCTION private.current_user_has_role(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.current_user_has_role(TEXT) TO authenticated, service_role;

ALTER FUNCTION public.set_first_mail_account_primary() SET search_path = '';

CREATE SCHEMA IF NOT EXISTS extensions;
REVOKE CREATE ON SCHEMA extensions FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

DO $migration$
DECLARE
  extension_schema TEXT;
  extension_relocatable BOOLEAN;
BEGIN
  SELECT n.nspname, e.extrelocatable
    INTO extension_schema, extension_relocatable
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pg_trgm';

  IF extension_schema IS NULL THEN
    RAISE EXCEPTION 'pg_trgm missing; apply the mailbox feature schema first';
  END IF;
  IF extension_schema <> 'extensions' THEN
    IF NOT extension_relocatable THEN
      RAISE EXCEPTION 'Installed pg_trgm is not relocatable';
    END IF;
    ALTER EXTENSION pg_trgm SET SCHEMA extensions;
  END IF;
END
$migration$;

COMMIT;
