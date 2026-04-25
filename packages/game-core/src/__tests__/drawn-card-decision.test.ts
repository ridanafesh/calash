/**
 * Tests for the pending-drawn-card Keep/Discard decision flow.
 *
 * Spec scenarios:
 *   1. draw-from-deck moves card to pendingDrawnCard, NOT to hand
 *   2. turnPhase becomes 'pending-drawn-decision'
 *   3. Keep moves the card into hand and advances to 'holding'
 *   4. Discard sends the card to the pile and ends the turn
 *   5. While pending, all unrelated actions are blocked
 *   6. take-from-discard is unaffected (no pending state)
 *   7. drawn card is visible in toRoundStateView (so opponents see "X drew")
 *   8. discard-drawn-card with no pending = clear error
 *   9. keep then normal discard flows correctly into next turn
 */

import type {
  Card,
  Meld,
  PlayerRoundState,
  RegularCard,
  RoundState,
} from '@calash/shared';
import { applyTurnAction, toRoundStateView } from '../engine.js';

const rc = (rank: RegularCard['rank'], suit: RegularCard['suit'], deckIndex: 0 | 1 = 0): RegularCard =>
  ({ rank, suit, isJoker: false, deckIndex });

function makeFixture(opts: {
  myHand: Card[];
  topOfDeck?: Card;
  pile?: Card[];
  myMelds?: Meld[];
  hasGoneDown?: boolean;
}): { state: RoundState; me: string; other: string } {
  const me = 'me';
  const other = 'other';
  const myMelds = opts.myMelds ?? [];
  const myPs: PlayerRoundState = {
    playerId: me,
    hand: [...opts.myHand],
    melds: myMelds,
    hasGoneDown: opts.hasGoneDown ?? false,
    tableTotal: myMelds.reduce((s, m) => s + m.totalValue, 0),
  };
  const otherPs: PlayerRoundState = {
    playerId: other,
    hand: [rc('7', 'spades'), rc('8', 'diamonds')],
    melds: [],
    hasGoneDown: false,
    tableTotal: 0,
  };
  // Deck stored top-last — the topOfDeck card is the LAST element in the array.
  const deckBackground = [rc('2', 'clubs'), rc('3', 'clubs')];
  const hiddenDeck = opts.topOfDeck ? [...deckBackground, opts.topOfDeck] : deckBackground;
  const state: RoundState = {
    roundNumber: 1,
    dealerPlayerId: other,
    playerOrder: [me, other],
    currentTurnPlayerId: me,
    phase: 'in-progress',
    turnPhase: 'awaiting-draw-or-take',
    playerStates: { [me]: myPs, [other]: otherPs },
    hiddenDeck,
    discardPile: opts.pile ?? [rc('5', 'spades')],
    highestTableTotal: myMelds.reduce((s, m) => s + m.totalValue, 0),
    didTakeFromDiscardThisTurn: false,
  };
  return { state, me, other };
}

// ─── Draw → pending state ────────────────────────────────────────────────────

describe('draw-from-deck — pending decision flow', () => {
  it('moves the drawn card to pendingDrawnCard, NOT to hand', () => {
    const drawn = rc('A', 'hearts');
    const fix = makeFixture({ myHand: [rc('5', 'clubs')], topOfDeck: drawn });
    const handBefore = fix.state.playerStates[fix.me].hand.length;

    const r = applyTurnAction(fix.state, fix.me, { type: 'draw-from-deck' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.state.pendingDrawnCard).toEqual(drawn);
    expect(r.state.playerStates[fix.me].hand).toHaveLength(handBefore); // unchanged
    expect(r.state.playerStates[fix.me].hand).not.toContainEqual(drawn);
    expect(r.state.turnPhase).toBe('pending-drawn-decision');
    expect(r.state.currentTurnPlayerId).toBe(fix.me); // still my turn
  });

  it('REDACTS the drawn card identity in the broadcast view — only signals presence', () => {
    // PRIVACY: opponents must not see what the active player drew. The
    // public broadcast view exposes a boolean `pendingDrawnCardPresent` so
    // the UI can render "X is deciding…" but the card identity stays in
    // the server-side RoundState only and is delivered to the owner via
    // the dedicated game:drawn-card socket event.
    const drawn = rc('K', 'spades');
    const fix = makeFixture({ myHand: [rc('5', 'clubs')], topOfDeck: drawn });
    const r = applyTurnAction(fix.state, fix.me, { type: 'draw-from-deck' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const view = toRoundStateView(r.state);
    // The view does NOT carry the card itself.
    expect(view).not.toHaveProperty('pendingDrawnCard');
    expect(view.pendingDrawnCardPresent).toBe(true);
    expect(view.turnPhase).toBe('pending-drawn-decision');

    // The server-side state still has the card (so the engine can apply
    // keep/discard against it).
    expect(r.state.pendingDrawnCard).toEqual(drawn);
  });

  it('clears pendingDrawnCardPresent after Keep / Discard', () => {
    const drawn = rc('K', 'spades');
    const fix = makeFixture({ myHand: [rc('5', 'clubs')], topOfDeck: drawn });
    const drew = applyTurnAction(fix.state, fix.me, { type: 'draw-from-deck' });
    if (!drew.ok) return;
    const kept = applyTurnAction(drew.state, fix.me, { type: 'keep-drawn-card' });
    expect(kept.ok).toBe(true);
    if (!kept.ok) return;
    const view = toRoundStateView(kept.state);
    expect(view.pendingDrawnCardPresent).toBe(false);
    expect(view).not.toHaveProperty('pendingDrawnCard');
  });
});

// ─── Keep ────────────────────────────────────────────────────────────────────

describe('keep-drawn-card', () => {
  it('moves the pending card into hand and advances to holding', () => {
    const drawn = rc('A', 'hearts');
    const fix = makeFixture({ myHand: [rc('5', 'clubs')], topOfDeck: drawn });
    const drew = applyTurnAction(fix.state, fix.me, { type: 'draw-from-deck' });
    if (!drew.ok) return;

    const kept = applyTurnAction(drew.state, fix.me, { type: 'keep-drawn-card' });
    expect(kept.ok).toBe(true);
    if (!kept.ok) return;

    expect(kept.state.playerStates[fix.me].hand).toContainEqual(drawn);
    expect(kept.state.playerStates[fix.me].hand).toHaveLength(2);
    expect(kept.state.turnPhase).toBe('holding');
    expect(kept.state.pendingDrawnCard).toBeUndefined();
    expect(kept.state.currentTurnPlayerId).toBe(fix.me); // still my turn
  });

  it('after Keep, the player must still discard one card to end their turn', () => {
    const drawn = rc('A', 'hearts');
    const fix = makeFixture({ myHand: [rc('5', 'clubs')], topOfDeck: drawn });
    const drew = applyTurnAction(fix.state, fix.me, { type: 'draw-from-deck' });
    if (!drew.ok) return;
    const kept = applyTurnAction(drew.state, fix.me, { type: 'keep-drawn-card' });
    if (!kept.ok) return;

    // Discard the original 5♣ to end the turn.
    const discarded = applyTurnAction(kept.state, fix.me, {
      type: 'discard',
      card: rc('5', 'clubs'),
    });
    expect(discarded.ok).toBe(true);
    if (!discarded.ok) return;
    expect(discarded.state.currentTurnPlayerId).toBe(fix.other);
    expect(discarded.state.discardPile).toContainEqual(rc('5', 'clubs'));
  });
});

// ─── Discard the drawn card directly ────────────────────────────────────────

describe('discard-drawn-card', () => {
  it('sends the drawn card straight to the discard pile and ends the turn', () => {
    const drawn = rc('A', 'hearts');
    const fix = makeFixture({ myHand: [rc('5', 'clubs')], topOfDeck: drawn });
    const drew = applyTurnAction(fix.state, fix.me, { type: 'draw-from-deck' });
    if (!drew.ok) return;
    const handBefore = drew.state.playerStates[fix.me].hand.length;
    const pileBefore = drew.state.discardPile.length;

    const tossed = applyTurnAction(drew.state, fix.me, { type: 'discard-drawn-card' });
    expect(tossed.ok).toBe(true);
    if (!tossed.ok) return;

    // Drawn card never entered hand
    expect(tossed.state.playerStates[fix.me].hand).toHaveLength(handBefore);
    expect(tossed.state.playerStates[fix.me].hand).not.toContainEqual(drawn);
    // Drawn card now sits on top of the discard pile
    expect(tossed.state.discardPile).toHaveLength(pileBefore + 1);
    expect(tossed.state.discardPile[tossed.state.discardPile.length - 1]).toEqual(drawn);
    // Turn ended
    expect(tossed.state.currentTurnPlayerId).toBe(fix.other);
    expect(tossed.state.turnPhase).toBe('awaiting-draw-or-take');
    expect(tossed.state.pendingDrawnCard).toBeUndefined();
  });
});

// ─── Other actions blocked while pending ─────────────────────────────────────

describe('blocked actions while pending', () => {
  it('rejects discard while pending', () => {
    const fix = makeFixture({ myHand: [rc('5', 'clubs')] });
    const drew = applyTurnAction(fix.state, fix.me, { type: 'draw-from-deck' });
    if (!drew.ok) return;

    const r = applyTurnAction(drew.state, fix.me, { type: 'discard', card: rc('5', 'clubs') });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Keep or Discard/i);
  });

  it('rejects go-down while pending', () => {
    const fix = makeFixture({
      myHand: [rc('A', 'spades'), rc('A', 'hearts'), rc('A', 'diamonds'), rc('5', 'clubs')],
    });
    const drew = applyTurnAction(fix.state, fix.me, { type: 'draw-from-deck' });
    if (!drew.ok) return;

    const r = applyTurnAction(drew.state, fix.me, {
      type: 'go-down',
      melds: [{ type: 'set', cards: [rc('A', 'spades'), rc('A', 'hearts'), rc('A', 'diamonds')] }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Keep or Discard/i);
  });

  it('rejects take-from-discard while pending', () => {
    const fix = makeFixture({
      myHand: [rc('5', 'clubs')],
      pile: [rc('K', 'spades'), rc('K', 'hearts')],
    });
    const drew = applyTurnAction(fix.state, fix.me, { type: 'draw-from-deck' });
    if (!drew.ok) return;

    const r = applyTurnAction(drew.state, fix.me, {
      type: 'take-from-discard',
      keepOnPileCard: rc('K', 'spades'),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Keep or Discard/i);
  });

  it('rejects another draw-from-deck while pending', () => {
    const fix = makeFixture({ myHand: [rc('5', 'clubs')] });
    const drew = applyTurnAction(fix.state, fix.me, { type: 'draw-from-deck' });
    if (!drew.ok) return;

    const r = applyTurnAction(drew.state, fix.me, { type: 'draw-from-deck' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Keep or Discard/i);
  });

  it('rejects keep-drawn-card / discard-drawn-card when there is no pending card', () => {
    // From plain awaiting-draw-or-take phase
    const fix = makeFixture({ myHand: [rc('5', 'clubs')] });
    const r1 = applyTurnAction(fix.state, fix.me, { type: 'keep-drawn-card' });
    expect(r1.ok).toBe(false);
    const r2 = applyTurnAction(fix.state, fix.me, { type: 'discard-drawn-card' });
    expect(r2.ok).toBe(false);
  });
});

// ─── take-from-discard does NOT use the pending flow ────────────────────────

describe('take-from-discard remains independent', () => {
  it('does not set pendingDrawnCard or change turnPhase to pending-drawn-decision', () => {
    const fix = makeFixture({
      myHand: [rc('5', 'clubs')],
      pile: [rc('K', 'spades'), rc('K', 'hearts')],
    });
    const r = applyTurnAction(fix.state, fix.me, {
      type: 'take-from-discard',
      keepOnPileCard: rc('K', 'spades'),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.state.pendingDrawnCard).toBeUndefined();
    expect(r.state.turnPhase).toBe('awaiting-draw-or-take'); // turn ended → next player's draw phase
    expect(r.state.currentTurnPlayerId).toBe(fix.other);
  });
});
