/**
 * Sequence length + Ace handling tests.
 *
 * Covers the spec:
 *   - 3-card minimum
 *   - up to 14-card maximum (full A,2,...,K,A run)
 *   - same-suit, consecutive-rank requirement
 *   - Ace-low (A,2,3), Ace-high (Q,K,A, 10-J-Q-K-A)
 *   - dual-Ace full-suit run (A,2,3,...,K,A)
 *   - mixed-suit / broken-order / wraparound rejections
 *   - exactly one joker permitted, used in long sequences
 */

import type { Card, RegularCard, JokerCard, Suit } from '@calash/shared';
import { validateMeld } from '../meld.js';

const rc = (rank: RegularCard['rank'], suit: RegularCard['suit'], deckIndex: 0 | 1 = 0): RegularCard =>
  ({ rank, suit, isJoker: false, deckIndex });

const joker = (jokerIndex: 0 | 1 = 0): JokerCard =>
  ({ rank: 'JOKER', suit: null, isJoker: true, jokerIndex });

/** Build a same-suit sequence from `from` (rank string) to `to` inclusive. */
function buildSeq(suit: Suit, from: RegularCard['rank'], to: RegularCard['rank'], deckIndex: 0 | 1 = 0): Card[] {
  const order: RegularCard['rank'][] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const fromIdx = order.indexOf(from);
  const toIdx = order.indexOf(to);
  if (fromIdx === -1 || toIdx === -1 || toIdx < fromIdx) {
    throw new Error(`Bad range: ${from}..${to}`);
  }
  return order.slice(fromIdx, toIdx + 1).map((r) => rc(r, suit, deckIndex));
}

describe('Sequence — minimum / maximum length', () => {
  it('rejects sequences shorter than 3 cards', () => {
    const r = validateMeld('sequence', [rc('5', 'hearts'), rc('6', 'hearts')]);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/at least 3 cards/i);
  });

  it('accepts the minimum 3-card sequence', () => {
    expect(validateMeld('sequence', [rc('4', 'hearts'), rc('5', 'hearts'), rc('6', 'hearts')]).valid).toBe(true);
  });

  it('accepts a 5-card sequence (8,9,10,J,Q spades)', () => {
    expect(
      validateMeld('sequence', [rc('8', 'spades'), rc('9', 'spades'), rc('10', 'spades'), rc('J', 'spades'), rc('Q', 'spades')]).valid,
    ).toBe(true);
  });

  it('accepts a 10-card sequence (2..J hearts)', () => {
    const seq = buildSeq('hearts', '2', 'J');
    expect(seq.length).toBe(10);
    expect(validateMeld('sequence', seq).valid).toBe(true);
  });

  it('accepts a 13-card sequence A..K (Ace low only)', () => {
    const seq = buildSeq('clubs', 'A', 'K');
    expect(seq.length).toBe(13);
    expect(validateMeld('sequence', seq).valid).toBe(true);
  });

  it('accepts the maximum 14-card sequence A,2,...K,A (DUAL ACE)', () => {
    // Both Aces of the same suit — one as low, one as high — forming a
    // single full-suit run.
    const seq: Card[] = [
      rc('A', 'hearts', 0),
      ...buildSeq('hearts', '2', 'K').slice(0), // 2..K
      rc('A', 'hearts', 1),
    ];
    expect(seq.length).toBe(14);
    const r = validateMeld('sequence', seq);
    expect(r.valid).toBe(true);
  });
});

describe('Sequence — Ace flexibility', () => {
  it('accepts A,2,3 (Ace low at start)', () => {
    expect(validateMeld('sequence', [rc('A', 'hearts'), rc('2', 'hearts'), rc('3', 'hearts')]).valid).toBe(true);
  });

  it('accepts Q,K,A (Ace high at end)', () => {
    expect(validateMeld('sequence', [rc('Q', 'diamonds'), rc('K', 'diamonds'), rc('A', 'diamonds')]).valid).toBe(true);
  });

  it('accepts 10,J,Q,K,A (Ace high, longer)', () => {
    expect(
      validateMeld('sequence', [rc('10', 'spades'), rc('J', 'spades'), rc('Q', 'spades'), rc('K', 'spades'), rc('A', 'spades')]).valid,
    ).toBe(true);
  });

  it('accepts A,2,3,4,5,6 clubs (longer Ace-low)', () => {
    expect(validateMeld('sequence', buildSeq('clubs', 'A', '6')).valid).toBe(true);
  });
});

describe('Sequence — invalid cases', () => {
  it('rejects mixed suits', () => {
    const r = validateMeld('sequence', [rc('4', 'hearts'), rc('5', 'spades'), rc('6', 'hearts')]);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/same suit/i);
  });

  it('rejects circular wraparound (K,A,2)', () => {
    const r = validateMeld('sequence', [rc('K', 'hearts'), rc('A', 'hearts'), rc('2', 'hearts')]);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/consecutive/i);
  });

  it('rejects broken-order / non-consecutive (3,5,7)', () => {
    const r = validateMeld('sequence', [rc('3', 'hearts'), rc('5', 'hearts'), rc('7', 'hearts')]);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/consecutive/i);
  });

  it('rejects duplicate same-suit same-rank cards from two decks (4,4,5)', () => {
    const r = validateMeld('sequence', [rc('4', 'hearts', 0), rc('4', 'hearts', 1), rc('5', 'hearts')]);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/consecutive/i);
  });

  it('rejects two Aces without all the cards in between (A,A,3,4)', () => {
    // Both Aces cannot legally fit in a 4-card sequence — need 14 cards for dual-Ace.
    const r = validateMeld('sequence', [rc('A', 'hearts', 0), rc('A', 'hearts', 1), rc('3', 'hearts'), rc('4', 'hearts')]);
    expect(r.valid).toBe(false);
  });

  it('rejects two Aces in a 3-card meld (A,2,A)', () => {
    const r = validateMeld('sequence', [rc('A', 'hearts', 0), rc('2', 'hearts'), rc('A', 'hearts', 1)]);
    expect(r.valid).toBe(false);
  });
});

describe('Sequence — joker handling', () => {
  it('accepts a sequence with a joker filling an interior gap (5, joker, 7 hearts)', () => {
    expect(validateMeld('sequence', [rc('5', 'hearts'), joker(0), rc('7', 'hearts')]).valid).toBe(true);
  });

  it('accepts a long sequence with a joker (5,6,joker,8,9,10 hearts)', () => {
    expect(
      validateMeld('sequence', [rc('5', 'hearts'), rc('6', 'hearts'), joker(0), rc('8', 'hearts'), rc('9', 'hearts'), rc('10', 'hearts')]).valid,
    ).toBe(true);
  });

  it('accepts a joker extending the high edge (Q,K,joker as Q-K-A)', () => {
    expect(validateMeld('sequence', [rc('Q', 'spades'), rc('K', 'spades'), joker(0)]).valid).toBe(true);
  });

  it('rejects two jokers in one sequence', () => {
    const r = validateMeld('sequence', [rc('5', 'hearts'), joker(0), joker(1), rc('8', 'hearts')]);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/at most 1 joker/i);
  });

  it('accepts a 14-card dual-Ace run with a joker substituting for one card', () => {
    // Replace the 7♥ in the full A-K-A run with a joker.
    const full: Card[] = [
      rc('A', 'hearts', 0),
      ...buildSeq('hearts', '2', '6'),
      joker(0),
      ...buildSeq('hearts', '8', 'K'),
      rc('A', 'hearts', 1),
    ];
    expect(full.length).toBe(14);
    expect(validateMeld('sequence', full).valid).toBe(true);
  });
});
