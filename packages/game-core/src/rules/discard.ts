import type { Card } from '@calash/shared';
import {
  DISCARD_PILE_MIN_REMAINING,
  DISCARD_PILE_TAKE_ALL_THRESHOLD,
} from '@calash/shared';
import type { ValidationResult } from '../meld.js';

/**
 * Validate a "take from discard pile" action.
 *
 * General rule: after taking, exactly 1 card must remain on the pile.
 * This means the player must take `pile.length − 1` cards.
 *
 * Special case — when pile.length === DISCARD_PILE_TAKE_ALL_THRESHOLD (4):
 *   Option A: take 3, leave 1 (the standard rule).
 *   Option B: take all 4 and immediately return 1 card from hand to the pile.
 *             In this case `returnCardFromHand` must be provided.
 *   Prohibited: taking 2 (leaving 2) is explicitly NOT allowed.
 *
 * Design note: this function is purely structural — it does not check whether
 * the player actually holds `returnCardFromHand` in their hand.  That check
 * belongs in the turn-level action validator (rules/turn.ts) where hand state
 * is available.
 */
export function validateTakeFromDiscard(
  pile: readonly Card[],
  count: number,
  returnCardFromHand?: Card,
): ValidationResult {
  if (pile.length <= DISCARD_PILE_MIN_REMAINING) {
    return {
      valid: false,
      reason: `Cannot take from the discard pile: only ${DISCARD_PILE_MIN_REMAINING} card remains and it must stay`,
    };
  }

  const standardCount = pile.length - DISCARD_PILE_MIN_REMAINING; // normally pile.length − 1

  if (pile.length === DISCARD_PILE_TAKE_ALL_THRESHOLD) {
    // When pile has exactly 4 cards the player has two valid choices:
    //   A) take 3 (the standard rule)
    //   B) take all 4 + return 1 from hand

    if (count === standardCount) {
      // Option A — standard take
      return { valid: true };
    }

    if (count === pile.length) {
      // Option B — take all, but must return a card
      if (!returnCardFromHand) {
        return {
          valid: false,
          reason:
            'When taking all 4 cards from the discard pile you must return 1 card from your hand',
        };
      }
      return { valid: true };
    }

    // Any other count (e.g. 2) is prohibited — the rules explicitly forbid
    // "take 2, leave 2" even though it would be a valid move by the general rule.
    return {
      valid: false,
      reason:
        `With 4 cards on the discard pile you must take 3 (leave 1) ` +
        `or take all 4 and return 1 from hand — taking ${count} is not allowed`,
    };
  }

  // General case: player must take exactly pile.length − 1
  if (count !== standardCount) {
    return {
      valid: false,
      reason:
        `Must take exactly ${standardCount} card(s) from the discard pile ` +
        `(leaving ${DISCARD_PILE_MIN_REMAINING}); requested ${count}`,
    };
  }

  return { valid: true };
}

/**
 * Apply a "take from discard" action to the pile, returning the cards taken
 * and the updated pile.
 *
 * The pile is ordered oldest-first (index 0 = bottom).  Taking removes from
 * the top (the end of the array).
 */
export function applyTakeFromDiscard(
  pile: Card[],
  count: number,
  returnCardFromHand?: Card,
): { taken: Card[]; newPile: Card[] } {
  const taken = pile.slice(pile.length - count);
  let newPile = pile.slice(0, pile.length - count);

  if (returnCardFromHand) {
    newPile = [...newPile, returnCardFromHand];
  }

  return { taken, newPile };
}
