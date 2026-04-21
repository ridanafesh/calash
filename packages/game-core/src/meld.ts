import type { Card, MeldType, RegularCard } from '@calash/shared';
import { RANK_ORDER, ACE_LOW, ACE_HIGH, MELD_CONFIG, CARD_VALUES } from '@calash/shared';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function countJokers(cards: readonly Card[]): number {
  return cards.filter((c) => c.isJoker).length;
}

function nonJokers(cards: readonly Card[]): RegularCard[] {
  return cards.filter((c): c is RegularCard => !c.isJoker);
}

// ─── Sequence validation ──────────────────────────────────────────────────────

/**
 * Validate a sequence meld.
 *
 * Rules:
 *   - ≥ 3 cards total (including jokers).
 *   - No upper cap below the natural max of 14 (A,2,...,K,A — both Aces of
 *     the same suit forming a single full-suit run).
 *   - All non-joker cards must share the same suit.
 *   - At most 1 joker.
 *   - Cards form a consecutive rank run with no gaps beyond what jokers fill.
 *   - Ace may be used low (rank 1, as in A-2-3) or high (rank 14, as in Q-K-A).
 *   - With two Aces of the same suit, BOTH may appear in the same sequence:
 *     one as low at the start and one as high at the end (A,2,...,K,A).
 *     Otherwise two Aces in the same sequence is illegal.
 *   - Circular wraps (K-A-2) are NOT allowed — a single Ace cannot be both
 *     1 and 14 within a single meld.
 *
 * Implementation:
 *   Enumerate the legal Ace-value assignments and accept if any assignment
 *   yields a valid consecutive run with no duplicate ranks.
 *     - 0 Aces: one interpretation (no Ace value to assign).
 *     - 1 Ace:  two interpretations — Ace=1 OR Ace=14.
 *     - 2 Aces: ONE interpretation — Ace=1 AND Ace=14 (both used).
 *               Two Aces both played as low (or both as high) is impossible
 *               because that would put two cards at the same rank position.
 *     - 3+ Aces: impossible in a single same-suit sequence (the deck only
 *               has 2 of each suit), so reject up front.
 */
function validateSequence(cards: readonly Card[]): ValidationResult {
  if (cards.length < MELD_CONFIG.MIN_SEQUENCE_LENGTH) {
    return invalid(`Sequence requires at least ${MELD_CONFIG.MIN_SEQUENCE_LENGTH} cards`);
  }

  const jokerCount = countJokers(cards);
  if (jokerCount > MELD_CONFIG.MAX_JOKERS_PER_MELD) {
    return invalid('A meld may contain at most 1 joker');
  }

  const regulars = nonJokers(cards);

  // All non-joker cards must share the same suit
  const suits = new Set(regulars.map((c) => c.suit));
  if (suits.size > 1) {
    return invalid('All cards in a sequence must be the same suit');
  }

  const aces = regulars.filter((c) => c.rank === 'A');
  const others = regulars.filter((c) => c.rank !== 'A');
  const otherRanks = others.map((c) => RANK_ORDER[c.rank] ?? 0).sort((a, b) => a - b);

  // Enumerate the rank-value lists implied by each legal Ace assignment.
  // Each entry is the full sorted list of ranks the sequence must cover.
  let aceAssignments: number[][];
  if (aces.length === 0) {
    aceAssignments = [[]];
  } else if (aces.length === 1) {
    aceAssignments = [[ACE_LOW], [ACE_HIGH]];
  } else if (aces.length === 2) {
    aceAssignments = [[ACE_LOW, ACE_HIGH]];
  } else {
    // 3+ Aces of the same suit can't exist in a 2-deck game; even if it
    // somehow arose, no consecutive run can place 3 Aces.
    return invalid('A sequence may contain at most 2 Aces (one low, one high)');
  }

  for (const aceValues of aceAssignments) {
    const allRanks = [...otherRanks, ...aceValues].sort((a, b) => a - b);
    if (isConsecutiveWithWildcards(allRanks, jokerCount)) {
      return { valid: true };
    }
  }

  return invalid('Cards do not form a valid consecutive sequence');
}

/**
 * Determine whether a sorted list of known rank values can form a consecutive
 * run when `wildcardCount` jokers are available to fill gaps or extend edges.
 *
 * The algorithm:
 *   1. Count the total interior gaps between adjacent known ranks.
 *      (A difference of 2 between adjacent ranks means 1 gap to fill.)
 *   2. Duplicate ranks are never allowed in a sequence (even from 2 decks).
 *   3. The total run length (known cards + wildcards) must span exactly
 *      `span` consecutive positions, where span = max − min + 1.
 *      This ensures jokers cannot "extend" beyond what the known cards imply.
 */
function isConsecutiveWithWildcards(sortedRanks: number[], wildcards: number): boolean {
  if (sortedRanks.length === 0) {
    // All jokers — a joker-only meld is structurally incomplete but would
    // pass here; the length check in validateSequence prevents this.
    return wildcards >= MELD_CONFIG.MIN_SEQUENCE_LENGTH;
  }

  // Duplicate ranks mean two cards with the same rank AND same suit from
  // different decks, which cannot form a valid sequence position.
  for (let i = 1; i < sortedRanks.length; i++) {
    if (sortedRanks[i] === sortedRanks[i - 1]) return false;
  }

  const min = sortedRanks[0];
  const max = sortedRanks[sortedRanks.length - 1];
  const span = max - min + 1; // total positions the run must cover

  // Total slots = known cards + wildcards available; must exactly cover span
  const totalSlots = sortedRanks.length + wildcards;
  if (totalSlots < span) return false; // not enough cards to fill the run
  if (totalSlots < MELD_CONFIG.MIN_SEQUENCE_LENGTH) return false;

  // Count gaps that jokers must fill
  let gapsNeeded = 0;
  for (let i = 1; i < sortedRanks.length; i++) {
    gapsNeeded += sortedRanks[i] - sortedRanks[i - 1] - 1;
  }

  // Jokers fill interior gaps first; any remainder extends an edge position.
  // e.g. 7-8-Joker is valid as 6-7-8 or 7-8-9 (joker extends an edge).
  return gapsNeeded <= wildcards;
}

// ─── Set validation ───────────────────────────────────────────────────────────

/**
 * Validate a set meld (3–4 of a kind, different suits).
 *
 * Rules:
 *   - 3 or 4 cards total (including at most 1 joker).
 *   - All non-joker cards must have the same rank.
 *   - All non-joker cards must have different suits.
 *   - The joker (if present) represents the missing suit.
 */
function validateSet(cards: readonly Card[]): ValidationResult {
  if (cards.length < MELD_CONFIG.MIN_SET_SIZE) {
    return invalid(`Set requires at least ${MELD_CONFIG.MIN_SET_SIZE} cards`);
  }
  if (cards.length > MELD_CONFIG.MAX_SET_SIZE) {
    return invalid(`Set may have at most ${MELD_CONFIG.MAX_SET_SIZE} cards`);
  }

  const jokerCount = countJokers(cards);
  if (jokerCount > MELD_CONFIG.MAX_JOKERS_PER_MELD) {
    return invalid('A meld may contain at most 1 joker');
  }

  const regulars = nonJokers(cards);

  const ranks = new Set(regulars.map((c) => c.rank));
  if (ranks.size > 1) {
    return invalid('All cards in a set must have the same rank');
  }

  // Each suit may appear at most once in a set
  const suits = regulars.map((c) => c.suit);
  if (new Set(suits).size !== suits.length) {
    return invalid('All cards in a set must have different suits (no duplicate suits)');
  }

  return { valid: true };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
}

function invalid(reason: string): ValidationResult {
  return { valid: false, reason };
}

/**
 * Validate a meld of the given type.
 *
 * This is a pure function — it has no side effects and makes no network calls.
 * The server calls this before accepting any go-down, add-to-meld, or
 * add-new-meld action.
 */
export function validateMeld(type: MeldType, cards: readonly Card[]): ValidationResult {
  if (type === 'sequence') return validateSequence(cards);
  return validateSet(cards);
}

/**
 * Return true if a set of cards can extend an existing meld (remain valid
 * after the new cards are appended).
 */
export function validateMeldExtension(
  meldType: MeldType,
  existingCards: readonly Card[],
  newCards: readonly Card[],
): ValidationResult {
  return validateMeld(meldType, [...existingCards, ...newCards]);
}

// ─── Card value helpers ───────────────────────────────────────────────────────

/** Point value of a single card. */
export function cardValue(card: Card): number {
  if (card.isJoker) return CARD_VALUES['JOKER'];
  return CARD_VALUES[card.rank] ?? 0;
}

/** Total point value of a collection of cards. */
export function totalCardValue(cards: readonly Card[]): number {
  return cards.reduce((sum, c) => sum + cardValue(c), 0);
}

/** Total point value of a collection of melds. */
export function totalMeldValue(melds: ReadonlyArray<{ cards: readonly Card[] }>): number {
  return melds.reduce((sum, m) => sum + totalCardValue(m.cards), 0);
}
