DO $$ BEGIN
  IF current_database() <> 'conditional_recurrence_test' THEN
    RAISE EXCEPTION 'Requires disposable conditional_recurrence_test database';
  END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS dblink;
INSERT INTO auth.users(id) VALUES ('10000000-0000-4000-8000-000000000003');
INSERT INTO public.user_events(user_id, source_type, title, start_time, end_time, recurrence_rule)
VALUES ('10000000-0000-4000-8000-000000000003', 'manual', 'Concurrent series',
  NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days' + INTERVAL '1 hour',
  '{"type":"custom","unit":"day","interval":1,"endType":"whenCompleted"}');

SELECT dblink_connect('generation_a', 'dbname=conditional_recurrence_test user=postgres');
SELECT dblink_connect('generation_b', 'dbname=conditional_recurrence_test user=postgres');
SELECT dblink_exec('generation_a', 'BEGIN');
DO $$
DECLARE result INTEGER;
BEGIN
  SELECT created INTO result FROM dblink('generation_a',
    'SELECT public.advance_time_item_recurrences(''10000000-0000-4000-8000-000000000003'')')
    AS t(created INTEGER);
  IF result <> 1 THEN RAISE EXCEPTION 'First generator did not create an occurrence'; END IF;
  PERFORM dblink_send_query('generation_b',
    'SELECT public.advance_time_item_recurrences(''10000000-0000-4000-8000-000000000003'')');
  PERFORM pg_sleep(0.1);
  IF dblink_is_busy('generation_b') <> 1 THEN RAISE EXCEPTION 'Concurrent generation did not wait on series lock'; END IF;
END $$;
SELECT dblink_exec('generation_a', 'COMMIT');
DO $$
DECLARE result INTEGER;
BEGIN
  SELECT created INTO result FROM dblink_get_result('generation_b') AS t(created INTEGER);
  IF result <> 0 THEN RAISE EXCEPTION 'Concurrent generator created a duplicate'; END IF;
  IF (SELECT COUNT(*) FROM public.user_events
    WHERE user_id = '10000000-0000-4000-8000-000000000003') <> 2 THEN
    RAISE EXCEPTION 'Duplicate occurrence persisted';
  END IF;
END $$;
SELECT * FROM dblink_get_result('generation_b') AS t(created INTEGER);

UPDATE public.user_events SET start_time = NOW() - INTERVAL '2 days',
  end_time = NOW() - INTERVAL '2 days' + INTERVAL '1 hour'
  WHERE id = (SELECT latest_event_id FROM public.time_item_recurrences
    WHERE user_id = '10000000-0000-4000-8000-000000000003');
SELECT dblink_exec('generation_a', 'BEGIN');
DO $$
DECLARE latest_id UUID; result TEXT;
BEGIN
  SELECT latest_event_id INTO latest_id FROM public.time_item_recurrences
    WHERE user_id = '10000000-0000-4000-8000-000000000003';
  SELECT status INTO result FROM dblink('generation_a',
    format('SELECT status FROM public.complete_time_item_recurrence(''10000000-0000-4000-8000-000000000003'', %L)', latest_id))
    AS t(status TEXT);
  IF result <> 'completed' THEN RAISE EXCEPTION 'Completion did not persist'; END IF;
  PERFORM dblink_send_query('generation_b',
    'SELECT public.advance_time_item_recurrences(''10000000-0000-4000-8000-000000000003'')');
  PERFORM pg_sleep(0.1);
  IF dblink_is_busy('generation_b') <> 1 THEN RAISE EXCEPTION 'Generation did not wait for completion'; END IF;
END $$;
SELECT dblink_exec('generation_a', 'COMMIT');
DO $$
DECLARE result INTEGER;
BEGIN
  SELECT created INTO result FROM dblink_get_result('generation_b') AS t(created INTEGER);
  IF result <> 0 THEN RAISE EXCEPTION 'Generation ignored committed completion'; END IF;
  IF (SELECT COUNT(*) FROM public.user_events
    WHERE user_id = '10000000-0000-4000-8000-000000000003') <> 2 THEN
    RAISE EXCEPTION 'Generation added an item after completion';
  END IF;
  IF (SELECT COUNT(*) FROM public.user_events
    WHERE user_id = '10000000-0000-4000-8000-000000000003' AND completed_at IS NOT NULL) <> 1 THEN
    RAISE EXCEPTION 'Concurrent completion did not affect only the latest Time Item';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_events e JOIN public.time_item_recurrences r ON r.latest_event_id = e.id
    WHERE r.user_id = '10000000-0000-4000-8000-000000000003' AND e.completed_at = r.completed_at) THEN
    RAISE EXCEPTION 'Latest item and series completion disagree';
  END IF;
END $$;
SELECT dblink_disconnect('generation_a');
SELECT dblink_disconnect('generation_b');
DELETE FROM auth.users WHERE id = '10000000-0000-4000-8000-000000000003';
