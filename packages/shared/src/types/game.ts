/**
 * Core card and meld domain types for Calash.
 *
 * Card is a discriminated union on `isJoker`.  This lets TypeScript enforce:
 *   - RegularCard always has a Suit and a standard Rank.
 *   - JokerCard never has a Suit (null) and its rank is the literal 'JOKER'.
 *
 * This avoids nullable suit fields on regular cards and prevents accidental
 * misuse of suit/rank on jokers.
 */

// ─── Suits & Ranks ──────────────────────────────────────────────────────────

export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';

export type Rank =
  | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10'
  | 'J' | 'Q' | 'K' | 'A';

// ─── Card types ──────────────────────────────────────────────────────────────

/**
 * A standard (non-joker) playing card.
 *
 * `deckIndex` (0 or 1) identifies which of the two physical decks this card
 * belongs to.  This is necessary because the game uses 2 full decks, so two
 * cards can share the same rank+suit.  Game-core uses deckIndex to prevent
 * the same physical card from appearing in two places simultaneously.
 */
export interface RegularCard {
  readonly rank: Rank;
  readonly suit: Suit;
  readonly isJoker: false;
  readonly deckIndex: 0 | 1;
}

/**
 * A joker card.  There are exactly 2 jokers in the game.
 * `jokerIndex` (0 or 1) distinguishes them for tracking purposes.
 *
 * Jokers have no suit (null) and the literal rank 'JOKER'.
 * They may substitute for any card in a valid meld, but at most one
 * joker is permitted per meld.
 */
export interface JokerCard {
  readonly rank: 'JOKER';
  readonly suit: null;
  readonly isJoker: true;
  readonly jokerIndex: 0 | 1;
}

export type Card = RegularCard | JokerCard;

// ─── Meld types ───────────────────────────────────────────────────────────────

/**
 * 'sequence' — consecutive ranks, same suit, ≥ 3 cards.
 * 'set'      — same rank, different suits, 3 or 4 cards.
 */
export type MeldType = 'sequence' | 'set';

export interface Meld {
  readonly id: string;
  readonly type: MeldType;
  readonly cards: readonly Card[];
  /** Cached sum of card values.  Recomputed whenever the meld changes. */
  readonly totalValue: number;
}

// ─── Game / Round lifecycle enumerations ────────────────────────────────────

/** Top-level lifecycle of a game session. */
export type GameStatus = 'lobby' | 'in-progress' | 'finished';

/**
 * Phase of a single round.
 *
 *   dealing → in-progress → scoring → finished
 */
export type RoundPhase =
  | 'dealing'       // cards are being distributed, gameplay not yet started
  | 'in-progress'   // active gameplay
  | 'scoring'       // round ended, tallying scores
  | 'finished';     // scores recorded; waiting to start next round

/**
 * Sub-phase within a single player's turn.
 *
 *   awaiting-draw-or-take
 *         │  player draws from deck OR takes from discard pile
 *         ▼
 *       holding
 *         │  player may go-down / add to melds, then must discard
 *         ▼
 *      complete
 *         │  turn is over; next player's turn begins
 */
export type TurnPhase =
  | 'awaiting-draw-or-take'
  | 'holding'
  | 'complete';

/** Why a round ended. */
export type RoundEndReason =
  | 'player-finished'  // a player emptied their hand
  | 'deck-exhausted';  // the hidden draw pile ran out
