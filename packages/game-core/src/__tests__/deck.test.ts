import type { RegularCard, JokerCard, Card } from '@calash/shared';
import { GAME_CONFIG } from '@calash/shared';
import {
  createDeck,
  shuffleDeck,
  dealHands,
  isSameCard,
  removeCardsFromHand,
} from '../deck.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const rc = (rank: RegularCard['rank'], suit: RegularCard['suit'], deckIndex: 0 | 1 = 0): RegularCard =>
  ({ rank, suit, isJoker: false, deckIndex });

const joker = (jokerIndex: 0 | 1 = 0): JokerCard =>
  ({ rank: 'JOKER', suit: null, isJoker: true, jokerIndex });

// ─── createDeck ───────────────────────────────────────────────────────────────

describe('createDeck', () => {
  it('produces exactly TOTAL_CARDS cards', () => {
    expect(createDeck()).toHaveLength(GAME_CONFIG.TOTAL_CARDS);
  });

  it('contains 2 copies of each regular card (one per deckIndex)', () => {
    const deck = createDeck();
    const regulars = deck.filter((c): c is RegularCard => !c.isJoker);
    expect(regulars).toHaveLength(104); // 52 × 2
    const d0 = regulars.filter((c) => c.deckIndex === 0);
    const d1 = regulars.filter((c) => c.deckIndex === 1);
    expect(d0).toHaveLength(52);
    expect(d1).toHaveLength(52);
  });

  it('contains exactly 2 jokers', () => {
    const deck = createDeck();
    const jokers = deck.filter((c) => c.isJoker);
    expect(jokers).toHaveLength(2);
    const jokerCards = jokers as JokerCard[];
    expect(jokerCards.map((j) => j.jokerIndex).sort()).toEqual([0, 1]);
  });

  it('includes all four suits', () => {
    const deck = createDeck();
    const suits = new Set(
      deck.filter((c): c is RegularCard => !c.isJoker).map((c) => c.suit),
    );
    expect(suits).toEqual(new Set(['hearts', 'diamonds', 'clubs', 'spades']));
  });

  it('includes all thirteen ranks per suit per deck', () => {
    const deck = createDeck();
    const hearts0 = deck.filter(
      (c): c is RegularCard => !c.isJoker && c.suit === 'hearts' && c.deckIndex === 0,
    );
    expect(hearts0).toHaveLength(13);
  });
});

// ─── shuffleDeck ─────────────────────────────────────────────────────────────

describe('shuffleDeck', () => {
  it('returns an array of the same length', () => {
    const deck = createDeck();
    expect(shuffleDeck(deck)).toHaveLength(deck.length);
  });

  it('does not mutate the input array', () => {
    const deck = createDeck();
    const first = deck[0];
    shuffleDeck(deck);
    expect(deck[0]).toBe(first);
  });

  it('produces a different ordering with overwhelming probability', () => {
    const deck = createDeck();
    const shuffled = shuffleDeck(deck);
    const unchanged = deck.every((c, i) => c === shuffled[i]);
    expect(unchanged).toBe(false);
  });

  it('contains the same set of cards after shuffling', () => {
    const deck = createDeck();
    const shuffled = shuffleDeck(deck);
    const originalIds = new Set(deck.map((c) => JSON.stringify(c)));
    const shuffledIds = new Set(shuffled.map((c) => JSON.stringify(c)));
    expect(shuffledIds).toEqual(originalIds);
  });
});

// ─── dealHands ────────────────────────────────────────────────────────────────

describe('dealHands', () => {
  it('gives 15 cards to the first player in a 2-player game', () => {
    const { hands } = dealHands(createDeck(), 2);
    expect(hands[0]).toHaveLength(GAME_CONFIG.FIRST_PLAYER_CARDS);
  });

  it('gives 14 cards to the second player in a 2-player game', () => {
    const { hands } = dealHands(createDeck(), 2);
    expect(hands[1]).toHaveLength(GAME_CONFIG.CARDS_PER_PLAYER);
  });

  it('deals correct hand sizes in a 4-player game', () => {
    const { hands } = dealHands(createDeck(), 4);
    expect(hands[0]).toHaveLength(15);
    expect(hands[1]).toHaveLength(14);
    expect(hands[2]).toHaveLength(14);
    expect(hands[3]).toHaveLength(14);
  });

  it('returns the correct number of remaining cards for 2 players', () => {
    const deck = createDeck();
    const { remaining } = dealHands(deck, 2);
    const expected = GAME_CONFIG.TOTAL_CARDS - GAME_CONFIG.FIRST_PLAYER_CARDS - GAME_CONFIG.CARDS_PER_PLAYER;
    expect(remaining).toHaveLength(expected);
  });

  it('returns the correct number of remaining cards for 4 players', () => {
    const deck = createDeck();
    const { remaining } = dealHands(deck, 4);
    const expected = GAME_CONFIG.TOTAL_CARDS - GAME_CONFIG.FIRST_PLAYER_CARDS - GAME_CONFIG.CARDS_PER_PLAYER * 3;
    expect(remaining).toHaveLength(expected);
  });

  it('throws when deck has too few cards', () => {
    expect(() => dealHands([], 2)).toThrow(/not enough cards/i);
  });

  it('deals disjoint hands — no card appears in two hands', () => {
    const deck = createDeck();
    const { hands } = dealHands(deck, 2);
    const serialised = hands.flat().map((c) => JSON.stringify(c));
    const unique = new Set(serialised);
    expect(unique.size).toBe(serialised.length);
  });
});

// ─── isSameCard ───────────────────────────────────────────────────────────────

describe('isSameCard', () => {
  it('returns true for identical regular cards', () => {
    expect(isSameCard(rc('7', 'hearts', 0), rc('7', 'hearts', 0))).toBe(true);
  });

  it('returns false when deckIndex differs', () => {
    expect(isSameCard(rc('7', 'hearts', 0), rc('7', 'hearts', 1))).toBe(false);
  });

  it('returns false when rank differs', () => {
    expect(isSameCard(rc('7', 'hearts', 0), rc('8', 'hearts', 0))).toBe(false);
  });

  it('returns false when suit differs', () => {
    expect(isSameCard(rc('7', 'hearts', 0), rc('7', 'spades', 0))).toBe(false);
  });

  it('returns true for identical jokers', () => {
    expect(isSameCard(joker(0), joker(0))).toBe(true);
  });

  it('returns false when jokerIndex differs', () => {
    expect(isSameCard(joker(0), joker(1))).toBe(false);
  });

  it('returns false comparing joker with regular card', () => {
    expect(isSameCard(joker(0) as Card, rc('A', 'spades', 0) as Card)).toBe(false);
  });
});

// ─── removeCardsFromHand ─────────────────────────────────────────────────────

describe('removeCardsFromHand', () => {
  it('removes the target card from the hand', () => {
    const hand = [rc('7', 'hearts', 0), rc('8', 'hearts', 0), rc('9', 'hearts', 0)];
    const result = removeCardsFromHand(hand, [rc('8', 'hearts', 0)]);
    expect(result).toHaveLength(2);
    expect(result.some((c) => isSameCard(c, rc('8', 'hearts', 0)))).toBe(false);
  });

  it('does not mutate the input array', () => {
    const hand = [rc('7', 'hearts', 0), rc('8', 'hearts', 0)];
    removeCardsFromHand(hand, [rc('7', 'hearts', 0)]);
    expect(hand).toHaveLength(2);
  });

  it('throws when the card is not in the hand', () => {
    const hand = [rc('7', 'hearts', 0)];
    expect(() => removeCardsFromHand(hand, [rc('8', 'hearts', 0)])).toThrow();
  });

  it('correctly handles two copies of the same rank+suit by deckIndex', () => {
    const hand: Card[] = [rc('7', 'hearts', 0), rc('7', 'hearts', 1)];
    const result = removeCardsFromHand(hand, [rc('7', 'hearts', 0)]);
    expect(result).toHaveLength(1);
    expect((result[0] as RegularCard).deckIndex).toBe(1);
  });

  it('throws when trying to remove the same card twice from a hand with one copy', () => {
    const hand: Card[] = [rc('7', 'hearts', 0)];
    expect(() => removeCardsFromHand(hand, [rc('7', 'hearts', 0), rc('7', 'hearts', 0)])).toThrow();
  });
});
