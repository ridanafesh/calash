import { Router } from 'express';

import { pool } from '../db/index.js';

const router = Router();

router.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ success: true, data: { status: 'ok', db: 'connected' } });
  } catch {
    res.status(503).json({ success: false, error: { code: 'DB_ERROR', message: 'Database unreachable' } });
  }
});

export default router;
