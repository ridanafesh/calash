-- ─── Bot players ──────────────────────────────────────────────────────────────
--
-- Bots are first-class users so all existing FK relationships (game_room_players,
-- game_rounds.dealer_user_id, game_moves.user_id, game_meld_cards.added_by_user_id,
-- game_scores.user_id, leaderboard_entries.user_id) work unchanged.  The only
-- distinction is the is_bot flag, which we use to:
--   - skip leaderboard tracking for bots
--   - exclude bots from public leaderboard listings
--   - render bots differently in the UI
--   - skip JWT issuance / authentication for bot rows
--
-- Bot rows are created lazily per room (one row per bot per game). They have
-- no email, no auth_accounts entry, and no leaderboard_entries row.
--
-- The associated player_profiles row carries the public display name
-- (e.g., "Easy Bot 1").

ALTER TABLE users
  ADD COLUMN is_bot BOOLEAN NOT NULL DEFAULT false;

-- Partial index: most queries filter is_bot = false implicitly via leaderboard
-- joins, but explicit "real users only" lookups benefit from this.
CREATE INDEX idx_users_is_bot ON users (is_bot) WHERE is_bot = true;
