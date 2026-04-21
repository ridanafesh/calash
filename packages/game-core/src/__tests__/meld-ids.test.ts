/**
 * Regression test: the engine must accept a custom id generator so the server
 * can use UUIDs (matching the DB's `game_melds.id` column type). Previously
 * the engine's defaultId() produced 8-char base36 strings, which the server
 * handed straight to Postgres and received a `22P02 invalid input syntax for
 * type uuid` error on add-to-meld. Fix: server now passes `crypto.randomUUID`.
 *
 * These tests don't touch the DB — they just verify:
 *   1. applyTurnAction's generator parameter is respected for go-down,
 *      add-new-meld, and that the id is visible in RoundState.
 *   2. add-to-meld uses the same id to look up the meld it extends, and
 *      succeeds end-to-end when the upstream id was UUID-shaped.
 *   3. extending an own meld preserves the id in the new state.
 */

import type { Card, PlayerRoundState, RegularCard, RoundState } from '@calash/shared';
import { applyTurnAction } from '../engine.js';

const rc = (rank: RegularCard['rank'], suit: RegularCard['suit'], deckIndex: 0 | 1 = 0): RegularCard =>
  ({ rank, suit, isJoker: false, deckIndex });

function makeFreshState(myHand: Card[]): { state: RoundState; me: string; other: string } {
  const me = 'me';
  const other = 'other';
  const myPs: PlayerRoundState = {
    playerId: me,
    hand: [...myHand],
    melds: [],
    hasGoneDown: false,
    tableTotal: 0,
  };
  const otherPs: PlayerRoundState = {
    playerId: other,
    hand: [],
    melds: [],
    hasGoneDown: false,
    tableTotal: 0,
  };
  const state: RoundState = {
    roundNumber: 1,
    dealerPlayerId: other,
    playerOrder: [me, other],
    currentTurnPlayerId: me,
    phase: 'in-progress',
    turnPhase: 'holding',
    playerStates: { [me]: myPs, [other]: otherPs },
    hiddenDeck: [rc('2', 'clubs')],
    discardPile: [rc('5', 'spades')],
    highestTableTotal: 0,
    didTakeFromDiscardThisTurn: false,
  };
  return { state, me, other };
}

// A trivial stub that mimics randomUUID() — the point of the test isn't
// that it's cryptographically random, only that the engine respects an
// externally-provided id generator.
let uuidCounter = 0;
const FAKE_UUIDS = [
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
];
function fakeUuid(): string {
  const id = FAKE_UUIDS[uuidCounter % FAKE_UUIDS.length];
  uuidCounter++;
  return id;
}

beforeEach(() => { uuidCounter = 0; });

describe('Meld ID generator integration', () => {
  it('assigns the engine-provided id (UUID shape) to melds created by go-down', () => {
    // Three Aces (75) + 2-3-4 hearts (9) = 84 pts → clears the opening threshold.
    const myHand = [
      rc('A', 'spades'), rc('A', 'hearts'), rc('A', 'diamonds'),
      rc('2', 'hearts'), rc('3', 'hearts'), rc('4', 'hearts'),
      rc('9', 'clubs'),
    ];
    const { state, me } = makeFreshState(myHand);

    const r = applyTurnAction(state, me, {
      type: 'go-down',
      melds: [
        { type: 'set', cards: [myHand[0], myHand[1], myHand[2]] },
        { type: 'sequence', cards: [myHand[3], myHand[4], myHand[5]] },
      ],
    }, fakeUuid);

    expect(r.ok).toBe(true);
    if (r.ok) {
      const myMelds = r.state.playerStates[me].melds;
      expect(myMelds).toHaveLength(2);
      expect(myMelds[0].id).toBe(FAKE_UUIDS[0]);
      expect(myMelds[1].id).toBe(FAKE_UUIDS[1]);
      // The id shape is a canonical UUID — what Postgres requires.
      expect(myMelds[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    }
  });

  it('extends a meld using that same id (the add-to-meld lookup works)', () => {
    // Go down with an opening of 3 Aces (set, 75 pts) + 2-3-4 hearts (9 pts).
    // Keep 5♥ in hand so the sequence can be legally extended by one card
    // (adding 5♥ to 2-3-4 ♥ gives 2-3-4-5 ♥). The test's point is: the id
    // we use to extend comes straight out of the engine's newly-created
    // meld, and lookup succeeds because the in-memory id is consistent.
    const { state, me } = makeFreshState([
      rc('A', 'spades'), rc('A', 'hearts'), rc('A', 'diamonds'),
      rc('2', 'hearts'), rc('3', 'hearts'), rc('4', 'hearts'),
      rc('5', 'hearts'), // extension card
    ]);

    const down = applyTurnAction(state, me, {
      type: 'go-down',
      melds: [
        { type: 'set', cards: [rc('A', 'spades'), rc('A', 'hearts'), rc('A', 'diamonds')] },
        { type: 'sequence', cards: [rc('2', 'hearts'), rc('3', 'hearts'), rc('4', 'hearts')] },
      ],
    }, fakeUuid);
    expect(down.ok).toBe(true);
    if (!down.ok) return;

    const sequenceMeld = down.state.playerStates[me].melds.find((m) => m.type === 'sequence');
    expect(sequenceMeld).toBeDefined();
    if (!sequenceMeld) return;
    expect(sequenceMeld.id).toBe(FAKE_UUIDS[1]);

    // Extend the sequence with 5♥. The meldId is the UUID the engine
    // assigned on go-down. Lookup must find the meld and the card must
    // land on the table.
    const extend = applyTurnAction(down.state, me, {
      type: 'add-to-meld',
      meldId: sequenceMeld.id,
      cards: [rc('5', 'hearts')],
    }, fakeUuid);

    expect(extend.ok).toBe(true);
    if (extend.ok) {
      const updated = extend.state.playerStates[me].melds.find((m) => m.id === sequenceMeld.id);
      expect(updated?.cards.length).toBe(4);
      expect(updated?.id).toBe(sequenceMeld.id);
    }
  });

  it('preserves ids across subsequent add-new-meld actions', () => {
    const { state, me } = makeFreshState([
      rc('A', 'spades'), rc('A', 'hearts'), rc('A', 'diamonds'),
      rc('5', 'clubs'), rc('6', 'clubs'), rc('7', 'clubs'),
      rc('9', 'clubs'),
    ]);
    const down = applyTurnAction(state, me, {
      type: 'go-down',
      melds: [{ type: 'set', cards: [rc('A', 'spades'), rc('A', 'hearts'), rc('A', 'diamonds')] }],
    }, fakeUuid);
    expect(down.ok).toBe(true);
    if (!down.ok) return;

    const addNew = applyTurnAction(down.state, me, {
      type: 'add-new-meld',
      meld: { type: 'sequence', cards: [rc('5', 'clubs'), rc('6', 'clubs'), rc('7', 'clubs')] },
    }, fakeUuid);
    expect(addNew.ok).toBe(true);
    if (addNew.ok) {
      const melds = addNew.state.playerStates[me].melds;
      expect(melds).toHaveLength(2);
      // First meld preserved (from go-down), second meld uses the next UUID.
      expect(melds[0].id).toBe(FAKE_UUIDS[0]);
      expect(melds[1].id).toBe(FAKE_UUIDS[1]);
    }
  });
});
