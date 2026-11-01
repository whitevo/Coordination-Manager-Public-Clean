-- Match the authenticated event list's user filter and start-time ordering.
CREATE INDEX IF NOT EXISTS idx_user_events_user_start
  ON public.user_events(user_id, start_time);
