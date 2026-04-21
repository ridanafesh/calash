/**
 * Pure helpers for arranging the player's hand on the client.
 *
 * These functions never mutate the source array and never affect game state —
 * the server is authoritative. They only change the visual order of cards
 * shown to the player.
 *
 * Tie-breakers everywhere use the stable card key (rank-suit-deckIndex or
 * joker-jokerIndex) so equal cards from the two decks land in a deterministic
 * order across renders.
 */

import type { Card, Suit } from '@calash/shared';
import { RANK_ORDER } from '@calash/shared';

export type HandSortMode = 'original' | 'rank' | 'suit' | 'melds';

const SUIT_ORDER: Record<Suit, number> = {
  spades: 0,
  hearts: 1,
  clubs: 2,
  diamonds: 3,
};

/** A stable identity key for any card — same string for the same physical card. */
export function cardKey(c: Card): string {
  if (c.isJoker) return `J:${c.jokerIndex}`;
  return `${c.rank}:${c.suit}:${c.deckIndex}`;
}

/** Numeric rank for sorting; jokers sort last by default. */
function rankValue(c: Card): number {
  if (c.isJoker) return 100; // sentinel — placed at end of rank-sort
  return RANK_ORDER[c.rank] ?? 0;
}

/** Numeric suit value for sorting; jokers go last. */
function suitValue(c: Card): number {
  if (c.isJoker) return 99;
  return SUIT_ORDER[c.suit];
}

// ─── Sort modes ──────────────────────────────────────────────────────────────

/** Ascending rank, with suit as tie-break. Jokers go to the end. */
export function sortByRank(hand: readonly Card[]): Card[] {
  return [...hand].sort((a, b) => {
    const rd = rankValue(a) - rankValue(b);
    if (rd !== 0) return rd;
    const sd = suitValue(a) - suitValue(b);
    if (sd !== 0) return sd;
    return cardKey(a).localeCompare(cardKey(b));
  });
}

/** Group by suit (♠ ♥ ♣ ♦), ascending rank within each suit. Jokers go to the end. */
export function sortBySuit(hand: readonly Card[]): Card[] {
  return [...hand].sort((a, b) => {
    const sd = suitValue(a) - suitValue(b);
    if (sd !== 0) return sd;
    const rd = rankValue(a) - rankValue(b);
    if (rd !== 0) return rd;
    return cardKey(a).localeCompare(cardKey(b));
  });
}

/**
 * Group cards into "likely melds" — clusters that the player can readily
 * combine into a sequence or set.
 *
 * Algorithm (deliberately simple, hand-readable order, not optimal):
 *   1. Bucket non-joker cards by suit, sort each bucket by rank.
 *   2. Within each suit bucket, walk from lowest rank up: cards whose rank is
 *      ≤ 2 away from the previous card start a "sequence cluster". Any rank
 *      that breaks the run starts a new cluster.
 *   3. Then sweep across all suits and find rank values that appear in 3+
 *      different suits — those become a "set cluster" and are pulled to the
 *      front (a set is usually higher value than a 3-card sequence).
 *   4. Jokers go at the front (always useful).
 *   5. Anything left over is appended in rank order.
 *
 * Cards within a cluster appear contiguously, separated visually by a small
 * gap from neighboring clusters (the hand-area CSS handles the gap).
 */
export function groupByLikelyMelds(hand: readonly Card[]): Card[] {
  if (hand.length === 0) return [];

  const used = new Set<string>();
  const out: Card[] = [];

  // 1. Jokers first.
  for (const c of hand) {
    if (c.isJoker && !used.has(cardKey(c))) {
      out.push(c);
      used.add(cardKey(c));
    }
  }

  // 2. Set clusters: pick ranks present in ≥ 3 different suits.
  const byRank = new Map<string, Card[]>();
  for (const c of hand) {
    if (c.isJoker || used.has(cardKey(c))) continue;
    const list = byRank.get(c.rank) ?? [];
    list.push(c);
    byRank.set(c.rank, list);
  }
  // Order set clusters by rank value desc so highest-value sets appear first.
  const setRanks = [...byRank.entries()]
    .filter(([, cards]) => new Set(cards.map((c) => (c.isJoker ? 'j' : c.suit))).size >= 3)
    .sort(([rA], [rB]) => (RANK_ORDER[rB as keyof typeof RANK_ORDER] ?? 0) - (RANK_ORDER[rA as keyof typeof RANK_ORDER] ?? 0));
  for (const [, cards] of setRanks) {
    const sorted = [...cards].sort((a, b) => suitValue(a) - suitValue(b));
    for (const c of sorted) {
      out.push(c);
      used.add(cardKey(c));
    }
  }

  // 3. Sequence clusters per suit.
  const bySuit = new Map<Suit, Card[]>();
  for (const c of hand) {
    if (c.isJoker || used.has(cardKey(c))) continue;
    const list = bySuit.get(c.suit) ?? [];
    list.push(c);
    bySuit.set(c.suit, list);
  }

  // Process suits in a stable, readable order.
  const suitOrder: Suit[] = ['spades', 'hearts', 'clubs', 'diamonds'];
  for (const suit of suitOrder) {
    const cards = bySuit.get(suit);
    if (!cards) continue;
    cards.sort((a, b) => rankValue(a) - rankValue(b));

    // Walk and emit. Cards within ≤ 2 ranks of the previous form a cluster
    // visually; we still emit them in order, but a card that's > 2 away
    // simply continues the same suit row (that's fine — the player can read
    // the whole suit easily anyway).
    for (const c of cards) {
      if (used.has(cardKey(c))) continue;
      out.push(c);
      used.add(cardKey(c));
    }
  }

  // 4. Whatever's left (shouldn't happen given the buckets above), append.
  for (const c of hand) {
    if (!used.has(cardKey(c))) {
      out.push(c);
      used.add(cardKey(c));
    }
  }

  return out;
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

/**
 * Apply the chosen sort mode to a hand. 'original' returns the hand untouched
 * (caller is responsible for preserving the original order if they want it).
 */
export function applySortMode(hand: readonly Card[], mode: HandSortMode): Card[] {
  switch (mode) {
    case 'rank': return sortByRank(hand);
    case 'suit': return sortBySuit(hand);
    case 'melds': return groupByLikelyMelds(hand);
    case 'original':
    default:
      return [...hand];
  }
}
