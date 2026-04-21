import jwt from 'jsonwebtoken';

// All mock* variables are hoisted by Jest alongside jest.mock calls.
const mockPool = {
  query: jest.fn(),
  connect: jest.fn(),
  on: jest.fn(),
};

const mockUsersRepo = {
  isUsernameTaken: jest.fn(),
  findByEmail: jest.fn(),
  create: jest.fn(),
  findAuthAccountByEmail: jest.fn(),
  findWithProfile: jest.fn(),
  createGuest: jest.fn(),
  findAuthAccount: jest.fn(),
  findByGoogleId: jest.fn(),
  linkGoogleAccount: jest.fn(),
  linkPasswordAccount: jest.fn(),
  updateProfile: jest.fn(),
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

function makeToken(userId: string, isGuest = false): string {
  return jwt.sign({ userId, isGuest }, JWT_SECRET, { expiresIn: '1h' });
}

// ─── POST /api/auth/register ──────────────────────────────────────────────────

describe('POST /api/auth/register', () => {
  it('returns 400 when body is missing required fields', async () => {
    const res = await request(app).post('/api/auth/register').send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 when email is invalid', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'testuser', email: 'not-an-email', password: 'password123' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password is too short', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'testuser', email: 'test@example.com', password: 'short' });
    expect(res.status).toBe(400);
  });

  it('returns 409 when username is taken', async () => {
    mockUsersRepo.isUsernameTaken.mockResolvedValue(true);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'taken', email: 'test@example.com', password: 'password123' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('USERNAME_TAKEN');
  });

  it('returns 409 when email is already registered', async () => {
    mockUsersRepo.isUsernameTaken.mockResolvedValue(false);
    mockUsersRepo.findByEmail.mockResolvedValue({ id: 'existing-user' });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'newuser', email: 'taken@example.com', password: 'password123' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('returns 201 with token on successful registration', async () => {
    mockUsersRepo.isUsernameTaken.mockResolvedValue(false);
    mockUsersRepo.findByEmail.mockResolvedValue(null);
    mockUsersRepo.create.mockResolvedValue({
      id: 'user-1',
      email: 'new@example.com',
      profile: { username: 'newuser', display_name: null, avatar_url: null },
    });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'newuser', email: 'new@example.com', password: 'password123' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.user.email).toBe('new@example.com');
  });
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  it('returns 400 when body is missing fields', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 when email format is invalid', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'bad-email', password: 'pass' });
    expect(res.status).toBe(400);
  });

  it('returns 401 when credentials are invalid', async () => {
    mockUsersRepo.findAuthAccountByEmail.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'wrongpass' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

// ─── POST /api/auth/guest ─────────────────────────────────────────────────────

describe('POST /api/auth/guest', () => {
  it('returns 201 with token', async () => {
    mockUsersRepo.isUsernameTaken.mockResolvedValue(false);
    mockUsersRepo.createGuest.mockResolvedValue({
      id: 'guest-1',
      email: null,
      profile: { username: 'guest_abc', display_name: null, avatar_url: null },
    });

    const res = await request(app).post('/api/auth/guest');
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
  });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

describe('GET /api/auth/me', () => {
  it('returns 401 without Authorization header', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 with invalid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer bad.token.here');
    expect(res.status).toBe(401);
  });

  it('returns 200 with valid token', async () => {
    const token = makeToken('user-1', false);
    mockUsersRepo.findWithProfile.mockResolvedValue({
      id: 'user-1',
      email: 'me@example.com',
      profile: { username: 'meuser', display_name: null, avatar_url: null },
    });
    mockUsersRepo.findAuthAccount.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.id).toBe('user-1');
  });
});
