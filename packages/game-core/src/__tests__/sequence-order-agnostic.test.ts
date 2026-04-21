/**
 * The engine MUST accept sequences regardless of the order the client sent
 * the cards in. The validator already sorts ranks internally; these tests
 * pin that behavior so a future "ordered cards" optimization can't break it.
 *
 * Also covers the spec-required cases:
 *   - Q-K-A as a sequence (high-Ace, 3 cards)
 *   - 10-J-Q-K-A as a sequence (high-Ace, 5 cards)
 *   - A-2-3 as a sequence (low-Ace)
 *   - reverse-order selection (A-K-Q, A-K-Q-J-10)
 *   - mixed-suit rejection
 *   - same cards as a set must be rejected with the rank-mismatch reason
 */

import type { Card, RegularCard } from '@calash/shared';
import { validateMeld } from '../meld.js';

const rc = (rank: RegularCard['rank'], suit: RegularCard['suit'], deckIndex: 0 | 1 = 0): RegularCard =>
  ({ rank, suit, isJoker: false, deckIndex });

describe('Sequence — order-agnostic acceptance (high-Ace cases)', () => {
  it('accepts Q♦ K♦ A♦ as a sequence (forward)', () => {
    expect(validateMeld('sequence', [rc('Q', 'diamonds'), rc('K', 'diamonds'), rc('A', 'diamonds')]).valid).toBe(true);
  });

  it('accepts A♦ K♦ Q♦ as a sequence (reverse click order)', () => {
    expect(validateMeld('sequence', [rc('A', 'diamonds'), rc('K', 'diamonds'), rc('Q', 'diamonds')]).valid).toBe(true);
  });

  it('accepts K♦ A♦ Q♦ as a sequence (jumbled click order)', () => {
    expect(validateMeld('sequence', [rc('K', 'diamonds'), rc('A', 'diamonds'), rc('Q', 'diamonds')]).valid).toBe(true);
  });

  it('accepts 10♦ J♦ Q♦ K♦ A♦ as a sequence (forward)', () => {
    expect(
      validateMeld('sequence', [
        rc('10', 'diamonds'), rc('J', 'diamonds'), rc('Q', 'diamonds'), rc('K', 'diamonds'), rc('A', 'diamonds'),
      ]).valid,
    ).toBe(true);
  });

  it('accepts A♦ K♦ Q♦ J♦ 10♦ as a sequence (reverse click order)', () => {
    expect(
      validateMeld('sequence', [
        rc('A', 'diamonds'), rc('K', 'diamonds'), rc('Q', 'diamonds'), rc('J', 'diamonds'), rc('10', 'diamonds'),
      ]).valid,
    ).toBe(true);
  });

  it('accepts the same five cards in fully shuffled order', () => {
    expect(
      validateMeld('sequence', [
        rc('Q', 'diamonds'), rc('A', 'diamonds'), rc('10', 'diamonds'), rc('K', 'diamonds'), rc('J', 'diamonds'),
      ]).valid,
    ).toBe(true);
  });
});

describe('Sequence — Ace low (regression)', () => {
  it('accepts A♣ 2♣ 3♣ in any order', () => {
    const cards: Card[][] = [
      [rc('A', 'clubs'), rc('2', 'clubs'), rc('3', 'clubs')],
      [rc('3', 'clubs'), rc('A', 'clubs'), rc('2', 'clubs')],
      [rc('3', 'clubs'), rc('2', 'clubs'), rc('A', 'clubs')],
    ];
    for (const c of cards) {
      expect(validateMeld('sequence', c).valid).toBe(true);
    }
  });
});

describe('Sequence — invalid combinations', () => {
  it('rejects Q♦ K♦ A♥ (mixed suits)', () => {
    const r = validateMeld('sequence', [rc('Q', 'diamonds'), rc('K', 'diamonds'), rc('A', 'hearts')]);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/same suit/i);
  });

  it('rejects 10♦ J♥ Q♦ K♦ A♦ (one card mixed)', () => {
    const r = validateMeld('sequence', [rc('10', 'diamonds'), rc('J', 'hearts'), rc('Q', 'diamonds'), rc('K', 'diamonds'), rc('A', 'diamonds')]);
    expect(r.valid).toBe(false);
  });
});

describe('Set — same cards rejected with the rank-mismatch reason (the bug-report case)', () => {
  // This is the exact case from the bug report:
  //   "A♦, K♦, Q♦ is being rejected with: 'All cards in a set must have the same rank'"
  // The cards aren't being misclassified — the user clicked + Set instead of
  // + Sequence. Confirm the rejection reason is the expected rank-mismatch
  // (so users / our UI can disambiguate).
  it('rejects A♦ K♦ Q♦ as a set with rank-mismatch reason', () => {
    const r = validateMeld('set', [rc('A', 'diamonds'), rc('K', 'diamonds'), rc('Q', 'diamonds')]);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/same rank/i);
  });

  it('rejects 10♦ J♦ Q♦ K♦ A♦ as a set with rank-mismatch reason', () => {
    const r = validateMeld('set', [rc('10', 'diamonds'), rc('J', 'diamonds'), rc('Q', 'diamonds'), rc('K', 'diamonds'), rc('A', 'diamonds')]);
    expect(r.valid).toBe(false);
    // A 5-card set is also rejected because sets allow at most 4 cards. Either
    // reason is acceptable as long as the validator does NOT accept it.
    expect(r.reason).toBeDefined();
  });
});
