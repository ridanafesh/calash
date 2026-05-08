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
    // Surface the substitute flag so the lobby can tell the difference
    // between a host-created bot (replaceable) and a human-substitute
    // bot (NOT replaceable — reserved for the original human's
    // reclaim flow). Without this every bot looked replaceable, which
    // is wrong for "is this room joinable" computation.
    ...(p.isHumanSubstitute ? { isHumanSubstitute: true } : {}),
    // isWaiting matters for join-vs-empty-seat math — a waiting
    // player holds a seat but isn't part of the round.
    ...(p.isWaiting ? { isWaiting: true } : {}),
  }));
  return {
    id: room.roomId,
    code: room.inviteCode,
    isPrivate: room.isPrivate,
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
    isPrivate: false,
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

router.get('/rooms', requireAuth, async (req, res) => {
  const userId = req.auth!.userId;

  // findVisibleRooms returns BOTH lobby and in-progress rooms with
  // any joinable seat path (empty seat or replaceable bot). Locked
  // rooms are included — privacy is enforced at JOIN time, not list time.
  const [visibleRooms, rejoinable] = await Promise.all([
    db.rooms.findVisibleRooms(),
    db.rooms.findRejoinableRoomsForUser(userId),
  ]);

  // The "your rooms" section is the user's own rejoinable rooms; we
  // hide those from the public list to avoid duplication. (A player
  // can't take a seat in a room they're already a substitute in —
  // they can only reclaim it.)
  const rejoinableIds = new Set(rejoinable.map((r) => r.id));

  function statusFromDb(s: string): GameRoom['status'] {
    return s === 'in_progress' ? 'in-progress' : s === 'finished' ? 'finished' : 'lobby';
  }

  // For rooms not in memory we still need their player slots so the
  // client can compute joinability (full vs has-replaceable-bot) and
  // render the seat count. Single batched query on visible+rejoinable
  // ids avoids N+1.
  type DbRow = (typeof visibleRooms)[number];
  const allDbRooms: DbRow[] = [...visibleRooms];
  for (const r of rejoinable) if (!visibleRooms.find((v) => v.id === r.id)) allDbRooms.push(r);

  const idsNeedingPlayers = allDbRooms.filter((r) => !roomStore.get(r.id)).map((r) => r.id);
  const playerRowsByRoom = new Map<string, Array<{
    user_id: string;
    seat_index: number;
    is_ready: boolean;
    is_human_substitute: boolean;
    is_waiting: boolean;
    display_name: string | null;
    username: string | null;
    is_bot: boolean;
  }>>();
  if (idsNeedingPlayers.length > 0) {
    const { rows } = await pool.query<{
      room_id: string;
      user_id: string;
      seat_index: number;
      is_ready: boolean;
      is_human_substitute: boolean;
      is_waiting: boolean;
      display_name: string | null;
      username: string | null;
      is_bot: boolean;
    }>(
      `SELECT grp.room_id, grp.user_id, grp.seat_index,
              COALESCE(grp.is_ready, false) AS is_ready,
              COALESCE(grp.is_human_substitute, false) AS is_human_substitute,
              COALESCE(grp.is_waiting, false) AS is_waiting,
              pp.display_name, pp.username, u.is_bot
         FROM game_room_players grp
         JOIN users u ON u.id = grp.user_id
         LEFT JOIN player_profiles pp ON pp.user_id = grp.user_id
        WHERE grp.room_id = ANY($1::uuid[])
          AND grp.left_at IS NULL`,
      [idsNeedingPlayers],
    );
    for (const r of rows) {
      const list = playerRowsByRoom.get(r.room_id) ?? [];
      list.push(r);
      playerRowsByRoom.set(r.room_id, list);
    }
  }

  function dbRowToGameRoom(r: DbRow): GameRoom {
    const memRoom = roomStore.get(r.id);
    if (memRoom) return storeStateToGameRoom(memRoom);
    const playerRows = (playerRowsByRoom.get(r.id) ?? []).sort((a, b) => a.seat_index - b.seat_index);
    const players: RoomPlayer[] = playerRows.map((p) => ({
      userId: p.user_id,
      displayName: p.display_name ?? p.username ?? p.user_id,
      isReady: p.is_ready,
      // No socket info from DB; humans show as disconnected here. The
      // socket-state-aware in-memory branch overrides this whenever
      // the room is loaded.
      isConnected: p.is_bot,
      isBot: p.is_bot,
      ...(p.is_bot ? { botDifficulty: 'easy' as const } : {}),
      ...(p.is_human_substitute ? { isHumanSubstitute: true } : {}),
      ...(p.is_waiting ? { isWaiting: true } : {}),
    }));
    return {
      id: r.id,
      code: (r as typeof r & { invite_code?: string }).invite_code ?? '',
      isPrivate: (r as typeof r & { is_private?: boolean }).is_private ?? false,
      hostUserId: r.host_user_id,
      status: statusFromDb(r.status),
      maxPlayers: r.max_players,
      players,
      currentRound: 0,
    } satisfies GameRoom;
  }

  // Redact the invite code on locked rooms unless the requesting
  // user is the room creator. The lock badge stays visible (the
  // client renders it from isPrivate), but other users see an empty
  // code and have to obtain it from the host out-of-band — that's
  // the whole point of a locked room. Open rooms always expose the
  // code (they're public).
  function redactCodeForViewer(r: GameRoom): GameRoom {
    if (!r.isPrivate) return r;
    if (r.hostUserId === userId) return r;
    return { ...r, code: '' };
  }

  const publicRooms = visibleRooms
    .filter((r) => !rejoinableIds.has(r.id))
    .map(dbRowToGameRoom)
    .map(redactCodeForViewer);
  const yourRooms = rejoinable.map(dbRowToGameRoom).map(redactCodeForViewer);

  // The legacy shape (a plain array) is preserved so existing callers
  // keep working. The wrapped form is opt-in via a query flag — the
  // lobby uses it to render a separate "your rooms" section.
  if (req.query['include'] === 'rejoinable') {
    res.json({ success: true, data: { open: publicRooms, rejoinable: yourRooms } });
    return;
  }

  res.json({ success: true, data: publicRooms });
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
  const requesterId = req.auth!.userId;

  function redactCodeForViewer(r: GameRoom): GameRoom {
    if (!r.isPrivate) return r;
    if (r.hostUserId === requesterId) return r;
    return { ...r, code: '' };
  }

  const memRoom = roomStore.get(id);
  if (memRoom) {
    res.json({ success: true, data: redactCodeForViewer(storeStateToGameRoom(memRoom)) });
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
    isPrivate: (dbRoom as typeof dbRoom & { is_private?: boolean }).is_private ?? false,
    hostUserId: dbRoom.host_user_id,
    status: dbRoom.status === 'in_progress' ? 'in-progress' : dbRoom.status === 'finished' ? 'finished' : 'lobby',
    maxPlayers: dbRoom.max_players,
    players,
    currentRound: 0,
  };

  res.json({ success: true, data: redactCodeForViewer(room) });
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
