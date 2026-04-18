import type { Card } from '@calash/shared';

const RANK_VALUES: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};

export function cardValue(card: Card): number {
  return RANK_VALUES[card.rank] ?? 0;
}

export function handValue(hand: Card[]): number {
  return hand.reduce((sum, card) => sum + cardValue(card), 0);
}

export function determineWinner(scores: Record<string, number>): string {
  let winnerId = '';
  let highScore = -Infinity;
  for (const [playerId, score] of Object.entries(scores)) {
    if (score > highScore) {
      highScore = score;
      winnerId = playerId;
    }
  }
  return winnerId;
}
