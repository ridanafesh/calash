-- =============================================================================
-- Migration 010 — Joker assignment + replace-joker action support
-- =============================================================================
--
-- Two changes, both needed before the joker-replacement flow can persist:
--
-- 1. Extend `move_action_type` enum with 'replace_joker'.
--    The socket handler maps action.type → action_type column by replacing
--    hyphens with underscores. Without this enum value the bot circuit
--    breaker (and any legitimate human replace-joker action) would fail
--    with: invalid input value for enum move_action_type: "replace_joker"
--    — exactly the same class of failure that 008 (pending-drawn-decision)
--    and 009 (keep/discard-drawn) had to fix retroactively.
--
-- 2. Add `joker_assignment_json` to `game_melds` so the engine's joker
--    assignment (which rank+suit a joker stands in for) survives reconnects
--    and rounds restored from DB. Without this, a player who reconnects
--    mid-round would see the joker as "unassigned", break replacement
--    validation, and cause inconsistent UI state.
--
-- Both are additive and idempotent.
-- =============================================================================

-- ─── 1. Enum extension ──────────────────────────────────────────────────────

-- Postgres requires ADD VALUE to be its own statement (no transactions).
-- IF NOT EXISTS makes this idempotent in case the migration is replayed.
ALTER TYPE move_action_type ADD VALUE IF NOT EXISTS 'replace_joker';

-- ─── 2. game_melds.joker_assignment_json ────────────────────────────────────

ALTER TABLE game_melds
  ADD COLUMN IF NOT EXISTS joker_assignment_json JSONB;

COMMENT ON COLUMN game_melds.joker_assignment_json IS
  'When this meld currently contains a joker, records the rank/suit the joker '
  'stands in for: { jokerIndex, representsRank, representsSuit }. NULL when no '
  'joker is present. Updated by createMelds, addCardsToMeld, and replaceJokerInMeld.';
