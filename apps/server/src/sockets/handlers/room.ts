import type { Server, Socket } from 'socket.io';
import type {
  BotDifficulty,
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  GameRoom,
  RoomCreateOptions,
  RoomPlayer,
} from '@calash/shared';
import { GAME_CONFIG } from '@calash/shared';

import { pool } from '../../db/index.js';
import { createDatabaseService } from '../../db/repositories/index.js';
import { roomStore, generateInviteCode, type RoomState } from '../../store/index.js';
import { createBotUser } from '../../services/bot.service.js';

type CalashSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type CalashServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const db = createDatabaseService(pool);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toGameRoom(room: RoomState): GameRoom {
  const players: RoomPlayer[] = room.players.map((p) => ({
    userId: p.userId,
    displayName: p.displayName,
    isReady: p.isReady,
    // Bots are always considered connected — they have no socket but cannot drop.
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

function broadcastRoomUpdate(io: CalashServer, room: RoomState): void {
  io.to(room.roomId).emit('room:updated', toGameRoom(room));
}

function emitError(socket: CalashSocket, code: string, message: string): void {
  socket.emit('room:error', { code, message });
}

/**
 * Fetch display name + is_bot for a batch of user ids in a single round-trip.
 * Used by reconnect / DB-rebuild paths so we restore PlayerSlot.isBot correctly.
 */
async function fetchUserMeta(
  userIds: readonly string[],
): Promise<Map<string, { displayName: string; isBot: boolean }>> {
  const map = new Map<string, { displayName: string; isBot: boolean }>();
  if (userIds.length === 0) return map;
  const { rows } = await pool.query<{ id: string; display_name: string | null; username: string; is_bot: boolean }>(
    `SELECT u.id, u.is_bot, pp.display_name, pp.username
       FROM users u
       LEFT JOIN player_profiles pp ON pp.user_id = u.id
      WHERE u.id = ANY($1::uuid[])`,
    [userIds as string[]],
  );
  for (const r of rows) {
    map.set(r.id, {
      displayName: r.display_name ?? r.username ?? r.id,
      isBot: r.is_bot,
    });
  }
  return map;
}

// ─── Reconnect / restore helper ───────────────────────────────────────────────

export async function restorePlayerToRoom(
  socket: CalashSocket,
  _io: CalashServer,
): Promise<void> {
  const { playerId } = socket.data;

  // Check in-memory store first.
  let room = roomStore.getRoomForUser(playerId);

  // If not in memory, check DB for an active room.
  if (!room) {
    const dbRoom = await db.rooms.findActiveRoomForUser(playerId);
    if (!dbRoom) return;

    // Rebuild minimal in-memory entry for this room.
    const full = await db.rooms.findWithPlayers(dbRoom.id);
    if (!full) return;

    // We only need to rebuild from the DB if the room isn't already in memory.
    // This can happen after a server restart.  For now we skip rebuilding the
    // full RoundState (that would require re-hydrating game-core from DB rows)
    // and just restore the lobby state.
    const userMeta = await fetchUserMeta(full.players.map((p) => p.user_id));
    const newRoom: RoomState = {
      roomId: full.id,
      inviteCode: (full as typeof full & { invite_code?: string }).invite_code ?? '',
      hostUserId: full.host_user_id,
      status: full.status === 'in_progress' ? 'in-progress' : full.status === 'finished' ? 'finished' : 'lobby',
      maxPlayers: full.max_players,
      players: full.players
        .filter((p) => p.left_at === null)
        .map((p) => {
          const meta = userMeta.get(p.user_id);
          return {
            userId: p.user_id,
            seatIndex: p.seat_index,
            isReady: (p as typeof p & { is_ready?: boolean }).is_ready ?? false,
            socketId: null,
            displayName: meta?.displayName ?? p.user_id,
            isBot: meta?.isBot ?? false,
            ...(meta?.isBot ? { botDifficulty: 'easy' as BotDifficulty } : {}),
          };
        }),
      round: null,
    };
    roomStore.set(newRoom);
    room = newRoom;
  }

  if (!room) return;

  const player = room.players.find((p) => p.userId === playerId);
  if (!player) return;

  // Restore socket to the room channel.
  roomStore.updateSocket(room.roomId, playerId, socket.id);
  socket.data.roomId = room.roomId;
  await socket.join(room.roomId);

  // Send the current room state.
  socket.emit('room:updated', toGameRoom(room));

  // If a game is in progress, send the round state and private hand.
  if (room.round) {
    const { state } = room.round;
    const { toRoundStateView } = await import('@calash/game-core');
    socket.emit('game:state', toRoundStateView(state));

    const ps = state.playerStates[playerId];
    if (ps) {
      socket.emit('game:hand', ps.hand);
    }
  }

  console.log(`[room] Player ${playerId} reconnected to room ${room.roomId}`);
}

// ─── room:create ─────────────────────────────────────────────────────────────

export async function handleRoomCreate(
  socket: CalashSocket,
  _io: CalashServer,
  options: RoomCreateOptions,
): Promise<void> {
  const { playerId, displayName } = socket.data;

  if (roomStore.getRoomForUser(playerId)) {
    emitError(socket, 'ALREADY_IN_ROOM', 'You are already in a room. Leave first.');
    return;
  }

  const { maxPlayers, fillWithBots, botDifficulty } = options;
  if (maxPlayers < GAME_CONFIG.MIN_PLAYERS || maxPlayers > GAME_CONFIG.MAX_PLAYERS) {
    emitError(socket, 'INVALID_MAX_PLAYERS', `maxPlayers must be ${GAME_CONFIG.MIN_PLAYERS}–${GAME_CONFIG.MAX_PLAYERS}`);
    return;
  }

  const inviteCode = generateInviteCode();

  // Persist room to DB (includes host as seat 0).
  const dbRoom = await db.rooms.create({
    hostUserId: playerId,
    maxPlayers,
    settings: { inviteCode },
  });

  // Persist invite code via raw query (the migration adds the column).
  await pool.query('UPDATE game_rooms SET invite_code = $1 WHERE id = $2', [inviteCode, dbRoom.id]);

  const room: RoomState = {
    roomId: dbRoom.id,
    inviteCode,
    hostUserId: playerId,
    status: 'lobby',
    maxPlayers,
    players: [{
      userId: playerId,
      seatIndex: 0,
      isReady: false,
      socketId: socket.id,
      displayName: displayName ?? playerId,
      isBot: false,
    }],
    round: null,
  };

  roomStore.set(room);
  socket.data.roomId = room.roomId;
  await socket.join(room.roomId);

  // Optionally fill the remaining seats with bots immediately (single-player flow).
  if (fillWithBots) {
    const difficulty: BotDifficulty = botDifficulty ?? 'easy';
    const seatsToFill = maxPlayers - room.players.length;
    for (let i = 0; i < seatsToFill; i++) {
      await addBotToRoom(room, difficulty);
    }
  }

  socket.emit('room:updated', toGameRoom(room));
  console.log(`[room] ${playerId} created room ${room.roomId} (code: ${inviteCode}${fillWithBots ? `, ${room.players.length - 1} bots` : ''})`);
}

// ─── room:add-bot / room:remove-bot ──────────────────────────────────────────

/**
 * Internal helper: provision a bot user, register it as a player in the given
 * room, persist the player row, and mark the bot ready (bots are always ready).
 *
 * Caller is responsible for broadcasting room:updated after adding bots.
 */
async function addBotToRoom(room: RoomState, difficulty: BotDifficulty): Promise<void> {
  if (room.players.length >= room.maxPlayers) {
    throw new Error('Room is full');
  }

  const seatNumber = room.players.filter((p) => p.isBot).length + 1;
  const bot = await createBotUser(pool, { difficulty, seatNumber });
  await db.rooms.addPlayer(room.roomId, bot.userId);
  await pool.query(
    'UPDATE game_room_players SET is_ready = true WHERE room_id = $1 AND user_id = $2',
    [room.roomId, bot.userId],
  );

  room.players.push({
    userId: bot.userId,
    seatIndex: room.players.length,
    isReady: true,
    socketId: null,
    displayName: bot.displayName,
    isBot: true,
    botDifficulty: difficulty,
  });
  roomStore.trackUser(bot.userId, room.roomId);
}

export async function handleRoomAddBot(
  socket: CalashSocket,
  io: CalashServer,
  opts?: { difficulty?: BotDifficulty },
): Promise<void> {
  const { playerId, roomId } = socket.data;
  if (!roomId) {
    emitError(socket, 'NOT_IN_ROOM', 'You are not in a room.');
    return;
  }
  const room = roomStore.get(roomId);
  if (!room) { emitError(socket, 'ROOM_NOT_FOUND', 'Room not found.'); return; }
  if (room.hostUserId !== playerId) {
    emitError(socket, 'NOT_HOST', 'Only the room host can add bots.');
    return;
  }
  if (room.status !== 'lobby') {
    emitError(socket, 'GAME_ALREADY_STARTED', 'Cannot add bots after the game starts.');
    return;
  }
  if (room.players.length >= room.maxPlayers) {
    emitError(socket, 'ROOM_FULL', 'Room is already full.');
    return;
  }

  const difficulty: BotDifficulty = opts?.difficulty ?? 'easy';
  await addBotToRoom(room, difficulty);
  broadcastRoomUpdate(io, room);
  console.log(`[room] Bot added to ${room.roomId} (difficulty: ${difficulty})`);
}

export async function handleRoomRemoveBot(
  socket: CalashSocket,
  io: CalashServer,
  botUserId: string,
): Promise<void> {
  const { playerId, roomId } = socket.data;
  if (!roomId) { emitError(socket, 'NOT_IN_ROOM', 'You are not in a room.'); return; }
  const room = roomStore.get(roomId);
  if (!room) { emitError(socket, 'ROOM_NOT_FOUND', 'Room not found.'); return; }
  if (room.hostUserId !== playerId) {
    emitError(socket, 'NOT_HOST', 'Only the room host can remove bots.');
    return;
  }
  if (room.status !== 'lobby') {
    emitError(socket, 'GAME_ALREADY_STARTED', 'Cannot remove bots after the game starts.');
    return;
  }
  const target = room.players.find((p) => p.userId === botUserId);
  if (!target || !target.isBot) {
    emitError(socket, 'NOT_A_BOT', 'That player is not a bot.');
    return;
  }

  await db.rooms.removePlayer(room.roomId, botUserId);
  room.players = room.players.filter((p) => p.userId !== botUserId);
  // Re-seat remaining players to keep seatIndex contiguous.
  room.players.forEach((p, idx) => { p.seatIndex = idx; });
  roomStore.untrackUser(botUserId);

  broadcastRoomUpdate(io, room);
  console.log(`[room] Bot ${botUserId} removed from ${room.roomId}`);
}

// ─── room:join (shared logic for both by-id and by-code) ─────────────────────

async function joinRoom(
  socket: CalashSocket,
  io: CalashServer,
  room: RoomState,
): Promise<void> {
  const { playerId, displayName } = socket.data;

  // If player is already in this room (reconnect), just restore.
  const existing = room.players.find((p) => p.userId === playerId);
  if (existing) {
    roomStore.updateSocket(room.roomId, playerId, socket.id);
    socket.data.roomId = room.roomId;
    await socket.join(room.roomId);
    socket.emit('room:updated', toGameRoom(room));

    if (room.round) {
      const { toRoundStateView } = await import('@calash/game-core');
      socket.emit('game:state', toRoundStateView(room.round.state));
      const ps = room.round.state.playerStates[playerId];
      if (ps) socket.emit('game:hand', ps.hand);
    }
    console.log(`[room] ${playerId} rejoined room ${room.roomId}`);
    return;
  }

  if (room.status !== 'lobby') {
    socket.emit('room:error', { code: 'GAME_IN_PROGRESS', message: 'This room has already started.' });
    return;
  }

  const activePlayers = room.players.filter((p) => p.socketId !== null || true);
  if (activePlayers.length >= room.maxPlayers) {
    socket.emit('room:error', { code: 'ROOM_FULL', message: 'This room is full.' });
    return;
  }

  const seatIndex = room.players.length;
  await db.rooms.addPlayer(room.roomId, playerId);

  const slot = { userId: playerId, seatIndex, isReady: false, socketId: socket.id, displayName: displayName ?? playerId, isBot: false };
  room.players.push(slot);
  roomStore.trackUser(playerId, room.roomId);

  socket.data.roomId = room.roomId;
  await socket.join(room.roomId);

  broadcastRoomUpdate(io, room);
  console.log(`[room] ${playerId} joined room ${room.roomId}`);
}

export async function handleRoomJoin(
  socket: CalashSocket,
  io: CalashServer,
  roomId: string,
): Promise<void> {
  const { playerId: _playerId } = socket.data;

  if (socket.data.roomId && socket.data.roomId !== roomId) {
    emitError(socket, 'ALREADY_IN_ROOM', 'Leave your current room first.');
    return;
  }

  let room = roomStore.get(roomId);
  if (!room) {
    const dbRoom = await db.rooms.findWithPlayers(roomId);
    if (!dbRoom) {
      emitError(socket, 'ROOM_NOT_FOUND', 'Room not found.');
      return;
    }

    room = {
      roomId: dbRoom.id,
      inviteCode: (dbRoom as typeof dbRoom & { invite_code?: string }).invite_code ?? '',
      hostUserId: dbRoom.host_user_id,
      status: dbRoom.status === 'in_progress' ? 'in-progress' : dbRoom.status === 'finished' ? 'finished' : 'lobby',
      maxPlayers: dbRoom.max_players,
      players: await (async () => {
        const meta = await fetchUserMeta(dbRoom.players.map((p) => p.user_id));
        return dbRoom.players.filter((p) => p.left_at === null).map((p) => {
          const m = meta.get(p.user_id);
          return {
            userId: p.user_id,
            seatIndex: p.seat_index,
            isReady: (p as typeof p & { is_ready?: boolean }).is_ready ?? false,
            socketId: null,
            displayName: m?.displayName ?? p.user_id,
            isBot: m?.isBot ?? false,
            ...(m?.isBot ? { botDifficulty: 'easy' as BotDifficulty } : {}),
          };
        });
      })(),
      round: null,
    };
    roomStore.set(room);
  }

  await joinRoom(socket, io, room);
}

export async function handleRoomJoinByCode(
  socket: CalashSocket,
  io: CalashServer,
  code: string,
): Promise<void> {
  const { playerId: _playerId } = socket.data;
  const normalised = code.trim().toUpperCase();

  if (socket.data.roomId) {
    const existing = roomStore.get(socket.data.roomId);
    if (existing && existing.inviteCode === normalised) {
      // Already in the room with this code — treat as reconnect.
      await joinRoom(socket, io, existing);
      return;
    }
    emitError(socket, 'ALREADY_IN_ROOM', 'Leave your current room first.');
    return;
  }

  let room = roomStore.getByCode(normalised);
  if (!room) {
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM game_rooms WHERE invite_code = $1', [normalised]);
    if (!rows[0]) {
      emitError(socket, 'ROOM_NOT_FOUND', `No room with code ${normalised}.`);
      return;
    }
    await handleRoomJoin(socket, io, rows[0].id);
    return;
  }

  await joinRoom(socket, io, room);
}

// ─── room:leave ──────────────────────────────────────────────────────────────

export async function handleRoomLeave(
  socket: CalashSocket,
  io: CalashServer,
): Promise<void> {
  const { playerId, roomId } = socket.data;
  if (!roomId) return;

  const room = roomStore.get(roomId);
  if (!room) return;

  if (room.status === 'in-progress') {
    emitError(socket, 'CANNOT_LEAVE', 'You cannot leave during an active game.');
    return;
  }

  await db.rooms.removePlayer(roomId, playerId);

  room.players = room.players.filter((p) => p.userId !== playerId);
  roomStore.untrackUser(playerId);
  socket.data.roomId = undefined;
  await socket.leave(roomId);

  // If only bots remain, abandon the room — bots can't run a game alone.
  const remainingHumans = room.players.filter((p) => !p.isBot);
  if (remainingHumans.length === 0) {
    for (const bot of room.players) {
      await db.rooms.removePlayer(roomId, bot.userId).catch(() => {});
      roomStore.untrackUser(bot.userId);
    }
    room.players = [];
    await db.rooms.updateStatus(roomId, 'abandoned');
    roomStore.delete(roomId);
    const { cancelBotTimer } = await import('./game.js');
    cancelBotTimer(roomId);
    console.log(`[room] Room ${roomId} abandoned (no humans remaining).`);
    return;
  }

  // Transfer host to the first remaining HUMAN if the host left.
  if (room.hostUserId === playerId) {
    room.hostUserId = remainingHumans[0].userId;
  }

  broadcastRoomUpdate(io, room);
  console.log(`[room] ${playerId} left room ${roomId}`);
}

// ─── room:ready ──────────────────────────────────────────────────────────────

export async function handleRoomReady(
  socket: CalashSocket,
  io: CalashServer,
): Promise<void> {
  const { playerId, roomId } = socket.data;
  if (!roomId) { emitError(socket, 'NOT_IN_ROOM', 'You are not in a room.'); return; }

  const room = roomStore.get(roomId);
  if (!room) { emitError(socket, 'ROOM_NOT_FOUND', 'Room not found.'); return; }

  if (room.status !== 'lobby') {
    emitError(socket, 'GAME_ALREADY_STARTED', 'The game has already started.');
    return;
  }

  const player = room.players.find((p) => p.userId === playerId);
  if (!player) { emitError(socket, 'NOT_IN_ROOM', 'You are not in this room.'); return; }

  player.isReady = !player.isReady;

  // Persist ready state.
  await pool.query(
    'UPDATE game_room_players SET is_ready = $1 WHERE room_id = $2 AND user_id = $3',
    [player.isReady, roomId, playerId],
  );

  broadcastRoomUpdate(io, room);

  // Start game when all players are ready and player count is valid.
  const count = room.players.length;
  const allReady = room.players.every((p) => p.isReady);
  if (allReady && count >= GAME_CONFIG.MIN_PLAYERS && count <= GAME_CONFIG.MAX_PLAYERS) {
    await startGame(room, io);
  }

  console.log(`[room] ${playerId} ready=${player.isReady} in room ${roomId}`);
}

// ─── handle disconnect ───────────────────────────────────────────────────────

export function handleDisconnect(
  socket: CalashSocket,
  io: CalashServer,
): void {
  const { playerId, roomId } = socket.data;
  if (!roomId) return;

  roomStore.updateSocket(roomId, playerId, null);

  const room = roomStore.get(roomId);
  if (!room) return;

  // In lobby: broadcast updated connection status.
  if (room.status === 'lobby') {
    broadcastRoomUpdate(io, room);
  }
  // In-game: keep state; client can reconnect and resume.

  console.log(`[room] ${playerId} disconnected from room ${roomId}`);
}

// ─── Game start ──────────────────────────────────────────────────────────────

async function startGame(room: RoomState, io: CalashServer): Promise<void> {
  const { initRound, toRoundStateView } = await import('@calash/game-core');

  const playerIds = room.players.map((p) => p.userId);

  // Honor pre-existing round state when present (this is a follow-on round
  // after handleRoundEnd advanced dealer + roundNumber). On first call,
  // start at round 1 with dealerIndex 0 and zeroed cumulative scores.
  const previous = room.round;
  const roundNumber = previous ? previous.roundNumber : 1;
  const dealerIndex = previous ? previous.dealerIndex : 0;
  const cumulativeScores = previous
    ? previous.cumulativeScores
    : Object.fromEntries(playerIds.map((id) => [id, 0]));
  const roundScores = previous
    ? previous.roundScores
    : Object.fromEntries(playerIds.map((id) => [id, []]));

  // initRound builds a fresh deck/hand/discard for THIS round. All
  // round-only state (hands, melds, hasGoneDown, didTakeFromDiscardThisTurn,
  // discard pile, hidden deck, table totals) is reinitialized here.
  const roundState = initRound({ playerIds, roundNumber, dealerIndex });

  const roundRow = await db.rounds.create({
    roomId: room.roomId,
    roundNumber,
    dealerUserId: playerIds[dealerIndex],
    turnOrder: roundState.playerOrder as string[],
    firstTurnUserId: roundState.currentTurnPlayerId,
    hiddenDeck: [...roundState.hiddenDeck],
    discardPile: [...roundState.discardPile],
    hands: playerIds.map((uid) => ({
      userId: uid,
      cards: [...roundState.playerStates[uid].hand],
    })),
  });

  room.status = 'in-progress';
  room.round = {
    roundId: roundRow.id,
    roundNumber,
    dealerIndex,
    state: roundState,
    cumulativeScores,
    roundScores,
  };

  io.to(room.roomId).emit('room:updated', toGameRoom(room));
  io.to(room.roomId).emit('game:state', toRoundStateView(roundState));

  // Send each player their private hand. Bots have no socket — they read their
  // hand from room.round.state.playerStates directly.
  for (const player of room.players) {
    if (player.isBot || !player.socketId) continue;
    const hand = roundState.playerStates[player.userId]?.hand ?? [];
    io.to(player.socketId).emit('game:hand', hand);
  }

  console.log(`[room] Game started in room ${room.roomId}`);

  // If the first turn belongs to a bot, kick off the driver.
  // Lazy import avoids a circular module load with game.ts.
  const { scheduleBotIfNeeded } = await import('./game.js');
  scheduleBotIfNeeded(room.roomId, io);
}

// Export startGame for use in game handler (new round after round ends).
export { startGame, toGameRoom, broadcastRoomUpdate };
