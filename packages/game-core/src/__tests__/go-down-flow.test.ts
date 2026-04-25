/**
 * Comprehensive tests for the Go Down (open) flow:
 *
 *   - Set validation enforces unique suits (including across two physical decks).
 *   - Opening with ≥75 succeeds, below the threshold fails.
 *   - The dynamic threshold (highestTableTotal + 5) is enforced for late openers.
 *   - Successful go-down removes cards from hand, places melds on the table,
 *     marks hasGoneDown, and updates tableTotal.
 *   - Other players see the new melds in the broadcast view (toRoundStateView).
 *
 * These tests exercise the rules engine the way the server does — by calling
 * applyTurnAction directly. The server simply forwards the result.
 */

import type {
  Card,
  RegularCard,
  JokerCard,
  RoundState,
  PlayerRoundState,
} from '@calash/shared';
import { GAME_CONFIG } from '@calash/shared';
import { applyTurnAction, toRoundStateView } from '../engine.js';
import { validateMeld } from '../meld.js';

// ─── Test helpers ────────────────────────────────────────────────────────────

const rc = (rank: RegularCard['rank'], suit: RegularCard['suit'], deckIndex: 0 | 1 = 0): RegularCard =>
  ({ rank, suit, isJoker: false, deckIndex });

const joker = (jokerIndex: 0 | 1 = 0): JokerCard =>
  ({ rank: 'JOKER', suit: null, isJoker: true, jokerIndex });

function makeState(overrides: {
  myHand: Card[];
  highestTableTotal?: number;
  didTakeFromDiscard?: boolean;
  myMelds?: PlayerRoundState['melds'];
  otherPlayerMelds?: PlayerRoundState['melds'];
  otherPlayerHasGoneDown?: boolean;
}): { state: RoundState; me: string; other: string } {
  const me = 'me';
  const other = 'other';
  const myPs: PlayerRoundState = {
    playerId: me,
    hand: [...overrides.myHand],
    melds: overrides.myMelds ?? [],
    hasGoneDown: false,
    tableTotal: 0,
  };
  const otherPs: PlayerRoundState = {
    playerId: other,
    hand: [],
    melds: overrides.otherPlayerMelds ?? [],
    hasGoneDown: overrides.otherPlayerHasGoneDown ?? false,
    tableTotal: (overrides.otherPlayerMelds ?? []).reduce((s, m) => s + m.totalValue, 0),
  };
  const state: RoundState = {
    roundNumber: 1,
    dealerPlayerId: other,
    playerOrder: [me, other],
    currentTurnPlayerId: me,
    phase: 'in-progress',
    turnPhase: 'holding',
    playerStates: { [me]: myPs, [other]: otherPs },
    hiddenDeck: [rc('2', 'clubs'), rc('3', 'clubs')],
    discardPile: [rc('5', 'spades')],
    highestTableTotal: overrides.highestTableTotal ?? 0,
    didTakeFromDiscardThisTurn: overrides.didTakeFromDiscard ?? false,
  };
  return { state, me, other };
}

// ─── Set validation: duplicate suits rejected ───────────────────────────────

describe('Set meld — unique suit requirement', () => {
  it('accepts a valid 3-of-a-kind with unique suits', () => {
    const cards = [rc('J', 'clubs'), rc('J', 'hearts'), rc('J', 'diamonds')];
    expect(validateMeld('set', cards).valid).toBe(true);
  });

  it('accepts a valid 4-of-a-kind with all four unique suits', () => {
    const cards = [rc('K', 'spades'), rc('K', 'hearts'), rc('K', 'diamonds'), rc('K', 'clubs')];
    expect(validateMeld('set', cards).valid).toBe(true);
  });

  it('rejects a set with duplicate suits, same deckIndex', () => {
    const cards = [rc('J', 'diamonds', 0), rc('J', 'diamonds', 0), rc('J', 'hearts')];
    const r = validateMeld('set', cards);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/different suits/i);
  });

  it('rejects a set with duplicate suits even when cards come from two physical decks', () => {
    // Two J♦ — one from deck 0, one from deck 1. Same suit, so still illegal.
    const cards = [rc('J', 'diamonds', 0), rc('J', 'diamonds', 1), rc('J', 'hearts')];
    const r = validateMeld('set', cards);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/different suits/i);
  });

  it('rejects a set with two K♥ from different decks plus K♠', () => {
    const cards = [rc('K', 'hearts', 0), rc('K', 'hearts', 1), rc('K', 'spades')];
    const r = validateMeld('set', cards);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/different suits/i);
  });

  it('rejects a set with mixed ranks even if suits are unique', () => {
    const cards = [rc('K', 'hearts'), rc('Q', 'diamonds'), rc('J', 'clubs')];
    const r = validateMeld('set', cards);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/same rank/i);
  });

  it('accepts a set with one joker filling the missing suit', () => {
    const cards = [rc('K', 'hearts'), rc('K', 'diamonds'), joker(0)];
    expect(validateMeld('set', cards).valid).toBe(true);
  });
});

// ─── Sequence validation (sanity / regression) ──────────────────────────────

describe('Sequence meld — ranges and ace flexibility', () => {
  it('accepts A-2-3 of one suit (ace low)', () => {
    expect(validateMeld('sequence', [rc('A', 'hearts'), rc('2', 'hearts'), rc('3', 'hearts')]).valid).toBe(true);
  });

  it('accepts Q-K-A of one suit (ace high)', () => {
    expect(validateMeld('sequence', [rc('Q', 'spades'), rc('K', 'spades'), rc('A', 'spades')]).valid).toBe(true);
  });

  it('accepts 10-J-Q-K-A of one suit (ace high, longer)', () => {
    expect(
      validateMeld('sequence', [
        rc('10', 'clubs'), rc('J', 'clubs'), rc('Q', 'clubs'), rc('K', 'clubs'), rc('A', 'clubs'),
      ]).valid,
    ).toBe(true);
  });

  it('rejects K-A-2 (no wraparound)', () => {
    expect(
      validateMeld('sequence', [rc('K', 'diamonds'), rc('A', 'diamonds'), rc('2', 'diamonds')]).valid,
    ).toBe(false);
  });
});

// ─── Opening threshold ──────────────────────────────────────────────────────

describe('Go-down opening — threshold rules', () => {
  it('accepts opening at exactly the initial 75-point threshold', () => {
    // Three Aces = 3 × 25 = 75 pts.
    const myHand = [
      rc('A', 'hearts'), rc('A', 'diamonds'), rc('A', 'clubs'),
      rc('2', 'spades'), // discard fodder
    ];
    const { state, me } = makeState({ myHand });
    const result = applyTurnAction(state, me, {
      type: 'go-down',
      melds: [{ type: 'set', cards: myHand.slice(0, 3) }],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects opening below 75 with a clear reason', () => {
    // Three Kings = 30 pts. Hand has 5 cards so 2 would remain after go-down
    // (the finish exception only kicks in when exactly 1 would remain).
    const myHand = [
      rc('K', 'hearts'), rc('K', 'diamonds'), rc('K', 'clubs'),
      rc('2', 'spades'), rc('3', 'spades'),
    ];
    const { state, me } = makeState({ myHand });
    const result = applyTurnAction(state, me, {
      type: 'go-down',
      melds: [{ type: 'set', cards: myHand.slice(0, 3) }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/below the required minimum/i);
      expect(result.error).toContain('75');
    }
  });

  it('enforces dynamic threshold (highestTableTotal + 5) for late openers', () => {
    // Other player is down with 100 pts on table → I need ≥ 105 to open.
    // I bring exactly 100 pts of melds — should fail. Hand has 6 cards so 2
    // remain after go-down, sidestepping the finish exception.
    const myHand = [
      rc('A', 'hearts'), rc('A', 'diamonds'), rc('A', 'clubs'), rc('A', 'spades'), // 4 Aces = 100 pts
      rc('2', 'hearts'), rc('3', 'hearts'),
    ];
    const { state, me } = makeState({ myHand, highestTableTotal: 100 });
    const result = applyTurnAction(state, me, {
      type: 'go-down',
      melds: [{ type: 'set', cards: myHand.slice(0, 4) }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('105');
    }
  });

  it('rejects opening on the same turn as take-from-discard', () => {
    const myHand = [rc('A', 'hearts'), rc('A', 'diamonds'), rc('A', 'clubs'), rc('2', 'spades')];
    const { state, me } = makeState({ myHand, didTakeFromDiscard: true });
    const result = applyTurnAction(state, me, {
      type: 'go-down',
      melds: [{ type: 'set', cards: myHand.slice(0, 3) }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/took from the discard pile/i);
    }
  });
});

// ─── Successful submit: state mutation and broadcast view ───────────────────

describe('Go-down opening — state after a successful submit', () => {
  it('removes the played cards from the player hand', () => {
    const myHand = [
      rc('A', 'hearts'), rc('A', 'diamonds'), rc('A', 'clubs'),
      rc('2', 'spades'), rc('5', 'clubs'),
    ];
    const { state, me } = makeState({ myHand });
    const result = applyTurnAction(state, me, {
      type: 'go-down',
      melds: [{ type: 'set', cards: myHand.slice(0, 3) }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const newHand = result.state.playerStates[me].hand;
      expect(newHand).toHaveLength(2);
      // Remaining cards: 2♠ and 5♣
      expect(newHand.map((c) => (c.isJoker ? 'J' : `${c.rank}${c.suit[0]}`)).sort())
        .toEqual(['2s', '5c']);
    }
  });

  it('places submitted melds on the table and marks hasGoneDown', () => {
    const myHand = [
      rc('A', 'hearts'), rc('A', 'diamonds'), rc('A', 'clubs'),
      rc('2', 'spades'),
    ];
    const { state, me } = makeState({ myHand });
    const result = applyTurnAction(state, me, {
      type: 'go-down',
      melds: [{ type: 'set', cards: myHand.slice(0, 3) }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ps = result.state.playerStates[me];
      expect(ps.hasGoneDown).toBe(true);
      expect(ps.melds).toHaveLength(1);
      expect(ps.melds[0].type).toBe('set');
      expect(ps.melds[0].cards).toHaveLength(3);
      expect(ps.tableTotal).toBe(75);
    }
  });

  it('updates highestTableTotal so opponents face the new threshold', () => {
    const myHand = [
      rc('A', 'hearts'), rc('A', 'diamonds'), rc('A', 'clubs'),
      rc('2', 'spades'),
    ];
    const { state, me } = makeState({ myHand });
    const result = applyTurnAction(state, me, {
      type: 'go-down',
      melds: [{ type: 'set', cards: myHand.slice(0, 3) }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.highestTableTotal).toBe(75);
    }
  });

  it('exposes the new meld to opponents via toRoundStateView', () => {
    const myHand = [
      rc('A', 'hearts'), rc('A', 'diamonds'), rc('A', 'clubs'),
      rc('2', 'spades'),
    ];
    const { state, me, other } = makeState({ myHand });
    const result = applyTurnAction(state, me, {
      type: 'go-down',
      melds: [{ type: 'set', cards: myHand.slice(0, 3) }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const view = toRoundStateView(result.state);
      // The opponent's view of *me* should include my melds and tableTotal.
      const meAsSeenByOther = view.playerStates[me];
      expect(meAsSeenByOther.melds).toHaveLength(1);
      expect(meAsSeenByOther.hasGoneDown).toBe(true);
      expect(meAsSeenByOther.tableTotal).toBe(75);
      // Ensure the broadcast view does NOT leak my hand to the other player.
      expect(meAsSeenByOther).not.toHaveProperty('hand');
      // And the other player's projection still works.
      expect(view.playerStates[other]).toBeDefined();
    }
  });

  it('accepts a multi-meld opening that adds up to ≥ threshold', () => {
    // Set: 3 Kings (30) + Sequence: J-Q-K hearts (30). Total = 60 — below 75.
    // Add a 4th K (40) + a joker in the seq for a J-Q-Joker (40). Total 80.
    //
    // The J-Q-Joker placement is AMBIGUOUS post-PR (joker could be 10♠ or
    // K♠), so we now supply an explicit jokerAssignment to disambiguate.
    // This mirrors what the UI's JokerAssignmentPicker would send.
    const myHand = [
      rc('K', 'hearts', 0), rc('K', 'diamonds'), rc('K', 'clubs'), rc('K', 'spades', 0),  // set of 4 Kings = 40
      rc('J', 'spades', 1), rc('Q', 'spades'), joker(0),                                  // J-Q-Joker spades = 45
      rc('2', 'hearts'),
    ];
    const { state, me } = makeState({ myHand });
    const result = applyTurnAction(state, me, {
      type: 'go-down',
      melds: [
        { type: 'set', cards: [myHand[0], myHand[1], myHand[2], myHand[3]] },
        {
          type: 'sequence',
          cards: [myHand[4], myHand[5], myHand[6]],
          jokerAssignment: { jokerIndex: 0, representsRank: 'K', representsSuit: 'spades' },
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ps = result.state.playerStates[me];
      expect(ps.melds).toHaveLength(2);
      expect(ps.tableTotal).toBe(85); // 40 + 45
    }
  });

  it('rejects submission when a claimed card is not in hand', () => {
    const myHand = [rc('A', 'hearts'), rc('A', 'diamonds'), rc('A', 'clubs'), rc('2', 'spades')];
    const { state, me } = makeState({ myHand });
    // Claim three Aces but include A♠ which isn't in the hand.
    const result = applyTurnAction(state, me, {
      type: 'go-down',
      melds: [{ type: 'set', cards: [rc('A', 'hearts'), rc('A', 'diamonds'), rc('A', 'spades')] }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/not in your hand/i);
    }
  });

  it('rejects opening with a duplicate-suit set even if total ≥ threshold', () => {
    // Three K♥ (one from deck 0, one from deck 1) + K♠ would be 40 pts,
    // duplicate suit. Combined with another high meld for total ≥ 75.
    const myHand = [
      rc('K', 'hearts', 0), rc('K', 'hearts', 1), rc('K', 'spades'), rc('K', 'diamonds'), // bogus "set"
      rc('A', 'hearts'), rc('A', 'clubs'), rc('A', 'spades'),                              // valid 75-pt set
      rc('2', 'spades'),
    ];
    const { state, me } = makeState({ myHand });
    const result = applyTurnAction(state, me, {
      type: 'go-down',
      melds: [
        // Bogus set with duplicate K♥
        { type: 'set', cards: [myHand[0], myHand[1], myHand[2]] },
        // Valid set
        { type: 'set', cards: [myHand[4], myHand[5], myHand[6]] },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/different suits/i);
    }
  });
});

// ─── Special finish exception (full turn flow) ──────────────────────────────
//
// validateGoDown lets a player open below threshold when the move would
// leave exactly 1 card in hand for the final discard. These tests pin the
// full turn: go-down accepted → discard last card → round ends with the
// player marked as the finisher and awarded the +20 winner bonus.

describe('Go-down — special finish exception', () => {
  it('accepts a sub-threshold go-down + final discard ends the round with +20 bonus', () => {
    // Hand: K♥ K♦ K♣ (set, 30 pts) + 2♣ (the throwaway last card).
    // Threshold would be 75 (no one is down yet) but only 30 pts are placed —
    // allowed because going down empties hand to 1 card.
    const fix = makeState({
      myHand: [rc('K', 'hearts'), rc('K', 'diamonds'), rc('K', 'clubs'), rc('2', 'clubs')],
    });

    const goDown = applyTurnAction(fix.state, fix.me, {
      type: 'go-down',
      melds: [
        {
          type: 'set',
          cards: [rc('K', 'hearts'), rc('K', 'diamonds'), rc('K', 'clubs')],
        },
      ],
    });
    expect(goDown.ok).toBe(true);
    if (!goDown.ok) return;
    expect(goDown.state.playerStates[fix.me].hand).toHaveLength(1);
    expect(goDown.state.playerStates[fix.me].hasGoneDown).toBe(true);

    // Final discard empties the hand → round ends.
    const discard = applyTurnAction(goDown.state, fix.me, {
      type: 'discard',
      card: rc('2', 'clubs'),
    });
    expect(discard.ok).toBe(true);
    if (!discard.ok) return;
    expect(discard.roundResult).toBeDefined();
    if (!discard.roundResult) return;

    // Finisher is me; +20 bonus applied; round score = tableTotal - handTotal + 20.
    const myScore = discard.roundResult.playerScores.find((p) => p.playerId === fix.me);
    expect(myScore?.finishedFirst).toBe(true);
    expect(myScore?.finalScore).toBe(myScore!.roundScore + GAME_CONFIG.FINISH_BONUS);
    // tableTotal recorded matches the meld value (30); hand was empty after discard.
    expect(myScore?.tableTotal).toBe(30);
    expect(myScore?.handTotal).toBe(0);
    // 30 - 0 + 20 = 50
    expect(myScore?.finalScore).toBe(50);
  });

  it('accepts the exception even when an opponent has a much higher exposed total', () => {
    // Threshold would be 305 (opponent at 300). Only 30 pts placed but the
    // move empties the hand → still allowed.
    const opponentMeld: PlayerRoundState['melds'][number] = {
      id: 'opp-meld',
      type: 'set',
      cards: [rc('A', 'hearts'), rc('A', 'diamonds'), rc('A', 'clubs'), rc('A', 'spades')],
      totalValue: 100,
    };
    const fix = makeState({
      myHand: [rc('K', 'hearts'), rc('K', 'diamonds'), rc('K', 'clubs'), rc('2', 'clubs')],
      otherPlayerMelds: [opponentMeld],
      otherPlayerHasGoneDown: true,
      highestTableTotal: 300, // simulated runaway leader
    });

    const goDown = applyTurnAction(fix.state, fix.me, {
      type: 'go-down',
      melds: [{ type: 'set', cards: [rc('K', 'hearts'), rc('K', 'diamonds'), rc('K', 'clubs')] }],
    });
    expect(goDown.ok).toBe(true);

    if (!goDown.ok) return;
    const discard = applyTurnAction(goDown.state, fix.me, {
      type: 'discard',
      card: rc('2', 'clubs'),
    });
    expect(discard.ok).toBe(true);
    if (!discard.ok) return;
    expect(discard.roundResult).toBeDefined();
    const myScore = discard.roundResult!.playerScores.find((p) => p.playerId === fix.me);
    expect(myScore?.finishedFirst).toBe(true);
  });

  it('rejects a sub-threshold go-down when residual hand would be ≥2 (no finish)', () => {
    // 30 pts but 2 leftover cards → can't finish this turn → normal threshold bites.
    const fix = makeState({
      myHand: [
        rc('K', 'hearts'), rc('K', 'diamonds'), rc('K', 'clubs'),
        rc('2', 'clubs'), rc('3', 'clubs'),
      ],
    });
    const r = applyTurnAction(fix.state, fix.me, {
      type: 'go-down',
      melds: [{ type: 'set', cards: [rc('K', 'hearts'), rc('K', 'diamonds'), rc('K', 'clubs')] }],
    });
    expect(r.ok).toBe(false);
  });

  it('regression: a normal threshold-meeting go-down still works (4 Aces = 100, hand has 5 cards)', () => {
    // Sanity: the exception code path doesn't accidentally reject valid normal opens.
    const fix = makeState({
      myHand: [
        rc('A', 'hearts'), rc('A', 'diamonds'), rc('A', 'clubs'), rc('A', 'spades'),
        rc('2', 'clubs'),
      ],
    });
    const r = applyTurnAction(fix.state, fix.me, {
      type: 'go-down',
      melds: [{
        type: 'set',
        cards: [rc('A', 'hearts'), rc('A', 'diamonds'), rc('A', 'clubs'), rc('A', 'spades')],
      }],
    });
    expect(r.ok).toBe(true);
  });
});

// Suppress unused-import warning
void GAME_CONFIG;
