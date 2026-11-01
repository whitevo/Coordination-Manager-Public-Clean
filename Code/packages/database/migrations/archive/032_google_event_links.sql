-- Outbound Google Calendar sync for Time Management items (user_events).
--
-- google_event_links remembers which Google event an exported item became, so later
-- edits update that event instead of creating duplicates. keep_in_sync is the per-item
-- "Keep Google copy in sync" toggle. last_pushed_payload is what we last sent, used to
-- detect edits made directly in Google.
--
-- user_events.series_id / original_start_time link a "this item only" replacement to
-- its recurring series and the occurrence it replaced (pushed as a Google instance
-- override).

CREATE TABLE IF NOT EXISTS public.google_event_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  user_event_id UUID NOT NULL REFERENCES public.user_events(id) ON DELETE CASCADE,
  calendar_source_id UUID NOT NULL REFERENCES public.calendar_sources(id) ON DELETE CASCADE,
  google_calendar_id TEXT NOT NULL DEFAULT 'primary',
  google_event_id TEXT NOT NULL,
  html_link TEXT,
  keep_in_sync BOOLEAN NOT NULL DEFAULT FALSE,
  last_pushed_at TIMESTAMPTZ,
  last_pushed_payload JSONB,
  last_push_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_event_id, calendar_source_id)
);

CREATE INDEX IF NOT EXISTS idx_google_event_links_user_id
  ON public.google_event_links(user_id);
CREATE INDEX IF NOT EXISTS idx_google_event_links_user_event_id
  ON public.google_event_links(user_event_id);

ALTER TABLE public.google_event_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_event_links FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_event_links TO service_role;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'google_event_links'
      AND policyname = 'Deny direct client access to google event links'
  ) THEN
    CREATE POLICY "Deny direct client access to google event links"
      ON public.google_event_links FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

ALTER TABLE public.user_events
  ADD COLUMN IF NOT EXISTS series_id UUID REFERENCES public.user_events(id) ON DELETE SET NULL;
ALTER TABLE public.user_events
  ADD COLUMN IF NOT EXISTS original_start_time TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_user_events_series_id
  ON public.user_events(series_id) WHERE series_id IS NOT NULL;
