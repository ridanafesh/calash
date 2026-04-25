/**
 * add-to-meld and add-new-meld validation + state-mutation tests.
 *
 * Covers the spec cases:
 *   - Sequence extension on either side (low + high), incl. Ace at high end
 *   - Set extension with the missing-suit 4th card
 *   - Set extension rejection on duplicate suit
 *   - Turn restrictions: not your turn, after take-from-discard
 *   - Score attribution: extension value goes to the contributor's tableTotal,
 *     not the meld owner's
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

function makeFixture(opts: {
  myHand: Card[];
  myMelds?: Meld[];
  otherMelds?: Meld[];
  hasGoneDown?: boolean;
  isMyTurn?: boolean;
  didTakeFromDiscard?: boolean;
  highestTableTotal?: number;
}): Fixture {
  const me = 'me';
  const other = 'other';
  const myMelds = opts.myMelds ?? [];
  const otherMelds = opts.otherMelds ?? [];
  const myPs: PlayerRoundState = {
    playerId: me,
    hand: [...opts.myHand],
    melds: myMelds,
    hasGoneDown: opts.hasGoneDown ?? true,
    tableTotal: myMelds.reduce((s, m) => s + m.totalValue, 0),
  };
  const otherPs: PlayerRoundState = {
    playerId: other,
    hand: [],
    melds: otherMelds,
    hasGoneDown: otherMelds.length > 0,
    tableTotal: otherMelds.reduce((s, m) => s + m.totalValue, 0),
  };
  const state: RoundState = {
    roundNumber: 1,
    dealerPlayerId: other,
    playerOrder: [me, other],
    currentTurnPlayerId: opts.isMyTurn === false ? other : me,
    phase: 'in-progress',
    turnPhase: 'holding',
    playerStates: { [me]: myPs, [other]: otherPs },
    hiddenDeck: [rc('2', 'clubs')],
    discardPile: [rc('5', 'spades')],
    highestTableTotal: opts.highestTableTotal ?? Math.max(myPs.tableTotal, otherPs.tableTotal),
    didTakeFromDiscardThisTurn: opts.didTakeFromDiscard ?? false,
  };
  return { state, me, other };
}

const seqHearts10toK: Meld = {
  id: 'seq-hearts-10-to-k',
  type: 'sequence',
  cards: [rc('10', 'hearts'), rc('J', 'hearts'), rc('Q', 'hearts'), rc('K', 'hearts')],
  totalValue: 40,
};

const seqClubs5to7: Meld = {
  id: 'seq-clubs-5-to-7',
  type: 'sequence',
  cards: [rc('5', 'clubs'), rc('6', 'clubs'), rc('7', 'clubs')],
  totalValue: 18,
};

const setKings3: Meld = {
  id: 'set-kings-3',
  type: 'set',
  cards: [rc('K', 'hearts'), rc('K', 'diamonds'), rc('K', 'clubs')],
  totalValue: 30,
};

// ─── Sequence extensions ─────────────────────────────────────────────────────

describe('add-to-meld — sequence extensions', () => {
  it('adds 9♥ to existing 10-J-Q-K♥ (low side)', () => {
    const fix = makeFixture({ myHand: [rc('9', 'hearts'), rc('2', 'clubs')], myMelds: [seqHearts10toK] });
    const r = applyTurnAction(fix.state, fix.me, {
      type: 'add-to-meld',
      meldId: seqHearts10toK.id,
      cards: [rc('9', 'hearts')],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const updated = r.state.playerStates[fix.me].melds.find((m) => m.id === seqHearts10toK.id);
      expect(updated?.cards.map((c) => c.isJoker ? 'J' : c.rank).sort()).toEqual(['10', '9', 'J', 'K', 'Q'].sort());
      expect(updated?.totalValue).toBe(49);
      // Hand shrunk by 1
      expect(r.state.playerStates[fix.me].hand).toHaveLength(1);
      // Score attribution: contributor's tableTotal got +9, NOT the owner's
      // (in this test the owner IS me, so this also equals the new total).
      expect(r.state.playerStates[fix.me].tableTotal).toBe(49);
    }
  });

  it('adds A♥ to existing 10-J-Q-K♥ (high side)', () => {
    const fix = makeFixture({ myHand: [rc('A', 'hearts'), rc('2', 'clubs')], myMelds: [seqHearts10toK] });
    const r = applyTurnAction(fix.state, fix.me, {
      type: 'add-to-meld',
      meldId: seqHearts10toK.id,
      cards: [rc('A', 'hearts')],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const updated = r.state.playerStates[fix.me].melds.find((m) => m.id === seqHearts10toK.id);
      // A♥ counts 25 → total goes from 40 to 65.
      expect(updated?.totalValue).toBe(65);
    }
  });

  it('adds 4♣ to existing 5-6-7♣ (low side)', () => {
    const fix = makeFixture({ myHand: [rc('4', 'clubs'), rc('2', 'hearts')], myMelds: [seqClubs5to7] });
    const r = applyTurnAction(fix.state, fix.me, {
      type: 'add-to-meld',
      meldId: seqClubs5to7.id,
      cards: [rc('4', 'clubs')],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const updated = r.state.playerStates[fix.me].melds.find((m) => m.id === seqClubs5to7.id);
      expect(updated?.totalValue).toBe(22);
    }
  });

  it('rejects extension that breaks sequence rules (8♣ + gap)', () => {
    // Adding 9♣ to 5-6-7♣ would be valid (8 wouldn't, since pile is 5-6-7).
    // Try adding 9 with no 8 — gap.
    const fix = makeFixture({ myHand: [rc('9', 'clubs'), rc('2', 'hearts')], myMelds: [seqClubs5to7] });
    const r = applyTurnAction(fix.state, fix.me, {
      type: 'add-to-meld',
      meldId: seqClubs5to7.id,
      cards: [rc('9', 'clubs')],
    });
    expect(r.ok).toBe(false);
  });
});

// ─── Set extensions ──────────────────────────────────────────────────────────

describe('add-to-meld — set extensions', () => {
  it('adds K♠ to set {K♥,K♦,K♣} (unique missing suit)', () => {
    const fix = makeFixture({ myHand: [rc('K', 'spades'), rc('2', 'clubs')], myMelds: [setKings3] });
    const r = applyTurnAction(fix.state, fix.me, {
      type: 'add-to-meld',
      meldId: setKings3.id,
      cards: [rc('K', 'spades')],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const updated = r.state.playerStates[fix.me].melds.find((m) => m.id === setKings3.id);
      expect(updated?.cards).toHaveLength(4);
      expect(updated?.totalValue).toBe(40);
    }
  });

  it('rejects duplicate-suit set extension (K♥ second copy)', () => {
    const fix = makeFixture({ myHand: [rc('K', 'hearts', 1), rc('2', 'clubs')], myMelds: [setKings3] });
    const r = applyTurnAction(fix.state, fix.me, {
      type: 'add-to-meld',
      meldId: setKings3.id,
      cards: [rc('K', 'hearts', 1)],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/different suits/i);
    }
  });

  it('rejects 5th card on a set (max set size is 4)', () => {
    const fullSet: Meld = {
      ...setKings3,
      cards: [...setKings3.cards, rc('K', 'spades')],
      totalValue: 40,
    };
    const fix = makeFixture({ myHand: [rc('K', 'hearts', 1)], myMelds: [fullSet] });
    const r = applyTurnAction(fix.state, fix.me, {
      type: 'add-to-meld',
      meldId: fullSet.id,
      cards: [rc('K', 'hearts', 1)],
    });
    expect(r.ok).toBe(false);
  });
});

// ─── Turn restrictions ──────────────────────────────────────────────────────

describe('add-to-meld — turn restrictions', () => {
  it('rejects when it is not my turn', () => {
    const fix = makeFixture({
      myHand: [rc('9', 'hearts'), rc('2', 'clubs')],
      myMelds: [seqHearts10toK],
      isMyTurn: false,
    });
    const r = applyTurnAction(fix.state, fix.me, {
      type: 'add-to-meld',
      meldId: seqHearts10toK.id,
      cards: [rc('9', 'hearts')],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/not your turn|other's turn|other.*turn/i);
    }
  });

  it('rejects on the same turn the player took from the discard pile', () => {
    const fix = makeFixture({
      myHand: [rc('9', 'hearts'), rc('2', 'clubs')],
      myMelds: [seqHearts10toK],
      didTakeFromDiscard: true,
    });
    const r = applyTurnAction(fix.state, fix.me, {
      type: 'add-to-meld',
      meldId: seqHearts10toK.id,
      cards: [rc('9', 'hearts')],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/same turn.*discard/i);
    }
  });

  it('rejects if the player has not gone down yet', () => {
    const fix = makeFixture({
      myHand: [rc('9', 'hearts'), rc('2', 'clubs')],
      myMelds: [],
      hasGoneDown: false,
      otherMelds: [seqHearts10toK], // owned by opponent
    });
    const r = applyTurnAction(fix.state, fix.me, {
      type: 'add-to-meld',
      meldId: seqHearts10toK.id,
      cards: [rc('9', 'hearts')],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/must go down/i);
    }
  });

  it('also blocks add-NEW-meld after take-from-discard', () => {
    const fix = makeFixture({
      myHand: [rc('5', 'hearts'), rc('5', 'diamonds'), rc('5', 'clubs'), rc('2', 'spades')],
      myMelds: [seqClubs5to7],
      didTakeFromDiscard: true,
    });
    const r = applyTurnAction(fix.state, fix.me, {
      type: 'add-new-meld',
      meld: { type: 'set', cards: [rc('5', 'hearts'), rc('5', 'diamonds'), rc('5', 'clubs')] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/same turn.*discard/i);
    }
  });
});

// ─── Owner-only rule ────────────────────────────────────────────────────────
//
// Ownership is private even though melds are publicly visible. Only the
// player who placed a meld may extend it (or replace a joker inside it).
// Previously this file asserted that cross-player extension was allowed and
// that the contributor's tableTotal absorbed the value; that rule is gone.
// Cross-player extension must now be rejected at validation time with a
// clear, user-facing message.

describe('add-to-meld — owner-only enforcement', () => {
  it('rejects extending another player’s sequence', () => {
    const myOwnMeld: Meld = {
      id: 'mine',
      type: 'sequence',
      cards: [rc('2', 'spades'), rc('3', 'spades'), rc('4', 'spades')],
      totalValue: 9,
    };
    const opponentMeld: Meld = { ...seqHearts10toK }; // owned by opponent
    const fix = makeFixture({
      myHand: [rc('A', 'hearts'), rc('2', 'clubs')],
      myMelds: [myOwnMeld],
      otherMelds: [opponentMeld],
    });

    const r = applyTurnAction(fix.state, fix.me, {
      type: 'add-to-meld',
      meldId: opponentMeld.id,
      cards: [rc('A', 'hearts')],
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/your own melds/i);
    }
    // Opponent's meld is unchanged.
    expect(fix.state.playerStates[fix.other].melds[0].cards).toHaveLength(4);
  });

  it("rejects extending another player's set", () => {
    const opponentSet: Meld = { ...setKings3 }; // K♥ K♦ K♣, owned by opponent
    const fix = makeFixture({
      myHand: [rc('K', 'spades'), rc('2', 'clubs')],
      myMelds: [
        // Some throwaway meld so I'm down
        { id: 'mine', type: 'sequence', cards: [rc('2', 'spades'), rc('3', 'spades'), rc('4', 'spades')], totalValue: 9 },
      ],
      otherMelds: [opponentSet],
    });

    const r = applyTurnAction(fix.state, fix.me, {
      type: 'add-to-meld',
      meldId: opponentSet.id,
      cards: [rc('K', 'spades')],
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/your own melds/i);
  });

  it('still allows extending my own sequence', () => {
    const fix = makeFixture({
      myHand: [rc('9', 'hearts'), rc('2', 'clubs')],
      myMelds: [seqHearts10toK],
    });
    const r = applyTurnAction(fix.state, fix.me, {
      type: 'add-to-meld',
      meldId: seqHearts10toK.id,
      cards: [rc('9', 'hearts')],
    });
    expect(r.ok).toBe(true);
  });

  it('still allows extending my own set', () => {
    const fix = makeFixture({
      myHand: [rc('K', 'spades'), rc('2', 'clubs')],
      myMelds: [setKings3],
    });
    const r = applyTurnAction(fix.state, fix.me, {
      type: 'add-to-meld',
      meldId: setKings3.id,
      cards: [rc('K', 'spades')],
    });
    expect(r.ok).toBe(true);
  });
});
