import type {
  Card,
  JokerAssignment,
  JokerCard,
  MeldType,
  Rank,
  RegularCard,
  Suit,
} from '@calash/shared';
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

// ─── Joker assignment ────────────────────────────────────────────────────────

/**
 * Inverse of RANK_ORDER for sequences: ordered list of (rankValue, rank) so we
 * can map a rank position back to its rank label.  For sequences, the "Ace as
 * 1" position maps to rank 'A'; the "Ace as 14" position also maps to 'A'.
 */
const RANK_BY_VALUE: ReadonlyMap<number, Rank> = (() => {
  const m = new Map<number, Rank>();
  for (const [rank, value] of Object.entries(RANK_ORDER)) {
    if (m.has(value)) continue;
    m.set(value, rank as Rank);
  }
  // Ensure both Ace positions map back to 'A'.
  m.set(ACE_LOW, 'A');
  m.set(ACE_HIGH, 'A');
  return m;
})();

const ALL_SUITS: readonly Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];

/**
 * Compute every legal rank+suit a joker could represent in the given meld.
 *
 * For SEQUENCES with one joker:
 *   - The non-joker cards already fix the suit (they must all be the same).
 *   - For each Ace assignment that yields a valid run, the joker fills either
 *     an interior gap (uniquely determined) or extends one of the two edges
 *     (creating up to 2 candidates per assignment). We return the union of
 *     all such candidates across assignments, deduplicated by rank.
 *
 * For SETS with one joker:
 *   - The rank is fixed (all non-jokers share it).
 *   - The joker can stand for any suit not already present; usually 1 suit
 *     candidate (3-card set), occasionally more if the set is structurally
 *     incomplete.
 *
 * Returns an empty array when:
 *   - the meld contains no joker, or
 *   - the meld is structurally invalid (no legal assignment exists).
 *
 * The caller (validateMeld) handles the empty case as "invalid"; the engine
 * uses this to auto-resolve unambiguous melds and to drive UI ambiguity prompts.
 */
export function computeJokerCandidates(
  type: MeldType,
  cards: readonly Card[],
): JokerAssignment[] {
  const joker = cards.find((c): c is JokerCard => c.isJoker);
  if (!joker) return [];

  const regulars = cards.filter((c): c is RegularCard => !c.isJoker);

  if (type === 'sequence') {
    // All non-joker cards must share a suit; bail out if not (validator
    // will reject this meld anyway).
    const suits = new Set(regulars.map((c) => c.suit));
    if (suits.size > 1) return [];
    if (regulars.length === 0) return []; // joker-only — caller rejects on length

    const suit: Suit = regulars[0].suit;
    const aces = regulars.filter((c) => c.rank === 'A');
    const others = regulars.filter((c) => c.rank !== 'A');
    const otherRanks = others.map((c) => RANK_ORDER[c.rank] ?? 0);

    let aceAssignments: number[][];
    if (aces.length === 0) aceAssignments = [[]];
    else if (aces.length === 1) aceAssignments = [[ACE_LOW], [ACE_HIGH]];
    else if (aces.length === 2) aceAssignments = [[ACE_LOW, ACE_HIGH]];
    else return [];

    const positions = new Set<number>();
    for (const aceValues of aceAssignments) {
      const known = [...otherRanks, ...aceValues].sort((a, b) => a - b);
      // Find the joker position(s) that would complete the run.
      addJokerPositions(known, positions);
    }

    return [...positions]
      .map((rankValue) => {
        const rank = RANK_BY_VALUE.get(rankValue);
        if (!rank) return null;
        return { jokerIndex: joker.jokerIndex, representsRank: rank, representsSuit: suit };
      })
      .filter((a): a is JokerAssignment => a !== null);
  }

  // SET: rank is fixed; joker must take any missing suit.
  const ranks = new Set(regulars.map((c) => c.rank));
  if (ranks.size > 1) return [];
  if (regulars.length === 0) return [];

  const rank = regulars[0].rank;
  const usedSuits = new Set(regulars.map((c) => c.suit));
  const candidates: JokerAssignment[] = [];
  for (const s of ALL_SUITS) {
    if (!usedSuits.has(s)) {
      candidates.push({ jokerIndex: joker.jokerIndex, representsRank: rank, representsSuit: s });
    }
  }
  return candidates;
}

/**
 * Given the sorted list of known rank values in a same-suit sequence and a
 * single joker to place, add every legal rank position the joker could fill
 * into the `out` set.  Duplicates and out-of-range positions are skipped.
 *
 *   [10, Q]    → joker may be 11 (J) — the only position that fills the gap
 *   [10, J]    → joker may be 9 OR Q — two edge candidates
 *   [Q, K]     → joker may be J OR A (high) if length allows
 *   [J, Q, K]  → joker may be 10 OR A (high)
 */
function addJokerPositions(sortedKnown: number[], out: Set<number>): void {
  if (sortedKnown.length === 0) return;
  for (let i = 1; i < sortedKnown.length; i++) {
    if (sortedKnown[i] === sortedKnown[i - 1]) return; // duplicate ranks invalid
  }

  const min = sortedKnown[0];
  const max = sortedKnown[sortedKnown.length - 1];

  // Count interior gaps (slots strictly between known positions).
  let gaps = 0;
  let gapPos = -1;
  for (let i = 1; i < sortedKnown.length; i++) {
    const diff = sortedKnown[i] - sortedKnown[i - 1] - 1;
    gaps += diff;
    if (diff === 1) gapPos = sortedKnown[i] - 1;
    else if (diff > 1) gaps = 99; // > 1 joker required → invalid
  }

  if (gaps === 1 && gapPos !== -1) {
    out.add(gapPos);
    return;
  }
  if (gaps !== 0) return; // invalid for a single joker

  // No interior gap — joker extends an edge. Total length is known.length + 1
  // and must be ≥ MIN_SEQUENCE_LENGTH (already implied if the run is being
  // proposed). Edge positions are min-1 and max+1, each within [ACE_LOW, ACE_HIGH].
  if (min - 1 >= ACE_LOW) out.add(min - 1);
  if (max + 1 <= ACE_HIGH) out.add(max + 1);
}

/**
 * Resolve the joker assignment for a meld at construction time.
 *
 * Returns:
 *   - { ok: true, assignment: undefined }  — meld has no joker; nothing to pin
 *   - { ok: true, assignment: ... }        — exactly one candidate, or the
 *                                            client provided an explicit choice
 *                                            that matches a candidate
 *   - { ok: false, ambiguous: true,
 *        candidates: [...] }               — multiple candidates and no choice
 *                                            supplied (UI must prompt)
 *   - { ok: false, ambiguous: false,
 *        reason: '...' }                   — invalid choice or no candidates
 */
export type ResolveJokerResult =
  | { ok: true; assignment: JokerAssignment | undefined }
  | { ok: false; ambiguous: true; candidates: JokerAssignment[] }
  | { ok: false; ambiguous: false; reason: string };

export function resolveJokerAssignment(
  type: MeldType,
  cards: readonly Card[],
  provided: JokerAssignment | undefined,
): ResolveJokerResult {
  const hasJoker = cards.some((c) => c.isJoker);
  if (!hasJoker) {
    if (provided) {
      return {
        ok: false,
        ambiguous: false,
        reason: 'Joker assignment supplied for a meld containing no joker',
      };
    }
    return { ok: true, assignment: undefined };
  }

  const candidates = computeJokerCandidates(type, cards);
  if (candidates.length === 0) {
    return {
      ok: false,
      ambiguous: false,
      reason: 'Joker has no legal position in this meld',
    };
  }

  if (provided) {
    const match = candidates.find(
      (c) =>
        c.jokerIndex === provided.jokerIndex &&
        c.representsRank === provided.representsRank &&
        c.representsSuit === provided.representsSuit,
    );
    if (!match) {
      return {
        ok: false,
        ambiguous: false,
        reason: `Joker assignment ${provided.representsRank} of ${provided.representsSuit} is not legal for this meld`,
      };
    }
    return { ok: true, assignment: match };
  }

  if (candidates.length === 1) {
    return { ok: true, assignment: candidates[0] };
  }

  return { ok: false, ambiguous: true, candidates };
}
