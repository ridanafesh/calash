import type { Pool } from 'pg';
import type { Card, TurnAction } from '@calash/shared';

// ─── Row types ────────────────────────────────────────────────────────────────

export interface GameRoundRow {
  id: string;
  room_id: string;
  round_number: number;
  dealer_user_id: string;
  turn_order_json: string[];           // array of user_ids
  status: 'dealing' | 'in_progress' | 'scoring' | 'finished';
  current_turn_user_id: string | null;
  turn_phase: 'awaiting_draw_or_take' | 'holding' | 'complete';
  did_take_from_discard: boolean;
  hidden_deck_json: Card[];
  discard_pile_json: Card[];
  highest_table_total: number;
  end_reason: 'player_finished' | 'deck_exhausted' | null;
  finisher_user_id: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

export interface RoundHandRow {
  id: string;
  round_id: string;
  user_id: string;
  cards_json: Card[];
  has_gone_down: boolean;
  table_total: number;
  updated_at: Date;
}

export interface GameMoveRow {
  id: string;
  round_id: string;
  user_id: string;
  move_number: number;
  action_type: string;
  action_json: TurnAction;
  hand_before_json: Card[];
  hand_after_json: Card[];
  created_at: Date;
}

export interface RoundDiscardRow {
  id: string;
  round_id: string;
  user_id: string;
  move_number: number;
  card_json: Card;
  pile_after_json: Card[];
  created_at: Date;
}

// ─── Repository ──────────────────────────────────────────────────────────────

export class RoundRepository {
  constructor(private readonly db: Pool) {}

  async findById(id: string): Promise<GameRoundRow | null> {
    const { rows } = await this.db.query<GameRoundRow>(
      'SELECT * FROM game_rounds WHERE id = $1',
      [id],
    );
    return rows[0] ?? null;
  }

  async findCurrentByRoom(roomId: string): Promise<GameRoundRow | null> {
    const { rows } = await this.db.query<GameRoundRow>(
      `SELECT * FROM game_rounds
       WHERE room_id = $1 AND status IN ('dealing', 'in_progress')
       ORDER BY round_number DESC
       LIMIT 1`,
      [roomId],
    );
    return rows[0] ?? null;
  }

  async findByRoom(roomId: string): Promise<GameRoundRow[]> {
    const { rows } = await this.db.query<GameRoundRow>(
      'SELECT * FROM game_rounds WHERE room_id = $1 ORDER BY round_number',
      [roomId],
    );
    return rows;
  }

  /**
   * Create a new round.  The hidden deck and dealt hands are written in the
   * same transaction so the state is always consistent.
   */
  async create(data: {
    roomId: string;
    roundNumber: number;
    dealerUserId: string;
    turnOrder: string[];
    firstTurnUserId: string;
    hiddenDeck: Card[];
    discardPile: Card[];
    hands: Array<{ userId: string; cards: Card[] }>;
  }): Promise<GameRoundRow> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query<GameRoundRow>(
        `INSERT INTO game_rounds (
           room_id, round_number, dealer_user_id, turn_order_json,
           status, current_turn_user_id, turn_phase,
           hidden_deck_json, discard_pile_json, started_at
         )
         VALUES ($1, $2, $3, $4, 'in_progress', $5, 'awaiting_draw_or_take', $6, $7, NOW())
         RETURNING *`,
        [
          data.roomId,
          data.roundNumber,
          data.dealerUserId,
          JSON.stringify(data.turnOrder),
          data.firstTurnUserId,
          JSON.stringify(data.hiddenDeck),
          JSON.stringify(data.discardPile),
        ],
      );

      const round = rows[0];

      for (const hand of data.hands) {
        await client.query(
          `INSERT INTO game_round_hands (round_id, user_id, cards_json)
           VALUES ($1, $2, $3)`,
          [round.id, hand.userId, JSON.stringify(hand.cards)],
        );
      }

      // Mark room as in_progress if not already
      await client.query(
        `UPDATE game_rooms
         SET status = 'in_progress', started_at = COALESCE(started_at, NOW())
         WHERE id = $1`,
        [data.roomId],
      );

      await client.query('COMMIT');
      return round;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Atomically apply a player's turn action.  Updates:
   * - game_rounds (deck, pile, turn state, highest_table_total)
   * - game_round_hands for the acting player
   * - game_moves log
   * - game_round_discards (if action is a discard)
   */
  async applyAction(data: {
    roundId: string;
    userId: string;
    action: TurnAction;
    handBefore: Card[];
    handAfter: Card[];
    newDeck?: Card[];
    newPile?: Card[];
    newTurnPhase?: GameRoundRow['turn_phase'];
    nextTurnUserId?: string;
    didTakeFromDiscard?: boolean;
    highestTableTotal?: number;
  }): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      // Get current move count for sequential move_number
      const { rows: countRows } = await client.query<{ count: string }>(
        'SELECT COUNT(*) FROM game_moves WHERE round_id = $1',
        [data.roundId],
      );
      const moveNumber = parseInt(countRows[0]?.count ?? '0', 10) + 1;

      // Log the move (immutable)
      await client.query(
        `INSERT INTO game_moves
           (round_id, user_id, move_number, action_type, action_json, hand_before_json, hand_after_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          data.roundId,
          data.userId,
          moveNumber,
          data.action.type.replace(/-/g, '_'),
          JSON.stringify(data.action),
          JSON.stringify(data.handBefore),
          JSON.stringify(data.handAfter),
        ],
      );

      // Update the round's deck/pile/turn state
      const roundUpdates: string[] = [];
      const roundValues: unknown[] = [data.roundId];
      let idx = 2;

      if (data.newDeck !== undefined) {
        roundUpdates.push(`hidden_deck_json = $${idx++}`);
        roundValues.push(JSON.stringify(data.newDeck));
      }
      if (data.newPile !== undefined) {
        roundUpdates.push(`discard_pile_json = $${idx++}`);
        roundValues.push(JSON.stringify(data.newPile));
      }
      if (data.newTurnPhase !== undefined) {
        roundUpdates.push(`turn_phase = $${idx++}`);
        roundValues.push(data.newTurnPhase);
      }
      if (data.nextTurnUserId !== undefined) {
        roundUpdates.push(`current_turn_user_id = $${idx++}`);
        roundValues.push(data.nextTurnUserId);
      }
      if (data.didTakeFromDiscard !== undefined) {
        roundUpdates.push(`did_take_from_discard = $${idx++}`);
        roundValues.push(data.didTakeFromDiscard);
      }
      if (data.highestTableTotal !== undefined) {
        roundUpdates.push(`highest_table_total = $${idx++}`);
        roundValues.push(data.highestTableTotal);
      }

      if (roundUpdates.length > 0) {
        await client.query(
          `UPDATE game_rounds SET ${roundUpdates.join(', ')} WHERE id = $1`,
          roundValues,
        );
      }

      // Update the player's hand
      await client.query(
        `UPDATE game_round_hands SET cards_json = $1, updated_at = NOW()
         WHERE round_id = $2 AND user_id = $3`,
        [JSON.stringify(data.handAfter), data.roundId, data.userId],
      );

      // If the action was a discard, record it in the discard history
      if (data.action.type === 'discard' && data.newPile !== undefined) {
        await client.query(
          `INSERT INTO game_round_discards
             (round_id, user_id, move_number, card_json, pile_after_json)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            data.roundId,
            data.userId,
            moveNumber,
            JSON.stringify(data.action.card),
            JSON.stringify(data.newPile),
          ],
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async updateHand(
    roundId: string,
    userId: string,
    data: { cards?: Card[]; hasGoneDown?: boolean; tableTotal?: number },
  ): Promise<void> {
    const fields: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let idx = 1;

    if (data.cards !== undefined) {
      fields.push(`cards_json = $${idx++}`);
      values.push(JSON.stringify(data.cards));
    }
    if (data.hasGoneDown !== undefined) {
      fields.push(`has_gone_down = $${idx++}`);
      values.push(data.hasGoneDown);
    }
    if (data.tableTotal !== undefined) {
      fields.push(`table_total = $${idx++}`);
      values.push(data.tableTotal);
    }

    values.push(roundId, userId);

    await this.db.query(
      `UPDATE game_round_hands SET ${fields.join(', ')}
       WHERE round_id = $${idx++} AND user_id = $${idx}`,
      values,
    );
  }

  async getHand(roundId: string, userId: string): Promise<RoundHandRow | null> {
    const { rows } = await this.db.query<RoundHandRow>(
      'SELECT * FROM game_round_hands WHERE round_id = $1 AND user_id = $2',
      [roundId, userId],
    );
    return rows[0] ?? null;
  }

  async getAllHands(roundId: string): Promise<RoundHandRow[]> {
    const { rows } = await this.db.query<RoundHandRow>(
      'SELECT * FROM game_round_hands WHERE round_id = $1',
      [roundId],
    );
    return rows;
  }

  async finishRound(data: {
    roundId: string;
    endReason: 'player_finished' | 'deck_exhausted';
    finisherUserId: string | null;
  }): Promise<void> {
    await this.db.query(
      `UPDATE game_rounds
       SET status = 'finished',
           end_reason = $2,
           finisher_user_id = $3,
           finished_at = NOW()
       WHERE id = $1`,
      [data.roundId, data.endReason, data.finisherUserId],
    );
  }

  async getMoves(roundId: string): Promise<GameMoveRow[]> {
    const { rows } = await this.db.query<GameMoveRow>(
      'SELECT * FROM game_moves WHERE round_id = $1 ORDER BY move_number',
      [roundId],
    );
    return rows;
  }
}
