/**
 * End-to-end tests for the two legal discard-pile take modes, exercised
 * through applyTurnAction so the entire pipeline (turn validator + pile
 * validator + state mutation) is covered.
 *
 * Two legal modes:
 *
 *   LEAVE-ONE       : { type: 'take-from-discard', keepOnPileCard }
 *                     The chosen pile card stays on the pile; every other
 *                     card moves to the player's hand. No follow-up
 *                     discard required. pile.length must be ≥ 2.
 *
 *   TAKE-ALL-REPLACE: { type: 'take-from-discard', returnCardFromHand }
 *                     The whole pile moves to the player's hand; the
 *                     returned card goes onto the pile. Works for any
 *                     pile.length ≥ 1. The returned card may be one the
 *                     player originally held OR one of the just-picked-up
 *                     cards (it lives in the post-pickup hand).
 *
 * Both modes self-terminate the turn — no go-down / add-to-meld /
 * replace-joker is allowed afterwards in the same turn.
 */

import type {
  Card,
  Meld,
  PlayerRoundState,
  RegularCard,
  RoundState,
} from '@calash/shared';
import { applyTurnAction } from '../engine.js';

const rc = (rank: RegularCard['rank'], suit: RegularCard['suit'], deckIndex: 0 | 1 = 0): RegularCard =>
  ({ rank, suit, isJoker: false, deckIndex });

/** Draw-from-deck + keep-drawn-card in one helper. */
function drawAndKeep(state: RoundState, playerId: string): RoundState {
  const r1 = applyTurnAction(state, playerId, { type: 'draw-from-deck' });
  if (!r1.ok) throw new Error(`drawAndKeep draw failed: ${r1.error}`);
  const r2 = applyTurnAction(r1.state, playerId, { type: 'keep-drawn-card' });
  if (!r2.ok) throw new Error(`drawAndKeep keep failed: ${r2.error}`);
  return r2.state;
}

interface Fixture {
  state: RoundState;
  me: string;
  other: string;
}

function makeDrawPhaseFixture(opts: {
  myHand: Card[];
  pile: Card[];
  myMelds?: Meld[];
  hasGoneDown?: boolean;
  otherHand?: Card[];
}): Fixture {
  const me = 'me';
  const other = 'other';
  const myMelds = opts.myMelds ?? [];
  const myPs: PlayerRoundState = {
    playerId: me,
    hand: [...opts.myHand],
    melds: myMelds,
    hasGoneDown: opts.hasGoneDown ?? false,
    tableTotal: myMelds.reduce((s, m) => s + m.totalValue, 0),
  };
  const otherPs: PlayerRoundState = {
    playerId: other,
    hand: opts.otherHand ?? [rc('7', 'spades'), rc('8', 'diamonds')],
    melds: [],
    hasGoneDown: false,
    tableTotal: 0,
  };
  const state: RoundState = {
    roundNumber: 1,
    dealerPlayerId: other,
    playerOrder: [me, other],
    currentTurnPlayerId: me,
    phase: 'in-progress',
    turnPhase: 'awaiting-draw-or-take',
    playerStates: { [me]: myPs, [other]: otherPs },
    hiddenDeck: [rc('2', 'clubs'), rc('3', 'clubs')],
    discardPile: [...opts.pile],
    highestTableTotal: myMelds.reduce((s, m) => s + m.totalValue, 0),
    didTakeFromDiscardThisTurn: false,
  };
  return { state, me, other };
}

// ─── LEAVE-ONE mode ─────────────────────────────────────────────────────────

describe('LEAVE-ONE — player chooses which pile card stays', () => {
  it('keeps the BOTTOM card when chosen', () => {
    const pile = [rc('A', 'spades'), rc('K', 'hearts'), rc('Q', 'clubs'), rc('J', 'diamonds')];
    const fix = makeDrawPhaseFixture({ myHand: [rc('5', 'clubs')], pile });
    const r = applyTurnAction(fix.state, fix.me, {
      type: 'take-from-discard',
      keepOnPileCard: rc('A', 'spades'),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.discardPile).toEqual([rc('A', 'spades')]);
      const hand = r.state.playerStates[fix.me].hand;
      expect(hand).toHaveLength(1 + 3);
      expect(r.state.currentTurnPlayerId).toBe(fix.other);
    }
  });

  it('keeps the TOP card when chosen', () => {
    const pile = [rc('A', 'spades'), rc('K', 'hearts'), rc('Q', 'clubs'), rc('J', 'diamonds')];
    const fix = makeDrawPhaseFixture({ myHand: [rc('5', 'clubs')], pile });
    const r = applyTurnAction(fix.state, fix.me, {
      type: 'take-from-discard',
      keepOnPileCard: rc('J', 'diamonds'),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.discardPile).toEqual([rc('J', 'diamonds')]);
      // Other 3 pile cards moved to my hand.
      expect(r.state.playerStates[fix.me].hand).toHaveLength(4);
    }
  });

  it('keeps a MIDDLE card when chosen (the new flexibility)', () => {
    const pile = [rc('A', 'spades'), rc('K', 'hearts'), rc('Q', 'clubs'), rc('J', 'diamonds'), rc('10', 'hearts')];
    const fix = makeDrawPhaseFixture({ myHand: [rc('5', 'clubs')], pile });
    const r = applyTurnAction(fix.state, fix.me, {
      type: 'take-from-discard',
      keepOnPileCard: rc('Q', 'clubs'), // 3rd from bottom
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.discardPile).toEqual([rc('Q', 'clubs')]);
      const hand = r.state.playerStates[fix.me].hand;
      // 1 (start) + 4 (the 4 non-Q cards) = 5
      expect(hand).toHaveLength(5);
    }
  });

  it('rejects leave-one when the chosen card is not on the pile', () => {
    const fix = makeDrawPhaseFixture({
      myHand: [rc('5', 'clubs')],
      pile: [rc('A', 'spades'), rc('K', 'hearts')],
    });
    const r = applyTurnAction(fix.state, fix.me, {
      type: 'take-from-discard',
      keepOnPileCard: rc('Q', 'diamonds'),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not currently on the discard pile/i);
  });

  it('rejects leave-one on a 1-card pile (no-op)', () => {
    const fix = makeDrawPhaseFixture({
      myHand: [rc('5', 'clubs')],
      pile: [rc('A', 'spades')],
    });
    const r = applyTurnAction(fix.state, fix.me, {
      type: 'take-from-discard',
      keepOnPileCard: rc('A', 'spades'),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no-op|take-all/i);
  });
});

// ─── TAKE-ALL-REPLACE mode ──────────────────────────────────────────────────

describe('TAKE-ALL-REPLACE — return card from hand', () => {
  it('returning a card the player originally held is accepted', () => {
    const replacement = rc('5', 'clubs');
    const fix = makeDrawPhaseFixture({
      myHand: [rc('K', 'hearts'), replacement],
      pile: [rc('A', 'spades'), rc('A', 'hearts')],
    });
    const r = applyTurnAction(fix.state, fix.me, {
      type: 'take-from-discard',
      returnCardFromHand: replacement,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.discardPile).toEqual([replacement]);
      const hand = r.state.playerStates[fix.me].hand;
      // Started with 2 hand + took 2 from pile - returned 1 = 3
      expect(hand).toHaveLength(3);
      expect(hand).toContainEqual(rc('A', 'spades'));
      expect(hand).toContainEqual(rc('A', 'hearts'));
      expect(hand).toContainEqual(rc('K', 'hearts'));
      expect(hand).not.toContainEqual(replacement);
    }
  });

  it('returning a card the player JUST PICKED UP from the pile is accepted', () => {
    // Spec: "the chosen card may be ... one of the cards they just picked up
    // from the discard pile, if after pickup it is now in hand."
    const fix = makeDrawPhaseFixture({
      myHand: [rc('5', 'clubs')],
      pile: [rc('A', 'spades'), rc('K', 'hearts'), rc('Q', 'clubs')],
    });
    const r = applyTurnAction(fix.state, fix.me, {
      type: 'take-from-discard',
      returnCardFromHand: rc('K', 'hearts'), // currently on the pile, not in hand
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.discardPile).toEqual([rc('K', 'hearts')]);
      const hand = r.state.playerStates[fix.me].hand;
      // Started with 1, took 3, returned 1 = 3
      expect(hand).toHaveLength(3);
      expect(hand).toContainEqual(rc('5', 'clubs'));
      expect(hand).toContainEqual(rc('A', 'spades'));
      expect(hand).toContainEqual(rc('Q', 'clubs'));
      expect(hand).not.toContainEqual(rc('K', 'hearts')); // returned to pile
    }
  });

  it('works on a 1-card pile (the previously-blocked case)', () => {
    const replacement = rc('5', 'clubs');
    const fix = makeDrawPhaseFixture({
      myHand: [replacement],
      pile: [rc('A', 'spades')],
    });
    const r = applyTurnAction(fix.state, fix.me, {
      type: 'take-from-discard',
      returnCardFromHand: replacement,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.discardPile).toEqual([replacement]);
      expect(r.state.playerStates[fix.me].hand).toEqual([rc('A', 'spades')]);
    }
  });

  it('rejects when the returned card is neither in hand nor on the pile', () => {
    const fix = makeDrawPhaseFixture({
      myHand: [rc('5', 'clubs')],
      pile: [rc('A', 'spades')],
    });
    const r = applyTurnAction(fix.state, fix.me, {
      type: 'take-from-discard',
      returnCardFromHand: rc('Q', 'hearts'),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not in your hand or on the discard pile/i);
  });

  it('rejects when neither keepOnPileCard nor returnCardFromHand is supplied', () => {
    const fix = makeDrawPhaseFixture({
      myHand: [rc('5', 'clubs')],
      pile: [rc('A', 'spades'), rc('K', 'hearts')],
    });
    const r = applyTurnAction(fix.state, fix.me, { type: 'take-from-discard' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/specify/i);
  });

  it('rejects when both modes are supplied at once', () => {
    const fix = makeDrawPhaseFixture({
      myHand: [rc('5', 'clubs')],
      pile: [rc('A', 'spades'), rc('K', 'hearts')],
    });
    const r = applyTurnAction(fix.state, fix.me, {
      type: 'take-from-discard',
      keepOnPileCard: rc('A', 'spades'),
      returnCardFromHand: rc('5', 'clubs'),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/one mode/i);
  });
});

// ─── Invariants & turn-end restrictions ─────────────────────────────────────

describe('After every legal pickup, exactly 1 card remains on the pile', () => {
  it('holds across both modes and many pile sizes', () => {
    const cases: Array<{
      pile: Card[];
      action: { keepOnPileCard?: Card; returnCardFromHand?: Card };
      myHand: Card[];
    }> = [
      // LEAVE-ONE
      {
        pile: [rc('A', 'spades'), rc('K', 'hearts')],
        action: { keepOnPileCard: rc('A', 'spades') },
        myHand: [rc('5', 'clubs')],
      },
      {
        pile: [rc('A', 'spades'), rc('K', 'hearts'), rc('Q', 'clubs'), rc('J', 'diamonds')],
        action: { keepOnPileCard: rc('Q', 'clubs') },
        myHand: [rc('5', 'clubs')],
      },
      // TAKE-ALL-REPLACE
      {
        pile: [rc('A', 'spades')],
        action: { returnCardFromHand: rc('5', 'clubs') },
        myHand: [rc('5', 'clubs')],
      },
      {
        pile: [rc('A', 'spades'), rc('K', 'hearts'), rc('Q', 'clubs'), rc('J', 'diamonds')],
        action: { returnCardFromHand: rc('5', 'clubs') },
        myHand: [rc('5', 'clubs')],
      },
      // TAKE-ALL-REPLACE returning a just-picked-up card
      {
        pile: [rc('A', 'spades'), rc('K', 'hearts')],
        action: { returnCardFromHand: rc('A', 'spades') },
        myHand: [rc('5', 'clubs')],
      },
    ];
    for (const c of cases) {
      const fix = makeDrawPhaseFixture({ myHand: c.myHand, pile: c.pile });
      const r = applyTurnAction(fix.state, fix.me, {
        type: 'take-from-discard',
        ...c.action,
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.state.discardPile).toHaveLength(1);
    }
  });
});

describe('Take-from-discard self-terminates the turn', () => {
  it('after pickup, player cannot go down on the same turn (turn already over)', () => {
    const fix = makeDrawPhaseFixture({
      myHand: [
        rc('A', 'spades'), rc('A', 'hearts'), rc('A', 'diamonds'),
        rc('5', 'clubs'),
      ],
      pile: [rc('K', 'spades'), rc('K', 'hearts')],
    });
    const taken = applyTurnAction(fix.state, fix.me, {
      type: 'take-from-discard',
      keepOnPileCard: rc('K', 'spades'),
    });
    expect(taken.ok).toBe(true);
    if (!taken.ok) return;
    expect(taken.state.currentTurnPlayerId).toBe(fix.other);

    const tryGoDown = applyTurnAction(taken.state, fix.me, {
      type: 'go-down',
      melds: [{ type: 'set', cards: [rc('A', 'spades'), rc('A', 'hearts'), rc('A', 'diamonds')] }],
    });
    expect(tryGoDown.ok).toBe(false);
    if (!tryGoDown.ok) expect(tryGoDown.error).toMatch(/not.*me'?s|other'?s turn/i);
  });

  it('after pickup, player cannot add to meld on the same turn', () => {
    const myMeld: Meld = {
      id: '11111111-1111-1111-1111-111111111111',
      type: 'sequence',
      cards: [rc('5', 'clubs'), rc('6', 'clubs'), rc('7', 'clubs')],
      totalValue: 18,
    };
    const fix = makeDrawPhaseFixture({
      myHand: [rc('4', 'clubs'), rc('9', 'spades')],
      pile: [rc('K', 'spades'), rc('K', 'hearts')],
      myMelds: [myMeld],
      hasGoneDown: true,
    });
    const taken = applyTurnAction(fix.state, fix.me, {
      type: 'take-from-discard',
      keepOnPileCard: rc('K', 'spades'),
    });
    expect(taken.ok).toBe(true);
    if (!taken.ok) return;
    expect(taken.state.currentTurnPlayerId).toBe(fix.other);

    const tryAdd = applyTurnAction(taken.state, fix.me, {
      type: 'add-to-meld',
      meldId: myMeld.id,
      cards: [rc('4', 'clubs')],
    });
    expect(tryAdd.ok).toBe(false);
    if (!tryAdd.ok) expect(tryAdd.error).toMatch(/not.*me'?s|other'?s turn/i);
  });

  it('on the next turn, restrictions are gone', () => {
    const fix = makeDrawPhaseFixture({
      myHand: [
        rc('A', 'spades'), rc('A', 'hearts'), rc('A', 'diamonds'),
        rc('5', 'clubs'),
      ],
      pile: [rc('K', 'spades'), rc('K', 'hearts')],
    });
    const after1 = applyTurnAction(fix.state, fix.me, {
      type: 'take-from-discard',
      keepOnPileCard: rc('K', 'spades'),
    });
    expect(after1.ok).toBe(true);
    if (!after1.ok) return;

    const otherStateAfterDraw = drawAndKeep(after1.state, fix.other);
    const otherHand = otherStateAfterDraw.playerStates[fix.other].hand;
    const otherDiscard = applyTurnAction(otherStateAfterDraw, fix.other, {
      type: 'discard',
      card: otherHand[0],
    });
    expect(otherDiscard.ok).toBe(true);
    if (!otherDiscard.ok) return;

    const stateAfterMyDraw = drawAndKeep(otherDiscard.state, fix.me);
    const myHand = stateAfterMyDraw.playerStates[fix.me].hand;
    const aces = myHand.filter((c) => !c.isJoker && c.rank === 'A');
    expect(aces.length).toBeGreaterThanOrEqual(3);

    const goDown = applyTurnAction(stateAfterMyDraw, fix.me, {
      type: 'go-down',
      melds: [{ type: 'set', cards: aces.slice(0, 3) }],
    });
    expect(goDown.ok).toBe(true);
  });
});

describe('draw-from-deck does NOT advance the turn', () => {
  it('only take-from-discard is self-terminating', () => {
    const fix = makeDrawPhaseFixture({ myHand: [rc('5', 'clubs')], pile: [rc('K', 'hearts')] });
    const r = applyTurnAction(fix.state, fix.me, { type: 'draw-from-deck' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.currentTurnPlayerId).toBe(fix.me);
      expect(r.state.turnPhase).toBe('pending-drawn-decision');
      expect(r.state.didTakeFromDiscardThisTurn).toBe(false);
    }
  });
});
