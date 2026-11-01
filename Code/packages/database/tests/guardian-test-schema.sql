-- Disposable PostgreSQL database only, never a deployed Supabase database.
DO $$ BEGIN
  IF current_database() <> 'guardian_test' THEN
    RAISE EXCEPTION 'Guardian SQL tests require the disposable guardian_test database';
  END IF;
END $$;

CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
CREATE TABLE public.users (id UUID PRIMARY KEY);
CREATE TABLE public.guardian_instance_lock (
  id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, heartbeat_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE public.guardian_message_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  was_flagged BOOLEAN DEFAULT FALSE,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
