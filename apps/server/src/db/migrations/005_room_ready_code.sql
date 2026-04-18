-- Migration 005: invite code and player ready state for lobby management

ALTER TABLE game_rooms
  ADD COLUMN IF NOT EXISTS invite_code CHAR(6);

CREATE UNIQUE INDEX IF NOT EXISTS idx_game_rooms_invite_code
  ON game_rooms (invite_code);

ALTER TABLE game_room_players
  ADD COLUMN IF NOT EXISTS is_ready BOOLEAN NOT NULL DEFAULT FALSE;
