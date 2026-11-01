-- Migration 036: Track sender-initiated deletion of posted Discord announcement messages
--
-- A sender can delete the Discord channel posts and DMs that an announcement
-- already delivered. The API (service role) records the outcome per delivery
-- log row: deleted_at when the Discord message is gone (or was already gone),
-- delete_error when the bot could not delete it. Email deliveries cannot be
-- recalled and are never marked.
--
-- RLS: no change. The existing "Users view own delivery logs" SELECT policy
-- covers the new columns; writes go through the backend service role only
-- (there is no INSERT/UPDATE/DELETE policy for authenticated users).

ALTER TABLE announcement_delivery_log
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE announcement_delivery_log
  ADD COLUMN IF NOT EXISTS delete_error TEXT;

COMMENT ON COLUMN announcement_delivery_log.deleted_at IS
  'When the sender deleted the posted Discord message (NULL = still posted or never posted)';

COMMENT ON COLUMN announcement_delivery_log.delete_error IS
  'Last error from a sender-initiated Discord message deletion attempt (NULL = none)';
