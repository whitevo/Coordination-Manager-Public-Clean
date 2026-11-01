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
