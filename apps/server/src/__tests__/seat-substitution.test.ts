/**
 * Unit tests for the seat-substitution + reclaim helpers in
 * sockets/handlers/room.ts.
 *
 * The architectural invariant we test here: a seat keeps its user id
 * (the original human's) when it gets substituted with a bot. RoundState
 * keys everything by user id, so as long as the user id stays put,
 * meld ownership / hand / score / turn-state survive the flip
 * untouched and the round can continue without any state mutation.
 *
 * The integration of this with the actual round engine is also exercised
 * by the engine-level seat-substitution test in
 * packages/game-core/src/__tests__/seat-substitution.test.ts.
 */

import {
  substituteSeatWithBot,
  reclaimSeatFromBot,
} from '../sockets/handlers/room.js';
import type { PlayerSlot } from '../store/index.js';

function makeHumanSlot(overrides: Partial<PlayerSlot> = {}): PlayerSlot {
  return {
    userId: 'user-1',
    seatIndex: 0,
    isReady: true,
    socketId: 'socket-abc',
    displayName: 'Alice',
    isBot: false,
    ...overrides,
  };
}

describe('substituteSeatWithBot', () => {
  it('flips a human seat into bot mode, keeps the user id, clears socket', () => {
    const slot = makeHumanSlot();
    const flipped = substituteSeatWithBot(slot);
    expect(flipped).toBe(true);
    expect(slot.isBot).toBe(true);
    expect(slot.botDifficulty).toBe('easy');
    expect(slot.socketId).toBeNull();
    // Critical: the seat KEEPS its original user id. RoundState keys
    // by user id so the round continues without any mutation.
    expect(slot.userId).toBe('user-1');
    expect(slot.seatIndex).toBe(0);
    expect(slot.displayName).toBe('Alice');
  });

  it('preserves displayName so other players still see "Alice (bot)" not a generic name', () => {
    const slot = makeHumanSlot({ displayName: 'Alice' });
    substituteSeatWithBot(slot);
    expect(slot.displayName).toBe('Alice');
  });

  it('is idempotent: calling on an already-bot slot returns false and does nothing', () => {
    const slot: PlayerSlot = {
      userId: 'bot-7',
      seatIndex: 1,
      isReady: true,
      socketId: null,
      displayName: 'Easy Bot 1',
      isBot: true,
      botDifficulty: 'easy',
    };
    const flipped = substituteSeatWithBot(slot);
    expect(flipped).toBe(false);
    expect(slot.isBot).toBe(true);
    expect(slot.userId).toBe('bot-7');
  });

  it('honors a custom difficulty when provided', () => {
    const slot = makeHumanSlot();
    substituteSeatWithBot(slot, { difficulty: 'easy' });
    expect(slot.botDifficulty).toBe('easy');
  });
});

describe('reclaimSeatFromBot', () => {
  it('flips a bot-substituted seat back to human, reattaches the socket', () => {
    // Start as a human, substitute, then reclaim.
    const slot = makeHumanSlot();
    substituteSeatWithBot(slot);
    expect(slot.isBot).toBe(true);

    reclaimSeatFromBot(slot, 'socket-xyz', 'Alice');
    expect(slot.isBot).toBe(false);
    expect(slot.botDifficulty).toBeUndefined();
    expect(slot.socketId).toBe('socket-xyz');
    // user id and seat are preserved across the whole substitute → reclaim cycle.
    expect(slot.userId).toBe('user-1');
    expect(slot.seatIndex).toBe(0);
  });

  it('round-trip preserves seat identity for arbitrary user ids', () => {
    const slot = makeHumanSlot({ userId: 'uuid-deadbeef', seatIndex: 3, displayName: 'Bob' });
    substituteSeatWithBot(slot);
    reclaimSeatFromBot(slot, 'socket-new', 'Bob');
    expect(slot.userId).toBe('uuid-deadbeef');
    expect(slot.seatIndex).toBe(3);
    expect(slot.displayName).toBe('Bob');
    expect(slot.isBot).toBe(false);
  });
});

describe('reclaim clears isHumanSubstitute', () => {
  // Regression: an earlier bug left isHumanSubstitute = true after
  // reclaim. The result was that on the user's NEXT leave, the
  // mid-game-leave path saw slot.isBot === false (we flipped it
  // back) but isHumanSubstitute was already true — and worse, an
  // even earlier path actually skipped the substitute branch
  // entirely on the second leave. These tests pin the round-trip
  // contract: the reclaimed seat must look like a brand-new human
  // seat to the leave path.
  it('reclaim sets isHumanSubstitute back to false', () => {
    const slot = makeHumanSlot();
    substituteSeatWithBot(slot);
    slot.isHumanSubstitute = true; // leave-substitute would set this
    reclaimSeatFromBot(slot, 'socket-back', 'Alice');
    expect(slot.isHumanSubstitute).toBe(false);
  });

  it('substitute → reclaim → substitute again works', () => {
    const slot = makeHumanSlot();

    // Leave #1
    expect(substituteSeatWithBot(slot)).toBe(true);
    slot.isHumanSubstitute = true;
    expect(slot.isBot).toBe(true);
    expect(slot.isHumanSubstitute).toBe(true);

    // Rejoin
    reclaimSeatFromBot(slot, 'socket-1', 'Alice');
    expect(slot.isBot).toBe(false);
    expect(slot.isHumanSubstitute).toBe(false);

    // Leave #2 — must still work, was the original reported bug.
    expect(substituteSeatWithBot(slot)).toBe(true);
    slot.isHumanSubstitute = true;
    expect(slot.isBot).toBe(true);
    expect(slot.isHumanSubstitute).toBe(true);
  });
});

describe('seat-substitution → reclaim invariants', () => {
  it('seat count is preserved (the slot stays in any list it lives in)', () => {
    // A 4-player room: substitute one seat, the room still has 4 slots.
    const players: PlayerSlot[] = [
      makeHumanSlot({ userId: 'p1', seatIndex: 0 }),
      makeHumanSlot({ userId: 'p2', seatIndex: 1 }),
      makeHumanSlot({ userId: 'p3', seatIndex: 2 }),
      makeHumanSlot({ userId: 'p4', seatIndex: 3 }),
    ];
    substituteSeatWithBot(players[1]);
    expect(players).toHaveLength(4);
    expect(players.map((p) => p.userId)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(players[1].isBot).toBe(true);
    expect(players[1].userId).toBe('p2'); // seat keeps original id
  });

  it('reclaim preserves seat ordering — no re-seating', () => {
    const players: PlayerSlot[] = [
      makeHumanSlot({ userId: 'p1', seatIndex: 0 }),
      makeHumanSlot({ userId: 'p2', seatIndex: 1 }),
    ];
    substituteSeatWithBot(players[0]);
    reclaimSeatFromBot(players[0], 'socket-new', 'P1');
    expect(players[0].userId).toBe('p1');
    expect(players[0].seatIndex).toBe(0);
    expect(players[1].userId).toBe('p2');
    expect(players[1].seatIndex).toBe(1);
  });
});
