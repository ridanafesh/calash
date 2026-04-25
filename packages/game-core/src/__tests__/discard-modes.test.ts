/**
 * End-to-end tests for the two legal discard-pile take modes, exercised
 * through applyTurnAction so the entire pipeline (turn validator + pile
 * validator + state mutation) is covered.
 *
 * Covers the spec scenarios:
 *   1. one discard card  -> take it + replace from hand  = valid
 *   2. four discard cards -> take three, leave bottom    = valid (no return)
 *   3. four discard cards -> take all + replace          = valid
 *   4. leave-one mode does NOT require an extra hand discard later
 *   5. take-all mode requires a returnCardFromHand
 *   6. after every legal pickup, exactly 1 card remains on the pile
 *   7. after pickup, player cannot go down on the same turn
 *   8. after pickup, player cannot add to meld on the same turn
 *   9. player can take the lone card via take-all-replace mode
 *   10. invalid requests return clear errors (not generic failures)
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
  // Give the opponent a non-empty hand by default so test scenarios that
  // pass turns through them don't accidentally trigger a player-finished
  // round-end when they discard their last card.
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
    turnPhase: 'awaiting-draw-or-take', // can take from discard
    playerStates: { [me]: myPs, [other]: otherPs },
    hiddenDeck: [rc('2', 'clubs'), rc('3', 'clubs')],
    discardPile: [...opts.pile],
    highestTableTotal: myMelds.reduce((s, m) => s + m.totalValue, 0),
    didTakeFromDiscardThisTurn: false,
  };
  return { state, me, other };
}

// ─── Spec scenarios ─────────────────────────────────────────────────────────

describe('Discard pickup — spec scenarios', () => {
  it('1) one discard card: take it + replace from hand → valid', () => {
    const replacement = rc('9', 'clubs');
    const fix = makeDrawPhaseFixture({
      myHand: [rc('K', 'hearts'), replacement],
      pile: [rc('A', 'spades')],
    });
    const r = applyTurnAction(fix.state, fix.me, {
      type: 'take-from-discard',
      count: 1,
      returnCardFromHand: replacement,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Pile now has exactly 1 card (the replacement).
      expect(r.state.discardPile).toHaveLength(1);
      expect(r.state.discardPile[0]).toEqual(replacement);
      // Hand received the original pile card; lost the replacement.
      const hand = r.state.playerStates[fix.me].hand;
      expect(hand).toContainEqual(rc('A', 'spades'));
      expect(hand).not.toContainEqual(replacement);
      // Turn ENDS immediately after take-from-discard. The didTake flag is
      // reset by advanceTurn and the next player is now active.
      expect(r.state.currentTurnPlayerId).toBe(fix.other);
      expect(r.state.turnPhase).toBe('awaiting-draw-or-take');
      expect(r.state.didTakeFromDiscardThisTurn).toBe(false);
    }
  });

  it('2) four discard cards: take 3, leave bottom → valid (no return)', () => {
    const pile = [rc('A', 'spades'), rc('K', 'hearts'), rc('Q', 'clubs'), rc('J', 'diamonds')];
    const fix = makeDrawPhaseFixture({ myHand: [rc('5', 'clubs')], pile });
    const r = applyTurnAction(fix.state, fix.me, {
      type: 'take-from-discard',
      count: 3,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.discardPile).toHaveLength(1);
      expect(r.state.discardPile[0]).toEqual(rc('A', 'spades')); // bottom stays
      const hand = r.state.playerStates[fix.me].hand;
      expect(hand).toHaveLength(1 + 3);
      // Turn ENDS — next player is active.
      expect(r.state.currentTurnPlayerId).toBe(fix.other);
      expect(r.state.turnPhase).toBe('awaiting-draw-or-take');
    }
  });

  it('3) four discard cards: take all 4 + replace → valid', () => {
    const pile = [rc('A', 'spades'), rc('K', 'hearts'), rc('Q', 'clubs'), rc('J', 'diamonds')];
    const replacement = rc('5', 'clubs');
    const fix = makeDrawPhaseFixture({ myHand: [replacement], pile });
    const r = applyTurnAction(fix.state, fix.me, {
      type: 'take-from-discard',
      count: 4,
      returnCardFromHand: replacement,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.discardPile).toEqual([replacement]);
      expect(r.state.playerStates[fix.me].hand).toHaveLength(4);
    }
  });

  it('4) leave-one mode resolves the turn — no extra discard required', () => {
    // The take itself ends the turn. Hand keeps every taken card; nothing
    // else is required of the player. Per the spec, take-from-discard is
    // self-terminating: no follow-up discard, no follow-up meld actions.
    const pile = [rc('A', 'spades'), rc('K', 'hearts'), rc('Q', 'clubs')];
    const fix = makeDrawPhaseFixture({ myHand: [rc('5', 'clubs')], pile });
    const r = applyTurnAction(fix.state, fix.me, { type: 'take-from-discard', count: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // 1 (start) + 2 (taken) = 3 cards in hand. No card returned to pile.
      expect(r.state.playerStates[fix.me].hand).toHaveLength(3);
      expect(r.state.discardPile).toHaveLength(1);
      // Turn handed off to the next player.
      expect(r.state.currentTurnPlayerId).toBe(fix.other);
    }
  });

  it('5) take-all mode requires a returnCardFromHand', () => {
    const pile = [rc('A', 'spades'), rc('K', 'hearts'), rc('Q', 'clubs'), rc('J', 'diamonds')];
    const fix = makeDrawPhaseFixture({ myHand: [rc('5', 'clubs')], pile });
    const r = applyTurnAction(fix.state, fix.me, {
      type: 'take-from-discard',
      count: 4,
      // no returnCardFromHand
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/take-all|put one card|return/i);
  });

  it('6) after every legal pickup, exactly 1 card remains on the pile', () => {
    const cases: Array<{ pile: Card[]; count: number; ret?: Card }> = [
      { pile: [rc('A', 'spades')], count: 1, ret: rc('5', 'clubs') },
      { pile: [rc('A', 'spades'), rc('K', 'hearts')], count: 1 },
      { pile: [rc('A', 'spades'), rc('K', 'hearts')], count: 2, ret: rc('5', 'clubs') },
      { pile: [rc('A', 'spades'), rc('K', 'hearts'), rc('Q', 'clubs'), rc('J', 'diamonds')], count: 3 },
      { pile: [rc('A', 'spades'), rc('K', 'hearts'), rc('Q', 'clubs'), rc('J', 'diamonds')], count: 4, ret: rc('5', 'clubs') },
    ];
    for (const { pile, count, ret } of cases) {
      const fix = makeDrawPhaseFixture({ myHand: ret ? [ret] : [rc('5', 'clubs')], pile });
      const r = applyTurnAction(fix.state, fix.me, {
        type: 'take-from-discard',
        count,
        ...(ret ? { returnCardFromHand: ret } : {}),
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.state.discardPile).toHaveLength(1);
    }
  });

  it('7) after pickup, player cannot go down on the same turn (turn already over)', () => {
    // The take ENDS the turn — so attempting any action as the same player
    // is rejected because it's no longer their turn. This is the strongest
    // possible enforcement of the "no go-down after take-from-discard" rule.
    const fix = makeDrawPhaseFixture({
      myHand: [
        rc('A', 'spades'), rc('A', 'hearts'), rc('A', 'diamonds'), // 75-pt set
        rc('5', 'clubs'),
      ],
      pile: [rc('K', 'spades'), rc('K', 'hearts')],
    });
    const taken = applyTurnAction(fix.state, fix.me, { type: 'take-from-discard', count: 1 });
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

  it('8) after pickup, player cannot add to meld on the same turn (turn already over)', () => {
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
    const taken = applyTurnAction(fix.state, fix.me, { type: 'take-from-discard', count: 1 });
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

  it('draw-from-deck DOES leave the player in holding (must discard) — verifies path separation', () => {
    // Critical separation: draw-from-deck still requires a discard to end the
    // turn; only take-from-discard is self-terminating.
    const fix = makeDrawPhaseFixture({ myHand: [rc('5', 'clubs')], pile: [rc('K', 'hearts')] });
    const r = applyTurnAction(fix.state, fix.me, { type: 'draw-from-deck' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.currentTurnPlayerId).toBe(fix.me); // still my turn
      expect(r.state.turnPhase).toBe('holding');
      expect(r.state.didTakeFromDiscardThisTurn).toBe(false);
    }
  });

  it('on the next turn after take-from-discard, player CAN go down again', () => {
    // Spec scenario 9: ensure restrictions are scoped to this turn only.
    const fix = makeDrawPhaseFixture({
      myHand: [
        rc('A', 'spades'), rc('A', 'hearts'), rc('A', 'diamonds'),
        rc('5', 'clubs'),
      ],
      pile: [rc('K', 'spades'), rc('K', 'hearts')],
    });
    // Turn 1 (me): take from discard → turn ends.
    const after1 = applyTurnAction(fix.state, fix.me, { type: 'take-from-discard', count: 1 });
    expect(after1.ok).toBe(true);
    if (!after1.ok) return;
    expect(after1.state.currentTurnPlayerId).toBe(fix.other);

    // Turn 2 (other): draw + discard to end their turn so it comes back to me.
    const otherDraw = applyTurnAction(after1.state, fix.other, { type: 'draw-from-deck' });
    expect(otherDraw.ok).toBe(true);
    if (!otherDraw.ok) return;
    const otherHand = otherDraw.state.playerStates[fix.other].hand;
    const otherDiscard = applyTurnAction(otherDraw.state, fix.other, {
      type: 'discard',
      card: otherHand[0],
    });
    expect(otherDiscard.ok).toBe(true);
    if (!otherDiscard.ok) return;
    expect(otherDiscard.state.currentTurnPlayerId).toBe(fix.me);

    // Turn 3 (me again): draw, then go down. didTakeFromDiscardThisTurn was
    // reset on the previous advanceTurn so the go-down restriction is gone.
    const draw = applyTurnAction(otherDiscard.state, fix.me, { type: 'draw-from-deck' });
    expect(draw.ok).toBe(true);
    if (!draw.ok) return;

    const myHand = draw.state.playerStates[fix.me].hand;
    const aces = myHand.filter((c) => !c.isJoker && c.rank === 'A');
    expect(aces.length).toBeGreaterThanOrEqual(3);

    const goDown = applyTurnAction(draw.state, fix.me, {
      type: 'go-down',
      melds: [{ type: 'set', cards: aces.slice(0, 3) }],
    });
    expect(goDown.ok).toBe(true);
  });

  it('on the next turn after take-from-discard, player CAN add to existing melds', () => {
    // Spec scenario 10. Set up a player who already went down, takes from
    // discard (turn ends), then on a later turn extends their existing meld.
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
    // Take from discard → turn ends.
    const taken = applyTurnAction(fix.state, fix.me, { type: 'take-from-discard', count: 1 });
    expect(taken.ok).toBe(true);
    if (!taken.ok) return;

    // Other player draws + discards to pass turn back.
    const otherDraw = applyTurnAction(taken.state, fix.other, { type: 'draw-from-deck' });
    if (!otherDraw.ok) return;
    const otherHand = otherDraw.state.playerStates[fix.other].hand;
    const otherDiscard = applyTurnAction(otherDraw.state, fix.other, {
      type: 'discard',
      card: otherHand[0],
    });
    expect(otherDiscard.ok).toBe(true);
    if (!otherDiscard.ok) return;

    // My turn again: draw + extend my meld with 4♣.
    const draw = applyTurnAction(otherDiscard.state, fix.me, { type: 'draw-from-deck' });
    if (!draw.ok) return;
    const extend = applyTurnAction(draw.state, fix.me, {
      type: 'add-to-meld',
      meldId: myMeld.id,
      cards: [rc('4', 'clubs')],
    });
    expect(extend.ok).toBe(true);
  });

  it('9) player can take the lone card via take-all-replace mode', () => {
    // Re-asserts spec case 1 from a different angle: the previously-blocked
    // pile.length === 1 case is now legal as long as it goes via take-all-replace.
    const replacement = rc('5', 'clubs');
    const fix = makeDrawPhaseFixture({
      myHand: [replacement],
      pile: [rc('A', 'spades')],
    });
    const r = applyTurnAction(fix.state, fix.me, {
      type: 'take-from-discard',
      count: 1,
      returnCardFromHand: replacement,
    });
    expect(r.ok).toBe(true);
  });

  it('10) invalid requests return clear, specific errors (not "Internal server error")', () => {
    const cases: Array<{ label: string; pile: Card[]; count: number; ret?: Card; expectMatch: RegExp }> = [
      {
        label: 'wrong count for pile size',
        pile: [rc('A', 'spades'), rc('K', 'hearts'), rc('Q', 'clubs'), rc('J', 'diamonds')],
        count: 2,
        expectMatch: /Invalid take count/i,
      },
      {
        label: 'take-all without return',
        pile: [rc('A', 'spades'), rc('K', 'hearts')],
        count: 2,
        expectMatch: /take-all|put one card|return/i,
      },
      {
        label: 'returnCard not in hand',
        pile: [rc('A', 'spades')],
        count: 1,
        ret: rc('Q', 'hearts'), // hand only has 5♣
        expectMatch: /not in your hand/i,
      },
      {
        label: 'lone card without return',
        pile: [rc('A', 'spades')],
        count: 1,
        expectMatch: /take-all|put one card|return/i,
      },
    ];
    for (const c of cases) {
      const fix = makeDrawPhaseFixture({ myHand: [rc('5', 'clubs')], pile: c.pile });
      const r = applyTurnAction(fix.state, fix.me, {
        type: 'take-from-discard',
        count: c.count,
        ...(c.ret ? { returnCardFromHand: c.ret } : {}),
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toMatch(c.expectMatch);
        // Ensure no generic "Internal server error" leaks through.
        expect(r.error).not.toMatch(/internal server error/i);
      } else {
        throw new Error(`Expected ${c.label} to be rejected`);
      }
    }
  });
});
