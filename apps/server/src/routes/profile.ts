import { Router } from 'express';
import { z } from 'zod';

import { pool } from '../db/index.js';
import { createDatabaseService } from '../db/repositories/index.js';
import { requireAuth } from '../middleware/auth.js';
import type { UserProfile } from '@calash/shared';

const router = Router();
const db = createDatabaseService(pool);

const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(64).optional(),
  avatarUrl: z.string().url().optional(),
});

router.get('/profile', requireAuth, async (req, res, next) => {
  try {
    const { userId } = req.auth!;
    const user = await db.users.findWithProfile(userId);
    if (!user) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
      return;
    }

    const guestAccount = await db.users.findAuthAccount(userId, 'guest');
    const passwordAccount = await db.users.findAuthAccount(userId, 'password');
    const googleAccount = await db.users.findAuthAccount(userId, 'google');
    const isGuest = guestAccount !== null && !passwordAccount && !googleAccount;

    const profile: UserProfile = {
      id: user.id,
      username: user.profile?.username ?? '',
      displayName: user.profile?.display_name ?? null,
      avatarUrl: user.profile?.avatar_url ?? null,
      email: user.email,
      isGuest,
    };
    res.json({ success: true, data: { user: profile } });
  } catch (err) {
    next(err);
  }
});

router.put('/profile', requireAuth, async (req, res, next) => {
  try {
    const { userId } = req.auth!;
    const body = updateProfileSchema.parse(req.body);

    if (Object.keys(body).length === 0) {
      res.status(400).json({ success: false, error: { code: 'NO_CHANGES', message: 'No fields to update' } });
      return;
    }

    const updated = await db.users.updateProfile(userId, {
      displayName: body.displayName,
      avatarUrl: body.avatarUrl,
    });
    if (!updated) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Profile not found' } });
      return;
    }

    const user = await db.users.findWithProfile(userId);
    const guestAccount = await db.users.findAuthAccount(userId, 'guest');
    const passwordAccount = await db.users.findAuthAccount(userId, 'password');
    const googleAccount = await db.users.findAuthAccount(userId, 'google');
    const isGuest = guestAccount !== null && !passwordAccount && !googleAccount;

    const profile: UserProfile = {
      id: user!.id,
      username: updated.username,
      displayName: updated.display_name ?? null,
      avatarUrl: updated.avatar_url ?? null,
      email: user!.email,
      isGuest,
    };
    res.json({ success: true, data: { user: profile } });
  } catch (err) {
    next(err);
  }
});

export default router;
