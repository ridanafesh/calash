-- ─── New move action types for the drawn-card decision flow ────────────────
--
-- The pending-drawn-decision feature added two new action types:
--   keep-drawn-card    → game-moves table needs 'keep_drawn_card'
--   discard-drawn-card → game-moves table needs 'discard_drawn_card'
--
-- Without these enum values, persisting either action throws
--   invalid input value for enum move_action_type
-- which causes the bot driver to retry until its circuit breaker trips,
-- hanging the round. This migration extends the move_action_type enum
-- with the missing values.
--
-- ALTER TYPE … ADD VALUE has been transactional since Postgres 12.
-- IF NOT EXISTS makes the migration idempotent.

ALTER TYPE move_action_type ADD VALUE IF NOT EXISTS 'keep_drawn_card';
ALTER TYPE move_action_type ADD VALUE IF NOT EXISTS 'discard_drawn_card';
