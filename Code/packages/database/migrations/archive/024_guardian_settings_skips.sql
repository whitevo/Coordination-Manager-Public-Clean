-- Apply before deploying the Guardian bot and API settings-skip changes.
ALTER TABLE public.guardian_message_log
  ADD COLUMN IF NOT EXISTS skip_reason TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.guardian_message_log'::regclass
      AND conname = 'guardian_message_log_skip_reason_check'
  ) THEN
    ALTER TABLE public.guardian_message_log
      ADD CONSTRAINT guardian_message_log_skip_reason_check
      CHECK (
        skip_reason IS NULL OR
        (skip_reason IN ('ignored_role', 'channel_disabled', 'parent_channel_disabled')
          AND was_flagged IS FALSE)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_guardian_log_scanned_not_skipped
  ON public.guardian_message_log(scanned_at DESC)
  WHERE skip_reason IS NULL;
