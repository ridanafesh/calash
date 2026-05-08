/**
 * Stale-room cleanup orchestrator.
 *
 * Purges every room with no live human players. The DB side is in
 * room.repository (cleanupStaleRooms — sets status='abandoned' and
 * closes out player rows in a single transaction). This wrapper also
 * tears down the in-memory roomStore entry, cancels any in-flight
 * bot timer, and cancels any pending disconnect-grace timer for any
 * (now-departed) human substitute.
 *
 * Three callers today:
 *   - server startup (one-shot, before listen())
 *   - periodic interval (every 5 min) so any in-process leakage gets
 *     swept eventually even if the leave/disconnect handlers somehow
 *     miss a transition
 *   - the standalone scripts/cleanup-stale-rooms.ts CLI for ad-hoc
 *     production runs
 *
 * Idempotent and safe to run concurrently with normal traffic — the
 * SQL inside the txn re-evaluates the staleness predicate, so a
 * room someone just rejoined won't get nuked.
 */

import type { Pool } from 'pg';
import { createDatabaseService } from '../../db/repositories/index.js';
import { roomStore } from '../../store/index.js';
import { cancelBotTimer } from './game.js';
import { cancelDisconnectGrace } from './room.js';

export interface CleanupResult {
  /** Room ids the DB transaction marked abandoned. */
  removedRoomIds: string[];
  /** How many of those rooms were also live in the in-memory store. */
  inMemoryRemoved: number;
}

export async function cleanupStaleRooms(pool: Pool): Promise<CleanupResult> {
  const db = createDatabaseService(pool);
  const removedRoomIds = await db.rooms.cleanupStaleRooms();

  let inMemoryRemoved = 0;
  for (const roomId of removedRoomIds) {
    const inMem = roomStore.get(roomId);
    if (inMem) {
      // Cancel any in-flight grace timers for this room before
      // dropping the user-index entries (the timer would otherwise
      // fire later and try to leave a now-deleted user).
      for (const slot of inMem.players) {
        if (!slot.isBot) cancelDisconnectGrace(roomId, slot.userId);
      }
      roomStore.delete(roomId);
      cancelBotTimer(roomId);
      inMemoryRemoved += 1;
    }
  }

  return { removedRoomIds, inMemoryRemoved };
}

/**
 * Schedule cleanup to run every `intervalMs`. The first run happens
 * immediately so the server doesn't carry zombies for the first
 * interval. Returns a stop() so tests / shutdown handlers can
 * cancel cleanly.
 */
export function startPeriodicCleanup(
  pool: Pool,
  intervalMs: number,
  onResult?: (r: CleanupResult) => void,
): { stop: () => void } {
  let stopped = false;

  async function run() {
    if (stopped) return;
    try {
      const result = await cleanupStaleRooms(pool);
      if (onResult) onResult(result);
    } catch (err) {
      console.error('[cleanup] stale-room sweep failed:', err);
    }
  }

  // Don't await the first run — let the server come up immediately.
  void run();

  const handle = setInterval(run, intervalMs);
  // Don't keep the Node process alive just for the cleanup interval.
  if (typeof handle === 'object' && handle !== null && 'unref' in handle) {
    (handle as { unref: () => void }).unref();
  }

  return {
    stop: () => {
      stopped = true;
      clearInterval(handle);
    },
  };
}
