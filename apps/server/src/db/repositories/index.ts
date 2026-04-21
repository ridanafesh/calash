import type { Pool } from 'pg';

export { UserRepository } from './user.repository.js';
export { RoomRepository } from './room.repository.js';
export { RoundRepository } from './round.repository.js';
export { MeldRepository } from './meld.repository.js';
export { ScoreRepository } from './score.repository.js';
export { CommerceRepository } from './commerce.repository.js';

export type { UserRow, AuthAccountRow, PlayerProfileRow, UserWithProfile } from './user.repository.js';
export type { GameRoomRow, GameRoomPlayerRow, RoomWithPlayers } from './room.repository.js';
export type { GameRoundRow, RoundHandRow, GameMoveRow, RoundDiscardRow } from './round.repository.js';
export type { GameMeldRow, GameMeldCardRow } from './meld.repository.js';
export type { GameScoreRow, LeaderboardEntryRow, MatchHistoryRow } from './score.repository.js';
export type {
  ProductRow, ProductPriceRow, OrderRow, PaymentRow, InventoryItemRow,
  PurchaseHistoryRow, WalletRow, WalletTransactionRow,
} from './commerce.repository.js';

import { UserRepository } from './user.repository.js';
import { RoomRepository } from './room.repository.js';
import { RoundRepository } from './round.repository.js';
import { MeldRepository } from './meld.repository.js';
import { ScoreRepository } from './score.repository.js';
import { CommerceRepository } from './commerce.repository.js';

export interface DatabaseService {
  users: UserRepository;
  rooms: RoomRepository;
  rounds: RoundRepository;
  melds: MeldRepository;
  scores: ScoreRepository;
  commerce: CommerceRepository;
}

export function createDatabaseService(pool: Pool): DatabaseService {
  return {
    users:    new UserRepository(pool),
    rooms:    new RoomRepository(pool),
    rounds:   new RoundRepository(pool),
    melds:    new MeldRepository(pool),
    scores:   new ScoreRepository(pool),
    commerce: new CommerceRepository(pool),
  };
}
