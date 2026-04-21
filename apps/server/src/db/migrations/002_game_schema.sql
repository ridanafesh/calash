-- =============================================================================
-- Migration 002 — Full game schema: rooms, rounds, hands, melds, scores
-- =============================================================================
--
-- Design decisions:
--
--   game_rooms    is the long-lived container for a full game session (multiple
--                 rounds until someone reaches WIN_SCORE = 1000).
--
--   game_rounds   is the most important table for resumability.  It stores:
--                 • The dealer and counterclockwise turn order (JSONB array
--                   of user_ids)
--                 • The full hidden deck as a JSONB Card[] array — this is the
--                   single source of truth for the server; clients never see
--                   individual deck cards, only the count
--                 • The full discard pile as a JSONB Card[] array (index 0 =
--                   oldest/bottom card)
--                 • Current turn player and sub-phase
--                 • The did_take_from_discard flag (resets each turn)
--                 • The highest exposed table total (used for go-down threshold)
--
--   game_round_hands  stores each player's current hand and go-down state.
--                 Updated on every action that changes hand contents.  The
--                 previous hand states are recoverable from game_moves.
--
--   game_round_discards  is append-only history of every individual discard
--                 action.  It enables analytics ("most-discarded card") and
--                 complements game_moves for replay without requiring a full
--                 move-by-move scan.
--
--   game_moves    is an immutable append-only log.  Every player action is
--                 recorded with the full action payload (JSONB), the hand
--                 before, and the hand after.  This is sufficient to replay
--                 any round from scratch.
--
--   game_melds + game_meld_cards use a two-layer approach:
--                 game_melds  tracks meld identity and a denormalized
--                             cards_json snapshot for O(1) reads
--                 game_meld_cards  normalizes individual cards with position
--                                 and the user who added each card (important
--                                 because players can add to other players'
--                                 melds once going down)
--
--   game_scores   is written once per player per round on round end.  It
--                 carries a cumulative_score_after column so any round
--                 record is self-sufficient for displaying a score timeline.
--
--   leaderboard_entries  is a denormalized summary table updated at game end
--                 (or batch-updated periodically).  Kept separate so leaderboard
--                 reads never touch the large game_* tables.
--
--   match_history  summarises completed game_rooms for quick "recent games"
--                 queries without joining through multiple large tables.
--
-- Card JSON shape (matches @calash/shared Card type):
--   Regular: { rank, suit, isJoker: false, deckIndex: 0|1 }
--   Joker:   { rank: "JOKER", suit: null, isJoker: true, jokerIndex: 0|1 }
-- =============================================================================

-- ─── game_rooms ──────────────────────────────────────────────────────────────

CREATE TYPE room_status AS ENUM ('lobby', 'in_progress', 'finished', 'abandoned');

CREATE TABLE game_rooms (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  host_user_id     UUID         NOT NULL REFERENCES users (id),
  status           room_status  NOT NULL DEFAULT 'lobby',
  max_players      SMALLINT     NOT NULL DEFAULT 4
                                CHECK (max_players BETWEEN 2 AND 4),
  -- Serialised game settings (reserved for future configurable rules)
  settings_json    JSONB        NOT NULL DEFAULT '{}',
  winner_user_id   UUID         REFERENCES users (id),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ
);

CREATE INDEX idx_game_rooms_host        ON game_rooms (host_user_id);
CREATE INDEX idx_game_rooms_status      ON game_rooms (status);
CREATE INDEX idx_game_rooms_winner      ON game_rooms (winner_user_id) WHERE winner_user_id IS NOT NULL;

-- ─── game_room_players ───────────────────────────────────────────────────────

CREATE TABLE game_room_players (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         UUID         NOT NULL REFERENCES game_rooms (id) ON DELETE CASCADE,
  user_id         UUID         NOT NULL REFERENCES users (id),
  -- seat_index determines the fixed counterclockwise seat position (0 = first seat).
  -- The actual turn order per round rotates based on who the dealer is.
  seat_index      SMALLINT     NOT NULL CHECK (seat_index BETWEEN 0 AND 3),
  joined_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  left_at         TIMESTAMPTZ,
  -- Final cumulative score at game end (null until game is finished)
  final_score     INT,

  CONSTRAINT uq_room_players_room_user  UNIQUE (room_id, user_id),
  CONSTRAINT uq_room_players_room_seat  UNIQUE (room_id, seat_index)
);

CREATE INDEX idx_grp_room_id   ON game_room_players (room_id);
CREATE INDEX idx_grp_user_id   ON game_room_players (user_id);

-- ─── game_rounds ─────────────────────────────────────────────────────────────

CREATE TYPE round_status AS ENUM ('dealing', 'in_progress', 'scoring', 'finished');
CREATE TYPE turn_phase   AS ENUM ('awaiting_draw_or_take', 'holding', 'complete');
CREATE TYPE round_end_reason AS ENUM ('player_finished', 'deck_exhausted');

CREATE TABLE game_rounds (
  id                           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id                      UUID          NOT NULL REFERENCES game_rooms (id) ON DELETE CASCADE,
  round_number                 SMALLINT      NOT NULL CHECK (round_number >= 1),

  -- ── Dealer & order ──────────────────────────────────────────────────────
  dealer_user_id               UUID          NOT NULL REFERENCES users (id),
  -- Ordered array of user_id strings, counterclockwise.
  -- Index 0 = player to dealer's right (first to act, receives 15 cards).
  turn_order_json              JSONB         NOT NULL DEFAULT '[]',

  -- ── Current turn state ───────────────────────────────────────────────────
  status                       round_status  NOT NULL DEFAULT 'dealing',
  current_turn_user_id         UUID          REFERENCES users (id),
  turn_phase                   turn_phase    NOT NULL DEFAULT 'awaiting_draw_or_take',
  -- Reset to false at the start of each new player's turn.
  did_take_from_discard        BOOLEAN       NOT NULL DEFAULT FALSE,

  -- ── Deck & pile state ────────────────────────────────────────────────────
  -- Full Card[] array — never sent to clients; only the count is exposed.
  hidden_deck_json             JSONB         NOT NULL DEFAULT '[]',
  -- Card[] array, oldest card at index 0.  Updated on every discard/take action.
  discard_pile_json            JSONB         NOT NULL DEFAULT '[]',

  -- ── Go-down tracking ─────────────────────────────────────────────────────
  -- Tracks the highest exposed table total (sum of all melds) across all
  -- players who have gone down.  Used to compute the next player's threshold.
  highest_table_total          INT           NOT NULL DEFAULT 0,

  -- ── Round result ─────────────────────────────────────────────────────────
  end_reason                   round_end_reason,
  -- The player who emptied their hand (null when deck ran out)
  finisher_user_id             UUID          REFERENCES users (id),

  created_at                   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  started_at                   TIMESTAMPTZ,
  finished_at                  TIMESTAMPTZ,

  CONSTRAINT uq_rounds_room_number UNIQUE (room_id, round_number)
);

CREATE INDEX idx_rounds_room_id        ON game_rounds (room_id);
CREATE INDEX idx_rounds_room_status    ON game_rounds (room_id, status);
CREATE INDEX idx_rounds_current_turn   ON game_rounds (current_turn_user_id) WHERE status = 'in_progress';

-- ─── game_round_hands ────────────────────────────────────────────────────────

CREATE TABLE game_round_hands (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id       UUID         NOT NULL REFERENCES game_rounds (id) ON DELETE CASCADE,
  user_id        UUID         NOT NULL REFERENCES users (id),
  -- Current cards in hand as a Card[] array
  cards_json     JSONB        NOT NULL DEFAULT '[]',
  -- True once the player has placed their initial melds on the table
  has_gone_down  BOOLEAN      NOT NULL DEFAULT FALSE,
  -- Sum of all meld values on the table for this player.
  -- Updated whenever the player places or extends a meld.
  table_total    INT          NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_round_hands_round_user UNIQUE (round_id, user_id)
);

CREATE INDEX idx_round_hands_round_id ON game_round_hands (round_id);
CREATE INDEX idx_round_hands_user_id  ON game_round_hands (user_id);

-- ─── game_round_discards ─────────────────────────────────────────────────────
-- Append-only record of every discard action for analytics and replay.
-- The current pile state is on game_rounds.discard_pile_json.

CREATE TABLE game_round_discards (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id         UUID        NOT NULL REFERENCES game_rounds (id) ON DELETE CASCADE,
  user_id          UUID        NOT NULL REFERENCES users (id),
  move_number      INT         NOT NULL,
  -- The single Card object that was discarded
  card_json        JSONB       NOT NULL,
  -- Full pile snapshot after this discard (for point-in-time replay)
  pile_after_json  JSONB       NOT NULL DEFAULT '[]',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_discards_round_id   ON game_round_discards (round_id);
CREATE INDEX idx_discards_move_order ON game_round_discards (round_id, move_number);

-- ─── game_moves ──────────────────────────────────────────────────────────────
-- Immutable audit log of every player action.  Never updated after insert.
-- Combined with the initial deal state, this enables complete replay.

CREATE TYPE move_action_type AS ENUM (
  'draw_from_deck',
  'take_from_discard',
  'go_down',
  'add_to_meld',
  'add_new_meld',
  'discard'
);

CREATE TABLE game_moves (
  id              UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id        UUID             NOT NULL REFERENCES game_rounds (id) ON DELETE CASCADE,
  user_id         UUID             NOT NULL REFERENCES users (id),
  -- Sequential within a round; used to reconstruct order
  move_number     INT              NOT NULL,
  action_type     move_action_type NOT NULL,
  -- Full TurnAction payload serialised to JSON
  action_json     JSONB            NOT NULL,
  -- Hand snapshot before and after — sufficient to replay the action
  hand_before_json JSONB           NOT NULL DEFAULT '[]',
  hand_after_json  JSONB           NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ      NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_moves_round_number UNIQUE (round_id, move_number)
);

CREATE INDEX idx_moves_round_id    ON game_moves (round_id);
CREATE INDEX idx_moves_round_order ON game_moves (round_id, move_number);
CREATE INDEX idx_moves_user_id     ON game_moves (user_id);

-- ─── game_melds ──────────────────────────────────────────────────────────────

CREATE TYPE meld_type AS ENUM ('sequence', 'set');

CREATE TABLE game_melds (
  id            UUID       PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id      UUID       NOT NULL REFERENCES game_rounds (id) ON DELETE CASCADE,
  -- The player who originally placed this meld (went down with it)
  owner_user_id UUID       NOT NULL REFERENCES users (id),
  meld_type     meld_type  NOT NULL,
  -- Denormalised snapshot of the current meld cards (Card[] array).
  -- Kept in sync with game_meld_cards for fast reads; game_meld_cards is
  -- the normalised source of truth for history queries.
  cards_json    JSONB      NOT NULL DEFAULT '[]',
  total_value   INT        NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_melds_round_id  ON game_melds (round_id);
CREATE INDEX idx_melds_owner     ON game_melds (owner_user_id);

-- ─── game_meld_cards ─────────────────────────────────────────────────────────
-- Normalised per-card records.  Tracks which user added each card and when,
-- enabling "who contributed what value" analytics.

CREATE TABLE game_meld_cards (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meld_id          UUID        NOT NULL REFERENCES game_melds (id) ON DELETE CASCADE,
  -- Denormalised for query convenience
  round_id         UUID        NOT NULL REFERENCES game_rounds (id) ON DELETE CASCADE,
  -- Position within the meld (0-indexed, preserved for sequence ordering)
  position         SMALLINT    NOT NULL,
  -- Card fields matching the @calash/shared Card type
  card_rank        VARCHAR(5)  NOT NULL,          -- '2'..'A' or 'JOKER'
  card_suit        VARCHAR(8),                     -- null for jokers
  is_joker         BOOLEAN     NOT NULL DEFAULT FALSE,
  deck_index       SMALLINT,                       -- 0 or 1 for regular cards
  joker_index      SMALLINT,                       -- 0 or 1 for jokers
  -- The player who added this card (may differ from meld owner)
  added_by_user_id UUID        NOT NULL REFERENCES users (id),
  added_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_meld_cards_meld_id  ON game_meld_cards (meld_id);
CREATE INDEX idx_meld_cards_round_id ON game_meld_cards (round_id);

-- ─── game_scores ─────────────────────────────────────────────────────────────
-- Written once per (round, player) at round end.  Never updated.

CREATE TABLE game_scores (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id               UUID        NOT NULL REFERENCES game_rounds (id) ON DELETE CASCADE,
  room_id                UUID        NOT NULL REFERENCES game_rooms  (id) ON DELETE CASCADE,
  user_id                UUID        NOT NULL REFERENCES users (id),
  table_total            INT         NOT NULL DEFAULT 0,
  hand_total             INT         NOT NULL DEFAULT 0,
  -- table_total - hand_total
  round_score            INT         NOT NULL DEFAULT 0,
  finished_first         BOOLEAN     NOT NULL DEFAULT FALSE,
  -- GAME_CONFIG.FINISH_BONUS (20) if finished_first, else 0
  finish_bonus           SMALLINT    NOT NULL DEFAULT 0,
  -- round_score + finish_bonus
  final_score            INT         NOT NULL DEFAULT 0,
  -- Running total after this round completes (avoids full-table scan for profile display)
  cumulative_score_after INT         NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_scores_round_user UNIQUE (round_id, user_id)
);

CREATE INDEX idx_scores_round_id ON game_scores (round_id);
CREATE INDEX idx_scores_room_id  ON game_scores (room_id);
CREATE INDEX idx_scores_user_id  ON game_scores (user_id);

-- ─── leaderboard_entries ─────────────────────────────────────────────────────
-- One row per user; updated (upserted) at the end of each completed game.
-- Intentionally denormalised for O(1) leaderboard reads.

CREATE TABLE leaderboard_entries (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        UNIQUE NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  games_played          INT         NOT NULL DEFAULT 0,
  games_won             INT         NOT NULL DEFAULT 0,
  total_score           BIGINT      NOT NULL DEFAULT 0,   -- lifetime cumulative
  highest_round_score   INT         NOT NULL DEFAULT 0,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_leaderboard_total_score ON leaderboard_entries (total_score DESC);
CREATE INDEX idx_leaderboard_wins        ON leaderboard_entries (games_won DESC);

-- ─── match_history ───────────────────────────────────────────────────────────
-- Summarises each completed game for "recent games" and profile views
-- without requiring joins across game_rounds / game_scores.

CREATE TABLE match_history (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id          UUID        UNIQUE NOT NULL REFERENCES game_rooms (id) ON DELETE CASCADE,
  winner_user_id   UUID        REFERENCES users (id),
  rounds_played    SMALLINT    NOT NULL DEFAULT 0,
  -- Array of { userId, finalScore, rank } — enough for a results table
  player_results   JSONB       NOT NULL DEFAULT '[]',
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_match_history_winner   ON match_history (winner_user_id);
CREATE INDEX idx_match_history_finished ON match_history (finished_at DESC);
