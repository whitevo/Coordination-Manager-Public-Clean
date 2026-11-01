-- Optimize authenticated RLS policies so Supabase auth helpers are evaluated
-- once per statement instead of once per candidate row.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
REVOKE CREATE ON SCHEMA private FROM authenticated;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

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

DO $migration$
DECLARE
  policy_record RECORD;
  optimized_qual TEXT;
  optimized_check TEXT;
  alter_statement TEXT;
BEGIN
  FOR policy_record IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        COALESCE(qual, '') ~ 'auth\.(uid|jwt|role|email)\(\)'
        OR COALESCE(with_check, '') ~ 'auth\.(uid|jwt|role|email)\(\)'
      )
      AND COALESCE(qual, '') !~ '\( SELECT auth\.(uid|jwt|role|email)\(\)'
      AND COALESCE(with_check, '') !~ '\( SELECT auth\.(uid|jwt|role|email)\(\)'
  LOOP
    optimized_qual := policy_record.qual;
    optimized_check := policy_record.with_check;

    IF optimized_qual IS NOT NULL THEN
      optimized_qual := regexp_replace(
        optimized_qual,
        'auth\.(uid|jwt|role|email)\(\)',
        '(SELECT auth.\1())',
        'g'
      );
    END IF;

    IF optimized_check IS NOT NULL THEN
      optimized_check := regexp_replace(
        optimized_check,
        'auth\.(uid|jwt|role|email)\(\)',
        '(SELECT auth.\1())',
        'g'
      );
    END IF;

    alter_statement := format(
      'ALTER POLICY %I ON %I.%I TO authenticated',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );

    IF optimized_qual IS NOT NULL THEN
      alter_statement := alter_statement || format(' USING (%s)', optimized_qual);
    END IF;

    IF optimized_check IS NOT NULL THEN
      alter_statement := alter_statement || format(' WITH CHECK (%s)', optimized_check);
    END IF;

    EXECUTE alter_statement;
  END LOOP;
END
$migration$;

-- Consolidate SELECT policies that grant overlapping access. PostgreSQL ORs
-- permissive policies, so each replacement keeps the same combined predicate.

DROP POLICY IF EXISTS "Users can view own profile" ON public.users;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.users;
DROP POLICY IF EXISTS "Users or admins can view profiles" ON public.users;
CREATE POLICY "Users or admins can view profiles" ON public.users
  FOR SELECT TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR private.current_user_has_role('admin')
  );

DROP POLICY IF EXISTS "Users view own feedback" ON public.feedback;
DROP POLICY IF EXISTS "Admins view all feedback" ON public.feedback;
DROP POLICY IF EXISTS "Admin users can view all feedback" ON public.feedback;
DROP POLICY IF EXISTS "Users or admins view feedback" ON public.feedback;
CREATE POLICY "Users or admins view feedback" ON public.feedback
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR private.current_user_has_role('admin')
  );

DROP POLICY IF EXISTS "Users view own ai feedback" ON public.ai_feedback;
DROP POLICY IF EXISTS "Admins view all ai feedback" ON public.ai_feedback;
DROP POLICY IF EXISTS "Oversight view all ai feedback" ON public.ai_feedback;
DROP POLICY IF EXISTS "Users, admins, or oversight view ai feedback" ON public.ai_feedback;
CREATE POLICY "Users, admins, or oversight view ai feedback" ON public.ai_feedback
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR private.current_user_has_role('admin')
    OR private.current_user_has_role('oversight')
  );

DROP POLICY IF EXISTS "Senders manage own invites" ON public.connection_invites;
DROP POLICY IF EXISTS "Recipients view own invites" ON public.connection_invites;
DROP POLICY IF EXISTS "Participants view own invites" ON public.connection_invites;
DROP POLICY IF EXISTS "Senders insert own invites" ON public.connection_invites;
DROP POLICY IF EXISTS "Senders update own invites" ON public.connection_invites;
DROP POLICY IF EXISTS "Senders delete own invites" ON public.connection_invites;
CREATE POLICY "Participants view own invites" ON public.connection_invites
  FOR SELECT TO authenticated
  USING (
    sender_user_id = (SELECT auth.uid())
    OR used_by_user_id = (SELECT auth.uid())
  );
CREATE POLICY "Senders insert own invites" ON public.connection_invites
  FOR INSERT TO authenticated
  WITH CHECK (sender_user_id = (SELECT auth.uid()));
CREATE POLICY "Senders update own invites" ON public.connection_invites
  FOR UPDATE TO authenticated
  USING (sender_user_id = (SELECT auth.uid()))
  WITH CHECK (sender_user_id = (SELECT auth.uid()));
CREATE POLICY "Senders delete own invites" ON public.connection_invites
  FOR DELETE TO authenticated
  USING (sender_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can manage own events" ON public.user_events;
DROP POLICY IF EXISTS "Public events are viewable" ON public.user_events;
DROP POLICY IF EXISTS "Public or owned events are viewable" ON public.user_events;
DROP POLICY IF EXISTS "Users can insert own events" ON public.user_events;
DROP POLICY IF EXISTS "Users can update own events" ON public.user_events;
DROP POLICY IF EXISTS "Users can delete own events" ON public.user_events;
CREATE POLICY "Public or owned events are viewable" ON public.user_events
  FOR SELECT TO public
  USING (
    is_public = TRUE
    OR user_id = (SELECT auth.uid())
  );
CREATE POLICY "Users can insert own events" ON public.user_events
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can update own events" ON public.user_events
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can delete own events" ON public.user_events
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Remove both historical generations before installing one policy per command.
DROP POLICY IF EXISTS "Admins update feedback responses" ON public.feedback_responses;
DROP POLICY IF EXISTS "Admins update own responses" ON public.feedback_responses;
DROP POLICY IF EXISTS "Admins delete feedback responses" ON public.feedback_responses;
DROP POLICY IF EXISTS "Admins delete own responses" ON public.feedback_responses;
CREATE POLICY "Admins update own responses" ON public.feedback_responses
  FOR UPDATE TO authenticated
  USING (
    admin_id = (SELECT auth.uid())
    AND private.current_user_has_role('admin')
  )
  WITH CHECK (
    admin_id = (SELECT auth.uid())
    AND private.current_user_has_role('admin')
  );
CREATE POLICY "Admins delete own responses" ON public.feedback_responses
  FOR DELETE TO authenticated
  USING (
    admin_id = (SELECT auth.uid())
    AND private.current_user_has_role('admin')
  );

DROP INDEX IF EXISTS public.idx_dm_calendar_invites_discord_user;