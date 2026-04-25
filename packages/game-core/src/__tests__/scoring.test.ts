import type { PlayerRoundState, Meld } from '@calash/shared';
import { GAME_CONFIG } from '@calash/shared';
import type { RegularCard } from '@calash/shared';
import {
  computePlayerRoundScore,
  computeRoundResult,
  applyCumulativeScores,
  getWinner,
} from '../scoring.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const rc = (rank: RegularCard['rank'], suit: RegularCard['suit']): RegularCard =>
  ({ rank, suit, isJoker: false, deckIndex: 0 });

function makePlayer(
  id: string,
  tableTotal: number,
  handCards: RegularCard[],
  melds: Meld[] = [],
): PlayerRoundState {
  return {
    playerId: id,
    hand: handCards,
    melds,
    hasGoneDown: melds.length > 0,
    tableTotal,
  };
}

// ─── computePlayerRoundScore ─────────────────────────────────────────────────

describe('computePlayerRoundScore', () => {
  it('uses state.tableTotal directly (decoupled from melds[] sum)', () => {
    // tableTotal is the authoritative number — not recomputed from melds[].
    // Keeping the two decoupled lets us evolve scoring (e.g. bonuses) without
    // having to retrofit every scoring path. Cross-player meld extension is
    // no longer allowed (owner-only rule), so today tableTotal always equals
    // the sum of the player's own melds — but the contract here is "trust
    // the field," not "recompute from melds."
    const player = makePlayer('p1', 50, []);
    const score = computePlayerRoundScore(player, false);
    expect(score.tableTotal).toBe(50);
  });

  it('calculates handTotal from current hand cards', () => {
    // K(10) + A(25) = 35
    const player = makePlayer('p1', 0, [rc('K', 'hearts'), rc('A', 'spades')]);
    const score = computePlayerRoundScore(player, false);
    expect(score.handTotal).toBe(35);
  });

  it('computes roundScore as tableTotal minus handTotal', () => {
    // tableTotal=75, handTotal=35 → roundScore=40
    const player = makePlayer('p1', 75, [rc('K', 'hearts'), rc('A', 'spades')]);
    const score = computePlayerRoundScore(player, false);
    expect(score.roundScore).toBe(40);
  });

  it('roundScore can be negative when hand exceeds table', () => {
    // tableTotal=0 (not gone down), handTotal=25
    const player = makePlayer('p1', 0, [rc('A', 'hearts')]);
    const score = computePlayerRoundScore(player, false);
    expect(score.roundScore).toBe(-25);
  });

  it('adds FINISH_BONUS to finalScore when finishedFirst is true', () => {
    const player = makePlayer('p1', 75, []);
    const score = computePlayerRoundScore(player, true);
    expect(score.finalScore).toBe(75 + GAME_CONFIG.FINISH_BONUS);
  });

  it('does not add FINISH_BONUS when finishedFirst is false', () => {
    const player = makePlayer('p1', 75, [rc('K', 'hearts')]);
    const score = computePlayerRoundScore(player, false);
    expect(score.finalScore).toBe(75 - 10);
  });

  it('sets finishedFirst correctly', () => {
    const player = makePlayer('p1', 50, []);
    expect(computePlayerRoundScore(player, true).finishedFirst).toBe(true);
    expect(computePlayerRoundScore(player, false).finishedFirst).toBe(false);
  });
});

// ─── computeRoundResult ──────────────────────────────────────────────────────

describe('computeRoundResult', () => {
  const p1 = makePlayer('p1', 80, []);
  const p2 = makePlayer('p2', 40, [rc('5', 'clubs'), rc('6', 'clubs')]);
  const playerStates = { p1, p2 };
  const playerOrder = ['p1', 'p2'];

  it('includes a score entry for every player', () => {
    const result = computeRoundResult(playerStates, playerOrder, 'player-finished', 'p1');
    expect(result.playerScores).toHaveLength(2);
    const ids = result.playerScores.map((s) => s.playerId);
    expect(ids).toContain('p1');
    expect(ids).toContain('p2');
  });

  it('sets finishedFirst only for the finisher', () => {
    const result = computeRoundResult(playerStates, playerOrder, 'player-finished', 'p1');
    const p1Score = result.playerScores.find((s) => s.playerId === 'p1')!;
    const p2Score = result.playerScores.find((s) => s.playerId === 'p2')!;
    expect(p1Score.finishedFirst).toBe(true);
    expect(p2Score.finishedFirst).toBe(false);
  });

  it('sets finishedFirst to false for all players when deck-exhausted', () => {
    const result = computeRoundResult(playerStates, playerOrder, 'deck-exhausted', null);
    result.playerScores.forEach((s) => expect(s.finishedFirst).toBe(false));
  });

  it('preserves the endReason', () => {
    const result = computeRoundResult(playerStates, playerOrder, 'deck-exhausted', null);
    expect(result.endReason).toBe('deck-exhausted');
  });
});

// ─── applyCumulativeScores ────────────────────────────────────────────────────

describe('applyCumulativeScores', () => {
  it('adds round scores to existing cumulative totals', () => {
    const current = { p1: 100, p2: 50 };
    const result = computeRoundResult(
      {
        p1: makePlayer('p1', 80, []),
        p2: makePlayer('p2', 0, [rc('K', 'hearts')]),
      },
      ['p1', 'p2'],
      'player-finished',
      'p1',
    );
    const updated = applyCumulativeScores(current, result);
    expect(updated['p1']).toBe(100 + (80 + GAME_CONFIG.FINISH_BONUS));
    expect(updated['p2']).toBe(50 + (0 - 10));
  });

  it('does not mutate the input object', () => {
    const current = { p1: 100 };
    const result = computeRoundResult(
      { p1: makePlayer('p1', 50, []) },
      ['p1'],
      'deck-exhausted',
      null,
    );
    applyCumulativeScores(current, result);
    expect(current['p1']).toBe(100);
  });

  it('initialises a missing player score from 0', () => {
    const current = {};
    const result = computeRoundResult(
      { p1: makePlayer('p1', 30, []) },
      ['p1'],
      'deck-exhausted',
      null,
    );
    const updated = applyCumulativeScores(current, result);
    expect(updated['p1']).toBe(30);
  });
});

// ─── getWinner ────────────────────────────────────────────────────────────────

describe('getWinner', () => {
  it('returns null when no player has reached WIN_SCORE', () => {
    expect(getWinner({ p1: 500, p2: 300 })).toBeNull();
  });

  it('returns the player who has reached WIN_SCORE', () => {
    expect(getWinner({ p1: 999, p2: 1000 })).toBe('p2');
  });

  it('returns the highest scorer when multiple players cross WIN_SCORE', () => {
    expect(getWinner({ p1: 1000, p2: 1100 })).toBe('p2');
  });

  it('returns the player who exactly hits WIN_SCORE', () => {
    expect(getWinner({ p1: GAME_CONFIG.WIN_SCORE })).toBe('p1');
  });
});
