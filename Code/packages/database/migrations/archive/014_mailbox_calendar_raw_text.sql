-- Store the raw VCALENDAR/ICS text found alongside a message (Gmail text/calendar
-- MIME part, or a downloaded .ics attachment) so invitation parsing can detect
-- formal calendar invites that never appear in body_text/body_html_sanitized.
ALTER TABLE public.mail_messages
  ADD COLUMN IF NOT EXISTS calendar_raw_text TEXT;
