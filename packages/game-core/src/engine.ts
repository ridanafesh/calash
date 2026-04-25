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
  JokerAssignment,
  RegularCard,
  RoundEndReason,
} from '@calash/shared';
import { GAME_CONFIG } from '@calash/shared';
import { createDeck, shuffleDeck, dealHands, removeCardsFromHand, isSameCard } from './deck.js';
import { validateTurnAction } from './rules/turn.js';
import type { TurnContext } from './rules/turn.js';
import { applyTakeFromDiscard } from './rules/discard.js';
import {
  totalCardValue,
  totalMeldValue,
  resolveJokerAssignment,
  validateMeld,
} from './meld.js';
import { computeRoundResult } from './scoring.js';

// ─── Public result type ───────────────────────────────────────────────────────

/**
 * Optional structured failure metadata. The string `error` field is always
 * populated and is what the server surfaces to humans; the optional
 * `errorCode` + `candidates` let the socket layer pass through specific
 * failures (currently only AMBIGUOUS_JOKER_ASSIGNMENT) to the UI in a way
 * the client can react to programmatically (open a picker dialog) instead
 * of just showing a banner.
 */
export type ApplyResult =
  | { ok: true; state: RoundState; roundResult?: RoundResult }
  | {
      ok: false;
      error: string;
      errorCode?: 'AMBIGUOUS_JOKER_ASSIGNMENT';
      candidates?: JokerAssignment[];
      meldIndex?: number;
    };

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
    case 'draw-from-deck':       return applyDraw(state, playerId);
    case 'take-from-discard':    return applyTakeDiscard(state, playerId, action);
    case 'go-down':              return applyGoDown(state, playerId, action, generateId);
    case 'add-to-meld':          return applyAddToMeld(state, playerId, action);
    case 'add-new-meld':         return applyAddNewMeld(state, playerId, action, generateId);
    case 'replace-joker':        return applyReplaceJoker(state, playerId, action);
    case 'discard':              return applyDiscard(state, playerId, action);
    case 'keep-drawn-card':      return applyKeepDrawnCard(state, playerId);
    case 'discard-drawn-card':   return applyDiscardDrawnCard(state, playerId);
  }
}

function defaultId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ─── draw-from-deck ───────────────────────────────────────────────────────────

function applyDraw(state: RoundState, playerId: string): ApplyResult {
  // Top of deck = last element. The drawn card does NOT go straight into
  // the player's hand — it sits in pendingDrawnCard until the player picks
  // Keep (→ hand, must then discard one) or Discard (→ pile, turn ends).
  // This separation gives the UI a clean preview area and lets the engine
  // block all other actions while the decision is pending.
  void playerId;
  const drawnCard = state.hiddenDeck[state.hiddenDeck.length - 1];
  const newHiddenDeck = state.hiddenDeck.slice(0, -1);

  return {
    ok: true,
    state: {
      ...state,
      hiddenDeck: newHiddenDeck,
      turnPhase: 'pending-drawn-decision',
      pendingDrawnCard: drawnCard,
    },
  };
}

// ─── keep-drawn-card / discard-drawn-card ────────────────────────────────────

function applyKeepDrawnCard(state: RoundState, playerId: string): ApplyResult {
  const drawn = state.pendingDrawnCard;
  if (!drawn) return { ok: false, error: 'No drawn card pending' };

  const ps = state.playerStates[playerId];
  return {
    ok: true,
    state: {
      ...state,
      turnPhase: 'holding',
      pendingDrawnCard: undefined,
      playerStates: {
        ...state.playerStates,
        [playerId]: { ...ps, hand: [...ps.hand, drawn] },
      },
    },
  };
}

function applyDiscardDrawnCard(state: RoundState, playerId: string): ApplyResult {
  const drawn = state.pendingDrawnCard;
  if (!drawn) return { ok: false, error: 'No drawn card pending' };

  // Push the drawn card straight to the discard pile. The card never
  // entered the hand, so hand size is unchanged. Hand-empty round-end is
  // therefore impossible from this action — skip that check.
  let newState: RoundState = {
    ...state,
    discardPile: [...state.discardPile, drawn],
    pendingDrawnCard: undefined,
  };

  newState = advanceTurn(newState);

  if (isRoundOverByExhaustion(newState)) {
    return finishRound(newState, 'deck-exhausted', null);
  }

  void playerId;
  return { ok: true, state: newState };
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

  // Take-from-discard fully resolves the turn. Per the rules, the player
  // CANNOT discard, go-down, or add-to-meld after taking from the discard
  // pile — the take itself ends the turn. The post-state restriction on
  // go-down / add-to-meld within this turn becomes moot because the turn
  // is no longer this player's. The didTakeFromDiscardThisTurn flag still
  // stays true through the action (visible to broadcast/UI for the brief
  // moment before turn advance) and resets to false on advanceTurn.
  let newState: RoundState = {
    ...state,
    discardPile: newPile,
    didTakeFromDiscardThisTurn: true,
    playerStates: {
      ...state.playerStates,
      [playerId]: { ...ps, hand: newHand },
    },
  };

  // Hand-empty edge case can't normally arise here (take adds N cards,
  // optionally removes 1 — net non-negative change for any pile.length >= 1)
  // but kept as a defensive parallel to applyDiscard's check.
  if (newHand.length === 0) {
    return finishRound(newState, 'player-finished', playerId);
  }

  // Advance to the next player. advanceTurn flips turnPhase back to
  // 'awaiting-draw-or-take' and resets didTakeFromDiscardThisTurn.
  newState = advanceTurn(newState);

  if (isRoundOverByExhaustion(newState)) {
    return finishRound(newState, 'deck-exhausted', null);
  }

  return { ok: true, state: newState };
}

// ─── go-down ──────────────────────────────────────────────────────────────────

function applyGoDown(
  state: RoundState,
  playerId: string,
  action: {
    melds: ReadonlyArray<{
      type: MeldType;
      cards: readonly Card[];
      jokerAssignment?: JokerAssignment;
    }>;
  },
  generateId: () => string,
): ApplyResult {
  const ps = state.playerStates[playerId];

  // Resolve joker assignment for each meld up front. If any meld is ambiguous
  // and the client did not supply an assignment, fail with structured info so
  // the UI can prompt — without this, the UI would never know which meld to
  // ask about.
  const newMelds: Meld[] = [];
  for (let i = 0; i < action.melds.length; i++) {
    const m = action.melds[i];
    const resolved = resolveJokerAssignment(m.type, m.cards, m.jokerAssignment);
    if (!resolved.ok) {
      if (resolved.ambiguous) {
        return {
          ok: false,
          error: 'Joker placement is ambiguous — choose what the joker represents',
          errorCode: 'AMBIGUOUS_JOKER_ASSIGNMENT',
          candidates: resolved.candidates,
          meldIndex: i,
        };
      }
      return { ok: false, error: resolved.reason };
    }
    newMelds.push({
      id: generateId(),
      type: m.type,
      cards: [...m.cards],
      totalValue: totalCardValue(m.cards),
      ...(resolved.assignment ? { jokerAssignment: resolved.assignment } : {}),
    });
  }

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
  action: { meldId: string; cards: readonly Card[]; jokerAssignment?: JokerAssignment },
): ApplyResult {
  const ownerId = findMeldOwner(state, action.meldId);
  if (!ownerId) return { ok: false, error: `Meld '${action.meldId}' not found` };

  const actorPs = state.playerStates[playerId];
  const ownerPs = state.playerStates[ownerId];

  // Locate the existing meld so we can compute the post-state assignment.
  const existingMeld = ownerPs.melds.find((m) => m.id === action.meldId);
  if (!existingMeld) return { ok: false, error: `Meld '${action.meldId}' not found` };

  const updatedCardsForMeld = [...existingMeld.cards, ...action.cards];

  // Decide what the joker assignment of the resulting meld should be.
  //   - No joker added, no existing joker → no assignment.
  //   - No joker added, existing assignment → keep it (real cards added in
  //     other positions don't change the joker's role).
  //   - Joker added to a meld that already has a joker → rejected by validator.
  //   - Joker added to a meld with no joker → resolve fresh (may need
  //     client-supplied choice if ambiguous).
  let nextAssignment: JokerAssignment | undefined = existingMeld.jokerAssignment;
  const addedJoker = action.cards.some((c) => c.isJoker);
  if (addedJoker && !existingMeld.jokerAssignment) {
    const resolved = resolveJokerAssignment(existingMeld.type, updatedCardsForMeld, action.jokerAssignment);
    if (!resolved.ok) {
      if (resolved.ambiguous) {
        return {
          ok: false,
          error: 'Joker placement is ambiguous — choose what the joker represents',
          errorCode: 'AMBIGUOUS_JOKER_ASSIGNMENT',
          candidates: resolved.candidates,
        };
      }
      return { ok: false, error: resolved.reason };
    }
    nextAssignment = resolved.assignment;
  }

  // Remove played cards from actor's hand.
  const newActorHand = removeCardsFromHand(actorPs.hand, [...action.cards]);

  // Update the meld in the owner's list.
  const addedValue = totalCardValue(action.cards);
  const updatedOwnerMelds = ownerPs.melds.map((m) => {
    if (m.id !== action.meldId) return m;
    const next: Meld = {
      ...m,
      cards: updatedCardsForMeld,
      totalValue: totalCardValue(updatedCardsForMeld),
    };
    // Drop the assignment field entirely if no joker remains; otherwise
    // re-attach (preserves existing or applies the freshly resolved one).
    if (nextAssignment) (next as { jokerAssignment?: JokerAssignment }).jokerAssignment = nextAssignment;
    return next;
  });

  // Cards added to ANY meld count toward the contributor's tableTotal.
  const newActorTableTotal = actorPs.tableTotal + addedValue;
  const newHighest = Math.max(state.highestTableTotal, newActorTableTotal);

  // When the actor owns the meld, the owner update and actor update target the
  // SAME player record. Apply both updates to a single derived record so one
  // doesn't shadow the other.
  let newPlayerStates: RoundState['playerStates'];
  if (ownerId === playerId) {
    newPlayerStates = {
      ...state.playerStates,
      [playerId]: {
        ...actorPs,
        hand: newActorHand,
        melds: updatedOwnerMelds,
        tableTotal: newActorTableTotal,
      },
    };
  } else {
    newPlayerStates = {
      ...state.playerStates,
      [ownerId]: { ...ownerPs, melds: updatedOwnerMelds },
      [playerId]: { ...actorPs, hand: newActorHand, tableTotal: newActorTableTotal },
    };
  }

  return {
    ok: true,
    state: { ...state, highestTableTotal: newHighest, playerStates: newPlayerStates },
  };
}

// ─── add-new-meld ─────────────────────────────────────────────────────────────

function applyAddNewMeld(
  state: RoundState,
  playerId: string,
  action: {
    meld: { type: MeldType; cards: readonly Card[]; jokerAssignment?: JokerAssignment };
  },
  generateId: () => string,
): ApplyResult {
  const ps = state.playerStates[playerId];

  const resolved = resolveJokerAssignment(action.meld.type, action.meld.cards, action.meld.jokerAssignment);
  if (!resolved.ok) {
    if (resolved.ambiguous) {
      return {
        ok: false,
        error: 'Joker placement is ambiguous — choose what the joker represents',
        errorCode: 'AMBIGUOUS_JOKER_ASSIGNMENT',
        candidates: resolved.candidates,
      };
    }
    return { ok: false, error: resolved.reason };
  }

  const newMeld: Meld = {
    id: generateId(),
    type: action.meld.type,
    cards: [...action.meld.cards],
    totalValue: totalCardValue(action.meld.cards),
    ...(resolved.assignment ? { jokerAssignment: resolved.assignment } : {}),
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

// ─── replace-joker ────────────────────────────────────────────────────────────

/**
 * Replace the joker inside a table meld with the real card it represents,
 * returning the joker to the actor's hand.
 *
 * Sequences: legal whenever the actor holds the exact rank+suit the joker
 * is assigned to. The replacement card slots into the joker's position and
 * the joker rejoins the actor's hand. The meld type, suit, and run-shape
 * are unchanged so the resulting meld stays valid by construction; we
 * still re-validate as a safety net.
 *
 * Sets: the spec is strict — the joker can only be reclaimed when the
 * meld is being completed to a natural 4-suit set. That means BEFORE this
 * action runs, the meld must already contain the 3 OTHER real suits (so
 * exactly: joker + 3 reals = 4 cards), and the actor's replacement card
 * must be the 4th missing suit (which equals the joker's representsSuit).
 * Adding a single new suit to a 3-card joker set is not enough — the
 * player must first add the 3rd real suit via add-to-meld, then reclaim.
 */
function applyReplaceJoker(
  state: RoundState,
  playerId: string,
  action: { meldId: string; replacementCard: Card },
): ApplyResult {
  if (action.replacementCard.isJoker) {
    return { ok: false, error: 'Replacement card cannot itself be a joker' };
  }

  const ownerId = findMeldOwner(state, action.meldId);
  if (!ownerId) return { ok: false, error: `Meld '${action.meldId}' not found` };

  const actorPs = state.playerStates[playerId];
  const ownerPs = state.playerStates[ownerId];
  const meld = ownerPs.melds.find((m) => m.id === action.meldId);
  if (!meld) return { ok: false, error: `Meld '${action.meldId}' not found` };

  const assignment = meld.jokerAssignment;
  if (!assignment) {
    return { ok: false, error: 'This meld does not contain a joker to replace' };
  }

  // Locate the joker card inside the meld.
  const jokerIdx = meld.cards.findIndex((c) => c.isJoker && c.jokerIndex === assignment.jokerIndex);
  if (jokerIdx === -1) {
    // Defensive — assignment present but joker missing → state is corrupt.
    return { ok: false, error: 'Meld is in an inconsistent state (joker assignment without joker)' };
  }
  const jokerCard = meld.cards[jokerIdx] as JokerCardLite;

  // Replacement must be in the actor's hand.
  const handIdx = actorPs.hand.findIndex((c) => isSameCard(c, action.replacementCard));
  if (handIdx === -1) {
    return { ok: false, error: 'Replacement card is not in your hand' };
  }
  const replacement = actorPs.hand[handIdx] as RegularCard;
  if (replacement.isJoker) {
    return { ok: false, error: 'Replacement card cannot itself be a joker' };
  }

  if (meld.type === 'sequence') {
    if (replacement.rank !== assignment.representsRank || replacement.suit !== assignment.representsSuit) {
      return {
        ok: false,
        error: `This joker stands for ${assignment.representsRank} of ${assignment.representsSuit}; the replacement must match exactly`,
      };
    }
  } else {
    // SET reclaim rule: meld must currently have joker + the 3 OTHER real
    // suits, and the replacement must be the 4th (missing) suit.
    if (replacement.rank !== assignment.representsRank) {
      return {
        ok: false,
        error: `Replacement card must be a ${assignment.representsRank} to complete this set`,
      };
    }
    if (replacement.suit !== assignment.representsSuit) {
      return {
        ok: false,
        error: `This joker stands for ${assignment.representsRank} of ${assignment.representsSuit}; the replacement must be that suit`,
      };
    }
    const realCardsInMeld = meld.cards.filter((c): c is RegularCard => !c.isJoker);
    const realSuitsPresent = new Set(realCardsInMeld.map((c) => c.suit));
    if (realSuitsPresent.size < 3) {
      return {
        ok: false,
        error:
          'Cannot reclaim joker yet — the set must contain the other three real suits before the joker can be swapped',
      };
    }
  }

  // Build the post-state meld: replace the joker in place.
  const newMeldCards = [...meld.cards.slice(0, jokerIdx), replacement, ...meld.cards.slice(jokerIdx + 1)];
  // Sanity-validate; this should always pass by construction.
  const validity = validateMeld(meld.type, newMeldCards);
  if (!validity.valid) {
    return { ok: false, error: validity.reason ?? 'Resulting meld would be invalid' };
  }

  const updatedOwnerMelds = ownerPs.melds.map((m) => {
    if (m.id !== meld.id) return m;
    const next: Meld = {
      id: m.id,
      type: m.type,
      cards: newMeldCards,
      totalValue: totalCardValue(newMeldCards),
    };
    return next; // jokerAssignment intentionally omitted — joker has left
  });

  // Joker comes back to the actor's hand; replacement card leaves the hand.
  const newActorHand = [
    ...actorPs.hand.slice(0, handIdx),
    ...actorPs.hand.slice(handIdx + 1),
    jokerCard,
  ];

  // Recompute the OWNER's tableTotal from melds (the joker was worth 25 in
  // the meld; the replacement card almost always has a different value, so
  // the owner's table total changes). Note: we credit the change in value
  // back to the meld OWNER, not the actor — the meld still belongs to the
  // owner; the actor merely swapped a card. This mirrors how scoring views
  // who owns the meld.
  const newOwnerTableTotal = totalMeldValue(updatedOwnerMelds.filter((m) =>
    ownerPs.melds.some((om) => om.id === m.id),
  ));

  let newPlayerStates: RoundState['playerStates'];
  if (ownerId === playerId) {
    newPlayerStates = {
      ...state.playerStates,
      [playerId]: {
        ...actorPs,
        hand: newActorHand,
        melds: updatedOwnerMelds,
        tableTotal: newOwnerTableTotal,
      },
    };
  } else {
    newPlayerStates = {
      ...state.playerStates,
      [ownerId]: { ...ownerPs, melds: updatedOwnerMelds, tableTotal: newOwnerTableTotal },
      [playerId]: { ...actorPs, hand: newActorHand },
    };
  }

  // highestTableTotal can decrease here in principle (joker is 25 → real
  // card might be worth less), but the canonical highestTableTotal tracks
  // the maximum reached so far for the next-opener threshold; we leave it
  // unchanged so the threshold doesn't drop mid-round. This is intentional.

  return { ok: true, state: { ...state, playerStates: newPlayerStates } };
}

// JokerCardLite is the type we get back from meld.cards[i] when isJoker is
// true — duplicated from the shared Card union to keep this file independent.
type JokerCardLite = { rank: 'JOKER'; suit: null; isJoker: true; jokerIndex: 0 | 1 };

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
    pendingDrawnCard: undefined,
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
    // PRIVACY: only the OWNER of the pending draw decision should see the
    // actual card. Broadcast view exposes a boolean only — opponents need
    // to know the state exists (to render "X is deciding…") but must not
    // see the card identity. The owner gets the card via the dedicated
    // private 'game:drawn-card' socket event.
    pendingDrawnCardPresent: state.pendingDrawnCard !== undefined,
  };
}
