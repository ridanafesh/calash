import 'dotenv/config';
import { createServer } from 'http';

import { config } from './config/index.js';
import { createApp } from './app.js';
import { logger } from './logger.js';
import { createSocketServer } from './sockets/index.js';

const app = createApp();
const httpServer = createServer(app);
createSocketServer(httpServer);

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
