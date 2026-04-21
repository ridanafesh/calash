import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { config } from '../config/index.js';
import { pool } from '../db/index.js';
import { createDatabaseService } from '../db/repositories/index.js';
import { requireAuth } from '../middleware/auth.js';
import type { AuthPayload } from '../middleware/auth.js';
import type { UserProfile } from '@calash/shared';

const router = Router();
const db = createDatabaseService(pool);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function signToken(userId: string, isGuest: boolean): string {
  return jwt.sign(
    { userId, isGuest } satisfies AuthPayload,
    config.jwt.secret,
    { expiresIn: isGuest ? config.jwt.guestExpiresIn : config.jwt.expiresIn },
  );
}

function toUserProfile(
  user: { id: string; email: string | null },
  profile: { username: string; display_name: string | null; avatar_url: string | null } | null,
  isGuest: boolean,
): UserProfile {
  return {
    id: user.id,
    username: profile?.username ?? '',
    displayName: profile?.display_name ?? null,
    avatarUrl: profile?.avatar_url ?? null,
    email: user.email,
    isGuest,
  };
}

async function isGuestUser(userId: string): Promise<boolean> {
  const acct = await db.users.findAuthAccount(userId, 'guest');
  const hasOtherProvider =
    (await db.users.findAuthAccount(userId, 'password')) !== null ||
    (await db.users.findAuthAccount(userId, 'google')) !== null;
  return acct !== null && !hasOtherProvider;
}

// Sanitize an arbitrary string into a valid username base
function sanitizeUsername(name: string): string {
  const clean = name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return clean.length >= 3 ? clean.slice(0, 28) : `user_${clean}`.slice(0, 28);
}

// Find an available username derived from `base`, appending a suffix if needed
async function uniqueUsername(base: string): Promise<string> {
  const prefix = sanitizeUsername(base).padEnd(3, '0');
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate =
      attempt === 0
        ? prefix
        : `${prefix.slice(0, 24)}_${Math.random().toString(36).slice(2, 6)}`;
    const taken = await db.users.isUsernameTaken(candidate);
    if (!taken) return candidate;
  }
  return `user_${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const registerSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-z0-9_]+$/i, 'Only letters, numbers, and underscores'),
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const googleSchema = z.object({
  credential: z.string().min(1),
});

const upgradePasswordSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  username: z.string().min(3).max(32).optional(),
});

const upgradeGoogleSchema = z.object({
  credential: z.string().min(1),
});

// ─── Password register ────────────────────────────────────────────────────────

router.post('/auth/register', async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body);

    if (await db.users.isUsernameTaken(body.username)) {
      res.status(409).json({ success: false, error: { code: 'USERNAME_TAKEN', message: 'Username is already taken' } });
      return;
    }
    const existing = await db.users.findByEmail(body.email);
    if (existing) {
      res.status(409).json({ success: false, error: { code: 'EMAIL_TAKEN', message: 'Email is already registered' } });
      return;
    }

    const passwordHash = await bcrypt.hash(body.password, 12);
    const created = await db.users.create({ email: body.email, username: body.username, passwordHash });

    const token = signToken(created.id, false);
    const userProfile = toUserProfile(created, created.profile, false);
    res.status(201).json({ success: true, data: { token, user: userProfile } });
  } catch (err) {
    next(err);
  }
});

// ─── Password login ───────────────────────────────────────────────────────────

router.post('/auth/login', async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);

    const authAccount = await db.users.findAuthAccountByEmail(body.email, 'password');
    if (!authAccount?.password_hash || !(await bcrypt.compare(body.password, authAccount.password_hash))) {
      res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
      return;
    }

    const userWithProfile = await db.users.findWithProfile(authAccount.user_id);
    if (!userWithProfile) {
      res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'User not found' } });
      return;
    }

    const token = signToken(userWithProfile.id, false);
    const userProfile = toUserProfile(userWithProfile, userWithProfile.profile, false);
    res.json({ success: true, data: { token, user: userProfile } });
  } catch (err) {
    next(err);
  }
});

// ─── Google sign-in ───────────────────────────────────────────────────────────

router.post('/auth/google', async (req, res, next) => {
  try {
    if (!config.google.clientId) {
      res.status(501).json({ success: false, error: { code: 'GOOGLE_DISABLED', message: 'Google sign-in is not configured' } });
      return;
    }

    const body = googleSchema.parse(req.body);

    // Lazy-import to keep startup fast when Google is not configured
    const { OAuth2Client } = await import('google-auth-library');
    const googleClient = new OAuth2Client(config.google.clientId);

    const ticket = await googleClient.verifyIdToken({
      idToken: body.credential,
      audience: config.google.clientId,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      res.status(400).json({ success: false, error: { code: 'INVALID_GOOGLE_TOKEN', message: 'Could not verify Google identity' } });
      return;
    }

    const googleId = payload.sub;
    const email = payload.email;
    const name = payload.name ?? payload.given_name ?? email.split('@')[0];
    const avatarUrl = payload.picture ?? null;

    // Find existing Google account
    const existing = await db.users.findByGoogleId(googleId);
    if (existing) {
      const guest = await isGuestUser(existing.id);
      const token = signToken(existing.id, guest);
      res.json({ success: true, data: { token, user: toUserProfile(existing, existing.profile, guest) } });
      return;
    }

    // Check if email already has a password account → link Google to it
    const passwordUser = await db.users.findByEmail(email);
    if (passwordUser) {
      await db.users.linkGoogleAccount(passwordUser.id, { googleId });
      const withProfile = await db.users.findWithProfile(passwordUser.id);
      const token = signToken(passwordUser.id, false);
      res.json({ success: true, data: { token, user: toUserProfile(withProfile!, withProfile?.profile ?? null, false) } });
      return;
    }

    // New user — create account
    const username = await uniqueUsername(name);
    const created = await db.users.createFromGoogle({ googleId, email, username, displayName: name, avatarUrl });
    const token = signToken(created.id, false);
    res.status(201).json({ success: true, data: { token, user: toUserProfile(created, created.profile, false) } });
  } catch (err) {
    next(err);
  }
});

// ─── Guest sign-in ────────────────────────────────────────────────────────────

router.post('/auth/guest', async (req, res, next) => {
  try {
    const username = await uniqueUsername(`guest_${Math.random().toString(36).slice(2, 8)}`);
    const created = await db.users.createGuest(username);
    const token = signToken(created.id, true);
    res.status(201).json({ success: true, data: { token, user: toUserProfile(created, created.profile, true) } });
  } catch (err) {
    next(err);
  }
});

// ─── Current user ─────────────────────────────────────────────────────────────

router.get('/auth/me', requireAuth, async (req, res, next) => {
  try {
    const { userId } = req.auth!;
    const userWithProfile = await db.users.findWithProfile(userId);
    if (!userWithProfile) {
      res.status(404).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
      return;
    }
    const guest = await isGuestUser(userId);
    res.json({ success: true, data: { user: toUserProfile(userWithProfile, userWithProfile.profile, guest) } });
  } catch (err) {
    next(err);
  }
});

// ─── Logout ───────────────────────────────────────────────────────────────────
// JWT is stateless; the client clears the stored token.
// This endpoint exists for convention and future revocation lists.

router.post('/auth/logout', requireAuth, (_req, res) => {
  res.json({ success: true, data: { message: 'Logged out' } });
});

// ─── Upgrade guest → password ─────────────────────────────────────────────────

router.post('/auth/upgrade/password', requireAuth, async (req, res, next) => {
  try {
    const { userId, isGuest } = req.auth!;
    if (!isGuest) {
      res.status(400).json({ success: false, error: { code: 'NOT_GUEST', message: 'Account is already permanent' } });
      return;
    }

    const body = upgradePasswordSchema.parse(req.body);

    const emailTaken = await db.users.findByEmail(body.email);
    if (emailTaken) {
      res.status(409).json({ success: false, error: { code: 'EMAIL_TAKEN', message: 'Email is already registered' } });
      return;
    }

    const passwordHash = await bcrypt.hash(body.password, 12);
    await db.users.linkPasswordAccount(userId, { email: body.email, passwordHash });

    // Optionally update username
    if (body.username && !(await db.users.isUsernameTaken(body.username))) {
      await db.users.updateProfile(userId, {});
    }

    const userWithProfile = await db.users.findWithProfile(userId);
    const token = signToken(userId, false);
    res.json({ success: true, data: { token, user: toUserProfile(userWithProfile!, userWithProfile?.profile ?? null, false) } });
  } catch (err) {
    next(err);
  }
});

// ─── Upgrade guest → Google ───────────────────────────────────────────────────

router.post('/auth/upgrade/google', requireAuth, async (req, res, next) => {
  try {
    const { userId, isGuest } = req.auth!;
    if (!isGuest) {
      res.status(400).json({ success: false, error: { code: 'NOT_GUEST', message: 'Account is already permanent' } });
      return;
    }
    if (!config.google.clientId) {
      res.status(501).json({ success: false, error: { code: 'GOOGLE_DISABLED', message: 'Google sign-in is not configured' } });
      return;
    }

    const body = upgradeGoogleSchema.parse(req.body);

    const { OAuth2Client } = await import('google-auth-library');
    const googleClient = new OAuth2Client(config.google.clientId);
    const ticket = await googleClient.verifyIdToken({ idToken: body.credential, audience: config.google.clientId });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      res.status(400).json({ success: false, error: { code: 'INVALID_GOOGLE_TOKEN', message: 'Could not verify Google identity' } });
      return;
    }

    const googleId = payload.sub;
    const existing = await db.users.findByGoogleId(googleId);
    if (existing && existing.id !== userId) {
      res.status(409).json({ success: false, error: { code: 'GOOGLE_ACCOUNT_IN_USE', message: 'This Google account is already linked to another user' } });
      return;
    }

    await db.users.linkGoogleAccount(userId, { googleId, email: payload.email, avatarUrl: payload.picture });

    const userWithProfile = await db.users.findWithProfile(userId);
    const token = signToken(userId, false);
    res.json({ success: true, data: { token, user: toUserProfile(userWithProfile!, userWithProfile?.profile ?? null, false) } });
  } catch (err) {
    next(err);
  }
});

export default router;
