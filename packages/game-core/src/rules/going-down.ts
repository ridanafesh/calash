import type { Card, MeldType } from '@calash/shared';
import { GAME_CONFIG } from '@calash/shared';
import { validateMeld, totalCardValue } from '../meld.js';
import type { ValidationResult } from '../meld.js';
import { isSameCard } from '../deck.js';

interface MeldInput {
  type: MeldType;
  cards: readonly Card[];
}

/**
 * Compute the minimum meld total a player must open with.
 *
 * Rules:
 *   - If no player has gone down yet (highestTableTotal === 0):
 *       minimum = INITIAL_GO_DOWN_MINIMUM (75)
 *   - If at least one player is already down:
 *       minimum = highestTableTotal + GO_DOWN_INCREMENT (+ 5)
 *
 * This threshold is dynamic.  If a player who is already down later adds
 * cards and raises their tableTotal, the minimum rises again for any player
 * who still hasn't gone down.
 */
export function goDownMinimum(highestTableTotal: number): number {
  if (highestTableTotal === 0) {
    return GAME_CONFIG.INITIAL_GO_DOWN_MINIMUM;
  }
  return highestTableTotal + GAME_CONFIG.GO_DOWN_INCREMENT;
}

/**
 * Validate that a player's go-down action is legal.
 *
 * Checks (in order):
 *   1. The player has not already gone down.
 *   2. The player did not take from the discard pile this turn.
 *   3. Every meld in the list is independently valid.
 *   4. The combined value of all melds meets the go-down minimum.
 *   5. All cards claimed to be played are actually in the player's hand.
 */
export function validateGoDown(
  melds: readonly MeldInput[],
  playerHand: readonly Card[],
  highestTableTotal: number,
  hasGoneDown: boolean,
  didTakeFromDiscardThisTurn: boolean,
): ValidationResult {
  if (hasGoneDown) {
    return { valid: false, reason: 'Player has already gone down this round' };
  }

  if (didTakeFromDiscardThisTurn) {
    return {
      valid: false,
      reason: 'Cannot go down on the same turn you took from the discard pile',
    };
  }

  if (melds.length === 0) {
    return { valid: false, reason: 'Must provide at least one meld to go down' };
  }

  // Validate each meld independently
  for (let i = 0; i < melds.length; i++) {
    const result = validateMeld(melds[i].type, melds[i].cards);
    if (!result.valid) {
      return {
        valid: false,
        reason: `Meld ${i + 1} is invalid: ${result.reason}`,
      };
    }
  }

  // Check the combined value meets the threshold
  const combinedValue = melds.reduce((sum, m) => sum + totalCardValue(m.cards), 0);
  const minimum = goDownMinimum(highestTableTotal);

  if (combinedValue < minimum) {
    const detail = highestTableTotal === 0
      ? `First opener must reach ${GAME_CONFIG.INITIAL_GO_DOWN_MINIMUM}.`
      : `Highest table total is ${highestTableTotal}; you need at least ${minimum}.`;
    return {
      valid: false,
      reason: `Go-down total (${combinedValue}) is below the required minimum (${minimum}). ${detail}`,
    };
  }

  // Verify all played cards exist in the player's hand (no duplicates allowed)
  const allPlayedCards = melds.flatMap((m) => [...m.cards]);
  const handCopy = [...playerHand];

  for (const card of allPlayedCards) {
    const idx = handCopy.findIndex((c) => isSameCard(c, card));
    if (idx === -1) {
      return {
        valid: false,
        reason: `Card ${describeCard(card)} is not in your hand`,
      };
    }
    handCopy.splice(idx, 1); // consume the card so it can't be used twice
  }

  return { valid: true };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function describeCard(card: Card): string {
  if (card.isJoker) return `Joker(${card.jokerIndex})`;
  return `${card.rank}${card.suit[0].toUpperCase()}(deck${card.deckIndex})`;
}
