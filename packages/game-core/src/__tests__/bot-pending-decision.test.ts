/**
 * Regression tests for the bot driver's handling of the new
 * 'pending-drawn-decision' turn phase.
 *
 * Background: a missing DB enum value for 'pending_drawn_decision' caused
 * the persistence layer to throw on every bot draw, leaving the in-memory
 * state in 'awaiting-draw-or-take' (because we no longer mutate state
 * before persisting). The driver then re-fired forever every 1.2s.
 *
 * These tests cover the engine + bot decision side: the bot must always
 * produce a legal action when it lands in pending-drawn-decision, and the
 * action must successfully advance the state through the engine. (Server-
 * level circuit-breaker behavior lives in apps/server and isn't tested
 * here — its purpose is to bound recovery in the face of failures the
 * engine layer can't reproduce on its own.)
 */

import type { Card, PlayerRoundState, RegularCard, RoundState } from '@calash/shared';
import { applyTurnAction } from '../engine.js';
import { chooseEasyAction } from '../bot/easy.js';

const rc = (rank: RegularCard['rank'], suit: RegularCard['suit'], deckIndex: 0 | 1 = 0): RegularCard =>
  ({ rank, suit, isJoker: false, deckIndex });

function fixturePending(myHand: Card[], drawn: Card): RoundState {
  const me = 'bot1';
  const other = 'human1';
  const myPs: PlayerRoundState = {
    playerId: me, hand: [...myHand], melds: [], hasGoneDown: false, tableTotal: 0,
  };
  const otherPs: PlayerRoundState = {
    playerId: other, hand: [rc('7', 'spades')], melds: [], hasGoneDown: false, tableTotal: 0,
  };
  return {
    roundNumber: 1, dealerPlayerId: other, playerOrder: [me, other],
    currentTurnPlayerId: me, phase: 'in-progress',
    turnPhase: 'pending-drawn-decision',
    playerStates: { [me]: myPs, [other]: otherPs },
    hiddenDeck: [rc('2', 'clubs'), rc('3', 'clubs')],
    discardPile: [rc('5', 'spades')],
    highestTableTotal: 0,
    didTakeFromDiscardThisTurn: false,
    pendingDrawnCard: drawn,
  };
}

describe('Bot — pending-drawn-decision handling', () => {
  it('returns a legal keep-drawn-card or discard-drawn-card action (never something else)', () => {
    const cases: Array<{ label: string; hand: Card[]; drawn: Card }> = [
      { label: 'small hand keeps everything', hand: [rc('2', 'clubs'), rc('5', 'hearts')], drawn: rc('A', 'spades') },
      { label: 'pair partner triggers keep', hand: [rc('K', 'hearts'), rc('K', 'spades'), rc('5', 'clubs'), rc('9', 'diamonds')], drawn: rc('K', 'diamonds') },
      { label: 'no partner, large hand, low value → discard', hand: Array.from({ length: 14 }, (_, i) => rc('5', 'clubs', (i % 2) as 0 | 1)), drawn: rc('2', 'hearts') },
    ];
    for (const { label, hand, drawn } of cases) {
      const state = fixturePending(hand, drawn);
      const action = chooseEasyAction({ state, playerId: 'bot1', hand });
      expect(['keep-drawn-card', 'discard-drawn-card']).toContain(action.type);
      // It must be applyable.
      const r = applyTurnAction(state, 'bot1', action);
      expect(r.ok).toBe(true);
      // Either way, the bot is no longer stuck in pending-drawn-decision.
      if (r.ok) {
        expect(r.state.turnPhase).not.toBe('pending-drawn-decision');
        expect(r.state.pendingDrawnCard).toBeUndefined();
        void label;
      }
    }
  });

  it('keeps a joker when drawn (always useful)', () => {
    const state = fixturePending(
      [rc('2', 'clubs'), rc('5', 'hearts'), rc('9', 'diamonds')],
      { rank: 'JOKER', suit: null, isJoker: true, jokerIndex: 0 },
    );
    const action = chooseEasyAction({ state, playerId: 'bot1', hand: state.playerStates.bot1.hand });
    expect(action.type).toBe('keep-drawn-card');
  });

  it('a full draw → decide → discard cycle leaves the player off-turn', () => {
    // Start in awaiting-draw-or-take, run draw, then run the bot's decision,
    // then if needed run another action until the bot's turn ends. Verifies
    // there is no in-state path where the bot is stuck on its own turn.
    const me = 'bot1';
    const other = 'human1';
    const startState: RoundState = {
      roundNumber: 1, dealerPlayerId: other, playerOrder: [me, other],
      currentTurnPlayerId: me, phase: 'in-progress', turnPhase: 'awaiting-draw-or-take',
      playerStates: {
        [me]: { playerId: me, hand: [rc('2', 'clubs'), rc('K', 'hearts')], melds: [], hasGoneDown: false, tableTotal: 0 },
        [other]: { playerId: other, hand: [rc('7', 'spades')], melds: [], hasGoneDown: false, tableTotal: 0 },
      },
      hiddenDeck: [rc('5', 'clubs'), rc('9', 'diamonds')], // top = 9♦
      discardPile: [rc('A', 'spades')],
      highestTableTotal: 0, didTakeFromDiscardThisTurn: false,
    };

    let s: RoundState = startState;
    let steps = 0;
    const MAX_STEPS = 6; // generous: real cycle is at most 3 (draw → keep+discard, or draw → discard-drawn)
    while (s.currentTurnPlayerId === me && s.phase === 'in-progress' && steps < MAX_STEPS) {
      const action = chooseEasyAction({ state: s, playerId: me, hand: s.playerStates[me].hand });
      const r = applyTurnAction(s, me, action);
      expect(r.ok).toBe(true);
      if (!r.ok) break;
      s = r.state;
      steps++;
    }
    // The bot's turn must have ended (or the round ended), not exceeded the cap.
    expect(steps).toBeLessThan(MAX_STEPS);
    if (s.phase === 'in-progress') {
      expect(s.currentTurnPlayerId).toBe(other);
    }
  });
});
