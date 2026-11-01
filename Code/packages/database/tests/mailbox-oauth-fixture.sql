-- Use only in a newly created disposable database, never production.
DO $$ BEGIN
  IF current_database() <> 'mailbox_oauth_test' THEN
    RAISE EXCEPTION 'OAuth fixture requires the disposable mailbox_oauth_test database';
  END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.users (id UUID PRIMARY KEY);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
