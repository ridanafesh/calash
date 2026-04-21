# Bot Players

Bots let a single player start and complete a full game when no other humans
are available, and let a host fill empty seats in a multiplayer room.

## How it works

A bot is a real entry in the `users` table with `is_bot = true`. It has a
`player_profiles` row (so its display name shows up everywhere a human's would)
but **no** `auth_accounts` row and **no** `leaderboard_entries` row. The socket
auth middleware rejects any JWT that resolves to a bot user, so bots can never
hold a connection and the only way they can act is via the server-side driver.

When the current turn belongs to a bot, the server schedules
`runBotAction(roomId, io)` on a 1.2 s timer. The driver:

1. Calls `chooseBotAction(difficulty, { state, playerId, hand })` from
   `@calash/game-core` to decide a single `TurnAction`.
2. Funnels that action through the **same** `applyPlayerAction` pipeline
   humans use — same validators, same DB persistence, same broadcasts.
3. If the next turn is still a bot (because the same bot owes another action,
   e.g. it just went down and now needs to discard, or because the next seat
   is also a bot), reschedules itself.

Because every bot decision goes through `applyTurnAction` from the rules
engine, **a bot can never produce an illegal move**. If the heuristic ever
returns something the engine rejects, the driver logs it and falls back to a
safe `discard` so the round doesn't lock up.

## Game modes

The lobby and create-room flows expose three ways to start:

- **Multiplayer**: classic flow. Host creates a room and shares the 6-letter
  code; humans join until the room is ready.
- **Multiplayer + fill empty seats with bots**: a checkbox in the create-room
  form. The room is created at full size with bots immediately occupying the
  empty seats; humans can still join via code (replacing a bot is not yet
  supported — the host can remove specific bots by clicking ✕ next to them).
- **Play vs Computer**: 1 human + 1 bot, both seats filled at creation. There
  is a one-click button on the lobby (`🤖 Play vs Computer`) and a "Play vs
  Computer" mode in the create-room page.

A host can also click **Add Easy Bot** in the waiting room any time before the
game starts to fill an empty seat.

## Bot strategy: Easy

Implemented in `packages/game-core/src/bot/easy.ts` as a pure function:

```ts
chooseEasyAction({ state, playerId, hand }): TurnAction
```

Heuristic, in order of evaluation:

1. **Draw phase**
   - If the deck is empty, take from the discard pile (the only legal move).
   - If the discard pile has exactly 2 cards and the top card immediately
     completes a 3-card meld with two cards in hand, take it.
   - Otherwise draw from the deck.

2. **Holding phase, not yet down**
   - Enumerate every 3- and 4-card combination of the hand that forms a valid
     sequence or set. Greedy-pick disjoint melds in descending value order
     until the go-down threshold is reached, leaving at least one card to
     discard. If the threshold can't be reached, fall through.
   - Cap k=3 once the hand grows past 25 cards to keep enumeration tractable.

3. **Holding phase, already down**
   - For every meld on the table (any player's), try to extend it with one
     card from hand. If found, do that.
   - Otherwise, if the hand contains a fresh full meld, place it as a new meld
     (leaving at least one card to discard).

4. **Discard**
   - Score every card in hand by `keepValue` (how many partial-meld
     combinations it participates in). Discard the lowest-`keepValue` card,
     tie-broken by highest raw point value (shed expensive dead weight).
   - Never discard a joker if a regular card is available.

The bot honors every rule the human-facing engine enforces:
- Never goes down on the same turn it took from the discard pile.
- Honors the dynamic threshold (`INITIAL_GO_DOWN_MINIMUM` for the first
  opener, `highestTableTotal + GO_DOWN_INCREMENT` afterward).
- Only places valid melds (sequence with same-suit consecutive ranks or set
  with same-rank distinct suits, ≤1 joker per meld).

The Easy bot is intentionally not adversarial — it doesn't track opponent
hands, doesn't withhold safe discards, and doesn't search deep. It produces
playable but beatable opposition.

## Adding a new difficulty

1. Add a new value to `BotDifficulty` in
   `packages/shared/src/types/game.ts`.
2. Implement a `chooseXxxAction(ctx: BotContext): TurnAction` in
   `packages/game-core/src/bot/xxx.ts`.
3. Register it in the dispatch in `packages/game-core/src/bot/index.ts`.
4. The function MUST be pure — no I/O, no randomness beyond what's passed in
   `ctx.rng`.
5. Add tests in `packages/game-core/src/__tests__/bot-xxx.test.ts`.

The server-side driver, UI labels, and DB layer all already work with any
difficulty value — no changes needed elsewhere.

## Files changed

### Shared
- `packages/shared/src/types/game.ts` — `BotDifficulty` enum, `RoomPlayer.isBot`
  + `botDifficulty` fields.
- `packages/shared/src/types/events.ts` — `RoomCreateOptions` (new payload for
  `room:create`), `room:add-bot`, `room:remove-bot` events.

### Game-core
- `packages/game-core/src/bot/index.ts` — `chooseBotAction` dispatcher.
- `packages/game-core/src/bot/easy.ts` — Easy-bot strategy (pure functions).
- `packages/game-core/src/index.ts` — re-exports the bot API.
- `packages/game-core/src/__tests__/bot-easy.test.ts` — 14 tests covering
  draw/take, opening, threshold respect, post-down extension, discard
  selection, joker preservation, plus a fuzz over hundreds of bot-vs-bot
  turns asserting strict legality.

### Server
- `apps/server/src/db/migrations/007_bot_players.sql` — adds
  `users.is_bot BOOLEAN NOT NULL DEFAULT false` + partial index.
- `apps/server/src/services/bot.service.ts` — `createBotUser`, `decideBotAction`.
- `apps/server/src/store/index.ts` — `PlayerSlot.isBot` + `botDifficulty`.
- `apps/server/src/sockets/handlers/room.ts` — accepts `RoomCreateOptions`,
  fills bots when requested, adds `handleRoomAddBot` / `handleRoomRemoveBot`,
  fixes orphan-room cleanup when only bots remain, kicks off the bot driver
  when the first turn belongs to a bot.
- `apps/server/src/sockets/handlers/game.ts` — extracted shared
  `applyPlayerAction` pipeline; added `scheduleBotIfNeeded`,
  `runBotAction`, `cancelBotTimer` and one-bot-timer-per-room concurrency
  guard. Rejects manual `game:action` from bot users.
- `apps/server/src/sockets/index.ts` — registers `room:add-bot` and
  `room:remove-bot` handlers; auth middleware rejects bot JWTs.
- `apps/server/src/db/repositories/score.repository.ts` — skips bots in
  `updateLeaderboard`.
- `apps/server/src/routes/leaderboard.ts` — adds `WHERE u.is_bot = false` to
  the listing query.
- `apps/server/src/routes/rooms.ts` — fixes a pre-existing
  `user_profiles → player_profiles` typo, populates `isBot` correctly in
  REST GET projections.

### Web
- `apps/web/src/lib/game-context.tsx` — exposes `addBot` / `removeBot` and
  forwards the new `RoomCreateOptions` shape on `createRoom`.
- `apps/web/src/app/lobby/page.tsx` — adds a `🤖 Play vs Computer`
  one-click button.
- `apps/web/src/app/rooms/create/page.tsx` — Mode picker (Multiplayer /
  Play vs Computer), "fill empty seats with bots" toggle.
- `apps/web/src/components/game/WaitingRoom.tsx` — BOT badge + 🤖 avatar,
  host-only Add/Remove bot controls.
- `apps/web/src/components/game/GameBoard.tsx` — BOT badge in opponent
  chips, "Bot is thinking…" indicator with spinner when a bot's turn,
  display names everywhere instead of bare userIds.

## Future extensions

- **Medium / Hard difficulties**: track opponents' table melds and known
  discards to inform discard choice; basic look-ahead for go-down planning.
- **Periodic bot-row GC**: a job that hard-deletes bot user rows from games
  finished more than N days ago. Currently bot rows accumulate (one per
  bot per game) but are filtered out of all queries via `is_bot`.
- **Replace-bot-with-human**: let a joining human take over a bot's seat in
  an open lobby instead of joining a new seat.
- **Configurable thinking delay**: currently hardcoded to 1200 ms in
  `apps/server/src/sockets/handlers/game.ts`. Make it per-room or per-difficulty.
