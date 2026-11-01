BEGIN;

-- Organiser email notification settings per Coordination Calendar.
-- Kept out of calendars.config because config is publicly readable by anyone
-- with the calendar hash, and the notification email is private.
-- A missing row means defaults: enabled, account email, no notify_from.
CREATE TABLE IF NOT EXISTS public.calendar_notification_settings (
  calendar_id UUID PRIMARY KEY REFERENCES public.calendars(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  email TEXT CHECK (email IS NULL OR char_length(email) <= 320),
  notify_from TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Queue of participation changes waiting to be aggregated into one email per
-- recipient. Rows are claimed by setting sent_at, and released on failure.
CREATE TABLE IF NOT EXISTS public.calendar_change_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id UUID NOT NULL REFERENCES public.calendars(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL CHECK (char_length(recipient_email) <= 320),
  participant_name TEXT NOT NULL CHECK (char_length(participant_name) <= 200),
  change_type TEXT NOT NULL CHECK (change_type IN ('added', 'changed', 'removed')),
  existed_before BOOLEAN NOT NULL,
  exists_after BOOLEAN NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('urgent', 'normal')),
  earliest_slot_at TIMESTAMPTZ,
  due_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendar_change_events_pending
  ON public.calendar_change_events(recipient_email, due_at)
  WHERE sent_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_calendar_change_events_calendar_id
  ON public.calendar_change_events(calendar_id);

-- Service-role only: the API reads and writes through supabaseAdmin.
ALTER TABLE public.calendar_notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_change_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'calendar_notification_settings' AND policyname = 'Deny all calendar_notification_settings') THEN
    CREATE POLICY "Deny all calendar_notification_settings" ON public.calendar_notification_settings FOR ALL USING (false) WITH CHECK (false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'calendar_change_events' AND policyname = 'Deny all calendar_change_events') THEN
    CREATE POLICY "Deny all calendar_change_events" ON public.calendar_change_events FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

COMMIT;
