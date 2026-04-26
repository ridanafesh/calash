import { randomUUID } from 'crypto';
import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '@calash/shared';

import { roomStore } from '../../store/index.js';

type CalashSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type CalashServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/**
 * Allowlist of reactions the UI exposes. The server only accepts these
 * exact glyphs — anything else is silently dropped, so a misbehaving
 * client can't push arbitrary text through this channel.
 *
 * Keep in sync with the EmojiReactionButton on the frontend.
 */
const ALLOWED_EMOJIS: ReadonlySet<string> = new Set([
  '😀', '😂', '😡', '😢', '😎', '👍',
  '👎', '😮', '😴', '🔥', '💪', '👏',
]);

/**
 * Per-player cooldown in milliseconds. Reactions are fun, spam is not —
 * limit to one reaction every COOLDOWN_MS. Stored in memory only;
 * resets when the server restarts (acceptable — reactions are
 * already ephemeral by design).
 */
const COOLDOWN_MS = 2000;
const lastReactionAt = new Map<string, number>();

/**
 * Periodically prune entries older than COOLDOWN_MS so this map can't
 * grow unbounded across long-running server uptime. Cheap to scan; we
 * only run it occasionally.
 */
setInterval(() => {
  const cutoff = Date.now() - COOLDOWN_MS * 4;
  for (const [k, v] of lastReactionAt) {
    if (v < cutoff) lastReactionAt.delete(k);
  }
}, 60_000).unref?.();

/**
 * Handle a client → server reaction. Validates emoji + cooldown, then
 * broadcasts to every socket in the room (including the sender, so
 * their own UI confirms the reaction landed).
 */
export function handleReaction(
  socket: CalashSocket,
  io: CalashServer,
  emoji: string,
): void {
  const { playerId, roomId } = socket.data;
  if (!roomId) return; // not in a room — silently drop

  if (!ALLOWED_EMOJIS.has(emoji)) {
    // Drop unknown emoji silently — don't reply with an error so a
    // throttled / spamming client doesn't keep getting feedback.
    return;
  }

  const now = Date.now();
  const last = lastReactionAt.get(playerId) ?? 0;
  if (now - last < COOLDOWN_MS) {
    // Cooldown active. Silent drop — the client UI also gates this so
    // an honest client never hits the rate limit; only abusers do.
    return;
  }

  // Confirm the player is still in the room (the socket.data.roomId is
  // updated on join/leave but defense in depth — a stale cache could
  // otherwise broadcast into a room the player has left).
  const room = roomStore.get(roomId);
  if (!room || !room.players.some((p) => p.userId === playerId)) return;

  lastReactionAt.set(playerId, now);

  io.to(roomId).emit('room:reaction', {
    playerId,
    emoji,
    id: randomUUID(),
  });
}
