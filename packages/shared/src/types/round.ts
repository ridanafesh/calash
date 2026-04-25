import type { Card, Meld, RoundPhase, TurnPhase, RoundEndReason } from './game.js';

// ─── Per-player state within a round ────────────────────────────────────────

export interface PlayerRoundState {
  readonly playerId: string;

  /** Cards currently in this player's hand. */
  hand: Card[];

  /**
   * Melds this player has placed on the table.
   * Once a meld is placed it is visible to all players.
   */
  melds: Meld[];

  /**
   * Whether this player has gone down (opened) this round.
   * Until this is true the player cannot add to any meld on the table.
   */
  hasGoneDown: boolean;

  /**
   * Cached sum of the totalValue of all melds on the table.
   * Updated whenever the player adds a meld or extends an existing one.
   * Used to compute the go-down threshold for players still unopened.
   */
  tableTotal: number;
}

// ─── Full round state (authoritative, server-side) ───────────────────────────

export interface RoundState {
  readonly roundNumber: number;

  /** The player who dealt this round's cards. */
  readonly dealerPlayerId: string;

  /**
   * Counterclockwise turn order for this round.
   * playerOrder[0] is the player to the right of the dealer (first to act).
   */
  readonly playerOrder: readonly string[];

  /** ID of the player whose turn it currently is. */
  currentTurnPlayerId: string;

  phase: RoundPhase;
  turnPhase: TurnPhase;

  /** Full state for every player keyed by playerId. */
  playerStates: Record<string, PlayerRoundState>;

  /** The face-down draw pile.  Clients only ever receive `hiddenDeckCount`. */
  hiddenDeck: Card[];

  /** The face-up discard pile.  Index 0 is the oldest / bottom card. */
  discardPile: Card[];

  /**
   * The highest tableTotal currently held by any player who has gone down.
   *
   * This is the reference value for computing the go-down threshold for
   * players who still haven't opened.  It is updated whenever a player
   * who is already down places more cards and raises their tableTotal.
   */
  highestTableTotal: number;

  /**
   * True while the current player has taken cards from the discard pile
   * but has not yet discarded to end their turn.
   *
   * A player may NOT go down on the same turn they take from the discard pile.
   * This flag is reset to false at the start of each new turn.
   */
  didTakeFromDiscardThisTurn: boolean;

  endReason?: RoundEndReason;

  /** Set when the round ends because a player emptied their hand. */
  finisherPlayerId?: string;

  /**
   * The card the current player just drew from the hidden deck and has not
   * yet decided to keep or discard. Set when turnPhase === 'pending-drawn-
   * decision'; null otherwise. The card is NOT in any player's hand while
   * pending — it lives only in this field. Visible to all clients via
   * RoundStateView so opponents can see "Player X drew (and is deciding)".
   */
  pendingDrawnCard?: Card;
}

// ─── Client-safe view (no hidden deck contents) ──────────────────────────────

/**
 * The projection of RoundState that is safe to broadcast to all clients.
 * Each client additionally receives their own hand privately.
 */
export interface RoundStateView {
  readonly roundNumber: number;
  readonly dealerPlayerId: string;
  readonly playerOrder: readonly string[];
  currentTurnPlayerId: string;
  phase: RoundPhase;
  turnPhase: TurnPhase;

  /** Each player's melds, tableTotal, and hasGoneDown status — but NOT their hand. */
  playerStates: Record<string, Omit<PlayerRoundState, 'hand'>>;

  /** Number of cards remaining in the hidden draw pile. */
  hiddenDeckCount: number;

  discardPile: Card[];
  highestTableTotal: number;
  endReason?: RoundEndReason;
  finisherPlayerId?: string;
  /**
   * True iff the current player has drawn from the deck and not yet
   * resolved the Keep/Discard decision. Lets opponents render a
   * "{name} is deciding…" hint without leaking the card's identity.
   *
   * The actual drawn card is private and is delivered to the owner via
   * the dedicated `game:drawn-card` event — never via this broadcast view.
   */
  pendingDrawnCardPresent?: boolean;
}

// ─── Round result (for scoring) ──────────────────────────────────────────────

export interface PlayerRoundScore {
  playerId: string;
  tableTotal: number;
  handTotal: number;
  /** tableTotal - handTotal */
  roundScore: number;
  /** true if this player emptied their hand first */
  finishedFirst: boolean;
  /** roundScore + FINISH_BONUS (if finishedFirst) */
  finalScore: number;
}

export interface RoundResult {
  roundNumber: number;
  endReason: RoundEndReason;
  finisherPlayerId: string | null;
  playerScores: PlayerRoundScore[];
  /** UserId of the player who will deal the next round. */
  nextDealerId?: string;
}

// ─── Game-level score tracking ───────────────────────────────────────────────

export interface GameScore {
  playerId: string;
  /** Cumulative score across all completed rounds. */
  total: number;
  /** Per-round breakdown. */
  rounds: number[];
}
