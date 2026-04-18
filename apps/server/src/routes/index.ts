import { Router } from 'express';

import authRouter from './auth.js';
import healthRouter from './health.js';

const router = Router();

router.use('/api', healthRouter);
router.use('/api', authRouter);

export default router;
