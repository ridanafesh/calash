# Architecture

## System Overview

```
┌──────────────────────────────────────────────────────────────┐
│  Browser / Mobile App                                        │
│  Next.js 14 (React 18)          React Native (future)        │
└──────────┬──────────────────────────────┬────────────────────┘
           │ REST (HTTP)                  │ Socket.IO
           ▼                              ▼
┌──────────────────────────────────────────────────────────────┐
│  apps/server  (Node.js 20, Express 4, Socket.IO 4)           │
│  ┌───────────┐  ┌──────────┐  ┌─────────────────────────┐   │
│  │ REST API  │  │ Socket   │  │ In-Memory RoomStore      │   │
│  │ /api/*    │  │ Handlers │  │ (game state, live rooms) │   │
│  └─────┬─────┘  └────┬─────┘  └─────────────────────────┘   │
│        │             │                                        │
│  ┌─────▼─────────────▼─────────────────────────────────┐     │
│  │ Repositories (UserRepo, RoomRepo, ScoreRepo, ...)   │     │
│  └─────────────────────────┬───────────────────────────┘     │
└────────────────────────────┼─────────────────────────────────┘
                             │
                   ┌─────────▼─────────┐
                   │  PostgreSQL 16     │
                   │  (persistent data) │
                   └───────────────────┘

packages/shared    — TypeScript types shared across all layers
packages/game-core — Pure game logic (no I/O), used by server + future mobile
```

---

## Architecture Decision Records

### ADR-001: Monorepo with npm workspaces

**Decision:** Single repo with `apps/server`, `apps/web`, `packages/shared`, `packages/game-core`.

**Rationale:** `@calash/shared` and `@calash/game-core` must be consumed by both the web app and a future React Native mobile app. A monorepo eliminates type drift and makes cross-layer refactoring safe.

**Consequences:** All packages share one `node_modules` tree. Workspace package changes are reflected immediately without rebuilding.

---

### ADR-002: Game logic in a framework-free package

**Decision:** `packages/game-core` has zero runtime dependencies on Express, React, Socket.IO, or any platform SDK.

**Rationale:** The same deck creation, meld validation, and scoring logic must run on:
- The server (authoritative source of truth)
- A future mobile app for offline UI previews without a round-trip

Pure functions with result types (`{ ok, error }` / `{ valid, reason }`) are deterministically testable with a seeded shuffle.

**Consequences:** `game-core` is fully unit-tested in isolation. Adding platform-specific behavior requires a new package, not modifying game-core.

---

### ADR-003: In-memory RoomStore alongside PostgreSQL

**Decision:** Active game rooms live in a `Map`-based `RoomStore` (RAM); the database stores completed rounds and scores.

**Rationale:** Socket.IO game events arrive many times per second. A DB round-trip on every card play would be impractical. The in-memory store provides zero-latency access for the socket layer.

**Consequences:**
- Server restart loses all active games (acceptable for MVP)
- Horizontal scaling requires a shared store (Redis planned for Phase 2)
- The DB is the authoritative record for scores, history, and entitlements

---

### ADR-004: Repository pattern for DB access

**Decision:** Each domain has a typed repository class (`UserRepository`, `RoomRepository`, etc.) that wraps raw SQL.

**Rationale:** Keeps SQL out of route handlers; repositories are easy to mock in integration tests by replacing `createDatabaseService(pool)`.

**Consequences:** More boilerplate than an ORM, but full control over queries and no N+1 surprises.

---

### ADR-005: Hand-written SQL migrations over ORM

**Decision:** Schema changes are `.sql` files in `apps/server/src/db/migrations/`, applied by a custom runner.

**Rationale:** Full control over data types, indexes, and constraints. No ORM abstraction layer to debug. Migrations are tracked in `schema_migrations` and are transactional.

**Consequences:** More work per change, but predictable behavior. Rollback requires a new migration.

---

### ADR-006: Commerce behind a feature gate

**Decision:** All payment routes return `503 Service Unavailable` unless `COMMERCE_ENABLED=true`.

**Rationale:** The data model, services, and provider stubs are fully wired but legal review and payment credentials are not yet complete. Shipping the code dark prevents accidental exposure.

**Consequences:** Enabling commerce requires only a config change + provider credentials. No code changes needed.

---

### ADR-007: Entitlements as the sole feature gate

**Decision:** Feature gates check `entitlements` table only, never `orders` or `payments`.

**Rationale:** Orders can be pending or failed; payment webhooks can arrive out of order or be duplicated. Entitlements are written only after verification and are idempotent via a partial unique index on `payment_id`.

---

## Data Model

```
users
  └── auth_accounts       (password / google / guest providers)
  └── user_profiles       (username, display_name, avatar)
  └── orders              (purchase intent)
        └── payments      (provider-confirmed capture)
  └── entitlements        (access rights — source of truth)
  └── user_inventory      (owned cosmetic items)
  └── wallet_balances     (virtual currency)
        └── wallet_transactions (append-only ledger)

products
  └── product_prices      (per-platform pricing)

game_rooms
  └── game_room_players   (room membership)
  └── game_rounds         (round records)
        └── round_hands   (dealt hands)
        └── game_moves    (action log)
        └── round_discards
  └── game_melds          (table melds)
        └── game_meld_cards

game_scores
```

Migrations live in `apps/server/src/db/migrations/` and run in lexicographic order.

---

## Auth Flow

```
POST /api/auth/register   → bcrypt hash → create user + auth_account → JWT
POST /api/auth/login      → bcrypt compare → JWT
POST /api/auth/google     → verify Google ID token → upsert user → JWT
POST /api/auth/guest      → create user with no email → JWT (isGuest: true)
POST /api/auth/upgrade/*  → link permanent provider to guest account
```

JWT payload: `{ userId: string, isGuest: boolean }`. Tokens are verified by `requireAuth` middleware. There is no token revocation in MVP (stateless); a `revocation_list` table is planned for Phase 2.

---

## Game State Architecture

```
HTTP  POST /api/rooms            → create room in DB + RoomStore
WS    room:join                  → join RoomStore, emit room:state
WS    room:ready                 → mark player ready
WS    room:start-game            → initRound() → store in RoomStore
WS    game:action { type, ... }  → applyTurnAction() → broadcast game:state
WS    (round end)                → save scores to DB, advance RoundStore state
```

The authoritative `RoundState` is stored only in `RoomStore.round.state`. The DB records completed rounds and final scores for history and leaderboards.

`applyTurnAction` in `packages/game-core` is a pure function: `(state, playerId, action) → { ok, state, roundResult? }`. The socket handler is responsible for broadcasting the new state to all room members.

---

## Socket Event Map

| Direction | Event | Payload | Description |
|---|---|---|---|
| client → server | `room:join` | `{ roomId }` | Join a room |
| client → server | `room:join-by-code` | `{ code }` | Join by invite code |
| client → server | `room:leave` | — | Leave current room |
| client → server | `room:ready` | `{ isReady }` | Toggle ready state |
| client → server | `room:start-game` | — | Host starts the game |
| client → server | `game:action` | `TurnAction` | Submit a game move |
| server → client | `room:state` | `GameRoom` | Room state update |
| server → client | `game:state` | `RoundStateView` | Game state (no hidden info) |
| server → client | `game:your-hand` | `Card[]` | Private hand for the recipient |
| server → client | `game:error` | `{ message }` | Action rejected |
| server → client | `game:round-end` | `RoundResult` | Round finished |

---

## Testing Strategy

| Layer | Tool | Location |
|---|---|---|
| Game logic | Jest + ts-jest | `packages/game-core/src/__tests__/` |
| Server integration | Jest + ts-jest + supertest | `apps/server/src/__tests__/` |
| Frontend | Deferred (Next.js App Router mocking complexity) | — |

**Game-core tests** cover: deck creation, meld validation (sequences, sets, joker rules), going-down threshold (75 pts, dynamic +5), discard pile rules, round end conditions, scoring (+20 winner bonus, cumulative 1000-point win), and `add-to-meld` contributor tracking.

**Server integration tests** use module-level mocks for the pg pool and repositories (`jest.mock`). The `createApp()` factory makes it easy to mount the Express app in tests without starting a real server.

---

## Commerce Architecture

See [docs/MONETIZATION.md](docs/MONETIZATION.md) for the full commerce design.

Summary:
- `PaymentProvider` interface with three stubs: `PayPalProvider`, `AppleProvider`, `GoogleProvider`
- All disabled (`enabled: false`) until credentials are provided
- Routes gated by `COMMERCE_ENABLED` env var
- Entitlements service is the runtime access check
- Wallet abstraction for virtual currency (coins)
