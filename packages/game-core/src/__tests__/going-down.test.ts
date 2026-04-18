import type { RegularCard, JokerCard } from '@calash/shared';
import { GAME_CONFIG } from '@calash/shared';
import { validateGoDown, goDownMinimum } from '../rules/going-down.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const rc = (rank: RegularCard['rank'], suit: RegularCard['suit'], deckIndex: 0 | 1 = 0): RegularCard =>
  ({ rank, suit, isJoker: false, deckIndex });

const joker = (jokerIndex: 0 | 1 = 0): JokerCard =>
  ({ rank: 'JOKER', suit: null, isJoker: true, jokerIndex });

// A set worth 30 pts (3 × Kings = 30)
const kingSet = [rc('K', 'hearts'), rc('K', 'diamonds'), rc('K', 'clubs')];
// A sequence worth 27 pts (9+10+J = 29? — wait: 9=9, 10=10, J=10 → 29... let me recalculate)
// Actually: 9=9, 10=10, J=10 → 29 pts. Let me use something clearer.
// A set worth 50 pts (3 × Aces = 75)
const aceSet = [rc('A', 'hearts'), rc('A', 'diamonds'), rc('A', 'clubs')];
// aceSet = 3 × 25 = 75 pts exactly (meets INITIAL_GO_DOWN_MINIMUM)

// A hand that contains kingSet + aceSet cards
const fullHand = [...kingSet, ...aceSet];
const aceSetHand = [...aceSet];

// ─── goDownMinimum ────────────────────────────────────────────────────────────

describe('goDownMinimum', () => {
  it('returns INITIAL_GO_DOWN_MINIMUM (75) when no player has gone down', () => {
    expect(goDownMinimum(0)).toBe(GAME_CONFIG.INITIAL_GO_DOWN_MINIMUM);
  });

  it('returns highestTableTotal + GO_DOWN_INCREMENT when someone is down', () => {
    expect(goDownMinimum(80)).toBe(85);
    expect(goDownMinimum(100)).toBe(105);
  });

  it('applies increment even when highestTableTotal is just 1', () => {
    expect(goDownMinimum(1)).toBe(1 + GAME_CONFIG.GO_DOWN_INCREMENT);
  });
});

// ─── validateGoDown ───────────────────────────────────────────────────────────

describe('validateGoDown', () => {
  it('rejects when the player has already gone down', () => {
    const result = validateGoDown(
      [{ type: 'set', cards: aceSet }],
      aceSetHand,
      0,
      true,  // hasGoneDown
      false,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/already gone down/i);
  });

  it('rejects when the player took from the discard pile this turn', () => {
    const result = validateGoDown(
      [{ type: 'set', cards: aceSet }],
      aceSetHand,
      0,
      false,
      true,  // didTakeFromDiscardThisTurn
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/discard pile/i);
  });

  it('rejects when no melds are provided', () => {
    const result = validateGoDown([], aceSetHand, 0, false, false);
    expect(result.valid).toBe(false);
  });

  it('accepts exactly INITIAL_GO_DOWN_MINIMUM points (75) as the first opener', () => {
    // aceSet = 3 × 25 = 75 pts
    const result = validateGoDown(
      [{ type: 'set', cards: aceSet }],
      aceSetHand,
      0,       // highestTableTotal = 0 (first opener)
      false,
      false,
    );
    expect(result.valid).toBe(true);
  });

  it('rejects below INITIAL_GO_DOWN_MINIMUM for the first opener', () => {
    // kingSet = 3 × 10 = 30 pts < 75
    const result = validateGoDown(
      [{ type: 'set', cards: kingSet }],
      [...kingSet],
      0,
      false,
      false,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/below the required minimum/i);
  });

  it('accepts combined meld value meeting the threshold', () => {
    // kingSet (30) + aceSet (75) = 105 pts ≥ 75
    const result = validateGoDown(
      [
        { type: 'set', cards: kingSet },
        { type: 'set', cards: aceSet },
      ],
      fullHand,
      0,
      false,
      false,
    );
    expect(result.valid).toBe(true);
  });

  it('uses highestTableTotal + GO_DOWN_INCREMENT for subsequent openers', () => {
    // Highest is 80 → need 85; aceSet is only 75
    const result = validateGoDown(
      [{ type: 'set', cards: aceSet }],
      aceSetHand,
      80,   // highestTableTotal
      false,
      false,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/below the required minimum/i);
  });

  it('accepts when combined value just meets highestTableTotal + GO_DOWN_INCREMENT', () => {
    // Highest is 70 → need 75; aceSet = 75 exactly
    const result = validateGoDown(
      [{ type: 'set', cards: aceSet }],
      aceSetHand,
      70,
      false,
      false,
    );
    expect(result.valid).toBe(true);
  });

  it('rejects when a meld is individually invalid', () => {
    // Only 2 cards — invalid set
    const result = validateGoDown(
      [{ type: 'set', cards: [rc('A', 'hearts'), rc('A', 'diamonds')] }],
      [rc('A', 'hearts'), rc('A', 'diamonds')],
      0,
      false,
      false,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/meld 1 is invalid/i);
  });

  it('rejects a card not in hand', () => {
    const result = validateGoDown(
      [{ type: 'set', cards: aceSet }],
      [rc('A', 'hearts'), rc('A', 'diamonds')], // only 2 of the 3 cards
      0,
      false,
      false,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not in your hand/i);
  });

  it('rejects using the same card twice across two melds', () => {
    // Use rc('A', 'hearts', 0) in both melds
    const sharedCard = rc('A', 'hearts', 0);
    const meld1 = [sharedCard, rc('A', 'diamonds'), rc('A', 'clubs')];
    const meld2 = [sharedCard, rc('K', 'diamonds'), rc('K', 'clubs')];
    const hand = [sharedCard, rc('A', 'diamonds'), rc('A', 'clubs'), rc('K', 'diamonds'), rc('K', 'clubs')];

    const result = validateGoDown(
      [
        { type: 'set', cards: meld1 },
        { type: 'set', cards: meld2 },
      ],
      hand,
      0,
      false,
      false,
    );
    expect(result.valid).toBe(false);
  });

  it('accepts a meld containing a joker', () => {
    // 2 Aces + Joker = 25+25+25 = 75, valid set
    const meldCards = [rc('A', 'hearts'), rc('A', 'diamonds'), joker(0)];
    const result = validateGoDown(
      [{ type: 'set', cards: meldCards }],
      [...meldCards],
      0,
      false,
      false,
    );
    expect(result.valid).toBe(true);
  });
});
