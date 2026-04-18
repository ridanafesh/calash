import type { Card, GameRoom, GameState, GameResult } from './game.js';
import type { Player } from './player.js';

// Events emitted by the client to the server
export interface ClientToServerEvents {
  'room:create': (options: { maxPlayers: number }) => void;
  'room:join': (roomId: string) => void;
  'room:leave': () => void;
  'room:ready': () => void;
  'game:action': (action: GameAction) => void;
}

// Events emitted by the server to clients
export interface ServerToClientEvents {
  'room:updated': (room: GameRoom) => void;
  'room:error': (error: { code: string; message: string }) => void;
  'game:started': (state: GameState) => void;
  'game:state': (state: GameState) => void;
  'game:finished': (result: GameResult) => void;
  'player:joined': (player: Player) => void;
  'player:left': (playerId: string) => void;
}

// Events used between server instances (for future horizontal scaling)
export interface InterServerEvents {
  ping: () => void;
}

// Per-socket data attached server-side
export interface SocketData {
  playerId: string;
  roomId?: string;
}

export interface GameAction {
  type: 'play-card' | 'draw-card' | 'pass';
  card?: Card;
}
