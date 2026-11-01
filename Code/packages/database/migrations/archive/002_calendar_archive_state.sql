-- Public Coordination Calendar auto-archive state.
--
-- Any-week (general weekday) calendars have no meaningful end date, so their
-- public listing lifetime is driven by activity instead:
--   * listed for 14 days after creation
--   * then listed for 14 days after the last planned meeting
--   * when that window passes with no further meeting, they are archived
--
-- listing_expires_at is the next check date (NULL = never expires, e.g. a
-- calendar with an open-ended recurring meeting).

ALTER TABLE IF EXISTS public.calendars
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS public.calendars
  ADD COLUMN IF NOT EXISTS listing_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_calendars_archived_at
  ON public.calendars(archived_at)
  WHERE archived_at IS NOT NULL;

COMMENT ON COLUMN public.calendars.archived_at IS
  'Set when a public calendar auto-archives (no planned meetings within the listing window). Cleared automatically when a new meeting is planned.';

COMMENT ON COLUMN public.calendars.listing_expires_at IS
  'Next check date for the public listing window. NULL means the calendar does not expire.';
