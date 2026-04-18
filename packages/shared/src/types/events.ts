import type { GameRoom } from './game.js';
import type { RoundStateView, RoundResult, GameScore } from './round.js';
import type { TurnAction } from './actions.js';

// ─── Socket.IO typed event maps ───────────────────────────────────────────────
//
// These interfaces are the ONLY place where game-domain types touch the
// transport layer.  Game-core validation logic never imports from this file.

/** Events the client sends to the server. */
export interface ClientToServerEvents {
  'room:create': (options: { maxPlayers: number }) => void;
  /** Join by UUID room ID (for links / REST lookup). */
  'room:join': (roomId: string) => void;
  /** Join by 6-character invite code. */
  'room:join-by-code': (code: string) => void;
  'room:leave': () => void;
  /** Toggle the calling player's ready state. */
  'room:ready': () => void;

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
