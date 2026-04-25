/**
 * Pinning tests for the joker-related invariants of the deck and meld system.
 *
 * Existing tests cover joker meld behavior (going-down.test.ts, meld.test.ts,
 * sequence-lengths.test.ts), but the spec calls out specific deck-level
 * guarantees that this file makes explicit:
 *
 *   1. The fresh deck has exactly 106 cards
 *   2. Exactly 2 of those are jokers
 *   3. Each joker has a unique jokerIndex (0 and 1)
 *   4. Each non-joker rank+suit appears exactly twice
 *   5. shuffleDeck preserves both jokers
 *   6. dealHands preserves both jokers
 *   7. cardValue(joker) === 25
 *   8. Joker permitted in valid sequences (max 1)
 *   9. Joker permitted in valid sets (max 1)
 *   10. Two jokers in one meld is rejected
 *   11. Random-seed shuffles always preserve the joker count
 */

import type { Card, JokerCard, RegularCard } from '@calash/shared';
import { CARD_VALUES, GAME_CONFIG } from '@calash/shared';
import { createDeck, shuffleDeck, dealHands } from '../deck.js';
import { cardValue, validateMeld } from '../meld.js';
import { seededShuffle } from '../seeded-random.js';

const rc = (rank: RegularCard['rank'], suit: RegularCard['suit'], deckIndex: 0 | 1 = 0): RegularCard =>
  ({ rank, suit, isJoker: false, deckIndex });

const joker = (jokerIndex: 0 | 1 = 0): JokerCard =>
  ({ rank: 'JOKER', suit: null, isJoker: true, jokerIndex });

// ─── Deck composition ───────────────────────────────────────────────────────

describe('createDeck — composition', () => {
  it('produces exactly 106 cards (2 standard decks + 2 jokers)', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(106);
    expect(deck).toHaveLength(GAME_CONFIG.TOTAL_CARDS);
  });

  it('contains exactly 2 jokers', () => {
    const deck = createDeck();
    const jokers = deck.filter((c) => c.isJoker);
    expect(jokers).toHaveLength(2);
    expect(jokers).toHaveLength(GAME_CONFIG.JOKER_COUNT);
  });

  it('contains exactly 104 regular cards (52 unique combos × 2 decks)', () => {
    const deck = createDeck();
    const regulars = deck.filter((c): c is RegularCard => !c.isJoker);
    expect(regulars).toHaveLength(104);
  });

  it('has the two jokers with distinct jokerIndex values (0 and 1)', () => {
    const deck = createDeck();
    const jokers = deck.filter((c): c is JokerCard => c.isJoker);
    const indexes = jokers.map((j) => j.jokerIndex).sort();
    expect(indexes).toEqual([0, 1]);
  });

  it('every (rank, suit) regular pair appears exactly twice (one per deckIndex)', () => {
    const deck = createDeck();
    const counts = new Map<string, number>();
    for (const c of deck) {
      if (c.isJoker) continue;
      const key = `${c.rank}-${c.suit}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(52); // 13 ranks × 4 suits
    for (const [key, n] of counts) {
      expect(n).toBe(2); // one per deckIndex
      void key;
    }
  });

  it('every regular card has a deckIndex of 0 or 1', () => {
    const deck = createDeck();
    for (const c of deck) {
      if (c.isJoker) continue;
      expect([0, 1]).toContain(c.deckIndex);
    }
  });

  it('every joker has a jokerIndex of 0 or 1', () => {
    const deck = createDeck();
    for (const c of deck) {
      if (!c.isJoker) continue;
      expect([0, 1]).toContain(c.jokerIndex);
    }
  });
});

// ─── Joker survives shuffle / deal / many random seeds ─────────────────────

describe('Joker preservation through shuffle and deal', () => {
  it('shuffleDeck preserves total card count and joker count', () => {
    const deck = createDeck();
    const shuffled = shuffleDeck(deck);
    expect(shuffled).toHaveLength(106);
    expect(shuffled.filter((c) => c.isJoker)).toHaveLength(2);
  });

  it('dealHands preserves the two jokers across hands + remaining deck', () => {
    const shuffled = shuffleDeck(createDeck());
    const { hands, remaining } = dealHands(shuffled, 2);
    const jokersInHands = hands.flat().filter((c) => c.isJoker).length;
    const jokersInRemaining = remaining.filter((c) => c.isJoker).length;
    expect(jokersInHands + jokersInRemaining).toBe(2);
    // Total cards conserved.
    expect(hands.flat().length + remaining.length).toBe(106);
  });

  it('100 seeded shuffles each preserve exactly 2 jokers and 106 total', () => {
    for (let seed = 0; seed < 100; seed++) {
      const d = seededShuffle(createDeck(), seed);
      expect(d).toHaveLength(106);
      expect(d.filter((c) => c.isJoker)).toHaveLength(2);
    }
  });

  it('jokers are dealable — at least some seeded deals put a joker in someone\'s starting hand', () => {
    // Probability that BOTH jokers stay in the draw deck is
    //   C(77,2)/C(106,2) ≈ 0.527 for a 2-player game.
    // So across many seeds, a joker landing in a hand happens often enough
    // that asserting "at least one in 100 deals" is essentially deterministic.
    let dealsWithJokerInHand = 0;
    for (let seed = 0; seed < 100; seed++) {
      const shuffled = seededShuffle(createDeck(), seed);
      const { hands } = dealHands(shuffled, 2);
      const inHand = hands.flat().some((c) => c.isJoker);
      if (inHand) dealsWithJokerInHand++;
    }
    expect(dealsWithJokerInHand).toBeGreaterThan(0);
  });
});

// ─── Joker scoring ─────────────────────────────────────────────────────────

describe('Joker scoring', () => {
  it('cardValue(joker) === 25', () => {
    expect(cardValue(joker(0))).toBe(25);
    expect(cardValue(joker(1))).toBe(25);
    expect(CARD_VALUES.JOKER).toBe(25);
  });
});

// ─── Joker meld rules ──────────────────────────────────────────────────────

describe('Joker meld behavior', () => {
  it('accepts a valid sequence with one joker filling a gap', () => {
    expect(validateMeld('sequence', [rc('5', 'hearts'), joker(0), rc('7', 'hearts')]).valid).toBe(true);
  });

  it('accepts a valid sequence with one joker extending an edge', () => {
    expect(validateMeld('sequence', [rc('Q', 'spades'), rc('K', 'spades'), joker(0)]).valid).toBe(true);
  });

  it('accepts a valid set with one joker filling the missing suit', () => {
    expect(validateMeld('set', [rc('K', 'hearts'), rc('K', 'diamonds'), joker(0)]).valid).toBe(true);
  });

  it('rejects two jokers in one sequence', () => {
    const r = validateMeld('sequence', [rc('5', 'hearts'), joker(0), joker(1), rc('8', 'hearts')]);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/at most 1 joker/i);
  });

  it('rejects two jokers in one set', () => {
    const r = validateMeld('set', [rc('K', 'hearts'), joker(0), joker(1)]);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/at most 1 joker/i);
  });

  it('config exports MAX_JOKERS_PER_MELD = 1', () => {
    // Imported for completeness — pins the constant.
    const { MELD_CONFIG } = jest.requireActual<typeof import('@calash/shared')>('@calash/shared');
    expect(MELD_CONFIG.MAX_JOKERS_PER_MELD).toBe(1);
  });
});

// ─── Card identity helper sanity ───────────────────────────────────────────

describe('Joker identity', () => {
  it('two jokers with different jokerIndex are distinct cards', () => {
    const a: Card = joker(0);
    const b: Card = joker(1);
    expect(a).not.toEqual(b);
  });
});
