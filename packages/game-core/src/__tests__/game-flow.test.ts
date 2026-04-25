/**
 * Multi-round game flow tests.
 *
 * Covers the spec's full-game scenarios that aren't already pinned by the
 * single-round scoring tests:
 *
 *   - winner score = table + 20 bonus
 *   - non-winner score = table - hand
 *   - negative round scores accepted
 *   - cumulative scores accumulate correctly across multiple rounds
 *   - the game does NOT end after round 1 unless someone reached WIN_SCORE
 *   - dealer rotates correctly via nextDealerIndex
 *   - getWinner returns null until someone crosses the threshold
 *   - getWinner picks the player above the threshold once one exists
 */

import type {
  Card,
  PlayerRoundState,
  RegularCard,
} from '@calash/shared';
import { GAME_CONFIG } from '@calash/shared';
import {
  applyCumulativeScores,
  computePlayerRoundScore,
  computeRoundResult,
  getWinner,
} from '../scoring.js';
import { nextDealerIndex } from '../engine.js';

const rc = (rank: RegularCard['rank'], suit: RegularCard['suit']): RegularCard =>
  ({ rank, suit, isJoker: false, deckIndex: 0 });

function makePlayer(id: string, tableTotal: number, hand: Card[]): PlayerRoundState {
  return {
    playerId: id,
    hand,
    melds: [],
    hasGoneDown: tableTotal > 0,
    tableTotal,
  };
}

// ─── Per-player scoring (re-pin spec) ───────────────────────────────────────

describe('computePlayerRoundScore — spec rules', () => {
  it('finisher: round score = table total + 20 bonus', () => {
    // Finisher emptied their hand: handTotal = 0.
    const finisher = makePlayer('f', 80, []);
    const score = computePlayerRoundScore(finisher, true);
    expect(score.tableTotal).toBe(80);
    expect(score.handTotal).toBe(0);
    expect(score.roundScore).toBe(80);          // 80 - 0
    expect(score.finalScore).toBe(80 + 20);     // + finish bonus
    expect(GAME_CONFIG.FINISH_BONUS).toBe(20);
  });

  it('non-finisher: round score = table total - hand total', () => {
    // 75 down on the table, 35 stuck in hand (K=10 + A=25).
    const p = makePlayer('p', 75, [rc('K', 'hearts'), rc('A', 'spades')]);
    const score = computePlayerRoundScore(p, false);
    expect(score.tableTotal).toBe(75);
    expect(score.handTotal).toBe(35);
    expect(score.roundScore).toBe(40);
    expect(score.finalScore).toBe(40); // no bonus
  });

  it('allows negative round scores (more in hand than on the table)', () => {
    const p = makePlayer('p', 0, [rc('A', 'spades'), rc('A', 'hearts')]); // 50 in hand, 0 on table
    const score = computePlayerRoundScore(p, false);
    expect(score.roundScore).toBe(-50);
    expect(score.finalScore).toBe(-50);
  });
});

// ─── Cumulative + dealer rotation across multiple rounds ────────────────────

describe('Multi-round flow — cumulative + dealer rotation', () => {
  it('accumulates scores across 3 rounds (allowing negatives)', () => {
    let cumulative: Record<string, number> = { alice: 0, bob: 0, carol: 0 };

    // Round 1: alice finishes with 100 on table; bob has 50 table - 30 hand;
    // carol has 0 table - 60 hand (a bad round).
    const r1 = computeRoundResult(
      {
        alice: makePlayer('alice', 100, []),
        bob: makePlayer('bob', 50, [rc('K', 'hearts'), rc('K', 'spades'), rc('10', 'clubs')]), // 30
        carol: makePlayer('carol', 0, [rc('A', 'spades'), rc('A', 'hearts'), rc('10', 'clubs')]), // 60
      },
      ['alice', 'bob', 'carol'],
      'player-finished',
      'alice',
    );
    cumulative = applyCumulativeScores(cumulative, r1);
    expect(cumulative).toEqual({ alice: 120, bob: 20, carol: -60 });

    // Round 2: deck-exhausted, no finisher. bob does well, alice loses.
    const r2 = computeRoundResult(
      {
        alice: makePlayer('alice', 0, [rc('A', 'spades'), rc('A', 'hearts')]), // -50
        bob: makePlayer('bob', 80, [rc('5', 'clubs')]),                         // +75
        carol: makePlayer('carol', 30, [rc('K', 'spades')]),                    // +20
      },
      ['alice', 'bob', 'carol'],
      'deck-exhausted',
      null,
    );
    cumulative = applyCumulativeScores(cumulative, r2);
    expect(cumulative).toEqual({ alice: 70, bob: 95, carol: -40 });

    // Round 3: carol fights back; bob has a finisher bonus.
    const r3 = computeRoundResult(
      {
        alice: makePlayer('alice', 60, [rc('K', 'hearts')]), // +50
        bob: makePlayer('bob', 90, []),                       // +110 (90 + 20 bonus)
        carol: makePlayer('carol', 70, [rc('5', 'clubs')]),   // +65
      },
      ['alice', 'bob', 'carol'],
      'player-finished',
      'bob',
    );
    cumulative = applyCumulativeScores(cumulative, r3);
    expect(cumulative).toEqual({ alice: 120, bob: 205, carol: 25 });
  });

  it('nextDealerIndex rotates counterclockwise (i+1 mod n)', () => {
    expect(nextDealerIndex(0, 4)).toBe(1);
    expect(nextDealerIndex(1, 4)).toBe(2);
    expect(nextDealerIndex(2, 4)).toBe(3);
    expect(nextDealerIndex(3, 4)).toBe(0); // wraps
    expect(nextDealerIndex(0, 2)).toBe(1);
    expect(nextDealerIndex(1, 2)).toBe(0);
  });
});

// ─── Game-end threshold ─────────────────────────────────────────────────────

describe('getWinner — full-game end rule', () => {
  it('returns null when no player has reached WIN_SCORE (1000)', () => {
    expect(getWinner({ alice: 800, bob: 400 })).toBeNull();
    expect(getWinner({ alice: 999, bob: 0 })).toBeNull();
    // Even after several rounds with positive scores, the game continues.
    expect(getWinner({ alice: 500, bob: 200, carol: 50 })).toBeNull();
  });

  it('does NOT end after round 1 just because the round had a winner', () => {
    // Round 1 winner with a 100-pt opening + 20 bonus = 120. Far below 1000.
    let cumulative: Record<string, number> = { alice: 0, bob: 0 };
    const r1 = computeRoundResult(
      {
        alice: makePlayer('alice', 100, []),
        bob: makePlayer('bob', 0, [rc('A', 'spades')]),
      },
      ['alice', 'bob'],
      'player-finished',
      'alice',
    );
    cumulative = applyCumulativeScores(cumulative, r1);
    expect(cumulative.alice).toBe(120);
    expect(getWinner(cumulative)).toBeNull(); // game continues
  });

  it('returns the player ID once they cross WIN_SCORE', () => {
    expect(getWinner({ alice: 1000, bob: 400 })).toBe('alice');
    expect(getWinner({ alice: 1240, bob: 800 })).toBe('alice');
  });

  it('picks the highest scorer when multiple players cross WIN_SCORE in the same round', () => {
    expect(getWinner({ alice: 1050, bob: 1100 })).toBe('bob');
    expect(getWinner({ alice: 1200, bob: 1100, carol: 1300 })).toBe('carol');
  });

  it('uses GAME_CONFIG.WIN_SCORE (1000) — pin the threshold', () => {
    expect(GAME_CONFIG.WIN_SCORE).toBe(1000);
  });
});
