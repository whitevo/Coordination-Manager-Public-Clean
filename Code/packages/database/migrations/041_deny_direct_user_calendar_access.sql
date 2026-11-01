-- 041: Keep profile privilege fields and hash-link calendar data behind the API.
-- The API authenticates profile edits and verifies hash-link calendar access,
-- then uses supabaseAdmin. The service role bypasses RLS.

DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;
DROP POLICY IF EXISTS "Service role can insert profiles" ON public.users;
DROP POLICY IF EXISTS "Deny direct client writes to user profiles" ON public.users;
CREATE POLICY "Deny direct client writes to user profiles" ON public.users
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL PRIVILEGES ON TABLE public.users FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.users TO service_role;

DROP POLICY IF EXISTS "Availability is viewable for accessible calendars" ON public.availability;
DROP POLICY IF EXISTS "Users can insert availability" ON public.availability;
DROP POLICY IF EXISTS "Users can update availability" ON public.availability;
DROP POLICY IF EXISTS "Users can delete availability" ON public.availability;
DROP POLICY IF EXISTS "Deny direct client access to availability" ON public.availability;
CREATE POLICY "Deny direct client access to availability" ON public.availability
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL PRIVILEGES ON TABLE public.availability FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.availability TO service_role;

DROP POLICY IF EXISTS "Meetings viewable for calendar members" ON public.meetings;
DROP POLICY IF EXISTS "Authenticated users can create meetings" ON public.meetings;
DROP POLICY IF EXISTS "Users can update meetings" ON public.meetings;
DROP POLICY IF EXISTS "Users can delete meetings" ON public.meetings;
DROP POLICY IF EXISTS "Deny direct client access to meetings" ON public.meetings;
CREATE POLICY "Deny direct client access to meetings" ON public.meetings
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL PRIVILEGES ON TABLE public.meetings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.meetings TO service_role;

DO $$
DECLARE
  table_name TEXT;
  column_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['users', 'availability', 'meetings'] LOOP
    FOR column_name IN
      SELECT attname
      FROM pg_attribute
      WHERE attrelid = format('public.%I', table_name)::regclass
        AND attnum > 0
        AND NOT attisdropped
    LOOP
      EXECUTE format(
        'REVOKE SELECT (%1$I), INSERT (%1$I), UPDATE (%1$I), REFERENCES (%1$I) ON TABLE public.%2$I FROM PUBLIC, anon, authenticated',
        column_name, table_name
      );
    END LOOP;
  END LOOP;
END
$$;

GRANT SELECT ON TABLE public.users TO authenticated;
