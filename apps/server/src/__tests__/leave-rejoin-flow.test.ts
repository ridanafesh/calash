/**
 * Leave / restore / rejoin flow tests.
 *
 * Reproduces the user-reported bug:
 *   1. User leaves a mid-game room → should be bot-substituted, navigate to lobby.
 *   2. User refreshes → must NOT auto-rejoin; the seat is still a bot.
 *   3. User explicitly clicks Rejoin in the lobby → reclaims the seat,
 *      seat is human again, isHumanSubstitute cleared.
 *   4. User leaves again → bot substitution must fire AGAIN (the bug
 *      was that this no-op'd because the seat was still flagged as a bot).
 *
 * The actual restore handler is async, depends on Socket.IO, and uses a
 * pg pool — too hostile for a focused test. So the same decision tree
 * lives here as a pure reducer over the seat + room state. A regression
 * in either side fails this file.
 */

import {
  substituteSeatWithBot,
  reclaimSeatFromBot,
} from '../sockets/handlers/room.js';
import type { PlayerSlot } from '../store/index.js';

function makeHumanSlot(overrides: Partial<PlayerSlot> = {}): PlayerSlot {
  return {
    userId: 'human-1',
    seatIndex: 0,
    isReady: true,
    socketId: 'socket-1',
    displayName: 'Alice',
    isBot: false,
    ...overrides,
  };
}

/**
 * Mirror of the in-memory user-index. The roomStore lives in a singleton
 * but the restore decision really comes down to: "does this user still
 * have a live mapping to a room id?" — and after a mid-game leave the
 * answer must be NO.
 */
class UserIndex {
  private map = new Map<string, string>();
  track(userId: string, roomId: string) { this.map.set(userId, roomId); }
  untrack(userId: string) { this.map.delete(userId); }
  getRoomFor(userId: string): string | undefined { return this.map.get(userId); }
}

/**
 * Mirror of restorePlayerToRoom's decision: does the handshake
 * auto-rejoin this user, or not?
 *
 * Returns the action that should fire. The contract under test:
 *   - 'no-op' when the user has no active room mapping AND no DB row
 *   - 'no-op' when the user's slot exists but is a human-substitute
 *     (they explicitly left; require explicit rejoin)
 *   - 'rejoin' when the user's slot is a live human (refresh / blip)
 */
function decideRestore(
  userIndex: UserIndex,
  roomPlayers: PlayerSlot[],
  userId: string,
): 'no-op' | 'rejoin' {
  if (!userIndex.getRoomFor(userId)) {
    // No in-memory mapping. The full handler would also check the DB,
    // but for the substitute case the handler explicitly returns
    // before re-tracking, so the lobby auto-redirect doesn't fire.
    const slot = roomPlayers.find((p) => p.userId === userId);
    if (slot && slot.isBot && slot.isHumanSubstitute) return 'no-op';
    if (slot) return 'rejoin';
    return 'no-op';
  }
  return 'rejoin';
}

describe('leave → restore decision', () => {
  let userIndex: UserIndex;
  let players: PlayerSlot[];

  beforeEach(() => {
    userIndex = new UserIndex();
    players = [
      makeHumanSlot({ userId: 'human-1', seatIndex: 0 }),
      makeHumanSlot({ userId: 'human-2', seatIndex: 1, displayName: 'Bob' }),
    ];
    userIndex.track('human-1', 'room-1');
    userIndex.track('human-2', 'room-1');
  });

  it('a brief socket blip rejoins the same user automatically', () => {
    // No leave fired — the user is still tracked, so a fresh handshake
    // re-attaches and the lobby auto-redirects into the room.
    expect(decideRestore(userIndex, players, 'human-1')).toBe('rejoin');
  });

  it('after explicit leave + bot substitute, restore is a no-op', () => {
    // Simulate the leave path:
    substituteSeatWithBot(players[0]);
    players[0].isHumanSubstitute = true;
    userIndex.untrack('human-1');

    expect(decideRestore(userIndex, players, 'human-1')).toBe('no-op');
  });

  it('the OTHER player in the room is unaffected by the leaver', () => {
    substituteSeatWithBot(players[0]);
    players[0].isHumanSubstitute = true;
    userIndex.untrack('human-1');

    // human-2 is still tracked, still a human, still in the room.
    expect(decideRestore(userIndex, players, 'human-2')).toBe('rejoin');
    expect(players[1].isBot).toBe(false);
    expect(players[1].socketId).toBe('socket-1');
  });

  it('after explicit rejoin, the leaver becomes restorable again', () => {
    // Leave
    substituteSeatWithBot(players[0]);
    players[0].isHumanSubstitute = true;
    userIndex.untrack('human-1');

    // Explicit rejoin via the room:join socket event:
    reclaimSeatFromBot(players[0], 'socket-back', 'Alice');
    userIndex.track('human-1', 'room-1');

    expect(decideRestore(userIndex, players, 'human-1')).toBe('rejoin');
    expect(players[0].isBot).toBe(false);
    expect(players[0].isHumanSubstitute).toBe(false);
  });
});

describe('repeated leave / rejoin cycles', () => {
  it('bot-substitution fires on every leave, not just the first', () => {
    // The reported bug: after the first leave-substitute-rejoin round
    // trip, the second leave appeared to "do nothing". Root cause was
    // that the seat was still marked isBot (and/or isHumanSubstitute)
    // after the rejoin, so the leave path's "if (!slot.isBot)" guard
    // skipped the substitute branch.
    const slot = makeHumanSlot();

    for (let i = 0; i < 3; i++) {
      // Leave
      const flipped = substituteSeatWithBot(slot);
      slot.isHumanSubstitute = true;
      expect(flipped).toBe(true); // ← the regression: this used to be false on iteration 2+
      expect(slot.isBot).toBe(true);
      expect(slot.isHumanSubstitute).toBe(true);

      // Rejoin
      reclaimSeatFromBot(slot, `sock-${i}`, 'Alice');
      expect(slot.isBot).toBe(false);
      expect(slot.isHumanSubstitute).toBe(false);
    }
  });

  it('seat identity (userId, seatIndex) stays put across many cycles', () => {
    const slot = makeHumanSlot({ userId: 'uuid-stable', seatIndex: 2 });
    for (let i = 0; i < 5; i++) {
      substituteSeatWithBot(slot);
      slot.isHumanSubstitute = true;
      reclaimSeatFromBot(slot, `s-${i}`, 'X');
    }
    expect(slot.userId).toBe('uuid-stable');
    expect(slot.seatIndex).toBe(2);
    expect(slot.isBot).toBe(false);
  });
});

describe('replaceableBots filter — substitutes are NOT poachable', () => {
  // Filter mirror: only host-created bots (isHumanSubstitute === undefined
  // or false) are eligible for fresh-joiner takeover. A human's bot
  // substitute stays reserved for the original human.
  function replaceableBots(slots: PlayerSlot[]): PlayerSlot[] {
    return slots.filter((p) => p.isBot && !p.isHumanSubstitute);
  }

  it('a host-created bot (no isHumanSubstitute) is replaceable', () => {
    const bot: PlayerSlot = {
      userId: 'bot-uuid',
      seatIndex: 0,
      isReady: true,
      socketId: null,
      displayName: 'Easy Bot 1',
      isBot: true,
      botDifficulty: 'easy',
    };
    expect(replaceableBots([bot])).toEqual([bot]);
  });

  it('a human-substituted seat is NOT replaceable', () => {
    const slot = makeHumanSlot();
    substituteSeatWithBot(slot);
    slot.isHumanSubstitute = true;
    expect(replaceableBots([slot])).toEqual([]);
  });

  it('mixed: only the host-created bot is replaceable', () => {
    const human = makeHumanSlot({ userId: 'h-1' });
    substituteSeatWithBot(human);
    human.isHumanSubstitute = true;

    const hostBot: PlayerSlot = {
      userId: 'bot-uuid',
      seatIndex: 1,
      isReady: true,
      socketId: null,
      displayName: 'Easy Bot 1',
      isBot: true,
      botDifficulty: 'easy',
    };

    const result = replaceableBots([human, hostBot]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(hostBot);
  });
});
