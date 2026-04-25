import { randomUUID } from 'crypto';
import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  TurnAction,
  GameScore,
} from '@calash/shared';
import { GAME_CONFIG } from '@calash/shared';

import { pool } from '../../db/index.js';
import { createDatabaseService } from '../../db/repositories/index.js';
import { roomStore, type RoomState } from '../../store/index.js';
import { decideBotAction } from '../../services/bot.service.js';
import { startGame, toGameRoom, broadcastRoomUpdate } from './room.js';

type CalashSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type CalashServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const db = createDatabaseService(pool);

// ─── Turn-phase mapping DB ↔ game-core ────────────────────────────────────────

type DbTurnPhase = 'awaiting_draw_or_take' | 'holding' | 'complete';

function mapTurnPhaseToDb(phase: string): DbTurnPhase {
  return phase.replace(/-/g, '_') as DbTurnPhase;
}

/**
 * Map a pg / DB error into a user-facing message. We deliberately do not
 * leak internal SQL, but we do surface the common mistake cases so the
 * player gets an actionable banner instead of "Internal server error".
 */
function friendlyPersistenceError(err: unknown, actionType: string): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: string }).code;
    // Postgres "invalid text representation" (22P02) — e.g. bad UUID. This
    // was the original smoking gun: the engine generated base36 ids while
    // the DB column is UUID. Keep the message stable for the UI banner.
    if (code === '22P02') {
      return `Could not save your ${actionType} action — server state mismatch. Try refreshing the page.`;
    }
    // Foreign key violation: referenced meld/round/user no longer exists.
    if (code === '23503') {
      return `Could not save your ${actionType} action — referenced record no longer exists.`;
    }
  }
  if (err instanceof Error && err.message.startsWith('Meld ') && err.message.endsWith(' not found')) {
    return err.message;
  }
  return `Could not save your ${actionType} action. Please try again.`;
}

// ─── game:action ──────────────────────────────────────────────────────────────

export async function handleGameAction(
  socket: CalashSocket,
  io: CalashServer,
  action: TurnAction,
): Promise<void> {
  const { playerId, roomId } = socket.data;

  if (!roomId) {
    socket.emit('room:error', { code: 'NOT_IN_ROOM', message: 'You are not in a room.' });
    return;
  }

  const room = roomStore.get(roomId);
  if (!room || !room.round) {
    socket.emit('room:error', { code: 'NO_ACTIVE_GAME', message: 'No active game in this room.' });
    return;
  }

  // Reject if a bot tries to come through this entry point — bot actions are
  // only ever invoked via the internal driver, never from a socket.
  const slot = room.players.find((p) => p.userId === playerId);
  if (slot?.isBot) {
    socket.emit('room:error', { code: 'BOT_ACTION', message: 'Bot actions cannot be submitted manually.' });
    return;
  }

  const result = await applyPlayerAction(room, playerId, action, io);
  if (!result.ok) {
    socket.emit('room:error', { code: 'INVALID_ACTION', message: result.error });
    return;
  }
  // Send the actor's private hand directly to their socket.
  socket.emit('game:hand', result.handAfter);

  if (result.roundEnded) return; // handleRoundEnd already ran

  // Drive bots if the next turn belongs to one.
  scheduleBotIfNeeded(roomId, io);
}

/**
 * Shared action-apply pipeline used by both human socket handlers and the bot
 * driver. Returns {ok, handAfter, roundEnded} on success or {ok: false, error}
 * on failure. Broadcasts game:state to the whole room and persists everything
 * to the database. Does NOT send game:hand — callers do that with the right
 * target socket (or skip it for bots, who have no socket).
 */
async function applyPlayerAction(
  room: RoomState,
  playerId: string,
  action: TurnAction,
  io: CalashServer,
): Promise<
  | { ok: true; handAfter: import('@calash/shared').Card[]; roundEnded: boolean }
  | { ok: false; error: string }
> {
  if (!room.round) return { ok: false, error: 'No active round.' };
  const { applyTurnAction, toRoundStateView } = await import('@calash/game-core');
  const { roundId, state } = room.round;

  const ps = state.playerStates[playerId];
  if (!ps) return { ok: false, error: 'You are not a participant in this round.' };

  const handBefore = [...ps.hand];
  // Use real UUIDs for meld IDs so the in-memory id matches the DB
  // primary key. Without this, add-to-meld fails because the DB rejects the
  // engine's short base36 ids as invalid UUIDs.
  const result = applyTurnAction(state, playerId, action, () => randomUUID());
  if (!result.ok) {
    console.warn(`[game] Invalid action by ${playerId} in round ${roundId}: ${result.error}`);
    return { ok: false, error: result.error };
  }

  const { state: newState, roundResult } = result;
  const newPs = newState.playerStates[playerId];

  // Persist to DB. If any write fails we leave the in-memory state UNMUTATED
  // (it's still `state`, not `newState`), so the game is consistent — the
  // caller sees the DB error as a validation-style failure instead of the
  // client seeing a generic "Internal server error" with no information.
  try {
    await db.rounds.applyAction({
      roundId,
      userId: playerId,
      action,
      handBefore,
      handAfter: newPs.hand,
      newDeck: newState.hiddenDeck,
      newPile: newState.discardPile,
      newTurnPhase: mapTurnPhaseToDb(newState.turnPhase),
      nextTurnUserId: newState.currentTurnPlayerId,
      didTakeFromDiscard: newState.didTakeFromDiscardThisTurn,
      highestTableTotal: newState.highestTableTotal,
    });

    if (['go-down', 'add-to-meld', 'add-new-meld'].includes(action.type)) {
      await db.rounds.updateHand(roundId, playerId, {
        cards: newPs.hand,
        hasGoneDown: newPs.hasGoneDown,
        tableTotal: newPs.tableTotal,
      });
      await persistMelds(roundId, playerId, action, newPs);
    }
  } catch (err) {
    console.error(`[game] DB persistence failed for ${action.type} by ${playerId} in round ${roundId}:`, err);
    return {
      ok: false,
      error: friendlyPersistenceError(err, action.type),
    };
  }

  room.round.state = newState;
  io.to(room.roomId).emit('game:state', toRoundStateView(newState));

  if (roundResult) {
    await handleRoundEnd(room.roomId, io);
    return { ok: true, handAfter: newPs.hand, roundEnded: true };
  }

  return { ok: true, handAfter: newPs.hand, roundEnded: false };
}

// ─── Bot turn driver ─────────────────────────────────────────────────────────
//
// When the current turn belongs to a bot, schedule one bot action after a short
// "thinking" delay. The bot may need multiple actions to finish its turn (e.g.
// take-from-discard → go-down → discard), so after each bot action we re-check
// and schedule again until the turn passes to a human or the round ends.
//
// Concurrency: one bot timer per room at a time, tracked in a Map. If a timer
// is already pending, scheduleBotIfNeeded is a no-op.

const BOT_THINKING_MS = 1200;
const botTimers = new Map<string, NodeJS.Timeout>();

export function scheduleBotIfNeeded(roomId: string, io: CalashServer): void {
  const room = roomStore.get(roomId);
  if (!room?.round) return;
  if (botTimers.has(roomId)) return; // already scheduled

  const currentTurnPlayerId = room.round.state.currentTurnPlayerId;
  const slot = room.players.find((p) => p.userId === currentTurnPlayerId);
  if (!slot?.isBot) return;

  const timer = setTimeout(() => {
    botTimers.delete(roomId);
    void runBotAction(roomId, io).catch((err) => {
      console.error(`[bot] Failed to run bot action in room ${roomId}:`, err);
    });
  }, BOT_THINKING_MS);
  botTimers.set(roomId, timer);
}

async function runBotAction(roomId: string, io: CalashServer): Promise<void> {
  const room = roomStore.get(roomId);
  if (!room?.round) return;

  const playerId = room.round.state.currentTurnPlayerId;
  const slot = room.players.find((p) => p.userId === playerId);
  if (!slot?.isBot) return; // Turn moved to a human while the timer was pending.

  const difficulty = slot.botDifficulty ?? 'easy';
  let action: TurnAction;
  try {
    action = decideBotAction(difficulty, room.round.state, playerId);
  } catch (err) {
    console.error(`[bot] decideBotAction threw for ${playerId} in ${roomId}:`, err);
    // Fail safe: have the bot draw from the deck so the game doesn't lock up.
    action = { type: 'draw-from-deck' };
  }

  const result = await applyPlayerAction(room, playerId, action, io);
  if (!result.ok) {
    console.error(`[bot] Bot ${playerId} produced invalid action ${action.type}: ${result.error}`);
    // Fail safe: discard the highest-value card to end the turn.
    const ps = room.round?.state.playerStates[playerId];
    if (ps && ps.hand.length > 0 && room.round?.state.turnPhase === 'holding') {
      await applyPlayerAction(room, playerId, { type: 'discard', card: ps.hand[0] }, io);
    }
  }

  // If the round ended, handleRoundEnd reset the round to lobby and scheduled
  // the next round; nothing to schedule from here.
  if (result.ok && result.roundEnded) return;

  // Re-schedule if it's still a bot's turn (same bot or another bot in seat).
  scheduleBotIfNeeded(roomId, io);
}

/**
 * Cancel any pending bot timer for a room. Called when a room is deleted or
 * the game ends so we don't fire timers against stale state.
 */
export function cancelBotTimer(roomId: string): void {
  const t = botTimers.get(roomId);
  if (t) {
    clearTimeout(t);
    botTimers.delete(roomId);
  }
}

// ─── Persist melds to DB ──────────────────────────────────────────────────────

async function persistMelds(
  roundId: string,
  userId: string,
  action: TurnAction,
  ps: import('@calash/shared').PlayerRoundState,
): Promise<void> {
  if (action.type === 'go-down') {
    // Pass the engine-assigned UUIDs so the DB primary key matches the
    // in-memory id. Otherwise subsequent add-to-meld fails with a pg
    // "invalid input syntax for type uuid" error because the ids diverge.
    await db.melds.createMelds({
      roundId,
      ownerUserId: userId,
      melds: ps.melds.map((m) => ({ id: m.id, type: m.type, cards: [...m.cards] })),
      newHand: ps.hand,
      newTableTotal: ps.tableTotal,
    });
  } else if (action.type === 'add-new-meld') {
    const meld = ps.melds[ps.melds.length - 1];
    if (meld) {
      await db.melds.createMelds({
        roundId,
        ownerUserId: userId,
        melds: [{ id: meld.id, type: meld.type, cards: [...meld.cards] }],
        newHand: ps.hand,
        newTableTotal: ps.tableTotal,
      });
    }
  } else if (action.type === 'add-to-meld') {
    await db.melds.addCardsToMeld({
      meldId: action.meldId,
      roundId,
      addedByUserId: userId,
      newCards: [...action.cards],
      newHand: ps.hand,
      newTableTotal: ps.tableTotal,
    });
  }
}

// ─── Round end ────────────────────────────────────────────────────────────────

async function handleRoundEnd(
  roomId: string,
  io: CalashServer,
): Promise<void> {
  const room = roomStore.get(roomId);
  if (!room?.round) return;

  const { state, roundId, roundNumber, dealerIndex, cumulativeScores } = room.round;
  const { computeRoundResult, getWinner } = await import('@calash/game-core');

  const roundResult = computeRoundResult(
    state.playerStates,
    state.playerOrder as string[],
    state.endReason ?? 'deck-exhausted',
    state.finisherPlayerId ?? null,
  );
  roundResult.roundNumber = roundNumber;

  // Record scores in DB.
  const scoresToRecord = roundResult.playerScores.map((ps) => ({
    userId: ps.playerId,
    tableTotal: ps.tableTotal,
    handTotal: ps.handTotal,
    roundScore: ps.roundScore,
    finishBonus: ps.finishedFirst ? GAME_CONFIG.FINISH_BONUS : 0,
    finalScore: ps.finalScore,
  }));

  await db.rounds.finishRound({
    roundId,
    endReason: (state.endReason ?? 'deck-exhausted').replace(/-/g, '_') as 'player_finished' | 'deck_exhausted',
    finisherUserId: state.finisherPlayerId ?? null,
  });

  await db.scores.recordRoundScores({ roundId, roomId, scores: scoresToRecord });

  // Update cumulative and per-round scores in memory.
  const roundScores = room.round.roundScores;
  for (const ps of roundResult.playerScores) {
    cumulativeScores[ps.playerId] = (cumulativeScores[ps.playerId] ?? 0) + ps.finalScore;
    if (!roundScores[ps.playerId]) roundScores[ps.playerId] = [];
    roundScores[ps.playerId].push(ps.finalScore);
  }

  // Compute next dealer id for the round result overlay.
  const { nextDealerIndex } = await import('@calash/game-core');
  const playerCount = room.players.length;
  const nextDealer = nextDealerIndex(dealerIndex, playerCount);
  const nextDealerId = room.players[nextDealer]?.userId ?? null;
  roundResult.nextDealerId = nextDealerId ?? undefined;

  const gameScores: GameScore[] = room.players.map((p) => ({
    playerId: p.userId,
    total: cumulativeScores[p.userId] ?? 0,
    rounds: roundScores[p.userId] ?? [],
  }));

  io.to(roomId).emit('game:round-result', roundResult);
  io.to(roomId).emit('game:scores', gameScores);

  // Check if the game is over.
  const winner = getWinner(cumulativeScores);

  if (winner) {
    await db.rooms.updateStatus(roomId, 'finished', { winnerId: winner, finishedAt: true });
    await db.rooms.setFinalScores(
      roomId,
      Object.entries(cumulativeScores).map(([userId, finalScore]) => ({ userId, finalScore })),
    );

    const matchPlayers = Object.entries(cumulativeScores)
      .sort(([, a], [, b]) => b - a)
      .map(([userId, finalScore], rank) => ({ userId, finalScore, rank: rank + 1 }));

    await db.scores.recordMatchHistory({
      roomId,
      winnerId: winner,
      roundsPlayed: roundNumber,
      playerResults: matchPlayers,
    });

    await db.scores.updateLeaderboard({
      winnerId: winner,
      scores: matchPlayers.map(({ userId, finalScore }) => ({ userId, finalScore })),
    });

    room.status = 'finished';
    io.to(roomId).emit('game:finished', { playerId: winner, finalScore: cumulativeScores[winner] ?? 0 });
    io.to(roomId).emit('room:updated', toGameRoom(room));
    console.log(`[game] Game finished in room ${roomId}. Winner: ${winner}`);
    return;
  }

  // No winner yet — schedule the next round. CRITICAL: keep room.status as
  // 'in-progress' so the frontend stays on the GameBoard and shows the
  // round-result modal we just broadcast. Previously this flipped status to
  // 'lobby' between rounds, which kicked players back to the WaitingRoom and
  // hid the round summary entirely.
  room.round = {
    ...room.round,
    roundNumber: roundNumber + 1,
    dealerIndex: nextDealer,
    state: room.round.state, // replaced by startGame below
    cumulativeScores,
    roundScores: room.round.roundScores,
  };

  // Give clients ~5s to read the round result, then start the next round.
  // startGame resets per-round state (hands, deck, discard, melds,
  // hasGoneDown, didTakeFromDiscardThisTurn, etc.) and broadcasts the
  // fresh game:state, which the frontend uses to clear the round result
  // modal. Cumulative scores are preserved on room.round.cumulativeScores.
  setTimeout(() => {
    startGame(room, io).catch((err) => {
      console.error(`[game] Failed to start next round in room ${roomId}:`, err);
    });
  }, 5000);
}
