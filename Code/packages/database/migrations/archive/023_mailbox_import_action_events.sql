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