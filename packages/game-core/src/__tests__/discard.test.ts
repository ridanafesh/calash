import type { RegularCard } from '@calash/shared';
import { validateTakeFromDiscard, applyTakeFromDiscard } from '../rules/discard.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const rc = (rank: RegularCard['rank'], suit: RegularCard['suit']): RegularCard =>
  ({ rank, suit, isJoker: false, deckIndex: 0 });

const A = rc('A', 'spades');
const B = rc('K', 'hearts');
const C = rc('Q', 'clubs');
const D = rc('J', 'diamonds');
const E = rc('10', 'hearts');
const HAND_CARD = rc('2', 'clubs');

// ─── validateTakeFromDiscard ─────────────────────────────────────────────────
//
// Two legal modes — both end with EXACTLY 1 card on the pile:
//
//   LEAVE-ONE       : keepOnPileCard set, returnCardFromHand absent.
//                     The chosen card stays; everything else moves to hand.
//                     Requires pile.length >= 2 (1-card pile would be a no-op).
//
//   TAKE-ALL-REPLACE: returnCardFromHand set, keepOnPileCard absent.
//                     Whole pile moves to hand; returnCardFromHand goes onto
//                     the pile. Works for any pile.length >= 1. The hand-
//                     membership of returnCardFromHand is checked at a higher
//                     layer (rules/turn.ts) — the discard validator only
//                     enforces the pile-side invariant.

describe('validateTakeFromDiscard — leave-one mode', () => {
  it('accepts keeping any card on a 2-card pile', () => {
    expect(validateTakeFromDiscard([A, B], A).valid).toBe(true);
    expect(validateTakeFromDiscard([A, B], B).valid).toBe(true);
  });

  it('accepts keeping any card on a 5-card pile (mid, top, bottom — all valid)', () => {
    expect(validateTakeFromDiscard([A, B, C, D, E], A).valid).toBe(true);
    expect(validateTakeFromDiscard([A, B, C, D, E], C).valid).toBe(true);
    expect(validateTakeFromDiscard([A, B, C, D, E], E).valid).toBe(true);
  });

  it('rejects when the chosen card is not on the pile', () => {
    const r = validateTakeFromDiscard([A, B, C], rc('9', 'spades'));
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/not currently on the discard pile/i);
  });

  it('rejects leave-one on a 1-card pile (no-op)', () => {
    const r = validateTakeFromDiscard([A], A);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/no-op|take-all/i);
  });

  it('rejects when both keepOnPileCard and returnCardFromHand are supplied', () => {
    const r = validateTakeFromDiscard([A, B], A, HAND_CARD);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/one mode/i);
  });
});

describe('validateTakeFromDiscard — take-all-replace mode', () => {
  it('accepts take-all-replace on any pile size from 1 upwards', () => {
    expect(validateTakeFromDiscard([A], undefined, HAND_CARD).valid).toBe(true);
    expect(validateTakeFromDiscard([A, B], undefined, HAND_CARD).valid).toBe(true);
    expect(validateTakeFromDiscard([A, B, C, D, E], undefined, HAND_CARD).valid).toBe(true);
  });

  it('does NOT block returning a card that is currently on the pile (post-pickup hand)', () => {
    // Spec: the returned card may be one the player just picked up.  At this
    // structural layer we don't know the player's hand, so we accept it; the
    // turn-level validator handles "card actually exists somewhere reachable".
    expect(validateTakeFromDiscard([A, B], undefined, A).valid).toBe(true);
  });
});

describe('validateTakeFromDiscard — neither / both modes', () => {
  it('rejects when neither keepOnPileCard nor returnCardFromHand is supplied', () => {
    const r = validateTakeFromDiscard([A, B]);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/specify/i);
  });

  it('rejects from an empty pile', () => {
    const r = validateTakeFromDiscard([], A);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/empty/i);
  });
});

// ─── applyTakeFromDiscard ─────────────────────────────────────────────────────

describe('applyTakeFromDiscard — leave-one', () => {
  it('keeps the chosen card; every other pile card moves to taken', () => {
    // pile ordered oldest→newest: [A, B, C]
    const { taken, newPile } = applyTakeFromDiscard([A, B, C], B);
    expect(newPile).toEqual([B]);
    expect(taken).toEqual([A, C]);
  });

  it('post-state pile has exactly 1 card regardless of which card stays', () => {
    for (const keep of [A, B, C, D, E]) {
      const { newPile } = applyTakeFromDiscard([A, B, C, D, E], keep);
      expect(newPile).toEqual([keep]);
      expect(newPile).toHaveLength(1);
    }
  });

  it('keeping the BOTTOM card matches the legacy "leave bottom" behaviour', () => {
    const { taken, newPile } = applyTakeFromDiscard([A, B, C, D], A);
    expect(newPile).toEqual([A]);
    expect(taken).toEqual([B, C, D]);
  });

  it('keeping the TOP card behaves symmetrically', () => {
    const { taken, newPile } = applyTakeFromDiscard([A, B, C, D], D);
    expect(newPile).toEqual([D]);
    expect(taken).toEqual([A, B, C]);
  });
});

describe('applyTakeFromDiscard — take-all-replace', () => {
  it('returns the entire pile as taken and replaces it with returnCardFromHand', () => {
    const { taken, newPile } = applyTakeFromDiscard([A, B, C, D], undefined, HAND_CARD);
    expect(taken).toEqual([A, B, C, D]);
    expect(newPile).toEqual([HAND_CARD]);
  });

  it('takes the lone card from a 1-card pile and replaces it', () => {
    const { taken, newPile } = applyTakeFromDiscard([A], undefined, HAND_CARD);
    expect(taken).toEqual([A]);
    expect(newPile).toEqual([HAND_CARD]);
  });

  it('does not include returnCardFromHand in the taken set', () => {
    const { taken } = applyTakeFromDiscard([A, B, C, D], undefined, HAND_CARD);
    expect(taken).not.toContainEqual(HAND_CARD);
  });
});
