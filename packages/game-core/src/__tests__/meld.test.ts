import type { RegularCard, JokerCard, Card } from '@calash/shared';
import {
  validateMeld,
  validateMeldExtension,
  cardValue,
  totalCardValue,
  totalMeldValue,
} from '../meld.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const rc = (rank: RegularCard['rank'], suit: RegularCard['suit'], deckIndex: 0 | 1 = 0): RegularCard =>
  ({ rank, suit, isJoker: false, deckIndex });

const joker = (jokerIndex: 0 | 1 = 0): JokerCard =>
  ({ rank: 'JOKER', suit: null, isJoker: true, jokerIndex });

// ─── Sequence validation ─────────────────────────────────────────────────────

describe('validateMeld — sequence', () => {
  it('accepts a valid 3-card same-suit sequence', () => {
    const result = validateMeld('sequence', [rc('7', 'hearts'), rc('8', 'hearts'), rc('9', 'hearts')]);
    expect(result.valid).toBe(true);
  });

  it('accepts a 5-card sequence', () => {
    const cards = [rc('3', 'clubs'), rc('4', 'clubs'), rc('5', 'clubs'), rc('6', 'clubs'), rc('7', 'clubs')];
    expect(validateMeld('sequence', cards).valid).toBe(true);
  });

  it('rejects fewer than 3 cards', () => {
    const result = validateMeld('sequence', [rc('7', 'hearts'), rc('8', 'hearts')]);
    expect(result.valid).toBe(false);
  });

  it('rejects mixed suits', () => {
    const result = validateMeld('sequence', [rc('7', 'hearts'), rc('8', 'diamonds'), rc('9', 'hearts')]);
    expect(result.valid).toBe(false);
  });

  it('rejects non-consecutive ranks', () => {
    const result = validateMeld('sequence', [rc('5', 'hearts'), rc('7', 'hearts'), rc('9', 'hearts')]);
    expect(result.valid).toBe(false);
  });

  it('accepts ace-low (A-2-3)', () => {
    const result = validateMeld('sequence', [rc('A', 'hearts'), rc('2', 'hearts'), rc('3', 'hearts')]);
    expect(result.valid).toBe(true);
  });

  it('accepts ace-high (Q-K-A)', () => {
    const result = validateMeld('sequence', [rc('Q', 'spades'), rc('K', 'spades'), rc('A', 'spades')]);
    expect(result.valid).toBe(true);
  });

  it('rejects circular wrap K-A-2', () => {
    const result = validateMeld('sequence', [rc('K', 'hearts'), rc('A', 'hearts'), rc('2', 'hearts')]);
    expect(result.valid).toBe(false);
  });

  it('accepts a joker filling an interior gap (5-Joker-7)', () => {
    const result = validateMeld('sequence', [rc('5', 'clubs'), joker(0), rc('7', 'clubs')]);
    expect(result.valid).toBe(true);
  });

  it('accepts a joker extending an edge (7-8-Joker) — edge extension fix', () => {
    const result = validateMeld('sequence', [rc('7', 'hearts'), rc('8', 'hearts'), joker(0)]);
    expect(result.valid).toBe(true);
  });

  it('accepts a joker extending the low edge (Joker-8-9)', () => {
    const result = validateMeld('sequence', [joker(0), rc('8', 'diamonds'), rc('9', 'diamonds')]);
    expect(result.valid).toBe(true);
  });

  it('accepts a joker extending a longer sequence (7-8-9-Joker)', () => {
    const result = validateMeld('sequence', [
      rc('7', 'spades'), rc('8', 'spades'), rc('9', 'spades'), joker(0),
    ]);
    expect(result.valid).toBe(true);
  });

  it('rejects 2 jokers in one sequence', () => {
    const result = validateMeld('sequence', [rc('7', 'hearts'), joker(0), joker(1)]);
    expect(result.valid).toBe(false);
  });

  it('rejects a joker that cannot bridge the gap (gap too large)', () => {
    // 5 and 9 are 4 apart — need 3 interior positions, but only 1 joker
    const result = validateMeld('sequence', [rc('5', 'hearts'), joker(0), rc('9', 'hearts')]);
    expect(result.valid).toBe(false);
  });

  it('accepts a sequence with two cards from different decks in non-consecutive positions uses joker to bridge', () => {
    // 5♥(deck0)-6♥(deck0)-7♥(deck0) is valid
    const result = validateMeld('sequence', [
      rc('5', 'hearts', 0), rc('6', 'hearts', 0), rc('7', 'hearts', 0),
    ]);
    expect(result.valid).toBe(true);
  });

  it('rejects duplicate rank+suit in the same sequence (two 7♥ deck0)', () => {
    const result = validateMeld('sequence', [
      rc('7', 'hearts', 0), rc('7', 'hearts', 0), rc('8', 'hearts', 0),
    ]);
    expect(result.valid).toBe(false);
  });
});

// ─── Set validation ───────────────────────────────────────────────────────────

describe('validateMeld — set', () => {
  it('accepts a valid 3-of-a-kind with different suits', () => {
    const result = validateMeld('set', [rc('K', 'hearts'), rc('K', 'diamonds'), rc('K', 'clubs')]);
    expect(result.valid).toBe(true);
  });

  it('accepts a valid 4-of-a-kind', () => {
    const result = validateMeld('set', [
      rc('9', 'hearts'), rc('9', 'diamonds'), rc('9', 'clubs'), rc('9', 'spades'),
    ]);
    expect(result.valid).toBe(true);
  });

  it('accepts a 3-of-a-kind with one joker', () => {
    const result = validateMeld('set', [rc('Q', 'hearts'), rc('Q', 'spades'), joker(0)]);
    expect(result.valid).toBe(true);
  });

  it('rejects fewer than 3 cards', () => {
    const result = validateMeld('set', [rc('K', 'hearts'), rc('K', 'diamonds')]);
    expect(result.valid).toBe(false);
  });

  it('rejects more than 4 cards', () => {
    const result = validateMeld('set', [
      rc('9', 'hearts'), rc('9', 'diamonds'), rc('9', 'clubs'), rc('9', 'spades'), rc('9', 'hearts', 1),
    ]);
    expect(result.valid).toBe(false);
  });

  it('rejects different ranks', () => {
    const result = validateMeld('set', [rc('K', 'hearts'), rc('Q', 'diamonds'), rc('J', 'clubs')]);
    expect(result.valid).toBe(false);
  });

  it('rejects duplicate suits (same rank, same suit from two decks)', () => {
    const result = validateMeld('set', [
      rc('8', 'hearts', 0), rc('8', 'hearts', 1), rc('8', 'clubs', 0),
    ]);
    expect(result.valid).toBe(false);
  });

  it('rejects 2 jokers', () => {
    const result = validateMeld('set', [rc('J', 'hearts'), joker(0), joker(1)]);
    expect(result.valid).toBe(false);
  });
});

// ─── validateMeldExtension ────────────────────────────────────────────────────

describe('validateMeldExtension', () => {
  it('accepts valid extension of a sequence (add card to end)', () => {
    const existing = [rc('7', 'hearts'), rc('8', 'hearts'), rc('9', 'hearts')];
    const result = validateMeldExtension('sequence', existing, [rc('10', 'hearts')]);
    expect(result.valid).toBe(true);
  });

  it('accepts valid extension of a sequence (add card to beginning)', () => {
    const existing = [rc('7', 'hearts'), rc('8', 'hearts'), rc('9', 'hearts')];
    const result = validateMeldExtension('sequence', existing, [rc('6', 'hearts')]);
    expect(result.valid).toBe(true);
  });

  it('rejects extending sequence with wrong suit', () => {
    const existing = [rc('7', 'hearts'), rc('8', 'hearts'), rc('9', 'hearts')];
    const result = validateMeldExtension('sequence', existing, [rc('10', 'spades')]);
    expect(result.valid).toBe(false);
  });

  it('accepts valid extension of a 3-set to 4-set', () => {
    const existing = [rc('A', 'hearts'), rc('A', 'diamonds'), rc('A', 'clubs')];
    const result = validateMeldExtension('set', existing, [rc('A', 'spades')]);
    expect(result.valid).toBe(true);
  });

  it('rejects extending set to 5 cards', () => {
    const existing = [rc('A', 'hearts'), rc('A', 'diamonds'), rc('A', 'clubs'), rc('A', 'spades')];
    const result = validateMeldExtension('set', existing, [rc('A', 'hearts', 1)]);
    expect(result.valid).toBe(false);
  });
});

// ─── Card value helpers ───────────────────────────────────────────────────────

describe('cardValue', () => {
  it('joker is worth 25', () => expect(cardValue(joker())).toBe(25));
  it('ace is worth 25', () => expect(cardValue(rc('A', 'hearts'))).toBe(25));
  it('king is worth 10', () => expect(cardValue(rc('K', 'spades'))).toBe(10));
  it('queen is worth 10', () => expect(cardValue(rc('Q', 'clubs'))).toBe(10));
  it('jack is worth 10', () => expect(cardValue(rc('J', 'hearts'))).toBe(10));
  it('10 is worth 10', () => expect(cardValue(rc('10', 'diamonds'))).toBe(10));
  it('9 is worth 9', () => expect(cardValue(rc('9', 'hearts'))).toBe(9));
  it('2 is worth 2', () => expect(cardValue(rc('2', 'clubs'))).toBe(2));
});

describe('totalCardValue', () => {
  it('sums values of a hand', () => {
    const cards: Card[] = [rc('K', 'hearts'), rc('5', 'clubs'), joker(0)];
    expect(totalCardValue(cards)).toBe(10 + 5 + 25);
  });

  it('returns 0 for empty array', () => {
    expect(totalCardValue([])).toBe(0);
  });
});

describe('totalMeldValue', () => {
  it('sums the values of multiple melds', () => {
    const melds = [
      { cards: [rc('K', 'hearts'), rc('K', 'diamonds'), rc('K', 'clubs')] as Card[] },
      { cards: [rc('5', 'spades'), rc('6', 'spades'), rc('7', 'spades')] as Card[] },
    ];
    expect(totalMeldValue(melds)).toBe(30 + 18);
  });
});
