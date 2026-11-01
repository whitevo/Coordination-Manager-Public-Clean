ALTER TABLE public.user_events
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.complete_time_item_recurrence(p_user_id UUID, p_event_id UUID)
RETURNS public.time_item_recurrences LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  series public.time_item_recurrences;
BEGIN
  SELECT r.* INTO series FROM public.time_item_recurrences r
    JOIN public.user_events e ON e.recurrence_id = r.id
    WHERE e.id = p_event_id AND r.user_id = p_user_id AND e.user_id = p_user_id FOR UPDATE OF r;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recurrence not found'; END IF;
  IF series.latest_event_id IS DISTINCT FROM p_event_id THEN
    RAISE EXCEPTION 'Complete recurrence on the latest occurrence';
  END IF;
  UPDATE public.time_item_recurrences SET status = 'completed',
    completed_at = COALESCE(completed_at, clock_timestamp()), updated_at = clock_timestamp()
    WHERE id = series.id RETURNING * INTO series;
  UPDATE public.user_events SET completed_at = COALESCE(completed_at, series.completed_at),
    updated_at = clock_timestamp()
    WHERE id = p_event_id AND user_id = p_user_id AND recurrence_id = series.id;
  RETURN series;
END $$;

REVOKE ALL ON FUNCTION public.complete_time_item_recurrence(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_time_item_recurrence(UUID, UUID) TO service_role;
