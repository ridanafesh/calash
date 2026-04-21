export type PlayerStatus = 'waiting' | 'ready' | 'in-game' | 'disconnected';

export interface Player {
  id: string;
  username: string;
  avatarUrl?: string;
  status: PlayerStatus;
  createdAt: string;
}

export interface PlayerSession {
  playerId: string;
  sessionToken: string;
  expiresAt: string;
}
