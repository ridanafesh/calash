/**
 * Pure helpers for the meld builder UI.
 *
 *   detectLikelyMeldType — given a hand selection, what meld(s) could it form?
 *   sortForMeldPreview   — return a copy of the cards sorted in the order
 *                          they would naturally read as a meld of the chosen
 *                          type (sets: by suit; sequences: ascending rank,
 *                          treating Ace high or low to match the run).
 *
 * These are CLIENT-only helpers. The server's validateMeld is the source of
 * truth for legality — these helpers only drive the UI's button enablement
 * and visual ordering. We re-derive every render to stay in sync with the
 * authoritative engine.
 */

import type { Card, MeldType, RegularCard, Suit } from '@calash/shared';
import { RANK_ORDER } from '@calash/shared';
import { validateMeld, validateMeldExtension } from '@calash/game-core';

export interface MeldFitness {
  /** True if these cards form a valid set as-is (order doesn't matter for sets). */
  isValidSet: boolean;
  /** True if these cards form a valid sequence (validateMeld is order-agnostic). */
  isValidSequence: boolean;
  /**
   * The most plausible meld type for the current selection, or null if
   * neither validator accepts the cards as-is.
   */
  bestType: MeldType | null;
}

/**
 * Given a selection of hand cards and a list of melds visible on the table,
 * return the IDs of melds that the selection can legally extend.
 *
 * Pure — does not check turn-phase or didTakeFromDiscard restrictions; the
 * caller is responsible for enabling the UI only when those conditions hold.
 * This matches what the server's validateAddToMeld does for the meld-shape
 * portion of the check, so the UI can pre-enable the right targets.
 */
export function findExtendableMelds(
  selection: readonly Card[],
  tableMelds: ReadonlyArray<{ id: string; type: MeldType; cards: readonly Card[] }>,
): string[] {
  if (selection.length === 0) return [];
  const out: string[] = [];
  for (const meld of tableMelds) {
    const r = validateMeldExtension(meld.type, meld.cards, selection);
    if (r.valid) out.push(meld.id);
  }
  return out;
}

/**
 * Try the cards as both a set and a sequence and report which the validator
 * accepts. Picks 'sequence' when both happen to be valid (rare — only
 * possible with jokers + 3 cards).
 */
export function detectMeldFitness(cards: readonly Card[]): MeldFitness {
  if (cards.length < 3) {
    return { isValidSet: false, isValidSequence: false, bestType: null };
  }
  const isValidSet = validateMeld('set', cards).valid;
  const isValidSequence = validateMeld('sequence', cards).valid;
  const bestType: MeldType | null = isValidSequence
    ? 'sequence'
    : isValidSet
      ? 'set'
      : null;
  return { isValidSet, isValidSequence, bestType };
}

// ─── Preview ordering ────────────────────────────────────────────────────────

const SUIT_ORDER: Record<Suit, number> = {
  spades: 0,
  hearts: 1,
  clubs: 2,
  diamonds: 3,
};

/**
 * Return a new array of the cards in the order they should be displayed in
 * a meld preview. The user may click them in any order; we want the visual
 * tray to read top-to-bottom / left-to-right as the meld actually plays.
 *
 *   - Sets: by suit order (♠ ♥ ♣ ♦), jokers last.
 *   - Sequences: by rank ascending. If any Ace is present, decide whether to
 *     place it high or low based on which produces consecutive ranks. With
 *     two Aces, place one at each end.
 */
export function sortForMeldPreview(cards: readonly Card[], type: MeldType): Card[] {
  if (type === 'set') {
    return [...cards].sort((a, b) => {
      if (a.isJoker && !b.isJoker) return 1;
      if (!a.isJoker && b.isJoker) return -1;
      if (a.isJoker || b.isJoker) return 0;
      return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
    });
  }
  // sequence
  const jokers = cards.filter((c) => c.isJoker);
  const regulars = cards.filter((c): c is RegularCard => !c.isJoker);
  const aces = regulars.filter((c) => c.rank === 'A');
  const others = regulars.filter((c) => c.rank !== 'A');
  others.sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank]);

  // No Aces: just rank-asc, jokers tucked at the end (caller can re-place if needed).
  if (aces.length === 0) {
    return [...others, ...jokers];
  }

  // Decide Ace placement(s).
  const minRank = others.length > 0 ? RANK_ORDER[others[0].rank] : null;
  const maxRank = others.length > 0 ? RANK_ORDER[others[others.length - 1].rank] : null;

  // 2 Aces → one low + one high (full-suit run case).
  if (aces.length === 2) {
    return [aces[0], ...others, aces[1], ...jokers];
  }

  // 1 Ace.
  // Heuristic: if the others span the high end (max ≥ Q=12), put Ace high.
  // Otherwise, if min is 2, put Ace low. Otherwise default to low.
  if (maxRank !== null && maxRank >= 12) {
    return [...others, aces[0], ...jokers];
  }
  if (minRank === 2 || minRank === null) {
    return [aces[0], ...others, ...jokers];
  }
  // Ambiguous — default to low.
  return [aces[0], ...others, ...jokers];
}
