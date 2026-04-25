import type { Card, MeldType, JokerAssignment } from './game.js';

/**
 * Discriminated union of every action a player can submit during their turn.
 *
 * Separation from transport types is intentional: these are pure game-domain
 * actions.  The Socket.IO event wrapper lives in events.ts.  Game-core
 * validates TurnAction values without any knowledge of the transport layer.
 */

// ─── Draw phase actions ──────────────────────────────────────────────────────

/**
 * Draw one card from the face-down hidden deck.
 * Valid only when turnPhase === 'awaiting-draw-or-take'.
 * After drawing, turnPhase transitions to 'holding'.
 */
export interface DrawFromDeckAction {
  readonly type: 'draw-from-deck';
}

/**
 * Take cards from the face-up discard pile.
 * Valid only when turnPhase === 'awaiting-draw-or-take'.
 *
 * Constraints enforced by game-core:
 *   - `count` must equal discardPile.length − 1 in the general case
 *     (leaving exactly 1 card on the pile).
 *   - When discardPile.length === 4, `count` may also equal 4, but
 *     then `returnCardFromHand` MUST be provided (the player immediately
 *     returns that card to the pile, restoring it to 1 card remaining).
 *   - Taking 2 from a 4-card pile is explicitly NOT allowed.
 *   - The player cannot go down on the same turn they use this action.
 *
 * After taking, turnPhase transitions to 'holding' and
 * `didTakeFromDiscardThisTurn` is set to true.
 */
export interface TakeFromDiscardAction {
  readonly type: 'take-from-discard';
  /** Number of cards to take from the top of the discard pile. */
  readonly count: number;
  /**
   * Only required when `count` === discardPile.length (taking all cards).
   * This card is immediately returned from the player's hand to the pile.
   */
  readonly returnCardFromHand?: Card;
}

// ─── Holding phase actions ────────────────────────────────────────────────────

/**
 * Place the player's initial melds on the table (going down / opening).
 * Valid only when turnPhase === 'holding' AND hasGoneDown === false.
 *
 * Constraints enforced by game-core:
 *   - Cannot be used on the same turn the player took from the discard pile.
 *   - Total value of all melds must meet the go-down threshold:
 *       - First opener in the round: ≥ INITIAL_GO_DOWN_MINIMUM (75)
 *       - Subsequent openers: ≥ highestTableTotal + GO_DOWN_INCREMENT (+ 5)
 *   - Each meld in the list must independently be a valid sequence or set.
 */
export interface GoDownAction {
  readonly type: 'go-down';
  /**
   * The melds to place on the table.  IDs are assigned server-side.
   *
   * `jokerAssignment` is required only when the meld contains a joker AND
   * the joker's role is ambiguous (multiple legal rank/suit positions). When
   * the role is unambiguous the engine resolves it automatically; supplying
   * an assignment that disagrees with the unambiguous resolution is rejected.
   */
  readonly melds: ReadonlyArray<{
    readonly type: MeldType;
    readonly cards: readonly Card[];
    readonly jokerAssignment?: JokerAssignment;
  }>;
}

/**
 * Extend an existing meld on the table with additional cards from hand.
 * Valid only when turnPhase === 'holding' AND hasGoneDown === true.
 *
 * The resulting meld (existing cards + new cards) must still be valid.
 */
export interface AddToMeldAction {
  readonly type: 'add-to-meld';
  /** ID of the meld already on the table. */
  readonly meldId: string;
  /** One or more cards from the player's hand to append. */
  readonly cards: readonly Card[];
  /**
   * Required only if the player is adding a JOKER to a meld AND the joker's
   * role in the resulting meld is ambiguous. Adding real cards to a meld
   * never affects an existing joker assignment, and adding a joker to a
   * meld that already contains a joker is rejected (max 1 joker per meld).
   */
  readonly jokerAssignment?: JokerAssignment;
}

/**
 * Place an additional new meld on the table (after already going down).
 * Valid only when turnPhase === 'holding' AND hasGoneDown === true.
 */
export interface AddNewMeldAction {
  readonly type: 'add-new-meld';
  readonly meld: {
    readonly type: MeldType;
    readonly cards: readonly Card[];
    /** Required only when the joker's role in the meld is ambiguous. */
    readonly jokerAssignment?: JokerAssignment;
  };
}

/**
 * Replace a joker that's currently in a table meld with the real card it
 * stands for, returning the joker to the player's hand.
 *
 * Valid only when turnPhase === 'holding' AND hasGoneDown === true.
 *
 * Rules enforced by game-core:
 *   - The target meld must currently contain a joker (i.e. carry a
 *     jokerAssignment).
 *   - For SEQUENCES: replacementCard must exactly match the joker's
 *     representsRank + representsSuit.
 *   - For SETS: the natural 4-of-a-kind reclaim rule applies — the joker can
 *     only be reclaimed when the meld already contains all 3 OTHER real
 *     suits of the set rank, AND replacementCard is the 4th missing suit
 *     (which equals the joker's representsSuit). Adding a single real suit
 *     to a 3-card joker set is NOT enough; the player must add the 3rd real
 *     suit first via add-to-meld, then reclaim.
 *   - replacementCard must be in the player's hand.
 *   - Cannot be used on the same turn the player took from the discard pile.
 */
export interface ReplaceJokerAction {
  readonly type: 'replace-joker';
  readonly meldId: string;
  readonly replacementCard: Card;
}

/**
 * Discard one card from hand to the discard pile, ending the turn.
 * Valid only when turnPhase === 'holding'.
 *
 * If this is the player's last card (hand becomes empty after discarding),
 * the round ends immediately and a +20 finish bonus is awarded.
 */
export interface DiscardAction {
  readonly type: 'discard';
  readonly card: Card;
}

// ─── Pending-drawn-card decision actions ────────────────────────────────────

/**
 * Keep the card just drawn from the hidden deck.
 * Valid only when turnPhase === 'pending-drawn-decision'.
 *
 * The pending card is moved into the player's hand and turnPhase advances
 * to 'holding'. The player must then choose a card to discard (which may
 * or may not be the just-drawn card) to end the turn.
 */
export interface KeepDrawnCardAction {
  readonly type: 'keep-drawn-card';
}

/**
 * Discard the card just drawn from the hidden deck directly to the pile,
 * ending the turn.
 * Valid only when turnPhase === 'pending-drawn-decision'.
 *
 * The pending card never enters the player's hand. It is placed on top of
 * the discard pile and turn passes to the next player.
 */
export interface DiscardDrawnCardAction {
  readonly type: 'discard-drawn-card';
}

// ─── Union ───────────────────────────────────────────────────────────────────

export type TurnAction =
  | DrawFromDeckAction
  | TakeFromDiscardAction
  | GoDownAction
  | AddToMeldAction
  | AddNewMeldAction
  | ReplaceJokerAction
  | DiscardAction
  | KeepDrawnCardAction
  | DiscardDrawnCardAction;

export type TurnActionType = TurnAction['type'];
