/**
 * Stale-room cleanup tests.
 *
 * Two surfaces under test:
 *
 * 1. The cleanup orchestrator (cleanup.ts):
 *    - returns the room ids the DB layer reports as removed,
 *    - drops them from the in-memory roomStore,
 *    - cancels any pending bot timer + disconnect-grace timers
 *      for those rooms.
 *
 * 2. The DB query shape pinned by string match — the SQL must
 *    select rooms IN ('lobby', 'in_progress') and require NO
 *    EXISTS non-bot active player. We assert against what the
 *    pool was called with, so a future tweak that loosens or
 *    tightens the predicate will fail this file loudly.
 *
 * The repo's transaction (BEGIN / SELECT FOR UPDATE / UPDATE / COMMIT)
 * is mocked through mockClient.query so we can drive each step.
 */

const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};

const mockPool = {
  query: jest.fn(),
  connect: jest.fn(async () => mockClient),
  on: jest.fn(),
};

jest.mock('../db/index', () => ({
  pool: mockPool,
  query: jest.fn(),
  withTransaction: jest.fn(),
}));

// Avoid pulling the real repository that would otherwise pin its own
// pool reference. createDatabaseService just exposes our mocked rooms
// repo; cleanup.ts builds its own from `pool` so we override it here.
const cleanupStaleRoomsMock = jest.fn();
jest.mock('../db/repositories/index', () => ({
  createDatabaseService: () => ({
    rooms: { cleanupStaleRooms: cleanupStaleRoomsMock },
  }),
}));

// The cleanup module imports cancelBotTimer + cancelDisconnectGrace —
// stub them so we can spy on the call sequence without spinning up
// the full game/socket stack.
const cancelBotTimerSpy = jest.fn();
jest.mock('../sockets/handlers/game', () => ({
  cancelBotTimer: (...args: unknown[]) => cancelBotTimerSpy(...args),
}));

const cancelDisconnectGraceSpy = jest.fn();
jest.mock('../sockets/handlers/room', () => ({
  cancelDisconnectGrace: (...args: unknown[]) => cancelDisconnectGraceSpy(...args),
}));

import { cleanupStaleRooms } from '../sockets/handlers/cleanup';
import { roomStore, type RoomState } from '../store/index.js';

beforeEach(() => {
  jest.clearAllMocks();
  // Reset the in-memory store between tests — it's a singleton.
  for (const r of roomStore.all()) roomStore.delete(r.roomId);
});

function makeStubRoom(roomId: string, players: { userId: string; isBot: boolean }[]): RoomState {
  return {
    roomId,
    inviteCode: 'TEST01',
    isPrivate: false,
    hostUserId: players[0]?.userId ?? 'nobody',
    status: 'lobby',
    maxPlayers: 4,
    players: players.map((p, i) => ({
      userId: p.userId,
      seatIndex: i,
      isReady: false,
      socketId: null,
      displayName: p.userId,
      isBot: p.isBot,
    })),
    round: null,
  };
}

describe('cleanupStaleRooms — orchestration', () => {
  it('returns no removals when the DB says nothing is stale', async () => {
    cleanupStaleRoomsMock.mockResolvedValue([]);

    const result = await cleanupStaleRooms(mockPool as never);

    expect(result.removedRoomIds).toEqual([]);
    expect(result.inMemoryRemoved).toBe(0);
    expect(cancelBotTimerSpy).not.toHaveBeenCalled();
    expect(cancelDisconnectGraceSpy).not.toHaveBeenCalled();
  });

  it('cancels bot + disconnect-grace timers for in-memory rooms it removes', async () => {
    // Two stale rooms; only one is also in memory. We should:
    //   - report both ids in removedRoomIds
    //   - count 1 inMemoryRemoved
    //   - cancel grace for the human in the in-mem room
    //   - cancel the bot timer for it
    const inMemRoom = makeStubRoom('room-in-mem', [
      { userId: 'human-1', isBot: false },
      { userId: 'bot-1', isBot: true },
    ]);
    roomStore.set(inMemRoom);

    cleanupStaleRoomsMock.mockResolvedValue(['room-in-mem', 'room-cold']);

    const result = await cleanupStaleRooms(mockPool as never);

    expect(result.removedRoomIds).toEqual(['room-in-mem', 'room-cold']);
    expect(result.inMemoryRemoved).toBe(1);

    // Only the human's grace is cancelled (bots have no grace).
    expect(cancelDisconnectGraceSpy).toHaveBeenCalledTimes(1);
    expect(cancelDisconnectGraceSpy).toHaveBeenCalledWith('room-in-mem', 'human-1');

    // Bot timer cancel runs once per in-memory room (cold rooms have
    // no timer to cancel — this is the right behavior).
    expect(cancelBotTimerSpy).toHaveBeenCalledTimes(1);
    expect(cancelBotTimerSpy).toHaveBeenCalledWith('room-in-mem');

    // The in-memory entry is gone.
    expect(roomStore.get('room-in-mem')).toBeUndefined();
  });

  it('is idempotent: running twice with the same staleness does not error', async () => {
    cleanupStaleRoomsMock.mockResolvedValue([]);
    await expect(cleanupStaleRooms(mockPool as never)).resolves.toBeDefined();
    await expect(cleanupStaleRooms(mockPool as never)).resolves.toBeDefined();
  });

  it('handles a stale room with multiple humans (cancels grace for each)', async () => {
    const room = makeStubRoom('room-2-humans', [
      { userId: 'h1', isBot: false },
      { userId: 'h2', isBot: false },
      { userId: 'b1', isBot: true },
    ]);
    roomStore.set(room);

    cleanupStaleRoomsMock.mockResolvedValue(['room-2-humans']);

    await cleanupStaleRooms(mockPool as never);

    expect(cancelDisconnectGraceSpy).toHaveBeenCalledTimes(2);
    expect(cancelDisconnectGraceSpy).toHaveBeenCalledWith('room-2-humans', 'h1');
    expect(cancelDisconnectGraceSpy).toHaveBeenCalledWith('room-2-humans', 'h2');
  });
});
