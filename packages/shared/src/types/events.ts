import type { GameRoom } from './game.js';
import type { RoundStateView, RoundResult, GameScore } from './round.js';
import type { TurnAction } from './actions.js';

// ─── Socket.IO typed event maps ───────────────────────────────────────────────
//
// These interfaces are the ONLY place where game-domain types touch the
// transport layer.  Game-core validation logic never imports from this file.

/** Options accepted by the `room:create` event. */
export interface RoomCreateOptions {
  maxPlayers: number;
  /**
   * If true, the room is created and immediately filled with bots up to
   * maxPlayers, all bots are auto-readied, and the game starts as soon
   * as the host marks ready.  Used for "Play vs Computer" single-player.
   */
  fillWithBots?: boolean;
  /**
   * Difficulty for any bots added at creation time and any bots added
   * later via `room:add-bot` from this host.  Defaults to 'easy'.
   */
  botDifficulty?: import('./game.js').BotDifficulty;
}

/** Events the client sends to the server. */
export interface ClientToServerEvents {
  'room:create': (options: RoomCreateOptions) => void;
  /** Join by UUID room ID (for links / REST lookup). */
  'room:join': (roomId: string) => void;
  /** Join by 6-character invite code. */
  'room:join-by-code': (code: string) => void;
  'room:leave': () => void;
  /** Toggle the calling player's ready state. */
  'room:ready': () => void;
  /**
   * Host-only: add a single bot to the current room. Server rejects if the
   * caller is not the host, the room is full, or the game has already started.
   */
  'room:add-bot': (options?: { difficulty?: import('./game.js').BotDifficulty }) => void;
  /**
   * Host-only: remove a bot from the current room (by userId). Cannot remove
   * humans this way; humans must leave themselves.
   */
  'room:remove-bot': (botUserId: string) => void;

  /**
   * Submit a turn action.  The server validates the action with game-core
   * and either applies it or responds with 'room:error'.
   */
  'game:action': (action: TurnAction) => void;

  /**
   * Send an emoji reaction to the room. The server enforces a per-player
   * cooldown (configurable, currently ~2s) and re-broadcasts to all
   * players in the room (including the sender) as 'room:reaction'.
   * Reactions are ephemeral — the server does not persist them.
   *
   * `emoji` is a single user-visible character/sequence such as '😂'.
   * The server validates it against an allowlist and silently drops
   * anything else, so a misbehaving client can't push arbitrary text
   * through this channel.
   */
  'room:reaction': (emoji: string) => void;
}

/** Events the server broadcasts to clients. */
export interface ServerToClientEvents {
  'room:updated': (room: GameRoom) => void;
  /**
   * General-purpose error broadcast.
   *
   * `candidates` and `meldIndex` are populated only for the
   * `AMBIGUOUS_JOKER_ASSIGNMENT` code, telling the UI which meld in the
   * pending action needs disambiguation and what choices to offer.
   */
  'room:error': (error: {
    code: string;
    message: string;
    candidates?: import('./game.js').JokerAssignment[];
    meldIndex?: number;
  }) => void;

  /** Sent to each player privately with their current hand. */
  'game:hand': (hand: import('./game.js').Card[]) => void;

  /**
   * PRIVATE — sent only to the player who just drew from the hidden deck,
   * carrying the actual drawn card so they can decide Keep or Discard.
   * `null` means the pending state has cleared (decision made or turn
   * advanced) so the client can hide the preview.
   *
   * Opponents NEVER see this event. They only see a public hint via
   * RoundStateView.pendingDrawnCardPresent.
   */
  'game:drawn-card': (card: import('./game.js').Card | null) => void;

  /** Public round state (no hidden deck, no other players' hands, no
   *  drawn-card identity). */
  'game:state': (state: RoundStateView) => void;

  'game:round-result': (result: RoundResult) => void;
  'game:scores': (scores: GameScore[]) => void;
  'game:finished': (winner: { playerId: string; finalScore: number }) => void;

  /**
   * Ephemeral emoji reaction broadcast. Sent to every socket in the
   * room (including the original sender, so their own UI can confirm
   * the reaction landed). Carries the emoji + the sending player so
   * the client can render a temporary bubble next to that player's
   * seat. `id` is a server-generated nonce so React keys stay stable
   * if the same player fires the same emoji twice in a row — without
   * it, the bubble wouldn't re-trigger its fade animation.
   */
  'room:reaction': (event: {
    playerId: string;
    emoji: string;
    id: string;
  }) => void;
}

/** Events used between server instances (reserved for future horizontal scaling). */
export interface InterServerEvents {
  ping: () => void;
}

/** Data stored per socket connection on the server. */
export interface SocketData {
  playerId: string;
  displayName: string;
  roomId?: string;
}
