/**
 * Bot decision engine.
 *
 * Pure functions that take a public game view + a private hand and return a
 * single legal TurnAction.  All decisions are funneled through the same
 * applyTurnAction pipeline humans use — so the rules engine remains the
 * single source of truth and bots can never cheat or play illegally.
 *
 * Adding a new difficulty:
 *   1. Implement chooseAction in a new file under bot/.
 *   2. Register it in chooseBotAction's dispatch below.
 *   3. The signature MUST be pure — no I/O, no randomness beyond the optional
 *      seeded `rng` parameter (used by tests for reproducibility).
 */

import type { BotDifficulty, RoundState, TurnAction, Card } from '@calash/shared';

import { chooseEasyAction } from './easy.js';

export interface BotContext {
  readonly state: RoundState;
  readonly playerId: string;
  /** The bot's private hand. Not derivable from RoundState alone. */
  readonly hand: readonly Card[];
  /** Optional deterministic RNG (0..1). Defaults to Math.random. */
  readonly rng?: () => number;
}

/**
 * Choose the next legal TurnAction for a bot. Always returns an action that
 * passes validateTurnAction at the time it's called; if no legal action
 * exists (which should never happen), throws — the caller should treat that
 * as a bug, not a recoverable state.
 */
export function chooseBotAction(
  difficulty: BotDifficulty,
  context: BotContext,
): TurnAction {
  switch (difficulty) {
    case 'easy':
      return chooseEasyAction(context);
    default: {
      const _exhaustive: never = difficulty;
      throw new Error(`Unknown bot difficulty: ${_exhaustive as string}`);
    }
  }
}

export { chooseEasyAction } from './easy.js';
export type { ChooseEasyOptions } from './easy.js';
