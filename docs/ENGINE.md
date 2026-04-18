# Game Engine — State Machine Documentation

The Calash game engine (`packages/game-core`) is a **pure, stateless** library.
Every function takes a state object and returns a new one — no I/O, no database,
no Socket.IO.  The server owns persistence and transport; the engine owns rules.

---

## Round lifecycle

```
initRound()
     │
     ▼
 ┌───────────────────────���─────────────────────┐
 │  phase: 'in-progress'                       │
 │                                             │
 │   turnPhase: 'awaiting-draw-or-take'        │
 │         │                                   │
 │         │  draw-from-deck                   │
 │         │  take-from-discard                │
 │         ▼                                   │
 │   turnPhase: 'holding'                      │
 │         │                                   │
 │         │  [optional] go-down               │
 │         │  [optional] add-to-meld ×N        │
 │         │  [optional] add-new-meld ×N       │
 │         │  discard  ─────────────────────── ┼──► advanceTurn()
 │         │                                   │         │
 │         │  (hand empty after discard)       │         │
 │         └──► finishRound('player-finished') │         │
 │                                             │         │
 │    (deck empty + discard ≤ 1 at turn start) │         │
 │    ──────────────────────────────────────── ┼──► finishRound('deck-exhausted')
 └─────────────────────────────────────────────┘
                        │
                        ▼
                phase: 'scoring'
                roundResult returned
```

---

## Turn order

Players are seated counterclockwise.  The player **immediately to the right of
the dealer** goes first and receives **15 cards**; all others receive **14**.
`dealerIndex` is an index into the `playerIds` array, and `playerOrder[0]` is
`playerIds[(dealerIndex + 1) % n]`.

After each round the dealer role passes one seat to the left (`nextDealerIndex`).

---

## Round initialisation — `initRound`

```typescript
initRound({
  playerIds,    // 2–4 player IDs
  roundNumber,
  dealerIndex,
  deck?,        // optional pre-shuffled deck for deterministic tests
}): RoundState
```

- Builds `playerOrder` starting from the player right of the dealer.
- Deals 15 cards to `playerOrder[0]`, 14 to all others.
- Discard pile starts **empty**.  The first player opens it by discarding.
- Hidden deck = all cards remaining after dealing.

---

## Turn processing — `applyTurnAction`

```typescript
applyTurnAction(
  state: RoundState,
  playerId: string,
  action: TurnAction,
  generateId?: () => string,   // injectable for deterministic tests
): ApplyResult
```

### ApplyResult

```typescript
type ApplyResult =
  | { ok: true;  state: RoundState; roundResult?: RoundResult }
  | { ok: false; error: string };
```

- `ok: true, state` — action applied; game continues.
- `ok: true, state, roundResult` — round ended as part of this action.
- `ok: false, error` — action rejected; original state is unchanged.

### Guard order

1. Wrong player → reject.
2. Round not `in-progress` → reject.
3. Deck exhausted at `awaiting-draw-or-take` → `finishRound('deck-exhausted')`.
4. `validateTurnAction(action, ctx)` — all rule checks.
5. Dispatch to action applier.

### Action types

| `action.type`        | Allowed phase          | Effect |
|----------------------|------------------------|--------|
| `draw-from-deck`     | awaiting-draw-or-take  | Pop top card from `hiddenDeck` → hand; phase → `holding` |
| `take-from-discard`  | awaiting-draw-or-take  | Take N cards from discard pile top → hand; phase → `holding` |
| `go-down`            | holding                | Place initial melds; set `hasGoneDown = true`; update `tableTotal` + `highestTableTotal` |
| `add-to-meld`        | holding                | Append cards to an existing meld; update **actor's** `tableTotal` (MVP rule) |
| `add-new-meld`       | holding                | Create a new meld in actor's list; update `tableTotal` |
| `discard`            | holding                | Move card to discard pile; advance turn or end round |

---

## Scoring attribution — MVP rule

When a player adds cards to **another player's meld** (`add-to-meld`), the
**contributor's** `tableTotal` is incremented — not the meld owner's.

This means `PlayerRoundState.tableTotal` tracks *total card value contributed by
this player*, regardless of whose meld the cards ended up in.  `computePlayerRoundScore`
reads `state.tableTotal` directly rather than re-summing the player's own melds.

---

## Discard pile rules

Cards are ordered **oldest → newest** (index 0 = bottom, last index = top).
"Taking" removes from the top (end of array).

| Pile size | Options |
|-----------|---------|
| ≤ 1       | Cannot take (bottom card must stay) |
| 2         | Take 1 (leave 1) |
| 3         | Take 2 (leave 1) |
| **4**     | Option A: take 3, leave 1 — **or** Option B: take all 4, return 1 from hand |
| 5+        | Take `pile.length − 1` (leave 1) |

A player may **not go down** on the same turn they take from the discard pile.

---

## Meld validation

### Sequence rules

- ≥ 3 cards, same suit.
- Consecutive ranks; at most 1 joker (fills a gap **or** extends an edge).
- Ace may be **low** (A-2-3, rank = 1) **or** **high** (Q-K-A, rank = 14).
- Circular wraps (K-A-2) are rejected.

### Set rules

- 3 or 4 cards, same rank, **different suits**.
- At most 1 joker (represents the missing suit).

---

## Go-down threshold

```
highestTableTotal === 0  →  minimum = 75  (INITIAL_GO_DOWN_MINIMUM)
highestTableTotal > 0    →  minimum = highestTableTotal + 5  (GO_DOWN_INCREMENT)
```

The threshold is **dynamic**: if a player already down adds more cards and raises
`highestTableTotal`, players who haven't yet gone down face a higher bar.

---

## Round end conditions

| Condition | `endReason` | Finisher bonus |
|-----------|-------------|----------------|
| A player discards their last card | `player-finished` | +20 to the finisher |
| `hiddenDeck.length === 0 && discardPile.length <= 1` at turn start | `deck-exhausted` | No bonus |

`isRoundOverByExhaustion(state)` exposes the exhaustion check so the server can
also query it between rounds.

---

## Client-safe projection — `toRoundStateView`

Strips per-player hands and the full `hiddenDeck` array.  The result is safe to
broadcast to all connected clients.  Each client also receives their own hand via
a private socket event.

```typescript
toRoundStateView(state: RoundState): RoundStateView
// hiddenDeck     → hiddenDeckCount (number)
// playerStates   → Omit<PlayerRoundState, 'hand'>
```

---

## Deterministic testing

Pass a pre-shuffled deck to `initRound` to make deals reproducible:

```typescript
import { seededShuffle } from '@calash/game-core';
import { createDeck } from '@calash/game-core';

const deck = seededShuffle(createDeck(), 42);
const state = initRound({ playerIds: ['p1', 'p2'], roundNumber: 1, dealerIndex: 0, deck });
```

`seededShuffle` uses the **Mulberry32** PRNG (fast, deterministic, not
cryptographically secure).  The same seed always produces the same ordering.
