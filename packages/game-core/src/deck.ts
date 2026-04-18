import type { Card, CardRank, CardSuit } from '@calash/shared';

const SUITS: CardSuit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS: CardRank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function dealCards(deck: Card[], playerCount: number, cardsPerPlayer: number): Card[][] {
  if (playerCount * cardsPerPlayer > deck.length) {
    throw new Error('Not enough cards in deck to deal');
  }
  const hands: Card[][] = Array.from({ length: playerCount }, () => []);
  for (let i = 0; i < cardsPerPlayer; i++) {
    for (let p = 0; p < playerCount; p++) {
      const card = deck[i * playerCount + p];
      hands[p].push(card);
    }
  }
  return hands;
}
