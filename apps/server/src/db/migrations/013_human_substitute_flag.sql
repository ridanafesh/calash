-- =============================================================================
-- Migration 013 — Human-substitute flag on game_room_players
-- =============================================================================
--
-- When a human leaves an active room mid-game, their seat is flipped to
-- a bot but the row keeps the original human's user_id and left_at = NULL
-- so the seat can be reclaimed on rejoin. Until now this was tracked
-- only on the in-memory PlayerSlot.isHumanSubstitute. That was lossy:
--
--   1. Server restart would forget which bot seats were substitutes,
--      and fresh joiners could replace them (stealing the original
--      human's seat).
--
--   2. The lobby's "rooms I can rejoin" listing had no DB-side signal
--      to find rooms where this user has a substituted seat waiting
--      for them.
--
-- Persisting the flag fixes both. Defaults FALSE, NOT NULL so existing
-- rows are safe and queries don't need null-coalescing. Idempotent via
-- ADD COLUMN IF NOT EXISTS.
--
-- The flag is set by the leave-substitute path in room.ts and cleared
-- when the original human reclaims their seat or when a host-created
-- bot is replaced by a fresh human (replaceBotWithHuman).

ALTER TABLE game_room_players
  ADD COLUMN IF NOT EXISTS is_human_substitute BOOLEAN NOT NULL DEFAULT FALSE;
