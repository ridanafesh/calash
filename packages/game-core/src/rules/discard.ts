import type { Card } from '@calash/shared';
import type { ValidationResult } from '../meld.js';
import { isSameCard } from '../deck.js';

/**
 * Validate a "take from discard pile" action.
 *
 * Invariant: after the action, exactly 1 card must remain on the discard pile.
 *
 * Two legal forms:
 *
 *   - LEAVE-ONE:           keepOnPileCard set, returnCardFromHand absent.
 *                          Player picks ANY pile card to remain; every other
 *                          pile card moves to hand. Requires pile.length ≥ 2
 *                          (leave-one on a 1-card pile is a no-op pickup).
 *
 *   - TAKE-ALL-REPLACE:    returnCardFromHand set, keepOnPileCard absent.
 *                          The whole pile moves to hand; the returned card
 *                          (from the post-pickup hand) goes onto the pile.
 *                          Works for any pile size ≥ 1.
 *
 * This function is purely structural — it doesn't see the player's hand.
 * The turn-level validator (rules/turn.ts) is responsible for the
 * "card actually exists" checks against the post-pickup hand.
 */
export function validateTakeFromDiscard(
  pile: readonly Card[],
  keepOnPileCard?: Card,
  returnCardFromHand?: Card,
): ValidationResult {
  if (pile.length === 0) {
    return { valid: false, reason: 'Discard pile is empty — nothing to take' };
  }

  // Exactly one mode must be specified.
  if (keepOnPileCard && returnCardFromHand) {
    return {
      valid: false,
      reason:
        'Choose one mode: either keepOnPileCard (leave one on pile) OR returnCardFromHand (take all and return one), not both',
    };
  }
  if (!keepOnPileCard && !returnCardFromHand) {
    return {
      valid: false,
      reason:
        'Specify keepOnPileCard (leave one on pile) or returnCardFromHand (take all and return one)',
    };
  }

  if (keepOnPileCard) {
    if (pile.length < 2) {
      return {
        valid: false,
        reason:
          'With only 1 card on the pile, leave-one is a no-op — use take-all-replace (returnCardFromHand) instead',
      };
    }
    const onPile = pile.some((c) => isSameCard(c, keepOnPileCard));
    if (!onPile) {
      return {
        valid: false,
        reason: 'keepOnPileCard is not currently on the discard pile',
      };
    }
    return { valid: true };
  }

  // returnCardFromHand path — structural OK; the hand-membership check
  // happens in rules/turn.ts because only that layer sees the player hand.
  return { valid: true };
}

/**
 * Apply a "take from discard" action to the pile, returning the cards taken
 * and the updated pile.
 *
 * The pile is ordered oldest-first (index 0 = bottom, last = top).
 *
 *   - LEAVE-ONE: every card except keepOnPileCard moves to `taken`; the
 *     pile becomes [keepOnPileCard]. The first matching pile entry is the
 *     one that stays — duplicate physical cards (from 2-deck play) only
 *     matter because isSameCard already disambiguates by deckIndex.
 *   - TAKE-ALL-REPLACE: the whole pile is `taken`; the pile becomes
 *     [returnCardFromHand]. The caller (engine) is responsible for
 *     removing returnCardFromHand from the actor's resulting hand.
 */
export function applyTakeFromDiscard(
  pile: Card[],
  keepOnPileCard?: Card,
  returnCardFromHand?: Card,
): { taken: Card[]; newPile: Card[] } {
  if (returnCardFromHand) {
    return {
      taken: [...pile],
      newPile: [returnCardFromHand],
    };
  }

  if (!keepOnPileCard) {
    // Caller is broken — validateTakeFromDiscard would have rejected.
    return { taken: [], newPile: [...pile] };
  }

  // LEAVE-ONE: locate the chosen card and split the pile around it.
  const keepIdx = pile.findIndex((c) => isSameCard(c, keepOnPileCard));
  if (keepIdx === -1) {
    return { taken: [], newPile: [...pile] };
  }
  const taken = [...pile.slice(0, keepIdx), ...pile.slice(keepIdx + 1)];
  return { taken, newPile: [pile[keepIdx]] };
}
