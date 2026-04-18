-- Players
CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(32) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Game rooms
CREATE TABLE IF NOT EXISTS game_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_player_id UUID NOT NULL REFERENCES players(id),
  status VARCHAR(20) NOT NULL DEFAULT 'lobby',
  max_players INT NOT NULL DEFAULT 4,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

-- Room memberships
CREATE TABLE IF NOT EXISTS room_players (
  room_id UUID NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, player_id)
);

-- Game results
CREATE TABLE IF NOT EXISTS game_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES game_rooms(id),
  winner_id UUID NOT NULL REFERENCES players(id),
  final_scores JSONB NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Future: payments table (not active in v1)
-- CREATE TABLE IF NOT EXISTS payments (
--   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--   player_id UUID NOT NULL REFERENCES players(id),
--   provider VARCHAR(20) NOT NULL, -- 'paypal' | 'apple' | 'google'
--   provider_tx_id TEXT NOT NULL,
--   amount_cents INT NOT NULL,
--   currency VARCHAR(3) NOT NULL DEFAULT 'USD',
--   status VARCHAR(20) NOT NULL,
--   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
-- );
