-- Run after the current core/security/mailbox baselines, or after the archived
-- 019 and 029 upgrades when validating an older installation.
-- This script reads system catalogs only and raises an exception on drift.

DO $verification$
DECLARE
  direct_auth_policy_count INTEGER;
  unexpected_policy_count INTEGER;
  duplicate_invite_index_count INTEGER;
BEGIN
  WITH policy_expressions AS (
    SELECT
      policyname,
      regexp_replace(
        COALESCE(qual, '') || ' ' || COALESCE(with_check, ''),
        '\([[:space:]]*SELECT[[:space:]]+auth\.(uid|jwt|role|email)\(\)([[:space:]]+AS[[:space:]]+[a-z_]+)?[[:space:]]*\)',
        '',
        'gi'
      ) AS expression_without_init_plans
    FROM pg_policies
    WHERE schemaname = 'public'
  )
  SELECT COUNT(*)
  INTO direct_auth_policy_count
  FROM policy_expressions
  WHERE expression_without_init_plans ~ 'auth\.(uid|jwt|role|email)\(\)';

  IF direct_auth_policy_count > 0 THEN
    RAISE EXCEPTION '% public policies still evaluate auth helpers per row', direct_auth_policy_count;
  END IF;

  SELECT COUNT(*)
  INTO unexpected_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (
      (tablename = 'users' AND policyname IN (
        'Users can view own profile',
        'Admins can view all profiles'
      ))
      OR (tablename = 'feedback' AND policyname IN (
        'Users view own feedback',
        'Admins view all feedback',
        'Admin users can view all feedback'
      ))
      OR (tablename = 'ai_feedback' AND policyname IN (
        'Users view own ai feedback',
        'Admins view all ai feedback',
        'Oversight view all ai feedback'
      ))
      OR (tablename = 'connection_invites' AND policyname IN (
        'Senders manage own invites',
        'Recipients view own invites'
      ))
      OR (tablename = 'user_events' AND policyname IN (
        'Users can manage own events',
        'Public events are viewable'
      ))
      OR (tablename = 'feedback_responses' AND policyname IN (
        'Admins update feedback responses',
        'Admins delete feedback responses'
      ))
    );

  IF unexpected_policy_count > 0 THEN
    RAISE EXCEPTION '% legacy overlapping policies remain', unexpected_policy_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_events'
      AND policyname = 'Public or owned events are viewable'
      AND cmd = 'SELECT'
      AND roles = ARRAY['public']::name[]
  ) THEN
    RAISE EXCEPTION 'Public event read policy is missing or no longer applies to public';
  END IF;

  IF has_function_privilege('anon', 'private.current_user_has_role(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute private.current_user_has_role(text)';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'private.current_user_has_role(text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated must execute private.current_user_has_role(text) for RLS';
  END IF;

  SELECT COUNT(*)
  INTO duplicate_invite_index_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'dm_calendar_invites'
    AND indexname IN (
      'idx_dm_calendar_invites_recipient',
      'idx_dm_calendar_invites_discord_user'
    );

  IF duplicate_invite_index_count <> 1 THEN
    RAISE EXCEPTION 'Expected one recipient Discord ID index, found %', duplicate_invite_index_count;
  END IF;

  RAISE NOTICE 'RLS performance catalog verification passed';
END
$verification$;