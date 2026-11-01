-- Disposable PostgreSQL only.
DO $$ BEGIN
  IF current_database() <> 'advisor_test' THEN
    RAISE EXCEPTION 'Advisor tests require the disposable advisor_test database';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role BYPASSRLS;
  END IF;
END $$;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
$$;
CREATE TABLE public.users (id UUID PRIMARY KEY, roles JSONB NOT NULL);
INSERT INTO public.users VALUES
  ('00000000-0000-0000-0000-000000000001', '["user"]'),
  ('00000000-0000-0000-0000-000000000002', '["admin"]'),
  ('00000000-0000-0000-0000-000000000003', '["oversight"]');

CREATE FUNCTION public.current_user_has_role(check_role TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND roles @> to_jsonb(check_role)
  );
$$;
REVOKE ALL ON FUNCTION public.current_user_has_role(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_has_role(TEXT) TO authenticated;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users or admins can view profiles" ON public.users FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR public.current_user_has_role('admin'));
CREATE TABLE public.ai_feedback (user_id UUID, content TEXT);
INSERT INTO public.ai_feedback SELECT id, 'fixture' FROM public.users;
ALTER TABLE public.ai_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users, admins, or oversight view ai feedback" ON public.ai_feedback FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.current_user_has_role('admin')
    OR public.current_user_has_role('oversight')
  );
GRANT SELECT ON public.users, public.ai_feedback TO authenticated;

CREATE TABLE public.feedback (user_id UUID);
CREATE TABLE public.feedback_responses (admin_id UUID, content TEXT);
INSERT INTO public.feedback_responses SELECT id, 'fixture' FROM public.users;
ALTER TABLE public.feedback_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read fixture responses" ON public.feedback_responses FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins update own responses" ON public.feedback_responses FOR UPDATE TO authenticated
  USING (admin_id = (SELECT auth.uid()) AND public.current_user_has_role('admin'))
  WITH CHECK (admin_id = (SELECT auth.uid()) AND public.current_user_has_role('admin'));
CREATE POLICY "Admins delete own responses" ON public.feedback_responses FOR DELETE TO authenticated
  USING (admin_id = (SELECT auth.uid()) AND public.current_user_has_role('admin'));
GRANT SELECT, UPDATE, DELETE ON public.feedback_responses TO authenticated;
CREATE TABLE public.connection_invites (sender_user_id UUID, used_by_user_id UUID);
CREATE TABLE public.user_events (user_id UUID, is_public BOOLEAN);
CREATE TABLE public.dm_calendar_invites (discord_user_id TEXT);
CREATE INDEX idx_dm_calendar_invites_recipient ON public.dm_calendar_invites(discord_user_id);

CREATE TABLE public.mail_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE public.mail_drafts (account_id UUID, sent_at TIMESTAMPTZ, status TEXT);
CREATE TABLE public.mail_messages (search_text TEXT);
CREATE EXTENSION pg_trgm WITH SCHEMA public;
CREATE INDEX idx_mail_messages_search_trgm ON public.mail_messages USING GIN (search_text public.gin_trgm_ops);
CREATE TABLE public.advisor_original_oids AS
  SELECT 'public.current_user_has_role(text)'::regprocedure::OID AS helper_oid,
    'public.idx_mail_messages_search_trgm'::regclass::OID AS index_oid;
