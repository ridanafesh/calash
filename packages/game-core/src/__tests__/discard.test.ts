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

describe('validateTakeFromDiscard', () => {
  describe('pile with 2 cards (standard rule)', () => {
    it('allows taking 1 (pile.length - 1)', () => {
      expect(validateTakeFromDiscard([A, B], 1).valid).toBe(true);
    });

    it('rejects taking 2 (pile would be empty)', () => {
      expect(validateTakeFromDiscard([A, B], 2).valid).toBe(false);
    });

    it('rejects taking 0', () => {
      expect(validateTakeFromDiscard([A, B], 0).valid).toBe(false);
    });
  });

  describe('pile with 3 cards (standard rule)', () => {
    it('allows taking 2 (pile.length - 1)', () => {
      expect(validateTakeFromDiscard([A, B, C], 2).valid).toBe(true);
    });

    it('rejects taking 1 (leaves 2, not allowed by general rule)', () => {
      expect(validateTakeFromDiscard([A, B, C], 1).valid).toBe(false);
    });

    it('rejects taking 3 (would empty pile)', () => {
      expect(validateTakeFromDiscard([A, B, C], 3).valid).toBe(false);
    });
  });

  describe('pile with 1 card (minimum remaining)', () => {
    it('rejects any take when only 1 card remains', () => {
      expect(validateTakeFromDiscard([A], 1).valid).toBe(false);
    });
  });

  describe('pile with 0 cards', () => {
    it('rejects take from empty pile', () => {
      expect(validateTakeFromDiscard([], 1).valid).toBe(false);
    });
  });

  describe('pile with 4 cards (DISCARD_PILE_TAKE_ALL_THRESHOLD)', () => {
    it('allows taking 3 (standard option A)', () => {
      expect(validateTakeFromDiscard([A, B, C, D], 3).valid).toBe(true);
    });

    it('allows taking all 4 when returnCardFromHand is provided (option B)', () => {
      expect(validateTakeFromDiscard([A, B, C, D], 4, HAND_CARD).valid).toBe(true);
    });

    it('rejects taking all 4 without returning a card', () => {
      const result = validateTakeFromDiscard([A, B, C, D], 4);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/return 1 card/i);
    });

    it('rejects taking 2 (explicitly prohibited when pile has 4)', () => {
      expect(validateTakeFromDiscard([A, B, C, D], 2).valid).toBe(false);
    });

    it('rejects taking 1', () => {
      expect(validateTakeFromDiscard([A, B, C, D], 1).valid).toBe(false);
    });
  });

  describe('pile with 5 cards', () => {
    it('allows taking 4 (pile.length - 1)', () => {
      expect(validateTakeFromDiscard([A, B, C, D, E], 4).valid).toBe(true);
    });

    it('rejects taking 3 (leaves 2)', () => {
      expect(validateTakeFromDiscard([A, B, C, D, E], 3).valid).toBe(false);
    });

    it('rejects taking 5 (would empty pile)', () => {
      expect(validateTakeFromDiscard([A, B, C, D, E], 5).valid).toBe(false);
    });
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

  it('leaves exactly 1 card after a standard take', () => {
    const { newPile } = applyTakeFromDiscard([A, B, C], 2);
    expect(newPile).toHaveLength(1);
  });

  it('returns the correct pile when returnCardFromHand is provided', () => {
    // Take all 4, return HAND_CARD — HAND_CARD becomes the sole remaining card
    const { taken, newPile } = applyTakeFromDiscard([A, B, C, D], 4, HAND_CARD);
    expect(taken).toEqual([A, B, C, D]);
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
