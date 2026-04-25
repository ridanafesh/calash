/**
 * Easy bot strategy.
 *
 * Heuristic, not adversarial. Goals (in order of priority):
 *   1. Never play an illegal action (validateTurnAction must accept the result).
 *   2. Make forward progress: prefer actions that reduce hand size or lock in
 *      points over passing/no-op behavior.
 *   3. Open as soon as the threshold is reachable.
 *   4. After opening, dump cards onto existing melds aggressively.
 *   5. Discard the highest-value card that does not break an obvious meld.
 *
 * Non-goals: deep search, tracking opponent hands, defensive discard choice
 * beyond "don't break my own near-meld". Those belong in a Medium/Hard layer.
 */

import type {
  BotDifficulty,
  Card,
  Meld,
  MeldType,
  RegularCard,
  RoundState,
  TurnAction,
} from '@calash/shared';
import {
  GAME_CONFIG,
  MELD_CONFIG,
  RANK_ORDER,
  ACE_LOW,
  ACE_HIGH,
} from '@calash/shared';

import { validateMeld, totalCardValue, cardValue, computeJokerCandidates } from '../meld.js';
import type { JokerAssignment } from '@calash/shared';
import { goDownMinimum } from '../rules/going-down.js';

// Re-export for callers
export type { BotDifficulty };

import type { BotContext } from './index.js';

export interface ChooseEasyOptions {
  /**
   * The bot's "thinking" depth when searching meld combinations.
   * Bounded to keep the worst case (14-card hand, all combinations) tractable.
   * The default is fine for production.
   */
  readonly maxCombinationSize?: number;
}

const DEFAULT_MAX_COMBINATION_SIZE = 4;

// ─── Public entry point ──────────────────────────────────────────────────────

export function chooseEasyAction(ctx: BotContext, opts: ChooseEasyOptions = {}): TurnAction {
  const { state, playerId, hand } = ctx;
  const ps = state.playerStates[playerId];
  if (!ps) throw new Error(`Bot ${playerId} not in round`);

  // ── Draw phase ─────────────────────────────────────────────────────────────
  if (state.turnPhase === 'awaiting-draw-or-take') {
    return chooseDrawAction(state, hand);
  }

  // ── Pending drawn-card decision ────────────────────────────────────────────
  // After drawing from the deck the engine now requires a Keep/Discard
  // decision before the bot can do anything else. Easy strategy: keep the
  // card if it would be more useful in hand than the worst card already in
  // hand; otherwise discard it directly. Cheap, decisive — avoids a huge
  // search tree at this point in the turn.
  if (state.turnPhase === 'pending-drawn-decision') {
    const drawn = state.pendingDrawnCard;
    if (!drawn) {
      // Defensive: should not happen. Fall back to keep (safer than discard,
      // since keep can't lose information).
      return { type: 'keep-drawn-card' };
    }
    if (shouldKeepDrawnCard(drawn, hand)) {
      return { type: 'keep-drawn-card' };
    }
    return { type: 'discard-drawn-card' };
  }

  // ── Holding phase ──────────────────────────────────────────────────────────
  // Try, in order:
  //   1. If not down yet and threshold reachable → go-down with best meld set.
  //   2. If down → extend table melds with any matching cards in hand.
  //   3. If down → place any additional full melds from hand.
  //   4. Discard the best discard candidate.
  //
  // Steps 2 and 3 are independent decisions per call; the server will keep
  // calling chooseBotAction until the bot returns a discard, so we can do
  // multiple meld actions across multiple chooseBotAction invocations.

  if (!ps.hasGoneDown && !state.didTakeFromDiscardThisTurn) {
    const goDown = tryComposeGoDown(state, hand, opts);
    if (goDown) return goDown;
  }

  if (ps.hasGoneDown) {
    // Owner-only rule: bots may only extend melds they themselves placed.
    // Filter the table to the bot's own melds before searching for any
    // legal extension. Without this filter the bot used to (and the engine
    // used to silently allow) extending opponents' melds.
    const ownTableMelds = collectAllTableMelds(state).filter(
      (m) => m.ownerPlayerId === playerId,
    );
    const extension = findExtension(ownTableMelds, hand);
    if (extension) return extension;

    const newMeld = findNewMeldFromHand(hand, opts);
    if (newMeld) {
      return { type: 'add-new-meld', meld: attachJokerAssignmentIfNeeded(newMeld.type, newMeld.cards) };
    }
  }

  // Discard.
  const discard = chooseDiscard(state, ps.melds, hand);
  return { type: 'discard', card: discard };
}

// ─── Draw decision ──────────────────────────────────────────────────────────

function chooseDrawAction(state: RoundState, hand: readonly Card[]): TurnAction {
  const pile = state.discardPile;
  const deckEmpty = state.hiddenDeck.length === 0;

  // LEAVE-ONE mode requires pile.length >= 2 (anything smaller is a no-op).
  // The bot deterministically keeps the BOTTOM card on the pile — it's the
  // simplest rule and matches pre-fix behaviour, so existing replays stay
  // semantically equivalent. The new "any card stays" flexibility is a
  // human convenience; the bot doesn't need it strategically.
  const canLeaveOne = pile.length >= 2;

  // If the deck is empty we must take from discard if at all possible — drawing
  // from deck would be invalid, and any take ends the round next turn anyway.
  if (deckEmpty) {
    if (canLeaveOne) {
      return { type: 'take-from-discard', keepOnPileCard: pile[0] };
    }
    // No legal action exists; engine should detect this as exhaustion before
    // calling us. Returning draw-from-deck propagates the error to the caller.
    return { type: 'draw-from-deck' };
  }

  // Easy bot only considers taking when pile.length === 2 (take exactly the
  // top card) and that top card immediately completes a 3-card meld with
  // two cards in hand. Top stays in hand; bottom remains on the pile.
  if (pile.length !== 2) return { type: 'draw-from-deck' };

  const candidate = pile[pile.length - 1];
  if (completesMeldWith(candidate, hand)) {
    return { type: 'take-from-discard', keepOnPileCard: pile[0] };
  }
  return { type: 'draw-from-deck' };
}

function completesMeldWith(card: Card, hand: readonly Card[]): boolean {
  // Try every 2-card subset of hand combined with `card`; if any forms a valid
  // 3-card meld of either type, the take is beneficial.
  const handArr = [...hand];
  for (let i = 0; i < handArr.length; i++) {
    for (let j = i + 1; j < handArr.length; j++) {
      const trio = [handArr[i], handArr[j], card];
      if (validateMeld('set', trio).valid) return true;
      if (validateMeld('sequence', trio).valid) return true;
    }
  }
  return false;
}

// ─── Compose go-down (opening) ──────────────────────────────────────────────

interface ComposedMeld {
  readonly type: MeldType;
  readonly cards: readonly Card[];
  readonly value: number;
}

/**
 * Try to find a set of disjoint melds in `hand` whose combined value meets
 * the go-down threshold. Returns null if no such combination exists.
 *
 * Strategy: enumerate every 3- or 4-card meld possible from hand, then greedily
 * pick highest-value melds that don't share cards. Continue until threshold
 * is met or no more melds can be added.
 */
function tryComposeGoDown(
  state: RoundState,
  hand: readonly Card[],
  opts: ChooseEasyOptions,
): TurnAction | null {
  const threshold = goDownMinimum(state.highestTableTotal);

  const candidates = enumerateMeldCandidates(hand, opts);
  if (candidates.length === 0) return null;

  // Sort by value desc to prefer high-value melds first (greedy).
  candidates.sort((a, b) => b.value - a.value);

  // Try greedy with no upper limit on meld count first; if that doesn't reach
  // the threshold, we already failed (more melds wouldn't help).
  const chosen: ComposedMeld[] = [];
  const usedKeys = new Set<string>();
  let totalValue = 0;

  for (const c of candidates) {
    const keys = c.cards.map(cardKey);
    if (keys.some((k) => usedKeys.has(k))) continue;
    chosen.push(c);
    keys.forEach((k) => usedKeys.add(k));
    totalValue += c.value;
    // Stop early once threshold is met AND we've left enough room to discard.
    if (totalValue >= threshold && hand.length - usedKeys.size >= 1) break;
  }

  // Must leave at least 1 card in hand to discard at the end of the turn.
  while (chosen.length > 0 && hand.length - usedKeys.size < 1) {
    const removed = chosen.pop()!;
    removed.cards.forEach((c) => usedKeys.delete(cardKey(c)));
    totalValue -= removed.value;
  }

  // Special finish exception: even if the greedy total is below threshold,
  // the engine accepts a go-down that leaves exactly 1 card in hand (the
  // player will discard it next, finish the round, and pocket +20). If our
  // greedy chose enough melds to consume hand-1 cards, take it — finishing
  // the round in a single turn beats waiting for a higher-value opening.
  const fullyFinishes = chosen.length > 0 && hand.length - usedKeys.size === 1;

  if (chosen.length === 0 || (totalValue < threshold && !fullyFinishes)) return null;

  return {
    type: 'go-down',
    melds: chosen.map((c) => attachJokerAssignmentIfNeeded(c.type, c.cards)),
  };
}

// ─── Find a new full meld from hand (after already going down) ──────────────

function findNewMeldFromHand(hand: readonly Card[], opts: ChooseEasyOptions): ComposedMeld | null {
  // Don't dump the entire hand — leave at least 1 to discard.
  if (hand.length <= 1) return null;
  const candidates = enumerateMeldCandidates(hand, opts);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.value - a.value);

  for (const c of candidates) {
    if (c.cards.length < hand.length) return c; // leaves at least 1 card
  }
  return null;
}

// ─── Find an extension to a table meld ──────────────────────────────────────

function findExtension(
  tableMelds: ReadonlyArray<{ ownerPlayerId: string; meld: Meld }>,
  hand: readonly Card[],
): TurnAction | null {
  if (hand.length <= 1) return null; // need to discard

  for (const { meld } of tableMelds) {
    for (const card of hand) {
      const trial = [...meld.cards, card];
      if (!validateMeld(meld.type, trial).valid) continue;

      // If we're adding a joker to a meld that has no joker yet, the engine
      // requires a jokerAssignment. Skip the bot move if it can't be resolved
      // unambiguously — we don't want to flip a coin server-side and risk
      // tripping the circuit breaker on a malformed payload. The bot will
      // try a different card next.
      if (card.isJoker && !meld.jokerAssignment) {
        const candidates = computeJokerCandidates(meld.type, trial);
        if (candidates.length === 0) continue;
        const pick = candidates[0]; // deterministic — first legal candidate
        return { type: 'add-to-meld', meldId: meld.id, cards: [card], jokerAssignment: pick };
      }

      return { type: 'add-to-meld', meldId: meld.id, cards: [card] };
    }
  }
  return null;
}

function collectAllTableMelds(state: RoundState): Array<{ ownerPlayerId: string; meld: Meld }> {
  const out: Array<{ ownerPlayerId: string; meld: Meld }> = [];
  for (const playerId of Object.keys(state.playerStates)) {
    const ps = state.playerStates[playerId];
    for (const meld of ps.melds) {
      out.push({ ownerPlayerId: playerId, meld });
    }
  }
  return out;
}

// ─── Discard choice ─────────────────────────────────────────────────────────

/**
 * Pick a card to discard. Strategy:
 *   1. Score every card by "keep value" — high if it participates in any
 *      possible meld in hand, plus a small bonus if it's a near-meld card
 *      (one card away from completing a meld with the current hand).
 *   2. Discard the card with the LOWEST keep value, breaking ties by HIGHEST
 *      raw point value (so we shed expensive cards we can't use).
 */
function chooseDiscard(
  _state: RoundState,
  _existingMelds: readonly Meld[],
  hand: readonly Card[],
): Card {
  if (hand.length === 0) {
    throw new Error('Bot has no card to discard');
  }
  if (hand.length === 1) return hand[0];

  type Scored = { card: Card; keepValue: number; pointValue: number };
  const scored: Scored[] = hand.map((card) => ({
    card,
    keepValue: keepScore(card, hand),
    pointValue: cardValue(card),
  }));

  // Lowest keepValue wins; tie-break by highest pointValue (shed expensive dead weight).
  scored.sort((a, b) => {
    if (a.keepValue !== b.keepValue) return a.keepValue - b.keepValue;
    return b.pointValue - a.pointValue;
  });

  return scored[0].card;
}

/**
 * keepScore = number of distinct potential melds in `hand` that include `card`.
 * A card that participates in many partial-meld combinations is worth keeping.
 * Jokers always score very high (treat them as 100).
 */
function keepScore(card: Card, hand: readonly Card[]): number {
  if (card.isJoker) return 100;

  let score = 0;
  // Same-rank partners (set potential)
  const sameRankDifferentSuit = hand.filter(
    (c) => !c.isJoker && c.rank === card.rank && c.suit !== card.suit,
  ).length;
  if (sameRankDifferentSuit >= 1) score += sameRankDifferentSuit * 2;

  // Same-suit adjacent rank partners (sequence potential)
  const cardRank = RANK_ORDER[card.rank as RegularCard['rank']] ?? 0;
  const sameSuitNeighbors = hand.filter((c) => {
    if (c.isJoker) return false;
    if (c.suit !== card.suit) return false;
    const r = RANK_ORDER[c.rank] ?? 0;
    return Math.abs(r - cardRank) <= 2 && r !== cardRank;
  }).length;
  score += sameSuitNeighbors;

  return score;
}

/**
 * Decide whether the bot should keep the freshly-drawn card or discard it
 * straight away. We keep when:
 *   - the card is a joker (always keep),
 *   - the card has any meld-partner in hand (keepScore > 0), or
 *   - the bot's hand is small (< 4 cards left — almost-finished, hold tight).
 * Otherwise we discard high-value dead-weight cards directly.
 */
function shouldKeepDrawnCard(drawn: Card, hand: readonly Card[]): boolean {
  if (drawn.isJoker) return true;
  if (hand.length < 4) return true;
  return keepScore(drawn, hand) > 0;
}

// ─── Meld enumeration ───────────────────────────────────────────────────────

/**
 * Enumerate every 3- or 4-card meld that can be formed from the hand,
 * deduplicated by card-key set.
 *
 * Combination space: hand size up to ~15, but only k=3 and k=4. C(15,4) = 1365.
 * Validating each is O(1). Total well under 5k validateMeld calls per turn.
 */
function enumerateMeldCandidates(hand: readonly Card[], opts: ChooseEasyOptions): ComposedMeld[] {
  // Cap k to keep enumeration tractable for pathologically large hands. With
  // hand=14 (normal), C(14,4) = 1001 — fine. With hand=30, C(30,4) = 27k —
  // still fine. With hand=89, C(89,4) = 2.4M — too slow. So cap at k=3 once
  // the hand grows beyond ~25 cards; 3-card melds are sufficient to chain.
  const requestedMax = Math.max(MELD_CONFIG.MIN_SET_SIZE, opts.maxCombinationSize ?? DEFAULT_MAX_COMBINATION_SIZE);
  const sizeAdjustedMax = hand.length > 25 ? MELD_CONFIG.MIN_SET_SIZE : requestedMax;
  const minSize = MELD_CONFIG.MIN_SET_SIZE; // 3
  const maxSize = Math.min(sizeAdjustedMax, hand.length, 14);
  const out: ComposedMeld[] = [];
  const seen = new Set<string>();

  const handArr = [...hand];
  for (let k = minSize; k <= maxSize; k++) {
    forEachCombination(handArr, k, (combo) => {
      const key = combo.map(cardKey).sort().join('|');
      if (seen.has(key + ':seq')) return;

      const seqResult = validateMeld('sequence', combo);
      if (seqResult.valid) {
        seen.add(key + ':seq');
        out.push({ type: 'sequence', cards: [...combo], value: totalCardValue(combo) });
      }

      // Sets are 3 or 4 cards only.
      if (k <= MELD_CONFIG.MAX_SET_SIZE) {
        const setResult = validateMeld('set', combo);
        if (setResult.valid && !seen.has(key + ':set')) {
          seen.add(key + ':set');
          out.push({ type: 'set', cards: [...combo], value: totalCardValue(combo) });
        }
      }
    });
  }

  return out;
}

function forEachCombination<T>(items: T[], k: number, cb: (combo: T[]) => void): void {
  const n = items.length;
  if (k > n) return;
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    cb(idx.map((i) => items[i]));
    let i = k - 1;
    while (i >= 0 && idx[i] === i + n - k) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

function cardKey(c: Card): string {
  if (c.isJoker) return `J${c.jokerIndex}`;
  return `${c.rank}-${c.suit}-${c.deckIndex}`;
}

/**
 * If a candidate meld contains a joker, attach a jokerAssignment so the
 * engine never needs to ask the bot to disambiguate. The bot picks the
 * first legal candidate deterministically — both choices score the same
 * (joker = 25 either way) so there's no strategic loss.
 *
 * Returns the meld unchanged when no joker is present.
 */
function attachJokerAssignmentIfNeeded(
  type: MeldType,
  cards: readonly Card[],
): { type: MeldType; cards: readonly Card[]; jokerAssignment?: JokerAssignment } {
  const hasJoker = cards.some((c) => c.isJoker);
  if (!hasJoker) return { type, cards };
  const candidates = computeJokerCandidates(type, cards);
  if (candidates.length === 0) return { type, cards }; // should not happen — meld would be invalid
  return { type, cards, jokerAssignment: candidates[0] };
}

// Suppress unused warnings (referenced for future medium-bot expansion)
void GAME_CONFIG;
void ACE_LOW;
void ACE_HIGH;
