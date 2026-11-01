-- Consolidated feature migration file: mailbox
-- Adds normalized mailbox projection tables, search indexes, and RLS policies.
-- Keep statements idempotent when adding future changes.

-- ============================================================
-- Mailbox foundation: accounts, threads, messages, contacts,
-- invitations, rules, cursors, AI artifacts, and audit.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS extensions;
REVOKE CREATE ON SCHEMA extensions FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
-- IF NOT EXISTS does not relocate an extension already installed in public.
ALTER EXTENSION pg_trgm SET SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.mail_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('gmail', 'outlook', 'imap')),
  address TEXT NOT NULL,
  display_name TEXT,
  identity_group TEXT NOT NULL DEFAULT 'personal',
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'syncing', 'error', 'disconnected')),
  credentials_ref TEXT,
  provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  sync_options JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at TIMESTAMPTZ,
  sync_cursor TEXT,
  sync_error TEXT,
  sync_failure_count INTEGER NOT NULL DEFAULT 0,
  sync_retry_after TIMESTAMPTZ,
  sync_error_kind TEXT CHECK (sync_error_kind IS NULL OR sync_error_kind IN ('auth', 'transient')),
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disconnected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.mail_accounts
  ADD COLUMN IF NOT EXISTS sync_options JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.mail_accounts
  ADD COLUMN IF NOT EXISTS sync_failure_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.mail_accounts
  ADD COLUMN IF NOT EXISTS sync_retry_after TIMESTAMPTZ;

ALTER TABLE public.mail_accounts
  ADD COLUMN IF NOT EXISTS sync_error_kind TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mail_accounts_sync_error_kind_check'
  ) THEN
    ALTER TABLE public.mail_accounts
      ADD CONSTRAINT mail_accounts_sync_error_kind_check
      CHECK (sync_error_kind IS NULL OR sync_error_kind IN ('auth', 'transient'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_accounts_user_provider_address
  ON public.mail_accounts(user_id, provider, lower(address));
CREATE INDEX IF NOT EXISTS idx_mail_accounts_user_status
  ON public.mail_accounts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_mail_accounts_user_group
  ON public.mail_accounts(user_id, identity_group);
CREATE INDEX IF NOT EXISTS idx_mail_accounts_autosync_due
  ON public.mail_accounts(status, sync_retry_after)
  WHERE sync_error_kind IS DISTINCT FROM 'auth';

ALTER TABLE public.mail_accounts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mail_accounts'
      AND policyname = 'Users manage own mailbox accounts'
  ) THEN
    CREATE POLICY "Users manage own mailbox accounts"
      ON public.mail_accounts FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trigger_mail_accounts_updated_at
  ON public.mail_accounts;
CREATE TRIGGER trigger_mail_accounts_updated_at
  BEFORE UPDATE ON public.mail_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.mail_user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trusted_html_domains JSONB NOT NULL DEFAULT '[]'::jsonb,
  junk_domains JSONB NOT NULL DEFAULT '[]'::jsonb,
  non_organizer_senders JSONB NOT NULL DEFAULT '[]'::jsonb,
  mailbox_threading_options JSONB NOT NULL DEFAULT '{"sameNameAndDomain": false, "sameNameAndDomainDays": 7, "sameNameWithoutReply": false, "sameNameWithoutReplyDays": 7, "sameNameWithinSevenDays": false, "sameNameWithinDays": 7, "sameDomainWithoutReply": false, "sameDomainWithoutReplyDays": 7, "sameDomainWithinSevenDays": false, "sameDomainWithinDays": 7}'::jsonb,
  mailbox_settings_sections JSONB NOT NULL DEFAULT '{"threadView": true, "inboxDisplay": true, "confirmations": true, "syncDefaults": true, "notifications": true}'::jsonb,
  mailbox_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  mailbox_filter_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mail_user_preferences_user_unique UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_mail_user_preferences_user
  ON public.mail_user_preferences(user_id);

ALTER TABLE public.mail_user_preferences ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mail_user_preferences'
      AND policyname = 'Users manage own mailbox preferences'
  ) THEN
    CREATE POLICY "Users manage own mailbox preferences"
      ON public.mail_user_preferences FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trigger_mail_user_preferences_updated_at
  ON public.mail_user_preferences;
CREATE TRIGGER trigger_mail_user_preferences_updated_at
  BEFORE UPDATE ON public.mail_user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.mail_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.mail_accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('gmail', 'outlook', 'imap')),
  encrypted_payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_credentials_user_account_provider
  ON public.mail_credentials(user_id, account_id, provider);
CREATE INDEX IF NOT EXISTS idx_mail_credentials_account
  ON public.mail_credentials(account_id);

ALTER TABLE public.mail_credentials ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mail_credentials'
      AND policyname = 'Users manage own mailbox credentials'
  ) THEN
    CREATE POLICY "Users manage own mailbox credentials"
      ON public.mail_credentials FOR ALL
      USING (
        auth.uid() = user_id
        AND EXISTS (
          SELECT 1 FROM public.mail_accounts ma
          WHERE ma.id = account_id
            AND ma.user_id = auth.uid()
        )
      )
      WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
          SELECT 1 FROM public.mail_accounts ma
          WHERE ma.id = account_id
            AND ma.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DROP TRIGGER IF EXISTS trigger_mail_credentials_updated_at
  ON public.mail_credentials;
CREATE TRIGGER trigger_mail_credentials_updated_at
  BEFORE UPDATE ON public.mail_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.mail_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.mail_accounts(id) ON DELETE CASCADE,
  provider_folder_id TEXT NOT NULL,
  name TEXT NOT NULL,
  folder_type TEXT,
  hierarchy_path TEXT,
  provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_folders_account_provider_id
  ON public.mail_folders(account_id, provider_folder_id);
CREATE INDEX IF NOT EXISTS idx_mail_folders_account_name
  ON public.mail_folders(account_id, name);

ALTER TABLE public.mail_folders ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mail_folders'
      AND policyname = 'Users manage own mailbox folders'
  ) THEN
    CREATE POLICY "Users manage own mailbox folders"
      ON public.mail_folders FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM public.mail_accounts ma
          WHERE ma.id = account_id
            AND ma.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.mail_accounts ma
          WHERE ma.id = account_id
            AND ma.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DROP TRIGGER IF EXISTS trigger_mail_folders_updated_at
  ON public.mail_folders;
CREATE TRIGGER trigger_mail_folders_updated_at
  BEFORE UPDATE ON public.mail_folders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.mail_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.mail_accounts(id) ON DELETE CASCADE,
  provider_label_id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_labels_account_provider_id
  ON public.mail_labels(account_id, provider_label_id);
CREATE INDEX IF NOT EXISTS idx_mail_labels_account_name
  ON public.mail_labels(account_id, name);

ALTER TABLE public.mail_labels ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mail_labels'
      AND policyname = 'Users manage own mailbox labels'
  ) THEN
    CREATE POLICY "Users manage own mailbox labels"
      ON public.mail_labels FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM public.mail_accounts ma
          WHERE ma.id = account_id
            AND ma.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.mail_accounts ma
          WHERE ma.id = account_id
            AND ma.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DROP TRIGGER IF EXISTS trigger_mail_labels_updated_at
  ON public.mail_labels;
CREATE TRIGGER trigger_mail_labels_updated_at
  BEFORE UPDATE ON public.mail_labels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.mail_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.mail_accounts(id) ON DELETE CASCADE,
  provider_thread_id TEXT NOT NULL,
  app_thread_key TEXT,
  normalized_subject TEXT,
  participants JSONB NOT NULL DEFAULT '[]'::jsonb,
  latest_message_at TIMESTAMPTZ,
  message_count INTEGER NOT NULL DEFAULT 0,
  provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_threads_account_provider_thread
  ON public.mail_threads(account_id, provider_thread_id);
CREATE INDEX IF NOT EXISTS idx_mail_threads_account_latest
  ON public.mail_threads(account_id, latest_message_at DESC);

ALTER TABLE public.mail_threads ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mail_threads'
      AND policyname = 'Users manage own mailbox threads'
  ) THEN
    CREATE POLICY "Users manage own mailbox threads"
      ON public.mail_threads FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM public.mail_accounts ma
          WHERE ma.id = account_id
            AND ma.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.mail_accounts ma
          WHERE ma.id = account_id
            AND ma.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DROP TRIGGER IF EXISTS trigger_mail_threads_updated_at
  ON public.mail_threads;
CREATE TRIGGER trigger_mail_threads_updated_at
  BEFORE UPDATE ON public.mail_threads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.mail_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.mail_accounts(id) ON DELETE CASCADE,
  thread_id UUID REFERENCES public.mail_threads(id) ON DELETE SET NULL,
  provider_message_id TEXT NOT NULL,
  rfc_message_id TEXT,
  in_reply_to TEXT,
  references_header TEXT,
  subject TEXT,
  normalized_subject TEXT,
  from_email TEXT,
  from_name TEXT,
  to_emails TEXT,
  cc_emails TEXT,
  bcc_emails TEXT,
  received_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  preview TEXT,
  body_text TEXT,
  body_html_sanitized TEXT,
  -- Raw VCALENDAR/ICS text (Gmail text/calendar MIME part or a downloaded .ics
  -- attachment), used only by invitation parsing, never rendered to the user.
  calendar_raw_text TEXT,
  attachment_names TEXT,
  has_attachments BOOLEAN NOT NULL DEFAULT FALSE,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  is_starred BOOLEAN NOT NULL DEFAULT FALSE,
  is_flagged BOOLEAN NOT NULL DEFAULT FALSE,
  provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  search_text TEXT GENERATED ALWAYS AS (
    coalesce(subject, '') || ' ' ||
    coalesce(from_email, '') || ' ' ||
    coalesce(to_emails, '') || ' ' ||
    coalesce(cc_emails, '') || ' ' ||
    coalesce(body_text, '') || ' ' ||
    coalesce(attachment_names, '')
  ) STORED,
  search_tsv tsvector GENERATED ALWAYS AS (
    to_tsvector(
      'simple',
      coalesce(subject, '') || ' ' ||
      coalesce(from_email, '') || ' ' ||
      coalesce(to_emails, '') || ' ' ||
      coalesce(cc_emails, '') || ' ' ||
      coalesce(body_text, '') || ' ' ||
      coalesce(attachment_names, '')
    )
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_messages_account_provider_message
  ON public.mail_messages(account_id, provider_message_id);
CREATE INDEX IF NOT EXISTS idx_mail_messages_account_received
  ON public.mail_messages(account_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_messages_account_received_covering
  ON public.mail_messages(account_id, received_at DESC)
  INCLUDE (thread_id, is_archived);
CREATE INDEX IF NOT EXISTS idx_mail_messages_thread
  ON public.mail_messages(thread_id, received_at ASC);
CREATE INDEX IF NOT EXISTS idx_mail_messages_search_tsv
  ON public.mail_messages USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS idx_mail_messages_search_trgm
  ON public.mail_messages USING GIN (search_text extensions.gin_trgm_ops);

ALTER TABLE public.mail_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mail_messages'
      AND policyname = 'Users manage own mailbox messages'
  ) THEN
    CREATE POLICY "Users manage own mailbox messages"
      ON public.mail_messages FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM public.mail_accounts ma
          WHERE ma.id = account_id
            AND ma.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.mail_accounts ma
          WHERE ma.id = account_id
            AND ma.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DROP TRIGGER IF EXISTS trigger_mail_messages_updated_at
  ON public.mail_messages;
CREATE TRIGGER trigger_mail_messages_updated_at
  BEFORE UPDATE ON public.mail_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.mail_message_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.mail_messages(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('from', 'to', 'cc', 'bcc', 'reply_to')),
  email TEXT NOT NULL,
  display_name TEXT,
  normalized_identity TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mail_message_participants_message
  ON public.mail_message_participants(message_id);
CREATE INDEX IF NOT EXISTS idx_mail_message_participants_email
  ON public.mail_message_participants(lower(email));

ALTER TABLE public.mail_message_participants ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mail_message_participants'
      AND policyname = 'Users manage own mailbox participants'
  ) THEN
    CREATE POLICY "Users manage own mailbox participants"
      ON public.mail_message_participants FOR ALL
      USING (
        EXISTS (
          SELECT 1
          FROM public.mail_messages mm
          JOIN public.mail_accounts ma ON ma.id = mm.account_id
          WHERE mm.id = message_id
            AND ma.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.mail_messages mm
          JOIN public.mail_accounts ma ON ma.id = mm.account_id
          WHERE mm.id = message_id
            AND ma.user_id = auth.uid()
        )
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.mail_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.mail_messages(id) ON DELETE CASCADE,
  provider_attachment_id TEXT,
  filename TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  storage_path TEXT,
  content_hash TEXT,
  provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mail_attachments_message
  ON public.mail_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_mail_attachments_hash
  ON public.mail_attachments(content_hash);

ALTER TABLE public.mail_attachments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mail_attachments'
      AND policyname = 'Users manage own mailbox attachments'
  ) THEN
    CREATE POLICY "Users manage own mailbox attachments"
      ON public.mail_attachments FOR ALL
      USING (
        EXISTS (
          SELECT 1
          FROM public.mail_messages mm
          JOIN public.mail_accounts ma ON ma.id = mm.account_id
          WHERE mm.id = message_id
            AND ma.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.mail_messages mm
          JOIN public.mail_accounts ma ON ma.id = mm.account_id
          WHERE mm.id = message_id
            AND ma.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DROP TRIGGER IF EXISTS trigger_mail_attachments_updated_at
  ON public.mail_attachments;
CREATE TRIGGER trigger_mail_attachments_updated_at
  BEFORE UPDATE ON public.mail_attachments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.mail_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  notes TEXT,
  last_interaction_at TIMESTAMPTZ,
  interaction_count INTEGER NOT NULL DEFAULT 0,
  source_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mail_contacts_user_name
  ON public.mail_contacts(user_id, lower(display_name));
CREATE INDEX IF NOT EXISTS idx_mail_contacts_user_last_interaction
  ON public.mail_contacts(user_id, last_interaction_at DESC);

ALTER TABLE public.mail_contacts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mail_contacts'
      AND policyname = 'Users manage own mailbox contacts'
  ) THEN
    CREATE POLICY "Users manage own mailbox contacts"
      ON public.mail_contacts FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trigger_mail_contacts_updated_at
  ON public.mail_contacts;
CREATE TRIGGER trigger_mail_contacts_updated_at
  BEFORE UPDATE ON public.mail_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.mail_contact_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES public.mail_contacts(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  provider_source TEXT,
  confidence NUMERIC(4,3),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  is_user_override BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_contact_identities_contact_email
  ON public.mail_contact_identities(contact_id, lower(email));
CREATE INDEX IF NOT EXISTS idx_mail_contact_identities_email
  ON public.mail_contact_identities(lower(email));

ALTER TABLE public.mail_contact_identities ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mail_contact_identities'
      AND policyname = 'Users manage own mailbox contact identities'
  ) THEN
    CREATE POLICY "Users manage own mailbox contact identities"
      ON public.mail_contact_identities FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM public.mail_contacts mc
          WHERE mc.id = contact_id
            AND mc.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.mail_contacts mc
          WHERE mc.id = contact_id
            AND mc.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DROP TRIGGER IF EXISTS trigger_mail_contact_identities_updated_at
  ON public.mail_contact_identities;
CREATE TRIGGER trigger_mail_contact_identities_updated_at
  BEFORE UPDATE ON public.mail_contact_identities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.mail_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_id UUID REFERENCES public.mail_messages(id) ON DELETE SET NULL,
  method TEXT,
  uid TEXT NOT NULL,
  sequence INTEGER,
  recurrence_id TEXT,
  organizer TEXT,
  attendee_emails TEXT,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  summary TEXT,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'tentative', 'accepted', 'declined', 'cancelled', 'imported')),
  provider_event_ref TEXT,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_invitations_user_uid_recurrence
  ON public.mail_invitations(user_id, uid, coalesce(recurrence_id, ''));
CREATE INDEX IF NOT EXISTS idx_mail_invitations_user_starts
  ON public.mail_invitations(user_id, starts_at DESC);

ALTER TABLE public.mail_invitations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mail_invitations'
      AND policyname = 'Users manage own mailbox invitations'
  ) THEN
    CREATE POLICY "Users manage own mailbox invitations"
      ON public.mail_invitations FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trigger_mail_invitations_updated_at
  ON public.mail_invitations;
CREATE TRIGGER trigger_mail_invitations_updated_at
  BEFORE UPDATE ON public.mail_invitations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.mail_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.mail_accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
  actions JSONB NOT NULL DEFAULT '{}'::jsonb,
  priority INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'active' CHECK (mode IN ('active', 'dry_run', 'disabled')),
  stop_processing BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mail_rules_user_priority
  ON public.mail_rules(user_id, priority DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_rules_account
  ON public.mail_rules(account_id);

ALTER TABLE public.mail_rules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mail_rules'
      AND policyname = 'Users manage own mailbox rules'
  ) THEN
    CREATE POLICY "Users manage own mailbox rules"
      ON public.mail_rules FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (
        auth.uid() = user_id
        AND (
          account_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.mail_accounts ma
            WHERE ma.id = account_id
              AND ma.user_id = auth.uid()
          )
        )
      );
  END IF;
END $$;

DROP TRIGGER IF EXISTS trigger_mail_rules_updated_at
  ON public.mail_rules;
CREATE TRIGGER trigger_mail_rules_updated_at
  BEFORE UPDATE ON public.mail_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tracks who/what applied an action to a message (manual click or a rule) so
-- "Receive action" trigger steps can tell manual from automation-caused
-- actions apart, and a rule cannot re-trigger itself in the same cascade chain.
CREATE TABLE IF NOT EXISTS public.mail_action_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.mail_accounts(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES public.mail_messages(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN (
    'trash', 'junk', 'archive', 'unarchive', 'mark_read', 'mark_unread', 'add_tag', 'remove_tag',
    'agent_prompt', 'import_junk', 'import_trash', 'import_archived'
  )),
  action_value TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('manual', 'rule', 'import')),
  source_rule_id UUID REFERENCES public.mail_rules(id) ON DELETE SET NULL,
  chain_id UUID NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mail_action_events_message
  ON public.mail_action_events(message_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_action_events_chain
  ON public.mail_action_events(chain_id, source_rule_id);
CREATE INDEX IF NOT EXISTS idx_mail_action_events_user
  ON public.mail_action_events(user_id, created_at DESC);

ALTER TABLE public.mail_action_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mail_action_events'
      AND policyname = 'Users manage own mailbox action events'
  ) THEN
    CREATE POLICY "Users manage own mailbox action events"
      ON public.mail_action_events FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Locally composed drafts (reply, forward, or new message). A draft stays in
-- this table until it is sent through the owning account's provider.
CREATE TABLE IF NOT EXISTS public.mail_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.mail_accounts(id) ON DELETE CASCADE,
  thread_id UUID REFERENCES public.mail_threads(id) ON DELETE SET NULL,
  in_reply_to_message_id UUID REFERENCES public.mail_messages(id) ON DELETE SET NULL,
  mode TEXT NOT NULL DEFAULT 'reply' CHECK (mode IN ('reply', 'forward', 'new')),
  from_address TEXT NOT NULL,
  to_emails TEXT,
  cc_emails TEXT,
  bcc_emails TEXT,
  subject TEXT,
  body_text TEXT,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent')),
  sent_at TIMESTAMPTZ,
  provider_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.mail_drafts IS 'Platform-held email drafts awaiting send through the owning mail account provider';

CREATE INDEX IF NOT EXISTS idx_mail_drafts_user
  ON public.mail_drafts(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_drafts_account
  ON public.mail_drafts(account_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_drafts_thread
  ON public.mail_drafts(thread_id, updated_at DESC);

ALTER TABLE public.mail_drafts
  ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.mail_drafts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mail_drafts'
      AND policyname = 'Users manage own mailbox drafts'
  ) THEN
    CREATE POLICY "Users manage own mailbox drafts"
      ON public.mail_drafts FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trigger_mail_drafts_updated_at
  ON public.mail_drafts;
CREATE TRIGGER trigger_mail_drafts_updated_at
  BEFORE UPDATE ON public.mail_drafts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.mail_sync_cursors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.mail_accounts(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL,
  cursor TEXT,
  last_successful_sync_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_sync_cursors_account_resource
  ON public.mail_sync_cursors(account_id, resource_type);

ALTER TABLE public.mail_sync_cursors ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mail_sync_cursors'
      AND policyname = 'Users manage own mailbox cursors'
  ) THEN
    CREATE POLICY "Users manage own mailbox cursors"
      ON public.mail_sync_cursors FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM public.mail_accounts ma
          WHERE ma.id = account_id
            AND ma.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.mail_accounts ma
          WHERE ma.id = account_id
            AND ma.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DROP TRIGGER IF EXISTS trigger_mail_sync_cursors_updated_at
  ON public.mail_sync_cursors;
CREATE TRIGGER trigger_mail_sync_cursors_updated_at
  BEFORE UPDATE ON public.mail_sync_cursors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.mail_ai_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.mail_accounts(id) ON DELETE CASCADE,
  message_id UUID REFERENCES public.mail_messages(id) ON DELETE CASCADE,
  thread_id UUID REFERENCES public.mail_threads(id) ON DELETE CASCADE,
  model_name TEXT NOT NULL,
  task_type TEXT NOT NULL,
  prompt_version TEXT,
  output JSONB NOT NULL,
  confidence NUMERIC(5,4),
  was_actioned BOOLEAN NOT NULL DEFAULT FALSE,
  user_correction JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mail_ai_artifacts_user_task
  ON public.mail_ai_artifacts(user_id, task_type, created_at DESC);

ALTER TABLE public.mail_ai_artifacts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mail_ai_artifacts'
      AND policyname = 'Users manage own mailbox ai artifacts'
  ) THEN
    CREATE POLICY "Users manage own mailbox ai artifacts"
      ON public.mail_ai_artifacts FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (
        auth.uid() = user_id
        AND (
          account_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.mail_accounts ma
            WHERE ma.id = account_id
              AND ma.user_id = auth.uid()
          )
        )
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.mail_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.mail_accounts(id) ON DELETE SET NULL,
  actor TEXT NOT NULL,
  operation TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  outcome TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mail_audit_events_user_created
  ON public.mail_audit_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_audit_events_account_created
  ON public.mail_audit_events(account_id, created_at DESC);

ALTER TABLE public.mail_audit_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mail_audit_events'
      AND policyname = 'Users view own mailbox audit events'
  ) THEN
    CREATE POLICY "Users view own mailbox audit events"
      ON public.mail_audit_events FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- BEGIN SOURCE: 006_mailbox_contact_details.sql
-- Adds richer identity fields to mailbox contacts so a person can be recognised
-- by more than an email address: labels, region, and timezone on the contact,
-- plus a per-identity label (e.g. "work", "personal") on each linked email.

ALTER TABLE public.mail_contacts
  ADD COLUMN IF NOT EXISTS labels JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS region TEXT,
  ADD COLUMN IF NOT EXISTS timezone TEXT;

ALTER TABLE public.mail_contact_identities
  ADD COLUMN IF NOT EXISTS label TEXT;

CREATE INDEX IF NOT EXISTS idx_mail_contacts_labels
  ON public.mail_contacts USING GIN (labels);

COMMENT ON COLUMN public.mail_contacts.labels IS 'User-defined labels for grouping/describing a contact (e.g. "client", "family")';
COMMENT ON COLUMN public.mail_contacts.region IS 'Freeform region/country the contact is associated with';
COMMENT ON COLUMN public.mail_contacts.timezone IS 'IANA timezone the contact is believed to operate in';
COMMENT ON COLUMN public.mail_contact_identities.label IS 'Freeform label for this specific email identity (e.g. "work", "personal")';
-- END SOURCE: 006_mailbox_contact_details.sql

-- BEGIN SOURCE: 007_mailbox_contact_frequency.sql
-- Tracks directional email frequency per contact so the assistant can reason
-- about "you email this person often" vs "they mostly email you" instead of
-- only a single combined interaction_count.

ALTER TABLE public.mail_contacts
  ADD COLUMN IF NOT EXISTS sent_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS received_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_received_at TIMESTAMPTZ;

COMMENT ON COLUMN public.mail_contacts.sent_count IS 'Number of synced messages this account sent to the contact';
COMMENT ON COLUMN public.mail_contacts.received_count IS 'Number of synced messages this account received from the contact';
COMMENT ON COLUMN public.mail_contacts.last_sent_at IS 'Most recent synced message sent to the contact';
COMMENT ON COLUMN public.mail_contacts.last_received_at IS 'Most recent synced message received from the contact';
-- END SOURCE: 007_mailbox_contact_frequency.sql

-- BEGIN SOURCE: 008_mailbox_messages_archived_index.sql
-- Covers GET /api/mailbox/messages's dominant query shape:
-- account_id IN (...) AND is_archived = false ORDER BY received_at DESC.
-- The existing (account_id, received_at DESC) index makes Postgres visit rows
-- across multiple accounts and filter out archived ones after the fact, which
-- degrades badly on larger mailboxes and can trip statement_timeout (57014).

CREATE INDEX IF NOT EXISTS idx_mail_messages_account_archived_received
  ON public.mail_messages(account_id, is_archived, received_at DESC);
-- END SOURCE: 008_mailbox_messages_archived_index.sql

-- BEGIN SOURCE: 011_mailbox_notification_rules.sql
-- Per-user notification rules: which system/custom tags should (or should
-- not) surface the in-app "new mail" badge. Mirrors mailbox_filter_rules'
-- shape (system:*/user:* tag ids) but with a 4-mode notify/mute/always/never
-- vocabulary instead of sort/only/hide, since ordering has no meaning here.

ALTER TABLE public.mail_user_preferences
  ADD COLUMN IF NOT EXISTS mailbox_notifications_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.mail_user_preferences
  ADD COLUMN IF NOT EXISTS mailbox_notification_rules JSONB NOT NULL DEFAULT '{"systemTags":[],"userTags":[]}'::jsonb;
-- END SOURCE: 011_mailbox_notification_rules.sql

-- BEGIN SOURCE: 012_mailbox_notification_check_watermark.sql
-- Watermark for the background "check for new mail" poll (Layout-level, not
-- tied to the Mailbox page being open) so it only re-evaluates messages that
-- changed since the last check instead of rescanning the whole mailbox.

ALTER TABLE public.mail_user_preferences
  ADD COLUMN IF NOT EXISTS mailbox_notifications_last_checked_at TIMESTAMPTZ;
-- END SOURCE: 012_mailbox_notification_check_watermark.sql

-- BEGIN SOURCE: 017_mailbox_primary_accounts.sql
-- Primary mailbox account selection and last-used From account fallback.

ALTER TABLE public.mail_accounts
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.mail_accounts
  ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ;

WITH ranked_accounts AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY user_id
    ORDER BY created_at ASC, id ASC
  ) AS account_rank
  FROM public.mail_accounts
)
UPDATE public.mail_accounts AS account
SET is_primary = ranked_accounts.account_rank = 1
FROM ranked_accounts
WHERE account.id = ranked_accounts.id
  AND NOT EXISTS (
    SELECT 1
    FROM public.mail_accounts AS existing_primary
    WHERE existing_primary.user_id = account.user_id
      AND existing_primary.is_primary
  );

UPDATE public.mail_accounts AS account
SET last_sent_at = latest_draft.sent_at
FROM (
  SELECT account_id, MAX(sent_at) AS sent_at
  FROM public.mail_drafts
  WHERE status = 'sent'
    AND sent_at IS NOT NULL
  GROUP BY account_id
) AS latest_draft
WHERE account.id = latest_draft.account_id
  AND account.last_sent_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_accounts_one_primary_per_user
  ON public.mail_accounts(user_id)
  WHERE is_primary;

CREATE INDEX IF NOT EXISTS idx_mail_accounts_user_last_sent
  ON public.mail_accounts(user_id, last_sent_at DESC NULLS LAST);

CREATE OR REPLACE FUNCTION public.set_first_mail_account_primary()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT NEW.is_primary AND NOT EXISTS (
    SELECT 1
    FROM public.mail_accounts
    WHERE user_id = NEW.user_id
  ) THEN
    NEW.is_primary := TRUE;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_first_mail_account_primary ON public.mail_accounts;
CREATE TRIGGER trigger_first_mail_account_primary
  BEFORE INSERT ON public.mail_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_first_mail_account_primary();
-- END SOURCE: 017_mailbox_primary_accounts.sql

-- BEGIN SOURCE: 018_mailbox_quick_sync_watermark.sql
-- Per-account watermark for efficient new-mail checks.

ALTER TABLE public.mail_accounts
  ADD COLUMN IF NOT EXISTS quick_sync_after TIMESTAMPTZ;

ALTER TABLE public.mail_accounts
  ADD COLUMN IF NOT EXISTS quick_sync_max_messages INTEGER NOT NULL DEFAULT 100;

ALTER TABLE public.mail_accounts
  DROP CONSTRAINT IF EXISTS mail_accounts_quick_sync_max_messages_check;

ALTER TABLE public.mail_accounts
  ADD CONSTRAINT mail_accounts_quick_sync_max_messages_check
  CHECK (quick_sync_max_messages BETWEEN 25 AND 500);

CREATE INDEX IF NOT EXISTS idx_mail_accounts_quick_sync_after
  ON public.mail_accounts(user_id, quick_sync_after);
-- END SOURCE: 018_mailbox_quick_sync_watermark.sql

-- BEGIN SOURCE: 023_mailbox_import_action_events.sql
-- Adds provider-import receive actions without conflating them with manual or
-- automation-caused mailbox actions.

ALTER TABLE public.mail_action_events
  DROP CONSTRAINT IF EXISTS mail_action_events_action_check;

ALTER TABLE public.mail_action_events
  ADD CONSTRAINT mail_action_events_action_check CHECK (action IN (
    'trash', 'junk', 'archive', 'unarchive', 'mark_read', 'mark_unread', 'add_tag', 'remove_tag',
    'agent_prompt', 'import_junk', 'import_trash', 'import_archived'
  ));

ALTER TABLE public.mail_action_events
  DROP CONSTRAINT IF EXISTS mail_action_events_source_type_check;

ALTER TABLE public.mail_action_events
  ADD CONSTRAINT mail_action_events_source_type_check
  CHECK (source_type IN ('manual', 'rule', 'import'));
-- END SOURCE: 023_mailbox_import_action_events.sql
