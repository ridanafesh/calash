/**
 * Top-level re-export of all validation logic.
 *
 * The server imports from this module rather than reaching into sub-modules
 * directly.  This gives us freedom to restructure internals without
 * breaking import paths in apps/server.
 *
 * Pure rule validation (no I/O, no database, no Socket.IO) lives entirely
 * within packages/game-core.  The server is responsible for:
 *   1. Loading the current RoundState from wherever it stores it.
 *   2. Building a TurnContext from that state.
 *   3. Calling validateTurnAction (or a more specific validator).
 *   4. Applying the action and persisting the updated state.
 */

export type { ValidationResult } from './meld.js';

// Meld validation
export { validateMeld, validateMeldExtension, cardValue, totalCardValue, totalMeldValue } from './meld.js';

// Turn & action validation
export { validateTurnAction } from './rules/turn.js';
export type { TurnContext } from './rules/turn.js';

// Discard pile rules
export { validateTakeFromDiscard, applyTakeFromDiscard } from './rules/discard.js';

// Going-down rules
export { validateGoDown, goDownMinimum } from './rules/going-down.js';
