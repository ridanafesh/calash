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

/**
 * Pins which real card a joker stands in for inside a specific meld.
 *
 * Stored on Meld so that:
 *   - sequence joker replacement can be validated against the exact rank+suit
 *     the joker represents (player must hold THAT card to swap it back),
 *   - set joker reclaim can confirm the missing suit it filled is now present
 *     (and that the natural 4-of-a-kind is complete before the swap),
 *   - the UI can render `Joker → J♥` or `Joker → 9♠` so other players
 *     understand what role the joker is currently playing.
 *
 * For sets, `representsRank` always equals the meld's set rank (kept
 * explicit for symmetry with sequences and to avoid ambiguity).
 */
export interface JokerAssignment {
  /** Which physical joker (matches JokerCard.jokerIndex). */
  readonly jokerIndex: 0 | 1;
  /** The rank the joker currently represents in this meld. */
  readonly representsRank: Rank;
  /** The suit the joker currently represents in this meld. */
  readonly representsSuit: Suit;
}

export interface Meld {
  readonly id: string;
  readonly type: MeldType;
  readonly cards: readonly Card[];
  /** Cached sum of card values.  Recomputed whenever the meld changes. */
  readonly totalValue: number;
  /**
   * Present iff the meld currently contains a joker. Records what real card
   * the joker is standing in for so the engine can validate replacements
   * (sequence) and reclaim conditions (set), and so the UI can label it.
   */
  readonly jokerAssignment?: JokerAssignment;
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
  | 'pending-drawn-decision' // drew from deck, waiting on keep-vs-discard
  | 'holding'
  | 'complete';

/** Why a round ended. */
export type RoundEndReason =
  | 'player-finished'  // a player emptied their hand
  | 'deck-exhausted';  // the hidden draw pile ran out

/** Difficulty levels for bot players. Architecture is open to additional levels. */
export type BotDifficulty = 'easy';

/** A player slot within a room lobby or active game. */
export interface RoomPlayer {
  userId: string;
  displayName: string;
  isReady: boolean;
  isConnected: boolean;
  /** True for bot players. Bots are always considered ready and connected. */
  isBot: boolean;
  /** Set when isBot is true. Indicates which strategy the bot uses. */
  botDifficulty?: BotDifficulty;
}

/** Client-visible representation of a game room. */
export interface GameRoom {
  id: string;
  code: string;
  hostUserId: string;
  status: GameStatus;
  maxPlayers: number;
  players: RoomPlayer[];
  currentRound: number;
}
