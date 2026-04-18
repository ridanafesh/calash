import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { config } from '../config/index.js';
import { query } from '../db/index.js';

const router = Router();

const registerSchema = z.object({
  username: z.string().min(3).max(32),
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

router.post('/auth/register', async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(body.password, 12);
    const result = await query<{ id: string; username: string; email: string }>(
      'INSERT INTO players (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email',
      [body.username, body.email, passwordHash],
    );
    const player = result.rows[0];
    const token = jwt.sign({ playerId: player.id }, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn,
    });
    res.status(201).json({ success: true, data: { token, player } });
  } catch (err) {
    next(err);
  }
});

router.post('/auth/login', async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const result = await query<{ id: string; username: string; email: string; password_hash: string }>(
      'SELECT id, username, email, password_hash FROM players WHERE email = $1',
      [body.email],
    );
    const player = result.rows[0];
    if (!player || !(await bcrypt.compare(body.password, player.password_hash))) {
      res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
      return;
    }
    const token = jwt.sign({ playerId: player.id }, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn,
    });
    const { password_hash: _ph, ...safePlayer } = player;
    res.json({ success: true, data: { token, player: safePlayer } });
  } catch (err) {
    next(err);
  }
});

export default router;
