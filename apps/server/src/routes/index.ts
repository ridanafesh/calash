import { Router } from 'express';

import authRouter from './auth.js';
import commerceRouter from './commerce.js';
import healthRouter from './health.js';
import historyRouter from './history.js';
import leaderboardRouter from './leaderboard.js';
import profileRouter from './profile.js';
import roomsRouter from './rooms.js';
import scoresRouter from './scores.js';

const router = Router();

router.use('/api', healthRouter);
router.use('/api', authRouter);
router.use('/api', profileRouter);
router.use('/api', roomsRouter);
router.use('/api', scoresRouter);
router.use('/api', leaderboardRouter);
router.use('/api', historyRouter);
router.use('/api', commerceRouter);

export default router;
