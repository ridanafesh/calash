import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

import { config } from '../config/index.js';

export interface AuthPayload {
  userId: string;
  isGuest: boolean;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

/** Requires any valid JWT — including guest tokens. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Missing token' } });
    return;
  }
  try {
    req.auth = jwt.verify(token, config.jwt.secret) as AuthPayload;
    next();
  } catch {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });
  }
}

/** Requires a non-guest (fully registered) account. */
export function requireFullAccount(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.auth?.isGuest) {
      res.status(403).json({ success: false, error: { code: 'GUEST_NOT_ALLOWED', message: 'This action requires a permanent account' } });
      return;
    }
    next();
  });
}
