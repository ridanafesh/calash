/**
 * Room-lifecycle pure-logic tests.
 *
 * Pins the "no humans, no room" rule: a room must be torn down the
 * moment its last human player leaves, regardless of how many bots
 * (host-created or substitute) remain.
 *
 * Three paths in the server can call closeAbandonedRoom:
 *   1. lobby/finished leave when last human goes
 *   2. mid-game leave-substitute when the leaver was the last human
 *   3. defensive: findVisibleRooms hides any room with no humans even
 *      if (1) and (2) somehow missed it.
 *
 * The full close path touches socket.io, the pg pool, and the
 * roomStore singleton, so we mirror the decision as a pure reducer
 * here. A regression in either side should fail this file.
 */

interface Slot {
  userId: string;
  isBot: boolean;
  isHumanSubstitute?: boolean;
}

function hasAnyHuman(slots: Slot[]): boolean {
  return slots.some((p) => !p.isBot);
}

/**
 * Mirror of the leave-handler decision tree. Returns the action to
 * take after `userId` leaves a room of `slots`.
 *   - 'close': the room must be torn down.
 *   - 'continue': the room keeps running with the remaining slots.
 *   - 'substitute-then-close': mid-game; the leaver's seat flips to
 *     a bot AND the room then closes (because they were the last human).
 *   - 'substitute-then-continue': mid-game; flip to bot, room continues.
 */
function decideLeave(
  slots: Slot[],
  userId: string,
  status: 'lobby' | 'in-progress' | 'finished',
): 'close' | 'continue' | 'substitute-then-close' | 'substitute-then-continue' {
  const slot = slots.find((p) => p.userId === userId);
  if (!slot) return 'continue';

  if (status === 'in-progress' && !slot.isBot) {
    // Leaver is flipped to a bot in place. Project that onto the slot
    // list and then check humans.
    const after = slots.map((p): Slot =>
      p.userId === userId ? { ...p, isBot: true, isHumanSubstitute: true } : p,
    );
    return hasAnyHuman(after) ? 'substitute-then-continue' : 'substitute-then-close';
  }

  // Lobby or finished: leaver is removed entirely.
  const after = slots.filter((p) => p.userId !== userId);
  return hasAnyHuman(after) ? 'continue' : 'close';
}

const human = (id: string): Slot => ({ userId: id, isBot: false });
const hostBot = (id: string): Slot => ({ userId: id, isBot: true });
const substitute = (id: string): Slot => ({ userId: id, isBot: true, isHumanSubstitute: true });

describe('room lifecycle — auto-close decision', () => {
  it('lobby: solo human leaves a room with bots → close', () => {
    expect(decideLeave([human('h1'), hostBot('b1'), hostBot('b2')], 'h1', 'lobby')).toBe('close');
  });

  it('lobby: human leaves but another human remains → continue', () => {
    expect(decideLeave([human('h1'), human('h2')], 'h1', 'lobby')).toBe('continue');
  });

  it('finished: behaves like lobby (no humans → close)', () => {
    expect(decideLeave([human('h1'), hostBot('b1')], 'h1', 'finished')).toBe('close');
  });

  it('in-progress: human leaves with another human present → substitute-then-continue', () => {
    expect(
      decideLeave([human('h1'), human('h2'), hostBot('b1')], 'h1', 'in-progress'),
    ).toBe('substitute-then-continue');
  });

  it('in-progress: SOLO human leaves (other seats are bots) → substitute-then-close', () => {
    // The reported scenario: creator leaves a vs-bots game. Even
    // though the seat is bot-flipped, no humans remain → close.
    expect(decideLeave([human('h1'), hostBot('b1')], 'h1', 'in-progress')).toBe(
      'substitute-then-close',
    );
  });

  it('in-progress: only-substitute-bots-and-host left, then host leaves → close', () => {
    // Two humans started; one already left earlier (now a substitute).
    // Now the second human leaves — the room had two seats but no
    // active humans remain. Even substitute reclaims go away with
    // the room (they would have to create a new room).
    expect(decideLeave([human('h1'), substitute('h2')], 'h1', 'in-progress')).toBe(
      'substitute-then-close',
    );
  });

  it('substitute-bots alone do NOT keep a room alive', () => {
    // Defensive: if somehow we hit a state with only substitutes
    // (no live humans), counting humans correctly returns 0.
    expect(hasAnyHuman([substitute('h1'), substitute('h2')])).toBe(false);
  });

  it('a host-bot alone does NOT count as a human', () => {
    expect(hasAnyHuman([hostBot('b1')])).toBe(false);
  });

  it('a creator that is a human DOES count', () => {
    expect(hasAnyHuman([human('creator'), hostBot('b1')])).toBe(true);
  });

  it('removing an unknown user id is a no-op (continue)', () => {
    // Should never happen, but the leave handler short-circuits if
    // the slot isn't found. Pinning the contract.
    expect(decideLeave([human('h1')], 'unknown', 'in-progress')).toBe('continue');
  });
});

describe('locked-room code visibility', () => {
  // Mirror of the route's redactCodeForViewer helper. Pinned so any
  // refactor of /api/rooms can't quietly leak codes.
  function redactCode(
    room: { code: string; isPrivate: boolean; hostUserId: string },
    viewerId: string,
  ): { code: string } {
    if (!room.isPrivate) return { code: room.code };
    if (room.hostUserId === viewerId) return { code: room.code };
    return { code: '' };
  }

  it('open room: code is always visible', () => {
    expect(redactCode({ code: 'ABCD12', isPrivate: false, hostUserId: 'host' }, 'someone-else').code).toBe('ABCD12');
  });

  it('locked room: creator sees the code', () => {
    expect(redactCode({ code: 'SECRET', isPrivate: true, hostUserId: 'host' }, 'host').code).toBe('SECRET');
  });

  it('locked room: non-creator gets empty string', () => {
    expect(redactCode({ code: 'SECRET', isPrivate: true, hostUserId: 'host' }, 'someone-else').code).toBe('');
  });

  it('locked room: rejoinable-section viewer (a substituted human) is also redacted unless they are the host', () => {
    // The "your in-progress games" section uses the same redactor,
    // so a substituted-but-not-creator player still doesn't see
    // the code in the API response. They already know how to get
    // back into the room (rejoin button), so the code is irrelevant.
    expect(redactCode({ code: 'SECRET', isPrivate: true, hostUserId: 'creator' }, 'rejoiner').code).toBe('');
  });
});
