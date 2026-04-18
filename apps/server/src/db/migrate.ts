/**
 * Migration runner.
 *
 * Scans src/db/migrations/*.sql in lexicographic order, runs any that have
 * not yet been applied (tracked in the schema_migrations table), and records
 * each successful migration.  Transactional: a failing migration rolls back
 * and the process exits non-zero so CI catches it.
 *
 * Usage:
 *   npx tsx src/db/migrate.ts
 *   npm run db:migrate -w apps/server
 */

import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function run(): Promise<void> {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const client = await pool.connect();

  try {
    // Create migrations tracking table if it doesn't exist.
    // This is safe to run multiple times.
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     VARCHAR(255) PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Read applied migrations
    const { rows: applied } = await client.query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    const appliedSet = new Set(applied.map((r) => r.version));

    // Read migration files
    const files = (await fs.readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const pending = files.filter((f) => !appliedSet.has(f));

    if (pending.length === 0) {
      console.log('✓ No pending migrations.');
      return;
    }

    console.log(`Running ${pending.length} pending migration(s)…`);

    for (const file of pending) {
      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = await fs.readFile(filePath, 'utf-8');

      console.log(`  → ${file}`);

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1)',
          [file],
        );
        await client.query('COMMIT');
        console.log(`    ✓ applied`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`    ✗ failed — rolled back`);
        throw err;
      }
    }

    console.log('✓ All migrations applied.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
