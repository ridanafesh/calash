/**
 * Development seed data.
 *
 * Creates 4 test login accounts (alice / bob / carol / dave, password123) and
 * a product catalog + wallet balances for commerce testing.
 *
 * NO rooms are seeded — start a real game from the lobby (Play vs Computer
 * for a one-click bot game, or Create Room to invite a friend).
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
