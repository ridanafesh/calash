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
import { roomStore, generateInviteCode, type PlayerSlot, type RoomState } from '../../store/index.js';
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

function broadcastRoomUpdate(io: CalashServer, room: RoomState): void {
  io.to(room.roomId).emit('room:updated', toGameRoom(room));
}

function emitError(socket: CalashSocket, code: string, message: string): void {
  socket.emit('room:error', { code, message });
}

/**
 * Structured log line for room lifecycle events. Single-line JSON so log
 * collectors (Render's log viewer included) can pick fields out without
 * regexing pino's pretty output. The leading `[room]` prefix preserves
 * the previous `console.log` format for any tooling that grepped on it.
 */
function logRoom(
  event: string,
  fields: {
    action?: 'join' | 'rejoin' | 'leave' | 'reconnect' | 'close' | 'create' | 'kick';
    roomId?: string;
    roomCode?: string;
    userId?: string;
    seatIndex?: number;
    status?: RoomState['status'];
    activePlayerCount?: number;
    [k: string]: unknown;
  },
): void {
  const parts: string[] = [`[room] event=${event}`];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    parts.push(`${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`);
  }
  console.log(parts.join(' '));
}

/**
 * Flip a seat into bot-driven mode without removing it from the round.
 *
 * Why this shape works: RoundState keys EVERYTHING by user id (playerOrder,
 * playerStates, currentTurnPlayerId, melds, ownerships). If we tried to
 * substitute a different user id when a human leaves mid-game we'd have to
 * rewrite all of those plus several DB rows that FK back to users(id).
 * Instead we keep the seat's user id intact (the original human's) and
 * just toggle isBot. The bot driver in handlers/game.ts keys off slot.isBot
 * — the moment we set it, the same scheduleBotIfNeeded loop will start
 * playing this seat's turns when they come up. Hand / melds / score /
 * turn-state stay tied to the user id and survive untouched.
 *
 * On rejoin we flip isBot back to false, reattach the socket, and the
 * human takes over from whatever state the bot reached. No round-state
 * mutation needed; the reconnect flow already pushes the current
 * game:state + game:hand to the rejoining player.
 *
 * Returns true if the seat was actually flipped (was a human), false if
 * it was already a bot (idempotent — safe to call from disconnect handlers).
 */
export function substituteSeatWithBot(slot: PlayerSlot, opts: { difficulty?: BotDifficulty } = {}): boolean {
  if (slot.isBot) return false;
  slot.isBot = true;
  slot.botDifficulty = opts.difficulty ?? 'easy';
  // Drop the human's socket binding — bots never have a socket. The
  // sendDrawnCardPrivately + game:hand emits already gate on
  // !slot.isBot && slot.socketId, so any stale socket reference would
  // be a no-op anyway, but cleaning it up keeps the model consistent.
  slot.socketId = null;
  // Mark ready so any waiting-room state stays consistent (bots are
  // always ready). The room is in-progress when we hit this path, so
  // this is mostly defensive in case a player leaves the millisecond
  // before startGame completes.
  slot.isReady = true;
  return true;
}

/**
 * Reverse of substituteSeatWithBot — the original human is back. We
 * re-flag the seat as human and reattach the live socket. Bot turns
 * already played in the interim are kept as-is in the round state;
 * the rejoining client's first game:state push will reflect them.
 */
export function reclaimSeatFromBot(slot: PlayerSlot, socketId: string, displayName: string): void {
  slot.isBot = false;
  slot.botDifficulty = undefined;
  slot.socketId = socketId;
  // Don't touch isReady — the round is in-progress, ready state is
  // moot. If the room ever returns to lobby (next round) the normal
  // ready toggle handles it.
  void displayName; // displayName is set on initial join; preserved through substitute/reclaim.
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
      isPrivate: (full as typeof full & { is_private?: boolean }).is_private ?? false,
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
            isWaiting: (p as typeof p & { is_waiting?: boolean }).is_waiting ?? false,
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

    // If the reconnecting player is the one who has a pending drawn-card
    // decision, restore their private preview. Send null otherwise so any
    // stale client-side preview is cleared on reconnect.
    const pendingForMe =
      state.currentTurnPlayerId === playerId && state.pendingDrawnCard
        ? state.pendingDrawnCard
        : null;
    socket.emit('game:drawn-card', pendingForMe);
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

  const { maxPlayers, fillWithBots, botDifficulty, isPrivate = false } = options;
  if (maxPlayers < GAME_CONFIG.MIN_PLAYERS || maxPlayers > GAME_CONFIG.MAX_PLAYERS) {
    emitError(socket, 'INVALID_MAX_PLAYERS', `maxPlayers must be ${GAME_CONFIG.MIN_PLAYERS}–${GAME_CONFIG.MAX_PLAYERS}`);
    return;
  }

  const inviteCode = generateInviteCode();

  // Persist room to DB (includes host as seat 0).
  const dbRoom = await db.rooms.create({
    hostUserId: playerId,
    maxPlayers,
    settings: { inviteCode, isPrivate },
  });

  // Persist invite code + privacy via raw query (the migrations add the columns).
  await pool.query(
    'UPDATE game_rooms SET invite_code = $1, is_private = $2 WHERE id = $3',
    [inviteCode, isPrivate, dbRoom.id],
  );

  const room: RoomState = {
    roomId: dbRoom.id,
    inviteCode,
    isPrivate,
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
  opts: { code?: string; choice?: import('@calash/shared').RoomJoinChoice } = {},
): Promise<void> {
  const { playerId, displayName } = socket.data;

  // ── Reconnect / reclaim path ─────────────────────────────────────────
  // Player already has a slot in this room. Two sub-cases:
  //   - existing.isBot === false: ordinary reconnect (refresh / dropped
  //     socket / second tab). Update the socket, push state, done.
  //   - existing.isBot === true: the seat was substituted because this
  //     player previously left mid-game. Flip it back to a human seat
  //     and cancel any pending bot timer.
  const existing = room.players.find((p) => p.userId === playerId);
  if (existing) {
    const wasBotSubstitute = existing.isBot;
    if (wasBotSubstitute) {
      reclaimSeatFromBot(existing, socket.id, displayName ?? existing.displayName);
      const { cancelBotTimer } = await import('./game.js');
      cancelBotTimer(room.roomId);
    } else {
      roomStore.updateSocket(room.roomId, playerId, socket.id);
    }
    socket.data.roomId = room.roomId;
    await socket.join(room.roomId);
    socket.emit('room:updated', toGameRoom(room));
    if (wasBotSubstitute) broadcastRoomUpdate(io, room);

    if (room.round) {
      const { toRoundStateView } = await import('@calash/game-core');
      socket.emit('game:state', toRoundStateView(room.round.state));
      const ps = room.round.state.playerStates[playerId];
      if (ps) socket.emit('game:hand', ps.hand);
    }
    logRoom(wasBotSubstitute ? 'reclaim' : 'reconnect', {
      action: wasBotSubstitute ? 'rejoin' : 'reconnect',
      roomId: room.roomId,
      roomCode: room.inviteCode,
      userId: playerId,
      seatIndex: existing.seatIndex,
      status: room.status,
      activePlayerCount: room.players.length,
      reclaimedFromBot: wasBotSubstitute,
    });
    return;
  }

  // ── Locked-room code gating ──────────────────────────────────────────
  // Only checked for fresh joins (not reconnects). Open rooms ignore the
  // code entirely. The case-insensitive comparison matches how invite
  // codes are stored (always uppercase).
  if (room.isPrivate) {
    const supplied = (opts.code ?? '').trim().toUpperCase();
    if (supplied !== room.inviteCode.toUpperCase()) {
      logRoom('join-rejected', {
        roomId: room.roomId,
        userId: playerId,
        reason: supplied === '' ? 'CODE_REQUIRED' : 'INVALID_CODE',
      });
      socket.emit('room:error', {
        code: supplied === '' ? 'CODE_REQUIRED' : 'INVALID_CODE',
        message: supplied === ''
          ? 'This is a locked room. Enter the room code to join.'
          : 'The room code is incorrect.',
      });
      return;
    }
  }

  // ── Compute seat options ─────────────────────────────────────────────
  // - Replaceable bots: bots that are NOT human-substitutes (host-created
  //   bots only — leave/rejoin reclaim still works because human
  //   substitutes stay reserved for their original human).
  // - Empty seats: max - count of OCCUPIED slots (waiting players also
  //   hold a seat, so they count as occupied).
  const replaceableBots = room.players.filter((p) => p.isBot && !p.isHumanSubstitute);
  const occupiedSeatCount = room.players.length;
  const hasEmptySeat = occupiedSeatCount < room.maxPlayers;
  const roundInProgress = room.status === 'in-progress';

  // No seat available at all: hard failure.
  if (!hasEmptySeat && replaceableBots.length === 0) {
    logRoom('join-rejected', {
      roomId: room.roomId,
      userId: playerId,
      reason: 'ROOM_FULL',
      status: room.status,
    });
    socket.emit('room:error', { code: 'ROOM_FULL', message: 'This room is full.' });
    return;
  }

  // Both options exist + caller didn't pick → ask. Only ask once per
  // join; on resubmit the choice arrives in opts.choice.
  if (hasEmptySeat && replaceableBots.length > 0 && !opts.choice) {
    socket.emit('room:join-options', {
      roomId: room.roomId,
      replaceableBots: replaceableBots.map((b) => ({
        userId: b.userId,
        displayName: b.displayName,
        seatIndex: b.seatIndex,
      })),
      hasEmptySeat: true,
      roundInProgress,
    });
    logRoom('join-needs-choice', {
      roomId: room.roomId,
      userId: playerId,
      replaceableBotCount: replaceableBots.length,
      roundInProgress,
    });
    return;
  }

  // Determine the path:
  //   - 'replace-bot' explicitly chosen, or only bots are available.
  //   - 'empty-seat' explicitly chosen, or only empty seats are available.
  let path: 'replace-bot' | 'empty-seat';
  if (opts.choice?.kind === 'replace-bot' || (replaceableBots.length > 0 && !hasEmptySeat)) {
    path = 'replace-bot';
  } else {
    path = 'empty-seat';
  }

  if (path === 'replace-bot') {
    // Pick the targeted bot (validated to still be a replaceable bot)
    // or the first replaceable bot if no specific one was named.
    const requestedId = opts.choice?.kind === 'replace-bot' ? opts.choice.botUserId : null;
    const target = requestedId
      ? replaceableBots.find((b) => b.userId === requestedId)
      : replaceableBots[0];
    if (!target) {
      socket.emit('room:error', {
        code: 'BOT_NOT_AVAILABLE',
        message: 'That bot seat is no longer available.',
      });
      return;
    }
    await replaceBotWithHuman(room, target, {
      humanUserId: playerId,
      socketId: socket.id,
      displayName: displayName ?? playerId,
    });
    socket.data.roomId = room.roomId;
    await socket.join(room.roomId);
    roomStore.trackUser(playerId, room.roomId);

    socket.emit('room:updated', toGameRoom(room));
    if (room.round) {
      const { toRoundStateView } = await import('@calash/game-core');
      socket.emit('game:state', toRoundStateView(room.round.state));
      const ps = room.round.state.playerStates[playerId];
      if (ps) socket.emit('game:hand', ps.hand);
    }
    broadcastRoomUpdate(io, room);
    // The bot driver might have a pending turn for this seat — cancel
    // so the now-human seat can act first.
    const { cancelBotTimer } = await import('./game.js');
    cancelBotTimer(room.roomId);

    logRoom('replace-bot', {
      action: 'join',
      roomId: room.roomId,
      roomCode: room.inviteCode,
      userId: playerId,
      replacedBotId: target.userId,
      seatIndex: target.seatIndex,
      status: room.status,
      activePlayerCount: room.players.length,
    });
    return;
  }

  // path === 'empty-seat': ordinary join into an empty seat. If the
  // room is mid-round we mark this slot as 'isWaiting' — they don't
  // appear in the current RoundState; startGame's next call (round
  // transition) will pick them up.
  const { row: dbRow, kind } = await db.rooms.addPlayer(room.roomId, playerId);
  const seatIndex = dbRow.seat_index;
  const isWaiting = roundInProgress;

  // Persist the waiting flag so the round-end DB rebuild path keeps it.
  if (isWaiting) {
    await pool.query(
      'UPDATE game_room_players SET is_waiting = true WHERE room_id = $1 AND user_id = $2',
      [room.roomId, playerId],
    );
  }

  const slot: PlayerSlot = {
    userId: playerId,
    seatIndex,
    isReady: false,
    socketId: socket.id,
    displayName: displayName ?? playerId,
    isBot: false,
    isWaiting,
  };
  room.players.push(slot);
  roomStore.trackUser(playerId, room.roomId);

  socket.data.roomId = room.roomId;
  await socket.join(room.roomId);

  socket.emit('room:updated', toGameRoom(room));
  if (room.round && !isWaiting) {
    // Edge case: room is in-progress but the slot is NOT waiting (means
    // we somehow joined a non-mid-round room? shouldn't happen, but
    // defensive — push state if there is a round.)
    const { toRoundStateView } = await import('@calash/game-core');
    socket.emit('game:state', toRoundStateView(room.round.state));
  } else if (room.round && isWaiting) {
    // Waiting players SEE the public round view but get no hand.
    const { toRoundStateView } = await import('@calash/game-core');
    socket.emit('game:state', toRoundStateView(room.round.state));
  }
  broadcastRoomUpdate(io, room);

  logRoom(isWaiting ? 'join-waiting' : (kind === 'reactivated' ? 'rejoin' : 'join'), {
    action: kind === 'reactivated' ? 'rejoin' : 'join',
    roomId: room.roomId,
    roomCode: room.inviteCode,
    userId: playerId,
    seatIndex,
    status: room.status,
    activePlayerCount: room.players.length,
    waiting: isWaiting,
  });
}

/**
 * Replace a host-created bot with a joining human.
 *
 * Strategy: rewrite the bot's user_id in the in-memory PlayerSlot to
 * the human's id, then rewrite the round state's user-id-keyed maps
 * (playerOrder, playerStates, currentTurnPlayerId, hand record) and
 * the persisted hand row. Audit history (game_moves, game_meld_cards
 * .added_by_user_id, game_scores) keeps the bot's id — those rows
 * reflect what actually happened, which was the bot acting.
 *
 * The DB game_room_players row is updated in place (user_id changed,
 * is_ready left as-is). The bot's user record stays in the users table
 * (FKed by audit history); it just stops being referenced as a player.
 */
async function replaceBotWithHuman(
  room: RoomState,
  botSlot: PlayerSlot,
  human: { humanUserId: string; socketId: string; displayName: string },
): Promise<void> {
  const oldUserId = botSlot.userId;
  const newUserId = human.humanUserId;

  // 1. Round state rewrite — only meaningful when there's an active round.
  if (room.round) {
    const state = room.round.state;
    const newPlayerOrder = state.playerOrder.map((id) => (id === oldUserId ? newUserId : id));
    const newPlayerStates = { ...state.playerStates } as typeof state.playerStates;
    if (newPlayerStates[oldUserId]) {
      newPlayerStates[newUserId] = { ...newPlayerStates[oldUserId], playerId: newUserId };
      delete newPlayerStates[oldUserId];
    }
    room.round.state = {
      ...state,
      playerOrder: newPlayerOrder,
      playerStates: newPlayerStates,
      currentTurnPlayerId: state.currentTurnPlayerId === oldUserId ? newUserId : state.currentTurnPlayerId,
    };
    // Rewrite cumulative + per-round score maps to use the new id.
    if (oldUserId in room.round.cumulativeScores) {
      room.round.cumulativeScores[newUserId] = room.round.cumulativeScores[oldUserId];
      delete room.round.cumulativeScores[oldUserId];
    }
    if (oldUserId in room.round.roundScores) {
      room.round.roundScores[newUserId] = room.round.roundScores[oldUserId];
      delete room.round.roundScores[oldUserId];
    }

    // Persist the hand row's user_id swap so reconnects from DB land
    // on the right hand. game_moves / game_meld_cards are audit logs
    // and are intentionally NOT rewritten — they reflect what the bot
    // actually did.
    await pool.query(
      `UPDATE game_round_hands SET user_id = $1
       WHERE round_id = $2 AND user_id = $3`,
      [newUserId, room.round.roundId, oldUserId],
    );
  }

  // 2. Slot rewrite: the same array index keeps its seatIndex; we just
  //    flip the occupant. user_id changes, isBot=false, socket attached.
  botSlot.userId = newUserId;
  botSlot.isBot = false;
  botSlot.botDifficulty = undefined;
  botSlot.isHumanSubstitute = false;
  botSlot.socketId = human.socketId;
  botSlot.displayName = human.displayName;

  // 3. DB game_room_players row: swap user_id so future restores see
  //    the human, not the bot. Mark as not waiting (this is an active seat).
  await pool.query(
    `UPDATE game_room_players
     SET user_id = $1, is_waiting = false, left_at = NULL
     WHERE room_id = $2 AND user_id = $3`,
    [newUserId, room.roomId, oldUserId],
  );

  // 4. roomStore user-index: the bot was tracked under its id; untrack it.
  roomStore.untrackUser(oldUserId);
}

export async function handleRoomJoin(
  socket: CalashSocket,
  io: CalashServer,
  roomId: string,
  code?: string,
  choice?: import('@calash/shared').RoomJoinChoice,
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
      isPrivate: (dbRoom as typeof dbRoom & { is_private?: boolean }).is_private ?? false,
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
            isWaiting: (p as typeof p & { is_waiting?: boolean }).is_waiting ?? false,
          };
        });
      })(),
      round: null,
    };
    roomStore.set(room);
  }

  await joinRoom(socket, io, room, { code, choice });
}

export async function handleRoomJoinByCode(
  socket: CalashSocket,
  io: CalashServer,
  code: string,
  choice?: import('@calash/shared').RoomJoinChoice,
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
    // Forward both the code (proves access for locked rooms) and the choice.
    await handleRoomJoin(socket, io, rows[0].id, normalised, choice);
    return;
  }

  // The supplied invite code already satisfies any privacy gate.
  await joinRoom(socket, io, room, { code: normalised, choice });
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

  // ── Mid-game leave: substitute the seat with a bot ──────────────────────
  // The seat keeps its user id (the original human's) and stays in the
  // round. Hand, melds, score, turn-state all survive intact — the bot
  // driver picks up the same seat next time it's that user id's turn.
  // The user's `game_room_players` row stays open with left_at = NULL so
  // they can rejoin and reclaim. socket.data.roomId is cleared and the
  // socket leaves the channel; the human's UI navigates back to the lobby.
  if (room.status === 'in-progress') {
    const slot = room.players.find((p) => p.userId === playerId);
    if (slot && !slot.isBot) {
      const flipped = substituteSeatWithBot(slot);
      socket.data.roomId = undefined;
      await socket.leave(roomId);
      broadcastRoomUpdate(io, room);

      // If it's currently this seat's turn, kick the bot driver so the
      // game continues without waiting for the human's next action.
      if (room.round && room.round.state.currentTurnPlayerId === playerId) {
        const { scheduleBotIfNeeded } = await import('./game.js');
        scheduleBotIfNeeded(roomId, io);
      }

      logRoom('leave-substitute', {
        action: 'leave',
        roomId,
        roomCode: room.inviteCode,
        userId: playerId,
        seatIndex: slot.seatIndex,
        status: room.status,
        activePlayerCount: room.players.length,
        flipped,
        substitutedTurn: room.round?.state.currentTurnPlayerId === playerId,
      });
      return;
    }
    // Slot not found OR already a bot somehow — fall through to the
    // standard leave path. (Bots leaving mid-game shouldn't happen since
    // bots only "leave" via removeBot in the lobby.)
  }

  // ── Lobby / finished-state leave: full removal ──────────────────────────
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
    logRoom('close', {
      action: 'close',
      roomId,
      roomCode: room.inviteCode,
      userId: playerId,
      reason: 'no-humans-remaining',
      activePlayerCount: 0,
    });
    return;
  }

  // Transfer host to the first remaining HUMAN if the host left.
  if (room.hostUserId === playerId) {
    room.hostUserId = remainingHumans[0].userId;
  }

  broadcastRoomUpdate(io, room);
  logRoom('leave', {
    action: 'leave',
    roomId,
    roomCode: room.inviteCode,
    userId: playerId,
    status: room.status,
    activePlayerCount: room.players.length,
  });
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
  // In-game: keep the seat state intact. The socket has dropped (could
  // be a blip, page refresh, second tab, or full-on disconnect) — the
  // bot driver only acts on slots where isBot === true, so an
  // unsubstituted seat just waits for reconnect. Deliberate "Leave"
  // through the UI takes the substitution path in handleRoomLeave; raw
  // socket drops do NOT auto-substitute, on the grounds that a brief
  // blip shouldn't surrender the player's hand to a bot. If a future
  // requirement wants timeout-based substitution after N seconds of
  // silence, do it here with a setTimeout that calls
  // substituteSeatWithBot when the timer fires AND the slot is still
  // socketId === null AND still isBot === false.
  logRoom('disconnect', {
    action: 'leave',
    roomId,
    roomCode: room.inviteCode,
    userId: playerId,
    status: room.status,
  });
}

// ─── Game start ──────────────────────────────────────────────────────────────

async function startGame(room: RoomState, io: CalashServer): Promise<void> {
  const { initRound, toRoundStateView } = await import('@calash/game-core');

  // Round-transition + first-game inclusion logic.
  //
  // Players who joined a fresh empty seat WHILE the previous round was
  // running are flagged isWaiting=true. They held their seat but didn't
  // play that round. As soon as we start the next round we:
  //   1. Include them in playerIds (deal them cards).
  //   2. Clear their isWaiting flag — they're now an active player.
  //   3. Clear is_waiting in the DB so the next reconnect sees them
  //      as fully active.
  // Their cumulativeScores entry starts at 0 (they didn't play prior
  // rounds, so we don't fabricate history).
  const waitingIds: string[] = [];
  for (const p of room.players) {
    if (p.isWaiting) {
      p.isWaiting = false;
      waitingIds.push(p.userId);
    }
  }
  if (waitingIds.length > 0) {
    await pool.query(
      `UPDATE game_room_players SET is_waiting = false
       WHERE room_id = $1 AND user_id = ANY($2::uuid[])`,
      [room.roomId, waitingIds],
    );
  }

  const playerIds = room.players.map((p) => p.userId);

  // Honor pre-existing round state when present (this is a follow-on round
  // after handleRoundEnd advanced dealer + roundNumber). On first call,
  // start at round 1 with dealerIndex 0 and zeroed cumulative scores.
  const previous = room.round;
  const roundNumber = previous ? previous.roundNumber : 1;
  const dealerIndex = previous ? previous.dealerIndex : 0;
  // For previously-waiting players, ensure they have a 0 entry in the
  // cumulative + per-round score maps (they're new this round).
  const cumulativeScores = previous
    ? { ...previous.cumulativeScores }
    : Object.fromEntries(playerIds.map((id) => [id, 0]));
  const roundScores = previous
    ? { ...previous.roundScores }
    : Object.fromEntries(playerIds.map((id) => [id, []]));
  for (const id of waitingIds) {
    if (!(id in cumulativeScores)) cumulativeScores[id] = 0;
    if (!(id in roundScores)) roundScores[id] = [];
  }

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
