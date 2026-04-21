import type { Pool } from 'pg';
import type { Card, MeldType } from '@calash/shared';
import { totalCardValue } from '@calash/game-core';

// ─── Row types ────────────────────────────────────────────────────────────────

export interface GameMeldRow {
  id: string;
  round_id: string;
  owner_user_id: string;
  meld_type: MeldType;
  cards_json: Card[];
  total_value: number;
  created_at: Date;
  updated_at: Date;
}

export interface GameMeldCardRow {
  id: string;
  meld_id: string;
  round_id: string;
  position: number;
  card_rank: string;
  card_suit: string | null;
  is_joker: boolean;
  deck_index: number | null;
  joker_index: number | null;
  added_by_user_id: string;
  added_at: Date;
}

// ─── Repository ──────────────────────────────────────────────────────────────

export class MeldRepository {
  constructor(private readonly db: Pool) {}

  async findByRound(roundId: string): Promise<GameMeldRow[]> {
    const { rows } = await this.db.query<GameMeldRow>(
      'SELECT * FROM game_melds WHERE round_id = $1 ORDER BY created_at',
      [roundId],
    );
    return rows;
  }

  async findById(meldId: string): Promise<GameMeldRow | null> {
    const { rows } = await this.db.query<GameMeldRow>(
      'SELECT * FROM game_melds WHERE id = $1',
      [meldId],
    );
    return rows[0] ?? null;
  }

  async findByOwner(roundId: string, userId: string): Promise<GameMeldRow[]> {
    const { rows } = await this.db.query<GameMeldRow>(
      'SELECT * FROM game_melds WHERE round_id = $1 AND owner_user_id = $2 ORDER BY created_at',
      [roundId, userId],
    );
    return rows;
  }

  /**
   * Insert multiple melds in a single transaction (go-down action).
   * Also updates the player's hand, has_gone_down flag, and table_total.
   *
   * Each meld may specify an explicit `id` so that the DB primary key
   * matches the engine's in-memory meld id. The engine assigns UUIDs via
   * the id generator passed to applyTurnAction, so subsequent add-to-meld
   * lookups by that id find the correct DB row. When `id` is omitted the
   * column default (gen_random_uuid()) is used.
   */
  async createMelds(data: {
    roundId: string;
    ownerUserId: string;
    melds: Array<{ id?: string; type: MeldType; cards: Card[] }>;
    newHand: Card[];
    newTableTotal: number;
  }): Promise<GameMeldRow[]> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      const createdMelds: GameMeldRow[] = [];

      for (const meld of data.melds) {
        const value = totalCardValue(meld.cards);

        const { rows } = meld.id
          ? await client.query<GameMeldRow>(
              `INSERT INTO game_melds (id, round_id, owner_user_id, meld_type, cards_json, total_value)
               VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
              [meld.id, data.roundId, data.ownerUserId, meld.type, JSON.stringify(meld.cards), value],
            )
          : await client.query<GameMeldRow>(
              `INSERT INTO game_melds (round_id, owner_user_id, meld_type, cards_json, total_value)
               VALUES ($1, $2, $3, $4, $5) RETURNING *`,
              [data.roundId, data.ownerUserId, meld.type, JSON.stringify(meld.cards), value],
            );

        const created = rows[0];
        createdMelds.push(created);

        // Insert normalised card records
        await this.insertMeldCards(client, created.id, data.roundId, meld.cards, data.ownerUserId);
      }

      // Update hand state: mark as gone down, new hand, new table total
      await client.query(
        `UPDATE game_round_hands
         SET has_gone_down = TRUE, cards_json = $1, table_total = $2, updated_at = NOW()
         WHERE round_id = $3 AND user_id = $4`,
        [
          JSON.stringify(data.newHand),
          data.newTableTotal,
          data.roundId,
          data.ownerUserId,
        ],
      );

      await client.query('COMMIT');
      return createdMelds;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Add cards to an existing meld (add-to-meld action).
   * Updates both the denormalized cards_json + total_value on game_melds
   * and inserts individual card records into game_meld_cards.
   */
  async addCardsToMeld(data: {
    meldId: string;
    roundId: string;
    addedByUserId: string;
    newCards: Card[];
    newHand: Card[];
    newTableTotal: number;
  }): Promise<GameMeldRow> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      // Get current meld state
      const { rows: meldRows } = await client.query<GameMeldRow>(
        'SELECT * FROM game_melds WHERE id = $1 FOR UPDATE',
        [data.meldId],
      );
      if (!meldRows[0]) throw new Error(`Meld ${data.meldId} not found`);

      const currentMeld = meldRows[0];
      const updatedCards = [...currentMeld.cards_json, ...data.newCards];
      const updatedValue = totalCardValue(updatedCards);
      const startPosition = currentMeld.cards_json.length;

      const { rows: updatedRows } = await client.query<GameMeldRow>(
        `UPDATE game_melds
         SET cards_json = $1, total_value = $2, updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [JSON.stringify(updatedCards), updatedValue, data.meldId],
      );

      // Append new card records with correct positions
      await this.insertMeldCards(
        client,
        data.meldId,
        data.roundId,
        data.newCards,
        data.addedByUserId,
        startPosition,
      );

      // Update the acting player's hand and table total
      await client.query(
        `UPDATE game_round_hands
         SET cards_json = $1, table_total = $2, updated_at = NOW()
         WHERE round_id = $3 AND user_id = $4`,
        [JSON.stringify(data.newHand), data.newTableTotal, data.roundId, data.addedByUserId],
      );

      await client.query('COMMIT');
      return updatedRows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async insertMeldCards(
    client: { query: Pool['query'] },
    meldId: string,
    roundId: string,
    cards: Card[],
    addedByUserId: string,
    startPosition = 0,
  ): Promise<void> {
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      await client.query(
        `INSERT INTO game_meld_cards
           (meld_id, round_id, position, card_rank, card_suit, is_joker,
            deck_index, joker_index, added_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          meldId,
          roundId,
          startPosition + i,
          card.rank,
          card.isJoker ? null : card.suit,
          card.isJoker,
          card.isJoker ? null : card.deckIndex,
          card.isJoker ? card.jokerIndex : null,
          addedByUserId,
        ],
      );
    }
  }
}
