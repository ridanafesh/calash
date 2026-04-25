/**
 * Joker assignment + replacement tests.
 *
 * Covers the rules added in PR #joker-replacement:
 *   1. computeJokerCandidates: enumerates legal rank/suit positions
 *   2. resolveJokerAssignment: auto-resolves unambiguous, surfaces ambiguity,
 *      validates client-supplied choices against the legal set
 *   3. Engine wires the assignment onto Meld at go-down / add-new-meld /
 *      add-to-meld time
 *   4. replace-joker action — sequences require exact rank+suit match;
 *      sets enforce the natural-4-suits-required reclaim rule
 *   5. Joker still scores as 25 in melds, regardless of what it represents
 */

import type { Card, JokerCard, Meld, RegularCard, RoundState } from '@calash/shared';
import { CARD_VALUES } from '@calash/shared';
import { applyTurnAction, initRound, type ApplyResult } from '../engine.js';
import {
  computeJokerCandidates,
  resolveJokerAssignment,
  validateMeld,
  cardValue,
} from '../meld.js';
import { seededShuffle } from '../seeded-random.js';
import { createDeck } from '../deck.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const rc = (rank: RegularCard['rank'], suit: RegularCard['suit'], deckIndex: 0 | 1 = 0): RegularCard =>
  ({ rank, suit, isJoker: false, deckIndex });

const jk = (jokerIndex: 0 | 1 = 0): JokerCard =>
  ({ rank: 'JOKER', suit: null, isJoker: true, jokerIndex });

let idCounter = 0;
const testId = () => `meld-${++idCounter}`;
beforeEach(() => { idCounter = 0; });

function deterministicRound(playerIds: string[], dealerIndex = 0, seed = 42): RoundState {
  const deck = seededShuffle(createDeck(), seed);
  return initRound({ playerIds, roundNumber: 1, dealerIndex, deck });
}

/**
 * Inject a hand into a round state and align table_total / hasGoneDown so
 * tests can isolate the action under test without going through draw/discard
 * cycles to reach a specific state.
 */
function withHand(
  state: RoundState,
  playerId: string,
  hand: Card[],
  opts: { hasGoneDown?: boolean; melds?: Meld[]; tableTotal?: number; turnPhase?: RoundState['turnPhase'] } = {},
): RoundState {
  const ps = state.playerStates[playerId];
  return {
    ...state,
    turnPhase: opts.turnPhase ?? 'holding',
    currentTurnPlayerId: playerId,
    didTakeFromDiscardThisTurn: false,
    playerStates: {
      ...state.playerStates,
      [playerId]: {
        ...ps,
        hand,
        hasGoneDown: opts.hasGoneDown ?? false,
        melds: opts.melds ?? [],
        tableTotal: opts.tableTotal ?? 0,
      },
    },
  };
}

function expectOk<T extends ApplyResult>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`);
  return r as Extract<T, { ok: true }>;
}

// ─── 1. computeJokerCandidates ───────────────────────────────────────────────

describe('computeJokerCandidates — sequences', () => {
  it('10♥, Q♥, joker → joker is J♥ (single candidate)', () => {
    const cs = computeJokerCandidates('sequence', [rc('10', 'hearts'), rc('Q', 'hearts'), jk()]);
    expect(cs).toEqual([{ jokerIndex: 0, representsRank: 'J', representsSuit: 'hearts' }]);
  });

  it('10♥, J♥, joker → joker is 9♥ OR Q♥ (two candidates)', () => {
    const cs = computeJokerCandidates('sequence', [rc('10', 'hearts'), rc('J', 'hearts'), jk()]);
    const ranks = cs.map((c) => c.representsRank).sort();
    expect(ranks).toEqual(['9', 'Q']);
    expect(cs.every((c) => c.representsSuit === 'hearts')).toBe(true);
  });

  it('joker, Q♥, K♥ → joker is J♥ OR A♥ (high-Ace edge)', () => {
    const cs = computeJokerCandidates('sequence', [jk(), rc('Q', 'hearts'), rc('K', 'hearts')]);
    const ranks = cs.map((c) => c.representsRank).sort();
    expect(ranks).toEqual(['A', 'J']);
  });

  it('joker, 2♣, 3♣ → joker is A♣ (low) OR 4♣ (high edge)', () => {
    const cs = computeJokerCandidates('sequence', [jk(), rc('2', 'clubs'), rc('3', 'clubs')]);
    const ranks = cs.map((c) => c.representsRank).sort();
    expect(ranks).toEqual(['4', 'A']);
  });

  it('returns empty for joker-only sequence (no anchoring suit/rank)', () => {
    expect(computeJokerCandidates('sequence', [jk()])).toEqual([]);
  });

  it('returns empty for mixed-suit sequence (overall meld invalid)', () => {
    expect(computeJokerCandidates('sequence', [rc('5', 'hearts'), rc('6', 'clubs'), jk()])).toEqual([]);
  });
});

describe('computeJokerCandidates — sets', () => {
  it('9♣, 9♦, joker → two candidates: 9♥ and 9♠', () => {
    const cs = computeJokerCandidates('set', [rc('9', 'clubs'), rc('9', 'diamonds'), jk()]);
    expect(cs.map((c) => c.representsSuit).sort()).toEqual(['hearts', 'spades']);
    expect(cs.every((c) => c.representsRank === '9')).toBe(true);
  });

  it('K♠, K♥, K♣, joker → joker is K♦ (single candidate)', () => {
    const cs = computeJokerCandidates('set', [
      rc('K', 'spades'),
      rc('K', 'hearts'),
      rc('K', 'clubs'),
      jk(),
    ]);
    expect(cs).toEqual([{ jokerIndex: 0, representsRank: 'K', representsSuit: 'diamonds' }]);
  });
});

// ─── 2. resolveJokerAssignment ───────────────────────────────────────────────

describe('resolveJokerAssignment', () => {
  it('returns ok with no assignment for a meld with no joker', () => {
    const r = resolveJokerAssignment('sequence', [rc('5', 'hearts'), rc('6', 'hearts'), rc('7', 'hearts')], undefined);
    expect(r).toEqual({ ok: true, assignment: undefined });
  });

  it('rejects a joker assignment supplied when no joker is in the meld', () => {
    const r = resolveJokerAssignment(
      'sequence',
      [rc('5', 'hearts'), rc('6', 'hearts'), rc('7', 'hearts')],
      { jokerIndex: 0, representsRank: '8', representsSuit: 'hearts' },
    );
    expect(r.ok).toBe(false);
  });

  it('auto-resolves the unambiguous case (10♥ Q♥ joker → J♥)', () => {
    const r = resolveJokerAssignment(
      'sequence',
      [rc('10', 'hearts'), rc('Q', 'hearts'), jk()],
      undefined,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.assignment).toEqual({ jokerIndex: 0, representsRank: 'J', representsSuit: 'hearts' });
    }
  });

  it('returns ambiguous=true with candidates when no choice supplied (10♥ J♥ joker)', () => {
    const r = resolveJokerAssignment(
      'sequence',
      [rc('10', 'hearts'), rc('J', 'hearts'), jk()],
      undefined,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.ambiguous).toBe(true);
      if (r.ambiguous) expect(r.candidates).toHaveLength(2);
    }
  });

  it('accepts a client choice that matches one of the candidates', () => {
    const r = resolveJokerAssignment(
      'sequence',
      [rc('10', 'hearts'), rc('J', 'hearts'), jk()],
      { jokerIndex: 0, representsRank: 'Q', representsSuit: 'hearts' },
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.assignment) {
      expect(r.assignment.representsRank).toBe('Q');
    }
  });

  it('rejects a client choice that is not a legal candidate', () => {
    const r = resolveJokerAssignment(
      'sequence',
      [rc('10', 'hearts'), rc('J', 'hearts'), jk()],
      { jokerIndex: 0, representsRank: '7', representsSuit: 'hearts' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.ambiguous).toBe(false);
  });
});

// ─── 3. Engine wires assignment onto Meld ────────────────────────────────────

describe('engine — go-down attaches jokerAssignment to Meld', () => {
  it('attaches the resolved assignment for an unambiguous joker meld', () => {
    const playerIds = ['p1', 'p2'];
    const init = deterministicRound(playerIds);
    const me = init.playerOrder[0];

    // 10♥, Q♥, joker is unambiguous — joker MUST be J♥ (only one position
    // fills the gap). Pair it with a 4-Aces set (60 pts) so the total
    // (60 + 10 + 10 + 25 = 105) clears the 75-pt go-down threshold.
    const hand: Card[] = [
      rc('A', 'spades'), rc('A', 'hearts'), rc('A', 'diamonds'), rc('A', 'clubs'), // set 60
      rc('10', 'hearts'), rc('Q', 'hearts'), jk(),                                 // unambiguous: joker = J♥
    ];
    const state = withHand(init, me, hand, { hasGoneDown: false });

    const result = applyTurnAction(state, me, {
      type: 'go-down',
      melds: [
        { type: 'set', cards: [rc('A', 'spades'), rc('A', 'hearts'), rc('A', 'diamonds'), rc('A', 'clubs')] },
        { type: 'sequence', cards: [rc('10', 'hearts'), rc('Q', 'hearts'), jk()] },
      ],
    }, testId);

    const ok = expectOk(result);
    const meMelds = ok.state.playerStates[me].melds;
    expect(meMelds).toHaveLength(2);

    const seq = meMelds.find((m) => m.type === 'sequence');
    expect(seq?.jokerAssignment).toEqual({
      jokerIndex: 0,
      representsRank: 'J',
      representsSuit: 'hearts',
    });

    const set = meMelds.find((m) => m.type === 'set');
    expect(set?.jokerAssignment).toBeUndefined();
  });

  it('rejects a go-down with an ambiguous joker meld and surfaces candidates', () => {
    const playerIds = ['p1', 'p2'];
    const init = deterministicRound(playerIds);
    const me = init.playerOrder[0];

    // 10♥, J♥, Joker is ambiguous (joker = 9♥ or Q♥). To reach the 75-pt
    // threshold we need extra cards in a separate meld. Use a high set.
    const hand: Card[] = [
      rc('A', 'spades'), rc('A', 'hearts'), rc('A', 'diamonds'), rc('A', 'clubs'), // 60
      rc('10', 'hearts'), rc('J', 'hearts'), jk(),
    ];
    const state = withHand(init, me, hand, { hasGoneDown: false });

    const result = applyTurnAction(state, me, {
      type: 'go-down',
      melds: [
        { type: 'set', cards: [rc('A', 'spades'), rc('A', 'hearts'), rc('A', 'diamonds'), rc('A', 'clubs')] },
        { type: 'sequence', cards: [rc('10', 'hearts'), rc('J', 'hearts'), jk()] },
      ],
    }, testId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe('AMBIGUOUS_JOKER_ASSIGNMENT');
      expect(result.candidates?.length).toBe(2);
      expect(result.meldIndex).toBe(1); // the sequence meld is index 1
    }
  });
});

// ─── 4. replace-joker — sequence ─────────────────────────────────────────────

describe('replace-joker — sequence', () => {
  /**
   * Set up: player has gone down with a sequence containing a joker assigned
   * to J♥, then draws J♥ and replaces.
   */
  function setupSequenceWithJoker(): { state: RoundState; me: string; meldId: string; joker: JokerCard } {
    const playerIds = ['p1', 'p2'];
    const init = deterministicRound(playerIds);
    const me = init.playerOrder[0];
    const j = jk(0);
    const meld: Meld = {
      id: testId(),
      type: 'sequence',
      cards: [rc('10', 'hearts'), j, rc('Q', 'hearts')],
      totalValue: cardValue(rc('10', 'hearts')) + cardValue(j) + cardValue(rc('Q', 'hearts')),
      jokerAssignment: { jokerIndex: 0, representsRank: 'J', representsSuit: 'hearts' },
    };
    const state = withHand(init, me, [rc('J', 'hearts'), rc('5', 'clubs')], {
      hasGoneDown: true,
      melds: [meld],
      tableTotal: meld.totalValue,
    });
    return { state, me, meldId: meld.id, joker: j };
  }

  it('replaces joker with the exact missing card; joker returns to hand', () => {
    const { state, me, meldId } = setupSequenceWithJoker();
    const result = applyTurnAction(state, me, {
      type: 'replace-joker',
      meldId,
      replacementCard: rc('J', 'hearts'),
    });
    const ok = expectOk(result);
    const newPs = ok.state.playerStates[me];
    const updated = newPs.melds[0];

    // J♥ in the meld at position 1 (where the joker was), joker gone, no assignment.
    expect(updated.cards).toEqual([
      rc('10', 'hearts'),
      rc('J', 'hearts'),
      rc('Q', 'hearts'),
    ]);
    expect(updated.jokerAssignment).toBeUndefined();

    // Joker is now in the hand; J♥ has left.
    expect(newPs.hand.some((c) => c.isJoker && c.jokerIndex === 0)).toBe(true);
    expect(newPs.hand.some((c) => !c.isJoker && c.rank === 'J' && c.suit === 'hearts')).toBe(false);
  });

  it('rejects replacement with a card that is not the assigned rank+suit', () => {
    const { state, me, meldId } = setupSequenceWithJoker();
    const result = applyTurnAction(state, me, {
      type: 'replace-joker',
      meldId,
      replacementCard: rc('5', 'clubs'),
    });
    expect(result.ok).toBe(false);
  });

  it('rejects replacement when the replacement card is not in the player hand', () => {
    const { state, me, meldId } = setupSequenceWithJoker();
    // J♥ deck-index 1 is not in the hand (hand has deckIndex 0).
    const result = applyTurnAction(state, me, {
      type: 'replace-joker',
      meldId,
      replacementCard: rc('J', 'hearts', 1),
    });
    expect(result.ok).toBe(false);
  });
});

// ─── 5. replace-joker — set with 4-suit reclaim rule ─────────────────────────

describe('replace-joker — set reclaim rule', () => {
  /**
   * Build a SET meld with 9♣, 9♦, joker(=9♠). Exactly the 3-card joker set.
   * Reclaiming the joker right now must FAIL — only 1 real-non-joker suit
   * (well, 2 reals + joker = 3) is present beyond the joker's suit.
   * After adding 9♥ via add-to-meld, 4 reals would exist (incl. joker as 9♠
   * placeholder); the reclaim rule says the set must be COMPLETE in real
   * suits before swap. With joker(=9♠) present and 9♣, 9♦, 9♥ as reals,
   * three of the four real suits are present (clubs, diamonds, hearts);
   * spades (the joker's slot) is NOT yet a real card. The replacement is
   * 9♠ — completing the natural 4-of-a-kind. THIS should be allowed.
   */
  function setWithJokerAndReals(realSuits: Array<'clubs' | 'diamonds' | 'hearts' | 'spades'>) {
    const playerIds = ['p1', 'p2'];
    const init = deterministicRound(playerIds);
    const me = init.playerOrder[0];

    const realCards: Card[] = realSuits.map((s) => rc('9', s));
    const meldCards: Card[] = [...realCards, jk(0)];
    const meld: Meld = {
      id: testId(),
      type: 'set',
      cards: meldCards,
      totalValue: meldCards.reduce((s, c) => s + cardValue(c), 0),
      jokerAssignment: { jokerIndex: 0, representsRank: '9', representsSuit: 'spades' },
    };
    return { init, me, meld };
  }

  it('rejects reclaim when only 2 real suits are present (3-card joker set)', () => {
    const { init, me, meld } = setWithJokerAndReals(['clubs', 'diamonds']);
    const state = withHand(init, me, [rc('9', 'spades')], {
      hasGoneDown: true,
      melds: [meld],
      tableTotal: meld.totalValue,
    });
    const result = applyTurnAction(state, me, {
      type: 'replace-joker',
      meldId: meld.id,
      replacementCard: rc('9', 'spades'),
    });
    expect(result.ok).toBe(false);
  });

  it('allows reclaim only when 3 real suits + joker are present and the 4th suit is supplied', () => {
    const { init, me, meld } = setWithJokerAndReals(['clubs', 'diamonds', 'hearts']);
    const state = withHand(init, me, [rc('9', 'spades')], {
      hasGoneDown: true,
      melds: [meld],
      tableTotal: meld.totalValue,
    });
    const result = applyTurnAction(state, me, {
      type: 'replace-joker',
      meldId: meld.id,
      replacementCard: rc('9', 'spades'),
    });
    const ok = expectOk(result);
    const updated = ok.state.playerStates[me].melds[0];

    // All 4 real suits, no joker, no assignment.
    expect(updated.cards.filter((c) => c.isJoker)).toHaveLength(0);
    expect(new Set(updated.cards.map((c) => (c as RegularCard).suit))).toEqual(
      new Set(['clubs', 'diamonds', 'hearts', 'spades']),
    );
    expect(updated.jokerAssignment).toBeUndefined();

    // Joker returned to hand.
    expect(ok.state.playerStates[me].hand.some((c) => c.isJoker)).toBe(true);
  });

  it('rejects reclaim when the replacement is not the exact suit the joker stands for', () => {
    const { init, me, meld } = setWithJokerAndReals(['clubs', 'diamonds', 'hearts']);
    // Player tries to swap 9♥ (a duplicate of an existing real in the meld).
    const state = withHand(init, me, [rc('9', 'hearts', 1)], {
      hasGoneDown: true,
      melds: [meld],
      tableTotal: meld.totalValue,
    });
    const result = applyTurnAction(state, me, {
      type: 'replace-joker',
      meldId: meld.id,
      replacementCard: rc('9', 'hearts', 1),
    });
    expect(result.ok).toBe(false);
  });
});

// ─── 6. Joker scoring is always 25 ───────────────────────────────────────────

describe('joker still scores 25 regardless of represented card', () => {
  it('cardValue(joker) === 25', () => {
    expect(cardValue(jk(0))).toBe(CARD_VALUES['JOKER']);
    expect(cardValue(jk(0))).toBe(25);
  });

  it('a joker meld containing low cards still scores joker as 25', () => {
    const meldCards: Card[] = [rc('2', 'clubs'), rc('3', 'clubs'), jk()];
    // 2 (2) + 3 (3) + joker (25) = 30 — joker is 25 regardless of rank it stands for.
    const total = meldCards.reduce((s, c) => s + cardValue(c), 0);
    expect(total).toBe(CARD_VALUES['2'] + CARD_VALUES['3'] + CARD_VALUES['JOKER']);
    expect(total).toBe(30);
  });
});

// ─── 7. Max one joker per meld is still enforced ────────────────────────────

describe('only one joker per meld', () => {
  it('a sequence with two jokers is rejected by validateMeld', () => {
    const r = validateMeld('sequence', [rc('5', 'hearts'), jk(0), jk(1)]);
    expect(r.valid).toBe(false);
  });

  it('a set with two jokers is rejected by validateMeld', () => {
    const r = validateMeld('set', [rc('5', 'hearts'), jk(0), jk(1)]);
    expect(r.valid).toBe(false);
  });
});
