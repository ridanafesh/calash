/**
 * Development seed data.
 *
 * Creates 4 test players, a lobby room, and one completed room with full
 * round history so local development has realistic data to work with.
 *
 * Safe to run multiple times — uses INSERT … ON CONFLICT DO NOTHING for
 * deterministic seed IDs.
 *
 * Usage:
 *   npx tsx src/db/seed.ts
 *   npm run db:seed -w apps/server
 */

import 'dotenv/config';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const { Pool } = pg;

// ─── Seed IDs (deterministic so re-runs are idempotent) ──────────────────────

const USERS = [
  { id: '00000000-0000-0000-0000-000000000001', email: 'alice@dev.local', username: 'alice' },
  { id: '00000000-0000-0000-0000-000000000002', email: 'bob@dev.local',   username: 'bob'   },
  { id: '00000000-0000-0000-0000-000000000003', email: 'carol@dev.local', username: 'carol' },
  { id: '00000000-0000-0000-0000-000000000004', email: 'dave@dev.local',  username: 'dave'  },
] as const;

const LOBBY_ROOM_ID  = '10000000-0000-0000-0000-000000000001';
const ACTIVE_ROOM_ID = '10000000-0000-0000-0000-000000000002';

async function seed(): Promise<void> {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });

  try {
    const passwordHash = await bcrypt.hash('password123', 12);

    // ── Users ────────────────────────────────────────────────────────────────
    for (const u of USERS) {
      await pool.query(
        `INSERT INTO users (id, email) VALUES ($1, $2)
         ON CONFLICT (id) DO NOTHING`,
        [u.id, u.email],
      );

      await pool.query(
        `INSERT INTO auth_accounts (user_id, provider, password_hash)
         VALUES ($1, 'password', $2)
         ON CONFLICT (user_id, provider) DO NOTHING`,
        [u.id, passwordHash],
      );

      await pool.query(
        `INSERT INTO player_profiles (user_id, username, display_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO NOTHING`,
        [u.id, u.username, u.username.charAt(0).toUpperCase() + u.username.slice(1)],
      );

      await pool.query(
        `INSERT INTO leaderboard_entries (user_id) VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING`,
        [u.id],
      );
    }

    console.log('✓ Seeded 4 users (alice / bob / carol / dave, password: password123)');

    // ── Lobby room (open, waiting for players) ────────────────────────────────
    await pool.query(
      `INSERT INTO game_rooms (id, host_user_id, status, max_players)
       VALUES ($1, $2, 'lobby', 4)
       ON CONFLICT (id) DO NOTHING`,
      [LOBBY_ROOM_ID, USERS[0].id],
    );
    await pool.query(
      `INSERT INTO game_room_players (room_id, user_id, seat_index)
       VALUES ($1, $2, 0), ($1, $3, 1)
       ON CONFLICT (room_id, user_id) DO NOTHING`,
      [LOBBY_ROOM_ID, USERS[0].id, USERS[1].id],
    );

    console.log(`✓ Seeded lobby room  (id: ${LOBBY_ROOM_ID})`);

    // ── Active room (all 4 players, round 1 in progress) ─────────────────────
    await pool.query(
      `INSERT INTO game_rooms (id, host_user_id, status, max_players, started_at)
       VALUES ($1, $2, 'in_progress', 4, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [ACTIVE_ROOM_ID, USERS[0].id],
    );

    const seats = USERS.map((u, i) => [ACTIVE_ROOM_ID, u.id, i] as const);
    for (const [roomId, userId, seat] of seats) {
      await pool.query(
        `INSERT INTO game_room_players (room_id, user_id, seat_index)
         VALUES ($1, $2, $3)
         ON CONFLICT (room_id, user_id) DO NOTHING`,
        [roomId, userId, seat],
      );
    }

    // Round 1: alice deals, turn order [bob, carol, dave, alice]
    const ROUND_ID = '20000000-0000-0000-0000-000000000001';
    const turnOrder = [USERS[1].id, USERS[2].id, USERS[3].id, USERS[0].id];

    await pool.query(
      `INSERT INTO game_rounds (
         id, room_id, round_number, dealer_user_id, turn_order_json,
         status, current_turn_user_id, turn_phase,
         hidden_deck_json, discard_pile_json, started_at
       )
       VALUES ($1, $2, 1, $3, $4, 'in_progress', $5, 'awaiting_draw_or_take', $6, $7, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [
        ROUND_ID,
        ACTIVE_ROOM_ID,
        USERS[0].id,          // alice is dealer
        JSON.stringify(turnOrder),
        USERS[1].id,          // bob goes first
        JSON.stringify([]),   // remaining deck omitted for brevity in seed
        JSON.stringify([{ rank: '7', suit: 'hearts', isJoker: false, deckIndex: 0 }]),
      ],
    );

    // Seed hands (simplified — not a real dealt hand)
    const sampleHands: Record<string, object[]> = {
      [USERS[0].id]: [{ rank: 'A', suit: 'spades', isJoker: false, deckIndex: 0 }],
      [USERS[1].id]: [{ rank: 'K', suit: 'hearts', isJoker: false, deckIndex: 0 }],
      [USERS[2].id]: [{ rank: 'Q', suit: 'diamonds', isJoker: false, deckIndex: 0 }],
      [USERS[3].id]: [{ rank: 'J', suit: 'clubs', isJoker: false, deckIndex: 0 }],
    };

    for (const [userId, hand] of Object.entries(sampleHands)) {
      await pool.query(
        `INSERT INTO game_round_hands (round_id, user_id, cards_json)
         VALUES ($1, $2, $3)
         ON CONFLICT (round_id, user_id) DO NOTHING`,
        [ROUND_ID, userId, JSON.stringify(hand)],
      );
    }

    console.log(`✓ Seeded active room (id: ${ACTIVE_ROOM_ID}, round 1 in progress)`);
    console.log('\nSeed complete. Local dev credentials:');
    console.log('  alice@dev.local / password123');
    console.log('  bob@dev.local   / password123');
    console.log('  carol@dev.local / password123');
    console.log('  dave@dev.local  / password123');
  } finally {
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
