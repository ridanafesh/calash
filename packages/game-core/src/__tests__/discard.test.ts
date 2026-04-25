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
// Rules:
//   LEAVE-ONE      : count === pile.length - 1, no returnCardFromHand
//                    (requires pile.length >= 2)
//   TAKE-ALL-REPLACE: count === pile.length, returnCardFromHand provided
//                    (works for any pile.length >= 1)
//
// Anything else is invalid: the post-state must have exactly 1 card.

describe('validateTakeFromDiscard — leave-one mode', () => {
  it('allows take=1 from a 2-card pile (leaving the bottom card)', () => {
    expect(validateTakeFromDiscard([A, B], 1).valid).toBe(true);
  });

  it('allows take=2 from a 3-card pile (leaving the bottom card)', () => {
    expect(validateTakeFromDiscard([A, B, C], 2).valid).toBe(true);
  });

  it('allows take=3 from a 4-card pile (the standard "take 3 leave 1")', () => {
    expect(validateTakeFromDiscard([A, B, C, D], 3).valid).toBe(true);
  });

  it('allows take=4 from a 5-card pile', () => {
    expect(validateTakeFromDiscard([A, B, C, D, E], 4).valid).toBe(true);
  });

  it('rejects providing a returnCardFromHand in leave-one mode', () => {
    const r = validateTakeFromDiscard([A, B, C], 2, HAND_CARD);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/leave-one/i);
  });
});

describe('validateTakeFromDiscard — take-all-replace mode', () => {
  it('allows take=2 from a 2-card pile when a hand replacement is supplied', () => {
    expect(validateTakeFromDiscard([A, B], 2, HAND_CARD).valid).toBe(true);
  });

  it('allows take=3 from a 3-card pile with replacement', () => {
    expect(validateTakeFromDiscard([A, B, C], 3, HAND_CARD).valid).toBe(true);
  });

  it('allows take=4 from a 4-card pile with replacement', () => {
    expect(validateTakeFromDiscard([A, B, C, D], 4, HAND_CARD).valid).toBe(true);
  });

  it('allows take=5 from a 5-card pile with replacement', () => {
    expect(validateTakeFromDiscard([A, B, C, D, E], 5, HAND_CARD).valid).toBe(true);
  });

  it('allows taking the lone card from a 1-card pile (the previously-blocked case)', () => {
    expect(validateTakeFromDiscard([A], 1, HAND_CARD).valid).toBe(true);
  });

  it('rejects take-all without a hand replacement', () => {
    const r = validateTakeFromDiscard([A, B, C, D], 4);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/take-all|return|put one card/i);
  });

  it('rejects take-all without replacement on a 1-card pile', () => {
    const r = validateTakeFromDiscard([A], 1);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/take-all|put one card|return/i);
  });
});

describe('validateTakeFromDiscard — invalid counts', () => {
  it('rejects take=0', () => {
    expect(validateTakeFromDiscard([A, B], 0).valid).toBe(false);
  });

  it('rejects take=2 from a 4-card pile (would leave 2)', () => {
    const r = validateTakeFromDiscard([A, B, C, D], 2);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/Invalid take count/i);
  });

  it('rejects take=3 from a 5-card pile (would leave 2)', () => {
    expect(validateTakeFromDiscard([A, B, C, D, E], 3).valid).toBe(false);
  });

  it('rejects any take from an empty pile', () => {
    const r = validateTakeFromDiscard([], 0);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/empty/i);
  });
});

// ─── applyTakeFromDiscard ─────────────────────────────────────────────────────

describe('applyTakeFromDiscard', () => {
  it('takes cards from the top (end) of the pile', () => {
    // pile ordered oldest→newest: [A, B, C]  — top is C
    const { taken, newPile } = applyTakeFromDiscard([A, B, C], 2);
    expect(taken).toEqual([B, C]);
    expect(newPile).toEqual([A]);
  });

  it('leaves exactly 1 card after a leave-one take', () => {
    const { newPile } = applyTakeFromDiscard([A, B, C], 2);
    expect(newPile).toHaveLength(1);
  });

  it('returns the correct pile when returnCardFromHand is provided', () => {
    // Take all 4, return HAND_CARD — HAND_CARD becomes the sole remaining card
    const { taken, newPile } = applyTakeFromDiscard([A, B, C, D], 4, HAND_CARD);
    expect(taken).toEqual([A, B, C, D]);
    expect(newPile).toEqual([HAND_CARD]);
  });

  it('takes the lone card from a 1-card pile and replaces it', () => {
    const { taken, newPile } = applyTakeFromDiscard([A], 1, HAND_CARD);
    expect(taken).toEqual([A]);
    expect(newPile).toEqual([HAND_CARD]);
  });

  it('does not include returnCardFromHand in the taken set', () => {
    const { taken } = applyTakeFromDiscard([A, B, C, D], 4, HAND_CARD);
    expect(taken).not.toContainEqual(HAND_CARD);
  });

  it('keeps the bottom card when taking pile.length - 1', () => {
    const { newPile } = applyTakeFromDiscard([A, B, C, D], 3);
    expect(newPile).toEqual([A]);
  });
});
