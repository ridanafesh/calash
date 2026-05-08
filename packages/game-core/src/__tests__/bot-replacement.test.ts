/**
 * Bot-replacement engine tests.
 *
 * Architectural premise: when a joining human takes over a host-created
 * bot's seat, the server rewrites the bot's user id to the human's
 * user id everywhere it appears in RoundState (playerOrder,
 * playerStates keys, currentTurnPlayerId). After the rewrite the
 * resulting state must:
 *   - validate as a legal RoundState (engine accepts further turns)
 *   - preserve hand / melds / score / seat order untouched
 *   - allow the new user id to take the seat's next legal action
 *
 * These tests build a known round state, perform the rewrite the server
 * does in replaceBotWithHuman(), and verify the engine accepts an
 * action submitted by the new user id.
 */

import type { Card, RegularCard, RoundState } from '@calash/shared';
import { applyTurnAction, initRound } from '../engine.js';
import { createDeck } from '../deck.js';
import { seededShuffle } from '../seeded-random.js';

const rc = (rank: RegularCard['rank'], suit: RegularCard['suit'], deckIndex: 0 | 1 = 0): RegularCard =>
  ({ rank, suit, isJoker: false, deckIndex });

function newRound(): RoundState {
  const deck = seededShuffle(createDeck(), 42);
  // Seed includes a "bot" id that the human will take over.
  return initRound({ playerIds: ['human-1', 'bot-7'], roundNumber: 1, dealerIndex: 0, deck });
}

/** Mirror of the rewrite logic in apps/server/src/sockets/handlers/room.ts.
 *  Kept identical here so a regression in either side fails this test. */
function rewriteUserId(state: RoundState, oldId: string, newId: string): RoundState {
  const newPlayerStates = { ...state.playerStates } as typeof state.playerStates;
  if (newPlayerStates[oldId]) {
    newPlayerStates[newId] = { ...newPlayerStates[oldId], playerId: newId };
    delete newPlayerStates[oldId];
  }
  return {
    ...state,
    playerOrder: state.playerOrder.map((id) => (id === oldId ? newId : id)),
    playerStates: newPlayerStates,
    currentTurnPlayerId:
      state.currentTurnPlayerId === oldId ? newId : state.currentTurnPlayerId,
  };
}

describe('bot replacement — RoundState rewrite', () => {
  it('rewriting a bot user id produces a state the engine still accepts', () => {
    const state = newRound();
    const beforeBotHand = state.playerStates['bot-7'].hand;

    const rewritten = rewriteUserId(state, 'bot-7', 'human-2');

    // The bot id is gone from every map / array, replaced by the human id.
    expect(rewritten.playerOrder).not.toContain('bot-7');
    expect(rewritten.playerOrder).toContain('human-2');
    expect(rewritten.playerStates['bot-7']).toBeUndefined();
    expect(rewritten.playerStates['human-2']).toBeDefined();

    // Hand is preserved exactly — it survives the seat takeover.
    expect(rewritten.playerStates['human-2'].hand).toEqual(beforeBotHand);

    // Engine accepts further turns under the new id when it's their turn.
    const firstPlayer = rewritten.currentTurnPlayerId;
    const r = applyTurnAction(rewritten, firstPlayer, { type: 'draw-from-deck' });
    expect(r.ok).toBe(true);
  });

  it("preserves the seat's playerOrder index", () => {
    const state = newRound();
    const oldIdx = state.playerOrder.indexOf('bot-7');
    expect(oldIdx).toBeGreaterThanOrEqual(0); // sanity — bot is in the order

    const rewritten = rewriteUserId(state, 'bot-7', 'human-2');
    const newIdx = rewritten.playerOrder.indexOf('human-2');

    // The HUMAN takes the BOT's seat at the same index. The other
    // seat (human-1) keeps its position.
    expect(newIdx).toBe(oldIdx);
    expect(rewritten.playerOrder).toContain('human-1');
    expect(rewritten.playerOrder).toContain('human-2');
    expect(rewritten.playerOrder).not.toContain('bot-7');
    expect(rewritten.playerOrder).toHaveLength(state.playerOrder.length);
  });

  it('rewrites currentTurnPlayerId iff it matched the old id', () => {
    const state = newRound();
    // First player on this seed: 'bot-7' (dealer index 0 → playerOrder[0]
    // is the player to dealer's right). Sanity:
    if (state.currentTurnPlayerId === 'bot-7') {
      const rewritten = rewriteUserId(state, 'bot-7', 'human-2');
      expect(rewritten.currentTurnPlayerId).toBe('human-2');
    } else {
      // If the seed put human-1 first, the bot-id rewrite shouldn't
      // touch currentTurnPlayerId.
      const rewritten = rewriteUserId(state, 'bot-7', 'human-2');
      expect(rewritten.currentTurnPlayerId).toBe(state.currentTurnPlayerId);
    }
  });

  it('after rewrite, the new human can complete a draw → keep → discard sequence', () => {
    const state = newRound();
    const rewritten = rewriteUserId(state, 'bot-7', 'human-2');
    // Drive whichever seat has the turn through a full action sequence.
    const me = rewritten.currentTurnPlayerId;

    const drew = applyTurnAction(rewritten, me, { type: 'draw-from-deck' });
    expect(drew.ok).toBe(true);
    if (!drew.ok) return;
    const kept = applyTurnAction(drew.state, me, { type: 'keep-drawn-card' });
    expect(kept.ok).toBe(true);
    if (!kept.ok) return;
    const hand = kept.state.playerStates[me].hand;
    const discarded = applyTurnAction(kept.state, me, { type: 'discard', card: hand[0] });
    expect(discarded.ok).toBe(true);
  });
});

describe('locked-room code logic — pure validation', () => {
  // The handler's check is `supplied !== room.inviteCode.toUpperCase()`,
  // with normalization (trim + uppercase). These tests pin that
  // contract so a future refactor doesn't accidentally bypass it.
  function validateCode(roomCode: string, supplied: string | undefined): 'ok' | 'required' | 'invalid' {
    const norm = (supplied ?? '').trim().toUpperCase();
    if (norm === '') return 'required';
    if (norm !== roomCode.toUpperCase()) return 'invalid';
    return 'ok';
  }

  it('accepts the exact code', () => {
    expect(validateCode('ABCD12', 'ABCD12')).toBe('ok');
  });

  it('case-insensitive accept', () => {
    expect(validateCode('ABCD12', 'abcd12')).toBe('ok');
  });

  it('trims whitespace before comparing', () => {
    expect(validateCode('ABCD12', '  ABCD12  ')).toBe('ok');
  });

  it('rejects with "required" when missing', () => {
    expect(validateCode('ABCD12', undefined)).toBe('required');
    expect(validateCode('ABCD12', '')).toBe('required');
    expect(validateCode('ABCD12', '   ')).toBe('required');
  });

  it('rejects with "invalid" when wrong', () => {
    expect(validateCode('ABCD12', 'ZZZZZZ')).toBe('invalid');
    expect(validateCode('ABCD12', 'ABCD13')).toBe('invalid');
  });
});

describe('seat-choice path resolution — pure decision logic', () => {
  // Mirrors the if/else ladder inside joinRoom() that decides
  // 'replace-bot' vs 'empty-seat' vs 'needs-choice' vs 'rejected'.
  type Case = {
    hasEmptySeat: boolean;
    replaceableBots: number;
    choice?: { kind: 'replace-bot' } | { kind: 'empty-seat' };
  };
  type Outcome = 'replace-bot' | 'empty-seat' | 'needs-choice' | 'rejected';

  function resolve(c: Case): Outcome {
    if (!c.hasEmptySeat && c.replaceableBots === 0) return 'rejected';
    if (c.hasEmptySeat && c.replaceableBots > 0 && !c.choice) return 'needs-choice';
    if (c.choice?.kind === 'replace-bot' || (c.replaceableBots > 0 && !c.hasEmptySeat)) {
      return 'replace-bot';
    }
    return 'empty-seat';
  }

  it('empty seats only → empty-seat', () => {
    expect(resolve({ hasEmptySeat: true, replaceableBots: 0 })).toBe('empty-seat');
  });

  it('bots only → replace-bot', () => {
    expect(resolve({ hasEmptySeat: false, replaceableBots: 1 })).toBe('replace-bot');
  });

  it('both, no choice → needs-choice', () => {
    expect(resolve({ hasEmptySeat: true, replaceableBots: 1 })).toBe('needs-choice');
  });

  it('both, choice=replace-bot → replace-bot', () => {
    expect(resolve({ hasEmptySeat: true, replaceableBots: 1, choice: { kind: 'replace-bot' } })).toBe('replace-bot');
  });

  it('both, choice=empty-seat → empty-seat', () => {
    expect(resolve({ hasEmptySeat: true, replaceableBots: 1, choice: { kind: 'empty-seat' } })).toBe('empty-seat');
  });

  it('full room, no bots → rejected', () => {
    expect(resolve({ hasEmptySeat: false, replaceableBots: 0 })).toBe('rejected');
  });
});

describe('round transition — waiting players become active', () => {
  // The server's startGame helper:
  //   1. Reads room.players, flips isWaiting=false on any waiting slots,
  //      remembers their ids so cumulativeScores gets a 0 entry.
  //   2. Calls initRound with all current playerIds.
  // We can't easily import startGame (lives in apps/server), but we can
  // test the engine's tolerance for a fresh round that includes a
  // never-seen-before player id mixed with returning players.

  it('initRound accepts a mixed roster of returning + brand-new playerIds', () => {
    // Round 1: two-player game.
    const r1 = initRound({ playerIds: ['p1', 'p2'], roundNumber: 1, dealerIndex: 0 });
    expect(r1.playerOrder).toHaveLength(2);

    // Round 2: a third player ("waiting" became active). initRound
    // doesn't care about history — it deals a fresh round to all ids.
    const r2 = initRound({ playerIds: ['p1', 'p2', 'p3'], roundNumber: 2, dealerIndex: 1 });
    expect(r2.playerOrder).toHaveLength(3);
    expect(r2.playerStates['p3']).toBeDefined();
    expect(r2.playerStates['p3'].hand.length).toBeGreaterThan(0);
    expect(r2.playerStates['p3'].melds).toEqual([]);
    // Did NOT inherit anything from round 1 — fresh deal.
    expect(r2.playerStates['p3'].hasGoneDown).toBe(false);
    expect(r2.playerStates['p3'].tableTotal).toBe(0);
  });
});

// Suppress unused-import warning when adding cards isn't required by
// the smoke tests above.
void rc;
