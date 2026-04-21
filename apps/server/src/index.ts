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
  logger.info({ port: config.port, env: config.nodeEnv }, 'Server started');
});
