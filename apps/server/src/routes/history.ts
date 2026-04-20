import { Router } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { pool } from '../db/index.js';

const router = Router();

interface PlayerResult {
  userId: string;
  finalScore: number;
  rank: number;
}

// ─── GET /api/history ─────────────────────────────────────────────────────────
/**
 * Returns the authenticated user's completed match history.
 * Query params:
 *   before=ISO8601  — return only matches finished before this date
 *   limit=20        — max results (capped at 50)
 */
router.get('/history', requireAuth, async (req, res, next) => {
  try {
    const userId = req.auth!.userId;
    const limit = Math.min(50, Math.max(1, parseInt(req.query['limit'] as string) || 20));
    const before = req.query['before'] as string | undefined;

    const params: unknown[] = [JSON.stringify([{ userId }]), limit];
    let dateClause = '';
    if (before) {
      params.push(before);
      dateClause = `AND mh.finished_at < $${params.length}`;
    }

    const { rows } = await pool.query<{
      id: string; room_id: string; winner_user_id: string | null;
      rounds_played: number; player_results: PlayerResult[];
      finished_at: Date | null; invite_code: string | null;
      winner_name: string | null;
    }>(
      `SELECT
         mh.id, mh.room_id, mh.winner_user_id, mh.rounds_played,
         mh.player_results, mh.finished_at,
         gr.invite_code,
         pp.display_name AS winner_name
       FROM match_history mh
       JOIN game_rooms gr ON gr.id = mh.room_id
       LEFT JOIN player_profiles pp ON pp.user_id = mh.winner_user_id
       WHERE mh.player_results @> $1::jsonb
       ${dateClause}
       ORDER BY mh.finished_at DESC
       LIMIT $2`,
      params,
    );

    // Batch-fetch display names for all involved player IDs
    const allPlayerIds = [...new Set(rows.flatMap((r) => (r.player_results as PlayerResult[]).map((p) => p.userId)))];
    const { rows: nameRows } = allPlayerIds.length
      ? await pool.query<{ user_id: string; display_name: string | null }>(
          'SELECT user_id, display_name FROM player_profiles WHERE user_id = ANY($1)',
          [allPlayerIds],
        )
      : { rows: [] };
    const nameMap = new Map(nameRows.map((n) => [n.user_id, n.display_name]));

    const data = rows.map((mh) => {
      const myResult = (mh.player_results as PlayerResult[]).find((p) => p.userId === userId);
      return {
        id: mh.id,
        roomId: mh.room_id,
        inviteCode: mh.invite_code,
        winnerId: mh.winner_user_id,
        winnerName: mh.winner_name,
        roundsPlayed: mh.rounds_played,
        finishedAt: mh.finished_at,
        myRank: myResult?.rank ?? null,
        myFinalScore: myResult?.finalScore ?? null,
        players: (mh.player_results as PlayerResult[])
          .sort((a, b) => a.rank - b.rank)
          .map((p) => ({
            userId: p.userId,
            displayName: nameMap.get(p.userId) ?? p.userId,
            finalScore: p.finalScore,
            rank: p.rank,
          })),
      };
    });

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/history/:matchId ────────────────────────────────────────────────
/**
 * Full match details including round-by-round score breakdown.
 */
router.get('/history/:matchId', requireAuth, async (req, res, next) => {
  try {
    const { matchId } = req.params;

    const { rows: matchRows } = await pool.query<{
      id: string; room_id: string; winner_user_id: string | null;
      rounds_played: number; player_results: PlayerResult[];
      finished_at: Date | null; invite_code: string | null;
      winner_name: string | null;
    }>(
      `SELECT mh.*, gr.invite_code, pp.display_name AS winner_name
       FROM match_history mh
       JOIN game_rooms gr ON gr.id = mh.room_id
       LEFT JOIN player_profiles pp ON pp.user_id = mh.winner_user_id
       WHERE mh.id = $1`,
      [matchId],
    );

    if (!matchRows[0]) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Match not found' } });
      return;
    }
    const match = matchRows[0];

    // Round-by-round breakdown (same query as scores endpoint)
    const { rows: roundRows } = await pool.query<{
      id: string; round_number: number;
      dealer_user_id: string; dealer_name: string | null;
      end_reason: string; finisher_user_id: string | null; finisher_name: string | null;
      next_dealer_user_id: string | null; next_dealer_name: string | null;
    }>(
      `SELECT
         r1.id, r1.round_number,
         r1.dealer_user_id,  pp_d.display_name  AS dealer_name,
         r1.end_reason,
         r1.finisher_user_id, pp_f.display_name AS finisher_name,
         r2.dealer_user_id   AS next_dealer_user_id,
         pp_nd.display_name  AS next_dealer_name
       FROM game_rounds r1
       LEFT JOIN player_profiles pp_d  ON pp_d.user_id  = r1.dealer_user_id
       LEFT JOIN player_profiles pp_f  ON pp_f.user_id  = r1.finisher_user_id
       LEFT JOIN game_rounds r2
              ON r2.room_id = r1.room_id
             AND r2.round_number = r1.round_number + 1
       LEFT JOIN player_profiles pp_nd ON pp_nd.user_id = r2.dealer_user_id
       WHERE r1.room_id = $1 AND r1.status = 'finished'
       ORDER BY r1.round_number ASC`,
      [match.room_id],
    );

    const { rows: scoreRows } = await pool.query<{
      round_id: string; user_id: string; display_name: string | null;
      table_total: number; hand_total: number; round_score: number;
      finish_bonus: number; final_score: number; cumulative_score_after: number;
    }>(
      `SELECT s.*, pp.display_name
       FROM game_scores s
       JOIN player_profiles pp ON pp.user_id = s.user_id
       WHERE s.room_id = $1
       ORDER BY s.round_id, s.final_score DESC`,
      [match.room_id],
    );

    const byRound = new Map<string, typeof scoreRows>();
    for (const s of scoreRows) {
      const arr = byRound.get(s.round_id) ?? [];
      arr.push(s);
      byRound.set(s.round_id, arr);
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

    const allPlayerIds = (match.player_results as PlayerResult[]).map((p) => p.userId);
    const { rows: nameRows } = await pool.query<{ user_id: string; display_name: string | null }>(
      'SELECT user_id, display_name FROM player_profiles WHERE user_id = ANY($1)',
      [allPlayerIds],
    );
    const nameMap = new Map(nameRows.map((n) => [n.user_id, n.display_name]));

    res.json({
      success: true,
      data: {
        id: match.id,
        roomId: match.room_id,
        inviteCode: match.invite_code,
        winnerId: match.winner_user_id,
        winnerName: match.winner_name,
        roundsPlayed: match.rounds_played,
        finishedAt: match.finished_at,
        players: (match.player_results as PlayerResult[])
          .sort((a, b) => a.rank - b.rank)
          .map((p) => ({
            ...p,
            displayName: nameMap.get(p.userId) ?? p.userId,
          })),
        rounds,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
