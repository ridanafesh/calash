// Deck utilities
export {
  createDeck,
  shuffleDeck,
  dealHands,
  isSameCard,
  removeCardsFromHand,
} from './deck.js';

// Meld validation & value helpers
export {
  validateMeld,
  validateMeldExtension,
  cardValue,
  totalCardValue,
  totalMeldValue,
} from './meld.js';
export type { ValidationResult } from './meld.js';

// Scoring
export {
  computePlayerRoundScore,
  computeRoundResult,
  applyCumulativeScores,
  getWinner,
} from './scoring.js';

// Rules — all pure, no I/O
export {
  validateTurnAction,
  validateTakeFromDiscard,
  applyTakeFromDiscard,
  validateGoDown,
  goDownMinimum,
} from './rules/index.js';
export type { TurnContext } from './rules/index.js';
