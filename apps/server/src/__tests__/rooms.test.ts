import jwt from 'jsonwebtoken';

const mockPool = {
  query: jest.fn(),
  connect: jest.fn(),
  on: jest.fn(),
};

const mockRoomsRepo = {
  findActiveRoomForUser: jest.fn(),
  create: jest.fn(),
  // findVisibleRooms is the new lobby query — returns BOTH lobby and
  // in-progress rooms with at least one joinable seat path. The old
  // findOpenRooms is kept as a deprecated alias and not used by the
  // route anymore.
  findVisibleRooms: jest.fn(),
  findOpenRooms: jest.fn(),
  // GET /api/rooms now also fetches the caller's rejoinable rooms
  // (in-progress rooms with their seat bot-substituted) so the lobby
  // can render a separate "your rooms" list.
  findRejoinableRoomsForUser: jest.fn(),
  findWithPlayers: jest.fn(),
};

jest.mock('../db/index', () => ({
  pool: mockPool,
  query: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.mock('../db/repositories/index', () => ({
  createDatabaseService: () => ({ rooms: mockRoomsRepo }),
}));

import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
const JWT_SECRET = 'test-jwt-secret-for-testing-only-32chars';

function makeToken(userId: string, isGuest = false): string {
  return jwt.sign({ userId, isGuest }, JWT_SECRET, { expiresIn: '1h' });
}

// ─── POST /api/rooms ──────────────────────────────────────────────────────────

describe('POST /api/rooms', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/rooms').send({ maxPlayers: 4 });
    expect(res.status).toBe(401);
  });

  it('returns 400 when maxPlayers is out of range', async () => {
    const token = makeToken('user-1');
    const res = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${token}`)
      .send({ maxPlayers: 10 });
    expect(res.status).toBe(400);
  });

  it('returns 409 when user is already in a room', async () => {
    const token = makeToken('user-1');
    mockRoomsRepo.findActiveRoomForUser.mockResolvedValue({ id: 'existing-room' });

    const res = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${token}`)
      .send({ maxPlayers: 4 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_IN_ROOM');
  });

  it('returns 201 and the new room on success', async () => {
    const token = makeToken('user-1');
    mockRoomsRepo.findActiveRoomForUser.mockResolvedValue(null);
    mockRoomsRepo.create.mockResolvedValue({ id: 'room-new' });
    // pool.query calls: UPDATE invite_code, then SELECT profile
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ display_name: 'TestUser', username: 'testuser' }] });

    const res = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${token}`)
      .send({ maxPlayers: 4 });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.hostUserId).toBe('user-1');
    expect(res.body.data.maxPlayers).toBe(4);
  });
});

// ─── GET /api/rooms ───────────────────────────────────────────────────────────

describe('GET /api/rooms', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/rooms');
    expect(res.status).toBe(401);
  });

  it('returns 200 with list of rooms', async () => {
    const token = makeToken('user-1');
    mockRoomsRepo.findVisibleRooms.mockResolvedValue([]);
    mockRoomsRepo.findRejoinableRoomsForUser.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/rooms')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Default response shape (no ?include=rejoinable) is still a flat array
    // of visible rooms — preserved for any older client.
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('lists in-progress rooms (joining mid-game must not hide the room)', async () => {
    // The user-reported bug: starting a game with bots removed the
    // room from the public list, so a second human couldn't see it.
    // Test that an in-progress room with a host-created bot DOES
    // appear in the list returned to a fresh user.
    const token = makeToken('outsider');
    mockRoomsRepo.findVisibleRooms.mockResolvedValue([
      {
        id: 'room-inprog',
        host_user_id: 'host-1',
        invite_code: 'ABCDEF',
        is_private: false,
        status: 'in_progress',
        max_players: 4,
        created_at: new Date(),
      },
    ]);
    mockRoomsRepo.findRejoinableRoomsForUser.mockResolvedValue([]);
    // pool.query returns the player rows for the in-progress room.
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { room_id: 'room-inprog', user_id: 'host-1', seat_index: 0, is_ready: true, is_human_substitute: false, is_waiting: false, display_name: 'Host', username: 'host', is_bot: false },
        { room_id: 'room-inprog', user_id: 'bot-1', seat_index: 1, is_ready: true, is_human_substitute: false, is_waiting: false, display_name: 'Easy Bot 1', username: 'bot_1', is_bot: true },
      ],
    });

    const res = await request(app)
      .get('/api/rooms')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe('room-inprog');
    expect(res.body.data[0].status).toBe('in-progress');
    // Player slots come back so the client can compute joinability.
    expect(res.body.data[0].players).toHaveLength(2);
    const bot = res.body.data[0].players.find((p: { isBot: boolean }) => p.isBot);
    expect(bot).toBeDefined();
    expect(bot.isHumanSubstitute).toBeUndefined();
  });

  it('locked rooms are visible (the lock is enforced at JOIN, not list)', async () => {
    const token = makeToken('outsider');
    mockRoomsRepo.findVisibleRooms.mockResolvedValue([
      {
        id: 'room-locked',
        host_user_id: 'host-1',
        invite_code: 'SECRET',
        is_private: true,
        status: 'lobby',
        max_players: 4,
        created_at: new Date(),
      },
    ]);
    mockRoomsRepo.findRejoinableRoomsForUser.mockResolvedValue([]);
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/rooms')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].isPrivate).toBe(true);
    expect(res.body.data[0].code).toBe('SECRET');
  });

  it('with ?include=rejoinable, returns wrapped object with both lists', async () => {
    const token = makeToken('user-1');
    mockRoomsRepo.findVisibleRooms.mockResolvedValue([]);
    mockRoomsRepo.findRejoinableRoomsForUser.mockResolvedValue([
      {
        id: 'room-rejoin',
        host_user_id: 'someone-else',
        invite_code: 'ABCD12',
        is_private: false,
        status: 'in_progress',
        max_players: 4,
        created_at: new Date(),
      },
    ]);
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/rooms?include=rejoinable')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.open)).toBe(true);
    expect(Array.isArray(res.body.data.rejoinable)).toBe(true);
    expect(res.body.data.rejoinable).toHaveLength(1);
    expect(res.body.data.rejoinable[0].id).toBe('room-rejoin');
    expect(res.body.data.rejoinable[0].status).toBe('in-progress');
  });
});

// ─── GET /api/rooms/:id ───────────────────────────────────────────────────────

describe('GET /api/rooms/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/rooms/some-id');
    expect(res.status).toBe(401);
  });

  it('returns 404 when room does not exist', async () => {
    const token = makeToken('user-1');
    mockRoomsRepo.findWithPlayers.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/rooms/nonexistent-id')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
