import type { ErrorRequestHandler } from 'express';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  const status = (err as { status?: number }).status ?? 500;
  res.status(status).json({
    success: false,
    error: {
      code: (err as { code?: string }).code ?? 'INTERNAL_ERROR',
      message: status === 500 ? 'Internal server error' : String(err.message),
    },
  });
};
