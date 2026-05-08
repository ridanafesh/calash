-- =============================================================================
-- Migration 011 — Add updated_at to game_rooms
-- =============================================================================
--
-- The original 002_game_schema.sql created game_rooms WITHOUT an updated_at
-- column, but the room repository (RoomRepository.updateStatus) writes
-- `updated_at = NOW()` on every status change (lobby → in_progress,
-- in_progress → finished, etc.). On production Postgres that produced:
--
--   column "updated_at" of relation "game_rooms" does not exist
--
-- which broke room leave (handleRoomLeave → updateStatus(roomId, 'abandoned'))
-- and any flow that flips room status. Local dev had been seeded by an
-- earlier hand-edited schema so the bug only surfaced in production.
--
-- All other gameplay tables (game_round_hands, game_melds, match_history,
-- game_meld_cards via 002, plus everything in 001/003/006) already have
-- updated_at. game_rooms was the lone holdout.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS is a no-op when the column is
-- already there (e.g. fresh databases that were created from the corrected
-- 002 in some future version of this schema). The backfill UPDATE only
-- touches rows where updated_at is NULL, which the new column won't be —
-- but it's cheap and safe to run regardless.

ALTER TABLE game_rooms
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE game_rooms
SET updated_at = COALESCE(updated_at, started_at, created_at, NOW())
WHERE updated_at IS NULL;
