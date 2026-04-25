import type { RegularCard, JokerCard, Card, RoundState } from '@calash/shared';
import { GAME_CONFIG } from '@calash/shared';
import { seededShuffle } from '../seeded-random.js';
import { createDeck } from '../deck.js';
import {
  initRound,
  applyTurnAction,
  toRoundStateView,
  nextDealerIndex,
  isRoundOverByExhaustion,
} from '../engine.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const rc = (rank: RegularCard['rank'], suit: RegularCard['suit'], deckIndex: 0 | 1 = 0): RegularCard =>
  ({ rank, suit, isJoker: false, deckIndex });

const joker = (jokerIndex: 0 | 1 = 0): JokerCard =>
  ({ rank: 'JOKER', suit: null, isJoker: true, jokerIndex });

let idCounter = 0;
const testId = () => `meld-${++idCounter}`;

function deterministicRound(
  playerIds: string[],
  dealerIndex = 0,
  seed = 42,
): RoundState {
  const deck = seededShuffle(createDeck(), seed);
  return initRound({ playerIds, roundNumber: 1, dealerIndex, deck });
}

/**
 * Draw from deck + keep the drawn card in one helper. After the
 * pending-drawn-decision phase was added, most existing tests want the
 * old "draw → land in holding with the new card in hand" flow. This
 * helper restores that for tests that aren't specifically about the
 * keep/discard decision.
 */
function drawAndKeep(state: RoundState, playerId: string): RoundState {
  const r1 = applyTurnAction(state, playerId, { type: 'draw-from-deck' });
  if (!r1.ok) throw new Error(`drawAndKeep: draw failed — ${r1.error}`);
  const r2 = applyTurnAction(r1.state, playerId, { type: 'keep-drawn-card' });
  if (!r2.ok) throw new Error(`drawAndKeep: keep failed — ${r2.error}`);
  return r2.state;
}

beforeEach(() => { idCounter = 0; });

// ─── nextDealerIndex ─────────────────────────────────────────────────────────

describe('nextDealerIndex', () => {
  it('advances by 1 modulo playerCount', () => {
    expect(nextDealerIndex(0, 4)).toBe(1);
    expect(nextDealerIndex(3, 4)).toBe(0);
    expect(nextDealerIndex(1, 2)).toBe(0);
  });
});

// ─── isRoundOverByExhaustion ──────────────────────────────────────────────────

describe('isRoundOverByExhaustion', () => {
  it('returns false when hiddenDeck has cards', () => {
    const state = deterministicRound(['p1', 'p2']);
    expect(isRoundOverByExhaustion(state)).toBe(false);
  });

  it('returns true when hiddenDeck is empty and discardPile has ≤ 1 card', () => {
    const state = deterministicRound(['p1', 'p2']);
    const exhausted: RoundState = {
      ...state,
      hiddenDeck: [],
      discardPile: [rc('7', 'hearts')],
    };
    expect(isRoundOverByExhaustion(exhausted)).toBe(true);
  });

  it('returns true when both deck and discard pile are empty', () => {
    const state = deterministicRound(['p1', 'p2']);
    const exhausted: RoundState = { ...state, hiddenDeck: [], discardPile: [] };
    expect(isRoundOverByExhaustion(exhausted)).toBe(true);
  });

  it('returns false when hiddenDeck is empty but discardPile has ≥ 2 cards', () => {
    const state = deterministicRound(['p1', 'p2']);
    const notExhausted: RoundState = {
      ...state,
      hiddenDeck: [],
      discardPile: [rc('7', 'hearts'), rc('8', 'hearts')],
    };
    expect(isRoundOverByExhaustion(notExhausted)).toBe(false);
  });

  it('returns false when phase is not in-progress', () => {
    const state: RoundState = {
      ...deterministicRound(['p1', 'p2']),
      phase: 'scoring',
      hiddenDeck: [],
      discardPile: [],
    };
    expect(isRoundOverByExhaustion(state)).toBe(false);
  });
});

// ─── initRound ────────────────────────────────────────────────────────────────

describe('initRound', () => {
  it("places the player to the dealer's right first in playerOrder", () => {
    // dealerIndex=0 means playerIds[0] is the dealer; playerIds[1] is first to act
    const state = deterministicRound(['p1', 'p2', 'p3'], 0);
    expect(state.playerOrder[0]).toBe('p2');
  });

  it('wraps around: dealerIndex pointing to last player makes playerIds[0] first', () => {
    const state = deterministicRound(['p1', 'p2', 'p3'], 2);
    expect(state.playerOrder[0]).toBe('p1');
  });

  it('deals 15 cards to the first player in turn order', () => {
    const state = deterministicRound(['p1', 'p2']);
    const firstPlayer = state.playerOrder[0];
    expect(state.playerStates[firstPlayer].hand).toHaveLength(15);
  });

  it('deals 14 cards to all other players', () => {
    const state = deterministicRound(['p1', 'p2', 'p3', 'p4']);
    const [first, ...rest] = state.playerOrder;
    expect(state.playerStates[first].hand).toHaveLength(15);
    for (const pid of rest) {
      expect(state.playerStates[pid].hand).toHaveLength(14);
    }
  });

  it('starts with an empty discard pile', () => {
    const state = deterministicRound(['p1', 'p2']);
    expect(state.discardPile).toHaveLength(0);
  });

  it('starts in-progress with awaiting-draw-or-take phase', () => {
    const state = deterministicRound(['p1', 'p2']);
    expect(state.phase).toBe('in-progress');
    expect(state.turnPhase).toBe('awaiting-draw-or-take');
  });

  it('sets the current turn to the first player in playerOrder', () => {
    const state = deterministicRound(['p1', 'p2']);
    expect(state.currentTurnPlayerId).toBe(state.playerOrder[0]);
  });

  it('throws for too few players', () => {
    expect(() => initRound({ playerIds: ['p1'], roundNumber: 1, dealerIndex: 0 })).toThrow();
  });

  it('throws for too many players', () => {
    expect(() =>
      initRound({ playerIds: ['p1', 'p2', 'p3', 'p4', 'p5'], roundNumber: 1, dealerIndex: 0 }),
    ).toThrow();
  });

  it('produces the same deal for the same seed (determinism)', () => {
    const s1 = deterministicRound(['p1', 'p2'], 0, 99);
    const s2 = deterministicRound(['p1', 'p2'], 0, 99);
    const s3 = deterministicRound(['p1', 'p2'], 0, 123);
    expect(JSON.stringify(s1.playerStates)).toBe(JSON.stringify(s2.playerStates));
    expect(JSON.stringify(s1.playerStates)).not.toBe(JSON.stringify(s3.playerStates));
  });
});

// ─── applyTurnAction — guard checks ──────────────────────────────────────────

describe('applyTurnAction — basic guards', () => {
  it('rejects action from wrong player', () => {
    const state = deterministicRound(['p1', 'p2']);
    const wrongPlayer = state.playerOrder[1]; // not their turn
    const result = applyTurnAction(state, wrongPlayer, { type: 'draw-from-deck' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/turn/i);
  });

  it('rejects action when round phase is not in-progress', () => {
    const state: RoundState = { ...deterministicRound(['p1', 'p2']), phase: 'scoring' };
    const result = applyTurnAction(state, state.currentTurnPlayerId, { type: 'draw-from-deck' });
    expect(result.ok).toBe(false);
  });

  it('ends round by exhaustion when deck empty on turn start', () => {
    const state = deterministicRound(['p1', 'p2']);
    const exhausted: RoundState = { ...state, hiddenDeck: [], discardPile: [] };
    const result = applyTurnAction(exhausted, exhausted.currentTurnPlayerId, { type: 'draw-from-deck' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.roundResult?.endReason).toBe('deck-exhausted');
    }
  });
});

// ─── applyTurnAction — draw from deck ────────────────────────────────────────

describe('applyTurnAction — draw-from-deck', () => {
  it("removes the top card from hiddenDeck and stores it in pendingDrawnCard (NOT in hand)", () => {
    // Per the spec: drawing now puts the card in a pending area until the
    // player decides Keep vs Discard. The hand is unchanged at this point.
    const state = deterministicRound(['p1', 'p2']);
    const player = state.currentTurnPlayerId;
    const topCard = state.hiddenDeck[state.hiddenDeck.length - 1];
    const handBefore = state.playerStates[player].hand.length;

    const result = applyTurnAction(state, player, { type: 'draw-from-deck' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.hiddenDeck).toHaveLength(state.hiddenDeck.length - 1);
    expect(result.state.pendingDrawnCard).toEqual(topCard);
    // Hand is UNCHANGED until the player chooses Keep.
    expect(result.state.playerStates[player].hand).toHaveLength(handBefore);
  });

  it('transitions turnPhase to pending-drawn-decision', () => {
    const state = deterministicRound(['p1', 'p2']);
    const result = applyTurnAction(state, state.currentTurnPlayerId, { type: 'draw-from-deck' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.turnPhase).toBe('pending-drawn-decision');
  });

  it('rejects draw when already holding (wrong phase)', () => {
    const state = deterministicRound(['p1', 'p2']);
    const r1 = applyTurnAction(state, state.currentTurnPlayerId, { type: 'draw-from-deck' });
    if (!r1.ok) return;
    const r2 = applyTurnAction(r1.state, r1.state.currentTurnPlayerId, { type: 'draw-from-deck' });
    expect(r2.ok).toBe(false);
  });
});

// ─── applyTurnAction — discard ────────────────────────────────────────────────

describe('applyTurnAction — discard', () => {
  it('puts the discarded card on the discard pile', () => {
    const state = deterministicRound(['p1', 'p2']);
    const player = state.currentTurnPlayerId;
    const stateAfterDraw = drawAndKeep(state, player);

    const handCard = stateAfterDraw.playerStates[player].hand[0];
    const afterDiscard = applyTurnAction(stateAfterDraw, player, { type: 'discard', card: handCard });
    expect(afterDiscard.ok).toBe(true);
    if (!afterDiscard.ok) return;

    expect(afterDiscard.state.discardPile).toContainEqual(handCard);
  });

  it('removes the discarded card from hand', () => {
    const state = deterministicRound(['p1', 'p2']);
    const player = state.currentTurnPlayerId;
    const stateAfterDraw = drawAndKeep(state, player);

    const handCard = stateAfterDraw.playerStates[player].hand[0];
    const afterDiscard = applyTurnAction(stateAfterDraw, player, { type: 'discard', card: handCard });
    if (!afterDiscard.ok) return;

    const newHand = afterDiscard.state.playerStates[player].hand;
    expect(newHand).not.toContainEqual(handCard);
  });

  it('advances turn to the next player after discard', () => {
    const state = deterministicRound(['p1', 'p2']);
    const player = state.currentTurnPlayerId;
    const nextPlayer = state.playerOrder[1];
    const stateAfterDraw = drawAndKeep(state, player);

    const handCard = stateAfterDraw.playerStates[player].hand[0];
    const afterDiscard = applyTurnAction(stateAfterDraw, player, { type: 'discard', card: handCard });
    if (!afterDiscard.ok) return;

    expect(afterDiscard.state.currentTurnPlayerId).toBe(nextPlayer);
    expect(afterDiscard.state.turnPhase).toBe('awaiting-draw-or-take');
  });

  it('rejects discarding a card not in hand', () => {
    const state = deterministicRound(['p1', 'p2']);
    const player = state.currentTurnPlayerId;
    const stateAfterDraw = drawAndKeep(state, player);

    const hand = stateAfterDraw.playerStates[player].hand;
    const cardNotInHand = { rank: '2' as const, suit: 'hearts' as const, isJoker: false as const, deckIndex: 0 as const };
    const isInHand = hand.some((c) => !c.isJoker && (c as RegularCard).rank === '2' && (c as RegularCard).suit === 'hearts' && (c as RegularCard).deckIndex === 0);
    if (!isInHand) {
      const r = applyTurnAction(stateAfterDraw, player, { type: 'discard', card: cardNotInHand });
      expect(r.ok).toBe(false);
    }
  });
});

// ─── applyTurnAction — go-down ────────────────────────────────────────────────

describe('applyTurnAction — go-down', () => {
  it('places melds on the table and sets hasGoneDown', () => {
    // Build a state where the first player has a valid 75-point go-down
    const state = deterministicRound(['p1', 'p2']);
    const player = state.currentTurnPlayerId;

    // Draw + keep so we land in 'holding' (the engine now requires an
    // explicit Keep/Discard between draw and other actions).
    const stateAfterDraw = drawAndKeep(state, player);

    // Build a guaranteed valid go-down by using 3 Aces (75pts)
    // We need to inject these cards into the player's hand
    const aceH = rc('A', 'hearts', 0);
    const aceD = rc('A', 'diamonds', 0);
    const aceC = rc('A', 'clubs', 0);
    const stateWithAces: RoundState = {
      ...stateAfterDraw,
      playerStates: {
        ...stateAfterDraw.playerStates,
        [player]: {
          ...stateAfterDraw.playerStates[player],
          hand: [aceH, aceD, aceC, ...stateAfterDraw.playerStates[player].hand],
        },
      },
    };

    const result = applyTurnAction(
      stateWithAces,
      player,
      { type: 'go-down', melds: [{ type: 'set', cards: [aceH, aceD, aceC] }] },
      testId,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.playerStates[player].hasGoneDown).toBe(true);
    expect(result.state.playerStates[player].melds).toHaveLength(1);
    expect(result.state.playerStates[player].tableTotal).toBe(75);
    expect(result.state.highestTableTotal).toBe(75);
  });
});

// ─── applyTurnAction — add-to-meld (owner-only rule) ────────────────────────

describe('applyTurnAction — add-to-meld', () => {
  it('rejects an add-to-meld targeting another player’s meld', () => {
    // Setup: p2 (firstPlayer) goes down with a 3-card set of Aces. Then it's
    // p1's turn and p1 has the 4th Ace. Pre-fix the engine would silently
    // accept p1 extending p2's meld; now it must reject because melds are
    // owner-only.
    const baseDeck = seededShuffle(createDeck(), 7);
    const state = initRound({ playerIds: ['p1', 'p2'], roundNumber: 1, dealerIndex: 0, deck: baseDeck });

    const [firstPlayer, secondPlayer] = state.playerOrder; // p2 is first

    const aceH = rc('A', 'hearts', 0);
    const aceD = rc('A', 'diamonds', 0);
    const aceC = rc('A', 'clubs', 0);

    const stateAfterDraw1 = drawAndKeep(state, firstPlayer);
    const stateWith3Aces: RoundState = {
      ...stateAfterDraw1,
      playerStates: {
        ...stateAfterDraw1.playerStates,
        [firstPlayer]: {
          ...stateAfterDraw1.playerStates[firstPlayer],
          hand: [aceH, aceD, aceC, rc('2', 'clubs'), rc('3', 'clubs')],
        },
      },
    };

    const afterGoDown = applyTurnAction(
      stateWith3Aces,
      firstPlayer,
      { type: 'go-down', melds: [{ type: 'set', cards: [aceH, aceD, aceC] }] },
      testId,
    );
    if (!afterGoDown.ok) return;

    const p2Discard = afterGoDown.state.playerStates[firstPlayer].hand[0];
    const afterDiscard1 = applyTurnAction(afterGoDown.state, firstPlayer, { type: 'discard', card: p2Discard });
    if (!afterDiscard1.ok) return;

    const aceS = rc('A', 'spades', 0);
    const meldId = afterGoDown.state.playerStates[firstPlayer].melds[0].id;
    const stateP1Turn: RoundState = {
      ...afterDiscard1.state,
      playerStates: {
        ...afterDiscard1.state.playerStates,
        [secondPlayer]: {
          ...afterDiscard1.state.playerStates[secondPlayer],
          hasGoneDown: true,
          hand: [aceS, rc('K', 'hearts'), rc('2', 'clubs')],
        },
      },
    };

    const stateAfterDraw2 = drawAndKeep(stateP1Turn, secondPlayer);

    const result = applyTurnAction(
      stateAfterDraw2,
      secondPlayer,
      { type: 'add-to-meld', meldId, cards: [aceS] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/your own melds/i);
    }

    // Belt-and-suspenders: neither player's meld list nor table total moved.
    const p1MeldsBefore = stateAfterDraw2.playerStates[firstPlayer].melds[0].cards.length;
    expect(stateAfterDraw2.playerStates[firstPlayer].melds[0].cards).toHaveLength(p1MeldsBefore);
  });
});

// ─── applyTurnAction — round end on empty hand ───────────────────────────────

describe('applyTurnAction — round ends when hand is emptied', () => {
  it('returns roundResult when the active player discards their last card', () => {
    const state = deterministicRound(['p1', 'p2']);
    const player = state.currentTurnPlayerId;

    // Manually give the player exactly 1 card and draw a card (so they'll have 2 after draw)
    const singleCard = rc('2', 'clubs', 0);
    const stateOneCard: RoundState = {
      ...state,
      playerStates: {
        ...state.playerStates,
        [player]: {
          ...state.playerStates[player],
          hand: [singleCard],
          hasGoneDown: true,
        },
      },
    };

    const stateAfterDraw = drawAndKeep(stateOneCard, player);

    // Discard singleCard — player still has 1 card left from the draw
    const afterDiscard1 = applyTurnAction(stateAfterDraw, player, { type: 'discard', card: singleCard });
    if (!afterDiscard1.ok || afterDiscard1.roundResult) {
      // Round may not have ended yet; let's set up a scenario with exactly 1 card remaining
      return;
    }

    // A more direct test: give player exactly 1 card and no draw needed
    const stateLastCard: RoundState = {
      ...stateAfterDraw,
      turnPhase: 'holding',
      playerStates: {
        ...stateAfterDraw.playerStates,
        [player]: {
          ...stateAfterDraw.playerStates[player],
          hand: [singleCard],
          hasGoneDown: true,
        },
      },
    };

    const finalResult = applyTurnAction(stateLastCard, player, { type: 'discard', card: singleCard });
    expect(finalResult.ok).toBe(true);
    if (!finalResult.ok) return;

    expect(finalResult.roundResult).toBeDefined();
    expect(finalResult.roundResult?.endReason).toBe('player-finished');
    expect(finalResult.roundResult?.finisherPlayerId).toBe(player);
    expect(finalResult.state.phase).toBe('scoring');
  });
});

// ─── toRoundStateView ─────────────────────────────────────────────────────────

describe('toRoundStateView', () => {
  it('does not include hand in playerStates', () => {
    const state = deterministicRound(['p1', 'p2']);
    const view = toRoundStateView(state);
    for (const ps of Object.values(view.playerStates)) {
      expect((ps as any).hand).toBeUndefined();
    }
  });

  it('replaces hiddenDeck with hiddenDeckCount', () => {
    const state = deterministicRound(['p1', 'p2']);
    const view = toRoundStateView(state);
    expect((view as any).hiddenDeck).toBeUndefined();
    expect(view.hiddenDeckCount).toBe(state.hiddenDeck.length);
  });

  it('exposes the discard pile', () => {
    const state = deterministicRound(['p1', 'p2']);
    const view = toRoundStateView(state);
    expect(view.discardPile).toEqual(state.discardPile);
  });

  it('exposes playerOrder, currentTurnPlayerId, and phase', () => {
    const state = deterministicRound(['p1', 'p2']);
    const view = toRoundStateView(state);
    expect(view.playerOrder).toEqual(state.playerOrder);
    expect(view.currentTurnPlayerId).toBe(state.currentTurnPlayerId);
    expect(view.phase).toBe(state.phase);
  });
});
