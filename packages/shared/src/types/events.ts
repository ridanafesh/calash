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
}

/** Events the server broadcasts to clients. */
export interface ServerToClientEvents {
  'room:updated': (room: GameRoom) => void;
  'room:error': (error: { code: string; message: string }) => void;

  /** Sent to each player privately with their current hand. */
  'game:hand': (hand: import('./game.js').Card[]) => void;

  /** Public round state (no hidden deck, no other players' hands). */
  'game:state': (state: RoundStateView) => void;

  'game:round-result': (result: RoundResult) => void;
  'game:scores': (scores: GameScore[]) => void;
  'game:finished': (winner: { playerId: string; finalScore: number }) => void;
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
