-- Consolidated feature migration file: feature-time-and-calendar
-- Generated from incremental files for easier agent navigation.
-- Keep statements idempotent when adding future changes.

-- ============================================================
-- BEGIN SOURCE: 008_meeting_recurrence.sql
-- ============================================================
-- ============================================================
-- Migration 008: Add recurrence support to meetings table
-- ============================================================
-- Adds a JSONB column to store recurrence settings for meetings.
-- The recurrence_rule field stores:
--   {
--     "type": "weekly" | "biweekly" | "monthly" | "custom",
--     "interval": 1,           // custom: repeat every N units
--     "unit": "week",          // custom: day | week | month
--     "weekDays": [0,1,...6],  // custom: week days (0=Mon...6=Sun)
--     "endType": "never" | "on" | "after",
--     "endDate": "YYYY-MM-DD", // when endType = "on"
--     "endCount": 13           // when endType = "after"
--   }
-- A NULL value means the meeting is a one-off (not recurring).

ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS recurrence_rule JSONB DEFAULT NULL;

COMMENT ON COLUMN public.meetings.recurrence_rule IS
  'Recurrence settings for the meeting. NULL = one-off. '
  'Supported types: weekly, biweekly, monthly, custom. '
  'See migration 008 for full schema.';


-- END SOURCE: 008_meeting_recurrence.sql

-- ============================================================
-- BEGIN SOURCE: 013_event_calendar.sql
-- ============================================================
-- ============================================================
-- 013: Event Calendar — user event items & public event publication
-- ============================================================

-- Each row represents a single event the user has imported or created
-- in their "Your Event Calendar" page.
CREATE TABLE IF NOT EXISTS public.user_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Where the event came from
  source_type TEXT NOT NULL CHECK (source_type IN ('manual', 'google_oauth', 'google_public_url', 'coordination_calendar')),
  -- For imported events: the calendar_source id or coordination calendar hash
  source_id TEXT,
  -- Original external event UID (for de-duplication on re-import)
  external_event_id TEXT,

  -- Core event data
  title TEXT NOT NULL,
  description TEXT,
  meeting_link TEXT,
  location TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  recurrence_rule JSONB DEFAULT NULL,

  -- Publication flag — when true the event appears in the public Events Calendar
  is_public BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_events_user_id ON public.user_events(user_id);
CREATE INDEX IF NOT EXISTS idx_user_events_user_start ON public.user_events(user_id, start_time);
CREATE INDEX IF NOT EXISTS idx_user_events_public ON public.user_events(is_public) WHERE is_public = TRUE;
CREATE INDEX IF NOT EXISTS idx_user_events_source ON public.user_events(user_id, source_type, source_id);
-- De-duplication index: one external event per user per source
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_events_external
  ON public.user_events(user_id, source_type, source_id, external_event_id)
  WHERE external_event_id IS NOT NULL;

-- PostgREST/Supabase upsert cannot target the partial index above through
-- on_conflict=user_id,source_type,source_id,external_event_id. Keep a
-- non-partial unique index for API upserts; Postgres still allows multiple
-- rows where nullable columns are NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_events_external_upsert
  ON public.user_events(user_id, source_type, source_id, external_event_id);

-- RLS
ALTER TABLE public.user_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_events' AND policyname = 'Users can manage own events') THEN
    CREATE POLICY "Users can manage own events"
      ON public.user_events FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  -- Anyone can read public events (for the Events Calendar page)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_events' AND policyname = 'Public events are viewable') THEN
    CREATE POLICY "Public events are viewable"
      ON public.user_events FOR SELECT
      USING (is_public = TRUE);
  END IF;
END $$;

COMMENT ON TABLE public.user_events IS 'User-curated event items that can be published to the global Events Calendar';


-- END SOURCE: 013_event_calendar.sql

-- ============================================================
-- BEGIN SOURCE: 014_calendar_subscriptions.sql
-- ============================================================
-- ============================================================
-- 014: Calendar Subscriptions — follow/unfollow Coordination Calendars
-- ============================================================

-- Tracks which logged-in users are subscribed (following) a Coordination Calendar.
-- Subscribing causes that calendar's meetings to appear in the user's
-- "Your Event Calendar" page automatically.

CREATE TABLE IF NOT EXISTS public.calendar_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  calendar_id UUID NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Each user can only subscribe once per calendar
  UNIQUE(user_id, calendar_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_subs_user ON public.calendar_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_subs_calendar ON public.calendar_subscriptions(calendar_id);

-- RLS
ALTER TABLE public.calendar_subscriptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'calendar_subscriptions' AND policyname = 'Users can manage own subscriptions') THEN
    CREATE POLICY "Users can manage own subscriptions"
      ON public.calendar_subscriptions FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

COMMENT ON TABLE public.calendar_subscriptions IS 'Tracks which users follow (subscribe to) Coordination Calendars to see their meetings in Your Event Calendar';


-- END SOURCE: 014_calendar_subscriptions.sql

-- ============================================================
-- BEGIN SOURCE: 024_availability_user_id.sql
-- ============================================================
-- Add user_id to availability so we can track which account submitted each entry.
-- Nullable because guests (not logged in) can also submit availability.
ALTER TABLE public.availability
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Index for efficient lookup of all availability by a specific user
CREATE INDEX IF NOT EXISTS idx_availability_user_id ON public.availability(user_id)
  WHERE user_id IS NOT NULL;


-- END SOURCE: 024_availability_user_id.sql

-- ============================================================
-- BEGIN SOURCE: 051_dm_calendar_subscriptions.sql
-- ============================================================
-- ============================================================
-- Subscription-based DM model: per-calendar subscriptions
-- ============================================================

-- 1. Add calendar_id to dm_opt_ins for per-calendar subscriptions
ALTER TABLE dm_opt_ins ADD COLUMN IF NOT EXISTS calendar_id UUID;

-- Drop old unique index and create new one including calendar_id
DROP INDEX IF EXISTS idx_dm_opt_ins_unique;
CREATE UNIQUE INDEX idx_dm_opt_ins_unique
  ON dm_opt_ins(
    recipient_discord_id,
    COALESCE(sender_user_id, '00000000-0000-0000-0000-000000000000'),
    COALESCE(calendar_id, '00000000-0000-0000-0000-000000000000')
  );

-- 2. Add calendar_id to announcement_schedules so bot knows the initiative
ALTER TABLE announcement_schedules ADD COLUMN IF NOT EXISTS calendar_id UUID;

-- 3. Track per-calendar first-contact invites (first DM per calendar per recipient)
--    This ensures only the initial "subscribe?" DM goes unsolicited;
--    follow-ups require an active subscription.
CREATE TABLE IF NOT EXISTS dm_calendar_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  recipient_discord_id TEXT NOT NULL,
  calendar_id UUID NOT NULL,
  sender_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  invited_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dm_calendar_invites_unique
  ON dm_calendar_invites(recipient_discord_id, calendar_id);

CREATE INDEX IF NOT EXISTS idx_dm_calendar_invites_recipient
  ON dm_calendar_invites(recipient_discord_id);

ALTER TABLE dm_calendar_invites ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE dm_calendar_invites IS 'Tracks first-contact calendar invitations sent via DM so follow-ups require subscription';


-- END SOURCE: 051_dm_calendar_subscriptions.sql

-- ============================================================
-- BEGIN SOURCE: 070_time_management.sql
-- ============================================================
-- ============================================================
-- 070: Time Management page -- user-defined category tags,
--      per-user main calendar preferences, and per-event
--      category assignments.
-- ============================================================

-- ── 1. Categories (user-defined tags, scoped to Time Management) ──

CREATE TABLE IF NOT EXISTS public.time_management_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#2563eb',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tm_categories_user_id
  ON public.time_management_categories(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tm_categories_user_label
  ON public.time_management_categories(user_id, lower(label));

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tm_categories_label_len_chk'
      AND conrelid = 'public.time_management_categories'::regclass
  ) THEN
    ALTER TABLE public.time_management_categories
      ADD CONSTRAINT tm_categories_label_len_chk
      CHECK (char_length(trim(label)) BETWEEN 1 AND 80);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tm_categories_color_hex_chk'
      AND conrelid = 'public.time_management_categories'::regclass
  ) THEN
    ALTER TABLE public.time_management_categories
      ADD CONSTRAINT tm_categories_color_hex_chk
      CHECK (color ~ '^#[0-9A-Fa-f]{6}$');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tm_categories_sort_order_range_chk'
      AND conrelid = 'public.time_management_categories'::regclass
  ) THEN
    ALTER TABLE public.time_management_categories
      ADD CONSTRAINT tm_categories_sort_order_range_chk
      CHECK (sort_order BETWEEN -10000 AND 10000);
  END IF;
END $$;

ALTER TABLE public.time_management_categories ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'time_management_categories'
                   AND policyname = 'Users manage own time-management categories') THEN
    CREATE POLICY "Users manage own time-management categories"
      ON public.time_management_categories FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trigger_tm_categories_updated_at
  ON public.time_management_categories;
CREATE TRIGGER trigger_tm_categories_updated_at
  BEFORE UPDATE ON public.time_management_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.time_management_categories IS
  'User-defined category tags used to colour items on the Time Management page.';

-- ── 2. Per-user Time Management preferences ──
-- Holds the Main calendar colour / label and other future TM-page settings.

CREATE TABLE IF NOT EXISTS public.time_management_prefs (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  main_color TEXT NOT NULL DEFAULT '#2563eb',
  main_label TEXT NOT NULL DEFAULT 'Coordination Manager Main',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tm_prefs_color_hex_chk'
      AND conrelid = 'public.time_management_prefs'::regclass
  ) THEN
    ALTER TABLE public.time_management_prefs
      ADD CONSTRAINT tm_prefs_color_hex_chk
      CHECK (main_color ~ '^#[0-9A-Fa-f]{6}$');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tm_prefs_label_len_chk'
      AND conrelid = 'public.time_management_prefs'::regclass
  ) THEN
    ALTER TABLE public.time_management_prefs
      ADD CONSTRAINT tm_prefs_label_len_chk
      CHECK (char_length(trim(main_label)) BETWEEN 1 AND 80);
  END IF;
END $$;

ALTER TABLE public.time_management_prefs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'time_management_prefs'
                   AND policyname = 'Users manage own time-management prefs') THEN
    CREATE POLICY "Users manage own time-management prefs"
      ON public.time_management_prefs FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trigger_tm_prefs_updated_at
  ON public.time_management_prefs;
CREATE TRIGGER trigger_tm_prefs_updated_at
  BEFORE UPDATE ON public.time_management_prefs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.time_management_prefs IS
  'Per-user settings for the Time Management page (Main calendar colour, etc.).';

-- ── 3. Per-event category assignments ──
-- Stored as a UUID array on user_events for single-trip reads.

ALTER TABLE public.user_events
  ADD COLUMN IF NOT EXISTS category_ids UUID[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_user_events_category_ids
  ON public.user_events USING GIN (category_ids);

COMMENT ON COLUMN public.user_events.category_ids IS
  'Time-Management category tag ids (references time_management_categories.id).';


-- END SOURCE: 070_time_management.sql

-- ============================================================
-- BEGIN SOURCE: 073_time_management_category_font_color.sql
-- ============================================================
-- 073: Add per-category font color for Time Management cards.

ALTER TABLE public.time_management_categories
  ADD COLUMN IF NOT EXISTS font_color TEXT NOT NULL DEFAULT '#ffffff';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tm_categories_font_color_hex_chk'
      AND conrelid = 'public.time_management_categories'::regclass
  ) THEN
    ALTER TABLE public.time_management_categories
      ADD CONSTRAINT tm_categories_font_color_hex_chk
      CHECK (font_color ~ '^#[0-9A-Fa-f]{6}$');
  END IF;
END $$;

COMMENT ON COLUMN public.time_management_categories.font_color IS
  'Text color used for Time Management cards when this category is applied.';


-- END SOURCE: 073_time_management_category_font_color.sql

-- ============================================================
-- BEGIN SOURCE: 074_time_management_category_background_opacity.sql
-- ============================================================
-- 074: Add per-category background opacity for Time Management cards.

ALTER TABLE public.time_management_categories
  ADD COLUMN IF NOT EXISTS background_opacity DOUBLE PRECISION NOT NULL DEFAULT 1;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tm_categories_background_opacity_range_chk'
      AND conrelid = 'public.time_management_categories'::regclass
  ) THEN
    ALTER TABLE public.time_management_categories
      ADD CONSTRAINT tm_categories_background_opacity_range_chk
      CHECK (background_opacity >= 0 AND background_opacity <= 1);
  END IF;
END $$;

COMMENT ON COLUMN public.time_management_categories.background_opacity IS
  'Background opacity used for Time Management cards when this category is applied.';


-- END SOURCE: 074_time_management_category_background_opacity.sql

-- ============================================================
-- BEGIN SOURCE: 074_time_management_modes.sql
-- ============================================================
-- 074: Add persistent Time Management modes and active mode tracking.

CREATE TABLE IF NOT EXISTS public.time_management_modes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  main_color TEXT NOT NULL DEFAULT '#2563eb',
  slot_minutes INTEGER NOT NULL DEFAULT 30,
  sync_calendars JSONB NOT NULL DEFAULT '[]'::jsonb,
  time_backgrounds JSONB NOT NULL DEFAULT '[]'::jsonb,
  collapsed_background_ids TEXT[] NOT NULL DEFAULT '{}',
  quick_templates JSONB NOT NULL DEFAULT '[]'::jsonb,
  show_quick_templates_in_main BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tm_modes_user_id
  ON public.time_management_modes(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tm_modes_user_name
  ON public.time_management_modes(user_id, lower(name));

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tm_modes_name_len_chk'
      AND conrelid = 'public.time_management_modes'::regclass
  ) THEN
    ALTER TABLE public.time_management_modes
      ADD CONSTRAINT tm_modes_name_len_chk
      CHECK (char_length(trim(name)) BETWEEN 1 AND 80);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tm_modes_color_hex_chk'
      AND conrelid = 'public.time_management_modes'::regclass
  ) THEN
    ALTER TABLE public.time_management_modes
      ADD CONSTRAINT tm_modes_color_hex_chk
      CHECK (main_color ~ '^#[0-9A-Fa-f]{6}$');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tm_modes_slot_minutes_chk'
      AND conrelid = 'public.time_management_modes'::regclass
  ) THEN
    ALTER TABLE public.time_management_modes
      ADD CONSTRAINT tm_modes_slot_minutes_chk
      CHECK (slot_minutes IN (15, 30, 60));
  END IF;
END $$;

ALTER TABLE public.time_management_modes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'time_management_modes'
      AND policyname = 'Users manage own time-management modes'
  ) THEN
    CREATE POLICY "Users manage own time-management modes"
      ON public.time_management_modes FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trigger_tm_modes_updated_at
  ON public.time_management_modes;
CREATE TRIGGER trigger_tm_modes_updated_at
  BEFORE UPDATE ON public.time_management_modes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.time_management_modes IS
  'Per-user Time Management modes that store calendar visibility and visual configuration.';

ALTER TABLE public.time_management_prefs
  ADD COLUMN IF NOT EXISTS active_mode_id UUID;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tm_prefs_active_mode_fk'
      AND conrelid = 'public.time_management_prefs'::regclass
  ) THEN
    ALTER TABLE public.time_management_prefs
      ADD CONSTRAINT tm_prefs_active_mode_fk
      FOREIGN KEY (active_mode_id)
      REFERENCES public.time_management_modes(id)
      ON DELETE SET NULL;
  END IF;
END $$;

WITH relevant_users AS (
  SELECT DISTINCT user_id
  FROM public.time_management_prefs
  UNION
  SELECT DISTINCT user_id
  FROM public.time_management_categories
  UNION
  SELECT DISTINCT user_id
  FROM public.user_events
  WHERE source_type = 'manual'
),
missing_users AS (
  SELECT ru.user_id
  FROM relevant_users ru
  LEFT JOIN public.time_management_modes tm
    ON tm.user_id = ru.user_id
  WHERE tm.id IS NULL
),
inserted_modes AS (
  INSERT INTO public.time_management_modes (
    user_id,
    name,
    main_color,
    slot_minutes,
    sync_calendars,
    time_backgrounds,
    collapsed_background_ids,
    quick_templates,
    show_quick_templates_in_main
  )
  SELECT
    mu.user_id,
    CASE
      WHEN tmp.main_label IS NULL OR btrim(tmp.main_label) = '' OR tmp.main_label = 'Coordination Manager Main' THEN 'Main'
      ELSE tmp.main_label
    END,
    COALESCE(tmp.main_color, '#2563eb'),
    30,
    '[]'::jsonb,
    '[]'::jsonb,
    '{}'::text[],
    '[]'::jsonb,
    TRUE
  FROM missing_users mu
  LEFT JOIN public.time_management_prefs tmp
    ON tmp.user_id = mu.user_id
  RETURNING id, user_id
)
UPDATE public.user_events ue
SET source_id = im.id::text,
    updated_at = NOW()
FROM inserted_modes im
WHERE ue.user_id = im.user_id
  AND ue.source_type = 'manual'
  AND (ue.source_id IS NULL OR btrim(ue.source_id) = '');

WITH fallback_modes AS (
  SELECT DISTINCT ON (tm.user_id) tm.user_id, tm.id
  FROM public.time_management_modes tm
  ORDER BY tm.user_id, tm.created_at ASC
)
INSERT INTO public.time_management_prefs (user_id, active_mode_id, updated_at)
SELECT fm.user_id, fm.id, NOW()
FROM fallback_modes fm
ON CONFLICT (user_id)
DO UPDATE SET active_mode_id = COALESCE(public.time_management_prefs.active_mode_id, EXCLUDED.active_mode_id),
              updated_at = NOW();

-- END SOURCE: 074_time_management_modes.sql

-- ============================================================
-- BEGIN SOURCE: 075_time_management_categories_mode_scope.sql
-- ============================================================
-- 075: Scope time-management categories per mode.

ALTER TABLE public.time_management_categories
  ADD COLUMN IF NOT EXISTS mode_id UUID;

WITH fallback_modes AS (
  SELECT DISTINCT ON (tm.user_id) tm.user_id, tm.id
  FROM public.time_management_modes tm
  ORDER BY tm.user_id, tm.created_at ASC
),
resolved_mode AS (
  SELECT
    c.id AS category_id,
    COALESCE(tmp.active_mode_id, fm.id) AS resolved_mode_id
  FROM public.time_management_categories c
  LEFT JOIN public.time_management_prefs tmp
    ON tmp.user_id = c.user_id
  LEFT JOIN fallback_modes fm
    ON fm.user_id = c.user_id
  WHERE c.mode_id IS NULL
)
UPDATE public.time_management_categories c
SET mode_id = rm.resolved_mode_id
FROM resolved_mode rm
WHERE c.id = rm.category_id
  AND rm.resolved_mode_id IS NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tm_categories_mode_fk'
      AND conrelid = 'public.time_management_categories'::regclass
  ) THEN
    ALTER TABLE public.time_management_categories
      ADD CONSTRAINT tm_categories_mode_fk
      FOREIGN KEY (mode_id)
      REFERENCES public.time_management_modes(id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'time_management_categories'
      AND column_name = 'mode_id'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE public.time_management_categories
      ALTER COLUMN mode_id SET NOT NULL;
  END IF;
END $$;

DROP INDEX IF EXISTS idx_tm_categories_user_label;

CREATE INDEX IF NOT EXISTS idx_tm_categories_user_mode_id
  ON public.time_management_categories(user_id, mode_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tm_categories_user_mode_label
  ON public.time_management_categories(user_id, mode_id, lower(label));

COMMENT ON COLUMN public.time_management_categories.mode_id IS
  'Owning time-management mode. Categories are isolated per mode.';


-- END SOURCE: 075_time_management_categories_mode_scope.sql

-- ============================================================
-- BEGIN SOURCE: 076_time_management_category_color_display_style.sql
-- ============================================================
-- 076: Add category color display style to Time Management prefs and modes.

ALTER TABLE public.time_management_prefs
  ADD COLUMN IF NOT EXISTS category_color_display_style TEXT NOT NULL DEFAULT 'horizontal';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tm_prefs_category_color_display_style_chk'
      AND conrelid = 'public.time_management_prefs'::regclass
  ) THEN
    ALTER TABLE public.time_management_prefs
      ADD CONSTRAINT tm_prefs_category_color_display_style_chk
      CHECK (category_color_display_style IN ('horizontal', 'vertical_left', 'vertical_right'));
  END IF;
END $$;

COMMENT ON COLUMN public.time_management_prefs.category_color_display_style IS
  'Controls whether category colors fill cards horizontally or render as a vertical left/right accent.';

ALTER TABLE public.time_management_modes
  ADD COLUMN IF NOT EXISTS category_color_display_style TEXT NOT NULL DEFAULT 'horizontal';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tm_modes_category_color_display_style_chk'
      AND conrelid = 'public.time_management_modes'::regclass
  ) THEN
    ALTER TABLE public.time_management_modes
      ADD CONSTRAINT tm_modes_category_color_display_style_chk
      CHECK (category_color_display_style IN ('horizontal', 'vertical_left', 'vertical_right'));
  END IF;
END $$;

COMMENT ON COLUMN public.time_management_modes.category_color_display_style IS
  'Controls whether category colors fill mode cards horizontally or render as a vertical left/right accent.';

-- END SOURCE: 076_time_management_category_color_display_style.sql

-- ============================================================
-- BEGIN SOURCE: 077_time_management_category_item_opacity.sql
-- ============================================================
-- 077: Add per-category item opacity for Time Management cards.

ALTER TABLE public.time_management_categories
  ADD COLUMN IF NOT EXISTS item_opacity DOUBLE PRECISION NOT NULL DEFAULT 1;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tm_categories_item_opacity_range_chk'
      AND conrelid = 'public.time_management_categories'::regclass
  ) THEN
    ALTER TABLE public.time_management_categories
      ADD CONSTRAINT tm_categories_item_opacity_range_chk
      CHECK (item_opacity >= 0 AND item_opacity <= 1);
  END IF;
END $$;

COMMENT ON COLUMN public.time_management_categories.item_opacity IS
  'Item-level opacity applied to Time Management cards when this category is assigned. When multiple categories are on an item, the lowest opacity is used.';


-- END SOURCE: 077_time_management_category_item_opacity.sql

-- BEGIN SOURCE: 032_google_event_links.sql
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

-- END SOURCE: 032_google_event_links.sql

-- BEGIN SOURCE: 034_time_item_conditional_recurrence.sql
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
-- END SOURCE: 034_time_item_conditional_recurrence.sql

-- BEGIN SOURCE: 035_time_item_completion.sql
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
-- END SOURCE: 035_time_item_completion.sql

-- BEGIN SOURCE: 039_calendar_change_notifications.sql
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
-- END SOURCE: 039_calendar_change_notifications.sql
