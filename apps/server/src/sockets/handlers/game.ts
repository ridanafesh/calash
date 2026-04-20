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
import { roomStore } from '../../store/index.js';
import { startGame, toGameRoom, broadcastRoomUpdate } from './room.js';

type CalashSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type CalashServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const db = createDatabaseService(pool);

// ─── Turn-phase mapping DB ↔ game-core ────────────────────────────────────────

type DbTurnPhase = 'awaiting_draw_or_take' | 'holding' | 'complete';

function mapTurnPhaseToDb(phase: string): DbTurnPhase {
  return phase.replace(/-/g, '_') as DbTurnPhase;
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

  const { applyTurnAction, toRoundStateView } = await import('@calash/game-core');

  const { roundId, state, cumulativeScores } = room.round;
  const ps = state.playerStates[playerId];
  if (!ps) {
    socket.emit('room:error', { code: 'NOT_IN_GAME', message: 'You are not a participant in this round.' });
    return;
  }

  const handBefore = [...ps.hand];

  const result = applyTurnAction(state, playerId, action);

  if (!result.ok) {
    socket.emit('room:error', { code: 'INVALID_ACTION', message: result.error });
    console.warn(`[game] Invalid action by ${playerId} in round ${roundId}: ${result.error}`);
    return;
  }

  const { state: newState, roundResult } = result;

  // ── Persist action to DB ──────────────────────────────────────────────────

  const newPs = newState.playerStates[playerId];

  const actionUpdates: Parameters<typeof db.rounds.applyAction>[0] = {
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
  };

  await db.rounds.applyAction(actionUpdates);

  // Sync hand metadata (has_gone_down, table_total) and melds for meld actions.
  if (['go-down', 'add-to-meld', 'add-new-meld'].includes(action.type)) {
    await db.rounds.updateHand(roundId, playerId, {
      cards: newPs.hand,
      hasGoneDown: newPs.hasGoneDown,
      tableTotal: newPs.tableTotal,
    });
    await persistMelds(roundId, playerId, action, newPs);
  }

  // ── Update in-memory state ────────────────────────────────────────────────

  room.round.state = newState;

  // ── Broadcast ─────────────────────────────────────────────────────────────

  io.to(roomId).emit('game:state', toRoundStateView(newState));
  socket.emit('game:hand', newPs.hand);

  // ── Handle round end ──────────────────────────────────────────────────────

  if (roundResult) {
    await handleRoundEnd(room.roomId, io);
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
    // createMelds handles meld insert + game_meld_cards in one transaction.
    await db.melds.createMelds({
      roundId,
      ownerUserId: userId,
      melds: ps.melds.map((m) => ({ type: m.type, cards: [...m.cards] })),
      newHand: ps.hand,
      newTableTotal: ps.tableTotal,
    });
  } else if (action.type === 'add-new-meld') {
    const meld = ps.melds[ps.melds.length - 1];
    if (meld) {
      await db.melds.createMelds({
        roundId,
        ownerUserId: userId,
        melds: [{ type: meld.type, cards: [...meld.cards] }],
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
  const { computeRoundResult, applyCumulativeScores, getWinner } = await import('@calash/game-core');

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

  // Start next round (nextDealer already computed above).

  room.round = {
    ...room.round,
    roundNumber: roundNumber + 1,
    dealerIndex: nextDealer,
    state: room.round.state, // will be replaced by startGame
    cumulativeScores,
    roundScores: room.round.roundScores,
  };

  // Reset ready states for next round.
  for (const p of room.players) p.isReady = false;
  room.status = 'lobby';

  broadcastRoomUpdate(io, room);

  // Give clients 3 s to read the round result, then start next round.
  setTimeout(() => {
    startGame(room, io).catch((err) => {
      console.error(`[game] Failed to start next round in room ${roomId}:`, err);
    });
  }, 3000);
}
