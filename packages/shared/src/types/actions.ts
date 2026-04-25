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
 * Two legal modes — both end with EXACTLY one card on the pile and the
 * turn passes immediately afterwards:
 *
 *   1. LEAVE-ONE  (set `keepOnPileCard`):
 *      The player picks any one card currently on the discard pile to
 *      remain there.  Every other pile card moves into the player's
 *      hand.  No further hand discard is required.  Works for any
 *      pile size ≥ 2 (with pile.length === 1, leave-one would be a
 *      no-op pickup, which is rejected).
 *
 *   2. TAKE-ALL-REPLACE  (set `returnCardFromHand`):
 *      Every pile card moves into the player's hand, and the player
 *      then puts one card from their (now-extended) hand onto the pile.
 *      That returned card may be one they already held OR one they
 *      just picked up — game-core checks the card exists in the
 *      post-pickup hand, so both are accepted.
 *
 * Exactly one of `keepOnPileCard` / `returnCardFromHand` must be set.
 *
 * After either action, turnPhase advances to the next player and
 * `didTakeFromDiscardThisTurn` is set to true (which blocks go-down,
 * add-to-meld, add-new-meld, and replace-joker for the rest of THIS
 * player's turn — moot in practice because the turn ends immediately).
 */
export interface TakeFromDiscardAction {
  readonly type: 'take-from-discard';
  /**
   * LEAVE-ONE mode — the discard-pile card the player wants to remain
   * on the pile.  Every other pile card moves to the player's hand.
   */
  readonly keepOnPileCard?: Card;
  /**
   * TAKE-ALL-REPLACE mode — after taking the entire pile into hand,
   * this card is put back onto the pile.  May be a card the player
   * originally held or one of the just-picked-up cards.
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
