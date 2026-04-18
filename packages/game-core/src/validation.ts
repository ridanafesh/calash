import type { Card, GameAction, GameState } from '@calash/shared';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateAction(
  action: GameAction,
  state: GameState,
  playerId: string,
  playerHand: Card[],
): ValidationResult {
  if (state.currentTurnPlayerId !== playerId) {
    return { valid: false, reason: 'Not your turn' };
  }

  if (action.type === 'play-card') {
    if (!action.card) {
      return { valid: false, reason: 'No card specified' };
    }
    const hasCard = playerHand.some(
      (c) => c.suit === action.card!.suit && c.rank === action.card!.rank,
    );
    if (!hasCard) {
      return { valid: false, reason: 'Card not in hand' };
    }
  }

  return { valid: true };
}
