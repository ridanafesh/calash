/**
 * Profile-route tests.
 *
 * The reason this file exists is the 400 Bad Request the guest-name
 * popup hit when saving its prefilled name. Root cause turned out to
 * live on the frontend (the api client dropped Content-Type when the
 * caller passed any headers of their own, so Express parsed an empty
 * body and the route reported "no fields to update"). These tests pin
 * the backend's contract end-to-end so a future refactor can't quietly
 * break the same path again:
 *
 *   1. PUT /api/profile with a real Content-Type + a displayName field
 *      must succeed and persist the new name.
 *   2. PUT /api/profile with an empty body (the broken state) must
 *      still 400 — that's the legitimate guard, not a regression.
 *   3. Guest-account tokens must be allowed to update displayName
 *      (the popup runs while the user still has a guest token).
 */

import jwt from 'jsonwebtoken';

const mockPool = {
  query: jest.fn(),
  connect: jest.fn(),
  on: jest.fn(),
};

const mockUsersRepo = {
  updateProfile: jest.fn(),
  findWithProfile: jest.fn(),
  findAuthAccount: jest.fn(),
};

jest.mock('../db/index', () => ({
  pool: mockPool,
  query: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.mock('../db/repositories/index', () => ({
  createDatabaseService: () => ({ users: mockUsersRepo }),
}));

import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
const JWT_SECRET = 'test-jwt-secret-for-testing-only-32chars';

function makeToken(userId: string, isGuest: boolean): string {
  return jwt.sign({ userId, isGuest }, JWT_SECRET, { expiresIn: '1h' });
}

describe('PUT /api/profile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(app).put('/api/profile').send({ displayName: 'Picked Name' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when the body is empty (the guard the frontend bug used to hit)', async () => {
    const token = makeToken('guest-1', true);
    const res = await request(app)
      .put('/api/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_CHANGES');
  });

  it('updates display_name for a guest user given a proper JSON body', async () => {
    // Arrange: simulate a successful repo update + the follow-up read.
    mockUsersRepo.updateProfile.mockResolvedValue({
      user_id: 'guest-1',
      username: 'guest_abc',
      display_name: 'Picked Name',
      avatar_url: null,
    });
    mockUsersRepo.findWithProfile.mockResolvedValue({
      id: 'guest-1',
      email: null,
      profile: { username: 'guest_abc', display_name: 'Picked Name', avatar_url: null },
    });
    // Distinguish "is a guest account" from "has a password/google account"
    // — the route reads all three to compute isGuest.
    mockUsersRepo.findAuthAccount.mockImplementation(
      async (_userId: string, provider: string) => (provider === 'guest' ? { provider } : null),
    );

    const token = makeToken('guest-1', true);
    const res = await request(app)
      .put('/api/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'Picked Name' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.displayName).toBe('Picked Name');
    expect(res.body.data.user.isGuest).toBe(true);
    expect(mockUsersRepo.updateProfile).toHaveBeenCalledWith('guest-1', {
      displayName: 'Picked Name',
      avatarUrl: undefined,
    });
  });

  it('rejects a displayName that exceeds the 64-char limit', async () => {
    const token = makeToken('guest-1', true);
    const res = await request(app)
      .put('/api/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'x'.repeat(65) });
    expect(res.status).toBe(400);
  });

  it('rejects an empty-string displayName (zod min(1))', async () => {
    const token = makeToken('guest-1', true);
    const res = await request(app)
      .put('/api/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: '' });
    expect(res.status).toBe(400);
  });
});
