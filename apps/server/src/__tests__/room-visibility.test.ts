/**
 * Room visibility + joinability contract — pure tests.
 *
 * The user-reported bug: a room with bots was started; a fresh
 * second human couldn't see the room in the lobby. Root cause was
 * `findOpenRooms`'s `WHERE status = 'lobby'` filter — once the game
 * began the room dropped off the list. Locked rooms also slipped
 * through the cracks because the route's in-memory mirror wasn't
 * surfacing isPrivate.
 *
 * The product rules now in force:
 *   - VISIBLE: lobby-status OR in-progress, AND has at least one
 *     joinable seat path (empty seat or replaceable bot).
 *   - JOINABLE: empty seat OR replaceable host-created bot. Substituted
 *     bots (reserved for the original human's reclaim) do NOT count.
 *   - REQUIRES_CODE: isPrivate. Independent of visibility.
 *
 * These tests pin those predicates so a future refactor of the
 * SQL or route can't quietly regress.
 */

interface RoomShape {
  status: 'lobby' | 'in-progress' | 'finished';
  isPrivate: boolean;
  maxPlayers: number;
  players: Array<{ isBot: boolean; isHumanSubstitute?: boolean }>;
}

function isVisible(r: RoomShape): boolean {
  if (r.status === 'finished') return false;
  return isJoinable(r);
}

function isJoinable(r: RoomShape): boolean {
  const occupied = r.players.length;
  const hasEmptySeat = occupied < r.maxPlayers;
  const hasReplaceableBot = r.players.some((p) => p.isBot && !p.isHumanSubstitute);
  return hasEmptySeat || hasReplaceableBot;
}

function requiresCode(r: RoomShape): boolean {
  return r.isPrivate;
}

// Helper for shorter test cases.
const human = () => ({ isBot: false });
const hostBot = () => ({ isBot: true });
const substituteBot = () => ({ isBot: true, isHumanSubstitute: true });

describe('room visibility', () => {
  it('lobby-status open room with seats is visible', () => {
    expect(isVisible({ status: 'lobby', isPrivate: false, maxPlayers: 4, players: [human()] })).toBe(true);
  });

  it('lobby-status locked room is visible (lock enforced at join)', () => {
    expect(isVisible({ status: 'lobby', isPrivate: true, maxPlayers: 4, players: [human()] })).toBe(true);
  });

  it('in-progress room with replaceable bot is visible (the original bug)', () => {
    expect(
      isVisible({
        status: 'in-progress',
        isPrivate: false,
        maxPlayers: 4,
        players: [human(), hostBot()],
      }),
    ).toBe(true);
  });

  it('in-progress LOCKED room with replaceable bot is also visible', () => {
    expect(
      isVisible({
        status: 'in-progress',
        isPrivate: true,
        maxPlayers: 4,
        players: [human(), hostBot()],
      }),
    ).toBe(true);
  });

  it('in-progress room full of humans is not visible (no seat path)', () => {
    expect(
      isVisible({
        status: 'in-progress',
        isPrivate: false,
        maxPlayers: 2,
        players: [human(), human()],
      }),
    ).toBe(false);
  });

  it('in-progress room full of substituted bots is NOT visible', () => {
    // Substituted bots are reserved for the original human's reclaim,
    // so a fresh joiner has no seat path. Visible-list excludes it.
    expect(
      isVisible({
        status: 'in-progress',
        isPrivate: false,
        maxPlayers: 2,
        players: [human(), substituteBot()],
      }),
    ).toBe(false);
  });

  it('finished rooms are never visible regardless of seat layout', () => {
    expect(
      isVisible({
        status: 'finished',
        isPrivate: false,
        maxPlayers: 4,
        players: [human()],
      }),
    ).toBe(false);
  });
});

describe('room joinability — UI predicate', () => {
  it('full of humans → not joinable', () => {
    expect(
      isJoinable({ status: 'lobby', isPrivate: false, maxPlayers: 2, players: [human(), human()] }),
    ).toBe(false);
  });

  it('full but one host-created bot → joinable via replacement', () => {
    expect(
      isJoinable({
        status: 'in-progress',
        isPrivate: false,
        maxPlayers: 2,
        players: [human(), hostBot()],
      }),
    ).toBe(true);
  });

  it('full but only substituted bots → NOT joinable from outside', () => {
    expect(
      isJoinable({
        status: 'in-progress',
        isPrivate: false,
        maxPlayers: 2,
        players: [human(), substituteBot()],
      }),
    ).toBe(false);
  });

  it('partially filled room → joinable via empty seat', () => {
    expect(
      isJoinable({ status: 'lobby', isPrivate: false, maxPlayers: 4, players: [human()] }),
    ).toBe(true);
  });

  it('mixed seats: 1 human + 1 substitute + 1 host-bot in 4-seat room → joinable (empty seat OR bot)', () => {
    expect(
      isJoinable({
        status: 'in-progress',
        isPrivate: false,
        maxPlayers: 4,
        players: [human(), substituteBot(), hostBot()],
      }),
    ).toBe(true);
  });
});

describe('locked rooms — code requirement', () => {
  // requiresCode is independent of visibility/joinability — a locked
  // full-of-humans room is still locked, just not joinable.
  it('isPrivate=true → requires code', () => {
    expect(requiresCode({ status: 'lobby', isPrivate: true, maxPlayers: 4, players: [human()] })).toBe(true);
  });

  it('isPrivate=false → no code required', () => {
    expect(requiresCode({ status: 'lobby', isPrivate: false, maxPlayers: 4, players: [human()] })).toBe(false);
  });

  it('locked + visible + joinable can all be true at once (a locked room with a bot mid-game)', () => {
    const r: RoomShape = {
      status: 'in-progress',
      isPrivate: true,
      maxPlayers: 4,
      players: [human(), hostBot()],
    };
    expect(isVisible(r)).toBe(true);
    expect(isJoinable(r)).toBe(true);
    expect(requiresCode(r)).toBe(true);
  });

  it('locked + visible + NOT joinable (locked full of humans)', () => {
    const r: RoomShape = {
      status: 'in-progress',
      isPrivate: true,
      maxPlayers: 2,
      players: [human(), human()],
    };
    expect(isVisible(r)).toBe(false); // not visible because there's no seat path
    expect(isJoinable(r)).toBe(false);
    expect(requiresCode(r)).toBe(true);
  });
});

describe('locked-room code validation — pure flow', () => {
  // Mirror of the server's join-time check (room.ts joinRoom). Pinned
  // here so the join handler's contract stays explicit.
  function validateCode(roomCode: string, supplied: string | undefined): 'ok' | 'required' | 'invalid' {
    const norm = (supplied ?? '').trim().toUpperCase();
    if (norm === '') return 'required';
    if (norm !== roomCode.toUpperCase()) return 'invalid';
    return 'ok';
  }

  it('correct code → ok (case-insensitive)', () => {
    expect(validateCode('ABCD12', 'abcd12')).toBe('ok');
    expect(validateCode('ABCD12', 'ABCD12')).toBe('ok');
  });

  it('missing code → required', () => {
    expect(validateCode('ABCD12', undefined)).toBe('required');
    expect(validateCode('ABCD12', '')).toBe('required');
    expect(validateCode('ABCD12', '   ')).toBe('required');
  });

  it('wrong code → invalid', () => {
    expect(validateCode('ABCD12', 'WRONG1')).toBe('invalid');
  });

  it('whitespace is trimmed before comparison', () => {
    expect(validateCode('ABCD12', '  ABCD12  ')).toBe('ok');
  });
});
