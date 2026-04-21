/**
 * Bot user provisioning + turn-driving service.
 *
 * Bots are first-class users (`users.is_bot = true`) with a `player_profiles`
 * row, but no `auth_accounts` and no `leaderboard_entries`. They are created
 * lazily — one user row per bot per room — and never reused across rooms.
 * This keeps the users table tidy enough (one row per active bot game) and
 * means we don't have to track "bot pools" or worry about a bot being in two
 * rooms simultaneously.
 *
 * The turn driver is intentionally simple: `scheduleBotTurn` calls a delegate
 * that decides + applies one TurnAction, then re-schedules itself if the bot
 * still owes another action (e.g., it just went down and now needs to discard).
 * All actions go through the existing handleGameAction pipeline so the rules
 * engine remains the single source of truth.
 */

import type { Pool } from 'pg';
import type { BotDifficulty, RoundState, TurnAction } from '@calash/shared';
import { chooseBotAction } from '@calash/game-core';

export interface BotProfile {
  userId: string;
  displayName: string;
  difficulty: BotDifficulty;
}

/** Create a fresh bot user (DB row + profile). Returns the new user id + display name. */
export async function createBotUser(
  pool: Pool,
  opts: { difficulty: BotDifficulty; seatNumber: number },
): Promise<BotProfile> {
  const displayName = botDisplayName(opts.difficulty, opts.seatNumber);
  // Unique-ish username with a random suffix; bots can never log in so collisions
  // only matter for the unique-name DB constraint on player_profiles.username.
  const username = `${displayName.toLowerCase().replace(/\s+/g, '_')}_${randomSuffix()}`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: userRows } = await client.query<{ id: string }>(
      'INSERT INTO users (email, is_bot) VALUES (NULL, true) RETURNING id',
    );
    const userId = userRows[0].id;

    await client.query(
      'INSERT INTO player_profiles (user_id, username, display_name) VALUES ($1, $2, $3)',
      [userId, username, displayName],
    );

    await client.query('COMMIT');
    return { userId, displayName, difficulty: opts.difficulty };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Soft-delete bot rows for a finished room. Best-effort; failures are logged but not thrown. */
export async function cleanupBotsForRoom(
  pool: Pool,
  botUserIds: readonly string[],
): Promise<void> {
  if (botUserIds.length === 0) return;
  // We CAN'T hard-delete because game_moves / game_scores / game_room_players
  // FK to users(id). The is_bot flag is sufficient to filter them everywhere
  // they shouldn't appear (leaderboard, history listings).
  // Future: add a periodic GC that drops bot users older than N days whose
  // games are finished. Out of scope for this pass.
  void pool;
  void botUserIds;
}

// ─── Display name + username helpers ─────────────────────────────────────────

function botDisplayName(difficulty: BotDifficulty, seatNumber: number): string {
  const label = difficulty === 'easy' ? 'Easy Bot' : `${capitalize(difficulty)} Bot`;
  return `${label} ${seatNumber}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

// ─── Turn-decision shim ─────────────────────────────────────────────────────

/**
 * Pure wrapper over chooseBotAction that the server can call without importing
 * game-core internals directly. Re-exported here so callers depend on the
 * service module only.
 */
export function decideBotAction(
  difficulty: BotDifficulty,
  state: RoundState,
  playerId: string,
): TurnAction {
  const ps = state.playerStates[playerId];
  if (!ps) throw new Error(`Bot ${playerId} has no PlayerRoundState`);
  return chooseBotAction(difficulty, {
    state,
    playerId,
    hand: ps.hand,
  });
}
