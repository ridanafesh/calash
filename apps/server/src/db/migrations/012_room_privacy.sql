-- =============================================================================
-- Migration 012 — Room privacy (open vs locked) + waiting-seat flag
-- =============================================================================
--
-- Adds two pieces of state needed by the room-types feature:
--
-- 1. game_rooms.is_private (BOOLEAN). When true the room requires the
--    6-character invite code to join. The code itself already exists for
--    every room — this flag just decides whether validation is enforced.
--    Lobby UI shows a lock icon for private rooms but they are still
--    listed publicly (per product spec).
--
-- 2. game_room_players.is_waiting (BOOLEAN). When a fresh joiner takes
--    an empty seat WHILE a round is already in progress, they hold the
--    seat but don't play that round — flag is true until the next round
--    transition clears it. This way a round-end + next-round-start
--    that re-reads from the DB can correctly include them on deal.
--
-- Both columns are NOT NULL with a sensible default, so existing rows
-- are safe and the column is queryable with no application-side null
-- branching.
--
-- ADD COLUMN IF NOT EXISTS makes this idempotent across replays.

ALTER TABLE game_rooms
  ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE game_room_players
  ADD COLUMN IF NOT EXISTS is_waiting BOOLEAN NOT NULL DEFAULT FALSE;
