CREATE TABLE IF NOT EXISTS public.time_item_recurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  recurrence_rule JSONB NOT NULL,
  anchor_start TIMESTAMPTZ NOT NULL,
  latest_event_id UUID REFERENCES public.user_events(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_time_item_recurrences_user
  ON public.time_item_recurrences(user_id);
CREATE INDEX IF NOT EXISTS idx_time_item_recurrences_latest
  ON public.time_item_recurrences(latest_event_id);
ALTER TABLE public.time_item_recurrences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.time_item_recurrences FROM anon, authenticated;
GRANT ALL ON public.time_item_recurrences TO service_role;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
    AND tablename = 'time_item_recurrences' AND policyname = 'Service-only recurrence state') THEN
    CREATE POLICY "Service-only recurrence state" ON public.time_item_recurrences
      FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

ALTER TABLE public.user_events
  ADD COLUMN IF NOT EXISTS recurrence_id UUID REFERENCES public.time_item_recurrences(id),
  ADD COLUMN IF NOT EXISTS recurrence_window_start TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_events_recurrence_window
  ON public.user_events(recurrence_id, recurrence_window_start);

CREATE OR REPLACE FUNCTION public.guard_time_item_recurrence()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  series public.time_item_recurrences;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.recurrence_id IS NOT NULL AND
    (NEW.recurrence_id IS DISTINCT FROM OLD.recurrence_id OR
     NEW.recurrence_window_start IS DISTINCT FROM OLD.recurrence_window_start) THEN
    RAISE EXCEPTION 'Recurrence identity and occurrence window cannot be changed';
  END IF;
  IF NEW.recurrence_id IS NULL AND NEW.recurrence_rule->>'endType' = 'whenCompleted' THEN
    IF NEW.source_type <> 'manual' OR NEW.recurrence_rule->>'type' = 'none'
      OR NEW.end_time <= NEW.start_time THEN
      RAISE EXCEPTION 'Conditional recurrence requires a manual item, schedule and positive duration';
    END IF;
    INSERT INTO public.time_item_recurrences(user_id, recurrence_rule, anchor_start)
      VALUES (NEW.user_id, NEW.recurrence_rule, NEW.start_time) RETURNING * INTO series;
    NEW.recurrence_id := series.id;
    NEW.recurrence_window_start := NEW.start_time;
  ELSIF NEW.recurrence_id IS NOT NULL THEN
    IF NEW.source_type <> 'manual' OR NEW.end_time <= NEW.start_time THEN
      RAISE EXCEPTION 'Conditional recurrence requires a manual item and positive duration';
    END IF;
    SELECT * INTO series FROM public.time_item_recurrences
      WHERE id = NEW.recurrence_id AND user_id = NEW.user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Recurrence not found or unauthorized'; END IF;
    IF TG_OP = 'INSERT' THEN
      IF series.status <> 'active' THEN RAISE EXCEPTION 'Recurrence completed'; END IF;
      NEW.recurrence_rule := series.recurrence_rule;
      NEW.recurrence_window_start := COALESCE(NEW.recurrence_window_start, NEW.start_time);
    ELSIF NEW.recurrence_rule IS DISTINCT FROM OLD.recurrence_rule THEN
      IF series.latest_event_id IS DISTINCT FROM OLD.id OR series.status <> 'active' THEN
        RAISE EXCEPTION 'Change recurrence on the latest active occurrence';
      END IF;
      IF NEW.recurrence_rule->>'endType' IS DISTINCT FROM 'whenCompleted'
        OR NEW.recurrence_rule->>'type' = 'none' THEN
        RAISE EXCEPTION 'Use Complete recurrence to end this series';
      END IF;
      UPDATE public.time_item_recurrences SET recurrence_rule = NEW.recurrence_rule,
        anchor_start = NEW.start_time, updated_at = clock_timestamp() WHERE id = series.id;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_time_item_recurrence ON public.user_events;
CREATE TRIGGER guard_time_item_recurrence BEFORE INSERT OR UPDATE ON public.user_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_time_item_recurrence();

CREATE OR REPLACE FUNCTION public.track_latest_time_item_occurrence()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.recurrence_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.recurrence_id IS NOT NULL THEN
    UPDATE public.time_item_recurrences SET latest_event_id = NEW.id, updated_at = clock_timestamp()
      WHERE id = NEW.recurrence_id AND (latest_event_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.user_events e WHERE e.id = latest_event_id
          AND e.recurrence_window_start > NEW.recurrence_window_start));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS track_latest_time_item_occurrence ON public.user_events;
CREATE TRIGGER track_latest_time_item_occurrence AFTER INSERT OR UPDATE ON public.user_events
  FOR EACH ROW EXECUTE FUNCTION public.track_latest_time_item_occurrence();

-- UTC calendar-day cadence matches the existing Time Management grid. Keep the
-- original anchor (especially for multi-week, multi-weekday schedules).
CREATE OR REPLACE FUNCTION public.next_conditional_time_item_start(
  p_anchor TIMESTAMPTZ, p_rule JSONB, p_after TIMESTAMPTZ
) RETURNS TIMESTAMPTZ LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  base TIMESTAMP := p_anchor AT TIME ZONE 'UTC';
  candidate TIMESTAMP := GREATEST(base::date, (p_after AT TIME ZONE 'UTC')::date) + base::time;
  day_diff INTEGER;
  month_diff INTEGER;
  weekday INTEGER;
  cadence INTEGER := COALESCE((p_rule->>'interval')::integer, 1);
  unit TEXT := COALESCE(p_rule->>'unit', 'week');
  kind TEXT := p_rule->>'type';
  matches BOOLEAN;
  offset_days INTEGER := COALESCE((p_rule->>'weekOffsetDays')::integer, EXTRACT(ISODOW FROM base)::integer - 1);
BEGIN
  IF kind NOT IN ('weekly', 'biweekly', 'monthly', 'monthlyWeek', 'custom') OR cadence < 1 THEN
    RAISE EXCEPTION 'Invalid recurrence schedule';
  END IF;
  FOR i IN 0..7320 LOOP
    day_diff := candidate::date - base::date;
    month_diff := (EXTRACT(YEAR FROM candidate)::integer - EXTRACT(YEAR FROM base)::integer) * 12
      + EXTRACT(MONTH FROM candidate)::integer - EXTRACT(MONTH FROM base)::integer;
    weekday := EXTRACT(ISODOW FROM candidate)::integer - 1;
    matches := CASE kind
      WHEN 'weekly' THEN day_diff % 7 = 0
      WHEN 'biweekly' THEN day_diff % 14 = 0
      WHEN 'monthly' THEN EXTRACT(DAY FROM candidate) = EXTRACT(DAY FROM base)
      WHEN 'monthlyWeek' THEN weekday = EXTRACT(ISODOW FROM base)::integer - 1 AND
        CASE WHEN jsonb_array_length(COALESCE(p_rule->'monthWeeks', '[]')) > 0
          THEN (p_rule->'monthWeeks') @> to_jsonb(ARRAY[((EXTRACT(DAY FROM candidate)::integer - 1) / 7) + 1])
          ELSE (EXTRACT(DAY FROM candidate)::integer - 1) / 7 = (EXTRACT(DAY FROM base)::integer - 1) / 7 END
      WHEN 'custom' THEN CASE unit
        WHEN 'day' THEN day_diff % cadence = 0
        WHEN 'month' THEN month_diff % cadence = 0 AND EXTRACT(DAY FROM candidate) = EXTRACT(DAY FROM base)
        WHEN 'week' THEN ((day_diff + offset_days) / 7) % cadence = 0 AND
          CASE WHEN jsonb_array_length(COALESCE(p_rule->'weekDays', '[]')) > 0
            THEN (p_rule->'weekDays') @> to_jsonb(ARRAY[weekday])
            ELSE weekday = EXTRACT(ISODOW FROM base)::integer - 1 END
        ELSE false END
      ELSE false END;
    IF matches AND candidate AT TIME ZONE 'UTC' > p_after AND
      NOT COALESCE((p_rule->'exceptions') ? to_char(candidate, 'YYYY-MM-DD'), false) THEN
      RETURN candidate AT TIME ZONE 'UTC';
    END IF;
    candidate := candidate + INTERVAL '1 day';
  END LOOP;
  RAISE EXCEPTION 'No recurrence window found within 20 years';
END $$;

CREATE OR REPLACE FUNCTION public.advance_time_item_recurrences(p_user_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  series public.time_item_recurrences;
  latest public.user_events;
  next_start TIMESTAMPTZ;
  check_time TIMESTAMPTZ := clock_timestamp();
  inserted_count INTEGER := 0;
  affected INTEGER;
BEGIN
  FOR series IN SELECT * FROM public.time_item_recurrences
    WHERE user_id = p_user_id AND status = 'active' ORDER BY id FOR UPDATE
  LOOP
    SELECT * INTO latest FROM public.user_events
      WHERE id = series.latest_event_id AND recurrence_id = series.id;
    IF NOT FOUND OR latest.end_time >= check_time THEN CONTINUE; END IF;
    next_start := public.next_conditional_time_item_start(
      series.anchor_start, series.recurrence_rule, GREATEST(check_time, latest.start_time));
    -- The same series lock is held by completion. Recheck at the write boundary.
    INSERT INTO public.user_events(user_id, source_type, source_id, title, description,
      meeting_link, location, start_time, end_time, is_public, category_ids,
      recurrence_rule, recurrence_id, recurrence_window_start)
    SELECT latest.user_id, 'manual', latest.source_id, latest.title, latest.description,
      latest.meeting_link, latest.location, next_start,
      next_start + (latest.end_time - latest.start_time), latest.is_public, latest.category_ids,
      s.recurrence_rule, s.id, next_start
    FROM public.time_item_recurrences s WHERE s.id = series.id AND s.status = 'active'
    ON CONFLICT (recurrence_id, recurrence_window_start) DO NOTHING;
    GET DIAGNOSTICS affected = ROW_COUNT;
    inserted_count := inserted_count + affected;
  END LOOP;
  RETURN inserted_count;
END $$;

CREATE OR REPLACE FUNCTION public.complete_time_item_recurrence(p_user_id UUID, p_event_id UUID)
RETURNS public.time_item_recurrences LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  series public.time_item_recurrences;
BEGIN
  SELECT r.* INTO series FROM public.time_item_recurrences r
    JOIN public.user_events e ON e.recurrence_id = r.id
    WHERE e.id = p_event_id AND r.user_id = p_user_id FOR UPDATE OF r;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recurrence not found'; END IF;
  IF series.latest_event_id IS DISTINCT FROM p_event_id THEN
    RAISE EXCEPTION 'Complete recurrence on the latest occurrence';
  END IF;
  UPDATE public.time_item_recurrences SET status = 'completed',
    completed_at = COALESCE(completed_at, clock_timestamp()), updated_at = clock_timestamp()
    WHERE id = series.id RETURNING * INTO series;
  UPDATE public.user_events SET updated_at = clock_timestamp() WHERE recurrence_id = series.id;
  RETURN series;
END $$;

REVOKE ALL ON FUNCTION public.guard_time_item_recurrence() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.track_latest_time_item_occurrence() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.next_conditional_time_item_start(TIMESTAMPTZ, JSONB, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.advance_time_item_recurrences(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_time_item_recurrence(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_time_item_recurrences(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_time_item_recurrence(UUID, UUID) TO service_role;
