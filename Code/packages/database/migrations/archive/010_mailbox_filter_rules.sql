-- Shared mailbox filter and sorting definitions. The selected primary filter
-- remains device-local so each browser can choose its own default view.

ALTER TABLE public.mail_user_preferences
  ADD COLUMN IF NOT EXISTS mailbox_filter_rules JSONB NOT NULL DEFAULT '[]'::jsonb;