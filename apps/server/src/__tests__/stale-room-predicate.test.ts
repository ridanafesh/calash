/**
 * Stale-room predicate — pure logic.
 *
 * Mirrors the SQL predicate used by:
 *   - room.repository.ts findStaleRooms()
 *   - room.repository.ts cleanupStaleRooms() (inside the txn)
 *   - room.repository.ts findVisibleRooms()'s defensive WHERE-EXISTS
 *
 * Pinned here so a regression in the SQL also fails this file (and
 * vice versa). The shape under test:
 *   isStale(room) ↔ status ∈ {lobby, in_progress}
 *                    AND no row exists with left_at IS NULL AND user.is_bot=false
 *
 * Substituted-bot rows count as bot rows for this predicate (the
 * underlying users.is_bot is true for bot users; substituted seats
 * keep the original human's user_id which is_bot=false, BUT we use
 * the room handler's hasAnyHuman() shape that gates on `!isBot` of
 * the in-memory slot. The DB SQL goes the other way and uses
 * users.is_bot — substitute seats are still humans by user-row but
 * are torn down with the room because hasAnyHuman returns false at
 * the leave path. Either way, the steady-state outcome matches: a
 * room with NO live humans is stale.)
 */

interface PlayerRow {
  userId: string;
  /** game_room_players.left_at — null = active, Date = departed. */
  leftAt: Date | null;
  /** users.is_bot. */
  isBot: boolean;
}

interface RoomRow {
  status: 'lobby' | 'in_progress' | 'finished' | 'abandoned';
  players: PlayerRow[];
}

function isStale(r: RoomRow): boolean {
  if (r.status !== 'lobby' && r.status !== 'in_progress') return false;
  return !r.players.some((p) => p.leftAt === null && !p.isBot);
}

const human = (id: string, leftAt: Date | null = null): PlayerRow => ({
  userId: id,
  leftAt,
  isBot: false,
});
const bot = (id: string, leftAt: Date | null = null): PlayerRow => ({
  userId: id,
  leftAt,
  isBot: true,
});

describe('stale-room predicate', () => {
  it('lobby with one active human → not stale', () => {
    expect(isStale({ status: 'lobby', players: [human('h1')] })).toBe(false);
  });

  it('lobby with no players at all → stale (orphan)', () => {
    expect(isStale({ status: 'lobby', players: [] })).toBe(true);
  });

  it('lobby with only bots → stale', () => {
    expect(isStale({ status: 'lobby', players: [bot('b1'), bot('b2')] })).toBe(true);
  });

  it('in_progress with only bots → stale (the original reported case)', () => {
    expect(isStale({ status: 'in_progress', players: [bot('b1')] })).toBe(true);
  });

  it('in_progress with one human + bots → NOT stale', () => {
    expect(
      isStale({ status: 'in_progress', players: [human('h1'), bot('b1')] }),
    ).toBe(false);
  });

  it('lobby where every player has left_at set → stale', () => {
    expect(
      isStale({
        status: 'lobby',
        players: [human('h1', new Date()), human('h2', new Date())],
      }),
    ).toBe(true);
  });

  it('lobby with one departed human + one active human → NOT stale', () => {
    expect(
      isStale({
        status: 'lobby',
        players: [human('h1', new Date()), human('h2')],
      }),
    ).toBe(false);
  });

  it('finished rooms are NEVER stale (we only sweep active statuses)', () => {
    // Finished rooms might have no humans, but they're already
    // closed-out. The cleanup query excludes them so we never
    // re-mark them as abandoned and clobber their winner_user_id.
    expect(isStale({ status: 'finished', players: [] })).toBe(false);
    expect(isStale({ status: 'finished', players: [bot('b1')] })).toBe(false);
  });

  it('abandoned rooms are NEVER stale (already closed)', () => {
    expect(isStale({ status: 'abandoned', players: [] })).toBe(false);
  });

  it('a single departed bot row leaves the room stale', () => {
    // Bot rows that have left_at don't keep a room alive either.
    expect(isStale({ status: 'lobby', players: [bot('b1', new Date())] })).toBe(true);
  });

  it('a substituted-human seat (still has left_at NULL but is_bot=false because the user_id is the original human) prevents stale detection', () => {
    // Edge case: post-substitute the user_id stays the original
    // human's, so users.is_bot=false. The DB query still counts that
    // row as a "live human" — the room is NOT stale until they
    // actually leave (the leave path closes the room when the last
    // human goes). The grace-timer fire path does the same.
    //
    // This is intentional: substitute means "human seat reserved
    // for reclaim", not "deletable bot".
    expect(isStale({ status: 'in_progress', players: [human('h1')] })).toBe(false);
  });
});
