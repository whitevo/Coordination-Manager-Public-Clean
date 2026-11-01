DO $$
DECLARE
  missing TEXT[];
  required_table TEXT;
  required_tables TEXT[] := ARRAY[
    'users', 'calendars', 'availability', 'meetings', 'calendar_sources',
    'mailbox_oauth_transactions', 'ai_prompt_usage', 'event_flags',
    'event_flag_targets', 'public_event_moderation_state', 'event_flag_actions',
    'mail_accounts', 'mail_user_preferences', 'mail_messages', 'mail_contacts',
    'mail_contact_identities', 'mail_action_events', 'mail_drafts',
    'user_events', 'google_event_links', 'time_item_recurrences',
    'calendar_notification_settings', 'calendar_change_events',
    'feedback', 'feedback_responses', 'ai_feedback',
    'guardian_ban_entries', 'guardian_ban_accounts', 'guardian_ban_previews',
    'guardian_ban_removals', 'networks', 'network_mappings', 'network_rules',
    'network_event_assignments', 'agent_api_keys', 'account_merge_tokens',
    'quick_tool_preferences', 'account_deletion_events'
  ];
  required_rls TEXT[] := ARRAY[
    'users', 'mail_accounts', 'mail_user_preferences', 'mail_messages',
    'mail_credentials', 'mail_drafts', 'user_events', 'google_event_links',
    'feedback', 'guardian_ban_entries', 'guardian_ban_accounts',
    'calendar_notification_settings', 'calendar_change_events',
    'account_merge_tokens', 'agent_api_keys'
  ];
  required_function TEXT;
  required_functions TEXT[] := ARRAY[
    'private.current_user_has_role(text)',
    'public.set_first_mail_account_primary()',
    'public.advance_time_item_recurrences(uuid)',
    'public.complete_time_item_recurrence(uuid,uuid)',
    'public.join_event_network(uuid,text,jsonb)',
    'public.cleanup_expired_wallet_challenges()',
    'public.cleanup_expired_travelers()'
  ];
BEGIN
  SELECT array_agg(t.name ORDER BY t.name)
  INTO missing
  FROM unnest(required_tables) AS t(name)
  WHERE to_regclass(format('public.%I', t.name)) IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Missing expected consolidated tables: %', missing;
  END IF;

  FOREACH required_table IN ARRAY required_rls LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = required_table
        AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS is not enabled on public.%', required_table;
    END IF;
  END LOOP;

  FOREACH required_function IN ARRAY required_functions LOOP
    IF to_regprocedure(required_function) IS NULL THEN
      RAISE EXCEPTION 'Missing expected consolidated function: %', required_function;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.mail_user_preferences'::regclass
      AND attname IN (
        'junk_domains', 'non_organizer_senders', 'mailbox_filter_rules',
        'mailbox_notification_rules', 'mailbox_threading_options',
        'mailbox_settings_sections', 'mailbox_notifications_last_checked_at'
      )
    GROUP BY attrelid
    HAVING count(DISTINCT attname) = 7
  ) THEN
    RAISE EXCEPTION 'Mailbox preference additions are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.mail_accounts'::regclass
      AND attname IN (
        'sync_options', 'sync_failure_count', 'sync_retry_after',
        'sync_error_kind', 'is_primary', 'last_sent_at',
        'quick_sync_after', 'quick_sync_max_messages'
      )
    GROUP BY attrelid
    HAVING count(DISTINCT attname) = 8
  ) THEN
    RAISE EXCEPTION 'Mailbox account upgrade additions are incomplete';
  END IF;

  IF to_regclass('public.idx_mail_messages_account_archived_received') IS NULL
     OR to_regclass('public.idx_mail_accounts_one_primary_per_user') IS NULL
     OR to_regclass('public.idx_calendars_archived_at') IS NULL
     OR to_regclass('public.idx_user_events_user_start') IS NULL
     OR to_regclass('public.idx_ai_prompt_usage_user_category_day') IS NULL THEN
    RAISE EXCEPTION 'Expected consolidated indexes are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_trgm' AND n.nspname = 'extensions'
  ) THEN
    RAISE EXCEPTION 'pg_trgm is not installed in extensions';
  END IF;
END
$$;
