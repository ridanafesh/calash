import type { Card, JokerCard, RegularCard, Rank, Suit } from '@calash/shared';
import { GAME_CONFIG } from '@calash/shared';

const SUITS: readonly Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS: readonly Rank[] = [
  '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A',
];

/**
 * Build the full 106-card Calash deck: 2 standard decks + 2 jokers.
 *
 * Each regular card carries a `deckIndex` (0 or 1) so that the game engine
 * can distinguish the two physical copies of the same rank+suit.  Each
 * joker carries a `jokerIndex` (0 or 1) for the same reason.
 *
 * The returned array is in natural order (not shuffled).
 */
export function createDeck(): Card[] {
  const deck: Card[] = [];

  for (let d = 0 as 0 | 1; d < GAME_CONFIG.DECK_COUNT; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        const card: RegularCard = { rank, suit, isJoker: false, deckIndex: d };
        deck.push(card);
      }
    }
  }

  for (let j = 0 as 0 | 1; j < GAME_CONFIG.JOKER_COUNT; j++) {
    const joker: JokerCard = { rank: 'JOKER', suit: null, isJoker: true, jokerIndex: j };
    deck.push(joker);
  }

  // Sanity check — catches bugs if GAME_CONFIG values change
  if (deck.length !== GAME_CONFIG.TOTAL_CARDS) {
    throw new Error(
      `Deck size mismatch: expected ${GAME_CONFIG.TOTAL_CARDS}, got ${deck.length}`,
    );
  }

  return deck;
}

/**
 * Fisher-Yates shuffle — returns a new shuffled array, does not mutate input.
 */
export function shuffleDeck(deck: readonly Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Deal cards to players.
 *
 * Distribution is counterclockwise, one card at a time (matching physical
 * dealing).  The player at index 0 (the player to the dealer's right) is
 * dealt first and receives `firstPlayerCards` cards; all others receive
 * `cardsPerPlayer` cards.
 *
 * Returns an array of hands in the same order as `playerCount` players,
 * where index 0 is the first player.
 *
 * Throws if the deck does not have enough cards.
 */
export function dealHands(
  deck: Card[],
  playerCount: number,
): { hands: Card[][]; remaining: Card[] } {
  const firstCards = GAME_CONFIG.FIRST_PLAYER_CARDS;
  const otherCards = GAME_CONFIG.CARDS_PER_PLAYER;
  const totalNeeded = firstCards + otherCards * (playerCount - 1);

  if (deck.length < totalNeeded) {
    throw new Error(
      `Not enough cards: need ${totalNeeded} for ${playerCount} players, have ${deck.length}`,
    );
  }

  const hands: Card[][] = Array.from({ length: playerCount }, () => []);
  let deckPos = 0;

  // Deal one card at a time counterclockwise, with the first player getting an extra
  const maxCards = firstCards; // first player always gets the most
  for (let round = 0; round < maxCards; round++) {
    for (let p = 0; p < playerCount; p++) {
      const target = p === 0 ? firstCards : otherCards;
      if (round < target) {
        hands[p].push(deck[deckPos++]);
      }
    }
  }

  return { hands, remaining: deck.slice(deckPos) };
}

/**
 * Return true if two cards are the same physical card (same rank, suit,
 * deckIndex for regular cards; same jokerIndex for jokers).
 *
 * Used to validate that the player holds a card they claim to play.
 */
export function isSameCard(a: Card, b: Card): boolean {
  if (a.isJoker !== b.isJoker) return false;
  if (a.isJoker && b.isJoker) return a.jokerIndex === b.jokerIndex;
  if (!a.isJoker && !b.isJoker) {
    return a.rank === b.rank && a.suit === b.suit && a.deckIndex === b.deckIndex;
  }
  return false;
}

/**
 * Remove a set of cards from a hand and return the new hand.
 * Throws if any card is not found (prevents desync bugs).
 */
export function removeCardsFromHand(hand: Card[], toRemove: readonly Card[]): Card[] {
  const remaining = [...hand];
  for (const card of toRemove) {
    const idx = remaining.findIndex((c) => isSameCard(c, card));
    if (idx === -1) {
      throw new Error(`Card not found in hand: ${JSON.stringify(card)}`);
    }
    remaining.splice(idx, 1);
  }
  return remaining;
}
