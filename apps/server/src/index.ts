import 'dotenv/config';
import { createServer } from 'http';

import { config } from './config/index.js';
import { createApp } from './app.js';
import { pool } from './db/index.js';
import { logger } from './logger.js';
import { createSocketServer } from './sockets/index.js';
import { cleanupStaleRooms, startPeriodicCleanup } from './sockets/handlers/cleanup.js';

const app = createApp();
const httpServer = createServer(app);
createSocketServer(httpServer);

// One-shot cleanup before listen() — sweeps any zombie rooms that
// previous server instances left behind (status = lobby/in_progress
// but no live human players). Keeps cold-start state consistent.
//
// Keep this *outside* an async wrapper around listen() — a slow DB
// here shouldn't block the HTTP listener; if the cleanup fails we
// log and continue. Periodic cleanup will retry every 5 min.
cleanupStaleRooms(pool)
  .then((result) => {
    if (result.removedRoomIds.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[cleanup] startup sweep removed ${result.removedRoomIds.length} stale room(s)`,
      );
      logger.info({ removed: result.removedRoomIds.length }, 'startup-cleanup-complete');
    }
  })
  .catch((err) => {
    logger.error({ err }, 'startup cleanup failed');
  });

// Periodic safety net: every 5 minutes, sweep any room that slipped
// past the leave/disconnect handlers. With the per-handler
// closeAbandonedRoom this should be a no-op in steady state, but
// belt-and-braces against future regressions.
const PERIODIC_CLEANUP_MS = 5 * 60_000;
startPeriodicCleanup(pool, PERIODIC_CLEANUP_MS, (result) => {
  if (result.removedRoomIds.length > 0) {
    logger.info(
      { removed: result.removedRoomIds.length, inMemory: result.inMemoryRemoved },
      'periodic-cleanup-removed-rooms',
    );
  }
});

httpServer.listen(config.port, () => {
  // Surface the resolved CORS origin loudly so production misconfigs are
  // easy to spot in Render's log viewer (the leading "CORS allowed origin:"
  // line shows up regardless of pino's structured log shape).
  // Both Express (cors middleware in app.ts) and Socket.IO
  // (createSocketServer) read this same value from config.cors.origin.
  // eslint-disable-next-line no-console
  console.log(`CORS allowed origin: ${config.cors.origin}`);
  logger.info(
    {
      port: config.port,
      env: config.nodeEnv,
      corsOrigin: config.cors.origin,
    },
    'Server started',
  );
});
