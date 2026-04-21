import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { pool } from '../db/index.js';
import { createDatabaseService } from '../db/repositories/index.js';
import { roomStore, generateInviteCode, type RoomState } from '../store/index.js';
import type { GameRoom, RoomPlayer } from '@calash/shared';
import { GAME_CONFIG } from '@calash/shared';

const router = Router();
const db = createDatabaseService(pool);

function storeStateToGameRoom(room: RoomState): GameRoom {
  const players: RoomPlayer[] = room.players.map((p) => ({
    userId: p.userId,
    displayName: p.displayName,
    isReady: p.isReady,
    isConnected: p.isBot || p.socketId !== null,
    isBot: p.isBot,
    botDifficulty: p.botDifficulty,
  }));
  return {
    id: room.roomId,
    code: room.inviteCode,
    hostUserId: room.hostUserId,
    status: room.status,
    maxPlayers: room.maxPlayers,
    players,
    currentRound: room.round?.roundNumber ?? 0,
  };
}

// ─── POST /api/rooms ──────────────────────────────────────────────────────────
// Create a new room. The caller becomes host and is automatically joined.

const createRoomSchema = z.object({
  maxPlayers: z.number().int().min(GAME_CONFIG.MIN_PLAYERS).max(GAME_CONFIG.MAX_PLAYERS).default(4),
});

router.post('/rooms', requireAuth, async (req, res) => {
  const parsed = createRoomSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    return;
  }

  const userId = req.auth!.userId;
  const { maxPlayers } = parsed.data;

  const existing = await db.rooms.findActiveRoomForUser(userId);
  if (existing) {
    res.status(409).json({ success: false, error: { code: 'ALREADY_IN_ROOM', message: 'Leave your current room before creating one.' } });
    return;
  }

  const inviteCode = generateInviteCode();
  const dbRoom = await db.rooms.create({ hostUserId: userId, maxPlayers });
  await pool.query('UPDATE game_rooms SET invite_code = $1 WHERE id = $2', [inviteCode, dbRoom.id]);

  const { rows: profileRows } = await pool.query<{ display_name: string | null; username: string }>(
    `SELECT pp.display_name, pp.username FROM users u LEFT JOIN player_profiles pp ON pp.user_id = u.id WHERE u.id = $1`,
    [userId],
  );
  const displayName = profileRows[0]?.display_name ?? profileRows[0]?.username ?? userId;

  const room: RoomState = {
    roomId: dbRoom.id,
    inviteCode,
    hostUserId: userId,
    status: 'lobby',
    maxPlayers,
    players: [{ userId, seatIndex: 0, isReady: false, socketId: null, displayName, isBot: false }],
    round: null,
  };
  roomStore.set(room);

  res.status(201).json({ success: true, data: storeStateToGameRoom(room) });
});

// ─── GET /api/rooms ───────────────────────────────────────────────────────────
// List open rooms (lobby status, not yet full).

router.get('/rooms', requireAuth, async (_req, res) => {
  const openRooms = await db.rooms.findOpenRooms();

  const rooms = openRooms.map((r) => {
    const memRoom = roomStore.get(r.id);
    if (memRoom) return storeStateToGameRoom(memRoom);

    return {
      id: r.id,
      code: (r as typeof r & { invite_code?: string }).invite_code ?? '',
      hostUserId: r.host_user_id,
      status: 'lobby' as const,
      maxPlayers: r.max_players,
      players: [] as RoomPlayer[],
      currentRound: 0,
    } satisfies GameRoom;
  });

  res.json({ success: true, data: rooms });
});

// ─── GET /api/rooms/:id ───────────────────────────────────────────────────────
// Get a single room by UUID.

async function fetchPlayerMeta(userIds: string[]): Promise<Map<string, { displayName: string; isBot: boolean }>> {
  const map = new Map<string, { displayName: string; isBot: boolean }>();
  if (userIds.length === 0) return map;
  const { rows } = await pool.query<{ id: string; display_name: string | null; username: string; is_bot: boolean }>(
    `SELECT u.id, u.is_bot, pp.display_name, pp.username
       FROM users u
       LEFT JOIN player_profiles pp ON pp.user_id = u.id
      WHERE u.id = ANY($1::uuid[])`,
    [userIds],
  );
  for (const r of rows) {
    map.set(r.id, { displayName: r.display_name ?? r.username ?? r.id, isBot: r.is_bot });
  }
  return map;
}

router.get('/rooms/:id', requireAuth, async (req, res) => {
  const { id } = req.params;

  const memRoom = roomStore.get(id);
  if (memRoom) {
    res.json({ success: true, data: storeStateToGameRoom(memRoom) });
    return;
  }

  const dbRoom = await db.rooms.findWithPlayers(id);
  if (!dbRoom) {
    res.status(404).json({ success: false, error: { code: 'ROOM_NOT_FOUND', message: 'Room not found.' } });
    return;
  }

  const meta = await fetchPlayerMeta(dbRoom.players.map((p) => p.user_id));
  const players: RoomPlayer[] = dbRoom.players
    .filter((p) => p.left_at === null)
    .map((p) => {
      const m = meta.get(p.user_id);
      return {
        userId: p.user_id,
        displayName: m?.displayName ?? p.user_id,
        isReady: (p as typeof p & { is_ready?: boolean }).is_ready ?? false,
        isConnected: false,
        isBot: m?.isBot ?? false,
      };
    });

  const room: GameRoom = {
    id: dbRoom.id,
    code: (dbRoom as typeof dbRoom & { invite_code?: string }).invite_code ?? '',
    hostUserId: dbRoom.host_user_id,
    status: dbRoom.status === 'in_progress' ? 'in-progress' : dbRoom.status === 'finished' ? 'finished' : 'lobby',
    maxPlayers: dbRoom.max_players,
    players,
    currentRound: 0,
  };

  res.json({ success: true, data: room });
});

// ─── GET /api/rooms/join/:code ────────────────────────────────────────────────
// Look up a room by invite code.  Returns the room so the client can then
// emit room:join or room:join-by-code via the socket.

router.get('/rooms/join/:code', requireAuth, async (req, res) => {
  const code = req.params.code.trim().toUpperCase();

  const memRoom = roomStore.getByCode(code);
  if (memRoom) {
    res.json({ success: true, data: storeStateToGameRoom(memRoom) });
    return;
  }

  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM game_rooms WHERE invite_code = $1 AND status = $2',
    [code, 'lobby'],
  );

  if (!rows[0]) {
    res.status(404).json({ success: false, error: { code: 'ROOM_NOT_FOUND', message: `No open room with code ${code}.` } });
    return;
  }

  // Delegate to the full room fetch.
  const dbRoom = await db.rooms.findWithPlayers(rows[0].id);
  if (!dbRoom) {
    res.status(404).json({ success: false, error: { code: 'ROOM_NOT_FOUND', message: 'Room not found.' } });
    return;
  }

  const meta2 = await fetchPlayerMeta(dbRoom.players.map((p) => p.user_id));
  const players: RoomPlayer[] = dbRoom.players
    .filter((p) => p.left_at === null)
    .map((p) => {
      const m = meta2.get(p.user_id);
      return {
        userId: p.user_id,
        displayName: m?.displayName ?? p.user_id,
        isReady: (p as typeof p & { is_ready?: boolean }).is_ready ?? false,
        isConnected: false,
        isBot: m?.isBot ?? false,
      };
    });

  const room: GameRoom = {
    id: dbRoom.id,
    code,
    hostUserId: dbRoom.host_user_id,
    status: 'lobby',
    maxPlayers: dbRoom.max_players,
    players,
    currentRound: 0,
  };

  res.json({ success: true, data: room });
});

export default router;
