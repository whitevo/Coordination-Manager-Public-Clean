-- Add global Mailbox Thread View conditions to existing installations.

ALTER TABLE public.mail_user_preferences
  ADD COLUMN IF NOT EXISTS mailbox_threading_options JSONB NOT NULL
  DEFAULT '{"sameNameAndDomain": false, "sameNameAndDomainDays": 7, "sameNameWithoutReply": false, "sameNameWithoutReplyDays": 7, "sameNameWithinSevenDays": false, "sameNameWithinDays": 7, "sameDomainWithoutReply": false, "sameDomainWithoutReplyDays": 7, "sameDomainWithinSevenDays": false, "sameDomainWithinDays": 7}'::jsonb;

ALTER TABLE public.mail_user_preferences
  ADD COLUMN IF NOT EXISTS mailbox_settings_sections JSONB NOT NULL
  DEFAULT '{"threadView": true, "inboxDisplay": true, "confirmations": true, "syncDefaults": true, "notifications": true}'::jsonb;
