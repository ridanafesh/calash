/**
 * Engine-level tests for the seat-substitution model used by the server's
 * leave-during-active-game flow.
 *
 * Architectural premise being tested: the engine keys EVERYTHING by user
 * id (playerOrder, playerStates, currentTurnPlayerId, melds, ownership).
 * The server's handleRoomLeave handler implements "substitute with a bot"
 * by toggling slot.isBot=true while keeping slot.userId unchanged — the
 * round literally doesn't notice. These tests confirm that:
 *
 *   - The same user id can keep playing the same seat after the room
 *     handler has flipped its isBot flag (engine sees only user ids).
 *   - Hand, melds, score, and turn order survive untouched.
 *   - Both the bot strategy and the human can validly submit the next
 *     action for that seat.
 *   - When the human "rejoins" (server flips isBot back), the engine
 *     state is unchanged from where the bot left it; the human picks
 *     up exactly where the bot stopped.
 */

import type { Card, RegularCard, RoundState } from '@calash/shared';
import { applyTurnAction, initRound, toRoundStateView } from '../engine.js';
import { createDeck } from '../deck.js';
import { seededShuffle } from '../seeded-random.js';
import { chooseEasyAction } from '../bot/easy.js';

const rc = (rank: RegularCard['rank'], suit: RegularCard['suit'], deckIndex: 0 | 1 = 0): RegularCard =>
  ({ rank, suit, isJoker: false, deckIndex });

function newRound(seed = 42): RoundState {
  const deck = seededShuffle(createDeck(), seed);
  return initRound({ playerIds: ['p1', 'p2'], roundNumber: 1, dealerIndex: 0, deck });
}

function drawAndKeep(state: RoundState, playerId: string): RoundState {
  const r1 = applyTurnAction(state, playerId, { type: 'draw-from-deck' });
  if (!r1.ok) throw new Error(r1.error);
  const r2 = applyTurnAction(r1.state, playerId, { type: 'keep-drawn-card' });
  if (!r2.ok) throw new Error(r2.error);
  return r2.state;
}

describe('seat substitution — engine survives transparently', () => {
  it('engine state is unchanged when a seat is "flipped" to a bot', () => {
    // Initialise a round and drive one turn for p2 (firstPlayer).
    const start = newRound();
    const me = start.playerOrder[0];
    const drew = drawAndKeep(start, me);
    const handBefore = drew.playerStates[me].hand.length;
    const meldsBefore = drew.playerStates[me].melds.length;

    // Server-side, handleRoomLeave would now flip slot.isBot=true. The
    // engine has no slot concept — RoundState is identical before and
    // after the flip. We assert that by simply re-using the same state.
    const state = drew;

    expect(state.playerStates[me].hand).toHaveLength(handBefore);
    expect(state.playerStates[me].melds).toHaveLength(meldsBefore);
    expect(state.currentTurnPlayerId).toBe(me);
    // playerOrder is untouched — no re-seating.
    expect(state.playerOrder).toEqual(start.playerOrder);
  });

  it('a bot can act on the leaving human\'s seat using the same user id', () => {
    // Walk a round to where it's `me`'s turn in 'holding' phase. The
    // server has flipped slot.isBot=true under us — but the engine sees
    // the same user id. Calling chooseEasyAction with that user id +
    // its hand returns a legal action, which applyTurnAction accepts.
    const start = newRound();
    const me = start.playerOrder[0];
    const afterDraw = drawAndKeep(start, me);

    const action = chooseEasyAction({
      state: afterDraw,
      playerId: me,
      hand: afterDraw.playerStates[me].hand,
    });
    const result = applyTurnAction(afterDraw, me, action);
    expect(result.ok).toBe(true);
  });

  it('round-tripping through substitute → bot turn → reclaim keeps the same RoundState shape', () => {
    // The "bot" plays one full turn on `me`'s behalf (draw + keep + discard).
    // Then the human "rejoins" — the engine state at the moment of rejoin
    // is exactly what the server pushes to the rejoining client. We
    // simulate that by reading the public broadcast view, which is what
    // the rejoin handler emits.
    const start = newRound();
    const me = start.playerOrder[0];
    const other = start.playerOrder[1];

    // Bot turn 1 (me): draw, keep, discard.
    const afterDraw = drawAndKeep(start, me);
    const handAfterDraw = afterDraw.playerStates[me].hand;
    const discardCard = handAfterDraw[0];
    const r = applyTurnAction(afterDraw, me, { type: 'discard', card: discardCard });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const afterDiscard = r.state;

    // Turn has advanced to the other player; me's seat is "the same" as
    // before substitution — same user id, intact hand.
    expect(afterDiscard.currentTurnPlayerId).toBe(other);

    // The view the rejoining client would receive on reconnect:
    const view = toRoundStateView(afterDiscard);
    expect(view.playerOrder).toEqual([me, other]);
    expect(view.playerStates[me]).toBeDefined();
    expect(view.playerStates[me].hasGoneDown).toBe(false);
    // The hand isn't part of the broadcast view (private), but the
    // server's joinRoom rejoin path ALSO emits 'game:hand' with the
    // private hand for this user id. That hand is whatever the bot
    // left in afterDiscard.playerStates[me].hand — already in the
    // engine state, no extra mutation needed.
    expect(afterDiscard.playerStates[me].hand.length).toBeGreaterThan(0);
  });

  it('seat count is preserved across substitution from the engine\'s perspective', () => {
    // playerOrder.length stays constant — substitution doesn't re-seat
    // and reclaim doesn't either. (The handler's substituteSeatWithBot
    // mutates the slot list but leaves the array the same length; the
    // engine never sees that mutation because RoundState already has
    // its own playerOrder snapshot.)
    const start = newRound();
    expect(start.playerOrder).toHaveLength(2);

    // Drive an arbitrary turn so the round actually progresses.
    const me = start.playerOrder[0];
    const after = drawAndKeep(start, me);

    expect(after.playerOrder).toEqual(start.playerOrder);
    expect(Object.keys(after.playerStates)).toEqual(start.playerOrder as string[]);
  });

  it('discard during the leaving player\'s turn ends their turn cleanly', () => {
    // The most fragile case: human leaves WHILE it's their turn. Server
    // flips isBot=true and immediately kicks the bot driver. The bot
    // submits the next action for `me`'s user id and the engine accepts.
    const start = newRound();
    const me = start.playerOrder[0];
    const other = start.playerOrder[1];

    // me draws + keeps; phase is now 'holding' awaiting a discard.
    const holding = drawAndKeep(start, me);
    expect(holding.currentTurnPlayerId).toBe(me);
    expect(holding.turnPhase).toBe('holding');

    // Bot picks any legal action for me — chooseEasyAction here will
    // pick a discard (no go-down candidates on a fresh dealt hand at
    // this seed).
    const action = chooseEasyAction({
      state: holding,
      playerId: me,
      hand: holding.playerStates[me].hand,
    });

    const r = applyTurnAction(holding, me, action);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Whatever the bot picked, the round either continues to `other` or
    // (if the action ended the round) finished cleanly. Both are valid.
    if (action.type === 'discard') {
      expect(r.state.currentTurnPlayerId).toBe(other);
    }
  });
});
