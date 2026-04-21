import { Router } from 'express';

import { pool } from '../db/index.js';

const router = Router();

/**
 * GET /api/leaderboard?sort=wins|score|winrate&limit=50
 * Returns global leaderboard ordered by total score (default), wins, or win rate.
 * Public endpoint — no auth required.
 */
router.get('/leaderboard', async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query['limit'] as string) || 50));
    const sort = (req.query['sort'] as string) || 'score';

    const orderBy =
      sort === 'wins'
        ? 'le.games_won DESC, le.total_score DESC'
        : sort === 'winrate'
        ? 'win_rate DESC, le.games_played DESC'
        : 'le.total_score DESC, le.games_won DESC';

    const { rows } = await pool.query<{
      user_id: string; games_played: number; games_won: number;
      total_score: string; highest_round_score: number; updated_at: Date;
      display_name: string | null; avatar_url: string | null; username: string;
      win_rate: string;
    }>(
      `SELECT
         le.user_id,
         le.games_played,
         le.games_won,
         CAST(le.total_score AS INTEGER) AS total_score,
         le.highest_round_score,
         le.updated_at,
         pp.display_name,
         pp.avatar_url,
         u.username,
         CASE WHEN le.games_played > 0
              THEN ROUND(le.games_won::NUMERIC / le.games_played * 100, 1)
              ELSE 0
         END AS win_rate
       FROM leaderboard_entries le
       JOIN player_profiles pp ON pp.user_id = le.user_id
       JOIN users u ON u.id = le.user_id
       WHERE u.is_bot = false
       ORDER BY ${orderBy}
       LIMIT $1`,
      [limit],
    );

    const data = rows.map((r, i) => ({
      rank: i + 1,
      userId: r.user_id,
      displayName: r.display_name ?? r.username,
      avatarUrl: r.avatar_url,
      gamesPlayed: r.games_played,
      gamesWon: r.games_won,
      totalScore: Number(r.total_score),
      highestRoundScore: r.highest_round_score,
      winRate: Number(r.win_rate),
      updatedAt: r.updated_at,
    }));

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

export default router;
