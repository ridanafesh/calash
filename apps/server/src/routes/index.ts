import { Router } from 'express';

import authRouter from './auth.js';
import healthRouter from './health.js';
import profileRouter from './profile.js';

const router = Router();

router.use('/api', healthRouter);
router.use('/api', authRouter);
router.use('/api', profileRouter);

export default router;
