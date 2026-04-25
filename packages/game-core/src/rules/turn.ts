import type { Card, MeldType, TurnAction, TurnPhase } from '@calash/shared';
import { validateMeld, validateMeldExtension } from '../meld.js';
import type { ValidationResult } from '../meld.js';
import { validateTakeFromDiscard } from './discard.js';
import { validateGoDown } from './going-down.js';
import { isSameCard } from '../deck.js';

export interface TurnContext {
  /** Current sub-phase of the turn. */
  turnPhase: TurnPhase;
  /** The id of the player whose action is being validated. Used to enforce
   *  the owner-only rule on add-to-meld and replace-joker. */
  actingPlayerId: string;
  /** The active player's hand. */
  playerHand: readonly Card[];
  /** Whether this player has gone down this round. */
  hasGoneDown: boolean;
  /** Whether the player took from the discard pile earlier this turn. */
  didTakeFromDiscardThisTurn: boolean;
  /** Current state of the discard pile (oldest card at index 0). */
  discardPile: readonly Card[];
  /** Number of cards remaining in the hidden deck. */
  hiddenDeckCount: number;
  /** The highest total currently exposed on the table by any player. */
  highestTableTotal: number;
  /**
   * All melds currently on the table, keyed by meld ID.  `ownerPlayerId`
   * is required so the validator can enforce that only the meld's owner
   * may extend it or swap a joker out of it. Melds are publicly visible
   * but private in ownership.
   */
  tableMelds: Record<
    string,
    {
      type: import('@calash/shared').MeldType;
      cards: readonly Card[];
      ownerPlayerId: string;
    }
  >;
}

/**
 * Validate any turn action against the current game context.
 *
 * This is the primary entry point called by the server before applying any
 * player action.  It delegates to focused sub-validators so each rule source
 * remains isolated and testable independently.
 */
export function validateTurnAction(action: TurnAction, ctx: TurnContext): ValidationResult {
  // While a drawn-card decision is pending, the only legal next moves are
  // keep-drawn-card and discard-drawn-card. Block everything else up front
  // so blocking logic isn't duplicated across each branch.
  if (
    ctx.turnPhase === 'pending-drawn-decision' &&
    action.type !== 'keep-drawn-card' &&
    action.type !== 'discard-drawn-card'
  ) {
    return {
      valid: false,
      reason: 'You drew a card — choose Keep or Discard before doing anything else',
    };
  }

  switch (action.type) {
    case 'draw-from-deck':
      return validateDraw(ctx);

    case 'keep-drawn-card':
    case 'discard-drawn-card':
      if (ctx.turnPhase !== 'pending-drawn-decision') {
        return {
          valid: false,
          reason: `Cannot ${action.type} during phase '${ctx.turnPhase}' — no drawn card pending`,
        };
      }
      return { valid: true };

    case 'take-from-discard': {
      if (ctx.turnPhase !== 'awaiting-draw-or-take') {
        return {
          valid: false,
          reason: `Cannot take from discard during phase '${ctx.turnPhase}'; must be 'awaiting-draw-or-take'`,
        };
      }
      const pileResult = validateTakeFromDiscard(ctx.discardPile, action.count, action.returnCardFromHand);
      if (!pileResult.valid) return pileResult;
      if (action.returnCardFromHand) {
        const returnCard = action.returnCardFromHand;
        const inHand = ctx.playerHand.some((c) => isSameCard(c, returnCard));
        if (!inHand) {
          return { valid: false, reason: 'returnCardFromHand is not in your hand' };
        }
      }
      return { valid: true };
    }

    case 'go-down':
      return validateGoDown(
        action.melds,
        ctx.playerHand,
        ctx.highestTableTotal,
        ctx.hasGoneDown,
        ctx.didTakeFromDiscardThisTurn,
      );

    case 'add-to-meld':
      return validateAddToMeld(action.meldId, action.cards, ctx);

    case 'add-new-meld':
      return validateAddNewMeld(action.meld.type, action.meld.cards, ctx);

    case 'replace-joker':
      return validateReplaceJoker(action.meldId, action.replacementCard, ctx);

    case 'discard':
      return validateDiscard(action.card, ctx);
  }
}

// ─── Individual action validators ────────────────────────────────────────────

function validateDraw(ctx: TurnContext): ValidationResult {
  if (ctx.turnPhase !== 'awaiting-draw-or-take') {
    return {
      valid: false,
      reason: `Cannot draw during phase '${ctx.turnPhase}'; must be 'awaiting-draw-or-take'`,
    };
  }
  if (ctx.hiddenDeckCount === 0) {
    return { valid: false, reason: 'The hidden deck is empty — round ends without a draw' };
  }
  return { valid: true };
}

function validateAddToMeld(
  meldId: string,
  newCards: readonly Card[],
  ctx: TurnContext,
): ValidationResult {
  if (ctx.turnPhase !== 'holding') {
    return { valid: false, reason: `Cannot add to a meld during phase '${ctx.turnPhase}'` };
  }
  if (!ctx.hasGoneDown) {
    return { valid: false, reason: 'You must go down before adding cards to melds on the table' };
  }
  // Same restriction as go-down: the player must wait until next turn after
  // taking from the discard pile. Otherwise a player could grab a high-value
  // pile and immediately dump everything onto melds in the same turn.
  if (ctx.didTakeFromDiscardThisTurn) {
    return {
      valid: false,
      reason: 'Cannot add to a meld on the same turn you took from the discard pile',
    };
  }

  const meld = ctx.tableMelds[meldId];
  if (!meld) {
    return { valid: false, reason: `Meld '${meldId}' not found on the table` };
  }
  // Owner-only rule: melds are publicly visible but private in ownership.
  // A player (or bot) may only extend melds they themselves placed. Enforced
  // here at the validator layer; engine handlers double-check as defense in
  // depth so a future caller that bypasses validation can't break the rule.
  if (meld.ownerPlayerId !== ctx.actingPlayerId) {
    return {
      valid: false,
      reason: 'You can only add cards to your own melds',
    };
  }
  if (newCards.length === 0) {
    return { valid: false, reason: 'Must provide at least one card to add to a meld' };
  }

  // Verify the player holds all cards they claim to add
  const handCopy = [...ctx.playerHand];
  for (const card of newCards) {
    const idx = handCopy.findIndex((c) => isSameCard(c, card));
    if (idx === -1) {
      return { valid: false, reason: `Card not found in hand: ${JSON.stringify(card)}` };
    }
    handCopy.splice(idx, 1);
  }

  return validateMeldExtension(meld.type, meld.cards, newCards);
}

function validateAddNewMeld(
  type: MeldType,
  cards: readonly Card[],
  ctx: TurnContext,
): ValidationResult {
  if (ctx.turnPhase !== 'holding') {
    return { valid: false, reason: `Cannot place a new meld during phase '${ctx.turnPhase}'` };
  }
  if (!ctx.hasGoneDown) {
    return { valid: false, reason: 'You must go down before placing additional melds' };
  }
  if (ctx.didTakeFromDiscardThisTurn) {
    return {
      valid: false,
      reason: 'Cannot place a new meld on the same turn you took from the discard pile',
    };
  }

  // Verify hand ownership
  const handCopy = [...ctx.playerHand];
  for (const card of cards) {
    const idx = handCopy.findIndex((c) => isSameCard(c, card));
    if (idx === -1) {
      return { valid: false, reason: `Card not found in hand: ${JSON.stringify(card)}` };
    }
    handCopy.splice(idx, 1);
  }

  return validateMeld(type, cards);
}

function validateReplaceJoker(
  meldId: string,
  replacementCard: Card,
  ctx: TurnContext,
): ValidationResult {
  if (ctx.turnPhase !== 'holding') {
    return { valid: false, reason: `Cannot replace a joker during phase '${ctx.turnPhase}'` };
  }
  if (!ctx.hasGoneDown) {
    return { valid: false, reason: 'You must go down before replacing jokers in melds' };
  }
  if (ctx.didTakeFromDiscardThisTurn) {
    return {
      valid: false,
      reason: 'Cannot replace a joker on the same turn you took from the discard pile',
    };
  }
  if (replacementCard.isJoker) {
    return { valid: false, reason: 'Replacement card cannot itself be a joker' };
  }
  const meld = ctx.tableMelds[meldId];
  if (!meld) {
    return { valid: false, reason: `Meld '${meldId}' not found on the table` };
  }
  // Owner-only rule: only the meld owner may swap a joker out of it.
  // (When the swap succeeds the joker returns to the actor's hand, so
  // letting non-owners do this would also let them poach jokers.)
  if (meld.ownerPlayerId !== ctx.actingPlayerId) {
    return {
      valid: false,
      reason: 'You can only replace jokers in your own melds',
    };
  }
  const inHand = ctx.playerHand.some((c) => isSameCard(c, replacementCard));
  if (!inHand) {
    return { valid: false, reason: 'Replacement card is not in your hand' };
  }
  // The exact rank/suit check and the set-reclaim 4-suit rule live in the
  // engine handler, where the meld's jokerAssignment is available.
  return { valid: true };
}

function validateDiscard(card: Card, ctx: TurnContext): ValidationResult {
  if (ctx.turnPhase !== 'holding') {
    return { valid: false, reason: `Cannot discard during phase '${ctx.turnPhase}'` };
  }

  const inHand = ctx.playerHand.some((c) => isSameCard(c, card));
  if (!inHand) {
    return { valid: false, reason: 'Card to discard is not in your hand' };
  }

  return { valid: true };
}
