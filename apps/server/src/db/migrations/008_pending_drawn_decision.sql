-- ─── pending-drawn-decision turn phase ─────────────────────────────────────
--
-- The engine added a new turnPhase value 'pending-drawn-decision' so the
-- player must explicitly choose Keep or Discard after drawing from the
-- hidden deck. The DB enum needs to know about it; otherwise persisting a
-- draw-from-deck action fails with:
--
--   invalid input value for enum turn_phase: "pending_drawn_decision"
--
-- which causes the bot driver to retry indefinitely on its turn.
--
-- ALTER TYPE … ADD VALUE is non-transactional in older Postgres but
-- supported standalone since 9.1 / unconditionally since 12. IF NOT EXISTS
-- makes this migration idempotent in case it's run twice.

ALTER TYPE turn_phase ADD VALUE IF NOT EXISTS 'pending_drawn_decision';
