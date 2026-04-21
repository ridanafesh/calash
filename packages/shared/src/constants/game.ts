/**
 * Calash game constants shared between server (game-core) and clients.
 *
 * Keeping these in @calash/shared means clients can render card values,
 * display go-down thresholds, and validate basic rules locally without
 * duplicating magic numbers.
 */

/**
 * Point value for each card rank.
 *
 * Design decision: Ace and Joker are both 25.  Face cards (10/J/Q/K) are 10.
 * Number cards are face-value.  These values apply to both positive (on-table)
 * and negative (in-hand) scoring equally.
 */
export const CARD_VALUES: Readonly<Record<string, number>> = {
  JOKER: 25,
  A: 25,
  K: 10,
  Q: 10,
  J: 10,
  '10': 10,
  '9': 9,
  '8': 8,
  '7': 7,
  '6': 6,
  '5': 5,
  '4': 4,
  '3': 3,
  '2': 2,
};

/**
 * Numeric position for each rank used in sequence validation.
 *
 * Ace is intentionally absent: it is dual-value (1 or 14) and must be
 * evaluated contextually by the meld validator.  Joker is also absent
 * because it is a wildcard with no fixed position.
 */
export const RANK_ORDER: Readonly<Record<string, number>> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13,
  // A → not included; handled as ACE_LOW = 1 / ACE_HIGH = 14
};

export const ACE_LOW = 1;
export const ACE_HIGH = 14;

/** Core game configuration values. */
export const GAME_CONFIG = {
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 4,

  /** Standard hand size for all players except the first. */
  CARDS_PER_PLAYER: 14,

  /**
   * The player immediately to the dealer's right receives one extra card
   * and takes the first turn of the round.
   */
  FIRST_PLAYER_CARDS: 15,

  DECK_COUNT: 2,
  JOKER_COUNT: 2,
  /** 2 × 52 + 2 jokers */
  TOTAL_CARDS: 106,

  /**
   * The very first player to go down in a round must open with melds
   * totaling at least this many points.
   */
  INITIAL_GO_DOWN_MINIMUM: 75,

  /**
   * Every subsequent unopened player must open with at least this many
   * points MORE than the current highest exposed table total.
   *
   * This threshold is re-evaluated dynamically: if a player who is already
   * down adds cards and raises the highest table total, the requirement
   * increases for players who still haven't opened.
   */
  GO_DOWN_INCREMENT: 5,

  /** Bonus awarded to the player who empties their hand first in a round. */
  FINISH_BONUS: 20,

  /** Cumulative score a player must reach (or exceed) to win the game. */
  WIN_SCORE: 1000,
} as const;

/** Structural constraints on melds. */
export const MELD_CONFIG = {
  MIN_SEQUENCE_LENGTH: 3,
  MIN_SET_SIZE: 3,
  MAX_SET_SIZE: 4,

  /**
   * At most one joker is allowed per meld.
   * This prevents constructs like Joker-8-Joker.
   */
  MAX_JOKERS_PER_MELD: 1,
} as const;

/**
 * Minimum number of cards that must remain on the discard pile after a
 * player takes from it.  Always 1 — the bottom card is never taken
 * (except via the special 4-card rule where the player immediately
 * returns a card from hand).
 */
export const DISCARD_PILE_MIN_REMAINING = 1;

/**
 * When the discard pile has exactly this many cards, the player has an
 * additional option: take all cards and immediately return 1 from hand.
 * They may NOT take fewer than pile_size − 1 in this case.
 */
export const DISCARD_PILE_TAKE_ALL_THRESHOLD = 4;
