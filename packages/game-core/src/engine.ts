/**
 * Pure game engine — the server's source of truth.
 *
 * `initRound`       → builds the initial RoundState from a player list + deck.
 * `applyTurnAction` → validates an action and returns the next RoundState.
 * `toRoundStateView`→ strips hidden information for broadcast.
 * `checkRoundOver`  → lets the server query exhaustion before accepting actions.
 *
 * No I/O, no database, no Socket.IO.  The server calls these functions,
 * persists the result, and broadcasts the sanitised view.
 */

import type {
  RoundState,
  RoundResult,
  RoundStateView,
  PlayerRoundState,
  TurnAction,
  Meld,
  MeldType,
  Card,
  RoundEndReason,
} from '@calash/shared';
import { GAME_CONFIG } from '@calash/shared';
import { createDeck, shuffleDeck, dealHands, removeCardsFromHand } from './deck.js';
import { validateTurnAction } from './rules/turn.js';
import type { TurnContext } from './rules/turn.js';
import { applyTakeFromDiscard } from './rules/discard.js';
import { totalCardValue, totalMeldValue } from './meld.js';
import { computeRoundResult } from './scoring.js';

// ─── Public result type ───────────────────────────────────────────────────────

export type ApplyResult =
  | { ok: true; state: RoundState; roundResult?: RoundResult }
  | { ok: false; error: string };

// ─── Round initialisation ────────────────────────────────────────────────────

/**
 * Build the initial RoundState for a new round.
 *
 * Turn order is counterclockwise: playerOrder[0] is the player immediately to
 * the dealer's right; they act first and receive 15 cards.  All other players
 * receive 14 cards.
 *
 * The discard pile starts empty — the first player opens it by discarding.
 *
 * @param deck  Optional pre-shuffled deck (omit to shuffle a fresh deck).
 *              Pass a seeded deck for deterministic tests.
 */
export function initRound(params: {
  playerIds: readonly string[];
  roundNumber: number;
  dealerIndex: number;
  deck?: Card[];
}): RoundState {
  const { playerIds, roundNumber, dealerIndex } = params;
  const n = playerIds.length;

  if (n < GAME_CONFIG.MIN_PLAYERS || n > GAME_CONFIG.MAX_PLAYERS) {
    throw new Error(
      `Player count must be ${GAME_CONFIG.MIN_PLAYERS}–${GAME_CONFIG.MAX_PLAYERS}, got ${n}`,
    );
  }

  const deck = params.deck ?? shuffleDeck(createDeck());

  // Build counterclockwise turn order: dealer's right first, then around the table.
  const playerOrder: string[] = [];
  for (let i = 1; i <= n; i++) {
    playerOrder.push(playerIds[(dealerIndex + i) % n]);
  }

  // Deal: playerOrder[0] receives 15 cards; all others receive 14.
  const { hands, remaining } = dealHands(deck, n);

  // Discard pile starts empty; remaining deck is the full draw pile.
  const hiddenDeck = remaining;
  const discardPile: Card[] = [];

  const playerStates: Record<string, PlayerRoundState> = {};
  for (let i = 0; i < n; i++) {
    playerStates[playerOrder[i]] = {
      playerId: playerOrder[i],
      hand: hands[i],
      melds: [],
      hasGoneDown: false,
      tableTotal: 0,
    };
  }

  return {
    roundNumber,
    dealerPlayerId: playerIds[dealerIndex],
    playerOrder,
    currentTurnPlayerId: playerOrder[0],
    phase: 'in-progress',
    turnPhase: 'awaiting-draw-or-take',
    playerStates,
    hiddenDeck,
    discardPile,
    highestTableTotal: 0,
    didTakeFromDiscardThisTurn: false,
  };
}

// ─── Dealer rotation ──────────────────────────────────────────────────────────

/** Return the index of the next dealer (left of the current dealer). */
export function nextDealerIndex(currentDealerIndex: number, playerCount: number): number {
  return (currentDealerIndex + 1) % playerCount;
}

// ─── Exhaustion check ────────────────────────────────────────────────────────

/**
 * Return true if the round should end due to deck exhaustion.
 * Called by the server when starting a new turn.
 */
export function isRoundOverByExhaustion(state: RoundState): boolean {
  if (state.phase !== 'in-progress') return false;
  // Round ends when there is nothing left to draw AND the discard pile cannot
  // be taken from (only 1 card remains and it must stay).
  return state.hiddenDeck.length === 0 && state.discardPile.length <= 1;
}

// ─── Turn application ────────────────────────────────────────────────────────

/**
 * Validate and apply a player's turn action.
 *
 * Returns:
 *   { ok: true,  state }              — action applied, game continues.
 *   { ok: true,  state, roundResult } — round ended as part of this action.
 *   { ok: false, error }              — action rejected; state unchanged.
 *
 * The caller must persist the new state and, when `roundResult` is present,
 * record scores and advance to the next round.
 */
export function applyTurnAction(
  state: RoundState,
  playerId: string,
  action: TurnAction,
  generateId: () => string = defaultId,
): ApplyResult {
  if (state.currentTurnPlayerId !== playerId) {
    return { ok: false, error: `It is ${state.currentTurnPlayerId}'s turn, not ${playerId}'s` };
  }
  if (state.phase !== 'in-progress') {
    return { ok: false, error: `Round is not in progress (phase: ${state.phase})` };
  }

  // Check exhaustion before accepting any action this turn.
  if (
    state.turnPhase === 'awaiting-draw-or-take' &&
    isRoundOverByExhaustion(state)
  ) {
    return finishRound(state, 'deck-exhausted', null);
  }

  const ctx = buildContext(state, playerId);
  const validation = validateTurnAction(action, ctx);
  if (!validation.valid) {
    return { ok: false, error: validation.reason ?? 'Invalid action' };
  }

  return dispatch(state, playerId, action, generateId);
}

// ─── Context builder ──────────────────────────────────────────────────────────

function buildContext(state: RoundState, playerId: string): TurnContext {
  const tableMelds: TurnContext['tableMelds'] = {};
  for (const ps of Object.values(state.playerStates)) {
    for (const meld of ps.melds) {
      tableMelds[meld.id] = { type: meld.type, cards: meld.cards };
    }
  }
  const ps = state.playerStates[playerId];
  return {
    turnPhase: state.turnPhase,
    playerHand: ps.hand,
    hasGoneDown: ps.hasGoneDown,
    didTakeFromDiscardThisTurn: state.didTakeFromDiscardThisTurn,
    discardPile: state.discardPile,
    hiddenDeckCount: state.hiddenDeck.length,
    highestTableTotal: state.highestTableTotal,
    tableMelds,
  };
}

// ─── Meld lookup ──────────────────────────────────────────────────────────────

function findMeldOwner(state: RoundState, meldId: string): string | null {
  for (const [pid, ps] of Object.entries(state.playerStates)) {
    if (ps.melds.some((m) => m.id === meldId)) return pid;
  }
  return null;
}

// ─── Action dispatcher ────────────────────────────────────────────────────────

function dispatch(
  state: RoundState,
  playerId: string,
  action: TurnAction,
  generateId: () => string,
): ApplyResult {
  switch (action.type) {
    case 'draw-from-deck':   return applyDraw(state, playerId);
    case 'take-from-discard': return applyTakeDiscard(state, playerId, action);
    case 'go-down':          return applyGoDown(state, playerId, action, generateId);
    case 'add-to-meld':      return applyAddToMeld(state, playerId, action);
    case 'add-new-meld':     return applyAddNewMeld(state, playerId, action, generateId);
    case 'discard':          return applyDiscard(state, playerId, action);
  }
}

function defaultId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ─── draw-from-deck ───────────────────────────────────────────────────────────

function applyDraw(state: RoundState, playerId: string): ApplyResult {
  // Top of deck = last element.
  const drawnCard = state.hiddenDeck[state.hiddenDeck.length - 1];
  const newHiddenDeck = state.hiddenDeck.slice(0, -1);
  const ps = state.playerStates[playerId];

  return {
    ok: true,
    state: {
      ...state,
      hiddenDeck: newHiddenDeck,
      turnPhase: 'holding',
      playerStates: {
        ...state.playerStates,
        [playerId]: { ...ps, hand: [...ps.hand, drawnCard] },
      },
    },
  };
}

// ─── take-from-discard ────────────────────────────────────────────────────────

function applyTakeDiscard(
  state: RoundState,
  playerId: string,
  action: { count: number; returnCardFromHand?: Card },
): ApplyResult {
  const { taken, newPile } = applyTakeFromDiscard(
    [...state.discardPile],
    action.count,
    action.returnCardFromHand,
  );

  const ps = state.playerStates[playerId];
  let newHand = [...ps.hand, ...taken];
  if (action.returnCardFromHand) {
    newHand = removeCardsFromHand(newHand, [action.returnCardFromHand]);
  }

  return {
    ok: true,
    state: {
      ...state,
      discardPile: newPile,
      turnPhase: 'holding',
      didTakeFromDiscardThisTurn: true,
      playerStates: {
        ...state.playerStates,
        [playerId]: { ...ps, hand: newHand },
      },
    },
  };
}

// ─── go-down ──────────────────────────────────────────────────────────────────

function applyGoDown(
  state: RoundState,
  playerId: string,
  action: { melds: ReadonlyArray<{ type: MeldType; cards: readonly Card[] }> },
  generateId: () => string,
): ApplyResult {
  const ps = state.playerStates[playerId];

  const newMelds: Meld[] = action.melds.map((m) => ({
    id: generateId(),
    type: m.type,
    cards: [...m.cards],
    totalValue: totalCardValue(m.cards),
  }));

  const allPlayedCards = action.melds.flatMap((m) => [...m.cards]);
  const newHand = removeCardsFromHand(ps.hand, allPlayedCards);
  const newTableTotal = totalMeldValue(newMelds);
  const newHighest = Math.max(state.highestTableTotal, newTableTotal);

  return {
    ok: true,
    state: {
      ...state,
      highestTableTotal: newHighest,
      playerStates: {
        ...state.playerStates,
        [playerId]: {
          ...ps,
          hand: newHand,
          melds: newMelds,
          hasGoneDown: true,
          tableTotal: newTableTotal,
        },
      },
    },
  };
}

// ─── add-to-meld ──────────────────────────────────────────────────────────────

function applyAddToMeld(
  state: RoundState,
  playerId: string,
  action: { meldId: string; cards: readonly Card[] },
): ApplyResult {
  const ownerId = findMeldOwner(state, action.meldId);
  if (!ownerId) return { ok: false, error: `Meld '${action.meldId}' not found` };

  const actorPs = state.playerStates[playerId];
  const ownerPs = state.playerStates[ownerId];

  // Remove played cards from actor's hand.
  const newActorHand = removeCardsFromHand(actorPs.hand, [...action.cards]);

  // Update the meld in the owner's list.
  const addedValue = totalCardValue(action.cards);
  const updatedOwnerMelds = ownerPs.melds.map((m) => {
    if (m.id !== action.meldId) return m;
    const updatedCards = [...m.cards, ...action.cards];
    return { ...m, cards: updatedCards, totalValue: totalCardValue(updatedCards) };
  });

  // MVP rule: cards added to ANY meld count toward the contributor's tableTotal.
  const newActorTableTotal = actorPs.tableTotal + addedValue;
  const newHighest = Math.max(state.highestTableTotal, newActorTableTotal);

  const newPlayerStates = {
    ...state.playerStates,
    [ownerId]: { ...ownerPs, melds: updatedOwnerMelds },
    [playerId]: { ...actorPs, hand: newActorHand, tableTotal: newActorTableTotal },
  };

  return {
    ok: true,
    state: { ...state, highestTableTotal: newHighest, playerStates: newPlayerStates },
  };
}

// ─── add-new-meld ─────────────────────────────────────────────────────────────

function applyAddNewMeld(
  state: RoundState,
  playerId: string,
  action: { meld: { type: MeldType; cards: readonly Card[] } },
  generateId: () => string,
): ApplyResult {
  const ps = state.playerStates[playerId];

  const newMeld: Meld = {
    id: generateId(),
    type: action.meld.type,
    cards: [...action.meld.cards],
    totalValue: totalCardValue(action.meld.cards),
  };

  const newHand = removeCardsFromHand(ps.hand, [...action.meld.cards]);
  const newMelds = [...ps.melds, newMeld];
  const newTableTotal = ps.tableTotal + newMeld.totalValue;
  const newHighest = Math.max(state.highestTableTotal, newTableTotal);

  return {
    ok: true,
    state: {
      ...state,
      highestTableTotal: newHighest,
      playerStates: {
        ...state.playerStates,
        [playerId]: { ...ps, hand: newHand, melds: newMelds, tableTotal: newTableTotal },
      },
    },
  };
}

// ─── discard ──────────────────────────────────────────────────────────────────

function applyDiscard(
  state: RoundState,
  playerId: string,
  action: { card: Card },
): ApplyResult {
  const ps = state.playerStates[playerId];
  const newHand = removeCardsFromHand(ps.hand, [action.card]);
  const newDiscardPile = [...state.discardPile, action.card];

  let newState: RoundState = {
    ...state,
    discardPile: newDiscardPile,
    playerStates: {
      ...state.playerStates,
      [playerId]: { ...ps, hand: newHand },
    },
  };

  // Player emptied their hand → round ends with finish bonus.
  if (newHand.length === 0) {
    return finishRound(newState, 'player-finished', playerId);
  }

  // Advance to the next player.
  newState = advanceTurn(newState);

  // After advancing, check if the next player can act at all.
  if (isRoundOverByExhaustion(newState)) {
    return finishRound(newState, 'deck-exhausted', null);
  }

  return { ok: true, state: newState };
}

// ─── Turn advancement ─────────────────────────────────────────────────────────

function advanceTurn(state: RoundState): RoundState {
  const idx = state.playerOrder.indexOf(state.currentTurnPlayerId);
  const nextIdx = (idx + 1) % state.playerOrder.length;

  return {
    ...state,
    currentTurnPlayerId: state.playerOrder[nextIdx],
    turnPhase: 'awaiting-draw-or-take',
    didTakeFromDiscardThisTurn: false,
  };
}

// ─── Round end ────────────────────────────────────────────────────────────────

function finishRound(
  state: RoundState,
  endReason: RoundEndReason,
  finisherPlayerId: string | null,
): ApplyResult {
  const finalState: RoundState = {
    ...state,
    phase: 'scoring',
    endReason,
    finisherPlayerId: finisherPlayerId ?? undefined,
  };

  const roundResult = computeRoundResult(
    state.playerStates,
    state.playerOrder,
    endReason,
    finisherPlayerId,
  );

  return { ok: true, state: finalState, roundResult };
}

// ─── Public view projection ───────────────────────────────────────────────────

/**
 * Strip the hidden deck and individual hands from RoundState.
 * This view is safe to broadcast to all connected clients.
 * Each client also receives their own hand via a private event.
 */
export function toRoundStateView(state: RoundState): RoundStateView {
  const playerStates: RoundStateView['playerStates'] = {};
  for (const [pid, ps] of Object.entries(state.playerStates)) {
    playerStates[pid] = {
      playerId: ps.playerId,
      melds: ps.melds,
      hasGoneDown: ps.hasGoneDown,
      tableTotal: ps.tableTotal,
    };
  }

  return {
    roundNumber: state.roundNumber,
    dealerPlayerId: state.dealerPlayerId,
    playerOrder: [...state.playerOrder],
    currentTurnPlayerId: state.currentTurnPlayerId,
    phase: state.phase,
    turnPhase: state.turnPhase,
    playerStates,
    hiddenDeckCount: state.hiddenDeck.length,
    discardPile: state.discardPile,
    highestTableTotal: state.highestTableTotal,
    endReason: state.endReason,
    finisherPlayerId: state.finisherPlayerId,
  };
}
