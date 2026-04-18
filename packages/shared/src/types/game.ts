export type GameStatus = 'lobby' | 'starting' | 'in-progress' | 'finished' | 'abandoned';

export type CardSuit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type CardRank =
  | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10'
  | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  suit: CardSuit;
  rank: CardRank;
}

export interface GameRoom {
  id: string;
  hostPlayerId: string;
  status: GameStatus;
  maxPlayers: number;
  currentPlayers: string[];
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface GameState {
  roomId: string;
  round: number;
  currentTurnPlayerId: string;
  scores: Record<string, number>;
}

export interface GameResult {
  roomId: string;
  winnerId: string;
  finalScores: Record<string, number>;
  finishedAt: string;
}
