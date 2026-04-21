import cors from 'cors';
import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';

import { config } from './config/index.js';
import { logger } from './logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import routes from './routes/index.js';

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: config.cors.origin, credentials: true }));
  app.use(express.json());

  // Request logging (skip in test environment)
  if (config.nodeEnv !== 'test') {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      logger.debug({ method: req.method, url: req.url }, 'request');
      next();
    });
  }

  app.use(routes);
  app.use(errorHandler);
  return app;
}
