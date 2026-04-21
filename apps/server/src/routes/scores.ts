import { Router } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { pool } from '../db/index.js';

const router = Router();

/**
 * GET /api/scores/rooms/:roomId
 * Returns complete round-by-round score breakdown for a room.
 * Includes dealer per round, next dealer, finish bonus, and cumulative totals.
 */
router.get('/scores/rooms/:roomId', requireAuth, async (req, res, next) => {
  try {
    const { roomId } = req.params;

    const { rows: roomRows } = await pool.query<{
      id: string; status: string; invite_code: string | null;
      winner_user_id: string | null; winner_name: string | null; finished_at: Date | null;
    }>(
      `SELECT gr.id, gr.status, gr.invite_code, gr.winner_user_id, gr.finished_at,
              pp.display_name AS winner_name
       FROM game_rooms gr
       LEFT JOIN player_profiles pp ON pp.user_id = gr.winner_user_id
       WHERE gr.id = $1`,
      [roomId],
    );

    if (!roomRows[0]) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Room not found' } });
      return;
    }
    const roomRow = roomRows[0];

    // Finished rounds with dealer/finisher names and next-round dealer
    const { rows: roundRows } = await pool.query<{
      id: string; round_number: number;
      dealer_user_id: string; dealer_name: string | null;
      end_reason: string; finisher_user_id: string | null; finisher_name: string | null;
      next_dealer_user_id: string | null; next_dealer_name: string | null;
      finished_at: Date | null;
    }>(
      `SELECT
         r1.id, r1.round_number,
         r1.dealer_user_id,  pp_d.display_name  AS dealer_name,
         r1.end_reason,
         r1.finisher_user_id, pp_f.display_name AS finisher_name,
         r2.dealer_user_id   AS next_dealer_user_id,
         pp_nd.display_name  AS next_dealer_name,
         r1.finished_at
       FROM game_rounds r1
       LEFT JOIN player_profiles pp_d  ON pp_d.user_id  = r1.dealer_user_id
       LEFT JOIN player_profiles pp_f  ON pp_f.user_id  = r1.finisher_user_id
       LEFT JOIN game_rounds r2
              ON r2.room_id = r1.room_id
             AND r2.round_number = r1.round_number + 1
       LEFT JOIN player_profiles pp_nd ON pp_nd.user_id = r2.dealer_user_id
       WHERE r1.room_id = $1 AND r1.status = 'finished'
       ORDER BY r1.round_number ASC`,
      [roomId],
    );

    // All scores for this room with display names
    const { rows: scoreRows } = await pool.query<{
      id: string; round_id: string; user_id: string; display_name: string | null;
      table_total: number; hand_total: number; round_score: number;
      finish_bonus: number; final_score: number; cumulative_score_after: number;
    }>(
      `SELECT s.*, pp.display_name
       FROM game_scores s
       JOIN player_profiles pp ON pp.user_id = s.user_id
       WHERE s.room_id = $1
       ORDER BY s.round_id, s.final_score DESC`,
      [roomId],
    );

    // Group scores by round_id
    const byRound = new Map<string, typeof scoreRows>();
    for (const row of scoreRows) {
      const arr = byRound.get(row.round_id) ?? [];
      arr.push(row);
      byRound.set(row.round_id, arr);
    }

    const rounds = roundRows.map((r) => ({
      roundId: r.id,
      roundNumber: r.round_number,
      dealerId: r.dealer_user_id,
      dealerName: r.dealer_name,
      endReason: r.end_reason,
      finisherId: r.finisher_user_id,
      finisherName: r.finisher_name,
      nextDealerId: r.next_dealer_user_id,
      nextDealerName: r.next_dealer_name,
      finishedAt: r.finished_at,
      scores: (byRound.get(r.id) ?? []).map((s) => ({
        userId: s.user_id,
        displayName: s.display_name ?? s.user_id,
        tableTotal: s.table_total,
        handTotal: s.hand_total,
        roundScore: s.round_score,
        finishBonus: s.finish_bonus,
        finalScore: s.final_score,
        cumulativeAfter: s.cumulative_score_after,
      })),
    }));

    // Latest cumulative total per player
    const latestCumulative = new Map<string, { userId: string; displayName: string; total: number }>();
    for (const s of scoreRows) {
      latestCumulative.set(s.user_id, {
        userId: s.user_id,
        displayName: s.display_name ?? s.user_id,
        total: s.cumulative_score_after,
      });
    }
    const cumulative = [...latestCumulative.values()].sort((a, b) => b.total - a.total);

    res.json({
      success: true,
      data: {
        roomId: roomRow.id,
        status: roomRow.status,
        inviteCode: roomRow.invite_code,
        winnerId: roomRow.winner_user_id,
        winnerName: roomRow.winner_name,
        finishedAt: roomRow.finished_at,
        rounds,
        cumulative,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
