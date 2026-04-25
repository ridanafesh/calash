import type { Card } from '@calash/shared';
import type { ValidationResult } from '../meld.js';

/**
 * Validate a "take from discard pile" action.
 *
 * Invariant: after the action, exactly 1 card must remain on the discard pile.
 *
 * This invariant has exactly two legal forms:
 *
 *   - LEAVE-ONE mode:    count === pile.length - 1, returnCardFromHand absent.
 *                        The bottom card stays on the pile.
 *                        (When pile.length === 1, this means count === 0,
 *                        which is a no-op — disallowed: not a real take.)
 *
 *   - TAKE-ALL-REPLACE:  count === pile.length, returnCardFromHand provided.
 *                        Every existing pile card is taken into hand;
 *                        the player puts a card from hand onto the pile so
 *                        exactly 1 card remains.
 *                        (Works for any pile size, including pile.length === 1.)
 *
 * Design note: this function is purely structural. The turn-level validator
 * (rules/turn.ts) checks that returnCardFromHand actually lives in the
 * player's hand.
 */
export function validateTakeFromDiscard(
  pile: readonly Card[],
  count: number,
  returnCardFromHand?: Card,
): ValidationResult {
  if (pile.length === 0) {
    return { valid: false, reason: 'Discard pile is empty — nothing to take' };
  }

  // TAKE-ALL-REPLACE: count === pile.length, return required.
  if (count === pile.length) {
    if (!returnCardFromHand) {
      return {
        valid: false,
        reason:
          'Take-all mode requires you to put one card from your hand onto the pile',
      };
    }
    return { valid: true };
  }

  // LEAVE-ONE: count === pile.length - 1, no return.
  // count === 0 with pile.length === 1 falls through here as "not a real take".
  if (count === pile.length - 1 && pile.length >= 2) {
    if (returnCardFromHand) {
      return {
        valid: false,
        reason:
          'Leave-one mode does not require a hand replacement — pass returnCardFromHand only with take-all',
      };
    }
    return { valid: true };
  }

  // Any other count is invalid: the post-state would not have exactly 1 card.
  if (pile.length === 1) {
    return {
      valid: false,
      reason:
        'With only 1 card on the pile, the only legal take is "take all and return 1 from hand"',
    };
  }
  return {
    valid: false,
    reason:
      `Invalid take count ${count} for a ${pile.length}-card pile. ` +
      `Either take ${pile.length - 1} (leave bottom) or take all ${pile.length} and return 1 from hand.`,
  };
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
