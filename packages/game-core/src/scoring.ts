import type { PlayerRoundState, RoundResult, PlayerRoundScore, RoundEndReason } from '@calash/shared';
import { GAME_CONFIG } from '@calash/shared';
import { totalCardValue } from './meld.js';

/**
 * Compute the round score for a single player.
 *
 * Formula:
 *   round score = sum(meld values on table) − sum(card values in hand)
 *
 * If the player finished first (emptied their hand), the FINISH_BONUS (+20)
 * is added after computing the base score.
 *
 * Scores may be negative.
 */
export function computePlayerRoundScore(
  state: PlayerRoundState,
  finishedFirst: boolean,
): PlayerRoundScore {
  const tableTotal = state.tableTotal;
  const handTotal = totalCardValue(state.hand);
  const roundScore = tableTotal - handTotal;
  const finalScore = roundScore + (finishedFirst ? GAME_CONFIG.FINISH_BONUS : 0);

  return {
    playerId: state.playerId,
    tableTotal,
    handTotal,
    roundScore,
    finishedFirst,
    finalScore,
  };
}

/**
 * Compute scores for all players at the end of a round.
 *
 * `finisherPlayerId` is null when the round ended because the deck ran out
 * (no one emptied their hand — no finish bonus is awarded in that case).
 */
export function computeRoundResult(
  playerStates: Record<string, PlayerRoundState>,
  playerOrder: readonly string[],
  endReason: RoundEndReason,
  finisherPlayerId: string | null,
): RoundResult {
  const playerScores: PlayerRoundScore[] = playerOrder.map((playerId) => {
    const state = playerStates[playerId];
    const finishedFirst = playerId === finisherPlayerId;
    return computePlayerRoundScore(state, finishedFirst);
  });

  return {
    roundNumber: 0, // caller fills in roundNumber
    endReason,
    finisherPlayerId,
    playerScores,
  };
}

/**
 * Apply a round's results to cumulative scores.
 * Returns a new score map; does not mutate the input.
 */
export function applyCumulativeScores(
  current: Record<string, number>,
  result: RoundResult,
): Record<string, number> {
  const updated = { ...current };
  for (const ps of result.playerScores) {
    updated[ps.playerId] = (updated[ps.playerId] ?? 0) + ps.finalScore;
  }
  return updated;
}

/**
 * Return the ID of the player who has reached or exceeded WIN_SCORE,
 * or null if the game is not yet over.
 *
 * If multiple players cross WIN_SCORE simultaneously, the one with the
 * highest cumulative total wins.
 */
export function getWinner(cumulativeScores: Record<string, number>): string | null {
  let winnerId: string | null = null;
  let winnerScore = -Infinity;

  for (const [playerId, score] of Object.entries(cumulativeScores)) {
    if (score >= GAME_CONFIG.WIN_SCORE && score > winnerScore) {
      winnerId = playerId;
      winnerScore = score;
    }
  }

  return winnerId;
}
