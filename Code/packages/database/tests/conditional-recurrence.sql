DO $$ BEGIN
  IF current_database() <> 'conditional_recurrence_test' THEN
    RAISE EXCEPTION 'Requires disposable conditional_recurrence_test database';
  END IF;
END $$;
BEGIN;
DO $$
DECLARE
  owner_id UUID := '10000000-0000-4000-8000-000000000001';
  other_id UUID := '10000000-0000-4000-8000-000000000002';
  original public.user_events;
  completed_history public.user_events;
  latest public.user_events;
  series public.time_item_recurrences;
  base_time TIMESTAMPTZ := date_trunc('minute', NOW()) - INTERVAL '10 days';
  rule JSONB := '{"type":"custom","unit":"day","interval":1,"endType":"whenCompleted"}';
  result INTEGER;
BEGIN
  INSERT INTO auth.users VALUES (owner_id), (other_id);
  INSERT INTO public.user_events(user_id, source_type, source_id, title, description,
    meeting_link, location, start_time, end_time, category_ids, recurrence_rule)
  VALUES (owner_id, 'manual', 'mode', 'Original', 'Notes', 'https://example.com', 'Place',
    base_time, base_time + INTERVAL '45 minutes', ARRAY[gen_random_uuid()], rule)
  RETURNING * INTO original;
  IF original.recurrence_id IS NULL THEN RAISE EXCEPTION 'Missing shared recurrence identity'; END IF;
  BEGIN
    UPDATE public.user_events SET end_time = start_time WHERE id = original.id;
    RAISE EXCEPTION 'Nonpositive occurrence duration allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Conditional recurrence requires a manual item and positive duration' THEN RAISE; END IF;
  END;
  result := public.advance_time_item_recurrences(other_id);
  IF result <> 0 THEN RAISE EXCEPTION 'Cross-tenant generation'; END IF;
  result := public.advance_time_item_recurrences(owner_id);
  IF result <> 1 THEN RAISE EXCEPTION 'Expected one future occurrence, got %', result; END IF;
  SELECT * INTO latest FROM public.user_events WHERE recurrence_id = original.recurrence_id AND id <> original.id;
  IF latest.start_time <= NOW() OR latest.id = original.id OR latest.recurrence_id <> original.recurrence_id
    OR latest.end_time - latest.start_time <> INTERVAL '45 minutes'
    OR latest.title <> original.title OR latest.description <> original.description
    OR latest.category_ids <> original.category_ids OR latest.location <> original.location
    OR latest.meeting_link <> original.meeting_link THEN
    RAISE EXCEPTION 'Occurrence configuration, duration or identity was not preserved';
  END IF;
  IF (SELECT COUNT(*) FROM public.user_events WHERE recurrence_id = original.recurrence_id) <> 2 THEN
    RAISE EXCEPTION 'Missed windows were backfilled';
  END IF;
  IF public.advance_time_item_recurrences(owner_id) <> 0 THEN RAISE EXCEPTION 'Retry created a duplicate'; END IF;
  IF latest.completed_at IS NOT NULL THEN RAISE EXCEPTION 'Generated occurrence inherited completion'; END IF;
  INSERT INTO public.user_events(user_id, source_type, title, start_time, end_time,
    recurrence_id, recurrence_window_start, recurrence_rule, completed_at)
  VALUES (owner_id, 'manual', 'Completed history', base_time - INTERVAL '1 day',
    base_time - INTERVAL '23 hours', original.recurrence_id, base_time - INTERVAL '1 day',
    rule, base_time)
  RETURNING * INTO completed_history;
  BEGIN
    INSERT INTO public.user_events(user_id, source_type, title, start_time, end_time,
      recurrence_id, recurrence_window_start, recurrence_rule)
    VALUES (owner_id, 'manual', 'Duplicate', latest.start_time, latest.end_time,
      original.recurrence_id, latest.recurrence_window_start, rule);
    RAISE EXCEPTION 'Duplicate allowed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.complete_time_item_recurrence(other_id, latest.id);
    RAISE EXCEPTION 'Cross-tenant completion allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Recurrence not found' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.complete_time_item_recurrence(owner_id, original.id);
    RAISE EXCEPTION 'Historical completion allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Complete recurrence on the latest occurrence' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.user_events SET recurrence_rule = rule || '{"interval":2}' WHERE id = original.id;
    RAISE EXCEPTION 'Historical schedule edit allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Change recurrence on the latest active occurrence' THEN RAISE; END IF;
  END;
  series := public.complete_time_item_recurrence(owner_id, latest.id);
  IF series.status <> 'completed' OR series.recurrence_rule <> rule OR series.completed_at IS NULL THEN
    RAISE EXCEPTION 'Completion lost status or schedule';
  END IF;
  SELECT * INTO latest FROM public.user_events WHERE id = latest.id;
  IF latest.completed_at IS DISTINCT FROM series.completed_at THEN
    RAISE EXCEPTION 'Current Time Item was not atomically completed with the recurrence';
  END IF;
  IF (SELECT to_jsonb(e) FROM public.user_events e WHERE id = original.id) <> to_jsonb(original)
    OR (SELECT to_jsonb(e) FROM public.user_events e WHERE id = completed_history.id) <> to_jsonb(completed_history) THEN
    RAISE EXCEPTION 'Completion changed a historical Time Item';
  END IF;
  PERFORM public.complete_time_item_recurrence(owner_id, latest.id);
  IF (SELECT completed_at FROM public.user_events WHERE id = latest.id) IS DISTINCT FROM latest.completed_at
    OR (SELECT completed_at FROM public.time_item_recurrences WHERE id = series.id) IS DISTINCT FROM series.completed_at THEN
    RAISE EXCEPTION 'Retry changed a completion timestamp';
  END IF;
  UPDATE public.user_events SET start_time = base_time + INTERVAL '1 day',
    end_time = base_time + INTERVAL '1 day 45 minutes' WHERE id = latest.id;
  IF public.advance_time_item_recurrences(owner_id) <> 0 THEN RAISE EXCEPTION 'Completed recurrence advanced'; END IF;
  IF (SELECT COUNT(*) FROM public.user_events WHERE recurrence_id = original.recurrence_id) <> 3 THEN
    RAISE EXCEPTION 'Completion deleted history';
  END IF;
  BEGIN
    INSERT INTO public.user_events(user_id, source_type, title, start_time, end_time, recurrence_id)
    VALUES (owner_id, 'manual', 'Late write', NOW(), NOW() + INTERVAL '1 hour', original.recurrence_id);
    RAISE EXCEPTION 'Write after completion allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Recurrence completed' THEN RAISE; END IF;
  END;
  INSERT INTO public.user_events(user_id, source_type, title, start_time, end_time, recurrence_rule)
  VALUES (owner_id, 'manual', 'Still running', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '1 hour', rule);
  IF public.advance_time_item_recurrences(owner_id) <> 0 THEN RAISE EXCEPTION 'Generated before latest end'; END IF;
  INSERT INTO public.user_events(user_id, source_type, title, start_time, end_time, recurrence_rule, completed_at)
  VALUES (owner_id, 'manual', 'Previously completed item', base_time, base_time + INTERVAL '1 hour', rule, base_time)
  RETURNING * INTO original;
  IF public.advance_time_item_recurrences(owner_id) <> 1 THEN RAISE EXCEPTION 'Expected next occurrence'; END IF;
  IF (SELECT e.completed_at FROM public.user_events e JOIN public.time_item_recurrences r ON r.latest_event_id = e.id
      WHERE r.id = original.recurrence_id) IS NOT NULL THEN
    RAISE EXCEPTION 'New occurrence inherited individual completion';
  END IF;
END $$;

DO $$ BEGIN
  IF public.next_conditional_time_item_start('2026-10-08T09:00Z',
    '{"type":"custom","unit":"week","interval":3,"weekDays":[1,3]}', '2026-10-09T00:00Z')
    <> '2026-10-27T09:00Z'::timestamptz THEN RAISE EXCEPTION 'Multi-week anchor shifted'; END IF;
  IF public.next_conditional_time_item_start('2026-01-31T23:30Z',
    '{"type":"monthly"}', '2026-02-01T00:00Z')
    <> '2026-03-31T23:30Z'::timestamptz THEN RAISE EXCEPTION 'Month end cadence changed'; END IF;
  IF public.next_conditional_time_item_start('2026-10-05T09:00Z',
    '{"type":"weekly","exceptions":["2026-10-12"]}', '2026-10-06T00:00Z')
    <> '2026-10-19T09:00Z'::timestamptz THEN RAISE EXCEPTION 'Exception ignored'; END IF;
  IF public.next_conditional_time_item_start('2026-10-05T09:00Z',
    '{"type":"monthlyWeek","monthWeeks":[2,4]}', '2026-10-06T00:00Z')
    <> '2026-10-12T09:00Z'::timestamptz THEN RAISE EXCEPTION 'Month week ignored'; END IF;
  IF public.next_conditional_time_item_start('2026-03-22T09:00Z',
    '{"type":"weekly"}', '2026-03-28T10:00+02:00')
    <> '2026-03-29T09:00Z'::timestamptz THEN RAISE EXCEPTION 'UTC/DST cadence changed'; END IF;
END $$;

SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.advance_time_item_recurrences('10000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'Authenticated client executed service-only generation';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.time_item_recurrences;
    RAISE EXCEPTION 'Authenticated client read private series';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
ROLLBACK;
