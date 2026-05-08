/**
 * Standalone CLI for ad-hoc stale-room cleanup.
 *
 * Use this when you suspect zombie rooms accumulated (e.g. from an
 * earlier server build that didn't close rooms properly) and want to
 * sweep them without redeploying. The same cleanupStaleRooms()
 * function runs at server startup + every 5 min, so this script is
 * mostly a manual escape hatch for production incidents.
 *
 * Usage:
 *   npx tsx scripts/cleanup-stale-rooms.ts          # run once, exit
 *   npm run db:cleanup-rooms -w apps/server         # via the workspace
 *
 * Environment:
 *   DATABASE_URL must be set (the same connection string the server uses).
 *
 * Exit codes:
 *   0 — success (regardless of how many rooms were removed)
 *   1 — DB connection or query failure
 *
 * Safe to re-run; it's idempotent. Re-evaluates the staleness
 * predicate inside a transaction so a room someone just rejoined
 * won't get nuked between the SELECT and the UPDATE.
 */

import 'dotenv/config';
import { pool } from '../src/db/index.js';
import { cleanupStaleRooms } from '../src/sockets/handlers/cleanup.js';

async function main(): Promise<void> {
  const before = Date.now();
  // eslint-disable-next-line no-console
  console.log('[cleanup-cli] scanning for stale rooms…');
  const result = await cleanupStaleRooms(pool);
  const ms = Date.now() - before;
  // eslint-disable-next-line no-console
  console.log(
    `[cleanup-cli] done in ${ms}ms — removed ${result.removedRoomIds.length} stale room(s); in-memory purged ${result.inMemoryRemoved}.`,
  );
  if (result.removedRoomIds.length > 0) {
    // eslint-disable-next-line no-console
    console.log('[cleanup-cli] room ids:', result.removedRoomIds.join(', '));
  }
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error('[cleanup-cli] FAILED:', err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
