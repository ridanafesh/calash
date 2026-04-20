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

    // ── Product catalogue (commerce, all inactive by default) ─────────────────
    const PRODUCTS = [
      {
        id: '30000000-0000-0000-0000-000000000001',
        name: 'Classic Card Pack',
        description: 'A set of classic card back designs (5 styles)',
        product_type: 'cosmetic',
      },
      {
        id: '30000000-0000-0000-0000-000000000002',
        name: 'Neon Card Pack',
        description: 'Vivid neon card back designs (5 styles)',
        product_type: 'cosmetic',
      },
      {
        id: '30000000-0000-0000-0000-000000000003',
        name: 'Calash Premium Monthly',
        description: 'Unlock exclusive cosmetics and no-ads experience',
        product_type: 'subscription',
      },
    ] as const;

    for (const p of PRODUCTS) {
      await pool.query(
        `INSERT INTO products (id, name, description, product_type, is_active)
         VALUES ($1, $2, $3, $4, false)
         ON CONFLICT (id) DO NOTHING`,
        [p.id, p.name, p.description, p.product_type],
      );
    }

    // Product prices per platform (amounts in USD cents)
    const PRICES = [
      // Classic Card Pack
      { product_id: PRODUCTS[0].id, platform: 'web_paypal',   currency: 'USD', amount_cents: 299 },
      { product_id: PRODUCTS[0].id, platform: 'ios_iap',      currency: 'USD', amount_cents: 299, external_product_id: 'com.calash.cosmetic.classic' },
      { product_id: PRODUCTS[0].id, platform: 'android_iap',  currency: 'USD', amount_cents: 299, external_product_id: 'com.calash.cosmetic.classic' },
      // Neon Card Pack
      { product_id: PRODUCTS[1].id, platform: 'web_paypal',   currency: 'USD', amount_cents: 299 },
      { product_id: PRODUCTS[1].id, platform: 'ios_iap',      currency: 'USD', amount_cents: 299, external_product_id: 'com.calash.cosmetic.neon' },
      { product_id: PRODUCTS[1].id, platform: 'android_iap',  currency: 'USD', amount_cents: 299, external_product_id: 'com.calash.cosmetic.neon' },
      // Premium Monthly
      { product_id: PRODUCTS[2].id, platform: 'web_paypal',   currency: 'USD', amount_cents: 499 },
      { product_id: PRODUCTS[2].id, platform: 'ios_iap',      currency: 'USD', amount_cents: 499, external_product_id: 'com.calash.premium.monthly' },
      { product_id: PRODUCTS[2].id, platform: 'android_iap',  currency: 'USD', amount_cents: 499, external_product_id: 'com.calash.premium.monthly' },
    ] as const;

    for (const pr of PRICES) {
      await pool.query(
        `INSERT INTO product_prices (product_id, platform, currency, amount_cents, external_product_id, is_active)
         VALUES ($1, $2, $3, $4, $5, false)
         ON CONFLICT DO NOTHING`,
        [pr.product_id, pr.platform, pr.currency, pr.amount_cents, (pr as { external_product_id?: string }).external_product_id ?? null],
      );
    }

    console.log('✓ Seeded product catalogue (3 products, disabled — set is_active=true to enable)');

    // ── Wallet balances ───────────────────────────────────────────────────────
    // Give each test user a starting coin balance so commerce features can be
    // exercised locally without requiring a real payment flow.
    for (const u of USERS) {
      await pool.query(
        `INSERT INTO wallet_balances (user_id, currency, balance)
         VALUES ($1, 'coins', 1000)
         ON CONFLICT ON CONSTRAINT uq_wallet_user_currency DO NOTHING`,
        [u.id],
      );
    }

    console.log('✓ Seeded wallet balances (1000 coins each — coins currency)');

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
