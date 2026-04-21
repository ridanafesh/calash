import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

import { logger } from '../logger.js';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
      },
    });
    return;
  }

  const status = (err as { status?: number }).status ?? 500;
  if (status === 500) {
    logger.error({ err }, 'Unhandled server error');
  }
  res.status(status).json({
    success: false,
    error: {
      code: (err as { code?: string }).code ?? 'INTERNAL_ERROR',
      message: status === 500 ? 'Internal server error' : String(err.message),
    },
  });
};
