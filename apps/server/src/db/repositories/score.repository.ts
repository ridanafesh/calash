import type { Pool } from 'pg';

// ─── Row types ────────────────────────────────────────────────────────────────

export interface GameScoreRow {
  id: string;
  round_id: string;
  room_id: string;
  user_id: string;
  table_total: number;
  hand_total: number;
  round_score: number;
  finish_bonus: number;
  final_score: number;
  cumulative_score_after: number;
  created_at: Date;
}

export interface LeaderboardEntryRow {
  id: string;
  user_id: string;
  games_played: number;
  games_won: number;
  total_score: string; // BIGINT comes back as string from pg
  highest_round_score: number;
  updated_at: Date;
}

export interface MatchHistoryRow {
  id: string;
  room_id: string;
  winner_user_id: string | null;
  rounds_played: number;
  player_results: Array<{
    userId: string;
    finalScore: number;
    rank: number;
  }>;
  started_at: Date | null;
  finished_at: Date | null;
}

// ─── Repository ──────────────────────────────────────────────────────────────

export class ScoreRepository {
  constructor(private readonly db: Pool) {}

  async findByRound(roundId: string): Promise<GameScoreRow[]> {
    const { rows } = await this.db.query<GameScoreRow>(
      'SELECT * FROM game_scores WHERE round_id = $1 ORDER BY final_score DESC',
      [roundId],
    );
    return rows;
  }

  async findByRoom(roomId: string): Promise<GameScoreRow[]> {
    const { rows } = await this.db.query<GameScoreRow>(
      'SELECT * FROM game_scores WHERE room_id = $1 ORDER BY round_id, final_score DESC',
      [roomId],
    );
    return rows;
  }

  async getCumulativeScore(roomId: string, userId: string): Promise<number> {
    const { rows } = await this.db.query<{ cumulative_score_after: number }>(
      `SELECT cumulative_score_after
       FROM game_scores
       WHERE room_id = $1 AND user_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [roomId, userId],
    );
    return rows[0]?.cumulative_score_after ?? 0;
  }

  /**
   * Record end-of-round scores for all players.
   * Computes cumulative_score_after by looking up the player's last recorded
   * cumulative total and adding the new final_score.
   */
  async recordRoundScores(data: {
    roundId: string;
    roomId: string;
    scores: Array<{
      userId: string;
      tableTotal: number;
      handTotal: number;
      roundScore: number;
      finishBonus: number;
      finalScore: number;
    }>;
  }): Promise<GameScoreRow[]> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      const created: GameScoreRow[] = [];

      for (const s of data.scores) {
        // Get the player's previous cumulative total for this room
        const { rows: prevRows } = await client.query<{ cumulative_score_after: number }>(
          `SELECT cumulative_score_after
           FROM game_scores
           WHERE room_id = $1 AND user_id = $2
           ORDER BY created_at DESC
           LIMIT 1`,
          [data.roomId, s.userId],
        );
        const prevCumulative = prevRows[0]?.cumulative_score_after ?? 0;
        const cumulativeAfter = prevCumulative + s.finalScore;

        const { rows } = await client.query<GameScoreRow>(
          `INSERT INTO game_scores
             (round_id, room_id, user_id,
              table_total, hand_total, round_score, finish_bonus,
              final_score, cumulative_score_after)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [
            data.roundId,
            data.roomId,
            s.userId,
            s.tableTotal,
            s.handTotal,
            s.roundScore,
            s.finishBonus,
            s.finalScore,
            cumulativeAfter,
          ],
        );
        created.push(rows[0]);
      }

      await client.query('COMMIT');
      return created;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Update leaderboard_entries for all players at the end of a game.
   */
  async updateLeaderboard(data: {
    winnerId: string | null;
    scores: Array<{ userId: string; finalScore: number }>;
  }): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      for (const { userId, finalScore } of data.scores) {
        const isWinner = userId === data.winnerId;
        await client.query(
          `INSERT INTO leaderboard_entries (user_id, games_played, games_won, total_score, highest_round_score)
           VALUES ($1, 1, $2, $3, $4)
           ON CONFLICT (user_id) DO UPDATE
             SET games_played        = leaderboard_entries.games_played + 1,
                 games_won           = leaderboard_entries.games_won + $2,
                 total_score         = leaderboard_entries.total_score + $3,
                 highest_round_score = GREATEST(leaderboard_entries.highest_round_score, $4),
                 updated_at          = NOW()`,
          [userId, isWinner ? 1 : 0, finalScore, finalScore],
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

  async getLeaderboard(limit = 50): Promise<LeaderboardEntryRow[]> {
    const { rows } = await this.db.query<LeaderboardEntryRow>(
      `SELECT * FROM leaderboard_entries ORDER BY total_score DESC LIMIT $1`,
      [limit],
    );
    return rows;
  }

  async getLeaderboardEntry(userId: string): Promise<LeaderboardEntryRow | null> {
    const { rows } = await this.db.query<LeaderboardEntryRow>(
      'SELECT * FROM leaderboard_entries WHERE user_id = $1',
      [userId],
    );
    return rows[0] ?? null;
  }

  async recordMatchHistory(data: {
    roomId: string;
    winnerId: string | null;
    roundsPlayed: number;
    playerResults: Array<{ userId: string; finalScore: number; rank: number }>;
  }): Promise<MatchHistoryRow> {
    const { rows } = await this.db.query<MatchHistoryRow>(
      `INSERT INTO match_history (room_id, winner_user_id, rounds_played, player_results)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (room_id) DO UPDATE
         SET winner_user_id = $2,
             rounds_played  = $3,
             player_results = $4,
             finished_at    = NOW()
       RETURNING *`,
      [data.roomId, data.winnerId, data.roundsPlayed, JSON.stringify(data.playerResults)],
    );
    return rows[0];
  }
}
